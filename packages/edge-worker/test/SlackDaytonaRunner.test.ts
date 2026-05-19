import { describe, expect, it, vi } from "vitest";
import {
	assertSlackDaytonaEnv,
	resolveSlackDaytonaVolumeId,
	SlackDaytonaRunner,
} from "../src/SlackDaytonaRunner.js";

// `cyrus-agent-runtime` is a workspace dep and pulls in real ComputeSDK
// providers. Mock it so this test does not try to reach Daytona over the
// network — we're only proving the adapter's contract and config wiring.
vi.mock("cyrus-agent-runtime", async () => {
	const sessions: Array<{ config: unknown; events: unknown[] }> = [];
	const createSession = vi.fn(async (config: unknown) => {
		const events: unknown[] = [];
		const session = {
			sessionId: "cyrus-session",
			harness: "claude" as const,
			events: (async function* () {
				for (const e of events) yield e;
			})(),
			start: vi.fn(async () => ({
				sessionId: "cyrus-session",
				harness: "claude" as const,
				success: true,
				exitCode: 0,
				events,
				harnessSessionId: "claude-init-uuid",
				destroy: vi.fn(async () => {}),
			})),
			stop: vi.fn(async () => {}),
			destroy: vi.fn(async () => {}),
			addMessage: vi.fn(async () => {}),
			interrupt: vi.fn(async () => {}),
		};
		sessions.push({ config, events });
		return session;
	});
	return {
		createAgentRuntime: vi.fn(() => ({ createSession })),
		createComputeSdkSandboxProvider: vi.fn(() => ({
			provider: "fake",
			create: vi.fn(),
		})),
		__sessions: sessions,
		__createSession: createSession,
	};
});

vi.mock("@computesdk/daytona", () => ({ daytona: vi.fn(() => ({})) }));
vi.mock("@daytonaio/sdk", () => ({ Daytona: vi.fn() }));
vi.mock("computesdk", () => ({ compute: {} }));

import * as runtimeMock from "cyrus-agent-runtime";

const daytonaConfig = {
	daytonaApiKey: "fake-daytona-key",
	claudeCodeOAuthToken: "fake-claude-token",
	volumeName: "cyrus-slack-claude-state",
	volumeId: "vol-resolved-abc",
};

const baseConfig = {
	cyrusHome: "/tmp/cyrus",
	workingDirectory: "/tmp/cyrus/work",
	workspaceName: "slack-event123",
	appendSystemPrompt: "be concise",
	allowedTools: ["Read", "Edit"],
	disallowedTools: ["Bash"],
	model: "claude-sonnet-4-5",
};

describe("assertSlackDaytonaEnv", () => {
	it("returns resolved env with default volume name", () => {
		const env = assertSlackDaytonaEnv({
			DAYTONA_API_KEY: "a",
			CLAUDE_CODE_OAUTH_TOKEN: "b",
		} as NodeJS.ProcessEnv);
		expect(env).toEqual({
			daytonaApiKey: "a",
			claudeCodeOAuthToken: "b",
			volumeName: "cyrus-slack-claude-state",
		});
	});

	it("honors CYRUS_SLACK_DAYTONA_VOLUME_NAME override", () => {
		const env = assertSlackDaytonaEnv({
			DAYTONA_API_KEY: "a",
			CLAUDE_CODE_OAUTH_TOKEN: "b",
			CYRUS_SLACK_DAYTONA_VOLUME_NAME: "my-custom-volume",
		} as NodeJS.ProcessEnv);
		expect(env.volumeName).toBe("my-custom-volume");
	});

	it("throws if required vars are missing", () => {
		expect(() => assertSlackDaytonaEnv({} as NodeJS.ProcessEnv)).toThrow(
			/DAYTONA_API_KEY.*CLAUDE_CODE_OAUTH_TOKEN/,
		);
	});
});

