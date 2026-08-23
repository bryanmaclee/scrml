# FIX-ROUND-BRIEF — instrument-integrity, 2026-08-22

> Archived verbatim at dispatch time. This is the prompt as received, not a summary.

---

FIX ROUND on the `instrument-integrity` branch. An adversarial pre-land review returned **LAND, conditional on five named follow-ups**. Your job is those five. Two of them are defects in gates that are ALREADY BLOCKING CI on `main`.

## WORKSPACE — an EXISTING worktree, already on the branch. Do NOT create a new one.
- work in: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4cfd2ab232fddafc`
- branch: `instrument-integrity`, currently at `d1a1857e`
- deps already installed there.

**STARTUP GATE — first action. If any check fails, STOP and report:**
1. `cd` into that worktree; `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4cfd2ab232fddafc`
2. `git rev-parse --show-toplevel` MUST equal it
3. `git branch --show-current` MUST be `instrument-integrity`
4. `git status --short` MUST be clean
5. `git rev-parse HEAD` MUST be `d1a1857e2633b974eebc59c3cf6afa2a0bb70a4e`

**PATH DISCIPLINE.** Absolute paths under the worktree root for every Read/Write/Edit. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`** (the main checkout — live, and another fix round is running against a sibling worktree). Use `git -C "$WORKTREE"` / `bun --cwd="$WORKTREE"`. **Never `git stash`.** Never touch a sibling worktree.

