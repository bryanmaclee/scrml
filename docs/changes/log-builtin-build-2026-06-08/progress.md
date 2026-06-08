# log-builtin-build-2026-06-08 — progress

Append-only, timestamped. Building the location-transparent `log()` builtin (DD2, RATIFIED S173).

## 2026-06-08T06:00Z — Phase 0 SURVEY (start)
- Startup verification PASSED: worktree path correct, branched from 9e306082, clean, bun install + pretest OK.
- Read maps/primary.map.md (Task-Shape Routing: new feature / spec-amendment).
- Read ratified DD in full (F1=B ship, F2=B-with-C-north-star, F3=B [server|client] msg (file:line), F4=A strip, F5=A builtin, F6=B canonical render, levels=log() only v1, shadowing=yield+W-LOG-SHADOWED).

## 2026-06-08T06:05Z — Phase 0 SURVEY findings (vs DD)
- navigate lowering CONFIRMED at emit-expr.ts:1556 (template for log lowering).
- ctx.mode CONFIRMED as compiler-certain side at emit time (server-batch emit uses boundary:"server"; client wrapper uses boundary client). Per-statement side is STRUCTURAL — no new threading needed (Phase 4 = verify only).
- node.span CARRIES file (ExprSpan.file = abs path) + start byte offset. BUT span.line is hardcoded line:1 in parseExprToNode/esTreeToExprNode — NOT a real file line. Real file:line must be derived from span.start byte offset via LineIndex over source. DRIFT vs DD F3 claim "node carries its own source position" — it carries byte offset + file, not line.
- DRIFT (F6): §47.1.4 canonical-string + _scrml_value_canonical are HASH-INPUT machine strings (s5:hello, S{...}), NOT human-readable renders. A new readable value-faithful render helper is needed (honors DD INTENT: value-faithful, cycle-safe, not JSON.stringify, markup-as-value).
- DRIFT (F4/Phase 7): output.mode:"production" compile-time strip toggle DOES NOT EXIST in compiler today (§58 Build Story spec-only per S118; dev/prod done via runtime NODE_ENV checks). compiler options.mode = browser|library, not dev|prod. Will add a minimal `production` compile option following the testMode precedent (api.js -> runCG -> emit ctx).
- EMPIRICAL: bare log() fires E-SCOPE-001 today -> must add "log" to LOGIC_SCOPE_GLOBAL_ALLOWLIST (type-system.ts:4665). When passing, codegen emits plain log(...) call -> correct interception point.
- declaredNames (EmitLogicOpts:117) is the shadowing signal; must thread into EmitExprContext via _makeExprCtx.
- dev.js SSE channel CONFIRMED (sseClients, /_scrml/live-reload at :455); POST /_scrml/log endpoint goes right after SSE endpoint.
- W-TYPE-FN-FIELD (type-system.ts:3320) is the info-level diagnostic template (severity "warning", W- prefix -> result.warnings).
- §34 host table at SPEC.md:16298; E-CG-010 row ~16751.

## NEXT: Phase 1 SPEC amendment.

## 2026-06-08T06:20Z — Phase 1 SPEC amendment (DONE, pending commit)
- Added SPEC §20.6 `log()` Built-in (Location-Transparent Logging) — sibling to §20.1 navigate(). Subsections 20.6.1-20.6.8. Section-home decision: §20.6 (NOT a new top-level section) — cohesive with navigate() the DD-named precedent; low-disruption (no renumber). FLAGGED for PA review.
- Added §34 host-table row W-LOG-SHADOWED (§20.6.7, Info) adjacent to S173 sibling W-TYPE-FN-FIELD.
- Added §20.6 backing cross-ref at the two outstanding promises: §19.6.8 B5 + §51.0.H.
- Regenerated SPEC-INDEX (bun run scripts/regen-spec-index.ts) — 40 rows updated, missing 0.
- Baseline pre-commit gate (from Phase 0 commit): 16249 pass / 89 skip / 0 fail.

## NEXT: Phase 2 builtin recognition + AST lowering (emit-expr.ts) + scope allowlist (type-system.ts).

