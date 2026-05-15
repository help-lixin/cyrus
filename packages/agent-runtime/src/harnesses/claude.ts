import type { HarnessAdapter, NormalizedAgentSessionConfig } from "../types.js";
import { createCommand, parseJsonLine, resolveModel } from "./common.js";

export const claudeHarness: HarnessAdapter = {
	kind: "claude",
	buildCommand(config: NormalizedAgentSessionConfig) {
		const args = [
			"-p",
			config.userPrompt,
			"--output-format",
			"stream-json",
			"--verbose",
		];
		const model = resolveModel(config);

		if (model) {
			args.push("--model", model);
		}

		if (config.systemPrompt) {
			args.push("--append-system-prompt", config.systemPrompt);
		}

		if (config.permissions?.mode) {
			args.push("--permission-mode", config.permissions.mode);
		}

		if (config.permissions?.allowedTools?.length) {
			args.push("--allowedTools", config.permissions.allowedTools.join(","));
		}

		if (config.permissions?.disallowedTools?.length) {
			args.push(
				"--disallowedTools",
				config.permissions.disallowedTools.join(","),
			);
		}

		return createCommand(config, "claude", args);
	},
	parseStdoutLine(line, context) {
		return parseJsonLine("claude", line, context);
	},
	extractResult(events) {
		const result = [...events].reverse().find((event) => {
			return event.kind === "result" && isRecord(event.raw);
		});
		return result &&
			isRecord(result.raw) &&
			typeof result.raw.result === "string"
			? result.raw.result
			: undefined;
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
