# to scrml — a table-level `PRIMARY KEY (...)` fails shadow-DB validation in a `<db src>` library

**From:** flogence PA, S39 (2026-09-07, `bryan-XPS-8950`)
**Severity:** MEDIUM — hard fail (`E-PA-003`), no in-language workaround that preserves the schema.
**Second report this session.** The other is the regex-literal-with-a-quote codegen bug
(`2026-09-07-to-scrml-regex-literal-with-quote-breaks-codegen-in-foreign-block.md`). Unrelated
mechanisms; both are "valid input the front end mis-reads."

## Minimal repro (boundary mapped)

```scrml
<foreign lang="ts" />
<db src="./x.db" tables="t1">
${
  export function f() {
    ?{`CREATE TABLE IF NOT EXISTS t1 (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b))`}.run()
  }
}
</db>
```

```
error [E-PA-003]: Failed to execute CREATE TABLE statement in shadow database: incomplete input.
  Statement: CREATE TABLE IF NOT EXISTS t1 ( a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a
  stage: PA
```

| form | in a `<db src>` library | in a `<program>` |
|---|---|---|
| `(a TEXT NOT NULL, b TEXT NOT NULL)` | **OK** | OK |
| `(a TEXT PRIMARY KEY, b TEXT NOT NULL)` — column-level | **OK** | OK |
| `(a TEXT, b TEXT, PRIMARY KEY (a, b))` — table-level, composite | **FAILS** | **OK** |
| `(a TEXT, b TEXT, PRIMARY KEY (a))` — table-level, single | **FAILS** | **OK** |

So it is **table-level `PRIMARY KEY (...)` specifically**, and only on the `<db src>` path. The
identical statement compiles inside a `<program kind="tool" db="...">`. The truncation point in the
error text moves with the source formatting, which suggests the statement is being split before it
reaches sqlite rather than sqlite rejecting it.

Not tested, same shape, probably worth checking together: table-level `UNIQUE (...)`,
`FOREIGN KEY (...) REFERENCES`, and `CHECK (...)`.

## Why it bit

Two `kind="tool"` programs needed one schema. A tool cannot import another tool (`E-TOOL-006`,
correct and documented), so the intended route is a library — and the library form cannot express
the schema, because 2 of our 5 tables use composite primary keys (`gnode_src (node_id,
utterance_id)`, `gedge (src, type, dst)`).

## Our disposition

**Neither laundered nor worked around.** We considered rewriting the tables to use
`CREATE UNIQUE INDEX` instead of a table-level PK — semantically equivalent for our
`INSERT OR IGNORE` usage — and rejected it: it would have made freshly-created databases
structurally different from every existing one, to accommodate a compiler defect. Instead we kept
the schema in its single owning tool and gave the second tool a guard that names what to run.
No source restructured; the library file was deleted rather than bent.

Return leg appreciated if you rule it, so we can revisit the shared-library route.
