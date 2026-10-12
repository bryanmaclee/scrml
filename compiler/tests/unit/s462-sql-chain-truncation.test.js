/**
 * S462 P0 (SECURITY) — the chain after a `?{}` query: parse + lowering units.
 * Executed coverage: compiler/tests/integration/s462-p0-sql-chain-truncation.test.js.
 *
 * Pre-fix (base 1c1e9eee5) the statement-position parsers (`return`, `const` /
 * `let` / state-decl initializers, `lift`, `yield`, a bare statement — in a
 * function body and at the top of a logic block) took every `.name` after the
 * block as a SQL "chained call"; the lowering honoured only the first, so
 * `?{…}.get().name` evaluated to the whole row. Calls with nested parentheses
 * (`.map((u) => …)`) broke the parse, and `?.` / `[0]` / an operator after the
 * chain were left as a stray statement.
 *
 *   §1 the structured `sqlNode` path holds ONLY SQL methods; a tail routes the
 *      site through the expression path (no orphan sibling statement)
 *   §2 every chained form lowers with its tail applied to the query's value, in
 *      every statement position
 *   §3 the whole-operand forms keep their structured shape (no over-routing)
 *   §4 a query in OPERAND position (`a ?? ?{…}`, `c ? ?{…} : d`, `!?{…}`) stays in
 *      its statement
 *   §5 the text-path lowering (`rewriteSqlRefs`) parenthesizes a site that has
 *      neighbours and takes only SQL methods as its chain
 */
import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { rewriteSqlRefs } from "../../src/codegen/rewrite.ts";

const BT = "`";
const SQL_METHODS = new Set(["all", "get", "first", "run", "prepare", "nobatch", "acrossTenants"]);

const Q1 = `?{${BT}SELECT name, pw FROM users WHERE id = \${id}${BT}}`;
const QA = `?{${BT}SELECT name, pw FROM users${BT}}`;
const LOWER_GET = "((await _scrml_sql`SELECT name, pw FROM users WHERE id = ${id}`)[0] ?? null)";
const LOWER_ALL = "(await _scrml_sql`SELECT name, pw FROM users`)";

function program(fnBody, extra = "") {
  return `<program auth="none" db="./app.db">
  <schema>
    ?{${BT}CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)${BT}}
  </schema>
  <db src="./app.db" tables="users">
    \${
      function f(id) {
        ${fnBody}
      }
${extra}
    }
  </db>
  <out> = ""
  <button onclick={ @out = f(1) !{ .Transport(_) :> { return } } }>a</button>
</program>
`;
}

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "s462-sql-chain-unit-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  const fatal = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  return { fatal, serverJs: out?.serverJs ?? "", clientJs: out?.clientJs ?? "" };
}

/** The emitted body of server fn `f` — the route handler's async IIFE. */
function fBody(serverJs) {
  const at = serverJs.indexOf("const _scrml_result = await (async () => {");
  expect(at).toBeGreaterThan(-1);
  return serverJs.slice(at, serverJs.indexOf("})();", at));
}

function ast(src) {
  return buildAST(splitBlocks("app.scrml", src)).ast;
}

function findFn(root, name) {
  let hit = null;
  const walk = (n) => {
    if (!n || typeof n !== "object" || hit) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === "function-decl" && n.name === name) { hit = n; return; }
    for (const k of Object.keys(n)) if (k !== "span" && typeof n[k] === "object") walk(n[k]);
  };
  walk(root.nodes);
  return hit;
}

/** Every structured `sql` node under `n`. */
function sqlNodes(n, acc = []) {
  if (!n || typeof n !== "object") return acc;
  if (Array.isArray(n)) { n.forEach((x) => sqlNodes(x, acc)); return acc; }
  if (n.kind === "sql" && Array.isArray(n.chainedCalls)) acc.push(n);
  for (const k of Object.keys(n)) if (k !== "span" && typeof n[k] === "object") sqlNodes(n[k], acc);
  return acc;
}

// The statement positions a `?{…}` can lead, each with a slot for the operand.
const POSITIONS = {
  return: (e) => `return ${e}`,
  const: (e) => `const v = ${e}\n        return v`,
  let: (e) => `let v = ${e}\n        return v`,
};

