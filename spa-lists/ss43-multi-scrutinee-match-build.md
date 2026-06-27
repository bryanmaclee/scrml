# ss43 — Multi-Scrutinee Match (§18.19) build — SURVEY-FIRST

**Currency:** scoped S224 (PA) @ HEAD `7d8b527a` (+ uncommitted §18.19 W1) / 2026-06-27. **FIREABLE after the §18.19 W1 commit lands.** Design RULED S224 — the SPEC is W1-landed (Nominal); this is the W2 parser/typer/codegen build that flips the Nominal banner.

**Authority (READ FIRST, Rule 4):** `docs/changes/multi-scrutinee-match-2026-06-27/SCOPE.md` (the full ratified design) + **SPEC §18.19** (normative — grammar, no-tuple invariant, product exhaustiveness, nested-pattern preservation, scope, codegen) + §18.2 (single-scrutinee grammar this extends) + §18.8 (the exhaustiveness it products) + §18.11 (nested-pattern exclusion — PRESERVE) + §51.0.S (the engine-bound sibling, for the desugar shape) + §59.7/§14.11 (no-tuple — the parens are grammar). The DESIGN IS RULED — do NOT widen to a tuple value, do NOT add block-form `<match for=(A,B)>` (deferred), do NOT relax §18.11 (each position stays single-level).

**Parallel-safety:** touches `compiler/src/expression-parser.ts` / `ast-builder.js` (match-head + product-arm parse) + `compiler/src/type-system.ts` (`checkMatchDiagnostics` — product exhaustiveness + `E-MATCH-SCRUTINEE-ARITY`) + `compiler/src/codegen/emit-match.ts` (desugar). ⚠️ `type-system.ts` + `emit-match.ts` are HOT files — intersect at landing vs any concurrent typer/match lane (ss42 also touches both; S211). Build on current main (post §18.19 W1 commit).

**❄️ Native-parser FROZEN (RULING §4):** build in the LIVE Acorn-backed pipeline ONLY. Do NOT touch `compiler/native-parser/**` — it is transition-frozen (superseded-pending-rewrite); its `.scrml`/`.js` mirrors are FEATURE-stale by design (memory `native_parser_scrml_mirror_feature_stale`). The native-parser gets §18.19 only at the eventual rewrite.

**coreFiles:** `compiler/src/expression-parser.ts` (match-expr parsing — recognize `match (e1,…,eN)` head by a depth-1 comma + `(p1,…,pN)` product-pattern arms) · `compiler/src/ast-builder.js` (if the match head is lifted there) · `compiler/src/type-system.ts:checkMatchDiagnostics` (the §18.8 exhaustiveness check — extend to the cross-product; fire E-TYPE-020/E-TYPE-006 naming the uncovered cell; fire `E-MATCH-SCRUTINEE-ARITY` on arm-arity mismatch; preserve E-SYNTAX-012 for a nested pattern in any position) · `compiler/src/codegen/emit-match.ts` (desugar `(.A,.B):>body` → nested `match s1 { .A :> match s2 { .B :> body } }`) · SPEC §18.19/§18.2 (PA already authored; the sPA catalogs the §34 `E-MATCH-SCRUTINEE-ARITY` row at impl per Rule 4) · `docs/known-gaps.md` (flip the §18.19 Nominal item when done).

**Brief reminders:** SURVEY-FIRST — Phase 0 confirms the parse loci (where `match expr {}` is recognized today) + the exhaustiveness-check seam + the desugar approach, and reports the depth-of-survey discount if the existing match infra covers more than expected. R26 (compile the §18.19 worked examples + `node --check` + runtime correctness) + ADVERSARIAL (S215 — construct edge repros: arity mismatch, `_`-per-position vs whole `| _`, a nested pattern in a position [must stay E-SYNTAX-012], a union position [E-TYPE-006], an enum-subset position [§53.15], `partial match (a,b)`, a single `match (e)` no-comma [must stay single-scrutinee], N=3). FULL `bun run test` before DONE (parser-shape change MAY shift within-node fixtures → re-baseline the M6.5.b.0 allowlist for any over-budget fixture IN THE SAME LANDING, S198). Per §60/§61/§26.8 precedent the §34 row lands WITH this impl. Flip the §18.19 Nominal banner when green.

