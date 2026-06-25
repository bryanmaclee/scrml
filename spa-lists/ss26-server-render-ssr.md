# sPA ss26 — server-render / SSR subsystem (per-request render-into-HTML)

**Launch:** `read spa.md ss26` · **Branch:** `spa/ss26` · **Worktree:** `../scrml-spa-ss26`

**Fill:** the two inventory entries that merge into ONE new subsystem — the per-request server-render path that (a) omits non-role-admitted subtrees from the HTML (`nominal-8`) and (b) pre-renders server-authoritative instance data into the initial HTML (`g-tier1-ssr-prerender`). NEW S221. **FEATURE BUILD, not a bug sweep — heavier; substantial new subsystem** (`route-splitter.ts:1167` marks the SSR-injected-`<script>` shape "a v1.0 polish target"). § 52.8 names BOTH tiers → a unified server-authoritative-SSR pass covers both. **Coherent-but-thin (2)** by design (one subsystem). ⚠ **Touches emit-server/route-splitter — serialize with ss22** if both run.

## Shared ingestion
The **server-render path**: where the per-route handler renders markup into the initial HTML (today: client loads on mount via `/__serverLoad/<var>`), the role-visibility static analysis (`isVisibleForRole` — the hard half DONE for nominal-8), and flash-free client hydration that adopts pre-rendered DOM+state instead of re-fetching. **READ FIRST:** SPEC §52.6/§52.8 (read-authority + the SSR pre-render requirement) + §40.9.5 (per-role gating runtime) + the S196 read-authority core (change-id `state-decl-shape-disambiguation-2026-06-14`, the §52.6.1 `SELECT *` auto-load + `/__serverLoad/<var>` route). delta-log [80] (the nominal-8 SCOPE: hard half done, missing = the per-request render path) + [82]-context.

## Core files
`compiler/src/route-splitter.ts` (`:1167` SSR-injected-`<script>` shape) · `codegen/emit-html.ts` (server-render markup) · the per-route server handler emit · `type-system.ts` (`W-AUTH-002` tracking; `isVisibleForRole`)

## Items (build order — shared subsystem, do as one arc)

1. **`g-tier1-ssr-prerender`** (MED) `[status=open]` — Tier-1 `< Type authority="server" table=>` instances load CLIENT-side on mount (placeholder flash), NOT SSR pre-rendered (§52.8: "populated on the server during SSR … no loading placeholder on first paint"). **No existing SSR-pre-render path to mirror** — this is the foundational build: (1) server-render the markup with the loaded rows in scope, (2) inline the loaded state into the initial HTML, (3) flash-free client hydration that adopts the pre-rendered DOM+state. Applies to BOTH tiers per §52.8. `W-AUTH-002` is the tracking warning. NOT a blocker (client load works).
2. **`nominal-8-gating-runtime`** — per-role server-render-time gating §40.9.5 `[status=nominal]` — the hard half (static `isVisibleForRole`) is DONE; missing = the per-request server-render path that OMITS non-admitted subtrees from the emitted HTML. **Builds ON #1's render path** (the same server-render-markup pass, with a role-visibility filter). Auth-adjacent. Flip the Nominal banner on land.

## Progress
`ss26.progress.md`. Land on `spa/ss26`; ping PA inbox. Do NOT advance main / push. **This is a feature subsystem** — #1 establishes the server-render path, #2 adds the role-filter on top; do them in order, not in parallel. **STOP + report the real scope after #1 surveys** (the SSR path may be larger than an sPA arc — if so, hand back the survey + a SCOPE doc for PA/dPA architecture-pass). PA re-integrates; nominal-8 banner-flip + conformance on land.
