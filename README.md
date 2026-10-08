# scrml

*/ˈskrɪmɛl/*

**A compiled language for the web.** Markup, reactive state, scoped CSS, SQL and server functions go in one `.scrml` file. The compiler reads it and writes the wiring between them: the server routes, the `fetch` calls, the CSRF checks, the WebSocket sync. No virtual DOM, no JSX, no API layer for you to keep in sync.

```bash
scrml compile app.scrml -o dist/
```

You declare the shape of the app; the compiler builds the machine.

Every scrml block in this README (except the one section marked otherwise) is a real `.scrml` file under [`docs/readme-snippets/`](./docs/readme-snippets/), and CI compiles each one on every push. Each block links to its file, and a drift check fails the build if the block and the file ever differ. The one section that is **not** today's compiler is [Where the language is going](#where-the-language-is-going), and it says so at the top. The deep mechanics live in **[NERDME.md](./NERDME.md)**; the formal truth is [`compiler/SPEC.md`](compiler/SPEC.md).

---

## One app, one file

Here is a small app you can actually run: a task list that saves to SQLite, stays in sync across every open browser tab, and drives its status line with a state machine. It is one file, [`docs/readme-snippets/tasks.scrml`](./docs/readme-snippets/tasks.scrml). Below it comes in four pieces. After each piece: **what the compiler did that you never wrote.**

### 1 — the data and the server

<!-- snippet: docs/readme-snippets/tasks.scrml#L10-L48 -->
```scrml
<program db="tasks.db">

<schema>
    tasks {
        id:           integer primary key
        text:         text not null
        completed_at: integer
    }
</>

type Task:struct = {
    id: number,
    text: string,
    completed_at: number | not
}

type TaskError:enum = { Duplicate }

fn isActive(t) -> boolean {
    return t.completed_at is not
}

function loadTasks() {
    return ?{`SELECT id, text, completed_at FROM tasks ORDER BY id`}.all() !{ _ :> [] }
}

function insertTask(text: string)! -> TaskError {
    const same = ?{`SELECT id FROM tasks WHERE text = ${text}`}.get()
    if (same is some) fail .Duplicate
    return ?{`INSERT INTO tasks (text, completed_at) VALUES (${text}, ${not})
              RETURNING id, text, completed_at`}.get()
}

function flipTask(id) {
    return ?{`UPDATE tasks SET completed_at =
                CASE WHEN completed_at IS NULL THEN ${Date.now()} ELSE NULL END
              WHERE id = ${id}
              RETURNING id, text, completed_at`}.get()
}
```

Three functions touch the database, so the compiler put them on the server. Nobody wrote `server`, `async`, a route or a `fetch`. The compiled output has three POST routes in `tasks.server.js`, and the SQL appears there and nowhere in `tasks.client.js`. Where the page calls these functions, the client file calls the generated routes, with a CSRF token. The `${…}` values in the SQL are sent as bound parameters, not pasted into the string.

`<schema>` is the table you want. `scrml db-migrate tasks.scrml --db tasks.db` compares it with the real database and applies the difference: on an empty file it runs the `CREATE TABLE`; add a column to the schema later and it plans an `ALTER TABLE … ADD COLUMN`.

There is no `null` in scrml. `not` is the one absence value, and you test for it with `is not` / `is some`. `insertTask` can fail, and says so in its type (`! -> TaskError`). `fail .Duplicate` is how it fails. There is no `throw`.

### 2 — shared state

<!-- snippet: docs/readme-snippets/tasks.scrml#L50-L67 -->
```scrml
<channel name="tasks">
    <tasks>: Task[] = []

    function addRow(row) { @tasks = [...@tasks, row] }
    function replaceRow(row) { @tasks = @tasks.map(t => t.id == row.id ? row : t) }
</>

type Filter:enum = { All, Active, Done }

<filter>: Filter = .All
<newTask req length(>=1)> = <input placeholder="What needs doing?"/>

const <visible> = match @filter {
    .All    :> @tasks
    .Active :> @tasks.filter(isActive)
    .Done   :> @tasks.filter(t => !isActive(t))
}
const <left> = @tasks.filter(isActive).length
```

`<tasks>: Task[] = []` declares a reactive cell, and `@tasks` reads or writes it. Because it sits inside `<channel>`, every write reaches every open tab. The compiler emitted the WebSocket route and the client that keeps the copies in step; you wrote a list.

`<newTask req length(>=1)> = <input …/>` is a cell bound to an input. The validators become `required minlength="1"` on the emitted `<input>`, so the browser won't submit an empty task.

`const <visible>` and `const <left>` are derived: they recompute when `@filter` or `@tasks` change. The `match` is checked for exhaustiveness. Delete the `.Done` arm and the compile fails with `E-TYPE-020`.

### 3 — behaviour, and errors as states

<!-- snippet: docs/readme-snippets/tasks.scrml#L69-L88 -->
```scrml
type Phase:enum = { Loading, Editing, Saving, Saved, Rejected(msg: string) }

function load() {
    @tasks = loadTasks() !{ .Transport(_) :> { return } }
    @phase = .Editing
}

function submit() {
    @phase = .Saving
    const row: Task = insertTask(@newTask) !{
        ::Duplicate :> { @phase = .Rejected("That task is already on the list."); return }
    }
    addRow(row)
    @newTask = ""
    @phase = .Saved
}

function toggle(id) {
    replaceRow(flipTask(id))
}
```

`insertTask` runs on the server, and `submit` calls it like a local function. The `!{}` block after the call handles its failure: the one `TaskError` variant routes into a `Phase` state. A missing arm is a compile error. The failure lives in the type, not in an `isError` flag.

### 4 — the screen is a state machine

<!-- snippet: docs/readme-snippets/tasks.scrml#L90-L125 -->
```scrml
<form onsubmit=submit()>
    <newTask/>
    <button>Add</button>
</form>

<nav>
    <button onclick=${@filter = .All}    class:on=${@filter == .All}>All</button>
    <button onclick=${@filter = .Active} class:on=${@filter == .Active}>Active</button>
    <button onclick=${@filter = .Done}   class:on=${@filter == .Done}>Done</button>
</nav>

<ul>
    <each in=@visible key=@.id>
        <li class:done=${!isActive(@.)} onclick=${toggle(@.id)}>${@.text}</li>
        <empty><li>Nothing here.</li></empty>
    </each>
</ul>

<engine for=Phase initial=.Loading effect=${ load() }>
    <Loading rule=.Editing>
        <p>Loading…</p>
    </>
    <Editing rule=.Saving>
        <p>${@left} left</p>
    </>
    <Saving rule=(.Saved | .Rejected)>
        <p>Saving…</p>
    </>
    <Saved rule=(.Editing | .Saving)>
        <p>Saved.</p>
        <onTimeout after=1.5s to=.Editing/>
    </>
    <Rejected msg rule=.Saving>
        <p class="err">${msg}</p>
    </>
</>
```

`<engine for=Phase>` is a state machine over the `Phase` enum. Every variant gets a block of UI, and `rule=` lists the states it may move to. Leave a variant out and the compile fails with `E-ENGINE-STATE-CHILD-MISSING`: you can't ship a state that has no UI. `effect=` runs once when the engine starts, and loads the list. `<onTimeout>` moves "Saved." back to the task count after 1.5 seconds, with no `setTimeout` in the source. `<each>` renders the list and reconciles it by `key=` as `@visible` changes, and `<empty>` covers the empty case.

The file ends with a `#{ }` style block (three rules).

### run it

```bash
mkdir try-scrml && cp docs/readme-snippets/tasks.scrml try-scrml/ && cd try-scrml
scrml db-migrate tasks.scrml --db tasks.db   # creates the table
scrml dev tasks.scrml                        # compiles, watches and serves on http://localhost:3000
```

Open it in two tabs. Add a task in one and it appears in the other. Add the same task twice and the status line says so until the next save. Click a task to mark it done. Close everything, run `scrml dev` again, and the tasks are still there. (The compiler currently prints a false `W-DEAD-FUNCTION` warning for `load`, because it doesn't yet see calls made from `effect=`. That is a known gap; `load` runs.)

### what you wrote vs. what the compiler wrote

You wrote a schema, three database functions, some state, three handlers and a state machine. The compiler wrote **the route handlers, the `fetch` calls, the CSRF token handling, the parameterized queries, the serialization, the WebSocket endpoint and the sync client, the HTML validation attributes, the table migration, and the exhaustiveness checks.** That's the pitch: you declare the shape, the compiler builds the machine.

> The deep version of each of those (the inference rules, the error codes, the trade-offs) is in **[NERDME.md](./NERDME.md)**.

---

## Why scrml

**State is the declaration primitive.** `<count> = 0` declares a reactive cell; `@count` reads or writes it. Compound, derived (`const <total> = expr`), input-bound and validated cells are the same primitive with different attributes. The compiler tracks the dependency graph and updates the DOM on change.

**Engines are the centerpiece.** When state goes from "a few booleans" to "this app has phases," you promote it up a tier ladder without rewriting the markup tree: `if=` chains, then `<match for=Type>`, then `<engine for=Type>`. The engine declares the legal transitions, runs effects, and refuses to compile while any variant lacks a UI block.

**Full-stack in one file.** Markup, logic, styles, SQL, server functions, error handling and realtime channels all go in `.scrml`. The compiler works out what runs on the server and splits the file. There are no route files and no API layer to drift out of sync.

**Errors are states, not exceptions.** Inside logic, `try`/`catch`/`throw` are compile errors, and so are `class` and `async`/`await`. A failable function declares its errors as an enum (`function f()! -> LoadError`), and the `!{}` handler at the call site routes each variant into the right state. A missing arm is a compile error.

**Validators live on the declaration.** `req`, `length(…)`, `pattern(…)` and friends ride on a cell as attributes. On a compound cell they produce a read-only validity surface (`@form.isValid`, per-field `.errors` / `.touched`) that `<errors of=@form.field/>` renders ([example 30](examples/30-validated-form.scrml)), and on an input they become the matching HTML attributes. No separate validation library.

**No npm.** scrml ships its own standard library ([21 modules](docs/FACTS.md)), imported as `scrml:<name>`. An app has no package manager and no dependency tree. (Third-party code still gets in, but through an explicit, named surface, not an auto-resolved graph. You can declare the capabilities it needs; in this version that declaration is advisory, not enforced.)

---

## Where the language is going

> **Specified, not yet in the shipping compiler.** Everything on the *specified* side below is normative in [`compiler/SPEC.md` §66](compiler/SPEC.md) or in a recorded design ruling, and **none of it compiles today.** It is being built in the bootstrap compiler, [`compiler/self-host-v2/`](compiler/self-host-v2/), which is written in scrml and is still early. The *today* side of each pair is a gated file that compiles now. When the bootstrap is done, the *today* forms go through a deprecation window: they keep compiling, with a warning that names the new form (SPEC §66.21).

The upgrade in one sentence: a declaration becomes a thing in the tree with typed attributes, a `renders` and instances, and **data is locked unless its type grants the write.**

**1. Declarations, and locked by default** (SPEC §66.19.1)

Today ([file](./docs/readme-snippets/today-counter.scrml)):

<!-- snippet: docs/readme-snippets/today-counter.scrml#L5-L7 -->
```scrml
<count> = 0
<step> = 1
const <doubled> = @count * 2
```

Specified:

```scrml
<let count:int=0/>                          // writable: `let` is the replace grant on a scalar (§66.9)
<step=1/>                                   // locked constant; the integer literal infers `int` (§66.3)
<doubled:int=(@count * 2)/>                 // derived: locked + a reactive initializer (§66.9)
```

`let` is the only thing that makes a cell writable. A write to `@step` becomes `E-WRITE-NOT-GRANTED`, and `const <x>` retires: a derived cell is just a locked declaration whose initializer reads other cells.

**2. Engines become `single` declarations** (SPEC §66.19.6)

Today ([file](./docs/readme-snippets/today-engine.scrml)):

<!-- snippet: docs/readme-snippets/today-engine.scrml#L5-L12 -->
```scrml
type Phase:enum = { Idle, Loading, Done, Failed }

<engine for=Phase initial=.Idle>
    <Idle    rule=.Loading : "Ready">
    <Loading rule=(.Done | .Failed) : "Loading…">
    <Done    rule=.Idle : "Done">
    <Failed  rule=(.Loading | .Idle) : "Failed — retry?">
</>
```

Specified:

```scrml
<phase:Phase=.Idle single>                      // one vehicle; the name IS the variable (§66.13.3)
    <Idle    rule=.Loading : "Ready">              // ⚑ O52: state-child marker + `:`-shorthand body
    <Loading rule=(.Done | .Failed) : "Loading…">
    <Done    rule=.Idle : "Done">
    <Failed  rule=(.Loading | .Idle) : "Failed — retry?">
</>
```

The engine stops being its own element. It is a declaration marked `single`, and the same transition graph can sit on a field of a multi-instance declaration, so every card on a page can carry its own `status` machine. It renders with `<*phase/>` ("the existing one"); a plain `<phase/>` of a `single` declaration is an error. (The `⚑ O52` comment is the spec's own marker for a detail that is still open.)

**3. Components become declarations with a `renders`** (SPEC §66.19.4, §66.15)

Today ([file](./docs/readme-snippets/today-component.scrml)):

<!-- snippet: docs/readme-snippets/today-component.scrml#L6-L13 -->
```scrml
const Swatch = <span class="chip" props={ label: string, hex: string }>
    <i style="background:${hex}"></i> ${label}
</span>

<main>
    <Swatch label="Brand" hex="#338967"/>
    <Swatch label="Warn" hex="#FF6600"/>
</main>
```

Specified:

```scrml
export <swatch let label:string="Brand" let hex:string=@brand/>   // `let` + reactive initializer = SEEDED (§66.9)
renders <span class="chip"><i style="background:${hex}"></i> ${label}</span>

export <accent:swatch label="Accent" hex=@brand/>              // named shared instances (§66.8.2) (a declaration per the #16 ruling, §66.2.2)
export <warn:swatch label="Warn" hex="#FF6600"/>
```

A component is a declaration with typed attributes and a `renders`. A plain `<swatch label="Danger" hex=@danger/>` makes a fresh instance; `<*accent/>` renders the one named shared instance, wherever it is used.

**4. Sequences carry their permissions** (SPEC §66.19.5, §66.12; grant spelling ruled at S442)

Today ([file](./docs/readme-snippets/today-log.scrml)), nothing stops an audit log from being wiped:

<!-- snippet: docs/readme-snippets/today-log.scrml#L6-L14 -->
```scrml
type Entry:struct = { at: number, actor: string, action: string }

<audit>: Entry[] = []
<actor> = "ops"

function record(action: string) {
    @audit = [...@audit, { at: Date.now(), actor: @actor, action: action }]
}
function wipe() { @audit = [] }
```

Specified:

```scrml
<audit:Entry[free, append]=[]/>
```

```scrml
// @audit = []                                   → E-WRITE-NOT-GRANTED (a replace; the type grants none)
// @audit.shift()                                → E-WRITE-NOT-GRANTED (changes at the front)
// @audit[0].action = "edited"                   → E-WRITE-NOT-GRANTED (positions read-only; Entry.action is fixed)
```

The type grants the log free length and growth at the end, and nothing else. `wipe()` stops compiling, and no statement anywhere in the program can remove or rewrite an entry. (SPEC §66.19.5 spells the grant `[free, end]`; the S442 ruling split growing from shrinking, so an append-only log is `Entry[free, append]` and a stack is `Frame[free, append, pop]`. The one sequence kind has been named `tape`.)

**5. Operators take numbers, conditions take booleans** (S440 / S442 rulings)

Today ([file](./docs/readme-snippets/today-operators.scrml)), all of this compiles, and `@total` is the string `"11"` after one click:

<!-- snippet: docs/readme-snippets/today-operators.scrml#L6-L12 -->
```scrml
<count> = 0
<label> = "items: "

const <shown> = @label + @count
const <total> = @count + "1"

<p if=@count>${@shown} ${@total}</p>
```

Ruled: *"arithmetic and relational operators take NUMBERS only; `+` takes two numbers or two strings"*, *"`!`, `&&`, `||` (and `and`/`or`) take booleans only"*, and *"a `T | not` operand must be narrowed before `+`, arithmetic, comparison, or use in a template."* A `T | not` value is not a `T` until it has been narrowed, for every type. Both `+` lines above become errors wherever the types are provable. `if=@count` on a number goes the same way: a condition takes a boolean or a presence test.

---

## Quick start

scrml is not on npm. You run it from a clone.

```bash
# Install Bun if you don't have it — https://bun.sh
curl -fsSL https://bun.sh/install | bash

# Get the compiler and its dependencies
git clone https://github.com/bryanmaclee/scrml.git
cd scrml
bun install

# Put the `scrml` command on your PATH (one-time, from the repo root)
bun link

# Scaffold a new project, then run it
scrml init my-app
cd my-app
scrml dev src/app.scrml   # compile, watch and serve

# Or use the CLI directly on any .scrml file or directory
scrml compile <file|dir>
scrml build <dir>         # production build
```

---

## More

- [A note from the dev](docs/readme/note-from-the-dev.md)
- [The tier ladder](docs/readme/tier-ladder.md)
- [Everything scrml does](docs/readme/features.md)
- [Language contexts](docs/readme/language-contexts.md)
- [Examples](docs/readme/examples.md)
- [Terms](docs/readme/terms.md)
- [Documentation](docs/readme/documentation.md)
- [License](LICENSE)
- [Related projects](docs/readme/related-projects.md)
- [Status](docs/readme/status.md)
