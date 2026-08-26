# progress — db-locus-blockcomment-fp-2026-08-26

Append-only. Newest entry at the bottom.

---

## 2026-08-26 — startup + orientation

- Worktree verified: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7bfca34d955c033f`.
  `git rev-parse --show-toplevel` matches; tree clean at start.
- Base asserted: `HEAD` == `merge-base HEAD origin/main` == `origin/main` == `4895c004`. Confirmed
  the worktree is cut from `origin/main`, per the brief.
- `git fetch origin feat/s376-db-locus` → `FETCH_HEAD` = `481c3454` (matches the brief's stated tip).
  Checked out the four paths named in the brief.
- `bun install` (worktrees do not inherit `node_modules`), then `bun run pretest`.
  ⚠ **`bun --cwd <path> run pretest` DOES NOT RUN THE SCRIPT** — bun treats it as a bare `bun run`
  and prints the script LIST, exiting 0. It looked like a pass and was a no-op. Re-run plainly from
  the worktree CWD, which does work. Recording it because "exit 0" was actively misleading here —
  the same species as the S346 probe-that-reports-less-than-it-measured lesson.

## 2026-08-26 — maps

Read `.claude/maps/primary.map.md` and followed Task-Shape Routing. **Load-bearing, two rows:**

- **The "CODE THAT SHIPPED AS PAGE TEXT" row** is the class this diagnostic closes, and it names
  the exact corpus member (`samples/htmx-debate-dashboard.scrml:143`, an `on mount { loadDashboard() }`
  in a `<db>` body whose hook never runs). It also flags that this locus is *"its own OPEN RULING"* —
  useful confirmation that the S375 ruling being implemented is the answer to a named open item, not
  a freelance widening.
- **The "you are about to write a REGEX over source text in a stage that already has the AST" row**
  (invariant 55) is the one that could have vetoed the whole approach — and it does not, because it
  says in as many words: *"Binds NEW-OR-TOUCHED code only; **pre-AST stages (tokenizer,
  block-splitter) are out of scope**."* This pass consumes block-splitter output at Stage 2.5c,
  ahead of TAB. So text-level scanning is the correct mechanic here, exactly as the brief asserted,
  and I verified it against the map rather than taking it on the brief's word.

Also read, and NOT load-bearing: `structure.map.md` / `error.map.md` were routed to, but the target
module is NEW on the feature branch and appears in no map — every map claim about it would have been
vacuous. The four post-map landings the brief named (`592dccf7` `77411e00` `84582f51` `a545bbe7`) are
all in `codegen/emit-each.ts` + `component-expander.ts` and touch nothing on this path.

## 2026-08-26 — locus: HELD

Traced locus confirmed exactly as briefed, and confirmed BY EXECUTION rather than by reading:

`compiler/src/api.js` Stage 2.5c → `runEStateBlockStatementForm(bsResults)` → `walk()` →
`isStateBlock()` → `scanStateBlockChildren()`, which splits each direct **text** child on `\n` and
matches `STATE_BLOCK_ON_LIFECYCLE_RE` per line. Its only comment carve-out was
`if (!/^\s*\/\//.test(line))`.

Reproduced the defect with the brief's exact file: **exit 1**, one `E-STATE-BLOCK-STATEMENT-FORM`
pointed at line 7 — the block-comment CONTINUATION line. Legal source refused.

**Pre-fix sweep of the seven required cases** (exit codes read from the process, never grepped text):

| # | fixture | expected | pre-fix |
|---|---------|----------|---------|
| 1 | `on mount` bare in `<db>` | exit 1 | exit 1 ✅ |
| 2 | same in a `< db …>` whitespace opener | exit 1 | exit 1 ✅ |
| 3 | `on dismount` in `<db>` | exit 1 | exit 1 ✅ |
| 4 | the block-comment reproducer | exit 0 | **exit 1 ❌ THE DEFECT** |
| 5 | `// on mount { … }` | exit 0 | exit 0 ✅ |
| 6 | prose `we load on mount and dismount cleanly` | exit 0 | exit 0 ✅ |
| 7 | `on mount { … }` at a `<program>` body top | exit 0 | exit 0 ✅ |

Exactly one case wrong, and it is the reported one.

## 2026-08-26 — fix: a comment MASK, not a second pattern

`scanStateBlockChildren` now runs each line through `maskCommentRegions(line, state)` — a real state
machine carrying `inBlockComment` across lines — and then applies the ONE anchored lifecycle pattern
to the machine's OUTPUT. No second pattern was added; the old `^\s*//` carve-out is DELETED, since
masking subsumes it and is strictly more correct (a trailing `// …` no longer needs a special case).

Three design calls, recorded because each could have gone the other way:

1. **Mask to SPACES rather than skip the line.** Skipping cannot express the required
   close-then-statement case: a line whose comment terminates and is then followed by
   `on dismount { … }` MUST still fire. Masking leaves the statement in place for the `^`-anchored
   pattern to find. Spaces (not deletion) keep `masked.length === line.length`, so the span
   arithmetic stays byte-exact against the ORIGINAL line — verified: sub-shape C reports col 6, and
   col 6 is where `on dismount` actually starts in `  */ on dismount { cleanup() }`.
2. **String literals are deliberately NOT modelled.** A state-block body is MARKUP context, so its
   text children are PROSE, and prose is full of apostrophes (`don't`, `it's`). A string tracker over
   prose would open a "string" at every contraction and never close it — turning free text into an
   unbounded suppression region, a defect in the same family as the one being fixed. The residual is
   that an opener inside a string literal reads as a comment and SUPPRESSES. That is the safe
   direction for a REFUSE gate: a false negative restores the pre-lint status quo (silent page text),
   a false positive rejects a legal file — which is this very bug.
3. **Comment state is carried ACROSS the direct text children of one state block**, reset per state
   block. If the splitter parsed an element out of the middle of a commented-out run, the comment
   still suppresses what follows. Faithful to comment semantics AND the fail-open direction.

## 2026-08-26 — the four block-comment sub-shapes, BY EXECUTION

| sub-shape | source | expected | result |
|---|---|---|---|
| open on the SAME line as the match | `/* on mount { … }` then a terminator | exit 0 | exit 0 ✅ |
| open on an EARLIER line | the brief's reproducer | exit 0 | exit 0 ✅ |
| close on the same line as a LATER match | `*/ on dismount { cleanup() }` | **exit 1** | exit 1 ✅ (col 6) |
| opener inside a `//` line | `// see /* below` then `on mount { … }` | **exit 1** | exit 1 ✅ |
| nested-looking, single terminator closes | `/* outer /* inner */` then `on mount { … }` | **exit 1** | exit 1 ✅ |

## 2026-08-26 — the fail-OPEN item in `api.js` Stage 2.5c: MADE FAIL-CLOSED

**Decision: remove the `try`/`catch`.** The wire-in now runs bare through `stage()`, so a throw from
the scanner propagates instead of being logged-under-`--verbose` and dropped.

The reasoning, and why the sibling pattern is right for the siblings but wrong here:

- Stages 2.5 (`W-INTERP-IN-RAW-CONTENT`) and 2.5b (`W-INPUT-STATE-MARKUP-NONREACTIVE`) are
  **advisory**. A crashing advisory should not take down a compile that would otherwise succeed, so
  swallowing is the correct direction for them — the worst case is a lost hint. **Do not change
  them** (and the brief says so).
- 2.5c is an **error gate**. Invert the severity and the direction inverts with it. A swallowed
  throw here means a file that SHOULD be refused compiles at **exit 0**, with nothing anywhere in
  the output saying the gate never ran. That is not a lost hint — it is the exact silent-success
  mode this diagnostic was written to close, reintroduced one layer up.
- This is invariant 59's species verbatim: *a gate reporting PASS while measuring nothing.* A
  `--verbose`-only log is not a report; the default invocation is silent and green.
- **There is already precedent on the ERROR side and it agrees.** The two ERROR-severity lint stages
  in this pipeline — `LINT-TRY-CATCH` (3.007) and `REJECT-ASYNC-AWAIT` (3.008, which fires
  `E-ASYNC-NOT-IN-SCRML` at severity error) — both call `stage(name, fn)` with NO catch, and
  `stage()` itself does not catch (`api.js:1027`). So the codebase's own convention already splits
  on severity; 2.5c was following the wrong sibling.

Rejected alternatives, recorded so the next person does not re-litigate:

- **Catch and emit the throw under `E-STATE-BLOCK-STATEMENT-FORM`.** Rejected: the code would then
  mean two unrelated things ("you wrote a lifecycle statement" OR "the scanner broke"), which is the
  same catalog incoherence the module header already argues against for reusing
  `E-STATE-BLOCK-BARE-WRITE-DECL`. It would also make the corpus differential report the code as
  newly firing on a file that contains no such statement.
- **Allocate a new internal-error code.** Rejected: it needs a §34 row, and this dispatch is
  explicitly forbidden from touching `compiler/SPEC.md`. There is no general internal-error code to
  borrow — the only `E-INTERNAL-*` in the tree is `E-INTERNAL-RULE-NOT-COMPOSITE`, which is
  engine-rule-specific.

`collectErrors("BS-LINT", …)` is unchanged, so the `stage: BS-LINT` line in emitted diagnostics is
byte-identical. The new `stage("BS-LINT-STMT-FORM", …)` label is a `--verbose`/`--debug-perf` timing
label only.

## 2026-08-26 — isolated property check on the mask (22,408 cases)

The span arithmetic depends on `masked.length === line.length`, so that is checked directly rather
than inferred: exhaustive over every string of length <= 4 from the alphabet `/ * a SPACE TAB o n`,
each replayed as a 2-line document (so the cross-line carry is exercised too) against four
second-line shapes. **22,408 masks, 0 length drifts.** Plus 10 named cases with the expected mask
spelled out byte-for-byte, including the two carry directions — all 10 exact.

One of those named cases failed on the first run and **the test expectation was the thing that was
wrong**, not the code (I had written seven trailing spaces where the line needs eight). Recorded
because the failure mode of "assert against a hand-counted string" is to trust the assertion.

## 2026-08-26 — do the new tests actually BITE? (adversarial check)

Reverting ONLY `lint-e-state-block-statement-form.js` to the feature-branch version and re-running
the file: **20 pass / 4 fail.** So the honest accounting is:

- **4 of the 8 new tests fail against the unfixed code** — the reported defect, the
  terminator-then-match case, its span assertion, and the scoped-suppression case.
- **4 pass against the unfixed code too**, and they are kept deliberately as FORWARD locks: the
  same-line opener, the opener-inside-a-`//`-line, the non-nesting case, and the trailing-`//` case
  all pass on base *by accident* (the base pattern is `^`-anchored, so a line starting with an
  opener never matched it anyway) but are exactly what a lazier fix — "skip any line near an
  opener" — would break. They lock the new machine, not the old bug.

I am stating the 4/4 split rather than claiming "8 new regression tests" because the second four are
not evidence the bug existed.

## 2026-08-26 — DEFERRED: the sibling has the SAME defect, one severity down

`scanStateBlockBareWriteDecls` (`ast-builder.js:1923`) — the write-form sibling this module's header
cites as its detection-domain twin — has **no comment handling at all**, not even the `//` carve-out
this module used to have. **VERIFIED BY EXECUTION, not inferred from reading:**

```scrml
< db src="./x.db" tables="items">
  /* legacy:
@count = 0
  */
</>
```
→ `warning [W-STATE-BLOCK-BARE-WRITE-DECL]: bare `@count = ...` ... (line 4, col 1)`

Same false-positive class, same locus, on a commented-out line. Two differences that make it lower
priority: it is **severity warning** (non-fatal, exit 0 preserved), and its regex is `^(\s*)@`-
anchored so the `//` form (`  // @other = 1`) does NOT false-fire — only the block-comment form does.

**NOT FIXED HERE: `ast-builder.js` is on the brief's MUST-NOT-WRITE list** (two other ratified
rulings are sequenced onto that file). Filed for whoever lands next on it. The module header now
carries this so the sibling's silence is not misread as evidence the shape is fine, and so the
"detection domain is byte-identical" claim — which my change made false — is corrected in place.

