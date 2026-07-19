import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type {
	AssistantMessage,
	Event,
	McpLocalConfig,
	McpRemoteConfig,
	OpencodeClient,
	TextPart,
	ToolPart,
} from "@opencode-ai/sdk";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import { createLogger } from "cyrus-core";
import { OpenCodeMessageFormatter } from "./formatter.js";
import { getOpenCodeServerManager } from "./OpenCodeServerManager.js";
import {
	buildDefaultRuleset,
	buildDefaultToolsMap,
	buildToolsMap,
	evaluatePermission,
	translatePatterns,
	translateToolName,
} from "./permissions.js";
import type {
	OpenCodeRunnerConfig,
	OpenCodeRunnerEvents,
	OpenCodeSessionInfo,
} from "./types.js";

type ToolInput = Record<string, unknown>;

interface OpenCodeTokenTotals {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

interface PendingPermission {
	id: string;
	sessionID: string;
}

type SDKSystemInitMessage = Extract<
	SDKMessage,
	{ type: "system"; subtype: "init" }
>;

function toFiniteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseModelString(model: string): {
	providerID: string;
	modelID: string;
} | null {
	const slashIndex = model.indexOf("/");
	if (slashIndex < 0) {
		return null;
	}
	return {
		providerID: model.slice(0, slashIndex),
		modelID: model.slice(slashIndex + 1),
	};
}

function createAssistantToolUseMessage(
	toolUseId: string,
	toolName: string,
	toolInput: ToolInput,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{ type: "tool_use", id: toolUseId, name: toolName, input: toolInput },
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		content: contentBlocks,
		model: "opencode-agent",
		stop_reason: null,
		stop_sequence: null,
		stop_details: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		} as unknown as SDKAssistantMessage["message"]["usage"],
		container: null,
		context_management: null,
		diagnostics: null,
	};
}

function createAssistantTextMessage(
	content: string,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{ type: "text", text: content },
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		content: contentBlocks,
		model: "opencode-agent",
		stop_reason: null,
		stop_sequence: null,
		stop_details: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		} as unknown as SDKAssistantMessage["message"]["usage"],
		container: null,
		context_management: null,
		diagnostics: null,
	};
}

function createUserToolResultMessage(
	toolUseId: string,
	result: string,
	isError: boolean,
): SDKUserMessage["message"] {
	const contentBlocks = [
		{
			type: "tool_result",
			tool_use_id: toolUseId,
			content: result,
			is_error: isError,
		},
	] as unknown as SDKUserMessage["message"]["content"];

	return { role: "user", content: contentBlocks };
}

function mapCyrusMcpToOpenCode(
	mcpConfig: OpenCodeRunnerConfig["mcpConfig"],
): Record<string, McpLocalConfig | McpRemoteConfig> {
	const servers: Record<string, McpLocalConfig | McpRemoteConfig> = {};
	if (!mcpConfig) {
		return servers;
	}

	for (const [name, raw] of Object.entries(mcpConfig)) {
		const cfg = raw as Record<string, unknown>;

		if (
			typeof cfg.listTools === "function" ||
			typeof cfg.callTool === "function"
		) {
			continue;
		}

		if (typeof cfg.url === "string" && cfg.url.length > 0) {
			const headers =
				cfg.headers &&
				typeof cfg.headers === "object" &&
				!Array.isArray(cfg.headers)
					? (cfg.headers as Record<string, string>)
					: undefined;
			servers[name] = {
				type: "remote",
				url: cfg.url,
				...(headers ? { headers } : {}),
			};
			continue;
		}

		if (typeof cfg.command === "string" && cfg.command.length > 0) {
			const args = Array.isArray(cfg.args) ? (cfg.args as string[]) : undefined;
			const env =
				cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)
					? (cfg.env as Record<string, string>)
					: undefined;
			servers[name] = {
				type: "local",
				command: [cfg.command, ...(args || [])],
				...(env ? { environment: env } : {}),
			};
		}
	}

	return servers;
}

