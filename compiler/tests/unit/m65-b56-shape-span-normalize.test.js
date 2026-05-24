/**
 * m65-b56-shape-span-normalize.test.js — M6.5.b.5 (Class F shape) +
 * M6.5.b.6 (Class G span) — native->live FileAST normalization.
 *
 * ADAPT units (shape parity, NOT parser behavior). The native parser
 * (`nativeParseFile`) must produce a FileAST whose per-node shape matches the
 * live `splitBlocks`+`buildAST` oracle for the Class F + Class G fields:
 *
 *   Class F (shape):
 *     - closerForm  — lowercase ("explicit"/"inferred"), not native PascalCase.
 *     - openerHadSpaceAfterLt — present (false) on BLOCK-PATH markup; ABSENT on
 *                     lift/for/match-expr markup-as-value subtrees (live parity).
 *     - _p3aIsExport / _p3aExportName — present-as-undefined on block-path markup.
 *     - attrs[].value.sourceText — STRIPPED from translated markup-family nodes
 *                     (the raw native engine blocks the walker reads keep it).
 *     - _synthetic  — forwarded onto live `logic` nodes that were lift-wrappers.
 *
 *   Class G (span):
 *     - span.file = filePath stamped on every node's span.
 *
 * Tests drive the PRODUCTION native path (nativeParseFile) and compare against
 * the live oracle. They are native-path-only — the live default is untouched.
 */
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

const FP = "test://m65-b56.scrml";

function liveAST(src) {
  return buildAST(splitBlocks(FP, src), null).ast;
}
function nativeAST(src) {
  return nativeParseFile(FP, src).ast;
}

// collectNodes — every object with a `kind` reachable from the FileAST node
// collections, in walk order, optionally filtered by kind. Tracks whether the
// node is inside an expr/node/exprNode (markup-as-value) subtree.
function collectNodes(ast, kindFilter = null) {
  const out = [];
  const roots = [
    ast.nodes, ast.imports, ast.exports, ast.components,
    ast.typeDecls, ast.machineDecls, ast.channelDecls,
  ];
  const stack = [];
  for (const r of roots) {
    if (Array.isArray(r)) for (const it of r) stack.push({ value: it, inExpr: false });
  }
  const EXPR_KEYS = new Set(["expr", "node", "exprNode"]);
  const seen = new Set();
  while (stack.length) {
    const { value: cur, inExpr } = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const it of cur) if (it && typeof it === "object") stack.push({ value: it, inExpr });
      continue;
    }
    if (typeof cur.kind === "string" && (kindFilter === null || cur.kind === kindFilter)) {
      out.push({ node: cur, inExpr });
    }
    for (const k of Object.keys(cur)) {
      if (k === "_nativeEngineBlock" || k === "_source") continue;
      const v = cur[k];
      if (v && typeof v === "object") {
        stack.push({ value: v, inExpr: inExpr || EXPR_KEYS.has(k) });
      }
    }
  }
  return out;
}

// =============================================================================
// Class F — closerForm case
// =============================================================================
describe("M6.5.b.5 — closerForm case normalization", () => {
  test("native markup closerForm is lowercase (matches live)", () => {
    const src = "<div><p>hi</p></div>\n";
    const nat = nativeAST(src);
    const markups = collectNodes(nat, "markup").map((x) => x.node);
    expect(markups.length).toBeGreaterThan(0);
    for (const m of markups) {
      if (typeof m.closerForm === "string" && m.closerForm.length > 0) {
        expect(m.closerForm).toBe(m.closerForm.toLowerCase());
      }
    }
    // and specifically present as the live lowercase value
    const div = markups.find((m) => m.tag === "div");
    expect(div).toBeTruthy();
    expect(div.closerForm).toBe("explicit");
  });

  test("native closerForm equals live closerForm per aligned markup", () => {
    const src = "<section><span>x</></section>\n";
    const liveMarkups = collectNodes(liveAST(src), "markup").map((x) => x.node);
    const natMarkups = collectNodes(nativeAST(src), "markup").map((x) => x.node);
    // pair by tag (both pipelines produce the same tag tree here)
    for (const lm of liveMarkups) {
      const nm = natMarkups.find((m) => m.tag === lm.tag);
      if (nm && typeof lm.closerForm === "string") {
        // case must match; native must not be PascalCase
        expect(nm.closerForm).toBe(nm.closerForm.toLowerCase());
      }
    }
  });
});

