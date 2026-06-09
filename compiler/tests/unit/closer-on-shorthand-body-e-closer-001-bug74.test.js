/**
 * closer-on-shorthand-body-e-closer-001-bug74.test.js — S177 bug-74 (LOW).
 *
 * SPEC §4.14:987 closer-presence override: a tag that uses a `:`-shorthand body
 * MUST NOT carry any closer (`</>`, `/`, or `/>`). When BOTH a `:`-shorthand
 * body AND a `/>` self-closing terminator are present (`<span :@thing/>`), that
 * is `E-CLOSER-001` ("closer present on `:`-shorthand body — choose one form").
 *
 * BEFORE this fix (block-splitter.js): the `else if (selfClosing || VOID_ELEMENTS)`
 * branch won (since `!selfClosing` was false in the `shorthand && !selfClosing`
 * gate) and SILENTLY swallowed the shorthand body — emitting a bogus self-closing
 * `<span @thing/>` leaf and false-firing `W-DG-002` on the dropped cell. Exit 0.
 *
 * The fix adds an E-CLOSER-001 branch ahead of the self-closing branch, gated on
 * `isGenuineShorthandBodyNotDirective` so the `:let={...}/>` (`:name=` directive
 * attribute) case — which also trips the whitespace-preceded-`:` shorthand
 * scanner — keeps `selfClosing` winning and does NOT false-fire.
 *
 * Coverage:
 *   §1 — `<span :@thing/>` (terse) -> E-CLOSER-001 (fatal)
 *   §2 — `<span : @thing/>` (with after-`:` whitespace) -> E-CLOSER-001
 *   §3 — canonical `<span :@thing>` (no closer) compiles clean (no E-CLOSER-001)
 *   §4 — `:let={...}/>` directive-prefix does NOT fire E-CLOSER-001 (no regress)
 *   §5 — `<input type="text"/>` self-closing void (no shorthand) does NOT fire
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "bug74-closer-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function codes(arr) { return (arr || []).map((e) => e.code); }
function allDiagnostics(result) { return [...(result.errors || []), ...(result.warnings || [])]; }

describe("§1-2 `:`-shorthand body + `/>` -> E-CLOSER-001 (bug-74)", () => {
  test("`<span :@thing/>` (terse) fires E-CLOSER-001 and is fatal", () => {
    const result = compile("b74-terse.scrml", `<program>
  <thing> = "hello"
<div class="container">
  <span :@thing />
</>
</program>`);
    expect(codes(result.errors || [])).toContain("E-CLOSER-001");
    const m = (result.errors || []).find((e) => e.code === "E-CLOSER-001");
    expect(m).toBeDefined();
    expect(m.message).toContain("span");
    expect(m.message).toContain(":");
  });

  test("`<span : @thing/>` (after-`:` whitespace) fires E-CLOSER-001", () => {
    const result = compile("b74-ws.scrml", `<program>
  <thing> = "hello"
<div class="container">
  <span : @thing />
</>
</program>`);
    expect(codes(result.errors || [])).toContain("E-CLOSER-001");
  });
});

describe("§3 canonical `:`-shorthand (no closer) compiles clean", () => {
  test("`<span :@thing>` does NOT fire E-CLOSER-001", () => {
    const result = compile("b74-ok.scrml", `<program>
  <thing> = "hello"
<div class="container">
  <span :@thing>
</>
</program>`);
    expect(codes(allDiagnostics(result))).not.toContain("E-CLOSER-001");
    // The cell IS consumed (rendered) — no W-DG-002 false-fire either.
    expect(codes(allDiagnostics(result))).not.toContain("E-DG-002");
  });
});

describe("§4 `:name=` directive-prefix is NOT a shorthand body (no regress)", () => {
  test("`<each :let={...} of=@items />` does NOT fire E-CLOSER-001", () => {
    const result = compile("b74-let.scrml", `<program>
  <items> = [1, 2, 3]
<div class="container">
  <each :let={item} of=@items />
</>
</program>`);
    expect(codes(allDiagnostics(result))).not.toContain("E-CLOSER-001");
  });
});

describe("§5 plain self-closing void (no shorthand) is unaffected", () => {
  test("`<input type=\"text\"/>` does NOT fire E-CLOSER-001", () => {
    const result = compile("b74-input.scrml", `<program>
<div>
  <input type="text"/>
</>
</program>`);
    expect(codes(allDiagnostics(result))).not.toContain("E-CLOSER-001");
  });
});
