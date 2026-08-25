# progress — if-attr-per-field-synth-crash-2026-08-24

WORKTREE: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a29d4b117acf46c4f
BRANCH: worktree-agent-a29d4b117acf46c4f
BASE: b0abcbc6141fa2640b59f702f51792ad208da914 (== origin/main, asserted via merge-base)

## 2026-08-24 — startup

- pwd/toplevel/clean/merge-base all asserted green.
- `bun install` ok (218 packages). `bun run pretest` ok (13 samples -> samples/compilation-tests/dist/).
- Brief fetched from `brief/s372` into docs/changes/if-attr-per-field-synth-crash-2026-08-24/.

## 2026-08-24 — REPRO_BEFORE: reproduces on base, five rows identical to the brief

`bun docs/changes/if-attr-per-field-synth-crash-2026-08-24/repro-if-attr-synth.mjs`

| `if=` bound to | `#ctl` control | lowered `if=` | verdict |
|---|---|---|---|
| `@flag` | `"true"` | (none — plain cell) | ok |
| `@signup.name` | `"true"` | `reactive_get("signup").name` | ok |
| `@signup.isValid` | `"true"` | `reactive_get("signup").isValid` | ok |
| `@signup.name.touched` | `""` | `reactive_get("signup").name.touched` | TypeError |
| `@signup.name.isValid` | `""` | `reactive_get("signup").name.isValid` | TypeError |

console.error on the two failing rows:
`TypeError: null is not an object (evaluating '_scrml_cs_reactive_get("signup").name.touched')`
and the `.isValid` twin. Compile exit is clean, 0 errors, on every row.

## 2026-08-24 — LOCUS: HELD. And the defect has a SECOND, SILENT limb the brief scored as passing.

Locus re-derived from source, not accepted: `emit-event-wiring.ts:511` is byte-for-byte the
crashing string, reached from the `variable-ref` binding records at `emit-html.ts:1403` (ifGuard),
`:1468` (mount toggle) and `:3160` (`show=` / capital-tag `if=` display toggle). All three build
`varName = ifVarName.split(".")[0]` + `dotPath = <full dotted>`. `computeMountToggleCondition`
(`:540`) delegates, so mount and display share it. HELD.

### What the emitted condition actually is, per row (measured, not read)

| `if=` source | emitted mount condition |
|---|---|
| `@signup.name` | `(_scrml_cs_reactive_get("signup").name)` |
| `@signup.isValid` | `(_scrml_cs_reactive_get("signup").isValid)` |
| `@signup.name.touched` | `(_scrml_cs_reactive_get("signup").name.touched)` |
| **`(@signup.isValid)`** — parenthesised, `condExpr` branch | **`(_scrml_cs_reactive_get("signup.isValid"))`** |
| **`(@signup.name.touched)`** — parenthesised | **`(_scrml_cs_reactive_get("signup.name.touched"))`** |

Two spellings of the SAME predicate lower differently. The parenthesised form routes to the
`condExpr` branch, which threads `synthCellKeys` (the Bug-61 fix, comment at `:501`) and collapses
correctly. The bare form routes to the `dotPath` branch, which consults nothing.

### The runtime object cannot satisfy either chain

`_scrml_reactive_get("signup")` is `{ name: null }` — measured. So:
- `.isValid` / `.submitted` / `.touched` / `.errors` -> `undefined` (falsy, NO throw)
- `.name.touched` -> TypeError (deref of null)

### LIMB B — NEW, not in the brief: the compound-level rows are SILENTLY FALSE, not passing

The brief's detector is boot-survival (`#ctl`), which cannot see a condition that is merely
permanently-undefined. Driving the flat cell TRUE and asking whether the subtree MOUNTS:

| `if=` bound to | `#ctl` | GATED mounts after `set(key, true)` | verdict |
|---|---|---|---|
| `(@signup.name.touched)` | `"true"` | **true** | correct (positive control) |
| `@signup.name.touched` | `""` | false | LIMB A — TypeError, dead page |
| `(@signup.submitted)` | `"true"` | **true** | correct (positive control) |
| `@signup.submitted` | `"true"` | **false** | **LIMB B — silently never mounts** |

So `if=@signup.submitted` / `@signup.isValid` / `@signup.touched` / `@signup.errors` compile at
exit 0, boot cleanly, and the gated subtree NEVER MOUNTS no matter what the cell does. That is the
GH #262 / #275 defect class in a THIRD location — the one the `:501` comment says was fixed.
Both limbs are cured by the same change at the same decision site.

