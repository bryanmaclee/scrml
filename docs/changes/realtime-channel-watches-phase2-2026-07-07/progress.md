# Phase 2 — realtime `<channel watches=<table>>` runtime codegen — DONE

CHANGE-ID: realtime-channel-watches-phase2-2026-07-07
Worktree base fast-forwarded to main 5b5ca405 (was da6bc91d — stale S241 base; Phase-1 52c5afec not in base).

## Phase 0 findings (verified empirically)
1. `_rowChangeSynth` stamps (type-system annotateWatchesRowChange) + reaches BOTH client
   and server codegen with node identity intact (verified end-to-end via compileScrml).
2. `_rowChangeSynth` is stamped only when the watched table is `<schema>`-declared
   (`collectSchemaTables` reads `<schema>` blocks, NOT `<T authority="server" table=T>` §52 decls).
3. BLOCKER 1 (§52 surface, OUT of Phase-2 scope): the brief/SPEC §38.13 LITERAL worked example
   (docs/changes/.../sample.scrml) uses `<orders authority="server" table=orders>` + `<orders> @orders`
   instead of `<schema>`. Empirically `<orders> @orders` alone -> E-CTX-001/E-CTX-003; a bare
   authority decl -> E-SCOPE-001 (pre-existing §52 parsing gaps, UNRELATED to watches). So the
   SPEC/brief literal sample does NOT compile clean under the current front-end. Acceptance tests
   therefore use a `<schema>`-declared compiling variant (cases 1-2 of the reduction matrix compile
   clean; the code-body arms lower correctly). => SURFACE to PA; do NOT expand into §52 parsing.
4. BLOCKER 2 (Phase-1 arm parser, adjacent scope — FIXED): scanToOpenerClose truncated a
   `:`-shorthand code-default body at the `>` of an arrow `=>`. Fixed to track {}/()/[] depth.
5. Bun.SQL v1.3.13 has NO LISTEN/NOTIFY API (only onconnect/onclose; verified against runtime +
   bun-types sql.d.ts). LISTEN bridge uses the `pg` package (pure-JS client the artifact CAN satisfy;
   NOT an out-of-band server precondition like logical-replication's wal_level/restart/role §38.13.7 rejects).

## Built (all Postgres-only, gated on `_rowChangeSynth` + PK; byte-identical empty otherwise)
- (1) Trigger install (emit-channel buildWatchesTriggerDDL + emitChannelWatchesServerBoot): CREATE OR
  REPLACE FUNCTION + DROP/CREATE TRIGGER (PG<14 compat; min PG 9.4 for json_build_object), idempotent
  each boot, via _scrml_sql.unsafe. Notifies only the PK (NOTIFY 8000-byte cap).
- (2) LISTEN bridge: dedicated pg session connection, LISTEN scrml_<C>, on notification re-SELECT by PK
  (INSERT/UPDATE) / forward key (DELETE), publish {__type:"__change",op,row|key} to the channel topic
  via globalThis._scrml_active_server.publish. Reconnect-on-drop. Multi-instance free.
- (3) Client __change dispatch (emitChannelClientJs): unconditional `if(_d.__type==="__change")` for a
  watches channel; dispatch _d.op -> the <onchange> arms; bind _d.row (Inserted/Updated) / _d.key
  (Deleted); run each §4.18 code-default arm body lowered by emitExprField (client mode). Wildcard `_` ok.
- emit-server: wire emitChannelWatchesServerBoot into the channel section, gated on a postgres db scope.

## min-PG assumption
Postgres 9.4+ (json_build_object). Uses DROP TRIGGER IF EXISTS + CREATE TRIGGER (works on PG<14; avoids
the PG14+ CREATE OR REPLACE TRIGGER requirement). Session-mode connection required (PgBouncer txn-pooling
breaks LISTEN — documented in the emitted comment).

## No-PK behavior (_rowChangeSynth.pkColumn === null)
Feed compiles (W-CHANNEL-WATCHES-NO-PK). Server capture SKIPPED (can't key deltas). Client __change
dispatch still emitted but INERT (never receives frames). emitChannelWatchesServerBoot returns [].

## Tests
- match-arm-code-body-arrow-scan.test.js (6) — scanToOpenerClose fix.
- channel-watches-phase2-runtime.test.js (16) — DDL / bridge JS / client dispatch / node --check /
  mock-SQL notification flow / non-watches regression / no-PK.

## NOT covered (needs human verification against LIVE Postgres)
True end-to-end: real external commit -> pg trigger -> NOTIFY -> LISTEN bridge -> re-SELECT -> publish ->
client __change -> cell patch. No live PG in the test env; the `pg` dependency is not installed (the
mock-SQL test substitutes a mock pg + mock _scrml_sql for the bridge LOGIC).

## S245 additions (post-accept, before landing)
- `pg` (node-postgres ^8.22.0) added to scrml's root package.json dependencies + installed — scrml
  OWNS the LISTEN client (adopter installs nothing). dev-server path: import("pg") resolves from
  scrml's node_modules (verified). Standalone `scrml build`: NO Bun.build bundling + the deploy
  package.json (railway/render/docker adapters) declares NO dependencies -> the emitted import("pg")
  would not resolve in a fresh standalone deploy. FLAGGED as a build-pipeline follow-on (per ruling,
  bundler NOT fixed here).
- §14.8.9 protect-egress hole CLOSED (Deferred #3). The watches re-SELECT is a hand-emitted `SELECT *`
  whose row is published to every subscriber. Chose option (a) — TAG-then-REDACT — mirroring the
  EXACT SSR /__serverLoad Tier-1 precedent (emit-server.ts:3130): `_scrml_protect_tag(await
  _scrml_sql.unsafe(SELECT *...), [protectedCols])` then `row: _scrml_protect_redact(_row)` on publish.
  WHY (a) over (b) omit-columns: my re-SELECT is a RAW `.unsafe` (not `?{}`-tagged), so a bare redact
  is a no-op — the hand-emitted-SELECT sinks in the floor (SSR /__serverLoad) all TAG-then-redact; this
  is the consistent floor mechanism. Gated on _protectActive; byte-identical (no _scrml_protect_ refs)
  when the table has no protected column. SERVER_PROTECT_HELPER auto-injects via the existing
  finalEmitted.includes("_scrml_protect_") scan. protect map threaded from emit-server _protectCtx.
  BOUNDARY: the DELETE frame carries only the PK VALUE (`key`), structurally required for the client to
  identify the deleted row; a `key=`-overridden PROTECTED PK would still ship (a self-contradictory
  adopter choice — documented, not v1-guarded).

## Deferred / surfaced
- Standalone `scrml build` does NOT bundle/declare `pg` in the deploy artifact (build-pipeline follow-on).
- Protected-PK-as-delta-key edge (see BOUNDARY above) — documented, not guarded.
