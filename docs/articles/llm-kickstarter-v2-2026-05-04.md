# scrml LLM Kickstarter — v2 (v0.next)

**One-paste context for any LLM about to write scrml.** Read this in full before generating any scrml code. If you've been pasted this document, do not skim.

> v2 supersedes v1 (2026-04-25). v1 described **pre-v0.next** scrml; v2 describes the language **after the S52-S56 deliberation arc** (locks L1-L20, captured in `scrml-support/docs/deep-dives/v0next-s56-deliberation-outcomes-2026-05-04.md`). The two languages share much of their vocabulary (file extension, Bun runtime, `< db>` + `?{}`, `<program>`, `lift`, `bind:value`, `onclick=fn()`, `${expr}`, `#{}`, `lin`, components, stdlib) but the **state model has changed materially**, **engines are now the centerpiece**, and **markup is a first-class value type that can sit anywhere expressions sit** (the load-bearing pillar held since the scrml8 era). If a v1 recipe contradicts a v2 recipe, v2 is correct. Do not back-fill from v1.

---

## 0. Identity assertion (READ THIS FIRST)

**scrml is a programming language and full-stack web framework. You almost certainly have no training data on it. Do not pattern-match the name.**

If you search the web for "scrml," you will find:

- **srcML** — an XML wrapper for source code analysis. **NOT scrml.**
- **SCRML** — "Self-Contained Resources Markup Language," a math markup standard. **NOT scrml.**
- **SML** — Standard ML. **NOT scrml.**
- **github.com/scrml/scrml.github.io** — points to the math-SCRML project. **NOT scrml.**

These are false friends. Ignore them. **This document is the canonical context.** Do not back-fill knowledge from search results; do not assume scrml resembles whatever the file extension reminds you of.

In particular: **scrml is NOT Svelte**, even though `.scrml` looks like `.svelte`. The structural similarities are superficial; the syntax and the state model are different.

---

## 1. The north star — the design key for v0.next

**The UI of a scrml application SHOULD be a fully-handled state machine.** In scrml's vocabulary that machine is called an **engine**. Not aspiration — design intent. **The structural shape of the UI tree IS the structural shape of the application's state.**

There is a process clause: apps don't START at the north star; they EVOLVE toward it. Booleans-as-lifecycle in early sketch code are not language violations; they are in-progress pins. The compiler nudges (`W-LIFECYCLE-CANDIDATE` lint), this kickstarter teaches the destination, the language does not ENFORCE the shape — because forcing it would punish the prototyping phase.

When you are stuck on a design call ("should this engine attribute behave X way or Y way?"), ask: **which option makes the UI MORE of a fully-handled state machine?** That is the tiebreaker.

---

## 2. The shape of a scrml file

Start from the canonical shape below and modify what you need. Don't write from scratch — every scrml app is a variation of this skeleton.

```scrml
<program auth="required">

< db src="contacts.db" protect="password_hash" tables="contacts">

  ${
    <name>  = ""
    <email> = ""
    <phone> = ""

    server function persistContact(name, email, phone) {
      ?{`INSERT INTO contacts (name, email, phone) VALUES (${name}, ${email}, ${phone})`}.run()
    }

    function addContact() {
      persistContact(@name, @email, @phone)
      @name  = ""
      @email = ""
      @phone = ""
    }

    server function deleteContact(id) {
      ?{`DELETE FROM contacts WHERE id = ${id}`}.run()
    }

    server function loadContacts() {
      lift ?{`SELECT id, name, email, phone FROM contacts ORDER BY name`}.all()
    }
  }

  <div class="max-w-2xl mx-auto my-8 font-sans">
    <h1 class="text-2xl font-semibold mb-4">Contact Book</h1>

    <form onsubmit=addContact() class="flex gap-2 mb-6">
      <input type="text"  bind:value=@name  placeholder="Name"  required class="flex-1 p-2 border border-slate-300 rounded"/>
      <input type="email" bind:value=@email placeholder="Email" required class="flex-1 p-2 border border-slate-300 rounded"/>
      <input type="tel"   bind:value=@phone placeholder="Phone"        class="flex-1 p-2 border border-slate-300 rounded"/>
      <button type="submit" class="px-4 py-2 bg-slate-900 text-white rounded">Add</button>
    </form>

    <ul class="list-none p-0">
      ${
        for (let contact of loadContacts()) {
          lift <li class="flex gap-4 py-3 border-b border-slate-200">
            <span>${contact.name}</span>
            <span class="text-slate-600">${contact.email}</span>
            <span class="text-slate-500">${contact.phone}</span>
            <button onclick=deleteContact(contact.id) class="ml-auto text-rose-700 hover:text-rose-900">Remove</button>
          </li>
        }
      }
    </ul>
  </div>

</>

</program>
```

Note the parts:

| Element | Purpose |
|---|---|
| `<program ...>` | Root element. **Required.** Without it, the compiler emits W-PROGRAM-001. |
| `< db src="..." tables="...">` | DB block. Compile-time schema introspection runs here. `protect="a, b"` (**comma-separated**) marks fields server-only. |
| `${ ... }` | **Logic block.** All declarations and functions live here, not in a separate `<script>` tag. |
| `<varname> = expr` | **Reactive state DECLARATION** (V5-strict structural form). Bare `let var` is non-reactive. |
| `@varname` | **Reactive state EXPRESSION ACCESS** (V5-strict canonical form). Reads, writes, and compound assignments use the `@` sigil. Bare names in expressions are LOCALS only. |
| `const <name> = expr` | **Derived reactive** (structural-decl form, V5-strict). Re-evaluates when inputs change. Read at `@name`. |
| `server function name() { ... }` | A function that runs on the server. Boundary security is compiler-enforced. |
| `function name() { ... }` | Client function. Owns reactive-state writes. |
| `?{` ... `}` | **SQL block.** Backticks inside hold the SQL string. `${param}` interpolations become bound parameters. |
| `.run()`, `.all()`, `.get()` | SQL execution methods. **`.prepare()` does not exist — emits E-SQL-006.** |
| `lift` | Marks a server-fn return value (data) or client-side reactive markup expansion. |
| `bind:value=@x` | Two-way binding. The `@` is REQUIRED on the bound variable. |
| `onclick=fn()` | **Bare-call event handler.** NOT `on:click={fn}`, NOT `@click=fn`, NOT `onClick={fn}`. |
| `${expr}` in markup | Interpolation. NOT `{expr}`. The `$` is REQUIRED. |
| `#{ ... }` | **Scoped CSS block.** Auto-scoped via native `@scope`. |
| `</>` | **The only generic closer.** Closes the most-recent opener. (`<///>` was dropped from v0.next; that convenience is now an editor concern.) |

This is the canonical shape. Copy it, rename `contact` to your domain, and you have a working app.

---

## 3. V5-strict — the access model (the most important rule in v2)

**This is the rule that has shifted most from v1.** Read it carefully.

scrml has **two access forms** for reactive state:

| Form | Role | Where it appears |
|---|---|---|
| `<varname>` | **Structural** | Declaration site (`<count> = 0`), engine state-child tags (`<Small>...</>`), render-by-tag in markup |
| `@varname` | **Canonical expression access** | Reads (`if (@count > 0)`), writes (`@count = @count + 1`), compound (`@count++`, `@count += 1`) |

Bare names (`count` without `<>` or `@`) are **LOCAL identifiers only**. They do NOT resolve to reactive state. If a file declares `<count> = 0` and you later write `let count = 5`, the compiler emits **`E-NAME-COLLIDES-STATE`** — local names cannot shadow registered state names.

```scrml
${
  <count> = 0                     // declaration (structural form)

  function inc() {
    @count = @count + 1           // read + write (canonical form)
  }

  function reset() {
    @count = 0                    // write
  }

  function describe() {
    let count = "five"            // ❌ E-NAME-COLLIDES-STATE — local shadows state
  }
}

<button onclick=inc()>+</button>
<span>${@count}</span>            // ${} interpolation calls @ for state read
```

**Why the dichotomy:** `@` makes every state touch visually distinguishable from local-variable touch. The reader can scan a function body and instantly count "how many state cells does this function read or mutate." This is load-bearing for the exhaustiveness goal — the prover and the human reader can both see, structurally, where state is in play.

**A common confusion:** `@` is **NOT** a "JS-framework concession." It is the canonical, semantically-required marker for reactive-cell-touch. The fact that other frameworks converged on similar sigils does not make `@` unprincipled; it makes the convergence correct.

**Compound state declarations** use the structural form too. Field access is canonical:

```scrml
${
  // Single-value state — the degenerate case:
  <count> = 0

  // Compound state with ad-hoc fields — Variant C structural-children:
  <formRes>
    <name>  = ""
    <email> = ""
    <error> = ""
  </>

  // Field access is canonical with dot navigation:
  function setError(msg) {
    @formRes.error = msg
  }

  // Compound state typed by a predefined shape — positional sugar legal:
  type UserInfo:struct = { name: string, age: number, active: boolean }
  <userInfo>: UserInfo = ("alice", 30, true)
}
```

Tuple-positional binding (`<userInfo> = ("alice", 30, true)`) is legal **only when** the structure of `userInfo` is fixed by a predefined type (enum/struct/engine). Ad-hoc inline-declared compound state uses the structural-children form (no positional sugar).

### 3.1 The three RHS shapes for state declarations

Every state-cell declaration falls into one of three shapes, picked by what's on the right of `=`:

```scrml
${
  // Shape 1 — plain reactive cell. RHS is a literal or expression value.
  // No render-spec, no render-by-tag. Display via ${@x} interpolation only.
  <count> = 0
  <name>  = ""
  <items> = []

  // Shape 2 — decl-coupled-with-render-spec. RHS is bindable markup.
  // Render-by-tag <name/> in markup expands to the bound input element.
  // Validators (req, length, pattern, ...) sit as bare attributes on the decl.
  <userName req length(>=2)> = <input type="text"/>
  <agree    req>             = <input type="checkbox"/>

  // Shape 3 — derived (read-only). RHS is an expression that recomputes.
  // No render-spec; <derivedName/> in markup is E-CELL-NO-RENDER-SPEC.
  // Markup-typed derived cells ARE legal under the markup-as-value pillar.
  const <doubled>   = @count * 2
  const <greeting>  = "Hello, " + @userName
  const <badge>     = <span class="badge">${@userName}</span>     // markup-typed derived
}
```

**On the meaning of `const` with `<>`:** scrml's `const <x>` does NOT mean "value-frozen JS-const." It means **the binding is read-only from the developer's perspective; the cell may reactively recompute its value based on its RHS's dependencies.**

- **Reference-immutable** — `@x = newval` is `E-DERIVED-WRITE`. You cannot reassign a derived cell.
- **Value behavior depends on RHS deps:**
  - If the RHS references reactive cells (`@count * 2`), the value RECOMPUTES whenever those deps change.
  - If the RHS is a pure literal or has no reactive deps (`3.14159`), the value never changes — effectively frozen.

For a **truly non-reactive frozen constant**, drop the `<>` entirely:

```scrml
${
  const items = [{name: "apple"}, {name: "banana"}]    // plain JS const — non-reactive, bare-name access
  const <filteredItems> = items.filter(...)            // reactive derived cell — @filteredItems access
}
```

**Optional `default=` attribute** — any state cell may declare an explicit default that's used by `reset(@cell)` instead of re-evaluating the init expression:

```scrml
<startTime default=not> = Date.now()        // init = current timestamp; reset → not
<retries   default=0>    = nextRetryCount() // init has side effect; reset uses 0, no re-fire
```

Without `default=`, `reset()` re-evaluates the init expression at reset time.

### 3.2 Lifecycle annotation `(A to B)` — the per-access transition contract

A lifecycle annotation on a type position says: "this location starts as type `A` and transitions to type `B`. The compiler will refuse reads until the transition has happened." This is how scrml encodes "value must be set before use" — at the type system layer, with zero runtime cost.

```scrml
type User:struct = {
    id: number,
    email: string,
    passwordHash: (not to string)        // starts absent; transitions to string after hashing
}

const u: User = { id: 1, email: "a@b.com", passwordHash: not }
print(u.passwordHash)                     // E-TYPE-001 — pre-transition access

u.passwordHash = hashPassword(rawPw)
print(u.passwordHash)                     // OK — transitioned
```

The canonical glyph is `to` — a contextual keyword inside the parens (parallel to `from` in `import`). The legacy `->` glyph still parses but lints `W-LIFECYCLE-LEGACY-ARROW`. Use `to` in new code.

**Where it goes — the teachable rule:** "Lifecycle annotation goes anywhere a type goes, EXCEPT engine cells."

| Position | Permitted | Example |
|---|---|---|
| Struct field | YES | `passwordHash: (not to string)` |
| Shape 1 reactive cell | YES | `<status>: (Idle to Active) = .Idle` |
| Function parameter | YES | `fn process(u: (not to User))` |
| Function return | YES | `server fn loadUser(id: number) -> (not to User)` |
| Schema field | YES | (see §11.6) |
| Channel cell | YES | (see §11.3) |
| **Engine cell** | **NO** — fires `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` | (engines own progression via `rule=`) |

The engine-cell carve-out matters: engines (§4) own variant-graph progression via `rule=` / `initial=` / `<onTransition>`. Putting a lifecycle annotation on an engine's auto-declared cell would create a redundant second progression mechanism on the same surface — rejected.

```scrml
type Phase:enum = { Idle, Loading, Done }

<engine for=Phase initial=.Idle> ... </>

<phase>: (Idle to Done) = .Idle          // E-TYPE-LIFECYCLE-ON-ENGINE-CELL — engine owns @phase
```

For value-shape progression on a cell that is NOT an engine cell, declare as Shape 1:

```scrml
<status>: (Idle to Active) = .Idle       // legal — no engine claims `status`
@status = .Active                        // transitions; subsequent reads pass
```

**Function-return lifecycle — two flavors:**

```scrml
// Presence-progression (not to T) — discrimination IS transition
server fn loadUser(id: number) -> (not to User) { ... }

const u = loadUser(42)
given u => { print(u.name) }              // OK — `given` discriminates AND transitions

// Variant-progression (.A to .B) — explicit transition()
server fn publish(id: number) -> (.Draft to .Published) { ... }

const a = publish(42)
if (a is .Draft) {
    transition(a)                         // explicit per-access transition signal
    print(a.publishedAt)                  // OK
}
```

