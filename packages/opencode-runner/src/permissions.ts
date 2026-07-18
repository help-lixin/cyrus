export const OPENCODE_BUILTIN_TOOLS = [
	"bash",
	"read",
	"edit",
	"write",
	"glob",
	"grep",
	"task",
	"todowrite",
	"todoread",
	"webfetch",
	"websearch",
	"skill",
	"lsp",
	"question",
	"patch",
] as const;

export type OpenCodeBuiltinTool = (typeof OPENCODE_BUILTIN_TOOLS)[number];

export interface Rule {
	tool: string;
	pattern?: string;
}

export interface Ruleset {
	allow: Rule[];
	deny: Rule[];
}

const TOOL_NAME_MAP: Record<string, string> = {
	Read: "read",
	Edit: "edit",
	Write: "write",
	MultiEdit: "edit",
	NotebookEdit: "edit",
	Bash: "bash",
	Glob: "glob",
	Grep: "grep",
	Task: "task",
	WebFetch: "webfetch",
	WebSearch: "websearch",
	Skill: "skill",
	TodoWrite: "todowrite",
	TodoRead: "todoread",
	Lsp: "lsp",
	Question: "question",
	Patch: "patch",
};

const REVERSE_TOOL_NAME_MAP: Record<string, string> = Object.fromEntries(
	Object.entries(TOOL_NAME_MAP).map(([k, v]) => [v, k]),
);

function parseToolPattern(
	pattern: string,
): { name: string; argument: string | null } | null {
	const trimmed = pattern.trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)(?:\((.*)\))?$/);
	if (!match) return null;
	return {
		name: match[1] || "",
		argument: match[2]?.trim() ?? null,
	};
}

function globToOpenCode(glob: string): string {
	return glob.replace(/\*\*/g, "*").replace(/\?/g, "?");
}

export function buildToolsMap(
	allowedTools?: string[],
	disallowedTools?: string[],
	mcpServerNames?: string[],
): Record<string, boolean> {
	const toolsMap: Record<string, boolean> = {};

	const processTool = (tool: string, allowed: boolean) => {
		if (tool.toLowerCase().startsWith("mcp__")) {
			const parts = tool.split("__");
			if (parts.length >= 3) {
				const server = parts[1];
				const toolName = parts.slice(2).join("__");
				toolsMap[`${server}_${toolName}`] = allowed;
			}
			return;
		}

		const parsed = parseToolPattern(tool);
		if (!parsed) return;

		const opencodeName = TOOL_NAME_MAP[parsed.name];
		if (opencodeName) {
			if (!parsed.argument) {
				toolsMap[opencodeName] = allowed;
			} else {
				toolsMap[opencodeName] = allowed;
			}
		}
	};

	if (allowedTools) {
		for (const tool of allowedTools) {
			processTool(tool, true);
		}
	}

	if (disallowedTools) {
		for (const tool of disallowedTools) {
			processTool(tool, false);
		}
	}

	if (mcpServerNames) {
		for (const server of mcpServerNames) {
			toolsMap[`${server}_*`] = true;
		}
	}

	return toolsMap;
}

export function translatePatterns(
	allowedTools?: string[],
	disallowedTools?: string[],
): Ruleset {
	const allow: Rule[] = [];
	const deny: Rule[] = [];

	const processTool = (tool: string, isDeny: boolean) => {
		if (tool.toLowerCase().startsWith("mcp__")) {
			const parts = tool.split("__");
			if (parts.length >= 3) {
				const server = parts[1];
				const toolName = parts.slice(2).join("__");
				const rule: Rule = { tool: `${server}_${toolName}` };
				if (isDeny) {
					deny.push(rule);
				} else {
					allow.push(rule);
				}
			}
			return;
		}

		const parsed = parseToolPattern(tool);
		if (!parsed) return;

		const opencodeName = TOOL_NAME_MAP[parsed.name];
		if (!opencodeName) return;

		const rule: Rule = { tool: opencodeName };
		if (parsed.argument) {
			rule.pattern = globToOpenCode(parsed.argument);
		}

		if (isDeny) {
			deny.push(rule);
		} else {
			allow.push(rule);
		}
	};

	if (allowedTools) {
		for (const tool of allowedTools) {
			processTool(tool, false);
		}
	}

	if (disallowedTools) {
		for (const tool of disallowedTools) {
			processTool(tool, true);
		}
	}

	return { allow, deny };
}

function matchPattern(pattern: string | undefined, input: string): boolean {
	if (!pattern) return true;
	if (pattern === "*") return true;
	if (pattern.includes("*") || pattern.includes("?")) {
		const regex = new RegExp(
			`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
		);
		return regex.test(input);
	}
	return pattern === input;
}

function matchToolRule(rule: Rule, toolName: string, input?: string): boolean {
	if (rule.tool !== toolName) return false;
	if (rule.pattern && input) {
		return matchPattern(rule.pattern, input);
	}
	return true;
}

export function evaluatePermission(
	ruleset: Ruleset,
	toolName: string,
	input?: string,
): "once" | "reject" {
	const lowerToolName = toolName.toLowerCase();

	if (lowerToolName === "question") {
		return "reject";
	}

	if (lowerToolName === "doom_loop") {
		return "reject";
	}

	if (lowerToolName === "external_directory") {
		return "reject";
	}

	for (const rule of ruleset.deny) {
		if (matchToolRule(rule, lowerToolName, input)) {
			return "reject";
		}
	}

	for (const rule of ruleset.allow) {
		if (matchToolRule(rule, lowerToolName, input)) {
			return "once";
		}
	}

	return "reject";
}

export function translateToolName(opencodeName: string): string {
	return REVERSE_TOOL_NAME_MAP[opencodeName] || opencodeName;
}

export function reverseMcpToolName(mcpName: string): string {
	const parts = mcpName.split("_");
	if (parts.length >= 2) {
		return `mcp__${parts[0]}__${parts.slice(1).join("_")}`;
	}
	return mcpName;
}
