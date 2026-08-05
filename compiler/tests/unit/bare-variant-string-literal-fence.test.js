/**
 * g-bare-variant-mask-leaks-into-string-literals (HIGH, 2026-08-04)
 *
 * The bare-variant mask in preprocessForAcorn
 * (expression-parser.ts:1604 — `.Variant` → `__scrml_bare_variant_Variant__`,
 * so Acorn can parse a bare-dot variant as a primary expression) previously ran
 * as an UNFENCED global `s.replace(...)` over the whole source string. A
 * `.Uppercase` word appearing after a non-word char INSIDE a string literal
 * (path, regex source, prose) matched the code-position pattern and was masked;
 * the unmask pass walks Identifier AST nodes only, so a placeholder buried in
 * parsed STRING content is unreachable and LEAKED verbatim into the emitted
 * runtime string — silent data corruption.
 *
 *   <path> = "/a/.Beta"   →   _scrml_cs_reactive_set("path", "/a/__scrml_bare_variant_Beta__")
 *
 * Whether a given interior escaped was pure lookbehind accident (`.Note`
 * preceded by `e` was excluded as member access; `.Beta` preceded by `/` was
 * not). The fix routes the mask through `rewriteCodeSegments` (the same
 * regex/comment/string fence the sibling `not`-lowering uses), so it applies to
 * CODE regions only; string/regex/comment interiors pass through verbatim.
 *
 * This is the identical GITI-017/S125 class the `not`-lowering directly below
 * the mask was already fixed for.
 *
 * SPEC authority:
 *   - §14.10 (bare-variant inference) — `.X` admitted where context typed
 *   - §18 (pattern matching / pipe-alternation) — arm alternation must survive
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import fs from "fs";
import path from "path";
import os from "os";

function compileSrcToClient(src, basename = "fence-test") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-fence-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    const r = compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
      log: () => {},
    });
    const clientPath = path.join(tmpDir, `${basename}.client.js`);
    const client = fs.existsSync(clientPath)
      ? fs.readFileSync(clientPath, "utf-8")
      : null;
    return { client, errors: (r.errors ?? []).map((e) => e.code) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§1 — string literals with .Uppercase emit VERBATIM (no mask leak)", () => {
  test("§1.1 path string /a/.Beta (was corrupted — . preceded by /)", () => {
    const { client } = compileSrcToClient(
      `<page>\n<path> = "/a/.Beta"\n<p>\${@path}</p>\n</page>\n`,
    );
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    expect(client).toMatch(/"\/a\/\.Beta"/);
  });

  test("§1.2 .Uppercase after ( inside a string", () => {
    const { client } = compileSrcToClient(
      `<page>\n<s> = "(.Beta)"\n<p>\${@s}</p>\n</page>\n`,
    );
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    expect(client).toMatch(/"\(\.Beta\)"/);
  });

  test("§1.3 prose string 'see .Note' (escaped pre-fix by accident, guarded now)", () => {
    const { client } = compileSrcToClient(
      `<page>\n<msg> = "see .Note below"\n<p>\${@msg}</p>\n</page>\n`,
    );
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    expect(client).toMatch(/"see \.Note below"/);
  });

  test("§1.4 leading-slash + Uppercase in a template-literal static span", () => {
    const { client } = compileSrcToClient(
      "<page>\n<u> = `/api/.Version`\n<p>${@u}</p>\n</page>\n",
    );
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    expect(client).toMatch(/\/api\/\.Version/);
  });
});

describe("§2 — genuine CODE-position bare variants still mask + unmask", () => {
  test("§2.1 assignment = .Alpha", () => {
    const src = `type Mode:enum = { Alpha, Beta }

<program>
    <state>: Mode = .Alpha
    <div>${"$"}{@state}</div>
</program>`;
    const { client } = compileSrcToClient(src);
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    expect(client).toMatch(/"Alpha"/);
  });

  test("§2.2 array element [.A, .B] and ternary cond ? .A : .B", () => {
    const src = `type Mode:enum = { A, B }

<program>
    <flag> = true
    const <picked>: Mode = @flag ? .A : .B
    const <both>: [Mode] = [.A, .B]
    <div>${"$"}{@picked}</div>
</program>`;
    const { client } = compileSrcToClient(src);
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    // ternary arms + array elements lower to bare discriminant strings
    expect(client).toMatch(/"A"/);
    expect(client).toMatch(/"B"/);
  });

  test("§2.3 is .Idle predicate still lowers", () => {
    const src = `type Mode:enum = { Idle, Busy }

<program>
    <state>: Mode = .Idle
    const <ready> = @state is .Idle
    <div>${"$"}{@ready}</div>
</program>`;
    const { client } = compileSrcToClient(src);
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    expect(client).toMatch(/"Idle"/);
  });
});

describe("§3 — FIRST-TASK: pipe-alternation survives the fence", () => {
  test("§3.1 .A | .B | .C match-arm alternation emits the OR-chain", () => {
    const src = `type Mode:enum = { A, B, C, D }

<program>
    <mode>: Mode = .A
    const <kind> = match @mode {
        .A | .B | .C => "many"
        .D => "one"
    }
    <div>${"$"}{@kind}</div>
</program>`;
    const { client } = compileSrcToClient(src);
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/__scrml_bare_variant_/);
    // three-way alternation must produce a three-term OR chain
    expect(client).toMatch(
      /_scrml_match_\d+ === "A" \|\| _scrml_match_\d+ === "B" \|\| _scrml_match_\d+ === "C"/,
    );
    expect(client).toMatch(/return "many";/);
    expect(() => new Function(client)).not.toThrow();
  });
});
