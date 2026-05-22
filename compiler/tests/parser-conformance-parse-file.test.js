// parser-conformance-parse-file.test.js — C1 / M5-swap conformance.
//
// The native-parser `nativeParseFile` assembler (compiler/native-parser/
// parse-file.js) is the FileAST bridge: it turns a scrml source file into the
// live `FileAST` shape (compiler/src/types/ast.ts:1487) every downstream stage
// (NR / RI / AG / CG) consumes — the drop-in analogue of the live pipeline's
// `buildAST` (compiler/src/ast-builder.js ~L11971).
//
// THE CONTRACT — `nativeParseFile(filePath, source)` returns
// `{ filePath, ast: FileAST, errors }` where:
//   - `ast.nodes` is the lowercase ASTNode union, mapped from the native
//     parser's PascalCase BlockKind block-stream;
//   - the six hoisted collections + `hasProgramRoot` come from A3's
//     `collectHoisted`;
//   - `authConfig` / `middlewareConfig` are `null` (PRECG derives them
//     downstream — they are NOT computed in the assembler);
//   - every node + hoisted decl shares ONE id space (the threaded `idGen`);
//   - `errors` carries the native parser's diagnostics + synthesis info
//     diagnostics.
//
// SCOPE NOTE — this is a NATIVE-parser conformance file. It exercises
// `nativeParseFile` directly on curated scrml exemplars; it does not cross-
// check against the live `buildAST` node-for-node (the native block payloads
// are sketch-depth for some kinds — that cross-check is C2's dual-pipeline
// canary). The assertions here are SHAPE + completeness audits.

import { describe, test, expect } from "bun:test";

import { nativeParseFile } from "../native-parser/parse-file.js";

// allIds — collect every numeric `id` reachable in the FileAST: the `nodes`
// tree (recursing markup `children` + logic/meta `body`) plus the hoisted
// declaration collections. Used by the single-id-space assertions.
function allIds(ast) {
  const ids = [];
  function walkNode(n) {
    if (n === undefined || n === null) return;
    if (typeof n.id === "number") ids.push(n.id);
    if (Array.isArray(n.children)) {
      for (const c of n.children) walkNode(c);
    }
    if (Array.isArray(n.body)) {
      for (const s of n.body) walkNode(s);
    }
  }
  for (const node of ast.nodes) walkNode(node);
  const decls = [
    ...ast.imports, ...ast.exports, ...ast.typeDecls,
    ...ast.components, ...ast.machineDecls,
  ];
  for (const d of decls) {
    if (d !== undefined && d !== null && typeof d.id === "number") ids.push(d.id);
  }
  return ids;
}

// =============================================================================
// C1 §1 — the result + FileAST shape.
// =============================================================================
describe("C1 §1 — nativeParseFile result + FileAST shape", () => {
  test("returns { filePath, ast, errors } with the FileAST top-level fields", () => {
    const r = nativeParseFile("app.scrml", "<div>hi</div>");
    expect(r.filePath).toBe("app.scrml");
    expect(Array.isArray(r.errors)).toBe(true);
    const ast = r.ast;
    expect(ast.filePath).toBe("app.scrml");
    expect(Array.isArray(ast.nodes)).toBe(true);
    expect(Array.isArray(ast.imports)).toBe(true);
    expect(Array.isArray(ast.exports)).toBe(true);
    expect(Array.isArray(ast.components)).toBe(true);
    expect(Array.isArray(ast.typeDecls)).toBe(true);
    expect(Array.isArray(ast.machineDecls)).toBe(true);
    expect(Array.isArray(ast.channelDecls)).toBe(true);
    expect(typeof ast.hasProgramRoot).toBe("boolean");
  });

  test("authConfig and middlewareConfig are left null (PRECG derives them)", () => {
    const r = nativeParseFile("app.scrml", "<program><div>x</div></program>");
    expect(r.ast.authConfig).toBe(null);
    expect(r.ast.middlewareConfig).toBe(null);
  });

  test("a non-string source folds to an empty FileAST with no nodes", () => {
    const r = nativeParseFile("app.scrml", undefined);
    expect(r.ast.nodes.length).toBe(0);
    expect(r.ast.imports.length).toBe(0);
    expect(r.ast.hasProgramRoot).toBe(false);
  });

  test("a non-string filePath folds to an empty-string filePath", () => {
    const r = nativeParseFile(undefined, "<div/>");
    expect(r.filePath).toBe("");
    expect(r.ast.filePath).toBe("");
  });
});

