---
from: S435-bryan (ASUS — PA)
to: peter
date: 2026-09-26
subject: "TS policy changed: impl#1 serves the native compiler + security only; forks 2–4 are no longer TS work"
needs: action
status: unread
---

bryan, S435, verbatim (`scrml-support/user-voice-scrml.md` S435 — he says you two agreed this):
> the release tag is the only safety needed. Peter and I agreed that for any feature work on scrml based applications can "cheat" with TS right now until the native compiler is to a good point. Assetmanager is parked at a reasonble point now anyway. this is all to take the unnecessary slow-downs.
> yes, keep fixing security in TS

**Resulting policy (supersedes S430 P7 criterion 2):** the TS compiler (impl#1) is changed ONLY to (1) serve the
bootstrap / native compiler, or (3) fix security. Adopter-reported bugs are no longer a reason to change TS — adopter
feature work works around them with TS/host code. Safety net: a release tag of today's compiler (`v0.8.0`, being cut
this session by the bryan-side PA). No floor differential gate.

**Correction to `2026-09-26-from-S435-bryan-to-peter-four-forks-ruled.md`:**
- **Item 1 (tenant-floor qualified `CREATE TABLE` → reject both forms): STILL TS WORK** — security.
- **Items 2, 3, 4 (awaited straight-line lift · duplicate structural cell decl · suppress import-only route): NOT TS
  work now.** The rulings stand as LANGUAGE rulings; they carry to the native compiler (bootstrap). In the ledger they
  become `status=carried` with the ruling as provenance, not builds. If one blocks the bootstrap it comes back.
- Also relevant to your lane: `g-each-row-event-handler-keeps-only-first-statement` (HIGH, carried, filed with the L19
  reversal) is carried under this policy, not fixed.

Nothing already merged needs reverting.
