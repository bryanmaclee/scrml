/**
 * failable-arm-template-literal-lowering.test.js
 *
 * g-failable-arm-body-multiline-template-invalid-logic — a TEMPLATE literal in a
 * `!{}` failable handler arm body must be re-emitted as a template (backticks),
 * not as a plain double-quoted string.
 *
 * ROOT (found by re-derivation, not the filed locus): `parseErrorTokens`
 * (ast-builder.js) reconstructs the arm handler from its tokens and re-quoted
 * EVERY string token with DOUBLE QUOTES, ignoring the token's `isTemplate` flag.
 * A backtick template `\`got ${e}\`` therefore became `"got ${e}"`, which:
 *   (a) LOSES the interpolation — `${e}` becomes literal text (a SILENT
 *       correctness bug, even for a single-line arm); and
 *   (b) for a MULTI-LINE template, produces a double-quoted string spanning two
 *       physical lines → an unterminated string literal → E-CODEGEN-INVALID-LOGIC
 *       (the LOUD symptom the gap was filed on).
 *
 * FIX: (1) `reemitHandlerStringToken` re-emits an `isTemplate` token with
 * backticks (shared by all three arm-handler reconstruction sites); (2)
 * `emitArmAssign` (emit-logic.ts) assigns a multi-line single EXPRESSION arm body
 * to the result var as one unit instead of splitting it at the interior newline
 * (which discarded the value) — gated on the body being a non-block expression.
 *
 * Two-sided: the interpolation is asserted to survive (single + multi-line), a
 * plain double-quoted string arm is asserted UNCHANGED (double quotes), and a
 * block-body arm stays multi-statement (no over-fire of the expression path).
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "failable-arm-tmpl-"));
});

function compile(src) {
  const srcPath = join(tmpDir, "repro.scrml");
  const outDir = join(tmpDir, "dist");
  writeFileSync(srcPath, src);
  const result = compileScrml({
    inputFiles: [srcPath],
    outputDir: outDir,
    validateEmit: true,
    log: () => {},
  });
  const errorCodes = (result.errors || [])
    .filter((e) => e.severity == null || e.severity === "error")
    .map((e) => e.code);
  const clientPath = join(outDir, "repro.client.js");
  const out = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
  return { errorCodes, out };
}

// A failable subject: a plain fn whose body throws (JSON.parse) — the `!{}`
// catches the host error (the canonical control-015 shape).
const SUBJECT = `  fn parseJson(src: string) { return JSON.parse(src) }\n`;

describe("failable-arm template-literal lowering (g-failable-arm-body-multiline-template-invalid-logic)", () => {
  it("the gap repro: a MULTI-LINE template arm body compiles (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errorCodes, out } = compile(
      `<program>\n${SUBJECT}  export fn go(src: string) {\n    return parseJson(src) !{ ::SyntaxError(e) :> \`line one\nline two\` }\n  }\n</program>\n`,
    );
    expect(errorCodes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(errorCodes).toEqual([]);
    // Re-emitted as a backtick TEMPLATE, not a plain double-quoted string.
    expect(out).toContain("`line one");
    expect(out).toContain("line two`");
    expect(/"line one/.test(out)).toBe(false);
    // Assigned to the result var as one unit (not split into bare statements).
    expect(/_scrml__scrml_result_\d+ = `line one/.test(out)).toBe(true);
  });

  it("interpolation SURVIVES in a template arm body (single-line) — not a literal ${…}", () => {
    const { errorCodes, out } = compile(
      `<program>\n${SUBJECT}  export fn go(src: string) {\n    return parseJson(src) !{ ::SyntaxError(e) :> \`got \${e} here\` }\n  }\n</program>\n`,
    );
    expect(errorCodes).toEqual([]);
    // A real template interpolation (backticks + ${e}), NOT the pre-fix
    // double-quoted literal "got ${e} here" (which never interpolates).
    expect(out).toContain("`got ${e} here`");
    expect(out).not.toContain('"got ${e} here"');
  });

  it("interpolation SURVIVES in a MULTI-LINE template arm body", () => {
    const { errorCodes, out } = compile(
      `<program>\n${SUBJECT}  export fn go(src: string) {\n    return parseJson(src) !{ ::SyntaxError(e) :> \`failed on:\ninput=\${src}\` }\n  }\n</program>\n`,
    );
    expect(errorCodes).toEqual([]);
    expect(out).toContain("`failed on:");
    expect(out).toContain("input=${src}`");
  });

  it("GATE — a plain double-quoted string arm body is UNCHANGED (still double-quoted)", () => {
    const { errorCodes, out } = compile(
      `<program>\n${SUBJECT}  export fn go(src: string) {\n    return parseJson(src) !{ ::SyntaxError(e) :> "plain string" }\n  }\n</program>\n`,
    );
    expect(errorCodes).toEqual([]);
    expect(out).toContain('"plain string"');
    expect(out).not.toContain("`plain string`");
  });

  it("REGRESSION — a multi-statement BLOCK arm body stays multi-statement (not wrapped as one expression)", () => {
    const { errorCodes, out } = compile(
      `<program>\n${SUBJECT}  export fn go(src: string) {\n    return parseJson(src) !{ ::SyntaxError(e) :> {\n      let m = "one"\n      let n = "two"\n    } }\n  }\n</program>\n`,
    );
    expect(errorCodes).toEqual([]);
    // Both statements survive as distinct statements — the expression-body
    // single-assignment path must NOT swallow a block body.
    expect(out).toContain('let m = "one"');
    expect(out).toContain('let n = "two"');
  });
});
