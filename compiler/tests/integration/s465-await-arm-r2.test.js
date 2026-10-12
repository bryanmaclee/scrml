/**
 * S465 fix round 2 (P0 SECURITY) — a SERVER arm body is read by the
 * function-top-level statement parser and emitted from that tree; a body the
 * parser refuses is a COMPILE ERROR, never the raw-token lowering (which never
 * awaits — a pending Promise is truthy, so a wrong password was accepted).
 *
 * Round 1 routed server arm bodies through the structured emitters, but when
 * the arm reader refused a body every caller silently KEPT the raw-token path:
 * a C-style `for (let i = 0; …)` anywhere in an arm shipped every async call in
 * that arm un-awaited. Round 2:
 *   (a) fail closed — on the server both arm readers (codegen/arm-structure.ts)
 *       return a tree for every non-empty body; a refused body is a compile
 *       error with the code the statement gets at function top level;
 *   (b) parser parity — the reader IS the function-body parser and accepts the
 *       two forms the front-end carries with a hatch by design: a C-style `for`
 *       declaration init and a bare `{ … }` block statement. Loop labels
 *       (`outer: for … continue outer`, SPEC §49.2.2) are emitted on `for`.
 *
 * Every route case is EXECUTED: compiled, its server bundle imported under bun
 * with a real bun:sqlite database, driven over a Request (wrong password →
 * REJECTED, right → WELCOME).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

const LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;

const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";

// Legal shapes — each written once per async callee `H` (the imported helper
// `check`, suffix Imp; a direct `scrml:auth` `verifyPassword`, suffix Std).
const SHAPES = {
  // C-style `for` in a statement arm (the PA-reproduced fail-open shape).
  cforStmt: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> {
        for (let i = 0; i < 1; i++) { r = "loop" }
        if (${H}(pass, row.pw)) { r = "WELCOME" } else { r = "REJECTED" }
      }
      else :> { r = "NONE" }
    }
    return r`,
  // C-style `for` whose body holds the call.
  cforBody: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { for (let i = 0; i < 1; i = i + 1) { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
      else :> { r = "NONE" }
    }
    return r`,
  // C-style `for` whose INIT holds the call (the declaration is read, not re-tokenised).
  cforInit: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { for (let ok = ${H}(pass, row.pw), i = 0; i < 1; i++) { if (ok) { r = "WELCOME" } } }
      else :> { r = "NONE" }
    }
    return r`,
  // value IIFE (`return match …`) with a C-style `for` in the block arm.
  cforValue: (H) => `
    const k: string = "a"
    return match (k) {
      "a" :> {
        let ok = false
        for (let i = 0; i < 1; i++) { ok = ${H}(pass, row.pw) }
        ok ? "WELCOME" : "REJECTED"
      }
      else :> "NONE"
    }`,
  // number-alternation arm.
  cforNum: (H) => `
    let r = "REJECTED"
    const n: number = 1
    match (n) {
      1 | 2 :> { for (let i = 0; i < 1; i++) { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
      else :> { r = "NONE" }
    }
    return r`,
  // §18.19 multi-scrutinee arm.
  cforMulti: (H) => `
    let r = "REJECTED"
    const a: string = "a"
    const b: string = "b"
    match (a, b) {
      ("a", "b") :> { for (let i = 0; i < 1; i++) { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
      _ :> { r = "NONE" }
    }
    return r`,
  // `else` arm.
  cforElse: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "z" :> { r = "NONE" }
      else :> { for (let i = 0; i < 1; i++) { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
    }
    return r`,
  // C-style `for` with a two-declarator init.
  cforTwoDecl: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { for (let i = 0, j = 1; i < j; i++) { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
      else :> { r = "NONE" }
    }
    return r`,
  // a nested bare block `{ { … } }` in an arm.
  nestedBlock: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
      else :> { r = "NONE" }
    }
    return r`,
  // a labelled loop (§49.2.2) in an arm.
  labelLoop: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> {
        outer: for (const i of [1, 2]) {
          for (const j of [1, 2]) {
            if (j == 2) { continue outer }
            if (${H}(pass, row.pw)) { r = "WELCOME" }
          }
        }
      }
      else :> { r = "NONE" }
    }
    return r`,
  // a labelled loop at function TOP LEVEL (the same defect: the label was dropped).
  labelLoopTop: (H) => `
    let r = "REJECTED"
    outer: for (const i of [1, 2]) {
      for (const j of [1, 2]) {
        if (j == 2) { continue outer }
        if (${H}(pass, row.pw)) { r = "WELCOME" }
      }
    }
    return r`,
  // a `!{}` handler arm with a C-style `for`.
  cforHandler: (H) => `
    let r = "REJECTED"
    const x = ?{\`SELECT nope FROM missing\`}.get() !{ _ :> { for (let i = 0; i < 1; i++) { if (${H}(pass, row.pw)) { r = "WELCOME" } } } }
    return r`,
};

const CALLEES = [["Imp", "check", "an imported .scrml helper"], ["Std", "verifyPassword", "a direct scrml:auth call"]];

const LABELS = {
  cforStmt: "statement arm with a C-style `for` before the check",
  cforBody: "statement arm, check inside a C-style `for` body",
  cforInit: "statement arm, check in a C-style `for` INIT declaration",
  cforValue: "`return match …` value-IIFE block arm with a C-style `for`",
  cforNum: "number-alternation arm `1 | 2 :> { for (…) … }`",
  cforMulti: "§18.19 multi-scrutinee arm with a C-style `for`",
  cforElse: "`else :> { for (…) … }` arm",
  cforTwoDecl: "C-style `for (let i = 0, j = 1; …)` in an arm",
  nestedBlock: "nested bare block `{ { … } }` in an arm",
  labelLoop: "labelled loop `outer: for … continue outer` in an arm",
  labelLoopTop: "labelled loop at function top level",
  cforHandler: "`!{ _ :> { for (…) … } }` handler arm",
};

function appFor(shapeNames) {
  const fns = [];
  const buttons = [];
  for (const shape of shapeNames) {
    for (const [suffix, H] of CALLEES) {
      const fn = shape + suffix;
      fns.push(`  function ${fn}(name: string, pass: string) {\n    ${ROW}${SHAPES[shape](H)}\n  }`);
      buttons.push(`<button onclick={ @out = ${fn}("bob", "x") }>${fn}</button>`);
    }
  }
  return `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  import { verifyPassword } from "scrml:auth"
${fns.join("\n")}
}
<out> = ""
${buttons.join("\n")}
<p>\${@out}</p>
</program>
`;
}

const dirs = [];

function freshDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `s465-r2-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), LIB);
  return dir;
}

// One compile unit per shape: some shapes do not compile at the base (a dropped
// loop label is E-CODEGEN-INVALID-LOGIC), so each shape's base failure is its own
// (for the others, behavioural — a wrong password accepted).
const UNITS = Object.keys(SHAPES).map((shape) => [shape, [shape]]);
const units = new Map(); // unit name -> { errors, serverJs, mod, routes }

async function compileUnit(name, shapeNames) {
  const dir = freshDir(name);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, appFor(shapeNames));
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [await hashPassword("right-password")]);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => `${e.code}: ${String(e.message).slice(0, 160)}`);
  const serverJsPath = join(outDir, "app.server.js");
  if (errors.length > 0 || !existsSync(serverJsPath)) return { errors };
  const serverJs = await Bun.file(serverJsPath).text();
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const routes = new Map();
  for (const r of mod.routes) {
    const m = /__ri_route_([A-Za-z]+)_\d+$/.exec(r.path);
    if (m) routes.set(m[1], r.path);
  }
  return { errors, serverJs, mod, routes };
}

beforeAll(async () => {
  for (const [name, shapeNames] of UNITS) units.set(name, await compileUnit(name, shapeNames));
}, EXECUTED_DB_TIMEOUT_MS * 3);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function call(unitName, fn, pass) {
  const unit = units.get(unitName);
  expect(unit.errors).toEqual([]);
  const path = unit.routes.get(fn);
  expect(path).toBeDefined();
  const res = await unit.mod.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ name: "bob", pass }),
  }));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

describe("S465 r2 — server arm bodies the r1 reader refused are read and awaited (executed)", () => {
  for (const [unitName, shapeNames] of UNITS) {
    for (const shape of shapeNames) {
      for (const [suffix, H, calleeLabel] of CALLEES) {
        const fn = shape + suffix;
        test(`${LABELS[shape]} — ${calleeLabel} (\`${H}\`): a WRONG password is rejected`, async () => {
          expect(await call(unitName, fn, "wrong-password")).toBe("REJECTED");
        }, EXECUTED_DB_TIMEOUT_MS);
        test(`${LABELS[shape]} — ${calleeLabel} (\`${H}\`): the right password is accepted`, async () => {
          expect(await call(unitName, fn, "right-password")).toBe("WELCOME");
        }, EXECUTED_DB_TIMEOUT_MS);
      }
    }
  }

  test("no arm body is re-emitted as raw token text in any server bundle of this file", () => {
    for (const [unitName] of UNITS) {
      const unit = units.get(unitName);
      expect(unit.errors).toEqual([]);
      const js = unit.serverJs;
      // The token rewriters' spaced shapes: a call (`check ( pass , row . pw )`)
      // and a C-style header (`for ( let i = 0 ; …`).
      expect(js).not.toMatch(/\b(check|verifyPassword) \( pass , row \. pw \)/);
      expect(js).not.toMatch(/for \( let /);
      // Every call of the helper / the stdlib export is awaited.
      expect(js.match(/(?<!await |function |\.)\b(check|verifyPassword)\(pass/g) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// (a) A server arm body the parser refuses is a COMPILE ERROR, with the code the
// same statement gets at function top level.
// ---------------------------------------------------------------------------

function compileOne(tag, body) {
  const dir = freshDir(tag);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  function f(name: string, pass: string) {
    ${ROW}
    ${body}
  }
}
<out> = ""
<button onclick={ @out = f("bob", "x") }>f</button>
<p>\${@out}</p>
</program>
`);
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  return (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
}

const inArm = (stmt) => `let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { ${stmt} }
      else :> { r = "NONE" }
    }
    return r`;
const atTop = (stmt) => `let r = "REJECTED"
    const k: string = "a"
    ${stmt}
    return r`;

const REFUSED = [
  ["switch", `switch (k) { case "a": if (check(pass, row.pw)) { r = "WELCOME" } break; default: r = "d" }`, "E-SWITCH-FORBIDDEN"],
  ["try", `try { if (check(pass, row.pw)) { r = "WELCOME" } } finally { r = r }`, "E-TRY-NOT-IN-SCRML"],
  ["throw", `if (check(pass, row.pw)) { throw r }`, "E-THROW-NOT-IN-SCRML"],
  ["for-in", `for (const f in { a: 1 }) { if (check(pass, row.pw)) { r = "WELCOME" } }`, "E-CTRL-011"],
  ["multi-declarator let", `let a = 1, b = 2\n        if (check(pass, row.pw)) { r = "WELCOME" + a + b }`, "E-STMT-MISSING-SEMICOLON"],
];

describe("S465 r2 — a server arm body the parser refuses is a compile error (fail closed)", () => {
  for (const [label, stmt, code] of REFUSED) {
    test(`\`${label}\` in a server arm is ${code} — the code it gets at function top level`, () => {
      expect(compileOne(`top-${label.replace(/\W+/g, "")}`, atTop(stmt))).toContain(code);
      expect(compileOne(`arm-${label.replace(/\W+/g, "")}`, inArm(stmt))).toContain(code);
    }, EXECUTED_DB_TIMEOUT_MS);
  }

  test("`switch` in a `!{}` handler arm is E-SWITCH-FORBIDDEN", () => {
    const body = `let r = "REJECTED"
    const x = ?{\`SELECT nope FROM missing\`}.get() !{ _ :> { switch (r) { case "a": r = "b" } } }
    return r`;
    expect(compileOne("handler-switch", body)).toContain("E-SWITCH-FORBIDDEN");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("`switch` in a `return match` value arm is E-SWITCH-FORBIDDEN", () => {
    const body = `const k: string = "a"
    return match (k) {
      "a" :> {
        let r = "x"
        switch (k) { case "a": r = "b" }
        r
      }
      else :> "NONE"
    }`;
    expect(compileOne("value-switch", body)).toContain("E-SWITCH-FORBIDDEN");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a labelled plain block `blk: { … }` in a server arm is a compile error (E-STMT-UNEXPECTED-TOKEN), as it is one at top level", () => {
    expect(compileOne("top-label-block", atTop(`blk: { r = "x" }`))).toContain("E-SCOPE-001");
    expect(compileOne("arm-label-block", inArm(`blk: { if (check(pass, row.pw)) { r = "WELCOME" } }`))).toContain("E-STMT-UNEXPECTED-TOKEN");
  }, EXECUTED_DB_TIMEOUT_MS);
});
