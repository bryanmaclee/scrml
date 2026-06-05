NATIVE-PARSER PARITY FIX — promote-each `iterable` field synthesis (change-id: native-promote-each-iterable-field-2026-06-05)

# Context
The scrml compiler has two front-ends: legacy default (BS + Acorn + TAB) and the scrml-native parser (`compiler/native-parser/` + `compiler/src/native-walker/`), selected via `--parser=scrml-native`. We are closing native↔default parity, family by family, toward an eventual default-flip (a v0.8 target; the flip itself is a standing USER decision). A "flip-failure" = a fixture/test clean on default but failing under the parser-default flip.

This dispatch closes the **promote-each family** — the BIGGEST flip-failure cluster (~24 fails in `compiler/tests/unit/promote-each.test.js`). A PA-run read-only per-family survey returned **cleanGrindable: TRUE, single-root, S effort, PARSER-BRIDGE-ONLY (no codegen)**. The loci below are survey-VERIFIED on current HEAD (the F2-match landing `2c2e5bb2`); treat them as a strong hypothesis the Phase-0 step CONFIRMS (S164 lesson: triage loci are hypotheses; the empirical default-clean/native-fail SYMPTOM is the reliable signal).

# THE ROOT (survey-verified — single MISSING-FIELD gap, no codegen)
`bun scrml promote --each` rewrites Tier-0 `${ for (let c of @contacts) { lift <li/> } }` → Tier-1 `<each in=@contacts>…</each>`. Under the parser-flip, `promoteEachOnFile()` → `collectTypedFiles()` captures the **native** typed FileAST. The native for-stmt node has NO `iterable` field (it carries `iterExpr`+forKind for for-of, `cStyleParts` for C-style); the LIVE for-stmt node carries an ADDITIONAL tokenized `iterable` STRING that `promote.js:1229` reads: `parseForHeader(forStmt.iterable, forStmt.variable)`. Native `forStmt.iterable` → `undefined` → `parseForHeader("")` → for-of fails `iterableIsCellRef("")` / C-style fails the `startsWith("(")` detect → every site SKIPPED → `count===0` → status `"no-sites"`/`"ambiguous"`/`"failed"` instead of `"promoted"` → the ~24 `toBe("promoted")` / `toContain("<each …>")` assertions fail.

**There is NO parse crash** — both the `${for…lift}` INPUT and the rewritten `<each>` OUTPUT compile clean under native (verified). The "LessThan/KwFor in expr position" cluster signature does NOT reproduce on direct native compile; it's the promote-tooling consumer reading a missing field.

**Codegen does NOT need this field** (survey-verified: emit-control-flow / emit-logic / reactive-deps read `iterExpr` first; the `iterable ?? "[]"` fallback never fires for the lift-emitting shape; emitted JS byte-identical live vs native). The gap is isolated to the promote tooling-consumer.

# THE FIX
Synthesize the `iterable` STRING field on the two native for-stmt builders so the native for-stmt node matches the live shape `promote.js` reads:
- `compiler/native-parser/translate-stmt.js : makeForStmtCStyle` (~L1368) — `iterable = "( init ; cond ; update )"` (the live form, ast-builder.js ~L5750-5759: `rawParts.join(" ")`).
- `compiler/native-parser/translate-stmt.js : makeForStmtInOf` (~L1401) — `iterable` = the iterable text that follows `of`/`in` (the live form, ast-builder.js ~L5762-5771).

Source-of-truth = live `compiler/src/ast-builder.js` ~L5724-5771 (read it to match the EXACT string shape). Derive the native string either by (a) source-slice from the native node's span (for-of: the `stmt.right` span source text; C-style: the header `( … )` span source text), or (b) re-serialize from the native node's `iterExpr` / `cStyleParts`. **`parseForHeader` whitespace-normalizes** (promote.js:846), so a source-slice like `@tasks.filter(x => x.done)` survives without exact tokenized spacing — pick whichever derivation is robust across all 5 promotable rows.

`.scrml` mirror: `translate-stmt.scrml` is S162 FEATURE-STALE (comments-only). Fix lands in the `.js` ONLY — no lockstep `.scrml` edit (per S162 native-mirror-feature-stale: brief the conditional form — only sync the mirror if it actually carries the live machinery, which it does NOT here).

