# structure.map.md
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
# ━━━━━━━ S437 STRUCTURE DELTA ━━━━━━━
# `git diff --name-status 787d4cb4..HEAD -- compiler/src` -> **16 `A`, 0 `D`, 0 `R`**; every other path is an edit.
# The 16 new modules are rowed in `## S437 — NEW MODULES` below (the first section of this file). Also new at repo
# level: `scripts/hybrid.ts` (661L), `conformance/adapters/hybrid.ts`, root `scrml.toml` (the §22.13 manifest).
# `compiler/tests/self-host/` now holds ONLY `README.md` — its four `.test.js` were retired (3 deleted, `bpp.test.js`
# moved to `compiler/tests/unit/parser-workarounds.test.js`). `codegen/` top-level `.ts`/`.js`: **89** (was 85).
# `validators/`: **9** files (was 6 — `defer-structure.ts`, `lint-defer.ts`, `lint-redeclare.ts` added).
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
# ━━━━━━━ S422 STRUCTURE DELTA — **NO NEW DIRECTORY. NO DELETION. 20 NEW FILES, 19 OF THEM TESTS.** ━━━━━━━
#
# ⛑ **RE-DERIVED BY `git diff --name-status e74f5423..HEAD`, not inferred from a tally.**
#   - **Added (non-doc): 20 files** — 19 under `compiler/tests/` (16 `unit/`, 1 `integration/`,
#     1 `browser/`, plus the two e2e-render-map harness files were MODIFIED not added) and
#     **`scripts/conflict-marker-gate.ts`**, the one new non-test source file in the window.
#   - **Deleted: ZERO.** `git diff --name-status … | grep '^D'` returns nothing.
#   - **No new directory at any level.** Every added file landed in a directory that already existed.
#   - `compiler/src` is **195 files — FLAT for the FOURTH consecutive window** while growing
#     **+1,116 lines to 253,519**. ⚑ **A FLAT FILE COUNT OVER A GROWING LINE COUNT IS THE SIGNATURE OF
#     THIS REPO** — work lands by deepening existing modules, not by adding them. A structure map keyed
#     on directory shape will therefore look "unchanged" through very large behavioural windows. That is
#     a property of the instrument, not evidence of a quiet tree.
#
# ⚑ **WHERE THE WORK ACTUALLY LANDED (`compiler/src`, +1,195 / -79 over 12 files) — the ranking is
# the useful artifact, because the directory tree does not show it:**
#   `codegen/emit-library.ts` **+400** · `ast-builder.js` **+241** · `type-system.ts` **+170** ·
#   `codegen/index.ts` **+92** · `codegen/emit-logic.ts` **+73** · `tokenizer.ts` **+65** ·
#   `semdiff.ts` **+59** · `codegen/code-segments.ts` **+57** · `expression-parser.ts` **+39** ·
#   `codegen/emit-expr.ts` **+35** · `gauntlet-phase3-eq-checks.js` **+24** ·
#   `codegen/emit-control-flow.ts` **+19**.
#   **`codegen/` took 676 of the 1,195 added lines — a clear majority, concentrated in `emit-library.ts`.**
#
# ⚠ **`scripts/` IS NOW 37 `.ts`/`.js` FILES** (+1: `conflict-marker-gate.ts`). Seven more were
# modified: `browser-baseline.ts`, `corpus-emit-differential.ts`, `dpa-debt.ts`, `flograph.ts`,
# `generate-api-reference.js`, `regen-spec-index.ts`, `state.ts`.
#
# ⚠ **STILL NOT A WORKSPACE MONOREPO.** Root `package.json` remains the SOLE manifest; there is no
# `workspaces` key, no `packages/*`, no `apps/*`. Re-checked this window, not carried.
#
# ━━━━━━━ EVERYTHING BELOW THIS LINE IS THE SUPERSEDED S405 HEADER, CARRIED FOR PROVENANCE. ━━━━━━━
# ⚠ Its stamp line read: `updated: 2026-09-08T05:00:00Z  commit: e74f5423`. Figures in it are S405-era.
# generated-at: e74f5423 — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** `merge-base HEAD origin/main`
# == `origin/main` == **`e74f5423`**. ⚠ **`HEAD` IS *NOT* THE STAMP THIS PASS** — it advanced to
# `e6b8fc77` mid-pass (LOCAL, UNPUSHED, docs-only wrap commit on `wrap/s405`;
# `git diff --name-only e74f5423..e6b8fc77 -- compiler/ scripts/ conformance/ stdlib/ lsp/ .github/
# package.json` -> EMPTY), and the stamp deliberately tracks the MERGE-BASE, not a branch tip.
# MAP-STAMP RULE, all three commands: `BASE=$(git merge-base HEAD origin/main)` -> `e74f5423`;
# `git diff --name-only BASE..HEAD -- compiler/ scripts/ conformance/ stdlib/ lsp/ .github/
# package.json` -> **EMPTY**; `git merge-base --is-ancestor e74f5423 origin/main` -> exit 0.
# Inbound (invariant 48): `git merge-base --is-ancestor 68cfac6d e74f5423` -> exit 0.
#
# ━━━━━━━ S405 wrap-6c — **STAMP ADVANCED. `68cfac6d` -> `e74f5423`.** ━━━━━━━
#
# ⛑ **`compiler/src` IS FLAT AT 195 FILES FOR THE THIRD CONSECUTIVE WINDOW — ZERO ADDED, ZERO
# DELETED. ALL TEN CHANGED FILES ARE EDITS.** `docs/FACTS.md` re-reads **252,403 lines across 195
# files** (lines **+2,338** over S404's 250,065; file count flat). ⚠ A raw `find compiler/src -type f`
# returns **197** — the standing DEFINITION boundary (FACTS scopes to source), not a stale figure.
# **ZERO new top-level scripts, ZERO new `compiler/src` modules.** The window is entirely edits to
# ten existing files, five of them in `compiler/src/codegen/`.
#
# ⛔ **THE HEADLINE IS A CORRECTION TO THIS FILE'S OWN `engine-statechild-parser.ts` ROW, WHICH HAD
# BEEN CARRYING A *RESOLVED* DEFECT AS OPEN — WITH A "DO NOT RE-ATTEMPT" WARNING ATTACHED.**
# `g-engine-state-child-apostrophe-breaks-parse` is `status=resolved`, landed `e523478b` (#892).
# **VERIFIED HERE BY EXECUTION, not by reading the changelog:** the real corpus sample
# `samples/compilation-tests/engine-modern-002-effects.scrml` with
# `<Success rule=.Idle><p>Thanks. We'll email you.</p></>` substituted for its empty `<Success>`
# compiles byte-for-byte identically to the unmodified file — 1 warning, 3 ghost-pattern lints,
# **zero `E-ENGINE-STATE-CHILD-MISSING`**. ⚠ The old row cited `origin/fix/s402-engine-apostrophe2`
# (`46bb46c9`) as "the fix, unmerged" — **that branch is STILL not an ancestor of `origin/main` and
# is NOT what landed.** The row is rewritten below.
#
# ⛔ **AND THE NAVIGATION RULE THAT REPLACES IT: IN THIS FILE THE UNIT IS THE *LOOP*, NOT THE
# FUNCTION.** #892 gave four opener-blind scan loops a `findOpenerEnd` jump, and **three of the four
# sit inside functions that ALSO contain a walker loop which was already safe** — so a function-level
# entry would assert something false about three of four. Full enumeration in the row below and in
# `primary.map.md`'s Task-Shape Routing. ⚠ **`computeCommentRegions` NO LONGER EXISTS — it is
# `computeMaskedRegions` (`:1658`).** Grepping the old name at this watermark returns nothing.
#
# **FIVE OF THE TEN CHANGED FILES ARE IN `compiler/src/codegen/`** — `protect-egress.ts` (+584, now
# 821L) · `emit-server.ts` (+533, now 7,027L) · `emit-library.ts` (+505/-70, now 1,753L) ·
# `tenant-egress.ts` (+156, now 649L) · `db-authoritative.ts` (+55, now 540L). The other five:
# `engine-statechild-parser.ts` (+251, now 2,848L) · `schema-differ.js` (+396, now 2,802L) ·
# `gauntlet-phase1-checks.js` (+66, now 929L) · `protect-analyzer.ts` (+56, now 1,182L) ·
# `commands/db-migrate.js` (+24, now 665L). New rows for each below.
#
# ⚑ **AN IMPORT-DIRECTION INVARIANT LANDED THIS WINDOW AND IT IS STATED IN BOTH FILES THAT OBEY IT.**
# The ONE `CREATE TABLE` recognizer lives in `compiler/src/schema-differ.js` — which imports only
# `sql-ident.ts` — **so that a consumer is not forced to pull `protect-analyzer.ts`, and with it
# `bun:sqlite` + `node:fs`, just to ask what counts as a table declaration.** That is the mirror of
# `protect-analyzer.ts:631`'s own long-standing note that the early PA stage avoids pulling a codegen
# module. `protect-analyzer.ts` DELETED its own `CREATE_TABLE_RE` and imports (`:65-77`);
# `gauntlet-phase1-checks.js` imports `harvestRawCreateTables` (`:69-80`).
#
# ⚑ **`structure.generated.md` WAS REGENERATED THIS PASS** (`bun scripts/mapgen.ts --kind structure
# --root <scrml> --write`) — it had been stamped `2026-09-06 16:32`, two source-days stale. It now
# reads **195 files · 1,513 exported symbols** (was 1,505). It is `@generated`: do not hand-edit.
#
# ━━━━━━━ S404 wrap-6c — **STAMP ADVANCED. `499eecce` -> `68cfac6d`.** ━━━━━━━
#
# ⛑ **`compiler/src` IS FLAT AT 195 FILES — ZERO ADDED, ZERO DELETED.** All four changed compiler
# files are EDITS: `type-system.ts` · `expression-parser.ts` · `types/ast.ts` ·
# `native-parser/translate-expr.js`. `docs/FACTS.md` re-reads **250,065 lines across 195 files** (the
# LINE count moved +1,206 since S397's 248,859; the FILE count did not).
#
# **ONE NEW TOP-LEVEL SCRIPT: `scripts/int-number-census.ts` (1,650L, #875)** — a re-runnable post-AST
# census over `int`/`integer` annotation positions and call sites. `--summary` / `--json` /
# `--roots=a,b` / `--selftest`. It is NOT in `ci.yml`, NOT in `bun test`, NOT in a hook — hand-run, in
# the same class as `scripts/corpus-emit-differential.ts`. It imports the compiler's own
# `runBlockSplitter` / `runTAB` / `buildTypeRegistry` / `resolveTypeExpr` / `parseStructBody` from
# `type-system.ts` and `parseSchemaBlock` from `schema-differ.js`, so it is a NEW CONSUMER of both.
#
# ⛑ **A ROUTING FACT ABOUT THIS TREE THAT WAS NOT WRITTEN DOWN ANYWHERE, AND IT COSTS A SESSION TO
# REDISCOVER: `compiler/src/block-splitter.js` DECIDES TEMPLATE-LITERAL AND `${…}` BEHAVIOUR BEFORE
# THE EXPRESSION PARSER EXISTS.** `splitBlocks` (`:893`) is Stage 2 of the pipeline; its back-tick
# tracking lives at `:2790` and is guarded by `frame.type === "meta"` — the comment there says so
# outright ("Only applies to meta blocks"). At file top level there is no meta frame, so a `${` inside
# a template opens a LOGIC BLOCK and the template is shredded. **Anyone routed to
# `expression-parser.ts` or `type-system.ts` for a template/interpolation question is looking
# downstream of the decision.** Filed HIGH:
# `g-splitblocks-consumes-dollar-brace-inside-a-top-level-template-truncating-the-string`. Full detail
# in `primary.map.md` Task-Shape Routing row 3.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# **`compiler/src` IS NOW 195 FILES (+2) AND 1,505 EXPORTED SYMBOLS (+27)**, re-walked by
# `flogence/scripts/mapgen.ts` at this watermark. The source delta `10a4b045..499eecce` is **17
# `compiler/src` + 2 `compiler/native-parser` + 5 `scripts`** across **EIGHT distinct commits and
# FOUR sessions** — ⚠ **do not read it as one arc**; the per-file attribution table is in
# `primary.map.md`'s header.
#
# **ONE NEW FILE UNDER `compiler/src/`:**
#   · `compiler/src/codegen/bool-coerce.ts` (**NEW**, +141) — **#842** (`8a68d960`), boolean-declared
#     SQL column coercion at the `?{}` decode boundary.
# **ONE NEW FILE UNDER `scripts/`:**
#   · `scripts/native-parser-flip-harness.ts` (**NEW**, +617) — **#870** (`94572819`). ⚠ **It PATCHES
#     AND RESTORES `compiler/src/api.js` in the working tree.** See build.map.md before running it.
#
# ⛑ **THE NAVIGATION HEADLINE: `compiler/src/library-shape.js` (240L) IS THE SINGLE SOURCE FOR FILE
# SHAPE, AND THIS MAP DID NOT NAME IT UNTIL NOW.** An S402 dispatch working that surface across all
# 13 maps reported "2 incidental hits, zero routing rows" — **reproduced at this watermark: zero hits
# for `fileShape` / `classifyFileShape` / `FILE_SHAPES` in EVERY hand-authored map.** Closed here and
# with a `primary.map.md` Task-Shape Routing row (now the FIRST row of that table).
#
# ⛑ **AND THE SECOND MEASURED HOLE: THIS FILE NAMED NEITHER `engine-statechild-parser.ts` NOR
# `match-statechild-parser.ts` (0 hits each).** Both are now in Directory Ownership. The asymmetry
# between them is an OPEN defect, not a naming detail — see the routing row.
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
# **SURFACE CHANGES THIS WINDOW.** `compiler/src/commands/dev.js` gained three functions and LOST a
# whole serving branch (#823): `gateProtectedDoc` (`:979`), `rootFallbackCandidates` (`:1003`) and
# `staticCandidates` (`:1029`) are new; the ungated root-only `pathname === "/"` branch that used to
# sit AFTER the static loop is **deleted**, and root resolution is now folded in as the tail of the
# one gated candidate generator. `compiler/src` is **194 files** at this SHA (re-counted).
# The `conformance/` corpus is **893 cases across 54 category dirs** (+2 this window, both if-chain
# server-boundary cases — see the map body).
#

## S457 — STRUCTURE DELTA (`ba2712973..125486345`; 10 commits, source-bearing #1340-#1348)

