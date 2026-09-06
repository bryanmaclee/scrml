# scrml — Session 400 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-04/05. Booted `/boot` Profile A onto `83f95592`. Ran alongside peter (S398→S401).
Main closed at `1e69d3b2`. Four landings: **#836 · #851 · #852 · #853**.

**The framing: the day's defects were almost all CLAIMS OF COVERAGE THAT WERE FALSE.** Not bad logic —
instruments, comments, docstrings and normative sentences asserting they checked something they did
not. Eight distinct instances, listed in §4. If you read one thing here, read that.

---

## ⏭ NEXT-SESSION PICKUP

### 1. ⚑⚑ ENTRY-NESS IS NOT A FACT THE COMPILER RECORDS — bryan deferred the fix to next session
**Ruled S400, verbatim: *"we will have to take that fix next session."*** Measured, not asserted:
**11 sites reconstruct "which document is the application entry", using 6 different rules**, and
**no rule is correct on all three real shapes** (flagship · `<program>`-less SPA · channel+page).

| rule | where | flagship | `<prog>`-less | channel+page |
|---|---|---|---|---|
| A `hasProgramRoot` | 6 sites incl. `auth-graph.ts:971` | ✓ | ✗ | ✓ |
| B 3-way shape | `ast-builder.js` — **computed, used for ONE lint, DISCARDED** | ✗ | ✓ | ✗ |
| C pure-module+exports | `api.js:1413` — **a hand copy of B, says so in its own comment** | — | — | — |
| D not-a-top-level-`<page>` | the S400 arc | ✗ | ✓ | ✗ |
| E `inputFiles.length === 1` | `dev.js:949` — **no AST consulted at all** | — | — | — |
| F filesystem position | `route-inference.ts:6392` | ✗ | ✓ | ✗ |

**The fix is smaller than it looks: stop discarding B**, teach it channel files + wrapper-less entries,
have consumers read it. Touches ast-builder · auth-graph · codegen/index · route-inference · dev · api.
**Re-runnable census probe:** `docs/changes/prod-root-fallback-gated-2026-09-05/rulecensus.ts`.
⚑ Falls out of it: `W-PROGRAM-001` fires on all four canonical §38.12.6 channel files in the flagship —
the compiler telling an adopter to wrap a channel in `<program>`.

### 2. TWO HIGH DEFECTS FOUND AND **NOT YET FILED** (ledger was contended all session)
Both are in #853's commit body with full evidence; neither is in `docs/known-gaps.md`.
- **`benchmarks/todomvc/app.scrml` is DEAD ON ARRIVAL since `cdf4f4de` (2026-07-30, `if=` Phase 2
  mount-`<template>`).** Compiles exit 0, throws on first render in BOTH harnesses, zero rows.
  `querySelector` does not descend into template content so `const _scrml_lift_tgt_N` binds null.
  Bisected 12 steps; 24-line repro. ⚑ **`browser-todomvc.test.js` (36/0) and `todomvc-e2e.test.js`
  (10/0) are GREEN against the dead build** — the harness swallows the init throw into `initError`
  and no test asserts a rendered row. Same class as `g-call-expression-interpolation-in-if-chain-
  branch-renders-empty` (resolved S400-peter): that fix stamped `insideMountTemplate` on static-display
  sites, not the lift-target site.
- **A post-May runtime regression: happy-dom `partial-update` 1.04 → 17.9 ms (17.2×), Chrome
  0.80 → 260.7 ms (326×, from 6.9× faster than React to 47× slower).** Moves swap-rows / remove-row /
  delete-every-10th together while select-row and bulk-create stay flat → **per-item reconciliation**.
  Bundle +138%, build 2.06×. Per-round ranges disjoint; not noise.

### 3. TWO ARCS HELD — branches retained, both clean, neither landed
- **Engine state-child producer swap** — `worktree-agent-ad288a300a89587b0` @ **`32621e48`**.
  ⚑ **bryan's Q1 ruling IS BUILT AND PA-VERIFIED BOTH DIRECTIONS** (nested state-child → new
  `E-ENGINE-STATE-CHILD-NESTED`; `<p><Card/></p>` chrome → compiles). Conformance 907/907, `-neg`
  bite-checked, §51.0.B amendment written, `E-CTX-001` reused as a second fire site rather than minted
  (§4.18.3 already assigned it — that call was right, do not undo it).
  **HELD on a reviewer-reported HIGH I did NOT reproduce** (mark RELAYED): `containsPascalCaseOpenerDeep`
  `continue`s on non-`Markup` children while `walkMisplacedStateChildren` now descends them, so they
  disagree and `E-ENGINE-RULE-LEGACY-SYNTAX` fires on an ordinary arrow function, its early `return`
  suppressing the errors that name the real cause. The `-neg` fixture misses it only because it has
  no `=>`. Sibling MEDIUM at `engineHasUnmodellableOpener`. **The agent's transcript is GONE — resume
  is impossible; the branch is what survives.**
- **Prod root-entry fallback (b)** — `worktree-agent-a7754ec5541a9ab8f` @ **`b0e9469d`**. Stopped by
  §1's ruling. The single-document SPA case works end-to-end (incl. `auth="required"` → 302, no leak);
  the multi-file case is disabled by the missing entry fact.
