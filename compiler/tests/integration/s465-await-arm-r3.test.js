/**
 * S465 fix round 3 (P0 SECURITY) — three ways a server statement still did not
 * run as written after round 2, each EXECUTED here.
 *
 *   1. A second bare `{ … }` block was silently dropped, guard and all
 *      (`{ r = "WELCOME" }⏎{ if (!check(…)) { r = "REJECTED" } }` → a wrong
 *      password was WELCOME). Root: the statement collector (ast-builder
 *      `collectExpr`) did not end a statement at a line break before `{`, so
 *      `{A}⏎{B}` (and `let a = 1⏎{B}`) became ONE statement whose expression
 *      view kept only the prefix; the arm reader then stripped the "outer" braces
 *      of `{A}⏎{B}` without checking they pair. Fixed at each layer:
 *        (a) a `{` on a later line after a value starts a new statement (SPEC
 *            §7.2.2 "Terms": a bare block is a statement list);
 *        (b) the probe-function reader refuses unless the probe source built to
 *            exactly the probe function;
 *        (c) a block's braces are stripped only when a depth scan proves they
 *            pair (compiler/src/brace-pair.ts);
 *        (d) an expression read by DROPPING trailing content never reaches server
 *            output — E-STMT-UNEXPECTED-TOKEN.
 *   2. A comma sequence (`(0, check(…))`) shipped on the server as TEXT, never
 *      awaited (a pending Promise is truthy → WELCOME). scrml has no comma
 *      operator (SPEC §40.8 S441 bullet, §4.18.2): on the server it is E-CODEGEN-INVALID-LOGIC, as is
 *      any escape-hatch expression that can hold an un-awaited call. The hatch's
 *      text was also the WHOLE enclosing expression (`(0, "x") + "y"` → "xyy").
 *   3. A C-style `for` declared loop variable reassigned in the body was emitted
 *      as `const i = …` (TDZ ReferenceError / wrong values).
 *
 * Route cases are compiled, their server bundle imported under bun with a real
 * bun:sqlite database and driven over a Request (wrong → REJECTED, right →
 * WELCOME), at function top level AND in a server `match` arm.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { emitExpr } from "../../src/codegen/emit-expr.ts";

const EXECUTED_DB_TIMEOUT_MS = 30_000;
const DROPPED_WARNING = "trailing content would be silently dropped";

const LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;

const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";

const inArm = (body) => `
    const k: string = "a"
    match (k) {
      "a" :> ${body}
      else :> { r = "NONE" }
    }`;

// Each shape is a function body; `H` is the async callee (the imported helper
// `check`, or `scrml:auth`'s `verifyPassword` directly).
const SHAPES = {
  // Finding 1 — a second bare block that is a GUARD.
  armTwoBlocks: (H) => `
    let r = "REJECTED"${inArm(`{ { r = "WELCOME" }
        { if (!${H}(pass, row.pw)) { r = "REJECTED" } } }`)}
    return r`,
  armThreeBlocks: (H) => `
    let r = "REJECTED"${inArm(`{ { r = "WELCOME" }
        { r = "WELCOME" }
        { if (!${H}(pass, row.pw)) { r = "REJECTED" } } }`)}
    return r`,
  topTwoBlocks: (H) => `
    let r = "REJECTED"
    if (true) { r = "x" }
    { r = "WELCOME" }
    { if (!${H}(pass, row.pw)) { r = "REJECTED" } }
    return r`,
  // Finding 4 — a bare block after a statement line (arm + top level).
  armBlockAfterLet: (H) => `
    let r = "REJECTED"${inArm(`{ let a = "WEL"
        { if (${H}(pass, row.pw)) { r = a + "COME" } } }`)}
    return r`,
  topBlockAfterLet: (H) => `
    let r = "REJECTED"
    let a = "WEL"
    { if (${H}(pass, row.pw)) { r = a + "COME" } }
    return r`,
  armBlockAfterCall: (H) => `
    let r = "REJECTED"${inArm(`{ r = r + ""
        { if (${H}(pass, row.pw)) { r = "WELCOME" } } }`)}
    return r`,
  // Finding 3 — a C-for loop variable reassigned in the body; the guard sits
  // past the reassignment.
  armForReassign: (H) => `
    let r = "REJECTED"${inArm(`{ for (let i = 0; i < 10; i++) { i = i + 4
          if (i == 4 && ${H}(pass, row.pw)) { r = "WELCOME" } } }`)}
    return r`,
  topForReassign: (H) => `
    let r = "REJECTED"
    for (let i = 0; i < 10; i++) { i = i + 4
      if (i == 4 && ${H}(pass, row.pw)) { r = "WELCOME" } }
    return r`,
  // S468: the arm body is now read by the statement checks, so `{ i = 5 }` (a
  // write never read) is E-MU-001 here exactly as at function top level; the
  // loop variable is read in the body instead. The shape still asks the same
  // question: is the call in the C-style `for` UPDATE clause awaited?
  armForUpdateCall: (H) => `
    let r = "REJECTED"${inArm(`{ let ok = false
        for (let i = 0; i < 1; ok = ${H}(pass, row.pw)) { i = i + 5 }
        if (ok) { r = "WELCOME" } }`)}
    return r`,
};

const CALLEES = [
  ["Imp", "check", "imported helper"],
  ["Std", "verifyPassword", "scrml:auth"],
];

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
  const dir = mkdtempSync(join(tmpdir(), `s465-r3-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), LIB);
  return dir;
}

/** Compile with console.warn captured: the "silently dropped" warnings are returned. */
function compileCapturing(file, outDir) {
  const warnings = [];
  const ow = console.warn;
  console.warn = (...a) => { warnings.push(a.map(String).join(" ")); };
  let result;
  try { result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} }); }
  finally { console.warn = ow; }
  return { result, dropped: warnings.filter((w) => w.includes(DROPPED_WARNING)) };
}

