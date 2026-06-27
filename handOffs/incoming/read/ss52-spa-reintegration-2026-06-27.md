# sPA re-integration — ss52 (non-reactive local map/set method lowering — the (c) bug)

**From:** sPA (list `ss52-nonreactive-local-map-set-method.md`) · **Date:** 2026-06-27
**Branch:** `spa/ss52` (base local `main` `2310b53a`) · **branch tip = `5ebdbce3`**
**Disposition:** **1/1 item landed-on-branch.** Run complete. **Clean auto-merge onto current main.**

## TL;DR
The (c) bug is fixed end-to-end: value-native maps/sets now lower + RUN in non-reactive / pure
code (`let m = [:]; m = m.insert(k,v); return m.size` no longer raw-emits → no runtime
TypeError). This unblocks the compiler-in-scrml Road-B pure-fold dogfood (DG-builder
color-maps/reader-sets + lexer accumulators are all non-reactive local maps/sets). Full
`bun run test` 25610 pass / 0 fail.

## What landed (one squashed commit `5ebdbce3`, 11 files, +939/-76)
- **Collector** (`reactive-deps.ts`): `collectLocalMapSetNames` + `buildFnReturnMapKinds` +
  `collectAllLocalMapSetNames` — scope-aware per-function (seeds from map-lit RHS, `[K:V]`/`set[K]`
  param+decl annotations, map/set-returning exprs incl. fn-return annotation; fixpoint recurses
  control-flow, STOPS at nested fn-decls; SYM unused — unreliable at codegen).
- **Gate relaxation** (`emit-expr.ts`): `mapCellBareName`/`setCellBareName` helpers; the 4 `@`-gated
  sites (emitCall map+set, emitMember `.size`, emitIndex bracket-read) now fire for bare locals,
  emitting the bare receiver. **Reactive `@`-path is BYTE-IDENTICAL** (the `@`-branch returns the
  same `mapVarNames.has(bare)`; only the new non-`@` local branch differs — sPA-verified
  structurally).
- **Threading** (`emit-functions.ts`/`scheduling.ts`/`emit-logic.ts`/`emit-control-flow.ts`):
  per-fn local sets threaded into every fn-body emit ctx incl. if/for/while BODY + condition +
  iterable (the pure-fold loop pattern).
- **Runtime chunks** (`emit-client.ts`): local-set `.union`/`.intersect`/`.difference` + a local
  map/set param/decl now light the `map`/`stdlib-data` chunks so `_scrml_stdlib.data.*` ships.
- **SPEC**: §59 banner + §59.12 set note re-verified "incl. non-reactive locals as of ss52".
- **known-gaps**: `g-nonreactive-local-map-set-method-raw-emit` → **RESOLVED**.
- **Tests**: `compiler/tests/integration/nonreactive-local-map-set-ss52.test.js` — 21 pure fns,
  each compile + `node --check` + **RUN** (actual return values) + emit-shape + the scope-collision
  crux.
- BRIEF archived at `docs/changes/nonreactive-local-map-set-2026-06-27/BRIEF.md` (on the branch).

## ⚠️ Re-integration: emit-logic.ts overlaps ss49 — auto-merges CLEAN, but re-run the suite
During the ~77-min dispatch, **ss49 advanced main by 4 commits** (`9be8010c`, `bf7da16d`,
`b731fda2`, `3957f38e`) to `3957f38e`. **`compiler/src/codegen/emit-logic.ts` is touched by BOTH**
ss52 and ss49's `b731fda2` (escalate-enclosing-fn-to-server).
- **`git merge-tree --write-tree main spa/ss52` = exit 0 → CLEAN auto-merge** (the two changes are
  in non-overlapping hunks; ss52's emit-logic.ts edits are the `EmitLogicOpts` local fields +
  expr-ctx forward + control-flow dispatch forward — separate regions from ss49's server-escalation).
- **BUT textual-clean ≠ semantic-clean on a shared file.** Recommend: after merging `spa/ss52`,
  **re-run the full suite on the merged tree** before pushing (canary-metric-class lesson — a clean
  3-way merge of a shared codegen file does not prove the combined behavior is correct).
- No other overlap: the other 9 ss52 files are untouched by the 4 advance commits.

## Verification done (sPA, not just agent self-report)
- VERIFY-FIRST: agent empirically confirmed the raw `m.insert`/`m.size` emit + the runtime
  `TypeError` before the fix.
- Adversarial review: reactive byte-identity confirmed structurally (the `@`-branch is unchanged);
  scope-collision crux verified (same name = map in one fn / array in another → not cross-lowered —
  a file-wide set would have mis-lowered; per-function scoping handles it).
- Full pre-commit suite ran on the landing commit (my independent re-run): **GREEN**
  (unit+integration+conformance) + post-commit gauntlet TodoMVC PASS + browser checks passed.
- Agent in-worktree `bun run test`: 25610 pass / 0 fail (1113 files).

## 🔶 NEW GAP — needs a PA scheduling ruling
The agent discovered (during R26-RUN) a **pre-existing REACTIVE twin** of the (c) bug:
`@m.insert(...)` / `@m.size` / `@m.has(k)` / `@m[k]` inside an `if`/`for`/`while` **body OR
condition/iterable** also emit raw `_scrml_reactive_get("m").insert(...)` → the same runtime
`TypeError` (the control-flow expr/body ctxs never carried `mapVarNames`/`setVarNames`).
PRE-EXISTING (predates ss52). ss52 deliberately did NOT fix it (remit = non-reactive locals; the
brief mandated reactive byte-identity) — it threaded only the new `local*` sets into those ctxs.
**Filed `g-reactive-map-set-method-in-control-flow-raw-emit` (MED, status=open)** in
`docs/known-gaps.md` with a symmetric fix shape (thread `mapVarNames`/`setVarNames`/
`orderedMapVarNames` alongside the `local*` siblings at the same emit-control-flow.ts sites ss52
touched). **This also blocks Road-B pure-folds that use a reactive map in a loop** — likely wants
scheduling soon. PA ruling requested.

## Scope note (larger than the brief's "3 gates + collector" sketch — justified)
11 files because: (a) per-function scope-awareness (the brief's mandated crux) requires threading
through ~10 emit-ctx sites incl. all control-flow; (b) two reachability gaps surfaced at R26-RUN —
the `stdlib-data` chunk gate missed local-set algebra (a REAL runtime crash, fixed in scope), and
the reactive control-flow twin (out of scope, filed above). Each commit per-feature, full-suite-gated.

## Cleanup state
- Land worktree removed. Agent worktree `worktree-agent-abe77606676ae05e0` (tip `2c088292`, 7
  commits, clean tree) **left intact** as a PA fallback — remove at re-integration. (Note: ss43's
  `worktree-agent-ad4fab3eed853b5d6` is also still present — ss43 landed on main but its agent
  worktree was never pruned; safe to remove too.)
- Shared checkout (on `main`) NOT advanced/branch-switched by me; ss49's in-flight work
  (`spa-lists/ss49*`) untouched.

**Branch `spa/ss52` @ `5ebdbce3` is ready for re-integration (clean auto-merge; re-run suite post-merge).**
