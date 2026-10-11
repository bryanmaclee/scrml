# progress — s462-p0-cps-server-logic-to-client

- [start] base a9aa81eff (origin/main). Brief archived.
- [repro] CONFIRMED on emit AND in happy-dom against the real server module:
  wrong password renders "WELCOME bob"; the response carries the argon2id hash;
  `_scrml_stdlib.auth` ships.

## Root causes (measured)
1. CPS tier classifier (`analyzeCPSEligibility` → `isServerTriggerStatement`)
   is not the escalation walker. It missed: aliased server-only imports (keys
   on imported `names`, not the local), any server-only reference in a control-
   flow HEAD (`condExpr`/`iterExpr`/… — incl. the `sql-ref` in
   `for (r of ?{}.all())`), and the `sqlNode` on `const x = ?{}…`.
2. A server batch could not carry cell writes: nested `@x = v` lowered to
   `_scrml_reactive_set` IN THE SERVER MODULE (ReferenceError); a second
   top-level write likewise; the §19.9.9.7 R7 read of a just-written cell read
   the CLIENT-SENT `_scrml_body[x]` (client-controlled: a forged `out` could
   steer the password check); `_scrml_cps_return` returned only when the decl
   was the LAST server statement.
3. `stdlib-auth` / `stdlib-crypto` carried client chunks contrary to the
   §12.2 Trigger-3 derivation documented in runtime-chunks.ts.
4. Legacy client wrapper: a client write to the return cell before the server
   call (`@msg = "start"`) was rewritten to `reactive_set(msg,
   _scrml_server_result)` ahead of that const (TDZ); multi-batch dropped it.

## Implemented
- A (RI): `buildCpsStatementServerProbe` — escalation walker + Trigger-3 local
  binding scan applied per statement; server-tier if it fires. Mixed bare-expr
  (write + server work) → server tier. Nested writes in server statements count
  as reactive. Server-local propagation fixpoint (a statement reading a local a
  server statement declared runs on the server — data minimisation by
  placement). `findReactiveAssignment` sees compound/update/field/array-
  mutation writes and ExprNode-field writes (match arms); `@session` /
  `@currentUser` excluded (ambient, §6.6.9).
- B (codegen): `codegen/cps-cell-writes.ts` — per-batch plan (legacy bare
  return kept byte-identical for its exact shape; otherwise "cells"). Cells
  batch: one local per written cell (`_scrml_cell_<x>`, seeded from the
  marshalled value), writes recorded in `_scrml_written`, response
  `{ __scrml_cells: { <written>: <final> } }` built as one literal. Flag
  `serverCellWrites` threaded emit-logic/emit-expr/emit-control-flow (incl.
  match ctx and the raw-text arm path). Fail-closed backstop E-CG-006 on an
  unrecorded write, an unplanned mark, or `_scrml_reactive_set` in the batch.
  Client single + multi-batch apply. RI refusal E-RI-002 (precise text) for
  writes a batch cannot carry (field write / in-place array mutation / closure
  write / `return` inside a cells batch).
- C: auth/crypto client chunks removed → a surviving client reference is
  E-STDLIB-CLIENT-CHUNK-MISSING.
- Conformance: `server-fn-writes-reactive-cell-pos` retargeted (SPEC §6.6.9:
  a function with a reactive assignment is CPS-split; the old E-RI-002 was an
  impl#1 mis-tiering artifact, already recorded at S451). New:
  `cps-login-check-stays-server` (codes-only — the bridge's server harness
  cannot load a stdlib shim; runtime proof in impl#1 tests),
  `cps-batch-field-write-refused`.

## SEPARATE P0 FOUND (not fixed here — different blast radius)
- SQL chain truncation: `?{…}.get().name` lowers to the whole row; the AST
  records `.name` as chainedCalls {method:"name"} and the lowering honours only
  calls[0]. `return ?{SELECT name, pw …}.get().name` from a plain server fn
  returns the full row incl. the hash. Measured on this worktree (SQL lowering
  untouched by this dispatch).

## Next
- commit; gates; corpus emit differential (samples/examples/conformance/
  gauntlet-r25 + ../giti ../flogence read-only).