// =============================================================================
// C1 §2 — BlockKind -> ASTNode kind mapping.
// =============================================================================
describe("C1 §2 — BlockKind -> ASTNode mapping", () => {
  test("a `<div>` Markup block maps to a `markup` node", () => {
    const r = nativeParseFile("app.scrml", "<div>hello</div>");
    const markup = r.ast.nodes.find(n => n.kind === "markup");
    expect(markup).toBeDefined();
    expect(markup.tag).toBe("div");
    expect(Array.isArray(markup.children)).toBe(true);
    expect(Array.isArray(markup.attrs)).toBe(true);
    expect(typeof markup.selfClosing).toBe("boolean");
    expect(typeof markup.isComponent).toBe("boolean");
  });

  test("free text maps to a `text` node carrying the verbatim slice", () => {
    const r = nativeParseFile("app.scrml", "<div>hello world</div>");
    const markup = r.ast.nodes.find(n => n.kind === "markup");
    const text = markup.children.find(c => c.kind === "text");
    expect(text).toBeDefined();
    expect(text.value).toBe("hello world");
  });

  test("a `// line comment` maps to a `comment` node (verbatim slice)", () => {
    const r = nativeParseFile("app.scrml", "// a remark\n<div/>");
    const comment = r.ast.nodes.find(n => n.kind === "comment");
    expect(comment).toBeDefined();
    expect(comment.value).toContain("a remark");
  });

  test("a `${...}` block maps to a `logic` node", () => {
    const r = nativeParseFile("app.scrml", "${ let x = 1 }");
    const logic = r.ast.nodes.find(n => n.kind === "logic");
    expect(logic).toBeDefined();
    expect(Array.isArray(logic.body)).toBe(true);
  });

  test("a `?{...}` block maps to a `sql` node with query + chainedCalls", () => {
    const r = nativeParseFile("app.scrml", "${ let rows = ?{ select * from t }.all() }");
    // The `?{...}` SQL block parses inside the logic body as an expression;
    // a top-level `?{...}` maps to a `sql` node. Use the top-level form.
    const r2 = nativeParseFile("app.scrml", "?{ select * from users }.all()");
    const sql = r2.ast.nodes.find(n => n.kind === "sql");
    expect(sql).toBeDefined();
    expect(typeof sql.query).toBe("string");
    expect(Array.isArray(sql.chainedCalls)).toBe(true);
  });

  test("a `#{...}` block maps to a `css-inline` node with rules", () => {
    const r = nativeParseFile("app.scrml", "#{ color: red; }");
    const css = r.ast.nodes.find(n => n.kind === "css-inline");
    expect(css).toBeDefined();
    expect(Array.isArray(css.rules)).toBe(true);
  });

  test("a `^{...}` block maps to a `meta` node with body + parentContext", () => {
    const r = nativeParseFile("app.scrml", "^{ let m = 1 }");
    const meta = r.ast.nodes.find(n => n.kind === "meta");
    expect(meta).toBeDefined();
    expect(Array.isArray(meta.body)).toBe(true);
    expect(typeof meta.parentContext).toBe("string");
  });

  test("a `!{...}` block maps to an `error-effect` node with arms", () => {
    const r = nativeParseFile("app.scrml", "!{ | ::NotFound e -> log(e) }");
    const ee = r.ast.nodes.find(n => n.kind === "error-effect");
    expect(ee).toBeDefined();
    expect(Array.isArray(ee.arms)).toBe(true);
  });

  test("isComponent is true for an uppercase-initial tag, false for lowercase", () => {
    const r = nativeParseFile("app.scrml", "<Card/>\n<div/>");
    const card = r.ast.nodes.find(n => n.kind === "markup" && n.tag === "Card");
    const div = r.ast.nodes.find(n => n.kind === "markup" && n.tag === "div");
    expect(card.isComponent).toBe(true);
    expect(div.isComponent).toBe(false);
  });
});