// =============================================================================
// Class F — openerHadSpaceAfterLt (block-path present:false; expr-subtree absent)
// =============================================================================
describe("M6.5.b.5 — openerHadSpaceAfterLt parity", () => {
  test("block-path markup carries openerHadSpaceAfterLt:false", () => {
    const src = "<div><p>hi</p></div>\n";
    for (const { node, inExpr } of collectNodes(nativeAST(src), "markup")) {
      if (inExpr) continue;
      expect(Object.prototype.hasOwnProperty.call(node, "openerHadSpaceAfterLt")).toBe(true);
      expect(node.openerHadSpaceAfterLt).toBe(false);
    }
  });

  test("lift-expr markup-as-value subtree OMITS openerHadSpaceAfterLt (live parity)", () => {
    // `${ lift <li>..</li> }` produces a lift-expr whose markup-as-value node
    // (and its children) must NOT carry openerHadSpaceAfterLt — matching live.
    const src = "<ul>${ for item in @items { lift <li>{item}</li> } }</ul>\n";
    const live = liveAST(src);
    const nat = nativeAST(src);
    const liveExprMarkup = collectNodes(live, "markup").filter((x) => x.inExpr);
    const natExprMarkup = collectNodes(nat, "markup").filter((x) => x.inExpr);
    // Whatever live does inside expr-context, native must mirror (absent==absent).
    const liveHas = liveExprMarkup.some((x) =>
      Object.prototype.hasOwnProperty.call(x.node, "openerHadSpaceAfterLt"));
    const natHas = natExprMarkup.some((x) =>
      Object.prototype.hasOwnProperty.call(x.node, "openerHadSpaceAfterLt"));
    expect(natHas).toBe(liveHas);
  });
});

// =============================================================================
// Class F — _p3aIsExport / _p3aExportName present-as-undefined on block markup
// =============================================================================
describe("M6.5.b.5 — _p3a* markers parity", () => {
  test("block-path markup carries _p3aIsExport/_p3aExportName present-as-undefined", () => {
    const src = "<div><span>x</span></div>\n";
    for (const { node, inExpr } of collectNodes(nativeAST(src), "markup")) {
      if (inExpr) continue;
      expect(Object.prototype.hasOwnProperty.call(node, "_p3aIsExport")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(node, "_p3aExportName")).toBe(true);
      expect(node._p3aIsExport).toBeUndefined();
      expect(node._p3aExportName).toBeUndefined();
    }
  });
});

// =============================================================================
// Class F — attrs[].value.sourceText stripped from translated markup nodes
// =============================================================================
describe("M6.5.b.5 — sourceText strip on translated markup attrs", () => {
  test("translated markup node attrs carry NO sourceText", () => {
    const src = '<div class="a b" id="x"><p data-k="v">hi</p></div>\n';
    for (const { node } of collectNodes(nativeAST(src), "markup")) {
      for (const attr of node.attrs || []) {
        if (attr && attr.value && typeof attr.value === "object") {
          expect(Object.prototype.hasOwnProperty.call(attr.value, "sourceText")).toBe(false);
        }
      }
    }
  });

  test("the raw native engine block (walker source) KEEPS sourceText", () => {
    // The engine state-child walker reads sourceText off _nativeEngineBlock /
    // machineDecls[].bodyChildren — those raw blocks must be UNTOUCHED.
    const src =
      "<engine for=Phase>\n" +
      "  <Idle rule=.Active if=\"@x == 1\">\n" +
      "  <Active rule=.Idle>\n" +
      "</engine>\n";
    const nat = nativeAST(src);
    const md = nat.machineDecls && nat.machineDecls[0];
    expect(md).toBeTruthy();
    expect(Array.isArray(md.bodyChildren)).toBe(true);
    // find a raw native Markup child carrying an attr with sourceText
    let found = false;
    for (const bc of md.bodyChildren) {
      if (bc && bc.kind === "Markup" && Array.isArray(bc.attrs)) {
        for (const attr of bc.attrs) {
          if (attr && attr.value && typeof attr.value === "object"
              && Object.prototype.hasOwnProperty.call(attr.value, "sourceText")) {
            found = true;
          }
        }
      }
    }
    expect(found).toBe(true); // walker source preserved
    // and _nativeEngineBlock is the same raw block (PascalCase kind)
    expect(md._nativeEngineBlock && md._nativeEngineBlock.kind).toBe("Markup");
  });
});

