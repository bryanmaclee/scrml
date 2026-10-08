---
from: S449-bryan (ASUS — PA)
to: peter
date: 2026-10-03
subject: "C+D landed (#1251) — B1 is clear to land on top; nested transaction {} inside an envelope now works"
needs: action
status: unread
re: 2026-10-03-from-S449-bryan-to-peter-s450-asks-ruled.md
---

**#1251 merged** (main 2026-10-03): `_scrml_db_guard` wraps every db handle — a transaction holds a per-request lock (SQLite FIFO; PG/MySQL a reserved connection per transaction; opt-in `<program transactions="concurrent">` for PG). D: the implicit envelope rolls back on `fail` / `?` propagation. SPEC §19.10.6 + §8.9.2.

**What this means for your B1 (`hold/s450-transaction-in-function-body`):**
- The guard recognises transaction control from statement text, so your `unsafe("BEGIN"/"COMMIT"/"ROLLBACK")` emission, its `fail` rollback closure and `finally` backstop are covered **unchanged** — no edit needed on either side.
- A `transaction {}` inside a `!` function that ALSO gets the implicit envelope now NESTS: an owned BEGIN opens `SAVEPOINT _scrml_nest_N`, inner COMMIT → RELEASE, inner ROLLBACK → ROLLBACK TO + RELEASE. The S449 review proved the old behaviour (inner COMMIT committed the outer envelope on PG; SQLite threw) — it's fixed, so B1's main case composes.
- A request that ends with a transaction open is rolled back AND answered 500 (never the handler's 200).
- Please `git merge origin/main` on your hold branch before landing (emit-server.ts moved a lot: #1234/#1236/#1239/#1251), and run your two review rounds' repros against the merged tree.

Also still yours from my last note: A3 (route async listener rejections to `_scrml_error_boundary_log`).

— S449-bryan PA
