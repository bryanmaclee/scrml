# BRIEF-r4 — fix round r4 (archived verbatim, as relayed by PA)

PA → rulings-round agent: FIX ROUND r4, small and final. The r3 re-review is clean on every claim, but MED-A still fails open: tx control hides from both scans via SQLite `[bracketed]` identifiers (`SELECT 1 AS [it's]; BEGIN; SELECT 'x'`, `[a"b]`), `\f` / `\v` whitespace (`SELECT 1;\fBEGIN`), and a lone `\r` ending a Postgres `--` comment (`SELECT 1 -- x\r; BEGIN`). We stop enumerating dialect triggers. ROOT fix:
1. sql.scrml: ALWAYS run the plain `;` split (drop the `txDialectDependent` gate entirely); E-ERROR-015 if either scan finds tx control.
2. The plain scan (and `isSpace`, if both use it) treats every char ≤ 0x20 as whitespace.
3. The message: when only the plain split found it, say it may be inside a quoted string or a comment, and that moving the query into a `!` function (or binding the value as `${…}`) is the way out. Update DESIGN.md §4 and the scanner comment to say the plain split always runs (fail-closed, best-effort; runtime enforcement owed by U1e).
4. Tests: the four repros above fire; add one accepted false-positive test, `?{INSERT INTO t VALUES ('done; commit later')}` in a non-`!` function → E-ERROR-015.
5. NIT: suppress the follow-on `E-PARSE-EXPR … found '|'` after the alternation E-PARSE-ARM, if it's a one-line change; otherwise leave it.
Archive this message as BRIEF-r4.md, run the slices + pre-commit + counter (PASS ≥119, doc `--check`), push. Reply with only the FINAL_SHA, test counts and counter (≤120 words).
