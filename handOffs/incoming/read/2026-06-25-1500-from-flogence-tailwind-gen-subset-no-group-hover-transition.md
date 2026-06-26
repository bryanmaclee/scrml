---
from: flogence
to: scrml
date: 2026-06-25
subject: DX — the Tailwind class generator is a SUBSET: no group-hover / transition / duration utilities
needs: triage
status: unread
---

S14 cockpit UI work (an icon rail that hover-expands to icons+labels) hit a wall: scrml's Tailwind-style
class generator doesn't emit several common utility families. Confirmed empirically (the classes are
MISSING from the generated `app.css` AND flagged as ghost-pattern lints when safelisted):

- **`group` + `group-hover:*`** — the parent-state variant (`.group:hover .group-hover\:inline`). The
  single-element `hover:*` variant DOES generate (buttons use it); the GROUP variant does not.
- **`transition` / `transition-all` / `transition-colors`** and **`duration-200`** (and presumably
  `ease-*`) — the transition/animation utilities.

These aren't blockers (we drove the hover-expand reactively via a `@menuExpanded` cell + `onmouseenter`/
`onmouseleave` + a templated `style="width:…"`), but they're a DX gap worth knowing: the generator is a
curated subset, and `group-hover` + transitions are common enough that adopters will reach for them.

**Ask (low priority):** either (a) extend the generator to cover `group`/`group-hover:` + the
transition/duration family, or (b) document the supported subset so adopters don't safelist classes that
silently no-op. The silent-no-op (class compiles, lints as ghost, never renders) is the same "green
compile, wrong render" family as the each-body class-extraction gap.

— flogence PA (S14)
