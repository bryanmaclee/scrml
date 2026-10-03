# migrations.map.md
# project: scrml
# updated: 2026-10-03T11:38:07-06:00  commit: 47c863556
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
# ━━━━━━━ S437 MIGRATIONS DELTA ━━━━━━━
# NOT a zero-diff row: `compiler/src/commands/db-migrate.js` +31 (665 -> 686L). `schema-differ.js`: unchanged.
# Two changes, both operational, neither touching the reconcile model: see `## S437 — db-migrate` below.
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
# ━━━━━━━ S422 MIGRATIONS DELTA — **ZERO-DIFF SURFACE, MEASURED.** ━━━━━━━
#
# ⛑ `git diff --name-only e74f5423..787d4cb4 -- 'compiler/src/**migrate**' 'compiler/src/commands/**'`
# -> **EMPTY** across 112 commits. **The entire `compiler/src/commands/` tree is byte-unchanged**, so
# both migration verbs (`db-migrate`, `migrate`) and all 11 CLI verbs are untouched. `stdlib/` is
# likewise entirely unchanged, so `stdlib/data` and the schema surface did not move.
# No new migration directory, no new migration file, no naming-convention change, no rollback change.
#
# ⚠ **THE "CLI verbs = 11" FIGURE IS STILL TRUE ONLY BY A HAND-MAINTAINED EXCLUSION LIST, AND NOTHING
# CHECKS IT — RE-VERIFIED AS STILL-HAZARDOUS THIS PASS, NOT RE-VERIFIED AS SAFE.**
# `compiler/src/commands/` holds **14** files; `scripts/facts.ts` carries
# `NOT_A_VERB = new Set(["module-format-notice", "diagnostic-format", "select-request-onion"])`.
# **A new shared-rule module dropped into `commands/` will be counted as a verb until someone edits
# that set by hand.** The window did not exercise the hazard (the tree did not change) — it did not
# retire it either.
#
# ⚠ **A ZERO-DIFF SURFACE IS AN UNCHANGED MAP, NOT A RE-VERIFIED ONE.** This pass established only
# that the migration surface did not move. The Tool / Naming Convention / Latest Migration / Rollback
# claims below were NOT re-read against their sources this window.
# ⛑ **Given that this pass caught TWO carried `SPEC.md` citations that had gone stale elsewhere in
# this map set** (the §20.5 range in `auth.map.md`, and the `postRe` correction in `schema.map.md` /
# `non-compliance.report.md`), **treat every `file:line` below as a hypothesis until re-derived by
# symbol.** The zero-diff applies to the SOURCE, not to this file's description of it.
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
# ━━━━━━━ S405 wrap-6c — **NON-ZERO SURFACE: `schema-differ.js` (+396) AND `commands/db-migrate.js` (+24).** ━━━━━━━
#
# ⛔ **THE WHOLE MIGRATE HALF OF THE §14.8.10 ARC IS ONE LINE, AND ITS PLACEMENT IS THE DESIGN:**
# **`if (t.rawDdl) continue;` — `compiler/src/commands/db-migrate.js:244`.**
#
# `extractDesiredSchema` (`codegen/db-authoritative.ts:121`) learned the raw-DDL `<schema>` form in
# #900 — a `<schema>` body carrying raw `CREATE TABLE … (…)` SQL instead of the declarative
# `tableName { col: type }` DSL. **It has TWO consumers with genuinely different needs:**
#   · the **§14.8.10 tenant floor** (via `codegen/emit-server.ts:1769`) needs EVERY `<schema>`-declared
#     table, raw DDL included — a `tenant_id` column's PRESENCE is the declaration — because a table it
#     cannot see gets a **silently inert isolation floor at exit 0**;
#   · **THIS command** needs the opposite: it OWNS and REWRITES schema, and a raw table's DDL is
#     AUTHOR-owned and only **PARTIALLY recovered** (names only — no constraints, defaults, foreign
#     keys or `CHECK` bodies).
#
# ⛑ **EVERY DEFECT THE MIGRATE SIDE OF THIS ARC PRODUCED TRACED TO RAW TABLES BECOMING VISIBLE HERE**
# — a lossy `CREATE TABLE`; `W-SCHEMA-002` `DROP COLUMN` against unrecovered columns; a green "up to
# date" for a table that does not exist; and a `DROP TABLE` against a table the `<schema>` DOES
# declare. **Declining them at THIS boundary makes all four impossible BY CONSTRUCTION rather than by
# guards inside `diffSchema`** — which is consequently **BYTE-IDENTICAL to its pre-arc behaviour.**
# `schema-differ.js:1131-1137` states the split from the differ's side; `diffSchema` (`:1125`) SKIPS
# `rawDdl` tables as a defence in depth, but the decision is made at the consumer.
#
# ⚠ **THE CONSEQUENCE IS DELIBERATELY THE PRE-ARC ONE: A RAW-DDL `<schema>` IS INVISIBLE TO
# `scrml db-migrate`, EXACTLY AS BEFORE THIS ARC.** Migrating it properly means **REPLAYING the
# author's own statement** rather than regenerating it — a separate, re-scoped arc.
# **DEFERRED ARC AT THAT SEAM: `docs/changes/migrate-consumer-raw-ddl-2026-09-08/SCOPE.md`.**
#
# ⚑ **`schema-differ.js` IS NOW THE HOME OF *THE ONE* `CREATE TABLE` RECOGNIZER, AND THE LOCATION IS
# AN INVARIANT WITH A STATED REASON.** `parseSchemaBlock` (`:31`) · `harvestCreateTables` (`:246`) ·
# `harvestRawCreateTableDecls` (`:264`) · `harvestRawCreateTables` (`:282`) ·
# `parseRawCreateTableColumns` (`:348`). It imports only `sql-ident.ts`, **so a consumer is not forced
# to pull `protect-analyzer.ts` — and with it `bun:sqlite` + `node:fs` — just to ask what counts as a
# table declaration.** `protect-analyzer.ts` DELETED its own `CREATE_TABLE_RE` and imports these
# (`:65-77`); `gauntlet-phase1-checks.js` imports `harvestRawCreateTables` (`:69-80`).
#
# ⛑ **THE RECOGNIZER NOW ACCEPTS *AND NORMALIZES AWAY* A SCHEMA QUALIFIER (`CREATE TABLE
# public.assets (…)`), THE ORDINARY POSTGRES SPELLING.** That matters to migration specifically:
# `protect-analyzer.ts:resolveDb` REPLAYS these statements into an in-memory SQLite shadow DB, where
# an unstripped `public.assets` throws and takes the whole `<db>` block down with `E-PA-003`.
# ⚠ **`extractCreateTableStatements` passes `overwrite: true` (LAST-wins across nodes); the raw-DDL
# `<schema>` harvest is FIRST-wins. The two policies are deliberate and are not the same.**
#
# ⚑ **`parseRawCreateTableColumns`'s `sourceText` RECOVERY PARAMETER IS GONE, AND THAT REMOVAL IS THE
# FIX RATHER THAN A SIMPLIFICATION.** It re-found a CLIPPED statement inside its body to re-read the
# columns — and it COLLIDED with the qualifier normalization added beside it: the stored statement said
# `assets`, the body said `public.assets`, `indexOf` returned -1, the recovery silently never fired,
# and the original defect came back on exactly the Postgres spelling §14.8.11 targets. **Two
# individually-correct fixes cancelling.** Statements are no longer clipped at all, so **one side of
# the seam is DELETED instead of both sides being patched.**
#
# ⚑ **NEW DIAGNOSTIC ADJACENT TO THIS SURFACE: `W-SCHEMA-NO-TABLES-DECLARED`**
# (`gauntlet-phase1-checks.js:803`) — a `<schema>` block with content that declares no table in EITHER
# recognized form. Measured on its first run over 2,555 corpus `.scrml`: exactly ONE trip —
# `compiler/tests/commands/migrate-program-shape-fixtures/schema-anchor.scrml`, whose
# `users: { id: integer, name: text }` stray colon means it had been declaring nothing.
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
# ⛑ **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF.** Command: `git diff --name-only 499eecce..68cfac6d --
# compiler/src/schema-differ.js compiler/src/commands/migrate.js` -> **EMPTY**.
#
# ⚑ **`schema-differ.js` GAINED A NEW CONSUMER WITHOUT CHANGING: `scripts/int-number-census.ts` (#875)
# imports `parseSchemaBlock` from it** to answer "which schema columns are `int`-annotated?" from the
# real parse rather than a regex. Worth knowing before you change that export's signature — a
# `--name-only` empty diff on this module does not mean nothing depends on it that did not before.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# ⚠ **THE WINDOW IS FOUR SESSIONS WIDE, NOT ONE** — `10a4b045..499eecce` is **36 commits, PRs
# #835-#872** (S399 · S400 · S400-peter · S401 · S402). The prior stamp is 4 sessions behind because
# S398-S401 did not fire a wrap-6c. Per-file attribution is in `primary.map.md`'s header.
#
# **THIS MAP:** **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF:** `db-migrate.js` · `migrate.js` · `schema-differ*` all `--name-only` EMPTY. ⚠ Same caveat as `infra`.
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
# **NO MIGRATION SURFACE CHANGE THIS WINDOW.** Carried forward VERIFIED-UNCHANGED at `2d8dd8cb`.
#

