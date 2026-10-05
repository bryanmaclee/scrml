# progress — s454-conf-protect-floor (append-only)

- start: worktree agent-a088756d11ea33ad2, base b35593879; bun install + pretest OK.

## Shape x verdict (EXECUTED — seeded bun:sqlite, emitted handler in-process, pinned+CSRF-valid request)
protected col = users.passwordHash, seeded value SECRET-HASH-7f3a0b91 on row "alice".
Verdict legend: PASS-resolved (hash stripped by name, non-protected col survives) /
PASS-failclosed (whole row stripped to {}) / FAIL (hash in body).

- plain SELECT col ............... PASS-resolved   tag ["passwordHash"]
- SELECT * ....................... PASS-resolved   tag ["passwordHash"]
- table alias u.col .............. PASS-resolved
- case variants PASSWORDHASH/USERS PASS-resolved (case-insensitive origin)
- alias col AS x ................. PASS-resolved   tag ["x"] (origin-keyed)
- JOIN .......................... PASS-resolved
- RETURNING on INSERT ........... PASS-resolved
- RETURNING on UPDATE ........... PASS-resolved
- comment block around col ...... PASS-resolved
- comment line before col ....... PASS-resolved
- leading block comment ......... PASS-resolved
- lower-case leader ............. PASS-resolved
- .get() terminator ............. PASS-resolved
- bare ?{} value (.unsafe) ...... PASS-resolved
- ${} param w/ {/} chars (match)  PASS-resolved   tag survives brace in param
- quoted "col" .................. PASS-failclosed  strip-all "*"
- bracket [col] ................. PASS-failclosed  strip-all "*"
- backtick col .................. PASS-failclosed  strip-all "*"
- expr lower(col) ............... PASS-failclosed  strip-all "*"
- expr col || '' ................ PASS-failclosed  strip-all "*"
- expr substr(col,1) ............ PASS-failclosed  strip-all "*"
- scalar subquery in projection . PASS-failclosed  strip-all "*"
- subquery in FROM .............. PASS-failclosed  strip-all "*"
- CTE (WITH) .................... PASS-failclosed  strip-all "*"
- UNION ......................... PASS-failclosed  strip-all "*"
- mixed-case WiTh CTE ........... PASS-failclosed  strip-all "*"
- leading ; then SELECT (.all) .. FAIL  body [{"id":1,"name":"alice","passwordHash":"SECRET-HASH-7f3a0b91"}]
- leading comment then ; SELECT . FAIL  body [{...,"passwordHash":"SECRET-HASH-7f3a0b91"}]
- leading ; then SELECT (.get) .. FAIL  body {...,"passwordHash":"SECRET-HASH-7f3a0b91"}

Non-shapes (excluded — SQLite syntax error, not a floor test): leading `(`, a ${} param
with an unbalanced `{`/`}` that breaks SQL, VALUES(...) leader, leading-newline test-string artifact.
`;SELECT` (no space) returned [] from bun:sqlite (empty leading statement ran) so non-discriminating;
same untagged root as the FAIL shapes but not a demonstrable leak with this driver.

## Root of the FAILs (shared)
All three FAILs share ONE gate: resolveProtectedOutputColumns (protect-egress.ts:333).
`returningAsSelect` (strips noise, tests ^(insert|replace|update|delete)) misses a `;` leader, then
`isRowProducingQuery` (:174) runs /^(?:select|with)\b/ over stripLeadingSqlNoise(:148), which strips
leading whitespace + comments but NOT a leading `;`. Leader test fails -> returns null -> no tag ->
protectTagSqlResult (rewrite.ts:212) returns inner unwrapped -> driver row ships whole.
HYPOTHESIS CONFIRMED: an unresolved leader degrades to "no tag" (null), NOT to {all:true} strip-all.
This is the §14.8.9 fail-closed invariant ("unknown origin -> stripped wholesale, never none").
PA to file the gap; fix = fail closed on a non-SELECT/WITH leader (or strip a leading `;`). NOT fixed here.

## Test file
compiler/tests/conformance/conf-PROTECT-EGRESS-FLOOR.test.js — 26 pass / 3 skip (FAILs pinned as test.skip).
