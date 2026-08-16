# FINDINGS — flagship-hos cloud intermittent (S346 dispatch, fix/flagship-hos-hermetic)

## MECHANISM

**The test never failed its assertion. It TIMED OUT — and bun reports a timed-out synchronous
test with the same `(fail) <name>` marker an assertion failure produces.**

Three stacked facts, each verified:

1. **The effective per-test budget is 5000 ms, not the 10 s the repo believed.**
   `bunfig.toml` carried `[test] timeout = 10000` since the initial split, and bun does not
   read that key (bun 1.3.14, verified: a 6 s synchronous spin test under this bunfig reports
   `timed out after 5000ms`, while the `root` key in the same file IS honoured, so the file
   loads; `--timeout 10000` on the CLI works). Three test-file comments cite "the bunfig
   default 10s per-test timeout" — that number was never in force anywhere.

2. **The flagship test's whole-app compile (36 .scrml, synchronous `compileScrml`) costs
   ~2.5–3.3 s alone on a fast local box** — already more than half the real budget — and it ran
   lazily inside the FIRST test body. A synchronous test that overruns still runs to
   completion (all 18 expect() calls pass), then bun marks it
   `(fail) … [5257ms]` + `^ this test timed out after 5000ms.`. The browser NAME-SET gate keys
   on the name alone and `spawnSync(...,{encoding:"utf8"})` swallows the tier's stdout, so the
   timeout line never reached a job log — the failure was read for three sessions as "the
   emitted hos.html lacks the template". It never did.

3. **What pushed the compile past 5 s only SOMETIMES: a JIT-tier pathology in
   `compiler/src/lint-ghost-patterns.js`.** `skipPastRanges` rescans the sorted skip-range
   list from index 0 on every call, and the five range builders + `findMatchingClose` called
   it once per CHARACTER — O(chars × ranges) per pass. Fresh process: 343 ms of the flagship
   compile (8%, `bun --cpu-prof`). But when the FIRST hot compile in the process carried an
   EMPTY range list — any fixture whose source has no string literal and no comment — the
   same call sites ran ~17× slower for the rest of the process: **5.9 s of a 9.7 s compile**
   (61% self time; `prior.md.cpuprofile` vs `fresh.md.cpuprofile`). Reproduced
   deterministically in both directions, 4/4, byte-identical output either way:

   - prior compile of a no-string source → flagship compile CPU 10.4–13.0 s (wall 7.3–12.6 s)
   - fresh process, or prior compile of a source WITH a string literal → CPU 5.4–7.0 s
     (wall 2.6–4.3 s)

   The tier runs 79 in-process `compileScrml` calls in ONE bun process in **readdir order —
   a property of the runner image** — under 4-vCPU contention. Whether a no-string fixture
   compiles before the flagship test, and how loaded the runner is, decide whether the compile
   lands under or over 5 s. Same SHA passes and fails; a docs-only delta fails; 5 of 8 recent
   gate runs red — all consistent with a wall-clock race and with nothing else.

**Cloud bite (the load-bearing capture):** run `31915273220` failed on a DOCS-ONLY delta
(PA-verified), and run **`31915126678`** — this branch at `3ad870c7`, which adds a failure
REASON excerpt to `scripts/browser-baseline.ts` — prints in the gate job's own log:

```
+ flagship driver/hos — <engine> under an if= > the page compiles and its engine mount really does sit inside an if= template
    │ took 5257.19ms
    │ ^ this test timed out after 5000ms.
```

That is the cloud mechanism observed directly, not inferred.

### Writer file(s)

Not one writer — a CLASS. The pairwise sweep (91 × `bun test <X> <victim>`, full tier) found
**13 files** that make the pair red, **every one of them a timeout of the victim's first test
(5.0–10.4 s), zero assertion failures**:

```
browser-conditionals · browser-cow-bracket-write · browser-deepset-write-loss ·
browser-error-boundary · each-body-interactivity-landing2 · each-contextual-sigil-native ·
each-in-tier0-lift-bug72 · each-over-arm-payload-binding-unbound ·
each-per-item-handler-live-keying-bug73 · each-per-item-reactivity-bug64 ·
each-runtime-bug-57 · g-each-peritem-if-predicate · markup-value-render
```

The common property is not shared DOM or shared compiler state — it is **compiling a fixture
with no string literal/comment early** (poisoning the JIT tier of `skipPastRanges`) and/or
adding enough same-process load that the flagship compile crosses 5 s. Under CI's 4-vCPU
runner the threshold is crossed far more easily than locally, which is why the red was
cloud-weighted.

### Leaking state

No compiler-VALUE state leaks. Emitted output is invariant to process history and order:

- Fresh-process double-compile: byte-identical.
- `hos.html` after a prior no-string compile in the same process: byte-identical to fresh.
- Corpus emit differential base `2709e540` vs this tree: **NO DIFFERENCES** — 1906 sources
  enumerated on both sides, 7383/7383 artifacts byte-identical, compile-failure and
  syntax-failure sets identical.
- Sibling S346 review agent: 12 input orders (sorted/reversed/scanDirectory/raw-readdir/9
  shuffles), `engineMountInTemplate=true` every time.
- All wall-clock/random reads in the compile path (`performance.now` etc.) are `debugPerf`
  instrumentation or duration reporting; none feeds an emission decision. `process.env` reads
  in codegen: `SCRML_STRICT_BOUNDARY` / `SCRML_DEBUG` (diagnostic-only).

