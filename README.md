# scrml

*/ˈskrɪmɛl/*

**A complete compiler for the web.** Markup, reactive state, scoped CSS, SQL, server functions, realtime, and tests in one `.scrml` file — the compiler reads it and does the wiring. No virtual DOM, no JSX, no `node_modules`, no API layer to drift out of sync.

```bash
scrml compile app.scrml -o dist/
```

You declare the shape of the app; the compiler builds the machine.

> **This README demonstrates the *language*, not the *current compiler*.** The code shown here is **nominal** — the language as designed, the shape the compiler is actively converging on. Some snippets may not compile clean against any given commit. See [`docs/known-gaps.md`](./docs/known-gaps.md) for per-feature spec-vs-impl drift and [`docs/changelog.md`](./docs/changelog.md) for what landed recently. The spec is in [`compiler/SPEC.md`](compiler/SPEC.md); the surface lives in [`compiler/SPEC-INDEX.md`](compiler/SPEC-INDEX.md).

## Today's Tasks — a full app in three stages

Here is one app — list, add, complete, filter, save — built from a 40-line prototype into a multi-device, server-backed, state-machine-driven thing **without rewriting the markup tree.** Each stage is the previous one plus a few lines.

### Stage 1 — the prototype

You have an idea. Get something on screen.

```scrml
<program>

<tasks> = [
    { id: 1, text: "Buy milk",      done: false },
    { id: 2, text: "Walk the dog",  done: true  },
    { id: 3, text: "Write README",  done: false }
]
<newTask> = ""

${
    function addTask() {
        if (@newTask.length == 0) return
        @tasks = [...@tasks, { id: @tasks.length + 1, text: @newTask, done: false }]
        reset(@newTask)
    }

    function toggle(id) {
        @tasks = @tasks.map(t => t.id == id ? { ...t, done: !t.done } : t)
    }
}

<h1>Today's Tasks</h1>

<form onsubmit=addTask()>
    <input bind:value=@newTask placeholder="What needs doing?"/>
    <button>Add</button>
</form>

<ul>
    ${ for (let t of @tasks) {
         lift <li>
             <input type="checkbox" checked=t.done onchange=${toggle(t.id)}/>
             ${t.text}
         </li>
       }
    }
</ul>

</>
```

- `<tasks> = [...]` declares a reactive cell. Mutating it (assignment, `.map`, push-then-assign) re-renders the list with no virtual DOM.
- `@newTask` is how you read or write a reactive cell from inside an expression. Bare names (`t`, `id`) are plain locals.
- `reset(@newTask)` returns the cell to its declared init value (the empty string).
- `${ for (t of @tasks) { lift <li>...</li> } }` is the prototype iteration form — every `lift` puts the resulting markup back into the surrounding `<ul>`.

The compiler will lint that loop: *"You're iterating reactive state — try `<each>`."* That's the path to Stage 2.

### Stage 2 — the exhaustive filter

Now filter (All / Active / Done). You could add `<activeOnly> = false`, but the moment you add a fourth mode the flag-per-mode shape breaks. Use an enum — the compiler refuses if you forget a variant.

```scrml
<program>

${
    type Filter:enum = { All, Active, Done }

    <tasks> = [
        { id: 1, text: "Buy milk",      done: false },
        { id: 2, text: "Walk the dog",  done: true  },
        { id: 3, text: "Write README",  done: false }
    ]
    <newTask req length(>=1)> = <input placeholder="What needs doing?"/>
    <filter>: Filter = .All

    const <visible> = match @filter {
        .All    :> @tasks
        .Active :> @tasks.filter(t => !t.done)
        .Done   :> @tasks.filter(t => t.done)
    }

    function addTask() {
        @tasks = [...@tasks, { id: @tasks.length + 1, text: @newTask, done: false }]
        reset(@newTask)
    }

    function toggle(id) {
        @tasks = @tasks.map(t => t.id == id ? { ...t, done: !t.done } : t)
    }
}

<h1>Today's Tasks</h1>

<form onsubmit=addTask()>
    <newTask/>
    <errors of=@newTask/>
    <button>Add</button>
</form>

<nav>
    <button onclick=${@filter = .All}    class:active=${@filter == .All}>All</button>
    <button onclick=${@filter = .Active} class:active=${@filter == .Active}>Active</button>
    <button onclick=${@filter = .Done}   class:active=${@filter == .Done}>Done</button>
</nav>

<each in=@visible key=@.id>
    <li class:done=${@.done}>
        <input type="checkbox" checked=${@.done} onchange=${toggle(@.id)}/>
        ${@.text}
    </li>
    <empty>Nothing left.</>
</each>

</>
```

What just landed:

- **`<newTask req length(>=1)> = <input/>`** declares the cell, its render spec, and its validators in one line. `<newTask/>` in the markup expands to the bound input element — no `bind:value=@newTask` needed; the cell *is* the input. `@newTask.isValid` / `.errors` / `.touched` are auto-synthesized read-only cells. `<errors of=@newTask/>` renders them at the right time.
- **`const <visible> = match @filter {...}`** is a derived cell. The compiler recomputes it when `@filter` or `@tasks` changes. It's exhaustive: leaving out `.Done` is `E-MATCH-NOT-EXHAUSTIVE`. Add a fourth filter variant later and the compiler tells you every site that needs updating.
- **`<each in=@visible key=@.id>`** is the structural iteration form — keyed DOM reconciliation, `@.` is the current item, `<empty>` is the zero-items state. The Stage 1 `${for / lift}` form still compiles fine; `<each>` is the structural commitment.

### A note from the dev

This document describes the ***nominal*** language at the time of any version release. It does not describe what the compiler is perfectly capable of doing. I am working full-bore to get the compiler as close to the nominal state as possible. I am just one guy.

If you are here (and reading this). Hello, My name is Bryan MacLee. I am co-owner of a small trucking company in rural Ut. I run the business, drive, mechanic, apparently I'm the HR department. I am also a husband, father and sometimes, a wannabe coder.

This message is from me. I typed it. but ~96% of what you read (99.9% for the actual code) is claude "written". (I dont care about the exact brand as long as I have a tool that will get the job done.) I do my best to skim, and review as much as I can. But (see the prior list). If you find this interesting, continue reading. if you find something doesn't quite add up (or some straight up bullshit). let me know.

This is my third round with the ai and coding. the first two were pretty underwhelming. This time around I wasn't expecting much but I thought "the hell with it" and I tried out claude. I was fudging impressed.

I had been working with these ideas (in one way or another) for a long time. Over the course of about 3 years I learned (yes, the old school way, not much different than I am doing right now) how compilers work and how to implement various parts in various methods. programming has always been my favorite activity. the thing that I look forward to all the time (other than hanging with my wife and kids. Of course.)

After my first couple of experiments with claude I realized, I might actually be able to build this language. Dont get me wrong, I absolutely could write this language by hand. I can say that factually. BUT it would absolutely take me 10-20 years to do it. I think the ideas are worth surfacing at least.

AI code is still what it is. 100% mid. But its still all human mid that it is regurget-asemble-ing, If the ideas on top of the impl are good, or at least novel. it doesn't matter if the impl is mid. The ideas still get across. that's all that really matters to me here.

are the ideas any good?

### Stage 3 — the whole stack

Now it's real: SQLite, server-backed, auth-gated, multi-device sync, with a load-state state machine.

```scrml
// gate: skip
// illustrative end-to-end demo — requires a `tasks.db` file + a `Role:enum`
// in scope; the compile-time DB / auth-role checks need a real project context.
<program>

<db src="tasks.db" protect="passwordHash" tables="users"/>

<schema>
    users {
        id:           integer primary key
        email:        text req email
        passwordHash: (not to string)
    }
    tasks {
        id:           integer primary key
        user_id:      integer not null references(users.id)
        text:         text req length(>=1)
        completed_at: (not to timestamp)
    }
</>

${
    type Filter:enum = { All, Active, Done }
    type Phase:enum  = { Loading, Empty, Editing, Saving, Saved, ErrorState(msg: string) }
    type LoadError:enum = { Network(msg: string) }
    type User:struct = { id: number, email: string }

    fn isActive(t) -> boolean {
        return t.completed_at is not
    }

    function loadTasks()! -> LoadError {
        return ?{`SELECT id, text, completed_at FROM tasks WHERE user_id = ${@user.id} ORDER BY id`}.all()
    }

    function createTask(text: string(.length >= 1))! -> LoadError {
        return ?{`INSERT INTO tasks (user_id, text, completed_at) VALUES (${@user.id}, ${text}, ${not}) RETURNING *`}.get()
    }

    function toggle(id) {
        ?{`UPDATE tasks SET completed_at =
            CASE WHEN completed_at IS NULL THEN ${Date.now()} ELSE NULL END
            WHERE id = ${id}`}.run()
    }

    function submit() {
        @phase = .Saving
        createTask(@newTask) !{
            | ::Network msg :> { @phase = .ErrorState(msg); return }
        }
        reset(@newTask)
        @phase = .Saved
    }
}

<user>: User = not        // populated from the session token at boot; see `scrml:auth.verifyJwt` for the canonical flow

<channel name="tasks" topic="user-${@user.id}">
    <tasks> = []
</>

<filter>: Filter = .All
<newTask req length(>=1)> = <input placeholder="What needs doing?"/>

const <visible> = match @filter {
    .All    :> @tasks
    .Active :> @tasks.filter(isActive)
    .Done   :> @tasks.filter(t => !isActive(t))
}

~{
    test "isActive identifies open tasks" {
        assert isActive({ id: 1, text: "open", completed_at: not })
        assert !isActive({ id: 2, text: "done", completed_at: 1706745600000 })
    }
}

<auth role="User">

<engine for=Phase initial=.Loading effect=${
    @tasks = loadTasks() !{
        | ::Network msg :> { @phase = .ErrorState(msg); return }
    }
    @phase = @tasks.length == 0 ? .Empty : .Editing
}>

    <Loading rule=(.Empty | .Editing | .ErrorState)>
        Loading your tasks…
    </>

    <Empty rule=.Saving>
        <p>No tasks yet. Add your first.</p>
        <form onsubmit=submit()>
            <newTask/>
            <errors of=@newTask/>
            <button>Add</button>
        </form>
    </>

    <Editing rule=.Saving>
        <form onsubmit=submit()>
            <newTask/>
            <errors of=@newTask/>
            <button>Add</button>
        </form>

        <nav>
            <button onclick=${@filter = .All}    class:active=${@filter == .All}>All</button>
            <button onclick=${@filter = .Active} class:active=${@filter == .Active}>Active</button>
            <button onclick=${@filter = .Done}   class:active=${@filter == .Done}>Done</button>
        </nav>

        <each in=@visible key=@.id>
            <li class:done=${@.completed_at is some}>
                <input type="checkbox"
                       checked=${@.completed_at is some}
                       onchange=${toggle(@.id)}/>
                ${@.text}
            </li>
            <empty>Nothing left.</>
        </each>
    </>

    <Saving rule=(.Saved | .ErrorState)>
        Saving…
    </>

    <Saved rule=.Editing>
        Saved.
        <onTimeout after=1.5s to=.Editing/>
    </>

    <ErrorState msg rule=.Loading>
        <div class="err">${msg}</div>
        <button onclick=${@phase = .Loading}>Retry</button>
    </>

</>

</auth>

</>
```

What the compiler did that you did NOT write:

- **Route handlers** for `loadTasks` / `createTask` / `toggle`. They touch SQL, so the compiler classified them server-side — and generated the routes, the client-side `fetch` calls, the CSRF tokens, parameterized queries, and serialization. You call them like local functions because in your source they ARE.
- **The schema → DDL pipeline.** The `<schema>` block becomes both the `CREATE TABLE` statement on first run AND a diff on every subsequent compile. New columns? Migration emitted. Removed columns? Surfaced for review.
- **Field-level data isolation.** `<db src="tasks.db" protect="passwordHash" tables="users">` tells the compiler that `passwordHash` is server-only — the compiler strips the field from the type the client sees, so server-fn responses that include a user row exclude the field, and reading `@user.passwordHash` on the client is a compile error (`E-PROTECT-001`).
- **The WebSocket plumbing.** `<channel name="tasks" topic="user-${@user.id}">` emits the Bun upgrade route, a client-side reconnect manager, and pub/sub routing. State declared inside the channel body (`<tasks> = []`) auto-syncs across every connected device subscribed to the same topic.
- **Per-role chunk splitting.** `<auth role="User">` tells the compiler that anonymous visitors will never reach this subtree. They get a strictly smaller initial bundle — the components and server functions inside the gate aren't downloaded for them at all. The project's auth flow populates `<user>` from the session token at boot (the canonical recipe lives at `scrml:auth.verifyJwt` — see §11.2); the server functions inside the gate reference `@user.id` directly because by the time they run, the gate's role predicate has matched.
- **The validity surface.** `<newTask req length(>=1)> = <input/>` produces `@newTask.isValid` / `.errors` / `.touched` as reactive read-only cells. `<errors of=@newTask/>` renders them at the right time. The SAME predicates fire on the server boundary, in the HTML form attributes the compiler emits (`required minlength="1"`), and in the database CHECK constraints.
- **The lifecycle gate.** `completed_at: (not to timestamp)` means the column starts unset and transitions when a value is written. Reads of `t.completed_at` are checked per-access — before the row has been completed, the read is `not`, and the compiler refuses to treat it as a timestamp. The compiler tracks the transition state symbolically. Zero runtime cost.
- **The engine's exhaustiveness check.** Adding a seventh variant to `Phase` forces the compiler to demand a UI block + a transition source for it. You cannot ship a state with no UI.
- **The `~{}` inline test.** `~{ test "..." { assert ... } }` is a first-class context next to the code it verifies. The test runs against the live compile in dev; the entire `~{}` block is stripped from production builds, so the production bundle never sees the test code. Pure `fn` helpers (like `isActive` above) are the most natural targets — no mocks needed, no test harness to wire up.

That's the centerpiece. The rest of this README is the surface around it.

---

## The tier ladder

The Stage-1 → Stage-2 → Stage-3 progression above maps onto a three-tier ladder. You start as a rough prototype and add structure as the design hardens — without rewriting the markup tree. State-children carry forward verbatim between tiers; the wrapper swap is the commitment moment.

| Tier  | Form                                       | What you get                                                           |
|-------|--------------------------------------------|------------------------------------------------------------------------|
| **0** | `if=` chains / `${ if (...) lift ... }`    | prototype — no exhaustiveness check                                    |
| **1** | `<match for=Type [on=expr]>` + `<each>`    | structural exhaustiveness check at compile time; `rule=` is accepted + compiler-checked but inert at runtime (the lint nudges promotion to Tier 2) |
| **2** | `<engine for=Type initial=.Variant>`       | full deal — exhaustiveness + active transition rules (`rule=`) + per-state effect handlers (`<onTransition>`, `<onTimeout>`, `<onIdle>`) + composite hierarchy + `history` restore |

The Engine surface beyond Stage 3 — composite state-children with nested engines, the `history` attribute that restores prior inner state on re-entry, `<onTimeout after=2s to=.Variant>` for per-state timeouts (with named timers + `cancelTimer("name")` builtin), `<onIdle>` for engine-wide event-timeout watchdogs, `internal:rule=` for transitions that don't exit/re-enter the composite — lives at [`examples/14-mario-state-machine.scrml`](examples/14-mario-state-machine.scrml) and [SPEC §51](compiler/SPEC.md).

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

scrml runs TodoMVC at **15.8 KB total gzip / 0 dependencies** against React 19 / Svelte 5 / Vue 3; partial-update is faster than Vanilla; build time is ~10-14× faster than Vite. Full numbers, methodology, and historical baselines live at [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md).

## Features

### State and Reactivity

- **Reactive state.** `<count> = 0` declares a reactive cell; `@count` reads or writes it. Declarations use the structural `<x>` form; reads and writes use the `@x` form. The two are visually distinguishable so a reader can scan any function body and count how many state cells it touches. Bare names in expressions are plain locals — they don't resolve to reactive state (locals cannot shadow registered state names; `E-NAME-COLLIDES-STATE`). The declaration/write distinction is enforced — bare `@x = expr` at body-top of a `<program>` / `<page>` / `<channel>` fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`: declarations use structural `<x>`, writes go inside `${...}` functions.
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
// gate: skip
// illustrative fragments (no <program> wrapper; not standalone-runnable)
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
// gate: skip
// illustrative; shows the three call-sites against one struct type
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

### The Build Story

> *Nominal — scrml's compiler model as designed. Specified in [SPEC §58](compiler/SPEC.md); compiler implementation pending. `*` marks a claim not yet actual.*

scrml's compiler has a build story. Compilation is a pure function of two inputs — your source and an explicit, committed **build story** that pins what "the compiler" is: a content-addressed Merkle closure over the compiler-proper's four components — compiler source, language tools, the standard library, and any vendored edge code — one root hash with the dependency edges between them *inside* the hash, plus a human-inspectable `build-story.lock` sidecar. Because every part — the compiler included — is identified by the hash of its content, customizing the compiler to your project and reproducing any build bit-for-bit\* stop being in tension: a tuned compiler is just a different pinned build story, and "pinned" is what makes it portable.

A build story can be pinned per `<program>` — `<program story="…">`\* — and because nested `<program>` contexts are already isolated, shared-nothing compilation units, different parts of one application can be built by different compilers, each independently reproducible. This is deliberately not a live or hot-swappable compiler: every build story is static, read once before parsing begins; only *authorship* is customizable, never the running compile.

<sub>\* The bit-for-bit guarantee requires a whole-compiler determinism audit not yet done. The build-story artifact and the `<program story=>` attribute are specified in SPEC §58 but not yet implemented in the compiler.</sub>

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
- **Shared reactive state inside channels.** State declared inside a `<channel>` block (`<messages> = []`) auto-syncs across every connected client. No `@shared` modifier — being inside the channel body is the signal. Writing in one tab updates every other tab subscribed to the same topic; the sync wire format is compiler-generated.
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

scrml ships a Model Context Protocol surface so an LLM agent can read your running scrml app's structure first-hand instead of guessing. The compiler emits descriptor sidecars (`engines.json`, `forms.json`, `channels.json`, `serverfns.json`) at build time, and the `scrml:mcp` stdlib exposes them over MCP stdio as 11 read-only tools:

| Tool | Surfaces |
|---|---|
| `get_app_topology` | the whole `<program>` tree shape |
| `list_engines` / `get_engine` | engine state machines + current variant + legal transitions |
| `list_forms` / `get_form_status` | form validity surfaces + per-field touched / errors |
| `list_routes` / `get_route_chunks` | route table + which chunks each route loads |
| `list_server_functions` | enumerable server-fn surface (V0 read-only — `dispatchable: false`) |
| `list_channels` / `get_channel_state` | active WebSocket channels + shared state |
| `get_reachable_server_fns` | per-route reachable server-fn closure |

The strategic frame: the same structural exhaustiveness that makes a scrml app provable to a compiler — engines as exhaustive state machines, typed enums, structural state access, explicit `rule=` contracts, whole-program inference — makes it introspectable to an agent. Other frameworks reach for LLM-friendliness at the tools layer; scrml gets it at the language layer.

V0 is read-only metadata. A future V1 would add server-fn dispatch behind a capability gate.

### Recently Landed Quality Wins

A short selection of silent-failure classes closed in v0.6.x:

- **Precedence-preserving binary emission** — grouped expressions like `(2+3)*4` no longer drop the grouping parens during codegen (Bug W).
- **`not` keyword no longer corrupts regex literals** — the lowering pass skips regex bodies + comments + string interiors (GITI-017; silent-corruption class closed).
- **Runtime chunker tree-shake fix** — `_scrml_destroy_scope` declaratively pulls in its timer + animation helpers; no more orphan-helper class (6nz-P).
- **Default-logic body-top writes surface loudly** — bare `@x = expr` at `<program>` body top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT` instead of silently no-op'ing (Bug Q via S123 Unit CC).

The compiler is actively hardening; see [`docs/changelog.md`](./docs/changelog.md) for the full landing log.

## Language Contexts

scrml uses sigil-delimited contexts to separate concerns within a single file:

| Context | Sigil | Purpose |
|---------|-------|---------|
| Program | `<program>` | App root — database, protection, config |
| Markup  | `<tag>` | HTML elements + scrml structural elements (`<engine>`, `<match>`, `<channel>`, `<schema>`, `<errors>`, `<onTransition>`, `<onTimeout>`, `<onIdle>`, `<auth>`, `<page>`) + state decls (`<name> = init`) — all live in the markup tree |
| Logic   | `${}` | JavaScript expressions and functions |
| SQL     | `?{}` | Database queries (Bun.SQL tagged-template; SQLite shipping, Postgres in progress); auto-batched N+1 + envelope |
| CSS     | `#{}` | Scoped styles |
| Error   | `!{}` | Typed error handling (failable `!{ \| ::V :> ... }` arms) |
| Meta    | `^{}` | Compile-time (or runtime) code generation |
| Test    | `~{}` | Inline tests + `test-bind` server-fn mocks (stripped from production) |
| Foreign | `_{}` | Inline foreign code *(specced, not yet implemented)* |

## Known limitations and gaps

scrml is actively converging on its spec. A few features are designed but not yet implemented; a few are implemented with known issues; the rest is live. Full per-feature drift list (with reproducers + workarounds) lives at [`docs/known-gaps.md`](./docs/known-gaps.md). The headlines:

### Specced but not yet implemented

| Feature | Spec | What it is |
|---------|---|---|
| **Foreign code contexts (`_{}`)** | §23 | Inline non-JS code with level-marked braces (`_{}` / `_={...}=`) — Rust, Python, SQL extensions, etc., passed through to an external toolchain. |
| **WASM call-char sigils** | §23.3 | Single-char sigils (`r{}`, `c{}`, `z{}`) for invoking compiled WASM functions, paired with `extern` declarations. |
| **Sidecar process declarations** | §23.4 | `use foreign:name { fn }` — server-side HTTP/socket sidecar services routed by scrml. |
| **`RemoteData` enum** | §13.5 | Built-in `Loading / Loaded(T) / Failed(Error)` for async fetch state. |
| **Build Story (`<program story=...>`)** | §58 | Content-addressed Merkle closure over the four compiler components + per-`<program>` build identity. |
| **`import:host` self-host bridge** | §21.3.1 | Bounded, manifest-gated import form for self-host bootstrap. |
| **Quoted-text body model compiler fire** | §4.18 | The spec ratifies the code-default body model + `"..."` display-text literal; the compiler fire is queued. |

### Known bugs and partial implementations

| Severity | What | Workaround |
|---|---|---|
| HIGH | **Transitive auto-`await`** — a client function calling a server function isn't always auto-awaited across transitive call chains | Add `async` / `await` explicitly in the client function. Deferred to the A9-class compiler-managed-async work. |
| HIGH | **`<each>` reactive `class:NAME` on reused DOM** — the lift/reconcile path reuses DOM nodes; the reactive class binding doesn't re-evaluate against the new iteration item | Use a static class string inside the loop, or push the reactive class onto a per-item wrapper component. Filed 6nz-V. |
| MED | **Tailwind utility residuals** — a small number of Tailwind utility classes don't fully resolve through the built-in engine | Write the equivalent class explicitly or use the `#{}` scoped CSS form. |
| MED | **MCP V0 partial impl** — V0.A+B+C+D shipped; V0.E (`<program mcp="dev-only">` adopter opt-in + end-to-end docs) lands next release | The compiled MCP surface runs; the adopter opt-in attribute is the last piece. |
| MED | **L19 multi-statement inline event handlers** — inline `onclick={ doA(); doB() }` is rejected (`E-MULTI-STATEMENT-HANDLER`); the relaxation lives behind an open design decision | Name the function: `function startOver() { doA(); doB() }` then `onclick=startOver()`. |
| LOW | **`<each>` `key=` inference fires `W-EACH-KEY-001` even when the iter-var has `.id`** — the type-introspection in the common pipeline path is conservative | Explicit `key=@.id` silences the lint and is the recommended form anyway. |
| LOW | **`bun scrml promote --engine` Tier-1 → 2 deferred** — `--match` works; `--each` is in flight; `--engine` is queued | Manual lift from `<match>` to `<engine>` — the inert `rule=` attributes at Tier 1 are the structural staging, so the lift is mechanical. |

Everything else in this README is implemented and shipping. See [`docs/changelog.md`](./docs/changelog.md) for what landed when.

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
| [15-channel-chat](examples/15-channel-chat.scrml) | `<channel>` realtime, auto-sync channel state |
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

## The compiler

The working compiler for **scrml** — a complete compiler for the web.
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

# Install scrml dependencies
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

## Terms

A short glossary of scrml-specific terms used throughout the README.

- **reactive cell** — state declared with `<name> = init`. Read or written via `@name`; mutating it re-renders the parts of the UI that depend on it. Three RHS shapes — plain (`<x> = 0`), decl-coupled-with-render-spec (`<userName req> = <input/>` — `<userName/>` in the markup IS the bound input), and derived (`const <x> = expr` — read-only, recomputes from dependencies).
- **engine** — Tier-2 state machine declaration: `<engine for=Type initial=.Variant>`. Auto-declares a singleton cell whose value is one of the enum variants; each state-child is one variant's UI block; `rule=` declares legal transitions; `<onTransition>` / `<onTimeout>` / `<onIdle>` attach effects. Centerpiece of the language. Singleton-by-design; components are the multi-instance vehicle. See [SPEC §51](compiler/SPEC.md).
- **match block** — Tier-1 structural form `<match for=Type>` over an enum-typed value. The compiler checks exhaustiveness at compile time: every variant of the discriminating type must have a UI block. `rule=` attributes parse and are checked but are inert at runtime; a lint nudges promotion to Tier 2.
- **lifecycle annotation** — type-position annotation `(A to B)` declaring that a location starts holding type `A` and transitions to type `B`. Reads before transition fire `E-TYPE-001`. Zero runtime cost — the compiler tracks per-access transition state symbolically. Permitted anywhere a type goes except on engine cells (engines already own variant-graph progression via `rule=`). See [SPEC §14.12](compiler/SPEC.md).
- **`<channel>`** — file-level real-time element declaring a WebSocket endpoint. State declared inside the channel body (`<messages> = []`) auto-syncs across every connected client subscribed to the same topic. Compiler emits the Bun upgrade route, a client-side reconnect manager, and pub/sub routing.
- **validity surface** — auto-synthesized read-only cells (`@form.isValid` / `.errors` / `.touched` plus per-field equivalents) produced by declaring a compound cell whose children carry validator attributes (`req`, `length`, `email`, etc.). `<errors of=@field/>` renders them at the right time.
- **per-role chunk** — `<auth role="X">` tells the compiler that only role-`X` visitors will reach the gated subtree. Other roles get a strictly smaller initial bundle. Cross-route prefetching is tiered (idle / hover / on-demand); every chunk filename embeds a content hash so adopter caches stay valid across builds when source bytes don't change.
- **`fn` vs `function`** — `fn` is a compiler-enforced pure function — no SQL, no DOM mutation, no reactive writes, no `fetch`, no `<request>` boundaries. `function` is a general-purpose callable. Use `fn` for predicates, transformations, and deterministic computations.
- **contexts** (`${}` / `?{}` / `#{}` / `!{}` / `~{}` / `^{}` / `_{}`) — sigil-delimited contexts within a `.scrml` file: logic / SQL / scoped CSS / typed error handling / inline tests / compile-time or runtime meta / foreign code. See [Language Contexts](#language-contexts) above for the full table.
- **`not`** — scrml's unified absence value. `null` and `undefined` do not exist in scrml — neither parses, neither runs. Check absence with `is not`; check presence with `is some`. `not` replaces both null and undefined across the language.

## License

MIT — see [LICENSE](./LICENSE).

## Related projects

- **[giti](https://github.com/bryanmaclee/giti)** — a collaboration platform and git alternative designed around scrml's compiler strengths. The CLI (save, switch, merge, undo, history, status, land, init, describe, sync) wraps jj (jujutsu) as the engine until the scrml compiler can do AST-level conflict resolution natively. Long-term vision is a hosted forge; GitHub is the stopgap.
- **[6nz](https://github.com/bryanmaclee/6NZ)** — a purpose-built code editor for the scrml ecosystem. An "Interactive Development Experience" written entirely in scrml, with a focus-centered viewport, NeoVim-superset keybindings plus mouse, CodeMirror 6 + canvas overlay, and offline-first PWA delivery. Currently in design phase, awaiting compiler API exposure in scrml. The companion [Z-motion input spec](https://github.com/bryanmaclee/6NZ/tree/main/z-motion-spec) is released under CC0 so others can adopt it.

## Status

scrml is open source under the [MIT License](./LICENSE) and shipping today — `bun link` and the compile is real. The spec evolves as we find friction; the compiler catches up. See [`docs/changelog.md`](./docs/changelog.md) for what just landed and what's in flight.

The compiler runs on [Bun](https://bun.sh). Compiled output is plain JavaScript that runs in any browser or JavaScript runtime.
