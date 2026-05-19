import { daytona } from "@computesdk/daytona";
import { Daytona } from "@daytonaio/sdk";
import { compute } from "computesdk";
import {
	type AgentSession,
	type AgentSessionResult,
	type CreateAgentSessionConfig,
	createAgentRuntime,
	createComputeSdkSandboxProvider,
	type McpServerRuntimeConfig,
	type RuntimeVolumeConfig,
} from "cyrus-agent-runtime";
import { ClaudeMessageFormatter, type SDKMessage } from "cyrus-claude-runner";
import type {
	AgentMessage,
	AgentRunnerConfig,
	AgentSessionInfo,
	IAgentRunner,
	IMessageFormatter,
} from "cyrus-core";

const DAYTONA_MOUNT_PATH = "/var/cyrus/context";
const DAYTONA_WORKDIR = "/home/daytona";
const DAYTONA_NPM_PREFIX = `${DAYTONA_WORKDIR}/.npm-global`;
const DAYTONA_CLAUDE_BIN = `${DAYTONA_NPM_PREFIX}/bin/claude`;
const DEFAULT_VOLUME_NAME = "cyrus-slack-claude-state";

/**
 * Required environment variables for {@link SlackDaytonaRunner}. Read once
 * at EdgeWorker startup via {@link assertSlackDaytonaEnv} so config errors
 * surface before any webhook lands.
 */
export interface SlackDaytonaEnv {
	daytonaApiKey: string;
	claudeCodeOAuthToken: string;
	/**
	 * Name of the Daytona volume used to persist Claude's session JSONL
	 * across sandbox lifetimes. Resolved to an id once at startup via
	 * {@link resolveSlackDaytonaVolumeId} (idempotent get-or-create).
	 * Default: `"cyrus-slack-claude-state"` — set
	 * `CYRUS_SLACK_DAYTONA_VOLUME_NAME` to override.
	 */
	volumeName: string;
}

/**
 * Env + a resolved Daytona volume id. Built by
 * {@link resolveSlackDaytonaVolumeId} once at startup so the per-message
 * runner factory has the id ready and never talks to the Daytona API.
 */
export interface SlackDaytonaConfig extends SlackDaytonaEnv {
	volumeId: string;
}

/**
 * Fail-fast env check for the Slack→Daytona path. Call at EdgeWorker
 * startup so a misconfigured deployment dies before any Slack message
 * arrives. Returns the resolved env on success; throws on missing creds.
 */
export function assertSlackDaytonaEnv(
	env: NodeJS.ProcessEnv = process.env,
): SlackDaytonaEnv {
	const daytonaApiKey = env.DAYTONA_API_KEY;
	const claudeCodeOAuthToken = env.CLAUDE_CODE_OAUTH_TOKEN;
	const missing: string[] = [];
	if (!daytonaApiKey) missing.push("DAYTONA_API_KEY");
	if (!claudeCodeOAuthToken) missing.push("CLAUDE_CODE_OAUTH_TOKEN");
	if (missing.length > 0) {
		throw new Error(
			`Slack→Daytona runtime requires env vars: ${missing.join(", ")}`,
		);
	}
	return {
		daytonaApiKey: daytonaApiKey!,
		claudeCodeOAuthToken: claudeCodeOAuthToken!,
		volumeName: env.CYRUS_SLACK_DAYTONA_VOLUME_NAME ?? DEFAULT_VOLUME_NAME,
	};
}

/**
 * Resolve the Daytona volume id, creating the volume if it does not yet
 * exist. Idempotent — re-running with the same name returns the existing
 * volume. Call once at EdgeWorker startup; cache the resulting
 * {@link SlackDaytonaConfig} and pass it to every {@link SlackDaytonaRunner}.
 *
 * The injectable `clientFactory` exists so unit tests can stub the SDK
 * without hitting the network.
 */
export async function resolveSlackDaytonaVolumeId(
	env: SlackDaytonaEnv,
	clientFactory: (apiKey: string) => DaytonaVolumeClient = defaultClientFactory,
): Promise<SlackDaytonaConfig> {
	const client = clientFactory(env.daytonaApiKey);
	let volume: { id: string };
	try {
		volume = await client.volume.get(env.volumeName, true);
	} catch (error) {
		throw new Error(formatDaytonaError(env.volumeName, error), {
			cause: error instanceof Error ? error : undefined,
		});
	}
	return { ...env, volumeId: volume.id };
}

