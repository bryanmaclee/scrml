# error.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## Error Code System

Errors are structured `CGError` instances (compiler/src/codegen/errors.ts). Runtime errors extend `_ScrmlError` (runtime-template.js). Codes follow the pattern `E-DOMAIN-NNN` (errors), `W-DOMAIN-NNN` (warnings), or `I-DOMAIN-NNN` (info). Authoritative catalog: SPEC.md §34.

## CGError Type  [compiler/src/codegen/errors.ts:11]

```typescript
class CGError {
  code: string
  message: string
  span: CGSpan | object
  severity: 'error' | 'warning' | 'info'   // updated S92: now includes 'info'
}
```

Note: CGError.severity is `'error' | 'warning' | 'info'` (updated S92). Auth-graph and reachability diagnostics carry the same three-way severity through their own `AuthGraphDiagnostic` and `RSError` types (see schema.map.md).

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
| E-CG-* | 001, 002, 003, 006, 010, 014, 015 | Codegen (Stage 8) |
| E-CHANNEL-* | 001, 007, 008 | Channel declaration/usage |
| E-CHANNEL-OUTSIDE-PROGRAM | §38.1 | `<channel>` at file-top in file with `<program>` sibling |
| E-CHANNEL-INSIDE-PAGE | §38.1 | `<channel>` inside `<page>` |
| E-CLOSURE-001 | §40.9.1, §40.9.11 | Fixed-point non-termination; fired by outer-fixpoint.ts when iteration cap reached (A-2.7) |
| E-CLOSURE-002 | §40.9.5, §40.9.11 | App uses `<auth role=...>` variant-referencing gates with no app-scope role enum declared; fired by A-2.5 (Component 4) |
| E-COMPONENT-* | 010–035 | Component expansion/definition |
| E-CONTRACT-* | 001–004 | Pipeline contract violations |
| E-CTRL-* | 001–005, 011 | Control flow errors |
| E-CTX-* | 001–003 | Context violations; E-CTX-001 also fires on unclosed raw-content element (§4.17) |
| E-DEBOUNCED-WITH-DERIVED | §6.13 | Debounced attr on derived cell |
| E-DEBOUNCED-WITH-SERVER | §6.13 | Debounced attr on server-context cell |
| E-DG-* | 001, 002 | Dependency graph (Stage 7) |
| E-ENGINE-* | 001, 003, 004, 005, 010, 013 | Engine declaration/transition |
| E-ENGINE-INVALID-TRANSITION | §51.0.F | Direct write violating rule= contract |
| E-ENGINE-PAYLOAD-ON-UNIT-VARIANT | §51.0.B.1 S98 | Payload binding attrs on a unit variant state-child; compiler wiring pending Track 2 |
| E-ENGINE-PAYLOAD-ARITY-MISMATCH | §51.0.B.1 S98 | Binding count != variant payload field count; compiler wiring pending Track 2 |
| E-ENGINE-PAYLOAD-RESERVED-COLLISION | §51.0.B.1 S98 | Payload binding name shadows reserved state-child attribute {rule, effect, history, internal:rule}; compiler wiring pending Track 2 |
| E-ERROR-* | 008 | Error handling surface |
| E-IMPORT-* | 005, 006, 007 | Import violations |
| E-INPUT-* | 001–005 | §36 input device errors |
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
| E-PROG-* | 001–005 | `<program>` attribute/context errors |
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
| E-TIMER-NAME-DUPLICATE | §51.0.M.1 | Engine state-child declares two `<onTimeout>` with same `name=` value; fire-site: engine-statechild-parser.ts (A5-6 Feature 1, S79) |
| E-TIMER-NAME-INVALID | §51.0.M.1 | `<onTimeout name=...>` value is not identifier-shaped; fire-site: engine-statechild-parser.ts (A5-6 Feature 1, S79) |
| E-TYPE-* | 001, 004, 006, 020–081 | Type system errors (Stage 6 TS) |
| E-USE-* | 001, 002, 005 | Usage analysis errors |
| E-VALIDATOR-* | CIRCULAR-DEP, INLINE-DYNAMIC | Validator graph errors |
| E-VARIANT-AMBIGUOUS | §34 | Variant inference ambiguity |

