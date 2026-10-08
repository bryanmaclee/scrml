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
import { resolve, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import {
  extractHandledOperands,
  restoreHandledOperands,
  parseExprToNode,
  guardCallArmsRaw,
  emitStringFromTree,
  GUARD_MARKER,
} from "../../src/expression-parser.ts";

// Scratch lives under os.tmpdir() — the S448 per-process temp root the test
// preload owns (compiler/tests/helpers/tmp-root-preload.js) — never in the repo.
let TMP_ROOT = "";
let counter = 0;

beforeAll(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "s454-handled-sql-"));
});
afterAll(() => {
  // Every bun:sqlite handle THIS file opens is closed before its route runs. The
  // executed server modules, however, keep their own lazily-opened driver handle
  // (`_scrml_sql`, module-private, no teardown export) for the life of the
  // process, and Windows refuses to delete an open file (EBUSY). So cleanup is
  // best-effort: a still-held db file is left for the preload, which removes the
  // whole per-process temp root when the run ends.
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_e) { /* EBUSY on Windows — preload cleans up */ }
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
/** Run route `fnName` with JSON `body`; returns { status, text } or { threw }. */
async function runRouteRaw(c, fnName, state, body = "{}") {
  const dbFile = join(c.dir, "app.db");
  // One run per compile: a previous run's server module may still hold app.db
  // open (Windows: EBUSY on delete), so a compiled program is never re-seeded.
  if (state !== "none" && existsSync(dbFile)) throw new Error("runRoute needs a fresh compile per run (app.db already exists)");
  const db = new Database(dbFile, { create: true });
  if (state === "row" || state === "norow") {
    db.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    if (state === "row") db.run("INSERT INTO notes (id, body) VALUES (7, 'hello')");
  }
  db.close();
  const mod = await import(join(c.dir, "dist", c.serverPath) + `?state=${state}&n=${++counter}`);
  const route = mod.routes.find((r) => r.path.includes(`_${fnName}_`));
  if (!route) throw new Error(`no route for ${fnName}`);
  try {
    const res = await route.handler(new Request("http://localhost" + route.path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
      body,
    }));
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { threw: String((e && e.message) || e) };
  }
}

async function runRoute(c, fnName, state) {
  const dbFile = join(c.dir, "app.db");
  // One run per compile: a previous run's server module may still hold app.db
  // open (Windows: EBUSY on delete), so a compiled program is never re-seeded.
  if (state !== "none" && existsSync(dbFile)) throw new Error("runRoute needs a fresh compile per run (app.db already exists)");
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
      expect(c.serverJs).toContain("_scrml_sql_attempt((_scrml_p) =>");
      expect(c.serverJs).toContain("async function _scrml_sql_attempt(run, args, then)");
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

// ---------------------------------------------------------------------------
// §6 S454 fix round — F1: exhaustiveness in every position + fail-closed lowering
// ---------------------------------------------------------------------------

/** Extract the emitted `function <id>(…) { … }` declaration for scrml fn `name`. */
function fnDecl(js, name) {
  const m = new RegExp(`function (_scrml_${name}_\\d+)\\(`).exec(js);
  if (!m) return null;
  const start = js.indexOf(`function ${m[1]}(`);
  let i = js.indexOf("{", js.indexOf(")", start));
  let depth = 0;
  for (; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}" && --depth === 0) break;
  }
  return { id: m[1], src: js.slice(start, i + 1) };
}

