# DD BRIEF — scrml as a front-end for an external (non-scrml) backend

**Dispatched S209 (2026-06-20), user "DD it".** Agent: `scrml-deep-dive`, no-worktree pure research
(read-only on scrml; WebSearch prior art; writes the DD doc to scrml-support). Output →
`scrml-support/docs/deep-dives/external-backend-frontend-only-2026-06-20.md`.

## THE QUESTION (scope-lock)

A team has an existing backend in Rust / Go / Elixir / etc. and wants to keep it, using scrml ONLY
for the front-end (talking to that external backend over HTTP/WS). **Should scrml have a first-class
"bring-your-own-backend" story — and if so, what is the design?** Or does courting that segment
dilute the flagship and the answer is "stay laser-on full-stack"?

**In scope:** the adoption case; the design space for a first-class external-backend path; the
philosophy fit (does it contradict scrml's identity?); prior art. **Out of scope:** implementing
anything; re-litigating the full-stack model itself; scrml's own server (§12/§52) internals.

## CONVERGED CORE — verified this session, DO NOT re-derive (PA-established, cite as given)

The PA already established the CURRENT capability against SPEC + §12.2 (S209, 2026-06-20):

1. **It is already POSSIBLE today, as a client-only reactive framework.** scrml only generates its
   own Bun server for functions touching a **server-only resource** — the §12.2 triggers (`?{}` SQL,
   `Bun.*`, file I/O, env, server-only stdlib import, channel broadcast/disconnect, reserved
   `handle()`). A raw browser `fetch("https://external-api/...")` is **none of those**, so a function
   doing it stays **client-side** and scrml emits a **pure client bundle (no `.server.js`)**.
2. **The primitives that make it work:** SPA mode (§40.8.1 — entry `<program>`, no `<page>`, no
   server content → client-only); `<request>` (§6.7.7, one-shot async, first-class
   `loading`/`data`/`error`/`stale`); `<poll>` (§6.7.6, periodic); body is `${ @data = fetchExpr }`
   where `fetchExpr` calls a client fn doing raw `fetch()` to the external API. Real-time = raw
   `WebSocket`/`EventSource` in client logic (scrml's `<channel>` §38 is *its own* WS/SSE server,
   so it does NOT serve an external backend).
3. **What's KEPT:** reactive model, markup-as-value, engines/state-machines, typed state, components,
   the `<request>`/`<poll>` async-state ergonomics. A legitimately good front-end framework.
4. **What's GIVEN UP — the flagship:** the disappearing server boundary. `?{}` co-location, route
   inference (§12), §52 server-authority, SSR-prerender are ALL scrml's own server → unused with an
   external backend. You use scrml as "reactive UI + typed fetch," not "full-stack in one language."
5. **Current friction (the gap):** NO first-class external-API primitive — there's `<db>` for
   scrml's SQL but nothing like `<api src=...>` that **types/binds external HTTP the way `<db>` types
   SQL**; you hand-write `fetch` + the response shape. The corpus/docs/examples showcase only the
   full-stack `?{}` model → the client-only-with-external-backend path is possible-but-undocumented.
   CORS / auth-token handling is on the developer (boundary is outside scrml — no compiler help).

Related existing surfaces to consult (don't re-survey from scratch): §21 `import:host` (vanilla JS
import), §29 Vanilla File Interop (Nominal/spec-ahead), §12.2 triggers, §52 server-authority,
`--mode library` (§21.5), §38 channel.

## THE DD's WORK (the open questions)

1. **Adoption case.** How load-bearing is the bring-your-own-backend segment for scrml's
   beta→v1 trajectory? Most teams already have a backend; "rewrite your backend in scrml too" is a
   high bar. Is frontend-only-with-external-backend the on-ramp that converts teams (who *later*
   migrate the backend into scrml), or a distraction from the full-stack pitch? Quantify the segment
   honestly; weigh against scrml's stated ambition ("the future of how programming is done for the
   browser" — note: BROWSER, which arguably *centers* the front-end).
2. **The design fork** (the centerpiece — produce a trade-off matrix):
   - **(a) First-class `<api>` external-endpoint primitive** — types external HTTP (request +
     response shape) and binds to `<request>`/`<poll>`, analog to `<db>` for SQL. What shape?
     OpenAPI/schema-driven typed-client codegen? A `<api src="openapi.json">` that generates typed
     callable bindings? How does it bind to the reactive `<request>` model? Does it give CORS/auth
     ergonomics (typed headers, base-URL config)?
   - **(b) Docs-only** — the path already works via raw fetch; just DOCUMENT client-only mode +
     ship an examples/recipe + a kickstarter section. Cheapest; no new surface.
   - **(c) Stay-laser-full-stack** — don't court the segment; the flagship IS the disappearing
     boundary; an external-backend story dilutes the pitch and the maintenance surface.
   - **(d) Hybrid** — docs now (b), `<api>` primitive later (a) gated on adopter signal.
3. **The PHILOSOPHY tension (load-bearing — frame it explicitly).** scrml's identity is the
   *disappearing* server boundary. A first-class external-API primitive deliberately RE-INTRODUCES a
   boundary (the external HTTP edge). Is that a contradiction of the philosophy, or a pragmatic
   on-ramp? Frame the **on-ramp-vs-dilution axis** and where each fork lands on it. (Cross-ref the
   co-location-of-behaviour axiom — does an `<api>` primitive that co-locates the external-endpoint
   contract with its use SATISFY co-location, or is it a foreign boundary scrml shouldn't own?)
4. **SSR + external data.** Can scrml SSR-prerender data fetched from an EXTERNAL backend, or is
   SSR-prerender (§52.8) structurally scrml-server-only? This is a real first-paint/SEO question for
   the frontend-only path — establish whether it's possible, gapped, or out-of-model.
5. **Prior art (table).** How peers handle "front-end framework + external backend": TanStack/React
   Query (the `<request>`/`<poll>` analog), tRPC (typed RPC, but same-language), Relay/Apollo +
   GraphQL (typed external schema), OpenAPI/Swagger typed-client codegen, HTMX/hypermedia
   (server-agnostic), Elm ports + HTTP, Svelte `load`, Phoenix LiveView's stance (full-stack-only,
   like scrml today). Surface the typed-external-API state of the art + what scrml could borrow.

## OUTPUT + FEED-TO-DEBATE

`scrml-support/docs/deep-dives/external-backend-frontend-only-2026-06-20.md` (status: current):
approaches (a)-(d) + trade-off matrix + prior-art table + the on-ramp-vs-dilution framing + a
HIGH/MED/LOW-confidence recommendation. **If (a) `<api>`-primitive vs (b) docs-only vs (c)
stay-full-stack has rival viable approaches, recommend a debate** (candidate poles: a typed-RPC /
OpenAPI-codegen expert · an HTMX/hypermedia server-agnostic expert · a scrml-full-stack-purist
defending the disappearing-boundary identity). Pure research — no compiler source, no worktree.
Maps not load-bearing (design/strategy DD). Note any claim you couldn't verify against live SPEC.
