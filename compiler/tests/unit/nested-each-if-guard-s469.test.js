/**
 * nested-each-if-guard-s469 — emission shape of the `if=` gate on an `<each>` inside
 * another `<each>`'s row (g-nested-each-if-guard-dropped-s469) and inside lifted
 * markup (g-lifted-each-if-attribute-silently-ignored).
 *
 * Behaviour (rows really appear / disappear, both ways) is pinned by
 * compiler/tests/browser/nested-each-if-guard-s469.browser.test.js; this file pins
 * the shape the behaviour rests on:
 *   - the gate sits at the top of the inner list's effect, BEFORE the collection is
 *     read (§17.1.2.1), and clears the inner mount when false;
 *   - the condition is lowered by the shared if= lowering (if-gate-condition.ts), in
 *     the enclosing row's scope (`@.` → the enclosing item; a row alias is not a cell);
 *   - the inner-list effect is a render-gate effect (`, true`);
 *   - an `if=` value the gate cannot lower is REFUSED (E-CG-003), never dropped.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { emitNestedEachFromMarkup } from "../../src/codegen/emit-each.ts";
import { drainRefusedLowerings, resetRefusedLowerings } from "../../src/codegen/refused-lowering-errors.ts";

const tmpRoot = resolve(tmpdir(), "scrml-unit-nested-each-if-s469");

function compileClient(source) {
  const dir = resolve(tmpRoot, `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, source);
  const out = resolve(dir, "out");
  const res = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  const errors = (res.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
  let js = "";
  try { js = readFileSync(resolve(out, "app.client.js"), "utf8"); } catch { /* refused */ }
  return { errors: errors.map((e) => e.code), all: (res.errors ?? []).map((e) => e.code), js };
}

describe("nested <each if=…> — emission", () => {
  test("the gate precedes the inner collection read and clears the inner mount", () => {
    const { errors, js } = compileClient(`<pw> = "wrong"
<xs> = [1]
<ys> = [2]
<div><each in=@xs as y><each in=@ys as x if=(@pw == "secret")><b>r</b></each></each></div>
`);
    expect(errors).toEqual([]);
    const gate = js.indexOf(`if (!((_scrml_structural_eq(_scrml_cs_reactive_get("pw"), "secret")))) {`);
    const read = js.indexOf(`= _scrml_cs_reactive_get("ys");`);
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(gate);
    expect(js.slice(gate, read)).toMatch(/_scrml_each_clear\(_scrml_each_mount_\d+\);\s*return;/);
  });

  test("the inner-list effect is a render-gate effect, with or without if=", () => {
    const { errors, js } = compileClient(`<xs> = [1]
<div><each in=@xs as y><each in=@xs as x><b>r</b></each></each></div>
`);
    expect(errors).toEqual([]);
    expect(js).not.toContain("§17.1.2 — this list's if=");
    // The nested list's effect closes with the R7-1 gate flag.
    expect(js).toMatch(/_scrml_mount_track\(_scrml_effect\(\(\) => \{\n\s+let y = _scrml_resolve_item[\s\S]*?\n\s+\}, true\)\);/);
  });

  test("`if=@.ok` reads the enclosing row's item", () => {
    const { errors, js } = compileClient(`<xs> = [{ id: 1, ok: true }]
<div><each in=@xs as y><each in=@xs as x if=@.ok><b>r</b></each></each></div>
`);
    expect(errors).toEqual([]);
    expect(js).toContain("if (!((y.ok))) {");
  });

  test("`if=y.ok` is the row alias, not a cell named y", () => {
    const { errors, js } = compileClient(`<xs> = [{ id: 1, ok: true }]
<div><each in=@xs as y><each in=@xs as x if=y.ok><b>r</b></each></each></div>
`);
    expect(errors).toEqual([]);
    expect(js).toContain("if (!((y.ok))) {");
    expect(js).not.toContain(`_scrml_cs_reactive_get("y")`);
  });

  test("a cell predicate lowers exactly as the top-level mount controller lowers it", () => {
    const nested = compileClient(`<ok> = false
<xs> = [1]
<div><each in=@xs as y><each in=@xs as x if=@ok><b>r</b></each></each></div>
`);
    const top = compileClient(`<ok> = false
<xs> = [1]
<div><each in=@xs as x if=@ok><b>r</b></each></div>
`);
    expect(nested.errors).toEqual([]);
    expect(top.errors).toEqual([]);
    expect(nested.js).toContain(`if (!(_scrml_cs_reactive_get("ok"))) {`);
    expect(top.js).toContain(`if (_scrml_cs_reactive_get("ok")) _scrml_if_mount_`);
  });

  test("lifted markup: the `<each if=…>` is gated (was silently ignored)", () => {
    const { errors, all, js } = compileClient(`<pw> = "wrong"
<rows> = [{ id: 1, cells: [1] }]
<div>\${ for (r of @rows) { lift <div><each in=r.cells as c if=(@pw == "secret")><b>r</b></each></div> } }</div>
`);
    expect(errors).toEqual([]);
    // The attribute is honoured, so W-ATTR-001 ("not recognized … no compile-time effect") is gone.
    expect(all.filter((c) => c === "W-ATTR-001")).toEqual([]);
    const gate = js.indexOf(`if (!((_scrml_structural_eq(_scrml_cs_reactive_get("pw"), "secret")))) {`);
    expect(gate).toBeGreaterThan(-1);
    expect(js.indexOf("= r.cells;")).toBeGreaterThan(gate);
  });
});

