/**
 * fix-bare-decl-markup-text-lift — regression tests for Scope C finding A5
 *
 * Bug: liftBareDeclarations() in ast-builder.js recursed into <markup> block
 * children. Any text block whose leading word matched BARE_DECL_RE (server fn |
 * server function | fn | function | type) was promoted to a synthetic logic
 * block, even when it was prose inside a <p>, <div>, etc.
 *
 * Two failure modes from one root cause:
 *   1. Long-form prose: `<p>function adds a request.</p>` produced a phantom
 *      E-SCOPE-001 ("undeclared identifier `a`") because the lifted text was
 *      parsed as a function declaration with name `adds` and bogus params.
 *   2. Short-form prose: `<p>function adds.</p>` compiled clean but the
 *      paragraph text was missing from the rendered HTML — the lifted text
 *      parsed as a zero-statement function decl `adds` and emitted as a
 *      logic-marker <span> rather than the original paragraph content.
 *
 * Fix (Option 1 from intake): drop the markup-children recursion entirely.
 * Markup children are passed through unchanged. Bare declarations inside
 * markup must be wrapped in `${ ... }` per spec convention.
 *
 * State-context recursion is preserved (server fns inside <db> still lift).
 *
 * Intake: scrml-support/archive/changes/fix-bare-decl-markup-text-lift/intake.md
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a scrml source string through the full pipeline (BS→...→CG) using
 * the public compileScrml API and return { errors, html, clientJs }.
 *
 * Drives full-pipeline regression checks for HTML preservation (mode 2).
 */
function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bare-decl-leak-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bare_decl_leak_${tag}`);
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

/**
 * Compile through BS→TAB only and return { ast, errors }. Used for the
 * sanity test (top-level bare decl still lifts) where AST shape is the
 * relevant signal.
 */
function compileTab(source) {
  const bs = splitBlocks("test.scrml", source);
  const tab = buildAST(bs);
  return { ast: tab.ast, errors: [...bs.errors, ...tab.errors] };
}

/**
 * Recursively collect all nodes of a given kind in the AST.
 */
function collectNodes(nodes, kind) {
  const found = [];
  function walk(nodeList) {
    for (const node of nodeList) {
      if (!node) continue;
      if (node.kind === kind) found.push(node);
      if (node.kind === "logic") walk(node.body || []);
      if (node.kind === "markup" || node.kind === "state") walk(node.children || []);
    }
  }
  walk(nodes);
  return found;
}

/** Filter compiler errors to error-severity only (excludes warnings). */
function onlyErrors(errors) {
  return errors.filter(e => e.severity === undefined || e.severity === "error");
}

// ---------------------------------------------------------------------------
// §1: phantom-error mode — long prose with `function adds a request.`
// ---------------------------------------------------------------------------

describe("§1: bare-decl keyword inside <p> long prose does NOT trigger phantom errors", () => {
  test("`<p>function adds a request.</p>` compiles clean and preserves the text in HTML", () => {
    const src = `<program>
\${ @x = 0 }
<p>function adds a request.</p>
</program>`;
    const { errors, html } = compileSource(src, "phantom-function-long");

    // Must NOT produce E-SCOPE-001 (the phantom "undeclared identifier `a`")
    const scopeErr = errors.find(e => e.code === "E-SCOPE-001");
    expect(scopeErr).toBeUndefined();

    // Must compile clean overall
    expect(onlyErrors(errors)).toHaveLength(0);

    // Paragraph text must survive into the rendered HTML
    expect(html).toBeTruthy();
    expect(html).toContain("function adds a request.");
  });
});

// ---------------------------------------------------------------------------
// §2: silent-corruption mode — short prose with `function adds.`
// ---------------------------------------------------------------------------

describe("§2: bare-decl keyword inside <p> short prose does NOT silently drop text", () => {
  test("`<p>function adds.</p>` compiles clean and HTML preserves the prose", () => {
    const src = `<program>
\${ @x = 0 }
<p>function adds.</p>
</program>`;
    const { errors, html } = compileSource(src, "silent-corruption-function");

    expect(onlyErrors(errors)).toHaveLength(0);
    expect(html).toBeTruthy();
    // The dangerous mode: previously the text vanished and was replaced with
    // a `<span data-scrml-logic="...">` marker.
    expect(html).toContain("function adds.");
  });
});

// ---------------------------------------------------------------------------
// §3: same leak triggers on the `fn` keyword
// ---------------------------------------------------------------------------

describe("§3: `fn` keyword inside <p> prose does NOT lift", () => {
  test("`<p>fn adds a request.</p>` compiles clean and HTML preserves the prose", () => {
    const src = `<program>
\${ @x = 0 }
<p>fn adds a request.</p>
</program>`;
    const { errors, html } = compileSource(src, "fn-prose-leak");

    expect(onlyErrors(errors)).toHaveLength(0);
    expect(html).toBeTruthy();
    expect(html).toContain("fn adds a request.");
  });
});

// ---------------------------------------------------------------------------
// §4: same leak triggers on the `type` keyword
// ---------------------------------------------------------------------------

describe("§4: `type` keyword inside <p> prose does NOT lift", () => {
  test("`<p>type X is a thing.</p>` compiles clean and HTML preserves the prose", () => {
    const src = `<program>
\${ @x = 0 }
<p>type X is a thing.</p>
</program>`;
    const { errors, html } = compileSource(src, "type-prose-leak");

    expect(onlyErrors(errors)).toHaveLength(0);
    expect(html).toBeTruthy();
    expect(html).toContain("type X is a thing.");
  });
});

// ---------------------------------------------------------------------------
// §5: same leak triggers on the `server function` keyword pair
// ---------------------------------------------------------------------------

describe("§5: `server function` inside <p> prose does NOT lift", () => {
  test("`<p>server function f returns nothing.</p>` compiles clean and HTML preserves the prose", () => {
    const src = `<program>
\${ @x = 0 }
<p>server function f returns nothing.</p>
</program>`;
    const { errors, html } = compileSource(src, "server-function-prose-leak");

    expect(onlyErrors(errors)).toHaveLength(0);
    expect(html).toBeTruthy();
    expect(html).toContain("server function f returns nothing.");
  });
});

// ---------------------------------------------------------------------------
// §6: sanity — top-level bare-decl lift still works (regression for fix)
// ---------------------------------------------------------------------------

describe("§6: top-level bare declarations still auto-lift after the fix", () => {
  test("bare `function foo(x) { ... }` at file top level still produces a function-decl node", () => {
    const source = `<program>
function foo(x) { return x + 1 }
<p>top</p>
</program>`;
    const { ast, errors } = compileTab(source);

    // No parse errors — the bare decl must still be lifted to ${...}
    const parseErr = errors.find(e => e.code === "E-PARSE-002");
    expect(parseErr).toBeUndefined();

    // The function-decl node must exist with name `foo`
    const fnDecls = collectNodes(ast.nodes, "function-decl");
    const foo = fnDecls.find(f => f.name === "foo");
    expect(foo).toBeDefined();
  });
});
