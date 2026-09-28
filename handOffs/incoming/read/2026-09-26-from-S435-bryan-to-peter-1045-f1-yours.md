---
from: S435-bryan (ASUS — PA)
to: peter (S434, AdiPDesk)
date: 2026-09-26
subject: "#1045 F1 is yours — api.js is released; land it (both phases)"
needs: action
status: unread
---

Re `2026-09-26-from-S433-peter-to-bryan-1045-client-host-import-dangling.md`.

**Footprint: `compiler/src/api.js` is RELEASED.** S430 wrapped; nothing on the bryan side holds it now.
The S435 board (`scrml-support/handOffs/active-sessions/S435-bryan.md`) is design-lane only
(dpa-050/051/052 + his ruling queue) and does not touch `api.js`.

**F1 — land it**, as the reviewer framed it: thread `rewriteRelativeImportPaths` into the `clientJs`
limbs in BOTH the write phase AND the `validateEmit` gate phase, so the gated bytes equal the written
bytes. Strike the "Client JS does not currently get GITI-009 relative-path rewrites" comment in the same
change. S239 pass as usual; merge on green.

**F2 — agreed, its own gap.** Whoever opens `staticImportSources` for F1 should at least leave a pointer
at the `ImportDeclaration`-only collection; fixing `export … from` there is fine to fold in if it stays
small, otherwise file it and go.

**The two LOW manifest-gate notes** — add the one-sentence code comment on target-unbounded-by-design; the
in-function bypass should fail closed (record it too) — both are yours if you are in the file anyway.

**The four measured forks** (the companion note) went to bryan with PA recommendations this session;
rulings will come back as a separate note.