## Auth-Graph Diagnostic Codes (A-3, typed separately from CGError)

Fire-site: `compiler/src/auth-graph.ts` + `compiler/src/reachability/component-4.ts`

| Code | Severity | When fired | Fire-site |
|------|----------|-----------|-----------|
| E-AUTH-GRAPH-001 | error | role-enum declared but malformed | A-3.2 resolveRoleEnum() |
| E-AUTH-GRAPH-002 | error | multiple role enums in same compilation unit | A-3.2 resolveRoleEnum() |
| E-AUTH-GRAPH-003 | error | `<auth role="X">` references variant not in enum | A-3.3 classifyGates() |
| E-AUTH-GRAPH-004 | error | `<auth>` block without `role=` AND without `check=` | A-3.3 classifyGates() |
| I-AUTH-REDIRECT-UNRESOLVED | info | gate redirect target path does not match any RouteMap.pages URL | A-3.4 crossRefRedirects() |
| W-AUTH-PAGE-INFERRED | info | `<page>` lacks explicit `auth=` AND enclosing `<program auth=required>` present | A-3.3 classifyGates() |
| W-AUTH-LOGIN-MISSING | warning | auth gates present + no login page at configured loginRedirect path; two-tier severity; fires once per compilation | auth-graph.ts checkLoginMissing() |
| W-AUTH-RUNTIME-FALLBACK | info | auth gate uses async-only check; static role classification impossible; gated component shipped eagerly | A-2.5 component-4.ts |
| E-CLOSURE-002 | error | application uses auth-role-block gates but declares no app-scope role enum | A-2.5 component-4.ts |

## Chunk Lint Codes (A-4.7 + Q-OPEN-6 — fired from route-splitter.ts:emitChunkLints)

| Code | Severity | When fired |
|------|----------|-----------|
| W-CG-CHUNK-EMPTY | warning | entry-point produces zero non-empty chunks across all roles |
| W-CG-CHUNK-LARGE | warning | initial chunk payloadJs exceeds soft size budget (default 100,000 bytes; configurable via `--chunk-size-budget=N`) |
| W-CG-CHUNK-NO-PREFETCH | info | multi-route app AND entry-point has NO internal `<a href>` links at all (Q-OPEN-6 case 1) |
| W-CG-CHUNK-PREFETCH-UNRESOLVED | warning | multi-route app AND internal-shaped `<a href>` links exist but NONE resolved to RouteMap.pages (Q-OPEN-6 case 2) |
| W-CG-CHUNK-MISSING-ROLE | warning | `<auth role="X">` references a role with no ChunkPlan in reachability record |

W-CG-CHUNK-NO-PREFETCH and W-CG-CHUNK-PREFETCH-UNRESOLVED are mutually exclusive per Q-OPEN-6: `hasInternalLinks` (ctx field) discriminates case 1 (info) vs case 2 (warning). All five codes in SPEC §34 + §40.9.11 catalog.

## Warning Codes (W-*)

