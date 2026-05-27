# R25-Bug-36 — `server function` body silently dropped on `?{}` + `if (x is some/not) fail` pattern

**Change-id:** `r25-bug-36-server-fn-body-drop-2026-05-27`

**Severity:** CRITICAL (known-gaps Bug 36 / S136 R25). **BLOCKER for any `?{}` SQL-touching server function.** Compile exits 0 + node --check passes BUT emitted server-fn body is empty (auth boilerplate + parameter extraction only; SQL/control-flow/fail/run all dropped). Adopters deploy silently broken code. Surfaced INDEPENDENTLY by 3 of 4 R25 devs (dev-1-react, dev-2-elixir, dev-4-pascal) with same enum/function names.

**This is the worst-of-both-worlds bug class.** R24-BUG-1 (Bug 28, RESOLVED S136 `89008e97`) was "raw tokens in JS, caught by node --check." R25's Bug 36 + Bug 38 are one rung DEEPER — "empty function bodies, NOT caught by node --check because empty fn body is valid JS." Bug 36 is the highest-blast-radius surface of the round.

## Visual proof — source vs emit

**Source** (`/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/dev-1-react.scrml` lines 91-110):

```scrml
server function createCard(title, description, priority) ! CreateError {
    const row = ?{`INSERT INTO cards (title, description, priority, status, created_at) VALUES (${title}, ${description}, ${priority}, 'Backlog', ${Date.now()}) RETURNING *`}.get()
    return row
}

server function moveCard(cardId, toStatus) ! MoveError {
    const row = ?{`SELECT * FROM cards WHERE id = ${cardId}`}.get()
    if (row is not) fail MoveError::NotFound
    ?{`UPDATE cards SET status = ${toStatus} WHERE id = ${cardId}`}.run()
    broadcastMove(cardId, toStatus, @currentUserName)
    return row
}

server function archiveCard(cardId) ! ArchiveError {
    const row = ?{`SELECT * FROM cards WHERE id = ${cardId}`}.get()
    if (row is not) fail ArchiveError::NotFound
    ?{`UPDATE cards SET status = 'Archived', completed_at = ${Date.now()} WHERE id = ${cardId}`}.run()
    ?{`INSERT INTO activity (kind, card_id, ts) VALUES ('archived', ${cardId}, ${Date.now()})`}.run()
    return row
}
```

**Emit** (`/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/dist/dev-1-react.server.js` — generated handler):

```javascript
async function _scrml_handler_createCard_3(_scrml_req) {
  // route.query injection (SPEC §20.3)
  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');
  const route = { query: Object.fromEntries(_scrml_url.searchParams) };
  // Auth check (compiler-generated)
  const _scrml_authResult = _scrml_auth_check(_scrml_req);
  if (_scrml_authResult) return _scrml_authResult;
  const _scrml_body = await _scrml_req.json();
  const title = _scrml_body["title"];
  const description = _scrml_body["description"];
  const priority = _scrml_body["priority"];
}                                                  // <-- ENDS HERE; body dropped
```

The handler returns `undefined` for every call. `_scrml_handler_moveCard_4` + `_scrml_handler_archiveCard_5` show the same pattern. NONE of the SQL / control-flow / fail / run / broadcast calls / return are in the emitted JS.

## The smoking gun

At compile time, the compiler emits this warning (per R25 dev reports):

```
[scrml] warning: statement boundary not detected — trailing content would be silently dropped: "..." (in <file> near offset N)
```

Three warnings per affected file in R25 — one per affected server-fn. The warning is correct SIGNAL but it's a `[scrml] warning` (informational stream — not an error code with `W-` prefix, not in result.warnings) and compile exits 0. **This warning should be ELEVATED to a BS-error (`E-BS-STATEMENT-BOUNDARY-DROPPED` or similar) when it would result in empty function body emission.** "Silently dropped" + "compile exits 0" is the bug.

## Root cause hypothesis (per R25 report)

Statement-boundary parser drops content after first `?{...}` token inside `server function` body. The `?{` token classification kicks the BS layer into "I don't know where this statement ends" mode and it bails on the rest of the body.

This is likely the SAME root cause as **Bug 38** (`!{}` arm body codegen failure broader case) — both involve sigil-prefixed tokens (`?{` and `!{`) confusing statement-boundary detection. If your fix addresses the underlying parser pathology, **Bug 38 may close as side-effect** — opportunistically address it if root is shared.

## Suspect files (PA-side initial scope)

- `compiler/src/codegen/emit-server.ts` — server-route handler emission; where the empty body lands
- `compiler/src/codegen/emit-logic.ts` — server-fn body lowering (R24-BUG-2 fix landed here at commit `c7e81962` — `emitArmAssign` closure inside `case "guarded-expr":`; similar surface)
- **Upstream BS-layer / statement-boundary parser** — where the "statement boundary not detected" warning fires. Look for the emit-site of that warning string in `compiler/src/` and trace UP to the boundary-detection logic that bails after `?{`.

