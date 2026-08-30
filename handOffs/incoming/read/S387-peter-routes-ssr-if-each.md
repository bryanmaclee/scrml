# S387-peter → bryan — routed item #2 (an SSR first-paint ruling, turnkey)

**From:** S387-peter (Windows). **Date:** 2026-08-29. **Base:** main (post-#762).
**Lane:** the DESIGN half is yours (should a server-known `if=` branch be server-rendered at first
paint = `semantics-changed`). A CONSERVATIVE peter-buildable half that only stops the SILENCE is laid
out below so you can rule "A now / B later" cheaply.

---

## `g-ssr-each-under-if-template-silently-blank-first-paint` — HIGH (silent-wrong first paint)

**One-line:** a server-authority `<each>` wrapped in an `if=` renders its rows into a mount that sits
INSIDE the `if=`'s inert `<template>`, so the SSR-composed rows never paint — blank first paint, ZERO
diagnostics. The dominant real-world shape (a guarded list: `if=@loaded` / `if=@currentUser` /
`if=@rows.length` around a `<each>`) silently loses its server first paint.

### PA-CONFIRMED by execution (isolation, `scratchpad/dogfood/s387ssr-if-wrap-traps-each-isolation.mjs`)
Same server-authority `<each in=@accounts>`, four wrappers, first-paint HTML mounted in happy-dom:

| wrapper | rows painted at first paint? |
|---|---|
| plain `<div>` | ✅ yes |
| no wrap (top-level) | ✅ yes |
| **`if=`** | ❌ **NO** |
| `show=` | ✅ yes |

All four compile with 0 errors / 0 warnings / 0 lints. Only `if=` traps them — because `if=` lowers
to an inert `<template>` + a hydrate-on-client marker, while `show=` keeps the DOM live.

### PA-VERIFIED locus + root (not relayed — read the code)
`compiler/src/codegen/emit-ssr-render.ts` `buildSsrEachRenderers` → `walk(node, insideEach)` (lines
~404-458). `walk` threads only `insideEach` (each-nesting). An each under `<div if=>` still has
`insideEach === false`, so line 413 (`if (!insideEach && …)`) classifies it as a TOP-LEVEL server-render
mount, `buildOneRenderer` succeeds, and line 442 `out.push(r)` emits a renderer that fills the
`data-scrml-each-mount` div — which is inside the `if=`'s inert `<template>`. The existing
`I-SSR-EACH-CLIENT-RENDERED` fallback lint (lines 429-440) fires only when the ROW TEMPLATE is
unrenderable, NOT when the each is if-enclosed — so the trap is silent. `walk` has no notion of
"inside an inert `if=`/`else-if=`/`else` template."

### THE FORK
- **Fork A — CONSERVATIVE, stop the SILENCE (peter-buildable once ruled).** Thread an `insideInertIf`
  flag through `walk` (set when descending into an `if=`/`else-if=`/`else` node's template children,
  the same way `insideEach` is set for each-templates). When an each's mount is `insideInertIf`, do
  NOT emit a server-renderer (skip the `out.push(r)`) and DO push the existing
  `I-SSR-EACH-CLIENT-RENDERED` info lint with a reason like *"enclosed by an `if=` template — its mount
  is inert at first paint; renders client-only after hydration."* Effect: the list falls back to
  client-render (populates on hydrate exactly like any client `<each>`) and the author sees a lint
  instead of a silent blank paint. **Pattern-to-mirror:** the existing `fallback` branch at 422-440.
  **Test-sketch:** an `<each in=@seededCell>` under `<div if=@cond>` → assert `I-SSR-EACH-CLIENT-
  RENDERED` fires AND no server-renderer is emitted (the each ships empty, hydrates live). **Class:**
  changes emitted output (stops emitting a broken renderer) + fires an EXISTING info lint on a
  previously-silent case — a codegen-correctness fix; owes review, no new surface.
- **Fork B — DESIGN, server-render the branch (yours).** When the `if=` condition is server-resolvable
  at compose time (e.g. `if=@accounts.length` over a seeded server-authority cell), server-render the
  CORRECT branch — rows and all — into the first-paint HTML instead of an inert template. This is the
  real win (guarded server lists paint at first paint) and it also closes the sibling finding
  **`if=@serverState` is never server-evaluated even over fully-resolved data** (a top-level
  `if=@accounts.length` beside a server-rendered each ships both branches inert). **Class:**
  `semantics-changed` (first paint now shows server-evaluated branches). Adjacent to the already-tracked
  `g-ssr-each-row-template-subset-blocks-all-prerender` (referenced at emit-ssr-render.ts:428).

### PA recommendation
**A now, B as the tracked design arc.** A is cheap and removes a SILENT wrong-output on the dominant
guarded-list pattern (a lint is strictly better than a blank paint); B is the larger first-paint-SSR
design you own. If you rule "A is fine, build it," it can go to Peter — the language question there is
only "is firing `I-SSR-EACH-CLIENT-RENDERED` on if-enclosure the right conservative behavior," which A
answers with the existing lint.

### Companion (not a route — an adopter note, FYI)
`ssr-if-false-flash` (aM's own known issue) is **PA-CONFIRMED FIXED** on HEAD — an `if=false` branch is
now inert inside a `<template>` and `document.querySelector` finds it nowhere in the rendered tree (no
paint, no flash). aM's workaround is removable. Same `<template>` mechanism whose desirability inverts
between if=false (good: no flash) and a server-each under if=true (bad: blank — this route).
