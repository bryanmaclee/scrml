/**
 * §14.8.10 / §14.8.9 — the raw-DDL `<schema>` form reaches the TENANT floor.
 *
 * THE DEFECT THIS LOCKS (dpa-039 arc B). Two adjacent security floors disagreed
 * about what counts as a schema declaration. §14.8.9 (protect) was deliberately
 * TAUGHT the raw-DDL `<schema>` spelling via `harvestRawCreateTables`
 * (protect-analyzer.ts); §14.8.10 (tenant) was not. `buildTenantContext` has two
 * legs and BOTH came up empty for a raw-DDL + no-`<db>` app:
 *
 *   - the `schemaByTable` leg is built from `protectAnalysis.views`, which
 *     `runPA` populates ONLY per `<db>` block → no `<db>`, no entries;
 *   - the `<schema>` leg runs through `parseSchemaBlock`, which recognizes ONLY
 *     the declarative `tableName { col: type }` DSL → a raw `CREATE TABLE`
 *     yields zero tables.
 *
 * Result: `_tenantActive` false, so the compiler emitted NO `_scrml_tenant_tag`,
 * NO `_scrml_tenant_redact`, no `tenantId` projection on `_scrml_current_user`
 * — and NO diagnostic, at exit 0. A silently inert tenant isolation floor.
 *
 * SPEC §14.8.10 does not qualify the spelling: *"A table whose `<schema>`
 * carries a `tenant_id` column IS tenant-scoped; the column's presence is the
 * declaration… There is no per-table opt-in attribute."*
 *
 * The fix TEACHES the tenant leg the same recognizer rather than rejecting the
 * input, and reuses `harvestRawCreateTables` itself so the two floors cannot
 * drift apart a second time.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseRawCreateTableColumns,
  harvestRawCreateTables,
  harvestRawCreateTableDecls,
  harvestCreateTables,
  findRejectedCreateTableHeads,
} from "../../src/schema-differ.js";
import { compileScrml } from "../../src/api.js";
import { extractDesiredSchema } from "../../src/codegen/db-authoritative.ts";
import {
  buildTenantContext,
  resolveTenantScoping,
  classifyTenantWrite,
} from "../../src/codegen/tenant-egress.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function astOf(src) {
  return buildAST(splitBlocks("test.scrml", src)).ast;
}
const emptyProtectCtx = () => ({ protectedByTable: new Map(), schemaByTable: new Map() });

const RAW_DDL_APP = `<program db="./app.db">
  <schema>
    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)
  </schema>
</program>
`;

// ---------------------------------------------------------------------------
// parseRawCreateTableColumns — the column-name read
// ---------------------------------------------------------------------------
describe("parseRawCreateTableColumns — names out of one raw CREATE TABLE", () => {
  test("a flat statement yields every column name in order", () => {
    const t = parseRawCreateTableColumns(
      "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
    );
    expect(t.name).toBe("assets");
    expect(t.columns.map((c) => c.name)).toEqual(["id", "name", "tenant_id"]);
  });

  test("IF NOT EXISTS + a quoted table name are recognized", () => {
    const t = parseRawCreateTableColumns(
      'CREATE TABLE IF NOT EXISTS "orders" (id INTEGER, tenant_id TEXT)',
    );
    expect(t.name).toBe("orders");
    expect(t.columns.map((c) => c.name)).toEqual(["id", "tenant_id"]);
  });

  test("a parenthesized type does not shred the split (DECIMAL(10,2))", () => {
    const t = parseRawCreateTableColumns(
      "CREATE TABLE ledger (id INTEGER, amount DECIMAL(10,2), tenant_id TEXT)",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id", "amount", "tenant_id"]);
  });

  test("quoted / bracketed column names are unwrapped", () => {
    const t = parseRawCreateTableColumns(
      'CREATE TABLE t ("id" INTEGER, [name] TEXT, `tenant_id` TEXT)',
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id", "name", "tenant_id"]);
  });

  test("a TABLE-LEVEL constraint is NOT read as a column — and that fail-direction matters", () => {
    // `FOREIGN KEY (tenant_id) REFERENCES …` NAMES tenant_id without DECLARING
    // it. Reading it as a column would make the floor believe an output
    // `tenant_id` exists; the floor would then emit a projection ADD against a
    // column the table lacks — a hard SQL failure, not a safe over-fire.
    const t = parseRawCreateTableColumns(
      "CREATE TABLE m (id INTEGER, PRIMARY KEY (id), " +
        "FOREIGN KEY (tenant_id) REFERENCES tenants(id), " +
        "CONSTRAINT u UNIQUE (id), CHECK (id > 0))",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id"]);
  });

  test("a comment inside the column list is skipped, not parsed as a column", () => {
    const t = parseRawCreateTableColumns(
      "CREATE TABLE t (id INTEGER, -- a note, with a comma\n tenant_id TEXT)",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id", "tenant_id"]);
  });

  test("A NESTED SUBEXPRESSION NO LONGER CLIPS ANYTHING — the recovery is gone because the clip is", () => {
    // ⚑ THIS CASE REPLACES A `sourceText`-RECOVERY TEST, and the replacement is
    // the point. Round 1 fixed the clip by re-finding the statement inside its
    // `<schema>` body; round 2 added qualifier normalization beside it; round 3
    // found that the two CANCEL — the stored statement said `assets`, the body
    // said `public.assets`, `indexOf` returned -1, and the recovery silently
    // never fired. Two individually-correct fixes reproducing the original bug.
    //
    // The recognizer no longer matches the column body at all (head regex +
    // balanced scan), so statements are never clipped and there is nothing to
    // recover from. One side of the seam was DELETED rather than both patched.
    const nested = [
      "CREATE TABLE assets (name TEXT CHECK (name IN ('a','b')), tenant_id TEXT)",
      "CREATE TABLE assets (name VARCHAR(80), tenant_id TEXT)",
      "CREATE TABLE assets (amount NUMERIC(10,2), tenant_id TEXT)",
      "CREATE TABLE public.assets (name VARCHAR(80), tenant_id TEXT)",
      'CREATE TABLE "public"."assets" (name TEXT CHECK (name IN (\'a\')), tenant_id TEXT)',
    ];
    for (const sql of nested) {
      const cols = parseRawCreateTableColumns(sql).columns.map((c) => c.name);
      expect(cols[cols.length - 1]).toBe("tenant_id");
    }
  });


  test("non-CREATE-TABLE text yields null (never a bogus table)", () => {
    expect(parseRawCreateTableColumns("SELECT 1")).toBeNull();
    expect(parseRawCreateTableColumns("")).toBeNull();
    expect(parseRawCreateTableColumns(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractDesiredSchema — the `<schema>` leg the tenant floor reads
// ---------------------------------------------------------------------------
describe("extractDesiredSchema — a raw-DDL <schema> declares its tables", () => {
  test("THE DEFECT: a raw-DDL <schema> yields the table (was zero)", () => {
    const { tables } = extractDesiredSchema(astOf(RAW_DDL_APP));
    expect(tables.length).toBe(1);
    expect(tables[0].name).toBe("assets");
    expect(tables[0].rawDdl).toBe(true);
    expect(tables[0].columns.map((c) => c.name)).toEqual(["id", "name", "tenant_id"]);
  });

  test("the declarative DSL form is UNCHANGED and carries no rawDdl marker", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    assets {
      id: integer primary key
      tenant_id: text
    }
  </schema>
</program>
`));
    expect(tables.length).toBe(1);
    expect(tables[0].name).toBe("assets");
    expect(tables[0].rawDdl).toBeUndefined();
  });

  test("a DSL table WINS over a raw CREATE TABLE of the same name", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    assets {
      id: integer primary key
      tenant_id: text
    }
    CREATE TABLE assets (id INTEGER, other TEXT)
  </schema>
</program>
`));
    expect(tables.filter((t) => t.name === "assets").length).toBe(1);
    expect(tables[0].rawDdl).toBeUndefined();
    expect(tables[0].columns.map((c) => c.name)).toEqual(["id", "tenant_id"]);
  });

  test("MIXED body: the DSL table and the raw table are BOTH declared", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    notes {
      id: integer primary key
      body: text
    }
    CREATE TABLE assets (id INTEGER PRIMARY KEY, tenant_id TEXT)
  </schema>
</program>
`));
    expect(tables.map((t) => t.name).sort()).toEqual(["assets", "notes"]);
  });

  test("an EMPTY <schema> yields no tables and does not throw", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
  </schema>
</program>
`));
    expect(tables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildTenantContext — the composition that was dead
// ---------------------------------------------------------------------------
describe("§14.8.10 buildTenantContext over a raw-DDL <schema>", () => {
  test("THE COMPOSITION: an EMPTY <db> registry + a raw-DDL <schema> IS tenant-scoped", () => {
    const { tables } = extractDesiredSchema(astOf(RAW_DDL_APP));
    const ctx = buildTenantContext(emptyProtectCtx(), tables);
    expect([...ctx.tenantScopedTables]).toEqual(["assets"]);
  });

  test("END-TO-END SHAPE: a nested CHECK before tenant_id still engages the floor", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    CREATE TABLE assets (name TEXT CHECK (name IN ('a','b')), tenant_id TEXT)
  </schema>
</program>
`));
    expect(tables[0].columns.map((c) => c.name)).toEqual(["name", "tenant_id"]);
    const ctx = buildTenantContext(emptyProtectCtx(), tables);
    expect([...ctx.tenantScopedTables]).toEqual(["assets"]);
  });

  test("a raw-DDL table WITHOUT tenant_id is still not tenant-scoped (no over-fire)", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)
  </schema>
</program>
`));
    const ctx = buildTenantContext(emptyProtectCtx(), tables);
    expect(ctx.tenantScopedTables.size).toBe(0);
  });

  test("a table-level FOREIGN KEY naming tenant_id does NOT make the table tenant-scoped", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    CREATE TABLE memberships (id INTEGER PRIMARY KEY, FOREIGN KEY (tenant_id) REFERENCES tenants(id))
  </schema>
</program>
`));
    const ctx = buildTenantContext(emptyProtectCtx(), tables);
    expect(ctx.tenantScopedTables.size).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// ROUND-2 REVIEW FIXES — the three defects the S239 pass found in round 1.
// ---------------------------------------------------------------------------

describe("HIGH — table-name matching is CASE-INSENSITIVE, as SQL is", () => {
  // SQL treats `Assets` and `assets` as the same table; the floor did not. A
  // mismatch produced `const rows = await _scrml_sql`…`` — no tag, no redact, no
  // diagnostic, exit 0. Measured in all four combinations and in BOTH declaration
  // forms; the DSL half predates the raw-DDL work.
  const ctxOf = (schemaSrc) => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
${schemaSrc}
  </schema>
</program>
`));
    return buildTenantContext(emptyProtectCtx(), tables);
  };

  for (const [label, decl] of [
    ["raw DDL", "    CREATE TABLE Assets (id INTEGER PRIMARY KEY, tenant_id TEXT)"],
    ["DSL", "    Assets {\n      id: integer primary key\n      tenant_id: text\n    }"],
  ]) {
    test(`${label}: a table declared \`Assets\` matches a query on \`assets\` / \`ASSETS\``, () => {
      const ctx = ctxOf(decl);
      expect(ctx.tenantScopedTables.has("Assets")).toBe(true);
      expect(ctx.tenantScopedTables.has("assets")).toBe(true);
      expect(ctx.tenantScopedTables.has("ASSETS")).toBe(true);
      // …and the read is scoped whichever spelling the SQL uses.
      for (const q of ["SELECT id FROM assets", "SELECT id FROM ASSETS", "SELECT id FROM Assets"]) {
        expect(resolveTenantScoping(q, ctx)).not.toBeNull();
      }
    });
  }

  test("the scoping keeps the QUERY's casing, so the emitted qualifier matches the SQL", () => {
    // `rewriteSelectAddTenantId` finds the alias by comparing against
    // `scoping.table`; folding the stored name must not fold what is returned.
    const ctx = ctxOf("    CREATE TABLE Assets (id INTEGER PRIMARY KEY, tenant_id TEXT)");
    const sc = resolveTenantScoping("SELECT id FROM ASSETS", ctx);
    expect(sc.table).toBe("ASSETS");
  });

  test("writes fold too — an UPDATE on a differently-cased name still hard-fails", () => {
    const ctx = ctxOf("    CREATE TABLE Assets (id INTEGER PRIMARY KEY, tenant_id TEXT)");
    expect(classifyTenantWrite("UPDATE assets SET name = ${1} WHERE id = ${2}", ctx))
      .toEqual({ kind: "hard-fail", table: "assets", op: "UPDATE" });
    expect(classifyTenantWrite("DELETE FROM ASSETS WHERE id = ${1}", ctx))
      .toEqual({ kind: "hard-fail", table: "ASSETS", op: "DELETE" });
  });

  test("NO over-fire: a genuinely different table is still not tenant-scoped", () => {
    const ctx = ctxOf("    CREATE TABLE Assets (id INTEGER PRIMARY KEY, tenant_id TEXT)");
    expect(ctx.tenantScopedTables.has("assetsx")).toBe(false);
    expect(resolveTenantScoping("SELECT id FROM other", ctx)).toBeNull();
  });
});

describe("HARVEST level — a schema-QUALIFIED head is still READ (the program is rejected, see E-SCHEMA-012 below)", () => {
  // ⚑ S438 REVERSAL. This block used to be titled "a schema-QUALIFIED table name
  // is the ordinary Postgres spelling" and to stand for the one-qualifier form
  // being ACCEPTED. bryan RULED S435 "1 both": a `<schema>` CREATE TABLE head
  // with a qualifier — one qualifier OR more — is a compile error (E-SCHEMA-012).
  // What remains true, and is pinned here, is the HARVEST behaviour: a qualified
  // head is still read and stripped, so the rejected program reports that one
  // error rather than a cascade, and the tenant floor stays engaged on the table
  // rather than silently off. The acceptance verdict lives in the compile-level
  // block at the end of this file.
  for (const [label, decl] of [
    ["public.assets", "    CREATE TABLE public.assets (id INTEGER PRIMARY KEY, tenant_id TEXT)"],
    ['"public"."assets"', '    CREATE TABLE "public"."assets" (id INTEGER PRIMARY KEY, tenant_id TEXT)'],
    ["Public.Assets (qualified + cased)", "    CREATE TABLE Public.Assets (id INTEGER PRIMARY KEY, tenant_id TEXT)"],
  ]) {
    test(`${label} declares \`assets\``, () => {
      const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
${decl}
  </schema>
</program>
`));
      expect(tables.map((t) => t.name.toLowerCase())).toEqual(["assets"]);
      const ctx = buildTenantContext(emptyProtectCtx(), tables);
      expect(ctx.tenantScopedTables.has("assets")).toBe(true);
    });
  }

  test("the QUALIFIER IS STRIPPED from the stored statement — a shadow-DB replay must stay executable", () => {
    // `resolveDb` replays harvested statements into in-memory SQLite, which has
    // no such namespace; an unstripped `public.assets` throws and takes the whole
    // `<db>` block's type views down with E-PA-003.
    const out = new Map();
    harvestRawCreateTables("CREATE TABLE public.assets (id INTEGER, tenant_id TEXT)", out);
    expect([...out.keys()]).toEqual(["assets"]);
    expect(out.get("assets")).not.toContain("public.");
    expect(out.get("assets")).toContain("CREATE TABLE assets (");
  });
});

describe("LOW — a column NAMED with a constraint keyword is still a column", () => {
  // A keyword-PREFIX test dropped real columns: `settings (key TEXT, value TEXT,
  // tenant_id TEXT)` returned only ["value","tenant_id"].
  test("`key` is a column, not a table-level KEY clause", () => {
    const t = parseRawCreateTableColumns("CREATE TABLE settings (key TEXT, value TEXT, tenant_id TEXT)");
    expect(t.columns.map((c) => c.name)).toEqual(["key", "value", "tenant_id"]);
  });

  test("EIGHT of the nine keyword names survive unquoted as columns", () => {
    // MEASURED per name, not asserted as a block: eight parse as columns
    // unquoted. `like` is the ninth and is genuinely ambiguous — see below.
    const names = ["constraint", "primary", "foreign", "unique", "check", "exclude", "index", "key"];
    const body = names.map((n) => `${n} TEXT`).join(", ");
    const t = parseRawCreateTableColumns(`CREATE TABLE t (${body}, tenant_id TEXT)`);
    expect(t.columns.map((c) => c.name)).toEqual([...names, "tenant_id"]);
  });

  test("`like` is the irreducible one, and the QUOTED spelling — the legal one — parses", () => {
    // ⚑ The review said the leader-plus-identifier test "disambiguates all nine."
    // MEASURED: it disambiguates EIGHT. `LIKE other_table` (the Postgres
    // table-copy clause, which lives inside the column list) and `like TEXT` (a
    // column) are the same shape, so no leading-word test can separate them.
    //
    // The resolution is not a heuristic, it is the SQL grammar: `LIKE` is a
    // RESERVED WORD, so a column actually named `like` must be quoted — and all
    // three quotings parse correctly, while the unquoted table-copy clause is
    // still skipped. Widening the code with a type-name allowlist to catch the
    // ILLEGAL unquoted spelling would trade a named residual for a new guess.
    for (const q of ['"like" TEXT', '`like` TEXT', '[like] TEXT']) {
      const t = parseRawCreateTableColumns(`CREATE TABLE t (${q}, tenant_id TEXT)`);
      expect(t.columns.map((c) => c.name)).toEqual(["like", "tenant_id"]);
    }
    const copy = parseRawCreateTableColumns("CREATE TABLE t (LIKE other_table, tenant_id TEXT)");
    expect(copy.columns.map((c) => c.name)).toEqual(["tenant_id"]);
  });

  test("and the real table-level constraint forms are STILL skipped", () => {
    const t = parseRawCreateTableColumns(
      "CREATE TABLE m (id INTEGER, tenant_id TEXT, " +
        "PRIMARY KEY (id), FOREIGN KEY (tenant_id) REFERENCES tenants(id), " +
        "UNIQUE (id), CHECK (id > 0), CONSTRAINT u UNIQUE (id), KEY idx (id))",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id", "tenant_id"]);
  });
});

// ---------------------------------------------------------------------------
// ROUND-3 — THE CROSSED MATRIX, not the cases.
//
// Every round-3 finding lived in a cell no test crossed: qualified names were
// tested only with UNPARENTHESIZED types; `key` only as `key TEXT`; the
// withheld-plan only against an EMPTY `actual`. Each individual fix was right and
// each individual test passed. So this block enumerates the PRODUCT and asserts
// the totals reconcile, rather than adding one case per bug.
// ---------------------------------------------------------------------------
describe("ROUND-3 crossed matrix — qualifier x parenthesized-type x leader-word column", () => {
  // HARVEST level (S438): the qualified rows pin that a qualified head is still
  // read and replayable — the PROGRAM carrying one is rejected by E-SCHEMA-012.
  const QUALIFIERS = { none: "assets", schema: "public.assets", quoted: '"public"."assets"' };
  const FIRSTCOL = {
    plain: "id INTEGER PRIMARY KEY",
    parenType: "name VARCHAR(80)",
    leaderPlain: "key TEXT",
    leaderParen: "key VARCHAR(50)",
    checkClause: "name TEXT CHECK (name IN ('a','b'))",
  };

  // The EXPECTED column list per first-column shape. Asserting the FULL list, not
  // just "tenant_id survived": with a last-element-only assertion these cells
  // stayed green while `key VARCHAR(50)` was being eaten, because dropping `key`
  // does not move `tenant_id`. That is the same uncrossed-cell failure one level
  // up — a matrix that only checks the property it was built for.
  const EXPECTED = {
    plain: ["id", "tenant_id"],
    parenType: ["name", "tenant_id"],
    leaderPlain: ["key", "tenant_id"],
    leaderParen: ["key", "tenant_id"],
    checkClause: ["name", "tenant_id"],
  };

  const cells = [];
  for (const [qn, qual] of Object.entries(QUALIFIERS)) {
    for (const [fn, first] of Object.entries(FIRSTCOL)) {
      cells.push([`${qn} x ${fn}`, `CREATE TABLE ${qual} (${first}, tenant_id TEXT)`, EXPECTED[fn]]);
    }
  }

  test("the matrix is the full PRODUCT, not a sample (3 x 5 = 15)", () => {
    expect(cells.length).toBe(Object.keys(QUALIFIERS).length * Object.keys(FIRSTCOL).length);
    expect(cells.length).toBe(15);
  });

  for (const [label, ddl, expectedCols] of cells) {
    test(`${label}: declares \`assets\` AND recovers EVERY column`, () => {
      const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    ${ddl}
  </schema>
</program>
`));
      expect(tables.length).toBe(1);
      expect(tables[0].name.toLowerCase()).toBe("assets");
      expect(tables[0].columns.map((c) => c.name)).toEqual(expectedCols);
      const ctx = buildTenantContext(emptyProtectCtx(), tables);
      expect(ctx.tenantScopedTables.has("assets")).toBe(true);
    });

    test(`${label}: the STORED statement replays into SQLite (no E-PA-003)`, () => {
      // `resolveDb` replays harvested statements into an in-memory shadow DB. A
      // clipped or qualifier-bearing statement throws `incomplete input` /
      // `unknown database`, and that takes the whole `<db>` block's type views
      // down. MEASURED as failing on origin/main for the unparenthesized-type
      // rows too — this closes a pre-existing hole as well as the new one.
      const out = new Map();
      harvestRawCreateTables(ddl, out);
      const stmt = [...out.values()][0];
      expect(stmt).toBeDefined();
      const db = new Database(":memory:");
      try {
        expect(() => db.run(stmt)).not.toThrow();
      } finally {
        db.close();
      }
    });
  }

  test("a leader-word column with a PARENTHESIZED type is a column, not a KEY clause", () => {
    // The round-2 fix tested `key TEXT` only, so `key VARCHAR(50)` — same token
    // shape as the MySQL constraint `KEY idx (col)` — was still eaten.
    const t = parseRawCreateTableColumns(
      "CREATE TABLE settings (key VARCHAR(50), index NUMERIC(10,2), value TEXT, tenant_id TEXT)",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["key", "index", "value", "tenant_id"]);
  });

  test("…and the real named KEY/INDEX constraint is STILL skipped", () => {
    // The discriminator is the paren CONTENT: numeric = a type's argument,
    // identifiers = an index's column list.
    const t = parseRawCreateTableColumns(
      "CREATE TABLE m (id INTEGER, tenant_id TEXT, KEY idx_a (id), INDEX idx_b (id, tenant_id), KEY (id))",
    );
    expect(t.columns.map((c) => c.name)).toEqual(["id", "tenant_id"]);
  });
});

// ---------------------------------------------------------------------------
// THE SPLIT — `extractDesiredSchema`'s two consumers, and the boundary between them
//
// bryan RULED the split (S405): keep the tenant half, re-scope the migrate half.
// The cut is at this function's TWO CONSUMERS, which have genuinely opposite needs:
//
//   · §14.8.10 tenant floor (`codegen/emit-server.ts`) — needs EVERY
//     `<schema>`-declared table, raw-DDL included, because a `tenant_id`
//     column's PRESENCE is the declaration and an unseen table gets a silently
//     inert isolation floor;
//   · `scrml db-migrate` — must see NONE of them, because it OWNS and REWRITES
//     schema, and a raw table's DDL is author-owned and only partially recovered.
//
// Every defect the migrate half of this arc produced traced to raw tables
// becoming visible to a consumer never designed for them. Declining them AT THAT
// CONSUMER'S BOUNDARY makes all four impossible BY CONSTRUCTION, and leaves
// `diffSchema` byte-identical to its pre-arc behaviour — so it carries no
// `rawDdl` awareness at all, and this file no longer tests it.
// ---------------------------------------------------------------------------
describe("THE SPLIT — raw tables reach the tenant consumer and NOT the migrate one", () => {
  test("extractDesiredSchema still yields raw tables, MARKED — the tenant half is intact", () => {
    const { tables } = extractDesiredSchema(astOf(RAW_DDL_APP));
    expect(tables.length).toBe(1);
    expect(tables[0].rawDdl).toBe(true);
    expect(tables[0].columns.map((c) => c.name)).toContain("tenant_id");
  });

  test("the marker is the boundary: filtering on it leaves the migrate consumer EMPTY", () => {
    // This is the exact predicate `commands/db-migrate.js` applies at its
    // collection site. Pinned here so the boundary cannot be removed silently.
    const { tables } = extractDesiredSchema(astOf(RAW_DDL_APP));
    expect(tables.filter((t) => !t.rawDdl)).toEqual([]);
  });

  test("a DECLARATIVE table crosses the boundary unchanged — the split is scoped", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    notes {
      id: integer primary key
      body: text
    }
  </schema>
</program>
`));
    expect(tables.filter((t) => !t.rawDdl).map((t) => t.name)).toEqual(["notes"]);
  });

  test("a MIXED <schema> splits correctly — DSL to both consumers, raw to one", () => {
    const { tables } = extractDesiredSchema(astOf(`<program db="./app.db">
  <schema>
    notes {
      id: integer primary key
      body: text
    }
    CREATE TABLE assets (id INTEGER PRIMARY KEY, tenant_id TEXT)
  </schema>
</program>
`));
    // tenant consumer: both.
    expect(tables.map((t) => t.name).sort()).toEqual(["assets", "notes"]);
    // migrate consumer: only the declarative one.
    expect(tables.filter((t) => !t.rawDdl).map((t) => t.name)).toEqual(["notes"]);
  });
});

// ---------------------------------------------------------------------------
// E-SCHEMA-012 — a `<schema>` CREATE TABLE head SHALL name ONE readable,
// UNQUALIFIED table (SPEC §39.2; bryan RULED S435 "1 both"; gap
// g-tenant-floor-inert-for-a-two-qualifier-create-table).
//
// THE DEFECT. The head regex had a slot for ZERO OR ONE qualifier, so
// `CREATE TABLE mydb.public.assets (…, tenant_id)` matched no recognizer: the
// table was undeclared, the §14.8.10 tenant floor emitted nothing, and — once a
// second, recognized table was present — even W-SCHEMA-NO-TABLES-DECLARED went
// quiet. Exit 0, silently inert isolation. The one-qualifier form was accepted
// by stripping, which collapses `a.assets` / `b.assets` onto one key.
//
// THE RULING: reject BOTH, fail-closed — and (S438 fix round, F3) a head the
// reader cannot read is rejected too, never skipped.
//
// ⚑ THE INVARIANT (S438 fix round, S239 finding F1): for EVERY `<schema>` body,
// the harvested table set is a SUPERSET of the pre-S438 harvest, table by table
// and column by column. The first S438 cut skipped top-level comments without
// string/regex awareness and a DSL `pattern(/^\/*…/)` swallowed a real tenant
// table — a floor the base compiler engaged went silently off. The oracle below
// is the pre-S438 recognizer VERBATIM, kept in this file so the property is
// checked against base, not against the implementation's own idea of base.
// ---------------------------------------------------------------------------
const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compileSchemaApp(schemaText, whole) {
  const dir = mkdtempSync(join(tmpdir(), "e-schema-012-"));
  _tmp.push(dir);
  const dbAbs = join(dir, "app.db").replace(/\\/g, "/");
  const file = join(dir, "app.scrml");
  const q = `  \${
    @open = true
    function loadAssets() {
      const rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
      return rows
    }
  }`;
  writeFileSync(file, whole ? whole(dbAbs, q) : `<program db="${dbAbs}">
  <schema>
${schemaText}
  </schema>
${q}
  <page>
    <button onclick=loadAssets()>Load</button>
  </page>
</program>`);
  const outDir = join(dir, "out");
  const r = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  let server = "";
  try { server = readFileSync(join(outDir, "app.server.js"), "utf8"); } catch {}
  return { r, server };
}
const errCodes = (r) => (r.errors ?? []).map((d) => d.code);
const tagged = (server) => /_scrml_tenant_tag\(await _scrml_sql/.test(server);
const COLS = "(id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)";
const NOTES = "\n    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)";

describe("E-SCHEMA-012 — compile level: a qualified or unreadable `<schema>` CREATE TABLE head is REJECTED", () => {
  const REJECTED = {
    "one qualifier (was ACCEPTED pre-S438)": `    CREATE TABLE public.assets ${COLS}`,
    "two qualifiers (was SILENTLY INERT)": `    CREATE TABLE mydb.public.assets ${COLS}`,
    "two qualifiers + a second recognized table (was inert with NO warning)": `    CREATE TABLE mydb.public.assets ${COLS}${NOTES}`,
    "double-quoted parts": `    CREATE TABLE "db"."public"."assets" ${COLS}`,
    "backtick + bracket parts": "    CREATE TABLE `mydb`.[public].assets " + COLS,
    "whitespace + comments around the dots": `    CREATE TABLE mydb /* x */ . -- y\n      public . assets ${COLS}`,
    "IF NOT EXISTS, lowercase": `    create table if not exists mydb.public.assets ${COLS}`,
    "TEMP modifier + temp. qualifier": `    CREATE TEMP TABLE temp.assets ${COLS}`,
    "UNLOGGED + two qualifiers": `    CREATE UNLOGGED TABLE a.b.assets ${COLS}${NOTES}`,
    "a dangling qualifier with no name": `    CREATE TABLE public. (id INTEGER)`,
    "CREATE TABLE … AS (no column list)": `    CREATE TABLE a.assets AS SELECT 1`,
    "a DSL table beside it does not mask it": `    notes {\n      id: integer primary key\n    }\n    CREATE TABLE mydb.public.assets ${COLS}`,
    // F3 — Unicode / `$` identifiers are READ (they were not-a-head pre-S438)
    "Unicode qualifier (données.assets)": `    CREATE TABLE données.assets ${COLS}${NOTES}`,
    "`$` qualifier (app$v2.assets)": `    CREATE TABLE app$v2.assets ${COLS}${NOTES}`,
    "digit-leading qualifier": `    CREATE TABLE 1a.b.assets ${COLS}${NOTES}`,
    "VIRTUAL + qualifier": `    CREATE VIRTUAL TABLE a.b.assets USING fts5(name, tenant_id)${NOTES}`,
    // F-B — a qualified PARTITION OF child is still a qualified head
    "qualified PARTITION OF child": `    CREATE TABLE assets ${COLS}\n    CREATE TABLE a.assets_p PARTITION OF assets DEFAULT`,
  };
  for (const [label, schema] of Object.entries(REJECTED)) {
    test(`REJECTED: ${label}`, () => {
      const { r } = compileSchemaApp(schema);
      expect(errCodes(r)).toContain("E-SCHEMA-012");
    });
  }

  // F3 / round-3 F-B — fail-closed on a head the reader cannot read: its OWN code.
  const UNREADABLE = {
    "hyphen in a qualifier": `    CREATE TABLE my-db.public.assets ${COLS}${NOTES}`,
    "empty quoted part": `    CREATE TABLE "".public.assets ${COLS}${NOTES}`,
    "fullwidth dot": `    CREATE TABLE a．b．assets ${COLS}${NOTES}`,
    "zero-width space before the column list": `    CREATE TABLE assets​ ${COLS}${NOTES}`,
    "IF EXISTS typo": `    CREATE TABLE IF EXISTS a.b.assets ${COLS}${NOTES}`,
  };
  for (const [label, schema] of Object.entries(UNREADABLE)) {
    test(`E-SCHEMA-013 UNREADABLE: ${label}`, () => {
      const { r } = compileSchemaApp(schema);
      expect(errCodes(r)).toContain("E-SCHEMA-013");
      expect(errCodes(r)).not.toContain("E-SCHEMA-012");
    });
  }

  test("each rejected head is reported ONCE, and the error names the qualifier + the fix", () => {
    const { r } = compileSchemaApp(
      `    CREATE TABLE public.assets ${COLS}\n    CREATE TABLE mydb.public.orders (id INTEGER PRIMARY KEY, tenant_id TEXT)`,
    );
    const hits = (r.errors ?? []).filter((d) => d.code === "E-SCHEMA-012");
    expect(hits.length).toBe(2);
    expect(hits[0].message).toContain("`public`");
    expect(hits[0].message).toContain("CREATE TABLE assets (…)");
    expect(hits[1].message).toContain("`mydb`.`public`");
    expect(hits[1].message).toContain("CREATE TABLE orders (…)");
  });

  test("FAIL-CLOSED even past the error: the qualified table is still declared, so the floor is ENGAGED, not inert", () => {
    const { r, server } = compileSchemaApp(`    CREATE TABLE mydb.public.assets ${COLS}${NOTES}`);
    expect(errCodes(r)).toContain("E-SCHEMA-012");
    expect(tagged(server)).toBe(true);
    expect([...(r.warnings ?? []), ...(r.errors ?? [])].map((d) => d.code))
      .not.toContain("W-SCHEMA-NO-TABLES-DECLARED");
  });

  const ACCEPTED = {
    "an unqualified head": `    CREATE TABLE assets ${COLS}`,
    "an unqualified quoted head": `    CREATE TABLE "assets" ${COLS}`,
    "an unqualified IF NOT EXISTS head, lowercase": `    create table if not exists assets ${COLS}`,
    // S450: the commented copy carries `tenant_id` like the live table — a copy that
    // DISAGREES on `tenant_id` is E-SCHEMA-015 since S447 "stamp all" (i)
    // (schema-tenant-union-and-like.test.js), which is not what this row pins.
    "a qualified head inside a -- comment is not rejected":
      `    CREATE TABLE assets ${COLS}\n    -- CREATE TABLE old.assets (id INTEGER, tenant_id TEXT)`,
    "a qualified head inside a /* */ comment is not rejected":
      `    CREATE TABLE assets ${COLS}\n    /* CREATE TABLE old.public.assets (id INTEGER) */`,
    "a qualified head inside a DSL string is not rejected (was a false positive)":
      `    notes {\n      id: integer primary key\n      body: text default("CREATE TABLE x.y.z (a)")\n    }\n    CREATE TABLE assets ${COLS}`,
    "a DOT INSIDE a quoted name is one identifier, not a qualifier":
      `    CREATE TABLE "a.assets" ${COLS}\n    CREATE TABLE assets ${COLS}`,
    "a qualified REFERENCES target inside the column list is not a head":
      `    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT REFERENCES public.tenants(id))`,
    "a Unicode table name is READ (was not-a-head pre-S438)": `    CREATE TABLE "assets" ${COLS}\n    CREATE TABLE données (id INTEGER PRIMARY KEY)`,
    "the declarative DSL form": "    assets {\n      id: integer primary key\n      name: text\n      tenant_id: text\n    }",
  };
  for (const [label, schema] of Object.entries(ACCEPTED)) {
    test(`ACCEPTED: ${label}`, () => {
      const { r, server } = compileSchemaApp(schema);
      expect(errCodes(r)).not.toContain("E-SCHEMA-012");
      expect(r.errors ?? []).toEqual([]);
      expect(tagged(server)).toBe(true);
    });
  }
});

// F1 — the executed regressions of the first S438 cut. Every one of these
// engaged the floor on the base compiler; each must still engage it.
describe("F1 — a comment-lookalike inside a string or regex never removes a table (tenant floor still ENGAGED)", () => {
  const F1 = {
    "DSL pattern(/^\\/*…/) + a later real block comment": `    routes {
      id: integer primary key
      path: text pattern(/^\\/*[a-z0-9-]+$/)
    }
    CREATE TABLE assets ${COLS}
    /* audit tables follow */
    CREATE TABLE audit (id INTEGER PRIMARY KEY, what TEXT)`,
    "DSL default(\"/api/*\") + a later block comment": `    rules {
      id: integer primary key
      glob: text default("/api/*")
    }
    CREATE TABLE assets ${COLS}
    /* end */`,
    "one-line body: default(\"https://…\") then a head (`//` in a string)":
      `    links { id: integer primary key  url: text default("https://example.com") } CREATE TABLE assets ${COLS}`,
    "one-line body: default(\"--\") then a head":
      `    links { id: integer primary key  d: text default("--") } CREATE TABLE assets ${COLS}`,
    "raw DEFAULT '/*' then a later comment":
      `    CREATE TABLE links (id INTEGER PRIMARY KEY, g TEXT DEFAULT '/*')\n    CREATE TABLE assets ${COLS}\n    /* c */`,
  };
  for (const [label, schema] of Object.entries(F1)) {
    test(label, () => {
      const { r, server } = compileSchemaApp(schema);
      expect(r.errors ?? []).toEqual([]);
      expect(tagged(server)).toBe(true);
    });
  }

  test("…and a qualified head AFTER such a lookalike is still REJECTED", () => {
    const { r } = compileSchemaApp(`    routes {
      id: integer primary key
      path: text pattern(/^\\/*[a-z0-9-]+$/)
    }
    CREATE TABLE a.b.assets ${COLS}
    /* end */`);
    expect(errCodes(r)).toContain("E-SCHEMA-012");
  });
});

