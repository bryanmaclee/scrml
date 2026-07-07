import { describe, test, expect } from "bun:test";
import {
  readActualSchemaPg,
  readTableNamesPg,
  emitScrmlSchemaSource,
  mapPgTypeToScrml,
  parseSchemaBlock,
} from "../../src/schema-differ.js";

// ==========================================================================
// scrml introspect — remote Postgres schema introspection (BaaS #3).
//
// Exercises readActualSchemaPg + emitScrmlSchemaSource WITHOUT a live Postgres.
// `makeStubSql` returns a fake tagged-template `sql` that pattern-matches the
// query text and returns canned rows. The reader issues THREE queries per table
// (columns / PK+UNIQUE via table_constraints / FK via referential_constraints).
//
// Load-bearing property: nothing that cannot be REPRESENTED in scrml <schema>
// source is ever emitted as broken source — it is dropped/skipped WITH a
// warning (fail-loud, never fail-silent-corrupt), AND the emitter GUARANTEES its
// output round-trips through parseSchemaBlock (self-verifying emit).
// ==========================================================================

// --- Base fixture (constraints split into pkUnique + fk arrays) -----------
const FIXTURE = {
  users: {
    columns: [
      { column_name: "id",         data_type: "integer",                     is_nullable: "NO",  column_default: "nextval('users_id_seq'::regclass)", ordinal_position: 1 },
      { column_name: "email",      data_type: "text",                        is_nullable: "NO",  column_default: null,                                ordinal_position: 2 },
      { column_name: "created_at", data_type: "timestamp without time zone", is_nullable: "YES", column_default: "CURRENT_TIMESTAMP",                 ordinal_position: 3 },
    ],
    pkUnique: [
      { constraint_type: "PRIMARY KEY", constraint_name: "users_pkey",      column_name: "id" },
      { constraint_type: "UNIQUE",      constraint_name: "users_email_key", column_name: "email" },
    ],
    fk: [],
  },
  posts: {
    columns: [
      { column_name: "id",      data_type: "integer", is_nullable: "NO", column_default: "nextval('posts_id_seq'::regclass)", ordinal_position: 1 },
      { column_name: "user_id", data_type: "integer", is_nullable: "NO", column_default: null,                                ordinal_position: 2 },
    ],
    pkUnique: [
      { constraint_type: "PRIMARY KEY", constraint_name: "posts_pkey", column_name: "id" },
    ],
    fk: [
      { constraint_name: "posts_user_id_fkey", column_name: "user_id", key_ordinal: 1, foreign_table: "users", foreign_column: "id" },
    ],
  },
};

// --- Guard fixture (composite PK/UNIQUE/FK) -------------------------------
const FIXTURE_GUARDS = {
  accounts: {
    columns: [
      { column_name: "id",    data_type: "integer", is_nullable: "NO",  column_default: "nextval('accounts_id_seq'::regclass)", ordinal_position: 1 },
      { column_name: "uid",   data_type: "uuid",    is_nullable: "NO",  column_default: "gen_random_uuid()",                    ordinal_position: 2 },
      { column_name: "role",  data_type: "text",    is_nullable: "NO",  column_default: "'guest'::public.mood",                 ordinal_position: 3 },
      { column_name: "seats", data_type: "integer", is_nullable: "YES", column_default: "0",                                    ordinal_position: 4 },
      { column_name: "floor", data_type: "integer", is_nullable: "YES", column_default: "(-1)",                                 ordinal_position: 5 },
    ],
    pkUnique: [ { constraint_type: "PRIMARY KEY", constraint_name: "accounts_pkey", column_name: "id" } ],
    fk: [],
  },
  memberships: {
    columns: [
      { column_name: "org_id",  data_type: "integer", is_nullable: "NO", column_default: null, ordinal_position: 1 },
      { column_name: "user_id", data_type: "integer", is_nullable: "NO", column_default: null, ordinal_position: 2 },
      { column_name: "slug",    data_type: "text",    is_nullable: "NO", column_default: null, ordinal_position: 3 },
    ],
    pkUnique: [
      // composite PRIMARY KEY (org_id, user_id)
      { constraint_type: "PRIMARY KEY", constraint_name: "memberships_pkey", column_name: "org_id" },
      { constraint_type: "PRIMARY KEY", constraint_name: "memberships_pkey", column_name: "user_id" },
      // composite UNIQUE (org_id, slug)
      { constraint_type: "UNIQUE", constraint_name: "memberships_org_slug_key", column_name: "org_id" },
      { constraint_type: "UNIQUE", constraint_name: "memberships_org_slug_key", column_name: "slug" },
    ],
    fk: [
      // composite FOREIGN KEY (org_id, user_id) -> orgs(id, uid), position-paired
      { constraint_name: "memberships_fk", column_name: "org_id",  key_ordinal: 1, foreign_table: "orgs", foreign_column: "id" },
      { constraint_name: "memberships_fk", column_name: "user_id", key_ordinal: 2, foreign_table: "orgs", foreign_column: "uid" },
    ],
  },
};

