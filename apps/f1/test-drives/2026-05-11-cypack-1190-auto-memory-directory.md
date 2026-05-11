# Test Drive: CYPACK-1190 — autoMemoryDirectory for Slack chat sessions

**Date**: 2026-05-11
**Goal**: Verify the new Claude Code SDK `settings.autoMemoryDirectory` setting is threaded through `ClaudeRunner` for Slack-triggered chat sessions and is namespaced per Slack thread (`<workspacePath>/memory`).
**Test Repo**: `/tmp/cypack-1190-test` (minimal init repo)
**Cyrus Home**: `/tmp/cyrus-f1-1778542605771`
**F1 Port**: 3699

## Verification Results

### Chat dispatch endpoint (F1-only)
- [x] `POST /cli/dispatch-chat` returns `{ ok: true, eventId, threadKey }`
- [x] Route registered before `edgeWorker.start()` (Fastify rejects post-listen routes)
- [x] `dispatchChatTestEvent` reaches `ChatSessionHandler.handleEvent`

### autoMemoryDirectory wiring
- [x] `AgentRunnerConfig.autoMemoryDirectory` field added in `packages/core/src/agent-runner-types.ts`
- [x] `ClaudeRunnerConfig.autoMemoryDirectory` field added in `packages/claude-runner/src/types.ts`
- [x] `ClaudeRunner` forwards `settings: { autoMemoryDirectory }` to SDK `query()` options
- [x] `RunnerConfigBuilder.buildChatConfig` defaults to `join(workspacePath, "memory")`
- [x] `buildSanitizedQueryOptions` surfaces `settingsAutoMemoryDirectory` so the `claude_query_options` telemetry event includes it

### Per-thread namespacing
- [x] First dispatch to `C_TEST1` created workspace `slack-workspaces/C_TEST1_1778542611.55/`
- [x] Memory dir auto-created at `slack-workspaces/C_TEST1_1778542611.55/memory/` (mtime 1778542616)
- [x] Telemetry event reports `cqo.settingsAutoMemoryDirectory=/tmp/cyrus-f1-1778542605771/slack-workspaces/C_TEST1_1778542611.55/memory`

### Thread reuse (same channel + thread_ts)
- [x] Second dispatch with `--thread-ts 1778542611.55` reused the existing workspace (no new dir created)
- [x] Only one `C_TEST1_1778542611.55/` directory remained after the second dispatch

### Thread isolation (different channel)
- [x] Third dispatch to `C_TEST2` created a separate workspace `slack-workspaces/C_TEST2_1778542634.519/`
- [x] Separate memory dir at `slack-workspaces/C_TEST2_1778542634.519/memory/` (mtime 1778542636)
- [x] Telemetry event reports the new per-thread path

## Session Log

### Setup
```
$ mkdir /tmp/cypack-1190-test && cd /tmp/cypack-1190-test
$ git init -q && touch README.md && git add . && git commit -m init -q
$ CYRUS_PORT=3699 CYRUS_REPO_PATH=/tmp/cypack-1190-test bun run apps/f1/server.ts &
```

### Dispatches
```
$ curl -s -X POST http://localhost:3699/cli/dispatch-chat -d '{"channel":"C_TEST1","user":"U_TEST1","text":"hello"}'
{"ok":true,"eventId":"f1-1778542611.55","threadKey":"C_TEST1:1778542611.55"}

$ curl -s -X POST http://localhost:3699/cli/dispatch-chat -d '{"channel":"C_TEST1","user":"U_TEST1","text":"again","threadTs":"1778542611.55"}'
{"ok":true,"eventId":"f1-1778542631.493","threadKey":"C_TEST1:1778542611.55"}

$ curl -s -X POST http://localhost:3699/cli/dispatch-chat -d '{"channel":"C_TEST2","user":"U_TEST2","text":"isolated"}'
{"ok":true,"eventId":"f1-1778542634.519","threadKey":"C_TEST2:1778542634.519"}
```

### Workspace + memory dirs
```
$ ls slack-workspaces/
C_TEST1_1778542611.55
C_TEST2_1778542634.519

$ stat -f '%N %m' slack-workspaces/*/memory
.../C_TEST1_1778542611.55/memory 1778542616
.../C_TEST2_1778542634.519/memory 1778542636
```

### Telemetry (claude_query_options)
```
cqo.settingsAutoMemoryDirectory=/tmp/cyrus-f1-1778542605771/slack-workspaces/C_TEST1_1778542611.55/memory
cqo.settingsAutoMemoryDirectory=/tmp/cyrus-f1-1778542605771/slack-workspaces/C_TEST2_1778542634.519/memory
```

## Final Retrospective

What worked:
- The SDK creates the memory directory lazily — no explicit `mkdir` needed in `ChatSessionHandler.createWorkspace`.
- The `SlackChatAdapter`'s no-token bailout cleanly allows synthetic dispatches without touching Slack APIs.
- Surfacing `settingsAutoMemoryDirectory` in the telemetry sanitizer made verification trivial.

Issue caught during validation:
- Initial F1 route registration was after `edgeWorker.start()` and tripped `FST_ERR_INSTANCE_ALREADY_LISTENING`. Moved the `fastify.post` registration before `start()` and the route mounted cleanly.

Notes:
- Re-dispatch to the same thread didn't emit a fresh `claude_query_options` event because the existing runner is reused for additional prompts — that's the correct behavior, and the workspace/memory-dir-reuse check is still valid via the directory listing.
- Acceptance criteria for CYPACK-1190 met end-to-end.
