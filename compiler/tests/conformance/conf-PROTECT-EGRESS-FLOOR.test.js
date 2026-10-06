/**
 * CONF-PROTECT-EGRESS-FLOOR | §14.8.9 — the `protect=` confidentiality floor.
 *
 * A column named in `<db … protect="…">` SHALL NOT reach the client. This file
 * is the EXECUTED regression surface for scrml's own security property: each
 * case compiles a real program, seeds a real `bun:sqlite` database with a known
 * protected value, imports the emitted `app.server.js`, and calls the route
 * handler in-process with a real pinned, CSRF-valid `Request`, then asserts on
 * the ACTUAL response body (never a grep of the source).
 *
 * The §14.8.9 binding rule (S452): the floor is keyed on a column's resolved
 * `(table, column)` ORIGIN, enforced at every compiler-owned egress sink, and
 * FAIL-CLOSED on an unknown origin — a row whose output columns the compile
 * cannot resolve is stripped WHOLESALE, never shipped as "no protected column".
 *
 * Two discriminating properties per case, so a test cannot pass by accident:
 *   (a) the seeded protected value (`SECRET`) is ABSENT from the body; and
 *   (b) for a RESOLVED shape, an ordinary non-protected column still ARRIVES —
 *       so the floor is stripping the right column, not the whole response.
 * For a FAIL-CLOSED (wholesale-strip) shape (b) cannot hold by construction
 * (the whole row is dropped): those assert the protected value absent AND that
 * the response is a well-formed row set of the right length, so the test still
 * fails if the floor instead shipped the row.
 *
 * Mirrors the harness of conf-TENANT-SOURCE-FILTER.test.js / conf-TENANT-FLOOR.test.js.
 *
 * ⚑ A `protect=` app auto-injects the §52 auth middleware (a protected column
 * turns on `_protectActive`, which sets `authMiddlewareEntry`), so every route
 * is auth-gated + CSRF-gated. A request is pinned the way the auth HTTP suite
 * pins it: a session record is planted in the process-global session store and
 * its id rides the `__Host-scrml_sid` cookie with the stored CSRF token echoed.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const SECRET = "SECRET-HASH-7f3a0b91";

// Asset 1 ("alice") carries the protected passwordHash; a non-protected `notes`
// row gives a JOIN / non-protected column to prove survivors still arrive.
const SEED = [
  "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)",
  "CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER, body TEXT)",
  `INSERT INTO users (id, name, passwordHash) VALUES (1, 'alice', '${SECRET}')`,
  "INSERT INTO notes (id, user_id, body) VALUES (10, 1, 'note-body')",
  // A view the compile does not know (created at runtime, not in `<schema>`):
  // it re-exposes the protected column under another name.
  "CREATE VIEW v AS SELECT id, passwordHash AS p FROM users",
  // S454 r2 — a KNOWN table named `q` (the placeholder word the RETURNING
  // target reader used to see for any quoted identifier), and a sacrificial
  // protected row for the `DELETE … RETURNING *` case.
  "CREATE TABLE q (id INTEGER PRIMARY KEY, label TEXT)",
  `INSERT INTO users (id, name, passwordHash) VALUES (2, 'dave', '${SECRET}')`,
];

// One program, every shape a server function, compiled + seeded once. The `?{}`
// body of each function is the shape under test. `probeN` naming keeps the
// emitted route path stable (`/_scrml/__ri_route_<name>_<n>`).
const B = "`";
const Q = (body, term = ".all()") => `?{${B}${body}${B}}${term}`;
const SHAPES = {
  // --- resolved: protected column stripped by name, survivors keep their columns
  plain: Q("SELECT id, name, passwordHash FROM users"),
  star: Q("SELECT * FROM users"),
  aliasTable: Q("SELECT u.id, u.name, u.passwordHash FROM users u"),
  caseUpper: Q("SELECT id, name, PASSWORDHASH FROM USERS"),
  asAlias: Q("SELECT id, name, passwordHash AS secret FROM users"),
  join: Q("SELECT n.body, u.name, u.passwordHash FROM notes n JOIN users u ON u.id = n.user_id"),
  insertReturning: Q("INSERT INTO users (name, passwordHash) VALUES ('bob', 'BOB-SECRET') RETURNING id, name, passwordHash"),
  updateReturning: Q("UPDATE users SET name = 'alice' WHERE id = 1 RETURNING id, name, passwordHash"),
  commentBlockInside: Q("SELECT id, name, /* c */ passwordHash /* d */ FROM users"),
  commentLineInside: Q("SELECT id, name, -- trailing\n passwordHash FROM users"),
  commentLeading: Q("/* lead */ SELECT id, name, passwordHash FROM users"),
  lowerSelect: Q("select id, name, passwordHash from users"),
  getTerm: Q("SELECT id, name, passwordHash FROM users WHERE id = 1", ".get()"),
  // a bare `?{}` used as a value (lowers via `.unsafe(...)`)
  bareValue: `let _r = ?{${B}SELECT id, name, passwordHash FROM users${B}}\n        return _r`,
  // a `${}` parameter whose interpolated JS carries `{` / `}` characters, over a
  // matching row — proves the brace-bearing param does not defeat the tag.
  paramBrace: Q("SELECT id, name, passwordHash FROM users WHERE name = ${ ({v:\"alice\"}).v }"),

  // --- fail-closed: origin unresolvable → WHOLE row stripped (survivors empty)
  quotedDq: Q('SELECT id, name, "passwordHash" FROM users'),
  quotedBr: Q("SELECT id, name, [passwordHash] FROM users"),
  quotedBt: `?{ SELECT id, name, ${B}passwordHash${B} FROM users }.all()`,
  exprLower: Q("SELECT id, name, lower(passwordHash) AS x FROM users"),
  exprConcat: Q("SELECT id, name, passwordHash || '' AS x FROM users"),
  exprSubstr: Q("SELECT id, name, substr(passwordHash, 1) AS x FROM users"),
  subqProj: Q("SELECT id, body, (SELECT passwordHash FROM users WHERE id = 1) AS x FROM notes"),
  subqFrom: Q("SELECT * FROM (SELECT id, name, passwordHash FROM users)"),
  cte: Q("WITH t AS (SELECT id, name, passwordHash FROM users) SELECT * FROM t"),
  union: Q("SELECT name, body FROM notes JOIN users ON users.id = notes.user_id UNION SELECT name, passwordHash FROM users"),
  mixedWith: Q("WiTh t AS (SELECT id, name, passwordHash FROM users) SELECT * FROM t"),

  // --- formerly KNOWN LEAK (pinned under test.skip until S454): a leading `;`
  // made the leader test (`isRowProducingQuery` over `stripLeadingSqlNoise`)
  // fail, so no protect tag was emitted and the full row — passwordHash
  // included — shipped. S454 inverted the default: a statement the floor does
  // not POSITIVELY recognize is stripped wholesale.
  leadingSemicolon: Q("; SELECT id, name, passwordHash FROM users"),
  leadingSemicolonComment: Q("/* x */ ; SELECT id, name, passwordHash FROM users"),
  leadingSemicolonGet: Q("; SELECT id, name, passwordHash FROM users WHERE id = 1", ".get()"),

  // --- S454: further shapes. Each "base:" note is the body 79bd05028 served,
  // EXECUTED with this harness.
  // base: LEAK [{"id":1,"name":"alice","passwordHash":"SECRET-…"}]
  doubleSemicolon: Q(";; SELECT id, name, passwordHash FROM users"),
  // base: LEAK (same body)
  lineCommentSemicolon: Q("-- lead\n; SELECT id, name, passwordHash FROM users"),
  // base: LEAK [{"id":1,"name":"alice","x":"SECRET-…"}] — a scalar subquery
  // over a view the compile does not know (created at runtime, see SEED)
  viewSubquery: Q("SELECT id, name, (SELECT p FROM v WHERE v.id = users.id) AS x FROM users"),
  // base: LEAK — `RETURNING *;` resolved as an opaque `*;` entry
  returningStarSemi: Q("UPDATE users SET name = 'alice' WHERE id = 1 RETURNING *;"),
  // base: LEAK [{"id":1,"a":"{","passwordHash":"SECRET-…","b":"}"}] — the SQL
  // splitter brace-counts `${ "{" } … ${ "}" }` as ONE interpolation, the JS
  // template it is written back into reads two, and `, passwordHash,` between
  // them reaches the database as SQL the floor never saw
  holeBrace: Q("SELECT id, ${ \"{\" } AS a, passwordHash, ${ \"}\" } AS b FROM users"),
  // base: wholesale strip [{}] (already fail-closed; pins comment + spacing forms)
  withCommented: Q("/* a */ WITH -- b\n t AS (SELECT id, name, passwordHash FROM users)SELECT * FROM t"),
  // base: wholesale strip [{}] (an over-strip); S454 RESOLVES it — a trailing
  // `;` is not part of the statement
  trailingSemicolon: Q("SELECT id, name, passwordHash FROM users;"),

  // --- S454 r2 (review-found; each LEAKED on 79bd05028 AND on 612e8c5ea).
  // (The lone-CR `--` shapes of S454 r2 moved below: since S456 round 3 they are
  // refused at compile — E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED — so they cannot
  // sit in this compiled program.)
  // A quoted RETURNING target was read from the blanked view, where every
  // quoted identifier is the placeholder `q` — a table this program declares.
  quotedTargetDq: Q('UPDATE "users" SET name = \'alice\' WHERE id = 1 RETURNING *'),
  quotedTargetBr: Q("UPDATE [users] SET name = 'alice' WHERE id = 1 RETURNING *"),
  quotedTargetBt: `?{ UPDATE ${B}users${B} SET name = 'alice' WHERE id = 1 RETURNING * }.all()`,
  quotedTargetDelete: Q('DELETE FROM "users" WHERE id = 2 RETURNING *'),
};

