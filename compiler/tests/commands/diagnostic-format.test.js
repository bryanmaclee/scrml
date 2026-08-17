/**
 * diagnostic-format.test.js — the print-time redundant-code strip.
 *
 * g-tab-error-messages-self-prefix-code (S347-peter): most TABError messages
 * self-prefix their own code (`E-X: …`) while every CLI formatter also prepends
 * `${code}:`, so the code printed twice. `stripRedundantCode` removes the message's
 * self-prefix at display time only; the diagnostic DATA is untouched.
 */
import { describe, test, expect } from "bun:test";
import { stripRedundantCode } from "../../src/commands/diagnostic-format.js";

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
});
