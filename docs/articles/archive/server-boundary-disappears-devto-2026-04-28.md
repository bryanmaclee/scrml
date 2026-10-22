---
title: The server boundary disappears
published: false
description: In framework land, "where does this code run" is the developer's problem to remember. In scrml, it's a type-system question.
tags: webdev, javascript, programming, compiler
cover_image:
canonical_url:
---

> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. Its scrml is an older dialect that the language has since replaced, and its code is not compile-gated, so code copied from here will not compile as today's scrml. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

*authored by claude, rubber stamped by Bryan MacLee*

**TL;DR: Stop writing API routes. The compiler does it.**

Every framework dev has shipped a bug where they thought a function ran on the server but it didn't, or thought it ran on the client but it didn't. I am not an experienced framework developer. I can hobble through React if I HAVE TO. But across about twenty compiler attempts the same shape kept showing up: the compiler should know which side of the wire each function is on, because the wire is part of the program.

I'm obsessed with performance. I'm also a believer in "do it right, the first time, even if it takes more time." The server boundary is a place where most languages do neither, and the runtime pays for both. So this is the second of six features the browser-language overview piece promised to unpack later. The boundary, in detail.

## What "shipping a typed POST endpoint" actually costs

Pick a framework. Next, Remix, Express plus a React frontend, doesn't matter. The minimum table-stakes for a single server endpoint that takes some data, validates it, persists it, and returns a typed response looks like this:

**On the server:**

```ts
// app/api/orders/route.ts
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const SubmitOrderInput = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().int().min(1).max(99),
  })),
});

const SubmitOrderOutput = z.object({
  orderId: z.string().uuid(),
  total: z.number(),
});
type SubmitOrderOutput = z.infer<typeof SubmitOrderOutput>;

export async function POST(req: Request) {
  const session = await auth(req);
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const parsed = SubmitOrderInput.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error), { status: 400 });
  }

  // ... actual business logic finally starts here ...
  const order = await db.orders.insert(...);
  return Response.json({ orderId: order.id, total: order.total });
}
```

**On the client:**

```ts
// app/cart/page.tsx
type SubmitOrderInput = { items: { productId: string; qty: number }[] };
type SubmitOrderOutput = { orderId: string; total: number };

async function submitOrder(input: SubmitOrderInput): Promise<SubmitOrderOutput> {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": getToken() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SubmitOrderOutput>;
}
```

That's the *minimum*. No retry. No timeout. No proper error type. No loading state. The shapes are typed twice, once with zod and once with hand-written TS. The CSRF token plumbing is manual. If you change the input shape on the server and forget to update the client TS type, nothing fails until production traffic hits it.

This is the seam. It is the most expensive seam in the application. It is also the seam that no framework can close, because the framework doesn't own both sides of it.

## The same feature in scrml

```scrml
<program>

<db src="./app.db" tables="orders,order_items"/>

${
    type SubmitError:enum = {
        ItemCountOutOfRange
    }

    server function submitOrder(items)! -> SubmitError {
        if (items.length == 0 || items.length > 100) {
            fail SubmitError::ItemCountOutOfRange
        }
        const total = items.reduce((acc, it) => acc + it.price * it.qty, 0)
        const orderId = ?{`INSERT INTO orders (total) VALUES (${total}) RETURNING id`}.get().id
        for (let it of items) {
            ?{`INSERT INTO order_items (order_id, product_id, qty)
               VALUES (${orderId}, ${it.productId}, ${it.qty})`}.run()
        }
        return { orderId: orderId, total: total }
    }
}

</program>
```

And the call site, anywhere in the same file or another `.scrml` file in the project:

```scrml
let result = submitOrder(@cart.items)
```

That's the entire feature. Both halves.

What the compiler did with `server function`:

1. Generated a server-side route handler. Route name is compiler-internal; you don't reference it.
2. Generated the client-side `fetch` call that invokes the route, with arg serialization and response deserialization. The developer SHALL NOT write `JSON.stringify`, `JSON.parse`, or `fetch` to consume server function return values (§12.5 + §13.1 — the compiler manages async across the server boundary; `async`/`await` are not scrml keywords).
3. Type-checked the call site. `submitOrder(@cart.items)` checks the argument shape against the server fn signature in the same compile pass. There is no client-side `type SubmitOrderInput` declaration to drift.
4. Emitted the function body to the server output only. The client gets a fetch stub.
5. Enforced the failable contract at the server boundary. The `fail SubmitError::ItemCountOutOfRange` lands on the server, before any database write. (Refinement-type predicate arguments on parameters — `items: List<Item>(@length > 0 && @length < 100)` style — are part of the §53 design surface still landing; today the bounds check rides as the failable-function entry guard above.)

