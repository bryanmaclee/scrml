# BRIEF — handle-onion: CSP/SSR-seed + onion composition (verbatim, archived at dispatch)

Build round on `handle-onion-top-level-dispatch`. **Two operator rulings, just handed down.** These were the last two blockers on this branch.

## WORKSPACE — EXISTING worktree, already on the branch. Do NOT create a new one.
- work in: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a413f731596473f84`
- branch `handle-onion-top-level-dispatch`, currently at **`46ca6d63`** (the F1 ratelimit fix)

**STARTUP GATE — first action; STOP and report if any check fails:** `pwd` under that worktree · `git rev-parse --show-toplevel` equals it · branch is `handle-onion-top-level-dispatch` · `git status --short` clean · `git rev-parse HEAD` == `46ca6d63a854143eeb80dda73ab0b2d0ea6da495`.

**PATH DISCIPLINE.** Absolute paths under the worktree root. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`** (live; other agents are working sibling worktrees). Use `git -C "$WORKTREE"` / `bun --cwd="$WORKTREE"`. **Never `git stash`.** Never touch a sibling worktree.

**STEP 0:** `git -C "$WORKTREE" fetch origin && git -C "$WORKTREE" merge origin/main` — **MERGE, never rebase** (a rebase inverts ours/theirs and has twice renumbered a sibling's already-merged `handOffs/delta-log.md` entries). On a delta-log collision the **already-merged side keeps its numbers**; do NOT run `delta-lint --fix` on a merge result — it keeps first-in-file order, which is blind to which side is published, and it has a second known corruption mode. Resolve `@generated` blocks by REGENERATING (`bun scripts/state.ts --write`, `bun scripts/facts.ts --write`), never by hand-merging generated text.

---

## RULING 1 (was F2) — the CSP / SSR-seed fork

**The problem.** `headers="strict"` pins `default-src 'self'` (§39.2.5). scrml's OWN emitted inline SSR-seed `<script>window.__scrml_ssr_state=…</script>` and its runtime inline `<style>` violate it. Chromium-measured on this branch: `__scrml_ssr_state` = **undefined**, 2 CSP violations; on `main` it is an object with 0 violations. The §39.2.5 escape ("override via `handle()`") does not cover compiler-emitted content, so the author cannot fix this themselves.

**Context that changes how you read this — do not treat the branch as having caused a regression.** On `main`, `_scrml_mw_wrap` is called **zero times** in this program shape: `headers="strict"`, a security directive, is emitted as dead code reaching nothing. This branch is what makes it start working. The CSP collision is the *price of closing a fail-open*, not a new defect.

**RULED:** move the SSR seed to `<script type="application/json">` + `JSON.parse`, and ship the transition keyframes in the **emitted stylesheet** rather than an inline `<style>`. Zero adopter cost, small emit change.

**Verify by EXECUTION, not by reading emitted text** — this project has been burned repeatedly by "emitted ≠ runs" (a marker present in output while the bundle throws at load). Build a `headers="strict"` app WITH an SSR seed and confirm: the seed parses and `__scrml_ssr_state` is a populated object; zero CSP violations; and the same app with `headers=` absent is unchanged. Then confirm a `headers="strict"` app with transitions still animates.

## RULING 2 (was F3) — N modules must not mean N onions

**The problem.** Every module's `handle()` + auto-middleware now runs on every request. Measured: two modules × two requests = **4 log lines** (main: 0); alpha's `handle()` ran on beta's page and vice versa. Composition order is deterministic but **alphabetical by filename** (`api.js` sorts the inputs), so **a rename silently changes which `handle()` wins a contested path.**

**RULED: (a) one onion per request, composed in a DECLARED order — not filename order.**

Design judgement is yours, but the ruling binds two things: exactly one onion runs per request, and precedence is something an author can read off the source rather than infer from filenames. **If the only coherent way to express a declared order requires a new authoring surface, STOP and report rather than inventing one** — a new authoring-surface primitive is a separate ruling (`[1678]`: "one chance" binds the authoring surface, not internals). Prefer a shape that needs no new surface. If exactly one module declares `handle()` — overwhelmingly the common case — the question should not arise at all.

**Verify by execution:** two modules with `handle()` and `log=`; confirm one onion per request and that the precedence rule holds under a rename that would flip alphabetical order.

---

## OUT OF SCOPE
Anything about `ratelimit=` (fixed at `46ca6d63`, do not touch). `auth=`/`protect=` semantics — a separate ruling. Do not "improve" beyond these two.

## VERIFICATION — do not report DONE without it
- The two execution checks above, with real before/after tables.
- `bun --cwd="$WORKTREE" run test` and `bun --cwd="$WORKTREE" conformance/run.ts`. Compare the failing-test NAME SET against the pre-change baseline (53 failures at `46ca6d63`, all pre-existing on main); report branch-only NEW failures. **Separate timeouts from assertions BY DURATION** — the harness prints the same `(fail) <name>` for both, and ~4 dev-watcher tests legitimately run ~10.3 s.
- **Measure exit codes DIRECTLY (`cmd; echo $?`), never through a pipe** — `cmd | tail` reports tail's status and is a success signal that cannot fail. That trap has bitten this project twice this session.
- Add EXECUTING regression tests for both rulings (drive real requests / load the real page), not text-greps on emitted output. A reviewer already flagged `build-adapters.test.js` for asserting `_scrml_onions = [_0, _1]` as TEXT while never executing what it means — do not add another oracle with that blind spot.

## COMMIT DISCIPLINE
First commit: this brief verbatim to `docs/changes/handle-onion-csp-and-onion-composition/BRIEF.md` (single-quoted heredoc) + `progress.md`. That is your crash anchor. Commit after each unit; WIP commits expected. NEVER `--no-verify`; never alter a hook. Clean `git status` before reporting DONE.

## REPORT
Final message = deliverable: merge outcome; per-ruling before/after execution tables; whether ruling 2 needed a new authoring surface (and if so, what you stopped at); gate numbers with the NEW-failure name set; files touched; final SHA; anything deferred and why.
