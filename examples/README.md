# scrml examples

Stop wiring. Start building.

These are runnable scrml apps — one `.scrml` file each, except `22-multifile/` (three files) and
`23-trucking-dispatch/` (a multi-page app). No build config, no separate server file, no route
definitions, no state management library. Just `.scrml`.

Each example is chosen to show something that takes real work in React or Vue but falls out
naturally from how scrml is designed.

## Quick start

```bash
# Compile any example
bun compiler/src/cli.js compile examples/01-hello.scrml -o dist/

# Output: dist/01-hello.html, dist/01-hello.client.js, dist/01-hello.css, plus the shared
# scrml-runtime.<hash>.js the page loads
# Open dist/01-hello.html in a browser.
```

## Sigil cheatsheet

| Sigil | Context | Meaning |
|-------|---------|---------|
| `<var> = init` / `@var` | anywhere | Reactive state — `<var> = init` declares (V5-strict); `@var` reads/writes |
| `${}` | markup | Logic block — JS expressions, control flow, declarations |
| `?{}` | logic | SQL passthrough — direct database access |
| `#{}` | markup | CSS — scoped (`@scope`) inside a component; global at `<program>` level |
| `^{}` | logic | Meta block — compile-time code generation |
| `~{}` | logic | Inline test — stripped from production builds |
| `!{}` | logic | Error handler — exhaustive error matching |

---

