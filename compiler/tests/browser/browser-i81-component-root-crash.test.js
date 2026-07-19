/**
 * Browser (execution) regression — #81 / S268 fix-round finding 1.
 *
 * A reactive value attribute on a COMPONENT ROOT that references a STRING prop
 * (`const Badge = <span title=(label) props={label:string}>`, `<Badge label="hi"/>`)
 * was substituted by the expander into `title=(label)` → lowered `((hi))`, where
 * `hi` is a FREE identifier. At DOMContentLoaded that throws a ReferenceError
 * INSIDE the shared wiring handler, so every UNRELATED binding after it on the
 * page never wires — a whole-page crash (strictly worse than the pre-#81 silent
 * drop). It slips the Acorn PARSE gate because `((hi))` is syntactically valid;
 * only EXECUTION catches the free reference.
 *
 * The fix (emit-html.ts `loweredExprHasFreeIdentifier`, gated to `_expandedFrom`
 * roots) FAILS CLOSED: it drops the unsafe attribute (W-CG-VALUE-ATTR-COMPONENT-PROP),
 * restoring the pre-#81 no-crash behavior.
 *
 * This test EXECUTES the bundle (not just Acorn-parses it): mount HTML + run the
 * client bundle + fire DOMContentLoaded, then assert (a) no throw and (b) the
 * unrelated `data-n=(@count)` binding actually wired.
 */
import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";

if (!globalThis.document) GlobalRegistrator.register();

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

function compile(src, slug) {
  const tmpDir = resolve(testDir, `_tmp_${slug}`);
  const tmpInput = resolve(tmpDir, `${slug}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const r = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), log: () => {} });
    let html = null, clientJs = null;
    for (const [fp, o] of r.outputs) {
      if (fp.includes(slug)) { html = o.html ?? null; clientJs = o.clientJs ?? null; }
    }
    return { errors: r.errors ?? [], warnings: r.warnings ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Mount the emitted HTML + run the bundle + fire DOMContentLoaded. */
function mountAndRun(html, clientJs) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = cleanHtml;
  const code = `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
    `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n` +
    `})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { get: (n) => window._scrml_reactive_get(n), set: (n, v) => window._scrml_reactive_set(n, v) };
}

const REPRO = `<program>
\${ const Badge = <span title=(label) props={ label: string }>badge</> }
<count> = 0
<Badge label="hi"/>
<p data-n=(@count)>n</p>
</program>`;

describe("#81/S268 — component-root string-prop value-attr no longer crashes the page", () => {
  test("the unsafe title=(label) is dropped with W-CG-VALUE-ATTR-COMPONENT-PROP (fail-closed)", () => {
    const r = compile(REPRO, "i81crash-drop");
    // Non-fatal: a warning, not a compile error.
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("W-CG-VALUE-ATTR-COMPONENT-PROP");
    // The crashing free-identifier binding is NOT emitted.
    expect(r.clientJs).not.toContain("((hi))");
    expect(r.html).not.toContain("data-scrml-bind-attr-title");
    // The unrelated binding survives in the markup.
    expect(r.html).toMatch(/data-scrml-bind-attr-data-n="[^"]+"/);
  });

  test("EXECUTION: DOMContentLoaded runs cleanly and the unrelated data-n=(@count) binding wires", () => {
    const r = compile(REPRO, "i81crash-exec");
    let threw = null;
    let api = null;
    try {
      api = mountAndRun(r.html, r.clientJs);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    // LOAD-BEARING assertion. happy-dom's dispatchEvent SWALLOWS a listener's
    // exception (it does not rethrow to the caller), so `threw` alone cannot
    // prove no-crash. The real dead-page symptom is that the ReferenceError
    // aborts the wiring handler PARTWAY, so every binding AFTER the crash site
    // never wires. This binding is emitted after the (now-dropped) title site;
    // pre-fix it stayed unwired (getAttribute → null). Mutation-verified: with
    // the fix reverted, `data-n` is null here.
    const p = document.querySelector("p");
    expect(p).not.toBeNull();
    expect(p.getAttribute("data-n")).toBe("0");
    // … and it is REACTIVE: updating @count re-writes the attribute.
    api.set("count", 7);
    expect(p.getAttribute("data-n")).toBe("7");
  });
});
