# SCOPE — the migrate/differ consumer and raw-DDL `<schema>`

**Status:** `current` · **Deferred from:** the S405 dpa-039 arc B (split ruled by bryan:
*"split arc b, land the tenant half. re-scope the other half"*) · **Owner:** unassigned

## Why this is its own arc, and not a follow-up ticket

`extractDesiredSchema` has **two consumers with genuinely different needs**: the §14.8.10 tenant
floor wants every `<schema>`-declared table including raw `CREATE TABLE` DDL; the migrate/differ
consumer was built for the declarative DSL only and treats an unrecognized table as *absent*.

Arc B landed the tenant half and made the migrate consumer **decline raw tables at its own
boundary** — one line in `db-migrate.js`. `diffSchema` is now **902 code lines identical to
`origin/main`**, verified. So the migrate path is exactly where it was before dpa-039, and this arc
is about moving it forward deliberately rather than as a side effect.

⚑ **Four findings were measured against the un-split version and all four evaporated by
construction when the consumer declined.** They are recorded here because they are what a
raw-DDL-aware migrate path must handle — not because they are live on `main` today. **Do not open
this arc by "fixing" them; they do not currently reproduce.**

## The four, as design constraints

1. **Case folding.** Raw-DDL table names carried author casing into a case-SENSITIVE map, so
   `CREATE TABLE Assets` + an `assets` row in the DB produced `W-SCHEMA-PLAN-WITHHELD` **and**
   `W-SCHEMA-DESTRUCTIVE-DROP` for one table — and, with `--allow-destructive`,
   `DROP TABLE IF EXISTS "assets";`. Postgres folds unquoted identifiers; the differ did not.
   ⚑ The tenant half solved its half of this **in the container** (`TenantTableSet` folds on `add`
   AND `has`), which is the shape to copy.
2. **An empty plan and a suppressed plan are different states.** `printPlan` renders a withheld plan
   as green `plan: up to date — 0 statements.`; its filter knew only `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED`.
   The file's own prose already forbids this conflation.
3. **The Postgres APPLY path never printed warnings at all** — dry-run and SQLite did. Silent on the
   one path that mutates the database.
4. **The §14.8.11 grant loop iterated the unfiltered table set**, emitting `GRANT … ON "assets"` for
   a table the same plan refused to create → `relation does not exist` → whole migration rolled back.

## Also owed here — two recognizer defects that travelled with the tenant half

Both are **narrow, non-destructive, exit-0 inertness**, deliberately not chased during the split:

- `isTableLevelConstraint` eats a column named `key` / `index` when its type carries non-numeric
  arguments — `key GEOMETRY(Point, 4326)`, `key ENUM('a','b')`. The numeric-arg heuristic covers
  `VARCHAR(50)`-shaped types only. ⚑ `like` is genuinely undecidable by a leading-word test and is
  correctly handled by the grammar instead (`LIKE` is reserved, so a column named `like` must be
  quoted) — **do not replace that with a heuristic.**
- Three-part qualified `CREATE TABLE db.schema.table (…)` matches nothing, so the tenant floor is
  inert for it at exit 0, and `W-SCHEMA-NO-TABLES-DECLARED` does not cover it (it fires only at zero
  tables *total*).

## And one stale comment, in this arc's territory

`compiler/src/schema-differ.js:307` still reads *"`diffSchema` accordingly SKIPS `rawDdl` tables"*.
That stopped being true when the decline moved to the consumer's boundary. **Correct it as part of
this arc** — this file's correctness is carried by its comments, and a comment asserting a falsehood
about the current tree is the rot the §34 provenance resolver exists to stop.

## The lesson this arc exists to encode

Rounds 2 and 3 of arc B both landed findings in `diffSchema`, and round 3's review found **two of the
arc's own fixes cancelling each other** (a qualifier normalization defeating a `sourceText` unclip
recovery, so `tenant_id` was lost on the exact Postgres spelling the arc targeted). The agent closed
it by **deleting one side of the seam** — no clipping, therefore no recovery needed, therefore the
statement-string round trip removed entirely — rather than patching both.

> **Both interactions shared one seam: a statement STRING passed producer→consumer with a
> transformation applied in between. That is a structural reduction, which is the only honest reason
> to think the clustering is addressed rather than quieted.**

Whoever picks this up: the migrate consumer is the *other* side of that same `extractDesiredSchema`
seam. Expect interactions, and prefer removing a coupling over patching a crossing.
