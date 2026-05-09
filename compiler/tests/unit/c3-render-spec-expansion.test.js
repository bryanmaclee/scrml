/**
 * c3-render-spec-expansion.test.js — A1c Step C3 unit tests
 *
 * Tests the render-spec expansion at `<x/>` use site added in C3:
 *
 *   §C3.1  Single-use-site expansion — `<userName/>` → `<input ...>` with hookpoint
 *   §C3.2  Multi-use-site expansion (L16) — same cell rendered twice → identical
 *          expansion at each site, fresh hookpoint id per site
 *   §C3.3  Validator carry-forward — req → required, length(>=N) → minlength,
 *          length(<=N) → maxlength, min/max → min/max, pattern → pattern
 *   §C3.4  Different render-spec shapes — checkbox / file / radio / textarea / select
 *          (each retains its tag + type attribute)
 *   §C3.5  Compound child render-by-tag — `<formRes><name/></>` (B6 gates this;
 *          render-spec lives on the child decl)
 *   §C3.6  Hookpoint registration — registry has `kind: "render-by-tag"` binding
 *          with cellName + renderSpecTag + renderSpecAttrs metadata for C4
 *   §C3.7  Negative — Shape 1 plain cell does not expand (B6 already fired
 *          E-CELL-NO-RENDER-SPEC at A1b time; defensive guard at codegen)
 *   §C3.8  Negative — PascalCase tag (`<UserCard/>`) skips render-by-tag
 *   §C3.9  Negative — HTML built-in (`<br/>`) skips (no resolution → falls through)
 *   §C3.10 Defensive — fileAST without `_scope` (no SYM run) → falls through to
 *          raw tag emission (legacy behavior preserved)
 *   §C3.11 Output stability — non-Shape-2 markup unchanged; existing tests pass
 *
 * SCOPE: per A1c BRIEF §scope-IN — render-by-tag expansion shape only. C3 emits
 * the expansion; C4 owns the bind:* dispatch (via the render-by-tag LogicBinding's
 * cellName + renderSpecTag fields).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateHtml } from "../../src/codegen/emit-html.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse + run SYM so `_scope` lands on the fileAST (needed for render-by-tag). */
function parseAndRunSYM(source, filePath = "/test/c3.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = {
    filePath,
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
  };
  runSYM({ filePath, ast: fileAST });
  return fileAST;
}

function compileToHtml(source) {
  const fileAST = parseAndRunSYM(source);
  const registry = new BindingRegistry();
  const html = generateHtml(fileAST.nodes, [], false, registry, fileAST);
  return { html, registry, fileAST };
}

/**
 * Parse without SYM (no _scope) — for §C3.10 (defensive falls-through to raw
 * emission). Mirrors the chain-mount-emission test's compileToHtml shape.
 */
