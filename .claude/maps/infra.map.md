# infra.map.md
# project: scrml
# updated: 2026-09-03T06:16:21-06:00  commit: 2d8dd8cb
# generated-at: 2d8dd8cb — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** At this watermark
# `merge-base HEAD origin/main` == `origin/main` == `HEAD` == `2d8dd8cb`, so there is no second SHA to
# record and none is invented. MAP-STAMP RULE run at WRITE time, all three commands:
# `BASE=$(git merge-base HEAD origin/main)` -> `2d8dd8cb`; `git diff --name-only BASE..HEAD --
# compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json` -> **EMPTY**;
# `git merge-base --is-ancestor 2d8dd8cb origin/main` -> **exit 0**. Inbound check (invariant 48) also
# run: `git merge-base --is-ancestor ad7b65dc 2d8dd8cb` -> exit 0.
#
# ━━━━━━━ S396 wrap-6c — **STAMP ADVANCED. `ad7b65dc` -> `2d8dd8cb`, 7 COMMITS.** ━━━━━━━
#
# **THE COMPLETE SOURCE DELTA WAS WALKED, SO THE PARTIAL-PASS RULE IS SATISFIED RATHER THAN WAIVED.**
# `git diff --name-only ad7b65dc..2d8dd8cb` over `compiler/src` · `compiler/native-parser` · `stdlib` ·
# `scripts` · `lsp` · `conformance` is **FOUR source files**, and every one was read in full:
#   · `compiler/src/route-inference.ts` + `compiler/src/codegen/collect.ts` — **#818** (`c4c55c50`)
#   · `conformance/normalize.ts` — **#822** (`ae2741e7`)
#   · `compiler/src/commands/dev.js` — **#823** (`2d8dd8cb`)
# Also in the window: 3 test files changed, **2 NEW conformance cases**, and `docs/FACTS.md`.
# `.github/` is `--name-only` **EMPTY**, so `ci.yml` is byte-identical and the blocking `gate` job is
# FLAT at **14 total steps (12 `- name:` + 2 `- uses:`)** — stated both ways deliberately, because
# "14" and "12" are each correct under a different counting base and a bare number invites the
# ambiguity. Re-counted at this SHA by parse, not carried.
#
# **NO INFRA CHANGE THIS WINDOW** — `.github/workflows/` is byte-identical at this SHA (`git diff
# --name-only ad7b65dc..2d8dd8cb -- .github/` is EMPTY). Job shapes re-counted by parse, not carried:
# `gate` 14 total steps (12 named + 2 `uses:`), `tracking` 8 (6 + 2, `continue-on-error: true`),
# `windows` 4 (2 + 2, `continue-on-error: true`).
#

scrml itself ships NO Docker/Terraform/k8s/serverless infra — this map covers only what exists: the GitHub Actions CI surface and the docs-website hosting signal. **Re-verified at `e80b692e` (S313).** The material change since the prior stamp: `cloud-maps.yml`'s AI stage is GONE and `advisory-review.yml` is manual-fire only — see below.

## Deployment
docs website: static site (docs/build.ts generator) — CNAME `scrml.dev` (docs/CNAME) + `package.json.homepage: https://bryanmaclee.github.io/scrml/` both point at a GitHub Pages target. **No deploy workflow exists in `.github/workflows/` at this HEAD** — neither `ci.yml` nor `advisory-review.yml` builds or publishes the docs site. The actual publish mechanism (GitHub Pages branch-source setting, a manual `bun run docs:build` + push, or an unmerged workflow) is not discoverable from the checked-out tree; treat docs-site deploy as undocumented/unverified.
scrml compiler itself: no deployment target — it is a CLI/library package (`bin: scrml`), not a hosted service. Generated (emitted) apps are deployed by their own authors; this repo has no opinion on that and ships no deploy tooling for them.

## Cloud Resources
None. No Terraform/CloudFormation/Pulumi, no cloud-provider SDK dependency, no `k8s/` manifests found in the repo.

