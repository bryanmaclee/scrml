# progress — s456-hoist-divergences (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2f749e5bfda8f7b8 (base 2dd6d35d9 = origin/main). bun install + pretest OK.

## Maps
- primary.map.md S455 READ-FIRST block: "§8.10 hoisting is allow-list-only (`hoist-sql-shape.ts` `classifyHoistableQuery`) ...
  `emitHoistedForStmt` returns null -> loop emitted un-hoisted" + structure.map.md "FILE INVENTORY — §8.10 N+1 HOISTING"
  (symbol anchors: `substituteHoistedSqlInBody` :1009, `emitHoistedForStmt` :1150, call site :723, `HOIST_KEY_ALIAS` :493,
  `protectBlocksHoist` :500) — all anchors held at 2dd6d35d9. LOAD-BEARING for locus (saved the grep pass).
- s455-hoist-keyed-read-in-if/progress.md: load-bearing — its "Known-gaps text (round 2 deferrals)" names the four items.

## Governing (compiler/SPEC.md §8.10 at 2dd6d35d9, :9255-:9317, read in full, quoted)
- §8.10.3: "Per-iteration `Map` lookup preserves loop-iteration order for all body side effects — `lift`, reactive writes
  (`@x = ...`), nested server calls, `fail`, `break`, early `return`. The rewritten loop is observationally equivalent to
  the un-rewritten loop on all side-effect orderings."
- §8.10.2: "`.get()` in the loop becomes `Map<key, Row>`; missing keys yield `not`, preserving §8.7." / "`.all()` in the
  loop becomes `Map<key, Row[]>` with per-key grouping; per-iteration lookup yields a possibly-empty array."
- §8.10.6: "If `xs.length` at runtime exceeds `SQLITE_MAX_VARIABLE_NUMBER`, the Tier 2 rewrite SHALL chunk the IN-list
  into segments of at most `SQLITE_MAX_VARIABLE_NUMBER` keys. If chunking is statically provable as impossible,
  **E-BATCH-002** fires at compile time; at runtime, an over-limit execution throws `SqlError::BatchTooLarge`."
  + "Cap override (S79 amendment). The default cap is `32766` ... `<program batch-in-list-cap=>` ... The override changes
  BOTH the runtime check threshold AND the diagnostic message text emitted into the compiled output."
- §8.10.1: "A for-loop that *almost* matches ... but fails one condition SHALL produce **D-BATCH-001** with the specific
  near-miss reason."

## Reproduction at base 2dd6d35d9 (real bun:sqlite via conformance/adapters runServer; .tmp/probe.ts)
Seed notes(7 hello, 9 nine), tags(1 '7'->7, 2 'x'->7, 3 'y'->9), `gone` declared never created.
| case | hoisted | .nobatch() oracle |
|---|---|---|
| (1) keys "7",7,"x" vs INTEGER id | none,hello,none | hello,hello,none |
| (1) keys 7,"7" vs TEXT name (.all count) | 0,1 | 1,1 |
| (2) write via called fn between iterations | hello,hello | hello,hello! |
| (2) write in `transaction {}` in body | (not hoisted) hello,hello! | hello,hello! |
| (3) unhandled, read never reached (pre-fetch fails) | init (threw) | skip,skip |
| (3) unhandled, read reached | init | init |
| (3) handled, unreached / reached | skip / failed,failed | skip / failed,failed |
| (4) cap=2, 4 keys .get() | init (E-BATCH-002 thrown) | hello,none,nine,hello |
| (4) cap=2, 4 keys .all() | init (E-BATCH-002 thrown) | 7+x,,y,7+x |
All four REPRODUCED. Emitted fragment (k1, server.js):
    const _scrml_batch_rows_4 = ... _scrml_sql.unsafe("SELECT body, id AS __scrml_batch_key FROM notes WHERE id IN (__SCRML_BATCH_IN__)"...)
    for (const _r of _scrml_batch_rows_4) { const _k = _r["__scrml_batch_key"]; ... _scrml_batch_byKey_5.set(_k, _r); }
      const row = (_scrml_batch_byKey_5.has(it.id) ? { ..._scrml_batch_byKey_5.get(it.id) } : null);
    if (_scrml_batch_keys_2.length > 32766) { ... throw _e; }

