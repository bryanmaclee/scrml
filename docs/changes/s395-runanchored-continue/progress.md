# progress — s395-runanchored-continue (ruling 2a, limb (a))

`prov=ruling:user-voice-scrml.md S395 — "your recs" adopting limb (c) sequenced; (a) lands first`

## STATUS: complete

Limb (a) landed: `runAnchored`'s unconditional `continue` removed, so `text`/`attr`/`value`
now evaluate on an assertion that also carries `count`.

Limb (b) — a hard authoring error for `count`-plus-other + migrating the 18 to separate
assertions — remains OUT OF SCOPE, a separate follow-on landing.

## THE CHANGE

`conformance/normalize.ts` — one function, `runAnchored()`.

The `continue` after the count comparison was unconditional. It is now conditional on the
assertion carrying NO first-match check:

```ts
const assertsFirstMatch =
  typeof a.text === "string" || Boolean(a.attr) || typeof a.value === "string";
...
  if (!assertsFirstMatch) continue;
```

**Retaining the short-circuit for count-only assertions is load-bearing, not cosmetic.** A naive
`continue` deletion would have fallen through to `root.querySelector()` → `!el` →
`"selector X: no match"` for every `count: 0` assertion. **62 corpus assertions carry `count: 0`**
to assert ABSENCE. All 62 would have gone red. None of those 62 overlaps the 18 (every one of the
18 is `count: 1`), so the two sets are cleanly separable.

## PHASE 1 — the 18 under the REAL fix

Full corpus with the fix in: **893/893 pass, 0 FAIL.**

Coarse green is not per-assertion evidence, so `runAnchored` was TEMPORARILY instrumented to
record, for every `count`-plus-other assertion, whether the first-match branch was entered and
what value was actually observed in the live DOM. Driver walked the 15 target cases via
`loadCases()` + `runCaseRuntime()`. Instrumentation restored from a pristine file copy
afterward (verified byte-identical to HEAD).

**first-match branch reached: 18/18 (pre-fix: 0/18). Newly-evaluated halves RED: 0.**
Every observed value equalled its expectation. No case was edited to make it green.

## PHASE 2 — bite proof

| step | corpus result |
|---|---|
| corrupt `reactive-toggle-show` `text` + `outlet-class-id` `attr`, **fix in** | 891/893 — **exactly those 2 red** |
| same two corruptions, **`normalize.ts` swapped to `origin/main` (pre-fix)** | **893/893 pass — both violations invisible** |
| restore both cases, fix in | 893/893 pass |
| supplement: corrupt `error-boundary-variant-renders` `text` (an ENTIRELY-unguarded one), fix in | 892/893 — exactly that 1 red |
| restore | 893/893 pass |

Failure messages report the REAL rendered value, not a placeholder:

```
domAnchored: selector #app-outlet: attr class expected "BITE-PROOF-WRONG-CLASS", got "main-region"
domAnchored: selector #panel: text expected "BITE-PROOF-WRONG-TEXT", got "Panel open"
domAnchored: selector .eb-notfound: text expected "BITE-PROOF-UNGUARDED-TEXT", got "Item missing not found"
```

The pre-fix row is the decisive one: the identical deliberate contract violations are 100%
invisible on `origin/main`. The 18 were empirically inert, not theoretically inert.

## PHASE 3 — population re-count (independent)

Method: walk every `conformance/cases/**/expected.json`, `JSON.parse`, read `expect.domAnchored`,
count assertions where `typeof count === "number"` AND (`typeof text === "string"` OR truthy
`attr` OR `typeof value === "string"`). Whole-corpus census, no sampling.

```
expected.json files scanned          : 893
total domAnchored assertions         : 455
  count-only                         : 177
  no-count (already fully evaluated) : 260
  COUNT + (text|attr|value)          : 18   <- across 15 distinct case files
  count:0 anywhere                   : 62
```

**Confirms 18 across 15.** No discrepancy with the PA figure.

## BLAST RADIUS (supplement, not requested)

Of the 18, how many had the same value redundantly asserted by the case's whole-tree `dom`?

**2 redundantly guarded · 16 ENTIRELY UNGUARDED.**

Only `each-empty-fallback` and `reactive-toggle-show` had a whole-tree `dom` containing the
expected value. The other 16 rendered-DOM contract points had no other assertion anywhere in
their case. Sixteen — including all eight `error-boundary` fallback-text cases and both
`error-match-failable-ok-arm-rt` arms — could have regressed silently.

## PHASE 4 — full suite

`bun run test` A/B on the same warm worktree, failure sets compared BY NAME:

| run | pass | fail |
|---|---|---|
| base (pre-fix `normalize.ts`, warm) | 30934 | 55 |
| after (fix, warm) | 30934 | 55 |

**`diff` of the sorted failure-name sets: IDENTICAL. Zero delta.**

The 55 are pre-existing browser / dev-server / happy-dom failures untouched by this change
(`bun run test` is `bun test compiler/tests/`, which never loads `conformance/normalize.ts`).

Gated pre-commit suite on the fix commit: **29558 pass · 86 skip · 10 todo · 0 fail.**
Conformance bun:test wrapper (not auto-discovered — run by path):
`bun test ./conformance/conformance-corpus.test.js` → **894 pass · 0 fail.**

FIRST-RUN CAVEAT, resolved: the initial (cold) after-run showed 57 fail. The 2 extra were
`TodoMVC §0/§1 — dist not compiled`, asserting `benchmarks/todomvc/dist/app.html` exists.
That path is gitignored and absent from a fresh worktree; the first suite run BUILDS it, so the
second run found it warm. Re-running the fixed tree warm reproduced 55/55 name-for-name. This is
the known fresh-worktree gitignored-dist environment gap, not a regression.

## DEFERRED

- **Limb (b)** — make `count`-plus-other a hard authoring error and migrate the 18 to separate
  assertions. Out of scope by ruling; a separate landing.
- The gap entry's "the 18 must be adjudicated one at a time" instruction is now doubly falsified:
  independently re-measured RED 0 · ok 15, under the REAL fix rather than the strip-`count` proxy.
