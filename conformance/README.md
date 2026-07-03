# scrml conformance suite (D3)

Impl-agnostic conformance cases for **scrml-language-1.0**. The contract a case
asserts is the *language* contract per the language/compiler split (D3): the two
normative halves are **(a) which diagnostic CODES fire** and **(b) the RUNTIME
EFFECT** (normalized final DOM + final state-cell snapshot after an optional
input sequence). Message text, emitted-JS shape, and AST are explicit **impl
freedom** and are NOT asserted here.

Change-id: `conformance-suite-d3-2026-06-29`.
Authority: `docs/changes/conformance-suite-d3-2026-06-29/SCOPE.md` +
`scrml-support/docs/deep-dives/conformance-runtime-layer-design-2026-06-29.md`
(the W3 (b)-runtime layer design, RATIFIED S231).

## Layout

```
conformance/
  cases/<category>/<case-id>/
      case.scrml       real scrml source (opens in editor/LSP; itself dog-food)
      expected.json    the agnostic contract (codes + runtime effect + provenance)
      *.scrml          (optional) aux import fixtures — the `files` convention
  adapters/impl1-ts.ts compile() + run() over the TS reference compiler (impl#1)
  driver.ts            the 7-verb selector-addressed input vocabulary (OQ2)
  normalize.ts         the DOM normalization pipeline + anchored runner (OQ1)
  run.ts               loads + checks every case; exits non-zero on failure
  conformance-corpus.test.js   bun:test wrapper (one test() per case)
```

The GATED entry point is `compiler/tests/conformance/corpus-bridge.test.js` — a
thin bridge that lives UNDER bunfig's `[test] root = "compiler/tests/"` and runs
the corpus on the existing pre-commit gate (this top-level dir is outside that
root, so it is not auto-discovered; the bridge wires it in without touching
`bunfig.toml`).

## The adapter — `run(artifact, input[]) -> { dom, state }`

impl#1 realizes the W1 adapter as three thin shims over machinery that already
exists (the browser-harness is a working prototype of two-thirds of it):

- **(OQ1) execute + serialize.** Compile the source, mount the `<body>` in
  happy-dom, eval `runtime + client`, settle, then serialize the normalized
  POST-run `<body>`. **HARD INVARIANT: the (b) half reads the POST-run LIVE DOM,
  never the static `.html`** — interpolation slots are empty until hydration.
  The conformance run EXECUTES the artifact; it never string-compares emitted
  HTML/JS (both impl freedom).