## Items

1. **Parse the multi-scrutinee head + product-pattern arms** `[status=landed-on-branch spa/ss43 @ 5fe08dc5]` **SURVEY-FIRST**
   - Recognize `match (e1, …, eN) { … }` (depth-1 comma in the head = multi-scrutinee; `match (e)` no-comma stays single-scrutinee §18.2). Recognize `(p1, …, pN) :> body` product-pattern arms (each `pN` a §18.2 arm-pattern; a whole-arm `_`/`else` covers the product). AST: extend MatchExpr to carry a scrutinee LIST + per-arm pattern LIST (vs the single today). Keep nested-pattern rejection (§18.11) per position.

2. **Product exhaustiveness + `E-MATCH-SCRUTINEE-ARITY`** `[status=landed-on-branch spa/ss43 @ 5fe08dc5]`
   - `type-system.ts:checkMatchDiagnostics`: extend the §18.8.1 variant-set coverage to the cross-product of the per-position scrutinee variant sets (deterministic, guard-free). Missing combination → E-TYPE-020 (enum) / E-TYPE-006 (union position), message names the uncovered `(V1 × … × VN)` cell. Per-position `_` + whole-arm `| _` both count toward coverage. `partial match (…)` opts out. Enum-subset (§53.15) narrows a position. Fire `E-MATCH-SCRUTINEE-ARITY` when an arm's pattern count ≠ head scrutinee count. Catalog the §34 row.

3. **Codegen desugar** `[status=landed-on-branch spa/ss43 @ 5fe08dc5]`
   - `emit-match.ts`: lower `match (s1,…,sN) { (p1,…,pN):>body … }` to nested single-scrutinee dispatch — observationally identical to the hand-written nested form. Bindings from every position in arm-body scope. No new runtime.

4. **Flip the Nominal banner + tests** `[status=landed-on-branch spa/ss43 @ 5fe08dc5]`
   - Unit + integration tests for all the adversarial shapes (item Brief). Flip the §18.19 "Nominal / spec-ahead" banner to landed; update the §34 catalog; note the landing in the known-gaps / changelog.

## Disposition — RUN COMPLETE (sPA ss43, 2026-06-27)
**4/4 items landed-on-branch.** All four items built in ONE coherent dispatch (they share the
MatchExpr AST extension — splitting would conflict). Branch `spa/ss43` (base `6ead4d7a` — old
origin/main pre-advance) · **tip `5fe08dc5`** (single squashed sPA commit of the agent's 6) ·
full pre-commit suite GREEN (unit+integration+conformance) + gauntlet/browser post-checks green.
**Footprint correction applied:** coreFiles named `emit-match.ts` for codegen, but JS-style
value-return desugar lives in `emit-control-flow.ts` (+ `emit-logic.ts` decl-path + `emit-expr.ts`
expr-position); `emit-match.ts` is block-form markup, untouched. Re-integration: `spa/ss43` merges
into current main CLEANLY — the 2 commits main advanced by during the dispatch are docs-only
(ss48 PARK / s225 triage), ZERO overlap with the 9 §18.19 files. See
`handOffs/incoming/ss43-spa-reintegration-2026-06-27.md`.

## Acceptance
The §18.19 `step` worked example compiles + `node --check` clean + runs correctly; `match (a,b)` with full product coverage is exhaustive with no `_`; a missing `(state×event)` cell fires E-TYPE-020 naming it; an arm-arity mismatch fires E-MATCH-SCRUTINEE-ARITY; `(.A(.B(x)), c)` stays E-SYNTAX-012; a union position fires E-TYPE-006 when non-exhaustive; `partial match (a,b)` opts out; `match (e)` no-comma still parses as single-scrutinee (zero regression on existing match corpus); N=3 works; full suite green + allowlist rebaselined if shifted; §18.19 Nominal banner flipped.
