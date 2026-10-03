/**
 * forbidden-js-attr-callref-placement.test.js — S432 F2.
 *
 * An unquoted call-form attribute value (`onclick=go(1,import("x"))`) is a
 * native `call-ref` whose `args` are split and TRIMMED. forbidden-js-native.ts
 * used to rebuild `name(args.join(", "))`, look that text up in the file, and
 * `continue` silently on a miss — so on `--parser=scrml-native` the construct
 * compiled clean (and was emitted), and the default pipeline caught it only
 * through its fallback, at the start of the value instead of the keyword.
 * Positions now come from the value node's span (its verbatim bytes); a value
 * that cannot be placed is reported at the attribute, never skipped.
 *
 * S449: the default pipeline runs this check on the native parser's tree
 * (forbiddenJsDiagnosticsForDefault → nativeForbiddenJsAttrDiagnostics), so the
 * default arm exercises the native function on its production path. The second
 * arm (`--parser=scrml-native`, the retired full-pipeline flag) was dropped.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScrml } from "../../src/api.js";
import { attrExprSource, nativeForbiddenJsAttrDiagnostics } from "../../src/native-walker/forbidden-js-native.ts";

const CODES = ["E-CLASS-NOT-IN-SCRML", "E-DYNAMIC-IMPORT-NOT-IN-SCRML"];

function hits(src) {
  const dir = mkdtempSync(join(tmpdir(), "s432f2-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  const r = compileScrml({
    inputFiles: [f], outputDir: join(dir, "dist"), write: false, log: () => {},
  });
  return [...(r.errors || []), ...(r.warnings || [])]
    .filter((d) => CODES.includes(d.code))
    .map((d) => { const s = d.span || d.tabSpan || {}; return `${d.code}@${s.line}:${s.col}`; });
}

// Line 3 is `<button ` + the attribute, so the value starts at col 17 for an
// `onclick=` attribute.
const btn = (attrs) => `<program>\n\${ function go(a, b, c) { return a } }\n<button ${attrs}>b</button>\n</program>\n`;
const I = "E-DYNAMIC-IMPORT-NOT-IN-SCRML";
const C = "E-CLASS-NOT-IN-SCRML";

const CASES = [
  ["reviewer repro go(1,import(\"x\"))", `onclick=go(1,import("x"))`, [`${I}@3:22`]],
  ["spaced go( import(\"x\") )", `onclick=go( import("x") )`, [`${I}@3:21`]],
  ["tab-spaced", "onclick=go(\timport(\"x\")\t)", [`${I}@3:21`]],
  ["class expression arg go( class { } )", `onclick=go( class { } )`, [`${C}@3:21`]],
  ["named class expression arg", `onclick=go(1, class Foo { })`, [`${C}@3:23`]],
  ["multiple args, irregular spacing", `onclick=go(1,  2 ,import("x"))`, [`${I}@3:27`]],
  ["nested call", `onclick=go(go(1, import("x")), 2)`, [`${I}@3:26`]],
  ["template-literal arg before", "onclick=go(`a${1}`, import(\"x\"))", [`${I}@3:29`]],
  ["import inside a template interpolation", "onclick=go(`a${import(\"x\")}`)", [`${I}@3:24`]],
  ["args across a newline", "onclick=go(1,\n  import(\"x\"))", [`${I}@4:3`]],
  ["a non-handler call-form value", `data-x=go(1,import("x"))`, [`${I}@3:21`]],
  ["second attribute on the line", `onclick=go(1) onmouseover=go(2,import("y"))`, [`${I}@3:40`]],
  ["object-literal arg with class:/import: keys", `onclick=go({ class: 1, import: 2 })`, []],
  ["string args that say import( and class", `onclick=go("import(x)", "class Foo { }")`, []],
  ["member calls .import() / .class", `onclick=go(o.import(1), o.class)`, []],
];

describe("call-form attribute values report at the keyword", () => {
  for (const [name, attrs, want] of CASES) {
    test(`default: ${name}`, () => {
      expect(hits(btn(attrs))).toEqual(want);
    });
  }
});

describe("attrExprSource — placement comes from the node, a miss is loud", () => {
  const source = `<button onclick=go(1,import("x"))>`;
  const start = source.indexOf("go(");
  const end = source.indexOf(">", start);

  test("call-ref: the verbatim bytes at the value span, offset 0", () => {
    const val = { kind: "call-ref", name: "go", args: ["1", "import(\"x\")"], span: { start, end } };
    expect(attrExprSource(val, source)).toEqual({ text: `go(1,import("x"))`, offset: 0 });
  });

  test("call-ref whose span does not hold the call: rebuilt text, unplaceable (-1)", () => {
    const val = { kind: "call-ref", name: "go", args: ["1", "import(\"x\")"], span: { start: 0, end: 5 } };
    expect(attrExprSource(val, source).offset).toBe(-1);
  });

  test("an unplaceable value is reported at the attribute, not skipped", () => {
    const val = { kind: "call-ref", name: "go", args: ["1", "import(\"x\")"], span: { start: 0, end: 5 } };
    const ast = { nodes: [{ kind: "markup", attrs: [{ name: "onclick", value: val }] }] };
    const d = nativeForbiddenJsAttrDiagnostics(ast, source, "f.scrml");
    expect(d.map((x) => `${x.code}@${x.span.start}`)).toEqual([`${I}@0`]);
  });

  test("expr: `${…}` wrapper — raw sits 2 bytes in, even when raw itself starts with `{`", () => {
    const src = "<p data-x=${{ a: 1 }}>";
    const s = src.indexOf("${");
    const val = { kind: "expr", raw: "{ a: 1 }", span: { start: s, end: src.indexOf(">", s) } };
    expect(attrExprSource(val, src)).toEqual({ text: "{ a: 1 }", offset: 2 });
  });
});