| path | change |
|---|---|
| `compiler/src/runtime-url-guard.js` (+ `.d.ts`) | **NEW** (243 lines) — §5.2 rule 3 / §53.6.1: THE one URL-scheme reader for runtime AND compile time; inlined into the client runtime as chunk `urlguard` and into server/worker/library/tool bundles (#1341, #1347) |
| `compiler/src/codegen/url-attr-guard.ts` | **NEW** (46 lines) — when a URL-attribute write must go through `_scrml_safe_url` (#1341) |
| `compiler/src/scrml-acorn.ts` | **NEW** (130 lines) — the scrml-extended acorn `ScrmlParser` (`@` sigil, `Type::Variant`), moved out of `expression-parser.ts` so the SQL slot reader uses the same parser (#1342) |
| `compiler/src/placeholder-nonce.ts` | **NEW** (139 lines) — per-compilation unguessable token carried by every compiler placeholder name (#1346) |
| `compiler/src/codegen/is-predicate-lowering.ts` | **NEW** (302 lines) — ONE lowering of `is some` / `is not` / `is not not` / `is .Variant`, shared by `emit-expr.ts` (structured) and `rewrite.ts` (string path) (#1343) |
| `compiler/src/codegen/sql-one-statement-guard.ts` | 115 -> **382** lines — `judgeDriverCallDetail`, program-statement policy + refusal sink (#1344) |
| `compiler/src/codegen/sql-lex.ts` | -> 274 lines — `jsInterpolationEnd` :69 now reads the slot with `ScrmlParser` (#1342) |
| `compiler/src/sql-in-expression-text.ts` | 106 -> **220** lines — `sqlSitesInExpressionText` :213, the one reader of `?{}` sites in expression text (#1342) |
| `compiler/src/codegen/rewrite.ts` | -> 3258 lines — `rewriteSqlRefs` :576 lowers exactly `sqlSitesInExpressionText` sites (:582); `.unsafe` params one per slot; `lowerIsPlaceholders` rules :2903/:2989 (#1342, #1343, #1344) |
| `compiler/src/codegen/validate-emit.ts` | -> 261 lines — placeholder gate in `validateEmittedArtifact` :82 (`opts.checkPlaceholders`) (#1346) |
| `compiler/src/validators/reserved-prefix.ts` | -> 576 lines — `__scrml_` also reserved (`RESERVED_NAME_PREFIXES` :94) (#1346) |
| `compiler/src/attr-injection-sink.ts` | -> 241 lines — scheme reading now imported from `runtime-url-guard.js` (:42) (#1341) |
| `compiler/src/api.js` | -> 4725 lines — commit point: `hasFatalBeforeWrite` :3718, staged writes committed :4351-:4359, `artifactsWritten` :4602; `planStdlibBundle` :594; `withCompilationPlaceholderToken` wraps the chokepoint :1058 (#1346, #1348) |
| `compiler/src/commands/refusal-gate.js` | 136 -> **40** lines — `APPLICATION_SCOPE_REFUSALS` / `hasApplicationScopeRefusal` RETIRED; only `noFilesWrittenLine` :38 remains (#1348) |
| `compiler/src/commands/{compile,build,dev,serve}.js` | read `result.artifactsWritten` (`compile.js:585`, `build.js:1425`, `serve.js:226/:297`) (#1348) |
| `compiler/src/type-system.ts` | `url` named shape -> `_scrml_url_shape_ok` (:109 import, :1563) (#1347) |
| `scripts/facts.ts` | `NOT_A_VERB` (:92) now lists `refusal-gate`, `fix-client-server-call`, `fix-sql-failable` (#1340) |
| `.github/workflows/ci.yml` | NEW blocking `gate` step "Bootstrap conformance report current" (PR-only, path-scoped) (#1340) |
| `compiler/tests/` | +10 — see test.map.md `## S457` |
| `conformance/cases/` | +5 (1391 -> **1396**) |
| `docs/changes/s457-*/` | 8 dispatch dirs (historical by design — compliant) |

FACTS at `125486345`: `compiler/src` **304,067 lines / 256 files** (+6: 5 modules + 1 `.d.ts`). No file deleted.

### ⛑ FILE INVENTORY — URL SCHEME GUARD (§5.2 rule 3 runtime · §53.6.1 `string(url)`) (new at `125486345`)
| file | exports / loci |
|---|---|
| `compiler/src/runtime-url-guard.js` | `_SCRML_URL_VALUED_ATTRS` :25, `_SCRML_URL_ATTR_ELEMENTS` :39, `_scrml_is_url_attr` :63, `_SCRML_SAFE_URL_SCHEMES` :78 (http https ftp mailto tel sms), `_SCRML_SAFE_DATA_IMAGE_TYPES` :82, `_SCRML_IMAGE_SOURCE_ATTRS` :88, `_scrml_read_url_scheme` :110, `_scrml_data_url_is_raster_image` :133, `_scrml_url_scheme_admitted` :140, `_scrml_url_value_admitted` :187, `_scrml_safe_url(el, name, value)` :208 (returns `"about:blank"` + one `url-guard` log report on refusal; never logs the value), `_scrml_url_shape_ok(value)` :234 (absolute URL + safe scheme; no `data:`) |
| `compiler/src/codegen/url-attr-guard.ts` | `URL_GUARD_FN = "_scrml_safe_url"` :26, `isUrlAttrOn` :29, `dynamicUrlAttrNeedsGuard` :34, `quotedUrlAttrNeedsGuard` :39, `wrapUrlGuard` :44 |
| emitters (callers of url-attr-guard) | `emit-html.ts` :3356/:3660 · `emit-bindings.ts` :1017 · `emit-event-wiring.ts` :457 · `emit-variant-guard.ts` :921 · `emit-each.ts` :2704/:2763 · `emit-lift.js` :1392/:1659/:1684/:1720/:1828/:3280 · `emit-ssr-render.ts` :203/:217 (server first-paint copy, el = `null`) |
| runtime packaging | `runtime-template.js:36` reads the file; chunk `urlguard` (`codegen/runtime-chunks.ts` :101/:152/:317); post-emit chunk trigger `emit-client.ts` :3062 (`_scrml_safe_url(`) / :3067 (`_scrml_url_shape_ok(`) |
| `string(url)` judge | `type-system.ts:1563` (compile-time literal zone); `codegen/emit-predicates.ts` `URL_SHAPE_FN` :56, `SERVER_URL_SHAPE_HELPER` :65, `needsUrlShapeHelper` :72; inlined by `emit-server.ts:1509`, `emit-worker.ts:113`, `emit-library.ts:458`, `emit-tool.ts:390` |
| compile-time sink | `attr-injection-sink.ts` imports the reader from `runtime-url-guard.js` (:42) — one reader, both sides |

### ⛑ FILE INVENTORY — ONE SQL READER (slot extent · site extent · driver-call judge at every lowering) (new at `125486345`)
| file | exports / loci |
|---|---|
| `compiler/src/scrml-acorn.ts` | `ScrmlParser` :130 (= `acorn.Parser.extend(scrmlAtPlugin :27, scrmlEnumPlugin :107)`). Consumers: `expression-parser.ts` :25/:649/:696/:3907, `codegen/sql-lex.ts` :25/:86 |
| `compiler/src/codegen/sql-lex.ts` | `jsInterpolationEnd` :69 (parses the payload with `ScrmlParser`), `SqlInterpolation` :128, `liveSqlInterpolations` :142, `replaceLiveSqlInterpolations` :255, `liveSqlInterpolationExprs` :267, `sqlHasLiveInterpolation` :272 |
| `compiler/src/sql-in-expression-text.ts` | `ExprTextSqlVisitor` :22, `scanExpressionTextForSql` :56, `ExprTextSqlSite` :199, `sqlSitesInExpressionText` :213 (used by `rewrite.ts:582` and the compile checks) |
| `compiler/src/codegen/sql-one-statement-guard.ts` | `sqlHoldsOneStatement` :44, `DriverCallVerdict` :53 (`ok`/`multiple-statements`/`text-not-read`/`not-admitted`), `setProgramBodySqlPolicy` :91, `setProgramBodySqlFile` :101, `swapSqlLoweringSpan` :110, `ProgramStatementRefusal` :117, `programStatementRefusal` :132, `multipleStatementsRefusal` :155, `programStatementMessage` :188, `recordProgramStatementRefusal` :241, `resetProgramStatementRefusals` :257, `drainProgramStatementRefusals` :263, `DriverCallJudgement` :270, `judgeDriverCall` :287 (wrapper), **`judgeDriverCallDetail` :298**, `refusedDriverCallExpr` :343, `refuseMultipleStatements` :366 |
| callers of `judgeDriverCallDetail` | `codegen/rewrite.ts` :663 (tagged template) / :719 (`.unsafe`), `codegen/emit-logic.ts` :3792 |
| policy lifecycle (`codegen/index.ts`) | cleared :1187-:1188 · refusals reset :1347 · policy set :2366 (tenant tables + dialect from the compilation tenant set) · file :2386 · drained :3292 / :4344 · cleared :4348-:4349 |

### ⛑ FILE INVENTORY — RESERVED `__scrml_` + PLACEHOLDER NONCE + EMIT GATE (§47.1.1, §2.2.1) (new at `125486345`)
| file | exports / loci |
|---|---|
| `compiler/src/placeholder-nonce.ts` | `setPlaceholderTokenObserverForTest` :62, `newPlaceholderToken` :67, `currentPlaceholderToken` :79, `withCompilationPlaceholderToken` :84, `scrubPlaceholderToken` :92, `placeholderName` :98, `placeholderPrefix` :103, `placeholderParam` :108, `isCompilerPlaceholderName` :116; name thunks `PH_IS_SOME`…`PH_GUARD` :123-:132, prefix thunks `PHP_BARE_VARIANT`…`PHP_MV` :135-:139 |
| consumers | `api.js` :45/:1058 (token per compile)/:1067 (`scrubPlaceholderTokenDeep` — diagnostics never show the token), `expression-parser.ts` :19, `ast-builder.js` :38/:5311, `component-expander.ts` :45, `codegen/emit-lift.js` :3, `codegen/is-predicate-lowering.ts` :43, `validators/reserved-prefix.ts` :85, `codegen/validate-emit.ts` :30 |
| `compiler/src/validators/reserved-prefix.ts` | `RESERVED_NAME_PREFIX` :91, `RESERVED_NAME_PREFIXES = ["__scrml_", "_scrml_"]` :94, `reservedPrefixOf` :97, `RESERVED_PREFIX_CODE` :104, `isReservedPrefixName` :118 (exempts only `isCompilerPlaceholderName`), `runReservedPrefixCheck` :563 |
| `compiler/src/codegen/validate-emit.ts` | `validateEmittedArtifact` :82 — refuses any artifact with a `__scrml_`-shaped NAME token (acorn tokens, not text) as `E-CODEGEN-INVALID-LOGIC`; message scrubbed of the token :139/:152 |

### ⛑ FILE INVENTORY — `is` PREDICATE LOWERING (§42) (new at `125486345`)
`codegen/is-predicate-lowering.ts`: `IS_OP_IIFE_LOCAL = "__scrml_is_v"` :51, `lowerPresenceCheck` :54, `lowerAbsenceCheck` :60, `lowerVariantCheck` :70, `isTrivialOperandText` :84, `lowerIsPlaceholders(text)` :236 (string path; recurses into template `${}`). Callers: `emit-expr.ts:52` (structured), `rewrite.ts` :11/:2903/:2989 (string).

### ⛑ FILE INVENTORY — COMMIT POINT: NO ARTIFACT FROM A COMPILE WITH AN ERROR (§2.2.1) (new at `125486345`)
`api.js`: `planStdlibBundle(names, diagnostics)` :594 (decides shim set before writing); `hasFatalBeforeWrite` :3718; `writeAborted` :3769; staged writes committed :4351 (`artifactsWritten = true` :4359); result field `artifactsWritten` :4602; early-return shape :1679. Command side: `commands/refusal-gate.js` `noFilesWrittenLine` :38 only; `build.js` still raises E-MW-007 via the `beforeWrite` callback. `dev` keeps the last good dist and answers every request with the error; `serve` returns `outputs: {}` + `artifactsWritten: false`.

## S456 — STRUCTURE DELTA (`9c556dc74..ba2712973`; 11 commits, source-bearing #1330-#1337)

| path | change |
|---|---|
| `compiler/src/attr-injection-sink.ts` | **NEW** (279 lines) — §5.2 executable-sink reader (`E-ATTR-INTERP-EXECUTABLE`), the ONE classifier shared by VP-3, the component expander and `<each>` lowering (#1337) |
| `compiler/src/hoist-write-scan.ts` | **NEW** (512 lines) — §8.10 write-free-loop-body proof for N+1 hoisting (#1332) |
| `compiler/src/sql-in-expression-text.ts` | **NEW** (106 lines) — finds `?{`…`}` queries inside expression TEXT (`sql-ref` raw) (#1335) |
| `compiler/src/sql-one-statement.ts` | **NEW** (131 lines) — §8.1.2 one-statement-per-program-body-`?{}` check + the shared program-body SQL walker (#1335) |
| `compiler/src/tenant-substrate-read.ts` | **NEW** (426 lines) — §14.8.10 `W-TENANT-SUBSTRATE-SCOPED` (#1331) |
| `compiler/src/tenant-undeclared.ts` | **NEW** (202 lines) — §14.8.10 program-body allow-list: `E-TENANT-UNDECLARED` / `E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED`; live-DB undeclared tenant relations (#1334) |
| `compiler/src/codegen/refused-lowering-errors.ts` | **NEW** (77 lines) — run-wide sink for codegen refusals; reset + drained by `runCG` (#1336) |
| `compiler/src/codegen/sql-one-statement-guard.ts` | **NEW** (115 lines) — codegen re-read of the EMITTED driver call with acorn; fails closed (#1335) |
| `compiler/src/codegen/tenant-startup-check.ts` | **NEW** (116 lines) — emitted `_scrml_tenant_startup_check` per server module (#1334) |
| `compiler/src/validators/attribute-interpolation.ts` | -> 322 lines — +`collectExecutableSinkErrors` / `runExecutableSinkCheck` (#1337) |
| `compiler/src/schema-differ.js` | -> 4364 lines — `programStatementVerdicts` :3967, `programStatementCount` :4010 (exported), `programSqlTokens` :4056 (module-local); `--` ends at CR or LF (#1331/#1334/#1335) |
| `compiler/src/codegen/sql-lex.ts` | -> 270 lines — exported `jsInterpolationEnd` :91 (the ONE JS-accurate `${}` slot reader) (#1335) |
| `compiler/src/codegen/protect-flow.ts` | -> 4482 lines — sink kind `"handle"` (`SinkKind` :186), `isHandleResultDeclarator` :127 (#1330) |
| `compiler/src/codegen/foreign-seal.ts` | -> 316 lines — acorn-based slice reads: `scanForeignSliceShape` :265, `scanForeignSliceTopLevelBindings` :292 (#1336) |
| `compiler/src/commands/build.js` | `generateServerEntry` imports each module's `_scrml_tenant_startup_check` (:300/:324/:463) and refuses to serve (503) while one reports (:564-) (#1334) |
| `compiler/tests/` | +11 — `integration/{foreign-slice-lexing,protect-handle-response-egress,s456-attr-injection-sink,sql-one-statement-pg,tenant-undeclared-startup}.test.js`, `unit/{s456-hoist-divergences,sql-one-statement,sql-slot-extent,tenant-small-residuals-s456,tenant-substrate-read,tenant-undeclared}.test.js` |
| `conformance/cases/` | +45 `case.scrml` (1346 -> **1391**); NEW fixture convention `<name>.db.sql` (`conformance/run.ts` `dbFixtures`; `conformance/README.md` :314) |
| `docs/changes/s456-*/` | 7 dispatch BRIEF/progress dirs (historical by design — compliant) |

FACTS at `ba2712973`: `compiler/src` **302,253 lines / 250 files** (+9). No file deleted.

### ⛑ FILE INVENTORY — PROGRAM-BODY SQL RULES (§8.1.2 one statement · §14.8.10 allow-list · closed lexical subset · `${}` slot reader) (new at `ba2712973`)
| file | exports / loci |
|---|---|
| `compiler/src/sql-one-statement.ts` | `MultipleStatementsDiagnostic` :30, `sqlRefBody` :38, `forEachProgramBodySql` :50 (shared program-body walker; uses `sql-in-expression-text.ts`), `programBodyMultipleStatements` :93 |
| `compiler/src/sql-in-expression-text.ts` | `ExprTextSqlVisitor` :22, `scanExpressionTextForSql` :43 |
| `compiler/src/tenant-undeclared.ts` | `compilationHasDatabase` :45, `TenantUndeclaredDiagnostic` :58, `ProgramStatementDiagnostic` :66, `LiveTenantRelation` :74, `programBodyUndeclaredTenantTables` :117, `liveUndeclaredTenantTables` :171 |
| `compiler/src/schema-differ.js` | `programStatementVerdicts(text, opts)` :3967 (CLOSED statement allow-list + lexical subset; unreadable body refused), `programStatementCount` :4010, `programSqlTokens` :4056 (module-local) |
| `compiler/src/codegen/sql-lex.ts` | `jsInterpolationEnd` :91; used by `liveSqlInterpolations` :138 |
| `compiler/src/codegen/sql-one-statement-guard.ts` | `sqlHoldsOneStatement` :42, `DriverCallVerdict` :51, `judgeDriverCall` :58, `refusedDriverCallExpr` :95, `multipleStatementsThrowExpr` :106, `SQL_TEXT_NOT_READ_MESSAGE` :111. Consumers: `codegen/rewrite.ts` :614/:619/:659, `codegen/emit-logic.ts` :3667/:3777 |
| `compiler/src/protect-analyzer.ts` | `liveTenantTables` collected per `<db src=>` block (:1312, :1359) |
| `compiler/src/api.js` | Stage 6.6 `TENANT-SCHEMA` loop :3036-:3049 — `fileTenantSchemaHazards`; `fileTenantSubstrateReads` (tenant set non-empty); `programBodyUndeclaredTenantTables` + `programBodyMultipleStatements` (only when `compilationHasDatabase(metaFiles)` :3034); `liveUndeclaredTenantTables` :3052 |

### ⛑ FILE INVENTORY — CODEGEN REFUSALS (the run-wide sink) (new at `ba2712973`)
`codegen/refused-lowering-errors.ts`: `recordRefusedLowering(err, anchor?)` :51, `resetRefusedLowerings` :66, `drainRefusedLowerings` :73. Reset `codegen/index.ts:1331`; drained `codegen/index.ts:3266` / `:4317` and `codegen/emit-server.ts:1453`. Recorders: `emit-each.ts` :2527/:2750/:2771, `emit-control-flow.ts` :2873, `emit-expr.ts` :1438/:3832, `emit-logic.ts` :1747/:3572/:3621/:3801/:5226 (`emit-library.ts` / `emit-tool.ts` reference it in comments only). A refusal from a lowering with no opts-threaded error channel is recorded HERE.

### ⛑ FILE INVENTORY — ATTRIBUTE INJECTION SINKS (§5.2, `E-ATTR-INTERP-EXECUTABLE`) (new at `ba2712973`)
| file | exports / loci |
|---|---|
| `compiler/src/attr-injection-sink.ts` | `NON_EVENT_ON_WORDS` :46, `isExecutableEventHandlerAttrName` :59, `URL_VALUED_ATTRS` :84, `SAFE_LITERAL_URL_SCHEMES` :122, `SAFE_DATA_IMAGE_TYPES` :132, `IMAGE_SOURCE_ATTRS` :138, `LiteralUrlScheme` :141, `readLiteralUrlScheme` :164, `InterpolatedAttrSink` :190, `classifyInterpolatedAttrSink(name, value)` :201 (THE reader), `attrSinkKey` :234, `ATTR_INTERP_EXECUTABLE_CODE` :243, `interpolatedAttrSinkMessage` :249 |
| `compiler/src/validators/attribute-interpolation.ts` | `walkEveryMarkupNode` :159 (module-local), `collectExecutableSinkErrors` :214, `runAttributeInterpolationFile` :278, `runExecutableSinkCheck` :303, `runAttributeInterpolation` :314 |
| `compiler/src/api.js` | VP-3 `runAttributeInterpolation` :2338 (pre-ME); post-ME `runExecutableSinkCheck` :2995 (stage label `VP-3`); code enrichment :1467 |
| `compiler/src/component-expander.ts` | `collectExecutableSinkErrors` :1323 inside `parseComponentDef` (:1280), `markReported: true` |
| `compiler/src/meta-eval.ts` | stamps `_metaEmitSiteSpan` on `^{ emit }` replacement nodes (:591-:598) |
| `compiler/src/codegen/emit-each.ts` | quoted-attribute gate :2741 -> refusal recorded :2750 |

### ⛑ FILE INVENTORY — TENANT STARTUP CHECK (§14.8.10) (new at `ba2712973`)
`codegen/tenant-startup-check.ts`: `TENANT_STARTUP_CHECK_EXPORT = "_scrml_tenant_startup_check"` :38, `TenantCheckHandle` :41, `TENANT_UNDECLARED_HELPER_LINES` :53, `tenantCheckLabel` :88, `tenantStartupCheckLines(handles, tenantScopedTables)` :97. Emitted from `codegen/emit-server.ts:7203`; consumed by `commands/build.js` `generateServerEntry` (detect :324, import alias `_scrml_tc_N` :463, `_SCRML_TENANT_CHECKS` :582; 10 s per-check timeout; every request 503 while a check reports or errors; re-check 1 s backing off to 30 s, `/_scrml/health` immediate). Code: `E-DEPLOY-DB-TENANT-UNDECLARED`.

### ⛑ FILE INVENTORY — §8.10 HOISTING, re-walked (supersedes S455 line numbers)
`hoist-sql-shape.ts` `HoistableQuery` :39, `HOIST_KEY_TABLE = "__scrml_batch_k"` :73, `HOIST_VAL_ALIAS` :75, `HOIST_VALUES_PLACEHOLDER` :77, `classifyHoistableQuery` :173. `hoist-write-scan.ts` `LoopWriteFacts` :56, `sqlIsPlainRead` :131, `WriteScanFile` :402, `buildCompilationWriteFacts` :412, `buildLoopWriteFacts` :449, `callMayWrite` :471, `loopBodyWriteReason` :497 — imported by `batch-planner.ts:29`. `emit-control-flow.ts` `substituteHoistedSqlInBody` :1011, `emitHoistedForStmt` :1179.

### ⛑ FILE INVENTORY — §14.8.10 identity substrate (new at `ba2712973`)
`tenant-substrate-read.ts`: `TENANT_SUBSTRATE_CODE = "W-TENANT-SUBSTRATE-SCOPED"` :71, `TenantSubstrateDiagnostic` :73 (severity warning), `tenantSubstrateMessage` :387, `fileTenantSubstrateReads(fileAST, ctx)` :411.

### ⚠ REVIEWER-REPORTED WALKER GAPS (S456; navigation facts, not fixed)
- `validators/ast-walk.ts` `walkFileAst` :33 / `walkNode` walk a FIXED field list and do **not** descend `EngineDeclNode.bodyChildren` (`types/ast.ts:949`). A whole-file rule built on `walkFileAst` misses engine state-child bodies — `attribute-interpolation.ts` uses its own `walkEveryMarkupNode` :159 for this reason; `post-ce-invariant.ts:160` handles engine bodies separately.
- **Component bodies stay RAW TEXT until the component expander re-parses them** (`component-expander.ts` `parseComponentDef` :1280). A pre-CE AST rule cannot see markup inside a component definition; a rule that must judge what the author wrote there runs in the CE re-parse (as `collectExecutableSinkErrors` :1323 does). After expansion, prop text has already been substituted.

## S455 — STRUCTURE DELTA (`f38697900..9c556dc74`)

| path | change |
|---|---|
| `compiler/src/tenant-schema-hazards.ts` | **NEW** (2765 lines) — §14.8.10 `E-TENANT-SCHEMA-HAZARD`: the `<schema>` declaration rule for tenant-scoped tables (#1313/#1317/#1319) |
| `compiler/src/hoist-sql-shape.ts` | **NEW** (293 lines) — §8.10 token-level allow-list of hoistable N+1 query shapes (#1325) |
| `compiler/src/codegen/foreign-seal.ts` | **NEW** (174 lines) — §23.2.4a sealed-scope `_{}` slice builder `_scrml_foreign_seal` + `E-FOREIGN-007` syntax check (#1312) |
| `compiler/src/commands/fix-sql-failable.js` | **NEW** (546 lines) — `scrml fix` rule `sql-failable` (§19.8.3 R11) (#1315) |
| `compiler/src/commands/fix-client-server-call.js` | **NEW** (793 lines) — `scrml fix` rule `client-server-call` (§19.9.10) (#1308) |
| `compiler/src/codegen/sql-attempt.ts` | 141 -> **181** lines — +`handledSqlOfGuardedNode` / `handledSqlGuardInner` (#1322) |
| `compiler/src/codegen/tenant-sql-subset.ts` | -> **1032** lines — dialect-aware allow-lists, `::<built-in>` casts, `statementSeparator` lex option (#1319) |
| `compiler/src/codegen/tenant-egress.ts` | -> **1078** lines — `compilationTenantSet` / `CompilationTenantSet` (#1316) |
| `compiler/tests/` | +12 — `commands/fix-{client-server-call,sql-failable}.test.js`, `integration/{foreign-sealed-scope,tenant-subset-cast-pg}.test.js`, `unit/{build-pg-schema-create-requirement,s455-handled-sql-guard-consumers,s455-hoist-allow-list,s455-hoist-keyed-read-depth,tenant-floor-project-set,tenant-schema-body-subset,tenant-schema-hazards,tenant-schema-isolation-removal}.test.js` |
| `conformance/cases/{fn,foreign,protect,server-db,tenant}/` | +28 — `tenant/schema-hazard-*` (8), `tenant/floor-{alter-add-tenant-column,imported-module}-*` (4), `foreign/foreign-slice-*` (3), `server-db/sql-handled-*-rt` (5 new), `server-db/sql-hoisted-loop-*-rt` (6), `protect/hoisted-loop-protected-table-not-hoisted-rt`, `fn/sql-access-handled-reject` |
| `docs/changes/s454-scrml-fix-f8-r11/`, `docs/changes/s455-*/` | dispatch BRIEF / progress dirs (historical by design — compliant) |

No file deleted in `compiler/`, `scripts/`, `conformance/`, `stdlib/`. ~70 `samples/**` / `examples/**` / `conformance/cases/**` `.scrml` edits are the #1308 client-server-call corpus migration (not new structure).

### ⛑ FILE INVENTORY — THE §14.8.10 TENANT `<schema>` DECLARATION RULE (new at `9c556dc74`)
| file | exports / loci |
|---|---|
| `compiler/src/tenant-schema-hazards.ts` | types `SchemaHazardKind` :65 (10 kinds incl. `statement not admitted in a tenant schema`, `body outside the tenant SQL subset`, `isolation removal`, `permissive policy`), `SchemaColumns` :74, `SchemaHazard` :76, `SchemaHazardDiagnostic` :2672; fns `tenantQueryQualifiedRefIssue` :931 (the `rel.f` rule, shared with the query floor), `findSchemaTenantHazards` :2475, `schemaTenantTableNames` :2511, `schemaColumnKnowledge` :2551, `compilationSchemaColumns` :2638, `fileSchemaTenantNames` :2668, `fileTenantSchemaHazards` :2689 (the stage entry), `schemaHazardMessage` :2716. Module-local: token lexer `lex` :134; body subset reader `lexBody` :540 / `bodyBindings` :618 / `bodyIssue` :794; token-level call rule `bodyCalls` :423 / `expressionCalls` :458 / `isSyntacticParen` :387; statement-kind allow-list `KNOWN_OBJECTS` :1274, `ADMITTED_PLAIN_LEADERS` :1296, `notAdmitted` :1301, `alterAdmission` :1332, `exemptStatementCode` :1405, `grantAdmitted` :1767; `isolationRemoval` :1824; `analyze` :1930 |
| `compiler/src/api.js` | Stage 6.6 `TENANT-SCHEMA` :2970-:3003 — post-ME, pre-DG; `compilationTenantSet(metaFiles, …)` :2994 computed ONCE, passed to CG as `compilationTenant` (:3122); `fileTenantSchemaHazards(fileAST, tables, columns, dialect)` per file :3001 |
| `compiler/src/codegen/tenant-egress.ts` | `CompilationTenantSet` :313 (`tables`, `dialect?`, `columns?`), `declaredColumns` :336, `COMPILATION_TENANT_KEY` :360, `compilationTenantOf` :363, `compilationTenantSet` :369, `dialectOfDbValue` :385, `compilationDialect` :398; `buildTenantContext` :234 reads the compilation set (:244); `schemaWriteHazards` :116 |
| `compiler/src/codegen/tenant-sql-subset.ts` | `SqlDialect` :83, `Avail` :86, `availableOn` :89, `namesFor` :95, `PG_CAST_TYPES` :110, `SQLITE_CAST_TYPES` :426, `castTypesFor` :431, `SubsetLexOptions.statementSeparator` :248 (`;` as punctuation, for schema bodies), `lexTenantSubset` :265, `TENANT_ROW_FUNCTION_DIALECTS` :391, `TENANT_GROUP_AGGREGATE_DIALECTS` :405, `tenantRowFunctions` :410, `tenantGroupAggregates` :412, `firstNonBuiltinType` :531, `analyzeTenantSql` :611 |
| `compiler/src/schema-differ.js` | `alterTableTenantDecls` :910 (module-local) — `ALTER TABLE … ADD COLUMN tenant_id` scopes a table (#1316) |

### ⛑ FILE INVENTORY — §8.10 N+1 HOISTING (re-walked at `9c556dc74`)
| file | exports / loci |
|---|---|
| `compiler/src/hoist-sql-shape.ts` | `HoistableQuery` :35 (`keyColumn`, `keyField`, `selectNames`, `tables`, `inSqlTemplate`), `classifyHoistableQuery` :143 (returns null = not hoistable) |
| `compiler/src/batch-planner.ts` | imports `classifyHoistableQuery` :28, called :582; `HOIST_KEY_ALIAS = "__scrml_batch_key"` :493; `findProtectOverlap` :466, `protectBlocksHoist` :500 (a table with protected columns is never hoisted) |
| `compiler/src/codegen/emit-control-flow.ts` | `substituteHoistedSqlInBody` :1009 (module-local; walks the detector's traversal, copy-on-write), `emitHoistedForStmt` :1150 (returns null unless exactly one site rewritten -> caller emits loop un-hoisted), call site :723 |

### ⛑ FILE INVENTORY — THE HANDLED-`?{}` GUARD-CONSUMER SURFACE (#1322; supersedes the S454 handled-`?{}` inventory's consumer list)
`codegen/sql-attempt.ts`: `handledSqlOfGuardedNode` :120 (a guarded-expr's statement-position `?{}`, `"expr"`, or null), `handledSqlGuardInner` :135. **29 call sites in 12 files** (grep at `9c556dc74`, comments excluded): `type-system.ts` :9285 :15208 :26909 :27153 · `route-inference.ts` :2168 :3097 :3164 :6633 · `dependency-graph.ts` :688 :822 :981 :1927 · `meta-checker.ts` :646 :764 · `monotonicity-analyzer.ts` :525 · `body-dg-builder.ts` :371 · `codegen/scheduling.ts` :902 · `codegen/emit-control-flow.ts` :1032 · `codegen/emit-functions.ts` :375 :542 :1342 · `codegen/collect.ts` :806 · `codegen/emit-server.ts` :4654 :4722 :4985 :5033 :5319 :5364 · `codegen/emit-logic.ts` :4081. **A new consumer of a `?{}` statement must see through the `!{}` guard via these two helpers** — 16 files import `sql-attempt` in total.

### ⛑ FILE INVENTORY — §23.2.4a FOREIGN SEALED SCOPE (new at `9c556dc74`)
`codegen/foreign-seal.ts`: `FOREIGN_SEAL_FN = "_scrml_foreign_seal"` :59, `SERVER_FOREIGN_SEAL_HELPER` :83, `foreignSliceSource` :131, `templateLiteralOf` :142, `foreignSiteLabel` :147, `checkForeignSliceSyntax` :161 (acorn). Lowering: `emit-logic.ts` `case "foreign"` :3503 (seal call :3708; `E-FOREIGN-007` :3691). Helper injected by `emit-server.ts` :1537 / :7014, `emit-library.ts` :75, `emit-tool.ts` :386; `protect-flow.ts` :877 / :3359 treats the seal call as opaque.

### ⛑ FILE INVENTORY — `scrml fix` RULES ADDED THIS WINDOW
| file | exports |
|---|---|
| `commands/fix-sql-failable.js` | `SQL_FAILABLE_RULE` :85, `SQL_FALLBACK` :88 (`get` -> `!{ _ :> not }`, `all`/`bare` -> `!{ _ :> [] }`), `sqlWriteReason` :188, `classifySql` :243 (read vs write; unclassifiable = write), `collectSqlSites` :302, `fixSqlFailable` :414. READS rewritten; WRITES listed, never rewritten |
| `commands/fix-client-server-call.js` | `CLIENT_SERVER_CALL_RULE` :93, `TRANSPORT_HANDLER` :97, `skipBalanced` :144, `endsStatement` :216, `lineOf` :225, `scratchProject` :250, `compileWithRI` :273, `promiseAllBatches` :306, `armsCoverTransport` :372, `walkObjects` :384, `fixClientServerCall` :634 |
| `commands/fix-s66.js` | `IMPL1_SAFE_RULES` :110 now includes both; chained at :1304 (client-server-call) and :1313 (sql-failable) |
| `commands/build.js` | `pgSchemaCreateRequirementLines` :1055 (exported), used :1304 — db-authoritative programs print the PG `REVOKE CREATE ON SCHEMA public` deploy requirement |

## S454 — STRUCTURE DELTA (`7ce905ac2..f38697900`)

| path | change |
|---|---|
| `compiler/src/validators/reserved-prefix.ts` | **NEW** (545 lines) — §47.1.1 `E-NAME-COLLIDES-RESERVED-PREFIX` checker, post-TAB (#1301) |
| `compiler/src/codegen/sql-attempt.ts` | **NEW** (141 lines) — §19.8.3 handled-`?{}` helper `_scrml_sql_attempt` + the `SqlError` variant tables (#1305) |
| `compiler/src/{ast-builder,ast-if-chain,attribute-registry,host-import,markup-return-scan,runtime-template,schema-differ}.d.ts`, `compiler/src/codegen/emit-lift.d.ts` | **NEW** 8 type-declaration siblings for `.js` modules (`export declare` form) — the Types-gate TS7016 fix (#1302). 226 -> **236** files |
| `scripts/merge-on-green.sh` | **NEW** (257 lines) — merges a PR only when `gate` + `windows` pass on the current head and `tracking`'s failure-name set equals main's; never `--auto` (#1297) |
| `.gitattributes` | +`scripts/*.sh text eol=lf`, +`scripts/git-hooks/* text eol=lf` (#1297) |
| `compiler/self-host-v2/slice-m4/` | +4 test files (`server-call.test.js`, `server-call-check.test.js`, `server-call-core.test.js`, `server-call-runtime.test.js`) + `server-call-fixtures.js` (not a test). **38** test files |
| `compiler/tests/` | +6 — `unit/s454-callref-handler-rejection.test.js`, `browser/callref-handler-rejection-log-s454.browser.test.js`, `conformance/conf-PROTECT-EGRESS-FLOOR.test.js`, `unit/protect-failclosed-classify.test.js`, `unit/reserved-prefix-e-name-collides.test.js`, `unit/s454-handled-sql-expression-positions.test.js`. **1,597** |
| `compiler/tests/integration/bootstrap-conformance-counter/fixtures/runtime/server-stub/` | **NEW** fixture dir (#1303) |
| `conformance/cases/{reactive,server-db}/` | +6 — `reactive/reserved-prefix-declaration-pos`, `server-db/reserved-prefix-raw-driver-{neg,pos}`, `server-db/sql-handled-{decl-rhs,in-condition,match-scrutinee}-rt`. **1318** |
| `docs/changes/s454-*/` | dispatch BRIEF / progress dirs (historical by design — compliant) |

No directory removed. No file deleted. `self-host-v2` stays 21 `.scrml` modules (**36,127** lines; `analyze.scrml` 16,495, `parse.scrml` 3,887, `lower.scrml` 2,744, `check.scrml` 2,710, `print.scrml` 2,103); `slice-m1/runtime/runtime.js` 2,110.

### ⛑ FILE INVENTORY — THE LISTENER-REGISTRATION SURFACE, RE-COUNTED (supersedes the S453 inventory's "15 sites")

**The S453 inventory missed one site.** `emit-variant-guard.ts`'s in-arm non-delegable wiring registered listeners
with NO colouring at all; #1296 found it and coloured it. **There are SIXTEEN listener-registration call sites
into the colouring module, plus one more `colorHandlerAsync` call for the bare-ref form.** Re-grep before scoping:
`grep -rn -e 'colorActiveHandler(' -e 'colorHandlerAsync(' compiler/src | grep -v js-async-analysis`.

| file | L | symbols / sites |
|---|---|---|
| `codegen/js-async-analysis.ts` | 1671 | unchanged this window — `colorAsyncFunctionExpr` :1645, `colorActiveHandler` :1398, `wrapHandlerRejectionLog` :1539 (local), `DEFAULT_HANDLER_BOUNDARY_ID` :1505 |
| `codegen/emit-event-wiring.ts` | 2927 | `colorHandlerAsync` :484 (module-LOCAL). Called at **:1229** (bare-ref `onclick=handler`: colours `function(event) { handler(event); }`; keeps the direct reference when nothing is async) and **:1386** (every other form, incl. formFor submit since #1296; ONE call covering delegated registry :1605-:1613, non-delegable Approach A :1629 + `_scrml_nav_rewire` :1640, arm factory `armFactoryLines` :1415/:1426/:1443). Call-ref listener text now uses the AUTHOR name (`handlerName`), mangled later by emit-client's `post-fn-name-mangle` pass; `resolvedHandler` survives only for the bare-ref direct reference. `<errorBoundary>` async render: log then `return` (:2442 / :2463), `renderCall` with `.catch` :2492-:2497 |
| `codegen/emit-variant-guard.ts` | 1951 | **the 16th site** — `emitArmWireFunction` :436 colours each in-arm non-delegable handler ONCE with `colorActiveHandler` :1299 (statement-list opts from `activeHandlerStatementListColor`, ``boundaryId: `${eventName} ${placeholderId}` ``); `buildHandlerExpr` :1157 stays a pure lowering. NEW import of `js-async-analysis.ts` :98 |
| `codegen/emit-each.ts` | — | 1 `colorActiveHandler` site (:2536), unchanged |
| `codegen/emit-lift.js` | — | 13 `colorActiveHandler` sites, unchanged; typed now by NEW `emit-lift.d.ts` |

Open, filed by #1296 (known-gaps): `g-channel-onclient-handler-rejection-unobserved-s454`,
`g-channel-onserver-open-close-rejection-unlogged-s454`, `g-markup-interp-server-call-emitted-twice-s454` (MED),
`g-errorboundary-string-fallback-silently-dropped-s454`, `g-errorboundary-nested-propagation-unimplemented-s454`
(MED), `g-inarm-callref-handler-passes-event-s454`.

### ⛑ FILE INVENTORY — THE §14.8.9 PROTECT FLOOR'S COLUMN RESOLVER (re-walked at `f38697900`)

| file | L | symbols |
|---|---|---|
| `codegen/protect-egress.ts` | 1597 | `ProtectContext` :77, `buildProtectContext` :100, `ProtectedColumns` :142, `ProtectStatementKind` :220 (`select`/`write`/`no-rows`/`unknown`), `PROTECT_NO_ROW_LEADERS` :223, `PROTECT_WRITE_LEADERS` :229, `ProtectTok` :232, `holePayloadMayDisagree` :255, `lexProtectSql` :287, **`classifyProtectStatement` :417 (export)**, `analyzeProtectStatement` :428, `foldIdent` :459, `returningAsSelect` :575, `writeTargetFromOriginal` :619, **`resolveProtectedOutputColumns` :641** (every exit labelled `[proof]` -> `null` or `[unknown]` -> `{ all: true }`), `lexSqlEntry` :745, `opaqueColumnMayCarryProtected` :815 (now takes `known` tables), `nestedSelectReadsUnknownSource` :844, `SERVER_PROTECT_HELPER` :886 (`_scrml_protect_mediated` :916, `_scrml_protect_opaque_refusal` :925), `wrapWithProtectTag` :1152, `detectProtectedRawEgress` :1225, `findAuthoredResponseConstruction` :1530 |
| `codegen/rewrite.ts` | — | the resolver's caller: `resolveProtectedOutputColumns` :214 -> `wrapWithProtectTag` :225 |

⚠ The older protect routing row in primary.map.md cites `protect-egress.ts:449/:754/:221/:245` — those are
pre-#1299 positions; use the lines above.

### ⛑ FILE INVENTORY — THE RESERVED `_scrml_` PREFIX (new at `f38697900`)

| file | L | symbols |
|---|---|---|
| `validators/reserved-prefix.ts` | 545 | `RESERVED_NAME_PREFIX` :74, `RESERVED_PREFIX_CODE` :76, `ReservedPrefixDiagnostic` :78, `isReservedPrefixName` :86, `isReservedPrefixExemptPath` :96, `reservedPrefixMessage` :104, `isTabDesugaredReference` :217 (TAB-desugared `_scrml_worker_*` / `_scrml_input_*_` refs are not author names), **`runReservedPrefixCheck` :532**. Local: `walk` :305, `reparseMarkupBody` :448, `scanMatchArms` :478, `scanEngineRules` :497 — raw-captured regions are re-parsed with the SAME sub-parser the compiler uses later (no regex over source) |
| `api.js` | 4430 | import :78; stage `RESERVED-PREFIX` :1968, per TAB result, after `TRANSACTION-CHECKS` :1947 and `SCOPE-REDECLARE` :1956 |
| `module-resolver.js` | 1164 | NEW `isStdlibSourceFile(filePath)` (real-path compare against the stdlib root; a `/app/stdlib/` user dir is NOT exempt) + local `realPathOrNearest` |
| `pipeline-seam.ts` | 694 | `reserved-prefix.ts` added to the buildAST re-entry list (ten files) |

### ⛑ FILE INVENTORY — THE HANDLED-`?{}`-IN-AN-EXPRESSION SURFACE (new at `f38697900`)

| file | L | symbols |
|---|---|---|
| `expression-parser.ts` | 5302 | `SQL_REF_MARKER` :367, `GUARD_MARKER` :369, `extractHandledOperands` :464 (runs first in preprocessing, :3482), `restoreHandledOperands` :534; `TemplateSegment` / `tokenizeTemplateInterpolations` now exported |
| `codegen/sql-attempt.ts` | 141 | `SQL_ATTEMPT_FN` :29, `SQL_ERROR_VARIANT_FIELDS` :37, `SQL_ERROR_EXHAUSTIVE_VARIANTS` :52, `unhandledFailureThrow` :66, `SqlQueryExprShape` :73, `sqlQueryExprShape` :87, `SERVER_SQL_ATTEMPT_HELPER` :107 |
| `codegen/emit-logic.ts` | 6399 | `emitSqlQueryShape(shape, ctx, attempt)` :1183 (the ONE `case "sql"` lowering, reused), `emitNestedGuardExpr` :1230 (statement guard machinery in an IIFE; an arm that LEAVES -> `E-CG-003` :1242) |
| `codegen/emit-expr.ts` | 4712 | `resetExprGuardErrors` :212 / `drainExprGuardErrors` :217 (drained in `codegen/index.ts`); imports `emitSqlQueryShape` / `emitNestedGuardExpr` from `./emit-logic.js` :53 |
| `ast-builder.js` | 23,394 | `parseGuardArmsFromRaw(rawBang, filePath)` :18325 (declared in `ast-builder.d.ts`) |
| `type-system.ts` | 30,807 | `_guardedNodeHandlesSql` :15201, `_checkHandlerExhaustive` :15220 (E-TYPE-080), `_operandErrorVariants` :15236, `_checkExpressionPositionHandlers` :15248 (run :15181); SQL limb :12676 |
| `codegen/emit-server.ts` / `emit-tool.ts` / `emit-library.ts` | — | inject `SERVER_SQL_ATTEMPT_HELPER` iff `_scrml_sql_attempt(` is emitted |
| `route-inference.ts` | 7695 | :1797 walks `matchExpr` / `ifExpr` / `forExpr` of a decl (a `?{}` in a `match` scrutinee server-escalates) |
| `types/ast.ts` | 2183 | `SqlRefExpr.raw?` :2049 |

## S452-WRAP — STRUCTURE DELTA (`fd2f757d0..7ce905ac2`)

| path | change |
|---|---|
| `compiler/src/codegen/tenant-sql-subset.ts` | **NEW** (751 lines) — the §14.8.10 tenant floor's allow-listed SQL subset: lexer + one-statement grammar + write injection (#1293). 224 -> **226** src files |
| `compiler/src/commands/fix-arm-pipe.js` | **NEW** (564 lines) — the `scrml fix` `arm-pipe` rule (§19.4.5), chained from `fix-s66.js` (#1285) |
| `compiler/self-host-v2/effects.scrml` | **NEW** (241 lines) — the bootstrap's per-callable effect-summary engine (dpa-066 M0–M3, #1290). 21 `.scrml` modules, **33,342** lines |
| `compiler/self-host-v2/slice-m4/` | +`effects-summary.test.js` (196), +`diag-diff.js` (98, not a test). 34 test files |
| `compiler/tests/` | +3 — `commands/fix-arm-pipe.test.js` (389), `unit/arm-pipe-legacy-lint-s452.test.js` (293), `unit/tenant-sql-subset.test.js` (153). **1,591** |
| `conformance/cases/{error,engine}/` | +2 — `error/arm-pipe-legacy-handler`, `engine/arm-pipe-legacy-message` (legacy-purpose; must NOT be run through `scrml fix`). **1312** |
| `docs/changes/s452-{arm-pipe-deprecation,effect-summary,spec-security-forks,tenant-sql-subset}/` | +4 dirs of BRIEF / progress (historical by design — compliant) |

No directory added or removed. No file deleted.

### ⛑ FILE INVENTORY — THE §14.8.10 TENANT FLOOR (re-walked at `7ce905ac2`; supersedes the 649L / 920L rows below)

| file | L | symbols |
|---|---|---|
| `codegen/tenant-sql-subset.ts` | 751 | `SqlTok` :74, `SubsetLex` :84, `lexTenantSubset` :117, `TENANT_ROW_FUNCTIONS` :229, `TENANT_GROUP_AGGREGATES` :242, `TenantCode` :260, `TenantRefusalReason` :263, `TenantSource` :272, `TenantAnalysis` :285, `TenantAnalyzeOptions` :294, `tenantTableMentioned` :312, `analyzeTenantSql` :353, `topLevelFromOffset` :691, `addKeyColumnsBeforeFrom` :701, `injectInsertTenant` :725, `injectWriteTenantFilter` :743. Module-local: `analyzeSelect` :480, `analyzeInsert` :575, `analyzeFilteredWrite` :619, `firstDisallowedCall` :460, `withOrAbort` :716 |
| `codegen/tenant-egress.ts` | 896 | `TENANT_COLUMN` :68, `TenantContext` :77 (`driverFor` :90), `schemaWriteHazards` :105, `buildTenantContext` :222, `TenantKeyColumn` :249, `TenantRefusal` :267, `TenantScoping` :283, `analyzeTenantQuery` :296, `sqlMentionsTenantTable` :309, `TENANT_KEY_ALIAS_PREFIX` :317, `resolveTenantScoping` :345, `rewriteSelectAddTenantId` :356, `TenantWrite` :373, `classifyTenantWrite` :379, `acrossTenantInsertMissingTenantColumn` :399, `rewriteInsertAddTenantId` :453, `rewriteWriteAddTenantFilter` :475, `detectTenantRawEgress` :488, `TenantViolationCode` :579, `tenantFloorViolation` :590, `tenantAcrossIsAudited` :641, `SERVER_TENANT_HELPER` :657 (runtime `_scrml_tenant_request_scope` / `_scrml_tenant_write_key` / `_scrml_tenant_scope` / `_scrml_tenant_redact`), `tenantRequestScopeLines` :872, `wrapWithTenantScope` :887 |
| `codegen/emit-server.ts` / `codegen/emit-tool.ts` | — | the two `buildTenantContext` callers (:1957 / :346) |
| `codegen/rewrite.ts` | — | violation queue typed with the 3-code union :274; `drainTenantViolationsFromRewriter` :291 |

### ⛑ FILE INVENTORY — THE `|`-LED ARM (W-ARM-PIPE-LEGACY / `scrml fix arm-pipe`) SURFACE (new at `7ce905ac2`)

| file | L | symbols |
|---|---|---|
| `ast-builder.js` | 23,368 | `parseErrorTokens` records `arm.legacyPipe` (:17502-:17523: `pattern`, `canonical`, `binderAt` / `binderEndAt`, `bareBinder`, `parenFreeBinder`, `headEndAt`; offsets RELATIVE to the arm's `span.start`), attached :17575 |
| `type-system.ts` | 30,674 | `checkArmPipeLegacy` :18639 (fires the `!{}` lint), `armPipeLegacyMessage` :18695 (EXPORTED; shared wording) |
| `engine-statechild-parser.ts` | — | `parseMessageArms` records `legacyPipe {pattern, patternStart}` :2411; `parseEngineStateChildren` records `bodyRawOffset` |
| `symbol-table.ts` | 13,899 | `MessageArmEntry.legacyPipe` :576; message-arm lint emitted :7654 (imports `armPipeLegacyMessage` :160) |
| `commands/fix-arm-pipe.js` | 564 | `ARM_PIPE_RULE` :58, `fixArmPipe` :466 (exports); local `handlerArmLists` :105, `messageArmLists` :126, `componentsWithLegacyArms` :175 (reported, not rewritten), `planArmList` :267, `verifyByCompile` :402 |
| `commands/fix-s66.js` | 1700 | `IMPL1_SAFE_RULES` :96, `S66_RULES` :100, `fixArmPipe` chained :1276-:1280 |
| `scripts/bootstrap-conformance.ts` | — | `TWIN_RULES` :110 (= `S66_RULES` minus `arm-pipe`, so legacy cases are graded as written) |

## S453 — STRUCTURE DELTA (`d3e660a08..fd2f757d0`)

| path | change |
|---|---|
| `compiler/src/validators/lint-transaction.ts` | **NEW** (404 lines) — the §19.10.4 placement + exit checker (#1286). The ONLY new `compiler/src` file this window: 223 -> **224** |
| `compiler/self-host-v2/severity.scrml` | **NEW** (208 lines, **GENERATED**) — the bootstrap's `severityOf(code)` §34 table (#1270). Do not hand-edit; regenerate with `bun scripts/gen-bootstrap-severity.ts` |
| `compiler/self-host-v2/link.scrml` | **NEW** (246 lines) — §58 canonical link order: the path-sorted source SET -> link order -> parse (#1280). 20 `.scrml` modules, **32,844** lines total |
| `scripts/s34-catalog.ts` | **NEW** (103 lines) — the ONE parser of SPEC §34's `\| Code \| Section \| Trigger \| Severity \|` rows; no hardcoded line numbers (§34's range comes from the `## 34.` / `## 35.` headings) |
| `scripts/gen-bootstrap-severity.ts` | **NEW** (134 lines) — writes `severity.scrml`; `--check` runs in CI's NON-blocking `tracking` job |
| `compiler/self-host-v2/slice-m4/` | +3 test files — `determinism.test.js` (266), `error-rulings.test.js` (718), `severity.test.js` (82). 33 files, **1115 pass / 1 todo / 0 fail** |
| `compiler/tests/` | +10 files by the FACTS definition (1,578 -> **1,588**); the list is in test.map.md's S453 section |
| `conformance/cases/error/` | +8 cases — `handler-pipeless-arms-rt`, `implicit-tx-explicit-transaction-block`, `transaction-control-flow-neg`, `transaction-control-flow-pos`, `transaction-nested-neg`, `transaction-non-failable-fn-neg`, `transaction-stmt-match-arm-fail-neg`, `transaction-top-level-neg` |
| `conformance/cases/server-db/` | +2 EXECUTED cases — `sql-transaction-exit-rollback-rt`, `sql-transaction-in-function-rt` (corpus 1300 -> **1310**) |
| `docs/changes/s45{0,1,2,3}-*/` | +17 dirs of dispatch BRIEF / progress artifacts (historical by design — compliant) |

No directory added or removed. No file deleted.

### ⛑ FILE INVENTORY — THE HANDLER-ASYNC-COLOURING AND LISTENER-REGISTRATION SURFACE (re-walked at `fd2f757d0`)

**Why this is an inventory and not only a routing row.** Two independent S453 reviewers measured that the single
most load-bearing line in the whole 13-file map set for the #1283 arc was this map's `codegen/js-async-analysis.ts`
INVENTORY row (at :861, written in an earlier pass): it listed `colorAsyncFunctionExpr` and `colorActiveHandler`
side by side, which is what revealed there are **TWO colouring entry points** — redirecting the fix off the single
locus the dispatch brief had named and preventing a fix that would have left 14 listener sites silently unlogged.
That older row is now STALE on size (it says 1306 L; the file is **1671**) and predates `colorHandlerAsync`,
`ColorOpts.boundaryId` and `wrapHandlerRejectionLog`. The current inventory, with the symbols a dispatch brief
would name:

| file | L | symbols |
|---|---|---|
| `codegen/js-async-analysis.ts` | 1671 | The ONE async-colouring module. **Entry points:** `colorAsyncFunctionExpr` :1645 (a function EXPRESSION — i.e. every event listener), `colorAsyncStatements` :1628 (a statement list), `colorActiveHandler` :1398 (the per-element wrapper over `colorAsyncFunctionExpr`, resolving through `setActiveClientAsync` :1387's ambient resolver). **Supporting exports:** `analyzeRawJsFragment` :1151, `ColorOpts` :1432 (`boundaryId` :1472, `reactiveArg1Skip`, `reactiveArg1SkipKeep`), `handlerStatementListColor` :1610, `activeHandlerStatementListColor` :1619, `unanalyzableHandlerUses` :1421, `fnTextHasOwnAwait` :1335, `bodyTextHasOwnAwait` :1360, `schedulerNamesNotProvablyGlobal` :1198, `DEFAULT_HANDLER_BOUNDARY_ID` :1505, types `ResolvedAsync` :63 / `FreeAsyncResolver` :74 / `JsAsyncCall` :84 / `JsAsyncEscape` :90 / `JsAsyncUses` :96 / `ColoredBody` :120 / `ActiveClientAsync` :1377. **NOT exported:** `wrapHandlerRejectionLog` :1539, `freshHandlerErrVar`, `HANDLER_ERR_VAR` (`_scrml_async_err`). **`rootAsync`** — `ColoredBody.rootAsync` :124, computed at :698 / set :709 / returned :1099 — is the flag that decides the `async` prefix and, since #1283, the rejection arm; `colorAsyncFunctionExpr`'s `if (r.rootAsync)` branch :1666 is where the arm is attached |
| `codegen/emit-event-wiring.ts` | 2867 | `colorHandlerAsync` :479 — **a module-LOCAL function, NOT an export**; the delegated / non-delegable / arm-factory wrapper over `colorAsyncFunctionExpr`. Called EXACTLY ONCE, at :1345, with ``boundaryId: `${eventName} ${placeholderId}` ``. Registration shapes it feeds: (1) the **delegated handler registry** + ONE `document.addEventListener` ancestor walk (`_scrml_<idEvent>` registry :1553-:1581, `<registry>_arm` :1564/:1581); (2) the **non-delegable per-element** `addEventListener` (`Approach A` `querySelectorAll` + forEach :1405-:1410) re-attached on soft nav by `_scrml_nav_rewire` (:1606, boot wiring :2816-:2862); (3) the **arm/row-bound hoisted FACTORY** — `armFactoryLines` :1374, pushed :1385, spliced above the IIFE :1402, with `armWiredMode` `"walker"` (element property via `armWalkerPropName`) vs `"native"` (an arm inside an `<each>` row). Also the `<errorBoundary>` log sites :2401 / :2411 |
| `codegen/emit-each.ts` | 4454 | ONE row-handler registration — `colorActiveHandler` at :2536, ``boundaryId: `on${ev} <each> row` ``; imports `colorActiveHandler` + `activeHandlerStatementListColor` at :40 |
| `codegen/emit-lift.js` | 3531 | **13** per-element registrations, all `colorActiveHandler`: :1305, :1359, :1361, :1365, :1668, :1694, :1699, :1732, :1746, :1799, :1801, :1805, :3255 — each passing its own `on<event> lift …` `boundaryId`. The file header line :1 names `colorActiveHandler` as the §13.2 seam |

⛑ **THE COUNT THAT DECIDES A DISPATCH'S SCOPE: `colorHandlerAsync` is ONE call covering THREE registrations;
`colorActiveHandler` is FOURTEEN separate call sites (1 in `emit-each.ts` + 13 in `emit-lift.js`).** A change made
only at the `emit-event-wiring.ts` locus leaves all fourteen untouched. #1283 avoided that by moving the wrap into
`colorAsyncFunctionExpr`, which both entry points funnel through — but the boundary IDS still had to be threaded
at all 15 call sites by hand, and a 16th site added later will silently take `DEFAULT_HANDLER_BOUNDARY_ID`.

### ⛑ FILE INVENTORY — THE `transaction {}` / §19.10 SURFACE (new at `fd2f757d0`)

| file | L | symbols |
|---|---|---|
| `compiler/src/validators/lint-transaction.ts` | 404 | NEW. `runTransactionChecks(ast)` :143 (the only export used by the driver), `TransactionCode` :58, `TransactionDiagnostic` :60; internal `TxnCtx` :70 / `WalkState` :118 / `report` / `exitInMatchArm`. Emits `E-ERROR-001` (a `transaction` block outside a `!` function — includes the TOP-LEVEL refusal) :262, `E-ERROR-007` (nested block) :238, `E-TRANSACTION-CONTROL-FLOW` :168/:175/:188/:272/:318/:338 |
| `compiler/src/ast-builder.js` | 23,247 | `parseTransactionBlock()` :7803 — the ONE parser for the block, producing `kind: "transaction-block"`. Reached from `parseLogicBody`'s top-level loop :15697 AND from `parseOneStatement` :9689 (gated on a following `{`, so other uses of the word are unaffected). The §19.10.4 placement rules are deliberately NOT checked here |
| `compiler/src/codegen/emit-logic.ts` | 6155 | `case "transaction-block"` :4377 — BEGIN (`unsafe()`, `BEGIN` vs `BEGIN DEFERRED` by driver), COMMIT on normal completion, the `rollback` closure :4419-:4424, and the `finally` backstop. `_markTransactionExits(body, rollbackName)` :700 stamps `_scrmlTxnRollback` on every `fail` / `?` exit inside the block; the emission limbs that read it are :685-687 (a `fail`'s envelope return) and :3726-:3728 (a `?` propagation) |
| `compiler/src/api.js` | — | `import { runTransactionChecks } from "./validators/lint-transaction.ts"` :76; the stage runs at :1946 as `TRANSACTION-CHECKS`, per TAB result, between TAB and `SCOPE-REDECLARE` |
| `compiler/src/codegen/collect.ts` | — | `TRANSACTION_KINDS` :713 and the server-only classification :779/:800 — a `transaction-block` anywhere beneath a node makes it server-only |
| `compiler/src/codegen/emit-server.ts` | — | `_DB_SITE_KINDS` :1777 includes `transaction-block` (database-site resolution, §8.1.1) |


## S451 — STRUCTURE DELTA (`47c863556..d3e660a08`)

| path | change |
|---|---|
| `compiler/src/codegen/sql-handle-name.ts` | NEW — the one list of emitted database-handle names (`_scrml_sql`, `_scrml_sql_<n>`, `_scrml_sql_UNRESOLVED`) |
| `compiler/src/commands/fix.js`, `fix-s66.js` | NEW — `scrml fix` verb (§63.4 / §66.21 mechanical rewrites); CLI verbs 11 -> 12 |
| `compiler/tests/commands/fix-s66.test.js` | NEW (971 lines) |
| `compiler/self-host-v2/sql.scrml` | NEW (577 lines) — bootstrap U1a SQL fact scan (`sqlFacts`); 19 `.scrml` modules, 31,273 lines total |
| `compiler/self-host-v2/slice-m4/` | +10 test files: `attr-case-template`, `defer`, `diag-gate`, `error-model`, `if-chain`, `persist`, `program-shape`, `repeated-attr`, `server`, `show` |
| `compiler/tests/integration/bootstrap-conformance-counter/fixtures/twins/` | NEW — 5 twin fixtures (`excluded`, `extra-error`, `mapped`, `not-twinned`, `override-expect`) |
| `conformance/cases/persist/` | NEW category (5 cases); +5 `control-flow/` program-position cases, +2 `server-fn/` errorBoundary cases |
| `conformance/cases/**/dialect.s66` | NEW per-case file — overrides the generated §66 twin (read by `bootstrap-conformance.ts readDialectOverride`) |
| `docs/changes/s449-scrml-fix-s66-twins/`, `docs/changes/s451-*/` (15 dirs) | dispatch BRIEF/progress artifacts (historical by design) |

## S449-WRAP — STRUCTURE DELTA (`9bafb927..47c863556`)

| change | path | note |
|---|---|---|
| NEW | `compiler/src/codegen/sql-tx-guard.ts` | §19.10.6 emitted transaction-guard runtime (source lines + 2 emit helpers); imported only by `emit-server.ts` |
| NEW | `scripts/bootstrap-conformance.ts` | pure-bootstrap conformance classifier (639 lines); tracking only |
| NEW (generated) | `docs/bootstrap-conformance.md` | `--write` output of the counter; NOT a FACTS row (run-derived) |
| NEW | `compiler/tests/integration/bootstrap-conformance-counter/` | counter test + `fixtures/{codes,refused,runtime}/*` (one fixture per bucket) |
| NEW | `compiler/self-host-v2/slice-m4/gate.test.js` | §55.17.3 submit gate, fail-closed + bite; also runs the 8 `conformance/cases/forms/` S449 cases on the bootstrap |
| NEW | `compiler/tests/unit/sql-tx-guard-runtime.test.js`, `integration/sql-shared-connection-tx{,-review,-pg}.test.js` | transaction-guard tests |
| +8 cases | `conformance/cases/forms/` | `gate-*`, `surface-*`, `validator-*`, `errors-top-level-renders` (bootstrap-executed; impl#1 xfail) |
| +2 cases | `conformance/cases/sql/` | `transactions-concurrent-postgres-pos`, `transactions-concurrent-sqlite-e-sql-010-neg` |
| MODIFIED | `compiler/self-host-v2/{analyze,check,core,ingest,lower,measure,parse,print,walk}.scrml`, `slice-m1/runtime/runtime.js` | §55 surface/gate (#1250) + §66.2.5 opener keywords (#1249) |

No directory added or removed. `compiler/src` 219 -> **220** files.


## S450 — STRUCTURE DELTA (`6a592ed5c..9bafb927`)

| change | path | note |
|---|---|---|
| TRIMMED | `compiler/native-parser/` | 81 -> 44 tracked files; every `.scrml` mirror deleted; `.js` kept as a frozen impl#1 component (fixed call sites in the S450 stamp). Docs kept: `README.md`, `M5-*.md`, `M6.6-CONTRACT-DERIVATION.md` (stale — see non-compliance N-S450-2) |
| DELETED | `compiler/src/native-parser-canary/` | `within-node-classifier.ts` was its only file — directory gone |
| TRIMMED | `compiler/src/native-walker/` | `attrvalue-exprnode-walker.ts`, `exprtext-backfill-walker.ts` deleted; `engine-statechild-walker.ts`, `forbidden-js-native.ts` remain |
| DELETED | `scripts/native-parser-flip-harness.ts` | |
| TRIMMED | `compiler/tests/parser-conformance/` | parity harness gone; `corpus-enumerator.js`, `bench/`, `markup-bench/` remain |
| NEW | `compiler/src/codegen/server-session-guard.ts` | codegen backstop for a server `@session` read: emits `_scrml_server_session_refused` + records the hit; drained as `E-INTERNAL-SESSION-AMBIENT-SERVER`. Imports only `codegen/errors.ts` |
| NEW | `compiler/src/codegen/session-store-emit.ts` | `SESSION_STORE_SQLITE_LINES` / `SESSION_STORE_MEMORY_LINE` (+ `_TEXT`): the ONE emitted session-store declaration, shared by `emit-server.ts` (emit) and `protect-flow.ts` (summary recognizer) |
| NEW | `compiler/tests/helpers/native-ast.js` | test helper: native `FileAST` + live oracle |
| NEW | `compiler/self-host-v2/slice-m1/{effect,reset-on}.runtime.test.js`, `slice-m4/{effect,reset-on,value-positions}.test.js` | bootstrap gates for #1235 / #1238 |
| NEW | `docs/changes/s449-*` (8) + `docs/changes/s450-*` (4) | dispatch BRIEF/progress artifacts |

New dist output path: `<dist>/_scrml_local/<project-root-relative path>` — client-reachable plain-JS helpers copied by
`api.js` `createClientHelperRelocator` (`CLIENT_HELPER_DIR = "_scrml_local"`, `api.js:745`) (#1211).


## S447 — STRUCTURE DELTA (`78e4ddad..6a592ed5c`)
**REMOVED:** `compiler/self-host/` (v1 tree, 18 files / 22,433 lines; see the rewritten `### compiler/self-host/`
section below), `scripts/rebuild-self-host-dist.ts`, `scripts/rebuild-bs-dist.ts`, `scripts/rebuild-tab-dist.ts`.
**NEW files (9 source/test):**
| path | L | purpose |
|---|---|---|
| `compiler/tests/helpers/tmp-root-preload.js` | 235 | bun test preload: per-process TMPDIR root + layered cleanup (registered in `bunfig.toml`) |
| `compiler/tests/commands/dev-child-dies-with-parent.test.js` | 153 | `scrml dev` app-child orphan regression |
| `compiler/self-host-v2/codec.scrml` | 302 | bootstrap §57 wire codec, compile-time half (`WireTable` descriptor) |
| `compiler/self-host-v2/slice-codec/runtime/codec.js` | 348 | codec runtime half: `encode`/`decode`/`encodeText`/`decodeText`, `CodecDefect` |
| `compiler/self-host-v2/slice-codec/{codec,cross-impl}.test.js` | 581 · 179 | codec suites (CI `gate`) |
| `compiler/self-host-v2/slice-codec/{harness.js,bundle.scrml,src/types.scrml}` | 28 · 27 · 10 | slice harness + compile entry + test types |
**Changed in place:** `compiler/src/codegen/protect-flow.ts` (3,504 L, +685 — round 8), `compiler/src/commands/dev.js`
(2,282 L — child lifecycle), `compiler/src/commands/compile.js` (913 L — `--self-host` loader trimmed),
`compiler/scripts/build-self-host.js` (220 L). `compiler/src` file count unchanged (220 per FACTS).

## S446 — STRUCTURE DELTA (`464c9ab4d..78e4ddad`)
**4 new files under `compiler/src`** (explains the facts.ts +4 files / +2,891 lines delta):
- `compiler/src/commands/listen.js` — the one CLI `Bun.serve` wrapper (host binding), imported by `dev.js`/`serve.js`.
- `compiler/src/db-ownership.ts` — per-declaring-file SQLite ownership predicate (`decideOwnedDbFiles`, `sqlDeclaresTable`).
- `compiler/src/codegen/sqlite-file-target.ts` — runtime db-path/data-root resolution + the owning/referencing handle emitters.
- `compiler/src/program-role.ts` — the ancestor-based `<program>` top-level/nested role model (§4.12).

**11 new test files** (explains the facts.ts +11 test-files delta, exactly):
`compiler/tests/unit/cli-listen-host.test.js`, `unit/postfix-update-statement-boundary-s446.test.js`,
`unit/program-role-by-ancestor.test.js`, `unit/schema-holes-fail-closed.test.js`,
`integration/dev-db-no-side-file.test.js`, `integration/program-role-by-ancestor.test.js`,
`integration/program-role-implied-ancestor-s445.test.js`, `commands/build-sqlite-data-root.test.js`,
`commands/dev-serve-bind-host.test.js`, `browser/handler-server-assign-order-s446.browser.test.js`,
`browser/handler-stmt-list-residuals-s446.browser.test.js`. Zero test files deleted this window.

No directory added or removed; no change to `compiler/native-parser`, `compiler/self-host-v2` directory shape (one
line-level field registration inside `ingest.scrml`, see the header stamp). No entry-point changed.

## S445 — STRUCTURE DELTA (`5b1d0dab0..464c9ab4d`)
- `compiler/native-parser/body-top-prose.js` (NEW, 465L) — the S441 "prose must be DECLARED" body-top segmenter shared by
  both front ends: `segmentBodyTopItems`, `bodyTopQuoteStartsStatement`, `scanBodyTopLiteralClose`,
  `scanBodyTopTemplateClose`, `decodeLiteralText`, `htmlEscapeText`, `uncoveredSegments`. Imported by `src/ast-builder.js`,
  `src/block-splitter.js`, `native-parser/parse-markup.js`.
- `compiler/native-parser/body-top-coverage.js` (NEW, 439L) — what a body-top statement compiles: `declExtent`,
  `typeExprExtent`, `typeDeclExtent`, `functionHeadGap`, `liveExprIsInert`, `liveExprHasEffect`, `liveStmtNothingReason`,
  `liveLabelIsTargeted`, `liveStmtCompilesNothing`, `liveTreeDropsText`. Imported by `src/ast-builder.js`.
- `compiler/src/default-logic-exemption.ts` — **DELETED** (#1196). The row below describing it is SUPERSEDED.
- `compiler/src/unit-cc-exemption-list.json` — **DELETED** (#1196).
- `scripts/measure-loose-body-prose.ts` (NEW, 349L) — probe counting direct-child text runs in `<program>`/`<page>`/
  `<channel>` bodies on both front ends (measurement tool, no compiler change).
- `compiler/self-host-v2/slice-m4/` — now 16 test files (+5: `comment-escapes`, `core-additions`, `dpa045`, `failclosed`,
  `validators`).
- `compiler/src/` = 216 files (FACTS). No other file added or removed under `compiler/src/` in-window.

## S444b — LOCI ADDED (grep at `5b1d0dab0`; no new files — `compiler/src` unchanged since `108ca89be`)

| file | L | loci |
|---|---|---|
| `compiler/src/route-inference.ts` | 7074 | `runRI` `:4481`; Step 8 auth collection `:6351-6723` (8a / 8a-page / 8b / 8c / 8d / 8e / 8f); `rootCandidates` / `appRoot` `:6393-6398`; `findRoutePrefix` `:6856` (absolute-path match — see auth.map.md S444b); helpers `getExplicitAuthDeclaration` `:4283`, `collectFileAuthDecls` `:4393`, `pageAuthRequiredEntry` `:4439` |
| `compiler/src/codegen/index.ts` | 4134 | `runCG` `:1147`; `extractWorkerPrograms` `:1506` (called `:1675`) -> `generateWorkerJs` `:1681` -> `workerBundlesPerFile` -> `output.workerBundles` (`:2467`); `detectNestedProgramAuth` `:1621`; `E-PROGRAM-002` `:1647-1672` |
| `compiler/src/codegen/protect-flow.ts` | 2037 | §14.8.9 provenance analysis over EMITTED server modules. Exports: `ALL_COLUMNS_LABEL` `:99`, `ProtectFlowLeak` `:430`, `ProtectTagSite` `:446`, `ProtectFlowResult` `:455`, `sqlSkeleton` `:471`, `ProtectStripInfo` `:494`, `registerProtectModule` `:510`, `takeProtectRegistry` `:515`, `CompileModule` `:521`, `analyzeCompileProtectFlow` `:546`, `buildProtectFlowDiagnostics` `:654`, `analyzeProtectFlow` `:664`. Allowlists: `DERIVER_CALLS` `:326`, `STDLIB_DERIVERS` (auth/crypto), `DERIVED_OPERATORS`, `DERIVED_METHODS` `:361`. Flow: `emit-server.ts:6982` `registerProtectModule` -> `api.js` `runProtectFlow` `:3205` (`takeProtectRegistry` + `analyzeCompileProtectFlow`, `./X.server.js` imports resolved to their source) -> `E-PROTECT-006`. Registry reset `api.js:2853` |
| `compiler/src/codegen/protect-egress.ts` | 981 | §14.8.9 runtime floor: `buildProtectContext` `:93`, `resolveProtectedOutputColumns` `:206`, `SERVER_PROTECT_HELPER` `:371`, `wrapWithProtectTag` `:536`, `detectProtectedRawEgress` `:609`, `findAuthoredResponseConstruction` `:914` |
| `compiler/src/codegen/emit-worker.ts` | 123 | §4.12.4 worker bundles. `workerBundleFilename(sourceFile, name)` `:42` -> `<page>-<name>.worker.js`; `workerBundleSuffix` `:47`; `generateWorkerJs(name, children, whenMessage)` `:59`; `rewriteWorkerSend` `:119` (bare `send(` -> `_scrml_reply(_scrml_reply_to, …)`). Wire: parent->worker `{ id, data }`, worker->parent `{ replyTo, data }` |
| `compiler/src/codegen/emit-client.ts` | 4627 | parent side of workers `:2424-2459`: `new Worker(workerBundleFilename(...))`, `_scrml_pending` Map, one `addEventListener("message")` reply router, `.send(data)` returns a Promise keyed by id. `when message from <#name>` hooks add their own listener (`emit-logic.ts:4162`) |
| `compiler/src/api.js` | 4103 | worker bundles: pre-write gate `pushArtifact(…, workerBundleFilename(…))` `:3380`; write `writeOutput(filePath, workerBundleSuffix(name), …)` `:3746` (never content-hashed); `.worker.js` seeds the client-asset manifest `:3523-3526`; `collectClientAssets` -> `.scrml-client-assets.json` `:3935`. `BUILTIN_TYPES` identity rule `:2471-2479` |
| `compiler/src/commands/build.js` | 1143 | `generateServerEntry` `:361` (called `:1072` with `result.clientAssets`); §47.13 allowlist baked as `_SCRML_CLIENT_ASSETS` `:576` + `STATIC_POLICY_EMIT_SOURCE` `:578`; static dispatch `:604-620` |

## S444 — STRUCTURE DELTA (`cf62b415..108ca89be`)

`compiler/src` — **+4 files** (217 per FACTS):
| file | L | purpose |
|---|---|---|
| `static-serve-policy.js` | 152 | §47.13 static-serving allowlist for `scrml dev` and the build: `CLIENT_ASSET_MANIFEST` (`.scrml-client-assets.json`), `collectClientAssets`, `readClientAssetManifest`, `relFromRoot`, `STATIC_POLICY_EMIT_SOURCE` (the emitted copy's source text) |
| `static-serve-policy-emitted.js` | 94 | the runtime half inlined into emitted servers: `_scrml_static_request_path`, `_scrml_static_denied`, `_scrml_static_servable` (one source so dev and built servers cannot drift) |
| `codegen/js-async-analysis.ts` | 1306 | acorn-based async coloring of raw JS fragments / handler text: `analyzeRawJsFragment`, `colorAsyncStatements`, `colorAsyncFunctionExpr`, `colorActiveHandler`, `unanalyzableHandlerUses`, `schedulerNamesNotProvablyGlobal` (#1163 F4/F5) |
| `codegen/protect-flow.ts` | 2037 | compile-wide provenance analysis of emitted server modules for `protect=` columns reaching a client-egress sink (`E-PROTECT-006`, #1171): `analyzeCompileProtectFlow`, `analyzeProtectFlow`, `buildProtectFlowDiagnostics`, `registerProtectModule` / `takeProtectRegistry` |
Heavier edits inside existing modules: `route-inference.ts` (page auth, W-AUTH-*), `type-system.ts` (E-ERROR-002 handler
forms, bare `fail .Variant`, built-in error-type shadowing), `ast-builder.js`, `codegen/scheduling.ts` +
`emit-client.ts` (`@cell = serverFn()` awaited in place, #1158), `codegen/emit-server.ts`, `codegen/emit-worker.ts`,
`codegen/index.ts` (`detectNestedProgramAuth`, E-PROGRAM-002), `commands/dev.js` / `build.js`, `api.js`.

### `compiler/self-host-v2/` — changes to the stage-ownership table below (S440 table otherwise current)
| module | L at `108ca89be` | change |
|---|---|---|
| `css.scrml` | 543 | **NEW (#1149)** — STYLESHEET emitter: `CssUnit` (core.scrml) -> CSS output tree -> text. Entries `lowerCss`, `printCss`, `emitCss`, `cssFootprint`, `resetRules`, `tokenStmts`. Owns the user-stylesheet part of `FileOutput.css` (CG sub-seam `CSS`, `pipeline-seam.ts`) |
| `css-ingest.scrml` | 920 | **NEW (#1149)** — THROWAWAY shim: impl#1 FileAST -> `CssUnit` (`ingestCss(ast, mode) -> CssIngest { unit, why }`, `parseSelector`, `parseValue`). Deletion condition in its header: delete when the bootstrap front end produces the stylesheet Core from source |
| `core.scrml` | 436 | + stylesheet Core types (`CssUnit` and selector / decl / rule / theme-token shapes) |
| `analyze.scrml` | 6985 | typer rounds #1151/#1157/#1159/#1167/#1169 (conditions, operators, int, arity, handles, dup keys, narrowing, full argument/return checks, optional sequences); now emits SPEC names `E-CALL-ARITY`, `E-EACH-NOT-SEQUENCE`, `E-STRUCT-DUPLICATE-KEY` (the `E-BOOTSTRAP-*` names for these are gone) |
| `parse.scrml` · `lower.scrml` · `lex.scrml` · `ast.scrml` · `ingest.scrml` | 1955 · 1140 · 1204 · 190 · 1357 | grown for the four §66.19 programs (#1164) and tape grow/shrink grants |
| `slice-m3/` | — | + `css-substitute.js` (CSS sub-seam substitute), `css-oracle.js` + `css-oracle/{conformance,core,sources}/` (SPEC-derived computed-style oracles, Chromium via puppeteer), `css.core.scrml`, `css-bundle.scrml`, `encode.js`, `css.test.js`, `css-half.test.js`, `bench/{css-identity,css-oracle-both,css-r26,bite-front}.js` |
| `slice-m4/` | — | **NEW DIR (#1164)** — the four remaining SPEC §66.19 worked programs compiled from SOURCE and RUN: `src/{audit,engine,form,theme}/`, `harness.js` (reuses `slice-m2` `loadM2` / `frontEnd`), `fixtures.js`, 11 `*.test.js` |


## S440 — STRUCTURE DELTA (`fb21983a..cf62b415`)

`compiler/src` — **+2 files** (213 per FACTS): `codegen/local-async-fns.ts` (521, #1139) and `commands/refusal-gate.js`
(34, #1125). Other movement is inside existing modules: `runtime-template.js` (#1137), `codegen/emit-server.ts`
(#1137 + #1139), `codegen/emit-library-shared.ts` / `emit-functions.ts` / `emit-library.ts` / `emit-tool.ts` /
`emit-expr.ts` / `emit-logic.ts` / `async-combinators.ts` (#1139), `expression-parser.ts` + `codegen/code-segments.ts`
(#1131), `commands/build.js` / `compile.js` / `select-request-onion.js` + `api.js` `beforeWrite` (#1125).

### `compiler/self-host-v2/` — the bootstrap compiler (impl#2, written in scrml) — CURRENT STAGE OWNERSHIP at `cf62b415`

This table is the whole bootstrap as it stands (it supersedes the S438 and S437b tables below, which predate M3).
Design authority: dpa-051 (scrml-support) + SPEC §66. Pipeline (the S233 re-cut, R1 (a)):
`source -> lex -> parse -> FileAst -> analyze -> TypedProgram -> lower -> CoreProgram -> check -> print -> { js, html }`.
Every module is a `${ export … }` library; nothing in it reads `compiler/src` (only the JS test harnesses call impl#1).

| module | L | stage | entry point(s) | owns |
|---|---|---|---|---|
| `lex.scrml` | 1168 | LEX | `lex(src) -> Token[]`, `lexFrom(src, pos, stop: LexStop) -> LexRun` | pure fold over a `(mode, event)` table; `Token`/`TokenKind`/`Span`; `lexFrom` lexes one logic region for the parser (the ONLY lexer) |
| `ast.scrml` | 179 | FileAst types | (types only) `FileAst`, `AExpr`/`AExprK`, `AStmt`/`AStmtK`, `ABlock`, `AType`, `AFn`, `ADecl`, `AElem`, `ANode`, `AItem`/`AItemK`, `AProgram`, `Diag`, `mkSpan` | the parser's output; every node `{ nid, span, … }`; bodies are trees (§4) |
| `parse.scrml` | 1664 | PARSE | `parseFile(path, src, firstId) -> Parsed { ast, diags, nextId }`; also `parseAssign`, `parseBlock`, `parseLogicItems` | char-level MARKUP scanner (tags/attrs/text/comments/openers) + token-level logic parser (precedence climbing); NodeIds dense from `firstId`; diagnostics `E-DECL-OPENER-EXPR-UNPARENTHESIZED`, `E-DECL-ILLEGAL-FIELD-NAME`, `E-PARSE-*`, `E-BOOTSTRAP-UNSUPPORTED` |
| `analyze.scrml` | 4681 | ANALYZE (binder + edit classifier + scope pass + typer) | `analyze(files: FileAst[], entry) -> TypedProgram { files, tables, diags }`; lookups `nameFact`/`valueFact`/`effectFact`/`bindFact`/`elemFact`/`attrFact`/`declInfo`/`exprType` | THE BINDER (only Sym minter); `Tables` = program/types/decls/fns/handles + six NodeId-indexed FACT-FAMILY tables (`names`, `values`, `effects`, `binds`, `elems`, `attrs`; #1122) + `annots` + `typing` (#1117); the edit classifier (`WriteFact`, `SpreadWrite`, `SnapField`); see sections below |
| `lower.scrml` | 994 | LOWER | `lower(tp: TypedProgram) -> Lowered { core, diags }`; `lowerExpr` | desugar only ("decides nothing"): L4/L5/L7/L9/L11/L13-L19, O58 (b) spread -> snapshot `Let`s + one `Stmt.Commit` (#1129); internal `lowerBlock`/`lowerStmt`/`lowerNode`/`lowerElem`/`lowerField`/`lowerRenders`/`lowerDecl`/`lowerFn` |
| `core.scrml` | 370 | Core IR | constructors `mkSym`, `block`, `litInt`/`litStr`/`litBool`/`litVariant`, `readField`, `el`, `onEvent`, …; lookups `findDecl`, `findTypeDef`, `findFn`, `capOwner`, `grantsAnyWrite` | data only; `Stmt` = `Let`/`Assign`/`Write`/**`Commit(writes)`** (NEW #1129)/`If`/`Return`/`Eval` |
| `walk.scrml` | 351 | traversal | `kids`, `allNodes`, `sharedRefs`, `boundSyms`, `assignedSyms` | the ONE structural traversal of Core |
| `check.scrml` | 543 | CHECK | `checkCore(p: CoreProgram) -> string[]` | Core well-formedness C1-C7 (C7 NEW #1129: a `Commit` holds >= 2 Writes of Locals); the printer's precondition |
| `names.scrml` | 154 | naming | `emptyNames`, `mint`, `nameOf`, `keyText`, `isReserved` | the ONE NameSupply (minted names never contain `$`) |
| `js.scrml` | 302 | JS tree | `printModule`, helpers `jid`/`jstr`/`jnum`/`jmember`/`jcall`/… | JS output tree + one-shot text printer |
| `html.scrml` | 94 | HTML tree | `printPage`, `escText`, `escAttr`, `isVoid` | HTML output tree + one-shot printer |
| `print.scrml` | 1209 | PRINT | `printProgram(p, jsFile, runtimeFile) -> Output { js, html }` | Core -> JS tree + HTML tree; per declaration: descriptor, edge tables, factory `mk_<decl>`, render `render_<decl>`, shared getter |
| `measure.scrml` | 137 | metric | `countNodes`, `kindOf` | Core size by node kind |
| `ingest.scrml` | 1355 | **THROWAWAY** (NEW #1118) | `ingest(files: IFile[]) -> Ingested { core, why }`, `footprint(p) -> string[]`, `IVal` builders | impl#1 FileAST -> Core (legacy forms per SPEC §66.21) so the bootstrap printer+runtime can be graded on the corpus; never guesses (unmapped -> `why`, case = not-yet). DELETION CONDITION: when bootstrap `analyze` produces a TypedProgram for the corpus (delete with `slice-m3/substitute.js`) |

**`analyze.scrml` internal layout (locate by banner text):** `THE TABLES` (exported types, :49) · family tables +
NodeId index (:138-:315) · `Phase A` — program shape: types, declarations, fields, handles (L10), functions (:390) ·
`Phase B` — bodies: expressions (:1445), `Writes — THE EDIT CLASSIFIER` (:1967, incl. RULED S440 strict snapshot
:2264 and dup-override :2289), statements (:2495), views (:2680), Phase B driver (:2896) · `THE SCOPE PASS` (:2956,
`checkScopes`) · `THE TYPER` (:3329, `typeProgram`; types-as-values :3491, checks :3859, expressions :3944, call
arity :4073, statements :4099, views :4364) · `Entry` (:4607, `analyze`). Pass order in `analyze`: `phaseA` ->
`checkImports` -> `phaseB` -> `indexed(facts)` -> `checkScopes` -> `typeProgram`.

**Bootstrap-local codes still in `analyze.scrml`:** `E-BOOTSTRAP-UNSUPPORTED`, `E-BOOTSTRAP-REDECLARE`,
`E-BOOTSTRAP-CALL-ARITY`, `E-BOOTSTRAP-EACH-NOT-SEQUENCE`, `E-BOOTSTRAP-DUP-OVERRIDE`. ⚑ At `cf62b415` the SPEC
(#1133) NAMES three of these shapes: `E-CALL-ARITY` (§7.3), `E-EACH-NOT-SEQUENCE` (§17.7.2), `E-STRUCT-DUPLICATE-KEY`
(§14.3/§66.11.3, covers the spread-override shape). The bootstrap has NOT been renamed to them (see error.map.md).

**Slice layout (test + bench beds; all OUTSIDE the bunfig test root):**
| dir | compile entry | harness | what it holds |
|---|---|---|---|
| `slice-m1/` | `bundle.scrml` | `harness.js` (`loadBootstrap`, `loadBundle`, `MODULES`, `SELF_HOST_V2`), `load-program.js` (happy-dom loader: `loadProgram`, `click`, `instancesOf`, `expectNoPageErrors`), `cores.js` (`SLICE_CORE=lowered` switch) | `runtime/runtime.js` (583 — the bootstrap's own runtime: `cell`, `derived`, `effect`, `instance`, `shared`, `construct`, `checkEdge`, `transition`, `append`/`prepend`/`setIn`, `eq`, `template`/`at`/`insert`/`text`/`attr`/`on`/`cond`/`slot`/`each`); hand-built oracle Cores `counter/dropdown/valuesem.core.scrml`; 6 tests; `bench/{mutations,sizes,value-edit.bench}.js` |
| `slice-m2/` | `bundle.scrml` | `harness.js` (`loadM2`, `M2_MODULES`, `source`), `lowered.js` (`frontEnd`, `compileProgram`, `loweredCores`, `PROGRAMS`), `compare.js` (`compareCore` — Core equality modulo Sym renumbering) | `src/{counter,app,lib/dropdown}.scrml` = SPEC §66.19.1 / §66.19.3 VERBATIM (drift-guarded by `parse.test.js`); `fixtures/{app-early,app-reorder,valuesem}.scrml`; 6 tests (`front`, `parse`, `lower`, `tables`, `typer`, `typer-gap`); `bench/measure.js` |
| `slice-m3/` (NEW #1118) | `bundle.scrml` | `harness.js` (`cgArgsOf` — impl#1 front end with a CG stage override; `caseSource`; `CASES`), `substitute.js` (the CG substitute: `encode`, `ingestFiles`, `footprint`, `runCG`, `executeClient`, `loadM3`) | 3 tests (`ingest`, `footprint`, `bite`); `bench/bite-matrix.js` + `bench/bite-lib.js` (`judgeDeaths`) |

**Growing to the six §66.19 programs (for the parse/lower lane):** SPEC §66.19 = .1 counter, .2 validated form
(`single` save-status), .3 `<dropdown>` library x3, .4 theme library, .5 append-only audit log, .6 engine as a
`single` declaration (`compiler/SPEC.md` `### 66.19 Worked programs`). Only .1 and .3 exist as sources today
(`slice-m2/src/`); a new program needs a `src/` file (SPEC-verbatim, extend `parse.test.js`'s drift guard) and a
`PROGRAMS` row in `slice-m2/lowered.js`. There is no hand-built oracle Core for .2/.4/.5/.6.

### `compiler/src/` — new modules
| path | L | owns | consumed by |
|---|---|---|---|
| `codegen/local-async-fns.ts` | 521 | nested-helper async coloring (#1139): `annotateLocalAsyncFns(fnNode, opts)`, marks `LOCAL_CALLEE_MARK` / `LOCAL_REF_MARK` / `LOCAL_ASYNC_DECL_MARK`, readers `localCalleeOf` / `localFnRefOf` / `localAsyncDeclRoot`, `calleesThroughDirectlyCalledNestedFns`, `anchorDiagnosticSpan` | `emit-library-shared.ts` (`annotateNestedAsyncHelpers` wrapper), `emit-expr.ts`, `emit-logic.ts`, `async-combinators.ts`, `emit-server.ts`, `emit-tool.ts` |
| `commands/refusal-gate.js` | 34 | `APPLICATION_SCOPE_REFUSALS` (`E-MW-007`, `E-MW-008`), `hasApplicationScopeRefusal`, `noFilesWrittenLine` | `commands/build.js`, `commands/compile.js` (via `compileScrml`'s `beforeWrite` option, `api.js`) |


## S438 — STRUCTURE DELTA (`9941a504c..fb21983a`)

`compiler/src` — **no file added or removed** (211 per FACTS, flat). Source movement is inside existing modules:
`ast-builder.js` (+290/-~, match-arm alternation scan helpers), `block-splitter.js` (+116, quoted-string brace
probe), `emit-control-flow.ts`/`emit-logic.ts`/`type-system.ts` (match-arm lowering), `route-inference.ts` +
`codegen/session-config-resolve.ts`/`index.ts`/`emit-server.ts` (session-config resolution order), `schema-differ.js`
(+547) + `gauntlet-phase1-checks.js` (+111, `<schema>` raw-DDL head validation), `api.js` (+70), `host-import.js`
(+55, fail-closed a function-body `import:host`). `compiler/native-parser/parse-expr.js` (separate,
opt-in `--parser=scrml-native` pipeline, excluded from the FACTS count) took the mirrored uncap fix to
`scanPastPayloadParen` (+7/-2).

### `compiler/self-host-v2/` — bootstrap impl#2, NOW TWO SLICES (M1 #1105 + **M2 #1109**, `072741ca`)

The ⏳ NOT-MAPPED note in the prior (S437b) section below is RESOLVED — M2 landed on `origin/main` mid-pass last
window and is now current at this stamp.

| path | L (`fb21983a`) | Δ vs `9941a504c` | what it owns |
|---|---|---|---|
| `core.scrml` | 362 | +8 | Core IR — **`FieldDef` gains `graph: TransitionGraph \| not`** (D12b, a struct sub-field's `rule=` graph now has somewhere to live); shared lookups `contractedSubFields`/`graphSubFields` |
| `check.scrml` | 509 | +34 | Core well-formedness + **new check C7** (a whole-value struct `.Replace` must satisfy every contracted sub-field, recursing through struct sub-fields) |
| `print.scrml` | 1157 | +263 (net) | a declaration's factory now runs inside `rt.construct(inst$, () => …)`; unconditional instances are created (not just mounted) in `mk_<decl>`, conditional ones still create at their arm/row/slot |
| `lex.scrml` | 1166 | +106 (net) | pre-existing lexer, touched for M2 tokens |
| `walk.scrml` | 348 | +1 | traversal, unchanged shape |
| `measure.scrml` | 136 | +1 | unchanged shape |
| `ast.scrml` | 175 | **NEW** | M2's own parser AST (separate from Core IR — `parse.scrml` builds this, `lower.scrml` converts it to Core) |
| `parse.scrml` | 1641 | **NEW** | the front end's parser: source text → `ast.scrml` tree |
| `lower.scrml` | 993 | **NEW** | `ast.scrml` tree → Core IR; M2's central claim is `lower(parse(src)) == ` M1's hand-built oracle (Fork-A proof) |
| `slice-m1/runtime/runtime.js` | — | +132/-~ | `Instance.kids`; `construct(inst, body)`; `shared()` registers before running its factory (fixes a re-entrant-construction infinite recursion); OWED-seed settlement for a `let` created during construction |
| `slice-m1/` (rest) | — | small | fixture `dropdownEarlyReadCore()` added (§66.19.3 early-read-before-mount case); suite **73/73 pass** (measured this pass, not the mid-log 68→72 in `progress.md`) |
| `slice-m2/` | 16 files | **NEW dir** | M2 test bed: `harness.js` (27, compiles via impl#1), `compare.js` (78, Core-tree diff for the Fork-A proof), `lowered.js` (73), `bundle.scrml` (24), `fixtures/{app-early,app-reorder,valuesem}.scrml`, `src/{app,counter,lib/dropdown}.scrml`, 4 `*.test.js` (`front.test.js` 367, `parse.test.js` 164, `lower.test.js` 88, `typer-gap.test.js` 58), `progress.md` (append-only log) |

`compiler/self-host-v2/` stays OUTSIDE the bunfig test root (plain `bun test` never runs it); CI's bootstrap step
now runs `slice-m1/` + `slice-m2/` + `slice-m1/` again with `SLICE_CORE=lowered` + the v2 lexer oracle (see
build.map.md). **Re-run this pass:** `slice-m1` 73/73, `SLICE_CORE=lowered slice-m1` 73/73, `slice-m2` **72/74 —
2 FAIL, both a Windows-CRLF-checkout artifact of the SPEC-verbatim drift guard, not a landed defect** (see the
S438 STAMP block and test.map.md).

### `compiler/src/schema-differ.js` — NEW exported recognizer
`findRejectedCreateTableHeads` — a structural (not regex-only) scan of a `<schema>` body for a raw `CREATE TABLE`
head that is schema/database-qualified (E-SCHEMA-012) or unreadable (E-SCHEMA-013); the same comment/literal
exemption as the rest of the `<schema>` DSL reader. Consumed by `gauntlet-phase1-checks.js`'s `<schema>` body
checks. See schema.map.md and error.map.md.


## S437b — STRUCTURE DELTA (`d02738767..9941a504c`)

`compiler/src` — **no file added or removed** (213 tracked, 211 per FACTS). The window's source movement is inside existing
modules (handler fix #1106) and in the bootstrap tree.

### `compiler/self-host-v2/` — bootstrap impl#2, slice M1 (#1105). Design authority: dpa-051 (scrml-support) + SPEC §66
| path | L | what it owns |
|---|---|---|
| `core.scrml` | 354 | the **Core IR** — data only: `Sym`, `Type`, `TypeDef`, `Expr`, `Stmt`, `View`, `Field`, `Decl`, `CoreProgram` + pure constructors (`mkSym`, `litInt`, `readField`, `onEvent`, …) and lookups (`findDecl`, `findFn`, `capOwner`) |
| `walk.scrml` | 347 | the ONE structural traversal of Core (`allNodes`, `sharedRefs`, `boundSyms`, `assignedSyms`); total `match`es, no default arm |
| `js.scrml` | 308 | JS output TREE (`JsExpr` / `JsStmt` / …) + one-shot text printer `printModule` |
| `html.scrml` | 94 | HTML output TREE (`HNode`, `HAttr`, `Page`) + `printPage` |
| `names.scrml` | 154 | the ONE name supply — emitted identifiers are MINTED (`mint`, `nameOf`, `NameTable`, `emptyNames`) |
| `print.scrml` | 944 | Core → JS tree + HTML tree → text (`printProgram`) |
| `check.scrml` | 475 | Core well-formedness (`checkCore`) — the printer's precondition and M2's gate on `lower` |
| `measure.scrml` | 135 | Core size by node kind (`countNodes`) |
| `lex.scrml` | 1068 | pre-existing lexer (slices 1-3), touched this window |
| `slice-m1/` | — | M1 test bed: `runtime/runtime.js` (536 — instance-record runtime: `Cell`, `Derived`, `Scope`, `Instance`, `declare`, `instance`, `shared`, `snapshot`, `handle`/`bindHandle`, `transition`, `edges`); hand-built Core programs `counter.core.scrml` / `dropdown.core.scrml` / `valuesem.core.scrml` (targets SPEC §66.19.1 / §66.19.3); `bundle.scrml` (compile entry); `harness.js` (compiles the bundle with impl#1 `compileScrml`); `load-program.js` (happy-dom loader); 6 `*.test.js`; `bench/`; `progress.md` (append-only log, impl#1 findings F11-F16) |

`compiler/self-host-v2/` is OUTSIDE the bunfig test root — a plain `bun test` never runs it; CI runs it explicitly (build.map.md).

### `compiler/self-host/` — REMOVED (S447 #1230)
The frozen v1 tree (18 tracked files, 22,433 lines) is GONE from git; `git ls-files compiler/self-host` is empty. Only a
gitignored, untracked `compiler/self-host/dist/` may linger on an old checkout — not source, ignore it. The
`scripts/rebuild-{self-host,bs,tab}-dist.ts` builders were deleted with it; `compiler/scripts/build-self-host.js` now builds
only the `stdlib/compiler/` module-resolver + meta-checker pair. The bootstrap compiler is `compiler/self-host-v2/` (above);
`scripts/hybrid.ts` drives it. The parser-conformance corpus root "self-host" was re-pointed to `compiler/self-host-v2`.

### `scripts/`
`scripts/lint-no-default-arm.js` (256, NEW) — fails if a `match` over an enum under `compiler/self-host-v2/` has a default
arm (dpa-051 §3.4); also flags a non-first alternation arm. Tokenizes with `compiler/native-parser/lex.js`. Opt-out:
`// no-default-arm: <reason>`. Exports `lintText`, `lintTree`.

⏳ NOT MAPPED: bootstrap M2 (#1109, `072741ca9` — `parse.scrml`, `lower.scrml`, `slice-m2/`) landed on main mid-pass, AFTER this stamp, and also edits the M1 files above (`core/check/print/lex/walk/measure.scrml`, `slice-m1/runtime/runtime.js`, `ci.yml`). Line counts here are at `9941a504c`; locate by symbol.

## S437 — NEW MODULES (`787d4cb4..d02738767`, 16 in `compiler/src` + 3 elsewhere)

| path | L | what it owns | consumed by (grep at `d02738767`) |
|---|---|---|---|
| `compiler/src/pipeline-seam.ts` | 678 | the STAGE-SUBSTITUTION SEAM: `STAGE_SEAMS` (36 named stages, pipeline order, `LINT-GHOST` .. `CG`), `createStageSeams`, `checkStageOutput`, `resolveSubstitute`, `StageSeamError`. No substitution → the TS stage function object itself (byte-identical compile). | `api.js:19` (`createStageSeams` at `:1060`), `scripts/hybrid.ts` |
| `compiler/src/precg.ts` | 34 | Stage 3.004 PRECG body moved VERBATIM out of `api.js` so the seam can swap it: `runPRECG(fileAST)` (PGO flags, program config, file shape, MCP opt-in). | `api.js:18` (`seams.pick("PRECG", runPRECG)` `:1615`) |
| `compiler/src/host-import.js` | 614 | `import:host` (§21.3.1) + `[capabilities] host-import` (§22.13): `readHostImportCapabilities`, `validateHostImports` (E-IMPORT-003/008/009, E-MANIFEST-001), `scanHostModule`, `MANIFEST_FILE_NAME = "scrml.toml"`, `SELF_HOST_PATH_PREFIX = "stdlib/compiler/"`. | `api.js:69` (gate after TAB, `:1549`), `module-resolver.js` (`checkHostImport`, E-IMPORT-006) |
| `compiler/src/native-walker/forbidden-js-native.ts` | 360 | E-CLASS-NOT-IN-SCRML / E-DYNAMIC-IMPORT-NOT-IN-SCRML decided on the NATIVE parser's tree in BOTH pipelines; the default pipeline runs the native parser per file FOR THIS FAMILY ONLY and discards every other native code. | `api.js:76` (stage `REJECT-CLASS-DYNAMIC-IMPORT`, `:1571`) |
| `compiler/src/validators/lint-defer.ts` | 649 | §19.16.3 structural `defer` checker over the LIVE-shaped `defer-stmt` node: `runDeferChecks`. | `api.js:74` (stage `DEFER-CHECKS`, `:1788`) |
| `compiler/src/validators/defer-structure.ts` | 221 | tree helpers for lint-defer (parses text bodies with the compiler's own front-end; lazy `require` to avoid a codegen import cycle). | `lint-defer.ts` |
| `compiler/src/validators/lint-redeclare.ts` | 157 | §7.3.3 `E-SCOPE-REDECLARE` — same-block `let`/`const`/`lin`/`function` redeclaration (incl. params in a fn's top block). | `api.js:75` (stage `SCOPE-REDECLARE`, `:1797`) |
| `compiler/src/codegen/lower-defer.ts` | 147 | §19.16.6 lowering: each block containing `defer` gets `_scrml_defers_N` + an in-place `try { } finally { }` LIFO runner. `lowerDefers`, `lowerDeferList`, `listHasDefer`, `isDeferLoweredTry`. | `codegen/index.ts:1373` |
| `compiler/src/implied-lift-desugar.ts` | 527 | §17.6.10 / §10.1 implied `lift` of a single-MARKUP-expression control-flow arm, as a tree desugar (`desugarImpliedLiftMarkupArms`) — closes `g-if-arm-bare-markup-branch-silently-dropped` (#1070). | `component-expander.ts:1228` / `:4309`, `codegen/emit-match.ts:1028` |
| `compiler/src/codegen/declared-name-marks.ts` | 130 | lift-path declared-name sets that record HOW a name was declared (`markDeclaredImmutable`/`Mutable`, `liftScopeDeclaredNames`, `tildeDeclIsRebind`) so a keywordless write to a `const` stays loud (s427). | `emit-control-flow.ts`, `emit-lift.js`, `emit-reactive-wiring.ts` |
| `compiler/src/codegen/session-config-resolve.ts` | 177 | THE one per-unit resolution of `sessionExpiry` / `session-secure` (middleware → unit → stash) + the unattributable-unit record that drives `E-MW-008`. | `emit-server.ts` (`resolveUnitSessionAttr` `:2665`), `codegen/index.ts:77` (drain `:3016`) |
| `compiler/src/codegen/sqlite-defaults.ts` | 125 | §44 WAL + busy-timeout PRAGMA lines for EMITTED `Bun.SQL` sqlite handles: `SQLITE_CONFIGURE_HELPER_LINES`, `sqliteWantsDefaults`. | `emit-server.ts:6755`, `emit-tool.ts:203` |
| `compiler/src/sqlite-handle-defaults.ts` | 122 | the same defaults for sqlite handles the COMPILER ITSELF OPENS (`bun:sqlite`): `configureSqliteHandle`, `SQLITE_BUSY_TIMEOUT_MS = 5000`. Zero imports by design. | `protect-analyzer.ts:473`, `commands/db-migrate.js:505` |
| `compiler/src/diagnostic-secrets.ts` | 1026 | value-based secret redaction for ALL compiler output: `SecretRedactor`, `scanConnectionAttrs`, `displayConnectionValue`, `secretSpans`, `redactSourceText`. | `api.js:26` (chokepoint `:829-847`), `lsp/handlers.js`, `db-uri-redact.ts` |
| `compiler/src/db-uri-redact.ts` | 19 | display form of ONE db target in a message (`redactDbUri` → `displayConnectionValue`). | `protect-analyzer.ts`, `codegen/db-driver.ts` |
| `compiler/src/db-target.ts` | 71 | THE classifier for a `db=` / `<db src=>` value (`classifyDbTarget`, `isDriverConnectionUri`); outside `codegen/` so the PA stage can use it. | `protect-analyzer.ts`, `codegen/db-driver.ts`, `diagnostic-secrets.ts` |
| `scripts/hybrid.ts` | 661 | the HYBRID-COMPILER harness (`--list`, `--swap STAGE=module --conformance` = THE P5 gate, `--differential` = triage). | CLI only |
| `conformance/adapters/hybrid.ts` | 27 | impl#1 adapter with a `{ stageOverrides }` compile overlay (`installHybrid` / `uninstallHybrid`). | `scripts/hybrid.ts` |
| `scrml.toml` (repo root) | 9 | the repo's §22.13 manifest: `[capabilities] host-import = "self-host-only"` — admits `import:host` only under `stdlib/compiler/`. | `host-import.js` `findManifest` |

**Pipeline stages ADDED to `compileScrml` this window (names as passed to `stage(...)` in `api.js`):** `REJECT-CLASS-DYNAMIC-IMPORT`, `DEFER-CHECKS`, `SCOPE-REDECLARE`; `validateHostImports` runs inside the per-file TAB loop.

**`stdlib/compiler/*.scrml`:** 15 of the 16 files now bridge to the TS compiler via `import:host` (#1048); `module-resolver.scrml` has no `import:host` (it is a scrml-authored `<program>`).

## Entry Points
compiler/bin/scrml.js — CLI shim; resolves to compiler/src/cli.js.
compiler/src/cli.js — dispatches `scrml compile|dev|build|serve|migrate|db-migrate|promote|generate|init|introspect|semdiff` (11 verbs) to compiler/src/commands/*.js.
compiler/src/api.js — `compileScrml()`, the single-file pipeline entrypoint (block-split -> AST-build -> type-check -> codegen); everything else calls into this. Carries the `moduleFormat` option (default `"classic"`), the esm-gated build-path import-URL hasher (`rewriteChunkImportRefs`), and (D-4, S296) the **dist-keyed forward index + `serverImportTargetSource`** that both cross-file server-import consumers reverse through. **#528 (S345): every `readdirSync` walk in api.js now sorts per directory (`scanDirectory`, `findOutputFiles`, `bundleStdlibForRun`'s `copyTree`) — but note `scanDirectory` was ALREADY terminally sorted (`return results.sort()`, since the initial commit), so that half of #528 is inert. The REAL order-dependence is `compileScrml`'s `inputFiles` argument (api.js:910 — `resolvedInputFiles = inputFiles.map(resolve)`, never canonicalised): route/logic-id/fetch-stub counters mint in traversal order, so the same file SET in two orders emits different artifacts INCLUDING server route URLs. STILL OPEN — `g-compilescrml-input-order-dependent-emission`, HIGH, PA-reproduced (79 of 115 emitted files differ FORWARD vs REVERSED).**
  **⚠ NAVIGATION HAZARD — THE WHOLE CODEGEN SUBTREE IS INVISIBLE TO STATIC CALL-GRAPH TOOLS FROM HERE.** `api.js:2518` reads `const _runCG = selfHostModules?.runCG ?? runCG;` and then calls `stage("CG", () => _runCG({…}))`. **The call target is a RUNTIME-SELECTED variable, not a resolvable identifier**, so any tool (or agent) tracing outward from `compileScrml` **terminates at Stage 8 and reports the entire `compiler/src/codegen/` tree as unreachable.** That tree is ~35 files and the bulk of the compiler. **When you need the codegen call flow, enter at `codegen/index.ts`'s `runCG` directly — do not conclude from a call-graph walk that a codegen function is dead.** The pattern is not unique to CG: `selfHostModules` provides the same `?? `-fallback seam for **eleven** stages (`splitBlocks` :1134, `buildAST` :1316, `tokenizer`, `bpp`, `runPA`, `runRI`, `resolveModules`, `runTS`, `runMetaChecker`, `runDG`, `runCG` — enumerated in the `@param` block at :703-716. Every one of them is a self-host override seam and every one of them breaks static reachability the same way.
lsp/server.js — LSP server entry (`bun run lsp` / `--stdio`); registers handlers.js + workspace.js.
docs/build.ts — static-site generator for the docs website (`bun run docs:build`).
**THE COMPILED SERVER'S REQUEST ENTRY POINT MOVED THIS WINDOW (#654) — read this before tracing any request-pipeline task.** `handle()` now wraps **TOP-LEVEL DISPATCH**, not per-route dispatch. The onion is chosen ONCE per build by `compiler/src/commands/select-request-onion.js` (`selectRequestOnion`), which both hosts import — `scrml build` at `commands/build.js:22` and `scrml dev` at `commands/dev.js:32` (re-verified against current HEAD `c1f93dfb`, post-#738 rewrite). ⚑ **CORRECTED S376 — THE SPLIT IS NOT IN `emit-server.ts`, AND THE PRIOR TEXT HERE NAMED THE WRONG FILE.** `emit-server.ts` emits only the onion ITSELF and its mount contract: the gate `_scrml_hasMW` (`:2998`), the wrapper `function _scrml_mw_wrap(downstream)` (`:3157`), and the two exports `_scrml_mw_pipeline` (`:3294`) + `_scrml_mw_declared_in` (`:3311`) (⛑ CORRECTED S384 — all four were `:2946`/`:3105`/`:3242`/`:3259`; **+52**, from #749's map/set-runtime import and its Part-A `localMapSetOptsFor` block landing above them. They were `:2934`/`:3093`/`:3230`/`:3247` before S380's §52.13 shift — **this is the THIRD consecutive window these four have moved for a reason unrelated to the onion**, invariant 73). **The HOST does the dispatch split** — `commands/build.js` emits `async function _scrml_dispatch(req, server)` (`:570`) and `function _scrml_onion_dispatch(req, server)` (`:577`) (⚑ CORRECTED S380 from `:514`/`:521`, +56 — the §52.13 registry code landed above the split), the latter calling `_scrml_mw_pipeline_0(downstream)(req)` under the import ALIAS. `grep -rn '_scrml_onion_dispatch' compiler/src/codegen/` returns **NOTHING**. With no onion the host emits the byte-identical pre-onion `async fetch()`. **So: a request-pipeline task starts at `select-request-onion.js` (WHICH onion) → `emit-server.ts:2998/3157/3294` (what the onion IS, and the export contract; ⛑ S384 +52) → `commands/build.js:567-581` (HOW dispatch is split and wrapped, ⚑ was `511-525`) → `commands/dev.js:394-414` (the dev mount — the `selectRequestOnion` call + `registeredOnions` assignment inside `loadServerRoutes`, ⚑ RE-VERIFIED against current HEAD `c1f93dfb`, post-#738 rewrite; was `389-401` against committed HEAD `0dd659a1`) — NOT at per-route emit, and NOT at `emit-server.ts:~454-521`, which is §20.5/§52 `@currentUser`-query-gate code (below the split, above the §52.13 insertion — unaffected by the shift).** In `scrml dev` the mounted onion is introspectable via the exported `getRegisteredOnions()` and drivable via `runThroughOnions()`. **ARCHITECTURE (#738, wrap `c1f93dfb`): `scrml dev` no longer serves in-process.** The parent process compiles/watches and runs a STABLE reverse proxy (`runDev`, `dev.js:1511`); the actual app — including `loadServerRoutes`'s onion mount — runs in a respawned CHILD process (`runDevChildServer`, `:1294`), because Bun caches ESM by resolved path and never re-evaluates a recompiled `*.server.js` within one process. The parent reverse-proxies HTTP/WS to the child and serves the dev-infra endpoints (`serveDevInfra`, `:1150`) itself, so the hot-reload SSE stream survives every child respawn.

## THE EMITTED-BUNDLE EXECUTION BOUNDARY — module-init vs the soft-nav rehydrator

**Read this before touching anything that runs "when a route loads".** It is the single question the
prior generation of this map could not answer, and the wrong answer sends you to `codegen/index.ts`.

- **There is no chunk/route splitter.** A "chunk" is ONE source `.scrml` file's `.client.js`. Route
  chunks exist because routes are separate files, not because a splitter partitions a bundle.
- **`codegen/emit-client.ts` `generateClientJs(ctx)` IS the module-init emitter.** The `lines[]` array
  it assembles is the chunk's top-level program: cell inits, `<match>`/`<each>` dispatchers, engine
  substrate + hydration + opener effects, `_scrml_bind_rewire(document)`, and — crucially —
  everything `emitReactiveWiring(ctx)` returns (`:2355`), which includes every `<timer>`/`<poll>`
  `_scrml_timer_start(...)`.
- **`codegen/emit-event-wiring.ts` owns the boundary, and it is TEXTUAL, not structural.** It opens
  `(function() {` + `function _scrml_boot() {` at **`:715-716`** and closes them at **`:2186-2193`**.
  So: *everything emitted BEFORE `emitEventWiring(ctx, fnNameMap)` (`emit-client.ts:2475`) runs at
  script-eval time; everything inside `emitEventWiring`'s own `lines` runs inside `_scrml_boot()`.*
  There is no marker, no wrapper function, no flag — just emission order.
- **`_scrml_nav_rewire(root)` is emitted at `emit-event-wiring.ts:2162-2170`**, INSIDE `_scrml_boot`,
  from exactly two accumulators: `nonDelegatedRewire` (`:1021`) and `reactiveRewire` (`:1032`). It is
  invoked once as `_scrml_nav_rewire(document)` and registered via `_scrml_register_rehydrator`
  (`runtime-template.js:2684`), which `_scrml_rehydrate_region` (`:3162`) replays per soft nav.
  ⛑ **S384: `:2629` / `:3098` were ALREADY WRONG before this window — `runtime-template.js` below
  :5599 did not move, so the drift predates it. RE-DERIVED BY GREP.**
  **Its body is non-delegable handlers + reactive display binding ONLY.** `<timer>`, `<poll>`,
  `<request>`, `on mount`, cell inits and engine substrate are NOT in it.
- **Consequence, and it is the fix-shape for `g-route-timer-poll-not-stopped-on-soft-nav`:** a route
  chunk's timer starts ONCE, at module-init, when the chunk is first injected — and is thereafter
  never started, stopped or restarted by the navigation path. An "active-region flag wrapped around
  the rehydrator loop" captures nothing, because the timer already ran.
- **The emit-time region association ALREADY EXISTS and is LEXICAL — that is the real defect.**
  `emit-reactive-wiring.ts` `classifyMarkupNodes` (`:1091`) carries an `insideOutlet` flag down the
  walk and stamps `node._outletResident = true` on a `<timer>`/`<poll>` (`:1105`) or a
  `<keyboard>`/`<mouse>`/`<gamepad>` (`:1114`) that is **lexically inside `<outlet>` in the SAME
  file**. `_outletResident` then routes the stop into `_scrml_region_cleanups` (`:1273-1277`,
  `:1310`), which `_scrml_teardown_region` drains. **Route content lives in a DIFFERENT file from the
  shell that owns the `<outlet>`, so it is never lexically inside one and the flag is never set** —
  the mechanism is right, its granularity is wrong. `fileHasOutlet(fileAST)` (`:1042`) discriminates
  SHELL files, which is also insufficient for the single-file `<page>` form.
- Per-chunk lexical isolation is `codegen/index.ts` `wrapChunkBodyInIife` (`:699`, applied
  unconditionally at `:2146`, esm excepted) — that wraps the WHOLE emitted body including
  `_scrml_boot`, so it is not the module-init/boot boundary; it only makes top-level declarations
  chunk-local. `_scrml_modules[…] = {…}` assignments and the runtime's shared globals still escape it.

## Directory Ownership

compiler/src/  — the compiler core: block-splitter, tokenizer, ast-builder, type-system, symbol-table, route-inference, name-resolver, html-elements, compute-program-config, landmark-tag, tag-canonicalizer, schema-differ, sql-table-refs, indirect-callee-resolver, **nine top-level `lint-*.js` diagnostic passes** (counted at this watermark; two more sit under `validators/`), and ~20 other top-level analysis modules. **RE-COUNTED at `499eecce` (⛑ S402) by a source walk: 195 SOURCE files (`.ts`/`.js`), 1,505 exported symbols** — was 193 · 1,478 at `fc6df72e`. ⚠ **DO NOT RECONCILE THIS WITH THE OLD `git ls-files` FIGURE WITHOUT READING WHICH POPULATION IT COUNTED:** the S383 row said *"195 tracked files (146 `.ts` + 47 `.js` + 1 `.md` + 1 `.json`)"*, which is 193 source + 2 non-source. **The two 195s are DIFFERENT NUMBERS that happen to collide** — this one is 195 SOURCE files and excludes the `.md`/`.json`. The +2 source files since are `ast-if-chain.js` and `codegen/bool-coerce.ts`.** — was 194 (145 `.ts`) at `0dd659a1`, and before that the row carried a stale 189. `docs/FACTS.md` reports **246,615 lines across 193 files** here (⛑ S383 — was 245,780 across 192) — 193 is the SOURCE-only walk (146 `.ts` + 47 `.js`), so the two figures agree and differ only by the `.md` and `.json`. **The +1 this window is `default-logic-exemption.ts`, the SECOND new file in two windows** (the prior was `lint-e-state-block-statement-form.js`).
compiler/src/lint-e-state-block-statement-form.js  — **NEW THIS WINDOW (#718, 486L). Stage 2.5c, and it opens a slot in the pipeline that did not exist: the FIRST `E-`-severity pass to run over BLOCK-SPLITTER output, before the AST is built.** Wired in `api.js` between the two sibling markup-text lints (Stage 2.5 `W-INTERP-IN-RAW-CONTENT`, 2.5b `W-INPUT-STATE-MARKUP-NONREACTIVE`) and Stage 3 (TAB). Exports `runEStateBlockStatementForm(bsResults)` and `DIAGNOSTIC_CODE`. Emits `E-STATE-BLOCK-STATEMENT-FORM` (severity `error`, `stage: BS-LINT`, CLI exit 1) when a lifecycle statement `on mount {` / `on dismount {` appears in a `<db>` / `<state>` / `<schema>` STATE-block body — that body is markup context, so the statement used to ship into `<body>` as literal page text at exit 0 and never run. ⛑ **S383 (+51, COMMENT-ONLY — no behaviour moved): `maskCommentRegions` (:316-370 banner) now carries a DO-NOT-SHARE banner and is MODULE-PRIVATE by contract.** It was exported and wired into BOTH `ast-builder.js` sibling scanners (`scanStateBlockBareWriteDecls`, `scanMarkupBodyConstAtDecls`) and REVERTED both times in one session. **The general rule the banner states: `maskCommentRegions` is only safe over text that CANNOT contain a STRING LITERAL** — a `<db>` body holds string values, and a string value holds globs/paths/URLs/regexes, every phantom-comment opener there is (A/B MEASURED: 3 warnings before masking, **1** after, because `"src/*.js"` opened a block comment that never closed). A source-level tripwire in `compiler/tests/unit/state-block-bare-write-comment-state.test.js` asserts the function is not exported AND that `ast-builder.js` does not reference it. ⛑ The S383 edit also STRUCK an overstatement in that banner: re-applying the helper does **not** fail silently today — measured, it turns FOUR tests in that file RED. The true, narrower reason for the tripwire is that those tests cover only the shapes someone thought to write.

  ⚠ **THIS MODULE SCANS SOURCE TEXT WITH A REGEX AND THAT IS *NOT* AN INVARIANT-55 VIOLATION — do not "fix" it.** Invariant 55 (the S338 rule, `scripts/source-text-regex-census.ts`) forbids a text pass in a stage that ALREADY HAS THE AST. Stage 2.5c runs **PRE-AST**: its input is `bsResults`, the block-splitter's `{filePath, blocks}` output, whose state-block children are captured TEXT runs and nothing else. There is no AST at this stage to consult, so text scanning is the only available representation and the anchored `STATE_BLOCK_ON_LIFECYCLE_RE` is the correct instrument. It is byte-for-byte the same node domain as the sibling `scanStateBlockBareWriteDecls` (`ast-builder.js`), deliberately, so the two scanners over one locus cannot drift on what they see. **A future reader who greps for "regex over source" and files this as a violation will be wrong; the pre-AST position is the whole argument.**

  ⚠ **NO `try`/`catch`, AND THE ASYMMETRY WITH STAGES 2.5 / 2.5b IS DELIBERATE.** Both siblings swallow a throw and log it only under `--verbose` — correct for a WARNING, where the worst case is a lost hint. Invert the severity and the direction inverts: a swallowed throw in an ERROR GATE means a file that SHOULD be refused compiles at exit 0 with nothing saying the gate never ran. It follows the codebase's own convention — the two other error-severity lint stages (`LINT-TRY-CATCH` 3.007, `REJECT-ASYNC-AWAIT` 3.008) both run bare through `stage()`, which does not catch either.

  **Internals worth knowing before you touch it:** `isStateBlock` name-guards BOTH block-splitter arms (`type:"markup"` AND `type:"state"`) — `type:"state"` is not semantic, it is what BS calls ANY whitespace-form opener `< Name …>`, measured at 123 such nodes of which only 44 are `db`; an unguarded arm claimed engine state-children and typestate transition declarations, where the diagnostic's premise is false. `maskCommentRegions` is a carried-state machine, not a second pattern, because a block comment that opens on one line and closes on another cannot be expressed by a stateless test. Column arithmetic corrects for a text child that begins MID-LINE (`baseCol + colStart` at `li === 0`), because `<db …>on mount { go() }</db>` puts the whole child on the opener's line.

  **TWO OPEN HOLES, BOTH PA-REPRODUCED BY COMPILING AT THIS WATERMARK — not read off the module's comments:** (1) the scan reaches DIRECT text children only, so `<div>on mount { … }</div>` one level inside a `<db>` body compiles at **exit 0, zero diagnostics**, and the statement ships into the emitted HTML (1 occurrence) — `g-state-block-statement-form-misses-a-wrapped-statement`, MED, open; (2) any unpaired `/`+`*` in ordinary prose opens a comment region and DISARMS the gate for the rest of the block — a `<db>` body reading `note about src/* paths` followed by `on mount { loadDashboard() }` compiles at **exit 0, zero diagnostics**, statement shipped — `g-state-block-statement-form-disarmed-by-an-unpaired-block-comment-opener`, LOW, open. **A glob disarms a fatal gate.** Both are filed in `docs/known-gaps.md`; neither is a comment-only claim. error.map.md · domain.map.md.

compiler/src/codegen/  — code emission: one emit-*.ts per output concern plus shared collect/rewrite/reactive-deps/errors infra. ⛑ **S437: 89 top-level files (+4: `declared-name-marks.ts`, `lower-defer.ts`, `session-config-resolve.ts`, `sqlite-defaults.ts`).** ⟵ prior: **85 top-level files (82 .ts + 2 .js + 1 .md) + the `compat/` subdirectory** — RE-COUNTED at this watermark by `find compiler/src/codegen -maxdepth 1`, not carried; the composition holds. **Unchanged in count for EIGHT windows running.** ⛑ **S397: this window's ENTIRE `compiler/src` delta is FOUR files and all four are in here** — `emit-logic.ts` **5,374 -> 5,689** (+315, #830), `emit-expr.ts` **4,191 -> 4,333** (+142, #832), `index.ts` **3,497 -> 3,533** (+36, #832), `log-loc.ts` **337 -> 369** (+32, #832). Zero added, zero removed. ⚑ **If your task mentions `~` at all, do NOT start by browsing this directory — read `primary.map.md`'s `~`/§32 Task-Shape Routing row first.** The surface splits across THREE of these files plus `type-system.ts`, and three S397 dispatches lost time by picking one.
compiler/src/commands/  — **14 files (WAS 12 — two NEW this window), and the two additions are both SHARED-RULE extractions, not new verbs.** The verb count is still 11; `diagnostic-format.js` and `select-request-onion.js` are imported BY the verbs. **`select-request-onion.js` (NEW, #654) is the one a request-pipeline task must read FIRST** — `selectRequestOnion(serverModules)` implements the §40.3/§40.8 ONE-ONION rule and BOTH hosts import it (`build.js:22`, `dev.js:32` — re-verified against current HEAD `c1f93dfb`, post-#738 rewrite), so `scrml build` and `scrml dev` can no longer disagree about which `handle()` a compiled server mounts. A module hosts an onion when it declares a request-pipeline STAGE (`cors=`, `log=` other than `"off"`, `ratelimit=`, `headers="strict"`) or a `handle()`; carrying some other `<program>` attribute (`batch-in-list-cap=`, `idempotency-store=`/`-ttl=`, `cors-max-age=`, `channel-reconnect=`) does NOT count — those share the config bag and emit no stage. Zero candidates → no onion; one → mount it; **more than one → `E-MW-007`, naming every competing source, because composing them would run every module's `handle()` PRE on every other module's document in FILENAME-SORTED order (a rename would silently change which `handle()` won).** `diagnostic-format.js` (NEW, #550) owns `stripRedundantCode(code, message)` — the single place a CLI formatter stops double-printing the diagnostic code. **`dev.js` was that window's largest single move (+953/-…): #518's compile-failure serving (carried), PLUS #539 which HAS NOW LANDED** — fail-CLOSED on a `compileScrml` THROW, dir-level watches, a 250 ms max-wait debounce and `ctimeMs` in the stat snapshot. *(The prior generation of this row marked #539 "IN FLIGHT, NOT ON MAIN"; that caveat is RETIRED — `7c4b8345` is in this window.)* State surface: module-level `compileFailure` via exported `noteCompileResult()`/`getCompileFailure()`, plus exports `devDispatch`, `loadServerRoutes`, `getRegisteredOnions`, `getRegisteredRoutes`, `runThroughOnions`, `compileThrowDiagnostic`, `createHotReloadScriptResponse`, `launchingProcessGone`, `HOT_RELOAD_SRC` — every one reachable from a test, which is why the onion behaviour is assertable at all. ⚑ **RE-VERIFIED against current HEAD `c1f93dfb`, POST-#738 REWRITE (PR #738, adopter fix #724, merged `a9f03e91`) — `scrml dev` is now a stable parent reverse-proxy in front of a respawned CHILD app-process, not in-process serving** (Bun caches ESM by resolved path, so an in-process re-import of a recompiled `*.server.js` was a no-op serving STALE routes). NEW exports from the rewrite: `serveDevInfra(pathname, req)` (dev-infra endpoints, shared verbatim between the parent proxy and the child so the two can never drift), `runDevChildServer(serveDir, opts)` (the child app server, respawned per recompile), `CHILD_READY_PREFIX` (the child's stdout readiness handshake), and `runDev(args)` (the entry point, now also the `--__dev-child` re-entry point). File is now 1909 lines. `migrate.js` carries the `<machine>` retirement codemod (S307, detailed row below).
compiler/src/ast-builder.js  — the AST builder. **THE ONE THING TO KNOW: `<engine>` / `<match>` / `<each>` are NOT `kind:"markup"` and carry NO `attrs` array.** The block splitter raw-captures each one and `buildBlock` RECONSTRUCTS its opener by regexing NAMED attributes out of the header text (`for=`, `initial=`, `on=`, `in=`, `of=`, `key=`, `as`, …). **An attribute nobody regexes for is silently DISCARDED at parse time** — the node has nowhere to hold it — and every downstream stage is innocent. **Symptom → locus: "an attribute on a structural element has no effect and no diagnostic" is an ast-builder.js fact, not a codegen one.** The §17.1.2 template for adding one: `captureStructuralIfAttr` (:2849) — ⛑ **S383: `:2705` was ALREADY WRONG pre-window (a doc-comment line); re-derived by grep, not shifted** — masks `${…}` bodies and quoted strings before the NAME search, requires a standalone `(^|\s)if\s*=` token, then **re-parses a SYNTHETIC `<x if=…>` opener through the SAME `tokenizeAttributes` + `parseAttributes` a markup opener uses**; offsets rebased −3; `structuralHeaderAnchor` (:2941; ⛑ **S383: `:2797` was ALREADY WRONG pre-window — re-derived by grep**) recovers the absolute offset the header slice lost. Node construction sites: `:15394` / `:17565` (match), `:16379` (each), `:17415` (engine) (⛑ S383 — all four +118, were `:15276`/`:17447`/`:16261`/`:17297`). Sole fire site for `E-CTRL-*`, `E-LOOP-*`, `E-SYNTAX-*`, `E-MW-*`, `E-FOREIGN-*` and `E-FOR-UNPARENTHESIZED-HEAD` (**:8758 / :10809 / :13298 — THREE sites**; ⛑ S383: the carried :8535 / :12927 were ALREADY WRONG pre-window and under-counted by one. RE-DERIVED BY GREP).
  **NEW this pass (#396): `rejectFnEqualsBody()` (:3755)** — rejects a `fn`/`function` `= <expr>` shorthand body (`E-FN-EQUALS-BODY`, §48.2), fired from FOUR duplicated decl-body call sites (`:9310`/`:9592`/`:12645`/`:12946` — the same four-site topology `E-FN-ARROW-BODY` already lives at) plus a FIFTH site, the `export` re-parse (`:11625-11654`), which previously SWALLOWED this exact error and now surfaces only it. **Any future fn-decl parse fix owes all five sites** — see domain.map.md / error.map.md.
  **NEW this pass (#389): `_rebaseSubparseSpans(nodes, deltaOffset, block)` (~:15381)** — rebases a `<match>`-arm or `<each>` sub-parse's diagnostic spans to FILE coordinates. Fixed a downstream symptom nobody had connected to it: the within-node parser-parity gate was silently dead on Windows (enumerator backslash relpaths compounding the un-rebased span mismatch).
  **THIS WINDOW — `<machine>` is REMOVED, and the removal is deliberately NOT a parse failure.** `:17343` still accepts `block.name === "machine"` and still BUILDS the `engine-decl`, but `:17347-17352` pushes ⛑ **(S383: `:16835` / `:16837-16845` were ALREADY WRONG before this window — re-derived by grep at `ff4b37e5`, not shifted)** **`E-DEPRECATED-001`** (Error — the compile fails). Per §63.5 the form still PARSES so a `<machine>` source reports exactly ONE diagnostic naming the migration rather than a cascade of secondary errors from an unbuilt node. `W-DEPRECATED-001` is RETIRED (§34 tombstone). **Any doc calling `<machine>` "a deprecated alias that still compiles" is wrong at this HEAD.**
  Also new here: **`mountBodyExprNode(body, parse)` (:366, exported; ⛑ S383 — `:355` was a doc-comment line, re-derived by grep)** — GH #264 Defect 2. `safeParseExprToNode` parses exactly ONE expression, so a multi-statement `on mount` body whose first statement happens to parse yielded a node covering only statement 1, and emit-logic's `bare-expr` fast path then emitted ONLY that node — **every following statement silently dropped, zero diagnostics.** The helper drops a TRUNCATED node so the string path lowers the whole body. And **`consumeErrorTypeAnnotation()` (parseLogicBody, :3867; ⛑ **S383: `~:3675` was ALREADY WRONG pre-window — re-derived by grep; its six call sites are `:9680`/`:12670`/`:12707`/`:12714`/`:12993`/`:13025`**) — consumes a failable `!` error type in FULL (generic `! Map<…>`, paren/union `! (A|B)`, array `! T[]`, nested combinations), returning the base IDENT name. Pre-#333 the single-IDENT consumer left the tail unconsumed, the `{` body check failed, the fn parsed with an EMPTY body, route-inference never saw its `?{}` and the SQL leaked to the client (E-CG-006). **Bounded to one type EXPRESSION on purpose** — a failable fn may be BODY-LESS, so a "consume until `{`" reader would swallow the following declaration (S310 S239 finding).
  **⚑ THE §40.8 DEFAULT-LOGIC AUTO-LIFT SURFACE LIVES HERE, AND IT IS THE SESSION'S HIGHEST-DENSITY DEFECT SITE — see primary.map.md's Task-Shape Routing row for it.** `liftBareDeclarations(blocks, errors, filePath, parentType, _p3aSynthCounter, isDefaultLogicBody)` (**:1170**) is the recursive walk that promotes a bare top-level text run in a `<program>` / `<page>` / `<channel>` body into a synthetic `${...}` logic block. **NINE `^`-anchored gates, every one of them a PREFIX MATCH on `block.raw`:** `BARE_EXPORT_AT_END_RE` (:1299), `BARE_DECL_NAME_EQ_AT_END_RE` (:1609), `USE_FOREIGN_LIFT_RE` (:1665), `BARE_DECL_RE` (:1684 — the main one, and it is **declaration KEYWORDS only**: `export`/`server fn`/`type`/`fn`/`function`/`let`/`const`/`import`, defined at :660), `TOPLEVEL_STATE_DECL_RE` (:1718), `TILDE_TOKEN_RE` (:1757, gated `parentType === "state"`), `TOPLEVEL_AT_WRITE_RE` (:1792), `TOPLEVEL_ON_LIFECYCLE_RE` (:1829), and `BARE_CONTROL_FLOW_IN_MARKUP_RE` (:1885; the regex itself is defined at :793). **⛑ S383 — EVERY ANCHOR IN THAT LIST MOVED +9 THIS WINDOW** (a nine-line import banner landed at the top of the file); they were `:1161`/`:1290`/`:1600`/`:1656`/`:1675`/`:651`/`:1709`/`:1748`/`:1783`/`:1820`/`:1860`/`:784`. **Anything matching NO gate falls through to the terminal `result.push(block)` and is emitted VERBATIM AS PAGE TEXT at exit 0 with zero diagnostics.**

  ⚠ **The diagnostic that looks like it covers this — `E-CONTROL-FLOW-IN-MARKUP` (emit site `:1882-1885`, the `TABError` push at `:1906`; ⛑ S383, was `:1857-1860`) — is gated `parentType === "markup"`, the COMPLEMENT of the §40.8 locus, so it structurally cannot fire at a default-logic root.** ⛑ **S383 CORRECTION TO THIS MAP: the sentence that used to follow — that the §34 row "nonetheless claims" the auto-lift covers this and therefore CONTRADICTS behaviour — IS NOW STALE AND HAS BEEN STRUCK.** The documentation half of ruling 3 LANDED this window. `SPEC.md:19824` (the §34 row), `SPEC.md:11765` (§17.4 prose) and a NEW `SPEC.md:23065` (§40.8 bullet) now each state, in terms, that the auto-lift covers **DECLARATIONS ONLY** and that the default-logic body-top is covered by **NEITHER** the lift nor the diagnostic. The §34 row's **Does NOT fire** list still names the default-logic root, but now with the explicit rider *"NOT because that locus is safe, but because this diagnostic does not reach it … Do not read this entry as coverage."* **So the doc/behaviour contradiction is CLOSED; the BEHAVIOUR hole is not.**

  ⛑ **RULING 3'S ENFORCEMENT ARM IS HELD, NOT LANDED — verified by grep at `ff4b37e5`, not relayed.** `BARE_CONTROL_FLOW_AT_BODY_TOP_RE`, `findControlFlowStatementEnd`, `_DEFAULT_LOGIC_ROOT_NAMES` and an `isStateBlockBody` parameter are at **ZERO occurrences** across `compiler/src/` + `compiler/tests/`. The in-source banner at **`:1866-1881`** now says so itself and is worth reading before touching this function: the hold is structural, not a bug count — the recognizer needs a `{` to tell code from prose, so `if (@a) log(1)` (braceless), `switch (@a) { }`, a labelled `for` and `do { … } while (@a)` all ship raw into the DOM **at the pre-existing markup locus too**. Widening the regex is not the fix; the arc is grammar-derived over the parsed tree (`docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md`).

  ⛑ **AND THE CLASS GAINED A FOURTH MEMBER THIS WINDOW, filed HIGH: `g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line`.** ONE line of prose above a declaration at this body-top **silently disables the lift for every declaration below it in the same text run** — the declaration is not lifted, not compiled, and not diagnosed. PA-reproduced by execution in three shapes: `function greet() { … }` alone lifts and appears in `case.client.js`; the SAME declaration under one prose line appears in **zero** client-JS files, ships into the HTML as literal text, and emits **ZERO diagnostics**; and the structural form (`<x> = 0` + `${@x}`) fails on the **READ** with `E-STATE-UNDECLARED`, so the one diagnostic the author gets blames the wrong line and prescribes a fix already present two lines above. This is a DIFFERENT defect from ruling 3 (a declaration not LIFTED, vs a statement not REFUSED) and fixing either does not fix the other. **Four live defects of this one class now, all HIGH, all PA-reproduced by compiling and reading the emitted `<body>`** — see the routing row.

  ⛑ **S383 (F5) — THE TWO SIBLING TEXT-CHILD SCANNERS BELOW `liftBareDeclarations` BOTH HAD A WRONG `col`, AND BOTH ARE NOW FIXED THE SAME WAY.** `scanStateBlockBareWriteDecls` (**:1979**, emits `W-STATE-BLOCK-BARE-WRITE-DECL` at `:2020`) and its bounded mirror `scanMarkupBodyConstAtDecls` (**:2094**, emits `W-CONST-AT-DEPRECATED`) each walk a text child line-by-line. Both computed `col: colStart + 1`, where `colStart` is an offset into the LINE, not a source column — and the two coincide only from the SECOND line of the child onward. A text child can begin MID-LINE (`<db src=… tables=…>@count = 0</db>` puts the whole child on the opener's line), so line 0 reported **col 1** for a write at col 33: `col` disagreed with the byte-exact `start` beside it, and any consumer navigating by line/col (LSP, editor, formatter) jumped to the wrong place. Both now read `const col = li === 0 ? baseCol + colStart : colStart + 1`. **`line` deliberately gets no such correction** — `baseLine` is the line of `raw[0]`, which IS line 0 of the child. ⚠ **Neither scanner masks comment regions, on purpose** — see the DO-NOT-SHARE banner in `lint-e-state-block-statement-form.js`.
  **CHANGED THIS WINDOW (#672, `g-value-form-if-empty-string-branch-renders-nothing`):** BOTH `parseLogicBody` blank-token skips — the nested-body loop (**:6229**) and the top-level loop (**:11190**) — ⛑ **S383: the carried **:6052** / **:11014** were ALREADY WRONG pre-window; `grep -n 'trim() === ""'` returns exactly these two. RE-DERIVED, not shifted** — now exclude `tok.kind === "STRING"` from `tok.text.trim() === ""`. An empty-string literal `""` has blank `.text` but is a MEANINGFUL expression statement; skipping it collapsed `{ "" }` to an empty block, so a §17.6 value-form-`if` branch failed recognition and rendered nothing, SILENTLY. **The two guards are patched in LOCKSTEP — change one, change the other.**
compiler/src/codegen/code-segments.ts  — **THE SHARED FENCE, and as of this window it holds TWO REGION CLASSES, not one. 522L (was 352L).** Read this before adding any text pass over emitted JS. (1) The pre-existing **LEXICAL** fence, `rewriteCodeSegments(expr, transform)` (:248) — splits a buffer into code vs opaque (string / regex / line-comment / block-comment), applies `transform` ONLY to code, and descends into a template literal's `${…}` because those are CODE while the static spans are not. (2) **NEW this window (#458): a STRUCTURAL region class beside it** — `findObjectShorthandRegions(code)` (:213) -> `ObjectShorthandRegion[] {start, end, kind, names}` (:93), classified by **`classifyBraceGroup(code, open, closeExclusive)`** (:157) into `BraceGroupKind = "object-literal" | "binding-pattern" | "unknown"` (:91). **The two are composed, not merged:** the caller runs the structural finder INSIDE each lexical code segment, so a `{get, post}` inside a string literal is never seen at all. **The classifier's three deliberate LIMITS are the load-bearing part and each is a documented refusal, not an oversight:** `BRACE_OPENS_OBJECT_AFTER` (:137) is `{",", "[", "=", "|", "&", "?"}` and **excludes `:` and `>` on purpose** (`label: {…}` / `case x: {…}` are blocks; the `>` of `=> {` opens a function BODY); `(` is genuinely ambiguous and only the `function`-headed form is decided as a pattern, everything else reads as a call argument; and **`unknown` means the caller SHALL change nothing** — narrowing on a guess is how a coverage hole opens. `NOT_A_PROPERTY_NAME` (:118) rejects a `{ return }` / `{ break }` block before classification. `SHORTHAND_GROUP_RE` (:110) matches ONLY an all-bare-identifier group, which is what keeps the cross-file module-registry footer (`{pub: emitted, …}`, `key: value` members) outside the class by construction.
compiler/src/codegen/async-combinators.ts  — **THE ONE ASYNC-NAME PROVIDER (NEW this pass, Limb 1 / dpa-023, #442) — read this before touching anything that asks "is this name async?"** New exports: **`AsyncNameFacts`** (an interface of SETS the caller already holds: `declaredNames` / `asyncFnNames` / `serverFnNames` / an `isStdlibAsync` hook), **`isServerBoundaryCallee(name, facts)`** and **`isAsyncCalleeName(name, facts)`**. **Decision sites went 3 -> 1.** The RULE is mode-FREE and lives here once — a name is async iff (0) it is not shadowed by an enclosing local, then (1) it resolves to a Promise-returning stdlib/vendor export, OR (2) it is a server-boundary fn, OR (3) it is in the transitively-async local peer set. **There is no fourth.** MODE SELECTION is the CALLER's job and lives in exactly one place, `emit-expr.ts`'s `asyncNameFactsOf(ctx)`. `serverFnNames` is read in BOTH modes deliberately: the two emissions name the same fns and only the LOWERING differs (server = in-process peer callable, client = a fetch stub the post-emit rename installs), and both are async. Pre-existing exports unchanged: `ASYNC_COMBINATOR_METHOD_ORDER`/`_METHODS` (the CLEAN FAMILY; `.sort` deliberately absent), `KNOWN_DISCARD_HOF`, `isKnownDiscardHofCall`, `callbackReachesAsync`. **The module stays dependency-neutral (zero codegen imports)** so both the emit-expr lowering site and the emit-library-shared drain can share it without an import cycle.
compiler/src/codegen/emit-expr.ts  — **⚑ S372 (#704) — NEW EXPORT: `resolveSynthCellPrefix(segments, synthCellKeys)` (`:1032`)**, the §55 synth-key collapse rule, lifted out so the raw-string path (`collapseSynthSurfaceRefsInRaw`) and the `if=`/`show=` toggle lowering in `emit-event-wiring.ts` stop carrying private copies. It scans segments **SHORTEST-PREFIX-FIRST**, returning the first `SYNTH_PROPERTY_NAMES` segment whose dotted prefix is a registered key, plus the remaining `tail`. ⚠ **`emitMember` (`:2588`, synth branch `:2623-2631`) does NOT call it and DELIBERATELY SO — it uses `synthDottedKey` (`:2701`), which is LONGEST-KEY-FIRST, and on `@signup.errors.isValid` the two DISAGREE with `emitMember` being the correct side.** Converging them means moving the AST member path onto longest-first, with its own blast radius (`g-synth-key-resolution-diverges-between-emitmember-and-shared-helper`, MED, open). **Read `:1029-1030` before you assume the export solved the duplication** — its own comment says *"This export reduced N; it did not make N equal 1."* Five copies survive; table in dependencies.map.md. the expression emitter and the **choke point every client server call flows through**. **NEW this pass (#429, U1/dpa-020): `isClientServerFnCall` + `isAwaitedClientServerFnCall` + the `emitCall` branch at `:3274`** — a CLIENT-mode call to a SERVER-boundary fn now emits `await <name>(…)` AT ITS CALL SITE (§13.2 is POSITION-INVARIANT), which is what reaches receiver-tail (`loadRows().length`) and nested-argument (`pick(loadRows())`) positions the statement-level injector never did. Three gates make it safe: `mode === "client"`, an unshadowed ident in `ctx.serverFnNames`, and **`ctx.clientAsyncBody === true`** — the SAME `_fnIsAsync` boolean that puts `async` on the host's signature, so the branch **can only ever SUPPRESS an await, never STRAND one** (a stranded `await` in a sync host is a WHOLE-BUNDLE SyntaxError). `peerAwaitable === false` (a sync `.map`/`.filter` callback body, any parameter default) emits BARE and records the site into `syncPeerCalls` — fail-closed, same as the server-peer and client-peer branches. **The emitted callee is still the SOURCE name** (`loadRows`); `emit-client.ts`'s whole-buffer `post-fn-name-mangle` rewrites it to `_scrml_fetch_loadRows_4` afterwards, and its regex matches name-followed-by-`(`, which `await loadRows()` still satisfies. **NEW this pass (#442, Limb 1): `asyncNameFactsOf(ctx)`** — the ONE mode-selection site; `combinatorIsAsyncName` collapsed from FOUR hand-written disjuncts to a single delegation to `isAsyncCalleeName`. **`isClientServerFnCall` is deliberately NOT routed through the full provider** — it asks an IDENTITY question ("is this a client->server RPC?"), not an asyncness one; widening it would capture a stdlib-async callee and route it away from its own branch and its own fail-closed sink. It shares only the provider's shadow-aware server-fn MEMBERSHIP component (`isServerBoundaryCallee`).
compiler/src/codegen/log-loc.ts  — **⛑ S397 (#832) — NEW EXPORT `resolveSpanLineCol(span)` (`:123`), and it is the SPAN-POSITION RECOVERY every codegen diagnostic will eventually need.** 369L (was 337). The file already owned the §20.6 per-file source registry (`registerFileSource` / `resolveLogLoc`) that bakes a `"basename:line"` STRING into emitted JS for the `log()` origin tag. `resolveSpanLineCol` is the SECOND projection off the same registry, same `LineIndex`, same cache: numeric `{ line, col }` for a diagnostic SPAN. ⚑ **IT EXISTS BECAUSE `spanFromEstree` (`compiler/src/expression-parser.ts`) HARD-CODES `line: 1, col: 1` ON EVERY SPAN IT BUILDS** — the line it can see belongs to the re-parsed expression fragment, not the file, so **only `start`/`end` are true source coordinates**. Any diagnostic that trusts `span.line` on an expression-derived node reports `1:1` for every site in the file; measured, three orphaned `~` reads produced three byte-identical errors all pointing at line 1. Returns `null` (never throws) when the offset cannot be resolved, so a caller can degrade honestly rather than assert a confident wrong number. ⚠ **This is a WORKAROUND, not a fix:** some `~` ident nodes additionally carry an ENCLOSING node's byte offset, which no line/col resolution can repair — measured 1 of 3 exact, 2 real-but-wrong-line. First consumer: `_tildeDiagSpan` in `emit-expr.ts`. See error.map.md's `E-CG-TILDE-UNRESOLVED` section.
compiler/src/codegen/emit-library-shared.ts  — `computeAsyncFnNames` (the async COLORING) + `collectNonAwaitableAsyncCalls` (the fail-closed DRAIN). **THIS PASS (#442): the drain's bespoke local `isAsyncName` closure is DELETED** and the function gained a 7th parameter, `serverFnNames` — **the fact it never had.** `computeAsyncFnNames` treats `serverFnNames` as a seed TRIGGER (`callsServerFn` colours the CALLER and never admits the CALLEE to its result set), so on the client path this scan answered NO for `loadRows` while `emit-expr` answered YES **in the same compilation**. The consequence was a MISSING diagnostic, not a wrong emission: a client server-fn call stranded in a raw escape-hatch body, a template `.raw` body, or a fn-SIGNATURE parameter default is structurally unreachable to `emit-expr`'s own `syncPeerCalls` sink, so nothing caught it. Both halves now call `isAsyncCalleeName`. `declaredNames` stays deliberately ABSENT here — this scan walks a whole fn body with no scope tracker, the same slightly-over-eager shadowing posture it has always had. **Known live false positive, LEFT FIRING on purpose:** `g-drain-textscan-overfires-on-awaited-nested-arm-site` (MED) — the scan is POSITION-BLIND over `!{}` arm-handler raw text; two suppression attempts each silently deleted real fail-closes (55 arms in 17 files, incl. `stdlib/auth/jwt.scrml`). Corpus impact of leaving it: **0 of 1878 sources.**
compiler/src/codegen/reactive-deps.ts  — **NEW export this pass: `collectStructuralDeclNames(fileAST)`** (§6.8, #417) — walks logic bodies (incl. if/for/while/match/try) for `state-decl` nodes carrying `structuralForm:true`, returning their names. Consumed by `emit-reactive-wiring.ts` (threads into `EmitLogicOpts`, publishes a module-level fallback) and `emit-logic.ts`'s `_emitInitThunkSidecar` reassignment-skip guard. See domain.map.md / dependencies.map.md.
compiler/src/codegen/emit-logic.ts  — **⚑ S372 (#697/#703) — NEW EXPORT `_objectLiteralArmFromStructuredBody` (consumed by `emit-control-flow.ts:2442`, checked BEFORE `emitLogicBody` so an object arm skips statement emission and causes no genVar drift), and `rewriteBlockBody` gained an opt-in `astExprCtx` parameter.** The latter is the interesting one: passing a full `EmitExprContext` routes each statement expression through `safeParseExprToNodeGlobal` -> `emitExprField` -> `emitExpr` -> `emitMember`, restoring map/set/request/dbVar/synth INTERCEPTION that the string fallback (`rewriteExprWithDerived`) does not do. **Absent the param every existing caller — event wiring, match arms, each-handlers, variant guards — is BYTE-IDENTICAL**, which is what made it landable. Three call sites pass it (`when-effect`, `when-worker-message`, `when-worker-error`), all with `clientAsyncBody:false` because the body is wrapped in a NON-async `_scrml_effect(function(){})` / `worker.onmessage`. Regression from #693/#695, which had moved when-handler bodies onto `rewriteBlockBody` in the first place. **THE §18.5 BLOCK-ARM MACHINERY LIVES HERE, AND IT IS FOUR ROUTES WITH ONE SHARED LEAF PREDICATE — read domain.map.md's four-route table before scoping any change to it.** `planBlockArmLift(inner)` (:4715, exported) is the shared SEGMENTER+PLAN for the two RAW-STRING routes and has exactly TWO call sites (:4738 here, `emit-control-flow.ts:2221`). **It is NOT "the single classifier every path routes through"** — the two structured-AST routes call `_blockTailIsValueExpr` (:4653, exported) DIRECTLY, because an AST body already supplies the statement boundaries a string has to be segmented for. Grep `_blockTailIsValueExpr`, not `planBlockArmLift`, to enumerate all four. Supporting locals: `_splitBlockStatements` (:4580, string-literal- and depth-aware), `_closesBlockStatement` (:4550) + `_BLOCK_STMT_HEAD_RE` (:4520) + `_BRACE_CONTINUATION_RE` (:4528) — **NEW #479: a depth-0 `}` closing a block-bodied statement is a statement boundary in its own right**, gated three ways (block-statement head · not a continuation keyword · next char in a statement-start WHITELIST) so an object-literal/arrow initializer and a brace-continuation expression can never be split; `_matchArmResultIsBlockBody` (:4637, the parser-based object-literal fence, string routes only); `_emitBlockArmValueFromString` (:4734). **ALSO #479:** `_emitForStmtWithTilde` (:4186) now re-dispatches its two fallbacks through `emitLogicNode` with `tildeContext: undefined` instead of calling `emitForStmt` with `opts` DROPPED (the drop lost `declaredNames`/`boundary`/`serverFnNames`/`asyncRouteMap`, and a nested `a = 1` emitted as a shadowing `const`); and `emitMatchExprDecl` (:4763) builds a **PER-ARM** `declaredNames` set (:4867) so a name declared in one mutually-exclusive arm cannot suppress the decl in another. Carried (#417, §6.8): `_emitInitThunkSidecar` skips the reset init-thunk for a reassignment of a structurally-declared cell (`collectStructuralDeclNames`; module-level fallback `setStructuralDeclNamesForFile`).
  ⛑ **S395 (#815, §17.6.2/§17.6.10) — THIS FILE IS THE `if`-AS-EXPRESSION *BINDING-SITE* LOWERING, AND A FILED GAP SEARCHED THREE OTHER FILES AND FOUND NONE OF IT.** The gap recorded `locus=searched:emit-html.ts,emit-each.ts,emit-control-flow.ts`; the responsible site is in **NONE** of the three (invariant 84 — a `searched:` set that is DISJOINT from the answer, not merely incomplete). Entry is the **`let-decl` handler `:1974-1975`** and the **`const-decl` handler `:2119-2120`**, both dispatching on **`node.ifExpr`** into **`emitIfExprDecl` (`:4735`)** — which seeds `let <tilde> = null;` (§17.6.4: no arm executes ⇒ `not` ⇒ `null`) and assigns in branches, then emits `${keyword} ${name} = ${tildeVar};` (`:4565`).
  **NEW module-local `_emitValueFormSugarArm(body, tildeVar, bodyOpts)` (`:4438`)** — returns ONE line, `  <tildeVar> = <rhs>;`, for a sugar arm and `null` for anything else, so explicit-`lift`, statement and multi-statement arms are **byte-unchanged**. `tildeVar` is threaded through **`emitIfExprAltChain` (`:4594`)**, which calls it on BOTH limbs: the nested `else if` consequent (`:4609`) and the terminal `else` (`:4634`). `emitIfExprDecl` calls it on the `then` arm (`:4772`). **THE DEFECT IT CLOSED:** a sugar arm fell through to the shared `bare-expr` handler, which under an active `tildeContext` mints a FRESH `let _scrml_tilde_N = <expr>;` (the §32 pipeline-accumulator lowering) **and rebinds `tildeContext.var` to it** — so the arm wrote a block-scoped temp, the result var stayed at its `null` seed, and the binding was **ALWAYS `null`, at exit 0, with zero diagnostics.**
  ⚠ **TWO GUARDS INSIDE `_emitValueFormSugarArm` ARE LOAD-BEARING, NOT DEFENSIVE PADDING** — a bare `length === 1 && kind === "bare-expr"` redirect is a bug generator. (1) **`_onMountEffect`** marks a DESUGARED `on mount {}` / `on dismount {}`, which the ast-builder surfaces as a `bare-expr` whose `expr` is the mount BODY — the `on` keyword is not in the text, so a keyword fence cannot see it, and a lifecycle effect is not a value. (2) **`_blockTailIsValueExpr`** rejects assignment-shaped tails: **measured, not assumed** — `{ @acc += 1 }` reaches here as a `bare-expr` carrying an `assign` node (`@acc = 1` and `t = "p"` do NOT; they parse as `state-decl` / `tilde-decl`), and without the gate the arm would lower to `<result> = _scrml_reactive_set("acc", …)`, hijacking a statement as the arm's value **and** bypassing the §51.11 transition guard + audit clause further down the shared handler.
  ⚑ **ONE LEAF PREDICATE, TWO SHAPE RULES — invariant 83, and conflating them is a WIDENING.** `_blockTailIsValueExpr` (`:4871`, exported) is shared with the §18.5 match block-arm redirect (`emit-control-flow.ts:2479`; raw-string twin at `:4938`/`:5100`) because "is this bare-expr a value at all?" is the identical question. **The SHAPE rule is not shared and shall not be:** §18.5 says a block arm's result is its LAST expression (tail-of-many, positional); §17.6.1's grammar says the sugar arm is EXACTLY ONE expression (`arm-body ::= '{' expression '}'`, `SPEC.md:11851`), so `body.length !== 1 -> decline` is local and deliberate. The markup-interpolation twin `_soleBareExprValue` (`emit-control-flow.ts:2699`) uses the SAME `length !== 1` test, so all three positions agree.
  ⚠ **A DERIVED CELL IS A DIFFERENT SHAPE AND FAILS LOUD ON PURPOSE — do not close it as a bug (invariant 85).** §17.6.3 (`SPEC.md:11898`) names only `const`/`let` binding sites, so `const <label> = if (…)` raises `E-CODEGEN-INVALID-LOGIC` in **both** the sugar and explicit-`lift` forms. `const <label> = match @level { … }` DOES work and ships as a conformance case, so the asymmetry is real and making the `if` form work is a WIDENING, not a fix.
  **NEW THIS WINDOW (#447, §18.5, a peter-clone landing): a `match` BLOCK-ARM in VALUE position lifts its tail expression to the result var.** Four new module-locals: `_splitBlockStatements(content)` (a brace/paren/bracket- and literal-aware statement splitter — NOT a naive `;` split), `_matchArmResultIsBlockBody(result)` (is the arm result a `{ … }` BLOCK rather than an object literal — `{ 42 }` / `{ const a = 5; a + 1 }` / `{ @x = 1 }` all classify as block/escape-hatch), `_blockTailIsValueExpr(tail)`, and `_emitBlockArmValueFromString(result, tildeVar, opts)` which emits the leading statements then assigns the tail expr to the tilde result var. Pinned by the two NEW conformance cases `value-decl-block-arm-raw` / `value-decl-block-arm-variant`.
  **NEW THIS PASS (#463, §18.5): `_blockTailIsValueExpr` (:4535) shipped with its word boundary INSIDE the keyword alternation** — `/^(const|let|var|return|if|for|while|do|switch|lift|throw|fail|on\b)/` fenced **only `on`**, so every other keyword matched as a bare PREFIX. A tail named `formatted` matched `for`; `doc`/`document`/`domNode` matched `do`; `letter` matched `let`; `constant`, `returnValue`, `iface`, `lifted`, `failCount`, `varName` likewise. Each was misclassified as a STATEMENT head, the tail was never lifted, and **the arm silently produced `null` with zero diagnostics.** The fence now sits OUTSIDE the alternation and is **`(?![A-Za-z0-9_$])`, NOT `\b`** — deliberately: JS `\b` is defined against `\w` = `[A-Za-z0-9_]`, which EXCLUDES `$`, while scrml identifiers admit `$` (`tokenizer.ts:1343`, `isIdentPart = /[A-Za-z0-9_$]/`). A `\b` fence still reads `do$thing` / `on$c` as keyword-then-boundary and reproduces the defect **including for `on`**, the one keyword that always had a fence. `on foo` still matches; `onClick` still does not. Pinned by `unit/match-block-arm-keyword-prefixed-tail.test.js` (190L) and conformance `match-block/value-decl-block-arm-keyword-prefixed-tail`, which asserts BOTH consumers (structured/variant-arm AND raw/literal-arm) and both `$`-continuation anchors.
compiler/src/codegen/emit-each.ts  — **⚑ S372 — THIS FILE OWNS THE LIFT-vs-STRUCTURAL `<each>` BRIDGE, AND IT APPEARED NOWHERE IN THE MAP SET BEFORE THIS PASS.** There are TWO parse origins for `<each>` and they take completely different paths: a STRUCTURAL each is in `block-splitter.js`'s `STRUCTURAL_RAW_BODY_ELEMENTS` (`:126`) so the ast-builder promotes it to `kind:"each-block"` (`ast-builder.js:17012`; ⛑ S383 +118, was `:16863`), while markup reached through `parseLiftTag` (`ast-builder.js:5602`; ⛑ S383 +118, was `:5458`) is built recursively as GENERIC markup and **`<each>` is never promoted** — it arrives as `{kind:"markup", tag:"each"}`. Un-bridged that renders a LITERAL `<each>` DOM element and its `${@.}` body reaches the bare-expr text path with no iter-scope rewrite, leaking the raw sigil (`createTextNode(String((@ .) ?? ""))`) -> `E-CODEGEN-INVALID-LOGIC`. **`eachBlockFromMarkupNode` (`:3324`, exported — ⚑ CORRECTED S380 INCREMENTAL from `:3266`, which was itself already stale pre-S380: the S376 pass corrected this SAME citation to `:3309` in primary.map.md but never touched this file's OWN copy of it — see non-compliance findings) is the bridge** — it reads the already-structured attrs/children (no raw re-parse), tie-breaks `in=` over `of=`, treats the first `tag="empty"` markup child as the empty branch, and returns **null** when there is no iteration source, which is the caller's signal to keep literal-markup emission. Its one caller is `emitNestedEachFromMarkup` (`:3396`, ⚑ was `:3338`, same drift), reached from `emit-lift.js`'s `tryEmitNestedLiftEach` (`:716`, unaffected — `emit-lift.js` is outside this window's diff). ⚑ **A NULL `scopeVar` IS VALID, NOT AN ERROR** (GITI-033/S240): an each in a ternary-markup consequent has no enclosing `for` and iterates a module/const/`@cell` source; the pre-fix gate returned null on it and the each fell through to literal emission. **Row-template `if=` also lives here:** `:1112-1121` collects it, `:1271` `_scrml_ifrow_apply` is the REACTIVE sole-item-root path, `:1313` `if (cond) frag.appendChild(el)` is the CREATE-TIME non-root path that warns `W-IF-IN-EACH` — **and `ifCond` (the STRUCTURAL `if=` field) is never read in this file at all, which is why a structural `if=` inside a row template fails OPEN** (§17.1.2.3, PA-reproduced at this watermark). **NEW this pass (#416, §17.1): `W-IF-IN-EACH`.** `_eachIfCondReferencesItem`/`_eachItemBindingNames` (new helpers) detect a per-row `if=` on a NESTED (non-item-root) element that references the iteration item; `renderTemplateChildToJs`'s deferred nested-per-row-`if=` branch now warns instead of silently shipping a create-time-only gate. See domain.map.md.
  **NEW THIS WINDOW (#456, a peter-clone landing): a `:`-shorthand `<each>` body whose child is a MARKUP-RETURNING fn CALL now mounts** (`g-each-nested-residual-1`). The branch re-parses the child expression through `expression-parser.ts`'s `parseExprToNode` (a lazy `require` at the use site, deliberately not a module-top import) and routes the result through `maybeWrapEachPerItemEffect`, so the returned markup is mounted per row instead of being stringified into the row text.
  **NEW THIS PASS (#466, §4.14/§17.7.6): the `:`-shorthand mount #456 added is now REFUSED inside RCDATA — and inside RCDATA ONLY.** One shared module-local, **`const _isRcdataBody = isRcdataElement(tagName)` (:1169)**, is read by BOTH per-item body branches so they cannot drift: the `:`-shorthand branch (`shMarkupCapable && !_isRcdataBody` at :1244; the `.value` write at :1250) and the bare-body `_rcdataValueExpr` gate (:1183). **The name to grep is `_isRcdataBody`.** `eachBodyLowering` / `TEXT_ONLY_CONTENT_ELEMENT_NAMES` / an `EachBodyLowering` three-way type were the FIRST attempt (`2c89086c`), rejected `DO-NOT-LAND` by the S239 adversarial gate and **deleted — they do not exist in this tree** (`grep -rn eachBodyLowering compiler/` returns nothing; the only hits are in `docs/changes/s328-each-shorthand-restricted-parent/progress.md`, which labels that section SUPERSEDED). **Why RCDATA and nothing else, measured not inferred:** a `<textarea>`'s value IS its child TEXT content, so an element child makes `textarea.value` `""` and the adopter's string is GONE (measured in real Chromium). `<option>` does NOT lose data — a `<span>` child is invalid HTML but the label still reads through; lowering it to `.textContent = String(expr)` fixed the SHAPE and BROKE the label to `"[object HTMLElement]"`, trading a silent-wrong shape for a silent-wrong label. **`<option>` and `<title>` are deliberately left on the mounting path.** `<style>`/`<script>` never reach this emission path at all (measured: zero `createElement`). See domain.map.md for the FOUR non-agreeing answers to "may this body receive an element child?" — this local gates only two of them.
  **NEW THIS WINDOW (#511, §6.7.7): the per-item request-ref routing stash.** `_eachRequestIds: Set<string> | null` is a module-level file-scoped set built ONCE from the same `fileAST` by `collectRequestIds` (imported from `reactive-deps.ts`) inside `emitEachBodyRenderForFile`, and **cleared in the same `finally` as `_eachBindSupportCtx` and `_eachMarkupFnNames`** — the established synchronous-single-threaded ctx pattern in this file. `lowerEachExpr` reads it: when the raw text contains `<#` AND `rawReferencesRegisteredRequest(text, ids)` is true, the expression is forced through the STRUCTURED `emitExprField` path with `requestIds` threaded, so `<#id>` lowers to the reactive `_scrml_request_<id>` object (§6.7.7) instead of the §36 `_scrml_input_state_registry` (which a `<request>` never populates → `undefined.data` → runtime TypeError from a clean compile). **GATED to registered ids, so every non-request each-attr stays byte-identical to pre-fix.** ⚠ `_eachRequestIds` is deliberately UNSET on the Tier-0 `${for…lift}` path that reaches the template walk without `emitEachBodyRenderForFile` — that path is covered by #512's reparse in `emit-lift.js`, not by this stash.
  **NEW THIS WINDOW (§17.7.3): `E-EACH-BODY-DECL-UNSUPPORTED`.** In `renderTemplateChildToJs`'s logic-child handler, a `let-decl` / `const-decl` / `function-decl` as the first body statement now pushes a `CGError` and RETURNS. Pre-fix such a decl had no `exprNode`/`raw`, fell through to `inner=""` and was silently skipped — **while a later `${nm}` still lowered to a bare `String(nm)`, a dangling reference that throws inside the per-item render factory and renders the WHOLE list empty, at exit 0 with no diagnostic.** Fail-CLOSED by user ruling (S339). The §17.7.3 each-body scope is the `@.` sigil plus an optional `as` alias, NOT author locals; SUPPORTING them (replay the binding into the factory closure, as the `for`-lift path does) is a separate language-surface ruling this rejection deliberately does not pre-decide.
  **NEW THIS WINDOW (#670, §17.6): `_eachValueFormIfRaw`** — a §17.6 value-form `${ if cond { a } else { b } }` as the SOLE content of an interp INSIDE an `<each>` body was neither a `bare-expr` nor carried `stmt.raw`, so the logic-child handler fell to `inner = ""` and emitted `// each: empty logic interpolation skipped` — an empty text node, at exit 0. The identical value-form `if` at TOP level lowered correctly, so this was an each-path-only hole. It now lowers to the RAW ternary (built from `emitStringFromTree` sub-expr text, mirroring `emit-control-flow`'s `_emitIfValueExprInner`) and the shared `lowerEachExpr` does the `@.`/`@cell`/iter-var lowering uniformly. Non-value-form / markup-valued branches still return null → prior behaviour preserved. **Filed residual: `g-each-inline-value-form-match-or-markup-branch-interp-dropped` — a value-form `match` in an each interp is still dropped.** Same window (#658), the same file's markup-fn detection moved OUT into `markup-return-scan.js` (see below) so the cross-file imported case matches the same-file case.
compiler/src/codegen/index.ts  — **NEW this pass: two new `EmitLogicOpts` construction sites thread `structuralDeclNames: collectStructuralDeclNames(fileAST)`** (§6.8 support). Also carries the `g-runtime-script-tag-not-depth-prefixed` fix (own-document `<script src>` depth-prefix, landed S320-tail as #408, prior pass's dependencies.map.md documented the mechanism — no further change this pass).
compiler/src/codegen/scheduling.ts  — **LANDED THIS PASS (#405, `649d6fce`): the CPS auto-await CHOKE-POINT consolidation. `injectPromiseAwait` (the per-statement string-regex pass) is RETIRED.** Three call-shape wrappers now share ONE walker (`collectAwaitSites`/`applyAwaitSites`): `injectServerCallAwaitsViaAst` (on-mount, `"arg1"` reactive-skip, unchanged consumer), **`injectFnBodyServerCallAwaits` (NEW — every client fn-body statement, `"sink"` reactive-skip, descends into `given`/match-block/`try` bodies the pre-#405 classifier fenced out of)**, `parenthesizeAwaitServerCallsInExpr` (match-arm EXPRESSION ctx, always-wrap). `scheduleStatements` now calls a new local closure `_autoAwaitFnBody` (built from server-fn names + stdlib-Promise-callee names, with a substring pre-check that skips the acorn parse when no candidate name is even mentioned) on EVERY emitted statement in both its sequential and grouped paths — before #405 the sequential path injected NO await at all. **Wrap-vs-bare is decided per call site from its AST parent**: a tight tail (member/index access, a further call, a tagged template) forces the paren wrap (`fn().ok` → `(await fn()).ok`, fixing the g-hash87 mis-paren); anything else keeps the pre-#405 bare-prefix byte shape. Closes the `g-cps-scheduler-opaque-boundary-hides-nested-server-calls` family — resolves `g-given-block-server-call-no-autoawait`, `g-hash87-member-read-await-misparen`, `g-ternary-init-server-call-await-misbind` (`docs/known-gaps.md`, all `status=resolved`). See dependencies.map.md for the full mechanism table.
  **NEW this pass (#429, U1): `_clientServerFnNames(routeMap, filePath)` (module-local, `:381`)** — the file's server-boundary fn names, threaded into `scheduleStatements`'s expr ctx **ONLY when `clientAsyncBody`**, so the set is absent exactly where an `await` would be stranded (a second, independent expression of `isClientServerFnCall`'s own gate). **It FILTERS ON THE OWNING FILE and that filter is the root fix, not a tidy-up:** `runRI` builds ONE `routeMap` across the whole resolved import graph and `FunctionRoute` carries no `filePath` field — the file lives ONLY in the map KEY (`<filePath>::<start>`). An unfiltered walk put a server-boundary `save` from `lib.scrml` into the set used to emit `app.scrml`, where `save` may be a purely local SYNC client fn: the call gained a spurious `await` and its sync-callback form hard-failed with a false `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`, with renaming the local fn as the only user workaround. **`declaredNames` does NOT cover this** — a TOP-LEVEL client fn name is never in it. Corpus incidence is zero today, which is NOT reassurance: `examples/23-trucking-dispatch` declares `getCurrentUser` 19x, `refresh` 18x, `getSessionToken` 17x across files.
compiler/src/codegen/emit-functions.ts  — the client fn-body emitter. **NEW this pass (#429):** `_serverFnNames` is threaded into `fnOpts` gated on `_fnIsAsync` (the same boolean as `asyncPrefix`), and it carries the SAME owning-file filter as `scheduling.ts`'s `_clientServerFnNames` — **the two must agree, because U1's gate is derived from the coloring the filter also feeds.** **This path matters most: `fn`-shorthand and return-typed `function` bodies bypass `scheduleStatements` entirely** (`emitFnShortcutBody` instead), so the statement-level `injectServerCallAwaits` post-pass NEVER saw them — a return-typed `function` calling a server fn emitted a bare unawaited Promise with zero diagnostics. Deliberately NOT threaded: `serverFnPeerAliasNames`/`serverFnPeerDispatchObjs` (server in-process peer surfaces; the client indirect/dispatch shapes are a separate unverified question, out of U1's scope). **NEW (#442):** `_serverFnNames` is also passed to `collectNonAwaitableAsyncCalls` so the drain asks the same question the emitter asks. **NEW THIS WINDOW (#458): all FOUR `fnNameMap.set` sites now route through ONE `registerFnName(sourceName, generatedName)` closure (:675), a DATA-VALIDITY guard on the map's own contract.** It refuses any key failing `/^[A-Za-z_$][A-Za-z0-9_$]*$/` and returns false. **The test is IDENTIFIER SHAPE, not non-emptiness, and that is the whole point** — an empty key made the consumer's alternation `\b(…|)\b`, which matches ZERO-WIDTH at every word boundary satisfying the lookahead (781 injections into one file, `stdlib/cron`), and a non-empty non-identifier key such as `" "` is the same hazard. The four sites are `:722` (SSE stub), `:888` (stub), `:1052` (wrapper), `:1386` (generated name); **a fifth `fnNameMap.set` added anywhere re-opens the class.** It deliberately raises NO diagnostic — every §34 fire site for the one code that fits (`E-CODEGEN-INVALID-LOGIC`) is `validate-emit.ts`, whose contract is "the emitted artifact does not parse, here is the byte offset", so a declaration-site fire needs a NEW §34 row and that half is surfaced to the PA rather than smuggled in. The drop is testable (invariant 27) — `mangler-region-fencing.test.js` §3 asserts it directly.
compiler/src/codegen/emit-control-flow.ts  — **NEW this pass (#429 fix rounds): `clientAsyncBody` now travels WITH `serverFnNames` through all FIVE forwarding sites** (`_asyncAwaitBodyOpts`, `_emitIfStmtInner`, `_emitForStmtInner`'s inline `emitLogicBody` call, and the two `emit-logic.ts` dispatch hops). Those sites forwarded the NAME SET but not the FLAG, so U1's gate failed **one block deep** and `if flag { @count = loadRows().length }` stayed byte-identical to base — still `.length` off a pending Promise, still silent. **`emitMatchExpr`'s IIFE header is now CHOSEN FROM THE EMITTED BODY, not a re-derived predicate (F1):** the header is emitted as a `/*__scrml_match_iife_header__*/` placeholder and overwritten at the `})()` close with `await (async function() {` iff the mode is server OR the emitted arm bodies contain an `await` token in CODE position (`_stripStringLiteralsForAwaitScan` blanks string/template/regex literal CONTENT so an `await` inside emitted user text cannot flip a sync IIFE). Same discipline as the #391 crossmodule-markup fix. **Fail-safe direction is deliberate:** a false POSITIVE is valid JS; a false NEGATIVE is a stranded `await` and a broken bundle.
  **NEW THIS WINDOW (#664, §18): `emitIifeBlockArmBody` (:2115) now emits an object-literal match arm in RETURN position.** A `1 :> { x: 1 }` arm is a VALUE expression, not a statement block; emitted BARE, JS reads `{ x: 1 }` as a labeled-statement block, the IIFE falls off its end and the fn silently returns `undefined`. The object branch runs **BEFORE** the empty-`inner` guard so an empty OBJECT `{}` returns `{}` rather than being intercepted as a void block — **do not reorder those two, it is the exact regression the ordering exists to prevent** (the guard is documented in place). The object RHS goes through `emitExprField` + `_awaitMatchArmServerCalls`, so a server call inside the object (`{ rows: queryUsers() }`) is auto-awaited (§13.2/§19.9.3) exactly as the decl path does. Same landing added the **IIFE-header async scan to `emitMultiScrutineeMatch` (:2065-2081)**, mirroring `emitMatchExpr`: it reads the EMITTED BYTES (not a re-derived predicate) for a `\bawait\b` in code position and promotes the header to `await (async function() {`, because the multi-scrutinee header was statically sync and stranded an `await` in a non-async function → `E-CODEGEN-INVALID-LOGIC`. **Residual, OPEN and HIGH: `g-library-fn-match-else-arm-object-literal-returns-the-bare-identifier` — the `else`/wildcard arm was NOT covered by #664.**
compiler/src/codegen/emit-reactive-wiring.ts  — **the MODULE-INIT emitter for lifecycle wiring**, and therefore the file the route-region arc has to change. `classifyMarkupNodes` (:1081) is the ONE walk that buckets `<timer>`/`<poll>` (lifecycleNodes), `<keyboard>`/`<mouse>`/`<gamepad>` (inputStateNodes), `<request>`, `<timeout>` and `_bindProps` — and it is where `_outletResident` is stamped (see the execution-boundary section above). `emitTimerNode` pushes `_scrml_timer_start(scope, id, ms, fn)` at **:1250** and its teardown registration at **:1273-1277**; `fileHasOutlet(fileAST)` (:1042, exported) is the SHELL-file discriminator three other sites reuse. `on mount` async-scope wrapping is at :536-537.
  **CHANGED THIS WINDOW (#510, §6.7.6): `emitLifecycleNode` now computes an `immediateArg` and appends it to the emitted `_scrml_timer_start(...)` call.** `<poll>` gets `, true` when `running` is always-true, or `, _scrml_reactive_get("<var>")` when `running=` is a reactive cell; **`<timer>` passes NOTHING** (§6.7.5 — a timer never fires an immediate first tick), and neither does a static `running=false` poll. **The gate lives at the emit site and the fire lives at the arm site**, which is why a paused poll cannot smuggle in a tick.
compiler/src/codegen/emit-event-wiring.ts  — **⚑ S372 — THIS FILE IS ALSO THE `if=`/`show=` TOGGLE-LOWERING DECISION SITE, AND UNTIL THIS PASS THE MAP SET SAID SO NOWHERE.** THREE named functions own it and they are deliberately ONE lowering: **`computeDisplayToggleCondition` (`:473`)** returns `{conditionCode, subscribeVars}` and branches on `b.condExpr` vs `b.varName`+`b.dotPath` — WHICH branch you land in is decided UPSTREAM by the attribute value's `kind` at the `emit-html.ts` binding site; **`computeMountToggleCondition` (`:725`)** DELEGATES to it (they were separate paths and had silently diverged — the mount path threaded neither `derivedNames` nor `synthCellKeys`, the GH #262/#275 defect class in a second location), with ONE thing of its own: a §6.7.7 `if=<#id>.loading` whose `<id>` names a `<request>` routes to the reactive `_scrml_request_<id>` object rather than a nonexistent cell; **`computeChainBranchCondition` (`:750`)** lowers ONE if-chain branch, and its `condition.name` arm (**`:789-791`**) consults **nothing** — it emits `_scrml_reactive_get(<whole dotted path>)` with no membership test, fabricating a key nothing registered, so `else-if=@cfg.errors` can never be selected (`g-else-if-dotted-cell-ref-emits-unregistered-flat-key`, MED, open, #692; ⚠ **the ledger's locus `:647` is 142 lines stale** — grep `condition.name`). Consumers: `:1734` mount, `:1955` display/visibility, `:2202` `ifGuard`. **#704 (+192) added the §55 synth-cell collapse to the `varName`+`dotPath` branch via the newly-exported `resolveSynthCellPrefix` (`:541`) plus a DERIVED shape gate (`:609`, `:653`) that declines the always-truthy rollup maps** — see domain.map.md's §55 collapse matrix and primary.map.md Task-Shape Routing row 1. event-handler wiring **and the owner of the module-init/`_scrml_boot` boundary** (:715-716 open, :2186-2193 close) and of `_scrml_nav_rewire` (:2162-2170) + `_scrml_if_rewire` (:2177). Boot dispatch: an IIFE + a branch on `_scrml_chunk_loading` (truthy ⇒ boot NOW, an injected route chunk where DCL already fired; else defer to `DOMContentLoaded`, byte-identical to the pre-wave1c initial load). **This window (#349, `g-request-data-is-some-misroute`):** both `if=`/`show=` condition paths (:474+ attribute, :566+ chain branch) now RE-PARSE a raw condition when the node is an escape-hatch **and** the raw contains `<#` — `shouldSkipExprParse` skips any `<`-leading expr (the HTML-fragment guard), so `if=<#r>.data is some` never got a structured node and the string fallback BOTH mis-routed the request ref and mangled the `is some` LHS. `requestIds` is now threaded into all three `emitExprField` calls. Scoped to `<#`-bearing exprs so every other escape-hatch condition lowers byte-identically.
compiler/src/codegen/emit-client.ts  — **⚑ S372 (#700) — the GITI-036 POST-EMIT backstop grew a `navigate` gate, and WHY is the lesson.** `POST_EMIT_HELPER_CHUNK_GATES` (`:2869`) gained `_scrml_navigate_soft(` / `_scrml_navigate(` -> `utilities`. The PRE-emit `detectRuntimeChunks` gate lights `utilities` for `navigate()` only via its `case "bare-expr"` ExprNode probe, and a `when @dep changes {…}` / `when message from <#w> {…}` handler body is stored as **`bodyRaw` (a STRING) + `bodyExpr` (stmt 1 only)**, never as walkable bare-expr nodes — so `navigate()` ANYWHERE in the body was invisible, the chunk was tree-shaken, and the reference threw `ReferenceError` on first dependency change. **Reproduces with a SINGLE statement**; #693/#695 only EXPOSED it for stmts 2+. #700's class enumeration (verified): `utilities`-via-`navigate()` was the ONLY chunk gated purely by when-body expression content with no post-emit backstop and no scope dependency. **The fix is placed on the byte-scan of EMITTED text — the AST-shape-immune side — precisely because the AST shape was the thing that lied.** **the module-init assembler** (`generateClientJs`, the `lines[]` build) AND the runtime-chunk gate owner AND (since #263/S301) the owner of `emitReferencedModuleExportConstLines`, the §14.8-GATED client sibling of emit-server's `emitReferencedModuleConstLines`. The admitted set is built from AST `IdentExpr` nodes ONLY with two PRUNED subtrees (a server-boundary function body; a server-scoped cell's init) — never a text match, so a name in a fetch stub, a string literal or a comment can never widen it. `detectRuntimeChunks(fileAST, ctx)` (**`:828`** — ⚠ **CORRECTED S371: this map said `:273` and had said so for at least a window; the figure was wrong at `728bdc92` too**) is the PRE-EMIT AST walk, called from `:2073`; `POST_EMIT_HELPER_CHUNK_GATES` (**`:2869`**, ⚠ was cited as `:2167`) the POST-EMIT reference scan. **Neither lives in `codegen/index.ts`.** **This window (#339, `g-onmount-…-escape-hatch-string-path`):** the `_scrml_reactive_set("NAME", <stub>(…))` direct-value await matcher (:2907+) now tolerates WHITESPACE between the callee and its `(` — the escape-hatch string lowering can emit a spaced `stub ( )`, and the old tight `stub(` match missed it, binding a bare Promise into the cell (fail-OPEN §13.2). **`injectServerCallAwaitsViaAst` deliberately skips this direct value expecting THIS matcher to lift it, so a miss here is the only guard.** ⚑ **`detectRuntimeChunks` WALKS AST *NODES* AND HAS NO `markup-value` CASE — a shipped conformance case is a DEAD PAGE because of it (S371, PA-REPRODUCED).** An `<each>` inside a ternary-markup consequent (`${ @show ? <ul><each …></each></ul> : "" }`) is a `MarkupValueExpr` (`types/ast.ts:2070`, `kind: "markup-value"`, holding `node: ASTNode`) nested inside an EXPRESSION tree, so `case "each-block"` (`:1650`) is never reached, the `reconciliation` chunk is pruned, and the emitted client's bare calls to `_scrml_each_clear` / `_scrml_resolve_item` throw `ReferenceError` on first render. `conformance/cases/each/ternary-markup-giti033` compiles exit 0 and PASSES its own suite, because the conformance runtime half executes the FULL `SCRML_RUNTIME` monolith instead of the pruned artifact (`conformance/adapters/impl1-ts.ts:467`, `:924`). **THIRD INSTANCE OF ONE CLASS, and the other two are already fixed in this same file with the identical failure sentence in their comments:** `case "engine-decl"` (`:1707`, descends `bodyChildren` for an each in a non-`initial=` engine arm) and `case "match-block"` (`:1750`, raw-text-probes `armsRaw` for `<each`). **The class is: an `<each>` reachable only through a container this walker does not descend into.** See primary.map.md invariant 67 + Task-Shape Routing row 3.
  **NEW this pass (#385/#386/#358, `context.ts`):** `crossFileClientReads: Map<sourcePath, Set<exportName>>` (context.ts, NEW field) is the cross-FILE client-reachability seed, computed once in `runCG` and consumed by both the exporter (widen client-reachability for a directly-imported const) and the importer (`_scrml_modules` destructure) sides. A type-annotated `export const` now emits via the AST `valueInit` field rather than an annotation-blind raw regex. **NEW this pass (#429, U1): the `_scrml_reactive_set("NAME", <stub>(…))` direct-value matcher now ABSORBS an emitter-supplied `await` prefix.** Once `isClientServerFnCall` awaits at the call site, this value arrives as `await <stub>(…)` rather than the bare `<stub>(…)` the matcher was written against — and a miss here silently LOST the `.catch(… -> _scrml_error_boundary_log)` arm, reintroducing the exact browser-level `unhandledrejection` silent drop ss32-item-1 added it to kill. Consuming the prefix keeps THIS pass the owner of the reactive-set-RHS position and re-emits its canonical IIFE form, so output is **byte-identical to pre-U1 for this shape**; U1's gain is in the positions this pass never reached. **NEW (#391):** a cross-module ASYNC import read inside a markup `${…}` interpolation is now awaited — the wrap decision is made off the injector's OWN EMITTED OUTPUT rather than a re-derived predicate (an S239 catch on an earlier version surfaced a page-breaking SyntaxError from an async fn used as a bare combinator callback).
  **NEW THIS WINDOW (#458) — the `post-fn-name-mangle` stage (`:2956`) changed SHAPE, and this is the row to read before touching any whole-buffer text pass.** Two REGION fences replaced what would have been a sixth lookaround. (a) **`joinAroundRuntimeSlot(lines, runtimeSlotIndex, runtimeSource, rewrite)` (:1980, EXPORTED, NEW)** — the assembled runtime is now spliced into its PGO P3.B placeholder slot **AFTER** the rewrite, not before, so **the runtime is not part of the rewrite INPUT at all**: no lookaround has to recognise it and no pattern can reach into it. Two call sites, `:3098` (with `mangle`) and `:3595` (with the identity `(s) => s`); **with `rewrite` as identity it is byte-for-byte `lines.join("\n")` with the runtime in its slot**, which is what the pre-fence code produced, so the non-mangling path is provably unchanged. The bug it removes: a user `fn log()` rewrote the runtime's OWN `_scrml_replay(name, log, endIdx)` parameter (followed by `,`, inside the lookahead set) while the body's `log.length` (followed by `.`, outside it) stayed — **a runtime function silently rewired to a free variable.** Inert in the DEFAULT pipeline (`codegen/index.ts` slices the runtime back off), SHIPPED under `--embed-runtime`. (b) **`rewriteCodeSegment` (:3038)** composes `findObjectShorthandRegions` over each lexical code segment and **EXPANDS** an object-literal shorthand (`{get}` -> `{get: _scrml_get_2}`) rather than fencing it — fencing alone would only trade a silent wrong answer for a `ReferenceError` on a now-free `get`. **ONLY the `object-literal` kind is acted on**; a `binding-pattern` keeps today's emission verbatim (an S239 review showed fencing the pattern while still rewriting the uses it SHADOWS turns a LOUD TypeError into a SILENT wrong answer), and so does `unknown`. Two further region skips are semantics, not caution: a region containing **`__proto__`** is skipped WHOLE (ECMA-262 B.3.1 — only `PropertyName : AssignmentExpression` sets `[[Prototype]]`, so expanding the shorthand deletes the own key; and a bare `__proto__` left beside expanded siblings is ENGINE-DEPENDENT — node binds the global prototype, bun throws), and a region holding no name in `fnNameMap` is left to the ordinary path. **Net sites this pass STOPS REWRITING: ZERO** — every site it touched is still rewritten, as the property VALUE rather than the KEY.
  **NEW THIS WINDOW (#669, §41): the CLIENT STDLIB REGISTRY GATE — `E-STDLIB-CLIENT-CHUNK-MISSING` (:3817-3950).** ⚠ **It runs AFTER `pruneUnusedClientImports` and scans the FINAL emitted client TEXT, and that placement is load-bearing, not incidental.** The first cut gated beside the `lines.push` in `emit-imports` (:2096-2122), which looks co-located — but that push is not the final word: the prune DROPS a lowered read whose names no client code references, so gating at the push rejected **21 correct corpus files (measured, not predicted)**. Two further corrections of the same class, both fixed by changing the scan's **INPUT** rather than its pattern: excise the runtime span (the runtime's own `// const { x } = _scrml_stdlib.NAME;` comment invented a module named `NAME`), then `maskStringLiteralSpans` (:3907) — a bare `<tip> = "the slot is _scrml_stdlib.wombat"` in valid scrml with ZERO stdlib imports was a HARD ERROR naming a module that has never existed. The gate reads `hasStdlibClientChunk` from `runtime-chunks.ts`, i.e. the SAME artifact that decides the outcome. Spans are captured at the lowering site (`stdlibImportSpans`, :2101) and stamped onto TOP-LEVEL `filePath`/`line`/`column` — **not just `span.*`** — because `commands/compile.js:formatError` reads the top-level fields and would otherwise render no `-->` at all (a PRE-EXISTING asymmetry affecting every CGError raised in this file, e.g. `E-CG-001`/`E-CG-006`). Same landing widened `pruneUnusedClientImports`'s region regex with a `(?:/[A-Za-z0-9_$]+)*` tail so a SUBMODULE read is recognised as removable.
compiler/src/codegen/emit-server.ts + emit-tool.ts + emit-library-shared.ts  — **NEW this pass (#390): `distRelativeServerSpecifier` is now a thin `.server.js`-typed wrapper over a generalized `distRelativeLocalSpecifier(sourceSpecifier, importerFilePath, outputBaseDir, targetExt)` / `distLocalPathOf`**, so a §64 tool/library `.scrml` import re-bases to dist space the SAME way a server import does — `emit-tool.ts` and `emit-library-shared.ts` are the new consumers. **NEW (#388): `emitModuleValueExportLines` widened from `const`-only to `const|let|var`** (each keeping its own keyword) — a mutable `export let` closed over by an in-process peer callable used to fall through to nothing, a silent boot/route `ReferenceError`. Companion: `generateServerJs`'s dead-import scan now unions `fileAST._serveImportReachabilityExtra` (stashed by `emit-tool.ts`) so a `serve=` tool's main-only import survives tree-shaking.
  **THIS PASS — three DANGLING-REFERENCE fixes, all the same class: a runtime reference emitted with its BINDING/DEFINITION gated NARROWER than the reference, so the file compiles clean and throws `ReferenceError` -> HTTP 500 at request time.** (a) **GH #357 (#435): `session` is now bound in the handler prologue.** New `_SESSION_BARE_TEXT_RE` (a shared TEXT-level detector — the left-guard `[^\w$.]` is load-bearing, it keeps `_scrml_session_store`/`sessionId`/`_scrml_req._scrml_sess` from matching) + `astSqlQueryUsesSession` (ORed into `_anySessionBuiltin`) + a conditional handler-scope SPLICE. **A `?{ … ${session.userId} … }` carries its query as a STRING, so the AST member/index walk never sees it** — the bare `session` survived as a free variable. **The binding MUST be the `_scrml_session_bind` Proxy, never `const session = _scrml_req._scrml_sess`:** that object carries RAW own-properties `sid`/`_rec`/`_changes`, so a raw bind would make `session["sid"]` disclose the live session id and `session["_rec"]` the whole record **including the §40.2 `csrfToken`**, at HTTP 200 — the exact defeat of the synchronizer-token defense. The Proxy preserves BOTH accessor shapes so the bare binding AGREES with the KEPT AST lowering; `Reflect.get(t, k, t)` (receiver = the TARGET) is load-bearing (the getters read `this._rec`; a Proxy receiver re-enters the trap); `set()` returns false so an assignment through the binding is a loud strict-mode TypeError. (b) **`@currentUser` resolver detection widened (#440): `astReadsCurrentUserAmbient`** is the SUPERSET of `astSqlQueryUsesCurrentUser` that also catches a DIRECT ident read (`return { id: @currentUser.id }` lowers to `IdentExpr{name:"@currentUser"}`) — without it a no-auth/no-serverLoad plain `function` bound `_scrml_currentUser` to an UNEMITTED `_scrml_current_user`. (c) **The §36 SSE `function*` handler now splices the same binding (#440)** at `_sseCuInsertIdx`, byte-identical construction to the route-handler path, gated on the EMITTED text referencing it. (d) **`<channel auth=>`-only programs (#440): `_hasChannelAuth`** is ORed into `_needsSessionInfra` and a new `else if` arm emits ONLY `_scrml_auth_check` (never the CSRF helpers / session-destroy / `@session`-projection routes — those stay `authMiddlewareEntry`-gated, so a channel-auth-only program's route surface is unchanged). **All four detectors are PERMISSIVE BY DESIGN: a false POSITIVE only emits unused session infra; a false NEGATIVE re-opens a 500.**
  **THIS WINDOW (#452) — the non-baseline-CSRF route handler has ONE EXIT and it is always a `Response`.** Before this, the capture IIFE was CONDITIONAL (`_ext5DedupNonCsrf || _protectActive || _tenantActive`) and there were effectively THREE exits: the protect/tenant arm returned a redacted RAW value, the Ext-5 arm returned a real `Response`, and every other shape returned nothing here at all — **the adopter's own `return` became the HANDLER's return, a bare JS value handed to `Bun.serve`.** Both shipped hosts dispatch `return route.handler(req)` (`dev.js` and the built `_server.js`). MEASURED on Bun 1.3.14 over a real socket, and the two halves diverge, which is exactly why it stayed quiet: the WIRE got `200 text/plain` with the CONSTANT body `"Welcome to Bun! To get started, return a Response object."` for EVERY non-Response return, while STDERR logged `Expected a Response object` **only for `undefined`/`null`** — a bare `"ok"`/`42`/`{…}` logged NOTHING. The emitted client stub has always done `await _scrml_resp.json()`, which throws on that text/plain body. Now the IIFE is UNCONDITIONAL (`_bodyIndentNonCsrf`, body indented into it) and one exit envelopes `_scrml_result` as `status: 200` + `Content-Type: application/json` + `JSON.stringify`, mirroring the `useBaselineCsrf` branch MINUS that branch's own double-submit `Set-Cookie`. **Splitting the exit is what let the class hide: the ONE arm a test exercised asserted a `Response`, the two that were not asserted a value.** Load-bearing side effect — `_scrml_session_cookie_wrap` appends its `Set-Cookie: <sid>` onto the return value and SKIPS when that value has no `.headers`, so a bare return also dropped the §20.5 session cookie silently. **ORDER IS NORMATIVE at this exit and both placements are argued in-source:** `if (_scrml_result instanceof Response) return _scrml_result;` sits **BEFORE** the redact (a `Response` is an opaque stream handle the redact cannot inspect; without the guard the envelope does `new Response(JSON.stringify(<a Response>))` -> `"{}"`, turning an adopter's deliberate 403 into a **200** — MEASURED, fail-OPEN), and `_egressRedact` runs **BEFORE** `JSON.stringify` (serialize-then-redact would be a §14.8.9/§14.8.10 confidentiality regression). The passthrough guard exists because the failure it prevents is the fail-open one. **CORRECTION (S355, `a7e99e8f` / #590):** this used to read "currently UNREACHABLE from the corpus — a plain body naming `Response` build-blocks on `E-SCOPE-001`" — now FALSE. `Response`/`Request`/`Headers` are allowlisted in `LOGIC_SCOPE_GLOBAL_ALLOWLIST` (`type-system.ts:7290`), unblocking adopter #471 PDF/binary egress; the guard is now LOAD-BEARING and exercised, and `authed-server-fn-response-http.test.js` was flipped in the same commit to assert the passthrough rather than the E-SCOPE-001 block. **Also this window: the §20.5 session accessor is own-property-guarded** — `get(key)` (`:2593`) is now `Object.hasOwn(this._rec, key) ? (this._rec[key] ?? null) : null`. `Object.hasOwn` and NOT `this._rec.hasOwnProperty(key)` is load-bearing: `_rec` is built from `session.set` writes, so it can carry an own key literally named `hasOwnProperty` that would shadow the method on the one record that attacks it. **Scope: this closes the PROTOTYPE-CHAIN read ONLY** (measured pre-fix: `.get("__proto__")` -> `Object.prototype`; `.get("constructor"/"toString"/"valueOf"/…)` -> functions, and a function reaching a `?{}` bind was an HTTP 500 from a request-controlled key). A real own key still reads, INCLUDING the compiler-owned §40.2 `csrfToken` — see auth.map.md.
compiler/src/codegen/index.ts  — the codegen dispatcher. Owns the chunk-namespace WIRING, `wrapChunkBodyInIife` (:699, applied :2146), the §40.8.2 multi-file shell composition, and the `E-DBAUTH-SQLITE` compile-time driver gate (`annotateDbScopes`). **It does NOT own the runtime-chunk gates and it does NOT own the module-init/boot boundary.** This window: `_scrml_engine_audit_register` added to `CELL_SCOPE_ACCESSORS` (:490) — the audit registration must be chunk-namespaced like every other cell access; and the §51.13 property-test call now passes a `stateChildRules` projection (:2354-2375) built from `fileAST.machineDecls` (falling back to `ast.machineDecls`) via `projectStateChildRules`.
compiler/src/codegen/emit-transition-css.ts  — **NEW THIS WINDOW. The §38 transition directives (`transition:` / `in:` / `out:`) now ship as CSS in the file's OWN stylesheet, not as a runtime-injected `<style>` element.** Two exports, both pure: `collectUsedTransitions(nodes)` walks the AST for `transition:<type>` / `in:<type>` / `out:<type>` attribute names and returns the used set, and `renderTransitionCss(used)` renders the keyframes or `null` for the empty set. Recognised types are `fade` / `slide` / `fly` (`TRANSITION_KEYFRAMES`, mirroring `SUPPORTED_TRANSITIONS` in emit-html.ts), emitted in the fixed `TRANSITION_ORDER` so the stylesheet is deterministic regardless of source order. **WHY IT MOVED: the old path was an always-shipped `document.createElement("style")` IIFE in `runtime-template.js` (runtime chunk `'transitions'`), and an INLINE style element is refused by `<program headers="strict">`'s `default-src 'self'` (§39.2.5) — a strict-headers app lost EVERY §38 transition and the author had no way to fix it.** A same-origin `<link rel="stylesheet">` satisfies the policy with no adopter change and no CSP widening. **The `'transitions'` runtime chunk is RETIRED** (`runtime-chunks.ts:52-54` records it — ⛑ **S384: VERIFIED. The companion claim that `runtime-template.js:3702` "points here" is NOT verifiable: `:3702` is a bare `} finally {` and `grep -n transition compiler/src/runtime-template.js` returns only §51.12 machine-temporal-transition code, nothing about §38 keyframes. Treat the runtime-template half of this citation as UNSUPPORTED until someone re-derives it**). **THE ONE DELIBERATE SCOPE EXCEPTION, and it is the row to read before "optimising" this:** every file emits only the transitions IT uses, EXCEPT the `<program>` shell entry, which emits the APP-WIDE UNION. A §20.8.2 SOFT navigation swaps the target route's markup into the SHELL's live document and never loads the target page's stylesheet (`_scrml_nav_sync_head` syncs `<title>`/description/canonical only), and soft nav is the DEFAULT path — so a page-scoped stylesheet cannot reach a soft-navigated `scrml-enter-fade`. Consumed at `codegen/index.ts:59` (import), `:1754` (union accumulation across all ASTs) and `:2134` (the `transitionCss` binding, which picks union-vs-own by `filePath === _transitionUnionOwner`). The AST walk is WeakSet-guarded — some nodes carry back-references and an unguarded walk revisits or loops forever — and it recurses over EVERY object-valued field rather than an enumerated child list, deliberately, so a new nesting shape cannot silently drop a page's animation CSS. A build with no transition directive anywhere still emits nothing.
compiler/src/codegen/emit-engine.ts  — engine substrate. **NEW this window: the §51.11 `audit` port onto the modern `<engine>` (:2054+).** Emitted only when `meta.auditTarget` is set, and emitted **AFTER the cell inits** (the audit target IS a reactive cell). It registers a CLOSURE via `_scrml_engine_audit_register(varName, recorder)`, not a cell NAME — the write path is the chunk-scope wrapper, so registering a raw name made the runtime look up `<ns>$light` against a `light` entry and find nothing: **the registration emitted, the log stayed empty, and only executing a transition surfaced it.** A REGISTRY rather than a 9th positional argument to `_scrml_engine_direct_set`/`_advance` because those are called from nine emit sites across five codegen modules and one forgetful site would silently record nothing.
compiler/src/codegen/emit-channel.ts  — the `<channel>` emitter. **⛑ NEW THIS WINDOW (#782): §38.4 ECHO DEDUP, and it is a VALUE-level dedup rather than a flag.** A per-cell JSON key of the last value synced (inbound OR outbound) lives in the emitted `_scrml_ls` (`:751`), normalized by `_scrml_lk` (`:756`); the outbound effect (`:844`) skips a send whose key equals last-synced, so an inbound sync never re-emits — **killing the ≥2-subscriber echo storm at the value level.** ⚑ **DELIBERATELY NOT a synchronous suppression flag: a flag causes cross-cell suppression and is wrong for debounced/throttled cells whose effect fires on a LATER timer.** Inbound records last-synced BEFORE applying (`:788`) so the set it triggers sees key === last-synced. `syncShared` (`:826`) is gated `readyState === 1` and RETURNS whether the frame actually reached the wire — **`WebSocket.send` itself returns `undefined`, so the old `&&` form could not distinguish SENT from DROPPED; last-synced is recorded only on a real send, so a write dropped while offline is not deduped away and lost.** Known, accepted residual: an object cell rebuilt in a different key order may miss the dedup and emit ONE redundant frame — harmless (the peer's own dedup absorbs it), never a storm. ⚠ **`:756` EMITS `void 0`, NOT THE `undefined` KEYWORD (#788), AND THE REASON IS A REPO-WIDE GATE:** `W-CG-UNDEFINED-INTERPOLATION` forbids the bare keyword in emitted output. This file already documents the idiom at `:892-895` and uses it at `:687`. **The one-token regression passed the required merge `gate` (unit + conformance) and still turned every contributor's LOCAL pre-commit red (which runs integration too) — see build.map.md's gate-vs-tracking asymmetry.**
compiler/src/codegen/emit-machine-property-tests.ts  — §51.13 auto-generated property tests. **NEW `projectStateChildRules(stateChildren)` (:487, exported)** — projects a MODERN `<engine>`'s state-child `rule=` graph into the `TransitionRule[]` shape the existing machinery consumes (`rule=.B` → one rule; `rule=(.B|.C)` → two; `rule=*` → the `*` wildcard sentinel; no `rule=` → terminal). `legacy-arrow`/`parse-error` forms are SKIPPED — they carry their own diagnostic, and inventing transitions from an unparseable rule generates assertions about a graph nobody wrote. The generator substitutes the projection ONLY where `machine.rules` is empty, so every legacy path is byte-identical. **Also: the vacuous-artifact fix.** An empty run used to emit `test("no qualifying machines", () => expect(true).toBe(true))` — a PASSING assertion verifying nothing, landing in an adopter's suite as a green tick, and firing precisely for the canonical modern `<engine>` form. It is now `test.skip(...)` naming why.
compiler/src/commands/dev.js  — the `scrml dev` server. ⛑ **RESHAPED THIS WINDOW (#823): THREE NEW FUNCTIONS AND ONE DELETED SERVING BRANCH.** `gateProtectedDoc(req, rel)` (`:979`) is now **the ONE place dev consults the protected-document registry** — every path that can return a document runs it, so "did this path gate?" is answerable by grep rather than by reading each branch. `staticCandidates(pathname, staticPathname, serveDir, opts)` (`:1029`) is a GENERATOR yielding, in order, the exact file, the `.html` clean URL, the directory `index.html`, and — for `/` only — `rootFallbackCandidates(opts, serveDir)` (`:1003`, the compiled single-input entry then the sorted-first `.html`). **The ungated root-only `pathname === "/"` branch that used to sit AFTER the static loop is DELETED**; `devDispatch` (`:1050`) now runs one loop over `staticCandidates` and calls the gate at `:1141`. ⚠ **Generator laziness is load-bearing, not style:** `rootFallbackCandidates` does a synchronous `readdirSync`, and `/` is the URL `scrml dev` prints — building the candidate list eagerly would pay a blocking directory read on every reload even when `index.html` hits first. ⚠ **The gate call is deliberately OUTSIDE both `try` blocks** so a throwing auth guard is LOUD; while it sat inside a wide `try` it produced a silent 404 and could fall through to a DIFFERENT file. See auth.map.md row 3.
compiler/src/commands/migrate.js  — the `scrml migrate` source codemod. **Migration 2a (NEW, S307) runs BEFORE the keyword swap and is the load-bearing half.** A blind `machine`→`engine` swap is NOT semantics-preserving for the §51.9 PROJECTION form: `<machine … derived=@x>` + a `.A => .B` body compiles to a real MAPPING function, while `<engine … derived=@x>` is an IDENTITY projection **that silently drops the rules body**. 2a therefore lifts the body into `derived=match @x { … }` (§51.0.J), normalizes `=>` → `:>`, REPLACES `name=` with an explicit `var=` (on a derived engine `name=` marks the legacy NAMED form, which auto-declares no cell — `name=UI var=ui` leaves `@ui` undeclared, measured), and synthesizes a self-closing state-child per distinct projected-TO variant. **Fails CLOSED: any unparseable body line leaves the whole declaration untouched** to fall through to the plain keyword swap, because half-migrating a projection silently drops mappings. Migration 2 (`:317`) swaps openers; **2b (`:329`) swaps the `</machine>` CLOSER** — rewriting openers alone leaves `<engine …>` paired with `</machine>`, which parses as a mismatched tag.
compiler/src/runtime-template.js  — the client runtime shipped into generated apps. **CORRECTION: this window's change is the §51.11 AUDIT REGISTRY, not the soft-nav/region-teardown surface** (that code is unchanged since navigate-wave1b/1c). New: `_scrml_engine_audit_targets` (:4914), `_scrml_engine_audit_register(varName, recorder)` (:4931), `_scrml_engine_audit_push(varName, from, to)` (:4936), called from `_scrml_engine_advance` (:5078) and `_scrml_engine_direct_set` (:5137). Tree-shaken by construction (codegen emits a registration only for an engine declaring `audit`). **NB the file is embedded in a template literal — no backticks may appear in it.** ⛑ **S384 (#749, +55) — THIS FILE NOW EXPORTS A SECOND ARTEFACT BESIDES `SCRML_RUNTIME`, AND IT IS A SLICE OF THE FIRST, NOT A COPY.** `SERVER_VALUE_NATIVE_MAP_HELPER` (:6355, an IIFE evaluated at module init) cuts the §59 value-native map/set runtime OUT of `SCRML_RUNTIME` verbatim, between two new marker comments — `// __SCRML_MAP_RUNTIME_START__` (**:5602**) and `// __SCRML_MAP_RUNTIME_END__` (**:6135**) — so `emit-server.ts` can inline it into a standalone `.server.js` (import `:45`; the two reachability-gated injects at `:1478` and `:5835`) that never imports the client runtime. **The slice contract is load-bearing and stated in source: everything between the markers MUST be pure hoistable `function` declarations** (no top-level executable statement), because the slice is injected after the module header. **Rename or delete a marker and the IIFE THROWS at first use, deliberately** — an empty helper would resurface the original `ReferenceError: _scrml_map_from_entries is not defined` as a silent runtime bug. Same single-source discipline as the structural-eq / enum-table server ports: there is no second copy to drift.
  Standing region-lifecycle facts (UNCHANGED code, now SPEC-ratified — see domain.map.md): `_scrml_destroy_scope` (:1390; ⛑ **S384 — `:1339` was ALREADY WRONG; re-derived by grep. `_scrml_unmount_scope` is :1519**) does the §6.7.2 four-step teardown and is reachable **ONLY** via `_scrml_unmount_scope` (:1469), the `if=` path. `_scrml_nav_apply_html` (:3060) calls `_scrml_teardown_region(liveOutlet)` (:3090), never `_scrml_destroy_scope`. `_scrml_teardown_region` (:3204) drains ONLY (⛑ **S384: `:2996`/`:3026`/`:3122` were ALREADY WRONG — re-derived by grep**) `_scrml_region_cleanups`. **Its doc-comment (:3114) claims it tears down "timers" — that is true ONLY for a `<timer>` lexically inside the shell's `<outlet>` element (`_outletResident`), and FALSE for every route-chunk timer.** `_scrml_region_track` (:4291) keys on `el.closest("[data-scrml-outlet]")`, so it cannot help a `<timer>` — `_scrml_timer_start` takes no element and `<timer>` emits no DOM node.
  **CHANGED THIS WINDOW (#510, §6.7.6): `_scrml_timer_start(scopeId, timerId, intervalMs, bodyFn, immediate)` gained a FIFTH parameter.** When `immediate` is truthy the function calls `tick()` once directly after `setInterval` arms — **through the same `tick()` path, so it inherits the queuing and error handling** rather than duplicating them. **Never re-fired on resume** (the immediate tick is at ARM time only; `_scrml_timer_resume` is untouched). Callers passing four args are byte-identical to pre-fix.
  **NEW THIS WINDOW (#662, §6.8): `_scrml_reset_apply(name, r)` (:1179)** — the thenable-aware apply leg both `_scrml_reset` re-invocation paths now route through (`:1214` default thunk, `:1219` init thunk). `reset(@cell)` used to re-invoke the init thunk with **no `await`**, so a cell whose init calls a server fn was correct at mount and became a raw Promise on reset. ⚠ **Read the `Promise.resolve(r)` FIRST — it is a correction, not a flourish.** A bare `r.then(...).catch(...)` assumes `.then` returns a promise, which is true of a real Promise and NOT of an arbitrary thenable: `{ then: (res) => res(99) }` returns `undefined` from `.then`, so `.catch` is a `TypeError` thrown SYNCHRONOUSLY out of the adopter's event handler, aborting the rest of it. Adopting the thenable first is also what makes the declaration-path parity claim TRUE rather than merely plausible. **This CLOSES the primary.map.md routing row that said `reset(@cell)` returning a Promise was OPEN/HIGH/not-built.**
compiler/src/expression-parser.ts  — expression parsing + `exprNodeCollectCallees` / `forEachIdentInExprNode`. **NEW `matchInputStateSigilLeft(s, end)` (:1052) + a `>` case in `scanLhsLeft` (:1181).** Root cause of `g-request-data-is-some-misroute` was HERE, at the PARSE layer, not in routing: `rewriteIsPredicates` runs on the RAW string BEFORE `parseExpression` normalizes `<#id>` → `__scrml_input_id__`, so the sigil's own `>` reached the LHS scanner and read as a chain terminator — fragmenting `<#r>.data is some` into a bare `.data` LHS → acorn ParseError → escape-hatch → the mis-routing string fallback.
compiler/src/indirect-callee-resolver.ts  — per-function-body resolution of callees reached INDIRECTLY (first-class ref, alias chain, dispatch table). **NEW `IndirectResolution.dispatchCalledTargets` (:71)** — the free-identifier names reached through a DIRECT dispatch CALL (`t["k"](…)`, `t.k(…)`, or `t[dyn](…)` ⇒ the whole member set). Those have a member/index callee and are absent from `calledNames` entirely. **Also NEW: a raw-text scan for a dispatch call inside a TEMPLATE literal or `?{}` SQL body** — a template's `${…}` is not decomposed into AST nodes, so a `t[k]()` there was invisible, its target got no caller edge, was dead-code-dropped, and the emitted `t[k]()` threw `ReferenceError`. The trailing `(` requirement keeps a bare member READ (`${t.a}`) from escalating. `fnParamNameSet` still exists because `FunctionDeclNode.params` is TYPED `string[]` while the ast-builder produces `[{name}]` objects.
compiler/src/markup-return-scan.js  — **NEW FILE THIS WINDOW (#658, S367-peter) — the SINGLE SOURCE for "does this fn return markup?", and it exists to stop a two-site drift.** A nested `<each>` interp of a markup-returning fn call must MOUNT the returned DOM node (the `<span data-scrml-mv>` mount-or-text wrapper, GH #161), not `String()` it into `[object HTMLSpanElement]`. Two independent consumers must agree or an IMPORTED markup fn behaves differently from a same-file one: **`codegen/emit-each.ts`** (same-file fns) and **`module-resolver.js`** (per-module export classification → `returnsMarkup` on the export-registry entry, with an import-graph FIXPOINT so a re-exported wrapper at any depth is classified). **Authored in plain JS on purpose** — MOD runs BEFORE codegen and is plain JS; emit-each imports it as TS-imports-JS. Exports: `exprYieldsMarkupValue` (:27, POSITIONAL — markup in an argument/closure/condition does NOT flag a string-returning fn), `fnBodyReturnsMarkup` (:65), `fnBodyReturnsCallToMarkupFn` (:100), `interpMayYieldNode` (:128), `resolveImportedMarkupLocalNames` (:167), `collectMarkupReturningFnNames` (:188). **Contract: every predicate is FAIL-SAFE — never true for a string-yielding shape — so the markup-fn set only ever WIDENS, and the emitted mount is `instanceof Node`-guarded regardless.** Residual OPEN: `g-each-nested-markup-interp-stringifies` (the cross-file imported limb is what #658 closed).
compiler/src/codegen/usage-analyzer.ts  — ⚑ **A NEGATIVE ROW, ADDED S371 BECAUSE ITS ABSENCE COST THREE SESSIONS. THIS FILE IS *NOT* THE `W-DEAD-FUNCTION` LOCUS** — `docs/known-gaps.md` carried `locus=compiler/src/codegen/usage-analyzer.ts` from S369 until S371, a dispatch brief repeated it, and the map set had nothing that contradicted it. **What the file actually is:** the Phase-A1c Step-C0 feature-usage analysis pass. It walks A1b's annotated AST and produces a `FeatureUsage` **boolean bitmap** (14 universal-core predicate flags + one flag per v0.next runtime feature) consumed by the downstream runtime-elision steps. Exports: `FeatureUsage` / `emptyUsage` / `fullUsage` / `mergeUsage` / `analyzeUsage`. Soundness > completeness: conservative structural-AST-kind triggers, fires `true` when in doubt (false-negatives crash apps, false-positives only bloat). **Its own header (`:16-17`) states the disqualifying property: *"What C0 does NOT do: zero new diagnostics, zero AST mutation, zero emission."*** It contains exactly ONE occurrence of the string `W-DEAD`, a prose mention in a comment at `:692`. **The locus is `compiler/src/route-inference.ts` — see its row above and error.map.md's `W-DEAD-FUNCTION` section.**
compiler/src/codegen/runtime-chunks.ts  — **THE CLIENT RUNTIME CHUNK REGISTRY, and as of #669 `RUNTIME_CHUNK_ORDER` IS A NORMATIVE CLIENT CONTRACT, not a convenience list.** A client-side `import { x } from 'scrml:NAME'` lowers UNCONDITIONALLY to `const { x } = _scrml_stdlib.NAME;` (a classic script cannot resolve a bare specifier), and `_scrml_stdlib.NAME` is defined by the `stdlib-NAME` entry in this array **and by nothing else** — so an absent entry is a load-time `TypeError` that kills the WHOLE page. **Stdlib chunks went 4 -> 13 this window** (`auth`, `compiler`, `crypto`, `data`, `format`, `host`, `http`, `math`, `random`, `regex`, `router`, `test`, `time`); before that, client stdlib imports were **DOA for 17 of 21 modules** at exit 0 with zero diagnostics. **Membership is DERIVED, not curated:** a module is client-registered iff it is NOT an escalation-server-only module under the §12.2 Trigger 3 two-limb criterion (`route-inference.ts:ESCALATION_SERVER_ONLY_MODULES`) — (a) host reach into `Bun.*`/`process.*`/`bun`/`bun:*`/`node:*`, or (b) credential handling. The 8 deliberately absent (`cron`, `fs`, `mcp`, `oauth`, `path`, `process`, `redis`, `store`) each carry a one-line reason AT the absent block. `auth`/`crypto` fail the criterion yet carry a chunk — PRE-EXISTING (S95 Bug 18), left alone deliberately because removing a chunk is a behaviour removal. New exports: **`STDLIB_CLIENT_CHUNK_MODULES`** (:349, a `ReadonlySet` derived from `RUNTIME_CHUNK_ORDER` itself) and **`hasStdlibClientChunk(moduleName)`** (:381). ⚠ **Matching is EXACT — a SUBMODULE DOES NOT INHERIT ITS ROOT'S CHUNK**, because `scrml:auth/jwt` lowers to `_scrml_stdlib.auth/jwt`, which JS parses as the DIVISION `_scrml_stdlib.auth / jwt` and dies with `ReferenceError: jwt is not defined` even though `_scrml_stdlib.auth` IS defined. Root-matching would wave through an unconditionally-broken emission. **Do not add a second hand-maintained list anywhere** — the S368 defect was exactly a gate (`existsSync` of a shim FILE; all 21 exist) reading a different artifact from the one that decides the outcome.
compiler/src/type-system.ts  — the TS pass. **NEW this window: the §6.7.3 `cleanup()` argument-shape + scope battery (:18791-18860) — `E-LIFECYCLE-002` (argument is a CALL expression, the load-bearing one), `E-LIFECYCLE-004` (non-call, non-function shape), `E-LIFECYCLE-001` (`cleanup()` outside any element scope). All three were CATALOGED-BUT-UNWIRED before S310 W1.**
  ⛑ **S391 (#785, +298L) — THE `<each>` OPENER IS NOW SCOPE-CHECKED, AND IT ADDED ZERO NEW EMIT SITES.** `checkEachOpenerExpr` (`:12879`, a local arrow inside `annotateNodes`, NOT an export) hands the opener value WHOLE to `parseExprToNode` (`:12964`) and routes the result through `checkLogicExprIdents` (`:12969`) — the walker that already owned `E-SCOPE-001`, whose two `errors.push` sites are still `:7876` / `:7906` inside `checkLogicExprIdents` (`:7744`). **Three call sites, all in the `<each>` opener: `:13002` (`inExprRaw`) · `:13004` (`ofExprRaw`) · `:13042` (`keyExprRaw`).** ⚠ **THERE IS DELIBERATELY NO `@.`-PREFIX BAIL, AND THE SOURCE COMMENT EXISTS TO STOP YOU RE-ADDING ONE.** An earlier revision copied the `<match on=>` precedent's `if (raw.startsWith("@.")) return;`; that guard skips the ENTIRE opener rather than the `@.` sub-read, so `key=@.id + @typo` and `in=@.rows.concat(@typo)` never scope-checked `@typo` and the mistake surfaced from CODEGEN as `E-CODEGEN-INVALID-LOGIC` instead of naming the undeclared cell. **Leading `@.` is far more common on `<each>` than on `<match on=>`, so a guard that was proportionate at the site it was copied FROM is not proportionate here.** ⚠ **THE `<each in=>` ARC LANDED WHOLLY IN THE TS PASS — `symbol-table.ts` IS NOT PART OF IT, AND THE S391 DISPATCHING BRIEF SAID IT WAS.** Measured: `git show --stat 4bc6bc03` touches **exactly one** source file, `compiler/src/type-system.ts`. `symbol-table.ts` DID move in this window — but under `eaedbd0a` (ruling 3's stable half), an unrelated arc. **Two files changing in one window is not two files changing together; attribute a change to its COMMIT, not to the window it shares.**
  **NEW THIS WINDOW (#665, §7.5/§14.7 — the `asIs`/`unknown` SPLIT, the biggest shape change this file has had in eleven windows).** `inferExprType` (**:569**) no longer returns a bare `ResolvedType`; it returns **`InferenceResult`** (`{ok:true,type}` | `{ok:false,gap}`, :440) so a caller cannot reach the failure branch by accident. `UnknownType` (:387) now carries a **REQUIRED** `reason: UnknownReason` (:409) — three sources, `inference-gap` / `forward-ref` / `not-a-node`. `tUnknown(reason)` (:1307) has **no zero-arg overload and no default**, deliberately. `InferenceGap` (:421) types `nodeKind` as `ExprNode["kind"]`, not `string`, and `inferExprType`'s `never` fallthrough makes a new `ExprNode` member nobody taught inference about a TYPE ERROR rather than a silent `asIs`. **The distinction is the point: `asIs` = a developer signed for it (§14.7's named escape hatch, silent by design); `unknown` = the compiler did not look, or looked and could not tell — nobody signed for it.** New diagnostic `W-TYPE-031-UNPROVEN` (warning, emitted at **:10600**). See schema.map.md for the shapes and error.map.md for the code.
⛑ **S445: FILE DELETED by #1196 (`a7d3d13a4`) — this row is SUPERSEDED.** compiler/src/default-logic-exemption.ts  — **⛑ NEW THIS WINDOW (S383, 98L) — a LEAF module with exactly ONE export and, today, exactly ONE consumer, and that is deliberate.** `isDefaultLogicBodyTopExempt(filePath): boolean` (:88) is the per-file exemption predicate for the §40.8 default-logic BODY-TOP diagnostics: it loads `compiler/src/unit-cc-exemption-list.json` once at module init via synchronous `readFileSync` (malformed/absent JSON → empty list, silently) and matches **strict-then-lenient** — direct `Set` membership first, then a suffix match that REQUIRES a `/` boundary immediately before the entry (or the entry to BE the whole path), so a short entry like `"a.scrml"` cannot claim `/foo/bar/not-a.scrml`. The lenient limb exists because spans carry ABSOLUTE paths while the list is repo-relative and a worktree harness inserts a `.claude/worktrees/agent-XXX/` segment. **⚑ THE POINT IS THE DEPENDENCY DIRECTION, NOT THE CONSUMER COUNT: TAB runs BEFORE SYM, so `ast-builder.js` MUST NOT import from `symbol-table.ts`** — a leaf module is what both stages are allowed to depend on. It was extracted at S379 out of `symbol-table.ts` for a SECOND consumer (a TAB-stage `E-CALL-NOT-IN-LOGIC-CONTEXT` gate) that is **HELD and NOT in the compiler**; as of S383 there are **TWO** held TAB-stage consumers, the second being ruling 3's §40.8 arm of `E-CONTROL-FLOW-IN-MARKUP` — **also held, also not in the compiler.** Do not read the module header as evidence either gate exists. **Do not "simplify" by folding it back into `symbol-table.ts`** — that reintroduces the stage-order coupling it exists to avoid. The list is per-SURFACE, not per-CODE, and sunsets per-file and MANUALLY so migration progress is visible in version control. Sole live consumer: `symbol-table.ts` PASS 3, through the local `isUnitCCExempt` alias, for `E-WRITE-NOT-IN-LOGIC-CONTEXT` (S123 "Unit CC").
compiler/src/symbol-table.ts  — the SYM pass battery. PASS 15.5 `collectOutlets`; PASS 5a `walkNonBindableMarkupDecls`; sole fire site for `E-CHANNEL-INSIDE-PAGE` (**:10249**; ⛑ **S383: the carried `:9377+` was ALREADY WRONG pre-window — it named a `lift-expr` walk branch. The `code:` literal is `:10249`; the surrounding S299 wiring note is `:9394`-`:9415`. Re-derived by grep**). :6177 carries the note that the `<machine>` path emits ONLY `E-DEPRECATED-001` and no second redundant diagnostic; :7282 records that `E-ENGINE-AUDIT-UNSUPPORTED-BODY` was the make-it-loud placeholder now retired by the port. (⛑ S383 — all three **−12**, were :9377 / :6189 / :7294; this file SHRANK because the Unit CC exemption loader was extracted out of it.) ⛑ **S383, AND IT IS THE ONE STRUCTURAL CHANGE HERE: the §40.8 per-file exemption loader NO LONGER LIVES IN THIS FILE.** The `readFileSync` JSON loader, the `UNIT_CC_EXEMPTION_LIST` array and the `UNIT_CC_EXEMPT_SET` binding are **GONE** (grep them — zero hits is the intended staleness check). This file now does `import { isDefaultLogicBodyTopExempt } from "./default-logic-exemption.ts"` (:216) and keeps `const isUnitCCExempt = isDefaultLogicBodyTopExempt` (:219) purely as a back-compat alias for the PASS 3 call site (`walkResolveAtNames`, :2508). **Do not fold the module back in** — the dependency DIRECTION is the point (TAB runs before SYM, so `ast-builder.js` may not import from here).
compiler/src/route-inference.ts  — §12 server/client PLACEMENT inference. **THE ONLY BEHAVIOURAL SOURCE DELTA OF THIS WINDOW (+53, #688) — and it is the whole window.** ⚑ **THIS FILE IS THE `W-DEAD-FUNCTION` LOCUS. `codegen/usage-analyzer.ts` IS NOT, despite the gap ledger's `locus=` field from S369 to S371.** Sole emit site `:5615-5616`; the D4 block at `:5575` inside the `analysisMap` loop at `:5564`; the ten-term suppression conjunction at `:5614`. `markupReferencedNames` is built at `:4852` and populated by `walkMarkupContext` (`:4876`); **NEW #688: the per-kind `each-block` block at `:4966`** collects idents from `inExprRaw`/`ofExprRaw`/`keyExprRaw`/`ifRaw`, because an `<each>` lowers to `kind === "each-block"` with **no `attrs` array**, so the attribute branch never saw an opener expression. ⚠ **That set is NOT diagnostic-only — it is also read at `:5210` (Step-5c indirect server-escalation) and `:6242` (`clientRootIds`), so widening it moves CODE PLACEMENT** (primary.map.md invariant 68). ⚠ Carried from S368: **+275 was LAST window's delta, not this one.**  **TWO server-only module sets in this one file, deliberately different, and conflating them is a KNOWN DEFECT VECTOR:** `SERVER_ONLY_SCRML_MODULES` (:579) feeds **ASYNC** classification via the `api.js` STDLIB-EXPORT-SEED backstop (over-inclusion SAFE — an unresolvable re-export defaulting to async costs nothing); `ESCALATION_SERVER_ONLY_MODULES` (:656) feeds **PLACEMENT** (under-include = a server-only module ships to the browser; over-include = correct client code is relocated to the server — reusing the async set was MEASURED at S299 to over-escalate **72** corpus import sites, 72 of them `scrml:data` alone). Membership of the escalation set is TWO-limbed and normative (host reach OR credential handling); the second limb was added after a host-reach-only criterion cleared `scrml:oauth` as client-safe while it transmits `client_secret`. **NEW #486 — Step 3b (:4429), `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19):** the Step-3 per-function loop iterates `collectFileFunctions`, which honours §12.4's "route inference SHALL be per-function" LITERALLY and yields `function-decl` nodes only, so a derived cell (a `state-decl`, `shape:"derived"`) was never visited. Step 3b visits it separately and **REFUSES rather than escalating** — a derived recompute is synchronous lazy-pull (§6.6.3) and cannot become a round trip. Supporting: `scanForServerOnlyBindingRefs` (:3451, the ONE shared reference walk behind BOTH the per-function `collectServerOnlyBindingModules` (:3397) and the derived-cell `collectDerivedRhsServerOnlyRefs` (:3616); returns local NAMES→modules, not just modules, because the diagnostic must name the member), `collectDerivedRhsLocalNames` (:3562, the shadow set), `stateDeclRhsRoots` (:3541), `collectDerivedCellDecls` (:3650), `isToolProgram` carve-out (:4459). `inverseCallerMap` (**:4727**) must stay BYTE-IDENTICAL — it also drives `E-ROUTE-001` and the D4 `W-DEAD-FUNCTION` gate; indirect edges live in the SEPARATE `indirectInverseCallerMap` (**:4968**), consulted only by the Step 5c fixed point, and are **ESCALATION-ONLY**. Step 8b fires `W-AUTH-MIDDLEWARE-AUTO-INJECTED` (**:6001**).
  **REWRITTEN THIS WINDOW (#500, §6.6.19) — `collectDerivedCellDecls` is now `:3730`, EXPORTED, and STRUCTURAL.** The prior version descended exactly `node.body` and `node.children` while its doc comment claimed "at any depth"; **six positions leaked** (table in auth.map.md). It now descends EVERY array- and object-valued property, exclusions in `skipDerivedWalkKey` (`:3677`) — `key === "span" || key.startsWith("_")`, two clauses, deliberately the smallest justified list. Termination: an identity `seen` set over every visited object plus `MAX_DEPTH = 512` (the walk now descends ESTree expression trees, which nest one level per term; measured corpus max is 37). **Step 3b moved to `:4526`; the `E-DERIVED-SERVER-ONLY-REACH` push is `:4572`.** Two properties to know before writing a test here: `Object.keys` yields property-INSERTION order (Step 3b does not sort by span, so diagnostics are NOT in source order), and the export exists because driving termination through `runRI` conflates it with sibling walks — **`collectFileLevelBindingRoots` (`:2600`) has no `seen` set at all and blows the stack on a synthetic cyclic AST long before this walk is reached.**
  ⚠ **A STALE, ORPHANED DOC COMMENT IS LIVE ON MAIN AT `:3643-3657`** — a full `/** … */` block describing a SIX-entry deny-list (`span`, `loc`, `spans`, `parent`, `_scope`, `_record`) sits immediately above the CURRENT block on the same function, and the current one explicitly records that the S337 review DELETED `parent`/`loc`/`spans`. Two contradictory doc comments, stale one first. **The shipped predicate is the two-clause one.** Reported to the PA, not edited here — this map's dispatch is scope-barred from compiler source.
compiler/src/component-expander.ts  — **⚑ S372 (#699) — `substitutePropsInLogicStmt` gained a PRE-SWITCH early return for `when-worker-message` / `when-worker-error`.** Those two AST kinds are **not members of the `LogicStatement` discriminated union**, so they fell to `default` and were returned UNCHANGED — and codegen emits their body from `bodyRaw`, so a component prop referenced inside a parent-side worker handler shipped as a bare unsubstituted identifier (`ReferenceError` / wrong value at runtime). The substitution MECHANISM is the existing `rewriteIdentsInRawExpr` raw-string pass keyed on `propExprMap` — leading-identifier discipline, so `label` -> the caller value while `x.label`, `mylabel` and string-literal contents are untouched, and the handler binding (`m`/`e`) SHADOWS a same-named prop. **The transferable bit: a `default` arm over a discriminated union silently accepts every kind that is not in the union.** §15 expansion. `expandComponentNode` deep-clones `def.nodes` per expansion via the FILE-level `NodeCounter`; `_deepCloneAst` is MEMOIZED and the memo is load-bearing (a markup node's `templateChildren` and `bodyChildren` share objects), PER TOP-LEVEL CALL, and THROWS on a `Map`/`Set`/`Date`/`RegExp`. Residual duplicate-id families (defChildren-CSS, slot-fill, channel-inline, for/match) affect only `text`/`li`/`p`/`logic` kinds — **zero `each-block`**.
  ⛑ **S391 (#781/#789) — THIS FILE IS THE `E-CHANNEL-MOUNT-IN-CONDITIONAL` LOCUS, AND THE ONLY ONE.** `reportChannelMountsInConditionals` (`:4968`), sole call site `:4687` inside `runCEFile`, gated `importedChannelAliases.size > 0` and run **BEFORE `expandChannels` so the file fails CLOSED rather than shipping half-wired markup at exit 0**; the `errors.push` is at `:4979`. ⚠ **THE §34 ROW SAYS "Four containers are refused"; THE CODE'S DISCRIMINANT SET IS THREE AST KINDS** — `kind === "match-block" || kind === "each-block" || kind === "engine-decl"` (`:5028`). The row's remaining entries (an `<each>`/`<match>` that is a DIRECT child of an `<engine>` body; any subtree of one of those) are **positions the nearest-enclosing-container walk covers, not additional kinds — do not go looking for a fourth `kind` string.** Two lockstep label tables drive the message: `CHANNEL_MOUNT_CONTAINER_LABEL` (`:4947`) and `CHANNEL_MOUNT_CONTAINER_NOUN` (`:4962`); they exist because the trailing back-reference was once hardcoded to "this arm", so an `<each>`-body mount printed *"inside an `<each>` body … including inside this arm"* — naming a construct that is not there. ⚑ **The walk attributes a mount to its NEAREST enclosing container and NEVER classifies an arm wrapper node itself** — each half closes a defect found in review. ⚠ **The `_reparseEachArmBodyRaw` text stash is deliberately NOT scanned, and must not be re-introduced:** that scan was deleted at S385 by ruling because it refused a valid file over a comment that merely NAMED the alias.
compiler/src/protect-analyzer.ts · schema-differ.js · commands/db-migrate.js · sql-table-refs.js · codegen/{db-authoritative,sql-ident,tenant-egress}.ts  — the §14.8.9/.10/.11 security tier. **Untouched this window;** rows carry their `fe14c9b2` walk. See domain/migrations/schema maps.
compiler/src/codegen/emit-html.ts + emit-each.ts + emit-lift.js + emit-bindings.ts + emit-variant-guard.ts + binding-registry.ts  — the §17.1/§17.1.2 `if=` surface and the per-item reconcile family. `emitIfMountGate` (:1421) is the SOLE `if=` lowering; `emitGatedStructural` (:1498) the structural adapter; `refuseConditionalInDispatchedArm` (:780) the `E-IF-IN-DISPATCHED-ARM` guard with THREE call sites (:1508 / :1737 / :2727). The `if=` surface itself is untouched this window.
  **REVERTED THIS PASS (#464, `0536a90f`, operator-ruled): the #450 `show=`-false SSR-hide is GONE.** `emit-html.ts` is **byte-identical to `71623be3`** (verified: `git diff 71623be3 6f176c0d -- compiler/src/codegen/emit-html.ts` is EMPTY). `buildInitialBoolMap`, the `initialBoolMap` local, and the two `_showInjectFreshStyle` / `_showMergeIntoStyle` emit-site flags **no longer exist** — grep finds none of them. **`show=` emits NO inline `display:none` at SSR time; §17.2 first paint is owned entirely by the client hydration controller.** The unit test `unit/show-false-ssr-hidden-no-fouc.test.js` (197L) was DELETED with the code. What replaced it is a REGRESSION GUARD in the other direction: four conformance cases **`control-flow/ctrl-017..ctrl-020`** now pin the POST-revert contract (`ctrl-017` variant-render, `ctrl-018` module-init write fail-open, `ctrl-019` spelling parity, `ctrl-020` no duplicate `style`), each asserting `count: 0` for `[style*="display:none"]` / `[style*="display: none"]`. **The load-bearing reason, from `ctrl-017`'s own rationale:** a `<match>` arm body is lowered by the SAME `generateHtml`, so an emit-time hide is baked into the string literal `dispatch` assigns to `_mount.innerHTML`; the re-mounted element carries no controller (`wire_<Arm>` does not re-bind a visibility toggle and `_scrml_nav_rewire` is never re-run on a variant swap), so a baked `display:none` could NEVER be cleared. §17.2's "toggle" needs a toggler. **Every uncertainty now fails OPEN** — a missed hide is a brief flash; a wrong hide is permanently invisible content.
compiler/src/gauntlet-phase1-checks.js  — schema-declaration checks; sole fire site of `E-SCHEMA-010` and `E-SCHEMA-011`.
compiler/src/gauntlet-phase3-eq-checks.js  — the `E-EQ-001`/`E-EQ-002` equality battery. This window: local bindings are scoped PER FUNCTION so same-named locals in two functions no longer unify (#312, GH #274 Wall-1), and the message now names which operand carries which type and where it got it (#324).
compiler/src/types/  — shared TS type declarations: ast.ts, auth-graph.ts, reachability.ts. **Untouched this window** — no new FileAST node kind landed, which is why schema.map.md was NOT re-walked.
compiler/src/validators/ · native-parser-canary/ · native-walker/ · reachability/  — ⛑ **S437: `validators/` is 9 files (+`defer-structure.ts`, `lint-defer.ts`, `lint-redeclare.ts`); `native-walker/` gained `forbidden-js-native.ts`.** ⟵ prior: standalone AST-walk validators (6), the within-node parity classifier, the 3 canary walkers, the reachability solver (8).
compiler/native-parser/  — the from-scratch native lexer/parser (Road-B): each stage ships as a paired `.js` (live) + `.scrml` (canonical source) — 79 files. **ZERO diff this window and none owed** — every landing is emit-time, runtime, diagnostic-message or CLI. The rule stands: **a landing that adds an AST FIELD to a structural node owes a native mirror; an emit-time / runtime / CLI / message-only landing does not.** `E-SCRIPT-001` remains a confirmed pre-existing gap (`parse-markup.js:983-995`).
compiler/self-host/ + self-host-v2/  — Road-A (17 files) and Road-B self-host compiler implementations, hand-authored in scrml. ⛑ **S437: `compiler/tests/self-host/` is RETIRED (only `README.md` remains) — a bootstrap module is now judged by `bun scripts/hybrid.ts --swap <STAGE>=<module> --conformance` (S430 P5), not per-module parity tests.**
compiler/runtime/stdlib/  — the JS host-shim side of the 21 stdlib modules. compiler/runtime/idempotency.js — idempotency-key store for generated server code.
compiler/tests/  — ⛑ **S395: 1,424 `*.test.js`** (re-executed here; +11 this window — `unit +10 · browser +1`) · **1,386 `*.test.js`** (recursive recount at `728bdc92`, agrees with `docs/FACTS.md`; FACTS counts `.test.js` ONLY and excludes **15** `.test.ts`, so a `git ls-files '*.test.*'` figure is a different population, not a contradiction): unit (901) / integration (213) / conformance (133) / browser (94) / commands (14) / **14 top-level** / lsp (11) / self-host (4) / e2e-render-map (2). **Net +8 this window, ZERO deleted.** ⚠ **The PRIOR map's per-directory breakdown did not sum to its own total (1,344 vs 1,378) — this one does (1,386), because it was taken recursively per directory.** New this window: `integration/stdlib-client-registry.test.js` (37 cases, #669 — **MOVED browser/ -> integration/ deliberately**, because `.git/hooks/pre-commit:39` runs unit + integration + conformance + root `*.test.js` and **`compiler/tests/browser/` is NOT in that set**, so the merge-blocker proving the feature is not DOA was itself outside the merge gate), `unit/s365-asis-unknown-split.test.js` (#665), `integration/each-inline-value-form-if-interp.test.js` (#670), `integration/value-form-if-empty-string-branch.test.js` (#672), `integration/value-form-if-fn-condition-reactive.test.js` (#673), `integration/each-cross-file-imported-markup-fn-mount.test.js` + `browser/each-cross-file-imported-markup-fn-mount.browser.test.js` (#658), `integration/library-mode-fn-match-object-arm-lowering.test.js` (#664), `integration/trucking-dispatch-smoke-integration.test.js`. **`compiler/tests/TYPES-BASELINE.json` is NEW and is NOT a test file** — it is `scripts/types-gate.ts`'s name->COUNT baseline. See test.map.md.
compiler/SPEC.md  — the normative language specification, ⛑ **S395: 37,647 lines** (+108 this window, ONE commit — #802's §17.6 value-form amendment; NEW subsection §17.6.10 at `:12143`, new `arm-body ::= '{' expression '}'` alternative in the §17.6.1 grammar at `:11851`, governing sentence at `:11888`. ZERO new §34 rows) · was **37,539 lines** (+241) (`docs/FACTS.md` is the authority); §34's range shifts release-to-release, derive it from headings not a baked line number. Authoritative per pa.md Rule 4. **+146 lines this window** after two byte-identical windows — the §40.3/§40.8 one-onion rule (`E-MW-007`, prose at `:22652`, catalog rows at `:19693` + `:22715`) plus the §62.8/§63.3 no-editions re-grounding. `SPEC-INDEX.md` moved 33/33: a heading-drift ALIGNMENT sweep (#648), not new content.
compiler/SPEC-INDEX.md — section-number lookup index. Its totals block is `@generated` + CI-gated (`scripts/regen-spec-index.ts --check`) and tracked correctly. Its AUTHORED half did NOT — see non-compliance.report.md.
compiler/PIPELINE.md — the compiler pipeline stage-by-stage reference. Still describes `<machine>` as a deprecated-but-live opener — see non-compliance.report.md.
stdlib/  — the canonical `.scrml` SOURCE of the 21 stdlib modules; **SHIPPED in the npm package** (`module-resolver.js`'s `STDLIB_ROOT` resolves `../../stdlib` at runtime).
lsp/ + editors/  — LSP server (7 capabilities) + the VS Code extension (7 files) and Neovim set (5 files).
conformance/  — ⛑ **S396: 893 cases** (+2 this window, both #818 if-chain server-boundary cases: `control-flow/if-chain-branch-declared-function-pos` and `server-fn/branch-declared-server-fn-routes-to-server`). ⛑ **THIS CORPUS IS GATED, THOUGH NO WORKFLOW NAMES IT** — via `compiler/tests/conformance/corpus-bridge.test.js`, which lives under `bunfig.toml`'s `[test] root = "compiler/tests/"` and imports `run.ts`; see invariant 88 in primary.map.md. **PRIOR TEXT (S395: 891 cases)** (`find conformance/cases -name expected.json | wc -l`, +4 this window — `ctrl-021`..`ctrl-024`, all §17.6 value-form: sugar lift-less branch position, no-else-renders-nothing, and the two BOUND-position cases that FAIL on base and PASS on head). The top-level D3 conformance corpus (adapters/, cases/, driver.ts) — a SEPARATE surface from compiler/tests/conformance/, bridged via corpus-bridge.test.js. **883 cases across 54 category dirs** (+15 this pass; **`derived/` is NOT a new category** — it dates to `e86a76d0`, S231, and gained 3 cases). The fifteen: 5 `sql/prepare-*-e-sql-006-neg` (the #476 emit-path matrix, all NEGATIVE), 3 `derived/e-derived-server-only-reach-{pos,neg,fn-path}` (#486 — the `-fn-path` case asserts the diagnostic's OWN prescribed fix compiles clean), 5 `match-block/*` (#469/#470/#479), 1 `lifecycle/request-data-is-some-value-bool-class-attr-rt` (#484, an `-rt` case so it EXECUTES — the defect was a runtime TypeError a compile-only case could not catch), 1 `type-state-codes/e-state-undeclared-nested-each-in-match-arm-pos` (#477). `docs/FACTS.md` is the authority. A case whose id ends `-rt` EXECUTES; everything else is compile-only.
samples/ · examples/ · benchmarks/ · e2e/ · dashboard/  — dogfood apps + fixtures + the Playwright suite. `examples/29-engine-vs-flags.scrml` was migrated this window to a real error ENUM (§19.4.4.1) and now TEACHES why the enum is required; it previously taught `! string`.
docs/  — website + articles + **docs/FACTS.md (GENERATED, CI `--check`-gated — the authority for every published count)** + snippet corpora + docs/changes/ (per-dispatch archive, historical, excluded from content-mapping) + docs/audits/ + docs/changelog.md + docs/known-gaps.md + PA-SCRML-PRIMER.md.
handOffs/ · spa-lists/ · scratch/  — PA bookkeeping, historical, excluded from content-mapping.
compiler/src/codegen/collect.ts  — the shared AST collectors every emitter reads (`collectFunctions`, `collectTopLevelLogicStatements`, `getNodes`). **NEW THIS WINDOW (#510): `DEFERRED_LIFECYCLE_BODY_TAGS = new Set(["timer", "poll", "timeout"])`, and `collectTopLevelLogicStatements` no longer descends a node whose `tag` is in it.** Descending one collected the tick/timeout payload a SECOND time as a top-level statement, so the body **ran once at module init, before the timer ever fired** (`g-timer-poll-body-runs-once-at-module-init`, `g-timeout-body-runs-once-at-module-init`). **THE EXCLUSIONS ARE THE LOAD-BEARING PART.** `<request>` is deliberately NOT in the set — its descent IS the designed canonical-form fetch, emitted once. `<channel>` is deliberately NOT in the set — its top-level `${}` is single-run init logic the channel emitter does not re-emit, so the descent is its ONLY correct emission. **The predicate is "body is a deferred payload with its own Step-5 emitter", NOT "is a lifecycle tag"** — adding `<request>` or `<channel>` would DELETE a required emission.
compiler/src/ast-if-chain.js  — **⛑ NEW THIS WINDOW (#805, 53L) — THE ONE OWNER OF "WHERE DOES AN `if-chain` NODE KEEP ITS CHILDREN", AND IT IS AT `src/` ROOT, *NOT* `codegen/`.** ⚠ `compiler/src/codegen/ast-if-chain.js` **does not exist**; `codegen/` consumers import `"../ast-if-chain.js"`, `src/` consumers `"./ast-if-chain.js"`. One export: **`ifChainChildNodes(node)`** — returns every `branches[].element` in source order then `elseBranch`, and an EMPTY array for any node that is not an `if-chain`, so a caller may invoke it unconditionally. **WHY IT EXISTS:** `collapseIfChains` (`ast-builder.js:18871`, construction `:19024`) rewrites an `if=`/`else-if=`/`else` chain **that has an else arm** into `{kind:"if-chain", branches:[{condition, element}], elseBranch}` — under NONE of the container keys the compiler's hand-rolled walks recurse into, and `branches` holds `{condition, element}` RECORDS with no `.kind`, so even a generic walk that lists `branches` among its keys silently fails to reach `element`. **A lone `if=` with no else stays plain markup and never becomes an `if-chain`** — which is exactly why "add an `<div else>` sibling" is the discriminator that reproduces every member of this defect family.
  **CONSUMERS AT THIS WATERMARK — 13 modules, 32 call sites** (`grep -rl 'from "\.\{1,2\}/ast-if-chain.js"' compiler/src/`): `codegen/collect.ts` (`:296`) · `codegen/emit-each.ts` (`:421`, `:530`) · `codegen/emit-match.ts` (`:164`, `:227`, `:1103`) · `codegen/reactive-deps.ts` (**13 sites**: `:231` `:301` `:371` `:524` `:597` `:684` `:840` `:908` `:984` `:1113` `:1197` `:1464` `:1579`) · `commands/promote.js` (`:841`, `:1594`) · `dependency-graph.ts` (`:3260`) · `lint-i-fn-promotable.js` (`:191`, `:241`) · `lint-i-match-promotable.js` (`:243`, `:311`) · `lint-w-each-key.js` (`:70`) · `lint-w-each-promotable.js` (`:77`) · `lint-w-map-iteration-order.js` (`:61`, `:109`) · `symbol-table.ts` (`:1685`) · `type-system.ts` (`:13456`).
  ⚠ **TWO WALKS ARE DELIBERATE NON-CONSUMERS AND BOTH READ AS OVERSIGHTS — DO NOT "FINISH THE JOB" (invariant 82).** (a) **`codegen/collect.ts:173` `collectFunctions` is BACKED OUT ON PURPOSE.** It feeds the CLIENT function emitter while the server-boundary routing walk is separately blind, so adding the descent emits a `server fn` BODY into `client.js` with no `server.js` at all — a loud `ReferenceError` traded for a silent server-code-in-client leak. A **LEAK GUARD** test reds anyone who closes it alone: `compiler/tests/unit/g-if-chain-branch-cell-never-wired.test.js:124`, *"LEAK GUARD: a server fn in a branch never ships its body to the client"*. The pair is filed HIGH as `g-collect-functions-branch-decl-vs-server-boundary-routing`. (b) **`symbol-table.ts:10642` must stay a TOTAL `Object.keys` walk** — it already reaches `branches[].element` because it descends everything; the helper enumerates KNOWN fields, so routing it there NARROWS a correct site. #811's own brief named this as a gap and was wrong in the dangerous direction.
  ⚠ **OPEN, LOW: `g-ast-if-chain-one-place-claim-overstated`.** The module header (`:2`) calls itself *"the ONE place that knows where a §17.1.1 `if-chain` node keeps its child markup"* and instructs *"add it HERE and every consumer inherits it"*. Given (a) and (b), that claim is stronger than the tree honours — a new branch-carrying field would NOT reach `collectFunctions` or change the total walk. The `⚠` in the module is worth keeping; the word "ONE" is not load-bearing truth.
scripts/worktree-sweep.ts  — **⛑ NEW THIS WINDOW (#801) — wrap step 6b's stale-worktree disposition report, and it exists because the OBVIOUS probe is STRUCTURALLY WRONG under this repo's landing model.** `git branch --merged origin/main` (or `merge-base --is-ancestor`) is correct under a merge-based model; here work lands by REVIEWING A DELTA and copying file CONTENT (`git checkout <agent-branch> -- <files>` onto a PA branch, then squash-merging THAT), so an agent branch is **never** an ancestor of `main` no matter how completely its work landed. Measured at S391 across all 81 non-protected worktrees: **77 "UNLANDED", 0 "LANDED and clean"** — not a backlog, a broken test, and it read as *"correctly found nothing"* for ~120 sessions while the worktree count grew past 100. **THE DISCRIMINATOR IS CONTENT, NOT ANCESTRY:** for every file the branch touched since `merge-base(<base>,<ref>)`, compare the blob on the branch against the blob on `<base>` — all identical ⇒ landed. A SECOND discriminator splits the remainder, because 69 undifferentiated "holds work" rows convey nothing: if the baseline has not touched that path since the merge-base it still holds the merge-base blob and the branch's edit provably did NOT land (`unlanded`); if the baseline changed it too the row is `contested` (the common case for long-lived shared files like `SPEC.md`). ⚠ **DRY RUN BY CONSTRUCTION — no `worktree remove`, no `branch -D`, no `prune`, no write of any kind.** Removal is deliberately a separate step. ⚠ **No CI workflow invokes it** (`.github/` is zero-diff this window), which is invariant 81's shape exactly: a new gate-adjacent file that nothing imports and no map would notice. Unit test: `compiler/tests/unit/worktree-sweep-classify.test.js`.
compiler/src/codegen/emit-ssr-render.ts  — the §52.8 server-side per-item row renderer for a top-level `<each>` over an SSR-seeded server-authority cell. **CHANGED THIS WINDOW (S339-peter): `buildOneRenderer` returns `SsrEachRenderer | { fallback: string }` instead of `SsrEachRenderer | null`, and `buildSsrEachRenderers` gained `errors?`/`filePath?` params so it can emit `I-SSR-EACH-CLIENT-RENDERED`.** The bare `null` made every decline SILENT — an adopter lost SSR first paint for their list with no signal at all. Each refusal site now names its reason (`iterShape !== "in"`, an N-root template, a non-markup root, zero server-renderable parts, or an `SsrUnsupported` message from `nodeToParts`) and that string is interpolated into the lint. **Info-level and never fatal: this SURFACES pre-existing conservative behaviour and does not change what compiles.** Wired at `emit-server.ts:5360` (⛑ **S384: `:5162` was ALREADY WRONG pre-window; re-derived by grep**). Widening the renderable subset is the ruling-gated `g-ssr-each-row-template-subset-blocks-all-prerender`.
compiler/src/codegen/emit-lift.js  — the Tier-0 `${ for … lift … }` emitter. **CHANGED THIS WINDOW (#512, §6.7.7): `reparseLiftAttrRequestRef(exprNode, raw)`**, a thin wrapper over `reparseRequestRefEscapeHatch` (newly imported from `emit-expr.ts`) with `gateToRegisteredRequests = true`, is now applied at the THREE lift ATTRIBUTE-value emit sites in `emitCreateElementFromMarkup` (the generic attr, the `if=`/cond attr, and the event/`setAttribute` fallback). **Why the `<each>` fix's mechanism does not work here:** a lift attr value whose expression LEADS with `<#id>` reaches codegen as an ESCAPE-HATCH node, because `ast-builder.shouldSkipExprParse` skips any `<`-leading expr (its HTML-fragment guard) — so there is no structured node to thread `requestIds` into, and handing the escape hatch to `emitExprField` took the string fallback, which BOTH mis-routed the ref to the §36 input-state registry AND mangled an `is some` LHS into `.get("profile").(data !== null && …)` → `E-CODEGEN-INVALID-LOGIC`. **The reparse must happen first.** The lift `${…}`-interp and text paths never hit this — they lower `${…}` bodies whose nodes ARE parsed — so only the attr-value sites needed it.
compiler/src/codegen/emit-tool.ts  — the §64 headless `kind="tool"` emitter. Local `.scrml` imports are TREE-SHAKEN to the names the tool body references (S339) — **and the liveness predicate CHANGED at #515 (S340-peter, a #508-review HIGH): the local `identReferencedInSrc` (a `\b`-fenced regex) is DELETED, and the prune now calls `localServerImportNameUsed`, newly EXPORTED from `codegen/emit-server.ts` — one predicate, two prune sites.** The `\b` copy could not match a boundary before a leading `$` (both sides non-word), so a `$`-prefixed import local was judged dead, the whole import dropped, and the emitted tool threw `ReferenceError` at runtime (`g-tool-import-prune-drops-dollar-prefixed-local`). The shared predicate guards boundaries MANUALLY against the JS identifier charset — the same `\b`-vs-`$` trap domain.map.md's §18.5 section documents. Standing note: the emitter still depends on the SHAPE of `component-expander.ts`'s helper-bind specifier augmentation — a cross-stage coupling with no type binding the two ends.
compiler/src/name-resolver.ts  — the identifier/tag resolver, and the home of the `E-MARKUP-001` unknown-element gate. **CHANGED THIS WINDOW (#510, S340-peter): `"timeout"` added to `SCRML_NON_ELEMENT_TAGS_EXTRA` (`:138`; the entry itself is `:152`).** §6.7.8's `<timeout>` was omitted from the lifecycle-keyword list, so an all-lowercase tag that is not a known HTML element **false-fired `E-MARKUP-001` in every position.** ⚠ **The generalisable hazard is one line below the fix:** this list is HAND-MAINTAINED, and the very next block's comment states that the E-MARKUP-001 structural exclusion beside it is DERIVED, not hand-copied. **A new lifecycle tag must be added here consciously and nothing checks that the two agree** — two lists in one file, and only one of them self-maintains.
scripts/  — repo-level maintenance + gate scripts. **⛑ S391: TWO NEW FILES THIS WINDOW — `corpus-compile-floor.ts` + its `.baseline.json` (the compile-floor gate; see the row below). The prior window's new file was `types-gate.ts` (#665) — and it BREAKS the standing DETECTION-NOT-CONTROL shape only halfway: it IS wired into CI, but `continue-on-error` at BOTH the job and the STEP level.** The step-level flag is not redundant — a failed step HALTS the job even in a `continue-on-error` job (verified on run 30742472551, where the within-node parity step reported `skipped` and had never run at all), so without it a types regression would silently suppress every tracking signal below it. The standing shape otherwise holds: `scripts/` is inside the review floor's CODE-BEARING population (#481), and a red-over-backlog gate is the `pa-base` §8 cry-wolf shape these files refuse on purpose.
scripts/corpus-compile-floor.ts + scripts/corpus-compile-floor.baseline.json  — **⛑ NEW THIS WINDOW (S391), AND NO MAP IN THIS SET CARRIED EITHER FILE BEFORE THIS PASS — including the CI step that runs them.** The ABSOLUTE showcase-compile floor, wired as a BLOCKING `gate` step (`ci.yml:159`, `bun scripts/corpus-compile-floor.ts --check`). It enumerates every `.scrml` program under `PROGRAM_DIR_ROOTS = ["examples", "benchmarks"]` (`:76`), skipping `dist`/`node_modules`/`.git` (`:80`), and compiles each through `compileScrml` imported from `../compiler/src/api.js` — **resolved relative to the SCRIPT file, not the CWD, so the gate is CWD-independent.** ⚑ **WHY IT EXISTS, AND IT IS A CRITIQUE OF THE GATE NEXT TO IT: `corpus-emit-differential` is base-vs-head and by its HARD REQ 5 treats a compile FAILURE as DATA — so a program broken since BEFORE the baseline is structurally invisible to it. That is how `examples/09` sat uncompilable from S236 for months (`g-corpus-differential-gate-blind-to-standing-breakage`). A differential gate cannot see standing breakage; only an absolute floor can.** ⚑ **THE BASELINE IS NOT AN ALLOWLIST AND CANNOT ROT: the floor ALSO fails when a baselined program starts compiling again, or is no longer enumerated** — a stale entry is a gate FAILURE, so the baseline can only shrink toward truth. **Exit `2` (not `0`, not `1`) when enumeration collapses below `MIN_PROGRAMS = 25` (`:89`) — it REFUSES to report a green floor over a truncated population**, which is the wrong-referent guard most probes in this repo lack. EXECUTED at this watermark: **exit 0, one baselined entry** (`examples/09-error-handling.scrml`, `E-ERROR-009`, `g-fail-variant-shorthand-rejected-by-ts-context`, root `type-system.ts:10071` — re-verified: that line is the `if (failEnum === "" || failVariant === "")` guard directly above the emits at `:10074`/`:10082`/`:10089`).
scripts/types-gate.ts  — **NEW (#665, S365). The TypeScript diagnostic NAME->COUNT gate, and the fact it exists to fix is the headline: until it landed, NOTHING had ever type-checked this compiler.** No `tsconfig.json`, `typescript` not a dependency, no `tsc` invocation in `package.json` / `scripts/` / `.github/` / either git hook — and bun executes `.ts` TRANSPILE-ONLY, so every type annotation in `compiler/src` was in effect a comment. `ci.yml`'s own gate-layering header advertised a layer *"types (always-on local)"* that **did not exist**; the same landing corrected that line. **First run found NINE live exhaustive-switch `never` failures** (`MarkupValueExpr` ×8 + one `MapLitExpr`, all in `expression-parser.ts`) — `MarkupValueExpr` had joined the `ExprNode` union and nine exhaustive switches were never updated. Three modes mirroring `browser-baseline.ts`/`state.ts`/`facts.ts`: bare = PRINT, `--write` = record, `--check` = diff + exit 1 on ANY difference in EITHER direction. **Gates on a NAME->COUNT MAP, not an exit code and not a bare set** — `tsc --noEmit` still exits non-zero over this tree, so exit-code gating is the always-red cry-wolf shape (S301); and a bare set was a CORRECTION mid-build, because the key strips line/column and the nine `MarkupValueExpr` entries collapsed into ONE, so a TENTH would have joined an existing entry and stayed GREEN. Key: `<relative file> :: <TS code> :: <message head>`. Baseline: `compiler/tests/TYPES-BASELINE.json`. **Promotion into the BLOCKING `gate` job is an explicit OPERATOR call and was NOT taken** — it wants a decision on the nine live `never` failures first (fix, or record and drain).
scripts/issue-debt.ts  — **NEW (#536, S346).** Asserts the obligation the boot's raw `gh issue list` probe only READS: **every OPEN adopter issue has a HOME — a `docs/known-gaps.md` entry or a `handOffs/dpa-queue.md` item — or it is OWED** (pa-base §10: an obligation and its probe must resolve to the same artifact; #519/#509/#471 sat named-at-four-boots, homed by nobody). Classifier is PURE (strings + a fixed `now`; pinned by `unit/issue-debt.test.js` with no network); mention-match is ANCHORED (`#51` must not match `#519`; `issues/<n>` URL form counts); totals are self-reported never head-cut (auto-widening `--limit`, loud `SCAN MAY BE TRUNCATED`). Exit 0 always in default mode — delegated from `scripts/boot.ts`'s probe list; `--check` exists for the PA's hand, NEVER CI.
scripts/corpus-emit-differential.ts + scripts/corpus-check-goggles.js  — **NEW this pass (#428). THE STANDING PRE-LAND GATE FOR ANY CODEGEN CHANGE.** A wide-corpus emit-differential + dual-goggle syntax gate over **1878 `.scrml` sources / 7254 emitted artifacts**, recursive over five roots (`examples,samples,conformance,stdlib,benchmarks`) with the 453 deliberate exclusions PRINTED with per-directory counts. Two verbs: `capture` (one side; writes a manifest) and `diff` (compares two manifests). It replaces a script class that measured a FRACTION of its population three separate times (`artifact-diff.mjs` 8 of 115 · `u1-corpus-emit.sh` 329 of 1818 · that script's `node --check` half inheriting the same population) — `pa-base v2.13 §8`'s TRUNCATED PROBE. Every design decision carries a `HARD REQ n` marker at its site so a future editor can see what they would be removing; `--expect-total` is a hard enumeration assertion; a capture NEVER exits non-zero merely because sources failed to COMPILE (compile failure is DATA); `diff` exit **2** means NOT A VALID COMPARISON (different roots, same revision both sides, a vacuous run) as distinct from exit 1 = differences found.
  **THE LOAD-BEARING FACT, and it is why the checker is a separate file and a separate PROCESS: `node --check` on a bare `.js` ACCEPTS a top-level stranded `await`** — Node resolves it by module-syntax auto-detection and parses it as a module, where TLA is legal. **The compiler emits `<script src=…>` with NO `type="module"`**, i.e. a CLASSIC SCRIPT, where the same bytes are a hard SyntaxError and the whole bundle is dead on arrival. That is the auto-await work's own dominant failure mode, and every measurement in the arc had run under that blindness. **`node --check` is NOT used and must not be reintroduced.** Worse: **bun's `vm.Script` does not reject a top-level `await` either** (`bun -e 'new (require("node:vm").Script)("await f();")'` does not throw; the same line under `node` does), so the obvious in-process fix would have been a THIRD hollow gate — the parent is a Bun script and `corpus-check-goggles.js` is deliberately a separate **NODE** subprocess, batched (one process, many files). Each artifact is parsed under BOTH goggles (`script` and `module`) and the EFFECTIVE goggle is derived from the emitted HTML's actual `<script>` tag, so the verdict depends only on inputs the manifest records — `vm.Script`/`vm.SourceTextModule` take source text and nothing else, unlike `node --check`, whose verdict is a function of (content, extension, nearest `package.json` `"type"`). It earned its cost on its first real run: `g-stdlib-module-resolver-emits-import-meta-into-a-classic-script-bundle` was invisible to every prior gate on TWO counts at once (wrong goggle AND `stdlib/` outside the corpus roots).
scripts/browser-baseline.ts  — **NEW (S313, #361).** Three modes mirroring `facts.ts`/`state.ts` exactly: bare = PRINT the current browser-tier failure set, `--write` = record the baseline (idempotent), `--check` = diff and exit 1 on ANY difference. **It asserts the failure NAME SET, not the exit code and not the count** — the tier always exits 1 against a documented ~48-failure baseline, so it was excluded from every blocking gate and a genuinely new browser failure was invisible. The key is `<suite> > <test name>` and nothing else; timings, counts, file paths and ordering are deliberately stripped as non-deterministic or uninformative. **BIDIRECTIONAL**: a name JOINING is a regression, a name LEAVING means the baseline is stale (prune it in the fixing commit). The `(fail)` marker regex is deliberately NOT line-anchored — a failing test whose assertion dumps a happy-dom object emits the marker mid-line, and the anchored first cut silently under-counted by exactly one. Baseline artifact: `compiler/tests/browser/FAILURE-BASELINE.json`. **Now a step in BOTH `gate` (blocking) and `tracking`.** Scope is the browser tier only — lsp / commands / self-host have no name-set assertion (`g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion`, LOW). **#537 (S346): every NEW failure name is now printed WITH a reason excerpt (`failureReason()`) — bun's nearest preceding `error:` block, the marker's own timing, and any `^`-prefixed line after it — because a TIMED-OUT test and a failed assertion produce the SAME `(fail) <name>` marker**; the excerpt is diagnostic-only, never an input to the name-set comparison.
scripts/s34-census.ts  — **NEW (S310).** The oracle over the §34 catalog: `bun scripts/s34-census.ts [--full] [--json]` classifies every row into STRUCK / PINNED / IMPL-SITES / DECLARED-AHEAD / RUNTIME-SURFACED / FALSE-CLAIM, and `--check-new --base <ref>` is the **DIFF-SCOPED §34.0 gate** wired into CI `gate`. **No hardcoded line numbers — §34's range is derived from the headings every run.** It encodes six probe traps by construction: a struck row (`~~CODE~~`) is its own bucket, not conflated with uncatalogued; the emitter scan is quote-agnostic; it scans EVERY source tree (a narrower first cut over-reported dead by 17); Nominal status is attributed to a row's DECLARED refs not a stray mention; only `expect.codes` counts as a pin (`notCodes` and rationale prose do not); and RUNTIME-SURFACED codes (implemented as a runtime enum VALUE, never a diagnostic push) are separated from dead ones.
scripts/state.ts  — generates the `@generated` state rollup (CI `cloud-maps` Stage 1). **This window the `@gap` parser became an ATTRIBUTE BAG (`gapMarkersFrom`).** The prior regex required `status=` to be followed immediately by `-->`, so ANY marker carrying an extra attribute was **silently dropped from the count** — and `pa-base v2.9` had just made `locus=` REQUIRED on that marker, so every entry filed under the new rule became invisible, in the direction that under-reports open defects (measured at the fix: 3 dropped, 2 OPEN). It now parses attributes in any order, SKIPS the doc's own `id=<placeholder>` format example, and **THROWS naming the offenders** when the parsed count disagrees with the marker count. The status classifier still THROWS on a status none of `GAP_STATUS_{OPEN,CLOSED,NOMINAL}` names — `partial-impl` was added to OPEN at S313 after the guard correctly fired on a value the ledger's own legend already sanctioned. `parseGapMarkers` is EXPORTED and the CLI dispatch is gated on `import.meta.main` **so the guard is testable** — a gate that cannot be exercised is indistinguishable from one that cannot fail.
scripts/git-hooks/pre-push  — this window gained only a COMMENT block recording that the browser tier is now name-set-assertable. **That comment says the check "runs in CI `tracking` today" and that promoting it to `gate` "is bryan's to make" — bryan ruled promote in the SAME window and `ci.yml` now runs it in `gate`. The hook comment is stale as written.**
.github/workflows/  — **`ci.yml` CHANGED THIS WINDOW (#532): the `push` trigger is scoped `branches: [main]`** — the gate ran TWICE per PR under one required check name; every PR stays gated via `pull_request`, `workflow_dispatch` re-fires on demand, and a branch with no open PR now gets no CI until a PR exists (see build/infra maps). Otherwise structural shape unchanged (the S313 changes below carry forward: gate's `fetch-depth: 0`, the browser NAME-SET gate, the §34.0 provenance gate; `advisory-review.yml` DISABLED; `cloud-maps.yml` Stage 2 DELETED). Prior window's one-liner carries forward: `ci.yml`'s `windows` job's `bun install` step has `PUPPETEER_SKIP_DOWNLOAD: "true"` (that job runs unit+conformance only, never the browser tier). **THE ONE CHANGE THIS WINDOW (#454): `ci.yml` gained a `workflow_dispatch: {}` trigger** — a MANUAL RE-FIRE lever, added because a dropped webhook had no recovery path. GitHub does not re-deliver a webhook it dropped; during the 2026-08-06 Actions throttling FIVE PRs sat with ZERO checks and could not merge (`gate` is the sole required check), and force-push / close-reopen / a new commit / a brand-new PR all failed because each is just another webhook into the same throttled pipe. **`gh workflow run CI --ref <branch>`. TWO constraints, both MEASURED, both worth knowing before you reach for it:** (1) the dispatch reads the workflow definition FROM THE TARGET REF, so `--ref <branch>` returns `HTTP 422: Workflow does not have 'workflow_dispatch' trigger` on any branch cut BEFORE #454 — **the lever is PROSPECTIVE, not retroactive**; rebase onto main or dispatch `--ref main`. (2) A dispatched run's §34.0 row-provenance check is WEAKER: `s34-census --check-new --base` reads `github.event.pull_request.base.sha`, which does not exist on a manual run, so it falls back to `HEAD~1` (a pre-existing fallback, not new behaviour) and rows added in EARLIER commits of the same branch are not seen as NEW. **It WEAKENS NO GATE** — it adds a way to START a run, not to skip one; `gate` must still go green on the head SHA and `enforce_admins=true` is untouched. See build.map.md; both AI legs were a COST decision, not a broken secret.
.pa-base/  — the scrml PA boot manifest/profile.

compiler/src/library-shape.js  — ⛑ **NEW ROW S402, AND ITS ABSENCE WAS A MEASURED ROUTER HOLE.** (240L, 4 exports.) **THE SINGLE SOURCE FOR "WHAT KIND OF `.scrml` FILE IS THIS?"** — `#859` (`85ebbb5f`) deleted **four hand copies** of the shape predicate into it. `classifyFileShape(nodes, hasProgramRoot)` (`:138`) returns exactly one of a CLOSED five-member set: `"program"` · `"pure-module"` (§21.5) · `"pure-channel"` (§38.12.6) · `"non-entry-page"` (§40.8) · `"bare-markup"` (**the RESIDUAL — so the set is exhaustive by construction and an unanticipated shape falls into the `W-PROGRAM-001` branch rather than into silence**). Also `isForeignLangLibDecl` (`:61`, the §23.6 `<foreign lang>` library-decl admit), `isRecognizedNonEntryShape` (`:218`, exactly the `W-PROGRAM-001` suppression set), `isLibraryShape(shape, exports)` (`:237`).
  ⛔ **`FILE_SHAPES` IS RE-EXPORTED FROM `types/ast.ts:1575`, NOT DECLARED HERE (`:121`), AND THE DIRECTION IS FORCED.** `FileShape` is `(typeof FILE_SHAPES)[number]`; deriving it from this `.js` module would raise TS7016 and collapse the union to `any`, deleting the type silently rather than deriving it. **A second literal list is the exact drift #859 exists to remove — one was committed during that arc and caught in review.**
  ⚑ **BRANCH ORDER IS BEHAVIOURAL, NOT COSMETIC.** `non-entry-page` is tested BEFORE `pure-channel` so the real channel+page overlap (which the flagship has) resolves as it always did; and a NULLISH top-level node returns `bare-markup` on purpose — the legacy `isPureModuleFile` was `every`-shaped and a nullish entry made it FALSE. **Filtering nullish entries out silently INVERTS that and suppresses the warning.**
  ⚠ **THIS MODULE DOES NOT ANSWER "WHICH FILE IS THE APPLICATION ENTRY".** §40.8: the entry is *"the file resolved by the build root"* — a BUILD fact. No variant is called "entry" on purpose.

compiler/src/compute-pgo-flags.ts  — the pipeline-agnostic PRECG pass. **S402: it now computes TWO things, not one.** `computePGOFlags` (the 4 PGO `has*` flags) **and `computeFileShape(fileAST)` (NEW, #859)**, which stamps `fileAST.fileShape`. ⛑ **THE STAMP IS HERE AND NOT IN THE TAB, AND THE REASON IS MEASURED:** stamping in `ast-builder.js` added **1,012 new MISSING-FIELD divergences** to the within-node parity canary — exactly one per corpus file — because a TAB-only field is invisible to the native pipeline. Stamped at the **Stage 3.004 PRECG seam** (`api.js`), both pipelines carry it and no native mirror can drift. Same S115 / DD-#27 precedent as `authConfig` / `middlewareConfig`.

compiler/src/engine-statechild-parser.ts + match-statechild-parser.ts  — ⛑ **ROW REWRITTEN S405. THE PRIOR VERSION CARRIED A RESOLVED DEFECT AS OPEN, WITH A "DO NOT RE-ATTEMPT" WARNING ON IT.** (**2,848L** — was 2,597 — and 849L.) Both hand-roll a scanner that finds a markup body's closer. **THE INVARIANT IS THE S109 LOCUS RULING PLUS SPEC §4.18.3: A MARKUP-TEXT BODY HAS NO STRING CONCEPT.** *"The double-quote is the **only** display-text-literal delimiter"*; *"The apostrophe `'` is an **ordinary interior character** … The backtick is likewise … NOT a display-text delimiter"* (`SPEC.md:1219-1220`); §5.1 says the same for attribute strings. ⛔ **THE ASYMMETRY THIS ROW USED TO REPORT IS CLOSED. `engine-statechild-parser.ts:skipCommentOrString` (now `:1472`) HAS NO `"` / `'` / BACKTICK BRANCHES** — deleted at `e523478b` (#892), which is an ancestor of `origin/main`. It recognizes exactly THREE regions: `//` line comment · `/* */` block comment · `<!-- -->` HTML comment (§27.2). ⚑ **VERIFIED HERE BY EXECUTION, TWO-SIDED, ON A REAL CORPUS SAMPLE:** `samples/compilation-tests/engine-modern-002-effects.scrml` with `<Success rule=.Idle><p>Thanks. We'll email you.</p></>` compiles byte-for-byte identically to the unmodified sample. ⚠ **`origin/fix/s402-engine-apostrophe2` (`46bb46c9`) IS STILL NOT AN ANCESTOR OF `origin/main` AND IS NOT WHAT LANDED** — #892 is a different, later fix; do not go looking for that branch. ⛔ **THE NAVIGATION RULE THAT REPLACES THE OLD "12 CALL SITES ACROSS SIX SCANNERS" FRAMING: THE UNIT IS THE *LOOP*, NOT THE FUNCTION.** #892 gave FOUR opener-blind scan loops a `findOpenerEnd` jump, and **THREE of the four sit inside functions that ALSO contain a walker loop that was already safe** — so naming the enclosing function asserts something false about three of four. By LOOP: **(1)** `computeMaskedRegions` (`:1658` — ⚠ **RENAMED from `computeCommentRegions`; the old name greps to nothing**), its ONE flat scan loop, `skipTagShapedOpener` at `:1695`; function-level == loop-level only here. **(2)** `scanForNestedEngineEntries` (`:675`) — the **inner** `while (scanned < lt)` re-scan, `skipOpenerAware` `:696`; the OUTER loop (`:680`) stays on bare `skipCommentOrString` (`:684`) and is safe because it advances via `findOpenerEnd` (`:721`). **(3)** `scanForOnTransitionEntries` (`:887`) — inner re-scan `skipOpenerAware` `:918`; outer bare `:906`, safe via `findOpenerEnd` `:953`. **(4)** `parseEngineStateChildren` (`:2357`) — inner re-scan `skipOpenerAware` `:2407`; outer bare `:2374`, safe via `findOpenerEnd` `:2439`; **this is the LIVE symbol-table path** (`symbol-table.ts` calls it) and its blindness dropped state-children SILENTLY. Separately **four `i = lt + 1` advances became `skipTagShapedOpener` jumps** (`:716` · `:938` · `:946` · `:2433`) — those are in the OUTER loops and close the same blindness by a different route (a bare `lt + 1` left the position INSIDE the opener, so the next iteration read its attribute interior as body bytes). `:2433` is the hot one. ⛑ **THE IN-CLASS CRITERION IS DOCUMENTED IN SOURCE (`skipOpenerAware`, `:1617-1625`): a loop that scans ACROSS body text toward a structural target is IN class; a loop that halts at the first non-trivia byte is NOT.** The one out-of-class site is `parseMessageArms`' `skipTrivia` (`:2138`), correctly still on bare `skipCommentOrString` — **do not "fix" it for symmetry.** ⚑ **HELPER INVENTORY AT THIS WATERMARK:** `skipCommentOrString` `:1472` · `skipTagShapedOpener` `:1606` (NEW) · `skipOpenerAware` `:1626` (NEW) · `computeMaskedRegions` `:1658` · `findOpenerEnd` `:1716`. ⚑ **THE ARCHITECTURAL FINDING, STATED IN THE FILE ITSELF (`:1570-1582`): deleting the string branches did NOT create the opener-blindness — it UNMASKED it.** Those branches were doing DOUBLE DUTY: wrongly lexing strings in markup prose (the bug), and accidentally shielding every flat scan from a quoted attribute interior. ⚠ **NAMED RESIDUAL, WIDER NOW NOT NARROWER: `findOpenerEnd` (`:1716`) still treats `'` as an OPENING delimiter** (`if (c === '"' || c === "'")`, `:1728`), so the deleted defect survives one layer down. Pre-existing, deliberately unfixed — **but #892 widened its reach: `findOpenerEnd` is now reached from five additional scan paths covering every lowercase opener and closer in every scanned body, where before only PascalCase / `<engine>` / `<onTransition>` openers reached it.** ⛔ **`//`, `/*` AND `<!--` DELIBERATELY DIFFER ON UNTERMINATED RECOVERY AND UNIFYING THEM IS A DOCUMENTED FIX-ROUND REGRESSION:** `//` -> EOF · `<!--` -> EOF (matching `block-splitter.js:skipHtmlComment` `:358-368`, which unconditionally `return len`, called that way by `findStructuralBodyEnd` `:793`) · **`/*` -> returns `i`; an unterminated `/*` is PROSE** (matching BS's containment pre-scan `:2581-2596`). Round 1 extended the `/*` rule to `<!--` "by the same reasoning" and a commented-out state-child got WIRED UP ANYWAY. **The criterion is "match what the BLOCK SPLITTER does with the same bytes", not internal tidiness.** ⚑ **`computeMaskedRegions` RECORDS THE OPENER *INTERIOR* `[i+1, openerEnd)`, NOT THE WHOLE OPENER, AND THE DIFFERENCE IS LOAD-BEARING:** a real `<onTimeout after=1s to=.A/>` IS itself a tag-shaped opener, so masking its own span would mask its own regex match (which starts AT the `<`) and **silently delete every real timer**. `match-statechild-parser.ts` `findArmCloser` (`:454`) + `findNextArmOpener` (`:428`) carried the same carve-out since S196 (`g-match-arm-apostrophe-bs`), as does `block-splitter.js:findStructuralBodyEnd` (`:747`). ⚠ **`block-splitter.js:skipDollarBrace` (`:320`) is quote-aware and STILL NOT EXPORTED on `main`** — re-verified at this watermark. Tests: `compiler/tests/integration/engine-statechild-prose-punctuation.test.js` · `compiler/tests/unit/engine-statechild-comment-opacity.test.js`.

compiler/src/codegen/protect-egress.ts  — **⛑ +584 THIS WINDOW (#896, `b0c251f8`), now 821L. THE §14.8.9 SERVER->CLIENT CONFIDENTIALITY FLOOR.** ⛔ **IT IS THREE LIMBS OF DELIBERATELY DIFFERENT STRENGTH AND THE MODULE DOCSTRING (`:37-51`) SAYS SO: *"Read the strengths; they are not interchangeable."*** (1) **`E-PROTECT-004`** — a per-body SOURCE-TEXT co-occurrence LINT for `_{}` / `asIs`, `detectProtectedRawEgress` (`:449`); conservative and **defeated by function extraction**; NOT a guarantee. (2) **`E-PROTECT-005`** — a HARD compile error raised at EMISSION from `emit-server.ts:2061`, detector `findAuthoredResponseConstruction` (`:754`); STRUCTURAL, so extraction does not defeat it. (3) **the RUNTIME refusal** — `_scrml_protect_redact` / `_scrml_protect_opaque_refusal()` in `SERVER_PROTECT_HELPER` (`:221`); `instanceof Response` is exact. **THIS is the guarantee.** ⚑ **THE MEDIATION MARK IS THE SEAM: `Symbol.for("scrml.protect.mediated")` + `_scrml_protect_mediated(response)` (`:245`)** — it gives the RUNTIME limb access to PROVENANCE, which is what the COMPILE limb had all along, so both now decide on the same basis. The redactor checks **provenance first, shape second**. ⚑ **THE UNIT OF ALL THREE IS THE BODY, NOT THE `Response`** — a null-body `Response` carries no payload, so limbs 2 and 3 both permit it; `W-PROTECT-005` covers the seam where the compile limb can prove that and the runtime limb cannot. ⚠ **THE FOREIGN-OPENER REGEX HERE WAS LEVEL-0-ONLY UNTIL #896 AND IS NOW THE FULL §23.2 GRAMMAR** — `/(^|[^A-Za-z0-9_$])_=*\{/` at `:497`. Two other sites are still partial: see `primary.map.md`'s foreign-opener routing row.

compiler/src/codegen/tenant-egress.ts  — **⛑ +156 THIS WINDOW (#900, `e74f5423`), now 649L. THE §14.8.10 TENANT-ROW ISOLATION FLOOR.** `buildTenantContext` (`:127`) reads BOTH table registries: the §14.8.9 ProtectContext's `schemaByTable` (every `<db>`-bound table) AND the app's own `<schema>` declarations (`extractDesiredSchema`'s `tables`, threaded from `emit-server.ts:1769`). **A table is tenant-scoped iff its column list includes `tenant_id` — the column's PRESENCE is the declaration; there is no per-table opt-in attribute (§14.8.10).** ⛔ **UNTIL #900 THE `<schema>` LEG COULD NOT SEE A RAW-DDL BODY, SO A raw-DDL + no-`<db>` APP GOT A SILENTLY INERT FLOOR AT EXIT 0** — no `_scrml_tenant_tag`, no `_scrml_tenant_redact`, no diagnostic; reproduced end-to-end with another tenant's row on the wire. ⚑ **`class TenantTableSet extends Set<string>` (`:84`) CASE-FOLDS ON EXACTLY THREE METHODS — `add` / `has` / `delete`.** A read that bypasses them (`[...set]`, `forEach`, `entries`) sees the FOLDED form and does not fold the probe. ⚠ **ITS FOREIGN-OPENER REGEX WAS ALSO LEVEL-0-ONLY AND IS NOW FULL** (`:453`); the `known-gaps` entry still cites the pre-fix `:389`.

compiler/src/schema-differ.js  — **⛑ +396 THIS WINDOW (#900), now 2,802L. IT IS NOW THE HOME OF *THE ONE* `CREATE TABLE` RECOGNIZER, AND THE LOCATION IS AN INVARIANT WITH A STATED REASON, NOT A CONVENIENCE.** `parseSchemaBlock` (`:31`, the declarative `tableName { col: type }` DSL) · `harvestCreateTables` (`:246`) · `harvestRawCreateTableDecls` (`:264`) · `harvestRawCreateTables` (`:282`) · `parseRawCreateTableColumns` (`:348`) · `diffSchema` (`:1125`) · `readActualSchema` (`:973`) · `emitScrmlSchemaSource` (`:2647`). ⛔ **THE REASON IT LIVES HERE: this module imports only `sql-ident.ts`, so both security floors AND the GCP1 checks can read it freely** — importing the recognizer from `protect-analyzer.ts` instead would drag `bun:sqlite` + `node:fs` into an early PA stage, the mirror of `protect-analyzer.ts:631`'s own note. ⚑ **HARVESTING (finding the statements) STAYS IN EXACTLY ONE PLACE; READING COLUMNS OUT OF A FOUND STATEMENT IS A DIFFERENT JOB** (`parseRawCreateTableColumns`, which deliberately inherits the recognizer's boundary rather than improving on it). ⚠ **THE RAW-DDL COLUMN READ IS *NAMES ONLY*, ON PURPOSE** — §14.8.10 only asks whether a `tenant_id` column exists, and a partial constraint read would be strictly worse than none because `diffSchema` would then emit a LOSSY `CREATE TABLE` or `W-SCHEMA-002` DROP COLUMN against unrecovered columns. Table-level constraint clauses (`PRIMARY KEY (tenant_id, id)`, `FOREIGN KEY (tenant_id) …`) are SKIPPED and cannot hide a column, because they NAME without DECLARING. ⚑ **THE `sourceText` RECOVERY PARAMETER IS GONE AND ITS REMOVAL IS THE FIX** — it collided with the qualifier normalization added beside it (stored `assets` vs body `public.assets`, `indexOf` -> -1, recovery silently never fired). **One side of the seam deleted instead of both sides patched.** ⚠ **`parseRawCreateTableColumns` HAS NO PRODUCTION CALLER at this watermark** — every in-tree caller is a test; the file says so explicitly (`:335-345`) rather than leaving it implicit.

compiler/src/codegen/db-authoritative.ts  — **⛑ +55 THIS WINDOW (#900), now 540L.** Owns `extractDesiredSchema` (`:121`), `appDeclaresDbAuthoritative`, `wrapPrincipalTxn`. ⛔ **`extractDesiredSchema` HAS TWO CONSUMERS WITH GENUINELY DIFFERENT NEEDS AND THE SPLIT IS AT THE CONSUMER, NOT INSIDE `diffSchema`.** It now harvests the raw-DDL `<schema>` form and marks those tables **`rawDdl: true`** (names only). **TENANT** (`emit-server.ts:1769`) wants them; **MIGRATE** (`commands/db-migrate.js:219`) must not have them and declines in one line at `:244`. **`diffSchema` is byte-identical to pre-arc as a result.** Deferred arc: `docs/changes/migrate-consumer-raw-ddl-2026-09-08/SCOPE.md`.

compiler/src/protect-analyzer.ts  — **⛑ +56 THIS WINDOW (#900), now 1,182L — AND THIS IS THE FIRST NON-EMPTY WINDOW FOR `auth.map.md`'s KEYED SURFACE IN SEVERAL PASSES.** ⛔ **IT DELETED ITS OWN `CREATE_TABLE_RE`** and imports `harvestCreateTables` / `harvestRawCreateTables` from `schema-differ.js` (`:65-77`). ⚑ **THE SHARED RECOGNIZER ALSO NORMALIZES AWAY A SCHEMA QUALIFIER (`CREATE TABLE public.assets (…)`), which this file used to miss entirely — and normalizing matters HERE specifically because `resolveDb` REPLAYS these statements into an in-memory SQLite shadow DB, where an unstripped `public.assets` throws and takes the whole `<db>` block down with `E-PA-003`.** ⚠ `extractCreateTableStatements` passes `overwrite: true` to preserve its long-standing LAST-wins behaviour across nodes; the raw-DDL `<schema>` harvest is FIRST-wins. **The two policies are deliberate and are not the same.**

compiler/src/gauntlet-phase1-checks.js  — **⛑ +66 THIS WINDOW (#900), now 929L.** Home of the `<schema>` body checks (`E-SCHEMA-004` / `W-SCHEMA-001` / …) and, NEW, **`W-SCHEMA-NO-TABLES-DECLARED` (`:803`)** — the standing detector for the next floor-disagreement about what a `<schema>` declares. ⛔ **ITS RECOGNITION IS THE UNION OF BOTH FORMS AND REUSES THE SAME FUNCTIONS THE FLOORS USE** (`parseSchemaBlock` for the DSL, §14.8.9's `harvestRawCreateTables` for raw DDL, imported from `schema-differ.js` at `:69-80` **and deliberately NOT from `protect-analyzer.ts`**) — **a third recognizer inside the detector would reintroduce, in the detector itself, exactly the divergence it exists to catch.** The trigger is a four-way conjunction (non-blank after comment stripping · zero tables in EITHER form · zero §14.8.11.2 `fn`s · no non-text child) because **a cry-wolf gate gets bypassed and then deleted**.

compiler/src/commands/db-migrate.js  — **⛑ +24 THIS WINDOW (#900), now 665L.** ⛔ **THE WHOLE MIGRATE HALF OF THE §14.8.10 ARC IS ONE LINE: `if (t.rawDdl) continue;` at `:244`.** The migrate consumer declines raw-DDL `<schema>` tables **at its own boundary**, because it OWNS and REWRITES schema while a raw table's DDL is author-owned and only partially recovered. **Every defect the migrate side of the arc produced traced to raw tables becoming visible here** — a lossy `CREATE TABLE`, `DROP COLUMN` against unrecovered columns, a green "up to date" for a table that does not exist, and a `DROP TABLE` against a table the `<schema>` DOES declare. **Declining at the boundary makes all four impossible BY CONSTRUCTION rather than by guards inside `diffSchema`.** ⚠ **The consequence is deliberately the pre-arc one: a raw-DDL `<schema>` is INVISIBLE to `scrml db-migrate`.** Deferred arc: `docs/changes/migrate-consumer-raw-ddl-2026-09-08/SCOPE.md`.

compiler/src/codegen/emit-library.ts  — **⛑ +505/-70 THIS WINDOW ACROSS *THREE* COMMITS (#893 `80f8d9eb` · #897 `9f30472c` · #898 `914f06f5`), now 1,753L — THE LARGEST SINGLE-FILE DELTA IN THE WINDOW, AND IT WAS NOT NAMED IN THE 6c BRIEF.** Recorded because a walk driven by the briefing alone would have missed it — the per-FILE-not-per-SUBJECT attribution rule applied to a briefing rather than a commit subject. ⛔ **LIBRARY-FN ROUTING IS NOW STRUCTURAL BY DEFAULT WITH NAMED EXCLUSIONS (`rawFallbackReason`, `:974`), AND THE POLARITY INVERSION IS THE FIX** — the old opt-IN (`fnBodyContainsMatch`) had to be widened once per construct anybody tripped over, so every construct nobody had tripped over yet leaked verbatim into the importable `.js`. **TWO standing exclusions:** `ifExpr` decls (held raw because `emitIfExprDecl` is itself silent-wrong) and foreign (`_{}`) bodies. **Two post-emit gates:** `unloweredScrmlSyntax` (`:106`), `unmetRuntimeHelperRefs` (`:116`). ⛔ **`verifiedFnRemovalRange` (`:913`) NOW GUARDS ALL THREE SPAN SPLICERS AND THEY DO NOT FAIL THE SAME WAY:** `emitAsyncLibraryFns` (`:758`) and `emitControlFlowLibraryFns` (`:844`) fall back to RAW (inert, fails loudly); **`collectSqlFnRemovalRanges` (`:360`) FAILS CLOSED** with `E-CG-SQL-FN-UNVERIFIABLE-SPAN` (`:414`), because that pass is a CONFIDENTIALITY BOUNDARY — silently skipping the splice would leave a server-only `?{}` body in the importable client-facing `.js`. ⚠ **ITS OWN DOCSTRING IS STALE AT `:906-911`** — it still says the async and SQL splicers *"are NOT guarded here"*. ⛔ **TWO CODES THIS FILE EMITS HAVE ZERO MENTIONS IN `compiler/SPEC.md`: `E-CG-ENUM-BINDING-COLLISION` (`:1153`, via `finishLibraryModule` `:1142` / `enumBindingCollisions` `:1123` / `userTopLevelConstNames` `:1091`) and `E-CG-SQL-FN-UNVERIFIABLE-SPAN` (`:414`).** Filed as N-S405-1 in `non-compliance.report.md`.

compiler/src/codegen/bool-coerce.ts  — **⛑ NEW FILE THIS WINDOW (#842, `8a68d960`, 141L).** Boolean-declared SQL column coercion at the `?{}` decode boundary. Co-changed with `emit-logic.ts`, `emit-server.ts` and `rewrite.ts` in one commit.

compiler/src/codegen/binding-registry.ts  — **+56 this window (#837, `8f459481`)** — the static-`${expr}`-inside-an-`if=`-branch fix; co-changed with `emit-event-wiring.ts` and `emit-html.ts`.

scripts/native-parser-flip-harness.ts  — **⛑ NEW THIS WINDOW (#870, `94572819`, 617L). THE NATIVE-PARSER DEFAULT-FLIP METER.** ⚠ **IT PATCHES AND RESTORES `compiler/src/api.js` IN YOUR WORKING TREE** — refuses to run on a dirty `api.js`, keeps the original bytes in memory AND under `--out`, restores in `finally` + on SIGINT/SIGTERM/uncaught, and verifies the restore byte-identical by SHA-256. Anchors are SYMBOL matches asserted UNIQUE; it HARD-FAILS rather than silently measuring the unflipped compiler. **It exists because the meter was twice built as a throwaway and discarded, so the number had to be re-derived from scratch each time — the original 429 figure is NON-REPRODUCIBLE and retired.** Full operating semantics, the two flip modes, and why the CONTROL is mandatory: build.map.md.

## Ignored / Generated Paths
node_modules, dist, build, target, .git, .jj, .claude, vendor, __pycache__ — plus samples/compilation-tests/*/dist (gitignored, populated by `bun run pretest`). `docs/FACTS.md` is tracked but GENERATED — edit `scripts/facts.ts`, never the file. `compiler/SPEC-INDEX.md`'s totals block is likewise generated, as is `compiler/tests/browser/FAILURE-BASELINE.json` (`browser-baseline.ts --write`). **`.claude/` is gitignored but `.claude/maps/` + `.claude/agents/project-mapper.md` are FORCE-tracked** (`git add -f`) — a map refresh must be staged with `-f`.

## Monorepo Note
**scrml is NOT an npm workspace monorepo.** `171f5f23` deleted `compiler/package.json` and removed `"workspaces"`; `acorn` and `astring` are hoisted into the root `dependencies`. There is exactly ONE package manifest (root, v0.7.1). A `files` ALLOWLIST governs what publishes (`compiler/{bin,src,native-parser,runtime}/`, `stdlib/`, `README.md`, `LICENSE`) — anything new is excluded by DEFAULT. Any doc describing a `compiler/` workspace at v0.2.0 is stale.

## Tags
#scrml #map #structure #entry-points #directory-layout #w-dead-function-locus #not-usage-analyzer #route-inference #detect-runtime-chunks #markup-value-blind-spot #chunk-pruning #module-init #rehydrator-boundary #scrml-nav-rewire #scrml-boot #boot-iife #outlet-resident #region-cleanups #route-region #chunk-iife #wrap-chunk-body #no-route-splitter #emit-reactive-wiring #emit-event-wiring #emit-client #timer-start #detect-runtime-chunks #post-emit-chunk-gates #runtime-chunks #machine-retired #e-deprecated-001 #migrate-codemod #projection-rewrite #fail-closed-codemod #engine-audit #audit-registry #cell-scope-accessors #property-tests #project-state-child-rules #vacuous-test-skip #inject-server-call-awaits-via-ast #acorn-scope-model #scheduling-rewrite #mount-body-expr-node #consume-error-type-annotation #failable-generic-return #e-cg-006 #request-ref-sigil #scan-lhs-left #dispatch-called-targets #template-dispatch-scan #e-lifecycle-001 #e-lifecycle-002 #e-lifecycle-004 #cleanup-diagnostics #browser-baseline #failure-name-set #s34-census #§34.0 #gap-attribute-bag #locus-attr #state-ts #ast-builder #named-regex-openers #no-attrs-array #structural-if #§17.1.2 #native-parity-obligation #facts-md-authority #e-fn-equals-body #fn-decl-parse-sites #subparse-span-rebase #dist-relative-local-specifier #export-let-var #serve-tool-reachability #crossFileClientReads #match-arm-autoawait #crossmodule-async-markup #keep-alive #review-debt-script #puppeteer-skip-download #pr-405-landed #cps-choke-point-landed #inject-promise-await-retired #inject-fn-body-server-call-awaits #collect-structural-decl-names #§6.8 #w-if-in-each #each-nested-if-not-reactive #reset-init-thunk-reassignment #async-name-provider #async-name-facts #is-async-callee-name #is-server-boundary-callee #one-provider-three-consumers #decision-sites-3-to-1 #u1 #dpa-020 #dpa-023 #client-server-fn-await #is-client-server-fn-call #client-async-body #post-fn-name-mangle #owning-file-filter #cross-file-server-fn-collision #match-iife-header-from-emitted-body #await-absorb #session-proxy-bind #gh357 #sql-interpolation-session #csrf-token-disclosure #ast-reads-current-user-ambient #sse-currentuser-splice #channel-auth-only #dangling-ref-class #corpus-emit-differential #corpus-check-goggles #dual-goggle #node-check-blind-to-tla #bun-vm-script-blind #truncated-probe #1878-sources #standing-pre-land-gate #region-fence #two-region-classes #lexical-vs-structural #code-segments #classify-brace-group #find-object-shorthand-regions #object-shorthand-expansion #proto-shorthand-b31 #join-around-runtime-slot #runtime-slot-exclusion #embed-runtime #register-fn-name #identifier-shape-guard #zero-width-alternation #response-envelope #one-exit #instanceof-response-passthrough #redact-before-serialize #bun-welcome-page #session-cookie-wrap #object-hasown #prototype-chain-read #show-false-ssr #initial-bool-map #byte-inert #block-arm-value-position #split-block-statements #each-shorthand-markup-fn-mount #workflow-dispatch #manual-refire #prospective-not-retroactive #422-target-ref #§18.5-four-routes #plan-block-arm-lift-two-callsites #leaf-predicate-not-segmenter #closes-block-statement #statement-start-whitelist #per-arm-declarednames #re-dispatch-not-drop-opts #step-3b #§6.6.19 #e-derived-server-only-reach #two-module-sets-deliberately-different #escalation-vs-async #scan-for-server-only-binding-refs #per-function-literal #collectfilefunctions-yields-function-decl-only #line-numbers-re-derived #4653-not-4535 #4727-not-4466 #s34-census-windows-fix-landed #filurltopath #review-debt-code-bearing #state-ts-marker-truncation #auto-widen-scan #scripts-is-code-bearing #240107-lines #1334-tests #880-conformance #807-codes #24-commit-window #three-new-probe-scripts #deferred-lifecycle-body-tags #collect-ts-descent-gate #request-and-channel-excluded #structural-derived-walk #skip-derived-walk-key #depth-cap-512 #stale-orphaned-doc-comment-on-main #ssr-fallback-descriptor #i-ssr-each-client-rendered #e-each-body-decl-unsupported #each-request-ids-stash #reparse-lift-attr-request-ref #escape-hatch-node #tool-import-tree-shake #component-expander-augmentation #timeout-tag-added #hand-maintained-vs-derived-list #filesscanned-is-environment-dependent #tracked-1850-to-1858 #boot-read-set-gate #dpa-debt-probe #detection-not-control #242954-lines #1378-tests #883-conformance #810-codes #190-src-files #select-request-onion #e-mw-007 #one-onion-rule #handle-top-level-dispatch #emit-transition-css #transitions-chunk-retired #38-keyframes #app-wide-union #soft-nav-stylesheet-gap #csp-default-src-self #diagnostic-format #strip-redundant-code #delta-lint #corpus-zero-debt #pr-539-landed #types-gate-NOT-on-main #asis-split-NOT-on-main #toggle-lowering-decision-sites #resolve-synth-cell-prefix #each-block-from-markup-node #lift-vs-structural #parse-lift-tag #navigate-utilities #ast-path-lowering #rewrite-block-body #when-worker-handler #prop-substitution #usage-analyzer-dead-surface #lint-e-state-block-statement-form #stage-2-5c #pre-ast-lint #leaf-module #not-an-invariant-55-violation #onion-dispatch-is-in-build-js #api-js-seam-line-refs #194-tracked-files #§52.13 #protected-document #s380-incremental #per-item-match-redispatch #derived-cell-scrutinee #ast-scoped-snippet-substitution #uncommitted-dev-js-caveat #s437b #9941a504c #self-host-v2 #bootstrap-slice-m1 #self-host-frozen #s440 #cf62b415 #self-host-v2-stage-ownership #bootstrap-m3 #local-async-fns #refusal-gate #s447 #6a592ed5c #self-host-v1-removed #test-tmp-root #protect-egress-r8 #s450 #9bafb927 #native-parser-frozen #parser-flag-retired #session-ambient-server #auth-attr-invalid #s452-wrap #7ce905ac2 #tenant-sql-subset #e-tenant-sql-subset #arm-pipe #w-arm-pipe-legacy-impl1 #effect-summary #dpa-066 #s456 #ba2712973 #program-body-sql #refused-lowering-sink #attr-injection-sink #tenant-startup-check #walker-gaps
#log-loc-new-export #resolvespanlinecol #spanfromestree-hardcodes-1-1 #codegen-four-files #tilde-accumulator #anchor-drift-315-lines
#block-splitter-decides-first #splitblocks-meta-frame-only #int-number-census #new-script-not-gated #195-files-flat
#s405 #compiler-src-flat-195 #252403-lines #loop-not-function #skipopeneraware #skiptagshapedopener #computemaskedregions-renamed #computecommentregions-gone #findopenerend-quote-residual #unmasked-not-created #bs-recovery-parity #apostrophe-resolved #stale-open-row-corrected #46bb46c9-still-not-ancestor #protect-egress-three-limbs #mediation-mark #tenant-egress #tenanttableset #schema-differ-owns-the-recognizer #import-direction-invariant #no-bun-sqlite-in-the-pa-stage #extractdesiredschema-two-consumers #rawddl-marker #db-migrate-one-line-decline #w-schema-no-tables-declared #union-recognition-in-the-detector #emit-library-largest-delta #not-in-the-brief #rawfallbackreason #verifiedfnremovalrange #sql-splicer-fails-closed #stale-docstring-in-source #e-cg-codes-with-no-spec-home #generated-map-regenerated
#s437 #d02738767 #pipeline-seam #precg #host-import #import-host #forbidden-js-native #lint-defer #lower-defer #lint-redeclare #implied-lift-desugar #session-config-resolve #sqlite-defaults #sqlite-handle-defaults #diagnostic-secrets #db-target #hybrid-harness #scrml-toml #211-files

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
- [test.map.md](./test.map.md)
- [error.map.md](./error.map.md)
- [build.map.md](./build.map.md)
- [migrations.map.md](./migrations.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
