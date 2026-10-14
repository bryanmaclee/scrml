/**
 * S465 fix round 7 (S239 adversarial review of 22ed85298) — ROOT fixes, not positions.
 *
 *   HIGH-A a lib's NON-EXPORTED `function` helper was never async-coloured by the ss1
 *       value-export emitter (its own fixpoint ran over the EXPORTED functions only):
 *       `export function check(p, h) { if (!inner(p, h)) … }` shipped SYNC with a bare
 *       `inner(p, h)` — a Promise, always truthy — while the importer awaited `check`.
 *       Now ONE async name set per file (codegen/file-async-fns.ts), computed once by
 *       codegen/index.ts, is read by every server emitter and by every importer.
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
const lib = (body) => `\${
  import { verifyPassword } from "scrml:auth"
  ${body}
}
`;
const IF = `export function check(p, h) {
    if (!inner(p, h)) { return false }
    return true
  }`;

// HIGH-A — the reviewer's six libFnDecl shapes (probes2/n8.mjs, n7.mjs) + controls.
const HIGH_A = {
  libFnDeclIf: { lib: lib(`function inner(p, h) { return verifyPassword(p, h) }\n  ${IF}`), body: G },
  libFnDeclImportIf: {
    lib2: lib(`export function vp(p, h) { return verifyPassword(p, h) }`),
    lib: `\${\n  import { vp } from "./lib2.scrml"\n  function inner(p, h) { return vp(p, h) }\n  ${IF}\n}\n`,
    body: G,
  },
  libFnDeclTwoHop: { lib: lib(`function inner0(p, h) { return verifyPassword(p, h) }\n  function inner(p, h) { return inner0(p, h) }\n  ${IF}`), body: G },
  libFnDeclTernary: { lib: lib(`function inner(p, h) { return verifyPassword(p, h) }\n  export function check(p, h) { return inner(p, h) ? true : false }`), body: G },
  libFnDeclServerKw: { lib: lib(`server function inner(p, h) { return verifyPassword(p, h) }\n  ${IF}`), body: G },
  libExportedSiblingIf: { lib: lib(`export function inner(p, h) { return verifyPassword(p, h) }\n  ${IF}`), body: G },
  appFnDeclIf: {
    lib: lib(`export function vp(p, h) { return verifyPassword(p, h) }`),
    imports: `import { vp } from "./lib.scrml"`,
    top: `function inner(p, h) { return vp(p, h) }\n  function check(p, h) {\n    if (!inner(p, h)) { return false }\n    return true\n  }`,
    body: G,
  },
};

// HIGH-B — a program-bound scheduler NAME is not the global scheduler (SPEC §13.2:
// "The scheduler is global only when the file neither binds its name in any form …;
// otherwise no exemption is given (fail closed)"). Each was a wrong password ACCEPTED
// on 22ed85298; each now fails closed at compile time.
const R = (cond) => `if (${cond}) { return "REJECTED" }\n    return "WELCOME"`;
const HIGH_B = {
  schedShadowLambda: { top: `function setTimeout(cb, a, b) { return cb(a, b) }`, body: R(`!setTimeout((a, b) => check(a, b), pass, row.pw)`) },
  schedShadowLambdaNoArgs: { top: `function setTimeout(cb) { return cb() }`, body: R(`!setTimeout(() => check(pass, row.pw))`) },
  schedShadowLocal: { body: `const setTimeout = (cb, a, b) => cb(a, b)\n    ${R("!setTimeout((a, b) => check(a, b), pass, row.pw)")}` },
  stdSchedShadowTop: { imports: `import { verifyPassword } from "scrml:auth"`, top: `function setTimeout(cb) { return cb() }`, body: R(`!setTimeout(() => verifyPassword(pass, row.pw))`) },
  stdSchedShadowLocal: { imports: `import { verifyPassword } from "scrml:auth"`, body: `const setTimeout = (cb) => cb()\n    ${R("!setTimeout(() => verifyPassword(pass, row.pw))")}` },
};
// …and the same shapes with a SYNC callback, and the global scheduler, still run.
const HIGH_B_RUN = {
  schedShadowSyncLambda: { top: `function setTimeout(cb, a, b) { return cb(a, b) }`, body: `if (!setTimeout((a, b) => a == "right-password", pass, row.pw)) { return "REJECTED" }\n    ${G}` },
  schedNameDirect: { top: `function setTimeout(p, h) { return check(p, h) }`, body: R(`!setTimeout(pass, row.pw)`) },
  schedLambdaGlobal: { body: `setTimeout((a) => check(a, row.pw), 0, pass)\n    ${G}` },
};

// MED-D — legal SYNC function values with a `)` / `=>` in a string default or a lambda
// default were refused as unreadable (a text split of the head); read from the tree now.
const S = `if (!check(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + w(name)`;
const MED_D = {
  syncFnStrParen: [{ top: `const w = function (a, s = ")") {\n    return a.trim() + s\n  }`, body: S }, "WELCOME:bob)"],
  syncArrowDefaultLambda: [{ top: `const w = (a, k = (x) => x) => {\n    return k(a.trim())\n  }`, body: S }, "WELCOME:bob"],
  syncArrowStrArrow: [{ top: `const w = (a, s = "=>") => {\n    return a.trim() + s\n  }`, body: S }, "WELCOME:bob=>"],
  syncInFnStrParen: [{ body: `const w = function (a, s = ")") {\n      return a.trim() + s\n    }\n    ${S}` }, "WELCOME:bob)"],
  syncInFnArrowDefault: [{ body: `const w = (a, k = (x) => x) => {\n      return k(a.trim())\n    }\n    ${S}` }, "WELCOME:bob"],
  asyncArrowStrArrow: [{ top: `const w2 = (a, b, s = "=>") => {\n    return check(a, b)\n  }\n  const w = (a) => a`, body: `if (!w2(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME:" + w(name)` }, "WELCOME:bob"],
};

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function compileShape(tag, spec) {
  const dir = mkdtempSync(join(tmpdir(), `s465-r7-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), spec.lib ?? DEFAULT_LIB);
  if (spec.lib2) writeFileSync(join(dir, "lib2.scrml"), spec.lib2);
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

describe("S465 r7 HIGH-A — a lib's non-exported helper colours its exports (executed)", () => {
  for (const [name, spec] of Object.entries(HIGH_A)) {
    test(`${name}: wrong → REJECTED, right → WELCOME`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
    }, T);
  }

  // The `?{}` twin (libFnDeclSql): the lib has no database of its own, so the call is
  // pinned by the emitted lib module rather than executed.
  test("libFnDeclSql: the ss1 export that calls a `?{}` helper is async and awaits it", async () => {
    const u = await compileShape("libFnDeclSql", {
      lib: `\${\n  function hasUser(n) { return ?{\`SELECT 1 AS x FROM users WHERE name = \${n}\`}.get() }\n  export function check(p, h) {\n    if (!hasUser("nobody-zz")) { return false }\n    return true\n  }\n}\n`,
      body: G,
    });
    expect(u.errors).toEqual([]);
    const libJs = readFileSync(join(u.outDir, "lib.server.js"), "utf8");
    const ss1 = libJs.slice(libJs.indexOf("ss1: module value exports"));
    expect(ss1).toContain("export async function check(");
    expect(ss1).toMatch(/!await hasUser\("nobody-zz"\)/);
  }, T);

  test("the ss1 block of libFnDeclIf emits `export async function check` awaiting `inner`", async () => {
    const u = await compileShape("libFnDeclIfText", HIGH_A.libFnDeclIf);
    const libJs = readFileSync(join(u.outDir, "lib.server.js"), "utf8");
    const ss1 = libJs.slice(libJs.indexOf("ss1: module value exports"));
    expect(ss1).toContain("export async function check(");
    expect(ss1).toMatch(/!await inner\(p, h\)/);
  }, T);

  // A lib helper route inference places on the server is an `async` in-process peer
  // there, so an export calling it awaits it (r6 shipped `return dbl(dbl(x))` against
  // the async peer: `quad(1)` was NaN).
  test("an export calling a server-placed sync helper awaits the peer: quad(1) == 4", async () => {
    const u = await compileShape("libPeerHelper", {
      lib: lib(`function dbl(x) { return x * 2 }\n  export function quad(x) { return dbl(dbl(x)) }`),
      imports: `import { quad } from "./lib.scrml"\n  import { verifyPassword } from "scrml:auth"`,
      body: `if (quad(1) != 4) { return "bad" }\n    if (!verifyPassword(pass, row.pw)) { return "REJECTED" }\n    return "WELCOME"`,
    });
    expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
    expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
  }, T);
});

describe("S465 r7 HIGH-B — a program-bound scheduler name is not the global scheduler", () => {
  for (const [name, spec] of Object.entries(HIGH_B)) {
    test(`${name}: fails closed at compile time (was a wrong password accepted)`, async () => {
      const u = await compileShape(name, spec);
      expect(u.errors.length).toBeGreaterThan(0);
      expect(u.errors.join("\n")).toMatch(/E-ASYNC-(FN-ESCAPES-AS-VALUE|STDLIB-IN-SYNC-CALLBACK)/);
    }, T);
  }
  for (const [name, spec] of Object.entries(HIGH_B_RUN)) {
    test(`${name}: wrong → REJECTED, right → WELCOME`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
    }, T);
  }
  test("structural: every scheduler reader asks the one predicate", () => {
    const src = (f) => readFileSync(join(import.meta.dir, "../../src/codegen", f), "utf8");
    expect(src("fn-valued-bindings.ts")).not.toMatch(/const SCHEDULERS = /);
    expect(src("local-async-fns.ts")).not.toMatch(/export const BOUND_CALLEE_MARK/);
    expect(src("emit-expr.ts")).not.toMatch(/KNOWN_DISCARD_HOF\.has\(node\.callee\.name\)/);
    expect(src("emit-library-shared.ts")).not.toMatch(/KNOWN_DISCARD_HOF\.has\(callee\.name\)/);
    expect(src("js-async-analysis.ts")).not.toMatch(/KNOWN_DISCARD_HOF\.has\(node\.callee\.name\)/);
  });
});

describe("S465 r7 MED-D — function values with `)` / `=>` in a default read from the tree (executed)", () => {
  for (const [name, [spec, right]] of Object.entries(MED_D)) {
    test(`${name}: runs (right → ${right})`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify(right) });
    }, T);
  }
});

describe("S465 r7 HIGH-A — the per-emitter fixpoints are gone (structural)", () => {
  test("only file-async-fns.ts / emit-library-shared.ts call computeAsyncFnNames among the SERVER emitters", () => {
    const src = (f) => readFileSync(join(import.meta.dir, "../../src/codegen", f), "utf8");
    expect(src("index.ts")).not.toMatch(/computeAsyncFnNames\(/);
    expect(src("emit-server.ts")).not.toMatch(/asyncFnNames = computeAsyncFnNames\(/);
    expect(src("emit-tool.ts")).not.toMatch(/export function collectAsyncFnNamesFromFile/);
    expect(src("scheduling.ts")).not.toMatch(/_asyncLocalBindings/);
  });
});