The `transition()` built-in is compile-time-only — zero runtime cost. It exists because variant tags (`.Draft`) prove the source variant but not that the callee advanced the lifecycle; the explicit call provides the per-access signal.

**Multi-variant chains `(A to B to C)` are RESERVED** — not yet implementable. Use a two-state pair, or use an engine (§4) for variant-graph progression.

See SPEC §14.12 for the full normative specification.

---

### 3.3 Function forms — `function` / `fn` / `server function` / `pure` (§48 + §33)

scrml has FOUR function-declaration shapes, each with distinct semantics. Pick the one that matches your intent; the compiler enforces the discipline.

| Form | Where it can fire side effects | What the compiler enforces | Example |
|---|---|---|---|
| `function` | client-side: DOM writes, state mutation, event handlers, transition triggers | nothing extra — the workhorse form | `function handleClick() { @count = @count + 1 }` |
| `fn` (= `pure function`) | nowhere — body is pure (§33.6 S32: `fn` ≡ `pure function`) | no SQL, no DOM, no outer-scope mutation, no non-determinism (`Date.now()`, `Math.random()`), no async; must return a value at every path | `fn double(n: int) -> int { return n * 2 }` |
| `server function` | server-side: SQL, file I/O, env vars; auto-bound to a route | server-only resources allowed; client call is compiled to a fetch | `server function loadUsers() { return ?{`SELECT * FROM users`}.all() }` |
| `pure function` | nowhere — synonym for `fn`; explicit form | identical to `fn`; `pure fn` is REDUNDANT and fires `W-PURE-REDUNDANT` | `pure function double(n: int) -> int { return n * 2 }` |

**Reach discipline (Pillar 5b):** when computing a value with no side effects, use `fn`. The discipline is signal: the call site reads as "this is a calculation, not a state machine." `function` is the escape hatch for impure work — event handlers, complex DOM-coupled logic, transitions.

**Mutual recursion + hoisting (§48.6.4, S98):** `fn` declarations at file scope hoist exactly like `function`. Mutual recursion is supported without forward-ref ceremony: `fn isEven(n) -> bool { return n == 0 ? true : isOdd(n - 1) }` next to `fn isOdd(n) -> bool { ... isEven(n - 1) ... }` compiles clean. The `pinned fn` modifier opts a `fn` OUT of hoisting (forward-ref becomes `E-STATE-PINNED-FORWARD-REF`).

**`lift` inside `fn` — `E-SYNTAX-002`.** A `fn` cannot `lift` markup; it must `return` it (markup is a value per Pillar 1). Reach for `function` (or `${ ... lift ... }` in a logic block) when you need to lift.

See SPEC §48 for the full `fn` discipline; §33 for `pure` keyword semantics; §6.1 of the PA primer for the fn-vs-function decision matrix.

---

## 4. Engines — the centerpiece of v0.next

An **engine** is scrml's name for a state machine that owns part of (or all of) your UI. Engines are how the language makes the north star (UI as a fully-handled state machine) load-bearing rather than aspirational.

### 4.1 The minimal engine

```scrml
<program>

${
  type MarioState:enum = { Small, Big, Fire, Cape }
}

<engine for=MarioState initial=.Small>
  <Small  rule=.Big>                                    : "🧍"
  <Big    rule=(.Fire | .Cape | .Small)>                : "🧍 🧍"
  <Fire   rule=.Small>                                  : "🔥"
  <Cape   rule=.Small>                                  : "🦸"
</>

</program>
```

That whole block is one engine. Read it as: "this engine is over the `MarioState` enum, starts in `.Small`, and at runtime renders whichever state-child matches the current value of the engine's variable."

Things to notice:

- **`<engine for=MarioState ...>`** declares the engine. The engine's variable is **auto-declared** by the compiler — its name is the lowercase-first-run of the type (`marioState` here). You do NOT also write `<marioState> = .Small` — that would be a duplicate declaration.
- **`initial=.Small`** sets the starting state. Required on non-derived engines (lint-warns if omitted; compiler defaults to first state-child).
- **`<Small>`, `<Big>`, etc.** are **state-children**. Their tag names must match the variants of the engine type. Their bodies (after `:` or in `</>` form) describe the markup rendered when the engine is in that state.
- **`rule=`** declares the legal transitions OUT of this state. `rule=.Big` means "from `.Small` you may transition to `.Big`." Multi-target uses `(.A | .B | .C)`.
- **`:`-shorthand** — a single-expression body. `<Small rule=.Big> : "🧍"` is sugar for `<Small rule=.Big>"🧍"</>`. Mandatory whitespace around `:`.

### 4.2 Engine declaration position = mount position

Where you declare the engine in the source IS where it renders. There is no separate `<MarioMachine/>` mount tag for same-file engines; the engine's body IS the rendered output at the engine's source position.

```scrml
<program>

${ type MarioState:enum = { Small, Big } }

<div class="game">
  <h1>Mario</h1>

  <engine for=MarioState initial=.Small>     <!-- renders here -->
    <Small rule=.Big> : "🧍"
    <Big rule=.Small> : "🧍 🧍"
  </>

  <p>Press the button to grow.</p>
</div>

</program>
```

For **cross-file** engines, you import and use the engine via `<EngineName/>` use-site. That is the only situation in which the use-site tag exists.

### 4.3 Transitions — three forms, ordered by loudness

```scrml
${
  function grow() {
    @marioState = .Big                       // direct write — silent-validated
  }

  function eatPowerUp(p: PowerUp) {
    @marioState.advance(p.target())          // explicit-throws — asserts MUST work
  }

  function tryGrowIfSmall() {
    if (@marioState == .Small) @marioState = .Big   // conditional intent — explicit gate
  }
}
```

- **Direct write (`@marioState = .Big`)** — the engine intercepts the write and validates against the current state's `rule=`. Invalid throws `E-ENGINE-INVALID-TRANSITION` at runtime. **Compile-time error** when the from-state is statically known (e.g., inside `<Small>...</>` body where the compiler knows `marioState == .Small`). This is the silent, ergonomic form.
- **`@marioState.advance(.Big)`** — same validation, but the developer is asserting "this MUST work." Failure throws with an "asserted advance failed" tag. Use this when you want loud failure on invalid transitions.
- **Conditional gate** — for "do this transition only if currently in this state," use a plain `if`. There is **no `.tryAdvance` silent no-op** — silent failure hides bugs.

### 4.4 Transition effects — `effect=` and `<onTransition>`

When you need to run code on transition (sound, log, animation), you have two forms:

```scrml
<engine for=MarioState initial=.Small>

  <!-- Simple, single-target effect on the FROM-side: -->
  <Small rule=.Big effect=${ playSound("grow") }> : "🧍"

  <!-- Multi-target or attribute-bearing — use <onTransition>.
       Note: when </> closer is present, :-shorthand is unavailable.
       Use bare-body form (text or markup directly between opener and </>). -->
  <Big rule=(.Fire | .Cape | .Small)>
    <onTransition to=.Fire>${ playSound("fire"); animateFlame() }</>
    <onTransition to=.Cape once>${ playSound("cape") }</>
    <onTransition to=.Small if=(@gameOver == false)>${ log("regression") }</>
    "🧍 🧍"
  </>

  <!-- Hooks on the TO-side (fire when entering): use from= -->
  <Fire rule=.Small>
    <onTransition from=.Big>${ playSound("powered-up") }</>
    "🔥"
  </>
</>
```

- **`effect=`** — simple, single-target only. Legal only when `rule=` is single-target. Multi-target + `effect=` is `E-ENGINE-EFFECT-AMBIGUOUS`.
- **`<onTransition>`** — structural element for the multi-target case or when you need attributes (`once`, `if=`, `from=`).
- **Default semantics** — `effect=` and `<onTransition to=X>` placed in the FROM state-child fire when LEAVING that state. `<onTransition from=X>` placed in the TARGET state-child fires when ENTERING from `X`. One concept, bidirectional via `from=` / `to=` attributes.
- **No separate `<onEnter>` / `<onLeave>`** — `<onTransition from/to>` covers both directions.

### 4.5 State-children with bodies vs bare

State-children come in two shapes:

```scrml
<engine for=Phase initial=.Loading>
  <Loading rule=.Loaded> : <Spinner/>          <!-- body: renders this when in .Loading -->
  <Loaded rule=.Error|.Loading>                <!-- body: full markup conditional render -->
    <h1>Done</h1>
    <button onclick=reload()>Reload</button>
  </>
  <Error rule=.Loading/>                       <!-- BARE: declares transitions only, no render -->
</>
```

- **State-child WITH body** — sugar over `if=(@engineVar == .ThisVariant)`. Renders the body conditionally on engine value.
- **State-child WITHOUT body (self-closing)** — declares transitions only. No rendering. Useful when the application handles the visual side elsewhere (or there is no visual for that state).

Mixed engines (some bodied, some bare) are legal and useful.

### 4.6 Repeated markup across state-children — use snippets

When state-children share markup shape, use snippets. Do NOT invent `<chrome>` template constructs or `<*>` any-state matchers. Snippets exist; they solve repetition; they are general (work outside engines too).

```scrml
${
  snippet character(emoji, label) {
    <div class="char">
      <span class="emoji">${emoji}</span>
      <span class="label">${label}</span>
    </div>
  }
}

<engine for=MarioState initial=.Small>
  <Small rule=.Big>  : character("🧍",     "SMALL")
  <Big   rule=.Fire> : character("🧍 🧍",  "BIG")
  <Fire  rule=.Small>: character("🔥",     "FIRE")
</>
```

### 4.7 The `pinned` keyword (hoisting opt-out)

State declarations hoist to their nearest enclosing structural scope (file, `<program>` body, engine body, channel body, schema body). Reads inside the scope can refer to them regardless of source order. The compiler topologically sorts initialization so all state declarations initialize before any reactive read or render fires.

If you want to **forbid forward references** to a particular declaration (because the source-order matters semantically), use `pinned`:

```scrml
${
  <userId> pinned = ""           // pinned — must appear before first use
  <session> = login(@userId)     // OK: userId is declared above
}
```

A forward read of a `pinned` declaration emits `E-STATE-PINNED-FORWARD-REF` (compile error). On engines, `pinned` covers BOTH the engine identifier AND the auto-declared variable. On imports: `import { MarioMachine pinned } from './engines.scrml'`.

The general lint policy: **lint rules teach people the scrml way; turning them off is the developer's prerogative.**

### 4.8 Bare-variant inference

When the LHS, parameter, or other position has a statically known enum type, you may omit the qualifier:

```scrml
${
  function grow() {
    @marioState = .Big                       // .Big inferred as MarioState.Big
  }

  function powerUp(p: PowerUp) {
    eatPowerUp(.Mushroom(1))                 // .Mushroom inferred as PowerUp.Mushroom
  }
}
```

When the type is a **union** (`MarioState | HealthRisk` and both have `.Small`), bare `.Small` is ambiguous → requires qualification. Otherwise, prefer the bare form for density.

### 4.9 Components vs engines — DO NOT collapse them

Engines and components are distinct concepts in v0.next:

| | Engine | Component |
|---|---|---|
| Job | Owns part of UI as a state machine | Reusable markup unit, instantiated by tag |
| Cardinality | **Singleton-by-design** | **Multi-instance** |
| Declaration | `<engine for=Type ...>` | `const Comp = <article props={...}>...</>` |
| Use | Renders at declaration position (same-file); `<EngineName/>` for cross-file mount | `<Comp prop=value/>` per instance |
| Owns state? | Yes — its variable is auto-declared and engine-scoped | No — receives props |

**If you find yourself wanting many instances of the same engine, what you want is a component.** If you find yourself wanting a singleton state machine, what you want is an engine.

### 4.10 Derived engines — `derived=expr`

An engine can be DERIVED from another engine (or any reactive expression of the engine's type). The derived engine's variable computes from its source; transitions, initialization, and direct writes are forbidden — the source drives everything.

```scrml
${
  type Health:enum = { Healthy, AtRisk, Critical }
}

<engine for=Health derived=match @marioState {
  .Small | .Big => .Healthy
  .Fire | .Cape => .AtRisk
  _              => .Critical
}>
  <Healthy/>
  <AtRisk>
    <onTransition from=.Healthy>${ playSound("warning") }</>
  </>
  <Critical>
    <onTransition from=.AtRisk effect=showDangerOverlay()/>
  </>
</>
```

**Rules for derived engines:**
- `derived=expr` accepts any reactive expression of the engine's type. JS-style `match` block is the typical shape; function calls and conditionals also work.
- `rule=`, `initial=`, and direct writes are FORBIDDEN. `E-DERIVED-ENGINE-NO-RULES`, `E-DERIVED-ENGINE-NO-INITIAL`, `E-DERIVED-ENGINE-NO-WRITE`.
- `<onTransition>` and `effect=` DO fire on derived state changes. The transitions are real (the value changed) — just initiated by the source, not by user code.
- Initial value computed from source at engine-init time. Compile-error if the derived expression has no defined value for the source's `initial=` state.
- Chained derivation legal (`A → B → C`). Cycles caught at compile time.
- For plain (non-engine) derived state, use `const <derived> = expr` from §3.1 — `derived=` is engine-only.

### 4.11 Nested substates — engines inside engines (§51.0.Q + §54)

When a state-child has its own internal state machine — a composite state — declare an `<engine>` inside its body. The outer state-child becomes a **composite state-child**; the inner engine has full engine semantics (own `for=`, `initial=`, state-children).

```scrml
type Mode:enum  = { Idle, Playing }
type Playback:enum = { Paused, Running, Buffering }

<engine for=Mode initial=.Idle>

  <Idle rule=.Playing>
    <button onclick=${@mode = .Playing}>Start</>
  </>

  <Playing rule=.Idle history>                     // composite state-child + history attribute
    <engine for=Playback initial=.Paused>
      <Paused rule=.Running>
        <button onclick=${@playback = .Running}>Play</>
      </>
      <Running rule=.Paused|.Buffering>
        <button onclick=${@playback = .Paused}>Pause</>
        <onTimeout after=200ms to=.Buffering/>
      </>
      <Buffering rule=.Running/>
    </>
    <button onclick=${@mode = .Idle}>Stop</>
  </>

</>
```

**Lifecycle coupling.** The inner engine is initialized on outer state-child entry; suspended on outer exit. **Singleton invariant** preserved: outer × 1 = 1 inner instance (per the Machine Cohesion footnote, §51.0.K).

**`history` attribute.** On a composite state-child means: "on outer re-entry, restore the inner engine's last state (instead of starting at inner `initial=`)." Shallow only. Tree-shakeable when no engine declares it. Target form: `rule=.Playing.history` or `@mode = .Playing.history` (vs bare `.Playing` which restarts inner from `initial=`).

**`internal:rule=`** prefix on a composite state-child: alternative to canonical `rule=`. Internal transitions DON'T exit/re-enter the composite (inner-engine lifecycle preserved; no history-write/read; composite `<onTransition>` doesn't fire). Both can coexist on the same composite.

