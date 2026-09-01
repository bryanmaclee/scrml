/**
 * g-each-value-form-if-in-rcdata-body-injects-element-child.test.js
 *
 * SILENT DATA LOSS regression gate for the `<each>` bare-body interp path.
 *
 * THE BUG. `g-each-value-form-if-markup-fn-call-branch-stringifies` (the sibling
 * fix in this same PR) taught the each-interp `markupCapable` discriminant to see
 * a §17.6 value-form `if` by setting `interpExprNode = stmt` for the `if-stmt`
 * case. That is correct for flow content — but the discriminant had NO content-model
 * guard on the bare-body path, so the SAME change also routed a value-form `if`
 * sitting inside an RCDATA parent to the mount path:
 *
 *     <li><textarea>${ if (it.name) { badge(it.name) } else { badge("x") } }</textarea></li>
 *
 * emitted `document.createElement("span")` + `data-scrml-mv` + `appendChild` INSIDE
 * the `<textarea>`. HTML defines a textarea's value as its child TEXT content, so
 * with an element child `textarea.value` reads "" and the adopter's string is gone.
 * Measured in real Chromium for the twin shorthand defect — see the header of
 * tests/browser/g-each-shorthand-rcdata-parent.browser.test.js.
 *
 * Pre-fix (this branch)  : createElement("span") + setAttribute("data-scrml-mv") inside the textarea
 * On main (no #805)      : _scrml_each_tn_N.textContent = String((it.name ? badge(…) : badge("x")))
 * Post-fix               : byte-identical to main — VERIFIED by compiling both trees
 *
 * THE FIX threads the already-existing `_isRcdataBody` local (s328) into the
 * bare-body child recursion as `parentIsRcdata`, and refuses the mount there,
 * mirroring the `:`-shorthand branch's `shMarkupCapable && !_isRcdataBody`. It is
 * the SAME local and the SAME refusal, not a second content-model mechanism.
 *
 * SCOPE — RCDATA and nothing else. `isRcdataElement` has exactly ONE registry row
 * (`<textarea>`, html-elements.js), so the population the guard newly skips is
 * exactly "`<textarea>` per-item bodies", every member of which loses data outright
 * with an element child. `<option>` is DELIBERATELY left mounting (s328: it does not
 * lose data, and lowering it replaced a correct label with "[object HTMLElement]").
 * Test 3 is the counter-gate that fails you for re-widening.
 *
 * VALUE-asserting (R26): compiles real .scrml and asserts emitted-JS shape.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-rcif-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return { clientJs: out.clientJs ?? "", errors: r.errors ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEAD = `type Row:struct = { id: string, name: string }
<rows>: Row[] = [{ id: "1", name: "alpha" }]
fn badge(n: string) { return <span class="b">\${n}</span> }`;

// The mount wrapper: a `<span data-scrml-mv>` created inside the per-item factory.
const mountsElementChild = (cj) =>
  /_scrml_each_mv_\d+\s*=\s*document\.createElement\(/.test(cj) &&
  /setAttribute\("data-scrml-mv"/.test(cj);

// The legal-in-RCDATA fallback: a bare text node whose textContent is assigned.
const writesTextNode = (cj) =>
  /_scrml_each_tn_\d+\s*=\s*document\.createTextNode\(/.test(cj) &&
  /_scrml_each_tn_\d+\.textContent\s*=\s*String\(/.test(cj);

describe("g-each-value-form-if-in-rcdata-body-injects-element-child", () => {
  test("value-form-if in a <textarea> body emits NO element child", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li><textarea>\${ if (it.name) { badge(it.name) } else { badge("x") } }</textarea></li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsElementChild(r.clientJs)).toBe(false);
    expect(writesTextNode(r.clientJs)).toBe(true);
  });

  test("else-if cascade in a <textarea> body emits NO element child", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li><textarea>\${ if (it.name) { badge(it.name) } else if (it.id) { badge(it.id) } else { badge("z") } }</textarea></li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsElementChild(r.clientJs)).toBe(false);
  });

  test("COUNTER-GATE: <option> still MOUNTS — the guard must not widen past RCDATA (s328)", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li><select><option>\${ if (it.name) { badge(it.name) } else { badge("x") } }</option></select></li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsElementChild(r.clientJs)).toBe(true);
  });

  test("CONTROL: flow content (<li>) still MOUNTS — the sibling PR fix survives", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li>\${ if (it.name) { badge(it.name) } else { badge("x") } }</li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsElementChild(r.clientJs)).toBe(true);
  });

  test("CONTROL: a nested markup-fn CALL inside <li> under <textarea>'s sibling still mounts", () => {
    // Guards against the guard leaking to siblings: `parentIsRcdata` must be
    // scoped to the IMMEDIATE parent, not sticky down the whole subtree.
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li><textarea>\${ it.name }</textarea><span>\${ badge(it.name) }</span></li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsElementChild(r.clientJs)).toBe(true);
  });

  test("NO REGRESSION: a NON-markup value-form-if in <textarea> is unchanged (text path)", () => {
    const r = compile(`<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = [{ id: "1", name: "alpha" }]
<ul><each in=@rows as it key=it.id>
  <li><textarea>\${ if (it.name) { it.name } else { "none" } }</textarea></li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsElementChild(r.clientJs)).toBe(false);
  });
});
