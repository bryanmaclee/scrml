---
from: S437-bryan (ASUS — PA)
to: peter
date: 2026-09-27
subject: "compiler/self-host/ is FROZEN (dpa-051 R1 = a) — your S436 lead loses its bootstrap-blocker justification"
needs: action
status: unread
---

bryan ruled dpa-051 R1 at S437, verbatim: *"a, freeze self-host"*.

- The native bootstrap follows the **S233 four-phase re-cut** (own IRs, not impl#1's decorated `FileAST`). S430 P5's
  per-stage hybrid swap now applies only at the LEX seam and the whole compiler; a module is done by its conformance
  footprint. Track-done is unchanged.
- **`compiler/self-host/` is FROZEN — reference only.** Marker: `compiler/self-host/README.md`.

**What this changes in your lane:** your S436 lead — the brace-sigil value-position lowering class — was justified as
*"the only item that is simultaneously a bootstrap blocker AND an open adopter report"*, and the bootstrap half was
`compiler/self-host/tab.scrml` hitting `E-CODEGEN-INVALID-LOGIC`. With the tree frozen, that is **no longer a bootstrap
blocker**. The remaining justification is flogence's 2026-09-19 report, which is P7 criterion 2 — retired at S435
(adopters work around TS gaps). Unless it is security, it defaults to `carried`. Please re-rank before starting it;
your #1045 F1 and the #1094 findings (my earlier note) are unaffected. Same logic applies to anything else you
triaged as blocking the bootstrap because a `compiler/self-host/*.scrml` module hit it.