**Parent-rule cascade dispatch:** writes to the outer engine's variable from inside a composite are validated against the COMPOSITE outer state-child's `rule=`. Writes to the inner-engine variable from inside inner state-children validated against inner state-child's `rule=`. Standard §51.0.F mechanic applied per-variable.

**Where engines can NOT live.** Component bodies (`E-COMPONENT-ENGINE-SCOPE`); function/snippet bodies. Engines live at file scope OR inside another engine's state-child body — nowhere else. The Pillar 5 reason: no per-kind mini-DSLs (avoiding `<region>`/`<sub-engine>` keyword surface preserves tooling-uniformity — CLI promotion + migration stay context-blind).

See SPEC §51.0.Q for hierarchy / nested engines; §54 for nested substate grammar + state-local transitions + field narrowing + terminal states.

### 4.12 Temporal engine surfaces — `<onTimeout>` + `<onIdle>` + computed delays + named timers (§51.0.M + §51.0.R)

Engines have a temporal vocabulary for "fire a transition after N ms." Two scopes — per-state and engine-wide — plus computed delays and cancellable named timers.

**`<onTimeout after=DURATION to=.Variant/>`** — per-state-child timer. Self-closing. Lives inside a state-child body; fires after the duration if that state is still current. The `to=` target is validated against the state-child's `rule=` (must be in set, or `rule=*`).

```scrml
type Phase:enum = { Idle, Loading, Loaded, TimedOut }

<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>
    <button onclick=${@phase = .Loading}>Load</>
  </>

  <Loading rule=(.Loaded | .TimedOut)>
    <onTimeout after=5s to=.TimedOut/>      <!-- auto-transition after 5s -->
    "Loading…"
  </>

  <Loaded>Done.</>
  <TimedOut>Timed out — try again.</>
</>
```

DURATION accepts `Nms` / `Ns` / `Nm` / `Nh`. Reset-on-reentry per §51.12.4 — re-entering a state with an `<onTimeout>` restarts the timer. Multiple `<onTimeout>` per state-child are legal (each fires independently).

**`<onIdle after=DURATION to=.Variant/>`** — engine-wide idle watchdog. Self-closing. Engine-root scope only (`E-IDLE-MISPLACED` inside a state-child body). One per engine maximum (`E-IDLE-DUPLICATE`). Armed at module-init; **RESET on every successful transition** (any direct write OR advance). Fires after N ms of silence. The watchdog write goes through the standard write path — subject to the current state's `rule=` validation (the engine still respects its own transition contract).

```scrml
<engine for=SessionState initial=.Active>
  <onIdle after=15m to=.LoggedOut/>            <!-- 15 min of silence → log out -->

  <Active rule=.LoggedOut>${@user/}'s dashboard</>
  <LoggedOut>Session expired. <button onclick=${@session = .Active}>Resume</></>
</>
```

**Computed-delay form (§51.12.3.1) — `after=${expr}<unit>`** — accepts any non-negative-number expression. Negative/NaN clamps to 0; the runtime applies `Math.round`. Works on both `<onTimeout>` (engine) and `<onIdle>`:

```scrml
<onTimeout after=${@retryDelayMs}ms to=.Retrying/>
<onIdle after=${@sessionTimeoutMin}m to=.LoggedOut/>
```

Static literals retain their constant-fold path (zero runtime overhead). Computed-form rules opt out of JSON-encoded chained auto-rearm (multi-step computed→computed chains require user-driven writes — single-step works fine).

**Named timers + `cancelTimer("name")` (S79; §51.0.M.1)** — optional `name=IDENT` attribute on `<onTimeout>` makes the timer addressable. The `cancelTimer("name")` builtin cancels a specific named timer; useful for "user took action, cancel the auto-redirect" patterns.

```scrml
<Saving rule=(.Saved | .Error)>
  <onTimeout name="autoRedirect" after=3s to=.Saved/>
  <button onclick=cancelTimer("autoRedirect")>Wait — stay on this screen</>
</>
```

`name=` must match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Unknown names are runtime no-ops (matches `clearTimeout(undefined)` browser semantics). v1 limitation: `cancelTimer()` works inline in event-handler call-ref attributes (`onclick=cancelTimer("X")`) only; expression-form (`onclick=${ cancelTimer("X") }`) falls through to ordinary emission and runtime-fails.

**Tree-shake.** Engines with zero `<onTimeout>` / `<onIdle>` declarations elide the timer machinery entirely — no runtime cost on engines that don't use it.

See SPEC §51.0.M for `<onTimeout>`; §51.0.R for `<onIdle>`; §51.12 for the timer runtime backbone; §51.12.3.1 for computed-delay; §51.0.M.1 for named timers.

### 4.13 Type system flagship — meta blocks, type-as-argument, refinement predicates (§22 + §41 + §53)

Three composable type-system surfaces that account for scrml's distinguishing capability story. Adopters who don't know they exist write JS-style or reach for npm packages that have scrml-native equivalents.

#### `^{}` — the meta context (§22 + S114 Approach C)

A `^{}` block is **compile-time-and-runtime metaprogramming territory**. Inside, you can introspect the scrml type graph, emit code, or read structured metadata about types. The meta surface is **closed at 12 primitives** (S114 Approach C ratification) — no JS-host escape; everything you write is scrml-native, traceable, and verifiable.

```scrml
${
  ^{
    // reflect(TypeName) returns the structural metadata for any scrml type at compile time:
    const user_shape = reflect(User)
    meta.emit("User has " + user_shape.fields.length + " fields")
  }
}
```

The 12 primitives include `reflect(TypeName)` (type introspection), `meta.emit(str)` (compile-time stdout — adopter-debuggable), `meta.emit.raw(str)` (codegen splice), `meta.interval` / `meta.timeout` (compile-time timers per S114), and a small set of structured-type accessors. `^{}` blocks are sandboxed — no DOM, no SQL, no I/O. Misuse fires `E-META-001` with a per-identifier hint.

**Manifest gate** (§22.13). If you need to call into a JS host module from a `^{}` block — rare; the closed set covers most needs — declare it under `[capabilities] host-import` in `scrml.toml`. The gate is opt-in per-project; no implicit host access.

74+ scrml sample + example files use `^{}`. It's the substrate for the type-as-argument family (next).

#### The type-as-argument family — L22 (§41.13-§41.16)

**The big idea:** you write the type once, and the compiler derives a form, a SQL schema, a table view, a structured parser — all from that one type definition. No code duplication; no two-source-of-truth drift. **L22 (S65 ratification)** locks "type-as-argument" as a first-class language primitive.

Four shipped (or shipping) family members:

```scrml
type SignupForm:struct = {
    email:    string,
    password: string,
    age:      int(>=18)
}

// 1. parseVariant — boundary-parse an unknown string into a typed variant
${
  const result = parseVariant(MyEnum, request.body.kind)   // → MyEnum | ParseError
}

// 2. formFor — type-driven form generation; FLAGSHIP (scrml.dev demo)
//    Canonical attribute form: for=TypeName (NOT bare positional)
<formFor for=SignupForm onsubmit=handleSignup/>
  <!-- The compiler synthesizes: <email req>, <password req length(>=8)>, <age req>,
       a submit button, the validity surface, the error-rendering elements,
       and the bind:value plumbing. ONE LINE. -->
</>

// 3. schemaFor — type-driven SQL schema (DDL) generation
//    Function-call form (NOT markup-element) — different shape from formFor/tableFor
//    because the output is a DDL string, not markup. Use inside <schema> blocks
//    via ${...} interpolation per SPEC §41.15.
${
  ^{
    const ddl = schemaFor(SignupForm)
    meta.emit.raw(ddl)   // emits: CREATE TABLE signup_form (email text, password text, age integer check (age >= 18))
  }
}

// 4. tableFor — type-driven admin-UI table for a record collection
//    Canonical attribute form: for=TypeName (NOT bare positional)
<tableFor for=SignupForm rows=@users/>
```

**`pick=` / `omit=` / `partial=true` field-set transforms (§41.14.5 / §41.15.4 / §41.16.5).** Every L22 family member supports the same field-set vocabulary for selecting which struct fields participate in the synthesized output. The canonical form is **a string-literal array** (`pick=["email", "password"]`) — NOT bare identifiers. Bare identifiers fall through to scope resolution and fire `E-SCOPE-001` because the field names aren't declared identifiers in the surrounding scope:

```scrml
type Signup:struct = { email: string, password: string, age: int(>=18), referredBy: string | not }

// formFor — pick a subset of fields, omit the rest
<formFor for=Signup onsubmit=submitFn pick=["email", "password"]/>

// formFor — omit one field (everything else stays)
<formFor for=Signup onsubmit=submitFn omit=["referredBy"]/>

// formFor — make picked fields optional (relaxes req validators for the form's validity surface)
<formFor for=Signup onsubmit=submitFn pick=["email", "password"] partial=true/>

// tableFor — pick visible columns
<tableFor for=Signup rows=@users pick=["email", "age"]/>

// schemaFor — function-call form uses an object literal (different shape from markup-element form)
${ const ddl = schemaFor(Signup, { pick: ["email", "password"] }) }
```

**Anti-pattern** — bare-identifier pick lists like `pick=[email, password]` are NOT canonical and fire `E-SCOPE-001` per field. Quote each field name. `pick=` and `omit=` are mutually exclusive on the same call (`E-FORMFOR-PICK-OMIT-CONFLICT` / `E-TABLEFOR-PICK-OMIT-CONFLICT` / `E-SCHEMAFOR-PICK-OMIT-CONFLICT`). Field names not present on the struct fire `E-FORMFOR-PICK-INVALID-FIELD` (or the equivalent for the other family members).

`parseVariant` shipped S65; `formFor` shipped S102; `schemaFor` shipped S104; `tableFor` shipped S105. All four are imported from `scrml:data`. Per-field customization (slot-based for `formFor`/`tableFor`, attribute-based for `schemaFor`) is documented in SPEC §41.13-§41.16.

**Synonym-detection discipline.** Per L22 + the §53.14.4 canon, the family REPLACES rather than wraps existing tools (`zod`/`yup`/`prisma`/`drizzle` schema-bridges) — type-as-argument is the scrml-native shape. Adjacent npm-style wrappers are anti-pattern.

#### Refinement-type predicates — value constraints in the type position (§53)

scrml's type system accepts **predicates IN the type position** (not just structural-types). The shared-core 14 validator predicates (`req`, `length(>=N)`, `pattern(...)`, `eq(...)`, etc.) compose with type names directly:

```scrml
let percent: number(>=0 && <=100) = 50      // refinement-typed local
let email:   string(pattern(EMAIL_RE)) = "" // pattern-constrained string
<age req>: int(>=18) = 0                    // refinement-typed reactive cell
```

**Three loci** of "exists/required/constrained" — schema column (SQL DDL: `not null` / `check`), state validator (`req` / `length(>=2)`), refinement type (predicate form). Each fires in its layer's enforcement context — **NOT redundancy** — the same `length(>=2)` predicate in a `<schema>` column generates a `CHECK (length(name) >= 2)` SQL constraint; in a state cell, validates the user input reactively; in a refinement type, gates assignment statically. ONE vocabulary, three loci, three enforcement layers (L4 ratification).

**SPARK three-zone semantics** (§53.6.1 / §53.6.2 — boundary + trusted + static zones). Briefly: predicates ONLY runtime-check at the **boundary zone** (where untrusted input enters: form submit, server-fn arg, JSON.parse result). Inside the **trusted zone** (after a predicate passed at the boundary), the type is statically narrowed; no re-check. The **static zone** is compile-time literal evaluation (`let x: number(>0) = 5` constant-folds the predicate check away). Adopters get runtime safety without the runtime cost of pervasive re-validation.

```scrml
server function createUser(email: string(pattern(EMAIL_RE))) {
    // email is in the BOUNDARY zone here — runtime check happens at entry.
    // Inside this body, email is in the TRUSTED zone — no re-checks.
    ?{`INSERT INTO users (email) VALUES (${email})`}.run()
}
```

See SPEC §22 for `^{}` meta context; §41.13-§41.16 for the L22 family; §53 for refinement-type predicates + SPARK zones.

---

## 5. The auto-await rule — your strongest instinct will be wrong

If you have any JS/TS background, your fingers will type `await` in front of every server-function call. **Don't.** scrml's compiler auto-inserts `await` at every server-function call site (§13.1 + §13.2) and **explicitly forbids developers from writing `async`, `await`, `Promise`, or `Promise.all` in source.**

```scrml
// CORRECT — no async, no await, no Promise:
server function loadUser(id) {
  return ?{`SELECT * FROM users WHERE id = ${id}`}.get()
}

function showUser() {
  const user = loadUser(@selectedId)   // compiler injects await
  @user = user
}
```

```scrml
// WRONG — these will not compile:
async function showUser() {                           // ❌ no async
  const user = await loadUser(@selectedId)            // ❌ no await
  return Promise.all([loadUser(1), loadUser(2)])      // ❌ no Promise
}
```

This rule covers the entire scrml source surface — server functions, client functions, event handlers, recipes, everything. If you're about to write `await`, stop.

---

## 6. Validators, validity surface, and error rendering

scrml's validation is **declarative**. Don't write imperative `validate()` functions; declare validators directly on state-cell declarations and let the compiler synthesize the validity surface and the error display path.

### 6.1 The shared validator vocabulary

These predicates work in three loci with different enforcement contexts: state-cell declarations (reactive form-validity), refinement type expressions (compile-time + runtime boundary), and `<schema>` column constraints (additive to SQL-mirror DDL — the schema block KEEPS its `not null`/`unique`/`references` words; these are extras).

