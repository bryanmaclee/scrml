# infra.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

NEW map this pass — the conditional check (`.github/workflows/**` present) now fires; it did not at the fbb4d9fd watermark's single-workflow state. scrml itself ships NO Docker/Terraform/k8s/serverless infra — this map covers only the two things that exist: the GitHub Actions CI surface and the docs-website hosting signal.

## Deployment
docs website: static site (docs/build.ts generator) — CNAME `scrml.dev` (docs/CNAME) + `package.json.homepage: https://bryanmaclee.github.io/scrml/` both point at a GitHub Pages target. **No deploy workflow exists in `.github/workflows/` at this HEAD** — neither `ci.yml` nor `advisory-review.yml` builds or publishes the docs site. The actual publish mechanism (GitHub Pages branch-source setting, a manual `bun run docs:build` + push, or an unmerged workflow) is not discoverable from the checked-out tree; treat docs-site deploy as undocumented/unverified.
scrml compiler itself: no deployment target — it is a CLI/library package (`bin: scrml`), not a hosted service. Generated (emitted) apps are deployed by their own authors; this repo has no opinion on that and ships no deploy tooling for them.

## Cloud Resources
None. No Terraform/CloudFormation/Pulumi, no cloud-provider SDK dependency, no `k8s/` manifests found in the repo.

## Docker
None. No Dockerfile / docker-compose.yml anywhere in the repo.

## CI/CD
Provider: GitHub Actions.
Workflows: `.github/workflows/ci.yml` (3 jobs: `gate` blocking, `tracking` + `windows` non-blocking), `.github/workflows/advisory-review.yml` (1 job: `ai-review`, advisory-only AI `/code-review`). Full stage-by-stage detail lives in build.map.md — not duplicated here.
Deploy trigger: none — neither workflow builds/publishes an artifact or deploys anywhere. Both are pure CI (test/lint/review), not CD.
Required-checks note: only `ci.yml`'s `gate` job is intended as a branch-protection required check (per the workflow's own header comment); `tracking`, `windows`, and `ai-review` are deliberately `continue-on-error`/advisory and must stay off that list.

## Not yet on `main` (informational — do not treat as current truth)
`.github/workflows/cloud-maps.yml` exists on the unmerged branch `feat/cloud-maps-beachhead` (commit 4f5a6b8d) — a scheduled + `workflow_dispatch` nav-map regeneration workflow (mints a `scrml-maps-bot` GitHub App token, runs `bun scripts/state.ts --write` + this project-mapper agent, opens an auto-merge `maps/regen-*` PR gated by `ci.yml`'s `gate`). Needs the `scrml-maps-bot` App install + `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets before a dispatch goes green. Flagging here (rather than mapping it as present) because it is not part of the checked-out tree at HEAD `f079d0a9`.

## Tags
#scrml #map #infra #ci #github-actions #docs-deploy #no-docker

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
