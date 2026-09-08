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
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  parseRawCreateTableColumns,
  harvestRawCreateTables,
} from "../../src/schema-differ.js";
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

describe("MEDIUM — a schema-QUALIFIED table name is the ordinary Postgres spelling", () => {
  // §14.8.11 is Postgres-ONLY, so `public.assets` is the likeliest spelling for
  // the tier's own adopters — and it used to match nothing, leaving the floor
  // inert at exit 0.
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
