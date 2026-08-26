# BRIEF — ctx.ts: eight S239 review findings, three PA-CONFIRMED by execution

change-id: `ctx-probe-review-fixes-2026-08-26`
dispatched: S376-bryan, 2026-08-26
target branch: `feat/s375-ctx-probe` (PR #708), tip `c0be7503`

## ⚑ STEP 1 — GET THE CODE

Your worktree is cut from `origin/main`. **`scripts/ctx.ts` is NOT on main** — it is only on
`feat/s375-ctx-probe`.

```sh
git fetch origin feat/s375-ctx-probe
git checkout FETCH_HEAD -- scripts/ctx.ts docs/changes/ctx-probe-review-fixes-2026-08-26/
git merge-base HEAD origin/main    # assert your base IS origin/main; if not, STOP
bun install
```

## WHY THIS MATTERS MORE THAN A NORMAL SCRIPT FIX

`pa-base v2.16` §2 — a RATIFIED contract rule — names `bun scripts/ctx.ts` as the probe for every
maintained-document size budget. This tool's numbers are about to underwrite a standing rule, and
the PA has already relayed one of its conclusions to the operator twice. **A wrong number here is
laundered into doctrine.** Correctness beats features; if a limb is uncertain, make it fail loud
rather than guess.

---

## FINDING 1 — HIGH. Output/thinking/turn totals are DOUBLE-COUNTED, and the headline conclusion is an artifact of it.

**PA-CONFIRMED BY EXECUTION on a live transcript** (`efaf9056-…jsonl`), not relayed:

```
RAW (what ctx.ts counts):  turns=418  output=289,925  thinking=123,612
DEDUPED by message.id:     turns=225  output=143,939  thinking=58,171
ratio:                     turns 1.86x   output 2.01x   thinking 2.12x
```

Claude Code persists ONE logical assistant message as N JSONL records (text / thinking / each
`tool_use`), and **every one carries an identical `message.usage`**. The loop at `:292-296` sums
across RECORDS, not messages.

**The worst consequence is at `:376-380`, and it is the reason this is HIGH.** `residentOutput` is
computed CORRECTLY, so the guard `totalOut - residentOutput > 1000` fires against an inflated
`totalOut` and prints:

> "of 289,925 tokens this session emitted, only ~143,000 are still resident (~146,000 not carried
> forward — arithmetically consistent with thinking blocks being dropped from later prompts)"

With the correct total the gap is ~1-2k: **essentially all output IS resident and nothing is being
dropped.** The tool prints a confident, mechanistically-worded conclusion that is the OPPOSITE of
what its data says, and the hedge in that sentence ("measures the GAP, not the mechanism") makes it
read MORE careful, not less. That is worse than a plain wrong number.

**Fix:** dedupe by `message.id` before totalling. Propagates to `:363` (`assistantTurns`,
`totalOutputTokens`, `totalThinkingTokens` in `--json`) and `:375`.

⚑ **Do NOT dedupe `withUsage` wholesale without checking what else reads it.** `prompt` /
`occupied` / `pct` come from the LAST record's usage and duplicates carry identical usage, so the
headline occupancy is CORRECT today and MUST stay byte-identical after your change. Prove that:
capture `--json` before and after and diff `occupied`, `pct`, `remaining`, `prompt`. The attribution
loop also walks `withUsage` pairwise — decide deliberately whether it should walk messages or
records, and say which and why in `progress.md`.

## FINDING 2 — MEDIUM. `--window` is unvalidated; the tool emits NaN/Infinity at exit 0.

**PA-CONFIRMED BY EXECUTION:**

| invocation | output | exit |
|---|---|---|
| `--window abc` | `ctx — 592,938 / NaN tokens · NaN% used · NaN left` | **0** |
| `--window 0` | `ctx — 592,938 / 0 tokens · Infinity% used · -592,938 left` | **0** |
| `--window --json` | `"window":null,"pct":null` in the JSON | **0** |

The header promises `EXIT CODES: 0 ok · 2 no transcript resolvable (fails LOUD — never reports 0%)`.
A NaN percentage is the same failure class as a false 0%. `val()` (`:63`) also returns the next argv
element blindly, so a flag is consumed as a value.

**Fix:** require `Number.isFinite(WINDOW) && WINDOW > 0`, exit 2 otherwise; reject a value that
starts with `--`. Apply the same guard to `--turns`, `--top` and `--session` (a `--session --json`
has the identical hole). Prove the bite for each.

