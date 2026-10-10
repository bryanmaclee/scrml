/**
 * fix-is-some.test.js — the `scrml fix` rule `is-some` (§42.2.2a / §55.1 / §63, S462;
 * ruling:user-voice-scrml.md S462 "a, validator too, go"). change-id: s462-is-some-deprecate.
 *
 * `fixIsSome` rewrites the word `some` after `is` to `given` at every site impl#1's own
 * token streams locate (the sites W-IS-SOME-DEPRECATED fires on), verifies each file by an
 * impl#1 compile before and after (byte-identical artifacts, the lint cleared), and is
 * idempotent. A comment, a string and markup prose are never sites.
 */

import { describe, test, expect } from "bun:test";
import { fixIsSome, IS_SOME_RULE } from "../../src/commands/fix-is-some.js";
import { fixS66, IMPL1_SAFE_RULES, S66_RULES } from "../../src/commands/fix-s66.js";

const D = "$";
const SRC = [
  "<program>",
  "type U:struct = { name: string }",
  "<user>: U | not = not",
  "<n>: int = 0",
  `${D}{`,
  "  // a comment that says x is some value",
  "  function f() {",
  "    const msg = \"this is some text\"",
  "    if (@user is some) { return @user.name + msg }",
  "    return \"\"",
  "  }",
  "}",
  `<p if=(@user is some && @n > 0)>${D}{f()}</p>`,
  `<p>This is some prose. ${D}{@user is   some ? "yes" : "no"}</p>`,
  "</program>",
  "",
].join("\n");

describe("fixIsSome — `is some` → `is given`", () => {
  test("rewrites exactly the code sites, leaves comments / strings / prose", () => {
    const r = fixIsSome(SRC, { filePath: "/tmp/fix-is-some-a/h.scrml" });
    expect(r.blockers).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.applied.length).toBe(3);
    for (const a of r.applied) expect(a.rule).toBe(IS_SOME_RULE);
    expect(r.output).toContain("if (@user is given) {");
    expect(r.output).toContain("<p if=(@user is given && @n > 0)>");
    expect(r.output).toContain("${@user is   given ? \"yes\" : \"no\"}");
    expect(r.output).toContain("// a comment that says x is some value");
    expect(r.output).toContain("\"this is some text\"");
    expect(r.output).toContain("This is some prose.");
  });

  test("idempotent: a second run makes no edit", () => {
    const once = fixIsSome(SRC, { filePath: "/tmp/fix-is-some-b/h.scrml" }).output;
    const twice = fixIsSome(once, { filePath: "/tmp/fix-is-some-b/h.scrml" });
    expect(twice.changed).toBe(false);
    expect(twice.output).toBe(once);
  });

  test("the validator form `<x is some>` is rewritten", () => {
    const src = ["<signup>", "  <name req is some> = <input type=\"text\"/>", "</>", "<program>", `<p>${D}{@signup.name}</p>`, "</program>", ""].join("\n");
    const r = fixIsSome(src, { filePath: "/tmp/fix-is-some-c/h.scrml" });
    expect(r.blockers).toEqual([]);
    expect(r.output).toContain("<name req is given> = <input type=\"text\"/>");
    expect(r.applied[0].detail).toContain("validator");
  });

  test("a file with no site is untouched", () => {
    const src = "<program>\n<p>This is some prose.</p>\n</program>\n";
    const r = fixIsSome(src, { filePath: "/tmp/fix-is-some-d/h.scrml" });
    expect(r.changed).toBe(false);
    expect(r.applied).toEqual([]);
  });

  test("registered as a default (impl#1-safe) `scrml fix` rule and chained by fixS66", () => {
    expect(IMPL1_SAFE_RULES).toContain(IS_SOME_RULE);
    expect(S66_RULES).toContain(IS_SOME_RULE);
    const r = fixS66(SRC, { filePath: "/tmp/fix-is-some-e/h.scrml", rules: [IS_SOME_RULE] });
    expect(r.changed).toBe(true);
    expect(r.output).toContain("if (@user is given) {");
  });
});
