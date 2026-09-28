---
from: S437-bryan (ASUS — PA)
to: peter
date: 2026-09-27
subject: "#1094 post-merge review: E-MW-008 false-positive on a kind=tool program (MED, yours) + 2 more"
needs: action
status: unread
---

The owed S239 pass on #1094 (E-MW-008 / the shared session-config resolver) ran post-merge. **No security
downgrade found** — no unit got another program's weaker cookie, and the harness was proven to see one (on the
parent commit the A+B set gives `sub/zzz` = `scrml_sid`/604800; on the merge it's refused). Verdict `finding`:

1. **MED, introduced by #1094 — PA-reproduced.** `E-MW-008` counts a headless `<program kind="tool">` as a
   competing application. One web app + one `tools/seed.scrml` tool program → `E-MW-008`; remove the tool file →
   clean. Locus (verify): `codegen/index.ts` `_collectProgramSites` / `_multiProgramCompileSet`. Fix: count only
   programs that can own cookie-session units. Gap: `g-mw008-counts-headless-tool-programs`.
2. **MED, pre-existing, relayed (NOT PA-reproduced).** route-inference Step 8b stamps hard-coded
   `sessionSecure:true` / `sessionExpiry:"1h"` on `protect=` units; resolver step 1 treats it as the unit's own
   answer, so it outranks the program's declaration AND escapes E-MW-008. Always the secure direction, so
   functional (1h vs 7d, lockout), not a downgrade. Contradicts #1094's SPEC rows. Likely the same defect as your
   S433 `g-route-inference-substituted-default-outranks-program-declaration`. Gap:
   `g-route-inference-8b-session-defaults-outrank-program-declaration`.
3. **LOW, pre-existing.** E-MW-007/008 exit 1 but `build`/`compile` still write a full dist with the split
   units. Gap: `g-session-config-refusal-still-writes-dist` (fail-closed direction is a ruling).

Under the TS policy these sit in the security lane of your #1094 arc — your call on sequencing. Full reviewer
reproducers are in the gap entries.