## 2026-08-24 — the fix, and what it changes across the whole corpus

Fix at the traced site, `emit-event-wiring.ts` `computeDisplayToggleCondition`, `varName`+`dotPath`
branch. The §55 collapse RULE was extracted out of `collapseSynthSurfaceRefsInRaw` into an exported
`resolveSynthCellPrefix(segments, synthCellKeys)` in emit-expr.ts, so the raw-string path,
`emitMember` and this toggle now share ONE implementation. No parallel resolver, no `?.`.

Emitted key is PLAIN, matching `emitMember` and the `condExpr` branch byte-for-byte — the point is
that the two spellings produce ONE lowering. `collectSynthCellKeys` yields plain keys, so under a
chunk encoding context membership simply misses and the collapse declines, leaving the
pre-existing lowering untouched (fail-safe, no regression relative to today).

Nothing was NARROWED. A non-synth `dotPath` (`if=@signup.name`, `if=<#r>.loading`) fails the
`synthCellKeys` membership test and takes the byte-identical pre-existing path.

### REPRO_AFTER — the brief's five rows

| `if=` bound to | `#ctl` control | verdict |
|---|---|---|
| `@flag` | `"true"` | ok |
| `@signup.name` | `"true"` | ok (unchanged lowering) |
| `@signup.isValid` | `"true"` | ok — AND now actually mounts |
| `@signup.name.touched` | `"true"` | FIXED (was `""`) |
| `@signup.name.isValid` | `"true"` | FIXED (was `""`) |

Limb B drive-check after the fix: `@signup.submitted` and `@signup.name.touched` both mount on
`set(key, true)` and unmount on `set(key, false)`, and both now agree with their parenthesised
spelling.

### CORPUS EMIT DIFFERENTIAL — exit 1 (a VALID comparison), 1 artifact of 7388

Both sides captured from `git worktree add` project roots, so `chunkNamespaceToken` (which hashes
the PROJECT-RELATIVE source path) is identical on both sides and no phantom token diffs appear.

    base b0abcbc6  enumerated 1906 · compiled 1227 · emitted 7388 · checked 4430 · syntax-failing 66
    head 71bc503a  enumerated 1906 · compiled 1227 · emitted 7388 · checked 4430 · syntax-failing 66

    source set delta 0 · compile-failure delta 0/0 · diagnostics 0 code / 0 text
    artifact set delta 0 added / 0 removed · artifact CONTENT diffs 1 of 7388
    syntax delta 0 new / 0 fixed / 0 message-changed · load-context changes 0
    bare server-fn sites 144 -> 144 (delta 0)

The single changed artifact is `examples/30-validated-form.scrml` -> `30-validated-form.client.js`,
same byte length, and the whole diff is two lines:

    -  if ((_scrml_cs_reactive_get("signup").submitted))
    +  if ((_scrml_cs_reactive_get("signup.submitted")))

⚑ That is a SHIPPED FLAGSHIP EXAMPLE, and it was carrying limb B live: line 136,
`<p ... if=@signup.submitted>Account created.</p>` — the success confirmation on the canonical
validated-form example **never rendered**, at exit 0, with zero diagnostics, in every build. The
comment two lines above it says it "Reads the auto-synthesized @signup.submitted flag — true after
the [submit]". It did not.

DIRECTION_OF_CHANGE: **inert for every currently-working shape, newly-CORRECT for the broken one.**
Not a language widening — nothing newly compiles that did not compile before; 1906/1906 sources
enumerate, 1227/1227 compile, the diagnostic set is byte-identical, and exactly one emitted
lowering changed.

### BITE PROOF

With the collapse hunk disabled on the COMMITTED state (`const synth = null`, then restored via
`git checkout --`; no stash — there are two unrelated pre-existing stashes in this repo I did not
touch): **6 of 13 fail**. Both 3-level LIMB-A rows, the two lowering assertions, both LIMB-B drive
rows, and the `show=` row. Restored: 13/13 pass.

## 2026-08-24 — the flagship, executed on both sides

`examples/30-validated-form.scrml` compiled and EXECUTED against the shipped runtime chunk, same
probe, two compiler roots:

    base b0abcbc6 : emits reactive_get("signup").submitted  -> "Account created." after submit = FALSE
    head          : emits reactive_get("signup.submitted")  -> "Account created." after submit = TRUE