/**
 * Stub Bun.SQL over a fixture. Dispatch order matters: the FK query contains
 * BOTH "referential_constraints" and "table_constraints", so match
 * referential_constraints FIRST. The parameterized table filter (and per-table
 * name) arrive as interpolated values.
 */
function makeStubSql(fixture) {
  const calls = [];
  const sql = (strings, ...values) => {
    const raw = strings.join(" ");
    calls.push(raw);
    if (raw.includes("information_schema.tables")) {
      let names = Object.keys(fixture);
      if (values.length > 0) names = names.filter((n) => n === values[0]); // parameterized --table filter
      return Promise.resolve(names.map((name) => ({ table_name: name })));
    }
    const tn = values[0];
    if (raw.includes("referential_constraints")) {
      return Promise.resolve((fixture[tn]?.fk ?? []).slice());
    }
    if (raw.includes("table_constraints")) {
      return Promise.resolve((fixture[tn]?.pkUnique ?? []).slice());
    }
    if (raw.includes("information_schema.columns")) {
      return Promise.resolve((fixture[tn]?.columns ?? []).slice());
    }
    throw new Error("stub sql: unrecognized query: " + raw);
  };
  sql._calls = calls;
  return sql;
}

// ==========================================================================
// §1 — readActualSchemaPg with a stub sql: exact returned structure
// ==========================================================================
describe("introspect §1: readActualSchemaPg structure", () => {
  test("returns { tables, warnings } superset structure", async () => {
    const sql = makeStubSql(FIXTURE);
    const { tables, warnings } = await readActualSchemaPg(sql);

    expect(warnings).toEqual([]);
    expect(tables.map((t) => t.name)).toEqual(["users", "posts"]);

    expect(tables[0].columns).toEqual([
      { name: "id",         type: "integer",                     notNull: true,  default: "nextval('users_id_seq'::regclass)", primaryKey: true,  unique: false, references: null, sharedCorePredicates: [] },
      { name: "email",      type: "text",                        notNull: true,  default: null,                                primaryKey: false, unique: true,  references: null, sharedCorePredicates: [] },
      { name: "created_at", type: "timestamp without time zone", notNull: false, default: "CURRENT_TIMESTAMP",                 primaryKey: false, unique: false, references: null, sharedCorePredicates: [] },
    ]);

    expect(tables[1].columns).toEqual([
      { name: "id",      type: "integer", notNull: true, default: "nextval('posts_id_seq'::regclass)", primaryKey: true,  unique: false, references: null,                          sharedCorePredicates: [] },
      { name: "user_id", type: "integer", notNull: true, default: null,                                primaryKey: false, unique: false, references: { table: "users", column: "id" }, sharedCorePredicates: [] },
    ]);
  });

  test("--table filter pushes into the tables query (only reads that table)", async () => {
    const sql = makeStubSql(FIXTURE);
    const { tables } = await readActualSchemaPg(sql, { tableFilter: "posts" });
    expect(tables.map((t) => t.name)).toEqual(["posts"]);
    // no columns/constraints for `users` were ever queried
    expect(sql._calls.some((q) => q.includes("information_schema.columns"))).toBe(true);
  });

  test("readTableNamesPg lists all base tables", async () => {
    const sql = makeStubSql(FIXTURE);
    expect(await readTableNamesPg(sql)).toEqual(["users", "posts"]);
  });
});

