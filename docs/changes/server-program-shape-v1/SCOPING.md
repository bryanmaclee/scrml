# Track A — server-program-shape V1 (SCOPING)

**Arc:** the listener-owning `<program kind="tool" serve=>` that hosts native `<endpoint>`/SSE off the
web-app pipeline. The #1 flogence tandem-release gate (unblocks its FSP wire — the last 3 `.ts` files —
and the 100%-scrml claim).

**Status:** scoped S255 (2026-07-14), bryan "go". EXECUTION-scoping of a RULED design — not a fresh DD.
**Authority (design):** `../scrml-support/docs/deep-dives/server-program-shape-2026-07-12.md` (RUN-not-RATIFY).
**Plan-of-record:** `../scrml-support/docs/pre-v1-execution-board-2026-07-12.md` (Track A row).

## Ruled state (nothing to re-litigate)
- **Fork 1 = 1A** (ruled S251) — extend `kind="tool"` with a `serve=` listener hosting native `<endpoint>`/SSE; compiler emits the `Bun.serve` harness (replaces the `_{}` punt). **main-optional** (S255 lean, bryan "go") — the `serve=` + mounted routes ARE the §64.3 active handle; a no-op `main` is not required.
- **Forks 2/4/5/6 = DD defaults** (taken S251) — **2A** decouple endpoint/SSE emit from the web-app pipeline · **4A** `accepts=E via method params=` + `wire-tags={}` discriminator remap · **5A** `route.header()`+`route.frameId` · **6C-then-6A** (bearer via `handle()` now; `<guard>` arm follow-up).
- **Fork 3 (stdio) = FAST-FOLLOW / post-V1** (ruled S255 via flogence inbox). OUT of V1 scope.

## Verified pre-conditions (S255, against code/git — not the DD's currency)
- **Coordination gate CLEARED** — the S250 navigate/`<outlet>` wave LANDED (`merge #27` Wave-1b, S251-reviewed; Waves 2-3 parked). No live competitor for `emit-server.ts`. Track A is a clean SERIAL lineup.
- **Reused primitives BUILT** — §61 `<endpoint>` (impl S219), §37 SSE `route=` (S216), §64 `kind="tool"` (`emit-tool.ts` + `tool-program.ts` + `standalone-tool-target.test.js`; the SPEC-INDEX "impl next" note was stale).
- **The lift is located** — `emit-server.ts` already carries a `mode:"browser"|"library"` axis + a `generateValueOnlyServerJs` no-web-app precedent = the seam Fork 2A extends. Endpoint emit: `collectEndpointDecls`/`emitEndpointServerHelperLines`/`parseArmBindings`; `fetch` assembly ~L3595.

## Dispatch decomposition (SERIAL — all touch emit-server.ts; the canonical scrml-js-codegen-engineer)
| Unit | What | Primary fire-sites | Size | Deps |
|---|---|---|---|---|
| **1 — Fork 2A decouple** | Make endpoint/SSE route-handler + `fetch`-assembly emit PROGRAM-SHAPE-AGNOSTIC (off html/client/CSRF). Byte-identical web-app output = the regression gate; a headless-shape path unit-tested to omit the web-app scaffold. NO new authored surface. | `emit-server.ts` (mode axis; route-handler + fetch extraction) | MED-L | — |
| **2 — Fork 1A serve-harness** | `kind="tool" serve=PORT [cors=]` emits `Bun.serve({port,fetch})` mounting Unit-1 routes; main-optional; strike §64.1 no-route-emission for serve= tools. | `emit-tool.ts` · `attribute-registry.js` · `ast-builder.js` · `type-system.ts` · SPEC §64 · §34 codes | MED | 1 |
| **3 — Fork 5A frame access** | `route.header(name)` + `route.frameId` on the route binding. | route binding/runtime + endpoint/SSE codegen | S-M | 1 |
| **4 — Fork 4A discriminator remap** | `accepts=E via method params=` + `wire-tags={}`. | endpoint parser + `parseVariant` discriminator param + dispatch | MED | 3 |
| **5 — H4 + H1** | GET-discovery (no-`accepts=` value-return arm) + notification-204 (no-`id`→204). | endpoint emit | S | 1 |
| **6 — Fork 6A `<guard>` arm** | pre-dispatch bearer gate (6C `handle()` is the interim — works today, no build). | endpoint grammar + pipeline position | S-M | 3 |

## DoD / merge-blocker
flogence `fsp-wire-smoke` (11 assertions: 8 JSON-RPC methods + terminal-error + SSE-replay-from-0 + SSE-resume-from-cursor) re-hosted against the scrml-native server, pinned by a **conformance case**. The SSE **live-tail** (H2 — non-busy server-generator timer) is NOT in the 11-assertion bar (backfill+resume only) → deferred as a post-bar refinement, off the critical path.

## Naming guard
NEVER "server shell" / "persistent shell" (aliases navigate's §20.8 SPA client shell). It is the
"listener-owning `kind="tool" serve=` program" / "headless serve-target."

## Open sub-decisions (tracked)
- H2 SSE live-tail timer (server-generator non-busy wait) — post-bar; needs a micro-ruling if/when the live-tail is built.
- §34 codes for serve= tool (E-TOOL-SERVE-* / E-ENDPOINT-TRANSPORT-*) land WITH impl per Rule 4.
