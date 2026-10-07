# auth.map.md
# project: scrml
# updated: 2026-10-07T10:49:16-06:00  commit: ba2712973
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
# ━━━━━━━ S437 AUTH DELTA ━━━━━━━
# NOT a zero-diff row. Keyed surface moved: `codegen/emit-server.ts` (session store + cookie resolution),
# NEW `codegen/session-config-resolve.ts`, `codegen/index.ts` (`E-MW-008`), `protect-analyzer.ts` (+ NEW
# `diagnostic-secrets.ts`, `db-target.ts`, `db-uri-redact.ts`), `type-system.ts` (`E-AUTH-005` application scope).
# `stdlib/auth*` / `stdlib/oauth*`: only `stdlib/oauth/google.scrml` (2-line edit). Detail in `## S437 — SESSION + SECRETS` below.
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
# ━━━━━━━ S422 AUTH DELTA — **ZERO-DIFF SURFACE, MEASURED. ONE CARRIED CITATION RE-DERIVED AND WRONG.** ━━━━━━━
#
# ⛑ `git diff --name-only e74f5423..787d4cb4 -- 'compiler/src/**auth**' 'compiler/src/**session**'
# 'compiler/src/**protect**' 'stdlib/auth*' 'stdlib/oauth*'` -> **EMPTY** across 112 commits.
# `git diff --name-only e74f5423..787d4cb4 -- stdlib/` -> **EMPTY** — the ENTIRE standard library,
# all 21 modules including `auth` and `oauth`, is byte-unchanged this window.
# `compiler/src/codegen/protect-egress.ts` is likewise untouched, so the §14.8.9 mediation marks
# (`Symbol.for("scrml.protect.mediated")` / `…origin`) are byte-identical.
#
# ⛔ **THE §20.5 CITATION THIS MAP SET CARRIES IS WRONG AGAIN — AND IT IS THE *CORRECTION* THAT
# ROTTED, NOT THE ORIGINAL.** Invariant 78 records that `auth.map.md` once cited
# `SPEC.md:14566-14571` for the §20.5 session API surface, and publishes the fix as `:15738-15743`.
# **RE-DERIVED BY SYMBOL AT THIS WATERMARK — `grep -n '^#\+ .*20\.5' compiler/SPEC.md`:**
#   - **§20.5 Session Context is at `compiler/SPEC.md:16006`.**
#   - **§20.5.1 (`session.set` / `session.destroy`, the write half) is at `:16079`.**
#   - **`:15738-15743` today is markup inside an `<errorBoundary>` example** — neither §20.5 nor §19.9.x.
# ⚑ **THAT IS THE THIRD DISTINCT THING THAT RANGE HAS POINTED AT ACROSS THREE WATERMARKS.** Together
# with the `postRe` case (whose published correction `:27224/:28162/:28287` is also stale — real now
# `:27384/:28322/:28447`), this pass found **TWO independent instances of a *fix* going stale.**
# **A correction is not durable merely because it was correct. Locate by SYMBOL, every time.**
#
# ⚠ **ONE NEW TEST FILE CARRIES `session` IN ITS NAME AND IS *NOT* ABOUT AUTH — DO NOT ROUTE IT HERE.**
# `compiler/tests/unit/state-session-close-suffix.test.js` (NEW) pins `scripts/state.ts`'s
# **PA-session** wrap-subject matchers (`isSessionClose` / `sessionNumOf`) for the `master-list.md`
# §0.6 forensic index. "Session" there means a *PA working session*, not an HTTP/auth session.
# ⚑ Its finding is worth knowing even though it is not an auth fact: both matchers demanded `)`
# immediately after the session digits, so every CONTRIBUTOR-SUFFIXED wrap subject was invisible —
# **measured over the last 600 commits at S410: 100 wrap subjects, 21 matched, 79 DROPPED**
# (51 peter-suffixed, 28 bryan-suffixed). Fixed and pinned, negatives included.
#
# ⚠ **A ZERO-DIFF SURFACE IS AN UNCHANGED MAP, NOT A RE-VERIFIED ONE.** Apart from the §20.5 range
# above, this pass established only that the auth surface did not MOVE; it did not re-read the
# strategy, guards or token-lifecycle claims below against their sources. **Any other error already
# present here survives this stamp.** Treat every `SPEC.md:NNNN` below as a hypothesis.
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
# ━━━━━━━ S405 wrap-6c — ⛔ **THIS MAP'S KEYED SURFACE IS *NON-EMPTY* FOR THE FIRST TIME IN SEVERAL WINDOWS. THIS IS NOT A ZERO-DIFF ADVANCE.** ━━━━━━━
#
# Command: `git diff --name-only 68cfac6d..e74f5423 -- compiler/src/auth-graph.ts
# compiler/src/protect-analyzer.ts stdlib/auth stdlib/oauth compiler/src/commands/dev.js
# compiler/src/codegen/egress-field-scan.ts` -> **`compiler/src/protect-analyzer.ts` (+56)**.
# ⚠ **The last two passes advanced this row on a re-measured ZERO, with the standing warning that a
# zero-diff surface is an UNCHANGED map and not a correct one. This window it moved.**
#
# **`protect-analyzer.ts` DELETED ITS OWN `CREATE_TABLE_RE`** and now imports `harvestCreateTables` /
# `harvestRawCreateTables` from `compiler/src/schema-differ.js` (`:65-77`). ⚑ **THE IMPORT DIRECTION
# IS AN INVARIANT WITH A STATED REASON, BOTH WAYS:** the recognizer lives in `schema-differ.js` (which
# imports only `sql-ident.ts`) **so that a consumer is not forced to pull THIS module, and with it
# `bun:sqlite` + `node:fs`, just to ask what counts as a table declaration** — the mirror of this
# file's own `:631` note that the early PA stage avoids pulling a codegen module. ⚑ **The shared
# recognizer also NORMALIZES AWAY a schema qualifier (`CREATE TABLE public.assets (…)`), which this
# file used to miss entirely — and that matters HERE specifically because `resolveDb` REPLAYS these
# statements into an in-memory SQLite shadow DB, where an unstripped `public.assets` throws and takes
# the whole `<db>` block down with `E-PA-003`.**
#
# ⛔ **THE §14.8.9 SECTION BELOW ("Protected-field egress backstop") WAS TWO SENTENCES AND IS NOW A
# THREE-LIMB STRUCTURE WITH THREE DIFFERENT STRENGTHS. THE OLD TEXT NAMED ONLY `protect-analyzer.ts`
# (PAError) AND `egress-field-scan.ts` (`E-CG-001`) AND DID NOT MENTION `E-PROTECT-004` AT ALL** —
# which, before this pass, had ZERO hits in every hand-authored map. See the rewritten section and
# `domain.map.md`'s §14.8.9 section for the full treatment. In one table:
#   | limb | code | mechanism | strength |
#   |---|---|---|---|
#   | 1 | `E-PROTECT-004` | per-body SOURCE-TEXT co-occurrence LINT (`_{}` / `asIs`) — `protect-egress.ts:449` | ⚠ **conservative, DEFEATED BY FUNCTION EXTRACTION, NOT a guarantee** |
#   | 2 | `E-PROTECT-005` | HARD compile ERROR at EMISSION on an author-serialized response BODY — `emit-server.ts:2061` | **STRUCTURAL; extraction does not defeat it** |
#   | 3 | runtime refusal | `_scrml_protect_redact` / `_scrml_protect_opaque_refusal()` — `protect-egress.ts:221+` | **`instanceof Response` is EXACT. THIS IS THE GUARANTEE.** |
# **THE ADOPTER CONTRACT IN ONE SENTENCE: a `protect=` app keeps full control of STATUS and HEADERS
# and gives up authoring the BODY.**
#
# ⛑ **NEW SEAM CONCEPT — THE MEDIATION MARK, AND IT IS AN AUTH-RELEVANT ONE BECAUSE IT IS WHAT STOPS
# THE FLOOR FROM REFUSING THE COMPILER'S OWN 400s AND 403s.** `Symbol.for("scrml.protect.mediated")`
# + `_scrml_protect_mediated(response)` (`protect-egress.ts:245`). The compile limb decided by
# PROVENANCE, the runtime limb by SHAPE (`.body === null`); **every place they disagreed was a
# defect** — `Response.redirect(...)` (author-owned, payload-free → `W-PROTECT-005`) and the §53.9.4
# `E-CONTRACT-001-RT` 400 (compiler-owned, body-carrying → the guard turned our own 400 into a 500).
# Marked at `emit-server.ts:1904`; read PROVENANCE-FIRST at `_opaqueResultGuard` (def `:1948`, the mediated read at `:1957`).
#
# ⛑ **`/__mountHydrate` IS NOW A REDACTING SINK (`emit-server.ts:5531` and `:5561`), AND IT NEVER
# WAS BEFORE.** Each `_scrml_mh_v<i>` is an AUTHOR `server @var` loader result; `JSON.stringify`
# ignores the Symbol-keyed descriptor, so `passwordHash` crossed the wire in cleartext on
# `POST /__mountHydrate` **while the SSR compose handler forty lines below redacted the same two
# values**. ⚠ `/__serverLoad` remains unguarded at the top level and that is **safe for a REASON**
# (its values are compiler-built from a lowered `?{}`) — **do NOT extend that reason to
# `/__mountHydrate`; a previous source comment did and it was false.**
#
# ⛔ **AND A SECOND SECURITY FLOOR JOINS THIS MAP'S SCOPE: §14.8.10 TENANT-ROW ISOLATION.** A
# **raw-DDL `<schema>` + no `<db>`** app had a **silently INERT tenant floor at exit 0** — no
# `_scrml_tenant_tag`, no `_scrml_tenant_redact`, no diagnostic — because §14.8.9 had been taught the
# raw-DDL form and §14.8.10 had not. **Reproduced end-to-end: with ambient tenant `A`, the wire
# carried `{"id":2,"name":"THEIRS","tenant_id":"B"}`.** Closed by the one shared recognizer plus
# `W-SCHEMA-NO-TABLES-DECLARED` (`gauntlet-phase1-checks.js:803`) as the standing detector for the
# next such divergence. Full treatment in `domain.map.md`.
#
# ⚑ **THE `_{}` FOREIGN-OPENER GRAMMAR IS A SECURITY CONCERN HERE, NOT A COSMETIC ONE: TWO OF THE
# FIVE HAND-SPELLED SITES ARE SECURITY FLOORS.** §23.2 is `_` + ZERO-OR-MORE `=` + `{`. At this
# watermark: `ast-builder.js:18392` FULL · `codegen/tenant-egress.ts:453` FULL (fixed #900) ·
# `codegen/protect-egress.ts:497` FULL (fixed #896) · **`type-system.ts:473` levels 0+1 ONLY** ·
# **`lint-w-interp-in-raw-content.js:51` level 0 only, for EVERY sigil**. ⚠ **`W-FOREIGN-001`
# actively steers authors AWAY from level 0**, so the two partial detectors recognize exactly the
# spelling the compiler discourages. Filed HIGH: `g-foreign-opener-grammar-hand-spelled-five-places`.
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
# ⛑ **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF — FOURTH CONSECUTIVE WINDOW.** Command:
# `git diff --name-only 499eecce..68cfac6d -- compiler/src/codegen/emit-server.ts
# compiler/src/commands/select-request-onion.js compiler/src/protect-analyzer.ts
# compiler/src/auth-graph.ts` -> **EMPTY**. Every `emit-server.ts` line anchor in this file therefore
# carries forward by MEASUREMENT (the file is byte-identical) rather than by assumption.
# ⚠ **A zero-diff surface is an UNCHANGED map, not a correct one** — the S391 lesson, and this map is
# the one it was learned on.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# ⚠ **THE WINDOW IS FOUR SESSIONS WIDE, NOT ONE** — `10a4b045..499eecce` is **36 commits, PRs
# #835-#872** (S399 · S400 · S400-peter · S401 · S402). The prior stamp is 4 sessions behind because
# S398-S401 did not fire a wrap-6c. Per-file attribution is in `primary.map.md`'s header.
#
# **THIS MAP:** **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF** over its keyed file list (`auth-graph.ts` · `protect-analyzer.ts` · `stdlib/auth*` · `commands/dev.js`): `--name-only` EMPTY. ⚠ **THIS IS THE ROW THAT WAS BURNED TWO PASSES AGO BY EXACTLY THIS REASONING** — its cited line range had been deleted by the commit that made its surface non-empty. Re-derive any anchor here by SYMBOL GREP before trusting it.
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
# ⛑ **THE §52.13 DEV MIRROR WAS REWRITTEN THIS WINDOW (#823) AND THE OLD ANCHOR IS DEAD.** Row 3 of
# the enforcement table previously pointed at "`devDispatch`'s static-file branch `:1046-1048`" — an
# inline gate. That inline block no longer exists. Dev now decides protection at **exactly one site**,
# `gateProtectedDoc` (`compiler/src/commands/dev.js:979`), called once from the candidate loop at
# `:1141` on the **RESOLVED** file. The bug this closed:
# `g-dev-root-path-fallback-serves-a-protected-document-unauthenticated` — a second, ungated root
# branch served an `auth="required"` document in full to an unauthenticated `GET /` whenever that
# document was not named `index.html`.
#