- **(OQ2) drive inputs.** The 7-verb selector-addressed vocabulary (below).
- **(OQ3) read state.** A sanctioned `globalThis.__scrml_conformance` hook —
  `snapshot(): {cells, derived}` + `settled(): Promise` — keyed by scrml-SOURCE
  cell names, conformance-mode-gated (zero production bytes; injected inside the
  eval'd IIFE). impl#2 implements the same signature over its own model.

## `expected.json` schema

```jsonc
{
  "id": "reactive-counter-increment",
  "description": "one line",
  "language-version": "1.0",                 // "1.0" | "deprecated" | "future" (D2)
  "source-test": "compiler/tests/...test.js",// provenance (a lifted twin)
  "spec": "§6.1",                            // MANDATORY for (b) cases (OQ4 soundness gate)
  "rationale": "what §6.1 says should happen",// MANDATORY for (b) cases
  "expect": {
    // (a) codes half --------------------------------------------------------
    "codes":          ["E-INPUT-001"],       // PRESENCE (superset, not line/col)
    "notCodes":       ["E-IMPORT-006"],      // ABSENCE (exact code)
    "notCodePrefixes":["E-FORMFOR-"],        // ABSENCE of a whole family (glob)
    "severity":       { "W-CG-001": "warning" }, // per-code §34 partition assertion
    // (b) runtime-effect half ----------------------------------------------
    "input":       [{ "click": "#inc" }, { "click": "#inc" }],
    "state":       { "count": 2 },           // merged {cells, derived} ⊇ this
    "dom":         "<button id=\"inc\">+</button>...",  // whole-tree normalized <body>
    "domAnchored": [{ "selector": "#display", "text": "Count: 2" }],
    // (b) §52 server-fn responses — keyed by the IMPL-NEUTRAL source fn name ----
    "serverStub":  { "loadTasks": [{ "id": 1, "text": "a" }] }
  }
}
```

### (a) Codes-half matching (load-bearing)

- `codes` / `notCodes` — `emitted ⊇ codes` AND `emitted ∩ notCodes = ∅`. A
  **superset/disjoint** check, NOT exact-equality: real compiles emit incidental
  codes (`W-PROGRAM-*`, `W-SQL-ROW-UNTYPED`, …) the source conf tests ignore.
- `notCodePrefixes` — family-glob ABSENCE: no emitted code may start with any
  listed prefix (e.g. `["E-FORMFOR-"]` asserts the whole `E-FORMFOR-*` family
  stays silent).
- `severity` — per-code §34 SEVERITY (`"error" | "warning" | "info"`). The
  adapter's `byCode` honors the partition: the errors stream is the fatal
  partition (CLI exit 1); the warnings stream carries both `warning` and `info`.
  This is the **cross-stream-honest** assertion — `severity: {"W-CG-001":"error"}`
  FAILS (it is a warning), catching the `result.errors.filter(...)` silent-pass
  trap. The adapter unions codes across BOTH streams (a `W-`/`I-` code lands only
  in `result.warnings`).

### (b) Runtime-half matching

A case has a runtime half when `expect` carries any of `input` / `dom` /
`domAnchored` / `state`. Then:

- `state` — the merged `{cells, derived}` snapshot is a **superset** of `expect.state`
  (assert only the cells you care about). Keyed by author-visible scrml cell
  names (`count`, `signup.name.isValid`). Payload variants snapshot as
  `{ variant, data }`; non-payload variants as bare strings; absence as `null`
  (never `undefined`).
- `dom` — whole-tree canonical normalized `<body>` (OQ1 default mode), compared
  byte-for-byte.
- `domAnchored` — per-selector assertions (`{selector, text?|count?|attr?}`) on
  the live `<body>` (OQ1 brittleness escape / authoring surface).

**Author BOTH `dom` and `domAnchored`** (this is how OQ1 is resolved
empirically). See the OQ1 note below for when to reach for each.

### Input vocabulary (OQ2 — 7 selector-addressed verbs)

```jsonc
{ "click":   "#inc" }                  // bubbling click
{ "input":   "#field", "value": "ab" } // set value + fire `input`  (text/range)
{ "change":  "#sel",   "value": "x"  } // set value + fire `change` (select)
{ "check":   "#agree" } / { "uncheck": "#agree" } // set checked + fire `change`
{ "submit":  "#form" }                 // bubbling `submit`
{ "key":     "#field", "press": "Enter" } // keydown + keyup for a named key
{ "wait":    "settle" }                // await the hook's settled() (async drain)
```

Inputs are USER-INTENT events flowing through the handlers BOTH impls wire.
Direct state-set is **banned** (it bypasses handlers + names impl internals).
Real-time waits are banned (non-deterministic); only `wait: "settle"`.

### Server-fn stubs (`serverStub`) — the §52 (b)-runtime center

A scrml `function` that touches a server resource auto-escalates to server
(§12): the client call compiles to a `fetch` to a **compiler-emitted server
route**, and the server handler runs the body. The conformance harness has no
real server (happy-dom), so a case declares the server responses in
`serverStub`, and the adapter installs a deterministic mock `globalThis.fetch`
over the server-fn routes for the run (restored after). `settled()` drains the
pending server-fn promise so the state hydrate completes before the snapshot —
**no runtime/hook change is needed**: the existing microtask→macrotask settle
empties the whole server-fn await chain (the macrotask boundary guarantees the
microtask queue drains first), and it drains a *multi*-server-fn sequence in one
settle too.

**IMPL-NEUTRAL KEYING (load-bearing — D3 impl-freedom).** `serverStub` is keyed
by the **scrml-SOURCE server-fn name** (`loadTasks`), NEVER by impl#1's emitted
route encoding (`/_scrml/__ri_route_loadTasks_1`). Keying by the route would bake
impl#1 internals into the agnostic case (impl#2 may encode routes differently).
impl#1's route is `__ri_route_<sourceFnName>_<counter>`; the **adapter**
(impl#1-specific, free to know impl#1's encoding) maps source-fn-name → route by
extracting the name back out of that pattern at fetch time. impl#2's adapter maps
by its own convention; the case stays neutral. (v1 keys by fn name → a single
response — a per-call `[{args, response}]` form is a later refinement; author two
sibling cases for present-vs-absent / success-vs-error paths, as the corpus does.)

**Response forms.**

```jsonc
"serverStub": {
  // success: the plain JSON wire value the fn resolves to
  "loadTasks": [{ "id": 1, "text": "a" }],
  // `T | not` absence: the §57.2 NORMATIVE envelope, declared DIRECTLY (impl#1
  // matches it; the client dual-decoder §57.4 lowers it to scrml `not`/JS null)
  "loadUser":  { "__scrml_absent": true },
  // server-`!` error: the IMPL-NEUTRAL directive (names the scrml error TYPE +
  // VARIANT, not any wire keys). status defaults to 500 (§19.9.2).
  "loadName":  { "__serverError": { "type": "LoadError", "variant": "Timeout" } }
}
```

**Why the error directive (server-`!` wire SHAPE is D3 impl-freedom).** §57.2's
absence envelope is normative AND impl#1-matched, so an absent response is declared
directly as `{"__scrml_absent": true}` and stays impl-neutral. The server-`!` ERROR
wire shape is impl#1's `{__scrml_error, type, variant, data}` (§19.9.1; the runtime
`errorBoundary` gate keys on `.__scrml_error`). Declaring that literal envelope in a
case would bake ONE impl's wire bytes into the agnostic contract — but the wire
SHAPE is explicit D3 implementation-freedom (impl#2 may serialize errors however it
likes). So an error is declared with the impl-neutral `__serverError` directive, and
the **impl#1 adapter translates** it to impl#1's wire envelope + HTTP status; impl#2's
adapter translates the same directive to ITS shape. The contract asserts the
resulting DOM/state (the error routes to the right variant), not the wire bytes.
*(Currency, S235: an earlier version of this note flagged a §19.9.1-vs-impl#1 DIVERGENCE
— §19.9.1 saying `{__variant, __data}`. That was RECONCILED at S232: the currency fix
corrected §19.9.1 to the actual `{__scrml_error, …}` shape (`g-server-error-wire-spec-impl-divergence`,
SPEC.md:13195); §19.9.1 and impl#1 now AGREE, so there is NO standing divergence. The
directive stays regardless — it keeps the contract impl-neutral per D3, which is the point.)*

### The `files` multi-file convention

Every `*.scrml` in a case dir besides `case.scrml` is an aux import fixture: it
is written alongside the entry at compile/run time, and the compiler auto-gathers
it from the entry's import graph (§21.3). A case with `import { x } from
'./helpers.scrml'` + a sibling `helpers.scrml` proves the import resolves (the
`E-IMPORT-*` family stays silent). NOTE: the adapter's `run()` executes only the
ENTRY bundle, so cross-file imports are gated at the CODES level today; the
runtime half of multi-file (sibling-bundle loading) is a later wave.

## OQ1 — whole-tree vs anchored (the default-mode resolution)

Both modes ship behind ONE normalization pipeline (strip `data-scrml-*` markers,
runtime `<script>`s + comment markers; unwrap marker-only zero-attr `<span>`
binding anchors; canonicalize attr-order / booleans / void / whitespace).

**RECOMMENDED DEFAULT: `domAnchored` is the primary contract; `dom` (whole-tree)
is the supplementary total-coverage snapshot.** Empirically, across the ~28
(b) cases authored here, the whole-tree `dom` repeatedly leaked impl#1-private
structure that the normalizer cannot dissolve without becoming impl#1-shaped:

- if-guard `<template id="_scrml_scrml_tpl_N">` anchors (a counter-id wrapper);
- `<each>`/`<match>`/lift container `<div>` wrappers;
- the inter-interpolation significant space collapsing (`${a} ${b}` → `ab` in the
  whole-tree serialization, while the live textContent is correct);
- validator/error cases render an impl-freedom MESSAGE string — the whole-tree
  `dom` MUST be omitted there (see `forms/validator-invalid`), and the contract
  falls entirely to `state` + `domAnchored`.

The `domAnchored` mode hit NONE of these — it is impl-neutral by construction
(it only addresses author ids/classes/tags/author-attrs, never runtime wrappers).
Reach for whole-tree `dom` when you want total-tree coverage on a STATIC or
value-interpolation case with no control-flow anchors and no rendered
impl-message; reach for `domAnchored` (and lean on `state`) the moment a case
has an `if=`/`each`/`match` anchor or a validator message.

## OQ5 — within-node parity is NOT part of this contract

`parser-conformance-within-node` (the live↔native AST parity canary) is an
**impl#1-internal parser-swap regression scaffold**, NOT part of the language
conformance contract: D3 makes AST explicit impl freedom, so two conformant
impls are permitted to disagree on every AST class. Do not promote AST-parity
into this suite. The only inheritance is methodological — the capture +
human-ratified re-baseline discipline + the per-fixture JSON format.

## Authoring (OQ4 — capture proposes, SPEC-review disposes)

1. Lift pre-reviewed browser/`conf-*` assertions (Option D — cheapest sound).
2. Golden-capture the mechanical expected (normalized DOM + state), then
   **review it against the cited `spec` §** before locking. Every (b) case
   carries `spec` + `rationale` (MANDATORY). A capture that SURPRISES you is a
   **bug-or-spec-gap** — file it, assert the SPEC-correct value, do NOT bless
   impl#1 (pure golden-capture is rejected — it would make impl#1 the spec).
3. Hand-author flagship SPEC-canonical examples verbatim.

## Running

```sh
bun conformance/run.ts                                 # standalone; exit = pass/fail
bun test compiler/tests/conformance/corpus-bridge.test.js  # the GATED bridge
bun test ./conformance/conformance-corpus.test.js      # top-level wrapper (note ./)
```

The corpus is **deterministic** (settle-based; no real-time waits).

## Adding an impl#2 (native) adapter

Expose the same `compile(source) -> { codes, byCode }` and
`run(source, input[]) -> { dom, state, body }`, plus the `globalThis.__scrml_conformance`
hook (`snapshot()` + `settled()`). "Native is correct iff it passes the 1.0
suite" is the Road-B gate (W5).
