// native-each-promotion.test.js — #2f native-parser <each> structural-promotion.
//
// The native parser (`--parser=scrml-native`) PREVIOUSLY did not promote
// `<each>` to a structural `each-block` FileAST node — it fell through to the
// generic markup synth (`synthMarkupNode`), so `as item` parsed as stray HTML
// attrs (W-ATTR-001) + no iteration scope (E-SCOPE-001) + a bare
// `el.textContent = item` (no `_scrml_reconcile_list` / render fn / per-item
// factory). This dispatch makes `<each>` join the existing structural-promotion
// triad (`<match>` / `<engine>`): the native pipeline now produces the SAME
// `each-block` FileAST node the LIVE pipeline produces, which the shared codegen
// (`compiler/src/codegen/emit-each.ts`) consumes unchanged.
//
// Two assertion layers:
//   (1) NODE-LEVEL — drive `nativeParseFile` directly and assert the
//       `each-block` node shape (kind / iterShape / inExprRaw / ofExprRaw /
//       asName / keyExprRaw / templateChildren / emptyChild / colon-shorthand
//       fields). This is the promotion mechanism under test.
//   (2) END TO END — (S449: was a compile under BOTH parsers through the
//       retired full-pipeline flag; now the default pipeline, with the
//       native-shaped nodes reached through `<match>` arm re-parse.) Formerly:
//       compile real each-shaped source under BOTH parsers and assert the native client.js
//       carries the structural each semantics (`_scrml_reconcile_list` + render
//       fn + per-item factory) just like default, and that the unpromoted
//       symptoms (W-ATTR-001 / E-SCOPE-001 / bare textContent) are GONE.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// findEachBlock — depth-first scan for the first `each-block` node in a
// FileAST. Walks the structural-node child collections.
function findEachBlock(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findEachBlock(n);
      if (r) return r;
    }
    return null;
  }
  if (node.kind === "each-block") return node;
  for (const k of ["children", "bodyChildren", "templateChildren", "nodes"]) {
    if (Array.isArray(node[k])) {
      const r = findEachBlock(node[k]);
      if (r) return r;
    }
  }
  return null;
}

// findMarkupByTag — depth-first scan for the first markup node with `tag`.
function findMarkupByTag(node, tag) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findMarkupByTag(n, tag);
      if (r) return r;
    }
    return null;
  }
  if (node.kind === "markup" && (node.tag === tag || node.name === tag)) return node;
  for (const k of ["children", "bodyChildren", "templateChildren", "nodes"]) {
    if (Array.isArray(node[k])) {
      const r = findMarkupByTag(node[k], tag);
      if (r) return r;
    }
  }
  return null;
}

// nativeAst — parse `source` via the native parser; return its FileAST.
function nativeAst(source) {
  const r = nativeParseFile("app.scrml", source);
  return r.ast;
}

// compileDefault — compile `source` to client.js through the default pipeline.
// Returns errors + warnings + client.js text.
function compileDefault(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-naceach-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""));
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// codeIn — true iff a diagnostic with `code` appears in either stream (the
// cross-stream helper — W-/I- codes land in `warnings`, E- in `errors`).
function codeIn(result, code) {
  const all = [...(result.errors ?? []), ...(result.warnings ?? [])];
  return all.some((d) => d && d.code === code);
}

// ===========================================================================
// §1 — NODE-LEVEL promotion: each-block shape from the native parser.
// ===========================================================================

