# scrml Tutorial — zero to a running app

<!-- dialect: ruled -->

This tutorial walks you from an empty directory to a small but complete scrml app: a counter that persists to SQLite, a signup form with declarative validation, an engine-driven state machine, and a real-time channel. It teaches **today's ruled scrml**, the language the specification (`compiler/SPEC.md`) defines and the scrml-native **bootstrap** compiler (`compiler/self-host-v2/`) implements. Every complete program in it is a file in `docs/tutorial-snippets/` that CI compiles with the bootstrap on every push, and CI also checks that the copy printed here is identical to that file (the `<!-- snippet: ... -->` line above each one names it). Shorter excerpts are marked as excerpts or fragments in the text.

**Spec-ahead programs.** The bootstrap does not build the whole language yet. A program that uses a feature it cannot compile yet — a `<schema>`, a `<channel>`, the `<match>` element — is still written in the ruled dialect, and is marked **spec-ahead** in this file's source (`<!-- gate: spec-ahead — … -->`, invisible when rendered), naming what is missing. CI still compiles it with the bootstrap, expects it to fail for now, and says so the day it starts compiling. Each section below says which of its programs the bootstrap compiles today. `docs/DIALECT.md` explains the markers.

**Audience.** You have written some JavaScript or TypeScript and used at least one reactive framework (React, Svelte, Vue, Solid). You have a passing familiarity with HTML and SQL. You do not need to know anything about scrml before reading this.

**What scrml is, in one paragraph.** scrml is a single-file language for full-stack web apps. One `.scrml` file compiles to the HTML, JavaScript, CSS, and server routes the app needs. Markup, reactive state, server functions, SQL, real-time channels, and tests all live in the same file; the compiler decides which half runs in the browser and which half runs on the server. The unit of organization is the program, not the tier.

**What this tutorial covers.** The ruled dialect as of S469 (October 2026). If you find older material that disagrees with this document — `<count> = 0` instead of `let <count:int=0/>`, `const <x> = …` derived cells, `<engine for=T>`, `const Row = <li props={…}>` components, statements without `;`, `while` loops, `push` on a list, or `"n = " + n` — it is an older dialect. The repository's first compiler (`scrml compile`, called impl#1) still speaks that older dialect and does not parse this one. scrml is newer than the training data of every current LLM, and the language has shifted since.

**Prerequisites.** Working knowledge of JavaScript syntax (`let`, arrow functions, template strings) and the DOM event model. A passing acquaintance with SQL helps for §2 onward but is not required — every SQL example uses only `SELECT` and `INSERT`.

---

## 0. Setup — the bootstrap compiler and the dev loop

