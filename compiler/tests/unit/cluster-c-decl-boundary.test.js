/**
 * Cluster-C — `${}`-decl-boundary mis-split regression tests (S190)
 *
 * Two coupled parser/diagnostic bugs in the block-splitter / ast-builder
 * decl-boundary handling inside `${...}` logic blocks. Same FAMILY
 * (decl-boundary mis-handling at `${`), distinct mechanisms.
 *
 * Bug 1 — g-derived-rhs-interp-wrapped (E-DECL-RHS-INTERP-WRAPPED):
 *   A derived/state-cell decl whose RHS is wrapped in a `${...}` logic block
 *   (`const <bad> = ${ @x }`) is non-canonical. SPEC §6.2: all three RHS
 *   shapes are BARE expressions. Pre-fix the wrapped RHS collapsed to a bare
 *   `$` identifier → a misleading `E-SCOPE-001: Undeclared identifier $`
 *   cascade. RULING (S190): REJECT with the new E-DECL-RHS-INTERP-WRAPPED
 *   diagnostic (naming the cause + the bare-form fix); recover by unwrapping
 *   (no spurious E-SCOPE-001). Fires for derived / plain / typed structural
 *   decls; a plain bare-expr RHS stays clean.
 *
 * Bug 2 — g-markup-const-consumes-cell-decl:
 *   A markup component-def (`const G = <div>...</div>`) inside a `${...}` block
 *   over-consumed every FOLLOWING sibling decl: cells/deriveds silently lost
 *   their initializer (the cell defaulted to canonical-empty), Shape-2
 *   bindables rendered as the literal unexpanded tag, and functions hit
 *   E-SCOPE-001 (the name never registered). The const-then-cell ordering must
 *   register the cell WITH its init value. cell-first + bare-top-level
 *   orderings stayed clean. RULING (S190): fix the parse — this is VALID scrml
 *   (SPEC §6 / §38.1 show `${ <username> = "" }`).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAST(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut).ast;
}

/** Flatten all AST nodes (depth-first across children/body) for inspection. */
function allNodes(root) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    out.push(n);
    for (const key of ["nodes", "children", "body", "defChildren"]) {
      if (Array.isArray(n[key])) for (const c of n[key]) visit(c);
    }
  };
  visit(root);
  return out;
}

function findDecl(ast, kind, name) {
  return allNodes(ast).find((n) => n.kind === kind && n.name === name);
}

