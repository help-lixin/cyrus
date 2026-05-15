import { spawn } from "node:child_process";
import {
	access,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
	CommandExecutionResult,
	RunnerSandbox,
	RunnerSandboxCapabilities,
	RuntimeSandboxConfig,
	SandboxFileEntry,
	SandboxFilesystem,
	SandboxProvider,
	SandboxRunCommandOptions,
} from "../types.js";

export const UNSUPPORTED_STREAMING_PROCESS_REASON =
	"Streaming processes are unsupported until provider-specific APIs are available.";

export const DEFAULT_RUNNER_SANDBOX_CAPABILITIES: RunnerSandboxCapabilities = {
	filesystem: true,
	runCommand: true,
	streamingProcess: false,
};

export interface LocalSandboxProviderOptions {
	workingDirectory?: string;
	capabilities?: RunnerSandboxCapabilities;
}

export class LocalSandboxProvider implements SandboxProvider {
	readonly provider = "local";
	private readonly defaultWorkingDirectory: string;
	private readonly capabilities: RunnerSandboxCapabilities;

	constructor(options: LocalSandboxProviderOptions = {}) {
		this.defaultWorkingDirectory = resolve(
			options.workingDirectory ?? process.cwd(),
		);
		this.capabilities =
			options.capabilities ?? DEFAULT_RUNNER_SANDBOX_CAPABILITIES;
	}

	async create(config: RuntimeSandboxConfig = { provider: "local" }) {
		const workingDirectory = resolve(
			config.workingDirectory ?? this.defaultWorkingDirectory,
		);
		await mkdir(workingDirectory, { recursive: true });
		return new LocalRunnerSandbox({
			sandboxId: config.id ?? "local",
			workingDirectory,
			capabilities: this.capabilities,
		});
	}
}

interface LocalRunnerSandboxOptions {
	sandboxId: string;
	workingDirectory: string;
	capabilities: RunnerSandboxCapabilities;
}

export class LocalRunnerSandbox implements RunnerSandbox {
	readonly provider = "local";
	readonly sandboxId: string;
	readonly workingDirectory: string;
	readonly capabilities: RunnerSandboxCapabilities;
	readonly filesystem: SandboxFilesystem;

	constructor(options: LocalRunnerSandboxOptions) {
		this.sandboxId = options.sandboxId;
		this.workingDirectory = options.workingDirectory;
		this.capabilities = options.capabilities;
		this.filesystem = new LocalSandboxFilesystem(this.workingDirectory);
	}

	async runCommand(
		command: string,
		options: SandboxRunCommandOptions = {},
	): Promise<CommandExecutionResult> {
		return runLocalCommand(command, this.workingDirectory, options);
	}

	async destroy() {
		return;
	}
}

export class LocalSandboxFilesystem implements SandboxFilesystem {
	constructor(private readonly workingDirectory: string) {}

	async readFile(path: string) {
		return readFile(this.resolvePath(path), "utf8");
	}

	async writeFile(path: string, content: string) {
		await writeFile(this.resolvePath(path), content);
	}

	async readdir(path: string): Promise<SandboxFileEntry[]> {
		const entries = await readdir(this.resolvePath(path), {
			withFileTypes: true,
		});
		return Promise.all(
			entries.map(async (entry) => {
				const childPath = this.resolvePath(join(path, entry.name));
				const entryStat = await stat(childPath);
				return {
					name: entry.name,
					type: entry.isDirectory() ? "directory" : "file",
					size: entryStat.size,
					modified: entryStat.mtime,
				};
			}),
		);
	}

	async mkdir(path: string) {
		await mkdir(this.resolvePath(path), { recursive: true });
	}

	async exists(path: string) {
		try {
			await access(this.resolvePath(path));
			return true;
		} catch {
			return false;
		}
	}

	async remove(path: string) {
		await rm(this.resolvePath(path), { recursive: true, force: true });
	}

	private resolvePath(path: string) {
		return isAbsolute(path) ? path : resolve(this.workingDirectory, path);
	}
}

function runLocalCommand(
	command: string,
	workingDirectory: string,
	options: SandboxRunCommandOptions,
): Promise<CommandExecutionResult> {
	if (options.background) {
		return Promise.reject(
			new Error(
				"Background commands are not supported by LocalSandboxProvider.",
			),
		);
	}

	return new Promise((resolveCommand, reject) => {
		const startedAt = Date.now();
		const child = spawn(command, {
			cwd: options.cwd
				? resolveCommandCwd(workingDirectory, options.cwd)
				: workingDirectory,
			env: { ...process.env, ...options.env },
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let settled = false;
		let stdout = "";
		let stderr = "";
		let timeout: NodeJS.Timeout | undefined;

		if (options.timeout !== undefined) {
			timeout = setTimeout(() => {
				child.kill("SIGTERM");
			}, options.timeout);
		}

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			if (timeout) clearTimeout(timeout);
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
		child.on("close", (exitCode) => {
			if (timeout) clearTimeout(timeout);
			if (!settled) {
				settled = true;
				resolveCommand({
					stdout,
					stderr,
					exitCode: exitCode ?? 0,
					durationMs: Date.now() - startedAt,
				});
			}
		});
	});
}

function resolveCommandCwd(workingDirectory: string, cwd: string) {
	return isAbsolute(cwd) ? cwd : resolve(workingDirectory, cwd);
}

export function createLocalSandboxProvider(
	options?: LocalSandboxProviderOptions,
) {
	return new LocalSandboxProvider(options);
}
