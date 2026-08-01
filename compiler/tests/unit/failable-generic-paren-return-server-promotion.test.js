// ---------------------------------------------------------------------------
// Failable GENERIC / PAREN / UNION-return server fn is promoted
// (g-failable-bare-return-type-generic-paren-not-consumed, S310 — the LOW
//  follow-up to the GH #228 `! T[]` fix, PR #333/S309)
// ---------------------------------------------------------------------------
//
// The GH #228 fix taught the bare/arrow `! Type` return-type parse
// (ast-builder.js) to consume a trailing `[]` array suffix. But the type name
// itself was still read as a SINGLE IDENT: a generic (`! Map<string, int>`), a
// paren/union (`! (A | B)`, `! A | B`), or their array (`! Map<…>[]`) left the
// `<…>` / `(…)` / `| B` tail unconsumed. That tail then dangled before the `{`,
// the body-brace check failed, and the function parsed with an EMPTY body —
// exactly the GH #228 mechanism, via a more complex type: empty body ⟹
// route-inference never saw the `?{}` SQL ⟹ the fn was NOT server-escalated ⟹
// its query leaked to the client (E-CG-006) and its value-position call got no
// auto-await.
//
// The FIX: consume the FULL error type via a depth-tracked consumer (`<>` `()`
// `[]`, stopping at a fn-decl-head delimiter) — the same shape the `:` / `->`
// RETURN-type consumer already uses — while keeping `errorType` = the base type
// NAME (parity with #333: `! string[]` → "string").
//
// Error types are normatively enums, so `! Map<…>` / `! (A|B)` is itself a
// semantic oddity (hence LOW) — but the parse must not silently drop the body.
//
// Coverage:
//   parse-half  — the fn parses with a POPULATED body + the expected errorType
//   codegen-half — server-promoted, no client SQL leak, no E-CG-006
//   regression  — plain `! MyError`, `! -> MyError`, and the #333 `! string[]`
//                 keep their base-name errorType and populated body.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// --- parse-half harness (AST inspection) -----------------------------------
function findFunctionDecl(ast, name) {
  if (!ast || !Array.isArray(ast.nodes)) return null;
  const stack = [...ast.nodes];
  while (stack.length > 0) {
    const n = stack.shift();
    if (!n || typeof n !== "object") continue;
    if (n.kind === "function-decl" && n.name === name) return n;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}
// Parse a `function`/`fn` head with a two-statement body; return the decl node.
function parseHead(head) {
  const src = `<program>\n\${\n${head} {\n  const x = 1\n  return x\n}\n}\n</program>\n`;
  const bs = splitBlocks("test.scrml", src);
  const tab = buildAST(bs, null);
  return findFunctionDecl(tab.ast, "loader");
}
// Parse a whole `${ }` logic block; return { count of function-decls, ast }.
function parseBlock(body) {
  const src = `<program>\n\${\n${body}\n}\n</program>\n`;
  const bs = splitBlocks("test.scrml", src);
  const tab = buildAST(bs, null);
  const names = [];
  const stack = Array.isArray(tab.ast?.nodes) ? [...tab.ast.nodes] : [];
  while (stack.length) {
    const n = stack.shift();
    if (!n || typeof n !== "object") continue;
    if (n.kind === "function-decl") names.push(n.name);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return { fnNames: names, findFn: (nm) => findFunctionDecl(tab.ast, nm) };
}

// --- codegen-half harness (mirrors the #333 test) --------------------------
const TMP = mkdtempSync(join(tmpdir(), "fgprsp-"));
function compile(src) {
  const d = join(TMP, Math.random().toString(36).slice(2));
  mkdirSync(d, { recursive: true });
  const p = join(d, "app.scrml");
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: true, outputDir: join(d, "out") });
  const g = (f) => (existsSync(join(d, "out", f)) ? readFileSync(join(d, "out", f), "utf8") : "");
  return { errors: r.errors ?? [], server: g("app.server.js"), client: g("app.client.js") };
}
const APP = (retType, sqlMethod, cell) => `<program>
<db src="notes.db" tables="notes">
\${
  type Note:struct = { id: int, body: string }
  type LoadError:enum = { QueryFailed(reason: string) }
  <r>: string = ""
  <rr>: string[] = []
  function loader() ! ${retType} { const x = ?{\`SELECT body FROM notes\`}.${sqlMethod}(); return x }
  function refresh() { @${cell} = loader() !{ | e :> { return } } }
}
<page><button onclick=refresh()>go</button></page>
</db>
</program>
`;
const codes = (r) => r.errors.map((e) => e.code);
const loaderInServer = (r) => /function _scrml_handler_loader/.test(r.server);
const sqlInClient = (r) => /_scrml_sql/.test(r.client);

