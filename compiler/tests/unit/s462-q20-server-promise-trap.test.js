/**
 * S462 Q20 (ruling "q20 yes.") — the server Promise trap: WHERE it is emitted.
 *
 * SPEC §13.2: in server code, a boolean-test position — an `if` / `while` /
 * `do-while` / C-style `for` condition, the operand of `!`, an operand of `&&` /
 * `||`, a ternary condition — whose operand is a direct call to a `scrml:`
 * standard-library import is emitted as `_scrml_assert_settled(<operand>)`. The
 * helper is injected into the server module on use. Client code is untouched.
 * Stated limit: a result stored in a variable and tested later is not covered.
 *
 * The executed proof (classifier deliberately defeated → HTTP 500; normal
 * results unchanged) is integration/s462-q20-server-promise-trap.test.js.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { buildCalleeImportMap } from "../../src/codegen/scheduling.ts";
import {
  isStdlibImportedCallee,
  isPromiseReturningImportedCallee,
  resolveModulePath,
  __testOnlyForceAwaitClassifierMiss,
} from "../../src/module-resolver.js";

const TMP = mkdtempSync(join(tmpdir(), "s462-q20-trap-unit-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function compile(files) {
  const dir = join(TMP, `c${seq++}`);
  mkdirSync(dir, { recursive: true });
  const paths = [];
  for (const [name, src] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, src);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: false, log: () => {} });
  const out = (name) => result.outputs.get(join(dir, name)) ?? {};
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? ""));
  return { result, out, codes: errors.map((e) => e.code) };
}

const serverApp = (imports, body, extra = "") => `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <db src="./app.db" tables="users">
    \${
      ${imports}
${extra}
      function login(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
${body}
      }
    }
  </db>
  <out> = ""
  <button onclick={ @out = login("ada", "x") !{ .Transport(_) :> { return } } }>go</button>
</program>
`;

const AUTH = `import { verifyPassword as vp, verifyPassword } from "scrml:auth"
      import { safeCompare } from "scrml:crypto"`;

function serverOf(body, extra = "") {
  const { out, codes } = compile({ "app.scrml": serverApp(AUTH, body, extra) });
  expect(codes).toEqual([]);
  return out("app.scrml").serverJs ?? "";
}

const T = "_scrml_assert_settled";

describe("§1 every boolean-test position wraps a direct stdlib call (server)", () => {
  test("`if` condition — async (awaited inside the wrap) and sync stdlib alike", () => {
    const js = serverOf(`        if (verifyPassword(pass, row.pw)) { return "A" }
        if (safeCompare(name, pass)) { return "B" }
        return "C"`);
    expect(js).toContain(`if (${T}(await verifyPassword(pass, row.pw))) {`);
    expect(js).toContain(`if (${T}(safeCompare(name, pass))) {`);
  });

  test("`else if` condition", () => {
    const js = serverOf(`        if (name == "") { return "A" } else if (vp(pass, row.pw)) { return "B" }
        return "C"`);
    expect(js).toContain(`if (${T}(await vp(pass, row.pw))) {`);
  });

  test("`!` operand — through an `as` alias", () => {
    const js = serverOf(`        if (!vp(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"`);
    expect(js).toContain(`if (!${T}(await vp(pass, row.pw))) {`);
  });

  test("optional call `f?.(…)`", () => {
    const js = serverOf(`        if (verifyPassword?.(pass, row.pw)) { return "A" }
        return "B"`);
    expect(js).toContain(`if (${T}(await verifyPassword?.(pass, row.pw))) {`);
  });

  test("`&&` / `||` operands (both sides)", () => {
    const js = serverOf(`        if (name != "" && vp(pass, row.pw)) { return "A" }
        const w = safeCompare(name, pass) || verifyPassword(pass, row.pw)
        return w`);
    expect(js).toContain(`&& ${T}(await vp(pass, row.pw))`);
    expect(js).toContain(`const w = ${T}(safeCompare(name, pass)) || ${T}(await verifyPassword(pass, row.pw));`);
  });

  test("ternary condition", () => {
    const js = serverOf(`        return verifyPassword(pass, row.pw) ? "A" : "B"`);
    expect(js).toContain(`${T}(await verifyPassword(pass, row.pw)) ? "A" : "B"`);
  });

  test("`while`, `do-while` and C-style `for` conditions", () => {
    const js = serverOf(`        let n = 0
        while (safeCompare(name, pass)) { n = n + 1 }
        do { n = n + 1 } while (safeCompare(name, pass))
        for (let i = 0; safeCompare(name, pass); i++) { n = n + 1 }
        return n`);
    expect(js).toContain(`while (${T}(safeCompare(name, pass))) {`);
    expect(js).toContain(`} while (${T}(safeCompare(name, pass)));`);
    expect(js).toContain(`for (let i = 0; ${T}(safeCompare(name, pass)); i++) {`);
  });

  test("the helper is injected exactly once, and it throws on a thenable", () => {
    const js = serverOf(`        if (!vp(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"`);
    expect(js.split(`function ${T}(value)`).length - 1).toBe(1);
    const m = new RegExp(`function ${T}\\(value\\) \\{[\\s\\S]*?\\n\\}`).exec(js);
    expect(m).not.toBeNull();
    const fn = new Function("_scrml_g", `${m[0]}; return ${T};`)(globalThis);
    expect(fn(true)).toBe(true);
    expect(fn(false)).toBe(false);
    expect(fn(0)).toBe(0);
    expect(fn("")).toBe("");
    const obj = { ok: 1 };
    expect(fn(obj)).toBe(obj);
    expect(() => fn(Promise.resolve(false))).toThrow("tested before it settled");
    expect(() => fn({ then() {} })).toThrow("tested before it settled");
  });

  test("a user module that re-exports a stdlib name is the stdlib export (re-export chain)", () => {
    const { out, codes } = compile({
      "lib.scrml": `\${
  export { verifyPassword as checkPw } from "scrml:auth"
}
`,
      "app.scrml": serverApp(`import { checkPw } from "./lib.scrml"`, `        if (!checkPw(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"`),
    });
    expect(codes).toEqual([]);
    expect(out("app.scrml").serverJs ?? "").toContain(`if (!${T}(await checkPw(pass, row.pw))) {`);
  });
});

describe("§2 nothing else is wrapped", () => {
  test("value positions: a stored result, a return, an argument, a comparison", () => {
    const js = serverOf(`        const ok = verifyPassword(pass, row.pw)
        if (!ok) { return "REJECTED" }
        if (verifyPassword(pass, row.pw) == true) { return "EQ" }
        return safeCompare(name, pass)`);
    expect(js).toContain("const ok = await verifyPassword(pass, row.pw);");
    expect(js).toContain("if (!ok) {");
    expect(js).toContain("return safeCompare(name, pass);");
    expect(js).not.toContain(`${T}(await verifyPassword(pass, row.pw)) ==`);
  });

  test("a call to a sibling server function or a non-stdlib user import is not wrapped", () => {
    const { out, codes } = compile({
      "util.scrml": `\${
  export function isAdmin(name) { return name == "root" }
}
`,
      "app.scrml": serverApp(`import { isAdmin } from "./util.scrml"`, `        if (isAdmin(name)) { return "ROOT" }
        if (!pwOk(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"`, `      function pwOk(p, h) {
        const n = ?{\`SELECT COUNT(*) AS n FROM users\`}.get() !{ _ :> not }
        return p == h
      }`),
    });
    expect(codes).toEqual([]);
    const js = out("app.scrml").serverJs ?? "";
    expect(js).not.toContain(T);
  });

  test("a server module with no boolean test of a stdlib call carries no helper (byte-unchanged)", () => {
    const js = serverOf(`        const ok = verifyPassword(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"`);
    expect(js).not.toContain(T);
  });

  test("CLIENT code is untouched: a client fn testing a stdlib call is not wrapped, no client bundle names the helper", () => {
    const { result, out, codes } = compile({
      "app.scrml": `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <db src="./app.db" tables="users">
    \${
      ${AUTH}
      function login(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        if (!vp(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"
      }
    }
  </db>
  <a> = ""
  <out> = ""
  \${ import { capitalize } from "scrml:format" }
  function clientCheck() {
    if (capitalize(@a)) { @out = "x" }
    @out = !capitalize(@a) ? "y" : "z"
  }
  <button onclick={ @out = login("ada", "x") !{ .Transport(_) :> { return } } }>go</button>
  <button onclick={ clientCheck() }>c</button>
</program>
`,
    });
    expect(codes).toEqual([]);
    const o = out("app.scrml");
    expect(o.serverJs ?? "").toContain(`if (!${T}(await vp(pass, row.pw))) {`);
    expect(o.clientJs ?? "").toContain("if (capitalize(");
    expect(o.clientJs ?? "").toContain("!capitalize(");
    for (const [, fo] of result.outputs) {
      for (const [k, v] of Object.entries(fo)) {
        if (k === "serverJs" || typeof v !== "string") continue;
        expect(v).not.toContain(T);
      }
    }
    const rt = result.runtimeSource();
    expect(rt.length).toBeGreaterThan(0);
    expect(rt).not.toContain(T);
  });
});

describe("§3 the operand identity (module-resolver) and the test seam", () => {
  const importer = join(TMP, "id", "app.scrml");
  const fileAST = {
    filePath: importer,
    imports: [
      { source: "scrml:auth", specifiers: [{ local: "vp", imported: "verifyPassword" }, { local: "hashPassword", imported: "hashPassword" }] },
      { source: "./util.scrml", specifiers: [{ local: "isAdmin", imported: "isAdmin" }, { local: "checkPw", imported: "checkPw" }] },
    ],
  };
  const map = buildCalleeImportMap(fileAST);
  const util = resolveModulePath("./util.scrml", importer);
  const auth = resolveModulePath("scrml:auth", importer);
  const registry = new Map([
    [util, new Map([
      ["isAdmin", { kind: "function", category: "function", isComponent: false }],
      ["checkPw", { kind: "function", category: "function", isComponent: false, isAsync: true, stdlibOrigin: auth }],
    ])],
    [auth, new Map([["verifyPassword", { kind: "function", category: "function", isComponent: false, isAsync: true }]])],
  ]);

  test("a stdlib import qualifies by path alone — alias or not, async or not, registry or not", () => {
    expect(isStdlibImportedCallee("vp", map, registry)).toBe(true);
    expect(isStdlibImportedCallee("hashPassword", map, null)).toBe(true);
    expect(isStdlibImportedCallee("vp", map, null)).toBe(true);
  });

  test("a user re-export of a stdlib name qualifies by its stdlibOrigin; a user function does not", () => {
    expect(isStdlibImportedCallee("checkPw", map, registry)).toBe(true);
    expect(isStdlibImportedCallee("isAdmin", map, registry)).toBe(false);
    expect(isStdlibImportedCallee("notImported", map, registry)).toBe(false);
  });

  test("the seam forces a classifier miss by EXPORT name and restores", () => {
    expect(isPromiseReturningImportedCallee("vp", map, registry)).toBe(true);
    const prev = __testOnlyForceAwaitClassifierMiss(["verifyPassword"]);
    try {
      expect(isPromiseReturningImportedCallee("vp", map, registry)).toBe(false);
      // The trap's operand identity does not consult the classifier.
      expect(isStdlibImportedCallee("vp", map, registry)).toBe(true);
    } finally {
      __testOnlyForceAwaitClassifierMiss(prev);
    }
    expect(isPromiseReturningImportedCallee("vp", map, registry)).toBe(true);
  });
});
