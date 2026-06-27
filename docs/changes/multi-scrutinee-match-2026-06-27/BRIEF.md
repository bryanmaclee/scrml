# ss43 — Multi-Scrutinee Match (§18.19) W2 build — DEV BRIEF

**Dispatched:** sPA ss43, 2026-06-27 · agent `scrml-js-codegen-engineer`, isolation:worktree, opus.
**Branch base:** current `main` == `origin/main` == `6ead4d7a` (§18.19 W1 already landed @ `55755d04`).
**Change-id:** `multi-scrutinee-match-2026-06-27`.

You are building W2 — the parser / typer / codegen / tests that flip the §18.19 **Nominal** banner to landed. The design is **RULED** (S224). Do not redesign; implement the ratified spec.

---

## Authority (READ FIRST — Rule 4: SPEC is normative)
1. **SPEC §18.19** — `compiler/SPEC.md` lines **12538–12656** (the full normative subsection: grammar, no-tuple invariant, bindings, breadth-not-depth, product exhaustiveness, scope, diagnostics table, cross-refs). READ IN FULL.
2. **SPEC §18.2 grammar note** — `compiler/SPEC.md` lines **11369–11374** (the multi-scrutinee head note added to the single-scrutinee grammar you extend).
3. **Ratified design** — `docs/changes/multi-scrutinee-match-2026-06-27/SCOPE.md` (the S224 ratification record; the 8 design points).
4. Cross-ref only as needed: §18.8 (the exhaustiveness you product), §18.11 (nested-pattern exclusion you PRESERVE), §53.15 (enum-subset narrowing), §51.0.S (the engine-bound sibling — for desugar intuition only; DO NOT touch engine code).

---

## SURVEY-FIRST — Phase 0 (mandatory, report before you build)
The match pipeline is **distributed across a scan/mask → unmask → arm-parse chain**. Confirm these loci before writing code, and report a depth-of-survey note (does existing infra cover more than expected?):

- **Head capture (mask):** `compiler/src/expression-parser.ts` → `preprocessMatchExprs` (~**line 1666–1718**). Today it extracts a single `subject` (text between `match ` and `{`) and emits `__scrml_match__(${subject}, ${armsQuoted})`. A multi-scrutinee head is `match (e1, …, eN) { … }` — a `(` … `)` with a **comma at paren-depth 1** in the subject slot. `match (e)` (no depth-1 comma) STAYS single-scrutinee.
- **Unmask (AST build):** `compiler/src/expression-parser.ts` ~**line 2127–2132** — `__scrml_match__` → `{ kind: "match-expr", span, subject, rawArms }`. Today `subject` is ONE expr node. You must extend `MatchExpr` to carry a **scrutinee LIST** (e.g. `subjects: ExprNode[]` or keep `subject` + add `subjects?`) and the arms must carry a **per-arm pattern LIST**. NOTE: a JS `(a, b)` parses as a SequenceExpression via acorn — decide whether to detect the multi-scrutinee head at the mask stage (preferred — emit a distinct placeholder or a scrutinee-count marker) rather than relying on SequenceExpression unmasking. Survey and pick the cleanest seam; report your choice.
- **Arm parsing / split:** `splitMatchArms` (expression-parser.ts) splits arm strings; product-pattern arms are `(p1, …, pN) :> body`. The per-position arm-patterns are the ordinary §18.2 arm-patterns.
- **ast-builder.js:** `parseOneMatchAsExpr` (~line 6243) + `matchExpr` attachment (return-stmt / derived-cell / let/const-decl forms at 6952/7066/7738). Check whether the multi-scrutinee head flows through here too (derived `const x = match (...)` and `return match (...)` forms).
- **Typer:** `compiler/src/type-system.ts` → `checkMatchDiagnostics` (call sites ~**10252**); E-TYPE-020 (enum non-exhaustive) / E-TYPE-006 (union) live here.
- **⚠️ CODEGEN LOCUS CORRECTION (footprint fix — the list named the wrong file):** the JS-style value-return `match` desugar is in **`compiler/src/codegen/emit-control-flow.ts`** — `emitMatchExpr` (**line 1702**), `parseMatchArm` (**1048**), `armCondition` (**1958**), `emitVariantBindingPrelude` (**2007**); **E-CG-003** ("no lowerable arms") fires at **1823**. **`emit-match.ts` is the BLOCK-FORM `<match for=Type>` markup path — IRRELEVANT here.** §18.19 v1 is **JS-style value-return ONLY** (block-form deferred), so all codegen work is in `emit-control-flow.ts`. Confirm in your survey and report if the seam differs.

---

## What to build (the 4 coupled phases — ONE coherent change)

**1. Parse — multi-scrutinee head + product-pattern arms.**
Recognize `match (e1, …, eN) { … }` by a depth-1 comma in the head; `match (e)` (no comma) stays single-scrutinee (§18.2 — ZERO regression on the existing match corpus is acceptance-critical). Recognize `(p1, …, pN) :> body` product-pattern arms (each `pN` a §18.2 arm-pattern). A whole-arm `_` / `else` covers the product. Extend `MatchExpr` to a scrutinee LIST + per-arm pattern LIST. **PRESERVE §18.11:** each position is single-level — `(.A, .B(x))` legal; `(.A(.B(x)), c)` stays **E-SYNTAX-012**.

