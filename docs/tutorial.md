# scrml Tutorial — zero to a running app

This tutorial walks you from an empty directory to a small but complete scrml app: a counter that persists to SQLite, a multi-step signup form with declarative validation, an `<engine>`-driven state machine, and a real-time channel. Every snippet here is a working `.scrml` file in `docs/tutorial-snippets/`; the compile step at the start of each section runs against the real compiler.

**Audience.** You have written some JavaScript or TypeScript and used at least one reactive framework (React, Svelte, Vue, Solid). You have a passing familiarity with HTML and SQL. You do not need to know anything about scrml before reading this.

**What scrml is, in one paragraph.** scrml is a single-file language for full-stack web apps. One `.scrml` file compiles to the HTML, JavaScript, CSS, and server routes the app needs. Markup, reactive state, server functions, SQL, real-time channels, and tests all live in the same file; the compiler decides which half runs in the browser and which half runs on the server. The unit of organization is the program, not the tier.

**What this tutorial covers.** The v0.2.4 canonical surface — the syntax and idioms ratified through the S52-S84 deliberation arc. If you find older material online that disagrees with this document (especially anything from before April 2026 — `< machine>` instead of `<engine>`, `@var = 0` for declaration instead of `<var> = 0`, `null`/`undefined`/`===`/`!==` JavaScript literals instead of `is some` / `is not` / `==` / `!=`), trust this document. scrml is post-training-cutoff for every LLM, and the language has shifted since.

**Prerequisites.** Working knowledge of JavaScript syntax (`const`/`let`, arrow functions, template strings) and the DOM event model. A passing acquaintance with SQL helps for §2 onward but is not required — every SQL example uses only `SELECT` and `INSERT`.

---

## 0. Setup — `scrml init` and the dev loop

