# NERDME

<!-- dialect: ruled -->

The under-the-hood companion to the [README](./README.md). The README briefs every feature in a line or two and shows one app end-to-end; this file is the deep version — the mechanics, the error codes, the trade-offs, the edges. If you read the README and thought *"okay but how does that actually work,"* this is the page.

> **NERDME ≠ [DESIGN.md](./DESIGN.md).** DESIGN is the *why* — the rationale and philosophy behind the language's shape. NERDME is the *how* — the concrete mechanism of each feature. The formal truth is [`compiler/SPEC.md`](compiler/SPEC.md) (navigate via [`SPEC-INDEX.md`](compiler/SPEC-INDEX.md)); NERDME is the human-readable tour of it.

**How to read this page.** It teaches **today's ruled scrml**, the language the SPEC defines: §66 declarations, `;` at the end of every statement, comma-separated arms, tapes with grants, explicit `return`. Every complete program shown here is a copy of a file under [`docs/readme-snippets/nerdme/`](docs/readme-snippets/nerdme/), and CI compiles each one with the **bootstrap** compiler (`compiler/self-host-v2/`, run as `bun run boot:compile`) on every push. A drift check fails the build if a block and its file ever differ. The bootstrap does not build the whole language yet. Where a program uses something it lacks, the text says so, and the gate expects exactly the bootstrap's current refusal. Short excerpts are labelled *fragment*. The error codes named here are the SPEC's; the bootstrap may report a different code for the same refusal (for `null` it says `E-PARSE-NO-NULL`, where the SPEC says `E-SYNTAX-042`).

Much of what this page describes the compiler *writing* (server routes, CSRF checks, SQL batching, per-route chunks, MCP descriptors, workers) is built today only by **impl#1**, the first compiler (the `scrml` command). impl#1 is frozen in an older dialect and does not parse the ruled one; [README → What changed from the older dialect](./README.md#what-changed-from-the-older-dialect) shows the differences. A note marked **impl#1** is about that compiler. **Specified, not built** means neither compiler does it yet. The full per-feature drift list lives in [`docs/known-gaps.md`](./docs/known-gaps.md). Counts (SPEC size, tests, stdlib modules) are in [`docs/FACTS.md`](./docs/FACTS.md), which is generated from the repo — this page does not hardcode them.

---

## State and reactivity

`let <count:int=0/>` declares a reactive cell; `@count` reads or writes it. **Declarations use the structural `<x … />` form; reads and writes use the `@x` form.** The two are visually distinguishable on purpose — a reader can scan any function body and count exactly how many state cells it touches.

<!-- snippet: docs/readme-snippets/nerdme/state-and-reactivity.scrml -->
```scrml
// NERDME.md "State and reactivity" — compiled by the bootstrap (scripts/snippet-gate.js).
// If this stops compiling, the NERDME section citing it is making a false claim.
<program>

let <count:int=0/>
<doubled:int=(@count * 2)/>

<profile:struct>
    let <name:string="" req length(>=2)/>
    renders <input type="text" bind:value=@name/>
    let <email:string=""/>
</>
renders <label>Name <*name/></label>

let <agree:bool=false/>
let <result:int | not=not/>

<main>
    <button onclick={ @count = @count + 1; @profile.email = "alice"; }>+</button>
    <*profile/>
    <input type="checkbox" bind:checked=@agree/>
    <p>${@count} ${@doubled} ${@profile.name} ${@profile.email}</p>
    <p if=(@result is not)>none yet</p>
</main>

</program>
```