| File | What it shows |
|------|---------------|
| `01-hello.scrml` | Bare markup and the three closer forms — the syntax in ten lines |
| `02-counter.scrml` | Reactive state with `<count> = 0` (V5-strict decl), `@count` access, `bind:value`, bare-call `onclick=fn()` |
| `03-contact-book.scrml` | Full-stack in one file: a typed `Contact` struct + `?{}` SQL + server-classified functions (auto-inferred via body content) + form binding, with the contact rows rendered via the Tier-1 `<each in=@contacts key=@.id>`/`<empty>` shape over a reactive `Contact[]` collection (no auth — this is the CRUD/persistence demo; `protect=` is shown in 07/23) |
| `04-live-search.scrml` | Reactive filtering via a derived `const <filtered>` cell + Tier-1 `<each>`/`<empty>` over a reactive typed collection — the filter lives in a named reactive cell, not inline in the render |
| `05-multi-step-form.scrml` | Wizard UI as an `<engine for=Step>`: `rule=` state-children per step + decl-coupled validators gating Next/Submit via `@signup.isValid` + `<errors of=>` (§51 + §55) |
| `06-kanban-board.scrml` | Per-card status is multi-instance, so NOT an engine: derived per-status columns (`const <todo>`/`<inProgress>`/`<done>` filtered from a typed `Card[]`, §6.6.2) rendered with Tier-1 `<each>`/`<empty>` + per-direction id-only move handlers, CSS grid |
| `07-admin-dashboard.scrml` | `^{}` meta block + `reflect(User)` — table headers generated from the type |
| `08-chat.scrml` | Single-user message log: typed `Message[]` feed rendered with Tier-1 `<each>`/`<empty>` + optimistic update + DB persistence (NOT real-time — see 15) |
| `09-error-handling.scrml` | Errors-as-states: failable functions + `!{}` route each failure into a `Phase` enum's `.Failed(err)`; `<match for=Phase>` renders the held error — the failure mode lives in the type, no boolean error flags (§19) |
| `10-inline-tests.scrml` | `~{}` inline tests — compile-time assertions, stripped from production |
| `11-meta-programming.scrml` | `^{}` meta blocks, `emit()`, `reflect()` — the compiler as a programmable tool |
| `12-snippets-slots.scrml` | Named content slots in components — `slot=`, `${render slotName()}`, snippet props |
| `13-worker.scrml` | `<program name="worker">` — web workers as nested programs with typed messaging |
| `14-mario-state-machine.scrml` | Enum state machine: `type:enum`, payload destructuring, derived machines (§51.9) |
| `15-channel-chat.scrml` | Real-time chat — `<channel>` inside `<program>` for WebSocket sync (auto-sync from being declared inside the channel body; there is no `@shared` modifier) (§38) |
| `16-remote-data.scrml` | Async loading as a typed Phase enum rendered with the Tier-1 `<match for=ContactsPhase>` block (Idle / Loading / Loaded / Failed), `<each>`/`<empty>` rows, failure routed into `.Failed` via `!{}`; promote to `<engine>` when transitions need enforcing — the Tier ladder (§18 + §17.7 + §19) |
| `17-schema-migrations.scrml` | `<schema>` declarative DB schema — `scrml db-migrate` diffs it against the live DB and applies the migration (`--dry-run` prints the plan) (§39) |
| `18-state-authority.scrml` | `<x server>` server-authoritative state (§52 Tier 2, scaffold) |
| `19-lin-token.scrml` | `lin` linear types — exactly-once consumption guarantee (§35) |
| `20-middleware.scrml` | `<program>` middleware attrs + `handle()` escape hatch (§40) |
| `21-navigation.scrml` | `navigate()` + `route` — page transitions, route params (§20) |
| `22-multifile/` | `import`/`export` across .scrml files — pure-type files + component reuse (§21) |
| `23-trucking-dispatch/` | Multi-page reference app (logistics dispatch) — multiple `<page>` files under `pages/`, full-stack with auth + DB + per-page server functions; canonical adopter-scale shape |
| `24-tilde-pipeline.scrml` | `~` last-unbound-expression carry-forward — bare-call + next-line consume; function-body pipelines; no naming intermediates used once (§32) |
| `25-triage-board.scrml` | Drag-and-drop triage board — the §51.0.S engine-message-dispatch worked example: a board-singleton `<engine for=DragPhase accepts=DragMsg>` owns its transitions via `(state × message)` arms + `.advance(.Msg)`; the drag glue collapses into the engine |
| `26-type-derived-schema.scrml` | `schemaFor(StructType)` — `<schema>` DB DDL generated from a struct (type-as-argument family, §41.15) |
| `27-type-derived-table.scrml` | `tableFor(StructType, rows)` — an admin `<table>` generated from a struct + rows (type-as-argument family, §41.16) |
| `28-flux.scrml` | **Flux** — a shifting-labyrinth game: a derived ASCII board, fog-of-war, per-cell re-roll ("flux"), 2-tier memory locking, and level/vision/XP progression. Canonical-scrml dog-food (§6.6 derived cells, §48 pure `fn`, §17/§18). Will replace `14-mario` as the flagship game example. |
| `29-engine-vs-flags.scrml` | **Engine vs. flag soup** — the same UI as three booleans (2³ = 8 states, 5 of them impossible) vs. a per-screen `Phase` enum where the impossible states are unrepresentable by construction. Elm's "make impossible states impossible" in scrml — the flags→engine reflex (§51). |
| `30-validated-form.scrml` | **Validated form** — validators ride as bare attributes on each field decl (`<email req pattern(…)>`); the compiler auto-synthesizes the read-only validity surface (`@signup.isValid`, per-field `.errors`/`.touched`) and `<errors of=…/>` renders it. No `validate()`, no `@isValid` boolean, no error-string flags — the "no zod" differentiator (§55). |
| `31-reach-discipline.scrml` | **Reach discipline** — the state-vs-`fn` decision, side by side over one domain: a source scanner's MODE is an `<engine>` (named conditions + a transition contract) while a numeric literal's VALUE is a pure `fn` (total, input→output). Reach for state when it has named conditions + a contract; reach for `fn` when it's pure compute. |
| `32-external-api.scrml` | **Typed external API (BYOB)** — `<api base=…>` types a foreign HTTP backend scrml does NOT own; `<request api=… args=@cell>` fires the per-endpoint thin typed `fetch(base+path)` (GET path-param substitution + POST JSON body) and decodes a **variant** (`:enum`) `ResponseT` via `parseVariant` (§60.5). Pure-client SPA — NO `.server.js`, NO `<db>` (a raw external fetch is not a §12.2 server trigger). untyped-silent-drift → typed-compile-loud-drift; LIMIT-PRIMITIVES (no retry/cache/pagination). The owned-data sibling is `<db>` (03/16/23) (§60). |
| `33-endpoint.scrml` | **Typed inbound endpoint** — the serve-side MIRROR of `32`'s `<api>`. `<endpoint path= method= accepts=:enum>` types a route a FOREIGN client calls; the compiler owns the request decode (`parseVariant` §41.13 over the body), the exhaustive dispatch, and the JSON envelope, while the per-variant arms (`<Variant(payload) : expr>`, the §18.0.1 arm grammar) return the typed wire value. Inbound-honesty: a variant with no arm is a COMPILE error (`E-ENDPOINT-NOT-EXHAUSTIVE`, §61.4). SERVER-only — emits a `.server.js` route-handler ONLY, NO paired client fetch-stub (§61.6); CSRF-exempt by construction (JSON+bearer, §61.7). JSON-RPC is a convention expressed by what the arm RETURNS, not a baked-in mode (§61.5). The typed-OUTBOUND sibling is `<api>` (`32`) (§61). |
| `34-value-native-set.scrml` | **Value-native set** — `set[K]` (§59.12) is a thin desugar over the value-native map `[K: bool]`: two sets are `==` iff they hold the same elements; `.add` dedups by construction; a `set[Stop]` of structs tests membership by value, not reference; every write returns a new set (`@s = @s.add(x)`). Set algebra (`.union`/`.intersect`/`.difference`) comes from `scrml:data`. |

---

Start with `01-hello.scrml` if you want the syntax walkthrough. Start with `03-contact-book.scrml`
if you want the "wait, that's the whole app?" moment.

The interesting examples are 05-08. That's where scrml stops looking like a nicer JSX and starts
looking like a different idea about what a web framework is.

15-18 cover the more advanced patterns — real-time WebSocket sync, async loading state,
declarative schemas, and server-authoritative state. Each demonstrates a single spec section's
canonical pattern.
