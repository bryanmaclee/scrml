/**
 * g-each-component-transitive-helper.browser.test.js — STEP 2 (A+B) regression.
 *
 * Builds on STEP 1 (g-each-component-helper-hoist) with a NESTED component:
 * page → Card → Badge, where Badge lives in a module the PAGE never imports
 * (only Card imports it). Two distinct sub-bugs, one gap:
 *
 *   (A) Transitive helper import — Badge's body calls `label`, a NON-component
 *       export of badge.scrml. The page imports Card from card.scrml, never
 *       badge.scrml, so STEP 1's "augment the existing import" can't reach
 *       `label`. Fix (component-expander.ts): when CE inlines a TRANSITIVELY
 *       reached component, synthesize a consumer import + importGraph edge for
 *       its module's helper exports, injected into the consumer's import logic
 *       block (TS scope) + ast.imports/importGraph (codegen key).
 *
 *   (B) Nested prop substitution — `<Badge s=fmt(n)/>` passes an EXPRESSION
 *       (call-ref) prop. Expression-valued props never enter the string `props`
 *       map (only string-literal + variable-ref do), so buildPropExprMap +
 *       substituteProps both early-returned on the empty map → `s` leaked bare
 *       into Badge's body (`label(s)`) instead of substituting `label(fmt(n))`.
 *       Fix: buildPropExprMap builds ExprNodes for call-ref/member props;
 *       substituteProps proceeds when only propExprMap is populated.
 *
 * Pre-fix: `<each>` → hard E-SCOPE-001 (`label` + `s`); for-lift → compiles but
 * `label`/`s` are unbound at runtime (silently-swallowed ReferenceError).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

// Innermost: a component with its OWN `export fn` helper used in its body.
const BADGE = `\${
    export fn label(s: string) -> string {
        return \`[\${s}]\`
    }

    export const Badge = <em class="b" props={ s: string }>
        \${label(s)}
    </>
}
`;

// Middle: imports Badge, has its own helper, renders Badge with an EXPRESSION
// (call-ref) prop — the nested-prop-substitution trigger (B).
const CARD = `\${
    import { Badge } from './badge.scrml'

    export fn fmt(n: number) -> string {
        return \`#\${n}\`
    }

    export const Card = <span class="c" props={ n: number }>
        \${fmt(n)}
        <Badge s=fmt(n)/>
    </>
}
`;

function PAGE(loopForm) {
  const body = loopForm === "each"
    ? `<each in=@nums as x>\n        <li><Card n=x/></li>\n    </each>`
    : `\${\n        for (let x of @nums) {\n            lift <li><Card n=x/></li>\n        }\n    }`;
  return `<program>
\${
    import { Card } from './card.scrml'
}
<nums>: number[] = []
<ul>
    ${body}
</ul>
</program>
`;
}

const tmpRoot = resolve("/tmp", "scrml-g-each-transitive");

function compileCase(loopForm) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const pagePath = resolve(tmpDir, "page.scrml");
  writeFileSync(pagePath, PAGE(loopForm));
  writeFileSync(resolve(tmpDir, "card.scrml"), CARD);
  writeFileSync(resolve(tmpDir, "badge.scrml"), BADGE);
  try {
    const result = compileScrml({
      inputFiles: [pagePath, resolve(tmpDir, "card.scrml"), resolve(tmpDir, "badge.scrml")],
      write: true, outputDir: outDir,
    });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "page.html")),
      clientJs: read(resolve(outDir, "page.client.js")),
      cardJs: read(resolve(outDir, "card.client.js")),
      badgeJs: read(resolve(outDir, "badge.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-each-transitive §1 — nested component compiles + binds transitive helper", () => {
  test("`<each>` page compiles with no errors (pre-fix: E-SCOPE-001 on `label` + `s`)", () => {
    expect(compileCase("each").errors).toEqual([]);
  });

  test("for-lift page compiles with no errors", () => {
    expect(compileCase("forlift").errors).toEqual([]);
  });

  test("(A) page binds the TRANSITIVE helper `label` from badge's module", () => {
    const { clientJs } = compileCase("forlift");
    // Pre-fix: `label(...)` called but never bound (badge never imported by page).
    expect(/const\s*\{[^}]*\blabel\b[^}]*\}\s*=\s*_scrml_modules/.test(clientJs)).toBe(true);
  });

  test("(B) nested expression prop `s=fmt(n)` is substituted in Badge's body", () => {
    const { clientJs } = compileCase("forlift");
    // Body `${label(s)}` must lower to `label(fmt(x))` — `s` substituted, not bare.
    expect(/label\(\s*fmt\(/.test(clientJs)).toBe(true);
    expect(/label\(\s*s\s*\)/.test(clientJs)).toBe(false); // no bare `s`
  });
});

describe("g-each-transitive §2 — renders at runtime (no effect-error)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("for-lift renders the nested helper output with no ReferenceError", () => {
    const { html, clientJs, cardJs, badgeJs, runtimeJs } = compileCase("forlift");
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    // Script order matches page.html: runtime -> badge -> card -> page.
    const exec = new Function("window", "document",
      `${runtimeJs}\n${badgeJs}\n${cardJs}\n${clientJs}\n` +
      `globalThis.__set__ = (typeof _scrml_reactive_set!=='undefined')?_scrml_reactive_set:null;`);
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // BUG-6: key the bare-global write through the page chunk's token.
    if (globalThis.__set__) globalThis.__set__(chunkCellKey(clientJs)("nums"), [1, 2]);
    console.error = origErr;

    const refErrors = errs.filter((e) => /ReferenceError|not defined|scrml effect error/.test(e));
    expect(refErrors).toEqual([]);
    const li = document.querySelectorAll("li");
    expect(li.length).toBe(2);
    // Card body `${fmt(n)}` → "#1"; Badge body `${label(s)}` with s=fmt(n) → "[#1]".
    expect(li[0].textContent).toContain("#1");
    expect(li[0].textContent).toContain("[#1]");
  });
});