// [label, source tail, emitted operand]
const FORMS = [
  [".get().field", `${Q1}.get().name`, `${LOWER_GET}.name`],
  [".get()?.field", `${Q1}.get()?.name`, `${LOWER_GET}?.name`],
  [".get().field.sub", `${Q1}.get().name.length`, `${LOWER_GET}.name.length`],
  [".all().length", `${QA}.all().length`, `${LOWER_ALL}.length`],
  [".all().map(…)", `${QA}.all().map(u => u.name)`, `${LOWER_ALL}.map((u) => u.name)`],
  [".all().map((u) => …)", `${QA}.all().map((u) => u.name)`, `${LOWER_ALL}.map((u) => u.name)`],
  ["a method call after .all()", `${QA}.all().reverse()`, `${LOWER_ALL}.reverse()`],
  ["[0] after .all()", `${QA}.all()[0]`, `${LOWER_ALL}[0]`],
  ["[0].field after .all()", `${QA}.all()[0].name`, `${LOWER_ALL}[0].name`],
  [".run().changes", `?{${BT}UPDATE users SET name = 'x' WHERE id = \${id}${BT}}.run().changes`,
    "(await _scrml_sql`UPDATE users SET name = 'x' WHERE id = ${id}`).changes"],
  [".get() + 1", `${Q1}.get().id + 1`, `${LOWER_GET}.id + 1`],
  [".nobatch().get().field", `${Q1}.nobatch().get().name`, `${LOWER_GET}.name`],
];

describe("§1 the structured path holds only SQL methods; a tail never leaves an orphan", () => {
  for (const [label, tail] of FORMS) {
    for (const [pos, wrap] of Object.entries(POSITIONS)) {
      test(`${pos} ${label}`, () => {
        const fn = findFn(ast(program(wrap(tail))), "f");
        expect(fn).toBeTruthy();
        for (const s of sqlNodes(fn.body)) {
          for (const c of s.chainedCalls) expect(SQL_METHODS.has(c.method)).toBe(true);
        }
        // `return …` is one statement; `const|let v = …` + `return v` are two.
        expect(fn.body.length).toBe(pos === "return" ? 1 : 2);
      });
    }
  }
});