// =============================================================================
// C1 §3 — logic-body statement translation through the A1 bridge.
// =============================================================================
describe("C1 §3 — logic-body translation (A1 bridge)", () => {
  test("a `let` decl in a logic body becomes a `let-decl` LogicStatement", () => {
    const r = nativeParseFile("app.scrml", "${ let count = 0 }");
    const logic = r.ast.nodes.find(n => n.kind === "logic");
    expect(logic.body.length).toBe(1);
    expect(logic.body[0].kind).toBe("let-decl");
  });

  test("a `const` decl becomes a `const-decl` LogicStatement", () => {
    const r = nativeParseFile("app.scrml", "${ const PI = 3 }");
    const logic = r.ast.nodes.find(n => n.kind === "logic");
    expect(logic.body[0].kind).toBe("const-decl");
  });

  test("an `if` statement becomes an `if-stmt` LogicStatement", () => {
    const r = nativeParseFile("app.scrml", "${ if (x) { y() } }");
    const logic = r.ast.nodes.find(n => n.kind === "logic");
    expect(logic.body[0].kind).toBe("if-stmt");
  });

  test("a multi-declarator var-decl fans out to one node per declarator", () => {
    const r = nativeParseFile("app.scrml", "${ let a = 1, b = 2 }");
    const logic = r.ast.nodes.find(n => n.kind === "logic");
    expect(logic.body.length).toBe(2);
    expect(logic.body[0].kind).toBe("let-decl");
    expect(logic.body[1].kind).toBe("let-decl");
  });

  test("a `^{...}` meta body is also translated through A1", () => {
    const r = nativeParseFile("app.scrml", "^{ const META = 9 }");
    const meta = r.ast.nodes.find(n => n.kind === "meta");
    expect(meta.body.length).toBe(1);
    expect(meta.body[0].kind).toBe("const-decl");
  });
});

// =============================================================================
// C1 §4 — hoisted-collection assembly (A3 bridge).
// =============================================================================
describe("C1 §4 — hoisted collections (A3 bridge)", () => {
  test("an `import` in a `${...}` block lands in ast.imports", () => {
    const r = nativeParseFile("app.scrml", '${ import foo from "./bar.scrml" }');
    expect(r.ast.imports.length).toBe(1);
  });

  test("an `export` in a `${...}` block lands in ast.exports", () => {
    const r = nativeParseFile("app.scrml", "${ export const X = 1 }");
    expect(r.ast.exports.length).toBe(1);
  });

  test("a top-level `<program>` sets hasProgramRoot", () => {
    const r = nativeParseFile("app.scrml", "<program><div>x</div></program>");
    expect(r.ast.hasProgramRoot).toBe(true);
  });

  test("no `<program>` — hasProgramRoot is false", () => {
    const r = nativeParseFile("app.scrml", "<div>x</div>");
    expect(r.ast.hasProgramRoot).toBe(false);
  });

  test("a top-level `<channel>` is collected into channelDecls", () => {
    const r = nativeParseFile("app.scrml", "<channel name=chat/>");
    expect(r.ast.channelDecls.length).toBe(1);
  });

  test("a `type` decl in a `${...}` block lands in ast.typeDecls", () => {
    const r = nativeParseFile("app.scrml", "${ type Status : enum = { active, idle } }");
    expect(r.ast.typeDecls.length).toBe(1);
    expect(r.ast.typeDecls[0].kind).toBe("type-decl");
  });

  test("a `const Upper = <markup>` is collected into components", () => {
    const r = nativeParseFile("app.scrml", "${ const Card = <div>card</div> }");
    expect(r.ast.components.length).toBe(1);
    expect(r.ast.components[0].kind).toBe("component-def");
    expect(r.ast.components[0].name).toBe("Card");
  });

  test("a top-level `<engine for=Cart>` is synthesized into machineDecls", () => {
    const r = nativeParseFile("app.scrml", "<engine for=Cart>\n  rule\n</>");
    expect(r.ast.machineDecls.length).toBe(1);
    expect(r.ast.machineDecls[0].kind).toBe("engine-decl");
    expect(r.ast.machineDecls[0].governedType).toBe("Cart");
  });
});

