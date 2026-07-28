// i225 — form-control `value="${@cell}"` inside a variant-guarded region writes
// the `.value` PROPERTY, not the `value` ATTRIBUTE.
//
// THE DEFECT (GH #225). Issue #174 fixed the caret-safe `.value` property write
// for the FILE-SCOPE attribute-template lowering (emit-bindings.ts
// `isFormControlValue`). But a form control rendered INSIDE a `<match>` arm (or
// an `<engine>` state-arm) body takes a DIFFERENT emit path — the arm wire fn
// in emit-variant-guard.ts, fed by an arm-tagged `attr-template` LogicBinding
// registered in emit-html.ts (the top-level emit-bindings pass never descends
// into arm bodies). That path had NO form-control special-case and still emitted
// the buggy `el.setAttribute("value", …)`. Consequence: the browser stops
// reflecting the `value` ATTRIBUTE once the control is user-dirtied, so a
// reactive `@cell = ""` re-ran setAttribute but never cleared the field.
//
// THE FIX. Mirror i174 on the arm path. At registration (emit-html.ts) — where
// the element tag and its sibling attrs are in scope — compute a
// `directiveIsFormValue` marker (attrName === "value" AND tag ∈ {input,textarea,
// select} AND no sibling `bind:value`/`bind:valueAsNumber`). emit-variant-guard.ts
// branches on it, emitting the caret-safe property write
// `{ const _v = <expr>; if (el.value !== _v) el.value = _v; }` (once at mount +
// inside the disposer-pushed `_scrml_effect`) instead of setAttribute.
//
// The `!hasBindValue` guard is preserved: `bind:value` is the sanctioned two-way
// owner of `.value`, so when it coexists with a template `value=`, the template
// form falls through to setAttribute rather than emit a second, competing `.value`
// writer (parity with the file-scope F5-tpl+bind:value case in
// value-attr-binding-i81.test.js).

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import * as acorn from "acorn";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(scrmlSource, testName) {
  const tag = testName ?? `i225-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_i225_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    let html = null;
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const emittedClient = (r) => r.clientJs ?? "";

// Same evaluation bar as value-attr-binding-i81.test.js: emission proves nothing
// unless the bundle is a valid ES module (write:false skips the S141 emit gate,
// so `r.errors === []` is structurally blind to a codegen SyntaxError).
function expectParses(client) {
  expect(client.length).toBeGreaterThan(0);
  try {
    acorn.parse(client, { ecmaVersion: 2022, sourceType: "module" });
  } catch (e) {
    throw new Error(`emitted client bundle is not valid JavaScript (Acorn sourceType:module): ${e.message}`);
  }
}

// The exact adopter shape: an <input> with a reactive template value= and an
// oninput handler (no bind:value), rendered inside a <match> arm body.
const armInputSrc = `<program>
  <div>
    \${
      type Mode:enum = { A, B }
      <m>: Mode = .A
      <cell> = ""
    }
    \${ function upd() { @cell = "" } }
    <match for=Mode on=@m>
      <A><input type="text" value="\${@cell}" oninput=upd()/></A>
      <B><span>b</span></B>
    </match>
  </div>
</program>`;

describe("§i225.1 — the reproducer: template value= on an <input> inside a <match> arm", () => {
  test("compiles clean (no errors) and the bundle is a valid ES module", () => {
    const r = compile(armInputSrc);
    expect(r.errors).toEqual([]);
    expectParses(emittedClient(r));
  });

  test("writes the .value PROPERTY, not setAttribute(\"value\")", () => {
    const client = emittedClient(compile(armInputSrc));
    // The regression: pre-fix the arm wire fn emitted el.setAttribute("value", …).
    expect(client).not.toContain('setAttribute("value"');
    // Caret-safe property write: `{ const _v = …; if (el.value !== _v) el.value = _v; }`.
    expect(client).toMatch(/if \(el\.value !== _v\) el\.value = _v;/);
  });

  test("the property write is acquired via _root.querySelector and pushed onto _disposers", () => {
    const client = emittedClient(compile(armInputSrc));
    // The arm-path acquisition + disposal shape is unchanged — only the write
    // mechanism moved from setAttribute to a .value property assignment.
    expect(client).toMatch(/_root\.querySelector\("\[data-scrml-attr-tpl-value=/);
    expect(client).toMatch(/_disposers\.push\(_scrml_effect\(function\(\) \{ const _v = [^;]*; if \(el\.value !== _v\) el\.value = _v; \}\)\)/);
  });

  test("the oninput handler still wires (the value fix does not disturb events)", () => {
    const client = emittedClient(compile(armInputSrc));
    expect(client).toContain("addEventListener");
  });
});

describe("§i225.2 — <textarea> parity inside an arm", () => {
  test("template value= on a <textarea> in an arm writes the .value PROPERTY", () => {
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <note> = "hi"
        }
        <match for=Mode on=@m>
          <A><textarea value="\${@note}"></textarea></A>
          <B><span>b</span></B>
        </match>
      </div>
    </program>`;
    const client = emittedClient(compile(src));
    expect(client).toMatch(/if \(el\.value !== _v\) el\.value = _v;/);
    expect(client).not.toContain('setAttribute("value"');
  });
});

describe("§i225.3 — no over-reach: only the form-control value family moves", () => {
  test("a template NON-value attr in an arm still uses setAttribute", () => {
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <status> = "ok"
        }
        <match for=Mode on=@m>
          <A><span title="state-\${@status}">a</span></A>
          <B><span>b</span></B>
        </match>
      </div>
    </program>`;
    const client = emittedClient(compile(src));
    // Generic attrs keep the attribute lowering — no property assignment.
    expect(client).toContain('setAttribute("title"');
    expect(client).not.toMatch(/el\.value = _v/);
  });

  test("template value= on a NON-form element in an arm still uses setAttribute", () => {
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <lbl> = "L"
        }
        <match for=Mode on=@m>
          <A><div value="\${@lbl}">x</div></A>
          <B><span>b</span></B>
        </match>
      </div>
    </program>`;
    const client = emittedClient(compile(src));
    expect(client).toContain('setAttribute("value"');
    expect(client).not.toMatch(/el\.value = _v/);
  });

  test("a sibling bind:value defers ownership: no competing .value property writer from the template value=", () => {
    // Axiom ① — bind:value is the sanctioned two-way owner of .value. The template
    // value= must NOT emit a second .value writer; it falls back to setAttribute
    // (parity with the file-scope F5-tpl+bind:value case).
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <cell> = ""
        }
        <match for=Mode on=@m>
          <A><input type="text" bind:value=@cell value="\${@cell}"/></A>
          <B><span>b</span></B>
        </match>
      </div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    // The attr-template value= did NOT add a caret-guard .value property writer …
    expect(client).not.toMatch(/if \(el\.value !== _v\) el\.value = _v;/);
    // … it fell through to setAttribute, leaving bind:value the sole property owner.
    expect(client).toContain('setAttribute("value"');
  });
});
