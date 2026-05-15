export type HarnessKind =
	| "claude"
	| "codex"
	| "cursor"
	| "gemini"
	| "pi"
	| "opencode";

export type PermissionMode = "default" | "plan" | "ask" | "auto" | "bypass";

export type NetworkEgressMode =
	| "default"
	| "disabled"
	| "proxied"
	| "unrestricted";

export interface RuntimeSecret {
	value: string;
	redact?: boolean;
}

export interface McpServerRuntimeConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	httpUrl?: string;
	headers?: Record<string, string>;
}

export interface RuntimeMemoryConfig {
	enabled?: boolean;
	directory?: string;
	namespace?: string;
}

export interface RuntimePackageConfig {
	system?: string[];
	npm?: string[];
	commands?: string[];
}

export interface RuntimeFileConfig {
	path: string;
	content: string;
	sensitive?: boolean;
}

export interface RuntimeVolumeConfig {
	name: string;
	mountPath: string;
	source?: string;
	kind?: "bind" | "fuse" | "provider";
	readOnly?: boolean;
}

export interface RuntimeNetworkEgressConfig {
	mode: NetworkEgressMode;
	proxyUrl?: string;
	allowedHosts?: string[];
	deniedHosts?: string[];
}

export interface RuntimeSandboxConfig {
	provider: "local" | string;
	id?: string;
	name?: string;
	namespace?: string;
	workingDirectory?: string;
	templateId?: string;
	timeoutMs?: number;
	metadata?: Record<string, unknown>;
	volumes?: RuntimeVolumeConfig[];
	networkEgress?: RuntimeNetworkEgressConfig;
}

export interface RuntimeHarnessConfig {
	kind: HarnessKind;
	model?: string;
	command?: string;
	args?: string[];
}

export interface RuntimePermissionConfig {
	mode?: PermissionMode;
	allowedTools?: string[];
	disallowedTools?: string[];
}

export interface CreateAgentSessionConfig {
	sessionId?: string;
	harness: HarnessKind | RuntimeHarnessConfig;
	model?: string;
	systemPrompt?: string;
	userPrompt: string;
	env?: Record<string, string>;
	secrets?: Record<string, RuntimeSecret | string>;
	packages?: RuntimePackageConfig;
	files?: RuntimeFileConfig[];
	mcps?: Record<string, McpServerRuntimeConfig>;
	permissions?: RuntimePermissionConfig;
	memory?: RuntimeMemoryConfig;
	sandbox?: RuntimeSandboxConfig;
	networkEgress?: RuntimeNetworkEgressConfig;
	metadata?: Record<string, unknown>;
}

export interface TranscriptEvent {
	sessionId: string;
	harness: HarnessKind;
	timestamp: string;
	kind: string;
	raw: unknown;
	normalized?: unknown;
	metadata?: Record<string, unknown>;
}

export interface HarnessCommand {
	command: string;
	args: string[];
	env?: Record<string, string>;
	stdin?: string;
}

export interface HarnessAdapter {
	readonly kind: HarnessKind;
	buildCommand(config: NormalizedAgentSessionConfig): HarnessCommand;
	parseStdoutLine(
		line: string,
		context: TranscriptParseContext,
	): TranscriptEvent | undefined;
	parseStderrLine?(
		line: string,
		context: TranscriptParseContext,
	): TranscriptEvent | undefined;
	extractResult?(events: TranscriptEvent[]): string | undefined;
}

export interface TranscriptParseContext {
	sessionId: string;
	harness: HarnessKind;
	now?: () => Date;
}

export interface CommandExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	durationMs: number;
}

export interface SandboxFileEntry {
	name: string;
	type: "file" | "directory";
	size?: number;
	modified?: Date;
}

export interface SandboxFilesystem {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	readdir(path: string): Promise<SandboxFileEntry[]>;
	mkdir(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	remove(path: string): Promise<void>;
}

export interface SandboxRunCommandOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeout?: number;
	background?: boolean;
}

export interface RunnerSandboxCapabilities {
	filesystem: boolean;
	runCommand: boolean;
	streamingProcess: boolean;
	snapshots?: boolean;
	ports?: boolean;
	volumes?: boolean;
	networkEgress?: boolean;
}

export interface RunnerSandbox {
	readonly sandboxId: string;
	readonly provider: string;
	readonly workingDirectory?: string;
	readonly capabilities: RunnerSandboxCapabilities;
	readonly filesystem: SandboxFilesystem;
	runCommand(
		command: string,
		options?: SandboxRunCommandOptions,
	): Promise<CommandExecutionResult>;
	destroy(): Promise<void>;
}

export interface SandboxProvider {
	readonly provider: string;
	create(config: RuntimeSandboxConfig): Promise<RunnerSandbox>;
}

export interface PermissionPromptRequest {
	sessionId: string;
	harness: HarnessKind;
	toolName: string;
	input: unknown;
	reason?: string;
}

export interface PermissionPromptResponse {
	allowed: boolean;
	reason?: string;
}

export interface RuntimeCallbacks {
	onPermissionPrompt?: (
		request: PermissionPromptRequest,
	) => Promise<PermissionPromptResponse> | PermissionPromptResponse;
	onTranscriptEvent?: (event: TranscriptEvent) => Promise<void> | void;
}

export interface AgentSessionResult {
	sessionId: string;
	harness: HarnessKind;
	success: boolean;
	exitCode?: number;
	result?: string;
	error?: Error;
	events: TranscriptEvent[];
}

export interface NormalizedAgentSessionConfig
	extends Omit<CreateAgentSessionConfig, "harness" | "secrets" | "sandbox"> {
	sessionId: string;
	harness: RuntimeHarnessConfig;
	model?: string;
	env: Record<string, string>;
	secrets: Record<string, RuntimeSecret>;
	sandbox: RuntimeSandboxConfig;
}

export interface AgentSession {
	readonly sessionId: string;
	readonly harness: HarnessKind;
	readonly events: AsyncIterable<TranscriptEvent>;
	start(): Promise<AgentSessionResult>;
	addMessage(message: string): Promise<void>;
	interrupt(reason?: string): Promise<void>;
	stop(reason?: string): Promise<void>;
}
