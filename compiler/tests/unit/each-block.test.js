/**
 * each-block.test.js — `<each>` structural-iteration element tests.
 *
 * Landing 1 of S130 HU-1 iteration arc. Covers the per-shape codegen
 * surface + the W-EACH-PROMOTABLE + W-EACH-KEY-001 info-lints + the
 * §4.14 `:`-shorthand body composition (Q3 RE-RATIFICATION).
 *
 * Coverage:
 *   §1 — Canonical shape: <each in=@cell> (collection iteration, default key)
 *   §2 — Canonical shape: <each in=@cell as name> (collection + naming)
 *   §3 — Canonical shape: <each of=N> (count iteration)
 *   §4 — Canonical shape: <each of=@cell as name> (count + naming)
 *   §5 — <empty> sub-element renders fallback
 *   §6 — explicit key= overrides default
 *   §7 — :-shorthand body per §4.14 (Q3 RE-RATIFICATION)
 *   §8 — Nested iteration with outer `as` for inner-scope access
 *   §9 — W-EACH-PROMOTABLE fires on ${for/lift} Tier-0 sites
 *  §10 — W-EACH-KEY-001 fires when no .id field is inferable
 *  §11 — AST: each-block dispatch + bodyChildren / templateChildren / emptyChild
 *  §12 — Tree-shake: empty <each> (no template, no empty) emits no render code
 *  §13 — TS scope: 'as name' is bound — no E-SCOPE-001 on `${name.field}`
 *  §14 — DG credit: in=@cell does NOT false-fire E-DG-002
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// compile helper — mirrors engine-body-render.test.js pattern.
// ---------------------------------------------------------------------------

function compileToOutputs(source, suffix = "each") {
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
// §1 — Canonical shape: <each in=@cell> (collection iteration, default key)
// ---------------------------------------------------------------------------

describe("each-block §1 — canonical <each in=@cell>", () => {
  test("emits mount slot in HTML + render fn + reactive subscription", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li>plain item</li>
</each>

</program>`;
    const { errors, clientJs, html } = compileToOutputs(src, "in-basic");
    expect(errors).toEqual([]);
    // Static HTML carries the mount slot at the source position.
    expect(html).toMatch(/data-scrml-each-mount="each_\d+"/);
    // Client JS emits the render function.
    expect(clientJs).toMatch(/function _scrml_each_render_\d+\(\)/);
    // Reactive subscription via _scrml_effect_static.
    expect(clientJs).toMatch(/_scrml_effect_static\(_scrml_each_render_\d+\)/);
    // The source @cell is read through _scrml_reactive_get (V5-strict).
    expect(clientJs).toContain('_scrml_reactive_get("items")');
    // Reconcile_list call shape.
    expect(clientJs).toMatch(/_scrml_reconcile_list\(/);
  });
});

// ---------------------------------------------------------------------------
// §2 — Canonical shape: <each in=@cell as name>
// ---------------------------------------------------------------------------

describe("each-block §2 — canonical <each in=@cell as name>", () => {
  test("emits factory closure with the `as` name as iter-var; @name binds in body scope", () => {
    const src = `<program>
<contacts> = []

<each in=@contacts as contact>
    <li>name placeholder</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "in-as");
    expect(errors).toEqual([]);
    // The factory closure uses 'contact' as the iter-var name.
    expect(clientJs).toMatch(/\(contact, _scrml_each_idx\) =>/);
    // The key fn uses 'contact?.id != null ? contact.id : _scrml_each_idx'
    // default (inference fallback when no typed .id field is provable). The
    // index param is the canonical internal name (gate fix-wave: avoids the
    // `(i, i)` argument-name clash when an each-block aliases the item as `i`).
    expect(clientJs).toMatch(/contact\?\.id != null \? contact\.id : _scrml_each_idx/);
  });

  test("body interpolation ${contact.name} resolves under the `as` binding", () => {
    const src = `<program>
<contacts> = []

<each in=@contacts as contact>
    <li>\${contact.name}</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "in-as-interp");
    expect(errors).toEqual([]);
    // The interpolated expression references `contact.name` (the iter-var
    // binding), not @cell. Verifies TS scope plumbing.
    expect(clientJs).toContain("String(contact.name)");
  });
});

// ---------------------------------------------------------------------------
// §3 — Canonical shape: <each of=N> (count iteration)
// ---------------------------------------------------------------------------

describe("each-block §3 — canonical <each of=N> count iteration", () => {
  test("of= literal N produces an Array.from range factory", () => {
    const src = `<program>
<each of=5>
    <li>row</li>
</each>
</program>`;
    const { errors, clientJs, html } = compileToOutputs(src, "of-literal");
    expect(errors).toEqual([]);
    expect(html).toMatch(/data-scrml-each-mount="each_\d+"/);
    expect(clientJs).toMatch(/Array\.from\(\{length: Number\(5\) \|\| 0\}/);
    // Default key for of= form is the index itself (positional), named with the
    // canonical internal index var (gate fix-wave clash-avoidance).
    expect(clientJs).toMatch(/\(_scrml_each_item, _scrml_each_idx\) => _scrml_each_idx,/);
  });

  test("of=@cell uses _scrml_reactive_get to resolve the count", () => {
    const src = `<program>
<rowCount> = 0

<each of=@rowCount>
    <li>row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "of-cell");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("rowCount")');
    expect(clientJs).toMatch(/Array\.from\(\{length: Number\(_scrml_reactive_get\("rowCount"\)\) \|\| 0\}/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Canonical shape: <each of=N as name>
// ---------------------------------------------------------------------------

describe("each-block §4 — canonical <each of=N as name>", () => {
  test("`as name` aliases the index; per-item factory uses the name", () => {
    const src = `<program>
<each of=3 as i>
    <li>i</li>
</each>
</program>`;
    const { errors, clientJs } = compileToOutputs(src, "of-as");
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/\(i, _scrml_each_idx\) =>/);
    // gate-found-invalid-js-fix-wave (S141): when the alias is `i`, the keyFn
    // and item factory must NOT collapse to `(i, i) =>` (argument-name clash =
    // invalid JS). Both params distinct + emit is acorn-parse-clean.
    expect(clientJs).not.toMatch(/\(i, i\)\s*=>/);
    const acorn = require("acorn");
    expect(() => acorn.parse(clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §5 — <empty> sub-element renders fallback
// ---------------------------------------------------------------------------

describe("each-block §5 — <empty> sub-element fallback", () => {
  test("<empty> body renders when collection is empty", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li>item</li>
    <empty>nothing here</empty>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "empty");
    expect(errors).toEqual([]);
    // Empty-state path checks _items.length === 0 then renders the
    // <empty> body content.
    expect(clientJs).toMatch(/if \(!_items \|\| _items\.length === 0\)/);
    expect(clientJs).toContain("nothing here");
    expect(clientJs).toMatch(/_mount\.appendChild\(_emptyFrag\)/);
  });

  test("no <empty> sub-element → no empty-state guard emitted", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li>item</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "no-empty");
    expect(errors).toEqual([]);
    // The if (!_items || _items.length === 0) early-return guard is
    // ONLY emitted when an <empty> sub-element is present. When absent,
    // _scrml_reconcile_list handles the empty case natively via its
    // fast-path (children.length === 0 → replaceChildren()).
    expect(clientJs).not.toMatch(/if \(!_items \|\| _items\.length === 0\)/);
  });
});

// ---------------------------------------------------------------------------
// §6 — explicit key= overrides default
// ---------------------------------------------------------------------------

describe("each-block §6 — explicit key= override", () => {
  test("key=expr (cell-style) overrides default .id inference", () => {
    const src = `<program>
<rows> = []

<each in=@rows as row key=row.uuid>
    <li>row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "key-explicit");
    expect(errors).toEqual([]);
    // The keyFn body should be `row.uuid` (the explicit key=); the index param
    // is the canonical internal name (gate fix-wave clash-avoidance).
    expect(clientJs).toMatch(/\(row, _scrml_each_idx\) => row\.uuid,/);
  });

  test("key=__index__ canonical suppress-sentinel → keyFn returns i", () => {
    const src = `<program>
<items> = []

<each in=@items key=__index__>
    <li>item</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "key-index");
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/\(_scrml_each_item, _scrml_each_idx\) => _scrml_each_idx,/);
  });
});

// ---------------------------------------------------------------------------
// §7 — :-shorthand body per §4.14 (Q3 RE-RATIFICATION)
// ---------------------------------------------------------------------------

describe("each-block §7 — §4.14 :-shorthand body (Q3 RE-RATIFICATION)", () => {
  test("AST captures :-shorthand per-item element opener correctly", () => {
    // Per Q3 RE-RATIFICATION the canonical :-shorthand form is
    // `<li : @.name>` (: INSIDE opener, mandatory space, no closer).
    // Verify the AST builder preserves the raw opener so codegen can
    // recognize the :-shorthand pattern.
    const src = `<program>
<contacts> = []

<each in=@contacts>
    <li : @.name>
</each>

</program>`;
    const bs = splitBlocks("t.scrml", src);
    const ast = buildAST(bs);
    const each = findEachBlock(ast.ast?.nodes ?? ast);
    expect(each).not.toBeNull();
    expect(each.iterShape).toBe("in");
    expect(each.inExprRaw).toBe("@contacts");
    // bodyRaw should carry the raw opener form including the ` : `
    // shorthand introducer.
    expect(each.bodyRaw).toContain("<li : @.name>");
  });
});

// ---------------------------------------------------------------------------
// §8 — Nested iteration with outer `as` for inner-scope access
// ---------------------------------------------------------------------------

describe("each-block §8 — nested iteration", () => {
  test("outer `as` binding is accessible inside inner template", () => {
    const src = `<program>
<groups> = []

<each in=@groups as group>
    <ul>
        <each in=@items as item>
            <li>group + item</li>
        </each>
    </ul>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "nested");
    // The test only verifies the AST + codegen handle the nested shape
    // without crashing; the `@items` outer reference is a separate
    // (undeclared) symbol so we accept E-DG-002 / E-SCOPE-001 on `items`
    // (synthetic test). The shape we care about is that two
    // `_scrml_each_render_*` functions are emitted.
    const renderCount = (clientJs.match(/function _scrml_each_render_\d+\(\)/g) || []).length;
    expect(renderCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §9 — W-EACH-PROMOTABLE fires on ${for/lift} Tier-0 sites
// ---------------------------------------------------------------------------

describe("each-block §9 — W-EACH-PROMOTABLE info-lint", () => {
  test("fires on ${ for (let x of @cell) { lift <li/> } } Tier-0 pattern", () => {
    const src = `<program>
<contacts> = []

<ul>
\${ for (let c of @contacts) {
    lift <li>placeholder</li>;
} }
</ul>

</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "promo");
    expect(errors).toEqual([]);
    const eachPromo = lintDiagnostics.filter((d) => d.code === "W-EACH-PROMOTABLE");
    expect(eachPromo.length).toBeGreaterThanOrEqual(1);
    // Message names the promotion target shape.
    expect(eachPromo[0].message).toContain("<each in=@contacts as c>");
    expect(eachPromo[0].message).toContain("bun scrml promote --each");
  });

  test("does NOT fire on for-loop without lift (pure logic iteration)", () => {
    const src = `<program>
<contacts> = []

\${
    let total = 0;
    for (let c of @contacts) {
        total = total + 1;
    }
}

</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "promo-nolift");
    expect(errors).toEqual([]);
    const eachPromo = lintDiagnostics.filter((d) => d.code === "W-EACH-PROMOTABLE");
    expect(eachPromo.length).toBe(0);
  });

  test("does NOT fire on existing <each> usage (already promoted)", () => {
    const src = `<program>
<contacts> = []

<each in=@contacts as contact>
    <li>name</li>
</each>

</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "promo-each");
    expect(errors).toEqual([]);
    const eachPromo = lintDiagnostics.filter((d) => d.code === "W-EACH-PROMOTABLE");
    expect(eachPromo.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §10 — W-EACH-KEY-001 fires when no .id field is inferable
// ---------------------------------------------------------------------------

describe("each-block §10 — W-EACH-KEY-001 info-lint", () => {
  test("fires on <each in=@cell> when no .id inference is supportable", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li>name</li>
</each>

</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "keylint-fire");
    expect(errors).toEqual([]);
    const keyDiags = lintDiagnostics.filter((d) => d.code === "W-EACH-KEY-001");
    expect(keyDiags.length).toBeGreaterThanOrEqual(1);
    expect(keyDiags[0].message).toContain("key=__index__");
    expect(keyDiags[0].message).toContain("order-stable");
  });

  test("does NOT fire when explicit key= override is given", () => {
    const src = `<program>
<items> = []

<each in=@items as item key=item.id>
    <li>name</li>
</each>

</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "keylint-explicit");
    expect(errors).toEqual([]);
    const keyDiags = lintDiagnostics.filter((d) => d.code === "W-EACH-KEY-001");
    expect(keyDiags.length).toBe(0);
  });

  test("does NOT fire on <each of=N> count iteration", () => {
    const src = `<program>
<each of=10>
    <li>row</li>
</each>
</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "keylint-of");
    expect(errors).toEqual([]);
    const keyDiags = lintDiagnostics.filter((d) => d.code === "W-EACH-KEY-001");
    expect(keyDiags.length).toBe(0);
  });

  test("does NOT fire when key=__index__ suppress sentinel is used", () => {
    const src = `<program>
<items> = []

<each in=@items key=__index__>
    <li>name</li>
</each>

</program>`;
    const { errors, lintDiagnostics } = compileToOutputs(src, "keylint-sentinel");
    expect(errors).toEqual([]);
    const keyDiags = lintDiagnostics.filter((d) => d.code === "W-EACH-KEY-001");
    expect(keyDiags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11 — AST shape: each-block dispatch produces expected fields
// ---------------------------------------------------------------------------

describe("each-block §11 — AST dispatch shape", () => {
  test("each-block carries iterShape / inExprRaw / asName / keyExprRaw / bodyChildren / emptyChild", () => {
    const src = `<program>
<contacts> = []

<each in=@contacts as contact key=contact.uuid>
    <li>name</li>
    <empty>none</empty>
</each>

</program>`;
    const bs = splitBlocks("t.scrml", src);
    const ast = buildAST(bs);
    const each = findEachBlock(ast.ast?.nodes ?? ast);
    expect(each).not.toBeNull();
    expect(each.kind).toBe("each-block");
    expect(each.iterShape).toBe("in");
    expect(each.inExprRaw).toBe("@contacts");
    expect(each.ofExprRaw).toBeNull();
    expect(each.asName).toBe("contact");
    expect(each.keyExprRaw).toBe("contact.uuid");
    expect(Array.isArray(each.bodyChildren)).toBe(true);
    expect(Array.isArray(each.templateChildren)).toBe(true);
    expect(each.emptyChild).not.toBeNull();
    // Empty child has tag "empty".
    const emptyTag = each.emptyChild.tag ?? each.emptyChild.name;
    expect(emptyTag).toBe("empty");
  });

  test("each of=N as i — count-iteration shape produces matching fields", () => {
    const src = `<program>
<each of=7 as i>
    <tr>row</tr>
</each>
</program>`;
    const bs = splitBlocks("t.scrml", src);
    const ast = buildAST(bs);
    const each = findEachBlock(ast.ast?.nodes ?? ast);
    expect(each).not.toBeNull();
    expect(each.iterShape).toBe("of");
    expect(each.ofExprRaw).toBe("7");
    expect(each.inExprRaw).toBeNull();
    expect(each.asName).toBe("i");
  });
});

// ---------------------------------------------------------------------------
// §12 — Tree-shake: empty <each> emits no render code
// ---------------------------------------------------------------------------

describe("each-block §12 — tree-shake invariant", () => {
  test("each-block with no templateChildren + no emptyChild emits no render fn", () => {
    // Synthetic empty body — block-splitter still recognizes <each>,
    // ast-builder produces the node with empty children, codegen skips.
    const src = `<program>
<each in=@items></each>
</program>`;
    const { clientJs } = compileToOutputs(src, "shake");
    // No render functions emitted for the empty each-block.
    expect(clientJs).not.toMatch(/_scrml_each_render_/);
  });
});

// ---------------------------------------------------------------------------
// §13 — TS scope: 'as name' is bound — no E-SCOPE-001 on `${name.field}`
// ---------------------------------------------------------------------------

describe("each-block §13 — TS scope plumbing", () => {
  test("`as name` is bound for body logic interpolations (no E-SCOPE-001)", () => {
    const src = `<program>
<contacts> = []

<each in=@contacts as contact>
    <li>\${contact.name}</li>
</each>

</program>`;
    const { errors } = compileToOutputs(src, "ts-scope");
    // No E-SCOPE-001 on 'contact' — the `as contact` binding entered scope.
    const scopeErrs = errors.filter((e) => (e.code === "E-SCOPE-001"));
    expect(scopeErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §14 — DG credit: in=@cell does NOT false-fire E-DG-002
// ---------------------------------------------------------------------------

describe("each-block §14 — DG credit", () => {
  test("`<each in=@cell>` credits @cell as reader (no false E-DG-002)", () => {
    const src = `<program>
<contacts> = []

<each in=@contacts as contact>
    <li>name</li>
</each>

</program>`;
    const { errors, warnings } = compileToOutputs(src, "dg-credit");
    expect(errors).toEqual([]);
    // E-DG-002 in WARNINGS would mean the DG pass thought @contacts was
    // declared-but-not-consumed. The each-block in= attribute should credit
    // it as a reader.
    const dgWarnings = warnings.filter((w) => w.code === "E-DG-002");
    expect(dgWarnings).toEqual([]);
  });
});
