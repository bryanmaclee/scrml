/**
 * E-SCHEMA-003 — `<schema>` block placement enforcement (S133 — Phase 2
 * amendment closure F-019).
 *
 * Per SPEC §39.3 + §39.12: a `<schema>` block SHALL appear as an immediate
 * child of the `<program>` root only. Any other placement (nested inside
 * `<db>`, a component body, `<page>`, an engine state-child, or as a top-
 * level standalone) is a compile error (E-SCHEMA-003).
 *
 * The check is implemented in `gauntlet-phase1-checks.js`
 * (function `checkSchemaPlacement`) and runs at the GCP1 stage (post-TAB,
 * structural pre-pass).
 *
 * Test cases (5 mandatory per dispatch brief):
 *
 *   (a) `<schema>` inside `<db>` body                         → fires E-SCHEMA-003
 *   (b) `<schema>` inside engine state-child                  → fires E-SCHEMA-003
 *   (c) `<schema>` inside `${}` logic context — html-fragment swallow case;
 *       documents the orthogonal silent-swallow shape (parser converts the
 *       markup to an `html-fragment` string before E-SCHEMA-003 can see it).
 *       This test asserts the operationally-correct outcome (no fire) and
 *       notes the silent-swallow as a separate follow-up.
 *   (d) `<schema>` inside component body                      → fires E-SCHEMA-003
 *   (e) CONTROL — `<schema>` correctly placed as immediate child of `<program>`
 *                                                              → does NOT fire E-SCHEMA-003
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP_COUNTER = 0;

function compileScrmlFromString(source, testName) {
  const TMP = mkdtempSync(join(tmpdir(), `e-schema-003-${testName}-${++TMP_COUNTER}-`));
  const filePath = join(TMP, `${testName}.scrml`);
  writeFileSync(filePath, source);
  try {
    const result = compileScrml({
      inputFiles: [filePath],
      write: false,
      outputDir: join(TMP, "out"),
      log: () => {},
    });
    return result;
  } finally {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  }
}

function allDiagCodes(result) {
  return [
    ...(result.errors || []),
    ...(result.warnings || []),
  ].map(e => e.code);
}

describe("E-SCHEMA-003 — <schema> placement enforcement (Phase 2 amendment F-019)", () => {

  // ----------------------------------------------------------------------
  // (a) <schema> inside <db> body → fires E-SCHEMA-003
  // ----------------------------------------------------------------------
  test("(a) <schema> nested inside <db> body fires E-SCHEMA-003", () => {
    const src = `<program db="x.db">
  <db src="x.db" tables="foo">
    <schema for="x.db">
      foo { id: int }
    </>
  </>
</program>`;
    const result = compileScrmlFromString(src, "a-schema-in-db");
    const codes = allDiagCodes(result);
    expect(codes).toContain("E-SCHEMA-003");
  });

  // ----------------------------------------------------------------------
  // (b) <schema> inside engine state-child → fires E-SCHEMA-003
  // ----------------------------------------------------------------------
  test("(b) <schema> nested inside engine state-child fires E-SCHEMA-003", () => {
    const src = `<program db="x.db">
  <engine for=Phase initial=.Idle>
    <Idle>
      <schema for="x.db">
        foo { id: int }
      </>
    </>
  </engine>
</program>`;
    const result = compileScrmlFromString(src, "b-schema-in-engine");
    const codes = allDiagCodes(result);
    expect(codes).toContain("E-SCHEMA-003");
  });

  // ----------------------------------------------------------------------
  // (c) <schema> inside ${} logic context — html-fragment swallow case
  //
  // When a `<schema>` literal appears inside a `${ }` logic block, the
  // parser (ast-builder.js parseLogicBody) does NOT enter markup-state at
  // `<` in expression position; it instead captures the token run as a
  // single `html-fragment` string in the logic body. The schema therefore
  // never enters the AST as a `state` node with `stateType === "schema"`,
  // so E-SCHEMA-003 does not fire on this shape.
  //
  // This test documents that operationally-correct outcome. The silent-
  // swallow itself (markup in logic position becoming inert text) is a
  // separate orthogonal concern and is NOT in scope for E-SCHEMA-003.
  // ----------------------------------------------------------------------
  test("(c) <schema> placed inside ${} logic body becomes html-fragment — E-SCHEMA-003 does NOT fire on the swallowed shape", () => {
    const src = `<program db="x.db">
  \${
    let x = 1
  }
  \${
    <schema for="x.db">
      foo { id: int }
    </>
  }
</program>`;
    const result = compileScrmlFromString(src, "c-schema-in-logic");
    const codes = allDiagCodes(result);
    // The parser converts the markup-in-logic into an html-fragment; the
    // schema is never seen as a state node by the placement walker.
    // (Operationally-correct outcome per dispatch brief.)
    expect(codes).not.toContain("E-SCHEMA-003");
  });

  // ----------------------------------------------------------------------
  // (d) <schema> inside component body → fires E-SCHEMA-003
  // ----------------------------------------------------------------------
  test("(d) <schema> nested inside a user-component body fires E-SCHEMA-003", () => {
    const src = `<program db="x.db">
  <Card name="Test">
    <schema for="x.db">
      foo { id: int }
    </>
  </Card>
</program>`;
    const result = compileScrmlFromString(src, "d-schema-in-component");
    const codes = allDiagCodes(result);
    expect(codes).toContain("E-SCHEMA-003");
  });

  // ----------------------------------------------------------------------
  // (e) CONTROL — <schema> correctly placed as immediate child of <program>
  //                                                  → does NOT fire E-SCHEMA-003
  //
  // The negative control is non-negotiable per dispatch brief — proves
  // correctly-placed schemas still work after the new check.
  // ----------------------------------------------------------------------
  test("(e) CONTROL — <schema> as immediate child of <program> does NOT fire E-SCHEMA-003", () => {
    const src = `<program db="x.db">
  <schema for="x.db">
    foo { id: int }
  </>
  <db src="x.db" tables="foo">
    <p>Hello</p>
  </>
</program>`;
    const result = compileScrmlFromString(src, "e-control");
    const codes = allDiagCodes(result);
    expect(codes).not.toContain("E-SCHEMA-003");
  });

});

// ---------------------------------------------------------------------------
// Bonus coverage: standalone <schema> (no <program>) also fires E-SCHEMA-003,
// per SPEC §39.12 text "Schemas are immediate children of `<program>` only."
// A schema with no `<program>` parent has no legal placement.
// ---------------------------------------------------------------------------

describe("E-SCHEMA-003 — bonus coverage", () => {

  test("standalone <schema> at file top (no <program> wrapper) fires E-SCHEMA-003", () => {
    const src = `<schema for="x.db">
  foo { id: int }
</>`;
    const result = compileScrmlFromString(src, "standalone-no-program");
    const codes = allDiagCodes(result);
    expect(codes).toContain("E-SCHEMA-003");
  });

  test("<schema> inside <page> body fires E-SCHEMA-003", () => {
    const src = `<program db="x.db">
  <page route="/users">
    <schema for="x.db">
      foo { id: int }
    </>
  </>
</program>`;
    const result = compileScrmlFromString(src, "schema-in-page");
    const codes = allDiagCodes(result);
    expect(codes).toContain("E-SCHEMA-003");
  });

});