const units = new Map();
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
  const { result, dropped } = compileCapturing(file, outDir);
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => `${e.code}: ${String(e.message).slice(0, 160)}`);
  const serverJsPath = join(outDir, "app.server.js");
  if (errors.length > 0 || !existsSync(serverJsPath)) return { errors, dropped };
  const serverJs = await Bun.file(serverJsPath).text();
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const routes = new Map();
  for (const r of mod.routes) {
    const m = /__ri_route_([A-Za-z]+)_\d+$/.exec(r.path);
    if (m) routes.set(m[1], r.path);
  }
  return { errors, dropped, serverJs, mod, routes };
}

const UNITS = Object.keys(SHAPES).map((shape) => [shape, [shape]]);

beforeAll(async () => {
  for (const [name, shapeNames] of UNITS) units.set(name, await compileUnit(name, shapeNames));
}, EXECUTED_DB_TIMEOUT_MS * 4);

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

describe("S465 r3 — bare blocks and C-for loop variables run as written on the server (executed)", () => {
  for (const [unitName, shapeNames] of UNITS) {
    for (const shape of shapeNames) {
      for (const [suffix, H, label] of CALLEES) {
        const fn = shape + suffix;
        test(`${shape} — ${label} (\`${H}\`): a WRONG password is rejected`, async () => {
          expect(await call(unitName, fn, "wrong-password")).toBe("REJECTED");
        }, EXECUTED_DB_TIMEOUT_MS);
        test(`${shape} — ${label} (\`${H}\`): the right password is accepted`, async () => {
          expect(await call(unitName, fn, "right-password")).toBe("WELCOME");
        }, EXECUTED_DB_TIMEOUT_MS);
      }
    }
  }

  test("no server bundle carries raw token text, and no compile warned that content would be dropped", () => {
    for (const [unitName] of UNITS) {
      const unit = units.get(unitName);
      expect(unit.errors).toEqual([]);
      expect(unit.dropped).toEqual([]);
      const js = unit.serverJs;
      expect(js).not.toMatch(/\b(check|verifyPassword) \( pass , row \. pw \)/);
      expect(js).not.toMatch(/for \( let /);
      expect(js.match(/(?<!await |function |\.)\b(check|verifyPassword)\(pass/g) ?? []).toEqual([]);
      // A reassigned loop variable is never re-declared in the body.
      expect(js).not.toMatch(/const i = i \+ 4/);
    }
  });
});

// ---------------------------------------------------------------------------
// Executed VALUE tests (no async): bare blocks and loop variables.
// ---------------------------------------------------------------------------

// The `?{}` read (ROW) makes `f` a server function.
function usersDb(dir) {
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.close();
}

function compileValue(tag, body) {
  const dir = freshDir(tag);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, `<program db="./app.db">
\${
  function f(name: string) {
    ${ROW}
    ${body}
  }
}
<out> = ""
<button onclick={ @out = f("bob") }>f</button>
<p>\${@out}</p>
</program>
`);
  usersDb(dir);
  const { result, dropped } = compileCapturing(file, outDir);
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  return { errors, dropped, serverJsPath: join(outDir, "app.server.js") };
}

async function runValue(tag, body) {
  const { errors, dropped, serverJsPath } = compileValue(tag, body);
  expect(errors).toEqual([]);
  expect(dropped).toEqual([]);
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const route = mod.routes.find((r) => /__ri_route_f_\d+$/.test(r.path));
  expect(route).toBeDefined();
  const res = await mod.fetch(new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ name: "bob" }),
  }));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

