/**
 * each-colon-shorthand-r25-bug-40.test.js — regression tests for R25-Bug-40.
 *
 * Bug 40: `<each in=@list><span : @.field></each>` emitted an EMPTY per-item
 * factory body — `return _itemFrag.firstChild` returned `null`. Confirmed by
 * R25 dev-3-svelte + overseer-3 + likely dev-1 (whose "all 7 `<each>` item
 * factory bodies are empty" finding used `<li class="card" : @.title>`
 * `:`-shorthand throughout).
 *
 * Root cause: `compiler/src/block-splitter.js` `scanAttributes` did NOT
 * implement SPEC §4.14's normative BS-level `:`-shorthand recognition
 * ("The block splitter recognizes a `:`-shorthand body by the post-
 * attribute `:` token inside an opener — a within-opener scan concern").
 * When an each-block re-parsed its body via `_splitBlocksForP2Form1`,
 * `<li : @.name>` was treated as an unclosed `<li>` opener, fired
 * E-CTX-003, and the opener was silently dropped. emit-each.ts then
 * walked empty templateChildren and emitted an empty per-item factory
 * body — the visible failure mode.
 *
 * Fix (S136 R25-Bug-40, 2026-05-27):
 *   - block-splitter.js scanAttributes: detect `:`-shorthand introducer,
 *     return `shorthand:true` + `shorthandColonAttrOff`.
 *   - block-splitter.js markup-leaf / state-leaf paths: emit
 *     `closerForm:"shorthand"` leaf blocks (no context push).
 *   - ast-builder.js markup dispatch: slice block.raw at introducer
 *     for tokenizeAttributes, capture body as `shorthandBodyRaw`.
 *   - codegen/emit-each.ts: prefer AST-provided shorthandBodyRaw.
 *
 * Coverage:
 *   §1  — minimal repro: `<each in=@items><li : @.name></each>`
 *   §2  — `:`-shorthand with attribute (dev-1's shape)
 *   §3  — `<each of=N>` count form with `:`-shorthand
 *   §4  — nested `:`-shorthand inside non-shorthand parent
 *   §5  — mixed `:`-shorthand + bare-body siblings
 *   §6  — positive control: bare-body still works (regression guard)
 *   §7  — `<empty>` bare-body still works (regression guard)
 *   §8  — `<empty : "literal">` `:`-shorthand on empty-state
 *   §9  — `as name` alias with `:`-shorthand body
 *   §10 — key= inference with `:`-shorthand bodies
 *   §11 — AST-level: closerForm=shorthand + shorthandBodyRaw populated
 *   §12 — BS-level: scanAttributes returns shorthand:true
 *   §13 — no E-CTX-003 fires for `:`-shorthand inside each
 *   §14 — `<empty>` precedence: `<empty>` is found correctly when
 *         other `:`-shorthand children precede it
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// compile helper — mirrors each-block.test.js pattern.
// ---------------------------------------------------------------------------

function compileToOutputs(source, suffix = "shorthand") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      lintDiagnostics: result.lintDiagnostics ?? [],
      clientJs,
      html,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

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
  for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
    if (Array.isArray(node[k])) {
      const r = findEachBlock(node[k]);
      if (r) return r;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// §1 — minimal repro: `<each in=@items><li : @.name></each>`
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §1 — minimal repro <each in=@items><li : @.name></each>", () => {
  test("emits non-empty per-item factory wiring @.name into <li> textContent", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-min");
    expect(errors).toEqual([]);
    // The per-item factory MUST create a <li> element.
    expect(clientJs).toMatch(/document\.createElement\("li"\)/);
    // The factory MUST wire @.name as textContent (iter-var.name).
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.name\)/);
    // Factory MUST append the element to the fragment.
    expect(clientJs).toMatch(/_itemFrag\.appendChild\(/);
    // Pre-fix symptom: factory body was empty — only `return _itemFrag.firstChild`.
    // Post-fix: there's content BEFORE the return.
    const factoryMatch = clientJs.match(/\(_scrml_each_item, _scrml_each_idx\) => \{([\s\S]*?)return _itemFrag\.firstChild/);
    expect(factoryMatch).not.toBeNull();
    const factoryBody = factoryMatch[1];
    // Body should have at least the createElement + textContent + appendChild.
    expect(factoryBody).toContain("createElement");
    expect(factoryBody).toContain("textContent");
  });
});

// ---------------------------------------------------------------------------
// §2 — `:`-shorthand with attribute (dev-1's shape)
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §2 — `:`-shorthand body with leading attribute", () => {
  test("`<li class=\"card\" : @.title>` — attribute AND shorthand body both wired", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li class="card" : @.title>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-attr");
    expect(errors).toEqual([]);
    // The class attribute is wired via setAttribute.
    expect(clientJs).toMatch(/\.setAttribute\("class", "card"\)/);
    // The shorthand body is wired via textContent.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.title\)/);
    // No spurious setAttribute("@", ...) or setAttribute("title", ...) from
    // pre-fix mis-tokenization of the body as bareword attributes.
    expect(clientJs).not.toMatch(/setAttribute\("@",/);
    expect(clientJs).not.toMatch(/setAttribute\("title", ""\)/);
  });
});

// ---------------------------------------------------------------------------
// §3 — `<each of=N>` count form with `:`-shorthand
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §3 — count form with `:`-shorthand body", () => {
  test("`<each of=10><li : @.></each>` — index iteration with shorthand body", () => {
    const src = `<program>
<slots> = 10

<each of=@slots>
    <li : @.>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-of");
    expect(errors).toEqual([]);
    // Of-form generates Array.from for the range.
    expect(clientJs).toMatch(/Array\.from\(\{length: Number/);
    // <li> is created.
    expect(clientJs).toMatch(/document\.createElement\("li"\)/);
    // The `:`-shorthand body `@.` = current iteration value (the index).
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\)/);
  });

  test("`<each of=N><li : 'Slot ' + @.></each>` — string-concat with index", () => {
    const src = `<program>
<count> = 3

<each of=@count>
    <li : "Slot " + @.>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-of-concat");
    expect(errors).toEqual([]);
    // The body expression includes the literal + concat with iter var.
    expect(clientJs).toMatch(/\.textContent = String\("Slot " \+ _scrml_each_item\)/);
  });
});

// ---------------------------------------------------------------------------
// §4 — nested `:`-shorthand inside non-shorthand parent
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §4 — nested `:`-shorthand inside bare-body parent", () => {
  test("`<div><h3 : @.title></div>` inside each — child shorthand inside parent bare-body", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <div>
        <h3 : @.title>
    </div>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-nested");
    expect(errors).toEqual([]);
    // <div> is created (bare-body parent).
    expect(clientJs).toMatch(/document\.createElement\("div"\)/);
    // <h3> is created (shorthand child).
    expect(clientJs).toMatch(/document\.createElement\("h3"\)/);
    // The h3 receives @.title as textContent.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.title\)/);
  });
});

// ---------------------------------------------------------------------------
// §5 — mixed `:`-shorthand + bare-body siblings
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §5 — mixed shorthand + bare-body siblings", () => {
  test("`<li : @.name><span>after</span>` — shorthand first, then bare sibling", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
    <span>after</span>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-mixed");
    expect(errors).toEqual([]);
    // Both <li> and <span> created.
    expect(clientJs).toMatch(/document\.createElement\("li"\)/);
    expect(clientJs).toMatch(/document\.createElement\("span"\)/);
    // <li> wired with shorthand body.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.name\)/);
    // <span> wired with bare-body text.
    expect(clientJs).toMatch(/createTextNode\("after"\)/);
  });
});

// ---------------------------------------------------------------------------
// §6 — positive control: bare-body still works (regression guard)
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §6 — positive control (regression guard)", () => {
  test("`<li>${@.name}</li>` bare-body still emits correct per-item factory", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li>\${@.name}</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-bare");
    expect(errors).toEqual([]);
    // Bare-body path emits createTextNode (logic interpolation).
    expect(clientJs).toMatch(/document\.createElement\("li"\)/);
    expect(clientJs).toMatch(/createTextNode\(String\(_scrml_each_item\.name\)\)/);
  });
});

// ---------------------------------------------------------------------------
// §7 — `<empty>` bare-body still works (regression guard)
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §7 — `<empty>` bare-body regression guard", () => {
  test("`<empty>No items</empty>` bare-body still wires empty-state fallback", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
    <empty>No items</empty>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-empty-bare");
    expect(errors).toEqual([]);
    // Empty-state branch fires when _items.length === 0.
    expect(clientJs).toMatch(/if \(!_items \|\| _items\.length === 0\) \{/);
    // The "No items" text is wired into the empty fragment.
    expect(clientJs).toMatch(/createTextNode\("No items"\)/);
    // The shorthand body STILL works alongside.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.name\)/);
  });
});

// ---------------------------------------------------------------------------
// §8 — `<empty : "literal">` `:`-shorthand on empty-state (overseer-3 finding)
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §8 — `<empty : 'literal'>` shorthand on empty-state", () => {
  test("`<empty : \"None\">` shorthand body wires into empty fragment", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
    <empty : "None">
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-empty-short");
    expect(errors).toEqual([]);
    // The empty-state branch still fires.
    expect(clientJs).toMatch(/if \(!_items \|\| _items\.length === 0\) \{/);
    // The "None" literal should reach the empty fragment via textContent
    // (the renderEmptyChildToJs walker routes through the same
    // renderTemplateChildToJs path, which now sees `:`-shorthand on the
    // <empty> element via the shorthandBodyRaw field).
    //
    // Pre-fix this would be silent — empty fragment with no content. The
    // textContent assignment is the load-bearing assertion.
    // The empty fragment uses createTextNode + appendChild (no createElement
    // for <empty> — it is a structural sub-element, not a DOM element).
    expect(clientJs).toMatch(/createTextNode\(String\("None"\)\)/);
  });
});

// ---------------------------------------------------------------------------
// §9 — `as name` alias with `:`-shorthand body
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §9 — `as name` alias with `:`-shorthand body", () => {
  test("`<each in=@items as item><li : item.name></each>` — alias works in shorthand", () => {
    const src = `<program>
<items> = []

<each in=@items as item>
    <li : item.name>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-as");
    expect(errors).toEqual([]);
    // Iter-var name is `item`, not the default.
    expect(clientJs).toMatch(/\(item, _scrml_each_idx\) =>/);
    // The shorthand body references `item.name` directly (no `@.` rewrite).
    expect(clientJs).toMatch(/\.textContent = String\(item\.name\)/);
  });
});

// ---------------------------------------------------------------------------
// §10 — key= inference with `:`-shorthand bodies
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §10 — key= inference with `:`-shorthand bodies", () => {
  test("default key inference (item?.id) still fires under shorthand body", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-key-default");
    expect(errors).toEqual([]);
    // Default key-fn inference: `item?.id != null ? item.id : _scrml_each_idx`
    // (gate fix-wave: index param uses the canonical internal name).
    expect(clientJs).toMatch(/_scrml_each_item\?\.id != null \? _scrml_each_item\.id : _scrml_each_idx/);
  });

  test("explicit `key=expr` still wins with `:`-shorthand body", () => {
    const src = `<program>
<items> = []

<each in=@items key=@.email>
    <li : @.name>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "bug40-key-explicit");
    expect(errors).toEqual([]);
    // Explicit key= rewrites @.email to iter-var.email; index param uses the
    // canonical internal name (gate fix-wave clash-avoidance).
    expect(clientJs).toMatch(/\(_scrml_each_item, _scrml_each_idx\) => _scrml_each_item\.email/);
    // Body wired correctly.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.name\)/);
  });
});

// ---------------------------------------------------------------------------
// §11 — AST: closerForm + shorthandBodyRaw populated
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §11 — AST shape: closerForm:'shorthand' + shorthandBodyRaw", () => {
  test("markup AST node carries closerForm='shorthand' for `:`-shorthand opener inside each", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
</each>

</program>`;
    const bs = splitBlocks("t.scrml", src);
    const ast = buildAST(bs);
    const each = findEachBlock(ast.ast?.nodes ?? ast);
    expect(each).not.toBeNull();
    // Find the <li> child inside templateChildren.
    const liChild = each.templateChildren.find(
      c => c && c.kind === "markup" && c.tag === "li"
    );
    expect(liChild).not.toBeUndefined();
    expect(liChild.closerForm).toBe("shorthand");
    expect(liChild.shorthandBodyRaw).toBe("@.name");
  });

  test("AST node carries `:`-shorthand body verbatim for whitespace-bounded `:`", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <span : @.label>
</each>

</program>`;
    const bs = splitBlocks("t.scrml", src);
    const ast = buildAST(bs);
    const each = findEachBlock(ast.ast?.nodes ?? ast);
    const spanChild = each.templateChildren.find(
      c => c && c.kind === "markup" && c.tag === "span"
    );
    expect(spanChild).not.toBeUndefined();
    expect(spanChild.shorthandBodyRaw).toBe("@.label");
  });
});

// ---------------------------------------------------------------------------
// §12 — BS-level: scanAttributes returns shorthand:true
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §12 — block-splitter recognizes `:`-shorthand opener", () => {
  test("standalone `<li : @.name>` parses as a single leaf block, no E-CTX-003", () => {
    const bs = splitBlocks("t.scrml", "<li : @.name>");
    expect(bs.errors).toEqual([]);
    expect(bs.blocks).toHaveLength(1);
    expect(bs.blocks[0].name).toBe("li");
    expect(bs.blocks[0].closerForm).toBe("shorthand");
  });

  test("`<li class=\"card\" : @.title>` parses as single leaf with both attr + shorthand", () => {
    const bs = splitBlocks("t.scrml", '<li class="card" : @.title>');
    expect(bs.errors).toEqual([]);
    expect(bs.blocks).toHaveLength(1);
    expect(bs.blocks[0].name).toBe("li");
    expect(bs.blocks[0].closerForm).toBe("shorthand");
    expect(bs.blocks[0].shorthandColonOff).toBeGreaterThan(0);
  });

  test("namespace-prefixed `class:active=` is NOT shorthand (no preceding whitespace)", () => {
    // `<button class:active=true>` — `:`-shorthand requires whitespace
    // BEFORE the `:` per SPEC §4.14. Namespace prefixes (`class:active`,
    // `bind:value`, `on:click`) have NO whitespace before `:`. Verify
    // they are still treated as regular attributes.
    const bs = splitBlocks("t.scrml", '<button class:active=true></button>');
    expect(bs.blocks).toHaveLength(1);
    expect(bs.blocks[0].name).toBe("button");
    // NOT closerForm:"shorthand"
    expect(bs.blocks[0].closerForm).not.toBe("shorthand");
  });

  test("self-closing `<input/>` is NOT shorthand even with `:` namespace in attrs", () => {
    const bs = splitBlocks("t.scrml", '<input bind:value=@x/>');
    expect(bs.blocks).toHaveLength(1);
    expect(bs.blocks[0].name).toBe("input");
    expect(bs.blocks[0].closerForm).toBe("self-closing");
  });
});

// ---------------------------------------------------------------------------
// §13 — no E-CTX-003 fires for `:`-shorthand inside each
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §13 — no E-CTX-003 cascade for `:`-shorthand inside each", () => {
  test("each with multiple `:`-shorthand siblings produces zero errors", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.title>
    <span : @.summary>
    <em : @.author>
</each>

</program>`;
    const { errors } = compileToOutputs(src, "bug40-noerr");
    // Pre-fix would emit several E-CTX-003 errors (silently discarded
    // in the each-block re-parse, but still surfaced via test paths).
    // Post-fix: clean.
    expect(errors.filter(e => e.code === "E-CTX-003")).toEqual([]);
    expect(errors.filter(e => e.code === "E-CTX-001")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §14 — `<empty>` precedence with sibling `:`-shorthand children
// ---------------------------------------------------------------------------

describe("R25-Bug-40 §14 — `<empty>` correctly separated from templateChildren", () => {
  test("AST separates `<empty>` from templateChildren when both are present", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.name>
    <empty>nothing</empty>
</each>

</program>`;
    const bs = splitBlocks("t.scrml", src);
    const ast = buildAST(bs);
    const each = findEachBlock(ast.ast?.nodes ?? ast);
    expect(each).not.toBeNull();
    // emptyChild should be populated.
    expect(each.emptyChild).not.toBeNull();
    expect(each.emptyChild.tag).toBe("empty");
    // templateChildren should NOT contain the <empty> node.
    const tcEmptyIfAny = each.templateChildren.find(
      c => c && c.kind === "markup" && c.tag === "empty"
    );
    expect(tcEmptyIfAny).toBeUndefined();
    // templateChildren SHOULD contain the <li> with shorthand body.
    const liChild = each.templateChildren.find(
      c => c && c.kind === "markup" && c.tag === "li"
    );
    expect(liChild).not.toBeUndefined();
    expect(liChild.closerForm).toBe("shorthand");
    expect(liChild.shorthandBodyRaw).toBe("@.name");
  });
});
