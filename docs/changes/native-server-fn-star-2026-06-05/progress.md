# native-server-fn-star-2026-06-05 progress

change-id: native-server-fn-star-2026-06-05
worktree pwd at startup: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-aec922c3635ae2a69
base SHA after ff: 89912bb96796a827ee2cb49fb8dcece752fd55a6

## Phase 0 — confirm (DONE)
- Startup verified: pwd in worktree, toplevel==pwd, ff to 89912bb9, clean, bun install + pretest OK.
- emit-divergence reproduced (probe): DEFAULT serverLen=2512 (has `yield await _scrml_sql`); NATIVE serverLen=0 (no lift, no `async function* _scrml_gen`). Silent miscompile confirmed — both exit same error-count; divergence is in emitted server.js.
- ROOT-1 locus confirmed: parse-markup.js:2160 BARE_DECL_RE stale pre-Bug-42 form (`server\s+(?:fn|function)\s`, `fn\s+\w`, `function\s+\w`); live oracle ast-builder.js:399 uses `[*\s]` form. Sole lift gate at parse-markup.js:2674.
- ROOT-2 locus confirmed: translate-expr.js:289-290 Yield escape-hatch discards argument. ExprStmt arm translate-stmt.js:161-228 (makeBareExpr fallback @226). makeReturnStmt mirror template @1675. reconstructChainedSql @527. Live codegen yield-stmt consumer emit-logic.ts:2320-2348 EXISTS (sqlNode server/client + bare + exprNode arms) — no new codegen needed.

## Phase 1 — ROOT-1 (DONE)
- parse-markup.scrml mirror is FEATURE-stale (BARE_DECL_RE only in comments, no live regex machinery; .js shadow runs) → .js-ONLY fix per S162 conditional mirror rule. Did NOT touch .scrml.
- Synced parse-markup.js:2160 BARE_DECL_RE to live oracle ast-builder.js:399 (`[*\s]` generator-admitting form). diff: native==oracle byte-identical.
- Reaffirmed lockstep comment (corrected stale L335→L399, added re-sync note).
- CHECKPOINT verified via probe: native serverLen 0→2323; `async function* _scrml_gen` now present; `yield await _scrml_sql` still false (ROOT-2's gap — expected).

## Phase 2 — ROOT-2 (DONE)
- translate-stmt.js ExprStmt arm: added `e.kind === "Yield"` branch BEFORE makeBareExpr fallback → makeYieldStmt(e, stmt.span, counter).
- New makeYieldStmt helper MIRRORS makeReturnStmt: bare (argument null) → expr:""; chained-SQL → sqlNode via reconstructChainedSql (OMITS exprNode); general → exprNode via translateExpr. NO new codegen — emit-logic.ts:2320-2348 yield-stmt consumer already exists.
- Byte-diff probe: native server.js AND client.js now byte-identical to default; client has ZERO _scrml_sql.

## Phase 3 — R26 + suites (DONE)
- R26 emit-shape (native): t1/t3/t5/t6 server `yield await _scrml_sql\`SELECT * FROM entries\``; t5/t6 .get()→`[0] ?? null`, .run()→bare await; t8 `yield 1/2/3;`; t12 client `yield null; // SQL — client cannot evaluate` guard; t11 client ZERO _scrml_sql + `new EventSource`. ALL PASS.
- 12/12 flip gate: api.js flipped to scrml-native (line 631, perl line-agnostic), `bun test ...server-fn-star-sql-r25-bug-42.test.js` → 12 pass / 0 fail. api.js REVERTED (git status clean, NOT in committed diff).
- within-node: 1005 pass / 0 fail — NO allowlist change needed (yield-stmt translation makes native more match live; gate stays green either way).
- full suite (`bun run test`): 23054 pass / 220 skip / 1 todo / 0 fail across 912 files. Zero regressions.
- NOTE: promote-match.test.js fails UNDER FLIP (CLI promote command family — sibling native-parser flip-failure, NOT server-fn-star); passes 7/7 with default parser → pre-existing out-of-scope flip gap, not a regression.