describe("native-each §1 — <each in=@cell> collection iteration", () => {
  test("promotes to each-block with iterShape=in + inExprRaw", () => {
    const ast = nativeAst(`<program>
<each in=@items>
<li>plain</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each).not.toBeNull();
    expect(each.kind).toBe("each-block");
    expect(each.iterShape).toBe("in");
    expect(each.inExprRaw).toBe("@items");
    expect(each.ofExprRaw).toBeNull();
  });

  test("templateChildren carries the per-item <li>; bodyChildren is full mirror", () => {
    const ast = nativeAst(`<program>
<each in=@items>
<li>plain</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(Array.isArray(each.templateChildren)).toBe(true);
    expect(Array.isArray(each.bodyChildren)).toBe(true);
    const li = findMarkupByTag(each.templateChildren, "li");
    expect(li).not.toBeNull();
  });

  test("captures complex in= expression verbatim (arrow + paren depth)", () => {
    const ast = nativeAst(`<program>
<each in=@items.filter(c => c.active)>
<li>x</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.iterShape).toBe("in");
    expect(each.inExprRaw).toBe("@items.filter(c => c.active)");
  });
});

describe("native-each §2 — <each of=N> count iteration", () => {
  test("promotes to each-block with iterShape=of + ofExprRaw", () => {
    const ast = nativeAst(`<program>
<each of=3>
<li>row</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each).not.toBeNull();
    expect(each.iterShape).toBe("of");
    expect(each.ofExprRaw).toBe("3");
    expect(each.inExprRaw).toBeNull();
  });
});

describe("native-each §3 — <each ... as name>", () => {
  test("captures asName from the two-bareword `as item` shape", () => {
    const ast = nativeAst(`<program>
<each in=@items as item>
<li>\${item}</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.asName).toBe("item");
  });

  test("captures asName when `as` is non-adjacent to its name", () => {
    const ast = nativeAst(`<program>
<each in=@items key=@x.id as item>
<li>\${item}</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.asName).toBe("item");
    expect(each.keyExprRaw).toBe("@x.id");
  });
});

describe("native-each §4 — <each ... key=expr>", () => {
  test("captures keyExprRaw verbatim", () => {
    const ast = nativeAst(`<program>
<each in=@items as item key=@item.id>
<li>\${item.name}</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.keyExprRaw).toBe("@item.id");
  });

  test("keyExprRaw is null when key= is absent", () => {
    const ast = nativeAst(`<program>
<each in=@items>
<li>x</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.keyExprRaw).toBeNull();
  });
});

describe("native-each §5 — <empty> sub-element", () => {
  test("partitions <empty> into emptyChild; not in templateChildren", () => {
    const ast = nativeAst(`<program>
<each in=@items>
<li>item</li>
<empty>No items</empty>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.emptyChild).not.toBeNull();
    expect(each.emptyChild.kind).toBe("markup");
    expect(each.emptyChild.tag === "empty" || each.emptyChild.name === "empty").toBe(true);
    // The <empty> sub-element is removed from templateChildren.
    const emptyInTemplate = findMarkupByTag(each.templateChildren, "empty");
    expect(emptyInTemplate).toBeNull();
  });

  test("emptyChild is null when no <empty> sub-element present", () => {
    const ast = nativeAst(`<program>
<each in=@items>
<li>item</li>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    expect(each.emptyChild).toBeNull();
  });
});

describe("native-each §6 — per-item `:`-shorthand body (sub-unit d)", () => {
  test("per-item <li : @item.name> carries closerForm=shorthand + shorthandBodyRaw", () => {
    const ast = nativeAst(`<program>
<each of=3 as item>
<li : @item.name>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    const li = findMarkupByTag(each.templateChildren, "li");
    expect(li).not.toBeNull();
    expect(li.closerForm).toBe("shorthand");
    expect(li.shorthandBodyRaw).toBe("@item.name");
    expect(li.selfClosing).toBe(false);
  });
});

describe("native-each §7 — standalone `:`-shorthand (sub-unit d, general)", () => {
  test("standalone <span : @label> carries closerForm=shorthand + shorthandBodyRaw", () => {
    const ast = nativeAst(`<program>
<span : @label>
</program>`);
    const span = findMarkupByTag(ast.nodes, "span");
    expect(span).not.toBeNull();
    expect(span.closerForm).toBe("shorthand");
    expect(span.shorthandBodyRaw).toBe("@label");
    expect(span.selfClosing).toBe(false);
  });

  test("non-shorthand markup is unchanged (no shorthandBodyRaw, selfClosing intact)", () => {
    const ast = nativeAst(`<program>
<br/>
</program>`);
    const br = findMarkupByTag(ast.nodes, "br");
    expect(br).not.toBeNull();
    expect(br.shorthandBodyRaw).toBeUndefined();
    expect(br.closerForm).not.toBe("shorthand");
  });
});

describe("native-each §8 — each inside a <match> arm (STOP-FLAG coupling)", () => {
  // NOTE on the coupling shape (verified empirically): NEITHER pipeline promotes
  // the inner each in `match-block.bodyChildren` — the live pipeline collapses
  // match arm bodies into a single raw-text child (BS STRUCTURAL_RAW_BODY) and
  // re-parses arms downstream in match-statechild-parser; the native pipeline
  // preserves the raw native blocks in `bodyChildren` and the SAME downstream
  // re-parse promotes the each. So the coupling lives at the CODEGEN seam, not
  // in the FileAST bodyChildren walk. The contract under test: each-in-match-arm
  // produces the structural each (`_scrml_reconcile_list` + `_scrml_each_renderers`)
  // under native, matching default — i.e. the inner each is NOT silently masked.
  const EACH_IN_MATCH_ARM = `<div>
    \${
        type Phase:enum = { Idle, Ready }
        <phase>: Phase = .Idle
        <items> = []
    }
    <match for=Phase on=@phase>
        <Ready>
            <each in=@items as item>
                <li>\${item}</li>
            </each>
        </>
        <_>
            <p data-arm="fallback">waiting</p>
        </>
    </match>
</div>`;

  // S449: the former second arm (the retired full-pipeline
  // `--parser=scrml-native` flag) was dropped. Note: impl#1 never routes an
  // each-bearing body through the native parser — emit-match.ts and
  // component-expander.ts both fall back to splitBlocks+buildAST when the body
  // contains `<each` (verified S449 by breaking emit-each's exprNode branch:
  // these tests stayed green). So this is default-pipeline coverage; the native
  // each promotion is covered only by the direct tree tests in §1–§7.
  test("inner each is promoted in the match arm (reconcile_list present)", () => {
    const def = compileDefault(EACH_IN_MATCH_ARM, "mm-def");
    expect(def.errors.length).toBe(0);
    expect(foldChunkNamespacing(def.clientJs)).toContain("_scrml_reconcile_list");
    expect(foldChunkNamespacing(def.clientJs)).toContain("_scrml_each_renderers");
  });

  test("each-in-match-arm does not regress to bare textContent", () => {
    const def = compileDefault(EACH_IN_MATCH_ARM, "mm-bare");
    expect(foldChunkNamespacing(def.clientJs)).not.toMatch(/textContent\s*=\s*item\b/);
  });
});

// ===========================================================================
// §9 — the structural each semantics (`_scrml_reconcile_list` + per-each
// render fn + per-item factory) in the emitted client.js, and the unpromoted
// symptoms (W-ATTR-001 / E-SCOPE-001) absent. (S449: was native-vs-default
// parity through the retired full-pipeline flag; the node-level promotion is
// asserted directly in §1–§7.)
// ===========================================================================

describe("native-each §9 — structural each in the emitted client.js", () => {
  const EACH_IN_AS = `<program>
<items> = []

<each in=@items as item>
    <li>\${item}</li>
</each>
</program>`;

  test("emits _scrml_reconcile_list (structural each)", () => {
    const def = compileDefault(EACH_IN_AS, "par-def");
    expect(def.errors.length).toBe(0);
    expect(foldChunkNamespacing(def.clientJs)).toContain("_scrml_reconcile_list");
  });

  test("does NOT fire W-ATTR-001 (as item stray attr) or E-SCOPE-001", () => {
    const def = compileDefault(EACH_IN_AS, "par-symptom");
    expect(codeIn(def, "W-ATTR-001")).toBe(false);
    expect(codeIn(def, "E-SCOPE-001")).toBe(false);
  });

  test("client.js has no bare textContent = item miscompile", () => {
    const nat = compileDefault(EACH_IN_AS, "par-bare");
    // The unpromoted path emitted `el.textContent = item`. The promoted path
    // builds the item via the per-item factory + reconcile — no bare
    // assignment of the loose `item` identifier to textContent.
    expect(foldChunkNamespacing(nat.clientJs)).not.toMatch(/textContent\s*=\s*item\b/);
  });
});

// ===========================================================================
// §10 — standalone `:`-shorthand body-child synthesis (sub-unit d completion).
//
// A STANDALONE non-void HTML element `<span : @label>` is rendered by emit-html,
// which iterates `children`. The native parser must SYNTHESIZE the body child
// (mirroring the LIVE S159 §4.14 content-model rule) so it renders
// `<span>${@label}</span>` rather than an empty `<span></span>`. A `@.`-sigil
// body inside an `<each>` per-item template is SKIPPED (owned by emit-each via
// shorthandBodyRaw) — matching LIVE.
// ===========================================================================

describe("native-each §10 — standalone shorthand body-child synthesis", () => {
  const STANDALONE = `<program>
<label> = "hello"
<span : @label>
</program>`;

  test("standalone <span : @label> renders body wiring (default pipeline)", () => {
    const def = compileDefault(STANDALONE, "s10-def");
    expect(def.errors.length).toBe(0);
    expect(foldChunkNamespacing(def.clientJs)).toContain('_scrml_reactive_get("label")');
  });

  test("native AST synthesizes a logic body child carrying the expr (exprNode)", () => {
    const ast = nativeAst(STANDALONE);
    const span = findMarkupByTag(ast.nodes, "span");
    expect(Array.isArray(span.children)).toBe(true);
    expect(span.children.length).toBe(1);
    expect(span.children[0].kind).toBe("logic");
    const stmt = span.children[0].body[0];
    expect(stmt.kind).toBe("bare-expr");
    // The native bridge sets expr:"" and carries the parsed exprNode (the
    // documented contract — consumers read exprNode). emit-html reads it.
    expect(stmt.exprNode).toBeTruthy();
    expect(stmt.exprNode.name).toBe("@label");
  });

  test("each per-item <li : @.name> does NOT synthesize a child (emit-each owns it)", () => {
    const ast = nativeAst(`<program>
<items> = []
<each in=@items>
<li : @.name>
</each>
</program>`);
    const each = findEachBlock(ast.nodes);
    const li = findMarkupByTag(each.templateChildren, "li");
    expect(li.closerForm).toBe("shorthand");
    expect(li.shorthandBodyRaw).toBe("@.name");
    // @.-sigil body is skipped — no synthesized child (matches LIVE; emit-each
    // reads shorthandBodyRaw + ignores children for the per-item template).
    expect((li.children || []).length).toBe(0);
  });

  test("void element with bogus shorthand body does NOT synthesize a child", () => {
    // A void element rejects a `:`-shorthand body downstream
    // (E-COLON-SHORTHAND-ON-VOID); the synth guard must not fabricate a child.
    const ast = nativeAst(`<program>
<input : @x>
</program>`);
    const input = findMarkupByTag(ast.nodes, "input");
    if (input) {
      expect((input.children || []).length).toBe(0);
    }
  });
});

// ===========================================================================
// §11 — `:`-prefixed DIRECTIVE attribute is NOT a `:`-shorthand body.
//
// A `tableFor`/`formFor` slot callback `<column :let={(row) => ...}/>` carries a
// space-preceded `:let=` — which looks like a `:`-shorthand introducer to a
// naive recognizer. The native tag-frame must treat `:name=` as a directive
// ATTRIBUTE (matching the LIVE BS self-closing directive recognition), NOT a
// shorthand body — otherwise it captures the render-prop callback as a phantom
// `colonShorthandBody` and synthMarkupNode mis-synthesizes a body child.
// ===========================================================================

describe("native-each §11 — :let= directive attr is not a shorthand body", () => {
  test("<column :let={...}/> does NOT become a shorthand node", () => {
    const ast = nativeAst(`<program>
<tableFor for=User rows=@users>
<column field="role" :let={(user) =>
<span class="badge">x</span>
}/>
</tableFor>
</program>`);
    const column = findMarkupByTag(ast.nodes, "column");
    expect(column).not.toBeNull();
    // The :let= directive must NOT be captured as a shorthand body.
    expect(column.closerForm).not.toBe("shorthand");
    expect(column.shorthandBodyRaw).toBeUndefined();
  });

  test("a real `: expr` shorthand still recognized alongside `:name=` exclusion", () => {
    // Control: a genuine shorthand body must still be recognized (the guard
    // only excludes `:name=` directive form, not `: expr`).
    const ast = nativeAst(`<program>
<label> = "hi"
<span : @label>
</program>`);
    const span = findMarkupByTag(ast.nodes, "span");
    expect(span.closerForm).toBe("shorthand");
    expect(span.shorthandBodyRaw).toBe("@label");
  });
});

// ===========================================================================
// §10 — per-item `${expr}` text interpolation (#2f completion, codegen)
//
// emit-each.ts's logic-child path read only `stmt.expr`. The native A1 bridge
// (`makeBareExpr`, translate-stmt.js) deliberately sets `expr: ""` and carries
// the live expression in `exprNode` ("codegen prefers exprNode"). So a per-item
// bare-body `${...}` text node was SILENTLY DROPPED under native — it hit the
// "each: empty logic interpolation skipped" path. The fix makes emit-each.ts
// honor the same exprNode-preference contract emit-html.ts uses
// (`exprNode ? emitStringFromTree(exprNode) : expr`).
//
// S449: these tests compiled under the retired full-pipeline
// `--parser=scrml-native` flag — the only way a native-shaped per-item node
// (`expr: ""` + exprNode) ever reached emit-each. impl#1's production native
// re-parse sites (emit-match.ts, component-expander.ts) both fall back to
// splitBlocks+buildAST for an each-bearing body, so with the flag gone the
// emit-each exprNode branch is unreachable in impl#1 (verified by breaking it:
// nothing fails). What remains is default-pipeline coverage of a per-item
// interpolation inside a match arm (the each-in-arm legacy route).
// ===========================================================================

describe("native-each §10 — per-item ${expr} text interpolation (#2f codegen)", () => {
  const IN_MATCH_ARM = (eachOpen, body) => `<div>
    ${"$"}{
        type Phase:enum = { Idle, Ready }
        <phase>: Phase = .Ready
        <users> = [{ id: 1, name: "Ann" }, { id: 2, name: "Bob" }]
    }
    <match for=Phase on=@phase>
        <Ready>
            ${eachOpen}
                ${body}
            </each>
        </>
        <_>
            <p>waiting</p>
        </>
    </match>
</div>`;

  test("named-alias `${item.name}` per-item text inside a match arm is emitted (was dropped)", () => {
    const src = IN_MATCH_ARM("<each in=@users as item>", `<li>${"$"}{item.name}</li>`);
    const def = compileDefault(src, "interp-named");
    expect(def.errors).toHaveLength(0);
    // The per-item text node is present — NOT the skip comment.
    expect(foldChunkNamespacing(def.clientJs)).not.toContain("each: empty logic interpolation skipped");
    expect(foldChunkNamespacing(def.clientJs)).toContain("String(item.name)");
    expect(foldChunkNamespacing(def.clientJs)).toContain("createTextNode");
    expect(foldChunkNamespacing(def.clientJs)).toContain("_scrml_resolve_item");
  });

  test("keyed each inside a match arm emits its per-item interpolation", () => {
    const src = IN_MATCH_ARM("<each in=@users as item key=@.id>", `<li>${"$"}{item.name}</li>`);
    const def = compileDefault(src, "interp-key");
    expect(def.errors).toHaveLength(0);
    expect(foldChunkNamespacing(def.clientJs)).not.toContain("each: empty logic interpolation skipped");
    expect(foldChunkNamespacing(def.clientJs)).toContain("String(item.name)");
  });

  test("legacy (default-parser) per-item interpolation is unchanged — `${item.name}` still emitted", () => {
    // Guard: the fix prefers the non-empty `expr` (legacy) so the default
    // pipeline path stays byte-identical. This asserts the legacy path still
    // emits the text node (it always did) — a regression here would mean the
    // exprNode fallback clobbered the populated-`expr` branch.
    const src = `<program>
<users> = [{ id: 1, name: "Ann" }]
<ul>
<each in=@users as item>
<li>${"$"}{item.name}</li>
</each>
</ul>
</program>`;
    const def = compileDefault(src, "interp-legacy");
    expect(def.errors).toHaveLength(0);
    expect(foldChunkNamespacing(def.clientJs)).not.toContain("each: empty logic interpolation skipped");
    expect(foldChunkNamespacing(def.clientJs)).toContain("String(item.name)");
  });
});