describe("§6 F1 — a non-total handler is refused; an unmatched failure is never a value", () => {
  test("SQL in an `if` condition with only `.ConstraintViolation` is E-TYPE-080 (was: 200 ADMIN-GRANTED on QueryFailed)", () => {
    const c = compile(program(`
    function check(u) {
        if (?{\`SELECT id FROM notes WHERE id = \${u}\`}.get() !{ .ConstraintViolation(f) :> not }) {
            return "ADMIN-GRANTED"
        }
        return "denied"
    }`, `@a = check(1)`));
    expect(c.codes).toContain("E-TYPE-080");
  });

  test("statement form `const a = ?{…}.get() !{ .ConstraintViolation(f) :> not }` is E-TYPE-080", () => {
    const c = compile(program(`
    function stmt() {
        const a = ?{\`SELECT id FROM notes\`}.get() !{ .ConstraintViolation(f) :> not }
        return a
    }`, `@a = stmt()`));
    expect(c.codes).toContain("E-TYPE-080");
  });

  test("client, no SQL: `if (f(n) !{ .A :> false })` with E = { A, B } is E-TYPE-080", () => {
    const c = compile(`<program>
    type E:enum = { A, B }
    <a> = "init"
    function f(n: number)! -> E {
        if (n > 1) fail E::B
        return n
    }
    function g(n: number) {
        if (f(n) !{ .A :> false }) {
            return "TAKEN"
        }
        return "no"
    }
    function go() { @a = g(2) }
    <button id="go" onclick=go()>go</button>
    <p>\${@a}</p>
</program>
`);
    expect(c.codes).toContain("E-TYPE-080");
  });

  test("a `match` on a `?{}` without a catch-all must name ::Ok and every SqlError variant (E-TYPE-020)", () => {
    const c = compile(program(`
    function m() {
        const r = match ?{\`SELECT id FROM notes\`}.get() {
            ::Ok(x) :> x
            ::QueryFailed(e) :> not
        }
        return r
    }`, `@a = m()`));
    expect(c.codes).toContain("E-TYPE-020");
  });

  test("a TOTAL handler listing every SqlError variant still compiles and runs", async () => {
    const src = program(`
    function total() {
        const row = ?{\`SELECT id FROM notes\`}.get() !{
            .QueryFailed(m)         :> "QF"
            .ConstraintViolation(f) :> "CV"
            .ConnectionLost         :> "CL"
            .BatchPrepareFailed     :> "BP"
        }
        return row
    }`, `@a = total()`);
    const c = compile(src);
    expect(c.codes).toEqual([]);
    expect(await runRoute(c, "total", "row")).toEqual({ id: 7 });
    expect(await runRoute(compile(src), "total", "fail")).toBe("QF");
  });

  test("defence in depth: an expression-position handler re-raises a variant no arm names", () => {
    const c = compile(`<program>
    type E:enum = { A, B }
    <a> = "init"
    function f(n: number)! -> E {
        if (n > 1) fail E::B
        return n
    }
    function g(n: number) {
        if (f(n) !{ .A :> false  .B :> false }) {
            return "TAKEN"
        }
        return "no"
    }
    function go() { @a = g(2) }
    <button id="go" onclick=go()>go</button>
    <p>\${@a}</p>
</program>
`);
    expect(c.codes).toEqual([]);
    const g = fnDecl(c.clientJs, "g");
    const f = fnDecl(c.clientJs, "f");
    // Run g against a stub f that fails with a variant the checker never saw.
    // eslint-disable-next-line no-new-func
    const run = new Function(`function ${f.id}(n) { return { __scrml_error: true, type: "E", variant: "Z", data: null }; }\n${g.src}\nreturn ${g.id}(1);`);
    expect(() => run()).toThrow(/no handler arm matched the failure E\.Z/);
  });
});

// ---------------------------------------------------------------------------
// §7 S454 fix round — F2: regex literals are opaque to the `!{` / `?{` scan
// ---------------------------------------------------------------------------

