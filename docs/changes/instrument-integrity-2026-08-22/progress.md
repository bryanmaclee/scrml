# progress — instrument-integrity-2026-08-22

Branch `instrument-integrity`, cut from `origin/main` = `a0e30329`.

> **The bar this dispatch is held to is its own thesis.** A check that cannot fail
> is worse than no check, because it is read as evidence. So every claim below is
> an EXECUTED result with an exit code, not a reading of the source.

---

## SETUP — recorded baselines

| gate | baseline | exit |
|---|---|---|
| `bun conformance/run.ts` | 883/883 cases pass | 0 |
| `bun scripts/s34-census.ts` | 809 rows · STRUCK 34 · PINNED 343 · IMPL-SITES 320 · DECLARED-AHEAD 14 · RUNTIME-SURFACED 3 · FALSE-CLAIM 95 | 0 |
| `bun scripts/s34-census.ts --check-new --base origin/main` | `no new/changed §34 rows vs origin/main — PASS` | 0 |

`bun install` + `bun run pretest` both run (a fresh worktree carries no
gitignored `samples/compilation-tests/dist/`, which is the ENV-GAP the brief
warns about).

---

## BRIEF CORRECTIONS — two premises did not survive execution

Recorded first because both changed what got built.

### C1. `E-NESTED-PROGRAM-CONTEXT-NOMINAL` does not exist on `main`

The brief instructs: add `codeCounts` to the two capability cases *"asserting
`E-NESTED-PROGRAM-CONTEXT-NOMINAL: 1`, which is the assertion that would have
caught the double-fire."* Executed:

```
$ grep -rn "E-NESTED-PROGRAM-CONTEXT-NOMINAL" . --exclude-dir=node_modules --exclude-dir=.git
docs/changes/instrument-integrity-2026-08-22/BRIEF.md:34:   <- my own archived brief, and nothing else
```

The code exists only on `origin/nested-program-r4-work`, which is NOT an ancestor
of `origin/main`. Compiled both cases and counted the real emission:

```
$ bun <probe> conformance/cases/capability/inheritance-inherit-covers
{ "E-FOREIGN-SIDECAR-NOMINAL": 1, "W-PROGRAM-SPA-INFERRED": 1 }

$ bun <probe> conformance/cases/capability/inheritance-closest-wins-no-union
{ "E-FOREIGN-SIDECAR-NOMINAL": 1, "W-PROGRAM-SPA-INFERRED": 1, "W-FOREIGN-UNDECLARED-CAPABILITY": 1 }
```

Asserting `E-NESTED-PROGRAM-CONTEXT-NOMINAL: 1` as written would have made both
ratified cases fail on the spot, for a code that has no emitter.

**Where the premise came from, and what the invariant actually is.** The origin is
`f1424aff:docs/changes/nested-program-artifact-emission-2026-08-19/progress.md`
(round-4 record, on the r4 branch). Round 2, RESIDUAL 2:

> I did NOT route it to `E-NESTED-PROGRAM-CONTEXT-NOMINAL` because that would
> **double-fire in the two ratified capability conformance cases.**

So it was never a regression that shipped. It is a routing that was *declined*
because it would double-fire — and nothing in the corpus would have caught it if
someone had routed it anyway. The invariant, from round 4 item 7:

> **ONE DIAGNOSTIC PER UNBUILT DECLARATION, never two, never none.**

| shape | fires |
|---|---|
| sidecar WITH `use foreign:` | `E-FOREIGN-SIDECAR-NOMINAL` (§23.4), only |
| sidecar WITHOUT `use foreign:` | `E-NESTED-PROGRAM-CONTEXT-NOMINAL`, only |

**What was built instead.** The two capability cases are both the CLAIMED shape
(`use foreign:` present), so the code the invariant pins there is
`E-FOREIGN-SIDECAR-NOMINAL`, at exactly 1. That assertion is live and biting on
`main` today, and it is precisely the one that goes red if a second
unbuilt-context diagnostic is routed to the declaration site.

**Deliberately NOT added: `"E-NESTED-PROGRAM-CONTEXT-NOMINAL": 0`.** It would be
a forward-pin for when the r4 branch lands — but on `main` today it is a key that
cannot fail, for a code with no emitter, in a dispatch whose whole thesis is that
such keys are worse than nothing. **→ FILED for the PA:** when
`origin/nested-program-r4-work` lands, add `"E-NESTED-PROGRAM-CONTEXT-NOMINAL": 0`
to the `codeCounts` of both capability cases. At that point the key bites.

### C2. `scripts/delta-lint.ts` is not on `main` either

It is in the audit list of 16. Executed:

```
$ git merge-base --is-ancestor d3d53ef7 origin/main   # the commit that adds it
NO
$ git branch -a --contains d3d53ef7
  fix/s354-nested-program-artifact-gap
```

Audited anyway, from a scratch copy of the sibling branch's version, executed
against this tree. Result in the table below; a FIX cannot be landed from this
branch without dragging the sibling's in-flight work with it, so its finding is
FILED rather than fixed.

---

## BUILD A — `conformance/run.ts` cardinality (`codeCounts`)

### What was blind, measured

`conformance/adapters/impl1-ts.ts` destroyed cardinality before any case could
see it: `byCode` is a map and `codes` is `Object.keys(byCode).sort()`. A code
firing once and a code firing twenty-three times were the identical observation.

Censused the whole corpus for the size of the blind spot — how many ratified
cases emit some code more than once, entirely invisibly:

```
=== 106 of 883 cases emit at least one code MORE THAN ONCE
derived/e-derived-server-only-reach-neg        W-STDLIB-SEED-FAILCLOSED=23
error/implicit-tx-explicit-begin               W-SQL-ROW-UNTYPED=4
block-grammar/block-029-leading-equals-...     E-MARKUP-001=3
control-flow/ctrl-010-else-on-for-in-if-chain  E-DG-002=3
error-boundary/e005-nested-inner-no-fallback   E-ERROR-005=2
...  (106 total)
```