- **Locked by default.** A declaration is a constant unless `let` stands before its `<`. `let <count:int=0/>` is writable; `<step=1/>` would be locked, and writing it is `E-WRITE-NOT-GRANTED`. The type is inferred from the initializer: a literal (an integer literal infers `int`), a typed `@ref`, arithmetic or a comparison over those, or a call with a declared return, so `let <next=(@count + 1)/>` is an `int`. Where it cannot be inferred, `:T` is needed (`E-DECL-TYPE-NOT-INFERABLE`; SPEC §66.3 rules 5–10, §66.9).
- **Derived values.** `<doubled:int=(@count * 2)/>` is a locked declaration whose initializer reads another cell, so it recomputes when `@count` changes. Writing it is `E-DERIVED-WRITE`. An initializer that is not a literal or a plain `@ref` goes in parentheses (`E-DECL-OPENER-EXPR-UNPARENTHESIZED`).
- **Compound state.** `<profile:struct>` holds child declarations, each with its own `let`, validators and `renders`. Read `@profile.name`; write `@profile.email = "alice";`. `<*profile/>` renders the shared instance, and inside its `renders`, `<*name/>` renders that field's input with `bind:value` wired (SPEC §66.4–§66.6).
- **Bare names are plain locals.** A bare identifier in an expression does *not* resolve to reactive state, and a local cannot shadow a registered state name (`E-NAME-COLLIDES-STATE`). The bootstrap does not check that yet: it accepts `let count = 5;` in a function next to `@count`.
- **Two-way binding.** `bind:*` is dispatched by input kind: `<input type="checkbox">` → `bind:checked`, text inputs and `<select>` → `bind:value`. Bad text in an input bound to a number cell is not written; the cell keeps its last good value. The bootstrap binds string places only so far; `bind:value` to an `int` or `number` cell is not in it yet (`E-BOOTSTRAP-UNSUPPORTED`).
- **Event handlers: a call or a block.** A handler is a single call (`onclick=save()`) or a braced block of statements (`onclick={ @count = @count + 1; @profile.email = "alice"; }`). Every statement ends in `;` and every statement runs, in order. An *unbraced* `;` sequence (`onclick=a(); b()`) is rejected (the SPEC's code is `E-MULTI-STATEMENT-HANDLER`; the bootstrap reports it as a parse error), because its end cannot be told apart from the element's next attribute.
- **Server-pinned + protected state.** `server` on a declaration (`<count:int=0 server/>`) makes its shared instance server-authoritative (SPEC §66.16). `protect="passwordHash"` on a `<db>` declaration keeps that column out of everything the client can see, and reading a protected field in client code fails the build. *impl#1:* the SPEC names that error `E-PROTECT-001`; impl#1 reports it from its final leak check as `E-CG-001` ("protected field found in client JS output"), pointing at line 1 rather than at the read. The bootstrap has neither yet.

### `not` — the one absence value

`null` and `undefined` **do not exist in scrml** — writing either is `E-SYNTAX-042`. `let <result:int | not=not/>` means "no value yet". Check absence with `is not` and presence with `is given`. Comparing with `== not` is `E-EQ-002` — use `is not`.

Critically, `""` / `0` / `false` / an empty tape / `{}` are **defined values, not absence** — `"" is given` is true, and `req` refuses `""`. "Empty" and "absent" are different concepts and the language keeps them apart.

---

## Engines, matches & iteration

scrml gives you a ladder for UI that depends on state, and you climb it only as far as the problem needs.

**Tier 0 — `if=`.** `<p if=(@result is not)>` mounts the element only while the condition holds (it is removed from the DOM, not hidden). The condition must be a boolean or a presence test; `if=@count` on a number is `E-COND-NOT-BOOLEAN`.

**Tier 1 — `match` and `<each>`.** `match` on an enum value picks one arm per variant, and the compiler checks the arms are exhaustive. Arms are a comma-separated list, a trailing comma allowed. Payload variants bind their fields (`.Loaded(n)`). `<each in=@items as it key=it.id>` renders a tape, one row per item:

<!-- snippet: docs/readme-snippets/nerdme/match-and-each.scrml -->
```scrml
// NERDME.md "Engines, matches & iteration" (Tier 1, value form) — compiled by the bootstrap.
<program>

type Load:enum = { Idle, Loading, Loaded(rows: int), Failed(msg: string) }
type Item:struct = { id: int, name: string }

let <phase:Load=.Idle/>
<items:Item[]=([{ id: 1, name: "first" }, { id: 2, name: "second" }])/>

<status:string=(match @phase {
    .Idle        :> "idle",
    .Loading     :> "loading…",
    .Loaded(n)   :> `got ${n} rows`,
    .Failed(msg) :> msg,
})/>

<main>
    <p>${@status}</p>
    <button onclick={ @phase = .Loading; }>Load</button>
    <ul>
        <each in=@items as it key=it.id>
            <li>${it.name}</li>
        </each>
    </ul>
</main>

</program>
```

`<items:Item[]=(…)/>` is a tape with no grants, so it is immutable: no statement anywhere can add, remove or rewrite an item. A block arm that runs statements yields its value with `lift` (`.Idle :> { log(); lift "idle"; }`); a bare last expression after a statement is `E-ARM-TAIL-VALUE`. `<each>` also takes an `<empty>` arm for the no-items case (SPEC §17.7.4), which the bootstrap does not have yet.

When each variant needs its own markup, the `<match>` element renders one child per variant:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TAG] — the bootstrap has no <match> block element and cannot construct a payload variant (Load.Loaded(2)) as a value yet -->
<!-- snippet: docs/readme-snippets/nerdme/match-block.scrml -->
```scrml
// NERDME.md "Engines, matches & iteration" (Tier 1, the <match> element) — ruled; spec-ahead on the bootstrap.
<program>

type Load:enum = { Idle, Loading, Loaded(rows: int), Failed(msg: string) }

let <phase:Load=.Idle/>

function load() {
    @phase = .Loading;
    @phase = Load.Loaded(2);
}

<match for=Load on=@phase>
    <Idle><button onclick=load()>Load</button></Idle>
    <Loading><p>Loading…</p></Loading>
    <Loaded(rows)><p>Got ${rows} rows</p></Loaded>
    <Failed(msg)><p>${msg}</p></Failed>
</match>

</program>
```

**Tier 2 — engines.** An engine is a state machine over an enum. It is a declaration marked `single`, and its name is its variable (`<door:Door=.Closed single>` owns `@door`). Each state is a child element, and `rule=` lists the states it may move to:

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-TRAILING] — the bootstrap has no <onTimeout> and no duration literals (1s) yet -->
<!-- snippet: docs/readme-snippets/nerdme/engine.scrml -->
```scrml
// NERDME.md "Engines, matches & iteration" (Tier 2) — ruled; spec-ahead on the bootstrap (<onTimeout>).
<program>

type Door:enum = { Closed, Opening, Open }

<door:Door=.Closed single>
    <Closed rule=.Opening>
        <button onclick={ @door = .Opening; }>Open</button>
    </>
    <Opening rule=.Open>
        "Opening…"
        <onTimeout after=1s to=.Open/>
    </>
    <Open rule=.Closed>
        <button onclick={ @door = .Closed; }>Close</button>
    </>
</>

<main>
    <*door/>
</main>

</program>
```

- `<*door/>` renders the engine's current state ("the existing one"); a plain `<door/>` of a `single` declaration is `E-DECL-SINGLE-INSTANTIATED`. The older dialect wrote this engine as an `<engine for=Door initial=.Closed>` element.
- A write to a state that `rule=` does not allow is refused. The SPEC makes it a compile error where the target is known (`E-ENGINE-INVALID-TRANSITION`). The bootstrap checks each write against the `rule=` edges at run time, and does not have the compile-time check yet.
- `<onTimeout after=… to=…/>` schedules a transition while a state is active; the bootstrap does not have it yet. The larger surface — composite states, `history` restore on re-entry, `<onTransition>`, `<onIdle>` watchdogs, internal vs external transitions — is in SPEC §51 and §66.13.
- *impl#1:* `scrml promote --match` and `--each` rewrite Tier 0 code up to Tier 1 mechanically, in the older dialect. `--engine` (Tier 1 → 2) exists too — see the known-bugs table for its current limit.

