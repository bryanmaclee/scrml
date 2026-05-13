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

  <div class="contact-book">
    <h1>Contact Book</h1>

    <form onsubmit=addContact()>
      <input type="text"  bind:value=@name  placeholder="Name"  required/>
      <input type="email" bind:value=@email placeholder="Email" required/>
      <input type="tel"   bind:value=@phone placeholder="Phone"/>
      <button type="submit">Add Contact</button>
    </form>

    <ul class="contacts">
      ${
        for (let contact of loadContacts()) {
          lift <li class="contact-row">
            <span class="name">${contact.name}</span>
            <span class="email">${contact.email}</span>
            <span class="phone">${contact.phone}</span>
            <button onclick=deleteContact(contact.id)>Remove</button>
          </li>
        }
      }
    </ul>
  </div>

</>

#{
  .contact-book { max-width: 640px; margin: 2rem auto; font-family: sans-serif; }
  form { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
  input { flex: 1; padding: 0.5rem; }
  .contacts { list-style: none; padding: 0; }
  .contact-row { display: flex; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid #eee; }
}

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
<startTime default=null> = Date.now()       // init = current timestamp; reset → null
<retries   default=0>    = nextRetryCount() // init has side effect; reset uses 0, no re-fire
```

Without `default=`, `reset()` re-evaluates the init expression at reset time.

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
- Initial value computed from source at engine-init time. Compile-error if the derived expression is undefined for the source's `initial=` state.
- Chained derivation legal (`A → B → C`). Cycles caught at compile time.
- For plain (non-engine) derived state, use `const <derived> = expr` from §3.1 — `derived=` is engine-only.

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
| `req` | Non-empty value (string `""` fails; null/undefined fail) | `<name req>` |
| `is some` | Value exists at all (null/undefined fail). Coexists with `req` because `""` IS some. | `<x is some>` |
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

`reset()` is a language keyword (no import needed). Mutates in place; returns nothing.

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
| `{#each items as item}…{/each}` | Svelte | `${ for (let item of items) { lift <li>...</li> } }` |
| `<for each= in=>` or `<if test=>` markup tags | (invented) | **There are no `<for>` or `<if>` markup tags.** Iteration and branching use `${ ... lift ... }` and `if=` attributes. |
| `items.map(item => …)` in JSX | React | `${ for (let item of items) { lift <…> } }` |
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

**If you don't see your case in the table, default to the canonical shape from §2.** Do not invent syntax.

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

    type LoginError:enum = { UnknownUser, InvalidPassword }

    server function signup(email, password) {
      const hash = hashPassword(password)
      ?{`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash})`}.run()
      return signJwt({ email }, process.env.JWT_SECRET, 3600)
    }

    server function login(email, password)! -> LoginError {
      const user = ?{`SELECT password_hash FROM users WHERE email = ${email}`}.get()
      if (user is not) fail LoginError::UnknownUser
      if (not verifyPassword(password, user.password_hash)) fail LoginError::InvalidPassword
      return signJwt({ email }, process.env.JWT_SECRET, 3600)
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
- `login()` is a **failable function** (the `!` after the parameter list, `-> LoginError` declares the failure type). `fail LoginError::Variant` is the canonical error signal — never `return null`, never `throw new Error`, never `try/catch`. Callers handle the failure via the `!{}` arm: `const token = login(email, pw) !{ | ::UnknownUser -> ... | ::InvalidPassword -> ... }`. See the error-model section for the full pattern.

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