| Predicate | Meaning | Example |
|---|---|---|
| `req` | Non-empty value (string `""` fails; `not` fails) | `<name req>` |
| `is some` | Value exists at all (`not` fails). Coexists with `req` because `""` IS some. | `<x is some>` |
| `length(predicate)` | String/array length matches the predicate | `<name length(>=2)>` |
| `pattern(regex)` | String matches the regex | `<email pattern(/^[^@]+@[^@]+$/)>` |
| `min(n)`, `max(n)` | Numeric range | `<age min(18) max(120)>` |
| `gt(expr)`, `lt(expr)`, `gte(expr)`, `lte(expr)` | Comparisons against expressions | `<endDate gte(@startDate)>` |
| `eq(expr)`, `neq(expr)` | Equality / inequality against expressions | `<confirm eq(@password)>` |
| `oneOf([...])`, `notIn([...])` | Set membership | `<role oneOf([.Admin, .Editor, .Viewer])>` |

**Cross-field validation falls out automatically.** When a predicate's argument is a cell-reference expression (e.g., `eq(@password)`, `gte(@startDate)`), the compiler tracks the dependency; the validator recomputes when either cell changes. There's no special "cross-field" vocabulary.

### 6.2 The auto-synthesized validity surface

When a compound state declaration contains any field with validators, the compiler auto-synthesizes a reactive validity surface at TWO levels:

```
@signup.isValid       : boolean   (true iff ALL fields pass their validators)
@signup.errors        : { name: [...], email: [...], password: [...] }   // map per field
@signup.touched       : { name: bool, email: bool, ... }                  // first-interaction tracking
@signup.submitted     : boolean   (true after first submit attempt)

// Per-field access — same surface scoped to one field:
@signup.name.isValid  : boolean
@signup.name.errors   : [...errorTags]
@signup.name.touched  : bool
```

**All synthesized properties are READ-ONLY** (`E-SYNTHESIZED-WRITE` if you try to assign them). `errors` arrays contain `ValidationError` enum tags, NOT strings.

This surface is synthesized for compounds only — Tier 1 single-value cells with validators don't get the auto-namespace; their value remains the primitive at `@count`.

### 6.3 The error rendering element — `<errors of=expr/>`

Errors render via the first-class `<errors of=expr/>` markup element. Composable per-field or compound:

```scrml
<form onsubmit=submit()>
  <div class="field">
    <label>Name</label>
    <name/>
    <errors of=@signup.name/>      <!-- per-field; renders first error by default -->
  </div>

  <div class="field">
    <label>Email</label>
    <email/>
    <errors of=@signup.email/>
  </div>

  <button type="submit" disabled=!@signup.isValid>Save</button>

  <errors of=@signup all/>          <!-- compound rollup, all errors as list -->
</form>
```

Default rendering is single-first-error wrapped as `<p class="scrml-error">${messageFor(errors[0])}</p>`. The `all` attribute renders the full array.

**Body override** when you need full custom rendering:

```scrml
<errors of=@signup.name>
  ${(err) => <span class="my-error">⚠️ ${messageFor(err)}</span>}
</>
```

### 6.4 Where error messages come from — the four-level resolution chain

`@signup.name.errors` contains `ValidationError` enum tags (`.Required`, `.TooShort(2)`, `.PatternMismatch(re)`, `.EqFailed(expected)`, `.GteFailed(target)`, etc., plus `.Custom(tag)` for developer-defined validators). User-facing strings are resolved in this order:

1. **Inline override on the field declaration** (highest priority, static-string only):
   ```scrml
   <name req("Please enter your name") length(>=2, "Name must be at least 2 chars")> = <input/>
   ```

2. **Project-registered messages** (registered once at app boot — the i18n + brand-voice hook):
   ```scrml
   ${
     use scrml:data
     data.registerMessages({
       .Required:    (field) => `Please fill in ${field}.`,
       .TooShort:    (field, n) => `${field} must be at least ${n} characters.`,
       .EqFailed:    (field) => `Doesn't match.`,
       ...
     })
   }
   ```

3. **`scrml:data` shipped English defaults** (zero-config; works for prototype-phase apps).

4. **`match` escape hatch** (full developer control via L6 match machinery):
   ```scrml
   <match for=ValidationError on=@signup.name.errors[0]>
     <Required>     : "Name is required"
     <TooShort(n)>  : "Name must be at least ${n} characters"
   </>
   ```

`messageFor(errorTag)` (auto-imported via `use scrml:data`) walks levels 1-3 automatically. Use the match form when you need specific control.

### 6.5 Multiple errors per field

When `req` fails, the validator chain SHORT-CIRCUITS — only `.Required` is reported (other validators on an empty cell are vacuous). Otherwise validators COMPOSE — a non-empty value can fail both `length` and `pattern` simultaneously, producing two error tags.

Default `<errors of=...>` shows `errors[0]` only. Use `all` attribute for full-list rendering.

### 6.6 Resetting state — `reset(@cell)`

`reset()` is a **reserved language keyword** per SPEC §6.8 — no import needed AND you cannot define your own `reset`. A local declaration named `reset` (function or otherwise) collides with the keyword and fails. **Pick a different name** (`clearForm`, `resetSignup`, `wipeFields`) when you need a custom reset routine.

`reset(@cell)` mutates in place; returns nothing.

```scrml
<button onclick=reset(@signup)>Clear form</button>
```

Per-cell semantics: if the declaration carries an explicit `default=` attribute, that expression is evaluated at reset time; otherwise the init expression re-evaluates. Per §3.1.

Per-field reset: `reset(@signup.name)` resets just that field by the same rule.

### 6.7 Multi-statement event handlers — name the function

Inline event handlers accept ONE form: a bare call, a bare assignment, or a bare single-expression. Anything more requires a named function:

```scrml
// ✅ Legal inline:
<button onclick=submit()>Save</button>
<button onclick=@signupPhase = .Editing>Try again</button>
<button onclick=@count++>+</button>

// ❌ Illegal inline (multi-statement):
<button onclick=reset(@signup); @signupPhase = .Editing>Sign up another</button>
<button onclick=() => { fn(); @x = .Y }>...</button>

// ✅ Multi-statement → named function:
${
  function startOver() {
    reset(@signup)
    @signupPhase = .Editing
  }
}
<button onclick=startOver()>Sign up another</button>
```

### 6.8 Error handling beyond validators — `<errorBoundary>` + per-handler transactions (§19)

The validator surface above (§6.1-§6.7) covers FORM-DATA errors (the user's input is invalid). For OPERATIONAL errors — a server function fails, a SQL query errors, a render-time exception escapes — scrml has two distinct mechanisms.

**(1) `fail` / `!{}` at the call site (§19.3-§19.5).** A failable function declares its error type and surfaces failures with `fail`. The call site MUST exhaustively handle them via `!{}`.

```scrml
type LoadError:enum = { Network(msg: string), Empty, Unauthorized }

server function loadDashboard()! -> LoadError {
    const rows = ?{`SELECT * FROM dashboard WHERE user_id = ${@currentUser.id}`}.all()
    if (rows.length == 0) fail LoadError::Empty
    return rows
}

${
  const rows = loadDashboard() !{
    | ::Network msg     -> { @phase = .Error(msg); return }
    | ::Empty           -> { @phase = .Empty;       return }
    | ::Unauthorized    -> { navigate("/login", .Hard); return }
  }
  @phase = .Loaded(rows)
}
```

Variants are exhaustive — missing one fires `E-FAIL-NOT-EXHAUSTIVE`. Variants surface in the engine's enum as states (the errors-as-states pattern from §11.5 loading recipe).

**(2) `<errorBoundary>` for render-context error catch (§19.6).** When a `!`-function call sits in markup context — e.g., a `${loadDashboard()}` interpolation, or a derived expression that fails on bad upstream data — `<errorBoundary>` catches the error variant and displays a fallback. It is the markup-context counterpart to `!{}`:

```scrml
type DashError:enum = {
    Empty
        renders <div class="empty">Nothing to show yet.</>
    Unauthorized
}

