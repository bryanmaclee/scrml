# BRIEF-r3 — fix round r3 (archived verbatim, as relayed by PA)

PA → rulings-round agent: FIX ROUND r3. The re-review of bd250de22 returned FIX. Same worktree, branch, rules and verification bar. Archive this message as docs/changes/s452-boot-rulings/BRIEF-r3.md, and add "fix round r3" to progress.md. Your r2 LOW-3 pushback was RIGHT (§18.6.1:16429): thank you, and keep it.

Verify each claim before changing anything:

MED-A — the txControl scanner misses real tx control when its quote/comment model disagrees with the database dialect. All of these compile clean today: Postgres `$$'$$; BEGIN; SELECT '1'`, `E'\''; BEGIN`, MySQL `'a\''; BEGIN`, `SELECT 1--1; BEGIN`, `/*! ; BEGIN */`. And the comment at sql.scrml ~:254 claims a miss is impossible.
- DIRECTION (do not do a third hardening round; S451 durable: "Text classification cannot prove a database query read-only; the runtime must enforce it"): make it FAIL CLOSED. Whenever the SQL text contains a construct whose quoting/commenting is dialect-dependent (`\`, `$`, `/*!`, `--` not followed by whitespace, `#`), ALSO run a plain split on every `;` with no string/comment awareness. Flag E-ERROR-015 if EITHER scan finds tx control.
- Accept the resulting false positives (e.g. `CREATE FUNCTION … $$ BEGIN … END $$` in a non-`!` function gets refused). Make the message say why, and that moving the query into a `!` function is the way out.
- Fix the false comment.
- Record in DESIGN.md, as a BINDING requirement on U1e (next to the S451 read-only one): outside a `!` function the runtime SHALL detect a transaction left open on the connection after a query (and roll back + report). The static check is best-effort; the runtime enforces.
- Leave `XA …` / `SET autocommit` as noted gaps.

MED-B — `blockYieldsOnAllPaths` (analyze ~:6453) checks only the last statement. `function h() { if (@n == 1) { return } return "a" }` used as an arm value compiles, and leaks undefined at runtime. A bare `return` at ANY depth means "may yield no value" → E-ERROR-012 (for callees with no declared return type).

LOW-B — credential redaction is incomplete (`?password=`, `;password=`, jdbc `&password=`, an unencoded `/` in the userinfo, `user:` echoed as a prefix).
- Fix at the root: E-SQL-005 and every db diagnostic SHALL NOT echo the `src=`/`db=` value at all. Name the recognized scheme/kind instead (e.g. "a MongoDB URL").
- Delete `redactDsn` if it becomes dead.
- Add a test with each of those shapes asserting the secret is absent.

LOW-C — over-refusal with a false message: a `fn` whose body ends in a TAIL EXPRESSION (`fn h() { "a" }`) is judged "produces no value". Count a `fn`'s tail expression as a value if the bootstrap gives `fn` implicit tail return (check how it lowers `fn` today; follow that, don't invent). Also: `return "a"` followed by dead code → the earlier unconditional return decides.

LOW-D — alternation `.A | .B :>` (§18.2, SPEC:16101) is unsupported in the bootstrap. Do NOT implement it now. Make its E-PARSE-ARM message say "alternation `|` between patterns is not yet supported in the bootstrap" instead of "expected `:>`", and list it as deferred.

LEAVE, noted only: LOW-A (a declared return type is trusted even when the body falls off — a missing-return check is a separate item; no SPEC code). LOW-E false positives beyond what MED-A's direction implies.

Verify: each repro has a test. All slices green by path; pre-commit green; counter PASS ≥119 (doc regenerated, `--check`); severity `--check`.
FINAL REPORT (<400 words): FINAL_SHA (== pushed tip), per item what was done, tests, counter, `git status` clean.