Pinned as a committed regression test inside the browser file (the corpus file itself, not a
fixture).

## 2026-08-24 — suite verification

Pre-commit hook scope is `compiler/tests/{unit,integration,conformance} + compiler/tests/*.test.js`
— it does NOT include `compiler/tests/browser/`. The browser tier is gated separately and by
FAILURE NAME SET, via `bun scripts/browser-baseline.ts --check`, which is what makes a browser test
merge-blocking here.

| gate | base b0abcbc6 | head |
|---|---|---|
| pre-commit hook scope | 29186 pass / 0 fail / 86 skip / 1 todo (1277 files) | 30222 pass / 0 fail (1277 files, +29 new tests) |
| `bun run test` (full, 1402/1404 files) | 30476 pass / **55 fail** / 216 skip | 30506 pass / **53 fail** / 216 skip |
| distinct failing test NAMES | 52 | 52 |
| `comm` on the two name sets | **0 new in head, 0 fixed in head — the sets are IDENTICAL** | |
| `browser-baseline.ts --check` | PASS (48 asserted) | PASS (48 asserted, unchanged) |

The 52 pre-existing failures are browser/dev-server/engine-runtime names, none on this surface, all
present on base. The 55-vs-53 count delta is duplicate test names across files, not a set change.

`bun scripts/types-gate.ts --check` reports 4 NEW diagnostics — ALL in `compiler/src/codegen/emit-each.ts`
(3) and `compiler/src/route-inference.ts` (1), neither of which is in this diff. PRE-EXISTING; the
gate is `continue-on-error` in the non-blocking CI `tracking` job.

`bun scripts/state.ts --check`: `@generated:gap-counts` regenerated (HIGH 53 -> 52), heading/marker
drift 0. `master-list.md` was restored to HEAD after `--write` touched it — its
`@generated:recent-sessions` was ALREADY stale at base (verified on the base worktree) and it is
PA-owned session state.

FINAL: base worktree at scratchpad/s372-base removed with `git worktree remove --force` + `prune`.

## 2026-08-24 — FIX ROUND (S239 adversarial, 5 findings). Round-1 direction-of-change claim was FALSE.

Reproduced finding 1 myself by execution before acting. All seven §55 shapes, pristine form, no
interaction, shipped runtime chunk:

| shape | value kind | base ctl | base mount@boot | round-1 | round-2 (landed) |
|---|---|---|---|---|---|
| `@signup.isValid` | boolean | "true" | false | false | false |
| `@signup.submitted` | boolean | "true" | false | false | false |
| `@signup.touched` | **OBJECT MAP** | "true" | false | **TRUE (regression)** | **false — byte-identical to main** |
| `@signup.errors` | **OBJECT MAP** | "true" | false | **TRUE (regression)** | **false — byte-identical to main** |
| `@signup.name.isValid` | boolean | "" DEAD | false | false | false |
| `@signup.name.touched` | boolean | "" DEAD | false | false | false |
| `@signup.name.errors` | array | "" DEAD | false | true | true |

FINDING 1 (blocker) — CONFIRMED, FIXED. The collapse is now gated on the cell's SHAPE. The
compound-level detector is DERIVED, not hand-listed: `collectSynthCellKeys` gives a compound parent
four keys and a field child three (no `submitted`, §55.7), so `<prefix>.submitted IN synthCellKeys`
IS the "prefix is a compound parent" test — gate and outcome read the same artifact (invariant 65).

DEVIATION, deliberate + flagged: per-field `.errors` is in neither of the correction's lists and is
not a scalar, but its base lowering is a DEAD PAGE, so "leave it inert" is unavailable. Collapsed;
reasoning recorded at the emit site.

Spelling divergence for the two object-map rows is PRE-EXISTING — base and fixed are byte-identical
on all four of `{@signup.touched, (@signup.touched), @signup.errors, (@signup.errors)}`. Pinned.

FINDING 2 — CONFIRMED PRE-EXISTING, NOT FIXED. `computeChainBranchCondition:647` is a fourth site.
My diff never touches it (`git diff b0abcbc6..HEAD` shows two hunks only, neither in that function).
The "three call sites share this rule" claim is corrected in the JSDoc, the gap entry and here.

