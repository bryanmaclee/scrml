# progress — s457-sql-check-at-lowering (append-only)

## 2026-10-07 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0c05f11b2c8297b9`, base `b6a6b64f0` = origin/main.
- bun install + pretest OK (samples/compilation-tests/dist populated).

## 2026-10-07 — repros (before any change, `.tmp/repro.mjs`)
All compile with 0 errors and emit a driver call carrying `DROP TABLE` / `ATTACH`:
- F2 `@new / ?{…DROP…}.run()` in a template slot (cell declared) → `_scrml_body["new"] / (await _scrml_sql\`DROP TABLE notes\`)`
- every keyword `@in @delete @typeof @void @return @await @yield @else @finally @throw @instanceof @do` → same
- F2 bare `.unsafe` → `_scrml_sql.unsafe("ATTACH DATABASE 'x.db' AS y")`
- F3 `{ y: 1 } / ?{…}` → `{y: 1} / (await _scrml_sql\`DROP TABLE notes\`)`
- F4 `<#x>` in the same template → `(await _scrml_sql\`DROP TABLE notes\`)` (only when the function is
  server-escalated by another `?{}`; client-side it stays an inert `__scrml_sql_ref__("…")` string)
- control: a plain statement-position `?{DROP TABLE}` IS refused (E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED) at
  the TENANT-SCHEMA stage — but its emitted driver call still carries the DROP (no lowering-point check).

## 2026-10-07 — ENUMERATION: every point where an author `?{…}` becomes a driver call
Author SQL (program body):
1. `codegen/emit-logic.ts` `case "sql"` — the structured lowering. Every statement-position `?{}`, every
   expression-position `sql-ref` (`emitSqlQueryShape` → `_sqlNodeFromShape`), the server-fn sqlNode decls
   (emit-server.ts :4948 / :5270), Pattern-C `/__serverLoad` (:6110 / :6344), and a server-mode template slot
   that `emitServerTemplateLit` parses structurally (F3, F4). Driver calls, all via `emitSqlDriverCall`:
   Branch A tagged (params), Branch B `unsafe(sql, [call.args])` (legacy `?`), Branch C tagged (no params),
   bare tagged (params), bare `unsafe(sql)` (no params). (`.prepare()` sends nothing — throws.)
2. `codegen/rewrite.ts` `rewriteSqlRefs` (client + server rewrite passes) → `lowerSqlMethodSite` (tagged
   template) and `lowerSqlBareSite` (`unsafe(sql[, [params]])`). The text path: F2 + keywords.
3. `codegen/emit-control-flow.ts` `emitHoistedForStmt` — the §8.10 Tier-2 hoist: `unsafe(inSqlTemplate…)`
   built from the author body `hoist.sqlTemplate` (batch-planner `site.body`).
Compiler-owned SQL (not program-body; constants or compiler-quoted identifiers — not governed by §14.8.10
item (1), listed for completeness): emit-logic transaction BEGIN/COMMIT/ROLLBACK; emit-server envelope
BEGIN/COMMIT/ROLLBACK + idempotency-table DDL; db-authoritative `SET LOCAL ROLE`; sql-tx-guard SAVEPOINT;
emit-channel watches= trigger DDL + `SELECT * FROM "t" WHERE "pk" = $1`; commands/db-migrate (CLI).

