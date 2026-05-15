import type { HarnessAdapter, NormalizedAgentSessionConfig } from "../types.js";
import { createCommand, parseJsonLine, resolveModel } from "./common.js";

export const cursorHarness: HarnessAdapter = {
	kind: "cursor",
	buildCommand(config: NormalizedAgentSessionConfig) {
		const args = ["--print", "--output-format", "stream-json", "--trust"];
		const model = resolveModel(config);

		if (model) {
			args.push("--model", model);
		}

		if (
			config.permissions?.mode === "plan" ||
			config.permissions?.mode === "ask"
		) {
			args.push("--mode", config.permissions.mode);
		}

		if (
			config.permissions?.mode === "bypass" ||
			config.permissions?.mode === "auto"
		) {
			args.push("--force");
		}

		args.push(config.userPrompt);

		return createCommand(config, "cursor-agent", args);
	},
	parseStdoutLine(line, context) {
		return parseJsonLine("cursor", line, context);
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