## Also found while reproducing (same surface)
- (x) a key the loop body changes before its read (`it.id = it.id + 1`): base hoisted "none,none" vs per-row "hello,nine"
  (the Map only held the pre-fetch keys) — silent. Fixed with (1): a key not pre-fetched is fetched when its read runs.
- (y) Postgres: the base pre-fetch's `?N` placeholders are rejected by PG (measured via Bun.SQL on the local PG16 socket:
  `operator does not exist: ? integer`) — every hoisted loop on a Postgres app failed at runtime. Gated (below).

## Roots + fixes (locus hints: emitHoistedForStmt HELD; analyzeForLoop HELD for (2) + dialect; hoist-sql-shape HELD for (1);
## substituteHoistedSqlInBody NOT the locus of any of the four — unchanged except the read replacement string)
- (1) root: emitHoistedForStmt keyed a JS Map on the projected key VALUE (identity) while SQL `=` applies the column's
  affinity/collation. Fix: hoist-sql-shape builds the pre-fetch as the query joined (comma join, after every source) to a
  key table `(SELECT column1 AS __scrml_batch_key, column2 AS __scrml_batch_val FROM (VALUES (0, ?1), …)) AS __scrml_batch_k`
  with `<key> = __scrml_batch_k.__scrml_batch_val`; SQL tags each row with the slot of the key it matched; the loop reads by
  slot. Executed equal to per-row on INTEGER / TEXT / TEXT COLLATE NOCASE / BLOB / REAL / NUMERIC columns with 14 mixed keys
  (unit test). Chose this over "normalize in JS" (needs every column's affinity + collation, unknown for raw DDL / undeclared
  tables) and over "refuse when types unprovable" (the key's JS type is a runtime fact — that refusal would refuse nearly
  every hoist). The key-table route is exact by construction: the SAME `=` decides.
- (2) root: analyzeForLoop only counted `?{}` sites in the body (cond. 4); nothing looked at calls. Fix: new
  compiler/src/hoist-write-scan.ts — hoist only a body PROVEN not to write: bare calls to write-free local functions
  (transitive least fixpoint) / built-in globals; member calls only on a built-in namespace, or a declared non-imported
  root with a built-in method name while no writer escapes in the compilation (a writer referenced by value, a lambda
  calling one, or ANY call into a module outside the compilation); `transaction {}`, foreign blocks, non-SELECT `?{}`
  (fail-closed lexical test) = write. D-BATCH-001 names the call. Residual (not modelled, NOT probed): a writer-bearing
  value reaching a declared local with no call to / reference of an import on the path (e.g. a host global read through
  a declared alias such as `const g = globalThis` — `globalThis` itself is an undeclared root and refused, but its alias
  is declared). A data-flow analysis would close it; this scan does not.
- (3) root: the pre-fetch `await` ran unguarded before the loop. Fix: the pre-fetch is caught into `_failure`; the
  per-iteration read (`await _read(key)`) throws it (unhandled) or returns the SqlError envelope (handled) — first read
  that RUNS. A loop whose read is never reached does not fail.
- (4) root: the cap line threw. Fix: `_fetch(keys, base)` loops chunks of at most `batch-in-list-cap` (default 32766)
  distinct keys; each distinct key is in exactly one chunk so `.get()` first-row / `.all()` grouping are per-key exact.
- dialect: hoistDialectReason (batch-planner) — every db handle of the compilation must be a literal SQLite target, else
  D-BATCH-001 and the per-iteration loop (which works on PG).

