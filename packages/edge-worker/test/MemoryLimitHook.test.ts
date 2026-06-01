import type {
	HookCallbackMatcher,
	PreToolUseHookInput,
} from "cyrus-claude-runner";
import type { ILogger } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { wrapCommand } from "../src/hooks/cyrus-tool-exec.js";
import { buildMemoryLimitHook } from "../src/hooks/MemoryLimitHook.js";

const silentLogger: ILogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as ILogger;

/** A working set of env values that satisfies all PreToolUse gates. */
function cloudEnv(
	overrides: Record<string, string | undefined> = {},
): (name: string) => string | undefined {
	const env: Record<string, string | undefined> = {
		CYRUS_RUNTIME: "cloud",
		CYRUS_TOOL_MEMORY_MAX_MB: "1300",
		...overrides,
	};
	return (name: string) => env[name];
}

function makePreInput(toolInput: unknown): PreToolUseHookInput {
	return {
		hook_event_name: "PreToolUse",
		session_id: "s",
		transcript_path: "t",
		cwd: "/work",
		tool_name: "Bash",
		tool_input: toolInput,
		tool_use_id: "u",
	} as PreToolUseHookInput;
}

async function runPre(
	matcher: HookCallbackMatcher,
	input: PreToolUseHookInput,
): Promise<any> {
	const fn = matcher.hooks[0];
	return fn(input as any, "u", { signal: new AbortController().signal });
}

function preMatcher(
	deps: Parameters<typeof buildMemoryLimitHook>[1],
): HookCallbackMatcher {
	const hook = buildMemoryLimitHook(silentLogger, deps);
	const matcher = hook.PreToolUse?.[0];
	if (!matcher) {
		throw new Error("expected a PreToolUse matcher");
	}
	return matcher;
}

describe("buildMemoryLimitHook — gating (no-op cases)", () => {
	it("registers a Bash matcher under PreToolUse", () => {
		const matcher = preMatcher({});
		expect(matcher.matcher).toBe("Bash");
	});

	it("is a no-op when CYRUS_RUNTIME is not 'cloud'", async () => {
		const matcher = preMatcher({
			getEnv: cloudEnv({ CYRUS_RUNTIME: undefined }),
			wrapperExists: () => true,
		});
		const result = await runPre(matcher, makePreInput({ command: "ls" }));
		expect(result).toEqual({ continue: true });
	});

	it("is a no-op when CYRUS_TOOL_MEMORY_MAX_MB is unset", async () => {
		const matcher = preMatcher({
			getEnv: cloudEnv({ CYRUS_TOOL_MEMORY_MAX_MB: undefined }),
			wrapperExists: () => true,
		});
		const result = await runPre(matcher, makePreInput({ command: "ls" }));
		expect(result).toEqual({ continue: true });
	});

	it("is a no-op when the wrapper binary is absent even if both env vars are set", async () => {
		const matcher = preMatcher({
			getEnv: cloudEnv(),
			wrapperExists: () => false,
		});
		const result = await runPre(matcher, makePreInput({ command: "ls" }));
		expect(result).toEqual({ continue: true });
	});
});

describe("buildMemoryLimitHook — command rewrite", () => {
	const deps = { getEnv: cloudEnv(), wrapperExists: () => true };

	it("rewrites a simple command with the inline cap prefix", async () => {
		const matcher = preMatcher(deps);
		const result = await runPre(
			matcher,
			makePreInput({ command: "pnpm test" }),
		);
		expect(result.hookSpecificOutput).toEqual({
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			updatedInput: {
				command: wrapCommand("pnpm test", "1300"),
			},
		});
	});

	it("preserves other tool_input fields in updatedInput", async () => {
		const matcher = preMatcher(deps);
		const result = await runPre(
			matcher,
			makePreInput({ command: "ls", description: "list", timeout: 5000 }),
		);
		expect(result.hookSpecificOutput.updatedInput).toEqual({
			command: wrapCommand("ls", "1300"),
			description: "list",
			timeout: 5000,
		});
	});

	it("safely single-quotes embedded single quotes", async () => {
		const matcher = preMatcher(deps);
		const cmd = "echo 'hello world'";
		const result = await runPre(matcher, makePreInput({ command: cmd }));
		expect(result.hookSpecificOutput.updatedInput.command).toBe(
			wrapCommand(cmd, "1300"),
		);
	});

	it("leaves double quotes, backticks and command substitution intact", async () => {
		const matcher = preMatcher(deps);
		const cmd = 'echo "$(whoami)" `hostname`';
		const result = await runPre(matcher, makePreInput({ command: cmd }));
		expect(result.hookSpecificOutput.updatedInput.command).toBe(
			wrapCommand(cmd, "1300"),
		);
	});

	it("handles heredocs (newlines) without corruption", async () => {
		const matcher = preMatcher(deps);
		const cmd = "cat <<'EOF'\nline1\nline2\nEOF";
		const result = await runPre(matcher, makePreInput({ command: cmd }));
		expect(result.hookSpecificOutput.updatedInput.command).toBe(
			wrapCommand(cmd, "1300"),
		);
	});
});

describe("buildMemoryLimitHook — fail open on unexpected input", () => {
	const deps = { getEnv: cloudEnv(), wrapperExists: () => true };

	it("is a no-op when command is missing", async () => {
		const matcher = preMatcher(deps);
		const result = await runPre(matcher, makePreInput({ description: "x" }));
		expect(result).toEqual({ continue: true });
	});

	it("is a no-op when tool_input is undefined", async () => {
		const matcher = preMatcher(deps);
		const result = await runPre(matcher, makePreInput(undefined));
		expect(result).toEqual({ continue: true });
	});

	it("is a no-op when command is not a string", async () => {
		const matcher = preMatcher(deps);
		const result = await runPre(matcher, makePreInput({ command: 42 }));
		expect(result).toEqual({ continue: true });
	});

	it("is a no-op when command is an empty string", async () => {
		const matcher = preMatcher(deps);
		const result = await runPre(matcher, makePreInput({ command: "" }));
		expect(result).toEqual({ continue: true });
	});
});
