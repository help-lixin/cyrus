import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ComputeSdkSandboxLike,
	createComputeSdkSandboxProvider,
	createLocalSandboxProvider,
} from "../src/sandbox/index.js";

describe("LocalSandboxProvider", () => {
	it("creates a local sandbox with filesystem and command execution", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-runtime-local-"));
		try {
			const provider = createLocalSandboxProvider({ workingDirectory: root });
			const sandbox = await provider.create({ provider: "local" });

			expect(sandbox.provider).toBe("local");
			expect(sandbox.capabilities.filesystem).toBe(true);
			expect(sandbox.capabilities.runCommand).toBe(true);
			expect(sandbox.capabilities.streamingProcess).toBe(false);

			await sandbox.filesystem.mkdir("nested");
			await sandbox.filesystem.writeFile("nested/hello.txt", "hello");

			await expect(
				sandbox.filesystem.readFile("nested/hello.txt"),
			).resolves.toBe("hello");
			await expect(sandbox.filesystem.exists("nested/hello.txt")).resolves.toBe(
				true,
			);
			await expect(sandbox.filesystem.readdir("nested")).resolves.toMatchObject(
				[{ name: "hello.txt", type: "file", size: 5 }],
			);

			const result = await sandbox.runCommand(
				"node -e \"console.log(process.cwd()); console.error('err')\"",
			);

			expect(result.exitCode).toBe(0);
			expect(await realpath(result.stdout.trim())).toBe(await realpath(root));
			expect(result.stderr.trim()).toBe("err");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("ComputeSdkSandboxProvider", () => {
	it("wraps an injected compute object and forwards filesystem and command calls", async () => {
		const calls: unknown[] = [];
		const fakeSandbox: ComputeSdkSandboxLike = {
			sandboxId: "sbx_123",
			provider: "daytona",
			workingDirectory: "/remote/workspace",
			filesystem: {
				async readFile(path) {
					calls.push(["readFile", path]);
					return "remote contents";
				},
				async writeFile(path, contents) {
					calls.push(["writeFile", path, contents]);
				},
				async mkdir(path) {
					calls.push(["mkdir", path]);
				},
				async readdir(path) {
					calls.push(["readdir", path]);
					return [{ name: "remote.txt", type: "file" }];
				},
				async exists(path) {
					calls.push(["exists", path]);
					return true;
				},
				async remove(path) {
					calls.push(["remove", path]);
				},
			},
			async runCommand(command, options) {
				calls.push(["runCommand", command, options]);
				return { exitCode: 7, stdout: "out", stderr: "err", durationMs: 5 };
			},
			async destroy() {
				calls.push(["destroy"]);
			},
		};
		const compute = {
			sandbox: {
				async create(options: Record<string, unknown>) {
					calls.push(["create", options]);
					return fakeSandbox;
				},
			},
		};

		const provider = createComputeSdkSandboxProvider({ compute });
		const sandbox = await provider.create({
			provider: "daytona",
			id: "requested-id",
			name: "agent-runtime-test",
			workingDirectory: "/requested/workspace",
			templateId: "template-1",
			timeoutMs: 10_000,
			metadata: { issue: "CYR-1" },
		});

		expect(sandbox.sandboxId).toBe("sbx_123");
		expect(sandbox.provider).toBe("daytona");
		expect(sandbox.workingDirectory).toBe("/remote/workspace");
		expect(sandbox.capabilities.streamingProcess).toBe(false);

		await sandbox.filesystem.mkdir("/tmp/project");
		await sandbox.filesystem.writeFile("/tmp/project/remote.txt", "contents");
		await expect(
			sandbox.filesystem.readFile("/tmp/project/remote.txt"),
		).resolves.toBe("remote contents");
		await expect(sandbox.filesystem.readdir("/tmp/project")).resolves.toEqual([
			{ name: "remote.txt", type: "file" },
		]);
		await expect(
			sandbox.filesystem.exists("/tmp/project/remote.txt"),
		).resolves.toBe(true);
		await sandbox.filesystem.remove("/tmp/project");

		await expect(
			sandbox.runCommand("node --version", {
				cwd: "/tmp/project",
				env: { A: "1" },
			}),
		).resolves.toMatchObject({
			exitCode: 7,
			stdout: "out",
			stderr: "err",
			durationMs: 5,
		});
		await sandbox.destroy();

		expect(calls).toEqual([
			[
				"create",
				{
					timeout: 10_000,
					templateId: "template-1",
					metadata: { issue: "CYR-1" },
					namespace: undefined,
					name: "agent-runtime-test",
					directory: "/requested/workspace",
					volumes: undefined,
					networkEgress: undefined,
				},
			],
			["mkdir", "/tmp/project"],
			["writeFile", "/tmp/project/remote.txt", "contents"],
			["readFile", "/tmp/project/remote.txt"],
			["readdir", "/tmp/project"],
			["exists", "/tmp/project/remote.txt"],
			["remove", "/tmp/project"],
			[
				"runCommand",
				"node --version",
				{ cwd: "/tmp/project", env: { A: "1" } },
			],
			["destroy"],
		]);
	});
});