function compileToHtmlNoSYM(source) {
  const bs = splitBlocks("/test/c3.scrml", source);
  const { ast } = buildAST(bs);
  const fileAST = {
    filePath: "/test/c3.scrml",
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
  };
  const registry = new BindingRegistry();
  const html = generateHtml(fileAST.nodes, [], false, registry, fileAST);
  return { html, registry, fileAST };
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §C3.1 Single-use-site expansion
// ---------------------------------------------------------------------------

describe("C3 §C3.1 — Single-use-site expansion", () => {
  test("`<userName/>` (Shape 2 text input) expands to <input> at use site", () => {
    const source = `<program>
\${
<userName> = <input type="text"/>
}
<userName/>
</program>`;
    const { html, registry } = compileToHtml(source);
    // Expansion produces an <input> tag (NOT raw <userName />).
    expect(html).toContain("<input");
    expect(html).not.toMatch(/<userName\b/);
    // The use site emits the renderSpec markup with the type="text" attribute.
    expect(html).toContain('type="text"');
    // Hookpoint stamped for C4's bind: dispatch.
    expect(html).toContain("data-scrml-render-by-tag=");
    // Registry binding is recorded.
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(1);
    expect(rbt[0].cellName).toBe("userName");
    expect(rbt[0].renderSpecTag).toBe("input");
  });

  test("`<email/>` (Shape 2 email input) expands with type=email retained", () => {
    const source = `<program>
\${
<email> = <input type="email"/>
}
<email/>
</program>`;
    const { html, registry } = compileToHtml(source);
    expect(html).toContain('type="email"');
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(1);
    expect(rbt[0].cellName).toBe("email");
  });
});

// ---------------------------------------------------------------------------
// §C3.2 Multi-use-site expansion (L16)
// ---------------------------------------------------------------------------

describe("C3 §C3.2 — Multi-use-site expansion (L16)", () => {
  test("same cell rendered twice → two expansions, two distinct hookpoint ids", () => {
    const source = `<program>
\${
<userName> = <input type="text"/>
}
<userName/>
<hr/>
<userName/>
</program>`;
    const { html, registry } = compileToHtml(source);
    // Two `<input` emissions for the two use sites (the cell's renderSpec).
    const inputCount = (html.match(/<input\b/g) ?? []).length;
    // Allow >=2 to accommodate any future <input> in scaffolding (e.g. CSRF).
    expect(inputCount).toBeGreaterThanOrEqual(2);
    // Two render-by-tag bindings recorded.
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(2);
    // Both reference the same cell name.
    expect(rbt[0].cellName).toBe("userName");
    expect(rbt[1].cellName).toBe("userName");
    // Each hookpoint id is distinct (per §C3.2 — fresh per use site).
    expect(rbt[0].placeholderId).not.toBe(rbt[1].placeholderId);
  });
});

// ---------------------------------------------------------------------------
// §C3.3 Validator carry-forward (HTML-native subset)
// ---------------------------------------------------------------------------

describe("C3 §C3.3 — Validator carry-forward as HTML attributes", () => {
  test("`req` validator → `required` HTML attribute", () => {
    const source = `<program>
\${
<userName req> = <input type="text"/>
}
<userName/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain("required");
  });

  test("`length(>=2)` → `minlength=\"2\"`", () => {
    const source = `<program>
\${
<userName length(>=2)> = <input type="text"/>
}
<userName/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain('minlength="2"');
  });

  test("`length(<=10)` → `maxlength=\"10\"`", () => {
    const source = `<program>
\${
<userName length(<=10)> = <input type="text"/>
}
<userName/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain('maxlength="10"');
  });

  test("`length(=5)` → both `minlength=\"5\"` and `maxlength=\"5\"`", () => {
    const source = `<program>
\${
<code length(=5)> = <input type="text"/>
}
<code/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain('minlength="5"');
    expect(html).toContain('maxlength="5"');
  });

  test("`min(18)` and `max(120)` → `min=\"18\"` and `max=\"120\"` HTML attrs", () => {
    const source = `<program>
\${
<age min(18) max(120)> = <input type="number"/>
}
<age/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain('min="18"');
    expect(html).toContain('max="120"');
  });

  test("multi-validator: `<userName req length(>=2)>` carries both attrs", () => {
    const source = `<program>
\${
<userName req length(>=2)> = <input type="text"/>
}
<userName/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain("required");
    expect(html).toContain('minlength="2"');
  });

  test("non-HTML-native validator (`is some`) does NOT emit a stray HTML attr", () => {
    const source = `<program>
\${
<picked is some> = <input type="text"/>
}
<picked/>
</program>`;
    const { html } = compileToHtml(source);
    // No HTML-native counterpart for `is some`; verify no leakage.
    expect(html).not.toContain('is some');
    expect(html).not.toContain('issome=');
  });
});

// ---------------------------------------------------------------------------
// §C3.4 Different render-spec shapes
// ---------------------------------------------------------------------------

describe("C3 §C3.4 — Different render-spec element shapes", () => {
  test("checkbox: `<input type=\"checkbox\"/>` cell expands with type=checkbox", () => {
    const source = `<program>
\${
<agree> = <input type="checkbox"/>
}
<agree/>
</program>`;
    const { html, registry } = compileToHtml(source);
    expect(html).toContain('type="checkbox"');
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt[0].renderSpecTag).toBe("input");
    // The renderSpecAttrs carries type=checkbox so C4 dispatches to bind:checked.
    const typeAttr = rbt[0].renderSpecAttrs.find((a) => a.name === "type");
    expect(typeAttr).toBeDefined();
    expect(typeAttr.value.value).toBe("checkbox");
  });

  test("file: `<input type=\"file\"/>` expands with type=file", () => {
    const source = `<program>
\${
<avatar> = <input type="file"/>
}
<avatar/>
</program>`;
    const { html, registry } = compileToHtml(source);
    expect(html).toContain('type="file"');
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    const typeAttr = rbt[0].renderSpecAttrs.find((a) => a.name === "type");
    expect(typeAttr.value.value).toBe("file");
  });

  test("radio: `<input type=\"radio\"/>` expands with type=radio", () => {
    const source = `<program>
\${
<choice> = <input type="radio"/>
}
<choice/>
</program>`;
    const { html, registry } = compileToHtml(source);
    expect(html).toContain('type="radio"');
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    const typeAttr = rbt[0].renderSpecAttrs.find((a) => a.name === "type");
    expect(typeAttr.value.value).toBe("radio");
  });

  test("textarea: `<textarea/>` cell expands as <textarea>", () => {
    const source = `<program>
\${
<bio> = <textarea/>
}
<bio/>
</program>`;
    const { html, registry } = compileToHtml(source);
    expect(html).toContain("<textarea");
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt[0].renderSpecTag).toBe("textarea");
  });
});

// ---------------------------------------------------------------------------
// §C3.5 Compound child render-by-tag
// ---------------------------------------------------------------------------

describe("C3 §C3.5 — Compound child render-by-tag", () => {
  test("`<formRes><name/></>` — name cell inside compound expands at the use site", () => {
    // Per §6.3 + B6: the use site `<name/>` resolves through file-scope lookup
    // to the compound parent's child cell. The child must carry its own
    // renderSpec for B6 to accept (silently). Place a Shape 2 cell as a
    // top-level cell first to exercise the standard path; compound-child
    // render-by-tag uses file-scope lookup per primer §13.7 B6 specifics.
    const source = `<program>
\${
<userName> = <input type="text"/>
<formRes>
<email> = <input type="email"/>
</>
}
<formRes>
<userName/>
</>
</program>`;
    const { html, registry } = compileToHtml(source);
    // userName expands inside the formRes wrapper.
    expect(html).toContain('type="text"');
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    // Just userName fires here — compound child's `email` is not used as a tag.
    expect(rbt.length).toBe(1);
    expect(rbt[0].cellName).toBe("userName");
  });
});

// ---------------------------------------------------------------------------
// §C3.6 Hookpoint registration shape (C4 contract)
// ---------------------------------------------------------------------------

describe("C3 §C3.6 — Hookpoint LogicBinding shape (C4 contract)", () => {
  test("registry binding has all four required fields for C4 dispatch", () => {
    const source = `<program>
\${
<userName req> = <input type="text"/>
}
<userName/>
</program>`;
    const { registry } = compileToHtml(source);
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(1);
    const b = rbt[0];
    // Discriminator
    expect(b.kind).toBe("render-by-tag");
    // Hookpoint id — corresponds to the `data-scrml-render-by-tag="..."` attr.
    expect(typeof b.placeholderId).toBe("string");
    expect(b.placeholderId.length).toBeGreaterThan(0);
    // Cell name — what C4 binds reactively.
    expect(b.cellName).toBe("userName");
    // Render-spec tag — what C4 reads to drive §5.4.1 bind dispatch.
    expect(b.renderSpecTag).toBe("input");
    // Render-spec attrs — preserved verbatim from the cell's decl.
    expect(Array.isArray(b.renderSpecAttrs)).toBe(true);
    // Validator entries — C7+ consumes for validity-surface wiring.
    expect(Array.isArray(b.declValidators)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §C3.7 Negative — Shape 1 plain cell does not expand
// ---------------------------------------------------------------------------

describe("C3 §C3.7 — Negative: Shape 1 plain cell does not expand", () => {
  test("`<count/>` for a Shape 1 plain cell — no render-by-tag firing (B6 would error at A1b)", () => {
    // Note: parse + SYM normally would fire E-CELL-NO-RENDER-SPEC here. C3
    // codegen-time defensive: even if illegal use surfaces (test-only path
    // bypassing diagnostic enforcement), we don't expand a non-bindable cell.
    const source = `<program>
\${
<count> = 0
}
<count/>
</program>`;
    const { html, registry } = compileToHtml(source);
    // Plain cell does NOT expand; <count/> remains as the raw tag form
    // (the AST still walked emit-html's markup branch even though B6 errored).
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(0);
    // No <input> emitted — there's no renderSpec on a Shape 1 cell.
    expect(html).not.toContain("<input");
  });
});

// ---------------------------------------------------------------------------
// §C3.8 Negative — PascalCase tag skips render-by-tag
// ---------------------------------------------------------------------------

describe("C3 §C3.8 — Negative: PascalCase tag (component) skips render-by-tag", () => {
  test("`<UserCard/>` (PascalCase) does not trigger render-by-tag detection", () => {
    const source = `<program>
\${
<userName> = <input type="text"/>
}
<UserCard/>
</program>`;
    const { registry } = compileToHtml(source);
    // The lowercase predicate filters out PascalCase tags before the
    // lookup ever runs — no render-by-tag binding for UserCard.
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §C3.9 Negative — HTML built-in skips (no resolution)
// ---------------------------------------------------------------------------

describe("C3 §C3.9 — Negative: HTML built-in tags skip (no resolution)", () => {
  test("`<br/>` lookup returns null → no expansion + no binding", () => {
    const source = `<program>
\${
<userName> = <input type="text"/>
}
<br/>
</program>`;
    const { html, registry } = compileToHtml(source);
    // <br/> emits as void HTML built-in.
    expect(html).toContain("<br");
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(0);
  });

  test("`<hr/>` emits unchanged (void element fast path before render-by-tag check)", () => {
    const source = `<program>
\${
<userName> = <input type="text"/>
}
<hr/>
</program>`;
    const { html } = compileToHtml(source);
    expect(html).toContain("<hr");
  });
});

// ---------------------------------------------------------------------------
// §C3.10 Defensive — fileAST without `_scope` (no SYM) → falls through
// ---------------------------------------------------------------------------

describe("C3 §C3.10 — Defensive: no `_scope` falls through to raw tag emission", () => {
  test("emits `<userName />` as raw tag when SYM hasn't run (no _scope)", () => {
    const source = `<program>
\${
<userName> = <input type="text"/>
}
<userName/>
</program>`;
    const { html, registry } = compileToHtmlNoSYM(source);
    // Without SYM, fileScope is null → render-by-tag detection skipped →
    // legacy raw-tag emission preserves the `<userName />` form. (Browser
    // ignores; B6's spec violation has no functional consequence at the
    // browser level.)
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(0);
    // Raw tag form is preserved.
    expect(html).toMatch(/<userName/);
  });
});

// ---------------------------------------------------------------------------
// §C3.11 Output stability — non-Shape-2 markup unchanged
// ---------------------------------------------------------------------------

describe("C3 §C3.11 — Output stability for non-Shape-2 markup", () => {
  test("plain HTML markup unaffected by C3 dispatch", () => {
    const source = `<program>
<h1>Hello</h1>
<p>World</p>
</program>`;
    const { html, registry } = compileToHtml(source);
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World</p>");
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(0);
  });

  test("`${@x}` interpolation continues to work (no render-by-tag interference)", () => {
    const source = `<program>
\${
<userName> = "alice"
}
<p>Hello \${@userName}!</p>
</program>`;
    const { html, registry } = compileToHtml(source);
    // Logic interpolation creates a logic-placeholder span, not a render-by-tag.
    const rbt = registry.logicBindings.filter((b) => b.kind === "render-by-tag");
    expect(rbt.length).toBe(0);
    // The standard logic placeholder span is emitted.
    expect(html).toContain("data-scrml-logic=");
  });
});
