# progress — sym-diagnostic-fixes-s277

Agent `scrml-js-codegen-engineer` · isolation `worktree` · base `origin/main` @ `499dd740`.
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a326fdd820bdfbd7d`

WRITE-SET: `compiler/src/symbol-table.ts` + tests + this dir. `compiler/SPEC.md` and
`compiler/src/block-splitter.js` are OWNED BY A SIBLING DISPATCH — not touched.

## Unit 0 — startup verification

- `pwd` = worktree root, `git rev-parse --show-toplevel` matches, tree clean, HEAD `499dd740`. PASS
- `bun install` exit 0. `bun run pretest` exit 0.
- Maps read: `primary.map.md` -> `domain.map.md` + `error.map.md` (Task-Shape Routing for a
  compiler-diagnostic task). Load-bearing: yes — see report.
- BRIEF.md archived into this dir.

## Unit log

### Unit 1 — PART 1: nested `<program>` resets `inRouteScope` (§4.12.1)

- **Defect reproduced on base** with a scratch compile before any edit (the "verify the premise
  empirically" rule). `<program><outlet/><div><program name="w"><outlet/><main>…` fired
  `E-OUTLET-AND-MAIN` ×1 at line 4; the identical inner shell wrapped in `<page>` instead of `<div>`
  fired ZERO. Confirmed with and without the `name="w"` attribute — the attribute is irrelevant and
  parses clean.
- **Tests written FIRST**, run RED: exactly one failure (k02), k01 + the case-3 guard already green.
  That is the revert-check evidence, captured before the fix rather than reconstructed after.
- **Fix**: `childInRouteScope` now short-circuits to `false` at a `<program>` boundary — the missing
  twin of the `childOpenMains` reset immediately above it. Commented with the §4.12.1 citation and
  the k01/k02 pair so the symmetry with the open-mains reset is legible.
- **No false-positive risk from the reset**: `E-OUTLET-AND-MAIN` fires only for a shell that is
  present in `byShell` (i.e. actually contains an outlet), so a nested `<program>` carrying a
  `<main>` but NO outlet cannot begin to fire. Verified at the fire site (symbol-table.ts :10178-86)
  before editing, not assumed.
- Added a third test guarding the other direction: a `<page>`-scoped `<main>` nested in plain
  elements (no inner shell) must STILL be exempt — the reset must key on `<program>`, not on depth.
- Result: 45 pass / 0 fail in `navigate-wave1c-outlet-composition.test.js`.

### Unit 2 — corpus measurement, shape (a)

Naive scan said 20 hits. It was WRONG: it counted `<program>`/`<page>` appearing inside `//`
comments and string literals — `examples/08-chat.scrml` has exactly ONE real `<program>` (line 17)
and scored as nested purely on its header comment, and the `compiler/native-parser/*.scrml` sources
are parsers that carry these tag names as DATA. Re-scanned with comments + string literals blanked
(offsets preserved so line numbers stay true):

**SHAPE (a) = 0 real occurrences across 3091 `.scrml` files** (worktree + `scrml-support` +
`scrml-native`). No migration. Recording the wrong first number deliberately — "assumed-zero is not
measured-zero" cuts both ways, and an unfiltered grep is not a measurement either.

### Unit 3 — PART 2: `E-CELL-RENDER-SPEC-NOT-BINDABLE` fires at the DECLARATION

- **Defect + trap both reproduced on base before editing.** `<plain> = <span>yo</span>` with
  `${@plain}` and with no use: ZERO diagnostics, `_scrml_reactive_set("plain", null)`, `yo` absent
  from the HTML — markup silently discarded. With `<plain/>`: 1 diagnostic, at the USE (line 3).
  And the trap, confirmed empirically rather than taken on faith: the LEGAL
  `<userName req> = <input type="text"/>` emits the byte-identical
  `_scrml_reactive_set("userName", null)`. Keying on the RHS shape or on emitted output would have
  rejected every form input in the corpus.
- **Implementation**: new PASS 5a `walkNonBindableMarkupDecls` (recursion mirrors `walkClassifyCells`
  exactly, so it reaches every decl B5 classified, compound children included), gated on
  `getCellKind(decl) === "markup-typed" && decl.isConst !== true`. `isConst === true` (Shape 3) is
  the SPEC-named remediation and is left alone. The Phase 0 §3.2 PascalCase-component deferral is
  mirrored from `checkRenderByTag` — tightening one side only would make decl and use disagree.
