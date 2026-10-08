# config.map.md
# project: scrml
# updated: 2026-10-07T20:42:02-06:00  commit: 125486345
# ⛑ **S457 STAMP — `ba2712973` -> `125486345`. 10 COMMITS (#1338 S456 wrap, #1339 the S456 maps refresh, #1340 FACTS
# verbs + `fix --help` + CI bootstrap-conformance gate step, #1341 runtime URL-attribute scheme guard, #1342 one SQL `${}`
# slot reader by parsing, #1343 `is some`/`is not` in function-expression bodies, #1344 program-body SQL checks at every
# lowering, #1346 `__scrml_` reserved + per-compilation placeholder nonce + emit placeholder gate, #1347 `string(url)` judge,
# #1348 no artifacts from a compile that reports an error), incremental refresh in an isolated worktree @ `125486345` =
# `origin/main`.** MAP-STAMP RULE: `bun scripts/state.ts --check` at pass start: `maps: 10 commits behind HEAD (watermark
# ba2712973, HEAD 125486345)` — matches `git log --oneline ba2712973..HEAD` (10).
# ⛑ FIGURES AT `125486345`: `facts.ts --check` PASS · FACTS `compiler/src` **304,067 lines / 256 files** (+6 new modules) ·
# test files **1,645** by `git ls-tree -r --name-only HEAD compiler/tests | grep -c '\.test\.'` (+10; the same command gives
# 1,635 at `ba2712973` — the S456 "1,620" used a different count) · `compiler/SPEC.md` **47,046** lines (+53) · conformance
# **1396** `case.scrml` (+5) · `bootstrap-conformance.ts --check`: **current** (first time in 8 windows) · FACTS CLI verbs
# **12** (corrected by #1340) · NO new diagnostic code this window · known-gaps heading/marker drift **65** (was 61).
# Conformance suite NOT re-run this pass.
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE PRIOR HEADER (stamp `ba2712973`), CARRIED. ━━━━━━━
# ⛑ **S455 STAMP — `f38697900` -> `9c556dc74`. 20 COMMITS (#1306 S454 wrap, #1307 the S454 maps refresh, #1308 `scrml fix`
# client-server-call, #1309/#1310/#1314/#1318/#1320/#1323 docs+gaps+SPEC, #1311 state.ts `--abbrev=9`, #1312 foreign
# sealed scope, #1313 E-TENANT-SCHEMA-HAZARD, #1315 `scrml fix` sql-failable, #1316 one tenant set per compilation, #1317
# tenant `<schema>` statement-kind allow-list, #1319 tenant `<schema>` bodies in the SQL subset, #1321 build-report PG
# REVOKE, #1322 handled-`?{}` guard consumers, #1324 test timeout, #1325 §8.10 hoist), incremental refresh in an isolated
# worktree @ `9c556dc74` = `origin/main`.** MAP-STAMP RULE: `git log --oneline f38697900..HEAD` -> 20; `bun scripts/state.ts
# --check` at pass start: `maps: 20 commits behind HEAD (watermark f38697900, HEAD 9c556dc74)` — matches exactly.
# ⛑ FIGURES RE-EXECUTED AT `9c556dc74`: `facts.ts --check` PASS · FACTS `compiler/src` **298,756 lines / 241 files** (+5 new
# modules this window) · test files **1,609** (+12) · `compiler/SPEC.md` **46,681** lines (+546; `regen-spec-index.ts
# --check` OK 72/72) · conformance **1346** (+28); `bun conformance/run.ts` -> **1296 pass + 50 xfail** · known-gaps open
# **HIGH 241 · MED 513 · LOW 277** · Nominal 8; heading/marker drift 61 · bootstrap counter (live) 1346 attempted: PASS
# **121** · FAIL **56** · NOT-TWINNED **515** · UNSUPPORTED **654** · CRASH 0; graded 177, 121 hold (68.4%) — ⚠ committed
# `docs/bootstrap-conformance.md` STALE a 6th window (1315 cases; `--check` STALE). slice-m4 and `types-gate.ts` NOT
# re-executed this pass. ⚠ FACTS "CLI verbs 14" is WRONG (12 dispatched) — non-compliance N-S455-1.
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S454 HEADER (stamp `f38697900`), CARRIED — STILL ACCURATE FOR ITS WINDOW. ━━━━━━━
# ⛑ **S454 STAMP — `7ce905ac2` -> `f38697900`. 12 COMMITS (#1294 S452 wrap incl. the S452-WRAP maps refresh, #1295
# bootstrap codec payload enums, #1296 call-ref handler colouring, #1297 `scripts/merge-on-green.sh`, #1298 SPEC
# U1b / tenant / arm-pipe, #1300 S453 wrap addendum, #1299 protect= fail-closed, #1301 reserved `_scrml_` prefix,
# #1302 Types gate BLOCKING, #1303 bootstrap U1b, #1304 scheduled @generated regen, #1305 handled `?{}` in
# expressions), incremental refresh in an isolated worktree @ `f38697900` = `origin/main`.** MAP-STAMP RULE:
# `git log --oneline 7ce905ac2..HEAD` -> 12; `bun scripts/state.ts --check` at pass start: `maps: 12 commits behind
# HEAD (watermark 7ce905ac2, HEAD f38697900)` — matches exactly.
# Source-relevant in THIS window, grep-verified at `f38697900`:
#   impl#1 (`compiler/src`, **236 files** = +2 `.ts` + 8 `.d.ts`):
#   #1296 — §5.2.2 / §19.6.8 B7: the call-ref `onclick=fn()` listener is built with the AUTHOR name (not
#     `fnNameMap.get`) so `colorHandlerAsync` sees an async callee; the formFor submit wrapper and the bare-ref
#     `onclick=handler` (when async) now go through colouring too. `colorHandlerAsync` (`emit-event-wiring.ts:484`,
#     module-local) is now called TWICE (:1229 bare-ref, :1386 main). `emit-variant-guard.ts` `emitArmWireFunction`
#     :436 — the in-arm non-delegable registration — is the **16th listener-registration site**, now coloured via
#     `colorActiveHandler` at :1299. Async `<errorBoundary>` render: re-throw -> `return`, both render calls gain
#     `.catch(-> _scrml_error_boundary_log)` (:2492-:2497).
#   #1299 — §14.8.9 (SECURITY): `codegen/protect-egress.ts` (1224 -> **1597** lines) fails CLOSED:
#     `resolveProtectedOutputColumns` :641 returns `null` only on a POSITIVE proof; NEW `lexProtectSql` :287,
#     `classifyProtectStatement` :417 (exported), `analyzeProtectStatement` :428, `writeTargetFromOriginal` :619,
#     `nestedSelectReadsUnknownSource` :844, `holePayloadMayDisagree` :255, `ProtectStatementKind` :220. RETIRED:
#     `isRowProducingQuery` (grep 0).
#   #1301 — §47.1.1 (SECURITY): NEW `validators/reserved-prefix.ts` (545 lines) — `E-NAME-COLLIDES-RESERVED-PREFIX`,
#     `runReservedPrefixCheck` :532, stage `RESERVED-PREFIX` at `api.js:1968` (post-TAB, after `SCOPE-REDECLARE`);
#     stdlib exempt by REAL path via NEW `module-resolver.js` `isStdlibSourceFile`. Added to `pipeline-seam.ts`'s
#     buildAST re-entry list (now TEN files). `expression-parser.ts` now exports `tokenizeTemplateInterpolations`.
#   #1302 — `scripts/types-gate.ts --check` is a BLOCKING step in CI `gate` (placed right after Install deps).
#     8 NEW `.d.ts`: `ast-builder`, `ast-if-chain`, `attribute-registry`, `codegen/emit-lift`, `host-import`,
#     `markup-return-scan`, `runtime-template`, `schema-differ`.
#   #1305 — §19.8.3 / §19.8.4: a handled `?{}` lowers in every expression position. `expression-parser.ts`
#     `extractHandledOperands` :464 / `restoreHandledOperands` :534 (`SQL_REF_MARKER = "__scrml_sql_ref__"` :367,
#     `GUARD_MARKER = "__scrml_guard__"` :369); `SqlRefExpr.raw` (types/ast.ts:2049); NEW `codegen/sql-attempt.ts` (141
#     lines; `_scrml_sql_attempt`); `emit-logic.ts` `emitSqlQueryShape` :1183 / `emitNestedGuardExpr` :1230;
#     `ast-builder.js` `parseGuardArmsFromRaw` :18325; `type-system.ts` E-TYPE-080 on every handler (:12676, :15181);
#     `route-inference.ts:1797` walks a decl's `matchExpr` / `ifExpr` / `forExpr`.
#   bootstrap (`compiler/self-host-v2/`, impl#2 — NOT impl#1): #1295 codec payload enums (`codec.scrml`, runtime
#     `encEnum` / `decEnum` / `decodeError`); #1303 U1b — `ServerCallError`, `Expr.ServerCall` / `Failable.FSettled`
#     / `Stmt.Join` / `Stmt.Jump` (core.scrml), `check.scrml` C-S1..C-S4 + C-S7 + C-S8, runtime `call(route, args, task)` :2000
#     (never rejects), `SERVER_CALL_DEADLINE_MS = 30000` :1988, `E-ERROR-016` (bootstrap-only, no §34 row).
#   tooling: #1297 NEW `scripts/merge-on-green.sh` (257 lines) + `.gitattributes` LF pin for `scripts/*.sh` + hooks.
#   SPEC-only: #1298 (§19.9.10 U1b closed; §14.8.10 subset text + `E-TENANT-SQL-SUBSET` §34 row; arm-pipe currency).
# ⛑ FIGURES RE-EXECUTED AT `f38697900`: `facts.ts --check` PASS · `compiler/src` **292,596 lines / 236 files** ·
# test files **1,597** (+6) · `compiler/SPEC.md` **46,135** lines (+352; `regen-spec-index.ts --check` OK 72/72) ·
# conformance **1318** (+6); `bun conformance/run.ts` -> **1268 pass + 50 xfail** · known-gaps open **HIGH 242** ·
# **MED 506** · **LOW 268** · Nominal 8; drift 61 · slice-m4 **1229 pass / 1 todo / 0 fail** across 38 files ·
# `self-host-v2` 21 `.scrml` modules, **36,127** lines · bootstrap counter (live) 1318 attempted: PASS **121** ·
# FAIL **58** · NOT-TWINNED **514** · UNSUPPORTED **625** · CRASH 0; graded 179, 121 hold (67.6%) — ⚠ committed
# `docs/bootstrap-conformance.md` STALE a 5th window (1315 cases; `--check` STALE). `types-gate.ts --check` NOT
# executed this pass (no `tsc` in the available node_modules).
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S452-WRAP HEADER (stamp `7ce905ac2`), CARRIED — STILL ACCURATE FOR ITS WINDOW. ━━━━━━━
# ⛑ **S452-WRAP STAMP — `fd2f757d0` -> `7ce905ac2`. 5 COMMITS (#1281 SPEC security forks, #1290 bootstrap effect
# summary, #1292 the S453 maps refresh itself, #1285 W-ARM-PIPE-LEGACY + `scrml fix arm-pipe`, #1293 tenant SQL
# subset), incremental refresh. Checkout `wrap/s452` @ `7ce905ac2`; untracked `spotLightReply.txt` NOT mapped.**
# MAP-STAMP RULE: `git log --oneline fd2f757d0..HEAD` -> 5; `bun scripts/state.ts --check`: `maps: 5 commits behind
# HEAD (watermark fd2f757d0, HEAD 7ce905ac2)` — matches exactly.
# Source-relevant in THIS window, grep-verified at `7ce905ac2`:
#   impl#1 (`compiler/src`, 226 files):
#   #1293 — §14.8.10 (SECURITY) r3+r4: a tenant query is legal (without `.acrossTenants()`) only inside an
#     ALLOW-LISTED SQL SUBSET. NEW `codegen/tenant-sql-subset.ts` (751 lines): `lexTenantSubset(raw)` :117 (CLOSED
#     token set — unquoted idents, numbers, plain `''` literals, provable `${}` params, a fixed punct set; `"`, `` ` ``,
#     `[`, `$`, `\`, `;`, `:`, `?`, `@`, `#`, `--`, `/*`, `E''`, `X''` are OUTSIDE), `analyzeTenantSql` :353
#     (one SELECT / INSERT / UPDATE / DELETE; no WITH / subquery / set ops / OVER / REPLACE / ON CONFLICT /
#     RETURNING / SELECT INTO), `TENANT_ROW_FUNCTIONS` :229, `TENANT_GROUP_AGGREGATES` :242, `tenantTableMentioned`
#     :312, `injectInsertTenant` :725, `injectWriteTenantFilter` :743 (UPDATE/DELETE: WHERE parenthesized whole and
#     ANDed with `tenant_id = _scrml_tenant_write_key()`; module-local `withOrAbort` :716 adds statement-level
#     `OR ABORT` on SQLite), `TenantCode` :260 = `E-TENANT-AGG` | `E-TENANT-WRITE` | **`E-TENANT-SQL-SUBSET`** (NEW
#     code). `codegen/tenant-egress.ts` rewritten (920 -> **896** lines): delegates to the subset
#     (`analyzeTenantQuery` :296, `resolveTenantScoping` :345, `tenantFloorViolation` :590 -> `TenantViolationCode`
#     :579), NEW `schemaWriteHazards(schemaText, tenantTables)` :105 (a `<schema>` trigger / rule / CASCADE-SET NULL-
#     SET DEFAULT FK referencing a tenant table -> `E-TENANT-WRITE`), `TenantContext.driverFor` :90, runtime
#     `_scrml_tenant_write_key` (in `SERVER_TENANT_HELPER` :657). Callers `emit-server.ts:1957` / `emit-tool.ts:346`
#     (`buildTenantContext`); `rewrite.ts:274/:291` carry the 3-code union. **PARTIAL — r4 residuals filed OPEN**
#     (views over tenant tables, raw driver handle, predicate oracles, schema write hazards beyond the ON table).
#   #1285 — §19.4.5 / §51.0.S.2.3 / §63: impl#1 now EMITS `W-ARM-PIPE-LEGACY` (Info, one per `|`-led arm):
#     `!{}` arms — `ast-builder.js` `parseErrorTokens` records `arm.legacyPipe` (:17502; offsets RELATIVE to the
#     arm's `span.start`), fired by `type-system.ts` `checkArmPipeLegacy` :18639 with `armPipeLegacyMessage` :18695
#     (exported); message arms — `engine-statechild-parser.ts` `legacyPipe {pattern, patternStart}` :2411 +
#     `bodyRawOffset`, fired in `symbol-table.ts` :7654 (`MessageArmEntry.legacyPipe` :576). `E-ARM-PIPE-LEGACY` stays
#     reserved. NEW `commands/fix-arm-pipe.js` (564 lines): `fixArmPipe(source, opts)` :466, `ARM_PIPE_RULE =
#     "arm-pipe"` :58; verify-by-compile per file (`verifyByCompile` :402, all-or-nothing, idempotent). Chained in
#     `fix-s66.js` (now 1700 lines) `fixS66` :1276 right after pre-migrate; `IMPL1_SAFE_RULES` :96 = pre-migrate /
#     **arm-pipe** / program-wrap / program-move / unwrap-logic; `S66_RULES` :100 includes `arm-pipe`. `fix.js` (255
#     lines) help updated. `scripts/bootstrap-conformance.ts` `TWIN_RULES` :110 = `S66_RULES` minus `arm-pipe`.
#     Corpus migrated: 72 files / 170 arms (16 message arms) across examples/ samples/ conformance/ stdlib/
#     docs/readme-snippets/ docs/tutorial-snippets/ benchmarks/, + README / NERDME / tutorial mirrors.
#   bootstrap (`compiler/self-host-v2/`, impl#2 — NOT impl#1): #1290 dpa-066 M0–M3 — NEW `effects.scrml` (241
#     lines; `FxAtom:struct` :46, `ownAtom` :49, `atomBefore` :54, `closeDim(own, edges)` :115 (SCC order from its own
#     edges), `witnessOf` :148, `atomChain` :163, `sccOrder` :180 (Tarjan, callees-first)). `analyze.scrml` (15,088
#     lines) imports it (:57); `Summary:struct` :14109 (dims `writes` / `writesOpen` / `client` / `routeOpen` / `waits`
#     / `clock` / `noValue` + `places`), `Callable` :14108, `summarize` :14121, `rulesPass` :14483; rules read it via
#     `writeWitness` :12037 / `openWitness` :12043 / `clientReachOf` :13365 / `routeOpenOf` :13373 / `waitsOf` :13381.
#     RETIRED (grep finds none): `fnSummaries`, `clientReach`, `asyncReach`, `mayRunOnServer`, `fnYieldsValue`,
#     `clockFns`. G7 closed (a `return <no-value call>` wrapper is E-ERROR-012). NEW `slice-m4/effects-summary.test.js`
#     (196) + `slice-m4/diag-diff.js` (98; reads `SCRML_BOOT_DIAG_LOG`, hook at `slice-m1/harness.js:125`).
#     `link.scrml` (#1280) unchanged this window — mapped in the S453 block below.
#   SPEC-only: #1281 — E-TENANT-RAW-EGRESS narrowed to `.acrossTenants()` rows; §14.8.9 binding rule keyed on ORIGIN;
#     NEW E-PROTECT-UNRESOLVED-COLUMNS (MAY), I-PROTECT-REVEAL. #1285 also edits §19.13 / §34 / §19.4.5 status lines.
# ⛑ FIGURES RE-EXECUTED AT `7ce905ac2`: `facts.ts --check` PASS · `compiler/src` **290,007 lines / 226 files** (+2 =
# `tenant-sql-subset.ts`, `commands/fix-arm-pipe.js`) · test files **1,591** (+3) · `compiler/SPEC.md` **45,783** lines
# (+110; `regen-spec-index.ts --check` OK 72/72) · conformance **1312** (+2: `error/arm-pipe-legacy-handler`,
# `engine/arm-pipe-legacy-message`); `bun conformance/run.ts` -> **1262 pass + 50 xfail** · known-gaps open **HIGH
# 242** · **MED 505** · **LOW 266** · Nominal 8; drift 61 · slice-m4 **1129 pass / 1 todo / 0 fail** across 34 files ·
# `self-host-v2` 21 `.scrml` modules, **33,342** lines · bootstrap counter (live) 1312 attempted: PASS **121** · FAIL
# **48** · NOT-TWINNED **514** · UNSUPPORTED **629** · CRASH 0; graded 169, 121 hold (71.6%) — ⚠ committed
# `docs/bootstrap-conformance.md` STALE a 4th window (1310 cases; `--check` STALE).
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S453 HEADER (stamp `fd2f757d0`), CARRIED — STILL ACCURATE FOR ITS WINDOW. ━━━━━━━
# ⛑ **S453 STAMP — `d3e660a08` -> `fd2f757d0`. 17 COMMITS (#1269 SPEC whole-error binder, #1271 S451 wrap, #1270
# bootstrap §34 severity, S452-bryan #1272/#1273/#1274/#1275/#1276/#1277/#1278/#1279/#1280, S453-peter #1283/#1286
# + the S453 bookkeeping commit `b6a43445e`, and #1287 brought in by the merge commit `fd2f757d0`), incremental
# refresh. Checkout `docs/s453-wrap-bookkeeping` @ `fd2f757d0` = `origin/main` (`38ec5fcab`, #1287) merged into the
# S453 bookkeeping branch.** MAP-STAMP RULE: `git log --oneline d3e660a08..HEAD` -> 17; `bun scripts/state.ts
# --check` at pass start: `maps: 17 commits behind HEAD (watermark d3e660a08, HEAD fd2f757d0)` — matches exactly.
# ⚠ **HEAD MOVED TWICE MID-PASS; THE STAMP IS THE FINAL HEAD AND THE FIGURES ARE STILL EXACT.** The pass opened at
# `b6a43445e` (15 commits, clean tree). (1) The PA merged `origin/main` #1287 in at `1d45ef281` while the pass ran —
# every figure in this stamp was re-executed there, so #1287 IS mapped. (2) The branch was then RE-LINEARISED: the
# merge went away, `b6a43445e` became `d33842588` (#1289) and the S453 wrap commit `fd2f757d0` (#1291) was added, so
# `1d45ef281` is no longer an ancestor of HEAD (`state.ts --check` will say so about any stamp older than this one).
# ⛑ **THE FIGURES WERE NOT RE-RUN A THIRD TIME, AND DO NOT NEED TO BE:** `git diff 1d45ef281 fd2f757d0 -- compiler
# scripts conformance stdlib docs/FACTS.md docs/known-gaps.md compiler/SPEC.md` is **EMPTY** — the two commits have a
# byte-identical source, figure and gap-ledger tree. The only differences are `docs/changelog.md`, `hand-off.md` and
# `handOffs/**` (out of scope). `git log --oneline d3e660a08..fd2f757d0` is **17**, the same window.
# Source-relevant in THIS window, grep-verified at `fd2f757d0`:
#   impl#1 (`compiler/src`, 224 files):
#   #1283 — §13.2 / S449 ruling A3: an async event listener's rejection reaches scrml's logging surface.
#     `codegen/js-async-analysis.ts` NEW `wrapHandlerRejectionLog` :1539 (module-LOCAL, not exported) +
#     `DEFAULT_HANDLER_BOUNDARY_ID` :1505 (`"event handler"`) + `ColorOpts.boundaryId` :1472; the wrap is applied
#     INSIDE `colorAsyncFunctionExpr`'s `if (r.rootAsync)` branch (:1666-1667) — ONE seam, so every listener
#     emitter inherits it. A DIRECTIVE PROLOGUE stays OUTSIDE the `try` (the first cut returned `null` there and
#     left the listener `async` with no arm — worse than the bug). Catch var `_scrml_async_err`; sink
#     `_scrml_error_boundary_log(boundaryId, err)`, called UNGUARDED from the always-included `errors` runtime
#     chunk, matching its sibling sites (`emit-engine` `effect=`, `emit-reactive-wiring` `on mount`, `emit-client`
#     `session.destroy`). Boundary ids threaded at the call sites: `emit-event-wiring.ts:1345` (the ONE
#     `colorHandlerAsync` call — covers all THREE registrations there), `emit-each.ts:2536`, and the **13**
#     `colorActiveHandler` sites in `emit-lift.js`. See structure.map.md's S453 inventory for the full surface.
#   #1286 — §19.10 transaction exits + the top-level refusal. NEW `validators/lint-transaction.ts` (404 lines):
#     `runTransactionChecks(ast)` :143, `TransactionCode` = `E-ERROR-001` | `E-ERROR-007` |
#     `E-TRANSACTION-CONTROL-FLOW` :58, `TransactionDiagnostic` :60, internal `TxnCtx` :70 (`loopDepth`,
#     `switchDepth`, `labels`, `inFunction`, `inStmtMatchArm`, `inMatchArm` :115 — a FAIL-CLOSED union over
#     statement- and value-position `match` arms) / `WalkState` :118. Wired in `api.js:1946` as the
#     `TRANSACTION-CHECKS` stage (after TAB, before `SCOPE-REDECLARE`). `ast-builder.js` NEW shared
#     `parseTransactionBlock()` :7803, reached from BOTH the top-level loop (:15697) and `parseOneStatement`
#     (:9689, gated on a following `{`) — before this a `transaction {}` in a function body degraded to an
#     undeclared identifier (E-SCOPE-001). `emit-logic.ts` `case "transaction-block"` :4377 owns the emission
#     (BEGIN / COMMIT / `_markTransactionExits` :700 marking every `fail` / `?` exit with the rollback closure /
#     a `finally` backstop so no transaction is ever left open); the `fail` limb is `emit-logic.ts:685-687`.
#   #1287 — §14.8.10 (SECURITY): the tenant floor now filters at the SOURCE. `codegen/tenant-egress.ts` (920 lines,
#     +819 changed) `_scrml_tenant_scope(rows, keyCols, addedCols)` :792 / `_scrml_tenant_scope_none` :814 REPLACE
#     the retired `_scrml_tenant_tag`; `resolveTenantScoping` :321 emits one key column per tenant-scoped JOIN
#     source (`TENANT_KEY_ALIAS_PREFIX = "__scrml_tenant_"` :253), a subquery / CTE / derived-table read of a
#     tenant table -> `E-TENANT-AGG` (reason `"subquery"`), anything else unresolvable -> ZERO rows;
#     `wrapWithTenantScope` :911 wraps EVERY terminator (`.all`, `.get`, `.run`, bare `?{}` — the last two were
#     never tagged before) via `rewrite.ts` + `emit-logic.ts`, and `.get()` takes `[0]` AFTER the filter;
#     `emit-server.ts` wraps route handlers in `_scrml_tenant_request_scope` :705 (AsyncLocalStorage) so PEER
#     server functions are scoped too, and outside any request the filter yields zero rows;
#     `_scrml_tenant_redact` :851 stays as defense in depth. Closes the C4 extraction leak (`rows.map(r =>
#     r.name)`, `rows.length`, a sum, a join, a hand-built `Response`). **PARTIAL — lexical bypasses are open,
#     r3 next.** Also `sql-projection.ts`, `emit-tool.ts`, `emit-control-flow.ts`, `protect-flow.ts` (one name).
#   #1275 / #1276 — §51.0.S.2.3 / §19.4.5 impl#1 EXCEPTIONS to the S452 freeze: engine message arms and `!{}`
#     handler arms parse with NO leading `|`. `engine-statechild-parser.ts` NEW `pipelessHeadAt` (+ `readIdent`):
#     a head is EXACTLY `.V` / `::V` / `T.V` / `T::V` (optionally `( … )`) or `_` / `else`, with the arm arrow on
#     the SAME line — no paren-free binder, no alternation, a bare name is not a pattern; anything else ends the
#     arm run and the line is render content (FAILS CLOSED, byte-identical to before). `ast-builder.js` carries
#     the `!{}` twin. `type-system.ts` NEW `E-TYPE-ARM-QUALIFIER-MISMATCH` — a type-qualified arm (`T.V :>`) must
#     name the handled error type; compares the ENUMS both names resolve to (alias-following `enumNameOf`), and
#     SKIPS when either side is unresolvable. The unqualified foreign variant (`.Zap :>`) is still accepted
#     (`g-impl1-handler-arm-foreign-variant-accepted`).
#   bootstrap (`compiler/self-host-v2/`, impl#2 — NOT impl#1): #1270 NEW GENERATED `severity.scrml` (208 lines;
#     `Severity:enum = { Error, Warning, Info }` :86, `severityOf(code)` :90) written by NEW
#     `scripts/gen-bootstrap-severity.ts` from NEW `scripts/s34-catalog.ts` (the ONE §34 catalog-row parser, also
#     used by `scripts/s34-census.ts`); `ast.scrml` `newDiag` :309 reads `severityOf` so no call site can state a
#     severity. #1274 the S451 error-model rulings (E-ERROR-012..015, E-MATCH-BARE-BINDER, `| _ err :>`, value-arm
#     `defer`, `<db src>` per §8.1.1, one arm parser). #1279 `W-ARM-PIPE-LEGACY` (`parse.scrml:524`, Info per
#     `severity.scrml:101`) + the conformance counter grades ONLY Error-severity parse diagnostics as rejections.
#     #1280 §58 determinism: NEW `link.scrml` (246 lines; `Source` / `Linked` types, `codeUnitCompare`,
#     `canonicalSources`, `resolveFrom`, `linkOrder`, `programPaths`, `parseProgram`) — the compile is a function
#     of the SOURCE SET: path-sorted (UTF-16 code units, no locale), canonical link order, no host paths in any
#     artifact or diagnostic; NEW `slice-m4/determinism.test.js` is its gate.
#   SPEC-only: #1269 (`| _ err :>` whole-error binder), #1272 (currency fixes — the §8.1.1 impl#1 divergence
#     marked RESOLVED by #1264, E-SQL-004 loci cited by function, a §34 row for
#     E-INTERNAL-DB-HANDLE-UNRESOLVED), #1273 (ONE pattern-arm grammar: `!{}` and engine message arms take
#     §18.2's `match-arm`; the `|` lead soft-deprecates under `W-ARM-PIPE-LEGACY`, `E-ARM-PIPE-LEGACY` reserved),
#     #1278 (§14.8.10 filters at the SOURCE — the NORMATIVE mechanism changed; WHERE-injection is demoted to a
#     v1.next optimization and the egress strip is explicitly no longer the guarantee). #1277 = dpa-queue only.
# ⛑ FIGURES RE-EXECUTED AT `fd2f757d0`: `facts.ts --check` PASS · `compiler/src` **288,402 lines / 224 files**
# (+1,506, +1 file = `validators/lint-transaction.ts`) · test files **1,588** (+10 by the FACTS definition; 13 new
# files, 3 of them under `self-host-v2/`, which FACTS excludes) · `compiler/SPEC.md` **45,673** lines (+444;
# `regen-spec-index.ts --check` OK 72/72) · conformance **1310** cases (+10); `bun conformance/run.ts` -> **1260
# pass + 50 xfail, 0 fail** · `docs/known-gaps.md` (committed; `state.ts --check` gap-counts PASS at this HEAD)
# open **HIGH 241** (carried 6) · **MED 500** (4) · **LOW 264** · Nominal 8; heading/marker drift **61**
# (unchanged) · slice-m4 **1115 pass / 1 todo / 0 fail** across 33 files (was 1002/0) · bootstrap counter (live)
# 1310 of 1310 attempted: PASS **120** · CODES-ONLY 0 · FAIL **48** · LEGACY 0 · NOT-TWINNED **513** ·
# UNSUPPORTED **629** · CRASH 0; graded 168, of which 120 hold (71.4%), 11 of those vacuous — ⚠ committed
# `docs/bootstrap-conformance.md` is STALE AGAIN (1301 cases / 511 / 622; `--check` says STALE) · `state.ts
# --check` `@generated:recent-sessions` (master-list.md) STALE.
# ⚠ **HOST ARTIFACT, NOT A REGRESSION — do not open a bug on it.** `bun test ./compiler/self-host-v2/slice-m2/` is
# **420 pass / 6 fail** on this Windows clone. All six are `compareCore` text-node diffs of the shape
# a=`"\r\n    "` b=`"\n    "` at `decls[0].renders[0].data.kids[0].data.text` — `core.autocrlf=true` CRLF in the
# fixture sources, not a lowering defect. The S451 stamp's 462/0 was measured on a different host.
# ⛔ **CORRECTED THIS PASS: the `gate` CI job is 17 TOTAL STEPS (15 `- name:` + 2 `- uses:`)**, re-parsed at BOTH
# `d3e660a08` and `fd2f757d0` (identical at both ends). `primary.map.md`'s Task-Shape Routing row published
# `14 TOTAL STEPS — 12 + 2` with a "RE-PARSED, NOT CARRIED" assurance attached; see build.map.md's S453 section
# and non-compliance.report.md `C-S453-A`.
# NOT MAPPED: the PA's in-flight S453 wrap edits, and the untracked `compiler/tests/unit/gauntlet-s20/__fixtures__/`
# that appeared mid-pass. `file:line` cites in S453 sections are grep-derived at `fd2f757d0` — locate by SYMBOL
# after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S451 HEADER (stamp `d3e660a08`), CARRIED — STILL ACCURATE FOR ITS WINDOW. ━━━━━━━
# ⛑ **S451 STAMP — `47c863556` -> `d3e660a08`. 17 COMMITS (#1252 S449 wrap, #1253-#1268 S451), incremental refresh.
# Checkout `wrap/s451` @ `d3e660a08` + uncommitted wrap docs (changelog / known-gaps / pr-reviews / hand-off / delta-log —
# NOT mapped). `origin/main` is ONE ahead at `2a614009b` (#1269, SPEC-only `| _ err :>` whole-error binder) — NOT in this
# stamp. #1270 (`scripts/s34-catalog.ts`) and the bootstrap severity branch are UNLANDED — NOT mapped.** MAP-STAMP RULE:
# `git log --oneline 47c863556..HEAD` -> 17; `bun scripts/state.ts --check` at pass start: `maps: 17 commits behind HEAD
# (watermark 47c863556, HEAD d3e660a08)` — matches exactly.
# Source-relevant in THIS window, grep-verified at `d3e660a08`:
#   impl#1 (`compiler/src`, 223 files):
#   #1264 — §8.1.1 nearest database scope (security): `db-ownership.ts` NEW `resolveDbScopes` :215 / `dbHandlesWithin`
#     :274 / `dbScopeValueOf` :162 + `DbHandle`/`DbSite`/`DbScopeResolution` :126-155; NEW `codegen/sql-handle-name.ts`
#     (85 lines: `DEFAULT_SQL_HANDLE`, `UNRESOLVED_SQL_HANDLE`, `SQL_HANDLE_PATTERN`, `sqlHandleRegExp`, `sqlHandleAt`,
#     `compareSqlHandles`, `setFileSqlFallback`, `fallbackSqlHandle`); `emit-server.ts` `dbScopeResolutionFor` :834, one
#     handle per database (`_scrml_sql`, `_scrml_sql_<n>`), E-SQL-011 :1828 (one fn, two databases) + :6652 (`watches=`
#     channels in two scopes), E-INTERNAL-DB-HANDLE-UNRESOLVED :7059 / `emit-tool.ts:222`; `db-authoritative.ts`
#     `wrapPrincipalTxn(src, handles?)` — tenant floor on EVERY handle (was `_scrml_sql` only).
#   #1258 — §12.4 route inference ignores string-literal / template-text / comment contents: `expression-parser.ts`
#     `blankLiteralTextInSource` :3689, `emitCodeOnlyStringFromTree` :3763; `route-inference.ts` `codeOnlyTextForTrigger` :926.
#   #1256 — NEW `scrml fix` verb: `commands/fix.js` (253 lines; `runFix`, `runFixCommand`, `parseFixArgs`, `classifyEntry`,
#     `resolveProject`, `lineDiff`) + `commands/fix-s66.js` (1684 lines; `fixS66`, `IMPL1_SAFE_RULES` = pre-migrate /
#     program-wrap / program-move / unwrap-logic, `S66_DECL_RULES` = rhs-decl / const-cell / engine-simple); `cli.js`
#     dispatch. CLI verbs now **12**. Bootstrap counter grades legacy cases on generated §66 twins (`--no-twins` = old).
#   bootstrap (`compiler/self-host-v2/`, impl#2 — NOT impl#1): #1254 if/else-if/else chains (E-CTRL-001..005), #1255 defer
#     + no artifact on error, #1257 `<program>` attrs checked/refused, #1260 `persist=` (E-PERSIST-*, E-HOLD-/E-PREPAINT-
#     WITHOUT-PERSIST; runtime `persisted` `slice-m1/runtime/runtime.js:1665`), #1261 `show=` + repeated/case-variant
#     attrs refused, #1263 U1a NEW `sql.scrml` (577 lines; `sqlFacts(chunks) -> SqlFacts`, fail-closed SELECT-vs-write
#     scan), #1265 error model — ONE `Stmt.Attempt` (core.scrml:369) for `!{}` / `match` / `?` / `?{}`.
#   SPEC-only: #1253 (U1 R1-R11), #1259 (OPEN items), #1262 (`show=` no-narrow; nearest db scope), #1266 (E-ERROR-012/013,
#     E-SQL-011), #1267 (lone direct-child `<db src>` supplies the program db), #1268 (§19.9.10 client server-calls
#     failable; E-ERROR-014/015, E-MATCH-BARE-BINDER). New SPEC headings: §13.7, §19.8.3, §19.9.9.7, §19.9.10, §52.6.8,
#     §57.5, §57.8. All new language codes are **Nominal on impl#1**; bootstrap emits none of E-ERROR-012..015 /
#     E-MATCH-BARE-BINDER / E-SERVER-CELL-RESERVED-NAME yet.
# ⛑ FIGURES RE-EXECUTED AT `d3e660a08`: `facts.ts --check` PASS · `compiler/src` **286,896 lines / 223 files** (+2,579,
# +3 = `sql-handle-name.ts`, `commands/fix.js`, `commands/fix-s66.js`) · test files **1,578** (+4, FACTS def.) ·
# `compiler/SPEC.md` **45,229** lines (+1,062; `regen-spec-index.ts --check` OK 72/72) · conformance **1300** cases (+12);
# `bun conformance/run.ts` -> **1250 pass + 50 xfail, 0 fail** · `docs/known-gaps.md` (committed) open **HIGH 240** ·
# **MED 496** · **LOW 251** · Nominal 8; heading/marker drift 61 (unchanged) · slice-m2 **462/0**, slice-m4 **1002/0**
# (+451; 10 new test files) · bootstrap counter (live, with twins) PASS **95** · FAIL **65** · LEGACY 0 · UNSUPPORTED
# **629** of 1300 — ⚠ committed `docs/bootstrap-conformance.md` STALE again (89/52/648; `--check` says STALE).
# NOT MAPPED: in-flight / unlanded work. `file:line` cites in S451 sections are grep-derived at `d3e660a08`.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S449-WRAP HEADER (stamp `47c863556`), CARRIED — STILL ACCURATE FOR ITS WINDOW. ━━━━━━━
# ⛑ **S449-WRAP STAMP — `9bafb927` -> `47c863556`. 7 COMMITS (#1245 S450-peter wrap incl. the `9bafb927` map refresh,
# #1246 state regen, #1247 bootstrap conformance counter, #1248 dpa-queue, #1249 §66 opener keywords, #1250 bootstrap §55
# validity surface + submit gate, #1251 transaction guard), incremental refresh. Main checkout `wrap/s449` == `origin/main`
# `47c863556`.** MAP-STAMP RULE at write time: `git log --oneline 9bafb927..origin/main` -> 7; `bun scripts/state.ts
# --check` at pass start: `maps: 7 commits behind HEAD (watermark 9bafb927, HEAD 47c863556)` — matches exactly.
# ALREADY COVERED by the `9bafb927` refresh (grep-verified in these maps, NOT re-mapped): #1235 bootstrap `<effect>`, #1236
# protect r9 (`codegen/session-store-emit.ts`), #1238 §6.15 value-writes, #1239 auth (`codegen/server-session-guard.ts`,
# `route-inference.ts`), #1240 native-parser freeze. S449-wrap only ADDS Task-Shape Routing rows for #1239 (none existed).
# Source-relevant in THIS window, grep-verified at `47c863556`:
#   #1251 — §19.10.6 / §8.9.2 transaction guard (impl#1): NEW `compiler/src/codegen/sql-tx-guard.ts` (360 lines; the
#     emitted per-handle FIFO mutex + AsyncLocalStorage request scope); `emit-server.ts` (guarded handle decls, request-
#     scope loop, body read before BEGIN, `BEGIN` vs `BEGIN DEFERRED` by driver, `fail` -> ROLLBACK, SSE stream-end
#     backstop, `E-SQL-010`); `emit-channel.ts` (WS callbacks `async` + await their onserver handler); `protect-flow.ts`
#     (`TX_GUARD_RUNTIME_NAMES` modelled, never walked); `attribute-registry.js` (`<program transactions=>`);
#     `db-ownership.ts` (NEW export `fileDefaultDbDecl`).
#   #1250 — bootstrap §55 validity surface + compiler submit gate (`compiler/self-host-v2/` ONLY; impl#1 xfail).
#   #1249 — §66.2.5 keywords OUTSIDE the declaration opener (`let <x/>`, `export let <x/>`): SPEC + bootstrap parser
#     (`self-host-v2/parse.scrml`) + 43 test/fixture files migrated. impl#1 has NO emitter (Nominal).
#   #1247 — NEW `scripts/bootstrap-conformance.ts` (tracking counter), generated `docs/bootstrap-conformance.md`, a
#     `continue-on-error` ci.yml step.
# ⛑ FIGURES RE-EXECUTED AT `47c863556`: `facts.ts --check` PASS · `compiler/src` **284,317 lines / 220 files** (+530, +1 =
# `sql-tx-guard.ts`) · test files **1,574** (+5) · `compiler/SPEC.md` **44,167** lines (+252; `regen-spec-index.ts --check`
# OK 72/72) · conformance **1288** cases (+10); `bun conformance/run.ts` -> **1246 pass + 42 xfail, 0 fail** (+2 pass =
# the 2 `sql/transactions-*` cases; +8 xfail = the 8 `forms/` bootstrap-executed cases) · `docs/known-gaps.md`
# gap-counts open **HIGH 237** · **MED 484** · **LOW 234** · Nominal 7; heading/marker drift 61 (unchanged) ·
# bootstrap slices: slice-m2 **462/0**, slice-m4 **551/0** · bootstrap counter (live run) PASS 42 · FAIL 18 · LEGACY 951 ·
# UNSUPPORTED 277 of 1288 — ⚠ the committed `docs/bootstrap-conformance.md` is STALE (1286 cases; `--check` says STALE).
# NOT MAPPED: any in-flight / unlanded fix. `file:line` cites in S449-wrap sections are grep-derived at `47c863556`.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S450 HEADER (stamp `9bafb927`), CARRIED — STILL ACCURATE FOR ITS WINDOW. ━━━━━━━
# ⛑ **S450 STAMP — `6a592ed5c` -> `9bafb927`. 17 COMMITS (S447 wrap #1231, S449 #1232-#1240 incl. the native-parser
# FREEZE #1240, S450 #1208/#1210/#1211/#1241/#1242/#1243/#1244), incremental refresh. Checkout `wrap/s450-peter` @
# `da493e06` = `origin/main` `9bafb927` + wrap docs (`git diff 9bafb927 da493e06 -- compiler scripts conformance` is
# EMPTY).** MAP-STAMP RULE at write time: `git log --oneline 6a592ed5c..9bafb927` -> 17; `bun scripts/state.ts --check`
# at pass start: `maps: 19 commits behind HEAD (watermark 6a592ed5c, HEAD da493e06)` = 17 landings + wrap `65d64e9f` +
# merge `da493e06`. After this restamp it reads 2 behind `da493e06` — both docs-only wrap commits, not source drift.
# Source-relevant, grep-verified at `9bafb927`: #1240 (native-parser FREEZE — see HEADLINE), #1239 (E-SESSION-AMBIENT-SERVER
# + E-AUTH-ATTR-INVALID, both build-refusing), #1234 (session store WAL+busy_timeout; CSRF-gated session destroy; auth=
# lints), #1233 (§47.14 data-root containment refuses unresolvable symlinks; W-DEPLOY rows), #1236 (§14.8.9 protect
# egress round 9), #1235/#1238 (bootstrap `<effect deps=>` / `reset-on=` / §6.15 value-position no-write — self-host-v2
# ONLY), #1237 (SPEC-only S449 lifecycle rulings), #1208 (defer: E-DEFER-OUTSIDE-FUNCTION reaches text-lowered bodies),
# #1210 (imported-enum match binding), #1211 (client helper `.js` copied into `dist/_scrml_local/`; E-IMPORT-011), #1241
# (headless serve-target binds loopback; `SCRML_HOST`), #1242 (nested server-call cell write awaited in place), #1243
# (E-SCHEMA-014 / E-SCHEMA-015), #1244 (E-ATTR-MULTI-STATEMENT). #1231/#1232 = wrap / gaps / reviews only.
# ⛑ **FIGURES RE-EXECUTED AT `9bafb927`** (`bun scripts/facts.ts --check` PASS): version **0.8.0** · `compiler/src`
# **283,787 lines / 219 files** (+2,864 lines, -1 file) · test files **1,569** (+11) · `compiler/SPEC.md` **43,915** lines
# (+877; `regen-spec-index.ts --check` OK, 72/72) · conformance **1278** cases (+69); `bun conformance/run.ts` ->
# **1244/1278 pass + 34 xfail, 0 fail** (was 1201 + 8 xfail; the new xfails are bootstrap-only `lifecycle/` +
# `reactive/no-write-*` cases) · `docs/known-gaps.md` `@generated:gap-counts` at `9bafb927`: open **HIGH 230** (+5
# carried) · **MED 473** (+1 carried) · **LOW 224** · Nominal 7. §34 census NOT re-run this pass (Windows host; see N-S446-1).
# ⛑ **HEADLINE — #1240 NATIVE-PARSER FREEZE (S449 ruling 6).** `compiler/native-parser/` 81 -> **44** tracked files: all
# 37 `.scrml` mirrors DELETED; the `.js` files STAY as a FROZEN component of impl#1, called at fixed sites only:
# `component-expander.ts` + `meta-eval.ts` (`nativeParseFile`), `codegen/emit-match.ts` + `codegen/emit-engine.ts`
# (re-parse via `require`), `validators/defer-structure.ts` (`lex` + `parseProgram` probe), `native-walker/
# forbidden-js-native.ts` (E-CLASS / E-DYNAMIC-IMPORT), `ast-builder.js` + `block-splitter.js` (`body-top-prose.js`,
# `body-top-coverage.js`), `api.js` (`translate-expr.js` `resetMarkupValueExprIdCounter`), `native-walker/
# engine-statechild-walker.ts` (`collect-hoisted.js`). **`--parser=scrml-native` RETIRED** — `scrml compile` exits 1 with
# "is retired (S449)" (`commands/compile.js`; help line removed from `cli.js`; test `unit/parser-flag-retired.test.js`).
# DELETED: `src/native-parser-canary/within-node-classifier.ts` (dir gone), `src/native-walker/attrvalue-exprnode-walker.ts`,
# `src/native-walker/exprtext-backfill-walker.ts`, `scripts/native-parser-flip-harness.ts`, the parity suite
# (`tests/parser-conformance.test.js`, `-canary.test.js`, `-within-node.test.js`, the 6,736-line
# `parser-conformance-within-node-allowlist.json`, `parser-conformance/{dual-pipeline-canary,parsers,tier-diff}.js`,
# `parser-conformance/live-phantom-fixture.scrml`) and ci.yml's tracking "Within-node parser-parity" step. KEPT:
# `tests/parser-conformance/{corpus-enumerator.js,bench/,markup-bench/}`, `tests/parser-conformance-corpus.test.js`,
# `-expr.test.js`, `-each-contextual-sigil.test.js`; NEW `tests/helpers/native-ast.js` (direct `nativeParseFile` tree +
# `liveAst` oracle for tests that used to compile under the flag).
# ⚠ Every OLDER stamp block / section below that describes the within-node parity gate, the canary, the allowlist,
# `STRIP_KEYS` registration, the flip harness, or `--parser=scrml-native` as LIVE is SUPERSEDED by this block.
# ⚑ `file:line` citations in S450 sections are grep-derived at `9bafb927`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S447 HEADER (stamp `6a592ed5c`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S447 STAMP — `78e4ddad` -> `6a592ed5c`. 12 COMMITS (S446-peter wrap #1223, S448 wrap #1224, bootstrap Uc codec
# #1213/#1221, S447-bryan #1216/#1222/#1225/#1226/#1227/#1228/#1229/#1230), incremental refresh, main checkout on
# `wrap/s447` == `origin/main` `6a592ed5c`.** MAP-STAMP RULE at write time: `git log --oneline 78e4ddad..HEAD` -> 12;
# `bun scripts/state.ts --check` reported `maps: 12 commits behind HEAD (watermark 78e4ddad, HEAD 6a592ed5c)` at pass
# start — confirms the window exactly. Source-relevant, grep-verified at `6a592ed5c`:
# #1230 (**`compiler/self-host/` — the frozen v1 tree — is REMOVED.** 18 tracked files / 22,433 lines deleted;
# `git ls-files compiler/self-host` is EMPTY; a gitignored untracked `compiler/self-host/dist/` can linger on an old
# checkout and is NOT source. Deleted with it: `scripts/rebuild-self-host-dist.ts`, `scripts/rebuild-bs-dist.ts`,
# `scripts/rebuild-tab-dist.ts`; the v1 sections of `integration/self-host-smoke.test.js` (§B bs.js, §C tab.js) and of
# `integration/self-compilation.test.js` ("compiler compiles compiler" + the skipped L3); the 11 v1 keys of
# `parser-conformance-within-node-allowlist.json`. Trimmed: `compiler/scripts/build-self-host.js` builds ONLY the
# `stdlib/compiler/{module-resolver,meta-checker}` pair; `commands/compile.js` `--self-host` loads ONLY that pair (the
# optional bs/ast/bpp/pa/ri/ts/dg/cg/tokenizer swap-ins are gone). Re-pointed: `parser-conformance/corpus-enumerator.js`
# corpus root "self-host" -> `compiler/self-host-v2` (`driftGated: false`; 11 v2 files `[gap]`-skipped — gap
# `G-SELF-HOST-V2-CORPUS-PARSER-DIVERGENCE-SKIPS`); `parser-conformance-canary.test.js` inlines the cg/bs fixture shapes
# it used to read from the tree. KEPT (not v1): the `selfHostModules` API option (`api.js` / `pipeline-seam.ts`) and
# `codegen/compat/parser-workarounds.js` `setBPPOverrides`), #1226 (S448 test infra: NEW
# `compiler/tests/helpers/tmp-root-preload.js`, registered via NEW `bunfig.toml` `[test] preload` — every `bun test`
# process from the repo root gets a per-process temp root `<base>/<pid>-<rand>` with TMPDIR/TEMP/TMP pointed at it;
# `<base>` = `SCRML_TEST_TMP_BASE` else `${XDG_CACHE_HOME:-~/.cache}/scrml-test-tmp`; MUST NOT sit in a git repo or
# under a `scrml.toml` (falls back to `<os.tmpdir()>/scrml-test-tmp`, else leaves TMPDIR alone); wraps
# `Bun.spawn`/`Bun.spawnSync` calls that pass no `env`; layered removal (global `afterAll`, `exit`, SIGINT/SIGTERM/SIGHUP,
# a detached POSIX `sh` watchdog, stale-root prune >24h of dead pids) — PLUS `commands/dev.js` child lifecycle:
# `spawnedAppChildren` Set + `killAllAppChildren()` reap every starting/live/in-grace app child on `exit`/SIGINT/SIGTERM
# (SIGHUP deliberately unhandled, preserves `nohup`); `runDevChildServer(serveDir, opts, serverModules, parentPid)`
# arms its 2 s orphan guard on the parent pid written into the child config (`parentPid: process.pid`), BEFORE route
# loading; the parent's own launcher guard uses the ppid captured at entry (`launchPpidAtEntry`); NEW test
# `compiler/tests/commands/dev-child-dies-with-parent.test.js`), #1228 (§14.8.9 protect egress round 8,
# `codegen/protect-flow.ts` +685: `RowPart.paths` — where a row sits inside a value (`ROW_SELF`, `PATH_SEP`, `ANY_KEY`,
# `ROW_ANYWHERE`, `MAX_ROW_PATH = 4`; `normPaths`/`prefixPaths`/`readPaths`/`rowAnywhere`/`anyDepth`) so `{ h: u }.h`
# is the row, not column `h`; `Taint.gn`/`gnAny` — global names a value was read through (`carryGlobalNames`,
# `containerOf`, `subsumes`) so an aliased global (`const { C } = globalThis`, `const P = process`) reaches functions
# stored under that name, fail-closed when unnamed; one descriptor path (`get`/`set`/`value` and a getter's returned
# function are stored under the key); `LANGUAGE_COERCIONS` (String/Number/Boolean/BigInt/Symbol) no longer apply every
# reachable function — removes the round-7 perf cliff; new gap `g-protect-egress-round-9-residuals`), #1213/#1221
# (bootstrap arc unit Uc — the §57 wire codec: NEW `compiler/self-host-v2/codec.scrml` (compile-time, type-directed
# `WireTable` descriptor; refuses payload enums, a `__scrml_absent` field, unnamed `Named`) + NEW
# `compiler/self-host-v2/slice-codec/` (`runtime/codec.js`: `ABSENT_KEY`, `CodecDefect`, `isAbsenceEnvelope`,
# `encode`/`encodeText`/`decode`/`decodeText`; `codec.test.js`, `cross-impl.test.js`, `harness.js`, `bundle.scrml`,
# `src/types.scrml`); CI `gate` runs `bun test ./compiler/self-host-v2/slice-codec/` — 92 pass / 0 fail re-executed this
# pass), SPEC-only landings (#1216 §55 validity surface for validated top-level values + §55.17 compiler submit gate;
# #1222 §7.3.4 call arity + argument-type checking, UFCS parked; #1227 dpa-063 §7.2.2 newline ends a statement,
# `E-STMT-NO-EFFECT` language-wide; #1229 §6.7.4 `<effect deps=[…]>` outside-world only + §6.8.4 `reset-on=` + §6.7.7.3
# write requests skip mount). ALL NEW SPEC CODES ARE NOMINAL — grep of `compiler/src` finds ZERO emitters for:
# `E-EFFECT-NO-DEPS`, `E-EFFECT-WRITES-STATE`, `E-EFFECT-WRITE-UNPROVEN`, `E-RESET-ON-CYCLE`, `E-RESET-ON-ENGINE-REFUSED`,
# `E-RESET-ON-INVALID-ENTRY`, `E-RESET-ON-NOT-WRITABLE`, `E-STMT-LEADING-OPERATOR`, `E-VALIDITY-RESERVED-NAME`,
# `E-WHEN-EFFECT-DEPRECATED`, `W-WHEN-EFFECT-DEPRECATED`, `I-FORM-SUBMIT-GATED` (also emitter-less: `E-CALL-ARITY`,
# `E-VALIDITY-NO-SURFACE`, `E-VALIDATOR-DEAD`). impl#1 still compiles `when … changes { }` with writes allowed
# (gap `g-impl1-when-effect-divergence-s447`). `db-ownership.ts` / `db-target.ts` / `codegen/sqlite-file-target.ts` are
# ZERO-DIFF this window (#1215 data root mapped at the S446 stamp stands); #1225 is inbox-only.
# ⛑ **FIGURES RE-EXECUTED AT `6a592ed5c`** (`bun scripts/facts.ts --check` PASS): version **0.8.0** · `compiler/src`
# **280,923 lines / 220 files** (+495 lines, +0 files) · test files **1,558** (+1) · `compiler/SPEC.md` **43,038 lines**
# (+1,052; `regen-spec-index.ts --check` OK, 72/72) · conformance **1209** cases (+0); `bun conformance/run.ts` ->
# **1201/1209 pass + 8 xfail** · `docs/known-gaps.md` open **HIGH 235** (+10; 4 carried) · **MED 462** (+20) · **LOW 215**
# (+1) · Nominal 7. §34 census (Linux run, path-separator bug does not apply): **881 rows** (+12 — the 12 Nominal codes
# above) · STRUCK **35** · PINNED **377** · IMPL-SITES **317**.
# ⚑ `file:line` citations in S447 sections are grep-derived at `6a592ed5c`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S446 HEADER (stamp `78e4ddad`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S446 STAMP — `464c9ab4d` -> `78e4ddad`. 13 COMMITS (S444/S445 wrap tail #1201/#1203-#1206, S446-peter
# #1207/#1209/#1212/#1217, test fixes #1219/#1220, S447-bryan #1215/#1218), incremental refresh, branch `wrap/s446-peter`.**
# MAP-STAMP RULE at write time: `git log --oneline 464c9ab4d..78e4ddad` -> 13; `bun scripts/state.ts --check` reports
# `maps: 13 commits behind HEAD (watermark 464c9ab4d, HEAD 78e4ddad)` at the moment this pass started — confirms the
# window exactly. Source-relevant, grep-verified at `78e4ddad`:
# #1201 (§4.12/§40 program role by ancestor — NEW `compiler/src/program-role.ts`: `ProgramRole`, `forEachProgramWithRole`,
# `findTopLevelProgram(s)`, `stampImpliedProgramAncestors`, `nestedProgramAttrVerdict`; NEW codes `E-PROGRAM-NESTED-SESSION`,
# `E-PROGRAM-NESTED-ATTR`, `E-PROGRAM-CONFIG-UNREAD`, `W-PROGRAM-TITLE-NESTED` beside the S443 `E-PROGRAM-002` /
# `E-PROGRAM-NESTED-AUTH`; a `<program>` is top-level iff it has no `<program>`/`<page>` ancestor, whatever markup wraps
# it, and every `<program>` in a route file of a build with an app program is nested (implied ancestor); consumed by
# `compute-program-config.ts`, `tool-program.ts`, `auth-graph.ts`, `reachability/entry-points.ts`, `route-inference.ts`,
# `refusal-gate.js` (fail-closed: no `server.js` written on `E-PROGRAM-002`/`E-PROGRAM-NESTED-AUTH`); +9 conformance
# cases under `conformance/cases/auth/program-*`), #1209 (schema: `E-SCHEMA-014` NEW — a readable, unqualified
# `CREATE TABLE` head that is not a plain declaration (a kind modifier / no column list / unclosed list / trailing
# `INHERITS`); extends `E-SCHEMA-012`/`013` to a declarative `name {` DSL head glued to a longer token; emitted at
# `gauntlet-phase1-checks.js` from `schema-differ.js` `findRejectedCreateTableHeads` / `findGluedDslTableHeads`; a
# same-PR tenant-declaration UNION attempt was REVERTED for a worse silent over-scope — base shadow (first-wins)
# stands, gap reopened routed to bryan), #1207 (CLI: NEW `compiler/src/commands/listen.js` — the ONE CLI `Bun.serve`
# call site (`listen`, `listenOrExit`, `parseHostFlag`, `isLoopbackHost`, `bindPlan`, `displayUrl`, `networkNotice`);
# `scrml dev`/`scrml serve` now bind `127.0.0.1` (+ a best-effort `::1` twin) by default instead of every interface;
# `--host`/`--host=` opts in, bare `--host` = `0.0.0.0`; new non-catalog CLI error codes `E_SCRML_HOST_SHORTHAND`
# (inet_aton numeric shorthand refused on every OS), `E_SCRML_HOST_WHITESPACE`, `E_SCRML_LISTEN`), #1212 + #1217
# (§5.2.3/§13.2 handler statement lists, three residual silent drops + one regression of the fix itself, all
# execute-verified in happy-dom: `for…lift` rows now attach `handlerBlock` via the same `attachHandlerStatementList`
# function bodies use, lowered by `emit-lift.js` `emitHandlerStatementList`; a match-arm handler's LATER statements are
# now scanned for the arm-name read by `emit-variant-guard.ts` `exprReadsArmName` (the old `handlerReadsArmName` was
# first-statement-only); `collectExpr`'s ASI boundary now treats a postfix `++`/`--` as value-ending so the next line
# is not swallowed into one bare-expr statement; #1217 then makes a ≥2-statement handler's OWN server-call cell write
# await in place before the next statement reads the cell (`js-async-analysis.ts` `handlerStatementListColor` /
# `activeHandlerStatementListColor`, `ColorOpts.reactiveArg1SkipKeep`), with a same-PR fix-round narrowing it to KEEP
# the §36 SSE-generator arg1 skip (`scheduling.ts` `_clientSseFnNames`) so GITI-026's subscription rewrite still
# matches — `emit-event-wiring.ts`/`emit-each.ts` call sites pass the new skip-set through; 7 out-of-scope gaps filed
# (4 HIGH) for shapes still dropped: an imported server fn call, an SSE call nested in an expression), #1215 (db: NEW
# `compiler/src/db-ownership.ts` (`decideOwnedDbFiles`, `sqlDeclaresTable`, `fileDefaultDbValue`, `collectOwnedDbFiles`)
# + NEW `compiler/src/codegen/sqlite-file-target.ts` (`projectRootFor`, `runtimeDbPath`, `sqliteFileHandle` —
# `_scrml_sqlite_owned` / `_scrml_sqlite_referenced`); a `db=` path now resolves against ITS DECLARING FILE and
# OWNERSHIP is per declaring file (only the file whose body declares the schema may create the database; a
# referencing file opens lazily, never creates, loud error if absent); ONE runtime data root, `SCRML_DATA_DIR` env var
# if set else the recorded project root (NEW SPEC §47.14); `db-target.ts` `resolveDbFilePath` is the one compile-time
# resolver, used by `protect-analyzer.ts`; NEW catalog row `W-DB-PATH-RESOLVES-ELSEWHERE`; NEW non-catalog build
# warnings `W-DEPLOY-DB-OUTSIDE-DATA-ROOT` / `W-DEPLOY-DB-NO-PROJECT-ROOT` / `W-DEPLOY-DB-SHARED-PATH`
# (`commands/build.js`); docker/fly/render/railway adapters now set `SCRML_DATA_DIR=/data` on a mounted volume; `scrml
# dev` ignores `SCRML_DATA_DIR` by design (opens beside the declaring `.scrml`)), #1218 (§14.8.9 protect egress round
# 7, `protect-flow.ts`: `this` is tracked as the receiver so `this.p = v` writes the class exactly as `o.p = v`; a
# function stored under a key the LANGUAGE may call — protocol string keys, accessors, any key the compiler cannot
# read, a thenable `.then`, a tagged-template call, an `instanceof` hasInstance hook, a built-in-shadowing method name
# — is analysed as invoked with that `this`; stdlib-identity now keys on the pre-write `scrml:NAME` specifier, not any
# `_scrml/NAME.js`-shaped path (closes a same-named author file spoofing the allowlist); `scrml dev`'s route catch and
# its `error:` handler now answer a FIXED 500 body, never `err.message`, matching the production entry), #1219/#1220
# (test-only: 58 files restore happy-dom globals at a root `afterAll` — a prior file's leaked `Response`/`fetch`/
# `window`/`document` no longer bleeds into a later file in the same `bun test` process; one §K assertion now expects
# the platform-resolved project root, forward-slashed, instead of a hard-coded POSIX `/test` — Windows-red since
# `c12b52c2`, root-caused to this very session).
# ⛑ **FIGURES RE-EXECUTED AT `78e4ddad`** (`bun scripts/facts.ts --check` PASS): version **0.8.0** · `compiler/src`
# **280,428 lines / 220 files** (+2,891 lines, +4 files — the four NEW modules above) · test files **1,557** (+11,
# exactly the 11 new test files below) · `compiler/SPEC.md` **41,986 lines** (+226; `bun scripts/regen-spec-index.ts
# --check` PASS, 72/72 sections current) · conformance **1209** cases (+9); `bun conformance/run.ts` ->
# **1201/1209 pass + 8 xfail** · `docs/known-gaps.md` `@generated:gap-counts` open **HIGH 225** (+3; 4 carried) ·
# **MED 442** (+9) · **LOW 214** (+5) · Nominal 7 (+0) — vs the S445-stamp figures 222/433/209/7.
# ⚑ **§34 census (`bun scripts/s34-census.ts`) NOT FULLY TRUSTED THIS PASS, ON THIS OS — ROOT-CAUSED, NOT
# HAND-WAVED.** Row total **869** (+6 vs the S445 stamp's 863 — reconciles: +1 `E-SCHEMA-014`, +4 program-role codes,
# +1 `W-DB-PATH-RESOLVES-ELSEWHERE`) and STRUCK **34** / PINNED **377** are reliable (string/JSON-derived, no path
# logic). The IMPL-SITES/FALSE-CLAIM split this run read **IMPL-SITES 0 · FALSE-CLAIM 395**, which is WRONG: the
# script's emitter scan guards `isImpl` with `rel.startsWith("compiler/src/")` against a path from Node's `relative()`,
# which on **win32** returns `\`-separated segments (`compiler\src\...`) and so NEVER matches — `implHits` stays
# empty for every run on this Windows checkout, and every code that should land in IMPL-SITES falls through to
# FALSE-CLAIM/DECLARED-AHEAD instead. Confirmed directly: `E-STMT-NO-EFFECT` is a live string literal at
# `ast-builder.js:1708` (grep-verified), yet the census still scored 0 IMPL-SITES. This is a PRE-EXISTING cross-platform
# bug in `scripts/s34-census.ts` (zero-diff this window — not caused by any commit above) — filed as a tooling
# finding in `non-compliance.report.md`, not fixed (a mapper does not edit source). Do not cite this pass's
# IMPL-SITES/FALSE-CLAIM/DECLARED-AHEAD split as ground truth; re-run on Linux/macOS or after a `path.sep`-safe fix.
# ⛑ **BOOTSTRAP RE-RUN: NOT RE-EXECUTED THIS PASS** (time budget). `compiler/self-host-v2` has exactly ONE line-level
# touch this window (`ingest.scrml`, registering `precgTopLevelProgramSpan` as an identity field for the within-node
# classifier, part of #1201's `E-PROGRAM-CONFIG-UNREAD` support — no logic change); `compiler/native-parser` is
# zero-diff. lint-no-default-arm / slice-m1..m4 / CG+CSS footprint figures from the S445 stamp stand, carried forward
# unchanged.
# ⚑ `file:line` citations in S446 sections are grep-derived at `78e4ddad`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S445 HEADER (stamp `464c9ab4d`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S445 STAMP — `5b1d0dab0` -> `464c9ab4d`. 20 COMMITS (S443 wrap #1187, S444 #1182-#1202, S445 #1192/#1194/#1196/#1198),
# incremental refresh, branch `maps/s444-wrap`.** MAP-STAMP RULE at write time: `git log --oneline 5b1d0dab0..464c9ab4d` -> 20;
# `git merge-base HEAD origin/main` == `origin/main` == `464c9ab4d` (no fork). (The dispatch brief named `108ca89be` as the stamp;
# line 3 actually read `5b1d0dab0` — the S444b refresh rode in #1187 — so the window starts there.) Source-relevant:
# #1196 (§40.8 S441: `<program>`/`<page>`/`<channel>` bodies are CODE — catch-all body-top lift, `"…"` declared display text,
# `E-STMT-NO-EFFECT`, `E-INTERNAL-BODY-TOP-DROPPED`; `E-WRITE-NOT-IN-LOGIC-CONTEXT` RETIRED; `default-logic-exemption.ts` +
# `unit-cc-exemption-list.json` DELETED; NEW `native-parser/body-top-prose.js` + `body-top-coverage.js`), #1194 (route
# inference: app root relative to the BUILD ROOT — `resolveBuildRoot` / `makeRouteClassifier`; `W-AUTH-REQUIRED-NOT-INHERITED`),
# #1198 (§14.8.9 protect egress round 6 — RETURNING / every `?{}` terminator / spaced star / undeclared tables /
# opaque callbacks / `arguments` / global stores / descriptor Symbol keys / bare digests; CPS `ServerError` message fixed
# under `protect=`; prod `Bun.serve` `error:` handler), #1200 (`--emit-per-route`: chunk manifest + role bootstrap moved
# from inline `<script>` to ONE same-origin `scrml-chunks.<hash>.js`), #1191 (`<request>` `deps=`, `refetch()` statements,
# client-async bodies, re-fire loop; `E-LIFECYCLE-022` now FIRES), #1184 (`E-ASYNC-FN-ESCAPES-AS-VALUE` wording), #1182
# (CI runs `slice-m4/`; live-PG hook timeouts 120 s). BOOTSTRAP: #1189 (typer r8), #1190 + #1195 (dpa-045 plain-markup
# text grammar, `//` comment only after whitespace, display-text escapes), #1202 (Core additions: `Attr.Bind`, `Expr.Host`
# (`Date.now`), `Expr.Lambda`, `Expr.SeqCall`, `View.Star`, removals, `ElemAt`; dpa-058 validators; fail-closed refusal of
# unimplemented elements). SPEC-only: #1186/#1193 (§6.7.7.1 abort reads, §6.7.7.2 `<request cache>`, §6.14 `persist=`),
# #1199 (§6.14.4 prepaint / `hold=@cell`). #1183 = example 23 helper routes removed. Rest: gaps / dpa-queue / wrap.
# ⛑ **FIGURES RE-EXECUTED AT `464c9ab4d`** (`bun scripts/facts.ts --check` PASS): version **0.8.0** · `compiler/src`
# **277,537 lines / 216 files** (+2,521 lines, -1 file) · test files **1,546** (+11) · `compiler/SPEC.md` **41,760** lines
# (+546) · conformance **1200** cases (+49); `bun conformance/run.ts` -> **1192/1200 pass + 8 xfail** · §34 census
# (`bun scripts/s34-census.ts`) **863 rows** (`SPEC.md:21341..22288`): PINNED 374 · IMPL-SITES 314 · DECLARED-AHEAD 32 ·
# RUNTIME-SURFACED 3 · FALSE-CLAIM 106 · STRUCK 34 · unique `^| [EWIH]-` codes **817 -> 831** (+14, removed none) · known-gaps
# open HIGH 215 -> **222**, MED 420 -> 433, LOW 190 -> 209, Nominal 7.
# ⛑ **BOOTSTRAP RE-RUN AT `464c9ab4d`:** lint-no-default-arm 58 files / 0 violations · `slice-m1/` 73/73 · lowered `slice-m1/`
# 73/73 · `slice-m2/` **448/448** (7 files) · `slice-m3/` 60/60 (5 files) · `slice-m4/` **403 pass + 1 todo / 404** (16 files;
# NOW IN CI, `ci.yml:157`) · CG footprint runtime 18/0, codes-only 10/0, crashed 0, not-yet 697, front-end 475 · CSS
# footprint runtime 335/0, codes-only 280/0, CSS half 38/38.
# ⚑ `file:line` citations in S445 sections are grep-derived at `464c9ab4d`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S444b HEADER (stamp `5b1d0dab0`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S444b STAMP — `108ca89be` -> `5b1d0dab0`. 2 COMMITS (#1180, #1181), incremental refresh.** MAP-STAMP RULE at
# write time: `git log --oneline 108ca89be..5b1d0dab0` -> 2; HEAD `5b1d0dab0` == `origin/main`. Source-relevant: #1180 (S443
# example 23 end-to-end — login/register call `session.set("userId", …)`, pages read `session.userId`, logout calls
# `session.destroy()`, `<program … loginRedirect="/auth/login">`, driver BOL/POD/token reads guarded by `assignedDriverFor`,
# `dispatch.db` ships pre-seeded (the `on mount { runSeeds() }` is gone); `stdlib/auth/templates/login.scrml` now calls
# `session.set("userId", row.id)`; trucking smoke baseline drops `I-AUTH-REDIRECT-UNRESOLVED` / `W-AUTH-LOGIN-MISSING` /
# `W-CG-CHUNK-PREFETCH-UNRESOLVED`, `W-TYPE-031-UNPROVEN` 321 -> 287). #1181 is the S444 map refresh itself.
# ⛑ **`compiler/src` UNCHANGED over the window** (`git diff --stat 108ca89be..5b1d0dab0 -- compiler/src` empty) -> every S444
# figure below stands; `bun scripts/facts.ts --check` PASS at `5b1d0dab0`. Known-gaps HIGH open 214 -> 215.
# ⛑ **S444b ADDS S443 LOCI the reviews found missing** (grep-derived at `5b1d0dab0`; locate by SYMBOL after later commits):
# route-inference Step 8 table + `appRoot` / `rootCandidates` / `findRoutePrefix` (matches on the ABSOLUTE path) ->
# auth.map.md; `detectNestedProgramAuth`, E-PROGRAM-002 -> auth / error maps; `protect-flow.ts`, `emit-worker.ts`, worker
# bundle writes in `api.js`, the §47.13 static-serve allowlist in `build.js` `generateServerEntry` -> structure / build maps.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S444 HEADER (stamp `108ca89be`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S444 STAMP — `cf62b415` -> `108ca89be`. 37 COMMITS (#1141-#1179), SESSIONS S441 / S442 / S443 (incremental
# refresh, branch `maps/s444-refresh`).** MAP-STAMP RULE at write time: `git log --oneline cf62b415..108ca89be` -> 37
# commits; `git merge-base HEAD origin/main` == `origin/main` == `108ca89be` (no fork). Source-relevant: #1161 (CSRF
# `auto` by default under `auth=`; compose route gated; WebSocket Origin check), #1162 (static serving is a client-asset
# ALLOWLIST, §47.13), #1163 (async fn escaping as a value / event control after an await, S440 F4/F5), #1171
# (protected-column egress `E-PROTECT-006`, §14.8.9), #1173 (`<page auth="required">` gates its page;
# `E-PROGRAM-NESTED-AUTH`), #1177 (two top-level `<program>`s in one file = `E-PROGRAM-002`), #1174 (worker bundles
# written + served, dpa-056 D1/D2), #1172 (user enum named like a built-in error type), #1150 (E-ERROR-002 handler
# conformance), #1147 (bare `fail .Variant`), #1158 (`@cell = serverFn()` awaited in place), #1160 (self-closed non-void
# element gets an end tag), #1153 (W-LINT-007/013 inline block handlers), #1152 (stdlib http/cron doc-comment leak),
# #1155 (example 23 token guards). BOOTSTRAP: #1149 (CSS + `<theme>` T3 — `css.scrml`, `css-ingest.scrml`, CSS sub-seam),
# #1151/#1157/#1159/#1167/#1169 (typer rounds), #1164 (the §66.19 worked programs — `slice-m4/`). SPEC-only: #1156
# (tape grow/shrink, §66.x), #1170 (§4.18 dpa-045). The rest are docs / wrap / dpa-queue / gaps / ledger / @generated.
# ⛑ **FIGURES RE-EXECUTED AT `108ca89be`** (`bun scripts/facts.ts --check` -> PASS; `bun scripts/s34-census.ts`):
# version **0.8.0** (flat) · `compiler/src` **275,016 lines / 217 files** per FACTS (+6,622 lines, +4 files:
# `codegen/js-async-analysis.ts`, `codegen/protect-flow.ts`, `static-serve-policy.js`, `static-serve-policy-emitted.js`)
# · test files **1,535** (+20) · `compiler/SPEC.md` **41,214** lines (+551) · conformance **1151** cases (+97) · §34
# catalog **849** rows (+10), range `20832..21764`. `bun conformance/run.ts` (impl#1) -> **1144/1151 pass + 7 xfail**.
# Census: PINNED 370 · IMPL-SITES 314 · DECLARED-AHEAD 21 · RUNTIME-SURFACED 3 · FALSE-CLAIM 107 · STRUCK 34.
# ⛑ **PREFIX SERIES SET-DIFFED AT BOTH ENDS (`^| X-` rows):** E **952 -> 960** · W **183 -> 186** · I 10 · H 2 FLAT ·
# unique codes **807 -> 817**. **ADDED = {`E-ASYNC-CALL-PROMISE-METHOD`, `E-ASYNC-FN-ESCAPES-AS-VALUE`,
# `E-ASYNC-HANDLER-UNANALYZABLE`, `E-EVENT-CONTROL-AFTER-AWAIT`, `E-PROGRAM-002`, `E-PROGRAM-NESTED-AUTH`,
# `E-PROTECT-006`, `W-AUTH-FILE-CONFLICT`, `W-AUTH-LOGIN-REDIRECT-AMBIGUOUS`, `W-AUTH-REDIRECT-LOOP`} — every one has a
# live emitter in `compiler/src` (grep-verified); REMOVED = EMPTY.**
# ⛑ **BOOTSTRAP (`compiler/self-host-v2/`) RE-RUN AT `108ca89be` (Linux clone):** `bun scripts/lint-no-default-arm.js` ->
# **58** files, 0 violations · `slice-m1/` 73/73 · `SLICE_CORE=lowered slice-m1/` 73/73 · `slice-m2/` **443/443** (7 files)
# · `slice-m3/` **60/60** (5 files) · `slice-m4/` **130 pass + 1 todo / 131** (11 files; NOT in the CI gate — see
# build.map.md) · CG footprint (`--swap CG=…/slice-m3/substitute.js --footprint`) -> runtime **18/0**, codes-only 10/0,
# crashed 0, not-yet 666, front-end 457 · CSS footprint (`--swap CSS=…/slice-m3/css-substitute.js --footprint`) ->
# runtime 320/0, codes-only 278/0, **CSS half 38/38** (conformance 17 · source 15 · core 6).
# ⚑ `file:line` citations in S444 sections were grep-derived at `108ca89be`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S440 HEADER (stamp `cf62b415`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S440 STAMP — `fb21983a` -> `cf62b415`. 23 COMMITS (#1117-#1140), SESSIONS S438-tail / S439 / S440 (incremental
# refresh).** MAP-STAMP RULE at write time: `git log --oneline fb21983a..cf62b415` -> 23 commits; inbound `git merge-base
# --is-ancestor fb21983a cf62b415` -> 0; outbound `git merge-base --is-ancestor cf62b415 origin/main` -> 0; HEAD `cf62b415`
# == `origin/main` (`git fetch --dry-run`: main not advanced; no fork). Source-relevant: #1117 (bootstrap M3 typer + scope pass), #1118 (ingest shim + footprint
# grader + bite matrix), #1122 (analyze facts -> six NodeId-indexed family tables), #1129 (re-land #1109 review fixes +
# spread all-or-nothing `Stmt.Commit` + strict snapshot + E-BOOTSTRAP-DUP-OVERRIDE), #1125 (E-MW-007/008 refused build
# writes no dist), #1131 ("~" + 3 sibling rewrites fenced out of literals), #1137 (Date/built-ins in cells; `==` on
# built-ins), #1139 (nested async helpers vs sync-callback guards, SECURITY). SPEC-only: #1120 (S439 rulings), #1133
# (S440 rulings). The rest are wrap / inbox / dpa-queue / gaps / review / @generated bookkeeping.
# ⛑ **FIGURES RE-EXECUTED AT `cf62b415`** (`bun scripts/facts.ts --check` -> PASS; `bun scripts/s34-census.ts`):
# version **0.8.0** (flat) · `compiler/src` **268,394 lines / 213 files** per FACTS (+1,450 lines, +2 files:
# `codegen/local-async-fns.ts`, `commands/refusal-gate.js`) · test files **1,515** (+6) · `compiler/SPEC.md` **40,663**
# lines (+264) · conformance **1054** cases (+7) · §34 catalog **839** rows (+4), range `20443..21365`.
# `bun conformance/run.ts` (impl#1) -> **1047/1054 pass + 7 xfail**.
# ⛑ **PREFIX SERIES SET-DIFFED AT BOTH ENDS (`^| X-` rows):** E **948 -> 952** · W 183 · I 10 · H 2 FLAT · unique codes
# **803 -> 807**. **ADDED = {`E-CALL-ARITY`, `E-EACH-NOT-SEQUENCE`, `E-SELECT-OPTION-NOT-VARIANT`,
# `E-STRUCT-DUPLICATE-KEY`} — all four rows say "Nominal / not yet emitted" (impl pending); REMOVED = EMPTY.**
# ⛑ **BOOTSTRAP (`compiler/self-host-v2/`) RE-RUN AT `cf62b415` (Linux clone):** `bun scripts/lint-no-default-arm.js` ->
# 28 files, 0 violations · `slice-m1/` 73/73 · `SLICE_CORE=lowered slice-m1/` 73/73 · `slice-m2/` **325/325** (6 files) ·
# `slice-m3/` **24/24** (3 files) · footprint grade (`bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js
# --footprint`) -> runtime **18 pass / 0 fail**, codes-only 10/0, crashed 0, not-yet 579, front-end 447. The S438 CRLF
# drift-guard failures are gone (the guard is CRLF-safe since #1129, and this clone is LF).
# ⚑ `file:line` citations in S440 sections were grep-derived at `cf62b415`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S438 HEADER (stamp `fb21983a`), CARRIED FOR PROVENANCE. ━━━━━━━
# ⛑ **S438 STAMP — `9941a504c` -> `fb21983a`. 9 COMMITS (#1109-#1119), SESSION S438 (incremental refresh, branch
# `wrap/s438`).** MAP-STAMP RULE at write time: `git log --oneline 9941a504c..fb21983a` -> 9 commits; `git
# merge-base --is-ancestor 9941a504c fb21983a` -> exit 0 (inbound ancestor check satisfied); HEAD `fb21983a` ==
# `origin/main` at fetch (no fork this pass). Of the 9 commits, **3 are the PRIOR session's own maps/wrap
# commits** (`c65f54b4` #1111 maps-refresh-to-9941a504c, `88a75073` #1110 wrap, and the inbox commit `0fc87bf9`
# #1115 is bookkeeping only) — **6 are source-relevant**: `072741ca` #1109, `98d94e96` #1112, `b7c86323` #1113,
# `8c55f518` #1114, `afc2308b` #1116, `fb21983a` #1119.
# ⛑ **FIGURES RE-EXECUTED AT `fb21983a`** (`bun scripts/facts.ts --check` -> PASS; `bun scripts/s34-census.ts`):
# version **0.8.0** (flat — `package.json` untouched this window) · `compiler/src` **266,944 lines / 211 files**
# per FACTS (+939 lines, files FLAT vs `9941a504c`'s 266,005/211) · test files **1,509** (+3:
# `conf-SESSION-8B-DEFERS-TO-PROGRAM.test.js`, `clientjs-import-disk-rebase-gate-eq-write.test.js`,
# `match-arm-shapes-f12-f14.test.js`, all under `compiler/tests/` — `compiler/self-host-v2/slice-m2` gained 4
# more `*.test.js` OUTSIDE this count, per FACTS' own stated scope exclusion) · `compiler/SPEC.md` **40,399**
# lines (+51) · conformance **1047** cases (FLAT) · §34 catalog **835** rows (+3), range `20331..21237`.
# `bun conformance/run.ts` (impl#1) -> **1040/1047 pass + 7 xfail** — FLAT vs `9941a504c`.
# ⛑ **PREFIX SERIES SET-DIFFED AT BOTH ENDS (`^| X-` rows):** E **943 -> 948** · W 183 FLAT · I 10 FLAT · H 2
# FLAT · unique codes **800 -> 803**. **ADDED = {`E-MATCH-ALT-BINDING`, `E-SCHEMA-012`, `E-SCHEMA-013`}; REMOVED
# = EMPTY.**
# ⛑ **WINDOW HEADLINES (verify in source, not here):**
#   · **#1119** (`g-impl1-match-miscompiles` F12/F13/F14) — a `match` alternation arm (`.A | .B :> r`) is now
#     recognised at ANY arm position, not only first (`ast-builder.js` `armPatternChainArrowOffset` /
#     `scanArmPatternAlternate`; `emit-control-flow.ts` Form 0w/0/2 + `armCondition` shared by `emit-logic.ts`);
#     a NAMED-field payload arm binding 5+ fields is no longer truncated by the old 20-token paren-scan cap
#     (`scanPastBalancedParens`, and the native-parser mirror `scanPastPayloadParen`); a brace inside a CLOSED
#     quoted string on the same line no longer mis-scopes a block (`block-splitter.js`
#     `braceIsQuotedStringContent`, tokenizer-backed, cached per line). A payload-BEARING alternation
#     (a binding, a named field even when discarded, a nested/literal pattern) now FAILS CLOSED —
#     **`E-MATCH-ALT-BINDING`** — instead of silently dropping the arm or gluing it onto its neighbor.
#   · **#1116** (§39.2/§14.8.10 tenant floor) — a `<schema>` raw `CREATE TABLE` head naming a
#     schema/database-qualified table is rejected (**`E-SCHEMA-012`**); a known-kind head whose name the
#     compiler cannot read through to a follower is rejected (**`E-SCHEMA-013`**) — both were previously
#     silent, tenant-isolation-inert gaps (`schema-differ.js` `findRejectedCreateTableHeads`,
#     `gauntlet-phase1-checks.js` `<schema>` body checks).
#   · **#1114** (§20.5.1) — route-inference Step 8b (protect= auto-escalation / `<page auth="required">`) no
#     longer stamps secure session defaults that outrank a unit's OWN `<program>`'s declared session config
#     (`g-route-inference-8b-session-defaults-outrank-program-declaration`); the session-field resolution order
#     is unchanged, but Step 8b now leaves its fields undefined unless the unit itself declares them
#     (`session-config-resolve.ts` `countUnitProgramNodes`, `route-inference.ts`, `emit-server.ts` now reads the
#     ONE resolver instead of `authMiddlewareEntry.sessionExpiry` directly).
#   · **#1112** (§20.5.1) — `E-MW-008`'s program-site count no longer counts a `kind="tool"` file as a
#     competing web application (`g-mw008-counts-headless-tool-programs`; `codegen/index.ts`
#     `_collectProgramSites` now asks the emit dispatch's own `isToolProgram` per FILE, not per node).
#   · **#1113** (#1045 F1) — client JS relative-import re-basing now applied in BOTH the gate and the write
#     phase (`compiler/tests/integration/clientjs-import-disk-rebase-gate-eq-write.test.js`, NEW).
#   · **#1109** (dpa-051 bootstrap slice M2, `compiler/self-host-v2/`) — the front end (`parse.scrml` 1641L,
#     `lower.scrml` 993L NEW) proves the lowered Core EQUALS M1's hand-built oracle (Fork-A proof); `ast.scrml`
#     (175L NEW) is the parser's own AST; `core/check/print/lex/walk/measure.scrml` and
#     `slice-m1/runtime/runtime.js` all took matching edits; `slice-m2/` (16 files, harness + fixtures +
#     4 `*.test.js`) is the M2 test bed; CI `gate`'s bootstrap step now also runs `slice-m2/` and re-runs the M1
#     suite over LOWERED programs (`SLICE_CORE=lowered`).
# ⚑ **RE-RUN AT THIS SHA ON THIS (WINDOWS) CLONE:** `bun test ./compiler/self-host-v2/slice-m1/` -> 73/73 pass;
# `SLICE_CORE=lowered bun test ./compiler/self-host-v2/slice-m1/` -> 73/73 pass; `bun scripts/lint-no-default-arm.js`
# -> 26 files, 0 violations; `bun test ./compiler/self-host-v2/slice-m2/` -> **72/74 pass, 2 FAIL** — both in
# `parse.test.js`'s "the §66.19 sources are the SPEC's code blocks, verbatim (drift guard)" (`counter.scrml`,
# `lib/dropdown.scrml`+`app.scrml`), comparing a `\r\n`-checked-out fixture against a bare-`\n` SPEC extract —
# a WINDOWS-CRLF-CHECKOUT artifact of this clone (same class as the known `scrml-regen-scripts-crlf-broken-on-windows`
# pattern), NOT a landed defect and NOT reproduced by this session; see test.map.md. Not filed as a new gap (no
# code moved to cause it; a checkout-line-ending property, orthogonal to #1109's content).
# ⚑ Line 3 is parsed by `scripts/state.ts` `mapsStaleness()` (`mapText.split("\n")[2]`). Do not reformat it.
# ⚑ `file:line` citations in this S438 block were grep-derived at `fb21983a`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ EVERYTHING BELOW THIS LINE (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S437b HEADER (stamp `9941a504c`, 2026-09-27), CARRIED FOR PROVENANCE. ITS FIGURES ARE `9941a504c`-ERA. ━━━━━━━
# ⛑ **S437b STAMP — `d02738767` -> `9941a504c`. 7 COMMITS (#1102-#1108), SAME SESSION (S437, second wrap-6c pass).**
# MAP-STAMP RULE at write time: `git fetch origin && git merge --ff-only origin/main` -> HEAD **`9941a504c`** (== `origin/main` at fetch;
# `origin/main` then advanced to `072741ca9` mid-pass — see ⏳);
# inbound: `d02738767` is an ancestor of `9941a504c`. Pass ran in worktree `agent-a311ef56e25c9326a`; HEAD advances past
# the stamp only by this pass's own `.claude/maps/` commits (the stamp tracks the MERGE-BASE).
# ⛑ **FIGURES RE-EXECUTED AT `9941a504c`** (`bun scripts/facts.ts --check` -> PASS; `bun scripts/s34-census.ts`):
# version **0.8.0** (flat) · `compiler/src` **266,005 lines / 211 files** per FACTS (+790 lines, files FLAT;
# `git ls-files compiler/src | wc -l` = 213, flat) · test files **1,506** (+1) · `compiler/SPEC.md` **40,348** lines (+216) ·
# conformance **1,047** cases (+74) in **55** dirs (flat) · §34 catalog **832** rows FLAT, range `20294..21197` ·
# `docs/changes/` 777. PREFIX SERIES set-diffed at both ends: E 943 · W 183 · I 10 · H 2 · unique 800 — ADDED = REMOVED = EMPTY.
# impl#1 conformance: `bun conformance/run.ts` -> **1040/1047 pass + 7 xfail** (was 967/973 + 6 at `d02738767`).
# ⛑ **WINDOW HEADLINES (verify in source, not here):** #1106 §5.2.3 handler fix — a multi-statement handler value is PARSED
# with the function-body statement parser into `value.handlerBlock.stmts` and lowered from those nodes by every emitter;
# a BARE `;`-sequence is `E-MULTI-STATEMENT-HANDLER` in every position (incl. `<each>`/engine/`<match>` sub-builds);
# braceless `else` (`if (c) a; else b`) no longer runs `b` unconditionally; a dangling `else` after `};` is
# `E-STMT-UNEXPECTED-TOKEN`. #1105 bootstrap slice M1 — `compiler/self-host-v2/` Core IR + walk + JS/HTML trees + printer +
# checker; `slice-m1/` instance-record runtime + 68 tests; new CI step. #1104 — `compiler/self-host/` FROZEN [REMOVED S447 #1230] (reference
# only). #1107/#1108 — SPEC §66 rulings (L6, L12, identities, O57-O60, O21/O43; reads through an un-narrowed handle are
# `E-DECL-HANDLE-NOT-NARROWED`); §66 stays NOMINAL — impl#1 implements none of it.
# ⏳ **NOT MAPPED — bootstrap M2 (#1109, `072741ca9`, parse / analyze / lower) LANDED ON `origin/main` MID-PASS, AFTER
# this stamp.** It adds `compiler/self-host-v2/{parse,lower}.scrml` + `slice-m2/`, MODIFIES `core/check/print/lex/walk/measure.scrml`,
# `slice-m1/runtime/runtime.js` + its tests, and `ci.yml` (+7/-). This map is deliberately stamped `9941a504c` (the brief's
# target); `state.ts` will read it 1 commit behind until the next refresh maps M2.
# ⚑ Line 3 is parsed by `scripts/state.ts` `mapsStaleness()` (`mapText.split("\n")[2]`). Do not reformat it.
# ⚑ `file:line` citations in this S437b block were grep-derived at `9941a504c`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ EVERYTHING BELOW THIS LINE (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S437 HEADER (stamp `d02738767`, 2026-09-27 AM), CARRIED FOR PROVENANCE. ITS FIGURES ARE `d02738767`-ERA. ━━━━━━━
# ⛑ **S437 STAMP — `787d4cb4` -> `d02738767`. 100 COMMITS (#987-#1101), SESSIONS S422-S436. NOT A ZERO-DIFF WINDOW:
# `compiler/src` GAINED 16 FILES — THE FIRST FILE-COUNT MOVEMENT IN FIVE WINDOWS.** MAP-STAMP RULE, executed at write time:
# `git fetch origin && git merge-base HEAD origin/main` -> **`d02738767`** (== `origin/main`); inbound
# `git merge-base --is-ancestor 787d4cb4 d02738767` -> **exit 0**. Pass ran in worktree `agent-a081239793c7872e1`;
# `HEAD` advances past the stamp only by this pass's own `.claude/maps/` commits (the stamp tracks the MERGE-BASE).
# ⛑ **FIGURES RE-EXECUTED AT `d02738767`** (`bun scripts/facts.ts --check` -> PASS; `bun scripts/s34-census.ts`):
# version **0.8.0** (was 0.7.1 — `8cd1e0223` #1099, "the impl#1 floor tag") · `compiler/src` **265,215 lines / 211 files**
# per FACTS (+11,696 lines, +16 files; `git ls-files compiler/src | wc -l` = 213, 197 at `787d4cb4` — same +16) ·
# test files **1,505** (+46) · `compiler/SPEC.md` **40,132** lines (+2,139) · conformance **973** cases (+68) in **55**
# category dirs (+1: `defer/`, 44 cases) · §34 catalog **832** rows (+13), range `20294..21197` · `docs/changes/` 775.
# ⛑ **PREFIX SERIES SET-DIFFED (`^| X-` rows, both ends):** E **922 -> 943** · W **182 -> 183** · I 10 · H 2 · unique
# **787 -> 800**. ADDED = {`E-CLASS-NOT-IN-SCRML`, `E-DYNAMIC-IMPORT-NOT-IN-SCRML`, `E-DEFER-CONTROL-FLOW`,
# `E-DEFER-DUPLICATE-FUNCTION`, `E-DEFER-LATER-SHADOW`, `E-DEFER-NESTED`, `E-DEFER-OUTSIDE-FUNCTION`,
# `E-DEFER-SERVER-IN-SPLIT`, `E-DEFER-UNHANDLED-FAILABLE`, `E-DEFER-UNSUPPORTED-SITE`, `E-MW-008`, `E-SCOPE-REDECLARE`,
# `W-ENGINE-MATCH-IN-STATE-CHILD`}; REMOVED = EMPTY.
# ⛔ **N-S405-1 STILL LIVE, SIX SESSIONS ON:** `E-CG-ENUM-BINDING-COLLISION` (`codegen/emit-library.ts:1517`) and
# `E-CG-SQL-FN-UNVERIFIABLE-SPAN` (`:713`) still have **0** mentions in `compiler/SPEC.md` (`grep -c` re-run).
# ⛑ **THE LANGUAGE-LEVEL HEADLINES OF THE WINDOW (verify in SPEC, not here):** `defer` (§19.16) shipped in impl#1;
# `class` and dynamic `import(...)` are not scrml (§7.2.1 / §21.3.2); `import:host` (§21.3.1 + manifest §22.13) built;
# L19 REVERSED — inline block handlers `onclick={ a; b }` legal and canonical (§5.2.3, S435); **§66 Declarations,
# Instances, and Value Contracts added as NOMINAL / SPEC-AHEAD — impl#1 does NOT implement it** (§66 banner at
# `SPEC.md:38624`); the TS compiler is fixed "only for cause" (bootstrap-blocking / adopter-reported / security), every
# other divergence is `status=carried` + a conformance `xfail` (S430 P7). impl#1 conformance at this SHA:
# `bun conformance/run.ts` -> **967/973 pass + 6 xfail**.
# ⚑ Line 3 is parsed by `scripts/state.ts` `mapsStaleness()` (`mapText.split("\n")[2]`, re-read at `:795`). Do not reformat it.
# ⚑ `file:line` citations in this S437 block were re-derived by grep at `d02738767`; locate by SYMBOL after any later commit.
#
# ━━━━━━━ S437 CONFIG DELTA ━━━━━━━
# NOT a zero-diff row: a NEW repo-root config file, `scrml.toml` (the §22.13 manifest), and `package.json` version
# 0.7.1 -> 0.8.0. `bun.lock`, `bunfig.toml`, `tsconfig.json`: `--name-only` EMPTY. Env vars: the added lines of
# `git diff 787d4cb4..HEAD -- compiler/src scripts lsp conformance` contain **zero** new `process.env.` / `Bun.env.`
# reads. New compile OPTIONS (API, not env): `stageOverrides` (`api.js` `compileScrml`), `_secretRedactor` (internal).
#
# ━━━━━━━ EVERYTHING BELOW THIS LINE (TO THE FIRST `##` SECTION) IS THE SUPERSEDED S422 HEADER (stamp `787d4cb4`, 2026-09-18), CARRIED FOR PROVENANCE. ITS FIGURES ARE S422-ERA. ━━━━━━━
# ⛑ **S422 STAMP — `e74f5423` -> `787d4cb4`. THE LONGEST STALE WINDOW THIS FILE HAS EVER CARRIED:
# 112 COMMITS AND FOUR SESSIONS (S417-S421 ran no wrap-6c).** MAP-STAMP RULE, all three commands
# executed at write time, not carried:
# `BASE=$(git merge-base HEAD origin/main)` -> **`787d4cb4`** (== `origin/main` exactly);
# `git diff --name-only BASE..HEAD -- compiler/ scripts/ conformance/ stdlib/ lsp/ .github/
# package.json` -> **EMPTY**; `git merge-base --is-ancestor 787d4cb4 origin/main` -> **exit 0**.
# Inbound (invariant 48): `git merge-base --is-ancestor e74f5423 787d4cb4` -> **exit 0**.
# ⚠ **`HEAD` IS NOT THE STAMP.** This pass ran in worktree `agent-a83548a63b17c0d54` on branch
# `worktree-agent-a83548a63b17c0d54` and COMMITS ITSELF, so `HEAD` advances past the stamp by this
# pass's own maps-and-progress commits. The stamp tracks the MERGE-BASE deliberately: stamping a
# branch tip is the S326/S328/S331 orphaning hazard, because the tip squash-merges onto `main` under
# a DIFFERENT SHA and the stamp is then orphaned.
#
# ⛑ **THIS WINDOW IS NOT A ZERO-DIFF WINDOW, AND THAT IS THE HEADLINE.** Four of the last five
# stamps were advanced on a VERIFIED-EMPTY source diff. This one is not: `e74f5423..787d4cb4` is
# **112 commits / 53 source-relevant files / +7,543 / -428**, with **`compiler/src` itself at 12
# files, +1,195 / -79**. Every figure in this file was re-derived; nothing was carried on the
# assumption that a flat count stays flat.
#
# ⛑ **RE-EXECUTED AT `787d4cb4` — FACTS, the raw walks and the census agree on every figure:**
# `compiler/src` **253,519 lines / 195 files** (**+1,116 lines; files FLAT for the 4th consecutive
# window**) · `test files` **1,459** (**+19**) · `specification lines` **37,993** (**+46**) ·
# `conformance cases` **905** (**FLAT**, still **54** category dirs) · `docs/changes/` **745** (+11).
# §34 catalog **819** rows (`19750..20640`) by `bun scripts/s34-census.ts`, **+1**.
# ⛑ **PREFIX SERIES MEASURED AT BOTH ENDS AND SET-DIFFED:** `^| E-` **921 -> 922**, `^| W-` **182
# FLAT**, `^| I-` **10 FLAT**, `^| H-` **2 FLAT**; UNIQUE codes **786 -> 787**;
# **ADDED = {`E-CONDITION-HEAD-UNPARENTHESIZED`}, REMOVED = EMPTY.**
#
# ⛔ **N-S405-1 IS STILL LIVE, UNREMEDIATED, FOUR SESSIONS ON — AND IT SURVIVED A WINDOW THAT
# REWROTE ITS OWN FILE.** `E-CG-ENUM-BINDING-COLLISION` (emitter `compiler/src/codegen/emit-library.ts:1517`)
# and `E-CG-SQL-FN-UNVERIFIABLE-SPAN` (emitter `:713`, referenced `:1255`) still have **ZERO mentions
# in `compiler/SPEC.md`** — no catalog row, no index row, nothing. `emit-library.ts` took **+400
# lines this window** and neither code was documented on the way past. They are invisible to every
# count above, because every count above derives from SPEC.
#
# ⚑ **RE-DERIVE, DO NOT CARRY, ANY `file:line` IN THIS FILE.** This pass re-derived the prior
# report's own `postRe` CORRECTION and found it had itself gone stale: the correction published
# `:27224 / :28162 / :28287`; at this HEAD `grep -n 'const postRe' compiler/src/type-system.ts`
# returns **`:27384`, `:28322`, `:28447`**. A citation that was right when written, and a
# correction to it that was right when written, are both wrong now. Locate by SYMBOL.
#
# ━━━━━━━ S422 CONFIG DELTA — **A GENUINE ZERO-DIFF SURFACE, AND THE ZERO IS FOUR COMMANDS.** ━━━━━━━
#
# ⛑ **COMMANDS RE-RUN AT WRITE TIME, over the full 112-commit window `e74f5423..787d4cb4`:**
#   - `git diff --name-only e74f5423..HEAD -- package.json bun.lock bunfig.toml` -> **EMPTY**
#   - `git diff --name-only e74f5423..HEAD -- '*.json'` -> **EMPTY** ⚑ **STRICTLY EMPTIER THAN S405**,
#     which returned ten `conformance/cases/protect/*/expected.json` fixtures. Not one JSON file in
#     the repo changed in 112 commits.
#   - `git diff --name-only e74f5423..HEAD -- '*.toml' '*.yml' '*.yaml'` -> **`.github/workflows/ci.yml`
#     ONLY** — a CI workflow, which belongs to `build.map.md`, not to this map. No `bunfig.toml`, no
#     `tsconfig.json`.
#   - `git diff e74f5423..HEAD -- compiler/src/ scripts/` filtered for `process.env` / `Bun.env` /
#     `SCRML_[A-Z_]+` on ADDED lines -> **EMPTY**. No new environment variable is read anywhere in
#     the compiler or the script surface.
# **No environment variable, feature flag, `compilerSettings` knob or config file changed in this
# window.** The Environment Variables, Feature Flags and Config Files sections below are carried
# UNCHANGED, on a measured zero rather than on memory.
#
# ⚠ **A ZERO-DIFF SURFACE IS AN UNCHANGED MAP, NOT A VERIFIED-CORRECT ONE.** Nothing in this pass
# re-read the listed keys against their definitions; it established only that they did not move. A
# key that was mis-described at S405 is still mis-described here. **The standing rule holds: this map
# lists key NAMES only — never a value, never a secret, never a token.**
#
# ⚑ **THE `Symbol.for("scrml.protect.mediated")` NOTE BELOW IS STILL CURRENT AND STILL NOT CONFIG.**
# Re-checked: `compiler/src/codegen/protect-egress.ts` is `--name-only` EMPTY over this window, so the
# §14.8.9 mediation mark and its sibling `Symbol.for("scrml.protect.origin")` are byte-unchanged. They
# remain compile-time literals in the EMITTED runtime — nothing reads them from the environment and
# nothing can turn them off. **They do not belong in Environment Variables or Feature Flags.**
#
# ━━━━━━━ EVERYTHING BELOW THIS LINE IS THE SUPERSEDED S405 HEADER, CARRIED FOR PROVENANCE. ━━━━━━━
# ⚠ Its stamp line read: `updated: 2026-09-08T05:00:00Z  commit: e74f5423`. Figures in it are S405-era.
# ⛑ **S405 STAMP — `68cfac6d` -> `e74f5423`.** `merge-base HEAD origin/main` == `origin/main` ==
# **`e74f5423`**. ⚠ **`HEAD` IS *NOT* THE STAMP THIS PASS.** It advanced to `e6b8fc77` mid-pass — a
# LOCAL, UNPUSHED, docs-only wrap commit on branch `wrap/s405`
# (`git diff --name-only e74f5423..e6b8fc77 -- compiler/ scripts/ conformance/ stdlib/ lsp/ .github/
# package.json` -> **EMPTY**). The stamp deliberately tracks the MERGE-BASE, not a branch tip:
# stamping an unpushed tip is the S326/S328/S331 orphaning hazard, because the tip squash-merges onto
# `main` under a DIFFERENT SHA. MAP-STAMP RULE, all three commands:
# `BASE=$(git merge-base HEAD origin/main)` -> `e74f5423`; `git diff --name-only BASE..HEAD --
# compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json` -> **EMPTY**;
# `git merge-base --is-ancestor e74f5423 origin/main` -> **exit 0**. Inbound (invariant 48):
# `git merge-base --is-ancestor 68cfac6d e74f5423` -> **exit 0**.
#
# ━━━━━━━ S405 wrap-6c — **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF, AND THE ZERO IS A GREP PLUS A FILE LIST.** ━━━━━━━
#
# ⛑ **COMMANDS, RE-RUN AT WRITE TIME:** `git diff --name-only 68cfac6d..e74f5423 -- package.json
# bun.lock bunfig.toml tsconfig.json '*.toml'` -> **EMPTY**. `git diff --name-only 68cfac6d..e74f5423
# -- '*.json'` returns **ten paths and every one is a `conformance/cases/protect/*/expected.json`
# conformance fixture** — which carries expected DIAGNOSTICS, not a config key. **No environment
# variable, feature flag, `compilerSettings` knob or config file changed in this window.**
# ⚠ **A ZERO-DIFF SURFACE IS AN UNCHANGED MAP, NOT A CORRECT ONE.**
#
# ⚑ **ONE NEW COMPILE-TIME CONSTANT IN THE EMITTED SERVER IS WORTH KNOWING ABOUT HERE, BECAUSE IT
# LOOKS LIKE CONFIG AND IS NOT: `Symbol.for("scrml.protect.mediated")`** — the §14.8.9 mediation mark
# (`compiler/src/codegen/protect-egress.ts:245`, read at `emit-server.ts:1948`/`:1957`). It is a **registry
# Symbol, not a setting**: nothing reads it from the environment, nothing can turn it off, and it is
# emitted only when `_protectActive` (gated at `emit-server.ts:4436` precisely so a `protect=`-free
# app stays byte-unchanged). Its sibling is `Symbol.for("scrml.protect.origin")`. **Neither belongs in
# Environment Variables or Feature Flags; both are compile-time literals in the emitted runtime.**
#
# generated-at: 68cfac6d — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** At this watermark
# `merge-base HEAD origin/main` == `origin/main` == `HEAD` == **`68cfac6d`**. This pass ran in the
# MAIN checkout on branch `wrap/s404` and does NOT commit itself, so no self-commit advances `HEAD`
# past the stamp. MAP-STAMP RULE, all three commands: `BASE=$(git merge-base HEAD origin/main)` ->
# `68cfac6d`; `git diff --name-only BASE..HEAD -- compiler/ scripts/ conformance/ stdlib/ lsp/
# .github/ package.json` -> **EMPTY**; `git merge-base --is-ancestor 68cfac6d origin/main` -> exit 0.
# Inbound (invariant 48): `git merge-base --is-ancestor 499eecce 68cfac6d` -> exit 0.
#
# ━━━━━━━ S404 wrap-6c — **STAMP ADVANCED. `499eecce` -> `68cfac6d`.** ━━━━━━━
#
# ⛑ **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF, AND THE ZERO IS A GREP OVER THE DIFF, NOT A FILE LIST
# — which is the stronger test for this map.** Command:
# `git diff 499eecce..68cfac6d -- compiler/ scripts/ .github/ | grep -cE '^[+-].*(process\.env|Bun\.env)'`
# -> **0**. No environment key was added, removed, or newly read anywhere in the window — INCLUDING in
# the 1,650-line new `scripts/int-number-census.ts`, which takes all of its configuration from
# `process.argv` flags (`--summary` / `--json` / `--roots=` / `--selftest`) and reads no env at all.
# `.env*`, `bunfig.toml`, `package.json` and `tsconfig.json` are all `--name-only` EMPTY.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# ⚠ **THE WINDOW IS FOUR SESSIONS WIDE, NOT ONE** — `10a4b045..499eecce` is **36 commits, PRs
# #835-#872** (S399 · S400 · S400-peter · S401 · S402). The prior stamp is 4 sessions behind because
# S398-S401 did not fire a wrap-6c. Per-file attribution is in `primary.map.md`'s header.
#
# **THIS MAP:** **NOT a zero-diff row.** `git diff --name-only 10a4b045..499eecce -- package.json bunfig.toml tsconfig.json '.env*'` returns `package.json` ONLY, and **no env var, feature flag or config KEY moved** — but the `scripts.bench` VALUE did: `compile samples/compilation-tests/ --timing` -> `compile examples/ --verbose` (#853, `1e69d3b2`). `version` is FLAT at `0.7.1`. `bunfig.toml` · `tsconfig.json` · `.env*` all EMPTY.
#
# ━━━━━━━ S397 wrap-6c — **STAMP ADVANCED. `8e278c73` -> `10a4b045`.** ━━━━━━━
#
# **THE WATERMARK AND THE WALKED WINDOW END AT THE SAME COMMIT.** The source delta walked is
# `8e278c73..10a4b045` (10 commits, PRs #825-#834, ONE operator), and `10a4b045` is the merge-base
# AND `origin/main` — unlike S395 (stamp vs unpushed branch tip) and S396 (watermark ahead of the
# last source-bearing commit). ⚠ **This pass's OWN commit then advances `HEAD` past the watermark,
# exactly as every pass's does; see the note above line 14. That is the rule working, not a gap.**
#
# **THE COMPLETE SOURCE DELTA WAS WALKED — the partial-pass rule is SATISFIED, not waived.**
# `git diff --name-only 8e278c73..10a4b045` over `compiler/src` · `compiler/native-parser` ·
# `stdlib` · `scripts` · `lsp` · `conformance` is **FOUR `compiler/src` files and they are all in
# `codegen/`**, every one read in full, plus 8 conformance files (4 NEW cases):
#   · `compiler/src/codegen/emit-logic.ts`  (+371/-63) — **#830** (`8d3c7936`) the §32.2.1 WRITE half
#   · `compiler/src/codegen/emit-expr.ts`   (+166/-16) — **#832** (`c11db440`) the fail-closed `~` floor
#   · `compiler/src/codegen/index.ts`       (+38)      — **#832** the sink's reset + TWO drains
#   · `compiler/src/codegen/log-loc.ts`     (+32)      — **#832** `resolveSpanLineCol` (NEW export)
# `.github/` · `scripts/` · `stdlib/` · `lsp/` · `package.json` · `bun.lock` · `compiler/native-parser/`
# are all `--name-only` **EMPTY**. `compiler/src/types/` EMPTY for the FIFTEENTH window.
# `compiler/SPEC.md` **37,647 -> 37,798 (+151)**; `SPEC-INDEX.md` re-generated.
#
# ⛑ **THE HEADLINE FINDING IS A ROUTER HOLE, AND IT WAS MEASURED BY THREE DISPATCHES FAILING THE SAME
# WAY.** Three separate S397 dispatches working the `~` / §32 surface reported that
# `primary.map.md` gave them **no routing**. A fourth falsified the STRONGER version of that claim:
# `domain.map.md` carries **17** `~`/§32 hits and always did. So the real defect was narrower and
# worse — **the material existed and the ROUTER could not reach it.** `primary.map.md` now carries a
# `~`/§32 Task-Shape Routing row, and it splits the surface into **THREE AXES** because conflating
# two of them cost this session a wrong-locus round. See that row before touching anything `~`.
#
# ⚑ **TWO STANDING TRAPS ON THIS SURFACE, BOTH RE-VERIFIED BY EXECUTION AT THIS WATERMARK:**
#   (1) **`E-TILDE-001` / `E-TILDE-002` CANNOT FIRE.** The `tilde-init` / `tilde-ref` node kinds have
#       **FOUR consumers** in `type-system.ts` (`:18426` comment · `:18435` · `:18744` · `:18750`) and
#       **ZERO producers** anywhere in `compiler/src/` or `compiler/native-parser/` — measured, the
#       grep returns exactly those four lines and nothing else. The apparent producers are hand-built
#       object literals in `compiler/tests/unit/type-system.test.js:1751+`. Any §32 reasoning that
#       assumes enforcement is reasoning about a checker that does not run.
#   (2) **scrml's AST has NO UNIFORM BINDER REPRESENTATION**, and `ast-builder.js` builds most of it
#       with ES6 SHORTHAND so a regex keyed on `field:` cannot see it. Details in schema.map.md.
#
# ⚑ **S397 — A BRIEFED PREMISE WAS FALSIFIED *BY THE WINDOW IT DESCRIBED*, WHICH IS A DIFFERENT
# FAILURE FROM THE S396 ONE TWO BANNERS DOWN (that one was wrong when written; this one WENT wrong).**
# The dispatching brief said SPEC's verbatim INVALID §32 examples "all compile at exit 0". **FALSIFIED BY EXECUTION
# at this watermark:** §32.5's own `${ process(~) }` now compiles to **exit 1** with
# `E-CG-TILDE-UNRESOLVED` at a CORRECT `1:11`. The premise was true at `8e278c73` and #832 changed it.
# What survives is the sharper statement: the code that fires is the CODEGEN floor, not the §32.5
# TYPE-SYSTEM code the SPEC names — so `g-tilde-lin-enforcement-does-not-fire-on-spec-own-examples`
# is now PARTIALLY overtaken and its "ZERO diagnostics" headline is stale for at least that probe.
#
#
# ━━━━━━━ S396 wrap-6c — **STAMP ADVANCED. `ad7b65dc` -> `8e278c73`.** ━━━━━━━
#
# ⚠ **TWO SHAs, AND THE DISTINCTION IS LOAD-BEARING — DO NOT COLLAPSE THEM.** The **SOURCE DELTA**
# this pass walked is `ad7b65dc..2d8dd8cb` (7 commits, 4 changed source files). The **WATERMARK** is
# `8e278c73`, which is further along: `2d8dd8cb..8e278c73` is the wrap commit (#824) and is
# `--name-only` **EMPTY** over `compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json`.
# Every measurement below therefore holds at the watermark unchanged — the stamp is advanced to the
# CURRENT `origin/main` rather than left on the last source-bearing commit, because the MAP-STAMP
# RULE takes the merge-base, not the last interesting commit.
#
# **THE COMPLETE SOURCE DELTA WAS WALKED, SO THE PARTIAL-PASS RULE IS SATISFIED RATHER THAN WAIVED.**
# `git diff --name-only ad7b65dc..2d8dd8cb` over `compiler/src` · `compiler/native-parser` · `stdlib` ·
# `scripts` · `lsp` · `conformance` is **FOUR source files**, and every one was read in full:
#   · `compiler/src/route-inference.ts` + `compiler/src/codegen/collect.ts` — **#818** (`c4c55c50`)
#   · `conformance/normalize.ts` — **#822** (`ae2741e7`)
#   · `compiler/src/commands/dev.js` — **#823** (`2d8dd8cb`)
# Also in the window: 3 test files changed, **2 NEW conformance cases**, and `docs/FACTS.md`.
# `.github/` is `--name-only` **EMPTY**, so `ci.yml` is byte-identical and the blocking `gate` job is
# FLAT at **14 total steps (12 `- name:` + 2 `- uses:`)** — stated both ways deliberately, because
# "14" and "12" are each correct under a different counting base and a bare number invites the
# ambiguity. Re-counted at this SHA by parse, not carried.
#
# **NO CONFIG-KEY CHANGE THIS WINDOW.** No `.env` template, no `package.json`, and no `config.*` module
# changed between `ad7b65dc` and `2d8dd8cb`. Carried forward VERIFIED-UNCHANGED.
#

