---
name: release-core-test
description: Invoke when dev-testing a Cyrus change that spans CYPACK (edgeworker + CLI) and CYHOST (Vercel-hosted GUI) and the hosted GUI needs to point at an unreleased `cyrus-core` from this repo. Publishes `cyrus-core` (and `claude-runner` if needed) as a `-test.N` prerelease under the npm `test` dist-tag so CYHOST can install it via `cyrus-core@test` without affecting the `latest` dist-tag or shipping a real release.
---

# Release Core (Test)

Publish ONLY the `cyrus-core` package (and `claude-runner` if needed) as a dev/test prerelease to npm under the `test` dist-tag. This is a developer convenience for iterating on `cyrus-core` without going through the full release flow.

## What this skill does NOT do

This skill is intentionally minimal. It does **NOT**:

- Update `CHANGELOG.md` or `CHANGELOG.internal.md`
- Create a git tag
- Create a GitHub release
- Move any Linear issues
- Open a pull request
- Commit the version bump (the bumped `package.json` is left as a local working-tree change)

It also does NOT publish any other workspace package (no `edge-worker`, no `cyrus` CLI, no `linear-event-transport`, etc.). The only exception is `claude-runner`, which is republished if and only if its `workspace:*` reference would otherwise resolve to an unpublished version (see step 3 below).

## Workflow

### 1. Install dependencies from repo root

```bash
pnpm install
```

### 2. Build all packages from repo root

```bash
pnpm build
```

Building all packages ensures `workspace:*` dependencies are resolved before publishing.

### 3. Determine whether `claude-runner` needs republishing

`cyrus-core` depends on `claude-runner` via `workspace:*`. When `cyrus-core` is published, that `workspace:*` is rewritten to the version currently in `packages/claude-runner/package.json`. If that version isn't actually on npm yet (because `claude-runner` has local changes since its last publish), consumers installing `cyrus-core@test` will fail to resolve the dependency.

Check:

```bash
# Current local version
node -p "require('./packages/claude-runner/package.json').version"

# What's on npm
npm view cyrus-claude-runner versions --json
```

If the local version of `claude-runner` is NOT already published on npm (or has uncommitted/unreleased source changes you want included), republish it as a test prerelease:

```bash
# Determine the next -test.N for claude-runner (same algorithm as cyrus-core below)
# Bump packages/claude-runner/package.json to e.g. 0.0.X-test.N
cd packages/claude-runner
pnpm publish --access public --no-git-checks --tag test
cd ../..
pnpm install   # refresh lockfile so cyrus-core picks up the new claude-runner
```

Otherwise, skip this step entirely.

### 4. Bump `cyrus-core` to the next `-test.N` prerelease version

Algorithm:

1. Read the current version from `packages/core/package.json` (e.g. `0.1.22`).
2. Bump the patch (e.g. `0.1.23`).
3. Append `-test.N`, starting at `N = 0` and incrementing if `<bumped>-test.N` already exists on npm.

For example, if the current version is `0.1.22`:

- Try `0.1.23-test.0`.
- If `npm view cyrus-core@0.1.23-test.0 version` returns a value, try `0.1.23-test.1`, then `-test.2`, etc.

To check existing prereleases:

```bash
npm view cyrus-core versions --json
```

Write the chosen version back into `packages/core/package.json`. Do NOT commit this change — leave it as a local working-tree edit so the developer can decide whether to keep it.

### 5. Publish `cyrus-core` with the `test` dist-tag

```bash
cd packages/core
pnpm publish --access public --no-git-checks --tag test
cd ../..
```

Using `--tag test` means:

- `npm install cyrus-core@test` will install this version.
- The `latest` dist-tag is **not** moved, so production installs (`npm install cyrus-core`) are unaffected.

### 6. Print install instructions

After publishing, print both forms so the developer can copy/paste:

```
Published cyrus-core@<version> under dist-tag `test`.

Install with:
  npm install cyrus-core@test
or pinned:
  npm install cyrus-core@<version>
```

If `claude-runner` was also republished in step 3, include its version too.

## Key Notes

- Always use `--no-git-checks` so you can publish from a feature branch with a dirty working tree.
- Always use `--tag test` so the `latest` dist-tag is preserved for real releases.
- Prerelease versions (anything with a `-` suffix like `-test.0`) are never auto-installed by `npm install cyrus-core` without an explicit tag or version spec, so this is safe to run repeatedly.
- Run `pnpm install` after publishing `claude-runner` (if applicable) so the lockfile reflects the new published version before `cyrus-core` is built/published.

## Examples

- "release core test" - Run a dev release of cyrus-core
- "/release-core-test" - Invoke this skill