/** Compile a single inline source to a temp dir; return { errors, warnings, clientJs, html }. */
function compileInline(source) {
  const TMP = mkdtempSync(join(tmpdir(), "cluster-c-"));
  try {
    const inPath = join(TMP, "t.scrml");
    writeFileSync(inPath, source);
    const outDir = join(TMP, "out");
    const result = compileScrml({
      inputFiles: [inPath],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    const clientPath = join(outDir, "t.client.js");
    const htmlPath = join(outDir, "t.html");
    return {
      errors: result.errors || [],
      warnings: result.warnings || [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

/** Cross-stream code lookup — a code can land in errors OR warnings (W-/I- partition). */
function hasCode(result, code) {
  return (
    (result.errors || []).some((e) => e.code === code) ||
    (result.warnings || []).some((w) => w.code === code)
  );
}

// ===========================================================================
// Bug 1 — E-DECL-RHS-INTERP-WRAPPED
// ===========================================================================

describe("Cluster-C Bug 1 — `${}`-wrapped decl RHS (E-DECL-RHS-INTERP-WRAPPED)", () => {
  test("derived `const <x> = ${ ... }` fires the new code, NOT E-SCOPE-001 $", () => {
    const src = `<page>
\${
  <names> = ["a", "bb", "ccc"]
  const <bad> = \${ @names.filter(n => n.length > 1) }
}
<p>\${@bad.length}</p>
</page>`;
    const r = compileInline(src);
    expect(hasCode(r, "E-DECL-RHS-INTERP-WRAPPED")).toBe(true);
    // The misleading orphan-`$` cascade is suppressed.
    const scopeDollar = (r.errors || []).find(
      (e) => e.code === "E-SCOPE-001" && /Undeclared identifier `\$`/.test(e.message || ""),
    );
    expect(scopeDollar).toBeUndefined();
  });

  test("plain state `<x> = ${ ... }` fires the new code", () => {
    const src = `<page>
\${
  <names> = ["a","bb","ccc"]
  <bad> = \${ @names.length }
}
<p>\${@bad}</p>
</page>`;
    const r = compileInline(src);
    expect(hasCode(r, "E-DECL-RHS-INTERP-WRAPPED")).toBe(true);
  });

  test("typed const `const <x>: T = ${ ... }` fires the new code", () => {
    const src = `<page>
\${
  <count> = 5
  const <bad>: number = \${ @count * 2 }
}
<p>\${@bad}</p>
</page>`;
    const r = compileInline(src);
    expect(hasCode(r, "E-DECL-RHS-INTERP-WRAPPED")).toBe(true);
  });

  test("the diagnostic message names the cause and the bare-form fix", () => {
    const src = `<page>
\${
  <names> = ["a", "bb", "ccc"]
  const <bad> = \${ @names.filter(n => n.length > 1) }
}
<p>\${@bad.length}</p>
</page>`;
    const r = compileInline(src);
    const e = (r.errors || []).find((x) => x.code === "E-DECL-RHS-INTERP-WRAPPED");
    expect(e).toBeDefined();
    expect(e.message).toContain("BARE expression");
    expect(e.message).toContain("Remove the wrapper");
    expect(e.message).toContain("const <bad> = @names.filter(n => n.length > 1)");
  });

  test("CONTROL: bare-expr RHS (no `${}` wrapper) does NOT fire — stays clean", () => {
    const src = `<page>
\${
  <names> = ["a", "bb", "ccc"]
  const <bad> = @names.filter(n => n.length > 1)
}
<p>\${@bad.length}</p>
</page>`;
    const r = compileInline(src);
    expect(hasCode(r, "E-DECL-RHS-INTERP-WRAPPED")).toBe(false);
    expect((r.errors || []).map((e) => e.code)).not.toContain("E-SCOPE-001");
  });

  test("the `${}` interpolation INSIDE a markup-typed derived RHS does NOT false-fire", () => {
    // The `${@x}` is interpolation inside the markup value, not a decl-RHS wrapper.
    const src = `<page>
\${
  <userName> = "Bob"
  const <badge> = <span class="badge">\${@userName}</span>
}
<p>\${@badge}</p>
</page>`;
    const r = compileInline(src);
    expect(hasCode(r, "E-DECL-RHS-INTERP-WRAPPED")).toBe(false);
  });
});

// ===========================================================================
// Bug 2 — markup const consumes following sibling decl
// ===========================================================================

describe("Cluster-C Bug 2 — markup const over-consuming siblings", () => {
  test("AST: const-then-cell — markup const raw stops at `</div>`; cell is its own state-decl with init", () => {
    const src = `<page>
\${
  const G = <div class="x">hi</div>
  <name> = "Ada"
}
<p>\${@name}</p>
</page>`;
    const ast = parseAST(src);
    const g = findDecl(ast, "component-def", "G");
    expect(g).toBeDefined();
    expect(g.raw).not.toContain("name");
    expect(g.raw).not.toContain("Ada");
    const name = findDecl(ast, "state-decl", "name");
    expect(name).toBeDefined();
    expect(name.init).toContain("Ada");
  });

  test("const-then-cell registers the cell WITH its init value (Ada present in emitted JS)", () => {
    const src = `<page>
\${
  const G = <div class="x">hi</div>
  <name> = "Ada"
}
<p>\${@name}</p>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("multi-cell — const then `<a>=1 <b>=2 <c>=3` all register with init", () => {
    const src = `<page>
\${
  const G = <div>hi</div>
  <a> = 1
  <b> = 2
  <c> = 3
}
<p>\${@a} \${@b} \${@c}</p>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("a", 1)');
    expect(r.clientJs).toContain('_scrml_reactive_set("b", 2)');
    expect(r.clientJs).toContain('_scrml_reactive_set("c", 3)');
  });

  test("const-then-cell-then-derived — count=5 + doubled both wired", () => {
    const src = `<page>
\${
  const G = <div class="x">hi</div>
  <count> = 5
  const <doubled> = @count * 2
}
<p>\${@doubled}</p>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("count", 5)');
    expect(r.clientJs).toContain('_scrml_derived_declare("doubled"');
  });

  test("const-then-fn — the function resolves (no E-SCOPE-001 on the name)", () => {
    const src = `<page>
\${
  const G = <div class="x">hi</div>
  fn label() -> string { return "z" }
  <name> = "Ada"
}
<p>\${@name} \${label()}</p>
</page>`;
    const r = compileInline(src);
    expect((r.errors || []).map((e) => e.code)).not.toContain("E-SCOPE-001");
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("const-then-Shape-2-bindable — `<userName/>` EXPANDS (not the literal tag)", () => {
    const src = `<page>
\${
  const G = <div class="x">hi</div>
  <userName req> = <input type="text"/>
}
<userName/>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    // The render-by-tag expands to a real <input>; the literal <userName tag is gone.
    expect(r.html).toContain("<input");
    expect(r.html).not.toContain("<userName");
  });

  test("two markup consts then a cell — all three register", () => {
    const src = `<page>
\${
  const A = <div class="a">aa</div>
  const B = <div class="b">bb</div>
  <name> = "Ada"
}
<p>\${@name}</p>\${@A}\${@B}
</page>`;
    const ast = parseAST(src);
    expect(findDecl(ast, "component-def", "A")).toBeDefined();
    expect(findDecl(ast, "component-def", "B")).toBeDefined();
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("SELF-CLOSING markup const `const G = <br/>` then cell — cell sets", () => {
    const src = `<page>
\${
  const G = <br/>
  <name> = "Ada"
}
<p>\${@name}</p>
</page>`;
    const ast = parseAST(src);
    const g = findDecl(ast, "component-def", "G");
    expect(g).toBeDefined();
    expect(g.raw).not.toContain("name");
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("nested-interp markup const — cells before AND after both wired", () => {
    const src = `<page>
\${
  <userName> = "Bob"
  const G = <div class="x">hello \${@userName}!</div>
  <name> = "Ada"
}
<p>\${@name} \${@userName}</p>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
    expect(r.clientJs).toContain('_scrml_reactive_set("userName", "Bob")');
  });

  test("inner void `<br>` inside the markup const root does NOT prematurely close", () => {
    const src = `<page>
\${
  const G = <p>hi<br>more</p>
  <name> = "Ada"
}
<p>\${@name}</p>
</page>`;
    const ast = parseAST(src);
    const g = findDecl(ast, "component-def", "G");
    expect(g).toBeDefined();
    // The whole <p>...</p> root (with inner <br>) is captured; the cell splits off.
    expect(g.raw).toContain("more");
    expect(g.raw).not.toContain("name");
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("CONTROL: cell-FIRST ordering stays clean — Ada present", () => {
    const src = `<page>
\${
  <name> = "Ada"
  const G = <div class="x">hi</div>
}
<p>\${@name}</p>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("CONTROL: bare top-level (no `${}`) ordering stays clean — Ada present", () => {
    const src = `<page>
<name> = "Ada"
const G = <div class="x">hi</div>
<p>\${@name}</p>
</page>`;
    const r = compileInline(src);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toContain('_scrml_reactive_set("name", "Ada")');
  });

  test("CONTROL: multi-line single-root component body (nested </> closers) still registers as ONE component-def", () => {
    const src = `<program>
\${
    const Card = <div class="card">
        <div class="card__header">
            Header text
        </>
        <div class="card__body">
            Body text
        </>
    </>
}
<Card/>
</program>`;
    const ast = parseAST(src);
    const cards = allNodes(ast).filter((n) => n.kind === "component-def" && n.name === "Card");
    // Exactly one Card component-def whose raw spans the full multi-line body.
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0].raw).toContain("card__header");
    expect(cards[0].raw).toContain("card__body");
  });
});
