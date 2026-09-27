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
  findQualifiedCreateTableHeads,
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
// E-SCHEMA-012 — a `<schema>` CREATE TABLE head SHALL NOT carry a qualifier
// (SPEC §39.2; bryan RULED S435 "1 both"; gap
// g-tenant-floor-inert-for-a-two-qualifier-create-table).
//
// THE DEFECT. The head regex had a slot for ZERO OR ONE qualifier, so
// `CREATE TABLE mydb.public.assets (…, tenant_id)` matched no recognizer: the
// table was undeclared, the §14.8.10 tenant floor emitted nothing, and — once a
// second, recognized table was present — even W-SCHEMA-NO-TABLES-DECLARED went
// quiet. Exit 0, silently inert isolation. The one-qualifier form was accepted
// by stripping, which collapses `a.assets` / `b.assets` onto one key.
//
// THE RULING: reject BOTH, fail-closed. The head is now READ as a name chain, so
// every qualifier count is SEEN; the compile-level cases below are the verdict,
// the reader-level cases pin each sibling shape of the head.
// ---------------------------------------------------------------------------
const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compileSchemaApp(schemaText) {
  const dir = mkdtempSync(join(tmpdir(), "e-schema-012-"));
  _tmp.push(dir);
  const dbAbs = join(dir, "app.db").replace(/\\/g, "/");
  const file = join(dir, "app.scrml");
  writeFileSync(file, `<program db="${dbAbs}">
  <schema>
${schemaText}
  </schema>
  \${
    function loadAssets() {
      const rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
      return rows
    }
  }
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
const COLS = "(id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)";

describe("E-SCHEMA-012 — compile level: a qualified `<schema>` CREATE TABLE head is REJECTED", () => {
  const REJECTED = {
    "one qualifier (was ACCEPTED pre-S438)": `    CREATE TABLE public.assets ${COLS}`,
    "two qualifiers (was SILENTLY INERT)": `    CREATE TABLE mydb.public.assets ${COLS}`,
    "two qualifiers + a second recognized table (was inert with NO warning)":
      `    CREATE TABLE mydb.public.assets ${COLS}\n    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)`,
    "double-quoted parts": `    CREATE TABLE "db"."public"."assets" ${COLS}`,
    "backtick + bracket parts": "    CREATE TABLE `mydb`.[public].assets " + COLS,
    "whitespace + comments around the dots": `    CREATE TABLE mydb /* x */ . -- y\n      public . assets ${COLS}`,
    "IF NOT EXISTS, lowercase": `    create table if not exists mydb.public.assets ${COLS}`,
    "TEMP modifier + temp. qualifier": `    CREATE TEMP TABLE temp.assets ${COLS}`,
    "a dangling qualifier with no name": `    CREATE TABLE public. (id INTEGER)`,
    "CREATE TABLE … AS (no column list)": `    CREATE TABLE a.assets AS SELECT 1`,
    "a DSL table beside it does not mask it":
      `    notes {\n      id: integer primary key\n    }\n    CREATE TABLE mydb.public.assets ${COLS}`,
  };
  for (const [label, schema] of Object.entries(REJECTED)) {
    test(`REJECTED: ${label}`, () => {
      const { r } = compileSchemaApp(schema);
      expect(errCodes(r)).toContain("E-SCHEMA-012");
    });
  }

  test("each qualified head is reported ONCE, and the error names the qualifier + the fix", () => {
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
    // The pre-fix two-qualifier compile emitted NO tenant tag. The rejection is
    // the gate; the harvest keeps the floor on regardless.
    const { r, server } = compileSchemaApp(
      `    CREATE TABLE mydb.public.assets ${COLS}\n    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)`,
    );
    expect(errCodes(r)).toContain("E-SCHEMA-012");
    expect(/_scrml_tenant_tag\(await _scrml_sql/.test(server)).toBe(true);
    // …and no misleading cascade: the block DOES declare a table.
    expect([...(r.warnings ?? []), ...(r.errors ?? [])].map((d) => d.code))
      .not.toContain("W-SCHEMA-NO-TABLES-DECLARED");
  });

  const ACCEPTED = {
    "an unqualified head": `    CREATE TABLE assets ${COLS}`,
    "an unqualified quoted head": `    CREATE TABLE "assets" ${COLS}`,
    "an unqualified IF NOT EXISTS head, lowercase": `    create table if not exists assets ${COLS}`,
    "a qualified head inside a -- comment is not a head":
      `    -- CREATE TABLE old.assets (id INTEGER)\n    CREATE TABLE assets ${COLS}`,
    "a qualified head inside a /* */ comment is not a head":
      `    /* CREATE TABLE old.public.assets (id INTEGER) */\n    CREATE TABLE assets ${COLS}`,
    "a DOT INSIDE a quoted name is one identifier, not a qualifier":
      `    CREATE TABLE "a.assets" ${COLS}\n    CREATE TABLE assets ${COLS}`,
    "a qualified REFERENCES target inside the column list is not a head":
      `    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT REFERENCES public.tenants(id))`,
    "the declarative DSL form": "    assets {\n      id: integer primary key\n      name: text\n      tenant_id: text\n    }",
  };
  for (const [label, schema] of Object.entries(ACCEPTED)) {
    test(`ACCEPTED: ${label}`, () => {
      const { r, server } = compileSchemaApp(schema);
      expect(errCodes(r)).not.toContain("E-SCHEMA-012");
      expect(r.errors ?? []).toEqual([]);
      expect(/_scrml_tenant_tag\(await _scrml_sql/.test(server)).toBe(true);
    });
  }
});

describe("E-SCHEMA-012 — reader level: findQualifiedCreateTableHeads", () => {
  const q = (sql) => findQualifiedCreateTableHeads(sql).map((h) => ({ name: h.name, qualifiers: h.qualifiers }));

  test("every qualifier count is SEEN — 1, 2, 3", () => {
    expect(q("CREATE TABLE a.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a"] }]);
    expect(q("CREATE TABLE a.b.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a", "b"] }]);
    expect(q("CREATE TABLE a.b.c.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a", "b", "c"] }]);
  });

  test("quoting of every kind, and a doubled-quote escape inside a part", () => {
    expect(q('CREATE TABLE "my""db"."t" (x INT)')).toEqual([{ name: "t", qualifiers: ['my"db'] }]);
    expect(q("CREATE TABLE `a`.[b].'c'.t (x INT)")).toEqual([{ name: "t", qualifiers: ["a", "b", "c"] }]);
  });

  test("modifiers (TEMP / TEMPORARY / UNLOGGED / GLOBAL TEMPORARY) do not hide a qualifier", () => {
    for (const mod of ["TEMP", "TEMPORARY", "UNLOGGED", "GLOBAL TEMPORARY", "temp"]) {
      expect(q(`CREATE ${mod} TABLE s.t (x INT)`)).toEqual([{ name: "t", qualifiers: ["s"] }]);
    }
  });

  test("a head spread across lines with comments between every token is still read", () => {
    expect(q("CREATE /*a*/ TABLE -- b\n IF /*c*/ NOT EXISTS s -- d\n . /*e*/ t (x INT)"))
      .toEqual([{ name: "t", qualifiers: ["s"] }]);
    // …and the head the DIAGNOSTIC shows is rebuilt from the parts — no comment leaks in.
    expect(findQualifiedCreateTableHeads('create temp table "s" -- d\n . /*e*/ t (x INT)')[0].headText)
      .toBe('CREATE TEMP TABLE "s".t');
  });

  test("NEGATIVES — none of these is a qualified head", () => {
    expect(q("CREATE TABLE t (x INT)")).toEqual([]);
    expect(q('CREATE TABLE "a.b" (x INT)')).toEqual([]);                        // one quoted identifier
    expect(q("-- CREATE TABLE a.t (x INT)\n")).toEqual([]);                    // commented out
    expect(q("/* CREATE TABLE a.b.t (x INT) */")).toEqual([]);
    expect(q("CREATE TABLE t (x INT REFERENCES s.parent(id))")).toEqual([]);   // body, not head
    expect(q("CREATE INDEX s.i ON t (x)")).toEqual([]);                        // not a table head
    expect(q("created_at.x (y)")).toEqual([]);                                 // `created` is not CREATE
    expect(q("CREATE TABLE if (x INT)")).toEqual([]);                          // a table named `if`
  });

  test("a head AFTER a column body carrying a nested `(` is still found (resume past the real end)", () => {
    expect(q("CREATE TABLE t (x NUMERIC(10,2) CHECK (x > 0))\nCREATE TABLE s.u (y INT)"))
      .toEqual([{ name: "u", qualifiers: ["s"] }]);
  });

  test("an UNTERMINATED /* does not swallow a later qualified head", () => {
    expect(q("pattern(/a/*/)\nCREATE TABLE s.t (x INT)")).toEqual([{ name: "t", qualifiers: ["s"] }]);
  });

  test("a lone `'` in DSL text (pattern(/o'brien/)) does not swallow a later qualified head", () => {
    expect(q("people {\n name: text pattern(/o'brien/)\n}\nCREATE TABLE s.t (x INT)"))
      .toEqual([{ name: "t", qualifiers: ["s"] }]);
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
    // E-SCHEMA-012 is scoped to `<schema>`; the `?{}` path keeps its pre-S438 set.
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
