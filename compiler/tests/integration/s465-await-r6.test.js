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
 *
 * S467 round 10 — dpa-023 F4 (§13.9.6, ruling:user-voice-scrml.md S467 "b it is"): a waiting
 * function is bound ONLY by a `function` declaration. The HIGH-1 shapes bind one with `const`
 * (`const inner = (p, h) => verifyPassword(p, h)`), so each is now E-ASYNC-FN-ESCAPES-AS-VALUE
 * (F4_REFUSED below); the same programs with `function inner(p, h) { return … }` run
 * (MIGRATED). The other r6 roots (regex, variants, `for` headers) are unchanged.
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
// S467 r10 — each binds a waiting function with `const`: E-ASYNC-FN-ESCAPES-AS-VALUE (§13.9.6).
const F4_REFUSED = {
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
};

// The same programs with every waiting function declared by `function` (the §13.9.6 rewrite).
const MIGRATED = {
  libLambda: { lib: lib(`function inner(p, h) { return verifyPassword(p, h) }
  export function check(p, h) { return inner(p, h) }`), body: G },
  libBlockLambda: { lib: lib(`function inner(p, h) {
    return verifyPassword(p, h)
  }
  export function check(p, h) { return inner(p, h) }`), body: G },
  libLambdaChain: { lib: lib(`function a(p, h) { return verifyPassword(p, h) }
  function b(p, h) { return a(p, h) }
  export function check(p, h) { return b(p, h) }`), body: G },
  libNegationInside: { lib: lib(`function bad(p, h) { return !verifyPassword(p, h) }
  export function check(p, h) { return !bad(p, h) }`), body: G },
  inFile: { top: `function w(a, b) { return check(a, b) }`, body: W },
  inFileStdlib: { imports: `import { verifyPassword } from "scrml:auth"`, top: `function w(a, b) { return verifyPassword(a, b) }`, body: W },
  inFileTernary: { top: `function w(a, b) { return check(a, b) ? 1 : 0 }`, body: `if (w(pass, row.pw) == 0) { return "REJECTED" }
    return "WELCOME"` },
  // (inFileInSomeCallback's migration — `function w` called only inside a `.some` callback — is
  // not placed on the server: g-fn-reached-only-through-lambda-not-on-server-s466, a
  // ReferenceError 500 that fails closed. Not listed here until that gap closes.)
};

