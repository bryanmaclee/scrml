// S105 B1 — Reactive Boolean HTML attribute wiring
//
// Tests the dispatch path for `disabled=${expr}`, `readonly=${expr}`,
// `required=${expr}` on markup elements. Pre-S105, attribute values with
// kind:"expr" on names other than `if`/`show`/`on*` were silently dropped at
// emit-html.ts. S105 B1 adds REACTIVE_BOOL_ATTRS dispatch + emit-event-wiring
// _scrml_effect toggle.
//
// Closes the §41.14 formFor follow-on (`disabled=!@form.isValid` on the
// default submit button) and unlocks general adopter use of
// `<input disabled=${@busy}>`, `<input readonly=${@locked}>`,
// `<input required=${@needsValue}>`.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(scrmlSource, testName) {
  const tag = testName ?? `b1-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_b1_${tag}`);
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
    return { errors: result.errors ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function emittedHtml(result) {
  return result.html ?? "";
}

function emittedClient(result) {
  return result.clientJs ?? "";
}

describe("§B1.1 — disabled=${expr} emits bool-attr placeholder + runtime toggle", () => {
  test("disabled=!@busy on a button emits data-scrml-bind-bool-disabled placeholder", () => {
    const src = `<program>
      <busy> = false
      <button disabled=!@busy>Click</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-disabled="[^"]+"/);
    expect(html).toContain("<button");
  });

  test("disabled=!@busy emits runtime _scrml_effect toggling setAttribute/removeAttribute", () => {
    const src = `<program>
      <busy> = false
      <button disabled=!@busy>Click</button>
    </program>`;
    const r = compile(src);
    const client = emittedClient(r);
    expect(client).toMatch(/.querySelector\('\[data-scrml-bind-bool-disabled="[^"]+"\]'\)/);
    expect(client).toContain("setAttribute(\"disabled\", \"\")");
    expect(client).toContain("removeAttribute(\"disabled\")");
    expect(client).toContain("_scrml_effect");
  });

  test("disabled=@busy (plain ref form) without expression negation also wires", () => {
    const src = `<program>
      <busy> = false
      <button disabled=\${@busy}>Click</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-disabled="[^"]+"/);
  });

});

describe("§B1.2 — readonly=${expr} emits bool-attr placeholder + runtime toggle", () => {
  test("readonly=@locked on input emits data-scrml-bind-bool-readonly placeholder", () => {
    const src = `<program>
      <locked> = true
      <input type="text" readonly=\${@locked}/>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-readonly="[^"]+"/);
  });

  test("readonly runtime toggles setAttribute/removeAttribute", () => {
    const src = `<program>
      <locked> = false
      <input type="text" readonly=\${@locked}/>
    </program>`;
    const r = compile(src);
    const client = emittedClient(r);
    expect(client).toContain("setAttribute(\"readonly\", \"\")");
    expect(client).toContain("removeAttribute(\"readonly\")");
  });
});

describe("§B1.3 — required=${expr} emits bool-attr placeholder + runtime toggle", () => {
  test("required=@needsValue on input emits data-scrml-bind-bool-required placeholder", () => {
    const src = `<program>
      <needsValue> = true
      <input type="text" required=\${@needsValue}/>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-required="[^"]+"/);
  });

  test("required runtime toggles setAttribute/removeAttribute", () => {
    const src = `<program>
      <needsValue> = true
      <input type="text" required=\${@needsValue}/>
    </program>`;
    const r = compile(src);
    const client = emittedClient(r);
    expect(client).toContain("setAttribute(\"required\", \"\")");
    expect(client).toContain("removeAttribute(\"required\")");
  });
});

describe("§B1.4 — non-REACTIVE_BOOL_ATTRS still fall through (regression baseline)", () => {
  test("style=${expr} is NOT in REACTIVE_BOOL_ATTRS — no bool-attr placeholder", () => {
    const src = `<program>
      <busy> = false
      <button style=\${"color: red"}>Click</button>
    </program>`;
    const r = compile(src);
    const html = emittedHtml(r);
    expect(html).not.toMatch(/data-scrml-bind-bool-style=/);
  });

  test("class=${expr} is NOT in REACTIVE_BOOL_ATTRS — no bool-attr placeholder", () => {
    const src = `<program>
      <active> = false
      <div class=\${"active"}>Content</div>
    </program>`;
    const r = compile(src);
    const html = emittedHtml(r);
    expect(html).not.toMatch(/data-scrml-bind-bool-class=/);
  });
});