function translateOpenCodeToolName(
	opencodeToolName: string,
	input: ToolInput,
	mcpServerNames: string[],
): { toolName: string; toolInput: ToolInput } {
	const lowerName = opencodeToolName.toLowerCase();

	if (lowerName === "bash" || lowerName === "shell") {
		const command =
			typeof input.command === "string"
				? input.command
				: typeof input.value === "string"
					? input.value
					: "";
		return { toolName: "Bash", toolInput: { command, description: command } };
	}

	if (lowerName === "read") {
		const path =
			typeof input.path === "string"
				? input.path
				: typeof input.file_path === "string"
					? input.file_path
					: typeof input.filePath === "string"
						? input.filePath
						: "";
		return {
			toolName: "Read",
			toolInput: { file_path: path, offset: input.offset, limit: input.limit },
		};
	}

	if (lowerName === "edit" || lowerName === "write" || lowerName === "delete") {
		const path =
			typeof input.path === "string"
				? input.path
				: typeof input.file_path === "string"
					? input.file_path
					: "";
		return {
			toolName:
				lowerName === "delete"
					? "Edit"
					: lowerName === "write"
						? "Write"
						: "Edit",
			toolInput: { file_path: path },
		};
	}

	if (lowerName === "glob") {
		const pattern =
			typeof input.pattern === "string"
				? input.pattern
				: typeof input.globPattern === "string"
					? input.globPattern
					: "*";
		return {
			toolName: "Glob",
			toolInput: {
				pattern,
				path:
					typeof input.targetDirectory === "string"
						? input.targetDirectory
						: undefined,
			},
		};
	}

	if (lowerName === "grep") {
		return {
			toolName: "Grep",
			toolInput: {
				pattern: typeof input.pattern === "string" ? input.pattern : "",
				path: typeof input.path === "string" ? input.path : undefined,
			},
		};
	}

	if (lowerName === "web_fetch" || lowerName === "webfetch") {
		return {
			toolName: "WebFetch",
			toolInput: { url: typeof input.url === "string" ? input.url : "" },
		};
	}

	if (lowerName === "web_search" || lowerName === "websearch") {
		return {
			toolName: "WebSearch",
			toolInput: { query: typeof input.query === "string" ? input.query : "" },
		};
	}

	if (lowerName === "update_todos" || lowerName === "updatetodos") {
		return { toolName: "TodoWrite", toolInput: { todos: input.todos } };
	}

	if (lowerName === "lsp") {
		return { toolName: "Lsp", toolInput: input };
	}

	if (lowerName === "skill") {
		return {
			toolName: "Skill",
			toolInput: {
				name: typeof input.name === "string" ? input.name : "",
				...input,
			},
		};
	}

	if (lowerName === "task") {
		return { toolName: "Task", toolInput: input };
	}

	if (lowerName === "patch") {
		return { toolName: "Patch", toolInput: input };
	}

	if (lowerName === "question") {
		return { toolName: "Question", toolInput: input };
	}

	for (const serverName of mcpServerNames) {
		const prefix = `${serverName}_`;
		if (lowerName.startsWith(prefix)) {
			const toolName = lowerName.slice(prefix.length);
			return {
				toolName: `mcp__${serverName}__${toolName}`,
				toolInput:
					input.args && typeof input.args === "object"
						? (input.args as ToolInput)
						: {},
			};
		}
	}

	const parts = opencodeToolName.split("_");
	if (parts.length >= 2) {
		const potentialServer = parts[0];
		const potentialTool = parts.slice(1).join("_");
		if (potentialServer && mcpServerNames.includes(potentialServer)) {
			return {
				toolName: `mcp__${potentialServer}__${potentialTool}`,
				toolInput:
					input.args && typeof input.args === "object"
						? (input.args as ToolInput)
						: {},
			};
		}
	}

	return { toolName: translateToolName(opencodeToolName), toolInput: input };
}

export declare interface OpenCodeRunner {
	on<K extends keyof OpenCodeRunnerEvents>(
		event: K,
		listener: OpenCodeRunnerEvents[K],
	): this;
	emit<K extends keyof OpenCodeRunnerEvents>(
		event: K,
		...args: Parameters<OpenCodeRunnerEvents[K]>
	): boolean;
}