/**
 * Daytona's SDK throws subclasses of `DaytonaError` that carry HTTP status
 * + machine-readable errorCode. We don't `instanceof` against them (would
 * couple this file to the SDK's class identity across pnpm dedup), but the
 * shape is stable: `{ statusCode?: number, errorCode?: string, message: string }`.
 */
function formatDaytonaError(volumeName: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const statusCode = readField(error, "statusCode");
	const errorCode = readField(error, "errorCode");
	const parts: string[] = [
		`Failed to resolve Daytona volume "${volumeName}" via get-or-create.`,
	];
	if (statusCode === 401) {
		parts.push(
			"HTTP 401 (authentication): DAYTONA_API_KEY is invalid, revoked, or expired. Regenerate at https://app.daytona.io/dashboard/api-keys.",
		);
	} else if (statusCode === 403) {
		parts.push(
			"HTTP 403 (authorization): the key is valid but lacks volume permissions in the target org. Check the key's scopes/role in the Daytona dashboard.",
		);
	} else if (statusCode === 409) {
		parts.push(
			`HTTP 409 (conflict): a volume named "${volumeName}" already exists with conflicting state. Try a different CYRUS_SLACK_DAYTONA_VOLUME_NAME.`,
		);
	} else if (statusCode !== undefined) {
		parts.push(`HTTP ${statusCode}.`);
	}
	if (errorCode) parts.push(`errorCode=${errorCode}.`);
	parts.push(`Original error: ${message}`);
	return parts.join(" ");
}

function readField(error: unknown, key: string): unknown {
	if (error === null || typeof error !== "object") return undefined;
	return (error as Record<string, unknown>)[key];
}

/**
 * Minimal slice of the Daytona SDK we depend on. Defined as an interface
 * so tests can stub it; production wires up the real `@daytonaio/sdk`.
 */
export interface DaytonaVolumeClient {
	volume: {
		get(name: string, create?: boolean): Promise<{ id: string }>;
	};
}

function defaultClientFactory(apiKey: string): DaytonaVolumeClient {
	return new Daytona({ apiKey }) as unknown as DaytonaVolumeClient;
}

/**
 * `IAgentRunner` adapter that executes every turn inside a fresh Daytona
 * sandbox via `cyrus-agent-runtime`. Hardcoded to Daytona — used only by
 * the Slack chat handler at this stage.
 *
 * Lifecycle per turn:
 *   1. Create a Daytona sandbox.
 *   2. Install Claude Code and run `claude -p ... --output-format stream-json --verbose`.
 *   3. Stream transcript events → translate to SDKMessage → forward to
 *      `config.onMessage` so the existing AgentSessionManager / reply
 *      posting flow keeps working.
 *   4. On completion, destroy the sandbox. The Daytona volume (when
 *      configured) keeps the JSONL transcript alive for the next reply.
 *
 * Limitations (deliberate, MVP scope):
 *   - `supportsStreamingInput = false` — every Slack follow-up triggers a
 *     fresh sandbox + `--resume <id>` via the runtime's resume primitives.
 *   - `isWarm() = false` — no in-flight follow-up injection.
 *   - `interrupt()` not implemented.
 */
export class SlackDaytonaRunner implements IAgentRunner {
	readonly supportsStreamingInput = false;

	private readonly sessionInfo: AgentSessionInfo;
	private readonly messages: SDKMessage[] = [];
	private readonly formatter: IMessageFormatter;
	private readonly daytonaConfig: SlackDaytonaConfig;
	private session?: AgentSession;

	constructor(
		private readonly config: AgentRunnerConfig,
		daytonaConfig: SlackDaytonaConfig,
	) {
		this.daytonaConfig = daytonaConfig;
		this.sessionInfo = {
			sessionId: null,
			startedAt: new Date(),
			isRunning: false,
		};
		this.formatter = new ClaudeMessageFormatter();
	}

	async start(prompt: string): Promise<AgentSessionInfo> {
		if (this.sessionInfo.isRunning) {
			throw new Error("SlackDaytonaRunner: session already running");
		}
		this.sessionInfo.isRunning = true;

		this.config.logger?.info(
			"[SlackDaytonaRunner] creating Daytona sandbox (setup commands install Claude Code; expect 20–60s before the first transcript event)",
		);

		const runtime = createAgentRuntime({
			sandboxProviders: {
				daytona: createComputeSdkSandboxProvider({
					compute: daytona({
						apiKey: this.daytonaConfig.daytonaApiKey,
						timeout: 300_000,
					}),
				}),
				// Universal `compute` provider stays available as a fallback,
				// though we never select it from this adapter.
				computesdk: createComputeSdkSandboxProvider({ compute }),
			},
		});

		this.session = await runtime.createSession(this.buildRuntimeConfig(prompt));
		this.config.logger?.info(
			"[SlackDaytonaRunner] sandbox created; running setup + harness",
		);

		const runPromise = this.session.start();

		// Drain transcript events on a separate microtask chain so this
		// method can resolve immediately — matching ClaudeRunner.start(),
		// which returns AgentSessionInfo before the run completes.
		void this.drainEvents(this.session);

		runPromise
			.then((result) => this.onRunComplete(result))
			.catch((error) => this.onRunError(error));

		return this.sessionInfo;
	}

