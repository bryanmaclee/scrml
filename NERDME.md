# NERDME

The under-the-hood companion to the [README](./README.md). The README briefs every feature in a line or two and shows one app end-to-end; this file is the deep version — the mechanics, the error codes, the trade-offs, the edges. If you read the README and thought *"okay but how does that actually work,"* this is the page.

> **NERDME ≠ [DESIGN.md](./DESIGN.md).** DESIGN is the *why* — the rationale and philosophy behind the language's shape. NERDME is the *how* — the concrete mechanism of each shipped feature. The formal truth is [`compiler/SPEC.md`](compiler/SPEC.md) (navigate via [`SPEC-INDEX.md`](compiler/SPEC-INDEX.md)); NERDME is the human-readable tour of it.

Each section below is the deep dive a README feature links to. Anything marked **Nominal** is specified-and-designed but not yet fully wired in the compiler — the README and [`docs/known-gaps.md`](./docs/known-gaps.md) track the live gap.

---

## State and reactivity

`<count> = 0` declares a reactive cell; `@count` reads or writes it. **Declarations use the structural `<x>` form; reads and writes use the `@x` form.** The two are visually distinguishable on purpose — a reader can scan any function body and count exactly how many state cells it touches.

- **Bare names are plain locals.** A bare identifier in an expression does *not* resolve to reactive state, and a local cannot shadow a registered state name (`E-NAME-COLLIDES-STATE`).
- **The declaration/write distinction is enforced.** A bare `@x = expr` at the body-top of a `<program>` / `<page>` / `<channel>` fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`: declarations use the structural `<x>`; writes go inside `${...}` functions.
- **Three RHS shapes.** Shape 1 plain (`<count> = 0`). Shape 2 decl-coupled-with-render-spec (`<userName req length(>=2)> = <input/>` — `<userName/>` in markup expands to the bound input with `bind:value` wired). Shape 3 derived (`const <doubled> = @count * 2` — read-only; recomputes on dependency change; markup-typed derived cells are legal).
- **Compound state (Variant C).** `<formRes> <name> = "" <email> = "" </>` — ad-hoc compound via structural children. Read `@formRes.name`; write `@formRes.email = "alice"`. A predefined struct type unlocks positional-sugar construction.
- **Two-way binding.** The compiler dispatches `bind:*` by render-spec: `<input type="checkbox">` → `bind:checked`, `<select>` → `bind:value`, etc.
- **Server-pinned + protected state.** `<users server>` pins a cell server-side so it never reaches the browser. `protect=` on a struct field hides it from the client schema view. Both are enforced at compile time — reading a protected field on the client is `E-PROTECT-001`.

### `not` — the one absence value

`null` and `undefined` **do not exist in scrml** — neither parses, neither runs, library mode included. `<result> = not` means "no value yet." Check absence with `is not`, presence with `is some`. `== not` misuse is `E-SYNTAX-042` at compile time.

Critically, `""` / `0` / `false` / `[]` / `{}` are **defined values, not absence** — `is some "" → true`, `req "" → false`. "Empty" and "absent" are different concepts and the language keeps them apart.

---

## Linear types and the `~` accumulator

- **Exact-once consumption (`lin`).** A `lin` value must be used exactly once, with restricted visibility between declaration and consumption. The compiler verifies this statically across branches, loops, closures, and cross-`${}` blocks. Normative surface: [SPEC §35](compiler/SPEC.md).
- **The `~` pipeline accumulator.** An unbound expression statement drops its result into `~`; the next statement consumes it. `step1(x)` then `return step2(~)` — no name on a value used exactly once, the cleanliness of a ternary for pipelines. `~` is itself a built-in `lin` variable (exactly-once, compiler-checked, scope-local to each `${}` body and function body). Misuse — read twice, read uninitialized, reinitialized before consumption — is `E-TILDE-001` / `E-TILDE-002`. See [SPEC §32](compiler/SPEC.md) and [`examples/24-tilde-pipeline.scrml`](examples/24-tilde-pipeline.scrml).

---

## Type safety — `asIs`, not `any`

scrml has **no `any` type** — no "turn off the type checker" escape hatch. `asIs` accepts any type but forces you to resolve it to a concrete type before you use or return it — analogous to TypeScript's `unknown`, not `any`. Component bare props follow `asIs` rules: the compiler infers the concrete type from how the prop is used.

---

## Runtime type validation (replaces Zod)

The type annotation **is** the validation schema — no separate schema library, no `z.object()` wrappers, no `z.infer<typeof>` indirection.

```scrml
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
| **Static** | Compiler proves the value satisfies the constraint (e.g. literals) | Zero — no runtime code emitted |
| **Boundary** | Value comes from an unproven source (user input, API response, arithmetic) | One boolean check at the assignment site |
| **Trusted** | Value was already checked in the current scope | Zero — the compiler remembers the proof |

