# Examples

The [`examples/`](../../examples/) directory holds one app per file. Every one of them compiles with the current compiler.

| Example | What it shows |
|---------|---------------|
| [01-hello](../../examples/01-hello.scrml) | Bare minimum: compiles to pure HTML |
| [02-counter](../../examples/02-counter.scrml) | Reactive state, binding, scoped CSS |
| [03-contact-book](../../examples/03-contact-book.scrml) | Full-stack with DB, server functions, SQL |
| [04-live-search](../../examples/04-live-search.scrml) | Reactive filtering, derived state |
| [05-multi-step-form](../../examples/05-multi-step-form.scrml) | A wizard as an `<engine>`, validators gating each step |
| [06-kanban-board](../../examples/06-kanban-board.scrml) | Derived per-status columns over a typed list |
| [07-admin-dashboard](../../examples/07-admin-dashboard.scrml) | Metaprogramming, type reflection |
| [08-chat](../../examples/08-chat.scrml) | Reactive lists, server persistence |
| [09-error-handling](../../examples/09-error-handling.scrml) | Errors as states with `!{}` |
| [10-inline-tests](../../examples/10-inline-tests.scrml) | `~{}` inline tests |
| [11-meta-programming](../../examples/11-meta-programming.scrml) | `^{}` meta blocks, `emit()`, `reflect()` |
| [12-snippets-slots](../../examples/12-snippets-slots.scrml) | Named content slots in components |
| [13-worker](../../examples/13-worker.scrml) | A nested `<program>` as a Web Worker with typed messages |
| [14-mario-state-machine](../../examples/14-mario-state-machine.scrml) | Enum states and `<engine>` transition enforcement |
| [15-channel-chat](../../examples/15-channel-chat.scrml) | `<channel>` realtime, auto-synced channel state |
| [16-remote-data](../../examples/16-remote-data.scrml) | Loading as a `Phase` enum, failure routed into `.Failed` |
| [17-schema-migrations](../../examples/17-schema-migrations.scrml) | `<schema>` + `scrml db-migrate` |
| [18-state-authority](../../examples/18-state-authority.scrml) | `<x server>` server-authoritative cells |
| [19-lin-token](../../examples/19-lin-token.scrml) | `lin` exact-once consumption |
| [20-middleware](../../examples/20-middleware.scrml) | `<program>` middleware attributes + `handle()` |
| [21-navigation](../../examples/21-navigation.scrml) | `navigate()` + `route` |
| [22-multifile](../../examples/22-multifile/) | Cross-file `import`/`export`, pure-type files |
| [23-trucking-dispatch](../../examples/23-trucking-dispatch/) | A multi-file dispatch app: a real login, a portal per role (dispatcher, driver, customer), channels, single-use `lin` tokens. Ships a seeded database — see its README |
| [24-tilde-pipeline](../../examples/24-tilde-pipeline.scrml) | The `~` pipeline accumulator |
| [25-triage-board](../../examples/25-triage-board.scrml) | Drag-and-drop between columns, struct + enum state |
| [26-type-derived-schema](../../examples/26-type-derived-schema.scrml) | `schemaFor(Type)`: SQL DDL from a struct |
| [27-type-derived-table](../../examples/27-type-derived-table.scrml) | `tableFor(Type, rows)`: a `<table>` from a struct |
| [28-flux](../../examples/28-flux.scrml) | A shifting-labyrinth game: derived ASCII board, fog of war |
| [29-engine-vs-flags](../../examples/29-engine-vs-flags.scrml) | Three booleans vs. a `Phase` enum where impossible states can't be written |
| [30-validated-form](../../examples/30-validated-form.scrml) | Validators and the validity surface, `<errors of=…/>` |
| [31-reach-discipline](../../examples/31-reach-discipline.scrml) | When to reach for an `<engine>` and when for a pure `fn` |
| [32-external-api](../../examples/32-external-api.scrml) | `<api>`: a typed client for a backend you don't own |
| [33-endpoint](../../examples/33-endpoint.scrml) | `<endpoint>`: a typed route for someone else's client |
| [34-value-native-set](../../examples/34-value-native-set.scrml) | `set[K]`: sets compared by value |