FINDINGS 3/4/5 — all fixed. S299 doc block moved back onto `collapseSynthSurfaceRefsInRaw`; the
encoding-safety comment rewritten to the actual mechanism (membership HITS; `encode()` passes
through unregistered names and dotted synth keys are never registered) with the condition under
which it would break; the invalid-JS `tail: ".0.tag"` assertion replaced with an identifier-only
tail and the numeric-segment sharp edge recorded rather than enshrined.

### Re-verification at the fixed SHA

- CORPUS DIFFERENTIAL re-run, both sides from `git worktree add` roots: **REAL_EXIT=1 (VALID)**,
  1906/1906 enumerated, 1227/1227 compiled, **1 artifact content diff of 7388**, 0 diagnostic delta,
  0 syntax delta, 0 load-context change, bare server-fn 144->144. The surviving diff is the same
  `examples/30-validated-form.scrml` two-liner, same head hash `da8a859c…` as round 1. Nothing else
  appeared.
- BITE, on the COMMITTED state (no stash): collapse disabled -> **14 of 34 fail**; ONLY the
  rollup-map guard removed -> **6 of 34 fail** (both object-map lowering rows, both driven browser
  rows, the derived-split test, the divergence test). Restored: 34/34.
- `browser-baseline.ts --check`: PASS, 48 asserted, unchanged.
- `bun run test`: 52 distinct failing NAMES, `comm` vs base = **0 new, 0 fixed**.


## 2026-08-24 — ROUND 3 (S239 re-review). Both findings reproduced by execution. The gap is NOT fully closed.

### The axis neither earlier round had: the FIELD DECLARATION FORM

    form A  markup-typed   <name req length(>=2)> = <input type="text"/>   compound value {name: null}
    form B  literal-init   <name req length(>=2)> = ""                     compound value {name: ""}

A 3-level read derefs null under A and is merely `undefined` under B. Rounds 1 and 2 both measured
form A only and generalised. MEASURED, base b0abcbc6:

| form | shape | ctl | alive | gate | TypeErr |
|---|---|---|---|---|---|
| A | `@signup.name.errors` | `""` | false | false | **yes** |
| B | `@signup.name.errors` | `"true"` | **true** | **false — CORRECT** | no |
| A/B | `@signup.errors.length` | `""` | false | false | **yes** |
| A/B | `@signup.touched.name` | `""` | false | false | **yes** |
| A/B | `@signup.name.errors.length` | `""` | false | false | **yes** |

FINDING 1 — CONFIRMED, REVERTED. Collapsing per-field `.errors` improves form A from fatal->wrong
and DEGRADES form B from correct->wrong (permanently-visible error block; `[]` is as truthy as
`{}`). Declining is inert and reversible. Bare-read exclusion is now: `errors` at either level,
`touched` at compound level. Collapsing bare: `isValid` anywhere, `submitted`, per-field `touched`.

FINDING 2 — CONFIRMED, FIXED, and it was bigger than reported: THREE tail-bearing reads were dead
pages on both declaration forms, not one. Gate is now `isAlwaysTruthyShape && synth.tail === ""`.
All three boot.

### RESIDUAL — the gap entry no longer claims closure

`if=@field.errors` on a MARKUP-TYPED field is STILL A DEAD PAGE, exactly as on main. Named in the
gap entry, carried under the same operator ruling, and PINNED by a test asserting `ctl === ""` so it
flips loudly when the ruling closes it. Marker moved `status=resolved` -> `status=ruling-gated`
(counts OPEN; `partial` is not in the ledger's vocabulary and I did not add one — `ruling-gated`
tells a triager to get a ruling, not to dispatch a dev). @generated:gap-counts regenerated:
HIGH 52 -> 53. That is the honest number.

### Re-verification at 4a35c275

- CORPUS DIFFERENTIAL, both sides from `git worktree add` roots: **REAL_EXIT=1 (VALID)** ·
  1906/1906 enumerated · 1227/1227 compiled · **1 artifact content diff of 7388** · 0 diagnostic
  delta · 0 syntax delta · 0 load-context change · bare server-fn 144->144. Same flagship
  two-liner, same head hash `da8a859c...` as rounds 1 and 2. **No third artifact appeared** — the
  tail fix changed nothing in the corpus (no corpus file uses a tail-bearing rollup read).
