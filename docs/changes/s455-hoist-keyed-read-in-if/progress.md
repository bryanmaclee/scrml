# progress — s455-hoist-keyed-read-in-if (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac0b2605613446744 (base ebd4be2d4 = origin/main). bun install + pretest OK.

## Maps
- primary.map.md: ZERO rows for §8.10 / Tier-2 hoist / batch-planner / `substituteHoistedSqlInBody` (grep `8.10|hoist|N+1` → only §14.8.10 tenant hits). NOT load-bearing. The locus came from grepping `client cannot evaluate` + the #1322 progress.md (load-bearing: it named the emit-control-flow §8.10 hoist as the site of its defect 11).

## Governing (compiler/SPEC.md §8.10 at ebd4be2d4, quoted)
- §8.10: "A for-loop whose body contains a single keyed `?{}` read SHALL be rewritten to a single `WHERE IN (...)` pre-fetch plus per-iteration `Map` lookup."
- §8.10.1 cond 2: "Loop body contains exactly one `?{}` block whose template matches `... WHERE <column> = ${x.<field>} ...`" — "contains": no depth restriction; the planner's detector (batch-planner.ts walkAst) walks every depth.
- §8.10.2: "`.get()` in the loop becomes `Map<key, Row>`; missing keys yield `not`, preserving §8.7." / "`.all()` in the loop becomes `Map<key, Row[]>` with per-key grouping; per-iteration lookup yields a possibly-empty array."
- §8.10.3: "The rewritten loop is observationally equivalent to the un-rewritten loop on all side-effect orderings."
- §8.10.4: "The key column is the column referenced by the single equality predicate in the `?{}` template."