## 2026-08-26 — fail-closed VERIFIED by execution, not by reading the diff

Removing a `catch` is easy to claim and easy to get wrong (a caller further out could still be
swallowing). So it was measured: an injected `String.prototype.repeat` failure — the only new call
`maskCommentRegions` makes on that path — was forced during a compile of a legal file.

- control (no injection): compiles, no `E-STATE-BLOCK-STATEMENT-FORM`. (It does draw an unrelated
  pre-existing `E-MARKUP-001` for a bare `<state>` opener, which the existing suite already lives
  with — the tests filter by code.)
- with the injected failure: **`THREW: INJECTED scanner failure`**, i.e. the compile cannot return a
  green result. Fail-CLOSED confirmed.

## 2026-08-26 — post-fix verification, all seven cases

| # | fixture | expected | pre-fix | post-fix |
|---|---------|----------|---------|----------|
| 1 | `on mount` bare in `<db>` | exit 1 | exit 1 | exit 1 ✅ |
| 2 | same in a `< db …>` whitespace opener | exit 1 | exit 1 | exit 1 ✅ |
| 3 | `on dismount` in `<db>` | exit 1 | exit 1 | exit 1 ✅ |
| 4 | the block-comment reproducer | exit 0 | **exit 1** | **exit 0 ✅ FIXED** |
| 5 | `// on mount { … }` | exit 0 | exit 0 | exit 0 ✅ |
| 6 | prose | exit 0 | exit 0 | exit 0 ✅ |
| 7 | `on mount { … }` at a `<program>` body top | exit 0 | exit 0 | exit 0 ✅ |