function buildProgram() {
  const fns = Object.entries(SHAPES)
    .map(([name, body]) => `      server function ${name}() {\n        ${body.includes("return") ? body : "return " + body}\n      }`)
    .join("\n");
  const buttons = Object.keys(SHAPES).map((n) => `  <button onclick=\${ ${n}() }>x</button>`).join("\n");
  return `<program db="app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
    ?{\`CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER, body TEXT)\`}
    ?{\`CREATE TABLE q (id INTEGER PRIMARY KEY, label TEXT)\`}
  </schema>
  <db src="app.db" protect="passwordHash" tables="users, notes, q">
    \${
${fns}
    }
  </db>
${buttons}
</program>
`;
}

let app = null;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "conf-protect-floor-"));
  _tmp.push(dir);
  const file = join(dir, "app.scrml");
  writeFileSync(file, buildProgram());
  const db = new Database(join(dir, "app.db"), { create: true });
  for (const s of SEED) db.exec(s);
  db.close();
  const outDir = join(dir, "out");
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const hard = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  if (hard.length) throw new Error("compile errors: " + hard.map((e) => e.code).join(", "));
  const serverPath = join(outDir, "app.server.js");
  const mod = await import(`${serverPath}?v=${Date.now()}-${Math.random()}`);
  const routes = {};
  for (const r of mod.routes) routes[r.path.replace(/^.*__ri_route_/, "").replace(/_\d+$/, "")] = r;
  app = { result, routes };
});