## Reproduction at base ebd4be2d4 (real bun:sqlite via conformance runner; .tmp/gen.ts + .tmp/probe.ts)
Each case: a server fn over [{id:7},{id:8}] against notes(7→"hello") → @found; same over a declared-never-created table → @failed.
ORACLE = the identical source with `.nobatch()` (per-iteration queries): 38/38 PASS (found "hello,none"; failed: handled "none,none", unhandled "init" = host-backstop runtime error — pre-existing unhandled semantics, the oracle not the subject).
HOISTED at base: 5/38 PASS (direct-handled, direct-unhandled, inner-for ×2, ternary-unhandled — all with the key projected).
- every nested shape (in-if, in-else, else-if, nested-if, let-reassign-in-if) reads `not` on SUCCESS ("none,none"); handled failure throws past its arm ("init").
- `.all()` in if → `null.length` throws ("init").
- bare reassignment `row = ?{…}` DIRECT in the body → `const row` re-declared (E-CODEGEN-INVALID-LOGIC); handled → `var row` shadows `let row`.
- every `-noproj` (`SELECT body … WHERE id=`) → "none,none" even direct.
Emitted fragment (in-if-handled, case.server.js):
    for (const it of items) {
      if (( it . on )) {
      let _scrml__scrml_result_6 = null /* SQL query — client cannot evaluate _scrml_sql (E-CG-006); use a server-side function */;

## Root (traced)
Detector and rewriter disagree on the traversal. batch-planner.ts `collectLoopSqlSites` → `walkAst` visits EVERY
object/array child of the loop body (skipping span/id and `*Expr` mirrors), so a keyed read inside an `if` makes the
loop a Tier 2 candidate. emit-control-flow.ts `substituteHoistedSqlInBody` recursed ONLY into `clone.body` (its own
comment claimed "if-stmt.consequent, etc." — it never did). The nested read was left as a structured sqlNode; the
hoisted body was lowered by `emitLogicBody` with NO `boundary` (client mode) → `null /* client cannot evaluate */`.
#1322 fixed the handled guard one level down (guarded-expr → guardedNode) but kept the `body`-only recursion.
Same rewrite, also broken: (a) reassignment `row = ?{}` is a `_bareAssign` const-decl; stripping its sqlNode fell
to the plain `const row =` arm, and the hoisted body got no declaredNames (rebind undetectable) → re-declaration;
(b) the Map was keyed on `_r["<keyColumn>"]`, absent for `SELECT body`, `id AS x`, `n.id`; (c) `.get()` set() in a
loop = LAST row per key, not first.

## Fix (d5d4b8d2d — code + tests one commit)
- substituteHoistedSqlInBody: copy-on-write walk of the detector's own traversal; only the node holding the site
  drops its `*Expr` mirrors; handled guard handled at any depth; sqlNode substitution only for let/const/tilde-decl.
- emitHoistedForStmt returns null unless hits===1 and `loopBodyHasSqlSite(rewritten)` is false → caller emits the
  plain per-iteration loop (e.g. `return ?{}` in an if, base emitted `return null`).
- hoisted body lowers with the plain loop's opts (boundary, blockScoped(loopBodyDeclaredNames), serverFn names, …).
- emit-logic: `_bareAssign` const-decl with no sqlNode + rebind → assignment; handled guard `_bareAssign` rebind.
- batch-planner: `projectHoistKey` appends `, <keyColumn> AS __scrml_batch_key` (HOIST_KEY_ALIAS) to the outer
  SELECT list; refuses (D-BATCH-001) a list with a nested SELECT or unbalanced parens before the outer FROM.
  Emitter keys on the alias and `delete`s it; `.get()` keeps first row per key.

## Evidence
- Probe matrix (38 shapes): base 5/38 → head 38/38 (= .nobatch() oracle 38/38). Every head case verified HOISTED
  (2 "Tier 2 loop hoist" per server.js, 0 "cannot evaluate").
- 5 new runtime conformance cases: base runner FAIL ×5 (none,none / init / const-twice / "none"), head PASS ×5.
- unit s455-hoist-keyed-read-depth: 15 pass head; 14 fail on base compiler.
- Whole-corpus emit differential (scripts/corpus-emit-differential.ts, write:true; base = git archive ebd4be2d4):
  2368=2368 enumerated, 1426 compiled both, diagnostic CODE changes 0, syntax delta 0/0, bare server-fn 215=215.
  243 artifact diffs: 239 compiler-root path only (`_scrml_project_root`; normalized byte-identical), 2 host-import
  relative path (module/e-import-003, e-import-008 client.js), 2 REAL — the only two hoisted loops in the corpus:
  protect/e-protect-003-neg and server-db/sql-handled-hoisted-loop-rt server.js: alias projection + first-wins +
  sibling statements via the structured path (`out . push ( u )` → `out.push(u)`). No other artifact changed.
- conformance: 1294 pass + 50 xfail of 1344 (was 1289+50 of 1339; +5 new). Pre-commit gate: 31355 pass, 0 fail.
- for-loop-binder-mutability-s430 stub SQL updated to answer the aliased pre-fetch (it modelled the old SQL).
- types-gate --check OK (unchanged), s34-census OK, regen-spec-index --check OK, facts regenerated.

## Not fixed — listed with locus (not the same root)
- `?{}` inside a `match` block arm in a server fn → E-CG-006 + SyntaxError, with OR without .nobatch() — match-arm
  structured-body lowering on the server boundary (emit-control-flow match emission ~:2796), not the hoist.
- §8.10.3 failure timing (unhandled): the eager pre-fetch throws before iteration 1's side effects, and for a
  conditional site even when no iteration reaches it. Fix path: capture the pre-fetch error and re-raise at the site.
- Planner hoists shapes whose IN-rewrite is not equivalent: LIMIT/OFFSET (`… WHERE k = ${x.k} LIMIT 1` → one row
  total), aggregates/GROUP BY (`count(*)` → one row total), `OR <other> = ${y}` after the key (tupleRe only rejects
  AND; the other `${}` is left raw in the `.unsafe` string). Locus batch-planner.ts analyzeForLoop/extractKeyColumn.
  → CLOSED in round 2 (allow-list), below.

## Round 2 — S239 review on 0e253650 (LAND-WITH-NITS + fail-closed items) — 71d4bcaf9
Repro (real bun:sqlite; 0e253650 vs head vs `.nobatch()` oracle; head == oracle on every cell):
| item | 0e253650 | head = .nobatch() |
|---|---|---|
| I1 `'a FROM b' AS t` in SELECT | none,none,none (alias spliced into the string) | hello,bye,none (not hoisted) |
| P2 count(*) | 3,none,none | 2,1,0 |
| P2 max() | none,9,none | 8,9,null |
| P2 LIMIT 1 | hello,none,none | hello,zed,none |
| P2 OR kind='y' | 2,1,0 | 2,2,1 |
| P2 UNION / OR id=${it.alt} | throws (go aborts) | 2,2 / 2,1 |
| P2 GROUP BY | 1,1,0 (same by luck) | 1,1,0 |
| I2 `body AS __scrml_batch_key` | ",none" | hello,none |
| P3 items.splice(0,1) | none (evaluated twice) | hello |
| P3 duplicate key, write via row | hello!,hello!! | hello!,hello! |
| P1 `secret AS s` / `lower(secret)` / .all() | {"id":7,"s":"S7"} / {"id":7,"x":"s7"} / leak | {"id":7} / {} / [{"id":7}] |
| JOIN + AND without ${} (allowed) | not hoisted (tuple regex) | hoisted, hello/a,none |
Fix: hoist-sql-shape.ts token classifier + allow-list (builds the pre-fetch by token offsets); batch-planner
`protectBlocksHoist` (any protected column in the compile → a table with protected columns or not in declaredTables
is not hoisted; E-PROTECT-003 kept); tuple pre-check only rejects an AND carrying `${}`; emit-control-flow: iterable
into `let _scrml_batch_items_N` once (Array.from for non-arrays), `.get()` lookup `{ ...row }`, `.all()` lookup
`(… ?? []).map((_r) => ({ ..._r }))`.
Differential vs 0e253650 (git archive + the 2 new cases copied in): 2375=2375, compile delta 0, syntax delta 0, bare
218=218; 1 code change = the new protect case gaining I-PROTECT-STRIP-001 (its rows now pass the strip); 268 artifact
diffs = 240 compiler-root path + 2 host-import path + 26 in hoisted-loop fixtures only (e-protect-003-neg now
un-hoisted; sql-handled-hoisted-loop-rt + the S455 hoist cases: items var + row copy + id renumbering;
unrewritable-site: renumbering only). Gate 31389 pass / 0 fail; conformance 1296 + 50 xfail of 1346; types-gate OK.

## Known-gaps text (round 2 deferrals, for PA to file)
- g-impl1-hoist-key-type-coercion-s455 (MED, open) — the Map is keyed with JS `===`-semantics on the row's key value,
  while SQL `=` coerces: a text key (`{id: "7"}`) against an INTEGER column matches per-row but misses the Map → `not`.
  Locus emit-control-flow.ts emitHoistedForStmt (key normalization) / batch-planner (refuse when key type unknown).
- g-impl1-hoist-writes-between-iterations-unseen-s455 (MED, open) — the pre-fetch is taken before iteration 1; a write
  in the loop body (or a peer call) to the read table is visible per-row but not in the Map. §8.10.3 claims equivalence
  "on all side-effect orderings". Locus batch-planner.ts analyzeForLoop (refuse a body containing a write / a call).
- g-impl1-hoist-prefetch-failure-timing-s455 (LOW, open) — an unhandled pre-fetch failure throws before iteration 1's
  side effects, and for a conditional read even when no iteration reaches it. Fix: capture and re-raise at the read.
- g-impl1-hoist-batch-cap-throws-instead-of-chunking-s455 (MED, open) — §8.10.6: "If `xs.length` at runtime exceeds
  `SQLITE_MAX_VARIABLE_NUMBER`, the Tier 2 rewrite SHALL chunk the IN-list into segments of at most
  `SQLITE_MAX_VARIABLE_NUMBER` keys. If chunking is statically provable as impossible, **E-BATCH-002** fires at compile
  time; at runtime, an over-limit execution throws `SqlError::BatchTooLarge`." impl#1 never chunks: >32766 keys throws
  a plain Error with code "E-BATCH-002" at runtime. Locus emit-control-flow.ts emitHoistedForStmt (the cap line).
- g-impl1-match-arm-sql-server-boundary-s455 (MED, open; not hoist) — `?{}` in a `match` block arm in a server fn →
  E-CG-006 + SyntaxError, with or without .nobatch(). Locus emit-control-flow.ts match-arm structured-body emission.
