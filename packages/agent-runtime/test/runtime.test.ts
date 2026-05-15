import { describe, expect, it } from "vitest";
import { createAgentSession, normalizeConfig } from "../src/runtime.js";
import type {
	CommandExecutionResult,
	RunnerSandbox,
	RunnerSandboxCapabilities,
	SandboxFilesystem,
	SandboxProvider,
} from "../src/types.js";

describe("AgentRuntime", () => {
	it("normalizes minimal session config", () => {
		const config = normalizeConfig({
			harness: "codex",
			userPrompt: "hello",
			secrets: {
				CURSOR_API_KEY: "secret",
			},
		});

		expect(config.sessionId).toBeTruthy();
		expect(config.harness).toEqual({ kind: "codex", model: undefined });
		expect(config.sandbox.provider).toBe("local");
		expect(config.secrets.CURSOR_API_KEY).toEqual({
			value: "secret",
			redact: true,
		});
	});

	it("runs a session through an injected sandbox provider", async () => {
		const sandbox = new FakeSandbox(
			[
				JSON.stringify({
					type: "item.completed",
					item: { type: "agent_message", text: "done" },
				}),
			].join("\n"),
		);
		const events = [];
		const session = await createAgentSession(
			{
				sessionId: "session-1",
				harness: "codex",
				userPrompt: "Do it",
				env: { NODE_ENV: "test" },
				secrets: { API_KEY: "secret" },
			},
			{
				sandboxProviders: { local: new FakeSandboxProvider(sandbox) },
				callbacks: {
					onTranscriptEvent(event) {
						events.push(event.kind);
					},
				},
			},
		);

		await session.addMessage("queued");
		const result = await session.start();

		expect(result).toMatchObject({
			sessionId: "session-1",
			harness: "codex",
			success: true,
			result: "done",
		});
		expect(events).toEqual(["message.queued", "item.completed"]);
		expect(sandbox.commands[0]).toMatchObject({
			command: "codex exec --json --skip-git-repo-check 'Do it'",
			options: {
				env: {
					NODE_ENV: "test",
					API_KEY: "secret",
				},
			},
		});
	});

	it("runs setup commands before the harness command and emits setup events", async () => {
		const sandbox = new FakeSandbox(
			JSON.stringify({
				type: "item.completed",
				item: { type: "agent_message", text: "ready" },
			}),
		);
		const session = await createAgentSession(
			{
				sessionId: "session-setup",
				harness: "codex",
				userPrompt: "Run after setup",
				packages: {
					npm: ["example-cli"],
					commands: ["example-cli --version"],
				},
			},
			{
				sandboxProviders: { local: new FakeSandboxProvider(sandbox) },
			},
		);

		const result = await session.start();

		expect(result.success).toBe(true);
		expect(result.events.map((event) => event.kind)).toEqual([
			"setup.started",
			"setup.completed",
			"setup.started",
			"setup.completed",
			"item.completed",
		]);
		expect(sandbox.commands.map((entry) => entry.command)).toEqual([
			"npm install -g example-cli",
			"example-cli --version",
			"codex exec --json --skip-git-repo-check 'Run after setup'",
		]);
	});

	it("materializes sensitive files before setup without exposing contents", async () => {
		const sandbox = new FakeSandbox(
			JSON.stringify({
				type: "item.completed",
				item: { type: "agent_message", text: "ready" },
			}),
		);
		const session = await createAgentSession(
			{
				sessionId: "session-files",
				harness: "codex",
				userPrompt: "Run after files",
				files: [
					{
						path: "/home/daytona/.codex/auth.json",
						content: "secret-auth-json",
						sensitive: true,
					},
				],
			},
			{
				sandboxProviders: { local: new FakeSandboxProvider(sandbox) },
			},
		);

		const result = await session.start();

		expect(result.success).toBe(true);
		expect(sandbox.files).toEqual([
			{ path: "/home/daytona/.codex/auth.json", content: "secret-auth-json" },
		]);
		expect(result.events.slice(0, 2)).toMatchObject([
			{
				kind: "file.write.started",
				raw: { path: "/home/daytona/.codex/auth.json", sensitive: true },
			},
			{
				kind: "file.write.completed",
				raw: {
					path: "/home/daytona/.codex/auth.json",
					bytes: 16,
					content: "[redacted]",
				},
			},
		]);
	});
});

class FakeSandboxProvider implements SandboxProvider {
	readonly provider = "local";

	constructor(private readonly sandbox: RunnerSandbox) {}

	async create(): Promise<RunnerSandbox> {
		return this.sandbox;
	}
}

class FakeSandbox implements RunnerSandbox {
	readonly sandboxId = "fake";
	readonly provider = "local";
	readonly capabilities: RunnerSandboxCapabilities = {
		filesystem: true,
		runCommand: true,
		streamingProcess: false,
	};
	readonly files: Array<{ path: string; content: string }> = [];
	readonly filesystem: SandboxFilesystem = {
		async readFile() {
			return "";
		},
		writeFile: async (path, content) => {
			this.files.push({ path, content });
		},
		async readdir() {
			return [];
		},
		async mkdir() {
			return;
		},
		async exists() {
			return true;
		},
		async remove() {
			return;
		},
	};
	readonly commands: Array<{
		command: string;
		options: unknown;
	}> = [];

	constructor(private readonly stdout: string) {}

	async runCommand(
		command: string,
		options?: unknown,
	): Promise<CommandExecutionResult> {
		this.commands.push({ command, options });
		return {
			stdout: this.stdout,
			stderr: "",
			exitCode: 0,
			durationMs: 1,
		};
	}

	async destroy(): Promise<void> {
		return;
	}
}
