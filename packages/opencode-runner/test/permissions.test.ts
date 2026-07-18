import { describe, expect, it } from "vitest";
import {
	buildToolsMap,
	evaluatePermission,
	OPENCODE_BUILTIN_TOOLS,
	reverseMcpToolName,
	translatePatterns,
	translateToolName,
} from "../src/permissions.js";

describe("OPENCODE_BUILTIN_TOOLS", () => {
	it("contains expected tools", () => {
		expect(OPENCODE_BUILTIN_TOOLS).toContain("bash");
		expect(OPENCODE_BUILTIN_TOOLS).toContain("read");
		expect(OPENCODE_BUILTIN_TOOLS).toContain("edit");
		expect(OPENCODE_BUILTIN_TOOLS).toContain("write");
		expect(OPENCODE_BUILTIN_TOOLS).toContain("glob");
		expect(OPENCODE_BUILTIN_TOOLS).toContain("grep");
	});
});

describe("translatePatterns", () => {
	it("translates Read tool pattern", () => {
		const result = translatePatterns(["Read(src/**)"]);
		expect(result.allow).toEqual([{ tool: "read", pattern: "src/*" }]);
	});

	it("translates Bash tool pattern", () => {
		const result = translatePatterns(["Bash(git:*)"]);
		expect(result.allow).toEqual([{ tool: "bash", pattern: "git:*" }]);
	});

	it("translates MCP tool pattern", () => {
		const result = translatePatterns(["mcp__linear__create_issue"]);
		expect(result.allow).toEqual([{ tool: "linear_create_issue" }]);
	});

	it("translates bare tool name", () => {
		const result = translatePatterns(["Read", "Bash"]);
		expect(result.allow).toContainEqual({ tool: "read" });
		expect(result.allow).toContainEqual({ tool: "bash" });
	});

	it("places disallowed tools in deny list", () => {
		const result = translatePatterns(["Read"], ["Bash(rm:*)"]);
		expect(result.allow).toContainEqual({ tool: "read" });
		expect(result.deny).toContainEqual({ tool: "bash", pattern: "rm:*" });
	});

	it("handles multiple tools", () => {
		const result = translatePatterns(
			["Read(src/**)", "Edit(src/**)", "Bash(git:*)"],
			["Read(.env*)"],
		);
		expect(result.allow).toHaveLength(3);
		expect(result.deny).toHaveLength(1);
		expect(result.deny[0]).toEqual({ tool: "read", pattern: ".env*" });
	});

	it("ignores unrecognized tool names", () => {
		const result = translatePatterns(["NonsenseTool"]);
		expect(result.allow).toEqual([]);
	});
});

describe("buildToolsMap", () => {
	it("maps allowed tools to true", () => {
		const result = buildToolsMap(["Read", "Bash"]);
		expect(result.read).toBe(true);
		expect(result.bash).toBe(true);
	});

	it("maps disallowed tools to false", () => {
		const result = buildToolsMap([], ["Read", "Bash"]);
		expect(result.read).toBe(false);
		expect(result.bash).toBe(false);
	});

	it("allows overrides disallowed", () => {
		const result = buildToolsMap(["Read"], ["Read"]);
		expect(result.read).toBe(false);
	});

	it("handles MCP server wildcard", () => {
		const result = buildToolsMap(undefined, undefined, ["linear"]);
		expect(result["linear_*"]).toBe(true);
	});

	it("translates Claude tool names to opencode", () => {
		const result = buildToolsMap(["Edit", "MultiEdit", "NotebookEdit"]);
		expect(result.edit).toBe(true);
	});
});

describe("evaluatePermission", () => {
	it('returns "once" when tool is in allow list', () => {
		const ruleset = translatePatterns(["Read"]);
		expect(evaluatePermission(ruleset, "read")).toBe("once");
	});

	it('returns "reject" when tool is in deny list', () => {
		const ruleset = translatePatterns([], ["Read"]);
		expect(evaluatePermission(ruleset, "read")).toBe("reject");
	});

	it('returns "reject" when tool is not in any list', () => {
		const ruleset = translatePatterns(["Read"]);
		expect(evaluatePermission(ruleset, "bash")).toBe("reject");
	});

	it("denies question tool regardless of rules", () => {
		const ruleset = translatePatterns(["question"]);
		expect(evaluatePermission(ruleset, "question")).toBe("reject");
	});

	it("denies doom_loop tool regardless of rules", () => {
		const ruleset = translatePatterns(["doom_loop"]);
		expect(evaluatePermission(ruleset, "doom_loop")).toBe("reject");
	});

	it("denies external_directory tool regardless of rules", () => {
		const ruleset = translatePatterns(["external_directory"]);
		expect(evaluatePermission(ruleset, "external_directory")).toBe("reject");
	});

	it("matches pattern when checking allow", () => {
		const ruleset = translatePatterns(["Read(src/**)"]);
		expect(evaluatePermission(ruleset, "read", "src/index.ts")).toBe("once");
		expect(evaluatePermission(ruleset, "read", "other/index.ts")).toBe(
			"reject",
		);
	});

	it("matches pattern when checking deny", () => {
		const ruleset = translatePatterns([], ["Read(.env**)"]);
		expect(evaluatePermission(ruleset, "read", ".env")).toBe("reject");
		expect(evaluatePermission(ruleset, "read", "src/index.ts")).toBe("reject");
	});
});

describe("translateToolName", () => {
	it("translates opencode tool names to Claude names", () => {
		expect(translateToolName("read")).toBe("Read");
		expect(translateToolName("write")).toBe("Write");
		expect(translateToolName("bash")).toBe("Bash");
	});

	it("returns last mapped Claude tool when multiple map to same opencode tool", () => {
		expect(translateToolName("edit")).toBe("NotebookEdit");
	});

	it("returns unknown opencode names unchanged", () => {
		expect(translateToolName("unknown_tool")).toBe("unknown_tool");
	});
});

describe("reverseMcpToolName", () => {
	it("converts opencode MCP name to Claude mcp__ format", () => {
		expect(reverseMcpToolName("linear_create_issue")).toBe(
			"mcp__linear__create_issue",
		);
	});

	it("handles multi-part tool names", () => {
		expect(reverseMcpToolName("server_tool_with_underscore")).toBe(
			"mcp__server__tool_with_underscore",
		);
	});

	it("returns unchanged if not MCP format", () => {
		expect(reverseMcpToolName("bash")).toBe("bash");
	});
});
