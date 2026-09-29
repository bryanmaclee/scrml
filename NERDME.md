# NERDME

The under-the-hood companion to the [README](./README.md). The README briefs every feature in a line or two and shows one app end-to-end; this file is the deep version — the mechanics, the error codes, the trade-offs, the edges. If you read the README and thought *"okay but how does that actually work,"* this is the page.

> **NERDME ≠ [DESIGN.md](./DESIGN.md).** DESIGN is the *why* — the rationale and philosophy behind the language's shape. NERDME is the *how* — the concrete mechanism of each feature. The formal truth is [`compiler/SPEC.md`](compiler/SPEC.md) (navigate via [`SPEC-INDEX.md`](compiler/SPEC-INDEX.md)); NERDME is the human-readable tour of it.

**How to read this page.** It describes the compiler as of **v0.8.0**. Every complete program shown here is a copy of a file under [`docs/readme-snippets/nerdme/`](docs/readme-snippets/nerdme/), which CI compiles on every push — if one stops compiling, the build fails. Short excerpts are labelled *fragment*. Anything marked **Specified, not shipped** is in the SPEC but not in the shipping compiler yet; anything marked **Known issue** is shipped but wrong today. The full per-feature drift list lives in [`docs/known-gaps.md`](./docs/known-gaps.md). Counts (SPEC size, tests, stdlib modules) are in [`docs/FACTS.md`](./docs/FACTS.md), which is generated from the repo — this page does not hardcode them.

---

## State and reactivity

`<count> = 0` declares a reactive cell; `@count` reads or writes it. **Declarations use the structural `<x>` form; reads and writes use the `@x` form.** The two are visually distinguishable on purpose — a reader can scan any function body and count exactly how many state cells it touches.

```scrml
<program>
<count> = 0
<userName req length(>=2)> = <input/>
const <doubled> = @count * 2
<formRes>
    <name> = ""
    <email> = ""
</>
<agree> = false
<result> = not
<button onclick={ @count = @count + 1; @formRes.email = "alice" }>+</button>
<userName/>
<input type="checkbox" bind:checked=@agree/>
<p>${@count} ${@doubled} ${@formRes.name} ${@userName}</p>
<p if=(@result is not)>none yet</p>
</>
```

- **Bare names are plain locals.** A bare identifier in an expression does *not* resolve to reactive state, and a local cannot shadow a registered state name (`E-NAME-COLLIDES-STATE`).
- **The declaration/write distinction is enforced.** A bare `@x = expr` at the body-top of a `<program>` / `<page>` / `<channel>` fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`: declarations use the structural `<x>`; writes go inside functions, handlers, or `${...}` logic.
- **Three RHS shapes.** Shape 1 plain (`<count> = 0`). Shape 2 decl-coupled-with-render-spec (`<userName req length(>=2)> = <input/>` — `<userName/>` in markup expands to the bound input with `bind:value` wired). Shape 3 derived (`const <doubled> = @count * 2` — read-only; recomputes when a dependency changes).
- **Compound state.** `<formRes> <name> = "" <email> = "" </>` — ad-hoc compound via structural children. Read `@formRes.name`; write `@formRes.email = "alice"`.
- **Two-way binding.** `bind:*` is dispatched by input kind: `<input type="checkbox">` → `bind:checked`, text inputs and `<select>` → `bind:value`.
- **Event handlers: a call or a block.** A handler is a single call (`onclick=save()`) or a braced block of statements (`onclick={ @count = @count + 1; @formRes.email = "alice" }`) — every statement runs, in order. An *unbraced* `;` sequence (`onclick=a(); b()`) is rejected with `E-MULTI-STATEMENT-HANDLER`, because its end cannot be told apart from the element's next attribute.
- **Server-pinned + protected state.** `<users server>` pins a cell server-side so it never reaches the browser. `protect="passwordHash"` on a `<db>` declaration keeps that column out of everything the client can see. Reading a protected field in client code fails the build. *Known issue:* the SPEC names that error `E-PROTECT-001`; the compiler today reports it from its final leak check as `E-CG-001` ("protected field found in client JS output"), pointing at line 1 rather than at the read.

### `not` — the one absence value

`null` and `undefined` **do not exist in scrml** — writing either is `E-SYNTAX-042`. `<result> = not` means "no value yet." Check absence with `is not`, presence with `is some`. Comparing with `== not` is `E-EQ-002` — use `is not`.

Critically, `""` / `0` / `false` / `[]` / `{}` are **defined values, not absence** — `is some "" → true`, `req "" → false`. "Empty" and "absent" are different concepts and the language keeps them apart.

---

## Engines, matches & iteration

scrml gives you a ladder for UI that depends on state, and you climb it only as far as the problem needs.

**Tier 0 — `if=`.** `<p if=(@result is not)>` mounts the element only while the condition holds (it is removed from the DOM, not hidden).

**Tier 1 — `<match>` and `<each>`.** `<match for=T on=@cell>` renders one arm per variant of an enum, and the compiler checks the arms are exhaustive. Payload variants bind their fields by name (`<Loaded rows>`). `<each in=@list key=@.id>` renders a list, with `@.` as the current item and an optional `<empty>` arm:

```scrml
<program>
type Load:enum = { Idle, Loading, Loaded(rows: number), Failed(msg: string) }
type Item:struct = { id: number, name: string }

