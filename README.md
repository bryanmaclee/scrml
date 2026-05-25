# scrml

*/ˈskrɪmɛl/*

Write a whole app in **one `.scrml` file**. The
compiler reads it and does the wiring. No virtual DOM, no JSX, no `node_modules`, no
API layer to drift out of sync.

```bash
scrml compile app.scrml -o dist/
```

You declare the shape of the app; the compiler builds the machine. The example
further down is a real, running app — but first

## A note from the developer

This document describes the ***nominal*** language at the time of any version release. It does not describe what the compiler is perfectly capable of doing. I am working full-bore to get the compiler as close to the nominal state as possible. I am just one guy.

If you are here (and reading this). Hello, My name is Bryan MacLee. I am co-owner of a small trucking company in rural Ut. I run the business, drive, mechanic, apparently I'm the HR department. I am also a husband, father and sometimes, a wannabe coder.

This message is from me. I typed it. but ~96% of what you read (99.9% for the actual code) is claude "written". (I dont care about the exact brand as long as I have a tool that will get the job done.) I do my best to skim, and review as much as I can. But (see the prior list). If you find this interesting, continue reading. if you find something doesn't quite add up (or some straight up bullshit). let me know.

This is my third round with the ai and coding. the first two were pretty underwhelming. This time around I wasn't expecting much but I thought "the hell with it" and I tried out claude. I was fudging impressed.

I had been working with these ideas (in one way or another) for a long time. Over the course of about 3 years I learned (yes, the old school way, not much different than I am doing right now) how compilers work and how to implement various parts in various methods. programming has always been my favorite activity. the thing that I look forward to all the time (other than hanging with my wife and kids. Of course.)

After my first couple of experiments with claude I realized, I might actually be able to build this language. Dont get me wrong, I absolutely could write this language by hand. I can say that factually. BUT it would absolutely take me 10-20 years to do it. I think the ideas are worth surfacing at least.

AI code is still what it is. 100% mid. But its still all human mid that it is regurget-asemble-ing, If the ideas on top of the impl are good, or at least novel. it doesn't matter if the impl is mid. The ideas still get across. that's all that really matters to me here.

are the ideas any good?

## A Full App in One File

A contact book — a real database, server functions, list rendering — with no
API layer, no ORM, and no route files. This is the shape of a scrml app:

```scrml
// gate: skip — a full-stack app needs a database file beside it; shown for shape
<program>

<db src="contacts.db" tables="contacts">

  ${
    <name>  = ""
    <email> = ""

    // persistContact runs the INSERT — the compiler runs it server-side.
    function persistContact(name, email) {
      ?{`INSERT INTO contacts (name, email) VALUES (${name}, ${email})`}.run()
    }

    function addContact() {
      persistContact(@name, @email)
      reset(@name)
      reset(@email)
    }

    function loadContacts() {
      lift ?{`SELECT name, email FROM contacts ORDER BY name`}.all()
    }
  }

  <h1>Contacts</h1>

  <form onsubmit=addContact()>
    <input bind:value=@name  placeholder="Name"  required/>
    <input bind:value=@email placeholder="Email" type="email" required/>
    <button type="submit">Add Contact</button>
  </form>

  <ul>
    ${
      for (let c of loadContacts()) {
        lift <li>${c.name} — ${c.email}</li>
      }
    }
  </ul>

</>

</program>
```

Here is what the compiler does that you do *not* write:

- **`<db>` connects the database.** Inside it, `?{…}` blocks are SQL — the
  compiler parameterizes and serializes them. `bind:value=@name` keeps each
  input and its reactive cell in sync.
- **The server boundary is inferred.** `persistContact` and `loadContacts`
  touch SQL, so the compiler classifies them server-side — and generates the
  route, the `fetch` call, CSRF tokens, parameterized queries, and
  serialization. You call them like local functions, because in your source
  they *are*.
- **`reset(@name)`** returns a reactive cell to its declared initial value.

Declare the app; the compiler wires server, client, and data. The sections
below go deeper — starting with the one idea the entire language is built on.

## Built around state machines

Here is that idea: **an app should be an exhaustive state machine.** The
structural shape of a shipped UI is the structural shape of its state — every
reachable state has UI, every transition is intentional, every effect fires at
the right moment. Provability falls out of the language's natural shape, not
from a separate proof ceremony — and you should barely notice it happening.

Apps don't start at that north star; they evolve toward it. The **Tier ladder**
lets you start as a rough prototype and add structure as the design hardens —
without rewriting the markup tree. State-children carry forward verbatim
between tiers; the wrapper swap is the commitment moment.

| Tier  | Form                                       | What you get                                                           |
|-------|--------------------------------------------|------------------------------------------------------------------------|
| **0** | `if=` chains / `${ if (...) lift ... }`    | prototype; no exhaustiveness check                                     |
| **1** | `<match for=Type [on=expr]>`               | structural exhaustiveness check at compile time; `rule=` is accepted + compiler-checked but inert at runtime (`W-MATCH-RULE-INERT` lint nudges promotion to Tier 2) |
| **2** | `<engine for=Type initial=.Variant>`       | full deal — exhaustiveness + active transition rules (`rule=`) + per-state effect handlers (`<onTransition>`, `<onTimeout>`, `<onIdle>`) + composite hierarchy + `history` restore |

Adding a new variant to the discriminating type later forces the compiler to
remind you where every transition into it should fire from. The state machine
evolves; the compiler enforces.

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

function fetchItems()! -> LoadError {
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

## Why scrml

**State is the declaration primitive.** `<count> = 0` declares a reactive cell;
`@count` reads or writes it. Compound, derived (`const <total> = expr`),
server-pinned (`<users server>`), linear, refinement-typed cells are all the
same primitive with different attributes. The compiler tracks the dependency
graph and re-renders on change.

**Engines are the centerpiece.** When state goes from "a few booleans" to "this
app has phases," you promote up the Tier ladder (above) without rewriting the
markup tree — `if=` chains, then `<match for=Type>`, then `<engine for=Type>`.
The engine declares legal transitions, runs cross-state effects, and enforces
that every variant has a UI block. The Engine Example above is the full shape.

**Full-stack in one file.** Markup, logic, styles, SQL, server functions, error
handling, realtime channels, inline tests — all in `.scrml`. The compiler
analyzes the code and splits server from client automatically. No API layer, no
route files, no API/UI drift.

**Errors are states, not booleans.** `try`/`catch` is not in scrml's vocabulary.
Failable functions surface errors as enum variants (`fn fetchItems()! ->
LoadError`); the `!{}` handler routes each variant into the right state. A
missing handler arm is a compile-time error — the failure modes live in the
type, not in `<isError>` boolean rubble.

**Validators auto-synthesize a validity surface.** Compound state with `req` /
`length` / other predicates produces reactive read-only `@form.isValid` /
`.errors` / `.touched` rollups plus per-field cells; `<errors of=@form/>`
renders them at the right time. The same predicate fires three places — state
validator, refinement type, schema column. No bilingual schema, no Zod.

**Automatic N+1 elimination.** A `for` loop whose body does `?{...where id =
${x.id}}.get()` is rewritten to one `WHERE id IN (...)` fetch plus a keyed
lookup — no DataLoader, no manual batching. Independent reads in a `!` handler
share one transaction envelope. (Opt-out, diagnostics, and measured wins:
Features → Server/Client and the benchmarks.)

**Realtime and workers as language primitives.** A `<channel>` block declares a
WebSocket endpoint — the compiler emits the upgrade route, reconnect, and
pub/sub routing; state declared inside auto-syncs across every connected client.
A nested `<program>` is a Web Worker (or WASM module, or sidecar) with typed RPC
and supervised restarts. No `new WebSocket()`, no `postMessage` plumbing.

**No npm.** scrml ships its own stdlib — sixteen modules (`auth`, `crypto`,
`data`, `http`, `router`, `store`, `time`, and more) covering the surface a
typical app reaches for. No package manager, no dependency trees, no
`node_modules`.

## Benchmarks

Measured against React 19, Svelte 5, and Vue 3 on an identical TodoMVC implementation. Bundle row re-measured 2026-05-15 against HEAD `1f73732` (v0.3.0 + v0.3.x Phase B SPA tree-shake). Runtime row re-measured 2026-05-19 against v0.3.3 HEAD (post-Phase 3 Candidate A select-row recovery) via real Chrome (Playwright headless). Build row carries forward from the 2026-05-14 v0.3.0 STABLE refresh. See [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) for full details + historical baselines.

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

**Runtime performance (headless Chrome via Playwright, medians in ms, lower is better) — 2026-05-19 v0.3.3 HEAD:**

| Operation | scrml | React 19 | Svelte 5 | Vue 3 | Vanilla JS |
|---|---:|---:|---:|---:|---:|
| create-1000 | 25.95 | 26.50 | 38.05 | 30.00 | **22.10** |
| replace-1000 | 26.35 | 25.10 | 38.50 | 28.30 | **22.90** |
| partial-update | **1.00** | 4.65 | 4.10 | 11.20 | 2.60 |
| delete-every-10th | 2.55 | 4.95 | 3.45 | 7.90 | **1.50** |
| clear-all | 3.65 | 3.65 | **3.25** | 3.80 | 3.45 |
| select-row | 0.30 | 0.60 | 0.00¹ | 0.00¹ | 0.10 |
| swap-rows | 2.20 | 20.30 | 3.55 | 7.80 | **1.00** |
| remove-row | 2.25 | 4.25 | 3.35 | 7.80 | **0.90** |
| create-10000 | 279.20 | 251.00 | 466.00 | 296.10 | **229.60** |
| append-1000 | 27.55 | 26.35 | 45.65 | 35.20 | **21.05** |

scrml wins outright on **partial-update** (4.65× faster than React, 4.10× faster than Svelte, 11.2× faster than Vue, **better than Vanilla**); within 5-25% of Vanilla on every bulk-DOM op; beats React on 5/10 + Svelte on 4/10 + Vue on 9/10. **select-row 0.30 ms** is the load-bearing recovery from v0.3.0 STABLE's 168.2 ms — **561× faster** (S103 Phase 3 Candidate A value-indexed subscriber dispatch + the `!=` detector follow-on). swap-rows 2.20 ms beats React by 9.2× and is within ~2× of Vanilla.

¹ Svelte/Vue `selectRow()` is a no-op in their bench API (inherited from the prior Puppeteer harness; not a real measurement). The load-bearing scrml number stands on its own at **0.30 ms** (vs 168.2 ms at v0.3.0 STABLE).

See [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) for full per-op breakdown, v0.3.0 → v0.3.3 recovery narrative, Chrome-vs-happy-dom cross-validation, and historical baselines.

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

- **Reactive state — V5-strict.** `<count> = 0` declares a reactive cell; `@count` reads or writes it. The decl form is structural; the access form is canonical. The two forms are visually distinguishable, so a reader can scan a function body and count "how many state cells does this read or mutate." Bare names in expressions are LOCAL identifiers only — they do NOT resolve to reactive state (locals cannot shadow registered state names; `E-NAME-COLLIDES-STATE`). The declaration/write distinction is enforced — bare `@x = expr` at default-logic body-top (a `<program>` / `<page>` / `<channel>` body) fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`: declarations use structural `<x>`, writes go inside `${...}` functions.
- **Three RHS shapes for state decls.** Shape 1 plain (`<count> = 0`), Shape 2 decl-coupled-with-render-spec (`<userName req length(>=2)> = <input/>` — `<userName/>` in markup expands to the bound input with `bind:value` wired), Shape 3 derived (`const <doubled> = @count * 2` — read-only; recomputes on dep change; markup-typed derived cells legal per L1).
- **Compound state (Variant C).** `<formRes> <name> = "" <email> = "" </>` — ad-hoc compound via structural children. Read `@formRes.name`; write `@formRes.email = "alice"`. Tier 3 predefined-shape compound supports positional sugar against a known type.
- **Two-way binding (`bind:value`)** — compiler dispatches binding by render-spec (`<input type="checkbox">` → `bind:checked`; `<select>` → `bind:value`; etc.). Per L17.
- **Absence value (`not`)** — a unified null/undefined replacement. `<result> = not` means "no value yet." Check with `is some` / `is not`. `== not` misuse is `E-SYNTAX-042` at compile time. null and undefined never appear in scrml — library mode inclusive.
- **Server-pinned + protected state.** `<users server>` pins state server-side so it never reaches the browser. `protect=` on struct fields hides them from the client schema view. Both enforced at compile time.

### Linear Types

- **Exact-once consumption (`lin`)** — values that must be used exactly once, with restricted intermediate visibility between declaration and consumption. The compiler verifies this statically across branches, loops, closures, and cross-`${}` blocks. See [SPEC §35](compiler/SPEC.md) for the normative surface.
- **The `~` pipeline accumulator** — an unbound expression statement drops its result into `~`; the next statement consumes it. `step1(x)` then `return step2(~)` — no name on a value used exactly once, the same cleanliness as a ternary, for pipelines. `~` is itself a built-in `lin` variable: exactly-once consumption, compiler-checked, scope-local to each `${}` body and function body. Misuse (`~` read twice, read uninitialized, reinitialized before consumption) is a compile error — `E-TILDE-001` / `E-TILDE-002`. See [SPEC §32](compiler/SPEC.md) and [`examples/24-tilde-pipeline.scrml`](examples/24-tilde-pipeline.scrml).

### Type Safety

- **`asIs` (not `any`)** — scrml has no `any` type. There is no "turn off the type checker" escape hatch. `asIs` accepts any type but forces you to resolve it to a concrete type before use or return — analogous to TypeScript's `unknown`, not `any`. Component bare props follow `asIs` rules: the compiler infers the concrete type from how you use the prop.

### Runtime Type Validation (replaces Zod)

scrml has built-in runtime type validation. The type annotation IS the validation schema — no separate schema library, no `z.object()` wrappers, no `z.infer<typeof>` indirection.

```scrml
// gate: skip — illustrative fragments (no <program> wrapper; not standalone-runnable)
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

### Type-Derived Apps — `formFor` / `schemaFor` / `tableFor`

A struct type drives the form, the schema, and the table — no schema duplication, no model-to-DTO translation, no view-model boilerplate. The same predicates that validate the values also derive the right HTML form controls and the right SQL column types.

```scrml
// gate: skip — illustrative; shows the three call-sites against one struct type
import { formFor, schemaFor, tableFor } from "scrml:data"

type Contact:struct = {
    name:  string(.length > 0)
    email: string(email)
    phone: string(phone)?
}

// formFor — render a complete form from the type
<formFor for=Contact onsubmit=save/>

// schemaFor — emit SQL DDL from the type, inside a <schema> block
<schema>${ schemaFor(Contact) }</schema>

// tableFor — render a <table> from the type plus row data
<tableFor for=Contact rows=@contacts/>
```

Each primitive reads the struct field validators directly: `string(email)` becomes a `<input type="email">` form control AND a `TEXT CHECK(...)` column. Add a field to `Contact` and form / schema / table all gain it at the next build — no second source of truth to keep in sync. `pick=["a","b"]` / `omit=["secret"]` / `partial=true` shape the field set per call site; `<slot name="fieldName">` overrides a single field's render.

See [`examples/26-type-derived-schema.scrml`](examples/26-type-derived-schema.scrml) and [`examples/27-type-derived-table.scrml`](examples/27-type-derived-table.scrml) for the schemaFor + tableFor examples. A `formFor` worked example is pending.

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

- **One source file type, layered imports** — scrml has one source file type, `.scrml`, and code enters a build through a small set of explicit, layered surfaces, never an open-ended transitive dependency graph. **The no-npm stance is not a no-user-code stance** — you bring whatever code your app needs, third-party code included; the rule is only that it enters through an explicit, named surface, not an implicit auto-resolved dependency graph. `import` wires `.scrml` modules within a project. The `scrml:*` standard library is bundled with the compiler and version-locked to it — no registry, no separate semver, ~88–90% of a typical app's third-party needs already on the shelf. Everything beyond that crosses a named, governed boundary: `_{}` foreign code\* for inline non-scrml escapes, `import:host`\* for the bounded self-host bridge, and `vendor:`\* for third-party units — physical source copies you own, content-addressed by hash so identity is bytes not names, and capability-gated so a vendored unit reaches the network, filesystem, or host code only where your project manifest explicitly grants it. There is no central registry and nothing is fetched without you asking.

  *\* `_{}` foreign code and `import:host` are specified, not yet implemented; `vendor:` is a ratified design direction with its mechanism still under debate.*
- **`<program>` root** — configure database connections, protection rules, HTML spec version, and program-wide settings from a single root element.

### LLM Agent Integration — `scrml:mcp`

> *V0 foundation shipped (stdlib + 11 tools + descriptor sidecars). The `<program mcp="dev-only">` adopter opt-in + end-to-end docs land in the next release.*

scrml ships a Model Context Protocol surface so an LLM agent (Claude Code, Cursor, any MCP client) can read your running scrml app's structure first-hand instead of guessing. The compiler emits descriptor sidecars (`engines.json`, `forms.json`, `channels.json`, `serverfns.json`) at build time, and the `scrml:mcp` stdlib exposes them over MCP stdio as 11 read-only tools:

| Tool | Surfaces |
|---|---|
| `get_app_topology` | the whole `<program>` tree shape |
| `list_engines` / `get_engine` | engine state machines + current variant + legal transitions |
| `list_forms` / `get_form_status` | form validity surfaces + per-field touched / errors |
| `list_routes` / `get_route_chunks` | route table + which chunks each route loads |
| `list_server_functions` | enumerable server-fn surface (V0 read-only — `dispatchable: false`) |
| `list_channels` / `get_channel_state` | active WebSocket channels + shared state |
| `get_reachable_server_fns` | per-route reachable server-fn closure |

The strategic frame: the same structural exhaustiveness that makes a scrml app provable to a compiler — engines as exhaustive state machines, typed enums, V5-strict access, explicit `rule=` contracts, whole-program inference — makes it introspectable to an agent. Other frameworks reach for LLM-friendliness at the tools layer; scrml gets it at the language layer.

V0 is read-only metadata. A future V1 would add server-fn dispatch behind a capability gate.

### Recently Landed Quality Wins

A short selection of silent-failure classes closed in v0.6.x:

- **Precedence-preserving binary emission** — grouped expressions like `(2+3)*4` no longer drop the grouping parens during codegen (Bug W).
- **`not` keyword no longer corrupts regex literals** — the lowering pass skips regex bodies + comments + string interiors (GITI-017; silent-corruption class closed).
- **Runtime chunker tree-shake fix** — `_scrml_destroy_scope` declaratively pulls in its timer + animation helpers; no more orphan-helper class (6nz-P).
- **Default-logic body-top writes surface loudly** — bare `@x = expr` at `<program>` body top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT` instead of silently no-op'ing (Bug Q via S123 Unit CC).

The compiler is actively hardening; see [`docs/changelog.md`](./docs/changelog.md) for the full landing log.

### The Build Story

> *Nominal — scrml's compiler model as designed. Specified in [SPEC §58](compiler/SPEC.md); compiler implementation pending. `*` marks a claim not yet actual.*

scrml's compiler has a build story. Compilation is a pure function of two inputs — your source and an explicit, committed **build story** that pins what "the compiler" is: a content-addressed Merkle closure over the compiler-proper's four components — compiler source, language tools, the standard library, and any vendored edge code — one root hash with the dependency edges between them *inside* the hash, plus a human-inspectable `build-story.lock` sidecar. Because every part — the compiler included — is identified by the hash of its content, customizing the compiler to your project and reproducing any build bit-for-bit\* stop being in tension: a tuned compiler is just a different pinned build story, and "pinned" is what makes it portable.

A build story can be pinned per `<program>` — `<program story="…">`\* — and because nested `<program>` contexts are already isolated, shared-nothing compilation units, different parts of one application can be built by different compilers, each independently reproducible. This is deliberately not a live or hot-swappable compiler: every build story is static, read once before parsing begins; only *authorship* is customizable, never the running compile.

<sub>\* The bit-for-bit guarantee requires a whole-compiler determinism audit not yet done. The build-story artifact and the `<program story=>` attribute are specified in SPEC §58 but not yet implemented in the compiler.</sub>

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
| [23-trucking-dispatch](examples/23-trucking-dispatch/) | Multi-page auth-bearing app — real `/login`, role gates, per-route chunks |
| [24-tilde-pipeline](examples/24-tilde-pipeline.scrml) | `~` pipeline accumulator — last-unbound-expression carry-forward |
| [25-triage-board](examples/25-triage-board.scrml) | Drag-and-drop between columns, struct + enum state |
| [26-type-derived-schema](examples/26-type-derived-schema.scrml) | `schemaFor(Type)` — SQL DDL generated from a struct |
| [27-type-derived-table](examples/27-type-derived-table.scrml) | `tableFor(Type, rows)` — a `<table>` generated from a struct |

## Documentation

- [Tutorial](docs/tutorial.md) — step-by-step introduction, zero to full-stack
- [Design Notes](DESIGN.md) — rationale and philosophy — why scrml is what it is
- [Language Specification](compiler/SPEC.md) — full formal spec (~29,000 lines)
- [Spec Quick-Lookup](compiler/SPEC-INDEX.md) — find any section fast
- [Pipeline Contracts](compiler/PIPELINE.md) — stage-by-stage compiler pipeline

> **Note on code snippets.** This README's ```scrml fenced examples are
> compile-gated on every release-tag push (`v0.X.Y`) — they must compile
> clean and lint clean against the tagged compiler. Snippets in the
> tutorial, articles, and reference pages are NOT gated and may use
> in-flight syntax, intentional fragments, or pre-v0.X authoring shapes;
> treat those as illustrative, not always-runnable, at any given commit.
> Snippets here marked with a leading `// gate: skip` comment are
> intentionally illustrative fragments (e.g., they show a state-decl
> shape without a full `<program>` wrapper).

## scrmlTS

The working compiler for **scrml** — a single-file, full-stack reactive web language.
This is the TypeScript/JavaScript implementation that compiles `.scrml` source into
HTML, CSS, client JS, and server route handlers in a single pass.

scrml lets you write a complete app in one file: markup, reactive state, scoped CSS,
SQL, server functions, and inline tests — no build config, no separate server file,
no state management library.

**Current state — v0.7 in flight.** Live phase status: [`master-list.md` §0](./master-list.md) · recent landings: [`docs/changelog.md`](./docs/changelog.md) · known spec-vs-impl gaps + per-gap workarounds: [`docs/known-gaps.md`](./docs/known-gaps.md).

### What's in here

- `compiler/` — compiler source, the authoritative `SPEC.md` (~29,000 lines / §58 + appendices) / `SPEC-INDEX.md` / `PIPELINE.md`, **19,000+ tests**, and reference self-host modules
- `examples/` — **27 runnable single-file scrml apps + the trucking-dispatch multi-page app**
- `samples/compilation-tests/` — **289 compilation tests** covering every accepted construct
- `stdlib/` — **16 user-facing stdlib modules** (`auth`, `crypto`, `data`, `format`, `fs`, `http`, `path`, `process`, `router`, `store`, `test`, `time`, `redis`, `cron`, `regex`, `oauth`)
- `benchmarks/` — runtime, build, and full-stack benchmarks vs React / Svelte / Vue
- `editors/vscode/`, `editors/neovim/` — editor integrations
- `lsp/server.js` — language server
- `dist/scrml-runtime.js` — shared reactive runtime

For recent fixes and work currently in flight, see [`docs/changelog.md`](./docs/changelog.md).



## Quick start

```bash
# Install Bun if you don't have it — https://bun.sh
curl -fsSL https://bun.sh/install | bash

# Install scrmlTS dependencies
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

## License

MIT — see [LICENSE](./LICENSE).

## Related projects

- **[giti](https://github.com/bryanmaclee/giti)** — a collaboration platform and git alternative designed around scrml's compiler strengths. The CLI (save, switch, merge, undo, history, status, land, init, describe, sync) wraps jj (jujutsu) as the engine until the scrml compiler can do AST-level conflict resolution natively. Long-term vision is a hosted forge; GitHub is the stopgap.
- **[6nz](https://github.com/bryanmaclee/6NZ)** — a purpose-built code editor for the scrml ecosystem. An "Interactive Development Experience" written entirely in scrml, with a focus-centered viewport, NeoVim-superset keybindings plus mouse, CodeMirror 6 + canvas overlay, and offline-first PWA delivery. Currently in design phase, awaiting compiler API exposure in scrmlTS. The companion [Z-motion input spec](https://github.com/bryanmaclee/6NZ/tree/main/z-motion-spec) is released under CC0 so others can adopt it.

## Status

scrml is open source under the [MIT License](./LICENSE) and shipping today — `bun link` and the compile is real. The spec evolves as we find friction; the compiler catches up. See [`docs/changelog.md`](./docs/changelog.md) for what just landed and what's in flight.

The compiler runs on [Bun](https://bun.sh). Compiled output is plain JavaScript that runs in any browser or JavaScript runtime.