describe("lifted <each if=…> — live loop item (review F1)", () => {
  test("inside a reconciled lift row the gate's loop var is re-resolved by key first", () => {
    const { errors, js } = compileClient(`<rows> = [{ id: 1, ok: true, cells: [1] }]
<div>\${ for (r of @rows) { lift <div><each in=r.cells as c if=r.ok><b>s</b></each></div> } }</div>
`);
    expect(errors).toEqual([]);
    const resolve = js.search(/let r = _scrml_resolve_item\(_scrml_list_wrapper_\d+, _scrml_item_key_\d+\);/);
    const gate = js.indexOf("if (!((r.ok))) {");
    expect(resolve).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(resolve);
    expect(js.indexOf("= r.cells;")).toBeGreaterThan(gate);
  });
});

describe("`else` where no if= chain is built — refused (review F4)", () => {
  test("in a row: E-CTRL-001; in lifted markup: E-CTRL-001; else-if=: E-CTRL-002", () => {
    expect(compileClient(`<xs> = [1]
<div><each in=@xs as y><each in=@xs as x if=@ok>a</each><p else>b</p></each></div>
<ok> = false
`).errors).toContain("E-CTRL-001");
    expect(compileClient(`<rows> = [{ id: 1, ok: true }]
<div>\${ for (r of @rows) { lift <div><p if=r.ok>a</p><p else>b</p></div> } }</div>
`).errors).toContain("E-CTRL-001");
    expect(compileClient(`<xs> = [1]
<ok> = false
<div><each in=@xs as y><p if=@ok>a</p><p else-if=@ok>b</p></each></div>
`).errors).toContain("E-CTRL-002");
  });
});

describe("nested <each if=…> — fails closed", () => {
  test("an if= value kind the gate cannot lower is refused (E-CG-003) and emitted as false", () => {
    resetRefusedLowerings();
    const node = {
      kind: "markup",
      tag: "each",
      attrs: [
        { name: "in", value: { kind: "variable-ref", name: "r.cells" } },
        { name: "as", value: { kind: "variable-ref", name: "c" } },
        { name: "if", value: { kind: "string-literal", value: "secret" } },
      ],
      children: [{ kind: "markup", tag: "b", attrs: [], children: [{ kind: "text", value: "r" }] }],
      span: { start: 10, end: 20 },
    };
    const lines = emitNestedEachFromMarkup(node, "r", "_frag", "", null);
    const refused = drainRefusedLowerings();
    expect(refused.map((e) => e.code)).toEqual(["E-CG-003"]);
    expect(refused[0].message).toContain("refused rather than emitted ungated");
    expect(lines.join("\n")).toContain("if (!(false)) {");
  });
});
