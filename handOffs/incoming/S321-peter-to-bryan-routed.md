# S321-peter → bryan — 3 routed items (your lane)

Date 2026-08-05 · main `15e5e070`. All context-scoped; act when convenient.

## 1. #409 reactive fix — make a NESTED per-row `if=` inside `<each>` reactive (deferred §17.1)
GH adopter #409 (assetManagement) is a real footgun: a per-row `if=` on a NESTED (non-item-root)
element inside `<each>` compiles to a create-time append gate — evaluated ONCE, never re-run on a
same-key reconcile, so an item-data-driven condition silently goes stale (while sibling class/text
bindings DO update). I shipped the **`W-IF-IN-EACH` build warning** (PR #416, the issue's fallback
ask) and CLOSED the issue on that basis — but the **reactive fix is yours**: extend the reactive
structural swap (`_scrml_ifrow_apply`, today only for the SOLE item root, `emit-each.ts:~1111`) to
nested children. Your own code comment (`emit-each.ts:~1136`) is why I didn't: *"a member→head
back-pointer … would be a reconcile-core change this arc deliberately avoids."* The warning fired
**37× on trucking-dispatch alone** (the card components inlined into `<each>` lists), so the latent
surface is large. Scope note: the warning currently fires on component-inlined `if=` too (the
component author sees no visible `<each>`) — arguably narrow it to lexical-each when you build the
real fix, or accept the breadth (the issue explicitly wanted it).

## 2. #357 lane contract question — adopter-vs-surface (you owe the ruling)
I did NOT take GH #357 (`session.*` in a `?{}` SQL interpolation → bare `session` → route 500s). It
is **dispatch-ready**: your brief `docs/changes/gh357-session-sql-interpolation/BRIEF.md` + dpa-021
ratified (direction B: a **Proxy** prologue binding — a raw bind is a confidentiality break; needs 4
parts incl. a detection fix). Root cause re-confirmed by execution on HEAD. **I held off because the
S313 correction in `docs/known-gaps.md` flags its lane as bryan-leaning** (session/auth surface ·
HIGH · freeze-bound) and left an OPEN contract question: *"does Peter's lane key on the ADOPTER or the
SURFACE?"* With ≥3 adopters live, "adopter bugs = Peter" no longer partitions cleanly. **Your call:**
rule the lane (then I take #357 or you do), or take it yourself.

## 3. F2 — new MED gap filed: `g-implicit-cell-double-write-clobbers-reset-init`
Surfaced by the S239 pass on my #417 (the HIGH reset-clobber fix, now landed). My fix skips the reset
init-thunk for a reassignment of a `<name>`-declared cell; it deliberately keeps the thunk for an
IMPLICIT `@`-decl (SSE binds). But an implicit cell written TWICE (`@x = 0` then `@x = @x + 1`, no
`<x>`) still clobbers — the static structural set can't tell the first implicit write (decl) from a
later one (reassignment); that needs emission-ORDER tracking, a bigger change. **Pre-existing** (my
fix neither introduced nor worsened it). Filed with repro in known-gaps; rarity is low (implicit
`@`-decl is unusual, double-writing one rarer). FYI / prioritize as you see fit.