	stop(): void {
		if (!this.session) return;
		void this.session.stop("user-stop");
	}

	isRunning(): boolean {
		return this.sessionInfo.isRunning;
	}

	isWarm(): boolean {
		return false;
	}

	getMessages(): AgentMessage[] {
		return [...this.messages];
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	getSessionInfo(): AgentSessionInfo {
		return this.sessionInfo;
	}

	private buildRuntimeConfig(prompt: string): CreateAgentSessionConfig {
		const volumes: RuntimeVolumeConfig[] = [
			{
				name: this.daytonaConfig.volumeId,
				mountPath: DAYTONA_MOUNT_PATH,
				subpath: subpathForSession(this.config),
				kind: "fuse",
			},
		];

		return {
			// Invoke claude by absolute path — relying on PATH would require
			// us to set `env.PATH` globally, which clobbers Daytona's default
			// path and hides `npm` from the setup commands.
			harness: { kind: "claude", command: DAYTONA_CLAUDE_BIN },
			userPrompt: prompt,
			systemPrompt: this.config.appendSystemPrompt,
			model: this.config.model,
			env: {
				// Redirect Claude's session JSONL onto the mounted volume so
				// follow-up runs that mount the same subpath can --resume it.
				CLAUDE_CONFIG_DIR: `${DAYTONA_MOUNT_PATH}/.claude`,
			},
			secrets: {
				CLAUDE_CODE_OAUTH_TOKEN: this.daytonaConfig.claudeCodeOAuthToken,
			},
			packages: {
				commands: [
					`npm config set prefix ${DAYTONA_NPM_PREFIX}`,
					"npm install -g @anthropic-ai/claude-code",
				],
			},
			permissions: {
				allowedTools: this.config.allowedTools,
				disallowedTools: this.config.disallowedTools,
			},
			mcps: convertMcpServers(this.config.mcpConfig),
			resumeHarnessSessionId: this.config.resumeSessionId,
			sandbox: {
				provider: "daytona",
				name: `slack-${Date.now()}`,
				workingDirectory: DAYTONA_WORKDIR,
				timeoutMs: 300_000,
				volumes,
			},
		};
	}

	private async drainEvents(session: AgentSession): Promise<void> {
		for await (const event of session.events) {
			this.logTranscriptEvent(event);
			const message = toSdkMessage(event.raw);
			if (!message) continue;
			this.messages.push(message);
			if (this.sessionInfo.sessionId === null && hasSessionId(message)) {
				this.sessionInfo.sessionId = message.session_id;
				this.config.logger?.info(
					`[SlackDaytonaRunner] claude session id: ${message.session_id}`,
				);
			}
			try {
				await this.config.onMessage?.(message);
			} catch (error) {
				this.config.onError?.(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	}

	/**
	 * Surface every transcript event so operators can see Daytona setup
	 * progress (setup.started / setup.completed), file materialization,
	 * and harness output — without these, the gap between "session
	 * started" and the first SDKMessage is a silent 30–60s install.
	 */
	private logTranscriptEvent(event: { kind: string; raw: unknown }): void {
		const logger = this.config.logger;
		if (!logger) return;
		const summary = summarizeRawEvent(event.raw);
		if (summary) {
			logger.info(`[SlackDaytonaRunner] event ${event.kind}: ${summary}`);
		} else {
			logger.info(`[SlackDaytonaRunner] event ${event.kind}`);
		}
	}

	private async onRunComplete(result: AgentSessionResult): Promise<void> {
		this.sessionInfo.isRunning = false;
		if (result.harnessSessionId) {
			this.sessionInfo.sessionId = result.harnessSessionId;
		}
		this.config.logger?.info(
			`[SlackDaytonaRunner] run complete success=${result.success} exitCode=${result.exitCode ?? "n/a"} events=${result.events.length} harnessSessionId=${
				result.harnessSessionId ?? "n/a"
			}`,
		);
		if (!result.success && result.error) {
			this.config.logger?.error(
				`[SlackDaytonaRunner] run reported failure: ${result.error.message}`,
				result.error,
			);
		}
		try {
			await this.config.onComplete?.([...this.messages]);
		} finally {
			await result.destroy();
			this.config.logger?.info("[SlackDaytonaRunner] sandbox destroyed");
		}
	}

	private async onRunError(error: unknown): Promise<void> {
		this.sessionInfo.isRunning = false;
		const err = error instanceof Error ? error : new Error(String(error));
		this.config.logger?.error(
			`[SlackDaytonaRunner] run threw before completion: ${err.message}`,
			err,
		);
		try {
			this.config.onError?.(err);
		} finally {
			await this.session?.destroy();
		}
	}
}

/**
 * Stable per-session subpath inside the shared Daytona volume. Uses
 * `workspaceName` (which `ChatSessionHandler` sets to the chat session id
 * — `slack-<eventId>` for the first turn, the existing session id on
 * resume) so follow-up runs land on the same JSONL transcript.
 */
function subpathForSession(config: AgentRunnerConfig): string {
	const key = config.workspaceName ?? "default";
	return `slack/${sanitize(key)}`;
}

function sanitize(segment: string): string {
	return segment.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function convertMcpServers(
	source: AgentRunnerConfig["mcpConfig"],
): Record<string, McpServerRuntimeConfig> | undefined {
	if (!source) return undefined;
	const entries = Object.entries(source).map(([name, cfg]) => {
		// McpServerConfig in cyrus-core is a discriminated union over `type`
		// (stdio / sse / http). Translate the subset the runtime currently
		// expresses; anything else falls through as a structural pass-through.
		const c = cfg as Record<string, unknown>;
		const runtimeCfg: McpServerRuntimeConfig = {};
		if (typeof c.command === "string") runtimeCfg.command = c.command;
		if (Array.isArray(c.args))
			runtimeCfg.args = c.args.filter(
				(v): v is string => typeof v === "string",
			);
		if (typeof c.url === "string") runtimeCfg.url = c.url;
		if (c.env && typeof c.env === "object") {
			runtimeCfg.env = c.env as Record<string, string>;
		}
		if (c.headers && typeof c.headers === "object") {
			runtimeCfg.headers = c.headers as Record<string, string>;
		}
		return [name, runtimeCfg] as const;
	});
	return Object.fromEntries(entries);
}

/**
 * Pull a short, log-friendly summary out of a transcript event's `raw`
 * payload. Different runtime event kinds carry different shapes (setup
 * events have `command`/`exitCode`, harness events have `type`, etc.),
 * so we cherry-pick the field most likely to be useful at-a-glance.
 */
function summarizeRawEvent(raw: unknown): string | undefined {
	if (!isRecord(raw)) {
		return typeof raw === "string" ? truncate(raw, 200) : undefined;
	}
	const command = readString(raw, "command");
	if (command) {
		const exit = raw.exitCode;
		return exit === undefined
			? truncate(command, 200)
			: `exit=${exit} ${truncate(command, 180)}`;
	}
	const type = readString(raw, "type");
	const subtype = readString(raw, "subtype");
	const message = readString(raw, "message");
	const result = readString(raw, "result");
	const path = readString(raw, "path");
	const parts: string[] = [];
	if (type) parts.push(`type=${type}`);
	if (subtype) parts.push(`subtype=${subtype}`);
	if (path) parts.push(`path=${path}`);
	if (result) parts.push(`result=${truncate(result, 160)}`);
	if (message) parts.push(`message=${truncate(message, 160)}`);
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function readString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function toSdkMessage(raw: unknown): SDKMessage | undefined {
	// Claude's stream-json output is the SDKMessage JSON serialization, so
	// the runtime's `event.raw` IS the message we want to forward — once we
	// confirm it has the discriminant. Anything else is runtime envelope
	// chatter (setup events, materialize events, etc.) and is dropped.
	if (!isRecord(raw)) return undefined;
	const type = raw.type;
	if (
		type === "system" ||
		type === "assistant" ||
		type === "user" ||
		type === "result"
	) {
		return raw as unknown as SDKMessage;
	}
	return undefined;
}

function hasSessionId(
	message: SDKMessage,
): message is SDKMessage & { session_id: string } {
	return (
		isRecord(message) &&
		typeof (message as Record<string, unknown>).session_id === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
