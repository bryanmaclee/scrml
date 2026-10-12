/**
 * S465 fix round 5 (S239 re-review of 55cdda9d8).
 *
 *   F2a (MED) a destructured lambda parameter (`({ a }) => a + 1`, `([a, b]) => …`,
 *       `({ a = 7 }) => a`, `(...[a, b]) => …`, `({ a } = d) => a`) was emitted from the
 *       expression tree as the placeholder `__destructured__` — a ReferenceError at run
 *       time. Pre-existing for expression-bodied lambdas in server code; r4 extended it to
 *       every lambda inside a block-bodied server function value (lowered from the tree
 *       since r4). The parser now structures the pattern (LambdaParam.pattern) and the
 *       emitter writes it back, defaults lowered from their trees.
 *   F2b (MED) a block-bodied server function value whose body holds a call was refused
 *       when its lowered body CONTAINED THE WORD `await` (`return "await " + String(x)`):
 *       the sync-callback test is now syntactic (the body must parse as a non-async
 *       function). `switch` / `try` / `throw` / `for … in` in such a body (SPEC §7.2.1 —
 *       not scrml in any position) now report the front-end's own code instead of the
 *       generic E-CODEGEN-INVALID-LOGIC.
 *   F1 (HIGH) the server text guard's scanner (`firstCallInText`) read the callee `of`
 *       as the keyword and `i++ / f(x) / 1` as a regex literal, so a ParseError hatch
 *       holding a call slipped to the text rewriter un-awaited (wrong password →
 *       WELCOME). The guard is now purely lexical (`lexicalCallInText`) — fail closed.
 *   (found measuring F1) a `?{` inside a quoted string was replaced by the SQL
 *       placeholder in the expression parser (`"?{…}"` → `"__scrml_sql_placeholder__"`).
 *   F3 (LOW) `.then` / `.catch` / `.finally` read off a call the server awaits threw at
 *       run time (500); SPEC §13.2 makes it E-ASYNC-CALL-PROMISE-METHOD at compile time.
 *
 * Executed: each shape in a server function × {wrong password → "REJECTED", right →
 * "WELCOME:<value>"} against bun:sqlite, the guard an imported async helper `check`.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

const LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
  export function of(p, h) { return verifyPassword(p, h) }
}
`;

const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";
const TAIL = `if (!check(pass, row.pw)) { return "REJECTED" }
    return "WELCOME:" + v`;

// name -> [body, expected value after WELCOME:]
const RUN_SHAPES = {
  // F2a — destructured lambda parameters.
  topExprObj: [`const v = [{ a: 1 }].map(({ a }) => a + 1)[0]`, "2"],
  blockInnerObj: [`const g = (rows) => { return String(rows.map(({ a }) => a + 1)[0]) }
    const v = g([{ a: 1 }])`, "2"],
  blockInnerArr: [`const g = (rows) => { return String(rows.map(([a, b]) => a + b)[0]) }
    const v = g([[4, 5]])`, "9"],
  blockInnerDefault: [`const g = (rows) => { return String(rows.map(({ a = 7 }) => a)[0]) }
    const v = g([{}])`, "7"],
  blockInnerRest: [`const g = (rows) => { return String(rows.map(({ a, ...r }) => a + r.b)[0]) }
    const v = g([{ a: 1, b: 2 }])`, "3"],
  fnDeclInnerObj: [`function g(rows) { return String(rows.map(({ a }) => a + 1)[0]) }
    const v = g([{ a: 1 }])`, "2"],
  nestedPattern: [`const v = [{ a: { b: [1, 2] } }].map(({ a: { b: [x, y] } }) => x + y)[0]`, "3"],
  stringKey: [`const v = [{ "a-b": 5 }].map(({ "a-b": z }) => z)[0]`, "5"],
  restParamPattern: [`const v = ((...[a, b]) => a + b)(1, 2)`, "3"],
  paramDefaultPattern: [`const v = (({ a } = { a: 8 }) => a)()`, "8"],
  // F2b — the word `await` in a string of a block-bodied server function value.
  awaitInStringArrow: [`const g = (x) => { return "await " + String(x) }
    const v = g(1)`, "await 1"],
  awaitInStringMapCb: [`const v = [1].map((x) => { return "await " + String(x) })[0]`, "await 1"],
  // F2a × F2b — a destructured parameter of the block-bodied value itself.
  blockValueDestr: [`const g = ({ a }) => { return String(a + 1) }
    const v = g({ a: 1 })`, "2"],
  // r5 (found while measuring F1): a `?{` inside a quoted string is text. The expression
  // parser's SQL-block mask replaced the string's content with `__scrml_sql_placeholder__`
  // (silently, on origin/main too).
  stringHoldsSqlBlock: [`const v = "?{\`SELECT 1\`}"`, "?{`SELECT 1`}"],
  stringHoldsSqlBlockSingle: [`const v = '?{ x }' + "!"`, "?{ x }!"],
  templateTextHoldsSqlBlock: [`const v = \`?{ text }\``, "?{ text }"],
  // …while a query in a template SUBSTITUTION is still a query, quotes in the text or not.
  templateApostropheThenQuery: [`const v = \`it's \${?{\`SELECT name FROM users WHERE name = \${name}\`}.get().name}\``, "it's bob"],
  templateQuoteAroundQuery: [`const v = \`say "x \${?{\`SELECT name FROM users WHERE name = \${name}\`}.get().name} y"\``, "say \"x bob y\""],
  // F1 — the variant hatch with no call still lowers from text.
  variantHatchNoCall: [`const r = .Found(name: "c")
    const v = "ok"`, "ok"],
};

// name -> [body, expected diagnostic code]
const REFUSE_SHAPES = {
  // F1 — a ParseError hatch that holds a call (the `.Found(name: …)` element keeps the
  // array a hatch); each was WELCOME for a wrong password on 55cdda9d8.
  hatchCalleeOf: [`const r = [of(pass, row.pw), .Found(name: "c")]
    if (!r[0]) { return "REJECTED" }
    return "WELCOME"`, "E-CODEGEN-INVALID-LOGIC"],
  hatchCallAfterPostfix: [`let i = 0
    const r = [i++ / 1 + (check(pass, row.pw) ? 1 : 0) / 1, .Found(name: "c")]
    if (r[0] == 0) { return "REJECTED" }
    return "WELCOME"`, "E-CODEGEN-INVALID-LOGIC"],
  // F2b — §7.2.1 constructs in a block-bodied server function value: the front-end code.
  valueSwitch: [`const g = (x) => { switch (x) { case 2: return String("two")
      default: return "other" } }
    const v = g(2)
    ${TAIL}`, "E-SWITCH-FORBIDDEN"],
  valueTry: [`const g = (x) => { try { return String(x + 1) } catch (e) { return "0" } }
    const v = g(2)
    ${TAIL}`, "E-TRY-NOT-IN-SCRML"],
  valueThrow: [`const g = (x) => { if (x > 5) { throw new Error("big") }
      return String(x) }
    const v = g(2)
    ${TAIL}`, "E-THROW-NOT-IN-SCRML"],
  valueForIn: [`const g = (o) => { let s = ""
      for (const k in o) { s = s + String(k) }
      return s }
    const v = g({ p: 1 })
    ${TAIL}`, "E-CTRL-011"],
  // F2b — a sync callback whose body needs an await is still refused.
  valueNeedsAwait: [`const g = (x) => { return check(x, row.pw) }
    const v = g(pass)
    ${TAIL}`, "E-ASYNC-STDLIB-IN-SYNC-CALLBACK"],
  // F3 — a Promise method read off an awaited call.
  thenImported: [`let v = "init"
    check(pass, row.pw).then((ok) => { v = "x" })
    return "DONE:" + v`, "E-ASYNC-CALL-PROMISE-METHOD"],
  thenStdlib: [`verifyPassword(pass, row.pw).then((ok) => ok)
    return "DONE"`, "E-ASYNC-CALL-PROMISE-METHOD"],
  catchImported: [`check(pass, row.pw).catch((e) => e)
    return "DONE"`, "E-ASYNC-CALL-PROMISE-METHOD"],
  finallyValue: [`const p = check(pass, row.pw).finally(() => 1)
    if (!p) { return "REJECTED" }
    return "WELCOME"`, "E-ASYNC-CALL-PROMISE-METHOD"],
};

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function compileServerFn(tag, body) {
  const dir = mkdtempSync(join(tmpdir(), `s465-r5-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), LIB);
  const src = `<program db="./app.db">
\${
  import { check, of } from "./lib.scrml"
  import { verifyPassword } from "scrml:auth"
  type R:enum = { Found(name:string), Missing }
  function f(name: string, pass: string) {
    ${ROW}
    ${body}
  }
}
<out> = ""
<button onclick={ @out = f("bob", "x") }>f</button>
<p>\${@out}</p>
</program>
`;
  writeFileSync(join(dir, "app.scrml"), src);
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [await hashPassword("right-password")]);
  db.close();
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error")
    .map((e) => `${e.code}: ${String(e.message).slice(0, 200)}`);
  const serverJsPath = join(outDir, "app.server.js");
  if (errors.length > 0 || !existsSync(serverJsPath)) return { errors };
  const serverJs = readFileSync(serverJsPath, "utf8");
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => /__ri_route_f_\d+$/.test(r.path));
  return { errors, serverJs, mod, path: route?.path };
}

async function callF(unit, pass) {
  expect(unit.errors).toEqual([]);
  expect(unit.path).toBeDefined();
  const res = await unit.mod.fetch(new Request(`http://localhost${unit.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ name: "bob", pass }),
  }));
  return { status: res.status, body: await res.text() };
}

const units = new Map();
beforeAll(async () => {
  for (const [shape, [body]] of Object.entries(RUN_SHAPES)) {
    units.set(shape, await compileServerFn(shape, `${body}\n    ${TAIL}`));
  }
}, EXECUTED_DB_TIMEOUT_MS * 8);

describe("S465 r5 — server shapes that must compile and run (executed)", () => {
  for (const [shape, [, value]] of Object.entries(RUN_SHAPES)) {
    test(`${shape}: a WRONG password is rejected`, async () => {
      const r = await callF(units.get(shape), "wrong-password");
      expect(r).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
    }, EXECUTED_DB_TIMEOUT_MS);
    test(`${shape}: the right password is accepted with the value`, async () => {
      const r = await callF(units.get(shape), "right-password");
      expect(r).toEqual({ status: 200, body: JSON.stringify("WELCOME:" + value) });
    }, EXECUTED_DB_TIMEOUT_MS);
  }

  test("no server bundle carries the `__destructured__` placeholder", () => {
    for (const [shape, unit] of units) {
      expect([shape, unit.serverJs ?? ""].join(":").includes("__destructured__")).toBe(false);
    }
  });
});

describe("S465 r5 — server shapes that must be compile errors (with their code)", () => {
  for (const [shape, [body, code]] of Object.entries(REFUSE_SHAPES)) {
    test(`${shape}: ${code}`, async () => {
      const u = await compileServerFn(shape, body);
      expect(u.errors.map((e) => e.split(":")[0])).toContain(code);
      expect(u.serverJs).toBeUndefined();
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

describe("S465 r5 — destructured lambda parameters the emitter cannot write back are refused", () => {
  test("a computed key in a parameter pattern is a compile error, not a ReferenceError", async () => {
    const u = await compileServerFn("computed", `const k = "a"
    const v = [{ a: 4 }].map(({ [k]: z }) => z)[0]
    ${TAIL}`);
    expect(u.errors.some((e) => e.startsWith("E-CODEGEN-INVALID-LOGIC") && e.includes("destructured function parameter"))).toBe(true);
  }, EXECUTED_DB_TIMEOUT_MS);
});
