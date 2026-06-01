import { describe, expect, it } from "vitest";
import {
	OOM_MARKER,
	parseOomMarker,
	singleQuote,
	unwrapCommand,
	wrapCommand,
} from "../src/hooks/cyrus-tool-exec.js";

describe("singleQuote", () => {
	it("wraps a simple string", () => {
		expect(singleQuote("echo hi")).toBe("'echo hi'");
	});

	it("escapes embedded single quotes", () => {
		expect(singleQuote("it's")).toBe("'it'\\''s'");
	});

	it("leaves double quotes, backticks and $() untouched inside quotes", () => {
		expect(singleQuote('echo "$(date)" `id`')).toBe("'echo \"$(date)\" `id`'");
	});
});

describe("wrapCommand", () => {
	it("prefixes the inline cap and single-quotes the original", () => {
		expect(wrapCommand("pnpm test", "1300")).toBe(
			"CYRUS_TOOL_MEMORY_MAX_MB=1300 cyrus-tool-exec 'pnpm test'",
		);
	});

	it("safely quotes embedded single quotes", () => {
		expect(wrapCommand("echo 'hi'", "3000")).toBe(
			"CYRUS_TOOL_MEMORY_MAX_MB=3000 cyrus-tool-exec 'echo '\\''hi'\\'''",
		);
	});

	it("preserves double quotes, backticks and command substitution", () => {
		const cmd = 'echo "$(whoami)" `hostname`';
		expect(wrapCommand(cmd, "1300")).toBe(
			`CYRUS_TOOL_MEMORY_MAX_MB=1300 cyrus-tool-exec ${singleQuote(cmd)}`,
		);
	});

	it("preserves heredocs (newlines)", () => {
		const cmd = "cat <<'EOF'\nline1\nline2\nEOF";
		expect(wrapCommand(cmd, "1300")).toBe(
			`CYRUS_TOOL_MEMORY_MAX_MB=1300 cyrus-tool-exec ${singleQuote(cmd)}`,
		);
	});
});

describe("unwrapCommand", () => {
	it("returns a plain command unchanged", () => {
		expect(unwrapCommand("pnpm test")).toBe("pnpm test");
	});

	it("is the inverse of wrapCommand for simple commands", () => {
		expect(unwrapCommand(wrapCommand("pnpm test", "1300"))).toBe("pnpm test");
	});

	it("is the inverse of wrapCommand for commands with single quotes", () => {
		const cmd = "echo 'hello world'";
		expect(unwrapCommand(wrapCommand(cmd, "3000"))).toBe(cmd);
	});
});

describe("parseOomMarker", () => {
	it("parses cap and peak from the marker line", () => {
		const line = `${OOM_MARKER} exceeded 1300M memory budget (peak 1500000000 bytes).`;
		expect(parseOomMarker(line)).toEqual({
			budgetMb: 1300,
			peakBytes: 1500000000,
		});
	});

	it("returns an empty object when nothing matches", () => {
		expect(parseOomMarker("no marker here")).toEqual({});
	});
});