---

## Errors as states

There is no `try` / `catch` / `throw`. A function that can fail says so in its signature with `!`, names its error enum, and fails with `fail`. The caller handles each variant with a `!{ }` block, and the compiler checks that every variant is handled:

<!-- snippet: docs/readme-snippets/nerdme/errors-as-states.scrml -->
```scrml
// NERDME.md "Errors as states" — compiled by the bootstrap (scripts/snippet-gate.js).
<program>

type SignupError:enum = { EmptyName, TooShort(min: int) }

let <name:string=""/>
let <status:string=""/>

function checkName(n: string)! -> SignupError {
    if (n == "") { fail .EmptyName; }
    if (n.length < 3) { fail .TooShort(3); }
    return n;
}

function submit() {
    let ok: string = checkName(@name) !{
        .EmptyName     :> { @status = "Name is required"; return; },
        .TooShort(min) :> { @status = `At least ${min} characters`; return; },
    };
    @status = `Welcome, ${ok}`;
}

<main>
    <input bind:value=@name/>
    <button onclick=submit()>Sign up</button>
    <p>${@status}</p>
</main>

</program>
```

- Failures are values, not exceptions: the handler routes each variant into state (here, a status message), which is how an error becomes something the UI renders.
- `fail .EmptyName;` names the variant against the function's declared error type; `fail SignupError.EmptyName;` is the same. A `fail` that names a variant the declared error type does not have is `E-ERROR-009`, and `fail` in a function without `!` is `E-ERROR-001`. *impl#1* rejects the bare shorthand with `E-ERROR-009`, so older-dialect code writes the qualified form.
- Text is built with a template (`` `At least ${min} characters` ``), never with `+` across types. The typed local (`let ok: string = …`) is what lets the template know `ok` is text; an untyped value in a template slot is `E-TEXT-NON-PRIMITIVE`.
- A function that can fail and runs on the server can also fail in transit, so a client-side `!{}` on it needs a `.Transport` arm (or `_`).
- In markup, `<errorBoundary fallback={…}>` is the counterpart of `!{ }`: a failable call rendered inside it shows its error variant's `renders` markup, or the boundary's `fallback`, instead of its normal output (SPEC §19.6).

---

## Linear types and the `~` accumulator

- **Exact-once consumption (`lin`).** A `lin` value must be used exactly once, with restricted visibility between declaration and consumption. The compiler verifies this statically across branches, loops, closures, and `${}` blocks. Normative surface: [SPEC §35](compiler/SPEC.md); the walkthrough is [`docs/lin.md`](docs/lin.md). The bootstrap does not have `lin` yet.
- **The `~` pipeline accumulator (impl#1 only).** An unbound expression statement drops its result into `~`; the next statement consumes it. `step1(x);` then `return step2(~);` — no name on a value used exactly once. `~` is itself a built-in `lin` variable (exactly-once, compiler-checked, scope-local to each function body). Misuse — read twice, read uninitialized, reinitialized before consumption — is `E-TILDE-001` / `E-TILDE-002`. See [SPEC §32](compiler/SPEC.md). The bootstrap does not have `~` yet (`E-PARSE-EXPR`).

---

## Type safety — `asIs`, not `any`

scrml has **no `any` type** — no "turn off the type checker" escape hatch. `asIs` accepts any type but forces you to resolve it to a concrete type before you use or return it — analogous to TypeScript's `unknown`, not `any`. Where a local's type cannot be proven the compiler says so (`W-TYPE-031-UNPROVEN`) rather than silently treating it as anything; annotating the declaration, or marking it `asIs` on purpose, settles it. A declaration's own value is stricter: one whose type cannot be inferred is an error, `E-DECL-TYPE-NOT-INFERABLE` (SPEC §66.3). Function parameters are always annotated (`E-PARAM-TYPE-REQUIRED`; the bootstrap refuses an unannotated one with `E-BOOTSTRAP-UNSUPPORTED`).

Conversions that can fail or lose information are spelled out. Text becomes a number only through `int.parse(s)` / `number.parse(s)`, which return `int | not` / `number | not` and parse the whole string strictly (`"12px"` is `not`). A `number` becomes an `int` only through `floor`, `ceil`, `trunc` or `round(x, .Mode)`. Going into text is implicit only for a primitive in a text position (markup, a template).

---

## Runtime type validation (replaces Zod)

The type annotation **is** the validation schema — no separate schema library, no `z.object()` wrappers, no `z.infer<typeof>` indirection.

<!-- gate: spec-ahead [E-DECL-STATE-CHILD, E-PARSE-CLOSER, E-PARSE-DECL-BODY, E-PARSE-TAG, E-PARSE-UNCLOSED, E-SCOPE-001] — the bootstrap has no refinement types (number(>0 && <10000), string(email)) in an opener, a struct field or a parameter yet; the first opener's parse failure cascades through the file -->
<!-- snippet: docs/readme-snippets/nerdme/refinement.scrml -->
```scrml
// NERDME.md "Runtime type validation" — ruled; spec-ahead on the bootstrap (no refinement types yet).
<program>

<price:number(>0 && <10000)=5/>
<email:string(email)="a@b.co"/>

type Invoice:struct = {
    amount: number(>0 && <10000),
    recipient: string(email),
}

fn discount(amount: number(>0 && <10000)) -> number {
    let discounted = amount * 0.9;
    let safe: number(>0 && <10000) = discounted;
    return safe;
}

<main>
    <p>${discount(@price)} ${@email}</p>
</main>

</program>
```

The compiler uses a **three-zone enforcement model** (derived from SPARK/Ada):

| Zone | When | Cost |
|------|------|------|
| **Static** | Compiler proves the value satisfies the constraint (e.g. literals) | Zero — no runtime code emitted |
| **Boundary** | Value comes from an unproven source (user input, API response, arithmetic) | One boolean check at the assignment site |
| **Trusted** | Value was already checked in the current scope | Zero — the compiler remembers the proof |

**What impl#1 checks today** (older dialect; the rules are the SPEC's, §53):

- **The declaration.** A literal that violates the predicate is a compile error (`E-CONTRACT-001`).
- **Function parameters.** `amount` above is checked once, at entry; inside the body it is trusted.
- **Typed bindings from unproven values.** `let safe: number(>0 && <10000) = discounted;` gets a boundary check, because `discounted` came from arithmetic. On failure the generated check raises the runtime error `E-CONTRACT-001-RT`, naming the binding and the function.

**What impl#1 does not check — known issue.** A later *write* to a refined cell is not checked: a cell declared `number(>0)` with the value 5, then written `-5` inside a function, compiles and runs with no error. Route writes through a function whose parameter carries the predicate. Tracked as `g-refinement-contract-unchecked-on-cell-write` in [known-gaps](./docs/known-gaps.md).

Built-in named shapes (the SPEC §53.6.1 registry): `email`, `url`, `uuid`, `phone`, `date`, `time`, `color`. Composable predicates (`number(>0 && <10000)`, `string(.length > 7)`) cover the same ground as Zod schemas — with zero dependencies and no separate schema language to keep in sync with your types.

---

## Type-derived apps — `formFor` / `schemaFor` / `tableFor`

One struct type drives the form, the schema, and the table — no schema duplication, no model-to-DTO translation, no view-model boilerplate.

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-PARSE-EXPECTED, E-PARSE-TYPE, E-TYPE-UNKNOWN] — the bootstrap has no refinement types on struct fields (string(email)), no <schema> and no <formFor> / <tableFor> yet -->
<!-- snippet: docs/readme-snippets/nerdme/type-derived.scrml -->
```scrml
// NERDME.md "Type-derived apps" — ruled; spec-ahead on the bootstrap (no refinement types, <schema>, <formFor>, <tableFor>).
<program db="contacts.db">

import { formFor, schemaFor, tableFor } from "scrml:data";

type Contact:struct = {
    name:  string(.length > 0),
    email: string(email),
    phone: string(phone) | not,
}

<schema>
    ${ schemaFor(Contact) }
</>

<contacts:Contact[free, append]=[]/>

function save(c: Contact) {
    @contacts.append(c);
}

<formFor for=Contact onsubmit=save/>
<tableFor for=Contact rows=@contacts/>

</program>
```

