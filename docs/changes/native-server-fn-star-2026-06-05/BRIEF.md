NATIVE-PARSER PARITY FIX — server-fn-star (`server function*` + yield) — 2 sequential roots (change-id: native-server-fn-star-2026-06-05)

# Context
scrml native-parser-swap grind (front-ends: legacy default BS+Acorn+TAB vs scrml-native `compiler/native-parser/`, `--parser=scrml-native`). Landed this session: F2-match `2c2e5bb2` + promote-each `785f24d1` + R1 typed-`@cell` `89912bb9` (flip 509→463). This dispatch closes the **server-fn-star family** (`server function*` SSE generators with `yield ?{}` SQL) — `compiler/tests/unit/server-fn-star-sql-r25-bug-42.test.js`, **10/12 flip-failures** (it's a SILENT miscompile: BOTH default + native exit 0; the divergence is in emitted server.js — `serverLen` drops). A PA read-only survey-STOP already ran + returned **PROCEED both roots** with precise loci + a mirror template; the loci below are survey-VERIFIED on HEAD `89912bb9`. Phase-0 re-confirms (S164: loci are hypotheses; the emit-DIFF is the reliable signal — exit code is uninformative here, both exit 0).

# TWO SEQUENTIAL ROOTS (land ROOT-1 first as a checkpoint, then ROOT-2)

## ROOT-1 — restore the top-level `function*` lift (clean S, parser-only)
`compiler/native-parser/parse-markup.js:2160` `BARE_DECL_RE` is a STALE verbatim copy of the PRE-Bug-42 ast-builder regex — it requires literal `function\s` / `fn\s`, so `function*` / `fn*` NEVER lift → native drops the whole top-level `server function*` (serverLen=0). The lockstep comment at parse-markup.js:2157-2159 mandates this copy track the live regex; it was VIOLATED.
- **Fix:** sync `parse-markup.js:2160 BARE_DECL_RE` to the LIVE oracle `compiler/src/ast-builder.js:399`: `/^\s*(?:export\s+)?(server\s+(?:fn|function)[*\s]|type\s+\w|fn[*\s]\w?|function[*\s]\w?|let\s+[A-Za-z_]|const\s+[A-Za-z_]|import\s+[{a-zA-Z_*"'])/` (the `[*\s]` form). Read BOTH regexes; copy the live form verbatim. Re-affirm the lockstep comment.
- **Sole gate** — the only top-level lift gate keyed on `function` (call site parse-markup.js:2674). NO sibling gates (TOPLEVEL_STATE_DECL_RE / TILDE_TOKEN_RE don't apply; parse-stmt.js function* token handling L1827/1875 is already correct — it's why the `${}`-wrapped form already lifts).
- **ROOT-1 alone clears the LIFT for all 9 generator tests + t12, but ZERO to FULL parity** (yields still escape-hatched by ROOT-2's gap). This is a CHECKPOINT, not green tests.
- **.scrml mirror (S162 conditional):** check whether `parse-markup.scrml` carries a `BARE_DECL_RE`; if it does (live machinery present), sync it in lockstep; if it's feature-stale/comments-only/absent, `.js`-ONLY (do NOT fabricate machinery into a stale mirror).

## ROOT-2 — translate the yield body (M, mirror makeReturnStmt, NO new codegen)
`compiler/native-parser/translate-expr.js:289-290` `case ExprKind.Yield: return makeEscapeHatch("Yield","",span)` DISCARDS the yield argument → renders as empty `;`. This drops ALL yields (plain `yield 1`→`;` AND `yield ?{}.all()`→`;` — broader than SQL-only). The native Yield node DOES carry its argument (`parse-expr.js:533 makeYield(argument,...)`, `ast-expr.js:468`) — the SQL/expr is parsed + present.
- **Fix:** add a `e.kind === "Yield"` branch in `compiler/native-parser/translate-stmt.js` ExprStmt arm (~L161-228, BEFORE the `makeBareExpr` fallback ~L226 — mirror the existing Lift/Fail/Propagate/GuardedExpr un-wraps there) + a new `makeYieldStmt` helper MIRRORING `makeReturnStmt` (`translate-stmt.js:1675`). makeYieldStmt emits `{ kind:"yield-stmt", expr:"", span }` with: `sqlNode` when `reconstructChainedSql(argument)` (L527) ≠ null / `exprNode: translateExpr(argument)` for general / bare when argument null. The construction oracle is live `ast-builder.js:9843-9886`.
- **Codegen needs NOTHING new:** the live `yield-stmt` kind + consumer already exist — `emit-logic.ts:2320-2348` (sqlNode server/client + bare + exprNode arms) + `emit-functions.ts:79`. t4 (`_scrml_body["cursor"]` server-binding), t5/t6 (`.get()`/.run() lowering), t12 (client-boundary `yield null` guard), t11 (client-leak invariant) all come FREE once the yield-stmt carries the sqlNode.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; Task-Shape Routing for native-parser. Maps reflect HEAD `f11db672` — now 14+ native commits stale. Survey supersedes for these loci; verify against source. Feedback line in the final report.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else (e.g. scrml-support) STOP + report (S90). Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git merge --ff-only main` (S112) — worktree branches origin/main `c02e2860`, BEHIND local main `89912bb9` (3 unpushed landings). Must ff to `89912bb9`. Else STOP.
4. `git status --short` clean.
5. `bun install`. 6. `bun run pretest`. (Use `bun run test` not `bun test` for baseline.)
If ANY fails: STOP, report.

## Path discipline (EVERY edit)
- ALL edits via **Bash** (perl/python/heredoc) on **worktree-absolute paths incl. `.claude/worktrees/agent-<id>/`**, NOT Edit/Write (S126). Echo path; re-verify git diff/grep.
- NEVER `cd` into main (use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths — S126).

# PHASE STRUCTURE (crash-recovery: commit ROOT-1 before starting ROOT-2)
**Phase 0 — confirm:** reproduce the emit-divergence on the real r25-bug-42 fixtures (default vs native, DIFF emitted server.js — confirm serverLen drop + yield→`;`); confirm BARE_DECL_RE is the sole lift gate + the makeReturnStmt mirror is the right ROOT-2 template + the live yield-stmt codegen consumer exists. If the loci don't hold, STOP + report.
**Phase 1 — ROOT-1:** sync BARE_DECL_RE; verify top-level lift restored (native serverLen>0 + `async function* _scrml_gen` present); COMMIT (`WIP(server-fn-star): ROOT-1 lift @ <pwd>`).
**Phase 2 — ROOT-2:** add the Yield ExprStmt branch + makeYieldStmt; verify yield bodies emit; COMMIT.
**Phase 3 — R26 + suites (MANDATORY before DONE):**
  - **R26 emit-shape (S138):** re-compile the fixtures native; grep emitted JS: t1/t3/t5/t6 server.js contains `yield await _scrml_sql\`SELECT * FROM entries\``; t8 server.js contains `yield 1;`/`yield 2;`/`yield 3;`; t12 client.js contains the `yield null; // SQL — client cannot evaluate` guard; t11 client.js has ZERO `_scrml_sql` (security invariant).
  - **Authoritative gate:** flip api.js parser-default in the worktree (line-agnostic perl `s/^(\s*)parser = null,$/$1parser = "scrml-native",/`, line ~631), run `bun --cwd "$WORKTREE_ROOT" test compiler/tests/unit/server-fn-star-sql-r25-bug-42.test.js` → expect 12/12. **Then REVERT the api.js flip** (`git -C "$WORKTREE_ROOT" checkout -- compiler/src/api.js`) — harness only, NOT in the committed diff.
  - **within-node:** `bun --cwd "$WORKTREE_ROOT" test compiler/tests/parser-conformance-within-node.test.js` → 1005/0 (or improve; adding yield-stmt translation makes native more match live). Any UPWARD allowlist bump must be JUSTIFIED (raw==allowlist, correct-shadow, not masking — per the promote-each audit precedent). Report the delta.
  - **full suite:** `bun run test` → 0 regressions (count `(fail)` markers + the post-commit "Tests: N pass, N fail"; promote-match swallows the summary line).
DO NOT mark DONE without R26 + the 12/12 flip gate + full suite passing, and the api.js flip REVERTED.

# COMMIT DISCIPLINE
- Bash edits on worktree-absolute paths; commit per-root IMMEDIATELY. First commit echoes startup `pwd` (S99). Before DONE: git status clean; api.js NOT in diff. NEVER `--no-verify`. Update `docs/changes/native-server-fn-star-2026-06-05/progress.md` per step.

# FINAL REPORT (data for the PA)
- WORKTREE_PATH + FINAL_SHA; FILES_TOUCHED (expect parse-markup.js + translate-stmt.js [+ parse-markup.scrml IF it carries live machinery] + possibly within-node allowlist + progress.md; api.js MUST NOT appear)
- Per-root diff summary (ROOT-1 regex sync; ROOT-2 Yield branch + makeYieldStmt mirror)
- Phase-0 emit-divergence evidence; Phase-3 R26 emit-grep results + 12/12 flip gate + within-node delta (+ any bump justification) + full-suite delta
- Maps feedback line
- Deferred/flagged: anything adjacent NOT done; .scrml mirror disposition (synced vs feature-stale-skip); any documented scope-expansion
- Confirm git status clean + pwd echo + api.js flip reverted