<phase>: Load = .Idle
<items>: Item[] = [{ id: 1, name: "first" }, { id: 2, name: "second" }]

<match for=Load on=@phase>
    <Idle><button onclick={ @phase = .Loading; @phase = Load.Loaded(2) }>Load</button></>
    <Loading><p>Loading...</p></>
    <Loaded rows><p>Got ${rows} rows</p></>
    <Failed msg><p>${msg}</p></>
</match>

<ul>
    <each in=@items key=@.id>
        <li>${@.name}</li>
        <empty>Nothing yet.</>
    </each>
</ul>
</program>
```

**Tier 2 — `<engine>`.** An engine is a state machine over an enum. It declares its own cell (`<engine for=Door>` owns `@door`), each state is a child element, and `rule=` lists the states it may move to. Transitions are checked at compile time where the target is known:

```scrml
<program>
type Door:enum = { Closed, Opening, Open }

<engine for=Door initial=.Closed>
    <Closed rule=.Opening>
        <button onclick={ @door = .Opening }>Open</button>
    </>
    <Opening rule=.Open>
        Opening...
        <onTimeout after=1s to=.Open/>
    </>
    <Open rule=.Closed>
        <button onclick={ @door = .Closed }>Close</button>
    </>
</>
</program>
```

- A write to a state that `rule=` does not allow is `E-ENGINE-INVALID-TRANSITION`; an enum variant with no state child is `E-ENGINE-STATE-CHILD-MISSING`.
- `<onTimeout after=… to=…/>` schedules a transition while a state is active. The larger surface — nested sub-engines, `history` restore on re-entry, `<onTransition>`, `<onIdle>` watchdogs, internal vs external transitions — is shown in [`examples/14-mario-state-machine.scrml`](examples/14-mario-state-machine.scrml) and [`examples/29-engine-vs-flags.scrml`](examples/29-engine-vs-flags.scrml).
- `scrml promote --match` and `--each` rewrite Tier 0 code up to Tier 1 mechanically. `--engine` (Tier 1 → 2) exists too — see the known-bugs table for its current limit.

---

## Errors as states

There is no `try` / `catch` / `throw`. A function that can fail says so in its signature with `!`, names its error enum, and fails with `fail`. The caller handles each variant with a `!{ }` block, and the compiler checks that every variant is handled:

```scrml
<program>
type SignupError:enum = { EmptyName, TooShort(min: number) }
<name> = ""
<status> = ""

function checkName(n: string)! -> SignupError {
    if (n == "") { fail SignupError.EmptyName }
    if (n.length < 3) { fail SignupError.TooShort(3) }
    return n
}

function submit() {
    const ok = checkName(@name) !{
        | ::EmptyName :> { @status = "Name is required"; return }
        | ::TooShort min :> { @status = "At least " + min + " characters"; return }
    }
    @status = "Welcome, " + ok
}

<input bind:value=@name/>
<button onclick=submit()>Sign up</button>
<p>${@status}</p>
</>
```

- Failures are values, not exceptions: the handler routes each variant into state (here, a status message), which is how an error becomes something the UI renders.
- A `fail` that names a variant the declared error type does not have is `E-ERROR-009`.
- *Known issue:* the bare-variant shorthand `fail .EmptyName` is currently rejected with `E-ERROR-009`; write the qualified `fail SignupError.EmptyName`. (This is why [`examples/09-error-handling.scrml`](examples/09-error-handling.scrml) does not compile at v0.8.0.)
- In markup, `<errorBoundary fallback={…}>` is the counterpart of `!{ }`: a failable call rendered inside it shows its error variant's `renders` markup, or the boundary's `fallback`, instead of its normal output (SPEC §19.6).

---

## Linear types and the `~` accumulator

- **Exact-once consumption (`lin`).** A `lin` value must be used exactly once, with restricted visibility between declaration and consumption. The compiler verifies this statically across branches, loops, closures, and `${}` blocks. Normative surface: [SPEC §35](compiler/SPEC.md); worked example: [`examples/19-lin-token.scrml`](examples/19-lin-token.scrml).
- **The `~` pipeline accumulator.** An unbound expression statement drops its result into `~`; the next statement consumes it. `step1(x)` then `return step2(~)` — no name on a value used exactly once. `~` is itself a built-in `lin` variable (exactly-once, compiler-checked, scope-local to each function body). Misuse — read twice, read uninitialized, reinitialized before consumption — is `E-TILDE-001` / `E-TILDE-002`. See [SPEC §32](compiler/SPEC.md) and [`examples/24-tilde-pipeline.scrml`](examples/24-tilde-pipeline.scrml).

---

## Type safety — `asIs`, not `any`

scrml has **no `any` type** — no "turn off the type checker" escape hatch. `asIs` accepts any type but forces you to resolve it to a concrete type before you use or return it — analogous to TypeScript's `unknown`, not `any`. When the compiler cannot prove a type it says so (`W-TYPE-031-UNPROVEN`) rather than silently treating it as anything; annotating the declaration, or marking it `asIs` on purpose, settles it.

---

## Runtime type validation (replaces Zod)

The type annotation **is** the validation schema — no separate schema library, no `z.object()` wrappers, no `z.infer<typeof>` indirection.

```scrml
<program>
<price>: number(>0 && <10000) = 5
<email>: string(email) = "a@b.co"

