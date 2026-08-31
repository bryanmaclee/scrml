# scrml — Session 385 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-29/30. Booted `/boot` Profile A onto a clean main. Solo (S383/S384 both wrapped;
S386–S388-peter ran and landed 13 commits **while this session was live** — see MISS 1).

**The framing: the operator's standing architecture complaint got measured, and the measurement
inverted it.** Cost-per-defect is flat; the loop is a DECISION QUEUE. That finding produced the
session's most consequential ruling — a bounded PA ruling mandate — and reframed everything after it.

⚑ **WRAPPED AT 87.2% CONTEXT with FOUR AGENTS STILL RUNNING.** Deliberate: their reports would have
cost more than the remaining headroom left comfortable. All work is committed per-phase on their
branches. **Pick them up first — SHAs below.**

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. FOUR AGENTS IN FLIGHT — all committed, none landed

| arc | branch | tip | state |
|---|---|---|---|
| **channel-mount guard** | `worktree-agent-a8702b6fc289f0891` | `43878d9c` | **round 6 dispatched, unreported.** Rounds 1-5 clean; round 6 adds `engine-decl` as a third container |
| **each-in scope check** | `worktree-agent-a4c73958a8bad6e3b` | `99287427` | **round 3 dispatched, unreported.** Round 2 pinned a CRASH as clean — must not land as-is |
| **arc (b) each-arm tree** | `worktree-agent-add7025319a51cbb9` | `564525b4` | **COMPLETE, verified, unlanded.** 0 of 1397 differential |
| *(4th)* | — | — | the round-6/round-3 resumes above are the live two |

**Landing order matters.** The channel guard lands first, then arc (b), then the SPEC §34 row is
corrected — because the row currently describes a fail-open that arc (b) removes. Landing them out of
order ships a catalog row the tree contradicts, which is the over-claiming defect ruling 3 exists to
remove.

### 2. ⚑ THE §34 ROW IS OWED AND IS CURRENTLY UNCOMMITTED

`E-CHANNEL-MOUNT-IN-CONDITIONAL` needs its catalog row. I wrote it TWICE and lost it twice (once to the
`refs/stash` race, once to a merge that dropped a commit). **It is in `stash@{0}`** together with the
channel-fix landing work. Its corrected text states the each-bearing fail-open plainly and carries a
do-not-restore note for the text scan. **Re-verify it against the tree before committing** — the
fail-open caveat becomes STALE the moment arc (b) lands.

### 3. The MED/LOW design batch — offered, not started

~32 items. **I recommended verifying them against the ledger before surfacing**, because **8 of ~25
verified today were not live decisions** (A5/A6 already fixed, A10 fixed 41 days earlier, B8's blocker
ruled at S268, 4 never filed at all). bryan had not answered when we wrapped. The C-group HIGHs are
surfaced and ruled; C17-C34 (MED) and C35-C48 (LOW) are untouched.

### 4. OPEN / OWED

| | state |
|---|---|
| **dpa-023** | the async boundary as `(not to T)`. **A9's refusal is explicitly PENDING it** and should expire when it lands |
| **§12.2 SPEC home** | the expression-position policy is ruled but lives only in the voice ledger |
| **`ruling-gated` is invisible** | 6 entries now carry it; `dpa-debt.ts` reports 0 owed. Base §10 again |
| stranded outbox | 4 notes, 3 adopters, two ~93 days old. bryan: deliver flogence's, hold the two stale |
| review floor | drained to 0 earlier; re-check after today's merges |

---

## 🔭 DURABLE FINDINGS

### A. ⭐⭐ The architecture complaint, measured — and it inverted
bryan: *"we are chasing bugs in circles … this is still just a first-draft prototype … where am I wrong?"*
**Fix cost per defect is NOT rising.** Median src files per closed HIGH by 50-session block:
`1 · 2 · 4 · 2 · 2 · 1`; all-severity **p90 fan-out NARROWED 4-6 files → 2**. Severity drift ruled out
structurally; the detection confound replicated independently at 2.64× (dpa-024 measured 2.7×).
**What IS rising:** HIGH filings/session `0.04 → 1.00`, and **30 of 60 open HIGHs blocked on an operator
decision**, median age 38 sessions. Honest limit kept verbatim: *"the rising-cost hypothesis is not
supported and is mildly contradicted," NOT "the compiler is converging."*
⚑ **The sharpening:** the untyped inter-pass contract's cost lands in **defect COUNT, not per-defect
COST**. Typing the representation reduces how many defects exist, not how hard each is. **Any future
proposal justified by "fixes are getting harder" argues from a measured-false premise.**