## 2026-06-08T07:10Z — Phases 2-7 core feature (DONE, pending commit)
- Phase 2: log() recognition + AST lowering in emit-expr.ts (next to navigate at :1556). `log(...)` -> `_scrml_log(side, loc, ...args)`. side from ctx.mode; loc from log-loc.ts. Added "log" to LOGIC_SCOPE_GLOBAL_ALLOWLIST (type-system.ts). NEW codegen/log-loc.ts (file:line resolver via LineIndex over registered source + fileDeclaresLog walker + SERVER_LOG_HELPER).
- file:line FIX: exprNode span loses byte offset (start=0 sentinel); threaded currentStmtSpan (emit-logic) -> ctx.stmtSpan (emit-expr) so the STATEMENT node's real offset resolves the line. VERIFIED probe.scrml:8/:9 correct.
- Phase 3: runtime _scrml_log + _scrml_log_render (readable value-faithful render) in runtime-template.js as a NEW 'log' chunk. Mirrors _scrml_error_boundary_log discipline (guard console, never throw). Client dev-forward POST /_scrml/log + keep browser console.
- Phase 4: per-statement side VERIFIED structural — server-batch emit uses boundary:"server" (emit-server) -> [server]; client wrapper -> [client]. No new threading. Empirically: srv3 audit fn log()s tagged [server]; CPS-split client statements tagged [client] (E3 per-statement promise).
- Phase 6: _scrml_log_render is a READABLE render (NOT _scrml_value_canonical hash-string, NOT JSON.stringify). Handles markup-as-value, structs/enums/maps/arrays, not. DRIFT from DD F6 surfaced (canonical machinery is hash-input, not display).
- Phase 7: prod-strip via `production` option (api.js -> runCG -> module toggle setLogProductionStrip in emit-expr). log() -> (void 0) in prod; 'log' chunk tree-shaken (post-emit scan only adds it when _scrml_log( present). VERIFIED: PROD client 0 _scrml_log, 0 runtime def; DEV 2 calls + 1 def. CLI flag --production / --prod.
- Shadowing: file-level `function log` detection (fileDeclaresLog) -> module flag setLogShadowedInFile -> lowering yields to user fn; W-LOG-SHADOWED fired at the DECLARATION by type-system.ts checkLogShadowing (codegen ctx.errors not reliably wired). VERIFIED: shadow.scrml emits user _scrml_log_3 call + W-LOG-SHADOWED info.
- Server inline: emit-server.ts injects SERVER_LOG_HELPER when _scrml_log( present (client runtime never imported server-side). Removed bare `undefined` keyword (W-CG-UNDEFINED-INTERPOLATION) from both helper copies.
- 'log' chunk added to RUNTIME_CHUNK_ORDER (29 total). Coupled test updates: runtime-tree-shaking.test.js + c10-error-message-resolution.test.js (28->29). Both pass incl. concat-reproduces-SCRML_RUNTIME.

## NEXT: Phase 5 dev.js endpoint + Phase 8 tests.

## 2026-06-08T07:25Z — Phase 5 dev.js client->terminal forwarding (DONE)
- Added POST /_scrml/log endpoint in dev.js buildServeConfig.fetch (after SSE endpoint). Receives {side,loc,msg}, prints `[client] msg (loc)` to dev terminal. 204 response, never 500s. This is F2=B terminal-as-single-view. SSE channel (server->browser C north-star) left for follow-on.

## 2026-06-08T07:55Z — Phase 8 tests (DONE)
- compiler/tests/unit/log-builtin-emit.test.js (18 tests): emit-expr lowering (side-tag, zero/multi-arg), file:line resolution (registered source + stmtSpan fallback + unregistered fallback), prod-strip (void 0), shadowing (declaredNames + file flag + fileDeclaresLog walker), SERVER_LOG_HELPER validity + no-bare-undefined + readable render over primitives/struct/enum/array/not. ALL PASS.
- compiler/tests/integration/log-builtin-integration.test.js (17 tests): client [client]+file:line, server [server]+inline-helper+no-client-leak+no-undefined-warning, prod-strip=0 _scrml_log, W-LOG-SHADOWED (cross-stream + severity info + partition), user-log-wins, value-render-reaches-call. ALL PASS.
- Cross-stream W-/I- helper used for W-LOG-SHADOWED (diagnostic-partition rule).
- 74 function-log fixtures: VERIFIED still compile (payload-variants-001 emits W-LOG-SHADOWED + compiles; engine-modern-002 clean). lin-002-double-use fails on PRE-EXISTING intentional E-LIN-002 (unrelated).

## NEXT: full-suite baseline + R26 empirical + commit.

## 2026-06-08T08:05Z — R26 empirical verification + full suite (DONE)
- R26 (MANDATORY): r26.scrml (client refresh + CPS server fn) DEV -> client `_scrml_log("client","r26.scrml:10",...)` + node --check exit 0. r26b.scrml (server-only sandwich) -> server `_scrml_log("server","r26b.scrml:7"/":9",...)` + inline helper + 0 client leak + node --check exit 0. PROD (--production) -> 0 _scrml_log in client/server/runtime + node --check exit 0 both sides. R26 PASS on all dimensions.
- NOTE (E3 per-statement truth): a log() in a CPS server fn that does NOT touch server-only resources is correctly tagged [client] (it runs in the client wrapper). The [server] tag requires the log() to be in a server batch (server-only-resource adjacency). This is the DD's celebrated per-statement accuracy, not a bug.
- Full suite (bun run test): 23478 pass / 220 skip / 1 todo / 0 fail across 943 files (+35 new). ZERO new failures.

## BUILD COMPLETE. All 8 phases landed across 5 commits.
