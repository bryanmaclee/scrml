# TASK — Extend the §14.8.9 protect-floor to the channel (§38) + SSE (§37) egress sinks (RATIFIED)

User ratified ("extend the protect-floor to channel/SSE"). The S232 §14.8.9 protect-floor (just landed, `2d5e96c8`) redacts protected-origin columns at the server-fn return + SSR egress sinks, but **channel `broadcast()` + SSE `server function*` are ADDITIONAL compiler-emitted client-egress serializers that currently ship a protected row UNREDACTED** (gap `g-protect-channel-sse-egress-uncovered`). Close the leak by wiring the EXISTING redaction into those 2 sinks.

**SECURITY-CRITICAL — confidentiality code. The bar is the highest (full S215 adversarial).**

**Read first:** `compiler/src/codegen/protect-egress.ts` (the floor's machinery — `_scrml_protect_redact` at line ~188; the descriptor = a `Symbol.for("scrml.protect.origin")` enumerable own-property on SELECT result rows; redact walks the value, drops protected-origin columns unless `reveal`-stamped, recurses arrays/objects, passes `Response` through, and is a **NO-OP on untagged data**) + how the floor wires redact into the server-fn return sink in `emit-server.ts` (search `_scrml_protect_redact`) + the §14.8.9 SPEC section (the scope-bound prose).

**The mechanism — wire the EXISTING `_scrml_protect_redact` into the 2 compiler-emitted sinks** (these are COMPILER-EMITTED ⇒ REDACT, the safe default — same treatment as the server-fn return; do NOT use E-PROTECT-004, which is for raw/FFI/unanalyzable egress the compiler can't redact):
1. **Channel broadcast** — `compiler/src/codegen/emit-server.ts:1135`: `_scrml_srv.publish(${topicExpr}, JSON.stringify(_scrml_data))` → wrap the data: `JSON.stringify(_scrml_protect_redact(_scrml_data))`.
2. **SSE stream** — the `server function*` (§37) SSE sink that emits `_scrml_chunk += \`data: ${JSON.stringify(_scrml_val.data)}\`` (LOCATE it — grep `_scrml_chunk` / `event-stream` / the SSE generator emit path; it was cited at emit-server.ts but confirm the exact line) → wrap the serialized value with `_scrml_protect_redact(...)` before `JSON.stringify`.

**Both sinks are SERVER-side** (broadcast is server-injected in `<channel>` scope §38.6; `server function*` is server-side §37) → the server-only redact applies. **Ensure helper injection covers the new sinks** — `_scrml_protect_redact` is injected into the server bundle on-use (IFF a protect helper is referenced); confirm the channel/SSE redact calls trigger the injection (extend the on-use detection if needed). Same `I-PROTECT-STRIP-001` drain semantics as the existing sinks (name each stripped column).

**SPEC §14.8.9 — extend the normative scope-bound** to include channel `broadcast` (§38) + SSE (§37) egress (the bound was "server-fn return + SSR `/__serverLoad`"; ADD channel/SSE as compiler-emitted sinks treated identically — redact-at-sink). Update the §14.8.9 "Composition" / scope prose. Regen SPEC-INDEX (`bun run scripts/regen-spec-index.ts`). You OWN the §14.8.9 edit (no concurrent SPEC work).

**MANDATORY S215 ADVERSARIAL (security):**
- A protected SELECT row reaching `broadcast(row)` → the protected column is STRIPPED from the published frame.
- A protected SELECT row reaching an SSE `server function*` yield → STRIPPED.
- `reveal("col")`-stamped column at these sinks → admitted (reveal round-trip).
- **Untagged data** → UNCHANGED — no over-redaction.
- `/code-review` at HIGH on the diff.

**Verify:** full `bun run test` — zero regressions. R26. Add channel + SSE protected-egress cases.

**SCOPE:** `compiler/src/codegen/emit-server.ts` + `compiler/src/codegen/protect-egress.ts` + `compiler/SPEC.md` (§14.8.9) + `compiler/SPEC-INDEX.md` (regen) + `compiler/tests/**` + the BRIEF. **Do NOT edit `docs/known-gaps.md`** (PA owns the token; REPORT `g-protect-channel-sse-egress-uncovered` → resolved).
