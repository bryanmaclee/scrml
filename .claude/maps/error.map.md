# error.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Error Code System

Errors are structured `CGError` instances (compiler/src/codegen/errors.ts). Runtime errors extend `_ScrmlError` (runtime-template.js). Codes follow the pattern `E-DOMAIN-NNN` or `W-DOMAIN-NNN` (warnings) or `I-DOMAIN-NNN` (info). Authoritative catalog: SPEC.md §34.

## CGError Type  [compiler/src/codegen/errors.ts:11]

```typescript
class CGError {
  code: string
  message: string
  span: CGSpan | object
  severity: 'error' | 'warning'  // default: 'error'
}
```

## Runtime Error Classes  [compiler/src/runtime-template.js:1423+]

All extend `_ScrmlError extends Error`.

| Class | When thrown |
|-------|-------------|
| _ScrmlError | Base class; never thrown directly |
| NetworkError | HTTP/network failures from server functions |
| ValidationError | Validator predicate failures |
| SQLError | Database query failures |
| AuthError | Authentication/authorization failures |
| TimeoutError | `<onTimeout>` and `<onIdle>` expiry |
| ParseError | Response parsing failures |
| NotFoundError | 404-equivalent resource absence |
| ConflictError | 409-equivalent resource conflict |

## Compiler Error Code Families (source-confirmed)

| Family | Example Codes | Domain |
|--------|--------------|--------|
| E-ATTR-* | 001, 002, 010, 011, 013 | Attribute validation (UVB/VP) |
| E-AUTH-* | 002, 003, 004, 005 | Auth configuration errors |
| E-BATCH-* | 001, 002 | Batch planner (Stage 7.5) |
| E-BPP-* | 001 | Body pre-parser (compat shim) |
| E-BS-* | 000 | Block splitter (Stage 2) |
| E-CG-* | 001, 002, 003, 006, 010, 014, 015 | Codegen (Stage 8); E-CG-006 = SQL-to-client leak |
| E-CHANNEL-* | 001, 007, 008 | Channel declaration/usage |
| E-CHANNEL-OUTSIDE-PROGRAM | §38.1 | `<channel>` at file-top when file ALSO has `<program>` (PURE-CHANNEL-FILE shape is exempt) |
| E-CHANNEL-INSIDE-PAGE | §38.1 | `<channel>` inside `<page>` — forbidden |
| E-COMPONENT-* | 010–035 | Component expansion/definition |
| E-CONTRACT-* | 001–004 | Pipeline contract violations |
| E-CTRL-* | 001–005, 011 | Control flow errors |
| E-CTX-* | 001–003 | Context violations |
| E-DEBOUNCED-WITH-DERIVED | §6.13 | Debounced attr on derived cell |
| E-DEBOUNCED-WITH-SERVER | §6.13 | Debounced attr on server-context cell |
| E-DG-* | 001, 002 | Dependency graph (Stage 7) |
| E-ENGINE-* | 001, 003, 004, 005, 010, 013 | Engine declaration/transition |
| E-ENGINE-INVALID-TRANSITION | §51.0.F | Direct write violating rule= contract |
| E-ERROR-* | 008 | Error handling surface |
| E-IMPORT-* | 005, 006, 007 | Import violations |
| E-INPUT-* | 001–005 | §36 input device errors; E-INPUT-005 = duplicate input-state id in scope [NEW S89 §36 Phase 2.B, emit-html.ts:260] |
| E-LIFT-* | 001 | Concurrent lift detection (DG) |
| E-LOOP-* | 005, 006, 007 | Loop/for-expression errors |
| E-META-EVAL-* | 002 | Meta-eval errors |
| E-MONOTONE-* | (see SPEC §34) | Monotonicity analyzer |
| E-NAME-COLLIDES-STATE | §34 | Name collision with state type |
| E-ONTRANSITION-NO-TARGET | §34 | onTransition has no target engine |
| E-PA-* | 002–007 | Protect analyzer |
| E-PAGE-INVALID-ATTR | §4.15 | `<page>` attribute outside allowed set |
| E-PAGE-ROUTE-ATTR-FORBIDDEN | §4.15 | `route=` specifically forbidden on `<page>` |
| E-PARSE-* | 001, 002 | Parse-time errors |
| E-PARSEVARIANT-* | 001 | Variant parsing failures |
| E-PROG-* | 001–005 | `<program>` attribute/context errors; E-PROG-004 = cross-program call not awaited (demoted Error→Info S89 §13.2) |
| E-REPLAY-* | 001-RT | Runtime: replay index errors |
| E-REACTIVITY-ATTR-CONFLICT | §6.13 | Both debounced + throttled on same cell |
| E-RESET-* | INVALID-TARGET, NO-ARG | Reset keyword errors |
| E-RI-* | 002 | Route inference errors |
| E-SQL-* | 005, 006, 008 | SQL validation errors |
| E-STATE-* | 004, 005, 006, COMPLETE, PINNED-FORWARD-REF, TERMINAL-MUTATION, TRANSITION-ILLEGAL | State/engine errors |
| E-STYLE-* | 001 | CSS validation errors |
| E-SYNTAX-* | 002, 010, 011, 042, 043, 044, 050 | Syntax violations; E-SYNTAX-042 = `null`/`undefined` in scrml source position |
| E-TAILWIND-* | 001 | Tailwind class validation |
| E-TEST-* | 001–006 | Test block violations (§19.13) |
| E-TILDE-* | 001, 002 | Tilde-decl must-use violations |
| E-TIMEOUT-* | 001, 002 | Timeout configuration errors |
| E-TYPE-* | 001, 004, 006, 020–081 | Type system errors (Stage 6 TS) |
| E-USE-* | 001, 002, 005 | Usage analysis errors |
| E-VALIDATOR-* | CIRCULAR-DEP, INLINE-DYNAMIC | Validator graph errors |
| E-VARIANT-AMBIGUOUS | §34 | Variant inference ambiguity |
| W-ABSENCE-IN-SCRML-SOURCE | §42.1, §6.8, §34 | [S89 — renamed from W-NULL-IN-SCRML-SOURCE] Info-level: `null` or `undefined` in scrml source position; canonical absence is `not` |
| W-CG-* | 001 | Codegen warnings |
| W-ENGINE-SELF-WRITE-DETECTED | §51.0.F.1 | Info-level: engine self-write detected; runtime NO-OP. Two fire-sites: PASS 16 + PASS 12.B in symbol-table.ts |
| W-INPUT-001 | §36 | [NEW S89] Input-device warning (SPEC §36 catalog) |
| W-PROGRAM-REDUNDANT-LOGIC | §4.14 | `<program>`/`<page>` body wraps top-level decls in redundant `${}` block |
| W-TRY-CATCH-IN-SCRML-SOURCE | §34 | [NEW S89] Try/catch in scrml source; Stage 3.007 LINT-TRY-CATCH walker (validators/lint-try-catch.ts); fires on stdlib/http lines 65/264 |