## Plan
The lowering-point authority: `sql-one-statement-guard.ts` reads the EMITTED driver call (acorn) and now
also holds the SQL text that call sends to the §14.8.10 item (1) allow-list (`programStatementVerdicts`,
with the compilation's tenant set + dialect, in a compilation with a database). A refused site emits the
throwing expression (nothing sent) and records E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED / E-TENANT-UNDECLARED
(deduped against the TENANT-SCHEMA stage's report of the same body). Hoist: declines (per-site lowering
then refuses) when the author body is not admitted.

## 2026-10-07 — landed on branch (62b571110, 95e0d5902)
- `codegen/sql-one-statement-guard.ts`: `judgeDriverCallDetail` (acorn-read emitted call → the SQL it SENDS:
  tagged quasis joined at `${_}`; `.unsafe` string, read back into the compiler's segments when its `?N` sit
  exactly where the compiler put them) → one-statement rule, then `programStatementRefusal` (schema-differ
  `programStatementVerdicts`, the compilation's tenant set + dialect, governed iff the compilation has a
  database; no policy installed = fail closed). Refusal → throwing expression in place of the driver call +
  a CG diagnostic (`recordProgramStatementRefusal`, own sink, drained by runCG) pointing at the source `?{`
  (statement span narrowed via the registered source). `sqlBodyKey` (code+file+author body) dedupes it
  against the TENANT-SCHEMA stage's report in api.js `collectErrors` (stage report kept — exact span).
- Wired: emit-logic `case "sql"` `emitSqlDriverCall` (all 5 driver branches); rewrite.ts `lowerSqlMethodSite`
  + `lowerSqlBareSite` (the bare `.unsafe` path is now judged as emitted — it had only the one-statement
  string check); emit-control-flow hoist declines a refused author body; runCG installs the policy
  (api.js passes the stage's `compilationHasDb`); emitLogicNode tracks the statement span (try/finally).
- Message builder shared by stage + lowering (`programStatementMessage`), tenant-undeclared.ts uses it.
- sql-write-ops §16 (legacy bare-`?` + call.args) now states its db-less precondition (an author `?` is
  outside the closed lexical subset — refused in a DB compilation by stage AND lowering), + a refusal test.
- Perf: `CodeSoFar.tail` after `)` → units before the matching `(` + "()" (16k nesting 7.7 s → 21 ms;
  200k random inputs base vs head 0 differences).
- Executed on Bun.SQL sqlite (.tmp/exec.mjs): base emissions F2/F3/F4 DROP the table, F2bare ATTACHes;
  head: all 16 shapes refused at compile (exit 1), table PRESENT, 1 attached db, site throws.
- Tests: unit+integration+conformance 31959 pass / 0 fail; `bun conformance/run.ts` 1342 pass + 50 xfail / 1392.
- Observed, out of scope: `scrml compile` with an Error still writes artifacts to -o (pre-existing; artifact
  carries the throwing expression, no DROP). F4 client-side: a `?{}` in a template with `<#name>` leaves
  the function client-side and emits `__scrml_sql_ref__("?{…SQL…}")` (undefined fn; SQL text in client.js).

## 2026-10-07 — corpus differential (scripts/corpus-emit-differential.ts, base b6a6b64f0 vs head 95e0d5902)
- capture both sides: enumerated 2421 · compiled 1448 · emitted 11877 · syntax-failing 76 (identical).
- diff: compile-failure delta 0 newly failing / 0 newly passing; diagnostic CODE changes 0; syntax delta 0;
  artifact set delta 0; bare server-fn sites delta 0.
- 1463 "text-only" diagnostic changes + 271 of 277 artifact content diffs = the base checkout's path
  (`.tmp/base-co`) in `_scrml_project_root` / CLI output paths: after normalising it, stderr is identical
  for all 1463 (0 residual) and 271 artifacts are byte-identical.
- 6 residual artifacts: 2 host-import relative paths (`../../../base-co/…` — layout only); 4 already-failing
  neg conformance cases (sql/bare-identifier-body-e-sql-003-neg, tenant/program-statement-not-admitted-neg,
  tenant/undeclared-body-create-neg, tenant/undeclared-body-create-temp-neg): the refused `?{}` is now a
  throwing expression and the now-unused SQL handle block is no longer emitted. Their diagnostics are
  unchanged (stage report kept, lowering report deduped).
- DIRECTION: newly-rejecting by construction (the three bypass shapes); MEASURED corpus: 0 newly refused.
- 15246d106 afterwards: runtime throw text for E-TENANT-UNDECLARED reworded (affects only refused sites).

## 2026-10-07 — review nit (a) (4d8c980f0, 494333a41)
- Multi-statement body at a lowering: compile diagnostic E-SQL-MULTIPLE-STATEMENTS recorded at every lowering site (emit-logic case "sql" early check + judged calls; rewrite.ts both lower sites; judgeSentSql carries the refusal), sqlBodyKey dedupe with the stage (shared multipleStatementsMessage); hoist declines a multi-statement body. db-less: not governed at compile, site still throws.
- Tests: F2/F3/F4 x `SELECT 1; DROP TABLE notes` -> E-SQL-MULTIPLE-STATEMENTS at the `?{`, table survives on sqlite, CLI exit 1; bare .unsafe; stage-counted body once. Full gate 0 fail.
- SPEC §8.1.2 bullet "Checked where it is lowered (S457)" added; SPEC-INDEX left for the PA.
