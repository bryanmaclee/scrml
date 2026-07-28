# DISPATCH CONTEXT
You are `scrml-js-codegen-engineer` on a scrml compiler-source fix. Baseline: scrml `main` @ **`89db7981`** (v0.7.1). You work in an `isolation: "worktree"` checkout. Model: opus.

# MAPS — REQUIRED FIRST READ + currency note
Read `.claude/maps/primary.map.md` §"Task-Shape Routing" (compiler-source codegen fix) FIRST, and report the Maps line in your final report ("load-bearing finding: …" or "not load-bearing").

⚠️ **The map is STALE.** It is stamped `c700c435` / 2026-07-27T11:15Z; HEAD is `89db7981`, **12 compiler/src commits ahead**. Treat every map claim as a STARTING HYPOTHESIS and verify against current source with grep/Read. Post-map landings that touch codegen and may have moved your loci:
`#215` Wave-1c cross-chunk soft-nav (chunk loader + runtime-template) · `#214`/`#218`/`#222`/`#226`/`#227` the per-item + nested-`<each>` reconcile family (`emit-each.ts`, `emit-lift.js`, `emit-variant-guard.ts`, `binding-registry.ts`) · `#224` `tabSpan→span` in `api.js` · `#209` `E-SQL-003` in `ast-builder.js` · `#206`/`#208`/`#217` schema/db-migrate. `#236` was a comment-only privacy scrub — no behavior change, but it DID touch comments in `schema-differ.js`, `db-migrate.js`, `emit-server.ts`, `emit-client.ts`, `tenant-egress.ts`, `type-system.ts`; do not read those diffs as logic changes.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
S99 had FOUR path-discipline leaks and S126 had FOUR Edit/Bash-divergence leaks. Hold the line.
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it resolves under ANY other repo (e.g. `scrml-support`) → **STOP and report** (the S90 CWD-routing failure). Save it as `WORKTREE_ROOT`.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git -C "$WORKTREE_ROOT" status --short` MUST be clean.
4. `git -C "$WORKTREE_ROOT" merge main` — your base may be a session-start snapshot; merge current main (expect clean/fast-forward).
5. `cd "$WORKTREE_ROOT" && bun install` — worktrees do NOT inherit `node_modules` (the hook fails "cannot find package 'acorn'" otherwise).
6. `bun run pretest` — populates the gitignored `samples/compilation-tests/dist/` browser fixtures (~130 ECONNREFUSED-shaped failures without it).
7. Your FIRST commit message MUST embed the verbatim `pwd`: `WIP(<task>): start at <pwd>`.

## Path discipline (MANDATORY)
- Apply ALL source edits via Bash (`perl -i -pe` / `python3` / `cat > heredoc`) on WORKTREE-ABSOLUTE paths containing the `.claude/worktrees/agent-<id>/` segment. Do NOT use Edit/Write on source files — they have leaked to MAIN before. Echo the target path before each write; re-verify with `git -C "$WORKTREE_ROOT" diff` after.
- NEVER `cd` into the main repo or outside `WORKTREE_ROOT` for writes/installs/compiles. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths. Reading from main is READ-ONLY and fine.

# COMMIT DISCIPLINE (two-sided)
After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` → `add` → **commit immediately**. Do NOT batch — the branch is your crash-recovery anchor. Keep an append-only `progress.md` (timestamped: what was just done, what's next, blockers). Before reporting DONE, `git -C "$WORKTREE_ROOT" status` MUST be clean. **Never `--no-verify`** — if the pre-commit gate fails, STOP and report; do not bypass and do not override `core.hooksPath`.

# PHASE 3 — R26 EMPIRICAL VERIFICATION (MANDATORY before DONE)
Synthesized-input tests pass while the real path stays broken — that is exactly how these three defects reached an adopter. Before claiming DONE you MUST re-compile a real reproducer on your POST-FIX baseline and confirm the named symptom is gone AND no new symptom appears. **"Tests pass" is NOT the check** — the check is the bug-specific symptom grep/execution named in your task below. **DO NOT mark DONE without R26 passing.**

⚠️ **EXECUTE, don't grep.** All three of these bugs emit text that *looks* right and fails at runtime. Where the task says "execute", load the emitted bundle (happy-dom or `node`) and confirm behaviour — a marker being present in the output has repeatedly been a false green (S265 theme-switch, S268 `((hi))`, S278 U3).

# REPORT (final message, structured)
`WORKTREE_PATH` · `BRANCH` · `FINAL_SHA` · `FILES_TOUCHED` · `REGRESSION-TESTS-ADDED` (file + count) · `R26-RESULT` (the actual compile/execute evidence, not a claim) · `STOPPED?` (if the fix risks regressing an adjacent shape, STOP and report the survey rather than force it) · `MAPS-FEEDBACK`.

---

# LANE 2 — THE SERVER/CLIENT BOUNDARY + ASYNC-COLORING WALKER (GH #237 + D-5 + D-6)

**Three reports, one root region. The adopter's own framing for D-5/D-6 is *"same boundary walker, opposite direction, worth fixing as one bug, not two"* — treat all three as one arc.**

⚠️ **#237 has a fail-open security shape. It is the priority inside this lane.** Fix and verify it first; if the lane has to be cut short, #237 alone is a complete, landable unit.

## BUG A — #237 (HIGH, fail-open): a server-fn result assigned to a plain local emits with NO `await`

**The contrast, one mount block, two adjacent lines:**
```scrml
on mount {
    const u = loadMe(1)     // A: plain local
    @you = loadMe(1)        // B: reactive cell
    if (u is not) { window.location.href = "/login" } else { @me = u }
}
```
emits:
```js
const u = _scrml_fetch_loadMe_5(1);                                    // A — NO await
(async () => _scrml_cs_reactive_set("you", await _scrml_fetch_loadMe_5(1)))()
  .catch(…);                                                           // B — awaited
```
**Same function, same block. Only the destination differs.** The emitted wrapper IS `async`, so the await is legal — it is simply not emitted for the plain-local destination.

**Why every branch is then wrong:** `u` is a pending Promise.
- `u === null || u === undefined` → **false**. The "not signed in" branch **never runs**.
- `u.type` → `undefined`, so any role/shape test silently fails.

In the adopter's real app this produced an unconditional redirect on every load — the guard fell through to the role check, which failed on `undefined`, and the entire real page body became unreachable. **A guard that can never take its deny branch is fail-open.**

**Fix locus (PA-located, verify):** the auto-await decision lives in `compiler/src/codegen/emit-expr.ts` + `emit-logic.ts`; the async-coloring nucleus is `computeAsyncFnNames` (`emit-functions.ts`, `emit-library*.ts`, `codegen/index.ts`). The reactive-cell path already awaits correctly — **find where the destination kind gates the await and make the plain-local path agree.** Do not add a second, parallel await mechanism.

**R26 (must EXECUTE):** compile the contrast block above; then RUN the emitted bundle and assert `u` is a resolved value, that the `is not` branch is reachable, and that a deny path actually denies. Grepping for `await` in the output is NOT sufficient — the whole defect is that the text looked plausible.

## BUG B — D-5: a module-level `const` closed over by a server-promoted fn ships to the CLIENT bundle only

`ReferenceError` at runtime, **zero errors, zero warnings**. `fn` declarations cross the boundary fine; a module-level `const` does not. The adopter reports this cost them the most debugging time in the slice.

## BUG C — D-6: a client bundle destructuring a server-only stdlib module compiles clean and dies app-wide

Destructuring `scrml:store` (server-only) from a client bundle compiles clean and fails at runtime across the whole app. ⚠️ **The adopter self-corrected this one and it is arguably not a codegen bug** — `server fn` is the documented pin, so the compiler may be right to place it. **The defect they are reporting is that it is SILENT.**

So the fix direction for D-6 is most likely a **diagnostic**, not a codegen change. Establish which before building: quote the governing SPEC sentence for cross-boundary stdlib access (§12 placement inference / §41 import system), or record explicitly that you searched §12/§41 and found none. **If no governing sentence exists, this is a RULING, not a fix — STOP and report.**

**D-5 + D-6 fix locus (PA-located, verify):** the boundary walker spans `type-system.ts`, `codegen/collect.ts`, `emit-logic.ts`, `emit-server.ts`, `emit-client.ts`. D-5 (server fn can't see a module const) and D-6 (client sees a server-only module) are the two directions of the same reachability question.

## FILE-COLLISION WARNING (read before you start)
This lane writes `type-space` files that other queued work also wants:
- `type-system.ts` — **also** the locus of D-1 (`E-FN-003` string-literal scan). D-1 is sequenced BEHIND you; it is not running concurrently. Do not fix D-1 opportunistically — if you touch that code path, report it so the PA can re-scope D-1.
- `emit-logic.ts` — shared between #237 and D-5. Expected, in-lane, fine.
- You must NOT touch `codegen/index.ts` beyond read-only inspection — Lane 1 holds it. If your fix genuinely requires editing it, **STOP and report**; the PA will sequence rather than let two dispatches collide there.

## STOP-IF
- #237's fix would change the await/async contract for shapes beyond the plain-local destination → STOP and report the blast radius first. The reactive-cell path is the reference; do not "improve" it.
- D-6 has no governing sentence → STOP, it is a ruling.
- The D-5 fix requires moving a declaration between bundles in a way that changes what ships to the client → that is a security-relevant surface (§14.8.9 protect-floor); STOP and report.