Grep starting points:
- `grep -rn "statement boundary not detected" compiler/src/` — find the warning emit site
- `grep -rn "_scrml_handler_" compiler/src/codegen/emit-server.ts` — find the handler-body emission
- Trace from BS warning → boundary-detector → how `?{` is classified for boundary purposes

## MAPS — REQUIRED FIRST READ

Before consuming any other context (kickstarter / anti-patterns / SPEC sections / source files),
read `.claude/maps/primary.map.md` in full. It is ~100 lines.

The §"Task-Shape Routing" section tells you which additional maps to consult based on your
task shape — for this task the shape is **compiler-source bug fix (parser / codegen)**.

**Note from R24-BUG-2 dispatch:** the brief's suspect-file list was WRONG (PA brief named
`emit-variant-guard.ts`; agent found bug at `emit-logic.ts` via the maps). For Bug 36, similar
caveat — PA's suspect files are heuristic. Use `structure.map.md` § "Key Codegen Modules" to
find the actual landscape. Grep for "statement boundary not detected" string is the most
direct path to the bug site.

Map currency: maps reflect HEAD `27e14c66` as of 2026-05-27. Recent commits since:
- R24-BUG-1 fix at `expression-parser.ts` + `codegen/rewrite.ts` (commit `89008e97`)
- R24-BUG-2 fix at `codegen/emit-logic.ts` (commit `c7e81962`)
- Plus docs-only commits

These are in your worktree base; account for them when navigating.

Feedback: in final report, include either:
- "Maps consulted: [list]; load-bearing finding: <one sentence>"
- "Maps consulted but not load-bearing — [optional context]"

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 + S99 + S126)

### Startup verification (do this BEFORE any other tool call)

1. `pwd` via Bash. MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.
   Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` — MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` — worktrees don't inherit node_modules.
5. `bun run pretest` — populates `samples/compilation-tests/dist/`.

If ANY check fails: STOP and report.

### S99 first-commit pwd echo (mandatory)

Your FIRST commit message MUST include verbatim output of `pwd`, e.g.:
`WIP(r25-bug-36): start at $(pwd)`.

### S126 Bash-edit + no-cd-to-main discipline

Use Bash-based edits exclusively (perl/python/heredoc on worktree-absolute paths).
`bun --cwd "$WORKTREE_ROOT" <subcmd>` / `git -C "$WORKTREE_ROOT" <subcmd>`.
NEVER `cd` into the main repo from this dispatch.

### NO `--no-verify` UNDER ANY CIRCUMSTANCES

**Per pa.md S87 / S88 — NEVER bypass the pre-commit hook without explicit user authorization. Your dispatch has NO such authorization.** If you hit a pre-commit failure:

- If it's a pretest race condition (dist artifacts mid-rebuild): STOP, wait for pretest stabilization (`bun --cwd "$WORKTREE_ROOT" run pretest`), retry commit.
- If it's a real test failure: STOP and report. Do NOT bypass.
- If you're tempted to `--no-verify` for ANY reason: STOP. Report the situation in your final report; the PA will decide.

The R24-BUG-2 dispatch used `--no-verify` without authorization (process violation; banked); this brief explicitly forbids the pattern.

## Commit discipline (S83 two-sided rule)

After EVERY edit: diff → add → commit IMMEDIATELY. Don't batch.
Before reporting DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean.

## The fix

1. **TRIAGE FIRST — report your finding BEFORE patching:**
   - Grep `compiler/src/` for "statement boundary not detected" — find the warning's emit site.
   - Trace up to the boundary-detection logic. Identify WHY it bails after `?{`.
   - Determine whether the root is in:
     (a) BS-layer tokenization (how `?{...}` is segmented)
     (b) statement-boundary detection (how the parser determines a statement ends)
     (c) server-fn body collection (how `emit-server.ts` reads the parsed body)
     (d) something else
   - **For Bug 38 shared-root check:** trace whether `!{` (the `!{}` handler token) hits the same code path. If yes, the fix likely addresses both Bug 36 and Bug 38.
   - Report your triage finding before any code changes.

2. **PATCH** — the structural fix should make the BS layer correctly identify statement boundaries after `?{...}` (and probably `!{...}`) tokens. The "statement boundary not detected" warning should NOT fire on this canonical adopter shape; if it fires, it should ELEVATE to an error (compile-fails-loud) rather than silently drop content.

   Two-option choice (report and decide):
   - **Option A (loud-elevation only):** keep the warning behavior; add `E-BS-STATEMENT-BOUNDARY-DROPPED` error that fires when BS would drop content from a function body. Compile fails loud. ADOPTERS GET A CLEAR DIAGNOSTIC. Doesn't fix the canonical shape from compiling — adopters have to restructure.
   - **Option B (substantive fix):** fix the boundary-detector to correctly recognize statement boundaries after `?{...}` (and `!{...}` if shared). The canonical shape compiles. Larger patch but the right answer per Rule 3.
   - **PA-lean:** Option B if scope is reasonable (~1-2 files); Option A as fallback if root requires substantial parser rework. REPORT before committing.

