# BRIEF — `<channel>` in a nested `<program>`: reverse the placement precedence

**Dispatched:** S353-bryan, 2026-08-19. **Ruling:** user-voice-scrml.md S353, bryan *"your rec on all three"*.
**Change-id:** `channel-nested-program-precedence-2026-08-19`. **Gap:** `g-channel-in-nested-program-inside-page-ordering` (LOW).

## The ruling — option (b)

`<page>` → nested `<program>` → `<channel>` currently fires `E-CHANNEL-INSIDE-PAGE` **even though
`programDepth >= 1`** — the channel is, literally, inside a `<program>`. **Ruled: reverse the
precedence — reset `pageDepth` when descending into a nested `<program>`,** treating it as a fresh
placement scope.

**The governing sentences, and why the more specific one wins:**
- *For the current fire:* §38 preamble (`SPEC.md:20659`) and §40 (`:22395`) both say flatly
  *"Channels SHALL NOT live inside `<page>`."*
- *Against, and RULED to win:* §4.12.1 (`:724`) — *"A `<program>` nested inside another `<program>`
  SHALL be subject to the same grammar rules as a top-level `<program>`"* — and (`:718`) — *"A nested
  `<program>` SHALL be a separate compilation unit."* If a nested `<program>` is its own compilation
  unit under top-level grammar, the enclosing `<page>` is as invisible to the placement check as the
  parent's bindings are under §4.12.1 shared-nothing isolation.

**Read all four of those lines IN FULL before editing** (Rule 4 governing-sentence gate) and quote
them in your report. If what you read contradicts the summary above, STOP and report — the ruling
rests on these sentences saying what they are quoted as saying.

## Locus — PA-LOCATED-VERIFY

`compiler/src/symbol-table.ts`, `walkChannelPlacement` (SYM PASS 15; the surrounding contract notes are
around `:9416`-`:9451`). The current shape:

```
if (isChannelMarkup && pageDepth >= 1)                            -> E-CHANNEL-INSIDE-PAGE
else if (isChannelMarkup && programDepth === 0 && fileHasProgram) -> E-CHANNEL-OUTSIDE-PROGRAM
```

**I located this by reading, not by tracing execution into it.** Confirm it and report whether the
hypothesis HELD / was REFINED / was WRONG.

## The adjacent hole the ruling forces — IN SCOPE

Under (b), **should `E-CHANNEL-OUTSIDE-PROGRAM`'s `fileHasProgram` pre-scan be nested-`<program>`-aware?**
The pre-scan asks "does this file contain a `<program>` at all"; once a nested `<program>` is a fresh
placement scope, that question may need to be per-scope rather than per-file. **Investigate it, and
either fix it or report precisely why it is already correct.** Do not leave it undecided-by-accident —
that is exactly how the original `E-CHANNEL-INSIDE-PAGE` gap happened, and the gap entry says so.

## Migration — MEASURED, and re-measure it yourself

The S239 re-measurement walked all **2260** `.scrml` files and found **0** page-nested channels of any
kind. Re-run that measurement and report YOUR number. Direction-of-change is **newly-accepting** for
the nested-`<program>` shape specifically — which ships here ONLY under the toward-the-contract limb
(base §8), i.e. because §4.12.1 already says the form is legal. Say so explicitly in your report, with
the sentence quoted. If §4.12.1 does not say what it is quoted as saying, that limb fails and you STOP.

## Gates

- **No test pins this ordering today, either way.** The ruling owes one. Add tests pinning BOTH arms:
  the nested-`<program>` shape now ACCEPTED, and a genuinely page-nested channel (no intervening
  `<program>`) still REJECTED with `E-CHANNEL-INSIDE-PAGE`. The existing §B19.12/§B19.13 cover
  page-in-program, route-file and mutual exclusion — extend, do not replace.
- **Bite proof, both directions:** each new test must FAIL against the pre-fix compiler and PASS after.
  Log the verbatim pre-fix failure.
- **Conformance** `bun conformance/run.ts` green; add a case if the shape warrants one.
- **Population count before narrowing/widening** (base §8): report how many placement sites the check
  newly accepts and how many it still rejects. A clean differential is not an answer to that question.
- **Rule 4b:** `prov=ruling:user-voice-scrml.md-S353` on the `@gap` marker, and INLINE at any SPEC
  section you amend. Keep SPEC edits to **§38.1 only** if one is needed at all — two sibling agents are
  editing other SPEC sections concurrently.
- **Full suite green.** NEVER `--no-verify`; never override `core.hooksPath`.

## Startup (worktree is cut from `origin/main`, not from the PA's checkout)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
   `git rev-parse --show-toplevel` equals it; tree clean. If ANY check fails, STOP and report.
2. `git merge-base HEAD origin/main` == `origin/main` — assert loudly.
3. `bun install`, then `bun run pretest`. Use `bun run test` (chains pretest), not bare `bun test`.
4. This BRIEF is on branch `bank/s353-three-rulings`:
   `git fetch origin bank/s353-three-rulings && git checkout FETCH_HEAD -- docs/changes/channel-nested-program-precedence-2026-08-19/`

## Path discipline + crash recovery

Absolute paths UNDER your worktree root only. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`.
`--cwd "$WORKTREE_ROOT"` for `bun`, `git -C "$WORKTREE_ROOT"` for git. First commit:
`WIP(channel-precedence): start at $(pwd)`. Commit AND push after every unit; append-only timestamped
`progress.md`. A ~2-minute pre-commit hook can outrun a shell timeout — check `git log -1` before
retrying a timed-out commit; it usually landed.

## Do NOT touch

`compiler/src/codegen/protect-egress.ts` · `emit-server.ts` · `type-system.ts` · `conformance/cases/protect/*`
(a sibling agent owns those) · `handOffs/dpa-queue.md` · SPEC sections other than §38.1.

## Report back

Workspace path · final SHA · files touched · locus HELD/REFINED/WRONG · the four governing sentences
quoted verbatim · your own migration measurement · the `fileHasProgram` finding (fixed, or why already
correct) · the bite proofs with verbatim pre-fix failures · the population counts · anything deferred.
