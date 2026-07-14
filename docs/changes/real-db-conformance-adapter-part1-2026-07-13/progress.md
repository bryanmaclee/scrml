# progress — real-DB conformance adapter Part 1 (harness)

Branch worktree pwd: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a548f808c51a1861e

## 2026-07-13 startup
- Startup verify OK (pwd under agent- worktree, clean, bun install, pretest).
- Read: primary.map.md, SCOPE.md (forks A/B/C/D ruled), BRIEFING-ANTI-PATTERNS.md, impl1-ts.ts, run.ts, schema-differ.js, protect-analyzer.ts usage, SPEC §8 (5960-6524) + §19.8.1 (13286).
- Baseline conformance: 436/436 pass.

## Empirical probes (verified)
- Bun.SQL in-memory: `new SQL(":memory:")` works — tagged template, RETURNING, `.unsafe(sql,[params])`, WHERE binding all real. FK OFF by default (PRAGMA foreign_keys=0) — matches SQLite deploy default (opt-in). UNIQUE throws SQLiteError code SQLITE_CONSTRAINT_UNIQUE. `INSERT OR IGNORE` skips constraint violations silently.
- DDL derivation: extract `<schema>` body via regex -> `parseSchemaBlock` -> `generateCreateTable` produces correct DDL (UNIQUE/CHECK/REFERENCES). Verified seeding + JOIN + aggregate + CHECK.
- Emitted server strips: `import { SQL } from "bun";` + `const _scrml_sql = new SQL("sqlite:./app.db");` — the existing evalServerModule regexes match. `.get()` -> `(await _scrml_sql`...`)[0] ?? null`; `.all()`/`.run()` -> `await _scrml_sql`...``.

## BLOCKED dimensions (compiler gaps — surface to PA, do NOT author/hack)
- §8.7 SqlError ConstraintViolation via `!{}`: CLIENT emits the `__scrml_error` envelope dispatch (variant/data), but the SERVER handler emits NO try/catch mapping a thrown Bun.SQL error to a SqlError variant/envelope. A constraint-violating write on the server -> unhandled rejection, no envelope -> `::ConstraintViolation` arm can NEVER fire. `grep -rn SqlError compiler/src/` = zero.
- §8.5.3 transaction ROLLBACK: `transaction { }` block statement fires E-SCOPE-001 in the function-body parser and emits bare `transaction;` (block dropped). Unimplemented in the live pipeline for `${ function }` bodies. Even the canonical sample gauntlet-s20-sql/sql-transaction-001.scrml fails to compile.
- §39.5 constraint-as-scrml-error: same root as §8.7. UNIQUE/CHECK ARE enforced by the real DDL at the engine level; observable WITHOUT the error surface via `INSERT OR IGNORE` + COUNT (authored). FK OFF by default (not enabled by deploy) — not authored.

## ACHIEVABLE cases (8, all sqlEngine:"real")
1. sql-where-filter-rt (§8.2/8.3/8.4) — real WHERE param filters (stub returned whole table)
2. sql-insert-returning-rt (§8.5.1) — INSERT RETURNING row + follow-up COUNT reflects
3. sql-update-returning-rt (§8.5.1) — UPDATE RETURNING updated row
4. sql-delete-reflects-rt (§8.5) — DELETE + follow-up COUNT
5. sql-join-two-tables-rt (§8.3) — real JOIN across tables
6. sql-aggregate-group-rt (§8.3) — GROUP BY SUM aggregate
7. sql-order-limit-rt (§8.3) — ORDER BY DESC LIMIT
8. sql-unique-constraint-rt (§39.5) — real DDL UNIQUE via INSERT OR IGNORE + COUNT

## Plan / status
- [x] harness: real Bun.SQL path (makeRealSql) + evalServerModule sqlBinding + runServer sqlEngine + validation — committed dbb0183c (full suite green)
- [x] run.ts: sqlEngine field + plumb + validation — committed dbb0183c
- [x] author 8 cases — all PASS; each seam-verified (stub yields a different/wrong result for every one)
- [x] conformance green: 444/444 (436 unchanged + 8 new)
- [ ] full suite green + commit cases + clean status

## E-DG-002 authoring note
A `sqlEngine:"real"` case's result cell must be CONSUMED or E-DG-002 fires (unused reactive).
- Inline write `onclick=@cell = fn()` counts as consumption (case 1, sql-where-filter-rt).
- A named-handler write does NOT — add a guarded consumer `<p if=@cell>...</p>` (cases 2-8).
- `<program>`+`<schema>` cases (insert-returning, unique-constraint) use the guarded-consumer form; the plain-SELECT cases use file-level `${}` + loose-infer.

## sqlEngine:"real" seam (empirical stub-vs-real, all 8)
where-filter: stub=all 3 rows / real=2 admins · insert-returning: stub inserted=[] total={id:1,body:first} / real inserted=[{id:2,body:second}] total={n:2} · update-returning: stub=[] / real=[{id:1,qty:8}] · delete: stub={id:1,title:a} / real={n:2} · join: stub=raw books / real=joined {title,author} · aggregate: stub=3 raw / real=2 grouped · order-limit: stub=3 unsorted / real=top-2 desc · unique: stub={id:1,email} / real={n:1}