// ===========================================================================
// parse-half — the compound-type head parses with a POPULATED body
// ===========================================================================
describe("failable generic/paren/union head parses with a non-empty body", () => {
  test("bare generic `! Map<string, int>` — body populated, errorType = base name", () => {
    const fn = parseHead("function loader() ! Map<string, int>");
    expect(fn).not.toBeNull();
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.canFail).toBe(true);
    expect(fn.errorType).toBe("Map");
  });

  test("generic array `! Map<string, int>[]` — body populated", () => {
    const fn = parseHead("function loader() ! Map<string, int>[]");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("Map");
  });

  test("nested generic array `! Map<string, Note[]>[]` — body populated", () => {
    const fn = parseHead("function loader() ! Map<string, Note[]>[]");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("Map");
  });

  test("nested generic `! Map<string, List<Note>>` — `>>` lexed as one token, body populated + next decl survives", () => {
    // The lexer merges a run of `>` into a single `>>` token; the angle-balance
    // must count bracket CHARACTERS or it over-runs to EOF (S310 S239 re-review).
    const { fnNames, findFn } = parseBlock(
      "function a() ! Map<string, List<Note>> {\n  const x = 1\n  return x\n}\nfunction b() { return 2 }",
    );
    expect(fnNames).toContain("a");
    expect(fnNames).toContain("b");
    expect(findFn("a").body.length).toBeGreaterThan(0);
    expect(findFn("a").errorType).toBe("Map");
  });

  test("nested generic array `! Map<string, List<Note>>[]` — `>>[]` handled", () => {
    const { findFn } = parseBlock(
      "function a() ! Map<string, List<Note>>[] {\n  const x = 1\n  return x\n}\nfunction b() { return 2 }",
    );
    expect(findFn("a").body.length).toBeGreaterThan(0);
    expect(findFn("b").body.length).toBeGreaterThan(0);
  });

  test("bare union `! A | B` — body populated, errorType = leading atom", () => {
    const fn = parseHead("function loader() ! A | B");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("A");
  });

  test("paren/union `! (A | B)` — body populated (errorType anonymous)", () => {
    const fn = parseHead("function loader() ! (A | B)");
    expect(fn).not.toBeNull();
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.canFail).toBe(true);
  });

  test("arrow generic `! -> Map<string, int>` — body populated", () => {
    const fn = parseHead("function loader() ! -> Map<string, int>");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("Map");
  });

  test("`fn` short-form arrow generic `! -> Map<string, int>` — body populated", () => {
    const fn = parseHead("fn loader() ! -> Map<string, int>");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("Map");
  });
});

// ===========================================================================
// codegen-half — the compound-type failable fn is server-promoted, no leak
// ===========================================================================
describe("failable generic/paren/union-return server fn is promoted, no SQL leak", () => {
  test("bare generic `! Map<…>` — promoted, no client SQL leak, no E-CG-006", () => {
    const r = compile(APP("Map<string, int>", "one", "r"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("generic array `! Map<…>[]` — promoted, no E-CG-006", () => {
    const r = compile(APP("Map<string, int>[]", "all", "rr"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("paren/union `! (LoadError | Note)` — promoted, no E-CG-006", () => {
    const r = compile(APP("(LoadError | Note)", "one", "r"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });

  test("bare union `! LoadError | Note` — promoted, no E-CG-006", () => {
    const r = compile(APP("LoadError | Note", "one", "r"));
    expect(codes(r)).not.toContain("E-CG-006");
    expect(loaderInServer(r)).toBe(true);
    expect(sqlInClient(r)).toBe(false);
  });
});

// ===========================================================================
// regression — the plain forms + the #333 `! T[]` fix are unchanged
// ===========================================================================
describe("compound-type fix does not disturb the plain forms", () => {
  test("plain `! MyError` still parses with base-name errorType + body", () => {
    const fn = parseHead("function loader() ! MyError");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("MyError");
  });

  test("arrow `! -> MyError` still parses with base-name errorType + body", () => {
    const fn = parseHead("function loader() ! -> MyError");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("MyError");
  });

  test("the #333 `! string[]` array form keeps errorType = \"string\"", () => {
    const fn = parseHead("function loader() ! string[]");
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("string");
  });

  test("`! MyError route=\"/x\"` does NOT swallow route as the error type", () => {
    const fn = parseHead('function loader() ! MyError route="/x"');
    expect(fn.body.length).toBeGreaterThan(0);
    expect(fn.errorType).toBe("MyError");
    expect(fn.route).toBe("/x");
  });
});

// ===========================================================================
// BOUNDED consumer — a BODY-LESS failable fn must NOT swallow the following
// declaration (S310 S239 adversarial finding — the error-type consumer must be
// a self-delimiting TYPE expression, not a "consume until fn-head token" reader)
// ===========================================================================
describe("body-less failable fn does not swallow the following declaration", () => {
  test("arrow `fn a() ! -> Err` (no body) then `fn b() {…}` → BOTH parse", () => {
    const { fnNames, findFn } = parseBlock(
      "server fn a() ! -> Err\nserver fn b() { return 1 }",
    );
    expect(fnNames).toContain("a");
    expect(fnNames).toContain("b");
    expect(findFn("b").body.length).toBeGreaterThan(0);   // b's body not stolen by a
  });

  test("generic `function a() ! Map<int,int>` (no body) then `function b() {…}` → BOTH", () => {
    const { fnNames } = parseBlock(
      "function a() ! Map<int, int>\nfunction b() { return 1 }",
    );
    expect(fnNames).toContain("a");
    expect(fnNames).toContain("b");
  });

  test("paren `function a() ! (A | B)` (no body) then `function b() {…}` → BOTH", () => {
    const { fnNames } = parseBlock(
      "function a() ! (A | B)\nfunction b() { return 1 }",
    );
    expect(fnNames).toContain("a");
    expect(fnNames).toContain("b");
  });

  test("body-less failable fn then loose statements → statements not swallowed", () => {
    const { findFn } = parseBlock(
      "server fn a() ! -> Err\nconst z = 5\nreturn z",
    );
    // `a` parses body-less; the `const z` / `return z` remain separable siblings.
    const a = findFn("a");
    expect(a).not.toBeNull();
    expect(a.body.length).toBe(0);
  });
});
