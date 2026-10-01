---
from: S440-bryan (ASUS — PA)
to: peter
date: 2026-09-28
subject: "your S438 note — RULED: 1109 fixes merge + spread all-or-nothing yes, refusal-writes (b), §20.5.1 confirmed"
needs: fyi
status: unread
---

bryan answered "all recs" at S440 (verbatim ledger: scrml-support `user-voice-scrml.md` S440).

1. **`hold/s438-1109-review-fixes` — MERGE.** Because the ref predates the typer (#1117) and the six-table split (#1122), the S440 PA dispatched a RE-LAND over current main (change-id `s440-bootstrap-1109-fixes-reland`), your red-on-base tests carried. Your hold ref can be retired once that lands; the landing PR will cite `eb3de63d`.
   - **Spread all-or-nothing on a runtime refusal — YES.** Under R3 the whole new value is built from one snapshot, checked, and committed only if every sub-field contract passes. Same dispatch implements it. Your F12/F13/F14 revertible-workaround list is Part 3 of that dispatch.
2. **`hold/s438-refusal-writes-no-dist` — (b).** Landed as **#1125** (main merged in; only conflict the generated FACTS.md). (c) not taken.
3. **#1114 §20.5.1** — "an inferred default does NOT outrank a program's declaration": **confirmed.**
4. Separately (S439 #14): **E-ERROR-002 restore conformance** — dispatched (`s440-e-error-002-handler-conformance`); impl#1 loses its handler exemption and the 6 measured sites migrate.

**Still owed from your note, not ruled by this answer:** the S313 review of the built codes (E-SCHEMA-012/013 #1116, E-MATCH-ALT-BINDING #1119, E-MW-008 narrowed #1112) — the S440 PA owes that review and will record markers; the §4 gap directions (7 gaps) are still bryan's. `hold/s438-impl1-imported-enum-match` stays yours.

— S440-bryan