scrml runs on [Bun](https://bun.sh) and is not published to npm; you work from the GitHub repository. With Bun installed (`curl -fsSL https://bun.sh/install | bash`):

```
git clone https://github.com/scrml-lang/scrml
cd scrml
bun install
bun run boot:dev docs/tutorial-snippets/02-counter.scrml
```

`bun run boot:dev <file>` compiles the file with the bootstrap, serves it on `http://127.0.0.1:3000/`, and recompiles and reloads the page each time you save. To compile once instead:

```
bun run boot:compile docs/tutorial-snippets/02-counter.scrml
```

The bootstrap writes the page (`index.html`), the client script and its runtime — plus a server module when the program has server functions — to `dist/<name>/` next to the input file, here `docs/tutorial-snippets/dist/02-counter/`. Pass `--output-dir <dir>` to put them elsewhere. The page loads ES modules, so open it over HTTP (`boot:dev`, or any static server), not `file://`. The first run builds the bootstrap itself (about ten seconds); later runs reuse a cached build.

The everyday surface is small:

```
bun run boot:compile <file>   — compile once to dist/<name>/ next to the input
bun run boot:dev <file>       — compile + serve + recompile and reload on save
bun run lsp:boot              — a language server with the bootstrap's diagnostics, for your editor
```

There is no `scrml.config.js`, no `defineConfig`, no `tailwind.config.js`. (The older `scrml` command — `scrml init`, `scrml dev`, `scrml db-migrate` — belongs to impl#1 and the older dialect; schema migration has not moved to the bootstrap yet.)

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

1. **Logic** — declarations (`let <count:int=0/>`), types (`type Phase:enum = {...}`), functions, engines, imports. These appear as direct children of `<program>`; no `${ ... }` wrapper needed. (`${ ... }` is how you re-enter logic from inside markup — e.g., `${ for (p of @items) { lift <li>...</li>; } }` inside a `<ul>`.) Statements end with `;`; a newline is just whitespace.
2. **Markup** — HTML elements (`<div>`, `<p>`, `<form>`, ...) plus a small set of scrml-specific extensions (`bind:value`, `class:active`, `onclick=`, `if=`, `<each>`, `<match>`, `for`/`lift`). Inside markup, `${expression}` is the interpolation slot that substitutes the expression's value.
3. **`#{ ... }` style blocks** — CSS written in the same file, placed immediately before the markup section it styles (§2.3).

Tag closing has three forms: explicit `</tagname>`, shorthand `</>` (closes the most recently opened tag), and a trailing `/` on void elements and void declarations (`<br/>`, `let <count:int=0/>`). The shorthand `</>` is the canonical scrml closer; use it freely.

The bootstrap compiles this program today.

---

## 2. The counter — reactive state, declarations and `@`

The classic first program in any reactive language: a counter with a `+` button. Here it is in scrml:

<!-- snippet: docs/tutorial-snippets/02-counter.scrml -->
```scrml
// 02-counter.scrml — reactive state: a writable `let` declaration, touched as `@count`.

<program>

  let <count:int=0/>

  function inc() { @count = @count + 1; }
  function dec() { @count = @count - 1; }

  <div>
    <h1>Counter: ${@count}</h1>
    <button onclick=dec()>−</button>
    <button onclick=inc()>+</button>
  </div>

</program>
```

Three things are happening here, and they are the load-bearing rules of the language:

1. **`let <count:int=0/>` declares a reactive state cell.** A declaration is a tag: the name, `:Type`, and `=` the initial value, closed with `/>`. `let`, written before the `<`, makes it **writable**. Without `let` a declaration is **locked**: `<step:int=1/>` is a constant, and writing it is `E-WRITE-NOT-GRANTED`, whose message tells you to add `let`.

2. **`@count` reads or writes the cell.** The `@` sigil marks every state touch in an expression — read in `${@count}`, read on the right of `=`, write on the left. Bare `count` (no `<>` or `@`) is a LOCAL identifier, never reactive state.

3. **`onclick=inc()` is a bare call expression.** The handler is a function call, not a string: `inc` is called with no arguments each time the event fires, and arguments work as you would expect (`onclick=remove(item.id)`). Without parentheses, `onclick=inc` makes `inc` itself the listener, called with the event object. A handler that does more than one thing can be written inline in braces — `onclick={ @count = 0; @step = 1; }` (§3.4).

The asymmetry between `<count>` for declaration and `@count` for expression access is deliberate. It makes every state touch visually distinguishable from local-variable touch — you can scan a function body and count "how many state cells does this function read or mutate" at a glance. This is load-bearing for both human readability and the compiler's static analysis.

**Statements end with `;`.** `@count = @count + 1;` — the `;` ends the statement, and newlines are only whitespace, so a long statement may span lines freely. A function body is a block of `;`-terminated statements; a function that produces a value says so with `-> T` and an explicit `return` on every path (there is no implicit "last expression" return).

Compile and run:

```
bun run boot:dev docs/tutorial-snippets/02-counter.scrml
```

The bootstrap compiles this program today.

### 2.1 Derived state — a locked declaration that reads other cells

When a value is a pure function of other reactive state, declare it **without** `let`, with an initializer that reads cells:

<!-- snippet: docs/tutorial-snippets/02a-derived.scrml -->
```scrml
// 02a-derived.scrml — derived state recomputes whenever its inputs change.

<program>

  let <count:int=0/>
  <doubled:int=(@count * 2)/>
  <parity:string=(@count % 2 == 0 ? "even" : "odd")/>

  function inc() { @count = @count + 1; }

  <div>
    <p>Count: ${@count}</p>
    <p>Doubled: ${@doubled}</p>
    <p>Parity: ${@parity}</p>
    <button onclick=inc()>+</button>
  </div>

</program>
```

`<doubled:int=(@count * 2)/>` reads as "whenever any reactive input on the right changes, recompute the expression." A locked declaration whose initializer reads a cell is **derived**. The dependency graph is tracked automatically — you never list dependencies explicitly. Reading the derived cell uses `@doubled`, same as a plain reactive. A non-trivial initializer goes in parentheses: `=(@count * 2)`.

Derived cells are **read-only**: `@doubled = 99` is `E-DERIVED-WRITE`. The value can change (when `@count` changes), but you cannot assign to it from your code. Its message names the trade-off: if you want a value that *starts* from that expression and is then edited independently, declare it `let` — a `let` declaration with a reactive initializer is **seeded** once and stops tracking.

The bootstrap compiles this program today.

### 2.2 Persisting the counter — `<schema>`, `db=`, `?{}`

A counter in memory is gone the moment you refresh the page. Let's persist it. scrml has a built-in database layer — no `npm install better-sqlite3`, no Prisma, no schema files in a separate directory. You name the database file with `db=` on `<program>`, declare its shape in a `<schema>` block (a direct child of `<program>`), and write parameterized SQL with `?{}`:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-ATTR, E-PARSE-ITEM, E-PARSE-SHORTHAND, E-PARSE-TAG, E-PARSE-TYPE, E-TYPE-UNKNOWN] — the bootstrap has no <schema>, no pending cells ((not to T) in an opener, §13.9) and no typed ?{} rows yet -->
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

  // A pending cell: `(not to int)` says it starts absent and becomes an int
  // when loadCount() answers (§13.9). Only a cell declared this way may wait.
  let <count:(not to int)=(loadCount() !{ _ :> not })/>
  let <saveError:string=""/>

  // No `server` keyword — these two functions run on the server because
  // their bodies touch a `?{}` SQL block. The `!` makes them failable (§6):
  // a failed query propagates to the caller instead of being ignored.
  function loadCount()! -> SqlError {
    let row = ?{`SELECT value FROM counters WHERE id = 1`}.get();
    return row is given ? row.value : 0;
  }

  function persistCount(n: int)! -> SqlError {
    ?{`INSERT INTO counters (id, value) VALUES (1, ${n})
       ON CONFLICT(id) DO UPDATE SET value = ${n}`}.run();
    return n;
  }

  function save(n: int) {
    persistCount(n) !{ _ :> { @saveError = "Could not save — try again."; } };
  }

  function inc() {
    if (@count is given) {
      @count = @count + 1;
      save(@count);
    }
  }

  function dec() {
    if (@count is given) {
      @count = @count - 1;
      save(@count);
    }
  }

  <div if=@count>
    <h1>Persistent counter: ${@count}</h1>
    <button onclick=dec()>−</button>
    <button onclick=inc()>+</button>
    <p if=(@saveError != "")>${@saveError}</p>
  </div>
  <p else>Loading…</p>

</program>
```

Compare to §2's in-memory counter. The markup is nearly identical. The additions:

1. **`<program db="counter.db">`** names the database this program uses. A `<schema>` block requires it (`E-SCHEMA-001` without it).
2. **`<schema>`** declares the database shape. `counters { id: integer primary key, value: integer not null default(0) }` reads as a small DDL. You do not write `CREATE TABLE` or `ALTER TABLE` by hand: the compiler compares the declared schema with the actual database and applies the difference (today through impl#1's `scrml db-migrate`; the bootstrap has no migration command yet).
3. **A pending cell.** `let <count:(not to int)=(loadCount() !{ _ :> not })/>` starts **absent** (`not`) and becomes an `int` when the server answers. Only a cell whose declared type is `(not to T)` may take a value that has to wait for the server (§13.9); any other cell with a server call as its initializer is `E-VALUE-SERVER-CALL`. Reading it before it arrives is checked: `if (@count is given) { … }` in the functions and `<div if=@count>` in the markup only touch it once it is there, and `<p else>` shows "Loading…" until then.
4. **Server-side functions are inferred from their bodies.** `loadCount` and `persistCount` touch `?{}` SQL blocks, which are server-only. The compiler moves them to the server automatically — no `server` keyword needed.
5. **Failures are values.** A query can fail (the connection drops, a constraint is violated), and so can any call from the browser to the server. The `!` after a parameter list makes a function **failable**, and a caller handles the failure with a `!{ … }` handler — `persistCount(n) !{ _ :> { … } }` (§6 covers this properly). The `<db src="…" tables="…">` element — a connection scope that also generates a typed row per table — is the longer form when a program needs those types; `db=` on `<program>` is enough here.

The `?{`SELECT ...`}` form holds parameterized SQL. The backtick string is the query; `${var}` interpolations become bound parameters automatically — even if `var` contains quotes or semicolons, it is treated as data, not SQL. The methods are `.run()` (INSERT/UPDATE/DELETE), `.get()` (single row, or `not` if no rows match — "no row" is not a failure), and `.all()` (every row).

> **Note on `is given`.** scrml has no `null` or `undefined` keyword in source. The presence check is `value is given` (true when the value is present) and the absence check is `value is not` (true when the value is absent — i.e. the value is `not`). Where `x is given` is true, `x` is narrowed from `T | not` to `T`. You write `==` and `!=` for equality; `===` does not exist (§7).

The one rule that distinguishes server functions from client functions is that **server-escalated functions must not assign to reactive state** (`E-RI-002`). State transitions belong on the client; the server's job is to fetch and persist. A client function calls a server-escalated function for data, then updates state with the result — as `inc()` and `save()` do here.

### 2.3 Styling — `#{}` style blocks and Tailwind utilities

scrml has two styling tools, used together or apart depending on taste.

<!-- snippet: docs/tutorial-snippets/02c-styles.scrml -->
```scrml
// 02c-styles.scrml — a #{} style block, placed just before the markup it styles.

<program>

  let <count:int=0/>
  function inc() { @count = @count + 1; }

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

The bootstrap compiles this program today.

A `#{ ... }` block holds plain CSS. Where it sits decides its reach:

- **At program level** (as above), the CSS is **global** — it applies to the whole page, like an ordinary stylesheet. That is why the example scopes its button rule with `.card button` rather than a bare `button`.
- **Inside a component's markup**, the CSS is **scoped to that component**: the compiler wraps it in a CSS `@scope` rule for the component's root, so a bare `h2 { ... }` there styles only that component's `h2`s.

Place each block immediately before the markup it styles; several small blocks next to their markup read better than one large block at the top of the file.

scrml also supports Tailwind utility classes. The compiler scans class attributes at build time and emits only the utilities the program actually uses. (Tailwind lives in impl#1 today; on the bootstrap, the native `#{}` styling comes first.) Fragment — the counter's markup restyled with utilities:

<!-- gate: skip — fragment: the counter's markup; @count and inc() come from §2 -->
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

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-EXPR] — the bootstrap has no class: binding and no value-form for/lift in markup yet -->
<!-- snippet: docs/tutorial-snippets/03-todos.scrml -->
```scrml
// 03-todos.scrml — in-memory todos: a tape, a component declaration, for/lift, bind:value.

<program>

  type Todo:struct = { id: int, body: string, done: bool }

  <items:Todo[free, append, remove, write]=[]/>
  let <draft:string=""/>
  let <nextId:int=1/>

  function add() {
    if (@draft == "") { return; }
    @items.append({ id: @nextId, body: @draft, done: false });
    @nextId = @nextId + 1;
    @draft = "";
  }

  function flipped(t: Todo) -> Todo {
    let out: Todo = { id: t.id, body: t.body, done: !t.done };
    return out;
  }

  function toggle(id: int) {
    @items = @items.map(t => t.id == id ? flipped(t) : t);
  }

  function remove(id: int) {
    @items = @items.filter(t => t.id != id);
  }

  <todoRow item:Todo/>
  renders <li class="row">
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
        for (t of @items) {
          lift <todoRow item=t/>;
        }
      }
    </ul>
  </div>

</program>
```

Several pieces of scrml's shape show up at once here. Let's name them.

### 3.1 `type Name:struct = { ... }` and tapes — records and sequences

A struct type names a record shape with typed fields. Instances are plain object literals; there are no constructors. The list of todos is a **tape**, scrml's one sequence kind — there are no JavaScript-style arrays. Excerpt from the todo app:

<!-- snippet: docs/tutorial-snippets/03-todos.scrml#L5-L7 -->
```scrml
type Todo:struct = { id: int, body: string, done: bool }

<items:Todo[free, append, remove, write]=[]/>
```

A tape's type says what may change about it, in brackets after the element type (SPEC §66.12.2): `Todo[free, append, remove, write]` reads "free length; may grow at the end; may shrink anywhere; positions may be rewritten". Nothing else is allowed — a tape with no grants is immutable. The methods are named after the grants: `.append(x)` / `.pop()` at the end, `.prepend(x)` / `.shift()` at the front, `.insert(i, x)` / `.remove(i)` anywhere. JavaScript's `push`, `unshift` and `splice` are refused (`E-TAPE-JS-METHOD`, whose fix-it names the scrml method). Whole-value writes are checked the same way: `@items = @items.filter(…)` is a shrink (granted by `remove`) and `@items = @items.map(…)` rewrites positions (granted by `write`); a write the type does not grant is `E-WRITE-NOT-GRANTED`.

Function parameters are always typed — `function toggle(id: int)` — and a lambda's parameter (`t => …`) takes its type from the tape it is called on. `flipped(t)` builds the new record in a typed local (`let out: Todo = { … };`) so the object literal has a struct type to check against.

### 3.2 `for`/`lift` iteration

Inside an interpolation slot, a `for` loop iterates. To emit markup from the loop body you use the `lift` keyword — it says "lift this node into the surrounding markup". Excerpt from the todo app:

<!-- snippet: docs/tutorial-snippets/03-todos.scrml#L52-L56 -->
```scrml
${
  for (t of @items) {
    lift <todoRow item=t/>;
  }
}
```

The `${ ... }` inside `<ul>` is a logic block because its body is a statement. Each iteration's `lift` produces a new child of the surrounding `<ul>`. Without `lift`, the markup inside the loop would be an unused expression — `lift` is what marks an expression as something to attach to the DOM.

`for` is scrml's **one** loop: `for (x of xs)` over a tape (or a range, `for (i of 0..n)`), `for (cond)` where JavaScript writes `while`, the C-style `for (init; cond; step)`, and `for { … }` forever until `break`. `while` and `do … while` do not exist.

`for`/`lift` reacts to changes in the iterated reactive: append to `@items` and the loop re-evaluates.

**`<each>` — the canonical iteration element.** `for`/`lift` is the Tier-0 primitive; the structural `<each>` element is the canonical Tier-1 shape (§17.7), and the one the compiler nudges you toward (`W-EACH-PROMOTABLE`). Fragment — the same list written with `<each>`:

<!-- gate: skip — fragment: @items and todoRow come from the todo app above -->
```scrml
<ul>
  <each in=@items as t key=t.id>
    <todoRow item=t/>
  </each>
</ul>
```

`<each in=@coll as t>` binds each element of the reactive collection to the local `t` and renders its body once per item — no `${ ... }` wrapper and no `lift`. The binder is the **space form `as t`**, never `as=t` (`<each in=@items as=t>` is `E-SCOPE-001` — the binding never registers). Add `key=t.id` (or any stable per-item field) so the runtime can match items across updates; without a key the list falls back to positional keying. Keep `for`/`lift` for the imperative case where the loop body is multi-statement; reach for `<each>` for the common "one node per item" case.

> **An important detail about reactivity.** Every write the tape's type grants updates the page: `@items.append(x)`, `@items = @items.filter(…)`, `@items = @items.map(…)`. The grant list is the whole contract — the compiler checks every write against it however it is spelled, so you can read `Todo[free, append, remove, write]` and know every way the list can change. Derived cells are the exception: they are recomputed, never written.

### 3.3 Components — declarations that render

A component in scrml is a **declaration with typed attributes and a `renders` clause**: the opener names it and declares its attributes, and `renders` (after the closer) gives its markup. It is used by name in markup like a custom element. Excerpt from the todo app:

<!-- snippet: docs/tutorial-snippets/03-todos.scrml#L31-L36 -->
```scrml
<todoRow item:Todo/>
renders <li class="row">
  <input type="checkbox" checked=item.done onchange=toggle(item.id)/>
  <span class:done=item.done>${item.body}</span>
  <button onclick=remove(item.id)>x</button>
</li>
```

`<todoRow item:Todo/>` declares a component with one attribute, `item`, of type `Todo`. Inside the `renders` markup an attribute is read by its bare name — `item.done`, `item.id` — not with `@`: `@` is only for reactive state cells. `<todoRow item=t/>` makes one instance. The convention is that declaration names are lowercase (`todoRow`), the same family as the HTML elements, which are predefined declarations.

The closer of a component's markup is `</>` (or the explicit tag name), same as any element. `class:done` and `onchange=fn()` work on component markup exactly as they do on plain HTML.

### 3.4 Attribute extensions — `bind:`, `class:`, `on<event>`

The handful of scrml-specific attributes shown in the todo app:

- **`bind:value=@draft`** — two-way binding on a form control. Typing in the input updates `@draft`; writing to `@draft` from elsewhere updates the input. Works on `<input>`, `<select>`, `<textarea>`, and checkbox/radio inputs (`bind:checked`). On a number cell, text that does not parse as a number is not written; the cell keeps its last good value.
- **`class:done=item.done`** — adds or removes the CSS class `done` based on the value of the expression. Multiple `class:` bindings stack independently; a `class="row"` on the same element remains intact.
- **`onclick=remove(item.id)`**, **`onsubmit=add()`**, **`onchange=toggle(item.id)`** — event handlers as bare call expressions. The handler is a function call, not a string. Inside a loop, you pass the current item to the handler with normal scrml-expression arguments.
- **`onclick={ @count = 0; @phase = .Idle; track("reset"); }`** — an **inline block** handler (SPEC §5.2.3). When a handler does more than one thing, wrap the `;`-terminated statements in braces right where the handler is attached; they run in order on each event, and the block may span as many lines as you like. A named function (`onclick=startOver()`) is an equally valid choice — reach for it when the logic is reused or deserves a name. What is rejected is the **unbraced** sequence (`onclick=startGame(); track("start")`, `E-MULTI-STATEMENT-HANDLER`): with no braces, nothing says where the handler ends and the next attribute begins.

There is no `<script>` tag, no JSX braces, no Svelte directives. The shape is "HTML, plus a few attribute-looking names with scrml-specific compile-time meaning."

### 3.5 Conditional rendering — `if=`, `else-if=`, `else`

Show or hide an element by putting `if=expr` on it. Chains use sibling elements with `else-if=expr` and a bare `else`. Fragment:

<!-- gate: skip — fragment: @items and todoRow come from the todo app above -->
```scrml
<p if=(@items.length == 0)>No todos yet — add one above.</p>
<ul else>
  <each in=@items as t key=t.id>
    <todoRow item=t/>
  </each>
</ul>
```

A bare `else` is the one attribute in scrml that takes no `=` and no value — `<ul else>` is the literal syntax. Spelling it as `else=true` is a parse error. The chain runs over sibling elements at the same parent level; exactly one branch is shown at a time. A condition must be a `bool` (or a bare `T | not`, which tests presence) — scrml has no truthiness, so write `@items.length == 0`, not `!@items.length`.

For exhaustive branching over the variants of an enum, prefer `<match for=Type>` (§4.2) — adding a new variant later forces every match site to update, which a chain of `if=`s does not.

---

## 4. Engines — the Tier-0 → Tier-1 → Tier-2 ladder

When the UI has more than one mode — loading vs loaded, idle vs active, draft vs submitted vs paid — you have a state machine, whether you spell it that way or not. scrml's centerpiece is the **engine**: a first-class state machine that owns part of (or all of) the UI tree.

The language gives you a three-rung ladder for promoting "this UI has modes" into "this UI is a fully-handled state machine." You start at Tier 0 — boolean flags and `if=` chains — and promote toward Tier 2 — a full engine — as the design firms up. Promotion is **additive and mechanical**: the rendering carries forward verbatim, only the declarations around it change.

### 4.1 Tier 0 — `if=` chains over booleans

For a prototype, two or three booleans gating sibling elements is usually fine. Fragment:

<!-- gate: skip — fragment: @loading and @error are illustrative cells -->
```scrml
<div if=@loading>Loading…</div>
<div else-if=(@error != "")>Error: ${@error}</div>
<div else>Welcome.</div>
```

This is correct scrml. It is also a candidate for promotion: as soon as you reach for a third or fourth boolean to model the same "phase of this screen," you have a state machine in everything but name. The `W-LIFECYCLE-CANDIDATE` lint exists to suggest the upgrade.

### 4.2 Tier 1 — an enum and `match`

The first commitment step is to name the screen's phases as an enum and dispatch on it with `match`:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG] — the bootstrap has no <match> block element and cannot construct a payload variant (LoadPhase.Loaded(42)) yet -->
<!-- snippet: docs/tutorial-snippets/04a-tier1-match.scrml -->
```scrml
// 04a-tier1-match.scrml — Tier 1: an enum, and <match> to dispatch on it.

<program>

  type LoadPhase:enum = {
    Idle,
    Loading,
    Loaded(rows: int),
    Failed(msg: string),
  }

  let <phase:LoadPhase=.Idle/>

  function load() {
    @phase = .Loading;
    @phase = LoadPhase.Loaded(42);        // fake result for the demo
  }

  // The value-return form of match: compute a value from the variant.
  <status:string=(match @phase {
    .Idle        :> "idle",
    .Loading     :> "loading",
    .Loaded(n)   :> "loaded",
    .Failed(msg) :> "failed",
  })/>

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
      <button onclick={ @phase = .Idle; }>Reset</button>
    </Loaded>
    <Failed(msg)>
      <p class="err">Failed: ${msg}</p>
      <button onclick={ @phase = .Idle; }>Try again</button>
    </Failed>
  </match>

</program>
```

Three things are new:

1. **An enum type.** `type LoadPhase:enum = { Idle, Loading, Loaded(rows: int), Failed(msg: string) }` declares a tagged sum type. `Idle` and `Loading` carry no payload; `Loaded(rows: int)` and `Failed(msg: string)` each carry one. The whole shape is "one of these four, exactly." Variants are separated by commas, and a trailing comma is allowed.

2. **The reactive holds an enum value.** `let <phase:LoadPhase=.Idle/>` declares `phase` as a writable `LoadPhase` cell starting in `.Idle`. The leading `.` is bare-variant inference — the compiler infers `.Idle` as `LoadPhase.Idle` because the cell's type is statically known. A payload variant is constructed with its type name: `LoadPhase.Loaded(42)`.

3. **Two `match` shapes.** In **markup position** — choosing which UI to show — use the block form `<match for=LoadPhase on=@phase>`: each child element names a variant and holds that variant's markup directly. A payload variant binds its payload in the child's opener: `<Loaded(n)>` makes the `rows` value available as `n` inside. In **value position** — computing a value, in a derived cell or a function body — use the expression form `match @phase { .Variant :> value, … }`, as `<status>` does above. Its arms are a comma-separated list (a trailing comma is allowed). Both run the same exhaustiveness check and payload destructuring.

`match` is exhaustive. Adding a fifth variant to `LoadPhase` later — say `Cached(rows: int)` — turns every match site into a compile error until you add the new arm. That is the main benefit of enums + `match` over a chain of `if=`s: the compiler will tell you exactly where to update.

> **Block arms yield with `lift`.** An arm can hold a block of statements. In value position the block must say which value it produces, with `lift`: `.Loaded(n) :> { log("loaded"); lift "loaded"; }`. A block holding ONE expression is that expression (`.Idle :> { "idle" }`), but once it holds a statement, a bare last expression is an error (`E-ARM-TAIL-VALUE`) — values leave a block only through `lift`, and leave a function only through `return`. You will also see the expression form inside markup, `${ match @phase { .Idle :> { lift <button>…</button>; }, … } }`; it is the right tool when an arm must run statements before it produces markup. For plain "this variant shows this markup", the block form above is the canonical shape.

### 4.3 Tier 2 — an engine: a `single` declaration with `rule=` transitions

The full engine surface adds two concepts to the Tier-1 shape: a `rule=` attribute on each state-child declaring legal transitions out, and `<onTransition>` blocks for cross-state effects. An engine is a **`single` declaration** of the enum type — one shared instance, whose state-children carry the transition graph — declared at program level like any other declaration. State-children may hold markup directly (it renders wherever the engine is rendered, `<*loadPhase/>`); for the introductory shape below they have no bodies and the variants are rendered by a `<match>` block, since that carries forward verbatim from Tier 1.

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG] — the bootstrap has no <match> block element and cannot construct a payload variant (LoadPhase.Loaded(42)) yet -->
<!-- snippet: docs/tutorial-snippets/04b-tier2-engine.scrml -->
```scrml
// 04b-tier2-engine.scrml — Tier 2: an engine — a `single` declaration with rule= contracts.
//
// The engine is a program-level declaration, alongside the type and the
// function. Each state-child's rule= lists the legal transitions out of it.
// The state-children have no bodies here; the <match> below renders each phase.

<program>

  type LoadPhase:enum = {
    Idle,
    Loading,
    Loaded(rows: int),
    Failed(msg: string),
  }

  function load() {
    @loadPhase = .Loading;
    @loadPhase = LoadPhase.Loaded(42);        // fake result for the demo
  }

  <loadPhase:LoadPhase=.Idle single>
    <Idle    rule=.Loading/>
    <Loading rule=(.Loaded | .Failed)/>
    <Loaded  rule=.Idle/>
    <Failed  rule=.Idle/>
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
      <button onclick={ @loadPhase = .Idle; }>Reset</button>
    </Loaded>
    <Failed(msg)>
      <p class="err">Failed: ${msg}</p>
      <button onclick={ @loadPhase = .Idle; }>Try again</button>
    </Failed>
  </match>

</program>
```

Read it as: "the engine owns a `LoadPhase` value, starts in `.Idle`, declares the legal transitions out of each variant, and the program renders the right markup for the current phase."

Things to notice:

- **`<loadPhase:LoadPhase=.Idle single>`** declares the engine. Its name **is** its variable: `@loadPhase`. The initial value `=.Idle` is the starting state, and `single` says there is exactly one instance.
- **`rule=` declares legal transitions OUT** of this state-child. `rule=.Loading` means "from `.Idle` you may transition to `.Loading`." Multi-target uses parens with `|`: `rule=(.Loaded | .Failed)`.
- **State-children have no bodies (`<Idle rule=.Loading/>`)** in the snippet above. They may hold markup instead — the variant's markup, rendered wherever the engine is rendered with `<*loadPhase/>`. The body-less shape with a sibling `<match>` is the introductory idiom because it keeps "where the markup lives" obvious.
- **Transitions are direct writes.** `@loadPhase = .Loading;` triggers the engine's validation: if the destination is not in the current state-child's `rule=` set, you get `E-ENGINE-INVALID-TRANSITION` (compile-time when the from-state is statically known, runtime otherwise). The `Reset` button's inline block handler `onclick={ @loadPhase = .Idle; }` is such a write.
- **`<onTransition>`** declares a cross-state effect — code that runs on a transition. It is *directional* and carries exactly one trigger attribute: `<onTransition to=.B>` placed inside the **from**-state-child fires when leaving that state toward `.B`; `<onTransition from=.A>` placed inside the **target** state-child fires on arrival from `.A` (the inverse direction). An `<onTransition>` with neither `to=` nor `from=` has no trigger and is `E-ONTRANSITION-NO-TARGET`. Use it for analytics, animations, cleanup, anything that should happen on the transition itself.

The migration story from Tier 1 to Tier 2 is mechanical: the `<match>` block carries forward verbatim; the cell `let <phase:LoadPhase=.Idle/>` becomes the engine `<loadPhase:LoadPhase=.Idle single>` with its `rule=` contracts.

> **Rendering an engine.** `<*loadPhase/>` renders the engine's current state-child body wherever you write it; `<loadPhase/>` (without the `*`) would make a new instance, which a `single` declaration does not allow (`E-DECL-SINGLE-INSTANTIATED`). An engine exported from another file is rendered the same way.

### 4.4 Why the ladder

Three rungs, three points of commitment:

- **Tier 0** is fine for prototypes. Two booleans is not yet a state machine.
- **Tier 1** is the first commitment: name the phases, dispatch on the variant. Exhaustiveness checking starts here. You can stop at Tier 1 if the transition story is uninteresting ("any phase can move to any other phase; the compiler just dispatches on value").
- **Tier 2** is the second commitment: declare legal transitions. The compiler now rejects invalid moves at compile time when it can see the from-state, runtime otherwise. The engine is the single source of truth for "what are the next legal actions?", which is often what the UI wants to ask ("which buttons should be enabled?").

Promote when the cost of promotion is less than the cost of bugs the next tier prevents. For a screen with two modes that never go wrong, Tier 0 is fine forever. For an order lifecycle (Draft → Submitted → Paid → Shipped → Delivered), Tier 2 prevents a whole class of "the cancelled order somehow shipped" bugs.

### 4.5 Derived engines

A **derived engine** computes its state from another reactive value instead of being written directly. It is the §2.1 rule again: a locked declaration with an initializer that reads cells. Here a `HealthRisk` value is projected from a `MarioState` engine:

<!-- snippet: docs/tutorial-snippets/04c-derived-engine.scrml -->
```scrml
// 04c-derived-engine.scrml — a derived engine projects one enum onto another.

<program>

  type MarioState:enum = { Small, Big, Fire, Cape }
  type HealthRisk:enum = { AtRisk, Safe }

  <marioState:MarioState=.Small single>
    <Small rule=(.Big | .Fire | .Cape)/>
    <Big   rule=(.Small | .Fire | .Cape)/>
    <Fire  rule=(.Small | .Big | .Cape)/>
    <Cape  rule=(.Small | .Big | .Fire)/>
  </>

  // @healthRisk is recomputed from @marioState; it cannot be written directly.
  <healthRisk:HealthRisk=(match @marioState {
    .Small :> .AtRisk,
    .Big   :> .Safe,
    .Fire  :> .Safe,
    .Cape  :> .Safe,
  })/>

  <div>
    <p>Mario: ${@marioState} — risk: ${@healthRisk}</p>
    <button onclick={ @marioState = .Big; }>Mushroom</button>
    <button onclick={ @marioState = .Small; }>Hit</button>
  </div>

</program>
```

The initializer can be any expression of the declaration's type — a `match`, as here, a ternary, or a function call — and the value recomputes whenever a reactive value the expression reads changes. Writing it is `E-DERIVED-WRITE`, because the source drives everything. Use it when one piece of state has a natural read-only view of another. (The SPEC also lets one arm cover several patterns, `.Big | .Fire | .Cape :> .Safe`; the bootstrap does not accept that yet, so the program spells one arm per variant.) For a larger engine program, see `examples/14-mario-state-machine.scrml` (written in the older dialect).

The bootstrap compiles this program today.

---

## 5. Forms — validated fields, and the auto-synthesized validity surface

Validation in scrml is **declarative**, not imperative. You don't write a `validate()` function; you declare validators directly on the field declarations, and the compiler synthesizes a reactive validity surface and error-rendering path automatically.

Here is a signup form that exercises the full surface:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-SCOPE-001] — the bootstrap has no <match> block element, cannot follow scrml:auth's `export { … } from` re-export of hashPassword, and its validity surface does not evaluate eq(…) or this pattern(…) yet -->
<!-- snippet: docs/tutorial-snippets/05-signup-form.scrml -->
```scrml
// 05-signup-form.scrml — declarative form with auto-synth validity surface.
//
// A declaration with validated fields (<signup:struct>...) auto-synthesizes a
// reactive validity surface: @signup.isValid, @signup.errors, @signup.touched,
// plus per-field surfaces (@signup.name.isValid, @signup.name.errors, ...).
// All synth properties are read-only — the compiler computes them.
//
// The engine is a program-level `single` declaration; a <match> renders the
// markup for each phase.
//
// `db=` is required because persistSignup() runs a `?{}` write (E-SQL-004,
// §44.7): a `?{}` with no db= in any ancestor <program> has no connection.

<program db="users.db">

  import { hashPassword } from "scrml:auth";

  type SignupPhase:enum = { Editing, Submitting, Done }

  <signupPhase:SignupPhase=.Editing single>
    <Editing    rule=.Submitting/>
    <Submitting rule=(.Done | .Editing)/>
    <Done       rule=.Editing/>
  </>

  <signup:struct>
    let <name:string="" req length(>=2)/>
    renders <input type="text" bind:value=@name/>
    let <email:string="" req pattern(/^[^@]+@[^@]+$/)/>
    renders <input type="email" bind:value=@email/>
    let <password:string="" req length(>=8)/>
    renders <input type="password" bind:value=@password/>
    let <confirm:string="" req eq(@signup.password)/>
    renders <input type="password" bind:value=@confirm/>
    let <agree:bool=false eq(true)/>
    renders <input type="checkbox" bind:checked=@agree/>
  </>
  renders <form onsubmit=submit()>
    <h1>Sign up</h1>
    <label>Name      <*name/>     <errors of=@signup.name/></label>
    <label>Email     <*email/>    <errors of=@signup.email/></label>
    <label>Password  <*password/> <errors of=@signup.password/></label>
    <label>Confirm   <*confirm/>  <errors of=@signup.confirm/></label>
    <label class="row">
      <*agree/> I agree to the terms
      <errors of=@signup.agree/>
    </label>
    <button type="submit">Create account</button>
  </form>

  function submit() {
    if (!@signup.isValid) { return; }
    @signupPhase = .Submitting;
    persistSignup(@signup.name, @signup.email, @signup.password) !{
      _ :> { @signupPhase = .Editing; return; },
    };
    @signupPhase = .Done;
  }

  // Runs on the server: the body touches a `?{}` SQL block. Only a hash of the
  // password is stored — hashPassword (scrml:auth) is server-only.
  function persistSignup(name: string, email: string, password: string)! -> SqlError {
    let hash = hashPassword(password);
    ?{`INSERT INTO users (name, email, password_hash) VALUES (${name}, ${email}, ${hash})`}.run();
    return email;
  }

  <match for=SignupPhase on=@signupPhase>
    <Editing>
      <*signup/>
    </Editing>
    <Submitting>
      <p>Creating your account…</p>
    </Submitting>
    <Done>
      <p>Welcome, ${@signup.name}!</p>
      <button onclick={ @signupPhase = .Editing; }>Sign up another</button>
    </Done>
  </match>

</program>
```