describe("resolveSlackDaytonaVolumeId", () => {
	it("calls volume.get(name, true) and returns the resolved id", async () => {
		const get = vi.fn(async (name: string, _create?: boolean) => ({
			id: `vol-id-for-${name}`,
		}));
		const config = await resolveSlackDaytonaVolumeId(
			{
				daytonaApiKey: "k",
				claudeCodeOAuthToken: "t",
				volumeName: "my-vol",
			},
			() => ({ volume: { get } }),
		);
		expect(get).toHaveBeenCalledWith("my-vol", true);
		expect(config).toEqual({
			daytonaApiKey: "k",
			claudeCodeOAuthToken: "t",
			volumeName: "my-vol",
			volumeId: "vol-id-for-my-vol",
		});
	});

	it("passes the api key into the client factory", async () => {
		const get = vi.fn(async () => ({ id: "vol-x" }));
		const factory = vi.fn(() => ({ volume: { get } }));
		await resolveSlackDaytonaVolumeId(
			{
				daytonaApiKey: "the-key",
				claudeCodeOAuthToken: "t",
				volumeName: "v",
			},
			factory,
		);
		expect(factory).toHaveBeenCalledWith("the-key");
	});
});

describe("SlackDaytonaRunner", () => {
	it("does not support streaming input or warm sessions (MVP)", () => {
		const runner = new SlackDaytonaRunner(baseConfig, daytonaConfig);
		expect(runner.supportsStreamingInput).toBe(false);
		expect(runner.isWarm()).toBe(false);
		expect(runner.isRunning()).toBe(false);
	});

	it("builds a Daytona-targeted runtime config with claude harness and resume id", async () => {
		const runner = new SlackDaytonaRunner(
			{ ...baseConfig, resumeSessionId: "prior-claude-uuid" },
			daytonaConfig,
		);
		await runner.start("hi from slack");

		const sessions = (
			runtimeMock as unknown as {
				__sessions: Array<{
					config: {
						harness: { kind: string };
						userPrompt: string;
						resumeHarnessSessionId?: string;
						sandbox: { provider: string; volumes?: unknown[] };
						env: Record<string, string>;
						secrets: Record<string, unknown>;
						permissions?: { allowedTools?: string[] };
					};
				}>;
			}
		).__sessions;
		const last = sessions.at(-1)!.config;
		expect(last.harness.kind).toBe("claude");
		expect(last.userPrompt).toBe("hi from slack");
		expect(last.resumeHarnessSessionId).toBe("prior-claude-uuid");
		expect(last.sandbox.provider).toBe("daytona");
		expect(last.sandbox.volumes).toEqual([
			{
				name: "vol-resolved-abc",
				mountPath: "/var/cyrus/context",
				subpath: "slack/slack-event123",
				kind: "fuse",
			},
		]);
		// Claude is redirected onto the mounted volume.
		expect(last.env.CLAUDE_CONFIG_DIR).toBe("/var/cyrus/context/.claude");
		// OAuth token plumbed as secret, not env.
		expect(last.secrets.CLAUDE_CODE_OAUTH_TOKEN).toBe("fake-claude-token");
		expect(last.permissions?.allowedTools).toEqual(["Read", "Edit"]);
	});

	it("rejects double start while a run is in flight", async () => {
		// Override the mock's session.start() to hang so the first run stays
		// in flight while we attempt the second. The default mock resolves
		// synchronously, which lets isRunning flip back to false before the
		// guard fires.
		const createSession = (
			runtimeMock as unknown as {
				__createSession: { mockImplementationOnce: Function };
			}
		).__createSession;
		createSession.mockImplementationOnce(async (_config: unknown) => ({
			sessionId: "cyrus-session",
			harness: "claude" as const,
			events: (async function* () {})(),
			start: () => new Promise(() => {}), // never resolves
			stop: async () => {},
			destroy: async () => {},
			addMessage: async () => {},
			interrupt: async () => {},
		}));

		const runner = new SlackDaytonaRunner(baseConfig, daytonaConfig);
		await runner.start("first");
		await expect(runner.start("second")).rejects.toThrow(/already running/);
	});

	it("getFormatter returns the Claude message formatter", () => {
		const runner = new SlackDaytonaRunner(baseConfig, daytonaConfig);
		expect(typeof runner.getFormatter().formatToolParameter).toBe("function");
	});
});
