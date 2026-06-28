# scrml

*/ˈskrɪmɛl/*

**A complete compiler for the web.** Markup, reactive state, scoped CSS, SQL, server functions, realtime, and tests in one `.scrml` file — the compiler reads it and does the wiring. No virtual DOM, no JSX, no `node_modules`, no API layer to drift out of sync.

```bash
scrml compile app.scrml -o dist/
```

You declare the shape of the app; the compiler builds the machine.

> **This README demonstrates the *language*, not the *current compiler*.** The code here is **nominal** — the language as designed, the shape the compiler is actively converging on. Some snippets may not compile clean against any given commit. [`docs/known-gaps.md`](./docs/known-gaps.md) tracks per-feature spec-vs-impl drift; [`docs/changelog.md`](./docs/changelog.md) is what landed recently. The deep mechanics behind every feature below live in **[NERDME.md](./NERDME.md)**; the formal truth is [`compiler/SPEC.md`](compiler/SPEC.md).

---

## One app, one file

Here's a real app — a todo list, but the kind you actually ship: SQLite-backed, server-rendered, auth-gated, synced across every device you're signed in on, driven by a load-state machine. It's one `.scrml` file. We'll build it in five pieces, and after each piece, the part that matters: **what the compiler did that you never wrote.**

### 1 — the data

```scrml
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
```

You wrote a schema. The compiler turns it into the `CREATE TABLE` on first run **and** a migration diff on every compile after — add a column, the migration emits itself; drop one, it surfaces for review. `protect="passwordHash"` makes that field server-only: it's stripped from the type the browser ever sees, so a server response carrying a user row simply doesn't include it, and `@user.passwordHash` on the client is a *compile* error. And `completed_at: (not to timestamp)` is a lifecycle gate — the column starts unset and *becomes* a timestamp when written; read it before that and the compiler refuses to treat `not` as a time. All tracked at compile time, zero runtime cost.

### 2 — the server (you won't notice writing it)

```scrml
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
```

You wrote three functions that happen to touch the database — so the compiler classified them server-side and generated everything in between: the route handlers, the client-side `fetch` calls, the CSRF tokens, the parameterized queries, the serialization. You call them like local functions because in your source they *are* local functions. No `/api` folder, no fetch boilerplate, nothing to keep in sync. And errors aren't booleans here: `createTask` fails with a typed `LoadError`, and the `!{}` handler routes the failure straight into a `Phase` state — miss a variant and it won't compile.

### 3 — reactive state, realtime, and a test

```scrml
<user>: User = not        // populated from the session token at boot

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
```

`<tasks> = []` lives *inside* the `<channel>` body, which is the whole trick: that state auto-syncs across every device signed into the same account. The compiler emitted the WebSocket upgrade route, a reconnecting client, and the pub/sub plumbing — you wrote a list. `<newTask req length(>=1)> = <input/>` hands you a reactive validity surface for free (`@newTask.isValid` / `.errors` / `.touched`), and the *same* `length(>=1)` predicate fires in the HTML attribute, on the server, and in the DB constraint. `const <visible>` recomputes whenever `@filter` or `@tasks` change. And that `~{}` test sits right next to the code it checks — it runs against the live compile in dev and is stripped entirely from production.

### 4 — the UI is a state machine

```scrml
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

This is the centerpiece. The `<engine>` is an exhaustive state machine over the `Phase` enum: every variant gets a UI block, `rule=` declares which transitions are legal, and an illegal one — or a *missing* variant block — is a compile error. You literally cannot ship a state with no UI. `effect=` on the opener runs once at boot to load the tasks; `<onTimeout after=1.5s to=.Editing/>` schedules the "Saved" flash without a `setTimeout` in sight. The `<auth role="User">` gate tells the compiler that anonymous visitors never reach this subtree, so they download a strictly smaller bundle — the gated code isn't shipped to them at all. And `<each>` with reactive `class:done` reconciles the list by key as `@visible` changes.

### what you wrote vs. what the compiler wrote

You wrote a schema, four functions, some state, and a state machine. The compiler wrote the **route handlers, fetch calls, CSRF tokens, parameterized queries, serialization, schema migrations, field-level data isolation, the WebSocket upgrade + reconnect + pub/sub, the per-role bundle split, the validity surface, the HTML form attributes, the DB CHECK constraints, and the lifecycle/exhaustiveness proofs** — and stripped the test out of production. That's the whole pitch: you declare the shape, the compiler builds the machine.

> The deep version of every one of those — the inference rules, the error codes, the trade-offs — is in **[NERDME.md](./NERDME.md)**.

---

## Why scrml

**State is the declaration primitive.** `<count> = 0` declares a reactive cell; `@count` reads or writes it. Compound, derived (`const <total> = expr`), server-pinned (`<users server>`), linear, and refinement-typed cells are all the same primitive with different attributes. The compiler tracks the dependency graph and re-renders on change.

**Engines are the centerpiece.** When state goes from "a few booleans" to "this app has phases," you promote up a tier ladder without rewriting the markup tree — `if=` chains, then `<match for=Type>`, then `<engine for=Type>`. The engine declares legal transitions, runs cross-state effects, and enforces that every variant has a UI block.

**Full-stack in one file.** Markup, logic, styles, SQL, server functions, error handling, realtime channels, inline tests — all in `.scrml`. The compiler analyzes the code and splits server from client automatically. No API layer, no route files, no API/UI drift.

**Errors are states, not booleans.** `try`/`catch` isn't in scrml's vocabulary. Failable functions surface errors as enum variants (`fn fetchItems()! -> LoadError`); the `!{}` handler routes each variant into the right state. A missing handler arm is a compile error — the failure modes live in the type, not in `<isError>` boolean rubble.

**Validators auto-synthesize a validity surface.** Compound state with `req` / `length` / other predicates produces reactive read-only `@form.isValid` / `.errors` / `.touched` rollups plus per-field cells; `<errors of=@form/>` renders them at the right time. The same predicate fires three places — state validator, refinement type, schema column. No bilingual schema, no Zod.

**No npm.** scrml ships its own stdlib — eighteen modules covering the surface a typical app reaches for. No package manager, no dependency trees, no `node_modules`. (Bringing third-party code is fine — it just enters through an explicit, named, capability-gated surface instead of an auto-resolved graph.)

---

## A note from the dev

This document describes the ***nominal*** language at the time of any version release. It does not describe what the compiler is perfectly capable of doing. I am working full-bore to get the compiler as close to the nominal state as possible. I am just one guy.

If you are here (and reading this). Hello, My name is Bryan MacLee. I am co-owner of a small trucking company in rural Ut. I run the business, drive, mechanic, apparently I'm the HR department. I am also a husband, father and sometimes, a wannabe coder.

This message is from me. I typed it. but ~96% of what you read (99.9% for the actual code) is claude "written". (I dont care about the exact brand as long as I have a tool that will get the job done.) I do my best to skim, and review as much as I can. But (see the prior list). If you find this interesting, continue reading. if you find something doesn't quite add up (or some straight up bullshit). let me know.

This is my third round with the ai and coding. the first two were pretty underwhelming. This time around I wasn't expecting much but I thought "the hell with it" and I tried out claude. I was fudging impressed.

I had been working with these ideas (in one way or another) for a long time. Over the course of about 3 years I learned (yes, the old school way, not much different than I am doing right now) how compilers work and how to implement various parts in various methods. programming has always been my favorite activity. the thing that I look forward to all the time (other than hanging with my wife and kids. Of course.)

After my first couple of experiments with claude I realized, I might actually be able to build this language. Dont get me wrong, I absolutely could write this language by hand. I can say that factually. BUT it would absolutely take me 10-20 years to do it. I think the ideas are worth surfacing at least.

AI code is still what it is. 100% mid. But its still all human mid that it is regurget-asemble-ing, If the ideas on top of the impl are good, or at least novel. it doesn't matter if the impl is mid. The ideas still get across. that's all that really matters to me here.

are the ideas any good?

---

## The tier ladder

State rarely starts as a state machine. scrml lets it *become* one — you start as a rough prototype and add structure as the design hardens, **without rewriting the markup tree.** State-children carry forward verbatim between tiers; the wrapper swap is the only commitment moment.

| Tier  | Form                                       | What you get                                                           |
|-------|--------------------------------------------|------------------------------------------------------------------------|
| **0** | `if=` chains / `${ if (...) lift ... }`    | prototype — no exhaustiveness check                                    |
| **1** | `<match for=Type [on=expr]>` + `<each>`    | compile-time structural exhaustiveness; `rule=` is checked but inert at runtime (a lint nudges promotion) |
| **2** | `<engine for=Type initial=.Variant>`       | the full deal — exhaustiveness + active transition rules + per-state effects (`<onTransition>` / `<onTimeout>` / `<onIdle>`) + composite hierarchy + `history` restore |

The engine surface beyond the demo — nested sub-engines, `history` restore on re-entry, named per-state timeouts with `cancelTimer()`, engine-wide idle watchdogs, internal-vs-external transitions — lives at [`examples/14-mario-state-machine.scrml`](examples/14-mario-state-machine.scrml) and in [NERDME.md → Realtime and workers / engines](./NERDME.md#realtime-and-workers).

---

## Everything scrml does

A quick brief on every feature. Each links to the full mechanics in [NERDME.md](./NERDME.md).

**State & reactivity** — `<x> = 0` declares, `@x` reads/writes; three RHS shapes (plain / bound-input / derived `const`); ad-hoc compound state; two-way `bind:value` dispatched by input type; `not` as the one absence value (no `null`, no `undefined`); server-pinned + `protect=`-ed cells. → [deep dive](./NERDME.md#state-and-reactivity)

**Engines, matches & iteration** — the Tier 0→1→2 ladder above: `if=`, then exhaustive `<match for=Type>` + `<each>`, then full `<engine>` state machines with `rule=` transitions, `<onTransition>`/`<onTimeout>`/`<onIdle>` effects, and composite hierarchy. → [deep dive](./NERDME.md#realtime-and-workers)

**Errors as states** — failable `fn f()! -> Err`, `fail Err::Variant`, exhaustive `!{}` handlers that route failures into state. No `try`/`catch`. → [deep dive](./NERDME.md#pure-functions--fn)

**Runtime type validation (replaces Zod)** — the type annotation *is* the schema. `number(>0 && <10000)`, `string(email)`, composable predicates; a three-zone (static/boundary/trusted) model that emits checks only where a value is unproven. → [deep dive](./NERDME.md#runtime-type-validation-replaces-zod)

**Type-derived apps** — `formFor(T)` / `schemaFor(T)` / `tableFor(T, rows)` generate the form, the SQL DDL, and the table from one struct. Add a field, all three gain it. → [deep dive](./NERDME.md#type-derived-apps--formfor--schemafor--tablefor)

**Free HTML validation** — the same predicate emits `type="email"`, `min`/`max`, `minlength`/`pattern` — one source, three enforcement points (server, client, browser). → [deep dive](./NERDME.md#free-html-validation)

**Validity surface** — declare a compound cell with validators and get reactive `@form.isValid` / `.errors` / `.touched` (compound + per-field); `<errors of=@field/>` renders them. → [deep dive](./NERDME.md#state-and-reactivity)

**Server / client split** — whole-program inference classifies anything touching SQL / server stdlib / `protect=` fields as server-side and generates the routes, fetch, CSRF, and serialization. Automatic N+1 batching, implicit transaction envelopes, per-route per-role bundle splitting. → [deep dive](./NERDME.md#server--client-split)

**Realtime & workers** — `<channel>` is a WebSocket endpoint with auto-syncing shared state; a nested `<program>` is a Web Worker / WASM module / sidecar with typed RPC and supervised restarts. No raw socket or `postMessage` code. → [deep dive](./NERDME.md#realtime-and-workers)

**The `~` pipeline & linear types** — `~` skips naming a throwaway intermediate: an unbound expression drops its result into `~`, the next statement consumes it — exactly-once, compiler-checked. `lin` generalizes that exact-once guarantee to any value, verified across branches, loops, and closures. → [deep dive](./NERDME.md#linear-types-and-the--accumulator)

**Pure functions — `fn`** — compiler-*enforced* purity: the prohibitions (no SQL, no DOM, no reactive writes, no `fetch`, no `<request>`) are verified statically — break one and it won't compile. `function` is the general callable. → [deep dive](./NERDME.md#pure-functions--fn)

**Styles** — scoped CSS via native `@scope` (no class mangling, no leaks), plus a built-in Tailwind engine that emits only the utilities you use — no CLI, no PostCSS, no purge step. → [deep dive](./NERDME.md#styles)

**Metaprogramming** — `^{}` runs at compile time (`reflect()`, `emit()`, macros); a meta block that reads reactive state runs at runtime instead. → [deep dive](./NERDME.md#metaprogramming-)

**Type safety** — no `any`. `asIs` accepts any type but forces you to narrow it before use (TypeScript's `unknown`, not `any`). → [deep dive](./NERDME.md#type-safety--asis-not-any)

**Type-derived variable names** — compiled bindings carry their type in the name, so runtime `reflect()` recovers it with zero shipped metadata (tree-shaken to nothing in most apps). → [deep dive](./NERDME.md#variable-renaming--type-derived-encoding)

**The Build Story** *(Nominal)* — compilation pinned to a content-addressed, reproducible "what the compiler is" closure; per-`<program>` build identity. → [deep dive](./NERDME.md#the-build-story-nominal)

**LLM agent integration** — `scrml:mcp` exposes your running app's structure (engines, forms, routes, channels) to an agent over MCP — the language is introspectable because it's exhaustive. → [deep dive](./NERDME.md#llm-agent-integration--scrmlmcp)

**Foreign code (`_{}`)** — when you need to drop into TS/JS, an inline value-returning `_={ in:{…} … }=` block inside a server function does it — typed at the boundary, server-only, capability-gated. (Arbitrary languages + `use foreign:` sidecars are specced-pending.) → [deep dive](./NERDME.md#known-limitations-and-gaps)

**Tooling & imports** — one file type, `.scrml`; a bundled, version-locked stdlib; everything beyond it enters through an explicit, capability-gated surface, never an auto-resolved dependency graph. → [deep dive](./NERDME.md#server--client-split)

> Known gaps, partial implementations, and what's specced-but-not-built are tracked in [NERDME → Known limitations](./NERDME.md#known-limitations-and-gaps) and [`docs/known-gaps.md`](./docs/known-gaps.md).

---

## Language contexts

scrml uses sigil-delimited contexts to separate concerns within a single file:

| Context | Sigil | Purpose |
|---------|-------|---------|
| Program | `<program>` | App root — database, protection, config |
| Markup  | `<tag>` | HTML elements + scrml structural elements (`<engine>`, `<match>`, `<channel>`, `<schema>`, `<errors>`, `<onTransition>`, `<onTimeout>`, `<onIdle>`, `<auth>`, `<page>`) + state decls (`<name> = init`) |
| Logic   | `${}` | scrml logical expressions and functions |
| SQL     | `?{}` | Database queries (Bun.SQL tagged-template; SQLite shipping, Postgres in progress); auto-batched N+1 |
| CSS     | `#{}` | Scoped styles |
| Error   | `!{}` | Typed error handling (failable `!{ \| ::V :> ... }` arms) |
| Meta    | `^{}` | Compile-time (or runtime) code generation |
| Test    | `~{}` | Inline tests + `test-bind` server-fn mocks (stripped from production) |
| Foreign | `_{}` | Inline foreign code — the value-returning `_={…}=` ts/js form ships; WASM call-char sigils + `use foreign:` sidecars are specced-pending |

---

## Examples

The [`examples/`](examples/) directory is curated to show what scrml can do:

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
| [19-lin-token](examples/19-lin-token.scrml) | `lin` exact-once consumption |
| [20-middleware](examples/20-middleware.scrml) | `<program>` attrs + `handle()` HTTP middleware |
| [21-navigation](examples/21-navigation.scrml) | `navigate()` + `route` history-aware routing |
| [22-multifile](examples/22-multifile/) | Cross-file `import`/`export`, pure-type files |
| [23-trucking-dispatch](examples/23-trucking-dispatch/) | Multi-page auth-bearing app — real `/login`, role gates, per-route chunks |
| [24-tilde-pipeline](examples/24-tilde-pipeline.scrml) | `~` pipeline accumulator |
| [25-triage-board](examples/25-triage-board.scrml) | Drag-and-drop between columns, struct + enum state |
| [26-type-derived-schema](examples/26-type-derived-schema.scrml) | `schemaFor(Type)` — SQL DDL from a struct |
| [27-type-derived-table](examples/27-type-derived-table.scrml) | `tableFor(Type, rows)` — a `<table>` from a struct |

---

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

---

## Terms

A short glossary of scrml-specific terms.

- **reactive cell** — state declared with `<name> = init`. Read/written via `@name`; mutating it re-renders the parts of the UI that depend on it. Three RHS shapes — plain (`<x> = 0`), bound-input (`<userName req> = <input/>`), and derived (`const <x> = expr`).
- **engine** — a Tier-2 state machine: `<engine for=Type initial=.Variant>`. Each state-child is one variant's UI block; `rule=` declares legal transitions; `<onTransition>` / `<onTimeout>` / `<onIdle>` attach effects. Singleton-by-design; components are the multi-instance vehicle.
- **match block** — the Tier-1 structural form `<match for=Type>`; the compiler checks at compile time that every variant has a UI block.
- **lifecycle annotation** — `(A to B)` on a type position: the location starts holding `A` and transitions to `B`; reads before the transition fire `E-TYPE-001`. Zero runtime cost.
- **`<channel>`** — a real-time element declaring a WebSocket endpoint; state declared inside its body auto-syncs across every connected client on the same topic.
- **validity surface** — the auto-synthesized read-only `@form.isValid` / `.errors` / `.touched` cells produced by validators on a compound cell.
- **per-role chunk** — `<auth role="X">` tells the compiler only role-`X` visitors reach the gated subtree, so other roles get a smaller initial bundle.
- **`fn` vs `function`** — `fn` is a compiler-enforced pure function; `function` is a general callable.
- **`not`** — scrml's one absence value. `null` and `undefined` do not exist. Check with `is not` / `is some`.

---

## Documentation

- [NERDME](./NERDME.md) — the deep mechanics behind every feature above
- [Tutorial](docs/tutorial.md) — step-by-step, zero to full-stack
- [Design Notes](DESIGN.md) — the rationale and philosophy: why scrml is what it is
- [Language Specification](compiler/SPEC.md) — the full formal spec (~33,600 lines) · [Quick-Lookup](compiler/SPEC-INDEX.md)
- [Pipeline Contracts](compiler/PIPELINE.md) — stage-by-stage compiler pipeline
- [Live status](./master-list.md) · [Changelog](docs/changelog.md) · [Known gaps](docs/known-gaps.md)

---

## License

MIT — see [LICENSE](./LICENSE).

## Related projects

- **[giti](https://github.com/bryanmaclee/giti)** — a collaboration platform and git alternative designed around scrml's compiler strengths. The CLI wraps jj (jujutsu) until the scrml compiler can do AST-level conflict resolution natively; long-term vision is a hosted forge.
- **[6nz](https://github.com/bryanmaclee/6NZ)** — a purpose-built code editor for the scrml ecosystem, written entirely in scrml: a focus-centered viewport, NeoVim-superset keybindings, CodeMirror 6 + canvas overlay, offline-first PWA. The companion [Z-motion input spec](https://github.com/bryanmaclee/6NZ/tree/main/z-motion-spec) is CC0.

## Status

scrml is open source under the [MIT License](./LICENSE) and shipping today — `bun link` and the compile is real. The spec evolves as we find friction; the compiler catches up. The compiler runs on [Bun](https://bun.sh); compiled output is plain JavaScript that runs in any browser or JavaScript runtime. See [`docs/changelog.md`](./docs/changelog.md) for what just landed.