3. **REGRESSION TEST** — author tests in `compiler/tests/unit/` covering:
   - Single `?{}.get()` + `return` body
   - `?{}.get()` + presence-check `if` + `fail` + `?{}.run()` + `return` body (R25 reproducer exact shape)
   - Multi-line `?{}.run()` sequences (archiveCard shape)
   - Mixed: `?{}` + non-SQL statements + control flow
   - Negative-control: server-fn body WITHOUT `?{}` still emits correctly
   - For Option A: explicit test that E-BS-STATEMENT-BOUNDARY-DROPPED fires on the dropped-content case
   - For Option B: explicit test that the canonical shape compiles to non-empty body + `node --check` passes on emitted server.js

4. **Run full test suite** via `bun --cwd "$WORKTREE_ROOT" run test`. Baseline: 14,892 pass / 0 fail / 88 skip / 1 todo (post-R24-BUG-2 fix + R25 intake docs).

5. **Verify reproducer**:
   ```
   bun --cwd "$WORKTREE_ROOT" run compiler/src/cli.js compile \
     /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/dev-1-react.scrml \
     -o /tmp/r25-bug-36-verify/
   ```
   Then:
   ```
   grep -A 12 "_scrml_handler_createCard\|_scrml_handler_moveCard\|_scrml_handler_archiveCard" /tmp/r25-bug-36-verify/dev-1-react.server.js
   ```
   Expected (Option B): handler bodies contain the SQL / control-flow / fail / run / broadcast calls / return; NOT empty.
   Expected (Option A): compile EXITS 1 with E-BS-STATEMENT-BOUNDARY-DROPPED diagnostic; no empty-body emit possible.

6. **Bug 38 opportunity check:** after fix, ALSO try compiling dev-2-elixir.scrml + dev-3-svelte.scrml + dev-4-pascal.scrml and inspect the `!{}` arm bodies. If `_result = ` followed by arm-body code now appears in client.js where it was empty before, Bug 38 closed as side-effect. Report the finding.

## Required tests

- Regression test in `compiler/tests/unit/` (see step 3)
- Full `bun run test`: 0 fail required (baseline 14,892)

## Final report shape

When done:

- **WORKTREE_ROOT:** <full path>
- **BRANCH:** <agent branch>
- **FINAL_SHA:** <tip SHA>
- **FILES_TOUCHED:** <list with line counts>
- **TRIAGE_FINDING:** which of (a)/(b)/(c)/(d); exact bug site; root description
- **OPTION_CHOSEN:** A (loud-elevation) | B (substantive fix); rationale
- **BUG_38_STATUS_AFTER_FIX:** still OPEN | likely closed as side-effect | confirmed closed (with `node --check` evidence) | not investigated
- **FIX_DESCRIPTION:** what changed and why
- **TEST_RESULTS:**
  - new tests added: <N>
  - full-suite delta: <pre> → <post>
  - dev-1-react.scrml server-fn handlers: empty BEFORE / populated AFTER (Option B) OR clear diagnostic emitted (Option A)
- **MAPS_CONSULTED:** [list with load-bearing finding]
- **DEFERRED_ITEMS:** anything noticed but not fixed (with severity)

If Phase-0 STOP (e.g., root is much deeper than expected — full parser rewrite — or the fix touches many files), STOP and report before any code changes.

## What this dispatch is NOT

- NOT a broader server-fn audit. Fix the empty-body case, regression test, ship.
- NOT a chance to refactor BS layer. Surgical fix.
- NOT R24-BUG-1 or R24-BUG-2 territory (already RESOLVED).
- NOT Bug 37 (`<each>` arrow truncation — separate parser surface).

## Acknowledgments

- R24-BUG-1 (Bug 28) RESOLVED S136 `89008e97` — `or`/`and` codegen.
- R24-BUG-2 (Bug 29 narrow) RESOLVED S136 `c7e81962` — `!{}` `{ return }` arm.
- R25 report at `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25-report.md` § "Compiler bugs surfaced" → Bug 36 (and Bug 38 possible-shared-root).
- known-gaps Bug 36 entry: `/home/bryan-maclee/scrmlMaster/scrmlTS/docs/known-gaps.md` §1 HIGH.
- R25 BRIEF.md (the gauntlet's dev brief): `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/BRIEF.md`.

Good luck. This is the highest-blast-radius bug surfaced this session; getting it right makes the language deployable for real-world CRUD-server-fn patterns.