export class OpenCodeRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;

	private config: OpenCodeRunnerConfig;
	private logger: ReturnType<typeof createLogger>;
	private sessionInfo: OpenCodeSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;
	private client: OpencodeClient | null = null;
	private currentSessionId: string | null = null;
	private pendingResultMessage: SDKResultMessage | null = null;
	private hasInitMessage = false;
	private lastAssistantText: string | null = null;
	private assistantTextBuffer = "";
	private tokenTotals: OpenCodeTokenTotals = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	private totalCost = 0;
	private startTimestampMs = 0;
	private errorMessages: string[] = [];
	private emittedToolUseIds = new Set<string>();
	private logStream: ReturnType<typeof createWriteStream> | null = null;
	private pendingPermissions: PendingPermission[] = [];
	private ruleset = translatePatterns();
	private mcpServerNames: string[] = [];
	private abortController: AbortController | null = null;
	private isSessionIdle = false;

	constructor(config: OpenCodeRunnerConfig) {
		super();
		this.config = config;
		this.logger = createLogger({ component: "OpenCodeRunner" });
		this.formatter = new OpenCodeMessageFormatter();

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<OpenCodeSessionInfo> {
		if (this.isRunning()) {
			throw new Error("OpenCode session already running");
		}

		const initialSessionId = this.config.resumeSessionId || crypto.randomUUID();
		this.sessionInfo = {
			sessionId: initialSessionId,
			startedAt: new Date(),
			isRunning: true,
		};

		const isResumed = !!this.config.resumeSessionId;
		this.logger.event(isResumed ? "session_resumed" : "session_started", {
			resumeSessionId: this.config.resumeSessionId,
			workingDirectory: this.config.workingDirectory,
			opencodeSessionId: this.sessionInfo?.sessionId,
		});

		this.messages = [];
		this.pendingResultMessage = null;
		this.hasInitMessage = false;
		this.lastAssistantText = null;
		this.assistantTextBuffer = "";
		this.tokenTotals = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
		this.totalCost = 0;
		this.startTimestampMs = Date.now();
		this.errorMessages = [];
		this.emittedToolUseIds.clear();
		this.pendingPermissions = [];
		this.isSessionIdle = false;
		this.setupLogging();

		const workspace = resolve(this.config.workingDirectory || cwd());

		try {
			if (process.env.CYRUS_OPENCODE_MOCK === "1") {
				return this.runMockSession(prompt);
			}

			const { createOpencodeClient } = await import("@opencode-ai/sdk");
			const serverManager = getOpenCodeServerManager();
			const { url } = await serverManager.acquire();

			this.client = createOpencodeClient({
				baseUrl: url,
				directory: workspace,
			});

			const mcpServers = mapCyrusMcpToOpenCode(this.config.mcpConfig);
			this.mcpServerNames = Object.keys(mcpServers);

			for (const [name, serverConfig] of Object.entries(mcpServers)) {
				try {
					await this.client.mcp.add({ body: { name, config: serverConfig } });

					// 尝试连接 MCP 服务器
					try {
						await this.client.mcp.connect({ path: { name } });
					} catch (connectError) {
						this.logger.warn(
							`MCP server '${name}' connect failed: ${connectError}`,
						);
					}
				} catch (error) {
					this.logger.error(`Failed to add MCP server '${name}': ${error}`);
				}
			}

			// 验证 MCP 服务器状态
			try {
				await this.client.mcp.status({});
			} catch (statusError) {
				this.logger.warn(`Failed to get MCP server status: ${statusError}`);
			}

			this.ruleset =
				!this.config.allowedTools || this.config.allowedTools.length === 0
					? buildDefaultRuleset()
					: translatePatterns(
							this.config.allowedTools,
							this.config.disallowedTools,
						);
			this.logger.debug(
				`ruleset built: allow=${JSON.stringify(this.ruleset.allow)}, deny=${JSON.stringify(this.ruleset.deny)}`,
			);
			this.logger.debug(
				`ruleset built: allow=${JSON.stringify(this.ruleset.allow)}, deny=${JSON.stringify(this.ruleset.deny)}`,
			);

			if (this.config.resumeSessionId) {
				try {
					await this.client.session.get({
						path: { id: this.config.resumeSessionId },
					});
					this.currentSessionId = this.config.resumeSessionId;
				} catch {
					this.currentSessionId = null;
				}
			}

			if (!this.currentSessionId) {
				const sessionResponse = await this.client.session.create({});
				this.currentSessionId = sessionResponse.data?.id ?? null;
				if (!this.currentSessionId) {
					throw new Error("Failed to create session: no session ID returned");
				}
			}

			if (this.sessionInfo) {
				this.sessionInfo.sessionId = this.currentSessionId;
			}

			if (this.currentSessionId) {
				this.logger.event("opencode_session_id_assigned", {
					opencodeSessionId: this.currentSessionId,
				});
			}

			this.emitInitMessage();

			this.abortController = new AbortController();

			const eventPromise = this.subscribeToEvents();

			const modelParsed = parseModelString(this.config.model || "");
			const tools =
				!this.config.allowedTools || this.config.allowedTools.length === 0
					? buildDefaultToolsMap(this.mcpServerNames)
					: buildToolsMap(
							this.config.allowedTools,
							this.config.disallowedTools,
							this.mcpServerNames,
						);

			const body: Record<string, unknown> = {
				parts: [{ type: "text", text: prompt }],
				model: modelParsed || undefined,
				system: this.config.appendSystemPrompt || undefined,
				tools,
			};

			await this.client.session.promptAsync({
				path: { id: this.currentSessionId },
				body: body as Parameters<
					typeof this.client.session.promptAsync
				>[0]["body"],
			});

			await eventPromise;
		} catch (error) {
			this.finalizeSession(error);
		}

		return this.sessionInfo!;
	}

	private async runMockSession(_prompt: string): Promise<OpenCodeSessionInfo> {
		this.emitInitMessage();
		this.pushAssistantText("OpenCode mock session started");
		this.pendingResultMessage = this.createSuccessResultMessage(
			"OpenCode mock session completed",
		);
		this.finalizeSession();
		return this.sessionInfo!;
	}

	private async subscribeToEvents(): Promise<void> {
		if (!this.client || !this.currentSessionId) return;

		const signal = this.abortController?.signal;
		if (!signal) return;

		const EVENT_TIMEOUT_MS = 120_000;

		try {
			const response = await this.client.event.subscribe(
				{} as Parameters<typeof this.client.event.subscribe>[0],
			);
			const stream = response.stream;

			let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

			const resetTimeout = () => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				timeoutHandle = setTimeout(() => {
					if (!signal.aborted && !this.isSessionIdle) {
						this.logger.error(
							`No events received for ${EVENT_TIMEOUT_MS}ms, aborting SSE connection`,
						);
						this.abortController?.abort();
					}
				}, EVENT_TIMEOUT_MS);
			};

			resetTimeout();

			try {
				for await (const eventData of stream) {
					if (signal.aborted || this.isSessionIdle) break;

					resetTimeout();

					try {
						// event.subscribe() returns Event objects directly via SSE
						this.handleEvent(eventData as Event);
					} catch (err) {
						this.logger.error(`Error handling event: ${err}`);
					}
				}
			} catch (streamError) {
				if (!this.isSessionIdle && !signal.aborted) {
					this.logger.error(`Stream error: ${streamError}`);
				}
			} finally {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				if (stream && typeof stream.return === "function") {
					await stream.return(undefined);
				}
			}
		} catch (error) {
			if (!this.isSessionIdle) {
				this.logger.error(`Event subscription error: ${error}`);
			}
		}
	}

	private handleEvent(event: Event): void {
		this.logger.debug(`handleEvent: ${event.type}`);

		switch (event.type) {
			case "session.idle":
				this.isSessionIdle = true;
				this.finalizeSession();
				break;

			case "session.error":
				this.logger.warn(`Session error: ${JSON.stringify(event.properties)}`);
				if (event.properties.error) {
					const errorMsg =
						typeof event.properties.error === "object" &&
						"data" in event.properties.error
							? (event.properties.error as { data?: { message?: string } }).data
									?.message
							: String(event.properties.error);
					this.errorMessages.push(errorMsg || "Session error");
				}
				break;

			case "session.status":
				this.logger.debug(
					`Session status: ${JSON.stringify(event.properties)}`,
				);
				break;

			case "session.compacted":
				this.emitSystemActivity("Session auto-compacting context");
				break;

			case "permission.asked" as Event["type"]:
			case "permission.updated": {
				const permission = event.properties as {
					id: string;
					sessionID: string;
					type?: string;
					permission?: string;
					pattern?: string | string[];
				};

				const toolName = permission.type || permission.permission || "unknown";
				const patternRaw = permission.pattern;
				const pattern =
					typeof patternRaw === "string"
						? patternRaw
						: Array.isArray(patternRaw)
							? patternRaw[0]
							: undefined;
				const decision = evaluatePermission(this.ruleset, toolName, pattern);

				if (this.client && this.currentSessionId) {
					this.pendingPermissions.push({
						id: permission.id,
						sessionID: permission.sessionID,
					});
					const response = decision === "once" ? "once" : "reject";
					this.client
						.postSessionIdPermissionsPermissionId({
							path: {
								id: this.currentSessionId,
								permissionID: permission.id,
							},
							body: { response: response as "once" | "always" | "reject" },
						} as unknown as Parameters<
							typeof this.client.postSessionIdPermissionsPermissionId
						>[0])
						.catch((err: unknown) =>
							this.logger.warn(`Permission response failed: ${err}`),
						);
				}
				break;
			}

			case "message.updated":
				if (event.properties.info.role === "assistant") {
					const assistantMsg = event.properties.info as AssistantMessage;
					if (assistantMsg.tokens) {
						this.tokenTotals.inputTokens += toFiniteNumber(
							assistantMsg.tokens.input,
						);
						this.tokenTotals.outputTokens += toFiniteNumber(
							assistantMsg.tokens.output,
						);
						this.tokenTotals.cacheReadTokens += toFiniteNumber(
							assistantMsg.tokens.cache?.read,
						);
						this.tokenTotals.cacheWriteTokens += toFiniteNumber(
							assistantMsg.tokens.cache?.write,
						);
					}
					this.totalCost += toFiniteNumber(assistantMsg.cost);
				}
				break;

			case "message.part.updated": {
				const part = event.properties.part;
				if (part.type === "text") {
					const textPart = part as TextPart;
					this.assistantTextBuffer += textPart.text;
				} else if (part.type === "tool") {
					this.flushAssistantTextBuffer();
					void this.handleToolPart(part as ToolPart);
				} else if (part.type === "compaction") {
					this.emitSystemActivity("Session auto-compacting context");
				}
				break;
			}

			case "permission.replied": {
				const { permissionID } = event.properties;
				this.pendingPermissions = this.pendingPermissions.filter(
					(p) => p.id !== permissionID,
				);
				break;
			}

			default:
				this.logger.debug(`Unhandled event type: ${event.type}`);
				break;
		}
	}

	private async handleToolPart(part: ToolPart): Promise<void> {
		const { id: partId, tool: toolName, state } = part;

		if (state.status === "running") {
			const { toolName: translatedName, toolInput } = translateOpenCodeToolName(
				toolName,
				(state as { input?: ToolInput }).input || {},
				this.mcpServerNames,
			);

			if (!this.emittedToolUseIds.has(partId)) {
				this.emittedToolUseIds.add(partId);
				this.emitToolUse({
					toolUseId: partId,
					toolName: translatedName,
					toolInput,
					result: "",
					isError: false,
				});
			}
		} else {
			const input = (state as { input?: ToolInput }).input || {};
			const { toolName: translatedName, toolInput } = translateOpenCodeToolName(
				toolName,
				input,
				this.mcpServerNames,
			);

			let resultText = "Tool completed";
			let isError = false;

			if (state.status === "completed") {
				if (translatedName === "Skill") {
					const skillName = typeof input.name === "string" ? input.name : "";
					const skillResult = await this.executeSkill(skillName);
					resultText =
						skillResult.output || `Skill '${skillName}' executed successfully`;
					if (skillResult.error) {
						resultText = skillResult.error;
						isError = true;
					}
				} else {
					resultText =
						(state as { output?: string }).output || "Tool completed";
				}
			} else if (state.status === "error") {
				resultText = (state as { error?: string }).error || "Tool failed";
				isError = true;
			}

			this.emitToolUse({
				toolUseId: partId,
				toolName: translatedName,
				toolInput,
				result: resultText,
				isError,
			});
		}
	}

	async startStreaming(_initialPrompt?: string): Promise<OpenCodeSessionInfo> {
		throw new Error("OpenCodeRunner does not support streaming input");
	}

	addStreamMessage(_content: string): void {
		throw new Error("OpenCodeRunner does not support streaming input messages");
	}

	completeStream(): void {}

	stop(): void {
		this.isSessionIdle = true;

		this.logger.event("session_stop_requested", {
			opencodeSessionId: this.sessionInfo?.sessionId,
		});

		if (this.client && this.currentSessionId) {
			this.client.session
				.abort({ path: { id: this.currentSessionId } } as Parameters<
					typeof this.client.session.abort
				>[0])
				.catch(() => {});

			for (const pending of this.pendingPermissions) {
				if (pending.sessionID === this.currentSessionId) {
					this.client
						.postSessionIdPermissionsPermissionId({
							path: {
								id: this.currentSessionId,
								permissionID: pending.id,
							},
							body: { response: "reject" as const },
						} as unknown as Parameters<
							typeof this.client.postSessionIdPermissionsPermissionId
						>[0])
						.catch(() => {});
				}
			}
		}

		if (this.abortController) {
			this.abortController.abort();
		}

		this.logger.event("session_stopped", {
			reason: "user_abort",
			opencodeSessionId: this.sessionInfo?.sessionId,
		});

		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		const serverManager = getOpenCodeServerManager();
		serverManager.release();
	}

	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	getMessages(): SDKMessage[] {
		return [...this.messages];
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	private emitToolUse(projection: {
		toolUseId: string;
		toolName: string;
		toolInput: ToolInput;
		result: string;
		isError: boolean;
	}): void {
		const message: SDKAssistantMessage = {
			type: "assistant",
			message: createAssistantToolUseMessage(
				projection.toolUseId,
				projection.toolName,
				projection.toolInput,
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);

		if (projection.result) {
			this.emitToolResult(projection);
		}
	}

	private emitToolResult(projection: {
		toolUseId: string;
		result: string;
		isError: boolean;
	}): void {
		const message: SDKUserMessage = {
			type: "user",
			message: createUserToolResultMessage(
				projection.toolUseId,
				projection.result || "Tool completed",
				projection.isError,
			),
			parent_tool_use_id: projection.toolUseId,
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private async executeSkill(
		skillName: string,
	): Promise<{ output?: string; error?: string }> {
		console.log(`[DEBUG executeSkill] Loading skill: ${skillName}`);

		const plugins = this.config.plugins || [];
		const searchPaths: string[] = [];

		for (const plugin of plugins) {
			if (plugin.type === "local" && plugin.path) {
				searchPaths.push(resolve(plugin.path));
			}
		}

		searchPaths.push(resolve(this.config.cyrusHome, "user-skills-plugin"));
		searchPaths.push(resolve(this.config.cyrusHome, "cyrus-skills-plugin"));

		for (const basePath of searchPaths) {
			const skillPath = join(basePath, skillName, "SKILL.md");
			console.log(`[DEBUG executeSkill] Checking: ${skillPath}`);
			if (existsSync(skillPath)) {
				try {
					const content = readFileSync(skillPath, "utf-8");
					console.log(`[DEBUG executeSkill] Loaded skill from: ${skillPath}`);
					return { output: content };
				} catch (error) {
					console.log(
						`[DEBUG executeSkill] Failed to read: ${skillPath}, error: ${error}`,
					);
					return { error: `Failed to read skill file: ${error}` };
				}
			}
		}

		const searchPathsStr = searchPaths.join(", ");
		console.log(
			`[DEBUG executeSkill] Skill not found: ${skillName} in [${searchPathsStr}]`,
		);
		return { error: `Skill '${skillName}' not found in any plugin directory` };
	}

	private pushAssistantText(text: string): void {
		const message: SDKAssistantMessage = {
			type: "assistant",
			message: createAssistantTextMessage(text),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private flushAssistantTextBuffer(): void {
		const text = this.assistantTextBuffer;
		this.assistantTextBuffer = "";
		if (text.trim().length === 0) return;
		this.lastAssistantText = text;
		this.pushAssistantText(text);
	}

	private emitInitMessage(): void {
		if (this.hasInitMessage) return;
		this.hasInitMessage = true;
		const sessionId = this.sessionInfo?.sessionId || crypto.randomUUID();

		const skills: string[] =
			this.config.skills === "all" || this.config.skills === undefined
				? []
				: this.config.skills;

		const plugins: { name: string; path: string }[] =
			this.config.plugins?.map((p) => ({ name: p.path, path: p.path })) || [];

		const initMessage: SDKSystemInitMessage = {
			type: "system",
			subtype: "init",
			cwd: this.config.workingDirectory || cwd(),
			session_id: sessionId,
			tools: this.config.allowedTools || [],
			mcp_servers: [],
			model: this.config.model || "opencode",
			permissionMode: "default",
			apiKeySource: "project",
			claude_code_version: "opencode-agent",
			slash_commands: [],
			output_style: "default",
			skills,
			plugins,
			uuid: crypto.randomUUID(),
			agents: undefined,
		};
		this.pushMessage(initMessage);
	}

	private emitSystemActivity(_content: string): void {
		const systemMessage = {
			type: "system" as const,
			subtype: "status" as const,
			session_id: this.sessionInfo?.sessionId || "pending",
			uuid: crypto.randomUUID(),
		};
		this.pushMessage(systemMessage as unknown as SDKMessage);
	}

	private createSuccessResultMessage(result: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "success",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: false,
			num_turns: 1,
			result,
			stop_reason: null,
			total_cost_usd: this.totalCost,
			usage: {
				input_tokens: this.tokenTotals.inputTokens,
				output_tokens: this.tokenTotals.outputTokens,
				cache_creation_input_tokens: this.tokenTotals.cacheWriteTokens,
				cache_read_input_tokens: this.tokenTotals.cacheReadTokens,
			} as unknown as SDKResultMessage["usage"],
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private createErrorResultMessage(errorMessage: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "error_during_execution",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: true,
			num_turns: 1,
			errors: [errorMessage],
			stop_reason: null,
			total_cost_usd: this.totalCost,
			usage: {
				input_tokens: this.tokenTotals.inputTokens,
				output_tokens: this.tokenTotals.outputTokens,
				cache_creation_input_tokens: this.tokenTotals.cacheWriteTokens,
				cache_read_input_tokens: this.tokenTotals.cacheReadTokens,
			} as unknown as SDKResultMessage["usage"],
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private pushMessage(message: SDKMessage): void {
		this.messages.push(message);

		// Log to detailed JSON log
		if (this.logStream) {
			const logEntry = {
				type: "sdk-message",
				message,
				timestamp: new Date().toISOString(),
			};
			this.logStream.write(`${JSON.stringify(logEntry)}\n`);
		}

		this.emit("message", message);

		this.logger.event("message_emitted", {
			messageType: message.type,
			opencodeSessionId: this.sessionInfo?.sessionId,
		});
	}

	private setupLogging(): void {
		try {
			const logsDir = join(this.config.cyrusHome, "logs");
			const workspaceName =
				this.config.workspaceName ||
				(this.config.workingDirectory
					? this.config.workingDirectory.split("/").pop()
					: "default") ||
				"default";
			const workspaceLogsDir = join(logsDir, workspaceName);
			mkdirSync(workspaceLogsDir, { recursive: true });

			const sessionId = this.sessionInfo?.sessionId || "pending";
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const detailedLogFileName = `session-${sessionId}-${timestamp}.jsonl`;
			const detailedLogPath = join(workspaceLogsDir, detailedLogFileName);

			const stream = createWriteStream(detailedLogPath, { flags: "a" });
			stream.on("error", () => {});
			this.logStream = stream;
		} catch {
			this.logStream = null;
		}
	}

	private finalizeSession(error?: unknown): void {
		if (!this.sessionInfo) return;

		this.emitInitMessage();
		this.flushAssistantTextBuffer();
		this.sessionInfo.isRunning = false;

		let resultMessage: SDKResultMessage;
		if (this.pendingResultMessage) {
			resultMessage = this.pendingResultMessage;
		} else if (error || this.errorMessages.length > 0) {
			const message =
				normalizeError(error) ||
				this.errorMessages.at(-1) ||
				"OpenCode execution failed";
			resultMessage = this.createErrorResultMessage(message);
		} else {
			resultMessage = this.createSuccessResultMessage(
				this.lastAssistantText || "OpenCode session completed successfully",
			);
		}

		this.pushMessage(resultMessage);
		this.emit("complete", [...this.messages]);

		this.logger.event("session_completed", {
			messageCount: this.messages.length,
			opencodeSessionId: this.sessionInfo?.sessionId,
		});

		if (error || this.errorMessages.length > 0) {
			const err =
				error instanceof Error
					? error
					: new Error(this.errorMessages.at(-1) || "OpenCode execution failed");
			this.emit("error", err);

			this.logger.event("session_stopped", {
				reason: "user_abort",
				opencodeSessionId: this.sessionInfo?.sessionId,
			});
		}

		this.cleanupRuntimeState();
	}

	private cleanupRuntimeState(): void {
		if (this.logStream) {
			try {
				this.logStream.end();
			} catch {}
			this.logStream = null;
		}

		this.abortController = null;
		this.client = null;

		const serverManager = getOpenCodeServerManager();
		serverManager.release();
	}
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "OpenCode execution failed";
}
