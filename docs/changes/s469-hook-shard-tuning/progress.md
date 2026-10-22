# s469-hook-shard-tuning — progress

Measure the pre-commit gate's sharding and tune it: the same file set, the same tests and the same gate. These
are the runner's own settings; nothing is bypassed or skipped.

## Box
AMD Ryzen 9 9955HX: 16 physical cores / 32 threads (SMT), 30 GB RAM. The box is shared, and other agents' hooks
ran during every measurement: 1-6 other `test-sharded` runners, load average 15-55. All numbers below carry that
noise. No quiet window occurred.

## Before (origin/main ea871fdfe)
Explicit N via `SCRML_HOOK_SHARDS`, the hook's exact args. Each run used a private timing-cache copy and so a
private slot pool, because other agents' hooks held the shared pool. The first N=4 run used the shared pool: it
waited 210 s for slots and finished in 427 s, against a 218 s slowest shard.

| N | wall (runs) | median | peak RSS total | worst shard | notes |
|---|---|---|---|---|---|
| 4 | 237.6 | 237.6 | 5.5 GB | 2.4 GB | the second run collided with my own overlapping run (in-repo `_tmp_` dir); discarded |
| 8 | 129.2 / 167.1 / 151.4 | 151.4 | 7.7-7.9 GB | 2.0 GB | ~1500 CPU-s; ~10 cores average |
| 12 | 136.1 / 117.3 | ~127 | 11.7 GB | 1.9 GB | balanced; every shard within ~5 s of the others |
| 16 | 139.3 / 116.4 | ~128 | 12.9-13.4 GB | 1.7 GB | bounded by shard 0, corpus-bridge alone (116-139 s) |
| 24 | FAIL / FAIL | — | — | — | false-red at ~13 s: a ~1 s file's first compile exceeded bun's 5 s per-test timeout (CPU starvation) |

The default on this box was never 8. It was `min(16, 8, (MemAvailable-2048)/3072)` = **5-7**, limited by memory
because the 3072 MB kill ceiling doubled as the planning budget. The pool was `min(16, 30 GB*0.8/3072)` = **8 slots
for every hook on the machine combined**, about 10 of 32 threads. With 3-5 agents committing, each hook got
~2 slots, which explains the reported ~10 min.

## Bottleneck analysis
- **Pool size (dominant under concurrency).** 8 slots per machine; a second hook queued behind the first
  (186-211 s waits measured).
- **Memory budget (dominant alone).** Default N was set by `/3072`. The real per-shard average is 0.85-1.0 GB and
  the worst shard 1.9-2.4 GB.
- **The cap of 8.** It never applied here; memory gave 5-7 first.
- **Stragglers.** They matter only at N >= 16. The four largest files run 60-116 s each depending on load. At
  N <= 12 the plan stays balanced.
- **CPU / SMT.** Per-file time inflates with concurrency: the sum of file times was 934 s at N=4, 1204 s at N=8
  and 1688 s at N=16. The box has 16 real cores, so throughput flattens past ~16 concurrent shards, and past that
  the 5 s per-test timeout turns contention into false reds. The pool is therefore a correctness bound too.
- **Setup per shard.** Negligible: bun start ~10 ms, compiler import ~0.45 s. `compile-test-samples.sh` is a
  one-time ~3 s and is not in the hook.

Top 15 by measured time (mean of two N=8 runs under contention, in seconds):
| s | file |
|---|---|
| 87.9 | integration/trucking-dispatch-smoke-integration.test.js |
| 86.4 | conformance/corpus-bridge.test.js |
| 82.2 | integration/security-await-pack/await-probe-pack.test.js |
| 77.0 | integration/bootstrap-conformance-counter/bootstrap-conformance-counter.test.js |
| 46.7 | integration/dev-db-no-side-file.test.js |
| 37.1 | integration/expr-parity.test.js |
| 32.7 | unit/s457-host-global-alias.test.js |
| 22.6 | integration/s465-server-text-guard.test.js |
| 20.7 | integration/validate-emit-gate.test.js |
| 19.4 | unit/s462-handler-runtime-helpers-shipped.test.js |
| 16.6 | integration/s465-await-arm-r4.test.js |
| 16.4 | integration/security-failable-pack/failable-probe-pack.test.js |
| 14.7 | integration/s465-await-r6.test.js |
| 12.1 | integration/s465-await-r5.test.js |
| 10.6 | integration/s465-await-arm-r2.test.js |

## Change (scripts/test-sharded.ts)
- `SCRML_HOOK_SHARD_BUDGET_MB` (1536) is the expected per-shard RSS. It sizes the default N, the pool and
  admission. The 3072 MB kill ceiling is unchanged.
- Pool: `min(cores/2, MemTotal*0.8/budget)`, which is 16 here (was 8).
- Default N: `min(cores/2, pool*3/4, (MemAvailable-reserve)/budget)`, which is 12 here (the fixed 8 is gone).
- **Memory admission.** A shard starts only while `MemAvailable - reserve >= budget`, or when its run has no
  shard running. Otherwise it waits like a busy slot, bounded by slot-wait, and then the run FAILS. This replaces
  the old static guarantee that slots x ceiling <= 0.8 RAM. It fired in practice: in two concurrent-pair runs a
  shard waited at 3.5 GB available.
- Not done: splitting the straggler files. At the new default (N <= 12) they don't bound the wall. They become the
  next lever only for N >= 16, which this SMT box can't use.

## After: default config, A/B interleaved, 3 rounds
Old and new runners ran on identical trees, alone and as a concurrent pair sharing one pool. The pair used two
tree copies, because two runs in one tree collide on in-repo `_tmp_` dirs.

| | old (N 5-6, pool 8) | new (N 9-11, pool 16) |
|---|---|---|
| alone, walls | 288.5 / 136.2 / 177.9 | 99.9 / 125.3 / 134.8 |
| alone, median | **177.9** | **125.3** (-30%) |
| pair, faster / slower | 237/390 · 193/331 · 236/379 | 117/188 · 188/262 · 181/241 |
| pair, median of slower | **379** | **241** (-36%) |
| pair, median mean-per-hook | **307** | **211** (-31%) |
| peak RSS, one hook | 5.8-6.4 GB | 8.4-10.7 GB |

The real gate on commit adebadbb8 used the shared pool, with other agents' hooks holding slots. It ran N=10, two
shards waited 88 s, and it took 180.8 s in total, green.

Every run was green with identical counts (38742 pass / 0 fail / 125 skip / 13 todo, 1614 files). Old's alone-1
ran at load 49 and new's alone-1 at load 18, so read the medians, not single runs.
