/**
 * S465 fix round 1 (P0 SECURITY) — SPEC §13.2: a server function "MAY be called
 * directly (the compiler awaits the call)". Every case below is EXECUTED: the
 * program is compiled, its server bundle imported under bun with a real
 * bun:sqlite database, and each route driven over a Request (wrong password →
 * REJECTED, right password → WELCOME).
 *
 * The defect: several arm forms reach codegen with their body carried as TEXT —
 * a literal `match` arm (`"a" :> { … }`), an inline arm's result, a `!{}`
 * handler arm — and the emitters re-lowered that text through the token
 * rewriters, which never consult the await classifier. A Promise-returning call
 * there (an async helper imported from another `.scrml` module, or a direct
 * `scrml:auth` `verifyPassword`) shipped BARE: `if ( check ( pass , row . pw ) )`
 * tested a pending — always truthy — Promise, so every password was accepted.
 *
 * The fix (codegen/arm-structure.ts): on the server the arm text is PARSED with
 * the compiler's own statement / expression parsers and emitted through the
 * normal emitters, so the classifier sees those calls like any other.
 *
 * The browser half (finding 3): a CPS wrapper's client continuation lowers with
 * the async facts of an async client fn body, and those facts now travel into
 * control-flow conditions, so `.filter` / `.some` callbacks reaching an async
 * import take the `_scrml_filterAsync` / `_scrml_someAsync` lowering instead of
 * testing a pending Promise.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

const LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;

const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";

// Each arm shape, written once per async callee `H`: the imported helper
// (`check`, suffix Imp) and a direct `scrml:auth` call (`verifyPassword`, Std).
const SHAPES = {
  stmtArm: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { if (${H}(pass, row.pw)) { r = "WELCOME" } }
      else :> { r = "NONE" }
    }
    return r`,
  boundArm: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> {
        const ok = ${H}(pass, row.pw)
        if (ok) { r = "WELCOME" }
      }
      else :> { r = "NONE" }
    }
    return r`,
  exprArm: (H) => `
    const k: string = "a"
    const r = match (k) {
      "a" :> ${H}(pass, row.pw) ? "WELCOME" : "REJECTED"
      else :> "NONE"
    }
    return r`,
  elseArm: (H) => `
    const k: string = "a"
    const r = match (k) {
      "z" :> "NONE"
      else :> ${H}(pass, row.pw) ? "WELCOME" : "REJECTED"
    }
    return r`,
  nestedIfArm: (H) => `
    let r = "REJECTED"
    const k: string = "a"
    match (k) {
      "a" :> { if (pass.length > 0) { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
      else :> { r = "NONE" }
    }
    return r`,
  // An alternation of NUMBER literals — also a raw-text arm.
  numArm: (H) => `
    let r = "REJECTED"
    const n: number = 1
    match (n) {
      1 | 2 :> { if (${H}(pass, row.pw)) { r = "WELCOME" } }
      else :> { r = "NONE" }
    }
    return r`,
  // `return match …` — the value-IIFE route, expression and block arm.
  retMatch: (H) => `
    const k: string = "a"
    return match (k) {
      "a" :> ${H}(pass, row.pw) ? "WELCOME" : "REJECTED"
      else :> "NONE"
    }`,
  retMatchBlock: (H) => `
    const k: string = "a"
    return match (k) {
      "a" :> {
        const ok = ${H}(pass, row.pw)
        ok ? "WELCOME" : "REJECTED"
      }
      else :> "NONE"
    }`,
  // §18.19 multi-scrutinee: statement, declaration (expression + block), return.
  multiStmt: (H) => `
    let r = "REJECTED"
    const a: string = "a"
    const b: string = "b"
    match (a, b) {
      ("a", "b") :> { if (${H}(pass, row.pw)) { r = "WELCOME" } }
      _ :> { r = "NONE" }
    }
    return r`,
  multiDecl: (H) => `
    const a: string = "a"
    const b: string = "b"
    const r = match (a, b) {
      ("a", "b") :> ${H}(pass, row.pw) ? "WELCOME" : "REJECTED"
      _ :> "NONE"
    }
    return r`,
  multiDeclBlock: (H) => `
    const a: string = "a"
    const b: string = "b"
    const r = match (a, b) {
      ("a", "b") :> {
        const ok = ${H}(pass, row.pw)
        ok ? "WELCOME" : "REJECTED"
      }
      _ :> "NONE"
    }
    return r`,
  multiRet: (H) => `
    const a: string = "a"
    const b: string = "b"
    return match (a, b) {
      ("a", "b") :> {
        const ok = ${H}(pass, row.pw)
        ok ? "WELCOME" : "REJECTED"
      }
      _ :> "NONE"
    }`,
  handlerValue: (H) => `
    const x = ?{\`SELECT nope FROM missing\`}.get() !{ _ :> ${H}(pass, row.pw) }
    return x ? "WELCOME" : "REJECTED"`,
  // Guard on the fix itself: an EMPTY braced handler is an empty BLOCK (the
  // binding takes `null`), never the object value `{}` (truthy) — so this shape
  // answers REJECTED for any password. Checked on its own below.
  handlerEmpty: () => `
    const x = ?{\`SELECT nope FROM missing\`}.get() !{ _ :> {} }
    return x ? "WELCOME" : "REJECTED"`,
  // A one-line `!{}` STATEMENT arm. At the base it did not even compile — the
  // token rewrite produced `_scrml_result = if ( … )` (E-CODEGEN-INVALID-LOGIC) —
  // so it is its own compile unit, keeping the other shapes' failures behavioural.
  handlerStmt: (H) => `
    let r = "REJECTED"
    const x = ?{\`SELECT nope FROM missing\`}.get() !{ _ :> { if (${H}(pass, row.pw)) { r = "WELCOME" } } }
    return r`,
};

const CALLEES = [["Imp", "check", "an imported .scrml helper"], ["Std", "verifyPassword", "a direct scrml:auth call"]];

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

const UNITS = [
  ["arms", ["stmtArm", "boundArm", "exprArm", "elseArm", "nestedIfArm", "numArm", "retMatch", "retMatchBlock", "multiStmt", "multiDecl", "multiDeclBlock", "multiRet", "handlerValue"]],
  ["handler-stmt", ["handlerStmt"]],
];

const dirs = [];
const units = new Map(); // unit name -> { mod, serverJs, routes }

async function compileUnit(unit, shapeNames) {
  const dir = mkdtempSync(join(tmpdir(), `s465-arms-${unit}-`));
  dirs.push(dir);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(dir, "lib.scrml"), LIB);
  const file = join(dir, "app.scrml");
  writeFileSync(file, appFor(shapeNames));
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [await hashPassword("right-password")]);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
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
  for (const [unit, shapeNames] of UNITS) units.set(unit, await compileUnit(unit, shapeNames));
  units.set("handler-empty", await compileUnit("handler-empty", ["handlerEmpty"]));
}, EXECUTED_DB_TIMEOUT_MS * 3);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function call(unit, fn, pass) {
  const u = units.get(unit);
  expect(u.errors).toEqual([]);
  const path = u.routes.get(fn);
  expect(path).toBeDefined();
  const res = await u.mod.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ name: "bob", pass }),
  }));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

const LABELS = {
  stmtArm: "statement `match` arm `\"a\" :> { if (H(…)) { … } }`",
  boundArm: "bound arm `\"a\" :> { const ok = H(…) … }`",
  exprArm: "match-EXPRESSION arm `\"a\" :> H(…) ? … : …`",
  elseArm: "`else :> H(…) ? … : …` arm",
  nestedIfArm: "nested `if` inside a block arm",
  numArm: "number-alternation arm `1 | 2 :> { if (H(…)) … }`",
  retMatch: "`return match …` expression arm",
  retMatchBlock: "`return match …` block arm with a value tail",
  multiStmt: "§18.19 multi-scrutinee statement arm",
  multiDecl: "§18.19 multi-scrutinee declaration expression arm",
  multiDeclBlock: "§18.19 multi-scrutinee declaration block arm",
  multiRet: "§18.19 multi-scrutinee `return match` block arm",
  handlerValue: "`!{ _ :> H(…) }` value arm",
  handlerStmt: "`!{ _ :> { if (H(…)) { … } } }` statement arm",
};

describe("S465 r1 — a Promise-returning call in a server arm body is awaited (executed)", () => {
  for (const [unit, shapeNames] of UNITS) {
    for (const shape of shapeNames) {
      for (const [suffix, H, calleeLabel] of CALLEES) {
        const fn = shape + suffix;
        test(`${LABELS[shape]} — ${calleeLabel} (\`${H}\`): a WRONG password is rejected`, async () => {
          expect(await call(unit, fn, "wrong-password")).toBe("REJECTED");
        }, EXECUTED_DB_TIMEOUT_MS);
        test(`${LABELS[shape]} — ${calleeLabel} (\`${H}\`): the right password is accepted`, async () => {
          expect(await call(unit, fn, "right-password")).toBe("WELCOME");
        }, EXECUTED_DB_TIMEOUT_MS);
      }
    }
  }

  test("an empty braced `!{ _ :> {} }` handler is an empty block (binds null), not the value `{}`", async () => {
    expect(await call("handler-empty", "handlerEmptyImp", "right-password")).toBe("REJECTED");
    expect(units.get("handler-empty").serverJs).not.toMatch(/_scrml__scrml_result_\d+ = \{\};/);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("no arm body is re-emitted as raw token text in the server bundle", () => {
    for (const [unit] of UNITS) {
      const js = units.get(unit).serverJs;
      // The token rewriters' spaced call shape (`check ( pass , row . pw )`).
      expect(js).not.toMatch(/\b(check|verifyPassword) \( pass , row \. pw \)/);
      // Every call of the helper / the stdlib export is awaited.
      expect(js.match(/(?<!await |function |\.)\b(check|verifyPassword)\(pass/g) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Finding 3 — the CPS continuation (browser): `.filter` / `.some` callbacks that
// reach the imported async helper.
// ---------------------------------------------------------------------------

const CPS_APP = `<program db="./app.db">
\${ import { check } from "./lib.scrml" }
<out> = ""
<seen> = ""
<cnt> = 0
function filt(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  @cnt = [pass].filter(p => check(p, @out.pw)).length
  if (@cnt > 0) { @seen = "WELCOME" } else { @seen = "REJECTED" }
}
function someIf(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if ([pass].some(p => check(p, @out.pw))) { @seen = "WELCOME" } else { @seen = "REJECTED" }
}
<button id="filt" onclick={ filt("wrong-password") }>filt</button>
<button id="someIf" onclick={ someIf("wrong-password") }>someIf</button>
<p id="seen">\${@seen}</p>
</program>
`;

// The same callbacks in an ORDINARY async client fn (no CPS split): the `if`
// condition lost the async facts one hop into the control-flow emitter.
const CLIENT_APP = `<program>
\${ import { check } from "./lib.scrml" }
<seen> = ""
function someIf(pass: string) {
  if ([pass].some(p => check(p, "h"))) { @seen = "WELCOME" } else { @seen = "REJECTED" }
}
function whileSome(pass: string) {
  let n = 0
  while (n < 1 && [pass].some(p => check(p, "h"))) { n = n + 1 }
  if (n > 0) { @seen = "WELCOME" } else { @seen = "REJECTED" }
}
<button id="someIf" onclick={ someIf("wrong-password") }>someIf</button>
<button id="whileSome" onclick={ whileSome("wrong-password") }>whileSome</button>
<p id="seen">\${@seen}</p>
</program>
`;

// Executed in happy-dom as the page loads it: the runtime, `lib.client.js`, then
// `app.client.js`. Server routes answer from a stub fetch keyed by source fn name
// (the CPS server half returns the row; `check` answers the password test).
async function runClient(appSrc, button, checkAnswer) {
  const d = mkdtempSync(join(tmpdir(), "s465-arms-cps-"));
  try {
    writeFileSync(join(d, "lib.scrml"), LIB);
    const file = join(d, "app.scrml");
    writeFileSync(file, appSrc);
    const result = compileScrml({ inputFiles: [file], write: false, outputDir: join(d, "dist"), log: () => {} });
    expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    const app = result.outputs.get(file);
    const lib = result.outputs.get(join(d, "lib.scrml"));
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    const g = globalThis;
    const RealResponse = g.Response;
    g.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      const m = /__ri_route_([A-Za-z]+)_\d+/.exec(String(url));
      const body = m && m[1] === "check" ? checkAnswer : { name: "bob", pw: "h" };
      return new RealResponse(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const bodyHtml = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(app.html) ?? [null, app.html])[1];
    g.document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    (0, eval)("(function () {\n" + SCRML_RUNTIME + "\n" + (lib?.clientJs ?? "") + "\n" + app.clientJs + "\n})();");
    g.document.dispatchEvent(new g.Event("DOMContentLoaded", { bubbles: true }));
    g.document.querySelector("#" + button).click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    return { seen: g.document.querySelector("#seen").textContent.trim(), clientJs: app.clientJs };
  } finally {
    rmSync(d, { recursive: true, force: true });
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  }
}

describe("S465 r1 — an async import in a .filter / .some callback is lowered, not tested as a Promise (happy-dom)", () => {
  const CASES = [
    ["CPS continuation", CPS_APP, "filt", "_scrml_filterAsync"],
    ["CPS continuation", CPS_APP, "someIf", "_scrml_someAsync"],
    ["async client fn", CLIENT_APP, "someIf", "_scrml_someAsync"],
    ["async client fn", CLIENT_APP, "whileSome", "_scrml_someAsync"],
  ];
  for (const [where, src, button, combinator] of CASES) {
    test(`${where} \`${button}\`: the helper answers false → REJECTED (via ${combinator})`, async () => {
      const r = await runClient(src, button, false);
      expect(r.clientJs).toContain(combinator);
      expect(r.seen).toBe("REJECTED");
    }, EXECUTED_DB_TIMEOUT_MS);
    test(`${where} \`${button}\`: the helper answers true → WELCOME`, async () => {
      expect((await runClient(src, button, true)).seen).toBe("WELCOME");
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

// The same facts reach a NESTED body: a call to an async client peer inside an
// `if` was emitted bare (fire-and-forget), so the next statement read the cell
// before the peer had written it (corpus: examples/08-chat, gauntlet-r10-rails-blog).
const NESTED_APP = `<program db="./app.db">
<x> = "init"
<seen> = ""
function fetchName() {
  return ?{\`SELECT name FROM users WHERE name = 'bob'\`}.get()
}
function load() {
  const r = fetchName()
  @x = r.name
}
function go(flag: boolean) {
  if (flag) { load() }
  @seen = "after=" + @x
}
<button id="go" onclick={ go(true) }>go</button>
<p id="seen">\${@seen}</p>
</program>
`;

describe("S465 r1 — an async client peer called inside an `if` body is awaited (happy-dom)", () => {
  test("the statement after the `if` sees the peer's write", async () => {
    const r = await runClient(NESTED_APP, "go", false);
    expect(r.clientJs).toMatch(/await _scrml_load_\d+\(\)/);
    expect(r.seen).toBe("after=bob");
  }, EXECUTED_DB_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Finding 4— the fail-closed refusal of an async USER export in a sync callback
// keeps its code and names the user module (not "stdlib").
// ---------------------------------------------------------------------------

describe("S465 r1 — E-ASYNC-STDLIB-IN-SYNC-CALLBACK names a user-module callee's module", () => {
  test("`const inner = (p) => check(p, h)` on the server is refused, naming ./lib.scrml", () => {
    const d = mkdtempSync(join(tmpdir(), "s465-arms-msg-"));
    try {
      writeFileSync(join(d, "lib.scrml"), LIB);
      const file = join(d, "app.scrml");
      writeFileSync(file, `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  function arrow(name: string, pass: string) {
    ${ROW}
    const inner = (p) => check(p, row.pw)
    return inner(pass) ? "WELCOME" : "REJECTED"
  }
}
<out> = ""
<button onclick={ @out = arrow("bob", "x") }>1</button>
<p>\${@out}</p>
</program>
`);
      const result = compileScrml({ inputFiles: [file], write: false, outputDir: join(d, "dist"), log: () => {} });
      const errs = (result.errors ?? []).filter((e) => e.code === "E-ASYNC-STDLIB-IN-SYNC-CALLBACK");
      expect(errs.length).toBeGreaterThan(0);
      expect(errs[0].message).toContain("user module `./lib.scrml`");
      expect(errs[0].message).toContain("not a standard-library function");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