| Code | Severity | Domain |
|------|----------|--------|
| W-ABSENCE-IN-SCRML-SOURCE | info | `null` or `undefined` in scrml source (S89 renamed from W-NULL-IN-SCRML-SOURCE) |
| W-CG-UNDEFINED-INTERPOLATION | warning | Bare `undefined` JS keyword found in compiled output (M-7C-D-12 Track 3; fires from `lint-undefined-interpolation.ts`) |
| W-CG-CHUNK-EMPTY | warning | entry-point produces zero non-empty chunks (A-4.7, route-splitter.ts) |
| W-CG-CHUNK-LARGE | warning | initial chunk exceeds size budget (A-4.7; Q-OPEN-5 configurable threshold, route-splitter.ts) |
| W-CG-CHUNK-NO-PREFETCH | info | multi-route app, no internal links at all (Q-OPEN-6 case 1, route-splitter.ts) |
| W-CG-CHUNK-PREFETCH-UNRESOLVED | warning | internal-shaped links exist but none resolve to RouteMap.pages (Q-OPEN-6 case 2, route-splitter.ts) |
| W-CG-CHUNK-MISSING-ROLE | warning | `<auth role=X>` role not in reachability record (A-4.7, route-splitter.ts) |
| W-AUTH-LOGIN-MISSING | warning | auth gates present but no login page at loginRedirect path (A-3.5, auth-graph.ts) |
| W-ENGINE-SELF-WRITE-DETECTED | info | Engine self-write detected; runtime NO-OP (two fire-sites: symbol-table.ts PASS 12.B + PASS 16) |
| W-INPUT-001 | warning | §36 input device warning |
| W-PROGRAM-REDUNDANT-LOGIC | warning | Redundant `${}` block in program/page body |
| W-TRY-CATCH-IN-SCRML-SOURCE | warning | Try/catch in scrml source (Stage 3.007; fires on stdlib/http lines 65/264) |

## Error Handling Patterns

| Pattern | Where used |
|---------|------------|
| `errors.push(new CGError(...))` | Accumulated during CG pipeline stages; surfaced at CLI output |
| `throw new Error("E-ENGINE-001-RT: ...")` | Runtime guard in compiled output |
| `throw new Error("E-REPLAY-001-RT: ...")` | Runtime guard in compiled output |
| `try/catch` in pipeline orchestration | api.js wraps each stage; errors collected, not re-thrown |
| `!{}` error-effect blocks | Compiled user error handlers (pattern-matched on error type) |
| `safeCall(() => ...)` | JS-host throw containment in stdlib; returns HostError shape |
| `await safeCallAsync(() => ...)` | Async variant; W-TRY-CATCH-IN-SCRML-SOURCE fires on stdlib/http remaining try-catch sites |

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
| compiler/src/validators/lint-try-catch.ts | Stage 3.007 W-TRY-CATCH-IN-SCRML-SOURCE |
| compiler/src/validators/lint-async-user-source.ts | Async user-source lint pass |
| compiler/src/symbol-table.ts PASS 12.B | W-ENGINE-SELF-WRITE-DETECTED outside-state-child |
| compiler/src/symbol-table.ts PASS 16 | W-ENGINE-SELF-WRITE-DETECTED inside-state-child |
| compiler/src/codegen/lint-undefined-interpolation.ts | W-CG-UNDEFINED-INTERPOLATION post-emission scan |
| compiler/src/auth-graph.ts classifyGates() | W-AUTH-PAGE-INFERRED + E-AUTH-GRAPH-* |
| compiler/src/auth-graph.ts crossRefRedirects() | I-AUTH-REDIRECT-UNRESOLVED |
| compiler/src/auth-graph.ts checkLoginMissing() | W-AUTH-LOGIN-MISSING |
| compiler/src/reachability/component-4.ts | W-AUTH-RUNTIME-FALLBACK + E-CLOSURE-002 |
| compiler/src/reachability/outer-fixpoint.ts | E-CLOSURE-001 |
| compiler/src/codegen/route-splitter.ts emitChunkLints() | W-CG-CHUNK-* family + W-CG-CHUNK-PREFETCH-UNRESOLVED |
| compiler/src/engine-statechild-parser.ts | E-TIMER-NAME-DUPLICATE + E-TIMER-NAME-INVALID (§51.0.M.1) |

## Tags
#scrmlts #map #error #diagnostics #runtime-errors #error-codes #s101 #v0.3.1 #wire-format #auth-graph #w-cg-undefined #closure #auth-runtime-fallback #w-cg-chunk #w-auth-login-missing #route-splitter #q-open-6 #payload-binding #named-timers #raw-content

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