<errorBoundary fallback={<div class="error">Couldn't load this section. The error has been logged.</>}>
    ${loadDashboard()}
    ${loadActivity()}
</>
```

A caught error variant displays via its OWN `renders` clause (§19.2) when it has one — `Empty` renders its own `<div class="empty">…</>`, with payload fields in scope. A variant WITHOUT a `renders` clause (e.g. `Unauthorized`) falls through to the boundary's `fallback={<markup/>}` (priority: variant `renders` > boundary `fallback`, §19.6.5). The compiler statically verifies every reachable variant is displayable (E-ERROR-005, §19.6.6) — a variant with neither `renders` nor a covering `fallback` is a compile error. Boundaries nest — an inner boundary catches before an outer (inner-catches-first, §19.6.4). The compiler ALSO emits a host-JS backstop (§19.6.8) so an unexpected NON-`!` throw during render degrades to `fallback` too. The boundary does NOT swallow the error; it's routed to scrml's logging surface for diagnosis. (The backstop is compiler-emitted host-JS, NOT a scrml-source try/catch — §19.9.8 stands.)

**Implicit per-handler transactions (§19.10.5).** Inside an `!{}` handler arm, any SQL writes the arm performs are wrapped in an implicit transaction. If the arm fails (re-throws OR a downstream `!{}` doesn't catch), the writes ROLL BACK automatically. Atomic-rollback semantics without `BEGIN`/`COMMIT` ceremony — the canonical safety property. To opt-OUT (commit-on-error), annotate the handler arm with `@nosql-tx`.

**Body-split / CPS — compiler-managed (§19.9; one-line cross-ref).** Server-function calls inside non-top-level positions (inside `if`, `match`, loop bodies) compile-to-CPS — the compiler splits the function body at server-call boundaries. Multi-batch CPS (§19.9.9, S114 Ext 1) extends this. Adopters never write the CPS form; it's invisible at source. Failures route through `!{}` naturally.

**`test-bind` for failure-injection in tests (§19.12, S74).** The `test-bind <serverFnName> = <handler>` declaration replaces a server-fn call with a test-supplied handler at compile time. Zero runtime cost (production binary unchanged). Use for testing error-path branches without touching the database.

---

## 7. Anti-pattern table — STOP and use the scrml form

If your instinct from another framework fires, stop and use the scrml form. These are the convergent failures every LLM makes when writing scrml without context:

| You're about to write… | …because of (framework) | Use this in scrml |
|---|---|---|
| `<script setup>` block | Vue | `${ ... }` logic block inside `<program>` |
| `---` frontmatter fences | Astro | `${ ... }` logic block inside `<program>` |
| `signal(0).value`, `ref(0).value` | Solid, Vue, Preact | `<var> = 0` to declare; `@var` to read; `@var = X` to write |
| `useState(0)` | React | `<var> = 0` to declare; `@var` to read; `@var = X` to write |
| `$state(0)` rune | Svelte 5 | `<var> = 0` to declare; `@var` to read; `@var = X` to write |
| `let var = 0` (intending reactive) | (any) | `<var> = 0` — V5-strict structural form. Bare `let` is NON-reactive. |
| `@var = 0` to declare | (older scrml v1) | **`<var> = 0`** — declaration is structural. Use `@var` only for expression access. |
| `computed(() => …)`, `$:` | Vue, Svelte | `const <derived> = expr` (read at `@derived`) |
| `useEffect(() => …)` | React | Reactive expressions update automatically; effects are usually unnecessary |
| `await x()` | JS/TS | bare `x()` — compiler auto-awaits server fns (§5 above) |
| State machine via `if @phase === 'loading'` chains | (any) | **An engine.** `<engine for=PhaseEnum initial=.Loading>...</>` — read §4 |
| Many booleans gating UI (`@isLoggedIn`, `@isLoading`, `@isError`, …) | (any) | **An engine** over an enum. The compiler will lint `W-LIFECYCLE-CANDIDATE` and suggest. |
| `match @x { .V => { lift <Comp> } }` to render component per state | (looks obvious) | An **engine** — state-children replace this pattern entirely |
| `<MarioMachine/>` use-site for a same-file engine | (older scrml) | The engine renders **at its declaration position**. Use-site only exists for cross-file imports. |
| `.tryAdvance(.X)` or `@x.advanceIfValid(.Y)` | (invented) | Use `if (@marioState == .Small) @marioState = .Big`. Silent no-op on invalid is forbidden. |
| `<onEnter>` / `<onLeave>` lifecycle elements inside engines | (XState, others) | Use `<onTransition from=X>` (entering) or `<onTransition to=Y>` (leaving). One concept. |
| `<chrome>` / `<*>` template construct inside engines | (invented) | **Snippets.** Define a snippet, call it in each state-child body. |
| `{#if cond}…{/if}` | Svelte | `<element if=cond>...</element>` — `if=` is an **attribute**, not a tag. Or `${if (cond) { lift ... }}` in a logic block. |
| `{#each items as item}…{/each}` | Svelte | **`<each in=@items key=@.id>...</each>`** (Tier 1, §11.10) — `@.` is the current item; `<empty>` handles the zero-items case. The Tier-0 form `${ for (let item of @items) { lift <li>...</li> } }` also compiles (`W-EACH-PROMOTABLE` nudges the lift). |
| `<for each= in=>` / `<if test=>` markup tags | (invented) | **The iteration tag is `<each>`, not `<for>`; there is no `<if>` tag.** Iterate with `<each in=@coll>...</each>` (Tier 1, §11.10) or `${ ... lift ... }` (Tier 0); branch with the `if=` attribute or `${ if (...) { lift ... } }`. |
| `items.map(item => …)` in JSX | React | **`<each in=@items key=@.id>...</each>`** (Tier 1, §11.10). The Tier-0 `${ for (let item of @items) { lift <…> } }` form also compiles. |
| `${ function name(p){ … lift <markup/> } }` — a one-shot named function that `lift`s markup | (training-data muscle memory) | **That does NOT compile — `E-SYNTAX-002` (`lift` is illegal in a bare `function` body).** A `function` `return`s markup; it never `lift`s. Use the idiom for your case (§11.11): iteration → `<each>` / `${for…lift}`; conditional → ternary / `if=` / `const <badge>`; computed → `const <x> = expr` + `${@x}`; helper → `fn name(p) -> T { return … }` + `${name(args)}`; reused fragment → `snippet` prop + `render` + `{ (p) => <markup> }`. |
| `bind:value={x}` | Svelte | `bind:value=@x` (no braces; `@` sigil required because it is an expression-position read of state) |
| `v-model="x"` | Vue | `bind:value=@x` |
| `on:click={fn}`, `@click="fn"`, `onClick={fn}` | Svelte/Vue/React | `onclick=fn()` (bare call, parens included) |
| `import Database from 'better-sqlite3'` | Node | Don't. Use `< db src="...">` + `?{}` blocks. |
| `db.prepare(sql).all(params)` | better-sqlite3 | `?{`SELECT …`}.all()` — `.prepare()` does not exist (E-SQL-006) |
| `await prisma.product.findMany({where: {…}})` | Prisma | `?{`SELECT * FROM products WHERE …`}.all()` |
| `socket.io`, Phoenix Channels | Node, LiveView | `<channel>` (file-level — see §11.3 real-time recipe) |
| `useEffect(() => fetch(url).then(...))` | React | `<request id="profile">${ @user = fetchUser(@id) }</>` — declarative fetch |
| Custom `room { state {} on join() {} broadcast event() }` DSL | Phoenix LiveView | `<channel>` markup tag — see §11.3 real-time recipe |
| `<slot />` inside SFC | Vue, Svelte | Multi-slot: `slot="name"` on call-site children + `${render slotName()}` in component body. Single unnamed children: `${children}`. |
| `import { x } from 'scrml'` | (invented) | No bare scrml import. Stdlib uses `import { x } from 'scrml:auth'`, `'scrml:data'`, etc. Capability form: `use scrml:auth`. |
| Hand-rolled debounce in `effect()` | (invented) | `@debounced(300) <debouncedQuery> = @query` — declaration modifier, NOT `.debounced()` postfix. |
| zod / yup / joi schema for runtime validation | (npm) | Compile-time: `let x: number(>0 && <100)`. Runtime: `import { validate } from 'scrml:data'` |
| `bcrypt`, `jsonwebtoken`, custom session table | npm | `import { hashPassword, signJwt } from 'scrml:auth'` — built in |
| `pg`, `mysql2`, `better-sqlite3` packages | npm | Bun.SQL via `?{}` — driver picked from `< db src="...">` URL scheme |
| `scrml migrate v0next` to translate old code | (anticipated) | **Does not exist.** v0.next IS scrml. There is no compat mode. |
| `function validate() { if (@x.field == "") ... }` | React/Vue imperative | Declarative: `<x.field req>` on the cell decl. `@x.isValid` and `@x.errors` are auto-synthesized (see §6). |
| Per-field `if (@signup.errors.name.length > 0) <p>...</p>` | (verbose) | `<errors of=@signup.name/>` — first-class markup element (§6.3). |
| `<input bind:value=@signup.name>` written separately | v1 / generic frameworks | Decl-coupled: `<name req> = <input/>` declares cell + render-spec + validator together. Then `<name/>` in markup expands to the bound input (§3.1, §6). |
| `onclick=fn(); @x = .Y` (multi-statement inline) | JS/Vue/Svelte | Name the function: `function startOver() { fn(); @x = .Y }` then `onclick=startOver()` (§6.7). |
| `function reset() { ... }` defined locally | (training-data muscle memory) | `reset` is a reserved language keyword. Pick another name. Use `reset(@cell)` to reset state to its declared default (§6.6). |
| `<MyEngine/>` for a same-file engine | (over-eager-mount) | Same-file engines render at declaration position. `<EngineName/>` use-site is for cross-file mounts only (§4.2). |
| `derived=@source` expecting auto variant-name matching | (anticipated shorthand) | `derived=expr` accepts any reactive expression of the engine's type. Use a `match` block: `derived=match @source { .A | .B => .X, _ => .Y }` (§4.10). |
| `<onEnter>` / `<onLeave>` lifecycle elements | XState, RxJS | Use `<onTransition from=X>` (entering) or `<onTransition to=Y>` (leaving) — one concept (§4.4). |
| `match=@x` attribute for cross-field validation | (extrapolated) | Use `eq(@x)` predicate. `<confirm req eq(@signup.password)>`. There's no `match=` attribute (collides with `<match>` block) (§6.1). |
| `not null` / `unique` on a state cell | SQL muscle memory | Schema vocabulary stays in `<schema>`. State cells use `req`, `length(>=N)`, `eq(...)`, etc. — the shared core. Schema also accepts the shared core (additive). |
| `<phase>: (Idle to Done) = .Idle` next to `<engine for=Phase initial=.Idle>` over the same cell | (extrapolation) | **Engine cells reject lifecycle annotation** (`E-TYPE-LIFECYCLE-ON-ENGINE-CELL`). Engines own variant-graph progression via `rule=`. For lifecycle on a NON-engine cell, declare as plain Shape 1. For variant-graph state, use the engine — don't put a lifecycle annotation on its auto-declared variable (§3.2). |
| `(A -> B)` lifecycle annotation in new code | legacy glyph | Use `to`: `(A to B)`. The `->` glyph is accepted during the deprecation window and surfaces `W-LIFECYCLE-LEGACY-ARROW`. `to` is the canonical (§3.2). |
| `transition(u)` on every assignment defensively | over-application | `transition()` is for **variant-progression** `(.A to .B)` returns after discrimination. **Presence-progression** `(not to T)` discriminates via `given` / `if-is-not` / `match` — the act of discriminating IS the transition; an additional `transition()` is redundant (§3.2). |
| `if (@u is some) { use(@u.name) }` to narrow + use | habit from `if (x !== null)` patterns | **`given x => use(x.name)`** is the canonical narrow-AND-use form (§42.2.3). The bound `x` is type-narrowed to non-`not` inside the body. `if (x is some)` only BRANCHES; `given` BINDS the narrowed value. (Also: `T \| not` is the canonical absence-possible union; `""` / `0` / `false` are defined values, NOT absence — §42.1.1.) |

**If you don't see your case in the table, default to the canonical shape from §2.** Do not invent syntax.

### 7.1 Word-form ↔ symbol-form parallels — both work (S136 R24 ratification)

A small set of operator-position forms accept BOTH the JS-style symbol form AND a word-form alias. Neither is "more canonical" — adopters use whichever reads better in context:

| Word form | Symbol form | Semantics | SPEC |
|---|---|---|---|
| `or` | `\|\|` | Logical OR (short-circuit) | §45.9 |
| `and` | `&&` | Logical AND (short-circuit) | §45.9 |

```scrml
// All four are bit-identical at codegen:
const <a> = @x is .Active or @y == 1
const <b> = @x is .Active || @y == 1
const <c> = @x is .Active and @y == 1 and @z is some
const <d> = @x is .Active && @y == 1 && @z is some
```

The compiler lowers word-form to symbol-form at the JS-host boundary; both paths produce bit-identical emitted JS. Mixed-form expressions (`a or b && c`) are legal but stylistically discouraged. Precedence follows JS standard (`&&` / `and` bind tighter than `\|\|` / `or`).

**NOT in this category** — these are word-form keywords that DO NOT have symbol-form aliases:

- `not` — the ABSENCE value, NOT a logical-NOT operator. `not` ≠ `!`. Use `is not` / `is some` for absence predicates; use `!` for logical negation (still JS-host); see §42 (PRIMER §9.5).
- `is` / `is not` / `is some` — presence + variant predicates with no JS-host equivalent.
- `given X => {}` — narrow-AND-use form with no JS-host equivalent.

---

## 8. The 8 questions answered up front

These are the questions every LLM silently guesses wrong on. The right answers:

1. **File extension:** `.scrml`
2. **Runtime:** **Bun**, not Node. Bun.SQL handles SQLite + Postgres natively. MySQL deferred.
3. **DB layer:** Built into the language via `?{}` blocks. **DO NOT npm install any DB driver.** `< db src="./app.db">` for SQLite, `< db src="postgres://...">` for Postgres.
4. **Form mutations:** `server function name(args)` inside `${ ... }`. Bare-call event handlers in markup: `<form onsubmit=addItem()>`. No separate `.server.js` files.
5. **Template syntax:** `${expr}` for interpolation. Control flow uses `if=` attribute on elements, or `${ if (cond) {...} }` and `${ for (let x of xs) {...} }` inside logic blocks. NOT JSX, NOT Svelte braces. **No `<if>` or `<for>` markup tags exist.**
6. **State model:** `<var> = init` to declare; `@var` to read; `@var = X` to write. **V5-strict — read §3 in full.** State machines are first-class via `<engine>` — read §4 in full.
7. **Component model:** `const Card = <article props={ title: string, body: string }>...</>`. Markup-defined. Multi-instance. **Components stay distinct from engines** — read §4.9.
8. **Type system:** Independent of TypeScript. Structs and enums (`type X:struct = {...}`, `type X:enum = {...}`). **Inline type predicates** (`number(>0 && <100)`, `string.length(>3)`) are compile-time refinement types. Don't use TS syntax in scrml — it's not TS.

---

## 9. Stdlib catalog — DO NOT npm install these

scrml ships a focused stdlib that covers ~80% of typical-app npm needs. Import from `scrml:<module>` (value imports) or as a capability via `use scrml:<module>`. Do not try to npm install equivalents for things in the table.

> **Catalog snapshot:** 2026-05-04, verified against stdlib at compiler SHA `f983198`. Each row lists *selected* exports; for the full export list of a module, read `stdlib/<module>/index.scrml` directly. If a function isn't in this row but is exported from the module, it's still part of the stdlib — don't reach for npm.

| stdlib module | Selected exports | Replaces (npm) |
|---|---|---|
| `scrml:data` | `validate(data, schema)`, `isValid`, `firstError`; predicate builders `required`, `email`, `minLength/maxLength/exactLength`, `pattern`, `min/max`, `numeric`, `integer`, `oneOf`, `url`, `custom`; transforms `pick`, `omit`, `groupBy`, `indexBy`, `sortBy`, `unique`, `flatten/flattenDeep`, `chunk`, `deepMerge`, `clamp`, `paginate` | zod, yup, joi, lodash |
| `scrml:auth` | `hashPassword`, `verifyPassword`, `generatePassword`; `signJwt(payload, secret, expiresIn)`, `verifyJwt(token, secret)`, `decodeJwt`; `createRateLimiter`; `generateTotpSecret`, `verifyTotp` (RFC 6238) | bcrypt, jsonwebtoken, speakeasy, express-rate-limit |
| `scrml:crypto` | `hash(algo, input)`, `verifyHash`, `hmac(secret, payload)`, `safeCompare`, `generateUUID`, `generateToken` | crypto-js, bcryptjs, uuid |
| `scrml:http` | REST helpers: `get(url, opts)`, `post(url, body, opts)`, `put`, `del`, `patch` (each with timeout + retry support); `withBaseUrl(baseUrl)`, `isOk(response)`, `isError(response)`; **middleware**: `withAuth(token, scheme?)`, `withDefaults(defaults)`, `retry(fn, opts)` (exp backoff + jitter); **uploads**: `multipart(fields)`, `uploadFile(url, file, opts?)` | axios, got, node-fetch, ky |
| `scrml:time` | `formatDate`, `formatTime`, `formatDateTime`, `formatRelative`, `formatDuration`; `parseDate`, `isValidDate`; `startOf(ts, unit)`, `addTime`, `diffTime`; `debounce(fn, ms)`, `throttle(fn, ms)`, `sleep(ms)`; **timezone-aware**: `formatInTimezone(ts, tz, opts?, locale?)`, `nowInTimezone(tz, opts?, locale?)`, `toTimezoneParts(ts, tz)`, `tzOffset(tz, ts?)`; **ISO 8601**: `formatISO(ts)`, `parseISO(str)` | date-fns, dayjs, lodash.debounce, luxon (timezone) |
| `scrml:format` | `formatCurrency`, `formatNumber`, `formatPercent`, `formatBytes`; `slug`, `pluralize`, `titleCase`, `capitalize`, `toWords`; `truncate`, `padLeft`, `padRight`; **locale-aware Intl**: `compactNumber(n, locale?)`, `formatList(items, type?, locale?)`, `formatRange(start, end, currency?, locale?)`, `formatNumberAdvanced(n, options, locale?)` | slugify, change-case, pluralize |
| `scrml:store` | `createStore`, `createSessionStore`, `createCounter` (KV / session / counter via SQLite + memory) | connect-sqlite3, basic redis use |
| `scrml:router` | `match(pattern, path)`, `parseQuery`, `buildUrl(pattern, params, query)`, `navigate(url, opts)`, `currentPath`, `onNavigate(pattern, handler)` | path-to-regexp, qs |
| `scrml:test` | Assertion family: `assertEqual`, `assertNotEqual`, `assertTruthy`, `assertFalsy`, `assertNull`, `assertDefined`, `assertThrows`, `assertNoThrow`, `assertInRange`, `assertContains`; `group(label, fn)` | chai, parts of jest/expect |
| `scrml:fs`, `scrml:path`, `scrml:process` | Node compat layer — file ops, path manipulation, env/argv/cwd/exit | (Node built-ins) |
| `scrml:redis` | Wraps `Bun.redis` (Bun ≥1.3). `get(key)`, `set(key, value)`, `setex(key, value, seconds)`, `del`, `exists`, `expire`, `ttl`, `incr`, `decr`, `getBuffer`; sets: `sadd/srem/sismember/smembers`; pub/sub: `publish(channel, msg)`, `subscribe(channel, fn)`, `unsubscribe`; custom URL: `createClient(url, opts)`; raw: `send(cmd, args)`; `close()`. All ops are async. Server-side only. | ioredis, redis (npm) |
| `scrml:cron` | Wraps `Bun.cron` (Bun ≥1.3.12). `schedule(pattern, handler)` — returns CronJob handle with `.stop()/.ref()/.unref()`. `nextOccurrence(pattern, [relativeDate])` (Bun ≥1.3.12 only) — preview next fire as Date. `stop(job)` — convenience. Standard 5-field cron + `@daily/@weekly/@monthly/@yearly`. Server-side only; in-process. | node-cron, croner (npm) |
| `scrml:regex` | Vetted `patterns` catalog (email, url, ipv4, ipv6, uuid, slug, hexColor, semver, isoDate, phoneE164, usZip, creditCard, username, password); helpers `test(pat, str)`, `match(pat, str)` (named-groups dict), `extract(pat, str)` (all matches), `replace`, `escape(str)` (regex metachar escape), `caseInsensitive(source)`, `isValid(name, str)` | validator.js, common-pattern snippets |
| `scrml:oauth` | OAuth 2.0 / OpenID Connect client. Auth-code grant with PKCE (RFC 7636), `refreshToken`, `getUserInfo`, `revoke` (RFC 7009). Storage-adapter injection (`{put, get, del}`) for state + verifier — pair with `scrml:redis`, `scrml:store`, or use `memoryAdapter()` for dev. Provider presets: `googleConfig` (+ `parseGoogleIdToken`), `githubConfig` (classic OAuth Apps), `microsoftConfig` (tenant-scoped Entra), `discordConfig`. Server-side only. | passport, simple-oauth2, next-auth (server primitives), googleapis (auth) |

If you reach for `import X from 'some-npm-package'` while writing scrml, stop. Check this table first; if you don't see what you need, read the module's `index.scrml` before npm-installing.

> Note on debouncing: `scrml:time` exports `debounce(fn, ms)` as a **function** decorator. For a **debounced reactive variable**, use the language-level modifier `@debounced(N) <name> = expr` instead. Different tools.

---

## 10. CLI catalog

```
scrml init [dir]      — scaffold a new project
scrml dev <file|dir>  — compile + watch + serve (with HMR)
scrml build <dir>     — production build
scrml serve           — persistent compiler server
scrml compile <file>  — single-file compile to JS
```

There is no `scrml start`. There is no `scrml.config.js` with `defineConfig`. The dev server is part of the language tooling, not a separate config layer. **There is no `scrml migrate v0next`** — v0.next IS scrml.

---

## 11. Domain-specific recipes

If the user's prompt mentions auth, real-time, reactive state, schema, multi-page routing, or a state machine, use these canonical shapes.

### 11.1 Engine recipe — the canonical UI-as-state-machine pattern

This is the **first recipe to reach for** when the UI has more than one mode, lifecycle phase, or screen state. If you're writing more than two booleans that gate the same UI, you want an engine.

```scrml
<program>

${
  type LoadPhase:enum = {
    Idle
    Loading
    Loaded(rows)
    Failed(message: string)
  }

  server function fetchRows() {
    return ?{`SELECT id, name FROM items ORDER BY name`}.all()
  }

  function load() {
    @loadPhase = .Loading
    const rows = fetchRows()
    @loadPhase = .Loaded(rows)
  }
}

<engine for=LoadPhase initial=.Idle>
  <Idle    rule=.Loading>           : <button onclick=load()>Load</button>
  <Loading rule=(.Loaded | .Failed)> : <p>Loading…</p>
  <Loaded(rows) rule=.Idle>
    <ul>
      ${ for (let r of rows) { lift <li>${r.name}</li> } }
    </ul>
    <button onclick=@loadPhase = .Idle>Reset</button>      <!-- bare assignment, L19 -->
  </>
  <Failed(msg) rule=.Idle>
    <p class="error">Failed: ${msg}</p>
    <button onclick=@loadPhase = .Idle>Try again</button>
  </>
</>

</program>
```

Notes:
- One engine replaces what would otherwise be three booleans + a data variable + a render-chain. The compiler can verify exhaustiveness.
- Payload variants (`.Loaded(rows)`, `.Failed(msg)`) destructure inside their state-child body.
- Transitions in `load()` use direct write (`@loadPhase = .Loading`). Compile-time validation kicks in when the from-state is statically known.

### 11.2 Auth recipe

`signJwt` requires three arguments: `(payload, secret, expiresIn)`. Calling it with one will runtime-crash (the secret is the HMAC key).

```scrml
<program>

< db src="users.db" protect="password_hash" tables="users">

  ${
    import { hashPassword, verifyPassword, signJwt } from 'scrml:auth'

    server function signup(email, password) {
      const hash = hashPassword(password)
      ?{`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash})`}.run()
      return signJwt({ email }, process.env.JWT_SECRET, 3600)
    }

    server function login(email, password) {
      const user = ?{`SELECT password_hash FROM users WHERE email = ${email}`}.get()
      if (!user) return not
      return verifyPassword(password, user.password_hash)
        ? signJwt({ email }, process.env.JWT_SECRET, 3600)
        : not
    }
  }

</>

</program>
```

