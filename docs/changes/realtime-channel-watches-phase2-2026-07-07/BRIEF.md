# BRIEF — Realtime `<channel watches=<table>>` Phase 2: the RUNTIME (S245)

CHANGE-ID: `realtime-channel-watches-phase2-2026-07-07`
BASELINE: `02425f54` (S243 wrap; includes Phase-1 `52c5afec`). Compile + test against current main.
DISPATCHED-BY: scrml PA (S245, pre-wrap successor to live S244).
AGENT: scrml-js-codegen-engineer · isolation:worktree · background.

You are building **Phase 2 (the runtime)** of the §38.13 `<channel watches=<table>>` realtime feed.
**Phase 1 (front-end) is LANDED** at `52c5afec`: recognition, `RowChange` synthesis, `<onchange>` parse+type,
and all six `E-/W-CHANNEL-WATCHES-*` diagnostics fire. **Do NOT re-do Phase 1.** You build ONLY the runtime
codegen: (1) Postgres trigger install, (2) the LISTEN bridge, (3) the client `__change`→`<onchange>` dispatch.

This feed carries deltas from **EXTERNAL** Postgres commits (another service / psql / a foreign ORM) that have
no scrml call site to `broadcast()` from. Postgres-only; guard everything on `driver === "postgres"`.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.

## Startup (BEFORE any other tool call)
1. `pwd` — output MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is under
   any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report (S90 CWD-routing failure). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` — worktrees do NOT inherit node_modules.
5. `bun run pretest` — populates gitignored `samples/compilation-tests/dist/` so the full suite's browser tier doesn't ECONNREFUSED.

## Path discipline (S99/S126 — enforce on EVERY edit)
- Apply ALL file edits via Bash (`perl`/`python3`/heredoc) on **worktree-absolute paths including the
  `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools. Echo the target path before each write; re-verify with `git diff` after.
- NEVER `cd` into the main repo. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths.
- First commit message includes your `pwd` output verbatim (`WIP(rt-p2): start at <pwd>`).
- Commit incrementally (crash-recovery); keep a `progress.md`.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full (~100 lines) and follow its Task-Shape Routing for a compiler-source
codegen change. Map currency: HEAD `66a3afb1` as of 2026-07-04 — files modified after that (incl. the fire sites
below) are a starting hypothesis; verify against current source. Include a "Maps consulted: […]; load-bearing
finding: …" or "Maps not load-bearing" line in your report.

---

# THE SEAM (already mapped — build ON this; verify but don't re-discover)

**Phase-1 data available to codegen (no front-end work needed):**
- `chNode._rowChangeSynth` — stamped on the watches `<channel>` markup node at `type-system.ts:21264`
  (`annotateWatchesRowChange`). Shape (`channel-watches.ts:48-60`):
  `{ name:"RowChange", table, rowStruct:{kind:"struct",fields:Record<col,scrmlType>}, pkColumn|null, pkType|null,
  variants:[Inserted(row:rowStruct), Updated(row:rowStruct), Deleted(key:pkType|"asIs")] }`.
  **Read it by EXPLICIT property access off the channel node** (it is `_`-prefixed → invisible to generic child-walks).
  The pipeline mutates the AST node in place; codegen re-collects the SAME node objects via `collectChannelNodes`. VERIFY this in Phase 0.
- `<onchange>` AST node — built at `ast-builder.js:15079-15085`: `{ kind:"onchange-decl", arms: MatchArmEntry[], span, ... }`.
  Each arm (`match-statechild-parser.ts:139-155`): `{ variantName:"Inserted"|"Updated"|"Deleted"|"_", isWildcard,
  payloadBindingsRaw:string /* RAW "(row)"/"(key)" text — you must parse it into a binding name */, bodyForm, bodyRaw, ... }`.
- `channel-watches.ts` helpers: `isWatchesChannel(node)`, `readLiteralIdentAttr(node,"watches"|"key")`,
  `collectSchemaTables(nodes)→Map<lc-table,WatchTable{name,columns[]}>`, `resolveProgramDbDriver(nodes)`,
  `derivePrimaryKey(table,keyOverride)`, `synthesizeRowChange(...)`. Reuse these; don't duplicate the schema read.

**Server-side machinery to REUSE (emit-server.ts / emit-channel.ts):**
- `collectDbScopes()` — `emit-server.ts:400-471` → `Map<scopeId, {connectionString, driver}>` (scopeId = the `_scrml_sql*` handle ident).
- Bun.SQL hoist — `emit-server.ts:3688-3765`: `import { SQL } from "bun";` + `const <ident> = new SQL(<connStr>);` per scope. Reuse `scope.connectionString`.
- **Server-boot idempotent-DDL precedent (THE trigger-install vehicle)** — `emit-server.ts:3547`:
  `await _scrml_sql.unsafe(\`CREATE TABLE IF NOT EXISTS _scrml_idempotency_keys (...)\`);` runs at startup. Mirror this for the trigger+function install.