## What the compiler refuses

Six refusals, every one of them a real diagnostic with an E-code you can look up.

**1. Reading a server-only field on the client. (E-PROTECT-001)**
If `< db>` declares `protect="passwordHash"`, then `passwordHash` does not exist on the client type. A client-side function trying to read it is a compile error, not a runtime exposure.

**2. Code that accesses a protected field but might run client-side. (E-PROTECT-002)**
The compiler verifies at compile time that no function accessing protected fields executes on the client. Any code path that could route to the client and touches a protected field fails compile.

**3. A server fn calling a client-only fn. (E-ROUTE-002)**
If a `server fn` transitively calls a function that touches the DOM or reads a client-only derived value, compile fails with the call chain printed. The error message names the server function, the client-only callee, and the path between them, then suggests three resolutions: extract a pure function, duplicate the logic, or re-evaluate the classification.

**4. A non-serializable return type from a server fn. (E-ROUTE-003)**
Try to return a function, a DOM node, or a class instance from `server fn` and the compile fails. The wire is JSON; the type system enforces it.

**5. A client-local `@var` used as a bound parameter in INSERT, UPDATE, or DELETE outside a server fn. (E-AUTH-001)**
The compiler refuses to silently persist client-local state. The error message tells the developer to pass the value to a server function first.

**6. A predicate violation at the boundary. (E-CONTRACT-001 at compile time, E-CONTRACT-001-RT at the boundary.)**
If the compiler can prove a literal violates a predicate, the build fails. If the value is only known at runtime, a server-side boundary check fires before any business logic runs and rejects the request.

That's six refusals. Every one of them is a type-system answer to a question that, in framework land, is "hope your tests catch it."

## What gets generated for free

Beyond refusing the wrong things, the compiler also generates the things you would have written by hand:

- **The fetch stub.** Argument serialization, response deserialization. No `JSON.stringify`. No `JSON.parse`. The compiler manages the server boundary; `await` is not something you write.
- **The route handler.** With its name as a compiler-internal detail you never see.
- **CSRF plumbing, when `<program csrf="on">` is set.** A token-mint server fn, a `<meta name="csrf-token">` injection in the generated HTML, a request interceptor that adds the `X-CSRF-Token` header to every state-mutating request, and a server-side validator that returns 403 if the token is missing or invalid (§39.2.3).
- **Predicate validation at the boundary.** Inline predicate constraints on server function parameters are enforced server-side, before any database write or business logic, independently of any client-side check. A server function's parameter constraint cannot be bypassed by raw HTTP requests (§53.9.4).
- **Async parallelization.** Independent server calls in the same function body are parallelized in generated code; dependent ones are sequenced. The developer writes flat synchronous-looking code; the compiler manages the async sequencing in the generated output (§13.2).

The compiler is the dev's best friend. That phrase comes up a lot in my notes. This is what it means in practice. Every line of the framework boilerplate above is moved into the compiler, where it cannot drift, cannot be skipped under deadline pressure, and cannot be wrong without the build failing.

## What this kills

- The `app/api/` directory. There aren't any route files. There are functions.
- Hand-written fetch wrappers. There is no `apiClient.ts`.
- tRPC and OpenAPI codegen steps. The type goes through the boundary natively because the compiler owns both sides.
- Zod-on-the-wire. Inline predicates *are* the type. A schema file isn't a separate artifact. Why would anyone bring zod into a scrml project?
- Type-drift bugs that ship to prod. The client and server agree on the shape because there is one declaration.

## What is still real

Server-side concerns don't disappear. They just stop being plumbing.

- **Auth.** Still your job. The `server` annotation is described in the spec as a security escape hatch precisely because compile-time inference of "what touches protected data" is not always sufficient on its own (§52). Annotate auth-touching functions with `server` explicitly.
- **Rate limiting.** A `<program ratelimit="100/min">` attribute generates a sliding-window limiter (§39.2.4). Tune the rate to your business; the mechanism is built in.
- **Input validation against business rules.** Predicates handle shape and range. Business rules ("this user can submit at most 3 of these per day") are still business logic. They live inside the `server fn`. They benefit from running where the data lives.

The line between "plumbing the framework forced you to write" and "actual business logic" gets a lot brighter when one side of it is gone.

## The deeper claim

