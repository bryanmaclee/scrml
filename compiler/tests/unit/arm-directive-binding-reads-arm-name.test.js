/**
 * g-arm-directive-binding-reads-arm-name — EMIT-SHAPE pins.
 *
 * An element inside a dispatched arm (`<match>` arm, item-scoped `<match>` arm in
 * an `<each>` row, `<engine>` state child) whose `show=` / `disabled=` /
 * `readonly=` / `required=` / value-form `${ if … }` / `<textarea>` content reads
 * a name only the arm binds (a payload binding, a row name) was wired from the
 * MODULE-scope boot (`_scrml_nav_rewire`), where that name does not exist:
 * `ReferenceError: note is not defined` at boot and the element stayed in its
 * unbound state. The unquoted forms (`title=note`, `show=g.hot`,
 * `class:on=g.hot`) were emitted as static strings / as a read of a CELL `g`.
 *
 * Fix — the #1033 mechanism for arm-bound delegable handlers, extended to logic
 * bindings: emitArmWireFunction stamps such a binding with the arm's parameter
 * list; emit-event-wiring lowers it with its OWN lowering but into a hoisted
 * chunk-scope factory `_scrml_armb_<id>(_root, ...armParams)` (see its
 * `armCapture`), which the wire fn calls on every arm entry and whose disposer it
 * owns. emit-html hands an unquoted attribute whose root is an arm name on as the
 * parenthesized expression form. A binding that reads no arm name is untouched.
 *
 * Mounted behaviour: compiler/tests/browser/arm-directive-binding-reads-arm-name.browser.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "arm-directive-unit-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compile(source, { withRuntime = false } = {}) {
  const dir = join(TMP, `case-${++seq}`);
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, "app.scrml");
  writeFileSync(abs, source);
  const outDir = join(dir, "dist");
  const result = compileScrml({ inputFiles: [abs], outputDir: outDir, write: withRuntime, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error");
  if (withRuntime) {
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    return { errors, js: rd("app.client.js"), html: rd("app.html"), runtime: rd(result.runtimeFilename ?? "scrml-runtime.js") };
  }
  const out = [...(result.outputs || new Map()).values()][0];
  return { errors, js: out?.clientJs ?? "", html: out?.html ?? "" };
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
const navRewire = (js) => fnSource(js, /_scrml_nav_rewire/).body;

const PAY = (body) => `<program>
  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("hi")
  <flag> = true
  <match for=Doc on=@cur>
    <Empty><p>none</p></>
    <Note(note)>${body}</>
  </match>
</program>
`;
const ROW = (body) => `<program>
  type Kind:enum = { A, B(tag: string) }
  <groups> = [{ id: 1, kind: Kind.B("hi"), hot: true, name: "hi" }]
  <ul>
    <each in=@groups key=@.id as g>
      <li><match for=Kind on=g.kind><A><p>a</p></><B(tag)>${body}</></match></li>
    </each>
  </ul>
</program>
`;

describe("arm-bound logic bindings — hoisted factory, bound per arm entry", () => {
  test("show=(payload) → a `_scrml_armb_` factory over (_root, note); nothing reads `note` at module scope", () => {
    const { errors, js } = compile(PAY('<p show=(note == "hi")>x</p>'));
    expect(errors).toEqual([]);
    const f = fnSource(js, /_scrml_armb_\w+/);
    expect(f.name).not.toBeNull();
    expect(f.params).toBe("_root, note");
    expect(f.body).toContain(`const el = _root.querySelector('[data-scrml-bind-show=`);
    expect(f.body).toContain(`el.style.display = ((note === "hi")) ? "" : "none";`);
    // the effect's disposer is collected by the factory, not region-tracked globally
    expect(f.body).toContain("const _scrml_region_track = function(_e, _d) { _scrml_arm_ds.push(_d); return _d; };");
    const wire = fnSource(js, /_scrml_match_\w+_wire_Note/);
    expect(wire.params).toBe("_root, note");
    expect(wire.body).toContain(`{ const _d = ${f.name}(_root, note); if (_d) _disposers.push(_d); }`);
    expect(navRewire(js)).not.toContain("note");
  });

  test("the factory is hoisted to chunk scope, not inside the boot function", () => {
    const { js } = compile(PAY('<p show=(note == "hi")>x</p>'));
    const at = js.indexOf("function _scrml_armb_");
    const boot = js.indexOf("function _scrml_boot()");
    expect(at).toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(at);
  });

  test("row arm: disabled= over the row alias and the payload → factories over (_root, tag, g)", () => {
    const { errors, js } = compile(ROW('<button disabled=(g.hot)>a</button><button disabled=(tag == "x")>b</button>'));
    expect(errors).toEqual([]);
    const fns = [...js.matchAll(/function (_scrml_armb_\w+)\(([^)]*)\)/g)];
    expect(fns.length).toBe(2);
    for (const m of fns) expect(m[2]).toBe("_root, tag, g");
    expect(js).toContain(`el.setAttribute("disabled", "")`);
    expect(navRewire(js)).not.toMatch(/\bg\.hot\b/);
  });

  test("value-form ${ if } and <textarea> content over a payload → factories; the value form is effect-wrapped", () => {
    const { errors, js } = compile(PAY('<p>${ if (note == "hi") { "T" } else { "F" } }</p><textarea>${note}</textarea>'));
    expect(errors).toEqual([]);
    const fns = [...js.matchAll(/function (_scrml_armb_\w+)\(([^)]*)\)/g)].map((m) => fnSource(js, new RegExp(m[1])));
    expect(fns.length).toBe(2);
    expect(fns.some((f) => f.body.includes("_scrml_render_value(el, ") && f.body.includes("_scrml_effect("))).toBe(true);
    expect(fns.some((f) => f.body.includes("el.value = ") && f.body.includes("_scrml_region_track(el, _scrml_effect("))).toBe(true);
  });
});

describe("byte-identical when no arm name is read", () => {
  test("show=@cell / disabled=@cell / show=(@flag) in an arm keep their module-scope wiring (no factory)", () => {
    const { errors, js } = compile(PAY('<p show=@flag>a</p><button disabled=@flag>b</button><p show=(@flag)>c</p>'));
    expect(errors).toEqual([]);
    expect(js).not.toContain("_scrml_armb_");
    expect(navRewire(js)).toContain("data-scrml-bind-show");
    expect(navRewire(js)).toContain("data-scrml-bind-bool-disabled");
  });

  test("a string literal naming the payload is not a read (identifier-level check)", () => {
    const { js } = compile(PAY('<p show=(@flag == "note")>a</p>'));
    expect(js).not.toContain("_scrml_armb_");
  });

  test("the same markup outside any arm is unchanged", () => {
    const { js } = compile(`<program>
  <flag> = true
  <p show=@flag>a</p><button disabled=(@flag)>b</button><p title=note>c</p>
</program>
`);
    expect(js).not.toContain("_scrml_armb_");
  });
});

describe("unquoted attribute whose root is an arm name (SPEC §5.2: resolved at runtime)", () => {
  test("title=note → a reactive value attr, not the static string \"note\"", () => {
    const { errors, js, html } = compile(PAY("<p title=note>a</p>"));
    expect(errors).toEqual([]);
    const render = fnSource(js, /_scrml_match_\w+_render_Note/).body;
    expect(render).toContain("data-scrml-bind-attr-title");
    expect(render).not.toContain('title=\\"note\\"');
    expect(html).not.toContain('title="note"');
  });

  test("title=other (not an arm name) stays a static attribute", () => {
    const { js } = compile(PAY("<p title=other>a</p>"));
    const render = fnSource(js, /_scrml_match_\w+_render_Note/).body;
    expect(render).toContain('title=\\"other\\"');
  });

  test("class:on=g.hot in a row arm reads the row alias, not a reactive cell `g`", () => {
    const { errors, js } = compile(ROW('<span class:on=g.hot>h</span>'));
    expect(errors).toEqual([]);
    expect(js).not.toContain('_scrml_reactive_get("g")');
    expect(js).not.toContain('_scrml_cs_reactive_get("g")');
    expect(js).toContain('el.classList.toggle("on", !!(g.hot))');
  });

  test("show=g.hot in a row arm → an arm-bound show= binding", () => {
    const { errors, js } = compile(ROW("<span show=g.hot>h</span>"));
    expect(errors).toEqual([]);
    const f = fnSource(js, /_scrml_armb_\w+/);
    expect(f.params).toBe("_root, tag, g");
    expect(f.body).toContain("el.style.display = (g.hot) ? \"\" : \"none\";");
  });

  test("an unquoted event handler / bare-identifier class: keep their existing lowering", () => {
    const pay = compile(PAY("<p class:on=note>a</p>"));
    // bare-identifier `class:` is E-ATTR-013 territory (§5.5.2) — left exactly as on
    // main (which reads a CELL named `note`; the missing E-ATTR-013 inside an arm
    // body is a separate pre-existing gap).
    expect(pay.js).toContain('_scrml_cs_reactive_get("note")');
    expect(pay.js).not.toContain("_scrml_armb_");
  });
});

describe("runtime chunk", () => {
  test("an engine page whose only reactive surface is an arm-bound show= ships deep_reactive (_scrml_effect)", () => {
    const { errors, js, runtime } = compile(`<program>
type Phase:enum = {
  Idle
  Loaded(label: string)
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loaded>
    <p>idle</p>
  </>
  <Loaded label rule=.Idle>
    <p show=(label == "hi")>S</p>
  </>
</>
</program>
`, { withRuntime: true });
    expect(errors).toEqual([]);
    expect(js).toContain("_scrml_armb_");
    expect(runtime).toMatch(/function _scrml_effect\(/);
  });
});
