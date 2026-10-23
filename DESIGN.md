# Design Notes — Why scrml Is What It Is

This document explains the reasoning behind scrml's core design decisions. Not what the language does — the spec covers that — but *why* it does it this way, and what problems each choice solves.

## The Core Thesis

Modern web development requires assembling a stack of specialized tools — a UI framework, a bundler, a server framework, a state manager, a type checker, a CSS solution, a validation library, an ORM — then wiring them together and maintaining the seams between them. Each tool solves one problem well, but the integration is the actual work.

scrml's thesis is that the seams are the problem. A single compiled language can eliminate them entirely: markup, logic, styles, server code, database queries, types, error handling, and tests all live in one file, understood by one compiler. The compiler handles the splitting, the wiring, the optimization. You write what you mean; it builds what the browser needs.

This is not "a framework that does a lot." It is a language. The difference matters.

## State Is First-Class

In React, state is a hook. In Vue, it's a Proxy wrapper. In Svelte, it's a compiler annotation. In all of them, state is a pattern on top of JavaScript — the runtime sees variables, not state.

In scrml, `@count` is a reactive variable at the language level. The compiler knows every read site, every write site, every dependency edge. This means:

- **No diffing.** The compiler generates targeted DOM mutations — not "re-render the component and diff the output," but "update this specific text node." Virtual DOMs exist because frameworks can't see what changed. scrml can.
- **No wrappers.** `@count` isn't `useState()` or `$count` or `ref()`. It's a variable with `@`. Read it, write it, pass it. The compiler handles the rest.
- **No subscription management.** No `useEffect` dependency arrays, no `$:` blocks, no `watch()`. The compiler tracks dependencies automatically from the code you write.

