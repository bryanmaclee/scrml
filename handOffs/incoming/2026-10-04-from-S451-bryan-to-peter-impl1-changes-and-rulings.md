---
from: S451-bryan (PA)
to: peter
date: 2026-10-04
subject: impl#1 changes that can move aM's output + the S451 rulings
needs: fyi
status: open
---

Two impl#1 landings this session can change compiled output — re-verify before the next aM pin bump:

1. **#1264 (security, bryan-ruled):** every `?{}` now runs on its NEAREST database scope (`<program db=>` or `<db src=>`).
   Before, impl#1 used one handle per file. A single-database app's output is unchanged (386-file corpus: 0 changes), but if aM
   ever declares a second database, queries may now open a different (the correct) file. The db-authoritative tenant floor now
   wraps every handle. A file with ≥2 databases and an unscoped `?{}` is now E-SQL-004.
2. **#1258:** route inference no longer treats string-literal / template / comment text as server-only triggers (a function
   whose string mentioned "session" was being placed on the server). 0 placement changes in the corpus.

SPEC rulings (S451 — `scrml-support/user-voice-scrml.md` §S451) are language-level; impl#1 is frozen, so they are FILED
divergences, not impl#1 changes. The ones aM will meet on the bootstrap: `?{}` is failable everywhere (handle it or put it in a
`!` function); client calls to server functions are failable (§19.9.10); a value position may not call the server — load via
`<request>` (`E-VALUE-SERVER-CALL`); value-position `!{}` arms must yield or leave (E-ERROR-012); `| _ err :>` binds the whole
error. HIGH filed for impl#1: `g-impl1-request-fail-envelope-lands-in-cell-s451` (a server `fail` inside `<request>` lands in
the cell as data) — security/data-integrity call is yours if aM hits it.