This program puts much of the language in one place. Let's walk it.

### 5.1 Compound state — `<signup:struct> ... </>`

`<signup:struct> ... </>` declares a **compound** with field declarations inside. Each field is a normal declaration — `let`, because the user edits it; the compound groups them under one name. Field access uses `@signup.name`, exactly the same shape as `@user.name` for a plain struct field. (`:struct` marks a declaration whose value is its fields.)

### 5.2 A field and its input — `renders` and `<*name/>`

The pair

```
let <name:string="" req length(>=2)/>
renders <input type="text" bind:value=@name/>
```

does three things at once:

1. **Declares** `name` as a writable field holding a `string`.
2. **Attaches validators** (`req` and `length(>=2)`) inside the declaration's opener, where they check its own value.
3. **Couples a render-spec** — the `renders` clause after it is the field's markup: here an `<input>` bound to the field. Inside the compound's own markup, `<*name/>` renders **this** signup's `name` field. (A bare `<name/>` there is `E-DECL-FIELD-TAG-NEEDS-STAR`: the `*` says "the existing one", not a new instance.)

The compound has a `renders` too — the `<form>` — and the program shows the whole form with `<*signup/>`. This is the canonical scrml shape for "the form field is a value and its rendering at the same time."

### 5.3 The validator vocabulary

