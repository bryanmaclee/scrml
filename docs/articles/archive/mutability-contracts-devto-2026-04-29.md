---
title: Mutability contracts
published: false
description: Three things your code already keeps track of, in three different places, with three different libraries. The type system can own all three.
tags: webdev, javascript, programming, compiler
cover_image:
canonical_url:
---

> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. Its scrml is an older dialect that the language has since replaced, and its code is not compile-gated, so code copied from here will not compile as today's scrml. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

*authored by claude, rubber stamped by Bryan MacLee*

**TL;DR: Three things your code already keeps track of, in three different places, with three different libraries. The type system can own all three.**

> **Status (as of May 2026):** the value-predicate layer (`<amount> req gt(0) lt(10000)` on state cells; named-shape predicates `email` / `url` / `uuid` / `pattern(...)`; cross-field args like `eq(@signup.password)`) ships today — see SPEC §53 + §55. The **lifecycle / typestate** layer (`(not -> string)` field-transition annotations) and the **`lin` linear-type** layer described later in this piece are SPEC-ratified design surfaces that are not yet implemented in the compiler. Treat those sections as preview of where the contract-as-type idea is going; the value-predicate sections are working today.

> **Updated 2026-05-13 (S89):** `(null -> T)` lifecycle syntax has been migrated to `(not -> T)` per scrml canonical absence sentinel (`not`). `null` is not a scrml token; the typestate arrow now uses `not` for the pre-transition variant. TS-contrast snippets and host-language references to `null` are left intact as comparative pedagogy.

I am not an experienced framework developer. I can hobble through React if I HAVE TO. But across about twenty compiler attempts I kept noticing that the same data, on its way through a single feature, gets validated by three independent mechanisms. Zod at the network edge. A custom hook for the loading lifecycle. XState, or a hand-rolled `switch`, for what state can become what state next. Each one a separate library. None of them talking to each other.

Shape narrowing, life-cycles, state machines. These are the three faces of one thing. Scrml fuses them into one type-system mechanic, enforced on every write. Six features the browser-language overview piece promised to unpack later. This is the third.

This article is about *writes*. The absence side of the story (what does it mean for a value to not exist, and why `not` is a better answer than `null`) lives in its own piece. See "Null was a billion-dollar mistake" for that half. The half here is: when a value DOES exist and you're writing to it, what contract does that write have to honor?

## Three places one value gets checked

Here is a feature any web app has shipped a hundred times. A user submits an order. `amount` must be positive and under ten thousand dollars. The order moves through statuses: pending, processing, shipped, delivered (or cancelled). The submit button mints a one-shot CSRF token that has to be used exactly once. Pretty boring. Pretty common.

In a framework stack:

```ts
// 1. Network edge: zod schema, validated on POST.
const Order = z.object({
  amount: z.number().positive().max(10000),
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
});

// 2. Inside the component: a custom hook for "does the order even exist yet?"
function useOrder(id: string) {
  const [order, setOrder] = useState<Order | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // ...fetch logic, useEffect, error handling...
  return { order, phase };
}

// 3. State transitions: XState machine, or hand-rolled switch.
function nextStatus(curr: Status, action: Action): Status {
  switch (curr) {
    case "pending":     return action === "process" ? "processing" : curr;
    case "processing":  return action === "ship"    ? "shipped"    : curr;
    // ... and on, and on
  }
}

// 4. The CSRF token: passed by ref, hoped to be used once, sometimes accidentally
//    captured in a closure that fires twice. No compiler help.
async function submit(token: string, order: Order) {
  await fetch("/api/orders", { headers: { "X-CSRF": token }, /* ... */ });
}
```

Four mechanisms. Three libraries. One value (`order.amount`) flowing through all of them. If the zod schema and the TypeScript type drift, no compiler tells you. If the state machine adds a new transition and the component's `if/else` doesn't, no compiler tells you. If the CSRF token gets captured in two callbacks, no compiler tells you. Most production apps live with all four of those drifts running silently in parallel.

The compiler doesn't own the picture, because the language doesn't model the picture. Same gap, every time.

## The three components, in scrml