No `.env.example` or `.env.template` in the repo. No `.env*` files were read (per config-map policy, `.env*` files other than `.env.example`/`.env.template` are never read by this mapper).

**Re-verified at `e80b692e` (S313)** by re-enumerating every `process.env.*` / `Bun.env.*` reference across `compiler/src`, `lsp`, `scripts` and `e2e`. **The compiler-side set is UNCHANGED across five sessions** — every landing in this window was compiler source, spec, CI or docs; none introduced or removed a configuration key. The CI-secret table at the bottom is the only part of this map that moved.

## S457 — CONFIG DELTA (`ba2712973..125486345`)

No new env var, flag or config key (grep of `process.env.` additions in the `compiler/src` diff: 0). New compile-API result field `artifactsWritten` (schema.map.md `## S457`); new `validateEmittedArtifact` option `checkPlaceholders` (internal, default on).

## S456 — CONFIG DELTA (`9c556dc74..ba2712973`)
- No new environment variable, feature flag or config file.
- Non-configurable constants emitted into `_server.js` (`commands/build.js`): `_SCRML_TENANT_CHECK_TIMEOUT_MS` (10 s), re-check backoff 1 s -> 30 s.

## S455 — CONFIG DELTA (`f38697900..9c556dc74`)

No new environment variable, feature flag, or config file (grep of the `compiler/src` diff: `SCRML_DATA_DIR` appears only in a comment in `api.js`). New compile-time constants (NOT configurable): `HOIST_KEY_ALIAS = "__scrml_batch_key"` (`batch-planner.ts:493`), `FOREIGN_SEAL_FN = "_scrml_foreign_seal"` (`codegen/foreign-seal.ts:59`), `COMPILATION_TENANT_KEY = "_scrmlCompilationTenant"` (`codegen/tenant-egress.ts:360`).

