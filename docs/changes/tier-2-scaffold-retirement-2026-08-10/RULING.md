---
status: current
last-reviewed: 2026-08-10
provenance: dd:scrml-support/docs/deep-dives/compiler-architecture-for-this-language-dpa-024-2026-08-10.md
---

# RULING — the tier-2 scaffold retirement rule, and conformance fork 2 resolved

**S337-bryan · 2026-08-10.** Authority: **dpa-024** (`(dpa:dpa-024)`), run S337. bryan authorized this
arc verbatim: *"go, take the tier-2 retirement rule."*

This is a **policy** ruling. **No code changes. No charter change. No rework.** It writes down a rule
that has so far been applied by instinct, and resolves one carried-forward open fork before the wave
that activates it opens.

---

## 0. The one-paragraph version

impl#2 (`compiler/self-host-v2`) is graded by the **conformance contract** — which diagnostic codes
fire and what the runtime effect is. AST shape and emitted-JS text are explicit implementation
**freedoms**. Matching impl#1 on either is a **development scaffold**, never a definition of done. At
the parser wave, matching impl#1's AST is not merely optional but **forbidden as an oracle**, because
impl#1's AST is built the one way the ratified data model says impl#2 must not be built.

---

## 1. What is already ratified (verified from primary sources — do NOT re-derive)

Each quote was read at its cited line during this ruling, not inherited from the DD:

| # | Source | Verbatim |
|---|---|---|
| 1 | `docs/changes/compiler-reimagining-derisk-2026-06-26/RULING.md:11` | *"the **parity-port FRAMING is DROPPED**; human-authorship is KEPT. Success metric = **"is this how a scrml native would write it,"** not "is it a faithful port of the TS compiler.""* |
| 2 | `scrml-support/docs/deep-dives/language-compiler-split-2026-06-29.md:47` (**D3, RATIFIED S230** — bryan verbatim at `:110`: *"just codes, runtime only. ratify"*) | *"Two implementations must agree on **(a) which diagnostic CODES fire** and **(b) the RUNTIME effect** — full stop. Message **text**, emitted-**JS shape**, and **AST** are all explicit **implementation freedom**."* |
| 3 | `scrml-support/docs/deep-dives/compiler-arch-conformance-driven-build-2026-06-30.md:340-343` | *"Tiers 2 and 3 are development scaffolds … **a future agent must not promote tier-2 AST-parity or tier-3 byte-identity into the language contract**"* |
| 4 | `docs/changes/compiler-architecture-skeleton-2026-06-30/RULING.md:13` | *"**TypedProgram = stable AST + immutable id-indexed SIDE-TABLES** (scopes/types/depGraph/…), **NOT in-place decoration** (forced by §45.6/§59.5)."* |

**The charter is already correct, already ratified, and already firewalled. This ruling does not
change it.** Q4 as banked in dpa-024 asked whether Road-B's *charter* should move from parity to the
better architecture; **that premise was factually wrong** — parity framing was dropped at S222, 14
sessions before the question was asked. Recorded here because a wrong premise that survives in a
banked item costs the next reader the same detour.

---

## 2. The problem this ruling fixes — the gap between the ruling and the practice

The charter says conformance. **The practice says impl#1.** Measured in
`compiler/self-host-v2/progress.md`: **53 occurrences** of `byte-identical` / `impl#1`, including
*"an impl#1 asymmetry matched"* (`:222`) and *"stays byte-identical to impl#1"* (`:339`, `:404`) — each
written as a **success condition**, and each filing an impl#1 divergence as a thing to close.

That is not a violation of anything written down, which is exactly the problem: **the sanctioned
tier-2 scaffold has become the de-facto definition of done, and no rule says when it stops.**

**Why it is nearly harmless today and becomes expensive at the next wave.** The lexer produces a flat
token stream: token-diffing against impl#1 is a legitimate, cheap, correct scaffold, and the lexer's
337/337 green is real. **The parser produces a `FileAST`** — and impl#1's `FileAST` carries **127
distinct `_`-prefixed in-place decoration fields**, which is precisely the model source #4 above
forbids. Grading impl#2's parser by AST-parity against impl#1 therefore **forces impl#2 to reproduce
the one thing the ratified data model says it must not do.**

**A ratified decision and the working practice are in direct conflict, and the conflict activates the
day the parser wave opens.** The lexer is complete; the parser wave has not started. This is the last
moment the fix is free.

---

## 3. THE RULE (three clauses, binding on every impl#2 wave)

