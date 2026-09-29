/**
 * css-sub-seam — the CSS sub-seam of CG (s440-bootstrap-css-theme-t3; dpa-051 §8.4 step 1).
 *
 * `FileOutput.css` is independent of html / clientJs / serverJs (which share binding ids and swap only
 * as the whole CG unit), so its USER-STYLESHEET part has its own seam (pipeline-seam.ts `CSS`). These
 * pins prove: nothing swapped = impl#1's own `generateCss` (identity); a swapped emitter replaces only
 * the user stylesheet — html and clientJs are unchanged and Tailwind utilities are still appended; the
 * emitter receives the per-file context; and a malformed return fails loud naming the stage.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { createStageSeams, StageSeamError } from "../../src/pipeline-seam.ts";
import { generateCss } from "../../src/codegen/emit-css.ts";

const SRC = `<program>
  const Card = <div props={}>
      #{ .card { color: red; } }
      <div class="card p-4">hi</div>
  </>
  <Card/>
</program>
`;

function compileWith(stageOverrides) {
  const dir = mkdtempSync(join(tmpdir(), "css-sub-seam-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, SRC);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {}, ...(stageOverrides ? { stageOverrides } : {}) });
    const out = [...r.outputs.values()].find((o) => o.sourceFile.endsWith("app.scrml"));
    return { r, out, file };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CSS sub-seam", () => {
  test("nothing swapped: the pick is generateCss itself", () => {
    expect(createStageSeams(null, null).pick("CSS", generateCss)).toBe(generateCss);
  });

  test("a swapped emitter replaces ONLY the user stylesheet; html/clientJs unchanged; Tailwind still appended", () => {
    const base = compileWith(null);
    const seen = [];
    const swapped = compileWith({
      CSS: (nodes, cssBlocks, errors, fileAST, ctx) => {
        seen.push({ isArray: Array.isArray(nodes), hasErrors: Array.isArray(errors), filePath: ctx?.filePath, mode: ctx?.mode, astPath: fileAST?.filePath });
        return "/* bootstrap */";
      },
    });
    expect(base.out.css).toContain("@scope");
    expect(swapped.out.css.startsWith("/* bootstrap */")).toBe(true);
    expect(swapped.out.css).not.toContain("@scope");
    // The Tailwind `p-4` utility is CG's own part of FileOutput.css, appended after the user sheet.
    expect(base.out.css).toContain(".p-4");
    expect(swapped.out.css).toContain(".p-4");
    expect(swapped.out.html).toBe(base.out.html);
    expect(swapped.out.clientJs).toBe(base.out.clientJs);
    expect(seen.length).toBe(1);
    expect(seen[0].isArray && seen[0].hasErrors).toBe(true);
    expect(seen[0].mode).toBe("browser");
    expect(seen[0].filePath.endsWith("app.scrml")).toBe(true);
  });

  test("a non-string return fails loud, naming the CSS stage", () => {
    let err = null;
    try {
      compileWith({ CSS: () => 42 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StageSeamError);
    expect(err.stage).toBe("CSS");
  });
});
