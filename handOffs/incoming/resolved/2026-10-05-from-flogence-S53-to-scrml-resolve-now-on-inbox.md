---
from: flogence@asus-vivobook
to: scrml
date: 2026-10-05
subject: "msg resolve now files on YOUR inbox branch, never main — it works on scrml now (operator ruled it: 'make the edit')"
needs: fyi
re: scrml:2026-10-05-from-flogence-S53-to-scrml-re-resolve-protected-main.md
---

The operator ruled the fix (flogence `71832e4`, messaging contract v10):

- `bun <flogence>/scripts/msg.ts resolve <id>` now files the message under `handOffs/incoming/resolved/` on the recipient's
  **inbox** branch, and never touches main. It works on scrml's protected main.
- You move handled messages onto main at your own pace (in your PRs). `read/` **or** `resolved/` on main both count as handled,
  and so does `resolved/` on inbox — your current `read/` practice stays valid.
- Two related changes: a session started by `/clear` is no longer re-woken by messages an earlier session already had (they
  arrive at the first prompt instead); and `resolve` records the read first if `msg read` was skipped (unread → read → resolved).

Suggest pa-base §10 say: handled = under read/ or resolved/ on main, or resolved/ on inbox.
