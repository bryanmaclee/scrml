/**
 * class-dynamic-import-reject.test.js — S430 rulings P1 + P4.
 *
 *   - E-CLASS-NOT-IN-SCRML          — a class DECLARATION or class EXPRESSION
 *                                     in scrml logic (SPEC §7.2.1).
 *   - E-DYNAMIC-IMPORT-NOT-IN-SCRML — a dynamic `import(...)` in scrml source,
 *                                     including inside a `^{}` meta body
 *                                     (SPEC §21.3.2; §21.3.1 closes the
 *                                     `^{ await import(...) }` path).
 *
 * bryan, S430 P1: "I really want to reject class. ... but the word is not at
 * fault." So only the CONSTRUCT fires — the HTML `class=` attribute, `class`
 * as an object key / struct field / member name, and anything inside `_{}`
 * foreign code stay legal. Every case runs through the default pipeline,
 * which decides this family on the NATIVE parser's tree
 * (native-walker/forbidden-js-native.ts — native-parser/parse-stmt.js +
 * parse-expr.js), so the native functions are exercised on their production
 * path. (S449: the second front-end arm, `--parser=scrml-native`, was the
 * full-pipeline flag — retired. The native block-body diagnostic case below is
 * re-pointed at `nativeParseFile` directly.)
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CODES = ["E-CLASS-NOT-IN-SCRML", "E-DYNAMIC-IMPORT-NOT-IN-SCRML"];

/** Compile a one-file program; return the two S430 codes it fired, with line:col. */
function rejectHits(src, parser) {
  const dir = mkdtempSync(join(tmpdir(), "cdireject-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  const r = compileScrml({
    inputFiles: [f],
    outputDir: join(dir, "dist"),
    write: false,
    log: () => {},
    ...(parser ? { parser } : {}),
  });
  const diags = [...(r.errors || []), ...(r.warnings || [])];
  return diags
    .filter((d) => CODES.includes(d.code))
    .map((d) => {
      const s = d.span || d.tabSpan || {};
      return `${d.code}@${s.line}:${s.col}`;
    });
}

const PARSERS = [
  ["default", undefined],
];

const prog = (logic) => `<program>\n\${\n${logic}\n}\n<p>x</p>\n</program>`;

const FIRES = [
  ["class X {}", prog("  class X { }"), ["E-CLASS-NOT-IN-SCRML@3:3"]],
  ["export class X {}", prog("  export class X { }"), ["E-CLASS-NOT-IN-SCRML@3:10"]],
  ["export default class {}", prog("  export default class { }"), ["E-CLASS-NOT-IN-SCRML@3:18"]],
  ["class Y extends Z {}", prog("  class Y extends Z { }"), ["E-CLASS-NOT-IN-SCRML@3:3"]],
  ["const C = class {}", prog("  const C = class { }"), ["E-CLASS-NOT-IN-SCRML@3:13"]],
  ["class inside a function body", prog("  function f() { class Q { } return 1 }"), ["E-CLASS-NOT-IN-SCRML@3:18"]],
  ["class inside an exported function body", prog("  export function f() { class Q { } return 1 }"), ["E-CLASS-NOT-IN-SCRML@3:25"]],
  ['import("x")', prog('  import("x")'), ["E-DYNAMIC-IMPORT-NOT-IN-SCRML@3:3"]],
  ["const m = import(p)", prog('  const p = "x"\n  const m = import(p)'), ["E-DYNAMIC-IMPORT-NOT-IN-SCRML@4:13"]],
  ['export const m = import("x")', prog('  export const m = import("x")'), ["E-DYNAMIC-IMPORT-NOT-IN-SCRML@3:20"]],
];

const LEGAL = [
  ['<div class="a">', `<program>\n<div class="a">x</div>\n</program>`],
  ["{ class: 1 } / o.class / o?.class", prog("  const r = { class: 1 }\n  const q = r.class\n  const w = r?.class")],
  ["destructure { class: c } = r", prog("  const r = { class: 1 }\n  const { class: c } = r")],
  ["struct field `class: string`", prog('  type T:struct = { class: string }\n  const t: T = { class: "a" }\n  const k = t.class')],
  ["_{ class X {} } foreign code", `<program>\n_{ class X { } }\n<p>x</p>\n</program>`],
  ["lift <li class=...> in logic", prog('  const items = [1, 2]\n  for (const i of items) { lift <li class="row">\${i}</li> }')],
  ["static import", prog('  import { a } from "./a.scrml"')],
];

for (const [pname, parser] of PARSERS) {
  describe(`S430 P1/P4 rejection fires — ${pname} parser`, () => {
    for (const [name, src, expected] of FIRES) {
      test(`${name} → ${expected.map((e) => e.split("@")[0]).join(", ")}`, () => {
        expect(rejectHits(src, parser)).toEqual(expected);
      });
    }
  });

  describe(`S430 P1/P4 "the word is not at fault" — ${pname} parser`, () => {
    for (const [name, src] of LEGAL) {
      test(`${name} does NOT fire`, () => {
        expect(rejectHits(src, parser)).toEqual([]);
      });
    }
  });
}

