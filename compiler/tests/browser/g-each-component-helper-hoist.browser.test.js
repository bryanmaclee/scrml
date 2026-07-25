/**
 * g-each-component-helper-hoist.browser.test.js — STEP 1 regression gate.
 *
 * Bug (g-each-component-body-invalid-js, STEP 1 / direct imports): when a
 * consumer imports a component from module M and renders it, CE inlines the
 * component's body — whose helper calls (e.g. `fmt`) resolve to M's
 * NON-component exports. The consumer bound only the component NAME, so the
 * inlined helper calls were unbound:
 *   - `<each>` per-item path → hard `E-SCOPE-001` at TS (compile FAILS).
 *   - Tier-0 `${for…lift}` path → compiles clean (`node --check` passes), but
 *     the inlined `fmt(...)` survives into the client bundle UNBOUND → a
 *     silently-swallowed runtime `ReferenceError` ("scrml effect error") on the
 *     first reactive render. A latent bug in every shipped component-with-helper.
 *
 * Fix (component-expander.ts, CE import-enrichment seed loop): when an import
 * brings in a user-component, add that module's non-component exports to the
 * import's bindings → the inlined body resolves in BOTH the TS symbol table and
 * the codegen `_scrml_modules[key]` destructure.
 *
 * Same class as Bug 57 (called-but-never-defined helper). Models:
 * `each-runtime-bug-57.test.js` (real compile + happy-dom mount via `new Function`).
 *
 * NOTE — direct (non-nested) components only. The transitive/nested case
 * (a component whose body renders ANOTHER imported component, e.g. a status
 * badge) is STEP 2 (g-each-component-body-invalid-js, still open) and is NOT
 * asserted here.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { chunkCellKey } from "../helpers/chunk-scope.js";
import { compileScrml } from "../../src/api.js";

// Component with an `export fn` helper used in its OWN body — the load-card.scrml
// shape (`formatRate` / `${formatRate(load.rate_dollars)}`).
const CARD = `\${
    export fn fmt(n: number) -> string {
        return \`#\${n}\`
    }

    export const Card = <span class="c" props={ n: number }>
        \${fmt(n)}
    </>
}
`;

// Tier-0 for-lift form — the form the gap filing called "works" (it only
// COMPILES; the inlined fmt call is unbound at runtime pre-fix).
const PAGE_FORLIFT = `<program>
\${
    import { Card } from './card.scrml'
}
<nums>: number[] = []
<ul>
    \${
        for (let x of @nums) {
            lift <li><Card n=x/></li>
        }
    }
</ul>
</program>
`;

// `<each>` per-item form — the path that FAILS at compile (E-SCOPE-001) pre-fix.
const PAGE_EACH = `<program>
\${
    import { Card } from './card.scrml'
}
<nums>: number[] = []
<ul>
    <each in=@nums as x>
        <li><Card n=x/></li>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-g-each-helper-hoist");

/**
 * Write card.scrml + the given page source, compile both via the real compile
 * path (write:true), and return the page's html/client.js + the content-hashed
 * runtime + card.client.js.
 */
function compileCase(pageSrc) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const pagePath = resolve(tmpDir, "page.scrml");
  const cardPath = resolve(tmpDir, "card.scrml");
  writeFileSync(pagePath, pageSrc);
  writeFileSync(cardPath, CARD);
  try {
    const result = compileScrml({ inputFiles: [pagePath, cardPath], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "page.html")),
      clientJs: read(resolve(outDir, "page.client.js")),
      cardJs: read(resolve(outDir, "card.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — Compile + static emit-regression (FAILS pre-fix, PASSES post-fix)
// ---------------------------------------------------------------------------

describe("g-each-helper-hoist §1 — consumer binds the inlined component's helper", () => {
  test("for-lift page compiles with no errors", () => {
    expect(compileCase(PAGE_FORLIFT).errors).toEqual([]);
  });

  test("`<each>` page compiles with no errors (pre-fix: E-SCOPE-001 on `fmt`)", () => {
    const { errors } = compileCase(PAGE_EACH);
    const scope = errors.filter((e) => e.code === "E-SCOPE-001");
    expect(scope).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("page.client.js CALLS fmt AND binds it from the component module (the fix)", () => {
    const { clientJs } = compileCase(PAGE_FORLIFT);
    expect(/\bfmt\s*\(/.test(clientJs)).toBe(true); // inlined helper call
    // Pre-fix this FAILS: fmt was called but never destructured/defined.
    const binds = /const\s*\{[^}]*\bfmt\b[^}]*\}\s*=\s*_scrml_modules/.test(clientJs);
    expect(binds).toBe(true);
  });

  test("no dangling call: fmt is bound in client+card (Bug-57 defined-set check)", () => {
    const { clientJs, cardJs } = compileCase(PAGE_FORLIFT);
    const bound = /const\s*\{[^}]*\bfmt\b/.test(clientJs);   // importer binds it
    const defined = /_scrml_fmt|function\s+\w*fmt/.test(cardJs); // exporter defines it
    expect(bound && defined).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom runtime drive (asserts NO effect-error + cards render)
// ---------------------------------------------------------------------------

describe("g-each-helper-hoist §2 — for-lift renders the helper output at runtime", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  function mountForlift() {
    const { html, clientJs, cardJs, runtimeJs } = compileCase(PAGE_FORLIFT);
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    // Match page.html script order: runtime -> card -> page (shared `var _scrml_modules`).
    const exec = new Function("window", "document",
      `${runtimeJs}\n${cardJs}\n${clientJs}\n` +
      `globalThis.__set__ = (typeof _scrml_reactive_set!=='undefined')?_scrml_reactive_set:null;`);
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // BUG-6: the page chunk keys its cells under its token; a bare-global write
    // from OUTSIDE the chunk must key through it or the scoped each-effect never fires.
    const cellKey = chunkCellKey(clientJs);
    if (globalThis.__set__) globalThis.__set__(cellKey("nums"), [1, 2, 3]);
    console.error = origErr;
    return { errs, li: document.querySelectorAll("li") };
  }

  test("populating @nums renders one <li> per item with the helper output (no effect-error)", () => {
    const { errs, li } = mountForlift();
    const refErrors = errs.filter((e) => /ReferenceError|fmt is not defined|scrml effect error/.test(e));
    expect(refErrors).toEqual([]);
    expect(li.length).toBe(3);
    expect(li[0].textContent).toContain("#1");
    expect(li[2].textContent).toContain("#3");
  });
});
