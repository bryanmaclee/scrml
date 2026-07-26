import { describe, test, expect } from "bun:test";
import {
  parseSchemaBlock,
  diffSchema,
  generateCreateTable,
  generateDbAuthoritativeDDL,
} from "../../src/schema-differ.js";
import { quoteIdent } from "../../src/codegen/sql-ident.ts";

// ==========================================================================
// SECURITY — identifier interpolation must quote-double embedded `"` so a
// live-DB-sourced (attacker-influencable) table/column name cannot break out of
// its identifier and inject a second statement executed as the migrator (the
// PA-found blocking HIGH — durable tenant-isolation bypass / owner→superuser RCE).
// ==========================================================================
describe("schema-differ SECURITY: identifier escaping in emitted DDL", () => {
  // The exact PoC from the review: a live column name that, interpolated naively,
  // closes the identifier and appends a permissive-policy statement.
  const PAYLOAD = `amount"; CREATE POLICY pleak ON invoices USING (true); --`;

  test("DROP COLUMN quote-doubles a malicious live column name (no break-out)", () => {
    const desired = { tables: [{ name: "invoices", columns: [{ name: "id", type: "uuid", scrmlType: "uuid", primaryKey: true, notNull: false, default: null, sharedCorePredicates: [] }] }] };
    const actual = {
      tables: [
        {
          name: "invoices",
          columns: [
            { name: "id", type: "uuid", primaryKey: true, notNull: false, default: null, sharedCorePredicates: [] },
            { name: PAYLOAD, type: "numeric", primaryKey: false, notNull: false, default: null, sharedCorePredicates: [] },
          ],
        },
      ],
    };
    const { sql } = diffSchema(desired, actual, { driver: "postgres" });
    const drop = sql.find((s) => s.startsWith("ALTER TABLE") && s.includes("DROP COLUMN"));
    expect(drop).toBeDefined();
    // Exact escaped form — the payload's `"` is doubled, keeping it ONE identifier.
    expect(drop).toBe(`ALTER TABLE "invoices" DROP COLUMN ${quoteIdent(PAYLOAD)};`);
    // Escape applied (a doubled quote is present) …
    expect(drop).toContain('amount""');
    // … and the naive break-out (`amount"` immediately closing the identifier
    // before the injected `;`) is NOT present — the injected statement stays inert
    // text inside the quoted identifier, not a second executable statement.
    expect(drop).not.toContain('amount";');
  });

  test("CREATE TABLE quote-doubles a `\"`-bearing column name", () => {
    const ddl = generateCreateTable(
      { name: `t"x`, columns: [{ name: `a"b`, type: "text", scrmlType: "text", primaryKey: false, notNull: false, default: null, references: null, sharedCorePredicates: [] }] },
      "postgres",
    );
    expect(ddl).toContain('"t""x"');
    expect(ddl).toContain('"a""b"');
  });

  test("generateDbAuthoritativeDDL quote-doubles the table name", () => {
    const ddl = generateDbAuthoritativeDDL({
      name: `inv"x`,
      columns: [{ name: "tenant_id", type: "uuid", scrmlType: "uuid" }],
    }).join("\n");
    // Every statement that names the table uses the escaped identifier …
    expect(ddl).toContain('"inv""x"');
    // … and never the un-doubled form that would break out.
    expect(ddl).not.toContain('"inv"x"');
  });
});