// §21.3.1: "Under Approach C, the `^{}` body MUST NOT contain dynamic
// `await import(...)` calls — that path is closed by M6." The meta body is
// therefore NOT a carve-out for this code (it IS one for E-AWAIT-NOT-IN-SCRML
// under §19.9.8's JS-host boundary — a different rule).
describe("§21.3.1 — dynamic import inside a `^{}` meta body fires", () => {
  const src = `<program>\n^{ const m = await import("./x.js") }\n<p>x</p>\n</program>`;
  test("default parser", () => {
    expect(rejectHits(src)).toEqual(["E-DYNAMIC-IMPORT-NOT-IN-SCRML@2:20"]);
  });
});

// ---------------------------------------------------------------------------
// The S430 adversarial-review probe set (rcl/probes, copied inline) + two
// extra probes. Every probe compiles through BOTH front-ends and must report
// EXACTLY the listed codes at EXACTLY the listed line:col — so every legit
// form (markup prose, strings, comments, regex, CSS, SQL, `class=`, `x.class`,
// `{class: 1}`, `import.meta`, `o.import(…)`, quoted HTML attribute values)
// fires nothing, and every true positive fires once, at its keyword.
//
// Native `null` rows: inline `_={ … }=` / `_{ }` foreign code INSIDE a function
// body. The native parser tokenizes that interior (it has no foreign-code
// production there) and already fails those programs on base with parse
// errors, so nothing that compiled breaks; left as a noted gap.
// ---------------------------------------------------------------------------
import { S430_REVIEW_PROBES } from "../helpers/s430-class-import-review-probes.js";

const hitsWithCol = (src, parser) => rejectHits(src, parser).sort();

// S449: the probe table's 4th column (the full-pipeline native expectation) is
// no longer asserted — the `--parser=scrml-native` flag is retired.
describe("S430 review probes — default pipeline, exact codes + positions", () => {
  for (const [name, src, def] of S430_REVIEW_PROBES) {
    test(`${name} — default`, () => {
      expect(hitsWithCol(src)).toEqual(def.slice().sort());
    });
  }
});

// PA decision (S430): a QUOTED HTML attribute value is a string literal emitted
// as data (§5 quoting), not scrml source — `onclick="import('./x.js')"` does not
// fire (SPEC §21.3.2).
// S430 review round 3, F3: a diagnostic inside a block body (an arrow inside a
// `${}` inside lift markup inside a function) is reported ONCE, at its own
// position — the native BlockStub-body errors are collected by the parse that
// owns the stub, in that parse's coordinates (parse-stmt.js parseProgram).
describe("native: a block-body diagnostic is reported once, where it is", () => {
  const src = "<program>\n${\n  function f() {\n    lift <li>${ (() => {\n      const z = 0\n      const q = 1 +;\n      return 1 })() }</li>\n  }\n}\n<p>x</p>\n</program>\n";
  // S449 re-point: was a full compile under `--parser=scrml-native`; the fix
  // lives in native-parser/parse-stmt.js parseProgram, reached here through
  // `nativeParseFile` (the entry impl#1 calls for component / `^{}` / match
  // re-parse).
  test("an ordinary parse error inside the arrow body", () => {
    const r = nativeParseFile("/cdireject-f3/case.scrml", src);
    const got = (r.errors || []).filter((e) => e.code === "E-EXPR-UNEXPECTED")
      .map((e) => `${e.span.line}:${e.span.col}`);
    expect(got).toEqual(["6:20"]);
  });
});

describe("a quoted attribute value is data, not scrml source", () => {
  const src = `<program>\n<button onclick="import('./x.js')">a</button>\n<p title="class Foo extends Bar">b</p>\n</program>`;
  test("default", () => expect(rejectHits(src)).toEqual([]));
});

// Attribute values never enter a logic token stream (the E-SWITCH-FORBIDDEN
// bypass shape) — native-walker/forbidden-js-native.ts parses each attribute
// expression with the native parser (both pipelines).
describe("default parser — attribute-value expressions are scanned", () => {
  test("onclick=${() => import(\"x\")} fires at the keyword", () => {
    const src = `<program>\n<button onclick=\${() => import("x")}>go</button>\n</program>`;
    expect(rejectHits(src)).toEqual(["E-DYNAMIC-IMPORT-NOT-IN-SCRML@2:25"]);
  });
  test("class=\"...\" attribute beside an expression attribute does not fire", () => {
    const src = `<program>\n<button class="b" onclick=\${() => 1}>go</button>\n</program>`;
    expect(rejectHits(src)).toEqual([]);
  });
});
