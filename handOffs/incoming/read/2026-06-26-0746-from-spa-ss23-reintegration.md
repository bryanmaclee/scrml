# sPA ss23 — re-integration (library-mode + foreign-inline codegen seam)

**From:** sPA ss23 · **To:** PA · **Date:** 2026-06-26 0746 MDT
**List:** `spa-lists/ss23-library-mode-foreign-codegen.md` · **Branch:** `spa/ss23` · **Tip SHA:** `2f8b7bbb`
**Base:** origin/main `cf9f1109` (all ss23 deps confirmed present: df6f747b, the W5a/W5b SCOPE doc, S145 library shaping). spa/ss23 = base + 3 fix commits, clean linear, `0 3` divergence → clean merge. (Local main is far ahead at `a1e10727` = your ss21/ss22/ss27 re-integrations; ss23's surface is untouched by those.)

## End state: items 1 + 3 FIXED; item 2 = W5a LANDED + W5b PARKED (subsystem).

| # | Item | Tier | Landed SHA | Disposition |
|---|---|---|---|---|
| 1 | g-safecall-bang-handler-not-lowered-in-library-mode | MED | `714faaec` | FIXED (giti reporter) |
| 3 | g-foreign-inline-crossing-shadow | LOW | `4f1da876` | FIXED — adds SPEC E-FOREIGN-006 |
| 2 | g-library-mode-sql-no-db-context | MED | `2f8b7bbb` (W5a) | **W5a FIXED · W5b PARKED → PA (own list)** |

Per-item BRIEF.md under `docs/changes/ss23-*-2026-06-26/`.

## Per-item detail

**Item 1** — locus `emit-library.ts` (not codegen/index.ts as I footprinted). Library mode's whole-block extraction path did textual slicing + regex only — never routed function bodies through `emitLogicNode`, so `safeCall(...) !{...}` survived VERBATIM → E-CODEGEN-INVALID-JS (byte 238). Fix: `collectGuardedExprs` + `lowerGuardedExprsInBlock` span-splice the EXISTING `guarded-expr` lowering into the library block path (no re-implementation, no program-mode change). node --check clean; adversarial pass; gate 17854/0.

**Item 3** — pre-emit crossing-shadow scan (`scanForeignSliceTopLevelBindings`) in emit-logic.ts `case "foreign"` → clear **E-FOREIGN-006** naming the shadowed name (replacing the misleading "compiler defect" E-CODEGEN cascade); the redeclaring IIFE → defensive `null`. **Decision: ERROR** (the E-FOREIGN family 001-005 is uniformly ERROR + a crossing-shadow always yields invalid JS). **NOTE: adds a SPEC change** — E-FOREIGN-006 row (§23.2.6 + §34) + normative §23.2.4a paragraph + SPEC-INDEX regen. The diagnostic was footprinted (the brief named `E-FOREIGN-006`); flagging the SPEC touch for your ratification at re-integration. Also a narrow `foreignCrossingErrors` sink in emit-server.ts (foreign-bearing fns are server-only). Gate 17853/0.

**Item 2 — W5a LANDED, W5b PARKED (survey-first worked exactly as intended).**
- **W5a (auto-detect-library):** classify a no-`<program>`, exports-bearing file as `library` WITHOUT `--mode library` — a build-wide mode flip in api.js (keyed on `!hasProgramRoot && all-non-markup && exports>0`; reuses the existing `isPureModuleFile` signal + S145/§12.6 shaping) + a one-line CLI change (compile.js: `--mode` starts UNSET so explicit `--mode browser` stays authoritative). **~2h actual vs the ~3-6h headline.** Any real app (≥1 `<program>`) stays browser (the `allPureFnModules` guard requires ALL inputs pure-fn). Gate 25227/0.
- **W5b — PARKED → PA as its own list (~13-22h subsystem).** **SCOPE-DOC CORRECTION (important):** the SCOPE doc framed W5b as "extend `<program db>` resolution" — empirically WRONG. The db-resolution already works (`collectDbScopes` handles §44.7.1 Form-2 `<db src>`). The REAL blocker: `emit-library.ts` is a **regex-based source-text slicer** that never invokes the structured per-statement SQL-lowering path, so `?{}` leaks verbatim → E-CODEGEN-INVALID-JS. W5b sub-steps: (1) route db-bearing library `export server function`s through the structured emit-server SQL path (~6-10h, structural emit-library rewrite); (2) cross-file db-context travel — §44.7.1 "a `<program db>` ancestor SHALL NOT override the module's own `<db>`; the module owns its connection" (~4-8h, unbuilt; likely needs a SPEC micro-ruling on HOW the connection is carried — module-local `new SQL()` vs injected); (3) narrow E-SQL-009 to genuine no-`<db>` (~1-2h); (4) tests/R26 (~2h). Hits all 3 STOP triggers — recommend its own ss-list.

## flogence reply (OWED — partially unblocked)
Items 1 (safecall `!{}` in library mode, reporter **giti**) + W5a (auto-detect) let flogence author **pure-fn LIBRARIES** (its dispatch/store **logic** layer) in scrml today — no `--mode library` flag, compiles as ES modules. Its **SQL layer** (`?{}` against its own `<db src>`) stays on the TS bridge/digest until the **W5b subsystem** lands. Reply to giti + flogence accordingly.

## Verification
- Each landing passed the full pre-commit blocking gate on the integrated branch.
- Integrated library/foreign sweep on spa/ss23 (final): **62 pass / 0 fail across 4 files** (emit-library, foreign-inline, library-auto-detect + globs). All 3 items file-disjoint (item1 emit-library.ts · item3 emit-logic/emit-server/SPEC · W5a api.js/compile.js) — zero reconcile conflicts.
- Branch coherence: tip `2f8b7bbb`, base+3 linear, tree clean.

## Process notes
- Weekly limit had reset overnight; all 3 agents completed cleanly (no infra failures).
- S112 base-currency + S220 scratchpad-race discipline in every brief (no incidents).
- One footprint locus refinement (item 1 → emit-library.ts) + one SCOPE-doc correction (W5b real blocker is the regex slicer, not db-resolution).

## Cleanup (PA-owned)
Agent worktree branches (all landed): `worktree-agent-{ab15e44b3d510e933 (item1), a7a74c4c63060cb33 (item3), a0aea3a6357719dba (item2-W5a)}` + the sPA worktree `../scrml-spa-ss23`. Safe to prune after you merge `spa/ss23`.

— sPA ss23, standing down.