The 14 universal-core validators are: `req`, `is given`, `length(rel)`, `pattern(regex)`, `min(n)`, `max(n)`, `gt(expr)`, `lt(expr)`, `gte(expr)`, `lte(expr)`, `eq(expr)`, `neq(expr)`, `oneOf([...])`, `notIn([...])`.

`let <agree:bool=false eq(true)/>` is how a checkbox says "must be ticked": `req` on a `bool` only asks that the value is present, and `false` is present (§55.1), so it would never reject an unticked box.

Cross-field validation falls out automatically. `let <confirm:string="" req eq(@signup.password)/>` reads as "confirm must equal password" — the compiler tracks the dependency and re-evaluates the validator whenever either cell changes. There is no special "cross-field" vocabulary.

### 5.4 The auto-synthesized validity surface

When a compound declaration contains any field with validators, the compiler auto-synthesizes a reactive validity surface at TWO levels — the compound rollup and per-field. Both are reactive, both are read-only:

```
@signup.isValid       bool — true iff all fields pass their validators
@signup.errors        compound-level errors
@signup.touched       any field touched yet?
@signup.submitted     was first submit attempted?

@signup.name.isValid  per-field
@signup.name.errors   per-field (enum tags from ValidationError, NOT strings)
@signup.name.touched  first interaction
```

