# scrml — Session 402 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-05/06. Booted `/boot` Profile A onto `68ed2ce2`. Ran solo (S401-peter wrapped).
**14 PRs landed.** Mechanical state — landings, counts, the session stream — is in `docs/changelog.md`
and `handOffs/delta-log.md` ([2812]–[2855]); this file carries only what those cannot.

**The framing: this session stopped being an execution session.** Mid-way, bryan hand-wrote ~20 lines
of scrml on his other machine — **the first scrml ever written by a human** — and found two HIGHs the
entire 2,400-file LLM-authored corpus had never surfaced. Everything after that is measurement against
one question: *is this language salvageable?*

---

## ⏭ NEXT-SESSION PICKUP

### 1. ⚑⚑ OPEN ON THE `int`/`number` RULING — bryan's explicit instruction
> *"start next session with expounding on int/number"*

**It blocks §7.5.1 position 3 — bryan's own `fn bad(a: number, b: string)` case.** Position 3 is
**97.5% false-positive today**: of 40 corpus rejections, **37 are `f(k: int)` called with `1`**, and
**SPEC has no `int`/`number` assignability rule anywhere** (searched; §53's grammar lists `integer` as
a base type, §14.1.2 lists `int` as a builtin, nothing rules the pair). `int` → `tPrimitive("integer")`
in `BUILTIN_TYPES`; `fieldTypeEquals` compares primitives by NAME.

**One sentence of SPEC unblocks the check bryan actually wanted.** The remaining 3 of 40: 1 union-source
gap in `fieldTypeAssignable`, and **1 genuine defect** in the flagship (`loads.scrml`, `matchesFilter`
passes `loadStatus: string` into `isActiveLoad(status: LoadStatus)`; the author's own comment shows they
knew).

⚑ **And be honest about what position 3 buys**, because the scoping was: **900 of 1034 resolved call
positions have an UNANNOTATED param**, and `compiler/self-host` has **74 `fn` declarations with ZERO
annotated parameters**. Enforcement has almost nothing to bite on *in the corpus* — but the corpus is
LLM-authored, and the one human who wrote scrml annotated on his first try and got nothing back.

### 2. THE THREE MEASUREMENTS — all landed, all re-runnable
- **Native-parser flip** (`scripts/native-parser-flip-harness.ts`, committed): control 54 · **NEW 1860 /
  GONE 7**. Like-for-like **416 vs S170's 508** (−18%), and the decline was **not** bought by parser
  work. **~90 sessions to flip.**
- **Bridge survey**: the optimistic case is **dead**. Plumbing ≤3% (an oracle upper bound), real parser
  divergence **73%**, ~23 clusters, largest a **122-edit-site check relocation**. **17% of conformance
  sources fail to parse** under native. ⚑ The premise it tested — "the bridge doesn't carry AST fields"
  — was **never measurable**: `conformance/run.ts:326` `missing` holds *codes*, not fields.
- **Type-annotation census** (re-runnable): **28% → 33% enforced** after this session's two wins. The
  split is the finding: §53 predicates **6/7**, §7.5 base annotations **4/29 → 6/29**.

⚑ **THE TWO LAYERS SWAPPED PLACES against the session's opening read.** The type system — which I
called healthy off a clean entry-ness landing — has the **tractable** problem (a working engine simply
not wired to plain annotations). The parser — which has a built replacement and a ratified deletion
plan — has the **intractable** one.

### 3. HELD, NOT LANDED
- **PR #865 (DRAFT) — the apostrophe fix.** `worktree-agent-a4652f4f211575b20` @ `3e310877`, 56 tests.
  **Stopped by rule at five rounds**; four of five each produced a NEW same-class silent drop. Round
  5's case is ordinary scrml. **Ruling owed** — restructure to one shared body-mode-aware scanner ·
  a narrower fix (may not exist) · or neither, because Charter B deletes the block-splitter.
- **Three S400 branches still retained** (`ad288a300a89587b0` @ `32621e48` · `a7754ec5541a9ab8f` @
  `b0e9469d` · `a908cd66f7d2bf2db` @ `856e8f27`). ⚑ **The prod-404 arc is NOT unblocked by the
  entry-ness landing** — §40.8 makes entry identity a BUILD fact over a file SET.

