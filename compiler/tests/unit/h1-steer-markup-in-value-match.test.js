/**
 * h1-steer-markup-in-value-match (S196 prereq-bug Bucket 3 — H1 steer-to-block-form)
 *
 * The natural reflex `${match err { .V(p) :> <markup with ${p}> }}` — a JS-style
 * VALUE-match arm RETURNING MARKUP — hit one of two wrong-altitude failures:
 *   Seam 1 (markup body) -> E-CODEGEN-INVALID-LOGIC (a CG "compiler defect" message
 *           for a USER error — wrong altitude).
 *   Seam 2 (payload var in `${...}` inside the markup body) -> E-SCOPE-001
 *           "Undeclared identifier" (payload not in scope for value-match codegen).
 *
 * §18.0 splits the two match forms by output category: JS-style emits a VALUE,
 * block-form `<match for=Type>` emits MARKUP. The H1 fix replaces BOTH wrong-
 * altitude failures with ONE early TYPER-stage steer (E-MATCH-ARM-MARKUP-IN-VALUE)
 * pointing at the block-form / render-expression. It does NOT widen value-match to
 * emit markup. The arm-body visit is skipped once the steer fires, so the steer is
 * the ONLY diagnostic (Seam 2's E-SCOPE-001 is suppressed).
 *
 * Critical negatives (no false fire):
 *   - a string-returning value-match arm (`:> "Failed: "+reason`) compiles clean
 *   - a plain value-returning arm (`:> x`, `:> .Variant`) compiles clean
 *   - a block-form `<match>` with markup arms (the CORRECT form) does NOT fire
 *
 * Full-pipeline (compileScrml) — the steer fires at the typer over the real AST.
 * Cross-stream partition: E-MATCH-ARM-MARKUP-IN-VALUE is an Error -> result.errors.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CODE = "E-MATCH-ARM-MARKUP-IN-VALUE";

function compileSrc(src, baseName) {
  const tmp = join(tmpdir(), `scrml-h1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  const srcFile = join(tmp, `${baseName}.scrml`);
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
  return { result, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

// Cross-stream lookup — an Error lands in result.errors, but scan both streams so
// a code assertion never silently passes against the wrong partition.
function hasCode(result, code) {
  return [...(result.errors || []), ...(result.warnings || [])].some((d) => d.code === code);
}
const errorCodes = (result) => (result.errors || []).map((e) => e.code);

// ---------------------------------------------------------------------------
// §1: Seam 1 — markup body in a value-match -> steer (NOT E-CODEGEN-INVALID-LOGIC)
// ---------------------------------------------------------------------------

describe("h1-steer §1: Seam 1 — markup body in a JS-style value-match", () => {
  const src = [
    "<program>",
    "  ${",
    "    type LoadError:enum = { NotFound, Forbidden }",
    "    <err>: LoadError = .NotFound",
    "  }",
    "  <div>",
    "    ${match @err {",
    "      .NotFound  :> <p>Not found.</p>",
    "      .Forbidden :> <p>Forbidden.</p>",
    "    }}",
    "  </div>",
    "</program>",
  ].join("\n");

  test("fires E-MATCH-ARM-MARKUP-IN-VALUE (the steer), not E-CODEGEN-INVALID-LOGIC", () => {
    const { result, cleanup } = compileSrc(src, "h1-seam1");
    expect(hasCode(result, CODE)).toBe(true);
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    cleanup();
  });

  test("the steer is an Error (lands in result.errors — exit 1 partition)", () => {
    const { result, cleanup } = compileSrc(src, "h1-seam1-partition");
    expect((result.errors || []).some((e) => e.code === CODE)).toBe(true);
    expect((result.warnings || []).some((w) => w.code === CODE)).toBe(false);
    cleanup();
  });

  test("the steer fires at the typer stage (TS), not codegen", () => {
    const { result, cleanup } = compileSrc(src, "h1-seam1-stage");
    const d = (result.errors || []).find((e) => e.code === CODE);
    expect(d).toBeDefined();
    // stage is surfaced as `stage` on the diagnostic; the typer stage is "TS".
    if (d && d.stage !== undefined) expect(d.stage).toBe("TS");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §2: Seam 2 — payload var in markup arm -> steer REPLACES E-SCOPE-001
// ---------------------------------------------------------------------------

describe("h1-steer §2: Seam 2 — payload var in markup arm body", () => {
  const src = [
    "<program>",
    "  ${",
    "    type LoadError:enum = { NotFound(id: string), Forbidden }",
    "    <err>: LoadError = .Forbidden",
    "  }",
    "  <div>",
    "    ${match @err {",
    "      .NotFound(id) :> <p>Missing: ${id}</p>",
    "      .Forbidden    :> <p>Forbidden.</p>",
    "    }}",
    "  </div>",
    "</program>",
  ].join("\n");

  test("fires the steer and SUPPRESSES the downstream E-SCOPE-001 on the payload", () => {
    const { result, cleanup } = compileSrc(src, "h1-seam2");
    expect(hasCode(result, CODE)).toBe(true);
    expect(errorCodes(result)).not.toContain("E-SCOPE-001");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §3: value-position (const decl) — markup-returning value-match also steers
// ---------------------------------------------------------------------------

describe("h1-steer §3: value-position markup-match (const decl)", () => {
  const src = [
    "<program>",
    "  ${",
    "    type LoadError:enum = { NotFound, Forbidden }",
    "    <err>: LoadError = .NotFound",
    "    const view = match @err {",
    "      .NotFound  :> <p>Not found.</p>",
    "      .Forbidden :> <p>Forbidden.</p>",
    "    }",
    "  }",
    "  <div>x</div>",
    "</program>",
  ].join("\n");

  test("a const-bound markup-returning value-match steers (not E-CODEGEN-INVALID-LOGIC)", () => {
    const { result, cleanup } = compileSrc(src, "h1-valuepos");
    expect(hasCode(result, CODE)).toBe(true);
    expect(errorCodes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §4: NEGATIVES — string / value arms + the block-form must NOT fire
// ---------------------------------------------------------------------------

describe("h1-steer §4: no false fire on legitimate forms", () => {
  test("string-returning value-match arms compile clean (no steer)", () => {
    const src = [
      "<program>",
      "  ${",
      "    type LoadError:enum = { NotFound, Forbidden(reason: string) }",
      "    <err>: LoadError = .NotFound",
      "    const msg = match @err {",
      "      .NotFound          :> \"Not found.\"",
      "      .Forbidden(reason) :> \"Forbidden: \" + reason",
      "    }",
      "  }",
      "  <div>${@msg}</div>",
      "</program>",
    ].join("\n");
    const { result, cleanup } = compileSrc(src, "h1-string-ctrl");
    expect(hasCode(result, CODE)).toBe(false);
    expect(errorCodes(result)).not.toContain("E-MATCH-ARM-MARKUP-IN-VALUE");
    cleanup();
  });

  test("a bare value-returning arm (`:> .Variant`) does not steer", () => {
    const src = [
      "<program>",
      "  ${",
      "    type Mode:enum = { A, B }",
      "    <m>: Mode = .A",
      "    const next = match @m {",
      "      .A :> .B",
      "      .B :> .A",
      "    }",
      "  }",
      "  <div>x</div>",
      "</program>",
    ].join("\n");
    const { result, cleanup } = compileSrc(src, "h1-value-ctrl");
    expect(hasCode(result, CODE)).toBe(false);
    cleanup();
  });

  test("the block-form `<match>` with markup arms is the CORRECT form (no steer)", () => {
    const src = [
      "<program>",
      "  ${",
      "    type Phase:enum = { Editing, Failed }",
      "    <phase>: Phase = .Editing",
      "  }",
      "  <div>",
      "    <match for=Phase on=@phase>",
      "      <Editing><p>Edit.</p></>",
      "      <Failed><p>Failed.</p></>",
      "    </>",
      "  </div>",
      "</program>",
    ].join("\n");
    const { result, cleanup } = compileSrc(src, "h1-blockform-ctrl");
    expect(hasCode(result, CODE)).toBe(false);
    cleanup();
  });
});