// ==========================================================================
// §2 — emitScrmlSchemaSource: canonical <schema> source
// ==========================================================================
describe("introspect §2: emitScrmlSchemaSource", () => {
  test("emits the canonical §39.2 source shape", async () => {
    const sql = makeStubSql(FIXTURE);
    const { tables } = await readActualSchemaPg(sql);
    const { source, warnings, emittedTables, droppedCount } = emitScrmlSchemaSource({ tables });

    expect(warnings).toEqual([]);
    expect(droppedCount).toBe(0);
    expect(emittedTables).toEqual(["users", "posts"]);
    expect(source).toBe(
      "<schema>\n" +
      "  users {\n" +
      "    id: integer primary key\n" +
      "    email: text not null unique\n" +
      "    created_at: timestamp default(CURRENT_TIMESTAMP)\n" +
      "  }\n" +
      "  posts {\n" +
      "    id: integer primary key\n" +
      "    user_id: integer not null references users(id)\n" +
      "  }\n" +
      "</>\n"
    );
  });

  test("primary key suppresses redundant not null / unique tokens", () => {
    const { source } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "id", type: "integer", notNull: true, unique: true, primaryKey: true, default: null, references: null },
      ] }],
    });
    expect(source).toContain("    id: integer primary key\n");
    expect(source).not.toContain("primary key not null");
    expect(source).not.toContain("primary key unique");
  });

  test("drops a nextval(...) serial default silently (serial -> integer)", () => {
    const { source, warnings, droppedCount } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: "nextval('t_id_seq'::regclass)", references: null },
      ] }],
    });
    expect(source).not.toContain("nextval");
    expect(source).not.toContain("default(");
    expect(warnings).toEqual([]);
    expect(droppedCount).toBe(0);
  });

  test("strips a trailing ::type cast from a literal default", () => {
    const { source } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "role", type: "text", notNull: false, unique: false, primaryKey: false, default: "'guest'::text", references: null },
      ] }],
    });
    expect(source).toContain("role: text default('guest')");
  });
});

// ==========================================================================
// §3 — Round-trip: introspect -> emit -> parse -> structure (base).
// ==========================================================================
describe("introspect §3: round-trip through parseSchemaBlock", () => {
  test("emitted source parses back to the fixture structure", async () => {
    const sql = makeStubSql(FIXTURE);
    const { tables } = await readActualSchemaPg(sql);
    const { source } = emitScrmlSchemaSource({ tables });

    const parsed = parseSchemaBlock(source);
    expect(parsed.tables.map((t) => t.name)).toEqual(["users", "posts"]);
    const [users, posts] = parsed.tables;

    const [uId, uEmail, uCreated] = users.columns;
    expect({ n: uId.name, st: uId.scrmlType, pk: uId.primaryKey }).toEqual({ n: "id", st: "integer", pk: true });
    expect({ n: uEmail.name, st: uEmail.scrmlType, nn: uEmail.notNull, u: uEmail.unique }).toEqual({ n: "email", st: "text", nn: true, u: true });
    expect({ n: uCreated.name, st: uCreated.scrmlType, def: uCreated.default }).toEqual({ n: "created_at", st: "timestamp", def: "CURRENT_TIMESTAMP" });

    const [pId, pUserId] = posts.columns;
    expect({ n: pId.name, st: pId.scrmlType, pk: pId.primaryKey }).toEqual({ n: "id", st: "integer", pk: true });
    expect({ n: pUserId.name, st: pUserId.scrmlType, nn: pUserId.notNull, ref: pUserId.references }).toEqual({ n: "user_id", st: "integer", nn: true, ref: { table: "users", column: "id" } });
  });
});

