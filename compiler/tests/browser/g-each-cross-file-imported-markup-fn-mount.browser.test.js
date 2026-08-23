/**
 * g-each-nested-markup-interp-stringifies residual 2 — EXECUTED-DOM gate.
 *
 * The emit-pattern integration test asserts the mount SHAPE is emitted; this test
 * runs the emitted bundle in happy-dom to prove the cross-file imported markup fn
 * actually renders a DOM ELEMENT (not the text `[object HTMLSpanElement]`), with
 * the module registry wired the way app.html loads it (runtime -> badges.client
 * -> app.client). Matches the executed-DOM discipline the sibling residuals
 * (S297/S327) used for this exact silent-wrong-render class.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const D = "$";
const tmpRoot = resolve("/tmp", "scrml-xfile-markup-dom");

const BADGES = `${D}{
  export fn badge(n: string) { return <span class="b">${D}{n}</span> }
  export fn plain(n: string) { return "hi " + n }
}
`;
const APP = `<program>
${D}{
  import { badge, plain } from './badges.scrml'
}
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
<ul>
  <each in=@rows as it key=it.id>
    <li class="mk">${D}{badge(it.name)}</li>
    <li class="st">${D}{plain(it.name)}</li>
  </each>
</ul>
</program>
`;

// Write badges.scrml + app.scrml, compile the entry (auto-gather), and return the
// runtime + BOTH client chunks + html, in html load order.
function compileXFile() {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  const out = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "badges.scrml"), BADGES);
  writeFileSync(resolve(dir, "app.scrml"), APP);
  try {
    const result = compileScrml({ inputFiles: [resolve(dir, "app.scrml")], write: true, outputDir: out });
    const read = (f) => (existsSync(resolve(out, f)) ? readFileSync(resolve(out, f), "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read("app.html"),
      runtimeJs: read(result.runtimeFilename ?? "scrml-runtime.js"),
      badgesJs: read("badges.client.js"),
      appJs: read("app.client.js"),
    };
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

describe("g-each cross-file imported markup fn — EXECUTED DOM", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  test("imported markup fn renders a real <span> element; imported string fn stays text", () => {
    const { errors, html, runtimeJs, badgesJs, appJs } = compileXFile();
    expect(errors.filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    document.documentElement.innerHTML = html;
    // Run runtime, then badges.client (registers _scrml_modules), then app.client
    // — the exact order app.html loads them. `_scrml_modules` is a runtime global,
    // so the app chunk's `const { badge } = _scrml_modules[...]` resolves.
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${badgesJs}\n` +
        captureInsideChunkScope(
          appJs,
          `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
        ),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    globalThis.__scrml_set__("rows", [{ id: "r1", name: "Ada" }]);

    // The markup <li> must contain a real <span class="b"> ELEMENT with the item's
    // text — NOT the stringified node.
    const mk = document.querySelector("li.mk");
    expect(mk).not.toBeNull();
    const span = mk.querySelector("span.b");
    expect(span).not.toBeNull();
    expect(span.textContent).toContain("Ada");
    expect(mk.textContent).not.toContain("[object");

    // FAIL-SAFE: the imported STRING fn stays plain text (no injected element).
    const st = document.querySelector("li.st");
    expect(st).not.toBeNull();
    expect(st.querySelector("span")).toBeNull();
    expect(st.textContent).toContain("hi Ada");
  });
});
