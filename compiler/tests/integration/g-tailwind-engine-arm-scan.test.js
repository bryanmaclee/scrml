/**
 * S312 regression (g-tailwind-class-scan-skips-engine-non-initial-arms) — the
 * Tailwind utility-class scanner descends into EVERY `<engine>` state-child
 * body, not just the INITIAL one.
 *
 * Pre-fix: the `engine-decl` branch of `collectClassNamesFromAst` / `visitNode`
 * (codegen/collect-class-names.ts) walked `arms[].body` / `arms[].children` /
 * `node.children` / `node.body` — none of which the A10 (S78) engine-decl node
 * populates. The walkable per-state markup lives in `bodyChildren`. So the AST
 * collector reached NONE of the state-children. Only the INITIAL state emitted
 * its classes, and ONLY because emit-engine materializes the initial state into
 * the static HTML at module init (PRIMER §7), which the separate HTML scan
 * picks up. Every NON-INITIAL state-child body — and anything nested beneath
 * one — got no CSS rule: silent unstyled render, green compile, no warning.
 *
 * Post-fix: the `engine-decl` branch walks `bodyChildren` (the same canonical
 * walkable field the `match-block` / `each-block` branches consume). Nesting
 * (`<each>` / `<match>` inside a non-initial state) falls out via uniform
 * `walk` recursion.
 *
 * This is the residual of g-tailwind-class-scan-skips-markup-block-bodies
 * (RESOLVED S212, a648b34b) — engine is the "third block-form" that fix's
 * closing note wrongly assumed already handled.
 *
 * Per SPEC §26.1: "the compiler scans the source for class names and emits a
 * CSS rule for each Tailwind utility class it finds." Markup position is
 * irrelevant to that rule.
 *
 * These are VALUE assertions on the emitted CSS text — not "it compiled".
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "g-tw-engine-arm-scan-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  let css = "";
  try {
    css = readFileSync(join(outDir, `${name}.css`), "utf8");
  } catch {
    // file missing — leave css empty so assertions surface a clear failure
  }
  return { errors, css };
}

describe("S312: Tailwind scanner descends into non-initial <engine> state bodies", () => {
  test("classes in non-initial engine state bodies emit CSS rules", () => {
    const src = `<program>
\${ type P:enum = { A, B, C } }
<engine for=P initial=.A>
    <A rule=.B><div class="rounded-full">initial</></>
    <B rule=.C><div class="rounded-xl">non-initial-B</></>
    <C rule=.A><div class="rounded-3xl">non-initial-C</></>
</engine>
<div class="gap-2">outside</div>
</program>
`;
    const { errors, css } = compileSource("engine-arms", src);
    expect(errors).toEqual([]);

    // Control OUTSIDE the engine — worked pre-fix.
    expect(css).toMatch(/\.gap-2\s*\{/);
    // INITIAL state body — worked pre-fix (via static-HTML scan).
    expect(css).toMatch(/\.rounded-full\s*\{/);
    // NON-INITIAL state bodies — the S312 fix. MISSING pre-fix.
    expect(css).toMatch(/\.rounded-xl\s*\{/);
    expect(css).toMatch(/\.rounded-3xl\s*\{/);
  });

  test("nested <each> inside a non-initial engine state — its class emits CSS", () => {
    const src = `<program>
\${
  type P:enum = { A, B }
  <items>: string[] = []
}
<engine for=P initial=.A>
    <A rule=.B><div class="rounded-full">initial</></>
    <B rule=.A>
      <each in=@items as it>
        <span class="text-sky-500">\${it}</span>
      </each>
    </>
</engine>
<div class="gap-2">outside</div>
</program>
`;
    const { errors, css } = compileSource("engine-nested-each", src);
    expect(errors).toEqual([]);

    expect(css).toMatch(/\.gap-2\s*\{/);
    expect(css).toMatch(/\.rounded-full\s*\{/);
    // text-sky-500 is inside an <each> body, itself inside a non-initial state.
    expect(css).toMatch(/\.text-sky-500\s*\{/);
  });
});

describe("S312: regression guards — pre-fix working paths unchanged", () => {
  test("engine-free file with a spurious engine-only class emits no rule for it", () => {
    const src = `<div class="p-4">
  <span class="text-sm">plain</span>
</div>
`;
    const { errors, css } = compileSource("no-engine", src);
    expect(errors).toEqual([]);
    expect(css).toMatch(/\.p-4\s*\{/);
    expect(css).toMatch(/\.text-sm\s*\{/);
    // These engine-only classes appear NOWHERE in this source.
    expect(css).not.toMatch(/\.rounded-3xl\s*\{/);
    expect(css).not.toMatch(/\.text-sky-500\s*\{/);
  });
});
