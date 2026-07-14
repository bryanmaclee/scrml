# sPA ss67 → PA — RE-INTEGRATE `spa/ss67`

**List:** `spa-lists/ss67-conformance-serverdb-runtime.md` — conformance: serverDb data-flow RUNTIME (SQL §8 hydrate)
**Branch:** `spa/ss67` · **Base:** `40b580c5` · **Branch tip:** `db6028cd`
**Status:** COMPLETE — 4 authorable items `landed-on-branch`; items 5-6 `skipped` (no gap); 1 item `parked` → escalated below.

## What landed
New `conformance/cases/server-db/` category — 4 RUNTIME cases for the **server-fn → `?{}` SQL →
client-hydrate** round trip, driven by the `serverDb` server-eval driver (`runServer` evaluates the
REAL emitted route handlers; the `_scrml_sql` stub returns the seeded rows). **Every `state` +
`domAnchored` value empirically verified through `runServer`** before locking (README OQ4).

| case | query | contract |
|------|-------|----------|
| `sql-select-hydrate-rt`       | `.all()` | Row[] hydrates @users → `<each>` renders 2 `.row` + `#count` "Count: 2" (§8.3/§52.1) |
| `sql-get-single-row-rt`       | `.get()` | first row → single-object `state.current={id:1,name:Alice}` (state-only) |
| `sql-all-array-shape-rt`      | `.all()` | length-3 array shape → `#count` "3" |
| `sql-multi-table-sequence-rt` | 2× `.all()` | two server-fns, two DISTINCT seeded tables (users×2, posts×3; no JOIN) |

**HARD CONSTRAINT honored** (the SQL engine is a stub — regex `FROM <table>` → whole seeded table,
no WHERE/JOIN/write-back): every case seeds exactly the rows it asserts and uses **NO WHERE clause**
→ pure data-FLOW, correct against a real engine too (does NOT rely on the stub ignoring WHERE).

## Commits (in order)
- `b6e56a08` — the 4 `server-db/` cases (8 files, +156). Pre-commit full suite green (20028 pass / 0 fail).
- `db6028cd` — sPA bookkeeping: list marked landed + `spa-lists/ss67.progress.md`.

## Verification
- `bun conformance/run.ts`: **390/390 pass** (was 386, +4). All 4 `[runtime]`.
- Coherence: `main...spa/ss67` = 0 left / 2 right; main untouched at `40b580c5`.

## Items 5-6 — SKIPPED (no gap)
protect-on-DB-rows / SSR-of-DB-rows are already covered by the 5 existing green `protect/`+`ssr/`
serverDb cases; the list marked 5-6 explicitly optional ("only if a gap is found"). None found.

## ⚠ PARKED item → escalated (DEV prerequisite, NOT authorable in conformance)
The **SQL-engine-semantics runtime sub-surface** is BLOCKED: the conformance SQL driver is a stub
(`makeSqlStub`, impl1-ts.ts ~504-517) that regex-extracts `FROM <table>` and returns the whole
seeded table — it cannot evaluate WHERE / JOIN / aggregate / ORDER BY / write-back / transactions /
constraints. Those ~6-8 cases need a **real-DB conformance adapter (SQLite-backed `_scrml_sql`)**
first. This is a compiler/harness DEV task for the PA lane. **Ready-to-file `docs/known-gaps.md`
entry** (I did NOT write it to the PA-owned doc from this branch — you file it at re-integration):

```markdown
### g-conformance-sql-engine-semantics-stub — SQL runtime semantics unconformable (stub driver)
**Status:** OPEN (blocked — needs a real-DB conformance adapter). Surfaced sPA ss67 (2026-07-12).
**What:** The conformance serverDb driver's `_scrml_sql` is `makeSqlStub` (regex `FROM <table>` →
shallow copy of the ENTIRE seeded table). It evaluates NO SQL semantics — no WHERE, JOIN, aggregate,
ORDER BY/LIMIT, INSERT/UPDATE/DELETE `.run()` + `RETURNING` (§8.5.1), transaction atomicity + ROLLBACK
(§8.5.3), §8.7 `SqlError` variants, or UNIQUE/FK/CHECK enforcement (§39.5). So the RUNTIME halves of
those ~6-8 surfaces are currently UNCONFORMABLE — only SQL data-FLOW (rows reach client + render) is
testable, which ss67 covered (`conformance/cases/server-db/`, 4 cases, no-WHERE data-flow only).
**Fix (DEV prereq):** replace `makeSqlStub` with a SQLite-backed `_scrml_sql` in the conformance
adapter (seed from `serverDb` into a real in-memory SQLite, run the emitted `_scrml_sql` queries against
it). Then author the ~6-8 engine-semantics cases (WHERE-filter, JOIN, write-back+RETURNING, tx/rollback,
SqlError, constraint enforcement).
**Authority:** `spa-lists/ss67-conformance-serverdb-runtime.md` (PARK note) + SPEC §8.5/§8.7/§39.5.
```

## Observation (minor, non-blocking)
`sql-get-single-row-rt` is state-only because a nullable `<current> = not` cell interpolated into
markup (`${@current.name}`) derefs `not` and throws at first paint. Expected scrml behavior (read of a
`not` field), not a bug — noted so a future author doesn't render a pre-load nullable server-fn cell.

## Env note
Worktree `../scrml-spa-ss67` has `node_modules` symlinked from main. No `dist` needed (pre-commit
excludes browser tests; conformance runtime uses happy-dom + compiler `src`). Category named
`server-db/` (matches the `serverDb` driver; avoids the `sql/sql-*` stutter) — rename at re-integration
if you prefer `sql/`.