// F2 — the `<schema>` checks descend the markup `if-chain` node.
describe("F2 — a `<schema>` under an if/else chain is SEEN (E-SCHEMA-003 + E-SCHEMA-012)", () => {
  const S = `<schema>
    CREATE TABLE a.assets (id INTEGER PRIMARY KEY, name TEXT)
    CREATE TABLE b.assets ${COLS}
  </schema>`;
  const whole = (inner) => (db, q) => `<program db="${db}">
${q}
  ${inner}
  <page><button onclick=loadAssets()>Load</button></page>
</program>`;
  test("if/else chain: both codes fire (was: neither, tag=0, exit 0)", () => {
    const { r } = compileSchemaApp(null, whole(`<div if=@open>\n  ${S}\n  </div>\n  <div else>x</div>`));
    expect(errCodes(r)).toContain("E-SCHEMA-003");
    expect(errCodes(r)).toContain("E-SCHEMA-012");
  });
  test("if/else-if/else chain: seen in the middle limb too", () => {
    const { r } = compileSchemaApp(null, whole(`<div if=@open>x</div>\n  <div else-if=@open>\n  ${S}\n  </div>\n  <div else>y</div>`));
    expect(errCodes(r)).toContain("E-SCHEMA-003");
    expect(errCodes(r)).toContain("E-SCHEMA-012");
  });
  test("else limb", () => {
    const { r } = compileSchemaApp(null, whole(`<div if=@open>x</div>\n  <div else>\n  ${S}\n  </div>`));
    expect(errCodes(r)).toContain("E-SCHEMA-003");
    expect(errCodes(r)).toContain("E-SCHEMA-012");
  });
});

