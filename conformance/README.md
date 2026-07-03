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
  driver.ts            the 8-verb selector-addressed input vocabulary (OQ2)
  fake-clock.ts        the deterministic virtual clock backing `advance-time`
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

### Input vocabulary (OQ2 — 8 selector-addressed verbs)

```jsonc
{ "click":   "#inc" }                  // bubbling click
{ "input":   "#field", "value": "ab" } // set value + fire `input`  (text/range)
{ "change":  "#sel",   "value": "x"  } // set value + fire `change` (select)
{ "check":   "#agree" } / { "uncheck": "#agree" } // set checked + fire `change`
{ "submit":  "#form" }                 // bubbling `submit`
{ "key":     "#field", "press": "Enter" } // keydown + keyup for a named key
{ "wait":    "settle" }                // await the hook's settled() (async drain)
{ "advance-time": 1000 }               // advance the VIRTUAL clock by N ms, then settle
```

Inputs are USER-INTENT events flowing through the handlers BOTH impls wire.
Direct state-set is **banned** (it bypasses handlers + names impl internals).
Real (wall-clock) waits are banned (non-deterministic); time is driven ONLY
through `advance-time` (below) and the semantic `wait: "settle"`.

### `advance-time` — the virtual clock (a normative contract verb)

`{ "advance-time": ms }` is a **RATIFIED normative language-1.0 conformance
contract verb** (impl#2 MUST honor it). The contract adopts a **virtual-clock
model**: an impl runs time-dependent surfaces against a deterministic virtual
clock that advances ONLY when a case says so — never on a wall clock. The verb
advances that clock by `ms`, fires every pending timer whose deadline lands in
the window (in deadline order), then settles.

Which surfaces this makes conformance-testable:

- `<onTimeout after=DURATION to=.Variant/>` (§51.0.M) and `<onIdle>` (§51.0.R)
- `debounced` / `throttled` reactive cells (§6.13)
- engine temporal rules (`A after 1s => B`, §51.12) and interval timers (§6.7)

**Determinism rule.** A ms>0 timer fires **exclusively** on an `advance-time`
verb — never on `wait: "settle"` and never on a real elapsed wall clock. A
`setTimeout(fn, 0)` (task-queue ordering, not time advancement) still runs on the
real task queue, so `settled()` and 0-clamped / leading-edge reactive writes
drain without any `advance-time`. See the paired `engine/on-timeout` (fires with
the verb) and `engine/on-timeout-no-advance` (identical source, omits the verb,
stays put) cases for the bracketing proof.

impl#1 realizes the virtual clock in `fake-clock.ts` (a zero-production-byte
adapter helper that overrides `setTimeout`/`clearTimeout`/`setInterval`/
`clearInterval`/`Date.now`/`requestIdleCallback`/`cancelIdleCallback` on
`globalThis` for the duration of one `run()`, restored in a `finally`); impl#2
is free to realize the same virtual-clock contract however it likes.

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

### Server-eval mode (`serverDb`) — running the REAL server handlers

`serverStub` (above) MOCKS the server: its `fetch` returns the declared response
VERBATIM, so the compiler-emitted route handler — and the §14.8.9 redaction sink
+ §52.8 SSR compose it contains — never execute, leaving the RUNTIME halves of
protect-redaction and SSR first-paint unobservable.

**Server-eval mode** (E-ADAPTER, S236) widens the existing seam: `result.outputs`
already carries `serverJs`, and the adapter's `runServer()` EVALUATES that server
bundle, then executes the client against the REAL handlers. It is **opt-in** via a
case declaring `serverDb` (absent it, the byte-identical `run()`/`serverStub`
path is used — non-perturbing).

```jsonc
"serverDb": {                                 // impl-neutral server DB seed, by TABLE
  "users": [{ "id": 1, "name": "Alice", "passwordHash": "SECRET" }]
},
"input": [{ "click": "#load" }, { "wait": "settle" }],
"state": { "user": { "id": 1, "name": "Alice" } }, // passwordHash REDACTED at egress
// SSR: compose the §52.8 first-paint + seed __scrml_ssr_state, then hydrate
"firstPaint": {
  "contains":    ["<li data-scrml-key=\"1\" class=\"row\">Alice</li>"],
  "notContains": ["SECRET", "passwordHash"]     // §14.8.9 redaction in the first paint
}
```

- **`serverDb`** — `Record<tableName, row[]>`, impl-neutral (keyed by TABLE, never
  a route/SQL encoding). Each `_scrml_sql\`... FROM <table> ...\`` the emitted
  handler runs resolves to a fresh copy of that table's rows. Its presence is the
  request→response serverJs-eval trigger. The adapter routes the client's
  `/_scrml/*` fetches through the emitted WinterCG `fetch(request)` (a duck-typed
  request + `document.cookie` jar so the baseline double-submit CSRF gate behaves
  as deployed).
- **`firstPaint`** — `{contains?, notContains?}` substring assertions on the
  composed `_scrml_ssr_compose_handler` output. Presence selects SSR mode (compose
  → mount the first-paint → seed `window.__scrml_ssr_state` → hydrate). `ssr:true`
  forces SSR mode without a first-paint assertion.

**Contract status — RATIFIED (S236, user "ratify both").** `serverDb` + `firstPaint`
are **RATIFIED normative language-1.0 conformance contract verbs** (impl#2 MUST honor
them). The language-1.0 conformance contract now commits: impl#2 SHALL seed its
server-side DB from `serverDb`, run its real server route handlers (so the §14.8.9
redaction sink + §52.8 SSR compose execute), and emit an impl-neutral first-paint that
`firstPaint` asserts against. Rationale (parallel to the `advance-time` ratification,
S235): "the server holds these rows / composes this HTML" is observable program
behavior, not an impl internal. The E-CSRF harness fallback
(`_scrml_fetch_with_csrf_retry`) is an adapter shim, NOT contract — it resolves a bare
reference an auth-middleware client emits without a definition on that path (tracked as
the codegen bug `g-csrf-retry-helper-def-gated`).

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
