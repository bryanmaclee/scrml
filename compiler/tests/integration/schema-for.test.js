/**
 * §41.15 (S104) — schemaFor end-to-end integration tests.
 *
 * Coverage:
 *   §1 — Full pipeline: compile a scrml source with `<schema>${ schemaFor(T) }</>`
 *        + then run `parseSchemaBlock` on the rewritten source body + assert the
 *        resulting table-declaration matches the struct shape (round-trip).
 *   §2 — `diffSchema` produces a correct `CREATE TABLE` for a schemaFor-derived
 *        table against an empty actual DB.
 *   §3 — Multi-table composition: two schemaFor calls in one <schema> block
 *        produce two table declarations + two CREATE TABLE statements.
 *   §4 — The flagship enum-lowering (OQ-SCH-12 / §41.15.6) — bare-variant enum
 *        field lowers to `CHECK (col IN ('Variant1', 'Variant2', ...))`.
 *   §5 — Pluralization rule per §41.15.2 (`User → users`).
 *   §6 — Interleaved hand-authored + schemaFor produces a unified DDL emission.
 *
 * The pipeline-side check is performed via the same code path that `scrml
 * migrate` uses: post-TS source rebuild + parseSchemaBlock + diffSchema. The
 * rewriter produces text injected into the AST; we extract it by walking
 * the typed-AST output and reading the synthesized text child.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCE } from "../../src/component-expander.ts";
import { runRI } from "../../src/route-inference.ts";
import { runPA } from "../../src/protect-analyzer.ts";
import { runTS } from "../../src/type-system.ts";
import { parseSchemaBlock, diffSchema } from "../../src/schema-differ.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "schema-for-int-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

/**
 * Drive the type-system stage on a single source file and return the
 * post-TS AST. This is the minimal pipeline path that exercises the
 * schemaFor walker without requiring downstream codegen.
 */
function compileToTS(source, filePath) {
  const abs = fx(filePath, source);
  const split = splitBlocks(abs, source);
  const built = buildAST(split);
  // CE wraps each file in {filePath, ast, errors} where `ast` is the FileAST.
  const ceInputFile = {
    filePath: built.filePath || abs,
    ast: built.ast,
    errors: built.errors || [],
  };
  const ceResult = runCE({ files: [ceInputFile] });
  // CE output files have shape {filePath, ast: FileAST, errors}.
  // The pipeline-side runPA/runRI/runTS consume the same shape.
  const ceFiles = ceResult.files;
  const paResult = runPA({ files: ceFiles });
  const riResult = runRI({ files: ceFiles, protectAnalysis: paResult.protectAnalysis });
  const tsResult = runTS({
    files: ceFiles,
    protectAnalysis: paResult.protectAnalysis,
    routeMap: riResult.routeMap,
  });
  return { tsResult, ceFiles, abs };
}

/**
 * Walk the post-TS AST and find the first `<schema>` state node. Returns its
 * children array (which after the schemaFor rewrite contains a synthesized
 * text node carrying the expanded table-declaration body).
 *
 * Accepts either a CE/TS file record `{ast: FileAST, ...}` or a bare
 * FileAST `{nodes: [...]}` or a bare nodes array.
 */
function findSchemaChildren(input) {
  // Unwrap to nodes array.
  let nodes;
  if (Array.isArray(input)) nodes = input;
  else if (input && typeof input === "object") {
    if (Array.isArray(input.nodes)) nodes = input.nodes;
    else if (input.ast && Array.isArray(input.ast.nodes)) nodes = input.ast.nodes;
    else return null;
  } else {
    return null;
  }
  function walk(arr) {
    if (!Array.isArray(arr)) return null;
    for (const n of arr) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "state" && n.stateType === "schema") return n.children || [];
      const r = walk(n.children) || walk(n.body);
      if (r) return r;
    }
    return null;
  }
  return walk(nodes);
}

/**
 * Extract the synthesized table-declaration body as a single concatenated
 * string from the rewritten <schema> children. The rewrite replaces each
 * `logic` (schemaFor call) child with a `text` child carrying the expanded
 * body; pre-existing text children (whitespace, hand-authored tables) are
 * preserved verbatim. Concatenating all text-kind children yields the
 * source body equivalent to a hand-authored `<schema>` block.
 */
function extractSchemaBodyText(input) {
  const children = findSchemaChildren(input);
  if (!children) return "";
  let text = "";
  for (const c of children) {
    if (c && c.kind === "text" && typeof c.value === "string") {
      text += c.value;
    }
  }
  return text;
}

