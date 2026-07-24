/**
 * each-in-arrow-r25-bug-37.test.js — regression tests for R25-Bug-37.
 *
 * Bug 37 (R25 overseer-4): `<each in=@x.filter(c => c.foo == 1)>` silently
 * miscompiled — emitted JS read `_scrml_reactive_get("x").filter(c =;` with
 * the arrow body truncated and `;` from the next statement collapsed in.
 * Compile exited 0 (no error fired); `node --check` on the emitted JS
 * failed with `SyntaxError: Unexpected token ';'`.
 *
 * Root cause: `compiler/src/ast-builder.js` `_findEachOpenerEnd` tracked
 * only brace + quote depth — NOT paren or bracket depth. The `>` of the
 * inline arrow (`=>`) was at depth 0 (braces) so the finder returned its
 * index, slicing the opener at `<each in=@items.filter(c =` and discarding
 * the rest of the expression and the real opener `>`. Downstream
 * `_captureAttrValue` faithfully returned the truncated value, codegen
 * emitted `filter(c =`, and the `;` came from the next emitted statement
 * collapsing into the broken line.
 *
 * Block-splitter `scanAttributes` ALREADY correctly tracked paren+bracket
 * depth (Bug 40 added bracketDepth tracking; parenDepth predated it), so
 * BS produced `block.raw` with the full opener. The bug lived strictly in
 * ast-builder's opener-extraction.
 *
 * Fix (S138 R25-Bug-37, 2026-05-27):
 *   - ast-builder.js `_findEachOpenerEnd` (`<each>` only): add parenDepth
 *     and bracketDepth tracking; the opener `>` is recognized only when
 *     ALL of depth/parenDepth/bracketDepth are zero.
 *
 * Scope: narrow to `<each>` per brief. Same-shape bug exists in
 * `_findMatchOpenerEnd` (2 instances) + `_findOpenerEnd` (engine/machine);
 * filed as DEFERRED ITEMS, not fixed here. None of those structurally
 * accept the inline arrow shape in current adopter patterns; the engine
 * finder's brace tracking already handles `derived=match @x { .V1 => .V2 }`
 * (arrow inside braces).
 *
 * Coverage:
 *   §1  — minimal repro: inline `c => c.foo == 1` filter; emitted JS
 *         parses clean and preserves the full arrow body.
 *   §2  — multi-line / brace-bodied arrow: `c => { return c.foo > 0 }`
 *   §3  — chained filters: `.filter(c => c.foo == 1).map(c => c.bar)`
 *   §4  — `<each of=...>` count form with inline arrow:
 *         `<each of=@items.reduce((a, c) => a + 1, 0)>`
 *   §5  — bracketed access inside the iter expression:
 *         `<each in=@items[0].filter(c => c.x > 0)>`
 *   §6  — sibling-attribute regression-guard: braced-form `onclick=`
 *         continues to compile (it lives in a code-context, not the
 *         opener-end finder; controls for accidental scope creep).
 *   §7  — workaround form (`const <filtered> = @x.filter(...)`) still
 *         compiles cleanly (canonical hoist-to-derived-cell shape).
 *   §8  — composition with Bug 40 `:`-shorthand: `<each in=...arrow...>
 *         <li : @.foo></each>` — opener finder + BS shorthand recognition
 *         both fire correctly.
 *   §9  — `as name` alias + inline arrow: `<each in=@items.filter(c=>...) as item>`.
 *   §10 — silent-miscompile regression-guard: emitted JS MUST be
 *         node --check-parseable for the minimal repro.
 *   §11 — depth-aware opener finder: `>` inside parens is NOT a tag-close,
 *         `>` outside parens IS. Direct probe on `_findEachOpenerEnd`-driven
 *         opener handling via header introspection on AST.
 *   §12 — nested parens: `<each in=@items.filter(c => (c.a == 1 || c.b > 2))>`.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// compile helper — mirrors each-colon-shorthand-r25-bug-40.test.js pattern.
// ---------------------------------------------------------------------------

function compileToOutputs(source, suffix = "arrow") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""));
    const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      lintDiagnostics: result.lintDiagnostics ?? [],
      clientJs,
      html,
      clientPath,
      tmpDir,
    };
  } finally {
    // Note: we drop the tmpDir AFTER reading; consumers don't need the path
    // back beyond what we've already captured. The `tmpDir` field is
    // descriptive only — files are gone.
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — minimal repro
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §1 — minimal repro: inline arrow in <each in=...>", () => {
  test("`<each in=@items.filter(c => c.foo == 1)>` preserves full arrow body", () => {
    const src = `<program>
<items> = [{ foo: 1 }, { foo: 2 }, { foo: 1 }]

<each in=@items.filter(c => c.foo == 1)>
    <li>\${@.foo}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-min"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Pre-fix symptom: `filter(c =;` — arrow body truncated.
    expect(clientJs).not.toMatch(/filter\(c =;/);
    // Post-fix: full arrow body preserved.
    expect(clientJs).toMatch(/filter\(c => c\.foo == 1\)/);
  });
});

// ---------------------------------------------------------------------------
// §2 — multi-line / brace-bodied arrow
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §2 — brace-bodied arrow in <each in=...>", () => {
  test("`<each in=@items.filter(c => { return c.foo > 0 })>` survives", () => {
    const src = `<program>
<items> = [{ foo: 1 }, { foo: -1 }]

<each in=@items.filter(c => { return c.foo > 0 })>
    <li>\${@.foo}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-brace-body"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Full filter expression preserved including the brace body.
    expect(clientJs).toMatch(/filter\(c => \{ return c\.foo > 0 \}\)/);
  });
});

// ---------------------------------------------------------------------------
// §3 — chained filter+map with two inline arrows
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §3 — chained .filter(...).map(...) with two arrows", () => {
  test("`<each in=@items.filter(c => c.foo == 1).map(c => c.bar)>` survives", () => {
    const src = `<program>
<items> = [{ foo: 1, bar: "a" }, { foo: 2, bar: "b" }, { foo: 1, bar: "c" }]

<each in=@items.filter(c => c.foo == 1).map(c => c.bar)>
    <li>\${@.}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-chain"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Both arrow bodies preserved.
    expect(clientJs).toMatch(/\.filter\(c => c\.foo == 1\)\.map\(c => c\.bar\)/);
  });
});

// ---------------------------------------------------------------------------
// §4 — `<each of=N>` count form with inline arrow inside reduce
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §4 — count form (`<each of=...>`) with inline arrow", () => {
  test("`<each of=@items.reduce((a, c) => a + 1, 0)>` survives", () => {
    const src = `<program>
<items> = [{ foo: 1 }, { foo: 2 }, { foo: 1 }]

<each of=@items.reduce((a, c) => a + 1, 0)>
    <li>row \${@.}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-of-reduce"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Reduce arrow + final 0 both preserved.
    expect(clientJs).toMatch(/\.reduce\(\(a, c\) => a \+ 1, 0\)/);
  });
});

// ---------------------------------------------------------------------------
// §5 — bracketed access inside the iter expression (bracketDepth coverage)
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §5 — bracketed access + inline arrow in <each in=...>", () => {
  test("`<each in=@matrix[0].filter(c => c > 0)>` — bracket+paren both balance", () => {
    const src = `<program>
<matrix> = [[1, -1, 2], [3]]

<each in=@matrix[0].filter(c => c > 0)>
    <li>\${@.}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-bracket"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Full expression preserved.
    expect(clientJs).toMatch(/\[0\]\.filter\(c => c > 0\)/);
  });
});

// ---------------------------------------------------------------------------
// §6 — sibling-attribute regression-guard: braced-form attribute value
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §6 — braced attribute-value arrow (regression-guard)", () => {
  test("`<button onclick={() => @count = @count + 1}>` still compiles", () => {
    const src = `<program>
<count> = 0

<button onclick={() => @count = @count + 1}>
    bump
</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-onclick"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Click handler should be wired.
    expect(clientJs).toMatch(/addEventListener\("click"|onclick/);
  });
});

// ---------------------------------------------------------------------------
// §7 — workaround form (`const <filtered>` hoist-to-derived-cell)
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §7 — canonical hoist-to-derived-cell workaround", () => {
  test("`const <filtered> = @items.filter(...)` + `<each in=@filtered>` still works", () => {
    const src = `<program>
<items> = [{ foo: 1 }, { foo: 2 }, { foo: 1 }]
const <filtered> = @items.filter(c => c.foo == 1)

<each in=@filtered>
    <li>\${@.foo}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-hoist"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Derived cell uses the @items source. Note: the derived-cell pipeline
    // emits structural-eq (`_scrml_structural_eq(c.foo, 1)`) for `c.foo == 1`
    // — that's the lowering, not a truncation. The KEY assertion is that
    // the filter arrow is intact (`(c) => ...` form survives), proving the
    // workaround path is not regressed.
    expect(clientJs).toMatch(/filter\(\(c\) => _scrml_structural_eq\(c\.foo, 1\)\)/);
    // The `filtered` derived cell subscribes to `items`.
    expect(clientJs).toMatch(/_scrml_derived_subscribe\("filtered", "items"\)/);
  });
});

// ---------------------------------------------------------------------------
// §8 — composition with Bug 40 `:`-shorthand
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §8 — composition with Bug 40 `:`-shorthand body", () => {
  test("`<each in=@items.filter(c => c.foo == 1)><li : @.foo></each>` composes", () => {
    const src = `<program>
<items> = [{ foo: 1 }, { foo: 2 }, { foo: 1 }]

<each in=@items.filter(c => c.foo == 1)>
    <li : @.foo>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-shorthand"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Bug 37: filter arrow preserved.
    expect(clientJs).toMatch(/filter\(c => c\.foo == 1\)/);
    // Bug 40: `:`-shorthand body wired via textContent.
    expect(clientJs).toMatch(/\.textContent = String\(_scrml_each_item\.foo\)/);
  });
});

// ---------------------------------------------------------------------------
// §9 — `as name` alias + inline arrow
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §9 — `as name` alias with inline arrow in iter expression", () => {
  test("`<each in=@items.filter(c => c.foo == 1) as item>` survives + binds alias", () => {
    const src = `<program>
<items> = [{ foo: 1, bar: "a" }, { foo: 2, bar: "b" }]

<each in=@items.filter(c => c.foo == 1) as item>
    <li>\${item.bar}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-as"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Filter expression preserved.
    expect(clientJs).toMatch(/filter\(c => c\.foo == 1\)/);
    // `as item` alias declared as the iter-var name in the factory.
    expect(clientJs).toMatch(/\(item, _scrml_each_idx\) =>/);
  });
});

// ---------------------------------------------------------------------------
// §10 — node --check parseability regression-guard
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §10 — emitted JS parses cleanly under node --check", () => {
  test("minimal repro emitted client.js parses without SyntaxError", () => {
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const name = `bug37-nodecheck-${uniq}`;
    const tmpDir = resolve("/tmp", `scrml-${name}`);
    const tmpInput = resolve(tmpDir, `${name}.scrml`);
    const outDir = resolve(tmpDir, "out");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpInput, `<program>
<items> = [{ foo: 1 }, { foo: 2 }, { foo: 1 }]

<each in=@items.filter(c => c.foo == 1)>
    <li>\${@.foo}</li>
</each>
</program>`);
    try {
      const result = compileScrml({
        inputFiles: [tmpInput],
        write: true,
        outputDir: outDir,
      });
      expect(result.errors ?? []).toEqual([]);
      const clientPath = resolve(outDir, `${name}.client.js`);
      expect(existsSync(clientPath)).toBe(true);
      // node --check should succeed.
      let parsed = false;
      try {
        execFileSync("node", ["--check", clientPath], { stdio: "pipe" });
        parsed = true;
      } catch (e) {
        // Surface node's stderr for diagnostic clarity on failure.
        const stderr = e.stderr ? e.stderr.toString() : "";
        throw new Error(`node --check failed for ${clientPath}:\n${stderr}`);
      }
      expect(parsed).toBe(true);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §11 — captured opener header includes the full inline-arrow expression
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §11 — captured `in=` value includes the full arrow body", () => {
  test("W-EACH-KEY-001 lint message reports the FULL opener (not truncated)", () => {
    const src = `<program>
<items> = [{ foo: 1 }, { foo: 2 }]

<each in=@items.filter(c => c.foo == 1)>
    <li>\${@.foo}</li>
</each>
</program>`;
    const { lintDiagnostics } = compileToOutputs(src, "bug37-lint-msg");
    // W-EACH-KEY-001 fires (no .id field on items). Its message embeds the
    // attribute value as the compiler saw it — if the finder truncates, the
    // lint message itself shows the truncation. This is the original
    // diagnostic signal: pre-fix the message read `<each in=@items.filter(c =>`
    // (truncated to the `>` of `=>`); post-fix it reads the full opener.
    const keyLint = lintDiagnostics.find((d) => d.code === "W-EACH-KEY-001");
    expect(keyLint).toBeDefined();
    // Truncation symptom — must NOT appear.
    expect(keyLint.message).not.toMatch(/filter\(c =>$/);
    expect(keyLint.message).not.toMatch(/filter\(c =>\)`/);
    // Full opener present.
    expect(keyLint.message).toMatch(/filter\(c => c\.foo == 1\)/);
  });
});

// ---------------------------------------------------------------------------
// §12 — nested parens
// ---------------------------------------------------------------------------

describe("R25-Bug-37 §12 — nested parens inside the arrow body", () => {
  test("`<each in=@items.filter(c => (c.a == 1 || c.b > 2))>` survives", () => {
    const src = `<program>
<items> = [{ a: 1, b: 0 }, { a: 0, b: 5 }, { a: 0, b: 1 }]

<each in=@items.filter(c => (c.a == 1 || c.b > 2))>
    <li>\${@.a},\${@.b}</li>
</each>
</program>`;
    const { errors, clientJs: __cjRaw } = compileToOutputs(src, "bug37-nested"); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Full expression with nested parens preserved.
    expect(clientJs).toMatch(/filter\(c => \(c\.a == 1 \|\| c\.b > 2\)\)/);
  });
});
