/**
 * g-each-value-form-if-in-rcdata-body.browser.test.js
 *
 * DOM-SHAPE gate for the value-form-`if` half of the RCDATA data-loss family.
 * The unit twin (tests/unit/g-each-value-form-if-in-rcdata-body-injects-element-child.test.js)
 * asserts the emitted-JS shape; this one asserts the shape the emission actually
 * produces in a DOM, which is the instrument that measured the S328 defect.
 *
 * THE BUG. The sibling fix in this PR (g-each-value-form-if-markup-fn-call-branch-
 * stringifies) fed the `if-stmt` to the each-interp `markupCapable` discriminant so
 * a value-form `if` whose branch calls a markup-returning fn MOUNTS, at parity with
 * its twin ternary. The bare-body recursion had no content-model guard, so the same
 * change also mounted a `<span data-scrml-mv>` INSIDE a `<textarea>`:
 *
 *     <li><textarea>${ if (it.name) { badge(it.name) } else { badge("x") } }</textarea></li>
 *
 * A `<textarea>`'s value IS its child TEXT content, so an element child makes
 * `textarea.value` read "" — the adopter's string is silently gone.
 *
 * ⚠⚠ ORACLE DISCIPLINE — inherited verbatim from g-each-shorthand-rcdata-parent:
 * happy-dom reports `textarea.value` as the text even with an element child, so a
 * `.value` assertion CANNOT see this defect. Every load-bearing assertion below is
 * a DOM-SHAPE assertion (`childElementCount` / `firstElementChild` / selector
 * counts) or a rendered-LABEL assertion, both of which DO discriminate here.
 *
 * COUNTER-GATE. `<option>` stays on the MOUNTING path (S328: it does not lose data,
 * and lowering it replaced a correct label with "[object HTMLElement]"). The third
 * test pins that and will fail anyone who widens the RCDATA refusal.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// Markup-returning on every path — the plain "markup fn" case the value-form-if
// discriminant now recognizes.
const BADGE_FN = `fn badge(n: string) { return <span class="b">${DOLLAR}{n}</span> }`;

const SRC_TEXTAREA = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
${BADGE_FN}
<ul id="u">
  <each in=@rows as it key=it.id>
    <li><textarea class="note">${DOLLAR}{ if (it.name) { badge(it.name) } else { badge("x") } }</textarea></li>
  </each>
</ul>
</program>
`;

// COUNTER-GATE — `<option>` must keep MOUNTING (and keep rendering a label).
const SRC_OPTION = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
${BADGE_FN}
<select id="s">
  <each in=@rows as it key=it.id>
    <option class="opt">${DOLLAR}{ if (it.name) { badge(it.name) } else { badge("x") } }</option>
  </each>
</select>
</program>
`;

// NEGATIVE CONTROL — flow content still MOUNTS. The sibling PR fix must survive;
// this is the assertion that stops the RCDATA guard from being over-broad.
const SRC_FLOW = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
${BADGE_FN}
<ul id="uf">
  <each in=@rows as it key=it.id>
    <li class="row">${DOLLAR}{ if (it.name) { badge(it.name) } else { badge("x") } }</li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-value-form-if-rcdata");

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

describe("g-each-value-form-if-in-rcdata-body — element child in a <textarea>", () => {
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
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const cellKey = chunkCellKey(clientJs);
    return {
      clientJs,
      set: (name, val) => globalThis.__scrml_set__(cellKey(name), val),
      all: (sel) => [...document.querySelectorAll(sel)],
    };
  }

  // Row 2 has an EMPTY name, so the `else` branch is exercised too.
  const ROWS = [
    { id: "a", name: "alpha" },
    { id: "b", name: "" },
  ];

  test("<textarea> body: NO element child is injected into the RCDATA parent", () => {
    const app = mount(SRC_TEXTAREA, "textarea");
    app.set("rows", ROWS);

    const tas = app.all("textarea.note");
    expect(tas.length).toBe(2);

    // THE load-bearing assertion — DOM SHAPE, not `.value` (see the oracle note
    // in the header). On the buggy emission each textarea holds one
    // `<span data-scrml-mv>` element child, and a real browser then reports
    // `textarea.value === ""`.
    for (const ta of tas) {
      expect(ta.childElementCount).toBe(0);
      expect(ta.firstElementChild).toBe(null);
    }
    expect(app.all("textarea [data-scrml-mv]").length).toBe(0);
    expect(app.all("textarea *").length).toBe(0);
  });

  test("<textarea> survives a same-key reconcile without gaining an element child", () => {
    const app = mount(SRC_TEXTAREA, "textarea-reconcile");
    app.set("rows", [{ id: "a", name: "alpha" }]);
    expect(app.all("textarea.note").length).toBe(1);
    expect(app.all("textarea.note")[0].childElementCount).toBe(0);

    app.set("rows", [{ id: "a", name: "OMEGA" }]);
    const tas = app.all("textarea.note");
    expect(tas.length).toBe(1);
    expect(tas[0].childElementCount).toBe(0);
    expect(app.all("textarea [data-scrml-mv]").length).toBe(0);
  });

  test("COUNTER-GATE — <option> keeps MOUNTING and keeps its rendered label (S328)", () => {
    const app = mount(SRC_OPTION, "option");
    app.set("rows", ROWS);

    const opts = app.all("option.opt");
    expect(opts.length).toBe(2);
    // <option> stays on the mounting path — pinned explicitly so a future
    // "shape fix" has to confront this test.
    expect(app.all("option [data-scrml-mv]").length).toBe(2);
    expect(opts.map((o) => o.textContent.trim())).toEqual(["alpha", "x"]);
  });

  test("NEGATIVE CONTROL — flow content still MOUNTS (the sibling PR fix survives)", () => {
    const app = mount(SRC_FLOW, "flow");
    app.set("rows", ROWS);

    const rows = app.all("li.row");
    expect(rows.length).toBe(2);
    expect(app.all("li.row [data-scrml-mv]").length).toBe(2);
    expect(app.all("li.row span.b").length).toBe(2);
    expect(rows.map((li) => li.textContent.trim())).toEqual(["alpha", "x"]);
  });
});
