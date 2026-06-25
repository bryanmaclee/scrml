# sPA ss22 — server-fn pipeline (typer scope + emit-server / rewrite / emit-client)

**Launch:** `read spa.md ss22` · **Branch:** `spa/ss22` · **Worktree:** `../scrml-spa-ss22`

**Fill:** the server-function residual cluster the S220 auth-wall (ss19) + Bug-51 arcs surfaced + deferred — the typer-scope false-fires and the server-side lowering gaps (peer-await in templates, enum-toEnum, the E-CG-001 stale-snapshot over-fire). NEW S221 · **fireable now** (server-side surface; disjoint from ss21 render — but **serialize re-integration with ss26** if both run, both touch emit-server).

## Shared ingestion
The **server-function pipeline**: the typer's server-fn scope/arm (`type-system.ts` — where `route`/object-literal-field identifiers get resolved) and the server-emit lowering (`emit-server.ts` peer-`await` structural pass + `rewrite.ts` Pass-9 enum rewrites + `emit-client.ts` protected-field invariant). Same triangle ss1/ss19 worked. **READ FIRST:** the ss19 Group A landing (`emit-server.ts` peer-await threading @ `538df06d` + `docs/changes/ryan-cheese-craft-findings-2026-06-25/`) + the Bug-51 enum-emit block (`emit-client.ts` server enum-def).

## Core files
`compiler/src/type-system.ts` (server-fn scope) · `codegen/emit-server.ts` · `rewrite.ts` (`rewriteEnumToEnum` Pass 9 ~:1599) · `codegen/emit-client.ts` (E-CG-001 ~L2191-2203; enum lookup tables :1398/:2265) · `route-inference.ts` (return-boundary)

## Items (least-ingestion-first)

1. **`g-sse-route-object-typer-scope`** (MED) `[status=open]` — `route.lastEventId` / `route.query` inside a `server function*` SSE body → `E-SCOPE-001 "Undeclared identifier route"` (codegen synthesizes the SSE `route` object but never registers it in the typer scope). Pre-existing (independent of author `route=`). **Fix:** allowlist the synthetic SSE `route` object (`.lastEventId`/`.query`) at the typer. Cross-ref `docs/changes/escalation-2-sse-author-route-app-mode-2026-06-23/`.
2. **`g-server-fn-typed-object-literal-return`** (MED) `[status=open]` — `return { field: ... }` in a `server function` fires `E-SCOPE-001` on the FIELD NAME (object-literal key mis-resolved as an identifier in server-fn scope). Locus: `type-system.ts` server-fn arm / object-literal field-key resolution. PA-repro pending. **Same typer-scope ingestion as #1** — do these together.
3. **`g-ecg001-protect-invariant-overfire`** (MED) `[status=open]` — `E-CG-001` "protected field in client JS" false-fires on a field NOT in the final client bundle: `emit-client.ts ~L2191-2203` scans a STALE pre-transform snapshot. **Fix:** scan the final (post-transform) client bundle for the E-CG-001 invariant. Check-ordering false-positive (not a real leak).
4. **`g-peer-call-in-raw-template-unawaited`** (MED) `[status=open]` — inline `${peer()}` in a template literal / SQL `?{…${peer()}…}` param / `${@cell}` in a server-fn template bypasses the #8 statement-level structured emit → unawaited peer / unrewritten cell → invalid JS. **Fix:** apply the pass-#8 structural emission to template-interpolation positions.
5. **`g-enum-toenum-not-lowered-server-side`** (MED) `[status=open]` — `Enum.toEnum(raw)` inside a `server function` is NOT lowered (`rewriteEnumToEnum` Pass 9 `rewrite.ts:1599` is client-only) AND the `<Enum>_toEnum`/`<Enum>_variants` tables are client-bundle-only → server-side `TypeError: Load.toEnum is not a function` (compile exit-0, silent). SEPARATE from Bug-51 (enum DEF, resolved) + pre-existing. **Fix:** (1) run Pass-9 on the server-emit path; (2) emit reachability-gated lookup tables into the server bundle (extend the Bug-51 enum-emit block). **giti-relevant** (the §14.4.3 DB-coerce idiom); flag giti on land. Repro `/tmp/bug51-toenum/repro.scrml`.
6. **`g-sql-row-protect-leak`** (LOW) `[status=open]` — a `server fn` that SELECTs a `protect=` column and RETURNs the row to the client is not statically caught (the static-projection gap; `protect=` still enforces at schema/PRAGMA). Data-flow shape (does a protected-column row reach a client surface?), natural home = the return-boundary / `E-ROUTE-003` family + typed-SQL-row contract. Heaviest (new data-flow analysis) — ordered last; may be design-touch, park-and-continue if it grows.

## Progress
`ss22.progress.md`. Land on `spa/ss22`; ping PA inbox per-item. Do NOT advance main / push. PA re-integrates (S67 + R26 — **#5 enum-toEnum mandates server-side runtime R26**: emit + `node --check` server bundle + confirm the lookup table present). #6 = STOP-if-materially-bigger (data-flow is a subsystem, not a fix).
