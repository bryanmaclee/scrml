# SCOPE — `<endpoint>` typed-inbound endpoint primitive (a+b, `<endpoint>`-first)

**Ratified S219 (2026-06-25).** Reopen of dpa-002 (`serve-side-raw-route`); DD `scrml-support/docs/deep-dives/raw-route-primitive-reopen-2026-06-25.md`. User ratified **a+b as a typed-default + raw-escape PAIR**, **`<endpoint>` first** (the witnessed flogence need is typed; `raw` deferred to a witnessed untypeable case; `handle()` covers the interim raw escape). Scope confirmed **general typed-inbound endpoint** (no shape debate).

## The primitive (design — ratified)
`<endpoint>` is the typed INBOUND edge — the mirror of §60 `<api>` (typed OUTBOUND). A foreign client calls a scrml-served route; the compiler owns the decode + exhaustive dispatch + the JSON envelope; the author fills per-variant arms.

```scrml
${ type FspMethod:enum = { FleetStatus, Dispatch(prompt: string, project: string), DeltaSince(seq: int) } }

<endpoint path="/fsp" method="POST" accepts=FspMethod>
    <FleetStatus : fleetStatus()>
    <Dispatch prompt proj : dispatch(prompt, proj)>
    <DeltaSince seq : deltasSince(seq)>
</endpoint>
```

**Semantics (the honesty guarantee = why it's a sharp primitive, not god-ification):**
- `accepts=<EnumType>` — the inbound request body decodes into the enum (reuse `parseVariant` §41.13 over the request JSON). A malformed/unknown variant → a structured error response (the compiler owns the envelope; default JSON-RPC-shaped or a general typed-error).
- Arms = the per-variant handlers, **exhaustive against `accepts=`** (reuse `<match for=>` / §18.0.1 exhaustiveness → `E-ENDPOINT-NOT-EXHAUSTIVE`). Add a variant without an arm → **compile error** (this is the load-bearing honesty the DD found on the INBOUND edge — scrml owns this codec).
- Arm body = a value-return (the typed result); the compiler envelopes it as JSON.
- **client-codegen SKIP** — foreign clients have their own SDKs; emit the SERVER handler only (simpler than a data-layer route, no paired fetch-stub).
- `method=` (GET/POST/…) + `path=` (author-stable URL). Auth: JSON+bearer is CSRF-exempt by construction (dpa-002 — drop the `csrf` strawman); a bearer/header check is author-in-arm or a future first-class mode.
- **NOT a JSON-RPC dispatcher** (no framework ships that) — `<endpoint>` is a general typed-inbound endpoint; JSON-RPC is a convention you express via the enum + result shape.

**Relationship map:** `<api>` §60 (typed outbound) ⇄ `<endpoint>` (typed inbound) · `server function* route=` §37 (the SSE leg — ALREADY LANDED escalation-2 `f5f15009`) · `handle()` §40 (global middleware raw escape — stays) · `raw` server-fn (a) DEFERRED (the path-bound raw escape; build on witnessed untypeable need).

## Decomposition (waves — mirrors the §60 `<api>` A2 build template)
- **W0 — design-ratify.** ✅ DONE (this SCOPE).
- **W1 — SPEC §-author.** NEW SPEC section (next free top-level §, e.g. §61 "Typed Inbound Endpoint `<endpoint>`") — Nominal/spec-ahead first (like §60 was): element grammar, `path=`/`method=`/`accepts=` attrs, the arm form + exhaustiveness, the decode (parseVariant reuse), the envelope, client-skip, the `<api>`-symmetry, error codes (`E-ENDPOINT-*` — land WITH impl per Rule 4). + §4.15/§24.4 structural-element registry rows. **PA/dPA-led** (design-adjacent; SPEC normative).
- **W2 — parser.** `ast-builder.js` + native-parser: recognize `<endpoint>` structural element; parse `path=`/`method=`/`accepts=` + the arms (REUSE `<match for=>` arm parsing + §51.0.B.1 payload binding). Native-parser mirror per S162 conditional.
- **W3 — typer.** `type-system.ts`/`symbol-table.ts`: resolve `accepts=` to the enum; exhaustiveness check (REUSE §18.0.1/§51 machinery → `E-ENDPOINT-NOT-EXHAUSTIVE`); arm payload-type binding; the typed result.
- **W4 — codegen.** `emit-server.ts`: the route-handler branch (the DD: net-new is small — beside the SSE/JSON-RPC bifurcation) — decode (parseVariant over the body) → dispatch via the arms (REUSE `emit-variant-guard`) → envelope as JSON → the `Response`; register at `path=`/`method=`; route-inference "explicit endpoint ⇒ emit handler, skip data-layer ser/deser + CSRF gate." Client-codegen SKIP.
- **W5 — tests + example + conformance.** Unit (parser/typer/exhaustiveness) + integration (emit-server) + an `examples/NN-endpoint` + R26 + the flogence conformance target (re-host the 11-assertion `fsp-wire-smoke` against the scrml-served `/fsp`).

## Batch into spa (the user directive)
- **W1 (SPEC)** → PA-led (design-adjacent) — author the §-section first (Nominal), like §60.
- **W2–W5 (impl)** → an sPA list **`ss18-endpoint-primitive`** (sequential waves as ordered items; shared ingestion = `ast-builder.js` + `emit-server.ts` + `type-system.ts` + the `<match>`/`emit-variant-guard` reuse + route-inference). Fire AFTER W1 lands (the impl needs the spec).
- **`raw` (a) DEFERRED** — a separate future item, gated on a witnessed untypeable-raw need; `handle()` is the interim raw escape.

## Conformance bar
flogence's `scripts/fsp-wire-smoke.ts` (11 assertions: 8 FSP methods over JSON-RPC + terminal-state error + SSE replay-from-0 + SSE resume-from-cursor), re-hosted against the scrml-served endpoints. flogence retires `scripts/fsp-wire.ts` as the production transport on landing.
