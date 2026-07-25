/**
 * chunk-ns-intact-bundle-acceptance.test.js — BUG-6 SHIPPED-bundle acceptance.
 *
 * Adversarial guard (S286): executes the SHIPPED client bundle with the chunk
 * scope FULLY INTACT — the `_scrml_cs_` cell-scope prologue AND the N3 IIFE wrap
 * are UNTOUCHED (zero fold / unwrap / normalize). This is the counter-proof that
 * the many test-harness `foldChunkNamespacing` / `unwrapChunkScope` accommodations
 * elsewhere are TEST-side (eval-in-isolation reaching INTO the chunk) and do NOT
 * paper over a broken product:
 *
 *   - the SHIPPED bundle executes WITHOUT throw — the "folded prologue
 *     self-recurses" (RangeError) and dangling-ref (`_scrml_lex_N`,
 *     `__scrml_engine_*_transitions is not defined`) classes are GONE in the
 *     shipped output (they only ever arose when a TEST folded the EXECUTED JS);
 *   - a real engine transition fires on a real click;
 *   - two chunks with COLLIDING cell + engine names eval in ONE document scope
 *     WITHOUT `already been declared` (N3 IIFE isolation), under DISTINCT tokens.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey, chunkNamespaceToken } from "../helpers/chunk-scope.js";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

function compileOne(src, name) {
  const dir = mkdtempSync(join(tmpdir(), "intact-"));
  const p = join(dir, name);
  writeFileSync(p, src);
  const outDir = join(dir, "out");
  const r = compileScrml({ inputFiles: [p], outputDir: outDir, write: true, log: () => {} });
  const base = name.replace(/\.scrml$/, "");
  return {
    errors: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    html: readFileSync(join(outDir, base + ".html"), "utf8"),
    clientJs: readFileSync(join(outDir, base + ".client.js"), "utf8"),
    runtimeJs: readFileSync(join(outDir, r.runtimeFilename ?? "scrml-runtime.js"), "utf8"),
  };
}

const APP = `<program>
\${
  type Phase:enum = { Loading, Ready }
  <phase>: Phase = .Loading
  function go() { @phase = .Ready }
}
<button onclick=go()>go</button>
<div data-testid="phase">\${@phase}</div>
</program>`;

describe("BUG-6 intact-bundle acceptance — shipped chunk scope executes correctly", () => {
  test("the SHIPPED bundle (prologue + IIFE INTACT) executes + transitions with NO throw", () => {
    const a = compileOne(APP, "app.scrml");
    expect(a.errors).toEqual([]);
    // The token proves the chunk IS namespaced (prologue + IIFE present).
    expect(chunkNamespaceToken(a.clientJs).length).toBe(8);
    expect(a.clientJs).toContain("(function() {");
    expect(a.clientJs).toContain("_scrml_cs_reactive_set(");

    const body = a.html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? a.html;
    document.documentElement.innerHTML = body;

    let threw = null;
    // Execute the client bundle AS SHIPPED — NO fold, NO unwrap. Expose only the
    // BARE runtime getter for the assertion (the chunk uses its own scoped
    // accessors internally; this handle does not perturb it).
    try {
      new Function("window", "document", `${a.runtimeJs}\n${a.clientJs}\nwindow.__get = _scrml_reactive_get;`)(
        globalThis.window, globalThis.document,
      );
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();

    const key = chunkCellKey(a.clientJs);
    expect(globalThis.window.__get(key("phase"))).toBe("Loading");
    const btn = [...document.querySelectorAll("button")].find((b) => /go/.test(b.textContent || ""));
    expect(btn).toBeTruthy();
    btn.click();
    // Intact engine transition on a real click.
    expect(globalThis.window.__get(key("phase"))).toBe("Ready");
  });

  test("two chunks with COLLIDING names eval in ONE scope with no redeclaration (N3/N2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "intact2-"));
    const PAGE = (tag) => `<program>
\${
  type Phase:enum = { Loading, Ready }
  <rows> = ["${tag}"]
  <phase>: Phase = .Loading
}
<div class="${tag}">\${@phase}</div>
</program>`;
    const ap = join(dir, "alpha.scrml"), bp = join(dir, "beta.scrml");
    writeFileSync(ap, PAGE("alpha"));
    writeFileSync(bp, PAGE("beta"));
    const r = compileScrml({ inputFiles: [ap, bp], outputDir: join(dir, "out"), write: true, log: () => {} });
    expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);
    const alphaJs = readFileSync(join(dir, "out", "alpha.client.js"), "utf8");
    const betaJs = readFileSync(join(dir, "out", "beta.client.js"), "utf8");
    // DISTINCT per-source tokens (fnv1a of the path).
    expect(chunkNamespaceToken(alphaJs)).not.toBe(chunkNamespaceToken(betaJs));
    // N2: the shared `<rows>` cell keys distinctly per chunk.
    expect(chunkCellKey(alphaJs)("rows")).not.toBe(chunkCellKey(betaJs)("rows"));

    document.documentElement.innerHTML = "<body></body>";
    let threw = null;
    try {
      const rt = readFileSync(join(dir, "out", r.runtimeFilename ?? "scrml-runtime.js"), "utf8");
      // Both SHIPPED bundles, INTACT, in one shared script scope. Pre-N3 this threw
      // `Identifier 'Phase_variants' has already been declared`.
      new Function("window", "document", `${rt}\n${alphaJs}\n${betaJs}`)(globalThis.window, globalThis.document);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
  });
});
