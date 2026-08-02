# infra.map.md
# project: scrml
# updated: 2026-08-02T18:40:00Z  commit: e80b692e
# NOTE (S313 pass): INCREMENTAL over `fe14c9b2` -> `e80b692e`. Re-walked because **all three
# workflows changed and the two Anthropic-billed legs were KILLED (#351)** — the prior stamp's
# analysis of a red `cloud-maps` is now moot, not merely stale.

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
Workflows — **THREE, all on `main`, and ALL THREE CHANGED this window**:
- `.github/workflows/ci.yml` — 3 jobs: `gate` blocking (**12 steps**, +2: the browser failure-NAME-SET gate and the SPEC §34.0 row-provenance gate; checkout now `fetch-depth: 0` because the latter needs merge-base), `tracking` + `windows` non-blocking. `tracking`'s permanently-red raw browser run was replaced by the same NAME-SET check — which also **un-skipped the step behind it**, verified `skipped` on run `30742472551` and therefore never once executed.
- `.github/workflows/advisory-review.yml` — 1 job: `ai-review`. **DISABLED — `workflow_dispatch` only**, with a required `pr` input. The `pull_request:` trigger is gone.
- `.github/workflows/cloud-maps.yml` — 1 job: `regen`, still scheduled daily 09:17 UTC + `workflow_dispatch`. **Stage 2 (the project-mapper agent) was DELETED**; Stages 1 / 1b / 3 (deterministic, free) remain. `id-token: write` was dropped with it.

**Both removals are a COST decision by bryan, not a broken credential.** A permanently-red check is the `pa-base` §8 cry-wolf shape — it gets ignored, and then a real failure gets ignored with it. The prior generation of this map (and build.map.md) diagnosed the red as a probable credential/entitlement condition on `ANTHROPIC_API_KEY`; **that analysis is MOOT and has been deleted rather than carried.**

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
#scrml #map #infra #ci #github-actions #docs-deploy #no-docker #cloud-maps #maps-pat #anthropic-api-key #scheduled-workflow #branch-protection #ai-legs-killed #cost-decision #cloud-maps-stage2-deleted #advisory-review-disabled #no-scheduled-map-refresh #browser-baseline #failure-name-set #§34.0 #fetch-depth-0 #skipped-step-behind-red-step

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
