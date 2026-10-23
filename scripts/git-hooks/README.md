# Versioned git hooks

Git does not version `.git/hooks/` by default, so fresh clones of this repo have no hooks installed. This directory holds canonical copies that can be installed into `.git/hooks/` with one command.

## Install

From the repo root:

```
./scripts/git-hooks/install.sh
```

It also configures the generated-content merge driver for the clone (see below). Existing `.git/hooks/<name>` files are backed up to `<name>.bak` on first install. Re-running the installer overwrites the active hooks but leaves the `.bak` in place.

## Hooks

- **pre-commit** — warns if committing directly to `main` (only the PA should do that), then runs `bun test compiler/tests/{unit,integration,conformance} --bail`. Skips the `browser` subdir (headless-browser flakiness). Fails the commit on any test failure. Since S468 the file set runs across parallel `bun test` processes via `scripts/test-sharded.ts` (shard count `SCRML_HOOK_SHARDS`, default min(cores/2, ¾ of the slot pool, (MemAvailable − `SCRML_HOOK_MEM_RESERVE_MB` 2048) / per-shard budget `SCRML_HOOK_SHARD_BUDGET_MB` 1536); `SCRML_HOOK_SHARDS=1` runs the original single-process command). Each shard is bounded by a wall-clock timeout (`SCRML_HOOK_SHARD_TIMEOUT_S`, 1200) and an RSS ceiling summed over its process group (`SCRML_HOOK_SHARD_MEM_MB`, 3072); either one kills that shard's process group only and fails the hook, naming the shard, its last file and its assigned files. Across every hook running on the machine, each shard holds one `flock`'d slot under `~/.cache/scrml/hook-slots/` (min(cores/2, MemTotal×0.8 / budget) slots, `SCRML_HOOK_SLOTS`) and starts only while MemAvailable − reserve ≥ budget; with no slot or no memory a shard waits, up to `SCRML_HOOK_SLOT_WAIT_S` (1800) before failing, so concurrent commits cannot oversubscribe memory. The kernel releases a slot when its shard's processes die. pre-push's full-suite step uses the same switch.
  - **Bootstrap slices, when the staged diff touches their inputs (S469).** These are the native bootstrap's own suites: `compiler/self-host-v2/slice-m1` … `slice-m4` and `slice-codec`, including slice-m4's acceptance cases and the §66.19 drift tests. slice-m1 runs a second time with `SLICE_CORE=lowered`. The `bun scripts/lint-no-default-arm.js` lint runs too. Together they are exactly CI's `slices` bootstrap step; CI's e2e-render-map tier is not part of this.
    - **When they run.** Whenever any staged path (`git diff --cached --name-only --no-renames`, so both sides of a rename count) is under `compiler/self-host-v2/`, `compiler/src/`, `compiler/runtime/`, `compiler/native-parser/` or `conformance/`, or is one of these files: `compiler/SPEC.md`, `docs/known-gaps.md`, `scripts/{scrml-boot,gen-bootstrap-severity,s34-catalog,bootstrap-conformance,hybrid,state}.ts`, `scripts/lint-no-default-arm.js`, `compiler/tests/integration/security-await-pack/`, `compiler/tests/helpers/tmp-root-preload.js`, `bunfig.toml`, `package.json`, `bun.lock` or `scrml.toml`. Changing `scripts/test-sharded.ts` or the pre-commit hook itself also triggers them.
    - **Where the list comes from.** It is every tracked file that a full slice run opens, measured with inotify at S469. **`compiler/src/` is on it** because the slices compile the bootstrap with impl#1 (`slice-m1/harness.js` imports `compiler/src/api.js`), so a compiler change can break them. Most compiler commits therefore run them. If a slice starts reading a new file, add it to the `case` list in `pre-commit`.
    - **Otherwise** the hook prints `Bootstrap slices: skipped` and runs exactly the previous command. `SCRML_HOOK_SLICES=1` forces them on. There is deliberately no switch to turn them off.
    - **How they run.** They use the same `scripts/test-sharded.ts` run, as two extra path groups (`--group <slice dirs> --group=SLICE_CORE=lowered ./compiler/self-host-v2/slice-m1`). A group's files get shards of their own and never share a `bun test` process with `compiler/tests` files, as in CI, where they are a separate job. The slice dirs do share processes with each other: that is the combined-run shape whose page-error capture S469 fixed. slice-m4's two capture probes check it on every run, and both go red under a broken capture in this setup (mutation-checked at S469).
    - **Limits.** Slots, memory admission, the per-shard timeout and RSS ceiling, `--bail` and the fail-loud report apply to slice shards unchanged. The shard count N is shared out over the groups by estimated time.
    - **Single-process mode.** `SCRML_HOOK_SHARDS=1` runs them as `bun test <slice dirs> --bail` followed by the `SLICE_CORE=lowered` slice-m1 run.
    - **Cost (S469, 32-core box with other agents' hooks running).** Run alone, the slices take ~118 s sequentially (peak 2.1 GB, slice-m4), or ~53 s wall as 3 shards. Inside the hook they are ~2,950 more tests across 90 more file-runs. With a fixed N=12 they add roughly 25 s (median) to the hook's wall time: slice-change hooks took 112 / 133 / 157 s, against 94 / 108 / 111 / 158 s for the unchanged suite in the same window. The box's load noise is as large as the effect. Peak RSS across all shards was ~11 GB at N=12. A change that touches no slice input costs nothing extra; the trigger check is one `git diff --cached`.
  - **pre-push does not run the slices (S469 decision).** Three reasons:
    - Every pushed branch gets CI's `slices` job, and `gate` requires it.
    - Every commit that touches a slice input has already run them in pre-commit.
    - pre-push's own suite step already skips new-ref pushes, deferring them to CI (S254/S301).

    Adding the slices there would only re-check commits that pre-commit already checked, on update pushes. The real gaps are commits that ran no pre-commit at all:
    - A clean `git merge` / `git pull`, which runs no pre-commit. A merge of main can combine a `compiler/src` change with a bootstrap change, and neither side ever ran the slices against the other.
    - A clone without hooks.

    CI's `slices` job on the pushed branch catches both. If merge-made breakage starts reaching main, the fix is a `pre-merge-commit` hook running the same trigger, not a pre-push step.
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
