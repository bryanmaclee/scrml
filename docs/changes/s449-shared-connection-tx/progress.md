# s449-shared-connection-tx — progress (append-only)

## 1. Reproduction on main a1aac1433 (over HTTP, `scrml build` + `bun dist/_server.js`)

Repro app: implicit-envelope `!` fns `boom` (UPDATE, UPDATE, PK-violating INSERT),
`implicitFail` (UPDATE, UPDATE, `fail` when n>0), `slowTx` (UPDATE, UPDATE, a 300 ms
yield, PK-violating INSERT); plain `plainWrite` (INSERT INTO log) and `readBalances`.
SQLite file db, WAL. Requests carry `scrml_csrf=tok` + `X-CSRF-Token: tok`.

- Naive 1:1 `Promise.all` (no padding): C does NOT reproduce (0/20) — the bun:sqlite
  Bun.SQL adapter resolves each query in microtasks, so a handler with no macrotask
  yield inside its envelope runs BEGIN..COMMIT atomically w.r.t. other requests.
- The yield exists in real code: the implicit envelope's BEGIN is emitted BEFORE
  `await _scrml_req.json()`. With a 2 MB request body (K=10 concurrent):
  - SYMPTOM 1: plainWrite acknowledged 200 = 10/10; log rows persisted = 1 → 9 LOST.
  - SYMPTOM 2: 7/10 concurrent implicit-tx calls → 500; server log
    `SQLiteError: cannot start a transaction within a transaction` (13x).
  - D: `implicitFail(1)` → 200 `{__scrml_error, variant: "Rejected"}`, balances 500/500
    persisted (fail COMMITS).
- SYMPTOM 3 (dirty read) needs a yield AFTER a write inside the envelope. No scrml
  source shape produced one: `sleep(300)` (scrml:time) and an async `.js` import call
  in a server fn are both emitted UN-awaited (`sleep(300);`) — a separate finding.
  With `dist/app.server.js` hand-patched to `await pause(300)`: a concurrent
  readBalances 100 ms in returned `[{id:1,balance:999},{id:2,balance:999}]` — rows that
  were never committed (final state 10/0).

Repro scripts: worktree `.tmp/repro/{app.scrml,seed.ts,client.ts,client2.ts,client3.ts}`
(scratch; contents recorded in the final report).

## 2. Fix built (C + D + PG opt-in)

- `compiler/src/codegen/sql-tx-guard.ts` (new): emitted runtime — `_scrml_db_guard` (per-handle
  FIFO async mutex; transaction control recognized by statement text; owner = request scope
  via a process-wide AsyncLocalStorage; pooled drivers reserve a connection per transaction),
  `_scrml_db_request_scope` (wraps every route handler + WS callback), `_scrml_db_scope_end`
  (request-end backstop: rolls back a transaction left open).
- emit-server.ts: handle declarations wrapped (one line, `_scrml_db_guard(<expr>, driver, concurrent)`);
  request-scope loop appended at module end; D — the envelope ROLLs BACK when `_scrml_result`
  is an error envelope; envelope BEGIN is `BEGIN` on postgres/mysql (PG rejects `BEGIN DEFERRED`).
- `transactions="concurrent"` on `<program>` (attribute-registry; E-SQL-010 on SQLite).
- protect-flow.ts: the guard runtime is modelled (identity) and never walked — walking it took
  examples/23's protect flow from 1.4 s to >400 s.
- HTTP after (same scripts): SYMPTOM 1 0/10 lost; SYMPTOM 2 0/10 failed; SYMPTOM 3 clean read;
  D implicitFail(1) → error returned, balances 10/0.
- Live PG (local cluster): envelope commits, `fail` rolls back, serialized vs concurrent verified.

## 3. Verification

- Pure-source HTTP repro (no hand patch): `.tmp/repro2` — slowTx/slowOk await a 300 ms local API via
  `scrml:http get()` INSIDE their envelope. base a1aac1433: S1 write LOST, S2 second envelope 500
  ("within a transaction" in server log), S3 read returned 999/999 never committed. head: write kept,
  both 200 (210/200), clean read 10/0.
- Body read hoisted BEFORE the envelope's BEGIN (a stalled upload must not hold the DB lock).
- Gate (pre-commit hook on b40cc391f): 29894 pass / 0 fail / 58 skip.
- compiler/tests/commands: 315 pass / 0 fail / 3 skip. conformance: 1246/1280 + 34 xfail (2 new cases).
- Live PG (sql-shared-connection-tx-pg): 6/6.
- examples/23 over HTTP (head and base identical): login 200 + last_login_at write persisted; reads 200;
  changeHosServer 500 on BOTH (pre-existing app bug, filed).
- Corpus sweep (examples/ samples/ conformance/cases/, 2245 files, base vs head): 410 server modules;
  152 byte-identical (no SQL handle); 258 differ ONLY in the S449 emission (guard runtime block,
  guarded declaration, request-scope trailer; 3 also move the node:fs import line below the runtime);
  0 residual. ZERO implicit envelopes in the corpus on either side (the D / body-hoist / PG-BEGIN
  changes reach no corpus file — see g-implicit-envelope-requires-explicit-server-modifier).

## 4. S239 review fix round (review of 9a018219b: LAND-WITH-NITS)

- Merged origin/main (b1e916642): known-gaps hunks resolved as a union (1605 gap ids =
  ours ∪ theirs, 0 dropped); SPEC-INDEX / FACTS / gap-counts regenerated.
- F1 SSE stream backstop in the stream `finally`; F3 owned BEGIN/COMMIT/ROLLBACK →
  SAVEPOINT/RELEASE/ROLLBACK TO; F2 comment-proof classifier + SQLite SAVEPOINT-opens + AND CHAIN;
  F5 awaited WS handlers; E-SQL-010 span. 97f50b0d3 — gate 29931 pass / 0 fail.
- Filed: g-tx-lock-held-across-slow-outbound-call (F4), g-tx-scope-residual-sharing (F6),
  g-channel-onserver-handler-with-server-call-not-async (found while testing F5: an onserver
  handler that touches the DB does not compile today). SPEC §19.10.6 "Not covered" expanded.
