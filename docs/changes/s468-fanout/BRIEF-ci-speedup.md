# unit-id: s468-ci-speedup — faster required CI + security tests that actually gate (ruled S468 "go on the CI speedup")
Read .github/workflows/ci.yml IN FULL (all jobs: gate, tracking, windows) and the two other workflows. Measured baseline
(run 39078887384, PR #1446): required `gate` ~19.7 min serial — unit+conformance 7m43, host-global alias gate 5m09,
browser tier 1m54, bootstrap slices 1m47, snippet gate 1m03, e2e-render-map 55s, ~15 small checks <30s; `tracking`
11 min (integration+lsp+commands — NOT required); `windows` 13 min (not required). Runner queueing observed: 25+ min
"pending" with ~10 open PRs × 3 jobs. Get more timings: `gh run list --workflow CI --limit 20` + `gh run view <id> --json jobs`.
DO:
1. Split `gate` into parallel jobs; keep a final aggregator job literally named `gate` that `needs:` all of them and fails
   if any failed/cancelled/skipped-unexpectedly (branch protection requires the check name `gate` — verify with
   `gh api repos/bryanmaclee/scrml/branches/main/protection` and do NOT change protection; if the aggregator approach
   cannot preserve the required check name, STOP and report).
2. Shard `bun test compiler/tests/unit compiler/tests/conformance` across a matrix (balanced; a shard list or file-size/
   timing split) — totals across shards must equal the unsharded run.
3. Host-global alias gate (scripts/host-global-scan.ts): profile why 5 min; parallelize/cache, or run it only when its
   inputs change (paths filter / changed-files check INSIDE the job so the job still reports success). Explain choice.
4. De-duplicate: browser tier, bootstrap-conformance check, pretest — each once.
5. PROMOTE compiler/tests/integration (incl. security-await-pack) into the required gate as its own sharded job(s).
   lsp + commands too if green. The known flaky test `§2 stopping scrml dev mid-respawn … SIGTERM` (fails in CI
   intermittently): find its file, fix the flake (it races process spawn) or move ONLY it to a non-required job — never
   skip it silently; report which. Any other test that fails/flakes when promoted: same treatment, listed.
6. `windows` job: run on push to main, a nightly `schedule`, and PRs whose changed files touch path handling (decide the
   path set from the job's stated purpose: `\` vs `/` OS-path bugs — compiler/src module resolution, CLI, file IO;
   justify) — via an in-job changed-files check so the job still reports. Not required (confirm).
7. Check GitHub merge queue availability for this repo (user-owned): `gh api repos/bryanmaclee/scrml` + docs; report
   yes/no with evidence; do NOT enable it.
PROVE: open the change as a PR and show its own CI run: wall time of the aggregator, per-job times, total test counts
equal to the old run (unit+conformance+integration counts reconciled), and a deliberately-failing commit on a scratch
branch that turns the aggregator `gate` red (bite proof — then delete the scratch branch). Report before/after.
Tooling only (.github/, scripts/). Local pre-commit hook on your commits; push after every commit.
