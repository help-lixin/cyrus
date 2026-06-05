import { describe, expect, it } from "vitest";
import { CodexRunner } from "../src/CodexRunner.js";

describe("CodexRunner sandbox mode", () => {
	it("defaults to unsandboxed execution when no sandbox mode is configured", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
		});

		const threadOptions = (runner as any).buildThreadOptions();
		const configOverrides = (runner as any).buildConfigOverrides();

		expect(threadOptions.sandboxMode).toBe("danger-full-access");
		expect(configOverrides?.sandbox_workspace_write).toBeUndefined();
	});

	it("passes workspace-write sandbox config only when workspace sandbox is configured", () => {
		const runner = new CodexRunner({
			workingDirectory: process.cwd(),
			sandbox: "workspace-write",
		});

		const threadOptions = (runner as any).buildThreadOptions();
		const configOverrides = (runner as any).buildConfigOverrides();

		expect(threadOptions.sandboxMode).toBe("workspace-write");
		expect(configOverrides?.sandbox_workspace_write).toEqual({
			network_access: true,
		});
	});
});