## S454 — CONFIG DELTA (`7ce905ac2..f38697900`)

- No new environment variable in `compiler/src`, `scripts/` or `lsp/` (grep of `process.env.` added lines in the
  window: none).
- Compile-time / runtime constants that look like config but are NOT configurable:
  `SERVER_CALL_DEADLINE_MS = 30000` (bootstrap runtime `compiler/self-host-v2/slice-m1/runtime/runtime.js:1988`;
  its own comment calls the value a PLACEHOLDER pending a ruling); `RESERVED_NAME_PREFIX = "_scrml_"`
  (`validators/reserved-prefix.ts:74`); `SQL_ATTEMPT_FN = "_scrml_sql_attempt"` (`codegen/sql-attempt.ts:29`).
- `scripts/merge-on-green.sh` flags: `--dry-run`, `--squash|--merge|--rebase`, `--base <branch>` (default `main`).
- CI: no new secret.

## S452-WRAP — CONFIG DELTA (`fd2f757d0..7ce905ac2`)

SCRML_BOOT_DIAG_LOG — optional, test-only — when set, `compiler/self-host-v2/slice-m1/harness.js:125` wraps the bootstrap `analyze` and appends every call's diagnostics to the named file (consumed by `slice-m4/diag-diff.js`).

`scrml fix` rule-set keys: `IMPL1_SAFE_RULES` (default) now includes `arm-pipe`; `S66_RULES` includes `arm-pipe`; `bootstrap-conformance.ts` `TWIN_RULES` excludes it. No app-facing env var or `<program>` attribute added.

