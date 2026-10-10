# scrml Tutorial — zero to a running app

This tutorial walks you from an empty directory to a small but complete scrml app: a counter that persists to SQLite, a signup form with declarative validation, an `<engine>`-driven state machine, and a real-time channel. Every complete program in it is a file in `docs/tutorial-snippets/` that CI compiles on every push, and CI also checks that the copy printed here is identical to that file (the `<!-- snippet: ... -->` line above each one names it). Shorter excerpts are marked as excerpts or fragments in the text.

**Audience.** You have written some JavaScript or TypeScript and used at least one reactive framework (React, Svelte, Vue, Solid). You have a passing familiarity with HTML and SQL. You do not need to know anything about scrml before reading this.

**What scrml is, in one paragraph.** scrml is a single-file language for full-stack web apps. One `.scrml` file compiles to the HTML, JavaScript, CSS, and server routes the app needs. Markup, reactive state, server functions, SQL, real-time channels, and tests all live in the same file; the compiler decides which half runs in the browser and which half runs on the server. The unit of organization is the program, not the tier.

**What this tutorial covers.** The language as the compiler ships it at v0.8.0. If you find older material online that disagrees with this document (especially anything from before April 2026 — `< machine>` instead of `<engine>`, `@var = 0` for declaration instead of `<var> = 0`, `null`/`undefined`/`===`/`!==` JavaScript literals instead of `is given` / `is not` / `==` / `!=`, `<channel>` as a sibling of `<program>` rather than a child), trust this document. scrml is newer than the training data of every current LLM, and the language has shifted since.

**Prerequisites.** Working knowledge of JavaScript syntax (`const`/`let`, arrow functions, template strings) and the DOM event model. A passing acquaintance with SQL helps for §2 onward but is not required — every SQL example uses only `SELECT` and `INSERT`.

---

## 0. Setup — install, `scrml init`, and the dev loop