// Round 3 — false positives, each red on dccdc1cc.
describe("round 3 — no false E-SCHEMA-012 / E-SCHEMA-013 (F-A, F-B, F-C)", () => {
  const PG = "postgres://u:p@127.0.0.1:1/x";
  const secdef = (sql) => (_db, _q) => `<program db="${PG}">
  <schema>
    invoices {
      id: text primary key
      tenant_id: text not null
      status: text not null immutable
      memo: text
    } db-authoritative

    fn void_invoice(id: uuid) security definer owner(invoice_admin) requires cap("void") {
      """
${sql}
      UPDATE invoices SET status = 'void' WHERE invoices.id = void_invoice.id;
      """
    }
  </schema>

  function listInvoices() {
    const rows = ?{ select id, tenant_id, status from invoices }
    rows
  }
</program>`;
  const schemaCodes = (r) => errCodes(r).filter((c) => /^E-SCHEMA-01[234]$/.test(c));

  // ⚑ FLIPPED by the S438 FINAL commit. Round 3 made these silent via a fn-body
  // exemption; both exemption attempts opened escapes, so it was REMOVED
  // fail-closed. A readable, unqualified head in a fn body is still silent; a
  // qualified/unreadable one is the DOCUMENTED FALSE POSITIVE — gap
  // g-secdef-fn-body-ddl-false-positive (which records the repair).
  test("F-A (documented false positive): a qualified head inside a SECDEF `\"\"\"` body IS reported", () => {
    const { r } = compileSchemaApp(null, secdef("      CREATE TABLE IF NOT EXISTS audit.snap (id uuid, tenant_id uuid);"));
    expect(schemaCodes(r)).toEqual(["E-SCHEMA-012"]);
  });

  test("F-A: a TEMP staging head in a SECDEF body stays silent", () => {
    const { r } = compileSchemaApp(null, secdef("      CREATE TEMP TABLE staging ON COMMIT DROP AS SELECT * FROM invoices;"));
    expect(schemaCodes(r)).toEqual([]);
  });

  // ⚑ FLIPPED S446 fix round: the fn-body exemption is TEMP/TEMPORARY-only, so a
  // non-temp no-column-list head in a SECDEF body is E-SCHEMA-014.
  test("F-A: a non-temp `PARTITION OF` head in a SECDEF body is E-SCHEMA-014", () => {
    const { r } = compileSchemaApp(null, secdef("      CREATE TABLE archived PARTITION OF invoices DEFAULT;"));
    expect(schemaCodes(r)).toEqual(["E-SCHEMA-014"]);
  });

  test("F-A: a qualified head AFTER a closed `\"\"\"` body is rejected too", () => {
    expect(findRejectedCreateTableHeads(
      'fn f(id: uuid) security definer owner(a) {\n  """\n  CREATE TABLE a.b (x INT);\n  """\n}\nCREATE TABLE s.t (x INT)',
    ).map((h) => h.name)).toEqual(["b", "t"]);
  });

  // ⚑ FLIPPED S446 (bryan RULED S440 #15, gap g-schema-no-column-list-heads-declare-
  // nothing): these heads READ fine — never E-SCHEMA-013 — but they declare no column
  // list the floors can see, so at top level they are now E-SCHEMA-014.
  test("F-B: `PARTITION OF` / `OF type` / TEMP CTAS heads are READABLE (no 012/013) but are E-SCHEMA-014", () => {
    for (const extra of [
      "    CREATE TABLE assets_default PARTITION OF assets DEFAULT",
      "    CREATE TABLE assets_2026 PARTITION OF assets FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')",
      "    CREATE TABLE typed OF mytype",
      "    CREATE TEMP TABLE scratch ON COMMIT DROP AS SELECT 1",
    ]) {
      const { r } = compileSchemaApp(`    CREATE TABLE assets ${COLS}\n${extra}`);
      expect(schemaCodes(r)).toEqual(["E-SCHEMA-014"]);
    }
  });

  test("F-C: `CREATE` must start a word — `precreate table …` / `xCREATE TABLE a.b` are not heads", () => {
    expect(findRejectedCreateTableHeads("precreate table foo bar")).toEqual([]);
    expect(findRejectedCreateTableHeads("xCREATE TABLE a.b (x INT)")).toEqual([]);
    expect(findRejectedCreateTableHeads("_create table a.b (x INT)")).toEqual([]);
  });

  test("F-C: prose with `create … table` is not a head (modifier words outside the SQL set, name unreadable)", () => {
    for (const prose of [
      "# create the table for tenants",
      "<!-- create the table -->",
      "we create a new table per tenant, see docs",
    ]) {
      expect(findRejectedCreateTableHeads(prose)).toEqual([]);
    }
    const { r } = compileSchemaApp(`    # create the table for tenants\n    CREATE TABLE assets ${COLS}`);
    expect(schemaCodes(r)).toEqual([]);
  });

  test("F-C: a known modifier with an unreadable name is still E-SCHEMA-013 (fail-closed kept)", () => {
    expect(findRejectedCreateTableHeads("CREATE TEMP TABLE my-t (x INT)").map((h) => h.kind)).toEqual(["unreadable"]);
  });
});

