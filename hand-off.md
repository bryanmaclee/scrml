# scrml — Session 397 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-03/04. Booted `/boot` Profile A onto `c91969c7`. Ran alongside S398-peter (wrapped
mid-session, #831).

**The framing: eleven rulings, five arcs landed, and the session's real output is that the failures
were CLAIMS, not code.** Almost nothing was broken by bad logic. What went wrong, repeatedly, was
something asserting coverage it did not have — a comment, a §34 row, a conformance rationale, an
escape list, two tripwires, and four of my own statements to bryan.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### 1. ⚑⚑ THE `~` AXIOM IS RULED AND THE BUILD IS NOT WRITTEN

**`~` is ONE thing** — the value of the preceding unbound expression statement (§32.2). The array
accumulator role (§48.5.1 / §49.6.1) is retired as a distinct meaning.

⚑ **The ruling is a CONJUNCTION, not a deletion.** Per S276/S130 it adopted the full text, which said
*"make `~` one thing AND give every loop form the expression form `for…of` already has."* Landing
one-thing without the loop-expression extension **deletes §49.4.4's sole exception and takes `while`'s
only value-producing form with it.** That is capability loss and it is NOT authorized.

**What the build must carry:**
- **(1) RATIFIED** — extend the loop-expression form to `while` / `do…while` / C-style `for`. The
  blocker is the **parser**, not codegen: `const x = for (const n of xs) { lift n }` **already
  compiles at HEAD** (PA-verified). `while` lands as an escape-hatch ParseError, which is exactly what
  `E-LOOP-007` keys on — and `E-LOOP-007`'s own message already says *"or refactor to a `for/lift`
  expression."*
- **(2) FLAGGED, NOT CONFIRMED** — make a loop-expression legal as a value-form arm's lifted value.
  The answered text named it; the rec SENTENCE named only (1). **The PA reads the durable as carrying
  both and will build both; bryan may narrow to (1) at any time.** Recorded so a narrowing is a
  decision, not a silence.
- **⚑ AN OPEN QUESTION THE BUILD MUST ANSWER EXPLICITLY (PA-inferred, NOT measured):** under
  one-thing + loops-as-expressions, **§48.5.1's own example may survive UNCHANGED** — if
  `for (…) { lift item }` in statement position is an unbound expression statement whose value is the
  array, §32.2 makes `~` that array and `return ~` still works. The accumulator would be **DERIVED**
  from the single meaning rather than removed, and the two normative sections would stop contradicting
  without either being struck. **Not verified. Answer it first; it resizes the whole arc.**

**Full shape matrix** (18 shapes, every verdict compiled, exhaustive over 3,408 files → 33 read-shape
lines in 13 files, zero missed): `docs/changes/s397-tilde-one-or-two/progress.md`, tail section
`FINAL VERDICT + MATRIX`.

### 2. ⚑ Q9 IS STOPPED BY RULING, NOT BY FAILURE — and the successor's spec already exists

`E-ROUTE-004`'s untyped-invoked-param hole. Limb (a) stays ratified; **bryan ruled option 3: build the
uniform binder-enumeration capability FIRST, then (a) on top.**

**Branch RETAINED: `worktree-agent-a63f48a15ea0539dd` @ `2faffb80`, worktree retained.** Nothing lost.

**Why it stopped:** the PA set a stopping rule before round 3 — *if a round-4 review still finds a
false positive of this class, stop and take the mechanism back to bryan.* Round 4 found two HIGH false
positives (multi-payload match arm; §18.19 product arm), both PA-reproduced. **The rule fired and was
honored.** Four rounds, each closing the reported case, each followed by another instance.

**The real finding, and it outlives this arc: scrml's AST has no uniform binder representation.**
Bindings are stored at least four incompatible ways — structured `params`; a bare `variable` string;
**RAW PAREN TEXT** (`binding: "x, cb"`, pushed as ONE name, so `.includes("cb")` is false forever);
and **shape-specific keys nobody enumerated** (`productPatterns` — §18.19 product arms carry bindings
ONLY there with no `binding` key at all — plus `asName`/`asNames`, `payloadBindings`).

**The successor's spec is already written:** the 16-shape measured battery in
`compiler/tests/unit/route-wire-serializability.test.js` on that branch, plus the four unreported
conflations the round-3 agent's own audit found. Also banked: *an expression that degrades to raw text
has no `call` node to find* — one sentence covering block lambdas and C-style headers
(`escape-hatch`), template literals (`lit`), and foreign bodies (opaque string), replacing an escape
count that was wrong three times running (two → three → at least five).

⚑ **The adopter closure is unblocked by this and is a DIFFERENT gap.** Limb (a) never could have
caught peter's reported instance: `runGatedAgentic`'s body is one `_={ }=` foreign hatch, so there is
no call node. **The real fix for them is `g-library-mode-no-typed-payload-match`** — the gap their
untyped-signature idiom exists to dodge. Close it and the idiom disappears.

### 3. RULINGS OWED — bryan's

- **§32.6 narrow-vs-broad** — largely MOOTED and worth closing cheaply: the elision is **provably
  vacuous** (`tilde-init`/`tilde-ref` have four consumers and ZERO producers, so the predicate returns
  `false` unconditionally). SPEC's own verbatim INVALID examples at §32.5, §32.6 and §32.7 compiled at exit 0 **at `8e278c73`** — but ⚑ **#832's own fail-closed floor changed that MID-SESSION**: `${ process(~) }` now exits 1 with `E-CG-TILDE-UNRESOLVED` (PA-verified). **The zero-producers finding STANDS** — `E-TILDE-001/002` still never fire; what catches that shape now is the CODEGEN floor, not §32.5's type-system code.
