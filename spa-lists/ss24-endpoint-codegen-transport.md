# sPA ss24 — §61 `<endpoint>` codegen + transport (post-ss18 follow-on)

**Launch:** `read spa.md ss24` · **Branch:** `spa/ss24` · **Worktree:** `../scrml-spa-ss24`

**Fill:** the `<endpoint>` follow-on cluster ss18 (§61 W2-W5) surfaced — the multi-statement-arm codegen limit + the **dpa-013 transport build** (JSON-RPC `method`-string ⇄ `accepts=` variant-tag, **direction A RATIFIED S220**: a configurable discriminator field). NEW S221. Coherent-but-thin (2 items + 1 editorial rider) — endpoint is its own §61/parseVariant ingestion; NOT forced-fattened (S210 hard-constraint). **dpa-013 unblocks the flogence transport cutover off TS `fsp-wire.ts`.**

## Shared ingestion
The **§61 `<endpoint>` codegen + `parseVariant` decode** path ss18 just built: `parseVariant` over the inbound body → exhaustive arm dispatch → JSON envelope (§61.5), server-handler-only emit (client-skip, §61.6). **READ FIRST:** the ss18 landing (`emit-server.ts` endpoint codegen @ `517b2308` + `docs/changes/endpoint-primitive-2026-06-25/`) + SPEC §61 (W1 `a78ea133`) + §41.13 `parseVariant`. The dpa-013 design call: delta-log [83]/[376] (option A — generalize `parseVariant`/`<endpoint accepts=E by="method">` to key on a NAMED field).

## Core files
`compiler/src/codegen/emit-server.ts` (endpoint arm emit, `emitEndpointServerHelperLines`) · `type-system.ts` (`parseVariant` + `E-ENDPOINT-NOT-EXHAUSTIVE`) · `ast-builder.js` (`<endpoint>` parse) · `stdlib`/`emit-parse-variant.ts` (the `by=` discriminator)

## Items

1. **`g-endpoint-multi-statement-arm-invalid-js`** (MED) `[status=open]` — W4 lowers `:`-shorthand / single-expr-bare / self-closing arm bodies; a MULTI-STATEMENT bare-body arm emits invalid JS, caught only by the generic `E-CODEGEN-INVALID-JS` (documented limit §61.10). **Fix:** lower multi-statement arm bodies OR fire a clean endpoint-specific diagnostic. Smaller; pure endpoint-arm codegen.
2. **`dpa-013` — JSON-RPC ⇄ `<endpoint>` configurable discriminator** (FEATURE, direction A ratified S220) `[status=build-ready]` — generalize `parseVariant` / add `<endpoint accepts=E by="method">` so `{method:"x",params}` decodes natively by keying on a NAMED field (method-string ⇄ variant-tag). The limit-primitives-correct generalization (a sharp `by=` widening, NOT a JSON-RPC mode) — lands §61.5's "JSON-RPC is a convention, not baked-in" literally; reusable beyond flogence. **W-shape:** SPEC §61 amendment (`by=` attr + §34 row per Rule 4) → parser → typer → codegen → tests/example. **flogence = first consumer** (transport cutover off `fsp-wire.ts`). PA confirms SPEC amendment faithful before codegen (Rule 4).
3. **Editorial rider (`[status=open]`):** `examples/33-endpoint.scrml` can now dog-food the **canonical** `<Variant : fn()>` arm form (the S220 endpoint-arm reachability fix `9d850526` made §61.2 work) — has within-node-allowlist baseline implications. Convert + re-baseline in the same land.

## Progress
`ss24.progress.md`. Land on `spa/ss24`; ping PA inbox. Do NOT advance main / push. **#2 is a SPEC-amendment build** — land the §61 amendment + §34 row in the SAME change as the codegen (Rule 4); PA verifies the amendment is faithful to the option-A ratification BEFORE codegen. PA re-integrates.