- **No double-fire**: the use-site fire in `checkRenderByTag`'s `markup-typed` non-const branch is
  removed, not supplemented. `makeNotBindableDiagnostic` re-anchored to the decl span. Pinned by two
  tests: one `<plain/>` use -> 1 diagnostic; THREE `<plain/>` uses -> still 1 (under the old rule
  that shape emitted 3).
- **No lowering change.** The ruling REVERSAL recorded in `markup-cell-nonconst-lowering/BRIEF.md`
  is honoured: a non-`const` cell still cannot hold markup. This is the diagnostic fix only.
- Tests: 12 new SYM-level cases (`render-by-tag.test.js` §B6.19) + a new integration file asserting
  EMITTED code, because the two regression guards are claims about codegen that a SYM test cannot
  make — the Shape 2 guard asserts the `bind:value` dispatch survives
  (`addEventListener("input"` + `_scrml_reactive_set("userName", event.target.value)`), the Shape 3
  guard asserts the markup factory + `_scrml_derived_declare` survive. Absence-of-error alone would
  score a silently-dropped binding as green.
- Result: 31 pass unit / 7 pass integration / conformance 1272 pass 0 fail (incl.
  `forms/compound-render-not-bindable`, which asserts the code only and still fires — now from the
  compound CHILD decl rather than the wrapping-form use site).

### Unit 4 — corpus measurement, shape (b)

Scanned the same 3091 `.scrml` files for a non-`const` decl with a non-bindable markup RHS
(comments + string literals blanked first; `B5_BINDABLE_TAGS` mirrored from `symbol-table.ts`;
PascalCase RHS classified as the deferred component case, not an offence):

- markup-RHS decls that are bindable or component (legal): **94**
- **SHAPE (b) — newly rejected: 1**, and it is
  `conformance/cases/forms/compound-render-not-bindable/case.scrml` — the conformance case that
  asserts this very error. **Zero adopter-facing occurrences.** That case still passes: its
  `expected.json` asserts the CODE only (no line/span pin), and the decl walk descends compound
  children, so the code still fires — from the child decl rather than the wrapping-form use site.

### Unit 5 — empirical verification

**Full suite, failure-SET diff (not just counts).** Base measured directly by checking out
`499dd740` into a throwaway worktree rather than trusting the briefed number.

- base `499dd740`: 28521 pass / 216 skip / 1 todo / **38 fail**
- tip `ad95428d`: 28544 pass / 216 skip / 1 todo / **36 fail**

Set diff: the ONLY delta is two base-only failures, both
`TodoMVC … dist not compiled / dist files exist`. Those are the gitignored-`dist` env gap in a
freshly-created worktree (a test-ordering artifact — re-running the browser suite in that same base
tree after `benchmarks/todomvc/dist/app.html` existed shows them passing). Nothing tip-only.
**Comparable base = 36; failure set IDENTICAL; zero new failures, and no pre-existing failure
silently "fixed" either.** The briefed baseline of 36 is confirmed.

**Revert-check** (base compiler + the NEW test files, run in the base worktree): **10 of the new
tests go RED**, regression guards stay green.
- Part 1: k02 red (k01 + the case-3 guard green on base — they are guards, not new behaviour).
- Part 2: 9 red. Note the discrimination: "fires exactly ONCE with one `<plain/>` use" PASSES on
  base (base fired once, at the use site) — it is the THREE-use variant that goes red, because base
  emitted 3. That is why the 3-use test exists; the 1-use form cannot tell the two rules apart.

**R26** — `docs/website` + `examples/23-trucking-dispatch`, base compiler vs tip compiler with the
corpus SOURCES held fixed so the compiler is the only variable. Both trees asserted non-empty before
comparing, per the false-green `DIFF: NONE` failure mode:
- `docs/website`: 98 sources -> 295 emitted files (both runs)
- `examples/23-trucking-dispatch`: 36 sources -> 115 emitted files (both runs)
- 571-line manifest each (sha256 per emitted file + every diagnostic from BOTH streams —
  `result.errors` and `result.warnings`): **DIFF: NONE**.
- **ZERO occurrences of `E-CELL-RENDER-SPEC-NOT-BINDABLE` or `E-OUTLET-AND-MAIN`** on either
  corpus. No adopter-facing migration.

Temporary base worktree removed; `git worktree list` clean.