## 2026-08-26 — blast radius: 2,353 corpus sources, ZERO behaviour change beyond the bug

`scripts/corpus-emit-differential.ts` wants two checkouts, which this dispatch does not have. But
the only behavioural surface here is which lines this ONE code fires on, so the complete question is
answerable directly and more precisely: run the BASE module and the FIXED module against **the same
block-splitter output** for every corpus source and diff the fire sets. Any difference is then
attributable to the scan and to nothing else.

Recursive enumeration over `examples samples conformance stdlib benchmarks docs compiler`, count
asserted and printed (a truncated walk reads exactly like a complete one):

```
enumerated: 2353 .scrml sources
block-splitter refusals (skipped, both sides): 0
E-STATE-BLOCK-STATEMENT-FORM fires — base: 1, head: 1
files where the two modules DISAGREE: 0
  LIVE FIRE: samples/htmx-debate-dashboard.scrml 143:5
```

The single live fire is **exactly** the corpus member `primary.map.md` names as the reason this
diagnostic exists (*"`on mount { loadDashboard() }` inside a `<db>` state-block body ships as text
and the mount hook NEVER RUNS — `samples/htmx-debate-dashboard.scrml:143`"*), and the fix leaves it
firing at the same line and column. **The true positive is preserved and nothing else moved.**

## 2026-08-26 — full suite

Name-level comparison, not count-level (identical counts can hide a swap):

- **BEFORE** (base module restored, clean run): 30598 pass / 53 fail / 216 skip / 2 todo.
- **AFTER**: 30606 pass / 53 fail / 216 skip / 2 todo.
- `diff` of the sorted, timing-stripped `(fail)` names: **EMPTY.** Zero new failures, zero
  accidentally-fixed, no swap. The +8 is exactly the eight new tests.

The 53 are pre-existing on `origin/main` + the feature branch and are untouched by this dispatch.

## 2026-08-26 — status: complete (round 1)

Files touched (the brief's allowed set, nothing else):
- `compiler/src/lint-e-state-block-statement-form.js` — the state machine; header claim corrected.
- `compiler/src/api.js` — Stage 2.5c only, made fail-closed.
- `compiler/tests/unit/state-block-statement-form.test.js` — 8 added, 16 existing untouched.
- `docs/changes/db-locus-blockcomment-fp-2026-08-26/progress.md` — this file.

Not written, per the brief: `ast-builder.js`, `compiler/SPEC.md`, any other lint module,
`docs/FACTS.md`.

---

# FIX ROUND — S239 adversarial pass, three findings

Base: my own branch tip `b6846e76`. Same MUST-NOT-WRITE list. Every finding was re-reproduced here
by execution before being touched, per "reviews are claims, not results" — and that discipline paid,
because one reported symptom did not reproduce.

## FINDING 2 (MEDIUM) — `isStateBlock` defeated its own documented exclusion. REPRODUCED.

The markup arm was name-guarded; the `state` arm returned `true` unconditionally. So the module
header's `<engine>` / `<machine>` exclusion covered only ONE of the two ways a block arrives here.

Reproduced independently: `on mount { go() }` inside a `< Idle rule=.Active>` engine state-child drew
`E-STATE-BLOCK-STATEMENT-FORM` at severity **error**. At that locus the diagnostic's premise is
false — an engine state-child body is a code-default locus (§4.18.1) — and its remediation is wrong
advice.

**The scope is materially wider than the reporting fixture, and this is the part worth carrying
forward.** `type:"state"` is not a semantic classification; it is what BS calls ANY whitespace-form
`< Name …>` opener. Measured over the 2,353 corpus sources:

```
type:"state" nodes IN  {db,state,schema}: 44
type:"state" nodes OUT of the set       : 79
  engine x31 · Todo x6 · Submission x4 · Draft x4 · Validated x4 · profile x3
  counter x2 · item x2 · badge x2 · taskItem · siteHeader · siteFooter · sidebar
  statusBadge · addressCard · navItem · widget · userBadge · card · panel · p · div · …
```

So the unguarded arm claimed **79 nodes it was never scoped to** — engines, typestate transition
declarations (the very false-positive class the module header cites as MEASURED for the bare-call
gate), whitespace-form component definitions, and plain HTML. No corpus file fires only because none
of those 79 contains a line beginning `on mount {`. **Luck, not scoping.**

**The fix's load-bearing premise was verified rather than inherited.** If `type:"state"` nodes did
not carry `name`, name-guarding would silently switch the module off. Probed BS directly:

```
deprecated < db> : [{"name":"db","nameType":"string"}]
engine < Idle>   : [{"name":"Idle","nameType":"string"}]
engine <Idle>    : []        <- not a type:"state" node at all
```

That last row also explains why only the whitespace spelling ever false-fired: the canonical
`<Idle rule=…>` never reached this function.

## FINDING 1 (LOW) — the COLUMN was wrong. The LINE was NOT. Half did not reproduce.

Genuine half: `colStart` is an offset into the child's line, not a source column, and the two
coincide only from the child's SECOND line on. A text child can begin mid-line, so
`<db …>on mount { go() }</db>` reported column 1 for a statement at column 42 — `col` disagreeing
with the byte-exact `span.start` right beside it. Fixed: `li === 0 ? baseCol + colStart : colStart + 1`.

⚠ **The report said BOTH coordinates were wrong, citing `6:1` where the statement is at 5:42. That
does not reproduce, and no line correction was made.** This pass reported `5:1` — right line, wrong
column. The `6:1` in the output belongs to **`I-FN-PROMOTABLE`**, whose locus is `function go() { }`
on line 6; pairing each diagnostic with its own `-->` line shows it plainly:

```
lint  [I-FN-PROMOTABLE]          --> v10-sameline.scrml:6:1
error [E-STATE-BLOCK-STATEMENT-FORM] --> v10-sameline.scrml:5:42   (post-fix; 5:1 pre-fix)
```

Measured ground truth: BS records `{start:132, line:5, col:42}` on the text child, and byte 132 does
resolve to line 5 column 42 — so `span.line` is the line of `raw[0]`, which IS line 0 of the child,
and `baseLine + li` is already correct at `li === 0`. **A test now pins the line**, so nobody
re-reading the original report can "correct" it later.

## FINDING 3 (LOW) — the rotted citation, and the whole class of them

Confirmed: SPEC.md line 20072 is `E-CONST-AT-DEPRECATED`; the intended row is 20073.

**Chose to remove the class, not bump the number** — all four SPEC citations in this module now read
by §34 CODE NAME plus section list. Reasoning: a code name is stable under insertion, greppable in
one command, and fails loudly rather than silently if a row is renamed or struck; this repo has a
row-provenance gate for exactly this reason.

Bidirectional check rather than a spot-fix: the other three (19720 `E-WRITE-NOT-IN-LOGIC-CONTEXT`,
19721 `W-STATE-BLOCK-BARE-WRITE-DECL`, 1191 the S111 amendment) were re-verified and were all still
correct. **That is the argument for the change, not against it** — rot is silent and per-line, so
one correct spot-check proves nothing about the rest. A header note says not to reintroduce them.

## VERIFY — the full case table, exit codes read from the process

| case | exit | fires | note |
|---|---|---|---|
| 1 `on mount` bare `<db>` | 1 | 1 | |
| 2 deprecated `< db>` opener | 1 | 1 | **the guard did not blind it** |
| 3 `on dismount` | 1 | 1 | |
| 4 block comment | 0 | 0 | |
| 5 `//` comment | 0 | 0 | |
| 6 prose | 0 | 0 | |
| 7 legal `<program>` locus | 0 | 0 | |
| 8 engine state-child `< Idle>` | 1 | **0** | false fire GONE; exit 1 is `E-ENGINE-STATE-CHILD-MISSING`, unrelated and correct |
| 9 engine state-child `<Idle>` | 0 | 0 | |
| 10 same-line statement | 1 | 1 | now **5:42**, was 5:1 |

One row of this table was asserted wrong by me first (case 9 expected exit 1, copied from case 8) —
**the code was right and my expectation was wrong.** Second time this dispatch that a hand-written
expectation, not the implementation, was the defect.

Corpus differential, round-1 module vs round-2 over the same block-splitter output: **2,353 sources,
base 1 fire / head 1 fire, 0 files where they disagree.** The mis-scoping was real but latent — no
live corpus victim.

Tests **24 -> 30**. Honest accounting on the six: **4 fail against the round-1 module** (both
engine/component shapes, the same-line column, and the col-vs-`span.start` agreement check); **2 pass
on round-1** and are kept as locks — the deprecated-opener regression and the "do not over-correct
the line" pin.

## FIX ROUND — full suite

- **Original baseline** (pre-everything): 30598 pass / 53 fail / 216 skip / 2 todo.
- **After round 1**: 30606 pass / 53 fail / 216 skip / 2 todo.
- **After the fix round**: **30612 pass / 53 fail / 216 skip / 2 todo.**
- `diff` of the sorted, timing-stripped `(fail)` names, ORIGINAL baseline vs now: **EMPTY.**

+14 across both rounds is exactly the 8 + 6 tests added. The 53 pre-existing failures are byte-
identical in name to the baseline — no new failures, none accidentally fixed, no swap.

## FIX ROUND — status: COMPLETE

Files touched in this round (still inside the brief's allowed set):
- `compiler/src/lint-e-state-block-statement-form.js` — `isStateBlock` name guard on both arms;
  `li === 0` column correction; all four SPEC citations converted to §34 code-name form.
- `compiler/tests/unit/state-block-statement-form.test.js` — 6 added (24 -> 30).
- `docs/changes/db-locus-blockcomment-fp-2026-08-26/progress.md` — this file.

`compiler/src/api.js` was NOT re-touched this round; `compiler/SPEC.md`, `ast-builder.js` and
`docs/FACTS.md` remain unwritten, per both briefs.

**Still DEFERRED (unchanged from round 1):** `scanStateBlockBareWriteDecls`
(`ast-builder.js:1923`) has no comment handling and false-fires
`W-STATE-BLOCK-BARE-WRITE-DECL` on a commented-out `@count = 0`. Verified by execution; out of
write scope both rounds.

**NEW, surfaced not fixed:** the whitespace-form `< Idle rule=.Active>` engine state-child is not
recognised as a state-child by the engine machinery at all — fixture 8 draws
`E-ENGINE-STATE-CHILD-MISSING` for `.Idle` even though a `< Idle>` block is present, while the
canonical `<Idle rule=.Active>` compiles clean. That is a separate pre-existing question about the
deprecated opener's reach into §51, entirely outside this change; noting it because this dispatch
is what surfaced it.
