import type { HarnessAdapter, NormalizedAgentSessionConfig } from "../types.js";
import { createCommand, parseJsonLine, resolveModel } from "./common.js";

export const geminiHarness: HarnessAdapter = {
	kind: "gemini",
	buildCommand(config: NormalizedAgentSessionConfig) {
		const args = ["--output-format", "stream-json"];
		const model = resolveModel(config) ?? "gemini-2.5-pro";

		args.push("--model", model, "--yolo");

		if (config.permissions?.mode && config.permissions.mode !== "default") {
			args.push("--approval-mode", config.permissions.mode);
		}

		args.push("-p", config.userPrompt);

		return createCommand(config, "gemini", args, {
			env: {
				GEMINI_SYSTEM_MD: config.systemPrompt,
			},
		});
	},
	parseStdoutLine(line, context) {
		return parseJsonLine("gemini", line, context);
	},
};
