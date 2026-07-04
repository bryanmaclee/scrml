/**
 * gate-flip-and-residuals (S142) — Residual 3 (R25-Bug-49 §5): a nested
 * `EXPR !{ ARMS }` failable handler written INSIDE an outer `!{}` arm body must
 * lower to a real nested guarded-expr, not leak its `!{ }` structural wrapper.
 *
 * ROOT CAUSE: the OUTER `!{}` arm HANDLER is captured by parseErrorTokens as a
 * flat token-joined STRING; a nested `!{}` inside it never became a child
 * guarded-expr node. It reached rewriteBlockBody (zero `!{}` handling) and the
 * inner `!{ | ::Y -> {...} }` leaked verbatim → invalid JS (the gate's
 * E-CODEGEN-INVALID-LOGIC; the pre-gate test passed only on substring presence).
 *
 * FIX (emit-logic.ts emitArmBody): when an arm body contains a top-level `!{`,
 * re-parse the body through the BS → TAB sub-pipeline so the nested guarded-expr
 * becomes a proper node, then emit via emitLogicBody (recursive). Falls back to
 * rewriteBlockBody if the re-parse fails.
 *
 * Compiles the §5 shape end-to-end with the emit gate ON and asserts no
 * E-CODEGEN-INVALID-LOGIC + both arm reactive writes present + acorn-clean output.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-nested-err-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], outputDir: join(dir, "dist"), write: true, validateEmit: true, log: () => {} });
}

describe("nested `!{}` inside an arm body does not leak the structural wrapper", () => {
  test("R25-Bug-49 §5 — outer + inner arms both emit, gate-clean", () => {
    const src = [
      '<program title="bug49-nested">',
      "<state>",
      '<outer> = ""',
      '<inner> = ""',
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type OuterErr:enum = { X }",
      "type InnerErr:enum = { Y }",
      "server function a() ! OuterErr { fail OuterErr::X }",
      "server function b() ! InnerErr { fail InnerErr::Y }",
      "function run() {",
      "  const r = a() !{",
      "    | ::X -> {",
      "      const s = b() !{",
      '        | ::Y -> { @inner = "y" }',
      "      }",
      '      @outer = "x"',
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const result = compileSource(src);
    const invalid = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalid).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    expect(out?.clientJs).toBeTruthy();
    // The inner `!{ }` structural wrapper must NOT leak; both arm writes must emit.
    expect(out.clientJs).not.toContain("!{");
    expect(out.clientJs).toContain('_scrml_reactive_set("inner", "y")');
    expect(out.clientJs).toContain('_scrml_reactive_set("outer", "x")');
    expect(() => acorn.parse(out.clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
  });
});