The conditional check (a real DB-migration-apply tool exists) fires because `scrml db-migrate`
(§14.8.11.1) exists — `scrml migrate` (pre-existing) is a scrml-SOURCE syntax codemod, NOT a DB
schema-migration tool.

This is NOT a Prisma/Knex/Alembic-shaped versioned-migration-file tool. Read the model section below
before assuming a `migrations/0001_*.sql`-style directory exists — it does not.

## S449-WRAP — ZERO-DIFF FOR THIS MAP (`9bafb927..47c863556`)

No change to `schema-differ.js`, `commands/db-migrate*`, or migration tooling. `db-ownership.ts` gained
`fileDefaultDbDecl` (default-database resolution for codegen, not migrations).


## S450 — MIGRATIONS DELTA (`6a592ed5c..9bafb927`)

`compiler/src/commands/db-migrate.js`: unchanged. `compiler/src/schema-differ.js` (+161, #1243): NEW exports
`schemaTableDeclarations(text)` (:865) and `findTenantDeclarationDisagreements(text)` (:925); internal
`findLikeTemplateReference`, `allSchemaCreateTableDecls` (legacy + structured scans merged); `tableOffsets` returned
from the scan. Consumed by `gauntlet-phase1-checks.js` for E-SCHEMA-014 (`LIKE` template, :816) and E-SCHEMA-015
(`tenant_id` disagreement across same-name declarations, :911). Diff/migration emission behaviour otherwise unchanged.


## S447 — ZERO-DIFF FOR THIS MAP (`78e4ddad..6a592ed5c`)
`db-migrate.js`, `schema-differ.js`, `db-ownership.ts`, `db-target.ts` untouched this window. Prior content stands.

## S446 — ZERO-DIFF FOR THIS MAP (`464c9ab4d..78e4ddad`)
`compiler/src/commands/db-migrate.js` is untouched this window and does not import any of the three modules that DID
change in this area (`db-target.ts`, `db-ownership.ts` [new], `codegen/sqlite-file-target.ts` [new]) — verified by
grep, zero hits. `schema-differ.js` changed (new `findRejectedCreateTableHeads` kind, new `findGluedDslTableHeads`,
feeding `E-SCHEMA-014` and the DSL-head extension of `E-SCHEMA-012`/`013`), but that is the `<schema>`-body COMPILE-TIME
DDL-head reader that feeds the §14.8.9/§14.8.10 floors and the shadow DB, not the `scrml db-migrate` apply tool
this map describes. The #1215 db-ownership/data-root work changes RUNTIME SQLite file resolution, not the
migration-apply surface either. No migration directory, tool, or file-naming convention changed.

## S445 — ZERO-DIFF FOR THIS MAP (`5b1d0dab0..464c9ab4d`)
- No migration tool / directory change. Only the live-PG migrate test (`db-migrate-pg.test.js`) got 120 s hook timeouts.

## S444 — ZERO-DIFF FOR THIS MAP (`cf62b415..108ca89be`)

No migration tool / directory change. `examples/17-schema-migrations.scrml` edited (docs accuracy, #1142); no source change to `<schema>` diffing.


## S440 — ZERO-DIFF FOR THIS MAP (`fb21983a..cf62b415`)

No file in the window touches this map's surface (checked: `git diff --stat fb21983a..cf62b415`). The only new
option-like surface is `compileScrml`'s `beforeWrite` callback (#1125) — an API option, not config (see schema.map.md).


## S438 — ZERO-DIFF FOR THIS MAP (`9941a504c..fb21983a`)

Verified, not assumed: `git diff --name-only 9941a504c..fb21983a -- 'compiler/src/commands/db-migrate.js'
'**/migrations/**'` is **EMPTY**. `scrml db-migrate` behaviour, naming convention and rollback story are all
unchanged this window. (The window's schema-related landing, `E-SCHEMA-012`/`E-SCHEMA-013`, is a COMPILE-TIME
`<schema>` body validation — `gauntlet-phase1-checks.js`/`schema-differ.js` — not a `db-migrate` change; see
schema.map.md.)


## S437b — ZERO-DIFF FOR THIS MAP (`d02738767..9941a504c`)

Verified at `9941a504c`: no file matching `*migrat*` outside `.claude/maps/` changed in the window, and
`compiler/src/commands/` is untouched. Content below stands as of `d02738767`.

## S437 — `scrml db-migrate` (`commands/db-migrate.js`, #1047/#1055/#1082)
- **SQLite busy timeout on the CLI's own handle** — `configureSqliteHandle(db)` (`:505`, from `compiler/src/sqlite-handle-defaults.ts`) runs immediately after the SQLite open and before `readActualSchema`. Sets `PRAGMA busy_timeout = 5000` ONLY; `journal_mode = WAL` is deliberately NOT set on a CLI-opened handle (it is a persistent change to the adopter's file). Before: a migrate against a database another process held `BEGIN IMMEDIATE` on failed `database is locked` in ~129 ms (measured S436, per the source comment).
- **Every error line that can echo `--db` is redacted** — `redactDbText` is bound to a `SecretRedactor([dbUrl])` (`compiler/src/diagnostic-secrets.ts`) once `runDbMigrate` knows the value; Postgres connect failures, SQLite open failures, rolled-back migration errors and resolver errors all pass through it.

## Tool
Library: none — first-party, `compiler/src/commands/db-migrate.js` (the CLI) +
`compiler/src/schema-differ.js` (the differ/DDL emitter, shared with the pre-existing SQLite migrate
path) + `compiler/src/codegen/db-authoritative.ts` (`extractDesiredSchema`, the desired-state seam)
+ `compiler/src/codegen/sql-ident.ts` (`quoteIdent`, mandatory identifier escaping)
+ **`compiler/src/sql-table-refs.js` (NEW S292 — the bounded `?{}`-table scanner feeding the queried-table grants; see below).**
Config: none — no config file. Everything is CLI-flag-driven (`--db`, `--dry-run`,
`--allow-destructive`).
Directory: NONE. There is no `migrations/` directory and no per-migration file. The desired state IS
the project's `<schema>` source (parsed fresh on every run); the differ reconciles it against the
LIVE database's actual state on every invocation. See "Model" below.

## Model — desired-state reconciliation, not versioned migration files

`scrml db-migrate <project-dir|entry.scrml> --db <migrator-url>` is the APPLY inverse of
`scrml introspect`'s EMIT (introspect: live DB → `<schema>` source; db-migrate: desired `<schema>` →
reconciling DDL on the live DB). Every run:

