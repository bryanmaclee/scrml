# sPA ss18 — endpoint-primitive (W2-W5 build)

**Launch:** `read spa.md ss18` · **Branch:** `spa/ss18` · **Worktree:** `../scrml-spa-ss18`

**Fill:** N/A (a SEQUENTIAL new-primitive build, not a bug cluster) · NEW S219

## Shared ingestion
The `<endpoint>` typed-inbound-endpoint primitive — W2-W5 of the build arc. **W1 (SPEC §61) LANDED**
(`a78ea133`, Nominal). **READ FIRST: `docs/changes/endpoint-primitive-2026-06-25/SCOPE.md` + SPEC §61
(`grep -n "## 61\." compiler/SPEC.md`)** — §61 is the authoritative spec; the SCOPE is the design.
The build mirrors the §60 `<api>` A2 build (parser → typer → codegen → tests). The primitive REUSES
existing machinery (adds none): §18.0.1/§51.0.B.1 arms + payload binding · §18.0.1/§51 exhaustiveness ·
§41.13 parseVariant · `emit-variant-guard` dispatch · the §12.3/§37.3 author-route contract. Shared loci:
`ast-builder.js` + native-parser (W2) · `type-system.ts`/`symbol-table.ts` (W3) · `emit-server.ts` +
`route-inference.ts` (W4). **Per Rule 4 each `E-ENDPOINT-*` §34 row lands WITH the wave that fires it**
(named/reserved in §61.9). **DISJOINT from ss17** (each-codegen) — safe to run in parallel; PA lands
sequentially.

## Core files
`compiler/src/ast-builder.js` · `compiler/native-parser/*` · `compiler/src/type-system.ts` · `compiler/src/symbol-table.ts` · `compiler/src/codegen/emit-server.ts` · `compiler/src/route-inference.ts` · `compiler/SPEC.md` (§34 rows + §61 currency)

## Items (WAVES — strictly sequential; each depends on the prior)
1. **W2 — parser** `[status=open]` — recognize `<endpoint>` as a scrml structural element (`ast-builder.js` + the native parser; register in §4.15/§24.4 — already spec'd). Parse `path=` / `method=` / `accepts=` attrs + the per-variant arms, **REUSING the §18.0.1 `<match>` block-form arm grammar + §51.0.B.1 payload binding** (no new arm machinery). Fire the parse-time codes + ADD their §34 rows: `E-ENDPOINT-PATH-MISSING`, `E-ENDPOINT-METHOD-INVALID`, `E-ENDPOINT-ACCEPTS-MISSING`. Native-parser mirror per S162 conditional.
   > **Brief seed:** Mirror how `<api>` (§60) was parsed (`grep` the `<api>`/`api-decl` ast-builder path). The `<endpoint>` arms reuse the `<match for=>` arm parser verbatim. Parse-time codes fire on missing path/method/accepts. §34 rows land in THIS wave (Rule 4).
2. **W3 — typer** `[status=open]` — resolve `accepts=` to its `:enum` (`E-ENDPOINT-ACCEPTS-NOT-ENUM` on non-enum; reuse §14.1.2 E-TYPE-UNKNOWN-NAME for an undeclared ref); run the §18.0.1/§51 **exhaustiveness** check over the enum → `E-ENDPOINT-NOT-EXHAUSTIVE` (the inbound-honesty guarantee, §61.4); bind each arm's payload type. ADD the §34 rows for these codes. DEP: W2.
   > **Brief seed:** Reuse the `<match for=>` exhaustiveness surface (the same engine §18.6/§51 uses) over the `accepts=` enum — add no new exhaustiveness check. The §53.15 enum-subset narrowing (§61.4) MAY narrow the obligation where proven.
3. **W4 — codegen** `[status=open]` — `emit-server.ts`: the route-handler branch (beside the SSE/JSON-RPC bifurcation — the DD: net-new is small) — decode the request body via `parseVariant` (§41.13) → dispatch through the arms REUSING `emit-variant-guard` → envelope the typed arm-result as JSON → register at `path=`/`method=`; **route-inference**: explicit `<endpoint>` ⇒ emit server handler, skip the data-layer ser/deser + CSRF gate; **client-codegen SKIP** (no paired fetch-stub, §61.6). DEP: W3. R26 mandatory (HIGH codegen-adjacent — S138).
   > **Brief seed:** Mirror §60 `<api>`'s emit-server branch but INBOUND (server handler, not client callable). The default JSON envelope + the author-override-detection (§61.5) get their normative schema HERE (the §61.5 spec-ahead clause lands with W4). parseVariant decode reuse — no new decoder.
4. **W5 — tests + example + conformance** `[status=open]` — unit (parser/typer/exhaustiveness) + integration (emit-server) + `examples/NN-endpoint.scrml` (a worked `<endpoint>` over a small enum) + R26 + the flogence conformance smoke (`fsp-wire-smoke` 11 assertions re-hosted against the scrml-served `/fsp` — coordinate with flogence). Flip the §61 Nominal banner where waves wired the behavior. DEP: W4.
   > **Brief seed:** The conformance bar is flogence's `scripts/fsp-wire-smoke.ts` (8 FSP methods over JSON-RPC + terminal-state error + SSE replay-from-0 + SSE resume-from-cursor) re-hosted. flogence retires `fsp-wire.ts` as the production transport on landing.

## Progress
`ss18.progress.md`. Land on `spa/ss18`; ping PA inbox when ready. Do not advance main / do not push. (Sequential — land per-wave OR at W5; PA re-integrates wave-by-wave, reconciling §34/SPEC vs any parallel ss17 by hand.)
