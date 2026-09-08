# scrml — Session 410 (peter · Windows) — WRAP

> ⚑ **ADDITIVE, NOT A REWRITE.** Everything below the `---` is prior sessions' (S408 mine, S405
> bryan's) and is untouched except two factual corrections inside S405 that are marked in place.
> **S409-bryan was LIVE throughout** this session (his lane: the `SPEC-INDEX.md` conflict class +
> CI-gate hardening, #905/#906/#907) — disjoint by construction, no collision.
> Full mechanical detail: `docs/changelog.md` S410 block and delta-log `[2929]`–`[2944]`.

## ⏭ NEXT-SESSION PICKUP

1. ⚑⚑⚑ **THE S406 82 GB LOCKUP HAS A NAMED CANDIDATE — AND PETER RULED THIS THE OPENER.**
   Verbatim: *"let's take care of it first thing next session."*
   `g-self-host-tab-test-is-an-unbounded-memory-runaway` (**HIGH**).
   **`bun test compiler/tests/self-host/tab.test.js` grows ~720 MB/s with no plateau** — the sentinel
   logged `commit 6.532 GB` then `KILL … holds 8.69 GB` **three seconds later**. At that rate it
   reaches 82 GB in ~2 minutes on a 32 GB box.
   ⚑ **RUN IT GUARDED** — unguarded it consumes the machine:
   `powershell -File C:\Users\pjoli\bun-guard\run-capped.ps1 -CapGB 6 bun test compiler/tests/self-host/tab.test.js`
   ⚑ **The 127-exit / 28-byte signature is `BunMemorySentinel` killing it**, not a bun crash.
   **Method is prescribed and it matters: bisect INSIDE the 526-line `tab.test.js`, halving under the
   cap until the allocating construct is named. Do NOT start from a hypothesis** — the three obvious
   candidates are already eliminated by measurement: the `tab.scrml` library compile (0.37 s, ~0 GB),
   importing the emitted `tab.js` (0.01 s, ~0 GB), and the sibling `ast`/`bpp`/`bs` files (all clean).
   It dies **before the first test result prints**, so it is in collection or `beforeAll`.
   Not bun and not Windows on the evidence; pre-existing, not introduced by S410.
   ⚑ **Read §CI ARCHITECTURE at the foot of this section before starting — it is the SAME problem.**
   `compiler/tests/self-host/` is run by **neither** CI job, by deliberate documented exclusion, so
   this runaway rotted *because nothing was looking*. Peter ruled the CI findings banked to ride with
   this: root-cause the runaway first, then close the two gating gaps recorded there.

2. **Review floor reads 7 OWED** (#909–#915) — the floor's own recursion, all this session's. Per the
   established pattern (see the #890 marker) a drain PR's review **rides the NEXT landing**, otherwise
   the floor regresses forever one PR at a time. Discharge these next session.

3. **The triage shortlist is banked — do NOT re-triage.** Top remaining pick:
   `g-semdiff-chunk-namespace-token-discovery-misses-every-non-engine-html-site` (MED, **fully inert**,
   instrument-only). `semdiff.ts:686-694` discovers the chunk-hash token from only 3 structural sites;
   four namespaced emission sites are missed — `emit-each.ts:581`, `emit-match.ts:1157`,
   `emit-html.ts:3957` (entry says 3906 — **stale**), `emit-logic.ts:4157`. Done-condition: an
   each-only / match-only / meta-only HTML artifact compiled at two paths canonicalizes byte-identical.
   ⚑ A **rejection table** for ~14 other candidates is in the S410 delta/PRs — each killed on a quoted
   entry-body blocker. That analysis is done; don't repeat it.

4. **Two HIGHs routed to bryan, both with reproducers, neither mine to fix:**
   `g-composed-route-drops-the-attr-tpl-effect` (a shell's reactive nav `href` ships dead into every
   composed route; the control is that the *same build* wires it correctly in the shell's own
   document) and `g-tenant-floor-inert-for-a-two-qualifier-create-table` (§14.8.10 silently inert for
   `db.schema.table`; a second table suppresses even `W-SCHEMA-NO-TABLES-DECLARED`). Also
   `g-7-5-2-no-row-for-annotated-plus-inference-defeated` (MED, spec-level).

5. **Deliberately left open, do not "tidy":** `g-recent-sessions-index-drops-named-session-wraps` —
   all four matching defects are FIXED, but the entry reserves the *mechanism* question for bryan (a
   session anchor could be a structured trailer instead of a regex over prose, S338 Rule 7). Closing it
   would erase a reserved ruling. Same for the `self-host-smoke` 12 vacuous guards: the recommendation
   is `skip` not `return`, but it is test policy on a known cross-OS baseline and should ride whoever
   unblocks `g-module-resolver-stdlib-root-uses-windows-fragile-url-pathname`.

## WHAT LANDED

**Seven PRs, every one gate-green** — #909 #910 #911 #912 #913 #914 #915 — plus **`flogence#6`
merged** (it had been recorded as landed in four places while sitting OPEN with no gate ever run).
Board moved **HIGH 99→102 · MED 226→227 · LOW 90→86**. Review floor drained **4→0**, then re-incurred
its own 7. Full detail in the changelog block; counts are generated, read them there.

## 🔭 DURABLE

**Every broken instrument this session failed toward GREEN. Six of them, and not one ever read as
worse than reality.** A gate printing `FAIL` while the shell said exit 0 (`tail`'s code, not the
gate's) · a PowerShell parse check passing **vacuously** over 21 real errors · a probe inflating a
defect **27%** because `[0-9]+` backtracks and eats its own digit · a "fix" improving the headline
3 fails → 1 **by breaking the module under test** · a test file printing **35 pass / 0 assertions** ·
12 parity checks silently no-oping on a null module. **If an instrument in this repo is wrong, the
prior should be that it is flattering you.**

**A precondition guard OWES a precondition assertion.** Now demonstrated three times in-tree. Without
it a harness disables itself and the only trace is the `expect()` count — a number nobody reads and no
gate checks. `browser-todomvc` had it right and was the model copied.

**The marker is an INDEX, not the record — read the entry BODY before writing code against it.** The
ledger caught the "obvious" fix **twice**: the session-index widening S404 had already warned would
still drop every PR-flow wrap, and the `module-resolver` `fileURLToPath` swap S341 had already tried
and reverted. Both times I had read the marker line and the `locus=`, measured the defect, and started
implementing. That is the governing-sentence failure in a different costume.

**Write the pin BEFORE the fix.** The `E-EQ-002` arc landed only because the test failed with a message
that was neither the old text nor the new one — exposing a **second emit site** whose advice was
semantically *inverted*. A fix written straight from the entry would have edited a site that never
fires for that input and "verified" it against a test that was never wrong.

**A green aggregate hides an isolated runaway.** S406 measured the whole tier at 2.433 GB and cleared
it; the runaway lives in one file that the tier-level number never surfaced.

## ⚑ MISSES (mine)

1. **★★★ I recorded `flogence#6` as "landed, all gate-green" in four places while it was OPEN with an
   empty `statusCheckRollup`.** A cross-repo PR's state was assumed from having *pushed* it rather than
   read back. Merged and corrected this session — and the correction was written **before** landing the
   PR that reported it, so my own fix would not ship a stale present-tense claim.
2. **★★ Twice I started implementing from a marker without reading the entry body** (above). Cost:
   one reverted `module-resolver` change and one nearly-wrong session-index fix.
3. **★★ I mis-sized my own guard within hours of writing it.** `bun-guard/README.md` and its memory
   both said `-CapGB 4`; the suite exceeds 4 GB here and was killed with `MemoryExhaustion`. Both
   corrected to 8 GB. The guard behaved exactly as designed; the number was mine and it was stale.
4. **★★ I misattributed a sentinel kill to a stale test baseline.** `exit=127` on the self-host tier
   was the sentinel killing a runaway — hours after I installed the very log that said so. I called it
   "pre-existing, not mine" (true) and stopped (wrong).
5. **★ I nearly filed two HIGHs that §7.5.1 explicitly sanctions** — `int` is *deliberately* outside
   the checked set. Killed on the governing SPEC text, but only because I read the whole section.

## Gate at close

Cloud `gate` **GREEN** on all seven PRs; `windows` green; `tracking` RED — pre-existing, verified red
on all four recent main runs. Local: `state.ts --check` 0 · `facts.ts --check` 0 · `delta-lint` PASS
max `[2944]`. `compiler/tests/lsp/workspace-l2.test.js` fails 5 (**pre-existing** — verified identical
against main's `emit-expr.ts`), `giti-016` is a **timeout flake** (runtime swings 1.02–7.67 s on
*identical* code, both sides), and the self-host tier is item 1 above.

⚑⚑ **CORRECTED POST-WRAP — this section originally read "No clean local full-suite pass was obtained,
and that is stated rather than papered over." That framing was WRONG, and it was mine.** There is no
"full-suite pass" target in this project — deliberately, since **S253**. `ci.yml:29` records that the
old CI ran `bun test compiler/tests/` (everything), went permanently red on known backlog, and was
split. `bun test compiler/tests/` is therefore a **SUPERSET of what the project gates**, and running
it locally is not a check the project makes. **I measured against a target that does not exist and
reported the mismatch as a shortfall.** See §CI ARCHITECTURE below — the real gaps are different and
sharper.

**Worktrees NOT swept — none are this session's.** Four remain (`agent-a0742fe4795045e91`,
`agent-a4e6b5f2562ae9eaa`, `onmount-c`, plus `scrml-pinned`); their work has not landed, so per the
wrap discipline they are retained and surfaced rather than removed.

## CI ARCHITECTURE — banked post-wrap, rides with the runaway next session

**Peter asked how to ensure a clean full-suite pass. The honest answer is that the project already
solved most of this, and the remaining gaps are not the ones I had been reporting.**

**The architecture that exists** (`ci.yml`), and it is a good one:

| job | contents | status |
|---|---|---|
| **`gate`** (BLOCKING) | unit + conformance · root-level parser/native · browser **name-set** gate · snippet · compile-floor · facts · SPEC-INDEX · delta-log · §34.0 | **green, and stays green** |
| **`tracking`** (non-blocking) | types gate · **integration + lsp + commands** — labelled *"promotion candidates"* | **known-red** |

`compiler/tests/self-host/` is in **NEITHER**, excluded on purpose (`ci.yml:23-27`): it needs a
locally-built, gitignored dist that **cannot be rebuilt on a clean checkout**, because the self-host
`.scrml` sources don't compile against the current compiler (`null` / `!==` / `try` — post-v1.0 work).

⚑⚑ **THAT IS WHY THE RUNAWAY ROTTED.** `tab.test.js` lives in the one tier nothing executes. It did
not survive *despite* the gate — it survived **because nothing was looking.** Pickup item 1 and this
section are one problem, not two.

**The mechanism is already proven here FOUR times** — `corpus-compile-floor.baseline.json` ·
`scripts/browser-baseline.ts --check` · `compiler/tests/TYPES-BASELINE.json` · plus the
facts / SPEC-INDEX / delta-log invariant gates. All **bidirectional**: fail on a NEW break *and* on a
stale entry. The browser gate's own comment states the principle, and it is the load-bearing one:

> *a permanently-red step is "useless in both directions at once" — a real regression is invisible
> (red either way), and a failed step HALTS the job, so every step after it was skipped… verified,
> not assumed.*

**GAP 1 — `tracking` still has the exact disease the browser tier was cured of.** It is red *as a
whole job*, so a genuine new regression in integration / lsp / commands is invisible — the same
argument one level up. `workspace-l2`'s 5 failures sit there indefinitely because nothing
distinguishes them from a new break. **Fix: a name-set baseline per tracking tier**, so it exits 0
while the failure set is unchanged and 1 the moment a name joins or leaves. That is what makes
promotion to `gate` possible at all.

**GAP 2 — no baseline asserts that tests actually ASSERTED.** All four check names, counts or exit
codes. `browser-reactive-arrays` would have passed every one of them while executing **zero**
assertions. An `expect() calls` floor per tier is the cheap addition, and it is the only number that
caught this session's vacuous passes (45→15 on self-host-smoke, 35→0 on reactive-arrays).

**Sequence (ruled by peter — bank now, execute next session with the runaway):**
1. Root-cause the `tab.test.js` runaway — a tier that kills the machine cannot be gated regardless.
2. Name-set baselines for `tracking`'s tiers → they begin carrying information; promote each to
   `gate` as it goes reproducibly green.
3. Assertion-count floor alongside each baseline.
4. Decide `self-host/`'s status EXPLICITLY — gated, or **quarantined with a gate asserting it is
   still quarantined**. Right now it is neither, which is precisely how this happened.

⚑ **Lane check owed before starting 2-4:** `ci.yml` is bryan's active surface (#907 is gate
hardening). Coordinate or route rather than editing it under him.

**Machine state:** the S406 bun guards are rebuilt on this clone at `C:\Users\pjoli\bun-guard`
(`run-capped.ps1` kernel Job-Object cap · `bun-sentinel.ps1` · `README.md`), both **bite-tested**, and
`BunMemorySentinel` is a live logon task. It earned its keep the same day — see pickup item 1.

---

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