- **`<formFor for=T>`** expands at compile time into one bound input per field, the validity surface (next sections), `<errors of=>` blocks, a submit button, and a `<form>` wired to your handler. `pick=["a", "b"]` / `omit=["secret"]` / `partial=true` shape the field set per call site; `<slot name="fieldName">` overrides one field's markup. *impl#1 known issue:* the generated inputs are all `type="text"` — a `string(email)` field does not yet get the `type="email"` control that a hand-bound input gets (see [Free HTML validation](#free-html-validation)).
- **`schemaFor(T)`** inside `<schema>` expands the struct into table declarations — the table name is pluralized, bare-variant enum fields lower to `oneOf([...])` constraints. *impl#1 known issue:* `scrml db-migrate` does not see `schemaFor`-generated tables (it reports "No `<schema>` tables found"); write the `<schema>` by hand for anything you migrate.
- **`<tableFor for=T rows=@list>`** renders a `<table>` with one column per field.
- `@contacts` grants `free, append`: the list may grow at the end, and nothing else. `@contacts.append(c);` is the one write that compiles.

Add a field to `Contact` and the form and table gain it at the next build.

---

## Validity surface

A compound declaration whose fields carry validators gets a read-only, reactive validity surface for free: `@signup.isValid`, `@signup.errors`, `@signup.submitted`, and per field `@signup.name.isValid` / `.errors` / `.touched`. `<errors of=@signup.name/>` renders a field's first error, and nothing when it is valid.

<!-- snippet: docs/readme-snippets/nerdme/validity.scrml -->
```scrml
// NERDME.md "Validity surface" — compiled by the bootstrap (scripts/snippet-gate.js).
<program>

<signup:struct>
    let <name:string="" req length(>=2)/>
    renders <input type="text" bind:value=@name/>
    let <password:string="" req length(>=8)/>
    renders <input type="password" bind:value=@password/>
</>
renders <form onsubmit=submit()>
    <label>Name     <*name/>     <errors of=@signup.name/></label>
    <label>Password <*password/> <errors of=@signup.password/></label>
    <button type="submit" disabled=(!@signup.isValid)>Create account</button>
</form>

function submit() {
    if (!@signup.isValid) { return; }
}

<main>
    <*signup/>
    <p if=@signup.submitted>Account created.</p>
</main>

</program>
```

- Validators ride as bare attributes on the field's declaration (`req`, `length(>=N)`, `min` / `max`, `pattern(/re/)`, `eq(@other)` for cross-field checks — the full list is SPEC §55.1). You never write a `validate()` function or keep an `@isValid` boolean by hand.
- The compiler blocks a form's submit while any validated field is invalid, before `onsubmit` runs, and says so with the info `I-FORM-SUBMIT-GATED` (SPEC §55.17.3). A submit button carrying `formnovalidate` bypasses the block.
- The surface is read-only: writing to it is `E-SYNTHESIZED-WRITE`.
- The bootstrap evaluates `req`, `length`, `min` / `max` and a `pattern` whose HTML `pattern` attribute says the same thing. It refuses the others, `eq(…)` among them (`E-BOOTSTRAP-UNSUPPORTED`), rather than leaving them inert. A password-confirmation field (`let <confirm:string="" req eq(@signup.password)/>`) is therefore written today only in the SPEC; the tutorial's [signup form](docs/tutorial.md) shows it.

