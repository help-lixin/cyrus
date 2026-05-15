import { randomUUID } from "node:crypto";
import { getHarnessAdapter } from "./harnesses/index.js";
import { createSandboxProvider } from "./sandbox/index.js";
import { CreateAgentSessionConfigSchema } from "./schemas.js";
import { RuntimeAgentSession } from "./session.js";
import type {
	AgentSession,
	CreateAgentSessionConfig,
	NormalizedAgentSessionConfig,
	RuntimeCallbacks,
	RuntimeHarnessConfig,
	RuntimeSecret,
	SandboxProvider,
} from "./types.js";

export interface CreateAgentRuntimeOptions {
	callbacks?: RuntimeCallbacks;
	sandboxProviders?: Record<string, SandboxProvider>;
}

export class AgentRuntime {
	constructor(private readonly options: CreateAgentRuntimeOptions = {}) {}

	async createSession(config: CreateAgentSessionConfig): Promise<AgentSession> {
		const normalized = normalizeConfig(config);
		const adapter = getHarnessAdapter(normalized.harness.kind);
		const provider =
			this.options.sandboxProviders?.[normalized.sandbox.provider] ??
			createSandboxProvider(normalized.sandbox.provider);
		const sandbox = await provider.create(normalized.sandbox);
		return new RuntimeAgentSession(
			normalized,
			adapter,
			sandbox,
			this.options.callbacks,
		);
	}
}

export function createAgentRuntime(
	options?: CreateAgentRuntimeOptions,
): AgentRuntime {
	return new AgentRuntime(options);
}

export async function createAgentSession(
	config: CreateAgentSessionConfig,
	options?: CreateAgentRuntimeOptions,
): Promise<AgentSession> {
	return createAgentRuntime(options).createSession(config);
}

export function normalizeConfig(
	config: CreateAgentSessionConfig,
): NormalizedAgentSessionConfig {
	const parsed = CreateAgentSessionConfigSchema.parse(
		config,
	) as CreateAgentSessionConfig;
	const harness = normalizeHarness(parsed.harness, parsed.model);
	const secrets = normalizeSecrets(parsed.secrets ?? {});
	return {
		...parsed,
		sessionId: parsed.sessionId ?? randomUUID(),
		harness,
		model: harness.model ?? parsed.model,
		env: parsed.env ?? {},
		secrets,
		sandbox: parsed.sandbox ?? {
			provider: "local",
			workingDirectory: process.cwd(),
		},
	};
}

function normalizeHarness(
	harness: CreateAgentSessionConfig["harness"],
	model?: string,
): RuntimeHarnessConfig {
	if (typeof harness === "string") {
		return { kind: harness, model };
	}
	return {
		...harness,
		model: harness.model ?? model,
	};
}

function normalizeSecrets(
	secrets: Record<string, RuntimeSecret | string>,
): Record<string, RuntimeSecret> {
	return Object.fromEntries(
		Object.entries(secrets).map(([key, secret]) => [
			key,
			typeof secret === "string" ? { value: secret, redact: true } : secret,
		]),
	);
}