// ==========================================================================
// §1 — parseSchemaBlock: basic table parsing
// ==========================================================================
describe("schema-differ §1: parseSchemaBlock basics", () => {
  test("parses a single table with columns", () => {
    const result = parseSchemaBlock(`
      users {
        id: integer primary key
        name: text not null
        email: text not null unique
      }
    `);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe("users");
    expect(result.tables[0].columns).toHaveLength(3);
  });

  test("parses column types correctly", () => {
    const result = parseSchemaBlock(`
      items {
        id: integer primary key
        name: text not null
        price: real
        data: blob
        active: boolean
        created: timestamp
      }
    `);
    const cols = result.tables[0].columns;
    expect(cols[0].type).toBe("INTEGER");
    expect(cols[1].type).toBe("TEXT");
    expect(cols[2].type).toBe("REAL");
    expect(cols[3].type).toBe("BLOB");
    expect(cols[4].type).toBe("INTEGER"); // boolean → INTEGER
    expect(cols[5].type).toBe("TEXT");     // timestamp → TEXT
  });

  test("parses multiple tables", () => {
    const result = parseSchemaBlock(`
      users { id: integer primary key }
      posts { id: integer primary key }
    `);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].name).toBe("users");
    expect(result.tables[1].name).toBe("posts");
  });

  test("parses constraints: not null, unique, primary key", () => {
    const result = parseSchemaBlock(`
      users {
        id: integer primary key
        email: text not null unique
      }
    `);
    const [id, email] = result.tables[0].columns;
    expect(id.primaryKey).toBe(true);
    expect(email.notNull).toBe(true);
    expect(email.unique).toBe(true);
  });

  test("parses default values", () => {
    const result = parseSchemaBlock(`
      users {
        plan: text default('free')
        active: boolean default(1)
      }
    `);
    const [plan, active] = result.tables[0].columns;
    expect(plan.default).toBe("'free'");
    expect(active.default).toBe("1");
  });

  test("parses references", () => {
    const result = parseSchemaBlock(`
      posts {
        user_id: integer references users(id)
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.references).toEqual({ table: "users", column: "id" });
  });

  test("parses rename from", () => {
    const result = parseSchemaBlock(`
      users {
        display_name: text rename from name
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.renameFrom).toBe("name");
  });
});

// ==========================================================================
// §2 — diffSchema: new tables
// ==========================================================================
describe("schema-differ §2: diffSchema new tables", () => {
  test("generates CREATE TABLE for new table", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        name: text not null
      }
    `);
    const actual = { tables: [] };
    const { sql } = diffSchema(desired, actual);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("CREATE TABLE");
    expect(sql[0]).toContain('"users"');
    expect(sql[0]).toContain('"id" INTEGER PRIMARY KEY');
    expect(sql[0]).toContain('"name" TEXT NOT NULL');
  });

  test("generates CREATE TABLE for multiple new tables", () => {
    const desired = parseSchemaBlock(`
      users { id: integer primary key }
      posts { id: integer primary key }
    `);
    const actual = { tables: [] };
    const { sql } = diffSchema(desired, actual);
    expect(sql).toHaveLength(2);
  });
});

// ==========================================================================
// §3 — diffSchema: add columns
// ==========================================================================
describe("schema-differ §3: diffSchema add columns", () => {
  test("generates ADD COLUMN for new nullable column", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        name: text not null
        plan: text
      }
    `);
    const actual = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null },
          { name: "name", type: "TEXT", primaryKey: false, notNull: true, default: null },
        ],
      }],
    };
    const { sql } = diffSchema(desired, actual);
    expect(sql.some(s => s.includes("ADD COLUMN") && s.includes('"plan"'))).toBe(true);
  });

  test("generates ADD COLUMN with default for NOT NULL column", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        plan: text not null default('free')
      }
    `);
    const actual = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null },
        ],
      }],
    };
    const { sql } = diffSchema(desired, actual);
    expect(sql.some(s => s.includes("ADD COLUMN") && s.includes("NOT NULL") && s.includes("DEFAULT"))).toBe(true);
  });
});

// ==========================================================================
// §4 — diffSchema: rename columns
// ==========================================================================
describe("schema-differ §4: diffSchema rename columns", () => {
  test("generates RENAME COLUMN when rename from is specified", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        display_name: text rename from name
      }
    `);
    const actual = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null },
          { name: "name", type: "TEXT", primaryKey: false, notNull: false, default: null },
        ],
      }],
    };
    const { sql } = diffSchema(desired, actual);
    expect(sql.some(s => s.includes("RENAME COLUMN") && s.includes('"name"') && s.includes('"display_name"'))).toBe(true);
  });
});

