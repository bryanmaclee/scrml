/**
 * g-each-mount-form-submit-preventdefault.browser.test.js
 *
 * Regression gate for change-id `ss20-each-submit-preventdefault-2026-06-25`
 * (g-each-mount-form-submit-no-preventdefault, ss20 item 3, MED).
 *
 * BUG: a `<form onsubmit=fn()>` INSIDE an `<each>` body emitted its inline
 * each-mount `addEventListener("submit", function(event){ ... })` WITHOUT the
 * auto-injected `event.preventDefault()` that the top-level registry / event-
 * wiring path (emit-event-wiring.ts L658/L680) prepends. Result: pressing Enter
 * / clicking the submit button reloads the page (native form submit fires).
 *
 * FIX (emit-each.ts renderTemplateAttrToJs, event-handler branch): inject the
 * SAME `domEvent === "submit" ? "event.preventDefault(); " : ""` prefix into the
 * each-mount inline submit listener, as the VERY FIRST statement — before the
 * Bug-73 live-keying prelude — so preventDefault fires even when the prelude
 * early-returns on a stale (reconciled-away) item. LOCAL injection (the each path
 * builds its own listener string; it does not share the registry handler-body
 * builder, so there is no double-inject risk on the registry path).
 *
 * Runtime gate (S140/S152 lesson): compile-clean is NOT enough — this loads the
 * emitted client.js AS-IS, dispatches a real cancelable `submit`, and asserts
 * `event.defaultPrevented === true` AND the handler fired for the LIVE item.
 *
 * Models: g-expr-event-handler-dead-in-each.browser.test.js (ss17).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

// Per-item <form onsubmit=fn()> (the each factory mounts the <li> root per item;
// the form + a non-submit control button live inside it). The handlers read the
// NON-key field @.label so a same-key reconcile exercises Bug-73 live-keying.
const EACH_SRC = `<program>
type Row:struct = { id: string, label: string }
<rows>: Row[] = []
<submitted>: string = ""
<clicked>: string = ""
function onSubmit(v: string) { @submitted = v }
function onPick(v: string) { @clicked = v }
<ul>
  <each in=@rows>
    <li>
      <form class="rowform" onsubmit=onSubmit(@.label)>
        <button type="submit">go</button>
      </form>
      <button class="rowbtn" onclick=onPick(@.label)>c</button>
    </li>
  </each>
</ul>
</program>
`;

// Top-level (non-each) form — exercises the registry / event-wiring path, which
// already injects preventDefault. Guards against the fix perturbing that path.
const TOP_SRC = `<program>
<topdone>: string = ""
function topSubmit() { @topdone = "yes" }
<form class="topform" onsubmit=topSubmit()>
  <button type="submit">go</button>
</form>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-submit-preventdefault-ss20");

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

describe("g-each-mount-form-submit-preventdefault (ss20 item 3)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      // BUG-6: expose BARE global accessors OUTSIDE the chunk IIFE and key the
      // harness get/set through the chunk token explicitly. (Splicing the capture
      // INSIDE the scope only binds accessors the chunk's prologue actually wraps,
      // so a get the fixture body never calls stays bare and desyncs from a scoped
      // set — hence the explicit key on the bare globals here.)
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const cellKey = chunkCellKey(clientJs);
    return {
      set: (name, val) => globalThis.__scrml_set__(cellKey(name), val),
      get: (name) => globalThis.__scrml_get__(cellKey(name)),
      forms: (c) => [...document.querySelectorAll(`form.${c}`)],
      buttons: (c) => [...document.querySelectorAll(`button.${c}`)],
      clientJs,
    };
  }

  // Dispatch a cancelable submit and report whether default was prevented.
  function dispatchSubmit(formEl) {
    const ev = new Event("submit", { cancelable: true, bubbles: true });
    formEl.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  test("per-item submit: preventDefault fires AND the fn fires for the right item", () => {
    const app = mount(EACH_SRC, "each-submit");
    app.set("rows", [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ]);
    const forms = app.forms("rowform");
    expect(forms.length).toBe(2);

    expect(dispatchSubmit(forms[1])).toBe(true);
    expect(app.get("submitted")).toBe("beta");

    expect(dispatchSubmit(forms[0])).toBe(true);
    expect(app.get("submitted")).toBe("alpha");
  });

  test("adversarial: preventDefault + correct LIVE item after a same-key reconcile", () => {
    const app = mount(EACH_SRC, "each-submit-reconcile");
    app.set("rows", [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ]);
    const before = app.forms("rowform");
    // Replace the WHOLE array — SAME ids, NEW labels (forces same-key node reuse).
    app.set("rows", [
      { id: "a", label: "GAMMA" },
      { id: "b", label: "DELTA" },
    ]);
    const after = app.forms("rowform");
    // Same-key reconcile reused the form nodes (a stale closure would still bite).
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);

    // preventDefault still fires on the reused node, AND the handler reads the
    // LIVE item (NOT the create-time "beta").
    expect(dispatchSubmit(after[1])).toBe(true);
    expect(app.get("submitted")).toBe("DELTA");
  });

  test("regression: a non-submit (click) each handler is NOT given preventDefault", () => {
    const app = mount(EACH_SRC, "each-click");
    app.set("rows", [{ id: "a", label: "alpha" }]);
    const btn = app.buttons("rowbtn")[0];
    // Dispatch a CANCELABLE click; the each click listener must NOT preventDefault.
    const ev = new Event("click", { cancelable: true, bubbles: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    // ...and it still fires (handler invoked with the live item).
    expect(app.get("clicked")).toBe("alpha");
    // The emitted per-item click listener carries no preventDefault.
    expect(app.clientJs).not.toContain('addEventListener("click", function(event) { event.preventDefault()');
  });

  test("regression: a top-level (non-each) form submit still prevents default", () => {
    const app = mount(TOP_SRC, "top-submit");
    const form = app.forms("topform")[0];
    expect(form).toBeTruthy();
    expect(dispatchSubmit(form)).toBe(true);
    expect(app.get("topdone")).toBe("yes");
  });
});
