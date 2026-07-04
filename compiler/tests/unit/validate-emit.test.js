/**
 * Emitted-JS parse gate (Approach A) — unit tests.
 *
 * change-id: gate-emitted-js-parse-invariant-2026-05-29 (ratified S141, A+D).
 *
 * Exercises the core gate logic in compiler/src/codegen/validate-emit.ts in
 * isolation: a valid artifact returns null; an invalid artifact returns a
 * CGError(E-CODEGEN-INVALID-LOGIC) naming the artifact + byte/line/column +
 * offending snippet. Deterministic — does NOT depend on any transient codegen
 * bug, so it stays green when the separate codegen fix-wave closes the
 * pre-existing invalid-JS surface.
 *
 * Mirrors the in-tree meta-eval reparseEmitted / E-META-EVAL-002 precedent for
 * the FINAL `.client.js` / `.server.js` / chunk artifacts.
 */
import { describe, test, expect } from "bun:test";
import {
  validateEmittedArtifact,
  validateEmittedArtifacts,
} from "../../src/codegen/validate-emit.ts";

describe("validate-emit (Approach A) — single artifact", () => {
  test("valid modern client JS returns null (no false positive)", () => {
    const contents = [
      "function _scrml_lift_1() {",
      "  const el = document.createElement('span');",
      "  el.textContent = String((d.name) ?? '');",
      "  el.style.display = (d.location != null) ? '' : 'none';",
      "  return el;",
      "}",
      "_scrml_lift_1();",
    ].join("\n");
    expect(
      validateEmittedArtifact({ sourceFile: "x.scrml", artifact: "x.client.js", contents }),
    ).toBeNull();
  });

  test("valid ESM server JS (import/export, async/await, optional chaining) returns null", () => {
    const contents = [
      "import { SQL } from 'bun';",
      "const _scrml_sql = new SQL(':memory:');",
      "export async function handler(req) {",
      "  const body = await req.json();",
      "  return body?.id ?? null;",
      "}",
    ].join("\n");
    expect(
      validateEmittedArtifact({ sourceFile: "x.scrml", artifact: "x.server.js", contents }),
    ).toBeNull();
  });

  test("the historical C1 length-twobound shape is rejected", () => {
    // { op: ">=", value: 2 , <= 120 } — the R27 C1 malformed object literal.
    const contents = "const v = { op: '>=', value: 2 , <= 120 };";
    const err = validateEmittedArtifact({
      sourceFile: "expense.scrml",
      artifact: "expense.client.js",
      contents,
    });
    expect(err).not.toBeNull();
    expect(err.code).toBe("E-CODEGEN-INVALID-LOGIC");
  });

  test("the truncated `!==` (compound is-some) shape is rejected, with offset + snippet", () => {
    // The trucking-dispatch C-class: `m.field is some && m.field != ""` lowered
    // to a truncated `!==` with no RHS — the dominant pre-existing invalid-JS bug.
    const contents =
      "function f() { el.style.display = ((m.field !== null && m.field !== undefined)&&m.field!==)) ? '' : 'none'; }";
    const err = validateEmittedArtifact({
      sourceFile: "drivers.scrml",
      artifact: "drivers.client.js",
      contents,
    });
    expect(err).not.toBeNull();
    expect(err.code).toBe("E-CODEGEN-INVALID-LOGIC");
    // Names the artifact + a numeric byte/line/column.
    expect(err.message).toContain("drivers.client.js");
    expect(err.message).toMatch(/byte \d+, line \d+, column \d+/);
    // Frames it as a compiler defect (the adopter cannot fix emitted JS).
    expect(err.message).toContain("compiler defect");
    // span carries the parse position.
    expect(typeof err.span.start).toBe("number");
    expect(typeof err.span.line).toBe("number");
  });

  test("a leaked unlowered `server {` block fragment is rejected", () => {
    // seeds.server.js C-class: a `server { ... }` block leaks unlowered.
    const contents = "const x = 1;\nserver {\n  const y = 2\n}\n";
    const err = validateEmittedArtifact({
      sourceFile: "seeds.scrml",
      artifact: "seeds.server.js",
      contents,
    });
    expect(err).not.toBeNull();
    expect(err.code).toBe("E-CODEGEN-INVALID-LOGIC");
  });
});

describe("validate-emit (Approach A) — batch", () => {
  test("all-valid batch returns empty array", () => {
    const arts = [
      { sourceFile: "a.scrml", artifact: "a.client.js", contents: "const a = 1;" },
      { sourceFile: "b.scrml", artifact: "b.server.js", contents: "export const b = 2;" },
    ];
    expect(validateEmittedArtifacts(arts)).toEqual([]);
  });

  test("returns one error PER invalid artifact, valid ones skipped", () => {
    const arts = [
      { sourceFile: "ok.scrml", artifact: "ok.client.js", contents: "const ok = 1;" },
      { sourceFile: "bad1.scrml", artifact: "bad1.client.js", contents: "const x = (1 +;" },
      { sourceFile: "ok2.scrml", artifact: "ok2.server.js", contents: "export const y = 2;" },
      { sourceFile: "bad2.scrml", artifact: "bad2.client.js", contents: "function f() { return )); }" },
    ];
    const errs = validateEmittedArtifacts(arts);
    expect(errs.length).toBe(2);
    expect(errs.every((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBe(true);
    const artifacts = errs.map((e) => e.message).join("\n");
    expect(artifacts).toContain("bad1.client.js");
    expect(artifacts).toContain("bad2.client.js");
    expect(artifacts).not.toContain("ok.client.js");
  });

  test("empty batch returns empty array", () => {
    expect(validateEmittedArtifacts([])).toEqual([]);
  });
});
