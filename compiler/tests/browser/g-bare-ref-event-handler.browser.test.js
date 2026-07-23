/**
 * g-bare-ref-event-handler.browser.test.js — §5.2.2 row 5 (bare-ref event form).
 *
 * Bug (g-bare-ref-event-handler-emits-literal-not-wired, MED, known-gaps §S212):
 * the bare-reference event-handler form `onclick=handler` (a bare identifier, NO
 * parens, NO `${...}`) emitted a LITERAL HTML attribute `onclick="handler"`
 * instead of WIRING `handler` as the listener. Because the source name `handler`
 * is module-scoped (the real fn is `_scrml_handler_N`), `onclick="bump"`
 * referenced a NONEXISTENT global — the handler was dead (ReferenceError on the
 * event, nothing fired).
 *
 * §5.2.2 row 5 is NORMATIVE: "`onclick=handler` (no parentheses) SHALL wire
 * `handler` directly as the event listener without wrapping." So the form must
 * WIRE (fix-to-wire), not emit a literal attribute. The bare-ref form wires the
 * RESOLVED reference DIRECTLY (the listener receives the DOM event as its arg);
 * this is DISTINCT from the call form `fn()` (which auto-wraps
 * `function(event){ fn(); }`) and the expr form `${(e) => fn(e)}`.
 *
 * Root: the event-binding collector in emit-html.ts recognized the call form
 * (`val.kind === "call-ref"`) and the `${}` expr form (`val.kind === "expr"`)
 * but NOT the bare-ref ATTRIBUTE form (`val.kind === "variable-ref"` for an
 * `on*=` attr), so it fell through to literal attribute emission. Fix adds the
 * `bareRefHandler` routing in emit-html.ts + direct-wire emission in
 * emit-event-wiring.ts (resolve via fnNameMap → `_scrml_<name>_N`, no wrap).
 *
 * Covers BOTH a DELEGABLE bare-ref event (onclick) and a NON-DELEGABLE one
 * (onmousedown — flogence's reporting case was mouse events). Also confirms the
 * call form + expr form still wire (no regression).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// Delegable (onclick) + non-delegable (onmousedown) bare-ref forms, side-by-side
// with the call form (onclick=bump()) and expr form (onmousedown=${(e)=>...}).
const SRC = `<program>
\${
    <n> = 0
    <pan> = 0
    function bump() { @n = @n + 1 }
    function bumpE(e) { @n = @n + 1 }
    function startPan() { @pan = @pan + 1 }
}
<div id="bare" onclick=bump>bare-ref</div>
<div id="call" onclick=bump()>call form</div>
<div id="expr" onmousedown=\${(e) => bumpE(e)}>expr form</div>
<div id="bareMouse" onmousedown=startPan>bare-ref mouse</div>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-g-bare-ref-handler");

function compileCase(src = SRC) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "app.html")),
      clientJs: read(resolve(outDir, "app.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-bare-ref-event-handler §1 — emitted shape (was literal attr, now wired)", () => {
  test("compiles with no errors", () => {
    expect(compileCase().errors).toEqual([]);
  });

  test("the bare-ref div emits data-scrml-bind-onclick (NOT literal onclick=\"bump\")", () => {
    const { html } = compileCase();
    // The literal-attr emission is GONE — no `onclick="bump"` / `onmousedown="startPan"`.
    expect(/onclick=["']bump["']/.test(html)).toBe(false);
    expect(/onmousedown=["']startPan["']/.test(html)).toBe(false);
    // The bare-ref div is now wired via the delegation/non-delegation data-attr.
    expect(/data-scrml-bind-onclick=/.test(html)).toBe(true);
    expect(/data-scrml-bind-onmousedown=/.test(html)).toBe(true);
  });

  test("the bare-ref handler is wired DIRECTLY (no function(event){fn();} wrap)", () => {
    const { clientJs } = compileCase();
    // Direct reference: `"<id>": _scrml_bump_N,` — the resolved encoded name as
    // a bare reference (NO `function(event)` wrapper around the bare-ref form).
    expect(/:\s*_scrml_bump_\d+\s*,/.test(clientJs)).toBe(true);
    // The non-delegable bare-ref (onmousedown=startPan) wires the resolved name directly too.
    expect(/:\s*_scrml_startPan_\d+\s*,/.test(clientJs)).toBe(true);
  });

  test("the call form STILL auto-wraps function(event){ fn(); } (no regression)", () => {
    const { clientJs } = compileCase();
    // onclick=bump() → `function(event) { _scrml_bump_N(); }`
    expect(/function\(event\)\s*\{\s*_scrml_bump_\d+\(\);\s*\}/.test(clientJs)).toBe(true);
  });

  test("the expr form STILL wires its arrow (no regression)", () => {
    const { clientJs } = compileCase();
    // onmousedown=${(e) => bumpE(e)} → `(e) => _scrml_bumpE_N(e)`
    expect(/\(e\)\s*=>\s*_scrml_bumpE_\d+\(e\)/.test(clientJs)).toBe(true);
  });
});

describe("g-bare-ref-event-handler §2 — fires in happy-dom (was dead handler)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("clicking the bare-ref div FIRES the handler (delegable; @n increments)", () => {
    const { html, clientJs, runtimeJs } = compileCase();
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__get__ = (typeof _scrml_reactive_get!=='undefined')?_scrml_reactive_get:null;`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    // Pre-fix: `onclick="bump"` referenced a nonexistent global → ReferenceError,
    // nothing fired, @n stayed 0. Post-fix: the wired `_scrml_bump_N` runs.
    const bare = document.getElementById("bare");
    bare.dispatchEvent(new Event("click", { bubbles: true }));

    console.error = origErr;
    expect(errs.filter((e) => /ReferenceError|not defined/.test(e))).toEqual([]);
    expect(globalThis.__get__("n")).toBe(1);
  });

  test("mousedown on the bare-ref mouse div FIRES the handler (non-delegable; @pan increments)", () => {
    const { html, clientJs, runtimeJs } = compileCase();
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__get__ = (typeof _scrml_reactive_get!=='undefined')?_scrml_reactive_get:null;`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    const bareMouse = document.getElementById("bareMouse");
    bareMouse.dispatchEvent(new Event("mousedown", { bubbles: true }));

    console.error = origErr;
    expect(errs.filter((e) => /ReferenceError|not defined/.test(e))).toEqual([]);
    expect(globalThis.__get__("pan")).toBe(1);
  });

  test("the call form + expr form still fire too (cross-check; @n increments on each)", () => {
    const { html, clientJs, runtimeJs } = compileCase();
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__get__ = (typeof _scrml_reactive_get!=='undefined')?_scrml_reactive_get:null;`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    // call form (onclick=bump()) increments @n.
    document.getElementById("call").dispatchEvent(new Event("click", { bubbles: true }));
    expect(globalThis.__get__("n")).toBe(1);
    // expr form (onmousedown=${(e)=>bumpE(e)}) increments @n too.
    document.getElementById("expr").dispatchEvent(new Event("mousedown", { bubbles: true }));
    expect(globalThis.__get__("n")).toBe(2);
  });
});
