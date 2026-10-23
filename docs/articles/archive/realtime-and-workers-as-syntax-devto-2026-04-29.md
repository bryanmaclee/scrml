---
title: Realtime and workers as syntax
published: false
description: WebSockets and Web Workers are common enough in modern apps that the language should treat them as primitives, not as plumbing the developer wires up by hand.
tags: webdev, javascript, programming, compiler
cover_image:
canonical_url:
---

> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. Its scrml is an older dialect that the language has since replaced, and its code is not compile-gated, so code copied from here will not compile as today's scrml. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

*authored by claude, rubber stamped by Bryan MacLee*

**TL;DR: Stop wiring WebSockets and workers by hand. The language declares them. The compiler builds the plumbing.**

Almost every nontrivial browser app reaches for WebSockets and workers eventually. Multiplayer cursors. Live notifications. Off-thread compute that would freeze the UI if it ran on the main thread. The language can either treat these as primitives or watch you write the same plumbing every time. I am not an experienced framework developer. I can hobble through React if I HAVE TO. But across about twenty compiler attempts the same shape kept showing up here too: the things you reach for last in a project are the things the language modeled least, and the runtime pays the price.

I'm obsessed with performance. I'm also a believer in "do it right, the first time, even if it takes more time." Realtime and off-thread compute are exactly the places where most languages do neither, and you find out about it three months in. So this is the sixth of six features the browser-language overview piece promised to unpack later. Sockets and workers, in detail.

## What "shipping a realtime feature" actually costs

Pick a stack. ws plus your own message router, Socket.IO, whatever. The minimum table-stakes for a feature where two browsers see each other's writes in near-real-time looks roughly like this.

**On the server:**

```ts
// server.ts
import { WebSocketServer } from "ws";
import { auth } from "./lib/auth";

const wss = new WebSocketServer({ port: 8080 });
const rooms = new Map<string, Set<WebSocket>>();

wss.on("connection", async (ws, req) => {
  const session = await auth(req);
  if (!session) { ws.close(1008, "unauthorized"); return; }

  const room = new URL(req.url!, "http://x").searchParams.get("room") ?? "lobby";
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room)!.add(ws);

  ws.on("message", (raw) => {
    let msg: unknown;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    // ... shape validation, then broadcast ...
    for (const peer of rooms.get(room)!) {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        peer.send(JSON.stringify(msg));
      }
    }
  });

  ws.on("close", () => {
    rooms.get(room)!.delete(ws);
  });
});
```

**On the client:**

```ts
// client.ts
type ChatMsg = { author: string; body: string; ts: number };

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

function connect() {
  ws = new WebSocket(`wss://${location.host}/?room=${encodeURIComponent(currentRoom)}`);
  ws.onopen = () => { /* update UI */ };
  ws.onmessage = (e) => {
    const msg: ChatMsg = JSON.parse(e.data);
    // ... update local state, hope the shape matches ...
  };
  ws.onclose = () => {
    reconnectTimer = window.setTimeout(connect, 2000);
  };
  ws.onerror = (err) => { /* surface to user */ };
}

function send(msg: ChatMsg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    // queue? drop? depends on the app.
  }
}
```

That's the *minimum*. No room-membership state. No backpressure. No proper reconnect-with-exponential-backoff. No sync of shared state across rooms. No type-safety across the wire. The shape `ChatMsg` is declared on the client; the server has its own idea about what arrives. If you change either side and forget to update the other, nothing fails until production traffic hits it.

Now repeat the exercise for a Web Worker. `new Worker("./worker.js")`. `postMessage(data)`. `self.onmessage = (e) => { ... }`. A separate file, a separate build config so the bundler emits the worker as its own chunk, types lost across the boundary, no shared schema. Workers are isolated by design, which is good. They are also wired by hand, which is not good.

This is the seam. Two seams, actually. The wire between client and server, and the wire between the main thread and the worker. Most frameworks do not own either side of either of them.

## The same feature in scrml

```scrml
<channel name="chat" topic="lobby" reconnect="2000">
  <messages> = []

  server function postMessage(author, body) {
    @messages = [...@messages, { author, body, ts: Date.now() }]
  }
</>

<program>
<ul>
  ${ for (let m of @messages) {
    lift <li>
      <span class="author">${m.author}</span>
      <span class="body">${m.body}</span>
    </li>
  } }
