# D3 conformance-suite extraction — SCOPE

**Change-id:** `conformance-suite-d3-2026-06-29`
**Status:** SCOPING (W1 design crux RATIFIED S231; remaining OQs scoped below)
**Authority:** the V1 = scrml-language-1.0 reframe — `scrml-support/docs/deep-dives/language-compiler-split-2026-06-29.md` (D3 RATIFIED: the language contract = which diagnostic CODES fire + the RUNTIME effect; message text / emitted-JS shape / AST = impl freedom).
**Why this is load-bearing:** the conformance suite IS the Road-B de-risking oracle (native impl#2 is correct iff it passes it) AND it operationally *defines* the scrml-language-1.0 surface (what's in 1.0 = what the suite requires). It dissolves the native-cutover breaking-change. This is THE build of the split.

---

## 1. The substrate (grounded S231 — "promote + label," not greenfield)

The conformance machinery already exists in seed; the net-new is the *agnostic extraction* + the *runtime-effect layer* + the *version labels*.

| Asset | Today | For D3 |
|---|---|---|
| `compiler/tests/conformance/**` (109 test files; incl. `block-grammar/conf-001..047`) | `*.test.js`: a `source` snippet + POS/NEG assertions on `errors.some(e => e.code === "E-X")`, driven by `compileScrml()` (`src/api.js`) + `bun:test` | the *(source → expected-codes)* pairs ARE the agnostic contract — embedded in JS bodies coupled to impl#1's API |
| `parser-conformance-within-node*` + `within-node-classifier.ts` + allowlist JSON | the proto cross-impl parity oracle (two impls agree per-node) | the seed of the parse-level conformance + the existing agnostic-JSON precedent |
| ad-hoc runtime checks (conf-AUTH-003, conf-LOOP-006/7, conf-error-boundary — happy-dom/`.toBe`) | partial, unsystematic behavioral coverage | the seed (but NOT a systematic layer) for the (b) half |

**The asymmetry that shapes the build:** the **(a) "which codes fire"** half is ~done (109 files of *source→codes* to *lift*, not author). The **(b) "runtime effect"** half — D3-ratified as equally load-bearing — is barely seeded and is the real design + authoring work.

> **⚠ CORRECTED by the W2 pilot (S231 — see §6).** The "109 files of source→codes to lift" framing was optimistic by **~3–4×**. The empirical pilot found only **~29** of the 109 actually call `compileScrml` (have a real codes-contract); the other **~80 import `splitBlocks` and assert impl#1-INTERNAL parse-structure** (`blocks[0].type`, `.name`, `.closerForm`) — which is **explicit impl freedom per D3** (impl#2-native has no `splitBlocks`), so they carry NO agnostic codes-contract. They must be triaged: re-express as a (b)-runtime-DOM assertion, or EXCLUDE as impl-internal. **This SHARPENS the asymmetry, not softens it:** the (a)-codes corpus is even smaller than thought (~29), and the real conformance contract is overwhelmingly the (b)-runtime half (which lives today in the separate `compiler/tests/browser/*` twins). The pilot PROVED the format + adapter end-to-end (15/15).

## 2. W1 — the case format + adapter interface (design crux)

**Runtime-effect vocabulary — RATIFIED S231 (user "Final DOM + state snapshot"):** a case asserts the **normalized final rendered DOM + final state-cell values** at the scrml-semantic level (`cell x = 5`; `#foo` text = `"hi"`), after an optional declared input-event sequence. Trace-ordering (full effect-trace) is DEFERRED to v1.next (the ordering-sensitive deepening). Pure-evaluation-only was REJECTED (too thin for a UI language).

**Case shape (the agnostic contract):**
```
case = {
  source:          <scrml source>,
  language-version: 1.0 | deprecated | future,   // D2 partition; the 1.0 subset DEFINES the surface
  expect: {
    codes:   [ "E-X", "W-Y", ... ],              // (a) — code-SET presence (see OQ3)
    input:   [ <event>, ... ]?,                  // optional driver: click #btn, type "x" into #f, ...
    dom:     <normalized final DOM>?,             // (b) — final rendered tree, scrml-semantic-normalized
    state:   { cell: value, ... }?,              // (b) — final state-cell values
  }
}
```

**Adapter interface (what an impl must expose — minimal):**
```
compile(source) -> { codes: string[], artifact }     // (a) + the runnable
run(artifact, input[]) -> { dom, state }             // (b) — drives events, reads final dom+state
```
Impl#1 (TS) implements this over `compileScrml` + happy-dom (it already has both). Impl#2 (native) implements the same two functions — that IS the Road-B gate (W5).

**OQ2 — serialization (lean, scope-level):** one directory per case, `case.scrml` (real source — opens in editor/LSP, is itself dog-food) + `expected.json` (codes + input + dom + state + version). Precedent: the within-node allowlist is already JSON. Rejected: one mega-manifest with source-as-string (awkward, un-LSP-able).

**OQ3 — diagnostic-match granularity (lean, scope-level):** **code-SET presence**, NOT line/col position. The 109 existing tests already assert presence (`errors.some(e => e.code === X)`); D3 ratified text/shape/AST as impl freedom, and code *position* is the same class (different parsers legitimately attribute a code to slightly different loci). The contract = "this source fires exactly this code-set." (A future tightening to presence-at-locus is a v1.next option, not v1.0.)

## 3. The waves

| W | What | Shape | Est |
|---|---|---|---|
| **W1** | the case format + adapter interface (§2) | design — **crux RATIFIED**; OQ2/OQ3 leans above | small (design) |
| **W2** | lift the 109 *(source→codes)* into the format; the impl#1 adapter must reproduce the current pass/fail set EXACTLY (extraction is correct iff impl#1 still goes green) | mechanical / **sPA-able** | medium (bulk, low-risk) |
| **W3** | the systematic runtime/behavioral layer — author final-DOM+state cases for the core surface (reactive cells, engines, match, each, forms, errorBoundary, server-fn effects) | **net-new authoring** | large (the real work) |
| **W4** | language-version labeling (D1/D2): the `language` field in chunks.json (D1) + per-case `language-version` tags; the 1.0-labeled subset DEFINES the surface; known-gaps Nominal list → "v1.next" | wiring | small-medium |
| **W5** | the Road-B gate (D5): native impl#2 implements `compile`/`run`; "native is correct iff it passes the 1.0 suite" | native-era | (consuming milestone) |

**Critical-path note:** W1→W2 proves the extraction mechanism (impl#1 reproduces green) cheaply; W3 is where the contract gains its teeth (the (b) half no current test systematically covers). W2 is the safe first dispatch; W3 is the design-heavy core.

## 4. Open questions (downstream — do NOT block W1/W2)

- **OQ5 — where the suite lives.** Today: in `scrml/` (impl#1's repo) under e.g. `conformance/` (top-level) or `compiler/conformance/`. It is impl-AGNOSTIC content, so its *eventual* home is a dedicated language-spec artifact owned by the **language-PA** (the PA-mitosis stem). RESOLUTION: build it in `scrml/` now; relocate when the artifact-split lands (gated, per the genome-preservation guardrail). Don't pre-split the repo before the chromosomes are ready.
- **OQ-runtime-normalization** (W3 detail): the exact DOM-normalization rules (whitespace, attribute order, scrml-runtime wrapper elements stripped) so two impls' DOM compare equal at the scrml-semantic level — a W3 design sub-task, not a W1 blocker.
- **OQ-deprecation cases** (D4): a `deprecated`-labeled case asserts the W-lint fires AND the program still runs (accept-with-warning) — folds into W4.

## 5. What this is NOT (scope guard)

- NOT a rewrite of the 109 tests' INTENT — it's a *lift* of their (source, codes) into an agnostic format; impl#1 must stay green throughout (the within-node-allowlist re-baseline discipline applies if any fixture AST shifts).
- NOT the native parser build (that's W5 / Road-B, native-era — this suite is its *precondition*).
- NOT message-text / JS-shape / AST conformance (explicit impl freedom per D3).

## 6. W2 pilot — result + corrected scope + follow-on decisions (S231)

**Pilot LANDED (S231).** Format + impl#1 adapter + runner built; **15/15 cases pass** against impl#1 (7 categories: input/loop×2/auth/error/block-grammar×2/codegen/form-for); existing 109 conformance files 443→0 fail (zero regression); pre-commit gate green throughout. Layout: `conformance/{cases/<cat>/<id>/{case.scrml,expected.json}, adapters/impl1-ts.ts, run.ts, conformance-corpus.test.js, README.md}`. Matching = **superset/disjoint** (`emitted ⊇ codes` AND `emitted ∩ notCodes = ∅`) — the incidental-code noise (every real compile emits `W-PROGRAM-*`/`W-WHITESPACE-001`/etc.) makes exact-set matching impossible; the adapter unions `.code` across BOTH `result.errors` and `result.warnings` (the S92/S93 two-stream partition is load-bearing).

**W3 design now RATIFIED** — see `scrml-support/docs/deep-dives/conformance-runtime-layer-design-2026-06-29.md` (DD, RATIFIED-DIRECTION S231): the `run()` adapter = execute-in-DOM + serialize normalized post-run `<body>` + 7 selector-verbs + a `globalThis.__scrml_conformance` snapshot/settled hook; authoring = lift browser twins → golden-capture+mandatory-spec-review → hand-author flagship; within-node parity stays OUT of the contract; OQ1 DOM-mode default deferred to build-time. **W3 PILOT LANDED S231** (delta-log [228]): 22/22 (15 (a)-codes + 7 (b)-runtime P0 twins); `normalize.ts`/`driver.ts`/`run()` built; both DOM modes shipped per case. **OQ3 refinement:** the hook is **adapter-provided** (reaches `_scrml_state` via the harness), NOT in `runtime-template.js` → zero runtime change, contract interface identical (to confirm). **OQ1 RESOLVED S231** (P0 consolidation, delta-log [229]): **`domAnchored` is the DEFAULT contract; whole-tree `dom` = supplementary total-coverage snapshot.** Evidence across 28 (b)-cases: whole-tree leaked impl#1-private structure in 4 classes (if-guard `<template>` counter-ids · each/match container `<div>`s · inter-interp space collapse · impl-freedom validator messages) that the normalizer can't dissolve without becoming impl#1-shaped; `domAnchored` hit none (impl-neutral by construction). **Corpus 22→51, GATED** (D-1 done: `compiler/tests/conformance/corpus-bridge.test.js`), schema complete (`notCodePrefixes`/severity/`files`). The suite already FOUND A BUG (`g-inline-value-match-in-text-interp-empty`, MED — silent footgun) via the OQ4 honesty mechanism.

**Schema extensions the full lift needs (pilot-surfaced):**
- `notCodePrefixes` — several conf tests assert absence of a whole family (`!e.code.startsWith("E-FORMFOR-")`); `notCodes` (exact) can't express it.
- **per-code `severity`** — the code-set model LOSES severity sub-assertions (`conf-CG-001-warn` also asserts `severity==="warning"`). If the §34 error/warning partition is normative (it is — S92/S93), the schema needs a per-code severity field.
- **multi-file case-dir convention** — cross-file/import fixtures (form-for imports `scrml:data`; `mkdtempSync` multi-file) don't fit the single-`case.scrml` shape.

**FOLLOW-ON DECISIONS (PA/user):**
- **D-1 — test-discovery wiring.** `bunfig.toml` `[test] root = "compiler/tests/"` EXCLUDES the top-level `conformance/`, so the corpus test does NOT run in the pre-commit gate (it runs only via explicit `bun conformance/run.ts`). For the corpus to be a real GATE: (a) add `conformance/` to a test root, (b) a thin bridge test under `compiler/tests/` that invokes the corpus runner, or (c) a separate CI step. **PA lean: (b)** — lowest-touch, no global-config change, rides the existing gate. *(Pilot landed un-gated — runs on-demand, verified 15/15; gating is the follow-on.)*
- **D-2 — full-lift approach** given the ~29-not-109 correction: triage the ~29 codes-liftable (most assert OUTPUT-SHAPE = impl freedom, so their only codes-half is "compiles clean"; their real contract is the (b)-runtime half via the browser twins) + decide the ~80 splitBlocks tests' disposition (re-express-as-(b) vs exclude-as-impl-internal). This re-weights the build toward the (b)-runtime layer (W3) sooner than W2's "lift everything first" implied.
  - **D-2 RESOLVED (S232, PA — Rule-4 classification, not a user fork).** Empirical count on HEAD: **80** conformance test files import `splitBlocks`, asserting impl#1-INTERNAL parse structure (`blocks[0].type` ×30 · `blocks[0].name` ×26 · `blocks[0].closerForm` ×8 · `blocks[0].raw` ×2 = 66 pure parse-structure assertions); **26** call `compileScrml` (the real codes-contract); 110 total. **Disposition:**
    1. **The 80 `splitBlocks` tests = EXCLUDE from the agnostic `conformance/` corpus.** They assert impl#1's own block-splitter output shape (`type`/`name`/`closerForm`/`raw`) — explicit **D3 impl freedom** (impl#2-native has no `splitBlocks`; it has its OWN parser-conformance + the within-node parity oracle). They STAY as impl#1's `compiler/tests/conformance/**` unit tests; they are NOT lifted. Lifting them would bake impl#1's parse-internals into the language contract — the exact thing D3 forbids.
    2. **The 26 `compileScrml` tests = the (a)-codes-liftable set** (the W2 mechanism; the pilot lifted 15, ~11 remain). Most assert OUTPUT-SHAPE (impl freedom), so their agnostic codes-half is thin ("compiles clean") — their real contract is the (b)-runtime effect.
    3. **The contract is overwhelmingly the (b)-runtime half.** Confirms the re-weight: prioritize W3 (b)-runtime authoring (the browser-twin lift — P1 in flight: errorBoundary/components/lifecycle; the NET-NEW center is server-fn §52 + channels) over finishing the (a)-codes lift. A splitBlocks test whose UNDERLYING INTENT is a language behavior (not parse-structure) is covered by re-expressing that behavior as a (b)-runtime case from its browser twin — NOT by lifting the splitBlocks test.

## Authority + cross-refs
- Deep-dive (the reframe + D3 ratification): `scrml-support/docs/deep-dives/language-compiler-split-2026-06-29.md` §3 (D1–D5) + §10 (ledger).
- W3 runtime-layer design (RATIFIED-DIRECTION S231): `scrml-support/docs/deep-dives/conformance-runtime-layer-design-2026-06-29.md`.
- The v1.0 fail-closed-Nominal invariant (companion robustness rule): same deep-dive §4 criterion 3 + known-gaps `g-nominal-foreign-forms-not-failclosed`.
- delta-log: the build-scoping entry (S231).
- Existing substrate: `compiler/tests/conformance/**`, `compiler/tests/parser-conformance-within-node*`, `compiler/src/native-parser-canary/within-node-classifier.ts`.
