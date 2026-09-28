---
from: S427-peter (P-Tech1, Windows)
to: bryan
date: 2026-09-21
subject: ruling needed — when do the statements of a `${…lift…}` block inside an `if=` run: once at file init, or per mount in source order? (§7.6 vs §6.7.2.1)
needs: ruling
status: unread
---

# The question

A `${}` logic block that contains `lift` and sits inside an `if=` element (so its host is emitted into
a mount `<template>` since `cdf4f4de`, if= Phase 2). Two normative sentences pull in different directions:

- **§7.6 (SPEC.md:6417):** *"A variable declared with `let` or `const` at the top level of a file-level
  `${}` block SHALL be in scope for all subsequent `${}` blocks and markup interpolations in the same
  file."* — declarations in such a block are FILE-SCOPE, so they must exist whether or not the `if=` is
  mounted.
- **§6.7.2.1 (SPEC.md:3854):** *"… a re-mounting scope re-run all bare expressions and re-start all
  `<timer>` and `<poll>` instances exactly as if mounting for the first time — binds scopes only."* —
  an `if=` element is a scope, so its block re-runs per mount.

Read strictly, §6.7.2.1 says "bare EXPRESSIONS", and a `const` declaration is arguably not one — so the
two may not actually conflict. That reading is what #1021 implements; I want your ruling on whether it
is the language you intend.

# What #1021 does today (landed as the conservative reading, ruling pending)

The fix makes a template-interior lift render into the MOUNTED node (it previously bound `null` at top
level — TodoMVC benchmark dead on arrival, `g-todomvc-benchmark-app-dead-on-arrival-…`, HIGH). For the
block's OTHER statements it keeps base's timing exactly:

- every lift-FREE statement (`const`/`let`/`function`/reactive write/expression) runs ONCE at file
  init, at file scope — as on base;
- only statements that contain `lift` run per mount, against the mounted host.

That keeps every program that worked on base working (adversarially verified: nothing outside 22
previously-broken corpus files changes). But it splits the block's statement ORDER in two cases, both
pinned as "ruling pending":

1. a lift-free statement that reads a value a lift statement wrote sees the PRE-mount value
   (`let hits = []; for (…) { hits.push(it); lift <li/> }; @seen = hits.length` → `@seen` 0, not 2);
2. its converse: a lift-free statement placed AFTER a lift statement effectively runs BEFORE it
   (`const cfg = {label:"first"}; for (…) lift <li>${cfg.label}</li>; cfg.label = "second"` → first
   render shows "second").

Corpus population of both shapes: **zero**.

# The two readings

| | A — declarations at init (what ships) | B — whole block per mount |
|---|---|---|
| file-scope reads of the block's names from OUTSIDE the `if=` | work always (§7.6) | `undefined`/absent while unmounted |
| statement order inside the block | split (the two cases above) | source order, every mount |
| memoryless remount | lifts yes; declarations no | fully |
| reversibility | changes only for previously-broken programs | would change p1-shaped programs that WORKED on base |

PA lean: **A** — it cannot regress a working program and it is the narrower reading of §6.7.2.1's
"bare expressions". But the axis (what an `if=` scope owns) is yours.

Direction-of-change of #1021: **semantics-changed, previously-broken programs only** (conformance
restoration of §10.1 + §17.1's sugar equivalence). Full review trail in `docs/pr-reviews.md` and
`docs/changes/s427-lift-target-mount/progress.md`.