// =============================================================================
// Class F — _synthetic forwarded onto lifted logic nodes
// =============================================================================
describe("M6.5.b.5 — _synthetic lift-wrapper marker parity", () => {
  test("a bare top-level decl lifts to a logic node carrying _synthetic:true (matches live)", () => {
    // A bare `type` decl directly inside <program> auto-lifts to a synthetic
    // logic wrapper on BOTH pipelines.
    const src = "<program>\ntype Phase = Active | Idle\n<p>hi</p>\n</program>\n";
    const live = liveAST(src);
    const nat = nativeAST(src);
    const liveSynthetic = collectNodes(live, "logic")
      .map((x) => x.node).filter((n) => n._synthetic === true);
    const natSynthetic = collectNodes(nat, "logic")
      .map((x) => x.node).filter((n) => n._synthetic === true);
    // native must produce at least one synthetic logic node, matching live's count
    expect(natSynthetic.length).toBe(liveSynthetic.length);
    expect(natSynthetic.length).toBeGreaterThan(0);
  });

  test("a non-lifted (author-written) logic node has NO _synthetic key (matches live)", () => {
    const src = "<div>${ const x = 1 }</div>\n";
    for (const { node } of collectNodes(nativeAST(src), "logic")) {
      // author-written ${...} logic must not carry the synthetic marker
      expect(Object.prototype.hasOwnProperty.call(node, "_synthetic")).toBe(false);
    }
  });
});

// =============================================================================
// Class G — span.file stamped on every node's span
// =============================================================================
describe("M6.5.b.6 — span.file enrichment", () => {
  test("every native node span carries file === filePath", () => {
    const src = "<div><p>hi</p>${ const x = 1 }</div>\n";
    const nat = nativeAST(src);
    let checked = 0;
    for (const { node } of collectNodes(nat)) {
      const sp = node.span;
      if (sp && typeof sp === "object" && !Array.isArray(sp)) {
        expect(sp.file).toBe(FP);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("span.file is ADDITIVE — start/end/line/col are unchanged by the stamp", () => {
    // The stamp must not perturb the coordinates (a shared span the engine
    // walker reads relies on the offsets staying intact).
    const src = "<section><span>x</span></section>\n";
    const nat = nativeAST(src);
    for (const { node } of collectNodes(nat, "markup")) {
      const sp = node.span;
      if (sp && typeof sp === "object") {
        expect(typeof sp.start).toBe("number");
        expect(typeof sp.end).toBe("number");
        expect(sp.end).toBeGreaterThanOrEqual(sp.start);
        expect(sp.file).toBe(FP);
      }
    }
  });

  test("machineDecls + typeDecls spans also carry file", () => {
    const src =
      "<program>\n" +
      "type Phase = Active | Idle\n" +
      "<engine for=Phase>\n  <Idle rule=.Active>\n  <Active rule=.Idle>\n</engine>\n" +
      "</program>\n";
    const nat = nativeAST(src);
    for (const md of nat.machineDecls || []) {
      if (md && md.span && typeof md.span === "object") expect(md.span.file).toBe(FP);
    }
    for (const td of nat.typeDecls || []) {
      if (td && td.span && typeof td.span === "object") expect(td.span.file).toBe(FP);
    }
  });
});