What DOES leak across compiles is **JIT tier state of a hot function** — process-level, not
module-level, and invisible to every output-diff instrument. SPEC §58.1 purity holds for the
artifact; it never bounded wall time.

### Deterministic local reproducer (bite-proven both ways on the same tree, pre-fix)

```
# RED — writer first (flagship's first test: (fail) … timed out, 7.6–10.4 s):
bun test compiler/tests/browser/each-per-item-reactivity-bug64.browser.test.js \
         compiler/tests/browser/flagship-hos-engine-under-if.browser.test.js

# GREEN — victim first (same tree, same files):
bun test compiler/tests/browser/flagship-hos-engine-under-if.browser.test.js \
         compiler/tests/browser/each-per-item-reactivity-bug64.browser.test.js
```

(bun honours explicit-file argument order — verified with two probe files both ways.)
Compile-cost half, outside bun entirely:
`bun docs/changes/flagship-hos-hermetic/repro/compile-hos.ts /tmp/x.html [prior.scrml]` —
with a no-string `prior.scrml` the flagship compile CPU doubles; without it, it does not.

## THE FIX (three layers)

1. **Compiler — `compiler/src/lint-ghost-patterns.js`** (the root cost): `makeSkipCursor` —
   a forward-only cursor with `skipPastRanges`'s exact semantics for the non-decreasing query
   sequences every scanner in the file issues; each scan owns its cursor (per-compile purity
   untouched; the old function stays exported as the oracle). O(chars × ranges) →
   O(chars + ranges). Synthetic 160k-char/6k-range source: 6.5 s → 32 ms. Repo-wide lint of
   2398 .scrml: 14.0 s → 1.5 s, byte-identical diagnostics. Post-fix the flagship compile is
   fresh-speed regardless of what compiled before it (4/4).
   Pin: `compiler/tests/unit/lint-ghost-patterns-skip-cursor.test.js` — §1 cursor==oracle
   (seeded property test, ~27k checks + edge cases), §2 cost-class bound (1.5 s ceiling on the
   synthetic input; the pre-fix class always trips it), §3 process-order output identity.

2. **Harness — `compiler/tests/browser/flagship-hos-engine-under-if.browser.test.js`**: the
   whole-app compile moved to `beforeAll(fn, { timeout: 60_000 })` — an explicit budget at the
   site, the repo's existing precedent for this exact app
   (`integration/w3-splitter-trucking-characterization.test.js`). Assertions unchanged. Also
   runs BEFORE happy-dom registration now (H2 closed by construction).
   `bunfig.toml`: the dead `timeout` key removed with a comment stating the rule.

3. **Gate — `scripts/browser-baseline.ts`**: every NEW failure name now prints a reason
   excerpt (timing + nearest `error:` block + `^ … timed out` line). A timeout and an
   assertion failure are no longer indistinguishable in the only log anyone reads. This is
   the change that captured the cloud mechanism on run `31915126678`.

## Hypothesis scorecard (PA-located loci)

- **H1 (module-level compiler state changes the OUTPUT)** — REFUTED for the output, CONFIRMED
  in spirit for the process: the state that leaks is JIT tier, not a `let`. None of the nine
  PA-located loci (`_currentFileEngineMountNames`, `chunk-namespace._state`,
  `emit-control-flow` ×4, `emit-each` ×4, `_varCounter`, `_nodeCounter`,
  `_currentUserAmbientActive`) affects the emitted hos.html across compiles — proven by
  byte-identity of second-compile output and the 7383-artifact differential.
- **H2 (happy-dom globals present at compile)** — REFUTED as the cause (compiles with
  `document` present emitted byte-identical output; the fastest writer pairs HAD registered
  happy-dom and stayed green) — but closed anyway by moving the compile into `beforeAll`.
- **H3 (shared-document listener coupling)** — moot, as the brief predicted: the assertion
  reads the emitted string.
- **#527/#534's premises** ("input order / stray-file layout shift changes the artifact") —
  refuted by the sibling review agent's measurements; those PRs remain good hygiene.
- **PR #529 (sorted tier order)** — post-fix the tier is green under sorted order and the
  baseline check PASSes with the 48 names unchanged, so #529 is unblocked. Note sorted order
  puts five of the 13 timeout-inducing `each-*`/`browser-*` writers ahead of the victim
  alphabetically, which is why sorted order could resolve red pre-fix on a loaded box and
  green on an idle one.

## Gate results (this tree, post-fix)

- flagship pair 5× writer-first + 5× victim-first: **10/10 green** (0 fails each run).
- 13 pre-fix RED pairs re-run: all 13 green (fails=0 each).
- Sorted-order tier (`bun test $(ls compiler/tests/browser/*.test.js | sort)`): 730 pass /
  48 fail — exactly the 48 baseline names; flagship-fails=0.
- `bun scripts/browser-baseline.ts --check`: **PASS — 48 asserted names UNCHANGED**
  (baseline not re-cut).
- Contract gate `bun test compiler/tests/{unit,integration,conformance}`: 0 fail (ran twice
  inside pre-commit hooks: ~28.7k pass / 0 fail).
- Corpus emit differential: **0 files changed** (1906 sources, 7383 artifacts, both sides).
- Cloud: `workflow_dispatch` runs on the fixed branch — run IDs/verdicts in progress.md.
