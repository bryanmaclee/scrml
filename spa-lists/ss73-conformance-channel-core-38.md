# sPA ss73 — conformance authoring: channel core §38 (freeze-gate, WAVE B pillar-contract)

**Launch:** `read spa.md ss73` · **Branch:** `spa/ss73` · **Worktree:** `../scrml-spa-ss73`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). `<channel>` (§38) is the real-time
pillar; its **core placement/naming/scope contract** (§38.9-.12) is a soundness guarantee. The S256 audit
found the existing channel cases cover only the §38.13 `watches=` Nominal extension — the ~7 core
`E-CHANNEL-*` codes are uncovered. NEW S256 · **fireable now** (pure conformance-corpus data — disjoint).
Enumerates the CODES; the fired sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS". Author from
impl#1 → SANITY-CHECK vs SPEC §38 → ESCALATE divergences; verify GREEN on `bun conformance/run.ts`;
schema in `conformance/README.md`. Grep each code live in `compiler/src` (`symbol-table.ts` +
`codegen/emit-html.ts` + `component-expander.ts` + `route-inference.ts` + `ast-builder.js`) for the exact
trigger. **Harness ceiling:** these are COMPILE-TIME placement/naming codes (harness-clean). Channel
multi-client V5-strict cell-sync runtime is a freeze-DECISION (harness cannot express — accept-with-note,
see `DIRECTION-B-runtime.md`); the `<channel watches=>` server-feed RUNTIME half is owned by ss67.

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/channel/` (the existing `watches=` cases to mirror) ·
`compiler/src/symbol-table.ts` + `codegen/emit-html.ts` + `route-inference.ts` ·
`compiler/SPEC.md` §38.9-.12 (normative — read the named subsection per code)

## Items (one code per item; reject-path pos + clean neg)
1. **E-CHANNEL-001** (codes) `[status=pending]` — a channel-name/placement error (`codegen/emit-html.ts:1781`; "The name identifies this channel and sets the WebSocket URL path"). Pos + neg (a well-formed named channel → silent).
2. **E-CHANNEL-007** (codes) `[status=pending]` — a channel VP-3 placement error (`attribute-registry.js:34` references it). Grep the emitter + exact trigger; pos + neg.
3. **E-CHANNEL-008** (codes) `[status=pending]` — a channel constraint (`component-expander.ts:4212`, "Channel ..."). Grep exact trigger; pos + neg.
4. **E-CHANNEL-EXPORT-001** (codes) `[status=pending]` — a channel-export reactive-ref form error ("Reactive-ref forms (e.g. …)", `ast-builder.js:1424`). Pos + neg. (`E-CHANNEL-EXPORT-002` is tier-2 — excluded.)
5. **E-CHANNEL-OUTSIDE-PROGRAM** (codes) `[status=pending]` — a `<channel>` at file top level (outside a `<program>`; `symbol-table.ts:10009`). Pos (top-level channel → E-CHANNEL-OUTSIDE-PROGRAM) + neg (channel inside `<program>` → silent).
6. **E-CHANNEL-SERVER-CELL-READ** (codes) `[status=pending]` — a server-side channel function reads a client cell (`route-inference.ts:4213`). Pos + neg.
7. **E-CHANNEL-SHARED-MODIFIER** (codes) `[status=pending]` — a channel `shared` modifier misuse (§38; `symbol-table.ts:9287`). Pos + neg.

**Definition of done:** all 7 channel-core codes pinned (codes-half; reject pos + clean neg per code);
run.ts green; divergences ESCALATED. The channel core placement/naming contract moves from
watches=-only to conformance-covered on the diagnostic edge. (Multi-client sync runtime = accept-with-note
freeze DECISION, not this list.)

## Progress
`spa-lists/ss73.progress.md`. Land per-item on `spa/ss73`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
