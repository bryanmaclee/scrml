# DISPATCH — Build the location-transparent `log()` builtin (DD2, RATIFIED S173)

> Archived verbatim per pa.md S136 (BRIEF.md archival). Dispatched S174 (2026-06-08), agent `adda49e81f476f7e3`, isolation:worktree, run_in_background, model opus. Base HEAD `9e306082`.

Change-id: `log-builtin-build-2026-06-08`. You are building a fully-ratified compiler feature. The design is LOCKED — your job is faithful implementation, not redesign. The authoritative design doc is the ratified deep-dive (read it FIRST, in full):

`/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/log-location-transparency-2026-06-07.md` — read the whole file, especially the "## RATIFIED — S173" section (the locked F1–F6 + levels + shadowing decisions) and the "## Key empirics (grounded)" E1–E12 (the cited loci, with the **S173 correction at E8** noting the corpus counts were inflated — do NOT rely on the 322/61/15 figures).

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~100 lines). Its §"Task-Shape Routing" tells you which additional maps to consult — this is a **compiler-source feature build** (codegen + runtime + SPEC + tests), so follow the routing for compiler-source bug-fix / new-feature + spec-amendment shapes.

Map currency: maps reflect HEAD `642950a2` as of 2026-06-07. Current HEAD is `9e306082` (only a docs/maps wrap commit after the watermark — no source delta). Maps are current for this task. If your work touches files modified after that point, treat map content as a starting hypothesis to verify via grep/Read against current source.

Feedback: in your final report, include either "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing — [which map you expected to help]." Both answers are valuable.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

**S99 leak-history: this dispatch class has had path-discipline leaks before; this would be the next incident if you leak. Treat the discipline below as a hard gate.**

Your worktree path will be assigned by the harness as `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-<id>/`. Call it WORKTREE_ROOT.

