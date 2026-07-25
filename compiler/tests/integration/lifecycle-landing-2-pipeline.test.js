/**
 * Lifecycle Landing 2 — pipeline integration tests
 *
 * End-to-end verification of the S130 HU-1 Approach C extension:
 *   - Canonical `to` glyph (S130 ratification)
 *   - Legacy `->` glyph → W-LIFECYCLE-LEGACY-ARROW info-level lint
 *   - Engine-cell carve-out → E-TYPE-LIFECYCLE-ON-ENGINE-CELL
 *   - Extension positions: struct fields (Landing 1 baseline) + Shape 1
 *     plain reactive cells, fn parameters, schema fields, channel cells
 *
 * Unit-level coverage (helpers + walker) lives at
 * `compiler/tests/unit/type-system-lifecycle-landing-2.test.js`.
 * This file is the complementary end-to-end verification through `compileScrml()`.
 *
 * NOTE on scope: function-return position is OUT OF SCOPE for Landing 2 per
 * HU-1 Q3 sub-question deferral (transition-marker mechanism is an open
 * candidate set). See SPEC §14.12.6 NOTE.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lifecycle-l2-"));
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
    write: false,
    log: () => {},
  });
  return {
    errors: result.errors || [],
    warnings: result.warnings || [],
  };
}

// Cross-stream helper per memory feedback_diagnostic_stream_partition —
// W-/I- diagnostics are routed to result.warnings (non-fatal), but a code
// might appear in either stream depending on severity classification. Search
// both to avoid silent false-negatives.
function findDiagnostic(result, code) {
  return [
    ...(result.errors || []).filter(e => e.code === code),
    ...(result.warnings || []).filter(e => e.code === code),
  ];
}

describe("Lifecycle Landing 2 — canonical `to` glyph", () => {
  test("canonical `to` glyph works in struct field — accepted, no W-LIFECYCLE-LEGACY-ARROW", () => {
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not to string)
  }

  function boot() {
    let u = < User name="alice" passwordHash="hash">
    log(u.passwordHash)
  }
}

<program></program>`;
    const result = compileSource("l2-to-glyph-struct", src);
    // No E-TYPE-001 fire (the field is initialized at construction)
    const lifecycleFires = result.errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBe(0);
    // No legacy-arrow lint either
    const legacyLints = findDiagnostic(result, "W-LIFECYCLE-LEGACY-ARROW");
    expect(legacyLints.length).toBe(0);
  });

  test("legacy `->` glyph still parses — fires both E-TYPE-001 AND W-LIFECYCLE-LEGACY-ARROW", () => {
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not -> string)
  }

  function boot() {
    let u = < User name="alice">
    log(u.passwordHash)
  }
}

<program></program>`;
    const result = compileSource("l2-legacy-glyph-struct", src);
    // E-TYPE-001 fire (pre-transition access, Landing 1 path)
    const lifecycleFires = result.errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBeGreaterThanOrEqual(1);
    // AND W-LIFECYCLE-LEGACY-ARROW info lint (Landing 2 glyph migration)
    const legacyLints = findDiagnostic(result, "W-LIFECYCLE-LEGACY-ARROW");
    expect(legacyLints.length).toBeGreaterThanOrEqual(1);
    expect(legacyLints[0].message).toContain("User.passwordHash");
  });

  test("canonical `to` glyph fires E-TYPE-001 on pre-transition access (parity with `->`)", () => {
    const src = `\${
  type User:struct = {
    name: string,
    passwordHash: (not to string)
  }

  function boot() {
    let u = < User name="alice">
    log(u.passwordHash)
  }
}

<program></program>`;
    const result = compileSource("l2-to-glyph-fires", src);
    const lifecycleFires = result.errors.filter(
      e => e.code === "E-TYPE-001" && /lifecycle|pre-transition/i.test(e.message),
    );
    expect(lifecycleFires.length).toBeGreaterThanOrEqual(1);
    // Diagnostic message should still name field, type, SPEC anchor
    const fire = lifecycleFires[0];
    expect(fire.message).toMatch(/passwordHash/);
    expect(fire.message).toMatch(/User/);
  });

  test("mixed-glyph struct (one field `to`, one field `->`) — only legacy field lints", () => {
    const src = `\${
  type Order:struct = {
    receipt: (not to string),
    confirmedAt: (not -> number)
  }

  function boot() {
    let o = < Order receipt="r" confirmedAt=1>
    log(o.receipt)
    log(o.confirmedAt)
  }
}

<program></program>`;
    const result = compileSource("l2-mixed-glyph", src);
    const legacyLints = findDiagnostic(result, "W-LIFECYCLE-LEGACY-ARROW");
    // Only `confirmedAt` (the `->` field) lints; `receipt` (the `to` field) does not.
    expect(legacyLints.length).toBe(1);
    expect(legacyLints[0].message).toContain("Order.confirmedAt");
  });
});

describe("Lifecycle Landing 2 — engine-cell carve-out (E-TYPE-LIFECYCLE-ON-ENGINE-CELL)", () => {
  test("engine cell with lifecycle annotation FIRES E-TYPE-LIFECYCLE-ON-ENGINE-CELL (canonical `to`)", () => {
    // The cell `phase` is the auto-declared variable of the `<engine for=Phase>`.
    // Declaring a lifecycle annotation on the same cell name fires the carve-out.
    // (v0.3 modern shape: program-as-container, explicit-closer state-children.)
    const src = `<program>

    type Phase:enum = { Idle, Done }

    <engine for=Phase initial=.Idle>
      <Idle rule=.Done></>
      <Done></>
    </>

    <phase>: (not to string) = not

</program>`;
    const result = compileSource("l2-engine-cell-carve-out", src);
    const carveOutFires = findDiagnostic(result, "E-TYPE-LIFECYCLE-ON-ENGINE-CELL");
    expect(carveOutFires.length).toBeGreaterThanOrEqual(1);
    const fire = carveOutFires[0];
    expect(fire.message).toMatch(/@phase/);
    expect(fire.message).toMatch(/variant-graph progression/);
    expect(fire.message).toMatch(/§51\.0/);
    expect(fire.message).toMatch(/§14\.12\.4/);
  });

  test("engine cell with legacy `->` glyph also fires E-TYPE-LIFECYCLE-ON-ENGINE-CELL", () => {
    const src = `<program>

    type Phase:enum = { Idle, Done }

    <engine for=Phase initial=.Idle>
      <Idle rule=.Done></>
      <Done></>
    </>

    <phase>: (not -> string) = not

</program>`;
    const result = compileSource("l2-engine-cell-legacy-glyph", src);
    const carveOutFires = findDiagnostic(result, "E-TYPE-LIFECYCLE-ON-ENGINE-CELL");
    expect(carveOutFires.length).toBeGreaterThanOrEqual(1);
  });

  test("engine cell WITHOUT lifecycle annotation does NOT fire E-TYPE-LIFECYCLE-ON-ENGINE-CELL", () => {
    const src = `<program>

    type Phase:enum = { Idle, Done }

    <engine for=Phase initial=.Idle>
      <Idle rule=.Done></>
      <Done></>
    </>

</program>`;
    const result = compileSource("l2-engine-cell-no-lifecycle", src);
    const carveOutFires = findDiagnostic(result, "E-TYPE-LIFECYCLE-ON-ENGINE-CELL");
    expect(carveOutFires.length).toBe(0);
  });

  test("plain reactive cell (Shape 1) with lifecycle annotation does NOT fire carve-out", () => {
    // No engine declared; the lifecycle annotation is on a Shape 1 plain cell.
    // The carve-out should NOT fire (no engine ownership).
    const src = `<program>

    <status>: (not to string) = not

</program>`;
    const result = compileSource("l2-shape1-no-engine", src);
    const carveOutFires = findDiagnostic(result, "E-TYPE-LIFECYCLE-ON-ENGINE-CELL");
    expect(carveOutFires.length).toBe(0);
  });
});

describe("Lifecycle Landing 2 — extension positions (Shape 1, fn parameters)", () => {
  test("Shape 1 plain reactive cell `<status>: (not to string) = not` parses", () => {
    const src = `<program>

    <status>: (not to string) = not

</program>`;
    const result = compileSource("l2-shape1-plain-cell", src);
    // No lifecycle-engine-cell fire (it's a plain Shape 1)
    expect(findDiagnostic(result, "E-TYPE-LIFECYCLE-ON-ENGINE-CELL").length).toBe(0);
  });

  test("function parameter position `fn process(u: (not to User))` parses without crash", () => {
    const src = `\${
  type User:struct = { id: number }

  fn process(u: (not to User)) {
    return u
  }
}

<program></program>`;
    const result = compileSource("l2-fn-param-lifecycle", src);
    // Just parse / type-resolve — fn-param tracking semantics are part of the
    // landing wiring; this asserts no crash and no false E-TYPE-LIFECYCLE-ON-
    // ENGINE-CELL fire.
    expect(findDiagnostic(result, "E-TYPE-LIFECYCLE-ON-ENGINE-CELL").length).toBe(0);
  });
});

describe("Lifecycle Landing 2 — W-LIFECYCLE-LEGACY-ARROW lint surfacing", () => {
  test("legacy lint surfaces in result.warnings (non-fatal partition per S93)", () => {
    const src = `\${
  type User:struct = {
    passwordHash: (not -> string)
  }

  function boot() {
    let u = < User passwordHash="hash">
    log(u.passwordHash)
  }
}

<program></program>`;
    const result = compileSource("l2-lint-warnings-stream", src);
    // W-LIFECYCLE-LEGACY-ARROW has W- prefix + severity:"info" → routed to warnings
    const legacyLintsInWarnings = (result.warnings || []).filter(
      e => e.code === "W-LIFECYCLE-LEGACY-ARROW",
    );
    expect(legacyLintsInWarnings.length).toBeGreaterThanOrEqual(1);
    expect(legacyLintsInWarnings[0].severity).toBe("info");
  });
});
