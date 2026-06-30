# TASK — g-fn-shortform-arrow-callback-invalid-js: REJECT `fn(args) => expr` at parse with a clean syntax error

**RULING (RATIFIED — user delegated PA lean A).** `fn(args) => expr` (the `fn` keyword + an ARROW body) is NOT a sanctioned scrml form. SPEC §48.2.1: the anonymous `fn` expression is BLOCK-body — `let makePoint = fn(x, y) { ... return ... }`. The plain arrow `args => expr` / `(x) => expr` is the canonical inline lambda. `fn(args) => expr` mixes the two and is invalid.

**The bug.** `const <doubled> = @nums.map(fn(n) => n * 2)` currently emits invalid JS `function(n) => (...)` → `E-CODEGEN-INVALID-JS` (a "compiler defect" framing that MIS-ATTRIBUTES author error to a compiler bug — the same diagnostic-mis-framing the N5 finding had). Root: `compiler/src/codegen/rewrite.ts::rewriteFnKeyword` [~1470-1473] does a blind textual `fn`→`function` replace (`fn(n) => …` → `function(n) => …`, invalid JS); plain `n => …` has no `fn` token so it's untouched. The structured lambda emitter `emit-expr.ts::emitLambda` [~2423-2467] handles `fn` correctly via `node.fnStyle` — the bug only surfaces on the source-text rewrite path.

**The fix (ruling A — reject at parse, fail-closed-honest):** recognize the `fn(args) => …` shape (the `fn` keyword followed by a parenthesized param list and then an arrow `=>` instead of a brace `{` body) at the PARSE layer and emit a CLEAN syntax error — NOT the `E-CODEGEN-INVALID-JS` "compiler defect" code. The error message MUST steer to the two canonical forms: *"`fn(args) => expr` is not a valid scrml form. For an inline lambda use `args => expr`; for a named-style anonymous function use `fn(args) { return expr }`."* Find where anonymous `fn(...)` expressions are parsed (likely `compiler/src/expression-parser.ts` and/or `compiler/src/ast-builder.js`; check how `fn` anonymous exprs + `emitLambda`'s `fnStyle` node are produced) and add the rejection there (before the malformed shape reaches `rewriteFnKeyword`).

**Code name:** suggested `E-FN-ARROW-BODY` (or reuse an existing E-SYNTAX-* fn code if one fits — check §34.1 native-parser `E-STMT-FN-*` / the §48 fn codes). REPORT the exact code name + the §34 row text it needs — **do NOT edit `compiler/SPEC.md`** (the PA authors the §34 row at landing to keep SPEC single-writer; Rule 4 is satisfied — it lands in the same commit).

**ADVERSARIAL (S215) — must NOT false-fire on the valid siblings:**
- `fn(x, y) { return x + y }` (brace-body anonymous fn — VALID, §48.2.1) → no error.
- `args => expr` / `(x) => x*2` / `n => n*2` (plain arrow lambda — VALID) → no error.
- `fn name(args) -> T { ... }` (named fn with `->` return-type — VALID) → no error.
- `fn(args) -> T { ... }` (anonymous fn with return-type annotation, brace body — VALID) → no error.
- A `fn` substring inside an identifier / string (e.g. `fnButton`, `"fn(x)=>"` in a string literal) → no error.
Construct repros for each + confirm zero false-fires.

**Verification (before DONE):**
- The repro `const <doubled> = @nums.map(fn(n) => n * 2)` → the NEW clean syntax error (with the steering message), NOT `E-CODEGEN-INVALID-JS`.
- The valid siblings above all compile clean (no new error).
- `bun run test` FULL suite (not just the subset — S198) — zero regressions. If any corpus/sample uses `fn(args)=>` (it shouldn't — it was invalid), that's a fixture to fix (it was relying on a bug).
- Report the known-gaps status change (`g-fn-shortform-arrow-callback-invalid-js` → resolved) — do NOT edit `docs/known-gaps.md` (PA owns the @gap token; REPORT the change).

**SCOPE GUARD:** write surface = `compiler/src/**` (parser) + `compiler/tests/**` + the BRIEF.md. NO `compiler/SPEC.md`, NO `docs/known-gaps.md`, NO `conformance/**`. REPORT the SPEC §34 row + the known-gaps change for the PA to apply.

**FINAL REPORT (raw data):** WORKTREE_ROOT · FINAL_SHA · merge-main-confirmation · FILES_TOUCHED · the new code name + the §34 row text · before/after for the repro · the 5 adversarial-sibling results · full-suite counts · the known-gaps change to apply · Maps-consulted line.