// Round 4 — NARROWING only (the review's exact shapes), each red on 38ec0e14.
describe("round 4 — the round-3 escapes are closed (F1 `$` boundary, F2 mask scope, F3 PARTITION OF)", () => {
  const C4 = "(id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL)";
  const kinds = (sql) => findRejectedCreateTableHeads(sql).map((h) => `${h.kind}:${h.name}`);
  const harvested = (sql) => { const m = new Map(); harvestRawCreateTables(sql, m); return [...m.keys()]; };

  test("F1: a dollar-quote delimiter directly before CREATE is not a word boundary — rejected AND harvested", () => {
    for (const sql of [`$$CREATE TABLE a.b.assets ${C4}$$`, `$f$CREATE TABLE a.b.assets ${C4}$f$`]) {
      expect(kinds(sql)).toEqual(["qualified:assets"]);
      expect(harvested(sql)).toContain("assets");
    }
  });

  test("F1: compiled — `CREATE FUNCTION mk() … AS $$CREATE TABLE app.public.assets (…)$$` is E-SCHEMA-012, floor engaged", () => {
    const { r, server } = compileSchemaApp(
      `    CREATE TABLE notes (id INTEGER PRIMARY KEY);\n    CREATE FUNCTION mk() RETURNS void LANGUAGE sql AS $$CREATE TABLE app.public.assets ${COLS}$$;`,
    );
    expect(errCodes(r)).toContain("E-SCHEMA-012");
    expect(tagged(server)).toBe(true);
  });

  test("F2: `//` and a `\"\"\"` pair INSIDE raw SQL no longer mask a later qualified head", () => {
    for (const sql of [
      `CREATE TABLE n (u TEXT DEFAULT $$http://x$$); CREATE UNLOGGED TABLE a.b.assets ${C4}`,
      `CREATE TABLE n (u TEXT DEFAULT $$http://x$$); CREATE TABLE a.b.assets ${C4}`,
      `CREATE TABLE n (x INT GENERATED ALWAYS AS (a // b) STORED); CREATE TABLE a.b.assets ${C4}`,
      `CREATE TABLE "t""" (id INTEGER);\nCREATE UNLOGGED TABLE a.b.assets ${C4};\nCREATE TABLE """u" (id INTEGER)`,
      `CREATE TABLE """a" (id INTEGER);\nCREATE TABLE a.b.assets ${C4};\nCREATE TABLE "b""" (id INTEGER)`,
      `CREATE TABLE n (x TEXT DEFAULT "")\n"x";\nCREATE TABLE a.b.assets ${C4};\n""" "`,
    ]) {
      expect(kinds(sql)).toContain("qualified:assets");
    }
  });

  test("F2: compiled — `$$http://x$$` on the line no longer lets a qualified UNLOGGED head escape", () => {
    const { r } = compileSchemaApp(
      `    CREATE TABLE notes (id INTEGER PRIMARY KEY, u TEXT DEFAULT $$http://x$$); CREATE UNLOGGED TABLE a.b.assets ${COLS}`,
    );
    expect(errCodes(r)).toContain("E-SCHEMA-012");
  });

  test("F2 (final): NO fn-body exemption — any `fn` form, parsed or not, leaves a qualified head reported", () => {
    expect(kinds(`fn f() security definer {\n"""\nCREATE TABLE a.b.assets ${C4};\n"""\n}`)).toEqual(["qualified:assets"]);
    expect(kinds(`fn f() {\n"""\nCREATE TABLE a.b.assets ${C4};\n`)).toEqual(["qualified:assets"]);
    // A real, parsed SECDEF fn body: the documented false positive (g-secdef-fn-body-ddl-false-positive).
    expect(kinds(`fn f(id: uuid) security definer owner(a) {\n"""\nCREATE TABLE a.b.assets ${C4};\n"""\n}`)).toEqual(["qualified:assets"]);
  });

  test("F2: a `//`-commented qualified head is the accepted fail-closed false positive", () => {
    expect(kinds(`// CREATE TABLE a.b.assets ${C4}`)).toEqual(["qualified:assets"]);
  });

  // S438 FINAL — the review's cases15: a forged / commented / braceless `fn` must
  // never silence a live qualified or unreadable head. Each is red on c59046d2.
  describe("final — no `fn` shape silences a head (cases15)", () => {
    const PG = "postgres://u:p@127.0.0.1:1/x";
    const C15 = "(id TEXT PRIMARY KEY, name TEXT, tenant_id TEXT NOT NULL)";
    const Q3 = `CREATE TABLE app.public.assets ${C15};`;
    const Q1 = `CREATE TABLE public.assets ${C15};`;
    const UNR = `CREATE TABLE my-db.public.assets ${C15};`;
    const pg = (schema) => (_db, _q) => `<program db="${PG}">
  <schema>
${schema}
  </schema>
  function loadAssets() {
    const rows = ?{ select id, name, tenant_id from assets }
    rows
  }
</program>`;
    const SHAPES = {
      "fn in -- comment, q3": [`    notes { id: text primary key }\n    -- fn f() owner(r) {\n    ${Q3}\n    -- }`, "E-SCHEMA-012"],
      "fn in -- comment, q1": [`    notes { id: text primary key }\n    -- fn f() owner(r) {\n    ${Q1}\n    -- }`, "E-SCHEMA-012"],
      "fn in -- comment, unreadable": [`    notes { id: text primary key }\n    -- fn f() owner(r) {\n    ${UNR}\n    -- }`, "E-SCHEMA-013"],
      "fn in /* */, q3": [`    notes { id: text primary key }\n    /* fn f() owner(r) { */\n    ${Q3}\n    /* } */`, "E-SCHEMA-012"],
      "braceless fn + DDL + DSL table, q3": [`    fn f() owner(r)\n    ${Q3}\n    notes { id: text primary key }`, "E-SCHEMA-012"],
      "braceless fn, unreadable": [`    fn f() owner(r)\n    ${UNR}\n    notes { id: text primary key }`, "E-SCHEMA-013"],
      "DDL in fn braces outside the `\"\"\"`, q3": [`    fn f() owner(r) { """select 1""" ${Q3} }`, "E-SCHEMA-012"],
      "real SECDEF + q3 in the `\"\"\"` body (documented false positive)": [`    CREATE TABLE assets ${C15};\n    fn f() owner(r) security definer {\n      """\n      ${Q3}\n      """\n    }`, "E-SCHEMA-012"],
    };
    for (const [label, [schema, code]] of Object.entries(SHAPES)) {
      test(`REJECTED: ${label}`, () => {
        const { r } = compileSchemaApp(null, pg(schema));
        expect(errCodes(r)).toContain(code);
      });
    }
  });

  test("F3: `PARTITION` is a name follower only as `PARTITION OF`", () => {
    // S446: a readable `PARTITION OF` head is no longer accepted silently — it has
    // no column list, so it is E-SCHEMA-014 (not E-SCHEMA-013 "unreadable").
    expect(kinds("CREATE TABLE assets_p PARTITION OF assets DEFAULT")).toEqual(["not-a-declaration:assets_p"]);
    expect(kinds("CREATE TABLE assets_p PARTITION assets DEFAULT")).toEqual(["unreadable:assets_p"]);
  });
});