function realErrors(result) {
  return (result.errors || []).filter(e => e && e.severity !== "warning");
}

// ---------------------------------------------------------------------------
// §1 — Full pipeline: schemaFor → text → parseSchemaBlock round-trip.
// ---------------------------------------------------------------------------

describe("§1 schemaFor → text → parseSchemaBlock round-trip", () => {
  test("simple User struct produces 'users' table with expected columns", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    email: string req length(<=120)
    name:  string req length(>=2, <=80)
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p1/user.scrml");
    const sfErrs = realErrors(tsResult).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);

    const body = extractSchemaBodyText(tsResult.files[0]);
    expect(body).toContain("users {");
    // The validator argsRaw is whitespace-preserved from the lexer's
    // operator tokenization — `length(<=120)` becomes `length( <= 120 )`.
    // Test on structural shape, not literal text.
    expect(body).toMatch(/email: text req length\(\s*<=\s*120\s*\)/);
    expect(body).toMatch(/name: text req length\(\s*>=\s*2\s*,\s*<=\s*80\s*\)/);

    // Round-trip through schema-differ.parseSchemaBlock.
    const parsed = parseSchemaBlock(body);
    expect(parsed.tables.length).toBe(1);
    const usersTable = parsed.tables[0];
    expect(usersTable.name).toBe("users");
    expect(usersTable.columns.length).toBe(2);
    const emailCol = usersTable.columns.find(c => c.name === "email");
    const nameCol = usersTable.columns.find(c => c.name === "name");
    expect(emailCol).toBeDefined();
    expect(emailCol.scrmlType).toBe("text");
    expect(emailCol.sharedCorePredicates.some(p => p.name === "req")).toBe(true);
    expect(emailCol.sharedCorePredicates.some(p => p.name === "length")).toBe(true);
    expect(nameCol).toBeDefined();
    expect(nameCol.sharedCorePredicates.some(p => p.name === "req")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — diffSchema produces correct CREATE TABLE.
// ---------------------------------------------------------------------------

describe("§2 schemaFor → diffSchema → CREATE TABLE", () => {
  test("User struct → CREATE TABLE users with NOT NULL + CHECK constraints", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    email: string req length(<=120)
    name:  string req length(>=2)
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p2/user.scrml");
    const body = extractSchemaBodyText(tsResult.files[0]);
    const desired = parseSchemaBlock(body);
    const actual = { tables: [] };
    const { sql, warnings } = diffSchema(desired, actual, { driver: "sqlite" });
    expect(warnings).toEqual([]);
    // One CREATE TABLE for "users".
    const createStmt = sql.find(s => s.startsWith('CREATE TABLE') && s.includes('"users"'));
    expect(createStmt).toBeDefined();
    // NOT NULL constraints from `req`.
    expect(createStmt).toContain("NOT NULL");
    // CHECK constraints from `length()`.
    expect(createStmt).toContain("length(");
  });
});

// ---------------------------------------------------------------------------
// §3 — Multi-table composition.
// ---------------------------------------------------------------------------

describe("§3 multi-table composition", () => {
  test("two schemaFor calls in one <schema> produce two tables", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string req
    email: string req
  }
  type Post:struct = {
    title: string req
    body:  string req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
    \${ schemaFor(Post) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p3/multi.scrml");
    const sfErrs = realErrors(tsResult).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);

    const body = extractSchemaBodyText(tsResult.files[0]);
    expect(body).toContain("users {");
    expect(body).toContain("posts {");

    const parsed = parseSchemaBlock(body);
    expect(parsed.tables.length).toBe(2);
    const tableNames = parsed.tables.map(t => t.name).sort();
    expect(tableNames).toEqual(["posts", "users"]);
  });
});

// ---------------------------------------------------------------------------
// §4 — Flagship enum-lowering (OQ-SCH-12 / §41.15.6).
// ---------------------------------------------------------------------------

describe("§4 flagship: bare-variant enum auto-lowers to oneOf([...])", () => {
  test("Status enum field lowers to text req oneOf(['Pending','Active','Archived'])", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type Status:enum = { Pending, Active, Archived }
  type Task:struct = {
    name:   string req
    status: Status req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Task) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p4/task.scrml");
    const body = extractSchemaBodyText(tsResult.files[0]);
    expect(body).toContain("status: text req");
    expect(body).toContain(`oneOf(['Pending', 'Active', 'Archived'])`);

    const parsed = parseSchemaBlock(body);
    const statusCol = parsed.tables[0].columns.find(c => c.name === "status");
    expect(statusCol).toBeDefined();
    const oneOfPred = statusCol.sharedCorePredicates.find(p => p.name === "oneOf");
    expect(oneOfPred).toBeDefined();
    expect(oneOfPred.arg).toContain("'Pending'");
    expect(oneOfPred.arg).toContain("'Active'");
    expect(oneOfPred.arg).toContain("'Archived'");

    // Diff path: ensure the CHECK constraint emerges in the CREATE TABLE.
    // SPEC §39.5.8 worked example (line 17090) — single-quoted IN literals.
    // The schema-differ column quoter uses double quotes for column names.
    const { sql } = diffSchema(parsed, { tables: [] }, { driver: "sqlite" });
    const createStmt = sql.find(s => s.startsWith("CREATE TABLE") && s.includes('"tasks"'));
    expect(createStmt).toBeDefined();
    expect(createStmt).toMatch(/CHECK \("?status"? IN \('Pending', 'Active', 'Archived'\)\)/);
  });
});

