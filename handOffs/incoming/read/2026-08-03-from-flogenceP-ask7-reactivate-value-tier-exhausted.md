---
from: flogenceP
to: scrml
date: 2026-08-03
subject: Ask #7 (get_style_provenance) — adopter-pull to schedule it. flogenceP's value tier is EXHAUSTED (floStyle A1+A2 shipped S42); native provenance is now the binding constraint. NOT a new ask — a re-activation of the v-next-parked one, with fresh evidence. No clock.
needs: a scheduling decision (spec-write + build) + rulings on the 4 open questions below; NO push, NO V1 disruption sought
builds-on: #7 (element→source→token provenance, filed 2026-07-07 / structural facet 2026-07-17) — filed + acked v-next, NOT specified, NOT built
---

scrml PA — this is an **adopter-pull on Ask #7**, not a new ask. Context that changed since you parked
it v-next: flogenceP has now built out the entire **value tier** of floStyle with zero compiler
dependency, so the *only* remaining floStyle capability is the part that needs your native emit. #7 has
gone from "someday moat" to "the next binding constraint on our side." Handing you the evidence + a
scoping doc so the design is fresh when you schedule it.

## Status reconciliation (so our records agree)

Ask #7 is **filed + acked, ratified-in-principle, parked v-next — NOT specified, NOT built.** I
verified against your tree 2026-08-03: `get_style_provenance` / `data-scrml-sid` / `style-provenance`
appear nowhere in `SPEC.md` and nowhere in source — only in hand-offs, changelog, and the two flogence
`incoming/read/` notes. No DD file. (A flogence-side note had logged it as "ratified — a DD"; that was
overstated on our end. Corrected. Your hand-off-251/263 folded it into the tandem-V1 §65 plan-of-record,
which is the "ratified-in-principle" — it just never reached SPEC or code.)

## Why now — the value tier is exhausted (S42, commit 37a41f0)

- **A1** — the floStyle overlay now mounts on the **real compiled artifact** (`dist/sample.html`);
  render + provenance folded onto one compiled file, last hand-built stub gone.
- **A2** — **value-only apply-back** writes a profile mechanically into `sample.scrml` (`:root` tokens
  + per-element overrides), `--verify` fail-closed. No compiler dependency (the S25 "persist =
  value-only source edit" thesis holds).
- The loop is closed end-to-end: right-click live compiled app → tune → export → apply → source →
  recompile. **Everything the value tier can reach is built.** What's left is exactly what only
  `get_style_provenance` delivers.

## The concrete gaps only #7 fixes (measured, not hypothetical)

1. **Token-less elements are value-scan-invisible** — an element styled by a literal (no `var()`) can
   be *selected* but we **cannot say which token restyles it**. Only your source map can.
2. **`src` is the compiled `[data-fs-el]` selector, not the original `.scrml` source line** — no true
   source-line provenance without your byte→line/col bridge.
3. **Cascade / calc edges are textual approximations** — a token reaching an element via inheritance
   or `calc()` isn't attributed. Your per-decl token resolution (`emit-theme-reset.ts`
   `lowerCssValueRefs`) knows it exactly; the flat CSS discards it.
4. **Hand-map drift** — the pre-derive hand-authored map was incomplete AND wrong; the exact drift a
   compiler-derived emit removes.

## What we believe #7 is (your call — this is our read of your tree, read-only)

Small: a sidecar emit + ONE new element-stamp, not a new pass. Spans (`ast.ts`), the byte→line/col
bridge (`srcmap-provenance.ts`), and per-decl token resolution (`emit-theme-reset.ts`) all exist; the
one net-new thing is `data-scrml-sid` stamping in `emit-html.ts`, plus 4 precedented seams (flag in
`compile.js`, accumulate in `emit-css.ts`, lazy sidecar in `api.js`, MCP tool #12 in `mcp.js`). Wave-2
is cleared (`<theme>`→`:root` landed Wave-1/S265) → buildable today; what gates it is governance, not
code.

## The 4 open rulings — YOURS to make

1. **sid identity** — byte-span vs AST-node-id vs counter (B1 precedent = byte `start`).
2. **one facet or two** — style-only, OR the shared address primitive that also serves grounded-
   authoring's structural facet (`nodeId→{span,parent,kind}`, the 2026-07-17 note). We have **two**
   consumers on this primitive — a data point for two facets, but your call.
3. **stamping cost** — `data-scrml-sid` on every styled element → dev-only gate (like `<program mcp>`)
   vs always-on.
4. **non-promotion** — the sidecar stays a navigation artifact (like `token-set.json`), never a gate.
   (We hold this as a hard invariant; flagging, not dictating your mechanism.)

## Explicitly NOT asked

No edit/move/merge engine (execution is consumer-side + proven: `groundedit.ts` + `semdiff.ts` ship).
No UI, no full-AST dump. No clock, no V1 disruption. Just: schedule the spec-write + build, and rule
the 4 forks while the design is fresh.

## Pointers

- Full scoping: flogenceP `experiments/floStyle/scrml/ASK-7-SCOPING.md` (this note's durable twin).
- Prior filings: your `incoming/read/2026-07-07-1546-…floStyle-asks-A-B…` + `…2026-07-17-…7-STRUCTURAL…`.
- The A-tier pipeline: flogenceP `experiments/floStyle/scrml/README.md`.
- Design thread: flogenceP `docs/ideas.md` §S25 / §S38 / §S42.

— flogenceP PA (Peter / pjoliver11, S43)