Notes:
- `protect="password_hash"` makes the field server-only — accidental exposure in markup is a compile error.
- The auth middleware is auto-injected (`auth="required" csrf="auto"`) because `protect=` is present (W-AUTH-001 will inform you).
- No `connect-sqlite3`, no `express-session`, no `passport`. The session token from `signJwt` is the session.
- For multi-field protection, use **comma-separated** values: `protect="password_hash, session_token"`.
- For auth-as-engine (login → loggedIn → tokenRefresh → expired), use the engine recipe (§11.1) with an `AuthPhase` enum. This is the post-S55 idiom.

#### 11.2.1 OAuth recipe — sign in with Google (or GitHub, Microsoft, Discord)

For third-party identity, reach for `scrml:oauth`. The flow is two server functions: one starts the redirect, one handles the callback. The compiler has no knowledge of OAuth; the module ships with provider presets so callers don't write endpoint URLs.

```scrml
<program>

${
  import { startFlow, exchangeCode, getUserInfo } from 'scrml:oauth'
  import { googleConfig } from 'scrml:oauth'
  import { setex, get as redisGet, del as redisDel } from 'scrml:redis'

  // Storage adapter for state + PKCE verifier — wire your own backend.
  // The shape is { put, get, del }. Redis is one option; scrml:store works too.
  const oauthStorage = {
    put: (k, v, ttl) => setex(k, v, ttl),
    get: (k)         => redisGet(k),
    del: (k)         => redisDel(k),
  }

  const cfg = googleConfig({
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:  "https://app.example.com/auth/google/callback",
    storage:      oauthStorage,
  })

  // Step 1 — user clicks "Sign in with Google" → server returns the redirect URL.
  server function googleSigninStart(sessionId) {
    return startFlow(cfg, sessionId)
  }

  // Step 2 — Google redirects back with ?code=...&state=...
  server function googleSigninCallback(sessionId, code, state) {
    const tokens = exchangeCode(cfg, sessionId, code, state)
    const profile = getUserInfo(cfg, tokens.accessToken)
    // Persist (profile.sub, profile.email) → user row; mint your own session JWT.
    return signJwt({ sub: profile.sub, email: profile.email },
                   process.env.JWT_SECRET, 3600)
  }
}

</program>
```

Notes:
- **PKCE is on by default** — public clients (no `clientSecret`) MUST use it. The module enforces this at config-validation time.
- **Storage is single-use, time-boxed.** State + verifier entries get a 10-minute TTL and are deleted by `exchangeCode` regardless of success or failure.
- **State mismatch is a typed error** — `OAuthStateMismatch` (CSRF). Catch by `name`. Same for `OAuthVerifierMissing`, `OAuthTokenError`, `OAuthUserInfoError`, `OAuthRevocationError`.
- **Refresh tokens:** call `refreshToken(cfg, savedRefreshToken)` to renew. Some providers rotate the refresh token — re-persist `tokens.refreshToken` if non-null in the response.
- **No npm `passport`, `simple-oauth2`, `next-auth`, or `googleapis`.** The four presets cover the most common cases; for an unlisted provider, build the config object inline (every preset is just an `authorizeUrl`/`tokenUrl`/`userInfoUrl`/`scopes` bag).

**Route-level auth via `<program auth=…>` and `<auth role=…>` (§52.13 / §40 — S135 cluster N catch-up, F-052).** `<program>` accepts an `auth=` attribute with four values:

- `auth="none"` — public route (default for `<program>` without auth=); no login required
- `auth="optional"` — login optional; `@currentUser` populated if signed in, `not` otherwise
- `auth="required"` — login required; unauthenticated requests get the `<errors>` fallback (or redirect via middleware)
- `auth="role:Admin"` — login required + the role check (W-ATTR-002 fires if the role is not declared by an `<auth role="Admin">` element in scope; the requirement still gates the route)

For per-role markup variance — show this UI to admins, that UI to regular users — use the `<auth role="X">` first-class element (S91, A-3 AuthGraph). The compiler builds a per-route per-role chunk closure; only the matching role's content ships to each user. Cross-ref the auth recipe above for the JWT pattern + state declarations.

### 11.3 Real-time recipe — file-level `<channel>`

Channels are **file-level** in v0.next (NOT inside `<program>`). They auto-create a WebSocket endpoint and auto-declare their variable. State declared inside a channel body syncs across every connected client. **No `@shared` modifier exists in v0.next; the synchronization comes from being declared inside a channel body.**

```scrml
<channel name="chat" topic="lobby">
  <messages> = []                              // synced across all clients

  server function postMessage(author, body) {
    @messages = [...@messages, { author, body, ts: Date.now() }]
  }
</>

<program>

${
  <username> = ""
  <draft>    = ""

  function send() {
    if (@draft.trim() == "" || @username.trim() == "") return
    postMessage(@username, @draft)
    @draft = ""
  }
}

<input type="text" bind:value=@username placeholder="Your name"/>
<ul>
  ${ for (let m of @messages) {
    lift <li><strong>${m.author}</strong>: ${m.body}</li>
  } }
</ul>
<form onsubmit=send()>
  <input type="text" bind:value=@draft placeholder="Message"/>
  <button type="submit">Send</button>
</form>

</program>
```

Notes:
- `<channel>` lives at file level, alongside `<program>`. Not inside it.
- `<messages> = []` declares a channel-scoped reactive variable. It is auto-synced to every connected client.
- Read it as `@messages` from anywhere in the file (including inside `<program>`).
- Server functions inside the channel body see `broadcast(data)` and `disconnect()` auto-injected.
- Channel attributes: `name=` (required), `topic=`, `protect=`, `reconnect=`, `onserver:open/close/message=`, `onclient:open/close/error=`.
- Do NOT invent a `room { state {} on join() }` DSL.

### 11.4 Reactive recipe — `const <name>` + `@debounced(N)` modifier

Derived reactive values use `const <name> = expr` (structural-decl form, V5-strict — same shape as plain reactive cells, just with `const` modifier). Read them at `@name`. For debouncing, `@debounced(N)` is a **declaration modifier**.

```scrml
<program>

${
  <count> = 0
  <query> = ""

  // Declaration modifier — wraps the variable in scrml's reactive-debounce primitive.
  @debounced(300) <debouncedQuery> = @query

  const items = [
    {name:"apple", price:1.20},
    {name:"banana", price:0.50},
    {name:"cherry", price:2.00},
  ]

  // Derived reactives — recompute when inputs change.
  const <filteredItems> = items.filter(it =>
    it.name.includes(@debouncedQuery.toLowerCase())
  )
  const <total> = @filteredItems.reduce((s, it) => s + it.price, 0)

  function inc() { @count = @count + 1 }
  function dec() { @count = @count - 1 }
}

<button onclick=dec()>−</button>
<span>${@count}</span>
<button onclick=inc()>+</button>

<input bind:value=@query placeholder="Search…"/>
<ul>
  ${ for (let item of @filteredItems) {
    lift <li>${item.name} — ${item.price}</li>
  } }
</ul>
<p>Total: ${@total}</p>

</program>
```

Notes:
- `<var> = ...` declares; `@var` reads.
- `const <name> = expr` derives (structural-decl + const modifier). Auto-recomputes when inputs change. Read as `@name`.
- `@debounced(N) <name> = expr` — modifier on the declaration. Read as `@name` (with the sigil) elsewhere.
- No `computed()`, no `useEffect`, no `$:`.

### 11.5 Loading state — the canonical async-lifecycle shape

