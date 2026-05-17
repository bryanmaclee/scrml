# scrmlTS

The working compiler for **scrml** — a single-file, full-stack reactive web language.
This is the TypeScript/JavaScript implementation that compiles `.scrml` source into
HTML, CSS, client JS, and server route handlers in a single pass.

scrml lets you write a complete app in one file: markup, reactive state, scoped CSS,
SQL, server functions, and inline tests — no build config, no separate server file,
no state management library.

> ## scrml — current state: v0.3.0 STABLE shipped + v0.3.x patch arc in flight
>
> The latest shipped tag is **v0.3.0** (cut S92, 2026-05-14). The compiler
> ships v0.3.0 codegen + runtime semantics: **V5-strict** declaration
> (`<x> = init` decl form + `@x` expression access), the **Tier 0/1/2 ladder**
> for case analysis (booleans → `<match>` → `<engine>`), auto-synthesized
> validity surface for forms, file-level `<channel>` blocks for realtime,
> schema shared-core vocabulary, refinement-type predicates, hierarchical
> engines with `history` + `<onTimeout>` + `<onIdle>` + `internal:rule=`,
> whole-stack closure analysis with per-route per-role content-addressed
> chunk splitting and tiered prefetch, the **`{"__scrml_absent": true}`** wire
> envelope for `T | not` server returns (SPEC §57), and 22 architectural
> locks (L1–L22).
>
> **v0.3.x patch arc in flight.** Phase B SPA tree-shake landed post-v0.3.0
> and cut the scrml-runtime payload from 38.7 KB → 11.8 KB gzip. The current
> session arc is closing four A2-anomaly-2-surfaced compiler-engineering
> gaps: `export function` body population, parseParamList default values,
> RI promotion through `server { … }` blocks, scope-walker handling of
> `export class` + destructuring, and `is some` member-access LHS
> preservation. See [`docs/changelog.md`](./docs/changelog.md) for the
> per-session ledger.
>
> v0.1.0 was the previous shipped baseline. **v0.1.0-syntax code (using
> `@var = 0` implicit declaration, `< machine>` for state machines, `~var`
> for derived values) will not compile against v0.2.x or later.** No
> production adopters exist, so there is no v0.compat / migration-tool path.
>
> **Semver cadence.** v0.2.0 → v0.2.6 patches landed across S83 → S85;
> v0.3.0 stable cut at S92. v0.3.x patches land during the active
> development cycle; v0.4 is the next minor horizon. Backward-breaking
> changes are reserved for a future major.
>
> If you find articles or LLM-generated scrml that uses pre-v0.2 syntax,
> they describe the prior language. Live phase status:
> [`master-list.md` §0](./master-list.md) (the load-bearing dashboard);
> recent landings: [`docs/changelog.md`](./docs/changelog.md); session
> hand-offs: [`hand-off.md`](./hand-off.md) (current) +
> [`handOffs/`](./handOffs/) (rotated).

## Quick start

```bash
# Install (Bun required)
bun install

# Link the scrml binary onto your PATH (one-time, from the repo root)
bun link

# Scaffold a new project, then run it
scrml init my-app
cd my-app
scrml dev src/app.scrml   # watch + serve

# Or use the CLI directly on any .scrml file or directory
scrml compile <file|dir>
scrml dev <file|dir>      # watch + serve
scrml build <dir>         # production build

# Run the test suite
bun test compiler/tests/
```

## What's in here

- `compiler/` — compiler source, the authoritative `SPEC.md` (~27,144 lines / §57 + appendices) / `SPEC-INDEX.md` / `PIPELINE.md`, **12,300+ tests**, and reference self-host modules
- `examples/` — **23 runnable single-file scrml apps + the trucking-dispatch multi-page app**
- `samples/compilation-tests/` — **289 compilation tests** covering every accepted construct
- `stdlib/` — **16 user-facing stdlib modules** (`auth`, `crypto`, `data`, `format`, `fs`, `http`, `path`, `process`, `router`, `store`, `test`, `time`, `redis`, `cron`, `regex`, `oauth`)
- `benchmarks/` — runtime, build, and full-stack benchmarks vs React / Svelte / Vue
- `editors/vscode/`, `editors/neovim/` — editor integrations
- `lsp/server.js` — language server
- `dist/scrml-runtime.js` — shared reactive runtime

For recent fixes and work currently in flight, see [`docs/changelog.md`](./docs/changelog.md).



# scrml

**An app should be an exhaustive state machine.**

scrml is a compiled language built around one organizing principle: the structural
shape of a shipped UI is the structural shape of its state. Every reachable state
has UI. Every transition is intentional. Every effect runs at the right moment.
**Provability falls out of the language's natural shape — not from separate proof
ceremony.**

The compiler does the wiring: server/client splitting, reactivity, routing,
async scheduling, SQL batching, channel sync, validity-surface synthesis. You
declare the shape; the compiler emits plain HTML, CSS, and JavaScript. No virtual
DOM, no JSX, no `node_modules`.

```bash
scrml compile hello.scrml -o dist/
```

## The Tier 0 / 1 / 2 ladder

Apps don't start at the north star; they evolve toward it. The Tier ladder lets
you start as a prototype and add structure as the design hardens — without
rewriting the markup tree. State-children carry forward verbatim between tiers;
the wrapper swap is the commitment moment.

