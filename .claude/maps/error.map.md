# error.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

scrml's own language error model is values-not-exceptions (SPEC §19.1 — no try/catch,
no exceptions in scrml SOURCE). Entries below are the COMPILER's own (host-side,
JavaScript/TypeScript) diagnostic infrastructure.

## Per-Stage Diagnostic Classes

| Class | File | Stage | Notes |
|---|---|---|---|
| `BSError` | block-splitter.js:59 | Stage 2 (BS) | extends Error; `bsSpan` lifted to `span` by api.js |
| `TABError` | ast-builder.js:1232 | Stage 3 (TAB) | extends Error |
| `ModuleError` | module-resolver.js:33 | Stage 3.1 (MOD) | module resolution |
| `GauntletError` | gauntlet-phase1-checks.js:44 | Gauntlet Phase 1 | |
| `PAError` | protect-analyzer.ts:126 | Stage 4 (PA) | |
| `RIError` | route-inference.ts:326 | Stage 5 (RI) | |
| `TSError` | type-system.ts:516 | Stage 6 (TS) | |
| `MetaError` | meta-checker.ts:67 | Stage 6.5 (MC) | |
| `MetaEvalError` | meta-eval.ts:49 | Stage 6.5 (ME) | |
| `DGError` | dependency-graph.ts:233 | Stage 7 (DG) | |
| `CGError` | codegen/errors.ts:11 | Stage 8 (CG) | `{ code, message, span, severity }` |

## Native-Parser Parse Diagnostics (SPEC §34.1)

81 codes: 79 hard `E-` errors + 2 info-level `I-NATIVE-BLOCK-*` codes. Stable through S124 — no new §34.1 codes landed in S124.

B-wave codes (S118): E-STMT-LIN-* / E-STMT-TYPE-* / E-STMT-FN-* / E-STMT-TILDE-* / E-EXPR-GUARDED-UNCLOSED / E-THROW-NOT-IN-SCRML / E-TRY-NOT-IN-SCRML.

FileAST-assembler info codes (S119 C2 — `nativeParseFile`):
- `I-NATIVE-BLOCK-DROPPED` — BlockKind with no live ASTNode was dropped; severity: info → `result.warnings`
- `I-NATIVE-BLOCK-UNMAPPED` — unknown BlockKind dropped; forward-compat guard; severity: info → `result.warnings`

## S123 Host-Pipeline Codes (SPEC §34)

| Code | Source | When |
|---|---|---|
| `E-STATE-UNDECLARED` | symbol-table.ts PASS 3 | bare `@name = expr` write inside fn/function/user `${...}` without structural `<name>` decl in scope (V-kill) |
| `E-WRITE-NOT-IN-LOGIC-CONTEXT` | symbol-table.ts PASS 3 | bare `@name = expr` at `<program>`/`<page>`/`<channel>` immediate body-top (Unit CC); per-file exemption via `unit-cc-exemption-list.json` |

## Stdlib-Shim Warnings (SPEC §34)

| Code | When |
|---|---|
| `W-STDLIB-SHIM-MISSING` | bundleStdlibForRun: `scrml:NAME` has no runtime shim at `compiler/runtime/stdlib/<name>.js` |
| `W-STDLIB-COMPILER-DEFERRED` | bundleStdlibForRun: any name matching `"compiler"` or `"compiler/..."` — fires regardless of shim presence |

## Promotion / Info Lints (SPEC §34 + §56)

| Code | Source | When |
|---|---|---|
| `I-MATCH-PROMOTABLE` | lint-i-match-promotable.js | promotable plain-match → match-block opportunity |
| `I-FN-PROMOTABLE` | lint-i-fn-promotable.js (S122) | `function`-keyword decl eligible for `fn` rename per §48.3 prohibitions |
| `I-PARSER-NATIVE-SHADOW` | api.js | `--parser=scrml-native` flag is active |
| `I-ASYNC-USER-SOURCE` | validators/lint-async-user-source.ts | async in user source |
| `I-AUTH-REDIRECT-UNRESOLVED` | route-inference.ts | auth redirect target not resolvable |

## Runtime Error Classes (emitted INTO user output — compiler/src/runtime-template.js)

All extend `_ScrmlError` (extends Error):
`NetworkError [2028]` | `ValidationError [2036]` | `SQLError [2044]` | `AuthError [2052]` | `TimeoutError [2060]` | `ParseError [2068]` | `NotFoundError [2076]` | `ConflictError [2084]`

## Error Code Families (selected — host-side, by prefix)

| Family | ~Count | Key codes |
|---|---|---|
| E-TYPE | 159 | type mismatch / kind errors |
| E-ENGINE | 118 | state machine violations |
| E-DERIVED | 106 | derived-cell constraint violations |
| E-LIN | 75 | lin-token errors |
| E-FN | 74 | fn/function declaration violations |
| E-COMPONENT | 71 | component expansion errors |
| E-IMPORT | 68 | module resolution errors |
| E-META | 64 | meta-programming errors |
| W-LINT | 24 | lint codes W-LINT-001..W-LINT-024 |
| E-CG | 54 | codegen errors |

Warning families: `W-CG-CHUNK-*`, `W-AUTH-*`, `W-LINT-*`, `W-ENGINE-*`, `W-DEPRECATED-*`, `W-STDLIB-*`, `W-DEAD-FUNCTION`, `W-PROGRAM-*`.
Info families: `I-PARSER-NATIVE-SHADOW`, `I-NATIVE-BLOCK-*`, `I-MATCH-PROMOTABLE`, `I-FN-PROMOTABLE`, `I-ASYNC-USER-SOURCE`, `I-AUTH-REDIRECT-UNRESOLVED`.

## Error Handling Patterns

- `collectErrors(stageName, errors, filePath?)` in api.js — normalizes all stage diagnostics, stamps filePath, lifts BSError `bsSpan`→`span`, pushes to `allErrors`.
- Diagnostic-stream partition — api.js: `isNonFatal(e)` routes W-*/I- prefixed or severity warning/info to `result.warnings`; everything else to `result.errors` (CLI exits 1 on non-empty errors). Tests asserting on W-/I- codes MUST use a cross-stream helper — `result.errors.filter(e => e.code === "W-...")` silently passes (S92 false-negative class).
- Native-parser modules record errors as VALUES — `recordError(ctx, code, message, span)` appends to context error array; no throws.
- Per-stage try/catch in api.js wraps BS and TS-promote capture hook only (2 catch sites).

## Global Error Boundaries

No host-side global error boundary — compiler is a batch process; fatal errors surface via `result.errors` and non-zero CLI exit. Generated apps embed `_ScrmlError`-based runtime handling per SPEC §19.

## Unhandled Error Risks

- api.js BS-stage catch swallows non-BSError throws into a generic `E-BS-000` with no span.
- `component-expander.ts` M6.2b live-path fallback (`sourceNeedsLiveFallback`) — errors on the legacy `splitBlocks`+`buildAST` path surface through the legacy CE diagnostic channel, not the native path.

## Tags
#scrmlts #map #error #diagnostics #pipeline #native-parser #stdlib-shims #i-fn-promotable #v-kill #unit-cc #e-state-undeclared #e-write-not-in-logic-context #m6-6-b2

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