// ---------------------------------------------------------------------------
// §5 — Pluralization rule (§41.15.2).
// ---------------------------------------------------------------------------

describe("§5 pluralization rule", () => {
  test("'LoadAssignment' struct produces 'loadassignments' table (no snake_case)", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type LoadAssignment:struct = {
    notes: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(LoadAssignment) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p5/loadassignment.scrml");
    const body = extractSchemaBodyText(tsResult.files[0]);
    // SPEC §41.15.2 is authoritative — lowercase + trailing `s`. The deep-
    // dive's snake_case framing is superseded.
    expect(body).toContain("loadassignments {");
    expect(body).not.toContain("load_assignments");
  });

  test("'News' struct produces 'news' table (no double-s)", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type News:struct = {
    headline: string req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(News) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p5/news.scrml");
    const body = extractSchemaBodyText(tsResult.files[0]);
    expect(body).toContain("news {");
    expect(body).not.toContain("newss");
  });
});

// ---------------------------------------------------------------------------
// §6 — Interleaved hand-authored + schemaFor.
// ---------------------------------------------------------------------------

describe("§6 interleaved hand-authored + schemaFor", () => {
  test("schemaFor + hand-authored 'posts' table both emit", () => {
    // Hand-authored 'posts' uses `references users(id)` — the ONLY foreign-key
    // production §39.5.5 declares.
    //
    // CORRECTED S290: this comment previously said the dot-in-parens form
    // `references(users.id)` was "reserved for v1.next schema-differ
    // enhancement". It was never a reserved feature — it was a silent DEFECT.
    // §39.5.5 declared one production the whole time; the dot form matched
    // nothing, so the foreign key was dropped with no diagnostic, and this
    // comment recorded that as planned work rather than filing it. An adopter
    // later lost all 34 foreign keys in a real ledger schema to exactly this.
    // The form is now rejected at compile time (`E-SCHEMA-011`).
    // Do not soft-classify a defect as an unbuilt feature.
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string req
    email: string req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }

    posts {
      author_id: integer not null references users(id)
      title:     text req length(<=200)
    }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p6/interleaved.scrml");
    const sfErrs = realErrors(tsResult).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);

    const body = extractSchemaBodyText(tsResult.files[0]);
    expect(body).toContain("users {");
    expect(body).toContain("posts {");

    const parsed = parseSchemaBlock(body);
    expect(parsed.tables.length).toBe(2);
    const postsTable = parsed.tables.find(t => t.name === "posts");
    expect(postsTable).toBeDefined();
    const authorCol = postsTable.columns.find(c => c.name === "author_id");
    expect(authorCol).toBeDefined();
    // The hand-authored references constraint is preserved verbatim by
    // schema-differ.
    expect(authorCol.references).toBeDefined();
    expect(authorCol.references.table).toBe("users");
    expect(authorCol.references.column).toBe("id");
  });
});

// ---------------------------------------------------------------------------
// §7 — pick / omit transforms produce correct field set.
// ---------------------------------------------------------------------------

