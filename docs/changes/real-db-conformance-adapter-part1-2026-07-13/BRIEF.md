# BRIEF — real-DB conformance adapter, Part 1 (harness): real Bun.SQL + 6-8 runtime cases

**Change-id:** `real-db-conformance-adapter-part1-2026-07-13`
**Agent:** scrml-js-codegen-engineer, isolation:"worktree". **Origin/design:**
`docs/changes/real-db-conformance-adapter-2026-07-13/SCOPE.md` (read it first — the forks are RULED).
**Ruling recap (bryan S253):** A=opt-in · B=derive-from-`<schema>`+fallback-loose · C=SQLite-only
(HERMETIC-harness boundary, NOT a language narrowing — do NOT imply scrml is SQLite-only) · this is
Part 1 (harness) of two (Part 2 = compiler EXPLAIN, separate/later).

⚠️ **PARALLEL DISPATCHES LIVE.** You own a DISJOINT surface: `conformance/adapters/impl1-ts.ts` +
`conformance/run.ts` (the opt-in field) + NEW cases under `conformance/cases/server-db/`. Do NOT touch
`compiler/src/**`, `compiler/SPEC.md`, or `conformance/cases/{schema,sql,error}` (other live dispatches
own those). Declare your touched files in the report.

---

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first; follow §"Task-Shape Routing". This is a CONFORMANCE-HARNESS
task (not compiler-source) — the relevant surface is `conformance/`. Report the load-bearing finding
(or "not load-bearing").

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Echo your real `pwd` = WORKTREE_ROOT.
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` — if under any
   OTHER repo, STOP + report (S90 CWD-routing). 2. `git rev-parse --show-toplevel`==WORKTREE_ROOT.
   3. `git status --short` clean. 4. `bun install`. 5. `bun run pretest`. Any fail → STOP + report.
- Write/Edit via ABSOLUTE paths under WORKTREE_ROOT; prefer Bash-edit; NEVER `cd` into main; use
  `git -C "$WORKTREE_ROOT"` / `--cwd "$WORKTREE_ROOT"`. First commit msg includes startup `pwd`.
- Commit after every edit; keep `progress.md`; clean `git status` before DONE.

---

## THE TASK

### 1. Real Bun.SQL adapter (the seam)
Today `conformance/adapters/impl1-ts.ts`:
- `makeSqlStub(db)` (~L504-517): the `_scrml_sql` tagged-template — regex-extracts `FROM <table>`,
  returns a copy of the seed's rows; **WHERE ignored, `?N` params ignored, no JOIN/write/tx**.
- `evalServerModule(serverJs, html, db)` (~L528-543): strips `import { SQL } from "bun"` +
  `const _scrml_sql = new SQL(...)`, injects `makeSqlStub(db)` as the `_scrml_sql` param.
- `ServerDb = Record<string, unknown[]>` (~L486): table→rows.

**Build the real path (opt-in — Fork A):** when a case opts in (see field below), instead of
`makeSqlStub`, stand up a **REAL Bun.SQL in-memory SQLite** and pass IT as `_scrml_sql`:
1. `const sql = new SQL(<in-memory sqlite form>)` — **verify the exact constructor Bun.SQL accepts for
   in-memory sqlite** (e.g. `new SQL("sqlite://:memory:")` or `new SQL({ adapter:"sqlite",
   filename:":memory:" })` — check Bun's SQL docs/API; it must be the SAME engine the runtime uses so
   the emitted `_scrml_sql\`...\`` + `_scrml_sql.unsafe(sql,[params])` behave identically to deploy).
2. **Seed with real DDL (Fork B):** for each table, `CREATE TABLE` then INSERT the case rows. Derive
   the DDL from the case's own `<schema>` block via `schema-differ.js generateCreateTable` (the same
   helper `protect-analyzer.ts` L469 uses); when the case has NO `<schema>`, infer loose columns from
   the first row's keys (TEXT/INTEGER/REAL by JS type). Constraints (UNIQUE/FK/CHECK, §39.5) come from
   the `<schema>` DDL — that's what makes the constraint cases fire.
3. Hermeticity: a FRESH DB per case (and re-seeded for the ×3 determinism re-run). Confirm the
   `_scrml_protect_tag` Symbol-descriptor redaction (the L512 note) still round-trips on real rows.
4. Do NOT alter the emitted server bytes — only the `_scrml_sql` binding.

### 2. The opt-in field (Fork A — zero regression)
Add an opt-in selector to the case `expect` schema in `conformance/run.ts` (near `serverDb?`, ~L81) —
e.g. `sqlEngine?: "stub" | "real"` (default `"stub"`). A case with `sqlEngine:"real"` runs the real
Bun.SQL path; **every existing case (no field) keeps the stub and MUST still pass unchanged.** (If a
`<schema>`-derived DDL is required for real mode, presence of `sqlEngine:"real"` implies the case must
carry a `<schema>` or a loose-inferable seed — validate + give a clear harness error if not.)

### 3. Author 6-8 real-semantics runtime cases (under `conformance/cases/server-db/`)
Mirror the existing pattern — `case.scrml` + `expected.json` with `expect:{ serverDb, input, state /
firstPaint, sqlEngine:"real" }` (study `conformance/cases/server-db/sql-get-single-row-rt/` for the
shape). Each new case has a `<schema>` block (real DDL) + `serverDb` seed + assertions that exercise
REAL engine semantics the stub cannot:
- **§8.5.1 write + `RETURNING`** — an INSERT/UPDATE `?{}` returns the written row; assert the returned
  shape + a follow-up SELECT reflects the write.
- **§8.5.3 transaction ROLLBACK** — a `transaction { }` that fails mid-way leaves the DB unchanged.
- **§8.7 `SqlError` — constraint violation** — an INSERT violating UNIQUE/CHECK/FK throws → the `!{}`
  arm matches `::ConstraintViolation` (per §19.8.1); assert the error-path state.
- **§39.5 UNIQUE / FK / CHECK** — the constraint is enforced by the real DDL (seed a violating row or
  drive a violating write).
- **A real `WHERE`-filter SELECT** — a query whose WHERE actually filters (the stub returned the whole
  table); assert the filtered result, proving the engine seam.
Pick 6-8 spanning these; name them descriptively (`sql-insert-returning-rt`, `sql-tx-rollback-rt`,
`sql-unique-violation-rt`, `sql-where-filter-rt`, `sql-fk-violation-rt`, …). Cite the §.

### Gates (NO --no-verify)
- `bun conformance/run.ts` green — existing cases UNCHANGED (zero regression is the Fork-A promise) +
  your 6-8 new cases pass.
- `bun run test` (FULL suite) green.
- If the Bun.SQL in-memory constructor or the emitted `_scrml_sql`/`.unsafe` contract doesn't behave as
  expected, STOP + report the exact mismatch — do NOT hack around the emit contract.

### Report
- WORKTREE_ROOT, FINAL_SHA, FILES_TOUCHED (should be only the disjoint surface above), deferred.
- The opt-in field's exact name/shape + where it plugs into `run.ts`.
- The Bun.SQL in-memory constructor form that worked.
- Per-case: the § + the real-semantics dimension it pins.
- Confirmation the existing server-db/protect/ssr cases are byte-unchanged and still green.
- NOTE: `/code-review` is not invokable in-agent — the PA runs the mandatory adversarial review before
  landing.
