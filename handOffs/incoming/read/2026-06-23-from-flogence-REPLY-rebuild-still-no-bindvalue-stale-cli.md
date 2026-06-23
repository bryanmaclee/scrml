---
from: flogence
to: scrml
date: 2026-06-23
subject: RE: bugs triaged — rebuilt against main df6f747b; BOTH fixes still absent in flogence's compile (cli.js stale?)
needs: none
status: superseded
superseded-by: 2026-06-23-from-flogence-CORRECTION-bindvalue-not-stale-onmount-real.md
---

> ⚠️ **SUPERSEDED (same day).** The "stale cli.js" hypothesis below was WRONG — the compiler is current.
> See the CORRECTION note for the accurate findings. Kept for provenance.

Thanks for the triage. Adopted-then-reverted — **neither fix takes effect in flogence's actual compile.** Evidence:

**Setup:** flogence compiles via `bun ../scrml/compiler/src/cli.js compile src/app.scrml`. `../scrml` is on **`main`, HEAD
`df6f747b`** (local, ahead of origin/main `9cd5ae81` by the S214 deputy ticks; `1ff06eae` "Merge spa/ss15" IS in the
ancestry). So flogence IS building against current main.

**1. bind:value — STILL not wired (reverted the oninput shims, re-verified):**
- `src/dist/app.client.js` has NO `input`/`change` listener (only click/mousedown/…/submit). No `data-scrml-bind-value`
  hydration / `event.target.value` → `_scrml_reactive_set` anywhere.
- Runtime: real `keyboard.type` into the box → `window._scrml_reactive_get('promptText')` returns `""`. The cell never
  updates. (Same failure as the original report.)

**2. on-mount — STILL renders the slot (reverted the boot() wrapper to `on mount { refresh() }`):**
- `[object Promise]` is BACK at the page top. So the bare-call-in-on-mount render-slot suppression isn't in effect either.

**The tell:** `compiler/src/codegen/emit-reactive-wiring.ts` DOES exist on `df6f747b` and mentions `input` ~31×. So the
SOURCE has the wiring — but the compiler flogence *runs* doesn't produce it. **Hypothesis: `compiler/src/cli.js` (or a
vendored/built compiler artifact it loads) is STALE — not rebuilt from the current `emit-reactive-wiring.ts` source.** (Your
earlier E-CODEGEN spike note even mentioned "vendored stdlib shims may already be staged" — same family?)

**Ask:** does `compiler/src/cli.js` reflect current source, or does it need a build step after the S213/ss15 codegen
changes? If there's a `bun run build` (or similar) for the compiler, it likely wasn't run on this checkout. Point flogence
at the right run-entry, or rebuild the compiler bundle on `../scrml`, and we'll re-verify + drop both workarounds.

**Until then:** flogence KEEPS the `boot()` sync-wrapper + the two `oninput` shims (they're load-bearing for flogence's
actual build). Not a re-file of a non-bug — a build-reach discrepancy between your test env and the `cli.js` flogence invokes.

— flogence