## Startup verification (do this BEFORE any other tool call)
1. `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is the S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` — MUST equal WORKTREE_ROOT.
3. `git rev-parse --abbrev-ref HEAD` and `git log --oneline -1` — confirm you branched from `9e306082` (S174 session base). If your base predates that, run `git merge main` (or report).
4. `git status --short` — confirm clean.
5. `bun install` — worktrees do NOT inherit node_modules; the pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise.
6. `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; fresh worktrees have it empty → ~130 happy-dom ECONNREFUSED failures without it). Use `bun run test` (chains pretest) for full-suite baseline checks, NOT bare `bun test`.

If ANY check fails: STOP and report, do not proceed.

## Path discipline (enforce on EVERY edit)
- **Apply ALL file edits via Bash** (`perl`/`python`/heredoc/`cp`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools. This is the S126 interim mitigation: Edit/Write have leaked to MAIN while the agent's git view saw the worktree, two dispatches in a row. Bash writes go where `pwd`/`git` resolve. Echo the target path before each write; `git diff`/`grep` after.
- **NEVER `cd` into the main repo** (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"` for bun, and worktree-absolute paths exclusively. A `cd` into main leaks `bun add`/compile/run into MAIN (S126 incident #14/#15).
- Your FIRST commit message must include the verbatim `pwd` output: `WIP(log-builtin): start at <pwd>`. PA verifies it starts with the worktree path.
- If you ever find yourself about to write to a path starting with the main repo root (no `.claude/worktrees/agent-` segment), STOP and re-derive from WORKTREE_ROOT.

# COMMIT DISCIPLINE (crash recovery — commit early + often)
- After EACH meaningful unit (a phase, a file + its test), `git add` + commit IMMEDIATELY. WIP commits expected: `WIP(log-builtin): <what>`. Don't batch.
- Coupled code + test = ONE commit (no transiently-red window; the pre-commit hook gates each commit).
- Before reporting DONE, `git status` MUST be clean (everything committed). "work in worktree, no commits" is NOT an acceptable terminal report.
- Update `$WORKTREE_ROOT/docs/changes/log-builtin-build-2026-06-08/progress.md` after each phase (append-only, timestamped: what's done, what's next, blockers).
- NEVER use `--no-verify`. If the pre-commit hook fails, diagnose the real cause.

# RULE 4 — SPEC IS NORMATIVE
The DD cites SPEC line numbers from a pre-`642950a2` HEAD; the S173 backlog commit shifted lines below §14.3/§21.2/§34. Do NOT trust the DD's line numbers — re-locate every SPEC section by grep against CURRENT source. Verified current anchors (you re-confirm):
- §19.6.8 B5 "logging surface" promise → ~SPEC.md:12571 (`grep -n "logging surface"`)
- §51.0.H boot-effect "logged loudly to scrml's logging surface" → ~SPEC.md:24907
- §20.1 navigate location-transparent precedent → ~SPEC.md:13666 ("If the calling function is client-side")
- §47.1.4 canonical-string render → §47 (~21642+); FNV render at ~21700
- §34 Error Codes → ~16298–17006 (E-CG-010 row at ~16751); §34.1 native sub-section appended after. The new `W-LOG-SHADOWED` row goes in the §34 host-side table (NOT §34.1 native-parser).

# THE BUILD — 8 phases (the RATIFIED shape; implement faithfully)

**The mechanism in one sentence:** `log(args)` is a compiler-rewritten builtin (like `navigate()`) that lowers at AST-emit time to a runtime helper carrying a **compiler-certain side tag** + **source location**, renders values via canonical-string, strips to 0 bytes in production, and in dev forwards the client side into the terminal.

Verified loci (re-confirm current line numbers yourself):
- **navigate() precedent (the template):** AST lowering at `compiler/src/codegen/emit-expr.ts:1556` (`node.callee.name === "navigate"` → `_scrml_navigate(${args})`); regex rewrite-pass `rewriteNavigateCalls` at `compiler/src/codegen/rewrite.ts:341` (registered as Pass 11 in BOTH the server pass-list ~:2153 and client pass-list ~:2220).
- **Side-signal at emit time:** `ctx.mode === "server"` is checked at `emit-expr.ts:363,379,555` — the emit context KNOWS the side. This is your compiler-certain side. For CPS-split functions, confirm `ctx.mode` is threaded correctly per server/client batch (route-inference `CPSSplit.serverBatches`/`clientStmtIndices`, `route-inference.ts:142,145`) so a `log()` in a client batch tags `[client]` and a server batch tags `[server]`.
- **node.span** gives file:line — this is why the `log()` lowering must be **AST-level** (emit-expr.ts), NOT the regex rewrite-pass (which operates on emitted strings that have lost spans). The regex pass can at most inject side-only; the AST lowering carries span. Recommend AST-lowering as primary; decide whether a regex fallback adds value.
- **Existing origin-tag helper to upgrade/parallel:** `_scrml_error_boundary_log(boundaryId, err)` at `compiler/src/runtime-template.js:2238` — already origin-tags (`"[scrml errorBoundary " + id + "]"`), guards `typeof console === "undefined"`, NEVER throws. Your `_scrml_log` mirrors this discipline.
- **dev SSE channel:** `compiler/src/commands/dev.js` — `sseClients` Set (:314), `broadcastReload()` (:345), endpoint `/_scrml/live-reload` (:455), `HOT_RELOAD_SCRIPT`/EventSource (:356). NOTE: SSE is **server→browser**. The v1 client→terminal leg (F2=B) needs a **browser→server** path — add a dev endpoint (e.g. POST `/_scrml/log`) that the client `_scrml_log` forwards to in dev mode, and dev.js prints `[client] msg (file:line)` to the terminal. The SSE channel is the RIGHT channel for the LATER C-north-star server→browser mirror (out of v1 scope).
- **dual emit:** `serverJs`/`clientJs` on `CgFileOutput` (`codegen/index.ts:226-227`).
- **prod/dev mode axis:** `output.mode: "development" | "production"` (E-CG-011); `test-bind` is the clean-prod-strip precedent (bit-identical binary).

## Phase 0 — SURVEY + CONFIRM-GATE (do this, then STOP and report before building)
Read the DD in full. Run a survey of the 8 loci above against CURRENT source (confirm line numbers, confirm `ctx.mode` threading through CPS emit, confirm `node.span` shape for file:line, confirm how a user-declared `function log` is visible at the lowering site for the shadowing check). Then **report your implementation plan** (file-by-file deltas + the per-phase commit plan + any place the DD under-specifies + your shadowing-detection approach + your client→terminal forwarding approach) and **WAIT for nothing — proceed to build**, BUT lead your final report with what your Phase-0 survey found vs. the DD's claims (any drift = surface it; per Rule 4 the DD is derived, the source is truth). If the survey reveals the DD's design is infeasible as specified, STOP and report instead of improvising a redesign.

## Phase 1 — SPEC amendment (normative; PA reviews at landing)
Author the SPEC text for the `log()` builtin, faithful to the RATIFIED S173 shape. Quote the DD's ratified decisions where possible. Cover:
- The `log()` builtin: signature `log(...args)`, compiler-managed, location-transparent.
- Origin tag format `[server|client] msg (file:line)` (F3=B) — side is compiler-certain from placement; file:line from source span.
- Value rendering via §47.1.4 canonical-string (F6=B) — value-faithful, cycle-safe by S168; markup-as-value renders via canonical machinery.
- Production behavior: strips to 0 bytes in `output.mode: production` (F4=A). Explicitly note a production leveled/structured logging surface is a SEPARATE future feature (do NOT spec it here).
- v1 = `log()` only, no levels (Open-Q4); dev v1 = terminal-as-single-view (F2=B) with both-into-one (C) named as the stated north star.
- Shadowing: a user-declared `function log` WINS; the builtin yields + emits `W-LOG-SHADOWED` (info-level, reserved promote-to-`E-LOG-SHADOWED` end-of-window).
- `§34` `W-LOG-SHADOWED` catalog row (host-side table, not §34.1).
- Cross-reference the two outstanding "logging surface" promises (§19.6.8 B5, §51.0.H) — this builtin BACKS them; and the `navigate()` precedent (§20.1).
- Pick the section home conservatively and FLAG it in your report for PA review (candidate: a new subsection near §20 Navigation API or near Appendix D's blessed-`console`; or a dedicated short section). Regenerate `compiler/SPEC-INDEX.md` via `bun run scripts/regen-spec-index.ts` if you add a section/shift ranges.

## Phase 2 — builtin recognition + AST lowering (emit-expr.ts)
Lower `log(args)` → `_scrml_log("<side>", "<file:line>", <rendered-args>)` where `<side>` derives from `ctx.mode` ("server" if `ctx.mode === "server"` else "client") and `<file:line>` from `node.span`. Mirror the navigate lowering at emit-expr.ts:1556. Honor shadowing: if a `function log` is in scope, emit a normal call (no rewrite) + fire `W-LOG-SHADOWED`. Confirm the lowering fires correctly inside CPS-split batches (per-statement side).

## Phase 3 — runtime helper `_scrml_log` (runtime-template.js)
Add `_scrml_log(side, loc, ...args)` paralleling `_scrml_error_boundary_log` discipline: guard `typeof console === "undefined"`, NEVER throw, render args via canonical-string (Phase 6), print `[side] <rendered> (loc)`. Server-side → terminal (console/stdout). Client-side in dev → forward to the dev terminal (Phase 5) AND keep the browser console output.

## Phase 4 — Route-Inference side correctness
Verify (don't rebuild) that `ctx.mode` is correct per emit context including CPS server/client batches, so the Phase-2 tag is per-statement-accurate (the E3 promise — the acute case is adjacent statements on opposite sides in a split function). Add the threading only if a gap exists.

## Phase 5 — dev.js client→terminal forwarding (F2=B)
Add a dev-server endpoint (e.g. POST `/_scrml/log`) receiving client `_scrml_log` payloads `{side, loc, msg}` and printing `[client] msg (loc)` to the dev terminal. Client `_scrml_log` POSTs there only in dev mode. Server `log()` already prints to terminal. This is the v1 terminal-as-single-view. Do NOT build the server→browser mirror (C north-star) — out of v1 scope; note it as a follow-on.

## Phase 6 — canonical-render (F6=B)
`_scrml_log` renders scrml values (structs, markup-as-value, maps) via the §47.1.4 canonical-string machinery, NOT raw `JSON.stringify` (which renders structs/markup poorly). Reuse existing canonical-render machinery if present; flag the markup-as-value rendering case explicitly.

## Phase 7 — prod-strip (F4=A)
In `output.mode: production`, `log()` → 0 bytes (the Phase-2 lowering emits nothing). Mirror the `test-bind` clean-strip precedent. Verify the emitted prod bundle contains zero `_scrml_log` references when mode=production.

## Phase 8 — tests + S138 R26 empirical verification
- Unit/integration tests: side-tag correctness (server vs client); CPS-split per-statement side; file:line presence; prod-strip = 0 bytes; `W-LOG-SHADOWED` (user `function log` wins + lint fires); canonical render of a struct + a markup value; the existing 74 `function log` fixture stubs in `samples/compilation-tests/` still compile (each now emitting `W-LOG-SHADOWED`, not breaking).
- Any scrml test fixtures you author: follow canonical scrml shape — if unsure, consult `/home/bryan-maclee/scrmlMaster/scrmlTS/docs/articles/llm-kickstarter-v2-2026-05-04.md` + `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`. No React/Vue/JSX reflexes.
- **S138 R26 empirical verification (MANDATORY before claiming DONE):** compile a real adopter source that uses `log()` (author a small one if none exists; the 74 fixtures use it) on the post-build baseline; grep the emitted JS for the correct `[server|client] ... (file:line)` shape on both sides; `node --check` the emitted JS (exit 0). Then compile with `output.mode: production` and grep — confirm ZERO `_scrml_log` in the prod bundle. Report the exact commands + outputs. DO NOT mark DONE without R26 passing.

# BASELINE + FINAL REPORT
- Establish a clean `bun run test` baseline at startup (record pass/skip/fail). Confirm 0 NEW failures at the end (full suite).
- Final report MUST include: WORKTREE_PATH, FINAL_SHA, BRANCH, FILES_TOUCHED (full list), per-phase commit SHAs, the Phase-0 survey findings vs DD (any drift), the SPEC section-home decision (for PA review), the shadowing + client→terminal mechanisms you chose, the R26 empirical results (commands + output), maps feedback (per the MAPS block), full-suite test delta, and any DEFERRED items with rationale.

Build incrementally, commit per phase, keep progress.md current. The design is locked — implement it faithfully; surface (don't improvise) any place the DD is infeasible.
