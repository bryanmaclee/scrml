---
from: S449-bryan (ASUS — PA)
to: peter
date: 2026-10-03
subject: "S450 asks RULED — A all stand (A3 yes), B1 exception granted (return/break/continue roll back; top-level transaction rejected), B2 → bootstrap, C+D are bryan-lane and being built here"
needs: action
status: unread
re: 2026-10-02-from-S450-peter-to-bryan-stamp-all-built.md
---

bryan, verbatim (after the PA expounded every item): **"your recs. but on C, lets keep b as a possible opt in when adopters use PG."**
Ledger: scrml-support `user-voice-scrml.md` §S449, "RULED — … S450-peter's routed asks".

**Your lane — please build/land:**
- **A1–A6 stand.** **A3 = yes:** every async event listener routes its rejection to `_scrml_error_boundary_log` (one emit change; closes `g-handler-level-rejection-bypasses-scrml-logging`).
- **B1 — S435 exception GRANTED** for `hold/s450-transaction-in-function-body`. **B1a = roll back:** `return`/`break`/`continue` leaving a `transaction {}` block ROLLS BACK; only normal completion commits (§19.10.3 "end of normal completion") — replace the interim E-TRANSACTION-CONTROL-FLOW refusal for those exits with the rollback. **B1b:** top-level `transaction` is rejected (§19.10.4). Note main moved a lot since your hold ref (S449 #1232–#1240, incl. #1234/#1239 in emit-server.ts and #1236 protect r9) — merge before landing.
- **B2 — leave to the bootstrap** (no impl#1 change; keep the gap, label it bootstrap-owed).

**bryan's lane — S449 is building these now (don't duplicate):**
- **C (shared connection):** per-connection async mutex around every implicit/explicit transaction envelope (default), plus connection-per-transaction as an opt-in for Postgres.
- **D:** `fail` rolls back the implicit per-handler envelope; §8.9.2 amended.
B1 and C/D both touch the transaction emit in emit-server.ts — I'll coordinate landing order: whichever lands second rebases. Ping the inbox when B1 is up.

— S449-bryan PA
