# dependencies.map.md
# project: scrml
# updated: 2026-10-05T22:22:59-06:00  commit: 9c556dc74
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
# ━━━━━━━ BELOW (TO THE FIRST `##` SECTION) IS THE S453 HEADER (stamp `fd2f757d0`), CARRIED. THIS MAP SKIPPED THE S452-WRAP
# PASS; that window (`fd2f757d0..7ce905ac2`) is covered by this map's `## S454` section and by the S452-WRAP header in primary.map.md. ━━━━━━━
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
# ━━━━━━━ S437 DEPENDENCIES DELTA ━━━━━━━
# `git diff 787d4cb4..HEAD -- package.json` -> ONE line: `"version": "0.7.1"` -> `"0.8.0"` (#1099). No dependency,
# devDependency, script, `engines` or `files` change; `bun.lock` `--name-only` EMPTY. External deps: SIXTH consecutive
# flat window. The INTERNAL graph moved: 16 new `compiler/src` modules — edges in `## S437 — INTERNAL EDGES` below.
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
# ━━━━━━━ S422 DEPENDENCY DELTA — **ZERO. FIFTH CONSECUTIVE WINDOW.** ━━━━━━━
#
# ⛑ **`git diff --name-only e74f5423..787d4cb4 -- package.json bun.lock bunfig.toml` -> EMPTY**,
# across **112 commits**. No runtime or dev dependency was added, removed, or version-bumped.
# Version stays **v0.7.1**; `engines.bun` stays **>=1.3.13**. This is the **fifth consecutive window**
# with an empty manifest diff.
# ⚑ **THAT IS A DELIBERATE PROPERTY OF THIS PROJECT, NOT AN ACCIDENT OF A QUIET WINDOW.** +1,195 lines
# of compiler source and a new blocking CI gate landed with no new dependency: `conflict-marker-gate.ts`
# shells out via `node:child_process` `execFileSync` rather than pulling a git library. **When adding
# code here, the default is the Bun/Node built-in, not a package.**
#
# ⚠ **THE INTERNAL MODULE GRAPH DID MOVE, AND THAT IS WHAT THIS MAP SHOULD BE READ FOR THIS WINDOW.**
# One genuinely new internal edge, and it exists specifically to kill a duplicated invariant:
#   **`compiler/src/tokenizer.ts` -> `compiler/src/codegen/code-segments.ts`**
#   (`tokenizer.ts:62`: `import { REGEX_AFTER_CLOSE_PAREN_KEYWORDS } from "./codegen/code-segments.ts"`).
#   ⚑ **A TOKENIZER IMPORTING FROM `codegen/` IS A DIRECTION-OF-DEPENDENCY SURPRISE** — it is
#   deliberate: `code-segments.ts` owns the single shared vocabulary of control-flow heads after whose
#   `)` a regex literal may start, so `tokenizer.ts`'s `closesControlFlowHead` (`:1573`) and codegen's
#   `regexAllowedAfter` cannot drift. Do not "clean this up" by re-hand-spelling the set in the tokenizer.
# Reinforced (pre-existing) edge:
#   **`compiler/src/codegen/emit-control-flow.ts` -> `compiler/src/codegen/emit-logic.ts`** — now also
#   importing `blockScopedDeclaredNames` alongside `emitLogicNode`, `emitLogicBody`, `planBlockArmLift`,
#   `_awaitMatchArmServerCalls`, `_matchArmResultIsBlockBody`, `_blockTailIsValueExpr`,
#   `_objectLiteralArmFromStructuredBody` (`emit-control-flow.ts:3`).
#
# ⚑ **`compiler/src/codegen/emit-library.ts` TOOK +400 LINES — A THIRD OF THE WHOLE `compiler/src`
# DELTA — WITHOUT GAINING AN IMPORT.** Its new machinery (`unloweredMapSurfaceReads` `:262`,
# `blankStringLiteralContent` `:329`, `containsIndexExpr` `:148`, `MAP_RUNTIME_PROVIDED_NAMES` `:89`,
# `MAP_RUNTIME_REFERENCED` `:100`, `MAP_SET_SURFACE_METHODS` `:117`) is entirely module-private.
# **Module-graph maps are blind to this class of change by construction.**
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
# ━━━━━━━ S405 wrap-6c — **EXTERNAL DEPS ZERO-DIFF (SIXTH CONSECUTIVE WINDOW). THE *INTERNAL* GRAPH MOVED.** ━━━━━━━
#
# ⛑ **THE ZERO IS A COMMAND, RE-RUN, NOT A MEMORY:** `git diff --name-only 68cfac6d..e74f5423 --
# package.json bun.lock` -> **EMPTY**. No runtime or dev dependency added, removed or version-bumped;
# `v0.7.1` unchanged; the `files` allowlist unchanged. ⚠ A zero-diff surface is an UNCHANGED map, not
# a correct one.
#
# ⛔ **BUT THE INTERNAL MODULE GRAPH *DID* MOVE, AND THE NEW EDGES ENCODE AN INVARIANT WITH A STATED
# REASON — THIS IS THE PART A DEV AGENT NEEDS.** #900 made `compiler/src/schema-differ.js` the home of
# **THE ONE `CREATE TABLE` RECOGNIZER**, and two modules gained an edge INTO it:
#
#   `compiler/src/protect-analyzer.ts`      → `./schema-differ.js`   **(NEW #900 — it DELETED its own
#                                                                     `CREATE_TABLE_RE`, `:65-77`)**
#   `compiler/src/gauntlet-phase1-checks.js` → `./schema-differ.js`   **(NEW #900, `:69-80`)**
#
# ⛑ **THE DIRECTION IS FORCED, NOT STYLISTIC, AND BOTH FILES SAY SO AT THEIR IMPORT SITE.**
# `schema-differ.js` imports **only** `./codegen/sql-ident.ts` — one edge, no I/O — **so a consumer is
# not forced to pull `protect-analyzer.ts`, and with it `bun:sqlite` + `node:fs`, just to ask what
# counts as a table declaration.** That is the MIRROR of `protect-analyzer.ts:631`'s own long-standing
# note that the early PA stage deliberately does not pull a codegen module. **Putting the recognizer
# in `protect-analyzer.ts` would have inverted a layering invariant to save one import.**
#
# ⚑ **THE FULL `schema-differ.js` FAN-IN AT THIS WATERMARK** (from the regenerated
# `dependencies.generated.md`): `channel-watches.ts` · `codegen/bool-coerce.ts` ·
# `codegen/db-authoritative.ts` · `codegen/index.ts` · `commands/db-migrate.js` ·
# `commands/introspect.js` · `gauntlet-phase1-checks.js` **(NEW)** · `protect-analyzer.ts` **(NEW)**.
# **Eight consumers, one recognizer.** ⚠ **THAT FAN-IN IS THE WHOLE POINT AND ALSO THE WHOLE RISK: a
# change to the recognizer's boundary is a change to two security floors, a migration planner and an
# introspector at once.**
#
# ⚑ **THE PROTECT/TENANT SUB-GRAPH, RE-READ AT THIS WATERMARK:**
#   `codegen/protect-egress.ts` → `../sql-projection.ts` **+ `acorn`** (NEW #896 — it now parses
#      already-lowered server JS for the `E-PROTECT-005` detector; the import carries an `@ts-ignore`
#      with a stated precedent: `expression-parser.ts`, `validate-emit.ts`, `egress-field-scan.ts`
#      import acorn untyped for the same reason)
#   `codegen/tenant-egress.ts`  → `../sql-projection.ts` · `./protect-egress.ts`
#   `codegen/db-authoritative.ts` → `../schema-differ.js`
#   `codegen/emit-server.ts`    → … `./db-authoritative.ts` · `./protect-egress.ts` · `./tenant-egress.ts`
#   `codegen/rewrite.ts`        → … `./protect-egress.ts` · `./tenant-egress.ts`
#   `commands/db-migrate.js`    → … `../codegen/db-authoritative.ts` · `../schema-differ.js`
# ⛔ **NOTE THE SHAPE: `db-authoritative.ts` IS THE SINGLE PRODUCER OF `extractDesiredSchema` AND IT
# HAS TWO CONSUMERS ON OPPOSITE SIDES OF THE GRAPH** — `codegen/emit-server.ts` (the §14.8.10 tenant
# floor, which WANTS raw-DDL tables) and `commands/db-migrate.js` (which must NOT have them, and
# declines in one line at `db-migrate.js:244`). **A graph edge alone does not tell you a consumer's
# polarity; this one is a case where two consumers of the same export need opposite subsets.**
#
# ⚑ **`dependencies.generated.md` WAS REGENERATED THIS PASS** (`bun scripts/mapgen.ts --kind deps`) —
# it had been stamped `2026-09-06 16:32`. It now reads **195 files · 701 local import edges**. It is
# `@generated`: do not hand-edit.
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
# ⛑ **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF — FIFTH CONSECUTIVE WINDOW WITH NO EXTERNAL-DEPENDENCY
# CHANGE.** Command that produced the zero: `git diff --name-only 499eecce..68cfac6d -- package.json
# bun.lock` -> **EMPTY**. No `dependencies` / `devDependencies` entry was added, removed or re-ranged.
#
# ⚑ **THE INTERNAL GRAPH DID GAIN EDGES, AND THEY ARE ALL OUTBOUND FROM ONE NEW FILE.**
# `scripts/int-number-census.ts` (NEW, #875) imports `runBlockSplitter` / `runTAB` /
# `buildTypeRegistry` / `resolveTypeExpr` / `parseStructBody` from `compiler/src/type-system.ts` and
# `parseSchemaBlock` from `compiler/src/schema-differ.js`. **Nothing in `compiler/src` imports it** —
# it is a leaf consumer, not a new pipeline stage. ⚠ A zero-diff on `package.json` says nothing about
# the internal graph; these two are separate questions and this row answers both.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# ⚠ **THE WINDOW IS FOUR SESSIONS WIDE, NOT ONE** — `10a4b045..499eecce` is **36 commits, PRs
# #835-#872** (S399 · S400 · S400-peter · S401 · S402). The prior stamp is 4 sessions behind because
# S398-S401 did not fire a wrap-6c. Per-file attribution is in `primary.map.md`'s header.
#
# **THIS MAP:** **NO EXTERNAL-DEPENDENCY CHANGE for the FOURTH consecutive window** — `bun.lock` is `--name-only` EMPTY and no `dependencies`/`devDependencies` entry was added, removed or re-ranged. ⚠ `package.json` itself DID change (`scripts.bench`); see config.map.md. Internal graph re-walked: **699 local import edges (+24) over 195 files**. The NEW edges are all #859: `compute-pgo-flags.ts -> library-shape.js`, `component-expander.ts -> library-shape.js`, `codegen/index.ts -> library-shape.js`, `library-shape.js -> types/ast.ts` (the `FILE_SHAPES` re-export), plus `ast-builder.js` / `api.js` / `tool-program.ts` switching their `library-shape.js` import from `isForeignLangLibDecl` to `classifyFileShape`.
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
# **ONE NEW INTERNAL EDGE THIS WINDOW, AND IT IS SECURITY-BEARING.** `compiler/src/route-inference.ts`
# now imports `ifChainChildNodes` from `./ast-if-chain.js` (`:92`) — the module that was previously
# consumed only by `codegen/` and `src/` walkers now has the ROUTE-INFERENCE walk on it too (#818).
# `codegen/collect.ts` already imported it (`:14`) for `collectTopLevelLogicStatements`; #818 added the
# second call site in `collectFunctions`. No external dependency changed: `package.json` is untouched
# in this window.
#

## S455 — DEPENDENCY DELTA (`f38697900..9c556dc74`, from import statements at `9c556dc74`)

No `package.json` change. `acorn` (already a runtime dep, `^8.16.0`) gains two importers: `codegen/foreign-seal.ts` and `commands/fix-client-server-call.js`.

New internal edges:
- `api.js` -> `tenant-schema-hazards.ts` (`fileTenantSchemaHazards`), `codegen/tenant-egress.ts` (`compilationTenantSet`)
- `tenant-schema-hazards.ts` -> `codegen/tenant-sql-subset.ts`, `schema-differ.js` (`schemaTableDeclarations`, `DBAUTH_ROLE`)
- `codegen/tenant-egress.ts` -> `tenant-schema-hazards.ts` (`fileSchemaTenantNames`, `compilationSchemaColumns`, `schemaColumnKnowledge`, `tenantQueryQualifiedRefIssue`) — no cycle (`tenant-schema-hazards.ts` imports `tenant-sql-subset.ts`, not `tenant-egress.ts`)
- `batch-planner.ts` -> `hoist-sql-shape.ts`
- `codegen/{emit-logic,emit-server,emit-library,emit-tool,protect-flow}.ts` -> `codegen/foreign-seal.ts`
- `codegen/sql-attempt.ts` <- 16 importers (`body-dg-builder`, `dependency-graph`, `meta-checker`, `monotonicity-analyzer`, `route-inference`, `type-system`, `codegen/{collect,emit-control-flow,emit-expr,emit-functions,emit-library,emit-logic,emit-server,emit-tool,protect-flow,scheduling}`)
- `commands/fix-s66.js` -> `commands/fix-client-server-call.js`, `commands/fix-sql-failable.js`; `fix-sql-failable.js` -> `fix-client-server-call.js` (shared `skipBalanced` / `scratchProject` / `compileWithRI` / `promiseAllBatches`), `block-splitter.js`, `ast-builder.js`, `expression-parser.ts`; `fix-client-server-call.js` -> `api.js`, `route-inference.ts`, `expression-parser.ts`, `acorn`
- `scripts/bootstrap-conformance.ts`: `TWIN_RULES` now excludes `client-server-call` and `sql-failable` (with `arm-pipe`)

## S454 — DEPENDENCY DELTA (`fd2f757d0..f38697900`, two windows: S452-WRAP `fd2f757d0..7ce905ac2` + S454 `7ce905ac2..f38697900`; from import statements at `f38697900`)

**npm:** zero change in both windows (`package.json` untouched; the only manifest-adjacent edit is `.pa-base/profile`).

**Internal edges added:**
| from | -> to | window / PR |
|---|---|---|
| `codegen/tenant-egress.ts` | -> `codegen/tenant-sql-subset.ts` (:65) | S452-WRAP #1293 |
| `codegen/tenant-sql-subset.ts` | -> `codegen/sql-lex.ts` (`liveSqlInterpolations`) | S452-WRAP #1293 |
| `commands/fix-arm-pipe.js` | -> `block-splitter.js`, `ast-builder.js`, `expression-parser.ts`, `engine-statechild-parser.ts`, `component-expander.ts`, `tokenizer.ts`, `api.js` (`compileScrml`, verify-by-compile) | S452-WRAP #1285 |
| `commands/fix-s66.js` | -> `commands/fix-arm-pipe.js` | S452-WRAP #1285 |
| `api.js` | -> `validators/reserved-prefix.ts` (:78) | S454 #1301 |
| `validators/reserved-prefix.ts` | -> `tokenizer.ts`, `expression-parser.ts` (`tokenizeTemplateInterpolations`), `engine-statechild-parser.ts`, `match-statechild-parser.ts`, `component-expander.ts`, `block-splitter.js`, `ast-builder.js`, `module-resolver.js` (`isStdlibSourceFile`) | S454 #1301 |
| `codegen/emit-variant-guard.ts` | -> `codegen/js-async-analysis.ts` (:98, `colorActiveHandler`, `activeHandlerStatementListColor`) | S454 #1296 |
| `codegen/sql-attempt.ts` | <- `emit-logic.ts` :23, `emit-expr.ts` :52, `emit-control-flow.ts` :14, `emit-server.ts` :15, `emit-tool.ts` :50, `emit-library.ts` :24, `type-system.ts` :79 | S454 #1305 |
| `codegen/emit-logic.ts` | -> `ast-builder.js` (`parseGuardArmsFromRaw`, :24) | S454 #1305 |
| `codegen/emit-expr.ts` | -> `codegen/emit-logic.js` (`emitSqlQueryShape`, `emitNestedGuardExpr`, :53) | S454 #1305 |