const arm = (body) => `let r = "R"
    const k: string = "a"
    match (k) {
      "a" :> ${body}
      else :> { r = "n" }
    }
    return r`;
const top = (body) => `let r = "R"
    ${body}
    return r`;

const VALUES = [
  ["two bare blocks in an arm", arm(`{ { r = r + "1" }
        { r = r + "2" } }`), "R12"],
  ["a bare block after a value line in an arm", arm(`{ let a = "1"
        { r = r + a } }`), "R1"],
  ["a bare block after a call line in an arm", arm(`{ r = r + "x"
        { r = r + "y" } }`), "Rxy"],
  ["a bare block after `let` at top level", top(`{ r = r + "B" }`), "RB"],
  ["a bare block after `if` at top level", `let r = "R"
    if (name == "bob") { r = r + "I" }
    { r = r + "B" }
    return r`, "RIB"],
  ["nested bare blocks at top level", `let r = "R"
    if (true) { r = r + "I" }
    { { r = r + "N" } }
    return r`, "RIN"],
  ["C-for variable reassigned in the body — arm", arm(`{ for (let i = 0; i < 10; i++) { i = i + 4
          r = r + i } }`), "R49"],
  ["C-for variable reassigned in the body — top level", top(`for (let i = 0; i < 10; i++) { i = i + 4
      r = r + i }`), "R49"],
  ["C-for variable reassigned under `if` — arm", arm(`{ for (let i = 0; i < 10; i++) { if (i == 0) { i = 7 }
          r = r + i } }`), "R789"],
  ["C-for variable reassigned under `if` — top level", top(`for (let i = 0; i < 10; i++) { if (i == 0) { i = 7 }
      r = r + i }`), "R789"],
  ["C-for with two declarators, both reassigned", top(`for (let i = 0, j = 0; i < 3; i++) { j = j + 1
      i = i + j
      r = r + i + j }`), "R1142"],
];