const RUN = {
  syncLambdaStaysSync: { top: `const dbl = (x) => x * 2`, body: `if (dbl(2) != 4) { return "bad" }
    ${G}` },
  // MED-1 — a regex literal holds no call (refused on dcbbd64d7 as "it calls `/[A-Z]`").
  regexInFnDecl: { top: `function isCode(s) { return /[A-Z](\\d)/.test(s) }`, body: `if (!isCode("A1")) { return "bad" }
    ${G}` },
  regexInline: { body: `if (!/b(o)b/.test(name)) { return "bad" }
    ${G}` },
  regexReplace: { body: `const z = name.replace(/o(b)/g, "x")
    if (z != "bx") { return "bad:" + z }
    ${G}` },
  regexDecl: { body: `const re = /b(o)b/
    if (!re.test(name)) { return "bad" }
    ${G}` },
  regexInArrow: { body: `const t = (s) => /\\d(\\d)/.test(s)
    if (!t("12")) { return "bad" }
    ${G}` },
  regexLookahead: { body: `if (!/[0-9](?=b)/.test("1b")) { return "bad" }
    ${G}` },
  // LOW-2 — named-argument variants lowered from the tree (a `(` in a string, a call).
  namedVariantStringParen: { top: `type R:enum = { Found(name:string), Missing }`, body: `const r = .Found(name: "a (b)")
    ${G}` },
  namedVariantCall: { top: `type R:enum = { Found(name:string), Missing }`, body: `const r = .Found(name: name.trim())
    ${G}` },
  namedVariantAwaitedArg: { imports: `import { check, of } from "./lib.scrml"`, top: `type R:enum = { Found(name:string), Missing }`,
    lib: lib(`export function check(p, h) { return verifyPassword(p, h) }
  export function of(p, h) { return verifyPassword(p, h) }`),
    body: `const r = [of(pass, row.pw), .Found(name: "c")]
    if (!r[0]) { return "REJECTED" }
    return "WELCOME"` },
  namedVariantMixed: { top: `type P:enum = { Pair(a:int, b:int), None }`, body: `const r = .Pair(1, b: 2)
    ${G}` },
  // MED-2 — a string-literal match in a function value still lowers.
  stringMatchInArrow: { body: `const lab = (k) => { return match k { "a" :> "A"
      else :> "Z" } }
    if (lab("a") != "A") { return "badstr" }
    ${G}` },
  // LOW-3 — a C-style \`for\` header comma list (ruling S464 cfor-comma "b").
  forHeaderCommaUpdate: { body: `let s = 0
    for (let i = 0, j = 3; i < j; i++, j--) { s = s + 1 }
    if (s != 2) { return "badfor:" + s }
    ${G}` },
  forHeaderCommaInit: { body: `let s = 0
    let i = 0
    let j = 0
    for (i = 0, j = 4; i < j; i++, j--) { s = s + 1 }
    if (s != 2) { return "badfor:" + s }
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
  // MED-2 — a variant match in a function value has no typed subject (was `undefined`
  // at exit 0 on dcbbd64d7: the variant object compared to a string, `n` unbound).
  variantMatchInArrow: [{ top: `type R:enum = { Found(name:string), Missing }`, body: `const label = (r) => { return match r { .Found(n) :> "found " + n
      .Missing :> "missing" } }
    const l = label(R.Found(name))
    if (l != "found bob") { return "badmatch:" + l }
    ${G}` }, "E-TYPE-025"],
  variantMatchStmtInArrow: [{ top: `type R:enum = { Found(name:string), Missing }`, body: `const label = (r) => { let s = "none"
      match r { .Found(n) :> { s = "found " + n }
        .Missing :> { s = "missing" } }
      return s }
    const l = label(R.Found(name))
    if (l != "found bob") { return "badmatch:" + l }
    ${G}` }, "E-TYPE-025"],
  // LOW-3 — a comma in a VALUE position stays refused.
  valueComma: [{ body: `let a = 0
    const v = (a = 2, a + 1)
    ${G}` }, "E-CODEGEN-INVALID-LOGIC"],
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

describe("S465 r6 — server shapes that must run (HIGH-1 bindings, MED-1 regex, LOW-2 variants, LOW-3 for headers; executed)", () => {
  for (const [name, spec] of Object.entries(RUN)) {
    test(`${name}: wrong → REJECTED, right → WELCOME`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
    }, T);
  }
});

describe("S465 r6 HIGH-1 shapes under S467 r10 (§13.9.6): a `const` holding a waiting function is refused", () => {
  for (const [name, spec] of Object.entries(F4_REFUSED)) {
    test(`${name}: E-ASYNC-FN-ESCAPES-AS-VALUE`, async () => {
      const u = await compileShape(name, spec);
      expect(u.errors.map((e) => e.split(":")[0])).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
      expect(u.mod).toBeUndefined();
    }, T);
  }
});

describe("S465 r6 HIGH-1 — the migrated (`function`-declared) forms run (executed)", () => {
  for (const [name, spec] of Object.entries(MIGRATED)) {
    test(`${name}: wrong → REJECTED, right → WELCOME`, async () => {
      const u = await compileShape(name, spec);
      expect(await callF(u, "wrong-password")).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
      expect(await callF(u, "right-password")).toEqual({ status: 200, body: JSON.stringify("WELCOME") });
    }, T);
  }
});

describe("S465 r6 — server shapes that must be compile errors (HIGH-1 escapes, MED-2, LOW-3)", () => {
  for (const [name, [spec, code]] of Object.entries(REFUSE)) {
    test(`${name}: ${code}`, async () => {
      const u = await compileShape(name, spec);
      expect(u.errors.map((e) => e.split(":")[0])).toContain(code);
    }, T);
  }
});

describe("S465 r6 LOW-1 / LOW-3 — client function bodies", () => {
  const clientCompile = (body) => {
    const dir = mkdtempSync(join(tmpdir(), "s465-r6-client-"));
    dirs.push(dir);
    writeFileSync(join(dir, "app.scrml"), `<program>
\${
  <out> = ""
  function h() {
    ${body}
  }
}
<button onclick=h()>go</button>
<p>\${@out}</p>
</program>
`);
    const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: false, gather: true, log: () => {} });
    let clientJs = "";
    for (const o of r.outputs?.values() ?? []) if (o?.clientJs) clientJs += o.clientJs;
    return { codes: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code), clientJs };
  };
  test("a `?{` inside a string literal in a client function is text (was E-CG-006)", () => {
    const r = clientCompile("const s = \"?{`SELECT pw FROM users`}\"\n    @out = s");
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain("\"?{`SELECT pw FROM users`}\"");
  });
  test("a C-style `for` header comma list compiles on the client", () => {
    const r = clientCompile("let s = 0\n    for (let i = 0, j = 3; i < j; i++, j--) { s = s + 1 }\n    @out = String(s)");
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toMatch(/i\+\+, j--/);
  });
  // HIGH-1, client half — the client does not colour a function-valued binding: a client
  // use of an async-coloured one fails closed (it would test a Promise: always "Y").
  // S466 r7 (MED-C): the client COLOURED the binding. S467 r10 (§13.9.6): the binding itself is
  // refused; the `function`-declared form is awaited.
  const clientH1 = (decl) => {
    const dir = mkdtempSync(join(tmpdir(), "s465-r6-clienth1-"));
    dirs.push(dir);
    writeFileSync(join(dir, "app.scrml"), `<program db="./app.db">
\${
  server function isOk(n) { return n == 1 }
  ${decl}
  <out> = ""
  function h() {
    @out = w(2) ? "Y" : "N"
  }
}
<button onclick=h()>go</button>
<p>\${@out}</p>
</program>
`);
    const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: false, gather: true, log: () => {} });
    let clientJs = "";
    for (const o of r.outputs?.values() ?? []) if (o?.clientJs) clientJs += o.clientJs;
    return { codes: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code), clientJs };
  };
  test("client: a `const` holding a waiting function is E-ASYNC-FN-ESCAPES-AS-VALUE (S467 r10)", () => {
    expect(clientH1("const w = (n) => isOk(n)").codes).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  });
  test("client code calling a `function`-declared async helper awaits it", () => {
    const r = clientH1("function w(n) { return isOk(n) }");
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toMatch(/await _scrml_w_\d+\(2\)/);
  });
  test("a client parameter named like an async binding is not a use of it", () => {
    const dir = mkdtempSync(join(tmpdir(), "s465-r6-clientshadow-"));
    dirs.push(dir);
    writeFileSync(join(dir, "app.scrml"), `<program db="./app.db">
\${
  server function isOk(n) { return n == 1 }
  function w(n) { return isOk(n) }
  <out> = ""
  function h() {
    const g = (w) => w + 1
    @out = String(g(1))
  }
}
<button onclick=h()>go</button>
<p>\${@out}</p>
</program>
`);
    const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: false, gather: true, log: () => {} });
    expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
  });
  test("a comma in a client VALUE position is refused", () => {
    const r = clientCompile("let a = 0\n    const v = (a = 2, a + 1)\n    @out = String(v)");
    expect(r.codes).toContain("E-CODEGEN-INVALID-LOGIC");
  });
});