describe("E-SCHEMA-012 — reader level: findRejectedCreateTableHeads", () => {
  const q = (sql) => findRejectedCreateTableHeads(sql)
    .filter((h) => h.kind === "qualified")
    .map((h) => ({ name: h.name, qualifiers: h.qualifiers }));
  const unreadable = (sql) => findRejectedCreateTableHeads(sql).filter((h) => h.kind === "unreadable").length;

  test("every qualifier count is SEEN — 1, 2, 3", () => {
    expect(q("CREATE TABLE a.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a"] }]);
    expect(q("CREATE TABLE a.b.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a", "b"] }]);
    expect(q("CREATE TABLE a.b.c.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a", "b", "c"] }]);
  });

  test("quoting of every kind, a doubled-quote escape, Unicode and `$`", () => {
    expect(q('CREATE TABLE "my""db"."t" (x INT)')).toEqual([{ name: "t", qualifiers: ['my"db'] }]);
    expect(q("CREATE TABLE `a`.[b].'c'.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a", "b", "c"] }]);
    expect(q("CREATE TABLE données.t (x INT)")).toEqual([{ name: "t", qualifiers: ["données"] }]);
    expect(q("CREATE TABLE app$v2.t (x INT)")).toEqual([{ name: "t", qualifiers: ["app$v2"] }]);
  });

  test("ANY modifier run (TEMP / GLOBAL TEMPORARY / UNLOGGED / OR REPLACE / VIRTUAL) does not hide a qualifier", () => {
    for (const mod of ["TEMP", "TEMPORARY", "UNLOGGED", "GLOBAL TEMPORARY", "temp", "OR REPLACE", "VIRTUAL"]) {
      expect(q(`CREATE ${mod} TABLE s.t (x INT)`)).toEqual([{ name: "t", qualifiers: ["s"] }]);
    }
  });

  test("a head spread across lines with comments between every token is still read", () => {
    expect(q("CREATE /*a*/ TABLE -- b\n IF /*c*/ NOT EXISTS s -- d\n . /*e*/ t (x INT)"))
      .toEqual([{ name: "t", qualifiers: ["s"] }]);
    // …and the head the DIAGNOSTIC shows is rebuilt from the parts — no comment leaks in.
    expect(findRejectedCreateTableHeads('create temp table "s" -- d\n . /*e*/ t (x INT)')[0].headText)
      .toBe('CREATE TEMP TABLE "s".t');
  });

  test("UNREADABLE heads are reported, not skipped (F3, fail-closed)", () => {
    expect(unreadable("CREATE TABLE my-db.t (x INT)")).toBe(1);
    expect(unreadable('CREATE TABLE "" (x INT)')).toBe(1);
    expect(unreadable("CREATE TABLE a．t (x INT)")).toBe(1);
    expect(unreadable("CREATE TABLE t​ (x INT)")).toBe(1);
    expect(unreadable("CREATE TABLE a /* /* nested */ */ . t (x INT)")).toBe(1);
    expect(unreadable("CREATE TABLE")).toBe(1);
    // readable heads are not
    expect(unreadable("CREATE TABLE t (x INT)")).toBe(0);
    expect(unreadable("CREATE TABLE t AS SELECT 1")).toBe(0);
    expect(unreadable("CREATE VIRTUAL TABLE t USING fts5(a)")).toBe(0);
  });

  test("NEGATIVES — none of these is rejected", () => {
    const none = (sql) => expect(findRejectedCreateTableHeads(sql)).toEqual([]);
    none("CREATE TABLE t (x INT)");
    none('CREATE TABLE "a.b" (x INT)');                        // one quoted identifier
    none("-- CREATE TABLE a.t (x INT)\n");                     // commented out
    none("/* CREATE TABLE a.b.t (x INT) */");
    none('notes { body: text default("CREATE TABLE x.y.z (a)") }');   // in a DSL string
    none("CREATE TABLE t (x INT REFERENCES s.parent(id))");   // body, not head
    none("CREATE INDEX s.i ON t (x)");                         // not a table head
    none("created_at.x (y)");                                  // `created` is not CREATE
    none("CREATE TABLE if (x INT)");                           // a table named `if`
    none("CREATE VIEW v AS SELECT a FROM t");                  // not a table head
  });

  test("a head AFTER a column body carrying a nested `(` is still found (resume past the real end)", () => {
    expect(q("CREATE TABLE t (x NUMERIC(10,2) CHECK (x > 0))\nCREATE TABLE s.u (y INT)"))
      .toEqual([{ name: "u", qualifiers: ["s"] }]);
  });

  test("a lookalike in a string, a regex, or an unbalanced quote never HIDES a later qualified head", () => {
    for (const pre of [
      "pattern(/a/*/)",                                      // unterminated-looking `/*` in a regex
      "people {\n name: text pattern(/o'brien/)\n}",          // lone `'` inside a regex
      'rules { glob: text default("/api/*") }',             // `/*` inside a string
      "links { u: text default(\"https://x\") }",           // `//` inside a string
      "notes -- don't\n",                                    // `'` inside a comment
      "prose with an apostrophe's\n",                        // unbalanced `'` bounded to its line
    ]) {
      expect(q(`${pre}\nCREATE TABLE s.t (x INT)\n/* end */`)).toEqual([{ name: "t", qualifiers: ["s"] }]);
    }
  });
});

