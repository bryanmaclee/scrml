---
title: The compiler that grows up with your app
published: false
description: scrml has three tiers of case analysis — if= chains, <match> blocks, and <engine>. Same state-children at every tier. The compiler tells you when to promote. You ship a prototype that becomes provable as it matures, without rewriting any of it.
tags: webdev, javascript, programming, compiler
cover_image:
canonical_url:
---

> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. Its scrml is an older dialect that the language has since replaced, and its code is not compile-gated, so code copied from here will not compile as today's scrml. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

*by Bryan MacLee*

**TL;DR: The goal is a shipped app that is essentially bullet-proof — every reachable state has UI, every transition is intentional, every effect runs at the right moment. Getting there should not require rewriting the prototype. scrml has a three-tier ladder — `if=` → `<match>` → `<engine>` — where the state-children migrate verbatim. The compiler tells you when to promote. The wrapper swap is the commitment moment.**

> **Status (as of May 2026):** Tier 0 (lifecycle booleans + `if=` chains), Tier 1 block-form `<match for=Type>`, and Tier 2 (`<engine>` with target-only `rule=.Variant` forms) all track the current spec and the code blocks below compile against the current compiler.
>
> **Correction, May 2026:** an earlier version of this banner stated that the Tier 1 block-form `<match for=Type>` parser was not yet shipped. Block-form `<match>` has since landed end-to-end; the promotion path described here is the wrapper swap as written.

This piece and its companion arrived together. This one shows the ladder. The companion piece, *Why scrml has to deprecate function and component overloading*, explains two features the language is deleting in v0.2.0 because the ladder you are about to read already does their job better.

Every framework I have looked at picks a side in the same fight. The state-machine evangelists insist you specify your machine before you write a feature. The rapid-prototyping evangelists hand you `useState` and let you stack booleans until you have a runtime invariant problem you cannot debug. Both camps are right about something and wrong about something else.

I have hobbled through React when I had to. I have written enough boolean-lifecycle code in my own experiments to recognize exactly the bug class state machines are supposed to prevent. The state-machine-first response to that bug class is fine in theory, but the prototype is the place where you find out what the states actually are. Asking the developer to name the machine before the feature exists is asking them to commit before they know.

scrml takes the position that this is a tooling failure, not a developer failure. If a language wants you to ship a state machine, it should let you start with booleans and a few `if`s, then make promotion mechanical when the boolean count earns it.

This is the fourth of six features the browser-language overview promised to unpack. State machines, but the gentle kind.

## Tier 0 — the boolean lifecycle

Here is a screen anyone has written. A button that loads data, a spinner while it loads, an error message if it fails, a result when it succeeds.

```scrml
<program title="Counter"
         description="A counter app demonstrating Tier 0 → Tier 1 → Tier 2 promotion."
         version="0.1.0"
         license="MIT">

${
    type LoadError:enum = {
        Network(msg: string)
        Empty
    }

    <isLoading> = false
    <isError>   = false
    <errorMsg>  = ""
    <data>      = not

    server function fetchItems()! -> LoadError {
        const result = ?{`SELECT * FROM items`}.all()
        if (result.length == 0) fail LoadError::Empty
        return result
    }

    function load() {
        @isLoading = true
        @isError = false
        const rows = fetchItems() !{
            | ::Network msg -> {
                @isError = true
                @errorMsg = msg
                @isLoading = false
                return
            }
            | ::Empty -> {
                @isError = true
                @errorMsg = "no rows"
                @isLoading = false
                return
            }
        }
        @data = rows
        @isLoading = false
    }
}

<button if=(@isLoading == false && @isError == false) onclick=load()>Load</button>

<div if=@isLoading>Loading...</div>
<div if=@isError>${@errorMsg}</div>
<div if=(@data is some)>Got it: ${@data.length} rows</div>

</program>
```

