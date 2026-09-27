# S436 — sqlite busy_timeout on COMPILER-OPENED handles (the CLI half of #1062)

## 1. REPRODUCED (own measurement, worktree @ de36da01, pre-fix)
`bun compiler/bin/scrml.js db-migrate <proj>/app.scrml --db sqlite:<proj>/mig.db`,
another process holding `BEGIN IMMEDIATE` for 1500ms:
- exit 1, `error: migration failed (rolled back): database is locked`, **129 ms** (no wait).
- uncontended control: exit 0, `applied 1 statement(s) in 1 transaction.`, 298 ms.
Relayed locus HELD: `commands/db-migrate.js:489` `new Database(path)`, no busy_timeout.

## 2. Class enumeration — 5 sqlite handle opens of 251 files searched
Population: `compiler/src/**` + `compiler/bin/**` + `compiler/scripts/**` (212 .ts/.js/.mjs)
plus top-level `scripts/**` (39). Patterns: `new Database(`, `new SQL(`, `new Bun.SQL(`,
`Database.open`, `bun:sqlite` / `node:sqlite` / `better-sqlite3` / `sqlite3` imports.

| # | site | disposition |
|---|------|-------------|
| 1 | db-migrate.js:489 `new Database(path)` | FIXED — the defect |
| 2 | protect-analyzer.ts:439 `new Database(p,{readonly:true})` | FIXED — WAL-recovery/checkpoint contention is real |
| 3 | protect-analyzer.ts:441 `immutable=1 \| SQLITE_OPEN_READONLY\|URI` | EXCLUDED — takes no locks at all |
| 4 | protect-analyzer.ts:532 `new Database(":memory:")` | EXCLUDED — no second process can contend |
| 5 | db-migrate.js:384 `new SQL(connStr)` | NOT SQLITE — postgres-only branch |
| 6 | introspect.js:153 `new SQL(...)` | NOT SQLITE — hard-gated postgres-only |

## 3. Fix shape
- NEW `compiler/src/sqlite-handle-defaults.ts` — zero imports, owns
  `SQLITE_BUSY_TIMEOUT_MS` (moved) + `configureSqliteHandle(db)`.
- `codegen/sqlite-defaults.ts` re-exports the constant (one definition, two shapes).
- src-root, not under `codegen/`: protect-analyzer's import block records that the stage
  does not pull a codegen module.
- `busy_timeout` ONLY. No `journal_mode=WAL` from any CLI path.

## Log
- [x] startup verification (5/5) + `bun install`
- [x] reproduced pre-fix
- [x] enumeration
- [x] db-migrate.js fixed + MEASURED: contended exit 0, applied, **1566 ms** vs 1500 ms hold
- [x] no WAL conversion: migrated file reads back `journal_mode=delete`, no `-wal`/`-shm`
- [x] uncontended with fix: exit 0, 145 ms, byte-identical stdout/stderr to pre-fix
- [x] protect-analyzer.ts:439 fixed. MEASURED contended (a separate process holding
      `locking_mode=EXCLUSIVE` + `BEGIN IMMEDIATE` for 1200ms, `-wal` present at probe time):
        same open shape WITHOUT the pragma -> THREW "database is locked" in **0 ms**
        the real `openSchemaReadHandle` WITH it -> OK, busy_timeout=5000, **1298 ms**
      Ordinary WAL write contention -> OK in 5ms either way (a WAL reader does not block on a
      writer's ordinary commits; the timeout is for the recovery/checkpoint-restart edge).
- [x] biting regression test: `compiler/tests/integration/sqlite-busy-timeout-compiler-opened-handles.test.js`
      8 tests. BITE PROVED by FILE-COPY flip (no checkout/stash): both call sites neutered ->
      exactly 2 red (one per fixed path), 6 green; restored -> 8/8 green.
- [x] direction-of-change: INERT. Corpus A/B, 1026 of 1026 .scrml files identical —
      3954 emitted artifact files byte-identical + all three diagnostic fields identical.
      (First probe was BLIND — wrong `compileScrml` signature, reported 0 artifacts and 0
      diagnostics across 1026 files. Rebuilt and proved sighted: 1004 with artifacts, 999
      carrying >=1 diagnostic, E-/W-/I- codes all present, BEFORE trusting the zero.)
- [x] types: the gate's exact tsc command by hand (scripts/types-gate.ts exit(2)s on this
      Windows clone — Unix path hardcode). ZERO diagnostics on the new file; the only two
      naming protect-analyzer.ts are pre-existing (`bun:sqlite` TS2307 @61, schema-differ.js
      TS7016 @84), neither on a line I added. 22 name-set deltas vs TYPES-BASELINE.json, none
      in any file I touched — pre-existing baseline drift on this clone.
- [x] docs/FACTS.md regen — `--check` now PASS. Delta is exactly this branch
      (209->210 src files, 264,557->264,701 lines, 1,502->1,503 test files).
- [x] FULL SUITE, both states, `bun run test`, judged by FAILURE NAME SET:
        BASE  98 distinct failing names
        BUILD 96 distinct failing names
        red only in BASE  = EXACTLY my 2 behavioural tests (the bite, at full-suite scale)
        red only in BUILD = **EMPTY**
      96 pre-existing failures identical across both states (browser/happy-dom,
      dev-server CLI, lsp, authed-server-fn-http, self-host-smoke — none in any file or
      subject this change touches).
      ⚑ COUNTS ARE NOISE on this box: two BUILD runs of the IDENTICAL commit gave 81 and
      98. Only the name set is meaningful, which is why the diff above is the evidence.
