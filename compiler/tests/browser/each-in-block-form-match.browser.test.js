/**
 * each-in-block-form-match.browser.test.js
 *
 * Regression gate for change-id `each-in-block-form-match-2026-06-01` (S153).
 *
 * BUG (pre-existing, predates the S153 engine-gated-each fix): an `<each>` inside
 * a block-form `<match for=T on=@cell>` arm emitted INVALID JS. The match body is
 * a structural raw-body element — BS captures it as raw text (armsRaw), so the
 * arm-body each was NEVER transformed to an `each-block` AST node (that transform
 * lives in buildAST/ast-builder, not the native parser that emit-match used to
 * re-parse arm bodies). The each rendered as a LITERAL `<each>` string and its
 * `${@.name}` lowered to an unscoped logic binding → `el.textContent = .name;`
 * (E-CODEGEN-INVALID-LOGIC, the `.name` leak). The `as` alias form compiled (valid
 * JS) but ALSO rendered as literal `<each>` text — it never populated either.
 *
 * Three coupled failure modes (all asserted here):
 *   Mode A — invalid JS / no lowering. The each was literal `<each>` text +
 *   `.name` leak (sigil form) or literal `<each>` text (alias form).
 *
 *   Mode B — chunk tree-shake. Even after lowering, detectRuntimeChunks had no
 *   match-block case, so `_scrml_reconcile_list` / `_scrml_remount_each` /
 *   `_scrml_each_renderers` were tree-shaken out of the runtime while the
 *   arm-render code called them → ReferenceError on arm mount.
 *
 *   Mode C — no populate on arm entry. The S153 `_scrml_remount_each(armRoot)`
 *   arm-entry hook IS wired into the shared emitVariantGuardedRender (which
 *   emit-match calls), but an each-in-arm never reached it because of Mode A.
 *
 * FIX (all asserted here):
 *   - emit-match.ts buildMatchArms: each-bearing arm bodies re-parse via
 *     splitBlocks+buildAST (each-block transform applies), ids re-stamped
 *     globally-unique, lifted each-blocks attached to matchBlock.bodyChildren so
 *     emit-each's collectEachBlocks(fileAST) emits their render fn (with the
 *     @.->iter-var rewrite). The arm renders the mount div, not literal text.
 *   - emit-client.ts detectRuntimeChunks: match-block case ships
 *     reconciliation + deep_reactive when an arm holds an each.
 *
 * Per R26 (S138): node-check passes today and the compile exits 0 for the alias
 * form — the OUTPUT was wrong (it never rendered). This suite loads the compiled
 * client.js AS-IS in real module-init order and asserts the list ACTUALLY
 * populates in the DOM after the match dispatches to the each-bearing arm.
 *
 * Models: engine-gated-each-populate.browser.test.js (the S153 sibling fix).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// repro-1: @. contextual sigil form. Pre-populated @todos; a button click sets
// @phase = .Browsing, which the match dispatcher subscribes to. The each is
// inside the Browsing arm with NO <empty> block.
const SIGIL_SRC = `<program>
type Phase:enum = { Loading, Browsing }
type Todo:struct = { id: string, name: string }
<todos>: Todo[] = [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }]
<phase>: Phase = .Loading
<match for=Phase on=@phase>
  <Loading>
    <button onclick=\${@phase = .Browsing}>Go</button>
  </>
  <Browsing>
    <each in=@todos key=@.id>
      <li>\${@.name}</li>
    </each>
  </>
</match>
</program>
`;

// repro-2: `as t` alias form (t.id / t.name instead of @.id / @.name).
const ALIAS_SRC = `<program>
type Phase:enum = { Loading, Browsing }
type Todo:struct = { id: string, name: string }
<todos>: Todo[] = [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }]
<phase>: Phase = .Loading
<match for=Phase on=@phase>
  <Loading>
    <button onclick=\${@phase = .Browsing}>Go</button>
  </>
  <Browsing>
    <each in=@todos as t key=t.id>
      <li>\${t.name}</li>
    </each>
  </>
</match>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-in-match");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — emit shape: no .name leak, mount div (not literal each), helpers ship
// ---------------------------------------------------------------------------

describe("each-in-match §1 — emit shape (no leak, mount div, helpers ship)", () => {
  test("both forms compile with no errors (sigil + alias)", () => {
    expect(compileToOutputs(SIGIL_SRC, "sigil").errors).toEqual([]);
    expect(compileToOutputs(ALIAS_SRC, "alias").errors).toEqual([]);
  });

  test("sigil form: NO bare `.name` leak (Mode A fix)", () => {
    const { clientJs } = compileToOutputs(SIGIL_SRC, "sigil");
    // The pre-fix bug emitted `el.textContent = .name;`.
    expect(clientJs).not.toMatch(/=\s*\.name\b/);
    expect(clientJs).not.toMatch(/textContent\s*=\s*\./);
  });

  test("the Browsing arm renders the each MOUNT DIV, not a literal <each> string (Mode A fix)", () => {
    const { clientJs } = compileToOutputs(SIGIL_SRC, "sigil");
    // The arm render fn returns the mount fence, and there is NO literal <each>
    // tag in any emitted render string.
    expect(clientJs).toMatch(/render_Browsing\(\)\s*\{[\s\S]*?<!--scrml-each:/);
    expect(clientJs).not.toMatch(/<each\b/);
  });

  test("the each renderer reads the source cell + registers itself", () => {
    const { clientJs } = compileToOutputs(SIGIL_SRC, "sigil");
    expect(clientJs).toContain('const _items = _scrml_reactive_get("todos");');
    expect(clientJs).toMatch(/_scrml_each_renderers\["each_\d+"\] = _scrml_each_render_\d+;/);
  });

  test("the match dispatcher invokes _scrml_remount_each after writing the Browsing arm (Mode C fix)", () => {
    const { clientJs } = compileToOutputs(SIGIL_SRC, "sigil");
    expect(clientJs).toMatch(/_mount\.innerHTML = _scrml_match_match_\d+_render_Browsing\(\);[\s\S]*?_scrml_remount_each\(_mount\);/);
  });

  test("alias form: each renderer uses the `t` alias (not @.) and ships a mount div", () => {
    const { clientJs } = compileToOutputs(ALIAS_SRC, "alias");
    expect(clientJs).toContain("t.name");
    expect(clientJs).toMatch(/<!--scrml-each:/);
    expect(clientJs).not.toMatch(/<each\b/);
  });

  test("the runtime ships reconcile_list + remount_each + registry + effect_static (Mode B fix)", () => {
    const { runtimeJs } = compileToOutputs(SIGIL_SRC, "sigil");
    expect(runtimeJs).toContain("function _scrml_reconcile_list");
    expect(runtimeJs).toContain("function _scrml_remount_each");
    expect(runtimeJs).toContain("const _scrml_each_renderers");
    expect(runtimeJs).toContain("function _scrml_effect_static");
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: load client.js AS-IS, list populates on arm entry
// ---------------------------------------------------------------------------

describe("each-in-match §2 — list populates on arm entry (real module-init order)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    // Load the emitted client.js AS-IS — DO NOT hand-order. The real module-init
    // statement sequence is exercised exactly as shipped.
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      matchMount: () => document.querySelector('[data-scrml-match-mount="match_7"]'),
      rows: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode.querySelectorAll('li');}return [];})(),
    };
  }

  test("sigil form: Loading shows no <li>; setting @phase=.Browsing populates the list", () => {
    const app = mount(SIGIL_SRC, "sigil");
    // Initial = Loading arm: button rendered, no each-mount, no <li>.
    expect(app.matchMount().querySelector("button")).not.toBeNull();
    expect(app.rows().length).toBe(0);
    // Drive the transition (same path the onclick hook fires).
    app.set("phase", "Browsing");
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("sigil form: clicking the button (real onclick path) populates the list", () => {
    const app = mount(SIGIL_SRC, "sigil");
    expect(app.rows().length).toBe(0);
    const btn = app.matchMount().querySelector("button");
    btn.click();
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("alias form: setting @phase=.Browsing populates the list via the `t` alias", () => {
    const app = mount(ALIAS_SRC, "alias");
    expect(app.rows().length).toBe(0);
    app.set("phase", "Browsing");
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("ongoing reactivity: mutating @todos while Browsing is visible re-renders", () => {
    const app = mount(SIGIL_SRC, "sigil");
    app.set("phase", "Browsing");
    expect(app.rows().length).toBe(2);
    app.set("todos", [{ id: "z", name: "zeta" }]);
    const rows = app.rows();
    expect(rows.length).toBe(1);
    expect(rows[0].textContent.trim()).toBe("zeta");
  });

  test("idempotent re-entry: Loading -> Browsing -> Loading -> Browsing re-renders correctly", () => {
    const app = mount(SIGIL_SRC, "sigil");
    app.set("phase", "Browsing");
    expect(app.rows().length).toBe(2);
    app.set("phase", "Loading");
    expect(app.matchMount().querySelector("button")).not.toBeNull();
    expect(app.rows().length).toBe(0);
    app.set("phase", "Browsing");
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });
});