describe("§7 F2 — a regex literal is not a handler", () => {
  test("`/a!{2}/` is untouched, directly and inside an arrow body", () => {
    expect(extractHandledOperands("/a!{2}/.test(x)")).toBe("/a!{2}/.test(x)");
    expect(extractHandledOperands("xs.filter((x) => /a!{2}/.test(x))")).toBe("xs.filter((x) => /a!{2}/.test(x))");
    expect(extractHandledOperands("q(/x?{2}/)")).toBe("q(/x?{2}/)");
  });
  test("a division is still a division (`a / b !{…}` is a handler on `b`)", () => {
    expect(extractHandledOperands("a / b !{ _ :> 0 }")).toContain(`.${GUARD_MARKER()}(`);
  });
  test("RUNTIME: `/a!{2}/.test(\"a!!\")` is true in the compiled client function", () => {
    const c = compile(`<program>
    <a> = "init"
    function t(s) {
        return /a!{2}/.test(s)
    }
    function go() { @a = "" + t("a!!") }
    <button id="go" onclick=go()>go</button>
    <p>\${@a}</p>
</program>
`);
    expect(c.codes).toEqual([]);
    const t = fnDecl(c.clientJs, "t");
    // eslint-disable-next-line no-new-func
    expect(new Function(`${t.src}\nreturn ${t.id}("a!!");`)()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8 S454 fix round — F3: only the driver call is attempted
// ---------------------------------------------------------------------------

describe("§8 F3 — parameters and floor helpers run OUTSIDE the attempt", () => {
  test("a host TypeError in a parameter propagates as itself (not QueryFailed → the `_` arm)", async () => {
    const c = compile(program(`
    function byKey(o) {
        const row = ?{\`SELECT id FROM notes WHERE id = \${o.x.y}\`}.get() !{ _ :> "FALLBACK" }
        return row
    }`, `@a = byKey({})`));
    expect(c.codes).toEqual([]);
    const out = await runRouteRaw(c, "byKey", "row", JSON.stringify({ o: {} }));
    expect(JSON.stringify(out)).not.toContain("FALLBACK");
    expect(out.threw ?? out.text).toMatch(/undefined|TypeError|null/i);
  });

  test("the emitted shape evaluates parameters as call arguments and shapes rows after the try", () => {
    const c = compile(program(`
    function byId(id) {
        const row = ?{\`SELECT id FROM notes WHERE id = \${id}\`}.get() !{ _ :> not }
        return row
    }`, `@a = byId(1)`));
    expect(c.serverJs).toContain("await _scrml_sql_attempt((_scrml_p) => _scrml_sql`SELECT id FROM notes WHERE id = ${_scrml_p[0]}`, [id], (_scrml_rows) => (_scrml_rows)[0] ?? null)");
  });

  test("a runtime E-TENANT-WRITE refusal surfaces as itself, not as QueryFailed", async () => {
    const dir = resolve(TMP_ROOT, `tenant${++counter}`);
    mkdirSync(dir, { recursive: true });
    const input = join(dir, "app.scrml");
    writeFileSync(input, `<program db="./app.db">
  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)\`}
  </schema>
  <db src="./app.db" tables="assets">
    \${
      function wipe() {
        const r = ?{\`DELETE FROM assets WHERE id = 1\`}.run() !{ _ :> "FALLBACK" }
        return r
      }
    }
  </db>
  <a> = "init"
  <button id="go" onclick=\${ () => { @a = wipe() } }>go</button>
  <p>\${@a}</p>
</program>
`);
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: join(dir, "dist"), log: () => {} });
    expect((result.errors ?? []).filter((e) => !e.severity || e.severity === "error").map((e) => e.code)).toEqual([]);
    const serverPath = readdirSync(join(dir, "dist")).find((n) => n.endsWith(".server.js"));
    const js = readFileSync(join(dir, "dist", serverPath), "utf8");
    // The write key is an ARGUMENT to the attempt, not inside its thunk.
    expect(js).toMatch(/_scrml_sql_attempt\(\(_scrml_p\) => _scrml_sql`DELETE FROM assets WHERE \(id = 1\) AND tenant_id = \$\{_scrml_p\[0\]\}`, \[_scrml_tenant_write_key\(\)\]/);
    const db = new Database(join(dir, "app.db"), { create: true });
    db.run("CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
    db.close();
    const out = await runRouteRaw({ dir, serverPath }, "wipe", "none");
    expect(JSON.stringify(out)).not.toContain("FALLBACK");
    expect(out.threw ?? out.text).toContain("E-TENANT-WRITE");
  });
});
