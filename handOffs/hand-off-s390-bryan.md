# scrml — Session 390 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-30/31. Booted `/boot` Profile A onto clean main. S389-peter ran concurrently and
wrapped mid-session (11 PRs); one live merge race on `docs/pr-reviews.md`, resolved by union.

**The framing: every arc that reported green had a real defect underneath it, and each was found by a
different instrument than the one that declared success.** Six PRs merged. Three gate blind spots
surfaced. The most valuable output is not the landings — it is what the landings proved about the
gates.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚑ dpa-037 IS DRAINED AND AWAITING YOUR RATIFICATION — top of the queue

bryan banked and fired it the same day. **ADVISORY, not ratified** (RUN-not-RATIFY).
Artifact: `../scrml-support/docs/deep-dives/non-finite-float-class-dpa-037-2026-08-31.md` (53KB).

**Headline, PA-unverified (relayed from the artifact — reproduce before acting):** scrml ships **TWO
contradictory equalities** that disagree on exactly one pair. `_scrml_value_canonical`
(`runtime-template.js:5694`) canonicalizes a number as `"n"+String(v)`, so **a NaN map key finds
itself**, while `_scrml_structural_eq(NaN,NaN)` is `false` (`:4097`). Executed side by side they agree
on `(+0,-0)`, `(Inf,Inf)`, `(1,1)` and disagree only on `(NaN,NaN)`.

⚑ **The panel's inference from that was STRUCK by a late adversarial pole:** IEEE-754 ships two
comparison mechanisms deliberately — clause 5.11 (arithmetic, NaN⇒unordered) and clause 5.10
`totalOrder` (2008, for sorting/hashing/containers). **A map-key codec implements 5.10 and is SUPPOSED
to disagree with `==`.** 6/6 back a reflexive `==`; the same voice conceded the conclusion while
striking two of three premises and raising scope from one operator to the comparison FAMILY.

**What is bryan's, verbatim, and what is NOT:** he ruled nothing. *"ok hold on I am not ratifying NaN!
TBC"*. His takes — *"NaN and Infinity are NOT absence values"*, *"not a number is still something, as
is infinity"*, *"NaN is just an error as far as I can figure. I could be wrong"* — are LEANS carried as
leans in the queue item. Every limb is live.

### 2. Three things ruled-or-recommended and NOT built

| item | state |
|---|---|
| **4(b) condition 3** | Recommendation banked, **not ruled**. Measured-zero corpus is necessary and NOT sufficient — proven twice this session. Proposal: a newly-rejecting change owes a measured-zero differential AND an adversarial shape set. Round 5 already paid that cost so the price is visible. **Any change to the class is bryan's by the class's own terms.** |
| **Gate asymmetry** | Open. The required check runs a subset of the local hook (#782 passed it, bricked every local commit); the hook does not run the §34 census (#789 passed the hook, failed the gate). And `compiler/tests/commands/` runs in NO blocking job on any platform. Proposal: make the required check a superset. |
| **The `@`-sigil normative line** | Two gaps filed this session + C9 (a fix built and reverted ~146 sessions ago) are ONE question: what does `@x` mean when `x` is not reactive? No code can be written until it is drawn. Fix is newly-rejecting language-wide. |

### 3. Article — Q1 ANSWERED, Q2/Q3 still pinned

`docs/articles/if-you-give-a-dev-an-enum-2026-08-31.md` (working, 8 versions) +
`…-PUBLISH.md` (generated, no hard-wrapped lines). **Untracked and uncommitted — Rule 1: he raised the
DRAFTING, not the landing.** ~589 words from 1,025.

- **Q1 ANSWERED:** *"end on the loop"* — closing meta section CUT, two-line coda offered and DECLINED.
- **Q2 (how much code) and Q3 (voice) remain open.**
- ⭐ **The criterion is durable and binds every future edit:** *"judging every line (except code blocks,
  those are like the pictures) in a sing-songy way akin to the theme song of the animated series."*
  **Concision is downstream of meter.** See user-voice S390.
- A synthesized git history of the article conversation is at
  `~/scrmlMaster/if-you-give-a-dev-an-enum` (15 commits, authored as the assistant). A first attempt
  at the WRONG scope (whole session) is parked at `~/scrmlMaster/.s390-log-wrong-scope` — delete when
  he says.

### 4. ⚑ FOUR UNREAD ROUTES FROM PETER — deliberately NOT marked read

`handOffs/incoming/` holds four turnkey findings routed to bryan by S389-peter, all arrived during or
after this session's work and **none actioned here**:

- `S389-peter-routes-bindvalue-each-select-under-if.md` — an adopter's Edit form is blank TODAY
- `S389-peter-routes-tilde-string-literal-corruption.md` — HIGH, a `~` inside a string literal corrupted
- `S389-peter-routes-channel-collision-and-latejoin.md`
- `S389-peter-routes-tool-surface-4finds.md` — 4 findings from the §64 tool dog-food, 1 HIGH