### 4. RULINGS OWED — bryan's
- **`int`/`number` assignability** (§1 above) — the opener.
- **The apostrophe restructure fork** (§3).
- **dpa-043 (lazy/pull/`yield`)** and **dpa-044 (stateful scanning)** — both COMPLETE-ADVISORY, awaiting
  ratification. dpa-043's banked question is **false as framed** (scrml has had normative lazy pull since
  §6.6.3, predating §13.6); dpa-044's **Call 1 outranks its own banked question**.
- **dpa-037/038/039/040/041/042** — still owed, 039 time-sensitive.
- **The worktree sweep** — 48 sweepable, **36 branches carrying work that never reached main**.
- **S391 FSP `Initialize`** — read and decision-ready in one screen.
- The `/` route collision · the pre-CE alias-mount residual · `g-cli-emits-artifacts` tier.

### 5. RULED THIS SESSION — do not re-open
- **The native-parser meter is VOID** — *"the honest answer is: I don't know."* Measured ambiguous by
  construction. Retired as an instrument; do not quote it either way.
- **All loop forms stay except `do…while`.**
- **`~` is negotiable** against V1 confidence — but **every voice refused the bare delete**; the middle
  bryan named (keep it, make it lexically trivial) is the right diagnosis, and the migration sizing is
  **not done** and must precede scheduling.
- **Land the two cheap wins; bank strip-first.** Both done.

---

## 🔭 DURABLE

**The corpus cannot answer ergonomic questions, and this session proved it twice.** Twenty
hand-written lines produced more signal than 2,400 generated files. Every HIGH filed today is a shape a
human reaches for first: a comment mid-body, an annotated `fn` parameter, an interpolated template in a
state cell. **The corpus is an artifact of what LLMs have seen, and it is blind in exactly the places a
human is not.** Where a design question needs usage evidence about HUMAN need, the corpus is not
evidence — say so and mark the gap.

**The verification lesson, paid for four times today: a control that shares state with the thing under
test proves nothing.** I compared "base vs head" using a checkout that already had the fix pulled into
it and nearly overruled a genuine HIGH. A probe grep pulled `#385` out of a report *header*. A fixture
injected a token into a different state-child than the one under test. **Every one read as clean.**

---

## ⚑ MISSES (mine)

1. **★★★ Contaminated control.** 27 fix-markers in the tree I called "base" vs 0 at `origin/main`; every
   comparison measured the fix against itself. I told the agent the regression looked pre-existing. It
   was real, the reviewer was right.
2. **★★ Ran the advisory `types` gate, never `types:check`** — a separate gate against
   `TYPES-BASELINE.json` that was exit 1 with 2 of ours.
3. **★★ Gave an agent a bad instruction** — *"get `types:check` to exit 0"* — which it correctly refused;
   exit 0 was only reachable by absorbing 12 unrelated diagnostics.
4. **★★ A commit message asserted two gaps were "filed"** while `known-gaps.md` was not in the commit.
5. **★ Relayed bryan's simplification thesis as the narrower question** ("would removal fix the HIGH")
   into dpa-044; his claim is about HARDENING COST.
6. **★ Recorded `#385` as deliberately-left-owed** — it was reviewed clean at S316; my grep matched the
   probe's header line.
7. **★ Two numbers of mine did not reproduce**: "22 files hand-roll comment scanning" (it is **10**) and
   "12 call sites across six scanners" (12 sites, **8** enclosing functions; `findOpenerEnd` not among
   them). Both corrected by the agents that checked them.

## Gate at close
Cloud `gate` GREEN. `tracking` RED — pre-existing and filed
(`g-dev-server-tests-expire-their-wait-budgets-in-cloud-ci-only`); five dev-server tests expire their
own `waitFor` budgets in cloud CI while passing locally. Gaps **HIGH 95 · MED 213 · LOW 90 · Nominal 7**.
Review floor: 1 OWED (the instrument's own recursion). Maps refreshed — ⚑ the watermark was **4 sessions
behind, not 1**. ⚑ **~116 worktrees have accumulated**; the sweep probe is now bite-proven and the dry
run is recorded, but **nothing was removed** — that is bryan's call.
