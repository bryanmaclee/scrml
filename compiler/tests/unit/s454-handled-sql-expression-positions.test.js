/**
 * S454 — a HANDLED `?{}` query in every expression position (SPEC §19.8.3 /
 * §19.8.4, S451 R11; §19.4.3 "Handling in a value position"; §18.3).
 *
 * "A `?{}` query is a failable expression everywhere" (§19.8.3); handled with a
 * `!{}` or a `match`, the arm's value replaces the result on failure, and "a
 * query that runs and matches nothing succeeds: `.get()` on zero rows returns
 * `not`, and `.all()` on zero rows returns `[]`".
 *
 * Defects closed (reproduced on 3261a4423):
 *   D1  `const row = ?{…}.get() !{ _ :> not }` in a server fn → E-CODEGEN-INVALID-LOGIC
 *       (`let _scrml__scrml_result_N = ;`) — also `.all()`, `let`, `x = …`, parenthesized.
 *   D2  `const r = match ?{…}.get() { ::Ok(r) :> r  _ :> not }` → exit 0, the function
 *       SILENTLY client-placed, the query emitted as the null "sql-ref unresolved" placeholder.
 *   D3  `if (?{…}.get() !{ _ :> not }) { … }` → raw `!{` in the emitted JS.
 * Found on the same lowering site and fixed with it (any failable, not only SQL):
 *   `return f() !{ … }` dropped the return; `v = f() !{ … }` on a declared `v`
 *   redeclared it; `(f() !{ … })` / `if (f() !{ … })` emitted a raw `!{`.
 *
 * Coverage:
 *   §1  expression parser — the `?{}` / `!{}` placeholders and their inverse
 *   §2  compile — every D1/D2/D3 shape compiles; the function is server-placed;
 *       no `_scrml_sql` in client.js; no unresolved sql-ref
 *   §3  RUNTIME — each shape run against a real bun:sqlite db: a row, no row, and a
 *       query that fails to run (missing table) → the arm's value
 *   §4  generic `!{}` value positions (`return`, reassignment, nested) at runtime
 *   §5  refusal — an arm that leaves from inside an expression is E-CG-003
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import {
  extractHandledOperands,
  restoreHandledOperands,
  parseExprToNode,
  guardCallArmsRaw,
  emitStringFromTree,
} from "../../src/expression-parser.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_s454_handled_sql");
let counter = 0;

beforeAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

const SCHEMA = `
    <schema>
        notes {
            id: integer primary key
            body: text
        }
    </schema>`;

/** Wrap function declarations in a db program with one button calling `go()`. */
function program(fns, goBody) {
  return `<program db="./app.db">${SCHEMA}
    <a> = "init"
${fns}
    function go() {
        ${goBody}
    }
    <button id="go" onclick=go()>go</button>
    <p>\${@a}</p>
</program>
`;
}

/** Compile (write:true) into a fresh dir. Returns { dir, errors, codes, serverJs, clientJs }. */
function compile(src) {
  const dir = resolve(TMP_ROOT, `c${++counter}`);
  mkdirSync(dir, { recursive: true });
  const input = join(dir, "app.scrml");
  writeFileSync(input, src);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: join(dir, "dist"), log: () => {} });
  const errors = (result.errors ?? []).filter((e) => !e.severity || e.severity === "error");
  const distDir = join(dir, "dist");
  const read = (suffix) => {
    if (!existsSync(distDir)) return null;
    const f = readdirSync(distDir).find((n) => n.endsWith(suffix));
    return f ? readFileSync(join(distDir, f), "utf8") : null;
  };
  return {
    dir,
    errors,
    codes: errors.map((e) => e.code),
    serverJs: read(".server.js"),
    serverPath: existsSync(distDir) ? (readdirSync(distDir).find((n) => n.endsWith(".server.js")) ?? null) : null,
    clientJs: read(".client.js"),
  };
}

