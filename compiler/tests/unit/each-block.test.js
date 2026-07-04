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
  test("inner each over an outer-alias member resolves in the outer factory scope (each-in-enclosing-scope, S153)", () => {
    // The inner each iterates `group.items` — `group` is the OUTER each's `as`
    // alias, bound ONLY inside the outer per-item factory. Pre-fix the inner each
    // was lifted to a MODULE-SCOPE render fn reading `const _items = group.items;`
    // (group undefined → runtime ReferenceError) AND was dropped from the outer
    // factory (unhandled-kind comment). Post-fix the inner each is emitted INLINE
    // inside the outer factory (item-local mount + inline reconcile, source valid).
    const src = `<program>
type Item:struct = { id: string, name: string }
type Group:struct = { id: string, items: Item[] }
<groups>: Group[] = []

<each in=@groups as group key=group.id>
    <each in=group.items key=@.id>
        <li>\${@.name}</li>
    </each>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "nested");
    expect(errors).toEqual([]);
    // Exactly ONE module-scope each render fn (the OUTER each). The inner each is
    // inline — it gets no module-scope render fn of its own (the old phantom).
    const renderCount = (clientJs.match(/^function _scrml_each_render_\d+\(\)/gm) || []).length;
    expect(renderCount).toBe(1);
    // The inner source is read INSIDE the outer factory (after its `(group, ...)`
    // opener) — NOT at module scope. No unhandled-kind drop comment.
    expect(clientJs).toContain("= group.items;");
    expect(clientJs).not.toContain('each: unhandled template child kind="each-block"');
    // The inner reconcile + inner item-local mount are present inline.
    expect(clientJs).toContain('.setAttribute("data-scrml-each-mount", "each_');
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

// ---------------------------------------------------------------------------
// §15 — Landing 2: per-item body interactivity (SPEC §17.7.2 Shape 4 +
//       §17.7.3). Event handlers, class: bindings, and ${}/@.field attribute
//       interpolation on per-item element openers — Landing 1 dropped these
//       as inert literal `setAttribute(name, "")` / literalized strings.
// ---------------------------------------------------------------------------

describe("each-block §15 — per-item body interactivity (Landing 2)", () => {
  test("class:NAME=@.field emits a classList.toggle on the per-item element", () => {
    const src = `<program>
<items> = [{id: "a", done: false}]

<each in=@items key=@.id>
    <li class:done=@.done>row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-class");
    expect(errors).toEqual([]);
    // class:done lowers to a classList.toggle keyed on the iteration value's
    // field — NOT an inert setAttribute("class:done", "").
    expect(clientJs).toContain('.classList.toggle("done", !!(_scrml_each_item.done));');
    expect(clientJs).not.toContain('setAttribute("class:done"');
  });

  test("onclick=fn(@.id) emits a real addEventListener calling the handler with the item field", () => {
    const src = `<program>
<items> = [{id: "a"}]
function pick(id) {
    @items = @items
}

<each in=@items key=@.id>
    <li onclick=pick(@.id)>row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-onclick");
    expect(errors).toEqual([]);
    // onclick lowers to addEventListener("click", ...) — NOT inert
    // setAttribute("onclick", "").
    expect(clientJs).toMatch(/\.addEventListener\("click", function\(event\) \{ /);
    // The handler is invoked with the rewritten item field (@.id -> iter var).
    // The handler name is rewritten to the emitted fn name (_scrml_pick_N).
    expect(clientJs).toMatch(/_scrml_pick_\d+\(_scrml_each_item\.id\);/);
    expect(clientJs).not.toContain('setAttribute("onclick"');
  });

  test("on:NAME namespaced event form lowers to addEventListener on the event name", () => {
    const src = `<program>
<items> = [{id: "a"}]
function handle(id) {
    @items = @items
}

<each in=@items key=@.id>
    <li on:dblclick=handle(@.id)>row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-on-ns");
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/\.addEventListener\("dblclick", function\(event\) \{ /);
    expect(clientJs).not.toContain('setAttribute("on:dblclick"');
  });

  test("data-x=${@.id} attribute interpolation emits the VALUE, not the literal source string", () => {
    const src = `<program>
<items> = [{id: "a"}]

<each in=@items key=@.id>
    <li data-id=\${@.id}>row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-interp");
    expect(errors).toEqual([]);
    // The ${@.id} interpolation lowers to setAttribute("data-id", String(<expr>))
    // where <expr> is the iter-var field — NOT the literalized source string
    // "_scrml_each_item.id" (the Landing 1 bug) and NOT "@.id".
    expect(clientJs).toContain('.setAttribute("data-id", String(_scrml_each_item.id));');
    expect(clientJs).not.toContain('setAttribute("data-id", "_scrml_each_item.id")');
    expect(clientJs).not.toContain('setAttribute("data-id", "@.id")');
  });

  test("@.field bare attribute value (no ${}) emits the VALUE — SPEC §17.7.3 href=@.email", () => {
    const src = `<program>
<items> = [{id: "a", email: "x@y.z"}]

<each in=@items key=@.id>
    <a href=@.email>link</a>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-bare-at");
    expect(errors).toEqual([]);
    // No false E-SCOPE-001 on the bare @. in attribute position (Locus 1).
    expect(errors).toEqual([]);
    // href=@.email lowers to the value, not a literal.
    expect(clientJs).toContain('.setAttribute("href", String(_scrml_each_item.email));');
  });

  test("class:/onclick/${} compose on a single per-item opener (the reproducer)", () => {
    const src = `<program>
type Item:struct = { id: string, name: string, done: boolean }
<items>: Item[] = [{id: "a", name: "Alpha", done: false}]
function toggle(id) {
    @items = @items.map(x => x.id == id ? {...x, done: !x.done} : x)
}

<ul>
    <each in=@items key=@.id>
        <li class:done=@.done onclick=toggle(@.id) data-id=\${@.id}>
            \${@.name}
        </li>
    </each>
</ul>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-compose");
    // The whole reproducer compiles with no errors (was E-SCOPE-001 pre-fix).
    expect(errors).toEqual([]);
    expect(clientJs).toContain('.classList.toggle("done", !!(_scrml_each_item.done));');
    expect(clientJs).toMatch(/_scrml_toggle_\d+\(_scrml_each_item\.id\);/);
    expect(clientJs).toContain('.setAttribute("data-id", String(_scrml_each_item.id));');
    expect(clientJs).toContain("String(_scrml_each_item.name)");
  });

  test("literal string attrs still copy verbatim (no regression)", () => {
    const src = `<program>
<items> = [{id: "a"}]

<each in=@items key=@.id>
    <li title="static label">row</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-literal");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('.setAttribute("title", "static label");');
  });

  test("of= count form: @. index resolves in attribute position", () => {
    const src = `<program>
function clk(i) {
    let x = i
}

<each of=3>
    <li onclick=clk(@.) data-i=\${@.}>slot</li>
</each>

</program>`;
    const { errors, clientJs } = compileToOutputs(src, "l2-of-index");
    expect(errors).toEqual([]);
    // @. (the index) rewrites to the iter var in both handler arg + interp.
    // Bug 73 (S159) — the per-item handler is now LIVE-KEYED: it re-resolves the
    // current item by its create-time key at fire time (prepended prelude +
    // null-guard) before reading the iter var, so a same-key reconcile fires the
    // handler with live data, not the create-time snapshot. The iter-var read in
    // the handler arg is preserved (it now resolves to the re-bound `let`).
    expect(clientJs).toMatch(/\.addEventListener\("click", function\(event\) \{ let _scrml_each_item = _scrml_resolve_item\(_mount, _scrml_each_key_\d+\); if \(_scrml_each_item === null\) return; _scrml_clk_\d+\(_scrml_each_item\); \}\)/);
    expect(clientJs).toContain('.setAttribute("data-i", String(_scrml_each_item));');
  });
});

