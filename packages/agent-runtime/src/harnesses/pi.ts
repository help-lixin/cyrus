import type { HarnessAdapter, NormalizedAgentSessionConfig } from "../types.js";
import { createCommand, parseJsonLine, resolveModel } from "./common.js";

export const piHarness: HarnessAdapter = {
	kind: "pi",
	buildCommand(config: NormalizedAgentSessionConfig) {
		const args = ["run", "--json"];
		const model = resolveModel(config);

		if (model) {
			args.push("--model", model);
		}

		if (config.systemPrompt) {
			args.push("--system", config.systemPrompt);
		}

		args.push("--prompt", config.userPrompt);

		return createCommand(config, "pi", args);
	},
	parseStdoutLine(line, context) {
		return parseJsonLine("pi", line, context);
	},
};