A boundary check emits a single synchronous predicate test; on failure the compiler throws `E-CONTRACT-001-RT` labeled with the assignment site. Built-in named shapes today: `email`, `url`, `uuid`, `phone`, `date`, `time`, `color`. Composable predicates (`number(>0 && <10000)`, `string(.length > 7)`) cover the same ground as Zod schemas — with zero dependencies, zero bundle cost in proven code paths, and no separate schema language to keep in sync with your types.

---

## Type-derived apps — `formFor` / `schemaFor` / `tableFor`

One struct type drives the form, the schema, and the table — no schema duplication, no model-to-DTO translation, no view-model boilerplate. The same predicates that validate the values also derive the right HTML form controls and the right SQL column types.

```scrml
import { formFor, schemaFor, tableFor } from "scrml:data"

type Contact:struct = {
    name:  string(.length > 0)
    email: string(email)
    phone: string(phone)?
}

<formFor for=Contact onsubmit=save/>                  // a complete form from the type
<schema>${ schemaFor(Contact) }</schema>              // SQL DDL from the type
<tableFor for=Contact rows=@contacts/>                // a <table> from the type + rows
```

Each primitive reads the struct field validators directly: `string(email)` becomes both a `<input type="email">` control AND a `TEXT CHECK(...)` column. Add a field to `Contact` and the form / schema / table all gain it at the next build — no second source of truth. `pick=["a","b"]` / `omit=["secret"]` / `partial=true` shape the field set per call site; `<slot name="fieldName">` overrides one field's render. See [`examples/26-type-derived-schema.scrml`](examples/26-type-derived-schema.scrml) and [`examples/27-type-derived-table.scrml`](examples/27-type-derived-table.scrml).

---

## Free HTML validation

The same predicate that runs server- and client-side boundary checks also powers browser-native form validation. On `bind:value` inputs the compiler derives the matching HTML attributes — `string(email)` → `type="email"`, `number(>0 && <100)` → `min="0" max="100"`, `string(uuid)` → `pattern=...`, `string(.length > 7 && .length < 255)` → `minlength="8" maxlength="254"`. **One predicate, three enforcement points** (server boundary, client boundary, browser pre-submit). You never hand-write the attrs and they never drift from the type.

---

## Variable renaming — type-derived encoding

The compiler renames JavaScript bindings in compiled output with a deterministic, type-derived encoding. `@shoppingCart` of type `Cart` becomes `_s7km3f2x00` — underscore prefix, kind character (`s` = struct, `p` = primitive, `e` = enum, …), an 8-character base36 FNV-1a hash of the canonical type string, and a per-scope sequence char. Two bindings of the same type share the hash; the sequence char disambiguates.

Because the name carries the type, runtime `reflect()` can recover the full type descriptor from a variable alone — without shipping unused type metadata. The decode table is tree-shaken entirely when no `^{}` meta block references runtime state, so most apps ship **zero** reflection bytes. Debug builds append `$originalName` so stack traces and DevTools stay readable; production builds reject that flag as a hard error.

This isn't bundler-style single-letter renaming — the names are longer than `a`, `b`, `c`, and the wins are different: collision-free across scopes, type-introspectable at runtime, and protected fields can never leak into a client-side encoded name (the client schema view excludes them by construction, verified again at emit).

---

## The Build Story (Nominal)

> Specified in [SPEC §58](compiler/SPEC.md); compiler implementation pending. `*` marks a claim not yet actual.

Compilation is a pure function of two inputs — your source and an explicit, committed **build story** that pins what "the compiler" *is*: a content-addressed Merkle closure over the compiler-proper's four components — compiler source, language tools, the standard library, and any vendored edge code — one root hash with the dependency edges *inside* the hash, plus a human-inspectable `build-story.lock` sidecar. Because every part (the compiler included) is identified by the hash of its content, customizing the compiler to your project and reproducing any build bit-for-bit\* stop being in tension: a tuned compiler is just a different pinned build story, and "pinned" is what makes it portable.

