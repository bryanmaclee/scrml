/**
 * is-given-end-of-line-s462.test.js — S462 fix round 2, NEW-1 (HIGH).
 *
 * The `given` of `x is given` ENDS A VALUE, exactly like the IDENT `some` of
 * `x is some`. Before the fix, an end-of-line `@o = a is given` followed by a line
 * starting with an identifier (`g(1)`, `console.log(z)`) was joined into one
 * expression and the expression parser dropped the next statement — exit 0, no
 * diagnostic (the base reported E-SYNTAX-045 there). Both collectors' ASI checks
 * now treat the presence `given` as a value terminal (ast-builder.js
 * `endsPresenceGiven`), and collectLiftExpr's treats `not` as one too, as
 * collectExpr's already did.
 *
 * Every probe compiles twice (one per spelling) at the same path and must emit
 * identical artifacts (source-echo comments folded) and keep the next statement.
 * Also pinned: a same-line `@o = a is some g(1)` is E-STMT-MISSING-SEMICOLON for
 * BOTH spellings (it used to drop `g(1)` silently for `is some`), and a comment
 * between `is` and `some` no longer hides the deprecated spelling.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { fixIsSome } from "../../src/commands/fix-is-some.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const RUN_DIR = join(tmpdir(), `scrml-is-given-eol-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
function compile(src) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(join(RUN_DIR, "dist"), { recursive: true });
  const file = join(RUN_DIR, "h.scrml");
  writeFileSync(file, src);
  const r = compileScrml({ inputFiles: [file], outputDir: join(RUN_DIR, "dist"), log: () => {} });
  const outs = [];
  for (const [, v] of (r.outputs ?? new Map())) {
    for (const [k, t] of Object.entries(v ?? {})) if (typeof t === "string" && !/Map$/.test(k)) outs.push(`${k}=${t.split("is given").join("is some")}`);
  }
  rmSync(RUN_DIR, { recursive: true, force: true });
  return {
    errors: (r.errors ?? []).map((e) => e.code),
    lints: [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d.code === "W-IS-SOME-DEPRECATED").length,
    out: outs.join("\n#\n"),
  };
}
const D = "$";
const fn = (body) => `<program>\n<x>: string = "a"\n<o>: bool = false\n<k>: number = 0\n${D}{\n    function g(v) { @k = v }\n    function f(a) {\n${body.map((l) => "        " + l).join("\n")}\n    }\n}\n<p>${D}{f(@x)} ${D}{@o} ${D}{@k}</p>\n</program>\n`;

const PROBES = {
  "the reviewer's reproducer": [fn(["@o = a is SPELL", "g(1)", "let z = a is SPELL", "console.log(z)", "if (a is SPELL) { g(2) }", "return z"]), ["_scrml_g_", "console.log(z)"]],
  "a call line": [fn(["@o = a is SPELL", "g(1)", "return 0"]), ["(1)"]],
  "a console.log line": [fn(["const z = a is SPELL", "console.log(z)", "return 0"]), ["console.log(z)"]],
  "an @cell = line": [fn(["const z = a is SPELL", "@k = 3", "return z"]), ["3)"]],
  "a let line": [fn(["@o = a is SPELL", "let q = 2", "g(q)", "return 0"]), ["let q = 2"]],
  "a return line": [fn(["const z = a is SPELL", "return z"]), ["return z"]],
  "`x is not` then a call (collectLiftExpr's `not` terminal)": [fn(["@o = a is not", "g(1)", "return 0"]), ["(1)"]],
  "a lift body (collectLiftExpr)": [`<program>\n<xs>: string[] = ["a"]\n<k>: number = 0\n${D}{\n    function g(v) { @k = v }\n}\n<ul>${D}{ for (it of @xs) {\n    const has = it is SPELL\n    g(1)\n    lift <li>${D}{has}</li>\n} }</ul>\n</program>\n`, ["(1)"]],
  "a multi-statement handler": [`<program>\n<x>: string = "a"\n<o>: bool = false\n<k>: number = 0\n<button onclick=${D}{\n    @o = @x is SPELL\n    @k = 4\n}>b</button>\n</program>\n`, ["4)"]],
};

describe("S462 NEW-1 — an end-of-line `x is given` ends the statement, as `x is some` does", () => {
  for (const [name, [tmpl, mustContain]] of Object.entries(PROBES)) {
    test(name, () => {
      const some = compile(tmpl.replaceAll("SPELL", "some"));
      const given = compile(tmpl.replaceAll("SPELL", "given"));
      expect(given.errors).toEqual(some.errors);
      expect(some.errors.filter((c) => c.startsWith("E-") && c !== "E-DG-002")).toEqual([]);
      expect(given.out).toBe(some.out);
      for (const s of mustContain) expect(given.out).toContain(s);
    });
  }

  test("the `^{}` meta case gets the same diagnostics for both spellings", () => {
    const tmpl = `<program>\n<div>\n^{\n    const x = 1\n    const has = x is SPELL\n    emit("<p>" + has + "</p>")\n}\n</div>\n</program>\n`;
    expect(compile(tmpl.replaceAll("SPELL", "given")).errors).toEqual(compile(tmpl.replaceAll("SPELL", "some")).errors);
  });

  test("a same-line `a is some g(1)` / `a is given g(1)` is E-STMT-MISSING-SEMICOLON for both spellings", () => {
    const tmpl = fn(["@o = a is SPELL g(1)", "return 0"]);
    expect(compile(tmpl.replaceAll("SPELL", "some")).errors).toContain("E-STMT-MISSING-SEMICOLON");
    expect(compile(tmpl.replaceAll("SPELL", "given")).errors).toContain("E-STMT-MISSING-SEMICOLON");
  });
});

describe("S462 round 2 (a) — a comment between `is` and `some` does not hide the deprecated spelling", () => {
  const SRC = `<program>\n<k>: number = 0\n${D}{\n    function f(x) {\n        if (x is /* c */ some) { @k = 1 }\n        const y = x is // c\n            some\n        return y\n    }\n}\n<p onclick=f(1)>${D}{@k}</p>\n</program>\n`;
  test("both sites are linted", () => {
    expect(compile(SRC).lints).toBe(2);
  });
  test("`scrml fix` rewrites both (verified), keeping the comments", () => {
    const r = fixIsSome(SRC, { filePath: join(tmpdir(), `scrml-eol-fix-${process.pid}`, "h.scrml") });
    expect(r.blockers).toEqual([]);
    expect(r.applied.length).toBe(2);
    expect(r.output).toContain("if (x is /* c */ given) { @k = 1 }");
    expect(r.output).toContain("const y = x is // c\n            given");
  });
});
