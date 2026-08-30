/**
 * diagnostic-format.test.js — the print-time redundant-code strip.
 *
 * g-tab-error-messages-self-prefix-code (S347-peter): most TABError messages
 * self-prefix their own code (`E-X: …`) while every CLI formatter also prepends
 * `${code}:`, so the code printed twice. `stripRedundantCode` removes the message's
 * self-prefix at display time only; the diagnostic DATA is untouched.
 */
import { describe, test, expect } from "bun:test";
import { stripRedundantCode, resolveDiagLocation, stripRedundantLocation } from "../../src/commands/diagnostic-format.js";

describe("stripRedundantCode — print-time self-prefix removal", () => {
  test("strips an exact `${code}: ` self-prefix", () => {
    expect(stripRedundantCode("E-SWITCH-FORBIDDEN", "E-SWITCH-FORBIDDEN: `switch` is not a scrml keyword"))
      .toBe("`switch` is not a scrml keyword");
  });

  test("strips `${code}:` with no following space", () => {
    expect(stripRedundantCode("E-X", "E-X:immediate")).toBe("immediate");
  });

  test("collapses multiple leading spaces/tabs after the prefix", () => {
    expect(stripRedundantCode("E-X", "E-X:   \tpadded")).toBe("padded");
  });

  test("leaves a message with no self-prefix unchanged", () => {
    expect(stripRedundantCode("E-X", "no prefix here")).toBe("no prefix here");
  });

  test("does NOT strip a DIFFERENT code that merely shares a prefix (E-X vs E-XY)", () => {
    // Guards against `E-X:` falsely matching the head of `E-XY: …`.
    expect(stripRedundantCode("E-X", "E-XY: different code")).toBe("E-XY: different code");
  });

  test("only strips the FIRST occurrence — a code repeated later in prose stays", () => {
    expect(stripRedundantCode("E-X", "E-X: see also E-X: elsewhere")).toBe("see also E-X: elsewhere");
  });

  test("null-safe: missing code or non-string message passes through", () => {
    expect(stripRedundantCode(null, "E-X: hi")).toBe("E-X: hi");
    expect(stripRedundantCode("E-X", undefined)).toBe(undefined);
    expect(stripRedundantCode("E-X", null)).toBe(null);
  });

  test("strips a self-prefixed W- WARNING code (the dev.js warning-loop path)", () => {
    // g-dev-warn-loop-double-prints-self-prefixed-code (S349-peter): the error/lint
    // formatters stripped, but dev.js's non-fatal-warning loop (dev.js:469) printed
    // `w.message` raw while still prepending `[${w.code}]`, so self-prefixed W-*
    // warnings (W-PROGRAM-001, W-CONST-AT-DEPRECATED, …) double-printed their code
    // AND the redundant prefix ate the 120-char slice. The warning loop now routes
    // through this helper like the other three sites.
    expect(stripRedundantCode("W-PROGRAM-001", "W-PROGRAM-001: No <program> root element found."))
      .toBe("No <program> root element found.");
  });
});

/**
 * S385 — `resolveDiagLocation`: the span-carrier fallback.
 *
 * g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm,
 * defect 2. The CLI formatters read only the flat `filePath`/`line`/`column`
 * fields, while most stage diagnostics carry their location in a `span` object
 * (`{ file, start, end, line, col }`) and set no flat fields at all — note `col`
 * vs `column`. A fully-located diagnostic therefore printed with NO location:
 * `E-STATE-UNDECLARED` rendered as a bare message plus `stage: TS`, which cost
 * one adopter a hand-bisection of a 3,700-line file. The span was correct at the
 * fire site all along (measured: `line 6, col 14`); only the printer was blind.
 */
