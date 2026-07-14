# sPA ss66 → PA — RE-INTEGRATE `spa/ss66` (discovery pointer + independent verification)

**Status:** COMPLETE. **Branch:** `spa/ss66` · **Branch tip:** `fec5412b` (base `40b580c5`) · **not yet merged**.
**List:** `spa-lists/ss66-conformance-sql-schema-codes.md`.

## Why this pointer exists
ss66 was fully executed by the **first** ss66 sPA — it committed everything (5 cases + annotated list +
`spa-lists/ss66.progress.md` + a full re-integration message) into `fec5412b`. But it committed its
re-integration message **on the branch** (`handOffs/incoming/2026-07-12-spa-ss66-reintegration.md`), so it is
**invisible from `main`** (where you scan for ready branches — ss63/64/65/67 messages sit untracked in main's
inbox, ss66's did not). This pointer surfaces ss66 to that scan. **The authoritative, detailed hand-off is the
on-branch message — read it at re-integration.**

## Independent adversarial verification (this second ss66 boot)
I re-verified the first sPA's work from scratch rather than trust the markers:
- **5 landed cases PASS** — `bun conformance/run.ts` in the worktree = **391/391** (386 base + 5). Cases:
  `sql/{bad-conn-prefix-neg (E-SQL-005), batch-warn-info (W-BATCH-001), clean-pos}`,
  `schema/{schema-003-neg (E-SCHEMA-003), clean-pos}`.
- **All 18 parked reasons independently CONFIRMED** via my own `compiler/src` grep (emit-site counts) + `compile()`
  probes. The breakdown holds exactly:
  - **13 SPEC-vs-compiler GAPs** (code catalogued in §8.6/§39.12, **0 emit sites** in `compiler/src`): E-SQL-002,
    E-SQL-007, E-SCHEMA-001/002/004/005/006/007/008/009, W-SCHEMA-001/003.
  - **5 wired-but-not-`compile(source)`-reachable**: E-SQL-004 (falls back to `:memory:`), E-SQL-006 (`.prepare()`
    → runtime IIFE; fires only via `rewriteSqlRefs()`), E-SQL-008 (pre-empted by E-CTX-003; fires only via
    `parseExpression()`), E-BATCH-001 (`transaction{}` mis-parses to E-SCOPE-001; needs hand-built AST →
    `runBatchPlanner`), E-BATCH-002 (runtime throw, not a compile diagnostic) — plus W-SCHEMA-002 (migration-diff time).
- The first sPA's two SPEC-discrepancy flags are correct: **W-BATCH-001 / W-SCHEMA-001/002/003 are `warning`, not
  the list's `"info"`** (verified `byCode["W-BATCH-001"]==="warning"`); and `batch-warn-info` needs the deprecated
  `server` modifier to reach the planner.

**No changes made by this boot.** The branch is complete and correct; I added no cases and made no branch commit
(all 18 remaining items are genuinely unauthorable as `compile(source)` conformance cases). The worktree is clean at `fec5412b`.

## Headline escalation for the PA (a design ruling, not more sPA authoring)
**Most of SPEC §8.6 + §39.12 is not compile-time code-pinnable as the list assumed** — the `<schema>` DSL body is
essentially unvalidated on the string-compile path (only the E-SCHEMA-003 placement check runs). Ruling needed:
**implement the 13 zero-emission codes, or strike/downgrade the SPEC "SHALL emit" claims** (each is a candidate
diagnostic-bug ticket). The 5 wired-but-unreachable codes need a harness seam (sub-`compile()` / migration / runtime)
— likely a later wave or the ss67 runtime surface.

## ⚠ Environment regression the first sPA flagged (still worth your confirmation)
The dispatched dev-agent's `isolation:"worktree"` did **not** isolate — it ran in the shared `main` checkout and
left its 5 case dirs as untracked files in main. The first sPA copied them to the `spa/ss66` worktree, committed,
and removed the leak from main. **I re-checked main just now: no `conformance/cases/{sql,schema}/` leak remains**
(main is at `55b49ff1`, clean of ss66 files). But confirm the isolation regression is understood before the next
fan-out — multiple sPAs sharing one checkout is a real hazard.