scrml's `<program>` element is the file's inline config. Middleware (cors, csrf, log, ratelimit, headers, auth, db) declared as attributes. The application's HTML head metadata (title, description, version, author, license) declared as attributes. Execution-context boundary for nested programs (workers via `<program name=...>`). The documentary attributes compile straight to standard HTML head tags; the rest are compile-time directives. Same wrapper, multiple roles.

This compiles. This runs. This is also where most apps stop.

Now a feature lands. The button should be disabled while loading instead of disappearing. Then a third path: an empty-result message when the load returns zero rows. Then somebody decides the error should auto-retry once. Each addition is a one-line change to a different boolean. Every change to the rules is a re-audit of every `if=` on the page.

Eventually you have four reactive booleans gating the same UI region. Nothing is provably wrong yet. But you cannot answer "is there a state where the spinner shows AND the result shows?" without re-reading the whole file. The provability has been ground out by addition.

## The first nudge

The scrml compiler watches for this and emits a lint:

```
W-LIFECYCLE-CANDIDATE: 4 reactive booleans gating the same UI tree.
Consider promoting to <match for=Type> for structural exhaustiveness.
  See SPEC §17 (Tier 0/1/2 ladder).
```

This is a warning, not an error. The compiler does not refuse to build your prototype. It tells you the shape of the smell and points at the next tier of the ladder. You can ignore it. You can also `pinned` the offending decls to silence the lint if you have a real reason. But once it fires, you know what the language thinks.

## Tier 1 — `<match>` block

The promotion looks like this. You name the type, write each variant once, give each variant the markup it owns.

```scrml
<program>

${
    type LoadError:enum = {
        Network(msg: string)
        Empty
    }

    type Phase:enum = {
        Idle
        Loading
        Error(msg: string)
        Empty
        Success(count: int)
    }
    <phase>: Phase = .Idle

    server function fetchItems()! -> LoadError {
        const result = ?{`SELECT * FROM items`}.all()
        if (result.length == 0) fail LoadError::Empty
        return result
    }

    function load() {
        @phase = .Loading
        const rows = fetchItems() !{
            | ::Network msg -> { @phase = .Error(msg); return }
            | ::Empty       -> { @phase = .Empty;     return }
        }
        @phase = .Success(rows.length)
    }
}

<match for=Phase>
    <Idle>
        <button onclick=load()>Load</button>
    </>
    <Loading>
        Loading...
    </>
    <Error(msg)>
        <div>${msg}</div>
    </>
    <Empty>
        <div>No rows yet.</div>
    </>
    <Success(count)>
        <div>Got it: ${count} rows</div>
    </>
</>

</program>
```

> **Correction, May 2026:** as of the quoted-text model (SPEC §4.18), display text inside `<engine>` and `<match>` block-form bodies is written as a `"..."` display-text literal — a bare run is treated as code. The bare `Loading...` / `No rows yet.` runs in the examples here and below predate that model and would be written quoted.

What you got from the wrapper:

- **Structural exhaustiveness.** If you forget to handle `.Success`, the compiler errors. If a future version of `Phase` adds another variant, every `<match for=Phase>` site fails compilation until you handle it.
- **No more boolean math.** "Is the spinner showing AND the result showing?" is now a question the type system answers. You are in exactly one variant at a time.
- **Variant data is local.** `<Error msg>` binds the string payload to `msg` inside the variant body. No more `@errorMsg` scoped to the whole file.
- **Errors are states.** `LoadError::Network` and `LoadError::Empty` map onto `.Error(msg)` and `.Empty` Phase variants the moment they fail. The two extra `<isError>` and `<errorMsg>` cells from Tier 0 are gone — the failure modes live in the type. The `!{}` handler still exists at the call site, but it does only one thing: route each error variant into the right Phase variant.

The state-children are the same blocks of markup you would have written in Tier 0, just gathered under their variant. Promotion is mostly cut-and-paste, plus the `type` decl.

