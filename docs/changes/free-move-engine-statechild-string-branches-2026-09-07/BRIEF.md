# BRIEF — THE FREE MOVE: delete the string-delimiter branches from the engine state-child closer scan

**Authorized:** bryan, S405 2026-09-07, verbatim: **"build the free move"**.
**Origin:** dpa-045 round 1, Call 4. **Change-id:** `free-move-engine-statechild-string-branches-2026-09-07`.

## THE ONE-LINE TASK

`skipCommentOrString` in `compiler/src/engine-statechild-parser.ts` applies **string lexing** to an
engine state-child body. A plain-markup body is TEXT with no string concept, so an apostrophe in
prose opens a phantom string that runs to EOF and derails every closer scan reached from it. **Delete
the `"` / `'` / backtick branches.** Keep the comment branches.

## WHY THIS IS CONFORMANCE RESTORATION, NOT A WIDENING (base §8 — read this before you start)

The direction is **newly-ACCEPTING**, which is normally a one-way door requiring a ruling. It ships
here because a **governing sentence already exists** and the implementation wrongly rejects the form:

- **`SPEC.md:1090`** — *"any plain-markup element body [is a] free-text body"*
- **SPEC §4.18.1** — free-text mode: *"A bare run is display text"*; a `<p>` nested inside a
  code-default body **opens its own free-text body**, mode is per-body and not inherited.
- **S109 ruling** — *"markup-text body is TEXT with no string concept."*

Quote the governing sentence in your commit message. If your work makes you doubt it applies, STOP
and report rather than proceeding.

## THE PRECEDENT — THIS EXACT DELTA ALREADY SHIPPED ONCE (S196)

`match-statechild-parser.ts`'s **`skipMatchComment`** (`:115`) is believed to be
`skipCommentOrString` **with the string branches already removed** — the S196 fix for the identical
class in match arms (`g-match-arm-apostrophe-bs`, RESOLVED). Both carry the same dated
`url-comment-match-engine (2026-07-09)` carve-out, so they are siblings.

⚑ **PA-located-verify.** Diff the two functions yourself and report whether the "exact same delta"
claim holds. If `skipMatchComment` differs in some other way that matters, that is a finding — say so
rather than pattern-matching.

## LOCI — PA-RELAYED HYPOTHESES. LINE NUMBERS ON THIS PROJECT ROT AND HAVE BURNED US TWICE.

| what | claimed | how to actually find it |
|---|---|---|
| the scanner to edit | `engine-statechild-parser.ts:1363` | `grep -n 'function skipCommentOrString'` |
| the branches to delete | `:1418-1452` | read the function; find the `"` / `'` / backtick arms |
| the precedent | `match-statechild-parser.ts:115` | `grep -n 'function skipMatchComment'` |

**`skipCommentOrString` has ~10 call sites in that file** (`grep -n 'skipCommentOrString('`). Removing
the string branches changes behaviour at EVERY one. Enumerate them and reason about each — this is a
`skipCommentOrString` change, not a `findStateChildCloser` change.

## DONE-PROBE — PA-verified failing at `8f1cea31`, must pass after

```scrml
<program>
${ type S:enum = { A, B } }
<engine for=S initial=.A>
  <A rule=.B><p>go</p></>
  <B><p>it's ready</p></>
</>
</program>
```
`bun compiler/bin/scrml.js compile <file> --output-dir <tmp>`

- **BEFORE (verified):** `error [E-ENGINE-STATE-CHILD-MISSING]` naming `.B`, which is present in source.
- **AFTER (required):** exit 0, and the emitted output renders the apostrophe as content.
- **ODD vs EVEN IS THE TELL:** the same body with *two* apostrophes (`it's ready, don't wait`) compiles
  clean TODAY. That asymmetry is what proves the scan is string-lexing. Test both; both must pass after.

## ADVERSARIAL SCOPE — WHERE THIS COULD BREAK (enumerate the blast radius, base §8)

The mechanism removes a skip. Anywhere a state-child body legitimately contains a `"`, `'` or
backtick that the scan previously stepped over, the scan now sees the characters. Construct
reproducers for at least:

1. A **display-text literal** in a state-child body — `<Idle>"Ready to fetch."</>` (§4.18.3). This is
   the canonical code-default form and MUST still work. **This is the highest-risk case.**
2. A `:`-shorthand body carrying a quoted string — `<Idle : "Waiting…">`.
3. A state-child body containing a `</>` INSIDE a quoted string — the case the skip presumably existed
   to protect. If this regresses, say so loudly; it may be the real reason the branches are there.
4. An attribute value containing `>` or a quote inside the state-child opener.
5. A backtick template with `${...}` inside a state-child body.
6. Nested engines / composite state-children.

**If case 3 regresses, STOP and report.** Do not "fix" it by reintroducing a heuristic — that is the
class we are deleting, and the right answer may be that this move is not free after all.

## VERIFY (all required; do not mark DONE without them)

1. `bun install` first — a fresh worktree does not inherit `node_modules`.
2. `bun run pretest` **from the worktree CWD** — ⚑ `bun --cwd <path> run pretest` SILENTLY NO-OPS and
   exits 0. Verify it actually produced `samples/compilation-tests/dist/`.
3. `bun run test` (chains pretest) for the baseline. **0 failures is the contract.**
4. **R26 empirical:** recompile real adopter `.scrml` from
   `../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` on your post-fix build and confirm no
   new diagnostics. Regression-tests-pass is NOT empirical-pass.
5. Add regression tests for the DONE-PROBE **and** for adversarial case 1 (the display-text literal).

## DISCIPLINE

- **Isolation:** you are in a worktree. Every write is an absolute path UNDER your worktree root.
  Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"` and
  `--cwd=` (with the `=`).
- **NEVER `git stash`** — `refs/stash` is shared across every worktree on this repo and has already
  caused a cross-worktree collision here. Do base-vs-build flips by FILE COPY.
- **NEVER a bare `pkill -f` / `killall`** on a command string every checkout shares — kill by PID
  captured at launch. Other agents and a live main checkout are on this machine right now.
- **Commit after every meaningful unit** and keep an append-only `progress.md` beside this brief.
  WIP commits are expected; your branch is the crash anchor.
- Separate exit status from output; never infer "none" from empty text; never suppress stderr.
- Report your final SHA, files touched, and whether the PA's locus hypothesis held, was refined, or
  was wrong.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing. Its watermark is
`68cfac6d`; HEAD is `8f1cea31`. The three landings since are **docs-only** (`delta(s404)`,
`bank(dpa-045)`, `rulings(s405)`) — no source moved, so the map is current for navigation. Treat map
content as a verify-against-source hypothesis regardless, and report whether it was load-bearing.
