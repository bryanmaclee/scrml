# error.map.md
# project: scrmlts
# updated: 2026-05-29T00:00:00-06:00  commit: 9ab7aa38

scrml's own language error model is values-not-exceptions (SPEC §19.1 — no try/catch, no throw).
The compiler tooling uses its own error taxonomy internally.

## Custom Error Types (compiler-internal)

`CGError` — `compiler/src/codegen/errors.ts:11` — base diagnostic class for all pipeline stages; fields: `code`, `message`, `span`, `severity`
`BSError extends Error` — `compiler/src/block-splitter.js:59` — thrown by block-splitter for structural parse failures
`TABError extends Error` — `compiler/src/ast-builder.js:1364` — thrown by TAB (AST builder) for unrecoverable parse errors

### Runtime errors emitted into generated output (compiler/src/runtime-template.js)
`_ScrmlError extends Error` — base; `line:2020`
`NetworkError extends _ScrmlError` — `line:2028`
`ValidationError extends _ScrmlError` — `line:2036`
`SQLError extends _ScrmlError` — `line:2044`
`AuthError extends _ScrmlError` — `line:2052`
`TimeoutError extends _ScrmlError` — `line:2060`
`ParseError extends _ScrmlError` — `line:2068`
`NotFoundError extends _ScrmlError` — `line:2076`
`ConflictError extends _ScrmlError` — `line:2084`

## Diagnostic Code Catalog (SPEC §34 — normative)

SPEC §34 is the authoritative error code source (~684 lines; 240+ codes). Key families:

| Prefix family | Coverage |
|---|---|
| `E-SYNTAX-*` | tokenizer / block-splitter parse errors |
| `E-STMT-*` / `E-EXPR-*` | native-parser diagnostics (§34.1 sub-section; 79 codes) |
| `E-ATTR-*` | attribute validation |
| `E-COMPONENT-*` | component system |
| `E-ENGINE-*` | state machine / engine decl |
| `E-LIN-*` | linear type violations |
| `E-TYPE-*` | type system |
| `E-CG-*` | code generator |
| `E-IMPORT-*` / `E-USE-*` | module / import system |
| `E-META-*` | metaprogramming |
| `E-SQL-*` | SQL context |
| `E-LIFECYCLE-*` | lifecycle annotation |
| `E-MATCH-*` | pattern matching |
| `E-CPS-MULTIBATCH-*` | multi-batch CPS planner (SPEC §19.9.9) |
| `E-FORMFOR-*` / `E-PARSEVARIANT-*` / `E-SCHEMAFOR-*` / `E-TABLEFOR-*` | L22 type-as-argument family |
| `E-TEST-*` | test-block (`~{}`) errors |
| `W-*` | non-fatal warnings (route to `result.warnings`) |
| `I-*` | info-level lints (route to `result.warnings`) |

Notable codes added or closed since S135 watermark:

- `E-CPS-MULTIBATCH-REORDER` / `E-CPS-MULTIBATCH-MACHINE-CROSSING` — §34.1 §19.9.9 (S114 Ext 1)
- `E-STORY-UNKNOWN` / `W-STORY-ON-TOP-LEVEL` — §58 Build Story (S118, Nominal section)
- `E-CODEGEN-INVALID-JS` — **NEW S141** (`compiler/src/codegen/validate-emit.ts:94`); emitted-JS in-process parse gate (Approach A, ratified S141); fires when any final artifact (`.client.js` / `.server.js` / library `.js` / per-route chunk / runtime chunk) fails Acorn parse after codegen; aborts compile (exit 1) and writes no output artifacts; diagnostic names artifact path + byte/line/column + 60-char snippet; framed as compiler defect (adopter cannot fix emitted JS); wired in `api.js:1919` behind `validateEmit` option (default `false`; flag-gated per §2.2.1 carry-forward backlog); mirrors `E-META-EVAL-002` reparse-emitted precedent from §22.4; SPEC §34 + §2.2.1 — codegen-gate catalog entry
- `E-CG-003` — **NEW S141** (`compiler/src/codegen/emit-control-flow.ts:1621`); hard error on no-arm-lowerable `<match>` expression; replaces the prior silent `/* match expression could not be compiled */` stub that produced invalid JS in expression position (R27 C2 class); emits a source-anchored CGError when an error channel is threaded, AND falls back to syntactically-valid `(undefined)` placeholder so the parse gate (E-CODEGEN-INVALID-JS) does not double-report a known-unlowerable site; SPEC §34 §47
- Bug 9 L2 / Bug 55: `isStatementShapeStmt` guard in `scheduling.ts` prevents Promise.all shape errors (no new error code; silent miscompile class closed)
- Bug 56: body-DG reads folded into scheduler dep sets (no new error code; TDZ silent miscompile class closed)
- Bug 57 (S140): `case "each-block"` chunk-gate added to `emit-client.ts:detectRuntimeChunks` — `<each>` files shipped without `_scrml_reconcile_list` definition (ReferenceError on first render); no new error code; runtime crash class closed
- Bug 58 (S140): `type-system.ts` routes formFor compound decls into §55 validity-surface pass; `emit-form-for.ts` tags `_cellKind:"compound-parent"`, wires `formForSubmitCell` on submit binding; `emit-event-wiring.ts` / `emit-bindings.ts` / `emit-html.ts` consume the tags — no new error code; formFor validity surface was silently dead
- Bug 59 (S140): `emit-lift.js` per-row event emission corrected for `<tableFor>` (string-form + AST-form paths) — no new error code; per-row handlers were dropped
- Bug 61 (S140): `collectSynthCellKeys` collector added to `reactive-deps.ts`; threaded into `CompileContext.synthCellKeys`; `emit-expr.ts:emitMember` gates `@compound.<synthProp>` reads on membership in this set to route to `_scrml_reactive_get("<dotted>")` — no new error code; `@compound.<synthProp>` reads collapsed to dotted synth cell correctly; over-fire guard prevents plain object fields from mis-routing

## Diagnostic-Stream Partition Rule (S93 fix, api.js:2200)

```
isNonFatal(e) = e.code?.startsWith("W-") || e.code?.startsWith("I-")
             || e.severity === "warning" || e.severity === "info"

result.errors   = allErrors.filter(!isNonFatal)   → CLI exit 1
result.warnings = allErrors.filter(isNonFatal)    → CLI exit 0
```

CRITICAL: tests asserting on W-*/I-* codes MUST use a cross-stream helper; `result.errors.filter(e => e.code === "W-...")` always yields empty (S92 false-negative precedent).

## Error Handling Patterns (compiler pipeline)

`collectErrors(stageName, errors, filePath)` — central accumulator in `api.js:733`; stamps `filePath` and `stage` onto every diagnostic; routes CGError-shape objects + raw Error objects
Per-stage `errors` arrays are merged into `allErrors`; then partitioned at pipeline exit
`BSError`/`TABError` thrown synchronously → caught in `try/catch` in api.js → added to `allErrors` with stage label

## Global Error Handling

No global Express error handler (compiler is a library / CLI tool, not a web server).
Test suite uses `compileScrml()` result inspection, not try/catch patterns.

## Tags
#scrmlts #map #error #diagnostics #compiler #pipeline #spec-34 #e-codegen-invalid-js #e-cg-003 #v0.6.10

## Links
- [primary.map.md](./primary.map.md)
- [schema.map.md](./schema.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