⚠ **NEW IMPORT CYCLE (#1305): `emit-expr.ts` <-> `emit-logic.ts`.** `emit-logic.ts:6` already imported `emitExpr`
and friends from `./emit-expr.ts`; `emit-expr.ts:53` now imports back from `./emit-logic.js` (a `.js` specifier
resolving to the `.ts` file). Both imported names are functions called at emit time, so ES-module live bindings
make it work today; a module-top-level USE of either name in either file would hit a TDZ at load.

`type-system.ts` now imports from `codegen/sql-attempt.ts` — a type-checker -> codegen-module edge (constants and
the `sqlQueryExprShape` reader only).

## S453 — DEPENDENCY DELTA (`d3e660a08..fd2f757d0`)

**ZERO npm changes.** `package.json` `dependencies` / `devDependencies` are byte-identical across the window
(`git diff d3e660a08..HEAD -- package.json` is EMPTY). No new third-party package, no version bump, no removal.
`js-async-analysis.ts` adds no import — it reaches acorn through the module's existing `tryParse`.

New / newly-load-bearing INTERNAL edges, grep-verified:

| from | to | edge |
|---|---|---|
| `compiler/src/api.js` :76 | `validators/lint-transaction.ts` | `runTransactionChecks`, run at `api.js:1946` as the `TRANSACTION-CHECKS` stage (#1286) |
| `codegen/emit-event-wiring.ts` :23 | `codegen/js-async-analysis.ts` | pre-existing — `colorAsyncFunctionExpr`, `unanalyzableHandlerUses`, `handlerStatementListColor`, **`type ColorOpts`**; now also passes `ColorOpts.boundaryId` (#1283) |
| `codegen/emit-each.ts` :40, `codegen/emit-lift.js` :2 | `codegen/js-async-analysis.ts` | pre-existing — `colorActiveHandler`, `activeHandlerStatementListColor`; 14 call sites now pass `boundaryId` (#1283) |
| `codegen/rewrite.ts`, `codegen/emit-logic.ts`, `codegen/emit-server.ts`, `codegen/emit-tool.ts`, `sql-projection.ts` | `codegen/tenant-egress.ts` | `resolveTenantScoping`, `wrapWithTenantScope`, `tenantRequestScopeLines`, `TENANT_KEY_ALIAS_PREFIX`, `SERVER_TENANT_HELPER` (#1287). `rewrite.ts` reads the ambient tenant from the per-request store, NOT a lexical binding (`rewrite.ts:45`) |
| `scripts/s34-census.ts`, `scripts/gen-bootstrap-severity.ts` | `scripts/s34-catalog.ts` | the ONE §34 catalog parser (#1270) — neither script re-parses §34, so the census and the bootstrap table cannot read the catalog differently |
| `compiler/self-host-v2/ast.scrml` :27 | `compiler/self-host-v2/severity.scrml` | `import { Severity, severityOf }`; `newDiag` :309 sets `severity: severityOf(code)` — no bootstrap call site can state a severity (#1270) |
| `compiler/self-host-v2/slice-m2/lowered.js` :67 | `compiler/self-host-v2/link.scrml` | `mods.link.parseProgram(files, entry)` — the slice drivers now go through the canonical link order rather than their own file list (#1280) |

Unchanged and worth restating: `validators/lint-transaction.ts` imports ONLY `type { FileAST, Span }` from
`../types/ast.ts` — it is a pure AST walk with no codegen or emitter dependency, which is why it can run as its own
post-TAB stage.

## S451 — DEPENDENCY DELTA (`47c863556..d3e660a08`)

npm: **0 changes** (`package.json` untouched in-window).

Internal module graph additions (grep-verified at `d3e660a08`):
- `codegen/sql-handle-name.ts` ← `codegen/{context, emit-control-flow, rewrite, emit-logic, index, db-authoritative, emit-tool, emit-client, emit-server}.ts`
- `db-ownership.ts` (`resolveDbScopes`, `dbHandlesWithin`, `DbScopeResolution`) ← `codegen/emit-server.ts`, `codegen/index.ts`, `codegen/sql-handle-name.ts`
- `route-inference.ts` → `expression-parser.ts` (`emitCodeOnlyStringFromTree`, `blankLiteralTextInSource`)
- `cli.js` → `commands/fix.js` (dynamic import) → `commands/fix-s66.js` (`fixS66`, `moduleEdges`, rule lists)
- `scripts/bootstrap-conformance.ts` → `compiler/src/commands/fix-s66.js` (generates the §66 twin of each legacy case, every rule)
- bootstrap: `self-host-v2/sql.scrml` → `core.scrml` (`SqlKind`, `SqlTables`, `SqlColumns`); consumed by the lowering for `FSql` query facts

## S449-WRAP — DEPENDENCY DELTA (`9bafb927..47c863556`)

**npm: zero change** (`package.json` untouched in-window). `scripts/bootstrap-conformance.ts` uses the existing
`@happy-dom/global-registrator` devDependency.

**Internal edges added (from import statements at `47c863556`):**
- `codegen/emit-server.ts` → `codegen/sql-tx-guard.ts` (`SQL_TX_GUARD_HELPER_LINES`, `guardHandleExpr`, `requestScopeLines`,
  `CONCURRENT_TRANSACTIONS_VALUE`) — `emit-server.ts:31`.
- `codegen/emit-server.ts` → `db-ownership.ts` now imports `fileDefaultDbDecl` (new export; `fileDefaultDbValue` is a
  thin wrapper over it) — `emit-server.ts:37`.
- `codegen/sql-tx-guard.ts` imports NOTHING. Its emitted runtime reaches AsyncLocalStorage via
  `process.getBuiltinModule("node:async_hooks")` — deliberately no `import` (the conformance adapter evaluates server
  modules with `new Function`).
- `codegen/protect-flow.ts` → sql-tx-guard: by NAME only (`TX_GUARD_RUNTIME_NAMES`, `protect-flow.ts:867`), no import.
- `scripts/bootstrap-conformance.ts` → `conformance/{run,driver,fake-clock,normalize}.ts` (`loadCases`, `hasRuntimeHalf`,
  `validateExpectContainers`, `driveInputs`, `FakeClock`, `normalizeDom`, `runAnchored`) + the self-host-v2 slice-m2 bundle.


## S450 — DEPENDENCY DELTA (`6a592ed5c..9bafb927`)

External: **ZERO-DIFF** — `package.json`, `bun.lock`, `bunfig.toml` unchanged in-window.

Internal module graph changes:
- `compiler/src` -> `compiler/native-parser/*.js` is now a **fixed, frozen** edge set (no whole-pipeline routing):
  `component-expander.ts`, `meta-eval.ts` -> `parse-file.js`; `codegen/emit-match.ts`, `codegen/emit-engine.ts` ->
  `parse-file.js` (lazy `require`); `validators/defer-structure.ts` -> `lex.js`, `parse-stmt.js` (lazy `require`);
  `native-walker/forbidden-js-native.ts` -> `parse-file.js`, `lex.js`, `parse-stmt.js`, `parse-expr.js`;
  `native-walker/engine-statechild-walker.ts` -> `collect-hoisted.js`; `ast-builder.js` -> `body-top-prose.js`,
  `body-top-coverage.js`; `block-splitter.js` -> `body-top-prose.js`; `api.js` -> `translate-expr.js`.
- REMOVED edges: `commands/compile.js` -> native routing (`--parser`), `native-parser-canary/*`, the two deleted
  `native-walker` modules.
- NEW `codegen/server-session-guard.ts` -> `codegen/errors.ts` only; imported by `codegen/emit-expr.ts`,
  `codegen/emit-server.ts`, `codegen/index.ts`, `codegen/rewrite.ts`, `expression-parser.ts`, `route-inference.ts`.
- NEW `codegen/session-store-emit.ts` -> `sqlite-handle-defaults.ts` (`SQLITE_BUSY_TIMEOUT_MS`); imported by
  `codegen/emit-server.ts`, `codegen/protect-flow.ts`.
- `codegen/emit-tool.ts` -> `commands/listen.js` (`isLoopbackHost`, `isLegacyNumericIPv4`, `hostRefusal`, `bindPlan`,
  `displayUrlFor`, `probeIPv6`, `bindListeners` — re-printed into the generated serve-target via `Function.prototype.toString()`).
- `codegen/index.ts` (`runCG`) now receives `api.js`'s `importedTypesByFile` (imported enums into the variant registry, #1210).


## S447 — DEPENDENCY DELTA (`78e4ddad..6a592ed5c`)
No `package.json` change (0 npm packages added/removed). Internal graph changes:
- `compiler/src/commands/compile.js` (`--self-host`) → `compiler/dist/self-host/{module-resolver,meta-checker}.js` only;
  the edges to v1 `bs/ast/bpp/pa/ri/ts/dg/cg/tokenizer` builds are gone (no `existsSync` import either).
- `compiler/scripts/build-self-host.js` → `stdlib/compiler/{module-resolver,meta-checker}.scrml` only.
- `compiler/tests/parser-conformance/corpus-enumerator.js` → `compiler/self-host-v2/*.scrml` (was `compiler/self-host/`).
- NEW `compiler/self-host-v2/slice-codec/bundle.scrml` → `../codec.scrml`, `src/types.scrml`; `codec.test.js` /
  `cross-impl.test.js` → `harness.js`, `runtime/codec.js`.
- NEW `compiler/tests/helpers/tmp-root-preload.js` → `bun:test`, `child_process`, `fs`, `os`, `path`, `crypto`
  (no internal imports); loaded by `bunfig.toml`.
- `compiler/self-host/` no longer exists — every former edge into it is removed.

## S446 — DEPENDENCY DELTA (`464c9ab4d..78e4ddad`, from import statements at `78e4ddad`)
- **No new runtime or dev npm package** — `package.json` is zero-diff this window (`git diff --name-only` empty);
  version stays `0.8.0`.
- **Internal module graph additions** (new edges from the 4 new `compiler/src` modules):
  `commands/dev.js` → `commands/listen.js`; `commands/serve.js` → `commands/listen.js`;
  `codegen/index.ts` → `db-ownership.ts`, `codegen/sqlite-file-target.ts`, `program-role.ts`;
  `api.js` → `codegen/sqlite-file-target.ts`;
  `protect-analyzer.ts` → `db-target.ts` (`resolveDbFilePath`, now the one compile-time resolver),
  `db-ownership.ts`;
  `compute-program-config.ts`, `tool-program.ts`, `auth-graph.ts`, `reachability/entry-points.ts`,
  `route-inference.ts`, `refusal-gate.js` → `program-role.ts`;
  `commands/build.js` → `codegen/sqlite-file-target.ts` (`projectRootFor`, the adapter data-root wiring).
- No existing module's external (npm) import set changed (`js-async-analysis.ts`, `scheduling.ts`, `emit-lift.js`,
  `emit-variant-guard.ts`, `protect-flow.ts`, `schema-differ.js`, `gauntlet-phase1-checks.js` all gained
  internal-only exports/params this window, grep-verified — no new `from "..."` npm specifier).

## S445 — DEPENDENCY DELTA (`5b1d0dab0..464c9ab4d`, from import statements at `464c9ab4d`)
- No `package.json` change in-window (runtime / dev deps unchanged).
- NEW edge `compiler/src/ast-builder.js` → `../native-parser/body-top-prose.js` (`segmentBodyTopItems`) and
  `../native-parser/body-top-coverage.js` (`declExtent`, `liveStmtNothingReason`, `liveLabelIsTargeted`).
- NEW edge `compiler/src/block-splitter.js` → `../native-parser/body-top-prose.js` (`bodyTopQuoteStartsStatement`,
  `scanBodyTopLiteralClose`, `scanBodyTopTemplateClose`).
- `compiler/native-parser/parse-markup.js` → `body-top-prose.js`, `body-top-coverage.js`.
- `compiler/src/codegen/index.ts` → `emit-html.ts` now also imports `buildChunksBootJs`.
- REMOVED: `default-logic-exemption.ts` and its single consumer edge (the row below is SUPERSEDED).

## S444 — DEPENDENCY DELTA (`cf62b415..108ca89be`, from import statements at `108ca89be`)

**External:** `package.json` — `homepage` now `https://scrml.dev`; keywords `typescript` and `no-build` removed.
Dependencies unchanged (0.8.0). `acorn` gains two new importers (below). `puppeteer` (existing dep) is now also
used by `compiler/self-host-v2/slice-m3/css-oracle.js`.

### Internal edges added in `compiler/src`
- `static-serve-policy.js` (NEW) → `static-serve-policy-emitted.js` (NEW); ← `api.js`, `commands/build.js`, `commands/dev.js`, `codegen/emit-server.ts`.
- `codegen/js-async-analysis.ts` (NEW) → `acorn`, `codegen/async-combinators.ts`, `codegen/local-async-fns.ts` (type);
  ← `emit-client.ts`, `emit-control-flow.ts`, `emit-each.ts`, `emit-event-wiring.ts`, `emit-lift.js`, `emit-library-shared.ts`,
  `emit-logic.ts`, `emit-reactive-wiring.ts`, `local-async-fns.ts`.
- `codegen/protect-flow.ts` (NEW) → `acorn`, `codegen/errors.ts` (`CGError`); ← `api.js` (`takeProtectRegistry`,
  `analyzeCompileProtectFlow`), `codegen/emit-server.ts`, `codegen/protect-egress.ts`, `codegen/rewrite.ts`.
- `api.js` → `type-system.ts` (`BUILTIN_TYPES` newly imported), `codegen/emit-worker.ts` (`workerBundleFilename`,
  `workerBundleSuffix`), `codegen/emit-css.ts` (`generateCss`, now picked through the `CSS` seam).

### Internal graph — `compiler/self-host-v2/` additions
- `css.scrml` (NEW) → `core.scrml` (stylesheet Core types)
- `css-ingest.scrml` (NEW) → `core.scrml`, `ingest.scrml` (`IVal`, `INode`, field accessors)
- `slice-m3/css-bundle.scrml` → `core.scrml`, `css.scrml`, `css-ingest.scrml`, `ingest.scrml`, `slice-m3/css.core.scrml`
- `slice-m3/css-oracle.js` → `compiler/src/api.js` (`compileScrml`), `puppeteer` (dynamic)
- `slice-m4/harness.js` → `slice-m2/harness.js` (`loadM2`), `slice-m2/lowered.js` (`frontEnd`)


## S440 — DEPENDENCY DELTA (`fb21983a..cf62b415`, from import statements at `cf62b415`)

**External:** `package.json` unchanged (0.8.0). No new npm package.

### Internal graph — `compiler/self-host-v2/` (CURRENT, full; supersedes the S438 list below, which mis-stated two edges)
- `lex.scrml`, `ast.scrml`, `core.scrml`, `js.scrml`, `html.scrml`, `names.scrml` → (no imports)
- `parse.scrml` → `lex.scrml`, `ast.scrml`
- `analyze.scrml` → `core.scrml`, `ast.scrml`
- `lower.scrml` → `core.scrml`, `ast.scrml`, `walk.scrml`, `analyze.scrml` (reads `Tables` / fact lookups)
- `walk.scrml` → `core.scrml`
- `check.scrml` → `core.scrml`, `walk.scrml`
- `measure.scrml` → `core.scrml`, `walk.scrml`
- `print.scrml` → `core.scrml`, `walk.scrml`, `js.scrml`, `html.scrml`, `names.scrml`
- `ingest.scrml` (NEW) → `core.scrml`, `walk.scrml`, `measure.scrml`
- Compile entries (each a `<program>` that imports every module it needs): `slice-m1/bundle.scrml`,
  `slice-m2/bundle.scrml` (adds lex/parse/analyze/lower), `slice-m3/bundle.scrml` (ingest + check + print).
- JS harness edges: `slice-m1/harness.js` → `compiler/src/api.js` (`compileScrml`); `slice-m2/harness.js` →
  `slice-m1/harness.js`; `slice-m1/cores.js` → `slice-m2/{harness,lowered}.js`; `slice-m3/harness.js` →
  `compiler/src/api.js`; `slice-m3/substitute.js` → `slice-m1/harness.js`; `slice-m3/footprint.test.js` →
  `scripts/hybrid.ts`; `conformance/adapters/hybrid.ts` → `conformance/adapters/impl1-ts.ts` (`setClientExecutor`, installed from the substitute's `executeClient` via `scripts/hybrid.ts` `clientExecutorOf`).
- Correction to S438: `slice-m2/compare.js` imports NOTHING (it walks impl#1's plain-object Core shape); `lower.scrml`
  also imports `walk.scrml` and `analyze.scrml`.

### Internal edges added in `compiler/src`
- `codegen/local-async-fns.ts` (NEW) ← `emit-library-shared.ts` (`annotateLocalAsyncFns`; wrapped as exported
  `annotateNestedAsyncHelpers`), `emit-expr.ts`, `emit-logic.ts`, `async-combinators.ts`, `emit-server.ts`, `emit-tool.ts`.
- `emit-library-shared.ts` NEW exports `syncCallbackErrorForSite`, `serverFnSyncCallbackError`, `stdlibAsyncPredicate`,
  `annotateNestedAsyncHelpers` ← `emit-functions.ts`, `emit-library.ts`, `emit-server.ts`, `emit-tool.ts`.
- `codegen/emit-server.ts` → `runtime-template.js` (NEW import `SERVER_STRUCTURAL_EQ_SOURCE`; re-exported wrapped as
  `SERVER_STRUCTURAL_EQ_HELPER`, consumed by `emit-library.ts` and `emit-tool.ts`).
- `commands/refusal-gate.js` (NEW) ← `commands/build.js`, `commands/compile.js`.
- `expression-parser.ts` → `codegen/code-segments.ts` (`rewriteCodeSegments`, now also fencing the `~`, `render name(`,
  `::Upper`, `? .x` rewrites).


## S438 — DEPENDENCY DELTA (`9941a504c..fb21983a`, from import statements at `fb21983a`)

**External:** `package.json` NOT changed in the window (version stays `0.8.0`) — runtime and dev dependency lists
are unchanged. No new npm package.

### Internal edges / newly-imported symbols in `compiler/src`
- `route-inference.ts` → `codegen/session-config-resolve.ts` (**NEW export** `countUnitProgramNodes` — how many
  `<program>` nodes step 2 of the resolver walks in a unit; a file with 2+ keeps the pre-S438 session-default
  stamping rather than falling through to a last-wins read), `codegen/collect.ts` (`getNodes`).
- `codegen/emit-server.ts` → `codegen/session-config-resolve.ts` (now calls `_resolveSessionAttr` for
  `sessionExpiry` directly rather than reading `authMiddlewareEntry.sessionExpiry`, which an auto-escalated /
  `<page>` entry may leave undefined).
- `codegen/index.ts` → `tool-program.ts` (`isToolProgram`, now consulted per FILE by `_collectProgramSites`
  before counting a program site for `E-MW-008`).
- `block-splitter.js` → `tokenizer.ts` (**NEW edge**, `tokenizeLogic` — consulted as a line-scoped probe deciding
  whether a brace is quoted-string content; the block tree itself is still hand-scanned, unchanged).
- `emit-logic.ts` → `emit-control-flow.ts` (**NEW export** `armCondition` — the shared arm-condition builder,
  now also used by `emitMatchExprDecl`'s two hand-rolled `if`/`else if` chains instead of a duplicated
  single-test comparison).
- `ast-builder.js` — 4 new module-private helpers (`scanPastBalancedParens`, `scanArmPatternAlternate`,
  `armPatternChainArrowOffset`, `armChainBindingAlternate`), no new cross-file edge; consumed by the existing
  `collectExpr` arm-boundary detector at `:4794`.
- `type-system.ts` / `emit-control-flow.ts` — no new cross-file edge; `parseArmPattern` (type-system) and
  `parseMatchArm` (codegen) were independently extended with matching wildcard-alternate recognition — they
  must keep agreeing (documented in both files' comments) but there is still no shared helper between them.
- `schema-differ.js` → no new outbound edge; **new export** `findRejectedCreateTableHeads`, consumed by
  `gauntlet-phase1-checks.js`'s `<schema>` body checks (existing edge, new symbol).

### Internal graph — `compiler/self-host-v2/` (bootstrap, M1 + NEW M2)
- `lower.scrml` → `ast.scrml`, `core.scrml` (M2's front-end: `ast.scrml` tree → Core IR)
- `parse.scrml` → `ast.scrml`, `lex.scrml` (source text → `ast.scrml` tree)
- `check.scrml` → `core.scrml` (unchanged edge; new check C7 reads the new `FieldDef.graph`)
- `slice-m2/harness.js` → `compiler/src/api.js` (`compileScrml` — impl#1 compiles the M2 bundle, same pattern as
  `slice-m1/harness.js`)
- `slice-m2/compare.js` → `core.scrml`, `walk.scrml` (Core-tree structural diff — the Fork-A proof instrument)
- `slice-m2/bundle.scrml` → `parse.scrml`, `lower.scrml`, `check.scrml`, `print.scrml`, `slice-m2/src/*.scrml`
- Still true: the bootstrap tree imports nothing from `compiler/src` except via the test harness;
  `compiler/self-host/` no longer exists (REMOVED S447 #1230).

Resolves the prior ⏳ NOT-MAPPED note (M2 landed on `origin/main` mid-pass, after the `9941a504c` stamp).


## S437b — DEPENDENCY DELTA (`d02738767..9941a504c`, from import statements at `9941a504c`)

**External:** `package.json` NOT changed in the window — runtime and dev dependency lists are unchanged.
`compiler/self-host-v2/slice-m1/{load-program.js,runtime.test.js}` use the existing dev dep `@happy-dom/global-registrator`.

### Internal edges / newly-imported symbols in `compiler/src` (#1106 handler fix)
ast-builder.js → multi-statement-scan.ts (`scanForTopLevelSemicolon`, `isEventHandlerAttrName`, `bareHandlerStatementsText`, `attrShapedTokenInStatements` — the last two NEW exports)
codegen/emit-match.ts → ast-builder.js (existing lazy `require` at `emit-match.ts:764` now also takes `attachHandlerStatementListsInTree` — re-attaches `handlerBlock` on `<match>` arm sub-builds)
codegen/emit-event-wiring.ts → codegen/emit-logic.ts (static import of `emitHandlerStatementList` — NEW export, lowers a handler's statement list as a function body)
codegen/emit-each.ts, codegen/emit-variant-guard.ts → codegen/emit-logic.ts (same symbol via lazy `require("./emit-logic.ts")` — invisible to static import scans)
ast-builder.js → expression-parser.ts (`captureTrailingContentWarnings` — NEW export)

### Internal graph — `compiler/self-host-v2/` (bootstrap slice M1, NEW)
walk.scrml → core.scrml
check.scrml → core.scrml, walk.scrml
measure.scrml → core.scrml, walk.scrml
print.scrml → core.scrml, walk.scrml, js.scrml, html.scrml, names.scrml
slice-m1/{counter,dropdown,valuesem}.core.scrml → core.scrml
slice-m1/bundle.scrml → core, walk, print, check, measure, and the three `*.core.scrml`
slice-m1/harness.js → compiler/src/api.js (`compileScrml` — impl#1 compiles the bootstrap)
slice-m1/lint.test.js → scripts/lint-no-default-arm.js
scripts/lint-no-default-arm.js → compiler/native-parser/lex.js
The bootstrap tree imports nothing from `compiler/src` except via the test harness; `compiler/self-host/` no longer exists (REMOVED S447 #1230).


⏳ NOT MAPPED: bootstrap M2 (#1109, `072741ca9`) landed on main mid-pass, after this stamp; it edits files named here (self-host-v2 modules, `slice-m1/`, `ci.yml`). Next refresh maps it.

## S437 — INTERNAL EDGES ADDED (`787d4cb4..d02738767`, from import statements at `d02738767`)

api.js → pipeline-seam.ts (`createStageSeams`, `StageSeamError`), precg.ts (`runPRECG`), diagnostic-secrets.ts (`SecretRedactor`), host-import.js (`readHostImportCapabilities`, `validateHostImports`), validators/lint-defer.ts (`runDeferChecks`), validators/lint-redeclare.ts (`runRedeclareChecks`), native-walker/forbidden-js-native.ts
precg.ts → compute-pgo-flags.ts, compute-program-config.ts
pipeline-seam.ts → (registry of 36 stage modules by `tsModule` path; resolved lazily by name)
scripts/hybrid.ts → compiler/src/api.js, compiler/src/pipeline-seam.ts
conformance/adapters/hybrid.ts → conformance/adapters/impl1-ts.ts (`setCompileOverlay`)
module-resolver.js → host-import.js (`scanHostModule`)
validators/lint-redeclare.ts → type-system.ts (`iterDestructuredNames`)
validators/lint-defer.ts → validators/defer-structure.ts → (lazy `require`) block-splitter.js, ast-builder.js, codegen/emit-control-flow.ts
codegen/index.ts → codegen/lower-defer.ts, codegen/session-config-resolve.ts
codegen/emit-server.ts → codegen/sqlite-defaults.ts, codegen/session-config-resolve.ts
codegen/emit-tool.ts → codegen/sqlite-defaults.ts
codegen/sqlite-defaults.ts → sqlite-handle-defaults.ts (re-exports the timeout VALUE)
protect-analyzer.ts → sqlite-handle-defaults.ts, db-target.ts, db-uri-redact.ts
commands/db-migrate.js → sqlite-handle-defaults.ts
codegen/db-driver.ts → db-target.ts, db-uri-redact.ts
db-uri-redact.ts → diagnostic-secrets.ts → db-target.ts
component-expander.ts → implied-lift-desugar.ts; codegen/emit-match.ts → implied-lift-desugar.ts
codegen/{emit-control-flow.ts, emit-lift.js, emit-reactive-wiring.ts} → codegen/declared-name-marks.ts
lsp/handlers.js → compiler/src/diagnostic-secrets.ts (`SecretRedactor`, `harvestFromSource`)
scripts/flograph.ts → scripts/state.ts (`parseGapMarkers`, `classifyGapStatus` — the second @gap regex is gone)

⚑ **Seam invariants stated in the new modules' headers (read them before adding an import):** `sqlite-handle-defaults.ts` imports NOTHING (so `protect-analyzer.ts` never pulls `bun:sqlite`/`node:fs` through it); `db-target.ts` sits outside `codegen/` so the early PA stage does not import a codegen module; `defer-structure.ts` loads the front-end and `emit-control-flow.ts` lazily to avoid a validator→codegen import cycle.

## MANIFEST SHAPE — one manifest, allowlisted

There is exactly ONE package manifest in the repo (root `package.json`, v0.8.0 as of S437 — was v0.7.1); `compiler/package.json`
and `"workspaces": ["compiler"]` were deleted at `171f5f23`. `acorn` and `astring` live in the root
`dependencies`; `"private": true` is gone; a `files` ALLOWLIST governs what publishes. Any doc still
describing a `compiler/` workspace at v0.2.0 is stale.

## Runtime Dependencies — root package.json (v0.8.0, the SOLE manifest)
@modelcontextprotocol/sdk@1.29.0 — MCP server SDK for the scrml MCP integration
acorn@^8.16.0 — JS parser for escape-hatch (`_{}`) expressions + the E-CG-001 acorn-exact egress scan + the chunk-namespace cell-accessor-rename pass **(HOISTED this window from the deleted compiler manifest)**
astring@^1.9.0 — JS AST-to-source printer, paired with acorn for re-serializing escape-hatch nodes **(HOISTED this window)**
pg@^8.22.0 — bundled Postgres client; drives §38.13 realtime LISTEN bridge + `scrml introspect`
vscode-languageserver@^9.0.1 — LSP server protocol implementation
vscode-languageserver-textdocument@^1.0.11 — LSP text document utilities

## Dev / Build Dependencies — root package.json
@happy-dom/global-registrator@^20.8.9 — DOM environment for browser-suite Bun tests
happy-dom@^20.8.9 — fast in-process DOM used by compiler/tests/browser
@playwright/test@^1.49.0 — Playwright e2e framework (e2e/)
marked@^14.1.3 — Markdown parser used by docs/build.ts
puppeteer@^24.40.0 — headless browser support for e2e/docs tooling
typescript@^5.9.2 — **NEW THIS WINDOW (#665), and the FIRST external-dependency change in eleven windows.** The ONLY consumer is `scripts/types-gate.ts` (`bun run types` / `types:check`). It is a DEV dep and is NOT in the `files` allowlist. It is NOT used to build or run anything — bun still transpiles `.ts` directly; `tsc` is invoked `--noEmit` purely to produce the diagnostic set the gate compares.

## Published surface (`files` allowlist — new this window)
`compiler/bin/`, `compiler/src/`, `compiler/native-parser/`, `compiler/runtime/`, `stdlib/`,
`README.md`, `LICENSE`. It is an ALLOWLIST, not a denylist — **anything new is excluded by
default**. `stdlib/` is REQUIRED at runtime (`module-resolver.js`'s `STDLIB_ROOT` resolves
`../../stdlib`), not optional. Deliberately excluded: `compiler/tests` (20M), `self-host*`,
`samples/`, `examples/` (12M), `SPEC.md`/`PIPELINE.md` (docs live on scrml.dev).

## Editor-tooling Dev Dependencies — editors/vscode/package.json
vscode-textmate, vscode-oniguruma — bundled TextMate-grammar test harness (tokenize.js / regression-scan.js); not part of the compiler pre-commit gate, needs its own `npm i`.

## CI-only External Actions (not npm deps — GitHub Actions)
actions/checkout@v4, oven-sh/setup-bun@v2 — the only actions any AUTO-TRIGGERED workflow now uses. **`anthropics/claude-code-action@v1` is no longer reachable on any automatic trigger (S310, #351):** `cloud-maps.yml`'s Stage 2 (the project-mapper leg) was DELETED outright, and `advisory-review.yml` was demoted to `workflow_dispatch`-only. It remains referenced ONLY in that manual-fire job, which is the sole consumer of `ANTHROPIC_API_KEY`. **This was a COST decision, not a broken secret** — treat any map/doc line saying "the key IS set and the daily run passes it" as retired. `MAPS_PAT` (a fine-grained PAT) is still the checkout/PR identity for `cloud-maps.yml`'s surviving deterministic stages.

## Runtime Engine
bun>=1.3.13 — required; no Node support (Bun-specific APIs used throughout: Bun.serve, bun:sqlite, Bun.$, Bun.SQL, Bun.hash). The DB-authoritative tier depends on `Bun.SQL`'s transaction API (`sql.begin`) and `bun:sqlite`'s `Database` for the `scrml db-migrate` apply loop — both already-bundled.

**Zero NEW external dependency this window, and zero manifest diff at all** (`git diff
fe14c9b2..HEAD -- package.json` is empty). One INTERNAL edge is new and worth knowing:
**`codegen/scheduling.ts` now imports `acorn` directly** (`import { parse as acornParse } from
"acorn"`) — the GH #264 rewrite models emitted-JS scopes with the real parser instead of a flat-text
scanner. `acorn` was already a root runtime dependency (the E-CG-001 egress scan, escape-hatch
parsing, cell-accessor-rename), so this widens the internal consumer set, not the dependency set.

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

⛑ **S402 — RE-WALKED AT `499eecce`: 195 source files · 699 local import edges** (was 192 · 672 at
`fc6df72e`), by `flogence/scripts/mapgen.ts --kind deps`. **+24 edges, and the largest single
contributor is #859's file-shape consolidation** — see the first row of the table below.


| Stage | Module(s) | Feeds |
|---|---|---|
| **⛑ FILE SHAPE — SEVEN IMPORTERS OF ONE LEAF, AND FOUR OF THEM ARE HAND COPIES THAT WERE DELETED (NEW row, S402, #859 `85ebbb5f`)** | **`compiler/src/library-shape.js`** (240L) — the SINGLE SOURCE for `classifyFileShape` / `isRecognizedNonEntryShape` / `isLibraryShape` / `isForeignLangLibDecl` | ⛑ **THE EDGE THAT MATTERS IS THE ONE POINTING *INTO* THE TYPE BARREL: `library-shape.js -> types/ast.ts` (`FILE_SHAPES` RE-EXPORT, `:121`) — a `.js` leaf importing from `.ts`, which is unusual in this tree and is FORCED.** `FileShape` is `(typeof FILE_SHAPES)[number]`; declaring the array in `library-shape.js` instead would make the derivation hit TS7016 and collapse the union to `any`. **Do not "clean this up" by moving the array down to the leaf.** ⚑ **NEW IMPORTERS THIS WINDOW (all #859):** `compute-pgo-flags.ts` (the PRECG STAMP) · `component-expander.ts` (the CE RE-STAMP) · `codegen/index.ts` (`getFileShape`). **CHANGED IMPORTERS:** `ast-builder.js` · `api.js` · `tool-program.ts` each swapped `isForeignLangLibDecl` for `classifyFileShape` / `isLibraryShape` / `isRecognizedNonEntryShape`. ⛔ **FOUR HAND COPIES OF THE SHAPE PREDICATE WERE DELETED INTO THIS LEAF, AND ONE OF THEM CITED `ast-builder.js line 12222` — ~7,700 LINES STALE, pointing into an unrelated part of a 20k-line file.** None of the four knew about `"pure-channel"`. ⚠ **THE READ ORDER IS A REAL CONSTRAINT: `api.js`'s W5a is the ONLY PRE-CE READER**; `tool-program.ts` and `codegen/index.ts` run post-CE and want the RE-STAMPED answer. See domain.map.md. |
| **⛑ §17.1.1 `if-chain` CHILD SHAPE — ONE LEAF, 14 IMPORTERS, 35 CALL SITES, AND *ONE* REMAINING DELIBERATE NON-EDGE (created #805, widened #811, closed onto route inference #818)** | `compiler/src/ast-if-chain.js` — ⚠ **`src/` ROOT, NOT `codegen/`**; `compiler/src/codegen/ast-if-chain.js` does not exist, and consumers import it as `"../ast-if-chain.js"` from `codegen/` and `"./ast-if-chain.js"` from `src/`. **Re-derived at `8e278c73`: 14 importing modules, 35 call sites** (`grep -rl 'from "\.\{1,2\}/ast-if-chain.js"' compiler/src/` -> 14; `ifChainChildNodes(` minus the definition -> 35) — up from 13/32, the delta being **#818's NEW `route-inference.ts:92` edge** plus three call sites (`collect.ts:215`, `route-inference.ts:1137`, `route-inference.ts:1199`). ⛑ **THE NEW EDGE IS SECURITY-BEARING AND ITS DIRECTION MATTERS:** route inference must claim a branch-declared `server fn` BEFORE `codegen/collect.ts` hands the function list to the CLIENT emitter, or the `server fn` BODY ships into `client.js` with no `server.js` — see invariant 86 in primary.map.md. ⚠ **ONE DELIBERATE NON-EDGE REMAINS: `symbol-table.ts:10642`** is a TOTAL `Object.keys` walk that already reaches `branches[].element`; routing it through this enumerator of KNOWN fields would NARROW it. | ⚠ **THIS ROW WAS MALFORMED: two cells in a three-column table.** Closed S397 with this cell rather than by reflowing the prose, because the prose is load-bearing and the defect is structural. **A short row does not error — markdown pads it — so a `sort`/`uniq` on pipe counts is the only thing that sees it.** |
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,db-migrate,promote,generate,init,introspect,semdiff}.js — **11 verbs** |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| **BS-LINT (Stage 2.5 / 2.5b / 2.5c) — three passes that read BLOCK-SPLITTER output, before the AST exists** | `lint-w-interp-in-raw-content.js` (2.5) · `lint-w-input-state-markup-nonreactive.js` (2.5b) · **`lint-e-state-block-statement-form.js` (2.5c, NEW #718)** | `collectErrors("BS-LINT", …)` → `result.warnings` for 2.5/2.5b, **`result.errors` for 2.5c** (`E-` prefix + `severity:"error"`; CLI exit 1). ⚑ **THE NEW NODE IMPORTS NOTHING — it is a leaf by necessity, since anything it pulled from a later stage would invert pipeline order.** Cost: its `STATE_BLOCK_NAMES` / `STATE_BLOCK_ON_LIFECYCLE_RE` are COPIES of `ast-builder.js:1169` (⛑ S383 +9) / `:756-757`, unenforced. ⚠ **2.5 and 2.5b wrap their call in `try`/`catch`; 2.5c deliberately does NOT** — a swallowed throw in an error gate is fail-OPEN. error.map.md. |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen. **`expression-parser.ts` now also exports `forEachIdentInExprNode`**, consumed by `emit-server.ts`'s D-5 module-const resolvability check. |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js. **Parity obligation PAID this window** for `ifRaw`/`ifCond` — see the §17.1.2 chain below. |
| Tag-canonicalize (Stage 3.055 TC) | tag-canonicalizer.ts | landmark-tag.ts + api.js |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts. **Every downstream consumer that keys on `node.id` depends on this stage's per-expansion clone (S299)** — `codegen/emit-each.ts` (fence ids / `_scrml_each_renderers`), `codegen/chunk-namespace.ts` (id-derived tokens). `_deepCloneAst` is INTERNAL (not exported); its two callers are `expandComponentNode` (:2601) and `_cloneChannelDecl` (:4552). |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001). **protect-analyzer.ts is the SOLE `E-PA-*` fire site (7 codes); `E-PA-002`'s message leads with the `<schema>` + `scrml db-migrate` remedy (S292).** |
| **§12.2 Trigger 3 — server-only import escalates the USING FUNCTION (S299), and Step 3b REFUSES the derived RHS it cannot reach (NEW #486, S331)** | **route-inference.ts** — `ESCALATION_SERVER_ONLY_MODULES` (:656) / `isEscalationServerOnlyModule` (:674) / `buildPerFileEscalationServerOnlyBindings` (:3331) / `collectServerOnlyBindingModules` (:3397) -> `importTriggers` -> `directTriggers`. **NEW second entry point: Step 3b (:4429)** -> `collectDerivedCellDecls` (:3650) -> `collectDerivedRhsServerOnlyRefs` (:3616) -> `RIError("E-DERIVED-SERVER-ONLY-REACH")`. **Both halves share ONE walk, `scanForServerOnlyBindingRefs` (:3451), extracted at S331 with no behavioural change to the function path** — the two callers differ only in what they hand in as `root` and how they derive their shadow set (`collectLocalNames` vs `collectDerivedRhsLocalNames` :3562). It returns local NAMES→modules, not just modules, because the derived diagnostic must name the offending member and a discarded name cannot be reconstructed. | Function half: `RouteInfo.escalationReasons` -> `codegen/emit-server.ts` (reusing the EXISTING `server-only-resource` reason kind, NOT a new variant — `isBodyOnlyEscalation`'s `.every()` and `describeServerTrigger` both already encode that expectation). Derived half: **an ERROR, not a placement** — it terminates the compile. **DO NOT confuse `ESCALATION_SERVER_ONLY_MODULES` with the pre-existing `SERVER_ONLY_SCRML_MODULES` (:579) seventy lines above it** — that one feeds the `api.js` STDLIB-EXPORT-SEED async backstop, where over-inclusion is SAFE; escalation INVERTS that safety (under-include = a browser leak, over-include = a wrong relocation, measured at 72 corpus sites). **They are two sets, two safe-error directions, one file, and this window did not change either one.** See domain.map.md. |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts. **`visitStructuralIfAttr` (:12688) must run BEFORE the `each:` scope push** — see the §17.1.2 chain below. |
| **Indirect callee resolution (#284, S303)** | **indirect-callee-resolver.ts** (NEW) | route-inference.ts `indirectInverseCallerMap` (:4707) → Step 5c only; `aliasNamesResolvingTo` → `serverFnPeerAliasNames` → emit-server/emit-logic/emit-control-flow/emit-expr. **`inverseCallerMap` must stay byte-identical.** See below. |
| Schema declaration checks | gauntlet-phase1-checks.js | `E-SCHEMA-010` (via `findNonLiteralSetItems`) + **NEW `E-SCHEMA-011`** (via `parseColumns`'s `malformedReferences` + `referencesHint`) — both helpers live in schema-differ.js |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen. symbol-table.ts PASS 15.5 owns the `<outlet>` placement pass. |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts. Also the `E-DBAUTH-SQLITE` compile-time gate (`annotateDbScopes`) and the §40.8.2 shell composition. **NOT the runtime-chunk gates — those are emit-client.ts.** |
| **Runtime-chunk tree-shake gates** | **codegen/emit-client.ts** (`detectRuntimeChunks` :273 pre-emit AST walk; `POST_EMIT_HELPER_CHUNK_GATES` :2167 post-emit reference scan) + **codegen/runtime-chunks.ts** (`CHUNK_DEPENDENCIES` :384, closed over at the END of `detectRuntimeChunks`) + compute-pgo-flags.ts (the `reset`/`equality`/for-stmt PGO inputs `detectRuntimeChunks` reads) | `ctx.usedRuntimeChunks` -> the assembled runtime slice. **This is the locus for any `ReferenceError: _scrml_* is not defined` in a shipped bundle.** See "Runtime-chunk gating" below. |
| **Coordinate space — SOURCE vs DIST (D-4, S296; GENERALIZED #390)** | **codegen/emit-server.ts** — `distRelativeServerSpecifier` is now a thin wrapper (`targetExt=".server.js"`) over the general `distRelativeLocalSpecifier(sourceSpecifier, importerFilePath, outputBaseDir, targetExt)` / `distLocalPathOf`, so a §64 tool/library `.scrml` import re-bases to dist space the SAME way a server import does (`isOutsideBase`, `distServerPathOf` renamed `distLocalPathOf`); **api.js** (`distServerKeyToSource` + `distDirOfSource` forward index, `serverImportTargetSource`) reverses; **codegen/emit-client-esm.ts** already computed client URLs in dist space | `checkServerImportInvariant` (`W-SERVER-IMPORT-UNEMITTED`) and `emitValueOnlyServerJsForDanglingImports` — BOTH reversal sites. **NEW consumers:** `emit-tool.ts` / `emit-library-shared.ts` (§64 import rebasing). See "Coordinate space" below. |
| **§20.5 SESSION PROLOGUE BINDING (NEW #435, GH #357) — a Proxy, and the Proxy is a CONFIDENTIALITY decision, not a convenience** | **codegen/emit-server.ts** — `_SESSION_BARE_TEXT_RE` (shared text-level detector; the left-guard `[^\w$.]` is load-bearing — it keeps `_scrml_session_store` / `sessionId` / `_scrml_read_session_id` / `_scrml_req._scrml_sess` from matching, so only a BARE `session` followed by `.` or `[` counts) + `astSqlQueryUsesSession` (ORed into `_anySessionBuiltin`, so an interpolation-only use FORCES the session infra on) + the emitted `_scrml_session_bind(_s)` factory + a conditional handler-scope SPLICE at the same insertion point as the `@currentUser` binding. **A `?{ … ${session.userId} … }` carries its query as a STRING** — sigil-less and invisible to the emit-expr member/index lowering — so `session` survived as a free variable: HTTP 500 on every authenticated call. | **The binding MUST NOT be `const session = _scrml_req._scrml_sess`.** That object is an ACCESSOR carrying getters (`userId`/`role`/`isAuth`), methods (`get`/`set`/`destroy`) **and RAW own-properties `sid`/`_rec`/`_changes`** — `_rec` holds the full stored record **including the §40.2 `csrfToken`**. A raw bind turns `session[k]` into a raw property read at the wrong level: `session["sid"]` discloses the live session id and `session["_rec"]` the whole record + CSRF token, at HTTP 200 — the exact defeat of the synchronizer-token defense the compiler owns. The Proxy preserves BOTH accessor shapes so the bare binding AGREES with the AST lowering (which is **KEPT** — three security gates match the literal `_scrml_req._scrml_sess.` and retiring it for a bare bind blinds them). **`Reflect.get(t, k, t)` — receiver = the TARGET — is load-bearing:** the getters read `this._rec`, and a Proxy receiver re-enters the trap (`t.get("_rec")` -> null -> TypeError). `set()` returns false so an assignment through the binding is a loud strict-mode TypeError, never a silent shadow write. `_webAppShape`-gated; a non-route text ref (SSE / headless) gets no binding and is caught build-blocking by `E-SESSION-CONTEXT`. **RESIDUAL, re-scored MED this window, still open, still ROUTED-TO-BRYAN:** `g-session-get-reserved-key-read-disclosure` — a request-controlled `session[k]` still reads every OWN key of `_rec` via `.get()`, including the §40.2 `csrfToken`. **PARTIALLY closed as a side-landing of #452:** the accessor is now `Object.hasOwn`-guarded (`emit-server.ts:2692` (⛑ **S384: `:2593` was ALREADY WRONG pre-window; re-derived by grep**)), so the PROTOTYPE-CHAIN half — `.get("__proto__")` -> `Object.prototype`, `.get("constructor")` -> a function, and the HTTP 500 that a function reaching a `?{}` bind produced — is CLOSED. The open half is the own-key READ POLICY, which is a language-surface question the §20.5 write-side guard does not cover. **The ledger entry has not caught up — see non-compliance.report.md S326-N2.** |
| **MANGLER REGION FENCING — TWO region classes, one LEXICAL and one STRUCTURAL, and they COMPOSE (NEW #458). Read this before adding ANY text pass over emitted JS.** | **codegen/code-segments.ts** — (a) the pre-existing LEXICAL fence `rewriteCodeSegments(expr, transform)` (code vs string/regex/comment; descends into a template literal's `${…}` because those are CODE); (b) NEW STRUCTURAL: `findObjectShorthandRegions(code)` -> `ObjectShorthandRegion[] {start,end,kind,names}`, classified by `classifyBraceGroup` into `BraceGroupKind = "object-literal" \| "binding-pattern" \| "unknown"`. **codegen/emit-client.ts** — `joinAroundRuntimeSlot(lines, runtimeSlotIndex, runtimeSource, rewrite)` (:1980, NEW export) + `rewriteCodeSegment` (:3038, the composition site). | **THE STRUCTURAL LESSON, and it is the transferable one: when a text pass acts in the wrong PLACE, change the pass's INPUT, not its pattern.** `joinAroundRuntimeSlot` splices the assembled runtime into its slot **AFTER** the rewrite instead of before, so the runtime is **not part of the rewrite input at all** — no lookaround has to recognise it and no pattern can reach into it. That is the fifth attempt at this class (Bug D · Bug I · Bug Z · g-spread · PGO P3.A were all pattern patches) and the first structural one. **Byte-safety is provable, not asserted:** with `rewrite` as the identity function it is exactly `lines.join("\n")` with the runtime in its slot — which is what the pre-fence code produced — and the second call site (`:3595`) passes exactly that identity. **THE THREE REFUSALS in `classifyBraceGroup` are the design, not gaps:** `:` and `>` are deliberately OUT of `BRACE_OPENS_OBJECT_AFTER` (`label: {…}` / `case x: {…}` are blocks; the `>` of `=> {` opens a function BODY); a `(`-preceded group is decided as a `binding-pattern` ONLY in the `function`-headed form and otherwise reads as a call argument; and **`unknown` obliges the caller to change NOTHING.** **ONLY `object-literal` is acted on, and the LIMIT is load-bearing:** an S239 review showed that fencing a `binding-pattern` while the pass still rewrites the uses those bindings SHADOW turns a LOUD `TypeError` into a SILENT wrong answer — the exact class the fix exists to remove — so a binding pattern keeps today's emission verbatim until there is a scope model. Two further whole-region skips are SEMANTICS: `__proto__` (ECMA-262 B.3.1 — only `PropertyName : AssignmentExpression` sets `[[Prototype]]`, so expanding the shorthand deletes the own key, and a bare `__proto__` beside expanded siblings is ENGINE-DEPENDENT: node binds the global prototype, bun throws), and a group holding no `fnNameMap` name at all. **Net sites this pass STOPS rewriting: ZERO.** Third leg, same PR: **`emit-functions.ts:registerFnName` (:675)** funnels all four `fnNameMap.set` sites through one identifier-shape guard — an empty key made the alternation `\b(…\|)\b`, a ZERO-WIDTH whole-buffer inserter (781 injections into `stdlib/cron` alone), and the guard tests SHAPE not non-emptiness so it closes the class, not the instance. |
| **§12.5 ROUTE-HANDLER `Response` CONTRACT — ONE exit, and the ORDER at that exit is normative (NEW #452)** | **codegen/emit-server.ts** — the non-baseline-CSRF handler now opens an UNCONDITIONAL capture IIFE (`const _scrml_result = await (async () => {`, body indented by `_bodyIndentNonCsrf`) and closes it at ONE exit that envelopes the value as `new Response(JSON.stringify(<redacted>), {status: 200, headers: {"Content-Type": "application/json"}})`. Mirrors the pre-existing `useBaselineCsrf` branch MINUS that branch's own double-submit `Set-Cookie`. | **Before #452 the exit was SPLIT THREE WAYS and that is precisely how the class hid: the ONE arm a test exercised (`_ext5DedupNonCsrf`) returned a `Response`; the protect/tenant arm returned a redacted RAW value; every other shape — the plain authed route — returned NOTHING here, so the ADOPTER's `return` became the HANDLER's return.** Both shipped hosts do `return route.handler(req)` (`dev.js`, the built `_server.js`). MEASURED on Bun 1.3.14 over a real socket: the WIRE got `200 text/plain` with the CONSTANT `"Welcome to Bun! …"` body for EVERY non-`Response` return, while STDERR logged `Expected a Response object` **ONLY for `undefined`/`null`** — a bare `"ok"`/`42`/`{…}` logged nothing at all. The emitted client stub has always done `await _scrml_resp.json()`, which throws on that body. **TWO ORDERING RULES, both argued in-source and both fail-direction-asymmetric.** (1) `if (_scrml_result instanceof Response) return _scrml_result;` sits **BEFORE** `_egressRedact` — a `Response` is an opaque stream handle the redact cannot inspect, and without the guard the envelope does `new Response(JSON.stringify(<a Response>))` which is `"{}"` (no enumerable own props), **turning an adopter's deliberate 403 into a 200 — MEASURED, fail-OPEN.** The guard exists because the failure it prevents is the fail-open one, and §14.8.9/§14.8.10 already model a manual-`Response`/`handle()` body as a live egress kind. **CORRECTION (S355, `a7e99e8f` / #590):** this cell previously read "Currently unreachable from the corpus (a plain body naming `Response` build-blocks on `E-SCOPE-001`)" — now FALSE. `Response`/`Request`/`Headers` are allowlisted in `LOGIC_SCOPE_GLOBAL_ALLOWLIST` (`type-system.ts:7290`), unblocking adopter #471 PDF/binary egress; the guard is now LOAD-BEARING, not belt-and-braces, and `authed-server-fn-response-http.test.js` was flipped in the same commit to assert the passthrough. (2) `_egressRedact` runs **BEFORE** `JSON.stringify` — serialize-then-redact would be a §14.8.9/§14.8.10 confidentiality regression; `_egressRedact` is the identity when neither floor is active, so a plain app is byte-unaffected. **Load-bearing side effect nobody had connected: `_scrml_session_cookie_wrap` appends `Set-Cookie: <sid>` onto the handler's return value and SKIPS when that value has no `.headers`** — so a bare return also dropped the §20.5 session-establishment cookie silently (store record written, browser never got the sid). **DOWNSTREAM, do not miss it:** this landing takes `g-session-get-reserved-key-read-disclosure` from log-only to **WIRE-LIVE**. **⚠ SPEC STATUS: the "SHALL" is in a source comment and a commit subject, NOT in §12.5** — see non-compliance.report.md S326-N1. |
| **§20.5/§52.15.1 DANGLING-REFERENCE CLASS (NEW #440) — name the CLASS: a runtime reference emitted with its binding/definition gated NARROWER than the reference** | **codegen/emit-server.ts** — `astReadsCurrentUserAmbient` (SUPERSET of `astSqlQueryUsesCurrentUser`: also catches the DIRECT `IdentExpr{name:"@currentUser"}` read, e.g. `return { id: @currentUser.id }` with no `?{}` at all) + the §36 SSE `function*` splice at `_sseCuInsertIdx` + `_hasChannelAuth` ORed into `_needsSessionInfra` + an `else if` arm emitting ONLY `_scrml_auth_check`. | **Same class as #357, and it is worth carrying as a class:** compiles clean, zero diagnostics, `ReferenceError` -> HTTP 500 at request time. Three instances closed here (plain-handler `@currentUser` resolver · SSE-handler `@currentUser` binding · `<channel auth=>`-only `_scrml_auth_check` + `_scrml_session_middleware`). The `else if` arm deliberately emits NEITHER the CSRF helpers NOR session-destroy NOR the `@session`-projection routes — those stay `authMiddlewareEntry`-gated, so a channel-auth-only program's route surface is byte-identical. **Every detector in this family is PERMISSIVE BY DESIGN: a false POSITIVE only emits unused session infra; a false NEGATIVE re-opens a 500.** The store invariant was PROBED, not assumed: a read-only `@currentUser` program emits the in-memory Map + middleware + resolver and **NOT** the durable on-disk store (§20.5 i29e — no over-emission). **LESSON, delta-log [1186]: a gap entry's stated fix-locus is a HYPOTHESIS.** Both gap entries here were outdated on the locus and had to be re-diagnosed against HEAD before scoping. |
| **§13.2 ASYNC-NAME PROVIDER — ONE provider, THREE consumers (NEW #442, Limb 1 / dpa-023). DECISION SITES 3 -> 1.** | **codegen/async-combinators.ts** — `AsyncNameFacts` (interface) + `isAsyncCalleeName(name, facts)` + `isServerBoundaryCallee(name, facts)`. The RULE is MODE-FREE and lives here once: not-shadowed, then stdlib-Promise-export OR server-boundary-fn OR transitively-async-local-peer. **There is no fourth disjunct.** What is mode-DEPENDENT is which SETS exist, so **mode selection is the CALLER's job and lives in exactly one place** — `emit-expr.ts:asyncNameFactsOf(ctx)` (client emission -> `clientAsyncFnNames`; server emission -> the local peer set IS `serverFnNames`, so a second term would be redundant and reading a stray client set in a server ctx would be a silent widening). `serverFnNames` is read in BOTH modes deliberately: both emissions name the same fns, only the LOWERING differs (server = in-process peer callable, client = a fetch stub), and both are async. | **1.** `emit-expr.ts:combinatorIsAsyncName` — collapsed from FOUR hand-written disjuncts to ONE delegation. **2.** `emit-library-shared.ts:collectNonAwaitableAsyncCalls` — its bespoke local `isAsyncName` closure is **DELETED**, and it gained the `serverFnNames` parameter it never had. **3.** `emit-expr.ts:isClientServerFnCall` — shares only the provider's shadow-aware server-fn MEMBERSHIP component (`isServerBoundaryCallee`), **deliberately NOT the full predicate**, because it asks an IDENTITY question, not an asyncness one (widening it would capture a stdlib-async callee and route it away from its own `emitCall` branch and its own fail-closed sink). **THE BUG THIS SUBTRACTED:** `computeAsyncFnNames` uses `serverFnNames` as a seed TRIGGER — `callsServerFn(callees)` colours the CALLER and never admits the CALLEE to its result set — so `loadRows` was async to the emitter and **sync to the fail-closed drain, in the same compilation**. The consequence was a MISSING diagnostic, not a wrong emission: a client server-fn call stranded in a raw escape-hatch, a template `.raw` body, or a fn-SIGNATURE parameter default is unreachable to `emit-expr`'s own `syncPeerCalls` sink. **Before adding a FOURTH consumer: hand it `AsyncNameFacts`; do not re-write the rule.** |
| **§13.2 CLIENT SERVER-FN CALL-SITE AWAIT (NEW #429, U1 / dpa-020) — position-invariance AT the choke point, not retrofitted per position** | **codegen/emit-expr.ts** — `isClientServerFnCall` + `isAwaitedClientServerFnCall` + the `emitCall` branch at `:3274`, the fourth sibling of the three existing await branches (server peer, client async peer, stdlib async). Gates: `mode === "client"` + unshadowed ident in `ctx.serverFnNames` + **`ctx.clientAsyncBody === true`**. That last gate is NOT an independent judgement — it is threaded from the SAME `_fnIsAsync` that puts `async` on the host signature, which is `computeAsyncFnNames`'s `callsServerFn` seeding off `collectCalleeIdents`. **So: the walk SEES the server callee -> host is async AND the branch may fire; the walk MISSES it -> host is sync AND the branch cannot fire. The gate can only SUPPRESS an await, never STRAND one** (a stranded `await` in a sync host is a WHOLE-BUNDLE SyntaxError, not a local defect). `peerAwaitable === false` (a sync callback body, any parameter default) emits BARE and records into `syncPeerCalls` — fail-closed. The emitted callee is still the SOURCE name; `emit-client.ts`'s whole-buffer post-fn-name-mangle rewrites it afterwards and `await loadRows()` still satisfies its name-followed-by-`(` regex. | **THE THREADING CHAIN, every hop load-bearing:** `emit-functions.ts` (`_serverFnNames` into `fnOpts`, gated on `_fnIsAsync` — **this path matters most: `fn`-shorthand and return-typed `function` bodies use `emitFnShortcutBody` and bypass `scheduleStatements` entirely, so the statement-level injector NEVER saw them**) · `scheduling.ts` (`_clientServerFnNames(routeMap, filePath)`, threaded ONLY when `clientAsyncBody`) · `emit-logic.ts` (TWO dispatch hops, if-stmt and for-stmt — **this is where the flag was actually dropped**; the five emit-control-flow sites were the SYMPTOM) · `emit-control-flow.ts` (`_asyncAwaitBodyOpts`, `_emitIfStmtInner`, the inline `_emitForStmtInner` `emitLogicBody` call) · `emit-client.ts` (the reactive-set direct-value matcher ABSORBS the emitter-supplied `await` prefix — miss it and the site loses its `.catch(-> _scrml_error_boundary_log)` arm, reintroducing the `unhandledrejection` silent drop ss32-item-1 killed). **TWO cross-cutting rules this landing established. (1) THE OWNING-FILE FILTER:** `runRI` builds ONE `routeMap` across the whole resolved import graph and `FunctionRoute` carries NO `filePath` field — the file lives ONLY in the map KEY (`<filePath>::<start>`). An unfiltered walk imported another file's server-fn names into THIS file's client emission, so a purely local SYNC `save` gained a spurious `await` and a FALSE `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`, with renaming the local fn as the only user workaround. **`declaredNames` cannot cover it** (a top-level client fn name is never in it), so the filter IS the fix — applied identically in `emit-functions.ts` and `scheduling.ts`, **and the two MUST agree, because U1's gate derives from the coloring the filter also feeds.** **(2) DECIDE OFF THE EMITTED OUTPUT:** `emitMatchExpr` writes a placeholder IIFE header and overwrites it at the `})()` close with `await (async function() {` iff mode is server OR the emitted arm bodies contain an `await` in CODE position (`_stripStringLiteralsForAwaitScan` blanks literal content first). Same discipline as #391 — a re-derived predicate can disagree with what was actually emitted, and a disagreement in the unsafe direction is a broken bundle. **STATUS, stated plainly: #429 LANDED EXPLICITLY NOT CLAIMING ITS BUG CLASS** — see the colorless-async section below. |
| **§13.2 CPS auto-await CHOKE-POINT (LANDED #405, 649d6fce) — supersedes GH #237/#264/#394's per-mechanism entries** | **codegen/scheduling.ts** — ONE shared walker, `collectAwaitSites(program, P, isPromiseCallee, reactiveSkip, alwaysWrap)` + `applyAwaitSites`, backing THREE call-shape wrappers: `injectServerCallAwaitsViaAst` (on-mount statement ctx, `"arg1"` reactive-skip), `injectFnBodyServerCallAwaits` (ALL client fn-body statement ctx, NEW, `"sink"` reactive-skip — descends into `given`/match-block/`try` bodies the pre-#405 classifier fenced out), `parenthesizeAwaitServerCallsInExpr` (match-arm EXPRESSION ctx, `alwaysWrap=true`). **`injectPromiseAwait` (the old per-statement string-regex pass) is RETIRED** — `emitLogicBody`'s nested-body `_injectAwait` is now IDENTITY (a no-op passthrough; `scheduleStatements`'s own sequential + grouping paths call `injectFnBodyServerCallAwaits` directly via a new `_autoAwaitFnBody` closure instead). The retired pass MIS-PARENED a receiver-tail call (`fn().ok` → bare-prefixed `await fn().ok` === `await (fn().ok)`, reading `.ok` off the pending Promise — the g-hash87 defect); the unified injector decides WRAP-vs-BARE per call site from its AST parent (a tight tail — member/index access, a further call, a tagged template — forces the paren wrap; anything else keeps the byte-identical bare prefix). | **codegen/emit-reactive-wiring.ts:536-537** (on-mount, unchanged consumer) + **`scheduling.ts`'s own `scheduleStatements`** (client fn bodies, NEW — every emitted statement, sequential AND grouped, now routes through `_autoAwaitFnBody`) + `emit-logic.ts`'s value-form `match`-arm lowering (`emitMatchExprDecl`). **Closes the whole `g-cps-scheduler-opaque-boundary-hides-nested-server-calls` family** (`scheduling.ts`'s `isControlFlowBoundary` no longer fences `given`/match-block/`try` from the fn-body walker) — resolves `g-given-block-server-call-no-autoawait`, `g-hash87-member-read-await-misparen`, `g-ternary-init-server-call-await-misbind` (see `docs/known-gaps.md`, all marked `status=resolved`). **The DIRECT value of `_scrml_reactive_set`/`_scrml_cs_reactive_set` is deliberately SKIPPED** (arg1 mode for on-mount, sink mode — ANY depth beneath a reactive/derived/init/engine sink call — for fn bodies) — `emit-client.ts`'s own IIFE matcher owns that lift. |
| **D-5 server module-const closure** | **codegen/emit-server.ts** `emitReferencedModuleConstLines(fileAST, assembledBody)` | the assembled `.server.js` bundle, emitted AFTER the value exports and BEFORE `finalEmitted` is joined. ADDITIVE — the client bundle is byte-unchanged. |
| **#263 CLIENT module-`export const` closure (S301) — the §14.8-gated sibling** | **codegen/emit-client.ts** `emitReferencedModuleExportConstLines` + `collectClientReferencedIdents` + `stripExportDeclInit` + `collectTopLevelReassignedNames` + `_fnNodeIsServerBoundary` | the `.client.js` bundle. **The reference set is built from AST `IdentExpr` nodes ONLY — never string-literal contents, comments or member-property keys — with TWO PRUNED subtrees (a server-boundary function body; a server-scoped cell's init).** The blocked first attempt matched by TEXT and would have shipped an `export const` used only inside a `server fn` (which lowers to a fetch stub that never names it) to the browser. A name appearing in a fetch stub / literal / comment can therefore never widen the set **by construction**, not by filtering. Fail-closed elsewhere too: `stripExportDeclInit` SKIPS multi-declarator and destructuring forms rather than guessing. |
| **#358 cross-FILE client-reachability seed (NEW #385)** | **`codegen/context.ts`** `CompileContext.crossFileClientReads: Map<sourcePath, Set<exportName>>` (NEW field), computed ONCE in `runCG` via `collectClientReferencedIdentsForAST` — the SAME confidentiality-safe prune the per-file #263 gate above uses (a server-only import never enters the set) | Both the EXPORTER (make `X` client-reachable when a DIFFERENT file's client code reads it via a direct `import { X } from './M.scrml'`) and the IMPORTER (keep `X` in the `_scrml_modules` destructure even when NR mis-tags an ALL-CAPS const as a component) route off this ONE ground-truth signal. `null` for test harnesses / single-file compiles — byte-identical there. **#386 (sibling fix, same window):** a type-ANNOTATED `export const` (`const X: T = …`) now emits via the AST `valueInit` field rather than the annotation-blind raw regex, which previously defeated `const \w+\s*=` matching and silently skipped the export entirely. **Native-parity PAID:** the export-decl's two new LIVE-only support fields (`valueInit`, `valueInitExpr`) are registered in `native-parser-canary/within-node-classifier.ts`'s `STRIP_KEYS` — the native parser builds the export-decl from the raw slice and never attaches them, so an unregistered field would have grown the within-node parity allowlist for a field neither side actually disagrees about (both routes emit the same `const`). |
| **`export let`/`var` runtime-value emission (NEW #388)** | **`codegen/emit-server.ts`** `emitModuleValueExportLines` — widened from `const`-ONLY to `const \| let \| var`, each keeping its own keyword in the emitted line | before this fix, a mutable `export let` closed over by an in-process PEER CALLABLE (not a direct `<endpoint>` reference) fell through to nothing here — a boot/route `ReferenceError: <name> is not defined`, silent until executed. **Companion fix, same PR:** a `serve=` tool's dead-local-import scan (`generateServerJs`'s `scanBody`) now unions `fileAST._serveImportReachabilityExtra` (stashed by `emit-tool.ts` from every non-import top-level statement) as an extra reachability root, so an import referenced ONLY from `main`/a setup helper survives tree-shaking (`g-serve-tool-treeshakes-main-only-import`). Both `undefined`-gated for the web-app path — byte-identical there. |
| **§17.1.2 structural `if=` (S302)** | **ast-builder.js** (capture) → **native-walker/attrvalue-exprnode-walker.ts** (exprNode) → **type-system.ts** (scope) → **dependency-graph.ts** (reader credit) → **codegen/emit-html.ts** (emit) | one attribute, five consumers, two native mirrors — the full table is below. |
| **§6.8 reset init-thunk reassignment skip (NEW #417)** | **codegen/reactive-deps.ts** `collectStructuralDeclNames(fileAST)` (NEW — walks logic bodies incl. if/for/while/match/try for `structuralForm:true` state-decls) → **codegen/emit-reactive-wiring.ts** (computes once per file, threads into `EmitLogicOpts.structuralDeclNames`, publishes to the module-level fallback via `setStructuralDeclNamesForFile`) → **codegen/emit-logic.ts** `_emitInitThunkSidecar` (the skip check) | `codegen/index.ts`'s two `EmitLogicOpts` construction sites also thread `structuralDeclNames` directly. See domain.map.md for the defect this closes. |
| **§17.1 `W-IF-IN-EACH` (NEW #416, GH adopter #409)** | **codegen/emit-each.ts** `_eachIfCondReferencesItem(rawCond, itemNames)` (string-literal-fenced item-reference detector) + `_eachItemBindingNames(iterVarName)` (widens to an `as (k,v)` destructure pair via the live each-reconcile ctx) | `renderTemplateChildToJs`'s deferred nested-per-row-`if=` branch — pushes `CGError("W-IF-IN-EACH", …, "warning")`. See domain.map.md. |
| **§14.8.11 queried-table grants (S292)** | **sql-table-refs.js** (NEW — `tableRefsInSql`/`sqlBodiesInSource`/`tableRefsInSource`) -> **commands/db-migrate.js** (`parseProjectSchema` returns `{queriedTables, queriedPrivileges, undeterminedSql}`; `runPgApply`'s signature widened to carry the first two) -> **schema-differ.js** `diffSchema(options.queriedTables, options.queriedPrivileges)` | the `GRANT <privs> ON <table> TO scrml_app` branch for NON-db-authoritative tables the app's `?{}` bodies touch. See migrations.map.md. |
| DB-authoritative tier — §14.8.11/.1/.2 | schema-differ.js + codegen/db-authoritative.ts + codegen/sql-ident.ts + codegen/tenant-egress.ts + commands/db-migrate.js | codegen/index.ts wires `appDeclaresDbAuthoritative`/`wrapPrincipalTxn` into emit-server.ts's `generateServerJs`; emit-channel.ts imports `quoteIdent` (aliased `pgQuoteIdent`). See error.map.md / domain.map.md / schema.map.md / migrations.map.md. |
| Confidentiality — tenant-row floor (§14.8.10) | codegen/tenant-egress.ts (`buildTenantContext` — two-arg since S288, unioning `<schema>`-declared tables; `resolveTenantScoping`, `classifyTenantWrite`, `detectTenantRawEgress`, `rewriteSelectAddTenantId`, `rewriteInsertAddTenantId`, `_scrml_active_tenant`/`_scrml_active_caps`) | codegen/emit-server.ts: E-TENANT-WRITE/AGG/RAW-EGRESS + I-TENANT-STRIP/ACROSS |
| Client Router — landmark + shell composition (§20.8.1.1/§40.8.2) | codegen/emit-html.ts (`treeHasAuthorMain`) + codegen/index.ts (`findOutletMarkedOpenTag`/`findBareMainOpenTag`, `retagOpenTag`, `findMatchingCloseIdx`, **`computeDependencyClientScripts` — 4-arg since GH #235**) | TWO STAGES, one invariant, communicating ONLY through the emitted `data-scrml-outlet` marker. |
| **Client Router — cross-chunk soft nav (navigate-wave1c, §20.8.2/§20.8.7)** | **runtime-template.js** (`_scrml_nav_client_chunks`, `_scrml_nav_missing_chunks`, `_scrml_nav_load_chunks`, `_scrml_nav_chunk_failed`, `_SCRML_NAV_CHUNK_TIMEOUT_MS`, the `_scrml_chunk_loading` DEPTH COUNTER) + **codegen/emit-event-wiring.ts** (the IIFE + `_scrml_boot` boot dispatch) + **codegen/emit-variant-guard.ts** (the same eager-vs-DCL dispatch for engine/match arm wiring) | `W-NAV-CHUNK-LOAD-FAILED` (IMPLEMENTED and cataloged — see error.map.md). **For WHAT re-runs on a nav and what does not, read the module-init/rehydrator table below — it is a different question from what LOADS the chunk.** |
| **§51.11 engine `audit` (S307 port onto `<engine>`)** | **codegen/emit-engine.ts** (`emitEngineSubstrate`, :2054 — emits `_scrml_engine_audit_register(varName, closure)` AFTER the cell inits) + **codegen/index.ts** (`_scrml_engine_audit_register` added to `CELL_SCOPE_ACCESSORS`, :490) | **runtime-template.js** `_scrml_engine_audit_targets` (:4914) / `_scrml_engine_audit_push` (:4936), called from `_scrml_engine_advance` (:5078) + `_scrml_engine_direct_set` (:5137). **A REGISTRY, not a 9th positional argument** — those two helpers are called from nine emit sites across five codegen modules and a site that forgot the argument would silently record nothing. The registration takes a CLOSURE, not a cell NAME, because the write path is the chunk-scope wrapper and a raw name resolves in the wrong key space (emitted fine, log stayed empty, only a live transition caught it). |
| **§51.13 auto property tests on the modern `<engine>` (S307)** | **codegen/emit-machine-property-tests.ts** `projectStateChildRules(stateChildren)` (:487) | **codegen/index.ts** (:2354-2375) builds a `name -> TransitionRule[]` map off `fileAST.machineDecls ?? ast.machineDecls` and passes it as `generateMachineTestJs`'s 4th arg. The generator substitutes it **only where `machine.rules` is empty**, so every legacy path is byte-identical. FEEDING the existing machinery rather than re-pointing it was the deliberate choice — `collectVariants`/`reachableVariants`/`resolveRule` all key off the `rules` shape. |
| SSR auth-scoped omission + SQL-interp classifier (§52.15.5) | codegen/sql-lex.ts | imported by codegen/collect.ts AND codegen/rewrite.ts so they CANNOT diverge |
| Colorless-async classification | codegen/emit-library-shared.ts, codegen/scheduling.ts, codegen/emit-expr.ts | emit-library.ts, emit-server.ts, emit-tool.ts, emit-logic.ts, emit-control-flow.ts, emit-functions.ts |
| Batch-hoist / server-call fencing (§19.9.9.2) | codegen/emit-server.ts + codegen/scheduling.ts | full control-transfer set + filler-distance across control-flow guards |
| Reactive value= form-control write | codegen/emit-bindings.ts (file scope, i174) **+ codegen/emit-html.ts -> binding-registry.ts `directiveIsFormValue` -> codegen/emit-variant-guard.ts (arm bodies, i225, NEW this window)** | a reactive `value=` on `<input>`/`<textarea>`/`<select>` writes the `.value` PROPERTY, inequality-guarded so re-assigning the same string cannot reset the caret. Falls through to `setAttribute` when a sibling `bind:value`/`bind:valueAsNumber` owns it. |
| **Per-item reconcile family (S293/S294)** | **codegen/emit-lift.js** (`computeItemDerivedReplay`, `_collectDeclNodesInScope`) + **codegen/emit-each.ts** (`pickReferencedEnclosingCtxs`, `referencesFreeIdent`, `enclosingResolvePreludeLines`, `enclosingResolvePreludeForHandler`) | per-item text/class/attribute/if/event bindings re-resolve the live item BY KEY and replay item-derived locals on REPLACE. Shadow-safe: a nearer ctx's binding suppresses re-resolving a same-named enclosing var (a `let` redeclaration would be `E-CODEGEN-INVALID-LOGIC`). |
| Tailwind utility registry + lint | **tailwind-classes.js** (`registerColors`/`registerBorders`/`registerEffects`/`registerRing`/**`registerOutline` NEW D-3**/`registerGradient`/`registerTransform`/`registerTransition`…, `findUnsupportedTailwindShapes`, `findUnrecognizedClasses`, `validateArbitraryCss`) | `W-TAILWIND-001`, `W-TAILWIND-UNRECOGNIZED-CLASS`, `E-TAILWIND-001` — see error.map.md |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target |
| CSS emission / conflict check | codegen/emit-css.ts, codegen/emit-theme-reset.ts / codegen/css-conflict-check.ts | §65 Wave-1; E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Reactive-attr writer-ownership (#81) | codegen/emit-html.ts (`analyzeWriterConflict`) | `E-ATTR-WRITER-CONFLICT`, or a `LogicBinding` with `isReactiveValueAttr`/`valueAttrName`/`valueAttrKey` |
| Session establishment | compute-program-config.ts, route-inference.ts, codegen/emit-server.ts, codegen/emit-expr.ts | §20.5 `session.*` server builtin — see auth.map.md |
| **§18.5 match BLOCK-ARM in VALUE position — FOUR EMISSION ROUTES, ONE SHARED LEAF PREDICATE (#447 → #463 → #469/#470 → #479)** | **codegen/emit-logic.ts** owns the machinery: `planBlockArmLift(inner)` (:4715, **exported — the shared segmenter+plan for the TWO RAW-STRING routes only, exactly TWO call sites**: `:4738` here and `emit-control-flow.ts:2221`) · `_splitBlockStatements` (:4580) · `_closesBlockStatement` (:4550) + `_BLOCK_STMT_HEAD_RE` (:4520) + `_BRACE_CONTINUATION_RE` (:4528) · `_matchArmResultIsBlockBody` (:4637) · **`_blockTailIsValueExpr` (:4653) — THE SINGLE SHARED LEAF PREDICATE, and the only symbol all four routes touch** · `_emitBlockArmValueFromString` (:4734). **codegen/emit-control-flow.ts** imports all of `planBlockArmLift`, `_awaitMatchArmServerCalls`, `_matchArmResultIsBlockBody`, `_blockTailIsValueExpr` (:3) and owns `emitIifeBlockArmBody` (:2090) + the structuredBody arm path (~:2320). | **⚠ CORRECTION TO THE PRIOR GENERATION OF THIS ROW, and it already cost a dispatch: `planBlockArmLift` is NOT "the single classifier every path routes through".** Four routes: **A** local-decl structured-AST (`emit-logic.ts:emitMatchExprDecl` :4763, predicate at :4882) · **B** local-decl raw-string (`_emitBlockArmValueFromString`, via `planBlockArmLift`) · **C** IIFE structured-AST (`emit-control-flow.ts` :2354, predicate DIRECT) · **D** IIFE raw-string incl. §18.19 multi-scrutinee (`emitIifeBlockArmBody`, via `planBlockArmLift`). **A grep for `planBlockArmLift` finds two of four. Grep `_blockTailIsValueExpr` to enumerate them all.** A/C do not segment because an AST body already IS a statement list — a design property, not an omission. **Scope from the layer that moved:** a segmentation defect reaches B and D only; a predicate defect reaches all four. Landed corrections in order: #463 moved the keyword fence OUTSIDE the alternation and to `(?![A-Za-z0-9_$])` not `\b` (scrml identifiers admit `$`; invariant 46); #469/#470 unified the tail classifier across value-position IIFE paths after a member/index-assignment tail was found LIFTING on one route and VOIDING on another; **#479 made a depth-0 `}` closing a block-bodied statement a statement boundary** — before it, `{ let a = 0; for (…) { a = 1 } a }` split into two segments, the tail was swallowed into a `for`-headed segment, and the arm evaluated to `undefined`, which does not exist in scrml (§42.1.1). **The defect was SEPARATOR-dependent, not position-dependent**, which is why the corpus never tripped it. Pinned by `match-block/{block-arm-tail-after-block-statement,block-arm-nested-assignment-fidelity,value-form-block-arm-all-paths,value-form-block-arm-derived-reactive,member-assign-tail-voids-all-paths}` + `unit/match-block-arm-tail-after-block-statement.test.js` (318L). |
| **§17.2 `show=`-false SSR hide — ~~#450~~ REVERTED IN FULL by #464 (`0536a90f`, operator-ruled)** | **codegen/emit-html.ts is BYTE-IDENTICAL to `71623be3`** (verified: `git diff 71623be3 6f176c0d -- compiler/src/codegen/emit-html.ts` is EMPTY). `buildInitialBoolMap`, the `initialBoolMap` local and the `_showInjectFreshStyle` / `_showMergeIntoStyle` emit-site flags **do not exist in this tree** — grep confirms zero hits. | **`show=` injects NO inline `display:none` at SSR time. §17.2 first paint is owned entirely by the client hydration controller.** Replaced by a regression guard pointing the OTHER way: `control-flow/ctrl-017..ctrl-020` each assert `count: 0` for `[style*="display:none"]`. **Why the revert, from `ctrl-017`'s rationale — this is the reusable lesson, not a one-off:** a `<match>` arm body is lowered by the SAME `generateHtml`, so an emit-time hide is baked into the string literal `dispatch` assigns to `_mount.innerHTML`; the re-mounted element carries no controller (`wire_<Arm>` does not re-bind a visibility toggle, `_scrml_nav_rewire` is never re-run on a variant swap), so the baked hide could NEVER be cleared. **§17.2 says "toggle"; a toggle needs a toggler.** The direction is now fail-OPEN — a missed hide is a brief flash, a wrong hide is permanently invisible content. The unit test `show-false-ssr-hidden-no-fouc.test.js` was deleted with the code. |
| **`<each>` `:`-shorthand markup-fn mount (#456) — NARROWED by #466 (S328)** | **codegen/emit-each.ts** — re-parses the shorthand child expr through `expression-parser.ts`'s `parseExprToNode` (a LAZY `require` at the use site, deliberately not a module-top import) and routes it through `maybeWrapEachPerItemEffect`. **NEW: one shared module-local `const _isRcdataBody = isRcdataElement(tagName)` (:1169)** read by BOTH per-item body branches — the shorthand branch (`shMarkupCapable && !_isRcdataBody` :1244, the `.value` write :1250) and the bare-body `_rcdataValueExpr` gate (:1183) — so the two cannot drift apart under §4.14 byte-identity. | a `:`-shorthand each body whose child is a markup-RETURNING fn call MOUNTS per row (`g-each-nested-residual-1`) **except inside RCDATA (`<textarea>`), where the mount is refused and the expression is written to `.value`.** **#456's own rationale block carried a FALSE premise and #466 left it in place verbatim rather than silently rewriting it:** it claimed a string-returning shorthand "never over-wraps -> no restricted-parent regression", but `shMarkupCapable` is a **MAY-analysis** — `fnBodyReturnsMarkup` admits a fn if ANY return is markup, so a mixed-return callee is markup-capable even on the calls handing back a plain string. `interpMayYieldNode` cannot tell the two apart, so that premise was never something the discriminant could deliver. **The name to grep is `_isRcdataBody`; `eachBodyLowering` / `TEXT_ONLY_CONTENT_ELEMENT_NAMES` / `EachBodyLowering` were the first attempt (`2c89086c`), rejected by the S239 gate and DELETED.** +3 conformance cases under `conformance/cases/each/`. |
| Content-hash asset naming | api.js pre-pass (`fnv1aHash`, gated on `contentHashAssets`) | build.js's `generateServerEntry` |
| Validate emit | codegen/validate-emit.ts | final artifact sanity |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution |

## `ifRaw` / `ifCond` — ONE attribute, FIVE consumers, TWO native mirrors (§17.1.2, S302)

The most useful thing to know about a structural `if=` is not where it is emitted — it is that
**every stage routes through the SAME function the markup `if=` path uses, deliberately, so a
structural predicate and a markup predicate are structurally incapable of diverging.** A private
re-implementation at any one of these is the defect this arc removed. Adding a second structural
attribute later means walking this exact list.

| # | Stage | Symbol | The rule |
|---|---|---|---|
| 1 | **Capture** | `ast-builder.js` `captureStructuralIfAttr` (**:2731** — was cited `:2705`) + `structuralHeaderAnchor` (**:2823** — was `:2797`) | Re-parses a SYNTHETIC `<x if=…>` opener through the SAME `tokenizeAttributes` + `parseAttributes` a markup opener uses. The value object is byte-for-byte what `<div if=…>` produces — that is what lets four hosts share one lowering. Offsets rebased −3 so diagnostics anchor in real source. |
| 2 | **ExprNode** | `native-walker/attrvalue-exprnode-walker.ts:208` | Populates `ifCond.exprNode` (and strips native's extra `sourceText`). |
| 3 | **Scope check** | `type-system.ts` `visitStructuralIfAttr` (**defined :13190**, called :12721 + :12811 — the map cited `:12688`, which is neither) → `visitAttr` | **Called BEFORE `scopeChain.push("each:…")`.** The opener predicate is evaluated OUTSIDE the per-item scope, so `if=item.ok` must NOT resolve against the row binding — reordering these two lines silently makes a wrong predicate compile clean. |
| 4 | **Reader credit (DG)** | `dependency-graph.ts` `creditFromAttrValue` (:2559), called for `ifCond` at :2930 | **`ifRaw` is deliberately NOT in the raw-scan lists** (:2964 / :3020 / :3088 carry that note). A private `/@ident/` scan over the raw text diverges in BOTH directions: it reads inside string literals (over-credit) and misses an `if=fn()` call-ref's `fnTransitiveReads` (under-credit). Without this consumer, a cell read ONLY by a structural gate false-fires `E-DG-002`. |
| 5 | **Emit** | `codegen/emit-html.ts` `emitGatedStructural` (**:1516** — was `:1498`) → `emitIfMountGate` (**:1439** — was `:1421`); kind test `isGateableIfValue` (**:1490** — was `:1472`) | The sole `if=` lowering; the `E-IF-IN-DISPATCHED-ARM` guard fires here too (**:1526** — was `:1508`; `refuseConditionalInDispatchedArm` is defined at `:802` and has THREE call sites — `:1526` structural, `:1755` if-chain, `:2745` markup). No `ifCond` field ⇒ byte-identical to the pre-§17.1.2 emitter. |
| — | **Native mirrors** | `native-parser/collect-hoisted.js` `readStructuralIfAttr` (:420); `native-parser/parse-file.js` (:762 match, :1081 each, `stripSourceTextFromValue` **:1611** (was cited `:1681`)) | A landing that adds an AST FIELD to a structural node owes these. An emit-time / runtime / CLI / message-only landing does not. |

**Field-shape invariant:** `ifRaw` and `ifCond` are **ABSENT, not null**, when the opener has no
`if=`. The within-node parser-parity canary compares FIELD SETS; null-stamping every
engine/match/each in the corpus surfaces as a divergence on the ~2 nested-engine positions where live
emits `text`/`comment` and native emits an `engine-decl`, growing the allowlist for a field neither
side actually disagrees about. Precedent on the same node family: `engine-decl.bodyChildren`.

**`ifCond` lives on the AST NODE, not in `engineMeta`.** That placement is load-bearing: it puts the
predicate out of reach of the JS-substrate emitters that build the engine's cell and rules, which is
what enforces §17.1.2.1's render-vs-lifecycle split structurally rather than by convention.

## §55 SYNTH-KEY RULE — FIVE COPIES, TWO RESOLUTION ORDERS, ONE OPEN DIVERGENCE (NEW section, S372)

**The rule:** an `@<compound>[.field].<synthProp>` read (`isValid` / `errors` / `touched` /
`submitted`, the `SYNTH_PROPERTY_NAMES` set imported from `symbol-table.ts`) whose DOTTED key is a
registered §55 synth cell must lower to `_scrml_reactive_get("<dotted>")` — the flat key — **not** to
a member access on the compound's value object. The compound is a §6.3 Variant C NAMESPACE whose
value object carries only its field keys, so the member form reads `undefined` (silent, never mounts)
or dereferences `null` (a `TypeError` inside `_scrml_boot` → **the whole page never wires**).

**Read this table before you touch any of the five.** #704 exported one implementation to reduce the
copy count; `emit-expr.ts:1029-1030` states in as many words that this **did not make N equal 1**.

| # | Site | Resolution order | Consults `synthCellKeys`? |
|---|---|---|---|
| 1 | `emit-expr.ts` `emitMember` (**:2588**, synth branch **:2623-2631**) via `synthDottedKey` (**:2701**) | **LONGEST key first** — build the WHOLE chain, test that one key, no tail | yes (`ctx.synthCellKeys?.has(dotted)`) |
| 2 | `emit-expr.ts` **`resolveSynthCellPrefix`** (**:1032**, the export) | **SHORTEST prefix first** — scan segments upward, first synth-property segment whose prefix is registered wins, remainder returned as `tail` | yes (arg) |
| 3 | `emit-expr.ts` `collapseSynthSurfaceRefsInRaw` (raw-string client-statement fallback) | delegates to #2 | yes |
| 4 | `emit-event-wiring.ts` `computeDisplayToggleCondition`, `varName`+`dotPath` branch (**:541**) — the `if=`/`show=` toggle | delegates to #2, then applies a shape gate (below) | yes |
| 5 | `emit-event-wiring.ts` `computeChainBranchCondition`, `condition.name` arm (**:789-791**) — `else-if=@cfg.errors` | **NONE — emits `_scrml_reactive_get(<whole dotted path>)` with no membership test at all**, fabricating a key nothing registered | **no** |

⚠ **#1 AND #2 DISAGREE, AND THE DISAGREEMENT IS FILED, NOT THEORETICAL.** On
`@signup.errors.isValid` (a compound with a field literally named `errors`) longest-first resolves
`signup.errors.isValid` and shortest-first resolves `signup.errors` + tail `.isValid` — a read off the
rollup MAP, permanently `undefined`. **`emitMember` is the CORRECT side on that shape.** Converging
them means moving `emitMember` onto longest-key-first for both, a change to the AST member path with
its own blast radius — `g-synth-key-resolution-diverges-between-emitmember-and-shared-helper` (MED,
open). Site #5 is `g-else-if-dotted-cell-ref-emits-unregistered-flat-key` (MED, open, #692).
⚠ **THE LEDGER'S LOCUS FOR #5 IS STALE AT THIS WATERMARK** — `docs/known-gaps.md:2561` says
`emit-event-wiring.ts:647`; the arm is at **:789**, because #704 inserted 192 lines above it. Grep
for `condition.name`, do not seek `:647`.

**Site #4 carries a SHAPE GATE the other four do not, and it is not optional.** §55 does not give
every synth cell a scalar: the compound-level `errors` and `touched` rollups are OBJECT MAPS keyed by
field name, and an object literal is always truthy — collapsing them would turn a gate that read
`undefined` (never mounts) into one that is unconditionally true, rendering a pristine form's error
block at boot. The gate is DERIVED from the same key set the collapse reads (invariant 65), never an
allow-list: `<prefix>.submitted ∈ keys` IS the "prefix is a compound parent" test (§55.7 gives
`submitted` to parents only), and `seg` names a FIELD iff `<prefix>.<seg>.errors ∈ keys` **AND**
`<prefix>.<seg>.submitted ∉ keys`. The exact collapse/decline matrix, PA-measured by compiling at
this watermark, is in domain.map.md.

## Indirect callee resolution (#284, S303) — a SECOND call graph, on purpose

| Producer | Consumer | The rule |
|---|---|---|
| `indirect-callee-resolver.ts` — `resolveIndirectCallees` / `indirectResolvedCallees` / `aliasNamesResolvingTo` / `fnParamNameSet` / `dispatchTableNamesWithPeers` / `dispatchTablePeerMembers` | `route-inference.ts` (import :77) → `indirectInverseCallerMap` (:4707) → the Step 5c caller-context fixed point (:4774-4810) | **`inverseCallerMap` (:4466) stays BYTE-IDENTICAL** — it also drives `E-ROUTE-001` and the D4 `W-DEAD-FUNCTION` gate, and the S299 measurement of widening the shared walk was **72 corpus sites** of over-escalation. Indirect edges therefore get their own map, consulted by exactly one caller. |
| `indirectInverseCallerMap` | Step 5c placement | **ESCALATION-ONLY (FIX A, :4758).** SERVER indirect caller ⇒ promotion pressure. CLIENT indirect caller ⇒ **IGNORED** — counting it demotes a directly-server-called helper to client, and the server caller then references an undefined symbol → 500. |
| `markupReferencedNames` | the same fixed point (:4766) | **FIX B — a helper referenced from CLIENT MARKUP is EXCLUDED from indirect escalation.** Relocating it turns a synchronous render into a blanking async fetch. Its DIRECT-server-call escalation, if any, is baseline and left intact. |
| `aliasNamesResolvingTo` → `EmitLogicOpts.serverFnPeerAliasNames` | `emit-server.ts` → `emit-logic.ts` → `emit-control-flow.ts` (`_makeExprCtx`) → `emit-expr.ts` `EmitExprContext.serverFnPeerAliasNames` (:473), consumed :1488 + :3013 | The await-lowering half: `alias(...)` is awaited like the peer it aliases. NULL/empty ⇒ byte-identical pre-fix emission — every threading site is written that way, so a file with no alias peers is unaffected. |

| **`IndirectResolution.dispatchCalledTargets` (NEW, :71)** | route-inference placement + emit-server emission, each intersecting it with its own function/peer universe | The names reached through a DIRECT dispatch CALL — `t["k"](…)` / `t.k(…)` resolve to that member, `t[dyn](…)` to the WHOLE member set (any could be the target). **Plus a RAW-TEXT scan for a dispatch call inside a template literal or a `?{}` SQL body:** a template's `${…}` is never decomposed into AST nodes, so a `t[k]()` there was invisible, its target got no caller edge, was dead-code-dropped, and the emitted call threw `ReferenceError`. The trailing `(` requirement keeps a bare member READ (`${t.a}`) from escalating. Reassigned tables never enter `tableBindings`, so they resolve to nothing. |
| `dispatchTableNamesWithPeers` / `dispatchTablePeerMembers` (`IndirectResolution.tableBindings`) | `codegen/emit-server.ts:3571` / `:3573` (import `:23`) — ⛑ **S384: the carried `:3043` / `:3045` were ALREADY WRONG pre-window; RE-DERIVED BY GREP** | **A DIRECT dispatch call `t[k](...)` / `t.k(...)` has a MEMBER/INDEX callee, not a bare ident, so it is absent from `calledNames` entirely** — the alias path cannot see it. Two exports because they answer two different questions: `…NamesWithPeers` gates AWAIT-lowering (conservative: the table has ≥1 peer member; over-awaiting a sync value is a no-op, under-awaiting leaks a Promise), `…PeerMembers` gates EMISSION (a `{k: peer}` entry references the peer as a VALUE, so the callable must exist even if `t[k]()` is never called — otherwise a bare `ReferenceError`). Reassigned tables are dropped before either runs. |

Resolution is **SAME-FILE first**, falling back to the global name set only when no same-file binding
exists (mirrors the 5c-bis precedent). A DEAD value reference is not a call and creates **no** edge.

## Module-init vs the soft-nav rehydrator — WHO emits what, and what re-runs on a nav

**The routing question the prior generation of this map could not answer.** A dev agent asking
"where is per-chunk module-init emission produced, and what owns the boundary between it and the
registered rehydrator?" was routed to `codegen/index.ts` + `runtime-template.js`. **Both are wrong
loci.** The producers are `emit-client.ts` (assembly), `emit-reactive-wiring.ts` (the lifecycle
bodies) and `emit-event-wiring.ts` (the boundary itself).

| What | Emitted by | Where it LANDS in the chunk | Re-runs on a soft nav? |
|---|---|---|---|
| cell inits, `<match>`/`<each>` dispatchers, engine substrate + hydration + opener `effect=` | `emit-client.ts` `generateClientJs` `lines[]` | **module-init** (script eval) | **NO** |
| `<timer>` / `<poll>` `_scrml_timer_start(scope, id, ms, fn, immediate)` | `emit-reactive-wiring.ts` `emitLifecycleNode` (via `emitReactiveWiring`, called at `emit-client.ts:2355`) | **module-init** | **NO — starts once, ever** |
| **the `<timer>`/`<poll>`/`<timeout>` BODY itself** | `emit-reactive-wiring.ts` (the tick / `setTimeout` callback) — **and, until #510, ALSO by `collect.ts`'s `collectTopLevelLogicStatements`, which descended the tag and emitted the body a SECOND time** | the callback; **pre-#510 also module-init** | **NO** — but pre-#510 it RAN ONCE AT LOAD before the timer ever fired (`g-timer-poll-body-runs-once-at-module-init`). Fixed by `DEFERRED_LIFECYCLE_BODY_TAGS`; `<request>`/`<channel>` deliberately excluded from that set because their descent IS their only correct emission |
| `<keyboard>`/`<mouse>`/`<gamepad>`, `<request>`, `<timeout>`, `_bindProps` | `emit-reactive-wiring.ts` (`classifyMarkupNodes` :1081) | **module-init** | **NO** |
| desugared `on mount { … }` | `emit-reactive-wiring.ts:536` (`_onMountEffect`) | **module-init**, inside a generated `(async () => {…})().catch(...)` when it calls a server fn | **NO** |
| `ref=` / `bind:` / `class:` wiring (`_scrml_bind_rewire`) | `emit-client.ts:2464-2470` | **module-init**, as a re-invokable root-scoped fn | **NO — deliberately NOT registered as a rehydrator** (it would re-attach listeners to elements that still carry boot's) |
| delegated `click`/`submit` document listeners | `emit-event-wiring.ts` (inline, inside `_scrml_boot`) | inside `_scrml_boot` | **N/A — they survive a swap on their own** |
| **non-delegable handlers + reactive DISPLAY binding** | `emit-event-wiring.ts` accumulators `nonDelegatedRewire` (:1021) + `reactiveRewire` (:1032) | **`_scrml_nav_rewire(root)` at :2165**, inside `_scrml_boot` | **YES — this is the entire rehydrator** |
| §20.8.3 link-boost | `emit-client.ts:2497-2503`, gated on `fileHasOutlet` | module scope, its own `DOMContentLoaded` handler registered AFTER the author's | N/A (delegated on `document`) |

**NEW THIS WINDOW (#510, §6.7.6) — the immediate first tick has a SPLIT locus, and both halves
matter.** The GATE is at the emit site (`emit-reactive-wiring.ts` decides whether to append `, true`,
`, _scrml_reactive_get("<var>")`, or nothing, based on tag and `running=`); the FIRE is at the arm
site (`runtime-template.js` `_scrml_timer_start`'s fifth `immediate` param calls `tick()` once, after
`setInterval`). **It routes through the same `tick()` as every other tick, so it inherits the queuing
and error handling rather than duplicating them** — and it is never re-fired on resume, because it
lives in `_scrml_timer_start` and not in `_scrml_timer_resume`. `<timer>` passes no fifth argument at
all (§6.7.5), so its emission is byte-identical to pre-fix.

**The boundary is emission ORDER, not a structure.** `emit-event-wiring.ts:715-716` pushes
`(function() {` + `function _scrml_boot() {`; `:2186-2193` closes them and emits the dispatch
(`_scrml_chunk_loading` truthy ⇒ boot NOW; else defer to `DOMContentLoaded`). So everything
`emit-client.ts` pushed BEFORE its `emitEventWiring(...)` call at `:2475` is module-init, and
everything that call returns is inside the boot fn. Nothing marks the seam.

**Registration:** `_scrml_register_rehydrator` (`runtime-template.js:2684`) → `_scrml_rehydrators`
(:2683) → replayed by `_scrml_rehydrate_region(root)` (:3162), which `_scrml_nav_apply_html` (:3060)
calls at :3094 — ⛑ **S384: ALL FIVE were ALREADY WRONG before this window (`:2629`/`:2628`/`:3098`/`:2996`/`:3032`);
`runtime-template.js` below :5599 did NOT move this window, so the drift predates it. RE-DERIVED BY GREP** — AFTER `_scrml_teardown_region(liveOutlet)` at :3026.

**The emit-time region↔resource association EXISTS and is LEXICAL** — `emit-reactive-wiring.ts`
`classifyMarkupNodes` carries an `insideOutlet` flag and stamps `node._outletResident` (:1105 for
`<timer>`/`<poll>`, :1114 for input-state), which routes the teardown into `_scrml_region_cleanups`
(:1273-1277 / :1310) instead of the boot-once `_scrml_register_cleanup`. **It never fires for route
content, because route content is in a different FILE from the shell that owns the `<outlet>` and is
therefore never lexically inside one.** `fileHasOutlet(fileAST)` (:1042) discriminates SHELL files
and is likewise insufficient for the single-file `<page>` form. Read this before scoping
`g-route-timer-poll-not-stopped-on-soft-nav`: the machinery is right, the granularity is wrong.

## Runtime-chunk gating — the tree-shake locus (READ BEFORE FIXING A BUNDLE ReferenceError)

Three files, one decision, and **none of them is `codegen/index.ts`**:

1. **`codegen/emit-client.ts` `detectRuntimeChunks(fileAST, ctx)` (:273)** — the PRE-EMIT AST walk.
   Registers a chunk when a walkable AST shape proves it is needed. Reads `compute-pgo-flags.ts`
   results for the `reset` / `equality` / for-stmt gates and `ctx.hasPrefetchableLinks`. Several
   emitters (`emit-control-flow.ts:625`, `emit-html.ts:3314/3890`, `route-splitter.ts`,
   `reactive-deps.ts`, `emit-synth-surface.ts`, `context.ts`) carry "both sites must agree" comments
   pointing back here — those are MIRRORS of the gate, not the gate.
2. **`codegen/emit-client.ts` `POST_EMIT_HELPER_CHUNK_GATES` (:2167)** — the POST-EMIT reference
   scan, for helpers no pre-emit AST walk can see (wiring minted from the binding registry at emit
   time). Entries match as **SUBSTRINGS** of an emitted line: a trailing `(` pins a CALL site, a
   bare name also catches a VALUE / `typeof` reference. Current table:
   `["_scrml_structural_eq(", "equality"]`, `["_scrml_reset(", "reset"]`,
   **`["_scrml_message_for", "messages"]` (NEW, GH #234)**. The scan runs BEFORE
   `cell-accessor-rename.ts`'s `_scrml_cs_` rename, which is why the bare-name entry is exact
   (`_scrml_cs_message_for` does not contain `_scrml_message_for` as a substring).
3. **`codegen/runtime-chunks.ts` `CHUNK_DEPENDENCIES` (:384)** — declarative cross-chunk edges,
   transitively closed at the END of `detectRuntimeChunks` before the chunk set is frozen.
4. **`codegen/runtime-chunks.ts` `RUNTIME_CHUNK_ORDER`'s `stdlib-*` MEMBERS (NEW LOAD-BEARING ROLE, #669)** —
   the stdlib half of this array is not a tree-shake hint, it is the **CLIENT CONTRACT**. A client-side
   `import { x } from 'scrml:NAME'` lowers UNCONDITIONALLY to `const { x } = _scrml_stdlib.NAME;` and
   that property is defined by the `stdlib-NAME` entry **and by nothing else** — absent, the
   destructure reads `undefined` and THROWS AT BUNDLE LOAD, killing the whole page. **4 -> 13 chunks
   this window; 17 of 21 modules were DOA before it.** `STDLIB_CLIENT_CHUNK_MODULES` (:349) and
   `hasStdlibClientChunk` (:381) are DERIVED from this same array so the gate
   (`E-STDLIB-CLIENT-CHUNK-MISSING`, `emit-client.ts:3817`) and the outcome cannot drift — the S368
   defect was a gate reading `existsSync` of a shim FILE (all 21 exist) while the deciding property
   was chunk registration. ⚠ **Matching is EXACT: a SUBMODULE does not inherit its root's chunk**,
   because `scrml:auth/jwt` lowers to `_scrml_stdlib.auth/jwt`, which JS parses as the DIVISION
   `_scrml_stdlib.auth / jwt`. **If you are fixing a bundle `TypeError` on a `scrml:` import, this is
   the list — not the shim directory.**

**GH #234, the shape to recognize:** `<errors of=…/>` wiring (emit-event-wiring.ts) captures
`_scrml_message_for` as a VALUE behind `typeof` rather than calling it, so the call-form gate could
not match; the `messages` chunk that DEFINES it was gated only on a state-decl validator carrying an
inline override. The `typeof` guard did NOT save it: `_scrml_message_for` is a
`CELL_SCOPE_ACCESSOR`, so the post-hoc namespace rename rewrote BOTH occurrences — including the one
inside `typeof` — to `_scrml_cs_message_for`, whose wrapper the chunk prologue ALWAYS defines. The
guard therefore always took the true branch and the `ReferenceError` fired inside the wrapper body
at the top of `_scrml_boot`, aborting boot before any handler bound. Adopter symptom: a login form
issuing zero network requests while every server route was green.

## Coordinate space — SOURCE vs DIST (D-4, S296). The class, not just the bug.

**The dist tree is NOT a mirror of the source tree.** SPEC §47.9.5 strips a leading `pages/`
segment from `dirname(relative(outputBaseDir, source))`, so `pages/login.scrml` lands at
`dist/login.server.js`, NOT `dist/pages/login.server.js`. The strip applies to the DIRNAME only;
the basename is untouched.

- **Emission.** `emit-server.ts` previously swapped only the extension on `stmt.source`, which
  overshoots by exactly one segment for every importer under `pages/`: a source-space
  `../models/auth.scrml` became `../models/auth.server.js`, which from `dist/login.server.js` points
  ABOVE `dist/`. The compile stayed GREEN (a missing file is not a syntax error) and the bundle died
  at runtime with `Cannot find module`. Now `distRelativeServerSpecifier` expresses BOTH endpoints in
  post-strip dist space and takes the relative path between them, prefixing `./` when needed (a bare
  `models/auth.server.js` would be a node_modules lookup). Falls back to verbatim when
  `outputBaseDir` is absent or either endpoint is outside the base. On a project with no `pages/`
  segment the two spaces coincide and the emit is byte-identical.
- **Reversal.** `api.js` must reverse an emitted specifier back to a SOURCE path to look the target
  up in `cgResult.outputs` (source-keyed). The inverse transform is **AMBIGUOUS** — a dist
  `models/auth.server.js` could come from `models/auth.scrml` OR `pages/models/auth.scrml` — so
  reversal is a FORWARD INDEX, not an inverse: `distServerKeyToSource` maps every compiled source to
  the dist-relative `.server.js` it writes, through the same `pathFor` transform.
  `serverImportTargetSource` is two-tier (dist first, source as the legacy no-`outputBaseDir`
  fallback), mirroring emit-server's two emission modes one-for-one.
- **Why the guard was silent.** `W-SERVER-IMPORT-UNEMITTED` exists precisely to catch a runtime
  `Cannot find module`, and it stayed quiet on the D-4 reproducer because it validated in the ONE
  space where the path is always self-consistent. **The oracle inherited the implementation's
  coordinate assumption** (the S276 shape). `rewriteRelativeImportPaths`'s `.server.js`/`.client.js`
  skip is still correct, but its OLD justification ("they live at the same relative position as
  their source") was FALSE — the skip is correct only because the emitter now speaks dist space.

## §14.8.11 DB-authoritative tier — the `scrml db-migrate` command graph

`commands/db-migrate.js`'s `runDbMigrate(args)`: `parseArgs` (`--db`, `--dry-run`,
`--allow-destructive`) -> `parseProjectSchema` (live parse pipeline `splitBlocks`->`buildAST`, then
`extractDesiredSchema` per file, merging first-decl-wins; **NOW ALSO** unions
`tableRefsInSource(source)` across every file into `{queriedTables, queriedPrivileges,
undeterminedSql}`) -> the `E-DBAUTH-SQLITE` / `E-DBAUTH-NO-TENANT-COLUMN` pre-flights + an explicit
operator warning per `undeterminedSql` entry -> either `runPgApply({connectionString, desired,
dryRun, allowDestructive, queriedTables, queriedPrivileges})` or `runSqliteApply`. `printPlan(plan,
actualTableCount, warnings)` distinguishes an EMPTY plan from a WITHHELD one.

`schema-differ.js`'s `parseSchemaBlock` is the SHARED parser both `db-migrate` (via
`extractDesiredSchema`) and the pre-existing SQLite migrate path consume — brace-depth-aware,
returns `{tables, fns}` (`fns` is ADDITIVE, so all five pre-existing `.tables` consumers —
protect-analyzer.ts, channel-watches.ts, gauntlet-phase1-checks.js, codegen/index.ts,
db-authoritative.ts — are unaffected).

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| **sql-table-refs.js (NEW S292)** | A bounded identifier SCANNER over `?{}` SQL bodies — **explicitly not a SQL parser**. `tableRefsInSql(sql)` / `sqlBodiesInSource(source)` / `tableRefsInSource(source)` return `{tables, privileges, undetermined}`. `TABLE_INTRODUCERS` pairs each clause with the privilege it implies (`PRIV_RANK` resolves `DELETE FROM`'s double match); `UNRESOLVABLE` enumerates the five deliberately-unhandled shapes (CTE, subquery in FROM/JOIN, LATERAL, dynamic EXECUTE). **A caller MUST NOT read an empty `tables` as "touches nothing"** — that is how the bug re-reproduces on a different table, and it fails closed at runtime as an opaque `permission denied`. Consumed ONLY by commands/db-migrate.js. |
| codegen/scheduling.ts | Colorless-async + batch-hoist scheduling, **plus (NEW this window) the emitted-JS scanner family**: `scanEmittedCode` tracks code / `'` / `"` / template-literal (incl. re-entrant `${}`) / `//` / block-comment modes, raises one depth counter on `(`/`[`/`{`, and reports depth-0 statement ends + depth-0 BLOCK brace groups (an object literal's closer is NOT a statement end). Consumed by emit-reactive-wiring.ts only. |
| codegen/db-authoritative.ts | `appDeclaresDbAuthoritative` (conditional-engagement gate), `wrapPrincipalTxn` (A1/S2 scope-aware txn wrapper, brace-scope-stack tracked so module-level infra helpers are never wrapped), `extractDesiredSchema` (+ `W-DBAUTH-MARKER-NEARMISS`). Unchanged this window. |
| codegen/sql-ident.ts | `quoteIdent(name)` — doubles an embedded `"`. The ONLY safe way to interpolate a DB identifier anywhere in the pipeline. Imported by schema-differ.js and codegen/emit-channel.ts (aliased `pgQuoteIdent`). Unchanged this window. |
| schema-differ.js | The differ + DB-authoritative DDL emitter. Exports: `parseSchemaBlock`, `readActualSchema`, **`columnConstraintDrift` (NEW)**, `diffSchema`, `generateCreateTable`, `DBAUTH_ROLE`/`DBAUTH_POLICY`/`DBAUTH_TENANT_GUC`/`DBAUTH_CAPS_GUC`, `generateBoundedRoleDDL`, `generateDbAuthoritativeDDL`, `generateScrmlHasCapDDL`, `generateSecdefDDL`, **`referencesHint` (NEW)**, `findNonLiteralSetItems`, `mapPgTypeToScrml`, `emitScrmlSchemaSource`. |
| codegen/chunk-namespace.ts | per-compilation-unit namespace for the runtime-global token space. Owns `nsId`/`nsName`/`nsCellKey`/`stripNsName`, `chunkNamespaceToken`, `resolveProjectRoot`, `buildCellOwnerMap`, and `assertChunkTokensDistinct` (a hard error, deliberately NOT `E-CG-010`). |
| codegen/cell-accessor-rename.ts | `renameCellAccessors` — the Acorn-parse + range-SPLICE pass rewriting every cell-accessor CALL to its `_scrml_cs_` chunk-local wrapper. The SOLE producer of `_scrml_cs_*`. **Runs at bundle assembly in index.ts, AFTER emit-client.ts's post-emit chunk scan** — that ordering is what makes the bare-name gate entry exact. |
| codegen/fnv1a-hash.ts | the shared FNV-1a 32-bit -> 8-char base36 primitive (§47.1.3). |
| **codegen/log-loc.ts** | the §20.6 per-file source registry (`registerFileSource`) and **TWO projections off it**: `resolveLogLoc` -> a `"basename:line"` STRING baked into emitted JS for the `log()` origin tag, and **`resolveSpanLineCol` (NEW S397, `:123`) -> numeric `{line, col}` for a DIAGNOSTIC span, or `null`**. ⚑ It exists because `expression-parser.ts`'s `spanFromEstree` hard-codes `line: 1, col: 1` — only `start`/`end` are true source coordinates on an expression-derived node. Dependency-light on purpose (its own `baseName`, no `node:path`). |
| **~~default-logic-exemption.ts~~ (⛑ S445: DELETED #1196 — row SUPERSEDED)** | `isDefaultLogicBodyTopExempt(filePath)` (:88) — the per-file suppression predicate for the §40.8 default-logic BODY-TOP diagnostics, over `unit-cc-exemption-list.json` (loaded once at module init; malformed/absent JSON → empty list). Strict `Set` membership, then a `/`-boundary suffix match (spans carry ABSOLUTE paths; the list is repo-relative; a worktree harness inserts `.claude/worktrees/agent-XXX/`). **ZERO local imports, and that is the contract** — TAB runs before SYM, so `ast-builder.js` may not import `symbol-table.ts`; this leaf is what both stages may depend on. Extracted from `symbol-table.ts` at S379 for a SECOND consumer that is **HELD and not in the compiler**; as of S383 there are TWO held would-be consumers (`E-CALL-NOT-IN-LOGIC-CONTEXT`, and ruling 3's §40.8 arm of `E-CONTROL-FLOW-IN-MARKUP`). **Sole LIVE consumer: `symbol-table.ts` PASS 3 via the `isUnitCCExempt` alias (`E-WRITE-NOT-IN-LOGIC-CONTEXT`).** Do not fold it back in. |
| codegen/runtime-chunks.ts | the runtime chunk catalog + `CHUNK_DEPENDENCIES`. |
| compute-pgo-flags.ts | the profile-guided flags `detectRuntimeChunks` reads for the `reset` / `equality` / for-stmt gates. Its header comments are the best in-tree narrative of what a missed gate costs. |
| codegen/sql-lex.ts | the pure LIVE-vs-INERT `${}` classifier (§52.15.5). One function feeds BOTH collect.ts and rewrite.ts. |
| codegen/tenant-egress.ts | the §14.8.10 tenant-row isolation floor; also owns `_scrml_active_tenant`/`_scrml_active_caps`. |
| codegen/index.ts | the codegen dispatcher; chunk-namespace WIRING; §40.8.2 shell composition (`computeDependencyClientScripts` is 4-arg since GH #235); the `E-DBAUTH-SQLITE` compile-time gate. |
| codegen/emit-html.ts | markup emission; `analyzeWriterConflict` (#81); `treeHasAuthorMain` (§20.8.1.1); **`directiveIsFormValue` computation for arm-body `value=` (i225)**. |
| codegen/binding-registry.ts | pure data registry, no imports. `LogicBinding` carries `isReactiveValueAttr`/`valueAttrName`/`valueAttrIsFormValue`/`valueAttrKey` and **`directiveIsFormValue` (NEW, i225)**. |
| codegen/emit-variant-guard.ts | `<match>`/`<engine>` arm wiring; consumes `directiveIsFormValue`; carries the navigate-wave1c eager-vs-DCL dispatch for arm wiring. |
| codegen/emit-event-wiring.ts | event-handler wiring; owns the `_scrml_boot` IIFE + boot dispatch. |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`); several comments mirror the `detectRuntimeChunks` activation gates. |
| codegen/db-driver.ts | `resolveDbDriver(url)` -> `{driver, connectionString}`. |
| tailwind-classes.js | the Tailwind v3 utility registry + the three `*-TAILWIND-*` diagnostics. |
| module-resolver.js | resolves `scrml:*` stdlib imports (`STDLIB_ROOT` via `fileURLToPath` — hence `stdlib/` in the publish allowlist) + relative imports. |
| semdiff.ts | emit-identity Tier-0 compare; `canonicalizeChunkNamespaceToken` neutralizes per-path tokens. |
| expression-parser.ts | `parseExprToNode`, `exprNodeCollectCallees`, **`forEachIdentInExprNode` (consumed by D-5)**. |

## THE `~` DIAGNOSTIC SINK — a THREE-MODULE cycle-free seam (NEW section, S397, #832)

**TWO NEW INTERNAL EDGES LANDED THIS WINDOW AND BOTH ARE INSIDE `codegen/`.** They are here because
the shape is reusable and because deleting either half looks harmless at the call site.

| edge | what crosses it |
|---|---|
| `codegen/emit-expr.ts` -> `codegen/log-loc.ts` | **NEW: `resolveSpanLineCol`**, imported alongside the existing `resolveLogLoc` |
| `codegen/index.ts` -> `codegen/emit-expr.ts` | **NEW: `resetTildeUnresolvedErrors` / `drainTildeUnresolvedErrors`**, added to the existing setter import list |

⛑ **WHY A MODULE-LEVEL SINK AND NOT `ctx.errors` — AND THIS IS THE THIRD INSTANCE OF THE SAME PATTERN,
SO IT IS A PATTERN AND NOT A HACK.** `EmitExprContext.errors` is optional and was **MEASURED
`undefined` at every site the `~` orphan reaches** — the orphan arises deep inside client-mode
expression emission, on paths that construct a context without one. Threading `errors` through every
one of those constructors is a far larger change than the arc allowed and is the wrong shape anyway.
The existing siblings: **`_sessionValueUseErrors`** (same file) and **emit-server's
`_foreignCrossingErrors`**. ⚠ **`emit-logic.ts`'s `(opts as any).preparedStmtErrors` for `E-SQL-006` is
the SAME class**, and the standing lesson from that code is the one that matters here: **the detector
was always correct and the narrow sink was NOT DRAINED, so a live diagnostic looked dead for months.**
If you add a fourth, add its drain in the same commit.

⛔ **THE LIFECYCLE IS WIDER THAN THE SESSION SINK'S, DELIBERATELY, AND BOTH DRAINS ARE LOAD-BEARING.**

- **Reset ONCE**, at the top of `runCG` (`codegen/index.ts:1192`) — not per-file, so no path through
  the loop can skip the arm. ⚑ A stale sink from a PREVIOUS `runCG` **in the same process** would
  attribute one compile's orphan to the next, and **every test file drives multiple `runCG` calls**.
- **Drain TWICE**: `:2649` in the per-file loop's `finally`, and `:3517` immediately before `runCG`
  returns. The tool (`outputs.set(filePath, toolOutput)`) and library (`libOutput`) paths each leave
  the iteration by their **own `continue`**, so a drain at the loop's last statement would collect the
  browser path only. And emission **continues after the loop closes** — per-page shell composition and
  the §40.9.7 route splitter both re-enter expression emission. Draining clears, so it is idempotent.
- **The drain point decides WHEN, not WHICH FILE.** Each `CGError` carries its own `span.file`, so
  file attribution is sound regardless of where it is collected. ⚠ **Within-file POSITION is not** —
  see `log-loc.ts` in structure.map.md and the `E-CG-TILDE-UNRESOLVED` section in error.map.md.

⚑ **`log-loc.ts` IS NOW A TWO-PROJECTION MODULE OFF ONE REGISTRY.** `resolveLogLoc` bakes a
`"basename:line"` STRING into emitted JS for the §20.6 `log()` origin tag; `resolveSpanLineCol` returns
numeric `{ line, col }` for a DIAGNOSTIC span. Same registry, same `LineIndex`, same cache — only the
projection differs. **`codegen` stays dependency-light here on purpose** (the file's own `baseName`
avoids `node:path`); do not add an import to it casually.


## `escalationReasons` — the placement value that crosses the RI -> codegen seam (NEW section, S299)

The complete producer/consumer set at this HEAD. It is SHORT, which is the point: an
`EscalationReason` variant is a cross-module contract, not a local enum, and adding one touches every
row below.

| Role | Site | What it does |
|---|---|---|
| TYPE | `route-inference.ts:262` (`RouteInfo.escalationReasons: EscalationReason[]`) + the header contract at `:14` (*"empty if client"*) | the union. Kinds in use: `explicit-annotation`, `server-only-resource`, `protected-field`, `session-access`, `channel-*`, `middleware-handle`. |
| PRODUCER | `route-inference.ts:5512` (`escalationReasons: deduped`) | the main per-function assembly, deduped. |
| PRODUCER | `route-inference.ts:5230` | the middleware-handle arm (`_handleEsc?.deduped ?? [{kind:"middleware-handle"}]`). |
| CONSUMER | **`codegen/emit-server.ts:843`** (`isBodyOnlyEscalation`; the `escalationReasons` read is `:844`, the `.every()` `:848`, and the sole call site `:2028`) — ⛑ **S384: the carried `:727`/`:728` were ALREADY WRONG pre-window (a doc-comment run); RE-DERIVED BY GREP** | §12.6 library mode. **Gates on EVERY reason being `server-only-resource`** — the `.every()` that makes a NEW reason kind a breaking change: a fresh kind fails it and silently re-attaches an HTTP wrapper §12.6 says to drop. `:1777` carries the comment recording that expectation. |
| CONSUMER | `describeServerTrigger` (message rendering) | renders `server-only-resource` as "the server-only resource `<resourceType>`"; sorts `explicit-annotation` last, which is what makes `W-DEPRECATED-SERVER-MODIFIER` report a redundant `server` keyword correctly. |

**This is why S299's Trigger 3 reuses `server-only-resource` with `resourceType` = the module
specifier instead of adding a variant.** If you are about to add an `EscalationReason` kind, the
`.every()` at `emit-server.ts:848` (⛑ **S384: `:727` was ALREADY WRONG pre-window; `isBodyOnlyEscalation` is `:843` and the `.every()` is `:848` — re-derived by grep**) is the thing to check first.

## Colorless-async (Seam-A / Phase-2 combinators, GITI-037/GITI-038) — TWO new destinations this window
A plain (non-`?{}`) function calling a Promise-returning host primitive — directly, transitively, or
as a returned closure — is compiler-classified `async` and auto-awaited; there is no `async`/`await`
in scrml source (§13.1/§13.2). Seam-A Phase-1 unified the classifiers onto `computeAsyncFnNames`
with `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` as the no-silent-leak backstop; the Phase-2 combinator
transform lives in `codegen/async-combinators.ts`; GITI-038 split Q1 (own-signature async) from Q2
(needs AST re-emission, `computeNestedAsyncFnHolders`); i87 gave `injectPromiseAwait` its
position-invariance. **GH #237 extends the same §13.2 obligation to a THIRD destination —
a desugared `on mount { … }` body, which is emitted at MODULE scope inside a SYNC IIFE where
`await` is illegal.** Before the fix, every server call in a mount block landed as a bare pending
Promise, so an `if (u is not) { redirect("/login") }` guard could never take its deny branch —
fail-OPEN. The sibling reactive-cell destination (`@you = loadMe(1)`) was already correct
(emit-client.ts lifts it into its own async IIFE).

**Two MORE destinations landed this window, both narrower than GH #237's mount-body fix.**
(a) **A value-form `match`-arm result (#394)** — see `parenthesizeAwaitServerCallsInExpr` in the
pipeline table above; the arm result re-emits from a raw EXPRESSION STRING, a shape the statement-level
injector never reached, and the fix wraps the call node rather than prefixing `await` because the arm
value is often a RECEIVER expression (`fn().field`), not a bare call. (b) **A cross-module ASYNC
import consumed inside a markup `${…}` interpolation (#391)** — `emit-client.ts` / `emit-reactive-
wiring.ts`; the wrap decision is made off the injector's OWN EMITTED OUTPUT rather than a re-derived
predicate, after an S239 catch surfaced a page-breaking SyntaxError from an earlier version of the fix.
Neither of those two narrower fixes touched `scheduling.ts`'s `isControlFlowBoundary` treatment of
`given`/`if`/`match` bodies directly — that was the separate, larger arc, and **it has since LANDED**
(PR #405, `649d6fce`, reviewed clean at `bbd77bec`): see the "§13.2 CPS auto-await CHOKE-POINT" row
above for what changed and which gaps it closed.

**THIS WINDOW closes the arc's SHAPE, not its bug class.** Two landings, in order: **#429** put the
`await` at the CALL SITE for a client server fn (the fourth `emitCall` await branch) — the only place
that reaches receiver-tail and nested-argument positions; **#442** then removed the reason the three
consumers could disagree at all, by giving them ONE provider. Read the two new pipeline rows above
before touching any of it.

**The honest status, and it is deliberately recorded here rather than in a changelog line: the
auto-await family is NOT closed.** **142** bare (unawaited) client server-fn call sites survive in
cleanly-compiling corpus sources, with a base->head delta of **ZERO**, measured two independent ways
(an independent reviewer sweep: 49 bare of 148 across 70 sources; the harness's own wider/looser
metric: 150 bare of 472 across 103 sources). Four are unambiguous instances of the target bug in
sources that compile cleanly on EVERY revision:

- `examples/19-lin-token.scrml:107` — a bare `_scrml_fetch_mintTicket_12(…)` in an **async** host whose
  sibling call on the next line **is** awaited
- `samples/compilation-tests/gauntlet-r10-rails-blog.scrml:331,334` — a pending Promise written into a
  cell and then rendered
- `examples/17-schema-migrations.scrml:100` — `for (const n of _scrml_fetch_listNotes_13())`
- `samples/.../phase1-function-with-sql-002.scrml:55` — `await (_scrml_fetch_loadUsers_3().length)`,
  verbatim the precedence bug `isAwaitedClientServerFnCall`'s own doc-comment cites as its reason to exist

**A changelog line reading "closes the auto-await family" would be false.** The unreached shapes use
DIFFERENT emitter paths — the CPS / failable-fn wrapper, module top-level init, and the
markup-interpolation lift. Tracked as `g-auto-await-family-not-closed-150-bare-server-call-sites-in-
clean-sources` (HIGH, open); **the 142/150 count is now produced by the harness itself**, so the next
change to this class has a measurable before/after rather than an argument.

**Sibling HIGH filed the same window, on a path nothing in the arc touched:**
`g-reset-writes-pending-promise-when-init-thunk-calls-a-server-fn` — `runtime-template.js:1219` does
`_scrml_reset_apply(name, _scrml_init_fns[name]())` with **no `await`** (⛑ **S384: `:1168` was ALREADY
WRONG — a doc-comment line — and the write now routes through `_scrml_reset_apply` (:1179), not a bare
`_scrml_reactive_set`. RE-DERIVED BY GREP**), so `reset(@cell)` on a cell
whose init expression calls a server fn writes the PROMISE into the cell. The DECLARATION path awaits
(the codegen injectors cover it); the RUNTIME reset path re-invokes the same thunk and does not — a
cell can be correct at mount and wrong after `reset()`. PA-reproduced on shipped
`examples/03-contact-book.scrml`. The obvious fix makes `_scrml_reset` async, which changes every call
site — the same §13.2-vs-§19.6 shape as the S322 absorb ruling (option **C**: await the IIFE AND keep
its `.catch`), **which is RULED but NOT YET BUILT** and sequences after U1 because it touches the same
file.

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose `{kind, isAsync}` cannot be resolved FAILS CLOSED (defaults
to async). Mechanism unchanged. **What CHANGED at S299 is what may be reused from it: nothing.**
This backstop is driven by `route-inference.ts`'s `SERVER_ONLY_SCRML_MODULES` (:579), a set tuned for
a decision where OVER-inclusion is free. §12.2 Trigger 3 placement is driven by the separate
`ESCALATION_SERVER_ONLY_MODULES` (:656). Two sets, two safe-error directions, one file — see the
Trigger-3 row in the pipeline table and domain.map.md's section.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5
provider sub-modules), path, process, random, redis, regex, router, store, test, time. Each ships
BOTH a canonical `.scrml` source and a JS host shim. Unchanged this window — but `stdlib/` is now
part of the PUBLISHED package surface.

**Client-safety classification of those 21 (S299, §12.2 Trigger 3 — derived from BOTH the
`stdlib/<mod>/**.scrml` sources AND the shipped `compiler/runtime/stdlib/<mod>.js` shims):**

| Escalation-server-only (10) | Why |
|---|---|
| `scrml:auth` | `Bun.password` (argon2id) |
| `scrml:crypto` | `Bun.CryptoHasher`, `Bun.password` |
| `scrml:cron` | `Bun.cron` |
| `scrml:fs` | `node:fs` |
| `scrml:process` | `process.{argv,cwd,env,exit,platform,memoryUsage}` |
| `scrml:redis` | `import { redis, RedisClient } from "bun"` — **BARE `bun`, no colon** |
| `scrml:store` | `bun:sqlite` |
| `scrml:path` | `node:path` |
| `scrml:mcp` | `node:fs` / `node:path` / `node:url` (the host surface is in the `.js` shim, not the `.scrml`) |
| `scrml:oauth` | **no host reach at all** — transmits `client_secret`; module header says SERVER-SIDE ONLY |

**Verified NOT members** against both limbs — do not "fix" these back in without re-running the
derivation: `scrml:data` (pure transforms + compile-time type-as-argument primitives; 72 of the
corpus's 116 server-only-module import sites and it ships a real client implementation) and
`scrml:http` (fetch wrappers; `fetch` is browser-native and the module takes no credential of its
own). **A hand-maintained derived list rots silently** — that is the `docs/FACTS.md` lesson, and it
is why the two membership limbs are recorded next to the list in the source.

**⚑ THE SAME CRITERION NOW ALSO DECIDES THE CLIENT RUNTIME CHUNK LIST (#669), AND THAT IS THE
LOAD-BEARING NEW FACT IN THIS SECTION.** A module is client-registered in
`codegen/runtime-chunks.ts:RUNTIME_CHUNK_ORDER` **iff it is NOT an escalation-server-only module
under this same two-limb criterion** (`route-inference.ts:ESCALATION_SERVER_ONLY_MODULES`).
Membership is DERIVED, not curated:

| | modules |
|---|---|
| **Client-registered (13)** | `auth` · `compiler` · `crypto` · `data` · `format` · `host` · `http` · `math` · `random` · `regex` · `router` · `test` · `time` |
| **Deliberately absent (8)** | `cron` · `fs` · `mcp` · `oauth` · `path` · `process` · `redis` · `store` — each carries a one-line reason AT the absent block in `runtime-chunks.ts` |

**`auth` and `crypto` fail the criterion yet carry a chunk. That is PRE-EXISTING (S95 Bug 18) and
was left alone DELIBERATELY** — removing a chunk is a behaviour removal, out of scope for the
dispatch that added the rest of the list. Do not "correct" it as an inconsistency without treating
it as its own change.

**Before #669 only FOUR of these had chunks**, so a client-side `import` from any of the other
seventeen compiled clean, emitted a shim nothing loaded, and threw `TypeError` at bundle load with
**zero diagnostics**. Measured matrix at the fix: base 4 execute → tip **13 execute / 8 refused
loudly with `E-STDLIB-CLIENT-CHUNK-MISSING` / 0 silent**. `path` deserves its own note: the shim
loader **strips DEFAULT imports**, and `path`'s shim is `import nodePath from "node:path"`, so even
if it passed the host-reach limb every export would `ReferenceError`.

## Tags
#scrml #map #dependencies #trigger-3 #escalation-server-only #two-set-distinction #escalation-reasons #is-body-only-escalation #stdlib-client-safety #node-id-freshness #module-graph #stdlib #chunk-namespace #cell-accessor-rename #detect-runtime-chunks #post-emit-chunk-gates #runtime-chunks #chunk-dependencies #fnv1a #semdiff #pipeline #bun #acorn #sql-lex #tenant-egress #tenant-floor #theme-reset #content-hash #colorless-async #async-combinators #on-mount #gh237 #scheduling #writer-ownership #bind-value #i225 #directive-is-form-value #batch-hoist #session-establishment #outlet #one-landmark #shell-composition #esm-chunks #module-format #each-fence #dist-space #source-space #d4 #d5 #forward-index #server-import-unemitted #dbauth #db-migrate #sql-table-refs #queried-table-grants #quoteIdent #sql-ident #navigate-wave1c #chunk-loading-depth-counter #tailwind-outline #e-schema-011 #npm-publishable #no-workspaces #structural-if #§17.1.2 #if-cond #if-raw #five-consumers #absent-not-null #parity-canary #credit-from-attr-value #e-dg-002-false-fire #visit-structural-if-attr #scope-push-order #indirect-callee-resolver #indirect-inverse-caller-map #inverse-caller-map-byte-identical #escalation-only #fix-a #fix-b #server-fn-peer-alias-names #export-const-client-gate #ident-expr-precise #pruned-subtrees #module-init #rehydrator-boundary #scrml-nav-rewire #scrml-boot #register-rehydrator #outlet-resident #region-cleanups #route-region #emit-reactive-wiring #no-route-splitter #inject-server-call-awaits-via-ast #acorn-scope-model #scheduling-rewrite #reactive-set-direct-value-lift #engine-audit #audit-registry #cell-scope-accessors #project-state-child-rules #dispatch-called-targets #template-dispatch-scan #ai-legs-killed #cost-decision #parenthesize-await-server-calls #match-arm-autoawait #crossmodule-async-markup #cross-file-client-reads #export-let-var-emission #serve-tool-reachability #dist-relative-local-specifier #distLocalPathOf #§64-import-rebase #pr-405-landed #cps-choke-point #s239-catch #inject-promise-await-retired #collect-await-sites #apply-await-sites #inject-fn-body-server-call-awaits #given-match-try-descend #collect-structural-decl-names #§6.8 #w-if-in-each #each-nested-if-not-reactive #async-name-provider #async-name-facts #is-async-callee-name #is-server-boundary-callee #decision-sites-3-to-1 #one-provider-three-consumers #seed-trigger-not-result-set #u1 #dpa-020 #dpa-023 #client-server-fn-await #is-client-server-fn-call #client-async-body #can-suppress-never-strand #owning-file-filter #routemap-key-carries-the-file #decide-off-emitted-output #match-iife-header #await-absorb #auto-await-family-not-closed #142-bare-sites #option-c-ruled-not-built #reset-init-thunk-promise #session-proxy-bind #gh357 #csrf-token-disclosure #dangling-ref-class #ast-reads-current-user-ambient #channel-auth-only #region-fence #two-region-classes #lexical-vs-structural #join-around-runtime-slot #change-the-input-not-the-pattern #classify-brace-group #object-shorthand-expansion #binding-pattern-limit #proto-shorthand-b31 #register-fn-name #zero-width-alternation #response-contract #one-exit #instanceof-response-passthrough #redact-before-serialize #fail-open-403-to-200 #session-cookie-wrap #bun-welcome-page #block-arm-value-position #show-false-ssr #each-shorthand-markup-fn-mount #spec-silent-shall #§18.5-four-routes #plan-block-arm-lift-is-not-the-segmenter #leaf-predicate-not-single-classifier #two-callsites-of-four-routes #separator-dependent #closes-block-statement #step-3b #§6.6.19 #e-derived-server-only-reach #scan-for-server-only-binding-refs #one-walk-two-callers #names-not-just-modules #refuse-not-escalate #sets-unchanged-this-window #e-sql-006-sink-drain #prepared-stmt-errors #request-ref-reparse #collect-request-ids #gate-to-registered-requests #three-new-internal-edges #collect-request-ids #reparse-request-ref-escape-hatch #cgerror-into-a-pure-builder #two-paths-one-class-two-mechanisms #should-skip-expr-parse #component-expander-augmentation-coupling #tool-import-tree-shake #deferred-lifecycle-body-tags #timer-start-fifth-param #split-locus-gate-and-fire #never-refired-on-resume #zero-external-dep-diff #nine-windows-no-version-move #select-request-onion #shared-rule-node #one-provider-two-consumers #emit-transition-css #diagnostic-format #not-a-verb-hand-maintained #11-verbs-14-files #package-json-zero-diff-11-windows #lsp-one-line #e-mw-007-hover #synth-key-rule #five-copies #two-resolution-orders #resolve-synth-cell-prefix #emit-member #longest-key-first #shortest-prefix-first #ast-expr-ctx #object-literal-arm #if-cond-consumer-table #line-ref-drift #bs-lint-stage-2-5c #leaf-module-imports-nothing #copied-state-block-names #copied-lifecycle-regex #unenforced-duplication #s437b #9941a504c #self-host-v2-graph #handler-block #s440 #cf62b415 #bootstrap-import-graph #local-async-fns #s447 #6a592ed5c #self-host-v1-removed #test-tmp-root #protect-egress-r8 #s450 #9bafb927 #native-parser-frozen #parser-flag-retired #session-ambient-server #auth-attr-invalid
#tilde-diagnostic-sink #narrow-sink-pattern #two-drains #log-loc-two-projections #resolvespanlinecol #drain-or-it-looks-dead #e-sql-006-precedent
#int-number-census-new-consumer #internal-graph-moved-manifest-did-not #fifth-flat-window
#s405 #external-deps-zero-diff-sixth-window #internal-graph-moved #schema-differ-is-the-one-recognizer #eight-consumers-one-recognizer #import-direction-invariant #no-bun-sqlite-in-the-pa-stage #protect-analyzer-deleted-its-regex #gauntlet-phase1-imports-the-recognizer #acorn-in-protect-egress #db-authoritative-single-producer #two-consumers-opposite-polarity #a-graph-edge-does-not-show-polarity #701-import-edges #dependencies-generated-regenerated
#s437 #d02738767 #v0-8-0 #external-deps-flat-6th #pipeline-seam-edges #sqlite-defaults-two-halves #db-target #diagnostic-secrets #lsp-redaction #flograph-uses-state-ts

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [migrations.map.md](./migrations.map.md)
- [build.map.md](./build.map.md)
