# scrml — Session 380 (peter · Windows) — WRAP

**Date:** 2026-08-27. Booted `/boot` Profile A as successor to S379-bryan. A very large session: a
stranded-PR recovery + 12 PRs landed + a 3-agent dog-food sweep that found 4 fresh silent-wrong bugs.

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ STRANDED: S379-bryan's wrap is unmerged — RECOVER IT
`origin/wrap/s379` is **17 commits ahead of main, never merged** (a WIP wrap: `wrap(s379) wip: bank
[1880]-[1881]…`). The S379 board (`../scrml-support/handOffs/active-sessions/S379.md`) still says LIVE
but has not updated since 05:14, and there has been ZERO main activity from bryan since #725 — every
commit on main since `0ff7942d` is S380-peter's. This is the [[feedback-detect-stranded-unwrapped-
session-at-boot]] pattern. **bryan's S379 hand-off/delta-log updates live only on that branch** — my
S380 wrap advanced main's hand-off from the S378 base, so wrap/s379 will conflict when recovered.
Recovering it (3-way merge of hand-off/delta-log/known-gaps, re-gate, land) is a bryan-lane task; I
did NOT merge another PA's wrap (single-writer discipline).

### 2. Review floor: 2 OWED — both bryan's S379 lane
`#723` (wrap/s378 docs) and `#725` (gaps S379 adopter #724). All 12 of S380-peter's are recorded.

### 3. Open follow-ons filed this session
- **`g-snippet-param-in-attr-interp-and-each-raw-unsubstituted`** (LOW, PRE-EXISTING) — a snippet param
  in a string-literal-attr `${}` or an each/match raw field isn't substituted. The convergent fix is
  the "converge snippet-param onto the component-prop substitution substrate" direction (group 4).
- **`g-bare-ref-attr-value-emits-literal-not-binding`** (HIGH) — ROUTED to bryan, BLOCKED on the #81
  writer-ownership ruling (per an explicit in-source comment at emit-html.ts:3200-3205). In the
  bryan-queue with fork directions.
- **The server-only credential-leak family** (HIGH, ruling-pending-bryan) — RE-CONFIRMED LIVE by the
  S380 staleness sweep (hashPassword/argon2id/API_SECRET → browser; `${@session.userId}` in `?{}` →
  client body). Worth a dedicated confidentiality-envelope pass. In the bryan-queue.

### 4. Maps — refresh OWED
S380 touched significant codegen surface (emit-each · emit-match · emit-variant-guard · component-
expander · emit-html · commands/build.js · commands/dev.js). `.claude/maps/` was NOT refreshed at wrap
(context economy at a long session's end). A `project-mapper` incremental over these is owed next boot.

## 🔭 DURABLE METHOD FINDINGS
- **S239 caught a real issue on EVERY code fix this session** (7 code PRs). The adversarial pass is
  load-bearing, not ceremony: stale-test gate-blockers, self-built corruptions, self-introduced
  regressions (an `_armCellName` null-out; an over-render), a latent nested-each class gap — and once
  a **reviewer false-positive**. The "reproduce a regression on the pre-change base" rule fired in BOTH
  directions: it caught my own bugs AND disproved a reviewer's "this is a regression" premise (#731,
  #735). Verify-on-base is the arbiter, not the review's assertion.
- **Verify-before-build caught a lane misroute:** Bug 3 (bare `attr=@cell`) looked like a clean
  spec-settled peter fix, but the emit-html source explicitly gates it on the #81 ruling → bryan-lane.
- **A `git checkout HEAD -- <file>` clobbered an UNCOMMITTED fix** mid-session (the each fix), because
  a baseline-compare reverted the working tree to the last commit. Caught immediately (the test failed),
  re-applied, and COMMITTED before continuing. [[feedback-isolate-agents-that-do-git-ops-in-main-tree]]
  extends to your OWN git ops: commit a fix before any `git checkout` that touches its file.
- **The pre-commit hook let stale unit tests through** on #726 (the S239 pass caught them) — do not
  treat a green pre-commit as proof; the cloud gate + S239 are the real gates.

## 🧷 STATE
- **main** `cd6bfda7`. Cloud `gate` GREEN. FACTS current. Working tree clean (scratchpad only).
- **12 PRs landed** (S380-peter): #726 g-string-prop · #728 §52.13 auth-doc (security) · #730
  session-SQL verify-close · #731 parametric-snippet-param AST · #732 derived-match · #733
  snippet-is-some (flagship ex.12) · #735 per-item-match-reconcile · #729/#734/#736 review markers.
  Recovery: #722 (stranded S378-peter drain) recovered → #726, #722 CLOSED superseded.
- **Dog-food sweep** (3 agents, happy-dom, shipped runtime): Bug 2→#732, Bug 4→#733, Bug 1→#735, Bug 3
  routed to bryan (#81). All 4 PA-executed + re-verified.
- Bryan-queue (`../scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`): 2 S380 addenda.
- Worktree `scrml-pinned [app-pinned]` present — NOT this session's; left in place.

---

# scrml — Session 378 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-26/27. Booted `/boot` Profile A, SOLO (S376-bryan and S377-peter both wrapped
beneath). Boot **33.4%** — down from S375's 43.0%; the ratified rotation is holding.

**The framing, because it reorders the rest: this session's subject was VERIFICATION ITSELF.** Two
instruments that underwrite ratified rules were wrong. A probe had been writing a file into the repo
root every boot for weeks and the evidence had already been mis-diagnosed. My own pins were
mutation-proved hollow. And of the ~30 adversarial findings raised against my work, **the majority
were in changes I made while fixing the previous round.** The compiler work landed or is one round
from landing; what is worth carrying is the method.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ RULINGS 2 + 3 ARE BUILT AND VERIFIED BUT **NOT LANDED** — one fix round was in flight at wrap

Branch **`worktree-agent-a91805a13f51a8596`**, worktree RETAINED. **FINAL SHA `28ce5b90`**, tree
clean, gate 29368 pass / 0 fail, corpus differential **0 of 7380 for the third round running**,
migration UNCHANGED (no STOP). Four fix rounds ran; all 15 findings closed.

**⚑ WHY IT IS NOT LANDED, and this is a deliberate call, not an unfinished one.** The S239 pass
found 5 findings in EACH of three rounds, and **four of round 3's five were in ruling 2's bare-call
recognizer**. The contract requires a re-review after a fix round; I did not have the budget for a
fourth pass PLUS a safe wrap, and landing without it — on precisely the surface that has produced
defects every single round — is the green-report failure this session spent the day documenting.
The dispatch reached the same read independently and said so: *"Three rounds have each found real
defects in this one recognizer. I would not assume a fourth finds nothing... the ruling-3
control-flow work is solid (clean three rounds) and the bare-call recognizer is the part that has
needed every round."*

**NEXT SESSION: run ONE S239 pass on `28ce5b90`. If clean, land. If it finds more in the bare-call
recognizer again, SPLIT — land ruling 3 + the LOW rider, hold the bare-call gate as its own arc.**

**What is verified BY MY OWN EXECUTION** (not relayed) on `52d94959` and on a merged tree:
| probe | result |
|---|---|
| `< state>` + `if (1) { }` (deprecated opener) | caught, exit 1 |
| `Updated(2026) — release notes are below.` (em dash, NON-parseable) | exit 0 — prose renders |
| `Total(5); five in all` | exit 0 — prose renders |
| `notify("Done :)")` | caught, exit 1 |
| `loadData(); initApp()` | caught, exit 1 |
| `Updated(2026) release notes are below.` | exit 0 — prose still renders |
| glob `src/*.js` + `const @total = 1` | `W-CONST-AT-DEPRECATED` fires again (my regression reverted) |

**Ruling 3's control-flow work has been verified CLEAN across three review rounds.** Ruling 2's
bare-call recognizer has produced findings in every round — **4 of round 3's 5 were in it.** If the
fourth round did not converge, **the split is the move: land ruling 3 + the LOW rider, hold the
bare-call gate.** I did not do it here only because the surgery is real and I was near the floor.

**⚑ THE LANDING MECHANIC IS NOT A FILE-DELTA.** The branch was cut at `a1c14878`, BEFORE #721
merged, so a raw diff shows `scripts/review-debt.ts`, `master-list.md`, `docs/pr-reviews.md` and
`compiler/tests/unit/review-debt-marker.test.js` as **REVERSALS**. A wholesale pull silently
clobbers #721. VERIFIED: those four are stale views (the agent never touched them);
`docs/known-gaps.md` IS touched by both and needs the 3-way. `git merge-tree origin/main <branch>`
exits **0** — use a real merge, then re-verify the merged tree, because a clean 3-way proves
textual disjointness and not semantics.

### 2. ⚠️ TWO OPERATOR DECISIONS OWED, both now MEASURED so they are decidable

- **The one-`<div>` bypass** (`g-state-block-statement-form-misses-a-wrapped-statement`, MED).
  **Corpus population: ZERO** — full corpus emit captured (1906 sources / 7380 artifacts / 1839
  HTML), swept for a lifecycle statement shipping as page text, bite-proven against a known
  positive. So closing it is newly-rejecting with a measured-zero migration, and ruling 1's own
  wording ("logic at a `<db>`/state-block locus is REFUSED") already reaches it — conformance, not
  a widening. **Bound: the sweep covers the 1839 sources that compiled and emitted.**
- **The F2 prose bound** — `Updated(2026)` ALONE on a line still fires `E-CALL-NOT-IN-LOGIC-CONTEXT`.
  Recorded in the §34 row and pinned, but **unratified**. It is a judgement call about how much
  prose the gate may bill the adopter for.

### 3. ⚑ `E-BARE-CALL` DOES NOT EXIST — and a ratified ruling names it

The S375 ruling text says *"conformance cases asserting `E-BARE-CALL` fires."* **That code has never
existed anywhere** — not on main, not in the held build. The real code is
`E-CALL-NOT-IN-LOGIC-CONTEXT`. Three sessions relayed the name without one grep, and my dispatch
brief cited *"PA-VERIFIED: `E-BARE-CALL` does not exist on main — grep returns 0"* as evidence the
gate was unlanded. **I grepped a name that never existed and read the zero as a finding.** The
conclusion was accidentally true; the evidence was worthless. **A ratified ruling can name a code
that does not exist, and nothing in the pipeline checks that.**

### 4. HELD / OPEN

| | state |
|---|---|
| rulings branch `worktree-agent-a91805a13f51a8596` | **retain** — built, verified, fix round in flight |
| each-alias | still parked at `s375-r7-reviewed`, untouched this session |
| `#655` worktree-sweep method | **gate green, not draft, its owed bite proof is DONE** (below) — recommend landing |
| `#640` `#559` `#501` + 3 DRAFTs | untouched, pre-existing |
| worktrees | 19 sweepable / 55 genuinely unlanded — **nothing swept** |

---

## 🔭 DURABLE FINDINGS

### A. The review floor could not see its own most thorough records
`review-debt.ts` parsed markers with `[^>]*?`, a class that EXCLUDES `>`. A marker whose `probe=`
text contained a `>` never matched and its PR read as UNRECORDED — and on this project the probe
text routinely quotes scrml tags (`<db>`, `<each>`) and position arrows (`5:1 -> 5:42`), so **the
miss rate rose with how thorough the review was.** Landed as #721. Second consecutive session where
the instrument underwriting a ratified rule was itself wrong (`ctx.ts` at S376).

### B. ⭐⭐ Fifteen findings across five rounds on #721, and EVERY ONE was in the collateral
The primary fix was clean from round 1. Rounds 2-5 found defects only in the four *sibling* parsers
I widened alongside it — and twice they were the **mirror** of the fix before (`state.ts` went
greedy-captures-LAST, then lazy-captures-FIRST, the latter beaten by a `prov=rationale:…status=…`
narrative, which is the house style). **Round 5 was decisive: my sibling pins were MUTATION-PROVED
HOLLOW** — they tested regex literals and reimplementations declared in the test file, so reverting
all three fixes left the suite 26/26 green. **I reverted all four widenings out of the PR** and
re-filed them, because there was no mechanism by which round 6 would have been the last.
**The generalisable rule: a test that stays green when you revert the code under test is worse than
no test, because it reads as coverage and gets argued from.**

### C. ⭐⭐ Converge-don't-enumerate is a rule about shared DOMAIN, not shared code shape
I ordered `maskCommentRegions` folded into a mirror scanner, citing its own banner *"THERE SHALL BE
ONE OF THESE, NOT TWO."* It caused a **regression**: a `/*` inside `src/*.js` opens a block comment
that never closes and silences the lint for the rest of the body. I then compounded it by ruling
that the `<db>` twin should KEEP its masking because that domain was "validated" — **also wrong**;
`<db>` bodies hold string VALUES, and a string value holds globs, paths, URLs, regexes. Both
reverted. **Corrected rule, recorded at both loci: `maskCommentRegions` is safe only where the
scanned text cannot contain a string literal — neither scanner qualifies.** And: closing a
false-FIRE by importing a false-SILENCE trades a visible wrong warning for an invisible missing
one; for a lint, silence is the worse direction.

### D. ⭐ A corpus-derived migration zero bounds the CORPUS, not the adopter
Ruling 2's gate hard-errored on `Updated(2026) release notes are below.` — prose that renders on
main. The migration had measured **zero**, correctly. **The corpus is 100% LLM-authored (S368), so
it cannot contain the shape a human writing release notes produces**, and bryan is the one human
writing scrml. The dispatch wrote that distinction into the §34 row, the source comment, the
conformance rationale and its progress.md unprompted — the recurrence is the cost, not the fix.

### E. A prose DONE-PROBE was writing to the repo root every boot, and S375 mis-diagnosed the evidence
`threads.ts` executes each `DONE-PROBE:` as shell. One was prose containing `returns > 0`; the shell
read `> 0` as a redirect and wrote `compiler/SPEC.md:0` into a file named `0`. **The S375 misses list
records that stray `./0` being swept into a pushed PR and files it as a pathspec failure.** It was
not a stray — a tracked instrument created it every session and nobody asked which one. Fourth prose
DONE-PROBE (S376 fixed three) and the first with a SIDE EFFECT. A **fifth** is live in
`match-scrutinee-arity-diagnostic`; I annotated it rather than closing it, because the obvious probe
would have flipped that thread to a FALSE DONE (I drafted it, ran it, reverted it).

### F. #655 already carried the worktree-sweep method, and I re-derived it from scratch first
The hand-off asked for a cleanup arc, so I built one — and produced two probes that were BOTH the
wrong referent in sequence (`rev-list` misses squash merges; `gh pr list --head` misses everything
landed by the file-delta protocol). **PR #655, open since 08-23, is titled "both obvious tests are
wrong under squash-merge."** `gh pr list` is in the boot report and I read it as a queue of in-flight
landings rather than as a place prior art lives. **An open PR is a knowledge store.** I did complete
the bite proof #655 named as its remaining work — both directions — and ran the proven probe:
**19 sweepable / 55 genuinely unlanded of 74**, 4.2 GB of 9.3 GB reclaimable. NOTHING SWEPT.

---

## ⚑ MISSES (mine)

1. **★ I widened four instruments I could not verify, and wrote pins that could not fail.** Five
   rounds, fifteen findings, all collateral. Reverted.
2. **★ I ordered a fold-in that caused a regression, then ruled the twin safe on a domain
   distinction that does not exist.** Both reverted; the corrected rule is recorded at both loci.
3. **★ I cited a grep for `E-BARE-CALL` returning 0 as PA-VERIFIED evidence** — a name that has
   never existed. Vacuous probe, inside a brief that warns about vacuous probes.
4. **★ I relayed "6 pre-existing integration flakies" from a hand-off; the true figure is 53-55**,
   and it moved by 2 between two runs of the same unmodified tree. The dispatch discarded my number
   and used set-comparison, which is the correct instrument.
5. **★ The zsh word-splitting trap, third instance in two sessions, with the entry loaded** — an
   unquoted `$s` made `bun "scripts/threads.ts --open"` one bogus filename, reported **`clean`** on
   the actual culprit, and sent me ~15 minutes into an innocent file.
6. **★ I introduced a Windows break (`new URL().pathname`) in the very fix that made a test honest.**
   The `windows` lane caught it. Making the test honest is what made the latent break observable.

---

## 🧷 STATE

- **main** `4e561434` (#721). Coherence 0/0 both repos. `state.ts --check` passes BOTH generated
  sections — `recent-sessions` included, for the first time this session.
- **Gaps: HIGH 59 · MED 179 · LOW 80 · Nominal 7.** Filed this session:
  `g-flograph-gap-re-drops-281-of-818-gap-markers` (**HIGH** — 281 of 818 dropped; the script prints
  *"must match state.ts: HIGH open=9"* against a true 58, off by 84%) ·
  `g-marker-parsers-share-an-untested-regex-class` (MED, the arc) ·
  `g-threads-executes-prose-done-probes-with-side-effects` (MED, resolved).
- **Debts:** review floor **0** (320/320) · issue-debt 0 · dpa 0 unrun, **18 ADVISORY awaiting
  bryan** — that is the real backlog on this project, and it is decisions, not capacity.
- **Concurrent:** SOLO throughout.
- **RELAYED-UNVERIFIED, do not propagate:** the dispatch reported that bare control flow in a
  **whitespace-form engine body** still ships as page text. **I could not reproduce it** on two
  shapes — one errored for unrelated reasons, the other correctly fired `E-CONTROL-FLOW-IN-MARKUP`.
  Check before filing.
- **Mechanical stream:** delta-log `[1823]`-`[1840]`. Do not re-derive from this hand-off what the
  delta-log and changelog carry.


# scrml — Session 376 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-26. Booted `/boot` Profile A onto a **stranded S375 wrap**, as SUCCESSOR to a LIVE
S375-peter (who then wrapped, ran S377, and wrapped again beneath this session).

**The framing, because it reorders the rest: two instruments this project relies on were reporting
confidently false things, and my own probes failed the same way eight times in one day.** The
diagnostic that landed is ordinary. What is worth carrying is that a ratified rule's probe was
printing the opposite of its own data, and that six memory entries written to prevent exactly my
failure mode did not fire.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ ONE OPERATOR DECISION, NEW — the gate has a one-`<div>` bypass

`E-STATE-BLOCK-STATEMENT-FORM` landed (#718) and scans **direct text children only**. PA-reproduced:

```scrml
<db src="sqlite:./app.db" tables="items">
  <div>
on mount { loadDashboard() }
  </div>
</db>
```
→ **exit 0, zero diagnostics**, ships into the HTML as literal page text. The original defect, one
nesting level deeper. Filed `g-state-block-statement-form-misses-a-wrapped-statement` (MED), pinned
by a known-open test.

**Why it is a RULING and not a patch:** S375 ruling 1 says *logic at a `<db>`/state-block locus is
REFUSED*, and a statement inside a `<div>` inside a `<db>` body **is** at that locus — so widening the
scan is arguably **conformance with the ruling already made**, not a new widening. Against that: it is
newly-rejecting with an **UNMEASURED** migration (the 1-file population was measured over direct
children only). ⚑ **Measure the nested population FROM THE COMPILER before scoping** — a text grep
finds `on mount` in 39 corpus files and that is the wrong referent, exactly as it was the first time.

### 2. RULINGS 2 AND 3 — ratified, unbuilt, still SEQUENCED on `ast-builder.js`

Unchanged from S375 except that they are now **de-risked**:
`docs/changes/ruling2-bare-call-landing-2026-08-26/DE-RISK.md` carries the measured base drift (the
held build `7d5fe573` is 42 commits behind), per-file OCC verdicts (`ast-builder.js` has **2**
intervening writes → real 3-way merge, NOT a wholesale pull; `symbol-table.ts` has 0 → wholesale-safe),
and the prediction that the merge is CLEAN because the hunks are disjoint (main touched ~L3655/~L13600,
the build touches ~L42/~L756/~L1837). **That is a prediction from hunk offsets, not a performed merge.**

⚑ A third item now wants to ride the same file: `g-state-block-bare-write-scan-has-no-comment-state`
(LOW) — the sibling scanner false-fires on a commented-out `@count = 0`. Few lines, same file. **Do
not dispatch it standalone.**

### 3. ⚠️ THE EACH-ALIAS ARC IS STILL PARKED — untouched this session

Frozen at tag `s375-r7-reviewed` (`ae42e120`). The convergent direction is **still unruled**. Its
worktree is RETAINED. A future round still owes a real 3-way merge against #710.

### 4. PETER'S TWO ROUTED FINDINGS — one is smaller than it was routed as

`g-if-arm-bare-markup-branch-silently-dropped` (HIGH) — PA-reproduced AND re-diagnosed: `{ "Yes" }`
works, `{ lift <p>Yes</p> }` works, `{ <p>Yes</p> }` drops silently. The discriminator is the branch's
**VALUE TYPE**, so it is the markup instance of the **already-ratified S371 limb (b)** amendment, not
the fresh fork it was routed as. It is the FOURTH divergence in that area — the §17.6 amendment should
state the rule once over branch VALUES rather than gain a clause per witnessed shape.
The `for` half is **RELAYED-UNVERIFIED** and must be re-derived in a DOM. Return-leg delivered.

`g-ast-markup-text-interp-adjacent-space-dropped` (MED) — RELAYED, not reproduced by me. Has four
pre-existing RED browser tests. A whitespace-MODEL ruling for bryan.

### 5. HELD / OPEN

| | state |
|---|---|
| each-alias | parked, worktree retained |
| ruling-1 worktree `a5d573c6f9c8f078c` | superseded by #718 — **removable next session** |
| `#655` `#640` `#559` `#501` + 3 DRAFTs | untouched, pre-existing |
| 91 worktrees under `.claude/worktrees/` | **cross-session debt**, surfaced not swept — see 6b below |

---

## 🔭 DURABLE FINDINGS

### A. A ratified rule's own probe was printing the opposite of the truth
`pa-base v2.16` §2 names `bun scripts/ctx.ts` as the budget probe. It summed `output_tokens` across
JSONL RECORDS, but Claude Code writes one assistant message as N records each carrying an **identical**
`message.usage` — so totals ran 2x. `residentOutput` was computed CORRECTLY, so the guard compared a
right number to a doubled one and printed *"only ~half is still resident … consistent with thinking
blocks being dropped."* **The hedge made it read MORE careful, not less.** True residual: `lastOutput`,
and subtracting it gives exactly 0 on 56 of 77 transcripts. **I relayed that false conclusion to the
operator twice before a review caught it.**

### B. The wrong-referent class, at eight instances in one session — and the six memory entries did not fire
Every one well-formed, every one answering about something adjacent: session-ID *mentions* counted as
narrative *blocks* (nearly filed four false content losses) · two nested-pipeline truncations · a
`grep -oc` counting lines not occurrences · a bite proof that exited 1 on a module-resolution error,
not the condition under test · a diagnostic position read off an ADJACENT diagnostic and asserted about
mine, inside a message correcting someone else's report · **zsh word-splitting, twice, twenty minutes
apart, with the rule loaded** · and during this very wrap, an `awk` that silently dropped 20
detached-HEAD worktrees (caught by cross-checking against a count) and `gh pr checks` rendering a
**CANCELLED** run as `fail`.
Six entries consolidated into `the-probe-answered-a-different-question` at bryan's direction, with the
honest conclusion written into it: **recall is not the control — construction is.**

### C. A fatal gate that argues from a false premise survives review three times
Round 1 fixed a false premise, round 2 fixed a false premise, round 3 fixed three false STATEMENTS —
the domain rationale, the message's claim at `<schema>`, and the framing of the `/*` residual. A
refuse gate reasoning from an untrue sentence is how the wrong scope gets ratified.
⚑ The round-3 dispatch went beyond instruction and **grounded the `<state>` limb by measurement before
writing it** — without that, the "correction" would have shipped a NEW unverified claim.

### D. A repaired probe was hiding a FAIL nobody could see
Three thread-board `DONE-PROBE`s were prose and one was markdown-backticked, so the board reported
ERROR and never evaluated them. Made runnable, the boot-trim probe reports **FAIL** — it measured
`wc -c` of `master-list.md` against a `< 90000` threshold the rotation never targeted (the file is
130,208, the figure S375 recorded as SUCCESS), and `pa-base v2.16` says in terms to budget against the
PROBE's number and never `wc -c`.

---

## ⚑ MISSES (mine)

1. **★ I relayed `ctx.ts`'s false "half your output was dropped" conclusion to the operator TWICE**,
   with a hedge that disclaimed only the mechanism and thereby bought credibility for the number.
2. **★ I claimed finding 1's LINE was wrong, reading `6:1` off an adjacent `I-FN-PROMOTABLE`.** The
   dispatch refuted me by measurement and pinned a test so nobody "fixes" a non-defect.
3. **★ I moved the ref under an in-flight review** — committed twice after launching it. Docs-only, so
   attribution held, but that reasoning is exactly what the rule exists to distrust.
4. **★ My own §34 insertion created a stale SPEC line citation** (`:20072` → `E-CONST-AT-DEPRECATED`)
   in the same session I praised a gate for catching stale citations. Fixed by dropping line numbers
   for code-name + section form.
5. **★ zsh word-splitting, twice, with the rule in memory.** See finding B.
6. **★ My `#709` rotation probe counted session-ID mentions instead of narrative blocks** and would
   have reported four false content losses had I filed it.

---

## 🧷 STATE

- **main** — see the changelog block for the wrap SHA; coherence 0/0 on both repos.
- **Gaps: HIGH 58 · MED 178 · LOW 80 · Nominal 7** (from the `@generated` block; +5 filed this session).
- **Debts:** review floor **0** · issue-debt 0 (both open issues banked as dpa-028/029, ADVISORY,
  awaiting bryan) · dpa 0 unrun.
- **Concurrent:** S375-peter and S377-peter both WRAPPED beneath this session.
- **Worktrees:** 91 under `.claude/worktrees/`. **This is cross-session debt, not mine** — the contract
  says same-session retention, cleaned at wrap, and ~67 predate this session. Surfaced deliberately
  rather than mass-deleted (a `--force` sweep over branches naming other sessions' work is the S257
  sharp edge). **Worth one scoped cleanup arc with a dry-run listing.**
- **Contract amendments this session:** `bun --cwd run` silent no-op; cwd-blind `pkill` as a
  cross-worktree destructive act. Both in `pa-scrml-overlay.md`.
- **Memory:** 108 files → 103; `MEMORY.md` 107 → 102 lines. Undo anchor at `memory/.MEMORY.md.bak`.
- **Mechanical stream:** delta-log entries for this session; do not re-derive from this hand-off what
  the delta-log and changelog carry.

<!-- ============================================================= -->
<!-- hand-off.md — live session state.                              -->
<!--   S377-peter (TOP block) — 1 dog-food fix (#716, word-glued     -->
<!--     ${} in for-lift shipped raw literal) + 2 grammar findings    -->
<!--     ROUTED to bryan's inbox (if/for-arm bare-markup silent-drop -->
<!--     ⚑ intersects RULING-3; interp-adjacent space-drop).          -->
<!--     [1796]-[1798].                                               -->
<!--   S375-peter — 4 dog-food fixes + 7-issue adopter sweep.         -->
<!--     #710 show= · #713+#714 snippets. [1788]-[1795].              -->
<!--   S375-bryan — the context-economics session. TWO OPERATOR       -->
<!--     DECISIONS OWED, both on ruling 1, both cheap. each-alias     -->
<!--     PARKED at tag s375-r7-reviewed. Rulings 2+3 RATIFIED and     -->
<!--     SEQUENCED. Read its PICKUP §1-§3. [1799]-[1810].             -->
<!--   S372-bryan / S374-373-372-peter — prior blocks, unchanged.     -->
<!-- ============================================================= -->

# scrml — Session 377 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-25. Booted `/boot` Profile A as a SUCCESSOR to a LIVE S376-bryan (his lane: the
stranded S375 wrap + ratified-unbuilt rulings + each-alias; disjoint from mine). A **dog-food session**:
build+RUN fresh apps in happy-dom, find silent-wrong render bugs, fix what's in my codegen lane, route
the grammar-shaped ones turnkey.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. TWO grammar findings routed to bryan (his lane; in his inbox + delta [1797])
Delivered to `scrml-support/handOffs/incoming/S377-peter-to-bryan-two-grammar-findings.md` (he's LIVE
on the exact area). NOT peter-lane to fix — they need his ruling:
- **`g-if-for-arm-bare-markup-silently-dropped`** ⚑ intersects his LIVE RULING-3/E-CONTROL-FLOW-IN-MARKUP.
  BARE markup in a `for`/`if`/`else` arm renders NOTHING with ZERO diagnostic; a `<match>` arm with the
  same bare markup renders. Fork: auto-lift (match-consistent) vs diagnose. Traced: emit-lift
  emitIfStmtWithContainer/emitForStmtWithContainer route only lift-expr/for-stmt children.
- **`g-ast-markup-text-interp-adjacent-space-dropped`** — space before `${…}` dropped (`Saved ${@cell}`
  → "Savedhello"). 4 pre-existing reds in g-emit-lift-markup-text-interp.browser.test.js. Traced to the
  shared tokenizer content-reassembly (parseLiftContentParts proven innocent). Whitespace-model call.

### 2. PETER-LANE follow-ons still open (from S375, buildable or dog-food)
- `g-each-peritem-class-call-ref-operator-arg-not-lowered` (LOW) — the `class:` arm carries the same
  call-ref-operator hole #710 fixed for `show=`; converge onto `lowerEachExpr` (execution-confirmed).
- Dog-food a fresh app beats mining the ledger — this session's #716 came from RUNNING code.
  [[feedback-dogfooding-beats-mining-the-ledger]]

### 3. REVIEW FLOOR — 2 OWED (state it, don't skip)
- **#715** (my S375 wrap — MY lane, NOT done this session; a wrap/docs PR) · **#709** (bryan boot-trim, his).

## 🧷 WHAT LANDED (S377-peter) — 1 code PR + this wrap
- **#716** `g-emit-lift-reconcile-prefixed-interp-not-lowered` (dog-food) — a word-char-glued `${…}` in
  a `for…lift` reconcile item (`P${it.x}`) shipped the RAW LITERAL to the DOM. Split+lower live-keyed,
  mirroring the sibling bare-expr reconcile branch. S239-reviewed (fix confirmed correct + well-scoped);
  claim narrowed to word-glued only; the space-drop residual filed to bryan; helper-extraction declined.

## ⚑ MISSES / lessons (S377)
- **The review's real catch was an OVERCLAIM, not a bug** — my commit/comment framed the fix as closing
  "literal-prefixed ${…}" generally; the whitespace-adjacent variant is a SEPARATE upstream root. Narrowed
  the claim + filed the residual rather than letting it ship as "class closed". [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **Two clean apps beat a forced fix** — match/nested-list/attr/bind probes all passed; the disciplined
  move was to route the two grammar-shaped findings, not hack a fix outside my lane. [[feedback-stay-in-adopter-lane-not-grammar-decisions]]

## 🧷 STATE (S377 close)
- **main** `a545bbe7` (#716); coherence 0/0; both repos clean (only scratchpad/); no branches/worktrees.
- **Suite:** #716 cloud-`gate` GREEN; unit+conformance **19427 pass / 47 skip / 0 fail**. Browser tier
  (non-required) 49 pre-existing fails, baseline-diff 0-new/0-fixed. Windows/tracking = known non-required.
- **Review floor:** #716 recorded (finding, self-S239-reviewed); **#715 + #709 OWED**.
- **Sibling:** S376-bryan LIVE (ast-builder/docs + routed items). Disjoint; the 2 findings delivered to his inbox.
- **Maps:** surgical emit-lift text-child edit, no new modules/entrypoints → maps unchanged.

# scrml — Session 375 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-25. Booted `/boot` Profile A as a SUCCESSOR to a LIVE S375-bryan (his boot-trim #709
landed; disjoint lane). A **dog-food session**: build+RUN fresh apps in happy-dom, find silent-wrong
render bugs, fix them, harden each through the mandatory S239 review.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. The snippet arc is COMPLETE on the default pipeline; TWO items routed to bryan
`g-render-snippet-slot-renders-empty` default-pipeline limb RESOLVED (#713) + arity-tolerant fills (#714).
All snippet fill forms render, no crashes. **Owed by bryan (his road-B / semantics lane, both filed):**
- **`translate-expr.js:296`** — the NATIVE-parser Render-discard (empty escape-hatch). `--parser=scrml-native`
  still renders snippets empty. This is the same undefined-`__scrml_render__` crash substrate as bryan's
  open `g-render-outside-component-emits-undefined-fn` HIGH — converging, one substrate.
- **`g-parametric-snippet-param-substitution-is-textual-not-ast`** (LOW) — the param substitution is a
  `\bparam\b` string-replace (matches body prose; breaks on `$`-prefixed param). Pre-existing.
- **Open §16.6 semantics Q for bryan:** should a snippet-fill ARITY MISMATCH (`(v)=>` on a non-parametric
  prop) be a COMPILE DIAGNOSTIC? #714 renders it empty (no crash) pending his ruling.

### 2. PETER-LANE follow-ons still open (buildable, or dog-food)
- `g-each-peritem-class-call-ref-operator-arg-not-lowered` (LOW) — the `class:` arm carries the same
  call-ref-operator hole #710 fixed for `show=`; converge it onto `lowerEachExpr` (execution-confirmed).
- The durable: **dog-food a fresh app** beats mining the ledger — all 4 fixes this session came from
  running code. [[feedback-dogfooding-beats-mining-the-ledger]]

### 3. ADOPTER BACKLOG CLEARED — assetManagement's 9 `docs/scrml-issues/` repros are 7 stale-resolved,
1 WAI (if-in-each frozen-by-design + warns), 1 out-of-lane (dev-server tooling). Their FINDINGS.md
pin-bump prerequisites are satisfiable. Worth a note to the adopter's PA so they can close the backlog.

## 🧷 WHAT LANDED (S375-peter) — 4 code PRs + this wrap
- **#710** `g-each-peritem-show-emits-literal-attribute` (MED) — `show=` inside `<each>` toggles visibility.
- **#713** `g-render-snippet-slot-renders-empty` default-pipeline limb (HIGH-adjacent) — parametric snippets
  render (flagship example 12 fixed). Root re-derived (native reparse discards Render).
- **#714** arity-tolerant snippet lambda fills — closed a crash regression #713 introduced.
- Adopter staleness sweep (no PR — verification): 7/9 issues confirmed resolved.

## ⚑ MISSES / lessons (S375)
- **★ The S239 review caught a self-introduced bug in EVERY fix** — a silent trailing-token drop (#710
  class), a bare-word-body page crash (#713), an arity-mismatch page crash (#714, the review's "silent
  empty" was actually a crash). Reproduce-each-finding, don't relay. [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ Read the RIGHT result field** — I mis-read compiler diagnostics from `result.errors` when warnings
  live in `result.warnings`, and nearly built a fix for a non-bug (W-IF-IN-EACH fires fine). Saved
  [[project-compiler-diagnostic-fields]]. Caught by cross-checking a passing test.
- **★ The filed locus is a hypothesis** — #713's default-pipeline root was NOT the filed component-expander
  locus (downstream); re-deriving it by execution is what made the fix correct vs dead code. [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ types-gate is Windows-broken** ([[project-types-gate-windows-broken]]) — ran tsc by hand.

## 🧷 STATE (S375 close)
- **main** `84582f51` (#714); coherence 0/0; both repos clean; no branches/worktrees to clean (only main +
  persistent scrml-pinned).
- **Suite:** each PR cloud-`gate` GREEN; unit **17860/0**; full wrap-gate **22844 pass / 99 skip / 6 fail**
  (the 6 pre-existing integration flakies — self-host/csrf/any-type-forbidden — unchanged from boot baseline).
  A known FLAKY `any-type-forbidden` (E-TYPE-ANY-FORBIDDEN, ~6.3s) intermittently fails under full-suite
  load but passes 6/6 in isolation — orthogonal, not a regression.
- **Review floor:** #710/#713/#714 recorded (finding, self-S239-reviewed); **#709 (bryan boot-trim) OWED** — his lane.
- **Sibling:** S375-bryan was LIVE (boot-trim #709). Disjoint lane (his §16-semantics/native + the routed items).
- **Maps:** surgical component-expander + emit-each edits, no new modules/entrypoints → maps unchanged.

# scrml — Session 375 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-25. Booted `/boot` Profile A. Ran SOLO, then became the PREDECESSOR when
S375-peter registered as a successor mid-session and began landing.

**The framing, because it reorders everything else: this session's subject was the PA system itself,
not the compiler.** The operator opened it by asking for an instrument to measure context, and the
instrument then falsified the PA's own reassurance about the trajectory. What landed on main is
mostly doctrine and documentation; what was learned is a measured growth curve and a named defect
class.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ TWO DECISIONS OWED — both on ruling 1, both one-line reversals

Ruling 1 (`<db>`/state-block locus) is **BUILT and HELD** on `worktree-agent-a5d573c6f9c8f078c`
(`9f899636`). It does not land until these are answered.

**(A) The dispatch deviated from the ratified code name, and I think it is right.** bryan ratified
*"promote to the already-reserved `E-STATE-BLOCK-BARE-WRITE-DECL`."* It shipped
**`E-STATE-BLOCK-STATEMENT-FORM`** instead. PA-verified: that row's own §34 text reads *"A bare
`@name = init` … **Deprecation cycle endpoint** — activates after the `W-…` window"*, so the reserved
code is **shape-specific to the write form** and its window is still open. Firing it for `on mount`
makes one row mean two shapes and be simultaneously reserved and live. **The premise the ratification
rested on is falsified by the row itself.** `DIAGNOSTIC_CODE` is one constant if the operator
overrules. NB the brief's DONE-PROBE greps the old name and therefore reports FAIL; the corrected
probe is in the dispatch's `progress.md`.

**(B) The migration is 1 file and my brief said STOP if non-zero.**
`samples/htmx-debate-dashboard.scrml:143` — literally `on mount { loadDashboard() }`. Measured from
the COMPILER over 2,194 `.scrml` (not text-scanned). It **already fails on main** with `E-PA-002`, so
this adds a second error to an already-red file, and it uses the DEPRECATED `< db>` opener.
**PA recommendation: migrate it** — per S368 the corpus is 100% LLM-authored, so samples are training
input and a sample teaching a construct that silently never runs propagates the defect into every
future generated file.

### 2. ⚠️ THE EACH-ALIAS ARC IS PARKED — do NOT open round 8 without reading why

Frozen at tag **`s375-r7-reviewed`** (`ae42e120`, branch `each-alias-r5`). Rounds 5/6/7 plus **four**
adversarial passes, ~1.8M subagent tokens, three sessions, **nothing on main.**

**The class, named (delta [1806]):** the refusal is decided by predicates over the **RAW attribute
text** while the lowering it guards operates on a **NORMALIZED** form — `rewriteIterValueExpr`
collapses `@\s*\.\s*` → `@.` before the sigil rewrite, so guard and guarded read different strings.
Four instances, one cause. **This is Rule 7 one level in.** The convergent direction — decide the
refusal from the SAME artifact the lowering consumes, or have the lowering itself report what it
could not vouch for — is a **design question about where the check belongs** and is **NOT YET RULED**.
That is why it was parked instead of re-dispatched.

⚑ **A future round owes a real 3-way merge against #710**, which the concurrent session landed in
`emit-each.ts` today. The branch's base predates it; a wholesale pull would clobber their work.

⚑ **Also measured and worth keeping:** the parity control extended to ACCEPTANCE across 24 predicate
shapes gives 18 agree / 6 diverge, and **in all six the LIFT path is correct and STRUCTURAL is
defective.** The migration debt flipped sides. Five ledger entries are that backlog and they share one
locus family (`type-system.ts` / `emit-html.ts`) — a CONVERGE candidate, not five patches.

### 3. RULINGS 2 AND 3 — ratified, unbuilt, SEQUENCED (not parallel)

Both touch `compiler/src/ast-builder.js`, as does the pre-existing comment-flush fix. **Whichever
lands second clobbers the others, and the bare-call gate is a REJECT gate that must NOT be folded
into the comment fix.**

- **Ruling 2** — migrate the 2 bare-call files **into conformance cases asserting `E-BARE-CALL`
  fires.** The build is at `7d5fe573` (`brief/s368-bare-call`) and **has never had its S239 pass.**
- **Ruling 3** — BOTH halves. The §34 half is a **Rule 4 item**: `E-CONTROL-FLOW-IN-MARKUP` scopes
  itself out of the `<program>` body-top by asserting the §40.8 auto-lift covers it. PA-verified: it
  does not — `<program>` + `if (1) { }` compiles exit 0 and ships as page text, so the locus is
  covered by NEITHER. Then extend the diagnostic to the control-flow statement class only (S368
  explicitly rejected "diagnose every non-declaration run").
- **Ruling 4 (`TILDE_TOKEN_RE`) is DEFERRED** and correctly so: both forms compile clean on main
  today, so the asymmetry does not exist until ruling 2 lands.

### 4. OPEN PRs AND HELD WORK

| | state |
|---|---|
| **#711** ledger — 10 gap entries. **The 2 §34 rows were DEFERRED, not landed.** | The cloud **§34.0 row-provenance gate** (`s34-census.ts --check-new`) failed correctly: my rows named `validateEachAlias` / `refuseEmptyOpenerIf` / `refuseItemScopedOpenerIf`, symbols that exist ONLY on the parked branch. I had authored §34 rows for an implementation that is not on main — the same class as the ledger entry I corrected earlier, and against the project's own "a §34 code lands WITH its impl" rule. SPEC.md reverted; every gate the cloud runs now exits 0 locally. **Row text is preserved in the parked branch's `progress.md`** and lands whenever the arc resumes. |
| **#708** `scripts/ctx.ts` | `gate`+`windows` green, **HELD unreviewed** — deliberately, because its numbers now underwrite a ratified contract rule, which is the operator's own "still in question" carve-out |
| ruling-1 build | held pending §1 above |
| each-alias | parked, §2 above |



### 5. ⚑ THE §34 GATE CAUGHT ME, AND IT IS WORTH KNOWING IT EXISTS

`scripts/s34-census.ts --check-new` enforces that **a provenance note SHALL RESOLVE** — every
backticked repo path must exist and every named symbol must appear in executable source. It failed
this session's PR, correctly, because I wrote §34 rows for a parked implementation. **A note pointing
at a function nobody can find is worse than no note: it reads as a verified fire-site.** If you park
an arc, park its §34 rows with it.

---

## 🧷 WHAT LANDED

`#709` boot-trim Tier 1 · `pa-base v2.16` + overlay v2.4 (the rotation budget) · user-voice S375
(the context ruling + the four carried rulings, verbatim) · review floor **2 → 0**.

---

## 🔭 DURABLE FINDINGS — method, not defects

### A. Boot cost is a GROWTH PROCESS, and it is now measured
43 boots on record: earlier-half mean **317,195** → later-half **363,266** (**+15%**); S375's
**430,367 is the highest ever**; peaks routinely **88-96%**; working headroom 53 → **45 points**.
Five reference docs are **65%** of a boot; the harness baseline everyone assumes is the problem is
**13%**. Boot is **34-40% regardless of session shape** — Profile B exists and is essentially never
taken, so the design-session price is paid on every execution arc. **The counter-proposal, unruled:
not a third profile but an ARC-DECLARED READ-SET** — the boot naming its documents the way a dispatch
brief already names its files, spec sections and maps.

### B. The rotation budget, and why a cleanup would not have been enough
Every maintained-tier doc is append-biased, so boot cost is a function of SESSION COUNT. A one-time
trim buys a fixed number of weeks and then recurs. **The mechanism was already invented and used
exactly once — the hand-off rotates and nothing else did.** `pa-base v2.16` generalizes it, and its
first application was to pa-base itself.

### C. Eight wrong-referent probes in one session — the class is the finding
Every one was **well-formed and answered about something slightly different from what was asked**: a
`pull --rebase` in the wrong repo · a `checkout -b` in the wrong repo · an orphan probe measuring IDs
not blocks · `grep -c` exiting 1 on a CLEAN result · a WARN-only line matched as a gate STALE · a
detector over-reporting 9 where the truth was 1 · a gap grep disagreeing with `state.ts` · `$?` taken
from a PIPELINE (which `pa-base` §8 already cites as witnessed). **None shipped — every one was caught
by something downstream failing loudly, not by the probe being right.** Operational rule: **verdict by
EXIT CODE, never by grepping output text**, and state which artifact a probe reads before trusting it.

### D. A ratified rule survived ~200 sessions unenforced because nothing computed the difference
`master-list` §0.6 has asserted since S171 that the changelog is the one narrative home. It was false
for 2 sessions and nobody knew, because no probe compared the two. Same shape as the review floor at
S316 and the adopter-issue channel at S262. **A channel the probe does not read does not exist.**

---

## ⚑ MISSES (mine)

1. **★ I told the operator "43% isn't fatal, work is cheap relative to boot" — measured against a TOOL
   BUILD**, which is write-heavy and read-light, rather than against a bug fix, which is
   reproduce/trace/review/verify. He supplied the falsifier in one line and it held in every limb.
2. **★ I claimed a regression verdict from EMISSION and asserted it about EXECUTION** — "base renders
   ungated but ALIVE." Base was dead too. That is the "emitted ≠ runs" trap, recorded three times in
   this project, and I walked into it *in the same brief where I instructed the agent to avoid it.*
3. **★ I authored a ledger entry from a branch measurement and filed it as truth about main.** Caught
   by re-verifying every entry against main before merging. Corrected in the same PR.
4. **★ `git add -A` swept a stray `./0` into a commit and a pushed PR** — the contract mandates an
   explicit pathspec for exactly this reason.
5. **★ My brief for ruling 1 contradicted itself** — the locus was inside my own MUST-NOT-WRITE list.
   The dispatch routed around it rather than asking, and said so.
6. **★ Three dispatch briefs carried a wrong rule-shape or a wrong premise and every dispatch
   out-measured me.** That is now the standing expectation, not a surprise.

---

## 🧷 STATE

- **main** `592dccf7` at wrap-cut (peter's #710). Coherence 0/0 on both repos.
- **Gaps: HIGH 56 · MED 172 · LOW 75 · Nominal 7** (from the `@generated` block; +10 filed this
  session, 1 reframed).
- **Debts:** review floor **0** · issue-debt 0 · dpa-debt 0 unrun / 0 advisory · corpus-zero 0.
- **Concurrent:** **S375-peter is LIVE** and landing. Footprint claimed on the board with the
  `emit-each.ts` collision flagged. Their dog-food lane is otherwise disjoint.
- **Worktrees:** `agent-a511a7ecac97c6ac5` (each-alias, PARKED — retain) and
  `agent-a5d573c6f9c8f078c` (ruling 1, HELD — retain) both hold unlanded work. `agent-a43028c478d6d1232`
  (Tier 1) landed and is swept.
- **Maps:** no compiler source landed this session → **maps unchanged**, deliberately not refreshed.
- ⚑ **`scripts/ctx.ts` is not on main yet**, so a future session cannot query occupancy until #708
  merges. That is the instrument the ratified `pa-base v2.16` budget names as its probe — **a ratified
  rule currently points at an unmerged script.**
- **Mechanical stream:** delta-log `[1799]`–`[1810]`. Do not re-derive from this hand-off what the
  delta-log and changelog carry.

# scrml — Session 372 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-24 → 08-25. Booted `/boot` Profile A onto a **stranded S371 wrap**. Ran SOLO for
the first half, then entered **successor-mode mid-session** when Peter went live (S372/373/374-peter).
Six PRs landed. **Two dispatches, eleven adversarial passes between them, a real defect in every one.**

**The framing, because it reorders the rest: the session's durable output is a structural finding,
not the fixes.** The compiler carries at least **six hand-maintained approximation walkers** answering
questions it could compute, and every one is producing a defect family. Two operators reached that
conclusion independently on the same day.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ THE OPERATOR RULINGS OWED — one is NEW and it has four options

**NEW — §55 rollup truthiness.** What does truthiness over a §55 rollup MAP or ARRAY mean?
Options: **{always-true · never-true · diagnose · `?.`-on-declined-path-only}**. `diagnose` is the
only limb that fails CLOSED. It governs **five** shapes: compound `errors`/`touched` bare · per-field
`errors` bare · `@compound.errors.<field>` · the markup-typed dead-page residual · the enshrined
bare-vs-parenthesised spelling divergence.
⚑ **The fourth option carries a hit against my own framing and it is fair.** The reviewer:
*"the gate's stated rationale weighs always-true vs never-true and never weighs **dead page**."* My
round-1 ban on `?.` was about the COLLAPSE path (there it trades a loud crash for a permanently-false
gate — strictly worse). On the DECLINED path the status quo is **already** a crash, so the real trade
is dead-page vs contained-false-gate, and I never weighed it that way when I set the rule.

**STILL OWED, untouched for a third session — the S368 rulings, now THREE not four.** `<db>` state-block
locus · the 2-file bare-call migration · bare `if (){}` at a default-logic body-top. ⚑ **Ruling 4
(`TILDE_TOKEN_RE`) is DOWNSTREAM of ruling 2, not independent** — re-measured on `main`: BOTH forms are
exit 0 today (`log("hi")` ships as page text silently; `log("hi") ~` lifts and runs). The "one is now an
error" asymmetry only exists once the bare-call build lands, and that build is **not on main** (it sits
on `wip/s368-bare-call-build`; zero `E-BARE-CALL` in `compiler/src`).
⚑ **Two carried premises were STALE and I corrected them by re-measuring rather than relaying:**
ruling 1's "clean compile exit 0" does **not** reproduce — `samples/dashboard.db` does not exist, so the
file fails `E-PA-002` (the `on mount`-ships-as-text half DOES reproduce, and that failed build still
wrote 4 complete artifacts — `g-cli-emits-artifacts-on-failed-compile` again).

**Peter's two newly-accepting halves** (else-arm object literal, decl-codegen + typer) — one-way doors,
routed to bryan, in the inbox.

**bryan's unfiltered hand-authoring friction list** — owed since S368. **Do NOT pre-triage it.**

### 2. ⚠️ EACH-ALIAS IS HELD AT ITS ROUND-4 TIP — complete, re-review IN FLIGHT

Branch `worktree-agent-aef0abebce785405f`; base published as `origin/feat/each-alias-round2` @ `0e836a70`.
**bryan RULED the byte fork: land WIDE, over-pull becomes its own arc** (user-voice S372; `+94,765`
bytes corpus-wide `+0.086%`, PA-verified to the byte).
Round 4 fixed a confirmed **HIGH** (root-position lift-parsed `<each>` shipped a dead page:
`createElement("each")`, alias a free identifier, `ReferenceError`, whole client dead) plus a silent
dangling-`as` and a **regression the fix itself introduced** (`W-ATTR-001` began calling a now-working
`if=` gate inert). **All three PA-verified by execution: 0 `<li>` → 2 `<li>`, named diagnostic, warning
silent.**
⚑ **The agent STALLED at 600s during REPORTING, not during work** — all three fixes were committed and
the worktree clean. The incremental-commit rule paid for itself; a batch-at-the-end agent loses the round.
⚑ **What is NOT verified: its differential and bite proof** — the stall ate the report. Do not land on
the strength of a report that never arrived.
⚑⚑ **THE RE-REVIEW LANDED AFTER THE WRAP AND RETURNED A HIGH IN THE ROUND-4 FIX ITSELF — READ THIS
BEFORE TOUCHING THE BRANCH.** The new §17.1.2 opener `if=` gate lowers the predicate against
`enclosingScopeVar`, which is **`null` for every lift-parsed `<each>` not inside a `for`**, so an
ITEM-SCOPED predicate emits a guard that throws. **PA-REPRODUCED at emit:**
`<each in=@rows key=@.id if=@.on>` inside a `fn` compiles **exit 0, zero diagnostics** and emits
`if (!(null.on))`; the `as`-alias variant emits `if (!(it.on))` with `it` a free identifier.
`_scrml_effect` has no `try/catch`, so it propagates out of the module body — whole client dead.
⚑ **BUT the review's REGRESSION framing is UNCONFIRMED and I measured the difference.** It reported
that base rendered both rows; on MY fixture **base is ALREADY dead** —
`ReferenceError: _scrml_reconcile_list is not defined`, i.e. the chunk-pruning gap this very sweep
fixes. So: **the broken emit is real and certain; whether it is a REGRESSION is fixture-dependent and
was not established.** Do not carry "it regressed" into a brief without re-deriving it.
**Also from that review — MED:** `EACH_FACTORY_ALWAYS_EMITTED` holds only `document`, but `_itemFrag`
is emitted just as unconditionally, so `as _itemFrag` passes all four validator arms and produces the
exact *"This is a compiler defect … please report it"* message the validator was written to remove.
**One name short of its own "provable from the emitter" claim.**
**And LOW:** `emitEachOpenerIfGuardLines` returns `[]` on an unrecognised value shape (e.g. a bareword
`if`), silently dropping the gate — the fail-OPEN direction §17.1.2.3 names as the dangerous one.
**Round 5 is NOT dispatched** — the branch is HELD and nothing is on `main`, so this is pickup, not
an emergency.
⚑ **Owed at landing (SPEC is out of the agent's write-set):** the `E-EACH-AS-ALIAS-INVALID` §34 catalog
row. Ready-to-paste text is in `docs/changes/each-alias-round3-2026-08-24/` and the agent's report.
Plus **six gap entries it asked me to author** — not yet written.

### 3. ⚠️ SIX WALKERS, ONE SHAPE — the session's real finding

Every one is a hand-maintained approximation of a question the compiler could compute, and each is
emitting a defect family one carrier at a time:

| walker | approximates | carriers missed (found so far) |
|---|---|---|
| chunk-detect (`emit-client.ts`) | which runtime chunks a page needs | **4** — filed as the arc, #698 |
| `markupReferencedNames` (route-inference) | is this fn referenced from markup | 2 — `<each>` opener (#688), `<match on=fn()>` |
| DG consumption-credit | is this cell consumed | **3-4** — Peter's route, independent |
| synth-key resolution | which flat key a dotted read means | **5 copies**, two of them DIVERGENT |
| `<each>` lift machinery | which carriers reach `eachBlockFromMarkupNode` | **5** |
| VP-1 `walkFileAst` | attribute validation reach | **1 of 5** carriers reached |

**pa-base: repeated review, same class → CONVERGE, do not enumerate.** `g-chunk-reachability-is-approximated-not-computed`
(HIGH, #698) is the first arc filed against this; the others are filed individually and cross-linked.
⚑ **Peter reached the same conclusion from a different direction the same day** and said so:
*"the right fix is likely to converge the reader sweep … not a 4th patch — your architectural call."*

---

## 🧷 WHAT LANDED (6 PRs)

`#689` the stranded S371 wrap, as inherited · `#690` review floor **11 → 0** + a HIGH ·
`#691` the render-slot trace + 3 defects · `#692` the fourth-copy defect + the S239 blocker routed as
a ruling · `#698` **the chunk-reachability ARC** (bryan-ruled) · `#704` **the §55 synth-toggle fix**.

**⭐ #704's headline, MEASURED: `examples/30-validated-form.scrml:136` — `<p if=@signup.submitted>Account
created.</p>` — had NEVER RENDERED, in any build ever shipped, at exit 0.** Corpus differential: exactly
**1 changed artifact of 7388**, six rounds running, same head hash.

---

## 🔭 DURABLE FINDINGS — method, not defects

### A. A gate over a value needs the value's TYPE — and the type is never recoverable from the syntax of the read
Five build rounds on #704, and **three of the four rule-shape errors were MINE, not the dispatch's**:
`scalar only` (talked down on a narrow fixture) → `tail === ""` (too loose) → `scalar tail` (wrong in a
third way). Not the leaf name, not the declaration form, not the presence of a tail, not
key-registration alone. **The dispatch measured its way to a better rule than I specified, every time.**
The two derived discriminators are the durable output: compound-parent is `<prefix>.submitted ∈ keys`;
field-vs-nested-compound is `<prefix>.<seg>.errors ∈ keys AND <prefix>.<seg>.submitted ∉ keys`.

### B. Vary the declaration form before concluding
A "base is a dead page anyway" premise, measured on a **markup-typed** field (`= <input/>`), did NOT
hold for a **literal-init** one (`= ""`) — where base is CORRECT and collapsing regresses it. I
verified the narrow reading myself and approved a deviation on it; the next adversarial pass caught it.
Same shape as the S368 miss (one comment position, generalised).

### C. A normative SHALL that was never implemented
`render-expansion` / `renderExpansion` / `inlinedChildren` — **zero source hits** across `compiler/src`,
`native-parser`, `scripts`, `stdlib`. SPEC §16.8.1's mechanism does not exist; CE implements a
different, UNDOCUMENTED splice. **Rule-4 item for the operator:** amend §16.8.1/§16.8.2 to describe what
CE does, or rebuild CE around the specified node.

### D. Our own e2e tier looked at the flagship and called it green
`renders-empty` is in `GREEN_STATES` and there is no partial-emptiness detector, so a page whose every
card is empty records `renders-clean`. **The §8 hollow gate in its nastiest form — the gate is not
broken, its answer is TRUE, it is just not an answer to the question being asked.** Operational teeth:
the render-slot fix's regression test CANNOT be an e2e-render-map cell.

---

## ⚑ MISSES (mine)

1. **★ Three of four rule-shape instructions on #704 were the imprecise part.** See finding A.
2. **★ I approved a deviation on a fixture I had verified too narrowly.** See finding B. My own
   verification was the thing that was insufficient — not the agent's flagging, which was honest.
3. **★ I could not reproduce the each-alias HIGH across three fixtures and routed it
   RELAYED-UNVERIFIED with code-level corroboration. The agent reproduced it.** Correct handling —
   had I dismissed it on my own failure to reproduce, a real defect would have shipped inside a branch
   bryan had just approved. **Failing to reproduce is not evidence of absence.**
4. **★ My ad-hoc gap-count greps disagreed with `state.ts` and I nearly reported a discrepancy that
   did not exist** — adjacent-attribute grep, blind to multi-line markers and to non-`open` statuses
   the parser counts. **Quote the `@generated` block, never a hand grep.**
5. **★ A missing-symbol detector of mine over-reported NINE symbols where the truth was ONE** —
   it searched only the runtime chunk, not the client bundle, matched a double-underscore name inside a
   single-underscore pattern, and ignored `typeof` guards. Caught before it reached a filing.
6. **★ zsh did not word-split a file list** (again — the recorded lesson), and a `cd` into
   `scrml-support` persisted so a later `git rev-parse HEAD` answered about the wrong repo.
7. **★ A commit hook timed out at 8m20s** and I verified git STATE rather than the exit code — it had
   committed cleanly. The recorded rule held.

---

## 🧷 STATE

- **main** `8b2e4053` at wrap-cut (Peter's #705); my six PRs merged; coherence 0/0.
- **Gaps: HIGH 55 · MED 171 · LOW 74 · Nominal 7.**
- **Debts:** review floor **0 OWED at drain** (the wrap PR is the inherent next-boot tail) ·
  dPA 0 unrun / 0 advisory · issue-debt 0 · corpus-zero 0.
- **Concurrent:** Peter LIVE across S372/373/374-peter, landing continuously (#693–#705).
  **Collision check run before every action — all six of my dispatches' compiler paths CLEAR.**
  ⚑ The each-alias brief's ban on `ast-builder.js`, written for an unrelated reason, is what kept it
  off a real collision with Peter's #697.
- ⚑ **`strict:true` cost two rebases.** Peter's cadence wins the race; **arm `--auto` on a PR rather
  than hand-racing the merge.**
- ⚑ **`delta-lint --fix` was deliberately NOT used** on two sequence collisions with Peter — it
  renumbers the wrong side on a merge (first-in-file order is blind to which side is published).
  Renumbered by hand both times.
- **Worktrees:** see 6b in the changelog block; the two agent worktrees holding unlanded work are RETAINED.
- ⚑ **WRAP 6c — MAPS REFRESH DISPATCHED AND STILL IN FLIGHT AT WRAP-CUT; DELIBERATELY NOT COMMITTED.**
  The mapper had bumped line 3 to `8b2e4053` while line 4 still read `generated-at: b9e97f1b` — a
  self-contradicting watermark, which is precisely what the MAP-STAMP RULE exists to prevent. I
  unstaged rather than ship it. The stamp SHA it chose IS a valid ancestor of `origin/main`
  (verified). **Next session: let it finish, or take the `cloud-maps` scheduled refresh, then commit
  `.claude/maps/` with an EXPLICIT pathspec.** The maps are ~5 code landings behind (#697 #699 #700
  #703 #704). ⚑ **Two ROUTING HOLES were named in the dispatch and are worth confirming landed:** no
  Task-Shape row for `if=`/`show=` lowering or `emit-event-wiring.ts`, and none for
  `eachBlockFromMarkupNode` / the lift-vs-structural `<each>` split — **both reported independently by
  two dispatches this session**, which is what makes them measured rather than speculative.
- **Mechanical stream:** delta-log `[1771]`–`[1773]`, `[1783]`–`[1786]`. Do not re-derive from this
  hand-off what the delta-log and changelog carry.
- ⚠️ `scripts/ruling-debt.ts` **still not on `origin/main`** — fourth session running. The instrument
  for undelivered rulings remains itself undelivered, and this session carried FOUR owed rulings.


# scrml — Session 374 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-24. Booted `/boot` Profile A, SOLO (predecessor S373-peter wrapped; no live sibling
at boot). Peter's directive: **"then arc g-when."** Built + landed the one deferred g-when arc, end-to-end.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ✅ ARC #1 DONE — the g-when set is now fully drained on the Peter side
`g-when-handler-multistatement-body-loses-ast-path-lowerings` (MED) **RESOLVED (#703, `574af206`)** —
the last of the g-when follow-ons deferred at S372/S373. `rewriteBlockBody` gained an opt-in `astExprCtx`;
when-handler statements lower via the AST path (map/set/request/dbVar/synth interception). Fix verified
LIVE on merged main. Nothing g-when remains in the Peter lane.

### 2. PETER-LANE follow-ons still OPEN (buildable next, or dog-food)
- `g-worker-handler-in-component-bodyraw-reconstruction-offset-sensitive` (MED) — pre-existing LOUD
  E-CODEGEN-INVALID-LOGIC; blocked #699's end-to-end tests (S373 §3).
- `g-when-handler-body-invisible-to-preemit-chunk-detection` (LOW) + the `usage-analyzer.ts` FeatureUsage
  **dead-code** cleanup (wire-up-or-delete) — S373 §3.
- The durable alternative: **dog-food a fresh adopter app** in happy-dom (beats mining the ledger —
  [[feedback-dogfooding-beats-mining-the-ledger]]). S372/S373 fresh finds all came from RUNNING code.

### 3. ROUTED TO BRYAN — still awaiting his rip (scrml-support inbox)
- `g-match-else-arm-object-literal-decl-and-typer-newly-accepting` (from #697, S373) — turnkey inbox note.
- Prior peter→bryan routes: S361 security ×2 · S364 markup-interp · S370 auto-await · S372 DG cry-wolf.

### 4. TOOLING follow-on (filed as a friction, candidate fix)
`types-gate.ts` `resolveTsc()` hard-codes `.bin/tsc` (Unix-only) → the gate `exit(2)`s on this Windows
clone even after `bun install` (bun installs `tsc.exe`/`tsc.bunx`). Non-blocking (cloud gate runs no tsc).
Fix = try `.bin/tsc.exe`/`.bin/tsc.bunx` on win32. Delta-log [1782] carries the manual workaround command.

## 🧷 WHAT LANDED (S374-peter) — 1 code PR + this wrap
- **#703** `g-when-handler-multistatement-body-loses-ast-path-lowerings` (MED) RESOLVED. Opt-in AST-path
  lowering in `rewriteBlockBody`; three when-emit sites pass `_makeExprCtx(opts)`; every existing caller
  byte-identical. **S239 caught a real silent-wrong in the fix** — a partial parse (`foo(1) bar(2)`)
  dropped the 2nd expr silently → full-consumption guard added (loud fallback, never silent). Plus a
  `clientAsyncBody:false` sync-wrapper defense (latent stranded-`await`). Biting 6 cases. Unit 17834/0.

## ⚑ MISSES / lessons (S374)
- **★ The S239 pass caught a silent-wrong I INTRODUCED** — the AST path's `emitExprField(node, raw)`
  ignores `raw`, so a partial parse silently drops trailing tokens. Reproduce-each-finding (not relay)
  confirmed #2 by execution and *falsified* #1 (no `await` emitted today). [[feedback-verify-the-bug-class-not-just-reported-instance]] [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ types-gate is Windows-broken** — a local always-on gate that can't run on this clone. Worked around
  by hand; verified zero new tsc diagnostics on the edited lines. [[feedback-run-facts-check-before-push]]

## 🧷 STATE (S374 close)
- **main** `574af206` (#703 squash); coherence 0/0; both repos clean; feature branch deleted (local+remote).
- **Suite:** #703 cloud-`gate` GREEN (`windows` also green, `tracking` red = known non-required). Unit
  **17834/0**; full unit+integration+conformance **22818 pass / 99 skip / 6 fail** — the 6 are pre-existing
  integration flakies (auth/self-host/csrf family, unchanged from boot baseline; none in the changed
  codegen surface, and the cloud gate that binds the merge was green).
- **Gaps:** 1 resolved (#703). `state.ts` refuses locally (Windows ` · ` parse) → cloud-maps.yml
  regenerates the `@generated` counts post-merge (NOT in the required gate) — trust the post-merge regen.
- **Review floor:** recorded my **#701/#702** (docs carve-outs) + **#703** (finding — self-reviewed via
  `/code-review high`). ⚠️ **#698** (bryan chunk-reachability) + **#704** (bryan §55 synth) merged during
  my session and are OWED — **bryan-lane**, left for his boot to state/record.
- **Sibling:** bryan was active (merged #698 + #704 under me). Re-check `user-voice-scrml.md` for any NEW
  rulings at next boot (I absorbed through the S372 each-alias entry).
- **Board:** S374-peter → WRAPPED.
- **Maps:** surgical codegen edits (rewriteBlockBody + 3 when-sites), no new modules/entrypoints → maps unchanged.

# scrml — Session 373 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-24. Booted `/boot` Profile A, effectively SOLO (S372-bryan's board read LIVE but
his session had ENDED — all his S372 PRs merged, no bryan commit after my S372 wrap). The arc, per
Peter's directive: **"#1, then the 3 g-when arcs, then drain."** Landed 3 fixes + the drain; deferred
the meatiest g-when arc. Two satellite dispatches (arc #2: 3 rounds; arc #3: 1 round + a root re-derivation).

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⭐ ARC #1 DEFERRED — `g-when-handler-multistatement-body-loses-ast-path-lowerings` (MED) — NOT built
The 3rd g-when pickup item from S372, the meatiest, deliberately deferred (session was deep + it is the
highest-blast-radius of the set; I surfaced the fork to Peter and, with no reply, took the conservative
default of not opening a big build late). **Locus CONFIRMED:** `rewriteBlockBody` (`emit-control-flow.ts:1831`
loop) lowers each statement RHS via `emitExprField(null, rawRhs, exprCtx)` — the STRING fallback
(`rewriteExprWithDerived`), which does NOT do `emitMember` interception. So `@m.insert(k,v)` on a
`[string:int]` map cell emits `..._get("m").insert(...)` (bare `.insert`) instead of `_scrml_map_insert(...)`.
**Fix:** parse each statement RHS to an ExprNode and `emitExpr(node, fullCtx)` with the FULL
`EmitExprContext` (mapVarNames/setVarNames/requestIds/dbVar/synthCellKeys). ⚑ **`exprCtxExtras` threading
is INSUFFICIENT** (S372 PA-tried + reverted) — the string path can't member-intercept regardless of ctx;
MUST use the AST path. Blast radius HIGH (`rewriteBlockBody` is shared by when/effect/worker emit) — careful
S239. Repro: a map/set method + a `<#request>` ref + a `?{}` SQL param, each in a when-handler statement.
Peter-lane (regression from #693/#695, compute). **OR** dog-food fresh (the durable: running new apps beats
mining the ledger — [[feedback-dogfooding-beats-mining-the-ledger]]).

### 2. ROUTED TO BRYAN — awaiting his rip (scrml-support inbox)
- **`g-match-else-arm-object-literal-decl-and-typer-newly-accepting`** (from #697's S239) — the decl-position
  codegen crash + the type-checker E-SCOPE-001-on-object-key halves of the else-arm class. Both **newly-accepting**
  (one-way door). By-construction fix at `ast-builder.js:9939` Form 2 (make an object-literal block-arm parse
  inline) closes all three consumers at the root. Turnkey inbox note `2026-08-24-...-s373-else-arm-object-literal-...`.
- Prior peter→bryan routes still held (S361 security ×2 · S364 markup-interp · S370 auto-await · S372 DG cry-wolf).

### 3. PETER-LANE follow-ons filed this session (buildable next, or dog-food)
- `g-worker-handler-in-component-bodyraw-reconstruction-offset-sensitive` (MED, pre-existing LOUD E-CODEGEN-INVALID-LOGIC — blocked #699's end-to-end tests, hence its CE-layer assertions).
- `g-component-worker-handler-in-component-native-reparse-rejected` (MED, E-COMPONENT-021, likely newly-accepting → bryan).
- `g-when-handler-body-invisible-to-preemit-chunk-detection` (LOW) + the `usage-analyzer.ts` FeatureUsage **dead-code** cleanup (wire-up-or-delete).

## 🧷 WHAT LANDED (S373-peter) — 5 PRs
- **#697** ⭐ `g-library-fn-match-else-arm-object-literal` (HIGH) RESOLVED — else/wildcard arm's object literal lowers as a VALUE (return position), parity with #664's inline path via a shared `_matchArmResultIsBlockBody` classifier; `pick(9,77)` → `{x:0}` (was `77`). 8-case biting.
- **#699** `g-component-prop-worker-handler` (MED) RESOLVED — prop substitution in `bodyRaw` when-handlers (parent worker + `when-effect`); converge-then-narrow (dropped the worker-**self**-handler over-reach — separate worker scope). 13-case.
- **#700** `g-when-handler navigate chunk-prune` (MED) RESOLVED — reference-gated `POST_EMIT_HELPER_CHUNK_GATES` (navigate→utilities). **Briefed root was DEAD CODE**; re-derived to a real SINGLE-statement `navigate()`-in-when-handler → `utilities`-pruned ReferenceError. 4-case.
- **#701** drain (docs) — #1 resolved, 4 follow-ons filed, review floor 11→0.

## ⚑ MISSES / lessons (S373)
- **★ FACTS-gate miss** — pushed #697 without `facts.ts --check`; the LOC delta (2-line src + 1 test file) failed the required cloud gate. Saved [[feedback-run-facts-check-before-push]]; ran it before every later push. (`tracking`/`windows` red = known non-required; only `gate` blocks.)
- **★ Filed root/direction WRONG twice, caught by reproduce-first.** Arc #3's briefed `usage-analyzer.ts` locus was **dead code** (bitmap never read) — re-derived to `detectRuntimeChunks`/navigate. Arc #2's review-suggested "same-class" worker-self-handler was an **over-reach** (worker scope). [[feedback-gap-report-fix-direction-can-be-wrong]] [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ A satellite MISREPORTED a ledger change** — claimed it marked #2's original gap resolved; it never touched the marker. Verify satellite claims, especially ledger/status. Caught + fixed.
- **★ A `/code-review` FORK did `git checkout` in a shared worktree** and clobbered a satellite's branch HEAD mid-round (satellite recovered; commits safe on origin). Reviewer forks are NOT isolated. [[feedback-isolate-agents-that-do-git-ops-in-main-tree]]
- **★ Converge-then-narrow** — arc #2 went under-fix (missed the `when-effect` twin) → converge (all `bodyRaw` kinds) → over-reach (worker-self) → narrow. The right scope was the middle. [[feedback-repeated-review-same-class-means-converge-not-enumerate]]

## 🧷 STATE (S373 close)
- **main** `07f75cd5` (#700); **#701** drain auto-merging on green (docs-only). Coherence target 0/0 post-#701. Both repos clean; all satellite worktrees + fix branches swept.
- **Gaps:** 3 resolved (#697/#699/#700), 4 follow-ons filed. `state.ts` refuses locally (Windows ` · ` parse) → cloud-maps.yml regenerates the `@generated` counts post-merge (NOT in the required gate). Approx HIGH 54 · MED ~171 · LOW 73 — trust the post-merge regen.
- **Suite:** every PR cloud-`gate` GREEN; unit **17828 pass / 0 fail / 17 skip** · conformance **883/883** on the landed state. FACTS regenerated per-PR.
- **Review floor:** **0 OWED** at #701 (the drain PR is the inherent next-boot tail).
- **Sibling:** S372-bryan ended. ⚠️ bryan appended `user-voice-scrml.md` entries during my session (`75ed3de` — UNREAD; absorb at next boot, may carry rulings on my routed items).
- **Board:** S373-peter → WRAPPED.
- **Maps:** surgical codegen/component-expander edits, no new modules/entrypoints → maps unchanged.

# scrml — Session 372 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-24. Booted `/boot` Profile A as a SUCCESSOR-concurrent to a LIVE S372-bryan (his
S371-wrap + gaps(S372) PRs landed under me all session; `main` moved ~6 times, forcing a rebase to
land). **The session's arc: pivot from find-mode to DRAIN-mode** — get real HIGHs off the board with
verified quality, per Peter's goal ("numbers down, not for numbers' sake").

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⭐ FOLD IN THE g-when SIBLING — turnkey, same pattern (the fix-the-class tail of #693)

The g-when arc closed the mainline multi-statement drop across **both** when-handler node kinds:
`#693` (worker `when message`/`when error`) + `#695` (the sibling `when @var changes` — fix-the-class,
shared `_captureWhenHandlerBody` helper). **FOUR S239 rounds total** — every round caught something real
(line-granular regressions · string-bracket accounting · unfixed sibling · **round-4 a regression the
approach itself introduced**). Remaining follow-ons, all filed, NONE mainline:
- **`g-when-handler-multistatement-body-loses-ast-path-lowerings` (MED, NEW round-4, execution-confirmed)** —
  routing when-handler bodies through `rewriteBlockBody` lost the AST-path lowerings the old single-`bodyExpr`
  path had: a map `.insert`/`.set`, `<#request>` ref, or `?{}` SQL param in a when-handler statement now
  mis-lowers (rewriteBlockBody's per-statement RHS uses the STRING fallback, not `emitExpr`/`emitMember`).
  ⚑ **Threading ctx via `exprCtxExtras` is INSUFFICIENT (PA-tried + reverted).** Real fix = AST-path
  per-statement lowering (`emit-control-flow.ts:1831`) — its own arc. Narrow (map/set/request/SQL in a
  when-body) vs the mainline case the fix repaired (net-positive). Server-fn auto-await UNAFFECTED.
- **`g-component-prop-substitution-skips-when-worker-handler-bodies` (MED)** — `substitutePropsInLogicStmt`
  (`component-expander.ts:2152`) has no when-worker case; #693 WIDENED the leak to the whole body. Add the
  when-worker cases. PETER-LANE.
- **`g-when-handler-usage-analysis-walks-only-first-statement` (MED)** — usage-analysis walks only `bodyExpr`
  (stmt 1) → feature in stmt 2+ under-detects → chunk pruned → runtime throw. **Routed to bryan** (his live
  `usage-analyzer.ts` W-DEAD surface — do not edit while live).

### 2. ITEM 2 IS REPRO'D + TRIGGER-ISOLATED — `g-library-fn-match-else-arm...` (HIGH), ready to fix

The next drain pick, already de-risked: `g-library-fn-match-else-arm-object-literal-returns-the-bare-identifier`.
**Confirmed on HEAD, trigger isolated to the `else` KEYWORD arm** (the `_` wildcard was fixed by #664).
`else :> { code: "other" }` emits `return code` (bare identifier → in-scope value or ReferenceError)
instead of the object. **Discriminator (2×2 run):** `_` wildcard ✓ · `else` keyword ✗ · independent of a
preceding const. **Root half-traced:** instrumented `emitIifeBlockArmBody` — for `_` it's called for
BOTH arms (object returned correctly); for `else` it's called ONLY for the matching arm, so the `else`
arm is lowered by a DIFFERENT path that treats `{…}` as a statement block. **Pick up: find where the
`else`/trailing-else arm body is emitted (NOT `emitIifeBlockArmBody`) and route it through the same
object-literal-as-value lowering.** Repro banked in the delta-log narrative.

### 3. THE DRAIN SHORTLIST (from the S372 HIGH-triage) — items 3-4 untouched

From the triage of open HIGHs (~7 cleanly peter-drainable): `g-when-message-parent-...` DONE. Remaining
clean picks, verify-first each (the shortlist is a hypothesis): `g-route-timer-poll-not-stopped-on-soft-nav`
(runtime lifecycle, `runtime-template.js:3026`) · `g-soft-nav-head-sync-drops-stylesheet-links`
(runtime nav head-sync, PR #559 territory) · the 3 `g-delta-lint-*` tooling gaps. **Lead with
silent-wrong-output over tooling.** Do NOT take the 4 bryan-S371 dog-food finds (if-attr-synth /
render-snippet / each-lift / each-alias — his live surface) or the DG cry-wolf (routed).

### 4. ROUTED TO BRYAN (scrml-support) — awaiting his rip

- **E-DG-002 cry-wolf** (`g-dg-if-chain-...`, MED) — queue item ⭐L + inbox note `2026-08-24-...-s372-dg-if-chain-...`. CONVERGE candidate.
- **#2 freshening** — queue A/B/K stamps (HEAD-verified) + the corrected B locus. A/B/K all still live, all correctly blocked (A=substrate, B=behind unlanded PR #579, K=central-lexer). No clean peter build there.

## 🧷 WHAT LANDED (S372-peter) — 1 PR
`#693` g-when parent worker-handler multi-statement fix (HIGH resolved; two-part root; 3 S239 rounds; 6-case biting test). Plus the ride-along ledger: B-locus correction, A/g-dg/usage-analyzer entries.

## 🔭 THE DURABLE STRATEGIC FINDING — the count only falls if the MODE changes
Trajectory: **+8 HIGH / +15 MED over ~6 sessions** — discovery outpaces draining, by BOTH operators.
Dog-fooding is a structural NET-ADDER (the only source of ergonomic-bug evidence, but it grows the
list). "Numbers down for real" = draining (fix / verify-close), a DIFFERENT activity. Peter's lever,
sized by the HIGH-triage: ~7 cleanly-drainable HIGHs + force-multiplying bryan (turnkey routing +
staleness pre-closing) on the ~26 authority HIGHs. The rising count is the count getting HONEST
(corpus-zero: no human wrote scrml until last week) — don't optimize for a small number.

## 🧷 STATE (S372-peter close)
- **main** includes `#693` (`4bf73508`); rebased past S372-bryan's concurrent landings. Gaps: **HIGH 56 · MED 168 · LOW 72 · Nom 7** (authoritative `gapCountsFromTokens`; +2 HIGH +1 MED net this session = 1 resolved, 3 filed). `state.ts` refuses locally (Windows ` · ` delta-log parse) — counts hand-synced via the authoritative fn; Linux gate green.
- **Suite:** #693 gate GREEN (required); `windows` green; `tracking` red = known non-required fs.watch/dev-watcher timeout baseline (root-caused, unrelated). When/worker/channel/nested-program 148/0; conformance clean (one heavy DB test flakes only under co-run).
- **Concurrent:** S372-bryan LIVE all session (if-attr-synth, render-trace, W-DEAD each-attr, floor drain, s371 wrap). Stayed off his surfaces. Two S372 PICKUPs — reconcile against the newest wrap commit.
- **scrml-support:** queue + inbox pushed (E-DG-002 route + #2 freshening + three-stamps inbound filed to read/).


# scrml — Session 371 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-23 evening → 08-24. Booted `/boot` Profile A, **SOLO** (no live sibling).
Eleven PRs, one code landing, **two branches deliberately HELD**.

**The framing, because it reorders everything else: six claims of mine were overturned by
measurement this session, and every one was caught before it reached a build.** Two of the six were
overturned by bryan, two by dispatches, two by my own re-checks. The session's durable output is
verification discipline, not the defect count.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ ONE OPERATOR DECISION, NEW THIS SESSION — the each-alias byte cost

The each-alias fix (`0e836a70`, HELD) closes the dead-page class generically by sweeping **four**
off-spine markup carriers. Cost: **+94,765 runtime bytes corpus-wide (+0.086%)**, of which
**+63,345 is UNUSED** — the sweep now reaches off-spine `if=` markup and pulls the whole `ifmount`
chunk those cases never call. The agent chose correctness (a missing chunk is a dead page at exit 0;
an extra chunk is bytes) and surfaced the trade rather than defaulting it.
**Narrowing option if you prefer bytes:** route only `each`-tagged markup — keeps all four carriers
and both fixed dead pages, drops the 63KB, re-hides any genuine off-spine `if=`/`<timer>` dead page.
**Not my call. Nothing else blocks on it.**

### 2. ⚠️ THE FOUR S368 RULINGS ARE STILL OWED — untouched this session

`<db>` state-block locus · the 2-file bare-call migration · bare `if (){}` at a default-logic
body-top (contradicts the §34 `E-CONTROL-FLOW-IN-MARKUP` row's own claim) · the `TILDE_TOKEN_RE`
disagreement. All four still carry their S368 measurements. **Plus bryan's unfiltered
hand-authoring friction list, still owed and still not to be pre-triaged.**

### 3. ⚠️ TWO BRANCHES HELD — complete, reviewed, NOT landed

| branch | state | owes |
|---|---|---|
| **match-arity** `2514a84c` (`worktree-agent-a24e739ba7d1e2612`) | round 2 complete; core VERIFIED by me (`(1,x)` still rejects · fire-once 3→1 · conformance 886/886) | **A THIRD false normative sentence.** Round 2 fixed round 1's and introduced its own: *"both are still REJECTED, neither is silent-wrong"* holds only at `write:true` — measured `errors: []` with malformed `libraryJs` at `write:false`, **the exact consumer the same §34 row names as the harm three sentences earlier.** Plus a third uncovered shape (inline event-handler body) the enumeration misses, and a write-path effect worse than reported: on incremental rebuild a failed build now **overwrites a previously-valid artifact**. ⚑ Its two owed gap entries are drafted at `scratchpad/gaps-match-arity.md` — **the SPEC text references them by id and will dangle without them.** |
| **each-alias** `0e836a70` (`worktree-agent-ae080f493c841f360`) | round 2 complete; blocker fixed generically | a **re-review** (a fix round invalidates the review that produced it) + decision §1 above |

⚑ **`SPEC.md` is in the match-arity write-set.** The RULED §17.6 amendment (below) cannot fire until
that branch lands or is abandoned.

### 4. ⚠️ THE §17.6 AMENDMENT IS RULED AND SCOPED — brief written, not dispatched

bryan ruled **limb (b)**: amend §17.6 to admit a lift-less single-expression branch as sugar for
`lift`, AND give `value-form` a normative name. Brief at
`docs/changes/spec-17-6-value-form-amendment-2026-08-24/BRIEF.md` with all **three** measured
divergences. ⚑ **It owes a reconciliation of `SPEC.md:11884`** — the §17.6.2 sentence saying a
lift-less arm contributes `not` is exactly what the compiler contradicts; amending the grammar
without striking that leaves the contradiction in writing.

### 5. ⚠️ THREE NEW HIGHs, none dispatched

- **`g-render-snippet-slot-renders-empty`** — `${render name(...)}` renders NOTHING; the flagship
  `examples/12-snippets-slots.scrml` ships every card empty; **15 corpus files** use the surface.
  NO LOCUS TRACED (searched, recorded).
- **`g-if-attr-per-field-synth-cell-crashes-boot`** — kills every interpolation on the page.
  ⚑ **My first mechanism diagnosis was WRONG** (I blamed the `@`-path regex; the AST path emits the
  same shape for working cases). Corrected in the entry — the rewriter is the wrong layer.
- **`g-each-lift-path-client-calls-reconcile-list-absent-from-shipped-runtime`** — partially closed
  by the HELD each-alias branch (corpus dead pages 4 → 2). **Two remain**, different roots:
  `conformance/cases/style/flat-inline-token-unknown` and **`stdlib/data/form-for`** — a stdlib
  module shipping a dead bundle, which deserves its own dispatch.

---

## 🔭 THE DURABLE FINDINGS — method, not defects

### A. A browser-tier check that evals the full runtime template is not testing what ships

Every probe I ran for most of this session loaded `SCRML_RUNTIME` from `runtime-template.js` (the
`browser-conditionals.test.js` pattern). That template **defines everything the pruned
`scrml-runtime.<hash>.js` chunk omits**, so it masks every chunk-pruning defect. Executing against
the shipped chunk found a **conformance case that is a dead page while its own 886/886 suite passes
it** — and invalidated one of my own filed rows (a "control B works" that dies under the shipped
runtime). **Related trap:** a control can FAIL isolated and PASS whole-suite, because an earlier
file leaks the full runtime into the shared happy-dom global.

### B. "Recognise the valid forms and refuse the complement" — bryan, and it caught a second case in an hour

I filed a finding that amounted to *"make an ungrammatical form work."* bryan retracted it:
*"are we really supposed to inclusively handle every posible combonation of characters that could
ever be accidentally entered … I dont see an end to that, ever."* The pre-fix behaviour was the
violation of his own bar (invalid syntax compiled green, silently dropping content). **The very next
residual I picked up was the same mis-framing** — its filed direction would have widened
`match a, b` into legality against §18.19's grammar. Re-scoped before building.

### C. An unnamed shape is how a hole survives 30 ledger entries

`value-form` appears **zero times in SPEC.md** against ~30 in the gap ledger, ~10 compiler source
files, and three merged PRs. bryan asking *"what is a value-form if?"* is what surfaced it. A term
with no normative definition cannot be checked against an implementation.

---

## ⚑ MISSES (mine — six claims overturned by measurement)

1. **★ The `if=` crash mechanism.** I diagnosed the `@`-path regex truncating a dotted path — a
   textbook Rule 7 find, half-written into a brief. Executing both rewrite paths showed the AST path
   succeeds and emits the SAME shape for cases that WORK. **The rewriter is the wrong layer.**
2. **★ "A preceding `if=` breaks following interps."** Falsified outright by a minimal pair.
3. **★ "control B works"** (fn body + `@.` sigil) — a harness artifact; dies under the shipped runtime.
4. **★ The W-DEAD locus.** I relayed `usage-analyzer.ts` from the ledger into a dispatch **without
   tracing it**. That file cannot emit the warning. S295 verbatim: a locus produced by searching a
   symbol NAME is a hypothesis, because a symbol appears wherever it is MENTIONED.
5. **★ "The BS-structural sibling already validates."** Relayed from a reviewer into a fix round.
   It does not — the same invalid alias compiles at exit 0 at top level and emits a subtraction of
   two undefined names. **Mirroring it would have shipped a regression.** The agent caught it.
6. **★ A truncated probe.** I sliced a rendered body to 180 chars and nearly reasoned from the count
   — the §8 truncated-probe shape, in my own harness.

**Also:** three CWD slips into `scrml-support`, one of which answered a path-discipline question
about the wrong repository while looking perfectly well-formed.

---

## 🧷 STATE

- **main** `b9e97f1b` at wrap-cut; coherence 0/0; both repos clean.
- **Gaps: HIGH 53 · MED 163 · LOW 72 · Nominal 7.** Up on the day and more truthful for it.
- **Debts:** review floor **0 OWED at drain** (the wrap PRs are the inherent next-boot tail) ·
  dPA 0 unrun / 0 advisory · issue-debt 0 · corpus-zero 0.
- **Eleven PRs:** #678 #679 #680 #681 #682 #683 #684 #685 #686 #687 #688. One code landing (#688).
- **Worktrees: 3 probe worktrees REMOVED at wrap; 3 agent worktrees RETAINED** (two hold unlanded
  reviewed work; one is the landed W-DEAD agent, retained same-session for forensics).
- **Mechanical stream:** delta-log `[1729]`–`[1751]`. Changelog S371 block. Do not re-derive from
  this hand-off what those carry.
- ⚠️ `scripts/ruling-debt.ts` **still not on `origin/main`** — third session running. The instrument
  for undelivered rulings is itself undelivered, and this session found a ruled-but-unrecorded fix
  direction (S354 Q3) that it would have caught.

# scrml — Session 368 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-23. Booted `/boot` Profile A as SUCCESSOR to a LIVE S367-peter. Ran concurrent
with S367/S369/S370-peter throughout; `main` moved under me eleven times.

**The framing that matters, because it reorders everything else: bryan hand-wrote scrml for the
first time this session, and it went badly.** Every compiler defect below came out of that.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ FOUR OPERATOR RULINGS OWED — deliberately carried

bryan, verbatim at wrap: *"we will take these Qs next session."* None is blocked on work; all four
are surfaced with measurements and, where I had one, a recommendation.

1. **The `<db>` state-block locus.** `on mount { loadDashboard() }` inside a `<db>` body ships to
   the page as text and never runs (PA-reproduced; `samples/htmx-debate-dashboard.scrml`, clean
   compile exit 0, `loadDashboard` only ever bound to a click). SPEC says `<db>`/`<state>` bodies
   are **NOT default-logic-mode loci** — a state-block body is markup context. The sibling
   `W-STATE-BLOCK-BARE-WRITE-DECL` covers a bare *write* at the same locus at **Info**, and its own
   catalog text says it deliberately excludes state blocks from the hard error *"because a hard
   error there is a bigger call."* Options: **(a)** extend the Info lint to `on mount` and other
   statement forms · **(b)** promote the locus to the already-reserved
   `E-STATE-BLOCK-BARE-WRITE-DECL` · **(c)** make the `<db>` body a lift surface (a widening).
   **I did NOT recommend between (a) and (b)** — the earlier ruling *chose* Info here, so
   recommending (b) means arguing that choice was wrong, not merely incomplete.
2. **The bare-call migration — 2 files.** The build stopped rather than migrating, per its brief.
   Population derived from the compiler (`compileScrml({write:false})` over 2,193 files), not by
   text-scanning. Both hits are the comment-branch's **reproducer artifacts** (one is bryan's own
   hand-written file) and both fire on `log(...)` after a comment flush — i.e. they reproduce the
   defect being closed. **Newly rejecting them is arguably the point.** Migrate, exempt, or accept?
3. **Bare `if (){}` at a default-logic body-top ships as page text.** PA-CONFIRMED on `main` and on
   the build branch: `<program>` + `if (1) { }` → exit 0, `if (1) { }` in the body. ⚑ **This
   contradicts a §34 row**: `E-CONTROL-FLOW-IN-MARKUP`'s own text claims the §40.8 auto-lift *"fires
   only at `<program>`/`<page>`/`<channel>` direct-child roots"* and that without it such a
   construct *"would ship as raw `for(){}` text into the DOM."* It ships. In-§40.8, so not covered
   by the bare-call ruling, which deliberately rejected "diagnose every non-declaration run."
4. **`TILDE_TOKEN_RE` disagrees with the new bare-call rule.** A call-led run *containing* `~` is
   LIFTED and runs; the identical run without `~` is now an error. Pre-existing deliberate §32
   carve-out; reversing it is its own ruling.

### 2. ⚠️ THREE BRANCHES IN FLIGHT — complete, none landed

| branch | state | needs |
|---|---|---|
| `raw-egress-r9-work` @ `e755c431` | Finding 1 FIXED + executed (leak → `200 {}`); Finding 2 message-fixed | **the `corpus-emit-differential` it skipped** (a standing gate it self-reported not running) + a re-review at the new SHA |
| the bare-call build @ `7d5fe573` | complete: 19 merge-blocker tests, 3 conformance cases, differential 0 artifact diffs, bite proven both ways | **its S239 adversarial pass**, then ruling 2 above |
| the comment-flush fix @ `4f241cd1` | complete; differential clean (35 artifacts, all mechanically classified) | **its S239 pass** |

⚑ **`ast-builder.js` LANDING HAZARD.** The bare-call build and the comment-flush fix both touch
`liftBareDeclarations` — additively, in different places. **Cherry-pick, never file-delta**, or one
clobbers the other. The bare-call gate is a REJECT gate and must NOT be folded into
`matchesAnyLiftGate`.

### 3a. ⚠️ NEW INBOUND, arrived DURING this wrap — unread, routed to bryan

**`2026-08-23-from-peter-to-bryan-s370-autoawait-nested-call-converge.md`** (scrml-support inbox).
A **HIGH silent-wrong** from S370-peter's dog-food arc: a server-fn call **nested inside a larger
expression** (`call().length`, `f(call())`, `call() > 0`) is **not awaited at the inner call site**
in markup interps and inline event handlers — renders `""`/`undefined`, exit 0, no diagnostic. He
executed the asymmetry (fn bodies and direct cell-assign are correct; the class is position-scoped)
and **deliberately routed the converge decision rather than patching in-lane**, because it is the
§13.2-SHALL-by-RETROFIT axis — the S322 re-examination test verbatim. Turnkey entry:
`g-server-call-nested-in-expression-not-awaited-outside-fn-body`. Everything short of the authority
call is done.

**Also still unread:** the two S361 security HIGHs and the S364 `${…}`-interp-uniformity arc.
**Answered and filed to `read/` this session:** reset-init-await (merged), todomvc (merged),
promote-engine (REFUSED — return leg sent with the reproducer).

### 3. ⚠️ REVIEW FLOOR — 6 OWED, all peter-lane, deliberately not drained by me

#670 #671 #672 #673 #674 #675 — S369/S370-peter's dog-food arc, landed while I was working. **Three
are code-bearing** and want real adversarial passes, not carve-outs. I drained my own four
(#665/#667/#668/#669) and left his; reviewing a sibling's live work at my wrap would be worse than
leaving it visible.

---

## 🧷 WHAT LANDED (7 PRs)

`#659` review floor 3→0 · `#662` reset() unawaited-Promise + the thenable correction · `#663`
TodoMVC hollow gate · `#665` the asIs/unknown split · `#667` §40.8 gaps + my own correction ·
`#668` floor 5→0 (returned a HIGH) · `#669` **the stdlib client registry**.

**The headline fix:** client-side stdlib imports were **DOA for 17 of 21 modules**. A client bundle
is a classic script, so `import { slug } from 'scrml:format'` lowers to `_scrml_stdlib.format`, and
`RUNTIME_CHUNK_ORDER` declared **four** chunks against `const _scrml_stdlib = {}`. Compile exit 0,
`TypeError` at bundle load, dead page, **zero diagnostics**. Verified matrix: base 4 execute → tip
13 execute / 8 refused loudly / **0 silent**. The original DOA case now runs on `main`.

⚑ **The gate that should have caught it watched the wrong property** — `existsSync` of the shim
FILE (all 21 exist) while the deciding property is chunk registration (only 4 were). pa-base §10,
obligation and probe resolving to different artifacts, again.

---

## ⚑ MISSES (mine — recorded because they will recur)

1. **★ I committed conflict markers — the S354 miss verbatim, which I read at boot this morning.**
   My resolver asserted, exited non-zero, **never wrote the file**, and I chained `git add &&
   git commit` without checking. Four marker lines reached a commit; caught by grepping HEAD, not
   by the clean exit. **Fix: the resolver now REFUSES rather than asserts**, with a marker-count
   gate before staging — and it earned that on the very next merge by correctly refusing.
2. **★ I filed a gap wrong in TWO places and a dispatch overturned it.** I reported the `//` comment
   as the root and `/* */` as CLEAN. Re-measured: a bare call with **no declaration in the run leaks
   with no comment at all**, and **`/* */` above a `fn` leaks the DECLARATION ITSELF** — strictly
   more severe than what I filed. I had tested `/* */` before a *statement* and generalised from one
   shape. Corrected in place.
3. **★ bryan struck a load-bearing premise of mine: "valid JS" is not a scrml consideration.** I
   framed a bare word as *ambiguous* because it is a valid JS expression statement. **There was no
   ambiguity** — a call is a scrml logic form, a bare word is not; the JS premise did no work except
   make the argument wrong. Rule 7 one level up. → `[[feedback-valid-js-is-not-a-scrml-design-consideration]]`
4. **★ Two text-scanning measurements of mine over-counted badly** (a "prose at body-top" scan, and
   a db-top classification that misread the FLAGSHIP as failing when its top level is `<program>`).
   Both were caught before reaching an artifact. **Derive populations from the compiler/AST, not by
   regex** — the build round did exactly that and got a trustworthy 2.
5. **★ A merge commit shipped a stale `@generated` count.** `state.ts --check` exits 1 against it
   and 0 against a regen. Counts derive from the whole ledger, so regenerating *before* resolving
   computes a number the resolution invalidates. **The regen is the LAST step after a ledger merge.**
6. **★ zsh did not word-split my file list** and a corpus sweep silently processed one giant string
   — the recorded `[[feedback_enumerate_boot_populations_untruncated]]` lesson, walked into anyway.
7. **★ CWD drifted into a sibling directory** from an earlier `cd` and three probes answered about
   the wrong tree while looking well-formed.

**Score for the day: four dispatches corrected me, two of them on measurements I had made myself.**

---

## 🔭 THE DURABLE FINDING — the corpus has ZERO ergonomic feedback

bryan, verbatim: *"No human being has EVER written a single line of scrml before me, today. Every
single scrml line, file, example, etc. was written by llm. there are no 'people' that know the
workarounds."* He noted the PA **has never gotten this right**.

**Consequence, and it is structural:** an LLM author never reaches for the wrong form and *feels*
it. The corpus is a fixed point of *what the compiler accepted* ∩ *what LLM priors produced*, and
**neither term contains human ergonomics.** So:

- bryan's friction reports are not *better* evidence than the corpus — they are the **only**
  evidence. n=1 IS the whole n. Do not discount an item for being small or corpus-unsupported;
  corpus support cannot exist for an ergonomic claim.
- **Every adopter bug report to date is a correctness signal, never an ergonomic one** — those
  codebases are LLM-written too.
- The tier-1 conformance campaign is **structurally blind** to this class. That is the S322 pause
  argument arriving from a second, independent direction.
- `examples/25-triage-board.scrml:28` reverts a `scrml:data` import *"per Bug 18"* and uses vanilla
  `.sort()`. **That is not a human routing around friction** — it is an LLM+PA session logging a
  defect and moving on, which is why the underlying bug survived unre-derived until today.

⚑ **Owed to bryan next session:** his unfiltered friction list from hand-authoring. He was asked for
it and the session ran out before he sent it. **Do not pre-triage it** — small and subjective is
exactly where this class lives. In ~20 minutes and ~30 lines of my own hand-written scrml I hit six
friction events; five were noise or wrong-default and one was a silent wrong-output.

---

## 🧷 STATE

- **main** `674f890b` at wrap-cut; coherence 0/0; both repos clean.
- **Suite at close, MEASURED on this tree:** full `bun run test` **30,465 pass / 53 fail / 216 skip / 1 todo** across 1,401 files (259s); **conformance 883/883**; cloud `gate` **GREEN** at main HEAD (last 3 pushes `completed/success`). The 53 are the known pre-existing baseline (self-host ×3 · self-compilation · session · browser-tier) — the dispatches independently measured base 55 → tip 53 with a zero-new failure set-diff. ⚑ The 29,196-pass / 886-case figures in the bare-call build's report are on ITS branch; do not cite them as main's.
- **Gaps: HIGH 48 · MED 158 · LOW 71 · Nominal 7.** Up on the day and more truthful for it.
- **Debts:** dPA **0 UNRUN / 0 ADVISORY** · issue-debt **0** · corpus-zero **0** · review floor
  **6 OWED (all peter-lane)**.
- **Worktrees: 89 — NOT swept.** Three carry unlanded complete work (raw-egress-r9, bare-call,
  comment-flush). The S365 note stands: a working sweep probe exists but is deliberately unproven,
  and both obvious tests are structurally wrong under squash-merge.
- **Concurrent:** S367 → S369 → S370-peter ran throughout on the peter lane (dog-food arc). No
  collision — I stayed off `emit-each.ts`/`exportRegistry`/name-resolver all session.
- ⚠️ `scripts/ruling-debt.ts` **still not on `origin/main`** — the S353 finding reproduces for the
  Nth session: the instrument for undelivered rulings is itself undelivered.
- ⚠️ **`master-list.md` §0's newest PROGRESS entry is S352** — sixteen sessions of dashboard drift
  on the doc the contract names as the live "what's done / what's left" authority.


# scrml — Session 370 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

⚑ **CROSS-MACHINE:** S370 wrapped to swap to the LAPTOP. Everything is pushed (board S370-peter,
the peter→bryan inbox note, branch `gaps/s370-dogfood-server-fn-sql` = PR #675). **PR #675 is OPEN
(gaps + this wrap), gate pending — it owes a MERGE (docs-only; merge authz pending Peter).** Boot the
laptop, confirm #675's gate, merge it (or it strands per [[feedback-detect-stranded-unwrapped-session-at-boot]]).

S370 was a **DOG-FOOD ARC** on Peter's pick — server fns + `?{}` SQL — run end-to-end (real bun:sqlite
via Bun.serve + happy-dom, "emitted ≠ runs"). **2 finds, BOTH ROUTED to bryan (Peter's explicit call):**
1. ⭐ **HIGH `g-server-call-nested-in-expression-not-awaited-outside-fn-body`** — a server-fn call NESTED
   in a larger expr (`call().length`, `f(call())`, comparison) isn't awaited at the inner call site in
   MARKUP INTERP (`${loadRows().length}` → "") or an INLINE EVENT HANDLER (`onclick=@n=load().length` /
   `oninput` → undefined). Correct in a fn body (U1 emitCall), as the whole value, or via a resolved cell.
   **The profile STAGE re-examination axis verbatim** — a §13.2 SHALL by RETROFIT not by-construction;
   converge-don't-enumerate → bryan. Root + both fix directions in `docs/known-gaps.md` (S370 batch) +
   inbox note. **DO NOT build in peter-lane — Peter routed the converge decision to bryan.**
2. **MED `g-boolean-column-roundtrips-as-integer-0-1-not-bool-in-raw-select`** — SPEC:22293 "query helper"
   scope ruling → bryan.

### B. peter's lane — next buildables (unchanged from S369 §B; or DOG-FOOD MORE)
The S369 dog-food residuals are STILL OPEN (none built this session): `g-each-nested-in-fn-body-markup-fn-
stringifies` (MED, real wiring) · value-form `match`-in-each / markup-branch value-if drop (MED) · `g-library-
mode-multi-scrutinee-match-misparsed-as-single` (MED) · usage-analyzer each-in false-W-DEAD (LOW) · match-
structuredbody empty-object-arm (LOW, repro-owed). **OR dog-food more** — server-fn SQL core is solid;
unstressed: components/slots, channels/realtime, forms w/ server round-trips, `<if>` block element.
Reusable dog-food harness banked at `scratchpad/dogfood/` (server + client instrument).

### A. bryan's lane — LIVE (do NOT touch)
S368/bare-call arc likely LIVE (his `brief/s368-bare-call` + S368 voice ruling landed ~10min after my S369
wrap). S365 block STILL LIVE: 4 operator decisions + asIs-split re-review. 5 peter→bryan pings held (his to
process). PLUS my 2 new S370 routes (above) now in his inbox.

## WHAT LANDED (S370-peter) — 0 code, docs-only
Nothing to main yet. PR #675 OPEN = 2 gap filings + hand-off/changelog/delta-log. Board + inbox note pushed.

## ⚑ MISSES / lessons (S370)
- **★ DOG-FOODING BEATS THE LEDGER, reconfirmed again** — both finds came from RUNNING fresh server-fn SQL
  apps end-to-end, neither in the ledger. Emit-inspection would have missed the auto-await bug (it needs
  execution — the U1 lesson "emitted ≠ runs"). [[feedback-dogfooding-beats-mining-the-ledger]]
- **★ VERIFY THE HARNESS before trusting a negative** — ran the U1 known-good control (count 0→3) FIRST;
  it proved the harness sound, so the `undefined`/"" negatives were real, not harness artifacts.
  [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ Re-derived the root first-hand** (no filed direction to trust here) — traced retrofit-vs-by-construction
  through 4 emit sites; the emitted side-by-side (fn-body `(await call()).length` vs interp `await
  (call().length)`) IS the proof. [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ Same-class-across-positions → converge → route** — the auto-await class keeps reappearing per position
  (U1 fixed 3; found 2 more families) → the retrofit approach is wrong; converge is bryan's async-model call.
  [[feedback-repeated-review-same-class-means-converge-not-enumerate]] [[feedback-stay-in-adopter-lane-not-grammar-decisions]]

## 🧷 STATE (S370 close)
- **main** @ `3a7203ff` (unchanged — docs-only session; #675 not yet merged). scrml-support @ `0afe8fc`.
- **Gaps: HIGH 49 · MED 159 · LOW 72 · Nom 7** (hand-synced +1 HIGH +1 MED; `state.ts` refuses locally on
  the Windows ` · `-separator parse — bryan's lane, identical on clean base; Linux CI authoritative).
- **Review floor:** #675 (mixed docs/gap) will owe a marker on merge — inherent next-boot tail. Prior S369
  wrap tail (#665-#674) may still show OWED; not drained this session (docs-only, avoid bryan-collision).
- **Branches:** main + app-pinned + `gaps/s370-dogfood-server-fn-sql` (= #675, pushed, unmerged).
  **Worktrees:** main + scrml-pinned (clean; none created). **Maps:** unchanged (docs-only).
- **Env:** bun 1.4.0. NO full-suite run (no code landed). Dog-food harness uses real bun:sqlite + Bun.serve.
- **Sibling:** S368/bare-call bryan likely LIVE. Board S370-peter → WRAPPED.
- **Inbox:** no new peter inbound. Sent 1 outbound (S370 route to bryan). The 5 prior peter→bryan pings +
  bryan's S365 block remain his to process.

# scrml — Session 369 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

S369 was a LONG session: drained the review-floor tail (#661), landed item-3 (#664), then ran a
**DOG-FOOD ARC** — wrote fresh adopter apps, ran them in happy-dom, and **fixed 3 silent-wrong bugs**
(#670 · #672 · #673), each a pattern adopters write constantly, **none of which were in the ledger**.
**The durable takeaway (reconfirmed hard): dog-fooding beats mining the ledger** — every find came
from RUNNING a new app, not the gap list. Two durable finds also recurred: *the filed fix
locus/direction is a hypothesis* (item-3, 5th+ session) and *`/code-review` mis-fires on an
uncommitted branch — commit first + verify it targeted your diff* (memory
[[feedback-code-review-mis-fires-on-uncommitted-branch]]).

### B. peter's lane — next buildables (the dog-food residuals; or dog-food MORE)
1. **`g-each-nested-in-fn-body-markup-fn-stringifies` (MED)** — a markup fn nested inside another fn's
   body, consumed by a nested `<each>` in that body, stringifies. PA-verified PRE-EXISTING (not a #658
   regression). **Part 2 is the real blocker: `_eachMarkupFnNames` is NULL when a fn-body-nested each
   is emitted** (that pass runs outside the emit-each :3555/:3690 window — PA-instrumented at :1406);
   the mounting set must be wired into the fn-body emission pass. Weigh scope — real wiring.
2. **`g-value-form-if-fn-condition-not-reactive` follow-on / `g-each-inline-value-form-match-or-markup-branch-interp-dropped` (MED)** — the value-form `match` in an each (+ markup-branch value-if) still
   silently drops; and match-value INTERP is non-reactive on a separate path. Fix direction (both): the
   value-form-`match`-interp path is the shared next step — lower it + make the recognized-but-unlowered
   case LOUD (a `W-EACH-…` warning + its §34 catalog row).
3. **`g-library-mode-multi-scrutinee-match-misparsed-as-single` (MED)** — `match a, b` in a library-mode
   `fn` → `E-CODEGEN-INVALID-LOGIC`. PA-reproduced. Populate the multi-scrutinee node fields in the
   library-mode fn parse (or route a comma-header match to `emitMultiScrutineeMatch`).
4. **`g-usage-analyzer-blind-to-each-in-collection-fn-ref` (LOW, cry-wolf)** — a fn used ONLY in
   `<each in=fn(...)>` is falsely `W-DEAD-FUNCTION`'d. Sibling of the fixed closure-callee case
   (usage-analyzer.ts:691). Confirm lane (W-DEAD family noted bryan "g-263 arc") before building.
5. **`g-match-structuredbody-empty-object-arm-voids` (LOW) — REPRO OWED FIRST** (structural claim only).
6. **Or DOG-FOOD MORE** — it keeps paying out. Ideas not yet stressed: components/slots, channels/
   realtime, server fns + `?{}` SQL (auto-await), forms with server round-trips, `<if>` block element.

### A. bryan's lane — S365-bryan block below is STILL LIVE
FOUR operator decisions + ONE dispatch in flight (read the S365 block §1-2). Do NOT touch bryan's lane.

## WHAT LANDED (S369-peter) — 6 PRs
- **#661** review-floor drain (3 → 0): #658 re-verified clean by EXECUTION. docs-only.
- **#664** ⭐ **`g-library-fn-match-object-or-block-arm-body-returns-undefined` (MED) RESOLVED** —
  library-mode fn object-literal match arm returns its value (incl. empty `{}`), not silent undefined.
  Shared value-IIFE emitter, RETURN position. 3 S239 rounds also fixed empty-`{}`, object-arm
  auto-await, and a multi-scrutinee await-header strand.
- **#666** the first S369 wrap (item-3 + drain).
- **#670** ⭐ **DOG-FOOD: a value-form `${ if … }` interp inside `<each>` rendered EMPTY (silent-wrong)**
  — lowered to a raw ternary through the shared `lowerEachExpr`. (Residuals: value-form `match`/markup-
  branch in each — filed, held for a LOUD-warning + lowering follow-on.)
- **#671** the 2 filed dog-food gaps (docs).
- **#672** ⭐ **DOG-FOOD: `${ if valid { "" } else { "err" } }` (empty-string branch) rendered NOTHING
  (silent-wrong, VERY common)** — the parser blank-token skip swallowed the `""` literal; excluded
  STRING from the skip (both loops). S239 caught the second unpatched loop.
- **#673** ⭐ **DOG-FOOD: a fn-condition value-if `${ if isOn() … }` was not reactive (silent-wrong)** —
  the effect-vs-static decision string-scanned for `_scrml_reactive_get`, blind to a cell read inside a
  called fn; now reactive when the AST contains a `call` node. 2 S239 rounds (regex→AST scan + cycle guard).

## ⚑ MISSES / lessons (S369)
- **★ Filed locus/direction was a hypothesis again** (5th+ session). Re-derived first-hand. The
  real locus (shared `emitIifeBlockArmBody`) was not the filed `emit-library-shared.ts`.
  [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ /code-review MIS-FIRES on a branch with no committed diff** — it fell back to the latest
  history commit (#658) TWICE, silently reviewing the wrong code. FIX: commit the diff first, then
  review (or pass an explicit base like `HEAD~1`). Verify the review actually targeted your change.
- **★ VERIFY THE PREMISE of a claimed regression before fixing.** The mis-fired review called a
  nested-markup-fn bug "a #658 regression"; I reproduced it on the pre-#658 base and it was IDENTICAL
  → pre-existing. Peter had approved a fix premised on "regression"; the premise was false, so I
  re-decided (file + defer). [[feedback-gap-report-fix-direction-can-be-wrong]] [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ Filed several gaps not absorbed into fixes** — kept each fix scoped; documented residuals honestly.
  [[feedback-maximize-bryan-turnkey-on-routed-items]]
- **★ DOG-FOODING BEATS THE LEDGER (reconfirmed hard).** All 3 silent-wrong fixes + the filed finds came
  from RUNNING fresh apps in happy-dom, none from the gap list. Each hit a super-common pattern
  (conditional text in a loop, error message with an empty branch, a computed-fn condition) invisible
  until an app exercised it. Keep dog-fooding.
- **★ When the local suite is FLAKY, the Linux cloud gate is the authority.** #673's local full-suite
  count varied 6/8/15 run-to-run — a Windows temp-dir-lock flake (server-fn/session/csrf tests, IDENTICAL
  on the clean base). Do NOT chase a flaky count; isolate to the change's actual test area (was 27/27
  green) and trust the Linux gate (passed clean). [[feedback-verify-on-committed-state-not-staged-overlay]]
- **★ The adversarial S239 pass earned its keep repeatedly.** #672: caught a SECOND unpatched blank-skip
  loop (fix-the-class). #673: round 1 redirected a coarse regex → the correct AST-`call`-node scan; round
  2 hardened the walker (cycle guard). Run it on EVERY codegen change, and commit-first so it targets the diff.

## 🧷 STATE (S369 close)
- **main** @ `ff12b709` (#673) + this wrap. 6 PRs merged (#661/#664/#666/#670/#671/#672/#673), all
  Linux-gate green. Coherence target 0/0; both repos clean.
- **Gaps: HIGH 48 · MED 158 · LOW 72 · Nominal 7** (`@generated:gap-counts`). Net peter this session:
  RESOLVED #664 object-arm · #670 value-if-in-each · #672 empty-string-value-if · #673 fn-cond-reactive;
  FILED (open) fn-body-each · multi-scrutinee · structuredbody · each-value-form-match/markup-branch ·
  usage-analyzer-each-in · fn-condition-follow-on. (bryan's concurrent PRs also moved counts.) Synced
  by hand via `gapCountsFromTokens` (state.ts --write blocked locally — see below).
- **Review floor: 0 OWED** at each land; the wrap PRs are the inherent next-boot tail.
- **⚑ LOCAL TOOLING SNAG (pre-existing, bryan's lane):** `bun scripts/state.ts` REFUSES on this
  Windows checkout — "PARTIAL PARSE, 0 of 1420 delta-log entries matched" (the ` · `-separator
  encoding blindness bryan filed HIGH; identical on the clean base, NOT mine). So gap-counts were
  synced by hand via `parseGapMarkers`+`gapCountsFromTokens` (which only read known-gaps.md). CI
  (Linux) parses fine — main's gate is green. FACTS.md regenerated normally (`facts.ts --check` PASS).
- **Branches:** main + app-pinned only (all fix branches auto-deleted on merge). **Worktrees:** main +
  scrml-pinned (clean; the failed pre-#658 comparison worktree was pruned).
- **Maps:** all surgical codegen edits (`emit-control-flow.ts` · `emit-each.ts` · `ast-builder.js` ·
  `emit-event-wiring.ts`) — no new modules/entrypoints; maps unchanged.
- **Env:** bun 1.4.0. `gh pr merge --squash --auto` throughout (each auto-merged on green gate; several
  needed a rebase past bryan's fast-moving concurrent PRs — gap-count block re-synced to the merged
  truth each time). ⚑ **Windows temp-dir-lock flake** in the local suite (server-fn/session/csrf) — NOT
  a code issue; trust the Linux gate.
- **Sibling:** S365-bryan board reads LIVE (4 decisions + 1 dispatch pending). Board S369-peter → WRAPPED.
- **Inbox:** 5 peter→bryan pings still held in `handOffs/incoming/` (awaiting bryan's stamp — his lane,
  correctly not filed). No new inbound for peter.

<!-- ================= S367-peter (history) below ================= -->

# scrml — Session 367 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

S367 took S364 buildable list **item 2** — the each-interp IMPORTED-fn residual — and landed it
(#658). **The durable finding recurred: the filed fix-direction is a hypothesis.** "Thread the
exportRegistry" was INCOMPLETE (the registry carries no fn body; no imported AST reaches codegen's
ctx) — re-derived first-hand into the real fix. [[feedback-gap-report-fix-direction-can-be-wrong]]

### B. peter's lane — the S364 buildable list, item 3 remains (or dog-food)
1. ~~item 1 (bare-fn-no-trailing-newline)~~ — DONE S366 (#649).
2. ~~item 2 (each-interp IMPORTED-fn residual)~~ — **DONE this session (#658).**
3. **`g-library-fn-match-object-or-block-arm-body-returns-undefined` (MED)** — the #636 FN path
   still lowers a brace-delimited arm body (`1 :> {x:1}`) as a statement block → silent `undefined`;
   the #641 decl fix sidesteps it via the tilde lowering, the FN path wants the same. bryan
   re-confirmed at S365 it reproduces live. Clean peter-lane cross-mode parity. **Repro-first.**
4. **Or DOG-FOOD a fresh shape** — the durable S358→S364 finding: cheap ledger veins are worked out;
   fresh clean bugs come from running a new adopter program.

### A. bryan's lane — S365-bryan block below is STILL LIVE
S365-bryan CLEARED the five-branch backlog but left **FOUR operator decisions + ONE dispatch in
flight** (read the S365 block §1). Plus an **S368-bryan session is currently LIVE** (landed #656 wrap,
#657 dpa-036 ratify, #659 review-floor drain). Do NOT touch bryan's lane (successor discipline held).

## WHAT LANDED (S367-peter) — 1 PR
- **#658** ⭐ **`g-each-nested-markup-interp-stringifies` residual 2 (cross-file IMPORTED markup fns)
  RESOLVED** (MED gap stays open on narrower residuals). A shared `markup-return-scan.js` (single
  source for emit-each + module-resolver) + a `returnsMarkup` export flag (isAsync rail) + ONE
  graph-level fixpoint over re-export AND call edges → an imported/re-exported/wrapped markup fn
  mounts at any depth. Fail-safe + nesting-aware. 9-case merge-blocker + executed-DOM test.

## ⚑ MISSES / lessons (S367)
- **★ Scope-creep not flagged early enough.** Item 2 was triaged "small compute" and became a
  cross-module inference pass through FOUR S239 review rounds (each finding a real issue: one-hop
  miss → fixpoint; re-export edge; nested-fn name collision; cleanup). The convergence was the right
  call once committed, but I should have surfaced the scope blow-up to Peter around round 2 rather
  than sinking four cycles in. Recognize "this outgrew the buildable" as a checkpoint signal.
- **★ The filed direction was wrong again** — re-derive first-hand before building. 5th+ session
  running. [[feedback-gap-report-fix-direction-can-be-wrong]] [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ Repeated review, same class → converge.** r1+r2 kept finding propagation-incompleteness → I
  stopped patching hops and built ONE complete graph fixpoint. [[feedback-repeated-review-same-class-means-converge-not-enumerate]]
- **★ CRLF hazard:** my edits flipped module-resolver.js to mixed CRLF/LF, inflating the diff to the
  whole file (1883 lines) under `autocrlf=true`; normalizing to pure LF collapsed it to the real 114.
  Watch line endings on Windows edits to keep PR diffs minimal.

## 🧷 STATE (S367 close)
- **main** @ `82fb7e68` (#658) + this wrap. Coherence 0/0. Cloud `gate` GREEN on #658 (rebased twice
  past the fast-moving main — S368-bryan live). `tracking` red = known non-required fs.watch baseline.
- **Gaps:** g-each residual 2 closed (gap stays `open` on narrower residuals → no count change). Other
  counts per `@generated:gap-counts` (bryan's S365/S368 filings moved HIGH/MED; regen matched base).
- **Review floor:** #658 (code) owes a marker → inherent next-boot tail. S368-bryan drained the floor
  at its boot, so nothing else owed by me.
- **Branches:** main + app-pinned only (fix branch auto-deleted on merge). **Worktrees:** main +
  scrml-pinned (clean). **Maps:** new file `markup-return-scan.js` + surgical edits — a shared codegen
  util, no new entrypoint/module; maps effectively unchanged (note the new file at next map refresh).
- **Env:** bun 1.4.0. `gh pr merge --squash --auto` (armed; landed after 2 rebases). Full unit
  17756/0, conformance 1597/0, integration name-set == base (pre-existing baseline fails only).
- **Sibling:** S368-bryan LIVE. Board S367-peter → WRAPPED.

<!-- ================= S365-bryan (STILL LIVE: 4 decisions + 1 dispatch) below ================= -->

# scrml — Session 365 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-22 → 08-23. Booted onto S354's backlog: **five branches complete and pushed,
none landed, five operator decisions pending.** All five branches are now resolved.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ ONE DISPATCH IN FLIGHT — claimed, not lost

**`feat/s365-asis-split-rung0` @ `915eee4d`** — the SPEC-text fix round **COMPLETED after the wrap**.
All five blockers fixed plus four ride-alongs; one position deferred and filed. **It owes a
RE-REVIEW at `915eee4d` before it lands** — a fix round invalidates the review that produced it,
and the prior LAND verdict was against `d63ba668`. Do not land it on the strength of that verdict.

**What it proved, and this is the reason to trust the diff:** count-neutrality **twice** — this
round's own edits are byte-identical across a full 2,362-file census (399 codes, 9,954 gaps, 490
files), and against `origin/main` the *only* delta across all 398 shared codes is
`W-TYPE-031-UNPROVEN: 0 → 9954`. It also merged `origin/main` twice mid-round, including the wrap,
resolving a `docs/known-gaps.md` collision by keeping **both** entries.

**Three findings from it that outlive the branch:**
- **`s34-census` structurally cannot catch a wrong LINE.** Its resolver strips `:N`, so
  `type-system.ts:10112` — pointing at an `E-ERROR-010` fragment — **resolved and passed the gate.**
  Paths and symbols are checked; line numbers are not. Widening it is an untaken tooling call.
- **`write: false` test helpers are blind to every emit-pass diagnostic.** `E-CODEGEN-INVALID-LOGIC`
  is raised at emit: `write:false` → `[]`, `write:true` → the real code. The CLI showed it, the
  harness did not. Generalises well beyond this branch.
- **`docs/FACTS.md` stales on *any* source edit** (its `@generated` table reads `compiler/src` LOC),
  so regeneration belongs in the same commit as the edit — it went stale twice in one round.

**The branch is DO-NOT-LAND on SPEC text only.** The code is the cleanest thing this session
produced: **2,724 emitted artifacts byte-identical to main**, and the corpus diagnostic delta is
exactly one line (`+9954 W-TYPE-031-UNPROVEN`, all 397 other codes unchanged). Five blocking
findings, all text:

1. §7.5.2 + §14.7's headline *"Type inference SHALL NOT produce `asIs`"* is **refuted by a 6-line
   program on the branch itself** — an un-annotated fn param still yields `asIs` (`E-TYPE-025`).
   `tAsIs()` has 101 call sites; this converts one.
2. §14.7 contradicts an unamended bullet two lines above it (`SPEC.md:8219`).
3. The `_{ }` carve-out is unconditional in text, conditional in code (guard is `!(n.foreignNode)`;
   no sidecar at program scope).
4. The §34 `E-TYPE-031` row cites `type-system.ts:10112` (that line is an **E-ERROR-010** fragment;
   the real push is **10364**), three wrong section refs, and asserts a fire domain with **zero code
   behind two of its three positions**.
5. `Result<ResolvedType, InferenceGap>` — the type is named `InferenceResult`.

### 2. ⚠️ FOUR OPERATOR DECISIONS PENDING

1. **`dpa-036` call 5 — the warning→error flip at v1.** HELD deliberately. The numbers now support
   deciding: **9,954 warnings across 490 of 2,362 files.** The review's false-positive analysis:
   **3.6% hard FP** (Tier A — bool/`not`/template literals, comparison results: 362 sites an adopter
   refutes at a glance), 12.3% including one-lookup-away, **87.7% genuine**. Tier A is the
   credibility risk, not the volume — §8 cry-wolf keys on refutable-at-a-glance.
2. **The Q4 re-ruling** (the top-level `<program>` attribute question). **My original ruling's
   premise was REFUTED** — §4.12.2 is silent about top-level, not prohibitive, and `lang=` is a
   plain-YES row SPEC makes canonical at top level. The honest axis: *should an attribute the
   compiler silently DISCARDS draw a diagnostic, and does that reach all **nine** position-blind
   registrations or only three?* `lang=`/`build=`/`capabilities=` must be excluded by name.
   `nested-program-r4-work` is held on this and nothing else.
3. **The nine live `never` fallthrough failures** — fix-vs-drain. Each is a real silent-fallthrough
   bug (`MarkupValueExpr` in the union, handled by no switch).
4. **`raw-egress-r8-work` has still never landed** — complete through round 8, S239-passed in
   rounds 4/6/8. Peter's security HIGH "B" is **sequenced behind it** (fixing that crash unmasks a
   live `passwordHash` leak), so this branch blocks his lane.

### 3. FINDINGS THAT MUST NOT BE LOST

- **The same gate went hollow TWICE in one session.** `delta-lint` — total blindness (fixed), then
  **partial** blindness (fixed): it was silently dropping four real entries from the live log AND
  from the digest projection. *A gate proven only on well-formed input is unproven against the
  degenerate case.*
- **`delta-lint --fix` has two independent corruption modes**, both filed HIGH and **one still
  open**: it renumbers the wrong side on a merge (first-in-file order is blind to which side is
  published), and under partial blindness it renumbers onto an invisible number then reports PASS.
- **There is no TypeScript build**, and `ci.yml:4` advertises one. The `never` idiom was already
  deployed and already red.
- **`auth="required"` does not protect the app's own HTML document** — unauthenticated
  `GET /secure.html` returns **200 with the content**, against §52.13's verbatim *"every request to
  this scope SHALL be authenticated."* Filed HIGH; a BUG, not a doc gap.
- **A working worktree-sweep probe exists** (owed since S268) — but **nothing was swept**, because
  it owes a bite proof. Both obvious probes are structurally wrong under squash-merge.
- **flogence's `bridge-tool.scrml:25` still carries the narrow delta-log regex** — a third copy
  across two repos, still dropping the same four entries. Routed to its inbox.

## ⚑ MISSES (mine)

1. **★ I over-read a governing sentence and ruled on it.** Q4 rested on "§4.12.2 lists these as
   nested attributes"; the table is *titled* Nested Attributes and is **silent** about top level.
   The dispatched agent stopped on my brief's own trigger and was right.
2. **★ Three relayed premises failed, and the pattern is sharper than "I relay badly":** all three
   were me reading a sentence that had the right WORDS for a DIFFERENT QUESTION. The
   governing-sentence gate caught all three — because the brief must quote the sentence, an agent
   could check it.
3. **★ Five relayed FIGURES failed** (141 headings → 36; mutation counts 5/2/4 → 9/5/2; three
   different stale-citation counts). Rule: a number I did not run does not go in a durable artifact.
4. **★ I ran `git stash` mid-merge** to test a warning's provenance. It could not stash unmerged
   paths, the paired `checkout HEAD --` **destroyed `docs/known-gaps.md`'s auto-merge**, and the
   stray `pop` targeted an unrelated stash. Recovered by aborting and redoing from a script.
5. **★ I asserted a mechanism whose enforcer did not exist** — the `never` fallthrough needs a
   TypeScript build; there was none.
6. **★ I surfaced bare opaque tokens all session** (`#1`/`#3`, `Q1`-`Q9`, `F1`-`F8`) against an
   explicit contract rule, and bryan had to ask *"what is 1? what is 2? … do I need to continue?"*
   The fourth question also exposed a dropped item — call 4 had never been surfaced at all.

## 🧷 STATE

- **main** `c96e7012` before this wrap; coherence 0/0; both repos clean.
- **Gaps: HIGH 46 · MED 152 · LOW 68.** Seven filed this session, all PA-reproduced before filing.
- **Debts: review floor 0 (drained twice; the wrap PRs are the inherent tail) · corpus-zero 0 ·
  issue-debt 0 · dPA 0 UNRUN / 0 ADVISORY.** ⚑ That last figure was FALSE when first written —
  `dpa-036` was ratified into `user-voice`, the delta-log and the build brief, but the QUEUE ROW
  was never flipped, so `dpa-debt` correctly read 1 ADVISORY. Caught by re-running the probes
  after the hand-off was drafted. **A ruling recorded everywhere except the drain path is, to the
  probe, not ruled.** Fixed; the row now carries all four dispositions inline.
- **Branches held:** `nested-program-r4-work` (Q4 re-ruling) · `raw-egress-r8-work` (never landed) ·
  `feat/s365-asis-split-rung0` (SPEC text, fix round in flight).
- **Worktrees RETAINED — do not sweep.** The sweep probe is recorded but unproven.
- **Peter's inbox: 5 live pings** — 3 stamps owed, 2 security HIGHs held (one sequenced behind
  raw-egress-r8), 1 routed arc unstarted. Deliberately NOT filed to `read/`.

---

# scrml — Session 366 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

S366 booted as SUCCESSOR to the LIVE-but-AFK S365-bryan and worked strictly non-intersecting
peter-lane. **Two PRs landed; the S356-parked heading-drift sweep is now DONE (drift 0).** The
durable finding recurred a 5th session running: **the filed fix-direction — and my own root
hypothesis — is a hypothesis to re-derive first-hand.** On the sweep, my "#511 fixed a different
facet" guess about `g-request-is-some` was itself wrong (the value/bool/class-attr path routes
cleanly on HEAD); on #649 the fix needed instrumentation, not the filed locus taken on trust.
[[feedback-gap-report-fix-direction-can-be-wrong]] [[feedback-staleness-spot-check-catches-silently-fixed-gaps]]

### B. peter's lane — the S364 buildable list, items 2 & 3 remain (take in order)
1. ~~`g-library-bare-fn-no-trailing-newline-brace-strip` (LOW)~~ — **DONE this session (#649).**
2. **each-interp IMPORTED-fn residual** (a #627 follow-on) — cross-file imported markup fns still
   stringify in a nested `each` interp (exportRegistry threading into `collectMarkupReturningFnNames`).
   NOT yet re-derived on HEAD — repro-first before building.
3. **`g-library-fn-match-object-or-block-arm-body-returns-undefined` (MED)** — the #636 FN path still
   lowers a brace-delimited arm body (`1 :> {x:1}`) as a statement block → silent `undefined`; the
   #641 decl fix sidesteps it via the tilde lowering, the FN path wants the same. **bryan re-confirmed
   at S365 it reproduces live** (fn path returns `undefined` where #641's decl path returns `{x:1}`).
   Clean peter-lane cross-mode parity.
4. **Weigh before building / DOG-FOOD:** the durable S358→S364 finding holds — the cheap ledger veins
   are worked out; after the library-mode follow-ons, fresh clean bugs come from dog-fooding a new
   adopter program, not the ledger.

### A. bryan's lane — UNCHANGED, still pending (read the S354-bryan block below)
S365-bryan advanced `main` through #647 (review-floor drains, three S239 verdicts, instrument-integrity
landed) but **did NOT resolve** the five branches / five operator decisions / dpa-036 ADVISORY carried
from the S354 wrap — all still pending bryan + operator. Plus the S364-routed `${…}`-interp-uniformity
arc (queue group-4 K) is received, not started. Do NOT touch any of it (successor discipline held).

## WHAT LANDED (S366-peter) — 2 PRs
- **#648** ⭐ **heading-drift sweep** — 20 stale `### ` gap headings realigned to their verified `@gap`
  markers (19 open→resolved, 1 resolved→open). Zero marker changes (gap-counts byte-identical). The 5
  suspect batch-flipped markers were first-hand re-compiled on HEAD (all genuinely resolved); no
  false-resolved found. `headingMarkerDrift()` now 0.
- **#649** ⭐ **`g-library-bare-fn-no-trailing-newline-brace-strip` RESOLVED** (LOW) — pair the `${…}`
  wrapper-strip so a bare-fn library file keeps its own `}`. Repro-first + instrumented root; bug-class
  swept; biting merge-blocker test; S239 pass sound (one test-fidelity finding applied). LOW 69→68.

## ⚑ MISSES / lessons (S366)
- **★ My own root hypothesis was wrong again** — the "#511 fixed a different facet" call on
  `g-request-is-some` was false (re-compiled first-hand → resolved). 5th session where first-hand
  re-derivation overturns a filed/assumed direction. [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ A batch "bookkeeping" marker-flip with no prose resolution note is a false-resolved RISK CLASS** —
  the 5 suspects flipped resolved in S218/S220 chores with the prose left reading open; all turned out
  genuinely fixed, but the pattern (marker moved, prose + heading didn't) is exactly where a
  false-resolved would hide. Verified each on HEAD before propagating "resolved" into a 2nd artifact.
- **★ The S239 pass caught a real test-fidelity gap** — `validateEmit:false` meant the merge-blocker's
  `expect(errors).toEqual([])` never exercised the E-CODEGEN gate the gap is about; switched to
  `validateEmit:true`. Run `/code-review high` on every codegen dispatch, tests included.
  [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **Verified a satellite's "all resolved" verdict first-hand** rather than trusting it (2 highest-suspicion
  repros re-compiled by me + the other 3's emit/browser-gate) — the satellite is a claim, not the answer.

## 🧷 STATE (S366 close)
- **main** @ `c2874d6c` (#649) + #648. Coherence 0/0. Cloud `gate` GREEN on both merges (`tracking` red =
  known non-required fs.watch baseline). #649 rebased onto main after #648 (strict:true up-to-date; clean).
- **Gaps: HIGH 45 · MED 149 · LOW 68 · Nominal 7** (`@generated:gap-counts`). LOW 69→68 (#649 resolve).
  20 headings realigned, 0 marker/count changes from the sweep.
- **Review floor:** #648 (docs-only sweep) + #649 (code) owe markers → the inherent next-boot carve-out
  tail. **Also: #647 (bryan's S365 inherent tail) still shows 1 OWED at boot** — bryan's lane, not drained
  by me (avoid colliding with his LIVE `pr-reviews.md` footprint).
- **Branches:** main + app-pinned only (both fix/docs branches auto-deleted on merge). **Worktrees:** main
  + scrml-pinned only (clean). **Maps:** surgical codegen edit (emit-library wrapper-strip) — no new
  modules/entrypoints, maps unchanged.
- **Env:** bun 1.4.0. Integration+conformance clean; 6 baseline fails (self-host×3/self-compilation/session
  — none codegen, pre-existing across prior sessions). `gh pr merge --squash` ran PA-side this session
  (both #648 direct + #649 via armed auto-merge after rebase); no harness block hit.
- **Sibling:** S365-bryan board still reads LIVE ("FINAL for this stretch", AFK). Board S366-peter → WRAPPED.

<!-- ================= S354-bryan (STILL PENDING) below ================= -->

# scrml — Session 354 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-19 → 08-22 (four calendar days; `/boot recover session` as the recovery successor
to a crashed S353). **Nothing merged to main by this session. Five branches in hand, all pushed,
none landed. Five operator decisions pending.**

**Read this framing first: the session's output was DIAGNOSIS, not landing.** Two compiler arcs ran
to eight and four rounds respectively; a retrofit census and an instrument-integrity pass ran
alongside. What changed is that a set of *believed-closed* surfaces are now measured, and a set of
*deferred* ones lost the reason they were deferred under.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚠️ FIVE BRANCHES IN HAND — all pushed, none landed, none merged

| branch | ahead | state | needs |
|---|---|---|---|
| `raw-egress-r8-work` | 39 | **complete through round 8.** Floor 0 code-deltas / 1905 shared sources. Four regression guards on the closed leak + a CONTROL. | land (rounds 4/6/8 each passed an S239 pass; r8's corrections are post-review) |
| `nested-program-r4-work` | 32 | **complete through round 4.** Consolidation landed; double-fire dissolved; `E-FOREIGN-010` built. | **S239 pass owed** — never reviewed |
| `handle-onion-top-level-dispatch` | 8 | **complete.** Onion at top-level in all 3 dispatchers. | **S239 pass owed**, and DECISION 1 below blocks it |
| `instrument-integrity` | 7 | **complete.** `codeCounts` + census fixes + 6 gate fixes, 10 filed. | **S239 pass owed** |
| `fix/s354-…-artifact-gap` (**PR #581**) | 20 | gap filings, review-floor drain, all S354 rulings banked, delta-log fix | mergeable; **blocks S356-peter's heading-drift sweep** |

⚑ **All five are behind a fast-moving `main` (a sibling operator lands continuously). LAND BY REBASE
OR MERGE — NEVER FILE-DELTA.** Measured: a wholesale file-delta would revert #634 (E-FN-003) and
#624 (re-indenter, ×2 HIGH) and drop 6 gap entries + 24 `@gap` marker changes.

### 2. ⚠️ FIVE OPERATOR DECISIONS PENDING

1. **CSP / SSR-seed fork (BLOCKING `handle-onion`).** `headers="strict"` now actually applies (it
   never did before). §39.2.5 pins `default-src 'self'` — and **scrml's own emitted inline SSR-seed
   `<script>` + runtime inline `<style>` violate it.** Chromium-measured: main `__scrml_ssr_state` =
   object / 0 violations; branch = **undefined / 2 violations**. The §39.2.5 escape ("override via
   `handle()`") does not cover compiler-emitted content. **PA rec: move the seed to
   `<script type="application/json">` + `JSON.parse`; ship transition keyframes in the emitted
   stylesheet.** Zero adopter cost, small emit change.
2. **`handle()` auth semantics.** Unauthenticated `GET /quote.pdf` → **200**, while an
   unauthenticated route → 302. `_scrml_auth_check` is per-route, downstream of `resolve()`.
   **PA rec: this is arguably CORRECT for a raw escape** (short-circuit = author owns the path,
   incl. auth) — the defect is that nothing says so. Document normatively + consider a lint.
   Protected *columns* ARE covered (`E-PROTECT-004` names the `handle()` body).
3. **Bank the deferral queue as a tracked artifact?** ~54 (Part A) + 23 (Part B) SIZE-deferred items
   whose reason is now void. Currently only in scratch + this hand-off.
4. **Take the three confirmed flips to rulings?** dpa-033 type route · dpa-036/§7.5 (already banked
   UNRUN) · body-split Ext 3+2.
5. **Renumber the 9 historical delta-log duplicates?** `--fix` would RECOVER entries the flogence
   cursor skipped, but rewrites shared history while a sibling is live.

### 3. ⭐ dpa-036 HAS RUN — COMPLETE (ADVISORY), awaiting bryan. **Its verdict INVERTS the PA's.**

The dPA fired during this wrap and completed it (`[1679]`, artifact
`scrml-support/docs/deep-dives/type-system-assignability-dpa-036-2026-08-22.md`). **Read the
artifact before ruling — the PA's framing was wrong on the axis:**

- The PA offered **(a) literal propagation vs (b) a real inference pass** as the one-way fork, with
  the `asIs` question as a detail *inside* (b). **The dPA inverts both**, using `[1678]`'s own
  surface/internals split against the item: **(a)→(b) is REVERSIBLE internals**, so the a/b choice
  is *subordinate scheduling*, not a door. **The one-way fork is the `asIs` SEMANTICS.**
- **5/5 poles converged independently:** `asIs` must mean ***the developer signed for it***, never
  ***the compiler did not look***. Inference failure must be **structurally incapable** of producing
  `asIs` — yielding a loud, countable `unknown^gap(k)` instead.

That is precisely the decay the PA flagged ("if `asIs` silently absorbs every un-inferable
expression, (b) becomes (a) and nobody notices") — promoted from a caveat to the actual ruling axis.

**§7.5: scrml has type ANNOTATIONS but no type SYSTEM for expressions.** `[EXEC]` — three of four
positions are silent: typed cell, argument, and return all compile clean; only `let` fires. Operand
typing does not exist (`"x" * 2` compiles). **bryan hit this independently writing real scrml.**
Ranked #1 by the retrofit census. The queue item carries the full `[EXEC]` measurement — do not re-derive it.

### 4. THE STANDING DIRECTION CHANGE — `[1678]`, read before citing any deferral

> *"that restraint is completely gone for me. days, months or years. dosn't matter to me any more"*

**Size is no longer a valid deferral reason.** Valid reasons remaining: a genuine dependency, an
unratified fork, an unwitnessed need. **The cost boundary is the load-bearing half:** development
cost yes, ADOPTER cost no — which makes refusal-based fixes the *cheap* answer, not the sound one.
**"One chance" binds the AUTHORING SURFACE, not compiler internals** (`E-PROTECT-004` was rewritten
7× this week at zero adopter cost).

⚑ **Consequence not yet propagated:** every artifact reading *"deferred — too large"* / *"defer to
v2"* reasons from a withdrawn constraint. `master-list.md:143` still defers cross-function
body-split at *"~200-400h"* — a number bryan's own **S258** ruling already refuted
(`known-gaps.md:6429`: the estimate was for a seam the corpus does not need; the real work was
~80% built; Phase 1 landed S269).

### 5. FINDINGS THAT MUST NOT BE LOST

- **The retrofit census refuted its own instrument.** §32 `~` has zero gaps AND a fail-closed SHALL
  — **and the rule does not fire.** A zero bug family reads identically for "sound" and
  "unenforced". Sharper predictor: enforced-fail-closed → ~0 bugs · enforced-fail-open → large
  family (§12 = 35 gaps) · **unenforced → 0 bugs and no signal.** Four more instances found:
  `E-FN-009`, `E-ENGINE-012`, `E-STATE-TRANSITION-NO-RETURN`, `E-LANGUAGE-VERSION-TOO-NEW` — zero
  fire sites, 13/5/5/1 SPEC mentions.
- **`corpus-zero-debt` printed `✅ no debt` over 288 unscanned deep-dives** from any worktree
  (`../scrml-support` does not resolve there). It is a BOOT probe. Fixed on `instrument-integrity`;
  now prints `⚠️ NOT VERIFIED — scanned ZERO artifacts`. Surfaced 5 genuinely owed dispositions.
- **3 of 5 blocking CI gates could pass while measuring nothing.** Two fixed, one closed, one was
  already the reference, one narrow-by-design.
- **106 of 883 conformance cases already emit some code more than once, invisibly.** `codeCounts`
  built; its bite proof found a real double-fire in a ratified passing case (`E-ERROR-005` ×2).
- **`raw` is in three contradictory states:** dpa-012 RATIFIED *"KILL `raw` PERMANENTLY"* · §61.10
  *"DEFERRED, gated on a witnessed case"* · queue FACT 7 *"the witness has arrived… the deferral
  has EXPIRED"*. And the named interim (`handle()`) was runtime-broken. **Record integrity, on a
  live adopter's path.**
- **`!{}` arm bodies have no tree form** (`ast-builder.js:15069` — `handler` is a source STRING).
  Every structural pass is blind inside an arm. Filed HIGH.
- **§44.6 / §19.10.5 / §8.9 disagree about whether scrml has transactions.**
- **`resolve()` was never awaited** — the SPEC's own worked example + `examples/20-middleware.scrml`
  bound a Promise. Fixed on `handle-onion`.

### 6. OWED OUTWARD

**Five peter→bryan pings held in `scrml-support/handOffs/incoming/`** (deliberately NOT filed to
`read/` — filing them hides a live queue). One needs a ruling (`handle()` §40.3 — **now RULED, see
`[1677]`; the ping can be closed once the branch lands**); three need a stamp (reset-init-await
HIGH — *bryan filed it, and its ledger premise is FALSE* · promote-engine SPEC §56.6 ·
todomvc hollow-gate); one is entangled (two security HIGHs, one of which **must sequence behind
`raw-egress-r8` landing** or fixing it opens a live leak).

**Three peter branches are pushed with NO PR** — invisible to `gh pr list`:
`feat/promote-engine-same-named-cell-lift` · `fix/s359-todomvc-hollow-gate` ·
`fix/s360-reset-init-await-parity`.

---

## ⚑ MISSES (mine, recorded because they will recur)

1. **★ I propagated "five executed leaks" all session — it is TWO executed, THREE latent.** Origin:
   a harness that sliced an in-process peer from the token `function` and dropped its `async`. I
   put it in the `[1676]` bank, the voice ledger, an escalation and four briefs **without executing
   it myself.** Corrected at `[1679]` + in place at `[1676]`. **My verification holds when I
   EXECUTE and fails when I RELAY** — third recorded instance.
2. **★ I renumbered the SIBLING's already-merged delta-log entries.** In a MERGE, `HEAD` is my
   branch; in a REBASE it is upstream. I carried the rebase assumption across. Caught only by
   inspecting what the renumbered lines *were*. The retry asserts orientation explicitly.
3. **★ I committed conflict markers.** The resolution script asserted and exited non-zero, the file
   was never written, and the next command chained `git add` without checking. Caught by grepping
   `HEAD`, not by trusting "Successfully rebased".
4. **★ Twice I built a success signal that cannot fail** — `echo "PUSHED"` after a rejected push,
   and `push_exit=$?` reading a pipeline's `tail`. Now: compare remote and local refs.
5. **★ Three of my briefed premises were corrected by the agents** — `#582` vs `#590`, the SPEC
   provenance direction, and the symbol-table hypothesis. Plus two in one dispatch
   (`E-NESTED-PROGRAM-CONTEXT-NOMINAL` not on main; `delta-lint.ts` not on main).
6. **★ I banked dpa-036 wrong twice** — `dpa-debt.ts` anchors on the LEADING TOKEN of **column 2**
   (`BANKED — UNRUN`). Both misses read as `0 UNRUN`. Caught by running the probe, not trusting the
   append.
7. **The largest generator of unstated deferrals is my own dispatch protocol** — agents end with
   `DEFERRED_ITEMS`, the PA banks them verbatim, **and no reason is ever recorded.** Those cannot
   be re-derived at all.
8. **Method correction from the instrument audit:** *"the gate does not catch X"* and *"the gate
   deliberately does not catch X"* produce **identical evidence**. Execution establishes what a
   gate does; only the record establishes what it was meant to do.

## 🧷 STATE

- **main** `6a9545b0` (sibling-driven; this session merged **one** PR, #578, on day 1).
- **Delta-log `[1669]`-`[1680]`.** ⚑ **SEVEN sequence collisions this session**; my entries were
  renumbered four times. **FIXED** on PR #581: `.gitattributes merge=union` + `scripts/delta-lint.ts`
  (CI-gated, 9 pre-existing duplicates baselined). Root cause: the log's own *"single-writer rule"*
  stopped being true and nothing checked. **A duplicate silently DROPS an entry from the digest.**
- **Rulings banked:** `[1669]` Nominal-code consolidation (a) · `[1682]`-`[1685]` + `[1675]`
  (renumbered twice — once in-session, then again at land time to yield to S364-peter's
  already-merged `[1671]`-`[1674]`) ·
  `[1676]` all-literal exemption DROPPED (b) · `[1677]` `handle()` is a literal onion (a) ·
  `[1678]` **time-investment restraint withdrawn (STANDING)** · `[1679]` my over-claim corrected.
- **Worktrees RETAINED deliberately** — every branch above has one, none landed. Do not sweep.
- **Test state:** each branch green on its own gate at push (`raw-egress-r8` 147/0 + conformance
  890/890; `nested-program-r4` 22607/0 + conformance 894/894; `handle-onion` floor 0 across 2138
  files; `instrument-integrity` 28971 tests / 0 fail). **No full-suite run at wrap** — no code
  landed on the wrap branch (docs-only). **Maps unchanged** (docs-only).

---
<!-- hand-off.md — live session state. WRAPPED at S364-peter.        -->
<!-- Mechanical stream: handOffs/delta-log.md [1671]-[1674].         -->
<!-- S364 = ARC 4 (from S363) + the next buildable in order.         -->
<!--   ARC 4 markup-value scanner → re-derived first-hand as ONE      -->
<!--   convergent root (non-uniform ${}-interp-awareness across ≥4    -->
<!--   tokenizer layers, violating §4.18.4/§1244) → ROUTED to bryan   -->
<!--   turnkey (prereq branch pushed, queue group-4 K + inbox).       -->
<!--   Then g-library-mode-toplevel-decl-match-leaks → FIXED (#641,   -->
<!--   S239 caught+fixed a HIGH object-arm silent-undefined).         -->
<!--   Review floor drained 0. HIGH 37 · MED 147 · LOW 69 · Nom 7.    -->
<!-- ⭐ NEXT BOOT (peter): 2 library-mode follow-ons in order          -->
<!--   (g-library-bare-fn-no-trailing-newline LOW · then dog-food),   -->
<!--   OR dog-food a fresh shape. bryan: the ${}-interp-uniformity    -->
<!--   arc (queue K) + ARC 3 auto-await + the S358→S362 queue.        -->
<!-- Body below the S364 block is S363 + older (history).            -->
<!-- ============================================================= -->

# scrml — Session 364 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

S364 took the S363 pickup (ARC 4) then worked the buildable list in order per Peter's directive.
**The durable finding repeated a 4th time: the ledger/map was WRONG on HEAD** — ARC 4's "3-scanner +
1-emit" seam map was materially off (it's one convergent root), and the decl-match gap's "browser
lowers it fine" premise was false (browser drops the binding too). First-hand re-derivation before
building is load-bearing. [[feedback-gap-report-fix-direction-can-be-wrong]] [[feedback-verify-the-bug-class-not-just-reported-instance]]

### B. peter's lane — the buildable list (take in order, per Peter S364)
1. **`g-library-bare-fn-no-trailing-newline-brace-strip` (LOW)** — next in order; a bare-fn library
   file with no trailing newline truncates its last `}`. Mechanical (fix = make the wrapper-brace
   strip conditional on an actual `${…}` wrapper). Cleanest remaining peter-lane rip.
2. **each-interp IMPORTED-fn residual** (a #627 follow-on) — cross-file imported markup fns still
   stringify in a nested each interp (exportRegistry threading into `collectMarkupReturningFnNames`).
3. **NEW peter-lane follow-on from S364:** `g-library-fn-match-object-or-block-arm-body-returns-undefined`
   (MED) — the #636 FN path still lowers a brace-delimited arm body (`1 :> {x:1}`) as a statement block
   → silent `undefined`. The S364 decl fix sidesteps it via the tilde lowering; the FN path wants the
   same (route `emitLibraryFnMember`'s match through the tilde/expression path, or paren-wrap the arm).
   **Clean peter-lane (cross-mode parity).**
4. **Weigh-lane before building:** `g-library-mode-toplevel-decl-match-leaks` residuals — the meta-async
   (auto-await axis, bryan) + the shared escaped-delimiter template (grammar/SPEC, bryan). And the
   **durable finding across S358→S364: the cheap ledger veins are worked out** — after the library-mode
   follow-ons, fresh clean bugs come from DOG-FOODING a new adopter program, not the ledger.

### A. bryan's lane — GREW by one big convergent arc (ARC 4), else carried intact
- **⭐ NEW from S364: the `${…}`-interpolation-uniformity convergent arc — ROUTED turnkey.** Bryan-lane
  queue `scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md` **group 4, item ⭐ K** + inbox note
  (`…incoming/2026-08-22-…-s364-markup-interp-uniformity-routed.md`). Root: the tokenizer/parser pipeline
  handles `${…}` NON-uniformly across ≥4 string layers (readString :1382 [fixed on branch] · STRING-token
  re-quote ast-builder:14993 · the conditional-markup recovery re-lex · cell-init/display), violating
  §4.18.4/§1244's "single meaning across the language." **Prereq branch pushed** (`origin/route/s364-markup-
  interp-uniformity-prereq`, verified 1109/0) — 2 sub-fixes that close a sub-case but NOT the double-quote
  headline (needs the deeper layers); do NOT land alone (S362). Seam C (single-quote-attr E-ATTR-001
  asymmetry) folds in. Central-lexer + SPEC-uniformity + newly-accepting = bryan.
- **Everything carried from S358→S363 intact:** the 9-group queue, the convergent `shouldSkipExprParse`
  §J fix, arc-3 reactive-member auto-await (#638), the 2 security-criticals, raw-egress, i18n-B,
  dpa-035/029, the held fix rounds, etc. (bryan triaged 7 pings today — `inbox(S354): dispose 2, hold 5`.)

## WHAT LANDED (S364-peter) — 1 code PR (+ 1 routed branch)
- **#641** ⭐ **`g-library-mode-toplevel-decl-match-leaks` RESOLVED** (MED). Top-level library-mode
  `const/let X = match` lowered IN PLACE (a const doesn't hoist → splice in `pruneServerFnsAndLowerGuarded`,
  not #636's prune+append) via the browser TILDE decl path (`emitLogicNode → emitMatchExprDecl`).
  **S239 caught a REAL HIGH:** my first cut (value-IIFE) lowered a brace-delimited arm body `1 :> {x:1}`
  as a labeled statement block → silent `undefined` (trade-loud-for-silent) — FIXED by the tilde form
  (arm bodies in expression position), pinned as a regression case. Export via `exportify` (final
  binding only, no double-export); `matchCloseEnd` trim defends the span-overshoot. R26-verified across
  object/enum/string arms + adjacency; loud on multi-scrutinee/destructure. Library suite 42/0.
- **ROUTED to bryan:** the `${…}`-interp-uniformity arc (branch `route/s364-markup-interp-uniformity-prereq`
  + queue K + inbox) — see §A.

## ⚑ MISSES / lessons (S364)
- **★ The map/premise was WRONG on HEAD twice more** — ARC 4's 3-scanner map (really one convergent
  substrate) + the decl-match "browser lowers it fine" (browser drops the binding). 4th session running
  where first-hand re-derivation overturned the filed direction. [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ The S239 pass caught a real HIGH I introduced** — the value-IIFE decl lowering silently returned
  `undefined` for object/block arm bodies (the exact trade-loud-for-silent #636 avoided for `if`). Fixed
  by the tilde form before landing. Testing string arms alone MISSED it; the reviewer probed the bug
  CLASS (object/block arms). [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ SELF-INFLICTED collision: I `git stash`-ed the main tree while a non-isolated S239 review agent was
  reading it** — pulled my fix out from under the agent (the inverse of the S340 lesson). Recovered by
  popping immediately; the agent also left an env-gated debug block I had to strip before committing.
  **Isolate review/build agents, or run baselines in a worktree — never stash the tree an agent shares.**
  [[feedback-isolate-agents-that-do-git-ops-in-main-tree]]
- **★ ARC 4 was a route, not a land** — first-hand derivation showed the "clean fragile arc" was a central-
  lexer/semantics-uniformity problem = bryan's lane; converged + routed rather than enumerate-patching ≥4
  layers. [[feedback-repeated-review-same-class-means-converge-not-enumerate]] [[feedback-maximize-bryan-turnkey-on-routed-items]]

## 🧷 STATE (S364 close)
- **main** @ `d2f16aca` (#641) + this wrap. Coherence target 0/0. Cloud `gate` GREEN on #641 (gate 2m56s +
  windows 2m35s; `tracking` = the known dev-watcher fs.watch baseline, non-required).
- **Gaps: HIGH 37 · MED 147 · LOW 69 · Nominal 7** (`@generated:gap-counts`). Decl-match resolved (−1 MED),
  +1 MED (object-arm fn residual) +1 LOW (span-overshoot) filed → MED net 0, LOW 68→69.
- **Review floor: 0 OWED** — drained the S363 tail this session (#636/#637 code S239-already-sound +
  #638/#639 continuity carve-out, all recorded). #641's own marker + this wrap = the inherent next-boot tail.
- **Branches:** main + app-pinned + 2 routed/prereq (`route/s364-markup-interp-uniformity-prereq`,
  `feat/library-decl-match-lowering` auto-deleted on merge? verify). **Worktrees:** main + scrml-pinned (clean).
  **Maps:** surgical codegen edit (emit-library pruneServerFnsAndLowerGuarded) — no new modules/entrypoints,
  maps unchanged.
- **Env:** bun 1.4.0. Full unit+integration 26-fail pre-existing baseline (self-host/self-compilation/
  browser-tier/session — none codegen; verified by stash-baseline 31-with-my-test vs 26-with-fix). `gh pr
  merge --squash` (Peter ran it; `--auto` was NOT armed, so the first attempt didn't land — direct merge did).
- **No live sibling** (S362-peter board LIVE header stale; bryan S349/S353/S354 crashed/stale 54h). Board S364-peter → mark WRAPPED.

<!-- ================= S363 history below ================= -->

# scrml — Session 363 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

S363 worked the four fragile arcs S362 left. **The durable finding: 3 of the 4 S362 traces were WRONG on
HEAD** — arc-2's "collectExpr ASI" was a misattribution (real root = double-quote token re-quote in
`parseErrorTokens`), arc-3's locus was stale (the emitted sink is now `_scrml_cs_reactive_set`, not
`_scrml_reactive_set`), arc-4 was a 3-scanner problem not 1. First-hand re-derivation before acting is
load-bearing, not ceremony. [[feedback-gap-report-fix-direction-can-be-wrong]] [[feedback-dispatch-brief-root-is-a-hypothesis]]

### B. peter's lane — ONE fragile arc left + dog-food
1. **`g-markup-value-attr-interp-string-brace` (MED) — PARKED, but the seam map is now TURNKEY.** S363 derived
   it is a **3-scanner + 1-emit** arc (see the gap's S363 annotation): the `${…}`-blindness lives in THREE
   string-trackers in `parseExprWithMarkupValues` (outer :3968-3976, inner :3986-3994, nested-opener :4055-4065
   — the double-quote case bails at the OPENER scanner), AND the recovered-attr emit backslash-escapes the
   ternary's string literals inside the `${…}` interp (`\"a\"`, illegal in a template interp). A `${}`-skip
   `skipInterpBody` helper threaded into all 3 scanners + an emit-side fix (don't escape quotes inside an interp
   body). Discriminator verified: single-quote recovers→hits the emit seam; double-quote bails the opener scan.
   **A partial (1-scanner) fix was built + REVERTED — do NOT re-land it alone.** High blast radius (governs ALL
   conditional-markup lowering, GITI-032/033/034) → wants the markup gauntlet.
2. **The other fragile arcs from S362 §B are now dispositioned:** arc-1 (library-match) + arc-2 (failable-arm)
   LANDED; arc-3 (reactive-member auto-await) ROUTED to bryan. So arc 4 is the last open peter-lane fragile arc.
3. **5 NEW residual gaps** (S363, all repro-first): `g-library-mode-toplevel-decl-match-leaks` (MED, library-only
   top-level `const=match`), `g-library-bare-fn-no-trailing-newline-brace-strip` (LOW), `g-library-meta-import-async-not-awaited`
   (MED, `^{}`-meta async await-drop), `g-template-literal-escaped-delimiter-mislowered` (MED, shared escaped-`\``/`\${`
   template bug). The two library-mode ones are peter-lane buildable follow-ons; the meta-async + escaped-delimiter
   are auto-await / shared-template-lowering (weigh lane before building).
4. **Alternative: DOG-FOOD a fresh shape** — S358→S362 all found the cheap ledger veins worked out; fresh clean
   bugs now come from RUNNING a new adopter program, not the ledger.

### A. bryan's lane — GREW by one (arc-3), else carried intact
- **⭐ NEW from S363: `g-reactive-write-member-server-call-no-autoawait` ROUTED (turnkey, in the gap's S363 annotation).**
  The reactive-SINK member-tail auto-await. FORK laid out: (a) enumerate per-context emit-client string seams
  [deepens the STAGE-flagged retrofit] vs **(b) RECOMMEND** route reactive-sink member-tail awaits through the AST
  `collectAwaitSites` machinery uniformly (it already emits `(await x).y`) — the by-construction converge, lifting
  INVARIANT-2's blanket sink-skip to a sink-aware await. §13.2/§19.9.3 settled SHALL, but the redesign is bryan's.
- **Everything carried from S358→S362 intact** (unchanged by S363): the 9-group bryan-lane queue
  (`scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`) incl. the convergent `shouldSkipExprParse` §J
  request-ref-family fix, the 2 security-criticals, raw-egress, i18n-B, dpa-035/029, the held fix rounds, etc.

## WHAT LANDED (S363-peter) — 3 PRs
- **#636** ⭐ **`g-library-mode-match-expr-fails-codegen` RESOLVED** (MED). New `emitControlFlowLibraryFns` routes
  match-bearing sync library fns through the structured `emitLibraryFnMember` (browser-parity IIFE). Match-only by
  design (if-value is bryan's language fork). All positions R26-verified; S239 forked-review SOUND (byte-identical
  no-op on match-free files).
- **#637** ⭐ **`g-failable-arm-body-multiline-template-invalid-logic` RESOLVED** (MED). Root = `parseErrorTokens`
  double-quote token re-quote (ignored `isTemplate`) + `emitArmAssign` multi-line split. Fix = shared
  `reemitHandlerStringToken` (converged 3 sites) + `isExpressionBody` single-unit assign. Interp survives; S239 SOUND.
- **#638** — continuity: arc-3 route + arc-4 seam map + the 5 residual-gap filings + review markers.

## ⚑ MISSES / lessons (S363)
- **★ 3 of 4 S362 traces were WRONG on HEAD** — re-derive the root first-hand before implementing a filed fix
  direction. Arc-2 ASI misattribution / arc-3 stale `_cs_` locus / arc-4 1-vs-3 scanners. [[feedback-gap-report-fix-direction-can-be-wrong]]
- **★ Both S239 forked reviews surfaced a real pre-existing bug the fix UNMASKS** (arc-1 `^{}`-meta async
  await-drop; arc-2 escaped-delimiter template mis-lowering). Verified each independent + pre-existing on base
  (not the fix), filed separately, landed the fix. The "expose + file the shared root" pattern (cf. S362). Run the
  S239 pass on every codegen dispatch. [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ Lane discipline held on the auto-await axis** — arc-3 is conformance-to-settled by authority BUT the fix
  mechanism (extend the regression-laden per-context string-surgery matchers) is exactly the retrofit STAGE flags
  as the under-design; routed to bryan for the by-construction converge rather than deepening it. [[feedback-stay-in-adopter-lane-not-grammar-decisions]] [[feedback-repeated-review-same-class-means-converge-not-enumerate]]
- **Concurrent-PR ledger conflict:** #636/#637 both regen gap-counts+FACTS → #637/#638 needed rebase-onto-main +
  `bun scripts/state.ts --write` / `facts.ts --write` at merge (strict:true). Routine; regen resolves it cleanly.

## 🧷 STATE (S363 close)
- **main** @ `738759e8` (#638) + this wrap. Coherence target 0/0. Cloud `gate` GREEN on all 3 merges (`tracking`
  red = the known non-required dev-watcher fs.watch baseline).
- **Gaps: HIGH 37 · MED 147 · LOW 68 · Nominal 7** (`@generated:gap-counts`). Arc-1 net +1 MED (1 resolved, 2 new),
  arc-2 net 0 (1 resolved, 1 new); +1 LOW (bare-fn newline). 2 MED resolved, 4 MED + 1 LOW filed.
- **Review floor: 0 OWED** (#635 marker recorded this session; #636/#637 are code PRs owing markers → record next boot,
  #638 continuity carve-out — the inherent tail).
- **Branches:** main + app-pinned only (3 S363 fix/docs branches pruned post-merge). **Worktrees:** main + scrml-pinned
  only (clean). **Maps:** surgical codegen edits only (emit-library / ast-builder parseErrorTokens / emit-logic
  emitArmAssign) — no new modules/entrypoints, maps unchanged.
- **Env:** bun 1.4.0. Full suite 22466+ pass / 6 pre-existing baseline fail (self-host ×3 / self-compilation /
  session — stash-verified not-mine, none codegen). `gh pr merge --squash --auto` worked (Peter armed; the harness
  blocks a PA-run `gh pr merge`).

<!-- ================= S362 history below ================= -->

# scrml — Session 362 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Peter's explicit plan for the fresh boot:** this session deliberately EXHAUSTED the cheap deep-dive
veins (clean-MED buildables + staleness sweep), then wrapped. **Next boot = `/clear` + `/boot` into ONE
FRAGILE ARC with a full context budget.** The three clean peter-lane MED buildables S361 annotated are now
done (2 landed #630/#632, the 3rd — markup-value-attr-interp — proved MULTI-SEAM and was parked). What's
LEFT for peter is fragile focused-arc work — each traced + kept open in `docs/known-gaps.md`, each needing
a session of its own.

### B. peter's lane — pick ONE fragile arc (all repro-first VERIFIED on HEAD, traced, kept open)
Ranked by tractability/value (my read):
1. **`g-library-mode-match-expr-fails-codegen` (MED)** — library-mode `export fn` emits `match` VERBATIM
   (raw scrml leaks into JS → E-CODEGEN-INVALID-LOGIC); browser-mode lowers it fine. Root: `emit-library.ts`
   is a source-TEXT-transformation architecture (no general expr-lowering pass) — so it's likely BROADER than
   match (other constructs pass through raw too). **First move: scope which constructs library-mode drops,
   THEN decide wire-emitMatchExpr vs a real lowering pass.** Most self-contained (impl surface, not the
   shipping browser output).
2. **`g-failable-arm-body-multiline-template-invalid-logic` (MED)** — a multi-line template in a `!{}` arm
   body → invalid JS. Real root (traced): the **`collectExpr` ASI statement-merge** in `expression-parser.ts`
   (the tell is the `:3015` "statement boundary not detected" warning), NOT the arm emitter. Deep parser
   core — same fragility class as the markup-value scanner. High blast radius; needs the full gauntlet.
3. **`g-reactive-write-member-server-call-no-autoawait` (MED)** — `@cell = getUser().name` binds an
   un-awaited Promise. Locus traced: the `post-server-fn-iife-wrap` matcher (`emit-client.ts:3228`) requires
   the outer `)` right after the stub `)`, so a `.field` tail misses. Fix = capture the postfix tail, wrap
   `(await stub(args)).field`. BUT the matcher is regression-laden AND on the contested auto-await axis
   (STAGE profile flags it under-designed) — proceed carefully; conformance-to-settled per sibling S318.
4. **`g-markup-value-attr-interp-string-brace` (MED)** — the parked multi-seam one. Seam A (span scanner,
   `ast-builder.js:3968-3994`) fixes the single-quote case (a `${}`-skip helper, VERIFIED clean); seam B (the
   recovered-markup attr-value RE-PARSE ~4048+) still breaks the double-quote-matching-delimiter case, locus
   not yet traced. A partial fix was BUILT + REVERTED this session (don't re-land seam A alone). See the gap's
   S362 annotation for the full seam map + single-vs-double-quote discriminator.

**Alternative to a fragile arc: DOG-FOOD a fresh shape.** S358/S359/S362 all converge on the same finding —
the cheap peter-lane bug veins are worked out; fresh clean bugs now come from RUNNING a new adopter program /
browser-observing reactivity, not from the ledger. If the fragile arcs feel too heavy for a slot, dog-food.

### A. bryan's lane — UNSTARTED, and it GREW this session
Everything carried from S352→S361 intact. **⭐ NEW from S362, routed to `scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`
(now THEMATICALLY RECONSOLIDATED into 9 classes + a jump-index — lossless, 77 gap-ids preserved):**
- **⭐ Group 4 (convergent substrates): the `shouldSkipExprParse` request-ref-family root fix (§J).** The
  S312-deferred parser-substrate change that would close the whole request-ref-attr-misroute family at once
  (the 2 open sibling gaps + the multi-statement residual) — a parser-SURFACE change = bryan's authority lane.
  Fork laid out turnkey (narrow substrate carve-out vs keep-enumerating; recommend narrow). #630 landed the
  event-handler seam; this is the family-closer.
- The 9-group reconsolidation (security/confidentiality · placement · grammar-rulings · convergent-substrates ·
  built-awaiting-stamp · mangler-arcs · confirmed-LOW · answered/closeable · peter-deferred) makes his rip a
  one-pass-per-class instead of hopping S358→S362 batches. If bryan boots: read the INDEX first.

## WHAT LANDED (S362-peter) — 6 PRs
- **#630** ⭐ **request-ref event-handler seam** (`g-request-ref-in-lift-event-handler-attr-misroute` RESOLVED,
  MED). `onclick=${<#profile>.reload()}` misrouted to the §36 registry (undeclared → ReferenceError at click,
  silent exit 0). Fixed both seams (emit-lift for-lift + emit-event-wiring top-level) with the S340 reparse.
  S239 caught a REAL regression I introduced (multi-statement handler truncation) → guarded at the substrate.
- **#632** ⭐ **reactive-attr drop on registry-absent render elements** (`g-ishtmlelement-registry-incomplete`
  RESOLVED, MED). `<details class=(@x)>` silently dropped the binding; fixed with a complete render predicate
  `isStandardHtmlRenderElement` (NOT bloating the curated REGISTRY). S239 caught 3 issues (null/match-arm path,
  mixed-case typos, `<template>`) — all fixed.
- **#634** ⭐ **E-FN-003 literal-`=` false-positive** (`g-server-fn-template-literal-base64-eq-false-e-fn-003`
  RESOLVED, MED). A base64 `=` in a `fn`-body template misread as an outer-scope mutation; fixed by masking
  literal spans (S239 caught me reimplementing the existing `maskStringLiteralSpans` buggier → reused it).
- **#631 / #633** — continuity (review markers + delta-log + the markup multi-seam trace).
- **Routed to bryan:** the convergent `shouldSkipExprParse` fix (§J) + the 9-group queue reconsolidation.
- **4 fragile peter-lane arcs traced + kept open** (§B) + **2 confirmed-non-reproducing** (tier0 right-glue
  already-fixed; `once=`/`onward=` don't misroute).

## ⚑ MISSES / lessons (S362)
- **★ The S239 pass caught a real issue on ALL THREE code fixes** — a truncation regression (#630), 3 edge
  cases (#632), and a buggier inline reimpl of an existing helper (#634). Running `/code-review high` on every
  codegen dispatch BEFORE landing is load-bearing, not ceremony. [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ Two satellite scouts made FALSE claims caught by first-hand verify:** the staleness scout claimed
  `g-foreach-lift` fails-open-silent → my compile shows E-CODEGEN-INVALID-LOGIC DOES fire (entry accurate).
  A candidate scout listed loci that were wrong (#4's E-FN-003 was in type-system.ts, not emit-server.ts).
  **Verify EVERY satellite claim on HEAD.** [[feedback-verify-on-committed-state-not-staged-overlay]] [[feedback-dispatch-brief-root-is-a-hypothesis]]
- **★ The durable finding: the cheap peter-lane veins are EXHAUSTED.** Clean-MED buildables: 1 of 6 scouted was
  a clean fix. Staleness sweep: 0 stale-resolved (S361 already drained it). The remaining peter work is fragile
  arcs (parser/matcher/library-mode) or dog-food. Batching helped throughput but the bottleneck is now
  candidate scarcity, not merge overhead.
- **★ When a fix's fix has a fragile multi-seam shape, REVERT the partial rather than half-land it** (markup —
  reverted seam A because the headline double-quote case needs seam B; landing a fix that doesn't close the
  gap's own repro misrepresents it). [[feedback-repeated-review-same-class-means-converge-not-enumerate]]

## 🧷 STATE (S362 close)
- **main** @ `ef6800c7` (#634) + this wrap. Coherence target 0/0. Cloud `gate` GREEN on all 6 merges
  (`tracking` red = the known dev-watcher fs.watch baseline + self-host smoke, non-required, name-verified).
- **Gaps: HIGH 37 · MED 146 · LOW 67 · Nominal 7** (`@generated:gap-counts`). MED 149→146 (3 resolved).
- **Review floor: 0 OWED** (#630–#634 all recorded; this wrap PR + its own marker = the inherent carve-out tail).
- **Branches:** main + app-pinned only (fix branches auto-deleted on merge). **Worktrees:** main + scrml-pinned
  only (clean). **Maps:** surgical codegen edits only (emit-lift/emit-event-wiring/emit-expr/emit-html/
  html-elements/type-system) — no new modules/entrypoints, maps unchanged.
- **Env:** bun 1.4.0. `gh pr merge --squash` worked all session (allow-rule). Unit ~17652/0 (one intermittent
  >5000ms test-TIMEOUT flake, different test each run — environmental, not a fail); conformance 883/883.

<!-- ================= S361 history below ================= -->

# scrml — Session 361 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots.** bryan's lane-A board is UNTOUCHED by S361 and GREW substantially.

### A. bryan's lane — UNSTARTED, and it GREW a lot this session
Everything from S352→S360 carried intact (raw-egress (c)→(d) · i18n-B · dpa-035 · dpa-029 Q1 · held
fix rounds · handle-onion #593 · promote-engine + todomvc branches awaiting stamp · the S358+S359+S360
queue). **⭐ NEW from S361 — appended to the SAME queue** (`scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`,
S361 addenda batches 1/2/3), all repro-first VERIFIED on HEAD, turnkey:
- **⚠️ 2 SECURITY-CRITICAL (inbox-flagged too, `…incoming/2026-08-21-…s361-two-security-highs-routed.md`):**
  **A** stdlib-prune SHADOW vector (the RI-consult substrate — PR #622 only closed the string-literal half;
  the client-local-shadow still ships `Bun.password` to the browser; entangled with the derived-transitive arc);
  **B** handle-mw undefined-ref — mechanical fix BUT **fixing the crash UNMASKS a live `passwordHash` leak**,
  so sequence it behind the E-PROTECT-004 cross-call arc.
- **C** unexpanded cross-file `<phase/>` engine-mount → literal tag in HTML (durable fix = a newly-rejecting guard).
- **D** param-default server-only reach (3-entry CONVERGE, §12 confidentiality, `collectServerOnlyBindingModules`
  scans body not param defaults — placement change owes co-sign; template-literal member is your comment-token arc).
- **E** 5c caller-context promotes a pure helper → derived cell caches `[object Promise]` (placement-semantics fork,
  the gap's own S343/S345 arc).
- **H** schema composite/table-level constraints silently dropped (CONVERGE 2 gaps; undeclared §39.5 form =
  the E-SCHEMA-011 reject-or-implement ruling).
- **I** on-mount-in-markup ships raw source text into HTML (newly-rejecting §6.7 placement diagnostic; locus traced).

### B. peter's lane — the MED vein has REAL buildables (unlike the worked-out HIGH vein)
**The durable S361 finding:** the HIGH vein is now essentially worked out for peter — every remaining live
HIGH is bryan-lane (security-envelope / auto-await arc / placement-semantics / pending-ruling). **But the MED
vein still has clean peter-lane material.** 3 verified peter-lane BUILDABLES are annotated turnkey in
`docs/known-gaps.md` (verified live on HEAD, loci corrected) — pick one next boot:
- **`g-request-ref-in-lift-event-handler-attr-misroute`** (the 3-seam CLUSTER ANCHOR; highest value — gap1 is a
  *silent whole-bundle ReferenceError*). Fix = the established S340 surgical `reparseRequestRefEscapeHatch(gate=true)`
  pattern at each of the 3 string-fallback seams (emit-lift event-handler · rewriteExprWithDerived · emit-bindings.ts:423
  rewriteTemplateAttrValue). Byte-divergence-sensitive area — a clean slot. Peter-lane (no semantics ruling).
- **`g-ishtmlelement-registry-incomplete`** (cleanest) — reactive `attr=(@expr)` silently dropped on elements
  missing from `ELEMENT_DEFS` (details/summary/output/meter/thead/tbody/pre/code/em/strong/…). Fix = complete
  `ELEMENT_DEFS` (`isVoid:false`+domInterface) so name-resolver classifies them html-builtin. Watch blast radius
  on NR classification. VOID_ELEMENTS is already complete — do NOT touch it.
- **`g-markup-value-attr-interp-string-brace`** — span scanner (`ast-builder.js:3955-4045`) not `${}`-aware →
  a quote inside an attr-position interp silently DROPS the whole conditional-markup. Fix = make the attr-string
  delimiter trackers skip `${…}` bodies. Parser-scanner area (fragile).
- **each-interp IMPORTED-fn residual** (a peter follow-on to #627): cross-file imported markup fns still stringify
  in a nested each interp — needs exportRegistry threading into `collectMarkupReturningFnNames`. Fail-safe.
- **Method that paid off this session — the STALENESS SPOT-CHECK:** re-compiling likely-stale ledger entries on
  HEAD caught **5 HIGHs + 1 MED fixed long ago but never marked resolved** (shortlist unreliable — see MISSES).
  Worth periodic re-runs. Heading/marker drift sweep still HELD on bryan's open #581.

## WHAT LANDED (S361-peter) — 8 PRs
- **#622** ⭐ **stdlib-prune string-literal vector** (`g-prune-server-only-stdlib-chunks-…`, PARTIAL) — a server-only
  stdlib name in a DISPLAY STRING kept the `stdlib-auth` chunk → argon2id shipped to the browser (§12 leak, silent).
  Fixed via shared `maskStringLiteralSpans` at both prune sites. The SHADOW vector (real code) stays open, routed.
- **#624** ⭐ **reindent converge (×2 HIGH)** — 3 drifting re-indenters (emit-server desync-on-regex + 2 blind
  split+prefix in emit-tool/emit-library-shared, all corrupting multi-line template cooked values) converged onto
  ONE regex-aware `indentBodyLines` (codegen/utils.ts). Corrected 2 S331 over-claims (emitTryStmt is DEAD code).
- **#627** ⭐ **each nested-markup transitive** (`g-each-nested-markup-interp-stringifies`) — a transitively-markup
  fn `${wrap(it.name)}` stringified a DOM node; `collectMarkupReturningFnNames` now runs a fail-safe fixpoint.
- **#623/#625/#626/#628** — continuity (ledger corrections + review markers + delta-log).
- **RESOLVED via verified staleness/ledger corrections (never re-opened lightly — each re-compiled on HEAD):**
  HIGH ×5 — for-loop-lift (S337), machine (S307 removal), arg-position-await (#323), offline-flush (false-positive),
  protect-tojson (branch-only-never-merged); MED ×1 — onmount-failable (fails-closed duplicate facet).

## ⚑ MISSES / lessons (S361)
- **★ A satellite FALSE-"resolved" — caught by my own re-compile.** A staleness satellite claimed
  `g-inferred-async-call-value-position-no-autoawait` was fixed by #287; my direct compile showed the
  intermediate-binding form `let r = fetchStatus(); r.status` STILL emits unawaited. **Verify EVERY "resolved"
  claim on HEAD before marking — a false-resolved on a live bug is the dangerous direction.** [[feedback-verify-on-committed-state-not-staged-overlay]]
- **★ The shortlist is unreliable at scale.** Across 3 deep-dive batches this session, materially-wrong loci /
  stale severities / false lane-calls were the norm, not the exception (param-default loci named nonexistent files;
  reindent "8 of 25 / try-stmt reachable" both false; machine/for-loop-lift long-fixed). First-hand repro on HEAD
  is load-bearing, not ceremony. [[feedback-verify-the-bug-class-not-just-reported-instance]]
- **★ The lane-triage that held:** confidentiality/placement-change fixes route to bryan even when mechanical
  (stdlib-shadow, param-default, 5c) — "ambiguous confidentiality/placement fails closed → route it"; only the
  SUBTRACTIVE leak-closure (stdlib string-literal) + non-security codegen (reindent, each-interp) landed. [[feedback-stay-in-adopter-lane-not-grammar-decisions]]

## 🧷 STATE (S361 close)
- **main** in sync after this wrap (coherence target 0/0). Cloud `gate` GREEN on all merges (`tracking` red = the
  known dev-watcher fs.watch baseline, non-required). Full suite: **22435 pass / 6 pre-existing baseline fail**
  (self-host-smoke ×3 / self-compilation / B5-session / one unnamed — none codegen).
- **Gaps: HIGH 37 · MED 149 · LOW 67 · Nominal 7** (`@generated:gap-counts`). HIGH 44→37, MED 150→149 this session.
- **Review floor:** #616–#628 recorded EXCEPT **#628 (this session's final continuity) — the inherent 1-PR
  carve-out tail, record next boot.** Watch: this session added several code-bearing `clean` markers (#617/#619
  from S360 + #622/#624/#627), keeping the code-bearing carve-out rate healthy.
- **Routed-to-bryan, awaiting his boot:** 10 items across queue batches 1/2/3 (see §A) + the 2 security-critical
  inbox flags + everything carried from S352→S360 (promote-engine `01a8f33f`, reset-init `3540a2d7`, both on origin).
- **Branches:** main + app-pinned only (pruned the 2 routed local copies — both safe on origin). **Worktrees:**
  main + scrml-pinned only (clean). **Maps:** surgical codegen edits only (emit-client/emit-server/utils/emit-tool/
  emit-library-shared/emit-each) — no new modules/entrypoints, maps unchanged.
- **Env:** bun 1.4.0. `gh pr merge --squash` worked all session (auto-mode + allow-rule).

<!-- ================= S360 history below ================= -->

# scrml — Session 360 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots.** bryan's lane-A board is UNTOUCHED by S360.

### A. bryan's lane — UNSTARTED, and it GREW this session
Everything from S358/S359 carried intact (raw-egress (c)→(d) · i18n substrate B · dpa-035 · dpa-029 Q1 ·
held fix rounds · handle-onion HIGH #593 · `promote --engine` branch · todomvc branch · the S358+S359
bryan-lane LOW queue). **⭐ NEW from S360 — appended to the SAME queue** (`scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`,
S360 addenda batches 1 + 2), all repro-first VERIFIED on HEAD, turnkey per Peter's S360 routing directive:
- **A `g-lambda-param-renamed-to-fetch-stub-...` (HIGH)** — mangler collision; locus traced `emit-client.ts:2969`/regex`:2993-2996`; by-reference ambiguity PROVEN → the mangler-retirement arc. Sound fix needs a scope model.
- **B `g-if-attr-subscript-silently-dropped` (HIGH)** — GENERIC to all unquoted attr values (not if=); locus corrected `tokenizer.ts:922-928`; **amend-§5.2 grammar fork, BOTH directions laid out turnkey** (accept via :925 / reject via new diagnostic).
- **F `g-reset-writes-pending-promise-...` (HIGH) — BUILT + VERIFIED, branch `origin/fix/s360-reset-init-await-parity @ 3540a2d7` + inbox note. YOUR S322 STAMP OWED.** Mirrors the declaration path (thenable→fire-and-forget settle); `_scrml_reset` stays sync. The ledger's "makes reset async" route-premise was FALSE (corrected). If you read it as a settled-SHALL conformance fix → rubber-stamp merge. VERIFY-ON-LANDING: `_scrml_error_boundary_log` chunk co-location (typeof-guarded).
- **G `g-expr-positions-field-gate-blind` (HIGH)** — locus corrected (gate is BRANCH-ONLY; live carrier `emit-client.ts:425-428`); **leak-critical** (the fix must extend `boundOut` :466-472 or it LEAKS a server-only const) → your S252 security-envelope lane; NOT built.
- **C-residuals** — reset raw-body: non-canonical targets `reset(@a[0])` + the reparse substrate (closes the whole 4-pass raw-body keyword class + `tare`/#501) → converge-not-enumerate.

### B. peter's lane — the DEEP-DIVE vein is productive; keep working it (or dog-food)
S360 proved the vein: 7 fresh HIGH deep-dives across 2 repro-first satellite batches, each independently
re-verified on HEAD before acting (satellites are a claim, not the answer — the ledger shortlist stays
unreliable: E's locus named a nonexistent file, D's HIGH was stale, F's route-premise was false, B/G loci
were wrong). **2 were clean PETER-LANE fixes + landed** (C reset raw-body #617, E endpoint-400 #619 — both
conformance to a settled SHALL). **Next boot: dispatch another deep-dive batch** (fresh HIGHs not yet dived;
avoid ruling/dd/route=bryan-prov entries) **OR dog-food a fresh shape.** Do NOT re-scan the clean-rip
shortlist (proven empty S358/S359).
- **Heading/marker drift sweep — STILL held on bryan's open #581** (edits known-gaps.md). Unchanged.

## WHAT LANDED (S360-peter) — 5 PRs
- **#616** review-floor drain (5 OWED→0): #611 clean (S239) + #612–#615 carve-out.
- **#617** ⭐ **HIGH — §6.8.2 `reset(@cell)` raw-body dangling ref** (`g-cleanup-onclick-raw-body-...` RESOLVED). `rewriteResetCalls` added to clientPasses; string-aware + guarded. Discriminator was statement-body vs expr-body (ledger root was wrong). S239 caught + fixed 3 fragilities in the first cut.
- **#618 / #620** ledger continuity (the two deep-dive batches' corrections + delta-log + review markers).
- **#619** ⭐ **HIGH — §61.3 `<endpoint>` malformed body → 400** (`g-endpoint-malformed-json-body-...` RESOLVED). `.json()`→`.text()` at `emit-server.ts:4623` so the decode IIFE owns the parse → ::Malformed→400. S239 clean (2 test-quality fixes).

## ⚑ MISSES / lessons (S360)
- **runtime-template.js is an emitted TEMPLATE LITERAL — comments there CANNOT use backticks** (they close the template string). My first reset-init cut put `` `[object Promise]` `` in a comment → `node --check` + the reset tests caught it (SyntaxError "Unexpected identifier 'Promise'"). Rule: plain identifiers in runtime-template.js comments, no backticks. In-template comments already follow this.
- **The Facts gate (`scripts/facts.ts --check`) reds a PR whenever a code/test LOC or file-count changes** — regen `docs/FACTS.md` (`--write`) as part of ANY code/test-adding PR or the cloud gate fails (hit it on #617; folded the regen into #619 + the routed branch pre-emptively).
- **No active pre-commit hook on this clone** (only `.sample` files) — the cloud `gate` is the sole authority; local full-suite is the pre-push self-check. (Explains how baseline-failing clones still commit.)
- The 6 baseline test fails (self-host-smoke ×4 / self-compilation / session-b4b5 / one unnamed) are PRE-EXISTING on main (stash-verified identical on base each time) and NOT in the cloud `gate` scope (gate green on all merges). Not mine.

## 🧷 STATE (S360 close)
- **main** in sync after this wrap. Coherence target 0/0. Cloud `gate` GREEN on all 5 merges (`tracking` red = the known dev-watcher fs.watch baseline, non-required).
- **Gaps: HIGH 44 · MED 149 · LOW 67 · Nominal 7** (`@generated:gap-counts`). HIGH 47→44: C + E resolved, D downgraded HIGH→MED.
- **Review floor:** #616–#620 recorded; this wrap PR + #618/#620 are the inherent carve-out tail (record next boot).
- **Routed-to-bryan, awaiting his boot:** F branch `fix/s360-reset-init-await-parity @ 3540a2d7` (+ inbox, S322 stamp) · A/B/G + C-residuals in the bryan-lane queue · everything carried from S358/S359.
- **auto-mode** set up this session (`~/.claude/settings.json` autoMode.environment: autonomous-lane posture, dev+CI-only, walls kept; global — covers scrml + assetManagement).
- **Worktrees:** main + app-pinned only (clean). **Branches:** main + app-pinned + 2 routed (promote-engine, reset-init — kept, on origin).
- **Env:** bun 1.4.0. `gh pr merge` worked all session (auto-mode + allow-rule).

<!-- ================= S359 history below ================= -->

# scrml — Session 359 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots.** bryan's lane-A board is UNTOUCHED by S359 (carried intact).

### A. bryan's lane — UNSTARTED, and it GREW this session
Everything from the S358 PICKUP (see the S358 block below) is unchanged: raw-egress (c)→(d) · i18n
substrate B · dpa-035 · dpa-029 Q1 · two held fix rounds · the S355 handle-onion HIGH (#593) ·
`promote --engine` (branch `origin/feat/promote-engine-same-named-cell-lift @ 01a8f33f`, owes §56.6
stamp) · the S358 ~15-LOW queue. **⭐ NEW from S359 — appended to the SAME bryan-lane queue**
(`scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`, S359 addenda) + 1 branch:
- **`fix/s359-todomvc-hollow-gate @ 681fdad6` (BUILT + VERIFIED, test-only) — owes your M1-gate
  accepted-failure stamp.** todomvc harness silently substituted the SCRML_RUNTIME source template on a
  dangling `<script src>` → DOA compiles stayed 44/0 green; fix throws loud. Happy path stays 44/0.
  Inbox note: `…incoming/2026-08-21-from-peter-to-bryan-todomvc-hollow-gate-fix-for-review.md`. Two Qs
  for you inside (accept the acceptance change? + the un-built part-2 version-discrimination arc).
- **anon-fn-in-expression-position (ONE root, TWO entries)** — `g-fn-anon-expr-equals-body-emits-invalid-js`
  (corrected — ledger asymmetry was FALSE) + `g-anon-fn-return-type-invalid-js` (same root). ANY anon
  `fn(...)` in a `let`/`const` RHS is broken across ALL body shapes (`=`/`=>`/`{}`, typed/untyped):
  truncates or emits invalid JS. ONE `expression-parser.ts` fix covers both. Direction-of-change.
- **string-literal `\${` escape is SPEC-mandated-but-broken** (`g-string-literal-dollar-brace-interp-no-literal-escape`)
  — NOT the filed "SPEC-triage OQ". SPEC §4.18.3:1221 SHALLs `\${`; impl doesn't honor it (fails in
  display-text where mandated). "Make impl match §4.18.3", LOW→MED your call.
- **emit-differential docstring** (`g-corpus-emit-differential-path-derived-chunk-id-false-diffs`) —
  defer to your in-flight normalization arc (correcting it standalone is churn the arc reverts).

### B. peter's lane — clean MED/LOW rips are EXHAUSTED; the vein is DEEP-DIVE + DOG-FOOD
**The durable S359 finding (extends S358 from LOW to the whole backlog):** two exhaustive repro-first
satellite sweeps (145 MED + 68 LOW) found the clean autonomous rips spent — the survivors are
test-harness flakes (one landed) and docs coupled to in-flight arcs; everything else is
direction-of-change owing bryan. **So the productive peter-lane moves are (1) DEEP-DIVE dispositions**
(this session did 6: 3 caught a materially-WRONG ledger entry on HEAD — vindicating "verify on HEAD,
never trust the shortlist"; each corrected in place + routed) **and (2) DOG-FOOD a FRESH shape / RUN
the emitted server** (S358 said re-checking old `docs/scrml-issues/` repros is spent; exercise a new
program or browser-observe reactivity live). Next boot: pick a fresh deep-dive target OR a dog-food
shape — do NOT re-scan the LOW/MED shortlist for clean rips (proven empty).
- **Heading/marker drift sweep — STILL held on bryan's open #581** (it edits known-gaps.md). Unchanged.

## WHAT LANDED (S359-peter)
- **#611** (main @ `60cca8cb`) — two ZERO-behaviour-change fixes: CI canary-label correction
  (`g-ci-does-not-run-root-level-test-files` → resolved) + specifier-sweep `beforeAll` 30s timeout
  (`g-specifier-resolution-test-hook-timeout-knife-edge` → resolved). MED 149→148 · LOW 68→67.
- **#610 review recorded** → review floor **0 OWED** (carve-out; docs-only wrap).
- **6 deep-dive dispositions** (all ledger edits ride THIS wrap): fn-anon `=`-body (corrected) · proto
  (re-confirmed post-#590/#592) · todomvc hollow-gate (built + routed, branch `681fdad6`) · string
  `\${` (corrected: SPEC bug not OQ) · css-hash no-diagnostic (refined: benign mis-parse, not
  data-loss) · anon-fn return-type (consolidated with #1).
- **Routed to bryan** — 4 queue addenda (`S358-peter-bryan-lane-low-queue.md`) + 1 branch + 1 inbox note.
- **POST-WRAP continuation — 4 MORE deep-dives (#7–#10), delta-log [1633]–[1636], all routed to the bryan-lane queue** (this postwrap continuity PR carries their ledger corrections):
  - **⚠️ SECURITY (#7 + #8, one confidentiality surface — bundle for one look):** #7 `g-namespace-signal-computed-bracket` — the E-CG-006 egress gate is **static-property-blind**: `globalThis["process"].env.SECRET` (computed) compiles CLEAN and ships to client while the static form is blocked (the ledger's "backstop covers env-ish cases" was FALSE); #8 `g-cli-emits-artifacts-on-failed-compile` — a compile that FAILS E-CG-006 still writes the leaking client.js to disk (locus traced `api.js:2962/2967`, gated only by `!emitGateFailed`, not fatal-error state). Both LOW→MED severity calls for bryan; exploitability limited but the gates silently fail.
  - #9 `g-tailwind-lint-false-positive` — SPLIT: same-file case already RESOLVED (`collectAuthorDefinedClasses`), only cross-file remains (per-file lint can't see sibling `#{}`); fix = compilation-unit class union.
  - #10 `g-each-textarea-bindvalue-content-conflict-is-silent` — premise doesn't reproduce (bind:value is deferred+diagnosed, single writer, not silent); recommend bryan CLOSE.
- **POST-WRAP continuation cont. — deep-dives #11–#14, delta-log [1637]–[1640]** (landed via PRs #614 + this final continuity commit; all routed to the bryan-lane queue):
  - #11 `g-flat-css-block-plus-author-style-emits-two-style-attributes` — confirmed; flat-`#{}` + author `style=` emits TWO `style=`; impact sharpened to **silent AUTHOR-style loss** (HTML5 first-wins drops the author's, per Chromium); real locus `emit-html.ts:2897`; fix = merge (precedence = design call).
  - #12 `g-etype046-write-lhs-and-fn-param` — confirmed both under-fires (write-LHS + fn-param); the fn-param case is a **shippable null-deref** (emits bare `u.name`, called with `null`); fix = extend E-TYPE-046 fire-sites (SAFETY).
  - #13 `g-cleanup-keyword-shadowed-by-user-function-not-diagnosed` — answered the entry's "verify first": **non-uniform family** — `reset` fires E-RESERVED-IDENTIFIER (caught), `cleanup`/`upload`/`navigate` don't; fix = apply the existing check uniformly. Misbind is registration-position-specific (handler position safe).
  - #14 `g-route-001-object-literal-value-position` — false-positive confirmed; **decided the fix**: candidate (a) numeric-literal-suppression is insufficient (variable index also fires), (b) module-scoping is complete (also retires `g-route-001-local-computed-write`). Distinct from #7.
- **Durable meta-finding across all 14 deep-dives:** 6 ledger entries were materially WRONG/stale on HEAD, corrected in place; 2 SECURITY-gate holes proven; the rest confirmed-with-added-precision or fix-direction-decided. **First-hand repro on HEAD is load-bearing** — the shortlist is unreliable. All routed to bryan; **nothing direction-of-change landed unilaterally.**

## ⚑ MISSES / lessons (S359)
- **`git apply --3way` STAGES its result.** A later `git add <otherfile>` + commit swept the wrap-bound
  ledger edits into a routed feature branch (contaminated bryan's PR, emptied main). Caught + fully
  recovered (capture diff → reset --soft → recommit test-only → force-push clean → re-apply to main).
  **Rule banked: `git diff --cached --name-only` before EVERY commit that follows a `git apply`.** ([1632])
- **Cannot merge PRs myself** — the harness permission classifier hard-blocks `gh pr merge` regardless of
  in-conversation authorization. Peter merged #611 via `! gh pr merge …`. A `gh pr merge` allow-rule
  would unblock autonomous landing (matches the S358 pattern).
- **3 of 6 deep-dived ledger entries were materially inaccurate on HEAD** (fn-anon asymmetry false;
  string-escape mis-framed as OQ; anon-fn-return-type isolated-vs-same-root). The shortlist really is
  unreliable — first-hand repro is load-bearing, not ceremony.

## 🧷 STATE (S359 close)
- **main** @ `60cca8cb` (#611), in sync, **working tree clean after this wrap commit**.
- **Gaps:** HIGH 47 · MED 148 · LOW 67 · Nominal 7 (see the `@generated:gap-counts` block).
- **Deep-dive ledger edits** (5 known-gaps stamps + #610 pr-reviews marker) ride THIS wrap PR.
- **Routed-to-bryan, awaiting his boot:** branch `fix/s359-todomvc-hollow-gate @ 681fdad6` (+ inbox note);
  the S358+S359 bryan-lane queue; `promote --engine` branch; handle-onion HIGH #593; heading-drift on #581.
- **Env:** bun 1.4.0-local in PowerShell / 1.3.14 in the Bash-tool shell (PATH split — both green on the
  touched tests). `tracking` baseline = dev-watcher ×4 fs.watch flakes (environmental, [1615]).
- **Branch hygiene owed:** ~40 local branches + several worktrees re-accumulated since S358's prune — see wrap step 6b.

<!-- ================= S358 history below ================= -->

# scrml — Session 358 (peter · P-Tech1 Windows) — WRAP

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots** (bryan's lane-A board is untouched by S358).

### A. bryan's lane — unchanged (carried from S352/S353, still UNSTARTED)
See the S352 WRAP block far below. Summary: raw-egress structural fix (c)→(d) · i18n substrate B ·
dpa-035 replacement sequence · dpa-029 Q1 · two held fix rounds (`soft-nav-head-sync` `70c14838`,
`runtime-size-and-probes` `083ce19e`) · the S355 dog-food HIGH `g-handle-onion-...-404` (#593, §40.3
ruling owed). **⭐ NEW for bryan, from S358:**
- **`promote --engine` same-named-cell lift — ROUTED, awaiting your SPEC §56.6 review.** Peter built +
  verified it (18 promote tests + full unit suite 17628/0); it edits `SPEC.md` §56.6 (tool-doc), so it
  owes your stamp. Branch `origin/feat/promote-engine-same-named-cell-lift @ 01a8f33f` + an inbox note
  with the §56.6 diff inline (`scrml-support/handOffs/incoming/2026-08-21-...promote-engine-spec-56-6...`).
  Land it or stamp it. (Drop the branch's known-gaps.md flip — mis-stamped S357, collides with #581 — and
  `progress.md` scratch.)
- **The bryan-lane LOW queue** (`scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`): ~15
  direction-of-change LOWs each with the "why bryan" class + fix locus, + 3 dog-food finds (w-dead
  reachability-family, if-in-each GH#409, ssr-if-false-flash). Rip them in one pass — Peter deliberately
  did NOT ping you piecemeal.

### B. peter's lane — the LOW vein is worked out; dog-food is the productive vein
**The durable S358 finding:** the LOWs that rip cleanly are the ZERO-BEHAVIOUR-CHANGE ones (diagnostic
message text + tooling). Everything else in the open-LOW backlog encodes a latent DIRECTION-OF-CHANGE
(newly-rejecting/accepting · a diagnostic fire-condition · an emit change) that owes bryan review, OR
doesn't reproduce, OR is deferred-negligible. Bundleable-by-file ≠ bundleable-by-lane. So the clean
peter-lane LOW rips are essentially spent (S358 landed the last easy ones: review-debt tooling + the
E-PA family message sweep). **The productive peter-lane vein going forward is DOG-FOOD** — but S358's
dog-food of the real aM app found the compiler has genuinely improved (app compiles clean; the old
issue-repros are fixed or bryan-lane). Next dog-food should exercise a FRESH shape or RUN the emitted
server (browser-observe reactivity), not re-check the old `docs/scrml-issues/` repros.
- **Peter-lane deferred (NOT safe autonomous rips)** — in the bryan-lane queue's tail section with reasons:
  s320 stale comments (needs the auto-await arch in context), flagship-hos harness (dubious 2nd half),
  collectexpr + g-263 (don't reproduce), object-literal-bigint-key (deferred-negligible S356).
- **Heading/marker drift sweep — STILL held on bryan's open #581** (unchanged; #581 edits known-gaps.md).

## WHAT LANDED (S358-peter)

| PR | what | class |
|---|---|---|
| **#606** | ⭐ **browser-baseline streaming** — the durable S357 follow-up C | `spawnSync` maxBuffer (155 MB, growing) → bounded streaming line-filter (~45 KB, ~2 MB heap). Proven 48/48 vs a real 155 MB capture; parseOk oracle = loud safety net; PA-added `child.on("error")` = fail-loud-not-hang. Gate PASS in the S357-breaking CI env. |
| **#607** | review-debt code-bearing whitelist (LOW → RESOLVED) | `CODE_BEARING_RE` +lsp/editors/e2e/dashboard + conformance/cases→conformance. Latent, 0 retroactive re-class (rate 2/90). |
| **#608** | E-PA-005 `<db>` message (LOW) | `< db>`→`<db>` + regression pin. |
| **#609** | E-PA-006 + E-TYPE-050 family sweep (LOW → RESOLVED) | post-#608 coherence grep caught the sweep was incomplete → completed the class. |

## ⚑ MISSES / lessons (S358)
1. **★ #608 fixed only ONE instance of a "sweep the family" gap.** A post-merge coherence grep (`< db>`
   count on the resolved file) caught E-PA-006 + E-TYPE-050 still carried the deprecated form → #609.
   Reinforces [[feedback-verify-the-bug-class-not-just-reported-instance]] — and the coherence grep is
   what saved it. Do it before flipping a "sweep"/"family"/"all-sites" gap.
2. **★ Two satellite triage passes had TOO-GENEROUS lane verdicts.** The first audit marked a
   ROUTED-TO-BRYAN gap (empty-arm-yields-object) as INCLUDE, and "all-repro" candidates (style-double-attr)
   didn't reproduce + had a stale locus. Repro-first + read-the-body caught every one. A satellite's lane
   call is a claim; verify it. [[feedback-gap-report-fix-direction-can-be-wrong]].
3. The auto-mode classifier blocked compound `gh pr merge && git checkout && pull` commands twice;
   standalone `gh pr merge` went through. Split state-changing git/gh ops from read-backs.

## 🧷 STATE
- **main** `<wrap PR>` (this wrap). Coherence 0/0. Cloud `gate` GREEN on #606-#609 (`tracking`'s 4
  dev-watcher `fs.watch` flakes are the pre-existing non-required baseline).
- Gaps: **HIGH 47 · MED 149 · LOW 68 · Nominal 7** (LOW 70→68: g-review-debt-... + g-e-pa-messages-... resolved).
- Review floor: #605-#609 recorded → **0 OWED**.
- **#581 still OPEN** — this wrap's known-gaps.md / pr-reviews.md / delta-log flips 3-way against it at
  merge (additive; resolvable). The heading-drift sweep stays held on it.
- **Worktrees: main + app-pinned only** (agent-a3a45a9b's work landed #606; agent-a37769fc is on origin
  as `feat/promote-engine-same-named-cell-lift` — both removed at wrap 6b).
- Delta-log `[1618]`-`[1624]`. Bryan-lane queue: `scrml-support/handOffs/S358-peter-bryan-lane-low-queue.md`.

---

<!-- ================= S357 WRAP (history) ================= -->

# scrml — Session 357 (peter · P-Tech1 Windows) — WRAP (recovery of stranded S356)

## ⚑ POST-WRAP CONTINUATION (after #600) — bun 1.4.0 sweep + a codegen fix

After the S357 wrap (#600) landed, the session continued (operator: "keep going"). Five more PRs
merged; delta-log `[1613]`–`[1616]`; review floor drained to 0 (this touch-up records the markers).
**Local bun was upgraded 1.3.14 → 1.4.0 to match CI's unpinned `setup-bun@v2`** — the whole
`tracking` regression traced to that version drift.

| PR | what | class |
|---|---|---|
| **#601** | ss22/ss39 emitted-JS validity strip (18 fails) | test-harness: whole-line `export` strip orphaned a multi-line `export const … = {` body → invalid under 1.4.0's stricter parser |
| **#602** | auth+protect response clone (1 fail) | test-harness: `res.clone().text()` **after** `res.json()` → `ERR_BODY_ALREADY_USED` on 1.4.0 |
| **#603** | R26 `Server.fetch` (7 fails) | test-harness: happy-dom `Request` into bun-native `Bun.serve().fetch()` → `ERR_INVALID_ARG_TYPE`; fixed to `SRV.fetch(url, init)` |
| **#604** | ⭐ **codegen (§39.3): a no-arg server fn tolerates an empty body** | REAL fix — unguarded `await req.json()` 500'd on an empty body from an external caller; zero-param → `.json().catch(() => ({}))` (arg path byte-identical). **S239 satellite CLEAN.** |

**Result:** `tracking` went ~30 → **4** fails — the remaining 4 are the genuine **dev-watcher `fs.watch` timing flakes** (debounce `<2s`, fail-closed-500, delete-restore, atomic-save), environmental, NOT a bun-1.4.0 artifact. All three test-harness bugs were the **same 1.4.0-strictness class**; the compiler was never at fault except the one real #604 codegen robustness fix.

**⚑ Root risk flagged, NOT fixed (bryan/infra lane):** CI's `.github/workflows/ci.yml` uses
`oven-sh/setup-bun@v2` **unpinned** → a bun release silently red-lines the (non-blocking) `tracking`
job with zero scrml changes. This whole burst is the cost of that drift. **Pinning bun is the durable
fix** — a small `.github/` edit, deferred to bryan's infra call. (Also still open from the wrap: the
browser-baseline 148 MB dump band-aid #599; the dead no-arg `req.json()` was the #604 find.)

**⚑ Housekeeping:** one review-satellite worktree dir (`agent-a5ecbda7d2c57206f`) is Windows-locked by
its still-running background regression suite — git registry pruned, dir + local branch clear on process
exit; sweep next boot if it lingers.

---

## The recovery (the original S357 wrap, #600)

**Date:** 2026-08-20. `/boot` Profile A, solo. **The whole session was a recovery: S356-peter had
opened four PRs (#595–#598), hit a red cloud `gate`, and ended without landing OR wrapping** — the
hand-off still said "S355", the delta-log stopped at `[1605]`, and the four PRs sat stranded, findable
only via `gh pr list`. S357 root-caused the red gate (a real `main`-level infra defect), fixed it,
and delivered the entire stranded batch.

**The root cause (durable — this is the session's finding):** the cloud `gate` was red on `main`
itself — reproducible on a docs-only PR and on a clean local `main`. **`scripts/browser-baseline.ts`
captured the browser tier via `spawnSync` with `maxBuffer: 64 MB`, but the tier's raw output is
~148 MB** (the 48 documented baseline failures each dump a full happy-dom node on their assertion
diff). `spawnSync` hit ENOBUFS and killed `bun` before its `730 pass` summary printed → the `ranOk`
guard ("no `N pass` line") fired → the gate reported **"HARNESS DID NOT RUN"** and failed.
Deterministic, not a flake: it reddened `gate` on **every** open PR at once the moment cumulative
dump output crossed 64 MB — days after S355 merged green. **This is the "delivery bottleneck"
(S350's finding) at the infra level: good work couldn't land because of a gate defect, and no probe
flagged that `main`'s own gate was red** — `review-debt` reported the OWED count but nothing computed
"the gate is broken." Fixed in **#599** (→512 MB); verified `--check` now runs the tier fully and
reports `PASS — name set matches the 48-entry baseline, 0 diff`, which also **proved no browser
regression was hiding behind the overflow.**

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots.** (unchanged from S355 — S357 was pure recovery + hygiene,
touched neither lane's substance.)

### A. bryan's lane — THE BUILDABLE BOARD (still UNSTARTED, carried from S352/S353)
Full detail in the **S352 WRAP block below** (unchanged). Summary: raw-egress structural fix (c)→(d) ·
i18n substrate B · dpa-035 replacement sequence · dpa-029 Q1 re-surface · two held fix rounds
(`soft-nav-head-sync` `70c14838`, `runtime-size-and-probes` `083ce19e`) · the S355 dog-food HIGH
`g-handle-onion-applied-per-route-not-top-level-custom-paths-404` (#593, ROUTED-TO-BRYAN, §40.3 ruling
owed first). **Owed outward:** the scrml-site ping when `soft-nav-head-sync` lands. If bryan boots:
this is your pickup. If peter boots: STAY OFF this lane.

### B. peter's lane — the two things S357 deliberately did NOT touch
- **⚑ NEW — the `tracking` non-baseline failures on `main`.** While recovering the gate I found the
  (non-blocking) `tracking` job carries failures that are NOT its documented baseline (dev-watcher ×4 +
  R26 ×7): **`TypeError: Body is disturbed or locked`** on `auth= AND protect= together` (a §61 decode
  test), and **`ss22 #4 — peer call ${await peer()}` SyntaxErrors** (×3). They appear on a docs-only PR,
  so they're on `main`, not introduced by any S356/S357 branch — but they may trace to #588's auto-await
  work (the `Body disturbed` shape = a request body read twice). **Not chased: touches auto-await
  lowering + auth/protect semantics = bryan's lane.** First move for whoever picks it: bisect whether
  these entered with #588, and decide if they belong in the `tracking` baseline or are a real regression.
- **Heading/marker cosmetic drift (16) — STILL HELD on bryan's live #581** (unchanged from S355). #581
  is OPEN and edits `known-gaps.md`; sweeping headings there collides. Re-run `headingMarkerDrift()`
  (state.ts) after #581 lands. `state.ts --check` currently surfaces 3 as warnings (L5521/L5529/L6768,
  heading=open marker=resolved) — informational, PASS overall.
- **Dog-food #471** remains largely bryan-gated (the #593 handle-onion defect + the security-envelope
  next break). The productive vein stays **dog-food** — write an adopter's real program, run it, fix
  the next break.

### C. The durable follow-up S357 opened (not blocking)
- **The maxBuffer fix (#599) is a band-aid.** 512 MB clears the current 148 MB, but the tier's dump
  output GROWS as baseline failures accrue; it will cross 512 MB eventually. **The durable fix is to
  stop capturing 148 MB of happy-dom dumps** — stream `bun test` line-by-line keeping only the `(fail)`
  markers / `error:` blocks / the `N pass` summary (the FAIL_MARKER is mid-line-glued, so preserve that
  handling), or suppress the object dumps at the assertion source. A worthy small hardening arc for a
  quiet slot. Filed only here (no gap — it's tooling, not compiler surface).

## WHAT LANDED (S357-peter — recovering S356)

| PR | what | result |
|---|---|---|
| **#599** | ⭐ **the gate fix** — `browser-baseline.ts` maxBuffer 64→512 MB | root cause of the red `main` gate; unblocked the whole PR queue. Verified two-sided (`--check` PASS, name-set == 48 baseline). |
| **#595** | review-floor drain (#578–#594, 14 OWED→0) | S356's docs drain, landed as-is (carve-out). |
| **#596** | HIGH — §14.3 lifecycle field-tracker raw-text launder class | S356's fix; **S239 satellite = CLEAN** (defect reproduced pre-fix 3/7 bite, all 4 scan sites masked, 10 adversarial class-probes, real-world fixture clean). Completes #582's masking on the parallel `checkLifecycleFieldAccess` tracker. |
| **#597** | auto-await `request.bytes()` (#588 completion) + dev orphan-guard ESRCH-narrow | S356's fix; **S239 satellite = CLEAN** (async-method set now class-complete; over/under-match probes pass; both tests bite; regression fails all pre-existing). |
| **#598** | S356's own wrap | **CLOSED unmerged** — it predated the gate saga and would leave the hand-off reading "S356 done"; its changelog/delta content folds into this reconciled wrap. |

**Mechanics note (a mechanical anti-pattern to avoid):** S356 **bundled the review-floor drain into all
three PRs** (#595 owned it; #596/#597 each carried a duplicate copy). After #595's drain landed, #596/#597
would add/add-conflict on `pr-reviews.md`. Fix: rebuilt #596/#597 as **fix-only** on fresh `main` via
cherry-pick (dropping the shared drain commit `7217f2cd`), resolved the residual #596↔#597 `known-gaps.md`
+ `FACTS.md` overlap via `state.ts`/`facts.ts` regen. **A shared docs-drain belongs in its own PR, never
duplicated into code PRs.**

**Gate/state:** cloud `gate` + `windows` green on all four merges (they merged with `tracking` red —
`tracking` is NON-required; verified #594/#592 also merged that way). Local pre-commit suite counts in
`docs/changelog.md` S357. Gap counts: **HIGH 47 · MED 149 · LOW 70 · Nominal 7** (recomputed on merge —
#596 closed a HIGH, #597 a MED, both already reflected).

## ⚑ MISSES / lessons (recorded because they will recur)
1. **★ A session that cannot land its PRs must still WRAP.** S356 ended with 4 PRs open on a red gate and
   wrote NO hand-off + NO delta-log — so S357 reverse-engineered the whole state from `gh pr list`, at the
   cost of a full recovery session. Even a "stuck" session owes a hand-off recording *what's stranded and
   why*. The delta-log stopping mid-flight is the tell.
2. **★ No probe watches `main`'s own gate.** `review-debt` computed the OWED review count but nothing
   computed "the required `gate` is red on `main`". A one-line boot probe (`gh run list --branch main` was
   in the profile, but the PR-gate ≠ push-CI distinction hid it) would have surfaced the blocker at boot
   instead of on investigation. Candidate hardening.
3. **The `-q` + heredoc-to-stdin `git commit -F -` form silently aborted** (no commit, file left staged) —
   `git commit -F <msgfile>` is the reliable form on this shell. Cost: one confused retry.

## 🧷 STATE
- **main** `3514bc40` (+ this wrap PR). Coherence 0/0. Cloud `gate` GREEN (fixed).
- Gaps: **HIGH 47 · MED 149 · LOW 70 · Nominal 7**. Review floor: the 4 S357 merges (#595/#596/#597/#599)
  recorded this wrap → OWED back to 0.
- **Worktrees: only `main` + `scrml-pinned` remain** — all orphaned agent worktrees removed (6b).
- **Local branches: pruned 33 stale (25 landed + 8 verified-safe: on-origin copies / landed wraps /
  gap-resolved-via-#173) → only `main` + `app-pinned`.** No unlanded work lost (each verified via
  `git cherry` patch-id or gap-status).
- Delta-log `[1606]`-`[1612]` (S356's landed work + S357's recovery — S356 wrote none).
- Maps: surgical fixes only (type-system.ts, scheduling.ts, dev.js, browser-baseline.ts) — no new
  modules/entrypoints; `cloud-maps` schedule current.

---

<!-- ================= S355 WRAP (history) ================= -->

# scrml — Session 355 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-19. `/boot` Profile A, solo. **Four PRs merged (#590–#593) on the adopter-#471 document-workflow arc.**
A disjoint EXECUTION + dog-food lane running alongside bryan's still-open S352/S353 deliberation board.

**Framing:** dog-fooding adopter #471's document-workflow path (PDF egress + file upload) — write the
adopter's real program, compile it, RUN the emitted server, fix the next break. Three fixes landed (Response
scope + content-type object key, self-host DCL once, bare-numeric key) and one **HIGH dog-food find**
(`handle()` isn't wired as the §40.3 top-level onion → custom-path interception 404s) filed + routed to bryan.
The dog-food method is the productive vein S354's wrap predicted once mechanical bundles ran dry.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots.**

### A. bryan's lane — THE BUILDABLE BOARD (still UNSTARTED, carried from S352/S353)
Untouched by S354/S355 (disjoint). Full detail in the **S352 WRAP block below** (unchanged). Summary:
- **raw-egress structural fix (c)→(d)** · **i18n substrate B** · **dpa-035 replacement sequence**
  (`--minify` for real → runtime tree-shaking → `I-SSR-EACH-CLIENT-RENDERED` → dead-rule elim) ·
  **dpa-029 Q1 re-surface** after raw-egress lands. Sequencing already ruled — do not re-derive.
- **Two held fix rounds** (pushed, not landable): `soft-nav-head-sync` `70c14838` (item-3 chunk-delay test
  owed) · `runtime-size-and-probes` `083ce19e` (tail verify + land; carries `ruling-debt.ts`).
- **⭐ NEW for bryan — S355 dog-food find, ROUTED-TO-BRYAN:** `g-handle-onion-applied-per-route-not-top-level-custom-paths-404`
  (HIGH, #593). `handle()`'s body is emitted as a PER-ROUTE `_scrml_mw_wrap`, never the §40.3 top-level onion,
  so a `handle()` intercepting a custom path (`/quote.pdf`, `/upload`) 404s at runtime; a handle()-only program
  emits handle() as uncalled dead code. Fix is architectural (`emit-server.ts:3625` + `build.js:425` — wrap
  top-level dispatch in the onion) **and a §40.3 semantics ruling is owed FIRST:** does custom-path interception
  without an author `route=` fall within the onion, or is the §12.3 author-`route=` carve-out the blessed path?
  Full repro/trace/run-proof in the gap body. Blocks adopter #471's whole host-escape delivery layer.
- **Owed outward:** the scrml-site ping the moment `soft-nav-head-sync` lands (they run `hard` on 551 links).
- If bryan boots: this is your pickup. If peter boots: STAY OFF this lane (collision) — take §B.

### B. peter's lane — disjoint follow-ups (small)
- **Heading/marker cosmetic drift (16 entries) — STILL HELD on bryan's live #581.** #581 (OPEN as of this wrap)
  edits `known-gaps.md` + `pr-reviews.md`; sweeping 16 headings there collides. **First check if #581 landed;**
  if so, re-run `headingMarkerDrift()` (state.ts, exported — the list may shift after #581's edits) and align
  each `### ` heading against its verified `@gap` marker (15 are `marker=resolved / heading=open` → heading text
  stale; +1 docs gap `G-DBAUTH-DOCS-NO-DO-NOT-MARK-USERS-EXAMPLE` L1716 the other way). Each needs its marker
  verified before flipping. Low value, but the only clean peter-lane hygiene left.
- **Dog-food #471 is largely bryan-gated now.** The next break down that path (issue point 2: a `handle()`
  Response carrying tenant/protected data → `E-PROTECT-004`/`E-TENANT-RAW-EGRESS`) sits behind the #593
  handle-onion defect (routed to bryan) AND is in bryan's security-envelope lane. The mechanical compile
  primitives on the #471 path are now fixed (formData await #588, Response scope + content-type #590,
  bare-numeric #592); the remaining #471 work is coordinated/ruling-gated, not solo peter work.
- **★ OWNERSHIP-FIRST + REPRO-FIRST both still bind:** before fixing ANY gap, repro on HEAD AND grep the heading
  for `ROUTED-TO-BRYAN` / `prov=ruling|dd|debate` FIRST. See `[[scrml-med-shortlist-gaps-stale-verify-first]]`.
- **The productive vein is DOG-FOOD:** write an adopter's real program, compile it, RUN the emitted server, fix
  the next break — that's how the S355 HIGH surfaced. Mechanical bundle-hunting is exhausted (S354 finding).

### C. Owed regardless of lane
- **This wrap's continuity PR** (hand-off + changelog + delta-log [1602]-[1605]) — the branch-first continuity
  commit for S355; being pushed as part of this wrap.

## WHAT LANDED (S355-peter)

| PR | What | Result |
|---|---|---|
| **#590** | #471 manual-`Response` egress | ⭐ **adopter unblock** — `Response`/`Request`/`Headers` allowlisted (HIGH `g-handle-new-response-fires-e-scope-001`) + `emitObjectKey` re-quotes non-identifier keys so `{ "content-type": v }` is valid (MED). Flipped the `authed-server` E-SCOPE-001 pin (its own tripwire firing as designed); passthrough security guard now load-bearing, verified. `File`/`FormData`/`Blob` held for bryan's dpa-030. |
| **#591** | self-host DCL once (LOW) | `emitEventWiring`'s DOMContentLoaded close → `}, { once: true });`, into main-codegen parity; closes the LAST leg of `g-residual-order-bearing-readdir-and-unonced-self-host-dcl` (verified live via `build-self-host.js` cg.js concat) |
| **#592** | bare-numeric object key (LOW) | `expression-parser.ts:2774` leaked a numeric `Literal` key as a NUMBER past `emitProp`'s string guard → E-CODEGEN-INVALID-LOGIC; stringify the literal key value, composing with #590's `emitObjectKey` |
| **#593** | ⭐ **HIGH dog-food find, ROUTED-TO-BRYAN** | `g-handle-onion-applied-per-route-not-top-level-custom-paths-404` — `handle()` wired per-route not as the §40.3 top-level onion → custom-path interception 404s; handle()-only program = dead code. Filed with full repro/trace/run-proof + the §40.3 ruling question. Docs-only PR (no code — bryan's architectural fix). |

**Gap counts:** HIGH 46→47 · MED 148 · LOW 69→68 (net: 1 new open HIGH filed [#593], 3 born-resolved [#590 ×2, #592], 1 pre-existing LOW closed [#591]).
**Gate:** cloud gate green on all 4 PRs (gate + windows PASS). Local: new tests 8/8, corpus conformance 1015/0,
`authed-server` 17/18 (the 1 = Windows EBUSY `afterAll` teardown, Linux-green). Tracking-job baseline (dev-watcher
×4 + R26 ×7, 11 fails) is PRE-EXISTING (identical on #580/#579), root-caused not waved.
**The session's method (proven):** **dog-food** — write the adopter's real shape, compile it, RUN the emitted
server. Three of four PRs trace to it; it surfaced a HIGH the shortlist never would. Mechanical bundles are done.

---

<!-- ================= S352 WRAP (history) ================= -->

# scrml — Session 352 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-19. `/boot`, Profile A, solo. **Ten PRs merged (#564-#573).**

**Read this framing first: the session's output was CONVERSION, not construction.** Very little code
landed. What changed is that a queue of *blocked deliberations* became a queue of *buildable arcs* —
six operator rulings, four advisories drained, and both blockers on the held security cluster cleared.
**Almost nothing on the pickup list below existed as startable this morning.**

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⭐ THE BOARD IS NOW BUILDABLE — five arcs, all newly unblocked, none started

| arc | unblocked by | first move |
|---|---|---|
| **raw-egress structural fix** | dpa-033 ruled + M4 resolved — BOTH cleared S352 | land (c): delete the `reveal` suppressor from the raw-egress gate (subtractive, ~−80 LOC, zero adopter migration) |
| **(d) sink-level lowering** | follows (c) | `JSON.stringify(_scrml_protect_redact(x))` at mediatable raw sinks; (c) stays the floor beneath it |
| **i18n substrate B** | dpa-032 ruled | author-settable `lang` (one line, `codegen/index.ts:2261`) · declared locale set · `Intl.PluralRules` · locale as formatter default · locale as route dimension |
| **dpa-035 replacement sequence** | dpa-035 ruled | `--minify` for real (a shipped flag that is a documented NO-OP) → runtime tree-shaking → `I-SSR-EACH-CLIENT-RENDERED` → dead-rule elimination in `#{}` |
| **dpa-029 Q1 re-surface** | after the raw-egress fix lands | re-ask (a)-vs-(b) against a now-SOUND `handle()`; `Egress<Bytes>` is deferred, NOT rejected |

**Sequencing that is already ruled, do not re-derive:** the raw-egress fix comes FIRST (dpa-029 Q1),
`--minify` before the fold-adjacent work (dpa-035), and the four routed dpa-030 defects land before the
`File` primitive (S347).

### 2. ⚠️ TWO FIX ROUNDS INCOMPLETE — both pushed and safe, neither landable

Both agents stalled repeatedly at a 600s watchdog. **All work is on origin; nothing is at risk.**

- **`soft-nav-head-sync` @ `70c14838`** (origin). Items 1-2 DONE: the park mechanism was settled in real
  Chromium and the fix is committed (+88 L in `runtime-template.js`). **Item 3 is the one that matters
  and is NOT done** — a chunk-delay dimension in the browser test that must FAIL against the unfixed
  runtime and PASS after. The existing 558-line suite *structurally cannot see* the defect (its
  `cssDelayMs` knob delays only stylesheets; there is no chunk delay anywhere in the file; the no-flash
  assertion samples only from the moment destination content becomes visible, and the defect lives
  entirely before that). Also outstanding: the silent-404 diagnostic, and a suite + gzip measurement.
  ⚑ **This fix merges CLEAN onto current main** (only conflict is generated `docs/FACTS.md`).
- **`runtime-size-and-probes` @ `083ce19e`** (origin). F1/F2/F3/F5/F9 fixed with two-sided bite proofs
  logged. **PA-VERIFIED both HIGHs myself** — F2 now resolves the canonical queue and *names it* in the
  output; F1 prints `⛔ COULD NOT ENUMERATE` instead of a confident tick. Remaining: run `boot.ts`,
  final verify, land. The `authority-needed:` mandate it depends on is ALREADY APPLIED to
  `../scrml-support/dpa-scrml.md`.

### 3. ⭐ OWED OUTWARD — scrml-site is still working around us

scrml.dev runs `hard` on **all 551 internal `<a>`** purely to work around the soft-nav defect, and
committed to reverting the day it lands. **The ping is owed the moment `soft-nav-head-sync` lands.**
An ack was already delivered at S350 (`scrml-site` `6f30344`); this is the follow-through.

### 4. Two dPA advisories left, and one should NOT be ruled as-is

- **dpa-024** — §§1-3/Q5 only (Q4 was ruled + landed S337). Its structural claim is now
  **independently re-verified** (128 in-place AST decoration fields vs its 127 nine days ago;
  conformance 883/883). **Rulable.**
- **dpa-034 (editions)** — a ONE-WAY door, and **2 of its 5 panel seats never went live**
  (`rust-edition-expert`, `haskell-language-pragma-expert` — `Agent type not found`, twice). One
  unasked question is whether scrml even HAS a unit that could carry an edition; if it does not,
  editions may be structurally unavailable for reasons unrelated to the population argument — which
  would BE the missing language-design answer. **On dpa-019 a late-live voice was the highest-impact
  contribution and would have flipped the verdict. Re-poll before ruling.**
- ⚑ Also carried: dpa-035's own panel gap — the critical-rendering-path voice was forged this session
  and could not be polled. Both are the same next-boot roster constraint.

### 5. The two artifacts that changed how the board reads

- **The 16 KB gate now measures the shape that ships** (#571). The old assertion measured a five-line
  counter button and is the ONLY gzip assertion in the tree. **Do not re-open hold-vs-raise** — that
  fork was DISSOLVED, and `delta-log [759]` shows it had *already* been ruled HOLD by bryan long ago
  and never recorded. The new ratchet is lowerable-only; raising it needs an explicit ruling.
- **`git gc` works again** after six sessions. The repo-wide failure is closed additively (blob
  restored from the verified salvage, cache-tree rebuilt to the same tree it always named).

---

## ⚑ MISSES (mine, recorded because they will recur)

1. **★ I dispatched without re-asserting the working root, and the worktree was cut from the wrong
   repository.** I committed a user-voice entry in `scrml-support`, my shell CWD stayed there, and
   `isolation: worktree` provisions from the Bash CWD. I have `cd <scrml> && pwd` before every
   worktree dispatch written down as a rule. Cost: one wasted dispatch. It cost nothing worse only
   because the agent aborted at startup check 1 rather than falling back to writing into the main
   checkout. **The rule is not "remember" — it is that the assert must be the LAST thing before the
   dispatch, in the same turn.**
2. **★ I ratified dpa-033 into the prose block and not the authoritative TABLE row**, so `dpa-debt.ts`
   — which anchors on column 3 — still read it ADVISORY. That is finding F5 of the probes review
   (*one file, two reading surfaces*) committed by me **within the hour of reading it**. Caught only
   because I ran the probe before adding the next item rather than after.
3. **★ I corrected ONE instance of a stale figure and called it corrected.** The `127 B margin` was in
   three places; an agent found a fourth with a hyphenated spelling a plain grep misses.
   **Correcting *an* instance is not correcting *the number*.**
4. **My first bite probe used repetitive filler and slipped through silently** — it gzips to nothing.
   Not a gate defect (the ratchet gates shipped bytes, correctly), but I nearly reported a
   non-reproduction as a finding. Re-ran with high-entropy content and it bit.
5. Five agent stalls at the 600s watchdog. **The mitigation that works is narrow-scope + commit-and-push
   after EVERY item** — the resumed agents kept everything; the batching ones lost hours. One root cause
   identified: the pre-commit hook runs ~2 min, the agent's shell times out, the watchdog counts it as
   no progress. **Check `git log -1` before retrying a timed-out commit; it usually landed.**

## 🧷 STATE

- **main** `d042fa35` + the wrap PR. Coherence 0/0. Cloud `gate` green.
- Gaps: **HIGH 46 · MED 151 · LOW 69 · NOMINAL 1**. dPA: **35 queued · 0 UNRUN · 2 ADVISORY**.
- **Review floor: drained TWICE** — the second time it caught this session's own eight PRs, which is
  the probe doing exactly its job on its author.
- `ruling-debt` **1 OWED → 0**. `inbox-stranded` still reports 2 stranded July messages (pre-existing;
  the probe is not landed yet — it lives on `runtime-size-and-probes`).
- **Worktrees 66 → 61.** Two RETAINED deliberately (the two unlanded fix rounds). ⚑ **~59 are
  pre-existing from prior sessions and are accumulating** — S343 retained many deliberately, so a sweep
  needs its own dry-run pass, but it is now the largest untended mechanical debt.
- Delta-log `[1577]`-`[1588]`. Salvage from this session: `EXEC-FINDINGS.md` (426 L) + the probes
  agent's in-progress work, both in the session scratchpad.

---

# scrml — Session 350 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-17 → 08-19. `/boot recover unwrapped session`, Profile A. Booted as the recovery
successor to **S349-bryan, which died unwrapped**. **S351-peter ran concurrently** and landed 3 fixes
+ continuity (#560/#561/#562/#563); this wrap merges his work rather than replacing it.

**Nothing of mine is on `main` except this continuity PR.** Four arcs are complete-and-held, all
pushed, none landed. That is a choice, not a stall — three of the four are held by a *ruling*, not by
engineering.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⭐ THE SESSION'S REAL FINDING: the bottleneck is DELIVERY, not deliberation

**Five instances in one day of FINISHED work that no probe read.** This is the forest; everything
else is trees.

| finished work | filed where | read by | lost |
|---|---|---|---|
| Peter's dpa-030 OQ-2 (4th ingress door) | inbox memo | nothing | 2d |
| scrml-site's soft-nav HIGH bug report | a git branch | nothing on `main` | 1d |
| the PA's own dpa-033 | delta-log | not the dPA queue | same-session |
| **the sliding-doors audit's #1 rec (R5)** | `rulings-pending/` | nothing | **3d** |
| `dpa-029-Q1-egress-envelope.md` | `rulings-pending/` | nothing | **2d** |

bryan asked whether he'd ever seen the sliding-doors results. **He had not — they exist and are
good** (`scrml-support/docs/audits/sliding-doors-corpus-zero-2026-08-16/GRAPH.md`: 324 sites → ~37
decisions, ranked R1-R7). The audit's own "Next" said *bring bryan R5*. It sat three days.

**Two probes now exist for this** (branch `runtime-size-and-probes`, NOT landed): `inbox-stranded.ts`
and `ruling-debt.ts`, both registered in `boot.ts`, both bite-proven two-sided. **They are RED today
over real backlog (3 stranded messages, 1 unqueued ruling) — drain them at the next landing or they
decay into wallpaper (§8).**

### 2. ⭐ SIX dPA ADVISORIES AWAIT bryan — 0 UNRUN, all ran, none ratified

`dpa-022 · 024 · 029 · 032 · 033 · 034`. Per S346 cadence: surface ONE in depth, rule, bank, next.
**Do NOT rule 022/024 cold** (stale premises). The two freshest:

- **dpa-033** — `reveal` on raw egress. **The Rule 4 gate DISSOLVED most of this item:** §14.8.9
  (`SPEC.md:8506-8513`) already mandates VALUE-scoped declassification in four phrases (*at the
  value* · *here only* · *declassified-at-this-value* · *at the sink*), so the implementation's
  body/closure-wide `revealed` union is the NON-CONFORMANT state and tightening it is a **bug fix**,
  not an amendment. **One bounded question remains:** is `reveal`-on-raw-egress a spelling scrml keeps
  at all, or does raw egress become a place protected columns cannot go? Migration measured: `.reveal(`
  in exactly **2** `.scrml` files, both dedicated conformance cases.
- **dpa-034** — editions. ⚠ **TWO artifacts exist** (a PA scheduling error — the PA fired a lane on an
  item already in the dPA drain path). Neither supersedes the other; consolidate after the ruling.
  ★★ **The audit's headline argument is measurably FALSE and four artifacts propagated it:**
  `gh issue list --state all` → three authors all time, **`#471` and `Peter` are the SAME person
  (`pjoliver11`)**. The two-friends premise is **CONFIRMED, not falsified** — strike it for being the
  WRONG KIND of reason (S346), not for being stale. Also: the PA's own "re-earn on Go/C++ `-std=`"
  rec is **self-undermining** (both ARE coexistence mechanisms); §62 is **100% unbuilt**; and the
  no-editions lifecycle **already ran end-to-end via `<machine>` and worked**.

### 3. Four arcs complete + held, all pushed, none landed

| branch | SHA | state | blocked on |
|---|---|---|---|
| `soft-nav-head-sync` | `f4529dd5` | **complete, red-before-green proven (7 of 9 fail unfixed, 10/10 fixed)** | **its S239 pass** |
| `egress-tojson-root` | `eb170a84` | 3 fail-opens closed; **1 residual fail-open** | **dpa-033 ruling** + M4 |
| `comment-token-fix-r1` | `67ad4e05` | **DO-NOT-LAND** — S239 found a HIGH regression | fix round |
| `runtime-size-and-probes` | `5a8f2375` | complete (measurement + 2 probes) | PA review |

Plus `dtr-r7` `152dfa47` — DO-NOT-LAND until comment-tokens land.

### 4. ⭐ The 16 KB budget: the fork is asked about a number that doesn't measure the thing

**Two independent measurements converged on this.** The gate exists
(`v0-3-x-spa-tree-shake-phase-b.test.js:145`, pre-commit) — **and its `SPA_COUNTER` fixture has no
`<program>`/`<outlet>`, so it never assembles the chunk where the soft-nav engine lives.**

- gated artifact: **15,600 B** (784 B margin — recorded 127 B was stale by 6×)
- `<program>`+`<outlet/>` shell, **what scrml.dev ships**: **28,190 B = 1.72× budget, before any fix**
- TodoMVC runtime: **44,557 B — 28 KB over**

**bryan's third path is right, but via the other lever:** name-shortening saves **245 B (1.6%)**;
**comment-stripping saves 9,843 B (63.1%)** — 49.1% of the shipped core runtime is compiler-maintainer
prose going into end users' browsers, with **zero** `@license`/`@preserve`/sourcemap pragmas, so
removal is provably inert. **Recommendation: DROP name-shortening (not defer); comment-strip
production-only, core runtime only.** Owed before building: a real Chromium run (S265).

### 5. Owed to scrml-site — ours to unblock

scrml.dev runs `hard` on **all 551 internal `<a>`** purely to work around the soft-nav defect. They
committed to reverting the day it lands and asked to be pinged on their inbox. An ack is delivered
(`scrml-site` `6f30344`); **the ping is still owed.**

---

## ⚑ MISSES (mine, recorded because they will recur)

1. **★ I banked a false mechanism as fact within minutes.** Work vanished during a commit; I had a
   clean reproducer and a plausible cause, and wrote *"the pre-commit hook is destructive when
   interrupted"* into the ledger. **It was a concurrent review agent** that ran `git checkout <branch>
   -- .` in the MAIN checkout and restored with `reset && checkout HEAD`. The hook is exonerated. It
   also explains the full-suite run (~28 modified files defeated the docs-only detector). Caught ONLY
   because the agent self-disclosed — I had no probe. **The empirical-sufficiency illusion applied to a
   friction report.** [1568] left in place as superseded; the misattribution IS the lesson.
2. **★ I told a dispatch "no gate enforces the budget" as fact.** It does, and `known-gaps.md` names
   the exact file:line. I grepped `16384` and missed `16 * 1024`.
3. **★ I propagated the `#471`-falsifies-two-friends claim** into a bank entry without checking. One
   command refuted it. I was the fourth hop of a laundering trace.
4. **★ I duplicated dpa-034** by firing a lane on an item already in the dPA's drain path — didn't
   check before spending it.
5. **★ My own soft-nav "delivery" was incomplete** — moved to `read/` on an unlanded branch, so it read
   as handled while `main` had it nowhere. A fix that lives only on a branch is not a delivery.
6. Raised a context floor at "88%" when we were at 77%. bryan's budget signals are authoritative.

## 🧷 STATE

- **main** `70eef677`; this branch merges it (0 behind). Cloud `gate` GREEN.
- Gaps: **HIGH 46 · MED 150 · LOW 69 · NOMINAL 1**. Review floor **0 OWED** (Peter drained it).
- dPA: **34 queued · 0 UNRUN · 6 ADVISORY**. corpus-zero: 2 OWED (bryan's).
- **Delta-log numbering collided THREE times** — with S351-peter twice and with the **dPA writing
  into the PA's checked-out branch**. Resolved to an unbroken `1537`-`1576`. *The sequence is a shared
  mutable counter with no allocation mechanism; it will collide again. Cheap fix: per-session prefixes.*
- **`git gc` is failing repo-wide** (`bad tree object fb316444…`, unreachable from any ref) — every
  ref verifies, no work at risk, but auto-repack never runs and the object store will grow.
- Pre-existing delta-log duplicate at `[1524]`/`[1525]`, from before this session.