This is why scrml wins fine-grained benchmarks (partial update: 0.4ms vs React's 3.3ms). Direct DOM manipulation with compile-time knowledge of what reads what.

## Mutability Contracts

Most type systems tell you the shape of data. scrml's type system also tells you the *rules* for using it.

- **`lin` (linear types)** — a value that must be consumed exactly once. Not "should be" — the compiler verifies this across every branch, loop, and function call. Database connections, one-time tokens, destructive operations — anything that's incorrect to use twice or forget to use.

  The key insight: `lin` is site-agnostic. A linear value can be created in one function, passed through three others, and consumed in a completely different part of the code. You don't thread it manually through intermediate stages. The compiler tracks it for you. If you need the value at two points in the consumption site, assign it to a `const` — that's the single consumption.

- **`server @var`** — pins state to the server. The compiler enforces that no client code can read or write it directly. Server-authoritative state is a compile-time guarantee, not a runtime check.

- **`protect`** — excludes fields from client-visible types. The compiler won't generate code that sends protected fields to the browser. You can't accidentally leak a `password_hash`.

These aren't conventions. They aren't lint rules. They're compiler-enforced contracts that make entire categories of bugs impossible.

## Single-File Full-Stack

The typical web project has route files, controller files, service files, model files, migration files, component files, style files, test files, config files. Each file is small and focused. The integration — which route calls which controller calls which service queries which model — is spread across the codebase and maintained manually.

scrml takes the opposite approach: one file contains everything about one feature. The compiler extracts what runs where.

```
feature.scrml  →  compiler  →  feature.html
                              feature.client.js
                              feature.server.js (routes)
                              feature.css
```

This means:
- **No API layer.** `server function addContact()` is called like a local function. The compiler generates the route, the fetch call, CSRF tokens, serialization, error handling.
- **No ORM.** `?{SELECT * FROM contacts}` queries SQLite directly. The compiler generates parameterized queries and handles the result.
- **No route files.** The compiler analyzes which functions need server-side execution and generates routes automatically. Protected field access, SQL queries, and `server` annotations are the escalation triggers.

The developer thinks in features. The compiler thinks in architecture.

## Why Not JSX

JSX puts HTML inside JavaScript. scrml puts JavaScript inside HTML.

This is not just a syntactic preference. When HTML is the primary context, the compiler can enforce HTML structure — void elements don't get children, `<table>` contains `<tr>`, `form` attributes are validated. When JavaScript is primary (JSX), HTML is just function calls — `React.createElement("div", null, ...)` — and structural validation is lost.

scrml's markup is real markup. `${}` switches to logic. `#{}` switches to CSS. `?{}` switches to SQL. The sigils create clean boundaries between contexts, and the compiler understands each one natively.

## The `lift` Keyword

In React, a component renders its entire subtree. In scrml, `lift` explicitly inserts markup from a logic context into the DOM.

```scrml
${
    for (let item of @items) {
        lift <li>${item}</>
    }
}
```

Why? Because the compiler generates a reconciler for each `lift` site. It knows the shape of what's being inserted, the key function for diffing, the parent element. This is how scrml achieves LIS-based list reconciliation — the compiler can see exactly what's being iterated, what the identity key is, and what DOM operations to generate.

An implicit "return JSX" model hides this information. `lift` makes it explicit, and the compiler uses that explicitness to generate better code.

## Compile-Time Meta

`^{}` blocks run at compile time. This is scrml's answer to code generation.

```scrml
<program>
${
    type UserFields:struct = { name: string, email: string }
}
<form>
    ^{
        const info = reflect(UserFields);
        for (const f of info.fields) {
            emit(`<label>${f.name} <input name="${f.name}"/></label>`);
        }
    }
</form>
</program>
```

Why compile-time? Because the alternative is runtime metaprogramming — eval, Proxy, Reflect — which is opaque to the compiler, opaque to the type system, and opaque to debugging.

scrml's meta blocks produce source. The output is spliced into the AST and compiled like any other code. Types are checked, errors are reported, the debugger sees normal code. The metaprogramming is powerful, but the output is transparent.

Runtime meta exists too — when a `^{}` block references `@` reactive variables, it executes at runtime. The compiler classifies each block automatically. You write the same syntax; the compiler decides when it runs.

## Enums and Pattern Matching

scrml has Rust-style enums with exhaustive pattern matching. Every `match` must handle every variant.

Why in a web language? Because UI state is almost always an enum. A form is `Editing | Submitting | Success | Error`. A data fetch is `Loading | Ready | Failed`. A modal is `Open | Closed`. If you model these as strings or booleans, the compiler can't help you — it doesn't know that `"loading"` and `"ready"` are the only valid states. With enums, it does.

Exhaustive matching means the compiler catches the "you forgot the error state" bug at compile time. Combined with state machines (`<engine>` with `rule=` transition contracts), this makes illegal state transitions a compile error, not a runtime surprise.

## Error Handling

scrml's `!{}` error contexts are typed, pattern-matched, and propagated automatically. This is not try/catch with extra syntax — it's a different model.

Errors in scrml are enum variants. Each error context declares what errors it can produce. The compiler traces error propagation through function calls and ensures every error is handled or explicitly propagated. This is closer to Rust's `Result` type than to JavaScript's exceptions.

Why? Because web apps have real error modes — network failures, validation errors, auth failures, database errors — and "it might throw something" is not a useful type. Knowing *exactly* which errors a function can produce, and proving that the caller handles all of them, eliminates an entire class of production bugs.

## No npm

scrml ships its own standard library. No `package.json`, no `node_modules`, no dependency tree.

This is a deliberate constraint. npm dependencies are:
- **A security surface.** Every dependency is code you didn't write running in your process.
- **A compatibility surface.** Every major version bump of every dependency is a potential breaking change.
- **A build surface.** Bundlers exist primarily to resolve, transform, and tree-shake `node_modules`.

scrml eliminates all three. The compiler is the build tool. The stdlib provides common utilities. If you need external JavaScript, `import` it — but the default is zero dependencies.

## Build Speed

scrml compiles a TodoMVC in 31ms. React + Vite takes 473ms.

This isn't just optimization. It's architecture. scrml has one compiler pass over one file, producing HTML, CSS, and JS directly. The typical framework stack has: TypeScript compilation, JSX transformation, module resolution, CSS extraction, tree shaking, minification, chunk splitting, and sourcemap generation — each as a separate tool with its own parse/transform/emit cycle.

A single-pass compiler over a single file type is inherently faster than a pipeline of general-purpose tools over a collection of file types. scrml is fast because it's simple.

## What scrml Is Not

- **Not a framework.** Frameworks are libraries loaded at runtime. scrml is a compiler. The output is plain HTML, CSS, and JavaScript with no framework dependency.
- **Not opinionated about architecture.** scrml doesn't enforce MVC, MVVM, or any other pattern. It gives you reactive state, server/client splitting, and components. How you organize them is up to you.
- **Not locked to Bun.** The compiler runs on Bun (for its SQLite driver and fast startup), but the compiled output runs in any browser and any JavaScript runtime.
- **Not a toy.** The spec is 18,000 lines. The compiler has 5,500+ tests. The type system handles linear types, predicated types, enum exhaustiveness, and server/client boundary verification. This is a production-grade tool under active development.