1. Parses the project's `<schema>` (all `.scrml` files, live parse pipeline `splitBlocks`→`buildAST`,
   merged first-decl-wins) into the DESIRED table/column/fn set via `extractDesiredSchema`.
2. Reads the ACTUAL live-DB state (`readActualSchemaPg` for Postgres / `readActualSchema` for
   SQLite) PLUS, on Postgres, a narrow scrml-managed-object PRESENCE read (`pg_policies WHERE
   policyname LIKE 'scrml\_%'`, `pg_roles WHERE rolname = 'scrml_app'` — Fork 2, minimal
   object-awareness, NOT a full object-aware policy/trigger/function differ).
3. `diffSchema(desired, actual, {driver, allowDestructive, queriedTables, queriedPrivileges})`
   computes the reconcile plan: `CREATE TABLE`/`ALTER TABLE … ADD/DROP COLUMN` for structural drift,
   PLUS (NEW S290) **per-column CONSTRAINT drift on an EXISTING column** (`columnConstraintDrift` —
   NOT NULL / UNIQUE / REFERENCES / DEFAULT; Postgres reconciles it and warns
   `W-SCHEMA-CONSTRAINT-TIGHTENED`, SQLite cannot `ALTER` a constraint at all so nothing is applied
   and the plan is reported WITHHELD via `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED`), PLUS (NEW S292)
   **`GRANT` statements for NON-db-authoritative tables the app's `?{}` bodies actually touch**
   (see "Queried-table grants" below), PLUS (Postgres only, per
   `db-authoritative` table) the idempotent §14.8.11 DDL — S1 RLS+policy, S6 bounded-role GRANT
   (S3-reshaped whenever any column is EFFECTIVELY immutable: author-marked `immutable`, OR the
   table's PRIMARY KEY, OR `tenant_id` — **auto-immutable as of S288**, `isEffectivelyImmutable` in
   schema-differ.js, see schema.map.md. Every `db-authoritative` table always carries a PK, so this
   branch is now ALWAYS taken for such a table — the prior "zero-immutable-columns emits
   byte-identical to M1" guarantee is RETIRED, SPEC §14.8.11.2 records the supersession explicitly)
   — PLUS (Postgres only, if any `fn` is declared) the §14.8.11.2 S4 SECDEF mutation-choke DDL
   (`generateScrmlHasCapDDL` once + `generateSecdefDDL` per `fn`).
4. Applies the WHOLE plan in ONE transaction under the migrator connection; a statement failure
   rolls the entire run back (no partial-apply state). **S288: a statement failure is now
   ATTRIBUTED to its exact index + SQL text** — see "Failing-statement attribution" below.

Because every piece of DDL the tier emits is IDEMPOTENT (`CREATE ROLE … EXCEPTION WHEN
duplicate_object`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, natural
`GRANT`/`ALTER TABLE ENABLE/FORCE ROW LEVEL SECURITY` idempotency), re-running `db-migrate` against
an already-migrated database is a SAFE no-op re-assertion, not an error — this is what lets the tool
skip a versioned migration-file history entirely.

## Queried-table grants (NEW S292, §14.8.11) — the fix that makes the PRESCRIBED shape work

**The defect (`g-dbauth-migrate-no-grants-for-unmarked-identity-table`, was HIGH).** The bounded-role
`GRANT` is emitted **per db-authoritative TABLE**, but the `SET LOCAL ROLE scrml_app` drop is emitted
**per `?{}` QUERY in any request scope**. So the moment ONE table is `db-authoritative`, EVERY
request-scope query runs as `scrml_app` — including reads of tables that were never marked, which
have no grants and fail with `permission denied for table users`. And §14.8.10's own corollary
PRESCRIBES leaving the identity table unmarked (you cannot tenant-scope the table that tells you the
tenant). **The documented, recommended shape was the broken one, and it failed closed at login with
an opaque Postgres error.** bryan RULED direction (b) at S292: grant the tables the queries touch.

**Mechanism, three files.**
1. `sql-table-refs.js` (`tableRefsInSource`) scans every `?{}` body in every project file, returning
   `{tables, privileges, undetermined}` — with the privilege each reference IMPLIES (`from`/`join`
   -> SELECT, `insert into` -> INSERT, `update` -> UPDATE, `delete from` -> DELETE; `PRIV_RANK`
   resolves `DELETE FROM`'s double match).
2. `commands/db-migrate.js` `parseProjectSchema` unions those across the project into
   `{queriedTables, queriedPrivileges, undeterminedSql}` and threads the first two through
   **`runPgApply`'s WIDENED signature** — `{connectionString, desired, dryRun, allowDestructive,
   queriedTables, queriedPrivileges}` — into `diffSchema`'s options at all three call sites.
3. `schema-differ.js` `diffSchema` emits, for each NON-db-authoritative desired table present in
   `queriedTables`:
   `-- §14.8.11: <t> is not db-authoritative but is read under SET LOCAL ROLE scrml_app.`
   `GRANT <exercised privileges> ON "<t>" TO scrml_app;`

**Four scope decisions, each deliberate:**
- **Gated on ≥1 db-authoritative table.** That is exactly when the role exists and the role-drop is
  emitted; with none, there is no `scrml_app` to grant to and the statements would fail.
- **Only the privileges the queries actually exercise.** Blanket CRUD would hand the bounded role
  DELETE on the IDENTITY TABLE, which login merely SELECTs — strictly more permissive than the
  db-authoritative path beside it, which narrows UPDATE to mutable columns.
- **Absent privilege info falls back to SELECT, not CRUD** — least privilege that can make a read work.
- **NO RLS, NO POLICY, NO column-scoped UPDATE narrowing.** Those are the db-authoritative tier's
  guarantees and an unmarked table has deliberately not opted into them. This grants exactly the
  access the app already demonstrably needs.

**The honest boundary is REPORTED, never guessed.** scrml carries no compile-time SQL parser, so the
scanner refuses five shapes outright — a CTE (`WITH … AS (`, whose name shadows a real table), a
subquery in `FROM` or `JOIN` position, a `LATERAL` join, and a dynamic `EXECUTE`. Each lands in
`undetermined`, and `runDbMigrate` prints a per-fragment operator warning: *"could not determine the
table(s) this query touches, so no grant was derived for it. If it reads a table that is NOT
db-authoritative, that read will fail with `permission denied` at request time — grant it
manually."* **A caller must never read an empty `tables` as "touches nothing"** — that is precisely
how this bug reproduces on a different table, and the failure mode (opaque `permission denied` at
request time) cost the reporting adopter three sessions.

## Constraint-drift reconcile (NEW S290, §38.6.2 rows 6/7/8 + §38.6.3)

§38.6.2 always specified eight operations; only ADD / DROP / RENAME COLUMN were built, so **every
constraint change on an existing column was silently ignored**
(`g-db-migrate-ignores-constraint-drift-on-existing-columns`). This is a conformance RESTORATION.

- `columnConstraintDrift(desiredCol, actualCol)` (`schema-differ.js`, exported) reports
  `{notNull, unique, references, default}`. PK-aware (a PRIMARY KEY is implicitly NOT NULL and
  UNIQUE — do not fight the driver over an implied constraint) and default-tolerant via
  `sameDefaultText` (drops a PG `::type` cast suffix, unwraps one quote layer, case-folds), so a
  driver's echoed default never reads as permanent phantom drift.
- **Postgres** reconciles via `ALTER TABLE … SET NOT NULL` / `ADD CONSTRAINT … UNIQUE` /
  `ADD CONSTRAINT … FOREIGN KEY`, each preceded by `W-SCHEMA-CONSTRAINT-TIGHTENED`. Adding a
  constraint to a POPULATED table will FAIL if a NULL, duplicate or orphan row exists — that failure
  is CORRECT (the data does not match the declared schema) and rolls back atomically; the warning
  exists so an operator can backfill first rather than decode a driver error.
- **SQLite cannot change a constraint via `ALTER` at all**, so reconciling needs the §38.6.3
  full-table rebuild — destructive, refused by default. NOTHING is applied for that column and
  `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` fires. **`printPlan(plan, actualTableCount, warnings)`
  (`db-migrate.js`:291) now filters for that code** and prints
  `plan: 0 statements — but N column(s) have constraint drift that was NOT applied. NOT up to date.`
  An EMPTY plan and a SUPPRESSED plan are different states; printing them identically told the
  operator the database matched the schema when it did not.

## `E-SCHEMA-011` — the foreign-key production is now enforced (S290, §39.5.5)

`references <table>(<column>)` — table name OUTSIDE the parens — is the ONLY production. Every other
shape (`references(owners.id)`, `references owners (id)`, `references owners.id`) was **silently
DROPPED**: the column compiled and migrated clean with no `REFERENCES` clause and no diagnostic. An
adopter declared 34 foreign keys in a real 19-table ledger schema and got **zero rows in
`pg_constraint`**; an INSERT naming a non-existent parent was accepted. RULED S290: reject rather
than admit a second form (admitting is newly-accepting beyond the contract, a §8 one-way door;
rejecting is recoverable; the corpus migration was MEASURED at 17 sites, all of them scrml's own
documentation). Since S290 `db-migrate` ALSO reconciles a `REFERENCES` clause onto an existing table
(§38.6.2) — Postgres via `ADD CONSTRAINT`, SQLite via the gated §38.6.3 rebuild. See error.map.md.

## Failing-statement attribution (NEW S288)

Both apply loops (the Postgres transaction loop in `runPgApply`, and the SQLite loop in
`runSqliteApply`) now wrap each statement's execution individually: on a throw, they attach
`e.scrmlFailedStatement = {index, total, sql}` before rethrowing. The CLI's error path
(`printFailedStatement`, `db-migrate.js`) echoes it:

```
error: migration failed (rolled back): relation "nonexistent_table" does not exist
  failing statement: (2 of 8)
    CREATE TABLE "bad_two" ( ... )
```

**Motivation (adopter S5 signal, offered as data, not filed as a bug):** the whole plan is printed
BEFORE the apply step, so an error's position in the printed output previously said nothing about
which statement actually failed — and Postgres's own message can point nowhere near the cause (e.g.
the pre-fix `default(now())` truncation bug surfaced as a misleading `syntax error at or near ";"`
with no indication which `CREATE TABLE` was truncated). The adopter burned a bisection cycle on that
exact combination before disproving a wrong hypothesis by repro. Verified by executing a
deliberately-failing migration against real PG16, not by reading the emit.

## Privilege separation (load-bearing, §14.8.11.1)

`--db` is the MIGRATOR/owner connection — a DDL-capable role (`CREATE ROLE`, `ALTER TABLE … FORCE
ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`). The RUNNING APP is a DIFFERENT, bounded principal:
the emitted server connects and, per query, `SET LOCAL ROLE scrml_app` (a `NOLOGIN NOBYPASSRLS` role
with CRUD-only grants) — it is, BY CONSTRUCTION, unable to apply or alter the security DDL (a role
that could install the RLS policy could also `DROP POLICY` it). So the apply step is OUT-OF-APP, run
by an operator/CI under the migrator credential — NEVER by the app runtime. Auto-apply-on-boot is
ELIMINATED for Postgres (a `scrml dev` local auto-apply and a `scrml build`-emitted `.sql` artifact
are separately-scoped, unbuilt fast-follows). Mirrors PostgREST's migrator-vs-authenticator
discipline.

## The ledger — `_scrml_migrations` (thin, NOT a version history)

```sql
CREATE TABLE IF NOT EXISTS "_scrml_migrations" (
  id bigserial PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  object_kind text NOT NULL,
  object_name text NOT NULL,
  ddl_hash text NOT NULL
);
```

One row per applied STATEMENT (not per migration run), recording what scrml authored
(`{table|policy|function|role|grant|revoke|alter|drop-policy|drop-table}` via
`classifyStatement` in `db-migrate.js`) + a content hash (`Bun.hash(stmt)`). Purpose: apply-atomicity
(guarded by a `pg_advisory_xact_lock(<fixed key>)`, transaction-scoped so a dead migrator process
leaks no lock) + OBJECT-AUTHORSHIP (an audit can answer "did scrml author this object" without a
full object-aware differ). There is no per-file migration history and no migration-authoring
surface — the S7-full object-aware policy/trigger/function differ is a separately-scoped, deferred
tail.

## Naming Convention
N/A — no migration files exist. The only naming surface is the ledger's `object_kind`/`object_name`
classification (above) and the DB-authoritative constant names: `scrml_app` (the bounded role),
`scrml_tenant_iso` (the tenant-isolation policy), `scrml.tenant`/`scrml.principal.caps` (the two
txn-scoped GUCs).

## Latest Migration
N/A — desired-state reconciliation has no "latest" concept; every run reconciles against the
project's CURRENT `<schema>` source. The ledger's most recent row (`ORDER BY applied_at DESC LIMIT
1`) is the closest analog, but it is an audit trail, not a migration pointer.

## Rollback
Manual. There is no `scrml db-migrate down` / no-op inverse — the tool is forward-reconcile only.
To remove a table: delete it from `<schema>` and re-run `db-migrate` with `--allow-destructive` (the
never-clobber fence otherwise refuses a bare `DROP TABLE` and fires `W-SCHEMA-DESTRUCTIVE-DROP`,
since a Postgres DROP CASCADEs the table's attached RLS policy/grants/role membership). scrml NEVER
emits `DROP FUNCTION`/`DROP ROLE` for a SECDEF/owner role, so a P2 `fn`/owner is never
auto-rolled-back either — remove it by hand if truly retiring it.

## Never-clobber fence (Fork 3)
A bare `DROP TABLE` for an actual-but-not-desired table is REFUSED by default
(`options.allowDestructive === false`, `diffSchema` in `schema-differ.js`) — fires
`W-SCHEMA-DESTRUCTIVE-DROP` instead, pointing the operator at `--allow-destructive`. The
scrml-managed security objects are roles/policies (never tables), so the table-DROP gate is the
whole fence at the table grain; `DROP POLICY IF EXISTS scrml_tenant_iso` re-creates ONLY the
scrml-managed policy name, never touching a hand-authored one on the same table.

## Known open gaps (`docs/known-gaps.md`)

**RESOLVED S292 — `g-dbauth-migrate-no-grants-for-unmarked-identity-table`** (was HIGH, adopter
login-500). See "Queried-table grants" above. The residual is the scanner's documented boundary, not
a silent hole: an `undetermined` fragment is reported to the operator.

**RESOLVED S290 — `g-db-migrate-ignores-constraint-drift-on-existing-columns`.** See
"Constraint-drift reconcile" above (§38.6.2 rows 6/7/8 + the §38.6.3 SQLite withheld-plan report).

**RESOLVED S290 — the `references` silent-drop** (now `E-SCHEMA-011`, §39.5.5). See above.

**RESOLVED S288 — `g-db-migrate-check-constraint-oneof-pattern`.** All three original sub-bugs
verdicted against real Postgres 16 through the real CLI: (1) the unquoted-bareword CHECK — FIXED
(the `oneOf`/`notIn` SQL-literal lowering, see schema.map.md's literal-lowering-functions section);
(2) the false `E-DBAUTH-NO-TENANT-COLUMN` pre-flight fire — tried 9 shapes, NOT REPRODUCED; (3) the
`pattern(/…{n}…/)` brace — was ALREADY fixed by P2, now regression-locked.

**RESOLVED S288 — `g-db-migrate-default-emission`** (was HIGH) — `default(now())` truncated the
whole `CREATE TABLE` (the old `[^)]+` capture stopped at the first `)`) and `default("US")` emitted
the SQL IDENTIFIER `DEFAULT ("US")` instead of a string literal; both fixed in the same landing
(`findMatchingParen` balanced two-pass scan + `lowerDefaultToSql`). Blocked 7 of the adopter's 10
real tables pre-fix.

**RESOLVED S288 — `g-dbauth-p2-pk-tenant-not-auto-immutable`.** See schema.map.md's
`isEffectivelyImmutable` — a `db-authoritative` table's PRIMARY KEY and `tenant_id` are now
auto-immutable regardless of the `immutable` bareword.

**Still open:** `g-schema-predicate-arg-parse-edges` (MED, NEW S288) — `oneOf([])` on an empty array
still emits invalid SQL (`CHECK (col IN ())`) rather than a compile rejection or `CHECK (false)`;
`escapeSqlString` doesn't escape `\` (a latent MySQL-only trap, unreachable today — MySQL apply is
hard-refused, "Phase 3" in `db-migrate.js`). `g-dbauth-p2-caps-provenance` (MED, S287) —
`tenant-egress.ts`'s `_scrml_active_caps(req)` has no real session-caps source yet, so any
`requires cap("x")` SECDEF is inert-deny until wired (couples to S8 live revocation).
`g-dbauth-secdef-owner-crud-all-tables` (LOW, S287) — a SECDEF owner role gets CRUD on every
db-authoritative table, not just the ones its `fn` body touches. `g-dbauth-no-request-path-test`
(MED, NEW S288) — the tier's regression lock (`schema-only-tenant-principal.test.js`) asserts
EMISSION, not a real login-over-HTTP → cookie → per-user-read round trip; The adopter has offered
their own request-path harness. `g-dbauth-docs-no-do-not-mark-users-example` (LOW, NEW S288) — the
`db-authoritative` marker reads as "apply to everything"; ask is a worked counter-example (don't
mark the `users` table itself — the login lookup that establishes the principal can't yet BE the
principal) in the docs pass.

Also see error.map.md (the exact §34 fire sites) and schema.map.md (the lowering-function
inventory and `isEffectivelyImmutable`).

## Tags
#scrml #map #migrations #db-migrate #dbauth #db-authoritative #schema-differ #privilege-separation #ledger #never-clobber-fence #rls #secdef #postgres #failing-statement-attribution #auto-immutable #e-schema-010 #e-schema-011 #resolved-gaps #print-failed-statement #queried-table-grants #sql-table-refs #least-privilege #undetermined-sql #column-constraint-drift #w-schema-constraint-tightened #w-schema-constraint-drift-unapplied #withheld-plan #run-pg-apply-signature #zero-diff-11-windows #batch-in-list-cap-is-not-an-onion-stage #schema-body-is-ddl #state-block-statement-form-adjacency #s437b #9941a504c #zero-diff #s440 #cf62b415 #s447 #6a592ed5c #self-host-v1-removed #test-tmp-root #protect-egress-r8 #s450 #9bafb927 #native-parser-frozen #parser-flag-retired #session-ambient-server #auth-attr-invalid
#schema-differ-new-consumer #parseschemablock
#s405 #rawddl-schema-invisible-to-db-migrate #if-t-rawddl-continue #split-at-the-consumer #diffschema-byte-identical #four-defects-impossible-by-construction #one-shared-recognizer #schema-differ-owns-it #import-direction-invariant #postgres-qualifier-normalized #e-pa-003-shadow-db #overwrite-last-wins-vs-first-wins #sourcetext-recovery-deleted #two-individually-correct-fixes-cancelling #w-schema-no-tables-declared #schema-anchor-fixture #deferred-migrate-arc
#s437 #d02738767 #db-migrate-busy-timeout #no-wal-on-cli-handle #db-migrate-redaction

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [build.map.md](./build.map.md)
