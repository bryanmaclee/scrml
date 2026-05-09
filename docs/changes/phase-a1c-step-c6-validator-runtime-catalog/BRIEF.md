# Phase A1c — Step C6: Validator predicate runtime catalog (14 universal-core predicates, L4)

**Phase:** A1c (codegen+runtime). Wave 2 (reset + validators).
**Position:** C6 — second of Wave 2; standalone (no in-wave deps; can dispatch parallel with C5). C6 → C7 series (C7 consumes the runtime catalog).
**Estimate:** ~5-7 h focused (likely lower per depth-of-survey: compile-time catalog already exists at `compiler/src/validator-catalog.ts`).
**Dispatched:** 2026-05-08 (S73).
**Authority chain:** SPEC §55.1 (universal-core predicate vocabulary, 14 predicates) + L4 (partial validator vocab unification — same 14 words across state validators / refinement types / schema columns) + SPEC §55.9 (ValidationError enum tags). SCOPE-AND-DECOMPOSITION row C6 (`docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md:214`).

## Goal (one paragraph)

C6 creates the **runtime** validator-predicate catalog at `runtime/validators.js` (NEW). The compile-time catalog already exists at `compiler/src/validator-catalog.ts` (B10, S67) with 14 entries — it tells the compiler which predicates are universal-core, their arities, signatures, ValidationError enum tags. C6's runtime catalog supplies the actual JS functions that fire each predicate against runtime values, returning `null` (pass) or a `ValidationError` enum tag (fail). C6 is consumed by C7 (per-cell validator runner) and downstream by C9 (cross-field deps), C10 (4-level error message resolution), and C16 (refinement-type runtime emission per §53). This is foundational — get the runtime semantics exactly right.

## CRITICAL — Rule 4 correction vs SCOPE doc drift

**The SCOPE doc row for C6 lists `email`, `url`, `numeric`, `integer`, `custom` as universal-core predicates. THIS IS WRONG per pa.md Rule 4 (spec wins; derived docs drift).** Per SPEC §55.1 + the audit at `docs/audits/a1c-roadmap-rule4-audit-2026-05-07.md` §1.1 + the existing compile-time catalog at `compiler/src/validator-catalog.ts:139-252`, the actual 14 universal-core predicates are:

`req` · `is some` · `length` · `pattern` · `min` · `max` · `gt` · `lt` · `gte` · `lte` · `eq` · `neq` · `oneOf` · `notIn`

`email` / `url` / `numeric` / `integer` are stdlib `scrml:data` library predicate-builders (separate surface — out of C6 scope). `custom` is the ValidationError enum tag at SPEC §55.9 line 24532 (escape hatch for app-defined validators) — a TAG, not a predicate. **C6's runtime catalog has 14 entries matching the compile-time catalog exactly.** PA-PRIMER §8 codifies this correction.

## What's already in place (depth-of-survey signal)

- **Compile-time catalog:** `compiler/src/validator-catalog.ts` (~290 LOC, B10 surface) is the SINGLE SOURCE OF TRUTH for predicate signatures. C6's runtime catalog should mirror its `name`-keyed entries 1:1 — same 14 names, same `errorTag` values, same `cellTypeRequirement` semantics. **Read it in full before drafting any runtime code.**
- **ValidationError enum tags:** SPEC §55.9 (lines 24532-24565 region; verify line numbers via grep) defines the enum: `Required`, `NotSome`, `LengthFailed(predicate)`, `PatternMismatch(re)`, `MinFailed(threshold)`, `MaxFailed(threshold)`, `GtFailed(expected)`, `LtFailed(expected)`, `GteFailed(expected)`, `LteFailed(expected)`, `EqFailed(expected)`, `NeqFailed(forbidden)`, `OneOfFailed(set)`, `NotInFailed(set)`, `Custom(tag: string)`. Each predicate's `errorTag` field in the compile-time catalog already names the right tag.
- **`is some` semantics** (per primer §9.4 / SPEC §42.2.5): null/undefined fail; empty string is some. Distinct from `req` (empty string FAILS `req`). Both predicates exist; they are NOT redundant.
- **Relational predicate** (`length(>=N)`-style): `args: [{ kind: "relational-predicate" }, ...]`. The runtime needs to interpret `RelationalPredicateNode { op: ">=" | "<=" | "<" | ">" | "=" | "!=", value: ExprNode }` and run `length(actualValue) <op> evaluatedExpr`.
- **Cross-field args** (e.g., `eq(@signup.password)`): args of kind `comparable-with-cell` / `any-equatable-with-cell` are reactive references to other cells. The runtime predicate must read the comparison value at fire time (not at registration time). This is L14 — cross-field validation via predicate args, no separate vocabulary.

## Scope (in / out)

