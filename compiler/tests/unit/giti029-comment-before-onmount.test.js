/**
 * GITI-029 — a `//` line comment immediately before an `on mount {}` directive
 * must NOT defeat the directive (it previously rendered the whole block as a
 * literal text node and the hook never ran).
 *
 * Root cause: BS extracts the JS line comment as its own `comment` child, which
 * FLUSHES the preceding text run. The `on mount { ... }` line then becomes a
 * STANDALONE text block whose leading token is `on` — a contextual IDENT, not a
 * decl keyword — so it matched NONE of the default-logic lift gates
 * (BARE_DECL_RE / TOPLEVEL_STATE_DECL_RE / TILDE / @-write) and fell through to
 * `result.push(block)`, shipping `on mount { @a = f() }` RAW into the DOM.
 *
 * Fix (ast-builder.js TOPLEVEL_ON_LIFECYCLE_RE lift gate): a text block at a
 * <program>/<page>/<channel> default-logic-body position whose leading token is
 * `on mount {` / `on dismount {` is lifted into a synthetic `${...}` logic
 * block so the logic-body parser desugars it (§6.7.1a / §6.7.1b). A blank line
 * (no `comment` flush) already worked via the shared-block lift — the control.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileHtml(source) {
  const bsResult = splitBlocks("/test/app.scrml", source);
  const tabResult = buildAST(bsResult);
  const htmlErrors = [];
  const html = generateHtml(tabResult.ast.nodes, htmlErrors, false, null, tabResult.ast);
  return { html, errors: htmlErrors, ast: tabResult.ast };
}

function compileClientJs(source, testName) {
  const tag = testName ?? `giti029-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_giti029_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// The canonical reproducer (verbatim from the brief).
const REPRO = `<program>
\${ function f() { return 1 } }
<a> = 0
// this comment defeats the on-mount on the next line
on mount { @a = f() }
<div><p>\${@a}</p></div>
</program>`;

// Control: same shape, blank line instead of the comment — always worked.
const CONTROL = `<program>
\${ function f() { return 1 } }
<a> = 0

on mount { @a = f() }
<div><p>\${@a}</p></div>
</program>`;

describe("GITI-029 — comment before on-mount must not defeat the directive", () => {
  test("HTML body does NOT contain the literal `on mount {` text", () => {
    const { html } = compileHtml(REPRO);
    expect(html).not.toContain("on mount {");
    // The only logic slot in the body is the `${@a}` interpolation inside <p>.
    expect(html).toMatch(/<div><p><span data-scrml-logic="_scrml_logic_\d+"><\/span><\/p><\/div>/);
  });

  test("the on-mount desugars to a bare-expr node (directive recognised)", () => {
    const { ast } = compileHtml(REPRO);
    // Walk for a bare-expr node whose body assigns @a = f().
    const found = [];
    function walk(list) {
      for (const n of (list || [])) {
        if (!n) continue;
        if (n.kind === "bare-expr") {
          const txt = n.expr ?? (n.exprNode ? JSON.stringify(n.exprNode) : "");
          found.push(txt);
        }
        if (Array.isArray(n.children)) walk(n.children);
        if (Array.isArray(n.body)) walk(n.body);
        if (Array.isArray(n.nodes)) walk(n.nodes);
      }
    }
    walk(ast.nodes);
    // At least one bare-expr is the desugared on-mount assignment.
    // The on-mount body `@a = f()` desugars to a bare-expr (token spacing varies).
    expect(found.some((t) => /@?a\s*=\s*f\s*\(\s*\)/.test(t) || /"f"/.test(t))).toBe(true);
  });

  test("client.js runs the mount assignment (NOT literal text)", () => {
    const { clientJs } = compileClientJs(REPRO, "comment-before-onmount");
    expect(clientJs).toBeTruthy();
    // f() is called and its result is written into cell `a` at mount.
    expect(clientJs).toMatch(/_scrml_f_\d+\(\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("a",\s*_scrml_f_\d+\(\)\)/);
    // The literal directive source never leaks into client.js as a string either.
    expect(clientJs).not.toContain("on mount {");
  });

  test("control (blank line instead of comment) behaves identically", () => {
    const { html: reproHtml } = compileHtml(REPRO);
    const { html: ctrlHtml } = compileHtml(CONTROL);
    // Both must be free of the literal directive text.
    expect(ctrlHtml).not.toContain("on mount {");
    expect(reproHtml).not.toContain("on mount {");
  });

  test("on dismount {} after a comment is also recognised (not literal text)", () => {
    const src = `<program>
<a> = 0
// comment before dismount
on dismount { cleanup(() => {}) }
<div><p>\${@a}</p></div>
</program>`;
    const { html } = compileHtml(src);
    expect(html).not.toContain("on dismount {");
  });
});