## S453 — CONFIG DELTA (`d3e660a08..fd2f757d0`)

**ZERO new environment variables.** Re-measured: the window's `compiler/src` + `scripts` diff adds no
`process.env.*` and no `Bun.env.*` read (`git diff d3e660a08..HEAD -- compiler/src scripts | grep -oE
'process\.env\.[A-Z_]+|Bun\.env\.[A-Z_]+'` returns NOTHING). `.env.example` is untouched. No new feature flag, no
new `scrml.toml` key, no new `<program>` attribute.

New CLI / script surface (flags only — no values anywhere in this map):

| entry point | flags | notes |
|---|---|---|
| `bun scripts/gen-bootstrap-severity.ts` | (default = `--write` behaviour) · `--check` | NEW (#1270). `--check` reports staleness of the GENERATED `compiler/self-host-v2/severity.scrml` and runs in CI's NON-blocking `tracking` job. Staleness is tracked, not gated: a docs-only §34 row addition for a code the bootstrap already names at the same severity makes the file stale without changing any answer. The SEMANTIC check (compiled `severityOf` == §34) is `slice-m4/severity.test.js` |
| `bun scripts/s34-catalog.ts` | — (a library, not a CLI) | NEW (#1270). Exports the §34 row parser (`S34Row`, `compileSeverityOf`); imported by `s34-census.ts` and `gen-bootstrap-severity.ts`. No hardcoded §34 line numbers — the range comes from the `## 34.` / `## 35.` headings |
| `bun scripts/bootstrap-conformance.ts` | `--write` · `--check` · `--no-twins` | CHANGED (#1279): the counter now grades ONLY **Error**-severity parse diagnostics as rejections. A Warning/Info parse diagnostic (`W-ARM-PIPE-LEGACY` being the first) means the parser KNEW the form, so the case is no longer bucketed as a parse-reject |

⛑ `transaction {}` behaviour has NO config axis: the `<program transactions=>` attribute (S449, §19.10.6) governs
the per-handle GUARD, not the `transaction {}` block's rollback — #1286's `finally` backstop is unconditional.

⚠ Generated-artifact currency at this watermark: `docs/bootstrap-conformance.md` is **STALE** (`--check` fails) and
`master-list.md`'s `@generated:recent-sessions` is **STALE** (`state.ts --check`). `docs/known-gaps.md`
`@generated:gap-counts` and `docs/FACTS.md` both PASS. See non-compliance.report.md.

## S451 — CONFIG DELTA (`47c863556..d3e660a08`)

Environment variables: **0 new** (`git diff` adds no `process.env.` / `Bun.env.` reads in `compiler/src`, `scripts`, `self-host-v2`).
CLI flags added — `scrml fix <file|dir>`: `--dry-run`, `--check` (exit 1 would-change / 2 reported-untouched / 0), `--s66`,
`--write` (with `--s66`), `--entry`, `--no-program-wrap`, `--rules=<a,b,...>`, `--json`, `--help`.
`scripts/bootstrap-conformance.ts`: + `--no-twins` (grade legacy cases as written; `--write`/`--check` refuse it).
Per-case config: `conformance/cases/**/dialect.s66` overrides the generated §66 twin.
Source attributes (SPEC, S451): `<program>` whose single direct-child `<db src=>` supplies its database (#1267; impl#1
already compiled it); bootstrap `persist=` (`local` / `session`, `key=` required — E-PERSIST-KEY-REQUIRED) — bootstrap only.

## S449-WRAP — CONFIG DELTA (`9bafb927..47c863556`)

**Runtime env vars: none added.** New program-level knob (source attribute, not env):
- `<program transactions="serialized"|"concurrent">` — §19.10.6. Default `serialized` (one transaction at a time per
  handle). `concurrent` = Postgres / MySQL only (a reserved pool connection per transaction); on SQLite → `E-SQL-010`.
  Read off the SAME node that declares the default `_scrml_sql` database (`db-ownership.ts` `fileDefaultDbDecl`).
  ⚠ Spelling + value names are a SPEC "PA reading, open to bryan's veto" (`SPEC.md:17934`).

**Test-only env:** `SCRML_PGTEST=0` disables `integration/sql-shared-connection-tx-pg.test.js`; otherwise it runs only when
`/var/run/postgresql/.s.PGSQL.5432` exists; `PGUSER` / `USER` pick the role.

**Script flags (`scripts/bootstrap-conformance.ts`):** `--filter <s>`, `--cases <dir>`, `--json <path>`, `--write`,
`--check`, `--fail-on-fail`.


## S450 — CONFIG DELTA (`6a592ed5c..9bafb927`)

- **NEW env var `SCRML_HOST`** — optional — read by the GENERATED headless serve-target server (§64.9, #1241), not by
  the compiler: `codegen/emit-tool.ts:74` `SERVE_HOST_ENV = "SCRML_HOST"`, emitted as
  `_scrml_bind.host(process.env.SCRML_HOST)` (`emit-tool.ts:944`). Unset -> loopback (`127.0.0.1` + `::1` twin);
  `0.0.0.0` = every interface. Validated like `scrml dev/serve --host`: whitespace/control chars, legacy numeric IPv4
  shorthand and empty are refused (exit 1, stderr). Production `Bun.serve` stays all-interfaces.
- `SCRML_DATA_DIR` (S446) — unchanged key; #1233 tightens the emitted containment check (unresolvable symlink = outside,
  refused; mkdir failures become scrml errors naming the path).
- `SCRML_PROTECT_FLOW_DEBUG` — pre-existing debug-only flag in `codegen/protect-flow.ts` (now 2 read sites: 1334, 2054).
- **CLI flag RETIRED:** `--parser` / `--parser=scrml-native` -> hard error, exit 1 (`commands/compile.js`).
- Session store (emitted, not configurable): `PRAGMA busy_timeout` (`SQLITE_BUSY_TIMEOUT_MS`) then `journal_mode = WAL`,
  each in its own try (`codegen/session-store-emit.ts`, #1234).
- `csrf="auto"` now also gates the session DESTROY route (#1234); `csrf="off"` stays ungated.


## S447 — CONFIG DELTA (`78e4ddad..6a592ed5c`)
- **NEW test-only env var `SCRML_TEST_TMP_BASE`** — optional; read by `compiler/tests/helpers/tmp-root-preload.js`.
  Base dir for per-process test temp roots; default `${XDG_CACHE_HOME:-~/.cache}/scrml-test-tmp`. Must not sit inside a
  git repo or under a `scrml.toml` (else falls back). The preload also reads `XDG_CACHE_HOME` and SETS
  `TMPDIR`/`TEMP`/`TMP` for the test process and its children.
- **`bunfig.toml` `[test] preload`** — NEW key (value: the preload path above). `root = "compiler/tests/"` and the
  deliberate no-`timeout` rule are unchanged.
- **`scrml dev` app-child config file** gains a `parentPid` field (written by the parent, read by the child's orphan
  guard) — internal, not author-facing.
- `compiler/tests/parser-conformance-within-node-allowlist.json` — the 11 `compiler/self-host/*.scrml` keys removed
  (#1230); self-host-v2 is in the corpus with `driftGated: false`, so it has no per-file pins.
- No production/runtime env var added. `SCRML_DATA_DIR` (S446) unchanged.

## S446 — CONFIG DELTA (`464c9ab4d..78e4ddad`)
- **NEW environment variable `SCRML_DATA_DIR`** — optional. The runtime data root SQLite file-database paths
  resolve against (SPEC §47.14); unset, the recorded project root is used. Read only by the EMITTED server /
  runtime (`codegen/sqlite-file-target.ts` `runtimeDbPath`), never at compile time. `scrml dev` deliberately IGNORES
  it (opens beside the declaring `.scrml`) and says so + unsets it before any server module loads if it finds it set
  in its own environment. The docker / fly / render adapters in `commands/build.js` set it to `/data` on a mounted
  volume; railway prints the instruction instead (no programmatic volume API). Not in `.env.example` /
  `.env.template` (verified zero-diff this window) — it is a deploy/runtime knob, not an authored app secret.
- **NEW CLI flag (not an env var) `--host` / `--host=<addr>`** on `scrml dev` and `scrml serve`
  (`compiler/src/commands/listen.js` `parseHostFlag`). Bare `--host` = `0.0.0.0` (every interface, Vite's
  convention); omitted, the new default is `127.0.0.1` (was every interface before #1207).
- No new `.env.example` / `.env.template` keys, no `package.json` change, no new feature-flag constant this window
  (`git diff --name-only` confirms `package.json`, `.env.example` empty over the range).

## S445 — CONFIG DELTA (`5b1d0dab0..464c9ab4d`)
- `compiler/src/unit-cc-exemption-list.json` — **DELETED** (#1196); its loader `default-logic-exemption.ts` is gone too. The
  `### compiler/src/unit-cc-exemption-list.json` entry below is SUPERSEDED.
- New compile option: `compileScrml({ buildRoot })` (`compiler/src/api.js:785` doc, `:2233` resolve) — the build root for
  route-file classification. No CLI flag passes it (grep `compiler/src/commands`, `compiler/bin` -> none); the CLI path infers it.
- No new environment variables. Test constant `PG_HOOK_TIMEOUT_MS` (120 s) in the three live-PG integration tests.

## S444 — CONFIG DELTA (`cf62b415..108ca89be`)

### Environment Variables
`SCRML_PROTECT_FLOW_DEBUG` — optional — NEW (#1171): when set, `codegen/protect-flow.ts` prints protect-flow analysis
debug output. No other new `process.env.*` read on added lines in `compiler/src`, `scripts/`, `conformance/run.ts`.

### Generated build artifact (not user config)
`.scrml-client-assets.json` — written into the output dir by `compileScrml`; `{ clientAssets: string[] }`; read by
`scrml dev` and baked into emitted servers as `_SCRML_CLIENT_ASSETS` (§47.13 static allowlist).

### `<program>` attribute defaults changed
`csrf=` under `auth=` now defaults to `"auto"` (was `"off"`); only `csrf="off"` opts out (§40.2 / §52.13, #1161).
`auth=` is refused on a nested `<program>` (`E-PROGRAM-NESTED-AUTH`); `<page auth="required">` is now honored.


## S440 — ZERO-DIFF FOR THIS MAP (`fb21983a..cf62b415`)

No file in the window touches this map's surface (checked: `git diff --stat fb21983a..cf62b415`). The only new
option-like surface is `compileScrml`'s `beforeWrite` callback (#1125) — an API option, not config (see schema.map.md).


## S438 — ZERO-DIFF FOR THIS MAP (`9941a504c..fb21983a`)

Verified, not assumed: `git diff --name-only 9941a504c..fb21983a -- scrml.toml package.json bun.lock bunfig.toml
tsconfig.json '**/config*'` (excluding this map file itself) is **EMPTY**. No env var, feature flag, or config-file
key changed. `package.json` version stays `0.8.0`.


## S437b — ZERO-DIFF FOR THIS MAP (`d02738767..9941a504c`)

Verified at `9941a504c`: `git diff --stat d02738767 origin/main -- scrml.toml package.json .env.example compiler/src/commands`
is EMPTY, and no `process.env` / `Bun.env` read was added anywhere in `compiler/src`. Content below stands as of `d02738767`.

## S437 — `scrml.toml` project manifest (SPEC §22.13) — NEW config surface

Located by `findManifest(filePath)` in `compiler/src/host-import.js` (`MANIFEST_FILE_NAME = "scrml.toml"`), read BEFORE any parse (`readHostImportCapabilities`, called from `api.js` ahead of the block splitter).

### `[capabilities]`
host-import: "disabled" | "self-host-only" — gates `import:host` (§21.3.1). Adopter default is `"disabled"` (no manifest ⇒ disabled); `"self-host-only"` admits `import:host` only in files under `stdlib/compiler/` relative to the manifest. Any other value → `E-MANIFEST-001`. A disallowed use → `E-IMPORT-008`.

### This repo's own `scrml.toml` (root, 9 lines)
`[capabilities] host-import = "self-host-only"` — the bootstrap `scrml:compiler` family bridges into the TS compiler.

## S437 — compile-time defaults that look like config but are NOT configurable
- SQLite concurrency defaults, TWO halves: every EMITTED sqlite `Bun.SQL` handle gets `busy_timeout` + `journal_mode = WAL` (`codegen/sqlite-defaults.ts`, `_scrml_sqlite_configure`); every sqlite handle the COMPILER/CLI opens (`protect-analyzer.ts:473`, `commands/db-migrate.js:505`) gets `busy_timeout` ONLY — WAL is deliberately NOT set there because it persistently changes a file the adopter owns (`configureSqliteHandle`, `compiler/src/sqlite-handle-defaults.ts`). One value, `SQLITE_BUSY_TIMEOUT_MS = 5000` (`:86`), re-exported by the codegen half. The operator-ruled `<program journal-mode= busy-timeout=>` override (S385 A1) is **NOT implemented** — `grep -rn 'journal-mode\|busy-timeout' compiler/src` returns only comments.
- Session cookie config (`sessionExpiry`, `session-secure`) resolves per unit through `codegen/session-config-resolve.ts`; a multi-`<program>` build that cannot attribute a session-emitting unit is refused with `E-MW-008` (§20.5.1).

## Environment Variables (referenced directly in compiler/src / lsp / scripts / e2e source)

| Key | Where used | Notes |
|-----|-----------|-------|
| NODE_ENV | compiler/src/ | runtime environment detection |
| PORT | compiler/src/ | HTTP server port (generated-app server + `scrml serve`) |
| SCRML_PORT | compiler/src/ | scrml dev-server port override |
| SCRML_MCP_WATCH | compiler/src/ | enables MCP file-watch mode |
| CI | e2e/playwright.config.ts, e2e/playwright.docs.config.ts | gates retries/workers/reporter/reuseExistingServer for CI vs local runs |
| REDIS_TEST_URL | compiler/tests/unit/stdlib-redis.test.js | optional — enables the live-integration redis test tier (skipped by default / in CI) |

**Correction vs. the prior watermark:** `JWT_SECRET` was previously listed as a compiler-read env var; verified this pass that it is NOT read via `process.env` anywhere in compiler/src or compiler/runtime — it appears only in a JSDoc `@example` comment in `stdlib/auth/jwt.scrml` illustrating how a CONSUMER app might supply its own secret. `signJwt`/`verifyJwt` take `secret` as a caller-supplied function argument; this compiler repo has no env-var-based JWT secret of its own.

Generated (emitted) apps additionally read author-declared env vars via `<db src=env(...)>` / `scrml:host` — those are per-app, not part of this compiler repo's own config surface, and are not enumerated here.

## Feature Flags
No runtime feature-flag system. The native-parser is activated at CLI level via `--parser=scrml-native` (canary mode, not an env var). `--emit-block-analysis`, `--emit-engine-graph`, `--emit-token-set` are compile-time diagnostic-emission CLI flags (see build.map.md).

## `compilerSettings` — the SPEC §28 `lint.*` suppression knobs (an API option, NOT env vars)
`compileScrml({ compilerSettings: { … } })` accepts a small, closed set of lint-suppression keys.
They mirror the spec-only `lint.*` config family at SPEC §28; **unknown keys are silently ignored**,
and there is no config FILE loader in this repo — an adopter's own project loader passes the object.

| Key | Values | Default | Suppresses |
|---|---|---|---|
| `lintTailwindUnrecognizedClass` | `"warn"` / `"off"` | `"warn"` | `W-TAILWIND-UNRECOGNIZED-CLASS` — for codebases relying on custom CSS class names, where the lint produces acknowledged false positives (SPEC §26.5 / §34) |
| `lintForeignUndeclaredCapability` | fires / `"off"` | fires | `W-FOREIGN-UNDECLARED-CAPABILITY` — the §23.5.5 presence-nudge, for an author who genuinely wants an undeclared foreign scope |

Declared at `compiler/src/api.js` (~:751-766); read at ~:1039. See error.map.md for both codes.

## Runtime constants in the emitted client (compile-time literals, NOT config)
`_SCRML_NAV_CHUNK_TIMEOUT_MS` — the cross-chunk soft-nav script-load budget before falling back to a
hard navigation (`W-NAV-CHUNK-LOAD-FAILED`, §20.8.2/§20.8.7). Baked into `runtime-template.js`; not
author-settable and not an env var. Likewise the DB-authoritative GUC names (`scrml.tenant`,
`scrml.principal.caps`) and role/policy names (`scrml_app`, `scrml_tenant_iso`) are exported string
CONSTANTS in `schema-differ.js`, not configuration.

## Config Files

### bunfig.toml  [repo root]
`[test]` section: test root = `compiler/tests/` — **and deliberately NO `timeout` key (#537, S346).**
The file carried `timeout = 10000` from the initial split until S346 and **bun does not read
`[test].timeout`** — the effective per-test budget was always bun's default **5000 ms**. ⚠ The prior
generation of this map printed `timeout = 10000ms` as if it were live configuration; **that claim was
wrong at every stamp that carried it**, not merely stale. The standing rule (stated in the file
itself): a test/hook that legitimately runs multi-second declares its own budget at the site
(`test(name, fn, { timeout })` / `beforeAll(fn, { timeout })`) with a comment saying why; the only
per-run knob is the CLI flag `bun test --timeout <ms>`. **Do NOT re-add a key to widen the default
silently** — `scripts/browser-baseline.ts` gates on the browser tier's failure NAME SET, and a
timed-out test produces the same `(fail) <name>` marker as a failed assertion.

### ~~compiler/src/unit-cc-exemption-list.json~~ — ⛑ S445: DELETED (#1196); entry SUPERSEDED
List of unit-test files exempted from code-coverage enforcement (currently empty array).

### compiler/tests/parser-conformance-within-node-allowlist.json
Per-file allowlist of native-parser-vs-live-pipeline within-node divergence counts (COUNT-LENGTH / EXTRA-FIELD / FIELD-SHAPE buckets), maintained per GITI-024 shape-change tracking.

## CI Secrets (GitHub Actions repo secrets, NOT env vars in source — names only)
| Secret | Consumed by | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | **`advisory-review.yml` ONLY, and that workflow is `workflow_dispatch`-only as of #351. `cloud-maps.yml` no longer references it at all — Stage 2 was DELETED.** | **CHANGED — treat as UNSET / not-required.** bryan ruled the cloud AI spend OFF; **the absence is a COST decision, not a broken secret**, and both consuming legs were removed rather than left permanently red (the `pa-base` §8 cry-wolf shape). **Every prior map generation's "IS set — the daily cloud-maps run passes it" note is RETIRED**, as is the credential/entitlement diagnosis of the old cloud-maps red. To reinstate either leg: set the secret AND restore the trigger/step. See build.map.md. |
| `MAPS_PAT` | `cloud-maps.yml` checkout token + `GH_TOKEN` for the PR/auto-merge step | Set. A fine-grained PAT (Contents R/W + Pull-requests R/W). Required INSTEAD of `GITHUB_TOKEN` because a `GITHUB_TOKEN`-opened PR does not cascade events and `gate` would never fire. **Expires (≤1 yr) — renew or the bot goes dark.** |

`cloud-maps.yml` also DROPPED its `id-token: write` permission — it existed solely for the removed
claude-code-action's OIDC.

**Operational consequence that belongs in a config map, not just a build map: nothing on a schedule
consumes an AI credential in this repo any more, and nothing on a schedule refreshes `.claude/maps/`.
A map stamp is now exactly as old as the last PA wrap.**

No secret VALUE appears anywhere in this map set.

## Tags
#scrml #map #config #environment #env-vars #bunfig #allowlist #ci-secrets #compiler-settings #lint-knobs #maps-pat #anthropic-api-key #nav-chunk-timeout #ai-legs-killed #cost-decision #cloud-maps-stage2-deleted #advisory-review-disabled #no-scheduled-map-refresh #env-surface-unchanged #zero-env-diff #new-files-checked-individually #no-env-in-new-modules #bunfig-timeout-never-in-force #invariant-56 #zero-env-diff #s437b #9941a504c #zero-diff #s440 #cf62b415 #s447 #6a592ed5c #self-host-v1-removed #test-tmp-root #protect-egress-r8 #s450 #9bafb927 #native-parser-frozen #parser-flag-retired #session-ambient-server #auth-attr-invalid #s452-wrap #7ce905ac2 #tenant-sql-subset #e-tenant-sql-subset #arm-pipe #w-arm-pipe-legacy-impl1 #effect-summary #dpa-066 #s456 #ba2712973
#zero-env-delta-by-grep #argv-not-env
#s405 #config-zero-diff #ten-json-paths-are-conformance-fixtures #scrml-protect-mediated-is-a-symbol-not-a-setting #scrml-protect-origin #compile-time-literal-not-config #gated-on-protectactive
#s437 #d02738767 #scrml-toml #manifest #host-import-capability #e-manifest-001 #e-import-008 #sqlite-busy-timeout #journal-mode-override-not-implemented #e-mw-008 #stageoverrides

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
