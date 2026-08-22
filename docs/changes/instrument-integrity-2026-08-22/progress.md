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
