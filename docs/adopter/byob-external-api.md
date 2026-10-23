# Bring-your-own-backend — typing a foreign API with `<api>`

**Status:** Implemented in scrml v0.next (A2 — the thin declared-shape `<api>` primitive; parser + type-system + codegen landed; worked example `examples/32-external-api.scrml`). Normative spec: [SPEC §60](../../compiler/SPEC.md). A1 (OpenAPI / contract ingest) is a separate, deferred arc (§60.8) — not in this guide.

`<api>` is for the **bring-your-own-backend (BYOB)** case: you are building a scrml front end over an **existing foreign backend** — a Rust / Go / Python / Node / vendor service that scrml does **not** own and cannot change. It types that external HTTP boundary, and only that boundary.

If scrml owns *both* ends of your data — you write the schema and the queries — you do **not** want `<api>`. Use the owned-data story (`<db>` + `?{}` + `<schema>`, §8 / §39); there scrml controls the boundary end-to-end and the "no API layer to drift out of sync" promise actually holds. See "When NOT to use `<api>`" below.

---

## The identity reframe — why type a boundary you don't own?

scrml's pitch is "no API layer to drift out of sync." That holds where scrml owns both ends. BYOB is precisely the case where it does **not**: the foreign backend has *already* built its API layer. So the real choice for a BYOB adopter is not "API layer or none" — it is:

- **Untyped, silent drift** — you call the foreign backend with raw `fetch()` + hand-rolled URL strings. When the backend changes a field, a method, or a path, nothing complains at build time; your app breaks at runtime, in production, on the field you forgot existed.
- **Typed, loud drift** — you declare the endpoint's request/response shapes in `<api>`. A backend shape change becomes a **compile-time mismatch** against the declared shape (and, at runtime, a `parseVariant` decode failure routed to `.error`). The drift is loud and early instead of silent and late.

`<api>` is the identity's own value (boundary-typing) applied to the one boundary scrml otherwise ships naked.

---

## The BYOB path — `<api>` + `<request api=>` + a variant `ResponseT`

A complete, pure-client `<api>` app (see `examples/32-external-api.scrml` for the runnable version):

```scrml
<program>

${
  // The request shape — its fields are the source for `${...}` path params.
  type UserQuery:struct = { id: int }

  // A VARIANT (`:enum`) response type. This is what engages the boundary-parse.
  type UserResult:enum = {
    Found(name: string, email: string)
    NotFound
  }

  <query>: UserQuery = { id: 1 }
}

<api base="https://api.example.com">
  getUser(UserQuery) -> GET "/users/${id}" : UserResult
</api>

<request id="profile" api="getUser" args=@query></>

</program>
```

What the compiler does with this:

1. **A thin typed `fetch` callable per endpoint.** `getUser` becomes a client-side `fetch(base + path, { method })` where `base` is the `<api base=>`, `path` is the endpoint's template with `${id}` substituted (URL-encoded) from `@query.id`, and `method` is the declared verb. A body-carrying method (`POST` / `PUT` / `PATCH`) JSON-serializes the `args` value as the request body.
2. **An automatic, visible response decode.** The response is decoded via `parseVariant` (§41.13) against the endpoint's declared `: UserResult` — **automatically**: you do not re-state the decode. A successful decode lands in `<#profile>.data`; a `::ParseError` (a malformed or unexpected response) routes to `<#profile>.error`. The §6.7.7 `loading` / `data` / `error` / `stale` state model applies unchanged.

This is a **pure-client SPA** — no `<db>`, no `<schema>`, no `.server.js` (see "Client-only" below).

### Declare a variant `ResponseT` to get the boundary-parse guarantee

The boundary-parse (§60.5) is what makes an external response *safe* — total, failable, and §53-refinement-enforced. It works because `parseVariant` (§41.13) is a **tagged-variant decoder**: it reads a discriminator and dispatches to the matching variant, validating the payload.

That means the guarantee is **variant-scoped**. If you declare a non-variant `ResponseT` (a bare struct, a primitive, a refinement type), `parseVariant` cannot decode it, and the compiler **raw-passes** the wire body into `.data` — with **no** total/failable decode and **no** §53 enforcement. Because silently trusting an unvalidated external response is exactly the footgun this primitive exists to prevent, the compiler fires the **`W-API-RESPONSE-NOT-VARIANT`** info-lint on a non-variant response type. It is keeping you honest: declare a variant (`:enum`) `ResponseT` to get the §60.5 guarantee, or accept the raw boundary knowingly.

*(A future arc may extend total/failable decode to struct/refinement `ResponseT` via a `parse`-family sibling. Until then, the boundary-parse promise is variant-scoped and the lint marks the gap.)*

---

## You own keeping the declared types in sync — there is no `scrml migrate` for `<api>`

This is the load-bearing difference between `<api>` and `<db>`, and you must internalize it.

A `<db>` / `<schema>` types a boundary scrml **owns**: scrml controls the schema and can reconcile it. When your declared schema drifts from the live database, `bun scrml migrate` brings the database in line, and `W-SCHEMA-003` (§39.12) names exactly that lever.

`<api>` has **no such lever.** scrml cannot migrate a foreign backend — it does not own it. Your declared `<api>` types are a **claim about a foreign contract**, true only as of the moment you wrote them. **Keeping the declared `<api>` types in sync with the foreign backend is your job**, not the compiler's. That *missing* reconciliation lever IS the owned-vs-unowned distinction (§60.3).

