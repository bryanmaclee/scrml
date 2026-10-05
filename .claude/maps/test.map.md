# test.map.md
# project: scrml
# updated: 2026-10-05T04:22:31-06:00  commit: f38697900
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
# ━━━━━━━ S437 TEST DELTA ━━━━━━━
# `git diff --name-status 787d4cb4..HEAD -- compiler/tests`: **56 A · 3 D · 1 R · 28 M**. `.test.js` count by
# `git ls-files 'compiler/tests/*.test.js'` = **1,505** (== FACTS). Per dir at `d02738767`:
# `unit 985 · integration 228 · conformance 134 · browser 113 · commands 18 · ROOT 14 · lsp 11 · e2e-render-map 2 ·
# self-host 0` = 1,505. `compiler/tests/self-host/` is RETIRED (README only). Conformance corpus: 973 cases / 55 dirs;
# `bun conformance/run.ts` -> **967 pass + 6 XFAIL**. New mechanism: per-implementation `xfail` (S430 P7).
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
# ━━━━━━━ S422 TEST DELTA — **+19 TEST FILES, 16 OF THEM NEW UNIT PINS.** ━━━━━━━
#
# ⛑ **1,459 test files — RE-COUNTED THREE WAYS AND ALL THREE AGREE EXACTLY:** `docs/FACTS.md`,
# `find compiler/tests -name '*.test.js' | wc -l`, and `git ls-files 'compiler/tests/**.test.js' |
# wc -l` each return **1,459** (was 1,440, **+19**).
# Per category dir, re-derived at this SHA: `unit 954` (**+17**) · `integration 220` (**+1**) ·
# `conformance 133` (FLAT) · `browser 104` (**+1**) · `commands 17` (FLAT) · **`ROOT 14`** (FLAT) ·
# `lsp 11` (FLAT) · `self-host 4` (FLAT) · `e2e-render-map 2` (FLAT). Sum = **1,459**.
# ⚠ **THE TWO STANDING DEFINITION BOUNDARIES ARE UNCHANGED IN KIND AND RE-MEASURED IN SIZE:**
# (1) the `@generated` `test.generated.md` figure keys on the first SUBDIRECTORY, so the **14
# ROOT-level `compiler/tests/*.test.js`** fall out of its total — expect **1,445** there against
# FACTS' 1,459 (`1,445 + 14 = 1,459`). (2) a repo-wide `git ls-files '*.test.js'` returns **1,460**,
# the extra being `conformance/conformance-corpus.test.js`, which lives OUTSIDE `compiler/tests` and
# is the §62.2 corpus bridge (invariant 88). **Record both; do not "fix" either instrument.**
#
# ⛑ **16 NEW `compiler/tests/unit/` FILES, EACH NAMED FOR THE DEFECT IT PINS** — the naming
# convention is doing real work here and is worth preserving:
# `braceless-control-head-regex-literal` · `condition-head-angle-operator-coverage` ·
# `condition-head-merged-shift-runs` · `declared-names-block-scope` · `e-eq-002-hint-is-some` ·
# `e-mu-001-inner-fn-reassignment` · `e-mu-001-nested-block-name-collision` ·
# `g-library-map-surface-unlowered` · `inner-fn-assignment-to-captured-binding` ·
# `library-mode-map-literal-runtime` · `loop-head-truncated-at-first-close-paren` ·
# `marker-parser-pins` · `regex-char-class-colon-not-a-map-literal` ·
# `semdiff-chunk-token-discovery` · `state-session-close-suffix` · `tokenizer-multi-ops-ordering` ·
# `while-braceless-body-stays-in-the-loop`.
# NEW integration: `corpus-emit-differential-exit-codes.test.js` (+707 lines — the largest single
# test addition this window). NEW browser: `composed-route-shell-chrome-wiring.browser.test.js`.
#
# ⚑ **THE `e2e-render-map` HARNESS WAS SUBSTANTIALLY REWORKED WITHOUT ITS FILE COUNT MOVING** —
# still 2 `.test.js`, but `e2e-render-map.test.js` (+532), `render-harness.js` (+387),
# `render-detectors.js` (+237), `detector-validation.test.js` (+208), `generate-baseline.js` (+59),
# `render-corpus-enumerator.js` (+19). **A FLAT FILE COUNT OVER A REWRITTEN HARNESS IS EXACTLY THE
# CASE A COUNT-ONLY TEST MAP MISSES.** Read the harness, do not infer it from the tally.
#
# ⚠ **`gate` STILL RUNS `unit` + `conformance` + ROOT-LEVEL `*.test.js` ONLY — NOT `integration`,
# NOT `lsp`, NOT `commands`** (invariant 87). So the +707-line `corpus-emit-differential-exit-codes`
# integration test, the single largest test artifact added this window, **is NOT gated in cloud CI.**
# The local pre-commit hook is a different and wider instrument; do not conflate the two.
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
# ━━━━━━━ S405 wrap-6c — **1,436 -> 1,440 `.test.js`; CONFORMANCE 897 -> 905.** ━━━━━━━
#
# ⛑ **RE-EXECUTED, NOT CARRIED. `git ls-files 'compiler/tests/**.test.js' | wc -l` -> **1,440**,
# reconciling EXACTLY with the CI-gated `docs/FACTS.md` (`test files | 1,440`).** A repo-wide
# `git ls-files '*.test.js'` returns **1,441** — the extra is `conformance/conformance-corpus.test.js`,
# which lives OUTSIDE `compiler/tests` and is the §62.2 corpus bridge (invariant 88). **Definition
# boundary, not a stale figure.**
#
# ⛔ **AND A *THIRD* DEFINITION BOUNDARY IS NOW QUANTIFIED EXACTLY, SO NOBODY "RECONCILES" IT AGAIN.**
# The `@generated` `test.generated.md` prints **1,426**. **The difference is EXACTLY the 14
# ROOT-LEVEL `compiler/tests/*.test.js` files.** `flogence/scripts/mapgen.ts` keys its category table
# on the first SUBDIRECTORY, so a file sitting directly in `compiler/tests/` lands in no category and
# falls out of the total. Per-dir at this watermark: `unit 937 · integration 219 · conformance 133 ·
# browser 103 · commands 17 · **ROOT 14** · lsp 11 · self-host 4 · e2e-render-map 2` = **1,440**.
# **`1,426 + 14 = 1,440`. Record it; do not "fix" either instrument.**
#
# ⛑ **THE WINDOW'S TEST DELTA, MEASURED WITH `git diff --name-status` RATHER THAN `--name-only`,
# BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS: 14 paths under `compiler/tests` moved — **4 ADDED, 10
# MODIFIED** — and one of the 10 is a `.scrml` FIXTURE, so **13 `.test.js` files were touched and only
# 4 are new.** The 4 ADDED reconcile EXACTLY with FACTS' `test files` +4 (1,436 -> 1,440):
# `integration/engine-statechild-prose-punctuation.test.js` ·
# `integration/library-mode-structural-routing.test.js` · `unit/protect-response-scan.test.js` ·
# `unit/tenant-floor-raw-ddl-schema.test.js`. ⚠ **A `--name-only` list would have read as "14 new
# tests" and over-stated the arc by 3.5x.** By tier: **7 `integration/` · 5 `unit/` · 1
# `conformance/`** — and `gate` runs `unit` + `conformance` + root only, so **all seven
# `integration/` files are outside the blocking gate** (invariant 87). The files, by arc:
#   · `integration/engine-statechild-prose-punctuation.test.js` — the §4.18.3 free move (#892). Its
#     header carries the SPEC citations and, usefully, the *"already-broken upstream"* cases that PIN
#     a pre-existing failure as UNCHANGED, so a future reader does not misread it as a regression.
#   · `unit/engine-statechild-comment-opacity.test.js` (**MODIFIED, pre-existing**) — the `//` /
#     `/*` / `<!--` opacity + the deliberately-asymmetric unterminated recovery.
#   · `unit/protect-response-scan.test.js` + `integration/g-sql-row-protect-leak.test.js` (#896) —
#     the latter carries the **MECHANICAL SEAM TEST** at `:628`: *"SEAM: every compiler-emitted
#     Response inside a capture IIFE is mediation-marked"*, asserted over the whole emitted module
#     rather than a hand-listed case set.
#   · `unit/tenant-floor-raw-ddl-schema.test.js` · `unit/tenant-egress.test.js` ·
#     `integration/schema-only-tenant-principal.test.js` · `conformance/conf-TENANT-FLOOR.test.js`
#     (#900) — the first carries an explicit "THE SPLIT" describe block over `extractDesiredSchema`'s
#     TWO consumers, which is the arc's load-bearing seam.
#   · `integration/library-mode-structural-routing.test.js` · `export-enum-library-emit.test.js` ·
#     `library-mode-bare-fn-no-trailing-newline.test.js` · `unit/colorless-async-combinators.test.js`
#     · `integration/authed-server-fn-response-http.test.js` (#893/#897/#898).
#   · `commands/migrate-program-shape-fixtures/schema-anchor.scrml` — a FIXTURE, edited because
#     `W-SCHEMA-NO-TABLES-DECLARED` found a genuine defect in it on its first run (`users: { … }`
#     with a stray colon declares nothing).
#
# ⛑ **CONFORMANCE: 897 -> 905 (+8), AND ALL EIGHT ARE IN ONE DIRECTORY — `conformance/cases/protect/`
# (now 10 case dirs).** `conformance/cases` is still **54** category dirs: no new category. Raw
# `find conformance/cases -name expected.json | wc -l` -> **905**, matching `docs/FACTS.md`.
# The eight: `e-protect-005-pos` · `e-protect-005-neg` · `w-protect-005-null-body-static` ·
# `mediated-response-passthrough` · `mounthydrate-redacts` · `null-body-response-clean` ·
# `endpoint-multikey-arm-response` · `reveal-wrong-column-e004`. Two existing dirs were EDITED
# (`raw-egress-e004`, `reveal-suppresses-e004`).
#
# ⚠ **THE ONE TEST-DESIGN LESSON WORTH CARRYING OUT OF THIS WINDOW: `unmetRuntimeHelperRefs` AND THE
# CORPUS EMIT DIFFERENTIAL BOTH SCORED A CLEAN PASS ON TWO SILENT-WRONG LIBRARY-MODE REGRESSIONS,
# BECAUSE THE CORPUS POPULATION CONTAINS NO `_{}` AND NO `!{}` IN A LIBRARY FN.** **A zero over a path
# the population never exercises is not coverage.** The fix was a named exclusion plus an
# emitted-BYTES gate (`unloweredScrmlSyntax`), not a wider differential.
#
# ⚑ **`test.generated.md` WAS REGENERATED THIS PASS** (`bun scripts/mapgen.ts --kind tests`) — it had
# been stamped `2026-09-06 16:32`. It is `@generated`: do not hand-edit.
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
# ⛑ **`1,436` `.test.js` BY RAW `find`, AND IT RECONCILES EXACTLY WITH THE CI-GATED `docs/FACTS.md`
# (`test files | 1,436`).** +1 over S402's 1,435. ⚠ The mapgen figure (`test.generated.md`) is a
# DIFFERENT question — it walks category subdirectories and skips root-level
# `compiler/tests/*.test.js`, which is the standing ~14-file gap; do not diff the two series.
#
# **THE ONE NEW FILE: `compiler/tests/unit/template-literal-interpolation-classification.test.js`
# (+652, #877)** — the §53.4 template-literal classification suite. THREE existing files changed:
# `unit/gauntlet-s19/type-annot-mismatch.test.js` **+191** (the §7.5.1 position-1/2 widening's 8-cell
# matrix), `unit/s365-asis-unknown-split.test.js` **+48**, and
# `integration/trucking-dispatch-smoke-integration.test.js` **+23**.
#
# ⛔ **`conformance cases` IS FLAT AT 897 AND `conformance/cases` IS `--name-only` EMPTY ACROSS ALL FIVE
# COMMITS.** A normative §7.5.1 widening — `E-TYPE-031` now fires at a position where programs
# previously compiled silently — landed with **ZERO new conformance cases**, pinned only by unit tests.
# Per the §34 census that is exactly why the affected codes sit in IMPL-SITES rather than PINNED: a
# unit test is not a conformance pin, and §62.2 makes the conformance corpus the versioned contract.
#
# ⚑ **A SECOND RE-RUNNABLE MEASUREMENT INSTRUMENT EXISTS AND IT IS NOT A TEST:**
# `bun scripts/int-number-census.ts --selftest` is a fixture-driven check of that script's own
# classifiers, run by hand. It is not in `bun test` and nothing gates it.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# ⚠ **THE WINDOW IS FOUR SESSIONS WIDE, NOT ONE** — `10a4b045..499eecce` is **36 commits, PRs
# #835-#872** (S399 · S400 · S400-peter · S401 · S402). The prior stamp is 4 sessions behind because
# S398-S401 did not fire a wrap-6c. Per-file attribution is in `primary.map.md`'s header.
#
# **THIS MAP:** **`1,421` `.test.js` by mapgen / `1,435` by raw `find`** (the 14-file gap is mapgen skipping root-level `compiler/tests/*.test.js` — re-verified, not carried). **ZERO conformance CASES changed across 36 commits** while 15 test files did. Re-walked.
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
# **THE COMMANDS-TIER GATING ROW IS THE CHANGE THAT MATTERS HERE**, and it is sharpened rather than
# restated: `compiler/tests/commands/` (**17** files at this SHA) is run by **no blocking job on any
# platform** in the source-controlled configuration — not `pre-commit`, not the cloud `gate`, not
# `windows`. In cloud CI it appears **only** in `tracking`, which is `continue-on-error: true`.
# ⚠ The one nuance a bare "not pre-push" would get wrong: this machine's INSTALLED pre-push hook DOES
# name `compiler/tests/commands` in its blocking suite — but that suite is gated behind `RUN_SUITE`,
# which is `0` on a normal push. See the Gating table and invariant 86 in primary.map.md.
# Corpus figures re-parsed (not grepped) this pass: **455 `domAnchored` assertions across 193 cases**;
# **62** are `count: 0` and **all 62 are count-only**; **18** are MIXED (a count AND a first-match
# check) and **all 18 are `count: 1`** — those 18 are exactly what #822 un-blinded.
#

## S454 — TEST SURFACE DELTA (`7ce905ac2..f38697900`)

Test files (FACTS definition) **1,591 -> 1,597**; conformance cases **1312 -> 1318** (`bun conformance/run.ts`
at `f38697900`: **1268 pass + 50 xfail**); slice-m4 **34 -> 38** files, **1229 pass / 1 todo / 0 fail**.

| new test file | covers |
|---|---|
| `compiler/tests/unit/s454-callref-handler-rejection.test.js` (336 L) | #1296 — call-ref / bare-ref / formFor / in-arm handler colouring; author-name emission |
| `compiler/tests/browser/callref-handler-rejection-log-s454.browser.test.js` (342 L) | #1296 — executed: every handler form logs a rejection once; `preventDefault` timing control |
| `compiler/tests/conformance/conf-PROTECT-EGRESS-FLOOR.test.js` (412 L) | #1299 — executed protect= floor shapes (leading `;`, `RETURNING *;`, unknown-view subquery, `${}` brace splice, CR in `--`, quoted RETURNING targets) |
| `compiler/tests/unit/protect-failclosed-classify.test.js` (228 L) | #1299 — `classifyProtectStatement` select/write/no-rows/unknown |
| `compiler/tests/unit/reserved-prefix-e-name-collides.test.js` (420 L) | #1301 — declaration + reference refusal, raw-captured regions, stdlib real-path exemption, TAB-desugared refs |
| `compiler/tests/unit/s454-handled-sql-expression-positions.test.js` (662 L) | #1305 — parser placeholders, compile, runtime against real `bun:sqlite` (row / no-row / failure), refusal |
| `compiler/self-host-v2/slice-m4/server-call{,-check,-core,-runtime}.test.js` | #1303 — U1b binder, check C-S*, Core shape, `rt.call` classification + deadline |

Pins updated in-window: `unit/event-delegation.test.js` (§5 — the stage emits the author name),
`conformance/conf-form-for-validity-surface-bug-58.test.js` (formFor submit now coloured),
`integration/g-sql-row-protect-leak.test.js` (subquery tables known), `unit/a9-ext4-cps-failable-wiring.test.js`
(`CpsError` -> `ServerCallError` + `Transport`), `unit/defer-text-body-completeness.test.js`,
`integration/bootstrap-conformance-counter/` (+`fixtures/runtime/server-stub/`).

New conformance cases: `reactive/reserved-prefix-declaration-pos`, `server-db/reserved-prefix-raw-driver-{neg,pos}`,
`server-db/sql-handled-{decl-rhs,in-condition,match-scrutinee}-rt` (the three `-rt` cases EXECUTE against SQLite).

## S452-WRAP — TEST SURFACE DELTA (`fd2f757d0..7ce905ac2`)

Test files **1,591** (+3, FACTS definition) · conformance **1312** (+2) -> `bun conformance/run.ts` **1262 pass + 50 xfail** · slice-m4 **1129 pass / 1 todo / 0 fail** across 34 files.

