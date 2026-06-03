/**
 * Single source of truth for the `cyrus-tool-exec` wrapper CLI contract.
 *
 * `cyrus-tool-exec` is a small wrapper binary baked into the Cyrus managed-cloud
 * droplet image. It runs an inner command inside an ephemeral cgroup v2 with a
 * `memory.max` budget and, on OOM, prints {@link OOM_MARKER} to stderr. Two
 * EdgeWorker hooks depend on this contract from opposite ends:
 *   - {@link buildMemoryLimitHook} (PreToolUse) *wraps* a command via
 *     {@link wrapCommand}.
 *   - the OOM report hook (PostToolUseFailure) *detects* {@link OOM_MARKER},
 *     parses it via {@link parseOomMarker}, derives a program label via
 *     {@link extractProgramName}, and recovers the full command via
 *     {@link unwrapCommand}.
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
 * Strip the {@link wrapCommand} prefix, returning the inner command the user
 * actually asked to run (input unchanged when it isn't wrapped). At
 * PostToolUseFailure time the command has already been rewritten to
 * `<env> cyrus-tool-exec '<original>'`, so we must peel the wrapper off to see
 * (and report) the real command instead of our own boilerplate.
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

/** Leading `VAR=value` env-assignment token, e.g. the `FOO=bar` in `FOO=bar cmd`. */
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Directory-change builtins that consume the *rest of their `&&`/`;` segment*:
 * `cd /path` runs no program of interest, so the real program lives in the next
 * segment (e.g. `cd …/rust-analyzer && cargo build` → `cargo`, not `cd`).
 */
const SEGMENT_SKIP_BUILTINS = new Set(["cd", "pushd", "popd"]);

/**
 * Exec wrappers that prefix the *same* segment: they take their own flags and
 * `VAR=value` assignments, then hand off to the real program in the same
 * segment (e.g. `/usr/bin/time -v cargo build` → `cargo`; `env FOO=1 node` →
 * `node`). We skip the wrapper and its leading flags to reach the program.
 */
const EXEC_WRAPPER_BUILTINS = new Set([
	"env",
	"time",
	"nice",
	"nohup",
	"exec",
	"command",
	"stdbuf",
	"setsid",
]);

/** Find the program token in one `&&`/`;`-delimited segment, or "" if none. */
function programInSegment(segment: string): string {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	let i = 0;
	while (i < tokens.length) {
		// Skip leading `VAR=value` env assignments (inline env / secrets).
		if (ENV_ASSIGNMENT_RE.test(tokens[i] as string)) {
			i++;
			continue;
		}
		const base =
			(tokens[i] as string).split("/").pop() ?? (tokens[i] as string);
		// A bare `cd /path` segment has no program of interest — defer to the
		// next segment.
		if (SEGMENT_SKIP_BUILTINS.has(base)) {
			return "";
		}
		// `env`/`time`/… prefix the program: skip the wrapper plus its own flags,
		// then keep scanning for the real program in this same segment.
		if (EXEC_WRAPPER_BUILTINS.has(base)) {
			i++;
			while (i < tokens.length && (tokens[i] as string).startsWith("-")) {
				i++;
			}
			continue;
		}
		return base;
	}
	return "";
}

/**
 * Derive a best-effort program label for a (possibly wrapped) command: the
 * basename of the program actually being executed, with no arguments. Leading
 * `VAR=value` env assignments, `cd …/` directory changes, and exec wrappers
 * (`env`, `/usr/bin/time -v`, `nice`, …) are stripped so the label names the
 * real binary rather than shell boilerplate. Used for aggregation only — the
 * full command is reported separately.
 *
 *   `pnpm test --token=abc`                          -> `pnpm`
 *   `AWS_SECRET_ACCESS_KEY=… node build.js`          -> `node`
 *   `cd …/rust-analyzer && cargo build --release`    -> `cargo`
 *   `/usr/bin/time -v cargo build`                   -> `cargo`
 *   `<env> cyrus-tool-exec 'SECRET=x ./bin/run -k y'`-> `run`
 *
 * Returns "" when no program token can be identified.
 */
export function extractProgramName(command: string, max = 64): string {
	const inner = unwrapCommand(command);
	const firstLine = inner.split("\n", 1)[0] ?? "";
	// Split on shell sequencing operators; the first segment with a real program
	// wins (so a leading `cd …` segment is skipped).
	for (const segment of firstLine.split(/&&|\|\||;/)) {
		const program = programInSegment(segment);
		if (program) {
			return program.slice(0, max);
		}
	}
	return "";
}

/** Numbers parsed from an {@link OOM_MARKER} line; every field is best-effort. */
export interface ParsedOomMarker {
	budgetMb?: number;
	peakBytes?: number;
	/**
	 * Number of OOM kills recorded for the cgroup, parsed from an optional
	 * `oom_kill <n>` token the wrapper may append (e.g. `… (peak <bytes> bytes,
	 * oom_kill 2).`). Omitted when the wrapper doesn't emit it.
	 */
	oomKillCount?: number;
}

/**
 * Extract the memory budget (`exceeded <cap>M`), peak usage (`peak <bytes>
 * bytes`), and an optional OOM-kill count (`oom_kill <n>`) from text containing
 * the OOM marker. A field is omitted when its token isn't found.
 */
export function parseOomMarker(text: string): ParsedOomMarker {
	const capMatch = text.match(/exceeded\s+(\d+)M/);
	const peakMatch = text.match(/peak\s+(\d+)\s+bytes/);
	const oomKillMatch = text.match(/oom_kill\s+(\d+)/);
	const result: ParsedOomMarker = {};
	if (capMatch) {
		result.budgetMb = Number(capMatch[1]);
	}
	if (peakMatch) {
		result.peakBytes = Number(peakMatch[1]);
	}
	if (oomKillMatch) {
		result.oomKillCount = Number(oomKillMatch[1]);
	}
	return result;
}
