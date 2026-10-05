# progress — s454-protect-failclosed (append-only)

- start: HEAD 79bd05028 (ff from origin/test/s454-conf-protect-floor), branch fix/s454-protect-failclosed

## Root (traced, HELD + widened)
resolveProtectedOutputColumns returned `null` (no tag) from a FAILED leader test:
`returningAsSelect` -> null when `^(insert|replace|update|delete)` missed, then
`!isRowProducingQuery` -> null when `/^(?:select|with)\b/` over stripLeadingSqlNoise missed.
A leading `;` misses both -> untagged -> row ships whole. Same "unknown -> none" inversion
found at three more exits (all EXECUTED as leaks on 79bd05028 with the conf harness):
- `out.size === 0` after an opaque scalar subquery over a VIEW the compile does not know
  (`(SELECT p FROM v)`): opaqueColumnMayCarryProtected only looked for protected identifiers.
- `RETURNING *;` -> list `*;` -> opaque entry, no `*` seen by lexSqlEntry -> null.
- `${ "{" } , passwordHash, ${ "}" }`: the SQL splitter brace-counts one interpolation, JS reads
  two; `, passwordHash,` reaches the DB as SQL the floor never saw.

## Fix
Inverted the default. `analyzeProtectStatement` lexes the body structurally (lexProtectSql) and
classifies select / write / no-rows / unknown; `unknown` (any non-recognized leader, >1 statement,
leading `;`, or a lexical form where DB tokenization may differ from the floor's views) -> {all:true}.
null only from: single DDL/txn statement; single RETURNING-free write; resolved SELECT/RETURNING with
no protected origin (nested SELECT now requires every FROM/JOIN source to be a known table).

## Direction of change (pa-base §8)
semantics-changed toward the contract: rows that shipped a protected column now don't (wholesale
strip). §14.8.9: "it is fail-closed on an unknown origin — a value whose origin the implementation
cannot determine is treated as carrying every protected origin it may carry (stripped wholesale, or
rejected where this section requires or permits a rejection), never as carrying none."
Fidelity gain: a trailing `;` no longer forces a wholesale strip.

## Early exits classified (resolveProtectedOutputColumns + helpers, after fix)
- analyze kind=unknown -> {all} [unknown]; kind=no-rows -> null [proof]; write w/o RETURNING token -> null [proof]
- returningAsSelect: lead miss (unreachable) -> {all}; no top-level RETURNING -> {all} (was null); empty list / no target / UPDATE…FROM -> {all}
- !proj.resolvable -> {all}; unknown FROM table -> {all}; opaque may-carry -> {all}; out.size===0 -> null [proof, now requires nested-SELECT sources known]
- before fix, FAILED-recognition null exits: returningAsSelect lead miss, returningAsSelect no top-level RETURNING (when nested), !isRowProducingQuery, out.size===0 over unknown subquery source.

## Tests
- conf-PROTECT-EGRESS-FLOOR: 36 pass (26 prior unchanged + 3 un-skipped + 7 new). Against base compiler: 9 fail (8 leaks + trailing-`;` fidelity).
- unit/protect-failclosed-classify.test.js: 68 pass.
- integration/g-sql-row-protect-leak: round-5 COUNT(*) subquery assertions now use a ctx where the subquery tables are known; unknown-table variant pinned as {all}.
- full gate (unit+integration+conformance): 28271 pass / 0 fail (28341 run).

## Corpus emit differential (base 79bd05028 via git-archive extract, head b2fe3b042)
2339 sources, 1410 compiled both sides, 11421 artifacts. Tool reported 222 artifact diffs + 1425
diag-text diffs: ALL path noise (absolute `_scrml_project_root`, relative import paths, out-dir
spelling). After normalizing the compiler-root path: 0 artifacts differ, 0 sources' compile output
(stdout+stderr incl. every diagnostic) differs. Tool verdict "INCOMPARABLE" is because the base was
an archive extract (no git revision), not a content issue.
Diagnostic delta: I-PROTECT-STRIP-001 49 -> 49; E-PROTECT-003/004/005/006 2/4/4/68 unchanged.
_scrml_protect_tag( occurrences 174 -> 174 across 102 artifacts. No tagged->untagged change; no
resolved->wholesale fidelity regression in the corpus.

## Fix round r2 (PA S239 review of 612e8c5ea — two more leaks, both also on base)
1. Lone CR inside a `--` comment. The received text depends on the lowering: template-literal paths
   (buildTaggedTemplate, emit-logic Branch A/C) hand the DB a COOKED template in which JS turned CR/CRLF
   into LF; `.unsafe(JSON.stringify(sql))` paths (rewrite bare, emit-logic Branch B / no-call) keep the
   CR, which SQLite reads as comment text and Postgres as a line end. No other path transforms the
   text (escSeg only escapes `\`, backtick, `${`; JSON.stringify is exact). The floor cannot know which
   text runs, so a lone CR (not followed by LF) inside a `--` comment -> unknown -> wholesale. CRLF
   reads the same everywhere (the comment ends) and still resolves. Normalizing CR->LF alone would be
   WRONG on the unsafe/SQLite path (`-- x<CR>'<LF>, passwordHash, '...` hides the column from a
   normalized reading while SQLite runs it).
2. A quoted RETURNING target was read as the placeholder `q` from blankSqlNoise. The target is now read
   from the ORIGINAL text at the matched span (d-flag indices) and folded with foldIdent; a target
   that does not fold to a plain identifier -> {all}.
Tenant subset lexer: refuses `--` and `/*` outright; CR is whitespace or string data -> no comment
disagreement possible. Other normalizeSqlText consumers: tenant-egress
acrossTenantInsertMissingTenantColumn fallback (non-subset `.acrossTenants()` INSERT head; a CR comment
could hide the head -> that check not firing; integrity, not confidentiality; NOT fixed, reported);
type-system.ts + bool-coerce.ts via extractSelectProjection (typing / bool decode, not security).
Executed: the 9 new conformance cases fail on 612e8c5ea (each body carries SECRET) and on 79bd05028.
r2 commit d1bb51a0d. Full gate 28295 pass / 0 fail. g-sql-row-protect-leak: `UPDATE "users" … RETURNING *`
now resolves to passwordHash (was strip-all only because no `q` was known in that ctx).
r2 differential (base 79bd05028 vs head d1bb51a0d, whole corpus 2339 sources; 319 contain `?{`, 108 of
those also `protect=`): after path normalization 0 artifacts differ, 0 compile outputs differ;
_scrml_protect_tag( sites 174/174, strip-all "*" tags 4/4; I-PROTECT-STRIP-001 49/49; E-PROTECT-003/004/005/006
unchanged. No tagged->untagged change.