## Evidence
Per-item, conformance cases on real bun:sqlite (`.tmp/runcases.ts`, hoisted vs `.nobatch()`), base = 2dd6d35d9 worktree:
| case (cells) | base hoisted | head hoisted | .nobatch() |
|---|---|---|---|
| key-affinity textKey/numKey/keyChanged | none,hello,none / 0,1 / none,none | hello,hello,none / 1,1 / hello,nine | = head |
| write-between viaCall/viaNested/viaCallback | hello,hello / nine,nine / eleven,eleven (3 hoisted) | hello,hello! / nine,nine!! / eleven,eleven! (0 hoisted) | = head |
| prefetch-failure unreached/handledUnreached/handledReached | init/init/init | skip,skip / skip / failed,skip,failed | = head |
| chunked (cap 2) firstRows/allRows | init/init | hello,none,nine,hello,ten / a+b,,y,a+b,z | = head |
Verify-only gaps (reproducer cases in .tmp/cases, runcases vs f0925b6e4 = pre-#1325, 2dd6d35d9, head):
- g-nplus1-hoist-keys-map-by-unselected-column: f0925b6e4 hoisted "none,none,none" vs per-row "a,b,c"; 2dd6d35d9 and head
  "a,b,c" (hoisted). CLOSED by #1325 (9c556dc74 key projection), still closed under the key table.
- g-hoisted-loop-write-to-an-outer-let-emits-a-tdz: IS the hoist path (emitHoistedForStmt lowered the body without the
  enclosing declaredNames). f0925b6e4 hoisted count=0 vs per-row 2; 2dd6d35d9 and head count=2, emitted `n = n + 1;`.
  CLOSED by #1325 (hoisted body lowers with the plain loop's opts). Pinned in s456-hoist-divergences.test.js.
Whole-corpus emit differential (scripts/corpus-emit-differential.ts, write:true captures; base = `git worktree` at
2dd6d35d9 + the 4 new cases copied in; head = d4931efe9): 2379 = 2379 enumerated, 1437 compiled both, compile-failure delta
0, diagnostic-CODE changes 0 (the first run showed 9 = W-CG-UNDEFINED-INTERPOLATION from `_hit === undefined` in the
hoisted read — fixed in 024344428), syntax delta 0/0, bare server-fn 218 = 218. 1452 diagnostic-TEXT-only = the capture's
output-dir presentation (`<OUT>` vs `.tmp/diff-head` — the head work dir sat under its compiler root): normalized, all 1452
identical. 276 artifact diffs: 242 compiler-root path only; 2 host-import relative path (module/e-import-003, e-import-008
client.js); 22 = client.js + html of the 11 hoisted-loop fixtures, genVar renumbering only (normalized identical); 10
server.js of hoisted-loop fixtures: 9 differ ONLY in the hoist preamble + the read expression (normalized residual none),
1 (write-between-iterations) = its 3 loops no longer hoisted (intended). Loops that stopped hoisting corpus-wide: 3, all in
conformance/cases/server-db/sql-hoisted-loop-write-between-iterations-rt (the new case); 0 pre-existing corpus loops
(base 39 hoisted loops in 10 artifacts → head 36 in 9). examples/ + samples/ hoist 0 loops on both sides.

## Tests
- Pre-commit gate (unit + integration + conformance + tests/*.test.js): 31423 pass, 0 fail.
- conformance: 1300 pass + 50 xfail of 1350 (was 1296 + 50 of 1346; +4 new cases).
- Full `bun run test` (compiler/tests/, incl. browser): head 33806 pass / 104 skip / 50 fail. Same command on a 2dd6d35d9
  worktree (pretest run, the 4 new cases copied in): 33767 / 108 / 56. The head's 50 failures are an exact subset of the
  base's 56 (all browser-suite + detector-validation + esm-script-tag — pre-existing whole-suite failures); the base's 6
  extra = the 4 new conformance cases (fail on base, pass on head) + 2 TodoMVC dist-not-compiled (base worktree env).
  0 new failures.
- types-gate OK (unchanged 190/119), s34-census PASS, regen-spec-index OK, facts + state --check OK after regen.

## Not done / for the PA
- SPEC (not edited): §8.10.1's detection list does not name "the body may write" as a near-miss condition, though §8.10.3
  requires it; §8.10.6's cap paragraph says the override changes "the runtime check threshold AND the diagnostic message
  text" — with chunking there is no runtime check/message, the cap is the chunk size. Both want a SPEC sentence.
- Observed, not filed (unverified vs SPEC): a state cell named `<get>` / `<all>` gives E-STATE-UNDECLARED +
  E-UNQUOTED-DISPLAY-TEXT (the chunked case was renamed to firstRows / allRows).

## Fix round 1 (S239 review of e7671481c = LAND-WITH-NITS) — merged origin/main (#1329, #1330) first; FACTS + gap-counts regenerated
### F1 — one unbindable key failed every read (pre-existing; §8.10.3)
Repro (real bun:sqlite; keys 7, {a:1}, 9, 8; handled `!{ .QueryFailed(m) :> "QF" _ :> "other" }`; .all() keys [1,2], 7):
| | 2dd6d35d9 | e7671481c | head | .nobatch() |
|---|---|---|---|---|
| handled .get() | QF,QF,QF,QF | QF,QF,QF,QF | hello,QF,nine,none | hello,QF,nine,none |
| handled .all() | 0,0 | 0,0 | 0,1 | 0,1 |
| unhandled (executed handler, stub driver) | throws before iter 1 | throws at iter 1's read | iter 1 completes, throws at iter 2's read, iter 3 never starts | = head |
Fix: the pre-fetch never raises. Each chunk marks its keys LOADED only when its query succeeds; a read whose key is
not loaded runs the same key-table query for that ONE key (through `_scrml_sql_attempt` when handled) — the
per-iteration query at the per-iteration moment. Subsumes the changed-key path; the held-failure variable is gone.
Unhandled order pinned by an executed test (items are the test's own objects; `it.seen` / `it.got` after the throw;
driver call log `["7|obj|9", "7", "obj"]`); that test FAILS on e7671481c. Conformance: server-db/sql-hoisted-loop-unbindable-key-rt.
### F2 — any out-of-compilation import call switched hoisting off program-wide (INTRODUCED by 0d5369b00/d4931efe9)
Fix: PURE_STDLIB_MODULES (math, format, regex, path, crypto, random, data, time — read by hand: no `?{}`, network, fs)
are write-free and never escape; an import from a `.scrml` file in the compilation links to that file's write facts
(nameMayWrite, fixpoint across files); host `.js`, packages and the other stdlib modules (store, http, fs, auth, …) stay
fail-closed. Fixture set (.tmp/fx, realistic read-only loops; hoisted count per tree; runtime = real emitted server
module + real SQLite file, POST each route, hoisted vs `.nobatch()`):
| fixture | 2dd6d35d9 | e7671481c | head | runtime head == .nobatch() |
|---|---|---|---|---|
| fx1 no imports (2 loops) | 2 | 2 | 2 | yes |
| fx2 `round` (scrml:math) in markup only | 2 | 0 | 2 | yes |
| fx3 `capitalize` (scrml:format) in the body | 1 | 0 | 1 | yes |
| fx4 math+time+format imported, `truncate` in body | 2 | 0 | 2 | yes |
| fx5 helper from an in-compilation .scrml module | 2 | 1 | 2 | yes |
| fx6 CONTROL: writer from an in-compilation module | 1 | 0 | 0 | (decision only — the module's write lands on another connection in this harness) |
| fx7 CONTROL: `createStore` (scrml:store) in the function | 1 | 0 | 0 | (decision only) |
| TOTAL | 11 | 3 | 9 | |
(base's fx6 / fx7 hoists are the S456 write-scan refusals; the 2 "lost" vs base are exactly the two controls.)
### F3 + reviewer-found pre-existing — filed, not fixed
- g-impl1-hoist-set-grown-during-loop-s456 (hoisted "hello" vs per-row "hello,nine"; same at 2dd6d35d9).
- g-object-method-shorthand-emits-an-empty-property (`{add: }`, client.js, exit 0; same at 2dd6d35d9).
- g-assignment-rhs-with-embedded-sql-emits-a-dangling-operator (`n = n +;`, server.js, exit 0; same at 2dd6d35d9; not hoisted).
