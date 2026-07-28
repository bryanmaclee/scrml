/**
 * g-nested-each-inner-binding-reads-outer-var-reconcile.browser.test.js
 *
 * Regression gate for `g-nested-each-inner-binding-reads-outer-var-stale-on-reconcile`
 * (S294, surfaced by the flogenceP `<each>` audit).
 *
 * BUG: a binding INSIDE a nested `<each>` that reads the OUTER each's loop var —
 * text `${g.name}`, a directive `class:hidden=(g.collapsed)`, OR a handler
 * `onclick=fn(g.name)` — read a CREATE-TIME closure of the outer factory. On a
 * same-key OUTER reconcile (outer `@arr` replaced, same outer key, an outer scalar
 * field changed) the outer factory is NOT re-run (node reused, Bug64/S293), so the
 * inner binding stayed STALE while the outer item's OWN bindings reconciled.
 * DISTINCT from the resolved siblings g-nested-each-no-own-subscription (S212) and
 * g-nested-each-outer-key-reuse-inner-frozen (S218), which fix the inner each's
 * SOURCE/list reconcile — neither covered inner reads of the outer var's fields.
 *
 * FIX (emit-each.ts): maybeWrapEachPerItemEffect (display: text/class/attr/if/
 * class:) and maybeWrapEachPerItemHandler (events) now also emit a live re-resolve
 * prelude — `let <encVar> = _scrml_resolve_item(<encMount>, <encKey>); …` — for
 * every ENCLOSING reconcile-ctx iter var the body references (walking
 * _eachReconcileCtxStack below the current top; the enclosing mount + key locals
 * are in scope inside the inner factory). Additive: a body reading only its OWN
 * var is byte-identical (no enclosing prelude).
 *
 * Runtime gate (S140/S152 lesson): compile-clean is not enough — this drives the
 * emitted client.js in happy-dom across a real same-key outer reconcile.
 *
 * Models: nested-each-in-enclosing-scope.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const D = "$";
const SRC = `<program>
type Item:struct = { id: string, name: string }
type Group:struct = { id: string, name: string, collapsed: bool, items: Item[] }
<groups>: Group[] = [{ id: "g1", name: "G1", collapsed: true, items: [{ id: "i1", name: "A" }] }]
<clicked>: string = ""
function pick(gid) { @clicked = gid }
<ul>
  <each in=@groups as g key=g.id>
    <li>
      <span class="outerName">${D}{g.name}</span>
      <each in=g.items as it key=it.id>
        <span class="innerName">${D}{g.name}</span>
        <span class="inner" class:hidden=(g.collapsed)>${D}{it.name}</span>
        <button class="btn" onclick=pick(g.name)>x</button>
      </each>
    </li>
  </each>
</ul>
</program>
`;

function compileOut(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve("/tmp", "scrml-nested-outer-var", `c-${uniq}`);
  const input = resolve(dir, `${baseName}.scrml`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  return {
    errors: r.errors ?? [],
    html: readFileSync(resolve(outDir, `${baseName}.html`), "utf8"),
    clientJs: readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8"),
    runtimeJs: readFileSync(resolve(outDir, r.runtimeFilename ?? "scrml-runtime.js"), "utf8"),
  };
}

describe("g-nested-each-inner-binding-reads-outer-var-reconcile", () => {
  beforeEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} GlobalRegistrator.register(); });
  afterEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} });

  function mount() {
    const { html, clientJs, runtimeJs, errors } = compileOut(SRC, "nov");
    expect(errors.length).toBe(0);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\nglobalThis.__get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      inner: () => document.querySelector("span.inner"),
      innerName: () => document.querySelector("span.innerName"),
      outerName: () => document.querySelector("span.outerName"),
      btn: () => document.querySelector("button.btn"),
      set: (v) => globalThis.__set__("groups", v),
      clicked: () => globalThis.__get__("clicked"),
    };
  }

  test("§1 initial render: directive sees the outer var, names render", () => {
    const app = mount();
    expect(app.outerName().textContent).toBe("G1");
    expect(app.innerName().textContent).toBe("G1");
    expect(app.inner().classList.contains("hidden")).toBe(true);
  });

  test("§2 same-key outer reconcile: inner text + directive reading the outer var stay live", () => {
    const app = mount();
    app.set([{ id: "g1", name: "G2", collapsed: false, items: [{ id: "i1", name: "A" }] }]);
    expect(app.outerName().textContent).toBe("G2");             // control (outer own binding)
    expect(app.innerName().textContent).toBe("G2");             // inner TEXT reads outer var
    expect(app.inner().classList.contains("hidden")).toBe(false); // inner DIRECTIVE reads outer var
  });

  test("§3 nested per-item handler reading the outer var fires with the LIVE value", () => {
    const app = mount();
    app.set([{ id: "g1", name: "G2", collapsed: false, items: [{ id: "i1", name: "A" }] }]);
    app.btn().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(app.clicked()).toBe("G2"); // not the stale create-time "G1"
  });

  // §4/§5 — adversarial-review guards (S294): the enclosing re-resolve must NOT
  // (a) collide with a same-named inner alias (`let x` twice → E-CODEGEN), nor
  // (b) fire on a property read (`s.g`) that merely shares a name with the outer var.

  test("§4 same-name nested alias compiles + the inner alias shadows (no double `let`)", () => {
    // Both eaches `as row` — the inner `row` shadows the outer; must NOT emit a
    // second `let row` (that crashed before the shadow guard). Compiles + renders.
    const SAME = `<program>
type Item:struct = { id: string, name: string, kids: Item[] }
<rows>: Item[] = [{ id: "r1", name: "R", kids: [{ id: "k1", name: "K", kids: [] }] }]
<ul>
  <each in=@rows as row key=row.id>
    <each in=row.kids as row key=row.id>
      <span class="leaf">${D}{row.name}</span>
    </each>
  </each>
</ul>
</program>
`;
    const { errors, clientJs, html, runtimeJs } = compileOut(SAME, "same");
    expect(errors.length).toBe(0);
    // exactly one `let row` per effect scope — never two in one block.
    document.documentElement.innerHTML = html;
    new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, ""))(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(document.querySelector("span.leaf").textContent).toBe("K"); // inner alias won
  });

  test("§5 an inner property read sharing the outer var's name does NOT inject an enclosing re-resolve", () => {
    // outer `as g`; inner `as s`; body reads `s.g` (property `.g`, not the outer var).
    const PROP = `<program>
type Sub:struct = { id: string, g: string }
type Group:struct = { id: string, subs: Sub[] }
<groups>: Group[] = [{ id: "g1", subs: [{ id: "s1", g: "x" }] }]
<ul>
  <each in=@groups as g key=g.id>
    <each in=g.subs as s key=s.id>
      <span class="p">${D}{s.g}</span>
    </each>
  </each>
</ul>
</program>
`;
    const { errors, clientJs } = compileOut(PROP, "prop");
    expect(errors.length).toBe(0);
    // The inner `${s.g}` effect must resolve only `s` — no `let g = _scrml_resolve_item`
    // injected for the property read. (Line 38's outer inner-render read of g.subs is
    // legitimate and lives in the OUTER effect, not the inner text effect.)
    const innerEffect = clientJs.slice(clientJs.indexOf("String(s.g)") - 400, clientJs.indexOf("String(s.g)"));
    expect(innerEffect).not.toMatch(/let g = _scrml_resolve_item/);
  });
});