describe("§B1.5 — formFor follow-on close: default submit button disabled=!@cell.isValid", () => {
  test("formFor default submit emits reactive disabled binding (no more silent drop)", () => {
    const src = `<program>
      ${"$"}{ import { formFor } from 'scrml:data' }
      type Signup:struct = {
        email: string req
        name:  string req
      }
      function onSubmit(values: Signup) {}
      <formFor for=Signup onsubmit=onSubmit/>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    // The synth submit button should carry the bool-attr placeholder for disabled.
    expect(html).toMatch(/data-scrml-bind-bool-disabled="[^"]+"/);
    // And the data-scrml-formfor-submit selector hook should still be present.
    expect(html).toContain("data-scrml-formfor-submit=");
  });

  test("formFor reactive disabled wiring is in the client JS", () => {
    const src = `<program>
      ${"$"}{ import { formFor } from 'scrml:data' }
      type Signup:struct = {
        email: string req
      }
      function onSubmit(values: Signup) {}
      <formFor for=Signup onsubmit=onSubmit/>
    </program>`;
    const r = compile(src);
    const client = emittedClient(r);
    expect(client).toMatch(/.querySelector\('\[data-scrml-bind-bool-disabled="[^"]+"\]'\)/);
    expect(client).toContain("setAttribute(\"disabled\", \"\")");
    expect(client).toContain("removeAttribute(\"disabled\")");
  });
});

describe("§B1.6 — bool-attr binding composes with other reactivity (no cross-talk)", () => {
  test("disabled and class:active on same button both wire correctly", () => {
    const src = `<program>
      <busy> = false
      <active> = true
      <button disabled=!@busy class:active=@active>Click</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    // bool-attr wiring for disabled
    expect(html).toMatch(/data-scrml-bind-bool-disabled="[^"]+"/);
    // class:active is a separate reactive-class binding (existing path)
    expect(html).toContain("class");
  });
});

describe("§B1.8 — bare `@var` bool-attr form (i29-D adopter bug)", () => {
  // i29-D: a BARE `disabled=@saving` (boolean attr assigned a bare `@var`, no
  // `${...}` and no `!`) previously fell through the variable-ref branch to the
  // general static-attr `else`, emitting a STATIC `disabled="saving"`
  // (always-disabled, no reactivity) instead of the reactive bool-binding. The
  // EXPRESSION form (`disabled=!@x` / `disabled=${@x}`) already worked. This
  // block pins the bare form onto the SAME reactive bool-binding for all three
  // REACTIVE_BOOL_ATTRS, plus the contrast/regression guards.

  for (const attr of ["disabled", "readonly", "required"]) {
    test(`bare ${attr}=@saving emits data-scrml-bind-bool-${attr} placeholder (NOT static ${attr}="saving")`, () => {
      const src = `<program>
        <saving> = false
        <input type="text" ${attr}=@saving/>
      </program>`;
      const r = compile(src);
      expect(r.errors).toEqual([]);
      const html = emittedHtml(r);
      // Reactive bool-binding placeholder present…
      expect(html).toMatch(new RegExp(`data-scrml-bind-bool-${attr}="[^"]+"`));
      // …and the always-on STATIC attribute is GONE (the bug's signature).
      expect(html).not.toContain(`${attr}="saving"`);
    });

    test(`bare ${attr}=@saving wires the runtime _scrml_effect toggle`, () => {
      const src = `<program>
        <saving> = false
        <input type="text" ${attr}=@saving/>
      </program>`;
      const r = compile(src);
      const client = emittedClient(r);
      expect(client).toContain(`setAttribute("${attr}", "")`);
      expect(client).toContain(`removeAttribute("${attr}")`);
      expect(client).toContain("_scrml_effect");
      // The bare @var is the reactive source — the toggle reads the `saving` cell.
      expect(client).toContain('_scrml_reactive_get("saving")');
    });
  }

  test("contrast: expression form disabled=!@saving still wires (no regression)", () => {
    const src = `<program>
      <saving> = false
      <button disabled=!@saving>Save</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-disabled="[^"]+"/);
    expect(html).not.toContain('disabled="saving"');
  });

  test("boundary (#81): a NON-bool bare attr `title=@x` stays STATIC (still #81 territory, unchanged)", () => {
    const src = `<program>
      <x> = "hi"
      <div title=@x>Content</div>
    </program>`;
    const r = compile(src);
    const html = emittedHtml(r);
    // No reactive bool-binding for a non-REACTIVE_BOOL_ATTRS name…
    expect(html).not.toMatch(/data-scrml-bind-bool-title=/);
    // …and the existing static @-stripping behavior is preserved.
    expect(html).toContain('title="x"');
  });
});

describe("§B1.7 — placeholder ID uniqueness per attr per element", () => {
  test("two buttons with disabled=!@busy get distinct placeholder IDs", () => {
    const src = `<program>
      <busy> = false
      <button disabled=!@busy>One</button>
      <button disabled=!@busy>Two</button>
    </program>`;
    const r = compile(src);
    const html = emittedHtml(r);
    const matches = [...html.matchAll(/data-scrml-bind-bool-disabled="([^"]+)"/g)];
    expect(matches.length).toBe(2);
    // Distinct placeholder IDs
    expect(matches[0][1]).not.toBe(matches[1][1]);
  });
});
