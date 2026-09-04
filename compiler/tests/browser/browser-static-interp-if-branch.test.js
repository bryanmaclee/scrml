/**
 * browser-static-interp-if-branch.test.js — g-call-expression-interpolation-in-
 * if-chain-branch-renders-empty (filed S395-bryan; fixed S400-peter).
 *
 * A STATIC (non-reactive) `${expr}` interpolation — a plain call `${fn()}`, a
 * literal `${VERSION}`, or a static value-control-flow `${ if constCond {…} }` —
 * placed inside an `if=` / if-chain branch rendered EMPTY (exit 0, zero
 * diagnostics), while a CELL interpolation `${@cell}` in the identical position
 * rendered fine.
 *
 * ROOT: the static one-shot render was emitted `rebind=false` into the
 * document-scoped `_scrml_boot` body. Content inside an `if=`/if-chain
 * `<template>` is NOT in the SSR'd initial DOM — it is client-mounted during
 * `_scrml_nav_rewire` — so the boot one-shot ran before mount (`el` null →
 * no-op) and never re-ran. The reactive path worked only because its default
 * `rebind=true` lands in `_scrml_nav_rewire` (re-runs on the mounted subtree).
 *
 * FIX: `emit-html.ts` stamps `insideMountTemplate` on display bindings
 * registered inside a mount-deferred `<template>` (via a depth counter on the
 * binding registry); `emit-event-wiring.ts` ORs that flag into `rebind` at the
 * two static-display call sites, so a template-interior static interp lands in
 * `_scrml_nav_rewire`. SSR-body statics keep the flag false → byte-identical
 * `rebind=false` output (no regression).
 *
 * These assertions drive the full compile → mount → render path and FAIL on the
 * pre-fix base (the `if=` / else / static-VCF slots render empty).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve("/tmp", "scrml-static-interp-if-branch");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors };
}

describe("static ${expr} inside an if= / if-chain branch (g-call-expression-interpolation-in-if-chain-branch-renders-empty)", () => {
  test("a plain call ${fn()} inside an if= branch renders (cell-interp twin still works)", () => {
    const { errors } = compileAndMount(
      `\${
    <flag> = true
    <cellval> = "CELL_OK"
    function greet() { return "FN_OK" }
}
<div>
    <section if=@flag>
        <p id="call">call: \${greet()}</>
        <p id="cell">cell: \${@cellval}</>
    </section>
</div>`,
      "if-call",
    );
    expect(errors).toEqual([]);
    expect(document.querySelector("#call").textContent).toContain("FN_OK");
    expect(document.querySelector("#cell").textContent).toContain("CELL_OK");
  });

  test("a static call ${fn()} inside an if-chain else branch renders", () => {
    compileAndMount(
      `\${
    <n> = 5
    function greet() { return "CHAIN_FN_OK" }
}
<div>
    <p if=(@n > 100)>high</>
    <p else-if=(@n > 50)>mid</>
    <p id="celse" else>else: \${greet()}</>
</div>`,
      "if-chain-else",
    );
    expect(document.querySelector("#celse").textContent).toContain("CHAIN_FN_OK");
  });

  test("a static value-control-flow ${ if constCond {..} else {..} } inside an if= branch renders", () => {
    compileAndMount(
      `\${
    <flag> = true
}
<div>
    <section if=@flag>
        <p id="vcf">vcf: \${ if (true) { "VCF_OK" } else { "no" } }</>
    </section>
</div>`,
      "if-vcf",
    );
    expect(document.querySelector("#vcf").textContent).toContain("VCF_OK");
  });

  test("no regression: a static call ${fn()} in the plain SSR body renders at boot", () => {
    compileAndMount(
      `\${ function greet() { return "PLAIN_FN_OK" } }
<div>
    <p id="pplain">plain: \${greet()}</>
</div>`,
      "plain",
    );
    expect(document.querySelector("#pplain").textContent).toContain("PLAIN_FN_OK");
  });
});
