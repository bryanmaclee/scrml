# scrml

*/ˈskrɪmɛl/*

<!-- dialect: ruled -->

**A compiled language for the web.** Markup, reactive state, scoped CSS, SQL and server functions go in one `.scrml` file. The compiler reads it and writes the wiring between them: the server routes, the `fetch` calls, the CSRF checks, the WebSocket sync. No virtual DOM, no JSX, no API layer for you to keep in sync.

```bash
bun run boot:compile app.scrml
```

You declare the shape of the app; the compiler builds the machine.

This README teaches **today's ruled scrml**: the language [`compiler/SPEC.md`](compiler/SPEC.md) defines, which the scrml-native **bootstrap** compiler ([`compiler/self-host-v2/`](compiler/self-host-v2/), run as `bun run boot:compile`) implements. Every complete program in it is a real `.scrml` file under [`docs/readme-snippets/`](./docs/readme-snippets/) that CI compiles with the bootstrap on every push. Each block links to its file, and a drift check fails the build if the block and the file ever differ. The bootstrap does not build the whole language yet, so where a program uses a feature it lacks, the text says which. The repository's first compiler (impl#1, the `scrml` command) speaks an older dialect and does not parse this one; [What changed from the older dialect](#what-changed-from-the-older-dialect) shows the differences. The deep mechanics live in **[NERDME.md](./NERDME.md)**; the formal truth is the SPEC.

---

## One app, one file

Here is a small app: a task list that saves to SQLite, stays in sync across every open browser tab, and drives its status line with a state machine. It is one file, [`docs/readme-snippets/tasks.scrml`](./docs/readme-snippets/tasks.scrml). Below it comes in four pieces. After each piece: **what the compiler does that you never wrote.**

> **The bootstrap cannot build this whole app yet.** It is written in the ruled language, and CI compiles it with the bootstrap on every push. Today the bootstrap stops at the parts it does not have: `<schema>`, `<channel>`, the `<match>` element, `class:` bindings, `<each>`'s `<empty>`, `<onTimeout>` and duration literals (`1.5s`), an engine opener `effect=`, replacing a whole tape (`@tasks = …`), and building a payload variant (`Phase.Rejected("…")`) as a value. The gate expects exactly that set of error codes, and says so the day the file starts compiling. The piece-by-piece notes say what the finished compiler writes; the first compiler (impl#1) writes all of it today for the same app in its older dialect.

### 1 — the data and the server

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG, E-PARSE-TRAILING, E-SCOPE-001] — the bootstrap has no <schema>, <channel>, <match> block element, class: binding, <empty>, <onTimeout> or duration literal, no engine opener effect=, cannot replace a whole tape, and cannot construct a payload variant (Phase.Rejected(…)) yet -->
<!-- snippet: docs/readme-snippets/tasks.scrml#L7-L53 -->
```scrml
<program db="tasks.db">

<schema>
    tasks {
        id:           integer primary key
        text:         text not null
        completed_at: integer
    }
</>

type Task:struct = { id: int, text: string, completed_at: number | not }

type TaskError:enum = { Duplicate, Storage }

fn isActive(t: Task) -> bool {
    return t.completed_at is not;
}

// ⚑ OPEN: `?{}` rows are untyped; how a row becomes a `Task` value is not ruled yet.
function loadTasks()! -> TaskError {
    let rows: Task[] = ?{`SELECT id, text, completed_at FROM tasks ORDER BY id`}.all() !{
        _ :> { fail TaskError.Storage; },
    };
    return rows;
}

function insertTask(text: string)! -> TaskError {
    let same = ?{`SELECT id FROM tasks WHERE text = ${text}`}.get() !{
        _ :> { fail TaskError.Storage; },
    };
    if (same is given) { fail TaskError.Duplicate; }
    let row: Task = ?{`INSERT INTO tasks (text, completed_at) VALUES (${text}, ${not})
                       RETURNING id, text, completed_at`}.get() !{
        _ :> { fail TaskError.Storage; },
    };
    return row;
}

function flipTask(id: int)! -> TaskError {
    let row: Task = ?{`UPDATE tasks SET completed_at =
                         CASE WHEN completed_at IS NULL THEN ${Date.now()} ELSE NULL END
                       WHERE id = ${id}
                       RETURNING id, text, completed_at`}.get() !{
        _ :> { fail TaskError.Storage; },
    };
    return row;
}
```

Three functions touch the database, so the compiler puts them on the server. Nobody wrote `server`, `async`, a route or a `fetch`. The compiled output has three POST routes in the server module, and the SQL appears there and nowhere in the client script. Where the page calls these functions, the client calls the generated routes, with a CSRF token. The `${…}` values in the SQL are sent as bound parameters, not pasted into the string.

`<schema>` is the table you want. The migration tool compares it with the real database and applies the difference: on an empty file it runs the `CREATE TABLE`; add a column to the schema later and it plans an `ALTER TABLE … ADD COLUMN`. (Migration has not moved to the bootstrap yet; impl#1's `scrml db-migrate` does it for the older dialect.)

There is no `null` in scrml. `not` is the one absence value, and you test for it with `is not` / `is given`. A `?{}` query can fail, so each one is followed by a `!{}` handler (or returned from a `!` function, which passes the failure on). `insertTask` can fail, and says so in its type (`! -> TaskError`); `fail TaskError.Duplicate;` is how it fails. There is no `throw`. Each function returns through an explicit `return`, and the typed local (`let row: Task = …`) is what tells the client what shape comes back.

### 2 — shared state

<!-- snippet: docs/readme-snippets/tasks.scrml#L55-L81 -->
```scrml
<channel name="tasks">
    <tasks:Task[free, append, write, replace]=[]/>

    function addRow(row: Task) { @tasks.append(row); }
    function replaceRow(row: Task) { @tasks = @tasks.map(t => t.id == row.id ? row : t); }
</>

type Filter:enum = { All, Active, Done }

let <filter:Filter=.All/>

<entry:struct>
    let <text:string="" req length(>=1)/>
    renders <input placeholder="What needs doing?" bind:value=@text/>
</>
renders <form onsubmit=submit()>
    <*text/>
    <button>Add</button>
</form>

<active:Task[]=(@tasks.filter(t => isActive(t)))/>
<visible:Task[]=(match @filter {
    .All    :> @tasks,
    .Active :> @active,
    .Done   :> @tasks.filter(t => !isActive(t)),
})/>
<left:int=(@active.length)/>
```

`<tasks:Task[free, append, write, replace]=[]/>` declares a reactive cell holding a **tape** (scrml's one sequence kind; there are no JavaScript arrays), and `@tasks` reads or writes it. Because it sits inside `<channel>`, every write reaches every open tab, and the rest of the program can still read it. The compiler emits the WebSocket route and the client that keeps the copies in step; you wrote a tape.

The tape's type lists every write the app makes, and nothing else compiles. `addRow` appends (`append`, with the `.append` method; JavaScript's `push` is refused), `replaceRow` overwrites a position through `map` (`write`), and `load()` replaces the whole tape (`replace`). `free` says its length may change. A tape with no grants is immutable.

`let <filter:Filter=.All/>` is a writable cell: `let`, before the `<`, is what makes it writable. `<entry:struct>` is a declaration with one validated field and the markup it renders. `req length(>=1)` becomes `required minlength="1"` on the emitted `<input>`, so the browser won't submit an empty task.

`<active>`, `<visible>` and `<left>` have no `let`, so they are locked, and their initializers read other cells, so they are derived: they recompute when `@filter` or `@tasks` change. The `match` is checked for exhaustiveness. Delete the `.Done` arm and the compile fails.

### 3 — behaviour, and errors as states

<!-- snippet: docs/readme-snippets/tasks.scrml#L83-L104 -->
```scrml
type Phase:enum = { Loading, Editing, Saving, Saved, Rejected(msg: string) }

function load() {
    @tasks = loadTasks() !{ _ :> { @phase = Phase.Rejected("Could not load the list."); return; }, };
    @phase = .Editing;
}

function submit() {
    @phase = .Saving;
    let row: Task = insertTask(@entry.text) !{
        .Duplicate :> { @phase = Phase.Rejected("That task is already on the list."); return; },
        _          :> { @phase = Phase.Rejected("Could not save the task."); return; },
    };
    addRow(row);
    reset(@entry.text);
    @phase = .Saved;
}

function toggle(id: int) {
    let row: Task = flipTask(id) !{ _ :> { return; }, };
    replaceRow(row);
}
```

`insertTask` runs on the server, and `submit` calls it like a local function. The `!{}` block after the call handles its failure: each arm routes a failure into a `Phase` state, and the arms are a comma-separated list. A call from the browser can also fail in transit, so the handler must cover that too (here the `_` arm does); a missing arm is a compile error. The failure lives in the type, not in an `isError` flag. Statements end with `;`.

### 4 — the screen is a state machine

<!-- snippet: docs/readme-snippets/tasks.scrml#L106-L142 -->
```scrml
<phase:Phase=.Loading single effect=${ load(); }>
    <Loading  rule=(.Editing | .Rejected)/>
    <Editing  rule=.Saving/>
    <Saving   rule=(.Saved | .Rejected)/>
    <Saved    rule=(.Editing | .Saving)>
        <onTimeout after=1.5s to=.Editing/>
    </>
    <Rejected rule=.Saving/>
</>

#{
    .done { text-decoration: line-through; opacity: 0.6; }
    .on   { font-weight: bold; }
    .err  { color: #b91c1c; }
}
<*entry/>

<nav>
    <button onclick={ @filter = .All; }    class:on=(@filter == .All)>All</button>
    <button onclick={ @filter = .Active; } class:on=(@filter == .Active)>Active</button>
    <button onclick={ @filter = .Done; }   class:on=(@filter == .Done)>Done</button>
</nav>

<ul>
    <each in=@visible as t key=t.id>
        <li class:done=(!isActive(t)) onclick=toggle(t.id)>${t.text}</li>
        <empty><li>Nothing here.</li></empty>
    </each>
</ul>

<match for=Phase on=@phase>
    <Loading><p>Loading…</p></Loading>
    <Editing><p>${@left} left</p></Editing>
    <Saving><p>Saving…</p></Saving>
    <Saved><p>Saved.</p></Saved>
    <Rejected(msg)><p class="err">${msg}</p></Rejected>
</match>
```

`<phase:Phase=.Loading single>` is an engine: a declaration marked `single`, whose value carries a transition graph. Each state-child's `rule=` lists the states it may move to, and a write that doesn't follow an edge is refused. `effect=` runs once when the program starts, and loads the list; if the load fails, the status line says so. `<onTimeout>` moves "Saved." back to the task count after 1.5 seconds, with no `setTimeout` in the source. The `<match>` renders one block of UI per variant and is checked for exhaustiveness, so you can't ship a state that has no UI. `<each>` renders the tape and reconciles it by `key=` as `@visible` changes, and `<empty>` covers the empty case. The `#{ }` style block sits just before the markup it styles.

### run it

```bash
bun run boot:dev docs/readme-snippets/tasks.scrml   # compile, serve on http://127.0.0.1:3000/, recompile + reload on save
```

Today the bootstrap refuses this file and names each missing feature (the list at the top of this section); it does not half-build it. Once those land: open it in two tabs, add a task in one and it appears in the other, add the same task twice and the status line says so, and click a task to mark it done.

### what you wrote vs. what the compiler wrote

You wrote a schema, three database functions, some state, three handlers and a state machine. The compiler writes **the route handlers, the `fetch` calls, the CSRF token handling, the parameterized queries, the serialization, the WebSocket endpoint and the sync client, the HTML validation attributes, the table migration, and the exhaustiveness checks.** That's the pitch: you declare the shape, the compiler builds the machine.

> The deep version of each of those (the inference rules, the error codes, the trade-offs) is in **[NERDME.md](./NERDME.md)**.

---

## Why scrml

**State is the declaration primitive.** `let <count:int=0/>` declares a writable reactive cell; `@count` reads or writes it. (The older dialect spelled it `<count> = 0`; see [item 1 below](#what-changed-from-the-older-dialect).) Compound, derived (`<total:int=(@a + @b)/>`, a locked declaration whose initializer reads cells), input-bound and validated cells are the same primitive with different attributes. The compiler tracks the dependency graph and updates the DOM on change.

**Engines are the centerpiece.** When state goes from "a few booleans" to "this app has phases," you promote it up a [tier ladder](docs/readme/tier-ladder.md) without rewriting the markup tree: `if=` chains, then `<match for=Type>`, then an engine: a `single` declaration whose state-children carry `rule=`. The engine declares the legal transitions and runs effects, and the `<match>` that renders it refuses to compile while any variant lacks a UI block.

**Full-stack in one file.** Markup, logic, styles, SQL, server functions, error handling and realtime channels all go in `.scrml`. The compiler works out what runs on the server and splits the file. There are no route files and no API layer to drift out of sync.

**Errors are states, not exceptions.** Inside logic, `try`/`catch`/`throw` are compile errors, and so are `class` and `async`/`await`. A failable function declares its errors as an enum (`function f()! -> LoadError`), and the `!{}` handler at the call site routes each variant into the right state. A missing arm is a compile error.

**Validators live on the declaration.** `req`, `length(…)`, `pattern(…)` and friends ride on a cell as attributes. On a compound cell they produce a read-only validity surface (`@form.isValid`, per-field `.errors` / `.touched`) that `<errors of=@form.field/>` renders ([example 30](examples/30-validated-form.scrml)), and on an input they become the matching HTML attributes. No separate validation library.

**No npm.** scrml ships its own standard library ([21 modules](docs/FACTS.md)), imported as `scrml:<name>`. An app has no package manager and no dependency tree. (Third-party code still gets in, but through an explicit, named surface, not an auto-resolved graph. You can declare the capabilities it needs; in this version that declaration is advisory, not enforced.)

---

## What changed from the older dialect

<a id="where-the-language-is-going"></a>

scrml is newer than the training data of every current LLM, and the language has moved since its first compiler was written. impl#1, the `scrml` command, is frozen in an **older dialect**: `<count> = 0` cells, `const <x> = …` derived cells, the `<engine>` element, `const Name = <… props={…}>` components, statements ended by newlines, `push` on a list. It does not parse the ruled language, and the bootstrap does not parse the older dialect. Each item below shows the older spelling (not compiled; it is there so you can recognise it) and then the ruled one, a file the gate compiles with the bootstrap. If you meet older material, translate it this way.

When the bootstrap is complete, most older forms go through a deprecation window: they keep compiling, with a warning that names the new form (SPEC §66.21). **A cell holding a tape gets no window.** No tape in scrml is unconstrained, so `<audit>: Entry[] = []` and every other older tape cell is an error, `E-DECL-LEGACY-RHS`, at once (SPEC §66.12.4, §66.21, S469). Older cells holding a scalar or a struct keep the window, with the warning `W-DECL-LEGACY-RHS`. They stay writable until the struct-contract work lands; then the struct cells lose the window too (⚑ O62, ruled "yes, eventually").

The change in one sentence: a declaration is a thing in the tree with typed attributes, a `renders` and instances, and **data is locked unless its type grants the write.**

**1. Declarations, and locked by default** (SPEC §66.19.1)

Older dialect:

<!-- gate: skip — older dialect (impl#1), shown for contrast; it does not parse in the ruled language -->
```scrml
<count> = 0
<step> = 1
const <doubled> = @count * 2
```

Ruled ([file](./docs/readme-snippets/counter.scrml)):

<!-- snippet: docs/readme-snippets/counter.scrml -->
```scrml
// counter.scrml — README "What changed", item 1: declarations, locked by default.
// SPEC §66.19.1. The older dialect wrote this as `<count> = 0` / `const <doubled> = …`.
<program>

let <count:int=0/>
<step=1/>
<doubled:int=(@count * 2)/>

function bump()    { @count = @count + @step; }
function restart() { reset(@count); }

<main>
    <p>Count ${@count} (doubled ${@doubled})</p>
    <button onclick=bump()>+${@step}</button>
    <button onclick=restart()>Reset</button>
</main>

</program>
```

`let <count:int=0/>` is writable: on a scalar cell, `let` is the only thing that makes it so. (A tape's writes are granted by its type instead; see item 4.) `<step=1/>` is a locked constant, and the integer literal infers `int`. `<doubled:int=(@count * 2)/>` is derived: `const <x>` retires, and a derived cell is just a locked declaration whose initializer reads other cells. Each of these is refused:

<!-- gate: skip — fragment: lines the bootstrap refuses, each with its code -->
```scrml
// @step = 2;            → E-WRITE-NOT-GRANTED (`step` is locked; the message says to declare it `let`)
// @doubled = 0;         → E-DERIVED-WRITE (a derived value recomputes; write the cell it reads)
// <let count:int=0/>    → E-DECL-LET-IN-OPENER (`let` goes before the `<`)
```

Words that say what kind of thing a declaration is, `let` and `export`, go before the `<`, in JavaScript's order (`export let <mode:Mode=.Light/>`). Inside the opener stand only the name, the type, the value, typed attributes and flags (SPEC §66.2.5, S447). Declarations end at their own `/>` or `</>` and take no `;` (§66.2.1). Statements take one: `;` ends every statement, and a newline is only whitespace.

**2. Engines become `single` declarations** (SPEC §66.19.6)

Older dialect:

<!-- gate: skip — older dialect (impl#1), shown for contrast; it does not parse in the ruled language -->
```scrml
type Phase:enum = { Idle, Loading, Done, Failed }

<engine for=Phase initial=.Idle>
    <Idle    rule=.Loading : "Ready">
    <Loading rule=(.Done | .Failed) : "Loading…">
    <Done    rule=.Idle : "Done">
    <Failed  rule=(.Loading | .Idle) : "Failed — retry?">
</>
```

Ruled ([file](./docs/readme-snippets/engine.scrml)):

<!-- snippet: docs/readme-snippets/engine.scrml -->
```scrml
// engine.scrml — README "What changed", item 2: an engine is a `single` declaration.
// SPEC §66.19.6. The older dialect wrote it as `<engine for=Phase initial=.Idle>`.
<program>

type Phase:enum = { Idle, Loading, Done, Failed }

<phase:Phase=.Idle single>
    <Idle    rule=.Loading : "Ready">
    <Loading rule=(.Done | .Failed) : "Loading…">
    <Done    rule=.Idle : "Done">
    <Failed  rule=(.Loading | .Idle) : "Failed — retry?">
</>

function load() { @phase = .Loading; }

<main>
    <p><*phase/></p>
    <button onclick=load()>Load</button>
</main>

</program>
```

The engine stops being its own element. It is a declaration marked `single`, and its name is its variable (`@phase`). The same transition graph can sit on a field of a multi-instance declaration, so every card on a page can carry its own `status` machine. It renders with `<*phase/>` ("the existing one"); a plain `<phase/>` of a `single` declaration is an error, `E-DECL-SINGLE-INSTANTIATED`. (The state-child marker and its `:` body are still ⚑ O52, an open detail in the SPEC.)

**3. Components become declarations with a `renders`** (SPEC §66.19.4, §66.15)

Older dialect:

<!-- gate: skip — older dialect (impl#1), shown for contrast; it does not parse in the ruled language -->
```scrml
const Swatch = <span class="chip" props={ label: string, hex: string }>
    <i style="background:${hex}"></i> ${label}
</span>

<main>
    <Swatch label="Brand" hex="#338967"/>
    <Swatch label="Warn" hex="#FF6600"/>
</main>
```

Ruled ([file](./docs/readme-snippets/component.scrml)):

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED] — the bootstrap has no ${…} inside a quoted attribute (a reactive template, §5.5.3) and cannot render a named shared instance (<*accent/>) yet -->
<!-- snippet: docs/readme-snippets/component.scrml -->
```scrml
// component.scrml — README "What changed", item 3: a component is a declaration with a `renders`.
// SPEC §66.19.4. The older dialect wrote it as `const Swatch = <span props={…}>`.
<program>

<brand="#338967"/>

<swatch:struct>
    let <label:string="Brand"/>
    let <hex:string=@brand/>
</>
renders <span class="chip"><i style="background:${hex}"></i> ${label}</span>

<accent:swatch label="Accent" hex=@brand/>
<warn:swatch label="Warn" hex="#FF6600"/>

<main>
    <*accent/>
    <*warn/>
    <swatch label="Danger" hex="#dc2626"/>
</main>

</program>
```

A component is a declaration with typed attributes and a `renders`. An attribute is always locked data, so a field the component writes is a child declaration with `let` before its `<`. The opener then says `:struct`, because no typed attribute is left in it (SPEC §66.19.4, S447). `let` plus a reactive initializer (`hex=@brand`) makes a **seeded** field: it starts from `@brand` and can then be written. A plain `<swatch label="Danger" hex="#dc2626"/>` makes a fresh instance; `<accent:swatch …/>` declares a named shared instance, and `<*accent/>` renders that one instance, wherever it is used.

**4. Tapes carry their permissions** (SPEC §66.19.5, §66.12; grant tokens and bracket form ruled, O10 at S442 + S469)

scrml has one sequence kind, the **tape**, and no JavaScript-style arrays. The older dialect let any write reach a list cell, so nothing stopped an audit log from being wiped:

<!-- gate: skip — older dialect (impl#1), shown for contrast; in the ruled language the cell line is E-DECL-LEGACY-RHS -->
```scrml
type Entry:struct = { at: number, actor: string, action: string }

<audit>: Entry[] = []
<actor> = "ops"

function record(action: string) {
    @audit = [...@audit, { at: Date.now(), actor: @actor, action: action }]
}
function wipe() { @audit = [] }
```

Ruled ([file](./docs/readme-snippets/audit-log.scrml)):

<!-- snippet: docs/readme-snippets/audit-log.scrml -->
```scrml
// audit-log.scrml — README "What changed", item 4: a tape carries its permissions.
// SPEC §66.19.5. The older dialect wrote `<audit>: Entry[] = []`, which took any write.
<program>

type Entry:struct = { at: number, actor: string, action: string }

<audit:Entry[free, append]=[]/>
let <actor:string="ops"/>

function record(action: string) {
    @audit.append({ at: Date.now(), actor: @actor, action: action });
}

<main>
    <input bind:value=@actor/>
    <button onclick=record("login")>Log in</button>
    <ul>
        <each in=@audit as e>
            <li>${e.actor}: ${e.action}</li>
        </each>
    </ul>
</main>

</program>
```

<!-- gate: skip — fragment: lines the bootstrap refuses, each with its code -->
```scrml
// @audit.push(e);                → E-TAPE-JS-METHOD (JS names are refused; write `@audit.append(e)`)
// @audit = [];                   → E-WRITE-NOT-GRANTED (a replace; the type grants none)
// @audit.shift();                → E-WRITE-NOT-GRANTED (shrinks at the front)
// @audit[0].action = "edited";   → E-WRITE-NOT-GRANTED (a field edit of `action`, and Entry.action is fixed)
```

The type grants the log free length and growth at the end, and nothing else. `wipe()` cannot be written, and no statement anywhere in the program can remove or rewrite an entry. An entry can't be rewritten because `Entry`'s fields carry no contract, so they are fixed (S440 dpa-052 Q3). A stack grants both halves at the end: `Frame[free, append, pop]`. The full grant vocabulary (O10, S469): `free` (the length may change), `append` / `pop` (end), `prepend` / `shift` (front), `insert` / `remove` (anywhere), `write` (a position may be overwritten) and `replace` (the whole tape may be reassigned).

**Tape methods are named after their grants** (SPEC §66.12.6, S469). `.append(x)` / `.pop()` work at the end, `.prepend(x)` / `.shift()` at the front, and `.insert(i, x)` / `.remove(i)` anywhere, each only when the type grants it. Reading `Entry[free, append]` tells you that `.append` is the one method that works. JavaScript's `push`, `unshift` and `splice` are refused, with a fix-it naming the scrml method. `sort`, `reverse`, `fill` and `copyWithin` don't mutate: each returns a new tape, so `@xs = @xs.sort();` is a position write, granted by `write`.

**No position escapes the grants** (SPEC §66.12.6, S469). A tape is immutable unless its type grants the write, wherever it is held: a cell, a struct field, a tuple position, a local, a parameter or a return value. Inference never invents a grant, so `let xs = [];` is immutable. To mutate a local, write its grants in its type: `let out: Item[free, append] = [];`. `let` on a local only makes the name rebindable and grants the tape nothing, not even a replace. A tape that arrives from host JS carries no grants until you give it a tape type, and a tape you hand to host JS crosses as a frozen view or a copy, so host code can't write it behind its grants. Spread-rebuild (`@audit = [...@audit, e];`), a `filter` written back, a whole-struct write that replaces a tape field, index writes and `length =` are all classified as edits and checked against the same grants. No spelling gets a write the type refuses.

**5. Operators take numbers, conditions take booleans** (S440 / S442 / S469 rulings)

The older dialect compiled all of this, and `@total` was the string `"11"` after one click:

<!-- gate: skip — older dialect (impl#1), shown for contrast; each line is refused in the ruled language -->
```scrml
<count> = 0
<label> = "items: "

const <shown> = @label + @count
const <total> = @count + "1"

<p if=@count>${@shown} ${@total}</p>
```

Ruled: *"arithmetic and relational operators take NUMBERS only; `+` takes two numbers or two strings"*, *"`!`, `&&`, `||` (and `and`/`or`) take booleans only"*, and *"a `T | not` operand must be narrowed before `+`, arithmetic, comparison, or use in a template."* Both `+` lines are `E-OPERATOR-OPERAND-TYPE`, and `if=@count` on a number is `E-COND-NOT-BOOLEAN`: a condition takes a boolean or a presence test. Text is built with a template, never with `+` across types: `${@label}${@count}` in markup, or a backtick template in logic. `==` compares two values of the same type only (`E-EQ-001` otherwise; `int` and `number` count as one kind), so an enum is compared with a variant, `@color == .Red`, never a string. Text becomes a number only through a parse that can fail, `int.parse(s)`, which is `int | not`.

Ruled ([file](./docs/readme-snippets/operators.scrml)):

<!-- snippet: docs/readme-snippets/operators.scrml -->
```scrml
// operators.scrml — README "What changed", item 5: operators take numbers, conditions take booleans.
// The older dialect accepted `@label + @count`, `@count + "1"` and `if=@count`.
<program>

let <count:int=0/>
<label="items: "/>

<next:int=(@count + 1)/>

<main>
    <button onclick={ @count = @count + 1; }>Add</button>
    <p if=(@count > 0)>${@label}${@count} (next: ${@next})</p>
</main>

</program>
```

### Using the bootstrap compiler

The bootstrap compiler speaks the ruled language. It compiles §66 declarations (`let` / locked / derived), tapes with explicit grants, `single` engines, components with `renders`, the operator and condition rules, `match` on a value with comma-separated arms, and the one `for` loop. It refuses an ungranted tape write with `E-WRITE-NOT-GRANTED`. A form it does not build yet is refused with `E-BOOTSTRAP-UNSUPPORTED`; it is never silently accepted. It compiles `#{}` style blocks too — program-global rules, a component's scoped `@scope` rules, a bare-declaration block on a component's root (its `style=`), and `@cell` values in CSS (a cell's value is written only if it is a number or a plain CSS value; gradients, transforms, quoted font names and `url()` are refused) — but not `@media`, `@keyframes` or any other at-rule block inside one, nor `<theme>`. Not in yet: `<schema>`, `<channel>`, the `<match>` element, `class:` bindings, `<empty>`, `<onTimeout>`, an engine opener `effect=`, replacing a whole tape, building a payload variant as a value, a `${…}` inside a quoted attribute, editing a local tape, rendering a named shared instance (`<*accent/>`), and auth. Run it from a clone:

```bash
bun run boot:compile app.scrml              # → dist/app/ : index.html, program.client.js, scrml-runtime.js
bun run boot:compile app.scrml -o out/      # choose the output directory
bun run boot:dev app.scrml                  # compile, serve on http://127.0.0.1:3000/, recompile + reload on save
bun scripts/scrml-boot.ts --help            # the same commands, called directly (scrml-boot)
```

Diagnostics print as `error [CODE]: message` with `--> file:line:col`, and the exit status is 1 on any error. `--format line` prints `file:line:col: error [CODE]: message`, one line each, for an editor's quickfix list. The page loads ES modules, so open it over http (`boot:dev`), not as a `file://`. The first run builds the bootstrap with impl#1 (~10 s), and later runs load it from a cache in `~/.cache/scrml/boot-bundle/` (~0.2 s). The cache rebuilds whenever `compiler/self-host-v2/` or `compiler/src/` changes. The first acceptance programs are in [`compiler/self-host-v2/slice-m4/src/acceptance/`](compiler/self-host-v2/slice-m4/src/acceptance/).

---

## Quick start

scrml is not on npm. You run it from a clone.

```bash
# Install Bun if you don't have it — https://bun.sh
curl -fsSL https://bun.sh/install | bash

# Get the compilers and their dependencies
git clone https://github.com/scrml-lang/scrml.git
cd scrml
bun install

# Compile and serve a ruled-dialect file with the bootstrap
bun run boot:dev docs/readme-snippets/counter.scrml
```

(The `scrml` command — `scrml init`, `scrml dev`, `scrml compile`, `scrml db-migrate` — is impl#1, and compiles the older dialect only.)

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
