# Versioned git hooks

Git does not version `.git/hooks/` by default, so fresh clones of this repo have no hooks installed. This directory holds canonical copies that can be installed into `.git/hooks/` with one command.

## Install

From the repo root:

```
./scripts/git-hooks/install.sh
```

It also configures the generated-content merge driver for the clone (see below). Existing `.git/hooks/<name>` files are backed up to `<name>.bak` on first install. Re-running the installer overwrites the active hooks but leaves the `.bak` in place.

## Hooks

- **pre-commit** — warns if committing directly to `main` (only the PA should do that), then runs `bun test compiler/tests/{unit,integration,conformance} --bail`. Skips the `browser` subdir (headless-browser flakiness). Fails the commit on any test failure. Since S468 the file set runs across parallel `bun test` processes via `scripts/test-sharded.ts` (shard count `SCRML_HOOK_SHARDS`, default min(cores/2, 8, (MemAvailable − `SCRML_HOOK_MEM_RESERVE_MB` 2048) / per-shard ceiling); `SCRML_HOOK_SHARDS=1` runs the original single-process command). Each shard is bounded by a wall-clock timeout (`SCRML_HOOK_SHARD_TIMEOUT_S`, 1200) and an RSS ceiling summed over its process group (`SCRML_HOOK_SHARD_MEM_MB`, 3072); either one kills that shard's process group only and fails the hook, naming the shard, its last file and its assigned files. Across every hook running on the machine, each shard holds one `flock`'d slot under `~/.cache/scrml/hook-slots/` (min(cores/2, MemTotal×0.8 / ceiling) slots, `SCRML_HOOK_SLOTS`); with none free a shard waits, up to `SCRML_HOOK_SLOT_WAIT_S` (1800) before failing, so concurrent commits cannot oversubscribe memory. The kernel releases a slot when its shard's processes die. pre-push's full-suite step uses the same switch.
- **post-merge**, **post-rewrite** (rebase only) — phase 2 of the generated-content merge driver (below). Inert unless the driver recorded pending content for THAT merge/rebase (the record is keyed to ORIG_HEAD); then runs `bun scripts/git-merge-generated.ts --regen` and leaves the regenerated files modified for you to commit. Only history-derived content (`recent-sessions`) relies on this — derived content both sides changed stops the merge instead.

## The generated-content merge driver (S468, revised S469)

`docs/known-gaps.md`, `master-list.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md` and `docs/bootstrap-conformance.md` carry GENERATED content: `@generated:*` sections, the SPEC-INDEX row line ranges, and the whole bootstrap report. Every PR regenerates it, so without help any two open PRs conflict on it. `.gitattributes` maps those files to `merge=scrml-generated`. git runs `scripts/git-merge-generated.sh`, a crash-safe wrapper, which runs `scripts/git-merge-generated.ts`:

1. **Hand-written text.** It is merged 3-way, and a conflict there still stops the merge (exit 1, normal markers). One exception: when every conflicted hunk is both sides **adding** distinct new `@gap` entries at the same spot, both are kept, ours first. That needs an empty base side, disjoint ids, and no identical line added on both sides.
2. **`@generated:gap-counts`** is **regenerated** exactly from the merged ledger text. The entries are merged first, then counted.
3. **Content derived from other files** cannot be derived inside the merge: a driver runs while the working tree still holds the pre-merge files (measured).
   - A section only **one** side changed takes that side's value.
   - A section **both** sides changed **stops the merge**: the file gets a `REGENERATION REQUIRED` marker block. Run `bun scripts/git-merge-generated.ts --regen`. It regenerates the file from the merged tree and stages it; then commit.
   - The exception is `recent-sessions`, which reads `git log`. It stays provisional, and the `post-merge` / `post-rewrite` hooks (or `--regen` after committing) regenerate it.
4. **Gap-id self-check.** Each `@gap` id's count goes through a 3-way, and the result must hold exactly that count; markers inside fenced code are ignored. A dropped entry, a double-filed entry, or an id whose count both sides changed fails the merge loudly.

**Fail closed.** The driver writes its result, then a sentinel file. If it exits without the sentinel, the wrapper rewrites the file as git's plain 3-way of the original inputs, **with markers**, under a `DRIVER FAILED` / `DRIVER UNAVAILABLE` block, and exits 1. That covers an import-time throw, a crash, an OOM kill, or no bun. So a failure never leaves pure ours unmarked.

**Install — per clone, automatic.** Merge drivers live in `.git/config`, not in the repo. `scripts/install-merge-driver.sh` is idempotent and is run by every `bun run pretest` and by `./scripts/git-hooks/install.sh`. It sets **only** `merge.scrml-generated.{name,driver}`, which every worktree of the clone shares.
- The attribute and the code always come from the **checked-out branch** (`.gitattributes`, `scripts/git-merge-generated.{sh,ts}`). Nothing is copied or mirrored into the git dir.
- So a branch that predates the driver gets git's normal merge, no worktree's WIP driver runs in another worktree's merge, and a revert takes effect immediately.
- `bash scripts/install-merge-driver.sh --uninstall` removes the config, plus any legacy `info/attributes` block or stored copy from the first cut.
- Opt out of the pretest install with `SCRML_SKIP_MERGE_DRIVER_INSTALL=1`.
- Check with `git config --get merge.scrml-generated.driver`.

**Pending records.** A pending record is keyed to the operation it came from (`ORIG_HEAD`). A record left by `git merge --abort` is dropped instead of being replayed on the next merge. `--pending` lists what is owed. The CI / pre-push currency gates (`facts.ts --check`, `regen-spec-index.ts --check`) remain the backstop.

**GitHub does not run custom merge drivers.** That includes GitHub's server-side merge and "Update branch", and any CI-side merge. A PR stays `dirty` on GitHub until its branch is updated locally (`git merge origin/main` with the driver installed) and pushed.

## Updating a hook

Edit the file in this directory, commit the change, then re-run `install.sh` (or ask teammates to). The versioned copy is the source of truth — do not edit `.git/hooks/<name>` directly; those edits are not tracked.

## Why not husky / lefthook / etc.

Zero dependencies, zero runtime cost, zero magic. A shell script and a one-line install. Fresh clones get hooks with one command.
