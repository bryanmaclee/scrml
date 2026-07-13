# SCOPE — real-DB conformance adapter (+ compile-time SQL validation)

**Authored:** S253, 2026-07-13 (PA scoping; NOT yet dispatched). **Origin:** known-gaps
`g-conformance-sql-engine-semantics-needs-real-db-adapter` (MED) + the ss66 Class B codes
(`g-spec-sql-schema-codes-zero-emission`). **Status:** scoped, awaiting fork rulings before dispatch.

## Goal — what this unblocks
1. **~6-8 SQL-engine-semantics RUNTIME conformance cases** currently BLOCKED by the stub:
   §8.5.1 writes / `RETURNING` · §8.5.3 transaction ROLLBACK · §8.7 `SqlError` variants (constraint
   violation / connection) · §39.5 UNIQUE / FK / CHECK constraints. These are real V1 freeze coverage.
2. **The 2 Class B ss66 compile codes** (E-SQL-002 "invalid SQL syntax", E-SCHEMA-005 "invalid
   `default(...)` SQL") — both spec'd as compile-time validation "via SQLite EXPLAIN / statement
   preparation" (§39.7 / §8.6). Same SQL-engine dependency; a distinct part (see Part 2).

## Current state — the stub's blindness
`conformance/adapters/impl1-ts.ts` → `makeSqlStub(db)` (L504-517): the `_scrml_sql` tagged-template
regex-extracts `FROM <table>` and returns a fresh copy of the case's seeded rows. **WHERE is not
evaluated; the `?N` params (`...v`) are ignored; no JOIN / aggregate / write-back / RETURNING /
transaction / constraint.** `evalServerModule` (L528-543) injects it in place of the emitted
`const _scrml_sql = new SQL(...)`. Cases seed via `ServerDb = Record<string, unknown[]>` (table→rows).

## The design

### Part 1 — the real-DB conformance adapter (HARNESS change; the primary ask)
**Fidelity insight:** the emitted runtime calls `_scrml_sql\`...\`` / `_scrml_sql.unsafe(sql, [params])`
against **`Bun.SQL`** (Bun's unified client — `import { SQL } from "bun"`), and Bun.SQL is available in
the Bun test runtime. So DON'T reimplement SQL — **instantiate a REAL `Bun.SQL` in-memory SQLite
instance, seed it, and pass it as `_scrml_sql`.** The emitted bytes are unchanged; the tagged-template
+ `.unsafe()` + param binding + WHERE/JOIN/tx/RETURNING/constraints/SqlError are all Bun.SQL's own —
identical to the real deploy. This is the maximum-fidelity, minimum-code path.

Shape (replacing `makeSqlStub` in `evalServerModule`):
1. `const sql = new SQL(":memory:")` (or the sqlite URL form Bun.SQL wants — verify the exact
   in-memory sqlite constructor Bun.SQL accepts).
2. **Seed with real DDL** (see Fork B): for each seeded table, `CREATE TABLE` (with types/constraints)
   then INSERT the case rows — reusing `schema-differ.js generateCreateTable` (already used by
   `protect-analyzer.ts` L469) so a case's own `<schema>` block IS the DDL.
3. Pass `sql` as the `_scrml_sql` param. Fresh DB per query-run is NOT needed (a fresh DB per CASE, or
   per ×3 determinism re-run, to stay hermetic — verify the redaction Symbol-tagging still round-trips
   on real rows, since the stub's fresh-copy comment [L512] was about keeping the seed pristine).
4. `SqlError` surface: Bun.SQL throws on constraint violation etc.; confirm the emitted `!{}` SqlError
   mapping (§8.7 / §19.8.1) catches them as it would in production (it should — same engine).

### Part 2 — compile-time SQL validation (COMPILER change; the 2 Class B codes)
Reuse the EXISTING `bun:sqlite` shadow-DB pattern already in `protect-analyzer.ts` (`import { Database }
from "bun:sqlite"; new Database(":memory:")`, L61/L340) — the compiler already spins up an in-memory
SQLite at compile time.
- **E-SQL-002** (invalid SQL syntax): `db.prepare(sql)` / EXPLAIN the `?N`-substituted template at
  compile; a thrown SQLite parse error → E-SQL-002.
- **E-SCHEMA-005** (invalid `default(...)`): EXPLAIN / prepare the default expression against the
  shadow DB.
This is a SEPARATE dispatch from Part 1 (compiler-source, not harness) but shares the SQLite dependency
and the Class B disposition. Sequence it AFTER Part 1 lands (Part 1 proves the engine seam).

## Forks — RULED (bryan, S253 "your leans")
**A = opt-in** (real engine gated on a new case field; existing cases keep the stub; migrate
incrementally — zero regression). **B = derive-from-`<schema>`, fallback loose-infer** (reuse
`generateCreateTable`; loose columns from row keys when no `<schema>`). **C = SQLite-only** (Bun.SQL
in-memory; Postgres/MySQL runtime semantics out of conformance scope). **D = two dispatches** (Part 1
harness first; Part 2 compiler EXPLAIN after). Full reasoning below.

## Forks (as originally posed — now RULED above)

- **Fork A — backward compat: opt-in vs migrate-all.** Switching `makeSqlStub` → real Bun.SQL CHANGES
  results for existing cases whose queries have a WHERE the stub ignored. Affected (grep-confirmed):
  `conformance/cases/server-db/{sql-select-hydrate,sql-multi-table-sequence,sql-all-array-shape,
  sql-get-single-row}-rt`, `conformance/cases/protect/{strip,reveal,cte}-*-runtime`,
  `conformance/cases/ssr/ssr-first-paint-*`. **(a) Opt-in (RECOMMENDED):** the real engine is gated on
  a new case field (`sqlEngine: "real"` / a `serverDbSchema`), existing cases keep the stub, migrate
  incrementally → zero regression. **(b) Migrate-all:** flip the default to real, re-baseline all ~9
  affected cases' `expected.json` in the same landing → cleaner end-state, higher risk. Lean: **(a)**,
  with (b) as a follow-on once the real path is proven.
- **Fork B — DDL source for constraints.** Constraint cases (§39.5 UNIQUE/FK/CHECK) need real DDL.
  **(a) Derive from the case's own `<schema>` block (RECOMMENDED)** — reuse `generateCreateTable`; the
  case is self-describing. **(b) A new case-declared DDL field** (`serverDbSchema`) — for cases with no
  `<schema>`. Likely BOTH: `<schema>` when present, else infer loose columns from row keys, else an
  explicit DDL field. Lean: **derive-from-`<schema>`, fallback loose-infer.**
- **Fork C — driver scope.** SPEC §39.4 enumerates SQLite/Postgres/MySQL column types. The conformance
  adapter is **SQLite-only** (Bun.SQL in-memory sqlite) — Postgres/MySQL semantics are out of
  conformance scope (they'd need a live server). Confirm: conformance pins the SQLite subset; the
  per-driver type-name validation (E-SCHEMA-004, Class A) is static and driver-agnostic. Lean: **confirm
  SQLite-only for conformance.**
- **Fork D — one dispatch or two.** Part 1 (harness) + Part 2 (compiler) are distinct surfaces. Lean:
  **two** — Part 1 first (harness/adapter; unblocks the 6-8 runtime cases), Part 2 after (compiler
  EXPLAIN; the 2 Class B codes), so Part 1's proven engine seam informs Part 2.

## Scope boundary
IN: SQLite semantics via real Bun.SQL; seed-from-`<schema>`; the 6-8 runtime cases; (Part 2) compile
EXPLAIN for E-SQL-002/E-SCHEMA-005. OUT: Postgres/MySQL runtime semantics; the Class C migration/
live-DB codes (E-SCHEMA-007/008/009/W-SCHEMA-003 — a different harness); performance.

> **⚠️ "SQLite-only" is a HERMETIC-HARNESS boundary, NOT a language narrowing (Rule 2).** scrml fully
> supports SQLite **and Postgres and MySQL** (§39.4 driver type sets; §38.13 realtime = Postgres
> LISTEN/NOTIFY). PG/MySQL are out of scope HERE only because *executing* their runtime semantics at
> conformance time needs a LIVE server (non-hermetic, CI-hostile), whereas Bun.SQL in-memory SQLite is
> hermetic. Their **compile-time** coverage is UNAFFECTED and driver-agnostic — E-SCHEMA-004 (Class A)
> validates column-type names against each driver's legal set, PG + MySQL included. Do NOT let this
> dispatch encode or imply "scrml is SQLite-only."

## Estimate + dispatch shape
- **Part 1** (adapter): ~MED. `impl1-ts.ts` `makeSqlStub`→real Bun.SQL + seed-DDL wiring + the opt-in
  field + author the 6-8 runtime cases (§8.5/§8.7/§39.5). A harness dispatch (general-purpose or
  codegen-engineer — it's harness TS, not compiler-source, but touches the emitted-JS contract).
- **Part 2** (compile validation): ~SMALL-MED. `type-system.ts`/schema-validation + reuse
  protect-analyzer's shadow DB; fire E-SQL-002/E-SCHEMA-005 + 2 conformance cases. Compiler-source
  dispatch (scrml-js-codegen-engineer) → S239 review.

## Acceptance
Part 1: `bun conformance/run.ts` green with 6-8 NEW runtime cases exercising real WHERE/JOIN/write/
RETURNING/tx-ROLLBACK/constraint-violation; existing cases unaffected (Fork A=a) or re-baselined
(A=b). Part 2: E-SQL-002 + E-SCHEMA-005 fire on invalid SQL / bad default, with conformance cases;
these two drop off `g-spec-sql-schema-codes-zero-emission` (Class B).
