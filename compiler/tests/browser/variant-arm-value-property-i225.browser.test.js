/**
 * variant-arm-value-property-i225.browser.test.js
 *
 * Executed-DOM gate for GH #225 — a reactive `value="${@cell}"` on a form control
 * INSIDE a `<match>` arm / `<engine>` state-arm must write the caret-safe `.value`
 * PROPERTY, so a reactive `@cell = ""` CLEARS a user-dirtied field.
 *
 * The unit test (variant-arm-value-property-i225.test.js) pins the EMIT shape
 * (`.value` write, not setAttribute). This drives the actual gesture the fix
 * exists for — and the exact one flogenceP could not drive from its external
 * harness: dirty the field (property diverges from the attribute), then a reactive
 * clear must reach the PROPERTY. Pre-fix (setAttribute) the attribute changed but
 * the displayed property did not → the field never cleared. (S140/S152 runtime
 * lesson: compile-clean is not enough.)
 *
 * Models: each-bind-value-i175.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const D = "$";
const SRC = `<program>
type Mode:enum = { A, B }
${D}{
  <cell>: string = "start"
  <m>: Mode = .A
}
<match for=Mode on=@m>
  <A><input class="fld" type="text" value="${D}{@cell}"/></A>
  <B><span>b</span></B>
</match>
</program>
`;

function compileOut(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve("/tmp", "scrml-i225-dom", `c-${uniq}`);
  const input = resolve(dir, `${baseName}.scrml`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  return {
    errors: r.errors ?? [],
    html: readFileSync(resolve(outDir, `${baseName}.html`), "utf8"),
    clientJs: readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8"),
    runtimeJs: readFileSync(resolve(outDir, r.runtimeFilename ?? "scrml-runtime.js"), "utf8"),
  };
}

describe("variant-arm-value-property-i225 (executed-DOM)", () => {
  beforeEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} GlobalRegistrator.register(); });
  afterEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} });

  test("a reactive clear reaches the .value PROPERTY of a user-dirtied field in a match arm", () => {
    const { html, clientJs, runtimeJs, errors } = compileOut(SRC, "i225");
    expect(errors.length).toBe(0);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    const fld = () => document.querySelector("input.fld");
    expect(fld()).not.toBeNull();

    // The fix's mechanism: the arm effect writes the reactive value to the .value
    // PROPERTY (not the attribute — note the SSR attribute stays "" throughout).
    globalThis.__set__("cell", "hello");
    expect(fld().value).toBe("hello");        // reactive write reaches the property
    expect(fld().getAttribute("value")).toBe(""); // ...and NOT the attribute (the #225 point)

    // user dirties the field (property diverges from attribute), then a reactive
    // clear must still reach the property — pre-fix (setAttribute) it stayed dirty.
    fld().value = "typed-by-user";
    globalThis.__set__("cell", "");
    expect(fld().value).toBe("");
  });
});