type Invoice:struct = {
    amount: number(>0 && <10000)
    recipient: string(email)
}

fn discount(amount: number(>0 && <10000)) -> number {
    let discounted = amount * 0.9
    let safe: number(>0 && <10000) = discounted
    return safe
}

<p>${discount(@price)} ${@email}</p>
</>
```

The compiler uses a **three-zone enforcement model** (derived from SPARK/Ada):

| Zone | When | Cost |
|------|------|------|
| **Static** | Compiler proves the value satisfies the constraint (e.g. literals) | Zero — no runtime code emitted |
| **Boundary** | Value comes from an unproven source (user input, API response, arithmetic) | One boolean check at the assignment site |
| **Trusted** | Value was already checked in the current scope | Zero — the compiler remembers the proof |

**What is checked today (v0.8.0):**

- **The declaration.** A literal that violates the predicate is a compile error (`<c>: number(>0) = -5` → `E-CONTRACT-001`).
- **Function parameters.** `amount` above is checked once, at entry; inside the body it is trusted.
- **Typed bindings from unproven values.** `let safe: number(>0 && <10000) = discounted` gets a boundary check, because `discounted` came from arithmetic. On failure the generated check raises the runtime error `E-CONTRACT-001-RT`, naming the binding and the function.

**What is not checked today — known issue.** A later *write* to a refined cell is not checked: `<c>: number(>0) = 5`, then `@c = -5` inside a function, compiles and runs with no error. Until this is fixed, route writes through a function whose parameter carries the predicate. Tracked as `g-refinement-contract-unchecked-on-cell-write` in [known-gaps](./docs/known-gaps.md).

Built-in named shapes (the SPEC §53.6.1 registry): `email`, `url`, `uuid`, `phone`, `date`, `time`, `color`. Composable predicates (`number(>0 && <10000)`, `string(.length > 7)`) cover the same ground as Zod schemas — with zero dependencies and no separate schema language to keep in sync with your types.

---

## Type-derived apps — `formFor` / `schemaFor` / `tableFor`

One struct type drives the form, the schema, and the table — no schema duplication, no model-to-DTO translation, no view-model boilerplate.

```scrml
<program db="contacts.db">
import { formFor, schemaFor, tableFor } from "scrml:data"

type Contact:struct = {
    name:  string(.length > 0)
    email: string(email)
    phone: string(phone)?
}

<contacts>: Contact[] = []
function save(c) { @contacts = [...@contacts, c] }

<formFor for=Contact onsubmit=save/>
<schema>${ schemaFor(Contact) }</schema>
<tableFor for=Contact rows=@contacts/>
</>
```

- **`<formFor for=T>`** expands at compile time into one bound input per field, the validity surface (next sections), `<errors of=>` blocks, a submit button, and a `<form>` wired to your handler. `pick=["a","b"]` / `omit=["secret"]` / `partial=true` shape the field set per call site; `<slot name="fieldName">` overrides one field's markup. *Known issue:* the generated inputs are currently all `type="text"` — a `string(email)` field does not yet get the `type="email"` control that a hand-bound input gets (see [Free HTML validation](#free-html-validation)).
- **`schemaFor(T)`** inside `<schema>` expands the struct into table declarations — the table name is pluralized, bare-variant enum fields lower to `oneOf([...])` constraints. *Known issue:* `scrml db-migrate` does not yet see `schemaFor`-generated tables (it reports "No `<schema>` tables found"); until that is fixed, write the `<schema>` by hand for anything you migrate.
- **`<tableFor for=T rows=@list>`** renders a `<table>` with one column per field.

Add a field to `Contact` and the form and table gain it at the next build. See [`examples/26-type-derived-schema.scrml`](examples/26-type-derived-schema.scrml) and [`examples/27-type-derived-table.scrml`](examples/27-type-derived-table.scrml).

---

## Validity surface

A compound cell whose fields carry validators gets a read-only, reactive validity surface for free: `@form.isValid`, `@form.errors`, `@form.submitted`, and per field `@form.name.isValid` / `.errors` / `.touched`. `<errors of=@form.field/>` renders a field's first error, and nothing when it is valid.

```scrml
<program>
<signup>
    <name req length(>=2)>             = <input type="text"/>
    <password req length(>=8)>         = <input type="password"/>
    <confirm req eq(@signup.password)> = <input type="password"/>
