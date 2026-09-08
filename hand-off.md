# scrml — Session 408 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** The S405 content below is bryan's, and he was **LIVE at S407**
> throughout this session. The S401→S400 precedent is a wholesale `hand-off.md` rewrite eating a
> collaborator's pickup section, so this section is prepended and nothing below it is touched.
> Full S408 state: `../scrml-support/handOffs/active-sessions/S408-peter.md`.

**Date:** 2026-09-07/08. Booted `/boot` Profile A onto `6bd29d3d`. **Seven arcs landed, all
gate-green** — #890 · flogence#6 · #891 · #893 · #894 · #897 · #898. Mechanical detail lives in
`docs/changelog.md` and delta-log `[2925]`–`[2928]`; this carries only what those cannot.

## ⏭ NEXT-SESSION PICKUP

1. **The `!{}` guarded-expr lowering in library mode.** The sole residual of the class battery
   (13/14). It is now **loud** — #893 makes it fall back to raw rather than emit `let v = !{n};`,
   which is legal JS that is always `false` — but it is still unlowered. The obvious next in-lane target.
2. **The owed reproducer for `E-CG-SQL-FN-UNVERIFIABLE-SPAN`** (#898). The guard is provably inert
   (118/118 byte-identical) and therefore **UNEXERCISED** — its error path has never fired. A
   bad-span SQL fn cannot be built as a library file today, because a `<db src>` is markup and that
   makes the file non-`pure-module`. Two tests were attempted and dropped rather than shipped as guesswork.
3. **The eight native-parser mirror consts** can now be deleted — #897 names the collision precisely.
   That half is a source edit under `compiler/native-parser/`, a different owner's surface, so it is
   named rather than done.
4. **Dog-food an adopter app** — historically where fresh silent-wrong bugs come from, as opposed to
   mining the ledger.

## 🔭 DURABLE

**An instrument that reports zero is reporting on its own reach, not on the code.** Seven probes were
wrong before they were right this session, every one in that shape: a corpus differential blind to a
construct its population lacks (it scored three regressions clean); a `RESTORED = 0` that measured the
corpus's composition rather than the fix (the battery said 3/14 → 13/14); a text scan that could not
tell a module-level `const` from a fn-local one (it would have hard-errored 11 working builds); a
false-positive test that blamed an imported module's error on the input file, because `res.errors` is
unit-wide; a forced `mode:"library"` that returned 2937 library files out of 2574 scanned against a
true 118; and an API `compileScrml({write:false})` probe standing in for what actually ships, when the
CLI emit gate refuses the artifact loudly. **Ask what a zero measured before reading it as coverage.**

**A filed fix-direction is a hypothesis with a citation — including one you filed yourself an hour
ago.** Three needed re-deriving this session. The sharpest, `g-library-fn-decl-span-unverified-splice`,
said "lift the guard to all three splicers (cheap)"; doing that literally would have turned a
confidentiality boundary **fail-open**, because the SQL splicer prunes server-only `?{}` fns *out of*
the client-facing artifact.

**Contended-file collision is real, and the fixer is sanctioned.** bryan and I both appended
`[2915]`–`[2918]` to the delta-log and both appended to `docs/pr-reviews.md`; the pull conflicted.
Resolved by **union** (both files are append-only) plus `bun scripts/delta-lint.ts --fix`, which
renumbered **my** side — the correct side, since his were already pushed and checkpointed.

## ⚑ MISS (mine, this wrap)

**I truncated `hand-off.md` to 0 bytes.** A Python `open(path, "w")` truncates *before* the write, and
my write threw on a lone-surrogate escape (`🔭` for 🔭). Caught immediately by reading the
file back, restored with `git checkout --`, nothing lost — but only because the file was committed.
**A generate-then-overwrite script must build the full string before it opens the target for writing,
or write to a temp file and move it.** Three separate heredoc backslash-mangling failures earlier in
the same session pushed me toward Python for file edits; this is that choice's own failure mode.

---

# scrml — Session 405 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-07/08. Booted `/boot` Profile A onto `4d057a58`. **Successor to a LIVE S403-peter;
S406/S408-peter ran concurrently all session; bryan opened a THIRD session on the other machine.**
Mechanical state — landings, counts, the session stream — is in `docs/changelog.md` and
`handOffs/delta-log.md`. This file carries only what those cannot.

**The framing: a "free move" that took four rounds, two security arcs that took six and three, and
ONE failure mode wearing seven costumes.** Every substantive thing today was caught by an instrument
rather than by reading — and several caught *me*.

---

## ⚑⚑ THE DURABLE FINDING — unratified, and the reason to read this file

> **An enumeration's method being sound says nothing about its AXIS being complete.**

Seven instances today, each rigorous in method and wrong in axis:

| # | the enumeration | the missing axis |
|---|---|---|
| 1 | four delimiter tokens, probed exhaustively | the helper recognized a **fifth** (`/*`) |
| 2 | tokens × locations, all 20 cells run | the axis was **scan sites** (4 opener-blind loops) |
| 3 | **three independent proofs** of a sink population, all agreeing | all three enumerated the **mechanism**; the obligation is over the **data** |
| 4 | function-level analysis of in-class loops | the unit is the **loop** — 3 of 4 sit inside functions that also hold a *safe* loop |
| 5 | one normative grammar (`_` + `=`\* + `{`) | **five hand-spellings** at three levels of completeness |
| 6 | my own two-shape sibling probe | two probes are **members, not a population** |
| 7 | a test matrix built to stop uncrossed cells | **had an uncrossed cell of its own** |

⚑ **Arc A's version is the sharpest and belongs in `pa-base` if it goes anywhere:**

> *"All three enumerated over the MECHANISM; the obligation is over the DATA. A sink that never
> adopted the mechanism is outside all three frames at once, **so their agreement was one blind spot
> counted three times.**"*

**Three independent proofs agreeing is worth nothing if all three share an axis.** That is not the
same claim as "verify your findings", and no existing rule in the contract says it.

---

## ⏭ NEXT-SESSION PICKUP

### 1. Owed to bryan — the advisory queue, 6 items
**dpa-037** (NaN — he explicitly declined: *"ok hold on I am not ratifying NaN! TBC"*) ·
**dpa-040/041/042** (the `~` cluster — ONE root: `E-TILDE-001/002` have zero producers and have never
fired; rule as one item, and 042's Call 4 is the only genuine fork) · **dpa-043** (axiom, ladder row 7,
non-delegable; its Call 5 is a unanimous floor that costs nothing: *adjudicate `lift` vs `yield` in
writing in the SPEC whatever you rule*) · **dpa-045** (round 2 fired, verdict pending).

### 2. The deferred migrate/differ arc
`docs/changes/migrate-consumer-raw-ddl-2026-09-08/SCOPE.md` + gap
`g-migrate-consumer-not-raw-ddl-aware`. ⚑ **Its four findings are PRE-SPLIT measurements and do NOT
reproduce on main** — `diffSchema` is 902 code lines identical to `origin/main`, verified. Do not
open the arc by trying to reproduce them.

### 3. Two opener detectors nobody owns
`type-system.ts:473` (levels 0+1) and `lint-w-interp-in-raw-content.js:51` (level-0 **for every
sigil**) — the two survivors of `g-foreign-opener-grammar-hand-spelled-five-places` (~~HIGH~~ **MED**
— ⚑ corrected S410-peter: the same PR that wrote this line downgraded the gap to `sev=MED` in
`docs/known-gaps.md` on stated ground; the hand-off half was not updated). Both were
outside either arc's file boundary.

### 4. Carried, unchanged
The `${`-in-a-top-level-template ROOT (HIGH, ruling-gated — ⚑ **and dpa-045 round 1 measured it as
Class C, NOT closed by the camp ruling; do NOT defer it on dpa-045**) · the worktree sweep (**96
agent branches, 119 worktrees**) · `types-gate` RED on main with 12 pre-existing diagnostics ·
thread-board reports **1 ERROR**, uninvestigated.

---

## 🔭 DURABLE — what the session actually established

**A "free move" is a claim, not a category.** The apostrophe fix was scoped from a deliberation as
*"~35 LOC, the exact S196 delta, cannot break the corpus, already licensed."* It took **four rounds
and surfaced five HIGHs**, every one silent behaviour loss at exit 0. The deletion was right; the
*free* was wrong. ⚑ **The root nobody had: the string branches were doing DOUBLE DUTY** — also
shielding four opener-blind flat scanners from reading attribute interiors. That is why five prior
rounds by another session could not land it either: any fix addressing only the lexing half was
always going to break something else.

**A fix with no done-condition loses every scheduling contest it enters** (bryan-ratified, dpa-039
call 2) — and it recurred *twice more* the same day at a lower level. Arc A: *"the crossings are
GENERATED by the mismatch, so there is an unbounded supply."* Arc B: two of its own fixes cancelled,
closed by **deleting one side of the seam** rather than patching both. **Prefer removing a coupling
over patching a crossing** is the operational form.

**A green suite is not evidence.** Arc A's dedup test read `1` with *and* without the fix and was
caught only by disabling the fix to prove the bite. Arc B's narrow tenant suite passed after a
destructive edit had deleted `actualMap` — because it no longer imported the file. Arc B's own new
matrix asserted `cols[last]` and so stayed green on a bug that dropped `cols[0]`.

**Corpus-zero concealed three live defects today** — no corpus app pairs a predicated param with a
protect-free `<db>`; none pairs `protect=` with a mount-hydrate path; and odd-apostrophe prose *does
not compile*, **so the corpus is BY CONSTRUCTION free of the cases that prove the heuristic bites.**
That last one is dpa-045's own Call: **§4.18.2's frequency rationale is unmeasurable in principle on
a green corpus**, which cuts against the model it is the foundation of.

**Ratification is not verification.** dpa-028 was RATIFIED at S347 naming `chunks.json` as the
precache source; it advertises 3 chunk URLs and writes 1, so the ratified recipe makes `install`
fail and the cold boot fail completely. Caught only because the return leg was reproduced before
being posted.

---

## ⚑ MISSES (mine)

1. **★★★ A governing-sentence gate failure.** The free-move brief cited `SPEC.md:1090`'s second half
   as its licence. **The FIRST half of that same sentence says the opposite** — engine state-child
   bodies ARE code-default. The agent caught it and found a stronger §4.18.3 licence. **Quoting half
   a sentence whose other half contradicts you is exactly what the gate exists to make checkable.**
2. **★★★ An under-specified instruction opened a security hole.** I told arc A *"preserve non-plain
   values"* inside a fail-closed redactor without saying on which axis. It generalized *don't
   rebuild* into *don't look*, and a tagged row inside any class instance leaked. **A preservation
   instruction inside a security floor must state its axis.** The agent took more of the blame than
   I assigned and was right to: an ambiguous instruction at a security boundary is a signal to
   resolve it, not to pick a reading.
3. **★★ I partitioned the arcs by FILE and the defect spanned the partition.** The `_{}` opener bug
   sits in both `protect-egress` and `tenant-egress`, so **neither branch alone closed the class.**
   The ingestion-disjoint invariant protects against *interference*, not against a defect whose
   extent crosses the partition — and nothing in the contract catches that.
4. **★★ I repeated an inherited count.** The S404 hand-off said 15 advisory dPA items; it is **8**
   (dpa-030…036 were ratified between S347 and S365). I put 15 in the boot report before checking.
5. **★ Three delta-log sequence collisions**, one of them after I printed the tail and appended from
   a stale number anyway. The third came from a **rebase**, which is a new mechanism: the sequence is
   not rebase-safe and `--fix` is explicitly blind to which side was published.
6. **★ I mangled the dPA queue row twice** — wrote the status into the *id* cell (the item vanished
   from the probe), then displaced verdict text into col 3 whose *"NOT RATIFIED"* matches
   `classify()`'s `/\bRATIFIED\b/i`. Both caught by the probe's own count moving.

## Gate at close
Cloud `gate` **GREEN** on every PR this session. `tracking` RED — pre-existing dev-watcher class.
Gaps **HIGH 99 · MED 226 · LOW 90 · Nominal 7** *(at this PR's landing)*. Review floor **4 OWED**.
⚑ **Corrected S410-peter.** This line shipped `HIGH 101 · MED 224` while the *same PR's* second commit
set the `@generated:gap-counts` block in `docs/known-gaps.md` to `99 / 226`; `bun scripts/state.ts
--check` confirms 99/226/90/7 was the correct regen, so the hand-off was the wrong half. The
"(all peter's lane)" qualifier is also struck: of the four then-owed PRs, **#884 and #901 are
bryan-authored**. **Current at S410: HIGH 100 · MED 227 · LOW 90 · Nominal 7** (+1/+1 from the two
gaps this session filed and routed to bryan), and the review floor reads **0 OWED** — all four
drained. Read `docs/known-gaps.md`'s generated block, never this line, for live counts.
**Both adopter Direction issues CLOSED** — #509 after 23 days, #471 after 30.

⚑ **This wrap's PR is titled `wrap(s405):` deliberately, not left to `--fill`** — the branch form
produces a merge subject the recent-sessions matcher cannot see. Do the same next wrap.