**R1 — A tier-2 or tier-3 scaffold may NEVER be a wave's exit criterion.**
A wave exits on **tier-1** (D3: which codes fire + runtime effect). Where tier-1 cannot yet run for a
wave, the wave exits on an **explicit written statement of what tier-1 *would* assert**, recorded in
that wave's `progress.md` before the wave closes. A scaffold may inform the work; it may never *end*
it. *(Rationale: a scaffold that is also the exit criterion is indistinguishable from a contract, which
is exactly the promotion source #3 forbids.)*

**R2 — At the parser wave and beyond, AST-shape parity against impl#1 is FORBIDDEN as an oracle** —
not merely optional. It is permitted only as a transient debugging aid, never recorded as a pass
condition. **This resolves conformance fork 2** (§4).

**R3 — An accepted impl#1 divergence is logged as a FREEDOM EXERCISED, not a DEBT OWED.**
D3 makes AST and emitted-JS shape implementation freedoms; a convention that files every divergence as
a thing to close silently re-welds the freedom into an obligation. `progress.md` inverts its convention
accordingly: a divergence is recorded as a decision with its reason, and only a **tier-1** disagreement
(codes or runtime effect) is a defect.

---

## 4. Conformance fork 2 — RESOLVED: mixed-pipeline bootstrap

**The fork** (`docs/changes/compiler-architecture-skeleton-2026-06-30/RULING.md:30`, carried forward as
open): at the parser wave, is impl#2 graded by the **within-node AST-parity classifier** (built,
available, fast, sanctioned as tier-2) or by a **mixed-pipeline bootstrap** (impl#2 parser + impl#1
analyze/emit, run against real conformance cases — slower to stand up, tier-1 and D3-clean)?

**RULED: the mixed-pipeline bootstrap.** Decided by the PA under the `pa-base` §1 FORK RULE, whose
rows are checkable against source and which **all four discriminate the same way** — the first row
alone decides, and the rest agree:

| row | discriminator | which way |
|---|---|---|
| 1 | LIMIT or WIDEN a primitive? | **LIMIT** — forbidding an oracle narrows what counts as passing. Limit wins. |
| 2 | fail OPEN or CLOSED? | AST-parity fails **OPEN** — impl#2 can match impl#1 node-for-node and still diverge on codes/runtime, and a legitimate D3 freedom reads as a failure. Conformance fails **CLOSED**. A fail-open oracle is disqualified *before* cost. |
| 3 | REVERSIBLE? | Parity at the parser wave shapes impl#2's `FileAST` after impl#1's, and every downstream wave (analyze, lower+emit) consumes that shape — a **one-way door**. The bootstrap is reversible. |
| 4 | ROOT or POSITION? | The bootstrap grades the **contract** (root). Parity grades a **proxy for the contract** (position). |

**Escalation was considered and declined.** The FORK RULE escalates when rows 1–4 do not discriminate.
Here they are unanimous *and* the fork's own source repudiates within-node AST parity as a cross-impl
oracle. There is no live disagreement for bryan to arbitrate — only a rule to write down. If bryan
wants the poles argued rather than ruled, dpa-024 §7.3 states its own non-neutrality and an R3 debate
framing is available; this ruling is reversible on his word.

---

## 5. Cost, both ways (the honest comparison)

**Acting now:** this document + the `progress.md` convention inversion. **No code. No rework** — the
lexer's token-diff was legitimate under R1 and stays exactly as it is. One session.

**Letting it ride:** the parser wave opens against the parity classifier *because it is the built,
available, sanctioned instrument* — the path of least resistance, which is how the seam got minted for
two months after SPEC, conformance and adopters existed. impl#2's parser is then shaped by impl#1's
`FileAST`; every later wave consumes that shape, so cost **compounds rather than accrues**. The
recovery move is a parser rewrite *after* downstream waves depend on it.

**We have a small-scale rehearsal of that exact outcome already.**
`compiler/native-walker/engine-statechild-walker.ts` replaced a text re-scanner with a structured walk
and is **STALLED with BOTH implementations live**, the legacy one retained "as a fallback" and the new
one required to mirror the old one's quirks. That is this failure at one file's scale. R2 exists to
stop it happening at whole-front-end scale.

**Asymmetry:** acting now costs one session and risks nothing — the charter does not change; only a
scaffold-retirement rule is written. Letting it ride costs nothing today and risks the largest single
rework on the board.

---

## 6. What this ruling does NOT do

- **Does not change Road-B's charter.** It was already conformance-not-parity (source #1).
- **Does not re-architect impl#1.** dpa-024's Q5 null is **MET for impl#1** — it is off the V1
  critical path, terminal, and ~76% of open gaps are outside the class. Keep patching.
- **Does not invalidate the lexer wave.** 337/337 stands; token-diff was a legitimate scaffold.
- **Does not claim the bug loop is architectural.** dpa-024's corrective, recorded because it cuts
  against the intuition that opened the question: conformance pins roughly **18 of ~60 surfaces**, so
  ~42 are unpinned and each pass finds genuinely *new* defects. **The loop ends when the contract is
  complete, not when the architecture changes.**

---

## 7. Cross-references

- **dpa-024** artifact + queue item (`handOffs/dpa-queue.md`) — the deliberation this implements.
- `docs/changes/compiler-architecture-skeleton-2026-06-30/RULING.md` — §30's open fork, now resolved
  (amended in the same landing per the `pa-base` §2 same-landing supersession discipline).
- `docs/changes/compiler-reimagining-derisk-2026-06-26/RULING.md` — S222, parity framing dropped.
- `compiler/self-host-v2/progress.md` — the convention R3 inverts.