| Tier  | Form                                       | What you get                                                           |
|-------|--------------------------------------------|------------------------------------------------------------------------|
| **0** | `if=` chains / `${ if (...) lift ... }`    | prototype; no exhaustiveness check                                     |
| **1** | `<match for=Type [on=expr]>`               | structural exhaustiveness check at compile time                        |
| **2** | `<engine for=Type initial=.Variant>`       | full deal — exhaustiveness + active transition rules (`rule=`) + per-state effect handlers (`<onTransition>`, `<onTimeout>`, `<onIdle>`) + composite hierarchy + `history` restore |

Adding a sixth variant later forces the compiler to remind you where every
transition into it should fire from. The state machine evolves; the compiler
enforces.

## Why scrml

**State is the declaration primitive.** `<count> = 0` declares a reactive cell;
`@count` reads or writes it. Compound state, derived (`const <total> = expr`),
server-pinned (`<users server>`), linear (exact-once) values, refinement-typed
cells — all sit on the same primitive with different attributes. The compiler
tracks the dependency graph and re-renders on change.

**Engines are the centerpiece.** When state goes from "a few booleans" to "this
app has phases," promote from booleans to a `<match>` block, then to `<engine>`.
The engine declares legal transitions per state via `rule=`, runs effect
handlers via `<onTransition>`, schedules timeouts via `<onTimeout>` (with
`cancelTimer("X")` builtin), watches for engine-wide idle via `<onIdle>`,
nests via composite state-children for sub-machines, and restores prior inner
state on re-entry via the `history` attribute. Five behaviorally-distinct UI
states authored once, exhaustively, with cross-state effects intentional and
co-located.

**Full-stack in one file.** Markup, logic, styles, SQL, server functions, error
handling, channels for realtime, inline tests — everything lives in `.scrml`.
The compiler analyzes your code and splits it across server and client
automatically. No API layer to maintain, no route files to keep in sync, no
API/UI drift.

**Errors are states, not booleans.** `try`/`catch` is not in scrml's vocabulary.
Failable functions surface errors as enum variants (`fn fetchItems()! -> LoadError`);
the `!{}` handler at the call site routes each variant into the right Phase
state. Missing-handler is a compile-time error; the failure modes live in the
type, not in `<isError>` + `<errorMsg>` boolean rubble.

**Validators auto-synthesize a validity surface.** Compound state with `req`
or `length` or other predicates produces `@form.isValid`, `@form.errors`,
`@form.touched`, `@form.submitted` rollups AND per-field `@form.name.isValid`,
`@form.name.errors` cells — all reactive, read-only. `<errors of=@form/>`
renders the active errors at the right time. Same word fires three places:
state validator (reactive), refinement type (compile-time + boundary), schema
column (DB-enforced). No bilingual schema; no Zod; no separate validation
library.

**The compiler eliminates N+1 automatically.** Because scrml owns both the
query context and the loop context, a `for (let x of xs) { ?{...where id =
${x.id}}.get() }` pattern is rewritten to one pre-loop `WHERE id IN (...)`
fetch plus a keyed `Map` lookup — no DataLoader, no manual batching.
Independent reads in a `!` handler share one `BEGIN DEFERRED`..`COMMIT`
envelope for snapshot consistency. [Measured Tier 2 wins](benchmarks/sql-batching/RESULTS.md):
~1.7× at N=10, ~2.3× at N=100, ~3.3× at N=1000 on on-disk WAL `bun:sqlite` (v0.3.0 refresh).

**Realtime and workers as language primitives.** A `<channel>` block declares
a WebSocket endpoint — the compiler emits the upgrade route, client connection
manager, auto-reconnect, and pub/sub topic routing. State declared inside the
channel auto-syncs across every connected client. A nested `<program>` is a
Web Worker (or WASM module, or sidecar process) with typed RPC and supervised
restarts. No `new WebSocket()`, no `postMessage` plumbing, no worker-loader
config.

**No npm.** scrml ships its own stdlib: `auth`, `crypto`, `data`, `format`,
`fs`, `http`, `path`, `process`, `router`, `store`, `test`, `time`, `redis`,
`cron`, `regex`, `oauth`. Sixteen modules cover the surface a typical app
reaches for. No package manager, no dependency trees, no `node_modules`.

## Quick Example — a Counter (Tier 0)

```scrml
<program>

<count> = 0
<step>  = 1

<div class="counter">
    <span class="value">${@count}</>

    <select bind:value=@step>
        <option value="1">1</>
        <option value="5">5</>
        <option value="10">10</>
    </select>

    <button onclick=decrement() disabled=atMinimum()>-</>
    <button onclick=${reset(@count)}>Reset</>
    <button onclick=increment()>+</>
</div>

${
    function increment() { @count = @count + @step }
    function decrement() {
        if (@count - @step >= 0) { @count = @count - @step }
    }
    fn atMinimum() { return @count - @step < 0 }
}

#{
    .counter { text-align: center; font-family: system-ui; }
    .value   { font-size: 4rem; font-weight: 700; }
}

</>
```

State is declared with `<name> = init` (V5-strict). Access is `@name`. `<count>`
and `<step>` are plain reactive cells. `bind:value=@step` keeps the select and
the cell in sync. `fn atMinimum` is a pure predicate — the compiler verifies it
has no side effects (no SQL, no DOM mutation, no reactive writes, no `fetch`,
no `<request>` boundary). `reset(@count)` returns the cell to its declared
initial value. The compiler generates direct DOM manipulation; no virtual DOM,
no signals library.