describe("S385 — resolveDiagLocation reads the `span` carrier", () => {
  test("a span-only diagnostic yields file + line + column", () => {
    const d = {
      code: "E-STATE-UNDECLARED",
      span: { file: "/p/app.scrml", start: 66, end: 75, line: 6, col: 14 },
    };
    expect(resolveDiagLocation(d)).toEqual({
      filePath: "/p/app.scrml",
      line: 6,
      column: 14,
    });
  });

  test("maps the span's `col` onto `column` (the key names differ)", () => {
    const d = { span: { file: "/p/a.scrml", line: 3, col: 9 } };
    expect(resolveDiagLocation(d).column).toBe(9);
  });

  test("flat fields WIN over the span when both are present", () => {
    const d = {
      filePath: "/flat.scrml",
      line: 1,
      column: 2,
      span: { file: "/span.scrml", line: 99, col: 98 },
    };
    expect(resolveDiagLocation(d)).toEqual({
      filePath: "/flat.scrml",
      line: 1,
      column: 2,
    });
  });

  test("a flat-only diagnostic (the lint shape) is unchanged", () => {
    const d = { filePath: "/p/a.scrml", line: 8, column: 28 };
    expect(resolveDiagLocation(d)).toEqual({
      filePath: "/p/a.scrml",
      line: 8,
      column: 28,
    });
  });

  test("`file` is accepted as an alias for `filePath`", () => {
    expect(resolveDiagLocation({ file: "/p/a.scrml" }).filePath).toBe("/p/a.scrml");
  });

  test("a zero line/col is reported as 0, not swallowed to null", () => {
    // Callers gate the `:line:col` suffix on truthiness, so a 0 must arrive as
    // 0 (suffix suppressed) rather than being coerced away here.
    const d = { span: { file: "/p/a.scrml", line: 0, col: 0 } };
    const r = resolveDiagLocation(d);
    expect(r.filePath).toBe("/p/a.scrml");
    expect(r.line).toBe(0);
    expect(r.column).toBe(0);
  });

  test("null-safe on a missing / non-object diagnostic and a missing span", () => {
    expect(resolveDiagLocation(null)).toEqual({ filePath: null, line: null, column: null });
    expect(resolveDiagLocation(undefined)).toEqual({ filePath: null, line: null, column: null });
    expect(resolveDiagLocation({})).toEqual({ filePath: null, line: null, column: null });
    expect(resolveDiagLocation({ span: null })).toEqual({ filePath: null, line: null, column: null });
    expect(resolveDiagLocation({ span: "nope" })).toEqual({ filePath: null, line: null, column: null });
  });
});

/**
 * S385 — `stripRedundantLocation`: drop a message's baked-in `(line N, col N)`
 * when the formatter is about to print the same coordinates on its `-->` line.
 *
 * Before the span-carrier fallback landed, `-->` printed a bare path with no
 * coordinates, so the message's own text was the only location an author got.
 * Now the two render back-to-back and the duplication is exact:
 *
 *     warning [W-PROGRAM-REDUNDANT-LOGIC]: … (line 2, col 5)
 *       --> app.scrml:2:5
 */
describe("S385 — stripRedundantLocation", () => {
  test("strips a trailing `(line N, col N)` matching what will be printed", () => {
    expect(stripRedundantLocation("Remove the redundant block. (line 2, col 5)", 2, 5))
      .toBe("Remove the redundant block.");
  });

  test("KEEPS a location citing a DIFFERENT line (a cross-reference)", () => {
    const m = "conflicts with the declaration (line 40, col 3)";
    expect(stripRedundantLocation(m, 2, 5)).toBe(m);
  });

  test("KEEPS it when the line matches but the column does not", () => {
    const m = "something (line 2, col 9)";
    expect(stripRedundantLocation(m, 2, 5)).toBe(m);
  });

  test("accepts the `column` spelling as well as `col`", () => {
    expect(stripRedundantLocation("msg (line 7, column 1)", 7, 1)).toBe("msg");
  });

  test("only strips at the END — a mid-message citation survives", () => {
    const m = "at (line 2, col 5) something failed";
    expect(stripRedundantLocation(m, 2, 5)).toBe(m);
  });

  test("no-ops when there is no line to print, or on a non-string", () => {
    expect(stripRedundantLocation("msg (line 2, col 5)", null, null))
      .toBe("msg (line 2, col 5)");
    expect(stripRedundantLocation("msg (line 2, col 5)", 0, 0))
      .toBe("msg (line 2, col 5)");
    expect(stripRedundantLocation(undefined, 2, 5)).toBe(undefined);
    expect(stripRedundantLocation(null, 2, 5)).toBe(null);
  });

  test("leaves a message with no trailing location untouched", () => {
    expect(stripRedundantLocation("plain message", 2, 5)).toBe("plain message");
  });
});
