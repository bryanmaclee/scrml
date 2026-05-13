/**
 * Bug 2c regression suite — bind:value=@x HTML serialization in expanded
 * component bodies.
 *
 * Bug class: when a `<MyComponent/>` reference is expanded inline, the
 * component-def's `raw` (a logic-tokenizer space-joined token stream) is
 * normalized via `normalizeTokenizedRaw` and then re-fed through BS+TAB.
 * Pre-fix, the normalize step collapsed `=` and `-` separator whitespace
 * but did NOT collapse `:` whitespace, so source like `bind:value=@firstName`
 * arrived at the markup tokenizer as `bind : value=@firstName`. The markup
 * tokenizer's ATTR_NAME regex (`[A-Za-z0-9_:\-@]`, tokenizer.ts:248)
 * consumes no whitespace, so it emitted `bind` and `value` as TWO separate
 * ATTR_NAME tokens. The trailing `=@firstName` was bound to the second
 * name (`value`), and emit-html serialized the result as the literal HTML
 * attribute pair `bind value="firstName"` — a complete loss of the §5.4 /
 * §5.4.1 bind:value reactive-attribute contract.
 *
 * Fix (commit df4582e): add Step 4c to `normalizeTokenizedRaw` symmetric to
 * existing Step 4 (hyphen collapse) — `(\w)\s+:\s+(\w)` → `$1:$2`. Applies
 * to ALL `<word> : <word>` patterns including bind:, class:, on:,
 * onserver:, onclient:, transition:, in:, out:, and arbitrary namespace
 * prefixes. Same safety profile as Step 4: object literals
 * (`{key : value}`), TS-style annotations (`name : string`), and ternaries
 * (`a ? b : c`) are also re-collapsed but remain syntactically valid.
 *
 * The non-component path (`<input bind:value=@x/>` outside any component
 * body) was never affected — it bypasses the tokenize-detokenize roundtrip.
 *
 * Cross-ref: SPEC §5.4 + §5.4.1 (bind-dispatch table, L17 lock); primer
 * §4 Shape 2 (decl-coupled-with-render-spec). Surfaced post-Bug-2a in
 * 05-multi-step-form per the S87 Bug 2a finding #2 thread.
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bug2c-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bug2c_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
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
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

describe("Bug 2c — bind:value HTML serialization in expanded component bodies", () => {
  test("§A: bind:value=@x in component body emits data-scrml-bind-value placeholder (NOT `bind value=...`)", () => {
    const src = `<program>

\${
  <firstName> = ""
}

\${
  const InfoStep = <div class="step">
    <input type="text" bind:value=@firstName/>
  </div>
}

<div>
  <InfoStep/>
</div>

</program>`;
    const { errors, html } = compileSource(src, "bind-value-basic");
    expect(errors.filter(e => e && e.severity === "error" && e.code !== "W-PROGRAM-001")).toEqual([]);
    expect(html).not.toBeNull();
    // POSITIVE: the placeholder marker MUST appear (correct emission)
    expect(html).toMatch(/data-scrml-bind-value="_scrml_bind_bind_value_/);
    // NEGATIVE: the mangled form MUST NOT appear
    expect(html).not.toMatch(/\bbind value="firstName"/);
    expect(html).not.toMatch(/\bbind value=/);
  });

  test("§B: multiple bind:value attrs in same component body each emit a distinct placeholder", () => {
    const src = `<program>

\${
  <firstName> = ""
  <lastName>  = ""
  <email>     = ""
}

\${
  const InfoStep = <div class="step">
    <input type="text"  bind:value=@firstName/>
    <input type="text"  bind:value=@lastName/>
    <input type="email" bind:value=@email/>
  </div>
}

<div>
  <InfoStep/>
</div>

</program>`;
    const { errors, html } = compileSource(src, "bind-value-multi");
    expect(errors.filter(e => e && e.severity === "error" && e.code !== "W-PROGRAM-001")).toEqual([]);
    expect(html).not.toBeNull();
    // Three placeholders, each one numbered uniquely
    const placeholders = (html.match(/data-scrml-bind-value="[^"]+"/g) ?? []);
    expect(placeholders.length).toBe(3);
    expect(new Set(placeholders).size).toBe(3); // all distinct
    expect(html).not.toMatch(/\bbind value=/);
  });

  test("§C: client.js wires the input-event listener for bind:value in expanded body", () => {
    const src = `<program>

\${
  <firstName> = ""
}

\${
  const InfoStep = <div>
    <input type="text" bind:value=@firstName/>
  </div>
}

<div>
  <InfoStep/>
</div>

</program>`;
    const { errors, html, clientJs } = compileSource(src, "bind-value-wiring");
    expect(errors.filter(e => e && e.severity === "error" && e.code !== "W-PROGRAM-001")).toEqual([]);
    expect(clientJs).not.toBeNull();
    // The bind:value contract requires:
    // 1. A querySelector against the data-scrml-bind-value placeholder
    expect(clientJs).toMatch(/document\.querySelector\(['"]\[data-scrml-bind-value="[^"]+"\]['"]\)/);
    // 2. An input-event listener that writes back to the reactive cell
    expect(clientJs).toMatch(/addEventListener\(["']input["']/);
    expect(clientJs).toMatch(/_scrml_reactive_set\(["']firstName["']/);
  });

  test("§D: bind:checked=@x in component body — checkbox dispatch (parallel to bind:value)", () => {
    const src = `<program>

\${
  <agreed> = false
}

\${
  const Agreement = <label>
    <input type="checkbox" bind:checked=@agreed/>
    Accept terms
  </label>
}

<div>
  <Agreement/>
</div>

</program>`;
    const { errors, html } = compileSource(src, "bind-checked");
    expect(errors.filter(e => e && e.severity === "error" && e.code !== "W-PROGRAM-001")).toEqual([]);
    expect(html).not.toBeNull();
    expect(html).toMatch(/data-scrml-bind-checked="_scrml_bind_bind_checked_/);
    // NEGATIVE: must not split bind:checked into two attrs
    expect(html).not.toMatch(/\bbind checked=/);
  });

  test("§E: class:active=@cond in component body — class directive parallel coverage", () => {
    // class: prefix is the second of the major colon-separator directive
    // families touched by the same fix. If Step 4c regresses, class: would
    // break too.
    const src = `<program>

\${
  <selected> = false
}

\${
  const Pill = <span class="pill" class:active=@selected>label</span>
}

<div>
  <Pill/>
</div>

</program>`;
    const { errors, html } = compileSource(src, "class-active");
    expect(errors.filter(e => e && e.severity === "error" && e.code !== "W-PROGRAM-001")).toEqual([]);
    expect(html).not.toBeNull();
    // class:active is rewritten to data-scrml-class-active (per emit-html.ts)
    expect(html).toMatch(/data-scrml-class-active="_scrml_class_class_active_/);
    // NEGATIVE: must not split class:active into two attrs
    expect(html).not.toMatch(/\bclass active=/);
  });

  test("§F: parity — non-component bind:value emits the same placeholder shape as the component-expanded path", () => {
    // Acceptance criterion #1 phrased positively: verify component-expanded
    // bind:value matches the canonical (non-expanded) emission shape exactly.
    // Both should produce `data-scrml-bind-value="_scrml_bind_bind_value_<n>"`.
    const componentSrc = `<program>

\${
  <name> = ""
}

\${
  const Field = <div>
    <input type="text" bind:value=@name/>
  </div>
}

<div>
  <Field/>
</div>

</program>`;
    const directSrc = `<program>

\${
  <name> = ""
}

<div>
  <input type="text" bind:value=@name/>
</div>

</program>`;
    const { html: htmlComp } = compileSource(componentSrc, "parity-comp");
    const { html: htmlDirect } = compileSource(directSrc, "parity-direct");
    // Both paths emit a `data-scrml-bind-value` placeholder against an input.
    // The numeric suffix may differ (different counter sequence per file)
    // but the attribute KEY and the surrounding shape must be identical.
    expect(htmlComp).toMatch(/<input[^>]*type="text"[^>]*data-scrml-bind-value="_scrml_bind_bind_value_/);
    expect(htmlDirect).toMatch(/<input[^>]*type="text"[^>]*data-scrml-bind-value="_scrml_bind_bind_value_/);
  });
});