- Publish sink — `emitBroadcastInjection` / `emit-server.ts:1257`: `globalThis._scrml_active_server.publish(topic, JSON.stringify(data))`. The LISTEN bridge publishes the `__change` frame through this.
- Per-channel server bootstrap block — `emit-server.ts:3426-3440` ("Channel WebSocket infrastructure"); topic map — `emit-server.ts:1210-1228` (`channelTopicMap`); `Bun.serve` + `globalThis._scrml_active_server = _scrml_server` — `build.js:405-413`, `dev.js:667/749`.
- Client IIFE (§38.7) — `emitChannelClientJs` `emit-channel.ts:597-680`; the `onmessage` `__type` dispatch is `:622-637` (the `__sync` branch `:627` is emitted ONLY when `sharedVars.length>0` — a watches channel has none, so you emit the `__change` branch UNCONDITIONALLY).
- Server relay — `ws.publish(ws.data.__topic, raw)` `emit-channel.ts:773`.

**Schema-differ (DDL-string generation only):** `schema-differ.js` — `parseSchemaBlock` (`:16-31`), `generateCreateTable(table,driver)` (`:366-390`), `diffSchema` (`:286-356`), driver-aware postgres branch precedent at `:479`. NOTE: `diffSchema`/`generateCreateTable` DDL is consumed only by introspect + the protect-analyzer shadow DB — **it is NOT applied to the live DB at runtime**. So DO NOT rely on it to install the trigger. Generate the trigger-DDL *string* here (optional — a helper is fine), but APPLY it at server boot (see below).

---

# WHAT TO BUILD

## ① Trigger install — server boot, idempotent, Postgres-only
Per `watches=<T>` channel C on table T with resolved PK column `pk`:
```sql
CREATE OR REPLACE FUNCTION scrml_notify_<C>() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('scrml_<C>',
    json_build_object('op', TG_OP,
      'key', CASE WHEN TG_OP = 'DELETE' THEN OLD.<pk> ELSE NEW.<pk> END)::text);
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER scrml_trg_<C> AFTER INSERT OR UPDATE OR DELETE
  ON <T> FOR EACH ROW EXECUTE FUNCTION scrml_notify_<C>();
```
- Emit these as a server-boot block that runs via the dedicated connection's `.unsafe(...)` (mirror the `_scrml_idempotency_keys`
  pattern at `emit-server.ts:3547`). Idempotent (re)install each boot IS the drift-reconcile — no separate reconcile pass needed for v1.
- `CREATE OR REPLACE TRIGGER` requires **Postgres 14+**. If you want to support older PG, use `DROP TRIGGER IF EXISTS scrml_trg_<C> ON <T>;`
  then `CREATE TRIGGER …`. Pick one, DOCUMENT the min-PG assumption in a code comment + your report.
- Sanitize `<C>` (channel name) into a safe SQL identifier; `<T>`/`<pk>` come from `_rowChangeSynth.table` / `.pkColumn`. Quote identifiers correctly.
- If two channels watch the same table you get two independent function+trigger pairs (distinct topics) — that is acceptable v1 (do NOT try to dedupe/merge).

