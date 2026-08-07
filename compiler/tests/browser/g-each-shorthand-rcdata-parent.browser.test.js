/**
 * g-each-shorthand-rcdata-parent.browser.test.js
 *
 * S328 regression gate — SILENT DATA LOSS in the S327/#456 `<each>` `:`-shorthand
 * mount path, plus the counter-gate for the over-wide first fix.
 *
 * THE BUG (reproduced on baseline 18fc0571). #456 taught the `:`-shorthand each
 * body to MOUNT a markup-returning fn call through a `<span data-scrml-mv>`
 * wrapper. The discriminant it reused, `interpMayYieldNode`, is a **MAY**-
 * analysis: `fnBodyReturnsMarkup` admits a fn into `_eachMarkupFnNames` if ANY of
 * its returns is markup. So a MIXED-return
 *
 *     fn label(n) { if n == "" { return <i>none</i> }  return n }
 *
 * is "markup-capable" even on the calls that hand back a plain string — and the
 * shorthand branch had NO content-model guard (`_rcdataValueExpr` was gated on
 * `!isShorthand`). `<textarea : label(it.name)>` therefore appended a span INSIDE
 * the textarea. A `<textarea>`'s value IS its child TEXT content, so with an
 * element child `textarea.value` reads "" — MEASURED in real Chromium, both rows,
 * both branches of the mixed fn. The adopter's string is silently gone.
 *
 * THE FIX is scoped to RCDATA and NOTHING ELSE. Both `<each>` per-item branches
 * read one local (`_isRcdataBody`) so they cannot drift, per the SPEC §4.14
 * line-1021 byte-identity contract ("a `:`-shorthand body IS the element's
 * single-expression body, byte-identical to the bare-body form `<tag>${expr}</tag>`"),
 * carried into `<each>` scope by §17.7.6.
 *
 * WHY NOT `<option>` — this is the counter-gate, and it is here because the first
 * attempt got it wrong. `<option>`'s content model is Text and a `<span>` child is
 * invalid HTML, but the DOM API accepts it and the LABEL still reads through:
 * base emission renders "alpha"/"none" correctly in real Chromium. `<option>`
 * never had the data-loss defect. Routing it to `.textContent = String(expr)`
 * "fixed" the shape and replaced every markup-branch label with
 * "[object HTMLElement]" — trading a silent-wrong SHAPE for a silent-wrong LABEL,
 * which is worse, because the label is what the user reads. `<option>` is
 * therefore left byte-identical to base, and the third test below PINS that.
 *
 * ⚠⚠ ORACLE DISCIPLINE — happy-dom is WRONG ON BOTH HALVES OF THIS DEFECT.
 * MEASURED in this repo's happy-dom (20.8.9):
 *
 *     textarea.value  with an element child  ->  "alpha"   (should be "")
 *     String(<an element>)                   ->  "<i class=\"none\">none</i>"
 *                                                (should be "[object HTMLElement]")
 *
 * So a `.value` assertion cannot see the original bug, and an "[object" assertion
 * cannot see the regression the first fix introduced. Every load-bearing
 * assertion below is therefore either a DOM-SHAPE assertion (`childElementCount`,
 * `firstElementChild`, selector counts) or a rendered-LABEL assertion — both of
 * which DO discriminate under happy-dom. The conformant-oracle evidence was taken
 * separately, under real Chromium via puppeteer.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// A MIXED-return fn: markup on one path, a plain string on the other. This is
// what makes `interpMayYieldNode` (a MAY-analysis) say "markup-capable" while the
// call under test may actually return a string.
const MIXED_FN = `fn label(n: string) {
  if n == "" { return <i class="none">none</i> }
  return n
}`;

// RCDATA parent — the data-loss half, shorthand-exclusive and NEW in #456.
const SRC_TEXTAREA = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
${MIXED_FN}
<form id="f">
  <each in=@rows as it key=it.id>
    <textarea class="note" : label(it.name)>
  </each>
</form>
</program>
`;

// PARITY — the §4.14 line-1021 contract, for the one content model where the two
// branches could disagree. Mixed-return CALL and plain member expression, each in
// both body forms.
const SRC_PARITY = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
${MIXED_FN}
<form id="short">
  <each in=@rows as a key=a.id>
    <textarea class="ta-short" : label(a.name)>
  </each>
</form>
<form id="long">
  <each in=@rows as b key=b.id>
    <textarea class="ta-long">${DOLLAR}{label(b.name)}</textarea>
  </each>
</form>
<form id="short-plain">
  <each in=@rows as c key=c.id>
    <textarea class="ta-short-plain" : c.name>
  </each>
</form>
<form id="long-plain">
  <each in=@rows as d key=d.id>
    <textarea class="ta-long-plain">${DOLLAR}{d.name}</textarea>
  </each>
</form>
</program>
`;

// COUNTER-GATE — `<option>` must keep rendering the adopter's label on BOTH
// branches. This is the test that fails if anyone (including a future me) widens
// the RCDATA refusal to text-only content models again.
const SRC_OPTION = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
${MIXED_FN}
<select id="s-short">
  <each in=@rows as it key=it.id>
    <option class="opt-short" : label(it.name)>
  </each>
</select>
<select id="s-long">
  <each in=@rows as it2 key=it2.id>
    <option class="opt-long">${DOLLAR}{label(it2.name)}</option>
  </each>
</select>
</program>
`;

// NEGATIVE CONTROL — flow content still MOUNTS. #456's fix must survive intact;
// this is the assertion that stops the RCDATA guard from being over-broad.
const SRC_FLOW = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn badge(n: string) { return <span class="badge">${DOLLAR}{n}</span> }
<ul id="u">
  <each in=@rows as it key=it.id>
    <li : badge(it.name)>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-shorthand-rcdata-parent");

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

describe("g-each-shorthand-rcdata-parent — S328 silent data loss", () => {
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

  // Row 2 has an EMPTY name, so `label("")` takes the MARKUP branch. Both
  // branches of the mixed fn are therefore exercised in every test below.
  const ROWS = [
    { id: "a", name: "alpha" },
    { id: "b", name: "" },
  ];

  test("<textarea : label(it)>: NO element child is injected into the RCDATA parent", () => {
    const app = mount(SRC_TEXTAREA, "textarea");
    app.set("rows", ROWS);

    const tas = app.all("textarea.note");
    expect(tas.length).toBe(2);

    // THE load-bearing assertion — DOM SHAPE, not `.value` (happy-dom's `.value`
    // reads "alpha" for the buggy mount too). On the buggy emission each textarea
    // holds one `<span data-scrml-mv>` element child.
    for (const ta of tas) {
      expect(ta.childElementCount).toBe(0);
      expect(ta.firstElementChild).toBe(null);
    }
    expect(app.all("textarea [data-scrml-mv]").length).toBe(0);
    expect(app.all("textarea *").length).toBe(0);

    // Emitted-code assertion — the RCDATA `.value` lowering, matching the
    // bare-body `_rcdataValueExpr` path.
    expect(app.clientJs).toContain(".value = String(");
  });

  test("<textarea : …> survives a same-key reconcile without gaining an element child", () => {
    const app = mount(SRC_TEXTAREA, "textarea-reconcile");
    app.set("rows", [{ id: "a", name: "alpha" }]);
    expect(app.all("textarea.note").length).toBe(1);
    expect(app.all("textarea.note")[0].childElementCount).toBe(0);

    // Same key, new data — the per-item effect re-runs the `.value` write.
    app.set("rows", [{ id: "a", name: "OMEGA" }]);
    const tas = app.all("textarea.note");
    expect(tas.length).toBe(1);
    expect(tas[0].childElementCount).toBe(0);
    expect(app.all("textarea [data-scrml-mv]").length).toBe(0);
  });

  test("PARITY (SPEC §4.14:1021) — `:`-shorthand matches bare-body inside RCDATA", () => {
    const app = mount(SRC_PARITY, "parity");
    app.set("rows", ROWS);

    for (const sel of ["textarea.ta-short", "textarea.ta-long", "textarea.ta-short-plain", "textarea.ta-long-plain"]) {
      const els = app.all(sel);
      expect(els.length).toBe(2);
      for (const el of els) expect(el.childElementCount).toBe(0);
    }
    expect(app.all("textarea *").length).toBe(0);
    expect(app.all("textarea [data-scrml-mv]").length).toBe(0);

    // Emitted-code parity: all FOUR textarea bodies take `.value`, none takes
    // `.textContent`. One local, two branches.
    expect((app.clientJs.match(/\.value = /g) ?? []).length).toBe(4);
    expect(app.clientJs).not.toContain("_scrml_el_2.textContent = ");
  });

  test("COUNTER-GATE — <option> keeps its rendered LABEL on both branches, shorthand AND bare-body", () => {
    const app = mount(SRC_OPTION, "option");
    app.set("rows", ROWS);

    const short = app.all("option.opt-short");
    const long = app.all("option.opt-long");
    expect(short.length).toBe(2);
    expect(long.length).toBe(2);

    // THE load-bearing assertion. The over-wide first fix lowered these to
    // `.textContent = String(expr)`, which renders "[object HTMLElement]" in a
    // conformant browser and the literal text `<i class="none">none</i>` under
    // happy-dom — either way, NOT the adopter's label.
    expect(short.map((o) => o.textContent.trim())).toEqual(["alpha", "none"]);
    expect(long.map((o) => o.textContent.trim())).toEqual(["alpha", "none"]);

    // <option> stays on the mounting path, byte-identical to base. Asserted
    // explicitly so a future "shape fix" here has to confront this test.
    expect(app.all("option [data-scrml-mv]").length).toBe(4);
  });

  test("NEGATIVE CONTROL — flow content still MOUNTS (#456 preserved)", () => {
    const app = mount(SRC_FLOW, "flow");
    app.set("rows", [{ id: "a", name: "alpha" }, { id: "b", name: "beta" }]);

    // `<li>` is flow content: an element child is legal, so the markup-returning
    // call must still mount a real `<span class="badge">`, not stringify.
    expect(app.all("li span.badge").length).toBe(2);
    expect(app.all("li span.badge").map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
    expect(app.all("[data-scrml-mv]").length).toBe(2);
    expect(document.body.textContent).not.toContain("[object");
  });
});
