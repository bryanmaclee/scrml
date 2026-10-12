/**
 * S465 fix round 6 (S239 adversarial review of dcbbd64d7).
 *
 *   HIGH-1 a top-level FUNCTION-VALUED binding (`const inner = (p, h) => verifyPassword(p, h)`,
 *       `const g = function (…) { … }`, a block-bodied arrow) was never async-coloured: the
 *       coloring fixpoint saw `function` declarations only. In a lib, `export function
 *       check(p, h) { return inner(p, h) }` was then classified sync and the importer's
 *       `if (!check(pass, hash))` tested a Promise — a wrong password was accepted (main
 *       and the r5 branch). In-file twin: `const w = (a, b) => check(a, b)`. Now the
 *       binding is a function for the fixpoint (codegen/fn-valued-bindings.ts), in-file and
 *       across imports; the server module emits it `async` and awaits calls to it; a module
 *       value that aliases / stores / returns one is E-ASYNC-FN-ESCAPES-AS-VALUE; a nested
 *       sync lambda that would have to await fails closed.
 *
 * Executed: server function `f(name, pass)` against bun:sqlite, wrong / right password.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";

const T = 30_000;

const DEFAULT_LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;
const G = `if (!check(pass, row.pw)) { return "REJECTED" }
    return "WELCOME"`;
const W = `if (!w(pass, row.pw)) { return "REJECTED" }
    return "WELCOME"`;
const lib = (body) => `\${
  import { verifyPassword } from "scrml:auth"
  ${body}
}
`;

// name -> { lib?, imports?, top?, body }  (run: wrong → REJECTED, right → WELCOME)
const RUN = {
  libLambda: { lib: lib(`const inner = (p, h) => verifyPassword(p, h)
  export function check(p, h) { return inner(p, h) }`), body: G },
  libFnExpr: { lib: lib(`const inner = function (p, h) { return verifyPassword(p, h) }
  export function check(p, h) { return inner(p, h) }`), body: G },
  libBlockLambda: { lib: lib(`const inner = (p, h) => { return verifyPassword(p, h) }
  export function check(p, h) { return inner(p, h) }`), body: G },
  libLambdaChain: { lib: lib(`const a = (p, h) => verifyPassword(p, h)
  const b = (p, h) => a(p, h)
  export function check(p, h) { return b(p, h) }`), body: G },
  libNegationInside: { lib: lib(`const bad = (p, h) => !verifyPassword(p, h)
  export function check(p, h) { return !bad(p, h) }`), body: G },
  libIfInside: { lib: lib(`const inner = (p, h) => { if (verifyPassword(p, h)) { return true }
    return false }
  export function check(p, h) { if (inner(p, h)) { return true }
    return false }`), body: G },
  inFile: { top: `const w = (a, b) => check(a, b)`, body: W },
  inFileStdlib: { imports: `import { verifyPassword } from "scrml:auth"`, top: `const w = (a, b) => verifyPassword(a, b)`, body: W },
  inFileNegation: { top: `const w = (a, b) => !check(a, b)`, body: `if (w(pass, row.pw)) { return "REJECTED" }
    return "WELCOME"` },
  inFileTernary: { top: `const w = (a, b) => check(a, b) ? 1 : 0`, body: `if (w(pass, row.pw) == 0) { return "REJECTED" }
    return "WELCOME"` },
  inFileInSomeCallback: { top: `const w = (a, b) => check(a, b)`, body: `if (![pass].some((p) => w(p, row.pw))) { return "REJECTED" }
    return "WELCOME"` },
  inFileFnCallsLambda: { top: `const w0 = (a, b) => check(a, b)
  function w(a, b) { return w0(a, b) }`, body: W },
  syncLambdaStaysSync: { top: `const dbl = (x) => x * 2`, body: `if (dbl(2) != 4) { return "bad" }
    ${G}` },
};

// name -> [spec, code]  (must be a compile error)
const REFUSE = {
  moduleAlias: [{ top: `const w0 = (a, b) => check(a, b)
  const w = w0`, body: W }, "E-ASYNC-FN-ESCAPES-AS-VALUE"],
  moduleObject: [{ top: `const o = { w: (a, b) => check(a, b) }`, body: `if (!o.w(pass, row.pw)) { return "REJECTED" }
    return "WELCOME"` }, "E-ASYNC-STDLIB-IN-SYNC-CALLBACK"],
  moduleCurried: [{ top: `const mk = (h) => (p) => check(p, h)`, body: `if (!mk(row.pw)(pass)) { return "REJECTED" }
    return "WELCOME"` }, "E-ASYNC-STDLIB-IN-SYNC-CALLBACK"],
  bodyAlias: [{ top: `const w = (a, b) => check(a, b)`, body: `const z = w
    if (!z(pass, row.pw)) { return "REJECTED" }
    return "WELCOME"` }, "E-ASYNC-FN-ESCAPES-AS-VALUE"],
  bodyPassToUserFn: [{ top: `const w = (a, b) => check(a, b)
  function apply(fn, a, b) { return fn(a, b) }`, body: `if (!apply(w, pass, row.pw)) { return "REJECTED" }
    return "WELCOME"` }, "E-ASYNC-FN-ESCAPES-AS-VALUE"],
};

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function compileShape(tag, spec) {
  const dir = mkdtempSync(join(tmpdir(), `s465-r6-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), spec.lib ?? DEFAULT_LIB);
  const src = `<program db="./app.db">
\${
  ${spec.imports ?? 'import { check } from "./lib.scrml"'}
  ${spec.top ?? ""}
  function f(name: string, pass: string) {
    const row = ?{\`SELECT name, pw FROM users WHERE name = \${name}\`}.get()
    ${spec.body}
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
  const sp = join(outDir, "app.server.js");
  if (errors.length > 0 || !existsSync(sp)) return { errors };
  const mod = await import(`file://${sp}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => /__ri_route_f_\d+$/.test(r.path));
  return { errors, mod, path: route?.path, serverJs: readFileSync(sp, "utf8") };
}

async function callF(unit, pass) {
  expect(unit.errors).toEqual([]);
  const res = await unit.mod.fetch(new Request(`http://localhost${unit.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ name: "bob", pass }),
  }));
  return { status: res.status, body: await res.text() };
}

describe("S465 r6 HIGH-1 — function-valued top-level bindings are async-coloured (executed)", () => {
  for (const [name, spec] of Object.entries(RUN)) {
    test(`${name}: wrong → REJECTED, right → WELCOME`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
    }, T);
  }
});

describe("S465 r6 HIGH-1 — an async-coloured binding used as a value is refused", () => {
  for (const [name, [spec, code]] of Object.entries(REFUSE)) {
    test(`${name}: ${code}`, async () => {
      const u = await compileShape(name, spec);
      expect(u.errors.map((e) => e.split(":")[0])).toContain(code);
    }, T);
  }
});
