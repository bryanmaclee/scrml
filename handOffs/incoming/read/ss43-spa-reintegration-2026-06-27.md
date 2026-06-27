# sPA re-integration — ss43 (Multi-Scrutinee Match §18.19 W2 build)

**From:** sPA (list `ss43-multi-scrutinee-match-build.md`) · **Date:** 2026-06-27
**Branch:** `spa/ss43` (base `6ead4d7a` — old origin/main, pre-advance) · **branch tip = `5fe08dc5`**
**Disposition:** **4/4 items landed-on-branch.** Run complete. Clean merge into current main.

## TL;DR
§18.19 multi-scrutinee match — the parser/typer/codegen/tests W2 — is **built, green, and
banner-flipped to Implemented.** `match (e1,…,eN) { (p1,…,pN) :> body }` now compiles in the
live Acorn pipeline. The flagship `step` worked example (the compiler-reimagining Road-B
dispatch core) compiles + `node --check` clean + runs correctly. One squashed sPA commit on
`spa/ss43`; full pre-commit suite (unit+integration+conformance) + gauntlet/browser post-checks
green.

## What landed (one squashed commit `5fe08dc5`, 10 files, +1167/-39)
- **Parser** (`ast-builder.js`, `expression-parser.ts`): multi-scrutinee head detection (comma
  at paren-depth 1, N≥2; `match (e)` no-comma stays single-scrutinee — zero regression) +
  product-pattern arms.
- **AST** (`types/ast.ts`): `MatchExpr.subjects[]` + `MatchExprNode.scrutinees[]/scrutineeExprs[]`
  + arm `productPatterns[]` (all absent ⇒ single-scrutinee, zero change).
- **Typer** (`type-system.ts:checkMultiScrutineeMatch`): arm-arity **E-MATCH-SCRUTINEE-ARITY**;
  per-position nested-pattern **E-SYNTAX-012** (§18.11 breadth-not-depth preserved); cross-product
  exhaustiveness **E-TYPE-020** (enum) / **E-TYPE-006** (union) naming the uncovered (V1×…×VN)
  cell; `partial match` opts out; enum-subset (§53.15) narrows a position.
- **Codegen** (`emit-control-flow.ts` + `emit-logic.ts` decl-path + `emit-expr.ts` expr-position):
  desugar to nested single-scrutinee dispatch, observationally identical to the hand-written
  nested form; bindings from every position in arm-body scope; no new runtime.
- **SPEC**: §18.19 banner Nominal→**Implemented (S224 W2, ss43)**; **§34 E-MATCH-SCRUTINEE-ARITY
  row catalogued** (Rule 4 — named W1, catalogued at impl; §60/§61/§26.8 precedent).
- **Tests**: 14 adversarial unit tests (`compiler/tests/unit/multi-scrutinee-match-ss43.test.js`)
  — every acceptance bullet covered (worked example incl. runtime + payload binding, missing
  cell→E-TYPE-020, arity→E-MATCH-SCRUTINEE-ARITY, nested→E-SYNTAX-012, union→E-TYPE-006, partial
  opt-out, no-comma single-scrutinee no-regression, N=3, per-position+whole `_`, enum-subset,
  expr-position).
- **BRIEF** archived at `docs/changes/multi-scrutinee-match-2026-06-27/BRIEF.md` (on the branch).

## Footprint correction (PA: note for future match-codegen work)
The list's **coreFiles named `emit-match.ts` for the codegen desugar — WRONG.** `emit-match.ts`
is the block-form `<match for=Type>` MARKUP path. The JS-style value-return desugar (where
E-CG-003 fires) lives in **`emit-control-flow.ts` (`emitMatchExpr`)** + the decl path in
`emit-logic.ts:emitMatchExprDecl` + the expr-position bridge in `emit-expr.ts`. Survey-first
caught it; the corrected loci were briefed and built. §18.19 v1 is JS-style only, so
`emit-match.ts` was correctly untouched.

## Re-integration — CLEAN MERGE (verified)
`spa/ss43` was cut from `6ead4d7a` (origin/main at my boot). During the ~85-min dispatch a
parallel session advanced `main` by 2 commits (`c134e500` s225 triage, `2315d0cc` ss48 PARK) and
switched the shared checkout to `main`. Those commits are **docs/orchestration only** (spa-lists,
known-gaps, handOffs, master-list) — **ZERO overlap with the 9 §18.19 code/spec files** (verified
`git diff --name-only spa/ss43~1..main`). The ss43 list file itself was untouched on main. **→
`spa/ss43` rebases/merges onto current main with no code conflict.** The hot-file warning
(type-system.ts vs ss42) did not materialize — no concurrent typer lane touched it in those 2
commits.

## Verification done (sPA, not just agent self-report)
- Independently reviewed the staged diff: SPEC banner flip + §34 row placement + typer
  cross-product exhaustiveness all faithful to normative §18.19.
- Full pre-commit suite ran on the landing commit (my independent re-run): **GREEN**
  (unit+integration+conformance, --bail) + post-commit gauntlet TodoMVC PASS + browser checks
  passed.
- Agent's in-worktree `bun run test`: 25604 pass / 0 fail.

## Notes / pre-existing items (not introduced here)
- Positive side effects fixed at source: a latent single-scrutinee leading-`|` value-arm body
  merge + a user-fn-named-`match` mis-parse (gated decoration on a real product-pattern arm) —
  traced + fixed, **no M6.5.b.0 allowlist re-baseline needed.**
- Expression-position nested multi-scrutinee gets codegen but not typer exhaustiveness — a
  **pre-existing limitation that already applies to single-scrutinee expr-position matches**, not
  a §18.19 regression. Flagging for the PA's awareness; not in scope for this build.

## Cleanup state
- Temp landing worktree (scratchpad) removed. Agent worktree
  `worktree-agent-ad4fab3eed853b5d6` (tip `654bcd5a`, 6 commits, clean tree) **left intact** as a
  PA fallback — remove at re-integration.
- Shared checkout (on `main`) NOT advanced, NOT branch-switched by me; its pre-existing
  ` M handOffs/delta-log.md` (ss48's) untouched.

## Anomaly correlation (delta-log entry [160])
Root cause confirmed: the `/spa` boot ran `git checkout -b spa/ss43` **in the shared main
checkout** (not a worktree), switching it onto `spa/ss43` — which is why a PA hk commit
(`6fdb392f`) first landed there. The PA already recovered it (ff→main, `git branch -f spa/ss43
6ead4d7a`). **My landing commit `5fe08dc5` was created AFTER that recovery, on the restored base
`6ead4d7a`** (squashed via an isolated temp worktree precisely to stop touching the shared
checkout's branch pointer) — so it sits cleanly and was NOT affected by the reset. All my
post-dispatch git work (squash/commit) was done in a throwaway worktree; the shared checkout's
branch pointer was not moved by me after boot. Note for future sPA fires: boot's branch-checkout
in the shared checkout is the contention source the PA's prevention rule (assert `branch==main`
before PA commit) addresses.

**Branch `spa/ss43` @ `5fe08dc5` is ready for re-integration.**
