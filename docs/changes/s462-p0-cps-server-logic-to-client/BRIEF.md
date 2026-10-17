You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. P0 SECURITY: an auth bypass plus a password-hash leak, confirmed end to end on main a9aa81eff.

FIRST:
1. `git fetch origin && git merge origin/main`.
2. Archive this prompt verbatim to docs/changes/s462-p0-cps-server-logic-to-client/BRIEF.md and commit it with a progress.md.
3. Commit rules:
   - Commit incrementally; code and its test go in one commit.
   - Never use --no-verify, and never disable hooks.
   - Gate each commit on free memory above 6GB and load average below 15.
   - Commit in the foreground with timeout 600000.

REPRO (from the reviewer; reproduce it first, in happy-dom for the client with fetch routed to the real server module on bun:sqlite):
```
<program db="sqlite:./n1.db">
${ import { verifyPassword as vp, hashPassword } from "scrml:auth" }
server function login(pass: string) {
  @out = ?{`SELECT name, pw FROM users WHERE name = 'bob'`}.get()
  if (!vp(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}
<button id="l" onclick={ login("wrong-password") }>login</button>
</program>
```
What happens:
- CPS splitting puts the SELECT on the server half and RETURNS the row `{name, pw: "$argon2id$…"}` to the client. THE PASSWORD HASH GOES OVER THE WIRE.
- The client continuation runs `if (!vp(pass, _scrml_cs_reactive_get("out").pw))` with vp from the client runtime's `_scrml_stdlib.auth`, un-awaited. `!Promise` is false, so the page shows "WELCOME bob" for a wrong password.
- In a real browser, vp is a rejected Promise, which is still truthy.
- The whole `_scrml_stdlib.auth` chunk ships to the client.
- The same split shows up in a plain escalated function.

TASK:
- Read the SPEC on CPS splitting, server functions, server-only resources and Trigger 3 (§12, plus the CPS sections; find them via SPEC-INDEX) in full. Quote the governing sentences.
- The invariant to enforce: logic in a function explicitly marked `server`, and any statement that touches a server-only resource (SQL, server-only stdlib such as scrml:auth / crypto secrets / store / http-with-secrets, env/secrets, a protect= field), must NEVER run on the client.
  - A cell write in a server function must not move the remaining server logic to the client.
  - Fix the split so it computes the final cell values on the server and sends only those values (the result of the logic), never the raw row the logic consumed.
  - If the split cannot keep a statement on the server, REFUSE at compile time with a clear diagnostic. Never silently relocate it.
- Data minimisation: a server function's response must carry only what the client needs: the written cell values, not intermediate query rows. Check how protect= interacts with this and quote it.
- Audit every way server-only stdlib reaches the client bundle (`_scrml_stdlib.auth` and the others). A client bundle should never include server-only stdlib chunks. If a client path references one, that is a compile error.
- Check related shapes:
  - a writes-before-read order;
  - several cell writes interleaved with server calls;
  - a loop containing writes;
  - match arms with writes;
  - `fail` after a write;
  - transactions.
  - Also run the same repro with a plain (escalated) function rather than one marked `server`.

TESTS:
- End-to-end route tests (happy-dom plus a real server on bun:sqlite):
  - Wrong password → REJECTED, right password → WELCOME.
  - The response body never contains the hash (assert on the raw fetch body).
  - The client bundle contains no server-only stdlib code.
- Each new test must FAIL on base.
- Add unit and conformance cases for the split and any new refusal.

CORPUS: run a full emit differential over samples, examples, conformance, gauntlet-r25 and the adopters ../giti and ../flogence (read-only). List every server function whose split changes, and every newly refused site. This may be wide: CPS is common. Report the blast radius honestly. If the correct fix newly refuses real adopter code, STOP and report it before landing anything that refuses it.

GATES, all of them:
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (PARSER DISAGREES is a known flake; re-run it)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate and corpus-compile-floor

Resolve generated-doc conflicts by hunk and regenerate; restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the SPEC sentences, the fix design, data minimisation, the stdlib-chunk audit, the blast radius, and the gates table. Do NOT push.