Concretely: when the foreign backend changes shape, scrml will not silently paper over it for you and it cannot auto-fix your declaration. What it *will* do is make the drift **loud** — a compile-time mismatch against your declared shape, and a runtime `parseVariant` failure routed to `.error`. An `<api>` contract is an **edit-time snapshot**; treat updating it as part of consuming a foreign API, the same way you would treat re-reading the vendor's changelog.

The element name carries this distinction by itself (F1 = A, §60.3). `<api>` is categorically not `<db>`: the distinct element *is* the type-system-visible signal that the typed boundary is unowned. scrml deliberately does **not** add an `unverified:` / `external:` annotation or a viral "externally-sourced" taint — the element name already says it, and the decode (`parseVariant`) is the proof.

---

## Client-only — no server tier, and the SSR-of-external-data gap

An external `fetch()` to a foreign backend is **not** a §12.2 server-placement trigger, and `<api>` does not introduce one. An `<api>`-backed app compiles to a **pure client bundle**: no scrml server tier, no `.server.js`, no database connection string or secret in the output. The base URL *does* appear in the client bundle — correctly, because it is the public fetch target, not a secret.

**SSR-of-external-data is a structural gap, and it is not closeable in A2 (§60.6).** Server-side rendering of the foreign-backend data — having the *first* HTML response already contain the fetched data — would require a scrml BFF / proxy tier to do the fetch server-side. That re-introduces a scrml server, which contradicts the entire BYOB premise (you brought your own backend precisely so scrml would *not* run a server). So an `<api>` app is **client-rendered with respect to that data**: the page ships, then the client fetches and decodes. If you need true SSR of this data, you need a server in the request path — which means either a scrml-owned data boundary (`<db>`, below) or a BFF you build and run yourself. A2 does not pretend to close this; do not design around it being closeable.

> **Render-surface note (current build).** The §6.7.7 `<#id>.loading` / `.data` / `.error` **markup render bridge** for `<request>` — consuming a request's state directly in markup (`<p if=<#profile>.loading>` or `<match on=<#profile>.data>`) — is not yet wired in the current pipeline (it affects the `url=` mode too, not just `<api>`). The fetch and the `parseVariant` decode are fully wired and run on mount; what is pending is the reactive render-display of the result. Until that bridge lands, treat `<api>` + `<request api=>` as the typed fetch-and-decode surface, and check the build's example for the current render idiom. This is tracked separately from A2.

---

## When NOT to use `<api>` — prefer full-stack scrml where applicable

`<api>` is for keeping an **existing foreign backend** you do not own. It is the right tool exactly when scrml is the front end and something else is the back end.

It is the **wrong** tool when scrml can own both ends:

- **You are building the backend too.** Use `<db src=…>` + `?{}` SQL + `server function` (server placement is inferred — §12). scrml owns the schema, the queries, and the boundary; the disappearing-server-boundary promise holds, the types are a *guarantee* (not a claim), and `bun scrml migrate` reconciles schema drift for you. See `examples/03-contact-book.scrml`, `examples/16-remote-data.scrml`, `examples/23-trucking-dispatch/`.
- **You want server-rendered data.** Owned data is SSR-able; external `<api>` data is not (above). If SSR of the data matters, owning the boundary is the answer.

If you find yourself wishing `<api>` had retry, caching, pagination, request dedup, rate-limiting, or auth-flow orchestration — **stop.** `<api>` is a thin typed callable, deliberately (LIMIT-PRIMITIVES, §60.7). Those concerns stay in userspace: compose them in your own scrml helper (the framework-gives-pieces / app-wires-its-own-client pattern, as TanStack Core / SvelteKit `load` / htmx do). The primitive types the boundary; it does not become a data-fetching framework.

---

## Error codes you will meet

| Code | When | Stream |
|---|---|---|
| `E-API-BASE-MISSING` | an `<api>` block has no `base=` | error |
| `E-API-METHOD-INVALID` | an endpoint method is not `GET`/`POST`/`PUT`/`PATCH`/`DELETE` | error |
| `E-API-RESPONSE-TYPE-UNDECLARED` | an endpoint omits its `: ResponseT` | error |
| `E-API-ENDPOINT-MALFORMED` | an `<api>` body line is neither blank/comment nor a valid endpoint | error |
| `E-API-PATH-PARAM-UNBOUND` | a `${param}` in a path has no matching request-shape field | error |
| `E-API-ENDPOINT-UNKNOWN` | `<request api="X">` names an endpoint no `<api>` declares | error |
| `E-API-REQ-SHAPE-MISMATCH` | the `args` value does not type-check against the endpoint's request shape | error |
| `W-API-RESPONSE-NOT-VARIANT` | a resolved non-variant `ResponseT` (raw-passed, no boundary-parse) | info |

Errors fail the build (exit 1); `W-API-RESPONSE-NOT-VARIANT` is informational (non-fatal). All are catalogued in [SPEC §34](../../compiler/SPEC.md) and cross-referenced from §60.9.

---

## See also

- [SPEC §60](../../compiler/SPEC.md) — the normative `<api>` specification (the owned-vs-unowned distinction §60.3, the `<request api=>` bind §60.4, the `parseVariant` reuse §60.5, client-only §60.6, LIMIT-PRIMITIVES §60.7, A1-deferred §60.8).
- `examples/32-external-api.scrml` — the runnable worked example.
- [SPEC §41.13](../../compiler/SPEC.md) — `parseVariant`, the boundary-parse primitive `<api>` reuses for the response decode.
- [SPEC §8 / §39](../../compiler/SPEC.md) — the owned-data story (`<db>` / `<schema>`) `<api>` is the unowned counterpart to.
