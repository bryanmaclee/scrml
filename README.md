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

## A note from the dev

Everything in the main body of this README compiles with the current compiler, and CI checks that on every push. The one section that doesn't, *Where the language is going*, says so. That section is the language as designed; the compiler is catching up to it. I am working full-bore to get the compiler there. I am just one guy.

If you are here (and reading this). Hello, My name is Bryan MacLee. I am co-owner of a small trucking company in rural Ut. I run the business, drive, mechanic, apparently I'm the HR department. I am also a husband, father and sometimes, a wannabe coder.

This message is from me. I typed it. but ~96% of what you read (99.9% for the actual code) is claude "written". (I dont care about the exact brand as long as I have a tool that will get the job done.) I do my best to skim, and review as much as I can. But (see the prior list). If you find this interesting, continue reading. if you find something doesn't quite add up (or some straight up bullshit). let me know.

This is my third round with the ai and coding. the first two were pretty underwhelming. This time around I wasn't expecting much but I thought "the hell with it" and I tried out claude. I was fudging impressed.

I had been working with these ideas (in one way or another) for a long time. Over the course of about 3 years I learned (yes, the old school way, not much different than I am doing right now) how compilers work and how to implement various parts in various methods. programming has always been my favorite activity. the thing that I look forward to all the time (other than hanging with my wife and kids. Of course.)

After my first couple of experiments with claude I realized, I might actually be able to build this language. Dont get me wrong, I absolutely could write this language by hand. I can say that factually. BUT it would absolutely take me 10-20 years to do it. I think the ideas are worth surfacing at least.

AI code is still what it is. 100% mid. But its still all human mid that it is regurget-asemble-ing, If the ideas on top of the impl are good, or at least novel. it doesn't matter if the impl is mid. The ideas still get across. that's all that really matters to me here.

are the ideas any good?

---

## The tier ladder

State rarely starts as a state machine. scrml lets it *become* one. You start with a rough prototype and add structure as the design hardens, **without rewriting the markup tree.** The state-children carry forward verbatim between tiers; swapping the wrapper is the only commitment.

| Tier  | Form                                       | What you get                                                           |
|-------|--------------------------------------------|------------------------------------------------------------------------|
| **0** | `if=` chains / `${ if (...) lift ... }`    | prototype, no exhaustiveness check                                     |
| **1** | `<match for=Type [on=expr]>` + `<each>`    | compile-time exhaustiveness; `rule=` is accepted but does nothing yet (a lint nudges promotion) |
| **2** | `<engine for=Type initial=.Variant>`       | exhaustiveness + transition rules + per-state effects (`<onTransition>` / `<onTimeout>` / `<onIdle>`) + nested engines + `history` restore |