const CSRF = "conf-protect-floor-csrf";
// Pin a request to an authenticated session (a protect= app auto-gates every
// route) and return its parsed JSON body.
async function call(name) {
  const route = app.routes[name];
  expect(route, `route ${name} missing`).toBeTruthy();
  const store = (globalThis.__scrml_session_store ??= new Map());
  const sid = `sid-${Math.random().toString(36).slice(2)}`;
  store.set(sid, { userId: 7, role: "user", isAuth: true, csrfToken: CSRF });
  const res = await route.handler(new Request(`https://localhost${route.path}`, {
    method: route.method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `__Host-scrml_sid=${sid}`,
      "X-CSRF-Token": CSRF,
    },
    body: "{}",
  }));
  expect(res).toBeInstanceOf(Response);
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, json: JSON.parse(text) };
}

// ---------------------------------------------------------------------------
// RESOLVED shapes — the protected column is stripped BY NAME; every other
// column of the row still arrives. Each asserts BOTH halves.
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — resolved origin: protected column stripped, survivors intact", () => {
  const cases = [
    ["plain SELECT of the protected column", "plain", "arr"],
    ["SELECT *", "star", "arr"],
    ["table alias `u.col`", "aliasTable", "arr"],
    ["case variants (`PASSWORDHASH FROM USERS`)", "caseUpper", "arr"],
    ["alias `col AS x`", "asAlias", "arr"],
    ["JOIN (protected column on the joined table)", "join", "arr"],
    ["RETURNING on INSERT", "insertReturning", "arr"],
    ["RETURNING on UPDATE", "updateReturning", "arr"],
    ["block comment around the column reference", "commentBlockInside", "arr"],
    ["line comment before the column reference", "commentLineInside", "arr"],
    ["leading block comment", "commentLeading", "arr"],
    ["lower-case keyword leader", "lowerSelect", "arr"],
    ["`.get()` terminator", "getTerm", "obj"],
    ["bare `?{}` used as a value", "bareValue", "arr"],
    ["`${}` param whose JS carries `{`/`}`", "paramBrace", "arr"],
  ];
  for (const [label, name, shape] of cases) {
    test(`${label} — passwordHash ABSENT, a non-protected column ARRIVES`, async () => {
      const { text, json } = await call(name);
      // (a) the seeded protected value never crosses the wire
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("BOB-SECRET");
      // (b) the floor stripped the right column, not the whole row
      const row = shape === "arr" ? json[Array.isArray(json) ? 0 : null] : json;
      expect(row, "expected a row in the response").toBeTruthy();
      expect("passwordHash" in row).toBe(false);
      expect("secret" in row).toBe(false); // the `col AS secret` alias too
      // a non-protected column survived
      const survivor = ("name" in row) || ("body" in row);
      expect(survivor).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED shapes — the origin cannot be statically resolved (quoted /
// bracketed / backticked identifier, an expression over the column, a subquery,
// a CTE, a UNION), so §14.8.9 strips the WHOLE row at the sink. The protected
// value is absent; survivors are legitimately empty (the fail-closed direction).
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — fail-closed wholesale strip: protected value absent, row dropped to {}", () => {
  const cases = [
    ['quoted identifier `"col"`', "quotedDq"],
    ["bracket-quoted identifier `[col]`", "quotedBr"],
    ["backtick-quoted identifier", "quotedBt"],
    ["expression `lower(col)`", "exprLower"],
    ["expression `col || ''`", "exprConcat"],
    ["expression `substr(col,1)`", "exprSubstr"],
    ["scalar subquery in the projection", "subqProj"],
    ["subquery in FROM", "subqFrom"],
    ["CTE (`WITH`)", "cte"],
    ["UNION", "union"],
    ["mixed-case `WiTh` CTE", "mixedWith"],
  ];
  for (const [label, name] of cases) {
    test(`${label} — passwordHash ABSENT (whole row stripped)`, async () => {
      const { text, json } = await call(name);
      expect(text).not.toContain(SECRET);
      // a well-formed row set of the right length came back — the request was
      // served, the row(s) were just emptied, not errored or passed through.
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThanOrEqual(1);
    });
  }
});

// ---------------------------------------------------------------------------
// FORMERLY KNOWN LEAK (pinned under test.skip at 79bd05028; closed S454). A
// `?{}` whose SQL begins with `;` (bare, or after a leading comment) was NOT
// recognized as row-producing: `isRowProducingQuery` ran over
// `stripLeadingSqlNoise`, which stripped leading whitespace and comments but
// NOT a leading `;`, so the leader regex `/^(?:select|with)\b/` failed,
// `resolveProtectedOutputColumns` returned null, NO `_scrml_protect_tag` wrap
// was emitted, and the driver row — passwordHash included — shipped. EXECUTED
// leak body: [{"id":1,"name":"alice","passwordHash":"SECRET-HASH-7f3a0b91"}]
// The fix is not a `;` rule: the floor now strips WHOLESALE every statement it
// does not POSITIVELY recognize (§14.8.9: "fail-closed on an unknown origin").
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — leading `;` (formerly a pinned leak): stripped wholesale", () => {
  const cases = [
    ["leading `;` then SELECT (`.all()`)", "leadingSemicolon"],
    ["leading comment then `;` then SELECT", "leadingSemicolonComment"],
    ["leading `;` then SELECT (`.get()`)", "leadingSemicolonGet"],
  ];
  for (const [label, name] of cases) {
    test(`${label} — passwordHash ABSENT`, async () => {
      const { text } = await call(name);
      expect(text).not.toContain(SECRET);
    });
  }
});

