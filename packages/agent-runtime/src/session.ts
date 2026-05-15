import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import type {
	AgentSession,
	AgentSessionResult,
	HarnessAdapter,
	NormalizedAgentSessionConfig,
	RunnerSandbox,
	RuntimeCallbacks,
	TranscriptEvent,
} from "./types.js";

class AsyncEventBuffer<T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiters: Array<(value: IteratorResult<T>) => void> = [];
	private closed = false;

	push(value: T): void {
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ value, done: false });
			return;
		}
		this.queue.push(value);
	}

	close(): void {
		this.closed = true;
		while (this.waiters.length > 0) {
			this.waiters.shift()?.({ value: undefined, done: true });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				const value = this.queue.shift();
				if (value !== undefined) {
					return Promise.resolve({ value, done: false });
				}
				if (this.closed) {
					return Promise.resolve({ value: undefined, done: true });
				}
				return new Promise<IteratorResult<T>>((resolve) => {
					this.waiters.push(resolve);
				});
			},
		};
	}
}

export class RuntimeAgentSession extends EventEmitter implements AgentSession {
	readonly sessionId: string;
	readonly harness: NormalizedAgentSessionConfig["harness"]["kind"];
	readonly events: AsyncIterable<TranscriptEvent>;

	private readonly eventBuffer = new AsyncEventBuffer<TranscriptEvent>();
	private readonly observedEvents: TranscriptEvent[] = [];
	private readonly queuedMessages: string[] = [];
	private stopped = false;
	private started = false;

	constructor(
		private readonly config: NormalizedAgentSessionConfig,
		private readonly adapter: HarnessAdapter,
		private readonly sandbox: RunnerSandbox,
		private readonly callbacks: RuntimeCallbacks = {},
	) {
		super();
		this.sessionId = config.sessionId;
		this.harness = adapter.kind;
		this.events = this.eventBuffer;
	}

	async start(): Promise<AgentSessionResult> {
		if (this.started) {
			throw new Error(`Session ${this.sessionId} has already been started`);
		}
		this.started = true;

		const command = this.adapter.buildCommand(this.config);
		const startedAt = Date.now();
		try {
			await this.materializeFiles();
			await this.runSetupCommands();
			const result = await this.sandbox.runCommand(
				[command.command, ...command.args.map(shellQuote)].join(" "),
				{
					cwd: this.config.sandbox.workingDirectory,
					env: {
						...this.config.env,
						...command.env,
						...this.materializeSecrets(),
					},
				},
			);

			await this.parseOutput(result.stdout, "stdout");
			await this.parseOutput(result.stderr, "stderr");

			const runtimeResult: AgentSessionResult = {
				sessionId: this.sessionId,
				harness: this.harness,
				success: result.exitCode === 0 && !this.stopped,
				exitCode: result.exitCode,
				result: this.adapter.extractResult?.(this.observedEvents),
				events: [...this.observedEvents],
			};
			this.eventBuffer.close();
			return runtimeResult;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const failedEvent = this.createEvent("error", {
				message: err.message,
				durationMs: Date.now() - startedAt,
			});
			await this.emitEvent(failedEvent);
			this.eventBuffer.close();
			return {
				sessionId: this.sessionId,
				harness: this.harness,
				success: false,
				error: err,
				events: [...this.observedEvents],
			};
		}
	}

	async addMessage(message: string): Promise<void> {
		this.queuedMessages.push(message);
		await this.emitEvent(this.createEvent("message.queued", { message }));
	}

	async interrupt(reason?: string): Promise<void> {
		await this.emitEvent(this.createEvent("interrupt.requested", { reason }));
	}

	async stop(reason?: string): Promise<void> {
		this.stopped = true;
		await this.emitEvent(this.createEvent("stop.requested", { reason }));
		await this.sandbox.destroy();
		this.eventBuffer.close();
	}

	getQueuedMessages(): readonly string[] {
		return this.queuedMessages;
	}

	private async parseOutput(
		output: string,
		stream: "stdout" | "stderr",
	): Promise<void> {
		for (const line of output.split(/\r?\n/)) {
			if (!line.trim()) {
				continue;
			}
			const event =
				stream === "stdout"
					? this.adapter.parseStdoutLine(line, {
							sessionId: this.sessionId,
							harness: this.harness,
						})
					: this.adapter.parseStderrLine?.(line, {
							sessionId: this.sessionId,
							harness: this.harness,
						});
			if (event) {
				await this.emitEvent(event);
			}
		}
	}

	private createEvent(kind: string, raw: unknown): TranscriptEvent {
		return {
			sessionId: this.sessionId,
			harness: this.harness,
			timestamp: new Date().toISOString(),
			kind,
			raw,
		};
	}

	private async emitEvent(event: TranscriptEvent): Promise<void> {
		this.observedEvents.push(event);
		this.eventBuffer.push(event);
		this.emit("transcript", event);
		await this.callbacks.onTranscriptEvent?.(event);
	}

	private async materializeFiles(): Promise<void> {
		for (const file of this.config.files ?? []) {
			await this.emitEvent(
				this.createEvent("file.write.started", {
					path: file.path,
					sensitive: file.sensitive ?? false,
				}),
			);
			await this.sandbox.filesystem.mkdir(dirname(file.path));
			await this.sandbox.filesystem.writeFile(file.path, file.content);
			await this.emitEvent(
				this.createEvent("file.write.completed", {
					path: file.path,
					bytes: file.content.length,
					content: file.sensitive ? "[redacted]" : file.content,
				}),
			);
		}
	}

	private async runSetupCommands(): Promise<void> {
		const commands = [
			...(this.config.packages?.system?.map(
				(pkg) => `apt-get update && apt-get install -y ${shellQuote(pkg)}`,
			) ?? []),
			...(this.config.packages?.npm?.map(
				(pkg) => `npm install -g ${shellQuote(pkg)}`,
			) ?? []),
			...(this.config.packages?.commands ?? []),
		];

		for (const setupCommand of commands) {
			await this.emitEvent(
				this.createEvent("setup.started", { command: setupCommand }),
			);
			const result = await this.sandbox.runCommand(setupCommand, {
				cwd: this.config.sandbox.workingDirectory,
				env: {
					...this.config.env,
					...this.materializeSecrets(),
				},
			});
			await this.emitEvent(
				this.createEvent("setup.completed", {
					command: setupCommand,
					exitCode: result.exitCode,
					stdout: result.stdout,
					stderr: result.stderr,
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(
					`Setup command failed with exit code ${result.exitCode}: ${setupCommand}`,
				);
			}
		}
	}

	private materializeSecrets(): Record<string, string> {
		const entries = Object.entries(this.config.secrets).map(([key, secret]) => [
			key,
			secret.value,
		]);
		return Object.fromEntries(entries);
	}
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
		return value;
	}
	return `'${value.replaceAll("'", "'\\''")}'`;
}
