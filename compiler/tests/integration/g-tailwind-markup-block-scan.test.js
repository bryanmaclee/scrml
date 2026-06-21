/**
 * S212 regression — the Tailwind utility-class scanner descends into the
 * MARKUP block-form `<match>` / `<each>` bodies.
 *
 * Pre-fix: `collectClassNamesFromAst` / `visitNode` (codegen/collect-class-
 * names.ts) handled the `${...}`-LOGIC control-flow forms (for-stmt / if-stmt
 * / match-stmt / match-expr / etc.) and engine-decl arms, but had NO branch
 * for the MARKUP block-form node kinds `match-block` / `each-block`. Their
 * walkable arm-/item-body markup lives in `bodyChildren` (+ `armBodyChildren`
 * for match), NOT `children` / `body`, so the generic fallback never reached
 * them. A utility class used ONLY inside a `<match>` arm or `<each>` body got
 * no CSS rule emitted — silent unstyled render, green compile, no warning.
 *
 * Post-fix: `visitNode` gains additive `match-block` + `each-block` branches
 * (mirroring the engine-decl branch) that walk `bodyChildren` (+ match
 * `armBodyChildren`). Nesting falls out via uniform `walk` recursion; CE-
 * expanded component slots are already flattened into the arm/item markup
 * before this collector runs.
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
  TMP = mkdtempSync(join(tmpdir(), "g-tw-block-scan-"));
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

describe("S212: Tailwind scanner descends into <match> block-form arm bodies", () => {
  test("classes inside <match> arm bodies emit CSS rules", () => {
    const src = `<div>
  \${
    type Phase:enum = { Idle, Ready }
    <phase>: Phase = .Idle
  }
  <div class="gap-2">
    <match for=Phase on=@phase>
      <Idle>
        <p class="rounded-full">load</p>
      </>
      <Ready>
        <p class="rounded-lg cursor-pointer ml-6">ready content</p>
      </>
    </match>
  </div>
</div>
`;
    const { errors, css } = compileSource("match-arms", src);
    expect(errors).toEqual([]);

    // Baseline class OUTSIDE the block-form — worked pre-fix.
    expect(css).toMatch(/\.gap-2\s*\{/);

    // Inside the <match> arm bodies — the S212 fix. All MISSING pre-fix.
    expect(css).toMatch(/\.rounded-full\s*\{/);
    expect(css).toMatch(/\.rounded-lg\s*\{/);
    expect(css).toMatch(/\.cursor-pointer\s*\{/);
    expect(css).toMatch(/\.ml-6\s*\{/);
  });
});

describe("S212: Tailwind scanner descends into <each> block-form bodies", () => {
  test("classes inside an <each> per-item body emit CSS rules", () => {
    const src = `<div>
  \${ <items>: string[] = [] }
  <div class="gap-2">
    <each in=@items as it>
      <p class="rounded-xl text-sky-500">\${it}</p>
    </each>
  </div>
</div>
`;
    const { errors, css } = compileSource("each-body", src);
    expect(errors).toEqual([]);

    expect(css).toMatch(/\.gap-2\s*\{/);
    // Inside the <each> per-item body — the S212 fix. MISSING pre-fix.
    expect(css).toMatch(/\.rounded-xl\s*\{/);
    expect(css).toMatch(/\.text-sky-500\s*\{/);
  });
});

describe("S212: nesting + component slots fall out of uniform recursion", () => {
  test("nested <match> inside an <each> body — inner-arm class emits CSS", () => {
    const src = `<div>
  \${
    type Phase:enum = { Idle, Ready }
    <phase>: Phase = .Idle
    <items>: string[] = []
  }
  <div class="gap-2">
    <each in=@items as it>
      <match for=Phase on=@phase>
        <Idle>
          <p class="tracking-wide">\${it}</p>
        </>
        <Ready>
          <p class="ml-6">ready</p>
        </>
      </match>
    </each>
  </div>
</div>
`;
    const { errors, css } = compileSource("nested", src);
    expect(errors).toEqual([]);

    expect(css).toMatch(/\.gap-2\s*\{/);
    // tracking-wide is in the INNER <match> arm, itself inside an <each> body.
    expect(css).toMatch(/\.tracking-wide\s*\{/);
    expect(css).toMatch(/\.ml-6\s*\{/);
  });

  test("component slot used inside a <match> arm — its classes emit CSS", () => {
    // Components expand inline via CE before the class collector runs, so the
    // <Badge/> slot's classes are flattened into the arm-body markup.
    const src = `component Badge {
  <span class="px-2 tracking-widest">badge</span>
}
<div>
  \${
    type Phase:enum = { Idle, Ready }
    <phase>: Phase = .Idle
  }
  <div class="gap-2">
    <match for=Phase on=@phase>
      <Idle>
        <Badge/>
      </>
      <Ready>
        <p class="ml-8">ok</p>
      </>
    </match>
  </div>
</div>
`;
    const { errors, css } = compileSource("component-slot", src);
    expect(errors).toEqual([]);

    expect(css).toMatch(/\.gap-2\s*\{/);
    expect(css).toMatch(/\.px-2\s*\{/);
    expect(css).toMatch(/\.tracking-widest\s*\{/);
    expect(css).toMatch(/\.ml-8\s*\{/);
  });
});

describe("S212: regression guards — pre-fix working paths unchanged", () => {
  test("top-level static markup class still emits CSS (no regression)", () => {
    const src = `<div class="flex items-center gap-2 p-4">
  <span class="font-bold">Hello</span>
</div>
`;
    const { errors, css } = compileSource("toplevel-static", src);
    expect(errors).toEqual([]);
    expect(css).toMatch(/\.flex\s*\{/);
    expect(css).toMatch(/\.items-center\s*\{/);
    expect(css).toMatch(/\.gap-2\s*\{/);
    expect(css).toMatch(/\.p-4\s*\{/);
    expect(css).toMatch(/\.font-bold\s*\{/);
  });

  test("file with no block-form markup emits no spurious block-only classes", () => {
    const src = `<div class="p-4">
  <span class="text-sm">plain</span>
</div>
`;
    const { errors, css } = compileSource("no-block", src);
    expect(errors).toEqual([]);
    expect(css).toMatch(/\.p-4\s*\{/);
    expect(css).toMatch(/\.text-sm\s*\{/);
    // These block-only utility classes appear NOWHERE in this source.
    expect(css).not.toMatch(/\.rounded-xl\s*\{/);
    expect(css).not.toMatch(/\.tracking-wide\s*\{/);
  });
});