describe("§2 every chained form lowers with its tail applied to the query's value", () => {
  for (const [label, tail, lowered] of FORMS) {
    test(`return ${label}`, () => {
      const r = compile(program(POSITIONS.return(tail)));
      expect(r.fatal.map((e) => e.code)).toEqual([]);
      expect(fBody(r.serverJs)).toContain(`return ${lowered};`);
    });
    test(`const ${label}`, () => {
      const r = compile(program(POSITIONS.const(tail)));
      expect(r.fatal.map((e) => e.code)).toEqual([]);
      expect(fBody(r.serverJs)).toContain(`const v = ${lowered};`);
    });
  }

  test("a bare statement `?{…}.all().forEach(…)` keeps its call", () => {
    const r = compile(program(`${QA}.all().forEach(u => console.log(u.name))\n        return 1`));
    expect(r.fatal.map((e) => e.code)).toEqual([]);
    expect(fBody(r.serverJs)).toContain(`${LOWER_ALL}.forEach((u) => console.log(u.name));`);
  });

  test("`yield ?{…}.get().name` in a generator yields the field", () => {
    const src = program("return 1", `      server function* g(id) {
        yield ${Q1}.get().name
      }`);
    const fn = findFn(ast(src), "g");
    expect(fn.body.length).toBe(1);
    expect(fn.body[0].sqlNode).toBeFalsy();
    expect(sqlNodes(fn.body).every((s) => s.chainedCalls.every((c) => SQL_METHODS.has(c.method)))).toBe(true);
  });

  test("`lift ?{…}.all().length` does not take the structured SQL lift (tail kept)", () => {
    const src = program("return 1", `      function h() {
        lift ${QA}.all().length
      }`);
    const fn = findFn(ast(src), "h");
    expect(fn.body.length).toBe(1);
    expect(fn.body[0].kind).toBe("lift-expr");
    expect(fn.body[0].expr?.kind).not.toBe("sql");
  });

  test("the query never reaches the client bundle", () => {
    const r = compile(program(POSITIONS.return(`${Q1}.get().name`)));
    expect(r.clientJs).not.toContain("SELECT name, pw");
    expect(r.clientJs).not.toContain("_scrml_sql");
  });

  test("the emitted server module parses", () => {
    for (const [, tail] of FORMS) {
      const r = compile(program(POSITIONS.return(tail)));
      expect(() => acorn.parse(r.serverJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    }
  });
});

describe("§3 the whole-operand forms keep their structured shape", () => {
  for (const [label, src, method] of [
    ["return .get()", `return ${Q1}.get()`, "get"],
    ["return .all()", `return ${QA}.all()`, "all"],
    ["return .nobatch().get()", `return ${Q1}.nobatch().get()`, "get"],
    ["return .get().nobatch()", `return ${Q1}.get().nobatch()`, "get"],
    ["const .get() ⏎ next statement", `const v = ${Q1}.get()\n        return v`, "get"],
    ["const .get() !{ handler }", `const v = ${Q1}.get() !{ _ :> not }\n        return v`, "get"],
  ]) {
    test(label, () => {
      const fn = findFn(ast(program(src)), "f");
      const s = sqlNodes(fn.body);
      expect(s.length).toBe(1);
      expect(s[0].chainedCalls.map((c) => c.method)).toEqual([method]);
    });
  }

  test("a next-line statement after the chain is NOT read as a tail", () => {
    const fn = findFn(ast(program(`const v = ${Q1}.get()\n        [1, 2].length\n        return v`)), "f");
    expect(sqlNodes(fn.body)[0].chainedCalls.map((c) => c.method)).toEqual(["get"]);
    expect(fn.body.length).toBe(3);
  });

  test("`.get()` alone still lowers exactly as before", () => {
    const r = compile(program(`return ${Q1}.get()`));
    expect(fBody(r.serverJs)).toContain("return (await _scrml_sql`SELECT name, pw FROM users WHERE id = ${id}`)[0] ?? null;");
  });
});

describe("§4 a query in operand position stays in its statement", () => {
  for (const [label, src, emitted] of [
    ["after ??", `return d ?? ${Q1}.get().name`, `return d ?? ${LOWER_GET}.name;`],
    ["ternary consequent", `return c ? ${Q1}.get().name : "anon"`, `return c ? ${LOWER_GET}.name : "anon";`],
    ["ternary alternate", `return c ? "anon" : ${Q1}.get().name`, `return c ? "anon" : ${LOWER_GET}.name;`],
    ["after +", `const v = 1 + ${Q1}.get().id\n        return v`, `const v = 1 + ${LOWER_GET}.id;`],
    ["after !", `return !${Q1}.get()`, `return !((await _scrml_sql\`SELECT name, pw FROM users WHERE id = \${id}\`)[0] ?? null);`],
    ["after ||", `return d || ${Q1}.get().name`, `return d || ${LOWER_GET}.name;`],
  ]) {
    test(label, () => {
      const r = compile(program(src).replace("function f(id)", "function f(id, d, c)"));
      expect(r.fatal.map((e) => e.code)).toEqual([]);
      expect(fBody(r.serverJs)).toContain(emitted);
    });
  }

  test("`const r = ?{…}.get()?` (a `!` function) is server-placed; the propagation test is guarded", () => {
    const src = program("return 1", `      function k(id)! -> SqlError {
        const r = ${Q1}.get()?
        return r
      }`).replace("@out = f(1)", "@out = k(1) !{ _ :> { return } } + f(1)");
    const r = compile(src);
    expect(r.fatal.map((e) => e.code)).toEqual([]);
    expect(r.clientJs).not.toContain("sql-ref unresolved");
    expect(r.serverJs).toContain(`= ${LOWER_GET};`);
    expect(r.serverJs).toMatch(/if \((_scrml_\w+) && \1\.__scrml_error\) return \1;/);
  });

  test("`f()?` ⏎ `?{…}` on the next line keeps the old statement boundary", () => {
    const src = program("return 1", `      function k()! -> SqlError {
        const a = g()?
        ?{${BT}DELETE FROM users${BT}}.run()
        return a
      }
      function g()! -> SqlError { return 1 }`);
    const fn = findFn(ast(src), "k");
    expect(fn.body.length).toBe(3);
  });
});

describe("§5 the text-path lowering (rewriteSqlRefs)", () => {
  const T = "?{`SELECT v FROM notes`}";
  const G = "(await _scrml_sql`SELECT v FROM notes`)[0] ?? null";
  const A = "await _scrml_sql`SELECT v FROM notes`";
  test("a whole-text site keeps its bare form", () => {
    expect(rewriteSqlRefs(`${T}.get()`, "_scrml_sql")).toBe(G);
    expect(rewriteSqlRefs(`${T}.all()`, "_scrml_sql")).toBe(A);
  });
  test("`.get().v` applies `.v` to the ROW (was `?? null.v` — the whole row)", () => {
    expect(rewriteSqlRefs(`${T}.get().v`, "_scrml_sql")).toBe(`(${G}).v`);
  });
  test("`.all().length` is the array's length (was `await q.length`)", () => {
    expect(rewriteSqlRefs(`${T}.all().length`, "_scrml_sql")).toBe(`(${A}).length`);
  });
  test("a zero-argument non-SQL method is NOT a terminator (`.all().reverse()`)", () => {
    expect(rewriteSqlRefs(`${T}.all().reverse()`, "_scrml_sql")).toBe(`(${A}).reverse()`);
  });
  test("`[0]` and `?.` after the chain", () => {
    expect(rewriteSqlRefs(`${T}.all()[0]`, "_scrml_sql")).toBe(`(${A})[0]`);
    expect(rewriteSqlRefs(`${T}.get()?.v`, "_scrml_sql")).toBe(`(${G})?.v`);
  });
  test("an operand position is parenthesized (`x || q` with `??` inside)", () => {
    const out = rewriteSqlRefs(`x || ${T}.get()`, "_scrml_sql");
    expect(out).toBe(`x || (${G})`);
    expect(() => acorn.parse(`async function f(x){ return ${out} }`, { ecmaVersion: 2022 })).not.toThrow();
  });
});
