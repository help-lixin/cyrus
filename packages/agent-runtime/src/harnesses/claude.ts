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

		if (config.resumeHarnessSessionId) {
			args.push("--resume", config.resumeHarnessSessionId);
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
	extractSessionId(events) {
		// Claude Code's stream-json emits a `system` event with
		// `subtype: "init"` and a `session_id` at the start of every run.
		// That value is the only stable harness-native session id, and
		// `claude --resume <id>` accepts it verbatim. Scan in arrival
		// order — the first init carries the session id; later events
		// (assistant, result) repeat it but the init is canonical.
		for (const event of events) {
			if (!isRecord(event.raw)) continue;
			const sessionId =
				stringField(event.raw, "session_id") ??
				stringField(event.raw, "sessionId");
			if (sessionId) return sessionId;
		}
		return undefined;
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}
