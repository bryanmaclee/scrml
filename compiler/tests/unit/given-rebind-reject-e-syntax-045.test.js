// given-rebind-reject-e-syntax-045.test.js — change-id
// g-given-rebind-not-rejected-2026-06-12.
//
// SPEC §42.2.3 (normative, line ~21476): "No variable is rebound to a new name;
// each identifier is narrowed in place." The grammar is
//   given-guard ::= 'given' identifier-list (':>' | '=>') block
// so a `=` in the `given` head is NOT valid scrml. The rebind form
// `given <name> = <expr> :>` is the SPEC-invalid sibling of the property-path
// form `given obj.field :>` (already rejected by E-SYNTAX-044).
//
// Before the fix the rebind form was asymmetrically broken:
//   - logic context  → E-CODEGEN-INVALID-LOGIC (the "compiler defect" path)
//   - markup `${}`    → silently compiled (accepted the invalid form)
// After the fix BOTH contexts fire E-SYNTAX-045 cleanly at the parse stage
// (ast-builder.js, both given-guard parse sites).
//
// This file verifies:
//   §A — logic-context rebind fires E-SYNTAX-045 (NOT E-CODEGEN-INVALID-LOGIC).
//   §B — markup-`${}`-context rebind fires the SAME E-SYNTAX-045 (was silent).
//   §C — canonical narrow-in-place `given @var :>` stays CLEAN (no E-SYNTAX-045).
//   §D — multi-identifier narrow `given x, y :>` stays CLEAN.
//   §E — disambiguation: `given x => ...` fires ONLY W-GIVEN-ARROW-LEGACY (no
//        E-SYNTAX-045 double-fire); `==` after the ident is not a rebind.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "given-rebind-045-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function compile(filename, source) {
  const abs = fx(filename, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream diagnostic collector (S93 partition — E-* land in result.errors,
// W-/I- in result.warnings; collect both so an assertion never silently passes).
function allDiags(result) {
  return [
    ...(result.errors || []),
    ...(result.warnings || []),
    ...(result.lintDiagnostics || []),
  ];
}
function hasCode(result, code) {
  return allDiags(result).some((e) => e && e.code === code);
}
function countCode(result, code) {
  return allDiags(result).filter((e) => e && e.code === code).length;
}

// ---------------------------------------------------------------------------
// §A — logic-context rebind → E-SYNTAX-045, NOT E-CODEGEN-INVALID-LOGIC
// ---------------------------------------------------------------------------

describe("§A: logic-context `given n = @name :>` rebind", () => {
  const SRC = `<program>
  <name>: string | not = not
  function show() { given n = @name :> { return n } }
  <p>x</p>
</program>
`;

  test("fires E-SYNTAX-045", () => {
    const r = compile("a-logic.scrml", SRC);
    expect(hasCode(r, "E-SYNTAX-045")).toBe(true);
  });

  test("does NOT emit E-CODEGEN-INVALID-LOGIC (the old compiler-defect path)", () => {
    const r = compile("a-logic2.scrml", SRC);
    expect(hasCode(r, "E-CODEGEN-INVALID-LOGIC")).toBe(false);
  });

  test("fires E-SYNTAX-045 exactly once for the single rebind", () => {
    const r = compile("a-logic3.scrml", SRC);
    expect(countCode(r, "E-SYNTAX-045")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §B — markup-`${}`-context rebind → SAME E-SYNTAX-045 (was silent-accept)
// ---------------------------------------------------------------------------

describe("§B: markup-`${}`-context `given s = @sel :>` rebind", () => {
  const SRC = `<program>
  <sel>: string | not = not
  <div>\${ given s = @sel :> <p>\${s}</p> }</div>
</program>
`;

  test("fires E-SYNTAX-045 (was silently accepted before the fix)", () => {
    const r = compile("b-markup.scrml", SRC);
    expect(hasCode(r, "E-SYNTAX-045")).toBe(true);
  });

  test("the file is NOT a clean compile (a fatal error is present)", () => {
    const r = compile("b-markup2.scrml", SRC);
    expect((r.errors || []).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §C — canonical narrow-in-place stays CLEAN
// ---------------------------------------------------------------------------

describe("§C: canonical `given @name :>` narrow-in-place", () => {
  const SRC = `<program>
  <name>: string | not = not
  function show() { given @name :> { return @name } }
  <p>x</p>
</program>
`;

  test("does NOT fire E-SYNTAX-045", () => {
    const r = compile("c-narrow.scrml", SRC);
    expect(hasCode(r, "E-SYNTAX-045")).toBe(false);
  });

  test("compiles with no fatal errors", () => {
    const r = compile("c-narrow2.scrml", SRC);
    expect((r.errors || []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §D — multi-identifier narrow-in-place stays CLEAN
// ---------------------------------------------------------------------------

describe("§D: multi-identifier `given @x, @y :>` narrow-in-place", () => {
  const SRC = `<program>
  <x>: string | not = not
  <y>: string | not = not
  function show() { given @x, @y :> { return @x } }
  <p>z</p>
</program>
`;

  test("does NOT fire E-SYNTAX-045", () => {
    const r = compile("d-multi.scrml", SRC);
    expect(hasCode(r, "E-SYNTAX-045")).toBe(false);
  });

  test("compiles with no fatal errors", () => {
    const r = compile("d-multi2.scrml", SRC);
    expect((r.errors || []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §E — disambiguation: `=>` separator + `==` equality do NOT mis-fire
// ---------------------------------------------------------------------------

describe("§E: disambiguation — `=>` / `==` are not rebinds", () => {
  test("`given x => { ... }` fires W-GIVEN-ARROW-LEGACY but NOT E-SYNTAX-045", () => {
    const SRC = `<program>
  <name>: string | not = not
  function show() { given name => { return name } }
  <p>x</p>
</program>
`;
    const r = compile("e-arrow.scrml", SRC);
    // The deprecated separator is its own diagnostic; the rebind check must not
    // double-fire on `=>` (an OPERATOR token, not a bare `=` PUNCT).
    expect(hasCode(r, "E-SYNTAX-045")).toBe(false);
    expect(hasCode(r, "W-GIVEN-ARROW-LEGACY")).toBe(true);
  });

  test("an `==` equality after the ident is not treated as a rebind", () => {
    // `given x :>` then a body using `==` — the equality is inside the body,
    // never in the given head, so E-SYNTAX-045 must not fire.
    const SRC = `<program>
  <name>: string | not = not
  function show() { given @name :> { return @name == "a" } }
  <p>x</p>
</program>
`;
    const r = compile("e-eq.scrml", SRC);
    expect(hasCode(r, "E-SYNTAX-045")).toBe(false);
  });
});