// ==========================================================================
// §4 — Postgres data_type -> scrml column type map.
// ==========================================================================
describe("introspect §4: mapPgTypeToScrml type map", () => {
  const CASES = [
    ["integer", "integer"], ["int", "integer"], ["int2", "integer"], ["int4", "integer"],
    ["int8", "integer"], ["smallint", "integer"], ["bigint", "integer"],
    ["serial", "integer"], ["bigserial", "integer"], ["smallserial", "integer"],
    ["text", "text"], ["varchar", "text"], ["character varying", "text"],
    ["char", "text"], ["character", "text"], ["citext", "text"], ["bpchar", "text"],
    ["boolean", "boolean"], ["bool", "boolean"],
    ["numeric", "real"], ["decimal", "real"], ["real", "real"],
    ["double precision", "real"], ["float4", "real"], ["float8", "real"],
    ["timestamp", "timestamp"], ["timestamp without time zone", "timestamp"],
    ["timestamptz", "timestamp"], ["timestamp with time zone", "timestamp"], ["date", "timestamp"],
  ];
  for (const [pg, scrml] of CASES) {
    test(`${pg} -> ${scrml}`, () => {
      const r = mapPgTypeToScrml(pg);
      expect(r.scrmlType).toBe(scrml);
      expect(r.unmapped).toBe(false);
    });
  }
  test("case- and whitespace-insensitive", () => {
    expect(mapPgTypeToScrml("  INTEGER  ").scrmlType).toBe("integer");
    expect(mapPgTypeToScrml("TIMESTAMP WITHOUT TIME ZONE").scrmlType).toBe("timestamp");
  });
  for (const unmapped of ["json", "jsonb", "uuid", "bytea", "inet", "point", "integer[]", "tsvector"]) {
    test(`${unmapped} -> text + unmapped`, () => {
      const r = mapPgTypeToScrml(unmapped);
      expect(r.scrmlType).toBe("text");
      expect(r.unmapped).toBe(true);
    });
  }
});

// ==========================================================================
// §5 — Composite-constraint guards (reader-side).
// ==========================================================================
describe("introspect §5: composite constraint guards", () => {
  test("composite PK + UNIQUE + FK are SKIPPED with warnings; columns stay plain", async () => {
    const sql = makeStubSql(FIXTURE_GUARDS);
    const { tables, warnings } = await readActualSchemaPg(sql);

    const composite = warnings.filter((w) => w.startsWith("W-INTROSPECT-COMPOSITE-CONSTRAINT-SKIPPED"));
    expect(composite).toHaveLength(3);
    expect(composite.some((w) => w.includes("PRIMARY KEY") && w.includes("org_id, user_id"))).toBe(true);
    expect(composite.some((w) => w.includes("UNIQUE") && w.includes("org_id, slug"))).toBe(true);
    expect(composite.some((w) => w.includes("FOREIGN KEY") && w.includes("org_id, user_id"))).toBe(true);

    const memberships = tables.find((t) => t.name === "memberships");
    for (const col of memberships.columns) {
      expect(col.primaryKey).toBe(false);
      expect(col.unique).toBe(false);
      expect(col.references).toBe(null);
    }
  });

  test("single-column PK still works alongside a skipped composite", async () => {
    const sql = makeStubSql(FIXTURE_GUARDS);
    const { tables } = await readActualSchemaPg(sql);
    expect(tables.find((t) => t.name === "accounts").columns.find((c) => c.name === "id").primaryKey).toBe(true);
  });

  test("FK constraint query correlates by table_name + pairs by position (finding 6)", async () => {
    const sql = makeStubSql(FIXTURE);
    await readActualSchemaPg(sql, { tableFilter: "posts" });
    const fkQuery = sql._calls.find((q) => q.includes("referential_constraints"));
    expect(fkQuery).toBeDefined();
    expect(fkQuery).toContain("kcu.table_name");                 // table_name correlation
    expect(fkQuery).toContain("position_in_unique_constraint");  // position pairing
  });
});