</ul>
</program>
```

That is the entire feature. Both halves of the wire.

What the compiler did with `<channel>`:

1. Generated a server-side WebSocket upgrade route at `/_scrml_ws/chat` (§38.8).
2. Generated a client-side connection IIFE that opens the WebSocket, dispatches messages, registers cleanup, and reconnects on close after 2000ms (§38.7). The `reconnect=` attribute is a number, not a library import.
3. Took every reactive cell declared inside the channel body (`<messages> = []`) and wired it to a sync protocol. On every local write, the compiler emits a sync message; on every receive, it applies the inverse. The wire format is fixed by the spec (§38.4): `{ __type: "__sync", __key: "<varName>", __val: <value> }`. **The `@shared` modifier from older scrml drafts has been removed** (L4 lock + E-CHANNEL-SHARED-MODIFIER) — auto-sync follows from being declared inside the channel body, not from a marker.
4. Routed the pub/sub through the channel's `topic=`, defaulting to the channel name. Two clients with the same `topic="room-42"` see each other's writes; clients with different topics do not (§38.3, §38.6.2).
5. Made `broadcast(data)` and `disconnect()` available inside any `server function` declared in the channel's lexical scope (§38.6). Outside that scope, calling them is a compile error, E-CHANNEL-004.

That's it. No `new WebSocket()`. No reconnect timer. No `JSON.stringify`/`JSON.parse` for the sync protocol. No room-to-socket-set map on the server. No "Socket.IO vs ws" choice to make.

The `<channel>` declaration lives **at file level** (sibling of `<program>`, never inside it) — `E-CHANNEL-INSIDE-PROGRAM` if you try to nest it. From `<program>` and other file-level scopes, the channel's cells are reachable by their canonical `@cellName` access (so the `${ for (let m of @messages) ... }` loop above just reads `@messages` directly).

For workers, the shape is the same. The thing-that-runs-elsewhere is declared right next to the thing-that-uses-it.

```scrml
<program name="primes">
  ${
    function sieve(limit) {
      const flags = Array(limit + 1).fill(true)
      flags[0] = false
      flags[1] = false
      for (let i = 2; i * i <= limit; i++) {
        if (flags[i]) {
          for (let j = i * i; j <= limit; j += i) {
            flags[j] = false
          }
        }
      }
      const primes = []
      for (let i = 2; i <= limit; i++) {
        if (flags[i]) {
          primes.push(i)
        }
      }
      return primes
    }

    when message(data) {
      send({ primes: sieve(data.limit), limit: data.limit })
    }
  }
</>

${
  <result> = not

  function findPrimes() {
    <#primes>.send({ limit: @limit })
  }

  when message from <#primes> (data) {
    @result = data
  }
}
```

What the compiler did with the nested `<program>`:

1. Treated the inner `<program name="primes">` as a separate compilation unit (§43.3). No parent-scope bindings leak in. A reference to a parent-scope name is compile error E-PROG-003.
2. Compiled it to a self-contained Web Worker bundle (§4.12.4, §43.2). The compiler emits `new Worker()` and the corresponding bundle on the build side; the developer does not write either.
3. Rewrote `send(data)` inside the worker body to `self.postMessage(data)` automatically. Rewrote `<#primes>.send(data)` in the parent body to a parent-side post.
4. Wired `when message(data) { ... }` inside the worker as `self.onmessage` (§4.12.4). Wired `when message from <#primes> (data) { ... }` in the parent as the worker's `onmessage` (§46.2, §46.6). Same `when ... from <#name>` shape works for `error` and `terminate` lifecycle events on the parent side.

No worker-loader plugin. No separate `.worker.ts` file. No build config for "split this into its own chunk and emit it as a worker entry point." The colocation is the compiler's job.

## What unifies them

Both `<channel>` and nested `<program>` are the same idea applied to two different boundaries.

> The thing-that-runs-elsewhere is declared right next to the thing-that-uses-it. The compiler wires the seam.

That is what colocation of behavior means in practice. Realtime and off-thread compute are not "advanced features that need an extra library." They are places where the program crosses a boundary. The boundary is part of the program. The compiler should know.

## What this kills

- **`new WebSocket()` boilerplate.** Connection lifecycle, reconnect, message dispatch, topic routing. All compiler-emitted.
- **Socket.IO and ws on the dependency list.** Both sides of the wire are owned by one compiler.
- **Pub/sub libraries.** The `topic=` attribute is the routing primitive. Declaration inside the channel body IS the sync primitive — no marker required.
- **`new Worker()` plus `postMessage` plus `onmessage` plumbing.** Worker lifecycle is `<program name="...">`. Communication is `<#name>.send()` and `when message from <#name>`.
- **Worker-loader plugins and bundler config for worker entry points.** The compiler extracts each nested `<program>` as its own compilation unit (§43.3) and emits its own bundle. The build system does not need to know workers exist.
- **Type drift across the wire.** Shapes used in the channel body, on either side of the post, are the same shapes. They do not get redeclared.
- **Most of the "realtime is a special case" cognitive overhead.** It stops being a special case.

