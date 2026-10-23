# CI notes

Workflows live in `workflows/`. The required check on `main` is the `gate` aggregator in `ci.yml`. `main` is protected by ruleset 25356240, which requires a pull request, `gate` and the merge queue, with no bypass actors. Every automated write therefore goes in through a PR.

## Generated docs: which are gated, and where

| doc | producer | PR-side | kept current on `main` by |
|---|---|---|---|
| `docs/FACTS.md` | `scripts/facts.ts` | **warns** when stale (exit 1); fails only on a broken measurement (2) or a missing anchor (3) | `facts-regen.yml`, after every merge |
| `compiler/SPEC-INDEX.md` | `scripts/regen-spec-index.ts` | blocking (`checks`) and pre-push | the PR that edits `SPEC.md` |
| `docs/bootstrap-conformance.md` | `scripts/bootstrap-conformance.ts` | blocking only when the PR touches `conformance/cases` or `compiler/self-host-v2`; `tracking` reports it otherwise | the PR that changes the corpus or the bootstrap |
| `docs/known-gaps.md` `@generated:gap-counts` | `scripts/state.ts` | not CI-gated; derived only from the same file, so a PR's table always agrees with its own gap markers | the PR that adds or resolves gaps (`cloud-maps.yml` does not stage this file) |

## FACTS: regenerated on main after merge (S469)

Owner ruling, S469: "Regenerate on main after merge." FACTS holds repo-wide totals that most landings move. 48 of the 78 landings between 2026-10-10 and 2026-10-22 changed it. A PR's FACTS edit was stale, and in textual conflict, as soon as any other PR landed.

The flow, in `facts-regen.yml`:

1. Every push to `main` (and `workflow_dispatch`) runs `bun scripts/facts.ts --write` on main's **current** tip.
2. If there is no drift, nothing happens, and a leftover bot PR is closed.
3. If there is drift, the job makes one commit on top of the tip and force-pushes it to the fixed branch `bot/facts-regen`. It opens a PR from that branch, or reuses the open one, and enables auto-merge. The PR goes through `gate` and the merge queue like any other PR.
4. When that PR lands, its push re-runs the job, which finds a fixpoint: FACTS.md is not an input to any figure in it. So there is no loop.

The job also does not race. `concurrency: facts-regen` with `cancel-in-progress` keeps only the newest run alive, and there is only ever one bot branch and one bot PR. An open bot PR that already carries the right figures is not force-pushed, so it is not dequeued.

**What this means for a PR author:**

- Don't commit a FACTS.md regen. It only conflicts with the bot's.
- The CI step and the pre-push hook print a warning. That's expected.

**Token:** the job writes with the `MAPS_PAT` secret, the fine-grained PAT that `cloud-maps.yml` also uses (Contents R/W, Pull-requests R/W). The default `GITHUB_TOKEN` can't be used, because a PR it opens does not trigger `gate`, so the queue would never take it. Fine-grained PATs expire. When `MAPS_PAT` lapses, both bot workflows go red at checkout. Merges aren't blocked, since neither is a required check, but FACTS drifts until the PAT is renewed. Then re-fire with `gh workflow run facts-regen`.
