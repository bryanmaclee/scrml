# E-ROUTE wire-serializability gate — progress

change-id: e-route-serializability-gate-2026-06-10
worktree: (see first commit message for verified pwd)

## Phase 0 — survey + confirm-gate (COMPLETE)

Timestamp: session start.

Findings (all CONFIRM the grounded context; nothing contradicts):

- **E-ROUTE-003 SPEC-only**: `grep -rn "E-ROUTE-003" compiler/src/` returns EMPTY. SPEC.md:7043 (§12.5.3) prose + §34 catalog row 17138 are the only mentions. Confirmed: the return gate is emitted NOWHERE.
- **E-ROUTE-004 FREE**: `grep -rn "E-ROUTE-004"` repo-wide (excl node_modules) returns EMPTY. -001/-002/-003 taken; -004 available.
- **RI→TS order**: api.js Stage 5 = RI (`runRI` → `riResult.routeMap`), Stage 6 = TS (`runTS`). runTS ALREADY receives `routeMap: riResult.routeMap` (api.js:1743). FunctionRoute (route-inference.ts:232) carries NO resolved types — confirms the check cannot live in RI's main pass.
- **routeMap key shape**: `${filePath}::${fnNode.span.start}`, boundary "client"|"server"|"middleware" (route-inference.ts:234). Existing precedent at type-system.ts:6484 (`const fnId = ...; routeMap.functions.get(fnId)`) and 15082-15117 (formFor onsubmit server-classification).
- **param/return resolution**: function-decl node carries `param.typeAnnotation` (string) and `n.returnTypeAnnotation` (string); both resolved via `resolveTypeExpr(annot, typeRegistry)` — EXACT precedent at type-system.ts:6428-6464 (fnSignatures build).
- **type-kind discriminants** (type-system.ts:383-401 ResolvedType union): primitive/struct/enum/array/map/union/asIs/unknown/state/error/html-element/cssClass/function/not/snippet/predicated/meta-splice/ref-binding. MachineType kind "machine" (:414, machineRegistry-resolved).
- **diagnostic stream**: TSError(code, message, span, severity?) — severity defaults "error" → result.errors via collectErrors("TS", tsResult.errors) (api.js:1746). Precedent: checkFunctionTypedStructFields (:3497), checkAnyTypeForbidden, checkUnknownTypeNames.

## PLACEMENT SEAM DECISION

**INSIDE runTS/processFile**, wired right after `checkUnknownTypeNames` (type-system.ts:16516), NOT a new Stage 6.4x pass.

Why:
- processFile already has routeMap (param 16444) + fully-seeded typeRegistry (after imported-types seed 16483-16490) + resolveTypeExpr in scope.
- Errors flow through collectErrors("TS", ...) → result.errors → CLI exit 1 (matches E-ROUTE-003/004 = Errors, not W-/I-).
- Mirrors the S173-S176 diagnostic-authoring precedent (decl-site scans wired in the type pass). A new Stage 6.4x pass would re-thread the routeMap + rebuild a per-file typeRegistry for no benefit, and that band (6.4a-e) is for INFO/WARNING lints → allLintDiagnostics, the wrong stream for an Error.

## Baseline test counts (bun run test, full suite)
23756 pass / 220 skip / 1 todo / 2 fail. The 2 fails are NOT in unit/integration/conformance (those 3 suites are clean — verified). Pre-existing; not in target area.

## Phase 1 — build validator (NEXT)

## Phase 1 — validator (COMPLETE, committed 8f8c9c04)
- `isWireSerializable(type, typeRegistry, seen, path)` (type-system.ts:~3645): SERIALIZABLE = primitive/not/enum/predicated; UNVERIFIABLE-ALLOW = asIs/unknown/error/ref-binding/meta-splice; NON-SERIALIZABLE = function/html-element/snippet/cssClass/machine/state; RECURSE = array(elem)/map(value)/union(members)/struct(fields). Cycle-guard via `seen` set. Struct fn-field caught via `isFunctionField` sidecar. default→ALLOW (no false fire on unknown future kinds).
- `checkRouteWireSerializability(topNodes, routeMap, typeRegistry, filePath, errors, fileSpan)` (type-system.ts:~3761): walks fn-decls (recurse body/children/bodyChildren/arms), route lookup `${filePath}::${span.start}`, boundary "server" guard. PARAM → E-ROUTE-004 (incl. generators). RETURN → E-ROUTE-003 (SKIPPED for SSE generators). Un-annotated param/return → asIs/inferred → ALLOW (deferred). Fast-path: empty routeMap → no-op.
- Wired in processFile after checkUnknownTypeNames (type-system.ts:~16789).