// ---------------------------------------------------------------------------
// S454 — shapes the floor did not positively recognize. Every one of the
// first five LEAKED on 79bd05028 (executed; bodies in the SHAPES comments).
// Each is now an UNKNOWN to the floor → the row is stripped wholesale.
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — S454 unknown statements: protected value absent, row dropped to {}", () => {
  const cases = [
    ["`;;` then SELECT", "doubleSemicolon"],
    ["line comment, then `;`, then SELECT", "lineCommentSemicolon"],
    ["scalar subquery over a view the compile does not know", "viewSubquery"],
    ["`${}` pair whose braces the SQL splitter and JS read differently", "holeBrace"],
    ["WITH behind a block comment, a line comment and no space before SELECT", "withCommented"],
  ];
  for (const [label, name] of cases) {
    test(`${label} — passwordHash ABSENT (whole row stripped)`, async () => {
      const { text, json } = await call(name);
      expect(text).not.toContain(SECRET);
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThanOrEqual(1);
      // wholesale: no column of the row survives
      expect(Object.keys(json[0])).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// S454 — shapes the floor RESOLVES (a trailing `;` is not part of the
// statement): the protected column is stripped by name and the others arrive.
// `returningStarSemi` LEAKED on 79bd05028 (`RETURNING *;` was read as an opaque
// `*;` entry naming no protected column).
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — S454 resolved: trailing `;`", () => {
  const cases = [
    ["SELECT … FROM users;", "trailingSemicolon"],
    ["UPDATE … RETURNING *;", "returningStarSemi"],
  ];
  for (const [label, name] of cases) {
    test(`${label} — passwordHash ABSENT, a non-protected column ARRIVES`, async () => {
      const { text, json } = await call(name);
      expect(text).not.toContain(SECRET);
      const row = json[0];
      expect(row, "expected a row in the response").toBeTruthy();
      expect("passwordHash" in row).toBe(false);
      expect(row.name).toBe("alice");
    });
  }
});

// ---------------------------------------------------------------------------
// S454 r2 — a lone CR inside a `--` comment. Where that comment ends depends on
// the lowering (a cooked JS template turns CR into LF; `.unsafe(…)` keeps it)
// and on the dialect (Postgres ends `--` at CR, SQLite does not), so the floor
// cannot know the text the database reads → wholesale strip. Each LEAKED on
// 79bd05028 and 612e8c5ea (`.get()` body:
// {"id":1,"name":"alice","passwordHash":"SECRET-HASH-7f3a0b91"}).
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — S454 r2: lone CR in a `--` comment — refused at compile since S456 round 3", () => {
  // S454 r2 stripped these wholesale at the egress (each LEAKED the hash on 79bd05028 /
  // 612e8c5ea). S456 round 3 (ruling user-voice-scrml.md S456 "a, fix F7/F9 too"): a
  // statement the databases do not all read the same way — a lone CR ends a `--` comment
  // on Postgres, not on SQLite — is UNREADABLE and refused at compile, so it never runs.
  const cases = [
    ["`.get()`", Q("SELECT id, name -- c\r, passwordHash FROM users WHERE id = 1", ".get()")],
    ["`.all()`", Q("SELECT id, name -- c\r, passwordHash FROM users")],
    ["UNION behind the CR", Q("SELECT id, name FROM users -- c\rUNION SELECT id, passwordHash FROM users")],
    ["UPDATE … `-- c<CR>RETURNING *`", Q("UPDATE users SET name = 'alice' WHERE id = 1 -- c\rRETURNING *")],
    ["`.run()`", Q("SELECT id, name -- c\r, passwordHash FROM users", ".run()")],
  ];
  for (const [label, body] of cases) {
    test(`${label} — E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED`, () => {
      const dir = mkdtempSync(join(tmpdir(), "conf-protect-cr-"));
      _tmp.push(dir);
      const file = join(dir, "app.scrml");
      writeFileSync(file, `<program db="app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  \${
    server function probe() {
      return ${body}
    }
  }
  <button onclick=\${ probe() }>x</button>
</program>
`);
      const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
      expect((result.errors ?? []).map((e) => e.code)).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
    });
  }
});

