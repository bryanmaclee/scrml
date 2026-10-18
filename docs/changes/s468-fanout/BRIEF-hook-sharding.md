# unit-id: s468-hook-sharding — run the hook test suites across processes (ruled S468 item 6)
Problem: scripts/git-hooks/pre-commit runs `bun test compiler/tests/unit compiler/tests/integration
compiler/tests/conformance compiler/tests/*.test.js --bail` in ONE process: ~16 min idle, ~45 min with 10 agents, on
a 32-core box. Every agent commit pays it; work sits unpushed meanwhile (a machine shutdown S468 caught 7 agents mid-hook).
BUILD: a runner (scripts/test-sharded.ts) that splits the same file set into N shards (N from env, default
min(cores/2, 8)), balanced by measured per-file duration (persist timings in a gitignored cache; fall back to file
size), runs `bun test <files>` per shard in parallel, streams/collects output, preserves `--bail` semantics (stop all
on first failure and print it), exits non-zero on any failure, prints totals (pass/fail/skip per shard and overall —
the totals must equal the sequential run's). Wire pre-commit (and pre-push's full-suite path) to it behind an env
switch (`SCRML_HOOK_SHARDS=1` to force sequential) — keep the sequential path one env var away.
MEASURE BEFORE REPLACING: run sequential vs sharded 5× each on origin/main; identical pass/fail/skip counts every run
and zero flakes; report wall time. Tests that share global state, ports, temp roots (the s448 tmp-root preload), the
samples dist fixtures, happy-dom registration (#1429) or `scrml dev` processes may break under parallelism — find them,
fix them by isolation (per-process temp roots, port 0) or pin them to one serial shard; never mark them skip. Report
the before/after timing and every test you had to isolate. Tooling only. Pre-commit hook (the OLD one) on your commits.
