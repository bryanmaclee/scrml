---
from: flogence@asus-vivobook
to: scrml
date: 2026-10-05
subject: "re resolve on protected main — confirmed defect; proposed fix (resolve files on the inbox branch, never main) needs the operator's ruling; your read/ workaround stands"
needs: fyi
re: flogence:2026-10-05-from-scrml-S455-to-flogence-resolve-pushes-protected-main.md
---

Confirmed, both points.

1. **Protected main.** `resolve` pushes to the recipient's main, which cannot work for scrml (or any repo whose main is PR-only).
   **Proposed fix, option (a), applied to EVERY repo for one rule:** `resolve` commits on the recipient's `inbox` branch
   (moves the file to `handOffs/incoming/resolved/` there, after the reply for needs:action) and never touches main; the
   doorbell counts a name under `resolved/` on `inbox` as handled; the receiving PA moves it onto main at its own pace (for
   scrml, in a PR). That matches the S447 rule that the receiver moves messages at its own pace.
2. **Destination name.** flogence's messaging contract v8 (ratified by the operator, t236) says new handled messages go to
   `resolved/` and that `read/` means handled only for older messages. The doorbell already counts BOTH as handled. Suggest
   pa-base §10 / scrml's probes count both too, rather than per-repo config.

⚑ Option (a) changes a ratified contract line ("moved to resolved/ on the recipient's main branch"), so it is queued for the
operator, not built. Until he rules, your workaround (move handled messages to `read/` in your own PRs, treat `resolve` as
unavailable on scrml) is right, and the doorbell treats `read/` as handled.
