# schema.map.md
# project: scrml
# updated: 2026-10-01T21:45:00Z  commit: 78e4ddad
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
# checker; `slice-m1/` instance-record runtime + 68 tests; new CI step. #1104 — `compiler/self-host/` FROZEN (reference
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
# ━━━━━━━ S437 SCHEMA DELTA ━━━━━━━
# `git diff --stat 787d4cb4..HEAD -- compiler/src/types/` -> **EMPTY** — `types/ast.ts` is byte-unchanged, yet TWO new
# AST shapes landed (`defer-stmt`, `import-decl.hostTag`), both built in `ast-builder.js` / `native-parser/translate-stmt.js`
# and declared in NO type file (`grep -n 'defer-stmt\|hostTag' compiler/src/types/ast.ts` -> nothing). See
# `## S437 — NEW SHAPES` below, which also rows the new codegen/PA-internal interfaces. §66's declaration model is
# Nominal: NO AST type for it exists in impl#1.
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
# ━━━━━━━ S422 SCHEMA DELTA — **NO NEW EXPORTED TYPE SHAPE; TWO NEW EXPORTED CONSTANT SETS.** ━━━━━━━
#
# ⛑ **RE-DERIVED BY GREPPING THE DIFF FOR DECLARATION FORMS, NOT BY READING A CHANGELOG.** Across
# `compiler/src` (+1,195 / -79 over 12 files) the window added **no new `interface`, no new exported
# `type` alias, and no new DB/proto/GraphQL shape.** The type-level additions are two typed constant
# sets and one internal analysis type:
#   - `export const REGEX_AFTER_CLOSE_PAREN_KEYWORDS: ReadonlySet<string>` —
#     **`compiler/src/codegen/code-segments.ts:46`**. THE shared vocabulary that stops the tokenizer
#     and codegen from drifting on WHICH control-flow heads allow a regex literal after their closing
#     `)`. Consumed at `compiler/src/tokenizer.ts:62` (import) and `:1586` (test), inside
#     `closesControlFlowHead` (`tokenizer.ts:1573`).
#     ⚑ **THIS IS A TWO-SITE INVARIANT MADE SINGLE-SITE. Do not re-hand-spell either side.**
#   - `const MAP_RUNTIME_PROVIDED_NAMES: ReadonlySet<string>` — `compiler/src/codegen/emit-library.ts:89`
#     (module-private). Siblings: `MAP_RUNTIME_REFERENCED` (a `RegExp`, `:100`) and
#     `MAP_SET_SURFACE_METHODS` (`Set<string>`, `:117`).
#   - `const CONDITION_HEAD_CONTINUATION_PUNCT = new Set([...])` — `compiler/src/ast-builder.js:10640`,
#     read by `continuesConditionHead` (`:10662`) at `:10717`. **Its membership is normative** — the
#     §34 row for `E-CONDITION-HEAD-UNPARENTHESIZED` enumerates it and forbids widening. Treat this
#     `Set` as SPEC-pinned data, not as an implementation detail.
#
# ⛑ **SCOPE ANALYSIS GAINED A REAL SHAPE, AND IT IS THE ONE TO KNOW ABOUT.**
# `_lexicalBindingsAtInnerFunction(target): Set<string>` — **`compiler/src/type-system.ts:18885`**,
# with its helper `sameLevelDecls(nodes): string[]` at **`:18889`** and a consumer comment at `:19446`.
# It answers "which names are lexically visible at an inner function boundary" by a GENERIC descent
# rather than a fixed `body`/`then`/`else`/`consequent`/`alternate`/`children` key list, because a
# fixed list cannot see an `if-chain`'s `branches[].element` / `elseBranch` — **and a miss there costs
# a FALSE `E-MU-001`.** Declaration kinds it collects: `let-decl`, `const-decl`, `lin-decl`,
# `variable-decl`; it deliberately does NOT descend through `function-decl` or `closure`.
# ⚠ **Its correctness argument is that non-statement arrays contribute no declaration names, so a
# generic descent cannot ADD anything a keyed walk would not.** If you add a declaration `kind`
# anywhere in the AST, this is one of the sites that must learn about it.
# Sibling, block-scoped: `blockScopedDeclaredNames` — exported from `compiler/src/codegen/emit-logic.ts`,
# consumed in `compiler/src/codegen/emit-control-flow.ts:511` and `:527` (then-limb / else-limb).
#
# ⚑ **`postRe` — THE STANDING CITATION HAZARD, RE-DERIVED AT THIS WATERMARK.**
# `grep -n 'const postRe' compiler/src/type-system.ts` returns **THREE** sites:
# **`:27384`, `:28322`, `:28447`** (each followed by `postRe.test(tv)` at `:27385`, `:28323`, `:28448`).
# ⛔ **The prior report's own CORRECTION to this — `:27224 / :28162 / :28287` — has ITSELF gone stale.**
# Two generations of citation, both right when written, both wrong now. **Locate by symbol. Always.**
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
# ━━━━━━━ S405 wrap-6c — **`compiler/src/types/` IS `--name-only` EMPTY. NO AST TYPE MOVED.** ━━━━━━━
#
# Command: `git diff --name-only 68cfac6d..e74f5423 -- compiler/src/types/` -> **EMPTY**. So every
# `ast.ts` shape in this map is carried on a VERIFIED-empty diff, including S404's `LitExpr`
# `hasInterpolation` field. ⚠ A zero-diff surface is an UNCHANGED map, not a correct one.
#
# ⛑ **WHAT DID MOVE IS THE SCHEMA-*READING* SIDE, AND IT ADDS A FIELD TO A NON-`ast.ts` SHAPE.**
# `extractDesiredSchema` (`compiler/src/codegen/db-authoritative.ts:121`) returns
# `{ tables: Array<{ name: string; dbAuthoritative?: boolean; [k: string]: unknown }>; fns; warnings }`
# — and as of #900 a table harvested from a **raw `CREATE TABLE … (…)` DDL `<schema>` body** carries
# **`rawDdl: true`** and **COLUMN NAMES ONLY**.
#
# ⛔ **THAT MARKER IS LOAD-BEARING, NOT DECORATIVE, BECAUSE THIS ONE PRODUCER HAS TWO CONSUMERS WITH
# OPPOSITE NEEDS:**
#   · **§14.8.10 TENANT floor** (`emit-server.ts:1769` -> `tenant-egress.ts:buildTenantContext` `:127`)
#     wants EVERY declared table INCLUDING raw DDL — a `tenant_id` column's PRESENCE *is* the
#     declaration (§14.8.10: *"There is no per-table opt-in attribute"*), and a table it cannot see
#     yields a silently INERT isolation floor at exit 0.
#   · **`scrml db-migrate` / `diffSchema`** (`commands/db-migrate.js:219`) wants the OPPOSITE — it OWNS
#     and REWRITES schema, and a raw table's DDL is AUTHOR-owned and only PARTIALLY recovered (no
#     constraints, defaults, FKs or `CHECK` bodies). **It declines them at its OWN boundary in one
#     line: `if (t.rawDdl) continue;` — `db-migrate.js:244`.**
# **`diffSchema` is BYTE-IDENTICAL to its pre-arc behaviour as a result.** `schema-differ.js:1131-1137`
# states the split from the differ's side. Deferred arc at that seam:
# `docs/changes/migrate-consumer-raw-ddl-2026-09-08/SCOPE.md`.
#
# ⚑ **THE `<schema>` PARSE VOCABULARY, ALL IN `compiler/src/schema-differ.js` AT THIS WATERMARK:**
# `parseSchemaBlock` (`:31`, the declarative `tableName { col: type }` DSL — the ONLY form it knows) ·
# `harvestCreateTables` (`:246`) · `harvestRawCreateTableDecls` (`:264`, what `extractDesiredSchema`
# consumes) · `harvestRawCreateTables` (`:282`) · `parseRawCreateTableColumns` (`:348`, single
# statement; ⚠ **no production caller — every in-tree caller is a test**, and the file says so at
# `:335-345` rather than leaving it implicit).
#
# ⚑ **`class TenantTableSet extends Set<string>` (`codegen/tenant-egress.ts:84`) IS A SHAPE WORTH
# KNOWING: it overrides EXACTLY `add` / `has` / `delete` to lowercase a string argument.** A read that
# bypasses those three (`[...set]`, `forEach`, `entries`, `size`) sees the FOLDED form and does not
# fold the probe.
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
# ⛑ **RE-WALKED ON THIS MAP'S OWN SURFACE, WHICH IS NON-EMPTY FOR THE SECOND CONSECUTIVE WINDOW.**
# `git diff --name-only 499eecce..68cfac6d -- compiler/src/types/` -> **`compiler/src/types/ast.ts`,
# +25 lines**, and the 25 are ONE optional field plus its 20-line doc comment. `stdlib/` and every
# `*.d.ts` / `*.proto` / `*.graphql` glob are `--name-only` **EMPTY**.
#
# **THE ONE NEW FIELD: `LitExpr.hasInterpolation?: boolean` (`compiler/src/types/ast.ts:1725`, #877).**
# See "AST literal nodes" below. ⛔ **It is CARRIED, never inferred, and the field's own doc comment is
# the normative statement of why** — the retired alternative was reconstructing the answer as
# ``raw === "`" + value + "`"``, a test whose own comment called it "an exact test, not a heuristic"
# and which is ALSO satisfied by ``raw === "``"`` / `value === ""`, the exact pair a multi-quasi
# template degrades to when its source text could not be recovered.
#
# ⚠ **A KNOWN HOLE IN THIS MAP, NAMED RATHER THAN QUIETLY FILLED: an S404 dispatch reported that this
# file's only assignability paragraph — the `asIs`/`unknown` permissiveness split — is TRUE but
# answers a DIFFERENT question from §7.5.1 positional assignability**, and `primary.map.md`'s
# `inferExprType` routing row was sending assignability tasks here. That row now says it is not the
# assignability row. **§7.5.1 / `E-TYPE-031` / `int`-vs-`number` live in `primary.map.md` Task-Shape
# Routing row 1**, because the answer is "which of five positions is implemented" (two) plus "which
# function you must NOT route to" (`fieldTypeAssignable`) — routing facts, not type shapes.
#
# ━━━━━━━ S402 wrap-6c — **STAMP ADVANCED. `10a4b045` -> `499eecce`.** ━━━━━━━
#
# ⚠ **THE WINDOW IS FOUR SESSIONS WIDE, NOT ONE** — `10a4b045..499eecce` is **36 commits, PRs
# #835-#872** (S399 · S400 · S400-peter · S401 · S402). The prior stamp is 4 sessions behind because
# S398-S401 did not fire a wrap-6c. Per-file attribution is in `primary.map.md`'s header.
#
# **THIS MAP:** **`compiler/src/types/` IS NON-EMPTY FOR THE FIRST TIME IN SIXTEEN WINDOWS** — `types/ast.ts` +47 at `85ebbb5f` (#859): `FILE_SHAPES` (`:1575`) · `FileShape` (`:1584`) · `FileAST.fileShape?` . Nothing else in `types/` moved. Re-walked, not stamp-advanced.
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
# **NO SCHEMA CHANGE THIS WINDOW.** No type, model, `.proto` or corpus SCHEMA file changed between
# `ad7b65dc` and `2d8dd8cb`; the two new conformance cases use the existing `expect` shape. Carried forward
# VERIFIED-UNCHANGED.
#

