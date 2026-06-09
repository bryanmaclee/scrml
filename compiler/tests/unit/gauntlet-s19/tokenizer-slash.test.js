// Gauntlet S19: block-splitter must not emit E-SYNTAX-050 for a literal `/`
// in markup text content (e.g., between `${}` interpolations). The error is
// reserved for legacy bare-closer patterns where the `/` is adjacent to either
// a NEW OPENER tag (`<name`) or EOF. S177 bug-4 refined the heuristic: a `/`
// immediately before a REAL CLOSE TAG (`</...`) is literal text (a real closer
// is already present), NOT a closer attempt — so `<p>hi/</p>` no longer fires.
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../../src/block-splitter.js";

function split(src) {
  return splitBlocks("test.scrml", src);
}

describe("S19: bare '/' in markup text content is literal", () => {
  test("'/' between two ${} interpolations compiles clean", () => {
    const src = [
      "${",
      "    @a = 1",
      "    @b = 2",
      "}",
      "<p>${@a} / ${@b}</>",
    ].join("\n");
    const result = split(src);
    const slashErrs = result.errors.filter((e) => e.code === "E-SYNTAX-050");
    expect(slashErrs).toEqual([]);
  });

  test("legacy bare '/' closer attempt (before a NEW OPENER) still fires E-SYNTAX-050", () => {
    // `<div>hi/<p>x</p></div>`: the `/` is immediately followed by a NEW OPENER
    // (`<p`), i.e., a classic Phase 1/2 "trailing `/` then start a sibling"
    // closer pattern. This MUST still be diagnosed so users migrate to `</>`.
    const result = split("<div>hi/<p>x</p></div>");
    const slashErrs = result.errors.filter((e) => e.code === "E-SYNTAX-050");
    expect(slashErrs.length).toBeGreaterThan(0);
  });

  test("legacy bare '/' closer attempt (at EOF) still fires E-SYNTAX-050", () => {
    // `<p>hi/`: the `/` is at EOF — the pre-Phase-3 trailing-closer form.
    const result = split("<p>hi" + "/");
    const slashErrs = result.errors.filter((e) => e.code === "E-SYNTAX-050");
    expect(slashErrs.length).toBeGreaterThan(0);
  });

  test("S177 bug-4: bare '/' immediately before a CLOSE tag is literal text", () => {
    // `<p>hi/</p>`: a real closer (`</p>`) is already present, so the `/` is
    // literal markup text (a trailing slash), NOT a closer attempt.
    const result = split("<p>hi/</p>");
    const slashErrs = result.errors.filter((e) => e.code === "E-SYNTAX-050");
    expect(slashErrs).toEqual([]);
  });
});
