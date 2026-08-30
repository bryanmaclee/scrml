/**
 * diagnostic-format.test.js — the print-time redundant-code strip.
 *
 * g-tab-error-messages-self-prefix-code (S347-peter): most TABError messages
 * self-prefix their own code (`E-X: …`) while every CLI formatter also prepends
 * `${code}:`, so the code printed twice. `stripRedundantCode` removes the message's
 * self-prefix at display time only; the diagnostic DATA is untouched.
 */
import { describe, test, expect } from "bun:test";
import { stripRedundantCode, stripRedundantLocation, resolveDiagLocation } from "../../src/commands/diagnostic-format.js";
import { formatError, formatWarning } from "../../src/commands/compile.js";

const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

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

/**
 * S385 — `resolveDiagLocation` must resolve file/line/col ATOMICALLY.
 *
 * Resolving each component independently could pair a top-level `filePath` with
 * a `line`/`col` from a `.span` naming a DIFFERENT file. The formatter then
 * prints that file with the other file's coordinates AND renders its line as the
 * offending source — confidently wrong, which is worse than incomplete.
 */
describe("S385 — resolveDiagLocation resolves location atomically", () => {
  test("span-only coordinates bring the SPAN's file, not a mismatched flat filePath", () => {
    const r = resolveDiagLocation({
      filePath: "/proj/flat.scrml",
      span: { file: "/proj/span.scrml", line: 42, col: 7 },
    });
    expect(r).toEqual({ file: "/proj/span.scrml", line: 42, col: 7 });
  });

  test("flat coordinates still WIN over a span naming another file (#756 contract)", () => {
    const r = resolveDiagLocation({
      file: "/proj/b.scrml",
      line: 3,
      column: 4,
      span: { file: "/proj/other.scrml", line: 99, col: 99 },
    });
    expect(r).toEqual({ file: "/proj/b.scrml", line: 3, col: 4 });
  });

  test("a flat col SURVIVES a span-sourced line when both name the SAME file", () => {
    // Round-5 regression. The atomicity fix over-applied and discarded a
    // top-level `column` in the span-line branch even when the files matched,
    // contradicting the #756 "top-level coordinates win" contract:
    // `--> a.scrml:3:7` before, `--> a.scrml:3` after.
    expect(resolveDiagLocation({
      filePath: "a.scrml",
      column: 7,
      span: { file: "a.scrml", line: 3 },
    })).toEqual({ file: "a.scrml", line: 3, col: 7 });
  });

  test("...but a flat col is DROPPED when the span names a DIFFERENT file", () => {
    // The atomicity rule still applies: a col indexing into another file must
    // not be rendered against the file actually being reported.
    expect(resolveDiagLocation({
      filePath: "a.scrml",
      column: 7,
      span: { file: "z.scrml", line: 3 },
    })).toEqual({ file: "z.scrml", line: 3, col: undefined });
  });

  test("a span col is borrowed only when both carriers name the SAME file", () => {
    expect(resolveDiagLocation({
      file: "/proj/a.scrml", line: 5,
      span: { file: "/proj/a.scrml", col: 11 },
    }).col).toBe(11);

    expect(resolveDiagLocation({
      file: "/proj/a.scrml", line: 5,
      span: { file: "/proj/z.scrml", col: 11 },
    }).col).toBeUndefined();
  });
});

/**
 * S385 — the strip must be gated on the `-->` line actually being printed.
 *
 * `stripRedundantLocation` removes coordinates the `-->` line is about to
 * repeat. But `-->` only prints when a FILE resolved. A diagnostic carrying a
 * line and NO file would otherwise lose its coordinates entirely — the exact
 * failure this change set exists to fix.
 */
describe("S385 — location strip is gated on a resolved FILE", () => {
  test("a diagnostic with a line but NO file KEEPS its baked-in coordinates", () => {
    const out = stripAnsi(formatError({
      code: "E-X",
      message: "something broke (line 2, col 5)",
      line: 2,
      column: 5,
    }, "/proj"));
    expect(out).toContain("(line 2, col 5)");
    expect(out).not.toContain("-->");
  });

  test("with a file resolved, the duplicate IS stripped and `-->` carries it", () => {
    const out = stripAnsi(formatError({
      code: "E-X",
      message: "something broke (line 2, col 5)",
      file: "/proj/app.scrml",
      line: 2,
      column: 5,
    }, "/proj"));
    expect(out).not.toContain("(line 2, col 5)");
    expect(out).toContain("--> app.scrml:2:5");
  });

  test("formatWarning behaves the same way", () => {
    const out = stripAnsi(formatWarning({
      code: "W-PROGRAM-REDUNDANT-LOGIC",
      message: "Remove the redundant block. (line 2, col 5)",
      span: { file: "/proj/app.scrml", line: 2, col: 5 },
    }, "/proj"));
    expect(out).not.toContain("(line 2, col 5)");
    expect(out).toContain("--> app.scrml:2:5");
  });
});