// =============================================================================
// C1 §5 — the single shared id space (one idGen threaded through everything).
// =============================================================================
describe("C1 §5 — single id space", () => {
  test("no duplicate ids across nodes + hoisted decls (markup + logic file)", () => {
    const src = '${ import foo from "./bar.scrml" }\n'
      + "<program>\n"
      + "  <div class=\"x\">hello</div>\n"
      + "  ${ let count = 0\n     const total = count }\n"
      + "</program>";
    const r = nativeParseFile("app.scrml", src);
    const ids = allIds(r.ast);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ids span nodes, translated statements, AND hoisted declarations", () => {
    const src = "${ type T : enum = { a } }\n"
      + "${ const Box = <div>box</div> }\n"
      + "<engine for=Cart>\n  rule\n</>";
    const r = nativeParseFile("app.scrml", src);
    const ids = allIds(r.ast);
    // typeDecls + components + machineDecls each contribute at least one id.
    expect(r.ast.typeDecls.length).toBeGreaterThan(0);
    expect(r.ast.components.length).toBeGreaterThan(0);
    expect(r.ast.machineDecls.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every node id is a positive integer", () => {
    const r = nativeParseFile("app.scrml", "<div>${ let x = 1 }</div>");
    const ids = allIds(r.ast);
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// C1 §6 — error propagation.
// =============================================================================
describe("C1 §6 — error propagation", () => {
  test("a clean parse produces an empty errors array", () => {
    const r = nativeParseFile("app.scrml", "<div>clean</div>");
    expect(r.errors.length).toBe(0);
  });

  test("a stray closer surfaces a native parser diagnostic", () => {
    const r = nativeParseFile("app.scrml", "</div>");
    expect(r.errors.length).toBeGreaterThan(0);
    // The native parser emits a structured { code, message, span } diagnostic.
    expect(typeof r.errors[0].code).toBe("string");
  });

  test("a mismatched closer surfaces a native parser diagnostic", () => {
    const r = nativeParseFile("app.scrml", "<div>x</span>");
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// C1 §7 — full small-file assembly (markup + logic + sql + css + meta).
// =============================================================================
describe("C1 §7 — full small-file assembly", () => {
  const fullFile =
    '${ import db from "./db.scrml" }\n'
    + "^{ const BUILD = 1 }\n"
    + "<program>\n"
    + "  #{ color: blue; }\n"
    + "  <header>Welcome</header>\n"
    + "  ${ let visits = 0 }\n"
    + "  <channel name=live/>\n"
    + "</program>";

  test("the full file assembles without throwing and produces a FileAST", () => {
    const r = nativeParseFile("full.scrml", fullFile);
    expect(r.ast).toBeDefined();
    expect(Array.isArray(r.ast.nodes)).toBe(true);
  });

  test("the full file's hoisted collections are populated", () => {
    const r = nativeParseFile("full.scrml", fullFile);
    expect(r.ast.imports.length).toBe(1);
    expect(r.ast.hasProgramRoot).toBe(true);
    expect(r.ast.channelDecls.length).toBe(1);
  });

  test("the full file's node kinds include markup, logic, and meta", () => {
    const r = nativeParseFile("full.scrml", fullFile);
    const kinds = new Set();
    function collect(n) {
      if (n === undefined || n === null) return;
      kinds.add(n.kind);
      if (Array.isArray(n.children)) {
        for (const c of n.children) collect(c);
      }
    }
    for (const node of r.ast.nodes) collect(node);
    expect(kinds.has("markup")).toBe(true);
    expect(kinds.has("logic")).toBe(true);
    expect(kinds.has("meta")).toBe(true);
  });

  test("the full file's whole FileAST has a single id space", () => {
    const r = nativeParseFile("full.scrml", fullFile);
    const ids = allIds(r.ast);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