## FINDING 3 — MEDIUM. The cwd→project-dir slug rule is wrong for adjacent non-alphanumerics.

**PA-CONFIRMED INDEPENDENTLY** — I grepped the shipped binary myself at
`~/.local/share/claude/versions/2.1.241` (NEWER than the version the reviewer checked) and it uses:

```
replace(/[^a-zA-Z0-9]/g,"-")     ← PER CHARACTER
```

`ctx.ts:102` uses `cwd.replace(/[^A-Za-z0-9]+/g, "-")` — **collapses runs**. They differ for any
path containing adjacent non-alphanumerics, which **every worktree path does** (`/.claude/`):

- real dir: `-home-…-scrml--claude-worktrees-agent-X`
- ctx.ts computes: `-home-…-scrml-claude-worktrees-agent-X`

Consequence: run `--list` from a worktree and it exits 2 claiming "no sessions found", and the
`:262-272` fallback prints "NO TRANSCRIPT RESOLVABLE / Refusing to report 0%" when
`$CLAUDE_CODE_SESSION_ID` is unset. This project dispatches into worktrees constantly, so it is a
live path.

⚑ **I could NOT reproduce the end-to-end failure** — no project dir on this machine contains `--`,
because no session has yet run from a worktree. So the REGEX divergence is confirmed and the
resulting failure is DERIVED, not witnessed. Verify it yourself by constructing the case.

**Fix:** match the binary exactly, per character.

## FINDINGS 4-8 — RELAYED, NOT PA-VERIFIED. Reproduce each before fixing; report any that do not.

4. **MEDIUM `:160`** — `attachment` records have no `message` field, so `chars = 0` and they carry
   zero weight in the proportional split at `:331-336`; their real tokens get redistributed onto
   whatever tool_result shared the turn. Reported measurements: 27.6 KB `agent_listing_delta`,
   10.3 KB `skill_listing`, 132 KB across 260 `total_tokens_reminder` records. Related: at `:338`
   the `"unattributed (no intervening entry)"` label is FALSE when entries were present but all
   zero-char.
5. **LOW-MED `:264`** — the cwd fallback can report a DIFFERENT CONCURRENT SESSION's occupancy, and
   its warning names the wrong hazard ("may be a sidechain" — sidechains are already filtered at
   `:214`). This project runs concurrent sessions in one checkout routinely.
6. **LOW `:328`** — `entries.filter(...)` per turn is O(turns × entries); both arrays are
   index-ordered so a single forward cursor suffices.
7. **LOW `:320`** — after a compaction, buckets are never shrunk, so `attributedTotal` can exceed
   `occupied` and every per-source `%` is a share of a superset that was partly evicted.
8. **LOW `:112`** — unguarded `statSync` in `sessionsForCwd` (and again at `:240`) can throw ENOENT
   on a rotated file and kill the whole run, including the default path.

## SCOPE

**WRITE ONLY** `scripts/ctx.ts` and your own
`docs/changes/ctx-probe-review-fixes-2026-08-26/progress.md`. Nothing else — no compiler source, no
SPEC, no contract docs.

## VERIFY

Every claim by EXECUTION and by EXIT CODE, never by grepping output text.

1. The headline `occupied` / `pct` / `remaining` / `prompt` are **byte-identical** before and after
   (diff the `--json`). This is the regression that would matter most.
2. `--json` still parses and keeps its key set.
3. Deduped totals match an INDEPENDENT count (write a throwaway script; do not check the fix against itself).
4. Bite proofs, each exiting 2: bogus `--session`, empty transcript, `--window abc`, `--window 0`,
   `--window --json`.
5. `--list`, `--breakdown`, `--top`, `--turns` all still exit 0.
6. State which of findings 4-8 reproduced and which did not.

## CRASH RECOVERY

Commit after each finding you close — WIP commits expected; the branch is the checkpoint. Append-only
timestamped `progress.md`. Clean `git status` before reporting DONE.

⚑ **Environment trap, already witnessed on this project:** `bun --cwd <path> run <script>` silently
no-ops and exits 0. Run scripts plainly from the worktree CWD.

## REPORT

Worktree path · final SHA · files touched · per-finding verdict (fixed / not-reproduced / deferred)
with the evidence · the before/after `--json` headline diff · all bite-proof exit codes.