Every data-fetch screen, form submission, and API call resolves to the same five-variant shape. Name it **per-screen with domain-relevant variant data** (don't import a generic `AsyncPhase<T>` — scrml does not need generics here, and naming the variants in app context produces better match blocks, error messages, and engine transition rules):

```scrml
type ContactsPhase:enum = {
    Idle                            // not asked yet
    Loading                         // request in flight
    Error(msg: ContactsError)       // domain-specific error type, not just string
    Empty                           // request succeeded, zero results
    Loaded(rows: Contact[])         // domain-specific success payload
}
```

Five variants, each with the domain naming this screen actually needs. Customer-list `Empty` says "No customers yet — add one"; search-result `Empty` says "No matches"; the variant names are the same shape, the markup beneath each is screen-specific.

**At Tier 1 you wrap with `<match for=ContactsPhase>`** — structural exhaustiveness, no transition enforcement.

**At Tier 2 you wrap with `<engine for=ContactsPhase initial=.Idle>`** with `rule="..."` attributes on the variants and `<onTransition>` blocks for cross-state effects (analytics, retry, cleanup). State-children migrate verbatim — only the wrapper changes (§11.1, §51).

**Errors are states.** A failable `fetchContacts() ! ContactsError { ... }` server function's `!{}` handler at the call site does only one thing: route each error variant into the right Phase variant. The match block / engine then patterns each variant into the right markup. No `<isError>` + `<errorMsg>` cells; the failure modes live in the type.

Why per-screen, not stdlib generic: a generic `AsyncPhase<T>` strips the domain — `Loaded(T)` is less informative than `Cached(rows: Contact[])` or `Refreshed(at: timestamp, rows: Contact[])`. The five-variant boilerplate is five lines of useful domain spec, not friction.

If a v1 codebase uses `RemoteData<T>` or similar imported generic shape, port it screen-by-screen to a per-screen `<Name>Phase` enum.

### 11.6 Schema recipe — `< schema>` declarative DDL

Declare what the database SHOULD look like. The compiler diffs against the live DB and generates migration SQL. **You never write `ALTER TABLE` by hand.**

```scrml
<program db="./notes.db">

< schema>
    users {
        id:           integer primary key
        email:        text not null unique
        display_name: text not null
        created_at:   timestamp default(CURRENT_TIMESTAMP)
    }
    notes {
        id:        integer primary key
        user_id:   integer not null references users(id)
        title:     text not null
        body:      text not null
        published: boolean default(0)
    }
</>

< db src="./notes.db" tables="users, notes">
  <!-- ?{} queries here -->
</>

</program>
```

Notes:
- `< schema>` requires `<program db="...">` — the database path comes from the `<program>` attribute.
- Column types: `text`, `integer`, `real`, `blob`, `boolean`, `timestamp`. Constraints: `primary key`, `not null`, `unique`, `default(literal)`, `references table(col)`.
- **Backend:** scrml's database layer is **Bun.SQL-backed** (Bun ≥1.3). The `db=` URI selects the driver: `:memory:` / `./path.db` / `sqlite:...` → SQLite; `postgres://...` / `postgresql://...` → PostgreSQL. MySQL (`mysql://...`) is queued for a later phase. Same scrml schema + `?{}` queries run against any supported backend without source changes.
- `< schema>` and `< db src=>` are sibling blocks that both reference the same DB path.

### 11.7 Multi-page routing

Route params arrive via the compiler-provided `route` object: `route.params.id`, `route.query.tab`, `route.path`. All values are typed `string` — parse manually for numeric IDs.

```scrml
${
  let userId = route.params.id
  let activeTab = route.query.tab || "profile"

  function go(target: string) {
    navigate(`/users/${target}`)               // Soft (history push) by default
    // navigate(path, .Hard) for 302 server redirect
  }
}
```

For multi-file apps, `import`/`export` works for **types, helper functions, AND components** across `.scrml` files. A file with only `${ export ... }` blocks (no markup, no CSS) is auto-detected as a **pure-type file** and emits no HTML/CSS — only a JS module.

**Two export forms for components (§21.2 — S135 cluster M catch-up, F-034):**

```scrml
// Form 1 — structural component definition (the component-as-state-tree form)
export <UserCard props={ user: User }>
  <div class="card">
    <h2>${@user.name}</h2>
    <p>${@user.email}</p>
  </>
</>

// Form 2 — expression-position component (the const-binding form)
export const <userCard> = <article props={ user: User }>
  <h2>${@user.name}</h2>
  <p>${@user.email}</p>
</article>
```

Both forms compile to the same module export. **Form 1** reads as "this file IS this component" and is the canonical shape for top-level component-per-file organization. **Form 2** is for component-as-value (passed to other components, stored in a registry, dispatched by computation). The import side is the same: `import { UserCard } from './user-card.scrml'`.

**Pure-type files** (auto-detected): if a `.scrml` file contains only `${ ... export type / export const fn / export function ... }` blocks and no markup or `#{}` CSS, the compiler emits ONLY a JS module — no HTML, no CSS, no SSR scaffold. Useful for shared type definitions (`type User:struct = {...}`), helper functions, and constants. The detection is automatic; no manifest entry needed.

### 11.8 Middleware — `<program>` attrs + `handle()`

Most apps need ZERO middleware code. The common 80% is single attributes on `<program>`:

```scrml
<program log="structured" headers="strict" cors="*" csrf="on" ratelimit="100/min">
  <!-- routes -->
</program>
```

For the remaining 20%, `server function handle(request, resolve)` is the onion-model escape hatch. Code before `resolve()` is pre-middleware; code after is post. `resolve()` MUST be called exactly once per execution path that runs the route.

```scrml
<program log="structured" headers="strict">

${ server function handle(request, resolve) {
    const reqId = crypto.randomUUID()
    const start = Date.now()

    const response = resolve(request)

    response.headers.set("X-Request-Id", reqId)
    response.headers.set("X-Response-Time-ms", String(Date.now() - start))
    return response
} }

</program>
```

### 11.9 Linear types — `lin` for one-shot tokens

When a value must be consumed exactly once on every execution path (auth tokens, transaction handles, payment intents, idempotency keys), declare it `lin`. The compiler refuses to let it be silently dropped or used twice. Compile-time guarantee, no runtime check.

```scrml
server function redeem(lin ticket: string, username: string) {
  const consumed = ticket           // single read counts as consumption
  return `Redeemed ${consumed} for ${username}`
}

function login() {
  lin ticket = mintTicket(@username, @password)
  const message = redeem(ticket, @username)   // single consumption
  @result = message
  // Referencing `ticket` again here would be E-LIN-002.
}
```

---

### 11.10 Iteration recipe — `<each>` over a list (Tier 1)

When you need to render a list, reach for the **Tier-1 `<each>` structural element** — NOT `.map()`, NOT `${ for (...) { lift ... } }`. `<each>` reads as a markup tree, composes with `<empty>` for the zero-items case, and gets keyed DOM reconciliation for free. (The `${for/lift}` form is the valid Tier-0 fallback — see the anti-pattern table and the promotion note below.)

```scrml
<program>

type Contact:struct = { id: string, name: string, email: string }

<contacts>: Contact[] = []

server function loadContacts() {
  lift ?{`SELECT id, name, email FROM contacts ORDER BY name`}.all()
}

server function deleteContact(id) {
  ?{`DELETE FROM contacts WHERE id = ${id}`}.run()
}

<ul class="list-none p-0">
  <each in=@contacts key=@.id>
    <li>
      <span>${@.name}</span>
      <span class="text-slate-600">${@.email}</span>
    </li>
    <empty>
      <li class="text-slate-500">No contacts yet.</li>
    </empty>
  </each>
</ul>

</program>
```

The single-expression rows can drop to `:`-shorthand, and the count form uses `of=`:

```scrml
<each in=@tags key=@.id>
  <li : @.name>                <!-- :-shorthand body; @. is the current item -->
  <empty : "No tags.">         <!-- <empty> also takes :-shorthand -->
</each>

<each of=10>                   <!-- count form: iterate 10 times -->
  <li : "Slot " + @.>          <!-- in of= form, @. is the index 0..N-1 -->
</each>
```

Notes:

- **`@.` is "the current iteration value."** In `<each in=@coll>` it is the current item (`@.name`, `@.email`); in `<each of=N>` it is the current index. It is a SIGIL (an extension of the `@` state-access sigil), not a reserved variable name. `@.` outside an `<each>` body is reserved for `E-SYNTAX-064` (queued; not yet emitted).
- **`as name` is optional sugar.** `<each in=@conflicts as conflict>` lets you write `${conflict.summary}`; `conflict` and `@.` are aliases. Use `as` to keep an OUTER item addressable inside a NESTED `<each>` (the inner `@.` always means the innermost item). The `as`-bound name takes NO `@` sigil — it is a local binding, not state.
- **`<empty>` is the empty-state branch** — rendered when the collection is empty (or the count is `0`). One per `<each>`. Its body is plain markup; `@.` is NOT in scope there (there is no current item). It can reference OUTER `@cell`s (e.g. `${@searchQuery}`).
- **`key=` keys the reconciliation.** Pass `key=@.id` (or any unique field, e.g. `key=@.email`). The compiler emits the `W-EACH-KEY-001` info-lint when no key is given and it can't infer one from the item's `.id` field — it names three fixes (provide `key=@.field`, or suppress with `key=__index__` for an order-stable list). Today the lint is conservative and fires even when the struct HAS an `id` field, so write `key=@.id` explicitly to keep it quiet. `<each of=N>` defaults to `key=@.` and never lints. The lint is informational; the list still renders correctly (positional fallback).
- **Keep per-item element attributes simple.** Codegen handles `:`-shorthand and bare `${...}` bodies well; interpolation-bearing per-item ATTRIBUTES are best-effort in the current Landing — push dynamic values into the body expression rather than a complex attribute when you can.
- **There is no `<for>` tag.** Iteration is `<each>` (Tier 1) or `${ for (...) { lift ... } }` (Tier 0). Branching is the `if=` attribute or `${ if (...) { lift ... } }` — there is no `<if>` tag either.
- **Promotion.** If you already have a Tier-0 `${ for (let c of @contacts) { lift <li>${c.name}</li> } }` site, the compiler surfaces `W-EACH-PROMOTABLE` naming the `<each in=@contacts as c>...</each>` target. `bun scrml promote --each <file>[:line]` is the mechanical lift (SPEC §56.10) — but it is **Landing 3 PENDING**, so do the lift by hand for now. Both tiers compile cleanly; promotion is additive, never required.

---

### 11.11 Producing markup from logic — the one-shot-lift idioms

**The rule:** *`lift` lives only in anonymous `${}` blocks. A function that produces markup `return`s it — it never `lift`s. To name a reusable markup value, use `const <x> = <markup>` (reactive) or a `snippet` prop (parameterized). To branch inline, use a ternary or `if=`.*

Your strongest reflex here is wrong: *"declare a one-shot named function inside `${}` and `lift` markup out of it."* **It does not compile** — `${ function name(p){ … lift <markup/> } }` is rejected with `E-SYNTAX-002` (`lift` is illegal inside a bare `function` body). A `function` `return`s markup; it never `lift`s. (A `fn` body — distinct from a bare `function` — does permit `lift` to its local `~`, returned via `return ~`; but the five idioms below usually mean you don't need even that.)

"One-shot parameterized logic that emits markup" decomposes into five cases — match yours and use the existing form:

| Your case | Use this | Section |
|---|---|---|
| Render a list / collection | `<each in=@items key=@.id>…<empty>…</empty></each>` (Tier 1); `${ for (x of @items) { lift <…/> } }` also compiles (Tier 0) | §11.10 |
| Branch inline, single use | ternary markup-as-value: `${ @cond ? <a/> : <b/> }` | §6 |
| Show / hide one element | `if=` attribute: `<span if=@cond>…</span>` | §7 table |
| Name / reuse / make-reactive a branch | markup-typed derived: `const <badge> = @cond ? <a/> : <b/>` then `${@badge}` | §3.1 |
| Build text from an expression | derived cell: `const <fmt> = "$" + @price.toFixed(2)` then `${@fmt}` (or inline `${expr}`) | §3.1 |
| One-shot helper that feeds markup | `fn name(args) -> T { return … }` then `${ name(args) }` | §4.6, §12 |
| Parameterized fragment reused 2–3× | `snippet`-typed prop + `render` + `{ (p) => <markup> }` lambda at the call site | §12 |

A compiled example of the helper form (case 4) and the parameterized-fragment form (case 5):

```scrml
${
    fn senderLabel(role, email) -> string {
        return role == "driver" ? "Driver" : email
    }
    lift <span>${senderLabel(@role, @email)}</span>
}
```

```scrml
const Field = <div props={
    label: string,
    control: snippet(name: string)
}>
    <label>${label}</label>
    ${render control(label)}
</div>

<Field label="Name" control={ (n) => <strong>${n}</strong> } />
```

There is no `$(param){}` shorthand and you do not need one — the consensus across Svelte / Solid / React / Vue (ternary-for-simple, derived-for-computed, helper-fn-for-logic, snippet-for-parameterized) is exactly this family.

### 11.12 Self-host idiom cluster — `lift` + `~` + `while` + assignment-as-expression (§10 + §32 + §49 + §50)

These four features compose into the canonical scrml pipeline pattern — the one that powers the self-host compiler's own parser, formatter, and codegen. Adopters who write regex iteration, accumulator pipelines, or state-machine loops use this cluster directly.

**`lift` — markup is a value (§10).** `lift` accumulates markup into the implicit `~` accumulator of the enclosing logic context. The accumulated markup becomes a sibling child of the surrounding markup tree at lift-completion. `lift` is NOT JSX `.map()` — it doesn't return an array; it ACCUMULATES into context-bound state.

```scrml
<ul>
  ${
    for (let item of @items) {
      lift <li>${item.name}</li>      // each iteration appends a <li> to the surrounding <ul>
    }
  }
</ul>
```

**The `~` accumulator (§32).** Bound implicitly inside logic contexts that accumulate markup-or-data. The pipeline pattern: `lift expr` writes to `~`; subsequent expressions can `consume ~` to read+drain. `~name = expr` is the EXPLICIT-named accumulator form (use sparingly — it usually means you wanted `const <name> = expr` for derived reactive state, NOT a pipeline accumulator).

```scrml
${
  function tokenize(input) {
    while ((m = TOKEN_RE.exec(input)) is some) {     // §49 while + §50 assign-as-expr + §42 is some
      lift { kind: m[1], value: m[2] }              // §10 lift into ~ — accumulates tokens
    }
    return ~                                        // §32 consume the accumulator
  }
}
```

That single function uses ALL FOUR features. This is the self-host parser's primary idiom — one canonical shape for "iterate-and-collect" pipelines.

**`while` loops + `break` / `continue` + labels (§49).** The canonical regex-iteration form is `while ((m = re.exec(str)) is some) { ... }`. Adopters who default to `for (item of items)` and never reach for `while` miss the regex/state-machine surface entirely.

```scrml
${
  function findFirstMatch(input, patterns) {
    outer: while (true) {
      for (let p of patterns) {
        const m = p.exec(input)
        if (m is some) {
          if (m[0].length < 3) continue outer    // labeled continue restarts the outer while
          return m
        }
      }
      break                                        // exit when no pattern matched
    }
    return not
  }
}
```

`break` / `continue` accept optional labels (`outer:` / `inner:`). The `E-LOOP-*` family of error codes (§49.x) guards illegal label targets, bare `break` outside loops, etc.

**Assignment-as-expression (§50).** `(x = expr)` is a value-producing expression. Required for the canonical `while ((m = re.exec(str)) is some)` pattern — the assignment must produce the new value for the loop guard to check. Use **double parens** to disambiguate from declaration syntax (`while ((x = expr))` works; `while (x = expr)` may fire `W-ASSIGN-001` advisory).

```scrml
let line = ""
while ((line = readLine()) is some) {              // double-paren assignment-as-expr
  if (line.startsWith("#")) continue
  lift parseRow(line)
}
return ~
```

**Why these four together?** They're the self-host compiler's core pipeline vocabulary. scrml's own parser uses `while` + assignment-as-expr to consume tokens; its codegen uses `lift` + `~` to accumulate JS source. Adopters writing similar pipelines (CSV/JSON parsers, custom tokenizers, transform-pipelines) should reach for this cluster rather than JS-style `let result = []; for(...) result.push(x); return result`.

**Anti-pattern.** `~name = expr` for derived reactive state is the canonical mis-reach (§13 traps). If you want a reactive cell whose value derives from other cells, write `const <name> = expr` — `~` is for in-block accumulation pipelines, not reactive state.

See SPEC §10 for `lift`; §32 for `~` accumulator; §49 for `while`/`break`/`continue`/labels; §50 for assignment-as-expression.

### 11.13 Compute-isolation recipe — workers, sidecars, SSE (§43 + §46 + §37)

Three first-class scrml primitives for compute that needs isolation from the main thread:

- **Worker** — nested `<program>` for CPU-intensive work (image processing, parsing large blobs). Restart-never default.
- **Sidecar** — nested `<program type="sidecar">` for long-running auxiliary processes (background queues, watcher daemons). Restart-on-error default.
- **SSE (Server-Sent Events)** — `server function*` for one-way server-push streams (live counters, progress bars, real-time feeds). HTTP-based; simpler than `<channel>` for one-way data.

#### Workers — nested `<program>` for CPU isolation (§43 + §46)

```scrml
<program>
  <imageProcessor>
    <#name="processor">
    <program restart="never">
      // This inner <program> runs in a Worker — full scrml semantics, isolated from main.
      ${
        server function compressImage(blob: Blob, quality: int) {
          // ... heavy compression work ...
          return processedBlob
        }
      }
    </program>
  </imageProcessor>

  // Call into the worker via RPC:
  ${
    function uploadAndCompress(file) {
      const compressed = <#processor>.compressImage(file, 80)   // §43.5 RPC syntax
      uploadFile(compressed)
    }
  }
</program>
```

**Key shape:** the inner `<program>` is a complete scrml subprogram — own engines, own state, own server fns. Shared-nothing isolation; no state crosses the boundary (use RPC). The outer references the inner via `<#name>.method()` syntax.

**Supervision (§46) — `restart=` + lifecycle hooks.** Workers default to `restart="never"`. Use `restart="on-error"` for sidecars + `restart="always"` for daemon-style processes. Configure max-restart-per-window via `max-restarts="3" within="1m"`.

```scrml
<imageProcessor restart="never" autostart="false">
<sidecar restart="on-error" max-restarts="3" within="5m">
```

**Lifecycle events — `when ... from <#name>`** (§46). Listen for worker-lifecycle changes from outside the worker:

```scrml
${
  when started from <#processor> {
    @workerReady = true
  }
  when crashed(err) from <#processor> {
    fail WorkerError::Crashed(err)
  }
}
```

#### Sidecars — nested `<program type="sidecar">` for auxiliary processes

```scrml
<background>
  <#name="indexer">
  <program type="sidecar" restart="on-error" autostart="true">
    ${
      server function indexNewDocs() {
        // ... runs periodically; restarted-on-error per supervisor config ...
      }
    }
  </program>
</background>
```

Sidecars are workers with different supervision defaults (restart-on-error vs restart-never) + the `type="sidecar"` attribute makes the intent explicit. Same RPC + lifecycle-event surface as workers.

#### SSE — `server function*` for one-way server push (§37)

When you need the SERVER to push updates to the CLIENT without bidirectional channel overhead (live counters, progress bars, log streams), use a `server function*` generator. The compiler emits a `text/event-stream` GET route + an `EventSource`-based client stub.

```scrml
<program>
  ${
    server function* liveCount() {
      let n = 0
      while (true) {
        yield { count: n }
        n = n + 1
        sleep(1000)
      }
    }
  }

  <p>Live counter: ${liveCount().count}</p>     // client auto-subscribes
</program>
```

**SSE vs `<channel>` choice point:**

| Need | Use |
|---|---|
| One-way server → client push | **SSE** (`server function*`) — lighter, HTTP-native, auto-reconnect |
| Two-way / multi-client broadcast | **`<channel>`** (file-level WebSocket) — see §11.3 |
| File-level state shared across all clients | **`<channel>`** — channels own the shared-state |
| Per-client computed stream | **SSE** — each client gets its own generator instance |

**Limits.** SSE composes three primitives (`server`, `function*`, `yield`) — see SPEC §37 + §13 for the generator policy. `function*` (without `server`) for client-side iterators is a separate surface; server-side generator semantics are tighter (no infinite memory growth; the runtime backpressure-paces yield).

See SPEC §43 for nested `<program>`; §46 for worker lifecycle + supervision; §37 for SSE `server function*`; §13 for generator policy.

---

## 12. Components — the multi-instance vehicle

Components are markup-defined, capitalized, multi-instance. They take props; they do not own engine-style state.

```scrml
${
  const UserCard = <article class="user-card" props={
    name:  string,
    email: string,
    role:  UserRole
  }>
    <h3>${name}</h3>
    <p>${email}</p>
    <span class="badge">${role}</span>
  </>
}

<ul>
  ${ for (let m of team) {
    lift <UserCard name=m.name email=m.email role=m.role/>
  } }
</ul>
```

- **Capitalized name** distinguishes components from HTML elements.
- **`props={...}`** declares prop names + types. There is no `prop:Type` annotation form on the root element.
- **Component close tag is `</>`**, not `</UserCard>`. The compiler matches by structure.
- Cross-file: `import { UserCard } from './components.scrml'` and use as above. The CLI auto-gathers the import closure on compile.

**When you want many of them, use a component. When you want exactly one (UI-as-state-machine), use an engine.**

---

## 13. Known traps

- **`<var>` to declare; `@var` to read/write.** This is the V5-strict rule. v1 used `@var = 0` to declare; v2 does NOT. Write `<var> = 0`.
- **Bare names in expressions are LOCALS.** `count` (without `<>` or `@`) is a local identifier, never reactive state. Shadowing a registered state name is `E-NAME-COLLIDES-STATE`.
- **`@` is not a JS-framework concession.** It is the canonical, semantically-required reactive-cell-touch marker. (v1 framed it as a sugar concession; v2 does not.)
- **Engines render at their declaration position** (same-file). Use `<EngineName/>` only for cross-file mounts.
- **`<///>` does not exist.** Only `</>`. Multi-close convenience moved to the editor (6nz).
- **`.tryAdvance(.X)` does not exist.** Silent no-op transitions are forbidden. Use direct write or `.advance(.X)` for loud failure; use `if` for conditional gates.
- **`<chrome>` / `<*>` template constructs do not exist** inside engines. Use snippets for shared markup.
- **`<onEnter>` / `<onLeave>` do not exist.** Use `<onTransition from=X>` (entering) or `<onTransition to=Y>` (leaving).
- **`?{}.prepare()` does not exist.** Emits `E-SQL-006`. Use template-string SQL directly.
- **`protect=` is COMMA-separated**, not space-separated.
- **`onclick=fn()`** is a bare call — the parens are included.
- **Markup interpolation requires `$`**: `${@var}`, NOT `{@var}`.
- **Component close tag is `</>`**, not `</ComponentName>`.
- **`<program>` is required** for runnable apps.
- **Channels are file-level** (NOT inside `<program>`). Their state is auto-synced (no `@shared` modifier).
- **`scrml migrate v0next` does not exist.** v0.next IS scrml.
- **Validation is declarative, not imperative.** Don't write `validate()` functions. Declare validators as bare attributes on the cell decl: `<email req length(>=2) pattern(...)>`.
- **`@signup.isValid`, `@signup.errors`, `@signup.touched` are auto-synthesized read-only properties** on compounds with validators. Don't assign them; the compiler computes them reactively.
- **`@signup.errors.name` contains enum tags** (`.Required`, `.TooShort(2)`, etc.) — NOT strings. Render via `<errors of=@signup.name/>` or `messageFor(...)` from `scrml:data`.
- **`<errors of=expr/>` is the error-rendering element.** First-class. Per-field (`<errors of=@signup.name/>`) or compound rollup (`<errors of=@signup all/>`).
- **`reset(@cell)` is a language keyword** — no import. Mutates in place. Re-evaluates init expression unless an explicit `default=` attribute is declared on the cell.
- **`reset` is a reserved identifier** — you cannot define `function reset() {...}` (it would collide with the keyword). Pick another name for local helpers.
- **Multi-statement event handlers are illegal inline.** Use a named function for any handler with more than one statement.
- **Derived engines reject `rule=`, `initial=`, and direct writes.** A `derived=expr` engine is fully driven by its source.
- **Cross-field validation is not a special vocabulary.** Use any universal-core predicate with a cross-cell expression arg: `<confirm req eq(@signup.password)>`.
- **Compound state field access uses `@compound.field`** (canonical), not `<compound><field/></>` (structural). Same V5-strict asymmetry as Tier 1, one level deeper.
- **`const <derived>` is the in-compound derived form.** `<displayName/>` in markup requires a render-spec; cells without one only display via `${@x}` interpolation.
- **`#{}` is scoped CSS** (§9). At a structural position (inside `<program>` / `<page>` / a structural element body) the styles scope to that element's subtree. File-top `#{}` is NOT a canonical idiom in scrml examples (S86 styling rule); when authoring examples, prefer the structurally-scoped form.
- **`if`-as-expression is idiomatic** (§17.6). For value-returning conditionals, `let x = if (cond) a else b` works and reads cleaner than the ternary `cond ? a : b` form. Both compile; the if-as-expr form is the in-house preference for state-machine-shaped conditionals.
- **`navigate(path, .Hard)` is the 302 server-redirect mode** (§20). Default mode `.Soft` is client-side route swap; `.Hard` forces a server redirect (useful post-login, post-logout, etc.).
- **Tailwind utility classes work** (§26), including variant prefixes (`hover:`, `md:`, `dark:`) and arbitrary values (`grid-cols-[1fr_2fr]`, `bg-[#1a1a1a]`). Unrecognized classes fire `W-TAILWIND-UNRECOGNIZED-CLASS` lint — typos surface at compile time, not silent.
- **`I-MATCH-PROMOTABLE` info-lint nudges Tier-0 lift** (§56). When you write `if (@phase == .X) … else if (@phase == .Y) …` chains, the lint suggests a `<match for=Phase on=@phase>` block. The `bun scrml promote --match <file>[:line]` CLI does the mechanical rewrite for you — state-children body content carries forward verbatim; the wrapper swap is the commitment moment.
- **`pure fn` is REDUNDANT** (§33.6, S32 ratification — `fn` ≡ `pure function`). Either form works, but writing `pure fn` or `pure function` when `fn` alone suffices fires `W-PURE-REDUNDANT`. Use plain `fn` for pure compute; reach for the explicit `pure function` form only when emphasizing purity at the declaration site is editorially worth the extra keyword.

---

## 14. Things that are NOT scrml, even though they look adjacent

- **JSX:** scrml is not JSX. Markup uses real HTML elements + `${expr}` interpolation + `if=` attribute + `${ for ... lift }` iteration.
- **Svelte SFCs:** scrml is not Svelte. No `<script>`/`<template>`/`<style>` triplet — `<program>` contains `${...}` for logic, raw markup for view, and `#{...}` for scoped CSS.
- **Astro:** scrml is not Astro. No `---` frontmatter fences. No island architecture.
- **Vue Composition API:** scrml is not Vue. No `setup()`, no `ref()`, no `reactive()`.
- **TypeScript:** scrml's type system is independent. No `interface`, no `type X = …` (use `type Name:struct = {…}` or `type Name:enum = {…}`). No `await`.
- **Standard ML / OCaml / ML-family:** scrml is not an ML.
- **XState:** scrml engines superficially resemble XState's state-machine config but use real markup, real types, and live in the same source file as the UI they own.

---

## 15. When in doubt

If the user asks you for something the patterns in this kickstarter don't cover (unusual routing, complex state machines beyond a single engine, uncommon DB operations, build-time meta-programming), tell them you're going to ask the scrml compiler / docs and DO NOT invent. The compiler's spec is authoritative. Don't pretend to know what you don't.

If you find yourself writing `import { defineConfig } from 'scrml/config'`, stop. That doesn't exist.

If you find yourself writing `signal()` or `ref()` or `useState()`, stop. Use `<var> = init` and `@var`.

If you find yourself writing `@var = init` to declare, stop. Declaration is `<var> = init`.

If you find yourself writing `{#if}` or `{#each}` or `<if test=>` or `<for each= in=>`, stop.

If you find yourself writing `await` in front of a server-fn call, stop.

If you find yourself writing `~name = expr` for derived reactive, stop. Use `const <name> = expr` (read at `@name`).

If you find yourself writing `import Database from 'better-sqlite3'`, stop. Use `< db src="...">`.

If you find yourself writing chains of `if (@phase === 'loading') ... else if (@phase === 'loaded') ...`, stop. **Reach for an engine.** That is the v0.next idiom.

If you find yourself writing `<MarioMachine/>` for a same-file engine, stop. The engine renders at its declaration position.

If you find yourself writing `.tryAdvance(.X)`, stop. There is no silent-fail variant.

If you find yourself writing `function validate() { if (...) ... }`, stop. Declare the validators on the cell decl: `<name req length(>=2)>`. Read errors at `@signup.name.errors`; render with `<errors of=@signup.name/>`.

If you find yourself writing `function reset()`, stop. `reset` is a language keyword. Pick another name for the local helper, or use `reset(@cell)` directly as the handler.

If you find yourself writing `onclick=fn(); @x = .Y` (multi-statement inline), stop. Name the function.

If you find yourself writing `<MyEngine/>` for a same-file engine, stop. The engine renders at its declaration position.

If you find yourself writing `derived=@source` and expecting variant-name matching, stop. `derived=` accepts a reactive expression of the engine's type — typically a `match` block.

---

## 16. Final reminder

This document is the canonical context for **v0.next scrml** (post-S52-S56 deliberation, locks L1-L20). If something here contradicts your training data, web search results, or **kickstarter v1**, **trust this document.** scrml is post-training-cutoff for every model, and v0.next is post-training-cutoff for v1 itself.

**Two load-bearing rules to internalize:**

1. **`<var>` declares; `@var` reads/writes.** Bare names are LOCALS only. Compound state declared structurally; field access is canonical (`@formRes.name`).
2. **Markup is a first-class value type.** Markup elements sit anywhere expressions sit — passed as args, stored in cells, returned from functions, on the RHS of `=`. The decl-coupled-with-render-spec form (`<name req> = <input/>`), markup-typed derived cells (`const <badge> = <span>...</>`), and snippets that take markup as parameters all follow from this one rule.

**Plus the north star:** UI as a fully-handled state machine — engines (singleton) for state-driven UI, components (multi-instance) for reusable markup. Booleans-as-lifecycle in early code are in-progress pins, not violations; the `W-LIFECYCLE-CANDIDATE` lint nudges promotion when the boolean count grows.

**Plus the easy-street ladder:** Tier 0 (`if=` chains) → Tier 1 (`<match for=Type>`) → Tier 2 (`<engine for=Type initial=...>`). Promotion is mechanical and additive — state-children carry forward verbatim; the wrapper swap is the commitment moment.

If you internalize those, every other rule in this document follows. You are now primed. Write scrml.