**IN scope (C6):**
1. **NEW file:** `runtime/validators.js` (in the runtime tree wherever `runtime-template.js` peers live — survey-confirm). Exports a runtime catalog (Map / object) keyed by predicate name → fire function.
2. **14 fire functions** — one per universal-core predicate. Each takes `(cellValue, args, ...)` and returns `null` (pass) or a ValidationError-shaped object/tag (fail). The exact return shape matches what C7 consumes — consult B11/B12 specifics in PA-PRIMER §13.7 for what `errors[]` should look like at runtime (each entry IS a ValidationError tag; a compound `errors` is a `{fieldName: [...errorTags]}` map).
3. **Relational predicate evaluator:** for `length` (the only `1+inline` relational host today), the runtime must accept `{ op, value }` and run the comparison.
4. **Regex evaluator:** for `pattern`, accept a regex (RegExp or raw `/.../` string) and `.test()` the cellValue.
5. **Cross-field arg evaluator:** for `gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn` with `comparable-with-cell` / `any-equatable-with-cell` / `array-of-cell-type` arg kinds — accept either a literal value (already-evaluated) OR a thunk (`() => @otherCell`) that the predicate calls to read the comparison at fire time. C7 emits the thunk; C6 just consumes it.
6. **`is some` vs `req` distinction:** correctly implement both — `is some` fails on null/undefined ONLY; `req` fails on null/undefined AND empty string AND empty array.
7. **Tests:** unit-style runtime tests for each of the 14 predicates — pass cases, fail cases (with the expected ValidationError tag verified), edge cases per SPEC. Optionally include a few integration tests that go through the codegen pipeline once C7 dispatches; if too coupled to C7, defer those to C7's test file.

**OUT of scope (deferred):**
- **Per-cell validator runner** (the orchestrator that walks a cell's `validators[]` and calls each fire function in order, accumulating errors) — that's **C7**.
- **Validity surface synthesis** (compound `.isValid` / `.errors` / `.touched` / `.submitted` rollup cells) — **C8**.
- **Cross-field reactive deps** (the dep-graph wiring so an upstream cell change re-fires a dependent validator) — **C9**.
- **4-level error message resolution** (inline message → registered message → scrml:data default → match escape) — **C10**.
- **`<errors of=expr/>` element** — **C11**.
- **Library predicates** (`email` / `url` / `numeric` / `integer` from stdlib `scrml:data`) — separate surface; not in C6 scope.
- **Custom predicate dispatch** (the `Custom(tag)` enum tag escape hatch) — out of C6's universal-core territory.
- **Refinement-type runtime emission** (§53.7.2 boundary checks) — **C16 Wave 5.** C6's runtime fire functions are designed to be reusable by C16 but C6 does NOT extend C16's territory.

## Spec verification (pa.md Rule 4)

I (PA) verified against SPEC.md text directly:
- **§55.1** (predicate vocab) — 14 predicates listed, NOT including email/url/numeric/integer. ✓ (Cross-checked against `compiler/src/validator-catalog.ts:139-252` which is the canonical compile-time catalog.)
- **§55.9** (ValidationError enum) — tags-per-predicate. ✓ (Cross-checked against the `errorTag` fields in compile-time catalog.)
- **§42.2.5** (`is some` vs `req` distinct semantics) — both exist; both needed; not redundant. ✓ (Primer §9.4 codifies.)

## Dispatch protocol

S67 worktree-as-scratch landing. Agent commits incrementally; PA lands via `git checkout <branch> -- <files>` from main.

## Authorized decisions

- **File locus:** `runtime/validators.js` is the SCOPE-named home; agent may correct to a different runtime path during survey if cleaner. Best to peer with `runtime-template.js` / other runtime modules.
- **Test file:** `compiler/tests/unit/c6-validator-runtime-catalog.test.js`.
- **Crash recovery:** WIP commits expected; `progress.md` append-only.
- **Catalog symmetry with compile-time:** the runtime catalog SHOULD have the same 14 entries in the same order as the compile-time catalog. If discovery during survey reveals a 15th predicate has been added to the compile-time catalog, mirror it in the runtime; if the runtime needs a predicate the compile-time doesn't surface, STOP-FOR-PA.

## Anti-patterns reading

Compiler+runtime TS/JS dispatch. `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` if Zod / Yup / Joi / Vest / Vuelidate idioms creep in. The runtime catalog is NOT a third-party validation library; it's scrml's compiler-emitted validator runtime.

## File-modification inventory expected

| File | Reason |
|---|---|
| `runtime/validators.js` (NEW) OR equivalent runtime path | predicate fire functions |
| Possibly `compiler/src/codegen/runtime-template.js` | wire the catalog into the runtime emission |
| `compiler/tests/unit/c6-validator-runtime-catalog.test.js` (NEW) | unit tests |
| `docs/changes/phase-a1c-step-c6-validator-runtime-catalog/{progress,SURVEY}.md` | crash-recovery + survey |

## Definition of Done

- All §scope IN items shipped.
- 0 regressions vs baseline (9,949 / 60 / 1 / 0).
- 14 predicates implemented (NOT 15+ — Rule 4 corrected the SCOPE doc drift).
- Spec re-verified (§55.1 + §55.9 + §42.2.5) against SPEC.md text.
- Hookpoints documented for C7 (the per-cell runner C7 will dispatch each cell's validators[] through C6's catalog).
- Catalog 1:1 mirrors compile-time `validator-catalog.ts` ordering and naming.
