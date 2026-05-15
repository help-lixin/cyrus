import type { HarnessAdapter, NormalizedAgentSessionConfig } from "../types.js";
import { createCommand, parseJsonLine, resolveModel } from "./common.js";

export const codexHarness: HarnessAdapter = {
	kind: "codex",
	buildCommand(config: NormalizedAgentSessionConfig) {
		const args = ["exec", "--json", "--skip-git-repo-check"];
		const model = resolveModel(config);

		if (model) {
			args.push("--model", model);
		}

		if (config.systemPrompt) {
			args.push(
				"-c",
				`developer_instructions=${JSON.stringify(config.systemPrompt)}`,
			);
		}

		if (config.permissions?.mode) {
			args.push(
				"-c",
				`approval_policy=${JSON.stringify(config.permissions.mode)}`,
			);
		}

		args.push(config.userPrompt);

		return createCommand(config, "codex", args);
	},
	parseStdoutLine(line, context) {
		return parseJsonLine("codex", line, context);
	},
	extractResult(events) {
		const message = [...events].reverse().find((event) => {
			if (!isRecord(event.raw)) {
				return false;
			}
			const item = event.raw.item;
			return isRecord(item) && item.type === "agent_message";
		});
		if (!message || !isRecord(message.raw) || !isRecord(message.raw.item)) {
			return undefined;
		}
		const text = message.raw.item.text;
		return typeof text === "string" ? text : undefined;
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
