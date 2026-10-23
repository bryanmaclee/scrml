/**
 * S469 r5 — g-impl1-legacy-pipe-literal-match-arms-s469 (HIGH; fixed in s469-impl1-arm-commas under
 * the S435 security limb). §18.2's `match` grammar has no leading `|`: the `|`-led arm is the `!{}`
 * handler's legacy spelling only (§19.4.5; SPEC "§18.2's `match` grammar never admitted a leading
 * `|`"). impl#1 used to read past it — a statement `match @k { | 1 :> {…} | 2 :> {…} | _ :> {…} }`
 * silently ran its LAST arm for every subject, and value positions dropped or mis-dispatched arms.
 *
 * Now a `|`-led arm (literal, string or variant head; first, later or every arm) is E-PARSE-001 in
 * EVERY position and spelling. `| _` / `| else` / `| ( … )` (the §18.19 whole-product wildcard /
 * product arm impl#1 accepts — a filed divergence) are unchanged.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { rawArmHasLeadingPipeArm } from "../../src/arm-list-split.ts";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "match-lead-pipe-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileAt(src, slot) {
  const dir = join(TMP, slot);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, src);
  const r = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} });
  let js = "";
  if (r.outputs instanceof Map) for (const [, v] of r.outputs) js += (v && v.clientJs) || "";
  return { codes: (r.errors || []).filter((e) => !/^[WI]-/.test(e.code)).map((e) => e.code), js };
}

const PRE = `type Shape:enum = { Circle(r: number), Tri, Dot }\n<k>: number | string = 1\n<sh>: Shape = .Tri\n<n> = ""\n\${\n  function f(a, b) { return "f" }\n}\n`;
const POS = {
  statement: (s, a) => `\${\n  function go() {\n    match ${s} {\n${a("      ", true)}\n    }\n  }\n}\n<button onclick=go()>go</>`,
  "@cell = match": (s, a) => `\${\n  function go() {\n    @n = match ${s} {\n${a("      ")}\n    }\n  }\n}\n<button onclick=go()>go</>`,
  "const v = match": (s, a) => `\${\n  function go() {\n    const v = match ${s} {\n${a("      ")}\n    }\n    @n = v\n  }\n}\n<button onclick=go()>go</>`,
  "derived cell": (s, a) => `<d> = match ${s} {\n${a("  ")}\n}\n<p>\${@d}</>`,
  "derived const cell": (s, a) => `const <d> = match ${s} {\n${a("  ")}\n}\n<p>\${@d}</>`,
  "call argument": (s, a) => `\${\n  function g(x) { return x }\n  function go() {\n    @n = g(match ${s} {\n${a("      ")}\n    })\n  }\n}\n<button onclick=go()>go</>`,
  "markup ${}": (s, a) => `<p>\${match ${s} {\n${a("  ")}\n}}</p>`,
};
const LISTS = {
  "literal, every arm piped": ["@k", [["| 1", `"one"`], ["| 2", `"two"`], ["| _", `"z"`]]],
  "literal, first arm piped": ["@k", [["| 1", `"one"`], ["2", `"two"`], ["_", `"z"`]]],
  "literal, later arm piped": ["@k", [["1", `"one"`], ["| 2", `"two"`], ["_", `"z"`]]],
  "negative literal piped": ["@k", [["1", `"one"`], ["| -2", `"two"`], ["_", `"z"`]]],
  "string, later arm piped": ["@k", [[`"a"`, `"one"`], [`| "b"`, `"two"`], ["else", `"z"`]]],
  "literal alternation piped": ["@k", [["1", `"one"`], ["| 2 | 3", `"two"`], ["_", `"z"`]]],
  "variant, later arm piped": ["@sh", [[".Tri", `"one"`], ["| .Dot", `"two"`], ["else", `"z"`]]],
  "variant, every arm piped": ["@sh", [["| .Tri", `"one"`], ["| .Dot", `"two"`], ["| else", `"z"`]]],
};
const SEPS = { newline: "", comma: ",", oneline: null };

describe("a `|`-led match arm is refused (E-PARSE-001) in every position and spelling", () => {
  let slot = 0;
  for (const [pn, page] of Object.entries(POS)) {
    for (const [ln, [subj, arms]] of Object.entries(LISTS)) {
      test(`${pn} — ${ln}`, () => {
        for (const [sn, sep] of Object.entries(SEPS)) {
          const a = (ind, stmt) => {
            const lines = arms.map(([h, b]) => `${h} :> ${stmt ? `{ @n = ${b} }` : b}`);
            return sep === null ? ind + lines.join(", ") : lines.map((l) => ind + l + sep).join("\n");
          };
          const r = compileAt(PRE + page(subj, a), `p-${++slot}`);
          expect({ spelling: sn, codes: r.codes }).toEqual({ spelling: sn, codes: expect.arrayContaining(["E-PARSE-001"]) });
        }
      });
    }
  }
});

describe("unchanged: `| _` / `| else` (the §18.19 wildcard divergence) and the `!{}` handler's `|` arms", () => {
  test("`1 :> \"one\"⏎| _ :> \"z\"` in a statement match compiles and dispatches", () => {
    const r = compileAt(PRE + POS.statement("@k", (ind) => [`${ind}1 :> { @n = "one" }`, `${ind}| _ :> { @n = "z" }`].join("\n")), "wild");
    expect(r.codes).toEqual([]);
    expect(r.js).toMatch(/=== 1\b/);
  });
  test("a `!{}` handler's legacy `|` arms still compile", () => {
    const r = compileAt(`type E:enum = { Bad(m: string), Worse }
<msg> = ""
\${
  function risky(x) ! E {
    if (x > 1) { fail .Bad("big") }
    return x
  }
  function go() {
    risky(2) !{
      | .Bad(m) :> { @msg = m }
      | .Worse :> { @msg = "w" }
    }
  }
}
<button onclick=go()>go</>
<p>\${@msg}</>`, "handler");
    expect(r.codes).toEqual([]);
  });
});

describe("rawArmHasLeadingPipeArm (per split arm)", () => {
  const cases = [
    [`| 1 :> "one"`, true],
    [`1 :> "one" | 2 :> "two"`, true],
    [`1 :> "one" | - 2 :> "two"`, true],
    [`. A | . B :> "x"`, false], // the head's own alternation
    [`"a" | "b" :> "x"`, false],
    [`"a" :> x | y`, false], // a bitwise `|` in a body (no arm arrow after it)
    [`"a" :> p || q`, false],
    [`| _ :> "z"`, false], // the §18.19 wildcard divergence
    [`| else :> "z"`, false],
  ];
  for (const [s, want] of cases) test(s, () => expect(rawArmHasLeadingPipeArm(s)).toBe(want));
});