This is **Tier 0** — booleans-as-lifecycle, no exhaustiveness check. Fine for
prototyping. The compiler nudges via lints (`W-LIFECYCLE-CANDIDATE`,
`W-MATCH-TRANSITIONS-ACCRUING`) when the shape suggests promotion.

## Engine Example — a Loader as a State Machine (Tier 2)

The same loader pattern that almost every UI needs — expressed as an exhaustive
state machine instead of boolean flags:

```scrml
<program db="items.db">

type LoadError:enum = {
    Network(msg: string)
    Empty
}

type Phase:enum = {
    Idle
    Loading
    Error(msg: string)
    Empty
    Success(count: int)
}

server function fetchItems()! -> LoadError {
    const result = ?{select * from items}
    if (result.length == 0) fail LoadError::Empty
    return result
}

function load() {
    @phase = .Loading
    const result = fetchItems() !{
        | ::Network msg -> { @phase = .Error(msg); return }
        | ::Empty       -> { @phase = .Empty;       return }
    }
    @phase = .Success(result.length)
}

<engine for=Phase initial=.Idle>

    <Idle rule=.Loading>
        <button onclick=load()>Load</button>
    </>

    <Loading rule=(.Success | .Error | .Empty)>
        Loading…
    </>

    <Error msg rule=.Loading>
        <div class="err">${msg}</div>
        <button onclick=${@phase = .Loading}>Retry</button>
    </>

    <Empty>
        No rows yet.
    </>

    <Success count>
        Got it: ${count} rows
    </>

    <onTransition from=.Loading to=.Success>
        ${ analytics.track("load.success") }
    </>

</>

</>
```

Five behaviorally-distinct UI states — Idle / Loading / Error / Empty / Success —
declared as variants of one enum. **Every variant has a UI block; the compiler
enforces this exhaustively.** Cross-state effects live next to the engine they
describe.