## Docker
None. No Dockerfile / docker-compose.yml anywhere in the repo.

## CI/CD
Provider: GitHub Actions.
Workflows — **THREE, all on `main`; only `ci.yml` changed this window** (⛑ **S391: #781-era — ONE NEW BLOCKING `gate` step, the compile-floor gate at `ci.yml:159`. No job, secret, runner or required-check NAME moved.** The prior window's change was #665 — a `tracking` step + a header correction):
- `.github/workflows/ci.yml` — 3 jobs: `gate` blocking (**14 TOTAL steps = 12 `- name:` + 2 `- uses:`; re-counted by parse at `2d8dd8cb`, and stated both ways because a bare "14" invited an ambiguity this pass had to re-derive — ⛑ S391 `13 -> 14`, the added step is `bun scripts/corpus-compile-floor.ts --check`; the prior window's +1 was `bun scripts/delta-lint.ts` (#652)**: the browser failure-NAME-SET gate and the SPEC §34.0 row-provenance gate; checkout `fetch-depth: 0` because the latter needs merge-base), `tracking` + `windows` non-blocking. **Triggers NOW: push `branches: [main]` (NEW #532 — see header), `pull_request`, and `workflow_dispatch: {}` (#454)** — `gh workflow run CI --ref <branch>`. It is now the ONLY recovery path when GitHub drops a webhook (it never re-delivers one; an outage left five PRs with zero checks and unmergeable, and force-push / close-reopen / new-commit / new-PR are all just another webhook into the same throttled pipe). **TWO measured constraints:** the dispatch reads the workflow definition FROM THE TARGET REF, so it returns `HTTP 422` on any branch cut before #454 — **prospective, not retroactive**, rebase or use `--ref main`; and a dispatched run's §34.0 provenance check falls back from `pull_request.base.sha` to `HEAD~1`, so rows added in earlier commits of the same branch are not seen as NEW. **It weakens no gate** — `gate` must still go green on the head SHA, `enforce_admins=true` untouched. `tracking`'s permanently-red raw browser run was replaced by the same NAME-SET check — which also **un-skipped the step behind it**, verified `skipped` on run `30742472551` and therefore never once executed.
- `.github/workflows/advisory-review.yml` — 1 job: `ai-review`. **DISABLED — `workflow_dispatch` only**, with a required `pr` input. The `pull_request:` trigger is gone.
- `.github/workflows/cloud-maps.yml` — 1 job: `regen`, still scheduled daily 09:17 UTC + `workflow_dispatch`. **Stage 2 (the project-mapper agent) was DELETED**; Stages 1 / 1b / 3 (deterministic, free) remain. `id-token: write` was dropped with it.

**Both removals are a COST decision by bryan, not a broken credential.** A permanently-red check is the `pa-base` §8 cry-wolf shape — it gets ignored, and then a real failure gets ignored with it. The prior generation of this map (and build.map.md) diagnosed the red as a probable credential/entitlement condition on `ANTHROPIC_API_KEY`; **that analysis is MOOT and has been deleted rather than carried.**

⛑ **WHAT EACH JOB ACTUALLY RUNS — RE-READ AT `2d8dd8cb`, BECAUSE TWO CONCLUSIONS WERE DRAWN WRONG
FROM GREPS THIS SESSION AND THEY POINT IN OPPOSITE DIRECTIONS.**

| job | blocking? | test tiers it runs |
|---|---|---|
| `gate` | **YES** (the only branch-protection required check) | `compiler/tests/unit` · `compiler/tests/conformance` · root-level `compiler/tests/*.test.js` |
| `tracking` | no (`continue-on-error: true`) | `compiler/tests/integration` · `compiler/tests/lsp` · **`compiler/tests/commands`** · `parser-conformance-within-node` |
| `windows` | no (`continue-on-error: true`) | `compiler/tests/unit` · `compiler/tests/conformance` |

⚑ **`compiler/tests/commands/` IS ADVISORY-ONLY ON EVERY PLATFORM.** It is in no blocking job here,
and in no local hook that actually executes on a normal push — a real §52.13 security assertion sat
RED there for an extended period with nothing failing. Full mechanism (including the pre-push nuance
that makes the naive statement false) in invariant 87.

⚑ **THE TOP-LEVEL `conformance/` CORPUS *IS* GATED, THOUGH NO WORKFLOW NAMES IT.** `bunfig.toml` pins
`[test] root = "compiler/tests/"`, so the repo-root `conformance/` dir is outside auto-discovery and
a workflow grep for it returns nothing. The gate is
`compiler/tests/conformance/corpus-bridge.test.js`, which sits under the gated root and imports
`conformance/run.ts`. All 893 corpus cases therefore ride `gate` **and** pre-commit. Invariant 88.

Full stage-by-stage detail lives in build.map.md — not duplicated here.
Deploy trigger: none — no workflow builds/publishes a deployable artifact. `cloud-maps` is the only one that WRITES to the repo, and it does so through a PR + auto-merge, never a direct push to protected `main`.
Required-checks note: only `ci.yml`'s `gate` job is a branch-protection required check; `tracking`, `windows`, `ai-review` and `cloud-maps`'s own job are deliberately `continue-on-error`/advisory/off-list and must stay off it.

**⚠️ THE OPERATIONAL FACT THIS MAP EXISTS TO CARRY: `.claude/maps/` IS NO LONGER REFRESHED ON A SCHEDULE.** With Stage 2 deleted, map regeneration reverts to the PA at wrap (contract wrap step 6c), where it lived before the workflow existed. Stages 1/1b still keep the `@generated` state rollup and thread index drift-checked — **the map set is not covered by anything.** A reader who assumes a nightly refresh will trust a stale stamp; the measured cost of that assumption in the previous two windows was 27 then 67 commits of drift.

## Repo secrets consumed by CI (names only)
`ANTHROPIC_API_KEY` — **`advisory-review.yml` ONLY** (`cloud-maps.yml` no longer references it). That job is `workflow_dispatch`-only, so **nothing consumes this secret automatically.** Treat it as UNSET / not-required; the absence is a deliberate cost decision. Any note claiming "IS set — the daily run passes it" is RETIRED.
`MAPS_PAT` — a fine-grained PAT (Contents R/W + Pull-requests R/W on this repo), used as the `cloud-maps.yml` checkout token and `GH_TOKEN` for the PR/auto-merge step. Required rather than `GITHUB_TOKEN` because a `GITHUB_TOKEN`-opened PR does not cascade events and would never fire `gate`. **Fine-grained PATs expire (≤1 yr) — renew before expiry or the bot goes dark.**

## Retired notes
### The `ANTHROPIC_API_KEY`-credential diagnosis of the old cloud-maps red is OBSOLETE
Not because it was disproved — because the leg it explained no longer exists. Do not re-open it.

### The `feat/cloud-maps-beachhead` / `scrml-maps-bot` framing is OBSOLETE
Prior generations of this map (and of build.map.md) said `cloud-maps.yml` lived on an unmerged
branch and needed a `scrml-maps-bot` GitHub App plus `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets.
**Both halves are wrong at this HEAD.** The workflow merged to `main` at `1971a87d` (2026-07-14) and
the App-token approach was replaced by the fine-grained `MAPS_PAT` at `b5ec120b` (2026-07-15).
Do not go looking for an App install.

## Tags
#scrml #map #infra #ci #github-actions #docs-deploy #no-docker #cloud-maps #maps-pat #anthropic-api-key #scheduled-workflow #branch-protection #ai-legs-killed #cost-decision #cloud-maps-stage2-deleted #advisory-review-disabled #no-scheduled-map-refresh #browser-baseline #failure-name-set #§34.0 #fetch-depth-0 #skipped-step-behind-red-step #workflow-dispatch #manual-refire #dropped-webhook #prospective-not-retroactive #422-target-ref #recovery-lever #ci-yml-15-lines #delta-lint-gate #step-name-truthfulness #no-infra-change #three-workflows #zero-infra-diff

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