You read these like any reactive property. Writing them is `E-SYNTHESIZED-WRITE` — the compiler computes them; you don't. The compiler also blocks the form's submit while any gated field is invalid, before `onsubmit` runs (`I-FORM-SUBMIT-GATED` tells you which fields gate it).

### 5.5 The error rendering element — `<errors of=expr/>`

`<errors of=@signup.name/>` is a first-class scrml markup element that renders the validation errors for the named cell. Per-field (`<errors of=@signup.name/>`) or rollup (`<errors of=@signup all/>`). By default it renders the first error; the `all` attribute renders the full list.

Error messages resolve through a four-level chain: inline override on the decl (highest priority), project-registered messages (the i18n hook), `scrml:data` shipped English defaults, or a `<match>` escape hatch on the `ValidationError` enum for full control.

### 5.6 The form is driven by an engine

The signup form is one state of a three-state engine (`Editing` → `Submitting` → `Done`). The engine owns the legal transitions; the `<match>` block renders the right markup for the current phase. This is the canonical Tier-2 idiom: the form's lifecycle (you can submit it, then you can't, then you're done) is a state machine, and the engine makes that explicit. When the save fails, `submit()`'s `!{}` handler moves the engine back to `.Editing` — an edge its `rule=(.Done | .Editing)` allows. The `Sign up another` button's inline block handler, `onclick={ @signupPhase = .Editing; }`, is the transition back.

The submit button needs no `disabled=` wiring: the compiler already blocks the form's submit while any validated field is invalid, before `onsubmit` runs (§55.17.3; `I-FORM-SUBMIT-GATED` names the fields), so `submit()`'s own `if (!@signup.isValid) { return; }` is a second line of defence, not the gate. The password is stored only as a hash: `hashPassword` comes from the `scrml:auth` standard module, and the server function calls it before the `INSERT`.

### 5.7 `reset(@cell)` — clearing form state

To clear a field, call `reset(@signup.name)` — `reset` is a language keyword (no import needed). It re-evaluates the field's initializer, restoring its initial value. A `reset` is a whole-value write — a `replace` — so it needs a `let` field (or a type that grants `replace`). The signup's fields are `let`, so each can be reset; the compound `<signup:struct>` itself is not, so `reset(@signup)` is `E-WRITE-NOT-GRANTED`. Fragment — a Clear button:

<!-- gate: skip — fragment: @signup comes from the signup form above -->
```scrml
<button type="button" onclick={ reset(@signup.name); reset(@signup.email); reset(@signup.password); reset(@signup.confirm); reset(@signup.agree); }>Clear</button>
```

> **`reset` is a reserved identifier.** You cannot define `function reset() { ... }` — pick another name like `clearForm` or `restart` for local helpers.

---

## 6. Failable functions — `function f()! -> Err` and `!{}`