| file | L | covers |
|---|---|---|
| `compiler/tests/commands/fix-arm-pipe.test.js` | 389 | NEW — rewrite shapes, same-line split, message arms, attribute-value handler, never-touched shapes (match arms, `\|` alternation, `\|\|`, SQL), idempotence, blockers, `fixS66` + CLI wiring |
| `compiler/tests/unit/arm-pipe-legacy-lint-s452.test.js` | 293 | NEW — W-ARM-PIPE-LEGACY per `\|`-led `!{}` / message arm; pipe vs pipe-less byte-identical output |
| `compiler/tests/unit/tenant-sql-subset.test.js` | 153 | NEW — `lexTenantSubset` / `analyzeTenantSql` accept/refuse table |
| `compiler/tests/unit/tenant-egress.test.js` | — | updated (+113 lines changed) — r3/r4 refusals, OR ABORT, schema write hazards |
| `compiler/tests/integration/tenant-row-isolation.test.js` | — | updated — scoping against two seeded tenants |
| `compiler/tests/unit/defer-binder-completeness.test.js` | — | classifies the `legacyPipe` offset/flag fields |
| `compiler/self-host-v2/slice-m4/effects-summary.test.js` | 196 | NEW — effect summary; G7 pins; `closeDim` ordering inversion; dead vs reachable return-call twins |
| `compiler/self-host-v2/slice-m4/diag-diff.js` | 98 | NEW helper (not a test) — diffs analyze diagnostics logged via `SCRML_BOOT_DIAG_LOG` (`slice-m1/harness.js:125`) |
| `conformance/cases/error/arm-pipe-legacy-handler/` | — | NEW — `\|`-led handler arms incl. paren-free binder; W-ARM-PIPE-LEGACY ×2; runtime identical to canonical |
| `conformance/cases/engine/arm-pipe-legacy-message/` | — | NEW — `\|`-led message arms; W ×2 |

Pattern note: the two legacy-purpose conformance cases carry a header comment forbidding `scrml fix`; `bootstrap-conformance.ts` twins with `TWIN_RULES` (no `arm-pipe`) so they are graded AS WRITTEN.

## S453 — TEST SURFACE DELTA (`d3e660a08..fd2f757d0`)

### Figures re-executed at `fd2f757d0`

| measure | value | note |
|---|---|---|
| test files (FACTS definition) | **1,588** | +10 from 1,578. 13 files were added; 3 are under `compiler/self-host-v2/`, which FACTS excludes |
| conformance cases | **1310** | +10. `bun conformance/run.ts` -> **1260 pass + 50 xfail, 0 fail** (0 `FAIL` lines in the output) |
| `compiler/tests/` by directory | unit **967** · integration **255** · browser **117** · conformance **53** · commands **26** · lsp **11** · e2e-render-map **2** · root-level `*.test.js` **11** | `ls compiler/tests/<dir>/*.test.js \| wc -l` at this watermark |
| bootstrap `slice-m4` | **1115 pass / 1 todo / 0 fail**, 33 files | was 1002/0 at `d3e660a08` |
| bootstrap `slice-m2` | **420 pass / 6 fail**, 7 files, ON THIS WINDOWS CLONE | ⚠ see the CRLF caveat below. Was 462/0 at the S451 stamp, measured on a different host |
| bootstrap counter (live) | 1310/1310 attempted · PASS **120** · FAIL **48** · NOT-TWINNED **513** · UNSUPPORTED **629** · LEGACY 0 · CRASH 0 · INVALID 0 | graded 168, 120 hold (71.4%), 11 of those VACUOUS -> 109 non-vacuous. Runtime half executed on the bootstrap for 42 cases. Committed `docs/bootstrap-conformance.md` is STALE (1301 / 511 / 622) |

### ⚠ SLICE-M2 IS RED ON THIS HOST AND IT IS NOT A REGRESSION

All six failures are CRLF, not lowering. Every one is a `compareCore` mismatch of exactly this shape:

```
path: "decls[0].renders[0].data.kids[0].data.text"
why:  "values differ"
a:    "\"\\r\\n        \""
b:    "\"\\n        \""
```

Failing names (4 in `slice-m2/lower.test.js`, 1 in `tables.test.js`, 1 in `typer.test.js`): "§66.19.1 counter:
lower(analyze(parse(lex(src)))) ≡ counterCore()" · "§66.19.3 dropdown (lib/dropdown.scrml + app.scrml): ≡
dropdownCore()" · "the M1 fixtures written as source lower to the hand-built fixture Cores" · "one flipped check is
found, with its path" · "the programs above reach every fact variant of every family" · "every §66.19 code block:
the full diagnostic list equals base's, code for code". `core.autocrlf=true` gives every tracked `.scrml` fixture
CRLF endings, the hand-built M1 oracle Cores hold `\n`, and the comparator is byte-exact. **Judge this tier by its
failure NAME SET against a base run, never by its exit code or its pass count on a Windows clone** — the same
discipline the browser tier's `--check` gate already encodes.

### New test files (13)

| file | L | what it holds |
|---|---|---|
| `compiler/tests/unit/s453-async-listener-rejection-log.test.js` | 349 | #1283 emit-inspection: every listener emitter's `async` output carries the `catch` arm; the boundary id per site; a directive-prologue body keeps `"use strict"` in directive position AND gets the arm; a non-async listener is byte-identical to the pre-S453 emission |
| `compiler/tests/browser/async-listener-rejection-log-s453.browser.test.js` | 265 | the same, EXECUTED in happy-dom: a rejecting async listener reaches `_scrml_error_boundary_log` with its boundary id instead of vanishing |
| `compiler/tests/unit/transaction-in-function-body.test.js` | 303 | #1286 parse + lint: `transaction {}` recognised in a nested body; E-ERROR-001 (incl. top level), E-ERROR-007, E-TRANSACTION-CONTROL-FLOW limbs |
| `compiler/tests/integration/transaction-in-function-body.test.js` | 481 | #1286 end-to-end emission: BEGIN / COMMIT / rollback-before-`fail` / the `finally` backstop |
| `compiler/tests/unit/engine-message-arms-pipeless-s452.test.js` | 194 | #1275 `pipelessHeadAt` — the accepted head forms and, importantly, the fail-closed NON-heads (a bare name, `a.b.c`, `.5`, an arrow on the next line) |
| `compiler/tests/integration/engine-message-arms-pipeless-s452.test.js` | 182 | #1275 through the pipeline |
| `compiler/tests/browser/engine-message-arms-pipeless-s452.browser.test.js` | 126 | #1275 executed |
| `compiler/tests/unit/error-handler-pipeless-arms-s452.test.js` | 483 | #1276 the `!{}` twin + `E-TYPE-ARM-QUALIFIER-MISMATCH` (including the alias cases and the SKIP-if-unresolvable path) |
| `compiler/tests/unit/s34-catalog.test.js` | 52 | #1270 the §34 row parser: header-named Severity column, a trigger cell containing `\|`, a missing trailing pipe, an EMPTY Severity cell staying empty (never reading the trigger text in its place) |
| `compiler/tests/conformance/conf-TENANT-SOURCE-FILTER.test.js` | 579 | #1287 EXECUTED handlers with two seeded tenants: the C4 extraction leak, count / sum / join / serialize, `.get()` (incl. first-row-after-filter), JOIN every-source + LEFT JOIN miss, a peer callable, SSE, `acrossTenants`, and the `globalThis.Response` evasion |
| `compiler/self-host-v2/slice-m4/determinism.test.js` | 266 | #1280 §58: twice -> identical; every file-list permutation -> identical; two absolute roots -> identical with NO absolute path in any artifact or diagnostic; one diagnostic order |
| `compiler/self-host-v2/slice-m4/error-rulings.test.js` | 718 | #1274 the S451 error-model rulings on the bootstrap |
| `compiler/self-host-v2/slice-m4/severity.test.js` | 82 | #1270 the SEMANTIC check: the COMPILED `severityOf` equals §34 for every code the bootstrap names (the `--check` script only catches staleness) |

Modified in-window test files worth knowing about: `compiler/tests/integration/bootstrap-conformance-counter/`
(+ a `fixtures/codes/parse-info/` case — the Warning/Info-parse-diagnostic grading change), `unit/s441-async-escape-f4-f5`,
`unit/ast-builder-s19-error-arms`, `unit/match-arrow-alias`, `unit/sql-write-ops`, `parser-conformance-markup`,
`browser/handler-nested-server-write-s450`, `browser/handler-server-assign-order-s446`, `unit/tenant-egress`
(525 lines changed), `integration/tenant-row-isolation`, `conformance/conf-TENANT-FLOOR`, `conformance/conf-DBAUTH-M1`.

### New conformance cases (10)

`error/handler-pipeless-arms-rt` · `error/implicit-tx-explicit-transaction-block` ·
`error/transaction-control-flow-neg` · `error/transaction-control-flow-pos` · `error/transaction-nested-neg` ·
`error/transaction-non-failable-fn-neg` · `error/transaction-stmt-match-arm-fail-neg` ·
`error/transaction-top-level-neg` · `server-db/sql-transaction-exit-rollback-rt` ·
`server-db/sql-transaction-in-function-rt` (the two `server-db/*-rt` cases EXECUTE against a real database).
`error/implicit-tx-explicit-begin/NOTES.md` was updated alongside them.

### How to run the surfaces this window touched

```
bun test compiler/tests/unit/s453-async-listener-rejection-log.test.js
bun test compiler/tests/unit/transaction-in-function-body.test.js compiler/tests/integration/transaction-in-function-body.test.js
bun test compiler/tests/conformance/conf-TENANT-SOURCE-FILTER.test.js
bun test ./compiler/self-host-v2/slice-m4/            # 1115/0 here
bun conformance/run.ts                                # 1260 + 50 xfail, 0 fail (~4 min)
bun scripts/bootstrap-conformance.ts                  # live counter (~55 s); --check for staleness
```

## S451 — TEST SURFACE DELTA (`47c863556..d3e660a08`)

Test files **1,578** (+4, FACTS definition). Conformance **1300** (+12): `bun conformance/run.ts` -> 1250 pass + 50 xfail, 0 fail.
New impl#1 tests: `compiler/tests/commands/fix-s66.test.js` (971 lines), `tests/unit/db-nearest-scope.test.js`,
`tests/integration/db-nearest-scope-runtime.test.js`, `tests/unit/route-inference-trigger1-literal-blind.test.js`.
Counter fixtures: `tests/integration/bootstrap-conformance-counter/fixtures/twins/{excluded,extra-error,mapped,not-twinned,override-expect}/`.
Bootstrap slices: slice-m2 **462/0**; slice-m4 **1002/0** (+10 files: attr-case-template, defer, diag-gate, error-model,
if-chain, persist, program-shape, repeated-attr, server, show). Run: `bun test ./compiler/self-host-v2/slice-m4/`
(a bare dir arg without `./` matches no files).
New conformance cases: `control-flow/ctrl-00{1,2,3,5}-*-program-pos`, `control-flow/if-chain-program-first-true-rt`,
`persist/{counter-persist-local-pos, hold-without-persist-neg, key-required-neg, prepaint-without-persist-neg,
storage-unknown-neg}`, `server-fn/error-boundary-{request-error-twin, value-server-call-neg}`. Per-case `dialect.s66`
overrides the §66 twin the counter grades.

## S449-WRAP — TEST SURFACE DELTA (`9bafb927..47c863556`)

Test files **1,574** (+5, FACTS). Conformance **1288** cases, `bun conformance/run.ts` **1246 pass + 42 xfail, 0 fail**.

| new test | runner / root | what it pins |
|---|---|---|
| `compiler/tests/unit/sql-tx-guard-runtime.test.js` | bun test (bunfig root) | guard runtime in isolation: real Bun.SQL sqlite + fake pool; FIFO, re-entrancy, SAVEPOINT nesting, comment-proof classifier |
| `compiler/tests/integration/sql-shared-connection-tx.test.js` | bun test | compiled handlers; concurrency parked via an awaited `scrml:http get()` on a test-held server; fail → rollback |
| `compiler/tests/integration/sql-shared-connection-tx-review.test.js` | bun test | review F1/F3/F5: SSE abort mid-tx, nested savepoint + D, WS handler shape |
| `compiler/tests/integration/sql-shared-connection-tx-pg.test.js` | bun test | live local Postgres; SKIPPED unless `/var/run/postgresql/.s.PGSQL.5432` exists and `SCRML_PGTEST != "0"` |
| `compiler/tests/integration/bootstrap-conformance-counter/bootstrap-conformance-counter.test.js` | bun test | counter buckets via `--cases fixtures/`; one fixture per bucket; runtime PASS/FAIL; bite |
| `compiler/self-host-v2/slice-m4/gate.test.js` | `bun test ./compiler/self-host-v2/slice-m4/` (outside bunfig root; ci.yml bootstrap step) | §55.17.3 gate fail-closed; runs the 8 `forms/` S449 conformance cases on the bootstrap |

Updated pins: `unit/emit-server-sql-emission.test.js`, `unit/sql-batching-envelope.test.js`,
`integration/sqlite-wal-busy-timeout-defaults.test.js`, `integration/dev-db-no-side-file.test.js` (guarded-handle text);
`helpers/self-host-server-import.js` regex accepts `_scrml_db_guard(`. #1249 codemod: 335 `<let x` prefixes + 22
attribute grants across 43 bootstrap test/fixture files + 16 `conformance/cases/reactive/no-write-*` cases.