</>

function submit() { }

<form onsubmit=submit()>
    <signup><name/></>
    <errors of=@signup.name/>
    <signup><password/></>
    <errors of=@signup.password/>
    <signup><confirm/></>
    <errors of=@signup.confirm/>
    <button type="submit" disabled=!@signup.isValid>Create account</button>
</form>
<p if=@signup.submitted>Account created.</p>
</program>
```

- Validators ride as bare attributes on the declaration (`req`, `length(>=N)`, `pattern(/re/)`, `eq(@other)` for cross-field checks — the full list is SPEC §55.1). You never write a `validate()` function or keep an `@isValid` boolean by hand.
- The surface is read-only: writing to it is `E-SYNTHESIZED-WRITE`.
- The longer walkthrough is [`examples/30-validated-form.scrml`](examples/30-validated-form.scrml).

---

## Free HTML validation

The same predicate that types the cell also produces browser-native form validation. On a `bind:value` input the compiler derives the matching HTML attributes. At v0.8.0:

| Predicate on the bound cell | Emitted on the `<input>` |
|---|---|
| `string(email)` | `type="email"` |
| `number(>0 && <100)` | `min="1" max="99"` (bounds are made inclusive on an integer step) |
| `string(.length > 7 && .length <255)` | `minlength="8" maxlength="254" required` |

The other named shapes map as the SPEC §53.6.1 table says (`url` → `type="url"`, `uuid` → `pattern`, `date` → `type="date"`, …). One predicate, and the browser's pre-submit check can never drift from the type. (Fragment — the cells behind these rows are declared like `<age>: number(>0 && <100) = 1` and bound with `<input type="number" bind:value=@age/>`.)

---

## Variable renaming — type-derived encoding

**Specified, not on by default.** SPEC §47 specifies a deterministic, type-derived encoding for JavaScript bindings in compiled output: `@shoppingCart` of type `Cart` would become something like `_s7km3f2x00` — underscore prefix, a kind character (`s` = struct, `p` = primitive, `e` = enum, …), an 8-character base36 FNV-1a hash of the canonical type string, and a per-scope sequence character. Because the name would carry the type, a runtime `reflect()` could recover the type descriptor from the variable alone, without shipping unused type metadata.

As of v0.8.0 the encoder exists inside the code generator but is **off by default and not exposed** on the `scrml` CLI or the compile API. Compiled output today uses readable names of the form `_scrml_<name>_<n>` (for example `_scrml_discount_3`).

---

## The Build Story (Nominal)

> **Specified, not shipped** — [SPEC §58](compiler/SPEC.md); no compiler implementation yet. `*` marks a claim not yet actual.

Compilation is a pure function of two inputs — your source and an explicit, committed **build story** that pins what "the compiler" *is*: a content-addressed Merkle closure over the compiler-proper's four components — compiler source, language tools, the standard library, and any vendored edge code — one root hash with the dependency edges *inside* the hash, plus a human-inspectable `build-story.lock` sidecar. Because every part (the compiler included) is identified by the hash of its content, customizing the compiler to your project and reproducing any build bit-for-bit\* stop being in tension: a tuned compiler is just a different pinned build story, and "pinned" is what makes it portable.

A build story can be pinned per `<program>` — `<program story="…">`\* — and because nested `<program>` contexts are isolated, shared-nothing compilation units, different parts of one application can be built by different compilers, each independently reproducible. This is deliberately **not** a live or hot-swappable compiler: every build story is static, read once before parsing begins; only *authorship* is customizable, never the running compile.

<sub>\* The bit-for-bit guarantee requires a whole-compiler determinism audit not yet done. The build-story artifact and the `<program story=>` attribute are specified in SPEC §58 but not yet implemented.</sub>

---

## Server / client split

- **Auto-split via whole-program inference.** The compiler walks the call graph and infers what runs where. Functions that touch SQL, `protect=` fields, `Bun.*`, `process.*`, or a server-only stdlib module (`scrml:auth` / `crypto` / `fs` / `store` / `redis` / `cron` / `oauth`) are classified server-side automatically, and the classification propagates through transitive call chains. The `server` keyword still parses but is redundant wherever inference can prove it — `W-DEPRECATED-SERVER-MODIFIER` fires at redundant uses, and the keyword is on a deprecation path. Never-called functions are warned (`W-DEAD-FUNCTION`) and tree-shaken.
- **SQL passthrough (`?{}`).** Query the database directly inside logic; the compiler generates parameterized queries and serialization. SQLite (`db="./app.db"`) is the default and most exercised driver; Postgres (`db="postgres://…"`, via Bun.SQL) is supported per SPEC §44 and has its own open items in [known-gaps](./docs/known-gaps.md) (for example, `NUMERIC` / `BIGINT` columns arrive as strings).
- **Automatic N+1 elimination (Tier 2).** A `for (const x of xs)` loop whose body does one `?{…WHERE col = ${x.field}}.get()` (or `.all()`) is rewritten to one pre-loop `WHERE col IN (…)` fetch plus a keyed `Map` lookup — no DataLoader, no manual batching. The benchmark measured ~1.7× / 2.3× / 3.3× at N=10/100/1000 on on-disk WAL `bun:sqlite` (2026-05-14; [benchmarks/sql-batching/RESULTS.md](benchmarks/sql-batching/RESULTS.md)). The loop variable must be used as `${x.field}` — `${id}` on a bare loop value is not matched. *Known issue:* the rewrite keys its lookup map by the `WHERE` column, so that column must also appear in the `SELECT` list; `SELECT name … WHERE id = ${x.id}` currently makes every lookup come back empty. Select the key column (`SELECT id, name …`) until this is fixed.
- **Implicit transaction envelopes (Tier 1).** Independent reads in one handler share one `BEGIN DEFERRED`..`COMMIT` for snapshot consistency under concurrent writers. Explicit `transaction { }` blocks are left alone; `W-BATCH-001` fires if the two would conflict.
- **Mount-hydration coalescing.** Multiple on-mount `<x server>` loads on one page fold into a single round-trip (§8.11) instead of one request per variable.
- **Opt-out per call site.** `?{...}.nobatch()` disables rewriting when you need an exact query shape (`EXPLAIN`, measured hot paths).
- **Diagnostics, not silent magic.** `D-BATCH-001` flags near-miss loops that *almost* batch but don't, with the exact disqualifier. `E-BATCH-001` rejects `.nobatch()` composition with batched siblings; `E-BATCH-002` guards the 32 766 `SQLITE_MAX_VARIABLE_NUMBER` ceiling at runtime.
- **No API boilerplate.** Server functions are called like local functions; the compiler generates the routes, the fetch calls, and serialization.
- **CSRF — what you get by default.** With no `auth=` on the `<program>`, state-mutating routes get a compiler-generated double-submit-cookie check. With `auth="required"` and **no** `csrf=` attribute, the generated server has **no CSRF check at all**. Add `csrf="auto"` next to `auth=` to get session-bound synchronizer-token validation (`<program db="app.db" auth="required" csrf="auto">`). If you use `auth=`, set `csrf="auto"`.
- **Per-route per-role chunk splitting (opt-in).** With `scrml compile --emit-per-route` (off by default), whole-stack closure analysis (§40) computes which component code, server functions and stdlib units each entry point and role can reach, and emits per-route JS chunks with FNV-1a content-hashed filenames (§47) so caches stay valid when source bytes don't change. `<auth role="Admin">` narrows **JavaScript** only: the gated markup is still emitted into the HTML that every visitor receives, and the compiler says so (`W-AUTH-CONTENT-NOT-GATED`). `<auth role>` is not a way to keep content secret — decide what to send on the server, in a server function or page loader that checks the role.

---

## Client navigation

`navigate(path)` moves between routes. From client code it is a **soft** navigation: the runtime fetches the target route's server-rendered HTML, swaps it into the `<outlet>` of a persistent `<program>` shell, loads any client chunk that route needs, and hydrates it — no full reload, no router library, and shell state (navigation, sidebars, counters) survives. From server code it is a 302 redirect. `navigate(path, .Hard)` / `navigate(path, .Soft)` override the inference.

```scrml
<program>
<nav>
    <a href="/">Home</a>
    <a href="/settings">Settings</a>
    <a href="/logout" hard>Log out</a>