- BITE, on the COMMITTED state, three INDEPENDENT levels (no stash):
    collapse disabled                      -> 22 of 45 fail
    shape gate removed                     ->  9 fail  (always-truthy rows + the two new r3 tests)
    ONLY the `tail === ""` term removed    ->  9 fail  (the tail rows)
  The last two failure sets are FULLY DISJOINT — both terms of the gate are independently proven.
- `browser-baseline.ts --check`: PASS, 48 asserted, unchanged.
- `bun run test`: 52 distinct failing NAMES, `comm` vs base = 0 new, 0 fixed.
- unit + conformance: 19383 pass, 0 fail.

### The lesson, recorded in the gap entry because it outlives the fix

WHEN A FIXTURE HAS A DECLARATION FORM, VARY THE DECLARATION FORM BEFORE CONCLUDING. Same shape as
the S368 miss (one comment position, generalised). Two consecutive adversarial rounds caught this in
work already verified by execution — the failure mode is not over-claiming, it is measuring ONE FORM
of a construct and generalising. The browser fixture is now parameterised on that axis.


## 2026-08-24 — ROUND 4 (S239 re-review). Two MEDIUM + one LOW, all reproduced by execution.

### FINDING 1 — `tail !== ""` was too loose. The tail must land on a SCALAR.

Fixture: a PRISTINE, FULLY-VALID form (`<signup> <name> = "" </>`, no validators), so a correct
gate is false and an always-true gate is visible.

| read | resolves to | base | round-3 branch | round-4 (landed) |
|---|---|---|---|---|
| `@signup.errors.name` | `[]` (errors rollup maps field -> ARRAY) | dead page | **GATE TRUE at boot** | declines -> base lowering |
| `@signup.touched.name` | `false` (touched rollup maps field -> BOOLEAN) | dead page | collapses, gate false | collapses, gate false |
| `@signup.errors.length` | `undefined` (container property) | dead page | collapses, gate false | collapses, gate false |

Same syntactic shape, opposite outcomes: the discriminator is the ROLLUP'S VALUE TYPE, not the
presence of a tail. DERIVED, not enumerated: `collectSynthCellKeys` emits
`<compound>.<field>.errors` for every field child, so `<prefix>.<tailSeg>.errors IN synthCellKeys`
IS "this tail segment names a field of this compound".

`if=@compound.errors.<field>` now takes the base lowering — the conservative side, per instruction,
over shipping a gate that can never be false. On a markup-typed field that is a dead page; NAMED in
the gap entry as a declined shape under the same ruling.

### FINDING 2 — null-guard slip, fixed by restructuring rather than reordering

`bun scripts/types-gate.ts --check`: **base 4 NEW, round-3 branch 5 NEW**, the extra being
`emit-event-wiring.ts :: TS18047 :: 'synth' is possibly 'null'`. Safe only by short-circuit
accident. The whole computation now lives inside `if (synth)`. **VERIFIED BACK TO 4 NEW.**

### FINDING 3 — the gap entry contradicted itself

Shape table said per-field `.errors` was "collapsed"; four lines below the prose said it does not.
That entry is the INPUT to the operator ruling, so the contradiction mattered more than its
severity. Row corrected.

### Re-verification at 68a99afe

- CORPUS DIFFERENTIAL: **REAL_EXIT=1 (VALID)** · 1906/1906 enumerated · 1227/1227 compiled ·
  **1 artifact content diff of 7388** · 0 diagnostic delta · 0 syntax delta · 0 load-context change.
  Same flagship two-liner, **same head hash `da8a859c` as rounds 1, 2 and 3** — the scalar-tail
  narrowing moved nothing in the corpus. No second artifact.
- BITE, on the COMMITTED state, FOUR levels (no stash):
    A  whole collapse disabled                  -> 23 of 48 fail
    B  entire shape gate removed                -> 11 fail
    C  ONLY the scalar-tail term removed        ->  2 fail  (both `errors.name` rows)
    D  ONLY tail-awareness removed              -> 10 fail  (the tail-bearing rows)
  **C and D are DISJOINT** (`comm -12` empty) — the two tail terms are independently proven.
  B is a SUPERSET of C by construction (B removes the whole gate, C removes one term of it); that
  is the correct relationship, not an overlap defect.
- `types-gate --check`: 4 NEW — the base number.
- `browser-baseline.ts --check`: PASS, 48 asserted, unchanged.
- `bun run test`: 52 distinct failing NAMES, `comm` vs base = 0 new, 0 fixed.
- unit + conformance: 19385 pass, 0 fail. Tiers: browser 25, unit 23.