**Left in `incoming/`, not moved to `read/`.** Moving them would mark them absorbed when they are not —
that is the exact false-green this session kept finding elsewhere. They are rulings owed by bryan.

### 5. In flight / held

- **Arc (b)** (`worktree-agent-add7025319a51cbb9`, `564525b4`) — un-blanks each-bearing match arms.
  **HELD** on a PA-confirmed `W-DISPLAY-TEXT-OVERQUOTE` double-fire (1→2 on identical source). A
  `nodeTypes` id-collision was alleged and is UNVERIFIED. Its headline finding did NOT reproduce and is
  recorded NOT-REPRODUCED. It is the structural close for the channel-guard fail-open now named in SPEC.
- **Windows path comparison** — real defect, Windows-only, fix written and verified, held as a patch at
  `docs/changes/s385-channel-mount-guard-r8/r8-fix.patch.txt`. `sameFile` compares paths with raw `===`.
  Not urgent; it was NOT the cause of any CI red.

---

## 🔭 DURABLE FINDINGS

### A. ⭐⭐ Measured-zero proved nothing, twice
The 4(b) mandate's third condition was satisfied honestly — **0 of 1005, positive-controlled 25/25** —
and still shipped a hard `E-SCOPE-001` on valid code. Arc (b) repeated it: **0 of 1397**, where only
**5 of 1397** files contain both `<match>` and `<each>`. The inputs that trip a newly-rejecting change
are the ones nobody has written yet, and the corpus is 100% machine-authored, so it carries almost no
ergonomic diversity.

### B. ⭐⭐ Two gates that disagree in BOTH directions
Not one gap — two gates drifted apart, each honest about what it measures. Green on either is weak
evidence about the other.

### C. ⭐ A branch that survives its own landing is indistinguishable from unlanded work
Two items ruled "stamp and land" had landed 7 days earlier. The **ledger was right**
(`status=resolved`); the sweep read branch existence. One was 149 commits stale — landing it would have
reverted ~228 lines of newer work. "Stamp and land" reads risk-free and is not.

### D. ⭐ The verified enumeration is landed and durable
`docs/changes/s385-decision-queue/` — the 84-item queue, the host-fallback census, and the S390
re-verification (**66 live · 59 already-ruled with citations · 7 undetermined**), recovered from a temp
dir that held the only copy. **37 of the 59 were ruled in sessions BEFORE S385** while the ledger still
read "RULING OWED" — that is what manufactures phantom queue depth.

---

## ⚑ MISSES (mine)

1. **★★ I banked bryan's take as a RULED premise.** He said *"my take is this"*; I wrote "RULED" and
   made it the deliberation's floor. He caught it in the same turn. A dPA run against that wording
   would have treated the question as settled.
2. **★★ I claimed a Windows root cause "confirmed by execution" and was wrong twice over** — the job
   does not run the tests covering that function, AND my probe ran on a host where the behaviour I
   called a defect is *correct*. The hold was right; the reasoning under it was not.
3. **★★ I told bryan no test pinned the F1 regression.** It was pinned — in a table consumed by a loop,
   which my `expectNoErrors(` call-site count could never have seen. Wrong-referent, stated as fact.
4. **★ I nearly shipped the synthesized-history constraint broken** — grepped `synthes`, which does not
   match `synthetic`; three leaks including a commit subject. Caught only by re-running with a pattern
   that could fail.
5. **★ I relayed a reviewer's "unrelated commit needs splitting"** — it was already an ancestor of main.
   Checked before briefing, so nothing was built on it.

---

## 🧷 STATE

- **main** `952cecc6` at wrap-branch cut. 6 PRs merged this session: #775 #776 #777 #788 #781 #785 #789.
- **Review floor:** drained to 0 twice (union-rebased 4× against peter's concurrent markers, zero
  markers lost). Re-check after this wrap's own PR.
- **Gaps:** HIGH 71 · MED 188 · LOW 84 (5 filed this session, all PA-confirmed by execution first).
- **`pa-ruled` count: 0.** The S385 record says the each-in ruling was *"recorded `prov=pa-ruled:`"*;
  that marker exists nowhere. Still owed.
- **Maps (wrap 6c): NOT refreshed — stated, not skipped silently.** The stamp predates this session and three files it changed (`component-expander.ts`, `type-system.ts`, `emit-channel.ts`) now sit behind it. A `project-mapper` run at wrap-close would land AFTER the wrap PR and strand its own commit, which is the failure that produced two stranded maps-regen PRs earlier in this project's history. **Owed at next boot, before any dispatch that names a map.**
- **Worktrees:** 6 removed (work landed), 2 RETAINED (arc (b) + the r8 patch). **93 remain on disk** — a long-standing backlog, not this session's; a real sweep is its own arc.
- **Mechanical stream:** delta-log — do not re-derive from this hand-off what it carries.
