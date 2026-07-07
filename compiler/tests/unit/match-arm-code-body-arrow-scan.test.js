/**
 * match-arm-code-body-arrow-scan.test.js
 *
 * Regression: `scanToOpenerClose` (match-statechild-parser.ts) tracks code-
 * expression nesting ({ } / ( ) / [ ]) so a `>` INSIDE a §4.18 code-default
 * arm body — the arrow `=>`, a comparison `a > b`, `>=` — is treated as an
 * operator, NOT the opener-terminating `>`.
 *
 * Before the fix, an inside-opener `:`-shorthand arm whose body used an arrow
 * (`<Updated(row) : { @rows = @rows.map(r => …) }>`) TRUNCATED `bodyRaw` at the
 * `>` of `=>` — the realtime `<onchange>` arms (SPEC §38.13.3) all use
 * `.map(r => …)` / `.filter(r => …)`, so the truncation broke the Phase-2
 * client `__change` dispatch codegen.
 *
 * The `${…}` interpolation form was already opaque; this covers the BARE code
 * body form (the §4.18 `{ … }` code-default body that realtime feeds use).
 */

import { describe, test, expect } from "bun:test";
import { parseMatchArms } from "../../src/match-statechild-parser.ts";

describe("scanToOpenerClose — code-default body with `>` operators", () => {
  test("arrow `=>` inside a `{ … }` shorthand body does not truncate bodyRaw", () => {
    const arms = `<Updated(row) : { @orders = @orders.map(r => r.id == row.id ? row : r) }>`;
    const { arms: parsed } = parseMatchArms(arms);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].variantName).toBe("Updated");
    expect(parsed[0].payloadBindingsRaw.trim()).toBe("row");
    // The WHOLE body — including everything after the `=>` — is captured.
    expect(parsed[0].bodyRaw).toContain(".map(r => r.id == row.id ? row : r)");
    expect(parsed[0].bodyRaw.trim().endsWith("}")).toBe(true);
  });

  test("`.filter(r => …)` arrow body is captured whole", () => {
    const arms = `<Deleted(key) : { @orders = @orders.filter(r => r.id != key) }>`;
    const { arms: parsed } = parseMatchArms(arms);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bodyRaw).toContain(".filter(r => r.id != key)");
  });

  test("the three realtime <onchange> arms all parse with intact bodies", () => {
    const arms = `
      <Inserted(row) : { @orders = [...@orders, row] }>
      <Updated(row) : { @orders = @orders.map(r => r.id == row.id ? row : r) }>
      <Deleted(key) : { @orders = @orders.filter(r => r.id != key) }>
    `;
    const { arms: parsed } = parseMatchArms(arms);
    expect(parsed.map((a) => a.variantName)).toEqual(["Inserted", "Updated", "Deleted"]);
    expect(parsed[0].bodyRaw).toContain("[...@orders, row]");
    expect(parsed[1].bodyRaw).toContain(".map(r => r.id == row.id ? row : r)");
    expect(parsed[2].bodyRaw).toContain(".filter(r => r.id != key)");
  });

  test("bare `>` comparison inside parens does not truncate", () => {
    const arms = `<Big(v) : { @flag = (v > 10) }>`;
    const { arms: parsed } = parseMatchArms(arms);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bodyRaw).toContain("(v > 10)");
  });

  test("markup-as-value body (angle depth) still parses (regression)", () => {
    const arms = `<Loaded(x) : <p>done</p>>`;
    const { arms: parsed } = parseMatchArms(arms);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bodyRaw).toContain("<p>done</p>");
  });

  test("plain single-expression shorthand still parses (regression)", () => {
    const arms = `<Inserted(row) : logIt(row)>`;
    const { arms: parsed } = parseMatchArms(arms);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bodyRaw.trim()).toBe("logIt(row)");
  });
});