One detail worth being precise about: `rule="..."` attributes are *allowed* inside `<match>` variants. They parse, and the compiler may check them as-if — the transition graph they imply has to be internally well-formed — but they do nothing at Tier 1. `<match>` is a render-time projection, not a state machine. The rules sit there inert. Tier 1's contract is structural exhaustiveness, not transition enforcement; writing rules in a match documents intent, not behavior. Promotion to `<engine>` is what makes them load-bearing.

This is enough for many apps. Ship it.

## Aside — the value-return shape of Tier 1

Sometimes you want the case-analysis to return a value into an expression position, not project markup. scrml has the same Tier-1 shape, JS-style:

```scrml
const summary = match @phase {
    .Idle             -> "Click load to begin"
    .Loading          -> "Loading…"
    .Error msg        -> "Failed: ${msg}"
    .Empty            -> "No items"
    .Success count    -> "Loaded ${count} items"
}
```

Same exhaustiveness contract — every variant must be covered, the compiler errors otherwise. Same payload destructuring (`Error msg`, `Success count`). The difference is *position* and *output*: `<match for=Phase>` projects markup into a render tree; `match @phase {}` evaluates to a value. Use whichever fits.

Both forms are Tier 1. They coexist. They check the same way. Pick the one that matches the shape of what you're producing — UI tree vs. value.

The promotion path I'll walk in the rest of this article uses the structural `<match for=Phase>` form because the example produces UI. If your case-analysis is producing a value, you stay in the JS-style form indefinitely; there's no Tier 2 for value-return. Engines are about state machines, not expression evaluation.

## The second nudge

Time passes. Features land. Now the screen needs:

- Loading can only start from Idle (not from Error — there is a separate Retry path)
- A successful load should fire an analytics event
- The Error variant gets a Retry button that goes back to Loading

You wire each of these into your event handlers. The wiring works. But the rules — "Loading is reachable from Idle and from Error/Retry" — live distributed across handler bodies. There is no single place to read the transition graph. The compiler emits:

```
W-MATCH-TRANSITIONS-ACCRUING: This <match for=Phase> has 3 transition
points across event handlers (.Idle → .Loading, .Error → .Loading,
.Loading → .Success). Consider promoting to <engine for=Phase> for
transition validation.
  See SPEC §51 (Tier 2 — engines).
```

Same shape. A lint, not an error. You ignore it or you act on it.

## Tier 2 — `<engine>`

Here is where most languages would ask you to rewrite. scrml does not. The state-children migrate verbatim. Only the wrapper changes.

```scrml
<program>

${
    type LoadError:enum = {
        Network(msg: string)
        Empty
    }

    type Phase:enum = {
        Idle
        Loading
        Error(msg: string)
        Empty
        Success(count: int)
    }

    server function fetchItems()! -> LoadError {
        const result = ?{`SELECT * FROM items`}.all()
        if (result.length == 0) fail LoadError::Empty
        return result
    }

    function load() {
        @phase = .Loading
        const rows = fetchItems() !{
            | ::Network msg -> { @phase = .Error(msg); return }
            | ::Empty       -> { @phase = .Empty;     return }
        }
        @phase = Phase.Success(rows.length)
    }
}

<engine for=Phase initial=.Idle>

    <Idle rule=.Loading>
        <button onclick=load()>Load</button>
    </>

    <Loading rule=(.Success | .Error | .Empty)>
        Loading...
    </>

    <Error msg rule=.Loading>
        <div>${msg}</div>
        <button onclick=@phase = .Loading>Retry</button>
    </>

    <Empty rule=.Loading>
        <div>No rows yet.</div>
        <button onclick=@phase = .Loading>Retry</button>
    </>

    <Success count>
        <div>Got it: ${count} rows</div>
        <onTransition from=.Loading>
            ${ analytics.track("load.success") }
        </>
    </>

</>

</program>
```

Compare against the Tier 1 version. The five state-child blocks are byte-for-byte the same markup. The diff is:

- `<match for=Phase>` → `<engine for=Phase initial=.Idle>`
- `rule=.Variant` attributes on each state-child (target-only forms — single `rule=.Loading`, multi `rule=(.A | .B | .C)`, or wildcard `rule=*`).
- A new `<onTransition>` element on the destination state-child
- The `load()` function still writes to `@phase` directly — `@phase = .Loading` — but now the write is validated against the current state's `rule=` set at compile time when the from-state is statically known, and at runtime otherwise.

Everything you got at Tier 1 you keep. What you gained at Tier 2:

- **Active transition rules.** `rule=.Loading` on `<Idle>` is the spec for what `@phase` is allowed to become when it's `.Idle`. The compiler now knows the transition graph.
- **Exhaustive transition validation.** If you wrote `@phase = .Sucess(rows.length)` (typo on `Success`), the compiler errors. If `Phase` gains a `.Cancelled` variant and no `rule=` lists it as a target, the compiler tells you the variant is unreachable.
- **`<onTransition>` blocks.** The analytics event lives in one place, declared structurally, attached to a specific edge in the graph. `<onTransition from=.Loading>` inside `<Success>` fires when entering Success from Loading. It cannot accidentally fire on the wrong path.
- **Direct writes are still the canonical path.** `@phase = .Loading` is the quiet form — invalid transitions fail compile (when from-state is known) or fail at runtime with `E-ENGINE-INVALID-TRANSITION` (when not known). `@phase.advance(.Loading)` is the loud form — same validation but the developer is asserting "this MUST work" so failure throws an asserted-advance error. There is no `.tryAdvance` silent no-op; silent failure hides bugs (S55 verdict).
- **The error handler routes into the Phase enum directly.** The `!{}` block in `load()` does no UI work, no logging, no fallback values. Each error variant just writes the corresponding Phase variant — `@phase = .Error(msg)` or `@phase = .Empty`. The error path and the success path are the same shape: one write each.

The app is now what we wanted from the start. Every reachable state has UI. Every transition is intentional. Every effect is wired to a specific edge in the graph. The whole thing is structurally checkable at compile time.

## Why the migration is mechanical

This is the load-bearing design claim, and it is worth being precise about: **the state-children carry forward verbatim.** The `<Idle>...</>` block in the engine is the same `<Idle>...</>` block from the match. The variant header, the body markup, the bound payload variable — all unchanged.

The only thing that changes between tiers is the wrapper.

```
Tier 0:  if= chains scattered across markup           (no wrapper)
Tier 1:  <match for=Phase> { state-children }         (structural exhaustiveness;
                                                       rule= allowed but inert)
Tier 2:  <engine for=Phase initial=.Variant> {        (transition validation +
            state-children                              transition handlers;
            + rule=.Target attributes (now active)      rule= now load-bearing)
            + <onTransition from= / to= > blocks
         }
```

You climb the ladder by adding a wrapper, not by rewriting your code. That is the difference between a language that punishes you for prototyping and a language that grows up with your app.

## Promotion ergonomics — the compiler tells you, the CLI does the lift

The mechanical-promotion claim above ("state-children carry forward verbatim, only the wrapper changes") is not a marketing line — it is also the operational design that scrml's compiler + CLI surface make concrete.

Two pieces, paired:

**The lint surfaces the opportunity at compile time.** When you write an if-else chain over an enum-typed state cell — `if (@phase == .Idle) { ... } else if (@phase == .Loading) { ... } else if (@phase == .Error) { ... }` — the compiler emits an info-level diagnostic, `I-MATCH-PROMOTABLE`. Three message shapes:

- *Exhaustive coverage:* "this if-else exhaustively covers Phase (.Idle, .Loading, .Error, .Success). Run `bun scrml promote --match app.scrml:42` to convert."
- *Near-miss:* "this if-else covers Phase partially (.Idle, .Loading, .Error). Missing .Success. Add the missing arm, then run `bun scrml promote --match app.scrml:42` to convert. Once promoted, the compiler will catch any future variant-add at the `<match>` site automatically."
- *Wrong-discriminator:* if you wrote your discriminator as a string ("idle" / "loading" / "error" instead of `.Idle` / `.Loading` / `.Error`), the lint defers to a sibling — `W-LIFECYCLE-CANDIDATE` — pointing out the string-discriminator trap. Lift to enum first; then `I-MATCH-PROMOTABLE` re-fires.

It is **info, not warning.** The if-else compiles fine. The lint just names the opportunity.

**The CLI executes the mechanical lift.** When you decide to promote:

```
bun scrml promote --match app.scrml:42       # promote one site in place
bun scrml promote --match app.scrml          # all promotable sites in the file
bun scrml promote --match src/ --dry-run     # preview the diff for the whole tree
bun scrml promote --engine app.scrml         # Tier 1→2: <match> → <engine>
```

The transformation is AST-aware: per-branch rewrite rules handle `if (@cell == .X) { body }` → `<X>{body}</>`, payload destructure `if (@cell == .Error msg)` → `<Error msg>{body}</>`, the `.is(.X)` predicate form, and the trailing `else` (dropped on exhaustive coverage). Comments, indentation, and surrounding markup are preserved verbatim. Re-running the verb on already-promoted code is a no-op.

The pairing matters. React, Vue, Svelte have nothing comparable — there is no equivalent of "your compiler told you a region is ready to lift, and the CLI does the lift mechanically without rewriting your hand-written code." It is uniquely available because scrml's tier ladder is uniquely a *language* feature, not a library convention.

`bun scrml promote` is a sibling of `bun scrml migrate` (which rewrites deprecated→current syntax, e.g., `<machine>` → `<engine>`). Different verb, different semantics: `migrate` removes the old form; `promote` keeps both forms valid. You promote because you decide to, not because something is going away.

(*Status note (S66): `bun scrml promote --match` is shipped — the I-MATCH-PROMOTABLE lint fires with three message shapes (exhaustive / near-miss / compound), and the CLI executes the AST→AST span-rewrite. Both `if (@cell is .X)` and `if (@cell == .X)` predicate forms are accepted. The CLI's companion `--engine` flag (Tier 1→2 lift) is deferred to a follow-up dispatch — it pairs with `W-MATCH-TRANSITIONS-ACCRUING`, a sibling lint that needs its own §34 catalog + impl groundwork; the flag stays registered but prints a clear "deferred" message until that lands.*)

## What this is not

scrml is not Rust, not Elm, not XState, not a state-machine library you import. The tier system is the language's idea of how case analysis on enums should look at three commitment levels. There is no separate runtime to learn, no statechart DSL, no separate file to maintain.

It is also not magic. The compiler cannot infer your intent if you do not name your variants. The lints fire on heuristics — they will sometimes nudge a screen that does not need promotion, and they will sometimes miss a screen that does. They are nudges, not enforcement.

The point is that the compiler has an opinion and tells you about it, and the cost of acting on the opinion is bounded.

## What you do with this

Ship the prototype. When the lint fires, look at it. If it is right — and most of the time it is, by the time you have four booleans gating the same region — promote. The state-children move verbatim. Then ship again.

A scrml app maturing through its tiers is the language working as designed. Booleans-as-lifecycle in early sketch code are not violations; they are in-progress pins. The compiler nudges, the developer responds. The endpoint is an app where every reachable state has UI and every transition is intentional, and you got there without rewriting any of it.

That is the point.

---

*Drafted with Claude. Companion piece: [Why scrml has to deprecate function and component overloading](./why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md). Two features the language is deleting in v0.2.0 because the ladder above already does their job. Part of an ongoing series unpacking scrml's design. Earlier pieces: components-are-states, the npm myth, css without a build step.*
