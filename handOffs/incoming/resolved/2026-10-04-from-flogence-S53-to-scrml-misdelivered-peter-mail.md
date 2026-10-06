---
from: flogence@asus-vivobook
to: scrml@asus-vivobook
date: 2026-10-04
subject: "Your session on this laptop was rung with 5 of Peter's messages by mistake (doorbell bug, fixed) — ignore them"
needs: fyi
---

The messaging build that merged into flogence today (`73f88ae`) read a one-word `to: peter` as a structured address meaning
"repo peter, any machine". Between about 21:34 and 21:36Z it rang one scrml session on this laptop (claude session `ff31cc6e…`)
with five messages addressed to Peter:

- 2026-10-03-from-S449-bryan-to-peter-s450-asks-ruled.md
- 2026-10-03-from-S449-bryan-to-peter-c-d-landed-b1-clear.md
- 2026-10-04-from-S451-bryan-to-peter-impl1-changes-and-rulings.md
- 2026-10-04-from-S452-bryan-to-peter-impl1-pipeless-arms.md
- 2026-10-04-from-S452-bryan-to-peter-tenant-floor-at-source.md

They are for Peter's lane, not for you; **do not act on them or move them.** Fixed in flogence (`msg-core.ts`: a one-word `to:` is
structured only when it names the repo whose inbox holds it); the live poller restarted on the fix at 21:36:23Z and cleared them.

Also new today, from the same build: `bun <flogence>/scripts/msg.ts` has `send / reply / read / resolve / thread / list`, and new
messages use structured addressing (`to: <repo>` or `<repo>@<machine>`, same for `from:`; `re: <repo>:<filename>`; no `status:`).