The compiler's "schema" is its own AST, not an application data model. Root catalog:
`compiler/src/types/ast.ts` (2104 lines, 114 exported interfaces/types, ~91 distinct `kind` discriminants — unchanged since fbb4d9fd/df2ac831; this window's schema-differ.js changes below added NO ast.ts shape, same as the S287 DB-authoritative tier before it). Read that file directly for the exhaustive list; this map groups it and calls out the load-bearing shapes.

**Currency (S397, `10a4b045`):** ⛑ **`compiler/src/types/ast.ts` is `--name-only` EMPTY for the
FIFTEENTH consecutive window and NO exported type moved anywhere in the compiler — AND THIS MAP IS
STILL NOT STAMP-ADVANCED ON THAT ZERO, because a load-bearing CODEGEN-INTERNAL shape changed.**
`EmitLogicOpts.tildeContext` went from `{ var; mode? }` to a four-field object with `armBodyStmts:
ReadonlySet` and `liftVar` (#830) — see its section below. ⚑ **THE LESSON IS THE INSTRUMENT, NOT THE
SHAPE: `git diff --name-only -- compiler/src/types/` IS NOT A SUFFICIENT CURRENCY PROBE FOR THIS
MAP.** Every landing for fifteen windows has worked through existing node kinds or through
codegen-internal / schema-differ-internal shapes that are not `ast.ts` types, so the probe that
gates this map has returned EMPTY every time while the map's actual subject matter kept moving.
The zero is real and it means almost nothing.
existing node kinds, or through codegen-internal / schema-differ-internal shapes that are NOT
`ast.ts` types (the §38.6.2 constraint-drift record, the D-5 module-const candidate filter's reliance
on `ConstDeclNode`/`LetDeclNode.initExpr`, `LogicBinding.directiveIsFormValue`, and the S302
`ifRaw`/`ifCond` pair below), and now the #458 region shapes immediately below.

## S446 — SHAPE DELTA (`464c9ab4d..78e4ddad`)
- **NEW diagnostic `E-SCHEMA-014`** (SPEC §39.2/§14.8.10): a readable, UNQUALIFIED `CREATE … TABLE` head in a
  `<schema>` body that is not a plain declaration — a kind modifier between `CREATE` and `TABLE`; the name followed
  by a clause instead of a column list (`AS`/`OF`/`PARTITION OF`/`USING`/`WITH`/`ON COMMIT`/`TABLESPACE`/`INHERITS`);
  an unclosed column list; or a column list followed by a trailing `INHERITS (parent)`. Emitted at
  `gauntlet-phase1-checks.js`, from `schema-differ.js` `findRejectedCreateTableHeads` (new `kind: "not-a-declaration"`
  value). A `TEMP`/`TEMPORARY`-only head inside a live SECURITY-DEFINER fn's triple-quoted body text is exempt (runtime
  plpgsql staging, not a declaration).
- **`schema-differ.js` NEW/extended export** `findGluedDslTableHeads` — reads a declarative `name {` head that is the
  TAIL of a longer token (a `.`-qualified prefix → `E-SCHEMA-012`; any other glued prefix, e.g. non-ASCII letter /
  digit / `-` / `$` → `E-SCHEMA-013`); before S446 the parser's one-character recovery silently declared the tail,
  collapsing two differently-named tables onto one key.
- **`db-ownership.ts` NEW shape predicate** `sqlDeclaresTable(sql: string): boolean` — comments and string literals
  stripped; a CTAS or `CREATE VIRTUAL TABLE` counts as declaring; a `TEMP` table or one qualified to another attached
  schema does not; `main.`-qualified does. Backs `decideOwnedDbFiles` (per-declaring-file DB ownership, SPEC §8.1.1)
  — a runtime/build-time ownership model, not a TypeScript type, but the shape every DB-ownership consumer reads.
- A tenant-declaration UNION fix (would have widened the §14.8.10 tenant floor to every same-name declaration) was
  REVERTED mid-PR: it let a stale commented-out copy WITH `tenant_id` over-scope a live table WITHOUT it. Base
  first-wins shadow behaviour stands; the gap is reopened (routed to bryan).

## S445 — SHAPE DELTA (`5b1d0dab0..464c9ab4d`)
### `BuildRootResolution`  [compiler/src/route-inference.ts:6983]
origin: "given" | "inferred" | "none"
root: string  (separator-normalized, no trailing "/")
candidates: FileAST[]
entry?: FileAST
entryBasis?: "outside-route-dirs" | "shallowest"
### `RIInput`  [route-inference.ts] — gains `buildRoot?: string` (`:4477`)
### `ChunksBootInput`  [compiler/src/codegen/emit-html.ts:4364]
chunks: Map<string, HtmlAugmentChunk>
epIdToRoutePath: Map<string, string>  (EntryPointId → routePath)
moduleFormat?: "classic" | "esm"
### `CgOutput`  [compiler/src/codegen/index.ts:344] — gains `chunksBootJs?: string`, `chunksBootFilename?: string`
### `ProtectAnalysis`  [compiler/src/protect-analyzer.ts:124] — gains `declaredTables?: Set<string>`
### Bootstrap Core  [compiler/self-host-v2/core.scrml]
SeqGrants: + `shrink: SeqAt[]`
HostCall:enum = { DateNow } · SeqFn:enum = { Filter, Map } · BindKind:enum = { Value, Checked }
Expr: + `Host(call)`, `Lambda(params: Sym[], body: Expr)`, `SeqCall(op, seq, f)`
edit/place: + `RemoveEnd`, `RemoveFront`, `RemoveAnywhere`, `ElemAt(index: Expr, path: FieldRef[])`
Attr: + `Bind(kind, read: Expr, sink: Sym, write: Block)` · View: + `Star(decl: Sym, inst: InstRef)`
### Bootstrap AST  [compiler/self-host-v2/ast.scrml]
AValArg:enum = { NoArgs, Cmp(op, e), Exprs(es), Regex(source, flags) }
AValidator:struct = { nid: int, span: ASpan, name: string, arg: AValArg }; declarations carry `validators: AValidator[]`
`Text(text)` keeps whitespace-only runs (L13 retired, dpa-045 fu4)

## S444 — SHAPE DELTA (`cf62b415..108ca89be`)

### `compileScrml` (`compiler/src/api.js`)
- Result gains `clientAssets: string[]` — the build's client-asset allowlist (§47.13), also written to
  `<outputDir>/.scrml-client-assets.json` as `{ clientAssets }` (`static-serve-policy.js` `CLIENT_ASSET_MANIFEST`) when
  the emit gate did not fail.
- Worker bundles: a CG output's `workerBundles: Map<name, js>` is now written (`workerBundleFilename` / `workerBundleSuffix`
  in `codegen/emit-worker.ts`) and its `*.worker.js` files join the client-asset seeds (#1174).
- Seams: `CSS` is a new sub-seam of CG (`pipeline-seam.ts`); the stage entry is
  `(nodes, cssBlocks, errors, fileAST, { filePath, mode }) -> string` (`slice-m3/css-substitute.js` header).

### `compute-program-config.ts`
`authConfig.csrf: string` — resolved by `effectiveCsrfUnderAuth`: under `auth=`, absent or any value outside the §52.13
set resolves to `"auto"`; only literal `"off"` opts out (#1161).

### `codegen/protect-flow.ts` (NEW)
`ProtectFlowLeak`, `ProtectTagSite`, `ProtectFlowResult`, `ProtectStripInfo`, `CompileModule { filePath, js, infos?, spanOf? }`;
`ALL_COLUMNS_LABEL = "*"`.

### `codegen/js-async-analysis.ts` (NEW)
`ResolvedAsync`, `FreeAsyncResolver` (callable + properties), `JsAsyncCall`, `JsAsyncEscape`, `JsAsyncUses`,
`ColoredBody extends JsAsyncUses`, `ActiveClientAsync`, `ColorOpts`.

### Bootstrap stylesheet Core (`compiler/self-host-v2/core.scrml`, `css.scrml`, `css-ingest.scrml`)
`CssUnit:struct` (`core.scrml:428`) + selector/decl types (`SimpleSel`, `Combinator`, `Compound`, `SelLink`,
`ComplexSel`, `CssPart`, `CssDecl`, `StyleRule`, theme tokens); output tree `OutSel:enum`, `OutDecl:enum`,
`CssStmt:enum` (`css.scrml`); `CssIngest:struct = { unit: CssUnit, why: string[] }` (`css-ingest.scrml`).


## S440 — SHAPE DELTA (`fb21983a..cf62b415`)

**No new `compiler/src/types/ast.ts` type.** New shapes are in the bootstrap (scrml) and in two new TS modules.

### Bootstrap `analyze.scrml` — `TypedProgram` and its `Tables` (M3 items 1 + 2)
### TypedProgram  [compiler/self-host-v2/analyze.scrml:225]
files: FileAst[] · tables: Tables · diags: Diag[]
### Tables  [analyze.scrml:209]
program: Sym · types: TypeInfo[] · decls: DeclInfo[] · fns: FnInfo[] · handles: HandleInfo[] ·
names: NameTable · values: ValueTable · effects: EffectTable · binds: BindTable · elems: ElemTable · attrs: AttrTable ·
annots: LocalAnnot[] · typing: Typing
### family tables  [analyze.scrml:190-195] — each `{ facts: F[], nids: int[], at: int[] }`; `at[nid]` = slot (O(1)); built once by `indexed`
NameFact = NLocal(sym) | NField(decl, inst, idx) | NInst(decl, inst) | NStruct(owner, idx) | NFn(sym) | NLength
ValueFact = VLit(lit) | VVariant(enumSym, idx) | VOp(op: PrimOp) | VStructOf(ty, order: int[])
EffectFact = EWrite(w: WriteFact) | ESpread(ws: SpreadWrite[], inst, snap, fields: SnapField[]) | EReset(w, decl, idx) | EAssignLocal(sym)
BindFact = BBind(sym) | BParam(sym, ty) | BGiven(sym, inst)
ElemFact = MHtml | MUse(decl, alias: Sym | not) | MEach(bind, handles: Sym[]) | MSlot
AttrKind = AStatic | ABound | AOn(event) | AIf | AConstruct(field) | AAs | AEachIn | AEachKey | AEachAs | …
### typer table  [analyze.scrml:203-207]
VType = Known(t: Type) | Absent | Unknown · ExprType { nid, vt } · Typing { exprs: ExprType[], at: int[] } (read via `exprType(t, nid)`) · LocalAnnot { sym, ty }
### records
FieldInfo { nid, span, annotated, trusted, typeSpan, sym, ty, mode: FieldMode, role, grants, graph, exported, wcap, init, reads }
DeclInfo { nid, span, sym, kind: DeclKind, single, file, fields, handles } · HandleInfo { sym, name, target, owner, conditional, span, file }
TypeInfo { nid, span, name, file, exported, def } · FnInfo { nid, span, sym, name, file, exported, pure, arity (-1 = unchecked), ret: Type | not }
WriteFact { cap, inst, edit, check } · SpreadWrite { w, prop, tmp: Sym | not } · SnapField { ref: FieldRef, local: Sym } (RULED S440 strict snapshot)

### Bootstrap Core (`core.scrml`) — changed
`Stmt` gains **`Commit(writes: Stmt[])`** (#1129): an all-or-nothing group of `Write`s of snapshot Locals (spread
override); checked by `check.scrml` C7; printed via runtime `checkEdge` before any write applies.
`CoreProgram { program, decls, types, fns, server: ServerFn[] }`.

### Bootstrap `ingest.scrml` (NEW, throwaway)
IVal = VStr | VNum | VBool | VNull | VNode(INode) | VList(IVal[]) · IField { key, val } · INode { entries } · IFile { path, ast } ·
Ingested { core: CoreProgram, why: string[] } (non-empty `why` = not-yet).

### `compiler/src/codegen/local-async-fns.ts` (NEW, #1139)
AsyncRoot { kind: "server" | "stdlib"; via: string } · LocalFnResolution { name; async; root: AsyncRoot | null } ·
LocalAsyncAnnotateOpts { outerAsync(name) -> AsyncRoot | null; sqlIsAsync; bodyHasSql?; isByRefInvokingCall? } ·
AST mark keys (set on existing nodes, not new node kinds): `_scrmlLocalCallee` (call), `_scrmlLocalFnRef` (ident),
`_scrmlLocalAsync` (nested function-decl).

### `compileScrml` option (api.js, #1125)
`beforeWrite?: ({ errors, outputDir, plannedServerUnits }) => boolean` — `false` skips every write.


## S438 — SHAPE DELTA (`9941a504c..fb21983a`)

**No new `ast.ts` type.** `schema-differ.js` gains a new exported recognizer, **`findRejectedCreateTableHeads`**
(§39.2, consumed by `gauntlet-phase1-checks.js`'s `<schema>` body checks — same call site as the existing
`parseSchemaBlock`/`parseColumns`, a sibling scan over the same raw body text, not a replacement of it).

### `findRejectedCreateTableHeads(schemaBody)` — structural head reader, new this window
Reads every raw `CREATE [modifier...] TABLE` head in a `<schema>` body (word-initial `CREATE`, ≤3 ASCII
modifier words, `TABLE`, then a name chain of Unicode letters/digits/`_`/`$`/quoted parts) and reports:
- **schema/database-QUALIFIED** (any qualifier count — `public.assets`, `mydb.public.assets`) → **`E-SCHEMA-012`**.
  A `.` inside ONE quoted identifier (`"a.assets"`) is not a qualifier.
- **UNREADABLE** (the name chain does not reach the column-list `(` or a name follower — `AS`/`USING`/`WITH`/
  `ON`/`TABLESPACE`/`PARTITION OF`/`OF`/`INHERITS`) → **`E-SCHEMA-013`**.
- Exempted (same as the rest of the `<schema>` DSL reader): `--` line comments, closed `/* */`, one-line
  `'…'`/`'"…"'`, `pattern(/…/)`. NOT exempted: `//`, `"""` spans, backticks.

Both are fail-closed rejections of a shape the pre-S438 `parseSchemaBlock` silently either stripped (one
qualifier) or matched no recognizer for (two+ qualifiers) — a schema-qualified or unreadable table name is a
**silently inert §14.8.10 tenant floor** when the table carries `tenant_id` (every `<schema>` consumer keys a
table by its UNQUALIFIED name). See error.map.md for the diagnostic text and known false-positive residuals
(`g-secdef-fn-body-ddl-false-positive`, a `//`-commented qualified head) and domain.map.md for the invariant.
Migration measured S438 at **zero** authored `.scrml` uses across the scrml repo, `flogenceP` and
`assetManagement` (169-file corpus differential, identical).

**`TableDecl`/`ColumnDecl` shapes themselves are UNCHANGED** — this is a validation-time rejection of a raw-DDL
HEAD, not a new field on the parsed table/column shape.


## S437b — SHAPE DELTA (`d02738767..9941a504c`)

`compiler/src/types/` — NOT changed in the window. The new `compiler/src` shape is one optional field, carried untyped.

### `handlerBlock` — a handler's parsed §5.2.3 statement list (#1106)
Set by `attachHandlerStatementList` in `compiler/src/ast-builder.js` on an event-handler attribute VALUE
(`value.handlerBlock = { stmts }`) ONLY when the value parses to 2+ statements; a 1-statement value has none and keeps
the old `handlerExprNode` path. `stmts` are the same statement nodes a function body produces (function-body parser).
| where | field |
|---|---|
| attr value (ast-builder.js, not declared in `types/ast.ts`) | `handlerBlock?: { stmts }` |
| `EventBinding`  [compiler/src/codegen/binding-registry.ts:54] | `handlerBlock?: { stmts: any[] }` — `handlerExprNode` then covers only the first statement |
| `EventBinding`  [compiler/src/codegen/emit-event-wiring.ts:24, file-local] | `handlerBlock?: { stmts: any[] }` (same contract) |
Consumers: `emitHandlerStatementList` (`codegen/emit-logic.ts:5754`) via emit-event-wiring / emit-each / emit-variant-guard;
`type-system.ts` walks `handlerBlock.stmts` for write targets and scope/state checks.

### Bootstrap Core IR — `compiler/self-host-v2/core.scrml` (#1105; scrml `type` decls, NOT TypeScript)
| type | kind | shape |
|---|---|---|
| `Sym` | struct | `id: int, hint: string` |
| `Type` | enum | `Int · Num · Str · Bool · Named(sym) · Seq(elem, grants: SeqGrants) · Maybe(inner)` |
| `TypeDef` | enum | `EnumDef(sym, variants: VariantDef[]) · StructDef(sym, fields: FieldDef[])` |
| `InstRef` | enum | `Shared(decl) · Lexical(depth) · Alias(sym) · Narrowed(sym)` |
| `Place` | enum | `Cell(decl, inst: InstRef, path: FieldRef[]) · LocalPath(sym, path)` |
| `Literal` | enum | `Int · Num · Str · Bool · Variant(enumSym, idx) · Absent` |
| `PrimOp` | enum | arithmetic, logic, comparison, `EqPrim/NeqPrim/EqStruct/NeqStruct`, `IsSome/IsNot`, `Concat`, `Length` |
| `Pattern` | enum | `PVariant(enumSym, idx, binds) · PLit(lit) · PWild` |
| `Expr` | enum | `Lit · Local · Read(place) · Call(callee, args) · Prim(op, args) · Match(scrut, arms) · ArrayOf · StructOf(ty, fields) · Handle(inst)` |
| `EditKind` | enum | `Replace · Append · Prepend · Anywhere · PositionWrite · FieldAt(path) · Transition` |
| `Stmt` | enum | `Let · Assign · Write(cap, inst, edit: EditKind, value, check: Check) · If(cond, thenB, elseB \| not) · Return · Eval` |
| `Attr` | enum | `Static(name, value) · Bound(name, e) · On(event, body: Block)` |
| `View` | enum | `El · Text · Dyn · Cond(arms) · Each(src, bind, key \| not, handles, row) · Instance(decl, attrs, slot, alias \| not) · Slot` |
| `Field` | struct | `sym, ty, init: Expr \| not, mode: FieldMode(Locked/Let/Derived/Seeded), role: FieldRole(Attribute/Child), grants: GrantSet, graph: TransitionGraph \| not, exported, wcap: Sym \| not` |
| `Decl` | struct | `sym, kind: DeclKind(Program/User/Predefined), single: boolean, fields, renders: View[] \| not, wiring: WiringAttr[], handles: Sym[]` |
| `Fn` / `ServerFn` | struct | `sym, params: Param[], body: Block` (+ `pure` on `Fn`) |
| `CoreProgram` | struct | `program: Sym, decls, types: TypeDef[], fns, server: ServerFn[]` |
Also: `NodeId`, `SeqAt`, `LengthGrant`, `SeqGrants`, `FieldDef`, `VariantDef`, `FieldRef`, `MatchArm`, `Check(Static/RuntimeEdge)`,
`Block`, `ConstructAttr`, `CondArm`, `GrantSet`, `Edge`, `TransitionGraph`, `WiringAttr`, `Param`, `CapOwner` — read `core.scrml`.
Output trees: `JsExpr`/`JsStmt`/`JsProp`/`JsOp` (`js.scrml`), `HNode`/`HAttr`/`Page` (`html.scrml`), `NameKey`/`NameTable` (`names.scrml`).
§66 (the declaration model this IR targets) is NOMINAL in impl#1 — these types have no counterpart in `compiler/src`.


⏳ NOT MAPPED: bootstrap M2 (#1109, `072741ca9`) landed on main mid-pass, after this stamp; it edits files named here (self-host-v2 modules, `slice-m1/`, `ci.yml`). Next refresh maps it.

## S437 — NEW SHAPES (`787d4cb4..d02738767`) — none of them is in `compiler/src/types/`

### `defer-stmt` (AST node, §19.16)  [built `ast-builder.js:6571`; native `native-parser/translate-stmt.js:1406`]
kind: "defer-stmt"
body: LogicStatement[]
blockForm: boolean   — `defer { … }` vs `defer <stmt>`
span: Span
Both front-ends produce the SAME node, so `validators/lint-defer.ts` is one checker for both.

### `import-decl.hostTag` (field on the existing `import-decl`, §21.3.1)  [`ast-builder.js`, native parser; see `host-import.js` header]
hostTag: string   — the identifier after `import:` (v1 accepts only `host`); `_hostImportRejected: true` is set by `validateHostImports` (`host-import.js:397`) when the gate refused it, and `module-resolver.js` then skips the import.

### `StageSeam`  [`compiler/src/pipeline-seam.ts:274`]
name: string  — `--swap <NAME>=…` / `stageOverrides` key (36 registered, `STAGE_SEAMS` `:334`)
tsModule: string · pipeline: string (PIPELINE.md label) · entry: string · signature: string
selfHostKey?: string  — legacy `selfHostModules` key
output: Check · mutated?: (args) => Divergence · reentry?: readonly string[]
`PARSE_REENTRY_FILES` (`:311`, 9 files) — modules that call the TS block-splitter / AST builder directly, so a BS/TAB swap yields mixed-provenance ASTs.

### `DbTargetClass`  [`compiler/src/db-target.ts:40`]
kind: "postgres" | "mysql" | "mongo" | "unsupported-scheme" | "sqlite-memory" | "sqlite-file" | "empty"
trimmed: string · scheme: string | null · sqlitePath: string | null

### `SessionAttrResolution`  [`compiler/src/codegen/session-config-resolve.ts:55`]
value: unknown · source: "middleware" | "unit" | "stash"   (`stash` = unattributable → feeds `E-MW-008`)
`SessionAttrName` = "sessionExpiry" | "session-secure"; `UnattributableUnit` (`:157`) records filePath + attr.

### `ConnectionAttr`  [`compiler/src/diagnostic-secrets.ts:564`]
element: string · name: string · value: string · start: number · end: number   (value offsets inside quotes)

### `DeferDiagnostic`  [`compiler/src/validators/lint-defer.ts:69`]
code: DeferCode (7 codes; `E-DEFER-SERVER-IN-SPLIT` is emitted by `route-inference.ts`, not here) · message · span · severity: "error"

## Codegen-internal region shapes — NOT `ast.ts` types (NEW #458, at `97576f35`)

`compiler/src/codegen/code-segments.ts` exports two shapes that describe a region of EMITTED JS TEXT,
not a source AST node. They are here so a `grep interface` in `compiler/src/` does not come back
puzzled, and flagged as non-AST so nobody threads them through the node pipeline.

- **`BraceGroupKind = "object-literal" | "binding-pattern" | "unknown"`** (:91) — the verdict of
  `classifyBraceGroup(code, open, closeExclusive)`. **`"unknown"` is a first-class value with a
  contract, not a null case: the caller SHALL leave its existing behaviour unchanged for that region.**
- **`interface ObjectShorthandRegion`** (:93) — `{ start: number; end: number; kind: BraceGroupKind;
  names: string[] }`. `start` indexes the opening `{` **within the code segment** (NOT the whole
  buffer — offsets are segment-relative, which matters because the producer runs inside
  `rewriteCodeSegments`); `end` is one past the closing `}`; `names` are the bare identifiers between
  the braces in source order. Returned regions are non-overlapping and in source order.

Sole producer: `findObjectShorthandRegions(code)` (:213). Sole consumer: `emit-client.ts`'s
`rewriteCodeSegment` (:3038). See domain.map.md / dependencies.map.md for why only the
`object-literal` kind is acted on.

## `EmitLogicOpts.tildeContext` — the §32 `~` context object (CHANGED SHAPE, S397 #830)

**A codegen-internal shape, NOT an `ast.ts` type.** Declared on `EmitLogicOpts` in
`compiler/src/codegen/emit-logic.ts:118+`. It is here because its shape CHANGED this window in a way
that silently invalidates any consumer written against the old one.

```
tildeContext?: {
  var: string | null;              // the ENCLOSING `~` READ/INIT slot
  mode?: "single" | "array";       // "array" = loop accumulation (.push)
  armBodyStmts?: ReadonlySet<any>; // NEW S397 — DIRECT statements of this if-expr's arm bodies
  liftVar?: string;                // NEW S397 — the ARM'S RESULT variable
}
```

⚑ **`var` AND `liftVar` WERE ONE FIELD BEFORE S397, AND THE CONFLATION IS THE ENTIRE HISTORIC DEFECT
CLASS.** `var` = *"what `~` reads"*; `liftVar` = *"where `lift` writes"*. When they were the same
field, a bare statement minting into it stole the `lift` target, and an in-arm `~` read resolved to
the arm's `null`-seeded result var instead of the enclosing accumulator. **A consumer that still
treats `tildeContext.var` as the arm's result is reading the WRONG SLOT and will compile clean.**

⚑ **`armBodyStmts` IS A `ReadonlySet` OF STATEMENT OBJECTS — MEMBERSHIP IS BY IDENTITY, NOT BY SHAPE
OR BY POSITION.** It is deliberately not a boolean: a flag on this shared object propagates into every
child emitter, so the §32.2.1 carve-out was opt-OUT and three consecutive review rounds each found the
same defect in a construct nobody had enumerated. Identity does not propagate (a nested block's
children are different objects), so there are **ZERO strip sites**. Predicate: `_isDirectArmBodyStmt`.
⚠ **`armBodyStmts` does NOT mean "`var` holds the arm's result"**, and the doc comment on the type says
so explicitly because that misreading is what the field exists to prevent.

⚠ **Only `emitIfExprDecl` mints the 4-field form.** `emitForExprDecl` and `emitMatchExprDecl`
deliberately mint the pre-S395 `{ var, mode }` shape — §32.2.1 carves out §17.6.2 if-as-expression arm
bodies only, and a comprehension body (§17.7) or `match` arm (§18) is not covered by any ruling.
**That asymmetry is intentional; do not normalise it.** Full semantics in domain.map.md's `~` section.

## ⛔ scrml's AST HAS NO UNIFORM BINDER REPRESENTATION — and a `field:` regex cannot see most of it

**THIS BIT FOUR SEPARATE S397 DISPATCHES, WHICH IS WHY IT IS A SECTION AND NOT A FOOTNOTE.** There is
no single "binder" node, no shared interface, and no consistent field name. A binding appears as at
least five structurally different things:

| form | field | shape | example / site |
|---|---|---|---|
| structured parameter list | `params` | array of param objects | `fn` / `function` declarations |
| single bare name | `variable` | a bare `string` | `for-stmt` (`ast-builder.js:8817`, shorthand) |
| **raw paren TEXT** | `binding` | **ONE string, not a list** — `"x, cb"` | `match-arm-block` (`ast-builder.js:10079`); re-parsed downstream by `parseBindingList` (`codegen/emit-control-flow.ts:1173`) |
| product-pattern arms | `productPatterns` | array | §18.19 multi-scrutinee (`ast-builder.js:9920`, shorthand) |
| iteration variable(s) | `asName` / `asNames` | bareword string / 2-name array | `each-block` (`ast-builder.js:17016-17017`, shorthand) |
| variant payload | `payloadBindings` | array | `match-arm-block` (`ast-builder.js:10075`, shorthand) |

⛔ **AND THE GREP TRAP, WHICH IS THE PART THAT ACTUALLY COSTS TIME: `ast-builder.js` BUILDS MOST OF
THESE WITH ES6 SHORTHAND, SO A REGEX KEYED ON `binding:` / `variable:` / `asName:` CANNOT SEE THEM.**
MEASURED at this watermark: `grep -n 'binding:' compiler/src/ast-builder.js` returns **7** sites;
`grep -c 'binding'` returns **77**. The shorthand sites (`binding,` on its own line — `:13812`,
`:15236`, `:15313`, `:15369`, `:18729`) are invisible to the first probe and are the majority.
**Grep the bare identifier, then filter — never the `key:` form.** Same trap for `variable,`
(`:8817`, `:10860`, `:13357`), `productPatterns,`, `payloadBindings,`, `asName,` / `asNames,`.

⚑ **The `binding: "x, cb"` case deserves its own warning**: it is the raw paren-interior text with
whitespace collapsed, reconstructed at `ast-builder.js:10069` specifically so codegen can re-parse it.
**A consumer that treats it as a name gets `"x, cb"` as one identifier.** The AST does not hold the
list; `parseBindingList` derives it.

⚠ **This is a description, not a complaint.** Nothing here says the representation SHOULD be unified —
that is a design question nobody has ruled on. What it says is: **there is no single place to look, so
a walk or lint that handles "bindings" must enumerate all six forms, and the enumeration is not
discoverable by grepping for a field name.**


## §17.1.2 — `ifRaw` / `ifCond` on the three structural node kinds (S302)

**`engine-decl` / `match-block` / `each-block` carry NO `attrs` array.** They are not
`kind:"markup"`; `ast-builder.js` reconstructs each opener by regexing NAMED attributes out of the
header text, and an attribute nobody regexes for has nowhere to live. `if=` is therefore stored as a
PAIR of bare node fields, not as an attribute:

- **`ifRaw: string`** — the VERBATIM condition source (a raw slice, same shape as `inExprRaw` /
  `keyExprRaw` / `onExprRaw` / `armsRaw`).
- **`ifCond: AttrValue`** — the §5.2-PARSED attribute value: `{kind:"variable-ref"|"call-ref"|"expr",
  …}` plus `span`, `refs`, and (after `attrvalue-exprnode-walker.ts`) `exprNode`. **Byte-for-byte the
  object `<div if=…>` produces**, because `captureStructuralIfAttr` re-parses a synthetic opener
  through the same `tokenizeAttributes`+`parseAttributes` pipeline rather than classifying the value
  itself. That identity is what lets all four `if=` hosts share one lowering.

**ABSENT, not null, when the opener has no `if=`.** Both keys are omitted entirely — deliberately
NOT the null-when-absent convention the sibling opener fields use. The within-node parser-parity
canary compares FIELD SETS, and null-stamping every engine/match/each in the corpus registers as a
divergence at the ~2 nested-engine positions where live emits `text`/`comment` and native emits an
`engine-decl`, growing the allowlist for a field neither side disagrees about. Precedent on this same
node family: `engine-decl.bodyChildren`. Every consumer tests truthiness, so absent and null are
indistinguishable to them — the distinction exists only for the canary.

**The precise diagnostic anchor is `ifCond.span`; no separate attribute-NAME span is stamped.**

**Typing note worth knowing:** `engine-decl` is the only one of the three with an interface in
`types/ast.ts` (`EngineDeclNode` [910]). **`each-block` and `match-block` have NO `ast.ts` interface
at all** — they are ad-hoc object literals built in `ast-builder.js` (`:16230` and `:15276`/`:17447`).
A pass expecting a typed node for them finds nothing, and a field added to either is invisible to
`tsc`. Same class as `<outlet>` and the DB-authoritative shapes below.

## Root pipeline types

⛑ **S402 — `compiler/src/types/` IS NON-EMPTY FOR THE FIRST TIME IN SIXTEEN WINDOWS.** `types/ast.ts`
gained **+47 lines** at `85ebbb5f` (#859): a frozen runtime array, the union derived from it, and one
new optional `FileAST` field. Everything else in this file is unchanged over `10a4b045..499eecce`.

### FILE_SHAPES  [types/ast.ts:1575]  — a frozen `as const` array, the CLOSED set
```
FILE_SHAPES = Object.freeze(["program", "pure-module", "pure-channel", "non-entry-page", "bare-markup"] as const)
```
Every `.scrml` file classifies to EXACTLY one. **`"bare-markup"` is the RESIDUAL**, so the set is
exhaustive by construction and an unanticipated shape falls into the `W-PROGRAM-001` branch rather
than into silence.

⛔ **THIS IS THE ONE DEFINITION, AND ITS LOCATION IS FORCED — NOT A STYLE CHOICE.**
`compiler/src/library-shape.js:121` RE-EXPORTS this array (`export { FILE_SHAPES } from "./types/ast.ts"`)
rather than declaring a second copy. **The derivation only works in this direction:** `library-shape.js`
is untyped from TypeScript's side (importing it from a `.ts` raises TS7016 — "implicitly has an 'any'
type"), so a `typeof FILE_SHAPES[number]` written against THAT module would **silently collapse to
`any` and delete the type rather than derive it.**
⚠ **A SECOND LITERAL LIST ANYWHERE IS THE DRIFT #859 EXISTS TO REMOVE, AND IT WAS COMMITTED ONCE
DURING THAT ARC AND CAUGHT.** The `.js` module's own JSDoc `@typedef` IMPORTS the union rather than
restating it, for the same reason — a restated union would type-check JS callers against a stale
closed set while the runtime array carried a new member, and the §1 identity test (which compares the
runtime arrays only) would have stayed GREEN through it.

### FileShape  [types/ast.ts:1584]
```
type FileShape = (typeof FILE_SHAPES)[number]
```
**DERIVED, never hand-listed.**

### FileAST  [types/ast.ts:1551]
filePath: string
nodes: ASTNode[]
imports: ImportDeclNode[]
exports: ExportDeclNode[]
components: ComponentDefNode[]
typeDecls: TypeDeclNode[]
channelDecls?: ChannelDeclNode[]
hasProgramRoot: boolean
fileShape?: FileShape          — **NEW #859.** The §21.5 / §38.12.6 / §40.8 file-shape classification.
authConfig: AuthConfig | null
middlewareConfig: MiddlewareConfig | null

⛑ **`fileShape` IS OPTIONAL FOR THE SAME REASON THE PGO `has*` FLAGS ARE — an AST that has not
reached PRECG does not have it yet — AND THAT OPTIONALITY IS A LIVE HAZARD, NOT A FORMALITY.**
**`buildAST(...).ast.fileShape` IS `undefined` BY DESIGN** and a unit test asserts it: the TAB CALLS
`classifyFileShape` for the `W-PROGRAM-001` decision but records nothing. The STAMP is
`compute-pgo-flags.ts:computeFileShape` at the **Stage 3.004 PRECG seam** (`api.js`), and
`component-expander.ts` **RE-STAMPS** it after CE rebuilds `nodes`.
⚠ **READING THE FIELD BARE OFF A NON-PRECG AST DEGRADES SILENTLY.** `isLibraryShape(undefined, exports)`
returns `false`, so an unstamped AST quietly flips library auto-detect to `mode: 'browser'` — an
**EMIT-SHAPE change carrying no diagnostic.** All three consumers now fall back to the SAME
`classifyFileShape` function (never to a re-implementation): `api.js` W5a, `tool-program.ts:isLibraryShapedFile`,
`codegen/index.ts:getFileShape`.
⛔ **`fileShape` IS NOT "IS THIS FILE THE APPLICATION ENTRY".** Per SPEC §40.8 the entry is *"the file
resolved by the build root"* — a **BUILD** fact no single FileAST can carry. `"program"` says only
that this file declares a top-level `<program>`, and `E-PROGRAM-002` (uniqueness) is
reserved-not-implemented, so more than one file in a compile unit can carry the shape.
⚑ **TWO WRAPPED/UNWRAPPED READ BUGS WERE FIXED IN THE SAME COMMIT AND BOTH HAD THE SAME SHAPE:**
`tool-program.ts` and `codegen/index.ts:getFileShape` each resolved the NODE LIST from one object and
the FLAGS from another, so the fallback classified a node list against `hasProgramRoot` belonging to a
different object — answering `"non-entry-page"` for a `<program>`-bearing file. **At the codegen stage
a file is a `{ filePath, ast, nodes? }` wrapper; resolve ONE object and read every field from it.**

### TABOutput  [types/ast.ts:1582]
Output shape of the TAB (Typed AST Builder) pipeline stage; wraps FileAST + TABErrorInfo[].

### ASTNode  [types/ast.ts:1471]  /  ASTNodeKind = ASTNode["kind"]  [1489]
Discriminated union over ~91 `kind` string literals — the single node-shape switch every codegen/emit-*.ts and type-system.ts pass dispatches on.

## Node-shape groups (by ast.ts region)

**Markup / structural** — MarkupNode [214], TextNode [249], CommentNode [256], HtmlFragmentNode [1169], ChannelDeclNode extends MarkupNode [1326] (tag:"channel"; isExport?; P3.A CHX-inline provenance fields).

**Declarations** — LetDeclNode [447], ConstDeclNode [462] (**both carry `initExpr?: ExprNode`, the STRUCTURED initializer — D-5 (S293) depends on it: `emit-server.ts`'s `emitReferencedModuleConstLines` SKIPS any candidate with no `initExpr`, and walks the ones that have it via `forEachIdentInExprNode` to prove every free identifier resolves at server module scope. A `const X = compute()` whose `compute` is not in the server bundle is skipped rather than emitted — a module-load ReferenceError is strictly worse than the call-time one, and the honest answer for that shape is a diagnostic, not a guess**), TildeDeclNode [480] (`~` linear-adjacent decl), LinDeclNode [492] (§35 linear types), ReactiveDeclNode [503] (the `@cell` declaration — carries `matchExpr` side-field for engine-adjacent typing), ImportDeclNode [1247] / ImportSpecifier [1235], UseDeclNode [1265] (`use foreign:` sidecar), ExportDeclNode [1279], TypeDeclNode [1298].

**State machine** — EngineDeclNode [910] (`kind:"engine-decl"`; **plus the optional `ifRaw`/`ifCond` §17.1.2 render gate, present only when the opener carried `if=` — see above**; engineName, governedType `for=`, rulesRaw + bodyChildren walkable body, sourceVar, varName/varNameOverride, initialVariant, plus acceptsType/subsetVariants/inlineMatchArmArrows annotations added across S154-S172).

**Control flow (statement)** — IfStmtNode [995], ForStmtNode [1044], WhileStmtNode [1062], ReturnStmtNode [1071] (carries `fnExprNode` — see the GITI-038 callout below), ThrowStmtNode [1085], SwitchStmtNode [1092], TryStmtNode [1101], MatchStmtNode [1120], MatchArmInlineNode [1138], BareExprNode [1156].

**Control flow (expression)** — IfExprNode [1006], ForExprNode [1017], MatchExprNode (statement-form) [1028] and the expression-layer MatchExpr [1904], TernaryExpr [1781], GuardedExprNode [1222] (`given`).

**Error/failure primitives** — FailExprNode [1196], PropagateExprNode [1210] (`?` propagation), ErrorArm [165], ErrorEffectNode [350].

**Reactive mutation** — ReactiveNestedAssignNode [757], ReactiveAssignNode [789], ReactiveArrayMutationNode [803], ReactiveExplicitSetNode [814].

**Functions / components** — FunctionDeclNode [823], ComponentDefNode [888], LambdaExpr [1858] / LambdaParam [1869].

**SQL / CSS / state bodies** — SQLNode [311], SQLChainedCall [182], SqlRefExpr [1977], CSSInlineNode [330], StyleNode [339], CSSDeclaration [133], CSSRule = CSSPropertyRule | CSSSelectorRule [144/146/154], CSSReactiveRef [125], StateNode [265], StateConstructorDefNode [279], LogicNode [294].

**Destructuring** — DestructureArrayPattern [426], DestructureObjectPattern [434], DestructureArrayElement [402], DestructureObjectProperty [408].

**Validators / lift / meta** — ValidatorEntry [679], RelationalPredicateNode [646], RenderSpecNode [730], LiftExprNode [1186], LiftTarget [195], MetaNode [359].

**Misc runtime-adjacent** — TransactionBlockNode [1352], CleanupRegistrationNode [1361], WhenEffectNode [1373], WhenMessageNode [1387], UploadCallNode [1398], AuthConfig [1503] (see the "duplicate AuthConfig shapes" note in auth.map.md), MiddlewareConfig [1515].

**Expression-layer types (ExprNode union, [types/ast.ts:2154])** — ⛑ **EVERY ANCHOR IN THIS PARAGRAPH RE-DERIVED BY SYMBOL GREP AT `68cfac6d`, NOT SHIFTED BY A LINE DELTA — the `compiler/src/types/ast.ts` surface was NON-EMPTY this window and the map's own rule requires it. The carried values were stale by ~25-72 lines across the board (`LitExpr` was cited `[1660]`, it is `[1707]`).** IdentExpr [1685], **LitExpr [1707]**, ArrayExpr [1755], ObjectExpr [1762] / ObjectProp [1768, a `type` union not an `interface`], SpreadExpr [1774], UnaryExpr [1791], BinaryExpr [1819], AssignExpr [1841], TernaryExpr [1853], MemberExpr [1871], IndexExpr [1882], CallExpr [1892], NewExpr [1902], LambdaExpr [1930], CastExpr [1958], MatchExpr [1976], MapEntry [2001] / MapLitExpr [2028] (§59 value-native map/set), SqlRefExpr [2049], InputStateRefExpr [2063] (§36 `<#id>` reads), EscapeHatchExpr [2077] (`_{}` foreign block), ResetExpr [2118], MarkupValueExpr [2142].

## §53.4 / §7.5.1 — `LitExpr` and the `hasInterpolation` field (NEW #877, at `68cfac6d`)

### LitExpr  [types/ast.ts:1707]  — re-derived by symbol grep at this watermark
```
kind: "lit"
span: ExprSpan
raw: string                                   // raw source text, delimiters INCLUDED
value: string | number | boolean | null       // number -> parsed float; string -> UNESCAPED content;
                                              // bool -> true/false; not -> null
litType: "number" | "string" | "template" | "bool" | "null"(dep) | "undefined"(dep) | "not"
hasInterpolation?: boolean                    // NEW #877 — `litType: "template"` ONLY
```

⛔ **`hasInterpolation` IS CARRIED, NEVER INFERRED, AND THE FIELD EXISTS BECAUSE THE INFERENCE WAS
UNSOUND — NOT BECAUSE IT WAS SLOW.** The retired test was ``raw === "`" + value + "`"``, and its own
doc comment described it as *"an exact test, not a heuristic"*. **It is not exact.** It is ALSO
satisfied by ``raw === "``"`` with `value === ""` — precisely the pair a multi-quasi template degrades
to when its source text could not be recovered (the `astring` last-resort fallback in the same parser
arm sets exactly that, and so does any upstream stage that truncated the initializer). **A genuinely
EMPTY single-quasi template and a DEGRADED interpolated one are indistinguishable in `(raw, value)`.**

⚑ **THE FIELD IS OPTIONAL AND THE FALLBACK IS SPECIFIED, WHICH MATTERS FOR HAND-SYNTHESIZED NODES.**
`undefined` means the node did not come from either parser (unit tests, older synthesis paths).
Consumers **SHALL** fall back to SCANNING `raw` for an unescaped `${` — `rawTemplateHasInterpolation`
(`expression-parser.ts:4528`, exported) — and **never** to the `(raw, value)` reconstruction this
field exists to retire. A `\${` is an ESCAPED dollar-brace and is literal text, not an interpolation.

**Stamped at three sites on the LIVE pipeline** (`compiler/src/expression-parser.ts`, all inside
`esTreeToExprNode`): the `Literal` arm (`:2321`, via `rawTemplateHasInterpolation(raw)`), the
`TemplateLiteral` single-quasi branch (`:2363` — `hasInterpolation: false`, `value: cooked`), and the
multi-quasi branch (`:2396-2406` — `hasInterpolation: true`, `value: ""`). **And at one site on the
NATIVE pipeline**: `translateTemplateLit` (`compiler/native-parser/translate-expr.js:485+`), stamping
from `exprs.length`, the native counterpart of `quasis.length`.

⛔ **THE NATIVE SIDE ALSO STOPPED PUTTING `raw` IN `value`, AND THAT IS A SOUNDNESS FIX, NOT A
TIDY-UP.** It used to construct `makeLit(raw, raw, "template", span)`, so a native template's `value`
carried its own delimiters — `` `abc` `` (5 chars) for a literal whose value is `abc` (3). That was
survivable only by ACCIDENT: the old reconstruction can never match when `value` already has
back-ticks, so every native template fell through to `literal-type-only` and §53.4 kept its runtime
guard. **The moment the answer became carried, that accidental fall-through disappeared** and the
corrupt value would have been routed straight into the STATIC zone — a false `E-CONTRACT-001` on valid
code one way, a silently elided boundary guard the other. The two pipelines are now at FIELD-LEVEL
parity here, which the within-node canary checks (a field the live side emits and the native side does
not is a MISSING-FIELD divergence). ⚠ `sourceNeedsLiveFallback` (`component-expander.ts:1087`) routes
only INTERPOLATED templates to the live parser, so **STATIC templates reach the native function by
design** — this is not an exotic path.

### The classifier output vocabulary — `literal` vs `literal-type-only`

`classifyLiteralFromExprNode` (exported, `expression-parser.ts`) returns one of FOUR shapes, and the
first two are the load-bearing distinction:

| shape | meaning | who needs it |
|---|---|---|
| `{ kind: "literal", value }` | the VALUE is statically known | §53.4's `checkPredicateLiteral` — evaluates the predicate at compile time and may ELIDE the runtime guard |
| `{ kind: "literal-type-only", type }` | syntactically a literal of a known primitive TYPE whose value is NOT known | §7.5.1's `E-TYPE-031` — needs only the type |
| `{ kind: "arithmetic" }` | binary arithmetic detected | inference |
| `{ kind: "unconstrained" }` | nothing determinable | inference |

⛔ **AN INTERPOLATED TEMPLATE IS `literal-type-only { type: "string" }` — ALWAYS.** Collapsing the two
shapes would make it statically checkable against a predicate it has not been shown to satisfy, and
§7.5.1 states that prohibition normatively: *a widening of the literal set SHALL NOT convert a §53.4
BOUNDARY assignment into a STATIC one for a literal whose VALUE is not statically determined.*

⚑ **THERE ARE TWO READERS AND THEY MUST AGREE ON THE LITERAL SET.** The structured one above consumes
`isStaticTemplateLit` (`expression-parser.ts:4566`). The FALLBACK, used only where a declaration
carries no parsed `initExpr`, is `extractInitLiteral` (`type-system.ts:3626`) — whose quoted-string AND
back-tick branches were BOTH replaced by one scanner at #877: `scanSingleStringLiteral` (`:3518`) with
`cookOneEscape` (`:3446`) and `skipNestedLiteral` (`:3583`). ⛑ **The scanner runs BEFORE the arithmetic
test on purpose** — that test is a bare `/[+*\/]/` over the whole string and cannot see quoting, so it
would misclassify the legitimate static literals `` `a + b` `` and `"a + b"`. The ordering is safe only
because the scanner REJECTS a compound expression (`"ab" + "cd"`) rather than mistaking it for a single
literal, which is exactly what the two `startsWith`/`endsWith` branches it replaces used to do.

⚠ **BEFORE YOU REPRODUCE ANYTHING ON THIS SURFACE: at file top level the interpolation is destroyed by
`block-splitter.js` `splitBlocks` BEFORE the expression parser runs** (back-tick tracking exists only
under `frame.type === "meta"`). See `primary.map.md` Task-Shape Routing row 3 — OPEN/HIGH.

## GITI-038 — `ReturnStmtNode.fnExprNode` (a returned function expression)
`return function name(){…}` / `return async function name(){…}` is parsed STRUCTURALLY, not stripped-and-hoisted. `ReturnStmtNode` [types/ast.ts:1071] carries an optional `fnExprNode?: FunctionDeclNode` field [types/ast.ts:1081] holding the returned closure as a full `function-decl` node — the SAME shape a top-level `FunctionDeclNode` uses. `RETURN_DECL_KW` (ast-builder.js) covers only `const`/`let`/`type`/`fn` — `function`/`async function` route through a recursive `parseOneStatement()` call.

**Contract: every AST pass that walks a `return-stmt` MUST also descend into `fnExprNode`** if it exists, treating it exactly like a nested `function-decl` statement — a `return-stmt`'s own `exprNode`/`expr` fields are EMPTY when `fnExprNode` is set. ~10 analysis passes route through it (route-inference.ts, type-system.ts, codegen/usage-analyzer.ts, component-expander.ts, meta-eval.ts, codegen/collect.ts, codegen/emit-logic.ts) — see dependencies.map.md for the Q1/Q2 async-classification split this feeds. **route-inference.ts's dead-function reachability walk is a sibling concern, not this contract** — S288 (#195/#200) clarified that a first-class function reference (not a call) also counts as reachable, and that reachability descends into nested closure bodies; see error.map.md's `W-DEAD-FUNCTION` note.

## GITI-039 — no new AST shape, a parse-time rejoin fix
No `ReturnStmtNode`/`ExprNode` shape changed. `ast-builder.js`'s `collectExpr`/`joinWithNewlines` (the token-collector for `${}` logic bodies) carries a `partSpans` parallel array so two adjacent markup-region parts whose spans are byte-adjacent rejoin with NO separator, preserving literal markup TEXT verbatim.

## §14.8.11 DB-authoritative tier — codegen-internal shapes, NOT a FileAST or ast.ts type

`schema-differ.js`'s `parseSchemaBlock(schemaBody)` return shape is the desired-state input BOTH
`diffSchema` (the SQLite/Postgres migration differ) and `commands/db-migrate.js` (via
`codegen/db-authoritative.ts`'s `extractDesiredSchema`) consume. It is a plain-object shape local to
this pipeline stage — like `ThemeContext`/`ProtectContext` below, it has no `ast.ts` entry and no
`kind` discriminant.

```
{ tables: TableDecl[], fns: SecdefFnDecl[] }   // fns is ADDITIVE — [] for a schema with no `fn`
```

### TableDecl  [schema-differ.js, `parseSchemaBlock`/`parseColumns`]
name: string
columns: ColumnDecl[]
dbAuthoritative?: boolean          // the §14.8.11 opt-in marker — bareword `db-authoritative` immediately after the table's closing `}`

### ColumnDecl  [schema-differ.js, `parseColumns`]
name: string
type: string                        // mapped SQLite affinity type
scrmlType: string                   // lowercased source token, preserved for cell-type-aware lowering
primaryKey / notNull / unique: boolean
immutable: boolean                  // §14.8.11.2 S3. A bareword mirroring `not null`/`unique`; the AUTHOR-WRITTEN half of immutability. Consumed ONLY by `generateDbAuthoritativeDDL`. Inert on a non-`db-authoritative` table (no bounded-role grant to narrow). **S288: no longer the WHOLE story — a `db-authoritative` table's PRIMARY KEY column(s) and `tenant_id` are ALSO effectively immutable whether or not this bareword is written, and there is deliberately no per-column opt-out. See `isEffectivelyImmutable` below.**
default: string | null              // §14.8.11.2 S288 — the RAW captured value, now via a BALANCED paren scan (see "Literal-lowering functions" below); lowered at emit time by `lowerDefaultToSql`, not stored pre-lowered
references: {table, column} | null
renameFrom: string | null
sharedCorePredicates: SharedCorePredicate[]   // §39.5.7 — req/length/pattern/min/max/gt/lt/gte/lte/eq/neq/oneOf/notIn. §39.5.8 S288: `oneOf`/`notIn` items are now lowered to SQL literals at emit time (see below), and a non-literal item is a COMPILE ERROR (`E-SCHEMA-010`), not a silent pass-through.

### SecdefFnDecl  [schema-differ.js, `parseFnDecl`]  — §14.8.11.2 S4
The parsed shape of a co-located `<schema>` `fn NAME(args) security definer owner(<role>) [returns
<type>] [requires cap("x")] { """ <plpgsql statements> """ }` declaration (M1-PROVISIONAL surface;
a later owner-ruled syntax pass finalizes it). Every identifier below is captured with a STRICT
`[A-Za-z_]\w*` pattern (parse-time defense complementing emit-time `quoteIdent`).
name: string
args: Array<{name: string, type: string}>
owner: string                       // MANDATORY — the bounded NOLOGIN role the SECDEF runs AS (distinct from `scrml_app`)
returns: string                     // defaults to "void"
cap: string | null                  // the `requires cap("x")` gate value, or null (no gate)
isSecurityDefiner: boolean          // advisory this pass — every P2 `fn` emits SECURITY DEFINER regardless
body: string                        // the raw plpgsql STATEMENTS only (no outer BEGIN/END — the emitter owns that envelope so the injected cap check is un-bypassable and always first)

## §14.8.11.2 S288 — auto-immutable PK/`tenant_id` + the literal-lowering functions (schema-differ.js)

**`isEffectivelyImmutable(col)`** — is a `db-authoritative` table's column immutable to the bounded
`scrml_app` role? True if the author WROTE `immutable`, **or** it is the table's PRIMARY KEY, **or**
its name is `tenant_id` (case-insensitive) — whether or not the bareword is present. **RULED S288
(bryan):** the same §14.8.10 reasoning that rejected a per-table tenant opt-in applies here — a
forgettable declaration guarding a security invariant is the wrong shape. Before this, a
WITHIN-tenant PRIMARY KEY UPDATE succeeded (only a CROSS-tenant re-point was RLS-blocked) — silently
re-pointing a row's identity under its own tenant is exactly the class the tier's audit-defensibility
claim rests on. **Consequence, stated normatively in SPEC §14.8.11.2: the prior guarantee "a
`db-authoritative` table with ZERO `immutable` columns emits BYTE-IDENTICAL to M1" is RETIRED** — such
a table always carries a PK, so it always takes the column-scoped GRANT path now. No per-column
opt-out; an author needing a mutable PK declines the `db-authoritative` marker for that table.
Consumed ONLY by `generateDbAuthoritativeDDL`'s `immutableCols`/`mutableCols` filters —
non-`db-authoritative` tables are entirely unaffected.

**Literal-lowering functions (§39.5.8 + `default()`), deliberately OPPOSITE dispositions for the
same residue:**
- `lowerArrayLiteralToSqlItems(arg)` / `lowerArrayItemToSqlLiteral(item)` / `splitTopLevelItems(inner)`
  — lower a `oneOf([…])`/`notIn([…])` item list from scrml literal form (either string-quote form,
  bare-variant `.Admin` per §41.15.6, numeric, boolean) to its SQL literal form (`'…'`-quoted
  strings, `.Admin` → `'Admin'`). ALL-OR-NOTHING: any unrecognized item (a bareword) returns the
  WHOLE list verbatim — belt-and-braces, since a compile-time caller now rejects a bareword before
  reaching here (see `findNonLiteralSetItems` next / `E-SCHEMA-010` in error.map.md).
- `lowerDefaultToSql(rawDefault)` — lowers `default(…)`'s value. A scrml STRING literal (either
  quote form) lowers to a SQL string literal — fixes `default("US")` emitting the SQL IDENTIFIER
  `DEFAULT ("US")`. A NON-literal (`default(now())`, `default(CURRENT_TIMESTAMP)`,
  `default(gen_random_uuid())`) passes through VERBATIM — here that is CORRECT, not a fallback,
  because a `default()` argument is legitimately a SQL EXPRESSION. This is the deliberate divergence
  from the `oneOf`/`notIn` position, where a non-literal is meaningless and now hard-errors.
- **`export function findNonLiteralSetItems(col)`** — the `E-SCHEMA-010` fire-site helper (see
  error.map.md), consumed from `gauntlet-phase1-checks.js`'s `checkSchemaDeclarations`.
- `findMatchingParen`/`scanMatchingParen` — now a TWO-PASS wrapper: quote-aware first (a `)` inside a
  string ARGUMENT no longer closes the predicate early — the pre-S288 silent-CHECK-drop defect,
  `oneOf(["x); DROP TABLE u; --"])` used to emit a column with NO CHECK AT ALL), falling back to a
  quote-BLIND scan when the quote-aware pass fails to close (load-bearing: a `pattern(/o'brien/)`
  regex literal can carry an unpaired apostrophe, which a quote-aware-ONLY pass would swallow).
  `parseColumns`'s `default(...)` capture is now this SAME balanced scan, not the old `[^)]+` regex
  (which stopped at the FIRST `)`, truncating `default(now())` into an unbalanced
  `DEFAULT (now() )` — a syntax error blocking 7/10 of a real adopter schema (adopter report, S4)).

**Residual, still-open edges surfaced by the S288 adversarial pass** (`g-schema-predicate-arg-
parse-edges`, MED, `docs/known-gaps.md`): `oneOf([])` on an empty array emits invalid SQL
(`CHECK (col IN ())`) rather than a compile rejection or `CHECK (false)`; `escapeSqlString` doubles
`'` but does not escape `\` — a latent MySQL-only trap (unreachable today — `db-migrate` hard-refuses
MySQL, "Phase 3").

## §38.6.2 / §39.5.5 — constraint-drift + foreign-key shapes (NEW this window, S290)

**`columnConstraintDrift(desiredCol, actualCol)`** — exported from `schema-differ.js` (:713).
Returns `{ notNull: boolean, unique: boolean, references: boolean, default: boolean }`: which of a
column's declared constraints differ from what the LIVE database reports for an EXISTING column.
§38.6.2's governing sentences always required this; the implementation only handled ADD / DROP /
RENAME COLUMN, so three of eight specified operations were never built and **every constraint change
on an existing column was silently ignored** (`g-db-migrate-ignores-constraint-drift-on-existing-
columns`). This is a conformance RESTORATION, not an amendment.

Two shape details are load-bearing:
- **PK-aware.** A PRIMARY KEY column is implicitly NOT NULL and implicitly UNIQUE, so both flags are
  forced false when either side is a PK — do not fight the driver over an implied constraint.
- **`default` is compared TOLERANTLY** via the private `sameDefaultText(a, b)` (:731): it drops a
  Postgres `::type` cast suffix, unwraps ONE quote layer (`'x'` or `"x"`), trims and case-folds.
  Drivers echo defaults back with their own quoting/casts, so a raw string compare would report
  permanent phantom drift — and a gate that cries wolf gets bypassed, then deleted.

Consumers: `diffSchema` emits `W-SCHEMA-CONSTRAINT-TIGHTENED` (Postgres — the DDL IS emitted, and
will correctly fail on non-conforming rows) or `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` (SQLite — the
§38.6.3 rebuild is destructive and refused by default, so NOTHING is applied and the plan is
reported as WITHHELD). See error.map.md + migrations.map.md.

**`referencesHint(raw)`** — exported from `schema-differ.js` (:1756). Builds the "you wrote X, the
only form is Y" half of the `E-SCHEMA-011` message from the author's raw text.

**`ColumnDecl.references` is now two-valued at parse time.** `parseColumns` records a `references`
clause that does NOT match the single §39.5.5 production (`references <table>(<column>)`, table name
OUTSIDE the parens) into a `malformedReferences` collection rather than dropping it. Every other
shape — `references(owners.id)`, `references owners (id)`, `references owners.id` — used to compile
and migrate clean with NO `REFERENCES` clause and NO diagnostic. `gauntlet-phase1-checks.js` turns
that collection into `E-SCHEMA-011`. Supporting helper: `blankLiteralBodies(s)` (:232) blanks string
literals and strips `//` comments first, so `default('see references')` or a comment mentioning the
word cannot false-fire the detector.


### ActualTable / ActualColumn  [schema-differ.js, `readActualSchema`/`readActualSchemaPg`]
The LIVE-database-read counterpart `diffSchema` compares `TableDecl`/`ColumnDecl` against. Same
shape family, `sharedCorePredicates` always `[]` (not recoverable from `PRAGMA table_info()` /
`information_schema.columns` in v1 — CHECK-constraint text isn't exposed).

**`g-db-migrate-check-constraint-oneof-pattern` — RESOLVED S288** (`docs/known-gaps.md`). The
originally-reported three sub-bugs, verdicted against real Postgres 16 through the real CLI: (1) the
unquoted-bareword CHECK — FIXED (the literal-lowering functions above); (2) the false
`E-DBAUTH-NO-TENANT-COLUMN` pre-flight fire on a `tenant_id`-carrying table — tried 9 shapes, NOT
REPRODUCED (open a fresh gap with the exact table if it recurs — the main compiler's own parse was
always fine, only the differ's line-based scan was suspect); (3) a `pattern(/…{n}…/)` quantifier
brace fooling the marker/brace matcher — was ALREADY fixed by the P2 brace-depth `parseSchemaBlock`
rewrite, now regression-locked. If you touch `parseColumns`/`parseSharedCorePredicates`, the
regression tests in `compiler/tests/unit/schema-differ.test.js` (this window's +124 lines) are the
reproducer set to run first.

## §65 CSS-native model — NOT a dedicated FileAST shape
`<theme>` / `<defaults>` are recognized as ordinary MarkupNode instances via the structural-element registry (`compiler/src/attribute-registry.js:485` onchange, `:503` theme, `:516` defaults) — same pattern as `<endpoint>` (§61) and `<onchange>` (§38.13). No `ThemeDeclNode`/`EndpointDeclNode`/`OnchangeNode` type exists in ast.ts. Codegen-internal (non-FileAST) types for these features:
- `ThemeContext` — exported from `codegen/emit-theme-reset.ts:56`: `{ themeDecls: ThemeDecl[]; programNode; cellNames: Set<string> }`.
- `CSSVariableBridge` — `codegen/collect.ts`: the §25 reactive-CSS-var bridge descriptor.
- `ProtectContext`/`ProtectedColumns` (protect-egress.ts, §14.8.9), css-conflict-check.ts's internal `CssConflictFinding`, `RowChange` synthesis (channel-watches.ts, §38.13), `EndpointArmBinding`/`IfDisplayGuard` (codegen-internal, §61).
- `<program reset="none">`. `attribute-registry.js`'s `"program"` element carries a `reset` attrSpec — the §65.3.4 built-in-reset opt-out.

## `<outlet>` (§20.8) — also NOT a dedicated FileAST shape
Same structural-element-registry pattern as `<theme>`/`<defaults>`/`<onchange>` — no `OutletNode` type in ast.ts. Recognized/validated by symbol-table.ts PASS 15.5.

## Codegen-internal binding shapes (binding-registry.ts) — NOT ast.ts types

`LogicBinding` (`codegen/binding-registry.ts`, a pure data registry with no imports) is the
emit-time record every event/logic binding is registered as. Fields that decide EMISSION SHAPE, not
just wiring:

- `isReactiveValueAttr` / `valueAttrName` / `valueAttrIsFormValue` / `valueAttrKey` — the #81
  writer-ownership set, computed by `emit-html.ts`'s `analyzeWriterConflict`.
- **`directiveIsFormValue?: boolean` (NEW this window, i225)** — set ONLY when an `attr-template`
  binding is a `value="${…}"` on a form control (`<input>`/`<textarea>`/`<select>`) with NO sibling
  `bind:value`/`bind:valueAsNumber`. When set, `emit-variant-guard.ts` writes the caret-safe `.value`
  PROPERTY (`{ const _v = expr; if (el.value !== _v) el.value = _v; }`) instead of
  `setAttribute("value", …)`. **It must be computed at REGISTRATION in `emit-html.ts`**, where the
  element `tag` and the sibling `attrs` array are in scope — the arm wire fn only ever sees the
  pre-lowered binding, never the markup node. This mirrors the file-scope `isFormControlValue`
  decision in `emit-bindings.ts` (i174); the `!hasBindValue` half is deliberate, because a sibling
  `bind:value` is the sanctioned two-way owner and a second `.value` writer would compete with it.

`EachReconcileCtx` (`codegen/emit-each.ts`, module-level `_eachReconcileCtxStack`) — the LIVE stack
of enclosing `<each>`/for-lift contexts at emit time, carrying `{iterVar, destructure?, …}`. S293/S294
read it to build the per-item re-resolution preludes; the stack (not the AST) is what makes shadowing
decidable, since a name bound by a NEARER ctx must suppress re-resolving a same-named enclosing var.

## §20.5 session-establishment — new attributes/config fields, NOT a new FileAST node type
No `SessionDeclNode` exists — `session` is a reserved server-scope BUILTIN identifier. See auth.map.md for the three separate non-FileAST "auth config" shapes. **S288: `tenant-egress.ts`'s `buildTenantContext` now takes a second, optional arg (the `<schema>`-declared tables, from `extractDesiredSchema(fileAST).tables`) and unions them into `TenantContext.tenantScopedTables`** — previously it read ONLY the `<db>`-derived `ProtectContext.schemaByTable` registry, which left a `<schema>`-only app (no `<db>` block) with an EMPTY tenant set even though §14.8.10 says a `<schema>` table's `tenant_id` column presence IS the tenant declaration. See domain.map.md's §14.8.11 section for the full defect narrative (`g-dbauth-session-principal-not-wired`, RESOLVED S288).

## §14.8.8 — the ONLY structural-subtyping path in the type system (and it is NOT argument assignability)

⚑ **ZERO OCCURRENCES OF `fieldTypeAssignable` / `fieldTypeEquals` EXISTED IN ANY MAP BEFORE S404**, and
an S404 dispatch went looking for them here. They are recorded now WITH their bound, because the bound
is the whole point.

### fieldTypeAssignable(src: ResolvedType, target: ResolvedType) -> boolean  [type-system.ts:1201]
### fieldTypeEquals(a: ResolvedType, b: ResolvedType) -> boolean  [type-system.ts:1220]

⛔ **ONE CALLER, AND IT IS NOT THE ONE YOU WANT.** `fieldTypeAssignable` is reached only from
`checkSqlRowWidthSubtype` (`:1178`, call at `:1189`), which answers exactly one question: *is a SQL
projection row `S` WIDTH-SUBTYPE-assignable to a developer-declared `:struct` contract `T`?* Its own
docstring says **"NOT a general subtyping relation"** and **"this is the ONLY structural-subtyping path
in the type system"**. The caller must have already confirmed `S` is a SQL projection row
(`isSqlProjectionRowStruct`) and `T` a declared `:struct`. **General struct assignment is NOMINAL
(§14.8.1) and does not route through it.** `checkSqlRowWidthSubtype` itself has two callers
(`:14435`, `:14562`) and is re-exported at `:28887` for tests.

The relation, stated so nobody re-derives it wrong:

| src / target | result |
|---|---|
| `asIs` or `unknown` on EITHER side | **assignable** (degraded column, or a signed-for escape hatch) — no false positive on a gracefully-degraded column |
| target is a `union` | assignable iff src is assignable to ANY member (covers `string \| not` optional contract fields) |
| target is `not` | assignable only from `not` |
| anything else | `fieldTypeEquals` — primitives by **NAME**, structs/enums **nominally**, arrays by element equality, everything else same-`kind`-is-sufficient. **No deep structural subtyping.** |
| EXTRA fields in `S` | **allowed** — that is the width-subtyping half |
| MISSING field in `S` | violation, `reason: "missing"` |

⛔ **"PRIMITIVES BY NAME" IS WHY `int` IS NOT `number` IN THIS COMPILER TODAY**, and it is the mechanism
behind §7.5.1's position-3 block. ⚑ **A REFINEMENT (subtype) READING WAS RULED AT S404 — `int` IS a
refinement of `number` — but the normative text is NOT YET WRITTEN and no code implements it.** Do not
"fix" `fieldTypeEquals` on the strength of the ruling; the ruling lands with the bare-`int` desugar and
the §53.4 zone wiring, gated on an artifact differential.

### §7.5.1 assignability — TWO of five positions are implemented, and position 3 has NO code at all

| # | position | form | status |
|---|---|---|---|
| 1 | annotated variable declaration | `let n: number = "nope"` | **CHECKED** — `E-TYPE-031`, `type-system.ts:10702-10725` (`annotateNodes`) |
| 2 | annotated state-cell declaration | `<n>: number = "nope"` | **CHECKED** (NEW, S402 `069e86fd`) — `type-system.ts:11163-11200`, same function's reactive-decl arm |
| 3 | argument | `fn f(x: number)` called `f("nope")` | **not checked — NO IMPLEMENTATION EXISTS** |
| 4 | return | `fn f() -> number { return "nope" }` | not checked |
| 5 | operand | `let z = "x" * 2` | not checked |

Both checked positions use the SAME rule, message and literal set: annotation ∈ {`number`, `string`,
`boolean`} (⛔ **`int` is deliberately EXCLUDED**), initializer ∈ {`"s"`, `42`, `true`, `` `tpl` ``},
all **8 off-diagonal cells** fire and all 4 diagonal cells stay silent. A back-tick template denotes a
`string` whether or not it interpolates. `not` is §42's absence value and is governed by `E-TYPE-041`.

⛔ **BOTH SITES LIVE IN THE `else` BRANCH OF A `kind !== "predicated"` TEST, WHICH IS AN OPEN HOLE.**
`<n>: number(>0) = "nope"` compiles with **no diagnostic and zero runtime guards** — adding a predicate
makes the annotation check strictly WEAKER. Same at position 1, so it is not a regression; but §7.5.1
as landed claims position 2 is CHECKED "with the same rule and same 8 cells" and carries no predicated
carve-out. Filed MED, **RELAYED-UNVERIFIED**:
`g-position-2-annotation-check-skipped-when-the-annotation-carries-a-predicate`.

⚑ **THE POPULATION FIGURE IS RE-DERIVABLE — `bun scripts/int-number-census.ts` (#875).** Do not quote
a number from SPEC; SPEC's original "37 rejections, all 37 false positives" did not reproduce and was
corrected in place at S404. Re-executed here on the five-root 1920-file set: **69 provable rejections of
120 int-parameter arguments, 93 strict, 43 integral literals, 0 non-numeric, Q4 reverse 0 of 81.**

## Type-system ResolvedType layer (type-system.ts, not ast.ts)
FunctionType [type-system.ts:~470], MapType [:328] (with `.set?: boolean` for §59.12 value-native Set), PredicatedType (with `subsetVariants`), the `<fn-return>` over-approximation sentinel (`FN_RETURN_TYPE_NAME`). NO `AnyType`/`null` member exists — `any` and `null` are not scrml types (§14.1.1 / null-does-not-exist axiom). **`:line` figures in this row shifted ~+10 when #665 inserted the split; the shapes are unchanged.**

### §7.5 / §14.7 — the `asIs` / `unknown` SPLIT (NEW #665, S365, dpa-036 call 1)

**The one-sentence rule, and it is the whole point of the split:** `asIs` means **a developer signed
for it** (§14.7's named escape hatch — silent by design, because a human took responsibility);
`unknown` means **the compiler did not look, or looked and could not tell** — an inference gap that
**nobody signed for**. Before S365 those were ONE value: inference gave up by returning `tAsIs()`,
so a hole in the type checker was spelled exactly like a deliberate opt-out, and *absence of a
diagnostic* and *success* were the same observation.

All three new types are **module-private to `type-system.ts` (no `export`)**, which is why the
"no exported type added" check above still passes.

### AsIsType  [type-system.ts:345]
```
kind: "asIs"
constraint: ResolvedType | null
bareVariantBase?: ResolvedType   // R28-8 / §14.10 sidecar — the field's TRUE base type when a
                                 // trailing validator (`category: Category req`) defeated the
                                 // registry lookup. ADDITIVE: does not change the `asIs` kind
                                 // any other `structType.fields` consumer reads.
isFunctionField?: boolean        // §59.4 / §45.2 — annotation was unambiguously FUNCTION-SHAPED
                                 // but lowered to `asIs`. Routes a map KEY to `E-EQ-003` rather
                                 // than the general `E-MAP-KEY-NOT-COMPARABLE`.
```
Pre-existing for many windows. **Do not confuse the `asIs` KIND with the S365 split** — the split
is what got carved OUT of it.

### UnknownType  [type-system.ts:387]
```
kind: "unknown"
reason: UnknownReason            // REQUIRED. No optional, no default.
```
⚠ **`tUnknown(reason)` [:1307] has NO zero-argument overload and NO default parameter, deliberately.
An `unknown` that cannot say what defeated it has decayed back into an `asIs`.** If you find
yourself wanting `tUnknown()`, the call site does not yet know enough to be honest.

### UnknownReason  [type-system.ts:409] — a discriminated union, three honest sources
```
| { readonly source: "inference-gap"; readonly gap: InferenceGap }
| { readonly source: "forward-ref";   readonly typeName: string }
| { readonly source: "not-a-node" }
```
- `inference-gap` — expression inference RAN and could not type the node. **This is the loud,
  counted case: it is what `W-TYPE-031-UNPROVEN` reports** (error.map.md).
- `forward-ref` — a type NAME registered before its declaration resolves (`buildTypeRegistry`
  pass 1). Transient BY CONSTRUCTION; a later pass overwrites it. **Not a defect, do not gate on it.**
- `not-a-node` — the caller handed the resolver something that is not an AST node. A defensive
  sentinel, **not a judgement about any program**.

### InferenceGap  [type-system.ts:421]
```
readonly nodeKind: ExprNode["kind"]   // NOT `string`, and there is no default
readonly detail:  string              // adopter-facing refinement — names a CONSTRUCT, never an
                                      // internal identifier (`lit` is not one thing, so a boolean
                                      // literal reports `bool literal`)
```
**You cannot construct an `InferenceGap` without naming a REAL `ExprNode` kind. That type — not a
convention — is what keeps the gap honest as the language grows.**

### InferenceResult  [type-system.ts:440] — the return type of `inferExprType` [:569]
```
| { readonly ok: true;  readonly type: ResolvedType }
| { readonly ok: false; readonly gap:  InferenceGap }
```
Constructors: `inferenceOk(type)` [:444], `inferenceGap(nodeKind, detail)` [:448].

⚑ **THE RATIFIED DECAY-STOPPER, and it is why every `inferExprType` caller had to change:**
inference no longer returns a bare `ResolvedType`, because a bare `ResolvedType` gave callers **no
way to distinguish "I typed this" from "I gave up and here is the hatch."** Callers must destructure
`ok`, so the failure branch cannot be reached by accident.

⚑ **THE COMPANION PROPERTY IS A COMPILE-TIME ONE, AND IT ONLY WORKS BECAUSE `scripts/types-gate.ts`
LANDED IN THE SAME PR.** `inferExprType` ends in a `never` fallthrough, which makes "a new `ExprNode`
member that nobody taught inference about" a **TYPE ERROR** rather than a silent `asIs`. bun runs
`.ts` transpile-only, so before #665 that guarantee was decorative: nine sibling exhaustive switches
in `expression-parser.ts` were ALREADY failing on `MarkupValueExpr` and nothing had ever noticed.
**Building a tenth `never` fallthrough without arming a checker would have reproduced the defect
rather than closed it.** build.map.md · test.map.md.

**Assignability is UNCHANGED and still permissive on both members** [`:1183-1186`]: `asIs` OR
`unknown` on EITHER side is assignable (graceful-degrade column, or an inference gap). The split
changed what the compiler can SAY, not what it accepts.

## Tags
#scrml #map #schema #ast #types #asis-unknown-split #inference-result #inference-gap #unknown-reason #w-type-031-unproven #types-gate #never-fallthrough #engine-decl #reactive-decl #css65 #theme #expr-node #file-ast #outlet #reset #link-boost #theme-context #css-var-bridge #giti-038 #giti-039 #return-stmt #fn-expr-node #session-establishment #colorless-async #dbauth #table-decl #column-decl #secdef-fn-decl #schema-differ #immutable-column #auto-immutable #is-effectively-immutable #e-schema-010 #lowering-functions #sql-literal-lowering #tenant-context-union #resolved-gaps #e-schema-011 #column-constraint-drift #references-hint #same-default-text #d5 #init-expr #logic-binding #directive-is-form-value #i225 #each-reconcile-ctx #if-cond #if-raw #structural-if #§17.1.2 #absent-not-null #parity-canary #field-set-comparison #untyped-structural-nodes #each-block #match-block #attr-value-identity #object-shorthand-region #brace-group-kind #codegen-internal-shape #not-an-ast-node #segment-relative-offsets #unknown-is-a-contract #zero-exported-type-added #types-dir-flat-11-windows #unknown-has-no-reason-on-main #asis-kind-is-not-the-split #asis-split-NOT-on-main #inference-result-NOT-on-main #types-zero-diff-13 #no-new-exported-type #exported-functions-not-types #synth-cell-keys-are-strings #not-type-enforced #no-named-interface-for-bsresults #structural-shape-consumption #types-zero-diff-fourteenth #s437b #9941a504c #handler-block #core-ir #self-host-v2 #s440 #cf62b415 #analyze-tables #stmt-commit #typing #ingest-ival
#tildecontext-shape #liftvar-vs-var #armbodystmts-readonlyset #no-uniform-binder #es6-shorthand-defeats-field-regex #binding-is-raw-paren-text #parsebindinglist #types-dir-empty-is-not-a-currency-probe
#litexpr-hasinterpolation #carried-not-inferred #raw-value-aliasing #literal-vs-literal-type-only #section-53-4 #section-7-5-1 #fieldtypeassignable #fieldtypeequals #section-14-8-8 #width-subtyping-only #primitives-by-name #int-vs-number #position-3-has-no-code #anchors-re-derived-by-symbol-grep
#s405 #types-ast-zero-diff #extractdesiredschema #rawddl-marker #names-only #two-consumers-opposite-needs #split-at-the-consumer #diffschema-byte-identical #db-migrate-one-line-decline #parseschemablock-dsl-only #harvestrawcreatetabledecls #parserawcreatetablecolumns-no-production-caller #tenanttableset #case-folds-on-three-methods #deferred-migrate-arc
#s437 #d02738767 #defer-stmt #hosttag #import-decl #stageseam #parse-reentry-files #dbtargetclass #sessionattrresolution #connectionattr #types-dir-unchanged #section-66-nominal-no-ast

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [migrations.map.md](./migrations.map.md)
