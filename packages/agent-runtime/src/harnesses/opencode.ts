import type { HarnessAdapter, NormalizedAgentSessionConfig } from "../types.js";
import { createCommand, parseJsonLine, resolveModel } from "./common.js";

export const opencodeHarness: HarnessAdapter = {
	kind: "opencode",
	buildCommand(config: NormalizedAgentSessionConfig) {
		const args = ["run", "--output-format", "json"];
		const model = resolveModel(config);

		if (model) {
			args.push("--model", model);
		}

		if (config.systemPrompt) {
			args.push("--system", config.systemPrompt);
		}

		args.push(config.userPrompt);

		return createCommand(config, "opencode", args);
	},
	parseStdoutLine(line, context) {
		return parseJsonLine("opencode", line, context);
	},
};
