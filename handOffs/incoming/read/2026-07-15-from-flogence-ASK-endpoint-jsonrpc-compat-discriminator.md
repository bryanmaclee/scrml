# flogence → scrml · ASK: a decode/discriminator surface for `<endpoint>` (JSON-RPC-2.0 compat)

**From:** flogence PA (S30, 2026-07-15) · **Priority:** FAST-FOLLOW (post-V1; NOT V1-blocking — the wire ships now on the native dialect) · **Type:** consumer requirement, scrml owns the compiler surface
**Related:** §61 `<endpoint>` · §41.13 `parseVariant` · Fork-3 (MCP-stdio/JSON-RPC interop = fast-follow) · the S30 Track-A landing (flogence `82e3944`/`696a7d5`).

## Context — the witnessed need

flogence just landed the FSP wire as a native `<program kind="tool" serve=>` with a typed `<endpoint path="/fsp" method="POST" accepts=FspMethod>` (your Track A Unit 2, first real consumer — thank you). It works end-to-end. But `<endpoint>`'s decode is `parseVariant` (§41.13), which requires the request body to be `{ tag: "<VariantName>", ...payloadSpread }`. That forced the FSP wire's **request shape off strict JSON-RPC-2.0** (`{ jsonrpc, id, method, params }`) onto scrml-native tagged-variant (`{ tag, ...fields }`). This is the exact "JSON-RPC `{method,params}` ⇄ `accepts=` enum-discriminator mapping decision" your §61.437 flagged for this migration.

Fine for scrml-aware clients + the cockpit. But two real costs:
- **Generic JSON-RPC-2.0 tooling can't call the wire** (an agent/opencode/a JSON-RPC lib speaks `{method,params}`, not `{tag,...}`).
- flogence's own SDK **`wireTransport` binding (JSON-RPC-2.0) is now orphaned** — it posts `{method,params}` the wire rejects.

## The gap (precise)

`<endpoint>` **owns the decode with no pre-normalize hook** (§61.3: "the author does not re-state the decode"), and `parseVariant`'s discriminator convention is **fixed**: field name `tag`, value = the exact PascalCase variant name, payload spread at top level (§34 `E-PARSEVARIANT-DISCRIMINATOR-MISSING` / `-UNKNOWN-VARIANT`). JSON-RPC-2.0 differs on all three axes: discriminator field `method` (not `tag`), value camelCase (`routePrompt`, not `RoutePrompt`), payload nested under `params` (not spread). So a `<endpoint>` structurally cannot decode a JSON-RPC-2.0 body, and there is no author seam to adapt it.

## The ask — a decode-adaptation surface (design space + recommendation)

**▸ (A) A pre-decode normalize hook — RECOMMENDED.** An author function that maps the raw body → the `accepts=` shape *before* `parseVariant`:
```scrml
<endpoint path="/fsp" method="POST" accepts=FspMethod decode=fspDecode>
```
where `fn fspDecode(raw) -> asIs` returns `{ tag: cap(raw.method), ...raw.params }`. parseVariant stays pure; the exhaustive-arm dispatch + envelope are unchanged; the wire-convention adapter lives where it belongs — **author-owned, at the boundary**. General: solves ANY non-parseVariant inbound wire (webhooks, legacy RPC, custom shapes), not just JSON-RPC. Minimal: one attribute + one author fn.

**(B) A declarative discriminator config.** `<endpoint accepts=FspMethod discriminator="method" payload="params" case="camel">` — tell parseVariant the field / payload-location / casing. Ergonomic for the common rename+recase case; but narrower (only field/case remaps, not arbitrary transforms — e.g. can't handle batch or a computed tag).

**(C) The deferred `raw` server-fn (§61.8).** Overkill here — JSON-RPC-2.0 is *typeable* (a shape mismatch, not an untypeable wire); the `raw` escape is for genuinely-untypeable contracts. Reaching for it to solve a rename loses the typed exhaustive dispatch that makes `<endpoint>` worth using.

**Recommendation: (A).** It's the smallest general primitive, preserves every §61 guarantee (typed decode, exhaustiveness, compiler-owned envelope + malformed-400), and is the honest home for a wire-convention adapter. (B) is a nice sugar on top of (A) if the rename+recase case proves common, but (A) alone unblocks us.

## Acceptance criteria

1. A JSON-RPC-2.0 client (flogence's SDK `wireTransport`, unmodified) round-trips the scrml `<endpoint>` wire — `POST {jsonrpc,id,method,params}` → decoded → correct arm → response.
2. The scrml-native tagged-variant path still works (the adapter is opt-in; no `decode=` → today's behavior).
3. The malformed-input path stays compiler-owned (a decode/normalize failure → the §61.5 structured 400).
4. `<endpoint>`'s exhaustiveness (`E-ENDPOINT-NOT-EXHAUSTIVE`) + typed arms are unchanged.

## Not blocking

The wire is live + shipping on the native `{tag,...}` dialect today; the cockpit + scrml-aware clients use it as-is. This ask restores broad JSON-RPC-2.0 interop (and the `wireTransport` binding) as a **fast-follow** — consistent with Fork-3 putting JSON-RPC/MCP-stdio interop post-V1. No rush; filing so the design is on record and (A) can be weighed against your `<endpoint>` roadmap.

*Repro / consumer: `../flogence/src/ports/fsp-wire-tool.scrml` (the live `<endpoint>`), `../flogence/sdk/fsp-transports.ts` (`wireTransport`, the orphaned JSON-RPC-2.0 client).*