</nav>
<button onclick=navigate("/settings")>Open settings</button>
<outlet/>
</program>
```

- Internal `<a href>` links are soft-navigated by default; the boolean `hard` attribute opts one out (logout and auth redirects are the usual cases). External links, `target="_blank"`, `download`, `mailto:` and modified clicks pass through untouched.
- Routes are filesystem-inferred: in a multi-page app each route is a `pages/*.scrml` file (or a `<page>` child of the program), and its content composes into `<outlet/>`. There is no `route=` attribute.
- One flat `<outlet>` per shell (`E-OUTLET-DUPLICATE` for a second). A multi-page project with no `<outlet>` falls back to hard navigation (`W-OUTLET-ABSENT-SOFT-NAV-DISABLED`).
- **Specified, not shipped:** `<page keep-alive>` is accepted but does not cache yet, and nested outlets are future work. Normative source: SPEC §20.8.

---

## Realtime and workers

- **WebSocket channels (`<channel>`).** A lifecycle element that declares a WebSocket endpoint. The compiler emits the Bun upgrade route, a client-side connection manager with reconnect, and pub/sub topic routing. `onserver:open` / `:message` / `:close` run server-side; `onclient:open` / `:close` / `:error` run in the browser. `auth="required"` on the channel gates the upgrade with a session check. No WebSocket or Bun-specific API appears in your source.
- **Shared reactive state inside channels.** State declared inside a `<channel>` body (`<messages> = []`) syncs across every connected client — being inside the channel body is the signal. Writing in one tab updates every other tab on the same topic; the wire format is compiler-generated.
- **`broadcast()` / `disconnect()`.** Available inside any server handler in a channel's lexical scope. `broadcast(data)` fans out to every client on the channel's topic; `disconnect()` closes the connection.
- **Topics are static strings today.** `name=` and `topic=` take string literals. SPEC §38 also specifies a dynamic `topic=@room` that re-subscribes when `@room` changes; *known issue:* the v0.8.0 compiler does not implement it and silently uses the literal text `room` as the topic, with no diagnostic. Do not use `topic=@var` yet.
- **Nested `<program>` = Web Worker — broken in v0.8.0.** The SPEC (§4.12, §43) makes a `<program name="compute">` nested in your app a shared-nothing Web Worker, with message passing (`<#compute>.send(data)` in the parent; `when message(data) { … send(reply) }` inside the worker; `when message from <#compute> (data)` back in the parent), typed RPC (`<#compute>.add(1, 2)`), and supervised restarts (`restart="on-error"`, `max-restarts=3`, `within=60`, `autostart="false"`). In v0.8.0 **none of this runs**: the client bundle references `compute.worker.js`, but that file is never written to the output directory, so the worker fails to load (tracked as `g-nested-program-emits-artifacts-it-never-produces`). The RPC call form is additionally miscompiled — `@r = <#compute>.add(1, 2)` compiles and sets `@r` to nothing, and `const result = <#compute>.add(1, 2)` fails with `E-CODEGEN-INVALID-LOGIC`. [`examples/13-worker.scrml`](examples/13-worker.scrml) shows the message-passing shape; it compiles, and hits the same missing-file problem at runtime.
- **WASM modules and foreign sidecars — specified, not shipped.** SPEC §23.3 / §23.4 extend the same `<program>` primitive to WASM modules (`lang="rust" mode="wasm"`, call-char sigils like `r{ … }`) and out-of-process sidecars (`lang="python"`, `use foreign:name { fn }`). The compiler refuses the source forms honestly: a call-char sigil is `E-WASM-NOMINAL` and a `use foreign:` declaration is `E-FOREIGN-SIDECAR-NOMINAL`. A nested `<program lang=…>` or `mode="wasm"` on its own is not refused — it compiles into the same worker reference described above and does nothing useful; don't use it yet.

---

## Metaprogramming (`^{}`)

- **Compile-time meta.** Code that runs at compile time. `reflect()` inspects types, `emit()` generates markup, `compiler.*` registers macros. Meta blocks execute during compilation and produce source that's spliced into the AST. See [`examples/11-meta-programming.scrml`](examples/11-meta-programming.scrml).
- **Runtime meta.** A meta block that references `@x` reactive state runs at runtime instead of compile time. The compiler classifies each block automatically by what it references.

---

## Pure functions — `fn`

`fn` is **not** shorthand for `function` — it declares a pure function, and the compiler statically enforces SPEC §48.3's body prohibitions:

| Inside an `fn` body | Error |
|---|---|
| SQL (`?{}`) | `E-FN-001` |
| DOM mutation | `E-FN-002` |
| Writing outer-scope or reactive state (`@x = …`), or calling a non-`fn` function | `E-FN-003` |
| Non-determinism (`Date.now()`, `Math.random()`, reading `window` / `document` / `location`) | `E-FN-004` |
| `async` / `await` | `E-FN-005` |

Use `function` for general-purpose callables; use `fn` for deterministic computations, predicates and transformations. The non-deterministic touches live behind capability-scoped stdlib — `scrml:time` (`now()`), `scrml:random` — and the pure scalar surface is `scrml:math`. *Known issue:* the "calling a non-`fn` function" limb does not yet catch host calls — `fetch(u)` inside an `fn` currently compiles.

---

## Styles

- **Scoped CSS (`#{}`) — where you put it decides its reach.** A `#{}` block *inside a component* is scoped with native CSS `@scope`: `@scope ([data-scrml="Card"]) to ([data-scrml])` — class names are **not** mangled, the emitted CSS is readable 1:1, and the `to (…)` limit stops the styles at nested components. A `#{}` block at the **program level** is global (emitted into `@layer global`). There is no `:deep()`.
- **Flat specificity.** An unconditional same-property conflict on an element that two rules provably both hit is a compile error, `E-STYLE-CONFLICT`, rather than a silent last-rule-wins.
- **Built-in Tailwind engine.** The compiler embeds a Tailwind utility registry. Use utility classes directly in markup; the compiler resolves them from the embedded registry and emits only the CSS rules actually used — no Tailwind CLI, no PostCSS, no purge step.

---

## LLM agent integration — `scrml:mcp`

scrml ships a Model Context Protocol surface so an LLM agent can read your app's structure first-hand instead of guessing. Opt in on the root program:

```scrml
<program mcp="dev-only">
```

(Fragment.) With that attribute the build writes descriptor sidecars next to the output — `engines.json`, `forms.json`, `channels.json`, `serverfns.json`, `chunks.json` — turns on per-route emission, and bundles the `scrml:mcp` stdlib, which serves them over MCP stdio as 11 read-only tools:

| Tool | Surfaces |
|---|---|
| `get_app_topology` | the whole `<program>` tree shape |
| `list_engines` / `get_engine` | engine state machines + current variant + legal transitions |
| `list_forms` / `get_form_status` | form validity surfaces + per-field touched / errors |
| `list_routes` / `get_route_chunks` | route table + which chunks each route loads |
| `list_server_functions` | enumerable server-function surface (read-only — `dispatchable: false`) |
| `list_channels` / `get_channel_state` | active WebSocket channels + shared state |
| `get_reachable_server_fns` | per-route reachable server-function closure |

The strategic frame: the same structural exhaustiveness that makes a scrml app checkable by a compiler — engines as exhaustive state machines, typed enums, structural state access, explicit `rule=` contracts, whole-program inference — makes it introspectable to an agent. This version is read-only metadata; calling server functions through MCP is not supported.

---

## Recently landed quality wins

A selection from the last releases (details in [`docs/changelog.md`](./docs/changelog.md)):

- **Inline block handlers run every statement.** `onclick={ a(); b() }` is legal and canonical; every statement runs in every position (including inside `<each>` rows), and an unbraced `;` sequence is a clear error instead of being half-compiled into attributes.
- **`defer` statement** (SPEC §19.16) — `defer <stmt>` runs on every exit from the enclosing block, including `return` and `fail`, in last-in-first-out order.
- **`class` and dynamic `import()` are rejected** with dedicated errors (`E-CLASS-NOT-IN-SCRML`, `E-DYNAMIC-IMPORT-NOT-IN-SCRML`) instead of passing through as JavaScript.
- **Dates and other built-ins in reactive cells** no longer break the page, and `==` compares them by value.
- **Security: nested async helpers** can no longer slip past the fail-closed guards on synchronous callbacks (e.g. `xs.some(x => inner(x))`).
- **Raw-text rewrites no longer corrupt string and regex literals** (the `~` rewrite and three siblings).
- **Database connection secrets never reach compiler output.**
- **A braceless `else` no longer runs unconditionally** in function bodies.

---

## Known limitations and gaps

scrml is converging on its spec. Some features are specified but not built; some are built with known issues. The full per-feature drift list — with reproducers and workarounds — is [`docs/known-gaps.md`](./docs/known-gaps.md). The headlines as of v0.8.0:

### Specced but not yet implemented

| Feature | Spec | What it is |
|---------|---|---|
| **Declarations, instances and value contracts** | §66 | The next declaration model (`<let x:int=0/>`, locked-by-default values, components and engines as declarations). The shipping compiler does not compile it; an in-progress second implementation (`compiler/self-host-v2/`) implements slices. |
| **Foreign code — arbitrary languages + standalone blocks** | §23 | The inline value-returning `_={…}=` **ts/js** block ships (§23.2.4); arbitrary-language inline blocks and standalone library-mode foreign blocks do not. |
| **WASM call-char sigils** | §23.3 | `r{}` / `c{}` / `z{}` sigils plus `extern` declarations for calling compiled WASM. Refused with `E-WASM-NOMINAL`. |
| **Sidecar process declarations** | §23.4 | `use foreign:name { fn }` — server-side HTTP/socket sidecar services. Refused with `E-FOREIGN-SIDECAR-NOMINAL`. |
| **Type-derived variable names** | §47 | Encoder present but off by default and not exposed (see [above](#variable-renaming--type-derived-encoding)). |
| **Build Story (`<program story=...>`)** | §58 | Content-addressed Merkle closure over the four compiler components + per-`<program>` build identity. |
| **Quoted-text body model** | §4.18 | The spec ratifies a code-default body model + `"..."` display-text literal; the compiler does not enforce it yet. |
| **Soft-nav keep-alive, nested outlets** | §20.8.4 | `<page keep-alive>` is accepted but caches nothing; one flat `<outlet>` only. |

### Known bugs and partial implementations

| Severity | What | Workaround |
|---|---|---|
| HIGH | **Writes to a refined cell are not checked** — `@c = -5` on `<c>: number(>0)` is accepted. | Route writes through a function whose parameter carries the predicate. |
| HIGH | **Nested-`<program>` workers don't run** — the worker file is never written; RPC calls miscompile. | None in v0.8.0; keep the work on the main thread. |
| HIGH | **`fail .Variant` shorthand rejected** with `E-ERROR-009`. | Write the qualified `fail Type.Variant`. |
| HIGH | **`auth="required"` without `csrf=` has no CSRF check.** | Always pair `auth=` with `csrf="auto"`. |
| MED | **`topic=@var` on `<channel>` is silently a literal.** | Use a static topic string. |
| MED | **N+1 rewrite needs the key column in `SELECT`**, otherwise lookups come back empty. | Select the `WHERE` column too. |
| MED | **`scrml db-migrate` ignores `schemaFor`-generated tables.** | Hand-write the `<schema>` for migrated tables. |
| MED | **Tailwind utility residuals** — a small number of utility classes don't fully resolve through the built-in engine. | Write the equivalent class explicitly or use a `#{}` block. |
| LOW | **`<each>` fires `W-EACH-KEY-001` even when the item type has `.id`.** | Explicit `key=@.id` silences it and is the recommended form anyway. |
| LOW | **`scrml promote --engine` fails when the matched cell is declared separately** — the rewrite collides with the engine's own cell (`E-ENGINE-VAR-DUPLICATE`) and leaves the file untouched. | Lift `<match>` to `<engine>` by hand and delete the separate cell declaration. |

The recent landing log is [`docs/changelog.md`](./docs/changelog.md).

---

## The compiler & repo

The working compiler for **scrml** is the TypeScript/JavaScript implementation that compiles `.scrml` source into HTML, CSS, client JS, and server route handlers. Sizes and counts for everything below are generated in [`docs/FACTS.md`](./docs/FACTS.md) — compiler source lines, test files, SPEC lines, conformance cases, stdlib modules, CLI verbs.

- `compiler/` — compiler source, the authoritative `SPEC.md` / `SPEC-INDEX.md` / `PIPELINE.md`, and the test suite
- `compiler/self-host-v2/` — an in-progress second implementation that tracks the newer SPEC sections
- `conformance/` — language conformance cases, each an expected-output assertion any implementation must pass
- `examples/` — numbered runnable single-file apps, plus a multi-file and a multi-page (trucking-dispatch) app
- `samples/compilation-tests/` — compilation tests covering accepted and rejected constructs
- `stdlib/` — the bundled `scrml:*` standard library (module list in [FACTS](./docs/FACTS.md))
- `benchmarks/` — runtime, bundle-size, build and SQL-batching benchmarks
- `editors/vscode/`, `editors/neovim/` — editor integrations

The compiler runs on [Bun](https://bun.sh); compiled output is plain JavaScript that runs in any browser or JavaScript runtime.

### Benchmarks — methodology

The latest measurement in [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) is dated **2026-09-05**, and it is not flattering:

- **Bundle size (TodoMVC, gzip):** scrml **48.8 KB total** (47.0 KB JS) with **0 dependencies** — larger than Svelte 5 (17.1 KB) and Vue 3 (27.8 KB), smaller than React 19 (62.8 KB). The framework rows are their 2026-05-19 production builds re-measured the same day. scrml's JS grew about 2.4× between May and September.
- **Build time:** scrml compiles the TodoMVC app in about **54 ms**. The Vite builds of the other frameworks were not re-measured on that date, so no current ratio is claimed here.
- **Runtime:** no current number. On 2026-09-05 the benchmark app compiled but did not render (a defect since fixed), so runtime was not measurable at that commit; the runtime tables have not been re-run since.

The SQL N+1 batching numbers have their own harness: [`benchmarks/sql-batching/RESULTS.md`](benchmarks/sql-batching/RESULTS.md).