scrml ships as a single binary that runs under [Bun](https://bun.sh). Install Bun first, then scaffold a new project:

```
curl -fsSL https://bun.sh/install | bash
scrml init my-app
cd my-app
scrml dev
```

`scrml init my-app` creates a new directory with a single `.scrml` file, a `package.json`, and a `bunfig.toml`. `scrml dev` compiles and serves the file with hot reload — edit, save, see the result in your browser.

If you are following along inside this repository instead of starting fresh, every code block in this tutorial has a matching snippet under `docs/tutorial-snippets/`. To compile any one of them directly:

```
bun compiler/bin/scrml.js compile docs/tutorial-snippets/02-counter.scrml
```

The compiler emits the built artifacts (HTML, JS, CSS, and, when relevant, a small server) and prints a summary. For this tutorial, the compile step alone is enough to confirm a sample is well-formed; the project's `examples/` directory holds longer end-to-end programs to run.

The CLI surface is small enough to memorize:

```
scrml init [dir]       — scaffold a new project
scrml dev <file|dir>   — compile + watch + serve (with hot reload)
scrml build <dir>      — production build
scrml compile <file>   — one-shot compile to ./dist/
```

There is no `scrml.config.js`, no `defineConfig`, no `tailwind.config.js`. The dev server is part of the language tooling.

---

## 1. The shape of a scrml file

Every scrml program is one `<program>` element. Inside it, a `${ ... }` logic block holds declarations and functions, and the rest is markup. Here is the smallest useful program:

```scrml
// 01-hello.scrml — the minimal program. Plain text in markup, no state.

<program>

<h1>Hello, scrml!</h1>
<p>This file compiles to HTML + JS + CSS.</p>

</program>
```

There is no `<html>`, no `<head>`, no `<body>` — the compiler wraps what you write in a proper document shell. Anything outside `<program>` is reserved for sibling top-level elements you will meet later (`<channel>`, `<schema>`). Comments use `// ...` and `/* ... */` and are allowed anywhere.

A `<program>` body holds three kinds of content:

1. **Markup** — HTML elements (`<div>`, `<p>`, `<form>`, ...) plus a small set of scrml-specific extensions (`bind:value`, `class:active`, `onclick=`, `if=`, `for`/`lift`).
2. **`${ ... }` logic blocks** — JavaScript-shaped statements: declarations, functions, imports. Inside markup, `${expression}` is an interpolation slot that substitutes the expression's value.
3. **`#{ ... }` style blocks** — scoped CSS for the program. (See §2.3.)

Tag closing has three forms: explicit `</tagname>`, shorthand `</>` (closes the most recently opened tag), and a trailing `/` on void elements (`<br/>`). The shorthand `</>` is the canonical scrml closer; use it freely.

---

## 2. The counter — reactive state, V5-strict access

The classic first program in any reactive language: a counter with a `+` button. Here it is in scrml:

```scrml
// 02-counter.scrml — reactive state, V5-strict declaration form.

<program>

${
  <count> = 0

  function inc() { @count = @count + 1 }
  function dec() { @count = @count - 1 }
}

<div>
  <h1>Counter: ${@count}</h1>
  <button onclick=dec()>−</button>
  <button onclick=inc()>+</button>
</div>

</program>
```

Three things are happening here, and they are the load-bearing rules of the language:

1. **`<count> = 0` declares a reactive state cell.** The structural form `<name> = init` is the V5-strict declaration syntax. The compiler registers `count` as reactive for the rest of the file.

2. **`@count` reads or writes the cell.** The `@` sigil marks every state touch in an expression — read in `${@count}`, read on the right of `=`, write on the left. Bare `count` (no `<>` or `@`) is a LOCAL identifier, never reactive state.

3. **`onclick=inc()` is a bare call expression.** The handler is a function call, not a string. Parentheses are mandatory; arguments work as you would expect (`onclick=remove(item.id)`).

The asymmetry between `<count>` for declaration and `@count` for expression access is deliberate. It makes every state touch visually distinguishable from local-variable touch — you can scan a function body and count "how many state cells does this function read or mutate" at a glance. This is load-bearing for both human readability and the compiler's static analysis.

**Why this matters in practice.** If you write `let count = 5` after `<count> = 0`, the compiler emits `E-NAME-COLLIDES-STATE`. Local names cannot shadow registered state names — a refactor that accidentally shadows state is caught at compile time, not at runtime.

Compile and run:

```
bun compiler/bin/scrml.js compile docs/tutorial-snippets/02-counter.scrml
```

The output goes to `./dist/`. Open `dist/02-counter.html` and you have a working counter.

### 2.1 Derived state — `const <name> = expr`

When a value is a pure function of other reactive state, declare it with `const <name>`:

```scrml
// 02a-derived.scrml — derived state recomputes whenever inputs change.

<program>

${
  <count> = 0
  const <doubled> = @count * 2
  const <parity> = @count % 2 == 0 ? "even" : "odd"

  function inc() { @count = @count + 1 }
}

<div>
  <p>Count: ${@count}</p>
  <p>Doubled: ${@doubled}</p>
  <p>Parity: ${@parity}</p>
  <button onclick=inc()>+</button>
</div>

</program>
```

`const <doubled> = @count * 2` reads as "whenever any reactive input on the right changes, recompute the expression." The dependency graph is tracked automatically — you never list dependencies explicitly. Reading the derived cell uses `@doubled`, same as a plain reactive.

Derived cells are **reference-immutable**: `@doubled = 99` is `E-DERIVED-WRITE`. The value can change (when `@count` changes), but you cannot assign to it from your code.

### 2.2 Persisting the counter — `<schema>`, `<db>`, `?{}`

A counter in memory is gone the moment you refresh the page. Let's persist it. scrml has a built-in database layer — no `npm install better-sqlite3`, no Prisma, no schema files in a separate directory. You declare the database shape in a `<schema>` block at the top of the file, open a connection with `<db>`, and write parameterized SQL with `?{}`:

```scrml
// 02b-counter-persisted.scrml — counter that survives a refresh.

<schema>
  counters {
    id:    integer primary key
    value: integer not null default(0)
  }
</>

<program>

<db src="counter.db" tables="counters">

  ${
    <count> = loadCount()

    // No `server` keyword needed — these functions escalate to the server
    // automatically because they touch a `?{}` SQL block. (Body-content
    // inference, Insight 26 — the `server` keyword is deprecated.)
    function loadCount() {
      const row = ?{`SELECT value FROM counters WHERE id = 1`}.get()
      return row is some ? row.value : 0
    }

    function persistCount(n) {
      ?{`INSERT INTO counters (id, value) VALUES (1, ${n})
         ON CONFLICT(id) DO UPDATE SET value = ${n}`}.run()
    }

    function inc() {
      @count = @count + 1
      persistCount(@count)
    }

    function dec() {
      @count = @count - 1
      persistCount(@count)
    }
  }

  <div>
    <h1>Persistent counter: ${@count}</h1>
    <button onclick=dec()>−</button>
    <button onclick=inc()>+</button>
  </div>

</>

</program>
```

Compare to §2's in-memory counter. The markup is identical. The function shape is identical. Three additive changes:

1. **`<schema>`** at the top of the file declares the database schema. `counters { id: integer primary key, value: integer not null default(0) }` reads as a small DDL. The compiler diffs this against the live database and generates migrations — you never write `ALTER TABLE` by hand.
2. **`<db src="counter.db" tables="counters">`** opens the database connection and lists the tables this program is allowed to access. The UI nests inside the `<db>` block, which makes the database scope visually obvious.
3. **Server-side functions are inferred from their bodies.** `loadCount` and `persistCount` touch `?{}` SQL blocks, which are server-only. The compiler escalates the functions to server-side automatically — no `server` keyword needed. (The `server` keyword is deprecated as of Insight 26, 2026-05-08; older code that uses it still compiles, but new code should not.)

The `?{`SELECT ...`}` form holds parameterized SQL. The backtick string is the query; `${var}` interpolations become bound parameters automatically — even if `var` contains quotes or semicolons, it is treated as data, not SQL. Injection is impossible by construction. The methods are `.run()` (INSERT/UPDATE/DELETE), `.get()` (single row or null), and `.all()` (array of rows).

> **Note on `is some`.** scrml has no `null` or `undefined` keyword in source. The presence check is `value is some` (true when defined and non-null) and the absence check is `value is not` (true when null or undefined). This is the canonical scrml shape for what JavaScript spells as `value !== null && value !== undefined`. You write `==` and `!=` for equality (`==` does strict comparison; `===` does not exist).

The one rule that distinguishes server functions from client functions is that **server-escalated functions must not assign to reactive state** (`E-RI-002`). State transitions belong on the client; the server's job is to fetch and persist. A client function calls a server-escalated function for data, then updates state with the result. The compiler propagates server-side classification through the call graph: if `addContact()` calls server-escalated `persistContact()`, the assignment to `@name = ""` inside `addContact` is checked in client context. The canonical idiom is to call `reset(@name)` instead of `@name = ""` after the server call — `reset()` is a language keyword that goes through the client-side reset path unambiguously.

### 2.3 Styling — `#{}` scoped CSS and Tailwind utilities

scrml has two styling tools, used together or apart depending on taste.

```scrml
// 02c-styles.scrml — scoped CSS via #{}.

<program>

${ <count> = 0 ; function inc() { @count = @count + 1 } }

<div class="card">
  <h1>${@count}</h1>
  <button onclick=inc()>+</button>
</div>

#{
  .card {
    max-width: 280px;
    margin: 2rem auto;
    padding: 1.5rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-align: center;
  }
  button {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 1.25rem;
  }
}

</program>
```

The `#{ ... }` block holds CSS scoped to this program. The compiler rewrites class names and wraps bare tag selectors so they cannot leak — the same technique Svelte and CSS Modules use, built into the file format.

scrml also supports Tailwind utility classes out of the box. The compiler scans class attributes at build time and emits only the utilities the program actually uses:

```scrml
<div class="max-w-sm mx-auto mt-8 p-6 border rounded-lg text-center">
  <h1 class="text-3xl font-bold">${@count}</h1>
  <button class="mt-2 px-4 py-2 bg-blue-600 text-white rounded" onclick=inc()>+</button>
</div>
```

No `tailwind.config.js`, no separate build step. A small program that uses ten utilities ships exactly those ten utilities' worth of CSS.

Pick `#{}` for one-off bespoke styling, Tailwind for shared design-system utilities, both together when each fits a different problem. There is no performance difference between them.

---

## 3. Lists, components, iteration

The next step beyond a counter is a list. Here is a small todo app — keep the data in memory for now (we'll persist it in §6 alongside SQL):

```scrml
// 03-todos.scrml — in-memory todos with for/lift, components, and bind:value.

<program>

${
  type Todo:struct = { id: number, body: string, done: boolean }

  <items>: Todo[] = []
  <draft> = ""
  <nextId> = 1

  function add() {
    if (@draft == "") return
    @items = [...@items, { id: @nextId, body: @draft, done: false }]
    @nextId = @nextId + 1
    @draft = ""
  }

  function toggle(id) {
    @items = @items.map(t => t.id == id ? { ...t, done: !t.done } : t)
  }

  function remove(id) {
    @items = @items.filter(t => t.id != id)
  }

  const TodoRow = <li class="row" props={ item: Todo }>
    <input type="checkbox" checked=@item.done onchange=toggle(@item.id)/>
    <span class:done=@item.done>${@item.body}</span>
    <button onclick=remove(@item.id)>x</button>
  </li>
}

<div class="todo-app">
  <h1>Todos</h1>
  <form onsubmit=add()>
    <input type="text" bind:value=@draft placeholder="What's next?"/>
    <button type="submit">Add</button>
  </form>
  <ul>
    ${
      for (let t of @items) {
        lift <TodoRow item=t/>
      }
    }
  </ul>
</div>

#{
  .todo-app { max-width: 420px; margin: 2rem auto; font-family: sans-serif; }
  form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  input[type="text"] { flex: 1; padding: 0.5rem; }
  .row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; }
  .row .done { text-decoration: line-through; color: #999; }
}

</program>
```

Several pieces of scrml's shape show up at once here. Let's name them.

### 3.1 `type Name:struct = { ... }` — structural record types

A struct type names a record shape with typed fields. Instances are plain object literals; there are no constructors:

```scrml
type Todo:struct = { id: number, body: string, done: boolean }
```

The type-annotation form `<items>: Todo[] = []` declares the cell with an explicit type — the compiler carries the annotation through reads and writes, and into `match` arms. For a single value, the annotation goes after the structural-name form: `<phase>: LoadPhase = .Idle`.

### 3.2 `for`/`lift` iteration

Inside an interpolation slot, a `for` loop iterates. To emit markup from the loop body you use the `lift` keyword — it says "lift this node into the surrounding markup":

```scrml
${
  for (let t of @items) {
    lift <TodoRow item=t/>
  }
}
```

The `${ ... }` inside `<ul>` is a logic block because its body is a multi-statement `for`. Each iteration's `lift` produces a new sibling child of the surrounding `<ul>`. Without `lift`, the markup inside the loop would be an unused expression — `lift` is what marks an expression as something to attach to the DOM.

`for`/`lift` reacts to changes in the iterated reactive: reassign `@items = [...@items, newItem]` and the loop re-evaluates, producing the new `<li>` without re-rendering the whole list.

> **An important detail about reactivity.** Scrml tracks **reassignments of `@vars`**, not mutations of the underlying value. `@items.push(x)` does not trigger a re-render — `@items = [...@items, x]` does. The same pattern applies for objects: `@user.name = "Ada"` does not re-render, `@user = { ...@user, name: "Ada" }` does. This is the same idiom as React's `setState`, and it keeps the reactivity model simple and predictable.

### 3.3 Components

A component in scrml is a `const` bound to a markup expression inside a `${ ... }` block. It is invoked by name in markup like a custom element. Props are declared via a `props={...}` attribute on the root element of the component body:

```scrml
const TodoRow = <li class="row" props={ item: Todo }>
  <input type="checkbox" checked=@item.done onchange=toggle(@item.id)/>
  <span class:done=@item.done>${@item.body}</span>
  <button onclick=remove(@item.id)>x</button>
</li>
```

The convention is that component names are capitalized so the parser can distinguish them from lowercase HTML tags. Props are typed; calling a component with a missing required prop or the wrong type is a compile error. Each component instance has its own state scope, so two `<Counter/>` tags render two independent counters.

The closer of a component is `</>` (or the explicit tag name), same as any element. `bind:value`, `class:done`, and `onchange=fn()` work on component-internal markup exactly as they do on plain HTML.

### 3.4 Attribute extensions — `bind:`, `class:`, `on<event>`

The handful of scrml-specific attributes shown in the todo app:

- **`bind:value=@draft`** — two-way binding on a form control. Typing in the input updates `@draft`; writing to `@draft` from elsewhere updates the input. Works on `<input>`, `<select>`, `<textarea>`, and checkbox/radio inputs.
- **`class:done=@item.done`** — adds or removes the CSS class `done` based on the truthiness of the expression. Multiple `class:` bindings stack independently; a `class="row"` on the same element remains intact.
- **`onclick=remove(@item.id)`**, **`onsubmit=add()`**, **`onchange=toggle(@item.id)`** — event handlers as bare call expressions. The handler is a function call, not a string. Inside a `for` loop, you pass the current item to the handler with normal scrml-expression arguments. For the rare case where you need the native event object, use `onclick=${(e) => handle(e)}` — an arrow inside an interpolation slot.

There is no `<script>` tag, no JSX braces, no Svelte directives. The shape is "HTML, plus a few attribute-looking names with scrml-specific compile-time meaning."

### 3.5 Conditional rendering — `if=`, `else-if=`, `else`

Show or hide an element by putting `if=expr` on it. Chains use sibling elements with `else-if=expr` and a bare `else`:

```scrml
<p if=(@items.length == 0)>No todos yet — add one above.</p>
<ul else>
  ${ for (let t of @items) { lift <TodoRow item=t/> } }
</ul>
```

A bare `else` is the one attribute in scrml that takes no `=` and no value — `<ul else>` is the literal syntax. Spelling it as `else=true` is a parse error. The chain runs over sibling elements at the same parent level; exactly one branch is shown at a time.

For exhaustive branching over the variants of an enum, prefer `<match for=Type>` (§4.2) — adding a new variant later forces every match site to update, which a chain of `if=`s does not.

---

## 4. Engines — the Tier-0 → Tier-1 → Tier-2 ladder

When the UI has more than one mode — loading vs loaded, idle vs active, draft vs submitted vs paid — you have a state machine, whether you spell it that way or not. scrml's centerpiece is the **engine**: a first-class state machine that owns part of (or all of) the UI tree.

The language gives you a three-rung ladder for promoting "this UI has modes" into "this UI is a fully-handled state machine." You start at Tier 0 — boolean flags and `if=` chains — and promote toward Tier 2 — a full `<engine>` — as the design firms up. Promotion is **additive and mechanical**: state-children carry forward verbatim, only the wrapper changes.

### 4.1 Tier 0 — `if=` chains over booleans

For a prototype, two or three booleans gating sibling elements is usually fine:

```scrml
<div if=@loading>Loading…</div>
<div else-if=@error>Error: ${@error}</div>
<div else>Welcome.</div>
```

This is correct scrml. It is also a candidate for promotion: as soon as you reach for a third or fourth boolean to model the same "phase of this screen," you have a state machine in everything but name. The compiler will eventually nudge with `W-LIFECYCLE-CANDIDATE` to suggest the upgrade.

### 4.2 Tier 1 — `match expr { ... }` over an enum

The first commitment step is to name the screen's phases as an enum and dispatch on it with `match`:

```scrml
// 04a-tier1-match.scrml — Tier 1: enum + match expression dispatch.

<program>

${
  type LoadPhase:enum = {
    Idle
    Loading
    Loaded(rows: number)
    Failed(msg: string)
  }

  <phase>: LoadPhase = .Idle

  function load() {
    @phase = .Loading
    @phase = LoadPhase.Loaded(42)        // fake result for the demo
  }

  function reset_phase() { @phase = .Idle }
}

<div>
  ${
    match @phase {
      .Idle        => { lift <button onclick=load()>Load</button> }
      .Loading     => { lift <p>Loading…</p> }
      .Loaded(n)   => { lift <p>Got ${n} rows.</p>
                        lift <button onclick=reset_phase()>Reset</button> }
      .Failed(msg) => { lift <p class="err">Failed: ${msg}</p>
                        lift <button onclick=reset_phase()>Try again</button> }
    }
  }
</div>

</program>
```

Three things are new:

1. **An enum type.** `type LoadPhase:enum = { Idle, Loading, Loaded(rows: number), Failed(msg: string) }` declares a tagged sum type. `Idle` and `Loading` carry no payload; `Loaded(rows: number)` and `Failed(msg: string)` each carry one. The whole shape is "one of these four, exactly."

2. **The reactive holds an enum value.** `<phase>: LoadPhase = .Idle` declares `phase` as a `LoadPhase` reactive starting in `.Idle`. The leading `.` is bare-variant inference — the compiler infers `.Idle` as `LoadPhase.Idle` because the cell's type is statically known. Inside a function-call argument position the inference doesn't always fire, so `LoadPhase.Loaded(42)` qualifies the constructor explicitly.

3. **`match @phase { .Variant(binding) => { lift ... } }`** dispatches on the reactive's variant inside a logic block. Each arm pattern-matches one variant; payload variants destructure inline (`.Loaded(n)` binds the payload's `rows` field to the local `n`). The `lift` keyword inside each arm marks the produced markup as something to attach to the surrounding DOM.

`match` is exhaustive. Adding a fifth variant to `LoadPhase` later — say `Cached(rows: number)` — turns every match site into a compile error until you add the new arm. That is the main benefit of enums + `match` over a chain of `if=`s: the compiler will tell you exactly where to update.

> **Note on the structural `<match for=Type on=expr>` block.** A first-class markup-element form for Tier 1 dispatch — `<match for=LoadPhase on=@phase> <Idle>...</> </>` — is in the spec and tracked for a future release. Until that parser lands, the JS-style `match expr { ... }` inside a logic block (shown above) is the canonical Tier-1 dispatch form. The exhaustiveness check, payload destructuring, and engine promotion ladder are identical between the two; only the syntactic shape differs.

### 4.3 Tier 2 — `<engine for=Type initial=...>` with `rule=` transitions

The full engine surface adds three additive concepts to the Tier-1 shape: an `initial=` state, a `rule=` attribute on each state-child declaring legal transitions out, and `<onTransition>` blocks for cross-state effects. The engine is declared at **file level** (a sibling of `<program>`, not a child) and its state-children are empty in the current parser — markup uses a `match` block inside `<program>` to render based on the auto-declared variable.

```scrml
// 04b-tier2-engine.scrml — Tier 2: <engine> with rule= contracts.

${
  type LoadPhase:enum = {
    Idle
    Loading
    Loaded(rows: number)
    Failed(msg: string)
  }

  function load() {
    @loadPhase = .Loading
    @loadPhase = LoadPhase.Loaded(42)        // fake result for the demo
  }
}

<engine for=LoadPhase initial=.Idle>
  <Idle    rule=.Loading></>
  <Loading rule=(.Loaded | .Failed)></>
  <Loaded  rule=.Idle></>
  <Failed  rule=.Idle></>
</>

<program>

<div>
  ${
    match @loadPhase {
      .Idle        => { lift <button onclick=load()>Load</button> }
      .Loading     => { lift <p>Loading…</p> }
      .Loaded(n)   => { lift <p>Got ${n} rows.</p>
                        lift <button onclick=${@loadPhase = .Idle}>Reset</button> }
      .Failed(msg) => { lift <p class="err">Failed: ${msg}</p>
                        lift <button onclick=${@loadPhase = .Idle}>Try again</button> }
    }
  }
</div>

</program>
```

Read it as: "the engine owns the `LoadPhase` enum, starts in `.Idle`, declares the legal transitions out of each variant, and the program renders the right markup for the current phase."

Things to notice:

- **`<engine for=LoadPhase initial=.Idle>`** at file level declares the engine. The engine's variable is **auto-declared** by the compiler — its name is the lowercase first run of the type (`loadPhase` here). You do NOT also write `<loadPhase> = .Idle`; that would be a duplicate declaration.
- **`initial=.Idle`** sets the starting state. Required on non-derived engines.
- **`rule=` declares legal transitions OUT** of this state-child. `rule=.Loading` means "from `.Idle` you may transition to `.Loading`." Multi-target uses parens with `|`: `rule=(.Loaded | .Failed)`.
- **State-child bodies are empty (`</>`)** in the current parser. The shape of "what to render in each state" lives in the `<program>`'s `match` block, which reads `@loadPhase` and dispatches accordingly. A future spec amendment will let state-child bodies hold markup directly (per primer §13.7 + Phase A10 work); the current shape splits the two cleanly.
- **Transitions are direct writes.** `@loadPhase = .Loading` triggers the engine's validation: if the destination is not in the current state-child's `rule=` set, you get `E-ENGINE-INVALID-TRANSITION` (compile-time when the from-state is statically known, runtime otherwise).
- **`<onTransition from=A to=B>`** declares a cross-state effect — code that runs when the engine moves from A to B. Use it for analytics, animations, cleanup, anything that should happen on the transition itself.

The migration story from Tier 1 to Tier 2 is mechanical: the `match` block carries forward verbatim; you add a file-level `<engine for=Type initial=...>` declaration with `rule=` contracts; the type annotation `<phase>: LoadPhase` becomes the engine's auto-declared variable (`@loadPhase`).

> **Engines render at their declaration position** (for the future state-child-body shape). Until that parser lands, the rendering happens at the `match` block inside `<program>`. Cross-file engines (imported from another `.scrml` file) use a `<EngineName/>` use-site mount tag, but you only meet that when you split a program across files.

### 4.4 Why the ladder

Three rungs, three points of commitment:

- **Tier 0** is fine for prototypes. Two booleans is not yet a state machine.
- **Tier 1** is the first commitment: name the phases, dispatch on the variant. Exhaustiveness checking starts here. You can stop at Tier 1 if the transition story is uninteresting ("any phase can move to any other phase; the compiler just dispatches on value").
- **Tier 2** is the second commitment: declare legal transitions. The compiler now rejects invalid moves at compile time when it can see the from-state, runtime otherwise. The engine is the single source of truth for "what are the next legal actions?", which is often what the UI wants to ask ("which buttons should be enabled?").

Promote when the cost of promotion is less than the cost of bugs the next tier prevents. For a screen with two modes that never go wrong, Tier 0 is fine forever. For an order lifecycle (Draft → Submitted → Paid → Shipped → Delivered), Tier 2 prevents a whole class of "the cancelled order somehow shipped" bugs.

### 4.5 A worked example — Mario state machine

The `examples/14-mario-state-machine.scrml` program is a working illustration of an engine with payload variants, transitions driven by user actions, and a **derived engine** that projects one enum onto another. The derived form looks like:

```scrml
<engine for=HealthRisk derived=@marioState>
  .Small               => .AtRisk
  .Big | .Fire | .Cape => .Safe
</>
```

A derived engine reactively recomputes its variable from the source — `rule=`, `initial=`, and direct writes are forbidden because the source drives everything. Use it when one piece of state has a natural read-only view of another.

---

## 5. Forms — `<form>`, validators, and the auto-synthesized validity surface

Validation in scrml is **declarative**, not imperative. You don't write a `validate()` function; you declare validators directly on the state-cell declarations, and the compiler synthesizes a reactive validity surface and error-rendering path automatically.

Here is a multi-step signup form that exercises the full surface:

```scrml
// 05-signup-form.scrml — declarative form with auto-synth validity surface.

${
  type SignupPhase:enum = { Editing, Submitting, Done }
}

<engine for=SignupPhase initial=.Editing>
  <Editing    rule=.Submitting></>
  <Submitting rule=.Done></>
  <Done       rule=.Editing></>
</>

<program>

${
  <signup>
    <name     req length(>=2)>             = <input type="text"/>
    <email    req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
    <password req length(>=8)>              = <input type="password"/>
    <confirm  req eq(@signup.password)>     = <input type="password"/>
    <agree    req>                          = <input type="checkbox"/>
  </>

  function submit() {
    if (not @signup.isValid) return
    @signupPhase = SignupPhase.Submitting
    persistSignup(@signup.name, @signup.email, @signup.password)
    @signupPhase = SignupPhase.Done
  }

  function persistSignup(name, email, password) {
    // Hash + persist — see §6 for the failable variant.
    ?{`INSERT INTO users (name, email, password_hash) VALUES (${name}, ${email}, ${password})`}.run()
  }
}

<div>
  ${
    match @signupPhase {
      .Editing => {
        lift <form onsubmit=submit()>
          <h1>Sign up</h1>
          <label>Name      <name/>     <errors of=@signup.name/></label>
          <label>Email     <email/>    <errors of=@signup.email/></label>
          <label>Password  <password/> <errors of=@signup.password/></label>
          <label>Confirm   <confirm/>  <errors of=@signup.confirm/></label>
          <label class="row">
            <agree/> I agree to the terms
            <errors of=@signup.agree/>
          </label>
          <button type="submit" disabled=not @signup.isValid>Create account</button>
        </form>
      }
      .Submitting => { lift <p>Creating your account…</p> }
      .Done => {
        lift <p>Welcome, ${@signup.name}!</p>
        lift <button onclick=${@signupPhase = SignupPhase.Editing}>Sign up another</button>
      }
    }
  }
</div>

</program>
```

This program puts most of the v0.2.4 surface in one place. Let's walk it.

### 5.1 Compound state — `<signup> ... </>`

`<signup> ... </>` declares a **compound state cell** with field-children inside. Each field is a normal V5-strict declaration; the compound parent groups them under one name. Field access uses `@signup.name` (canonical), exactly the same shape as `@user.name` for a plain struct field.

### 5.2 Decl-coupled-with-render-spec — `<name req> = <input/>`

The declaration `<name req length(>=2)> = <input type="text"/>` does three things at once:

1. **Declares** `name` as a reactive cell.
2. **Attaches validators** (`req` and `length(>=2)`) as bare attributes on the declaration.
3. **Couples a render-spec** — the `<input>` element on the right. Whenever you write `<name/>` in markup, it expands to the bound input element.

This is the canonical scrml shape for "the form field is a value and its rendering at the same time." You don't separately write `<input bind:value=@signup.name>` — the decl-coupled form does the binding for you.

### 5.3 The validator vocabulary

The 14 universal-core validators are: `req`, `is some`, `length(rel)`, `pattern(regex)`, `min(n)`, `max(n)`, `gt(expr)`, `lt(expr)`, `gte(expr)`, `lte(expr)`, `eq(expr)`, `neq(expr)`, `oneOf([...])`, `notIn([...])`.

Cross-field validation falls out automatically. `<confirm req eq(@signup.password)>` reads as "confirm must equal password" — the compiler tracks the dependency and re-evaluates the validator whenever either cell changes. There is no special "cross-field" vocabulary.

### 5.4 The auto-synthesized validity surface

When a compound state declaration contains any field with validators, the compiler auto-synthesizes a reactive validity surface at TWO levels — the compound rollup and per-field. Both are reactive, both are read-only:

```
@signup.isValid       boolean — true iff all fields pass their validators
@signup.errors        compound-level errors array
@signup.touched       any field touched yet?
@signup.submitted     was first submit attempted?

@signup.name.isValid  per-field
@signup.name.errors   per-field (enum tags from ValidationError, NOT strings)
@signup.name.touched  first interaction
```

You read these like any reactive property. Writing them is `E-SYNTHESIZED-WRITE` — the compiler computes them; you don't.

### 5.5 The error rendering element — `<errors of=expr/>`

`<errors of=@signup.name/>` is a first-class scrml markup element that renders the validation errors for the named cell. Per-field (`<errors of=@signup.name/>`) or rollup (`<errors of=@signup all/>`). By default it renders the first error; the `all` attribute renders the full list.

Error messages resolve through a four-level chain: inline override on the decl (highest priority), project-registered messages (the i18n hook), `scrml:data` shipped English defaults, or a `<match>` escape hatch on the `ValidationError` enum for full control.

### 5.6 The form is driven by an engine

The signup form is one state of a three-state engine (`Editing` → `Submitting` → `Done`). The engine declared at file level owns the legal transitions; the `match` block inside `<program>` renders the right markup for the current phase. This is the canonical Tier-2 idiom: the form's lifecycle (you can submit it, then you can't, then you're done) is a state machine, and the engine makes that explicit.

The `disabled=not @signup.isValid` on the submit button uses the `not` operator (§7) — `not x` is logical negation, the scrml spelling of JavaScript's `!x`. Combined with the auto-synth surface, the button is automatically enabled or disabled based on whether every field passes its validators.

### 5.7 `reset(@cell)` — clearing form state

To clear a form, call `reset(@signup)` — `reset` is a language keyword (no import needed). It re-evaluates each field's init expression, restoring the form to its initial state. Per-field reset works too: `reset(@signup.name)`.

```scrml
<button type="button" onclick=reset(@signup)>Clear</button>
```

> **`reset` is a reserved identifier.** You cannot define `function reset() { ... }` — pick another name like `clearForm` or `restart` for local helpers.

---

## 6. Failable functions — `function f()! -> Err` and `!{}`

Some operations can fail: a network call, a database query, a parsing pass. scrml models errors as **enum variants** rather than thrown exceptions. A function that can fail is declared with `!` after its parameter list and an error type after the return arrow. Callers handle each variant with a `!{ ... }` block.

```scrml
// 06-failable.scrml — failable function with a typed error enum.

${
  type SaveError:enum = {
    EmptyName
    InvalidEmail(input: string)
    DuplicateEmail(email: string)
  }

  type Phase:enum = { Editing, Saving, Saved, Errored(msg: string) }
}

<engine for=Phase initial=.Editing>
  <Editing rule=.Saving></>
  <Saving  rule=(.Saved | .Errored)></>
  <Saved   rule=.Editing></>
  <Errored rule=.Editing></>
</>

<program>

<db src="users.db" tables="users">

  ${
    <form>
      <name  req length(>=2)>             = <input type="text"/>
      <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
    </>

    // Failable + server-escalated. The `!` after the param list marks the
    // function as failable; `-> SaveError` names the error enum type.
    function persistUser(name, email)! -> SaveError {
      if (name == "")                          fail SaveError.EmptyName
      if (not email.includes("@"))             fail SaveError.InvalidEmail(email)
      const existing = ?{`SELECT id FROM users WHERE email = ${email}`}.get()
      if (existing is some)                    fail SaveError.DuplicateEmail(email)
      ?{`INSERT INTO users (email, password_hash) VALUES (${email}, ${"placeholder"})`}.run()
    }

    function save() {
      @phase = Phase.Saving
      persistUser(@form.name, @form.email) !{
        | .EmptyName        -> { @phase = Phase.Errored("Name can't be empty.") ; return }
        | .InvalidEmail(e)  -> { @phase = Phase.Errored("Not an email: " + e) ; return }
        | .DuplicateEmail(e)-> { @phase = Phase.Errored(e + " is already taken.") ; return }
      }
      @phase = Phase.Saved
    }
  }

  <div>
    ${
      match @phase {
        .Editing => {
          lift <form onsubmit=save()>
            <label>Name  <name/>  <errors of=@form.name/></label>
            <label>Email <email/> <errors of=@form.email/></label>
            <button type="submit" disabled=not @form.isValid>Save</button>
          </form>
        }
        .Saving => { lift <p>Saving…</p> }
        .Saved => {
          lift <p>Saved!</p>
          lift <button onclick=${@phase = Phase.Editing}>Add another</button>
        }
        .Errored(msg) => {
          lift <p class="err">${msg}</p>
          lift <button onclick=${@phase = Phase.Editing}>Try again</button>
        }
      }
    }
  </div>

</>

</program>
```

The shape:

- **`function persistUser(name, email)! -> SaveError`** — the `!` after the parameter list marks the function as failable. The arrow specifies the error enum type. The body uses `fail .Variant` (or `fail .Variant(payload)`) to raise a specific error.
- **`!{ ... | .Variant -> { ... } }`** at the call site — pattern-match each error variant. The match is **exhaustive**; if a new variant is added to `SaveError`, the compiler tells you which call sites need a new arm.
- **Errors propagate when not handled.** A `!{ ... }` that doesn't handle a particular variant lets it bubble up. The compiler tracks unhandled error types in the function's signature.

Notice what is NOT in this code: no `try` / `catch`, no `throw`, no `Promise.reject`. Failures are values; they flow through ordinary control flow. The signature of every failable function tells you exactly which errors can come out — there are no hidden exceptions.

> **No `async`, no `await`, no `Promise` in source.** The compiler auto-awaits every server-function call. You write `const user = persistUser(...)` and the boundary is invisible at the syntax level. Writing `await` is forbidden (`E-AWAIT-FORBIDDEN`). Failable calls flow through the same machinery — `persistUser(...) !{ ... }` is the canonical shape on both client and server.

### 6.1 Errors are states — the engine shape composes

Look at how the `!{}` handler in `save()` routes each failure variant into a phase change: `.EmptyName -> { @phase = .Errored("...") }`. The engine then renders the right markup for each phase. The error path and the success path both flow through `@phase`, and the engine's `rule=` contracts guarantee that the screen always shows exactly one state.

This is the canonical scrml pattern for handling failures: the failable call's `!{}` handler routes each variant into the right phase variant; the engine pattern-matches each phase into the right markup. There is no separate `<isError>` cell, no separate error component to remember to render — the failure mode lives in the type.

---

## 7. Negation, presence checks, the `not` keyword

A small but load-bearing detail. scrml uses three operators where JavaScript uses one:

| scrml | JavaScript | Reading |
|---|---|---|
| `not x` | `!x` | Logical negation. |
| `x is some` | `x !== null && x !== undefined` | Presence check — value exists. |
| `x is not` | `x === null \|\| x === undefined` | Absence check — value missing. |

The `not` keyword is the canonical operator-form (per §45.7); the `!x` JavaScript spelling also compiles but `not x` is preferred for readability.

```scrml
${
  <user>: User? = null              // optional — may be missing

  function welcome() {
    if (@user is some) {
      return "Hello, " + @user.name
    } else {
      return "Sign in to continue"
    }
  }

  if (not @loggedIn) {
    @phase = .Promoting
  }
}
```

Equality uses `==` and `!=`. There is no `===` or `!==` — the comparison is always strict at the value level (the compiler enforces type compatibility statically), so the second `=` adds no information.

---

## 8. Channels — real-time state, one tag

Real-time sync over a WebSocket connection is built into the language as a `<channel>` element. The channel lives at file level (sibling of `<program>`, never inside it). State declared inside the channel body is auto-synced to every connected client:

```scrml
// 07-channel-chat.scrml — chat room with shared state.

<channel name="chat" topic="lobby">
  <messages> = []

  server function postMessage(author, body) {
    @messages = [...@messages, { author, body, ts: Date.now() }]
  }
</>

<program>

${
  <username> = ""
  <draft>    = ""

  function send() {
    if (@draft.trim() == "" || @username.trim() == "") return
    postMessage(@username, @draft)
    reset(@draft)
  }
}

<div class="chat">
  <input type="text" bind:value=@username placeholder="Your name"/>
  <ul>
    ${
      for (let m of @messages) {
        lift <li><strong>${m.author}</strong>: ${m.body}</li>
      }
    }
  </ul>
  <form onsubmit=send()>
    <input type="text" bind:value=@draft placeholder="Message"/>
    <button type="submit">Send</button>
  </form>
</div>

</program>
```

Three things to notice:

1. **`<channel>` is a sibling of `<program>`, not a child.** Putting a channel inside `<program>` is `E-CHANNEL-INSIDE-PROGRAM`.
2. **`<messages> = []`** declared inside the channel body is auto-synced. Every connected client sees the same `@messages`; a write from any client propagates to all the others. There is no `@shared` modifier — synchronization comes from being inside the channel body.
3. **`@messages` is reachable from inside `<program>`** via canonical `@messages` access. The channel-declared cells are file-scope visible.

The compiler emits the WebSocket endpoint (`/_scrml_ws/chat` by default), the message-broadcast plumbing, and the reconnection logic. You declare what state is shared; the compiler handles the transport.

> **Channels are heavy operationally.** A live channel requires a running WebSocket server, which means you're committed to running a scrml app (not just shipping static HTML). Use channels for genuinely multi-client features — chat, multiplayer cursors, live dashboards. For single-user state, plain reactive cells are simpler and have no infrastructure cost.

---

## 9. The shape, all together

By now you have seen every primitive you need to build a working scrml app. Let's collect them in one place — this is the idiomatic shape of a non-trivial scrml file:

```scrml
<schema>
  table_one { ... }
  table_two { ... }
</>

<channel name="...">      <!-- (optional, file level) -->
  <synced_state> = ...
</>

${
  // Types — structs and enums
  type Foo:struct = { ... }
  type Phase:enum = { Idle, Loading, Loaded(rows), Failed(msg: string) }
}

// Engine — declared at file level (sibling of <program>)
<engine for=Phase initial=.Idle>
  <Idle    rule=.Loading></>
  <Loading rule=(.Loaded | .Failed)></>
  <Loaded  rule=.Idle></>
  <Failed  rule=.Idle></>
</>

<program>

<db src="..." tables="..." protect="...">

  ${
    // State — declared structurally, accessed canonically
    <local> = init                          // plain reactive
    const <derived> = @local * 2            // derived reactive
    <form>                                  // compound with validators
      <name req length(>=2)> = <input/>
      <email req pattern(...)> = <input/>
    </>

    // Server-escalated fns — touch ?{}; must not write @state.
    // No `server` keyword — body-content inference promotes them.
    function persist(...)! -> Err { ... }
    function loadAll() {
      lift ?{ `SELECT ... FROM ...` }.all()
    }

    // Client fns — orchestrate; own @state writes
    function submit() {
      persist(...) !{ | .Variant -> { ... } }
    }

    // Components — multi-instance
    const Row = <li class="row" props={ item: Foo }>...</li>
  }

  <div>
    ${
      match @phase {
        .Idle => { lift <button onclick=load()>Load</button> }
        .Loading => { lift <p>Loading…</p> }
        .Loaded(rows) => {
          lift <ul>${ for (let r of rows) { lift <Row item=r/> } }</ul>
        }
        .Failed(msg) => { lift <p class="err">${msg}</p> }
      }
    }
  </div>

</>

</program>

#{ /* scoped CSS */ }
```

That shape is the idiomatic scrml file. Once it feels natural, the language is no longer doing anything new at you — you are combining primitives you already know.

A practical note on the parts: the **engine** owns the top-level lifecycle (the screen's modes), **compound state with validators** owns each form, the **failable function** is the call site between client and server, and the **derived state** stays the right value automatically. Most non-trivial scrml programs have this exact spine.

---

## 10. Where to go next

You now know enough scrml to write working programs. From here:

- **Examples** — `examples/` in this repository holds longer runnable apps. Each is a single-file program you can compile and run. Of particular interest:
  - `examples/02-counter.scrml` — the in-memory counter from §2.
  - `examples/03-contact-book.scrml` — full-stack CRUD against SQLite.
  - `examples/05-multi-step-form.scrml` — multi-step wizard with components and enums.
  - `examples/14-mario-state-machine.scrml` — engine with payload variants and a derived engine projecting onto another enum.
  - `examples/15-channel-chat.scrml` — real-time chat across multiple clients.
  - `examples/22-multifile/` — cross-file imports for larger apps.

- **The PA primer** — `docs/PA-SCRML-PRIMER.md` is the canonical syntax + semantics reference, organized by §-section. Use it as a quick-lookup when you need to confirm a rule.

- **The kickstarter** — `docs/articles/llm-kickstarter-v2-2026-05-04.md` is the LLM-targeted one-paste context. It is more compact than this tutorial and useful as a refresher.

- **The full specification** — `compiler/SPEC.md` (about 26,000 lines) is the formal grammar and semantics. The tutorial covers the common 80%; the SPEC covers the edges. `compiler/SPEC-INDEX.md` is the quick-lookup table of contents.

- **Error codes** — when the compiler flags an error, the code (`E-NAME-COLLIDES-STATE`, `E-RI-002`, `E-DERIVED-WRITE`, ...) is your best search term. Each code has a dedicated section in the SPEC explaining the rule that was violated and the usual fix.

---

## Glossary — the v0.2.4 primitives

A fast reference for the keywords and sigils in this tutorial. Each line links back to the section that explains it.

- **`<program>`** — the top-level element wrapping a scrml app's UI. §1.
- **`${ ... }`** — logic block (statement position) or interpolation (expression position). §1.
- **`<name> = init`** — V5-strict reactive state declaration. §2.
- **`@name`** — canonical expression access (read, write, compound assignment). §2.
- **`const <name> = expr`** — derived reactive; recomputes when inputs change. §2.1.
- **`<name>` inside a compound** — field declaration inside a compound parent. §5.1.
- **`<form><field req .../>... </>`** — compound state with validators. §5.
- **`<name req length(>=2)> = <input/>`** — decl-coupled-with-render-spec form. §5.2.
- **`@form.isValid` / `@form.errors` / `@form.touched`** — auto-synth validity surface (read-only). §5.4.
- **`<errors of=expr/>`** — first-class error-rendering element. §5.5.
- **`bind:value=@var`** — two-way binding on a form control. §3.4.
- **`class:active=@var`** — conditional class attachment. §3.4.
- **`onclick=fn()`** — bare-call event handler. §3.4.
- **`if=expr` / `else-if=expr` / `else`** — conditional rendering chain on sibling elements (`else` is bare). §3.5.
- **`for (let x of @xs) { lift <li>...</li> }`** — markup iteration. §3.2.
- **`type Name:struct = { ... }`** — structural record type. §3.1.
- **`type Name:enum = { A, B(n: number), ... }`** — tagged sum type. §4.2.
- **`match expr { .V => { lift ... } }`** — Tier 1 exhaustive dispatch inside a logic block. §4.2.
- **`<engine for=Type initial=.V>`** — Tier 2 engine (file level); auto-declares the engine variable. §4.3.
- **`<Variant rule=.A | .B>`** — state-child with legal-transitions contract. §4.3.
- **`<onTransition from=A to=B>`** — cross-state effect. §4.3.
- **`<engine for=T derived=@source>`** — derived (read-only) projection engine. §4.5.
- **`<db src="..." tables="..." protect="...">`** — database connection scope. §2.2.
- **`<schema> ... </>`** — declarative SQL schema; compiler diffs and migrates. §2.2.
- **`?{ ` ` ` ... ` ` ` }.all() / .get() / .run()`** — parameterized SQL. §2.2.
- **Server-escalated function** — a function that touches `?{}` SQL or another server-only resource is auto-classified as server-side. The legacy `server function` keyword still compiles but is deprecated. §2.2.
- **`function f()! -> Err { fail .Variant ... }`** — failable function. §6.
- **`caller() !{ | .Variant -> {...} }`** — error destructuring at call sites. §6.
- **`is some` / `is not` / `not`** — presence and negation operators. §7.
- **`==` / `!=`** — equality operators (no `===`/`!==`). §7.
- **`reset(@cell)`** — language-keyword for resetting state to its default. §5.7.
- **`<channel name="..." topic="...">`** — real-time shared state, file-level. §8.
- **`#{ ... }`** — scoped CSS block. §2.3.

---

## Things scrml does NOT have (anti-patterns)

The convergent failures every developer makes coming from another framework. If your reflex tells you to write the left column, use the right column instead.

| You're about to write… | Use this in scrml | Section |
|---|---|---|
| `useState(0)` / `signal(0)` / `$state(0)` | `<count> = 0` | §2 |
| `@count = 0` to declare (legacy v1) | `<count> = 0` (V5-strict) | §2 |
| `let count = 5` (intending reactive) | `<count> = 5` | §2 |
| `computed(() => ...)`, `$:`, `useMemo()` | `const <derived> = expr` | §2.1 |
| `useEffect(() => ...)` | Reactive expressions update automatically | §2.1 |
| `await fetchUser()` | `const user = fetchUser()` (compiler auto-awaits) | §6 |
| `try { ... } catch { ... }` | `f() !{ | .Variant -> { ... } }` | §6 |
| `throw new Error(...)` | `fail .Variant` (typed error enum) | §6 |
| `if (@phase === 'loading') ...` chains | `<engine for=Phase initial=.Idle>` | §4.3 |
| Many booleans gating UI | One enum + engine | §4 |
| `null` / `undefined` literals | `is some` / `is not` | §7 |
| `===` / `!==` | `==` / `!=` | §7 |
| `!x` | `not x` (canonical) | §7 |
| `< machine name=...>` (legacy v0.1) | `<engine for=Type initial=...>` | §4.3 |
| `function validate() { if (@form.name == "") ... }` | `<name req> = <input/>` (decl-coupled) | §5 |
| `if (@signup.errors.name.length > 0) <p>...</p>` | `<errors of=@signup.name/>` | §5.5 |
| `<input bind:value=@signup.name>` written separately | `<name req> = <input/>` (decl-coupled) | §5.2 |
| `import { useState } from 'react'` | nothing — `<var> = init` is built in | §2 |
| `import Database from 'better-sqlite3'` | `<db src="..."> ... ?{} ... </>` | §2.2 |
| `bcrypt` / `jsonwebtoken` via npm | `import { hashPassword } from 'scrml:auth'` | §6 |
| `server function f()` (legacy v0.1) | plain `function f()` — body-content inference escalates | §2.2 |
| `socket.io`, custom WebSocket setup | `<channel name="..."> ... </>` | §8 |
| `<MyEngine/>` for a same-file engine | The engine renders at its declaration position | §4.3 |
| Multi-statement inline handler `onclick=fn(); @x = .Y` | Name the function: `function go() { fn(); @x = .Y }` | §3.4 |

If you don't see your case in the table, default to the shape from §9. Don't invent syntax — when in doubt, the canonical reference is the PA primer (`docs/PA-SCRML-PRIMER.md`).

---

*Last updated: 2026-05-11 — v0.2.4 canonical (post-S84 Wave 1 + Wave 1.5 robust-v0.2 bundle).*
