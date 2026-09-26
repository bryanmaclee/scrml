/**
 * native-lex-regex-after-statement-closer.test.js — S432 F1.
 *
 * The native lexer decides regex-vs-division from the previous token, and a
 * `)` read as a VALUE closer makes the next `/` a division. The `)` of a
 * control-statement head (`if (…)`, `for (…)`, `while (…)`) is not a value
 * closer — a statement follows it, so a `/` after it opens a regex. Reading
 * `if (s) /"/.test(s)` as division opened a phantom string at the `"`,
 * desynchronised the rest of the file, and fired E-CLASS-NOT-IN-SCRML inside
 * a later STRING LITERAL (`const msg = "class Foo { }"`) — in the DEFAULT
 * pipeline too, which takes this code family from the native parse. SPEC
 * §7.2.1: a diagnostic on `class` in a string is a compiler defect.
 *
 * Genuine division after an expression `)` (`(a) / 2`, `f(a) / 2`) and after
 * an object-literal `}` must stay division.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScrml } from "../../src/api.js";
import { lex } from "../../native-parser/lex.js";
import { CONTROL_HEAD_KEYWORDS } from "../../native-parser/lex-in-code.js";
import { REGEX_AFTER_CLOSE_PAREN_KEYWORDS } from "../../src/codegen/code-segments.ts";

const CODES = ["E-CLASS-NOT-IN-SCRML", "E-DYNAMIC-IMPORT-NOT-IN-SCRML"];

function hits(src, parser) {
  const dir = mkdtempSync(join(tmpdir(), "s432f1-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  const r = compileScrml({
    inputFiles: [f], outputDir: join(dir, "dist"), write: false, log: () => {},
    ...(parser ? { parser } : {}),
  });
  return [...(r.errors || []), ...(r.warnings || [])]
    .filter((d) => CODES.includes(d.code))
    .map((d) => { const s = d.span || d.tabSpan || {}; return `${d.code}@${s.line}:${s.col}`; });
}

/** The kind of the token that starts at the first `/` at or after `from`. */
function slashKind(code, from = 0) {
  const at = code.indexOf("/", from);
  const tok = lex(code).find((t) => t.span && t.span.start === at);
  return tok ? tok.kind : "NONE";
}

const prog = (logic) => `<program>\n\${\n${logic}\n}\n<p>x</p>\n</program>\n`;
const TAIL = `\n  const msg = "class Foo { }"`;

const PARSERS = [["default", undefined], ["scrml-native", "scrml-native"]];

describe("lexer — a `/` after a statement closer is a regex", () => {
  const REGEX = [
    ["if (s) /x/", "if (s) /\"/.test(s)"],
    ["if (a) /x\"/", "if (a) /x\"/.test(b)"],
    ["if (f(a)) — nested call in the head", "if (f(a)) /\"/.test(a)"],
    ["for (…;…;…)", "for (let i = 0; i < 2; i++) /\"/.test(s)"],
    ["for (… of …)", "for (const x of xs) /\"/.test(x)"],
    ["for await (…)", "for await (const x of xs) /\"/.test(x)"],
    ["while (s)", "while (s) /\"/.test(s)"],
    ["else if (b)", "if (a) { b = 1 } else if (b) /\"/.test(b)"],
    ["do { } while (c)", "do { s = 0 } while (s) /\"/.test(s)"],
  ];
  for (const [name, code] of REGEX) {
    test(name, () => {
      // The `/` under test is the LAST statement's leading `/`.
      const at = code.lastIndexOf("/\"/") >= 0 ? code.lastIndexOf("/\"/") : code.lastIndexOf("/x");
      expect(slashKind(code, at)).toBe("RegexLit");
    });
  }

  const DIVISION = [
    ["(a) / \"x\".length", "const r = (a) / \"x\".length"],
    ["f(a) / 2", "const r = f(a) / 2"],
    ["o.if(4) / 2 — `if` as a member name", "const r = o.if(4) / 2"],
    ["o?.for(4) / 2", "const r = o?.for(4) / 2"],
    ["division inside an if head", "if ((a) / 2 > 1) { }"],
    ["object literal `}` / 2", "const r = { a: 1 }.a / 2"],
    ["call after if-body", "if (a) return f(a) / 2"],
    ["match head is an expression", "const v = match (k) { else => 1 } / 2"],
  ];
  for (const [name, code] of DIVISION) {
    test(`stays division: ${name}`, () => {
      const at = code.lastIndexOf("/ ");
      expect(slashKind(code, at)).toBe("Slash");
    });
  }

  test("the control-head keyword set mirrors the default tokenizer + codegen set", () => {
    expect([...CONTROL_HEAD_KEYWORDS].sort()).toEqual([...REGEX_AFTER_CLOSE_PAREN_KEYWORDS].sort());
  });
});

describe("no E-CLASS-NOT-IN-SCRML inside a later string (both pipelines)", () => {
  const CLEAN = [
    ["if (s) /\"/ (reviewer repro)", `  function f(s) {\n    if (s) /"/.test(s)\n    return 1\n  }`],
    ["if (s) /'/", `  function f(s) {\n    if (s) /'/.test(s)\n    return 1\n  }`],
    ["if (a) /x\"/", `  function f(a, b) {\n    if (a) /x"/.test(b)\n    return 1\n  }`],
    ["for (…) /\"/", `  function f(xs) {\n    for (const x of xs) /"/.test(x)\n    return 1\n  }`],
    ["for (;;) /\"/", `  function f(xs) {\n    for (let i = 0; i < 2; i++) /"/.test(xs)\n    return 1\n  }`],
    ["while (…) /\"/", `  function f(s) {\n    while (s) /"/.test(s)\n    return 1\n  }`],
    ["if (f(a)) /\"/", `  function g(a) { return a }\n  function f(a) {\n    if (g(a)) /"/.test(a)\n    return 1\n  }`],
    ["if (a) (/\"/)", `  function f(a, b) {\n    if (a) (/"/).test(b)\n    return 1\n  }`],
    ["else if (b) /\"/", `  function f(a, b) {\n    if (a) { b = 1 } else if (b) /"/.test(b)\n    return 1\n  }`],
    ["do { } while (s) /\"/", `  function f(s) {\n    do { s = 0 } while (s) /"/.test(s)\n    return 1\n  }`],
    ["(a) / \"x\".length — division", `  const a = 4\n  const r = (a) / "x".length / 1`],
    ["f(a) / 2 — division", `  function f(a) { return a }\n  const a = 4\n  const r = f(a) / 2 / 1`],
  ];
  for (const [label, parser] of PARSERS) {
    for (const [name, logic] of CLEAN) {
      test(`${label}: ${name}`, () => {
        expect(hits(prog(logic + TAIL), parser)).toEqual([]);
      });
    }
    test(`${label}: a real class after the regex still fires, at the keyword`, () => {
      const logic = `  function f(s) {\n    if (s) /"/.test(s)\n    return 1\n  }\n  class Foo { }`;
      expect(hits(prog(logic), parser)).toEqual(["E-CLASS-NOT-IN-SCRML@7:3"]);
    });
  }

  // NOT covered, deliberately: a regex statement after a statement BLOCK's
  // `}` (`if (s) { }⏎/"/.test(s)`). Every lexer in the repo reads that `/` as
  // division — this one, self-host-v2/lex.scrml (its slice-4b parity corpus
  // pins `if (a) {}⏎/re/g` as division) and the default tokenizer.ts (which
  // also space-pads the regex in the emitted JS). A coordinated fix across
  // all of them; see the S432 fix report.
});
