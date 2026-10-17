/**
 * S467 fix round 9 (S239 review of e4b2c24e4: DO-NOT-LAND) — g-imported-async-server-fn-not-awaited-s465.
 *
 *   HIGH-1 a file-scope binding's init was classified by TOKEN SHAPE: only `function …`,
 *       `x => …` and `(…) => …` got a parsed init, so `export const inner = ((p, h) => …)` and
 *       `= async (p, h) => …` were never coloured async, and a ternary / curried / alias init
 *       was never seen at all. Now every plain value export carries its parsed init
 *       (ast-builder `valueInitExpr`) and codegen/fn-valued-bindings.ts classifies the TREE:
 *       a function literal (any spelling) is the binding's function; any other function value
 *       it can hand out — an expression arm, an alias, a returned function, a later `let`
 *       write — is an escape, coloured with the binding and refused when async (§13.2
 *       E-ASYNC-FN-ESCAPES-AS-VALUE). The PA addendum's client probe (`const chk = flag ? (n)
 *       => isOk(n) : (n) => false`, `if (chk(2))` unawaited) is the same root.
 *   HIGH-2 / MED-1 a value-only `.server.js` imports only names its source module's emitted
 *       `.server.js` exports (api.js `reconcileValueOnlyImports`): an imported enum type or a
 *       markup component no longer makes the whole server bundle unloadable.
 *
 * The executed wrong-password shapes are in security-await-pack (families x1, r9).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { fnValuedBindingsOf } from "../../src/codegen/fn-valued-bindings.ts";
import { appSource, makeTemplateDb } from "./security-await-pack/pack.js";
import { copyFileSync } from "fs";

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function compileFiles(tag, files, entry = "app.scrml") {
  const dir = mkdtempSync(join(tmpdir(), `s467-r9-${tag}-`));
  dirs.push(dir);
  for (const [n, src] of Object.entries(files)) writeFileSync(join(dir, n), src);
  copyFileSync(makeTemplateDb(dir), join(dir, "app.db"));
  const out = join(dir, "dist");
  const r = compileScrml({ inputFiles: [join(dir, entry)], write: true, outputDir: out, log: () => {} });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const read = (n) => (existsSync(join(out, n)) ? readFileSync(join(out, n), "utf8") : null);
  return { errors, read };
}

const clientProbe = (decl) => `<program>
\${ import { verifyPassword } from 'scrml:auth' }
<verdict> = "unset"
server function isOk(n) { return n > 1 }
\${ const flag = true
${decl} }
function go() { if (chk(2)) { @verdict = "y" } }
<p>\${@verdict}</p><button onclick=go()>go</button></program>
`;

describe("S467 r9 — client: a function value handed out by a file-scope binding (PA addendum)", () => {
  test("ternary arms calling a server function: refused, never `if (chk(2))` unawaited", () => {
    const { errors, read } = compileFiles("p2", { "app.scrml": clientProbe("const chk = flag ? (n) => isOk(n) : (n) => false") });
    expect(errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
    expect(read("app.client.js")).toBeNull();
  }, 30_000);

  test("curried arrow returning an async function: refused", () => {
    const { errors } = compileFiles("p4", { "app.scrml": clientProbe("const mk = (a) => (n) => isOk(n)\nconst chk = (n) => true") });
    expect(errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  }, 30_000);

  test("`||` arm: refused", () => {
    const { errors } = compileFiles("or", { "app.scrml": clientProbe("const chk = null || ((n) => isOk(n))") });
    expect(errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  }, 30_000);

  // S467 r10 — dpa-023 F4 (§13.9.6): r9 coloured a parenthesised arrow as the binding's own
  // function; a `const` may no longer hold a waiting function at all.
  test("a parenthesised arrow calling a server function: refused (S467 r10, §13.9.6)", () => {
    const { errors, read } = compileFiles("p3", { "app.scrml": clientProbe("const chk = ((n) => isOk(n))") });
    expect(errors).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
    expect(read("app.client.js")).toBeNull();
  }, 30_000);

  test("a sync ternary of functions still compiles (nothing async to escape)", () => {
    const { errors } = compileFiles("sync", { "app.scrml": clientProbe("const chk = flag ? (n) => n > 1 : (n) => false") });
    expect(errors).toEqual([]);
  }, 30_000);
});

describe("S467 r9 — the classifier reads the parsed init", () => {
  const exp = (name, init) => ({ kind: "export-decl", exportKind: "const", exportedName: name, reExportSource: null, valueInitExpr: parseExprToNode(init, "t", 0) });
  const cst = (name, init, kind = "const-decl") => ({ kind, name, initExpr: parseExprToNode(init, "t", 0) });
  const byName = (stmts) => Object.fromEntries(fnValuedBindingsOf(stmts).map((b) => [b.name, b]));

  test("literal in any spelling is the binding's function; `async` is read off the node", () => {
    const b = byName([exp("a", "((p, h) => vp(p, h))"), exp("b", "async (p, h) => vp(p, h)"), cst("c", "function (p) { return vp(p) }")]);
    expect(b.a.literal).toBe(true);
    expect(b.b.literal).toBe(true);
    expect(b.b.pseudoFn.isAsync).toBe(true);
    expect(b.c.literal).toBe(true);
  });

  test("arms, aliases, returned functions and later writes are escapes", () => {
    const b = byName([
      exp("t", "c ? (p) => vp(p) : (p) => false"),
      exp("al", "vp"),
      exp("cu", "(p) => (h) => vp(p, h)"),
      cst("l", "(p) => true", "let-decl"),
      cst("l", "(p) => vp(p)", "tilde-decl"),
    ]);
    expect(b.t.literal).toBe(false);
    expect(b.t.escapes.length).toBe(2);
    expect(b.al.escapes.map((e) => e.name)).toEqual(["vp"]);
    expect(b.cu.escapes.length).toBe(1);
    expect(b.l.escapes.length).toBe(1);
  });

  test("a plain value is not a function value", () => {
    expect(fnValuedBindingsOf([cst("n", "1"), cst("r", "load()")])).toEqual([]);
  });
});

describe("S467 r9 — a value-only server module imports only emitted server names (MED-1)", () => {
  // S467 r10 — the r9 probes held the async check in `export const inner = (p, h) => …`, which
  // §13.9.6 now refuses; with `export function inner` the lib is no longer value-only (it has a
  // server route), so the value-only module here carries a plain constant the route compares.
  // (The non-value-only twin — an `export function` lib importing an enum type — still imports
  // the never-emitted lib2.server.js: g-server-js-imports-module-without-server-file-s467.)
  const app = appSource({ imports: `import { SECRET } from "./lib.scrml"`, body: `if (pass != SECRET) { return "REJECTED" }\n    return "WELCOME"` });
  test("an imported enum type: no import of the never-emitted lib2.server.js", () => {
    const { errors, read } = compileFiles("enum", {
      "app.scrml": app,
      "lib2.scrml": `\${\n  export type Role:enum = { Admin, User }\n}\n`,
      "lib.scrml": `\${\n  import { Role } from "./lib2.scrml"\n  export const SECRET = "right-password"\n  export const r = (x) => x == Role.Admin\n}\n`,
    });
    expect(errors).toEqual([]);
    const lib = read("lib.server.js");
    expect(lib).toContain("SECRET");
    expect(lib).not.toContain("lib2.server.js");
    expect(read("lib2.server.js")).toBeNull();
  }, 30_000);

  test("an imported markup component: no import of it", () => {
    const { errors, read } = compileFiles("comp", {
      "app.scrml": app,
      "lib2.scrml": `\${\n  export const Badge = <span>hi</span>\n}\n`,
      "lib.scrml": `\${\n  import { Badge } from "./lib2.scrml"\n  export const SECRET = "right-password"\n  export const k = (x) => typeof Badge\n}\n`,
    });
    expect(errors).toEqual([]);
    const lib = read("lib.server.js");
    expect(lib).toContain("SECRET");
    expect(lib).not.toContain("lib2.server.js");
  }, 30_000);
});
