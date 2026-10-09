/**
 * Callback Props — §15.11 tests
 *
 * Coverage:
 *   §A  bind: tokenizer pass-through — bind:propName=@var on component does NOT produce E-ATTR-011
 *   §B  propsDecl shape — bindable: true from `bind name: type` syntax
 *   §C  propsDecl shape — isFunctionProp: true + W-COMPONENT-001 end-to-end
 *   §D  E-COMPONENT-013 — bind: at call site where prop is not declared as bindable
 *   §E  E-COMPONENT-014 — bind prop declared with non-primitive type
 *   §F  E-ATTR-010 (component form) — RHS of bind: on component is not @-prefixed
 *   §G  W-COMPONENT-001 — function-typed prop warning (end-to-end, unblocked)
 *   §H  Valid bind: expansion — produces _bindProps on expanded node, no errors
 *   §I  bind: codegen wiring — temp-file compile harness
 *   §J  E-ATTR-011 preserved for DOM elements — bind:nonexistent on <div> still errors
 *   §K  Multiple bind: props on same component
 *   §L  bind: prop with default value — call-site @var overrides default
 *   §M  E-COMPONENT-013 vs E-COMPONENT-011 — bind: on completely undeclared prop
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCEFile } from "../../src/component-expander.js";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCEOn(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const tabOut = buildAST(bsOut);
  return runCEFile(tabOut);
}

function runTABOn(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

function collectNodes(nodes, kind) {
  const result = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === kind) result.push(node);
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const val = node[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === "object") walk(val);
    }
  }
  nodes.forEach(walk);
  return result;
}

function collectMarkup(nodes) {
  return collectNodes(nodes, "markup");
}

/** Compile a scrml source string via temp file (mirrors example-js-validity pattern). */
function compileSource(src) {
  const tmp = join(tmpdir(), `scrml-cb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const srcFile = join(tmp, "test.scrml");
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(srcFile, src);
  try {
    const result = compileScrml({
      inputFiles: [srcFile],
      outputDir: outDir,
      write: false,
    });
    const entry = [...result.outputs.values()][0] ?? {};
    return { errors: result.errors ?? [], clientJs: entry.clientJs ?? "" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §A bind: tokenizer pass-through
// ---------------------------------------------------------------------------

describe("§A bind: tokenizer pass-through — component call site", () => {
  test("bind:visible=@showModal on component does NOT produce E-ATTR-011", () => {
    // When a component has a PascalCase name, bind: props should NOT produce E-ATTR-011.
    // The validation is deferred to CE (which knows the component's propsDecl).
    const source = `<program>
\${ const Modal = <div/> }
<Modal bind:visible=@showModal/>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011).toHaveLength(0);
  });

  test("bind:value=@text on PascalCase component does NOT produce E-ATTR-011", () => {
    // Even bind:value (a valid DOM bind) should not produce E-ATTR-011 on a component
    const source = `<program>
\${ const Input = <input/> }
<Input bind:value=@text/>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011).toHaveLength(0);
  });

  test("bind:customName=@val on component does NOT produce E-ATTR-011", () => {
    // Completely custom bind: name on PascalCase component — no E-ATTR-011
    const source = `<program>
\${ const Widget = <div/> }
<Widget bind:customProp=@myVar/>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011).toHaveLength(0);
  });

  test("bind:nonexistent on plain <div> STILL produces E-ATTR-011", () => {
    // DOM element bind: validation must still work — regression guard
    const source = `<program>
<div bind:nonexistent=@val>foo</div>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §B propsDecl shape — bindable: true
// ---------------------------------------------------------------------------

describe("§B propsDecl shape — bindable flag", () => {
  test("bind visible: boolean in props block produces no parse errors", () => {
    // Valid bindable prop declaration — no errors expected
    const source = `<program>
\${ const Modal = <div props={ bind visible: boolean }/> }
</program>`;
    const ceOut = runCEOn(source);
    // No hard errors from parsing the bind prop
    const hardErrors = ceOut.errors.filter(e =>
      e.severity !== "warning" &&
      !["E-COMPONENT-021"].includes(e.code)
    );
    expect(hardErrors).toHaveLength(0);
  });

  test("bind: call-site with bindable prop has no E-COMPONENT-013 or E-COMPONENT-014", () => {
    // Full round-trip: component declares bind prop, call site uses bind:
    const source = `<program>
\${ const Toggle = <div props={ bind active: boolean }/> }
<Toggle bind:active=@isActive/>
</program>`;
    const ceOut = runCEOn(source);
    const badErrors = ceOut.errors.filter(e =>
      ["E-COMPONENT-013", "E-COMPONENT-014", "E-ATTR-010"].includes(e.code)
    );
    expect(badErrors).toHaveLength(0);
  });

  test("plain prop (no bind prefix) does not produce E-COMPONENT-013 when called without bind:", () => {
    const source = `<program>
\${ const Label = <span props={ text: string }/> }
<Label text="hello"/>
</program>`;
    const ceOut = runCEOn(source);
    const errs = ceOut.errors.filter(e => e.severity !== "warning");
    expect(errs).toHaveLength(0);
  });

  test("mix of bind and regular props — both parsed", () => {
    const source = `<program>
\${ const Card = <div props={ bind active: boolean, title: string }/> }
<Card bind:active=@isOn title="Test"/>
</program>`;
    const ceOut = runCEOn(source);
    const hardErrors = ceOut.errors.filter(e =>
      e.severity !== "warning" &&
      !["E-COMPONENT-021"].includes(e.code)
    );
    expect(hardErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §C propsDecl shape — isFunctionProp: true + W-COMPONENT-001
//
// Block-splitter fix (fix-scanattributes-brace-depth) allows '>' inside
// bare {..} attribute values to be parsed correctly. These tests were
// previously skipped because props={ onClick: () => void } caused splitBlocks
// to prematurely close the tag on the '>' in '=>'.
// ---------------------------------------------------------------------------

describe("§C propsDecl shape — isFunctionProp flag + W-COMPONENT-001", () => {
  test("function type prop triggers W-COMPONENT-001", () => {
    // props={ onClick: () => void } — the '>' in '=>' must not close the tag
    const source = `<program>
\${ const Card = <div props={ onClick: () => void }/> }
</program>`;
    const ceOut = runCEOn(source);
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001.length).toBeGreaterThan(0);
  });

  test("W-COMPONENT-001 is a warning, not an error", () => {
    // severity must be 'warning', not a hard error
    const source = `<program>
\${ const Card = <div props={ onClick: () => void }/> }
</program>`;
    const ceOut = runCEOn(source);
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001.length).toBeGreaterThan(0);
    expect(w001[0].severity).toBe("warning");
  });

  test("function prop with parameters triggers W-COMPONENT-001", () => {
    // A function prop with parameters — still a function type, still triggers W-COMPONENT-001
    const source = `<program>
\${ const Input = <input props={ onInput: (value: string) => void }/> }
</program>`;
    const ceOut = runCEOn(source);
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001.length).toBeGreaterThan(0);
  });

  test("plain string prop does NOT trigger W-COMPONENT-001", () => {
    // Non-function prop — no W-COMPONENT-001 expected
    const source = `<program>
\${ const Card = <div props={ title: string }/> }
</program>`;
    const ceOut = runCEOn(source);
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001).toHaveLength(0);
  });

  test("W-COMPONENT-001 mentions the component name", () => {
    // The warning message should name the component — 'Card' in this case
    const source = `<program>
\${ const Card = <div props={ onClick: () => void }/> }
</program>`;
    const ceOut = runCEOn(source);
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001.length).toBeGreaterThan(0);
    expect(w001[0].message).toContain("Card");
  });
});

// ---------------------------------------------------------------------------
// §D E-COMPONENT-013 — bind: at call site where prop is not declared as bindable
// ---------------------------------------------------------------------------

describe("§D E-COMPONENT-013 — bind: on non-bindable prop", () => {
  test("bind:label on non-bindable prop emits E-COMPONENT-013", () => {
    const source = `<program>
\${ const Tag = <span props={ label: string }/> }
<Tag bind:label=@tagText/>
</program>`;
    const ceOut = runCEOn(source);
    const e013 = ceOut.errors.filter(e => e.code === "E-COMPONENT-013");
    expect(e013.length).toBeGreaterThan(0);
    expect(e013[0].message).toContain("label");
    expect(e013[0].message).toContain("Tag");
  });

  test("E-COMPONENT-013 message suggests using bind keyword in props block", () => {
    const source = `<program>
\${ const Tag = <span props={ label: string }/> }
<Tag bind:label=@tagText/>
</program>`;
    const ceOut = runCEOn(source);
    const e013 = ceOut.errors.filter(e => e.code === "E-COMPONENT-013");
    expect(e013.length).toBeGreaterThan(0);
    expect(e013[0].message).toContain("bind");
  });

  test("bind: on bindable prop does NOT emit E-COMPONENT-013", () => {
    const source = `<program>
\${ const Toggle = <button props={ bind active: boolean }/> }
<Toggle bind:active=@isOn/>
</program>`;
    const ceOut = runCEOn(source);
    const e013 = ceOut.errors.filter(e => e.code === "E-COMPONENT-013");
    expect(e013).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §E E-COMPONENT-014 — bind prop with non-primitive type
// ---------------------------------------------------------------------------

describe("§E E-COMPONENT-014 — bind prop with non-primitive type", () => {
  test("bind result: FormData (struct type) emits E-COMPONENT-014", () => {
    const source = `<program>
\${ const Form = <form props={ bind result: FormData }/> }
</program>`;
    const ceOut = runCEOn(source);
    const e014 = ceOut.errors.filter(e => e.code === "E-COMPONENT-014");
    expect(e014.length).toBeGreaterThan(0);
    expect(e014[0].message).toContain("result");
    expect(e014[0].message).toContain("FormData");
  });

  test("E-COMPONENT-014 message mentions primitive type requirement", () => {
    const source = `<program>
\${ const Form = <form props={ bind result: FormData }/> }
</program>`;
    const ceOut = runCEOn(source);
    const e014 = ceOut.errors.filter(e => e.code === "E-COMPONENT-014");
    expect(e014.length).toBeGreaterThan(0);
    expect(e014[0].message).toContain("primitive");
  });

  test("bind visible: boolean (primitive) does NOT emit E-COMPONENT-014", () => {
    const source = `<program>
\${ const Modal = <div props={ bind visible: boolean }/> }
</program>`;
    const ceOut = runCEOn(source);
    const e014 = ceOut.errors.filter(e => e.code === "E-COMPONENT-014");
    expect(e014).toHaveLength(0);
  });

  test("bind count: number (primitive) does NOT emit E-COMPONENT-014", () => {
    const source = `<program>
\${ const Counter = <div props={ bind count: number }/> }
</program>`;
    const ceOut = runCEOn(source);
    const e014 = ceOut.errors.filter(e => e.code === "E-COMPONENT-014");
    expect(e014).toHaveLength(0);
  });

  test("bind name: string (primitive) does NOT emit E-COMPONENT-014", () => {
    const source = `<program>
\${ const Input = <div props={ bind name: string }/> }
</program>`;
    const ceOut = runCEOn(source);
    const e014 = ceOut.errors.filter(e => e.code === "E-COMPONENT-014");
    expect(e014).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §F E-ATTR-010 (component form) — RHS of bind: on component is not @-prefixed
// ---------------------------------------------------------------------------

describe("§F E-ATTR-010 (component form) — bind: RHS must be @-prefixed", () => {
  test("bind:visible=notReactive (plain identifier) emits E-ATTR-010", () => {
    const source = `<program>
\${ const Modal = <div props={ bind visible: boolean }/> }
<Modal bind:visible=notReactive/>
</program>`;
    const ceOut = runCEOn(source);
    const e010 = ceOut.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010.length).toBeGreaterThan(0);
  });

  test("bind:visible=@showModal (@-prefixed) does NOT emit E-ATTR-010", () => {
    const source = `<program>
\${ const Modal = <div props={ bind visible: boolean }/> }
<Modal bind:visible=@showModal/>
</program>`;
    const ceOut = runCEOn(source);
    const e010 = ceOut.errors.filter(e => e.code === "E-ATTR-010");
    expect(e010).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §G W-COMPONENT-001 — function-typed prop warning (end-to-end)
//
// Unblocked by fix-scanattributes-brace-depth: block-splitter now tracks bare
// { depth in scanAttributes so '>' inside props={..} does not close the tag.
// ---------------------------------------------------------------------------

describe("§G W-COMPONENT-001 — function-typed prop warning", () => {
  test("W-COMPONENT-001 emitted for each function-typed prop", () => {
    // Two function props — expect two W-COMPONENT-001 warnings (one per prop)
    const source = `<program>
\${ const Form = <form props={ onSubmit: () => void, onCancel: () => void }/> }
</program>`;
    const ceOut = runCEOn(source);
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001.length).toBe(2);
  });

  test("W-COMPONENT-001 does not prevent valid compilation", () => {
    // W-COMPONENT-001 is a warning — compilation should still succeed (no hard errors)
    const source = `<program>
\${ const Card = <div props={ onClick: () => void }/> }
<Card onClick=${`{() => {}}`}/>
</program>`;
    const ceOut = runCEOn(source);
    // W-COMPONENT-001 fires — that's expected
    const w001 = ceOut.errors.filter(e => e.code === "W-COMPONENT-001");
    expect(w001.length).toBeGreaterThan(0);
    // But no hard errors (severity !== 'warning')
    const hardErrors = ceOut.errors.filter(e =>
      e.severity !== "warning" &&
      !["E-COMPONENT-021"].includes(e.code)
    );
    expect(hardErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §H Valid bind: expansion — _bindProps on expanded node
// ---------------------------------------------------------------------------

describe("§H Valid bind: expansion — the bind prop is the caller's cell (S458)", () => {
  test("valid bind:visible=@showModal: no _bindProps sync metadata, no bind:/visible attr on the root", () => {
    const source = `<program>
\${ const Modal = <div class="modal" props={ bind visible: boolean }/> }
<Modal bind:visible=@showModal/>
</program>`;
    const ceOut = runCEOn(source);
    const hardErrors = ceOut.errors.filter(e =>
      e.severity !== "warning" &&
      !["E-COMPONENT-021"].includes(e.code)
    );
    expect(hardErrors).toHaveLength(0);
    const allMarkup = collectMarkup(ceOut.ast.nodes);
    const expanded = allMarkup.find(n => n._expandedFrom === "Modal");
    expect(expanded).toBeDefined();
    // S458: the former global-cell mirror (`_bindProps` → a cell named `visible`
    // shared by every instance) is gone; the body reads/writes `@showModal`.
    expect(expanded._bindProps).toBeUndefined();
    expect((expanded.attrs ?? []).some(a => a.name === "bind:visible" || a.name === "visible")).toBe(false);
    expect((expanded._callSiteProps ?? []).some(a => a.name === "bind:visible")).toBe(true);
  });

  test("no bind: attrs means no _bindProps on expanded node", () => {
    const source = `<program>
\${ const Card = <div class="card" props={ title: string }/> }
<Card title="test"/>
</program>`;
    const ceOut = runCEOn(source);
    const allMarkup = collectMarkup(ceOut.ast.nodes);
    const expanded = allMarkup.find(n => n._expandedFrom === "Card");
    if (expanded) {
      const bp = expanded._bindProps;
      expect(!bp || bp.length === 0).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §I bind: codegen — body reads/writes of a bind prop lower to the caller's cell
// ---------------------------------------------------------------------------

// A bare JS write to the PROP NAME (an undeclared global) or a cell keyed by the
// prop name is the miscompile this section exists to forbid (S458 PA ruling:
// "the result must never compile to a write to an undeclared global").
function assertNoWriteToPropName(clientJs, prop) {
  // Comments are dropped first; `.value =` (a DOM property), `bind:value=` and
  // `bind-value=` (attribute names in comments/selectors) are not JS writes.
  const code = clientJs.replace(/\/\/[^\n]*/g, "");
  const bareWrite = new RegExp(`(^|[^.\\w$"'\`:-])${prop}\\s*(=(?!=)|\\+=|-=|\\*=|\\+\\+|--)`, "m");
  expect(code).not.toMatch(bareWrite);
  expect(clientJs).not.toContain(`_reactive_set("${prop}"`);
}

describe("§I bind: codegen — write-back through the caller's cell (S458)", () => {
  test("§15.11.1 Modal: `visible = false` in a body handler writes @showModal", () => {
    const { errors, clientJs } = compileSource(`<program>
    const Modal = <div class="modal" props={ bind visible: boolean, title: string }>
        <h2>\${title}</h2>
        <span class="state">\${visible}</span>
        <button onclick=\${ visible = false }>Close</button>
    </>
    <showModal> = false
    <button onclick=\${ @showModal = true }>Open settings</button>
    <Modal bind:visible=@showModal title="Settings"/>
</program>`);
    expect(errors.filter(e => e.severity !== "warning")).toHaveLength(0);
    expect(clientJs).toContain(`_scrml_cs_reactive_set("showModal", false)`);
    assertNoWriteToPropName(clientJs, "visible");
  });

  test("compound / ++ writes, a body function, and a guarded write all target the caller's cell", () => {
    const { errors, clientJs } = compileSource(`<program>
    const Counter = <div class="ctr" props={ bind count: number }>
        \${ function reset() { count = 0 } }
        <span>\${count}</span>
        <button onclick=\${ count++ }>a</button>
        <button onclick=\${ count += 10 }>b</button>
        <button onclick=\${ if (count > 5) { count = count * 2 } }>c</button>
        <button onclick=reset()>d</button>
    </>
    <n> = 0
    <Counter bind:count=@n/>
</program>`);
    expect(errors.filter(e => e.severity !== "warning")).toHaveLength(0);
    assertNoWriteToPropName(clientJs, "count");
    expect(clientJs).toContain(`_scrml_cs_reactive_set("n"`);
  });

  test("a bind prop forwarded to an inner <input bind:value=value> binds the caller's cell", () => {
    const { errors, clientJs } = compileSource(`<program>
\${ @text = "" }
\${ const TextField = <input type="text" bind:value=value props={ bind value: string }/> }
<TextField bind:value=@text/>
</program>`);
    expect(errors.filter(e => e.severity !== "warning")).toHaveLength(0);
    expect(clientJs).toContain(`_scrml_cs_reactive_set("text", event.target.value)`);
    assertNoWriteToPropName(clientJs, "value");
  });
});

// ---------------------------------------------------------------------------
// §J E-ATTR-011 preserved for DOM elements (regression guard)
// ---------------------------------------------------------------------------

describe("§J E-ATTR-011 preserved for DOM elements", () => {
  test("bind:nonexistent on plain <div> still emits E-ATTR-011", () => {
    const source = `<program>
<div bind:nonexistent=@val>foo</div>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011.length).toBeGreaterThan(0);
    expect(e011[0].message).toContain("nonexistent");
  });

  test("bind:value on <input> does NOT emit E-ATTR-011", () => {
    const source = `<program>
<input bind:value=@text/>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011).toHaveLength(0);
  });

  test("bind:checked on <input type=checkbox> does NOT emit E-ATTR-011", () => {
    const source = `<program>
<input type="checkbox" bind:checked=@active/>
</program>`;
    const tabOut = runTABOn(source);
    const e011 = tabOut.errors.filter(e => (e.code ?? e.name ?? "").includes("E-ATTR-011"));
    expect(e011).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §K Multiple bind: props on same component
// ---------------------------------------------------------------------------

describe("§K Multiple bind: props on same component", () => {
  test("two bind: props on same component — both validated correctly", () => {
    const source = `<program>
\${ const Range = <div props={ bind min: number, bind max: number }/> }
<Range bind:min=@rangeMin bind:max=@rangeMax/>
</program>`;
    const ceOut = runCEOn(source);
    const hardErrors = ceOut.errors.filter(e =>
      e.severity !== "warning" &&
      !["E-COMPONENT-021"].includes(e.code)
    );
    expect(hardErrors).toHaveLength(0);
  });

  test("mix of bind and regular props — both resolved without errors", () => {
    const source = `<program>
\${ const Ctrl = <div props={ bind active: boolean, label: string }/> }
<Ctrl bind:active=@isOn label="test"/>
</program>`;
    const ceOut = runCEOn(source);
    const e013 = ceOut.errors.filter(e => e.code === "E-COMPONENT-013");
    const e010 = ceOut.errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e013).toHaveLength(0);
    expect(e010).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §L bind: prop with default value
// ---------------------------------------------------------------------------

describe("§L bind: prop with default value", () => {
  test("bind prop with default value is optional at call site", () => {
    // A bind prop with a default should not require bind: at the call site
    const source = `<program>
\${ const Panel = <div props={ bind open: boolean = true }/> }
<Panel/>
</program>`;
    const ceOut = runCEOn(source);
    // Not providing bind:open should be OK when there's a default
    const e010 = ceOut.errors.filter(e => e.code === "E-COMPONENT-010");
    expect(e010).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §M E-COMPONENT-013 vs E-COMPONENT-011 distinction
// ---------------------------------------------------------------------------

describe("§M E-COMPONENT-013 vs E-COMPONENT-011 distinction", () => {
  test("bind: on completely undeclared prop emits E-COMPONENT-011 (undeclared)", () => {
    // bind:nonexistent where no prop named 'nonexistent' exists → E-COMPONENT-011
    const source = `<program>
\${ const Tag = <span props={ label: string }/> }
<Tag bind:nonexistent=@val label="test"/>
</program>`;
    const ceOut = runCEOn(source);
    // Should get E-COMPONENT-011 (undeclared prop) — not E-COMPONENT-013
    const e011 = ceOut.errors.filter(e => e.code === "E-COMPONENT-011");
    expect(e011.length).toBeGreaterThan(0);
    expect(e011[0].message).toContain("nonexistent");
  });

  test("bind: on existing non-bindable prop emits E-COMPONENT-013 (not E-COMPONENT-011)", () => {
    // bind:label where label exists but is not declared with bind → E-COMPONENT-013
    const source = `<program>
\${ const Tag = <span props={ label: string }/> }
<Tag bind:label=@tagText/>
</program>`;
    const ceOut = runCEOn(source);
    const e013 = ceOut.errors.filter(e => e.code === "E-COMPONENT-013");
    expect(e013.length).toBeGreaterThan(0);
  });
});