## Phase 2 — SPEC amend (COMPLETE, committed 8435e104)
- §12.5.3: return bullet expanded (scrml-native non-serializable kinds) + S179 ENFORCED note; NEW param-direction bullet (E-ROUTE-004; applies to SSE generators via §37.3 GET query).
- §34: +E-ROUTE-004 row; E-ROUTE-003 stale §12.4 cross-ref → §12.5 corrected + ENFORCED note.
- SPEC-INDEX regenerated (bun run scripts/regen-spec-index.ts — 53 rows, 0 missing).

## Phase 4 — EMPIRICAL VERIFICATION (probes, pre-test)
Real `.scrml` compiled via compileScrml — BOTH codes fire on right spans:
- badReturn() -> snippet → E-ROUTE-003 ✓
- badParam(cb: fn()) -> string → E-ROUTE-004 ✓
- struct-with-fn-field param (h: Handlers{onClick: fn()}) → E-ROUTE-004 path "h.onClick" ✓; return → E-ROUTE-003 path "the return value.onClick" ✓
- serializable control (int/struct-of-prim/enum/array/T|not/map) → ZERO E-ROUTE ✓
- asIs param/return → ZERO E-ROUTE (escape hatch preserved) ✓
- SSE: server function* feed(cb: fn()) → E-ROUTE-004 only (return SKIPPED) ✓; counter(from: int) → ZERO ✓

## DEFERRALS (surfaced, not closed)
- SSE yield-element-type serializability check: the wire carries JSON.stringify'd yielded frames (§37.4), but the AST exposes NO resolved yield-element type without body-walk yield-expr inference. DEFERRED with a .skip test. The PARAM gate DOES cover generators.
- Un-annotated return whose INFERRED return type is non-serializable: not resolved at this decl-site pass; the markup/fn/engine inferred-return shapes are already rejected at their own decl sites (E-STRUCT-FUNCTION-FIELD etc.). DEFERRED.

## Phase 3 — tests (NEXT)

## Phase 3 — tests (COMPLETE, committed)
compiler/tests/unit/route-wire-serializability.test.js — 15 pass / 1 skip / 0 fail.
Coverage: negative return (snippet, struct-with-fn-field recursion); negative
param (fn(), snippet, struct-with-fn-field recursion w/ field path); positive
serializable (primitive/struct-of-prim/enum/array/T|not/map); asIs escape hatch;
client fn not gated; SSE generator param-fires + return-skipped; cross-stream
partition assertion. The .skip = the deferred SSE yield-type check.

## Phase 4 — EMPIRICAL VERIFICATION via CLI (MANDATED — COMPLETE)
Command: `bun compiler/bin/scrml.js compile <repro>`

REPRO `/tmp/eroute-final/repro.scrml`:
  ${ server function broken(cb: fn()) -> snippet { return cb } }
Output (exit 1, FAILED — 2 errors):
  error [E-ROUTE-004]: Server function 'broken' has a parameter 'cb' whose type is
    not JSON-serializable (function). ... §12.5.
  error [E-ROUTE-003]: Server function 'broken' returns a value whose type is not
    JSON-serializable (snippet (parameterized markup)). ... §12.5.
  → BOTH codes fire on the right fn; exit 1. ✓

CONTROL `/tmp/eroute-final/control.scrml`:
  ${ type User:struct = {id:int,name:string}
     server function ok(id: int) -> User { return { id: id, name: "x" } } }
Output: "Compiled 1 file ... 1 warning" — exit 0, ZERO E-ROUTE codes. ✓

DONE — both codes fire empirically; serializable control compiles clean.