// ---------------------------------------------------------------------------
// THE INVARIANT — harvest(branch) ⊇ harvest(base), table by table, column by column.
// ---------------------------------------------------------------------------
// The pre-S438 recognizer, VERBATIM (regex + strip + balanced body scan), as the
// oracle. Deliberately a COPY: the property is "never fewer than base", so the
// oracle must not move when the implementation does.
function baseHarvestColumns(text) {
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`'[]?(\w+)["`'\]]?\s*\.\s*)?["`'[]?(\w+)["`'\]]?\s*\(/gi;
  const bodyEnd = (src, from) => {
    let depth = 0, i = from;
    while (i < src.length) {
      const c = src[i];
      if (c === "-" && src[i + 1] === "-") { const nl = src.indexOf("\n", i); i = nl === -1 ? src.length : nl + 1; continue; }
      if (c === "/" && src[i + 1] === "*") { const cl = src.indexOf("*/", i + 2); i = cl === -1 ? src.length : cl + 2; continue; }
      if (c === "'" || c === '"' || c === "`") { let j = i + 1; while (j < src.length && src[j] !== c) j++; i = j + 1; continue; }
      if (c === "(") { depth++; i++; continue; }
      if (c === ")") { if (depth === 0) return i; depth--; i++; continue; }
      i++;
    }
    return -1;
  };
  const out = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    const bs = m.index + m[0].length;
    const be = bodyEnd(text, bs);
    if (be === -1) continue;
    const key = m[2].toLowerCase();
    if (!out.has(key)) {
      const t = parseRawCreateTableColumns(`CREATE TABLE x (${text.slice(bs, be)})`);
      out.set(key, t ? t.columns.map((c) => c.name) : []);
    }
    re.lastIndex = be + 1;
  }
  return out;
}

