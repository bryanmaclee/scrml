# Versioned git hooks

Git does not version `.git/hooks/` by default, so fresh clones of this repo have no hooks installed. This directory holds canonical copies that can be installed into `.git/hooks/` with one command.

## Install

From the repo root:

```
./scripts/git-hooks/install.sh
```

Existing `.git/hooks/<name>` files are backed up to `<name>.bak` on first install. Re-running the installer overwrites the active hooks but leaves the `.bak` in place.

## Hooks

- **pre-commit** — warns if committing directly to `main` (only the PA should do that), then runs `bun test compiler/tests/{unit,integration,conformance} --bail`. Skips the `browser` subdir (headless-browser flakiness). Fails the commit on any test failure. Since S468 the file set runs across parallel `bun test` processes via `scripts/test-sharded.ts` (shard count `SCRML_HOOK_SHARDS`, default min(cores/2, 8); `SCRML_HOOK_SHARDS=1` runs the original single-process command). pre-push's full-suite step uses the same switch.

## Updating a hook

Edit the file in this directory, commit the change, then re-run `install.sh` (or ask teammates to). The versioned copy is the source of truth — do not edit `.git/hooks/<name>` directly; those edits are not tracked.

## Why not husky / lefthook / etc.

Zero dependencies, zero runtime cost, zero magic. A shell script and a one-line install. Fresh clones get hooks with one command.