### What was built

- `impl1-ts.ts` — `CompileResult` gains `counts: Record<string, number>`, the
  per-code occurrence count across BOTH streams. Incremented BEFORE the
  severity de-dup's early return, or a code fired twice as an error would count
  once.
- `run.ts` — optional `expect.codeCounts`, checked EXACTLY. `0` is legal and
  meaningful (a strictly stronger `notCodes`). Unlisted codes stay
  unconstrained, so it composes with the superset contract instead of replacing
  it. A malformed value (non-integer / negative) is a HARD failure, never a
  skip — a cardinality assertion that silently does nothing is the exact hollow
  shape this key exists to close.
- `CaseResult.countMismatches` feeds `pass` and prints under `codeCounts:`.
- **Both bridge tests updated** (`conformance/conformance-corpus.test.js`,
  `compiler/tests/conformance/corpus-bridge.test.js`). Both assert per-FIELD, not
  on `r.pass` — so without this the new assertion would have been invisible to
  `bun test` and green under the pre-commit hook. That would have shipped a
  hollow gate inside the fix for hollow gates.
- Schema documented in `conformance/README.md` (the canonical corpus-format doc;
  SPEC carries no `expected.json` schema — verified by grep for
  `notCodePrefixes`/`expected.json` in `compiler/SPEC.md`, zero hits).

### Bite proof — both halves

**GREEN** (assertion true — `E-FOREIGN-SIDECAR-NOMINAL` fires exactly once):

```
$ bun conformance/run.ts | tail -2
conformance (impl#1): 883/883 cases pass
exit 0
```

**RED** (defect constructed — flip the same key to `2`):

```
$ sed -i 's/"E-FOREIGN-SIDECAR-NOMINAL": 1/"E-FOREIGN-SIDECAR-NOMINAL": 2/' \
    conformance/cases/capability/inheritance-inherit-covers/expected.json
$ bun conformance/run.ts ; echo "exit $?"
FAIL  capability/inheritance-inherit-covers
        codeCounts: code 'E-FOREIGN-SIDECAR-NOMINAL' fired 1 time(s), expected exactly 2

conformance (impl#1): 882/883 cases pass, 1 FAILED
exit 1
```

**GREEN restored** — flipped back to `1`, 883/883, exit 0.

**Second RED — a bite on a REAL double fire, not an arithmetic mismatch.** The
above proves the key compares numbers. This proves it catches the actual
regression class. `error-boundary/e005-nested-inner-no-fallback` is a ratified,
currently-PASSING case whose `E-ERROR-005` fires TWICE. Copied it verbatim to a
scratch dir and added only `codeCounts: {"E-ERROR-005": 1}`:

```
$ bun <one-case-runner> <scratch>/dbl
FAIL  <scratch>/dbl
      codeCounts: code 'E-ERROR-005' fired 2 time(s), expected exactly 1
```

Same source, same `codes` / `notCodes` / `severity` — all of which PASS, in the
live corpus, right now. Only `codeCounts` sees the second fire.

### Back-compatibility — PROVEN, not asserted

The claim is that a case without the key behaves exactly as before. Proof is a
byte-diff of the per-case verdict vector across all 883 cases, before the runner
change and after it (with no case yet using the key):

```
$ grep -E "^(PASS|FAIL)  " conf-baseline.txt      > verdicts-baseline.txt      # 883 lines
$ grep -E "^(PASS|FAIL)  " conf-after-runner.txt  > verdicts-after-runner.txt  # 883 lines
$ diff verdicts-baseline.txt verdicts-after-runner.txt
BACK-COMPAT PROVEN: all 883 per-case verdicts byte-identical
```

(The raw logs differ only in `mkdtemp` names and two stack-trace line numbers
inside a pre-existing caught throw — neither is a verdict.)

**Why additive is the right shape here, plainly.** `codeCounts` widens the
schema of the §62.2 versioned contract, so the question "does this invalidate the
existing corpus?" has to be answered rather than assumed. It does not: the key is
opt-in per case and per code. 883 cases carry no `codeCounts` and are checked by
the identical code path they were before. The 106 cases that DO multi-fire keep
passing, because the key constrains only codes a case names. Making counts
mandatory or corpus-wide-exact would have been a breaking change to 106 ratified
cases and would have converted an unknown number of intended multi-fires into
failures — that is a separate ruling, not a schema widening.

### Filed, not fixed

**F1 — 106 of 883 cases multi-fire a code, and no one has ever looked.** The
extremes are `W-STDLIB-SEED-FAILCLOSED=23` in one case and `E-ERROR-005=2` for a
single uncovered variant. Some of that is certainly legitimate (one diagnostic
per offending site); some of it looks like a genuine double fire that has been
invisible since the corpus was founded. Now that the instrument exists, the
population is enumerable. Reproducer: `conformance/run.ts`'s `loadCases()` +
`compile().counts`, filter `n > 1`. Routing call, not a fix — deciding which of
the 106 are defects is a per-case ruling.

**F2 — `docs/known-gaps.md:588` is now one key stale.** It carries a PA-VERIFIED
enumeration of "the harness's complete `expect` vocabulary" and does not list
`codeCounts`. The brief forbids touching that file, so: flagged for the PA.

---

## BUILD B — `s34-census.ts`, two blind spots

### B1 — comment-as-emitter

**Chosen: comment-span exclusion. The precise push-position match was tried,
measured, and REJECTED on evidence.** The brief permits the fallback if
push-position "is not tractable"; that is a claim I had to earn rather than
assume, so here is the measurement.

There is no single syntactic push shape in this codebase. Counting quoted-literal
`code:` pushes across the three impl trees gives **233 sites** against **320
codes** the raw scan credits with an emitter — so the property-literal form is a
minority of live emission shapes. The rest split three ways, and two of them are
syntactically identical to each other:

| shape | example | is it an emitter? |
|---|---|---|
| `code: "E-X"` property | `{ code: "E-MARKUP-001", … }` | YES |
| the code inside the MESSAGE template | `` `E-DBAUTH-NO-TENANT-COLUMN: db-authoritative table(s) …` `` (`commands/db-migrate.js:616`) | **YES** — that is how the CLI surfaces it |
| the code inside the MESSAGE template | `"[scrml] W-NAV-CHUNK-LOAD-FAILED: cross-chunk soft navigation…"` (`runtime-template.js:2908`) | **YES** — the runtime's own diagnostic |
| the code inside a DIFFERENT diagnostic's message | `` `(A tighter sibling of E-CHANNEL-004; §34.)` `` | NO — a cross-reference |
| the code inside a DIFFERENT diagnostic's message | `` `becomes E-WHITESPACE-001 in P3.` `` | NO — names a FUTURE code |

Rows 2-3 and rows 4-5 are the same syntax. Separating them needs semantics, not a
regex. A strict push-position match excluded 18-19 codes, and hand-checking them
found **real emitters among the excluded** (`E-DBAUTH-NO-TENANT-COLUMN`,
`W-NAV-CHUNK-LOAD-FAILED`) — i.e. it would have moved LIVE codes into FALSE-CLAIM
and inflated the freeze denominator. That is trap **T3**, which this script's own
header already records costing 17 false dead-code claims once before. Shipping it
would have traded a known over-count for an unknown under-count, which is the
worse of the two errors: an over-count wastes a fire-attempt, an under-count
deletes a real diagnostic from the contract.

Comment exclusion, by contrast, has **zero false-negative risk by construction** —
a comment cannot fire a diagnostic, so the change can only remove claims, never
real emitters.

Implemented as a mode-tracking `stripComments()` (line + block, string- and
template-aware, so `"http://…"` and `/* */` inside a literal are not mistaken for
comment openers), applied to `.ts/.js/.mjs` before the token match.

**Effect on the census (same tree, both scripts):**

| bucket | old scan | new scan |
|---|---|---|
| IMPL-SITES | 320 | **299** |
| DECLARED-AHEAD | 14 | **18** |
| FALSE-CLAIM | 95 | **112** |

21 codes lost an emitter they never had. 32 catalogued codes were measured to have
a hit whose every occurrence is a comment.

**Bite proof — two-sided.** `E-TYPE-027` is a FALSE-CLAIM code with zero mentions
in any impl tree. Injected two comments naming it into `compiler/src/type-system.ts`:

```
=== [0] CLEAN TREE, fixed scan
  IMPL-SITES=299  DECLARED-AHEAD=18  FALSE-CLAIM=112

=== injecting two COMMENTS naming E-TYPE-027 into compiler/src/type-system.ts

=== [1] DEFECT PRESENT, OLD scan (bare token, counts comments)
  IMPL-SITES=321  DECLARED-AHEAD=14  FALSE-CLAIM=94     <- RED: two comments promoted the row

=== [2] DEFECT PRESENT, NEW scan (comment spans stripped)
  IMPL-SITES=299  DECLARED-AHEAD=18  FALSE-CLAIM=112    <- GREEN: identical to clean

=== [3] CLEAN TREE again, fixed scan
  IMPL-SITES=299  DECLARED-AHEAD=18  FALSE-CLAIM=112
```

Two comments, and the old scan moves a row out of the honest bucket. That
reproduces the brief's `323/14 -> 321/16` shape on this tree as `321/14 -> 299/18`.

### B2 — provenance that resolves

The §34.0 gate tested the SHAPE of a provenance note (`emitted at` + a backticked
path) and never asked whether the note pointed at anything.

**Found by execution, on `main`, before writing the check.** Ran the candidate
resolver across all 811 catalogued rows: 55 name a symbol, 219 name a path.

- **symbols failing: 0** (after one refinement — `E-SCHEMA-011` names the Postgres
  catalog `pg_constraint`, prose in backticks, not a JS symbol. Excluded via a
  lowercase_snake filter; this codebase has no lowercase_snake function names and
  `_scrml_*` keeps its leading underscore. It was the ONLY false positive in 811 rows.)
- **paths failing: 1, and it is REAL** —

```
I-MATCH-PROMOTABLE  ->  `compiler/src/lint-promotable.ts`
$ ls compiler/src/lint-promotable.ts
ls: cannot access 'compiler/src/lint-promotable.ts': No such file or directory
$ ls compiler/src/ | grep -i promot
lint-i-fn-promotable.js
lint-i-match-promotable.js      <- the actual emitter
lint-w-each-promotable.js
```

The row (SPEC.md:19618) claims "Emitted at `compiler/src/lint-promotable.ts` and
consumed by `compiler/src/commands/promote.js`". The second path exists; the first
does not. A rename staled the note and nothing checked. Exactly the defect class
the brief describes, sitting in the catalog today.

Implemented: for each NEW/CHANGED row, every backticked repo path must exist on
disk, and every symbol named by the two conventions §34 actually uses
(`` `path` `sym` `` adjacency, or "via `sym`" / "in `sym`") must appear in
EXECUTABLE source — comments stripped, reusing B1's machinery, so a function
deleted but still eulogised in a comment cannot launder the claim. The resolution
check runs BEFORE the spec-ahead `continue`: a Nominal row citing a deleted file
is still a stale claim.

**Diff-scoping held.** The brief is emphatic that `--check-new` must stay silent
on the legacy corpus, and the stale `I-MATCH-PROMOTABLE` row is the live test of
that: it is a legacy row, the gate sees it, and the gate says nothing.

```
$ bun scripts/s34-census.ts --check-new --base origin/main
§34.0 gate: no new/changed §34 rows vs origin/main — PASS      exit 0
```

**Bite proof — two-sided.** Injected three new §34 rows: one whose provenance
resolves, one naming a nonexistent file, one naming a renamed function.