**2. Typer — product exhaustiveness + `E-MATCH-SCRUTINEE-ARITY`.**
In `checkMatchDiagnostics`: extend §18.8.1 variant-set coverage to the **cross-product** of the per-position scrutinee variant sets (deterministic, guard-free — §18.10). A missing combination → **E-TYPE-020** (enum position) / **E-TYPE-006** (union position), and the message **names the uncovered `(V1 × … × VN)` cell**. A per-position `_` and a whole-arm `| _` both count toward coverage (`(_, .SawEof)` covers every mode with SawEof). `partial match (…)` opts out (§18.18). An enum-subset position (§53.15) narrows that position's variant set (dead variant → E-MATCH-SUBSET-DEAD-ARM). Fire **E-MATCH-SCRUTINEE-ARITY** (Error) when an arm's pattern count ≠ head scrutinee count. **Catalog the §34 row** for `E-MATCH-SCRUTINEE-ARITY` (named S224, lands WITH impl per Rule 4 — find the §34 table in SPEC.md, add the row in the right alphabetical/section position; mirror the §18.19 diagnostics-table wording).

**3. Codegen — desugar to nested single-scrutinee dispatch (`emit-control-flow.ts`).**
Lower `match (s1,…,sN) { (p1,…,pN):>body … }` to nested single-scrutinee dispatch — `(.A,.B):>body` ⇒ `match s1 { .A :> match s2 { .B :> body … } … }` — **observationally identical** to the hand-written nested form. Bindings from EVERY position are in scope across the whole arm body (`q` from `.SawQuote(q)` live in the body). No new runtime. `node --check` clean.

**4. Tests + flip the banner.**
Unit + integration tests for every adversarial shape (below). Flip the §18.19 **"Nominal / spec-ahead"** status banner (SPEC.md ~line 12540) to landed/implemented. Update `docs/known-gaps.md` (flip the §18.19 Nominal item). Note the landing in the changelog if one is touched.

---

## Acceptance (must ALL hold — adversarial, per S215)
Construct edge repros and verify each:
- The §18.19 `step` worked example (SPEC.md 12553–12564) **compiles + `node --check` clean + runs correctly**.
- `match (a, b)` with full product coverage is **exhaustive with no `_`**.
- A missing `(state × event)` cell fires **E-TYPE-020 naming the uncovered cell**.
- An arm-arity mismatch (e.g. `(.A) :> …` under a 2-scrutinee head) fires **E-MATCH-SCRUTINEE-ARITY**.
- `(.A(.B(x)), c)` stays **E-SYNTAX-012** (nested pattern; §18.11 preserved).
- A **union** position fires **E-TYPE-006** when non-exhaustive.
- `partial match (a, b)` **opts out** of the product check.
- `match (e)` with **no comma still parses as single-scrutinee** (ZERO regression on existing match corpus).
- **N = 3** works (`match (a, b, c)`).
- Per-position `_` (`(_, .SawEof)`) and whole-arm `| _` both count toward coverage.
- Enum-subset (§53.15) narrows a position.
- **FULL `bun run test` green** before DONE.

---

## Discipline
- **Native-parser FROZEN (RULING §4):** build in the LIVE Acorn-backed pipeline ONLY. Do **NOT** touch `compiler/native-parser/**` (transition-frozen; its `.scrml`/`.js` mirrors are feature-stale by design). §18.19 reaches native-parser only at the eventual rewrite.
- **NO tuple widening / NO block-form:** do not add a tuple value, `.0`/`.1`, `fn -> (A,B)`, or `<match for=(A,B)>`. The parens are grammar.
- **Test re-baseline (S198):** a parser-shape change MAY shift within-node fixtures. If `bun run test` flags over-budget fixtures, **re-baseline the M6.5.b.0 allowlist IN THE SAME LANDING** (find the allowlist; add only the fixtures your change legitimately shifted; report which + why).
- **Coupled code + test = one logical unit** (memory `coupled_code_test_commit`) — keep code + its tests together; do not leave a transiently-red window.
- **Commit in your worktree** incrementally (crash-recovery anchor). The sPA lands your work onto `spa/ss43`. Do **NOT** push, do **NOT** touch main.
- **Path discipline:** write ONLY inside your worktree checkout. Verify `git status` shows no main-checkout leakage; never write via a main-absolute path (`stat`-check if unsure).
- The pre-commit hook runs the full ~17.6k-test suite (~108–124s); foreground commits need a generous timeout.

---

## Report back
1. Phase-0 survey findings (confirmed loci + the seam choices you made + depth-of-survey note + whether the codegen-locus correction held).
2. Per-phase summary of what changed (files + the AST shape extension).
3. The §34 `E-MATCH-SCRUTINEE-ARITY` row text you added.
4. Adversarial-repro results (each acceptance bullet: pass/fail + evidence).
5. `bun run test` final result + any allowlist re-baseline (which fixtures, why).
6. Banner-flip confirmation (§18.19 + known-gaps).