# FLAG (DO NOT IMPLEMENT — note in progress.md + final report only)
The live `iterable` field is OFF the `ForStmtNode` type contract in `compiler/src/types/ast.ts` (the type declares only `variable`/`body`/`iterExpr`/`cStyleParts`) — it is a runtime-only field the live builder attaches and `promote.js` depends on. The CLEANER long-term fix is to migrate `promote.js` to read the on-contract `iterExpr` (which BOTH parsers carry) so neither parser needs the off-contract `iterable`. That is a SEPARATE hygiene pass (it touches a consumer + risks the live promote-path tests + is orthogonal to the flip). **For THIS dispatch, do the field-synthesis** (the lower-touch parity-charter fix). Just record the alternative.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; follow Task-Shape Routing for "compiler-source bug fix" / native-parser. Map currency: maps reflect HEAD `f11db672` — now **12+ native-parser commits stale** (incl. F2-match `2c2e5bb2`). The survey supersedes the map for THIS fix's loci; verify any native-parser map claim against current source. Feedback line required in final report.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo (e.g. scrml-support), STOP + report (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git merge --ff-only main` (S112). **IMPORTANT:** this worktree branches from origin/main (`c02e2860`), which is BEHIND local main (`2c2e5bb2` = the unpushed F2-match landing). The ff-merge brings F2-match in. It MUST fast-forward cleanly (the worktree has no commits yet) → worktree ends at `2c2e5bb2`. If it does NOT ff, STOP + report.
4. `git status --short` clean.
5. `bun install` (worktrees don't inherit node_modules).
6. `bun run pretest` (populates samples/compilation-tests/dist/; use `bun run test` not `bun test` for baseline).
If ANY check fails: STOP, report, do not proceed.

## Path discipline (EVERY edit)
- Apply ALL edits via **Bash** (`perl`/`python`/heredoc) on **worktree-absolute paths including the `.claude/worktrees/agent-<id>/` segment**, NOT Edit/Write (S126 — Edit/Write have leaked to MAIN). Echo the path before each write; re-verify with `git diff`/`grep`.
- NEVER `cd` into the main repo (or anywhere) — use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths only (S126).
- Read from WORKTREE_ROOT.

# PHASE 0 — SURVEY-STOP CONFIRM (mandatory BEFORE the heavy edit)
Confirm ALL THREE; if any fails, STOP and report (do not force the fix):
1. `makeForStmtCStyle` (~L1368) + `makeForStmtInOf` (~L1401) are the ONLY native for-stmt construction sites (grep shows call sites at translate-stmt.js ~262/267/1502/1506 — all route through the 2 builders; confirm no other site builds a for-stmt node bypassing them).
2. The chosen `iterable` derivation reproduces a string `parseForHeader` ACCEPTS for ALL 5 promotable rows the test exercises: (a) plain for-of `@contacts`; (b) key-clause form; (c) `<empty>`/else form; (d) count-loop / C-style `( let i = 0 ; i < N ; i++ )`; (e) member/call iterable `@tasks.filter(x => x.done)`. Build minimal probes for each + confirm `parseForHeader` returns a non-empty `iterable` + `iterableIsCellRef` passes where the live path passes.
3. After the field exists, `unit/promote-each.test.js` under the parser-flip clears the ~24-fail cluster.

# PHASE 3 — EMPIRICAL VERIFICATION (MANDATORY before DONE)
This family's empirical reproducer IS the promote-each test under the flip. Verify BOTH:
1. **No regression (default/live path):** `bun --cwd "$WORKTREE_ROOT" test compiler/tests/unit/promote-each.test.js` with the DEFAULT parser → still green (the live builder is untouched; this confirms zero regression).
2. **Fix confirmed (native path):** flip the parser default in the worktree's `compiler/src/api.js` (line-agnostic perl: `s/^(\s*)parser = null,$/$1parser = "scrml-native",/` — native is selected when `parser === "scrml-native"`; line ~631), then `bun --cwd "$WORKTREE_ROOT" test compiler/tests/unit/promote-each.test.js` → the ~24-fail cluster CLEARS (all promoted-asserts pass). **Then REVERT the api.js flip** (`git -C "$WORKTREE_ROOT" checkout -- compiler/src/api.js`) — the flip is a verification harness ONLY, it MUST NOT be in your committed diff.
3. **within-node parity:** run `bun --cwd "$WORKTREE_ROOT" test compiler/tests/parser-conformance-within-node.test.js`. Adding `iterable` makes native MORE match live → expect FEWER MISSING-FIELD divergences on for-stmt-bearing fixtures (an IMPROVEMENT). If any fixture now sits BELOW its allowlist budget, you MAY re-baseline it DOWNWARD in the same landing (improvement-direction only; per the harness doctrine). within-node MUST stay 1005/0 (or improve). Report the delta.
4. **Full suite:** `bun run test` (chains pretest) → 0 regressions. Report pass/skip/fail.

DO NOT mark DONE without Phase-3 (1)+(2)+(4) passing and the api.js flip REVERTED out of the diff.

# COMMIT DISCIPLINE
- Edit via Bash on worktree-absolute paths; `git -C "$WORKTREE_ROOT" diff` to verify; `git -C "$WORKTREE_ROOT" add`; commit IMMEDIATELY (don't batch). First commit message includes verbatim startup `pwd`: `WIP(promote-each): start at <pwd>` (S99).
- Before DONE: `git -C "$WORKTREE_ROOT" status --short` clean. Confirm the api.js flip is NOT in your final diff (only translate-stmt.js + maybe the within-node allowlist + progress.md).
- **NEVER `--no-verify`.** Update `docs/changes/native-promote-each-iterable-field-2026-06-05/progress.md` after each step (append-only, timestamped).

# FINAL REPORT (your final message = data for the PA)
- WORKTREE_PATH (pwd) + FINAL_SHA
- FILES_TOUCHED (exact paths — expect translate-stmt.js + possibly within-node allowlist + progress.md; api.js MUST NOT appear)
- The field-synthesis diff summary (how `iterable` is derived in each of makeForStmtCStyle / makeForStmtInOf)
- Phase-0 confirm results (the 3 checks; the 5-promotable-row probe outcomes)
- Phase-3: promote-each test result DEFAULT (green) + NATIVE-flip (cluster cleared, N asserts now pass) + within-node delta + full-suite delta
- Maps feedback line
- Deferred/flagged: the off-contract-`iterable` + consumer-migration-to-iterExpr hygiene alternative (noted, NOT done); any new shape surfaced
- Confirm git status clean + first-commit pwd echo + api.js flip reverted