Some operations can fail: a network call, a database query, a parsing pass. scrml models errors as **enum variants** rather than thrown exceptions. A function that can fail is declared with `!` after its parameter list and an error type after the arrow. Callers handle each variant with a `!{ ... }` block.

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG] — the bootstrap has no <schema> and no <match> block element, cannot construct a payload variant (Phase.Errored(…)), and does not evaluate this pattern(…) yet -->
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
    EmptyName,
    InvalidEmail(input: string),
    DuplicateEmail(email: string),
    Storage,
  }

  type Phase:enum = { Editing, Saving, Saved, Errored(msg: string) }

  <phase:Phase=.Editing single>
    <Editing rule=.Saving/>
    <Saving  rule=(.Saved | .Errored)/>
    <Saved   rule=.Editing/>
    <Errored rule=.Editing/>
  </>

  <newUser:struct>
    let <name:string="" req length(>=2)/>
    renders <input type="text" bind:value=@name/>
    let <email:string="" req pattern(/^[^@]+@[^@]+$/)/>
    renders <input type="email" bind:value=@email/>
  </>
  renders <form onsubmit=save()>
    <label>Name  <*name/>  <errors of=@newUser.name/></label>
    <label>Email <*email/> <errors of=@newUser.email/></label>
    <button type="submit">Save</button>
  </form>

  // Failable + server-escalated. The `!` after the param list marks the
  // function as failable; `-> SaveError` names the error enum type.
  function persistUser(name: string, email: string)! -> SaveError {
    if (name == "")              { fail SaveError.EmptyName; }
    if (!email.includes("@"))    { fail SaveError.InvalidEmail(email); }
    let existing = ?{`SELECT id FROM users WHERE email = ${email}`}.get() !{
      _ :> { fail SaveError.Storage; },
    };
    if (existing is given)       { fail SaveError.DuplicateEmail(email); }
    ?{`INSERT INTO users (name, email) VALUES (${name}, ${email})`}.run() !{
      _ :> { fail SaveError.Storage; },
    };
    return email;
  }

  function save() {
    @phase = .Saving;
    persistUser(@newUser.name, @newUser.email) !{
      .EmptyName         :> { @phase = Phase.Errored("Name can't be empty."); return; },
      .InvalidEmail(e)   :> { @phase = Phase.Errored("Not an email: " + e); return; },
      .DuplicateEmail(e) :> { @phase = Phase.Errored(e + " is already taken."); return; },
      .Storage           :> { @phase = Phase.Errored("The database is unavailable."); return; },
      .Transport(t)      :> { @phase = Phase.Errored("Could not reach the server."); return; },
    };
    @phase = .Saved;
  }

  <match for=Phase on=@phase>
    <Editing>
      <*newUser/>
    </Editing>
    <Saving>
      <p>Saving…</p>
    </Saving>
    <Saved>
      <p>Saved!</p>
      <button onclick={ @phase = .Editing; }>Add another</button>
    </Saved>
    <Errored(msg)>
      <p class="err">${msg}</p>
      <button onclick={ @phase = .Editing; }>Try again</button>
    </Errored>
  </match>

</program>
```

The shape:

- **`function persistUser(name: string, email: string)! -> SaveError`** — the `!` after the parameter list marks the function as failable. The arrow names the error enum type. The body uses `fail SaveError.Variant;` (or `fail SaveError.Variant(payload);`) to raise a specific error, and `return` for the success value.
- **`!{ .Variant :> { ... }, ... }`** at the call site — pattern-match each error variant. Arms are a comma-separated list (a trailing comma is allowed). The match is **exhaustive**; if a new variant is added to `SaveError`, the compiler tells you which call sites need a new arm. A `_ :>` arm catches whatever is left.
- **`?{}` is failable too.** Inside `persistUser`, each query has its own `!{ _ :> { fail SaveError.Storage; } }`, turning a database failure into the function's own error type. ("No row" is not a failure: `.get()` returns `not`.)
- **A call from the browser to the server can fail on the wire.** `save()` runs in the browser and `persistUser` on the server, so the handler also covers `.Transport(t)` — the network failing, rather than the function. The compiler requires it (`E-ERROR-002` names the missing arm).
- **Errors propagate when not handled.** Inside another `!` function, `persistUser(…)?` passes a failure up instead of handling it; the error types must be compatible.

Notice what is NOT in this code: no `try` / `catch`, no `throw`, no `Promise.reject`. Failures are values; they flow through ordinary control flow. The signature of every failable function tells you exactly which errors can come out — there are no hidden exceptions.

> **No `async`, no `await`, no `Promise` in user source.** The compiler manages the async boundary for you (§19.9.3) — server functions and stdlib `scrml:*` calls are asynchronous under the hood, but you write straight-line `persistUser(…) !{ … };` and the wait is invisible at the syntax level. Where a value has to wait for the server in a position that cannot wait (a declaration's initializer), the cell says so with a `(not to T)` type (§2.2). Per §19.9.8, you do not write `async`, `await`, `Promise`, or `Promise.all` in scrml source.

### 6.1 Errors are states — the engine shape composes

Look at how the `!{}` handler in `save()` routes each failure variant into a phase change: `.EmptyName :> { @phase = Phase.Errored("..."); return; }`. The `<match>` then renders the right markup for each phase. The error path and the success path both flow through `@phase`, and the engine's `rule=` contracts guarantee that the screen always shows exactly one state.

This is the canonical scrml pattern for handling failures: the failable call's `!{}` handler routes each variant into the right phase variant; the markup matches each phase to the right UI. There is no separate `<isError>` cell, no separate error component to remember to render — the failure mode lives in the type.

---

## 7. Negation, presence checks — `!` vs the `not` absence value

A small but load-bearing detail. scrml uses three operators where JavaScript uses one:

| scrml | JavaScript | Reading |
|---|---|---|
| `!x` | `!x` | Boolean negation — `!` is the negation operator. |
| `x is given` | `x !== null && x !== undefined` | Presence check — value exists. |
| `x is not` | `x === null \|\| x === undefined` | Absence check — value missing. |

`!` is the boolean negation operator (`!x`, `!(a == b)`) — same spelling and meaning as JavaScript. The keyword `not` is **not** a negation operator: it is the absence value (§42, Absence Semantics). `not` appears only as the absent value itself (`let <user:string | not=not/>`, `@user = not`) or as the right-hand side of `is` (`x is not`); `not x` in prefix position before a boolean is a compile error (`E-TYPE-045`).

<!-- snippet: docs/tutorial-snippets/08-presence.scrml -->
```scrml
// 08-presence.scrml — `!` negates a boolean; `not` is the absence value.

<program>

  let <user:string | not=not/>            // optional — starts absent
  let <loggedIn:bool=false/>

  <message:string=(@user is given ? "Hello, " + @user : "Sign in to continue")/>

  <div>
    <p>${@message}</p>

    <button if=(!@loggedIn) onclick={ @user = "Ada"; @loggedIn = true; }>Sign in</button>
    <button else onclick={ @user = not; @loggedIn = false; }>Sign out</button>
  </div>

</program>
```

`not` is the absence sentinel — `let <user:string | not=not/>` reads "user is an optional string, initialized to absent." Writing `null` or `undefined` here is `E-SYNTAX-042` (scrml has no `null`/`undefined` keywords). `@user is given` guards the read and narrows `@user` to `string` in the ternary's first arm, so `"Hello, " + @user` is a string joined to a string; `!@loggedIn` negates a boolean; and the sign-in button's inline block handler, `onclick={ @user = "Ada"; @loggedIn = true; }`, runs two writes in order. The same narrowing applies to a struct's fields (`@user is given ? @user.name : …`).

Equality uses `==` and `!=`, and there is no `===` or `!==` (`E-EQ-004`). `==` compares **values, structurally** (§45): two structs are equal when their fields are equal, two enum values when they have the same variant and equal payloads, primitives by value. There is no identity comparison and no type coercion — comparing values of different types, such as `0 == false`, is a compile error (`E-EQ-001`).

**Text and numbers never convert silently.** `+` joins two strings or adds two numbers, never one of each: `"Count: " + @count` is refused. To put a number into text, use a template — `` `Count: ${@count}` `` — or markup interpolation, `<p>Count: ${@count}</p>`, which converts any plain value for you. The other direction can fail, so it is spelled: `int.parse(s)` (also `number.parse`, `bool.parse`, `Phase.parse`) returns `int | not` — strict and whole-string, so `int.parse("12px")` is `not`. Strings count **code points**: `"a😀".length` is 2.

The bootstrap compiles this program today.

---

## 8. Channels — real-time state, one tag

Real-time sync over a WebSocket connection is built into the language as a `<channel>` element. In an entry file (a file that declares `<program>`), the channel lives **inside** `<program>` as a sibling of `<page>` and the rest of the program body. State declared inside the channel body is auto-synced to every connected client:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-SCOPE-001] — the bootstrap has no <channel> yet -->
<!-- snippet: docs/tutorial-snippets/07-channel-chat.scrml -->
```scrml
// 07-channel-chat.scrml — chat room with shared state.