/** Put app.db into one of three states, then run route `fnName` and return its decoded JSON body. */
async function runRoute(c, fnName, state) {
  const dbFile = join(c.dir, "app.db");
  for (const s of ["", "-wal", "-shm"]) if (existsSync(dbFile + s)) rmSync(dbFile + s);
  const db = new Database(dbFile, { create: true });
  if (state === "row" || state === "norow") {
    db.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    if (state === "row") db.run("INSERT INTO notes (id, body) VALUES (7, 'hello')");
  }
  db.close();
  // A fresh module instance per state: the handle opens the file lazily on first use.
  const mod = await import(join(c.dir, "dist", c.serverPath) + `?state=${state}&n=${++counter}`);
  const route = mod.routes.find((r) => r.path.includes(`_${fnName}_`));
  if (!route) throw new Error(`no route for ${fnName}: ${mod.routes.map((r) => r.path).join(", ")}`);
  const res = await route.handler(new Request("http://localhost" + route.path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
    body: "{}",
  }));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// §1 expression parser
// ---------------------------------------------------------------------------

describe("§1 expression parser — expression-position `?{}` / `!{}`", () => {
  test("a `?{}` becomes a sql-ref carrying its exact source", () => {
    const node = parseExprToNode("?{`SELECT id FROM notes WHERE id = ${x}`}.get()", "t.scrml", 0);
    expect(node.kind).toBe("call");
    expect(node.callee.object.kind).toBe("sql-ref");
    expect(node.callee.object.raw).toBe("?{`SELECT id FROM notes WHERE id = ${x}`}");
  });

  test("a postfix `!{}` becomes a guard on the whole postfix chain to its left", () => {
    const node = parseExprToNode("a + f(1).y !{ _ :> not }", "t.scrml", 0);
    expect(node.kind).toBe("binary");
    const guard = node.right;
    expect(guardCallArmsRaw(guard)).toBe("!{ _ :> not }");
    expect(emitStringFromTree(guard.callee.object)).toBe("f(1).y");
  });

  test("the guard's arms keep their source untouched by operator preprocessing", () => {
    const node = parseExprToNode("(q() !{ .QueryFailed(m) :> m is not ? \"a\" : <#r>.data  _ :> not })", "t.scrml", 0);
    expect(guardCallArmsRaw(node)).toBe("!{ .QueryFailed(m) :> m is not ? \"a\" : <#r>.data  _ :> not }");
  });

  test("a `!{` that starts an operand is logical-not, not a handler", () => {
    expect(extractHandledOperands("x = !{a: 1}")).toBe("x = !{a: 1}");
  });

  test("`?{` / `!{` inside a string or template text are not touched", () => {
    expect(extractHandledOperands("f(\"?{x}\", '!{y}', `a !{ b }`)")).toBe("f(\"?{x}\", '!{y}', `a !{ b }`)");
  });

  test("an unbalanced block leaves the text unchanged (E-SQL-008 still fires downstream)", () => {
    expect(extractHandledOperands("?{`SELECT 1`")).toBe("?{`SELECT 1`");
  });

  test("restoreHandledOperands is the exact inverse", () => {
    const src = "foo(?{`SELECT a FROM t WHERE b = ${c}`}.all() !{ _ :> [] }, `x${?{`SELECT 1`}.get()}`)";
    expect(restoreHandledOperands(extractHandledOperands(src))).toBe(
      "foo(?{`SELECT a FROM t WHERE b = ${c}`}.all() !{ _ :> [] }, `x${?{`SELECT 1`}.get()}`)",
    );
  });

  test("the guard round-trips through emitStringFromTree (a re-parse yields the same guard)", () => {
    const text = emitStringFromTree(parseExprToNode("g() !{ _ :> 0 }", "t.scrml", 0));
    expect(text).toBe("g() !{ _ :> 0 }");
    expect(guardCallArmsRaw(parseExprToNode(text, "t.scrml", 0))).toBe("!{ _ :> 0 }");
  });
});

// ---------------------------------------------------------------------------
// §2 + §3 — D1 / D2 / D3, compile + runtime
// ---------------------------------------------------------------------------

const D1 = program(`
    function constGet() {
        const row = ?{\`SELECT id FROM notes\`}.get() !{ _ :> "FALLBACK" }
        return row
    }
    function constAll() {
        const rows = ?{\`SELECT id FROM notes\`}.all() !{ _ :> ["FALLBACK"] }
        return rows
    }
    function letBound() {
        let row = ?{\`SELECT id FROM notes\`}.get() !{ .QueryFailed(m) :> "QF:" + m
            _ :> "OTHER" }
        return row
    }
    function reassign() {
        let row = "unset"
        row = ?{\`SELECT id FROM notes\`}.get() !{ _ :> "FALLBACK" }
        return row
    }
    function paren() {
        const row = (?{\`SELECT id FROM notes\`}.get() !{ _ :> "FALLBACK" })
        return row
    }
    function ret() {
        return ?{\`SELECT id FROM notes\`}.get() !{ _ :> "FALLBACK" }
    }`,
  `@a = "" + constGet() + constAll() + letBound() + reassign() + paren() + ret()`);

