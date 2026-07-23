/**
 * g-tablefor-column-slot-literal-interp.browser.test.js
 *
 * Regression gate for change-id `ss21-tablefor-column-slot-interp-2026-06-25`
 * (sPA ss21 item 2).
 *
 * BUG: a `<tableFor>` `<column>` slot whose body carries a `${...}` interpolation
 * inside markup (`<code>${@row.name}</code>` / `:let={(row) => <code>${row.name}
 * </code>}`) rendered the LITERAL interpolation source to the DOM. The tableFor
 * column slot delivers its interpolation as a RAW markup TEXT child (the type-
 * system column walk parses the slot body separately), unlike inline
 * `<code>${u.x}</code>` markup which the normal parser splits into a
 * `<logic><bare-expr>` child. emit-lift's `emitCreateElementFromMarkup` renders
 * a raw text child's `${...}` LITERALLY inside a reconcile factory (the ss20
 * text-child interp lowering is gated `!currentLiftReconcileCtx()` and
 * DELIBERATELY skips the each/reconcile path), so the synth `for (row of …)`
 * lift factory shipped `appendChild(document.createTextNode("${@row.name}"))`.
 * Clean compile, non-render — masked by the WEAK assertion `js.toContain(
 * "row.name")` (a substring of the literal `"${@row.name}"`).
 *
 * FIX (emit-table-for.ts `rewriteAtDotInNode` → `rewriteAtDotInNodeExpand`): the
 * column-slot AST rewriter SPLITS markup TEXT children carrying `${...}` into
 * alternating literal-text + `<logic><bare-expr>` nodes (the §17.X each-side
 * prior art `splitEachMarkupTextChildren` applied to the tableFor column slot),
 * iter-scope-lowering each interpolation interior via `rewriteAtDotInExprText`
 * so `@row.field` / `@.field` resolve to the loop-local `row` binding. emit-lift's
 * already-correct logic-block reconcile branch then renders each interpolation as
 * a LIVE-KEYED reactive text node (a stable text node + `_scrml_effect` that
 * re-resolves the item by key) — identical in shape to the working inline
 * `${for…lift}` markup-interp path and the `<each>` body.
 *
 * Compile-clean is NOT enough (S140/S152/S215): this test loads the emitted
 * client.js AS-IS in real module-init order and asserts the rendered cell shows
 * the row's VALUE (and live-updates on field mutation + keyed reconcile), NOT the
 * literal `${@row.name}` string. Pre-fix the value assertions FAIL.
 *
 * Models: g-emit-lift-markup-text-interp.browser.test.js (ss20 sibling harness)
 *         + tablefor-perrow-onchange-evt-bug-59.test.js (tableFor mount/drive).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

// --- THE bug: implicit `@row` children-bearing column slot (§41.16.10). ---
const AT_ROW_SRC = `\${
  import { tableFor } from 'scrml:data'
  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
  <tableFor for=User rows=@users>
    <column field="name">
      <code>\${@row.name}</code>
    </column>
  </tableFor>
</program>
`;

// --- the §41.16.3 parametric `:let={(row) => …}` form (SAME root cause). ---
const LET_SRC = `\${
  import { tableFor } from 'scrml:data'
  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
  <tableFor for=User rows=@users>
    <column field="name" :let={(row) => <code>\${row.name}</code>}/>
  </tableFor>
</program>
`;

// --- adversarial (S215): multi-field interp + nested-object field in one slot. ---
//
// Separators carry non-whitespace (` - `, ` (`, `)`) deliberately: a literal
// text segment that is whitespace-ONLY (a single space between two adjacent
// `${}`) is dropped by emit-lift's `emitCreateElementFromMarkup` text branch
// (`text.trim()` gate) — a PRE-EXISTING generic emit-lift behavior that affects
// the canonical inline `${for…lift}` path IDENTICALLY (verified: `<code>${a}
// ${b}</code>` drops the space there too), NOT introduced by this fix. Using a
// punctuated separator keeps the assertion deterministic and tests the fix
// (multi-`${}` lowering + nested-field access) rather than that orthogonal gap.
// `omit=` excludes the auto-rendered id/last/meta columns (meta is a nested
// struct → would otherwise need its own slot per §41.16.6); the row binding
// still exposes the full object so `@row.last` / `@row.meta.note` resolve.
const ADVERSARIAL_SRC = `\${
  import { tableFor } from 'scrml:data'
  type Meta:struct = {
    note: string
  }
  type User:struct = {
    id:    integer
    first: string req
    last:  string req
    meta:  Meta
  }
}
<program>
  <users> = [{ id: 1, first: "Ada", last: "Lovelace", meta: { note: "pioneer" } }, { id: 2, first: "Alan", last: "Turing", meta: { note: "codebreaker" } }]
  <tableFor for=User rows=@users omit=["id", "last", "meta"]>
    <column field="first">
      <code>\${@row.first} - \${@row.last} (\${@row.meta.note})</code>
    </column>
  </tableFor>
</program>
`;

// --- regression: a genuine outer `@cell` inside a slot keeps its reactive read
//     (the `@row` rewrite is scoped to the EXACT row binding only). ---
const AT_CELL_SRC = `\${
  import { tableFor } from 'scrml:data'
  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = [{ id: 1, name: "Alice" }]
  <suffix> = "!"
  <tableFor for=User rows=@users>
    <column field="name">
      <code>\${@row.name}\${@suffix}</code>
    </column>
  </tableFor>
</program>
`;

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "tf-col-interp-"));
  try {
    const abs = join(dir, "t.scrml");
    writeFileSync(abs, src);
    const result = compileScrml({
      inputFiles: [abs],
      outputDir: join(dir, "dist"),
      write: false,
      log: () => {},
    });
    let html = "";
    let clientJs = "";
    for (const [, v] of (result.outputs || [])) {
      if (typeof v === "object" && v) {
        if (v.html) html = v.html;
        if (v.clientJs) clientJs = v.clientJs;
      }
    }
    const realErrors = (result.errors || []).filter(
      (e) => e && e.severity !== "warning" && e.severity !== "info",
    );
    return { realErrors, html, clientJs };
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function mount(clientJs, html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = cleanHtml;
  const code =
    `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return {
    get: (name) => window._scrml_reactive_get(name),
    set: (name, val) => window._scrml_reactive_set(name, val),
    cellTexts: () =>
      Array.from(document.querySelectorAll("code")).map((c) => c.textContent),
  };
}

// ---------------------------------------------------------------------------
// §1 — emit shape: the column-slot `${@row.X}` TEXT child lowers to a LIVE-KEYED
//      reactive text node (`row.X`), NOT a literal `${@row.X}` createTextNode
//      string and NOT a `_scrml_reactive_get("row")` cell read.
// ---------------------------------------------------------------------------

describe("g-tablefor-column-slot-literal-interp §1 — emit shape (interp lowered, not literal)", () => {
  test("`@row` form compiles with no errors", () => {
    expect(compileSource(AT_ROW_SRC).realErrors).toEqual([]);
  });

  test("`@row` form: the `${@row.name}` text child is NOT shipped as a literal createTextNode string", () => {
    const { clientJs } = compileSource(AT_ROW_SRC);
    // Pre-fix this exact literal shipped to the DOM.
    expect(clientJs).not.toContain('createTextNode("${@row.name}")');
    expect(clientJs).not.toContain('createTextNode("${row.name}")');
    expect(clientJs).not.toMatch(/createTextNode\("[^"]*\$\{/);
  });

  test("`@row` form lowers to the loop-local `row.name` live-keyed effect (not a `row` cell read)", () => {
    const { clientJs } = compileSource(AT_ROW_SRC);
    expect(clientJs).toContain('String((row.name) ?? "")');
    expect(clientJs).toContain("_scrml_resolve_item(");
    // The bug surface: a reactive read of a nonexistent "row" cell.
    expect(clientJs).not.toContain('_scrml_reactive_get("row")');
  });

  test("`:let` form (§41.16.3) lowers identically (same root cause, one fix)", () => {
    const { clientJs, realErrors } = compileSource(LET_SRC);
    expect(realErrors).toEqual([]);
    expect(clientJs).not.toMatch(/createTextNode\("[^"]*\$\{/);
    expect(clientJs).toContain('String((row.name) ?? "")');
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: the rendered cell shows the row VALUE and live-updates
//      on field mutation + keyed reconcile (reorder/replace). Real init order.
// ---------------------------------------------------------------------------

describe("g-tablefor-column-slot-literal-interp §2 — post-mount render (real module-init order)", () => {
  test("THE bug (`@row` form): the column cell renders the row VALUE, not the literal `${@row.name}`", () => {
    const { clientJs, html } = compileSource(AT_ROW_SRC);
    const app = mount(clientJs, html);
    expect(app.cellTexts()).toEqual(["Alice", "Bob"]);
    for (const t of app.cellTexts()) expect(t).not.toContain("${");
  });

  test("reactivity (in-place field mutation): mutating a row's field updates its cell", () => {
    const { clientJs, html } = compileSource(AT_ROW_SRC);
    const app = mount(clientJs, html);
    expect(app.cellTexts()).toEqual(["Alice", "Bob"]);
    // Deep-reactive in-place mutation of the live row.
    app.get("users")[0].name = "Ada";
    expect(app.cellTexts()).toEqual(["Ada", "Bob"]);
  });

  test("reactivity (keyed reconcile): reorder + replace re-renders the right values by key", () => {
    const { clientJs, html } = compileSource(AT_ROW_SRC);
    const app = mount(clientJs, html);
    expect(app.cellTexts()).toEqual(["Alice", "Bob"]);
    // Same keys, reordered + renamed → reconcile reuses nodes by id, cells update.
    app.set("users", [{ id: 2, name: "Bobby" }, { id: 1, name: "Alanna" }]);
    expect(app.cellTexts()).toEqual(["Bobby", "Alanna"]);
    for (const t of app.cellTexts()) expect(t).not.toContain("${");
  });

  test("reactivity (append a new row): a freshly-added row renders its value", () => {
    const { clientJs, html } = compileSource(AT_ROW_SRC);
    const app = mount(clientJs, html);
    app.set("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
    expect(app.cellTexts()).toEqual(["Alice", "Bob", "Carol"]);
  });

  test("`:let` form: the parametric-slot cell renders the row VALUE + updates", () => {
    const { clientJs, html } = compileSource(LET_SRC);
    const app = mount(clientJs, html);
    expect(app.cellTexts()).toEqual(["Alice", "Bob"]);
    app.get("users")[1].name = "Robert";
    expect(app.cellTexts()).toEqual(["Alice", "Robert"]);
  });

  // --- adversarial (S215): multi-field + nested-object interpolation in one slot.

  test("adversarial: multi-field + nested-object interpolation renders every value", () => {
    const { clientJs, html, realErrors } = compileSource(ADVERSARIAL_SRC);
    expect(realErrors).toEqual([]);
    const app = mount(clientJs, html);
    expect(app.cellTexts()).toEqual([
      "Ada - Lovelace (pioneer)",
      "Alan - Turing (codebreaker)",
    ]);
    for (const t of app.cellTexts()) expect(t).not.toContain("${");
  });

  test("adversarial: mutating one of several fields updates only that segment", () => {
    const { clientJs, html } = compileSource(ADVERSARIAL_SRC);
    const app = mount(clientJs, html);
    app.get("users")[0].last = "Byron";
    expect(app.cellTexts()[0]).toBe("Ada - Byron (pioneer)");
    // sibling row untouched
    expect(app.cellTexts()[1]).toBe("Alan - Turing (codebreaker)");
  });

  // --- regression: a genuine outer `@cell` in the slot keeps its reactive read.

  test("regression (@cell preservation): a genuine outer cell in the slot reads reactively + the row field is loop-local", () => {
    const { clientJs, html } = compileSource(AT_CELL_SRC);
    // The genuine outer cell `@suffix` still reads reactively; the row field does not.
    expect(clientJs).toContain('_scrml_reactive_get("suffix")');
    expect(clientJs).not.toContain('_scrml_reactive_get("row")');
    const app = mount(clientJs, html);
    expect(app.cellTexts()).toEqual(["Alice!"]);
    // Mutate the outer cell → the cell text updates.
    app.set("suffix", "?");
    expect(app.cellTexts()).toEqual(["Alice?"]);
  });
});
