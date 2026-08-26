# progress — ctx-probe-review-fixes-2026-08-26

Append-only. Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a95f724eca8376c58`,
branch `worktree-agent-a95f724eca8376c58`, base `4895c004` (== `origin/main`).

---

## 08:29 — start

`pwd` / `git rev-parse --show-toplevel` agree, tree clean, `bun install` (218 packages).
`scripts/ctx.ts` + `BRIEF.md` fetched from `origin/feat/s375-ctx-probe` (FETCH_HEAD).
`git merge-base HEAD origin/main` == `HEAD` == `origin/main` — base asserted.

Pre-commit gate baseline: **29250 pass · 0 fail · 86 skip · 1 todo** across 1283 files.
Commit `302afcca`.

---

## 08:31 — instrumentation before any edit

Nothing in this dispatch is checked by grepping output text. Built:

- `harness.sh` — a 23-invocation matrix, recording stdout, stderr and **exit code** separately,
  runnable against any `ctx.ts`. Ran it against a pristine copy (`ctx.BEFORE.ts`) first.
- `indep-count.ts` — a deduping counter written straight against the raw JSONL, deliberately
  not importing or mirroring `ctx.ts`, so the fix is never graded against itself.
- `diff-all.sh` + `diff-report.ts` — before/after `--json` over **every** transcript on the
  machine, asserting the headline is byte-identical.
- `crosscheck.ts`, `probe-*.ts`, `f5-repro.sh`, `f8-repro.sh`, `slug-oracle.sh`.

Fixtures created **outside** the repo, cleaned up at the end (listed in the teardown entry):
`~/.claude/projects/-tmp-ctx-selftest/` (an empty transcript, a second transcript, and a
dangling symlink) and the cwd `/tmp/ctx/selftest`.

---

## 08:33 — FINDING 3 first, because I am the test case

The brief could not reproduce the end-to-end failure and said so. I could.

Binary evidence, two versions (the brief checked 2.1.241; `$CLAUDE_CODE_EXECPATH` says the
binary actually running is **2.1.240**, so I checked both):

```
function h1r(e){return e.replace(/[^a-zA-Z0-9]/g,"-")}
function qY(e){let t=h1r(e);if(t.length<=Pae)return t;return `${t.slice(0,Pae)}-${lX_(e)}`}
```

Per character, confirmed in both. **New, not in the brief:** there is a truncation branch —
`Pae = 200` — past which the binary appends a hash of the cwd.

Ground-truth attempt: all 12 project dirs on this machine map identically under both the
per-char and the run-collapsing rule, so the existing corpus cannot discriminate. Corpus-zero
is not evidence.

So I ran the **real binary** with cwd = this worktree (`claude -p`, claude-env unset,
timeout 120). It created:

```
-home-bryan-maclee-scrmlMaster-scrml--claude-worktrees-agent-a95f724eca8376c58
                                    ^^ DOUBLE dash, from "/.claude/"
```

Then, from that same cwd, with the transcript sitting right there:

```
$ bun scripts/ctx.ts --list
ctx — no sessions found for /home/.../worktrees/agent-a95f724eca8376c58
EXIT=2
```

**REPRODUCED end-to-end**, by the binary rather than by my reading of its minified source.

Fix: match per character. For a slug over 200 chars the binary's hash is deliberately NOT
reproduced — guessing it would be the hollow-gate shape the file's own header warns about —
so it prefix-scans and refuses to choose when the match is ambiguous.

---

## 08:36 — FINDING 1, and the decision the brief asked me to record

`indep-count.ts` on two frozen transcripts:

| | records | messages | output | thinking |
|---|---|---|---|---|
| 352b3e67 | 546 | 270 | 618,885 -> 274,412 | 272,747 -> 102,160 |
| c20a4934 | 742 | 351 | 763,930 -> 326,311 | 295,396 -> 102,679 |

Premises I refused to relay, measured instead:

- **usage identical within a group?** 0 divergences in 1,288 records. Yes.
- **does every assistant record carry `message.id`?** 0 missing. Still coded a fallback.
- **is the headline invariant?** last record == last of last group, on both. Yes.

### records vs messages for the attribution walk — DECIDED: messages, boundary = FIRST record

The brief asked me to decide deliberately and say why.

Walking records, intra-group pairs have `growth == 0` (identical usage), so `prevOut == 0`,
`rest == 0`, and they contribute nothing. The productive pair is always
(last record of message k-1, first record of message k).

I walk messages and take **message k's FIRST record index** as the turn boundary:

- For a **contiguous** group the between-set is *identical* to the old one — the extra records
  swept in are `type === "assistant"` and were already filtered out. Proven, not assumed:
  `residentOutput` is unchanged on **79/79** transcripts.
- For a **non-contiguous** group it *recovers* entries that used to be attributed to nothing.
  10 such gaps in 352b3e67, each holding one `user` record of real size (17,041 / 12,786 /
  3,030 / 704 chars). Under the record walk those fell in a zero-growth pair and vanished.
- Using first-indices makes the spans **tile** the transcript — consecutive spans share a
  boundary that is itself an assistant record, so nothing is dropped and nothing is
  double-counted.

The headline is deliberately still read off the **last RECORD**, never off a group, so it
cannot drift if the identical-usage assumption ever stops holding.

### the conclusion was worse than the number

`residentOutput` was already right, so the inflated total produced a confident false claim.
And deduping alone was **not enough** — the residual is also inflated by the final turn's
output, which no later request has carried yet:

```
BEFORE  ⚑ of 618,885 tokens emitted, only ~273,273 resident (~345,612 not carried forward
          — arithmetically consistent with thinking blocks being dropped)