**Bootstrap slices at `47c863556` (executed):** slice-m2 **462 pass / 0 fail**, slice-m4 **551 pass / 0 fail**
(U-S450-1's 5 slice-m2 FAILs are gone).

**xfail growth:** the 8 new `forms/` cases xfail on impl#1 under carried gap `g-impl1-form-gate-surface-s449`.

**Bootstrap conformance counter (tracking, `scripts/bootstrap-conformance.ts`)** — live at `47c863556`: PASS 42
(15 vacuous) · CODES-ONLY 0 · FAIL 18 · LEGACY 951 · UNSUPPORTED 277 · CRASH 0 · INVALID 0, of 1288. Not a gate.


## S450 — TEST SURFACE DELTA (`6a592ed5c..9bafb927`)

Counts at `9bafb927`: FACTS test files **1,569** (+11 = 18 added − 7 deleted under `compiler/tests`); conformance
**1278** cases, `bun conformance/run.ts` **1244 pass + 34 xfail, 0 fail** (re-executed this pass).

**DELETED (#1240 parity suite retired):** `parser-conformance.test.js`, `parser-conformance-canary.test.js`,
`parser-conformance-within-node.test.js` + `parser-conformance-within-node-allowlist.json`,
`parser-conformance/{dual-pipeline-canary,parsers,tier-diff}.js`, `parser-conformance/live-phantom-fixture.scrml`,
`browser/each-contextual-sigil-native.browser.test.js`, `integration/m6-5-parser-workarounds-noop-under-native.test.js`,
`unit/native-attrvalue-exprnode-population.test.js`, `unit/native-exprtext-backfill.test.js`. 11 `unit/native-*` /
`m67-c*` parity tests REWRITTEN to assert on the native tree directly via NEW `tests/helpers/native-ast.js`.
**No within-node parity obligation remains for AST-field changes.**

**ADDED (`compiler/tests`):**
| file | covers |
|---|---|
| `unit/parser-flag-retired.test.js` | `--parser` exits 1 |
| `integration/session-ambient-server-refused.test.js` | E-SESSION-AMBIENT-SERVER + codegen backstop |
| `integration/auth-attr-invalid-or-dynamic-value.test.js`, `commands/s449-auth-refusal-no-dist.test.js` | E-AUTH-ATTR-INVALID; refused build writes no dist |
| `integration/session-destroy-csrf.test.js`, `integration/session-store-sqlite-defaults.test.js` | CSRF-gated destroy; WAL + busy_timeout |
| `unit/schema-tenant-union-and-like.test.js` | E-SCHEMA-014 / -015 |
| `unit/attr-multi-statement-s450.test.js` | E-ATTR-MULTI-STATEMENT |
| `browser/handler-nested-server-write-s450.browser.test.js` | nested server-call cell write awaited (#1242) |
| `unit/headless-serve-bind-host.test.js` | serve-target loopback default + `SCRML_HOST` |
| `integration/clientjs-helper-copy-into-dist.test.js`, `commands/dev-watches-copied-client-helper.test.js` | `_scrml_local/` helper copy (#1211) |
| `integration/imported-enum-match-binding.test.js` | imported-enum match binding (22 tests, #1210) |
| `unit/defer-{binder-completeness,outside-function-bodies,spec-calls,text-body-completeness,text-probe-fail-closed}.test.js` | #1208 |

**Bootstrap (`compiler/self-host-v2`, not in the FACTS count):** NEW `slice-m1/effect.runtime.test.js`,
`slice-m1/reset-on.runtime.test.js`, `slice-m4/effect.test.js`, `slice-m4/reset-on.test.js`, `slice-m4/value-positions.test.js`.
Per `self-host-v2/progress.md` (NOT re-run this pass): slice-m4 465 -> 504; slice-m2 443 pass / **5 FAIL** — five
`front.test.js` tests write from a render hole on purpose, filed `g-bootstrap-slice-m2-render-hole-write-tests-s449`.
New conformance dirs: `lifecycle/` (effect / reset-on / when-effect cases), `reactive/no-write-*`, `schema/schema-01{4,5}-*`,
`*/s450-attr-multi-statement-*`, `*/nested-server-write-awaited`.


## S447 — TEST SURFACE DELTA (`78e4ddad..6a592ed5c`)
**Test files 1,557 → 1,558 (+1, matches facts.ts).** NEW `compiler/tests/commands/dev-child-dies-with-parent.test.js`
(commands tier — advisory-only, no blocking job runs it; 2 tests, 0 fail re-executed this pass): a `scrml dev` parent
killed while/after its app child starts leaves no orphan.

**Per-process temp root (#1226) — every `bun test` from the repo root now runs under it.** `bunfig.toml` gains
`[test] preload = ["./compiler/tests/helpers/tmp-root-preload.js"]` (NEW helper). Effect for a test author:
`os.tmpdir()` / `mkdtemp(join(tmpdir(), …))` resolve under `<base>/<pid>-<rand>` (base = `SCRML_TEST_TMP_BASE` else
`${XDG_CACHE_HOME:-~/.cache}/scrml-test-tmp`), removed at run end even if the test never cleans up. The base is
deliberately outside any git repo / `scrml.toml` so tests compiling throwaway projects in tmpdir still find NO project
root. `Bun.spawn`/`Bun.spawnSync` without `env` are wrapped to inherit TMPDIR/TEMP/TMP; calls passing `env` are
untouched. The S438 `helpers/per-run-tmp.js` helper still exists alongside it.

**v1 self-host tests removed with the tree (#1230):** `integration/self-host-smoke.test.js` keeps only §A
(`stdlib/compiler/module-resolver.scrml`); §B (bs.js parity) and §C (tab.js parity) deleted. `integration/
self-compilation.test.js` keeps its `stdlib/compiler` MR/MC sections; the "Bootstrap: compiler compiles compiler"
describe (10 tests) and the skipped "Bootstrap L3" (13) are deleted. Net −31 tests in unit+integration+conformance
(27,556 → 27,525 per the change's progress log; failing-name set empty before and after). Parser-conformance corpus
root "self-host" now enumerates `compiler/self-host-v2` (`corpus-enumerator.js`, `driftGated: false`); the 11 v1 keys
left `parser-conformance-within-node-allowlist.json`; `parser-conformance-canary.test.js` inlines the cg.scrml /
`name: not` shapes it used to read from disk. The `compiler/tests/self-host/` dir holds only `README.md`.

**Bootstrap slice NEW — `compiler/self-host-v2/slice-codec/`** (outside the bunfig root; CI `gate` runs it
explicitly): `codec.test.js` + `cross-impl.test.js` (vs impl#1's wire envelope) — **92 pass / 0 fail, 18,489 expects**
re-executed at `6a592ed5c`.

**`compiler/tests/unit/protect-flow.test.js` +252** — round-8 egress shapes (rows in fields, aliased globals,
descriptor getters, coercion perf).

**Conformance 1209 cases, unchanged; `bun conformance/run.ts` 1201 pass + 8 xfail.**

## S446 — TEST SURFACE DELTA (`464c9ab4d..78e4ddad`)
**+11 test files** (1,546 → 1,557, matches facts.ts exactly): see structure.map.md for the full path list. Purpose
of each, briefly: `cli-listen-host.test.js` (unit, 44+ cases — host-flag parsing, defaults, the one-`Bun.serve`
structural scan, empirical LAN-address + `::1`-twin probes); `dev-serve-bind-host.test.js` (commands tier — the
real CLIs, loopback default + `--host`); `postfix-update-statement-boundary-s446.test.js` (unit — `@a++⏎ f()`
ASI boundary); `program-role-by-ancestor.test.js` (unit AND integration — the ancestor role model, incl. HTTP-served
cases); `schema-holes-fail-closed.test.js` (unit — the four `<schema>` tenant-floor holes closed by #1209);
`dev-db-no-side-file.test.js` (integration, grows across the #1215 rounds — drives a REAL `scrml dev` from the
project root, asserts no stray `.db` file is created and a missing referenced db fails loud); `build-sqlite-data-root.test.js`
(commands tier — `SCRML_DATA_DIR` adapter wiring + the build report); `handler-server-assign-order-s446.browser.test.js`
and `handler-stmt-list-residuals-s446.browser.test.js` (browser/happy-dom — execute-verify the #1212/#1217 handler
statement-list ordering fixes in a real DOM).

**Cross-cutting test-infra fix, #1219 (58 files, test-only, zero `compiler/src` change):** every browser-tier unit
file that directly or indirectly calls happy-dom's `GlobalRegistrator.register()` (incl. via the conformance
adapter's `run()`/`runServer()`) now ends with a root-level `afterAll` that unregisters it, restoring the saved
native `Response`/`Request`/`Headers`/`fetch`/`URL`/`setTimeout`/`window`/`document` descriptors — previously a
later file in the SAME `bun test` process silently inherited happy-dom's globals. `channel-sync-echo-dedup.test.js`
needed a descriptor-level restore (not `Object.assign`) because it leaves `window`/`document`/`location` as own
`undefined` props.

**#1220 (test-only, inert):** `conformance-xfail.test.js`'s §K assertion now expects `path.resolve("/test")`
forward-slashed instead of a hard-coded POSIX `/test`, fixing a main-windows-red the harness carried since `c12b52c2`.

**Advisory-tier note (ties to invariant 87):** both new `commands/` tier files land in a tier NO blocking job runs on
any platform (`gate`, `windows`, the installed pre-commit/pre-push all skip `compiler/tests/commands`); their unit
siblings (`cli-listen-host.test.js`) ARE in the gated tiers, so the host-binding default itself is gate-enforced even
though its CLI-level smoke tests are not.

## S445 — TEST SURFACE DELTA (`5b1d0dab0..464c9ab4d`)
- Counts at `464c9ab4d`: test files 1,546 (+11) · conformance 1200 cases (+49), `bun conformance/run.ts` 1192 pass + 8 xfail.
- NEW conformance dir `conformance/cases/body-top/` (27 cases: loose-prose / prose-after-declaration / page- / channel-prose
  rejected, `does-nothing-rejected`, `no-effect-statement-rejected`, `js-construct-*`, `declared-prose-renders`,
  `template-*-renders`, `semicolon-is-formatting`, `sql-statement-not-shipped`, `unknown-characters-rejected`, …).
- NEW `conformance/cases/lifecycle/request-*` (8: deps empty / listed / unlisted, `E-LIFECYCLE-022` pos/neg, refetch,
  client-wrapper) and `conformance/cases/protect/*` round-6 cases (`arguments-e006`, `callback-param-e006`,
  `global-store-e006`, `bare-digest-e006`, `descriptor-symbol-e006`, `symbol-description-e006`, `hmac-constant-key-e006`,
  `marker-removal-alias-e006`, `keyed-hash-clean`, `returning-strip-runtime`, `run-terminator-strip-runtime`,
  `spaced-star-strip-runtime`, `merge-rows-strip-runtime`, `assign-refresh-runtime`).
- NEW unit: `s441-declared-prose-body`, `s441-coverage-invariant`, `s441-review-fixes`, `s441-review-r4`, `s441-review-r5`,
  `request-deps-attr-s444`, `request-refetch-statement-s444`, `request-body-client-wrapper-s444`,
  `route-inference-build-root`. NEW integration: `app-root-build-relative`, `protect-error-egress`.
- Bootstrap `slice-m4/` 403 pass + 1 todo / 404 across 16 files (+5 files: `comment-escapes`, `core-additions`, `dpa045`,
  `failclosed`, `validators`); `slice-m2/` 448/448 (+`typer-s440.test.js` cases). `slice-m4/` is now in CI.
- Live-PG hooks: `PG_HOOK_TIMEOUT_MS = 120_000` passed as the hook timeout (`db-migrate-pg`, `db-authoritative-pg`,
  `db-authoritative-p2-pg`).

## S444b — TEST SURFACE DELTA (`108ca89be..5b1d0dab0`)
- `compiler/tests/integration/trucking-dispatch-smoke-integration.test.js` — `EXPECTED_BASELINE` drops
  `I-AUTH-REDIRECT-UNRESOLVED`, `W-AUTH-LOGIN-MISSING`, `W-CG-CHUNK-PREFETCH-UNRESOLVED`; `W-TYPE-031-UNPROVEN` 321 -> 287;
  the "W-AUTH-LOGIN-MISSING fires exactly once" test is gone (example 23 now sets `loginRedirect="/auth/login"`).
- `parser-conformance-within-node-allowlist.json` — regenerated (139 lines changed, same size).
- Tests pinning the S444b loci: `integration/page-auth-required-gates-page.test.js`,
  `integration/program-auth-required-gates-member-pages.test.js`, `integration/program-nested-auth-rejected.test.js`,
  `integration/static-serve-allowlist.test.js`, `integration/nested-program-worker-runtime.test.js`,
  `unit/nested-program-worker-ipc.test.js`, `conformance/cases/protect/*-e006`.

## S444 — TEST SURFACE DELTA (`cf62b415..108ca89be`)

### Bootstrap suites — measured at `108ca89be`
| command | result | files |
|---|---|---|
| `bun scripts/lint-no-default-arm.js` | 58 files, 0 violations | — |
| `bun test ./compiler/self-host-v2/slice-m1/` (and `SLICE_CORE=lowered`) | 73/73 · 73/73 | 6 |
| `bun test ./compiler/self-host-v2/slice-m2/` | **443/0** | 7 (+ `typer-s440.test.js`, the S440 typer rules) |
| `bun test ./compiler/self-host-v2/slice-m3/` | **60/0** | 5 (+ `css.test.js`, `css-half.test.js`) |
| `bun test ./compiler/self-host-v2/slice-m4/` | **130 pass + 1 todo / 131** | 11 NEW: `audit`, `engine`, `form`, `theme`, `grants`, `parse`, `sources`, `typing`, `review-r1/r2/r3` — **NOT in CI** |
Footprint grades: CG runtime 18/0 (not-yet 666, front-end 457); CSS sub-seam runtime 320/0, CSS half 38/38.
**Where a §66.19 program test goes:** `slice-m4/` (source under `slice-m4/src/`, program list in `harness.js`).
**Where a bootstrap CSS test goes:** `slice-m3/css.test.js` (emitter) / `css-half.test.js` (oracle half); oracle JSON under `slice-m3/css-oracle/`.

### `compiler/tests/` — 20 new test files (1,515 -> 1,535 per FACTS) + helper `helpers/raw-http-get.js`
| file | pins |
|---|---|
| `integration/csrf-default-under-auth.test.js` | #1161 CSRF auto default |
| `integration/ws-upgrade-origin-check.test.js` | #1161 WebSocket Origin check |
| `integration/static-serve-allowlist.test.js`, `commands/static-serve-allowlist-dev-http.test.js` | #1162 §47.13 |
| `unit/s441-async-escape-f4-f5.test.js` | #1163 |
| `unit/protect-flow.test.js`, `integration/protect-scalar-egress.test.js` | #1171 `E-PROTECT-006` |
| `integration/page-auth-required-gates-page.test.js`, `program-auth-required-gates-member-pages.test.js`, `program-nested-auth-rejected.test.js` | #1173 / #1177 |
| `integration/nested-program-worker-runtime.test.js` | #1174 worker D1/D2 |
| `integration/cell-assign-server-call-awaited.test.js` | #1158 |
| `integration/css-sub-seam.test.js` | #1149 CSS seam |
| `unit/e-error-002-handler-forms.test.js` · `fail-bare-variant-shorthand-s441.test.js` · `imported-enum-builtin-name-s443.test.js` | #1150 · #1147 · #1172 |
| `unit/html-self-close-non-void-d1.test.js` · `lint-ghost-inline-block-handler-s441.test.js` | #1160 · #1153 |
| `unit/snippet-drift.test.js` · `stdlib-source-no-logic-leak.test.js` | #1145 · #1152 |

### Conformance — 1054 -> 1151 (+97, no deletions); impl#1 1144/1151 + 7 xfail
Added by category: `protect/` 28 · `server-db/` 26 · `auth/` 18 · `error/` 18 · `server-fn/` 6 · `lifecycle/` 1.
`conformance/run.ts` +11 lines.


## S440 — TEST SURFACE DELTA (`fb21983a..cf62b415`)

### Bootstrap suites — `compiler/self-host-v2/` (outside the bunfig root: plain `bun test` never runs them)
Measured at `cf62b415` (Linux clone):
| command | result | files |
|---|---|---|
| `bun scripts/lint-no-default-arm.js` | 28 files, 0 violations, 0 opt-outs | — (the "non-first alternation arm" rule is RETIRED, #1129; a wildcard inside an alternation is still flagged) |
| `bun test ./compiler/self-host-v2/slice-m1/` | **73 pass / 0 fail** | 6 (`check`, `lint`, `runtime`, `counter.browser`, `dropdown.browser`, `valuesem.browser`) |
| `SLICE_CORE=lowered bun test ./compiler/self-host-v2/slice-m1/` | **73 pass / 0 fail** | same 6, over the Cores the M2 front end LOWERS from source |
| `bun test ./compiler/self-host-v2/slice-m2/` | **325 pass / 0 fail** (was 74 at `fb21983a`) | 6: `front` (diagnostics + S437/S440 rulings end to end in happy-dom), `parse` (FileAst shape, NodeIds, §4 invariant, CRLF-safe section-scoped §66.19 drift guard), `lower` (THE M2 PROOF: lowered == hand-built oracle modulo Sym bijection), `tables` (NEW #1122: one fact per node per family, index agrees with key column, `exprType` == first-match scan), `typer` (NEW #1117: every check family with a well-typed twin, adversarial false-fire controls, `Typing` coverage, §66.19 programs emit zero typer codes), `typer-gap` (the eleven F-A shapes, each with a twin) |
| `bun test ./compiler/self-host-v2/slice-m3/` | **24 pass / 0 fail** (NEW dir, #1118) | 3: `ingest` (impl#1 FileAST -> Core node by node for real conformance cases; not-yet discipline; every ingested Core passes `checkCore`), `footprint` (classifier graded / not-yet / front-end / crashed; end-to-end over a synthetic cases dir), `bite` (`judgeDeaths`: only a KILL certifies) |

**Where a typer / scope diagnostic test goes:** `slice-m2/typer.test.js` (a check family: negative + well-typed
twin + adversarial silent controls) or `slice-m2/typer-gap.test.js` (the F-A pins). Both use `loadM2()` +
`frontEnd(mods, files)` / `readSlice` from `slice-m2/lowered.js`; `frontEnd` returns `{ asts, typed, core, diags,
nodes, ms }` and diagnostics carry `{ code, file, span, message }`. The governing-sentence table for every typer code
is `docs/changes/s439-bootstrap-m3-typer/progress.md`.
**Where a parse / lower test goes:** `slice-m2/parse.test.js` (FileAst + parse diagnostics), `slice-m2/lower.test.js`
(Core equality via `compareCore`), `slice-m2/front.test.js` (end to end in happy-dom via `slice-m1/load-program.js`).

### Proof harnesses (NOT in CI — run by hand)
- `bun compiler/self-host-v2/slice-m1/bench/mutations.js` — applies each named mutation to a MIRROR under `.tmp/`,
  expects RED; exits non-zero if any mutation is NOT RUN (site not found exactly once) or GREEN. Covers M1 review
  items, M2 front end, the M3 typer (`TYPER` rows edit `analyze.scrml`), and six S440 mutations (F1 snapshot, F2
  narrowing, commit order/grouping/edge check, C7). Per the #1129 commit message: 77 mutations, 0 problems.
  Self-tests: `MUTATIONS_PROOF=absent` / `MUTATIONS_PROOF=harmless` must exit non-zero.
- `bun compiler/self-host-v2/slice-m3/bench/bite-matrix.js [--report <path.md>]` — certifies the footprint grade's
  construct set: per construct, corrupts a mirror of printer / runtime / ingest and re-grades the runtime passes;
  CERTIFIED only if a corruption KILLS a graded pass. Exit 0 / 1 (site not found once, or clean mirror differs) / 2.
  Last recorded: `docs/changes/s439-bootstrap-m3-ingest/bite-matrix-2026-09-27.md` — 32 CERTIFIED / 0 UNCERTIFIED.
- Footprint grade: `bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint
  [--filter s] [--only a,b] [--report p.md] [--json p]`. Re-run at `cf62b415`: runtime 18/0, codes-only 10/0,
  crashed 0, not-yet 579, front-end 447 (28 of 28 graded cases run). Codes-only passes are impl#1 front-end codes
  and never count as bootstrap evidence.

### `compiler/tests/` — 6 new files (1,509 -> 1,515 per FACTS)
| file | pins |
|---|---|
| `unit/s440-date-in-cell-and-eq.test.js` | #1137: Date/built-in in a cell renders; `_scrml_structural_eq` per built-in class; `_scrml_deep_set` refuses non-plain containers; server copy sliced from client runtime |
| `unit/s440-nested-helper-async-sync-callback.test.js` | #1139: nested async helpers awaited / lifted / failed closed (`.some`, `.sort`, direct call, block-scoped shadowing) |
| `unit/tilde-string-literal-fence.test.js` | #1131: `~` inside string / template / regex literals is not rewritten |
| `unit/code-segments-division-after-literal.test.js` | #1131 fix round: `rewriteCodeSegments` regex-vs-division sees the significant prefix |
| `unit/conformance-normalize-template-anchor.test.js` | #1118: `conformance/normalize.ts` strips impl#1's EMPTY `_scrml_scrml_(chain_)?tpl_N` anchors only |
| `commands/refusal-writes-no-dist.test.js` | #1125: E-MW-007/E-MW-008 leave the output dir untouched (absent, or byte-identical to the last good build) |

### Conformance — 1047 -> 1054 cases (impl#1 1047 pass + 7 xfail)
NEW: `auth/nested-helper-{block-shadowed-import-sort-neg,server-block-body-callback-neg,verify-password-sort-neg}`,
`server-db/nested-helper-{server-fn-some-runtime,server-fn-sort-neg,sibling-block-let-some-runtime}` (#1139),
`reactive/reset-handler-nonzero-initial` (#1118). MODIFIED: `reactive/reset-handler`, `reactive/toggle-show`
expected.json (#1118). `conformance/adapters/impl1-ts.ts` gains `setClientExecutor(executor | null)` — a hybrid whose
CG is the bootstrap installs `substitute.js` `executeClient`; `null` = impl#1's own execution.


## S438 — TEST SURFACE DELTA (`9941a504c..fb21983a`)

### `compiler/tests/` — 3 NEW files, FACTS test files **1,506 → 1,509**
- `unit/match-arm-shapes-f12-f14.test.js` — NEW (533 L): `g-impl1-match-miscompiles` F12/F13/F14 — alternation
  at any arm position, ≥5-field NAMED payload arms, brace-in-quoted-string block scoping, `E-MATCH-ALT-BINDING`
  fail-closed cases.
- `conformance/conf-SESSION-8B-DEFERS-TO-PROGRAM.test.js` — NEW (430 L): route-inference Step 8b session-field
  precedence (#1114).
- `integration/clientjs-import-disk-rebase-gate-eq-write.test.js` — NEW (222 L): client-JS relative-import
  re-basing, gate phase == write phase (#1045 F1, #1113).
- Modified (no new file): `unit/tenant-floor-raw-ddl-schema.test.js` (+650 L — the E-SCHEMA-012/013 suite),
  `conformance/conf-SESSION-PROGRAM-ATTR-SCOPE.test.js`, `unit/session-auth.test.js`,
  `unit/match-pipe-alternation-codegen.test.js`, `integration/import-host.test.js`, and 4 sqlite-backed
  integration tests updated to use the new `helpers/per-run-tmp.js` (`auth-csrf-synchronizer-token`,
  `authed-server-fn-response-http`, `csrf-canonical-delivery`, `csrf-write-path-bootstrap`,
  `db-src-runtime-path-consistency`).

### `compiler/tests/helpers/per-run-tmp.js` — NEW test helper
A per-RUN (`run-<pid>-<time>`) scratch root for integration tests importing emitted `.server.js` modules that
open `bun:sqlite` handles. **Windows-only motivation:** those handles stay open for the test process's life, so
a FIXED scratch path's `afterAll` `rmSync` throws EBUSY (reported as a hook failure) and leaves the `*.db`
behind, so the NEXT standalone run's unguarded `CREATE TABLE items` throws "table already exists" — turning
whole files red for a reason unrelated to anything under test (measured pre-fix: `authed-server-fn-response-http`
17/17 red on a second run; 4 other files red on every standalone run). `setup()` sweeps earlier runs'
leftovers best-effort (a directory still held by a live process is skipped, not fatal); `teardown()` tolerates
the held handle. Not a compiler defect — a Windows CI/local test-infra fix.

Conformance — **1047 cases, 55 dirs, FLAT** (no new case this window; the 3 new codes are unit-tested).
`bun conformance/run.ts` → **1040/1047 pass + 7 xfail** — unchanged from `9941a504c`.

### Bootstrap slices — `compiler/self-host-v2/` (M1 unchanged file set, **M2 NEW**, #1109)
Still outside the bunfig test root. Re-run this pass on this (Windows) clone:
- `bun test ./compiler/self-host-v2/slice-m1/` → **73 pass / 0 fail** across 6 files (was 68 at `9941a504c`;
  same 6 files — `check.test.js`, `lint.test.js`, `runtime.test.js`, `counter.browser.test.js`,
  `dropdown.browser.test.js`, `valuesem.browser.test.js` — content grew: a new `dropdownEarlyReadCore()` fixture
  + L12/runtime-owed-seed mutations).
- `SLICE_CORE=lowered bun test ./compiler/self-host-v2/slice-m1/` (NEW invocation, CI `gate` step) →
  **73 pass / 0 fail** — the M1 suite re-run over programs LOWERED by M2's `parse → lower`, the Fork-A proof's
  operational form.
- `bun test ./compiler/self-host-v2/slice-m2/` (NEW dir, 4 `*.test.js`) → **72 pass / 2 FAIL.** ⚠ **Both
  failures are `parse.test.js`'s "the §66.19 sources are the SPEC's code blocks, verbatim (drift guard)"**
  (`counter.scrml`; `lib/dropdown.scrml` + `app.scrml`) — comparing a fixture checked out with `\r\n` (this
  Windows clone) against a bare-`\n` extract from `compiler/SPEC.md`. **Verified as a checkout-line-ending
  artifact, not a landed defect**: the assertion is a byte-for-byte containment check with no CRLF
  normalization on either side, and nothing in the #1109 diff touches line-ending handling. Same CLASS of issue
  as the standing `scrml-regen-scripts-crlf-broken-on-windows` pattern (LF-only tooling on a CRLF checkout), a
  NEW instance of it. Not filed as a gap this pass (no source defect to point at); flag for whoever runs this
  suite next on a CRLF clone, and re-verify green on the Linux CI runner before trusting this count elsewhere.
- `bun scripts/lint-no-default-arm.js` → **26 files, 0 violations, 0 opt-outs** (was 15 at `9941a504c` — grew
  with the M2 front-end modules).

Resolves the prior ⏳ NOT-MAPPED note.


## S437b — TEST SURFACE DELTA (`d02738767..9941a504c`)

### `compiler/tests/`
- `unit/multi-statement-handler-s437-bare-sequence.test.js` — NEW (832 L, 66 `test(` calls): §5.2.3 bare-sequence rejection
  in every position, handler-block lowering at top level / `<each>` row / engine state-child / `<match>` arm, braceless
  `else`, dangling `else`.
- `unit/multi-statement-handler-b18.test.js` — updated (8 lines) for the new message / attribution.
- `parser-conformance-within-node-allowlist.json` — 10 lines changed.
- `git ls-files compiler/tests/unit` 1000 → 1001; FACTS test files 1,505 → 1,506.

### Conformance — `conformance/cases/` 973 → **1,047** (+74), 55 dirs (flat)
Added by dir: `markup-handler/` 64 (55 named `s437-*`), `control-flow/` 7 (braceless / braced-`else` + comment shapes),
`reactive/` 2, `engine/` 1; modified: `markup-handler/` 3 (the flipped xfails), `defer/` 1. Shapes: bare-sequence negatives
per position (`…-top-neg` / `-each-neg` / `-engine-neg` / `-match-neg`), dangling-`else` negatives, `try`-braced negatives,
undeclared cell/fn in statement 2, continuation shapes.
`bun conformance/run.ts` at `9941a504c` → **1040/1047 pass + 7 xfail**.

### Per-implementation `xfail` — the list at `9941a504c` (supersedes the 6-case list below)
FLIPPED TO PASS (xfail removed, gaps resolved by #1106): `markup-handler/expr-handler-call-first-multi-stmt`,
`markup-handler/inline-block-handler-call-first`, `markup-handler/inline-block-handler-in-each-row`.
Current 7:
- `each/when-changes-in-row-body` — `g-when-changes-in-each-row-body-dropped`
- `reactive/mutating-method-string-arg` — `g-mutating-method-string-args-lose-their-quotes`
- `reactive/nested-path-method-call-not-first-stmt` — `g-nested-path-method-call-dropped-when-not-first-statement`
- `reactive/s437-r5-template-cell-read-value-attr`, `reactive/s437-r5-template-cell-read-function-body`,
  `markup-handler/s437-r5-template-cell-read-second`, `markup-handler/s437-r5-template-cell-read-first-multiline` —
  `g-client-template-interpolation-lowering-needs-a-structural-emitter` (NEW, carried)

### Bootstrap slice — `compiler/self-host-v2/slice-m1/` (NEW, #1105)
Outside the bunfig test root: `bun test` alone does NOT run it. Run: `bun test ./compiler/self-host-v2/slice-m1/`
(6 files, **68 pass / 0 fail** at `9941a504c`): `check.test.js`, `lint.test.js`, `runtime.test.js`,
`counter.browser.test.js`, `dropdown.browser.test.js`, `valuesem.browser.test.js` (happy-dom via `load-program.js`).
Pattern: `harness.js` `loadBootstrap()` compiles `slice-m1/bundle.scrml` with impl#1 `compileScrml` into a temp dir and
imports it; browser tests load the printed program and drive it with `click` / `instancesOf`. `bench/mutations.js` proves
each acceptance test goes RED under its matching runtime defect. Lint: `bun scripts/lint-no-default-arm.js`
(15 files, 0 violations). All three run in the CI `gate` job (build.map.md).


⏳ NOT MAPPED: bootstrap M2 (#1109, `072741ca9`) landed on main mid-pass, after this stamp; it edits files named here (self-host-v2 modules, `slice-m1/`, `ci.yml`). Next refresh maps it.

## S437 — TEST SURFACE CHANGES (`787d4cb4..d02738767`)

### Tier counts (`git ls-files` at `d02738767`)
| dir | count | note |
|---|---|---|
| `unit/` | 985 | +31 this window (defer, class/dynamic-import reject, db-uri redaction ×4, E-ASSIGN-004 ×2, lift-body lowering, implied-lift, `conformance-xfail.test.js`, `parser-workarounds.test.js` moved in from self-host) |
| `integration/` | 228 | +8 — incl. `hybrid-stage-swap.test.js` (pins `PARSE_REENTRY_FILES`), `hybrid-xfail.test.js`, `import-host.test.js`, `scrml-compiler-import-host-bridge.test.js`, `compile-order-independence.test.js`, `sqlite-wal-busy-timeout-defaults.test.js`, `sqlite-busy-timeout-compiler-opened-handles.test.js`, `session-program-scope-multi-unit.test.js` — **outside the blocking `gate`** (runs in `tracking`) |
| `browser/` | 113 | +9 (lift-in-row/arm, lift target mount template, match-in-each-row, when-changes dep-list, engine state-child closer, …) |
| `conformance/` | 134 | +1 `conf-SESSION-PROGRAM-ATTR-SCOPE.test.js` |
| `commands/` | 18 | +1 `mw008-does-not-mask-mw007.test.js` — advisory-only tier |
| `e2e-render-map/` | 2 | now **gated** in `gate` + `windows` (S427) |
| `self-host/` | 0 | RETIRED — `ast/bs/tab.test.js` deleted, `bpp.test.js` → `unit/parser-workarounds.test.js`. Replacement: `bun scripts/hybrid.ts --swap <STAGE>=<module> --conformance` |
| ROOT · `lsp/` | 14 · 11 | flat |

New helpers: `compiler/tests/helpers/compile-artifact-digest.js`, `helpers/s430-class-import-review-probes.js`. New fixtures: `integration/fixtures/hybrid/{tab-identity,tab-spanless,tab-drop-function-decl}.js` (substitute stage modules for the seam tests), `e2e-render-map/fixtures/d6-nested-each-empty-with-data.scrml`.

### Conformance corpus — `conformance/cases/` 905 → 973 (+68), 54 → 55 dirs
New dir **`defer/`** (44 cases). Other adds: `markup-handler/` (+6 inline-block-handler cases for §5.2.3 S435 + `expr-handler-call-first-multi-stmt`), `module/` (import:host / E-IMPORT-008 cases), `ssr/`, `reactive/`, `engine/`, `fn/` (`scope-redeclare-neg` / `-nested-ok`), `lifecycle/`, `each/`, `auth/`, `control-flow/`.

### Per-implementation `xfail` (S430 P7, #1050) — `conformance/run.ts`, `conformance/README.md` §"Per-implementation expected failure"
A case whose impl#1 failure is a `status=carried` gap carries a top-level `xfail` block naming the gap AND the failure signature; a carried case that fails for a DIFFERENT reason is a real failure. `--xfail-signature <case>` prints the block. **The 6 XFAIL cases at `d02738767`:**
- `each/when-changes-in-row-body` — `g-when-changes-in-each-row-body-dropped`
- `markup-handler/expr-handler-call-first-multi-stmt` — `g-expr-handler-drops-every-statement-after-a-leading-call`
- `markup-handler/inline-block-handler-call-first` — same gap
- `markup-handler/inline-block-handler-in-each-row` — `g-each-row-event-handler-keeps-only-first-statement`
- `reactive/mutating-method-string-arg` — `g-mutating-method-string-args-lose-their-quotes`
- `reactive/nested-path-method-call-not-first-stmt` — `g-nested-path-method-call-dropped-when-not-first-statement`

⚑ **Three of the six are §5.2.3 inline-block-handler shapes**: L19's reversal is SPEC-normative and PASSES on impl#1 for the plain / multi-line / engine-state-child shapes, but a handler whose FIRST statement is a call, or one inside an `<each>` row, still drops statements on impl#1 (carried, not fixed).

### Hybrid harness tests
`integration/hybrid-stage-swap.test.js` pins the seam (incl. a NEW re-entry site cannot land unseen); `integration/hybrid-xfail.test.js` pins that impl1-ts xfail marks apply to a HYBRID (XFAIL ok · fails-differently RED · XPASS reported, not red · mark on a non-carried gap RED).

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/"` — **NO timeout key, deliberately (#537); the
per-test budget is bun's DEFAULT 5000 ms everywhere.** The old `timeout = 10000` was never read —
declare a site-level `{ timeout }` on any legitimately-slow test; per-run override is the CLI flag
`bun test --timeout <ms>`. ⚠ bun marks a TIMED-OUT test with the same `(fail) <name>` marker as an
assertion failure — the tell is the `^ this test timed out after Nms.` line after the marker)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
Browser tier ASSERTION: `bun scripts/browser-baseline.ts --check` (**not** `bun test compiler/tests/browser`)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, ⛑ **S402: 1,435** `*.test.js` total at `499eecce`, +10 this window)

⛑ **S402 — RE-DERIVED BY EXECUTION AT `499eecce`, NOT SHIFTED.** `1,425 -> 1,435 (+10)` over the
FOUR-SESSION window `10a4b045..499eecce`, by the same `find` this section mandates:

    browser 103 · commands 17 · conformance 133 · e2e-render-map 2 · integration 217 ·
    lsp 11 · self-host 4 · unit 934          = 1,421  (category dirs)
    + 14 at `compiler/tests/*.test.js` root  = 1,435

**Movement: `unit +8` · `integration +1` · `browser +1`; `commands` / `conformance` /
`e2e-render-map` / `lsp` / `self-host` and the 14 root-level files are FLAT. ZERO deletions, ninth
window running.** Cross-checked against the citable authority and it reconciles exactly:
`docs/FACTS.md` reads `test files | 1,435` and `conformance cases | 897`.

⛔ **THE HEADLINE IS WHAT DID *NOT* MOVE: `conformance/` IS `--name-only` EMPTY ACROSS ALL 36 COMMITS.**
`conformance cases` is FLAT at **897**, and 15 test files changed while **zero conformance cases did**
— including for eight `fix(codegen):` landings (#837, #840, #841, #842, #843, #845, #846). ⚠ **Every
regression guard this window lives in `compiler/tests/`, which is the tier `build.map.md`'s "WHICH
GATE RUNS WHICH TEST TIER" section warns is NOT uniformly blocking.** Before citing this window's
coverage as language-level, check which gate actually runs the file you are pointing at — the
conformance corpus is the language-1.0 gate and it did not move.

⚑ **THE LARGEST NEW FILE IS `compiler/tests/unit/file-shape-classification.test.js` (535L)**, the
guard for #859's `classifyFileShape`. ⛑ **It contains the assertion that most often surprises people
on that surface: `buildAST(...).ast.fileShape` IS `undefined` — asserted deliberately, because the
TAB computes the shape for `W-PROGRAM-001` and does NOT record it.** Anyone "fixing" that assertion
is undoing the design; see domain.map.md's file-shape section for why the stamp lives at the PRECG
seam instead.

Other notable new files this window: `unit/dpa-debt-parse.test.js` (115L, the CRLF-split guard —
build.map.md) · `unit/each-peritem-callref-operator-arg.test.js` · `unit/timer-in-if-chain-branch.test.js`
· `unit/sqlite-bool-column-coercion.test.js` · `unit/flat-css-plus-author-style-merge.test.js` ·
`unit/wdead-arrow-callback-reachability.test.js` · `unit/corpus-compile-floor-per-root.test.js` ·
`integration/shell-entry-subdir-asset-path-anchor.test.js` ·
`browser/browser-static-interp-if-branch.test.js`.

⚠ **AND THE MECHANICAL INDEX DISAGREES WITH THIS SECTION BY 14, BY DESIGN — DO NOT "RECONCILE" IT.**
`.claude/maps/test.generated.md` reports **1,421 across 12 dirs** because `mapgen.ts` walks category
directories and skips `fixtures`/`helpers`, so it never sees the **14** root-level
`compiler/tests/*.test.js`. **Re-verified this pass by execution (`ls compiler/tests/*.test.js | wc -l`
-> 14), not carried**, and `1421 + 14 = 1435` reconciles exactly.

---

### PRIOR WINDOW (S397) — carried for provenance


⛑ **S397 — RE-DERIVED BY EXECUTION AT `10a4b045`, NOT SHIFTED.** `1,424 -> 1,425 (+1)` over
`8e278c73..10a4b045`, by the same `find` this section mandates:

    browser 102 · commands 17 · conformance 133 · e2e-render-map 2 · integration 216 ·
    lsp 11 · self-host 4 · unit 926          = 1,411  (category dirs)
    + 14 at `compiler/tests/*.test.js` root  = 1,425

**The +1 is `unit +1`; every other category and the 14 root-level files are FLAT. ZERO deletions,
eighth window running.** Cross-checked against the citable authority and it reconciles exactly:
`docs/FACTS.md` reads `test files | 1,425` and `conformance cases | 897`.

⚑ **THE TWO FILES IN THE WINDOW ARE BOTH `~`/§32, AND ONE OF THEM IS A *DELETION-SHAPED* CHANGE
WORTH SEEING BEFORE YOU TRUST A GREEN SUITE ON THIS SURFACE.**

- **NEW: `compiler/tests/unit/g-bare-expr-in-if-arm-rebinds-tilde-context.test.js` (930 lines)** —
  the largest single test file added in several windows, and it is the §32.2.1 WRITE half (#830).
  ⚑ **It is a `unit` file, so it IS in the blocking `gate` job** (`gate` runs `unit` + `conformance`
  + root-level, invariant 87). Its sibling below is `integration` and is **NOT**.
- **CHANGED: `compiler/tests/integration/tilde-snapshot-codegen-fix.test.js` (+55/-11)** — #832
  flipped its assertions from *"codegen emits `null` for an orphaned `~`"* to *"codegen ERRORS"*.
  ⚠ **This tier is `integration`: NOT in `gate`, NOT in pre-commit's blocking set.** A regression
  that re-opens the fail-OPEN fallback would go red HERE and green everywhere that blocks.

⛑ **THE FOUR NEW CONFORMANCE CASES ARE THE INSTRUMENT THAT ACTUALLY GATES THIS SURFACE:**
`ctrl-025-arm-body-statement-is-side-effect-pos` · `ctrl-026-arm-body-nested-value-form-decl-pos` ·
`ctrl-027-arm-body-tilde-read-and-recovery-pos` · `ctrl-028-arm-body-tilde-read-orphan-neg`
(`893 -> 897`, all in `control-flow/`). ⚑ **`ctrl-028` is the one to read**, for two reasons that
generalise past this code:
  1. **It pins a code, its SEVERITY *and* its exact CARDINALITY** (`codeCounts: 3`), verified by
     flipping the emitter off and watching the case go red. `codes` / `notCodes` are set-valued and
     would pass on a SINGLE fire — they cannot see a pre-scan regression that resolved two of three.
  2. ⛔ **THE 3 IS AN EMISSION PROPERTY, NOT A SOURCE PROPERTY.** The emitter fires once per
     EMISSION of the offending body, so a `server fn` body (emitted as both the HTTP route handler
     and the in-process peer callable) yields 2N. The 3 holds only because every function in this
     case is client-only. **Do not copy that pin into a server-classified case.**
  3. ⚑ **Its three functions are VERBATIM from `ctrl-027`, where they were POSITIVE assertions
     until S397.** Per §62.2 the shapes were MOVED, not deleted, and `ctrl-027`'s rationale records
     which contract they used to satisfy. **A case flipping sides is the corpus working, not drift.**

⛑ **S395 — RE-DERIVED BY EXECUTION AT `ad7b65dc`, NOT SHIFTED.** `1,413 -> 1,424 (+11)` over
`2ec2ce3a..ad7b65dc`. Per-category, by the same `find` this section mandates:

    browser 102 · commands 17 · conformance 133 · e2e-render-map 2 · integration 216 ·
    lsp 11 · self-host 4 · unit 925          = 1,410  (category dirs)
    + 14 at `compiler/tests/*.test.js` root  = 1,424

**The +11 is `unit +10 · browser +1`; `commands`, `conformance`, `e2e-render-map`, `integration`,
`lsp`, `self-host` and the 14 root-level files are FLAT.** Cross-checked against the citable
authority and it reconciles exactly: `docs/FACTS.md` reads `test files | 1,424` and
`conformance cases | 891` at this watermark. ⚠ Still do not hardcode a competing number — re-run the
`find`, or cite `docs/FACTS.md`. **ZERO deletions, seventh window running.**

⚠ **THE `1,410` / `1,424` SPLIT IS NOT A DISCREPANCY AND NEVER WAS — it is the 14 root-level
`compiler/tests/*.test.js` files that belong to no category directory.** `mapgen` walks category
dirs and misses them, which is why `test.generated.md` will always read low. Name the population AND
the walk before quoting a test count.

⛑ **S391 figures below, superseded, kept for the method note:**

⛑ **S391 — RE-DERIVED BY EXECUTION AT `2ec2ce3a`, NOT SHIFTED.** `1,398 -> 1,413 (+15)` over
`0dd659a1..2ec2ce3a`. Per-category, by the same `find` the section mandates:

    browser 101 · commands 17 · conformance 133 · e2e-render-map 2 · integration 216 ·
    lsp 11 · self-host 4 · unit 915          = 1,399  (category dirs)
    + 14 at `compiler/tests/*.test.js` root  = 1,413

**The +15 is `unit +6 · browser +3 · commands +3 · integration +3`; `conformance`,
`e2e-render-map`, `lsp`, `self-host` and the 14 root-level files are FLAT.**
**CROSS-CHECKED AGAINST THE CITABLE AUTHORITY AND IT RECONCILES EXACTLY:** `docs/FACTS.md` reads
`test files | 1,413` and `conformance cases | 887` at this watermark. **Two independent instruments
(`find` here, the FACTS build there) agreeing on both figures is the strongest form this section's
claim takes — and it is why the number below is safe to quote.** ⚠ Still do not hardcode a competing
number: re-run the `find`, or cite `docs/FACTS.md`.

⚑ **CORRECTED S376 — this heading carried `1,387` while the header of this same file carried `1,394`.** Re-derived here: **1,384 across the eight category dirs + 14 at `compiler/tests/*.test.js` ROOT level = 1,398**, which is `docs/FACTS.md` exactly. **A per-directory walk misses the 14 root-level files and lands on 1,384 looking authoritative** — that is where the drift came from. Quote 1,398, or quote 1,384 and say "category dirs only".

⚑ **S376: THE PER-CATEGORY TABLE BELOW IS RE-DERIVED BY EXECUTION AT `fc6df72e`, NOT CARRIED — AND
TWO OF ITS ROWS WERE WRONG AGAINST THE PROSE IN THIS SAME SECTION.** The table read Unit **901** and
Browser **94** while the paragraph immediately above it read unit **908** and browser **95** for the
same watermark. Both table rows are now `find`-derived:

    find compiler/tests/<dir> -name '*.test.js' | wc -l

    browser 98 · commands 14 · conformance 133 · e2e-render-map 2 · integration 213 ·
    lsp 11 · self-host 4 · unit 909            = 1,384  (category dirs)
    + 14 at `compiler/tests/*.test.js` root    = 1,398  (= `docs/FACTS.md`, exactly)

**`docs/FACTS.md` reads `test files | 1,413` at the CURRENT watermark `2ec2ce3a` (⛑ S391, was
`1,398` at `fc6df72e`) and is the citable authority — do not hardcode a competing number.** The
S376 window's +4 was unit +1, browser +3; the S391 window's +15 is broken out in the block above.

**ZERO deletions, fifth window running.**

Carried: the conformance-TIER row counts `compiler/tests/conformance/*.test.js` — the artifact-level
harnesses — and is a DIFFERENT number from the 883 conformance CASES under `conformance/cases/`;
**do not reconcile them.**

| Category | Glob | Count | **Which gate runs it** |
|---|---|---|---|
| Unit | `compiler/tests/unit/**/*.test.js` | **926** | `gate` (blocking) + pre-commit + pre-push. ⛑ **CORRECTED S397 TWICE OVER, AND THE SECOND CORRECTION IS THE INSTRUMENT, NOT THE NUMBER.** (a) The count is **926** at `10a4b045` (`+1`: the NEW 930-line `g-bare-expr-in-if-arm-rebinds-tilde-context.test.js`); this cell read `925`, which was correct at `ad7b65dc` and stale here — **and it contradicted this map's own prose four screens up, which is the standing invariant-71 tell.** (b) ⚠ **THIS CELL CONTAINED AN UNESCAPED `\|` INSIDE A SHELL PIPELINE, WHICH SPLIT THE ROW INTO SIX CELLS IN A FIVE-COLUMN TABLE — so everything after it rendered in the WRONG COLUMN and the "which gate" answer was not where a reader would look for it.** Escaped now. **A markdown table cell cannot hold a raw pipe; escape it or the row silently re-columns.** The prior correction note is preserved for provenance: this cell read `909` at S396 and was wrong AT ITS OWN WATERMARK, so the `+1`/`+10` deltas recorded before that were applied to an already-drifted base — **re-derive the count, never shift it.** |
| Integration | `compiler/tests/integration/**/*.test.js` | **216** (⚑ **CORRECTED S396: read `213`**; `git ls-tree` at `ad7b65dc` also returns 216, so this was drifted at its own watermark too) | ⚠ **SPLIT — do not read this tier as simply "non-blocking".** It IS in the **pre-commit** hook (`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance compiler/tests/*.test.js --bail`, both installed and source-controlled) and in the source-controlled pre-push, so it blocks a COMMIT. It is **NOT** in the blocking cloud `gate` — in CI it runs only in `tracking` (`continue-on-error: true`). Local commit-time gate and cloud merge-time gate are DIFFERENT SETS. |
| Conformance | `compiler/tests/conformance/**/*.test.js` | **133** | `gate` (blocking) + pre-commit + pre-push. ⛑ **THIS TIER IS ALSO THE GATE FOR THE TOP-LEVEL `conformance/` CORPUS, WHICH NO WORKFLOW NAMES.** `bunfig.toml` pins `[test] root = "compiler/tests/"`, so the repo-root `conformance/` dir is outside auto-discovery; `compiler/tests/conformance/corpus-bridge.test.js` lives under the gated root and imports `loadCases` / `runCase` / `runCaseRuntime` / `hasRuntimeHalf` from `../../../conformance/run.ts`, one `test()` per case — so all **893** corpus cases ride both pre-commit and the blocking `gate`. A reviewer who greps the workflows for the corpus path finds nothing and concludes "gated nowhere"; that conclusion is wrong. See invariant 88. |
| Browser | `compiler/tests/browser/**/*.test.js` | **102** | `gate` (blocking, via the failure NAME-SET check `bun scripts/browser-baseline.ts --check`, NOT the exit code — the tier always exits 1) + `tracking`. ⚑ **CORRECTED S396: this cell read `98`, also wrong at its own watermark** — `git ls-tree` at `ad7b65dc` returns **102**. |
| Commands | `compiler/tests/commands/**/*.test.js` | **17** (re-counted by `find` this pass; the table read `14`) | ⛑ **ADVISORY-ONLY — NO BLOCKING JOB ON ANY PLATFORM RUNS THIS TIER, AND A REAL §52.13 SECURITY ASSERTION SAT RED HERE FOR AN EXTENDED PERIOD WITH NOTHING FAILING.** Not in `pre-commit` (installed hook, and `scripts/git-hooks/pre-commit:17`). Not in the blocking cloud `gate` (which runs `unit` + `conformance` + root `*.test.js`). Not in `windows` (`unit` + `conformance`, and `continue-on-error` anyway). In cloud CI it appears **exactly once**: `tracking` (`ci.yml:206`), `continue-on-error: true`. ⚠ **The pre-push clause is the one that gets stated wrongly — including in this pass's own dispatching brief.** The INSTALLED `.git/hooks/pre-push:96` DOES name `compiler/tests/commands` in a suite its own comment calls blocking; what makes it non-gating is that `RUN_SUITE` is `1` **only** on a release-tag push or a ref-diff failure, so a normal code push skips the whole suite. The SOURCE-CONTROLLED hook (`scripts/git-hooks/pre-push:87`) runs only `unit integration conformance` and never names `commands`. See invariant 87. |
| Parser-conformance + native-* | top-level `compiler/tests/*.test.js` | 14 | `gate` (blocking) + pre-commit (since S302) |
| LSP | `compiler/tests/lsp/**/*.test.js` | 11 | `tracking` only (non-blocking) |
| Self-host | `compiler/tests/self-host/` | 0 | RETIRED (S437; README only). The v1 `compiler/self-host/` tree itself was REMOVED S447 #1230. |
| e2e-render-map | `compiler/tests/e2e-render-map/` | 2 | `gate` (blocking) + `windows` (advisory) **since S427**. ⚑ **CORRECTED S427: this cell read "`tracking` only", which was WRONG, not stale** — `tracking` never named this directory; until S427 it ran in NO job and NO hook (`g-e2e-render-map-tier-runs-in-no-ci-job-at-all`). Blocking covers the tier's assertions only: the fast-slice green→red delta is WARN-only and `generate-baseline.js --check` runs nowhere. |
| *(not a test file)* | `compiler/tests/TYPES-BASELINE.json` | — | read by `bun scripts/types-gate.ts --check` (`tracking`, non-blocking) |

**ADDED THIS WINDOW — 8 files, ZERO deleted. Every one is a merge-blocker for a SILENT-WRONG defect
(clean compile, exit 0, wrong or missing output), which is why they are integration/unit and not
browser:**

| File | Tier | What it pins |
|---|---|---|
| `integration/stdlib-client-registry.test.js` | integration | **#669, 37 cases.** §41 client stdlib registry. Loads the emitted runtime + client as TWO CLASSIC SCRIPTS IN ONE SHARED SCOPE and asserts the page is not DOA — **a grep-level assertion structurally cannot see this class**; before the fix every text-level check anyone would write PASSED while the page was dead. Four sections: §1 every registered module EXECUTES with real exports · **§1b the PARTITION (client-registered XOR escalation-server-only, no third state — this is what stops the next module hiding the way 17 did; lists DERIVED from `RUNTIME_CHUNK_ORDER` + `ESCALATION_SERVER_ONLY_MODULES`, never hand-copied)** · §2 the gate FIRES for all 8 chunkless modules + a submodule · §3 the gate does NOT over-fire on a server-fn-only use (pins the post-prune placement) · **§4 INSTRUMENT INTEGRITY — feed the harness a deliberately-DOA bundle; it MUST report it, or §1 is vacuous.** ⚑ **Authored in `browser/`, MOVED to `integration/`** because `browser/` is not in the pre-commit set. Merge-blocker proof: baseline exit 0 / sabotage exit 1 (partition test + both chunk-set pins) / restore exit 0. |
| `unit/s365-asis-unknown-split.test.js` | unit | **#665.** §7.5/§14.7 `asIs`/`unknown` split + `W-TYPE-031-UNPROVEN` + the required `UnknownType.reason`. |
| `integration/each-inline-value-form-if-interp.test.js` | integration | **#670 §17.6, 5 cases, BITE-PROVEN: 3 fail pre-fix.** A value-form `${ if c { a } else { b } }` as the SOLE content of an interp inside an `<each>` body rendered an EMPTY text node at exit 0. |
| `integration/value-form-if-empty-string-branch.test.js` | integration | **#672 §17.6.** A value-form `if` branch that is the empty-string literal `""` rendered nothing — the parser's blank-token skip ate a MEANINGFUL expression statement. |
| `integration/value-form-if-fn-condition-reactive.test.js` | integration | **#673, 4 cases, BITE-PROVEN: 2 fail pre-fix** (fn-condition + else-if cascade; plus direct-read and static non-regressions). A value-form `if` whose CONDITION is a fn call was a stale one-shot. |
| `integration/each-cross-file-imported-markup-fn-mount.test.js` | integration | **#658 §1.4/§7.4.** A cross-file IMPORTED markup fn mounts in an `<each>` interp instead of stringifying. |
| `browser/each-cross-file-imported-markup-fn-mount.browser.test.js` | browser | **#658**, the executed-DOM twin. ⚠ **Browser tier — NOT in the pre-commit set.** |
| `integration/library-mode-fn-match-object-arm-lowering.test.js` | integration | **#664 §18.** A library-mode `fn` `match` object-literal arm is a returned VALUE, not silent `undefined`. |
| `integration/trucking-dispatch-smoke-integration.test.js` | integration | Corpus smoke over `examples/23-trucking-dispatch`. |

**PRIOR WINDOW (`c93a692c` -> `c96e7012`) — 5 added + 2 reworked substantially in place, ZERO deleted:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/lint-ghost-patterns-skip-cursor.test.js` | unit | **141** | **#537 — `makeSkipCursor` == `skipPastRanges` for every non-decreasing query sequence**, pinned against SEEDED-RANDOM range sets and walks, plus the `from`-offset binary-search seek. The oracle (`skipPastRanges`) stays EXPORTED with zero src callers precisely so this pin can exist — the model for replacing a hot path: keep the contract's reference implementation and equivalence-test the fast one against it. |
| `unit/dev-compile-failure-serves-error.test.js` | unit | **212** | **#518 (adopter #517)** — while the last compile is failing, `scrml dev`'s fetch handler serves the REAL compile error at every non-infra request (HTML overlay with hot-reload for `Accept: text/html`, JSON otherwise) and resumes on success. Drives the handler through both states via the EXPORTED `noteCompileResult()` — no real compile, no server. |
| `unit/each-body-decl-unsupported-positions.test.js` | unit | **95** | **#516 §17.7.3** — `E-EACH-BODY-DECL-UNSUPPORTED` fires at ANY body position (the old guard inspected `body[0]` only) and for the full name-binding decl set incl. `lin` and `~`/`var` (`var nm = 1` at a NON-first position was SILENT — the "tilde fails loud" belief held only for the first-position case). `type-decl` stays excluded (compile-time-only). |
| `unit/issue-debt.test.js` | unit | **117** | **#536** — `issue-debt.ts`'s pure `classify()`: anchored `#<n>` mention matching (`#51` ≠ `#519`; `issues/<n>` URL counts), HOMED-GAP/-DPA/-BOTH/OWED partition, the SILENT (0-comment >2-day) flag, deterministic `--now` age. No network, no fs. |
| `integration/g-tool-import-prune-dollar-prefixed.test.js` | integration | **83** | **#515 §64** — a `$`-prefixed local imported from a `.scrml` lib SURVIVES the tool import prune (the `\b` predicate judged it dead → dropped import → runtime `ReferenceError`). Pins the shared predicate `localServerImportNameUsed` at the tool site. |
| `browser/flagship-hos-engine-under-if.browser.test.js` | browser | reworked | **#531/#534/#527/#537 — the hermeticity + budget rework** (see header): `mkdtemp` unique output dir, sorted app walk, loud compile failure, artifact LOCATION by suffix search, and the whole-app compile in a `beforeAll` with an explicit 60 s site-declared budget, run before happy-dom registers. |
| `browser/browser-todomvc.test.js` | browser | reworked | **#530** — reads the runtime file the emitted PAGE references (the `<script src>` in the html), not whatever readdir returned first; same readdir-order class as flagship-hos. |

**Prior pass — 5 added + 1 grown substantially in place, ZERO deleted:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/route-inference-derived-server-only-reach.test.js` | unit | **836** (**+459 in place**, was 379) | **#500 §6.6.19 — the POSITION AXIS, and it is the model to copy when a defect is "an enumeration missed a member".** The added §9 asserts the refusal SEPARATELY in each of six shapes (`for`-lift body · `while`-lift body · `<each>` row body · `<engine>` state-child body · loop-inside-conditional · each of those inside a `kind="tool"` program, where the §64 carve-out must hold INSTEAD). **A single "it works when nested" case would have passed against the broken walk for five of the six.** It also asserts the walk's own properties directly — termination on a shared subtree, single-visit on a node reachable by two paths — **which is why the fix had to EXPORT `collectDerivedCellDecls`**: routing those assertions through `runRI` hits `collectFileLevelBindingRoots` (`:2600`, no `seen` set) and blows the stack first. |
| `unit/request-ref-is-some-each-attr-misroute.test.js` | unit | **111** | **#511 §6.7.7** — a `<#request>.data is some` predicate in a PER-ITEM `<each>` body attribute routes to `_scrml_request_<id>`, not the §36 input-state registry. **The pre-fix failure was a SILENT MISCOMPILE** — clean compile, then `undefined.data` → runtime TypeError — so the assertion has to be on the EMITTED TEXT, not on a diagnostic. Pins the gate too: a non-request `<#id>` stays byte-identical. |
| `unit/request-ref-is-some-for-lift-attr-misroute.test.js` | unit | **115** | **#512 §6.7.7** — the same predicate in a Tier-0 `${for…lift}` ATTRIBUTE. **A separate file for what looks like the same bug, and correctly so: the failure mode is the OPPOSITE.** This path failed LOUD (`E-CODEGEN-INVALID-LOGIC`, no bundle written) because the escape-hatch node took the string fallback and mangled the `is some` LHS. Same class, two mechanisms, two files. |
| `integration/timer-poll-module-init.test.js` | integration | **125** | **#510 §6.7.5/§6.7.6/§6.7.8** — a `<timer>`/`<poll>`/`<timeout>` body does NOT run at module init, and `<poll>` DOES fire an immediate first tick. **There is no diagnostic to assert here** — the correct behaviour is an ABSENCE of an emission — so this pins emitted-artifact shape. It must also assert the two EXCLUSIONS (`<request>` and `<channel>` bodies still emit), because the fix is a deny-set and a deny-set's danger is over-inclusion. |
| `integration/g-tool-over-imports-all-lib-exports.test.js` | integration | **70** | **S339 §64** — a headless `kind="tool"` importing a local `.scrml` lib emits only the specifiers its body references. Pins a CROSS-STAGE interaction (the component-expander's helper-bind augmentation vs the tool emitter) that no type binds. |
| `conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js` | conformance | **275** | **#500 §6.6.19** — the ARTIFACT-level assertion behind the position axis: for each leaking shape, that no `.server.js` is emitted and no server-only symbol reaches the client bundle. **This is the tier that would have caught the original S337 leak**; the unit tier alone asserts the diagnostic, not the artifact. |

**Two passes back — 6 added, ZERO deleted:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/route-inference-derived-server-only-reach.test.js` | unit | **379** | **#486 §6.6.19** — `E-DERIVED-SERVER-ONLY-REACH`. The largest of the six and the one to read as a model for a **newly-rejecting** code: it pins the positive fire, the shadowing negative (a local binding of the same name does NOT fire), the string-literal negative (a name inside a `"…"` is not a reference, §12.4), the `kind="tool"` carve-out, the bare-REFERENCE form (`[@x].map(hashPassword)`, not just a call), depth (lambda body / nested fn / escape-hatch raw text), and **the prescribed fix compiling clean**. |
| `unit/match-block-arm-tail-after-block-statement.test.js` | unit | **318** | **#479 §18.5** — a block-arm tail after a `}`-terminated block statement is a VALUE. `{ let a = 0; for (…) { a = 1 } a }` used to split into TWO segments and classify VOID, so the arm evaluated to `undefined` — **a value that does not exist in scrml (§42.1.1)**, with no diagnostic. **It also pins the three gates that keep the new `}` boundary from over-firing**: an object-literal / arrow initializer (`const o = { … }`) is NOT split; `} else` / `} while` / `} catch` / `} finally` are NOT split; and a brace-continuation expression (`{ … }.a`, `{ … }[0]`, `{ … } + 1`) is NOT split. |
| `unit/g-nested-each-in-match-arm-diagnostics.test.js` | unit | **232** | **#477 §6.1.1** — read-side diagnostics fire inside an `<each>` in a `<match>` arm. The arm body was BLANKED by the ast-builder (S153 double-emit avoidance), silencing `E-STATE-UNDECLARED` for the nested read **and** for a direct read merely sharing the arm. Pins the span rebase to file-absolute coordinates at depth 2. |
| `unit/request-ref-is-some-value-bool-class-attr-misroute.test.js` | unit | **200** | **#484** — `<#request>.data is some` in `value=` / a Boolean attr / `class=` / `class:x=` routes to `_scrml_request_<id>`, not the §36 input-state registry. |
| `integration/g-server-fn-reindent-template-literal.test.js` | integration | **102** | **#474 §48** — the server-fn body reindent is template-literal-aware. A blind `code.split("\n").map(l => indent + l)` corrupted the COOKED VALUE of a multi-line template literal (the added indent becomes data, not layout). |
| `unit/state-gap-integrity.test.js` | unit | **92** | **#485** — `scripts/state.ts`'s own ledger integrity: the `@gap` attribute bag matches `[\s\S]*?` so a marker whose `prov=`/`locus=` contains a literal `>` is not TRUNCATED and silently dropped from the count; duplicate `@gap` ids are deduped for counting and **THROW LOUD on conflicting sev/status**; and heading-vs-marker status drift is DETECTED (WARN-only). **A probe's own defects are in scope for the review floor — this is the test that says so.** |

**Three passes back — 2 added, 1 DELETED:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/match-block-arm-keyword-prefixed-tail.test.js` | unit | **190** | **#463 §18.5** — a block-arm tail merely PREFIXED by a statement keyword (`formatted`/`for`, `doc`/`do`, `letter`/`let`, `constant`/`const`) is a VALUE, not a statement. Pre-fix all four silently yielded `null` with no diagnostic. **It pins BOTH consumers of `_blockTailIsValueExpr`** (structured/variant-arm AND raw/literal-arm), the `on`-prefixed NO-CHANGE anchor (the one keyword that always had a fence), **the `$`-continuation anchors** (`do$…`, `on$…` — the reason the fence is `(?![A-Za-z0-9_$])` and not `\b`), and **the opposite direction**: a block whose last segment IS an assignment statement still produces void. |
| `browser/g-each-shorthand-rcdata-parent.browser.test.js` | browser | **295** | **#466 §4.14/§17.7.6** — a `:`-shorthand `<each>` body inside an RCDATA parent (`<textarea>`) must not receive a mounted element child. Browser-tier runtime assertion, paired with three conformance cases. |
| ~~`unit/show-false-ssr-hidden-no-fouc.test.js`~~ | unit | ~~197~~ | **DELETED at #464 with the code it tested.** It asserted a `display:none` the compiler no longer emits. **The disposition is the lesson: a test whose subject is REVERTED is deleted, not skipped** — a skipped test is a claim held in abeyance, and there is no abeyance here. Its replacement asserts the opposite (`ctrl-017..ctrl-020`, below). |

**Prior pass, retained for reference — the 4 files added at `97576f35`:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/mangler-region-fencing.test.js` | unit | **674** | #458 — all three mangler defects, in FIVE labelled sections, and it is the model to copy. **§1 EXECUTES the shipped `--embed-runtime` bundle** (`_scrml_replay` is invoked; pre-fence it was a `ReferenceError` on `log`) rather than grepping for a marker — the S265 execute-don't-grep rule applied to a codegen fix. **§2a tests the CLASSIFIER directly**, including that a `binding-pattern` is RECOGNISED and deliberately NOT acted on. **§2c is a NEGATIVE DEPENDENCY test** — the cross-file module-registry footer must stay `{publicName: emittedName}` and the importer's destructure verbatim. **§2f is a RESIDUAL MAP**: the shapes the fix does NOT reach (nested groups, spread, mixed `{get, post, n: 1}`, the ternary ALTERNATE) are pinned as failing-by-design in the SUITE, not merely described in prose — so the residual cannot silently drift. §2e pins the `__proto__` B.3.1 shape-preservation refusal. §3 asserts the `registerFnName` drop directly, satisfying invariant 27. |
| `integration/authed-server-fn-response-http.test.js` | integration | **764** | #452 — every server-fn route handler terminates in a `Response`, asserted **over real HTTP against a real server**, not against emitted text. Six describe blocks: `auth="required"` (including a VOID no-`return` body), `protect=` without an explicit `auth=` (**and it proves the predicate is WIDER than `auth=`** — the app has no source-level `auth=` yet still carries an auth gate), both gates together, a **no-auth CONTROL asserting the `useBaselineCsrf` path is UNCHANGED** including its double-submit `Set-Cookie`, session establishment (the sid cookie survives the envelope — the silent-drop this fix also closed), and the body-built-`Response` passthrough. That last block is exemplary: it asserts the guard is emitted AHEAD of the envelope **and** EXECUTES to prove a body's 403 is not re-emitted as 200. It also pins ORDER — "the protect= egress redact runs BEFORE serialization, never after". **CORRECTION (S355, `a7e99e8f` / #590):** this row previously said the block "pins the upstream `E-SCOPE-001` build-block" — that pin was FLIPPED in the same commit that allowlisted `Response`/`Request`/`Headers` (`type-system.ts:7290`, adopter #471). The block now asserts the shape compiles clean and the passthrough guard is LOAD-BEARING, not that it is unreachable. |
| ~~`unit/show-false-ssr-hidden-no-fouc.test.js`~~ | unit | ~~197~~ | **GONE — deleted at #464.** It pinned the #450 `show=`-false `display:none` injection; **that behaviour was reverted in full and this file no longer exists.** Do not resurrect it from this row. |
| `browser/g-each-shorthand-markup-fn-mount.browser.test.js` | browser | 152 | #456 — a `:`-shorthand `<each>` body whose child is a markup-returning fn call MOUNTS per row, asserted in the browser tier at runtime. |

**⚠ A STANDING TESTING LESSON (S326 window, #452 — a repeat of the S276 shape); read it before you
"preserve" an existing assertion.** #452's landing corrected **20 tolerate-or-assert-bare test sites
across 6 files** (`integration/auth-csrf-synchronizer-token.test.js`,
`integration/csrf-canonical-delivery.test.js`, `integration/session-establishment-roundtrip.test.js`,
`integration/session-secure-b4b5-roundtrip.test.js`, `unit/session-context-gate-b2b3.test.js`,
`unit/session-establishment.test.js`). Those sites were not neutral — **they encoded the defect as
expected behaviour, because the oracle shared the implementation's blind spot.** A green suite over
them was evidence of nothing. When a fix requires editing existing assertions, that is a signal to
check whether the assertions were ever right, not a signal to minimise the diff.

**`compiler/tests/browser/FAILURE-BASELINE.json` is unchanged AGAIN this window, and that is a CLAIM,
not an omission** — the flagship-hos rework and the todomvc fix changed HOW two browser tests obtain
their subject, not whether they pass, so the failure NAME SET did not move. (The flagship-hos name's
intermittent cloud JOINS were the #537 timeout, not a set change — see the header.)

Carried from the prior pass, still true: `unit/error-handler-const-bind-r25-bug-49.test.js` and
`integration/nested-error-handler-no-invalid-js.test.js` have an incidental blanket
`errors.toHaveLength(0)` **NARROWED to exclude exactly one code** — the known-false-positive
`E-ASYNC-STDLIB-IN-SYNC-CALLBACK` firing described in error.map.md. Every subject assertion is
untouched, and any OTHER new diagnostic still fails them.

The top-level `conformance/` corpus sits at **883** cases at `c93a692c` (`docs/FACTS.md` is the
authority; FLAT this window — zero cases added or removed). The S331-window +15 and the S341-window
+3 below are retained as reading material on case-authoring shape, not as current deltas. **54 category directories, unchanged — `derived/` is
NOT new** (it dates to the S231 D3 suite, `e86a76d0`; only three cases were added into it).
**The fifteen split as SEVEN negative, five positive-fire, three fidelity:**

| case | count | what it is |
|---|---|---|
| `sql/prepare-{server-fn,cps-return,pattern-c-cell,sse-generator,ws-onserver}-e-sql-006-neg` | 5 | **the #476 emit-path matrix, all NEGATIVE.** One per server-fn emit path, each asserting the `.prepare()` does NOT reach the artifact. **The matrix IS the fix**: the bug was a sink drained on one path and not the others, so a single case would have proved nothing. |
| `derived/e-derived-server-only-reach-pos` | 1 | **the #486 positive fire** — `codes: ["E-DERIVED-SERVER-ONLY-REACH"]` **plus `notCodes: ["E-ROUTE-005","E-ROUTE-002"]`**, discriminating it from the two codes a reader would most likely confuse it with (E-ROUTE-005 is the unplaceable single-FUNCTION shape and additionally needs a client-only DOM global). |
| `derived/e-derived-server-only-reach-neg` | 1 | the boundary — a derived RHS that does NOT reach an escalation server-only binding stays clean. |
| `derived/e-derived-server-only-reach-fn-path` | 1 | **the diagnostic's OWN prescribed fix, asserted to compile clean.** Move the call into a `function`, write the result to a plain cell. **A newly-rejecting code without a case proving its escape hatch works has shipped a dead end.** |
| `match-block/block-arm-tail-after-block-statement` | 1 | #479 — the `}`-as-separator fix (see the unit test row above). |
| `match-block/block-arm-nested-assignment-fidelity` | 1 | #479 — a nested assignment inside a block arm keeps its `opts`; no shadowing `const`, no TDZ self-reference. |
| `match-block/value-form-block-arm-all-paths` · `value-form-block-arm-derived-reactive` · `member-assign-tail-voids-all-paths` | 3 | **#469/#470 — the ALL-PATHS trio, and the reason the §18.5 four-route table exists.** `member-assign-tail-voids-all-paths` is the one to read: a member/index-assignment tail formerly LIFTED on the raw path and VOIDED on the structured path — **two routes disagreeing about the same source** — and the case asserts all paths now agree on void. |
| `lifecycle/request-data-is-some-value-bool-class-attr-rt` | 1 | #484, an **`-rt` case, so it EXECUTES** — the mis-route was a runtime `TypeError`, not a compile error, so a compile-only case could not have caught it. |
| `type-state-codes/e-state-undeclared-nested-each-in-match-arm-pos` | 1 | #477 — `E-STATE-UNDECLARED` fires inside an `<each>` in a `<match>` arm. |

**Prior window's eight, retained — the split that made the "not eight of a kind" point:**

| case | count | what it is |
|---|---|---|
| `match-block/value-decl-block-arm-keyword-prefixed-tail` | 1 | **a FIX pin** (#463) — nine `domAnchored` anchors covering both classifier consumers, the `on` no-change anchor, both `$`-continuation anchors, and the statement-tail void direction |
| `control-flow/ctrl-017..ctrl-020` | 4 | **REGRESSION GUARDS FOR A REVERT** (#464) — each asserts `count: 0` for `[style*="display:none"]` and `[style*="display: none"]`. `ctrl-017` variant-render · `ctrl-018` module-init write fail-open · `ctrl-019` spelling parity · `ctrl-020` no duplicate `style` |
| `each/shorthand-restricted-textarea` | 1 | **the #466 merge-blocker** — a `:`-shorthand body calling a MIXED-return fn inside `<textarea>`; asserts `textarea *` count 0 and `value: "alpha"` |
| `each/shorthand-longhand-parity-rcdata` | 1 | **the §4.14 byte-identity contract stated as a RUNTIME case** — the same body written FOUR ways (shorthand/bare × mixed-return-call/member-expr), all four required to agree on DOM shape |
| `each/shorthand-option-label-preserved` | 1 | **a COUNTER-GATE, and the most instructive of the eight.** It exists to FAIL if anyone re-widens the RCDATA mount refusal to `<option>` — the first #466 attempt did exactly that and replaced a correct label with `"[object HTMLElement]"`. **A case whose job is to block a plausible future "fix" is worth more than one that pins the current behaviour.** |

**Pattern worth copying: four of these eight pin the ABSENCE of behaviour.** `ctrl-017..ctrl-020`
were authored as part of a REVERT, not a feature. When you back something out, the corpus is where
you record that the back-out was intentional — otherwise the next agent reads the missing emission as
a gap and re-lands it.


## THE CONFORMANCE `expect` VOCABULARY IS NOW A DECLARED TABLE (NEW #652, `conformance/run.ts:179`)

Before this window the `expect` block's key set was implicit — a typo'd container name was silently ignored and the case passed while asserting nothing. `EXPECT_SHAPES` makes the whole vocabulary enumerable and `validateExpectContainers(ex)` refuses anything outside it, naming the known keys in the diagnostic.

| key | kind | empty | half |
|---|---|---|---|
| `codes` | stringArray | — | (a) codes |
| `notCodes` | stringArray | — | (a) codes |
| `notCodePrefixes` | stringArray | — | (a) codes |
| `severity` | record, values `error`/`warning`/`info` | **reject** | (a) codes |
| `codeCounts` | record | **reject** | (a) codes |
| `input` | objectArray | — | (b) runtime |
| `dom` | string | — | (b) runtime |
| `domAnchored` | objectArray | — | (b) runtime |
| `state` | record | **reject** | (b) runtime |
| `serverStub` | record | **allow** | (b) runtime — a MOCK TABLE, not an assertion |
| `serverDb` | record | **allow** | (b) runtime — a SEED, not an assertion |
| `sqlEngine` | enum `stub` \| `real` | — | (b) runtime |
| `ssr` | boolean | — | (b) runtime |
| `firstPaint` | record | **reject** | (b) runtime |
| `stdout` | string | — | (b) runtime |

**The `empty` column is the load-bearing one.** An empty `{}` is REJECTED for every container that is an ASSERTION (`severity`, `codeCounts`, `state`, `firstPaint`) — an empty assertion asserts nothing and reads green. It is ALLOWED only for `serverStub` and `serverDb`, which are inputs (a mock table and a seed), where empty is a meaningful value.

**`validateExpectContainers` is EXPORTED and is driven directly by `compiler/tests/conformance/expect-container-policy.test.js`** (NEW, 316 lines). The reason is written at the export site and is the window's generalisable rule: *a validator that can only be reached by running the whole corpus is indistinguishable from one that never fires.* Called from the case runner at `run.ts:418`.

⚠ **Related, and it is the standing trap when auditing conformance coverage: a grep-match for an E-code inside a case directory is NOT proof the case asserts it.** The hit may be rationale PROSE. Read the `expected.json` and confirm the code appears in a `codes` / `notCodes` container before recording "already covered".

## INSTRUMENT INTEGRITY — the `bracketed !== parsed` refusal (NEW #646/#652)

**Five gates were reporting green while measuring nothing** (#646). The fix pattern is worth copying into any new probe that parses a population out of a text file:

- `scripts/delta-lint.ts` (NEW this window) counts `[NNNN]`-bracketed lines in the live scope and separately counts regex matches. **`refuseUnparsedEntries()` / `refuseDegenerateScope()` exit 2 if the two disagree, or if the scope is empty.**
- `scripts/state.ts` gained the same guard — `refuseUnparsedDeltaEntries()` (`:706`), called from `runWrite` (`:352`), `runCheck` (`:454`) and `runDigest` (`:803`); `parseDeltaLog` (`:659`) returns `bracketed`, `unparsed` and `scopeStart` so the diagnostic can print REAL file line numbers.
- **Exit codes are partitioned on purpose: 1 = "the log is wrong", 2 = "the instrument is broken".** Neither is reachable as a PASS.
- **What made it necessary:** the shared entry shape was `[NNNN] <kind> · <body>` (three tokens) while the writing convention had drifted to `[NNNN] <emoji> <kind> · <body>` (four). The narrow regex could not parse the four-token form, so four live entries (`[561] [562] [565] [727]`) were invisible to the gate AND to the digest. The regex now carries an OPTIONAL marker token (`delta-lint.ts:72`).
- **Pre-existing debt is BASELINED, not enforced** — `handOffs/delta-log-dupes.baseline.json` carries nine known collisions so the gate is not instantly red for reasons no change caused; only a NEW duplicate fails. The baseline may shrink and must never grow silently.
- **The companion is `.gitattributes` `merge=union` on the delta log.** It trades a merge conflict for a duplicate, which is only the right trade because this gate is loud about duplicates. **The two land together; neither is sufficient alone.**
- **Deliberately NOT a monotonicity check** — under union-merge two sessions' entries interleave by content, not by number. Enforcing order would fail every honest concurrent merge.

## WHICH RUNTIME EACH TIER ACTUALLY EXECUTES — read this before believing a green runtime half

⚑ **NEW S371-bryan, PA-MEASURED AT THIS WATERMARK. EXECUTING `SCRML_RUNTIME` IS NOT TESTING WHAT
SHIPS.**

There are TWO different runtime artifacts and they are not interchangeable:

| artifact | what it is | who loads it |
|---|---|---|
| `SCRML_RUNTIME` (`compiler/src/runtime-template.js:547`) | the MONOLITHIC template string — every chunk, always | **nothing in production** |
| `scrml-runtime.<hash>.js` | the PRUNED per-app assembly — `assembleRuntime(chunkNames)` (`codegen/runtime-chunks.ts:541`) over `RUNTIME_CHUNKS` (`:467`), chunk set chosen by `detectRuntimeChunks` (`codegen/emit-client.ts:828`) | **the browser, always** |

**Tier-by-tier, measured (not inferred):**

| tier | what it executes | can it catch a chunk-pruning defect? |
|---|---|---|
| **conformance (b) half** — `conformance/adapters/impl1-ts.ts:467` and `:924` | `"(function () {\n" + SCRML_RUNTIME + "\n" + clientJs + …` — the FULL monolith | **NO. All 883 cases, by construction.** |
| **browser tier** — 94 files in `compiler/tests/browser/` | **SPLIT: 25 import `SCRML_RUNTIME`; 66 read `result.runtimeFilename` (the emitted pruned artifact); 2 do both; 5 neither** | **only the 66** |

**THE PROOF IS A SHIPPED CONFORMANCE CASE, NOT A HYPOTHETICAL.**
`conformance/cases/each/ternary-markup-giti033` compiles exit 0 and PASSES its own suite. Its
`page.client.js` contains BARE calls to `_scrml_each_clear` (`:31`, `:101`, `:159`) and
`_scrml_resolve_item` (`:46`, `:54`, `:66`, …) — both defined in the **`reconciliation`** chunk,
which is **not in the emitted runtime** for that file. First each render → `ReferenceError` → dead
page. Reproduced by compiling the case standalone and diffing the client's `_scrml_*` reference set
against the emitted runtime.

⚑ **A SYMBOL DIFF ALONE OVER-REPORTS — READ THE CALL SITE.** Two further symbols are also absent from
the pruned runtime, `_scrml_register_rehydrator` (`:213`) and `_scrml_chunk_loading` (`:220`, both
`utilities`), **and both are `typeof`-guarded at their call sites, so they are HARMLESS.** Only the
two BARE-CALL `reconciliation` symbols kill the page. A probe that counts unresolved names without
reading the call site reports 4 defects where there is 1.

**HOW TO ACTUALLY VERIFY A CLIENT-RUNTIME FEATURE** (the S265 theme-switch lesson, extended):
1. Compile the target to a real `dist/`.
2. Execute **the emitted `scrml-runtime.<hash>.js`**, not the template.
3. Assert on observed DOM/behaviour, not on the presence of a marker in emitted text.

**And when you write the claim down, name which runtime you ran.** "The runtime executed it" is not
a result — it is ambiguous between the two artifacts above, and the ambiguity has already shipped a
dead page past a green suite. primary.map.md invariant 67.

## THE BROWSER TIER IS NOW GATED — and the mechanism generalizes

**Read this before adding a tier to a gate, or before "fixing" a browser test.**

`compiler/tests/browser` carries a DOCUMENTED FAILURE BASELINE and always exits 1. The consequence
was not "we lose browser coverage" — it was worse and two-sided:
1. **A real regression was invisible**, because a tier that always fails is indistinguishable from a
   tier that has REGRESSED. That is `pa-base` §8's "a gate that has never failed is
   indistinguishable from a gate that CANNOT fail", in its purest form.
2. **A failed step HALTS the job**, so every `tracking` step AFTER the browser step was skipped.
   Verified, not assumed: on run `30742472551` the `Within-node parser-parity + canary` step reports
   `skipped` and had therefore **never run at all** — the S302 gate-hole class recurring one job over.

**The fix is to gate on the WRONG THING LESS.** `scripts/browser-baseline.ts --check` asserts the
failure **NAME SET**: exit 0 while unchanged, exit 1 the moment a name joins or leaves it. It is now
a step in BOTH the blocking `gate` and `tracking`.

- **Key = `<suite> > <test name>` and nothing else.** Timings, pass/fail COUNTS, file paths and
  bun's file ordering are deliberately stripped — each would flap red for reasons no commit caused,
  and a count moving is not information about WHICH test moved.
- **BIDIRECTIONAL.** A name JOINING is a regression. **A name LEAVING means the baseline is STALE —
  prune it in the same commit that fixes the test.** A baseline nobody prunes silently re-acquires
  the blind spot it was built to remove.
- **Baseline artifact:** `compiler/tests/browser/FAILURE-BASELINE.json` — 48 failure names + 2
  `envExcluded` entries, `recordedAt` 2026-08-02, `@generated` by `--write`.
- **Do NOT record a new baseline to make a red check green.** `--write` is for a landing that
  legitimately moves the set, in the same commit.
- **Scope is the browser tier only.** lsp / commands / self-host carry their own undocumented
  baselines and have NO name-set assertion — `g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion`
  (LOW). Extending the shape is mechanical.
- **Deliberately NOT in pre-push.** Local environments vary far more than CI, and it was exactly a
  local environment difference that made the first recorded baseline wrong.

**The two ORIGINAL gate-topology failure modes still stand** (build.map.md has the long form):
a tier that NOTHING blocking runs is where a regression hides (the 14 root-level files, fixed S302);
a blocking tier pointed at a tree with a documented failure baseline is structurally unpassable and
gets bypassed then deleted (pre-push, fixed S301). **The name-set shape is what reconciles them.**

## Coverage shapes worth knowing before writing a test here

**A grep-hit is not an assertion — and this now has a machine oracle.** A conformance case may
MENTION an E-code in `description`/`rationale` prose without asserting it; `notCodes` asserts ABSENCE
and does not prove the code can fire. **Only `expect.codes` is a positive pin**, and
`bun scripts/s34-census.ts --full` computes the pinned set that way (**343 PINNED at this watermark — this line read `338` and was stale; `--full` and the plain census return the SAME number, so the two modes have never disagreed**). Read
the `expected.json` before recording a code as covered.

**A §34 row is not evidence of a fire site, and now neither is an emitter string.** Two live shapes:
`E-CHANNEL-INSIDE-PAGE` was cataloged and never wired (S301); `E-MW-006` has a `code:` push that the
guarded shape cannot reach — **middleware is dropped silently** (ss63). Execute, or trace the caller.

**A RUNTIME-SURFACED code has no diagnostic to assert.** Three codes (`E-PARSEVARIANT-*`) are
implemented as a runtime enum VALUE, not a diagnostic push, so they appear in zero emitters while
being fully built. They were written up as the pre-freeze arc's sharpest false-claim case before the
runtime was checked. **Verify the runtime, not `result.errors`.**

**A runtime-only diagnostic cannot be asserted from `result.errors`.** `W-NAV-CHUNK-LOAD-FAILED` is
emitted by `runtime-template.js` inside the GENERATED app. Browser + conformance are its only coverage.

**Lint diagnostics are a THIRD stream.** `W-LINT-*` and the three `*-TAILWIND-*` codes return into
`lintDiagnostics[]` (the ghost-error lint pre-pass in `api.js`), not `errors[]`.

**Warning-partitioned codes need BOTH streams.** `W-`/`I-` codes with `severity:"info"|"warning"`
route to `result.warnings`; everything else to `result.errors`. `result.errors.filter(...)` alone is
the classic false-green.

**Emitted-text assertions are not execution proof — the trap has FOUR recorded occurrences now.**
S265 theme-switch, S268 component-root, GH #234, and **S307's `<engine>` audit port**, where the
registration emitted correctly and the log stayed empty because the raw cell name resolved in the
wrong chunk key space. **Only executing a transition caught it; grepping the bundle for the
registration passes either way.** Execute the bundle.

**An auto-GENERATED test artifact must not be able to report a false green.** §51.13's generator used
to emit `test("no qualifying machines", () => expect(true).toBe(true))` for an empty run — a passing
assertion verifying nothing, landing in an ADOPTER's suite as a green tick, and firing precisely for
the canonical modern `<engine>` state-child form. It is now `test.skip(...)` naming why. When you add
a generated-test path, make the empty case SKIP, never PASS.

**A structural-`if=` POSITIVE case is deliberately DOM-indistinguishable from no-`if=` at all.**
`if=true` MUST render exactly what an ungated element renders — that non-perturbation *is* the claim.
Discrimination comes from (a) the `codes` half (`notCodes: ["E-DG-002"]`) and (b) the `-absent-rt`
companion. **Write structural-gate cases in mounts/absent PAIRS with a `notCodes` on the positive
one**, or the positive case proves nothing.

**A gated `<engine>` case must exercise a transition WHILE the gate is false.** `if-on-engine-render-gate-mounts-rt`
has LOAD-BEARING input order: transition first, reveal second. An implementation that gated the
engine's CONSTRUCTION renders the `initial=` arm, and only that order catches it.

**A `-rt` suffix means the case EXECUTES** (`input` + `state` + `domAnchored` in `expected.json`).
A compile-only case cannot see a mount/unmount, hydration or teardown defect.

**A route-lifecycle test must exercise a NAVIGATION, not a mount.** The §20.8.8 contract's edges are
route-leave/route-enter, and the two are wired to nothing today. The verification the impl owes is
recorded in `docs/changes/route-region-teardown/SCOPING.md`; the single most important item there is
the NEGATIVE one — **a `<timer>` in the SHELL must SURVIVE navigation**, because the fix necessarily
touches where timers are CREATED and a misclassified shell timer silently killed by a nav is a worse
failure than the leak it closes.

**A migration/codemod test must assert the FAIL-CLOSED branch.** `scrml migrate`'s §51.9 projection
rewrite leaves the whole declaration untouched on any unparseable body line, because half-migrating a
projection silently drops mappings. Fixtures live in
`compiler/tests/commands/migrate-program-shape-fixtures/`.

**A re-parse that SWALLOWS sub-errors needs its own positive test, not just the happy path (NEW,
#396).** `ast-builder.js`'s `export` re-parse used to suppress every sub-error from its inner parse —
a top-level `E-FN-EQUALS-BODY` test would NOT have caught the exported form silently compiling to an
empty function. The fix's test coverage therefore pins BOTH shapes (top-level decl-body AND `export`)
at each of the four+one call sites, not one representative site — a lesson worth generalizing to any
future fix at a re-parse boundary.

**A choke-point CONSOLIDATION needs a regression pin proving the OLD bug classes stay fixed, not just
the new shape (#405).** `conf-CTRL-fnbody-autoawait-choke-point.test.js` exercises the unified
`injectFnBodyServerCallAwaits` across if/for/while AND `given`/match-block/`try` bodies in one file —
retiring `injectPromiseAwait` without this coverage would have re-opened `g-hash87-member-read-await-
misparen`-class regressions silently, since the retired function's bare-prefix mis-paren and its
scope-fencing were two INDEPENDENT defects a narrower test could miss one of.

**A reset-init-thunk fix needs an RT case proving `reset()` actually restores the DECLARED value, not
just that the fix compiles (#417).** `reactive/reset-init-after-assignment-rt` and its `-in-if`
sibling assert the EXECUTED post-`reset()` value (0), not merely the absence of a diagnostic — a
compile-only case cannot distinguish "clobbers the thunk" from "doesn't".

## §14.8.11 DB-authoritative tier — live-Postgres skip-graceful pattern

The three integration tests (`db-authoritative-pg`, `db-authoritative-p2-pg`, `db-migrate-pg`) and
the M1/P2 conformance pair run the ACTUAL negative test against a real Postgres — the ONLY proof that
separates real DB enforcement from an egress-JS-shaped gap (SPEC §14.8.11: "a half-shipped RLS 'looks
enforced and isn't' — worse than none"). They SKIP (not fail) when no live Postgres is reachable.
`schema-introspect-pg.test.js` originated the pattern. **Do not convert these to a mocked/in-memory
Postgres** — RLS/GRANT/SECURITY DEFINER behaviour is not faithfully mockable. Residual:
`g-dbauth-no-request-path-test` (MED) — the lock asserts EMISSION, not a login-over-HTTP round trip.
Related standing hazard: **session-auth full-bundle-over-HTTP conformance is cloud-runner-infra-flaky**
(passes local, fails cloud-only) — execute the shipped helper and assert wiring instead.

## Public-content + generated-artifact gates (NOT `bun test`, but CI-required)
`bun scripts/snippet-gate.js` — compiles every `.scrml` in the public snippet corpus
(`docs/tutorial-snippets`, `docs/readme-snippets`, `docs/website`). Proves a page COMPILES; proves
nothing about its PROSE.
`bun scripts/facts.ts --check` — fails if any generated figure in `docs/FACTS.md` is stale.
`bun run scripts/regen-spec-index.ts --check` — fails if `compiler/SPEC-INDEX.md`'s generated totals
block is stale. (Only the TOTALS are gated; the AUTHORED half is ungated and has rotted — see
non-compliance.report.md.)
`bun scripts/browser-baseline.ts --check` — **NEW, in BOTH gate and tracking.**
`bun scripts/s34-census.ts --check-new --base <ref>` — **NEW in `gate`**, the SPEC §34.0
row-provenance rule, DIFF-SCOPED so it is silent on the legacy corpus by construction.
`bun scripts/corpus-compile-floor.ts --check` — ⛑ **NEW in `gate` this window (S391), and NO MAP
CARRIED IT BEFORE THIS PASS.** An **ABSOLUTE** floor, not a differential: every shipped showcase
program (`examples/` + `benchmarks/`, `.scrml` sources, `dist`/`node_modules`/`.git` skipped) must
build on HEAD. **It exists because `corpus-emit-differential` is base-vs-head and by its HARD REQ 5
treats a compile FAILURE as DATA — so a program broken since before the baseline is invisible to it.
That is how `examples/09` sat uncompilable from S236 for months
(`g-corpus-differential-gate-blind-to-standing-breakage`).**
  · **Known-broken programs are BASELINED** in `scripts/corpus-compile-floor.baseline.json`, each
    entry naming the gap it is tracked under — same discipline as `delta-lint`'s
    `delta-log-dupes.baseline.json` and `browser-baseline`.
  · ⚑ **THE BASELINE CANNOT ROT, AND THAT IS THE DESIGN POINT: the floor ALSO fails when a
    baselined program starts compiling again, or is no longer enumerated.** A stale entry is a gate
    FAILURE, so the baseline can only shrink toward truth. It is not an allowlist.
  · **Exit codes: `0`** clean-or-known-baselined AND no stale entry · **`1`** floor breached (a
    NON-baselined program failed, OR a baseline entry is stale and must be pruned) · **`2`** NOT A
    VALID RUN — enumeration collapsed below `MIN_PROGRAMS = 25`, i.e. it **refuses to report a green
    floor over a truncated population** rather than passing quietly.
  · **EXECUTED at this watermark: exit 0, PASS, ONE baselined entry** —
    `examples/09-error-handling.scrml` `[E-ERROR-009]`, gap
    `g-fail-variant-shorthand-rejected-by-ts-context` (bare `fail .Variant` shorthand rejected since
    S236 `760e9f83`; §19.3.1 grammar vs §14.10 bare-variant rule, awaiting a bryan ruling). Its baked
    root citation `type-system.ts:10071` was RE-VERIFIED: that line is the
    `if (failEnum === "" || failVariant === "")` guard directly above the three `E-ERROR-009` emits
    at `:10074` / `:10082` / `:10089`.
`bun scripts/state.ts --check` — the `@gap` rollup; **THROWS on an unparsed marker or an unknown
status**, so it is a real gate. Its parser is exported + `import.meta.main`-gated specifically so
that guard is testable (`compiler/tests/unit/gap-marker-parser-s307.test.js`).

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking, **14 steps** — ⛑ **S391 +1: the compile-floor gate, `ci.yml:159`**; was 13 after `bun scripts/delta-lint.ts` #652): unit + conformance + the root-level `*.test.js` (**where the parser-conformance canary is actually gated**) + the TodoMVC
gauntlet compile-and-parse check + **browser NAME-SET** + snippet-gate + facts `--check` +
SPEC-INDEX totals `--check` + **§34.0 row-provenance** + **compile-floor**. Checkout is `fetch-depth: 0`
(the §34.0 gate needs merge-base).
`tracking` (non-blocking): integration + lsp + commands + **browser NAME-SET (replacing the raw run)**
+ the parser-conformance-within-node M6.x backlog. The live-PG tests run here, skip-graceful.
`windows` (non-blocking): unit + conformance on windows-latest.
Local pre-commit: unit + integration + conformance + root-level `*.test.js` (`--bail`, ~2min).
Local pre-push: unit + integration + conformance only — **NOT** the whole of `compiler/tests/` — and
**skipped entirely on a NEW-REF push** (the cloud `gate` on the PR is authority, S254). Plus gauntlet
+ fixture refresh + the ~0.3s generated-doc currency gate (+ snippet-gate on release-tag pushes only).
Verified S301 at 21597 pass / 0 fail on a clean checkout. **The hook's own comment now claims the
browser check "runs in CI `tracking` today" and that promoting it is bryan's call — bryan ruled
promote in the same window; that narration is stale, the hook's SCOPE is not.**

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/browser/FAILURE-BASELINE.json — **NEW.** The browser tier's documented failure NAME
SET. `@generated`; regenerate with `bun scripts/browser-baseline.ts --write`.
compiler/tests/commands/migrate-program-shape-fixtures/ — `scrml migrate` (source-codemod, NOT
`db-migrate`) fixture set — the `<machine>` retirement codemod's regression surface.
compiler/tests/parser-conformance-within-node-allowlist.json — per-file native-vs-live divergence
allowlist. **Adding a FIELD to a structural AST node grows this if the native mirror is not paid.**
samples/compilation-tests/ — 12 fixture dirs compiled by `scripts/compile-test-samples.sh`
(`bun run pretest`) before the suite; dist/ is gitignored. **These go STALE** — a browser-test triage
starts by recompiling them, before comparing anything.
conformance/cases/ + conformance/adapters/ — the D3 corpus (**883 cases** at `c93a692c`, FLAT this window; re-derived by `find conformance/cases -name expected.json | wc -l`, which is exactly `facts.ts`'s own definition, and `docs/FACTS.md` is the authority) + per-impl adapters. **The prior window's +3 (`each/each-body-decl-unsupported-pos`, `ssr/i-ssr-each-client-rendered-subset-pos`, `derived/e-derived-server-only-reach-nested-loop`) are landed and carried.**
docs/tutorial-snippets/ + docs/readme-snippets/ + docs/website/ — the public snippet corpus; REAL
programs under a compile gate.

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*`
or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals — EXCEPT
`db-migrate-pg.test.js`/`db-authoritative-p2-pg.test.js`, which deliberately drive `runDbMigrate` /
the CLI surface (the acceptance gate is "proven THROUGH the CLI"). Naming ties a test file to its
originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`,
`i<issue#>-<slug>`, `gh<issue#>-<slug>`, `d<N>-<slug>`, `conf-<CODE>-<milestone>`) so a diagnostic
code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow`
over mocks. A dated pattern (`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity security-fix
regressions with the root-cause narrative in a header docstring.

**Format-gated assertions.** The `esm-*.test.js` files establish the convention for the two client
module formats: assert the CLASSIC output is byte-unchanged AND assert the esm shape separately.

**DOM-shape assertions.** A top-level `<each>` renders as the comment fence
`<!--scrml-each:N-->` / `<!--/scrml-each:N-->` with rows as SIBLINGS between the anchors. An
`if=`-gated per-item root may be a `<!--scrml-if-row-->` COMMENT rather than an absent node — assert
the ELEMENT is gone, not that the child count dropped.

**A duplicate-node-id bug is invisible to every single-component test.** The S299 component-expander
defect needed TWO instantiations (or two different components) in ONE file. Anything keyed on
`node.id` — each fences, `_scrml_each_renderers`, chunk-namespace tokens — instantiate twice.

**An escalation/placement test must assert the ARTIFACT, not the diagnostic.** §12.2 Trigger 3 emits
NO code, so `result.errors`/`result.warnings` are both empty on success AND on failure. The
discriminating assertions are: does a `.server.js` exist, and is the identifier absent from the
client bundle. Copy the Trigger-3 evasion battery's shape.

**Byte-identity anti-regression.** Several landings are gated on "emits byte-identically when the
feature is not used" (the `<#`-scoped condition re-parse, the `stateChildRules` substitution, the
`serverFnPeerAliasNames` thread, D-5's client bundle, a project with no `pages/` segment under D-4).
Where that guarantee is claimed, assert it — and note one such guarantee has already been formally
RETIRED (zero-immutable-columns DB-authoritative byte-identity, S288).

**Browser-suite triage order.** Recompile `samples/compilation-tests/` fixtures FIRST (they go
stale), then compare the WHOLE suite rather than an isolated file — happy-dom global state leaks
between files, so a single-file run can be green while the suite is red, and vice versa. **Then run
`bun scripts/browser-baseline.ts` and diff NAMES**, which is the comparison a human was doing by hand —
**and READ the reason excerpt it prints beside each new name (#537): `took N ms` + `^ this test timed
out after 5000ms.` means a TIMEOUT, not an assertion failure, and the two wear the same `(fail)`
marker.**

## THE PRE-LAND GATE FOR CODEGEN — `corpus-emit-differential` (NEW #428), and it is NOT `bun test`

**If your task changes anything under `compiler/src/codegen/`, this is the gate.** It is not in
`ci.yml`, not in `bun test`, not in any git hook — it is run BY HAND, base-vs-head, before landing.
There was no routing row for this task shape before this pass and the absence cost a dispatch.

```
bun scripts/corpus-emit-differential.ts capture --compiler-root <abs checkout> \
    --label base-<sha> --work /scratch/base --manifest /scratch/base.manifest.json
bun scripts/corpus-emit-differential.ts capture --compiler-root <abs checkout> \
    --label head-<sha> --work /scratch/head --manifest /scratch/head.manifest.json
bun scripts/corpus-emit-differential.ts diff --base /scratch/base.manifest.json \
    --head /scratch/head.manifest.json [--json /scratch/diff.json]
```

Default roots `examples,samples,conformance,stdlib,benchmarks` (RECURSIVE; the 453 deliberate
exclusions are PRINTED with per-directory counts, so what is not measured is a visible decision rather
than an invisible default). Population at this HEAD: **1878 sources / 7254 artifacts.** Reported:
compile-failure delta, artifact-SET delta, artifact-CONTENT delta, syntax delta under three goggles,
and the bare-server-fn-site count. **Exit codes are three-valued and the third one is the point:**
0 = no differences; 1 = differences found; **2 = NOT A VALID COMPARISON** (different roots, an
enumeration disagreement, the same revision on both sides, differing check contexts, a
`--reuse-artifacts` manifest, or a VACUOUS run in which zero artifacts were compared). A capture NEVER
exits non-zero merely because sources failed to COMPILE — compile failure is DATA.

**Why the syntax half is a separate `node` subprocess, and why "simplifying" it re-breaks it:**
`node --check` on a bare `.js` **ACCEPTS a top-level stranded `await`** (Node resolves it by
module-syntax auto-detection and parses it as a module). **The compiler emits `<script src=…>` with NO
`type="module"`** — a CLASSIC SCRIPT, where the same bytes are a fatal SyntaxError and the whole bundle
is dead on arrival. That is the auto-await work's own dominant failure mode. **`node --check` is not
used here and must not be reintroduced.** Compounding it: **bun's `vm.Script` does not reject a
top-level `await` either**, so an in-process fix under Bun would have been a THIRD hollow gate.
`corpus-check-goggles.js` parses each artifact under BOTH goggles via `vm.Script` /
`vm.SourceTextModule` — source text and nothing else, unlike `node --check`, whose verdict is a
function of (content, extension, nearest `package.json` `"type"`), an input living OUTSIDE the artifact.
The EFFECTIVE goggle is derived from the emitted HTML's own `<script>` tag.

**The anti-pattern it exists to kill had shipped THREE times, and it reads exactly like success:** a
truncated enumeration produces no error, well-formed output, and every downstream count, ratio and
scoping decision inherits the truncation (`artifact-diff.mjs` compared 8 of 115 · `u1-corpus-emit.sh`
measured 329 of 1818 and reported "708/708 byte-identical" · that same script's `node --check` half
inherited the same population). `pa-base v2.13 §8` names it THE TRUNCATED PROBE. Every defense in the
tool is marked `HARD REQ n` at its site so a future editor can see what they would be removing.

## Tags
#scrml #map #test #which-runtime-executed #scrml-runtime-vs-template #chunk-pruning #conformance-blind-spot #ternary-markup-giti033 #reconciliation-chunk #types-baseline #stdlib-client-registry #instrument-integrity #test-tier-vs-merge-gate #bite-proof #recursive-recount #bun-test #happy-dom #playwright #conformance #ci-gate #browser-baseline #failure-name-set #bidirectional-baseline #failure-baseline-json #skipped-step-behind-red-step #gate-topology #gate-hole #non-blocking-tier #documented-failure-baseline #cry-wolf #s34-census #expect-codes-only #pin-vs-mention #runtime-surfaced #e-mw-006-dead #e-channel-inside-page #execute-dont-grep #vacuous-test-skip #generated-test-artifact #property-tests #§51.13 #engine-audit #route-region #§20.8.8 #shell-timer-non-regression #migrate-codemod #fail-closed-codemod #rt-suffix #mounts-absent-pairs #not-codes-discrimination #structural-if #§17.1.2 #lint-diagnostics-stream #dbauth #live-pg-skip-graceful #cloud-ci-http-flaky #snippet-gate #facts-gate #spec-index-gate #§34.0 #gap-marker-parser #proven-gate #new-ref-push-skip #changelog-dereferenced #facts-md-authority #e-fn-equals-body #reparse-swallowed-errors #subparse-span-rebase #match-arm-autoawait #crossmodule-async-markup #conformance-855 #cps-choke-point-landed #w-if-in-each #corpus-emit-differential #corpus-check-goggles #pre-land-gate #codegen-task-shape #dual-goggle #node-check-blind-to-tla #bun-vm-script-blind #truncated-probe #hard-req-markers #1878-sources #7254-artifacts #exit-code-2-invalid-comparison #self-retiring-guard #async-name-provider #u1-browser-runtime-test #execute-dont-grep #failure-baseline-unchanged-is-a-claim #narrowed-blanket-assertion #reset-init-thunk-reassignment #each-nested-if-not-reactive #mangler-region-fencing #execute-dont-grep #residual-map-in-suite #negative-dependency-test #authed-server-fn-response-http #real-http-assertion #oracle-shared-the-blind-spot #s276-shape #tolerate-or-assert-bare #show-false-ssr-REVERTED #ctrl-017-020-revert-guard #counter-gate-case #test-deleted-with-reverted-code #keyword-prefixed-tail #rcdata-restricted-parent #880-conformance #1334-tests #neg-case-is-the-assertion #escape-hatch-case #prescribed-fix-compiles-clean #emit-path-matrix #e-sql-006-neg-matrix #all-paths-trio #member-assign-tail-voids #two-routes-disagreeing #§18.5-four-routes #expected-json-is-the-assertion #rationale-prose-is-not #derived-dir-not-new #probe-defects-in-scope #state-gap-integrity #1339-tests #883-conformance #position-axis #enumeration-missed-a-member #export-for-testability #cannot-isolate-the-subject #collect-file-level-binding-roots-no-seen-set #same-class-opposite-failure-modes #silent-miscompile-vs-fail-loud #assert-emitted-text-not-a-diagnostic #absence-of-emission-has-no-code #deny-set-danger-is-over-inclusion #artifact-tier-catches-the-leak #facts-counts-only-test-js #1361-is-not-a-contradiction #conformance-tier-vs-conformance-cases #read-the-expected-json #notcodeprefixes #1378-tests #expect-shapes #validate-expect-containers #expect-vocabulary #empty-assertion-rejected #serverstub-is-input #instrument-integrity #bracketed-vs-parsed #refuse-unparsed-entries #refuse-degenerate-scope #exit-2-instrument-broken #delta-lint #delta-log-baseline #merge-union-gitattributes #optional-marker-token #grep-match-is-not-assertion #invariant-56-timeout #seven-new-merge-blockers #bite-proven #declaration-form-parameterised #pinned-343 #spacing-agnostic-assertion #field-presence-not-byte-layout #1398-tests #category-dirs-plus-root-level #browser-tier-not-in-pre-commit #state-block-statement-form-suite #known-open-pinned-not-endorsed #s437b #9941a504c #conformance-1047 #xfail-7 #slice-m1-tests #s440 #cf62b415 #slice-m3 #footprint-grade #bite-matrix #mutation-harness #typer-tests #s447 #6a592ed5c #self-host-v1-removed #test-tmp-root #protect-egress-r8 #s450 #9bafb927 #native-parser-frozen #parser-flag-retired #session-ambient-server #auth-attr-invalid #s452-wrap #7ce905ac2 #tenant-sql-subset #e-tenant-sql-subset #arm-pipe #w-arm-pipe-legacy-impl1 #effect-summary #dpa-066
#ctrl-025-028 #tilde-accumulator #codecounts-is-an-emission-property #neg-case-pins-cardinality #case-flipped-sides #integration-tier-is-not-gated #1425-tests #897-conformance
#1436-tests #897-conformance-flat #normative-widening-zero-conformance-cases #template-literal-classification-suite #unit-pin-is-not-a-conformance-pin
#s405 #1440-tests #905-conformance #54-category-dirs #root-level-test-files-14 #mapgen-keys-on-first-subdir #definition-boundary-not-stale-figure #conformance-corpus-bridge-outside #engine-statechild-prose-punctuation #already-broken-upstream-pinned #mechanical-seam-test #mediation-marked #the-split-describe-block #protect-case-dir-10 #zero-over-an-unexercised-path #unloweredscrmlsyntax #emitted-bytes-gate #test-generated-regenerated
#s437 #d02738767 #1505-tests #973-cases #defer-cases #xfail #status-carried #self-host-tests-retired #hybrid-stage-swap-test #e2e-render-map-gated #inline-block-handler-xfail

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [migrations.map.md](./migrations.map.md)
- [dependencies.map.md](./dependencies.map.md)