- **Q2(b) and Q2(c)** — comprehension bodies and match arm bodies, deferred to the dPA's return; it
  returned. dpa-040's substructural pole argues limb (c) is **REJECTED on soundness**, not deferred.
- **Contract vs constraint** (idea 1's surviving half) — weighed, not ruled. PA lands on **targeted
  constraint at boundaries**; the **transitive-vs-direct footprint question is what actually decides
  it**, and the state↔logic axiom cuts against universal constraint.
- **Q4–Q8** — five ruling-gated adopter gaps, all peter's dog-food, **none re-derived by the PA**.
- **dpa-037 / 038 / 039** awaiting ratify-or-reject. ⚑ **039 is TIME-SENSITIVE and warns `dpa-030`
  must not be ratified on its premises.** 038 returned *"substantially duplicative of dpa-028."*
- **peter's prod-404 fork** (#831 inbox) — a single-file SPA named `app.scrml` 404s at `/` in
  production while dev serves it. ⚑ **This is the FUNCTIONAL half of the gap ruling 2b called
  "structurally safe."**
- **peter's engine-apostrophe report** — a `'` in an `<engine>` state-child body breaks the parse.
  The S196 fix un-generalized to a second locus. **Governing sentence exists (S109), so it is a
  conformance-restoration FIX, not a ruling** — PA should verify the sentence is in SPEC and dispatch.
- **`g-cli-emits-artifacts-on-failed-compile` severity** — ruled MED at S354(b); S397 measures HIGH.
  The filing agent recorded the disagreement rather than overriding a ruling. Yours.

### 4. Mechanical state — REFERENCED, not duplicated
Landings, counts and the session stream are in `docs/changelog.md` and the delta-log. Review floor
**0 OWED** at close (drained 4→0, self-recorded at rate zero). Maps refreshed at 6c. Worktrees: five
swept; **one retained** (§2). Inbox: **four items deliberately UNARCHIVED, all bryan's.**

---

## 🔭 DURABLE FINDINGS

### A. ⭐⭐ The failures were CLAIMS, not code — and the formulation is the keeper
From the agent that made the mistake three times inside one arc:
> **Filing a defect is not retracting the claim it falsifies — a reader reaches the comment, not the
> progress doc.**

It had *measured* each truth, written it into a DEFERRED list, and left the contradicting claim
standing in the comment and the §34 catalog row. Three false claims in the floor arc alone: *"the
build fails so the placeholder never ships"* (reproduced FALSE — exit 1 and the artifact still
ships), a conformance rationale claiming *"once per read"* against a code that fires once per
**emission**, and a span claim of exact attribution that resolved every error to `1:1`.

### B. ⭐⭐ Two tripwires had the exact defect they existed to catch
One asserted against a **hardcoded copy** of the constant it guards — the copy drifts, the guard stays
green, the classifier goes blind; the const was also dead code referenced only from a doc comment,
which is *how* it could drift. The other claimed novel-field-name detection from a **closed 15-name
alternation**, and scanned only `types/ast.ts` while the live AST is built in `ast-builder.js` — which
uses **ES6 shorthand**, so fields existing only in shorthand (`asName`, `asNames`, `payloadBindings`)
are structurally unreachable by its regex. Both were caught by *running* them, never by reading.

### C. ⭐⭐ `E-TILDE`'s producers exist only as unit-test fixtures
`tilde-init`/`tilde-ref` have four consumers and **zero producers** in `compiler/src/` or
`compiler/native-parser/`. The apparent producers are hand-built object literals in
`type-system.test.js` — **which is precisely why the pass has passing unit tests and never fires on
real source.** The hollow-gate mechanism, named exactly.

### D. ⭐ Base drift got more dangerous as main moved faster
Five catches. Early ones would have reverted a changelog block; **the worst would have silently
un-landed the entire fail-closed floor arc ten minutes after merging it** — 13 of 23 files in a delta
were a merged feature showing as reversions. Another would have deleted two of peter's inbox reports.
⚑ **A wholesale file-delta is only safe against a base you have re-fetched THIS minute.**

### E. ⭐ Gates caught what four agents and the PA did not
The pre-push generated-doc gate, twice — the second time because a fix round invalidated a regen that
had been run honestly two rounds earlier. Its own message names the trap: *"regenerate AFTER your last
content commit, not before it."*

---

## ⚑ MISSES (mine)

1. **★★★ I manufactured corroboration.** I told bryan the `~`/§32 surface has *"zero rows across all
   13 nav maps, confirmed independently by three dispatches."* `domain.map.md` has **17 hits**,
   identical count at both SHAs. The floor agent had explicitly said `domain.map.md` carried
   substantial `~` material and scoped its claim to the orphan fallback. **I flattened three SCOPED
   claims into one ABSOLUTE claim and attributed agreement to them that none of them expressed.**
2. **★★ I assembled a defect backlog against a moving base.** Findings measured at an S397
   *intermediate* SHA, filed against `origin/main`. **A1 was already fixed and A3 did not reproduce**
   — two of three would have entered a 900-marker ledger as open defects.
3. **★★ Two premise corrections I gave bryan were themselves wrong** — the floor's "one known site"
   (that file emits ZERO orphans; its bug is a different axis) and "the accumulator resolves
   correctly" (for the `while` case the whole block is deleted).
4. **★ I presented the loop-expression form as proposed. It ships** for `for…of`.
5. **★ I predicted shape 4 would break one-thing. Shape 7 did.**
6. **★ Commit timeouts twice** — 2-minute default, then 5, when the hook now exceeds both. Both times
   I checked git STATE not the exit code, and both times nothing had half-landed.

**The pattern, unchanged from S395 and sharper: my verification holds when I EXECUTE and fails when I
RELAY — including relaying my own earlier reading, and now including synthesizing agreement across
sources that did not agree.**