### Running tally of what the adversarial rounds caught

r1 collapsed the compound rollup maps (regression) · r2 kept collapsing per-field `errors` on a
premise measured from ONE declaration form · r3 shipped a too-loose tail admitting
`errors.<field>`, plus a null-deref above its guard. Every round the prior cut was green on its own
tests. **The lesson that generalises across all four: a gate over a VALUE needs the value's TYPE,
and the type is not recoverable from the syntax of the read.**

## 2026-08-24 — ROUND 5 (S239 re-review). One fix, one comment, two ruling inputs carried.

### FINDING 1 — the tail test over-matched NESTED COMPOUNDS. Reproduced, fixed.

Fixture: `<signup> <addr> <city req length(>=2)> = "" </> <name req length(>=2)> = "" </>`

| revision | `if=@signup.errors.addr` | ctl | emitted cond |
|---|---|---|---|
| BASE b0abcbc6 | dead page | `""` | `get("signup").errors.addr` |
| HEAD r4 | dead page (INERT — identical to base) | `""` | `get("signup").errors.addr` |
| **HEAD r5** | **boots, gate correctly false** | `"true"` | `get("signup.errors").addr` |

`collectSynthCellKeys` emits `<compound>.<nestedCompound>.errors`, but the compound-level `errors`
ROLLUP keys only `fieldChildren` (emit-synth-surface.ts:220-232 EXCLUDES compound-typed children).
So a nested compound is REGISTERED yet is NOT a rollup key — `get("signup.errors").addr` is
`undefined`, a correct false gate, i.e. exactly where collapsing is right. The one-term test
declined it into a dead page.

Discriminator derived from the same artifact, as in round 2: `submitted` is compound-ONLY (§55.7).
VERIFIED on the fixture — registered keys include `signup.addr.submitted` and do NOT include
`signup.name.submitted`. That registration is now PINNED by its own test, because the discriminator
is unsound if it ever changes.

    seg names a FIELD  iff  <prefix>.<seg>.errors IN keys  AND  <prefix>.<seg>.submitted NOT IN keys

### FINDING 3 — `subscribeVars` comment corrected

Confirmed unused: sole reader tests `!== undefined` and discards the value (`:1961`/`:1967`); the
mount and ifGuard paths drop it. `_scrml_effect` dynamic tracking is what actually re-fires the
toggle, and it follows the collapse for free. Comment now says so and warns against both misreads.

### CARRIED, NOT DECIDED (both now in the gap entry)

- `?.` on the DECLINED path is a different question from the round-1 ban, which was about the
  COLLAPSE path. Recorded as a fourth ruling option: {always-true, never-true, diagnose,
  `?.`-on-declined-path-only}. NOT implemented.
- This change ENSHRINES the bare-vs-parenthesised divergence for the rollup rows — the gate plus its
  unit test now PIN it, so the "one predicate, one lowering" invariant this change cites as its own
  motivation is FALSE for `errors` / compound `touched`. Stated plainly in the entry.

### FINDING 5 — no action. Already filed as `g-else-if-dotted-cell-ref-emits-unregistered-flat-key` (#692).

### Re-verification at 6904b600

- CORPUS DIFFERENTIAL: **REAL_EXIT=1 (VALID)** · 1906/1906 enumerated · 1227/1227 compiled ·
  **1 artifact of 7388** · 0 diagnostic/syntax/load-context delta. Same flagship two-liner,
  **same head hash `da8a859c` for the FIFTH consecutive round**. The nested-compound narrowing moved
  nothing in the corpus.
- BITE, committed state, five levels (no stash):
    A  whole collapse disabled            -> 23 of 48 fail
    B  entire shape gate removed          -> 11 fail
    C  ONLY scalar-tail term              ->  2 fail
    D  ONLY tail-awareness                -> 10 fail
    E  ONLY nested-compound term          ->  2 fail
  **E is DISJOINT from BOTH C and D** (`comm -12` empty each). B remains a SUPERSET of C and E by
  construction — reported as containment, not claimed disjoint.
- `types-gate --check`: 4 NEW — the base number.
- `browser-baseline.ts --check`: PASS, 48 asserted, unchanged.
- `bun run test`: 52 distinct failing NAMES, 0 new / 0 fixed vs base.
- unit + conformance 19388 pass / 0 fail. Tiers: browser 26, unit 26.

