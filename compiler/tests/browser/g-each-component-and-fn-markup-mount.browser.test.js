/**
 * g-each-component-and-fn-markup-mount.browser.test.js
 *
 * Adopter gap #161 (pjoliver11): inside `<each>`, two documented markup-reuse
 * mechanisms silently failed — both render correctly OUTSIDE `<each>`:
 *
 *   (A) `<Component/>` in `<each>` rendered NOTHING — the component was never
 *       instantiated. Root cause: component-expander `walkAndExpand` did not
 *       descend into `each-block.templateChildren`, so the `<Row/>` use-site
 *       survived CE unexpanded and emit-each emitted `createElement("Row")`
 *       (an unknown `<row>` element — silent non-render).
 *
 *   (B) `${fnReturningMarkup()}` in `<each>` emitted the literal text
 *       `[object HTMLSpanElement]` — the returned DOM node was `String()`-ed
 *       into `textContent` instead of being mounted. Root cause: emit-each
 *       `emitEachInterpExprToJs` assigned `textContent = String(expr)` for a
 *       standalone interpolation whose value can be markup (Pillar 1).
 *
 * S265 verification bar: this test EXECUTES the compiled bundle in happy-dom and
 * COUNTS nodes — a "renders nothing" bug is invisible to emitted-text inspection.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// The brief's exact repro (GH #161). c1/c4/c6 are controls (render correctly
// pre-fix); c2/c3/c5 are the bug cases.
const SRC = `const Row = <div class="row" props={ name: string }>
    <span class="n">\${name}</span>
</div>

<items> = [{ k: "a", name: "Ada" }, { k: "b", name: "Bo" }]

\${
    function rowMarkup(n) { return <span class="fn">\${n}</span> }
}

<h1>component-in-each repro</h1>
<div id="c1"><each in=@items as it key=@.k><span class="plain">\${it.name}</span></each></div>
<div id="c2"><each in=@items as it key=@.k><Row name=it.name /></each></div>
<div id="c3"><each in=@items as it><Row name="literal" /></each></div>
<div id="c4"><Row name="outside-each" /></div>
<div id="c5"><each in=@items as it key=@.k>\${rowMarkup(it.name)}</each></div>
<div id="c6">\${rowMarkup("outside")}</div>
`;

const tmpRoot = resolve("/tmp", "scrml-g-each-component-fn-markup");

function compileRepro() {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, SRC);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: (result.errors ?? []).filter((e) => String(e.code ?? e).startsWith("E-")),
      html: read(resolve(outDir, "app.html")),
      clientJs: read(resolve(outDir, "app.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-each-component-and-fn-markup-mount — compile", () => {
  test("compiles with no hard errors (W-PROGRAM-001 warning is non-fatal)", () => {
    expect(compileRepro().errors).toEqual([]);
  });

  test("(A) component-in-each expands the Row template (no unknown <row> element)", () => {
    const { clientJs } = compileRepro();
    // The `<Row/>` use-site inside <each> is expanded to the div.row template.
    expect(/createElement\("Row"\)/.test(clientJs)).toBe(false);
    expect(/createElement\("div"\)[\s\S]*setAttribute\("class", "row"\)/.test(clientJs)).toBe(true);
  });

  test("(B) fn-markup-in-each is not String()-stringified to textContent", () => {
    const { clientJs } = compileRepro();
    // The standalone interpolation mounts through the data-scrml-mv guard.
    expect(/textContent = String\(_scrml_rowMarkup/.test(clientJs)).toBe(false);
    expect(/instanceof Node/.test(clientJs)).toBe(true);
  });
});

describe("g-each-component-and-fn-markup-mount — DOM (executes the bundle)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("c1-c6 render the expected nodes; no [object HTMLSpanElement] text", () => {
    const { html, clientJs, runtimeJs, errors } = compileRepro();
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    const exec = new Function("window", "document", `${runtimeJs}\n${clientJs}\n`);
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    console.error = origErr;

    expect(errs.filter((e) => /ReferenceError|not defined|effect error/.test(e))).toEqual([]);

    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const names = (nodes) => nodes.map((n) => n.textContent.trim());

    // Controls (worked pre-fix, must stay working).
    expect(q("#c1 .plain").length).toBe(2);
    expect(names(q("#c1 .plain"))).toEqual(["Ada", "Bo"]);
    expect(q("#c4 .row").length).toBe(1);
    expect(q("#c6 .fn").length).toBe(1);

    // (A) component-in-each — 2 rows with the per-item prop bound.
    expect(q("#c2 .row").length).toBe(2);
    expect(names(q("#c2 .row .n"))).toEqual(["Ada", "Bo"]);
    expect(q("#c3 .row").length).toBe(2);

    // (B) fn-markup-in-each — 2 .fn spans with names, NOT stringified.
    expect(q("#c5 .fn").length).toBe(2);
    expect(names(q("#c5 .fn"))).toEqual(["Ada", "Bo"]);

    // No DOM node was stringified anywhere.
    expect(document.body.textContent).not.toContain("[object");
  });
});