A reactive system that wires its dependencies at compile time does no work at runtime to figure out what to update. A query that batches itself at compile time doesn't need a DataLoader. A boundary that is enforced at compile time doesn't need a validator on the wire.

The runtime does less because the compiler did more. The seam between client and server stops being a place where bugs live and starts being a place where the type system has the most leverage. That is the design. A little short of perfect is still pretty awesome.

## Further reading

- [Why programming for the browser needs a different kind of language](https://dev.to/bryan_maclee/why-programming-for-the-browser-needs-a-different-kind-of-language-6m2). The high-altitude six-feature overview that this piece zooms in on.
- [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-2247). The package-list-collapses argument worked through one tier at a time.
- [What scrml's LSP can do that no other LSP can, and why giti follows from the same principle](https://dev.to/bryan_maclee/what-scrmls-lsp-can-do-that-no-other-lsp-can-and-why-giti-follows-from-the-same-principle-4899). What vertical integration unlocks for tooling and version control.
- [Introducing scrml: a single-file, full-stack reactive web language](https://dev.to/bryan_maclee/introducing-scrml-a-single-file-full-stack-reactive-web-language-9dp). The starting-point overview if you haven't seen scrml before.
- [Null was a billion-dollar mistake. Falsy was the second.](https://dev.to/bryan_maclee/null-was-a-billion-dollar-mistake-falsy-was-the-second-3o61). On `not`, presence as a type-system question, and why scrml refuses to inherit JavaScript's truthiness rules.
- [Retraction — scrml's Living Compiler](./living-compiler-retraction-devto-2026-05-21.md). The "scrml's Living Compiler" article has been retracted; scrml chose a sealed, deterministic build-story model instead.
- **scrml on GitHub:** [github.com/bryanmaclee/scrmlTS](https://github.com/bryanmaclee/scrmlTS). The working compiler, examples, spec, benchmarks.

<!--

## Internal verification trail (private — agent-only, not for publish)

This block is an HTML comment so it does not render on dev.to.

- Bio: `/home/bryan/scrmlMaster/scrml-support/voice/user-bio.md` (v1, signed off 2026-04-27; project memory marks BAKED 2026-04-28).
- Private draft / verification log: `/home/bryan/scrmlMaster/scrml-support/voice/articles/server-boundary-disappears-draft-2026-04-28.md`.
- Companion published: `why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` (the six-feature overview this piece zooms in on).
- Companion published: `npm-myth-devto-2026-04-28.md` (CSRF mint-on-403 prior framing; soft-rephrased here per spec validation).
- Companion published: `lsp-and-giti-advantages-devto-2026-04-28.md` (verification log structure pattern).
- Agent: `/home/bryan/.claude/agents/scrml-voice-author.md` (article mode, gate cleared per project memory bio-baked 2026-04-28).
- SPEC: `/home/bryan/scrmlMaster/scrmlTS/compiler/SPEC.md` (§12, §13, §39, §52, §53 cited). <!-- §11 folded into §6.12 + §52 (S194); the protect=/server-annotation content cited here now lives in §52, already listed. -->

**Spec validation summary:**

- ✅ `server fn` syntax current (§52 — `server` annotation under State Authority; §11.4 folded into §52 S194).
- ✅ Boundary security at compile time: E-PROTECT-001/002, E-ROUTE-002, E-AUTH-001, E-CONTRACT-001 all spec-defined and ship.
- ✅ Auto-generated fetch + route handler (§12.3, §12.5, §13.2).
- ✅ Predicate enforcement at server boundary (§53.9.4, verbatim normative).
- ✅ Schema-level argument typing across boundary (route analysis runs before codegen, §12.4).
- ⚠️ "CSRF mint-on-403" (npm-myth's shortcut) softened to enumerate the four spec-confirmed components (§39.2.3): mint server fn, meta-tag injection, request interceptor, server-side validator returning 403. The spec does not normatively define a client-side retry-with-fresh-token loop.
- ⚠️ "Tree-shake server-only code from client bundle" softened. Spec normatively documents this for SSE generators (§13.2.6) and channel handlers (§38.8) and protect= fields (§52). For general `server fn`, the partition follows from §12.3 (route handler is server-side, client gets fetch call) but the spec does not have a single global "tree-shake" claim. Article wording: "the function body is emitted to the server output only; the client gets a fetch stub."

**Forbidden territory check (bio §6):** all clear. React hobble-through disclosure used in opener (bio-attested). Framework-fatigue narrative avoided (article is structural, not autobiographical-recovery). User-attested motivations only ("obsessed with performance", "do it right, the first time", "compiler is the dev's best friend").

-->