Scrml takes those four mechanisms and folds them into the type system. One contract. Three pieces. Enforced at every write site.

### 1. Value predicates: what values are valid

Inline predicates are part of the type.

```scrml
<amount gt(0) lt(10000)> = 0
```

That's the type, complete. The constraint isn't a runtime call to `validate()`. It isn't a Zod schema living in a separate file. It's the variable's declared type. Every assignment to `@amount` is checked against the predicate.

If the assignment is a literal, the compiler proves it statically:

```scrml
@amount = 50000
// E-CONTRACT-001: literal 50000 violates declared constraint (>0 && <10000)
//                 on @amount
```

That is a compile error. The bad code does not run.

If the value can't be proven statically (it came from user input, an API response, a database read), the compiler emits a single boundary check at the assignment:

```scrml
@amount = parseInt(userInput)
// Compiler emits one runtime guard. Violation = E-CONTRACT-001-RT.
// The variable retains its prior value if the guard fails.
```

One check, at the boundary, where the data crosses from "untrusted" to "in-language." Inside the language, the constraint is invariant. Arithmetic that produces a `number` re-enters the boundary and re-checks.

The same predicate also drives the bound HTML input:

```scrml
${ <amount min(1) max(9999)> = <input type="number"/> }
// Compiles to: <input type="number" min="1" max="9999"/>
```

This is the Shape-2 (decl-coupled-with-render-spec) form from SPEC §6.2 — validators ride as bare attributes on the declaration; `<amount/>` in markup expands to the bound input element. The browser enforces the same constraint at the keystroke level. The type generated the attribute.

The named-shape registry covers the common cases:

```scrml
@email:    string(email) = ""
@homepage: string(url)   = ""
@id:       string(uuid)  = ""
@phone:    string(phone) = ""
```

The compiler ships with `email`, `url`, `uuid`, `phone`, `date`, `time`, `color` in the registry.

That's component one. There is no Zod, no Yup, no Joi, no Valibot. There is no parallel schema file that has to stay in sync with the TypeScript type. The schema *is* the type.

### 2. Presence lifecycle: how values transition into existence

Some values do not exist yet, and then they do. A password hash before the user finishes signup. A database row id before the insert returns. An auth token before the request completes. Most languages model this with `T | null` or `Option<T>`, and every read of the value pays the `if (x !== null)` ceremony tax forever, even after the value is clearly established.

Scrml's lifecycle annotation says: *this field starts as type A, and after a defined transition, it is type B.*

```scrml
type User:struct = {
    id: number,
    email: string,
    passwordHash: (not -> string),
    metadata: (!not && !number)
}
```

`passwordHash` starts as `not` and transitions, exactly once, to `string`. The compiler tracks the transition. Code written *before* the transition sees `passwordHash` as `not` and cannot read it as a string. Code written *after* sees it as `string` with no presence check needed. The transition itself is the only place the assignment is allowed.

```scrml
fn finalizeSignup(user: User) {
    // Before the transition: user.passwordHash is not.
    // Reading it as a string here = E-TYPE-001.

    user.passwordHash = hash(user.password)   // the transition site

    // After the transition: user.passwordHash is string.
    // Read freely, no `if (x !== null)` ceremony.
    sendEmail(user.email, "Welcome, hash is " + user.passwordHash)
}
```

This is what "mutable structure life-cycle" actually buys you: a function can refer to the field before AND after the mutation, the compiler knows which side of the transition each reference is on, and the function stays pure because the lifecycle is part of the type.

The contrast with `T | null` is the cost. With `T | null`, *every* read of the field forever has to `if (x !== null)`, even three function calls deep inside business logic that has clearly established the value exists. With `(not -> string)`, the type narrows after the transition and the ceremony tax stops being charged.

That is component two. There is no `useFetchState` hook. There is no `idle | loading | success | error` enum the developer has to build by hand for every async-ish thing. The transition is the type.

### 3. State machine transitions: what state can become what state

For values that move between many named states (not just `not -> T`), scrml's enum types declare the legal moves directly:

```scrml
type OrderStatus:enum = {
    Pending
    Processing
    Shipped
    Delivered
    Cancelled

    transitions {
        .Pending    => .Processing
        .Pending    => .Cancelled
        .Processing => .Shipped
        .Processing => .Cancelled
        .Shipped    => .Delivered
    }
}

@status = OrderStatus.Pending

${ function reopen() {
    @status = OrderStatus.Pending   // legal? Compiler checks the rule list.
} }
```

If the prior value is statically known to be `Delivered`, the compiler refuses the assignment:

```
E-ENGINE-001: Illegal transition.
  Variable: @status (type: OrderStatus)
  Move: .Delivered => .Pending
  OrderStatus has no transition rule from .Delivered.
  .Delivered is a terminal variant.
  Hint: add `.Delivered => .Pending` to OrderStatus.transitions if this move
        is intended, or bind @status to an <engine> that permits this move.
```

The error is a flat compile failure. If the prior value isn't statically known, the compiler emits a single runtime guard at the assignment site (`E-ENGINE-001-RT`). One guard. Not a wrapping XState machine, not a hand-rolled `switch`. A compiler-emitted check that runs once, at the write, where the language already needed to be.

The deeper feature, `<engine>` blocks, lets you scope a transition graph to a context (a different set of legal moves for an admin vs. a customer view) and attach effects on transition. That belongs to its own piece. The point for *this* article is: state-machine transitions are a write-time contract, enforced by the type system, not a separate library bolted to the side.

### 4. `lin`: writes that must happen, exactly once

The fourth piece is for values where "did it get used twice" or "did it get silently dropped" is itself a correctness bug. A CSRF token. A transaction handle. A one-shot DB statement.

```scrml
lin token = mintCsrfToken()

submitOrder(token, @cart)   // consumption: legal.
// any second reference to `token` after this is E-LIN-002.
// any path that exits the scope without consuming `token` is E-LIN-001.
```

A `lin` value is a binding the compiler refuses to let you use twice, drop without using, or capture in a place where it might run zero or many times. The CSRF-token bug above (captured in two callbacks, fires twice) is now a compile error. So is the symmetric mistake (forgot to submit the token, transaction silently dangles).

Lift `lin` against the `if`/`else` branches:

```scrml
lin token = mintCsrfToken()
if (@user.isPremium) {
    submitPremium(token)   // both branches must consume `token`,
} else {                    // exactly the same number of times.
    submitStandard(token)
}
```

Both branches consume `token` exactly once, so the compiler is satisfied. If only one branch consumed it, that's `E-LIN-003` (consumed in some branches but not all).

`lin` is the write-side guarantee that completes the trio. Predicates say "the value must be valid." Lifecycles say "the value progresses through these forms." Machines say "the state moves along these declared edges." `lin` says "this write happens, on the right path, exactly once." Together they cover the four categories of write-bug your zod-plus-hook-plus-XState stack was checking by hand.

## What unifies all of this

Scrml's design move is not "we built better validation." It's that the contract IS the type.

`number(>0 && <10000)` is a type. So is `(not -> string)`. So is `OrderStatus`-with-`transitions`. So is `lin token`. They appear in the same positions every other type appears: variable declarations, struct fields, function parameters, return types. They are checked by the same compiler pass that does ordinary type checking. There is no parallel validation graph. There is no runtime registry. There is no "validation library version drift," because there is no validation library.

When the contract is the type, the developer reads a function signature and reads a complete description of what the function will accept, what state the field has to be in to call it, and what happens after.

```scrml
fn shipOrder(order: Order, lin shipment: ShipmentReceipt)
    where order.status: .Processing -> .Shipped
```

Six tokens of signature describe: the order's `status` must be `.Processing`, after the function it will be `.Shipped`, the `shipment` receipt is consumed exactly once, the `Order` carries its inline predicates internally. A reader who has never seen the function body knows what the function is allowed to do.

## What this kills

If the contract is the type, several familiar pieces of every framework codebase stop being needed.