scrml is a command-line compiler that runs on [Bun](https://bun.sh). It is not published to npm; you install it from the GitHub repository. With Bun installed (`curl -fsSL https://bun.sh/install | bash`):

```
git clone https://github.com/bryanmaclee/scrml
cd scrml
bun install
bun link          # puts the `scrml` command on your PATH
cd ..
scrml init my-app
cd my-app
scrml dev src/app.scrml
```

`scrml init my-app` scaffolds a new project directory containing `src/app.scrml` (a starter counter app) and a `.gitignore` — no `package.json`, no `bunfig.toml`. `scrml dev src/app.scrml` compiles and serves the file with hot reload — edit, save, see the result in your browser.

If you are following along inside the scrml repository instead, every complete program in this tutorial is a file under `docs/tutorial-snippets/`. To compile one directly:

```
bun compiler/bin/scrml.js compile docs/tutorial-snippets/02-counter.scrml
```

The compiler writes the built artifacts (HTML, JS, CSS, and, when the program needs one, a server module) to a `dist/` directory next to the input file — here `docs/tutorial-snippets/dist/` — and prints a summary. Pass `--output-dir <dir>` to put them elsewhere. For this tutorial, the compile step alone is enough to confirm a sample is well-formed; the repository's `examples/` directory holds longer end-to-end programs to run.

The everyday CLI surface is small:

```
scrml init [dir]       — scaffold a new project
scrml dev <file|dir>   — compile + watch + serve (with hot reload)
scrml build <dir>      — production build
scrml compile <file>   — one-shot compile to dist/ next to the input
scrml db-migrate ...   — apply a program's <schema> to a database (§2.2)
```

`scrml --help` lists the rest. There is no `scrml.config.js`, no `defineConfig`, no `tailwind.config.js`. The dev server is part of the language tooling.

---

## 1. The shape of a scrml file

Every scrml program is one `<program>` element. Inside it, default mode is **logic** — types, state declarations, and functions appear as direct children; markup tags re-enter markup mode. Here is the smallest useful program:

<!-- snippet: docs/tutorial-snippets/01-hello.scrml -->
```scrml
// 01-hello.scrml — the minimal program. Plain text in markup, no state.

<program>

<h1>Hello, scrml!</h1>
<p>This file compiles to HTML + JS + CSS.</p>

</program>
```

There is no `<html>`, no `<head>`, no `<body>` — the compiler wraps what you write in a proper document shell. Comments use `// ...` and `/* ... */` and are allowed anywhere.

A `<program>` body holds three kinds of content:

1. **Logic** — declarations (`<count> = 0`), types (`type Phase:enum = {...}`), functions, engines (`<engine for=Phase>`), imports. These appear as direct children of `<program>`; no `${ ... }` wrapper needed. (`${ ... }` is how you re-enter logic from inside markup — e.g., `${ for (let p of @items) { lift <li>...</li> } }` inside a `<ul>` — and inside a `<db>` block, §2.2.)
2. **Markup** — HTML elements (`<div>`, `<p>`, `<form>`, ...) plus a small set of scrml-specific extensions (`bind:value`, `class:active`, `onclick=`, `if=`, `<each>`, `<match>`, `for`/`lift`). Inside markup, `${expression}` is the interpolation slot that substitutes the expression's value.
3. **`#{ ... }` style blocks** — CSS written in the same file, placed immediately before the markup section it styles (§2.3).

Tag closing has three forms: explicit `</tagname>`, shorthand `</>` (closes the most recently opened tag), and a trailing `/` on void elements (`<br/>`). The shorthand `</>` is the canonical scrml closer; use it freely.

---

## 2. The counter — reactive state, V5-strict access

The classic first program in any reactive language: a counter with a `+` button. Here it is in scrml:

<!-- snippet: docs/tutorial-snippets/02-counter.scrml -->
```scrml
// 02-counter.scrml — reactive state, V5-strict declaration form.

<program>

  <count> = 0

  function inc() { @count = @count + 1 }
  function dec() { @count = @count - 1 }

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

3. **`onclick=inc()` is a bare call expression.** The handler is a function call, not a string. Parentheses are mandatory; arguments work as you would expect (`onclick=remove(item.id)`). A handler that does more than one thing can be written inline in braces — `onclick={ @count = 0; @step = 1 }` (§3.4).

The asymmetry between `<count>` for declaration and `@count` for expression access is deliberate. It makes every state touch visually distinguishable from local-variable touch — you can scan a function body and count "how many state cells does this function read or mutate" at a glance. This is load-bearing for both human readability and the compiler's static analysis.

**Why this matters in practice.** If you write `let count = 5` after `<count> = 0`, the compiler emits `E-NAME-COLLIDES-STATE`. Local names cannot shadow registered state names — a refactor that accidentally shadows state is caught at compile time, not at runtime.

Compile and run:

```
bun compiler/bin/scrml.js compile docs/tutorial-snippets/02-counter.scrml
```

The output goes to `docs/tutorial-snippets/dist/`. Open `dist/02-counter.html` there and you have a working counter.

### 2.1 Derived state — `const <name> = expr`

When a value is a pure function of other reactive state, declare it with `const <name>`:

<!-- snippet: docs/tutorial-snippets/02a-derived.scrml -->
```scrml
// 02a-derived.scrml — derived state recomputes whenever inputs change.

<program>

  <count> = 0
  const <doubled> = @count * 2
  const <parity> = @count % 2 == 0 ? "even" : "odd"

  function inc() { @count = @count + 1 }

  <div>
    <p>Count: ${@count}</p>
    <p>Doubled: ${@doubled}</p>
    <p>Parity: ${@parity}</p>
    <button onclick=inc()>+</button>
  </div>

</program>
```

`const <doubled> = @count * 2` reads as "whenever any reactive input on the right changes, recompute the expression." The dependency graph is tracked automatically — you never list dependencies explicitly. Reading the derived cell uses `@doubled`, same as a plain reactive.

Derived cells are **read-only**: `@doubled = 99` is `E-DERIVED-WRITE`. The value can change (when `@count` changes), but you cannot assign to it from your code.

### 2.2 Persisting the counter — `<schema>`, `<db>`, `?{}`

A counter in memory is gone the moment you refresh the page. Let's persist it. scrml has a built-in database layer — no `npm install better-sqlite3`, no Prisma, no schema files in a separate directory. You name the database file with `db=` on `<program>`, declare its shape in a `<schema>` block (a direct child of `<program>`), open a connection scope with `<db>`, and write parameterized SQL with `?{}`:

<!-- snippet: docs/tutorial-snippets/02b-counter-persisted.scrml -->
```scrml
// 02b-counter-persisted.scrml — counter that survives a refresh.

<program db="counter.db">

  <schema>
    counters {
      id:    integer primary key
      value: integer not null default(0)
    }
  </>

  <db src="counter.db" tables="counters">

    ${
      <count> = loadCount()

      // No `server` keyword — these two functions run on the server because
      // their bodies touch a `?{}` SQL block.
      function loadCount() {
        const row = ?{`SELECT value FROM counters WHERE id = 1`}.get()
        return row is given ? row.value : 0
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

Compare to §2's in-memory counter. The markup is identical. The function shape is identical. The additions:

1. **`<program db="counter.db">`** names the database this program uses. A `<schema>` block requires it (`E-SCHEMA-001` without it).
2. **`<schema>`** declares the database shape. `counters { id: integer primary key, value: integer not null default(0) }` reads as a small DDL. You do not write `CREATE TABLE` or `ALTER TABLE` by hand: `scrml db-migrate` compares the declared schema with the actual database and applies the difference. Add `--dry-run` to see the plan without applying it:

   ```
   scrml db-migrate docs/tutorial-snippets/02b-counter-persisted.scrml --db counter.db --dry-run
   ```

3. **`<db src="counter.db" tables="counters">`** opens the connection scope and lists the tables the code inside it uses. The UI nests inside the `<db>` block, which makes the database scope visually obvious. The body of `<db>` is markup, so the declarations and functions go in a `${ ... }` block.
4. **Server-side functions are inferred from their bodies.** `loadCount` and `persistCount` touch `?{}` SQL blocks, which are server-only. The compiler moves them to the server automatically — no `server` keyword needed. (Older code that writes `server function` still compiles, but the keyword is deprecated.)

The `?{`SELECT ...`}` form holds parameterized SQL. The backtick string is the query; `${var}` interpolations become bound parameters automatically — even if `var` contains quotes or semicolons, it is treated as data, not SQL. The methods are `.run()` (INSERT/UPDATE/DELETE), `.get()` (single row, or `not` if no rows match), and `.all()` (array of rows).

> **Note on `is given`.** scrml has no `null` or `undefined` keyword in source. The presence check is `value is given` (true when the value is present; `value is some` is an older, soft-deprecated spelling of the same test, and `scrml fix` rewrites it) and the absence check is `value is not` (true when the value is absent — i.e. the value is `not`). This is the canonical scrml shape for what JavaScript spells as `value !== null && value !== undefined`. You write `==` and `!=` for equality; `===` does not exist (§7).

The one rule that distinguishes server functions from client functions is that **server-escalated functions must not assign to reactive state** (`E-RI-002`). State transitions belong on the client; the server's job is to fetch and persist. A client function calls a server-escalated function for data, then updates state with the result. The compiler propagates server-side classification through the call graph: if `addContact()` calls server-escalated `persistContact()`, the assignment to `@name = ""` inside `addContact` is checked in client context. The canonical idiom is to call `reset(@name)` instead of `@name = ""` after the server call — `reset()` is a language keyword that goes through the client-side reset path unambiguously.

### 2.3 Styling — `#{}` style blocks and Tailwind utilities

scrml has two styling tools, used together or apart depending on taste.

<!-- snippet: docs/tutorial-snippets/02c-styles.scrml -->
```scrml
// 02c-styles.scrml — a #{} style block, placed just before the markup it styles.

<program>

  <count> = 0
  function inc() { @count = @count + 1 }

  #{
    .card {
      max-width: 280px;
      margin: 2rem auto;
      padding: 1.5rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      text-align: center;
    }
    .card button {
      margin-top: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 1.25rem;
    }
  }
  <div class="card">
    <h1>${@count}</h1>
    <button onclick=inc()>+</button>
  </div>

</program>
```

A `#{ ... }` block holds plain CSS. Where it sits decides its reach:

- **At program level** (as above), the CSS is **global** — it applies to the whole page, like an ordinary stylesheet. That is why the example scopes its button rule with `.card button` rather than a bare `button`.
- **Inside a component body**, the CSS is **scoped to that component**: the compiler wraps it in a CSS `@scope` rule for the component's root, so a bare `h2 { ... }` inside a component styles only that component's `h2`s.

Place each block immediately before the markup it styles; several small blocks next to their markup read better than one large block at the top of the file.

scrml also supports Tailwind utility classes out of the box. The compiler scans class attributes at build time and emits only the utilities the program actually uses. Fragment — the counter's markup restyled with utilities:

```scrml
<div class="max-w-sm mx-auto mt-8 p-6 border rounded-lg text-center">
  <h1 class="text-3xl font-bold">${@count}</h1>
  <button class="mt-2 px-4 py-2 bg-blue-600 text-white rounded" onclick=inc()>+</button>
</div>
```

No `tailwind.config.js`, no separate build step. A small program that uses ten utilities ships exactly those ten utilities' worth of CSS.

Pick `#{}` for one-off bespoke styling, Tailwind for shared design-system utilities, both together when each fits a different problem.

---

## 3. Lists, components, iteration

The next step beyond a counter is a list. Here is a small todo app — keep the data in memory for now (§10 shows a list backed by SQL):

<!-- snippet: docs/tutorial-snippets/03-todos.scrml -->
```scrml
// 03-todos.scrml — in-memory todos with for/lift, components, and bind:value.

<program>

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
    <input type="checkbox" checked=item.done onchange=toggle(item.id)/>
    <span class:done=item.done>${item.body}</span>
    <button onclick=remove(item.id)>x</button>
  </li>

  #{
    .todo-app { max-width: 420px; margin: 2rem auto; font-family: sans-serif; }
    form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    input[type="text"] { flex: 1; padding: 0.5rem; }
    .row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; }
    .row .done { text-decoration: line-through; color: #999; }
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

</program>
```

Several pieces of scrml's shape show up at once here. Let's name them.

### 3.1 `type Name:struct = { ... }` — structural record types

A struct type names a record shape with typed fields. Instances are plain object literals; there are no constructors. Excerpt from the todo app:

<!-- snippet: docs/tutorial-snippets/03-todos.scrml#L5-L5 -->
```scrml
type Todo:struct = { id: number, body: string, done: boolean }
```

The type-annotation form `<items>: Todo[] = []` declares the cell with an explicit type — the compiler carries the annotation through reads and writes, and into `match` arms. For a single value, the annotation goes after the structural-name form: `<phase>: LoadPhase = .Idle`.

### 3.2 `for`/`lift` iteration

Inside an interpolation slot, a `for` loop iterates. To emit markup from the loop body you use the `lift` keyword — it says "lift this node into the surrounding markup". Excerpt from the todo app:

<!-- snippet: docs/tutorial-snippets/03-todos.scrml#L46-L50 -->
```scrml
${
  for (let t of @items) {
    lift <TodoRow item=t/>
  }
}
```

The `${ ... }` inside `<ul>` is a logic block because its body is a multi-statement `for`. Each iteration's `lift` produces a new child of the surrounding `<ul>`. Without `lift`, the markup inside the loop would be an unused expression — `lift` is what marks an expression as something to attach to the DOM.

`for`/`lift` reacts to changes in the iterated reactive: reassign `@items = [...@items, newItem]` and the loop re-evaluates.

**`<each>` — the canonical iteration element.** `for`/`lift` is the Tier-0 primitive; the structural `<each>` element is the canonical Tier-1 shape (§17.7), and the one the compiler nudges you toward (`W-EACH-PROMOTABLE`). Fragment — the same list written with `<each>`:

```scrml
<ul>
  <each in=@items as t key=t.id>
    <TodoRow item=t/>
  </each>
</ul>
```

`<each in=@coll as t>` binds each element of the reactive collection to the local `t` and renders its body once per item — no `${ ... }` wrapper and no `lift`. The binder is the **space form `as t`**, never `as=t` (`<each in=@items as=t>` is `E-SCOPE-001` — the binding never registers). Add `key=t.id` (or any stable per-item field) so the runtime can match items across updates; without a key the list falls back to positional keying. Keep `for`/`lift` for the imperative case where the loop body is multi-statement; reach for `<each>` for the common "one node per item" case.

> **An important detail about reactivity.** Assigning a new value to a cell always updates the page: `@items = [...@items, x]`, `@user = { ...@user, name: "Ada" }`. In-place updates work too — `@items.push(x)` and `@user.name = "Ada"` both update the page, because the compiler turns them into a write of the changed value back to the cell. The reassignment form is the one the specification calls canonical, and it is the one to reach for when you want the update to be obvious at a glance. Derived cells are the exception: `@doubled.push(x)` is `E-DERIVED-VALUE-MUTATE` — change the cell it is derived from instead.

### 3.3 Components

A component in scrml is a `const` bound to a markup expression. As a direct `<program>` child it is a bare declaration — no `${ ... }` wrapper needed. It is invoked by name in markup like a custom element. Props are declared via a `props={...}` attribute on the root element of the component body. Excerpt from the todo app:

<!-- snippet: docs/tutorial-snippets/03-todos.scrml#L26-L30 -->
```scrml
const TodoRow = <li class="row" props={ item: Todo }>
  <input type="checkbox" checked=item.done onchange=toggle(item.id)/>
  <span class:done=item.done>${item.body}</span>
  <button onclick=remove(item.id)>x</button>
</li>
```

Inside the component body, a prop is read by its bare name — `item.done`, `item.id` — not with `@`: `@` is only for reactive state cells. The convention is that component names are capitalized. Calling a component without a required prop is a compile error (`E-COMPONENT-010`).

The closer of a component is `</>` (or the explicit tag name), same as any element. `class:done` and `onchange=fn()` work on component-internal markup exactly as they do on plain HTML.

### 3.4 Attribute extensions — `bind:`, `class:`, `on<event>`

The handful of scrml-specific attributes shown in the todo app:

- **`bind:value=@draft`** — two-way binding on a form control. Typing in the input updates `@draft`; writing to `@draft` from elsewhere updates the input. Works on `<input>`, `<select>`, `<textarea>`, and checkbox/radio inputs.
- **`class:done=item.done`** — adds or removes the CSS class `done` based on the value of the expression. Multiple `class:` bindings stack independently; a `class="row"` on the same element remains intact.
- **`onclick=remove(item.id)`**, **`onsubmit=add()`**, **`onchange=toggle(item.id)`** — event handlers as bare call expressions. The handler is a function call, not a string. Inside a loop, you pass the current item to the handler with normal scrml-expression arguments. For the rare case where you need the native event object, use `onclick=${(e) => handle(e)}` — an arrow inside an interpolation slot.
- **`onclick={ @count = 0; @phase = .Idle; track("reset") }`** — an **inline block** handler (SPEC §5.2.3). When a handler does more than one thing, wrap the statements in braces right where the handler is attached; they run in order on each event, and the block may span as many lines as you like. A named function (`onclick=startOver()`) is an equally valid choice — reach for it when the logic is reused or deserves a name. What is rejected is the **unbraced** `;` sequence (`onclick=startGame(); track("start")`, `E-MULTI-STATEMENT-HANDLER`): with no braces, nothing says where the handler ends and the next attribute begins.

There is no `<script>` tag, no JSX braces, no Svelte directives. The shape is "HTML, plus a few attribute-looking names with scrml-specific compile-time meaning."

### 3.5 Conditional rendering — `if=`, `else-if=`, `else`

Show or hide an element by putting `if=expr` on it. Chains use sibling elements with `else-if=expr` and a bare `else`. Fragment:

```scrml
<p if=(@items.length == 0)>No todos yet — add one above.</p>
<ul else>
  <each in=@items as t key=t.id>
    <TodoRow item=t/>
  </each>
</ul>
```

A bare `else` is the one attribute in scrml that takes no `=` and no value — `<ul else>` is the literal syntax. Spelling it as `else=true` is a parse error. The chain runs over sibling elements at the same parent level; exactly one branch is shown at a time.

For exhaustive branching over the variants of an enum, prefer `<match for=Type>` (§4.2) — adding a new variant later forces every match site to update, which a chain of `if=`s does not.

---

## 4. Engines — the Tier-0 → Tier-1 → Tier-2 ladder

When the UI has more than one mode — loading vs loaded, idle vs active, draft vs submitted vs paid — you have a state machine, whether you spell it that way or not. scrml's centerpiece is the **engine**: a first-class state machine that owns part of (or all of) the UI tree.

The language gives you a three-rung ladder for promoting "this UI has modes" into "this UI is a fully-handled state machine." You start at Tier 0 — boolean flags and `if=` chains — and promote toward Tier 2 — a full `<engine>` — as the design firms up. Promotion is **additive and mechanical**: the rendering carries forward verbatim, only the declarations around it change.

### 4.1 Tier 0 — `if=` chains over booleans

For a prototype, two or three booleans gating sibling elements is usually fine. Fragment:

```scrml
<div if=@loading>Loading…</div>
<div else-if=(@error != "")>Error: ${@error}</div>
<div else>Welcome.</div>
```

This is correct scrml. It is also a candidate for promotion: as soon as you reach for a third or fourth boolean to model the same "phase of this screen," you have a state machine in everything but name. The `W-LIFECYCLE-CANDIDATE` lint exists to suggest the upgrade.

### 4.2 Tier 1 — an enum and `match`

The first commitment step is to name the screen's phases as an enum and dispatch on it with `match`:

<!-- snippet: docs/tutorial-snippets/04a-tier1-match.scrml -->
```scrml
// 04a-tier1-match.scrml — Tier 1: an enum, and <match> to dispatch on it.

<program>

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

  // The value-return form of match: compute a value from the variant.
  const <status> = match @phase {
    .Idle        :> "idle"
    .Loading     :> "loading"
    .Loaded(n)   :> "loaded"
    .Failed(msg) :> "failed"
  }

  <p>Status: ${@status}</p>

  // The block form of match: one child element per variant, holding its markup.
  <match for=LoadPhase on=@phase>
    <Idle>
      <button onclick=load()>Load</button>
    </Idle>
    <Loading>
      <p>Loading…</p>
    </Loading>
    <Loaded(n)>
      <p>Got ${n} rows.</p>
      <button onclick={ @phase = .Idle }>Reset</button>
    </Loaded>
    <Failed(msg)>
      <p class="err">Failed: ${msg}</p>
      <button onclick={ @phase = .Idle }>Try again</button>
    </Failed>
  </match>

</program>
```

Three things are new:

1. **An enum type.** `type LoadPhase:enum = { Idle, Loading, Loaded(rows: number), Failed(msg: string) }` declares a tagged sum type. `Idle` and `Loading` carry no payload; `Loaded(rows: number)` and `Failed(msg: string)` each carry one. The whole shape is "one of these four, exactly."

2. **The reactive holds an enum value.** `<phase>: LoadPhase = .Idle` declares `phase` as a `LoadPhase` reactive starting in `.Idle`. The leading `.` is bare-variant inference — the compiler infers `.Idle` as `LoadPhase.Idle` because the cell's type is statically known. Inside a function-call argument position the inference doesn't always fire, so `LoadPhase.Loaded(42)` qualifies the constructor explicitly.

3. **Two `match` shapes.** In **markup position** — choosing which UI to show — use the block form `<match for=LoadPhase on=@phase>`: each child element names a variant and holds that variant's markup directly. A payload variant binds its payload in the child's opener: `<Loaded(n)>` makes the `rows` value available as `n` inside. In **value position** — computing a value, in a derived cell or a function body — use the expression form `match @phase { .Variant :> value }`, as `const <status>` does above. Both run the same exhaustiveness check and payload destructuring.

`match` is exhaustive. Adding a fifth variant to `LoadPhase` later — say `Cached(rows: number)` — turns every match site into a compile error until you add the new arm. That is the main benefit of enums + `match` over a chain of `if=`s: the compiler will tell you exactly where to update.

> **The expression form in markup.** You will also see `${ match @phase { .Idle :> { lift <button>...</button> } ... } }` — the expression form inside a logic block, with `lift` in each arm. It compiles, and it is the right tool when an arm must run statements before it produces markup. For plain "this variant shows this markup", the block form above is the canonical shape.

### 4.3 Tier 2 — `<engine for=Type initial=...>` with `rule=` transitions

The full engine surface adds three concepts to the Tier-1 shape: an `initial=` state, a `rule=` attribute on each state-child declaring legal transitions out, and `<onTransition>` blocks for cross-state effects. The engine is declared **inside `<program>`** as a direct child — types, functions, and engines all live as program-scoped declarations. State-child bodies may hold markup directly (the engine swaps in the current variant's body when the engine variable changes); for the introductory shape below the bodies are empty and the variants are rendered by a `<match>` block, since that carries forward verbatim from Tier 1.

<!-- snippet: docs/tutorial-snippets/04b-tier2-engine.scrml -->
```scrml
// 04b-tier2-engine.scrml — Tier 2: an <engine> with rule= contracts.
//
// The engine is a direct child of <program>, alongside the type and the
// function. Each state-child's rule= lists the legal transitions out of it.
// The bodies are empty here; the <match> below renders each phase.

<program>

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

  <engine for=LoadPhase initial=.Idle>
    <Idle    rule=.Loading></>
    <Loading rule=(.Loaded | .Failed)></>
    <Loaded  rule=.Idle></>
    <Failed  rule=.Idle></>
  </>

  <match for=LoadPhase on=@loadPhase>
    <Idle>
      <button onclick=load()>Load</button>
    </Idle>
    <Loading>
      <p>Loading…</p>
    </Loading>
    <Loaded(n)>
      <p>Got ${n} rows.</p>
      <button onclick={ @loadPhase = .Idle }>Reset</button>
    </Loaded>
    <Failed(msg)>
      <p class="err">Failed: ${msg}</p>
      <button onclick={ @loadPhase = .Idle }>Try again</button>
    </Failed>
  </match>

</program>
```

Read it as: "the engine owns the `LoadPhase` enum, starts in `.Idle`, declares the legal transitions out of each variant, and the program renders the right markup for the current phase."

Things to notice:

- **`<engine for=LoadPhase initial=.Idle>`** inside `<program>` declares the engine. The engine's variable is **auto-declared** by the compiler — its name is the type name with a lowercase first letter (`loadPhase` here). You do NOT also write `<loadPhase> = .Idle`; that would be a duplicate declaration.
- **`initial=.Idle`** sets the starting state. Required on non-derived engines.
- **`rule=` declares legal transitions OUT** of this state-child. `rule=.Loading` means "from `.Idle` you may transition to `.Loading`." Multi-target uses parens with `|`: `rule=(.Loaded | .Failed)`.
- **State-child bodies are empty (`</>`)** in the snippet above. They may hold markup directly — the engine renders the current variant's body at the engine's position and re-wires the reactive bindings inside. The empty-body shape with a sibling `<match>` is the introductory idiom because it keeps "where the markup lives" obvious.
- **Transitions are direct writes.** `@loadPhase = .Loading` triggers the engine's validation: if the destination is not in the current state-child's `rule=` set, you get `E-ENGINE-INVALID-TRANSITION` (compile-time when the from-state is statically known, runtime otherwise). The `Reset` button's inline block handler `onclick={ @loadPhase = .Idle }` is such a write.
- **`<onTransition>`** declares a cross-state effect — code that runs on a transition. It is *directional* and carries exactly one trigger attribute: `<onTransition to=.B>` placed inside the **from**-state-child fires when leaving that state toward `.B`; `<onTransition from=.A>` placed inside the **target** state-child fires on arrival from `.A` (the inverse direction). An `<onTransition>` with neither `to=` nor `from=` has no trigger and is `E-ONTRANSITION-NO-TARGET`. Use it for analytics, animations, cleanup, anything that should happen on the transition itself.

The migration story from Tier 1 to Tier 2 is mechanical: the `<match>` block carries forward verbatim; you add an `<engine for=Type initial=...>` declaration with `rule=` contracts inside `<program>`; the type-annotated cell `<phase>: LoadPhase` becomes the engine's auto-declared variable (`@loadPhase`).

> **Where an engine renders.** When state-child bodies hold markup, the engine renders at its declaration position. When the bodies are empty (this snippet), rendering happens wherever the `<match>` block sits. Cross-file engines (imported from another `.scrml` file) use a `<EngineName/>` use-site mount tag, but you only meet that when you split a program across files.

### 4.4 Why the ladder

Three rungs, three points of commitment:

- **Tier 0** is fine for prototypes. Two booleans is not yet a state machine.
- **Tier 1** is the first commitment: name the phases, dispatch on the variant. Exhaustiveness checking starts here. You can stop at Tier 1 if the transition story is uninteresting ("any phase can move to any other phase; the compiler just dispatches on value").
- **Tier 2** is the second commitment: declare legal transitions. The compiler now rejects invalid moves at compile time when it can see the from-state, runtime otherwise. The engine is the single source of truth for "what are the next legal actions?", which is often what the UI wants to ask ("which buttons should be enabled?").

Promote when the cost of promotion is less than the cost of bugs the next tier prevents. For a screen with two modes that never go wrong, Tier 0 is fine forever. For an order lifecycle (Draft → Submitted → Paid → Shipped → Delivered), Tier 2 prevents a whole class of "the cancelled order somehow shipped" bugs.

### 4.5 Derived engines

A **derived engine** computes its state from another reactive value instead of being written directly. Here a `HealthRisk` engine is projected from a `MarioState` engine:

<!-- snippet: docs/tutorial-snippets/04c-derived-engine.scrml -->
```scrml
// 04c-derived-engine.scrml — a derived engine projects one enum onto another.

<program>

  type MarioState:enum = { Small, Big, Fire, Cape }
  type HealthRisk:enum = { AtRisk, Safe }

  <engine for=MarioState initial=.Small>
    <Small rule=(.Big | .Fire | .Cape)></>
    <Big   rule=(.Small | .Fire | .Cape)></>
    <Fire  rule=(.Small | .Big | .Cape)></>
    <Cape  rule=(.Small | .Big | .Fire)></>
  </>

  // @healthRisk is recomputed from @marioState; it cannot be written directly.
  <engine for=HealthRisk derived=match @marioState {
    .Small               :> .AtRisk
    .Big | .Fire | .Cape :> .Safe
  }>
    <AtRisk/>
    <Safe/>
  </>

  <div>
    <p>Mario: ${@marioState} — risk: ${@healthRisk}</p>
    <button onclick={ @marioState = .Big }>Mushroom</button>
    <button onclick={ @marioState = .Small }>Hit</button>
  </div>

</program>
```

`derived=` takes any expression of the engine's type — a `match`, as here, a ternary, or a function call — and the engine recomputes whenever a reactive value the expression reads changes. `rule=`, `initial=`, and direct writes are not allowed on a derived engine, because the source drives everything. Use it when one piece of state has a natural read-only view of another. For a larger engine program, see `examples/14-mario-state-machine.scrml`.

---

## 5. Forms — `<form>`, validators, and the auto-synthesized validity surface

Validation in scrml is **declarative**, not imperative. You don't write a `validate()` function; you declare validators directly on the state-cell declarations, and the compiler synthesizes a reactive validity surface and error-rendering path automatically.

Here is a signup form that exercises the full surface:

<!-- snippet: docs/tutorial-snippets/05-signup-form.scrml -->
```scrml
// 05-signup-form.scrml — declarative form with auto-synth validity surface.
//
// Compound state with validators (<signup>...) auto-synthesizes a reactive
// validity surface: @signup.isValid, @signup.errors, @signup.touched, plus
// per-field surfaces (@signup.name.isValid, @signup.name.errors, ...).
// All synth properties are read-only — the compiler computes them.
//
// The engine lives inside <program>; a <match> renders the markup for each phase.
//
// `db=` is required because persistSignup() runs a `?{}` write (E-SQL-004,
// §44.7): a `?{}` with no db= in any ancestor <program> has no connection.

<program db="users.db">

  type SignupPhase:enum = { Editing, Submitting, Done }

  <engine for=SignupPhase initial=.Editing>
    <Editing    rule=.Submitting></>
    <Submitting rule=.Done></>
    <Done       rule=.Editing></>
  </>

  <signup>
    <name     req length(>=2)>             = <input type="text"/>
    <email    req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
    <password req length(>=8)>              = <input type="password"/>
    <confirm  req eq(@signup.password)>     = <input type="password"/>
    <agree    req>                          = <input type="checkbox"/>
  </>

  function submit() {
    if (!@signup.isValid) return
    @signupPhase = SignupPhase.Submitting
    persistSignup(@signup.name, @signup.email, @signup.password)
    @signupPhase = SignupPhase.Done
  }

  // Runs on the server: the body touches a `?{}` SQL block.
  function persistSignup(name, email, password) {
    ?{`INSERT INTO users (name, email, password_hash) VALUES (${name}, ${email}, ${password})`}.run()
  }

  <match for=SignupPhase on=@signupPhase>
    <Editing>
      <form onsubmit=submit()>
        <h1>Sign up</h1>
        <label>Name      <name/>     <errors of=@signup.name/></label>
        <label>Email     <email/>    <errors of=@signup.email/></label>
        <label>Password  <password/> <errors of=@signup.password/></label>
        <label>Confirm   <confirm/>  <errors of=@signup.confirm/></label>
        <label class="row">
          <agree/> I agree to the terms
          <errors of=@signup.agree/>
        </label>
        <button type="submit" disabled=!@signup.isValid>Create account</button>
      </form>
    </Editing>
    <Submitting>
      <p>Creating your account…</p>
    </Submitting>
    <Done>
      <p>Welcome, ${@signup.name}!</p>
      <button onclick={ @signupPhase = SignupPhase.Editing }>Sign up another</button>
    </Done>
  </match>

</program>
```

This program puts much of the language in one place. Let's walk it.

### 5.1 Compound state — `<signup> ... </>`

`<signup> ... </>` declares a **compound state cell** with field-children inside. Each field is a normal V5-strict declaration; the compound parent groups them under one name. Field access uses `@signup.name` (canonical), exactly the same shape as `@user.name` for a plain struct field.

### 5.2 Decl-coupled-with-render-spec — `<name req> = <input/>`

The declaration `<name req length(>=2)> = <input type="text"/>` does three things at once:

1. **Declares** `name` as a reactive cell.
2. **Attaches validators** (`req` and `length(>=2)`) as bare attributes on the declaration.
3. **Couples a render-spec** — the `<input>` element on the right. Whenever you write `<name/>` in markup, it expands to the bound input element.

This is the canonical scrml shape for "the form field is a value and its rendering at the same time." You don't separately write `<input bind:value=@signup.name>` — the decl-coupled form does the binding for you.

### 5.3 The validator vocabulary

The 14 universal-core validators are: `req`, `is given`, `length(rel)`, `pattern(regex)`, `min(n)`, `max(n)`, `gt(expr)`, `lt(expr)`, `gte(expr)`, `lte(expr)`, `eq(expr)`, `neq(expr)`, `oneOf([...])`, `notIn([...])`.

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

The signup form is one state of a three-state engine (`Editing` → `Submitting` → `Done`). The engine inside `<program>` owns the legal transitions; the `<match>` block renders the right markup for the current phase. This is the canonical Tier-2 idiom: the form's lifecycle (you can submit it, then you can't, then you're done) is a state machine, and the engine makes that explicit. The `Sign up another` button's inline block handler, `onclick={ @signupPhase = SignupPhase.Editing }`, is the transition back.

The `disabled=!@signup.isValid` on the submit button uses the `!` boolean-negation operator (§7) — same spelling as JavaScript's `!x`. (`not` is the absence value, not a negation operator.) Combined with the auto-synth surface, the button is automatically enabled or disabled based on whether every field passes its validators.

### 5.7 `reset(@cell)` — clearing form state

To clear a form, call `reset(@signup)` — `reset` is a language keyword (no import needed). It re-evaluates each field's init expression, restoring the form to its initial state. Per-field reset works too: `reset(@signup.name)`. Fragment:

```scrml
<button type="button" onclick=reset(@signup)>Clear</button>
```

> **`reset` is a reserved identifier.** You cannot define `function reset() { ... }` — pick another name like `clearForm` or `restart` for local helpers.

---

## 6. Failable functions — `function f()! -> Err` and `!{}`

Some operations can fail: a network call, a database query, a parsing pass. scrml models errors as **enum variants** rather than thrown exceptions. A function that can fail is declared with `!` after its parameter list and an error type after the return arrow. Callers handle each variant with a `!{ ... }` block.

<!-- snippet: docs/tutorial-snippets/06-failable.scrml -->
```scrml
// 06-failable.scrml — failable function with a typed error enum.
//
// `function f()! -> Err { fail .Variant }` declares a failable function;
// the `!{}` block at the call site pattern-matches each variant.
// No try/catch, no throw, no async/await — failures are typed values.

<program db="users.db">

  <schema>
    users {
      id:    integer primary key
      name:  text not null
      email: text not null
    }
  </>

  type SaveError:enum = {
    EmptyName
    InvalidEmail(input: string)
    DuplicateEmail(email: string)
  }

  type Phase:enum = { Editing, Saving, Saved, Errored(msg: string) }

  <engine for=Phase initial=.Editing>
    <Editing rule=.Saving></>
    <Saving  rule=(.Saved | .Errored)></>
    <Saved   rule=.Editing></>
    <Errored rule=.Editing></>
  </>

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
        if (!email.includes("@"))                fail SaveError.InvalidEmail(email)
        const existing = ?{`SELECT id FROM users WHERE email = ${email}`}.get()
        if (existing is given)                    fail SaveError.DuplicateEmail(email)
        ?{`INSERT INTO users (name, email) VALUES (${name}, ${email})`}.run()
      }

      function save() {
        @phase = Phase.Saving
        persistUser(@form.name, @form.email) !{
          .EmptyName        :> { @phase = Phase.Errored("Name can't be empty.") ; return }
          .InvalidEmail(e)  :> { @phase = Phase.Errored("Not an email: " + e) ; return }
          .DuplicateEmail(e):> { @phase = Phase.Errored(e + " is already taken.") ; return }
        }
        @phase = Phase.Saved
      }
    }

    <match for=Phase on=@phase>
      <Editing>
        <form onsubmit=save()>
          <label>Name  <name/>  <errors of=@form.name/></label>
          <label>Email <email/> <errors of=@form.email/></label>
          <button type="submit" disabled=!@form.isValid>Save</button>
        </form>
      </Editing>
      <Saving>
        <p>Saving…</p>
      </Saving>
      <Saved>
        <p>Saved!</p>
        <button onclick={ @phase = Phase.Editing }>Add another</button>
      </Saved>
      <Errored(msg)>
        <p class="err">${msg}</p>
        <button onclick={ @phase = Phase.Editing }>Try again</button>
      </Errored>
    </match>

  </>

</program>
```

The shape:

- **`function persistUser(name, email)! -> SaveError`** — the `!` after the parameter list marks the function as failable. The arrow specifies the error enum type. The body uses `fail SaveError.Variant` (or `fail SaveError.Variant(payload)`) to raise a specific error.
- **`!{ ... | .Variant :> { ... } }`** at the call site — pattern-match each error variant. The match is **exhaustive**; if a new variant is added to `SaveError`, the compiler tells you which call sites need a new arm.
- **Errors propagate when not handled.** A `!{ ... }` that doesn't handle a particular variant lets it bubble up. The compiler tracks unhandled error types in the function's signature.

Notice what is NOT in this code: no `try` / `catch`, no `throw`, no `Promise.reject`. Failures are values; they flow through ordinary control flow. The signature of every failable function tells you exactly which errors can come out — there are no hidden exceptions.

> **No `async`, no `await`, no `Promise` in user source.** The compiler manages the async boundary for you (§19.9.3) — server functions, stdlib `scrml:*` `Promise<T>` exports, and cross-program calls (`<#name>.foo(...)`) all return `Promise<T>` under the hood, but you write straight-line `const user = persistUser(...)` and the await is invisible at the syntax level. Per §19.9.8, you do not write `async`, `await`, `Promise`, or `Promise.all` in scrml source — not on a function, not in expression position, not anywhere. A cross-program `Promise<T>` result left unawaited (escaping the compiler's managed path) is a compile **error**, `E-PROG-004` (§40.4) — not a lint. Failable calls flow through the same machinery — `persistUser(...) !{ ... }` is the canonical shape on both client and server.

### 6.1 Errors are states — the engine shape composes

Look at how the `!{}` handler in `save()` routes each failure variant into a phase change: `.EmptyName :> { @phase = Phase.Errored("...") }`. The `<match>` then renders the right markup for each phase. The error path and the success path both flow through `@phase`, and the engine's `rule=` contracts guarantee that the screen always shows exactly one state.

This is the canonical scrml pattern for handling failures: the failable call's `!{}` handler routes each variant into the right phase variant; the markup matches each phase to the right UI. There is no separate `<isError>` cell, no separate error component to remember to render — the failure mode lives in the type.

---

## 7. Negation, presence checks — `!` vs the `not` absence value

A small but load-bearing detail. scrml uses three operators where JavaScript uses one:

| scrml | JavaScript | Reading |
|---|---|---|
| `!x` | `!x` | Boolean negation — `!` is the negation operator. |
| `x is given` | `x !== null && x !== undefined` | Presence check — value exists. |
| `x is not` | `x === null \|\| x === undefined` | Absence check — value missing. |

`!` is the boolean negation operator (`!x`, `!(a == b)`) — same spelling and meaning as JavaScript. The keyword `not` is **not** a negation operator: it is the absence value (§42, Absence Semantics). `not` appears only as the absent value itself (`<user>: User? = not`, `@user = not`) or as the right-hand side of `is` (`x is not`); `not x` in prefix position before a boolean is a compile error (`E-TYPE-045`).

<!-- snippet: docs/tutorial-snippets/08-presence.scrml -->
```scrml
// 08-presence.scrml — `!` negates a boolean; `not` is the absence value.

<program>

  type User:struct = { name: string }

  <user>: User? = not              // optional — starts absent
  <loggedIn> = false

  const <message> = @user is given ? "Hello, " + @user.name : "Sign in to continue"

  <div>
    <p>${@message}</p>

    <button if=(!@loggedIn) onclick={ @user = { name: "Ada" }; @loggedIn = true }>Sign in</button>
    <button else onclick={ @user = not; @loggedIn = false }>Sign out</button>
  </div>

</program>
```

`not` is the absence sentinel — `<user>: User? = not` reads "user is an optional User, initialized to absent." Writing `null` or `undefined` here is `E-SYNTAX-042` (scrml has no `null`/`undefined` keywords). `@user is given` guards the read of `@user.name`; `!@loggedIn` negates a boolean; and the sign-in button's inline block handler, `onclick={ @user = { name: "Ada" }; @loggedIn = true }`, runs two writes in order.

Equality uses `==` and `!=`, and there is no `===` or `!==` (`E-EQ-004`). `==` compares **values, structurally** (§45): two structs are equal when their fields are equal, two enum values when they have the same variant and equal payloads, primitives by value. There is no identity comparison and no type coercion — comparing values of different types, such as `0 == false`, is a compile error (`E-EQ-001`).

---

## 8. Channels — real-time state, one tag

Real-time sync over a WebSocket connection is built into the language as a `<channel>` element. In an entry file (a file that declares `<program>`), the channel lives **inside** `<program>` as a sibling of `<page>` and the rest of the program body. State declared inside the channel body is auto-synced to every connected client:

<!-- snippet: docs/tutorial-snippets/07-channel-chat.scrml -->
```scrml
// 07-channel-chat.scrml — chat room with shared state.

<program>

  <channel name="chat" topic="lobby">
    <messages> = []

    function postMessage(author, body) {
      @messages = [...@messages, { author, body, ts: Date.now() }]
    }
  </>

  <username> = ""
  <draft>    = ""

  function send() {
    if (@draft.trim() == "" || @username.trim() == "") return
    postMessage(@username, @draft)
    reset(@draft)
  }

  <div class="chat">
    <input type="text" bind:value=@username placeholder="Your name"/>
    <ul>
      <each in=@messages as m key=m.ts>
        <li><strong>${m.author}</strong>: ${m.body}</li>
      </each>
    </ul>
    <form onsubmit=send()>
      <input type="text" bind:value=@draft placeholder="Message"/>
      <button type="submit">Send</button>
    </form>
  </div>

</program>
```

Three things to notice:

1. **`<channel>` lives inside `<program>`.** Channels are descendants of the entry-file `<program>` — app-scope shared-state vehicles, siblings of `<page>` declarations. Putting a channel at file top level in a file that already declares `<program>` fires `E-CHANNEL-OUTSIDE-PROGRAM`; putting one inside an individual `<page>` fires `E-CHANNEL-INSIDE-PAGE`. (A separate module file that contains no `<program>` may declare a `<channel>` at file top — the "pure channel file" shape, §38.12.6 — but that is a sharing pattern beyond this tutorial.)
2. **`<messages> = []`** declared inside the channel body is auto-synced. Every connected client sees the same `@messages`; a write from any client propagates to all the others. There is no `@shared` modifier — synchronization comes from being inside the channel body.
3. **`@messages` is reachable from the rest of `<program>`** via canonical `@messages` access. The channel-declared cells are program-scope visible.

The compiler emits the WebSocket endpoint (`/_scrml_ws/chat` for this channel), the message-broadcast plumbing, and the reconnection logic. You declare what state is shared; the compiler handles the transport.

> **Channels are heavy operationally.** A live channel requires a running WebSocket server, which means you're committed to running a scrml app (not just shipping static HTML). Use channels for genuinely multi-client features — chat, multiplayer cursors, live dashboards. For single-user state, plain reactive cells are simpler and have no infrastructure cost.

---

## 9. Auth — sign-in required, decisions on the server

`auth="required"` on `<program>` puts every request behind a session check at the server: a request without a signed-in session is redirected to `/login`, and the compiler adds the same check to each server function the program exposes. Anything that must stay private to some users is decided **in a server function**, where the compiler provides a `session` object:

<!-- snippet: docs/tutorial-snippets/09-auth.scrml -->
```scrml
// 09-auth.scrml — sign-in required; admin-only data decided on the server.

<program auth="required">

  <report> = ""

  // Reading `session` makes this a server function. The role check runs on
  // the server, so a non-admin's response never contains the admin text.
  function loadAdminReport() {
    if (session.role is given && session.role == "Admin") {
      return "3 signups are waiting for review."
    }
    return ""
  }

  function refresh() {
    @report = loadAdminReport()
  }

  <div>
    <h1>Dashboard</h1>
    <button onclick=refresh()>Load admin report</button>
    <p if=(@report != "")>${@report}</p>
  </div>

</program>
```

What this does and does not give you:

1. **The role check runs on the server.** Reading `session` makes `loadAdminReport` a server function — `session` exists only on the server, so the compiler places any function that reads it there. A non-admin's response simply does not contain the admin text; it never reaches their browser. `session.userId`, `session.role`, and `session.isAuth` describe the signed-in user.
2. **You still need a login page.** Until one exists at `/login`, the compiler warns (`W-AUTH-LOGIN-MISSING`): the redirect would land on a 404. `scrml generate auth` scaffolds one at `pages/login.scrml`.
3. **`<auth role="Admin">` is not a secrecy control.** You may see markup wrapped in `<auth role="...">`. That element does not hide its content: the wrapped markup is sent to every visitor in the page HTML, whatever their role, and the compiler says so with `W-AUTH-CONTENT-NOT-GATED` at each use. Under the opt-in `--emit-per-route` build flag, the compiler splits the page's JavaScript into per-route, per-role chunks so that a role's chunk does not mount the gated components — but the HTML is still shared. Keep secrets in server functions, as above.

---

## 10. The shape, all together

By now you have seen every primitive you need to build a working scrml app. Here they are collected in one real program — a small notes app — in the order they usually appear in a non-trivial scrml file:

<!-- snippet: docs/tutorial-snippets/10-all-together.scrml -->
```scrml
// 10-all-together.scrml — the spine of a typical scrml program, in one file.

<program db="notes.db">

  // Types — structs and enums, as direct <program> children
  type Note:struct = { id: number, body: string }
  type Phase:enum = { Idle, Loading, Loaded, Failed(msg: string) }
  type SaveError:enum = { TooShort, Duplicate(body: string) }

  // Schema — the database shape, declared next to the code that uses it
  <schema>
    notes {
      id:   integer primary key
      body: text not null
    }
  </>

  // Engine — auto-declares @phase; rule= lists the legal moves out of each state
  <engine for=Phase initial=.Idle>
    <Idle    rule=(.Loading | .Failed)></>
    <Loading rule=(.Loaded | .Failed)></>
    <Loaded  rule=(.Loading | .Failed)></>
    <Failed  rule=.Loading></>
  </>

  // Channel — state shared live with every connected client
  <channel name="activity">
    <lastSaved> = ""
  </>

  <db src="notes.db" tables="notes">

    ${
      <notes>: Note[] = []                    // plain reactive
      const <count> = @notes.length           // derived reactive

      // Compound state with a validator
      <draft>
        <note req length(>=3)> = <input type="text"/>
      </>

      // Server functions — they touch ?{}, so they run on the server.
      // They return data; they do not write @state.
      function loadNotes() {
        return ?{`SELECT id, body FROM notes ORDER BY id`}.all()
      }

      function saveNote(body)! -> SaveError {
        if (body.length < 3) fail SaveError.TooShort
        const existing = ?{`SELECT id FROM notes WHERE body = ${body}`}.get()
        if (existing is given) fail SaveError.Duplicate(body)
        ?{`INSERT INTO notes (body) VALUES (${body})`}.run()
      }

      // Client functions — call the server and own the @state writes
      function load() {
        @phase = Phase.Loading
        @notes = loadNotes()
        @phase = Phase.Loaded
      }

      function submit() {
        saveNote(@draft.note) !{
          .TooShort     :> { @phase = Phase.Failed("Too short.") ; return }
          .Duplicate(b) :> { @phase = Phase.Failed(b + " is already saved.") ; return }
        }
        @lastSaved = @draft.note
        reset(@draft)
        load()
      }

      // Component — reusable markup with typed props
      const NoteRow = <li class="row" props={ note: Note }>${note.body}</li>
    }

    // Style block, placed just before the markup it styles
    #{
      .row { padding: 0.5rem; border-bottom: 1px solid #eee; }
    }
    <div>
      <form onsubmit=submit()>
        <note/> <errors of=@draft.note/>
        <button type="submit" disabled=!@draft.isValid>Save</button>
      </form>
      <p if=(@lastSaved != "")>Last saved: ${@lastSaved}</p>

      <match for=Phase on=@phase>
        <Idle>
          <button onclick=load()>Load notes</button>
        </Idle>
        <Loading>
          <p>Loading…</p>
        </Loading>
        <Loaded>
          <p>${@count} notes</p>
          <ul>
            <each in=@notes as n key=n.id>
              <NoteRow note=n/>
            </each>
          </ul>
        </Loaded>
        <Failed(msg)>
          <p class="err">${msg}</p>
          <button onclick=load()>Reload</button>
        </Failed>
      </match>
    </div>

  </>

</program>
```

That shape is the idiomatic scrml file. Once it feels natural, the language is no longer doing anything new at you — you are combining primitives you already know.

A practical note on the parts: the **engine** owns the top-level lifecycle (the screen's modes), **compound state with validators** owns each form, the **failable function** is the call site between client and server, and the **derived state** stays the right value automatically. Most non-trivial scrml programs have this spine.

---

## 11. Where to go next

You now know enough scrml to write working programs. From here:

- **Examples** — `examples/` in this repository holds longer runnable apps. Each is a single-file program (or a small directory) you can compile and run. Of particular interest:
  - `examples/02-counter.scrml` — a counter, the smallest complete app.
  - `examples/03-contact-book.scrml` — full-stack CRUD against SQLite.
  - `examples/05-multi-step-form.scrml` — multi-step wizard with components and enums.
  - `examples/14-mario-state-machine.scrml` — an engine with payload variants and transitions driven by user actions.
  - `examples/15-channel-chat.scrml` — real-time chat across multiple clients.
  - `examples/22-multifile/` — cross-file imports for larger apps.

- **The full specification** — `compiler/SPEC.md` is the formal grammar and semantics. The tutorial covers the common 80%; the SPEC covers the edges. `compiler/SPEC-INDEX.md` is the quick-lookup table of contents, and the `§` numbers in this tutorial are SPEC sections.

- **Error codes** — when the compiler flags an error, the code (`E-NAME-COLLIDES-STATE`, `E-RI-002`, `E-DERIVED-WRITE`, ...) is your best search term. The SPEC's error-code catalog (§34) explains the rule each code enforces and the usual fix.

---

## Glossary — the primitives in this tutorial

A fast reference for the keywords and sigils in this tutorial. Each line links back to the section that explains it.

- **`<program>`** — the top-level element wrapping a scrml app. §1.
- **`${ ... }`** — logic block (statement position) or interpolation (expression position). §1.
- **`<name> = init`** — V5-strict reactive state declaration. §2.
- **`@name`** — canonical expression access (read, write, compound assignment). §2.
- **`const <name> = expr`** — derived reactive; recomputes when inputs change. §2.1.
- **`<name>` inside a compound** — field declaration inside a compound parent. §5.1.
- **`<signup><field req .../>... </>`** — compound state with validators. §5.
- **`<name req length(>=2)> = <input/>`** — decl-coupled-with-render-spec form. §5.2.
- **`@form.isValid` / `@form.errors` / `@form.touched`** — auto-synth validity surface (read-only). §5.4.
- **`<errors of=expr/>`** — first-class error-rendering element. §5.5.
- **`bind:value=@var`** — two-way binding on a form control. §3.4.
- **`class:active=expr`** — conditional class attachment. §3.4.
- **`onclick=fn()`** — bare-call event handler. §3.4.
- **`onclick={ a(); @b = 1 }`** — inline block handler; statements run in order. §3.4.
- **`if=expr` / `else-if=expr` / `else`** — conditional rendering chain on sibling elements (`else` is bare). §3.5.
- **`<each in=@coll as x key=x.id>...</each>`** — canonical Tier-1 markup iteration; space binder `as x` (never `as=x`). §3.2.
- **`for (let x of @xs) { lift <li>...</li> }`** — Tier-0 markup iteration. §3.2.
- **`type Name:struct = { ... }`** — structural record type. §3.1.
- **`type Name:enum = { A, B(n: number), ... }`** — tagged sum type. §4.2.
- **`<match for=Type on=expr> <Variant>...</Variant> </match>`** — block-form markup dispatch; each child element names a variant and holds its markup directly; `<Variant(x)>` binds the payload. §4.2.
- **`match expr { .V :> value }`** — expression-form match (value position). §4.2.
- **`<engine for=Type initial=.V>`** — Tier 2 engine (direct child of `<program>`); auto-declares the engine variable. §4.3.
- **`<Variant rule=(.A | .B)>`** — state-child with legal-transitions contract (multi-target `rule=` MUST be parenthesized). §4.3.
- **`<onTransition to=.B>`** (in the from-state) / **`<onTransition from=.A>`** (in the target state) — directional cross-state effect; exactly one of `to=` / `from=` per element. §4.3.
- **`<engine for=T derived=expr>`** — derived (read-only) engine recomputed from `expr`. §4.5.
- **`<program db="...">`** — names the program's database. §2.2.
- **`<db src="..." tables="...">`** — database connection scope. §2.2.
- **`<schema> ... </>`** — declarative SQL schema; `scrml db-migrate` applies it. §2.2.
- **`?{ ` ` ` ... ` ` ` }.all() / .get() / .run()`** — parameterized SQL. §2.2.
- **Server-escalated function** — a function that touches `?{}` SQL, `session`, or another server-only resource runs on the server. The legacy `server function` keyword still compiles but is deprecated. §2.2.
- **`function f()! -> Err { fail Err.Variant ... }`** — failable function. §6.
- **`caller() !{ | .Variant :> {...} }`** — error destructuring at call sites. §6.
- **`is given` / `is not`** — presence / absence predicates. **`!`** — boolean negation. **`not`** — the absence value (`= not`, `x is not`), NOT a negation operator. §7.
- **`==` / `!=`** — structural value equality (no `===`/`!==`). §7.
- **`reset(@cell)`** — language keyword for resetting state to its initial value. §5.7.
- **`<channel name="..." topic="...">`** — real-time shared state; lives inside `<program>` (or at file top in a pure-channel module file). §8.
- **`<program auth="required">`** — every request needs a signed-in session; server functions are checked too. §9.
- **`session`** — the signed-in user (`session.userId`, `session.role`, `session.isAuth`), available only in server functions. §9.
- **`<auth role="X">...</auth>`** — a JavaScript-mount gate used with `--emit-per-route`; NOT content secrecy (`W-AUTH-CONTENT-NOT-GATED`). §9.
- **`#{ ... }`** — style block: global at program level, scoped to the component inside a component body. §2.3.

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
| `try { ... } catch { ... }` | `f() !{ | .Variant :> { ... } }` | §6 |
| `throw new Error(...)` | `fail Err.Variant` (typed error enum) | §6 |
| `if (@phase === 'loading') ...` chains | `<engine for=Phase initial=.Idle>` | §4.3 |
| Many booleans gating UI | One enum + engine | §4 |
| `null` / `undefined` literals | `is given` / `is not` | §7 |
| `===` / `!==` | `==` / `!=` | §7 |
| `not x` (intending negation) | `!x` (`not` is the absence value, not negation) | §7 |
| `< machine name=...>` (legacy v0.1) | `<engine for=Type initial=...>` | §4.3 |
| `@item.name` for a component prop | `item.name` — props are read by bare name | §3.3 |
| `function validate() { if (@form.name == "") ... }` | `<name req> = <input/>` (decl-coupled) | §5 |
| `if (@signup.errors.name.length > 0) <p>...</p>` | `<errors of=@signup.name/>` | §5.5 |
| `<input bind:value=@signup.name>` written separately | `<name req> = <input/>` (decl-coupled) | §5.2 |
| `import { useState } from 'react'` | nothing — `<var> = init` is built in | §2 |
| `import Database from 'better-sqlite3'` | `<db src="..."> ... ?{} ... </>` | §2.2 |
| `bcrypt` / `jsonwebtoken` via npm | `import { hashPassword } from 'scrml:auth'` | §6 |
| `server function f()` (legacy v0.1) | plain `function f()` — body-content inference escalates | §2.2 |
| `socket.io`, custom WebSocket setup | `<channel name="..."> ... </>` | §8 |
| Hiding admin markup with a wrapper element | Return admin-only data from a server function that checks `session.role` | §9 |
| `<MyEngine/>` for a same-file engine | The engine renders at its declaration position | §4.3 |
| Unbraced multi-statement handler `onclick=fn(); @x = .Y` (`E-MULTI-STATEMENT-HANDLER`) | Wrap it in braces: `onclick={ fn(); @x = .Y }` (inline block, SPEC §5.2.3) — or name a function if it's reused | §3.4 |

If you don't see your case in the table, default to the shape from §10. Don't invent syntax — when in doubt, the canonical reference is the specification (`compiler/SPEC.md`, navigated with `compiler/SPEC-INDEX.md`).

---

*Last updated: 2026-09-29, against scrml v0.8.0. Every complete program above is compiled by CI (`scripts/snippet-gate.js`), which also fails if the copy printed here stops matching its file.*