// ==========================================================================
// §5 — diffSchema: drop tables
// ==========================================================================
describe("schema-differ §5: diffSchema drop tables", () => {
  const desired = parseSchemaBlock(`
    users { id: integer primary key }
  `);
  const actual = {
    tables: [
      { name: "users", columns: [{ name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null }] },
      { name: "legacy", columns: [{ name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null }] },
    ],
  };

  // §14.8.11 M2 fence (ruled): the bare `DROP TABLE` is gated behind
  // `--allow-destructive`. Default (fence ON) suppresses the drop with a
  // W-SCHEMA-DESTRUCTIVE-DROP warning; opt-in restores the historical DROP.
  test("default (fence ON) — suppresses DROP TABLE, warns W-SCHEMA-DESTRUCTIVE-DROP", () => {
    const { sql, warnings } = diffSchema(desired, actual);
    expect(sql.some(s => s.includes("DROP TABLE"))).toBe(false);
    expect(warnings.some(w => w.includes("W-SCHEMA-DESTRUCTIVE-DROP") && w.includes('"legacy"'))).toBe(true);
    // The historical destructive W-SCHEMA-002 is NOT emitted when the drop is fenced off.
    expect(warnings.some(w => w.includes("W-SCHEMA-002"))).toBe(false);
  });

  test("--allow-destructive — emits DROP TABLE + W-SCHEMA-002 for a removed table", () => {
    const { sql, warnings } = diffSchema(desired, actual, { allowDestructive: true });
    expect(sql.some(s => s.includes("DROP TABLE") && s.includes('"legacy"'))).toBe(true);
    expect(warnings.some(w => w.includes("W-SCHEMA-002"))).toBe(true);
  });
});

