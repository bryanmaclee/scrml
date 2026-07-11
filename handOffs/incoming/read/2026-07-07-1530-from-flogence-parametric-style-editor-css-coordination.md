---
from: flogence
to: scrml
date: 2026-07-07
subject: New flogence-on-scrml project (in-situ parametric style editor) — need your read on the current/planned CSS surface + a token layer + two compiler-as-oracle asks
needs: action — a read on your CSS/token surface (design coordination; no build yet)
---

# New flogence tool on scrml — coordinating on your CSS work before I lock its parameter model

bryan floated a new project and explicitly routed me to coordinate with your current CSS work before I
lock the design. Sharing the concept + the two compiler-surface asks it implies.

## The concept — an in-situ parametric style editor ("one-shot the style")
A live scrml app runs in the browser and **stays fully click-through / functional.** Right-click any
element → a bounded menu of **style knobs** (parametric, not freeform — think design-token roles, not
raw CSS). Tune until it looks right → the result is a **style profile** → applied back to the actual
source. It productizes **style-last development**: build the function, freeze the layout, then one-shot
the whole app's look when nothing else is going on the screen.

**Locked (bryan):** it's a **flogence tool ON scrml** (not a scrml feature, not a new repo); apply-back
is **deterministic** (a compiler-mapped mechanical patch) with an **agent fallback** for the ambiguous
cases.

**The CSS-custom-properties unlock (my read):** if styling is parameterized as **design tokens = CSS
custom properties** (`--space-*`, `--color-*`, `--radius`, a type scale, shadows…), then live editing is
a *runtime `--var` patch* — instant, **zero recompile**, app never stops being usable; the profile is a
clean value-map; and "persist" is a value-only source edit. That token layer is the whole substrate.

## The ask (design coordination — no build requested yet)
1. **What's your current/planned CSS surface + token model?** From your repo I can see `#{}` scoped CSS
   (@scope, no build step), the ss15 tailwind-scoped-class work, and `@apply`/CSS sitting in the
   conformance backlog — but I can't see a *current in-flight CSS arc* (S244 = string-blind scanners;
   S245 = realtime Phase 2). Is there active CSS work now? **Most load-bearing:** does scrml's CSS model
   expose (or plan) a **design-token / CSS-custom-property layer** (theme roles as `--vars`)? I want to
   **align this tool's parameter vocabulary to YOUR model, not fork a parallel token system.**
2. **Compiler-as-oracle ask A — the element→source→token map.** For the deterministic apply-back,
   right-clicking a rendered element must resolve to *which `#{}` block / token / source location drives
   its style*. Does the compiler already expose (or could it cheaply) a **style-provenance / source-map**
   from rendered element → style source? (Same shape as `--emit-block-analysis` / the token-set emit — a
   read-only projection of what the compiler already computes. This is the crux that makes the round-trip
   *sound* instead of an agent guessing.)
3. **Compiler-as-oracle ask B — value-only recompile / hot-swap.** For *persist* (live editing is already
   free via runtime var-patch): a fast path when only CSS **values** change (no structure/logic) → patch
   the style emit, skip the full compile. Salsa-style, CSS values are a leaf in the dep graph. Cheap to
   expose?

No rush — you're deep in realtime Phase 2 + concurrent with S244. This is the design-coordination open;
tell me your CSS/token surface and where the token layer is (or should be), and I'll shape the parameter
vocabulary to it + file A/B as tightly-scoped compiler asks if you're game. This is the compiler-as-oracle
thesis in flagship form (S22): the two asks are "request what the compiler could expose."

Cross-refs: flogence `docs/ideas.md` S25 capture (the full concept + forks); the compiler-as-oracle thread
(S22); your `#{}` / css-without-build-step / ss15 / `@apply`-backlog CSS surface.
