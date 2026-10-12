/**
 * S465 fix round 4 — the remaining server text positions (S239 re-review of 41df4784).
 *
 *   F1 (HIGH) same-line bare blocks after a value line — `let i = 4⏎{ i = 1 } { if
 *      (check(…)) { … } }` — were one bare-expr lowered from TEXT, the call un-awaited
 *      (a Promise: truthy). Now each `{ … }` of the run is its own bare block, read and
 *      lowered from the tree (top level, in `if` / `for` bodies, in `match` arms).
 *   F2 (HIGH) destructuring defaults (`const { a = check(…) } = {}`, `for (const { a =
 *      … } of …)`) were pasted as source text. Now lowered from the builder's parsed
 *      node through emitExpr; a nested server function's parameter default that would
 *      need an `await` is a compile error (a parameter list cannot await).
 *   g-server-text-hatch-unawaited-call-s465 — a tagged template on the server is
 *      lowered from its parts (tag + substitutions read as expressions).
 *   F3 (LOW) the brace-head exception ended with the statement's head body
 *      (`const f = function (q) { return q }⏎{ … }`) and never fires for a
 *      keyword-spelled property (`const t = row.type⏎{ … }`): the next-line block is a
 *      bare block statement again (on the client it was silently dropped).
 *   CLASS — any other server text holding a call is a compile error
 *      (E-CODEGEN-INVALID-LOGIC, codegen/server-text-guard.ts); see also
 *      s465-server-text-guard.test.js.
 *
 * Executed: each shape × {imported `check`, `scrml:auth` `verifyPassword`} ×
 * {wrong password → "REJECTED", right → "WELCOME"} against bun:sqlite.
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
}
`;

const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";

const GUARD = (H) => `{ if (!${H}(pass, row.pw)) { return "REJECTED" } }`;
const inArm = (body) => `
    const k: string = "a"
    match (k) {
      "a" :> { ${body} }
      else :> { return "NONE" }
    }`;

const SHAPES = {
  // F1 — same-line bare blocks.
  sameLineGuardLast: (H) => `
    let i = 4
    { i = 1 } ${GUARD(H)}
    return "WELCOME"`,
  sameLineGuardFirst: (H) => `
    let i = 4
    ${GUARD(H)} { i = 1 }
    return "WELCOME"`,
  sameLineThree: (H) => `
    let i = 4
    { i = 1 } ${GUARD(H)} { i = 2 }
    return "WELCOME"`,
  sameLinePositive: (H) => `
    let i = 4
    { i = 1 } { if (${H}(pass, row.pw)) { return "WELCOME" } }
    return "REJECTED"`,
  sameLineSemicolon: (H) => `
    let i = 4
    { i = 1 }; ${GUARD(H)}
    return "WELCOME"`,
  sameLineInIf: (H) => `
    let i = 4
    if (i == 4) { ${GUARD(H)} { i = 1 } }
    return "WELCOME"`,
  sameLineInFor: (H) => `
    let i = 4
    for (const q of [1]) { ${GUARD(H)} { i = q } }
    return "WELCOME"`,
  sameLineInArm: (H) => `
    let i = 4${inArm(`let j = 1
        { i = 1 } ${GUARD(H)}`)}
    return "WELCOME"`,
  // F2 — destructuring defaults.
  objDefault: (H) => `
    const { ok = ${H}(pass, row.pw) } = {}
    if (ok) { return "WELCOME" }
    return "REJECTED"`,
  arrDefault: (H) => `
    const [ok = ${H}(pass, row.pw)] = []
    if (ok) { return "WELCOME" }
    return "REJECTED"`,
  letObjDefault: (H) => `
    let { ok = ${H}(pass, row.pw) } = {}
    if (ok) { return "WELCOME" }
    return "REJECTED"`,
  nestedDefault: (H) => `
    const { inner: { ok = ${H}(pass, row.pw) } = {} } = {}
    if (ok) { return "WELCOME" }
    return "REJECTED"`,
  renameDefault: (H) => `
    const { v: ok = ${H}(pass, row.pw) } = {}
    if (ok) { return "WELCOME" }
    return "REJECTED"`,
  negatedDefault: (H) => `
    const { ok = ${H}(pass, row.pw) } = {}
    if (!ok) { return "REJECTED" }
    return "WELCOME"`,
  forOfDefault: (H) => `
    let r = "REJECTED"
    for (const { ok = ${H}(pass, row.pw) } of [{}]) { if (ok) { r = "WELCOME" } }
    return r`,
  armDefault: (H) => `${inArm(`const { ok = ${H}(pass, row.pw) } = {}
        if (ok) { return "WELCOME" }`)}
    return "REJECTED"`,
  // The tagged-template hatch.
  taggedTemplate: (H) => `
    const s = String.raw\`a\${${H}(pass, row.pw)}b\`
    if (s == "atrueb") { return "WELCOME" }
    return "REJECTED"`,
  // F3 — the brace-head exception.
  afterFnExpr: (H) => `
    const f = function (q) { return q }
    ${GUARD(H)}
    return "WELCOME"`,
  afterTypeProp: (H) => `
    const t = row.type
    ${GUARD(H)}
    return "WELCOME"`,
  afterMatchProp: (H) => `
    const t = row.match
    ${GUARD(H)}
    return "WELCOME"`,
  armAfterTypeProp: (H) => `${inArm(`const t = row.type
        ${GUARD(H)}`)}
    return "WELCOME"`,
  // The structural lowering the guard takes before refusing: a block-bodied arrow
  // value (statement emitter), and a spread of a capitalised name (parses now).
  blockArrowValue: (H) => `
    const ys = [1, 2].map((x) => { const d = x * 2
      return String(d) })
    if (ys.join(",") == "2,4" && ${H}(pass, row.pw)) { return "WELCOME" }
    return "REJECTED"`,
  spreadCapital: (H) => `
    const s = String.fromCharCode(...Array.from("ok", (c) => c.charCodeAt(0)))
    if (s == "ok" && ${H}(pass, row.pw)) { return "WELCOME" }
    return "REJECTED"`,
};

const CALLEES = [
  ["Imp", "check", "imported helper"],
  ["Std", "verifyPassword", "scrml:auth"],
];

const dirs = [];
function freshDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `s465-r4-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.scrml"), LIB);
  return dir;
}

function program(fns, buttons) {
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

async function usersDb(dir) {
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [await hashPassword("right-password")]);
  db.close();
}

function compile(dir, src) {
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  return { errors, outDir };
}

const units = new Map();
async function compileUnit(shape) {
  const dir = freshDir(shape);
  const fns = [];
  const buttons = [];
  for (const [suffix, H] of CALLEES) {
    const fn = shape + suffix;
    fns.push(`  function ${fn}(name: string, pass: string) {\n    ${ROW}${SHAPES[shape](H)}\n  }`);
    buttons.push(`<button onclick={ @out = ${fn}("bob", "x") }>${fn}</button>`);
  }
  await usersDb(dir);
  const { errors, outDir } = compile(dir, program(fns, buttons));
  const msgs = errors.map((e) => `${e.code}: ${String(e.message).slice(0, 160)}`);
  const serverJsPath = join(outDir, "app.server.js");
  if (msgs.length > 0 || !existsSync(serverJsPath)) return { errors: msgs };
  const serverJs = readFileSync(serverJsPath, "utf8");
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const routes = new Map();
  for (const r of mod.routes) {
    const m = /__ri_route_([A-Za-z]+)_\d+$/.exec(r.path);
    if (m) routes.set(m[1], r.path);
  }
  return { errors: msgs, serverJs, mod, routes };
}

beforeAll(async () => {
  for (const shape of Object.keys(SHAPES)) units.set(shape, await compileUnit(shape));
}, EXECUTED_DB_TIMEOUT_MS * 8);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function call(shape, fn, pass) {
  const unit = units.get(shape);
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

describe("S465 r4 — same-line blocks, destructuring defaults, tagged templates, brace heads (executed)", () => {
  for (const shape of Object.keys(SHAPES)) {
    for (const [suffix, H, label] of CALLEES) {
      const fn = shape + suffix;
      test(`${shape} — ${label} (\`${H}\`): a WRONG password is rejected`, async () => {
        expect(await call(shape, fn, "wrong-password")).toBe("REJECTED");
      }, EXECUTED_DB_TIMEOUT_MS);
      test(`${shape} — ${label} (\`${H}\`): the right password is accepted`, async () => {
        expect(await call(shape, fn, "right-password")).toBe("WELCOME");
      }, EXECUTED_DB_TIMEOUT_MS);
    }
  }

  test("no server bundle carries raw token text or an un-awaited call", () => {
    for (const shape of Object.keys(SHAPES)) {
      const js = units.get(shape).serverJs;
      expect(js).toBeDefined();
      expect(js).not.toMatch(/\b(check|verifyPassword) \( /);
      expect(js).not.toMatch(/row \. pw/);
      expect(js.match(/(?<!await |function |\.)\b(check|verifyPassword)\(pass/g) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Compile errors: server text that holds a call and cannot be read structurally.
// ---------------------------------------------------------------------------

const REFUSED = [
  ["an assignment-destructure hatch holding a call", `let ok = false
    ({ ok = check(pass, row.pw) } = {})
    if (ok) { return "WELCOME" }
    return "REJECTED"`, "E-CODEGEN-INVALID-LOGIC", "cannot be lowered in server code"],
  ["a nested server function's parameter default that must await", `function inner({ ok = check(pass, row.pw) }) { return ok }
    if (inner({})) { return "WELCOME" }
    return "REJECTED"`, "E-CODEGEN-INVALID-LOGIC", "a parameter default cannot await"],
  ["a C-style `for` comma update (no comma operator, §40.8)", `let j = 5
    for (let i = 0; i < 2; i++, j--) { j = j }
    return "WELCOME"`, "E-CODEGEN-INVALID-LOGIC", "§40.8"],
];

describe("S465 r4 — server text holding a call is a compile error", () => {
  for (const [label, body, code, text] of REFUSED) {
    test(`${label} → ${code}`, async () => {
      const dir = freshDir(`e-${label.replace(/\W+/g, "").slice(0, 24)}`);
      await usersDb(dir);
      const { errors } = compile(dir, program(
        [`  function f(name: string, pass: string) {\n    ${ROW}\n    ${body}\n  }`],
        [`<button onclick={ @out = f("bob", "x") }>f</button>`],
      ));
      const hit = errors.find((e) => e.code === code);
      expect(hit).toBeDefined();
      expect(String(hit.message)).toContain(text);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

// ---------------------------------------------------------------------------
// F3 on the client — the next-line block is no longer swallowed (it was dropped).
// ---------------------------------------------------------------------------

describe("S465 r4 — a block after a brace-head statement is its own statement (client)", () => {
  const CASES = [
    ["after a function expression", `const f = function (q) { return q }`],
    ["after a keyword-spelled property", `const t = x.type`],
  ];
  for (const [label, line] of CASES) {
    test(label, async () => {
      const dir = freshDir(`c-${label.replace(/\W+/g, "").slice(0, 20)}`);
      const { errors, outDir } = compile(dir, `<program>
\${
  function g(x) {
    let r = 0
    ${line}
    { r = 5 }
    return r
  }
}
<out> = 0
<button onclick={ @out = g({ type: 1 }) }>g</button>
<p>\${@out}</p>
</program>
`);
      expect(errors).toEqual([]);
      const js = readFileSync(join(outDir, "app.client.js"), "utf8");
      const at = js.indexOf("let r = 0");
      expect(at).toBeGreaterThan(0);
      const body = js.slice(at, js.indexOf("return r", at));
      expect(body).toMatch(/\{\s*r = 5;?\s*\}/);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});