```
=== [1] DEFECT PRESENT, OLD gate (shape-only regex)
§34.0 gate: 3 new/changed §34 row(s), all well-formed — PASS
    exit=0                                            <- RED: passed BOTH false claims

=== [2] DEFECT PRESENT, NEW gate (provenance must resolve)
§34.0 gate FAILED — 2 problem(s) across 3 new/changed §34 row(s):
  E-BITE-BADPATH — STALE PROVENANCE: names `compiler/src/does-not-exist.ts`, which does not exist
  E-BITE-BADSYM  — STALE PROVENANCE: names symbol `checkPrintArgsRENAMED`, which appears in no executable source
    exit=1

=== [3] remove ONLY the two bad rows, keep the good one
§34.0 gate: 1 new/changed §34 row(s), all well-formed (provenance resolves) — PASS
    exit=0                                            <- GREEN: the honest row is unaffected

=== [4] clean tree
§34.0 gate: no new/changed §34 rows vs origin/main — PASS
    exit=0                                            <- legacy corpus still silent
```

**Third proof, for a claim made in the shipped comment.** The code asserts that a
symbol surviving only in a comment does not satisfy the check. Proving rather than
asserting it — added `// checkGhostRenamedFn was removed in S300; kept here as a
breadcrumb.` and a row naming that symbol:

```
E-BITE-GHOST — STALE PROVENANCE: names symbol `checkGhostRenamedFn`, which appears in no executable source
    exit=1
```

### Filed, not fixed

**F3 — `I-MATCH-PROMOTABLE`'s §34 row names a file that does not exist.**
SPEC.md:19618, `compiler/src/lint-promotable.ts`; the real emitter is
`compiler/src/lint-i-match-promotable.js`. Legacy row, so the diff-scoped gate is
correctly silent on it. It is a one-word SPEC edit but it is a SPEC edit, and the
brief scopes this dispatch to the instruments. Reproducer: the gate itself — touch
that row and the gate names it.

**F4 — the emitter scan still over-counts by one residual class.** With comments
stripped, ~19 codes' only remaining mention is a cross-reference INSIDE another
diagnostic's message string (`E-CHANNEL-004`, `E-CHANNEL-INSIDE-PROGRAM`,
`E-WHITESPACE-001`, `E-REACTIVE-004`, `W-DEPRECATED-001`, `E-CPS-NEEDS-FAILABLE`,
`E-STATE-BLOCK-BARE-WRITE-DECL`, `W-SCHEMA-002`, …). Those rows are credited with
an emitter they do not have. NOT fixed here because the same syntax carries two
LIVE emission shapes (the message-prefix convention in `commands/*.js` and
`runtime-template.js`), and separating them needs per-code adjudication of ~19
rows — a ruling, not a regex. Reproducer is in the table above.

---

## AUDIT — the vacuity table

**Method.** Every target derives its `ROOT` from its own file location, so a copy of the script in
a constructed tree is a clean "input missing / empty / zero-length" condition without touching the
repo. Where that only proved module resolution (a script importing a sibling), a targeted probe was
built instead. Every row below is an EXECUTED exit code, not a reading.

**Headline: 3 of the 5 blocking CI gates could pass while measuring nothing.**
`.github/workflows/ci.yml` blocks on exactly five: `browser-baseline --check` (the reference,
guarded), `snippet-gate` (VACUOUS — fixed), `facts --check` (VACUOUS — fixed),
`regen-spec-index --check` (narrow by design, and the narrow claim bites), and
`s34-census --check-new` (two blind spots — closed in Build B above).

