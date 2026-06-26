# ss34 — endpoint + SSR / server-render (SURVEY-FIRST)

**Fill-note:** the emit-server / endpoint / SSR cluster — the old ss24/ss26 surface. **HOLD lifted S222** (it was held while W3/splitter ran; W3-codegen is now verified-built). **SURVEY-FIRST** — the SSR items (§52.8 read-authority residual) are a bigger design surface; scope before building. Item 4 is design-laden (Bucket-B flag, not buildable here).

**Shared ingestion:** `emit-server.ts` + endpoint codegen + the §52 SSR/render-authority path + rendermap server-classification. These share the server-emit + render-authority surface → SEQUENTIAL.

**coreFiles:** `compiler/src/codegen/emit-server.ts` · endpoint arm codegen · the §52.8 SSR prerender path · rendermap / render-authority classifier · SPEC §52 / §61.

**Brief reminders:** §61 `<endpoint>` is Nominal-spec-ahead (W2-W5 partly landed S219-220); verify the live §61 surface before touching. §52.8 SSR — read the SPEC section IN FULL (Rule 4) before scoping. R26 + adversarial (S215) on any codegen change.

## Items

1. **g-endpoint-multi-statement-arm-invalid-js** (MED) `[status=open]`
   - Symptom: a multi-statement bare-body `<endpoint>` arm emits invalid JS, caught only by the generic `E-CODEGEN-INVALID-JS` (no clean endpoint diagnostic). ss18-W4 build-surfaced.
   - Footprint: endpoint arm codegen — lower multi-statement bodies correctly (mirror the §18.0.1 / §51.0.B.1 arm-body lowering) + add a clean `E-ENDPOINT-*` diagnostic.

2. **g-tier1-ssr-prerender** (MED, **survey-first**) `[status=open]`
   - Symptom: Tier-1 `authority="server"` instances load client-side on mount, not SSR pre-rendered (§52.8). The read-authority SSR residual.
   - **STOP-first:** read SPEC §52.8 in full + scope the SSR prerender path before building. This may be a larger wave than a single fix.

3. **g-rendermap-needs-server-classification** (LOW) `[status=open]`
   - Symptom: full-stack apps throw at the no-data / empty client mount instead of degrading to a loading/empty state (G-FULLSTACK-EMPTY-MOUNT-THROWS); the rendermap needs server-classification to know an instance is server-authoritative.
   - Footprint: rendermap server-classification (couples to item 2's render-authority work — sequence after).

4. **g-sse-server-keyword** (LOW, **design-laden → Bucket-B flag**) `[status=open]`
   - Should the deprecated `server` keyword drop from SSE `server function*` too? DEFERRED to its own DD (user-ruled). NOT buildable here — listed so it's not lost; route to a DD if fired.