## scrml:host HostError Type (S88)

HostError is NOT a subclass of _ScrmlError. It is a variant-constructor object matching the scrml enum variant shape:
```
{ variant: "Thrown", data: { message: string, name: string } }
```
Used by `safeCall` / `safeCallAsync` return values when a JS-host throw is caught. Sentinel field `__scrml_error: true` distinguishes error shapes from success values.

## Error Handling Patterns

| Pattern | Where used |
|---------|------------|
| `errors.push(new CGError(...))` | Accumulated during pipeline stages; surfaced at CLI output |
| `throw new Error("E-ENGINE-001-RT: ...")` | Runtime guard in compiled output — illegal state transition |
| `throw new Error("E-REPLAY-001-RT: ...")` | Runtime guard in compiled output — replay index out of bounds |
| `try/catch` in pipeline orchestration | api.js wraps each stage; errors collected, not re-thrown |
| `!{}` error-effect blocks | Compiled user error handlers (pattern-matched on error type) |
| `safeCall(() => ...)` | S88: JS-host throw containment in stdlib; returns HostError shape |
| `await safeCallAsync(() => ...)` | S88: async variant; W-TRY-CATCH-IN-SCRML-SOURCE fires on stdlib/http remaining try-catch sites |

## Global Error Boundaries

| Name | File | Scope |
|------|------|-------|
| CGError accumulator | codegen/index.ts → api.js | Per-file compilation errors; returned to caller |
| _scrml_error_boundary | runtime-template.js | Per-server-function HTTP handler; catches and serializes errors |
| `!{}` arm dispatch | emit-html.ts + emit-event-wiring.ts | User-authored match-on-error reactive blocks |

## Diagnostic Walkers and Passes

| File / Pass | What it checks |
|-------------|----------------|
| compiler/src/gauntlet-phase1-checks.js | Post-TAB diagnostics for Stage 1 issues |
| compiler/src/gauntlet-phase3-eq-checks.js | Post-TAB equality and Phase 3 semantic checks |
| compiler/src/lint-ghost-patterns.js | Pre-Stage-2 lint for ghost/phantom patterns |
| compiler/src/lint-i-match-promotable.js | Lint for promotable i-match patterns |
| compiler/src/validators/ast-walk.ts | Shared read-only walker; channel placement pre-check |
| compiler/src/validators/lint-try-catch.ts | Stage 3.007 W-TRY-CATCH-IN-SCRML-SOURCE [NEW S89] |
| compiler/src/validators/lint-async-user-source.ts | Async user-source lint pass |
| compiler/src/symbol-table.ts PASS 12.B | W-ENGINE-SELF-WRITE-DETECTED outside-state-child |
| compiler/src/symbol-table.ts PASS 16 | Inside-state-child W-ENGINE-SELF-WRITE-DETECTED fire-site |
| compiler/src/codegen/emit-html.ts §36 Phase 2.B | E-INPUT-005 duplicate input-state-id-within-scope [NEW S89] |

## Tags
#scrmlts #map #error #diagnostics #runtime-errors #error-codes #s89 #lift-fixes-complete #safecall #host-error #null-eradication #w-absence #w-try-catch #input-devices

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