// ---------------------------------------------------------------------------
// g-each-body-bare-variant-arg (S201) — a bare `.Variant` enum literal as an
// event-handler call-ARG in an <each> per-item body must lower to its frozen
// string (the Tier-0/static/<match> lowering, previously MISSING in emit-each.ts
// → raw `.InProgress` leaked → E-CODEGEN-INVALID-LOGIC).
// ---------------------------------------------------------------------------
describe("g-each-body-bare-variant-arg — bare .Variant call-arg lowering", () => {
  test("bare .Variant call-arg lowers to its frozen string (non-engine handler)", () => {
    const src = `type Status:enum = { Todo, InProgress, Done }
type Card:struct = { id: int, status: Status }
<cards>: Card[] = []
\${ function moveTo(id: int, s: Status) { } }
<ul>
    <each in=@cards as card>
        <li><button onclick=moveTo(card.id, .InProgress)>Start</button></li>
    </each>
</ul>`;
    const { errors, clientJs } = compileToOutputs(src, "ebv-bare");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    // The bare-variant is lowered to its frozen string, not left raw.
    expect(clientJs).toContain('"InProgress"');
    expect(clientJs).not.toMatch(/moveTo_\d+\([^)]*\.InProgress/);
  });

  test("engine .advance(.X) in an each body still lowers via the engine path (regression)", () => {
    const src = `type Phase:enum = { Idle, Active, Done }
type Card:struct = { id: int }
<cards>: Card[] = []
<engine for=Phase initial=.Idle>
    <Idle rule=.Active>idle</>
    <Active rule=.Done>active</>
    <Done>done</>
</engine>
<ul>
    <each in=@cards as card>
        <li><button onclick=@phase.advance(.Active)>Go</button></li>
    </each>
</ul>`;
    const { errors, clientJs } = compileToOutputs(src, "ebv-engine");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    // The engine transition routes through the canonical engine machinery — NOT
    // the bare-variant string-lowering fallback (the engine path keeps the raw
    // callText so `.advance(.X)` variant detection still fires).
    expect(clientJs).toContain('_scrml_engine_advance("phase", "Active"');
    expect(clientJs).not.toContain('advance("Active")');
  });
});
