/**
 * g-match-inside-each-row-cannot-see-the-row-variable — EMIT-SHAPE pins.
 *
 * A block-form `<match>` inside an `<each>` row is item-scoped (R28-1b): one
 * dispatch per row, but its arm render / wire functions live at FILE scope.
 * Pre-fix they received only the arm's payload bindings, so an arm body that
 * read the row — `${g.name}` — emitted `_scrml_render_value(el, g.name)` against
 * a free `g` → `ReferenceError: g is not defined` inside the row factory, and
 * the whole list rendered empty at exit 0.
 *
 * Fix — the #1022 mechanism (a nested lift group gets its row / arm scope as
 * PARAMETERS because it lives at file scope), mirrored for the arm path:
 *   - emit-match computes the row-scope names the arm bodies read
 *     (`rowScopeParams`) and lowers `@.` in the arm bodies to the row iter var;
 *   - the item-scoped dispatch fn takes them after `(_mount, _v)` and the per-row
 *     call (inside the live-keyed effect) passes the CURRENT item;
 *   - every arm wire fn takes them after the payload bindings (a payload binding
 *     of the same name shadows the row name);
 *   - the dispatcher's same-value short-circuit also compares the row values;
 *   - a delegable click that reads a wire-fn param is wired per arm;
 *   - an `<each>` in such an arm renders through `_scrml_each_arm_render_<id>(_root, …)`.
 *
 * Mounted behaviour: compiler/tests/browser/match-in-each-row-scope.browser.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "match-row-scope-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const abs = join(TMP, `case-${++seq}.scrml`);
  writeFileSync(abs, source);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error");
  const out = [...(result.outputs || new Map()).values()][0];
  return { errors, js: out?.clientJs ?? "" };
}

/** The source text of the top-level `function <name>(…) {…}` whose name matches `re`. */
function fnSource(js, re) {
  const m = new RegExp(`function (${re.source})\\(([^)]*)\\) \\{`).exec(js);
  if (!m) return { name: null, params: null, body: "" };
  let depth = 1;
  let i = m.index + m[0].length;
  for (; i < js.length && depth > 0; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") depth--;
  }
  return { name: m[1], params: m[2], body: js.slice(m.index + m[0].length, i - 1) };
}

const program = (body, decls = "") => `<program>
  type Kind:enum = { A, B }
  ${decls}
  <groups> = [{ id: 1, kind: Kind.A, name: "one", items: ["x"] }, { id: 2, kind: Kind.B, name: "two", items: [] }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
${body}
      </li>
    </each>
  </ul>
</program>
`;