The engine surface beyond the demo (nested sub-engines, `history` restore on re-entry, named timeouts with `cancelTimer()`, idle watchdogs) is exercised in [`examples/14-mario-state-machine.scrml`](examples/14-mario-state-machine.scrml), and explained in [NERDME.md → Realtime and workers / engines](./NERDME.md#realtime-and-workers).

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

## Everything scrml does

A short brief on each feature that works today. Each links to the full mechanics in [NERDME.md](./NERDME.md). Anything specified but not built is marked **(Nominal)**.

**State & reactivity:** `<x> = 0` declares, `@x` reads and writes; plain, input-bound and derived (`const`) cells; compound cells; two-way `bind:value` / `bind:checked`; `not` as the one absence value (no `null`, no `undefined`). → [deep dive](./NERDME.md#state-and-reactivity)

**Enums, matches, engines & iteration:** the Tier 0→1→2 ladder above: `if=`, exhaustive `match` and `<match for=Type>`, `<each>` with `<empty>`, and `<engine>` state machines with `rule=` transitions and `<onTransition>` / `<onTimeout>` / `<onIdle>` effects. → [deep dive](./NERDME.md#realtime-and-workers)

**Errors as states:** failable `function f()! -> Err`, `fail .Variant`, and exhaustive `!{}` handlers that route failures into state. `defer` runs cleanup on every way out of a function. `<errorBoundary>` catches failures in markup. → [deep dive](./NERDME.md#pure-functions--fn)

**Server / client split:** anything that touches SQL or other server-only resources runs on the server, and the compiler generates the routes, the `fetch` calls, the CSRF handling and the serialization. `protect="col"` keeps a column's values off the client: the column is stripped from rows before they leave the server. → [deep dive](./NERDME.md#server--client-split)

**SQL and schema:** `?{}` runs SQL (SQLite) with bound parameters. `<schema>` declares the tables, and `scrml db-migrate` diffs it against the live database and applies the change (`--dry-run` prints the plan). → [example 17](examples/17-schema-migrations.scrml)

**Runtime type validation:** the type annotation *is* the check. `number(>0 && <10000)`, `string(email)` and composable predicates. A literal that breaks the predicate is a compile error; a runtime value that breaks it is rejected when it arrives (`E-CONTRACT-001-RT`). → [deep dive](./NERDME.md#runtime-type-validation-replaces-zod)

**Validators and the validity surface:** `req`, `length`, `pattern`, `min`/`max`, `eq(@other)` and more ride on a cell. On a compound cell they give you `@form.isValid` / `.errors` / `.touched` / `.submitted`, and `<errors of=…/>` renders them. On an input they become `required`, `minlength`, `pattern` and friends. → [deep dive](./NERDME.md#free-html-validation)

**Type-derived apps:** `formFor(T)` / `schemaFor(T)` / `tableFor(T, rows)` generate a form, the SQL DDL and a table from one struct. → [deep dive](./NERDME.md#type-derived-apps--formfor--schemafor--tablefor)

**Realtime & workers:** state declared inside `<channel>` syncs across every connected client over a WebSocket the compiler sets up. A nested `<program>` is a Web Worker: `when message from` handlers receive its messages and `.send()` returns its reply ([example 13](examples/13-worker.scrml)). Supervision (`restart=`, `when terminate from`) is specified but not built yet. → [deep dive](./NERDME.md#realtime-and-workers)

**Client navigation:** `navigate(path)` moves between `<page>`s, rendered into the `<program>` shell's `<outlet>`. → [example 21](examples/21-navigation.scrml)

**Typed external APIs:** `<api>` types an HTTP backend you don't own, and `<endpoint>` types a route that someone else's client calls; a request variant with no handler is a compile error. → [examples 32](examples/32-external-api.scrml) / [33](examples/33-endpoint.scrml)

**The `~` pipeline & linear types:** `~` holds an unnamed intermediate for the next statement to consume. `lin` makes a value exactly-once: using it twice, never, or on only one branch is a compile error (`E-LIN-002` / `-001` / `-003`), and so is using it inside a loop. → [deep dive](./NERDME.md#linear-types-and-the--accumulator)

**Pure functions — `fn`:** purity is compiler-*enforced*. No SQL, no DOM writes, no reactive writes, no non-determinism: break one and it won't compile. `function` is the general callable. → [deep dive](./NERDME.md#pure-functions--fn)

**Styles:** `#{ }` inside a component is scoped through native `@scope`, with no class mangling; at program level it is global. A built-in Tailwind engine emits only the utilities you use, with no CLI and no PostCSS. And a scrml-native CSS model (SPEC §65): an unconditional same-property conflict on the same element is a compile error (`E-STYLE-CONFLICT`), not a silent last-wins, and `<theme>` tokens lower to CSS custom properties. The rest of §65 (style as a value, `<defaults>`) is **(Nominal)**. → [deep dive](./NERDME.md#styles)

**Metaprogramming:** `^{}` runs at compile time: `reflect(Type)` reads a type, `emit()` writes code. → [deep dive](./NERDME.md#metaprogramming-)

**Foreign code:** when you need TS/JS, a value-returning `_={ … }=` block inside a server function drops into it. → [deep dive](./NERDME.md#known-limitations-and-gaps)

**Tooling:** a CLI with [11 verbs](docs/FACTS.md) (`init`, `dev`, `compile`, `build`, `db-migrate`, …), a language server, and editor support for Neovim and VS Code. One file type, `.scrml`.

**Inline tests:** `~{ test "…" { assert … } }` blocks sit next to the code they check and are compiled out of the output. The shipping CLI has no command that runs them yet.

**The Build Story (Nominal):** compilation pinned to a content-addressed, reproducible "what the compiler is" closure; per-`<program>` build identity. → [deep dive](./NERDME.md#the-build-story-nominal)

> Known gaps and partial implementations are tracked in [`docs/known-gaps.md`](./docs/known-gaps.md) and [NERDME → Known limitations](./NERDME.md#known-limitations-and-gaps). One to know now: `class` and `async` are rejected inside logic, but at the top level of a `<program>` body they currently come out as page text. The fix (a `<program>` body carries no loose text) is ruled and in progress.

---

## Language contexts

scrml uses sigil-delimited contexts to separate concerns within a single file:

| Context | Sigil | Purpose |
|---------|-------|---------|
| Program | `<program>` | App root: database, protection, config |
| Markup  | `<tag>` | HTML elements, scrml structural elements (`<engine>`, `<match>`, `<each>`, `<channel>`, `<schema>`, `<errors>`, `<onTimeout>`, `<page>`, …) and state declarations (`<name> = init`) |
| Logic   | `${}` | Expressions, statements and functions |
| SQL     | `?{}` | Database queries (SQLite), with bound parameters |
| CSS     | `#{}` | Scoped styles |
| Error   | `!{}` | Typed error handling (`!{ .V :> ... }` arms) |
| Meta    | `^{}` | Compile-time (or runtime) code generation |
| Test    | `~{}` | Inline tests (compiled out of the output) |
| Foreign | `_{}` | Inline foreign code: the value-returning `_={…}=` form |

---

## Examples

The [`examples/`](examples/) directory holds one app per file. Every one of them compiles with the current compiler.

| Example | What it shows |
|---------|---------------|
| [01-hello](examples/01-hello.scrml) | Bare minimum: compiles to pure HTML |
| [02-counter](examples/02-counter.scrml) | Reactive state, binding, scoped CSS |
| [03-contact-book](examples/03-contact-book.scrml) | Full-stack with DB, server functions, SQL |
| [04-live-search](examples/04-live-search.scrml) | Reactive filtering, derived state |
| [05-multi-step-form](examples/05-multi-step-form.scrml) | A wizard as an `<engine>`, validators gating each step |
| [06-kanban-board](examples/06-kanban-board.scrml) | Derived per-status columns over a typed list |
| [07-admin-dashboard](examples/07-admin-dashboard.scrml) | Metaprogramming, type reflection |
| [08-chat](examples/08-chat.scrml) | Reactive lists, server persistence |
| [09-error-handling](examples/09-error-handling.scrml) | Errors as states with `!{}` |
| [10-inline-tests](examples/10-inline-tests.scrml) | `~{}` inline tests |
| [11-meta-programming](examples/11-meta-programming.scrml) | `^{}` meta blocks, `emit()`, `reflect()` |
| [12-snippets-slots](examples/12-snippets-slots.scrml) | Named content slots in components |
| [13-worker](examples/13-worker.scrml) | A nested `<program>` as a Web Worker with typed messages |
| [14-mario-state-machine](examples/14-mario-state-machine.scrml) | Enum states and `<engine>` transition enforcement |
| [15-channel-chat](examples/15-channel-chat.scrml) | `<channel>` realtime, auto-synced channel state |
| [16-remote-data](examples/16-remote-data.scrml) | Loading as a `Phase` enum, failure routed into `.Failed` |
| [17-schema-migrations](examples/17-schema-migrations.scrml) | `<schema>` + `scrml db-migrate` |
| [18-state-authority](examples/18-state-authority.scrml) | `<x server>` server-authoritative cells |
| [19-lin-token](examples/19-lin-token.scrml) | `lin` exact-once consumption |
| [20-middleware](examples/20-middleware.scrml) | `<program>` middleware attributes + `handle()` |
| [21-navigation](examples/21-navigation.scrml) | `navigate()` + `route` |
| [22-multifile](examples/22-multifile/) | Cross-file `import`/`export`, pure-type files |
| [23-trucking-dispatch](examples/23-trucking-dispatch/) | A multi-file dispatch app: a real login, a portal per role (dispatcher, driver, customer), channels, single-use `lin` tokens. Ships a seeded database — see its README |
| [24-tilde-pipeline](examples/24-tilde-pipeline.scrml) | The `~` pipeline accumulator |
| [25-triage-board](examples/25-triage-board.scrml) | Drag-and-drop between columns, struct + enum state |
| [26-type-derived-schema](examples/26-type-derived-schema.scrml) | `schemaFor(Type)`: SQL DDL from a struct |
| [27-type-derived-table](examples/27-type-derived-table.scrml) | `tableFor(Type, rows)`: a `<table>` from a struct |
| [28-flux](examples/28-flux.scrml) | A shifting-labyrinth game: derived ASCII board, fog of war |
| [29-engine-vs-flags](examples/29-engine-vs-flags.scrml) | Three booleans vs. a `Phase` enum where impossible states can't be written |
| [30-validated-form](examples/30-validated-form.scrml) | Validators and the validity surface, `<errors of=…/>` |
| [31-reach-discipline](examples/31-reach-discipline.scrml) | When to reach for an `<engine>` and when for a pure `fn` |
| [32-external-api](examples/32-external-api.scrml) | `<api>`: a typed client for a backend you don't own |
| [33-endpoint](examples/33-endpoint.scrml) | `<endpoint>`: a typed route for someone else's client |
| [34-value-native-set](examples/34-value-native-set.scrml) | `set[K]`: sets compared by value |

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

## Terms

A short glossary of scrml-specific terms.

- **reactive cell:** state declared with `<name> = init`. Read and written via `@name`; changing it updates the parts of the UI that depend on it. Three right-hand-side shapes: plain (`<x> = 0`), input-bound (`<userName req> = <input/>`), and derived (`const <x> = expr`).
- **engine:** a Tier-2 state machine, `<engine for=Type initial=.Variant>`. Each state-child is one variant's UI block; `rule=` declares the legal transitions; `<onTransition>` / `<onTimeout>` / `<onIdle>` attach effects.
- **match block:** the Tier-1 structural form `<match for=Type>`; the compiler checks that every variant has a UI block.
- **lifecycle annotation:** `(A to B)` on a type position. The value starts as `A` and becomes `B`; a read that needs `B` before the transition is `E-TYPE-001`. No runtime cost.
- **`<channel>`:** declares a WebSocket endpoint; state declared inside it syncs across every connected client.
- **validity surface:** the read-only `@form.isValid` / `.errors` / `.touched` cells the compiler synthesizes from the validators on a compound cell.
- **`fn` vs `function`:** `fn` is a compiler-enforced pure function; `function` is the general callable.
- **`not`:** scrml's one absence value. `null` and `undefined` do not exist. Test with `is not` / `is some`.

---

## Documentation

- [NERDME](./NERDME.md): the deep mechanics behind every feature above
- [Tutorial](docs/tutorial.md): step by step, zero to full-stack
- [Design Notes](DESIGN.md): the rationale and philosophy, why scrml is what it is
- [Language Specification](compiler/SPEC.md): the full formal spec ([size and every other derived figure: `docs/FACTS.md`](docs/FACTS.md)) · [Quick-Lookup](compiler/SPEC-INDEX.md)
- [Pipeline Contracts](compiler/PIPELINE.md): the compiler pipeline, stage by stage
- [Live status](./master-list.md) · [Changelog](docs/changelog.md) · [Known gaps](docs/known-gaps.md)

---

## License

MIT, see [LICENSE](./LICENSE).

## Related projects

- **[giti](https://github.com/bryanmaclee/giti)**: a collaboration platform and git alternative designed around scrml's compiler. Early.
- **[6nz](https://github.com/bryanmaclee/6NZ)**: a code editor for the scrml ecosystem, to be written in scrml. Early. The companion [Z-motion input spec](https://github.com/bryanmaclee/6NZ/tree/main/z-motion-spec) is CC0.

## Status

scrml is open source under the [MIT License](./LICENSE). The compiler is at version 0.8.0: pre-1.0, usable, not stable. It runs on [Bun](https://bun.sh), and compiled output is plain JavaScript that runs in any browser or JavaScript runtime. The language's contract is a conformance suite that the current compiler passes, apart from a handful of known, pinned defects; the figures are in [`docs/FACTS.md`](docs/FACTS.md). A second compiler, written in scrml itself, is being built to implement the language as specified. See [`docs/changelog.md`](./docs/changelog.md) for what just landed.