A build story can be pinned per `<program>` — `<program story="…">`\* — and because nested `<program>` contexts are already isolated, shared-nothing compilation units, different parts of one application can be built by different compilers, each independently reproducible. This is deliberately **not** a live or hot-swappable compiler: every build story is static, read once before parsing begins; only *authorship* is customizable, never the running compile.

<sub>\* The bit-for-bit guarantee requires a whole-compiler determinism audit not yet done. The build-story artifact and the `<program story=>` attribute are specified in SPEC §58 but not yet implemented.</sub>

---

## Server / client split

- **Auto-split via whole-program inference.** The compiler walks the call graph and infers what runs where. Functions that touch SQL, `protect=` fields, `Bun.*`, `process.*`, or a server-only stdlib module (`scrml:auth`/`crypto`/`fs`/`store`/`redis`/`cron`/`oauth`) are classified server-side automatically; caller-context propagates the classification through transitive call chains. The `server` keyword still parses but is redundant wherever inference can prove server-classification — `W-DEPRECATED-SERVER-MODIFIER` fires at redundant uses (a `W → E → parser-strip` deprecation cycle follows the `<machine>` precedent). Dead, never-called functions are warned (`W-DEAD-FUNCTION`) and tree-shaken.
- **SQL passthrough (`?{}`).** Query SQLite directly inside logic blocks; the compiler generates parameterized queries and serialization. (Postgres is in progress; SQLite ships.)
- **Automatic N+1 elimination (Tier 2).** A `for` loop whose body does `?{...WHERE id = ${x.id}}.get()` is rewritten to one pre-loop `WHERE id IN (?,?,?,…)` fetch plus a keyed `Map` lookup — no DataLoader, no manual batching. Measured ~1.7× / 2.3× / 3.3× at N=10/100/1000 on on-disk WAL `bun:sqlite` ([benchmarks/sql-batching/RESULTS.md](benchmarks/sql-batching/RESULTS.md)).
- **Implicit transaction envelopes (Tier 1).** Independent reads in a `!` handler share one `BEGIN DEFERRED`..`COMMIT` for snapshot consistency under concurrent writers. Explicit `transaction { }` blocks are left alone; `W-BATCH-001` fires if the two would conflict.
- **Mount-hydration coalescing.** Multiple on-mount `<x server>` loads on one page fold into a single `__mountHydrate` round-trip (§8.11) instead of one request per variable.
- **Opt-out per call site.** `?{...}.nobatch()` disables rewriting when you need an exact query shape (`EXPLAIN`, stored procedures, measured hot paths).
- **Diagnostics, not silent magic.** `D-BATCH-001` flags near-miss loops that *almost* batch but don't (mutation in body, non-`.get()` chain, …) with the exact disqualifier. `E-BATCH-001` rejects `.nobatch()` composition with batched siblings; `E-BATCH-002` guards the 32 766 `SQLITE_MAX_VARIABLE_NUMBER` ceiling at runtime.
- **No API boilerplate.** Server functions are called like local functions; the compiler generates routes, fetch calls, CSRF tokens, and serialization.
- **Per-route per-role chunk splitting.** Whole-stack closure analysis (§40) computes exactly which component code, server functions, and stdlib units are reachable per entry point and per role. A `<auth role="Admin">` block tells the compiler that only Admin-role visitors reach the gated subtree; other roles get a strictly smaller initial bundle. Cross-route prefetching is tiered (idle / hover / on-demand); every chunk filename embeds a stable FNV-1a content hash (§47) so adopter caches stay valid across builds when source bytes don't change. The `W-CG-CHUNK-*` + `W-AUTH-*` diagnostic family flags shapes that defeat the analysis — a route linking nowhere, a gate needing a runtime check.

---

## Realtime and workers