- **Apostrophe branch** — `worktree-agent-a908cd66f7d2bf2db` @ `856e8f27`. Superseded; its six
  conformance cases were harvested into the swap. Safe to sweep.

### 4. ⚑ THE DAY'S DEFECT CLASS — false claims of coverage. Eight instances.
1. `E-PROGRAM-002` cited by a docstring as existing — **unimplemented; two of three grep hits were that
   docstring's own comments.**
2. `bun run bench` passed `--timing`, not an option — **broken since 2026-04-10, never worked in this
   repo**, and pointed at the negative-fixture corpus. Fixed S400; baseline now 8,095 ms on `examples/`.
3. `corpus-emit-differential.ts` false-diffs **1027 of 7427** artifacts across checkout paths and prints
   the full CONTENT DIFFERENCES list **under an INCOMPARABLE verdict**. Used as a landing gate 3× today.
4. `E-TILDE-001/002` — four consumers, **zero producers**; never fired on real source.
5. Two tripwires carrying **the exact defect they existed to catch**.
6. `"cannot corrupt closer-finding"` shipped into the ledger and falsified by the next round's own code.
7. **SPEC §17.6.6's own worked example**, annotated *"valid"*, compiles exit 0 / `node --check` clean and
   emits a `let` read from outside its block — guaranteed `ReferenceError`. Filed HIGH.
8. Both TodoMVC test files green against a dead app (§2).

### 5. RULINGS OWED — bryan's
- **dpa-037 / 038 / 039 / 040** — four calls each; **039 time-sensitive** (warns dpa-030 must not be
  ratified on its premises). **dpa-041 / 042 returned S400** — four calls each, in `handOffs/dpa-queue.md`.
- **§35.8's "the full `lin` rule set applies to `~`" is FALSE on the merits** — dpa-040 and dpa-042
  reached it independently from different directions. That convergence is itself the finding.
- **Q8 `fail .Variant`** — `E-ERROR-009` rejects it while `match` accepts bare-variant on the same type
  in the same file. §14.10 grants inference at LHS/parameter positions; a `fail` operand is neither.
- **Promote `compiler/tests/commands/`** into a blocking job — its one-decider security assertion sits
  outside every gate that can fail a merge.
- **The `/` route collision** — §47.9.2 routes two sources to `/` in a multi-page app with both an entry
  shell and `pages/index.scrml`. Unowned.
- **Bare markup under `pages/`** served at both `/` and `/foo` — undecided, no governing sentence.
- **FSP `Initialize`** (~5 days) · **`g-cli-emits-artifacts` tier** (ruled MED S354, measured HIGH S397).

### 6. RULED THIS SESSION — do not re-open
- **Q1 engine state-child: STRUCTURAL** (built, held per §3).
- **Q2 prod-404: fork (b), gated root fallback** (built, held per §1).
- **NO PERF GATE** — *"easy enough to just recompile and measure time dif on occasion."* Recorded on the
  gap entry so a sweep does not read an open question into it.
- **The `<each>` blindness is HIGH** — *"I would consider that a high bug."*
- **§13.2 auto-await is not a question** — bryan: *"I dont see a Q here."* Correct: no adopter can depend
  on the current behaviour because §19.9.8 forbids `await` in source, so every affected site is already
  broken. It is a plain conformance fix; I had escalated a process obligation into a question.

---

## 🔭 DURABLE
**The meta-pattern, twice in one day: the compiler computes a fact, does not record it, and N places
reconstruct it badly.** Morning — `engine-decl.bodyChildren` already carried the structure and PASS 11
fell back to a text re-scanner because nobody built the bridge; Phase A10/S78 delivered the fact and the
follow-through was never done. Afternoon — entry-ness, §1. **Look for this shape first.**

**Corollary, from the arc that stopped:** when a walker's reach widens, every predicate sharing that
traversal must be told. Three instances in one arc. The structural answer — one descent, per-consumer
predicates — is what the agent applied to detection and did not generalise.

## ⚑ MISSES (mine)
1. **★★★ I nearly rejected a correct SPEC citation** because I read the §47.9.2 heading ("Per-Artifact
   Output Path"), saw it was about paths, and stopped — the route-inference table is inside it. The
   agent was right; I was about to overrule it.
2. **★★ Two false-negative probes.** A grep for `__scrml_engine_[a-zA-Z]+_idle` that missed a
   hash-encoded name and read as agreement; an HTML-comment fixture for a defect that only reproduces
   with `/* */`. Both times my "did not reproduce" was the probe, not the code.
3. **★★ I over-escalated §13.2** into a question for bryan when the direction analysis dissolved it.
4. **★ I told an agent dev was precedent for prepending.** `dev.js:1020` says the opposite.
5. **★ I under-counted the gap ledger** (78/206 vs 85/211) with a grep requiring attribute order.

## Mechanical state
Landings, counts and the session stream: `docs/changelog.md` + `handOffs/delta-log.md`. Review floor
drained 2→0 and re-recorded. Three worktrees retained (§3). Inbox: flogence ×2 received and committed
(both arrived **untracked** — the per-clone hazard, twice in one day); peter's four remain bryan's.