### B. ⭐ dpa-024 was answered 20 days ago and nobody noticed
The PA nearly fired a duplicate DD on bryan's own instruction. Caught by reading `dpa-queue.md` before
banking. Two of its three PA-action items had been RULED at S337 and §9's first work item had LANDED
(#624) — **the PA's "dropped on the floor" report was itself an overstatement**, corrected before it
reached him. It is now `status: ratified`.

### C. ⭐ An adopter on hand-written JS is a LANGUAGE-FAILURE signal
The PA cited giti's retreat to `.js` as evidence the cost was accepted. bryan: *"If that 'workaround' is
JS, then it's a problem."* giti was migrating FROM `.js` TO scrml and the bug was what stopped them —
**and the census then found the bug had been FIXED 41 days earlier and giti had migrated.** The entry was
a stale-open HIGH with a heading and NO marker. Census: **5 host-fallbacks across 4 adopters, 4 of 5 with
no gap that counts them.** Bigger cost is invisible to it: **in-source contortion** (~19 shape workarounds
in one adopter's `app.scrml`; flogence at 16.3% `_{}` by line).

### D. The ledger loses entries in BOTH directions
**129 marker-without-heading ids** (invisible to heading sweeps) and **heading-without-marker** entries
(invisible to `state.ts` and every board count). A10 was the second kind and hid for 41 days. Four S381
findings were the same. **Every entry filed this session carries BOTH.**

---

## ⚑ MISSES (mine)

1. **★★ I did not re-read the concurrent-session board after boot.** Three peter sessions landed 13
   commits while I was live, and I duplicated one of their arcs end-to-end (they'd already landed the
   diagnostic fix and sent flogence the workaround). **The contract makes registration a BOOT step with
   no staleness rule for a long session.** Proposed amendment: re-check the board and `gh pr list`
   before any dispatch and before any landing.
2. **★★ I mis-diagnosed a `refs/stash` race as a path-discipline leak** and told an agent it was writing
   main-rooted paths it had never written. See delta-log `[1957]`.
3. **★★ I argued a hypothesis dpa-024 had already refuted** (walker count as the defect generator),
   from local evidence, in ~20 minutes. **An artifact that refutes something does not stop it being
   re-invented — the refutation has to be reachable from the SYMPTOM, not only the archive.**
4. **★ I merged a PR that dropped a commit** — committed after pushing. Every push since verifies the
   pushed tip.
5. **★ I shipped a false relayed premise into a brief** ("a guard for that shape now exists" — it was on
   an unlanded branch), and **wrote an over-claiming SPEC row** saying the each-bearing locus fails
   silently when with a read it fails CLOSED. Caught by a reviewer compiling the actual repro.
6. **★ My instruction to add `keyExprRaw` to the same loop would have shipped a false positive** — the
   agent corrected me: `key=` is the ordering MIRROR of `in=`, and the row variable IS in scope for it.

---

## 🧷 STATE

- **main** `4008a3bc` at wrap-branch cut. 3 PRs merged this session: **#769** (dpa-024 ruled + the
  fix-cost measurement) · **#771** (ledger bookkeeping) · **#772** (the recovered gap filings).
- **Rulings taken:** 4(b) the ruling mandate · the §12 expression-position policy · A7 · A8 · C3 · C4 ·
  C8 · B2 · B3 · B4 · B5 · B7 · channel-mount reject + arc (b) promoted · each-in fire-it.
- **Board:** counts regenerated at wrap (`state.ts --write`); **6 entries now `status=ruling-gated`**.
- **Adopter:** flogence flagship **GREEN** on the workaround; they confirmed two channels had never
  connected in production and independently endorsed the reject ruling.
- **Mechanical stream:** delta-log `[1949]`–`[1960]`. Do not re-derive from this hand-off what the
  delta-log and changelog carry.