describe("S465 r3 — executed values: bare blocks run, loop variables are reassigned", () => {
  for (const [label, body, want] of VALUES) {
    test(`${label} → ${JSON.stringify(want)}`, async () => {
      expect(await runValue(`v-${label.replace(/\W+/g, "").slice(0, 24)}`, body)).toBe(want);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

// ---------------------------------------------------------------------------
// Compile errors (fail closed).
// ---------------------------------------------------------------------------

const vArm = (val) => `const k: string = "a"
    const r = match (k) {
      "a" :> ${val}
      else :> "n"
    }
    return r`;

const REFUSED = [
  // Finding 2 — comma sequences: arm value, arm block, top level; async and sync.
  ["sequence holding an async call — arm value", vArm(`(0, check(name, "h")) ? "WELCOME" : "REJECTED"`), "E-CODEGEN-INVALID-LOGIC"],
  ["sequence holding an async call — arm block", arm(`{ const ok = (0, check(name, "h"))
        if (ok) { r = "WELCOME" } }`), "E-CODEGEN-INVALID-LOGIC"],
  ["sequence holding an async call — top level", top(`const ok = (0, check(name, "h"))
    if (ok) { r = "WELCOME" }`), "E-CODEGEN-INVALID-LOGIC"],
  ["sequence in a ternary test — arm value", vArm(`(0, name == "zz") ? "A" : "B"`), "E-CODEGEN-INVALID-LOGIC"],
  ["sequence operand of `+` — arm value", vArm(`(0, "x") + "y"`), "E-CODEGEN-INVALID-LOGIC"],
  ["sequence in an arm statement", arm(`{ r = (0, name == "zz") ? "A" : "B" }`), "E-CODEGEN-INVALID-LOGIC"],
  ["sequence — top level", `const r = (0, name == "zz") ? "A" : "B"
    return r`, "E-CODEGEN-INVALID-LOGIC"],
  // Finding 1(d) — an expression read by dropping the next line's statement.
  ["a dropped `!(…)` guard line", `let r = "WELCOME"
    let ok = 1
    !(r = check(name, "h") ? "WELCOME" : "REJECTED")
    return r`, "E-STMT-UNEXPECTED-TOKEN"],
  ["a dropped string statement", `let r = "R"
    let s = "a"
    "b"
    return r`, "E-STMT-UNEXPECTED-TOKEN"],
];

describe("S465 r3 — server expressions that cannot be read structurally are compile errors", () => {
  for (const [label, body, code] of REFUSED) {
    test(`${label} → ${code}`, () => {
      const dir = freshDir(`e-${label.replace(/\W+/g, "").slice(0, 24)}`);
      const outDir = join(dir, "dist");
      mkdirSync(outDir, { recursive: true });
      const file = join(dir, "app.scrml");
      writeFileSync(file, `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  function f(name: string) {
    ${ROW}
    ${body}
  }
}
<out> = ""
<button onclick={ @out = f("bob") }>f</button>
<p>\${@out}</p>
</program>
`);
      usersDb(dir);
      const { result } = compileCapturing(file, outDir);
      const codes = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
      expect(codes).toContain(code);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

// ---------------------------------------------------------------------------
// The escape-hatch text is the node's own text (the "xyy" duplication root).
// ---------------------------------------------------------------------------

describe("S465 r3 — an escape hatch carries its own text, not the enclosing expression's", () => {
  // S465 r6 (ruling S464 cfor-comma "b") — the comma operator is refused in every VALUE
  // position on the client too; the hatch still carries ITS OWN text (the r3 fix), and
  // the client lowering is the refusal placeholder (the compile fails).
  test("`(0, \"x\") + \"y\"` — the sequence hatch is `(0, \"x\")`, refused on the client", () => {
    const node = parseExprToNode(`(0, "x") + "y"`, "t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.left.kind).toBe("escape-hatch");
    expect(node.left.raw.replace(/\s+/g, "")).toBe(`(0,"x")`);
    const js = emitExpr(node, { mode: "client" });
    expect(js).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(js).not.toContain(`"y" + "y"`);
  });

  test("a sequence in a ternary test is refused on the client (its own text, not the ternary's)", () => {
    const node = parseExprToNode(`(0, 1 == 2) ? "A" : "B"`, "t.scrml", 0);
    expect(node.condition.raw.replace(/\s+/g, "")).toBe("(0,1==2)");
    const js = emitExpr(node, { mode: "client" });
    expect(js).toContain("E-CODEGEN-INVALID-LOGIC");
  });
});
