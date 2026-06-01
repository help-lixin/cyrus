/**
 * Single source of truth for the `cyrus-tool-exec` wrapper CLI contract.
 *
 * The wrapper is installed on cloud droplet images (cyrus-images Section A). It
 * runs an inner command inside an ephemeral cgroup v2 with a `memory.max`
 * budget and, on OOM, prints {@link OOM_MARKER} to stderr. Two EdgeWorker hooks
 * depend on this contract from opposite ends:
 *   - {@link buildMemoryLimitHook} (PreToolUse) *wraps* a command via
 *     {@link wrapCommand}.
 *   - the OOM report hook (PostToolUse) *detects* {@link OOM_MARKER}, parses it
 *     via {@link parseOomMarker}, and *unwraps* the command via
 *     {@link unwrapCommand} to recover a clean excerpt.
 *
 * Keeping the wrapped-command format, env-var name, binary path and marker in
 * one place means the producing and consuming hooks can never drift apart.
 */

/**
 * Absolute path to the wrapper binary. Its *existence* is the
 * deploy-order-independence guard: if the env gate is on but the image predates
 * the wrapper, the PreToolUse hook must stay a no-op (otherwise every Bash call
 * would fail with `127: command not found`).
 */
export const CYRUS_TOOL_EXEC_PATH = "/usr/local/bin/cyrus-tool-exec";

/** Env var carrying the per-command memory budget, in MB. */
export const MEMORY_MAX_MB_ENV = "CYRUS_TOOL_MEMORY_MAX_MB";

/**
 * The exact stderr prefix `cyrus-tool-exec` prints when the inner command is
 * OOM-killed. Must stay byte-for-byte in sync with the wrapper in cyrus-images.
 * Full line: `[cyrus-runtime] command killed: exceeded <cap>M memory budget
 * (peak <bytes> bytes).`
 */
export const OOM_MARKER = "[cyrus-runtime] command killed:";

/** Regex matching the prefix {@link wrapCommand} injects. */
const WRAPPER_PREFIX_RE = new RegExp(
	`^${MEMORY_MAX_MB_ENV}=\\d+\\s+cyrus-tool-exec\\s+`,
);

/**
 * POSIX single-quote a string so it survives intact as one shell word: wrap in
 * `'…'`, and replace every embedded `'` with the four-char sequence `'\''`
 * (close-quote, escaped-quote, reopen-quote). Safe for arbitrary content —
 * backticks, `$(...)`, double quotes, newlines, heredoc bodies — none are
 * interpreted inside single quotes.
 */
export function singleQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the wrapped command that runs `command` under the cgroup wrapper with a
 * `capMb` memory budget. The cap is injected **inline** (env prefix) so the
 * budget reaches the wrapper even if the SDK doesn't propagate env to the tool
 * subprocess; the original is single-quoted so arbitrary shell content survives.
 */
export function wrapCommand(command: string, capMb: string): string {
	return `${MEMORY_MAX_MB_ENV}=${capMb} cyrus-tool-exec ${singleQuote(command)}`;
}

/**
 * Best-effort reverse of {@link wrapCommand}: recover the user's original
 * command from a wrapped one. Returns the input unchanged when it doesn't carry
 * the wrapper prefix.
 */
export function unwrapCommand(command: string): string {
	if (!WRAPPER_PREFIX_RE.test(command)) {
		return command;
	}
	const quoted = command.replace(WRAPPER_PREFIX_RE, "");
	if (quoted.length >= 2 && quoted.startsWith("'") && quoted.endsWith("'")) {
		return quoted.slice(1, -1).replace(/'\\''/g, "'");
	}
	return quoted;
}

/** Numbers parsed from an {@link OOM_MARKER} line; every field is best-effort. */
export interface ParsedOomMarker {
	budgetMb?: number;
	peakBytes?: number;
}

/**
 * Extract the memory budget (`exceeded <cap>M`) and peak usage
 * (`peak <bytes> bytes`) from text containing the OOM marker. A field is
 * omitted when its token isn't found.
 */
export function parseOomMarker(text: string): ParsedOomMarker {
	const capMatch = text.match(/exceeded\s+(\d+)M/);
	const peakMatch = text.match(/peak\s+(\d+)\s+bytes/);
	const result: ParsedOomMarker = {};
	if (capMatch) {
		result.budgetMb = Number(capMatch[1]);
	}
	if (peakMatch) {
		result.peakBytes = Number(peakMatch[1]);
	}
	return result;
}
