/**
 * Regression: g-emit-lift-reconcile-prefixed-interp-not-lowered (S377).
 *
 * A reconciled per-item (`${ for … lift … }`) text child whose text carries a
 * LITERAL PREFIX directly before a `${…}` interpolation — e.g. `P${it.x}` or
 * `x${it.x}` — used to stay glued as ONE text child and ship the raw literal
 * `${it.x}` to the DOM. The AST only splits an interpolation preceded by a
 * NON-word character (`n=${…}`, `Val: ${…}`, ` ${…}`), so those split upstream
 * into a sibling bare-expr child and rendered correctly, masking the hole.
 *
 * The fix teaches the reconcile-ctx text-child branch in emit-lift.js to split
 * the glued text and lower each `${…}` LIVE-KEYED (stable text node +
 * per-item effect), identical to the sibling bare-expr reconcile path.
 *
 * Dog-food origin (S377): a `<span class="pri">P${t.priority}</span>` inside a
 * task-board `<each>`-style list rendered the literal `P${t.priority}`.
 */
import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

function compileAndMount(src) {
  const d = resolve(tmpdir(), `lift-prefix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(resolve(d, "app.scrml"), src);
  try {
    const r = compileScrml({ inputFiles: [resolve(d, "app.scrml")], write: true, outputDir: resolve(d, "out") });
    const clientJs = readFileSync(resolve(d, "out", "app.client.js"), "utf-8");
    const html = readFileSync(resolve(d, "out", "app.html"), "utf-8");
    const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    document.body.innerHTML = bodyHtml;
    const code = `(function(){\n${SCRML_RUNTIME}\n` +
      captureInsideChunkScope(clientJs, `window._scrml_reactive_get=_scrml_reactive_get;window._scrml_reactive_set=_scrml_reactive_set;`) +
      `\n})();`;
    eval(code);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    return { errors, clientJs };
  } finally {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
}

const SRC = `<div>
  \${
    <rows> = [ { id: 1, x: 7 } ]
    function bump() { @rows = @rows.map(function(r){ return { id: r.id, x: r.x + 1 } }) }
  }
  <button id="bump" onclick=bump()>bump</>
  <ul>
    \${ for (let r of @rows) {
      lift <li data-id=r.id><span class="pfx">P\${r.x}</span><span class="mid">a\${r.x}b</span></li>
    } }
  </ul>
</div>
`;

describe("lift prefixed interpolation (S377) — reconciled per-item text child", () => {
  test("a literal-prefixed ${…} renders the value, not the raw source", () => {
    const { errors, clientJs } = compileAndMount(SRC);
    expect(errors).toEqual([]);
    // The raw interpolation must NOT survive into the emitted client JS as a literal.
    expect(clientJs.includes('createTextNode("P${r.x}")')).toBe(false);
    const li = document.querySelector("li[data-id='1']");
    expect(li).not.toBeNull();
    expect(document.querySelector("li[data-id='1'] .pfx").textContent).toBe("P7");
    expect(document.querySelector("li[data-id='1'] .mid").textContent).toBe("a7b");
  });

  test("the prefixed interpolation stays reactive across a reconcile", () => {
    compileAndMount(SRC);
    document.getElementById("bump").dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.querySelector("li[data-id='1'] .pfx").textContent).toBe("P8");
    expect(document.querySelector("li[data-id='1'] .mid").textContent).toBe("a8b");
  });

  // SCOPE NOTE: this fix closes the WORD-CHAR-GLUED case (`P${x}`), where the whole
  // interpolation shipped as a raw literal. The WHITESPACE-adjacent variant
  // (`Val ${x}` → "Val7", `Saved ${@cell}` → "Savedhello") is a SEPARATE, pre-existing
  // UPSTREAM bug — the AST strips the space when it splits the text child (different
  // root, top-level too, its own reds in g-emit-lift-markup-text-interp.browser.test.js).
  // Left as a documented follow-on so this suite does not read as closing the space case.
  test.todo("g-ast-markup-text-interp-adjacent-space-dropped — `Val ${x}` should keep its space");
});
