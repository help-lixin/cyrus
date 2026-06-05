#!/usr/bin/env node
// Phase 0 (network): validate Codex's native per-thread network permissions via
// the `experimental_network` config (domains allow/deny), with NO Cyrus egress
// proxy. Allowed domain should reach; denied domain should be blocked.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const CODEX_BIN = execFileSync("bash", [
  "-c",
  "find /Users/agentops/code/cyrus/node_modules/.pnpm -path '*@openai+codex@*-darwin-arm64*/vendor/*/codex/codex' | head -1",
]).toString().trim();

const workdir = mkdtempSync(join(homedir(), "codex-net-"));
execFileSync("git", ["init", "-q"], { cwd: workdir });
writeFileSync(join(workdir, "README.md"), "# net\n");
process.on("exit", () => { try { rmSync(workdir, { recursive: true, force: true }); } catch {} });

// Try whichever experimental_network shape the build honors. The harness reads
// EN_SHAPE to switch between the canonical `domains` map and legacy arrays.
const shape = process.env.EN_SHAPE || "domains";
const experimental_network =
  shape === "legacy"
    ? { enabled: true, allowed_domains: ["example.com"], managed_allowed_domains_only: true }
    : { enabled: true, domains: { "example.com": "allow" }, managed_allowed_domains_only: true };
console.log(`[net] experimental_network shape=${shape}: ${JSON.stringify(experimental_network)}`);

const child = spawn(CODEX_BIN, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"] });
let nextId = 1;
const pending = new Map();
const send = (method, params) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const respond = (id, result) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

let threadId = null;
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on("line", (line) => {
  const t = line.trim(); if (!t) return;
  let p; try { p = JSON.parse(t); } catch { return; }
  if (p.id !== undefined && (p.result !== undefined || p.error !== undefined)) {
    const e = pending.get(p.id); pending.delete(p.id);
    if (p.error) { console.log(`[net] <- #${p.id} ERROR ${JSON.stringify(p.error)}`); e?.rej?.(p.error); } else e?.res?.(p.result);
    return;
  }
  if (p.id !== undefined && p.method) { if (/auth/i.test(p.method)) respond(p.id, { chatgptAuthToken: null }); else respond(p.id, { decision: "accept" }); return; }
  if (p.method === "item/completed" && p.params?.item?.type === "commandExecution") {
    console.log(`[net] cmd exit=${p.params.item.exitCode}`);
    console.log(`[net] output:\n${String(p.params.item.aggregatedOutput || "").trim()}`);
  }
  if (p.method === "turn/completed") { console.log(`[net] turn ${p.params?.turn?.status}`); setTimeout(() => child.kill(), 400); }
});
child.stderr.on("data", (d) => { const s = d.toString().trim(); if (s) console.log(`[net][stderr] ${s.slice(0,200)}`); });
child.on("exit", () => process.exit(0));

(async () => {
  await send("initialize", { clientInfo: { name: "cyrus-net", version: "0.0.0" }, capabilities: { experimentalApi: true } });
  const start = await send("thread/start", {
    cwd: workdir,
    approvalPolicy: "never",
    sandbox: "workspace-write",
    config: {
      sandbox_workspace_write: { network_access: true },
      experimental_network,
    },
  });
  threadId = start?.thread?.id;
  console.log(`[net] threadId=${threadId}`);
  await send("turn/start", {
    threadId,
    input: [{ type: "text", text:
      "Run EXACTLY this one shell command and report its output verbatim:\n" +
      `curl -sS -m 8 -o /dev/null https://example.com 2>&1; echo "ALLOWED_EXIT=$?"; curl -sS -m 8 -o /dev/null https://api.github.com 2>&1; echo "DENIED_EXIT=$?"` }],
  });
})();
setTimeout(() => { console.log("[net] timeout"); child.kill(); }, 90000);
