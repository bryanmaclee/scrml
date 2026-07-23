/**
 * tablefor-perrow-onchange-evt-bug-59.test.js — Bug 59 regression guard.
 *
 * Bug 59 (HIGH silent-miscompile, S140): the PER-ROW checkbox `onchange`
 * handler emitted for `<tableFor selectable=@cell>` reads:
 *
 *   _scrml_lift_el_N.addEventListener("change", function(event) {
 *     if (evt !== null && evt !== undefined) { ... }   // <-- free `evt`
 *   });
 *
 * The function param is `event` but the body references the free var `evt`
 * → `ReferenceError: evt is not defined` on EVERY per-row toggle. Compile
 * exits 0 and `node --check` passes (the reference is only resolved at run
 * time), so the miscompile is silent.
 *
 * Root cause — RESIDUAL of Bug 50 (RESOLVED S138 `c89f1176`, which patched
 * only `emit-event-wiring.ts`, the DELEGATED master-checkbox path):
 *
 *   emit-table-for.ts:buildRowCheckboxCell synthesizes the per-row onchange
 *   as a raw arrow-string attribute value `{ kind:"expr", raw:"(evt) => {…}" }`
 *   with NO `exprNode`. In emit-lift.js the markup-AST onevent path
 *   (`val.kind === "expr"`, ~L745/760) routes the raw string through
 *   `emitExprField(undefined, raw, …)` → `rewriteExprWithDerived` → Pass 1
 *   `rewritePresenceGuard`, which matches `( ident ) => { body }` as a §42
 *   presence-guard and rewrites it to `if (evt !== null && evt !== undefined)
 *   { body }`. That `if`-statement is no longer callable, so the wrapper
 *   `function(event) { … }` is applied → `evt` becomes a free var.
 *
 * Fix — mirror the Bug-50 fix at the uncovered emit-lift onevent paths: when
 * the handler SOURCE is an arrow/function-expression and there is no
 * structured exprNode, route through `rewriteExprArrowBody` (skips Pass 1
 * presence-guard) instead of `emitExprField`. The master-checkbox (delegated)
 * path was already correct.
 *
 * Coverage:
 *   §1 emit-regression — per-row handler has NO free `evt`; binds param
 *      consistently; `function(event){ if (evt !==` pattern is GONE.
 *   §2 emit-regression — master/header handler still correct (unaffected).
 *   §3 happy-dom runtime drive — dispatch a per-row checkbox `change` event:
 *      no throw + the row's PK is toggled in @selectedIds.
 *   §4 happy-dom runtime drive — toggling a SECOND row accumulates both PKs;
 *      re-toggling the first removes only its PK.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

// `<tableFor selectable=@selectedIds>` over a pre-seeded `users` list so the
// per-row checkboxes render at mount (lift item factory runs over real rows).
const SOURCE = `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }]
  <selectedIds>: integer[] = []
  <tableFor for=User rows=@users selectable=@selectedIds/>
</program>
`;

function compileSource() {
  const dir = mkdtempSync(join(tmpdir(), "bug-59-"));
  try {
    const abs = join(dir, "perrow.scrml");
    const { writeFileSync } = require("fs");
    writeFileSync(abs, SOURCE);
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
    return { result, html, clientJs };
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1: emit-regression — per-row handler has NO free `evt`
// ---------------------------------------------------------------------------

describe("Bug 59 §1: per-row onchange handler has no free `evt`", () => {
  test("emitted per-row handler does NOT wrap `function(event) { if (evt !==`", () => {
    const { clientJs } = compileSource();
    // The exact pre-fix symptom shape: a function(event) wrapper whose body
    // opens with the `evt`-referencing presence guard.
    expect(clientJs).not.toMatch(/function\s*\(\s*event\s*\)\s*\{\s*if\s*\(\s*evt\s*!==/);
  });

  test("no `evt !== null && evt !== undefined` presence-guard leaks into emit", () => {
    const { clientJs } = compileSource();
    // The synth arrow `(evt) => {…}` must NOT be rewritten into the §42
    // presence-guard form anywhere in the per-row lift output.
    expect(clientJs).not.toMatch(/evt\s*!==\s*null\s*&&\s*evt\s*!==\s*undefined/);
  });

  test("per-row change listener binds the event param consistently", () => {
    const { clientJs } = compileSource();
    // The per-row checkbox wires a "change" listener.
    expect(clientJs).toMatch(/addEventListener\(\s*"change"/);
    // The per-row handler still writes selectedIds (toggle body preserved).
    expect(clientJs).toContain('_scrml_reactive_set("selectedIds"');
    expect(clientJs).toContain("row.id");
  });
});

// ---------------------------------------------------------------------------
// §2: emit-regression — master/header handler unaffected
// ---------------------------------------------------------------------------

describe("Bug 59 §2: master-checkbox (delegated) handler unaffected", () => {
  test("emitted client JS passes a syntax check (new Function)", () => {
    const { clientJs } = compileSource();
    const wrapped = `
      var _scrml_reactive_get = function () { return []; };
      var _scrml_reactive_set = function () {};
      var _scrml_reactive_subscribe = function () {};
      var _scrml_derived_get = function () { return []; };
      var _scrml_effect = function () {};
      var _scrml_effect_static = function () {};
      var _scrml_deep_reactive = function (x) { return x; };
      var _scrml_init_set = function () {};
      var _scrml_lift = function () {};
      var _scrml_lift_target = null;
      var _scrml_reconcile_list = function () {};
      var _scrml_stdlib = { data: { tableFor: function () {} } };
      var document = { addEventListener: function () {}, querySelector: function () { return { addEventListener: function(){}, appendChild: function(){} }; }, querySelectorAll: function () { return []; }, createElement: function () { return { setAttribute: function(){}, appendChild: function(){}, addEventListener: function(){} }; }, createDocumentFragment: function () { return { appendChild: function(){}, firstChild: {} }; }, createTextNode: function () { return {}; } };
      ${clientJs}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3 + §4: happy-dom runtime drive — per-row toggle mutates @selectedIds
// ---------------------------------------------------------------------------

function mount(clientJs, html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  document.body.innerHTML = cleanHtml;

  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n`) + `\n})();`;
  eval(code);

  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (name) => window._scrml_reactive_get(name),
  };
}

function rowCheckboxes() {
  return Array.from(
    document.querySelectorAll('input[data-scrml-tablefor-row-select="true"]'),
  );
}

describe("Bug 59 §3: per-row checkbox change toggles @selectedIds — no throw", () => {
  test("dispatching change on the first per-row checkbox adds its PK", () => {
    const { clientJs, html } = compileSource();
    const api = mount(clientJs, html);

    const boxes = rowCheckboxes();
    expect(boxes.length).toBe(3); // one per seeded row

    expect(api.get("selectedIds")).toEqual([]);

    // The bug: this dispatch threw `ReferenceError: evt is not defined`.
    expect(() => {
      boxes[0].dispatchEvent(new Event("change", { bubbles: true }));
    }).not.toThrow();

    expect(api.get("selectedIds")).toEqual([1]);
  });
});

describe("Bug 59 §4: multiple per-row toggles accumulate + remove correctly", () => {
  test("toggling row-2 then row-3 accumulates both PKs; re-toggling row-2 removes it", () => {
    const { clientJs, html } = compileSource();
    const api = mount(clientJs, html);

    const boxes = rowCheckboxes();
    expect(boxes.length).toBe(3);

    boxes[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(api.get("selectedIds")).toEqual([2]);

    boxes[2].dispatchEvent(new Event("change", { bubbles: true }));
    expect(api.get("selectedIds")).toEqual([2, 3]);

    // Re-toggle row-2 (it is already in the set) → removed; row-3 stays.
    boxes[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(api.get("selectedIds")).toEqual([3]);
  });
});