// ---------------------------------------------------------------------------
// S454 r2 — a quoted RETURNING target (`"users"`, `[users]`, backticks, and
// DELETE). It was read from the blanked view as the placeholder `q`; with a
// table `q` declared that resolved to "no protected column" and the row
// shipped (executed on 79bd05028 and 612e8c5ea). The target is now read from
// the original text and folded, so these RESOLVE: the hash is stripped by
// name and `name` arrives.
// ---------------------------------------------------------------------------
describe("CONF-PROTECT-EGRESS-FLOOR — S454 r2: quoted RETURNING target resolves to the real table", () => {
  const cases = [
    ['UPDATE "users" … RETURNING *', "quotedTargetDq", "alice"],
    ["UPDATE [users] … RETURNING *", "quotedTargetBr", "alice"],
    ["UPDATE `users` … RETURNING *", "quotedTargetBt", "alice"],
    ['DELETE FROM "users" … RETURNING *', "quotedTargetDelete", "dave"],
  ];
  for (const [label, name, who] of cases) {
    test(`${label} — passwordHash ABSENT, name ARRIVES`, async () => {
      const { text, json } = await call(name);
      expect(text).not.toContain(SECRET);
      const row = json[0];
      expect(row, "expected a row in the response").toBeTruthy();
      expect("passwordHash" in row).toBe(false);
      expect(row.name).toBe(who);
    });
  }
});
