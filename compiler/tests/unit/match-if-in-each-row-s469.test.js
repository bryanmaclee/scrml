/**
 * match-if-in-each-row-s469 — emission shape of the `if=` gate on a `<match>` inside an
 * `<each>` row (g-structural-if-inside-each-row-template-fails-open, the `<match>` half).
 *
 * Behaviour (arms really mount / unmount, both ways, at depth, across reorders) is pinned
 * by compiler/tests/browser/match-if-in-each-row-s469.browser.test.js; this file pins the
 * shape the behaviour rests on:
 *   - the per-row dispatch is gated in its own render-gate effect (`, true`): false calls
 *     the dispatcher's per-mount teardown, true dispatches;
 *   - the teardown is emitted only for a match that HAS an `if=` (a row match without one
 *     is unchanged);
 *   - the condition is the shared row-scoped if= lowering, in the row's scope;
 *   - a `<match>` in an `<empty>` body gets the ITEM-scoped dispatcher its call site uses;
 *   - an `if=` value the gate cannot lower is REFUSED (E-CG-003), never dropped.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { lowerRowScopedEachIfGate } from "../../src/codegen/emit-each.ts";
import { drainRefusedLowerings, resetRefusedLowerings } from "../../src/codegen/refused-lowering-errors.ts";

const tmpRoot = resolve(tmpdir(), "scrml-unit-match-if-row-s469");

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
  return { errors: errors.map((e) => e.code), js };
}

const PHASE = `type Phase:enum = { Idle, Active }
<ph>: Phase = .Idle
`;
const ARMS = `<Idle><b>i</b></Idle><Active><b>a</b></Active>`;

describe("<match if=…> in an <each> row — emission", () => {
  test("the dispatch is gated in a render-gate effect: false → teardown, true → dispatch", () => {
    const { errors, js } = compileClient(`${PHASE}<pw> = "wrong"
<xs> = [1]
<div><each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></each></div>
`);
    expect(errors).toEqual([]);
    expect(js).toMatch(
      /_scrml_mount_track\(_scrml_effect\(\(\) => \{\n\s+let y = _scrml_resolve_item\([^)]*\);\n\s+if \(y === null\) return;\n\s+if \(!\(\(_scrml_structural_eq\(_scrml_cs_reactive_get\("pw"\), "secret"\)\)\)\) \{\n\s+__scrml_match_match_\w+_teardown\(_scrml_match_mount_\d+\);\n\s+\} else \{\n\s+__scrml_match_match_\w+_dispatch\(_scrml_match_mount_\d+, _scrml_cs_reactive_get\("ph"\)\);\n\s+\}\n\s+\}, true\)\);/,
    );
    // The teardown disposes the arm wiring, removes its nodes and forgets the last value.
    expect(js).toMatch(/function __scrml_match_match_\w+_teardown\(_scrml_arm_mount\) \{\n\s+if \(!_scrml_arm_mount\) return;\n\s+if \(_scrml_arm_mount\["__scrml_match_dispose_match_\w+"\]\) \{[^\n]*\}\n\s+_scrml_arm_mount\.replaceChildren\(\);\n\s+delete _scrml_arm_mount\["__scrml_match_lastv_match_\w+"\];\n\}/);
  });

  test("a row match WITHOUT if= has no gate and no teardown (unchanged)", () => {
    const { errors, js } = compileClient(`${PHASE}<xs> = [1]
<div><each in=@xs as y><match for=Phase on=@ph>${ARMS}</match></each></div>
`);
    expect(errors).toEqual([]);
    expect(js).not.toContain("_teardown");
    expect(js).not.toContain("the if= on this <match>");
    expect(js).toMatch(/__scrml_match_match_\w+_dispatch\(_scrml_match_mount_\d+, _scrml_cs_reactive_get\("ph"\)\);\n\s+\}\)\);/);
  });

  test("`if=@.ok` and `if=y.ok` read the row item, not a cell", () => {
    for (const g of ["@.ok", "y.ok"]) {
      const { errors, js } = compileClient(`${PHASE}<xs> = [{ id: 1, ok: true }]
<div><each in=@xs as y><match for=Phase on=@ph if=${g}>${ARMS}</match></each></div>
`);
      expect(errors).toEqual([]);
      expect(js).toContain("if (!((y.ok))) {");
      expect(js).not.toContain(`_scrml_cs_reactive_get("y")`);
    }
  });

  test("a guard reading an OUTER row re-resolves that row live before the gate", () => {
    const { errors, js } = compileClient(`${PHASE}<gs> = [{ id: 1, ok: true, cells: [1] }]
<div><each in=@gs key=@.id as g><each in=g.cells as c><match for=Phase on=@ph if=(g.ok)>${ARMS}</match></each></each></div>
`);
    expect(errors).toEqual([]);
    const resolveOuter = js.search(/let g = _scrml_resolve_item\(_scrml_mount, _scrml_each_key_\d+\);\n\s+if \(g === null\) return;\n\s+if \(!\(\(g\.ok\)\)\) \{/);
    expect(resolveOuter).toBeGreaterThan(-1);
  });

  test("a cell predicate lowers as the top-level mount controller lowers it", () => {
    const row = compileClient(`${PHASE}<ok> = false
<xs> = [1]
<div><each in=@xs as y><match for=Phase on=@ph if=@ok>${ARMS}</match></each></div>
`);
    expect(row.errors).toEqual([]);
    expect(row.js).toContain(`if (!(_scrml_cs_reactive_get("ok"))) {`);
  });

  test("a match in an <empty> body gets the item-scoped dispatcher its call site uses", () => {
    const { errors, js } = compileClient(`${PHASE}<xs> = []
<div><each in=@xs as y><p>r</p><empty><match for=Phase on=@ph>${ARMS}</match></empty></each></div>
`);
    expect(errors).toEqual([]);
    expect(js).toMatch(/function __scrml_match_match_\w+_dispatch\(_scrml_arm_mount, _scrml_arm_v\) \{/);
    // No module-scope trigger for it, and its call runs in its own effect.
    expect(js).not.toMatch(/_scrml_cs_reactive_subscribe\("ph", __scrml_match_match_/);
    expect(js).toMatch(/_scrml_mount_track\(_scrml_effect\(\(\) => \{\n\s+__scrml_match_match_\w+_dispatch\(_scrml_match_mount_\d+, _scrml_cs_reactive_get\("ph"\)\);\n\s+\}\)\);/);
  });
});

describe("<match if=…> in an <each> row — fails closed", () => {
  test("an if= value kind the gate cannot lower is refused (E-CG-003) and gates false", () => {
    resetRefusedLowerings();
    const node = { kind: "match-block", id: 7, ifCond: { kind: "string-literal", value: "secret" }, span: { start: 3, end: 9 } };
    const cond = lowerRowScopedEachIfGate(node, "y", "match");
    const refused = drainRefusedLowerings();
    expect(refused.map((e) => e.code)).toEqual(["E-CG-003"]);
    expect(refused[0].message).toContain("`<match>` inside an `<each>` row");
    expect(refused[0].message).toContain("refused rather than emitted ungated");
    expect(cond).toBe("false");
  });

  test("no if= → no gate", () => {
    expect(lowerRowScopedEachIfGate({ kind: "match-block", id: 7 }, "y", "match")).toBeNull();
  });
});