### Five-round tally

r1 collapsed the compound rollup maps · r2 kept collapsing per-field `errors` on a premise measured
from ONE declaration form · r3 shipped a too-loose tail plus a null-deref above its guard · r4
over-matched nested compounds. Every round the prior cut was green on its own tests. **The
through-line: a gate over a VALUE needs the value's TYPE, and the type is never recoverable from the
syntax of the read** — not from the leaf name, not from the declaration form, not from the presence
of a tail, and not from key-registration alone.


## 2026-08-24 — ROUND 6 (final). COMMENT-ONLY. The "three callers share one rule" claim was FALSE.

REPRODUCED before encoding it. Fixture `<signup> <errors req> = "" </>` — a compound with a field
literally NAMED like a synth property, so `signup.errors` is registered BOTH as the compound rollup
AND as that field's namespace. Registered keys measured:
`signup, signup.errors, signup.errors.errors, signup.errors.isValid, signup.errors.touched,
signup.isValid, signup.submitted, signup.touched`.

    if=@signup.errors.isValid     ->  get("signup.errors").isValid     WRONG (reads off the rollup MAP)
    if=(@signup.errors.isValid)   ->  get("signup.errors.isValid")     CORRECT

TWO production implementations, different resolution orders:

| impl | callers | algorithm |
|---|---|---|
| `resolveSynthCellPrefix` | raw-string fallback, `if=`/`show=` toggle | EARLIEST registered prefix |
| `synthDottedKey` | `emitMember` | LONGEST key first |

They agree wherever only one prefix is registered — which is why it went unnoticed — and diverge
exactly on the field-named-like-a-synth-prop shape. **On that shape `emitMember` is RIGHT and the
helper this branch exported is WRONG.**

The harm was the COMMENT, not the code: it told the next author the drift was closed while a
divergent copy lived one file away. Both the JSDoc and the unit-test `describe` now carry the count,
the two algorithms, the divergent shape with measured emissions, and which one is correct. The
JSDoc closes on the standing hazard instead of a reassurance: *this export reduced N; it did not
make N equal 1.*

NOT UNIFIED, deliberately — moving `emitMember` onto the shared helper reaches into the AST member
path with its own blast radius. Filed separately by PA.

### Verification at 65d113d7

- **NO NEW BITE RUN, AND THAT IS THE CORRECT CALL, NOT AN OMISSION.** This round changes no
  behaviour, so a bite would prove nothing about it. The five behavioural bite levels from rounds
  1-5 stand unchanged at this SHA.
- COMMENT-ONLY VERIFIED MECHANICALLY: the diff filtered to non-comment lines is EMPTY for
  `emit-expr.ts`; the only non-comment edit in the whole round is one `describe` TITLE in a unit
  test (a passing test, so it enters no failure set).
- CORPUS DIFFERENTIAL: **REAL_EXIT=1 (VALID)** · 1906/1906 · 1227/1227 · **1 artifact of 7388** ·
  0 diagnostic/syntax/load-context delta. Same flagship two-liner, **`da8a859c` for the SIXTH
  consecutive round** — comment-only edits moved nothing, as required.
- `types-gate --check`: **4 NEW** — the base number.
- `browser-baseline.ts --check`: PASS, 48 asserted, unchanged.
- `bun run test`: 52 distinct failing NAMES, 0 new / 0 fixed vs base.
- unit + conformance 19438 tests, 0 fail. Tiers: browser 26, unit 26.

## ARC CLOSED — what this branch actually produced

Five build rounds, six reviews, real defects found in every one. The fix is 2 source files; the
durable output is two DERIVED discriminators that replaced rules a human would have enumerated:

    compound parent      <prefix>.submitted IN synthCellKeys        (§55.7 gives `submitted` to parents only)
    field vs nested cmpd <prefix>.<seg>.errors IN keys
                    AND  <prefix>.<seg>.submitted NOT IN keys

Both read the SAME artifact the collapse reads, so gate and outcome cannot drift (invariant 65).

**The one lesson: a gate over a VALUE needs the value's TYPE, and the type is never recoverable
from the syntax of the read** — not from the leaf name (r1), not from the declaration form (r2/r3),
not from the presence of a tail (r4), not from key-registration alone (r5). Four instances of one
mistake, each caught only by executing a varied fixture.