describe("g-match-inside-each-row-cannot-see-the-row-variable — emit shape", () => {
  test("the row alias becomes a trailing param of the dispatch fn and of each arm wire fn; the per-row call passes it", () => {
    const { errors, js } = compile(program(`<match for=Kind on=g.kind><A><p>A:\${g.name}</p></><B><p>B:\${g.name}</p></></match>`));
    expect(errors).toEqual([]);
    const dispatch = fnSource(js, /__scrml_match_match_\w+_dispatch/);
    expect(dispatch.params).toBe("_mount, _v, g");
    // the per-row call sits in the live-keyed effect, right after `g` is re-resolved
    expect(js).toMatch(/let g = _scrml_resolve_item\(_mount, _scrml_each_key_\d+\);\s+if \(g === null\) return;\s+__scrml_match_match_\w+_dispatch\(_scrml_match_mount_\d+, g\.kind, g\);/);
    const wireA = fnSource(js, /_scrml_match_match_\w+_wire_A/);
    expect(wireA.params).toBe("_root, g");
    // a row-reading interpolation re-renders on an in-place field edit
    expect(wireA.body).toContain("_disposers.push(_scrml_effect(function() { _scrml_render_value(el, g.name); }));");
    expect(dispatch.body).toMatch(/_scrml_match_match_\w+_wire_A\(_mount, g\)/);
    // the short-circuit compares the row item too (a same-key replace re-renders)
    expect(dispatch.body).toContain("const _rs = [g];");
    expect(dispatch.body).toMatch(/=== _v && _ls && _ls\[0\] === _rs\[0\]\) return;/);
  });

  test("`@.` in an arm body lowers to the row iter var (was `_scrml_reactive_get(\".name\")`)", () => {
    const { errors, js } = compile(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one" }]
  <ul><each in=@groups key=@.id><li class="row">
    <match for=Kind on=@.kind><A><p title="t-\${@.name}">A:\${@.name}</p></><B><p>B</p></></match>
  </li></each></ul>
</program>
`);
    expect(errors).toEqual([]);
    expect(js).not.toContain(`reactive_get(".name")`);
    const wireA = fnSource(js, /_scrml_match_match_\w+_wire_A/);
    expect(wireA.params).toBe("_root, _scrml_each_item");
    expect(wireA.body).toContain("_scrml_each_item.name");
  });

  test("payload bindings come first; a payload binding shadows a same-named row alias in that arm", () => {
    const { errors, js } = compile(`<program>
  type St:enum = { Idle, Busy(note: string), Held(g: string) }
  <groups> = [{ id: 1, st: St.Idle, name: "one" }]
  <ul><each in=@groups key=@.id as g><li class="row">
    <match for=St on=g.st><Idle><p>\${g.name}</p></><Busy note><p>\${note}/\${g.name}</p></><Held g><p>\${g}</p></></match>
  </li></each></ul>
</program>
`);
    expect(errors).toEqual([]);
    expect(fnSource(js, /_scrml_match_match_\w+_wire_Busy/).params).toBe("_root, note, g");
    expect(fnSource(js, /_scrml_match_match_\w+_wire_Held/).params).toBe("_root, g");
    const dispatch = fnSource(js, /__scrml_match_match_\w+_dispatch/);
    expect(dispatch.body).toMatch(/_wire_Busy\(_mount, _data && _data\["note"\], g\)/);
    expect(dispatch.body).toMatch(/_wire_Held\(_mount, _data && _data\["g"\]\)/);
  });

  test("a delegable click that reads the row is wired per arm, not delegated; one that does not stays delegated", () => {
    const { errors, js } = compile(program(
      `<match for=Kind on=g.kind><A><button onclick=pick(g.name)>r</button></><B><button onclick=pick("static")>s</button></></match>`,
      `<picked> = ""\n  function pick(n) { @picked = n }`,
    ));
    expect(errors).toEqual([]);
    const wireA = fnSource(js, /_scrml_match_match_\w+_wire_A/);
    expect(wireA.body).toMatch(/el\.addEventListener\("click", _h\)/);
    expect(wireA.body).toMatch(/_scrml_pick_\d+\(g\.name\)/);
    // the global delegation table carries only the row-free handler
    const table = /const _scrml_click = \{([\s\S]*?)\n  \};/.exec(js)?.[1] ?? "";
    expect(table).toContain(`("static")`);
    expect(table).not.toContain("g.name");
  });

  test("an <each> in the arm renders through a file-scope fn taking the arm scope, run by the wire fn (was: no render fn at all)", () => {
    const { errors, js } = compile(program(`<match for=Kind on=g.kind><A><ol><each in=g.items as it><li>\${it}/\${g.name}</li></each></ol></><B><p>B</p></></match>`));
    expect(errors).toEqual([]);
    const each = fnSource(js, /_scrml_each_arm_render_\w+/);
    expect(each.params).toBe("_root, g");
    expect(each.body).toContain("const _items = g.items;");
    // located inside THIS arm's root (never the per-id anchor cache)
    expect(each.body).toContain("document.createTreeWalker(_root, NodeFilter.SHOW_COMMENT)");
    expect(each.body).not.toContain("_scrml_find_each_anchor");
    // not registered for the module-scope remount path
    expect(js).not.toMatch(new RegExp(`_scrml_each_renderers\\[[^\\]]*\\] = ${each.name};`));
    const wireA = fnSource(js, /_scrml_match_match_\w+_wire_A/);
    expect(wireA.body).toContain(`_disposers.push(_scrml_effect(function() { ${each.name}(_root, g); }));`);
  });

  test("nested each: a match in the INNER row that reads the OUTER alias gets both names", () => {
    const { errors, js } = compile(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, name: "one", subs: [{ id: 10, kind: Kind.A, t: "x" }] }]
  <ul><each in=@groups key=@.id as g><li class="row">
    <each in=g.subs key=@.id as s><span><match for=Kind on=s.kind><A><b>\${s.t}/\${g.name}</b></><B><b>B</b></></match></span></each>
  </li></each></ul>
</program>
`);
    expect(errors).toEqual([]);
    expect(fnSource(js, /__scrml_match_match_\w+_dispatch/).params).toBe("_mount, _v, s, g");
    expect(fnSource(js, /_scrml_match_match_\w+_wire_A/).params).toBe("_root, s, g");
  });

  test("byte-identical where nothing reads the row: a row match whose arms never read it, and a match outside any each", () => {
    const rowFree = compile(program(`<match for=Kind on=g.kind><A><p>A</p></><B><p>B</p></></match>`));
    expect(rowFree.errors).toEqual([]);
    const d1 = fnSource(rowFree.js, /__scrml_match_match_\w+_dispatch/);
    expect(d1.params).toBe("_mount, _v");
    expect(d1.body).not.toContain("_rs");
    expect(rowFree.js).toMatch(/__scrml_match_match_\w+_dispatch\(_scrml_match_mount_\d+, g\.kind\);/);

    const top = compile(`<program>
  type Kind:enum = { A, B }
  <k> = Kind.A
  <match for=Kind on=@k><A><p>A</p></><B><p>B</p></></match>
</program>
`);
    expect(top.errors).toEqual([]);
    expect(fnSource(top.js, /__scrml_match_match_\w+_dispatch/).params).toBe("_v");
  });
});