// ==========================================================================
// §6 — Self-verifying emit: the INVARIANT (fail-loud, no mis-parse).
// ==========================================================================
describe("introspect §6: self-verifying emit", () => {
  test("brace string default ('{}') is DROPPED + warned; surviving columns intact", () => {
    const { source, warnings } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "id",   type: "integer", notNull: true,  unique: false, primaryKey: true,  default: null,          references: null },
        { name: "meta", type: "jsonb",   notNull: false, unique: false, primaryKey: false, default: "'{}'::jsonb", references: null },
        { name: "tail", type: "text",    notNull: false, unique: false, primaryKey: false, default: null,          references: null },
      ] }],
    });
    expect(source).not.toContain("'{}'");
    expect(source).not.toContain("default(");
    expect(source).toContain("meta: text");
    expect(source).toContain("tail: text"); // NOT truncated by the brace
    expect(warnings.some((w) => w.startsWith("W-INTROSPECT-DEFAULT-DROPPED") && w.includes("t.meta"))).toBe(true);
    // invariant: the emitted source round-trips cleanly
    const parsed = parseSchemaBlock(source);
    expect(parsed.tables[0].columns.map((c) => c.name)).toEqual(["id", "meta", "tail"]);
  });

  test("newline-in-string default is DROPPED + warned", () => {
    const { source, warnings } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "note", type: "text", notNull: false, unique: false, primaryKey: false, default: "'line1\nline2'", references: null },
      ] }],
    });
    expect(source).not.toContain("line2");
    expect(source).toContain("note: text");
    expect(warnings.some((w) => w.startsWith("W-INTROSPECT-DEFAULT-DROPPED"))).toBe(true);
    expect(parseSchemaBlock(source).tables[0].columns).toHaveLength(1);
  });

  test("predicate-named FK target (references max(id)) drops the ref + warns", () => {
    const { source, warnings } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "max_id", type: "integer", notNull: false, unique: false, primaryKey: false, default: null, references: { table: "max", column: "id" } },
      ] }],
    });
    expect(source).toContain("max_id: integer");
    expect(source).not.toContain("references");
    expect(warnings.some((w) => w.startsWith("W-INTROSPECT-REFERENCE-DROPPED") && w.includes("max"))).toBe(true);
    // no spurious `max` predicate leaked
    expect(parseSchemaBlock(source).tables[0].columns[0].sharedCorePredicates).toHaveLength(0);
  });

  test("negative numeric default (-1) is KEPT as default(-1) and round-trips (finding 3)", () => {
    const { source, warnings } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "floor", type: "integer", notNull: false, unique: false, primaryKey: false, default: "(-1)", references: null },
      ] }],
    });
    expect(source).toContain("floor: integer default(-1)");
    expect(warnings.filter((w) => w.startsWith("W-INTROSPECT-DEFAULT-DROPPED"))).toHaveLength(0);
    expect(parseSchemaBlock(source).tables[0].columns[0].default).toBe("-1");
  });

  test("normal literals + FK survive intact through the guard fixture", async () => {
    const sql = makeStubSql(FIXTURE_GUARDS);
    const { tables } = await readActualSchemaPg(sql);
    const { source } = emitScrmlSchemaSource({ tables });
    expect(source).toContain("seats: integer default(0)");
    expect(source).toContain("floor: integer default(-1)");
    expect(source).toContain("role: text not null default('guest')"); // qualified cast stripped
    expect(source).not.toContain("gen_random_uuid");                  // function default dropped
    expect(source).not.toContain("public.mood");
  });

  // ------------------------------------------------------------------------
  // THE INVARIANT: a battery of synthetic actual-schemas (hostile + normal).
  // For each, emit is a FIXED POINT — re-emitting from the parsed output yields
  // the identical source, and no field diverges after emit -> parseSchemaBlock.
  // ------------------------------------------------------------------------
  const q = "'"; // single quote
  const BATTERY = [
    { name: "all-normal", tables: [{ name: "a", columns: [
      { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
      { name: "n", type: "text", notNull: true, unique: true, primaryKey: false, default: `${q}x${q}`, references: null },
      { name: "cnt", type: "integer", notNull: false, unique: false, primaryKey: false, default: "0", references: null },
      { name: "fk", type: "integer", notNull: false, unique: false, primaryKey: false, default: null, references: { table: "a", column: "id" } },
    ] }] },
    { name: "brace+newline+neg", tables: [{ name: "b", columns: [
      { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
      { name: "j", type: "jsonb", notNull: false, unique: false, primaryKey: false, default: `${q}{}${q}::jsonb`, references: null },
      { name: "nl", type: "text", notNull: false, unique: false, primaryKey: false, default: `${q}a\nb${q}`, references: null },
      { name: "neg", type: "integer", notNull: false, unique: false, primaryKey: false, default: "(-42)", references: null },
      { name: "fn", type: "timestamp", notNull: false, unique: false, primaryKey: false, default: "now()", references: null },
    ] }] },
    { name: "predicate-fk+kebab", tables: [
      { name: "c", columns: [
        { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
        { name: "r", type: "integer", notNull: false, unique: false, primaryKey: false, default: null, references: { table: "max", column: "id" } },
        { name: "bad-col", type: "text", notNull: false, unique: false, primaryKey: false, default: null, references: null },
      ] },
      { name: "kebab-table", columns: [
        { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
      ] },
    ] },
  ];

  for (const schema of BATTERY) {
    test(`INVARIANT: emit is a fixed point + round-trips [${schema.name}]`, () => {
      const first = emitScrmlSchemaSource({ tables: schema.tables });
      const parsed = parseSchemaBlock(first.source);

      // Re-derive an actual-schema from the parsed structure (scrmlType maps to
      // itself), re-emit, and assert byte-identical source (fixed point => the
      // emitted source is stable and fully round-trips).
      const reAcutal = {
        tables: parsed.tables.map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.scrmlType,
            notNull: c.notNull,
            unique: c.unique,
            primaryKey: c.primaryKey,
            default: c.default,
            references: c.references,
          })),
        })),
      };
      const second = emitScrmlSchemaSource(reAcutal);
      expect(second.source).toBe(first.source);
      expect(second.droppedCount).toBe(0); // nothing left to drop — first pass was complete

      // No parsed column carries a spurious shared-core predicate (the in-string
      // predicate-name / predicate-named-FK footgun).
      for (const t of parsed.tables) {
        for (const col of t.columns) {
          expect(col.sharedCorePredicates ?? []).toHaveLength(0);
        }
      }
    });
  }
});

