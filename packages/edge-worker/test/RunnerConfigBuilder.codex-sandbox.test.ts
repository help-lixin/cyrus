import type { SandboxSettings } from "cyrus-claude-runner";
import type { CyrusAgentSession, ILogger, RepositoryConfig } from "cyrus-core";
import { describe, expect, it } from "vitest";
import {
	type IChatToolResolver,
	type IMcpConfigProvider,
	type IRunnerSelector,
	RunnerConfigBuilder,
} from "../src/RunnerConfigBuilder.js";

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

function makeBuilder(): RunnerConfigBuilder {
	const chatToolResolver: IChatToolResolver = {
		buildChatAllowedTools: () => ["Read(**)"],
	};
	const mcpConfigProvider: IMcpConfigProvider = {
		buildMcpConfig: () => ({}),
		buildMergedMcpConfigPath: () => undefined,
	};
	const runnerSelector: IRunnerSelector = {
		determineRunnerSelection: () => ({ runnerType: "codex" as const }),
		getDefaultModelForRunner: () => "gpt-5.5",
		getDefaultFallbackModelForRunner: () => "gpt-5.2-codex",
	};
	return new RunnerConfigBuilder(
		chatToolResolver,
		mcpConfigProvider,
		runnerSelector,
	);
}

function makeRepository(): RepositoryConfig {
	return {
		id: "repo-a",
		name: "Repo A",
		repositoryPath: "/repos/repo-a",
		allowedTools: [],
	} as unknown as RepositoryConfig;
}

function makeSession(): CyrusAgentSession {
	return {
		issueId: "issue-1",
		issue: { identifier: "ABC-1" },
		workspace: {
			path: "/ws/repo-a-worktree",
			isGitWorktree: true,
		},
	} as unknown as CyrusAgentSession;
}

function buildCodexIssueConfig(sandboxSettings?: SandboxSettings) {
	return makeBuilder().buildIssueConfig({
		session: makeSession(),
		repository: makeRepository(),
		sessionId: "sess-1",
		systemPrompt: "test",
		allowedTools: ["Read(**)"],
		allowedDirectories: ["/repos/repo-a"],
		disallowedTools: [],
		cyrusHome: "/tmp/cyrus-home",
		linearWorkspaceId: "ws-1",
		logger: silentLogger,
		onMessage: () => {},
		onError: () => {},
		requireLinearWorkspaceId: () => "ws-1",
		sandboxSettings,
	});
}

describe("RunnerConfigBuilder Codex sandbox mapping", () => {
	it("disables Codex sandbox when Cyrus sandbox settings are absent", () => {
		const { config, runnerType } = buildCodexIssueConfig();

		expect(runnerType).toBe("codex");
		expect(config.sandbox).toBe("danger-full-access");
	});

	it("enables Codex workspace sandbox when Cyrus sandbox is enabled", () => {
		const { config, runnerType } = buildCodexIssueConfig({
			enabled: true,
			network: {
				httpProxyPort: 9080,
				socksProxyPort: 9081,
			},
		});

		expect(runnerType).toBe("codex");
		expect(config.sandbox).toBe("workspace-write");
	});
});
