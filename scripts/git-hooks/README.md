# Versioned git hooks

Git does not version `.git/hooks/` by default, so fresh clones of this repo have no hooks installed. This directory holds canonical copies that can be installed into `.git/hooks/` with one command.

## Install

From the repo root:

```
./scripts/git-hooks/install.sh
```

It also configures the generated-content merge driver for the clone (see below). Existing `.git/hooks/<name>` files are backed up to `<name>.bak` on first install. Re-running the installer overwrites the active hooks but leaves the `.bak` in place.

## Hooks

- **pre-commit** — warns if committing directly to `main` (only the PA should do that), then runs `bun test compiler/tests/{unit,integration,conformance} --bail`. Skips the `browser` subdir (headless-browser flakiness). Fails the commit on any test failure.
- **post-merge**, **post-rewrite** (rebase only) — phase 2 of the generated-content merge driver (below). Inert unless the driver recorded pending content during that merge/rebase; then runs `bun scripts/git-merge-generated.ts --regen` and leaves the regenerated files modified for you to commit.

## The generated-content merge driver (S468)

`docs/known-gaps.md`, `master-list.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md` and `docs/bootstrap-conformance.md` carry GENERATED content (`@generated:*` sections, the SPEC-INDEX row line ranges, the whole bootstrap report). Every PR regenerates it, so without help any two open PRs conflict on it. `.gitattributes` maps those files to `merge=scrml-generated`, handled by `scripts/git-merge-generated.ts`:

1. merges only the **hand-written** text 3-way — a conflict there still stops the merge (exit 1, normal markers);
2. **regenerates** `@generated:gap-counts` exactly from the merged ledger text (it is derived from that same file's `@gap` markers — so the entries are merged first, then counted);
3. gives content derived from **other** files a provisional value and records it as pending — a driver runs while the working tree still holds the pre-merge files (measured), so it cannot derive it; the `post-merge`/`post-rewrite` hooks (or `bun scripts/git-merge-generated.ts --regen`) regenerate it from the merged tree afterwards;
4. self-checks the gap-id union: an `@gap` id present on either side that the merge would drop (and that no side deliberately deleted), or would duplicate, fails the merge loudly.

**Install — per clone.** Merge drivers live in `.git/config`, not in the repo: `./scripts/git-hooks/install.sh` sets `merge.scrml-generated.driver` (every worktree of the clone shares it; a fresh clone has none, and then git silently uses its normal merge — never worse than before). Check with `git config --get merge.scrml-generated.driver`. It also mirrors the `merge=scrml-generated` lines of `.gitattributes` into the clone's `info/attributes` (a managed block, re-derived each run): a merge reads `.gitattributes` from OURS' working tree, so without the mirror a branch cut before those lines landed would never invoke the driver, not even while merging a main that has them.

**After a merge that stopped on a hand-written conflict:** resolve, commit, then `bun scripts/git-merge-generated.ts --regen` and commit what it regenerates (`--pending` lists what is owed). The CI / pre-push currency gates (`facts.ts --check`, `regen-spec-index.ts --check`) are the backstop.

**GitHub does not run custom merge drivers.** A PR stays `dirty` on GitHub until its branch is updated locally — `git merge origin/main` with the driver installed — and pushed.

## Updating a hook

Edit the file in this directory, commit the change, then re-run `install.sh` (or ask teammates to). The versioned copy is the source of truth — do not edit `.git/hooks/<name>` directly; those edits are not tracked.

## Why not husky / lefthook / etc.

Zero dependencies, zero runtime cost, zero magic. A shell script and a one-line install. Fresh clones get hooks with one command.