// ==========================================================================
// §7 — Identifier guards + emittedTables/droppedCount (CLI bug-4 support).
// ==========================================================================
describe("introspect §7: identifier guards + emit metadata", () => {
  test("unrepresentable table name is SKIPPED whole + warned; not in emittedTables", () => {
    const { source, warnings, emittedTables, droppedCount } = emitScrmlSchemaSource({
      tables: [
        { name: "user-profiles", columns: [
          { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
        ] },
        { name: "ok_table", columns: [
          { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
        ] },
      ],
    });
    expect(source).not.toContain("user-profiles");
    expect(source).toContain("ok_table {");
    expect(emittedTables).toEqual(["ok_table"]);
    expect(droppedCount).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.startsWith("W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE") && w.includes("user-profiles"))).toBe(true);
  });

  test("a --table request that resolves to an unrepresentable table -> emittedTables excludes it (CLI errors)", () => {
    const { emittedTables } = emitScrmlSchemaSource(
      { tables: [{ name: "user-profiles", columns: [
        { name: "id", type: "integer", notNull: true, unique: false, primaryKey: true, default: null, references: null },
      ] }] },
      { tableFilter: "user-profiles" },
    );
    expect(emittedTables).toEqual([]); // CLI turns this into a loud error + exit 1
  });

  test("unrepresentable column name is SKIPPED; rest of the table emits", () => {
    const { source, warnings } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "id",      type: "integer", notNull: true,  unique: false, primaryKey: true,  default: null, references: null },
        { name: "bad-col", type: "text",    notNull: false, unique: false, primaryKey: false, default: null, references: null },
        { name: "ok",      type: "text",    notNull: false, unique: false, primaryKey: false, default: null, references: null },
      ] }],
    });
    expect(source).not.toContain("bad-col");
    expect(source).toContain("id: integer primary key");
    expect(source).toContain("ok: text");
    expect(warnings.some((w) => w.startsWith("W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE") && w.includes("t.bad-col"))).toBe(true);
  });

  test("unrepresentable FK target drops the references clause; column still emits", () => {
    const { source, warnings } = emitScrmlSchemaSource({
      tables: [{ name: "t", columns: [
        { name: "parent_id", type: "integer", notNull: false, unique: false, primaryKey: false, default: null, references: { table: "user-profiles", column: "id" } },
      ] }],
    });
    expect(source).toContain("parent_id: integer");
    expect(source).not.toContain("references");
    expect(warnings.some((w) => w.startsWith("W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE") && w.includes("references"))).toBe(true);
  });
});