---

## Free HTML validation

The same predicate that types the cell also produces browser-native form validation. On a `bind:value` input the compiler derives the matching HTML attributes. In impl#1 today:

| Predicate on the bound cell | Emitted on the `<input>` |
|---|---|
| `string(email)` | `type="email"` |
| `number(>0 && <100)` | `min="1" max="99"` (bounds are made inclusive on an integer step) |
| `string(.length > 7 && .length <255)` | `minlength="8" maxlength="254" required` |

The other named shapes map as the SPEC §53.6.1 table says (`url` → `type="url"`, `uuid` → `pattern`, `date` → `type="date"`, …). One predicate, and the browser's pre-submit check can never drift from the type. (Fragment — a cell behind these rows is declared like `let <age:number(>0 && <100)=1/>` and bound with `<input type="number" bind:value=@age/>`. The bootstrap has no refinement types yet.)

---

## Variable renaming — type-derived encoding

**Specified, not on by default.** SPEC §47 specifies a deterministic, type-derived encoding for JavaScript bindings in compiled output: `@shoppingCart` of type `Cart` would become something like `_s7km3f2x00` — underscore prefix, a kind character (`s` = struct, `p` = primitive, `e` = enum, …), an 8-character base36 FNV-1a hash of the canonical type string, and a per-scope sequence character. Because the name would carry the type, a runtime `reflect()` could recover the type descriptor from the variable alone, without shipping unused type metadata.

In impl#1 the encoder exists inside the code generator but is **off by default and not exposed** on the `scrml` CLI or the compile API; its compiled output uses readable names of the form `_scrml_<name>_<n>` (for example `_scrml_discount_3`). The bootstrap does not implement §47.

---

## The Build Story (Nominal)

> **Specified, not built** — [SPEC §58](compiler/SPEC.md); no compiler implementation yet. `*` marks a claim not yet actual.

Compilation is a pure function of two inputs — your source and an explicit, committed **build story** that pins what "the compiler" *is*: a content-addressed Merkle closure over the compiler-proper's four components — compiler source, language tools, the standard library, and any vendored edge code — one root hash with the dependency edges *inside* the hash, plus a human-inspectable `build-story.lock` sidecar. Because every part (the compiler included) is identified by the hash of its content, customizing the compiler to your project and reproducing any build bit-for-bit\* stop being in tension: a tuned compiler is just a different pinned build story, and "pinned" is what makes it portable.

A build story can be pinned per `<program>` — `<program story="…">`\* — and because nested `<program>` contexts are isolated, shared-nothing compilation units, different parts of one application can be built by different compilers, each independently reproducible. This is deliberately **not** a live or hot-swappable compiler: every build story is static, read once before parsing begins; only *authorship* is customizable, never the running compile.

<sub>\* The bit-for-bit guarantee requires a whole-compiler determinism audit not yet done. The build-story artifact and the `<program story=>` attribute are specified in SPEC §58 but not yet implemented.</sub>

---

## Server / client split