## STEP 0 — MERGE `origin/main` FIRST (required; one of the fixes lives there)
`main` has moved past your merge-base and now carries `scripts/delta-lint.ts` + a 6th blocking CI gate that did not exist when this branch was cut.
```
git -C "$WORKTREE" fetch origin
git -C "$WORKTREE" merge origin/main
```
**MERGE, never rebase** (a rebase here inverts ours/theirs and has twice renumbered a sibling's already-merged `handOffs/delta-log.md` entries). If `handOffs/delta-log.md` collides: **the already-merged side — `origin/main` — keeps its sequence numbers.** Do NOT run `delta-lint --fix` on a merge result; its heuristic keeps first-in-file order, which is blind to which side is published. Expect `docs/FACTS.md` / `docs/known-gaps.md` conflicts — resolve by taking main's `@generated` blocks then REGENERATING (`bun scripts/state.ts --write`, `bun scripts/facts.ts --write`), never by hand-merging generated text.

## THE FIVE CONDITIONS

**(1) HIGH — `scripts/state.ts:429-430`: the master-list half of the new guard is unreachable dead code.**
`refuseDegenerateProjection()` tests `recentSessions(8).trim().length === 0`. `recentSessions` has exactly two returns and BOTH are non-empty — line ~565 returns the sentinel `"_(no session-wrap commits found)_"` when zero sessions are found, line ~576 returns joined lines otherwise. **The condition can never be true**, so the hollow write-then-check chain this branch closed for `known-gaps.md` survives intact one field over — while `progress.md` asserts it as covered. Reviewer reproduced it: with `.git` moved aside, `--write` records the sentinel and `--check` returns `PASS` exit 0. **Fix: compare against the sentinel, not against `""`.** Then BITE-PROVE it: make the population empty, confirm RED, restore, confirm GREEN.

**(2) HIGH — `scripts/delta-lint.ts` (now on `main`, and now a BLOCKING CI gate) is vacuous on zero population.**
**I reproduced this myself, exit codes measured directly (not through a pipe):**
| input | result |
|---|---|
| real duplicate, canonical `·` separator | `exit 1` — correct |
| **same duplicate present**, separator drifted `·` → `-` | **`exit 0`**, prints `0 entries in the live scope … — PASS` |
| **empty file** | **`exit 0`**, `PASS` |
The parser matches nothing, so it reports PASS over a file containing the very defect it exists to catch. This is the §8 "gate reports green while verifying nothing" shape, shipped inside the PR whose entire purpose was to stop a silent entry-drop. **Fix: refuse when the live scope yields zero entries while the file has content** — the same shape as this branch's own `facts.ts` / `state.ts` / `snippet-gate.js` degenerate-measurement guards. Reuse that idiom; do not invent a sixth pattern. Bite-prove all three rows above.

**(3) MEDIUM — `docs/known-gaps.md:588` becomes FALSE when this lands.** That line says *"PA-VERIFIED at S319 — the harness's complete `expect` vocabulary … `codes` · `notCodes` · `notCodePrefixes` · `severity` · …"*. This branch adds `codeCounts`, which is not in that list. **Add it, in this same landing**, or the next session reads a PA-VERIFIED enumeration that is missing the key. (The original brief forbade touching this file, which is why the branch filed it instead — that restriction is lifted for this one line.)

**(4) MEDIUM — `compiler/SPEC.md:19618` is a live CI landmine.** The `I-MATCH-PROMOTABLE` row cites `compiler/src/lint-promotable.ts`, which does not exist; the real emitter is `compiler/src/lint-i-match-promotable.js`. The branch's new `s34-census.ts --check-new` provenance resolver is a BLOCKING gate, so **the next PR that so much as reflows that line fails for a defect it did not cause** — the pa-base §8 cry-wolf shape that gets a gate bypassed and then deleted. Fix the path. **Verify the row still passes `--check-new` afterwards.**

**(5) LOW-but-cheap — correct the branch's own numbers wherever `progress.md` states them.** The reviewer re-derived them independently: the unscanned-artifact figure is **322** (295 deep-dives + 27 debates), NOT 288 — and the branch's own executed output prints 322, so the prose contradicts its own evidence. The "3 of 5 blocking gates" headline is now "2 of 6 strictly vacuous, 1 measuring the wrong thing, plus delta-lint landed since". A wrong instrument number becomes next session's premise; that is the whole thesis of this branch.

## ALSO WORTH FIXING IF CHEAP (reviewer findings, lower priority — skip and report if they grow)
- `scripts/corpus-zero-debt.ts:324` — the guard is all-or-nothing (`artifacts.length === 0`) but `SCAN_ROOTS` has TWO roots, so a single renamed directory yields a silent 92%-coverage scan with a green tick. Make it **per-root**.
- `conformance/run.ts:256` — `codeCounts` set to `null` / `{}` / `[]` / `""` silently disables the assertion. The docstring promises a malformed VALUE is a hard failure; the CONTAINER is unchecked. A hollow assertion inside the anti-hollow-assertion feature.

## OUT OF SCOPE — do not touch
Anything in `compiler/src/codegen/`. The `.scrml` comment-stripping scope (finding 7). The `treeIdents` SCAN-root question (finding 8). Do not "improve" any gate beyond the fixes named above.

## VERIFICATION — do not report DONE without it
- **A bite-proof table for every gate you touch: corrupted input → RED, restored → GREEN, with the commands.** Measure exit codes DIRECTLY (`cmd; echo $?`), never through a pipe — `cmd | tail` reports tail's status and is a success signal that cannot fail.
- `bun --cwd="$WORKTREE" conformance/run.ts` and `bun --cwd="$WORKTREE" run test`. Compare the failing-test NAME SET against the pre-fix baseline (55 fail, of which 4 are timeout-shaped ~10.3s dev-watcher tests and 51 assertion failures — all documented). Report branch-only NEW failures and distinguish timeouts from assertions; this harness prints the same `(fail) <name>` for both.
- Re-run every probe this branch changed and confirm the numbers still match the reviewer's independently-derived set: 106 of 883 double-emitting cases, 883 conformance cases, 110 snippets, 811 §34 rows / 809 codes, 5 corpus-zero OWED.

## COMMIT DISCIPLINE
- First commit: this brief verbatim to `docs/changes/instrument-integrity-2026-08-22/FIX-ROUND-BRIEF.md` (single-quoted heredoc) + a `progress.md` append. That is your crash anchor.
- Commit after each fix; WIP commits expected. NEVER `--no-verify`; never alter or bypass a hook.
- Clean `git status` before reporting DONE.

## REPORT
Final message = deliverable. Include: the merge outcome (what conflicted, how resolved, delta-log sequence handling); a bite-proof table per gate; the five conditions each marked done/deferred with evidence; gate numbers with the NEW-failure name set; final SHA; anything you deferred and why.