| script | can it pass while measuring nothing? | executed evidence | verdict |
|---|---|---|---|
| `browser-baseline.ts` | **NO** | empty tree → `HARNESS DID NOT RUN — no \`N pass\` line` / `Refusing to record or compare an empty set (that is the hollow-gate shape)`, **exit 1** | **REFERENCE.** Three layers: a `ranOk` harness-ran check, a `parseOk` check against bun's OWN reported failure count, and an empty-set refusal. |
| `facts.ts` | **YES → FIXED** | tree with no source: `0 lines across 0 files`, `0 conformance cases`, `0 CLI verbs`; `--write` recorded all of it; `--check` → `PASS — all derived facts current`. **exit 0 at all three steps** | **VACUOUS — FIXED.** Now refuses, exit 2. |
| `regen-spec-index.ts` | **NO, for what it claims** | totals corrupted → `SPEC-INDEX totals are STALE`, exit 1; totals anchor deleted → `ERROR: … missing or malformed`, exit 1 | **NARROW BY DESIGN.** All 65 row ranges corrupted to `1-1 \| 1` → still `totals OK`, exit 0 — but the header states the ranges are *deliberately* ungated ("they drift by design between amendments and a gate that cries wolf gets bypassed then deleted"). Filed as a residual, NOT fixed. |
| `snippet-gate.js` | **YES → FIXED** | corpus discovering zero files → `no .scrml files discovered`, **exit 0** | **VACUOUS — FIXED.** Now refuses, exit 1. |
| `review-debt.ts` | yes, but **LABELLED** | `gh` unreachable → `review-debt: UNAVAILABLE (…)` + "review debt NOT verified this session. Say so in the boot report.", exit 0 | **DELIBERATE + HONEST.** Documented ("a probe that breaks the boot is a probe that gets removed"). NOT-VERIFIED is a distinct printed state from 0 OWED. Not a defect. |
| `corpus-zero-debt.ts` | **YES** | empty scan dirs → `0 artifacts scanned · … · 0 OWED · 0 VIOLATION` + `✅ no corpus-zero debt`, **exit 0** in `--check` | **VACUOUS.** Mitigated: it prints its denominator AND already carries "a clean scan is NOT proof of a clean corpus". FILED (F5). |
| `issue-debt.ts` | **NO** | missing ledgers → every issue unhomed → `2 open · 0 homed · 2 OWED`, exit 1; `gh` down → `UNAVAILABLE`, exit 0 with "NOT-VERIFIED is a distinct state from 0 OWED" | **GUARDED.** Also carries a truncation guard with auto-widen to a reported ceiling. Best of the debt family. |
| `threads.ts` | yes (reporter) | no BRIEF declares a probe → `thread-board: no BRIEF.md declares a DONE-PROBE: yet`, exit 0 | **REPORTER, no gate mode.** Cannot distinguish "no change dirs at all" from "dirs exist, none declares a probe" — same line for both. FILED (F7, minor). |
| `dpa-debt.ts` | yes (reporter) | missing queue → `dpa-debt — queue not found at <path>`, exit 0 | **REPORTER, no failing exit path at all** (one `process.exit`, and it is 0). Names the missing path, so not silent. FILED (F6). |
| `delta-lint.ts` | **YES** | see below — three separate zero-population shapes all → `PASS`, exit 0 | **VACUOUS. Not on `main`** (sibling branch `fix/s354-…`). FILED (F8). |
| `state.ts` | **YES** | known-gaps with zero `@gap` tokens: `--write` recorded `HIGH 0 / MED 0 / LOW 0 / Nominal 0`, exit 0; `--check` → `PASS — all @generated sections current`, **exit 0** | **VACUOUS.** Same mechanism as `facts.ts`. FILED (F9) — see the fix note below. |
| `corpus-emit-differential.ts` | **NO** | zero-artifact diff → `FINDING [VACUOUS] compared ZERO artifacts — this run verified NOTHING.` + `VERDICT: NOT A VALID COMPARISON`, **exit 2**; self-diff → `FINDING [INCOMPARABLE] both sides are the SAME revision … clean by construction and proves nothing`, exit 2; typo'd flag → exit 2 | **BEST-GUARDED IN THE SET**, stronger than the reference. Caveat: the CAPTURE half writes a 0-source manifest at exit 0; the DIFF half catches it, which is the point that matters. |
| `perf-regression-check.ts` | **YES** | every corpus key renamed → `[SKIP] … unknown corpus name` ×8 then `no regressions detected`, **exit 0**; `corpora: {}` → `no regressions detected` with no SKIP lines at all, **exit 0** | **VACUOUS.** |
| `benchmark-perf-baseline.ts` | **YES** | no corpora resolvable → `[SKIP]` ×8, then `wrote: …/perf-baseline.json` with `corpora: {}`, **exit 0** | **VACUOUS, and it COMPOUNDS**: that empty baseline then makes `perf-regression-check` report "no regressions detected" forever. Proven end-to-end. |
| `source-text-regex-census.ts` | yes (reporter) | empty `compiler/src` → `files / lines : 0 / 0`, `POST-AST … : 0`, exit 0 | **REPORTER, self-declared "DETECTION, not a gate".** Prints its denominator first, so a zero cannot be misread. Not a defect. |
| `dock-health.ts` | yes (by design) | empty corpus → `corpus: 0 .scrml file(s) · compiled 0`, exit 0 | **REPORTER, self-declared "ADVISORY, NEVER GATING … Always exit 0".** Prints its denominator. Not a defect. |

### `delta-lint.ts` — the sharpest of the audit findings

Three zero-population shapes, all reporting PASS. The middle one is the dangerous one: **a real
duplicate is present and the gate says PASS**, because the entry separator drifted.

```
=== [0] CONTROL — a healthy log with a real duplicate
    exit=1   delta-lint FAILED — 1 NEW duplicated sequence number(s) across 3 entries

=== [1] ENTRY-FORMAT DRIFT — the '·' separator becomes '-' (the duplicate is STILL THERE)
    exit=0   delta-lint — 0 entries in the live scope (from line 2), 0 distinct sequence numbers, max [0] — PASS

=== [2] TRAILING SESSION HEADER — the live scope is empty by construction
    exit=0   delta-lint — 0 entries in the live scope (from line 7), … — PASS

=== [3] EMPTY FILE
    exit=0   delta-lint — 0 entries in the live scope (from line 1), … — PASS
```

Shape [1] is not hypothetical for this script specifically: its own header states the `ENTRY` regex
must agree with `flogence src/ports/bridge-tool.scrml`, and "a divergence here is a silently
different population". A bridge-side format change empties the live scope and the gate goes green.
Shape [2] is one blank `## Session` header away at any wrap.

**FILED, not fixed** — the script is not on `main`, and pulling the sibling branch's in-flight work
into this one to patch it is exactly the wrong trade. Fix is ~4 lines: refuse when
`seen.size === 0` while the file is non-empty.

---

## FIXED — four vacuous instruments, each with a two-sided bite proof

The brief's rule: fix where the gate is vacuous and the fix is small and obvious; file the rest.
Four qualified. Every one mirrors `scripts/browser-baseline.ts`'s refusal, which is this repo's
reference pattern for the shape.

### 1. `snippet-gate.js` — BLOCKING CI GATE

RED (before): `bun scripts/snippet-gate.js docs/does-not-exist` → *"no .scrml files discovered in
the declared corpus"*, **exit 0**. It gates 110 public snippets including all of `docs/website`,
which its own header calls "the most-read public surface we ship". Rename that directory and the
gate leaves silently while CI stays green.