## ② LISTEN bridge — server boot
- Open a **dedicated** `new SQL(connStr)` connection (reuse `collectDbScopes().connectionString` for the program's postgres scope), in **session mode** (NOT transaction-pooled — PgBouncer transaction-mode breaks LISTEN; document this caveat in a comment + report).
- **Phase-0 UNKNOWN (verify first):** does Bun's `SQL` handle support `.listen(channel, handler)` / a notification event? If yes, use it. If NOT, determine the correct mechanism (a raw `LISTEN scrml_<C>` on the dedicated connection + a notification callback, or the underlying pg connection). Report exactly what Bun.SQL supports and what you used. Do not fabricate an API — verify against the installed Bun version.
- On a notification for `scrml_<C>`: parse `{op, key}`. For `INSERT`/`UPDATE` → re-SELECT the full row: `SELECT * FROM <T> WHERE <pk> = $1` (parameterized) → publish `{__type:"__change", op:"Inserted"|"Updated", row:<row>}`. For `DELETE` → NO re-SELECT (row gone) → publish `{__type:"__change", op:"Deleted", key:<key>}`.
- Map `TG_OP` (`INSERT`/`UPDATE`/`DELETE`) → RowChange variant (`Inserted`/`Updated`/`Deleted`).
- Publish via `globalThis._scrml_active_server.publish("<topic>", JSON.stringify(frame))` (topic from the channel's `topic=`/`name=`, per `channelTopicMap`).
- Reconnect-on-drop (a fresh subscribe on reconnect; the client re-fetch covers the ephemeral-loss window — §38.13.6 at-most-once). Multi-instance is free (each instance holds its own LISTEN) — do NOT add any cross-instance backbone.
- Start the LISTEN loop after `globalThis._scrml_active_server` is registered, or as a per-file module-init side-effect. Guard the WHOLE block on `driver === "postgres"` AND the program actually having ≥1 watches channel (zero cost for non-realtime / non-PG apps — byte-identical emit).

## ③ Client `__change` dispatch — emit-channel.ts client IIFE
- In `emitChannelClientJs` `onmessage` (`emit-channel.ts:622-637`), for a watches channel emit an **unconditional** branch:
  `if (_d.__type === "__change") { … }`.
- Dispatch on `_d.op` to the matching `<onchange>` arm. Read the channel node's `onchange-decl.arms`; for each arm: parse `payloadBindingsRaw`
  (`(row)` / `(key)`) into a binding name; bind `_d.row` (Inserted/Updated) or `_d.key` (Deleted) to it; run the arm's `bodyRaw` compiled as a
  **code-default body** (§4.18 — the arm bodies patch program-scope `@`-cells; §38.13.3). **Reuse the existing match block-form arm-body codegen**
  (the arms are `MatchArmEntry`, identical to §18.0.1 match arms) — do NOT hand-roll a new arm compiler. A wildcard `_` arm is legal.
- Exhaustiveness is already validated (Phase 1) — you don't re-check it.

## Pinned frame contract (server produces ①②, client consumes ③ — ONE shape, no drift)
`{ __type: "__change", op: "Inserted" | "Updated" | "Deleted", row?: <full row object>, key?: <pk value> }`

---

# MANDATORY PHASES
- **Phase 0 — VERIFY (before building):** (a) confirm `chNode._rowChangeSynth` is readable at codegen time (compile the acceptance sample, log it). (b) Determine Bun.SQL's LISTEN capability empirically. (c) Confirm the `onchange-decl.arms` shape + locate the match-arm-body codegen you'll reuse. (d) Confirm the `emit-server.ts:3547` boot-DDL pattern + the `_scrml_active_server.publish` sink. Report findings before proceeding.
- **Phase 1 — build** ①②③ (Bash-edits, worktree-absolute paths). Guard all on `driver === "postgres"` + presence of ≥1 watches channel.
- **Phase 2 — codegen-shape tests + node --check:** the test env has NO live Postgres. Add unit tests asserting the EMITTED artifacts: (i) the trigger+function DDL string for the acceptance sample; (ii) the LISTEN-bridge server JS (connection open, LISTEN, re-SELECT, publish); (iii) the client `__change` branch dispatching the three arms + binding row/key. `node --check` (or `Bun.Transpiler`) the emitted server + client JS to prove they parse. Add a **mock-SQL test** that simulates a notification `{op:"Inserted",key:1}` and asserts the re-SELECT + `publish({__type:"__change",...})` fire and the client branch runs the matching arm.
- **Phase 3 — full suite:** `bun run test` → 0 fail (document any pre-existing browser/env-floor fails; do NOT fix unrelated).

# ACCEPTANCE (all must hold)
- The §38.13 acceptance sample (below) compiles clean and emits: the trigger+function DDL (server boot), the LISTEN bridge (dedicated conn, re-SELECT-by-PK, publish `__change`), and the client `__change`→3-arm dispatch. Postgres-only paths present; a SQLite/no-db build emits NONE of it (byte-identical to a non-watches build — verify).
- Non-watches channels (§38.4 synced-cell + §38.6 broadcast) are UNCHANGED — byte-identical emit. (This is the load-bearing regression check: your client-IIFE + server-bootstrap edits must not perturb ordinary channels.)
- `_rowChangeSynth.pkColumn === null` (W-CHANNEL-WATCHES-NO-PK case): the feed still compiles; document what the runtime does with no PK (it can't key deltas — emit a no-op / skip the bridge for that channel, your call, documented).
- Full suite 0-fail (excl. documented env-floor).

**Acceptance sample** (write it into your change dir as `sample.scrml`):
```scrml
<program db="postgres://localhost/app">
  <orders authority="server" table=orders>
      id: int
      status: string
      total: number
  </>
  <orders> @orders
  <channel name="orders-feed" watches=orders>
      <onchange>
          <Inserted(row) : { @orders = [...@orders, row] }>
          <Updated(row) : { @orders = @orders.map(r => r.id == row.id ? row : r) }>
          <Deleted(key) : { @orders = @orders.filter(r => r.id != key) }>
      </onchange>
  </channel>
</program>
```

# DO NOT
- Do NOT touch: `expression-parser.ts`, `route-inference.ts`, `literal-scan.ts`, `codegen/emit-client.ts`,
  `codegen/emit-each.ts`, `protect-analyzer.ts` (a sibling session owns these — footprint collision).
- Do NOT edit `compiler/SPEC.md` (the §38.13 Nominal-banner flip is a PA landing-time step, not yours).
- Do NOT add new error codes or §34 rows (Phase 1 landed all six; Phase 2 is pure codegen).
- Do NOT build the `durable` (logical-replication) tier or `apply=`/dynamic-topic sugar (v1.next deferrals).
- Do NOT add a cross-instance pub/sub backbone (multi-instance is free on this path).

# REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` · deferred-items · the **Phase-0 findings** (esp. Bun.SQL LISTEN
capability — verbatim what you found) · the **min-PG assumption** you made for the trigger · the mock-SQL test
evidence · a note on what the no-PK channel does at runtime · the Maps-consulted line. Flag explicitly that
**true end-to-end (real commit → NOTIFY → client patch) is NOT covered** by the test env (no live PG) and needs
human verification against a live Postgres.