- **Auto-split via whole-program inference.** The compiler walks the call graph and infers what runs where. Functions that touch SQL, `protect=` fields, `Bun.*`, `process.*`, or a server-only stdlib module (`scrml:auth` / `crypto` / `fs` / `store` / `redis` / `cron` / `oauth`) are classified server-side automatically, and the classification propagates through transitive call chains. Never-called functions are warned (`W-DEAD-FUNCTION`) and tree-shaken. The bootstrap does the core of this already: a function that runs a `?{}` query compiles into the server module (`program.server.js`), its SQL appears nowhere in the client script, and the client calls a generated route. *impl#1:* the `server` keyword still parses but is redundant wherever inference can prove it — `W-DEPRECATED-SERVER-MODIFIER` fires at redundant uses.
- **SQL passthrough (`?{}`).** Query the database directly inside logic; the compiler generates parameterized queries and serialization. A query can fail, so it is followed by a `!{}` handler or sits in a `!` function that passes the failure on. SQLite (`db="./app.db"`) is the default and most exercised driver; Postgres (`db="postgres://…"`, via Bun.SQL) is specified in SPEC §44, and impl#1's support has its own open items in [known-gaps](./docs/known-gaps.md) (for example, `NUMERIC` / `BIGINT` columns arrive as strings).
- **Automatic N+1 elimination (Tier 2, impl#1).** A `for (x of xs)` loop whose body does one `?{…WHERE col = ${x.field}}.get()` (or `.all()`) is rewritten to one pre-loop `WHERE col IN (…)` fetch plus a keyed `Map` lookup — no DataLoader, no manual batching. The benchmark measured ~1.7× / 2.3× / 3.3× at N=10/100/1000 on on-disk WAL `bun:sqlite` (2026-05-14; [benchmarks/sql-batching/RESULTS.md](benchmarks/sql-batching/RESULTS.md)). The loop variable must be used as `${x.field}` — `${id}` on a bare loop value is not matched. *Known issue:* the rewrite keys its lookup map by the `WHERE` column, so that column must also appear in the `SELECT` list; `SELECT name … WHERE id = ${x.id}` makes every lookup come back empty. Select the key column (`SELECT id, name …`) until this is fixed.
- **Implicit transaction envelopes (Tier 1, impl#1).** Independent reads in one handler share one `BEGIN DEFERRED`..`COMMIT` for snapshot consistency under concurrent writers. Explicit `transaction { }` blocks are left alone; `W-BATCH-001` fires if the two would conflict.
- **Mount-hydration coalescing (impl#1).** Multiple on-mount server-cell loads on one page fold into a single round-trip (§8.11) instead of one request per variable.
- **Opt-out per call site.** `?{...}.nobatch()` disables rewriting when you need an exact query shape (`EXPLAIN`, measured hot paths).
- **Diagnostics, not silent magic.** `D-BATCH-001` flags near-miss loops that *almost* batch but don't, with the exact disqualifier. `E-BATCH-001` rejects `.nobatch()` composition with batched siblings; `E-BATCH-002` guards the 32 766 `SQLITE_MAX_VARIABLE_NUMBER` ceiling at runtime.
- **No API boilerplate.** Server functions are called like local functions; the compiler generates the routes, the fetch calls, and serialization.
- **CSRF — what impl#1 gives you by default.** With no `auth=` on the `<program>`, state-mutating routes get a compiler-generated double-submit-cookie check. With `auth="required"` and **no** `csrf=` attribute, impl#1's generated server has **no CSRF check at all**. Add `csrf="auto"` next to `auth=` to get session-bound synchronizer-token validation (`<program db="app.db" auth="required" csrf="auto">`). If you use `auth=` on impl#1, set `csrf="auto"`. The bootstrap has no `auth=` yet.
- **Per-route per-role chunk splitting (opt-in, impl#1).** With `scrml compile --emit-per-route` (off by default), whole-stack closure analysis (§40) computes which component code, server functions and stdlib units each entry point and role can reach, and emits per-route JS chunks with FNV-1a content-hashed filenames (§47) so caches stay valid when source bytes don't change. `<auth role="Admin">` narrows **JavaScript** only: the gated markup is still emitted into the HTML that every visitor receives, and the compiler says so (`W-AUTH-CONTENT-NOT-GATED`). `<auth role>` is not a way to keep content secret — decide what to send on the server, in a server function or page loader that checks the role.

---

## Client navigation

`navigate(path)` moves between routes. From client code it is a **soft** navigation: the runtime fetches the target route's server-rendered HTML, swaps it into the `<outlet>` of a persistent `<program>` shell, loads any client chunk that route needs, and hydrates it — no full reload, no router library, and shell state (navigation, sidebars, counters) survives. From server code it is a 302 redirect. `navigate(path, .Hard)` / `navigate(path, .Soft)` override the inference.

<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED, E-SCOPE-001] — the bootstrap has no navigate() and no <outlet> element yet -->
<!-- snippet: docs/readme-snippets/nerdme/navigation.scrml -->
```scrml
// NERDME.md "Client navigation" — the persistent shell. Ruled; spec-ahead on the bootstrap (no navigate(), no <outlet>).
// In a real app the routes live in pages/*.scrml and compose into <outlet/>.
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
- Routes are filesystem-inferred: in a multi-page app each route is a `pages/*.scrml` file (or a `<page>` child of the program), and its content composes into `<outlet/>`. There is no `route=` attribute. `route.query.k` is `string | not`: a missing key is `not`.
- One flat `<outlet>` per shell (`E-OUTLET-DUPLICATE` for a second). A multi-page project with no `<outlet>` falls back to hard navigation (`W-OUTLET-ABSENT-SOFT-NAV-DISABLED`).
- **Specified, not built:** `<page keep-alive>` is accepted by impl#1 but does not cache yet, and nested outlets are future work. Normative source: SPEC §20.8.

---

## Realtime and workers

- **WebSocket channels (`<channel>`).** A lifecycle element that declares a WebSocket endpoint. The compiler emits the Bun upgrade route, a client-side connection manager with reconnect, and pub/sub topic routing. `onserver:open` / `:message` / `:close` run server-side; `onclient:open` / `:close` / `:error` run in the browser. `auth="required"` on the channel gates the upgrade with a session check. No WebSocket or Bun-specific API appears in your source. impl#1 builds channels; the bootstrap does not have `<channel>` yet.
- **Shared reactive state inside channels.** State declared inside a `<channel>` body (`let <messages:Message[free, append]=[]/>`) is owned by the channel and synced across every connected client; the rest of the program can read it. Writing in one tab updates every other tab on the same topic; the wire format is compiler-generated.
- **`broadcast()` / `disconnect()`.** Available inside any server handler in a channel's lexical scope. `broadcast(data)` fans out to every client on the channel's topic; `disconnect()` closes the connection.
- **Topics are static strings in impl#1.** `name=` and `topic=` take string literals. SPEC §38 also specifies a dynamic `topic=@room` that re-subscribes when `@room` changes; *impl#1 known issue:* it does not implement it and silently uses the literal text `room` as the topic, with no diagnostic. Do not use `topic=@var` there.
- **Nested `<program>` = Web Worker — broken in impl#1.** The SPEC (§4.12, §43) makes a `<program name="compute">` nested in your app a shared-nothing Web Worker, with message passing (`<#compute>.send(data)` in the parent; `when message(data) { … send(reply); }` inside the worker; `when message from <#compute> (data)` back in the parent), typed RPC (`<#compute>.add(1, 2)`), and supervised restarts (`restart="on-error"`, `max-restarts=3`, `within=60`, `autostart="false"`). In impl#1 **none of this runs**: the client bundle references `compute.worker.js`, but that file is never written to the output directory, so the worker fails to load (tracked as `g-nested-program-emits-artifacts-it-never-produces`). The RPC call form is additionally miscompiled — `@r = <#compute>.add(1, 2)` compiles and sets `@r` to nothing, and `const result = <#compute>.add(1, 2)` fails with `E-CODEGEN-INVALID-LOGIC`. The bootstrap has no nested `<program>` yet.
- **WASM modules and foreign sidecars — specified, not built.** SPEC §23.3 / §23.4 extend the same `<program>` primitive to WASM modules (`lang="rust" mode="wasm"`, call-char sigils like `r{ … }`) and out-of-process sidecars (`lang="python"`, `use foreign:name { fn }`). impl#1 refuses the source forms honestly: a call-char sigil is `E-WASM-NOMINAL` and a `use foreign:` declaration is `E-FOREIGN-SIDECAR-NOMINAL`. A nested `<program lang=…>` or `mode="wasm"` on its own is not refused — it compiles into the same worker reference described above and does nothing useful; don't use it yet. More in [`docs/external-js.md`](docs/external-js.md).

---

## Metaprogramming (`^{}`)

- **Compile-time meta.** Code that runs at compile time. `reflect()` inspects types, `emit()` generates markup, `compiler.*` registers macros. Meta blocks execute during compilation and produce source that's spliced into the AST.
- **Runtime meta.** A meta block that references `@x` reactive state runs at runtime instead of compile time. The compiler classifies each block automatically by what it references.
- impl#1 builds both; the bootstrap has no `^{}` yet.

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

Use `function` for general-purpose callables; use `fn` for deterministic computations, predicates and transformations. Values leave either kind only through an explicit `return`: a function with a declared return type returns on every path (`return not;` included), and falling off the end is an error. The non-deterministic touches live behind capability-scoped stdlib — `scrml:time` (`now()`), `scrml:random` — and the pure scalar surface is `scrml:math`. *impl#1 known issue:* the "calling a non-`fn` function" limb does not yet catch host calls — `fetch(u)` inside an `fn` compiles.

---

## Styles

- **Scoped CSS (`#{}`) — where you put it decides its reach.** A `#{}` block *inside a component* is scoped with native CSS `@scope`: `@scope ([data-scrml="Card"]) to ([data-scrml])` — class names are **not** mangled, the emitted CSS is readable 1:1, and the `to (…)` limit stops the styles at nested components. A `#{}` block at the **program level** is global (emitted into `@layer global`). There is no `:deep()`. The bootstrap has no `#{}` blocks yet; its native styling model (§65) comes first when styling work starts.
- **Flat specificity.** An unconditional same-property conflict on an element that two rules provably both hit is a compile error, `E-STYLE-CONFLICT`, rather than a silent last-rule-wins.
- **`class=` takes a string or a tape of strings**, joined with spaces. Anything else is a type error, never a `String()` coercion.
- **Built-in Tailwind engine (impl#1).** impl#1 embeds a Tailwind utility registry. Use utility classes directly in markup; it resolves them from the embedded registry and emits only the CSS rules actually used — no Tailwind CLI, no PostCSS, no purge step. Tailwind on the bootstrap is a low priority.

---

## LLM agent integration — `scrml:mcp`

scrml ships a Model Context Protocol surface so an LLM agent can read your app's structure first-hand instead of guessing. Opt in on the root program with `<program mcp="dev-only">` (impl#1). With that attribute the build writes descriptor sidecars next to the output — `engines.json`, `forms.json`, `channels.json`, `serverfns.json`, `chunks.json` — turns on per-route emission, and bundles the `scrml:mcp` stdlib, which serves them over MCP stdio as 11 read-only tools:

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

## Recently landed in impl#1

A selection from impl#1's last releases, in the older dialect (details in [`docs/changelog.md`](./docs/changelog.md)):

- **Inline block handlers run every statement.** `onclick={ a(); b(); }` is legal and canonical; every statement runs in every position (including inside `<each>` rows), and an unbraced `;` sequence is a clear error instead of being half-compiled into attributes.
- **`defer` statement** (SPEC §19.16) — `defer <stmt>` runs on every exit from the enclosing block, including `return` and `fail`, in last-in-first-out order.
- **`class` and dynamic `import()` are rejected** with dedicated errors (`E-CLASS-NOT-IN-SCRML`, `E-DYNAMIC-IMPORT-NOT-IN-SCRML`) instead of passing through as JavaScript.
- **Dates and other built-ins in reactive cells** no longer break the page, and `==` compares them by value.
- **Security: nested async helpers** can no longer slip past the fail-closed guards on synchronous callbacks (e.g. `xs.some(x => inner(x))`).
- **Raw-text rewrites no longer corrupt string and regex literals** (the `~` rewrite and three siblings).
- **Database connection secrets never reach compiler output.**
- **A braceless `else` no longer runs unconditionally** in function bodies.

---

## Known limitations and gaps

scrml is converging on its spec. Some features are specified but not built; some are built with known issues. The full per-feature drift list — with reproducers and workarounds — is [`docs/known-gaps.md`](./docs/known-gaps.md). The headlines:

### Not in the bootstrap yet

The bootstrap refuses each of these with `E-BOOTSTRAP-UNSUPPORTED` or a parse error; it never silently accepts them. From the programs on this page: the `<match>` element, `<each>`'s `<empty>`, building a payload variant (`Load.Loaded(2)`) as a value, `<onTimeout>` and duration literals, refinement types, `eq(…)` and other validators beyond `req` / `length` / `min` / `max` / a plain `pattern`, `<schema>`, `<formFor>` / `<tableFor>`, `navigate()` and `<outlet>`, `<channel>`, nested `<program>`, `^{}`, `#{}` style blocks, `lin`, the `~` accumulator, `bind:value` to a number cell, and `auth=`. Two SPEC checks are not refusals yet, so the bootstrap silently accepts what they would refuse: a local shadowing a state name (`E-NAME-COLLIDES-STATE`), and the compile-time `rule=` check on an engine write. The README keeps the current list under [Using the bootstrap compiler](./README.md#using-the-bootstrap-compiler).

### Specified, not built by either compiler

| Feature | Spec | What it is |
|---------|---|---|
| **Foreign code — arbitrary languages + standalone blocks** | §23 | impl#1 ships the inline value-returning `_={…}=` **ts/js** block (§23.2.4); arbitrary-language inline blocks and standalone library-mode foreign blocks are not built. |
| **WASM call-char sigils** | §23.3 | `r{}` / `c{}` / `z{}` sigils plus `extern` declarations for calling compiled WASM. impl#1 refuses them with `E-WASM-NOMINAL`. |
| **Sidecar process declarations** | §23.4 | `use foreign:name { fn }` — server-side HTTP/socket sidecar services. impl#1 refuses them with `E-FOREIGN-SIDECAR-NOMINAL`. |
| **Type-derived variable names** | §47 | impl#1 has the encoder, off by default and not exposed (see [above](#variable-renaming--type-derived-encoding)). |
| **Build Story (`<program story=...>`)** | §58 | Content-addressed Merkle closure over the four compiler components + per-`<program>` build identity. |
| **Soft-nav keep-alive, nested outlets** | §20.8.4 | impl#1 accepts `<page keep-alive>` but caches nothing; one flat `<outlet>` only. |

The **quoted-text body model** (§4.18) is the reverse case: the bootstrap enforces it (bare prose in a code-default body, such as a state-child's, is `E-UNQUOTED-DISPLAY-TEXT`), and impl#1 does not.

### impl#1 known bugs and partial implementations

These are bugs in the first compiler, which compiles the older dialect. impl#1 is frozen: non-security bugs stay filed as gaps rather than fixed.

| Severity | What | Workaround |
|---|---|---|
| HIGH | **Writes to a refined cell are not checked** — writing `-5` to a cell typed `number(>0)` is accepted. | Route writes through a function whose parameter carries the predicate. |
| HIGH | **Nested-`<program>` workers don't run** — the worker file is never written; RPC calls miscompile. | None; keep the work on the main thread. |
| HIGH | **`fail .Variant` shorthand rejected** with `E-ERROR-009`. | Write the qualified `fail Type.Variant`. |
| HIGH | **`auth="required"` without `csrf=` has no CSRF check.** | Always pair `auth=` with `csrf="auto"`. |
| MED | **`topic=@var` on `<channel>` is silently a literal.** | Use a static topic string. |
| MED | **N+1 rewrite needs the key column in `SELECT`**, otherwise lookups come back empty. | Select the `WHERE` column too. |
| MED | **`scrml db-migrate` ignores `schemaFor`-generated tables.** | Hand-write the `<schema>` for migrated tables. |
| MED | **Tailwind utility residuals** — a small number of utility classes don't fully resolve through the built-in engine. | Write the equivalent class explicitly or use a `#{}` block. |
| LOW | **`<each>` fires `W-EACH-KEY-001` even when the item type has `.id`.** | An explicit key silences it and is the recommended form anyway. |
| LOW | **`scrml promote --engine` fails when the matched cell is declared separately** — the rewrite collides with the engine's own cell (`E-ENGINE-VAR-DUPLICATE`) and leaves the file untouched. | Lift `<match>` to `<engine>` by hand and delete the separate cell declaration. |

The recent landing log is [`docs/changelog.md`](./docs/changelog.md).

---

## The compiler & repo

scrml has two compilers. **impl#1** (`compiler/src/`, TypeScript/JavaScript, the `scrml` command) compiles `.scrml` source into HTML, CSS, client JS and server route handlers, in the older dialect; it is frozen except for security fixes. The **bootstrap** (`compiler/self-host-v2/`, written in scrml and built by impl#1, run as `bun run boot:compile`) compiles the ruled language and is where new language work lands. Sizes and counts for everything below are generated in [`docs/FACTS.md`](./docs/FACTS.md) — compiler source lines, test files, SPEC lines, conformance cases, stdlib modules, CLI verbs.

- `compiler/` — impl#1's source, the authoritative `SPEC.md` / `SPEC-INDEX.md` / `PIPELINE.md`, and the test suite
- `compiler/self-host-v2/` — the bootstrap compiler, which tracks the ruled SPEC
- `conformance/` — language conformance cases, each an expected-output assertion any implementation must pass
- `examples/` — numbered runnable single-file apps (older dialect, compiled by impl#1), plus a multi-file and a multi-page (trucking-dispatch) app
- `samples/compilation-tests/` — compilation tests covering accepted and rejected constructs
- `stdlib/` — the bundled `scrml:*` standard library (module list in [FACTS](./docs/FACTS.md))
- `benchmarks/` — runtime, bundle-size, build and SQL-batching benchmarks
- `editors/vscode/`, `editors/neovim/` — editor integrations

Both compilers run on [Bun](https://bun.sh); compiled output is plain JavaScript that runs in any browser or JavaScript runtime.

### Benchmarks — methodology

The latest measurement in [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) is dated **2026-09-05**, was taken with impl#1, and it is not flattering:

- **Bundle size (TodoMVC, gzip):** scrml **48.8 KB total** (47.0 KB JS) with **0 dependencies** — larger than Svelte 5 (17.1 KB) and Vue 3 (27.8 KB), smaller than React 19 (62.8 KB). The framework rows are their 2026-05-19 production builds re-measured the same day. scrml's JS grew about 2.4× between May and September.
- **Build time:** scrml compiles the TodoMVC app in about **54 ms**. The Vite builds of the other frameworks were not re-measured on that date, so no current ratio is claimed here.
- **Runtime:** no current number. On 2026-09-05 the benchmark app compiled but did not render (a defect since fixed), so runtime was not measurable at that commit; the runtime tables have not been re-run since.

The SQL N+1 batching numbers have their own harness: [`benchmarks/sql-batching/RESULTS.md`](benchmarks/sql-batching/RESULTS.md).