- **Zod (and Yup, Joi, Valibot, Ajv) on the network edge.** The schema is the type. The boundary check fires at the boundary. The bind:value attribute on the input flows from the same predicate.
- **`useFetchState` / `useAsync` / RTK Query lifecycle hooks.** If "this field is absent until it's loaded" is the actual contract, write `(not -> T)` and stop hand-rolling the machine. The compiler narrows the type after the transition site.
- **Most XState machines.** Enum `transitions {}` covers structural permission graphs. `<engine>` covers contextual ones with guards and effects. The library wrapper goes away.
- **Manual `if (x !== null) { ... }` ceremony three calls deep into business logic.** The narrowing is part of the lifecycle annotation. The compiler knows which side of the transition each reference is on. The defensive `if` chain stops appearing.
- **Manual single-use enforcement (CSRF, transactions, one-shot promises).** `lin` makes that contract a compile error if you violate it, not a postmortem.

The combined effect is a kind of straight-through typing. The data has one description, and that description is the compiler's job.

## What is still real

Some things are runtime by nature. A webhook from Stripe lands as a JSON blob. The compiler cannot prove its shape. A raw `JSON.parse` of an external payload still has to be validated. The stdlib `data/validate` covers exactly that case. The point of this article is not "no validation, ever." The point is no DUPLICATE validation when the type already says what it says.

Untrusted input then stdlib validator then typed value. From then on, the type system carries the contract. One validation, where it belongs, then nothing. The seam between "I parsed this from the wire" and "the rest of my program" is exactly one boundary, and after the boundary, you stop paying.

## Why bother

Three concepts, three libraries, three drift surfaces. Or one type system, one compile pass, one description. I am obsessed with performance. I am also a believer in "do it right, the first time, even if it takes more time." Mutability contracts is what "do it right, the first time" looks like for the most-checked, most-drift-prone surface in a typical codebase.

This isn't novel theory. Refinement types are a 1991 idea. Linear types are a 1987 idea. Lifecycle-typed fields are a typestate idea, also from the 80s. Every concept here has years of academic backing. What scrml is doing is wiring all three into the same type system, in the same syntax, in the same compile pass, and emitting the same flavor of error code from the same compiler that does your reactive variables and your server boundary and your CSS scoping.

A reactive system that wires its dependencies at compile time does no work at runtime to figure out what to update. A query that batches itself at compile time doesn't need a DataLoader. A boundary enforced at compile time doesn't need a validator on the wire. A write contract carried by the type doesn't need three libraries to keep in sync.

The runtime does less because the compiler did more. A little short of perfect is still pretty awesome.

## Further reading

- [Why programming for the browser needs a different kind of language](https://dev.to/bryan_maclee/why-programming-for-the-browser-needs-a-different-kind-of-language-6m2). The high-altitude six-feature overview that this piece zooms in on.
- [Null was a billion-dollar mistake. Falsy was the second.](https://dev.to/bryan_maclee/null-was-a-billion-dollar-mistake-falsy-was-the-second-3o61). The absence half of the story. This article handled writes; that one handles "what does it even mean for a value to be missing."
- [The server boundary disappears](https://dev.to/bryan_maclee/the-server-boundary-disappears-hap). Predicates enforced at the server boundary, in detail.
- [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-2247). What replaces zod, joi, yup, valibot, ajv. The named-shape registry territory.
- [What scrml's LSP can do that no other LSP can, and why giti follows from the same principle](https://dev.to/bryan_maclee/what-scrmls-lsp-can-do-that-no-other-lsp-can-and-why-giti-follows-from-the-same-principle-4899). What vertical integration unlocks for tooling.
- [Introducing scrml: a single-file, full-stack reactive web language](https://dev.to/bryan_maclee/introducing-scrml-a-single-file-full-stack-reactive-web-language-9dp). Starting-point overview if you haven't seen scrml before.
- [Retraction — scrml's Living Compiler](./living-compiler-retraction-devto-2026-05-21.md). The "scrml's Living Compiler" article has been retracted; scrml chose a sealed, deterministic build-story model instead.
- **scrml on GitHub:** [github.com/bryanmaclee/scrmlTS](https://github.com/bryanmaclee/scrmlTS). The working compiler, examples, spec, benchmarks.