<program>

  type Message:struct = { author: string, body: string, ts: number }

  <channel name="chat" topic="lobby">
    <messages:Message[free, append]=[]/>

    function postMessage(author: string, body: string) {
      @messages.append({ author: author, body: body, ts: Date.now() });
    }
  </>

  let <username:string=""/>
  let <draft:string=""/>

  function send() {
    if (@draft.trim() == "" || @username.trim() == "") { return; }
    postMessage(@username, @draft);
    reset(@draft);
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
2. **`<messages:Message[free, append]=[]/>`** declared inside the channel body is auto-synced. Every connected client sees the same `@messages`; an append from any client propagates to all the others. Its type grants `append` and nothing else, so the chat log can only grow — no client can delete or rewrite a message. There is no `@shared` modifier — synchronization comes from being inside the channel body.
3. **`@messages` is reachable from the rest of `<program>`** via canonical `@messages` access. The channel-declared cells are program-scope visible.

The compiler emits the WebSocket endpoint (`/_scrml_ws/chat` for this channel), the message-broadcast plumbing, and the reconnection logic. You declare what state is shared; the compiler handles the transport.

> **Channels are heavy operationally.** A live channel requires a running WebSocket server, which means you're committed to running a scrml app (not just shipping static HTML). Use channels for genuinely multi-client features — chat, multiplayer cursors, live dashboards. For single-user state, plain reactive cells are simpler and have no infrastructure cost.

---

## 9. Auth — sign-in required, decisions on the server

`auth="required"` on `<program>` puts every request behind a session check at the server: a request without a signed-in session is redirected to `/login`, and the compiler adds the same check to each server function the program exposes. Anything that must stay private to some users is decided **in a server function**, where the compiler provides a `session` object:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-ERROR-013, E-SCOPE-001] — the bootstrap has no auth= and no session yet -->
<!-- snippet: docs/tutorial-snippets/09-auth.scrml -->
```scrml
// 09-auth.scrml — sign-in required; admin-only data decided on the server.

<program auth="required">

  let <report:string=""/>

  // Reading `session` makes this a server function. The role check runs on
  // the server, so a non-admin's response never contains the admin text.
  function loadAdminReport() -> string {
    if (session.role is given && session.role == "Admin") {
      return "3 signups are waiting for review.";
    }
    return "";
  }

  function refresh() {
    // A server call can fail on the wire; the handler says what to show then.
    @report = loadAdminReport() !{ .Transport(t) :> "Could not load the report." };
  }

  <div>
    <h1>Dashboard</h1>
    <button onclick=refresh()>Load admin report</button>
    <p if=(@report != "")>${@report}</p>
  </div>

</program>
```

What this does and does not give you:

1. **The role check runs on the server.** Reading `session` makes `loadAdminReport` a server function — `session` exists only on the server, so the compiler places any function that reads it there. A non-admin's response simply does not contain the admin text; it never reaches their browser. `session.userId`, `session.role`, and `session.isAuth` describe the signed-in user. Because `refresh()` calls it from the browser, the call can fail on the wire, and the `!{ .Transport(t) :> … }` handler says what to show then.
2. **You still need a login page.** Until one exists at `/login`, the compiler warns (`W-AUTH-LOGIN-MISSING`): the redirect would land on a 404.
3. **`<auth role="Admin">` is not a secrecy control.** You may see markup wrapped in `<auth role="...">`. That element does not hide its content: the wrapped markup is sent to every visitor in the page HTML, whatever their role, and the compiler says so with `W-AUTH-CONTENT-NOT-GATED` at each use. Keep secrets in server functions, as above.

---

## 10. The shape, all together

By now you have seen every primitive you need to build a working scrml app. Here they are collected in one real program — a small notes app — in the order they usually appear in a non-trivial scrml file:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG, E-SCOPE-001] — the bootstrap has no <schema>, <channel> or <match> block element, cannot construct a payload variant, and has no typed ?{} rows yet; ⚑ how untyped .all() rows become Note values is also open -->
<!-- snippet: docs/tutorial-snippets/10-all-together.scrml -->
```scrml
// 10-all-together.scrml — the spine of a typical scrml program, in one file.

<program db="notes.db">

  // Types — structs and enums, as direct <program> children
  type Note:struct = { id: int, body: string }
  type Phase:enum = { Idle, Loading, Loaded, Failed(msg: string) }
  type SaveError:enum = { TooShort, Duplicate(body: string), Storage }

  // Schema — the database shape, declared next to the code that uses it
  <schema>
    notes {
      id:   integer primary key
      body: text not null
    }
  </>

  // Engine — a `single` declaration; rule= lists the legal moves out of each state
  <phase:Phase=.Idle single>
    <Idle    rule=(.Loading | .Failed)/>
    <Loading rule=(.Loaded | .Failed)/>
    <Loaded  rule=(.Loading | .Failed)/>
    <Failed  rule=.Loading/>
  </>

  // Channel — state shared live with every connected client
  <channel name="activity">
    <saved:string[free, append]=[]/>
  </>

  <notes:Note[free, replace]=[]/>   // a tape whose type grants `replace`: a reload replaces it
  <count:int=(@notes.length)/>                       // derived

  // A declaration with a validated field, and the markup it renders
  <draft:struct>
    let <note:string="" req length(>=3)/>
    renders <input type="text" bind:value=@note/>
  </>
  renders <form onsubmit=submit()>
    <*note/> <errors of=@draft.note/>
    <button type="submit">Save</button>
  </form>

  // Server functions — they touch ?{}, so they run on the server.
  // They return data; they do not write @state.
  // ⚑ OPEN: `.all()` returns untyped rows, and a `!` function cannot annotate its
  // success type (§19.4.1) — how these rows become `Note` values (nominal structs) is
  // not ruled yet. The shape below is the intent, not a settled rule.
  function loadNotes()! -> SqlError {
    return ?{`SELECT id, body FROM notes ORDER BY id`}.all();
  }

  function saveNote(body: string)! -> SaveError {
    if (body.length < 3) { fail SaveError.TooShort; }
    let existing = ?{`SELECT id FROM notes WHERE body = ${body}`}.get() !{
      _ :> { fail SaveError.Storage; },
    };
    if (existing is given) { fail SaveError.Duplicate(body); }
    ?{`INSERT INTO notes (body) VALUES (${body})`}.run() !{
      _ :> { fail SaveError.Storage; },
    };
    return body;
  }

  // Client functions — call the server and own the @state writes
  function load() {
    @phase = .Loading;
    @notes = loadNotes() !{   // ⚑ OPEN: untyped rows into a Note[…] cell (see loadNotes)
      _ :> { @phase = Phase.Failed("Could not load notes."); return; },
    };
    @phase = .Loaded;
  }

  function submit() {
    saveNote(@draft.note) !{
      .TooShort     :> { @phase = Phase.Failed("Too short."); return; },
      .Duplicate(b) :> { @phase = Phase.Failed(b + " is already saved."); return; },
      .Storage      :> { @phase = Phase.Failed("The database is unavailable."); return; },
      .Transport(t) :> { @phase = Phase.Failed("Could not reach the server."); return; },
    };
    @saved.append(@draft.note);
    reset(@draft.note);
    load();
  }

  // Component — a declaration with a typed attribute and a `renders`
  <noteRow note:Note/>
  renders <li class="row">${note.body}</li>

  // Style block, placed just before the markup it styles
  #{
    .row { padding: 0.5rem; border-bottom: 1px solid #eee; }
  }
  <div>
    <*draft/>
    <p>Saved this session, by anyone:</p>
    <ul>
      <each in=@saved as s>
        <li>${s}</li>
      </each>
    </ul>

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
            <noteRow note=n/>
          </each>
        </ul>
      </Loaded>
      <Failed(msg)>
        <p class="err">${msg}</p>
        <button onclick=load()>Reload</button>
      </Failed>
    </match>
  </div>

</program>
```

That shape is the idiomatic scrml file. Once it feels natural, the language is no longer doing anything new at you — you are combining primitives you already know.