function assertSuperset(body) {
  const base = baseHarvestColumns(body);
  const branch = new Map();
  for (const d of harvestRawCreateTableDecls(body)) {
    const k = d.name.toLowerCase();
    if (!branch.has(k)) branch.set(k, d.columns.map((c) => c.name));
  }
  const map = new Map();
  harvestRawCreateTables(body, map);
  for (const [k, cols] of base) {
    if (!branch.has(k) || !map.has(k)) return `lost table \`${k}\` in:\n${body}`;
    for (const c of cols) if (!branch.get(k).includes(c)) return `lost column \`${k}.${c}\` in:\n${body}`;
  }
  return null;
}

describe("THE INVARIANT — harvest ⊇ the pre-S438 harvest, for every body", () => {
  // Every body shape this file and the S239 review exercised.
  const NAMED = [
    ...Object.values({
      a: `CREATE TABLE assets ${COLS}`,
      b: `routes {\n id: integer primary key\n path: text pattern(/^\\/*[a-z0-9-]+$/)\n}\nCREATE TABLE assets ${COLS}\n/* audit */\nCREATE TABLE audit (id INTEGER)`,
      c: `rules { glob: text default("/api/*") }\nCREATE TABLE assets ${COLS}\n/* end */`,
      d: `links { url: text default("https://example.com") } CREATE TABLE assets ${COLS}`,
      e: `links { d: text default("--") } CREATE TABLE assets ${COLS}`,
      f: `-- CREATE TABLE old.assets (id INTEGER)\nCREATE TABLE assets ${COLS}`,
      g: `/* CREATE TABLE assets ${COLS} */\nCREATE TABLE notes (id INTEGER)`,
      h: `xCREATE TABLE assets ${COLS}`,
      i: `CREATE TABLE notes (id INTEGER);CREATE TABLE a.b.assets ${COLS}`,
      j: `CREATE TABLE notes (id INTEGER, d TEXT DEFAULT $$ ) $$)\nCREATE TABLE a.b.assets ${COLS}`,
      k: `CREATE TABLE "assets ${COLS}`,
      l: `CREATE TABLE assets" ${COLS}`,
    }),
  ];
  test("the named review shapes", () => {
    for (const body of NAMED) expect(assertSuperset(body)).toBeNull();
  });

  test("a generated sweep: 5,000 seeded bodies mixing DSL literals, comments and every head spelling", () => {
    let seed = 0x5438;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pick = (xs) => xs[rnd(xs.length)];
    const DSL = [
      'routes {\n  id: integer primary key\n  path: text pattern(/^\\/*[a-z0-9-]+$/)\n}',
      'rules { glob: text default("/api/*") }',
      'links { url: text default("https://example.com") }',
      'm { d: text default("--") }',
      'p { n: text pattern(/o\'brien/) }',
      'q { s: text default("CREATE TABLE x.y.z (a)") }',
      "people {\n  id: integer primary key\n}",
    ];
    // Round 4 (the review's inv3): `$$`-prefixed heads, `"""` and `//` inside raw SQL.
    const TRIVIA = ["/* c */", "-- c", "// c", "/* unterminated", "'", "\"", "*/", "/*", "$$", "", '"""', '"""\n', "//", "http://", "$$http://x$$", 'fn f() {\n"""', '"""\n}', "'\"\"\"'"];
    const NAMES = ["assets", "notes", "orders", "données", "a$b", "Assets", '"a"""', '"""b"""'];
    const QUAL = ["", "public.", "db.public.", '"p".', "`p`.", "[p].", "p /* x */ . ", "p . ", "my-db.", '"".', '"p""".', "a.b.c."];
    const HEAD = ["CREATE TABLE ", "create table ", "CREATE TABLE IF NOT EXISTS ", "CREATE TEMP TABLE ", "CREATE /*x*/ TABLE ", "CREATE\tTABLE\n", "xCREATE TABLE ", "$$CREATE TABLE ", "$f$CREATE TABLE ", '"""CREATE TABLE ', "//CREATE TABLE ", "CREATE UNLOGGED TABLE ", "CREATE FOO TABLE ", "éCREATE TABLE ", "1CREATE TABLE "];
    const BODY = [COLS, "(id INTEGER, tenant_id TEXT CHECK (tenant_id <> ''))", "(id INTEGER, g TEXT DEFAULT '/*')", "(id INTEGER, u TEXT DEFAULT 'http://x', tenant_id TEXT)", "(id NUMERIC(10,2), tenant_id TEXT)", "(id INTEGER", "(id INTEGER, u TEXT DEFAULT '\"\"\"', tenant_id TEXT)", "(id INTEGER, u TEXT DEFAULT \"//x\", tenant_id TEXT)"];
    const SEP = ["\n", " ", ";", "\n\n", ""];
    for (let n = 0; n < 5000; n++) {
      const parts = [];
      const len = 1 + rnd(6);
      for (let p = 0; p < len; p++) {
        const kind = rnd(3);
        if (kind === 0) parts.push(pick(DSL));
        else if (kind === 1) parts.push(pick(TRIVIA));
        else parts.push(pick(HEAD) + pick(QUAL) + pick(NAMES) + " " + pick(BODY));
      }
      const body = parts.map((x) => x + pick(SEP)).join("");
      const failure = assertSuperset(body);
      if (failure) throw new Error(failure);
    }
  });
});