const D2 = program(`
    function matchGet() {
        const r = match ?{\`SELECT id FROM notes\`}.get() {
            ::Ok(x) :> x
            _ :> "FALLBACK"
        }
        return r
    }
    function matchAll() {
        const rs = match ?{\`SELECT id FROM notes\`}.all() {
            ::Ok(found) :> found
            ::QueryFailed(m) :> ["QF:" + m]
            _ :> []
        }
        return rs
    }`,
  `@a = "" + matchGet() + matchAll()`);

const D3 = program(`
    function check() {
        if (?{\`SELECT id FROM notes\`}.get() !{ _ :> not }) {
            return "truthy"
        }
        return "falsy"
    }`,
  `@a = check()`);

describe("§2 compile — every handled-`?{}` shape compiles, server-placed, nothing leaks", () => {
  for (const [label, src] of [["D1", D1], ["D2", D2], ["D3", D3]]) {
    test(`${label} compiles clean and lowers through _scrml_sql_attempt on the server`, () => {
      const c = compile(src);
      expect(c.codes).toEqual([]);
      expect(c.serverJs).not.toBeNull();
      expect(c.serverJs).toContain("_scrml_sql_attempt(async () =>");
      expect(c.serverJs).toContain("async function _scrml_sql_attempt(run)");
      expect(c.serverJs).not.toContain("sql-ref unresolved");
      expect(c.serverJs).not.toMatch(/!\{ *(_|\.|::)/); // no un-lowered guard
      expect(c.clientJs).not.toContain("_scrml_sql");
      expect(c.clientJs).not.toContain("sql-ref unresolved");
    });
  }

  test("D2: the `match` form's function is a SERVER route (was silently client-placed)", () => {
    const c = compile(D2);
    expect(c.serverJs).toMatch(/__ri_route_matchGet_/);
    expect(c.clientJs).toMatch(/_scrml_fetch_matchGet_/);
  });

  test("an UNHANDLED query is emitted exactly as before (no attempt wrapper)", () => {
    const c = compile(program(`
    function plain() {
        const row = ?{\`SELECT id FROM notes\`}.get()
        return row
    }`, `@a = plain()`));
    expect(c.codes).toEqual([]);
    expect(c.serverJs).toContain("const row = (await _scrml_sql`SELECT id FROM notes`)[0] ?? null;");
    expect(c.serverJs).not.toContain("_scrml_sql_attempt");
  });
});

describe("§3 RUNTIME — a row / no row / a query that fails to run", () => {
  const expectations = {
    D1: {
      constGet: { row: { id: 7 }, norow: null, fail: "FALLBACK" },
      constAll: { row: [{ id: 7 }], norow: [], fail: ["FALLBACK"] },
      letBound: { row: { id: 7 }, norow: null, fail: "QF:no such table: notes" },
      reassign: { row: { id: 7 }, norow: null, fail: "FALLBACK" },
      paren: { row: { id: 7 }, norow: null, fail: "FALLBACK" },
      ret: { row: { id: 7 }, norow: null, fail: "FALLBACK" },
    },
    D2: {
      matchGet: { row: { id: 7 }, norow: null, fail: "FALLBACK" },
      matchAll: { row: [{ id: 7 }], norow: [], fail: ["QF:no such table: notes"] },
    },
    D3: {
      check: { row: "truthy", norow: "falsy", fail: "falsy" },
    },
  };
  const sources = { D1, D2, D3 };
  for (const [label, fns] of Object.entries(expectations)) {
    for (const [fnName, byState] of Object.entries(fns)) {
      for (const [state, expected] of Object.entries(byState)) {
        test(`${label} ${fnName} [${state}] → ${JSON.stringify(expected)}`, async () => {
          const c = compile(sources[label]);
          expect(c.codes).toEqual([]);
          expect(await runRoute(c, fnName, state)).toEqual(expected);
        });
      }
    }
  }

  test("SPEC §19.8.3 example 1 compiles; its `.QueryFailed(m)` arm receives the message", () => {
    const c = compile(`<program db="./app.db">
    <schema>
        users {
            id: integer primary key
            name: text
        }
    </schema>
    <a> = "init"
    function userName(id) {
        const row = ?{\`SELECT name FROM users WHERE id = \${id}\`}.get() !{
            .QueryFailed(m)         :> { return "?" }
            .ConstraintViolation(f) :> { return "?" }
            .ConnectionLost         :> { return "?" }
            _                       :> { return "?" }
        }
        return row is not ? "(none)" : row.name
    }
    function go() { @a = userName(1) }
    <button id="go" onclick=go()>go</button>
    <p>\${@a}</p>
</program>
`);
    expect(c.codes).toEqual([]);
    expect(c.serverJs).toMatch(/const m = _scrml__scrml_result_\d+\.data\.message;/);
    expect(c.serverJs).toMatch(/variant === "QueryFailed"/);
  });
});

// ---------------------------------------------------------------------------
// §4 generic `!{}` value positions (any failable)
// ---------------------------------------------------------------------------

describe("§4 generic `!{}` value positions — return, reassignment, inside an expression", () => {
  const SRC = `<program>
    type E:enum = { Bad }
    <a> = "init"
    function risky(n: number)! -> E {
        if (n > 1) fail E::Bad
        return n
    }
    function viaReturn(n: number) {
        return risky(n) !{ _ :> 70 }
    }
    function viaReassign(n: number) {
        let v = 0
        v = risky(n) !{ _ :> 80 }
        return v
    }
    function viaCondition(n: number) {
        if (risky(n) !{ _ :> 0 }) {
            return "ok"
        }
        return "fallback"
    }
    function viaParen(n: number) {
        const v = (risky(n) !{ _ :> 90 }) + 1
        return v
    }
    function go() {
        @a = [viaReturn(1), viaReturn(2), viaReassign(1), viaReassign(2), viaCondition(1), viaCondition(2), viaParen(1), viaParen(2)].join(",")
    }
    <button id="go" onclick=go()>go</button>
    <p>\${@a}</p>
</program>
`;
  test("each position yields the call's value on success and the arm's value on failure", () => {
    const c = compile(SRC);
    expect(c.codes).toEqual([]);
    // Evaluate just the emitted function declarations (client-side, no DOM needed).
    const fnSrc = c.clientJs
      .split("\n")
      .filter((l, i, all) => true)
      .join("\n");
    const names = ["risky", "viaReturn", "viaReassign", "viaCondition", "viaParen"];
    const pick = (n) => {
      const m = new RegExp(`function (_scrml_${n}_\\d+)\\(`).exec(fnSrc);
      return m ? m[1] : null;
    };
    const decls = [];
    for (const n of names) {
      const id = pick(n);
      expect(id).not.toBeNull();
      const start = fnSrc.indexOf(`function ${id}(`);
      // the declaration ends at the `}` that balances its body's `{` (the emitted
      // bodies hold no brace inside a string literal)
      let i = fnSrc.indexOf("{", fnSrc.indexOf(")", start));
      let depth = 0;
      for (; i < fnSrc.length; i++) {
        if (fnSrc[i] === "{") depth++;
        else if (fnSrc[i] === "}" && --depth === 0) break;
      }
      decls.push(fnSrc.slice(start, i + 1));
    }
    const ids = names.map(pick);
    // eslint-disable-next-line no-new-func
    const run = new Function(`${decls.join("\n")}\nreturn [${ids.slice(1).map((id) => `${id}(1), ${id}(2)`).join(", ")}];`);
    expect(run()).toEqual([1, 70, 1, 80, "ok", "fallback", 2, 91]);
  });
});

// ---------------------------------------------------------------------------
// §5 refusal — an arm that LEAVES cannot be lowered inside an expression
// ---------------------------------------------------------------------------

describe("§5 refusal — a leaving arm inside an expression is E-CG-003, never a silent value", () => {
  test("`if (?{…}.get() !{ _ :> return \"x\" })` is refused", () => {
    const c = compile(program(`
    function leaves() {
        if (?{\`SELECT id FROM notes\`}.get() !{ _ :> { return "x" } }) {
            return "y"
        }
        return "z"
    }`, `@a = leaves()`));
    expect(c.codes).toContain("E-CG-003");
  });
});
