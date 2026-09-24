# BRIEF — s430-defer (ruling P3, STAGE 1: the `defer` statement)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## Ruling (bryan S430, P3 = option (d), staged; verbatim in scrml-support/user-voice-scrml.md S430)
Stage 1 (THIS dispatch): `defer <statement>` — a scope-exit primitive. Stage 2 (NOT this dispatch): a fail-closed
must-release obligation checker. Motivating case: `compiler/self-host/pa.scrml:274` `try { … } finally { cache.closeAll() }`.
Rejected alternatives (do not reintroduce): `lin` (§35.1 forbids intermediate references), `cleanup()` (§6.7 reactive-scope),
a `using` block.

## The ratified semantics — this is a NEW normative section; you write the SPEC text first, then implement it
- `defer <stmt>` runs `<stmt>` when the ENCLOSING BLOCK exits by ANY path: fall-through, `return`, `break`/`continue` out of
  it, `fail`, `?` propagation.
- Multiple defers in a block run LIFO.
- The deferred statement SHALL NOT contain `return`, `fail`, `?` propagation, `break`/`continue` leaving it, or a nested
  `defer` → new error code(s) (name them, e.g. `E-DEFER-CONTROL-FLOW`, `E-DEFER-NESTED`).
- A failable call inside the deferred statement SHALL be handled in place with `!{}` (an unhandled failable call →
  error; name the code).
- Legal only in function / `fn` / logic bodies; NOT in markup (→ error). `defer` as the HTML `<script defer>` attribute and as
  an identifier elsewhere is untouched ("the word is not at fault", P1).
- `fn` purity: decide and SPEC whether `defer` is legal in a pure `fn` (it is control flow, not an effect; the deferred
  statement is itself subject to fn prohibitions) — state the reasoning.
- ⚑ **Body-split / CPS (§19.9.3, §19.9.9): a `defer` in a function whose body is split at server-call boundaries MUST run
  after the LAST continuation completes, not when the first stub returns.** This is the correctness hazard — build a test that
  would fail under the naive lowering. If you cannot make it correct, make `defer` + body-split a compile ERROR with a clear
  code rather than a silent wrong lowering, and report it.
- Lowering: compiler-emitted host `try { … } finally { … }` (like the §19.6.8 `<errorBoundary>` backstop — compiler-emitted
  host JS, not scrml-source try).

## Do
1. SPEC: a new subsection (propose where — §19 error handling is the likely home; justify) with grammar, normative
   statements, worked example (the pa.scrml case rewritten: `let cache = openSchemaCache()` / `defer closeAll(cache)`),
   §34 rows, `provenance: ruling:user-voice-S430-P3`. Regenerate SPEC-INDEX (`bun run scripts/regen-spec-index.ts`).
2. Implement in both front-ends + codegen (client and server emit paths).
3. Tests for every normative statement incl. LIFO, each exit path, the restriction codes, CPS.
4. Conformance cases: codes-half AND runtime-half (a defer that must run on a `fail` path observable in final state).
5. Corpus: compile base vs build — expected zero impact (a new keyword in statement position: report any identifier named
   `defer` that breaks).
