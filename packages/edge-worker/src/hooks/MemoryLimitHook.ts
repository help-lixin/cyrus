import { existsSync } from "node:fs";
import type {
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
	PreToolUseHookInput,
} from "cyrus-claude-runner";
import type { ILogger } from "cyrus-core";
import {
	CYRUS_TOOL_EXEC_PATH,
	MEMORY_MAX_MB_ENV,
	wrapCommand,
} from "./cyrus-tool-exec.js";

/**
 * Env var gating the whole cloud-runtime feature. cyrus-hosted sets this to a
 * truthy value on cloud-runtime droplets and leaves it unset for self-host.
 * Kept identical to the `CYRUS_CLOUD_RUNTIME` gate used by the cloud-runtime
 * system-prompt addendum (CYPACK-1266) so both features share one signal.
 */
const CLOUD_RUNTIME_ENV = "CYRUS_CLOUD_RUNTIME";

/**
 * True when `CYRUS_CLOUD_RUNTIME` is set to a truthy value (`1` / `true` /
 * `yes`, case-insensitive). Matches the truthiness rule used elsewhere for this
 * same env var so the cloud gate behaves consistently across hooks.
 */
function isCloudRuntime(getEnv: (name: string) => string | undefined): boolean {
	const raw = getEnv(CLOUD_RUNTIME_ENV);
	if (!raw) return false;
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** Injectable seams for {@link buildMemoryLimitHook} (for testing). */
export interface MemoryLimitHookDeps {
	/** Reads an environment variable. Defaults to `process.env`. */
	getEnv?: (name: string) => string | undefined;
	/** Returns true when the cgroup wrapper binary exists. Defaults to `fs`. */
	wrapperExists?: () => boolean;
}

/**
 * Build the PreToolUse hook that, on cloud droplets, transparently wraps every
 * Bash command in `cyrus-tool-exec` so it runs under a per-command cgroup v2
 * memory budget. The shell-quoting and wrapped-command format live in
 * {@link wrapCommand} (see `cyrus-tool-exec.ts`); this hook owns only the
 * gating and the SDK input/output plumbing.
 *
 * The hook is a **strict no-op** (input unchanged) unless ALL of:
 *   - `CYRUS_CLOUD_RUNTIME` is truthy (explicit cloud gate — replaces any probe),
 *   - `CYRUS_TOOL_MEMORY_MAX_MB` is set (the per-tier budget), and
 *   - the wrapper binary exists on disk (deploy-order-independence guard).
 *
 * The whole body is wrapped in try/catch and fails open — a broken hook must
 * never block Claude from running a command.
 */
export function buildMemoryLimitHook(
	log: ILogger,
	deps: MemoryLimitHookDeps = {},
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	const getEnv = deps.getEnv ?? ((name: string) => process.env[name]);
	const wrapperExists =
		deps.wrapperExists ?? (() => existsSync(CYRUS_TOOL_EXEC_PATH));

	return {
		PreToolUse: [
			{
				matcher: "Bash",
				hooks: [
					async (input): Promise<HookJSONOutput> => {
						try {
							const pre = input as PreToolUseHookInput;

							// Gates — any failure means leave the command untouched.
							const cap = getEnv(MEMORY_MAX_MB_ENV);
							if (!isCloudRuntime(getEnv) || !cap || !wrapperExists()) {
								return { continue: true };
							}

							const toolInput = pre.tool_input as
								| { command?: unknown }
								| undefined;
							const command = toolInput?.command;
							if (typeof command !== "string" || command.length === 0) {
								return { continue: true };
							}

							return {
								continue: true,
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
									updatedInput: {
										...(toolInput as Record<string, unknown>),
										command: wrapCommand(command, cap),
									},
								},
							};
						} catch (err) {
							log.debug(
								`[MemoryLimitHook] failing open: ${(err as Error).message}`,
							);
							return { continue: true };
						}
					},
				],
			},
		],
	};
}
