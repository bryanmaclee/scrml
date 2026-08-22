FIX ROUND on an existing scrml compiler branch. One confirmed HIGH defect, found by an adversarial pre-land review and independently reproduced by the PA. Scope is deliberately narrow: **fix F1 only.**

## WORKSPACE — an EXISTING worktree, already on the branch. Do NOT create a new one.
- work in: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a413f731596473f84`
- branch: `handle-onion-top-level-dispatch`, currently at `b70db793`
- deps are already installed there.

**STARTUP GATE — first action, before any edit. If any check fails, STOP and report:**
1. `cd` into the worktree above; `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a413f731596473f84`
2. `git rev-parse --show-toplevel` MUST equal that same path
3. `git branch --show-current` MUST be `handle-onion-top-level-dispatch`
4. `git status --short` MUST be clean
5. `git rev-parse HEAD` MUST be `b70db793bfcbca8f0adf0ee5bb1a3763b5e70db0`

**PATH DISCIPLINE — this is not boilerplate.** Every Read/Write/Edit uses an ABSOLUTE path under the worktree root. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`** (the main checkout) — it is live and two other review agents are running against sibling worktrees. Use `git -C "$WORKTREE"` and `bun --cwd="$WORKTREE"`. Do NOT run `git stash` anywhere. Do NOT touch any sibling worktree.

## THE DEFECT — F1, CONFIRMED TWICE (reviewer + PA, independently)

The branch hoists `handle()` to wrap top-level dispatch. That is correct and ratified. **But it dragged `ratelimit=` up with it**, so the limiter now counts EVERY request instead of every route request.

**Reproduced by the PA on the real emitted server, branch vs current main, identical fixture:**

```scrml
<program ratelimit="3/min">
  <page>
    <h1>hi</h1>
  </page>
</program>
```

Built with `scrml build <dir> -o <dist>`, then driving the emitted `_server.js` in-process (capture the `Bun.serve` config, call `cfg.fetch(new Request(url), fakeServer)` — no socket):

| # | request (one ordinary browser page load) | main `77a7b381` | branch `b70db793` |
|---|---|---|---|
| 1 | `GET /app.html` | 200 | 200 |
| 2 | `GET /app.<hash>.css` | 200 | 200 |
| 3 | `GET /scrml-runtime.<hash>.js` | 200 | 200 |
| 4 | `GET /app.client.<hash>.js` | 200 | **429** |

**The app's own client bundle is rate-limited on the first page load. The app cannot boot for its first visitor.**

The reviewer also reproduced cross-module bleed: with `alpha.scrml` declaring `ratelimit="2/min"` and `beta.scrml` declaring none, `GET /beta.html` starts 429ing on the 3rd request — throttled by a limiter it never opted into.

## THE GOVERNING SENTENCE — this is a CONFORMANCE RESTORATION, not a design change

`compiler/SPEC.md:1080`, the structural-element attribute table, verbatim:

> `<page>` | §40 | `db=`, `auth=`, `csrf=`, `ratelimit=` (**per-route only**; see §40 for canonical value sets)

And the `E-PAGE-INVALID-ATTR` catalog row (`compiler/SPEC.md` ~:19560), verbatim:

> A `<page>` element carries an attribute that is not in the **per-route** attribute set `{ db=, auth=, csrf=, ratelimit=, keep-alive }`

`ratelimit=` is normatively per-route. The branch made it per-request. **Restoring per-route scoping needs no ruling** — the sentence already exists, so this is a bug fix (base §8 "toward the contract"), not a widening.

Read §40 in full before you touch anything (`grep -n "ratelimit" compiler/SPEC.md` then read the surrounding sections with offset/limit). If §40 contradicts the two sentences above, STOP and report the contradiction instead of guessing — that outcome is a finding, not a blocker you should resolve yourself.

## LOCUS — PA-LOCATED, TREAT AS A HYPOTHESIS AND VERIFY

The reviewer named `compiler/src/codegen/emit-server.ts:3045-3047` for the ratelimit call, composed at `build.js:503` and `dev.js:1070`. **I did not trace this myself.** Confirm where the limiter is actually invoked and where the decision is made before editing, and report whether the hypothesis held, was refined, or was wrong. If you cannot state how execution reaches the line, say so.

## WHAT TO DO
Restore per-route scoping for `ratelimit=` while keeping the ratified top-level onion intact. Two shapes were suggested — keep the check at the route layer, or gate it off the static/404 tail. **Pick on the merit of what the code actually looks like and state why.** Constraints:
- `handle()` must still PRE-wrap all top-level dispatch (that is the ratified ruling `[1677]`; do not undo it).
- Do NOT touch `headers=`/CSP — that is a separate blocked operator decision. Out of scope.
- Do NOT change the N-modules-N-onions behaviour — that needs a ruling. Out of scope.
- Fix it in ALL dispatchers where it is wrong (`emit-server.ts`, `commands/build.js`, `commands/dev.js`). The reviewer found the three dispatchers already diverge; do not add divergence.

## VERIFICATION — do not mark done without these
1. **The exact PA reproducer above must flip**: request #4 returns 200 on the fixed branch. Build it, drive it, paste the real table.
2. **The cross-module bleed case must flip**: two modules, one with `ratelimit`, the other's page unthrottled.
3. **`ratelimit=` must still WORK where it should** — a real route request over the limit still 429s. A fix that simply disables the limiter is a worse defect than the one you are fixing. Prove it fires.
4. Run the gate: `bun --cwd="$WORKTREE" run test` and `bun --cwd="$WORKTREE" conformance/run.ts`. Compare the failing-test NAME SET against the branch's pre-fix baseline (53 failures, all pre-existing on main) — report branch-only NEW failures, and distinguish a TIMEOUT from an assertion failure; this harness prints the same `(fail) <name>` for both.
5. Add an EXECUTING regression test (drives real requests through the emitted server), not a text-grep on emitted output. This project has been burned repeatedly by "emitted ≠ runs". The reviewer specifically flagged that `build-adapters.test.js` asserts `_scrml_onions = [_0, _1]` as TEXT and never executes what it means — do not add another oracle with that blind spot.

## COMMIT DISCIPLINE
- First commit: write this brief verbatim to `docs/changes/handle-onion-f1-ratelimit-scope/BRIEF.md` (single-quoted heredoc) plus a `progress.md`, and commit. That is your crash anchor.
- Commit after each meaningful unit; append to `progress.md` as you go. WIP commits are expected.
- NEVER `--no-verify`, and never alter or bypass a hook.
- Clean `git status` before you report DONE.

## REPORT
Final message = the deliverable. Include: whether the locus hypothesis held/refined/was wrong; the shape you chose and why; the three verification tables (reproducer flipped, bleed flipped, limiter still fires); gate numbers with the NEW-failure name set; files touched; final SHA; anything you deferred and why.