## What is still real

`<channel>` is the 90% case. The other 10% is real and unchanged.

- **Custom binary frames, non-JSON wire protocols, or message-passing patterns beyond pub/sub.** A `<channel>` element is a pub/sub WebSocket; the wire format is fixed by the spec (§38.4). If you need a custom binary protocol, a `<program db=...>`-style scoped compute boundary, or anything beyond what `<channel>` offers, the escape hatch is a regular `server function` plus a spec-compliant ws library called from inside it. The 90% is in the language; the 10% is in the stdlib or vendored.
- **Auth on the upgrade.** The `protect=` attribute on `<channel>` maps to a session-cookie check at upgrade time (§38.5). Beyond that, application-specific authorization (which rooms can this user join?) is still your business logic. It lives inside the `onserver:open` or the server function that posts to the topic. It benefits from running on the server, where the data lives.
- **Worker code that needs more than message-passing.** Web Workers are isolated by design. If your computation needs streaming partial results (`@price = <#worker>.stream(...)` style), the spec lists that as an open question (§46.5). Currently you wire it as repeated `send()` calls plus `when message from`. The event-hook model is the normative shape.

**Honest scope note on nested `<program>`.** The spec describes four execution-context types for nested programs: Web Worker, foreign-language sidecar, WASM module, and database-scoped (§43.2). The Web Worker target is what ships in the current compiler. Sidecar (`lang=`), WASM (`mode="wasm"`), and the supervision attributes (`restart=`, `max-restarts=`, `within=`) are spec-defined but not yet implemented in codegen. This article shows what works today; the broader compile-target story is a roadmap, not a today-claim.

The line between "plumbing the framework forced you to write" and "actual business logic" gets a lot brighter when one side of it is gone. Both sides, in this case.

## The deeper claim

A reactive system that wires its dependencies at compile time does no work at runtime to figure out what to update. A WebSocket whose connection lifecycle, reconnect, and topic routing are compiler-emitted does not need a runtime library to manage them. A worker whose message wiring is `when message from <#name>` does not need a postMessage protocol you maintain by hand.

The runtime does less because the compiler did more. The seams between client and server, and between main thread and worker, stop being places where bugs live and start being places where the type system has the most leverage. The realtime tier of the dependency list collapses into the language. So does the workers tier. A little short of perfect is still pretty awesome.

## Further reading

- [Why programming for the browser needs a different kind of language](https://dev.to/bryan_maclee/why-programming-for-the-browser-needs-a-different-kind-of-language-6m2). The high-altitude six-feature overview that this piece zooms in on.
- [The server boundary disappears](https://dev.to/bryan_maclee/the-server-boundary-disappears-hap). The companion piece on `server fn`. Server-side handlers in `<channel>` follow the same partition rules.
- [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-2247). The package-list-collapses argument; Socket.IO is one of the named "replaced by language" entries.
- [What scrml's LSP can do that no other LSP can, and why giti follows from the same principle](https://dev.to/bryan_maclee/what-scrmls-lsp-can-do-that-no-other-lsp-can-and-why-giti-follows-from-the-same-principle-4899). Vertical integration is what makes channel-level type-safety across the wire possible.
- [Introducing scrml: a single-file, full-stack reactive web language](https://dev.to/bryan_maclee/introducing-scrml-a-single-file-full-stack-reactive-web-language-9dp). The starting-point overview if you haven't seen scrml before.
- [Null was a billion-dollar mistake. Falsy was the second.](https://dev.to/bryan_maclee/null-was-a-billion-dollar-mistake-falsy-was-the-second-3o61). On `not`, presence as a type-system question, and why scrml refuses to inherit JavaScript's truthiness rules.
- [Retraction — scrml's Living Compiler](./living-compiler-retraction-devto-2026-05-21.md). The "scrml's Living Compiler" article has been retracted; scrml chose a sealed, deterministic build-story model instead.
- **scrml on GitHub:** [github.com/bryanmaclee/scrmlTS](https://github.com/bryanmaclee/scrmlTS). The working compiler, examples (see `examples/13-worker.scrml` and `examples/15-channel-chat.scrml`), spec §38 and §43, benchmarks.