DEDUPE  ⚑ of 274,412 tokens emitted, only ~273,273 resident (~1,139 not carried forward …)
                                                              ^^^^^ == lastOutput exactly
FINAL   (silent — true residual is 0)
```

Measured across 77 transcripts after subtracting the pending final turn: **56 residual to
exactly 0**, none negative, and the only 2 over 1,000 are the 2 that hit a compaction. The
"thinking blocks being dropped" narrative was 100% an artifact. The line now reports the
residual, attaches no mechanism, and names compaction when `reclaimed > 0`.

---

## 08:38 — FINDINGS 2, 4-8: what reproduced, and one number that did not

- **F2 REPRODUCED**, and worse than reported. `--window abc` -> `NaN%` at exit 0 and
  `--window 0` -> `Infinity%` at exit 0, both as the brief said. Beyond that: `--window -5`
  -> `-16078420.0%`; **`--window 1e9x` -> a window of 1** because `parseInt` prefix-parses
  (so `--window 1M` and `--window 200_000` silently become 1 and 200) — quieter and therefore
  nastier than `NaN`; `--window` with nothing after it silently falls back to the default;
  `--turns 0` silently means 20 via `0 || 20`. Eleven invocations exited 0 with garbage.
- **F4 REPRODUCED, one reported figure CORRECTED.** `attachment` records carry no `message`,
  so 744 of 1,037 non-assistant entries scored zero. `agent_listing_delta` 27.3 KB (reported
  27.6) and `skill_listing` 9.9 KB (reported 10.3) both hold. **`total_tokens_reminder` is
  20.6 KB across 232 records, not 132 KB** — that figure counted the whole JSONL record, i.e.
  ~500 bytes of envelope (`uuid`, `timestamp`, `cwd`, `gitBranch`, `version`) per record.
  The envelope is persistence metadata and never enters the context window, so the fix weighs
  `rec.attachment` only. Deliberately **not** extended to `mode` / `last-prompt` / `atis-latch`
  / `pr-link` / `ai-title` / `queue-operation` / `file-history-*`: those are Claude Code
  bookkeeping, they are not sent to the model, and giving them weight would move real tokens
  onto rows that cost nothing.
- **F5 REPRODUCED.** "may be a sidechain" names a hazard that cannot occur: across all 81
  transcripts there are **0 sidechain records and 0 all-sidechain files**, and `load()`
  filters them anyway. The live hazard is newest-by-mtime under concurrent sessions — up to
  4 sessions touched this project dir in one day. Warning now names it, on stderr so `--json`
  stdout stays parseable.
- **F6 REPRODUCED as a complexity claim, NOT as a cost.** `--breakdown --top --turns` on the
  four largest transcripts (5.4-5.6 MB): 103 / 94 / 95 / 97 ms before, unchanged after. Fixed
  anyway — with a one-pass span partition, not a hand-rolled cursor inside the loop — because
  the walk was being rewritten for F1 regardless. Recorded honestly: this bought nothing
  measurable.
- **F7 REPRODUCED on real data.** Scanned all 77 sessions; 3 have a reclaim. Worst is
  `570009d2`: 71,174 reclaimed, `--breakdown` reports **~851,117 attributed of 780,155
  occupied** — 9.1% over, and every per-source share is a slice of a partly-evicted superset.
  **Not rescaled**: the transcript does not record WHICH sources were evicted, so a
  proportional shrink would invent a distribution nobody measured. `--breakdown` now states
  the discrepancy, its size and its cause.
- **F8 REPRODUCED.** Dangling transcript in the project dir -> uncaught `ENOENT` stack trace,
  **exit 1** (a code the header does not document), killing `--list` *and* the default path.
  Both stats guarded; unreadable files are skipped.

Commit `9a83c85f`. Gate: 29250 pass / 0 fail.

---

## 08:52 — adversarial self-review #1: latent id-reuse hazard

My own grouping keyed `message.id` across the whole file. If an id were ever reused
non-consecutively — a forked or resumed session, a format change — `last` would jump to a
far-later record and the group would take the wrong usage, silently corrupting turns, output
and the turn boundary. Grouping by **consecutive run** cannot do that.

Measured both strategies over all 79 transcripts: **0 id reuses, 0 disagreements** in group
boundaries or usage. Behaviour-neutral today, strictly safer tomorrow; when a run cannot
merge it degrades to record-level behaviour, which is the conservative direction. Switched.

Proof of neutrality: every frozen output in the 23-invocation matrix byte-identical to the
previous commit; only the live, still-growing transcript differs. Commit `5e727322`.

---

## 08:58 — adversarial self-review #2: the worse half of Finding 2

Finding 2's literal text leaves the more dangerous hole open. `--window abc` printed `NaN%`,
which nobody would quote. These printed a clean, plausible, **wrong** number at exit 0:

| invocation | before | truth |
|---|---|---|
| `-window 200000` (one dash) | `80.4% used` | `402.0%` |
| `--window=200000` (equals) | `80.4% used` | `402.0%` |
| `--breakdwon` | headline only, no complaint | — |
| stray positional | ignored | — |

Both typos are ordinary muscle memory, and `pa-base v2.16 §2` is about to make this tool's
numbers a contract instrument. Went past the brief's literal text and closed it — flagged as
a scope call rather than done quietly. All four exit 2 and name the argument; the full valid
matrix is byte-identical (0 diffs). Commit `cba52fe1`.

---

## 09:05 — verification summary

| check | result |
|---|---|
| headline (`occupied`/`pct`/`remaining`/`prompt`/`lastOutput`/`window`/`windowBasis`/`sessionId`/`transcript`/`resolvedBy`) byte-identical, 79 transcripts | **0 mismatches** |
| `--json` parses, top-level + `exact` key sets unchanged, 79 transcripts | **0 changes** |
| exit-code changes on valid invocations, 79 transcripts | **0** |
| deduped totals vs an independently written counter, 79 transcripts | **0 mismatches** |
| `residentOutput` unchanged (proves the attribution walk did not move) | **79/79** |
| `attributedTotal` drift (`Math.round` on the proportional split) | bounded ±6 tokens |
| bite proofs exiting 2 | 13 in the matrix + 4 unrecognised-argument = **17** |
| `--list` / `--breakdown` / `--top` / `--turns` / `--json` / no-args | all exit 0 |
| pre-commit gate | 29250 pass · 0 fail · 86 skip · 1 todo (unchanged) |

---

## 09:07 — fixture teardown

Dry-run listing before removal, per the standing cleanup rule. Created by this dispatch and
removed:

- `~/.claude/projects/-tmp-ctx-selftest/` (3 files: empty transcript, copied transcript,
  dangling symlink)
- `/tmp/ctx/selftest/` (empty dir)

**Left in place, deliberately:**
`~/.claude/projects/-home-bryan-maclee-scrmlMaster-scrml--claude-worktrees-agent-a95f724eca8376c58/`
— that is a genuine session transcript written by the real binary during the Finding 3 oracle
run, not a fixture I fabricated. It is also the only artifact on this machine that
discriminates the two slug rules, so it is worth keeping until PR #708 lands.

---

## DEFERRED — surfaced, not closed

1. **`--transcript <path>`.** The only way to exercise the empty-transcript branch today is to
   plant a file under `~/.claude/projects/`. A direct-path flag would make the tool
   self-testable without touching the operator's data. Not added: the brief said correctness
   beats features, and this is a feature.
2. **The >200-char slug hash is unreproduced.** Prefix-scan + refuse-on-ambiguity is honest
   but is not the binary's rule. No cwd on this machine is near 200 chars; a deeply nested
   worktree could get there.
3. **`attributedTotal` is not exposed in `--json`.** A consumer cannot see the F7 over-count
   programmatically — it is only in the human `--breakdown`. Not added, to keep the key set
   unchanged as the brief required.
4. **The estimator still splits by serialized character length.** Characters are not tokens,
   and the ratio differs sharply between prose, JSON and code. Every figure is marked `~` and
   the header is explicit, so this is a known boundary rather than a defect — but if
   `--breakdown` ever starts underwriting a rule the way `occupied` now does, it needs a
   better weight than `chars`.
5. **No automated test covers `ctx.ts`.** Everything above was verified by throwaway scripts in
   the scratchpad, which die with this dispatch. Given `pa-base v2.16 §2`, a permanent
   regression test asserting headline invariance and the bite matrix would be worth its cost.