describe("the harvest reads the SAME heads — declaration and rejection cannot disagree", () => {
  test("a `<schema>` harvest takes every qualifier count, qualifiers STRIPPED (replayable)", () => {
    for (const sql of [
      "CREATE TABLE public.assets (id INTEGER, tenant_id TEXT)",
      "CREATE TABLE mydb.public.assets (id INTEGER, tenant_id TEXT)",
      'CREATE TABLE "db" /* c */ . "public" . "assets" (id INTEGER, tenant_id TEXT)',
    ]) {
      const out = new Map();
      harvestRawCreateTables(sql, out);
      expect([...out.keys()]).toEqual(["assets"]);
      const db = new Database(":memory:");
      try { expect(() => db.run(out.get("assets"))).not.toThrow(); } finally { db.close(); }
      expect(harvestRawCreateTableDecls(sql)[0].columns.map((c) => c.name)).toEqual(["id", "tenant_id"]);
    }
  });

  test("the `?{}` walker's acceptance is UNCHANGED — ≤1 qualifier stripped, ≥2 not harvested", () => {
    const one = new Map();
    harvestCreateTables("CREATE TABLE public.assets (id INTEGER)", one, true);
    expect([...one.keys()]).toEqual(["assets"]);
    const two = new Map();
    harvestCreateTables("CREATE TABLE mydb.public.assets (id INTEGER)", two, true);
    expect([...two.keys()]).toEqual([]);
  });

  test("a TEMP table is not newly declared by either harvest (pre-S438 behaviour held)", () => {
    const out = new Map();
    harvestRawCreateTables("CREATE TEMP TABLE assets (id INTEGER, tenant_id TEXT)", out);
    expect(out.size).toBe(0);
    expect(harvestRawCreateTableDecls("CREATE TEMP TABLE assets (id INTEGER, tenant_id TEXT)")).toEqual([]);
  });
});
