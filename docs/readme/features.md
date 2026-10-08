# Everything scrml does

A short brief on each feature that works today. Each links to the full mechanics in [NERDME.md](../../NERDME.md). Anything specified but not built is marked **(Nominal)**.

**State & reactivity:** `<x> = 0` declares, `@x` reads and writes; plain, input-bound and derived (`const`) cells; compound cells; two-way `bind:value` / `bind:checked`; `not` as the one absence value (no `null`, no `undefined`). → [deep dive](../../NERDME.md#state-and-reactivity)

**Enums, matches, engines & iteration:** the [Tier 0→1→2 ladder](tier-ladder.md): `if=`, exhaustive `match` and `<match for=Type>`, `<each>` with `<empty>`, and `<engine>` state machines with `rule=` transitions and `<onTransition>` / `<onTimeout>` / `<onIdle>` effects. → [deep dive](../../NERDME.md#realtime-and-workers)

**Errors as states:** failable `function f()! -> Err`, `fail .Variant`, and exhaustive `!{}` handlers that route failures into state. `defer` runs cleanup on every way out of a function. `<errorBoundary>` catches failures in markup. → [deep dive](../../NERDME.md#pure-functions--fn)

**Server / client split:** anything that touches SQL or other server-only resources runs on the server, and the compiler generates the routes, the `fetch` calls, the CSRF handling and the serialization. `protect="col"` keeps a column's values off the client: the column is stripped from rows before they leave the server. → [deep dive](../../NERDME.md#server--client-split)

**SQL and schema:** `?{}` runs SQL (SQLite) with bound parameters. `<schema>` declares the tables, and `scrml db-migrate` diffs it against the live database and applies the change (`--dry-run` prints the plan). → [example 17](../../examples/17-schema-migrations.scrml)

**Runtime type validation:** the type annotation *is* the check. `number(>0 && <10000)`, `string(email)` and composable predicates. A literal that breaks the predicate is a compile error; a runtime value that breaks it is rejected when it arrives (`E-CONTRACT-001-RT`). → [deep dive](../../NERDME.md#runtime-type-validation-replaces-zod)

**Validators and the validity surface:** `req`, `length`, `pattern`, `min`/`max`, `eq(@other)` and more ride on a cell. On a compound cell they give you `@form.isValid` / `.errors` / `.touched` / `.submitted`, and `<errors of=…/>` renders them. On an input they become `required`, `minlength`, `pattern` and friends. → [deep dive](../../NERDME.md#free-html-validation)

**Type-derived apps:** `formFor(T)` / `schemaFor(T)` / `tableFor(T, rows)` generate a form, the SQL DDL and a table from one struct. → [deep dive](../../NERDME.md#type-derived-apps--formfor--schemafor--tablefor)

**Realtime & workers:** state declared inside `<channel>` syncs across every connected client over a WebSocket the compiler sets up. A nested `<program>` is a Web Worker: `when message from` handlers receive its messages and `.send()` returns its reply ([example 13](../../examples/13-worker.scrml)). Supervision (`restart=`, `when terminate from`) is specified but not built yet. → [deep dive](../../NERDME.md#realtime-and-workers)

**Client navigation:** `navigate(path)` moves between `<page>`s, rendered into the `<program>` shell's `<outlet>`. → [example 21](../../examples/21-navigation.scrml)

**Typed external APIs:** `<api>` types an HTTP backend you don't own, and `<endpoint>` types a route that someone else's client calls; a request variant with no handler is a compile error. → [examples 32](../../examples/32-external-api.scrml) / [33](../../examples/33-endpoint.scrml)

**The `~` pipeline & linear types:** `~` holds an unnamed intermediate for the next statement to consume. `lin` makes a value exactly-once: using it twice, never, or on only one branch is a compile error (`E-LIN-002` / `-001` / `-003`), and so is using it inside a loop. → [deep dive](../../NERDME.md#linear-types-and-the--accumulator)

**Pure functions — `fn`:** purity is compiler-*enforced*. No SQL, no DOM writes, no reactive writes, no non-determinism: break one and it won't compile. `function` is the general callable. → [deep dive](../../NERDME.md#pure-functions--fn)

**Styles:** `#{ }` inside a component is scoped through native `@scope`, with no class mangling; at program level it is global. A built-in Tailwind engine emits only the utilities you use, with no CLI and no PostCSS. And a scrml-native CSS model (SPEC §65): an unconditional same-property conflict on the same element is a compile error (`E-STYLE-CONFLICT`), not a silent last-wins, and `<theme>` tokens lower to CSS custom properties. The rest of §65 (style as a value, `<defaults>`) is **(Nominal)**. → [deep dive](../../NERDME.md#styles)

**Metaprogramming:** `^{}` runs at compile time: `reflect(Type)` reads a type, `emit()` writes code. → [deep dive](../../NERDME.md#metaprogramming-)

**Foreign code:** when you need TS/JS, a value-returning `_={ … }=` block inside a server function drops into it. → [deep dive](../../NERDME.md#known-limitations-and-gaps)

**Tooling:** a CLI with [12 verbs](../../docs/FACTS.md) (`init`, `dev`, `compile`, `build`, `db-migrate`, …), a language server, and editor support for Neovim and VS Code. One file type, `.scrml`.

**Inline tests:** `~{ test "…" { assert … } }` blocks sit next to the code they check and are compiled out of the output. The shipping CLI has no command that runs them yet.

**The Build Story (Nominal):** compilation pinned to a content-addressed, reproducible "what the compiler is" closure; per-`<program>` build identity. → [deep dive](../../NERDME.md#the-build-story-nominal)

> Known gaps and partial implementations are tracked in [`docs/known-gaps.md`](../../docs/known-gaps.md) and [NERDME → Known limitations](../../NERDME.md#known-limitations-and-gaps).