A practical note on the parts: the **engine** owns the top-level lifecycle (the screen's modes), a **compound with validated fields** owns each form, the **failable function** is the call site between client and server, the **tape's grants** say exactly how each list may change, and the **derived state** stays the right value automatically. Most non-trivial scrml programs have this spine. (`body.length < 3` counts code points, so an emoji is one character.)

---

## 11. Where to go next

You now know enough scrml to write working programs. From here:

- **The full specification** — `compiler/SPEC.md` is the formal grammar and semantics. The tutorial covers the common 80%; the SPEC covers the edges. `compiler/SPEC-INDEX.md` is the quick-lookup table of contents, and the `§` numbers in this tutorial are SPEC sections. §66 is the declaration model this tutorial uses throughout.

- **The bootstrap** — `compiler/self-host-v2/` is the compiler this tutorial is checked against; `docs/bootstrap-conformance.md` measures how much of the language it builds today, and `docs/DIALECT.md` explains how the public docs are kept honest about it.

- **Examples** — `examples/` in this repository holds longer runnable apps. They are written in the older dialect that `scrml compile` (impl#1) speaks; read them for the shape of a real app, not for current spelling. Of particular interest:
  - `examples/03-contact-book.scrml` — full-stack CRUD against SQLite.
  - `examples/05-multi-step-form.scrml` — multi-step wizard with components and enums.
  - `examples/14-mario-state-machine.scrml` — an engine with payload variants and transitions driven by user actions.
  - `examples/15-channel-chat.scrml` — real-time chat across multiple clients.

- **Error codes** — when the compiler flags an error, the code (`E-WRITE-NOT-GRANTED`, `E-RI-002`, `E-DERIVED-WRITE`, ...) is your best search term. The SPEC's error-code catalog (§34) explains the rule each code enforces and the usual fix.

---

## Glossary — the primitives in this tutorial

A fast reference for the keywords and sigils in this tutorial. Each line links back to the section that explains it.

- **`<program>`** — the top-level element wrapping a scrml app. §1.
- **`${ ... }`** — logic block (statement position) or interpolation (expression position). §1.
- **`;`** — ends a statement; newlines are whitespace. §2.
- **`let <name:T=init/>`** — a writable reactive state declaration (`let` before the `<`). §2.
- **`<name:T=init/>`** — a locked declaration: a constant, or derived when `init` reads cells. §2, §2.1.
- **`@name`** — canonical expression access (read, write, compound assignment). §2.
- **`<name:T=(expr)/>` reading `@cells`** — derived reactive; recomputes when inputs change; unwritable. §2.1.
- **`let <x:(not to T)=(f() !{ _ :> not })/>`** — a pending cell: starts `not`, becomes `T` when the server answers. §2.2.
- **`function f(x: int) -> T { return …; }`** — typed parameters; explicit `return` on every path. §2, §3.1.
- **`Item[free, append, remove, write]`** — a tape type and its grants; `.append` / `.pop` / `.prepend` / `.shift` / `.insert` / `.remove`. §3.1.
- **`<name attr:T/> renders <markup>`** — a component: a declaration with typed attributes and its markup. §3.3.
- **`<signup:struct> let <field:T=… validators/> renders <input …/> </>`** — a compound with validated fields. §5.
- **`<*name/>`** — render the existing instance (a field of this compound, or a `single` engine). §5.2, §4.3.
- **`@form.isValid` / `@form.errors` / `@form.touched`** — auto-synth validity surface (read-only); the compiler gates the form's submit on it. §5.4.
- **`<errors of=expr/>`** — first-class error-rendering element. §5.5.
- **`bind:value=@var`** — two-way binding on a form control. §3.4.
- **`class:active=expr`** — conditional class attachment. §3.4.
- **`onclick=fn()`** — bare-call event handler. §3.4.
- **`onclick={ a(); @b = 1; }`** — inline block handler; statements run in order. §3.4.
- **`if=expr` / `else-if=expr` / `else`** — conditional rendering chain on sibling elements (`else` is bare). §3.5.
- **`<each in=@coll as x key=x.id>...</each>`** — canonical Tier-1 markup iteration; space binder `as x` (never `as=x`). §3.2.
- **`for (x of @xs) { lift <li>...</li>; }`** — Tier-0 markup iteration; `for` is the one loop. §3.2.
- **`type Name:struct = { ... }`** — structural record type. §3.1.
- **`type Name:enum = { A, B(n: int), ... }`** — tagged sum type. §4.2.
- **`<match for=Type on=expr> <Variant>...</Variant> </match>`** — block-form markup dispatch; each child element names a variant and holds its markup directly; `<Variant(x)>` binds the payload. §4.2.
- **`match expr { .V :> value, … }`** — expression-form match (value position); comma-separated arms; a block arm yields with `lift`. §4.2.
- **`<name:Type=.V single>`** — an engine: one shared instance whose state-children carry `rule=` transitions. §4.3.
- **`<Variant rule=(.A | .B)/>`** — state-child with legal-transitions contract (multi-target `rule=` MUST be parenthesized). §4.3.
- **`<onTransition to=.B>`** (in the from-state) / **`<onTransition from=.A>`** (in the target state) — directional cross-state effect; exactly one of `to=` / `from=` per element. §4.3.
- **`<program db="...">`** — names the program's database. §2.2.
- **`<db src="..." tables="...">`** — database connection scope with generated row types. §2.2.
- **`<schema> ... </>`** — declarative SQL schema. §2.2.
- **`?{ ` ` ` ... ` ` ` }.all() / .get() / .run()`** — parameterized SQL; failable. §2.2.
- **Server-escalated function** — a function that touches `?{}` SQL, `session`, or another server-only resource runs on the server. §2.2.
- **`function f()! -> Err { fail Err.Variant; ... }`** — failable function. §6.
- **`caller() !{ .Variant :> {...}, .Transport(t) :> {...} }`** — error destructuring at call sites. §6.
- **`is given` / `is not`** — presence / absence predicates. **`!`** — boolean negation. **`not`** — the absence value (`= not`, `x is not`), NOT a negation operator. §7.
- **`==` / `!=`** — structural value equality (no `===`/`!==`). §7.
- **`` `text ${n}` ``** — a template: the one way to put a number into a string; `+` never mixes text and numbers. §7.
- **`int.parse(s)`** — text to a number, `int | not`. §7.
- **`reset(@cell)`** — language keyword for resetting state to its initial value. §5.7.
- **`<channel name="..." topic="...">`** — real-time shared state; lives inside `<program>` (or at file top in a pure-channel module file). §8.
- **`<program auth="required">`** — every request needs a signed-in session; server functions are checked too. §9.
- **`session`** — the signed-in user (`session.userId`, `session.role`, `session.isAuth`), available only in server functions. §9.
- **`<auth role="X">...</auth>`** — NOT content secrecy (`W-AUTH-CONTENT-NOT-GATED`). §9.
- **`#{ ... }`** — style block: global at program level, scoped to a component inside its markup. §2.3.

---

## Things scrml does NOT have (anti-patterns)

The convergent failures every developer makes coming from another framework — or from an older scrml dialect. If your reflex tells you to write the left column, use the right column instead.

| You're about to write… | Use this in scrml | Section |
|---|---|---|
| `useState(0)` / `signal(0)` / `$state(0)` | `let <count:int=0/>` | §2 |
| `<count> = 0` (older dialect) | `let <count:int=0/>` | §2 |
| `let count = 5` (intending reactive) | `let <count:int=5/>` | §2 |
| `computed(() => ...)`, `$:`, `useMemo()`, `const <x> = expr` | `<x:T=(expr)/>` (derived) | §2.1 |
| `useEffect(() => ...)` | Reactive expressions update automatically | §2.1 |
| A statement with no `;` | End every statement with `;` | §2 |
| `function f(x) { … }` | `function f(x: int) { … }` — parameters are typed | §3.1 |
| A function whose last expression is its value | `return value;` on every path | §2 |
| `xs.push(x)` / `[...xs, x]` on an untyped list | `<xs:T[free, append]=[]/>` then `@xs.append(x)` | §3.1 |
| `while (cond) { … }` | `for (cond) { … }` | §3.2 |
| `const Row = <li props={…}>` | `<row item:T/> renders <li>…</li>` | §3.3 |
| `await fetchUser()` | `fetchUser() !{ … }` (compiler manages the wait) | §6 |
| `try { ... } catch { ... }` | `f() !{ .Variant :> { ... }, }` | §6 |
| `throw new Error(...)` | `fail Err.Variant;` (typed error enum) | §6 |
| `if (@phase === 'loading') ...` chains | `<phase:Phase=.Idle single>` with `rule=` | §4.3 |
| `<engine for=T initial=.X>` (older dialect) | `<t:T=.X single>` | §4.3 |
| Many booleans gating UI | One enum + engine | §4 |
| `null` / `undefined` literals | `is given` / `is not` | §7 |
| `===` / `!==` | `==` / `!=` | §7 |
| `not x` (intending negation) | `!x` (`not` is the absence value, not negation) | §7 |
| `"Count: " + n` | `` `Count: ${n}` `` | §7 |
| `parseInt(s)` / `Number(s)` | `int.parse(s)` / `number.parse(s)` (`T \| not`) | §7 |
| `@item.name` for a component attribute | `item.name` — attributes are read by bare name | §3.3 |
| `function validate() { if (@form.name == "") ... }` | `let <name:string="" req/>` (declared validators) | §5 |
| `if (@signup.errors.name.length > 0) <p>...</p>` | `<errors of=@signup.name/>` | §5.5 |
| `import { useState } from 'react'` | nothing — declarations are built in | §2 |
| `import Database from 'better-sqlite3'` | `<program db="..."> ... ?{} ...` | §2.2 |
| `server function f()` (legacy) | plain `function f()` — body-content inference escalates | §2.2 |
| `socket.io`, custom WebSocket setup | `<channel name="..."> ... </>` | §8 |
| Hiding admin markup with a wrapper element | Return admin-only data from a server function that checks `session.role` | §9 |
| Unbraced multi-statement handler `onclick=fn(); @x = .Y` (`E-MULTI-STATEMENT-HANDLER`) | Wrap it in braces: `onclick={ fn(); @x = .Y; }` (inline block, SPEC §5.2.3) — or name a function if it's reused | §3.4 |

If you don't see your case in the table, default to the shape from §10. Don't invent syntax — when in doubt, the canonical reference is the specification (`compiler/SPEC.md`, navigated with `compiler/SPEC-INDEX.md`).

---

*Last updated: 2026-10-22 (S469), rewritten into the ruled dialect. Every complete program above is compiled by CI with the bootstrap (`scripts/snippet-gate.js`), which also fails if the copy printed here stops matching its file; the spec-ahead ones are expected to fail until the bootstrap builds what they use, and CI reports the day each starts compiling.*