scrml has THREE distinct auth-adjacent surfaces: (1) the compiler's own `<program auth=...>` declarative config that the codegen wires into emitted apps, (2) the `scrml:auth` / `scrml:oauth` stdlib modules an author imports for flow logic, and (3) the §20.5 `session` server builtin (NEW this window — the write half of the session model, landed in two passes). This map covers all three, plus the §14.8.9 protect-floor that backstops them, plus the §64.9 headless-target auth carve-out.

## S456 — AUTH-RELEVANT DELTA (`9c556dc74..ba2712973`)
- §14.8.9 (#1330): the value an author `handle()` returns is a protect egress sink (sink kind `"handle"`, `codegen/protect-flow.ts:186`, `isHandleResultDeclarator` :127); `Response` is recognized by value (`globalThis.Response`, aliases), not spelling -> `E-PROTECT-006`.
- §14.8.10 (#1331): `W-TENANT-SUBSTRATE-SCOPED` (`tenant-substrate-read.ts:411`) — a login/identity read of a tenant-scoped table is flagged (the tenant cannot be pinned from tenant-filtered rows).
- §14.8.10 (#1334): program-body SQL is a closed statement + lexical allow-list; a relation with `tenant_id` outside the compilation tenant set is `E-TENANT-UNDECLARED` (compile: `tenant-undeclared.ts`; live SQLite read via `protect-analyzer.ts` `liveTenantTables`). Built server: `_scrml_tenant_startup_check` (`codegen/tenant-startup-check.ts`) — `_server.js` answers 503 to every request while an undeclared tenant relation exists or a DB cannot be checked (fail-closed; `commands/build.js` `generateServerEntry` :564-).
- §8.1.2 (#1335): one SQL statement per program-body `?{}` closes the `set_config` tenant bypass; one JS-accurate `${}` slot reader (`codegen/sql-lex.ts` `jsInterpolationEnd` :91) closes the SQLite slot-desync bypass; codegen re-reads the emitted driver call (`codegen/sql-one-statement-guard.ts` `judgeDriverCall` :58).
- §5.2 (#1337): `E-ATTR-INTERP-EXECUTABLE` — no `${}` into event-handler attrs, executable-scheme URL attrs, or `srcdoc` (`attr-injection-sink.ts` :201).

## S455 — AUTH-RELEVANT DELTA (`f38697900..9c556dc74`)

- §14.8.10 tenant floor: ONE tenant set per compilation (`compilationTenantSet`, `codegen/tenant-egress.ts:369`, computed at `api.js:2994`) — a file reading a table tenant-scoped in another file is filtered (#1316). `ALTER TABLE … ADD COLUMN tenant_id` scopes a table (`schema-differ.js` `alterTableTenantDecls` :910).
- §14.8.10 schema boundary: `E-TENANT-SCHEMA-HAZARD` (`tenant-schema-hazards.ts`) refuses DB-side code paths around the floor (triggers, rules, FK actions, views, functions, permissive policies, isolation removal, non-admitted statement kinds, bodies outside the subset) (#1313/#1317/#1319).
- §14.8.11: the build report states the Postgres `REVOKE CREATE ON SCHEMA public` deploy requirement (overload-hijack defence; `commands/build.js:1055`).
- §14.8.9 + §8.10: a loop read over a table with protected columns is never hoisted (`batch-planner.ts` `protectBlocksHoist` :500).
- §23.2.4a: a `_{}` foreign slice runs in a sealed scope — sees only its `in:{}` crossings (`_scrml_foreign_seal`, `codegen/foreign-seal.ts`).

## S454 — AUTH-RELEVANT DELTA (`7ce905ac2..f38697900`)

- **§14.8.9 protect floor fails CLOSED (#1299).** `codegen/protect-egress.ts` `resolveProtectedOutputColumns` :641
  returns `null` (no tag) ONLY from a positive proof: a single DDL / transaction statement, a single
  `RETURNING`-free write, or a resolved SELECT / RETURNING whose every output column has a non-protected origin.
  Anything else — non-SELECT leader, >1 statement, a leading `;`, `E''`, dollar quotes, nested comments, MySQL `#`
  / `--x` / `/*!`, a lone CR inside `--`, a `${}` whose JS reads differently from the SQL splitter, a subquery
  over an unknown view — is `{ all: true }` (strip wholesale). Classifier: `lexProtectSql` :287 ->
  `analyzeProtectStatement` :428 / exported `classifyProtectStatement` :417. Full inventory: structure.map.md
  `## S454`. Executed coverage: `conformance/conf-PROTECT-EGRESS-FLOOR.test.js`.
- **§47.1.1 reserved `_scrml_` prefix (#1301) closes the raw-driver reach.** Author code naming `_scrml_sql` (the
  `?{}` driver handle) or any `_scrml_*` runtime name is `E-NAME-COLLIDES-RESERVED-PREFIX`, so every `?{}`-lowering
  floor (tenant §14.8.10, protect §14.8.9, transactions) can no longer be bypassed by calling the handle directly.
  Executed this pass: `conformance/cases/server-db/reserved-prefix-raw-driver-pos/case.scrml` (`return
  _scrml_sql.unsafe("SELECT body FROM notes")`) FAILS with that code at `f38697900`. ⚠ The ledger entry
  `g-tenant-floor-raw-driver-handle-callable-s452` (`docs/known-gaps.md:22973`) is still `status=open`.
  Computed member access (`globalThis["_scrml_" + "sql"]`) was NOT probed this pass.
- **§14.8.10 tenant floor:** no code change except a 5-line type fix in `tenant-egress.ts` (#1302). SPEC text
  for the S452 subset landed (#1298: §14.8.10 prose + the `E-TENANT-SQL-SUBSET` §34 row `SPEC.md:24831`).
- **§19.9.10 (SPEC #1298, bootstrap #1303):** a client call of a server function fails as
  `Transport(t: ServerCallError)` — `Unreachable` / `Refused(status)` / `ServerFault(status)` / `Malformed(reason)`,
  built on the CLIENT, never carrying server-written text. impl#1's `fail` envelope `data` and its unconditional status 200 diverge from §57.8 (gap
  `g-impl1-fail-envelope-diverges-from-57-8-s454`, MED, open).

## S452-WRAP — AUTH-RELEVANT DELTA (`fd2f757d0..7ce905ac2`)

**§14.8.10 tenant floor, r3 + r4 (#1293) — the floor is now a WHITELIST, not a classifier.** File inventory: structure.map.md S452-WRAP section.
- **Read path:** a tenant query (no `.acrossTenants()`) must lex inside `lexTenantSubset`'s closed token set and parse as ONE SELECT/INSERT/UPDATE/DELETE in `analyzeTenantSql`'s grammar; anything outside that names a tenant table -> `E-TENANT-SQL-SUBSET`. Postgres: any query naming a tenant table may call only allow-listed functions (`TENANT_ROW_FUNCTIONS`; plus `TENANT_GROUP_AGGREGATES` under GROUP BY tenant_id).
- **Write path:** INSERT gets `tenant_id` injected (`injectInsertTenant`); UPDATE/DELETE get `(<WHERE>) AND tenant_id = _scrml_tenant_write_key()` (`injectWriteTenantFilter`); on SQLite every injected write carries statement-level `OR ABORT` (driver from `TenantContext.driverFor`). Author-written `OR …` on a tenant write is refused.
- **Schema hazards:** `schemaWriteHazards` -> `E-TENANT-WRITE` for a tenant table with a trigger / rule / cascading FK referencing it; unattributable hazards charged to every tenant table. Opt-out: `.acrossTenants()`.
- **Still OPEN (known-gaps, S452):** `g-tenant-floor-schema-view-over-tenant-table-s452`, `g-tenant-floor-raw-driver-handle-callable-s452`, `g-tenant-floor-predicate-oracles-before-filter-s452`, `g-tenant-floor-schema-write-hazards-beyond-the-on-table-s452-r4`. Status: **PARTIAL**.
- **SPEC (#1281):** `E-TENANT-RAW-EGRESS` narrowed to `.acrossTenants()` rows reaching a raw `Response` (impl#1 divergence noted in SPEC); §14.8.9 protect binding keyed on ORIGIN, fail-closed; `E-PROTECT-UNRESOLVED-COLUMNS` (MAY), `I-PROTECT-REVEAL`.

## S453 — AUTH-RELEVANT DELTA (`d3e660a08..fd2f757d0`)

### ⛑ #1287 — §14.8.10'S GUARANTEEING MECHANISM CHANGED. THE TENANT FLOOR NOW FILTERS AT THE SOURCE.

This is the security headline of the window, and it is a mechanism change, not a tightening. Anything in these maps
or in the SPEC that describes the tenant floor as "tag the rows, strip the foreign ones at the client-egress sink"
is **superseded**: that WAS the guarantee (S273) and is now only defense in depth.

**What was broken.** The old floor tagged rows and dropped foreign ones at the compiler-owned egress sink, where
`_scrml_tenant_redact` passes non-objects through unchanged. So any value EXTRACTED from the rows before the sink
carried every tenant's data past it: `rows.map(r => r.name)`, `rows.length`, a `SUM`, a joined or serialized
string, a hand-built `Response`. That is the C4 leak (dpa-067 §C4), and it was exit-0 silent.

**What is emitted now** (`codegen/tenant-egress.ts`, 920 lines):

| piece | where | contract |
|---|---|---|
| `_scrml_tenant_scope(rows, keyCols, addedCols)` | `tenant-egress.ts:792` | Runs IMMEDIATELY after the query, before any program code holds a row. Compacts the driver array in place (so a count is corrected), keeps a row iff **EVERY** key column equals the request's active tenant (**NULL never matches**), removes the key columns the floor added, and marks each survivor with the tenant it was admitted for |
| `_scrml_tenant_scope_none(rows)` | `:814` | The unresolvable read's answer: **ZERO rows**. Fail-closed, never a pass-through |
| `resolveTenantScoping(sqlContent, ctx)` | `:321` | ONE key column per tenant-scoped FROM/JOIN source, aliased under `TENANT_KEY_ALIAS_PREFIX = "__scrml_tenant_"` (`:253`); a self-join yields one key per occurrence. A subquery / CTE / derived-table read of a tenant table -> `E-TENANT-AGG` (reason `"subquery"`). Deterministic projection-column ADD, **not** a WHERE-parse — SQL-WHERE injection stays v1.next |
| `rewriteSelectAddTenantId` | `:382` | adds the projection columns (`findTopLevelFromInSource` :403) |
| `wrapWithTenantScope(rowsExpr, scoping)` | `:911` | wraps **EVERY** terminator — `.all`, `.get`, `.run`, and a bare `?{}`. The last two were never tagged at all before #1287. `.get()` takes `[0]` **AFTER** the filter |
| `_scrml_tenant_request_scope(handler)` | `:705`, installed by `tenantRequestScopeLines(routeNames)` :896 and `emit-server.ts:7201` | An **AsyncLocalStorage** scope opened around EVERY route handler, so a peer server function called from a handler is scoped too. Outside any request (or on an unpinned request) there is no active tenant -> zero rows |
| `_scrml_tenant_redact(value, tenantKey)` | `:851` | KEPT as defense in depth — re-checks each marked row's admitting tenant at the egress sink. Under a correct source filter it strips nothing. **It is no longer the guarantee** |
| `SERVER_TENANT_HELPER` | `:682`, injected by `emit-server.ts:6916` | the one emitted helper block |
| `TENANT_ROW_FUNCTIONS` | `:235` | the SQL functions a key column may be wrapped in (`lower`, `coalesce`, `cast`, …). An identifier followed by `(` that is in neither this set nor `NON_CALL_WORDS` is an unknown function and is **refused** |
| `TENANT_COLUMN` | `:56` | `"tenant_id"` — a `<schema>` table carrying this column IS tenant-scoped; the column's PRESENCE is the declaration (no per-table opt-in). Membership is **case-insensitive** (`Assets` vs `assets` was a silent escape) |

**Status: PARTIAL.** The landing itself says so: *"lexical bypasses open, r3 next."* Treat §14.8.10 as a floor
under active repair — `g-…` entries filed in the same commit, and a `tenant-egress.ts` change is a SECURITY change
(review floor applies).

⚠ **Two in-source comments still name the retired helper.** `codegen/db-authoritative.ts:105` and
`codegen/tenant-egress.ts:556` narrate historical emissions using `_scrml_tenant_tag`, which no longer exists in
any emitted output. A dev agent grepping that name finds only prose. Filed as `N-S453-6`.

### SPEC side (#1278, SPEC-only, landed BEFORE the impl)

§14.8.10 was amended 2026-10-04 (S452 ruling "a"): *"the floor filters at the SOURCE: a tenant-scoped read's rows
are filtered to the active tenant immediately after the query executes, before any program code sees them."*
Enforcement is declared **HYBRID** — the source filter guarantees, injection optimizes:

- the source filter is the **guaranteeing floor**; it is a property of the READ, needing no query rewriting and no
  value-flow analysis;
- the §14.8.9-style sink strip SHALL still drop any tagged row whose `tenant_id` ≠ the ambient tenant, composing
  with the protect strip at the same sink — *"it exists so that a defect in the source filter is not by itself a
  leak. It is no longer the guarantee."*;
- WHERE-injection is the **optimization** and remains the mandatory mechanism only for the classes a row filter
  cannot cover; it is **v1.next**, gated on a SQL-WHERE parser.

### Unchanged this window (restated so a currency check does not have to re-derive it)

Nothing in the window touches `codegen/server-session-guard.ts`, `codegen/session-store-emit.ts`,
`codegen/session-config-resolve.ts`, `route-inference.ts`'s auth placement, `host-import.js`, or
`diagnostic-secrets.ts`. The §14.8.9 protect-egress floor is unchanged except for ONE name in `protect-flow.ts`.
Session cookie / expiry / store resolution, `E-MW-008`, `E-SESSION-AMBIENT-SERVER`, `E-AUTH-ATTR-INVALID` and the
`protect=` surface are all exactly as the S450 / S451 sections below describe them.

## S451 — AUTH-RELEVANT DELTA (`47c863556..d3e660a08`)

- **Tenant floor on every handle (#1264, security).** `codegen/db-authoritative.ts wrapPrincipalTxn(src, handles?)` now
  recognises every handle via `sqlHandleAt` (`codegen/sql-handle-name.ts`); before, only `_scrml_sql` got the
  db-authoritative principal wrap, so `_scrml_sql_<n>` handles skipped it.
- **Route inference (#1258).** §12.4 trigger matching runs on code-only text (`route-inference.ts codeOnlyTextForTrigger`
  :926): a server-trigger name inside a string literal, template text or comment no longer places a function on the server.
- No change to session / CSRF / auth= sources in-window. SPEC §19.9.10 (client server-calls failable) is Nominal.

## S449-WRAP — AUTH-RELEVANT DELTA (`9bafb927..47c863556`)

No auth / session / CSRF source change in-window. #1239's `codegen/server-session-guard.ts` and #1236's
`codegen/session-store-emit.ts` are mapped in the S450 section below (unchanged since).

Adjacent changes a security reader should know:
- **Request scope now wraps every route handler and WS callback** (`requestScopeLines`, appended at the END of each
  server module, mutating the exported route objects in place) — any dispatcher calling `route.handler` gets the
  scoped handler. Middleware/CSRF ordering inside the handler is unchanged.
- **WS callbacks** (`_scrml_ws_handlers.open/message/close`) are now `async` and AWAIT their onserver handler
  (`emit-channel.ts`).
- **protect egress (§14.8.9):** `protect-flow.ts` models `_scrml_db_guard` / `_scrml_db_request_scope` as the identity on
  data and never walks `TX_GUARD_RUNTIME_NAMES` (`protect-flow.ts:867`, evalCall :3291, handle-init recognition :4068) —
  walking them took examples/23 from ~1.4 s to >400 s. A future runtime helper added to the guard must be added there.


## S450 — AUTH-RELEVANT DELTA (`6a592ed5c..9bafb927`)

- **`@session` is never read on the server (#1239, S449 ruling 1, §6.6.9 / §20.5).** Before: a server `@session.userId`
  lowered to `_scrml_body["session"]` — client-controlled identity. Now: front end `route-inference.ts`
  `detectServerAmbientSessionReads` (:2507) / `…InText` (:2571) -> `E-SESSION-AMBIENT-SERVER`; codegen floor
  `codegen/server-session-guard.ts` (used by `emit-expr.ts`, `rewrite.ts`, `expression-parser.ts`, `emit-server.ts`)
  emits `_scrml_server_session_refused` and drains `E-INTERNAL-SESSION-AMBIENT-SERVER`. Both are in
  `commands/refusal-gate.js` (no dist written). Server code reads `session.<field>`. A file declaring its own
  file-scope `<session>` cell owns the name (`fileScopeDeclaresSessionCell`, guard stands down).
- **`auth=` literal set is closed (#1239 ruling 4 + #1234).** `<program>`/`<page>` `auth=` must be exactly
  `"required"` / `"optional"` / `"none"`; anything else (case variants, spaces, `""`, `role:X`, `${…}`, a cell, bare)
  = `E-AUTH-ATTR-INVALID` (`validators/attribute-allowlist.ts:180`), build-refusing. `auth-graph.ts`: a program gate
  exists only for `required`/`optional` (was any non-`none` raw literal).
- **Session destroy is CSRF-gated (#1234, §40.2 / §39.2.3).** Under `csrf="auto"` the destroy handler runs the
  session-synchronizer check (403 + token planted in `scrml_csrf`) whenever a session record exists; emitted
  `session.destroy()` sends the meta/cookie token, retries once on 403, clears + redirects only on 2xx. `csrf="off"` ungated.
- **Session store (#1234):** SQLite variant opens with `busy_timeout` then WAL (`codegen/session-store-emit.ts`); the
  in-memory `Map` variant is unchanged. `protect-flow.ts` models the store by summary keyed on the exact emitted text.
- **§14.8.9 protect egress round 9 (#1236):** global logical-assignment (`??=`/`||=`/`&&=`) keeps alias cells;
  element-returning built-ins hand back receiver elements; platform writes refused; session store by summary under an
  allow-list precondition.


## S447 — AUTH-RELEVANT DELTA (`78e4ddad..6a592ed5c`)
**§14.8.9 protect egress round 8 (#1228, `compiler/src/codegen/protect-flow.ts`).** The protected-column flow analysis
(feeds `E-PROTECT-006`) now models: (1) a row held INSIDE a value — `RowPart.paths` records the key path (`ROW_SELF` =
the value is the row; `ANY_KEY`; `ROW_ANYWHERE` = not modelled exactly, fail-closed; depth capped by `MAX_ROW_PATH = 4`),
so `{ h: u }.h.passwordHash`, destructures, `JSON.stringify(t.h)`, `Object.values(t.h)` are caught; (2) aliased
globals — `Taint.gn`/`gnAny` carry the global names a value was read through, so a call via `const { C } = globalThis`
or `const P = process` reaches functions stored under that name (all global-stored functions when unnamed); (3) one
descriptor path — `get`/`set`/`value` and a getter's returned function count as stored under the key; (4)
`LANGUAGE_COERCIONS` (`String`/`Number`/`Boolean`/`BigInt`/`Symbol`) invoke only coercion hooks, removing the round-7
perf cliff. Raw-JS leak matrix 41 → 0 per the commit; migration sweep 0 new/removed `E-PROTECT-006`. Residuals tracked
in gap `g-protect-egress-round-9-residuals`. No auth strategy, session, or route-guard change this window.

## S446 — AUTH-RELEVANT DELTA (`464c9ab4d..78e4ddad`)
- **#1201 `program-role.ts` (NEW)** is now the one ancestor-based `<program>` role model, read by every auth-relevant
  consumer: `compute-program-config.ts`, `tool-program.ts` (`findTopLevelProgramNode`), `auth-graph.ts`,
  `reachability/entry-points.ts`, `route-inference.ts` (`collectFileAuthDecls`), `codegen/index.ts`
  (`forEachProgramWithRole`), `refusal-gate.js` (refuses the write on `E-PROGRAM-002` / `E-PROGRAM-NESTED-AUTH` —
  no fail-open `server.js`). New codes beside the existing `E-PROGRAM-002` / `E-PROGRAM-NESTED-AUTH`:
  `E-PROGRAM-NESTED-SESSION` (`sessionExpiry=`/`session-secure=` on a nested program), `E-PROGRAM-NESTED-ATTR` (any
  other app-level attribute on a nested program), `E-PROGRAM-CONFIG-UNREAD` (the file's top-level `<program>` after
  component expansion is not the one PRECG actually configured), `W-PROGRAM-TITLE-NESTED` (documentary attrs, warning
  only). Rule: a `<program>` is top-level iff it has no `<program>`/`<page>` ancestor, WHATEVER MARKUP WRAPS IT; every
  `<program>` in a route file of a build that has an application program is nested (implied ancestor) even with no
  direct ancestor relationship.
- **+9 conformance cases**, `conformance/cases/auth/`: `program-from-component-config-unread-pos`,
  `program-nested-app-attr-pos`, `program-nested-auth-through-div-pos`, `program-nested-lifecycle-attr-neg`,
  `program-nested-session-attr-pos`, `program-top-level-session-attr-neg`, `program-two-top-level-one-wrapped-pos`,
  `program-worker-under-div-in-wrapped-app-not-e-program-002-neg`, `program-wrapped-in-markup-is-application-gated`.
- **#1218 `protect-flow.ts` round 7** is a `protect=` egress hardening pass, not an auth-flow change, but touches the
  same security surface this map tracks: `this` is now the receiver for every alias-tracked write; a function reachable
  through an ECMAScript-protocol key, a thenable, a tagged template, or an `instanceof` hook is analysed as invoked;
  stdlib identity is the pre-write `scrml:NAME` specifier (closes a same-named local file spoofing the allowlist). See
  error.map.md / domain.map.md for the code-level detail; no `auth=`/session/CSRF surface changed.
- **#1215 db-ownership** touches `protect-analyzer.ts` (new `checkDbPathsResolvingElsewhere`, `W-DB-PATH-RESOLVES-ELSEWHERE`)
  but not the session/CSRF/auth-graph surface; cross-reference only.

## S445 — AUTH-RELEVANT DELTA (`5b1d0dab0..464c9ab4d`)
### Route-file classification is BUILD-ROOT-relative (#1194) — supersedes the S444b `findRoutePrefix` locus below
- `resolveBuildRoot(files, givenRoot?)` — `compiler/src/route-inference.ts:7028` → `BuildRootResolution` (`:6983`):
  `origin: "given" | "inferred" | "none"`, `root`, `candidates` (application `<program>` files), `entry?`,
  `entryBasis?: "outside-route-dirs" | "shallowest"`.
- `makeRouteClassifier(res)` (`:7076`) — classifies `pages/` / `routes/` on the path RELATIVE to the build root; used as
  `findRoutePrefix` inside `runRI` (`:4495`). `buildPageRouteTree(files, buildRootRes)` (`:7126`).
- Step 8: `rootCandidates = buildRootRes.candidates` (`:6409`); `appRoot` = the single candidate or null (`:6410`).
- `W-AUTH-REQUIRED-NOT-INHERITED` (`:6745`) — a route file's own `<program auth="required">` gates only that file.
- Input: `RIInput.buildRoot?` (`:4477`); `api.js:2233-2236` passes `options.buildRoot` (resolved) to RI. The CLI does not pass
  one (inferred root).
- Gaps `g-app-root-route-prefix-matched-on-absolute-path` (HIGH) and `g-required-program-with-no-identified-app-root-is-silent`
  are `status=resolved` in `docs/known-gaps.md`.
### Protected-column egress round 6 (#1198, §14.8.9)
- `codegen/protect-egress.ts`: RETURNING rows resolve as `SELECT <list> FROM <target>`; every `?{}` terminator is tagged
  (`.run()`, bare `?{}`); a spaced star in an unresolved entry fails closed; a table outside `declaredTables` strips wholesale.
- `protect-analyzer.ts`: `ProtectAnalysis.declaredTables?: Set<string>` (`:124`, built `:1152`).
- `codegen/protect-flow.ts`: opaque callbacks applied with every param bound to the join of receiver + args; `arguments`;
  one compile-wide global cell for free names; descriptor-Symbol-key reach ships every column; `DERIVER_CALLS` (`:398`),
  `STDLIB_DERIVERS` (`:415`: `auth` verifyPassword/hashPassword/verifyTotp, `crypto` verifyHash), `RUNTIME_SOURCE_CALLS`
  (`:426`, ruling S445 #4: an `hmac` key built only from `process.env`/`argv` declassifies). A bare digest stays protected
  (RULING S443 #7).
- Error egress: CPS `ServerError.message` fixed under `protect=` (`emit-server.ts:1824`); prod `Bun.serve` `error:` handler
  (`commands/build.js:696`).
### CSP (#1200)
- With `--emit-per-route`, the role-detection bootstrap + `window._SCRML_CHUNKS` manifest live in the same-origin
  `scrml-chunks.<hash>.js` (`buildChunksBootJs`, `emit-html.ts:4493`), not an inline `<script>` — `headers="strict"`
  (`default-src 'self'`) no longer refuses them.

## S444b — AUTH LOCI (grep at `5b1d0dab0`; `compiler/src` unchanged since `108ca89be`)

### `route-inference.ts` Step 8 — auth-middleware collection, inside `runRI` (`:4481`)
All steps write one `authMiddleware: Map<filePath, AuthMiddleware>`; emit-server consumes the one entry per file.
| step | line | what it does |
|---|---|---|
| 8a | `:6357` | `<program auth="required">` registers its own file |
| 8a-page | `:6375` | every `<page auth="required">` registers via `pageAuthRequiredEntry` (`:4439`) — same gate a required `<program>` gets (S443) |
| app root | `:6393-6398` | `rootCandidates` = files that are NOT `isToolProgram`, NOT a route file (`findRoutePrefix(filePath)` null), and have a top-level `<program>` (`findTopLevelProgramNode`); `appRoot` = the single candidate, else `null` |
| redirect | `:6408-6425` | `programLoginRedirect` = `appRoot`'s `loginRedirect=` else `"/login"`; no `appRoot` -> the one distinct value declared across non-tool files, else `"/login"` + `ambiguousRedirects` (feeds 8f) |
| 8b | `:6437` | protect= auto-escalation; explicit `auth=` honoured via `getExplicitAuthDeclaration` (`:4283`); 2+-`<program>` files (`countUnitProgramNodes`) keep the pre-S438 stamped defaults |
| 8c | `:6565` | member-page inheritance. `rootCfg` = `appRoot`'s `authConfig`; with several candidates, ANY candidate declaring `auth="required"` (fail closed). When required: every file with `fileShape` `non-entry-page` or `bare-markup`, not `_layout.scrml`, with no recognized (`required`/`optional`/`none`) decl from `collectFileAuthDecls` (`:4393`) gets `pageAuthRequiredEntry` |
| 8d | `:6632` | `W-AUTH-FILE-CONFLICT` — one file declares `required` and a laxer value; stricter wins |
| 8e | `:6663` | `W-AUTH-REDIRECT-LOOP` — entry's `loginRedirect` equals the route's own URL (route file: `pages.get(filePath).urlPattern`; else `/<basename>`, `index` also `/`); case-sensitive; strips trailing `/`, `.html`, query/fragment |
| 8f | `:6700` | `W-AUTH-LOGIN-REDIRECT-AMBIGUOUS` — only when `ambiguousRedirects` is non-empty AND some entry is a page scope |

`findRoutePrefix` (`:6856`) — `filePath.indexOf(prefix)` over `ROUTE_PREFIXES = ["/routes/", "/pages/"]` (`:6845`); first
hit wins. ⚠ **It matches anywhere in the path, and `runRI` receives ABSOLUTE paths** (`api.js:1160`
`resolvedInputFiles = inputFiles.map(f => resolve(f))`). A project checked out under any directory named `pages` or
`routes` makes every file a "route file": `rootCandidates` is empty, `appRoot` is `null`, 8c inherits nothing, and 8e
uses the route-pattern branch. PA-named gap `g-app-root-route-prefix-matched-on-absolute-path` — ⚠ **the ID is not in
`docs/known-gaps.md` at `5b1d0dab0`** (grep empty). Other callers of `findRoutePrefix` in this file: `:6395`, `:6679`,
`:6912` (`buildPageRouteTree`).

### `codegen/index.ts` — nested-program auth + two-program files, inside `runCG` (`:1147`)
- `detectNestedProgramAuth(parentChildren, nested)` `:1621`, called `:1645`. Recursive markup walk; `nested` becomes
  true under a `<program>` OR `<page>`. Any `auth=` on a nested `<program>` (any value) -> `E-PROGRAM-NESTED-AUTH`
  (`CGError`, severity error). Reason in source: auth config is read only from the file's FIRST top-level `<program>`
  (`compute-program-config.ts`).
- `E-PROGRAM-002` block `:1647-1672`: top-level `<program>` markup nodes of ONE file; each after the first is an error.
  Same-file only; the cross-file §40.8 case stays reserved (comment `:1655`).
- ⚠ The session-config diagnostic message at `:3158` still prints "E-PROGRAM-002 is reserved-not-implemented" (see
  non-compliance U-S444b-1). Comments `:1964`, `:2005`, `:2026`, `:2084`, `:3241` say the same.

### Example 23 + `scrml generate auth` template (#1180)
- `examples/23-trucking-dispatch/app.scrml:35` — `<program db="./dispatch.db" auth="required" loginRedirect="/auth/login">`.
  Login/register call `session.set("userId", …)`; pages read `session.userId`; logout `session.destroy()`.
- `examples/23-trucking-dispatch/pages/driver/load-detail.scrml:182` — `assignedDriverFor(user, loadId)`; guards the
  token read, BOL and POD server fns (`:203`, `:228`, `:263`).
- `stdlib/auth/templates/login.scrml` — `loginServer` calls `session.set("userId", row.id)` after the password check.

## S444 — AUTH-RELEVANT DELTA (`cf62b415..108ca89be`) — S441 security landings

| PR | change | where |
|---|---|---|
| #1161 | `csrf="auto"` is the DEFAULT under `auth=`; only `csrf="off"` opts out; invalid values fail closed to `auto` | `compute-program-config.ts` `effectiveCsrfUnderAuth` |
| #1161 | the compose route is gated like the page | `codegen/emit-server.ts`, `route-inference.ts` |
| #1161 | WebSocket upgrade refuses cross-origin requests (403) | `codegen/emit-channel.ts` (`_scrml_ws_origin_ok(req)`), `commands/dev.js` |
| #1162 | static serving is a client-asset allowlist — the DB, server source and session store are not downloadable | `static-serve-policy.js`, `static-serve-policy-emitted.js` (§47.13) |
| #1163 | an async-colored fn (incl. `verifyPassword`) can no longer escape as a value into a sync slot (the accept-all shape left open at S440); event control after an `await` is an error | `codegen/js-async-analysis.ts`, `emit-library-shared.ts` (4 `E-ASYNC-*` / `E-EVENT-*` codes) |
| #1171 | protected-column egress: a scalar extracted from a `protect=` row cannot reach a client sink; origin match case-insensitive; computed columns stripped | `codegen/protect-flow.ts`, `protect-egress.ts` (`E-PROTECT-006`) |
| #1173 | `<page auth="required">` gates its page (document, compose route, server fns); member pages inherit the application `<program>`'s gate | `route-inference.ts` Step 8a-page, `pageAuthRequiredEntry` |
| #1173 | `auth=` on a nested `<program>` is `E-PROGRAM-NESTED-AUTH` | `codegen/index.ts` `detectNestedProgramAuth` |
| #1177 | a second top-level `<program>` in one file is `E-PROGRAM-002` (its `auth=` could previously be dropped) | `codegen/index.ts` |
| #1173 | warnings `W-AUTH-FILE-CONFLICT`, `W-AUTH-REDIRECT-LOOP`, `W-AUTH-LOGIN-REDIRECT-AMBIGUOUS` | `route-inference.ts` |
| #1155 | example 23 one-time-token guards read `.changes` off a void `.run()` — fixed in the example pages | `examples/23-trucking-dispatch/pages/**` |


## S440 — AUTH-RELEVANT DELTA (`fb21983a..cf62b415`)

**#1139 (SECURITY) — accept-all via a nested async helper is closed.** Before: a `function` declared inside another
function whose body awaited `verifyPassword` / a server fn was emitted `async` but called as sync, so
`hashes.some(h => inner(h))`, `if (inner(pw))`, `.sort(inner)` and similar evaluated a Promise (always truthy) —
every password accepted, with no diagnostic. After: `codegen/local-async-fns.ts` marks nested async helpers per
top-level fn (block-scoped; only ASYNC resolutions are marked, so a mark can only add an await or a rejection); every
emitter (client, server route/peer + value exports, library, tool) consumes the marks. Pinned by
`compiler/tests/unit/s440-nested-helper-async-sync-callback.test.js` and conformance `auth/nested-helper-*-neg`,
`server-db/nested-helper-*`. Still OPEN (ruled, not built): an async helper escaping as a VALUE (`const g = m`,
object/array, user HOF, `Array.from(xs, m)`) and inline-handler / `on mount` server calls — both accept-all shapes.

No change to session, CSRF, `protect=`, or token handling this window.


## S438 — SESSION-CONFIG RESOLUTION DELTA (`9941a504c..fb21983a`)

**Not zero-diff for this map** (the prior S437b window was). Two landed fixes, both §20.5/§20.5.1:

### #1114 — route-inference Step 8b no longer outranks a unit's OWN `<program>` declaration
`AuthMiddleware.sessionExpiry` is now **optional** (was required, defaulted at the type level). The resolution
order in `codegen/session-config-resolve.ts` is UNCHANGED (still: 1. this unit's route-inference entry, 2. the
unit's own raw `<program>`/`<page>` read, 3. the program-wide stash, 4. the language default) — what changed is
WHO FILLS STEP 1:
- **Step 8a** (`<program auth="required">`) still fills BOTH `sessionExpiry`/`sessionSecure` — the program's own
  declaration, or the §20.5 secure defaults when it declares none; that answer legitimately IS the program's own.
- **Step 8b** (protect= auto-escalation, and the `<page auth="required">` limb) now sets a field **ONLY when the
  unit itself declares it**. Previously it ALSO stamped the `"1h"`/secure default here, which — for a protect=
  unit belonging to a `<program>` that declared a DIFFERENT `sessionExpiry`/`session-secure` — outranked the
  program's own value at step 1 before step 2/3 ever ran. Regression example: a `<program sessionExpiry="7d"
  session-secure="false">` with a protect= `<db>` used to emit `__Host-scrml_sid` / 3600s instead of the
  program's `scrml_sid` / 604800s (`g-route-inference-8b-session-defaults-outrank-program-declaration`).
- **Exception, deliberately kept byte-identical:** a file holding 2+ `<program>` nodes (top-level or nested) is
  a case `E-PROGRAM-002` (still reserved, not implemented) would need to rule on — for THOSE files, step 2 reads
  the LAST declaring `<program>` in document order
  (`g-two-programs-one-file-session-attr-last-wins`), so Step 8b keeps stamping the pre-S438 secure defaults
  rather than falling through to that ambiguous read. Counted by `session-config-resolve.ts`'s **NEW export**
  `countUnitProgramNodes`, which walks the SAME `<program>`/`<page>` nodes `readRawUnitSessionAttr` does (shared,
  not mirrored).
- `codegen/emit-server.ts`'s cookie Max-Age emission now reads `sessionExpiry` through the ONE resolver
  (`_resolveSessionAttr`) rather than `authMiddlewareEntry.sessionExpiry` directly, since an auto-escalated entry
  may legitimately carry no expiry of its own.

### #1112 — `E-MW-008`'s program-site count no longer counts a headless tool
`codegen/index.ts`'s `_collectProgramSites` (the pre-scan behind `E-MW-008`, "a session-emitting unit cannot be
attributed to one program") now asks the EMIT DISPATCH's own `isToolProgram(file)` PER FILE before counting a
`<program>` node as a site — not per-node `kind="tool"` check. A `tools/seed.scrml` beside one real web app
previously contributed a false site: the tool file's SECOND top-level `<program session-secure="false"
sessionExpiry="7d">` (emitted nowhere — the whole file routes to the tool path) became the build's "only"
attributable program and its declaration got stamped onto every web unit (`g-mw008-counts-headless-tool-programs`,
found in the S438 review of #1114). A web file with a MISPLACED `kind="tool"` node is still counted (that shape
is `E-TOOL-002` anyway).

Neither change alters the STANDING §20.5 resolution order documented below, or the cookie-name /
`__Host-`/secure-mode mechanics — read those sections as still current.


## S437b — ZERO-DIFF FOR THIS MAP (`d02738767..9941a504c`)

Verified at `9941a504c`: `git diff --stat d02738767 origin/main -- stdlib/auth compiler/src/codegen/session-config-resolve.ts
compiler/src/diagnostic-secrets.ts` is EMPTY; the window's `compiler/src` diff is the §5.2.3 handler fix only (no session,
auth, CSRF or redaction code touched). Open gaps named in-window that sit on this surface (filed #1102, still `open`):
`g-mw008-counts-headless-tool-programs`, `g-route-inference-8b-session-defaults-outrank-program-declaration`,
`g-session-config-refusal-still-writes-dist`. Content below stands as of `d02738767`.

## S437 — SESSION + SECRETS (`787d4cb4..d02738767`)

### §20.5 session — ONE store and ONE cookie per APPLICATION, not per emitted unit (#1062, #1094)
- **Store path** (`codegen/emit-server.ts`, `_sessionStoreDistAscent = distRootAscentOf(...)` at `:2837`, used in the `.scrml-sessions.db` emission at `:2930`): anchored at the DIST ROOT via a compile-time ascent, keyed with `path.resolve`. Before: string-concatenated off each unit's `import.meta.dir`, so two units of one program opened two stores and a nested unit answered `auth:false` for a cookie the root had minted (HTTP 200, zero diagnostics); on Windows the key was mixed-separator.
- **Cookie name + expiry** (`session-secure` → `__Host-scrml_sid` vs `scrml_sid`; `sessionExpiry`) resolve per unit through **`codegen/session-config-resolve.ts`** — ONE three-step order: auth-middleware entry → the unit's own `<program>`/`<page>` raw attr → the build-wide stash. `emit-server` calls `resolveUnitSessionAttr`; a stash fall-through is RECORDED (`recordUnattributableSessionUnit`) and `codegen/index.ts` drains it after emission.
- **`E-MW-008` (§20.5.1)** — a build with more than one `<program>` where a session-emitting unit can only resolve via the stash is REFUSED rather than guessed. The module header records why the driver must not re-derive the order ("mirroring a predicate is not mirroring a dispatch").

### §52.11 `E-AUTH-005` is APPLICATION-scoped (#995, closes #770)
`hasProgramDbAttr` ("does THIS FILE declare `<program db=>`?") is retired for an application-scope answer computed once in `runTS`; before, every page file of a canonical multi-file app false-fired, making §52.4.2 `<var server>` unreachable.

### DB connection secrets never reach compiler output (#1047, #1055)
`diagnostic-secrets.ts` `SecretRedactor` is installed at the `compileScrml` chokepoint (see error.map.md); `protect-analyzer.ts` displays a db target through `redactDbUri`/`displayConnectionValue` and classifies it through `db-target.ts` `classifyDbTarget` (the SAME classifier as `codegen/db-driver.ts`). `E-PA-004` names the file it opened; the PA no longer creates db side files. `lsp/handlers.js` redacts editor diagnostics and PA notes with the same redactor.

### Not changed
CSRF, `auth="required"` gating, `@currentUser`, protect egress (§14.8.9) and tenant isolation (§14.8.10) sections below are carried; a stat diff over `787d4cb4..d02738767` of `codegen/protect-egress.ts`, `codegen/tenant-egress.ts`, `auth-graph.ts`, `compiler/runtime/`, `stdlib/auth/` is EMPTY.

## Strategy
Type: session-cookie auth (declarative, `<program>`-attribute driven, now backed by a compiler-owned `session` server builtin) + stdlib JWT (HS256 self-signed) + JWKS RS256 (external-IdP verification) + OAuth2 (5 providers) + magic-link/email-verify/password-reset (token-store flows).
Library: no external auth package — hand-rolled on Bun Web Crypto (`crypto.subtle`) + Bun's `Bun.password` (argon2).
Config: `<program auth="required|optional" login-redirect=... csrf="auto|on|off" session-expiry="1h" session-secure="true|false">` attributes. **NOTE — three separate, non-unified config shapes** (a pre-existing architecture, not introduced this window): `compute-program-config.ts`'s own `AuthConfig` interface [:28] (ProgramConfig-level, `{auth, loginRedirect, csrf, sessionExpiry, sessionSecure}` — `sessionSecure` is the raw `"true"`/`"false"` string), `route-inference.ts`'s `AuthMiddleware` interface [:294] (route-inference OUTPUT, `sessionSecure?: boolean` coerced), and `types/ast.ts`'s own `AuthConfig` [:1503] (the FileAST-level copy consumed elsewhere, `{auth, loginRedirect, csrf, sessionExpiry}` — did NOT gain `sessionSecure` this window). Codegen (`emit-server.ts`) reads the `AuthMiddleware` entry OR, for a no-auth session app, the raw `session-secure` attribute directly off the `<program>`/`<page>` node.

## §20.5 `session` server builtin (NEW this window — S265/S266, i29e/#29-E, #99 + #104)

The write half of the session model: a server function can now `session.set(key, value)` / `session.destroy()` in addition to the pre-existing read-only `@currentUser`/`@session` projections. `session` is a RESERVED identifier bound into scope automatically inside a server-escalated function body (`type-system.ts`'s `annotateNodes`, `scopeChain.bind("session", ...)` when `boundary === "server"`) — referencing `session` also AUTO-ESCALATES the enclosing function to server (mirrors the SSE `route` auto-injection and the §38.6 channel-builtin injection).

**API surface** (§20.5, `compiler/SPEC.md:15738-15743` — the fenced `session` object shape under
`### 20.5 Session Context` at `:15719`; the write half `#### 20.5.1` is at `:15792`):

⛑ **S391 — THIS ANCHOR WAS WRONG *FROM BIRTH*, AND IT IS THE THIRD SUCH FINDING THIS PASS
(invariant 77).** It read `SPEC.md:14566-14571`. That range is **§19.9.x error handling** — at
`0dd659a1` line 14566 was *"4. The client code handles the error via match, `?`, `!{}`, or
`<errorBoundary>`"*, and the range now resolves to `#### 19.9.2 HTTP Status Code Mapping`. **It has
never pointed at §20.5.** A mechanical delta-refresh would have carried it forward forever: it
shifts by the correct +6 like every other citation in the file, and lands on the wrong section just
as accurately as before. Re-derived by `grep -n 'session\.isAuth' compiler/SPEC.md` and reading the
enclosing heading. **The TABLE BELOW WAS SPOT-CHECKED AGAINST THE REAL FENCE AND IS CORRECT** —
`session.userId` `string | not`, `session.isAuth` `boolean`, `session.role` `string | not`,
`session.get(key)`, `session.set(key, v)`, `session.destroy()` all match. **Only the pointer was
wrong, which is exactly why it survived: the content it introduced was right.**

| Member | Type | Purpose |
|---|---|---|
| session.userId | string \| not | authenticated user ID, `not` if not logged in |
| session.isAuth | boolean | true if the request carries a valid session |
| session.role | string \| not | authenticated user's role, `not` if unset |
| session.get(key) | any | retrieve a custom session value |
| session.set(key, v) | void | store a custom session value (reserved-key guarded, see below) |
| session.destroy() | void | end the session (delete record + clear cookie) |

`session` has NO per-member type refinement yet (`asIs` at the type level) — a developer must narrow before use.

**Cookie mechanism** (`compiler/src/codegen/emit-server.ts`): `_secureCookieMode` (`authMiddlewareEntry.sessionSecure !== false && !== "false"`, default true) decides `_sessionCookieName`: secure mode -> `__Host-scrml_sid` (browser-enforced: forbids Domain attribute + requires Secure + Path=/), always emitted `Secure`; opt-out (`session-secure="false"`) -> plain `scrml_sid`, no `Secure` (for a conscious TLS-less deployment, e.g. a bare-http LAN mesh). The reader (`_scrml_read_session_id`) is MODE-GATED to the mode-appropriate cookie name ONLY — no cross-name fallback (closing a cookie-tossing / session-fixation vector where a sibling subdomain sets the plain name to force-auth a visitor into an attacker session). `_scrml_session_begin(req)` loads the incoming session record; TTL is `session-expiry`-derived `_scrml_session_max_age` (seconds), threaded into both the cookie `Max-Age` and the durable-store TTL. `_scrml_warn_insecure_cookie` (secure mode only) logs a once-per-process warning when a Secure cookie is set over bare http on a non-local host.

**Reserved-key guard (B5).** `session.set("csrfToken", …)` writes the compiler-owned §40.2 CSRF synchronizer-token key — a literal write is a COMPILE ERROR (`E-SESSION-RESERVED-KEY`, fired in `codegen/emit-expr.ts:emitCall`); a dynamic-key write with a runtime `"csrfToken"` key is refused at RUNTIME as a no-op by `_scrml_session_begin`'s setter guard. `userId`/`role` and preference keys remain writable.

**Context gate.** `session.*` is valid ONLY inside a web-app server route-handler function body — an SSE `server function*`, an `<endpoint>` arm, a `<machine>` method, a serverLoad cell, an in-process server-fn helper, or a headless `kind="tool"` program have no cookie-session request/response context and fire `E-SESSION-CONTEXT`. A bare `session` VALUE-use (returned/assigned/passed as an argument rather than accessed via member/index/call) fires `E-SESSION-VALUE`. A `session` reference outside ANY server-escalated body (client-side, bare top-level `${ }`) fires `E-SCOPE-012` (reserved -> LIVE this window) — client-side session display uses the `@session` projection instead. See error.map.md for all four codes.

**Landed in two passes** (both PA-run adversarial S239 gates each caught HIGH auth holes a green suite shipped — see hand-off.md/changelog.md for the full narrative, not reproduced here): (1) the base primitive (`1e63bbb1`, #99) — an unanchored cookie-parse fix (5 sites, was session-fixation + logout-DoS), 5 context-gate false-negatives closed (`session["k"]`, `session?.x`, `session?.set()`, bare `session`, file-scope shadow), role decoupled from auth. (2) pass-2 hardening (`510cef8d`, #104) — the `__Host-`/`session-secure=` opt-out + the reserved-key guard (B4/B5) described above, PLUS a coordinator-found cross-name-fallback re-open fixed in the same pass (see "Cookie mechanism" above).

## §20.5 SESSION — the handler-prologue binding is a PROXY, and that is a confidentiality decision (NEW #435, GH #357)

**A `session` reference that survives into EMITTED TEXT needs an in-scope `session`, or it is a free
variable -> HTTP 500 `ReferenceError` on every authenticated call.** The shape that got there: a
`?{ … ${session.userId} … }` SQL interpolation carries its query as a **STRING** — params are captured
verbatim and rewritten only for `@name` sigils — so `session` in it is sigil-less AND invisible to the
emit-expr member/index lowering that handles every other `session.*` use. Adopter-reported as GH #357.

Three parts landed together in `emit-server.ts`:
1. **`_SESSION_BARE_TEXT_RE`** — the shared text-level detector, `/(^|[^\w$.])session\s*[.[]/`. **The
   left-guard `[^\w$.]` is load-bearing**: it stops `_scrml_session_store`, `sessionId`,
   `_scrml_read_session_id` and `_scrml_req._scrml_sess` from matching. No `g` flag (stateless for
   repeated `.test()` in emitter loops).
2. **`astSqlQueryUsesSession`**, ORed into `_anySessionBuiltin` so an interpolation-only use FORCES the
   session infra on (store, cookie wrap, prologue binding). Permissive by design — a false positive
   only emits unused infra.
3. **A conditional handler-scope SPLICE** of `const session = _scrml_session_bind(_scrml_req._scrml_sess)`,
   at the same insertion point as the `@currentUser` binding (so it is visible inside the nested
   `_scrml_result` IIFE the baseline-CSRF path emits), `_webAppShape`-gated.

**The binding SHALL be the Proxy, NEVER `const session = _scrml_req._scrml_sess`.** That object is an
accessor: getters `userId`/`role`/`isAuth`, methods `get`/`set`/`destroy`, **and RAW own-properties
`sid`/`_rec`/`_changes` — where `_rec` holds the full stored record INCLUDING the §40.2 `csrfToken`.**
A raw bind would turn the dynamic-key form into a raw property read at the wrong level:
`session["sid"]` discloses the live session id and `session["_rec"]` the whole record plus the CSRF
token, **at HTTP 200** — the exact defeat of the synchronizer-token defense this compiler owns. It
would also make `session[customKey]` read `undefined` instead of the record value.

The Proxy preserves BOTH accessor shapes so the bare binding **AGREES with the AST lowering, which is
KEPT** (three security gates match the literal `_scrml_req._scrml_sess.`; retiring it for a bare bind
blinds them):
| access | routes to |
|---|---|
| `session.userId` / `.role` / `.isAuth` | the getter (reads `_rec` via `this`) |
| `session.set` / `.get` / `.destroy` | the bound method |
| every OTHER key — `.customKey`, `[expr]` | `.get(key)` -> **`Object.hasOwn(_rec, key) ? (_rec[key] ?? null) : null`** — OWN-PROPERTY only since #452 (see below) |

Two implementation facts that are load-bearing, not stylistic: **`Reflect.get(t, k, t)` uses the TARGET
as receiver** (the getters read `this._rec`; a Proxy receiver re-enters the trap on `_rec` -> `t.get("_rec")`
-> null -> TypeError), and **`set()` returns false** so an assignment through the binding is a loud
strict-mode TypeError rather than a silent shadow write to the session object. Symbol keys pass through.

### Session read-side — TWO OPEN gaps, both ROUTED TO BRYAN. Read before touching the accessor.

- **`g-session-get-reserved-key-read-disclosure` (MED — re-scored from HIGH S325; still open, still
  ROUTED-TO-BRYAN). ⚠ THIS ENTRY MOVED TWICE THIS WINDOW AND THE LEDGER RECORDS ONLY ONE OF THE MOVES.**
  - **What is now CLOSED (silently, as a side-landing of #452):** the PROTOTYPE-CHAIN read. `get(key)`
    is `Object.hasOwn(this._rec, key) ? (this._rec[key] ?? null) : null` at `emit-server.ts:2692` — ⛑ **S384: `:2593` was ALREADY WRONG pre-window (it named a `lines.push("  };")`); RE-DERIVED BY GREP, not shifted.**
    Pre-fix and MEASURED on the emitted helper: `.get("__proto__")` returned `Object.prototype`, and
    `.get("constructor")` / `.get("toString")` / `.get("hasOwnProperty")` / `.get("valueOf")` /
    `.get("isPrototypeOf")` each returned a FUNCTION — `_rec` is `{ ...rec }`, a plain object, so the
    whole `Object.prototype` surface was reachable from a request-controlled key. A function value
    flowing into a `?{ … ${session.get(k)} … }` bind was an **HTTP 500 SQL TypeError reachable from a
    request parameter**; that is closed too. **`Object.hasOwn` and NOT `this._rec.hasOwnProperty(key)`
    is load-bearing:** `_rec` is built from `session.set` writes, so it can carry an own key literally
    named `hasOwnProperty`, which would shadow the method on the one record that attacks it. This is
    the entry's own remediation candidate **(iii)** — *"`hasOwnProperty` + prototype guard only, no key
    policy … arguably a plain bug fix needing no ruling"*, annotated *"(iii) is separable and should not
    wait on the ruling"*. It did not wait. **The ledger entry does not say so** — its `locus=` still
    reads `:2568(accessor .get — \`return this._rec[key] ?? null\`, no allowlist/denylist/hasOwnProperty)`
    and its prose still asserts *"`.get()` is one line — `return this._rec[key] ?? null` — with no
    allowlist, denylist, or `hasOwnProperty`"*. **Both are false at this HEAD.** See
    non-compliance.report.md S326-N2.
  - **What is still OPEN, and it is the part that needs a ruling:** the OWN-KEY read policy. Every own
    key of `_rec` is still readable by an attacker-chosen key — including the compiler-owned §40.2
    `csrfToken`, and including any adopter-written secret (`apiKey` came back verbatim as
    `sk-live-PROBE-SECRET-9f3c`). The §20.5 reserved-key guard is **WRITE-side only**
    (`session.set("csrfToken", …)` -> `E-SESSION-RESERVED-KEY`; a dynamic-key runtime write is a no-op).
    The question bryan owes is *should a request-controlled key reach a session read at all* — not
    "read-null vs error on csrfToken". The `csrfToken`-denylist framing is **security theater for the
    same-origin threat model and the map should not repeat it**: the compiler already publishes that
    token same-origin through three measured channels (`GET /_scrml/session`, un-auth'd and un-CSRF'd;
    the `<meta name="csrf-token">` SSR tag; a non-`HttpOnly` `scrml_csrf` cookie on the 403 retry). A
    synchronizer token MUST be same-origin readable — that IS the mechanism.
  - **REACHABILITY CHANGED this window and the direction is worse, not better.** Before #452 the
    `auth=` shape of this leak reached **no wire at all** — a bare handler return produced Bun's
    constant welcome page and the value went only to stderr. #452 fixes that by design and thereby takes
    this leak **from log-only to WIRE-LIVE**: MEASURED, `server function peek(k) { return { v:
    session.get(k) } }` under `auth="required"` returns `{"v":"<live csrf token>"}` at 200
    `application/json`, key taken from the request body. **Severity stayed MED deliberately** — a
    reachability change makes an entry more REAL, not more SEVERE, and the attacker model is unchanged
    (same-origin XSS or an adopter echoing a request-controlled key; POST-only; CSRF-gated;
    `Access-Control-Allow-Credentials` is never emitted anywhere in the compiler).
- **`g-session-context-scan-bare-form-sound` (MED, open).** `E-SESSION-CONTEXT`'s scan was widened to
  match the new bare form during #435, **regressed §20.5 conformance** (it string-matched the compiler's
  own emitted comments and generated guards), and was **TRIMMED before landing** — caught by the PA
  adversarial fix-vs-prefix pass after the agent had reported clean. The sound implementation needs a
  **lowering-site RECORD, not a text scan**, and it is a newly-REJECTING surface, so it is bryan's call.

## §52.15.1 `@currentUser` + `<channel auth=>` — the DANGLING-REFERENCE class (NEW #440)

Same class as #357: **a runtime reference emitted with its binding/definition gated NARROWER than the
reference.** Compiles clean, zero diagnostics, `ReferenceError` -> HTTP 500 at request time.

- **`@currentUser` in a plain or SSE handler.** §52.15.1 says the ambient is resolved server-side from
  the session middleware, so a read REQUIRES the resolver. `_needsSessionInfra`'s detector matched only
  the `?{ … @currentUser … }` SQL shape, so a DIRECT expression read (`return { id: @currentUser.id }`,
  lowered to `IdentExpr{name:"@currentUser"}`) in an app with no `auth=`, no serverLoad and no `?{}`
  left `_scrml_current_user` unemitted while the handler splice still bound it. **`astReadsCurrentUserAmbient`**
  is the superset that catches both lowerings. The §36 SSE `function*` path additionally never spliced
  the binding at all — now spliced at handler scope before the nested generator closure, byte-identical
  construction to the route-handler path.
- **`<channel auth=>` with no `<program auth>`.** The WS-upgrade guard references `_scrml_auth_check(req)`,
  which calls `_scrml_session_middleware(req)`; both definitions were gated on `authMiddlewareEntry`, so
  a channel-auth-only program dangled the reference and 500'd at upgrade. `_hasChannelAuth` now forces
  `_needsSessionInfra`, and an `else if` arm emits **ONLY** the auth-check function — never the CSRF
  helpers, session-destroy, or the `@session`-projection routes, which stay `<program auth>`-specific.
  A channel-auth-only program's route surface is byte-identical to before. `loginRedirect` uses the RI
  default `/login` since no auth middleware supplies one.

**The store invariant was PROBED, not assumed:** widening `_needsSessionInfra` does NOT over-emit. A
read-only `@currentUser` program emits the in-memory Map + middleware + resolver and **not** the durable
on-disk store (§20.5 i29e — only an app that actually `session.set`/`.destroy`s gets the durable store).
Conformance fix-vs-prefix **1443/0** from a fresh PA process, executed handlers 500 -> 200.

**Standing rule for this family: every detector is PERMISSIVE BY DESIGN — a false POSITIVE only emits
unused session infra; a false NEGATIVE re-opens a 500.**


## §40.3 THE REQUEST ONION — one per compiled server, wrapping TOP-LEVEL dispatch (NEW, #654)

**Where a request-pipeline task STARTS.** Not at per-route emit. The chain is:

| Step | File | What it decides |
|---|---|---|
| 1. WHICH onion | `compiler/src/commands/select-request-onion.js` | `selectRequestOnion(serverModules)` → `{ onion, error }`. Zero candidates → `null` (no onion, byte-identical pre-onion output). One → mount it. **More than one → `E-MW-007`.** |
| 2. WHAT the onion IS (codegen) | `compiler/src/codegen/emit-server.ts` — gate `_scrml_hasMW` **`:2946`**, wrapper `function _scrml_mw_wrap(downstream)` **`:3105`**, exports `_scrml_mw_pipeline` **`:3242`** and `_scrml_mw_declared_in` **`:3259`** (⚑ CORRECTED S380 — all four shifted +12: the §52.13 protected-document guard export was inserted at `:2780-2790`, above every one of these) | Emits the onion and its mount CONTRACT. Nothing more. |
| 2b. HOW dispatch is split and wrapped (host, **NOT codegen**) | `compiler/src/commands/build.js:567-581` — `async function _scrml_dispatch(req, server)` **`:570`**, `function _scrml_onion_dispatch(req, server)` **`:577`** (⚑ CORRECTED S380 — both shifted +56: the §52.13 protected-document-registry code (`discoverServerRoutes` + `generateServerEntry` additions, `build.js:226-245`/`:319-390`) landed above the dispatch split) (`return _scrml_mw_pipeline_0(downstream)(req)`) | ⚑ **CORRECTED S376 — THIS ROW USED TO SAY `emit-server.ts:~454-521` AND THAT IS A WRONG FILE, NOT A DRIFTED LINE.** `grep -rn '_scrml_onion_dispatch\|_scrml_dispatch' compiler/src/codegen/` returns **NOTHING**; both symbols are emitted by the HOST. `emit-server.ts:~454-521` is §20.5/§52 `@currentUser`-query-gate code, unrelated to the onion. Wrong since #654 (`b74f7363`) — every window since. structure.map.md carried the identical error and is corrected there too. |
| 3. WHO mounts it (prod) | `compiler/src/commands/build.js:22, 299-317, 365-369` (⚑ CORRECTED S380 — was `284-302, 343-347`; +15/+22 respectively, same §52.13 insertion) | Scans emitted modules for `_scrml_mw_pipeline`; imports the winner under the ALIAS `_scrml_mw_pipeline_0` (every hosting module exports the same NAME). Throws with `err.scrmlCode` / `err.scrmlSources` on conflict. |
| 4. WHO mounts it (dev) | `compiler/src/commands/dev.js:32` (import), `:207` (`registeredOnions` decl), `:321-447` (`loadServerRoutes`, mounts the onion every recompile) | Rebuilds `registeredOnions` on every recompile; **mounts the SAME onion the built server does**, deliberately — a dev/prod split here is the exact defect the work removed. ⚑ **RE-VERIFIED against current HEAD `c1f93dfb` (post-#738 rewrite) — see the resolved PROVENANCE CAVEAT above.** Conflict prints via `formatOnionConflict` at `:410`. **ARCHITECTURE: `loadServerRoutes` now runs inside a respawned CHILD process** (`runDevChildServer`, `:1294`), so a fresh process import is always current (no cache-bust needed); the onion dispatches via `runThroughOnions(req, (request) => devDispatch(...))` at `:1233`, inside `buildServeConfig`'s `fetch` — the CHILD's `Bun.serve()` config, not the parent proxy's. |

**WHAT COUNTS AS DECLARING AN ONION** (the gate is `_scrml_hasMW` in emit-server; a non-pipeline module exports no `_scrml_mw_pipeline` at all, so the selector never sees it):

- **DOES declare one:** a `handle()`, or a `<program>` attribute that emits a pipeline STAGE — `cors=`, `log=` other than `"off"`, `ratelimit=`, `headers="strict"`.
- **Does NOT:** `batch-in-list-cap=` (§8.10.6 SQL batching), `idempotency-store=` / `idempotency-ttl=` (§19.9.6), `cors-max-age=` (inert without `cors=`), `channel-reconnect=` (§38.3.1). **They share the same config bag as the stage attributes — reading "the `<program>` carries an attribute" as "it hosts an onion" is the mistake this list exists to prevent.**

**WHY NOT COMPOSE MULTIPLE ONIONS** — the reasoning is in the module docblock and it is empirical, not aesthetic: composing means (a) every module's `handle()` PRE runs on every other module's page (**measured: two modules, two requests, four log lines, alpha's `handle()` stamping beta's document**), and (b) composition order is module-discovery order, which is **FILENAME-SORTED** — so renaming `api.scrml` to `zapi.scrml` would silently change which `handle()` won a contested path. Precedence must be readable off the source, and `<program>` is that.

**In the canonical v0.3 shape the question never arises:** the entry file declares `<program>` (with the middleware attributes and/or `handle()`), and `pages/*.scrml` route files declare `<page>`, which emits no onion.

**Introspection surface (dev only, and it exists so the behaviour is assertable):** `getRegisteredOnions()`, `getRegisteredRoutes()`, `runThroughOnions()`, `devDispatch`, `loadServerRoutes` — all exported from `commands/dev.js`. Post-#738, the process-topology surface is also exported: `serveDevInfra(pathname, req)` (dev-infra dispatch shared between the parent proxy and the child), `runDevChildServer(serveDir, opts)` (the child app server), `launchingProcessGone(launchPpid)` (orphan detection), and `CHILD_READY_PREFIX` (the child-ready stdout handshake).

### §40.3.3 pipeline ORDER at this HEAD

`[CORS preflight] → [logging] → [rate limit] → handle() PRE → _scrml_dispatch → handle() POST`

- **Stage 1 is the CORS preflight and it SHORT-CIRCUITS** (`emit-server.ts:3179`, `if (_scrml_mw_req.method === 'OPTIONS')`; ⛑ CORRECTED S384 from `:3127`, **+52** — #749's map/set runtime import + Part-A opts block land above it. It was `:3115` before S380's §52.13 shift). It reaches neither logging nor rate-limit, and **it does not reach `handle()`** — deliberately: a preflight carries no credentials, so an auth-enforcing `handle()` would reject it and the browser's real request would never be sent.
- **`ratelimit=` is PER-ROUTE** (`:3061-3084`, §4.15/§40.2; ⛑ CORRECTED S384 from `:3009-3032`, same **+52** shift; `:2997-3020` before S380) — it counts only requests a route serves, not the HTML/CSS/runtime/bundle sub-requests of one page load.

## §52.13 — an `auth="required"` scope also gates its OWN served `.html` document (NEW, S380, #728)

**Before this, `auth="required"` only guarded server FUNCTIONS.** The page's own statically-rendered
document is served by the build's `_server.js` static-file dispatch (or `scrml dev`'s static path),
which has no auth context at all — an unauthenticated `GET /secure.html` returned 200 with the fully
rendered markup, leaking whatever the page's initial server-render put there
(`g-auth-required-does-not-protect-the-served-html-document`).

**The fix threads one guard through all three layers, codegen -> build host -> dev host:**

| Layer | File | What it does |
|---|---|---|
| 1. EXPORT the guard | `compiler/src/codegen/emit-server.ts:2832-2842` (⛑ S384 +52, was `:2780-2790`) | Any module whose scope is `auth="required"` now ALSO emits `export const _scrml_protected_document = { guard: (req) => _scrml_auth_check(req) };` (`:2841`; ⛑ S384 +52, was `:2789`) — reuses the SAME check the per-route gate calls, so document and function share one verdict. |
| 2. DISCOVER + REGISTER (build) | `compiler/src/commands/build.js` — `discoverServerRoutes` excludes the export from `routeNames` and derives `protectedDocument` (the module's served `.html` path) via regex at `:245`; `generateServerEntry` collects `protectedDocs` (`:319-324`), imports each guard under a unique alias `_scrml_pd_<n>` (the export name collides across modules, `:370-373`), and builds a LOWERCASED `rel -> guard` map `_SCRML_PROTECTED_DOCS` (`:383-390`) | Static dispatch consults the map BEFORE cache headers / ETag are computed (`:538-545`) — an unauthenticated request 302s to `loginRedirect` and never reaches the file read or a 304. |
| 3. MIRROR (dev) | `compiler/src/commands/dev.js` — ⛑ **REWRITTEN BY #823 (`2d8dd8cb`); the anchor this row carried until S395 (`devDispatch`'s inline static-file gate at `:1046-1048`) NO LONGER EXISTS — it was deleted, not moved.** Module-level `registeredProtectedDocs` Map declared `:215`, reset `:325`, set per module in `loadServerRoutes` `:379`. **Protection is now decided at EXACTLY ONE SITE:** `gateProtectedDoc(req, rel)` (`:979`), called once from the static candidate loop at `:1141` as `gateProtectedDoc(req, relative(serveDir, candidate))`. | Identical mechanism to prod, so `scrml dev` and the built server agree — the same principle §40.3's onion work established. ⛑ **THE FIX WAS TO DELETE A SERVING PATH, NOT TO ADD A SECOND GATE.** Root resolution used to live in its own branch AFTER the loop and returned HTML from two paths that never consulted the registry, so an `auth="required"` document **not named `index.html` was served in full to an unauthenticated `GET /`** (`g-dev-root-path-fallback-serves-a-protected-document-unauthenticated`). Root's candidates now flow through the same gated loop via `staticCandidates` -> `rootFallbackCandidates` (`:1029`/`:1003`). ⚠ **THREE PROPERTIES ARE LOAD-BEARING AND EASY TO UNDO:** (a) the gate runs on the **RESOLVED** file, not the raw request path — an earlier revision gated both and the two deciders disagreed three ways (answering for deleted documents, overriding a resolution that would have served a different PUBLIC document, and ignoring candidate priority); (b) the gate call sits **OUTSIDE both `try` blocks**, because while it sat inside a wide `try` a throwing auth guard produced a silent 404 and could fall through to serve a DIFFERENT file; (c) dev and prod key on the SAME string — `relative(serveDir, candidate)` lowercased, matching `build.js`'s `_SCRML_PROTECTED_DOCS.get(rel.toLowerCase())` (`build.js:541`). **`devDispatch` runs inside the respawned CHILD process** (`runDevChildServer`), so `registeredProtectedDocs` is rebuilt fresh per respawn and a stale guard cannot survive one. |

**Case-insensitivity is deliberate and OVER-protects, never under-protects.** Both sides lowercase the
map key AND the lookup key. On a case-insensitive filesystem the OS resolves `GET /SECURE.html` to
`secure.html`, but the SERVE_DIR-relative path used for cache/ETag logic keeps the REQUEST's original
casing — a case-EXACT map would miss on that request and leak the document. Gating every case variant
of a protected path is the safe direction to be wrong in (matches error.map.md's §14.8.11
graceful-degrade precedent: over-restrict, never under-restrict).

**Scope: documents only, not assets.** The guard mounts on the `.html` entry document path
specifically — CSS/JS/other static assets under the same route are unaffected by this change (they
carry no page content to leak and were already `no-cache`/immutable per their own contract, see
build.map.md's "Content-addressed build assets" section).

## `<program>`-level declarative auth config
| Field | Values | Purpose |
|---|---|---|
| auth | "required" \| "optional" | gates the whole program |
| loginRedirect | path string | unauthenticated redirect target |
| csrf | "auto" \| "on" \| "off" | CSRF middleware mode — see below |
| sessionExpiry | duration string ("1h","2h") | session cookie TTL |
| session-secure (NEW this window) | "true" \| "false" (default "true") | `__Host-scrml_sid`+always-Secure vs plain `scrml_sid`+no-Secure; registered on BOTH `<program>` and `<page>` (attribute-registry.js, html-elements.js) |

Companion `MiddlewareConfig` (types/ast.ts:1515): cors, log, ratelimit, headers, idempotencyStore, idempotencyTTL. Both extracted from `<program>` attributes by ast-builder.js/compute-program-config.ts and consumed by auth-graph.ts + codegen/emit-server.ts.

## §64.9 headless serve-target carve-out
A `<program kind="tool" serve=PORT>` (§64.9, the listener-owning headless serve-harness — see domain.map.md) has NO cookie session. Program-level `auth="required"`/`"optional"` OR a per-channel `<channel auth="required"/"optional">` on a `serve=` tool is **E-TOOL-SERVE-AUTH-UNSUPPORTED** — fail-closed rejected at compile time rather than silently emitting an unguarded route/WS-upgrade. Bearer-token auth for headless targets is explicitly a later (unimplemented) unit. The NEW `session` builtin is likewise unreachable from a `serve=` headless body (E-SESSION-CONTEXT).

## scrml:auth stdlib module (stdlib/auth/, compiler/runtime/stdlib/auth.js)
| File | Exports | Notes |
|---|---|---|
| flows.scrml | requestMagicLink/verifyMagicLink, requestEmailVerify/verifyEmailVerify, requestPasswordReset/verifyPasswordReset | request*/verify* pairs; single-use (get-then-delete) tokens; namespace-per-purpose store keying prevents cross-purpose replay; neutral `{ok:true}` responses regardless of address validity (enumeration resistance); caller injects the mailer, no built-in SMTP |
| jwt.scrml | signJwt/verifyJwt (HS256, Bun crypto.subtle), verifyJwtJwks (RS256 against a `.well-known/jwks.json` URL — alg-pinned BEFORE any JWKS fetch to prevent alg-confusion), decodeJwt (pure) | server-only by inference (importing scrml:auth escalates the caller, §12.2 Trigger 3) except decodeJwt. `secret` is ALWAYS a caller-supplied argument — this compiler repo has no env-var-based signing secret of its own (see config.map.md correction) |
| password.scrml | hashPassword/verifyPassword (Bun.password argon2id), generatePassword(length, opts) | generatePassword uses REJECTION SAMPLING over crypto.getRandomValues for uniform charset selection; pure, browser-safe |
| templates/login.scrml | scaffolded `scrml generate` login page | inline server fn (cross-file `?{}`-using server fns can't cross a file boundary) |

## scrml:oauth stdlib module (stdlib/oauth/, compiler/runtime/stdlib/oauth/)
Providers: discord, github, google, microsoft (each a thin provider-specific wrapper) + pkce.scrml (PKCE code-verifier/challenge generation, shared by all 4). Unchanged this window; distinct from the §20.5 session-establishment primitive (OAuth verifies identity, session.set persists it).

## Server-only-stdlib client leak — the placement backstop, and the ONE position it now refuses (§12.2 Trigger 3 / §6.6.19)

**This is a CONFIDENTIALITY boundary, not a performance one, and the whole design follows from which
direction is safe to be wrong in.** `ESCALATION_SERVER_ONLY_MODULES` (`route-inference.ts:656`) is
the placement set — **NOT** `SERVER_ONLY_SCRML_MODULES` (`:579`), which feeds async classification
where over-inclusion is free. Members and the limb each satisfies:

`scrml:auth` (a: `Bun.password` argon2id) · `scrml:crypto` (a: `Bun.CryptoHasher`, `Bun.password`) ·
`scrml:cron` (a) · `scrml:fs` (a: `node:fs`) · `scrml:process` (a) · `scrml:redis` (a: the **BARE**
`bun` specifier, no colon — a `bun:`-only scan misses it) · `scrml:store` (a: `bun:sqlite`) ·
`scrml:path` (a) · `scrml:mcp` (a, host surface in the `.js` shim) · **`scrml:oauth` (b:
CREDENTIAL HANDLING — zero host reach, but it puts `client_secret` in the token-exchange body three
times and its own header reads "SERVER-SIDE ONLY")**.

**Limb (b) exists because a host-reach-only criterion was FALSIFIED in review inside the same
session.** `scrml:oauth` was cleared as client-safe on the reasoning that PKCE lets the flow run in a
browser — true of the public-client half of a module that ships both halves. A clean compile shipped
a real client secret into the browser bundle. **The criterion was the defect, not the list.** The
normative criterion sits ABOVE the list in SPEC on purpose: a hand-maintained derived list rots
silently and nothing fails when it does. **Re-evaluate the criterion rather than editing the list
from memory, and when a module resists classification, prefer the server** — over-inclusion costs a
round trip, under-inclusion ships a secret to a browser.

**When the trigger FIRES it emits NO diagnostic, and that is by design.** A function silently moving
to the server is the SUCCESS path. "My function vanished from the client bundle and there are zero
errors and zero warnings" is the expected shape, not a bug report.

**The position it CANNOT reach, and what happens there now.** §12.4 makes route inference
per-function, so a non-function position is not reached by the trigger at all:

| Position | At `4f034e13` | Changed since `616688ea`? |
|---|---|---|
| `function` body | escalates (Trigger 3), silently, no diagnostic | no |
| `const <name> = …` **derived cell** RHS, **AT ANY DEPTH** | **REFUSED — `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486 + #500).** Not escalated: a derived recompute is synchronous lazy-pull (§6.6.3) and cannot become a round trip | **YES — #500. See the six positions below.** |
| `<name> = …` **mutable-cell initialiser** | **OPEN — leaks, no diagnostic** | no |
| **markup interpolation** | **OPEN — leaks, no diagnostic** | no |

⚠ **THE DERIVED-CELL ROW WAS TRUE-BUT-INCOMPLETE AT `616688ea`, AND THE INCOMPLETENESS WAS A LIVE
LEAK.** #486 shipped the refusal; the collector behind it (`collectDerivedCellDecls`,
`route-inference.ts:3730`) descended exactly `node.body` and `node.children` while its own doc comment
claimed it found derived cells *"at any depth"*. **Six positions were measured still leaking**, each
at exit 0 with ZERO `.server.js` and a real `Bun.password.hash(pw, { algorithm: "argon2id" })` in the
shipped browser runtime:

| Leaking position (pre-#500) | Why the field-listed walk missed it |
|---|---|
| `for`-loop `lift` body | the body sits under an `expr` wrapper — `…expr.node.children[0].body[0]` |
| `while`-loop `lift` body | same wrapper shape |
| `<each>` row body | per-item template children are not `node.body`/`node.children` at that level |
| `<engine>` state-child body | state children hang off an engine-specific property |
| loop nested inside a conditional | the conditional's arm is reached only through the same wrapper |
| any of the above inside a `kind="tool"` program | the §64 carve-out is what must hold there instead — it is a WHOLE-FILE predicate applied by the caller, so it is depth-independent by construction |

**The fix inverted the walk's default** rather than adding `expr` to the list: every array- and
object-valued property is descended, and exclusions live in a two-clause deny-list
(`skipDerivedWalkKey`, `:3677` — `span`, plus `_`-prefixed side tables). **Adding `expr` to a list of
two would have closed the reported shape and left the class open at the next unenumerated property.**
Measured: the deny-list is not load-bearing for the RESULT (68 cells collected with the shipped list,
68 without `parent`/`loc`/`spans`, 68 with no deny-list at all) — only for the work done. Termination
is an identity `seen` set plus a 512 depth cap, because the walk now descends ESTree expression trees
that nest one level per term. **`collectDerivedCellDecls` is EXPORTED for tests** precisely so the
termination and single-visit properties can be asserted against it directly; driving them through
`runRI` conflates them with every other walk in the stage (a synthetic cyclic AST blows the stack
inside `collectFileLevelBindingRoots`, `:2600`, which has no `seen` set at all — a separate,
unfixed fragility worth knowing about before you write such a test).

Reach is **REFERENCE, not call**, at ANY depth — inside a lambda, a nested `function` decl, or
escape-hatch raw text. Matching only top-level CALLS was proven evadable four ways, each shipping the
module and its secrets to the browser at exit 0: `["PEPPER"].map(p => hashPassword(p))`, a nested
`function` decl, a bare callback reference, and `let f = hashPassword; f(x)`. **On a confidentiality
boundary, over-firing costs a relocation and under-firing costs a leak.** Accepted residuals, named
rather than hidden: a binding shadowed ONLY inside a nested lambda still fires, and a word-boundary
scan of escape-hatch raw text can match inside a string literal in that text — both over-fires.

**`kind="tool"` programs (§64) are carved out of the §6.6.19 refusal** — no client boundary, no leak
— mirroring the carve-out Trigger 3 already takes for `print()`/`println()`. **The carve-out is
applied by the Step 3b CALLER (`isToolProgram`, read off the top-level `<program>`) BEFORE the walk
runs, not inside it**, which is what makes it depth-independent and is why the structural-walk change
did not have to re-derive it.


## Protected-field egress backstop (§14.8.9, NOT stdlib — compiler-enforced) — ⛑ **REWRITTEN S405 (#896). IT IS THREE LIMBS, NOT ONE.**

`<db src=... protect="col1,col2">` (or `authority=` collections) marks columns that must never reach
the client bundle. **PA-stage analysis** is `compiler/src/protect-analyzer.ts` (PAError); the
**acorn-EXACT, fail-closed emit-time backstop** on the CLIENT bundle is
`compiler/src/codegen/egress-field-scan.ts` (`E-CG-001`). ⛔ **THE SERVER->CLIENT EGRESS FLOOR IS A
SEPARATE, THREE-LIMB MECHANISM IN `compiler/src/codegen/protect-egress.ts`, AND THE THREE HAVE
DELIBERATELY DIFFERENT STRENGTHS. THE MODULE DOCSTRING (`:37-51`) SAYS SO: *"Read the strengths; they
are not interchangeable."***

| limb | code | mechanism | site | strength |
|---|---|---|---|---|
| 1 | **`E-PROTECT-004`** | per-body **SOURCE-TEXT co-occurrence LINT** for `_{}` (§23) and `asIs` (§14.1.1) | `protect-egress.ts:449` (`detectProtectedRawEgress`) | ⚠ **CONSERVATIVE, DEFEATED BY FUNCTION EXTRACTION (measured), NOT A GUARANTEE** |
| 2 | **`E-PROTECT-005`** | HARD compile **ERROR at EMISSION** on an author-serialized response **BODY** (§40) | raised `emit-server.ts:2061`; gate `_protectResponseGate` `:2020`; detector `findAuthoredResponseConstruction` `protect-egress.ts:754` | **STRUCTURAL — extraction does NOT defeat it.** ⚑ **FILE-scoped, not query-scoped, deliberately** |
| 3 | **runtime refusal** | `_scrml_protect_redact` / `_scrml_protect_opaque_refusal()` | `SERVER_PROTECT_HELPER`, `protect-egress.ts:221+` | **`instanceof Response` is EXACT — no spelling problem, no extraction hole. THIS IS THE GUARANTEE.** |

⚑ **THE UNIT OF ALL THREE IS THE BODY, NOT THE `Response`.** A null-body `Response` — a redirect, a
`204`, `Response.error()` — carries no payload, so limbs 2 and 3 both permit it. **`W-PROTECT-005`
covers the narrow seam where the compile limb can prove that and the runtime limb cannot** (Bun gives
a redirect a 0-byte `ReadableStream` rather than a null body, and a secret-carrying
`new Response("s3cret", {status:302, headers:{Location}})` is indistinguishable from one at the exit
— MEASURED). **THE ADOPTER CONTRACT IN ONE SENTENCE: a `protect=` app keeps full control of STATUS
and HEADERS and gives up authoring the BODY.**

**THE MEDIATION MARK — the compile/runtime seam.** `const _SCRML_MEDIATED =
Symbol.for("scrml.protect.mediated")` + `function _scrml_protect_mediated(response)`
(`protect-egress.ts:245`). Both limbs were asking *is this `Response` AUTHOR-owned or
COMPILER-owned?* — the compile gate by **PROVENANCE**, the runtime guard by **SHAPE**
(`.body === null`). **Every disagreement was a defect:** `Response.redirect(...)` (author-owned,
payload-free) and the §53.9.4 `E-CONTRACT-001-RT` 400 (compiler-owned, body-carrying — the guard
turned the compiler's own 400 into a 500). Marked at `emit-server.ts:1904` (`_markMediatedResponses`
`:1890`, which **THROWS at emit time** if the emitter it wraps stopped producing a `Response`); read
**provenance-first** at `_opaqueResultGuard` (def `:1948`, the mediated read at `:1957`) and in the redactor. ⚠ Gated on
`_protectActive` (`:4436`) — unconditional emission dragged the 127-line helper into `protect=`-free
apps (~66% of the module, all dead). Mechanical seam test:
`compiler/tests/integration/g-sql-row-protect-leak.test.js:628`.

**SINKS — which ones guard a top-level `Response`, stated exactly.** Guarded: **both server-fn arms ·
the §61 `<endpoint>` envelope · `/__mountHydrate`** (the last as of #896). **NOT guarded:
`/__serverLoad`** — and that is **safe for a REASON, not by luck**: its `_scrml_rows` /
`_scrml_result` / `_scrml_cv` are values the COMPILER built from a lowered `?{}`, so no author
construction reaches it. ⛔ **DO NOT EXTEND THAT REASON TO `/__mountHydrate` — a previous source
comment did, and it was FALSE.** Each `_scrml_mh_v<i>` is an AUTHOR `server @var` loader result;
`JSON.stringify` ignores the Symbol-keyed descriptor, so `passwordHash` crossed the wire in cleartext
on `POST /__mountHydrate` while the SSR compose handler forty lines below redacted the same two
values. Fixed at `emit-server.ts:5531` / `:5561` per value via `_egressRedact`, plus
`_mountHydrateOpaqueGuard` (`:1935`) on both arms — which refuses **ANY** `Response` cell value,
deliberately not reusing the three-way test, because a hydration cell is DATA and a `Response` is
never a valid value for one.

⛔ **THE MISS IS THE REUSABLE LESSON: `/__mountHydrate` slipped past THREE independent completeness
proofs that all enumerated over the REDACTOR** (its call sites / SPEC's list of the boundaries it
covers / the ways to bypass it). **A sink that never ADOPTED the redactor is outside all three frames
AT ONCE, so their agreement measured nothing. The obligation is over the DATA, so the enumeration has
to be over the SERIALIZER.**

**SOUNDNESS BOUND (§14.8.9 normative — DO NOT OVER-CLAIM).** Complete for explicit-column flows of
statically-resolvable SQL, **by ORIGIN**. NOT covered: derived/implicit flows
(`{ hasPw: row.pw != "" }` — a value of independent identity carries no descriptor), covert channels,
and member-extraction into a re-keyed fresh literal (`{ secret: row.pw }`). Unresolvable dynamic SQL
is stripped **WHOLESALE (fail-closed)**, never accept-unknown.

⚑ **THE OPAQUE REFUSAL IS TAGGED, NOT JUST THROWN** — `_scrml_e.__scrml_protect_opaque = true` — so a
caller can tell a confidentiality refusal apart from an ordinary failure. Without the tag, the §37 SSE
stream wrapper's generic `catch` swallowed the refusal and ended the stream with a **silent 200**.

## §14.8.10 — TENANT-ROW ISOLATION, and the day two adjacent security floors disagreed about what a `<schema>` IS (NEW section, S405, #900)

⛔ **A raw-DDL `<schema>` + no-`<db>` app had a SILENTLY INERT tenant isolation floor at exit 0** — no
`_scrml_tenant_tag`, no `_scrml_tenant_redact`, **no diagnostic** — because §14.8.9 had been taught the
raw `CREATE TABLE` `<schema>` form and §14.8.10 had not. **Reproduced end-to-end: executed with
ambient tenant `A`, the wire carried `{"id":2,"name":"THEIRS","tenant_id":"B"}` — a live cross-tenant
isolation escape, executed, not theoretical.** ⚑ **The 4-app matrix isolates it to an INTERSECTION,
which is sharper than "schema-only apps are inert":** DSL+no-`<db>` ACTIVE · **raw-DDL+no-`<db>`
INERT** · raw-DDL+`<db>` ACTIVE · DSL+`<db>` ACTIVE.

**A table is tenant-scoped iff its column list includes `tenant_id`** — §14.8.10: *"the column's
presence is the declaration… There is no per-table opt-in attribute."* `buildTenantContext`
(`codegen/tenant-egress.ts:127`) reads BOTH registries: the §14.8.9 ProtectContext's `schemaByTable`
(every `<db>`-bound table) AND `extractDesiredSchema`'s `tables` (threaded from
`emit-server.ts:1769`). ⚠ **`class TenantTableSet extends Set<string>` (`:84`) case-folds on EXACTLY
`add` / `has` / `delete`** — a read that bypasses those three sees the FOLDED form and does not fold
the probe.

**FIXED BY ONE SHARED RECOGNIZER, NOT A SECOND BETTER ONE** — `compiler/src/schema-differ.js`
(`parseSchemaBlock` `:31` · `harvestCreateTables` `:246` · `harvestRawCreateTableDecls` `:264` ·
`harvestRawCreateTables` `:282` · `parseRawCreateTableColumns` `:348`), imported by
`protect-analyzer.ts` (`:65-77`) and `gauntlet-phase1-checks.js` (`:69-80`).
**`W-SCHEMA-NO-TABLES-DECLARED` (`gauntlet-phase1-checks.js:803`) is the STANDING DETECTOR for the
next such divergence** — and its recognition is the UNION of both forms **using those same
functions**, because a third recognizer inside the detector would reintroduce, in the detector, the
divergence it exists to catch. Full treatment: `domain.map.md` §14.8.10 section.

## Historical: jwt-auth-bypass (2026-07-11, fixed, carried for context)
`scrml:auth/jwt`'s exports were silently dropped at compile in a specific comment-shape case, so the async-export seed never saw them → misclassified sync → a server fn emitted `verifyJwt(...)` UNAWAITED → the always-truthy Promise defeated `if (!result.valid)` → accept-all auth bypass. Both parser root causes are fixed; the standing defense-in-depth is api.js's STDLIB-EXPORT-SEED (fails CLOSED on any unresolvable server-only `scrml:*` re-export — see dependencies.map.md). No auth-surface API change.

## CSRF
`<meta>` synchronizer token + `/_scrml/session` projection. `csrf="auto"` (default) emits `_scrml_get_csrf_token()` (SameSite=Strict double-submit cookie) + `_scrml_fetch_with_csrf_retry` client helpers when the program has no explicit auth middleware entry (codegen/emit-client.ts). Not applicable to a §64.9 headless `serve=` target (no cookie session at all). The §20.5.1 `csrfToken` session key (above) is the SAME synchronizer token, now also protected against a literal-write mass-assignment bypass.

## Token Lifecycle
Issued: JWT via `signJwt` (HS256, server-only) or an external IdP (RS256, verified not issued by this compiler); the §20.5 session record is issued by `_scrml_session_begin` on first authenticated request.
Validated: `verifyJwt` (HS256, local secret) or `verifyJwtJwks` (RS256, fetches + caches the IdP's JWKS, algorithm pinned); the session cookie is validated by mode-gated exact-name cookie match + durable-store lookup.
Refresh: not implemented in stdlib — caller-managed. Session TTL is `session-expiry`-driven, not silently refreshed on activity.
Expiry: `sessionExpiry` on `<program>` for the session cookie `Max-Age` + durable-store TTL; JWT `exp` claim is caller-set at sign time.
Magic-link/verify/reset tokens: TTL-bound (caller-supplied, embedded in the stored record as an authoritative `expiresAt`), single-use, namespace-scoped.

## Tags
#scrml #map #auth #baas #jwt #jwks #oauth #csrf #magic-link #password-reset #e-cg-001 #protect-floor #stdlib-auth #server-shape #tool-serve #jwt-auth-bypass #session-establishment #session-secure #host-cookie #e-scope-012 #e-session-context #e-session-value #e-session-reserved-key #gh357 #session-proxy-bind #scrml-session-bind #reflect-get-target-receiver #sql-interpolation-session #csrf-token-disclosure #session-read-side #dangling-ref-class #ast-reads-current-user-ambient #sse-currentuser-splice #channel-auth-only #scrml-auth-check #permissive-by-design #store-invariant-probed #§52.15.1 #§20.5 #object-hasown #own-property-read #prototype-chain-read-closed #hasownproperty-shadow #read-side-policy-open #wire-live #response-contract #security-theater-vs-defense #ledger-locus-stale #§6.6.19 #e-derived-server-only-reach #escalation-server-only-modules #two-limb-criterion #credential-handling-limb #oauth-client-secret #criterion-not-the-list #per-function-scope-only #two-positions-still-open #mutable-cell-initialiser-open #markup-interpolation-open #reference-not-call #four-evasions #over-fire-not-leak #kind-tool-carve-out #no-diagnostic-when-it-fires #any-position #structural-walk-not-field-listed #collect-derived-cell-decls #skip-derived-walk-key #six-leaking-positions #for-lift-body #while-lift-body #each-row-body #engine-state-child #expr-wrapper #deny-list-not-load-bearing #depth-cap-512 #identity-seen-set #exported-for-tests #collect-file-level-binding-roots-has-no-seen-set #descend-one-field-too-many #do-not-add-the-field-name #carve-out-applied-by-the-caller #request-onion #select-request-onion #e-mw-007 #one-onion-rule #handle-top-level-dispatch #scrml-onion-dispatch #mw-pipeline-export #mw-declared-in #cors-preflight-stage-1 #preflight-carries-no-credentials #ratelimit-route-scoped #filename-sorted-precedence-hazard #csp-default-src-self #ssr-seed-application-json #transition-css-stylesheet #dev-prod-onion-parity #onion-dispatch-is-in-build-js #wrong-file-not-drifted-line #zero-diff-is-not-correctness #§52.13 #protected-document #scrml-protected-document #auth-required-document-guard #g-auth-required-does-not-protect-the-served-html-document #protecteddocs #scrml-pd-alias #case-insensitive-doc-guard #dev-prod-guard-parity #s380-incremental #s738-dev-rewrite #dev-child-process #dev-parent-proxy #run-dev-child-server #serve-dev-infra #child-ready-prefix #issue-724 #s437b #9941a504c #zero-diff #s440 #cf62b415 #nested-async-helper #accept-all-closed #s447 #6a592ed5c #self-host-v1-removed #test-tmp-root #protect-egress-r8 #s450 #9bafb927 #native-parser-frozen #parser-flag-retired #session-ambient-server #auth-attr-invalid #s452-wrap #7ce905ac2 #tenant-sql-subset #e-tenant-sql-subset #arm-pipe #w-arm-pipe-legacy-impl1 #effect-summary #dpa-066 #s456 #ba2712973 #tenant-startup-check #handle-sink
#fourth-consecutive-zero-diff #anchors-carry-by-measurement
#s405 #auth-surface-non-empty #protect-analyzer-deleted-its-regex #import-direction-invariant #e-pa-003-shadow-db #§14.8.9-three-limbs #e-protect-004-is-a-lint #e-protect-005 #runtime-refusal-is-the-guarantee #the-unit-is-the-body #status-and-headers-not-the-body #mediation-mark #provenance-vs-shape #w-protect-005 #zero-byte-readablestream #mounthydrate-was-unguarded #serverload-safe-for-a-reason #enumerate-over-the-serializer #tagged-refusal #soundness-bound-by-origin #§14.8.10-tenant-floor #four-app-matrix #cross-tenant-escape-executed #tenanttableset #w-schema-no-tables-declared #foreign-opener-two-of-five-are-security-floors
#s437 #d02738767 #session-store-dist-root #session-config-resolve #e-mw-008 #e-auth-005-application-scope #secret-redactor #db-target #cookie-name-per-application

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
