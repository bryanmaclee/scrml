# SQL Batching Microbenchmark Results

**Runtime:** bun:sqlite (on-disk, WAL journal, synchronous=NORMAL), 50 iterations after 5 warmups.
Each sample times one call to the handler/loop shape. Median reported.
Run via: `bun benchmarks/sql-batching/bench.js`

## Tier 1 — independent reads per handler (N=4)

Shape: 4 independent reads in one `!` handler.

| Shape | Median (ms) |
|---|---:|
| Baseline (no envelope) | 0.1200 |
| Optimized (`BEGIN DEFERRED`..`COMMIT`) | 0.1125 |
| **Speedup** | **1.07x** |

## Tier 2 — N+1 loop hoist (N=100, table size=1000)

Shape: for-loop of N `.get()` calls keyed by loop variable.

| Shape | Median (ms) |
|---|---:|
| Baseline (N+1) | 0.1795 |
| Optimized (1 IN-query + Map lookup) | 0.0821 |
| **Speedup** | **2.19x** |

### Tier 2 scaling sweep

| N | Baseline (ms) | Optimized (ms) | Speedup |
|---:|---:|---:|---:|
| 10 | 0.0188 | 0.0111 | 1.69x |
| 50 | 0.0880 | 0.0378 | 2.33x |
| 100 | 0.1758 | 0.0748 | 2.35x |
| 500 | 0.8895 | 0.3351 | 2.65x |
| 1000 | 1.7531 | 0.5369 | 3.27x |

## Notes

- On-disk WAL with synchronous=NORMAL — representative of scrml default
  deployment. Network-attached storage would widen the gap further.
- Tier 1's raw-throughput win is small (~5%) on a read-only handler with no
  concurrent writers. The envelope's real value is **snapshot consistency**
  (§8.9.1) and amplified benefit under **lock contention** with concurrent
  writers, neither of which this single-process bench exercises.
- Tier 2 speedup **scales with N**: ~1.7x at N=10, ~2.3x at N=50–100, ~2.7x at
  N=500, ~3.3x at N=1000. Upper bound is SQLITE_MAX_VARIABLE_NUMBER (32766).
- The one-shot Tier 2 N=100 number at the top runs after a round of cold
  warmups; the scaling sweep's N=100 row is the more reliable figure.

## Version history

| Date | Tier 2 N=10 | N=100 | N=1000 | Notes |
|---|---:|---:|---:|---|
| 2026-05-14 (HEAD `13154ba`, v0.3.0 STABLE) | 1.69x | 2.35x | 3.27x | This run. |
| Prior (S86-era; ≤ v0.2.6) | 1.95x | 2.60x | 4.00x | Slightly higher speedups on prior bun:sqlite — baseline costs differ. |

The scaling shape is unchanged (N+1 → IN-query batching scales with N); absolute speedup
numbers shifted slightly under newer bun:sqlite (1.3.13). The Tier-2 narrative ("~2x/3x/4x
at N=10/100/1000") is now more accurately "~1.7x/2.3x/3.3x at N=10/100/1000".