- **`rule=`** declares legal transitions FROM each state. `<Idle rule=.Loading>`
  means: from `Idle`, the only legal transition is to `Loading`. A typo like
  `@phase = .Loaded` is a compile-time error (variant doesn't exist). Writing
  `@phase = .Success(0)` from `Idle`'s body fires `E-ENGINE-INVALID-TRANSITION`
  — Idle's `rule=` doesn't include `.Success`. Use `rule=*` as the explicit
  wildcard escape hatch.
- **`<onTransition from= to=>`** runs effects on specific transitions —
  analytics, cleanup, side effects — co-located with the engine they describe,
  not scattered across `useEffect` hooks.
- **Errors are states, not booleans.** Instead of `<isError>` + `<errorMsg>`
  cells, the failure mode is a variant of `Phase`. The `!{}` handler at the
  call site routes each error variant into the right Phase variant. Missing
  handler arm: compile-time error.
- **Adding a sixth variant** later forces the compiler to remind you where
  every transition into it should fire from. State machine evolves; compiler
  enforces.

For the surface beyond the basic shape — composite state-children with nested
engines (sub-machines), the `history` attribute that restores prior inner state
on re-entry, `<onTimeout after=2s to=.Variant>` for per-state timeouts (with
named timers and `cancelTimer("name")` builtin), `<onIdle>` for engine-wide
event-timeout watchdogs, `internal:rule=` for transitions that don't exit /
re-enter the composite — see SPEC.md §51 and example
[`examples/14-mario-state-machine.scrml`](examples/14-mario-state-machine.scrml).

## Full-Stack in One File

A contact book with a database, server functions, and an auto-validated reactive
form — no API layer, no ORM, no route files, no separate validation schema:

```scrml
<program db="contacts.db">

<schema>
    contacts {
        name:  text req length(>=2)
        email: text req email
    }
</>

<entry>
    <name  req length(>=2)> = <input placeholder="Name"/>
    <email req email>       = <input type="email" placeholder="Email"/>
</>

<form onsubmit=addContact()>
    <entry.name/>
    <entry.email/>
    <errors of=@entry/>
    <button type="submit" disabled=${not @entry.isValid}>Add Contact</>
</form>

<ul>
    ${
        for (let c of ?{select name, email from contacts}.all()) {
            lift <li>${c.name} — ${c.email}</>
        }
    }
</ul>

${
    server function addContact() {
        ?{insert into contacts (name, email) values (${@entry.name}, ${@entry.email})}.run()
        reset(@entry)
    }
}

</>
```

Five things the compiler does that you don't write:

- **`<schema>` is the source of truth for the data shape.** The `contacts` block
  doubles as the database migration AND the source-level shared vocabulary.
  `req length(>=2)` lowers to `NOT NULL` + `CHECK (length(name) >= 2)` at the
  DB layer. The same `req length(>=2)` on the `<name>` cell above fires at the
  state-validator layer. Same word, same semantics, two enforcement loci. Add
  a third (refinement type on the function parameter) and it composes.
- **`<entry>` is compound state with bindable markup (Shape 2).** Each field
  declares a reactive cell *with* its render-spec. `<entry.name/>` in markup
  expands to the bound input element with `bind:value` wired automatically.
  Validators (`req`, `length(>=2)`, `email`) fire on input.
- **`@entry.isValid`** is auto-synthesized — a compound rollup over every
  field's validity. **`@entry.name.isValid`** is per-field. **`@entry.errors`**
  is a list of enum-tagged errors (`.Required`, `.LengthFailed(predicate)`),
  not strings — consumers pattern-match on the tag.
- **`<errors of=@entry/>`** renders the active errors at the right time
  (touched + submitted lifecycle managed automatically).
- **`addContact()` runs server-side** because it does SQL. The compiler infers
  the boundary, generates the route, the fetch call, CSRF tokens, parameterized
  queries, and serialization. `reset(@entry)` returns every field to its
  declared initial value. You never write any of this.

## Benchmarks

> **⚠️ Stale (measured 2026-04-13; not yet re-measured against v0.2.0).** The
> numbers below were captured during the v0.1.0 → v0.2.0 transition window,
> before the A1c codegen waves (C0–C23), the A5 computed-delay + `<onTimeout>` +
> `<onIdle>` family, Phase A10 engine-state-child body render, the A7
> hierarchy / history / `internal:rule=` codegen, A8 test-bind, A9 body-split
> min-viable, and Wave 2's five A7 codegen deferral fixes (S83). The compiled
> output shape has changed materially since these were captured. **Numbers may
> move in either direction.**
>
> Refresh is queued — running TodoMVC + the comparison frameworks against the
> current compiler will also serve as a shallow bug-hunt across the full v0.2.0
> codegen surface (the most thorough exercise a single demo app gives).
> Re-published numbers + delta commentary will land in a forthcoming v0.2.x
> patch alongside the refresh.

Measured against React 19, Svelte 5, and Vue 3 on an identical TodoMVC implementation. Bundle row re-measured 2026-05-15 against HEAD `1f73732` (v0.3.0 + v0.3.x Phase B SPA tree-shake landed). Runtime + build rows below carry forward from the 2026-05-14 v0.3.0 STABLE refresh and are queued for re-measurement post-tree-shake — see [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) for full details.

**Bundle size (gzip):**

| Framework | JS | Total | Dependencies | node_modules |
|-----------|---:|------:|---:|---:|
| **scrml** | **13.9 KB** | **15.8 KB** | **0** | **0 bytes** |
| Svelte 5  | 15.7 KB | 16.8 KB | 3 | ~30 MB |
| Vue 3     | 26.5 KB | 27.6 KB | 3 | ~25 MB |
| React 19  | 61.5 KB | 62.6 KB | 4 | ~46 MB |

> **Bundle history, honestly accounted (2026-05-15):**
> - Same-source TodoMVC at v0.2.6 (pre-Approach-A) measured 36.5 KB total gzip.
> - At v0.3.0 STABLE (post-Approach-A) the same source measured 40.8 KB — a **+4.3 KB** delta from per-route chunk loading, FNV-1a content addressing, role-detection bootstrap, prefetch helpers, and dual-decoder wire format.
> - At HEAD (post-Phase-B SPA tree-shake) the same source measures **15.8 KB total / 13.9 KB JS-only**. The v0.3.x Phase B patch consults per-file `usedRuntimeChunks` when assembling the shared `scrml-runtime.js` (the legacy path shipped the unsplit template regardless of which chunks the compile unit used) and gates the §57 dual-decoder behind a new `wire` chunk.
> - The recovery exceeds the v0.3.0 regression because Phase B also closed a **pre-existing** shared-runtime tree-shake gap that Approach A made visible. The historical "14.8 KB v0.2.x" baseline cited in earlier framings traces to a pre-v0.2.0 measurement era and is not reproducible against any v0.2.x release tag.
>
> Zero dependencies preserved throughout. The per-route per-role chunking benefit on multi-route multi-role apps is unchanged — see the [per-route per-role chunk variance section](benchmarks/RESULTS.md#per-route-per-role-chunk-variance-v030-new) for that v0.3 narrative.
>
> Runtime filename note: `scrml-runtime.<hash>.js` (content-addressed via FNV-1a) — deterministic cache-busting for adopters serving the runtime from a stable URL.

**Runtime performance (headless Chrome, medians in ms, lower is better):**

| Operation | scrml | React 19 | Svelte 5 | Vue 3 |
|-----------|------:|---------:|---------:|------:|
| Create 1000 | 45.0 | **39.9** | 59.3 | 48.9 |
| Partial update | 52.5 | 8.5 | **8.2** | 22.9 |
| Swap rows | 51.0 | 39.4 | **5.9** | 15.4 |
| Select row | 168.2 | 0.9 | **0.1** | 0.1 |
| Remove row | 51.9 | 6.7 | **5.9** | 16.6 |
| Append 1000 | 95.95 | **46.5** | 69.6 | 60.3 |
| Create 10,000 | 399.2 | **365.4** | 565.9 | 465.6 |

scrml wins 0 of 10 TodoMVC benchmarks **at the 2026-05-14 v0.3.0 STABLE refresh**
(was 6 of 10 at v0.2.4-era). The runtime perf table above is carried forward from
that refresh and **has not been re-measured since the v0.3.x Phase B SPA tree-shake
landed**. The tree-shake cut the scrml-runtime payload from 38.7 KB → 11.8 KB gzip,
which should reduce parse + load cost; in-memory dispatch is unchanged. A fresh
runtime + build refresh is queued. See [full results](benchmarks/RESULTS.md) including
the v0.2.4-era baseline preserved for trend tracking.

**Build time (TodoMVC, median of 10):**

| Framework | Build Time |
|-----------|---:|
| **scrml** | **65.6 ms** |
| Svelte 5  | 668 ms |
| Vue 3     | 706 ms |
| React 19  | 944 ms |

scrml is ~10-14x faster to build than Vite at v0.3.0 (was 8-12x at v0.2.x).

## Features

### State and Reactivity

- **Reactive state — V5-strict.** `<count> = 0` declares a reactive cell; `@count` reads or writes it. The decl form is structural; the access form is canonical. The two forms are visually distinguishable, so a reader can scan a function body and count "how many state cells does this read or mutate." Bare names in expressions are LOCAL identifiers only — they do NOT resolve to reactive state (locals cannot shadow registered state names; `E-NAME-COLLIDES-STATE`).
- **Three RHS shapes for state decls.** Shape 1 plain (`<count> = 0`), Shape 2 decl-coupled-with-render-spec (`<userName req length(>=2)> = <input/>` — `<userName/>` in markup expands to the bound input with `bind:value` wired), Shape 3 derived (`const <doubled> = @count * 2` — read-only; recomputes on dep change; markup-typed derived cells legal per L1).
- **Compound state (Variant C).** `<formRes> <name> = "" <email> = "" </>` — ad-hoc compound via structural children. Read `@formRes.name`; write `@formRes.email = "alice"`. Tier 3 predefined-shape compound supports positional sugar against a known type.
- **Two-way binding (`bind:value`)** — compiler dispatches binding by render-spec (`<input type="checkbox">` → `bind:checked`; `<select>` → `bind:value`; etc.). Per L17.
- **Absence value (`not`)** — a unified null/undefined replacement. `<result> = not` means "no value yet." Check with `is some` / `is not`. `== not` misuse is `E-SYNTAX-042` at compile time. null and undefined never appear in scrml — library mode inclusive.
- **Server-pinned + protected state.** `<users server>` pins state server-side so it never reaches the browser. `protect=` on struct fields hides them from the client schema view. Both enforced at compile time.

### Linear Types

- **Exact-once consumption (`lin`)** — values that must be used exactly once. The compiler verifies this statically across all code paths, including branches and loops.
- **Site-agnostic** — a `lin` value can be created at one site, passed through function calls, and consumed at a completely different site. No manual threading through intermediate stages. If you need the value more than once, assign it to a `const` at the consumption site.
- See [`docs/lin.md`](./docs/lin.md) for a complete how-to guide: when to reach for `lin`, what counts as consumption, branch and loop rules, cross-`${}`-block usage, closures, and a fix-by-error-code catalog.

### Type Safety

- **`asIs` (not `any`)** — scrml has no `any` type. There is no "turn off the type checker" escape hatch. `asIs` accepts any type but forces you to resolve it to a concrete type before use or return — analogous to TypeScript's `unknown`, not `any`. Component bare props follow `asIs` rules: the compiler infers the concrete type from how you use the prop.

### Runtime Type Validation (replaces Zod)

scrml has built-in runtime type validation. The type annotation IS the validation schema — no separate schema library, no `z.object()` wrappers, no `z.infer<typeof>` indirection.

```scrml
<price: number(>0 && <10000)>      = userInput
<email: string(email)>             = formValue
<password: string(.length > 7 && .length < 255)> = rawInput

type Invoice:struct = {
    amount: number(>0 && <10000)
    recipient: string(email)
}

fn process(amount: number(>0 && <10000)) {
    // amount is proven valid here — zero runtime checks inside the function
    let discounted = amount * 0.9
    let safe: number(>0 && <10000) = discounted  // boundary check emitted
}
```

The compiler uses a **three-zone enforcement model** (derived from SPARK/Ada):

| Zone | When | Cost |
|------|------|------|
| **Static** | Compiler can prove the value satisfies the constraint (e.g. literals) | Zero — no runtime code emitted |
| **Boundary** | Value comes from an unproven source (user input, API response, arithmetic) | One boolean check at assignment site |
| **Trusted** | Value was already checked in the current scope | Zero — compiler remembers the proof |

Boundary checks emit a single synchronous predicate test; on failure the compiler throws `E-CONTRACT-001-RT` labeled with the assignment site. Named shapes available today: `email`, `url`, `uuid`, `phone`, `date`, `time`, `color`. Composable predicates (`number(>0 && <10000)`, `string(.length > 7)`) cover the same ground as Zod schemas — with zero dependencies, zero bundle cost in proven code paths, and no separate schema language to keep in sync with your types.

### Free HTML Validation

The same predicate powers browser-native form validation. On `bind:value` inputs, the compiler derives the matching HTML attributes — `string(email)` emits `type="email"`, `number(>0 && <100)` emits `min="0" max="100"`, `string(uuid)` emits `pattern=...`, `string(.length > 7 && .length < 255)` emits `minlength="8" maxlength="254"`. One predicate, three enforcement points: server-side boundary check, client-side boundary check, browser-native pre-submit validation. You never write the HTML attrs by hand, and they never drift from the type.

### Variable Renaming

The compiler renames JavaScript bindings in the compiled output using a deterministic, type-derived encoding. `@shoppingCart` of type `Cart` becomes `_s7km3f2x00` — underscore prefix, kind character (`s` = struct, `p` = primitive, `e` = enum, and so on), an 8-character base36 FNV-1a hash of the canonical type string, and a per-scope sequence char. Two bindings of the same type share the hash; the sequence char disambiguates.

Because the name carries the type, runtime `reflect()` can recover the full type descriptor from a variable alone — without shipping any unused type metadata. The decode table is tree-shaken entirely when no `^{}` meta blocks reference runtime state, so most apps ship zero reflection bytes. Debug builds append `$originalName` so stack traces and DevTools stay readable; production builds reject that flag as a hard error.

This isn't bundler-style single-letter renaming — the names are longer than `a`, `b`, `c`. The wins are different: collision-free across scopes, type-introspectable at runtime, and protected fields can never leak into a client-side encoded name (the client schema view excludes them by construction, verified again at emit).

### Server/Client

- **Auto-split via whole-program inference.** The compiler walks the call graph and infers what runs where. Functions that touch SQL, `protect=` fields, `Bun.*` APIs, `process.*`, `scrml:auth`/`scrml:crypto`/`scrml:fs`/`scrml:store`/`scrml:redis`/`scrml:cron`/`scrml:oauth` (server-only stdlib modules) are classified server-side automatically. Caller-context propagates the classification through transitive call chains (Insight 26 Trigger 5). The `server` keyword still parses but is redundant when inference can prove server-classification — `W-DEPRECATED-SERVER-MODIFIER` fires at redundant uses; `W → E → parser-strip` deprecation cycle follows `<machine>` precedent and lands in v0.3.0. **Dead, never-called functions are warned (`W-DEAD-FUNCTION`) and tree-shaken.**
- **SQL passthrough (`?{}`)** — query SQLite directly inside logic blocks. The compiler generates parameterized queries and handles serialization.
- **Automatic N+1 elimination (Tier 2).** A `for` loop whose body does `?{...WHERE id = ${x.id}}.get()` is rewritten to one pre-loop `WHERE id IN (?,?,?,...)` fetch plus a keyed `Map` lookup. No DataLoader, no manual batching. Measured ~1.7×/2.3×/3.3× at N=10/100/1000 on on-disk WAL `bun:sqlite` (v0.3.0 refresh) — see [benchmarks/sql-batching/RESULTS.md](benchmarks/sql-batching/RESULTS.md).
- **Implicit transaction envelopes (Tier 1).** Independent reads in a `!` handler share one `BEGIN DEFERRED`..`COMMIT` for snapshot consistency under concurrent writers. Explicit `transaction { }` blocks are left alone; a `W-BATCH-001` warning fires if the two would conflict.
- **Mount-hydration coalescing.** Multiple on-mount `<x server>` loads on the same page are folded into a single `__mountHydrate` round-trip (§8.11) instead of one request per variable.
- **Opt-out per call site.** `?{...}.nobatch()` disables rewriting when you need an exact query shape — useful for `EXPLAIN`, stored-procedure calls, or measured hot paths.
- **Diagnostics, not silent magic.** `D-BATCH-001` flags near-miss loops that *almost* batch but don't (mutation in body, non-`.get()` chain, etc.), with the exact disqualifier. `E-BATCH-001` rejects `.nobatch()` composition with batched siblings; `E-BATCH-002` guards against the 32 766 `SQLITE_MAX_VARIABLE_NUMBER` ceiling at runtime.
- **No API boilerplate** — server functions are called like local functions. The compiler generates routes, fetch calls, CSRF tokens, and serialization.
- **Per-route per-role chunk splitting (Approach A; v0.3).** Whole-stack closure analysis (§40) computes exactly which component code, server functions, and stdlib units are reachable per entry point and per role. A `<auth role="Admin">` block tells the compiler that only Admin-role visitors will reach the gated subtree; other roles get a strictly smaller initial bundle. Cross-route prefetching is tiered (idle / hover / on-demand); every chunk filename embeds a stable FNV-1a content hash (§47) so adopter caches stay valid across builds when source bytes don't change. The W-CG-CHUNK-* + W-AUTH-* diagnostic family flags shapes that defeat the analysis — a route linking nowhere, a gate needing a runtime check.

### Realtime and Workers

- **WebSocket channels (`<channel>`)** — a lifecycle element that declares a WebSocket endpoint. The compiler emits the Bun upgrade route, a client-side connection manager with exponential-backoff reconnect, and pub/sub topic routing. `onserver:open`, `onserver:message`, `onserver:close` run server-side; `onclient:open`, `onclient:close`, `onclient:error` run in the browser. `protect=` gates the upgrade with a session cookie check. No WebSocket or Bun-specific API appears in your source.
- **Shared reactive state — V5-strict inside channels.** State declared inside a `<channel>` block (`<messages> = []`) auto-syncs across every connected client. The `@shared` modifier was retired in v0.2.0 — auto-sync comes from being inside the channel body, not from a modifier. Writing in one browser tab updates every other tab subscribed to the same topic; sync wire format is compiler-generated.
- **`broadcast()` and `disconnect()`** — available inside any server handler declared in a channel's lexical scope. `broadcast(data)` fans out to every client on the active topic; `disconnect()` closes the connection. Dynamic topics via `topic=@room` — when `@room` changes, the channel re-subscribes; when `@room` is `not`, the connection stays open but subscribes to nothing.
- **Nested `<program>` = Web Worker.** Put a `<program name="compute">` inside your main program and the compiler spawns a Web Worker. Shared-nothing by construction — no accidental scope leaks. Call worker exports as typed RPC: `const result = await <#compute>.add(1, 2)`. The compiler enforces that cross-program calls are awaited.
- **Message passing with `when`.** `<#worker>.send(data)` posts to the worker; inside, `when message(data) { ... }` handles it and `send(data)` replies. The parent observes lifecycle with `when message from <#worker> (data)`, `when error from <#worker> (e)`, and `when terminate from <#worker>`. No manual `addEventListener('message', ...)` scaffolding.
- **Supervised restarts.** Declare `restart="on-error"`, `max-restarts=3`, `within=60` as attributes on the nested `<program>` and the compiler synthesizes crash detection and restart bookkeeping. `autostart="false"` defers launch until `<#name>.start()`.
- **WASM modules and foreign sidecars.** The same `<program>` syntax spawns a WASM module (`lang="rust" mode="wasm"`) or a subprocess sidecar (`lang="python"`) with HTTP/socket routing — one execution-context primitive covers workers, WASM, and language FFI.

### Components and Patterns

- **Components with props and slots** — `const Card = <div>` defines a component. Props are attributes; slots are named placeholders.
- **Enums and pattern matching** — Rust-style enums with exhaustive `match`. The compiler enforces that every variant is handled.
- **State machines as engines (Tier 2).** `<engine for=Type initial=.Variant>` declares an exhaustive state machine over an enum. `rule=` declares legal transitions per state; `<onTransition from= to=>` runs cross-state effects; `<onTimeout after=Ns to=.Variant>` schedules per-state timeouts (with named timers + `cancelTimer("name")` builtin); `<onIdle after=Ns to=.Variant>` watches for engine-wide event-timeout; composite state-children may nest sub-engines with shallow `history` restore; `internal:rule=` for transitions that don't exit/re-enter the composite. Illegal transitions are compile errors. The legacy `<machine>` keyword is a deprecated alias (`W-DEPRECATED-001`; `bun scrml migrate` rewrites it).

### Metaprogramming

- **Compile-time meta (`^{}`)** — code that runs at compile time. Use `reflect()` to inspect types, `emit()` to generate markup, `compiler.*` to register macros. Meta blocks execute during compilation and produce source that's spliced into the AST.
- **Runtime meta** — meta blocks that reference `@x` reactive state run at runtime instead of compile time. The compiler classifies each block automatically based on what it references.

### Pure Functions

- **`fn` — compiler-enforced purity.** `fn` is not shorthand for `function` — it declares a pure function. The compiler statically verifies five prohibitions: no SQL access, no DOM mutation, no reactive writes, no `fetch`/network calls, no `<request>` boundaries. Use `function` for general-purpose callables; use `fn` for deterministic computations, state factories, predicates, and transformations.

### Styles

- **Scoped CSS (`#{}`)** — styles live next to the markup they apply to. The compiler handles scoping via native `@scope`.
- **Built-in Tailwind engine** — the compiler embeds a Tailwind utility registry. Use utility classes directly in markup; the compiler scans your HTML, resolves classes from the embedded registry, and emits only the CSS rules actually used. No Tailwind CLI, no PostCSS, no purge step.

### Error Handling and Testing

- **Error handling (`!{}`)** — typed error contexts with pattern-matched arms. Error propagation is inferred automatically.
- **Inline tests (`~{}`)** — write tests next to the code they verify. Stripped from production builds.

### Tooling

- **No npm — stdlib first** — scrml ships its own standard library. No package manager, no dependency trees, no node_modules.
- **`<program>` root** — configure database connections, protection rules, HTML spec version, and program-wide settings from a single root element.

## Language Contexts

scrml uses sigil-delimited contexts to separate concerns within a single file:

| Context | Sigil | Purpose |
|---------|-------|---------|
| Program | `<program>` | App root — database, protection, config |
| Markup  | `<tag>` | HTML elements + scrml structural elements (`<engine>`, `<match>`, `<channel>`, `<schema>`, `<errors>`, `<onTransition>`, `<onTimeout>`, `<onIdle>`, `<auth>`, `<page>`) + state decls (`<name> = init`) — all live in the markup tree |
| Logic   | `${}` | JavaScript expressions and functions |
| SQL     | `?{}` | Database queries (Bun.SQL tagged-template; SQLite shipping, Postgres in progress); auto-batched N+1 + envelope |
| CSS     | `#{}` | Scoped styles |
| Error   | `!{}` | Typed error handling (failable `!{ \| ::V -> ... }` arms) |
| Meta    | `^{}` | Compile-time (or runtime) code generation |
| Test    | `~{}` | Inline tests + `test-bind` server-fn mocks (stripped from production) |
| Foreign | `_{}` | Inline foreign code *(specced, not yet implemented)* |

## Specced but Not Yet Implemented

These features are fully designed in the [language spec](compiler/SPEC.md) but not yet available in the compiler. They are listed here so you know what's coming and don't try to use them yet.

| Feature | Spec Section | Description |
|---------|-------------|-------------|
| **Foreign code contexts (`_{}`)**  | S23 | Embed non-JS code inline with level-marked braces (`_{}`/`_={...}=`). Enables inline Rust, Python, SQL extensions, or any language with a registered compiler. The foreign block is opaque to scrml — it passes through to an external toolchain. |
| **WASM call-char sigils** | S23.3 | Single-character sigils (`r{}`, `c{}`, `z{}`) for invoking compiled WASM functions from Rust, C, Zig, etc. Paired with `extern` declarations for type-safe FFI. |
| **Sidecar process declarations** | S23.4 | `use foreign:name { fn }` for declaring server-side sidecar processes (HTTP/socket services) that scrml routes to automatically. |
| **`RemoteData` enum** | S13.5 | Built-in `Loading / Loaded(T) / Failed(Error)` enum for modeling async fetch state. Pattern-matchable with exhaustive checking. |

## Getting Started

### Prerequisites

Install [Bun](https://bun.sh):

```bash
curl -fsSL https://bun.sh/install | bash
```

### Compile a file

```bash
scrml compile hello.scrml -o dist/
```

This produces `dist/hello.html`, `dist/hello.client.js`, and `dist/hello.css`. Open the HTML file in a browser.

### Development with hot reload

```bash
scrml dev
```

`dev` starts a dev server with hot reload. Write `.scrml` files and see results immediately.

### Build for production

```bash
scrml build
```

The compiler produces optimized HTML, CSS, and JavaScript. No runtime framework ships to the browser.

## Examples

The [`examples/`](examples/) directory contains curated examples that show what scrml can do:

| Example | What it shows |
|---------|---------------|
| [01-hello](examples/01-hello.scrml) | Bare minimum — compiles to pure HTML |
| [02-counter](examples/02-counter.scrml) | Reactive state, binding, scoped CSS |
| [03-contact-book](examples/03-contact-book.scrml) | Full-stack with DB, server functions, SQL |
| [04-live-search](examples/04-live-search.scrml) | Reactive filtering, derived state |
| [05-multi-step-form](examples/05-multi-step-form.scrml) | Components, enums, pattern matching |
| [06-kanban-board](examples/06-kanban-board.scrml) | Enum-driven UI, reusable components |
| [07-admin-dashboard](examples/07-admin-dashboard.scrml) | Metaprogramming, type reflection |
| [08-chat](examples/08-chat.scrml) | Reactive lists, server persistence |
| [09-error-handling](examples/09-error-handling.scrml) | Exhaustive error matching with `!{}` |
| [10-inline-tests](examples/10-inline-tests.scrml) | `~{}` inline tests, stripped from production |
| [11-meta-programming](examples/11-meta-programming.scrml) | `^{}` meta blocks, `emit()`, `reflect()` |
| [12-snippets-slots](examples/12-snippets-slots.scrml) | Named content slots in components |
| [13-worker](examples/13-worker.scrml) | Web workers as nested programs with typed messaging |
| [14-mario-state-machine](examples/14-mario-state-machine.scrml) | Enum states + `<engine>` Tier 2 transition enforcement |
| [15-channel-chat](examples/15-channel-chat.scrml) | `<channel>` realtime, V5-strict channel state, auto-sync |
| [16-remote-data](examples/16-remote-data.scrml) | Enum loading-state, server boundary, async classification |
| [17-schema-migrations](examples/17-schema-migrations.scrml) | `<schema>` declarative migrations, diff-on-reload |
| [18-state-authority](examples/18-state-authority.scrml) | `<x server>` Tier 2 cell authority (§52) |
| [19-lin-token](examples/19-lin-token.scrml) | `lin` exact-once consumption, site-agnostic threading |
| [20-middleware](examples/20-middleware.scrml) | `<program>` attrs + `handle()` HTTP middleware |
| [21-navigation](examples/21-navigation.scrml) | `navigate()` + `route` history-aware routing |
| [22-multifile](examples/22-multifile/) | Cross-file `import`/`export`, pure-type files, component canonical-key |

## Documentation

- [Tutorial](docs/tutorial.md) — step-by-step introduction, zero to full-stack
- [Design Notes](DESIGN.md) — rationale and philosophy — why scrml is what it is
- [Language Specification](compiler/SPEC.md) — full formal spec (~26,000 lines)
- [Spec Quick-Lookup](compiler/SPEC-INDEX.md) — find any section fast
- [Pipeline Contracts](compiler/PIPELINE.md) — stage-by-stage compiler pipeline

## License

MIT — see [LICENSE](./LICENSE).

## Related projects

- **[giti](https://github.com/bryanmaclee/giti)** — a collaboration platform and git alternative designed around scrml's compiler strengths. The CLI (save, switch, merge, undo, history, status, land, init, describe, sync) wraps jj (jujutsu) as the engine until the scrml compiler can do AST-level conflict resolution natively. Long-term vision is a hosted forge; GitHub is the stopgap.
- **[6nz](https://github.com/bryanmaclee/6NZ)** — a purpose-built code editor for the scrml ecosystem. An "Interactive Development Experience" written entirely in scrml, with a focus-centered viewport, NeoVim-superset keybindings plus mouse, CodeMirror 6 + canvas overlay, and offline-first PWA delivery. Currently in design phase, awaiting compiler API exposure in scrmlTS. The companion [Z-motion input spec](https://github.com/bryanmaclee/6NZ/tree/main/z-motion-spec) is released under CC0 so others can adopt it.

## Status

scrml is open source under the [MIT License](./LICENSE). The language is still pre-1.0 — the spec evolves as we find friction and the compiler catches up. See [`docs/changelog.md`](./docs/changelog.md) for what just landed and what's in flight.

The compiler runs on [Bun](https://bun.sh). Compiled output is plain JavaScript that runs in any browser or JavaScript runtime.