// ==========================================================================
// §6 — diffSchema: no changes needed
// ==========================================================================
describe("schema-differ §6: diffSchema no changes", () => {
  test("returns empty SQL when schemas match", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        name: text not null
      }
    `);
    const actual = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null },
          { name: "name", type: "TEXT", primaryKey: false, notNull: true, default: null },
        ],
      }],
    };
    const { sql } = diffSchema(desired, actual);
    expect(sql).toHaveLength(0);
  });
});

// ==========================================================================
// §7 — Full lifecycle: version 1 → version 2
// ==========================================================================
describe("schema-differ §7: full lifecycle v1 → v2", () => {
  test("handles the SPEC §38 worked example", () => {
    // Version 1: just users
    const v1 = parseSchemaBlock(`
      users {
        id: integer primary key
        name: text not null
        email: text not null unique
      }
    `);
    const emptyDb = { tables: [] };
    const { sql: v1Sql } = diffSchema(v1, emptyDb);
    expect(v1Sql).toHaveLength(1);
    expect(v1Sql[0]).toContain("CREATE TABLE");

    // Version 2: add plan to users, add posts table
    const v2 = parseSchemaBlock(`
      users {
        id: integer primary key
        name: text not null
        email: text not null unique
        plan: text default('free')
      }
      posts {
        id: integer primary key
        title: text not null
        author_id: integer not null references users(id)
        created_at: timestamp default(CURRENT_TIMESTAMP)
      }
    `);
    const afterV1 = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null },
          { name: "name", type: "TEXT", primaryKey: false, notNull: true, default: null },
          { name: "email", type: "TEXT", primaryKey: false, notNull: true, default: null },
        ],
      }],
    };
    const { sql: v2Sql } = diffSchema(v2, afterV1);
    // Should ADD COLUMN plan to users + CREATE TABLE posts
    expect(v2Sql.some(s => s.includes("ADD COLUMN") && s.includes('"plan"'))).toBe(true);
    expect(v2Sql.some(s => s.includes("CREATE TABLE") && s.includes('"posts"'))).toBe(true);
  });
});

// ==========================================================================
// §8 — C17: parseSharedCorePredicates — recognizes the 13 schema-locus
//       shared-core predicates per §39.5.7. Each gets captured into the
//       column's sharedCorePredicates array; SQL-mirror parsing unchanged.
// ==========================================================================
describe("schema-differ §8 (C17): parser recognizes shared-core predicates", () => {
  test("req — bareword captured", () => {
    const result = parseSchemaBlock(`
      users {
        name: text req
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.sharedCorePredicates).toHaveLength(1);
    expect(col.sharedCorePredicates[0].name).toBe("req");
    expect(col.sharedCorePredicates[0].arg).toBeNull();
  });

  test("req with inline message — still recognized as req predicate", () => {
    const result = parseSchemaBlock(`
      users {
        name: text req("Required")
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.sharedCorePredicates.some(p => p.name === "req")).toBe(true);
  });

  test("length(>=2) captured with raw arg", () => {
    const result = parseSchemaBlock(`
      users {
        name: text length(>=2)
      }
    `);
    const col = result.tables[0].columns[0];
    const lengthPred = col.sharedCorePredicates.find(p => p.name === "length");
    expect(lengthPred).toBeDefined();
    expect(lengthPred.arg).toBe(">=2");
  });

  test("pattern(/regex/) captured with slash-delimited body", () => {
    const result = parseSchemaBlock(`
      users {
        email: text pattern(/^[a-z]+@.+$/)
      }
    `);
    const col = result.tables[0].columns[0];
    const patternPred = col.sharedCorePredicates.find(p => p.name === "pattern");
    expect(patternPred).toBeDefined();
    expect(patternPred.arg).toBe("/^[a-z]+@.+$/");
  });

  test("min/max — numeric args captured", () => {
    const result = parseSchemaBlock(`
      users {
        age: integer min(18) max(120)
      }
    `);
    const col = result.tables[0].columns[0];
    const minP = col.sharedCorePredicates.find(p => p.name === "min");
    const maxP = col.sharedCorePredicates.find(p => p.name === "max");
    expect(minP.arg).toBe("18");
    expect(maxP.arg).toBe("120");
  });

  test("gt/lt/gte/lte — comparable args captured", () => {
    const result = parseSchemaBlock(`
      users {
        score: integer gt(0) lt(100) gte(1) lte(99)
      }
    `);
    const col = result.tables[0].columns[0];
    const names = col.sharedCorePredicates.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(["gt", "lt", "gte", "lte"]));
  });

  test("eq/neq — equatable args captured", () => {
    const result = parseSchemaBlock(`
      users {
        flag: integer eq(1) neq(0)
      }
    `);
    const col = result.tables[0].columns[0];
    const names = col.sharedCorePredicates.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(["eq", "neq"]));
  });

  test("oneOf([...]) — array literal captured verbatim including commas", () => {
    const result = parseSchemaBlock(`
      users {
        role: text oneOf(['admin','editor','viewer'])
      }
    `);
    const col = result.tables[0].columns[0];
    const oneOfP = col.sharedCorePredicates.find(p => p.name === "oneOf");
    expect(oneOfP).toBeDefined();
    expect(oneOfP.arg).toBe("['admin','editor','viewer']");
  });

  test("notIn([...]) — array literal captured verbatim", () => {
    const result = parseSchemaBlock(`
      users {
        status: text notIn(['banned','deleted'])
      }
    `);
    const col = result.tables[0].columns[0];
    const notInP = col.sharedCorePredicates.find(p => p.name === "notIn");
    expect(notInP).toBeDefined();
    expect(notInP.arg).toBe("['banned','deleted']");
  });

  test("mixed: SQL-mirror + shared-core on the same column", () => {
    const result = parseSchemaBlock(`
      users {
        name: text not null unique req length(>=2)
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.notNull).toBe(true);
    expect(col.unique).toBe(true);
    const names = col.sharedCorePredicates.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(["req", "length"]));
  });

  test("non-predicate identifiers (text type, references, etc.) NOT captured as predicates", () => {
    const result = parseSchemaBlock(`
      posts {
        user_id: integer not null references users(id)
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.sharedCorePredicates).toEqual([]);
    expect(col.references).toEqual({ table: "users", column: "id" });
  });
});

// ==========================================================================
// §9 — C17: §39.5.8 lowering rules — generateCreateTable lowers each
//       shared-core predicate to its DDL form. SQLite is the default driver.
// ==========================================================================
describe("schema-differ §9 (C17): shared-core lowering to DDL (sqlite)", () => {
  test("req on text → NOT NULL + CHECK (col != '')", () => {
    const desired = parseSchemaBlock(`
      users {
        name: text req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain('"name" TEXT NOT NULL');
    expect(sql[0]).toContain(`CHECK ("name" != '')`);
  });

  test("req on blob → NOT NULL + CHECK (col != '')", () => {
    const desired = parseSchemaBlock(`
      attachments {
        data: blob req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain('"data" BLOB NOT NULL');
    expect(sql[0]).toContain(`CHECK ("data" != '')`);
  });

  test("req on integer → NOT NULL only (NO empty-string check)", () => {
    const desired = parseSchemaBlock(`
      users {
        age: integer req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain('"age" INTEGER NOT NULL');
    expect(sql[0]).not.toContain(`CHECK ("age" != '')`);
  });

  test("req on real → NOT NULL only", () => {
    const desired = parseSchemaBlock(`
      readings {
        value: real req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain('"value" REAL NOT NULL');
    expect(sql[0]).not.toContain(`!=`);
  });

  test("req on boolean → NOT NULL only", () => {
    const desired = parseSchemaBlock(`
      users {
        active: boolean req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain('"active" INTEGER NOT NULL');
    expect(sql[0]).not.toContain(`!=`);
  });

  test("req on timestamp → NOT NULL only", () => {
    const desired = parseSchemaBlock(`
      users {
        created_at: timestamp req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain('"created_at" TEXT NOT NULL');
    expect(sql[0]).not.toContain(`CHECK ("created_at" != '')`);
  });

  test("length(>=2) → CHECK (length(col) >= 2)", () => {
    const desired = parseSchemaBlock(`
      users {
        name: text length(>=2)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK (length("name") >= 2)`);
  });

  test("length(<=500) → CHECK (length(col) <= 500)", () => {
    const desired = parseSchemaBlock(`
      users {
        bio: text length(<=500)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK (length("bio") <= 500)`);
  });

  test("length(>0) and length(<5) — strict bounds", () => {
    const d1 = parseSchemaBlock(`t1 { c: text length(>0) }`);
    const d2 = parseSchemaBlock(`t2 { c: text length(<5) }`);
    expect(diffSchema(d1, { tables: [] }).sql[0]).toContain(`length("c") > 0`);
    expect(diffSchema(d2, { tables: [] }).sql[0]).toContain(`length("c") < 5`);
  });

  test("length(==3) → CHECK (length(col) = 3) (== normalized to =)", () => {
    const desired = parseSchemaBlock(`
      codes {
        c: text length(==3)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`length("c") = 3`);
  });

  test("length(!=0) → CHECK (length(col) != 0)", () => {
    const desired = parseSchemaBlock(`
      codes {
        c: text length(!=0)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`length("c") != 0`);
  });

  test("min(18) → CHECK (col >= 18); max(120) → CHECK (col <= 120)", () => {
    const desired = parseSchemaBlock(`
      users {
        age: integer min(18) max(120)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK ("age" >= 18)`);
    expect(sql[0]).toContain(`CHECK ("age" <= 120)`);
  });

  test("gt/lt/gte/lte each emit the right operator", () => {
    const desired = parseSchemaBlock(`
      m {
        a: integer gt(0)
        b: integer lt(10)
        c: integer gte(1)
        d: integer lte(9)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK ("a" > 0)`);
    expect(sql[0]).toContain(`CHECK ("b" < 10)`);
    expect(sql[0]).toContain(`CHECK ("c" >= 1)`);
    expect(sql[0]).toContain(`CHECK ("d" <= 9)`);
  });

  test("eq/neq each emit the right operator", () => {
    const desired = parseSchemaBlock(`
      m {
        a: integer eq(7)
        b: integer neq(0)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK ("a" = 7)`);
    expect(sql[0]).toContain(`CHECK ("b" != 0)`);
  });

  test("oneOf([...]) → CHECK (col IN (...)) — verbatim list", () => {
    const desired = parseSchemaBlock(`
      users {
        role: text oneOf(['admin','editor','viewer'])
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK ("role" IN ('admin','editor','viewer'))`);
  });

  test("notIn([...]) → CHECK (col NOT IN (...))", () => {
    const desired = parseSchemaBlock(`
      users {
        status: text notIn(['banned','deleted'])
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK ("status" NOT IN ('banned','deleted'))`);
  });
});

// ==========================================================================
// §10 — C17: pattern() — driver-aware lowering per §39.5.8.
//        SQLite/MySQL → REGEXP; Postgres → ~
// ==========================================================================
describe("schema-differ §10 (C17): pattern() driver matrix", () => {
  test("sqlite (default) → CHECK (col REGEXP 'pattern')", () => {
    const desired = parseSchemaBlock(`
      users {
        email: text pattern(/^[a-z]+@.+$/)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`CHECK ("email" REGEXP '^[a-z]+@.+$')`);
  });

  test("sqlite explicit", () => {
    const desired = parseSchemaBlock(`
      users {
        email: text pattern(/abc/)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] }, { driver: "sqlite" });
    expect(sql[0]).toContain(`CHECK ("email" REGEXP 'abc')`);
  });

  test("mysql → REGEXP (same as sqlite)", () => {
    const desired = parseSchemaBlock(`
      users {
        email: text pattern(/abc/)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] }, { driver: "mysql" });
    expect(sql[0]).toContain(`CHECK ("email" REGEXP 'abc')`);
  });

  test("postgres → ~ operator", () => {
    const desired = parseSchemaBlock(`
      users {
        email: text pattern(/abc/)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] }, { driver: "postgres" });
    expect(sql[0]).toContain(`CHECK ("email" ~ 'abc')`);
    expect(sql[0]).not.toContain("REGEXP");
  });

  test("pattern with single-quote in regex source — escaped via SQL doubling", () => {
    const desired = parseSchemaBlock(`
      users {
        s: text pattern(/o'brien/)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`'o''brien'`);
  });
});

// ==========================================================================
// §11 — C17: SQL-mirror + shared-core mixed forms — both legal per §39.5.7;
//        emission concatenates cleanly, no duplicates, no ordering surprises.
// ==========================================================================
describe("schema-differ §11 (C17): mixed SQL-mirror + shared-core", () => {
  test("not null + req → single NOT NULL emitted (no duplicate)", () => {
    const desired = parseSchemaBlock(`
      users {
        name: text not null req
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    // NOT NULL appears exactly once for the name column.
    const nameLine = sql[0].split("\n").find(l => l.includes('"name"'));
    const matches = nameLine.match(/NOT NULL/g) || [];
    expect(matches).toHaveLength(1);
    // Empty-string CHECK still emitted (req on text).
    expect(sql[0]).toContain(`CHECK ("name" != '')`);
  });

  test("unique + length(>=2) — both clauses emitted", () => {
    const desired = parseSchemaBlock(`
      users {
        slug: text unique length(>=2)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`"slug" TEXT UNIQUE`);
    expect(sql[0]).toContain(`CHECK (length("slug") >= 2)`);
  });

  test("references(table.col) + oneOf([...]) — both clauses emitted on FK col", () => {
    const desired = parseSchemaBlock(`
      posts {
        kind: text references kinds(id) oneOf(['draft','published'])
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).toContain(`REFERENCES "kinds"("id")`);
    expect(sql[0]).toContain(`CHECK ("kind" IN ('draft','published'))`);
  });

  test("worked example from SPEC §39.5.8 — verbatim regression", () => {
    // SPEC.md §39.5.8 worked example (line 16452+):
    //   id, email (SQL-mirror), name (req length(>=2)), age (min/max),
    //   role (oneOf), bio (length(<=500)), created_at (default timestamp)
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        email: text not null unique
        name: text req length(>=2)
        age: integer min(18) max(120)
        role: text oneOf(['admin','editor','viewer'])
        bio: text length(<=500)
        created_at: timestamp default(CURRENT_TIMESTAMP)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    const create = sql[0];
    expect(create).toContain(`"id" INTEGER PRIMARY KEY`);
    expect(create).toContain(`"email" TEXT NOT NULL UNIQUE`);
    expect(create).toContain(`"name" TEXT NOT NULL`);
    expect(create).toContain(`CHECK ("name" != '')`);
    expect(create).toContain(`CHECK (length("name") >= 2)`);
    expect(create).toContain(`CHECK ("age" >= 18)`);
    expect(create).toContain(`CHECK ("age" <= 120)`);
    expect(create).toContain(`CHECK ("role" IN ('admin','editor','viewer'))`);
    expect(create).toContain(`CHECK (length("bio") <= 500)`);
    expect(create).toContain(`"created_at" TEXT DEFAULT (CURRENT_TIMESTAMP)`);
    // bio has no req, so no NOT NULL — only the length check.
    const bioLine = create.split("\n").find(l => l.includes('"bio"'));
    expect(bioLine).not.toContain("NOT NULL");
  });
});

// ==========================================================================
// §12 — C17: ?{} SQL passthrough is INVIOLABLE per §39.5.8 line 16447.
//        Vocabulary unification touches only scrml source-level words; the
//        emitted DDL retains its standard CREATE TABLE shape, and the schema
//        differ never inspects ?{} blocks.
// ==========================================================================
describe("schema-differ §12 (C17): ?{} passthrough inviolable", () => {
  test("schema-differ reads ONLY <schema> body — ?{} text is out of its scope", () => {
    // The schema-differ accepts a body string; a `<db>` block's `?{...}`
    // contents are never passed to it. Confirm by passing input that contains
    // a tableName{...} only — ?{} elsewhere in the file isn't this module's
    // concern.
    const result = parseSchemaBlock(`
      users {
        name: text req length(>=2)
      }
    `);
    expect(result.tables).toHaveLength(1);
    // Emitted SQL is standard CREATE TABLE / standard CHECK / NOT NULL only.
    const { sql } = diffSchema(result, { tables: [] });
    const create = sql[0];
    expect(create.startsWith("CREATE TABLE")).toBe(true);
    // No `?{` artifact leaks into emitted SQL.
    expect(create).not.toContain("?{");
    expect(create).not.toContain("}?");
  });

  test("emitted DDL retains standard SQL shape — no scrml-source words leak", () => {
    const desired = parseSchemaBlock(`
      users {
        role: text oneOf(['a','b'])
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    // No scrml-source predicate names in the emitted SQL.
    expect(sql[0]).not.toMatch(/\boneOf\b/);
    expect(sql[0]).not.toMatch(/\breq\b/);
    expect(sql[0]).not.toMatch(/\bnotIn\b/);
    // Standard SQL shape preserved.
    expect(sql[0]).toContain("CREATE TABLE");
    expect(sql[0]).toContain("CHECK");
    expect(sql[0]).toContain("IN (");
  });
});

// ==========================================================================
// §13 — C17: Cross-locus L4 alignment — same predicate name has the same
//        meaning across loci (state-cell, refinement, schema). Verify the
//        validator-catalog (B10) names align with what schema-differ accepts.
// ==========================================================================
describe("schema-differ §13 (C17): cross-locus L4 alignment", () => {
  test("the 13 schema-locus predicate names are also universal-core predicates", async () => {
    // Import the validator catalog to confirm cross-locus naming alignment
    // (L4: SAME predicate word → SAME meaning across loci).
    const { isUniversalCorePredicate } = await import("../../src/validator-catalog.ts");
    const SCHEMA_LOCUS_NAMES = [
      "req", "length", "pattern",
      "min", "max",
      "gt", "lt", "gte", "lte",
      "eq", "neq",
      "oneOf", "notIn",
    ];
    for (const name of SCHEMA_LOCUS_NAMES) {
      expect(isUniversalCorePredicate(name)).toBe(true);
    }
  });

  test("'is some' is a universal-core predicate but NOT a schema-locus predicate", async () => {
    // §39.5.7 enumerates 13 predicates explicitly, omitting `is some`. This
    // test pins the documented decision: schema-differ ignores `is some`.
    const { isUniversalCorePredicate } = await import("../../src/validator-catalog.ts");
    expect(isUniversalCorePredicate("is some")).toBe(true);
    // Schema-differ does not parse `is some` as a predicate (multi-word; not
    // listed in SCHEMA_LOCUS_PREDICATES). A column with that text doesn't
    // produce a sharedCorePredicates entry.
    const result = parseSchemaBlock(`
      users {
        name: text is some
      }
    `);
    const col = result.tables[0].columns[0];
    expect(col.sharedCorePredicates.find(p => p.name === "is some")).toBeUndefined();
    expect(col.sharedCorePredicates.find(p => p.name === "is")).toBeUndefined();
  });
});

// ==========================================================================
// §14 — C17: Regression — existing SQL-mirror-only schemas emit byte-identical
//        DDL (no CHECK clauses sneak in when no shared-core predicate is
//        present).
// ==========================================================================
describe("schema-differ §14 (C17): SQL-mirror-only emission unchanged", () => {
  test("a SQL-mirror-only schema emits NO CHECK clauses", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        email: text not null unique
        name: text not null
        created_at: timestamp default(CURRENT_TIMESTAMP)
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql[0]).not.toContain("CHECK");
  });

  test("the §38 worked example (SQL-mirror only) emits unchanged shape", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        email: text not null unique
        name: text not null
      }
      posts {
        id: integer primary key
        user_id: integer not null references users(id)
        title: text not null
      }
    `);
    const { sql } = diffSchema(desired, { tables: [] });
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain(`"id" INTEGER PRIMARY KEY`);
    expect(sql[0]).toContain(`"email" TEXT NOT NULL UNIQUE`);
    expect(sql[1]).toContain(`REFERENCES "users"("id")`);
    expect(sql.join("\n")).not.toContain("CHECK");
  });
});

// ==========================================================================
// §15 — C17: ADD COLUMN with shared-core predicates handles req-as-NOT-NULL
//        like the SQL-mirror NOT NULL: simple ADD COLUMN only when default
//        is provided; otherwise rebuild via the 12-step path.
// ==========================================================================
describe("schema-differ §15 (C17): ADD COLUMN with shared-core req", () => {
  test("ADD COLUMN with req + default → simple ALTER TABLE ADD COLUMN", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        plan: text req default('free')
      }
    `);
    const actual = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null, sharedCorePredicates: [] },
        ],
      }],
    };
    const { sql } = diffSchema(desired, actual);
    expect(sql.some(s => s.startsWith("ALTER TABLE") && s.includes("ADD COLUMN") && s.includes("NOT NULL") && s.includes("DEFAULT"))).toBe(true);
    // Empty-string check appended.
    expect(sql.some(s => s.includes(`CHECK ("plan" != '')`))).toBe(true);
  });

  test("ADD COLUMN with req only (no default) on text → falls back to 12-step rebuild", () => {
    const desired = parseSchemaBlock(`
      users {
        id: integer primary key
        plan: text req
      }
    `);
    const actual = {
      tables: [{
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null, sharedCorePredicates: [] },
        ],
      }],
    };
    const { sql } = diffSchema(desired, actual);
    // Should rebuild — first SQL is the new CREATE TABLE (with tmp prefix).
    expect(sql.some(s => s.includes("_scrml_tmp_users"))).toBe(true);
    // Rebuild's CREATE has the new req column with NOT NULL + check.
    expect(sql.some(s => s.includes("CREATE TABLE") && s.includes("_scrml_tmp_users") && s.includes("NOT NULL"))).toBe(true);
  });
});
