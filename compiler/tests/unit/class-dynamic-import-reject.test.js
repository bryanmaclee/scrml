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
 * foreign code stay legal. Every case runs through BOTH front-ends: the
 * default pipeline (ast-builder.js) and `--parser=scrml-native`
 * (native-parser/parse-stmt.js + parse-expr.js).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
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
  ["scrml-native", "scrml-native"],
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
  test("scrml-native parser", () => {
    // Line only: the native parser's `^{}` body spans run 2 columns short
    // (pre-existing, independent of this code — its E-AWAIT-NOT-IN-SCRML on
    // the same line is short by the same 2).
    const hits = rejectHits(src, "scrml-native");
    expect(hits.length).toBe(1);
    expect(hits[0].startsWith("E-DYNAMIC-IMPORT-NOT-IN-SCRML@2:")).toBe(true);
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

describe("S430 review probes — both front-ends, exact codes + positions", () => {
  for (const [name, src, def, nat] of S430_REVIEW_PROBES) {
    test(`${name} — default`, () => {
      expect(hitsWithCol(src)).toEqual(def.slice().sort());
    });
    if (nat !== null) {
      test(`${name} — scrml-native`, () => {
        expect(hitsWithCol(src, "scrml-native")).toEqual(nat.slice().sort());
      });
    }
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
  test("an ordinary parse error inside the arrow body", () => {
    const dir = mkdtempSync(join(tmpdir(), "cdireject-f3-"));
    const f = join(dir, "case.scrml");
    writeFileSync(f, src);
    const r = compileScrml({ inputFiles: [f], outputDir: join(dir, "dist"), write: false, log: () => {}, parser: "scrml-native" });
    const got = (r.errors || []).filter((e) => e.code === "E-EXPR-UNEXPECTED")
      .map((e) => `${(e.span || e.tabSpan).line}:${(e.span || e.tabSpan).col}`);
    expect(got).toEqual(["6:20"]);
  });
});

describe("a quoted attribute value is data, not scrml source", () => {
  const src = `<program>\n<button onclick="import('./x.js')">a</button>\n<p title="class Foo extends Bar">b</p>\n</program>`;
  test("default", () => expect(rejectHits(src)).toEqual([]));
  test("scrml-native", () => expect(rejectHits(src, "scrml-native")).toEqual([]));
});

// Attribute values never enter a logic token stream (the E-SWITCH-FORBIDDEN
// bypass shape) — the construct is counted from the parsed attribute expression.
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
