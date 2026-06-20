---
needs: action
from: sPA ss2 (engine-codegen-statechild)
to: PA
date: 2026-06-19 (S209)
---

# sPA ss2 — list COMPLETE (all 5 dispositioned), ready for re-integration

## ACTION: re-integrate `spa/ss2` → main

- **Branch:** `spa/ss2` · **tip SHA:** `0cbc99fd` · **6 commits ahead** of `origin/main` (5 item commits + 1 list-complete summary).
- **Base:** `c734ec35`. `origin/main` advanced to `256c81b6` (+3: SPEC despace Part B `4e7fa0f0`
  + deputy ticks 96/97) DURING the run. **Base divergence touched ONLY `compiler/SPEC.md`
  (+ deputy-state / a progress doc).** Every ss2 SOURCE file is base-identical between
  c734ec35 and 256c81b6 → **clean source merge**. The ONE merge point is SPEC.md (residual #1).
- Every code commit passed the pre-commit full suite (browser-excluded). Final integrated
  `bun run test` (incl. browser): **24618 pass / 0 fail / 231 skip / 1 todo** across 1035 files (128.5s), exit 0 — zero regressions.
- Per-item detail: `spa-lists/ss2.progress.md` (on branch).

## Landed on branch (5 commits)

| item | SHA | what |
|------|-----|------|
| 1 `engine-boot-effect-invalid-transition` | `bd4c1b34` | §51.0.H Form-3 opener-effect BOOT write-validation. New SYM fire-site #11 in `validateEngineA5Extensions`; reuses `scanDirectWritesInStateChildBody` + the fire-site-#9 `switch(r.kind)` membership check against the initial state-child's rule; fires the EXISTING `E-ENGINE-INVALID-TRANSITION`. Un-skip `engine-opener-effect-c1.test.js` §3 + 5 new cases. **R4 footprint correction: lands at SYM, NOT type-system.ts** (the test drives `runSYM` only). 0 corpus illegal-boot-writes surfaced. |
| 4 `g-shorthand-interp-engine-element-loci` | `a4eeaf34` | Engine state-child `:`-shorthand body (§51.0.I) was silently dropped. `buildEngineArms` now derives the body from `sc.bodyRaw` when `sc.isColonShorthand`, mirroring the resolved match-arm pattern (S196 Bucket 4): display-text-literal → `displayTextLiteralInner`→`nativeParseFile`; markup; bare-expr. Export `displayTextLiteralInner` from emit-match.ts. §4.14 emit-html plain-element locus verified ALREADY-CORRECT (no change). 12 tests. |
| 3 `type-system-payloadbindings-dedup` | `ff196ce8` | Dedup the engine state-child grammar sets to a shared SSOT: NEW `compiler/src/engine-statechild-grammar.ts` (outside ./codegen/ so the TS can import it); type-system.ts + emit-variant-guard.ts import it, local literals deleted. Codegen set verified member-identical. ZERO behavior change (suite delta = +5 = new guard test only). |
| 5 `engine-component-scope-b17-e2e-deferred` | `ee7ef180` | **PARTIAL.** Survey of the 8 B17 `test.skip` placeholders: 6 cases (effect-ambiguous; `<onTransition>` placement + to=/from= direction; `<onTransition>`/effect= in `<match>` arm → E-MATCH-*-FORBIDDEN) had STALE blockers — validations already land (S74 B17.3, S107 block-match) and fire end-to-end. Activated test-only (NO source change). Cases 1-3 PARKED (see below). |
| 2 `g-engine-server-flag-silent-swallow` | `8cd2282e` | Bare `<engine ... server>` (no `=@source`) was parsed-and-dropped → 0 diagnostics. Capture the bare flag at the parser (`ast-builder.js` → `engineDecl.serverFlagBare`, attr-aware) + fire NEW `W-ENGINE-SERVER-DEFERRED` (severity warning → `result.warnings`) at SYM, pointing to the wired `server=@source` E-leg. emit-engine.ts unchanged (flag inert). NEW §34 row. 12 tests + 13 within-node re-baselines. **R4 footprint correction: bare flag isn't captured at parse, so needs ast-builder.js (not SYM-only).** |

## Parked (1 item, 3 cases — surfaced + continued, did NOT halt the run)

**item 5 cases 1-3** — an `<engine>` declared INSIDE a component BODY (`const Card =
<div><engine .../></div>`), in 3 shapes: defChildren-via-parser, raw-body engine-decl, and
`<EngineName/>` mount tag. **Precondition: a FROM-SCRATCH component-body markup parser.**
Today `ast-builder.js:~10370` stores a component body as `component-def.raw: string` —
nothing re-parses it into walkable AST; `defChildren` (`~15007`) collects only logic-body
siblings; the §51.3 engine collector (`~15607`) never descends into `raw`. Empirically an
`<engine>` in a component body yields `defChildren===[]`, `machineDecls.length===0`,
unreachable. The PASS-11 reject walker is ALREADY correct (exercised via synthesized AST
§B17.1-9) — cases 1-3 activate for FREE once the parser produces the shape. **Out of sPA
scope (from-scratch subsystem; shape resembles Bucket-B each-inline-component-instance
Approach A).** The 3 skips now carry refreshed, accurate blocker comments.

## New residuals to file (PA-owned)

1. **SPEC §34 row reconciliation (item 2) — ACTION NEEDED.** `W-ENGINE-SERVER-DEFERRED` is a
   NEW diagnostic code = a SPEC §34 addition (PA owns SPEC). The row was authored faithfully
   to the `known-gaps.md:196` prescription and inserted **on spa/ss2's PRE-DESPACE SPEC.md
   base** (after `W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE`, ~line 17148). Since despace
   (`4e7fa0f0`) reformatted §34 on main, **the merge will conflict on SPEC.md — resolve by
   placing the row at the same anchor in the despaced §34.** This is the only non-clean merge.
2. **native-parser server-family feature-stale (item 2).** The native parser records neither
   `serverSource` NOR `serverFlagBare`; full within-node parity needs a native sync
   (`feedback_native_parser_scrml_mirror_feature_stale`). 13 within-node allowlist
   re-baselines landed (engine fixtures gain `serverFlagBare` legacy-side, MISSING-FIELD).
3. **grammar-dedup follow-on (item 3).** The reserved-attr set is actually 5-wide, not 2-wide.
   3 more member-identical copies were NOT migrated (scope discipline, S88):
   `engine-statechild-parser.ts:102` (`RESERVED_STATE_CHILD_ATTRS`),
   `native-walker/engine-statechild-walker.ts:273` (`RESERVED_PAYLOAD_ATTRS`),
   `symbol-table.ts:6672` (inline). Clean follow-on dedup (noted in the new module header).
4. **payloadBindings consumer swap (item 3).** type-system.ts:170 could read
   `entry.payloadBindings` (now populated by B15) instead of the reserved-attrs set;
   deferred — a semantic inversion (skip-reserved → process-only-bound), not a literal swap,
   no byte-identical proof.
5. **component-body markup parser (item 5 parked).** The subsystem that unblocks b17 cases
   1-3; consider routing to a design/feature track.

## Notes
- **R4 footprint corrections** (both verified against the SPEC/test harness, not the list text):
  item 1 lands at SYM (not type-system.ts — the test runs `runSYM`); item 2 needs an
  ast-builder.js parser capture (the bare flag isn't parsed at all, not just unhandled at SYM).
- Items 2 + 5 agents branched off `256c81b6` (main advanced mid-run); items 1/3/4 off
  `c734ec35`. Landings used file-delta for base-identical files, a `git apply` patch for
  symbol-table.ts (item 2 over item 1's disjoint regions), and a manual §34 row insert.
- Worktree `../scrml-spa-ss2` left in place (sibling, outside `.claude/worktrees/`) for PA
  re-integration. No main HEAD advance, no push (sPA contract). PA owns merge + known-gaps
  reconciliation + the §34 row reconciliation + wrap.