describe("§7 pick / omit transforms", () => {
  test("pick: ['name'] yields a single-column table", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:   string req
    email:  string req
    secret: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { pick: ["name"] }) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p7/pick.scrml");
    const body = extractSchemaBodyText(tsResult.files[0]);
    const parsed = parseSchemaBlock(body);
    expect(parsed.tables[0].columns.length).toBe(1);
    expect(parsed.tables[0].columns[0].name).toBe("name");
  });

  test("omit: ['secret'] excludes that field", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:   string req
    email:  string req
    secret: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { omit: ["secret"] }) }
  </>
</program>
`;
    const { tsResult, ceFiles } = compileToTS(source, "p7/omit.scrml");
    const body = extractSchemaBodyText(tsResult.files[0]);
    const parsed = parseSchemaBlock(body);
    const colNames = parsed.tables[0].columns.map(c => c.name).sort();
    expect(colNames).toEqual(["email", "name"]);
  });
});

// ---------------------------------------------------------------------------
// §8 (R28-7, S143) — nullable `T | not` / `T?` → NULLABLE column (§41.15.8a).
// The canonical scrml optional/nullable field shape lowers to a nullable SQL
// column: the base T's column type WITHOUT NOT NULL. This is the inverse of
// §14.8.3 (DB introspection produces `T | not` for a nullable column).
// ---------------------------------------------------------------------------

describe("§8 nullable T|not → nullable column (R28-7)", () => {
  test("string | not / integer | not / T? lower to nullable columns (no NOT NULL)", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type Post:struct = {
    title:       string req length(<=80)
    subtitle:    string | not
    publishedAt: integer | not
    tag:         string?
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Post) }
  </>
</program>
`;
    const { tsResult } = compileToTS(source, "p8/nullable.scrml");
    // No schemaFor error fires on the nullable fields.
    const sfErrs = realErrors(tsResult).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);

    const body = extractSchemaBodyText(tsResult.files[0]);
    const parsed = parseSchemaBlock(body);
    const cols = parsed.tables[0].columns;
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));

    // The required field keeps `req` → NOT NULL.
    expect(byName.title.sharedCorePredicates.some(p => p.name === "req")).toBe(true);
    // The nullable fields carry NO `req` predicate (→ no NOT NULL).
    for (const f of ["subtitle", "publishedAt", "tag"]) {
      expect(byName[f]).toBeDefined();
      expect(byName[f].sharedCorePredicates.some(p => p.name === "req")).toBe(false);
    }
    // Base column types preserved.
    expect(byName.subtitle.scrmlType).toBe("text");
    expect(byName.publishedAt.scrmlType).toBe("integer");
    expect(byName.tag.scrmlType).toBe("text");

    // DDL path: the nullable columns SHALL NOT carry NOT NULL.
    const { sql } = diffSchema(parsed, { tables: [] }, { driver: "sqlite" });
    const createStmt = sql.find(s => s.startsWith("CREATE TABLE") && s.includes('"posts"'));
    expect(createStmt).toBeDefined();
    // The `title` line has NOT NULL; the nullable lines do not. We assert per-column.
    const colLine = (name) => {
      const m = createStmt.match(new RegExp(`"${name}"[^,\\n)]*`));
      return m ? m[0] : "";
    };
    expect(colLine("title")).toContain("NOT NULL");
    expect(colLine("subtitle")).not.toContain("NOT NULL");
    expect(colLine("publishedAt")).not.toContain("NOT NULL");
    expect(colLine("tag")).not.toContain("NOT NULL");
  });

  test("nullable enum (Status | not) → nullable oneOf column (no req)", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type Post:struct = {
    status: Status | not
  }
  type Status:enum = { Pending, Active, Archived }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Post) }
  </>
</program>
`;
    const { tsResult } = compileToTS(source, "p8/nullable-enum.scrml");
    const sfErrs = realErrors(tsResult).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
    const body = extractSchemaBodyText(tsResult.files[0]);
    // oneOf present (CHECK constraint), req absent (no NOT NULL).
    expect(body).toMatch(/status: text oneOf\(/);
    expect(body).not.toMatch(/status: text req/);
  });

  test("REGRESSION: non-nullable union (string | integer) still fires E-SCHEMAFOR-NO-SQL-MAPPING", () => {
    const source = `\${
  import { schemaFor } from 'scrml:data'

  type Post:struct = {
    kind: string | integer
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Post) }
  </>
</program>
`;
    const { tsResult } = compileToTS(source, "p8/union-reject.scrml");
    const codes = realErrors(tsResult).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-NO-SQL-MAPPING");
  });
});
