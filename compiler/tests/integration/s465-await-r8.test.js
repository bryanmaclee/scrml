/**
 * S465 fix round 8 (S239 review of f84da20a3) — two roots, both pre-existing on main.
 *
 *   HIGH-1 a function-valued binding calling ANOTHER async binding was not awaited on the
 *       server: the D-5 closure emitted every module binding with `declaredNames` = all module
 *       binding names, so `w` in `const v = (p, h) => !w(p, h)` read as a shadowing local.
 *       Now ONE rule (file-async-fns.ts `moduleLevelDeclaredNames`) for the server D-5 copy and
 *       the client top-level copy: a module binding is not a local.
 *   HIGH-2 a type-annotated `export const f: (…) => T = (…) => …` was never coloured async:
 *       fn-valued-bindings read the export's init with a regex over `raw` that could not read
 *       past the annotation. Now it reads the builder's parsed init (`valueInitExpr`, set for
 *       annotated AND unannotated plain value exports); the ss1 copy of an async exported
 *       binding is emitted `async`.
 *   LOW    a channel `onserver:*` handler calling an async helper is emitted `async` (was a
 *       sync function holding `await` → E-CODEGEN-INVALID-LOGIC).
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
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    return "WELCOME"`;
const L = (s) => `\${\n  import { verifyPassword } from "scrml:auth"\n  ${s}\n}\n`;
const B = R(`!check(pass, row.pw)`);
const W = `const w = (a, b) => check(a, b)`;

const RUN = {
  // HIGH-1 (probes3 m3 / m2)
  bindNotBinding: { top: W + `\n  const v = (p, h) => !w(p, h)`, body: R(`v(pass, row.pw)`) },
  bindChainBlock: { top: W + `\n  const v = (p, h) => {\n    return !w(p, h)\n  }`, body: R(`v(pass, row.pw)`) },
  libBindChainNot: { lib: L(`const a1 = (p, h) => verifyPassword(p, h)\n  const a2 = (p, h) => !a1(p, h)\n  export function check(p, h) { return !a2(p, h) }`), body: B },
  // a real shadow still shadows: the parameter `w` is the sync callback passed in
  paramShadowsBinding: { top: W + `\n  const v = (w, p) => w(p)`, body: `if (v((x) => x == "right-password", pass) == false) { return "REJECTED" }\n    return "WELCOME"` },
  // HIGH-2 (probes3 m4)
  appExportConstAnn: { top: `export const w: (a: string, b: string) => boolean = (a, b) => check(a, b)`, body: R(`!w(pass, row.pw)`) },
  libExportConstAnnInner: { lib: L(`export const inner: (p: string, h: string) => boolean = (p, h) => verifyPassword(p, h)\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
  libExportConstPlainInner: { lib: L(`export const inner = (p, h) => verifyPassword(p, h)\n  export function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`), body: B },
  // A lib whose ONLY server content is an exported value calling an import: its value-only
  // `.server.js` now carries the import (was a ReferenceError —
  // g-lib-export-const-lambda-missing-import-s465).
  libExportConstAnnImported: { lib: L(`export const check: (p: string, h: string) => boolean = (p, h) => verifyPassword(p, h)`), body: B },
  libExportFnExprImported: { lib: L(`export const check = function (p, h) { return verifyPassword(p, h) }`), body: B },
};

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function compileShape(tag, spec) {
  const dir = mkdtempSync(join(tmpdir(), `s465-r8-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), spec.lib ?? DEFAULT_LIB);
  const src = spec.app ?? `<program db="./app.db">
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
    .map((e) => `${e.code}: ${String(e.message).slice(0, 300)}`);
  const sp = join(outDir, "app.server.js");
  if (errors.length > 0 || !existsSync(sp)) return { errors, dir, outDir };
  const mod = await import(`file://${sp}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => /__ri_route_f_\d+$/.test(r.path));
  return { errors, mod, path: route?.path, serverJs: readFileSync(sp, "utf8"), dir, outDir };
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

describe("S465 r8 — binding → binding (HIGH-1) and annotated exported values (HIGH-2) (executed)", () => {
  for (const [name, spec] of Object.entries(RUN)) {
    test(`${name}: wrong → REJECTED, right → WELCOME`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
    }, T);
  }

  test("HIGH-2: the ss1 copy of an annotated async exported value is `async` and awaits its call", async () => {
    const u = await compileShape("ss1Ann", RUN.libExportConstAnnInner);
    const libJs = readFileSync(join(u.outDir, "lib.server.js"), "utf8");
    expect(libJs).toMatch(/export const inner = async \(p, h\) => await verifyPassword\(p, h\)/);
    expect(libJs).toMatch(/!await inner\(p, h\)/);
  }, T);
});

describe("S465 r8 — structural: one module-level rule, no regex over raw", () => {
  const src = (f) => readFileSync(join(import.meta.dir, "../../src/codegen", f), "utf8");
  test("the D-5 closure no longer declares every module binding a local", () => {
    expect(src("emit-server.ts")).not.toMatch(/declaredNames: new Set<string>\(byName\.keys\(\)\)/);
    expect(src("emit-server.ts")).toMatch(/moduleLevelDeclaredNames\(byName\.keys\(\)/);
    expect(src("emit-reactive-wiring.ts")).toMatch(/moduleLevelDeclaredNames\(/);
  });
  test("fn-valued-bindings reads the parsed export init, not `raw`", () => {
    expect(src("fn-valued-bindings.ts")).not.toMatch(/s\.raw/);
    expect(src("fn-valued-bindings.ts")).toMatch(/valueInitExpr/);
  });
});

describe("S465 r8 LOW — a channel onserver handler calling an async import is emitted async", () => {
  test("ch1 compiles; the handler is `async function` and awaits the import", () => {
    const dir = mkdtempSync(join(tmpdir(), "s465-r8-ch1-"));
    dirs.push(dir);
    writeFileSync(join(dir, "lib.scrml"), DEFAULT_LIB);
    writeFileSync(join(dir, "app.scrml"), `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
}
  <channel name="auth" onserver:message=onMsg(m)>
    <cb> = ""
    server function onMsg(m) {
      if (!check(m.p, m.h)) {
        broadcast("REJECTED")
        return
      }
      broadcast("WELCOME")
    }
  </channel>
  <p>\${@cb}</p>
</program>
`);
    const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: false, gather: true, log: () => {} });
    expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    const serverJs = r.outputs.get(join(dir, "app.scrml"))?.serverJs ?? "";
    expect(serverJs).toMatch(/async function onMsg\(m\)/);
    expect(serverJs).toMatch(/!await check\(m\.p, m\.h\)/);
  });
});
