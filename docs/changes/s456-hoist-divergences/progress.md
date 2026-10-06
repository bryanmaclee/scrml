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
