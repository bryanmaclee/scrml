# infra.map.md
# project: scrml
# updated: 2026-07-28T17:15:00Z  commit: 115e8b1b

scrml itself ships NO Docker/Terraform/k8s/serverless infra — this map covers only what exists: the GitHub Actions CI surface and the docs-website hosting signal. **Re-verified at `115e8b1b` (S297).** The one material change since the prior stamp is that `cloud-maps.yml` is now MERGED, SCHEDULED and FAILING — see below.

## Deployment
docs website: static site (docs/build.ts generator) — CNAME `scrml.dev` (docs/CNAME) + `package.json.homepage: https://bryanmaclee.github.io/scrml/` both point at a GitHub Pages target. **No deploy workflow exists in `.github/workflows/` at this HEAD** — neither `ci.yml` nor `advisory-review.yml` builds or publishes the docs site. The actual publish mechanism (GitHub Pages branch-source setting, a manual `bun run docs:build` + push, or an unmerged workflow) is not discoverable from the checked-out tree; treat docs-site deploy as undocumented/unverified.
scrml compiler itself: no deployment target — it is a CLI/library package (`bin: scrml`), not a hosted service. Generated (emitted) apps are deployed by their own authors; this repo has no opinion on that and ships no deploy tooling for them.

## Cloud Resources
None. No Terraform/CloudFormation/Pulumi, no cloud-provider SDK dependency, no `k8s/` manifests found in the repo.

## Docker
None. No Dockerfile / docker-compose.yml anywhere in the repo.

## CI/CD
Provider: GitHub Actions.
Workflows — **THREE, all on `main`**:
- `.github/workflows/ci.yml` — 3 jobs: `gate` blocking (7 steps as of this window), `tracking` + `windows` non-blocking.
- `.github/workflows/advisory-review.yml` — 1 job: `ai-review`, advisory-only AI `/code-review`.
- `.github/workflows/cloud-maps.yml` — 1 job: `regen`, scheduled daily 09:17 UTC + `workflow_dispatch`. **CURRENTLY FAILING (17/17 runs).** See build.map.md for the full step list and the failure analysis.

Full stage-by-stage detail lives in build.map.md — not duplicated here.
Deploy trigger: none — no workflow builds/publishes a deployable artifact. `cloud-maps` is the only one that WRITES to the repo, and it does so through a PR + auto-merge, never a direct push to protected `main`.
Required-checks note: only `ci.yml`'s `gate` job is a branch-protection required check; `tracking`, `windows`, `ai-review` and `cloud-maps`'s own job are deliberately `continue-on-error`/advisory/off-list and must stay off it. **`cloud-maps` being red therefore blocks no merge** — its cost is silent map staleness, which is exactly what happened here (no automated refresh since 2026-07-16, the watermark stranded at `c700c435` across three sessions of landings).

## Repo secrets consumed by CI (names only)
`ANTHROPIC_API_KEY` — `advisory-review.yml` + `cloud-maps.yml` Stage 2. **IS set** (the cloud-maps run log shows it passed as `***`); prior map generations claiming "unset today" are stale. The cloud-maps failure signature (1 turn, ~0.6s, $0, `is_error: true`) points at a credential/entitlement condition on THIS secret as the most probable cause — see build.map.md.
`MAPS_PAT` — a fine-grained PAT (Contents R/W + Pull-requests R/W on this repo), used as the `cloud-maps.yml` checkout token and `GH_TOKEN` for the PR/auto-merge step. Required rather than `GITHUB_TOKEN` because a `GITHUB_TOKEN`-opened PR does not cascade events and would never fire `gate`. **Fine-grained PATs expire (≤1 yr) — renew before expiry or the bot goes dark.**

## Retired note — the `feat/cloud-maps-beachhead` / `scrml-maps-bot` framing is OBSOLETE
Prior generations of this map (and of build.map.md) said `cloud-maps.yml` lived on an unmerged
branch and needed a `scrml-maps-bot` GitHub App plus `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets.
**Both halves are wrong at this HEAD.** The workflow merged to `main` at `1971a87d` (2026-07-14) and
the App-token approach was replaced by the fine-grained `MAPS_PAT` at `b5ec120b` (2026-07-15).
Do not go looking for an App install.

## Tags
#scrml #map #infra #ci #github-actions #docs-deploy #no-docker #cloud-maps #maps-pat #anthropic-api-key #scheduled-workflow #ci-failing #branch-protection

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
