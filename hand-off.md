<!-- ============================================================= -->
<!-- hand-off.md — live session state. WRAPPED at S354-peter.       -->
<!-- Mechanical stream: handOffs/delta-log.md [1592]-[1597].        -->
<!-- Body below the S354 block is the S352 WRAP + older (history).  -->
<!-- TWO LANES LIVE: bryan's S352/S353 board is UNSTARTED — see §A.  -->
<!-- ============================================================= -->

# scrml — Session 354 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-19. `/boot` Profile A, solo. **Four PRs merged (#582–#585) + review floor drained.**
A disjoint EXECUTION lane running alongside bryan's still-open S352/S353 deliberation board.

**Framing:** execution + hygiene, not deliberation. Three fix-bundles + a ledger reconciliation, and the
throughline is that **repro-on-HEAD caught stale/misfiled gaps in every bundle** — but the reconciliation
sweep proved that stale-gap debt is BOUNDED (clustered in two already-fixed pockets), not systemic.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

**Two live lanes — pick by who boots.**

### A. bryan's lane — THE BUILDABLE BOARD (still UNSTARTED, carried from S352/S353)
None of this was touched by S354 (disjoint). Full detail in the **S352 WRAP block below** (unchanged). Summary:
- **raw-egress structural fix (c)→(d)** · **i18n substrate B** · **dpa-035 replacement sequence**
  (`--minify` for real → runtime tree-shaking → `I-SSR-EACH-CLIENT-RENDERED` → dead-rule elim) ·
  **dpa-029 Q1 re-surface** after raw-egress lands. Sequencing already ruled — do not re-derive.
- **Two held fix rounds** (pushed, not landable): `soft-nav-head-sync` `70c14838` (item-3 chunk-delay test
  owed) · `runtime-size-and-probes` `083ce19e` (tail verify + land; carries `ruling-debt.ts`).
- **Owed outward:** the scrml-site ping the moment `soft-nav-head-sync` lands (they run `hard` on 551 links).
- If bryan boots: this is your pickup. If peter boots: STAY OFF this lane (collision) — take §B.

### B. peter's lane — disjoint follow-ups from S354 (small)
- **Deferred (LOW):** `g-residual-order-bearing-readdir…`'s **self-host DCL leg** — add `{ once: true }` to the
  `DOMContentLoaded` emit in `compiler/self-host/cg-parts/section-emit-wiring.js` (the open is `:1203`, the
  close is an intricate multi-`lines.push`; find it before editing). Gap is narrowed to this one leg. Low value.
- **Heading/marker cosmetic drift (hygiene, low priority):** 16 entries where the `### ` heading status ≠ the
  `@gap` marker — 15 are `marker=resolved / heading=open` (marker is authoritative & already counted, so the
  *heading text* is stale) + 1 docs gap (`G-DBAUTH-DOCS-NO-DO-NOT-MARK-USERS-EXAMPLE`, L1716, heading=resolved
  marker=open). NOT flipped this session — each needs its marker verified before aligning the heading. Run
  `headingMarkerDrift()` (state.ts, exported) to re-list.
- **Ledger health:** now well-reconciled (7 gaps closed S354). Repro-on-HEAD stays mandatory, but the ledger
  is largely trustworthy — the sweep found only 1 stale among 15 high-signal candidates.

### C. Owed regardless of lane
- **This wrap's continuity PR** (hand-off + changelog + delta-log [1592]-[1597] + the review-floor drain in
  `docs/pr-reviews.md`) must land — it's the branch-first continuity commit.

## WHAT LANDED (S354-peter)

| PR | Bundle | Result |
|---|---|---|
| **#582** | A — type-system raw-text-launder (S338/Rule-7) | 1 HIGH + 2 MED resolved; `maskStringLiteralSpans()` + structural reset member-guard |
| **#583** | B — dev-server | leak HIGH fixed (parent-death guard) + readdir LOW (2 legs); **2 stale gaps flipped** (fail-open HIGH + watcher-death MED, fixed by #539) |
| **#584** | D — `state.ts` ledger-integrity | crosscheck LOW fixed (order-independent `markerCount`) + regression test; **3 stale gaps flipped** (fixed+tested S334) |
| **#585** | reconciliation sweep | 1 verified stale gap flipped (`g-synth-read…`, fixed #291); 14 candidates confirmed legitimately-open |
| — | review floor | #573–#577 drained → **0 OWED** |

**Gap counts:** HIGH 49→47 · MED 157→150 · LOW 70→69 (7 resolved).
**The session's lesson (thrice-earned):** repro-on-HEAD before every fix — the gap shortlist mislocates loci
(`:14589`, `:843`), mis-states mechanisms (the leak was force-killed-parent orphans, not test-reaping), and
carries fixed-but-never-flipped debt (#539 ×2, S334 ×3). The sweep bounded that debt: not systemic.

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
