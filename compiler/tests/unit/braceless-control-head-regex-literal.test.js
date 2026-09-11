/* SPDX-License-Identifier: MIT
 *
 * Unit — g-unbraced-if-for-body-regex-padded-escapes-dropped (S412).
 *
 * A `)` ends a value only when it closes an EXPRESSION. `(a + b) / 2` and `f(x) / 2`
 * are division, but `if (c) /re/.test(c)` is a regex in statement position — and both
 * of the compiler's two independent regex-vs-division heuristics treated `)` as
 * unconditional division:
 *
 *   · `tokenizer.ts` `isRegexContext`      — `)` → division, so the `/` lexed as PUNCT
 *   · `code-segments.ts` `regexAllowedAfter` — `)` → division (plus `else`/`do`/`finally`)
 *
 * The tokenizer's miss is the one that bit. With the `/` lexed as PUNCT, the regex body
 * lexed as ordinary code tokens, and a BRACELESS `if`/`for` body — which is rebuilt by
 * re-joining tokens, unlike a braced body that keeps its source slice — came back out
 * space-padded with its backslash escapes dropped. Whitespace and `\` are SIGNIFICANT
 * inside a regex literal, so that is a DIFFERENT regex, at exit 0 with zero diagnostics:
 *
 *     if (c) /a\sb/.test(c)    emitted   / a sb /.test(c)     the `\s` class gone
 *     if (c) /[a-z]/.test(c)   emitted   / [ a - z ] /        now matches a space
 *     if (c) /a+b/.test(c)     emitted   / a + b /            `+` quantifies a space
 *
 * Both heuristics now walk back to the matching `(` and ask what opened it, against ONE
 * shared keyword set (`REGEX_AFTER_CLOSE_PAREN_KEYWORDS`) so they cannot drift about
 * which constructs count — they must agree, because one decides whether the regex
 * survives tokenization and the other whether the §59 map-literal preprocessor may walk
 * into its interior.
 *
 * ⚑ THE ENTRY'S COUPLING PREDICTION DID NOT HOLD, AND THE NEGATIVES BELOW PIN THAT.
 * It predicted that repairing the tokenizer would UNMASK the §59 mislowering
 * (`g-regex-char-class-colon-mislowered-as-map-literal`, the S406 82 GB lockup) in the
 * contexts `regexAllowedAfter` misses. Measured after the repair: it does not — by the
 * time `preprocessMapLiterals` runs, the `if (…)` head is stripped and the `/` is
 * expression-initial. `__scrml_map_lit__` must appear in NONE of these.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { regexAllowedAfter } from "../../src/codegen/code-segments.ts";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
function emit(source, name, mode = "library") {
  TMP = TMP || mkdtempSync(join(tmpdir(), "braceless-rx-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.${mode}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode,
    write: true, verbose: false, log: () => {},
  });
  let js = "";
  try {
    for (const f of readdirSync(outDir)) if (f.endsWith(".js")) js += readFileSync(join(outDir, f), "utf8");
  } catch { /* no artifact */ }
  return { js, errors: r.errors || [] };
}

const ifBody = (re) => `\${\n  export function f(c) {\n    let h = false\n    if (c) ${re}.test(c)\n    return h\n  }\n}`;
const forBody = (re) => `\${\n  export function f(c) {\n    let h = false\n    for (let i = 0; i < 1; i = i + 1) ${re}.test(c)\n    return h\n  }\n}`;

describe("a regex literal after a control-flow head survives intact (S412)", () => {
  for (const [label, re] of [
    ["escape class `/a\\sb/`", "/a\\sb/"],
    ["char class `/[a-z]/`", "/[a-z]/"],
    ["quantifier `/a+b/`", "/a+b/"],
    ["colon in a char class `/[a:b]/`", "/[a:b]/"],
  ]) {
    test(`braceless if — ${label} is byte-preserved`, () => {
      const { js, errors } = emit(ifBody(re), `if-${label.replace(/[^a-z0-9]/gi, "-")}`);
      expect(errors.map((e) => e.code)).toEqual([]);
      expect(js).toContain(re);
    });

    test(`braceless for — ${label} is byte-preserved`, () => {
      const { js, errors } = emit(forBody(re), `for-${label.replace(/[^a-z0-9]/gi, "-")}`);
      expect(errors.map((e) => e.code)).toEqual([]);
      expect(js).toContain(re);
    });
  }

  test("CONTROL — a braced body was never affected and still is not", () => {
    const { js, errors } = emit(
      `\${\n  export function f(c) {\n    let h = false\n    if (c) { /a\\sb/.test(c) }\n    return h\n  }\n}`,
      "braced-control",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toContain("/a\\sb/");
  });

  test("CONTROL — assignment position was never affected", () => {
    const { js } = emit(
      `\${\n  export function f(c) {\n    let r = /a\\sb/\n    return r.test(c)\n  }\n}`,
      "assigned-control",
    );
    expect(js).toContain("/a\\sb/");
  });

  // --- the harmful direction: a DIVISION must not become a regex -----------------
  test("NEGATIVE — a call `)` followed by `/` stays DIVISION", () => {
    const { js, errors } = emit(
      `\${\n  export function f(a, b) {\n    function g(x) { return x }\n    let q = g(a) / b\n    return q\n  }\n}`,
      "call-division",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toMatch(/g\(a\)\s*\/\s*b/);
  });

  test("NEGATIVE — a grouping `)` followed by `/` stays DIVISION", () => {
    const { js, errors } = emit(
      `\${\n  export function f(a, b) {\n    let q = (a + b) / b\n    return q\n  }\n}`,
      "group-division",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toMatch(/\(a \+ b\)\s*\/\s*b/);
  });

  test("⚑ NEGATIVE — the §59 mislowering does NOT unmask (the entry predicted it would)", () => {
    // g-regex-char-class-colon-mislowered-as-map-literal is the S406 82 GB lockup.
    // Repairing the tokenizer was predicted to re-expose it here. It does not.
    for (const [name, src] of [["if", ifBody("/[a:b]/")], ["for", forBody("/[a:b]/")]]) {
      const { js } = emit(src, `no-unmask-${name}`);
      expect(js).not.toContain("__scrml_map_lit__");
    }
  });

  // --- the shared decision function, at the unit level ----------------------------
  describe("regexAllowedAfter — statement position vs division", () => {
    for (const prefix of ["if (c) ", "while (c) ", "for (;;) ", "} else ", "do ", "finally "]) {
      test(`fires after \`${prefix.trim()}\``, () => {
        expect(regexAllowedAfter(prefix)).toBe(true);
      });
    }
    // Word-boundary traps: an identifier that merely STARTS WITH or ENDS IN a keyword.
    for (const prefix of ["f(x) ", "(a + b) ", "g(h(x)) ", "arr[0] ", "x.y ", "1 ",
                          "fif(x) ", "notif(x) ", "elsewhere ", "doThing "]) {
      test(`stays division after \`${prefix.trim()}\``, () => {
        expect(regexAllowedAfter(prefix)).toBe(false);
      });
    }
  });
});