- **WebSocket channels (`<channel>`).** A lifecycle element that declares a WebSocket endpoint. The compiler emits the Bun upgrade route, a client-side connection manager with exponential-backoff reconnect, and pub/sub topic routing. `onserver:open` / `:message` / `:close` run server-side; `onclient:open` / `:close` / `:error` run in the browser. `protect=` gates the upgrade with a session-cookie check. No WebSocket or Bun-specific API appears in your source.
- **Shared reactive state inside channels.** State declared inside a `<channel>` body (`<messages> = []`) auto-syncs across every connected client — no `@shared` modifier; being inside the channel body is the signal. Writing in one tab updates every other tab on the same topic; the sync wire format is compiler-generated.
- **`broadcast()` / `disconnect()`.** Available inside any server handler in a channel's lexical scope. `broadcast(data)` fans out to every client on the active topic; `disconnect()` closes the connection. Dynamic topics via `topic=@room` re-subscribe when `@room` changes; when `@room` is `not`, the connection stays open but subscribes to nothing.
- **Nested `<program>` = Web Worker.** Put a `<program name="compute">` inside your main program and the compiler spawns a Web Worker — shared-nothing by construction. Call worker exports as typed RPC (`const result = await <#compute>.add(1, 2)`); the compiler enforces that cross-program calls are awaited.
- **Message passing with `when`.** `<#worker>.send(data)` posts to the worker; inside, `when message(data) { … }` handles it and `send(data)` replies. The parent observes lifecycle with `when message from <#worker> (data)`, `when error from <#worker> (e)`, `when terminate from <#worker>`. No manual `addEventListener('message', …)`.
- **Supervised restarts.** `restart="on-error"`, `max-restarts=3`, `within=60` on the nested `<program>` synthesize crash detection and restart bookkeeping. `autostart="false"` defers launch until `<#name>.start()`.
- **WASM modules and foreign sidecars.** The same `<program>` syntax spawns a WASM module (`lang="rust" mode="wasm"`) or a subprocess sidecar (`lang="python"`) with HTTP/socket routing — one execution-context primitive covers workers, WASM, and language FFI.

---

## Metaprogramming (`^{}`)

- **Compile-time meta.** Code that runs at compile time. `reflect()` inspects types, `emit()` generates markup, `compiler.*` registers macros. Meta blocks execute during compilation and produce source that's spliced into the AST.
- **Runtime meta.** A meta block that references `@x` reactive state runs at runtime instead of compile time. The compiler classifies each block automatically by what it references.

---

## Pure functions — `fn`

`fn` is **not** shorthand for `function` — it declares a pure function, and the compiler statically verifies five prohibitions: no SQL access, no DOM mutation, no reactive writes, no `fetch`/network, no `<request>` boundaries. Use `function` for general-purpose callables; use `fn` for deterministic computations, state factories, predicates, and transformations. (The non-deterministic touches — wall clock, randomness — live behind capability-scoped stdlib: `scrml:time.now()`, `scrml:random`; the pure scalar surface is `scrml:math`.)

---

## Styles

- **Scoped CSS (`#{}`).** Styles live next to the markup they apply to; the compiler scopes them via native CSS `@scope` keyed to the component — class names are **not** mangled, the emitted CSS is 1:1 human-readable, and styles don't leak into nested components (an implicit donut boundary, no `:deep()` needed).
- **Built-in Tailwind engine.** The compiler embeds a Tailwind utility registry. Use utility classes directly in markup; the compiler scans your HTML, resolves classes from the embedded registry, and emits only the CSS rules actually used — no Tailwind CLI, no PostCSS, no purge step.

---

## LLM agent integration — `scrml:mcp`

> V0 foundation shipped (stdlib + 11 tools + descriptor sidecars). The `<program mcp="dev-only">` adopter opt-in + end-to-end docs land in the next release.

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

The strategic frame: the same structural exhaustiveness that makes a scrml app provable to a compiler — engines as exhaustive state machines, typed enums, structural state access, explicit `rule=` contracts, whole-program inference — makes it introspectable to an agent. Other frameworks reach for LLM-friendliness at the tools layer; scrml gets it at the language layer. V0 is read-only metadata; a future V1 would add server-fn dispatch behind a capability gate.

---

## Recently landed quality wins

A short selection of silent-failure classes closed recently:

- **Precedence-preserving binary emission** — grouped expressions like `(2+3)*4` no longer drop the grouping parens during codegen (Bug W).
- **`not` keyword no longer corrupts regex literals** — the lowering pass skips regex bodies + comments + string interiors (GITI-017).
- **Runtime chunker tree-shake fix** — `_scrml_destroy_scope` declaratively pulls in its timer + animation helpers; no orphan-helper class (6nz-P).
- **Default-logic body-top writes surface loudly** — bare `@x = expr` at `<program>` body top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT` instead of silently no-op'ing (Bug Q).

The compiler is actively hardening — see [`docs/changelog.md`](./docs/changelog.md) for the full landing log.

---

## Known limitations and gaps

scrml is actively converging on its spec. A few features are designed but not yet implemented; a few are implemented with known issues; the rest is live. The full per-feature drift list — with reproducers and workarounds — lives at [`docs/known-gaps.md`](./docs/known-gaps.md). The headlines:

### Specced but not yet implemented

| Feature | Spec | What it is |
|---------|---|---|
| **Foreign code — arbitrary languages + standalone blocks** | §23 | The inline value-returning `_={…}=` **ts/js** block already ships (§23.2.4); arbitrary-language inline blocks + standalone library-mode foreign blocks remain. |
| **WASM call-char sigils** | §23.3 | Single-char sigils (`r{}`, `c{}`, `z{}`) for invoking compiled WASM functions, paired with `extern` declarations. |
| **Sidecar process declarations** | §23.4 | `use foreign:name { fn }` — server-side HTTP/socket sidecar services routed by scrml. |
| **`RemoteData` enum** | §13.5 | Built-in `Loading / Loaded(T) / Failed(Error)` for async fetch state. |
| **Build Story (`<program story=...>`)** | §58 | Content-addressed Merkle closure over the four compiler components + per-`<program>` build identity. |
| **`import:host` self-host bridge** | §21.3.1 | Bounded, manifest-gated import form for self-host bootstrap. |
| **Quoted-text body model compiler fire** | §4.18 | The spec ratifies the code-default body model + `"..."` display-text literal; the compiler fire is queued. |

### Known bugs and partial implementations

| Severity | What | Workaround |
|---|---|---|
| MED | **Tailwind utility residuals** — a small number of Tailwind utility classes don't fully resolve through the built-in engine | Write the equivalent class explicitly or use the `#{}` scoped CSS form. |
| MED | **MCP V0 partial impl** — V0.A+B+C+D shipped; V0.E (`<program mcp="dev-only">` adopter opt-in + end-to-end docs) lands next release | The compiled MCP surface runs; the adopter opt-in attribute is the last piece. |
| MED | **L19 multi-statement inline event handlers** — inline `onclick={ doA(); doB() }` is rejected (`E-MULTI-STATEMENT-HANDLER`) | Name the function: `function startOver() { doA(); doB() }` then `onclick=startOver()`. |
| LOW | **`<each>` `key=` inference fires `W-EACH-KEY-001` even when the iter-var has `.id`** — the type-introspection in the common pipeline path is conservative | Explicit `key=@.id` silences the lint and is the recommended form anyway. |
| LOW | **`bun scrml promote --engine` Tier-1 → 2 deferred** — `--match` and `--each` work; `--engine` is queued | Manual lift from `<match>` to `<engine>` — the inert `rule=` attributes at Tier 1 are the structural staging, so the lift is mechanical. |

Everything else is implemented and shipping. The live board (open HIGH / MED / LOW + Nominal features) is [`master-list.md` §0](./master-list.md); per-session landings are [`docs/changelog.md`](./docs/changelog.md).

---

## The compiler & repo

The working compiler for **scrml** is the TypeScript/JavaScript implementation that compiles `.scrml` source into HTML, CSS, client JS, and server route handlers in a single pass. What's in the tree:

- `compiler/` — compiler source, the authoritative `SPEC.md` (~33,600 lines / §61 + appendices) / `SPEC-INDEX.md` / `PIPELINE.md`, **19,000+ tests**, and reference self-host modules
- `examples/` — 27 runnable single-file scrml apps + the trucking-dispatch multi-page app
- `samples/compilation-tests/` — 800+ compilation tests covering every accepted construct
- `stdlib/` — 18 user-facing stdlib modules (`auth`, `crypto`, `data`, `format`, `fs`, `http`, `path`, `process`, `router`, `store`, `test`, `time`, `redis`, `cron`, `regex`, `math`, `random`, `oauth`)
- `benchmarks/` — runtime, build, and full-stack benchmarks vs React / Svelte / Vue
- `editors/vscode/`, `editors/neovim/` — editor integrations

The compiler runs on [Bun](https://bun.sh); compiled output is plain JavaScript that runs in any browser or JavaScript runtime.

### Benchmarks — methodology

scrml runs TodoMVC at **15.8 KB total gzip / 0 dependencies** against React 19 / Svelte 5 / Vue 3; partial-update is faster than Vanilla; build time is ~10–14× faster than Vite. Full numbers, methodology, and historical baselines: [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md). The SQL N+1 batching numbers have their own harness: [`benchmarks/sql-batching/RESULTS.md`](benchmarks/sql-batching/RESULTS.md).