GREEN (after):
```
$ bun scripts/snippet-gate.js docs/does-not-exist
snippet-gate: NO .scrml FILES DISCOVERED — refusing to report success.
  A gate that compiled nothing has verified nothing (that is the hollow-gate shape).
  corpus: docs/does-not-exist
    DOES NOT EXIST  docs/does-not-exist
exit 1
$ bun scripts/snippet-gate.js
snippet-gate: 110 passed, 0 failed (110 total).      exit 0   <- live path unchanged
```
Tolerating ONE absent root is preserved (documented, deliberate — "a row may pre-date its
directory"). Discovering nothing AT ALL is now the refusal.

### 2. `facts.ts` — BLOCKING CI GATE

RED (before): a tree with no source in it → `0 lines across 0 files`, `0 conformance cases`,
`0 CLI verbs`; `--write` recorded it; `--check` said *"PASS — all derived facts current"*.
**exit 0 at all three steps.**

GREEN (after): refuses at print, write and check, listing all ten zero counters, **exit 2** — a code
distinct from 1 because this is not "the facts are stale", it is "the instrument is not measuring
the repo". Live path unchanged: `PASS — all derived facts current`, exit 0.

### 3. `state.ts` — the PA-state projection

RED (before): a `known-gaps.md` holding its anchors and zero `@gap` tokens → `--write` recorded
`HIGH 0 / MED 0 / LOW 0 / Nominal 0` at exit 0; `--check` then reported *"PASS — all @generated
sections current"* at exit 0.

GREEN (after): **exit 2** at both `--write` and `--check`, and the probe confirms the previously-
recorded values are left untouched (nothing was written). Live path unchanged.

The predicate is deliberately `tokens.length === 0` over a NON-EMPTY ledger, not `high === 0`. A
repo can legitimately have zero open HIGHs; a parser that sees no population at all over a
6,000-line ledger cannot be right. `gapCounts()` already threw on an *unclassifiable* status — this
closes the *no markers at all* hole beside it.

### 4. `benchmark-perf-baseline.ts` + `perf-regression-check.ts` — the compounding pair

This one is a chain, and the chain was proven end-to-end before the fix:

```
BEFORE
  benchmark-perf-baseline  no corpora resolvable -> [SKIP] x8 -> wrote perf-baseline.json
                           with  corpora: {}                                     exit 0
  perf-regression-check    reading that baseline -> "no regressions detected"    exit 0
  perf-regression-check    every corpus key renamed -> [SKIP] x8 ->
                           "no regressions detected"                             exit 0

AFTER
  benchmark-perf-baseline  "MEASURED ZERO CORPORA — refusing to write a baseline"  exit 2
                           (and no file is written at all)
  perf-regression-check    "COMPARED ZERO CORPORA — this run verified NOTHING;
                            refusing to report a verdict"                          exit 2
                           corpora: {}      -> "The baseline itself lists NO corpora"
                           7 listed, 0 met  -> "lists 7 … and NONE could be measured"
  perf-regression-check    real baseline, real corpora -> still DETECTS regressions, exit 1
```

The last line is the load-bearing half of the proof: the guard did not blunt the live path. The
control run flags real per-stage regressions (`trucking-dispatch RS +755%`), so the check still
bites where it should. **Both exit 2, not 1** — an inconclusive run is a distinct state from a clean
one, which is the whole point.

**Side observation, NOT this dispatch's scope:** that control run shows large per-stage deltas
against the recorded baseline. This script is in no workflow and no hook, so nothing has been
reading it. The numbers are machine- and load-sensitive and this box was running a test suite, so
they are NOT a regression claim — but a perf baseline nothing runs is worth a look.

### Deliberately NOT fixed

`regen-spec-index.ts`'s ungated row ranges. The naive read is "vacuous — all 65 ranges corrupted and
it still says OK", and that is what the execution shows. But the header states the exclusion is
deliberate, with the reason: *"they drift by design between amendments and a gate that cries wolf
gets bypassed then deleted (`pa-base v2.4` §8)"*. Gating them would be re-litigating a ruling under
cover of a bug fix. Filed as a residual (F10) with the observation that the class which actually
rotted — a 3,140-line stale index, which is the script's stated reason for existing — is the class
that remains ungated.

### 5. `corpus-zero-debt.ts` — hollow RIGHT NOW, in this checkout, not hypothetically

This is the one finding that was not a constructed condition. Run in the worktree, unmodified:

```
$ bun scripts/corpus-zero-debt.ts --check
corpus-zero-debt — 0 artifacts scanned · 0 carry a corpus-zero phrase · 0 in scope · 0 OWED · 0 VIOLATION
  ✅ no corpus-zero debt — every in-epoch deliberation artifact is disposed.
exit 0
```

`SUPPORT` is `${ROOT}/../scrml-support`. From a git worktree under `.claude/worktrees/<agent>/`
that resolves to `.claude/worktrees/scrml-support`, which does not exist — while the real sibling
holds **288 deep-dives**. `walk()` returns `[]` for a missing dir, so the scan silently empties and
the tick prints anyway.

It is `scripts/boot.ts:311`, a **boot probe** — the PA reads that tick as evidence at session start,
and every dispatched agent runs from a worktree. This is the brief's opening thesis, live.

**Fixed** with this repo's own established boot-probe shape (`review-debt.ts` / `issue-debt.ts`):
NOT-VERIFIED is a distinct printed state from zero debt; report loudly but do NOT break the boot in
report mode ("a probe that breaks the boot is a probe that gets removed"); a `--check` that verified
nothing is not a pass.

**Bite proof — and the GREEN half found real debt.**

```
RED (this worktree, where ../scrml-support does not resolve):
  ⚠️ NOT VERIFIED — scanned ZERO artifacts, so this run proves NOTHING.
     A zero scan and a clean corpus print the same tick; they are not the same fact.
     UNRESOLVED  …/agent-a4cfd2ab232fddafc/../scrml-support/docs/deep-dives
     UNRESOLVED  …/agent-a4cfd2ab232fddafc/../scrml-support/docs/debates
  exit 1

GREEN (a root from which the sibling DOES resolve):
  corpus-zero-debt — 322 artifacts scanned · 44 carry a corpus-zero phrase ·
                     5 in scope (authored ≥ 2026-08-16) · 5 OWED · 0 VIOLATION
  ⚠️ OWED — corpus-zero raised in an in-epoch deliberation artifact, no @corpus-zero marker:
     docs/deep-dives/ad-hoc-shared-reactive-state-2026-08-16.md  L15
     docs/deep-dives/d1-no-editions-earned-or-assumed-dpa-034-2026-08-19.md  L183
     … (5 total)
  exit 1
```

The live path is intact — and it exits 1 for the RIGHT reason, over a real population. **There are
5 genuinely OWED corpus-zero dispositions that the worktree-hollow gate has been hiding.** Routed to
the PA as F5; disposing them is a per-artifact reading, not this dispatch's call.

The path-resolution half is FILED, not fixed: making `SUPPORT` worktree-aware is a decision about
where the sibling repo lives, which is not mine to make. The guard turns a silent false-pass into a
loud "I could not scan", which exposes that question rather than papering over it.

---

## FILED — findings routed to the PA, not closed here

| id | finding | why not fixed here | reproducer |
|---|---|---|---|
| **F1** | 106 of 883 conformance cases emit some code more than once, invisibly — extremes `W-STDLIB-SEED-FAILCLOSED=23`, `E-ERROR-005=2` for one uncovered variant. Some legitimate (one diagnostic per site), some likely real double fires. | Deciding which of the 106 are defects is a per-case ruling. The instrument to see them now exists. | `loadCases()` + `compile().counts`, filter `n > 1`. |
| **F2** | `docs/known-gaps.md:588` carries a PA-VERIFIED enumeration of "the harness's complete `expect` vocabulary" and is now one key stale (`codeCounts`). | Brief forbids touching that file. | Read the line. |
| **F3** | `I-MATCH-PROMOTABLE`'s §34 row (SPEC.md:19618) cites `compiler/src/lint-promotable.ts`, which does not exist; the emitter is `compiler/src/lint-i-match-promotable.js`. | A SPEC edit, and a legacy row the diff-scoped gate is correctly silent on. | Touch that row → the new gate names it. |
| **F4** | The emitter scan still over-counts ~19 codes whose only non-comment mention is a cross-reference inside ANOTHER diagnostic's message string. | The same syntax carries two LIVE emission shapes; separating them needs per-code adjudication, not a regex. | Table in Build B above. |
| **F5** | **5 genuinely OWED corpus-zero dispositions** in `scrml-support/docs/deep-dives`, hidden by the worktree-hollow gate. Also: `SUPPORT = ${ROOT}/../scrml-support` does not resolve from a worktree at all. | Disposition is a per-artifact reading; the path question is a decision about repo layout. | `bun scripts/corpus-zero-debt.ts --check` from a root where the sibling resolves. |
| **F6** | `dpa-debt.ts` has exactly one `process.exit`, and it is `0`. No failing path exists, and a missing queue reports as a normal run. | It is a reporter with no gate mode; adding one is a design call. It does name the missing path. | Move `handOffs/dpa-queue.md` → `queue not found`, exit 0. |
| **F7** | `threads.ts` cannot distinguish "no change dirs exist at all" from "dirs exist, none declares a DONE-PROBE" — identical output for both. | Minor; needs a denominator in the message ("N BRIEF.md scanned, 0 declare a probe"). | Empty tree vs a tree with a probe-less BRIEF.md → same line. |
| **F8** | **`delta-lint.ts` reports PASS over a log that still contains the duplicate it exists to catch**, when the entry format drifts. Three zero-population shapes all green. | Not on `main` — it lives on `origin/fix/s354-nested-program-artifact-gap`. Pulling that branch in to patch it is the wrong trade. | Full four-case transcript in the audit section above. Fix is ~4 lines: refuse `seen.size === 0` over a non-empty file. |
| **F9** | `regen-spec-index.ts --check` cannot see the rot class it was written for — all 65 row ranges corrupted, still "totals OK". | **Deliberate and documented** (pa-base §8, cry-wolf). Gating them would re-litigate a ruling under cover of a bug fix. Recorded because the gap between "why the script exists" and "what the gate checks" is worth an operator's eye. | `sed -E 's/\| [0-9]+-[0-9]+ \| [0-9]+ \|/\| 1-1 \| 1 \|/'` on SPEC-INDEX.md → exit 0. |
| **F10** | `corpus-emit-differential.ts`'s CAPTURE half writes a 0-source manifest at exit 0. | The DIFF half catches it with an explicit `FINDING [VACUOUS]`, which is the point that matters. Noted for completeness. | Capture against an empty roots dir. |

---

## VERIFICATION BAR

`main` moved during the dispatch (`a0e30329` → `d2f16aca`, one commit: `emit-library.ts` + its
integration test + a regenerated `docs/FACTS.md` count). **Merged, not file-delta'd**, per the
brief. No overlap with any instrument file; the merge was clean.

### Full gate set, post-merge, on the real tree

| gate | before | after |
|---|---|---|
| `browser-baseline --check` | exit 0 | **exit 0** — `PASS — browser failure name set matches the baseline (48 asserted, 0 of 2 env-excluded observed)` |
| `snippet-gate` | exit 0 (110 passed) | **exit 0** — `110 passed, 0 failed (110 total)` |
| `facts --check` | exit 0 | **exit 0** — `PASS — all derived facts current` |
| `regen-spec-index --check` | exit 0 | **exit 0** — `SPEC-INDEX totals OK — Total lines: 37,293 \| Total sections: 65 + appendices` |
| `s34-census --check-new --base origin/main` | exit 0 | **exit 0** — `no new/changed §34 rows vs origin/main — PASS` |
| `s34-census` (census) | exit 0 | **exit 0** — buckets shifted by the T7 fix (see Build B) |
| `state --check` | exit 0 | **exit 0** — both `@generated` sections PASS |
| `conformance/run.ts` | 883/883, exit 0 | **883/883, exit 0** |
| `issue-debt --check` | exit 0 | **exit 0** — `✅ every open issue has a home` |
| `dpa-debt` | exit 0 | **exit 0** — `✓ nothing owed` |
| `threads` | exit 0 | **exit 0** |
| `source-text-regex-census` (+ `--selftest`) | exit 0 | **exit 0** |
| `corpus-zero-debt --check` | exit 0 (**hollow — 0 scanned, green tick**) | **exit 1 — INTENDED.** Now says `NOT VERIFIED — scanned ZERO artifacts`. Not a regression: it is the fix reporting honestly. In no workflow and no hook, so nothing is blocked. |

**Zero gates regressed.** The single exit-code change is `corpus-zero-debt`, and it changed from a
false green to an honest red.

### Pre-commit suite

Ran on every commit (never `--no-verify`, `core.hooksPath` untouched):
**28,964 tests across 1,260 files · 0 fail · 86 skip · 1 todo · 129,420 expect() calls.**
Identical before and after.

### ENV-GAP ruled out, not assumed

`compiler/tests/browser/render-by-tag-nested-compound-bug60.browser.test.js` fails 5/5 in the
post-commit hook. Ruled out as mine by execution rather than by argument: `git checkout origin/main
-- compiler/ conformance/`, re-ran, got the identical **5 fail**, then restored. **PRE-EXISTING on
`origin/main`.** (`bun install` + `bun run pretest` were both run at setup — a fresh worktree
carries no gitignored `samples/compilation-tests/dist/`.)

### A note on this dispatch's own method

Two things nearly went in wrong, and both were caught by executing rather than reasoning:

1. **The brief's target code did not exist.** Following it literally would have red-lined two
   ratified conformance cases for a code with no emitter. Caught by compiling the cases and counting.
2. **A design decision was nearly filed as a defect.** `regen-spec-index`'s ungated row ranges look
   exactly like vacuity under execution — all 65 corrupted, still green. Reading the header first
   showed the exclusion is deliberate with a stated rationale. Gating them would have been
   re-litigating a ruling under cover of a bug fix.

The second is the one worth keeping: **"the gate does not catch X" and "the gate deliberately does
not catch X" produce identical evidence.** An audit that only executes will call the second a bug.

---
---

# FIX ROUND — post-adversarial-review, same day

Verdict returned: **LAND, conditional on five named follow-ups.** Two of the five are
defects in gates that are *already blocking CI on `main`* — which is the same failure
class this branch was cut to close, found inside the branch that closes it.

Brief archived verbatim at `FIX-ROUND-BRIEF.md` (same directory).

The bar is unchanged and it is this branch's own thesis: **every claim below is an
executed result with a directly-measured exit code (`cmd; echo $?`), never a reading of
the source and never a status read through a pipe.**

## STEP 0 — merge `origin/main`

`main` moved past the merge-base and now carries `scripts/delta-lint.ts` plus a 6th
blocking CI gate that did not exist when this branch was cut. Condition (2) is a defect
in that new gate, so it is unreachable without the merge.

```
$ git merge origin/main --no-edit
Merge made by the 'ort' strategy.
 10 files changed, 676 insertions(+), 17 deletions(-)
```

**Zero conflicts.** The `docs/FACTS.md` / `docs/known-gaps.md` collisions the brief
warned about did not materialise — this branch had not touched either file's
`@generated` blocks (that restriction is the reason condition (3) exists as a
follow-up rather than as original work).

**`handOffs/delta-log.md` sequence handling.** No hand-resolution was needed and none
was performed. `main` brought in `.gitattributes` with `handOffs/delta-log.md
merge=union`, so both sides' appends were kept automatically; this branch contributed
no delta-log entries, so there was no side to yield. Verified rather than assumed —
and verified by the gate that exists for exactly this:

```
$ bun scripts/delta-lint.ts; echo $?
delta-lint — 9 baselined duplicate(s) carried as known debt: [721] [722] [1079] [1080] [1081] [1173] [1174] [1524] [1525]
delta-lint — 1394 entries in the live scope (from line 875), 1385 distinct sequence numbers, max [1686] — PASS
0
```

`delta-lint --fix` was **not** run on the merge result, per the brief: its heuristic
keeps first-in-file order, which is blind to which side is already published.

## The five conditions

Recorded below as each one closes.

### (1) HIGH — `scripts/state.ts`: the master-list half of the guard was unreachable — **DONE**

The reviewer's reading was exactly right. `recentSessions()` has two returns and both are
non-empty: the zero-population path returns the sentinel `_(no session-wrap commits found)_`,
the normal path returns joined lines. `sessions.trim().length === 0` could therefore never be
true. The hollow write-then-check chain this branch closed for `known-gaps.md` survived intact
one field over — and `progress.md` above asserted it as covered. **That is this branch's own
thesis landing on the branch itself: a check that cannot fail, read as evidence.**

**Reproduced before fixing**, with the session population emptied by pointing git at a scratch
repo with no commits (`GIT_DIR` override — the worktree's own `.git` was never moved, and no
`git stash` was used anywhere in this dispatch):

```
$ GIT_DIR=<empty-repo>/.git bun scripts/state.ts --write; echo $?
  regenerated @generated:recent-sessions in master-list.md
0                        <- exit 0. Eight lines of forensic index replaced by the sentinel.

$ GIT_DIR=<empty-repo>/.git bun scripts/state.ts --check; echo $?
  PASS — all @generated sections current.
0                        <- the gate agreeing with the hollow value, exactly as predicted.
```

**Fix.** The degenerate value has a name, so test for the name — and give it *one* name:
`NO_SESSIONS_SENTINEL` is now a named const referenced by both the producer and the guard.
Inlining it at two sites is precisely how the guard went dead the first time, so the fix
removes the duplication rather than adding a second literal. `|| sessions.length === 0` is
kept alongside the sentinel test: it is dead today, but it stops being dead the moment
someone changes the zero-path return, and it costs nothing.

**Bite proof** (exit codes measured directly with `; echo $?`, never through a pipe):

| population | invocation | pre-fix | post-fix |
|---|---|---|---|
| **EMPTY** (git log yields no wrap commits) | `--write` | **exit 0** — records the sentinel over the index | **exit 2 — REFUSES**, `master-list.md` untouched (`git diff --stat` empty) |
| **EMPTY**, over the hollow write | `--check` | **exit 0 — `PASS`** | **exit 2 — REFUSES** (guard fires before the comparison) |
| **REAL** (the actual repo) | `--check` | exit 0 `PASS` | **exit 0 `PASS`** |
| **REAL** | `--write` | idempotent | **exit 0, `no changes (already current)`** |

Both halves of the guard now bite. The known-gaps half was already proven in the round above;
this is the half that was asserted rather than proven.
