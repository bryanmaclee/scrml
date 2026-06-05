// native-lift-markup-closetag-span.test.js — native-parser swap parity-closer.
//
// REGRESSION GUARD for the markup-as-value CLOSE-TAG span under-reach
// (change-id native-lift-markup-closetag-span-2026-06-04).
//
// SYMPTOM (pre-fix): a NON-self-closing markup element used as a VALUE in
// expression position (a `lift <li>x</li>` arg, `const <x> = <tag>...</tag>`,
// etc.) failed under `--parser=scrml-native` with E-STMT-MISSING-SEMICOLON +
// E-STMT-UNCLOSED-BLOCK, while the default pipeline compiled clean. The
// self-closing form `lift <li/>` worked.
//
// ROOT (two coupled defects, both fixed in this change):
//   1. The native lexer eagerly tokenizes the whole `${...}` code body —
//      INCLUDING the inline markup-value bytes. The `/` of a `</tag>` closer
//      immediately follows a `<` (LessThan); regexAllowedAfter(LessThan) is
//      true so `/li>; }}` lexed as ONE runaway RegexLit to EOF, destroying
//      the token stream advancePastSourcePos must resync onto. Fix
//      (lex-in-code.js): a `/` SOURCE-ADJACENT to a preceding `<` is the
//      `</` close-tag -> division, not a regex. A genuine `a < /re/` has a
//      gap so its `<` is not adjacent -> untouched.
//   2. The M6.2a MarkupValue->live bridge passed source="" so child Text /
//      Comment content (recovered by slicing the span) rendered EMPTY — the
//      `x` in `<li>x</li>` was silently dropped. Fix (parse-expr.js +
//      translate-stmt.js): the markup-value SLICE SOURCE is threaded onto the
//      MarkupValue node + through synthLiveChildren so child text recovers.
//
// GATE: native output must be BYTE-IDENTICAL to the default pipeline (the
// R26 byte-parity gate) across single / nested / interpolation / with-attrs
// shapes, with zero E-STMT-MISSING-SEMICOLON / E-STMT-UNCLOSED-BLOCK and a
// `node --check`-valid client.js. The self-closing case must STAY working.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

// compileWith — compile `source` under `parser` (null = default live BS+TAB;
// "scrml-native" = native pipeline). Returns errors + warnings + client.js text.
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-closetag-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function stmtErrors(errors) {
  return errors.filter(
    (e) =>
      e.code === "E-STMT-MISSING-SEMICOLON" || e.code === "E-STMT-UNCLOSED-BLOCK",
  );
}

// findLiftExpr — deep generic search of a native FileAST for the first
// lift-expr node (the `lift <li>x</li>` sits inside a for-statement body
// inside a logic block, so a shape-specific walk would miss it).
function findLiftExpr(ast) {
  const seen = new Set();
  function walk(o) {
    if (o === null || typeof o !== "object" || seen.has(o)) return null;
    seen.add(o);
    if (o.kind === "lift-expr") return o;
    for (const k of Object.keys(o)) {
      if (k === "parent") continue;
      const r = walk(o[k]);
      if (r) return r;
    }
    return null;
  }
  return walk(ast);
}

// The shapes the brief mandates: single (paired close-tag), nested, with
// interpolation, with attrs. Each is a Tier-0 `${ for ... lift ... }` so the
// markup-as-value sits in a real code body (the symptom site).
const SINGLE = [
  "<program>",
  "<xs>: string[] = []",
  "<ul>${ for (let c of @xs) { lift <li>x</li>; } }</ul>",
  "</program>",
].join("\n");

const NESTED = [
  "<program>",
  "<xs>: string[] = []",
  "<ul>${ for (let c of @xs) { lift <li><span>x</span></li>; } }</ul>",
  "</program>",
].join("\n");

const INTERP = [
  "<program>",
  "<xs>: string[] = []",
  "<ul>${ for (let c of @xs) { lift <li>${c}</li>; } }</ul>",
  "</program>",
].join("\n");

const WITH_ATTRS = [
  "<program>",
  "<xs>: string[] = []",
  "<ul>${ for (let c of @xs) { lift <li class=\"row\">x</li>; } }</ul>",
  "</program>",
].join("\n");

// Self-closing — the case that ALREADY worked; must STAY working (no regress).
const SELF_CLOSING = [
  "<program>",
  "<xs>: string[] = []",
  "<ul>${ for (let c of @xs) { lift <li/>; } }</ul>",
  "</program>",
].join("\n");

describe("native markup-as-value close-tag span — R26 byte-parity", () => {
  const shapes = [
    ["single paired", SINGLE, "single"],
    ["nested element", NESTED, "nested"],
    ["with interpolation", INTERP, "interp"],
    ["with attrs", WITH_ATTRS, "attrs"],
    ["self-closing (must stay working)", SELF_CLOSING, "selfclose"],
  ];

  for (const [label, src, suffix] of shapes) {
    test(`${label}: native compiles clean — zero E-STMT-MISSING-SEMICOLON / E-STMT-UNCLOSED-BLOCK`, () => {
      const nat = compileWith(src, "scrml-native", suffix);
      expect(stmtErrors(nat.errors)).toEqual([]);
      // No fatal errors at all (the markup-as-value parses + emits).
      expect(nat.errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
    });

    test(`${label}: native client.js is byte-identical to default (R26 byte-parity)`, () => {
      const def = compileWith(src, null, `${suffix}-d`);
      const nat = compileWith(src, "scrml-native", `${suffix}-n`);
      expect(nat.clientJs.length).toBeGreaterThan(0);
      expect(nat.clientJs).toBe(def.clientJs);
    });
  }

  test("single paired: child text content `x` is RECOVERED on the lift markup node (not dropped)", () => {
    const ast = nativeParseFile("/closetag/single.scrml", SINGLE).ast;
    const lift = findLiftExpr(ast);
    expect(lift).not.toBeNull();
    expect(lift.expr.kind).toBe("markup");
    expect(lift.expr.node.tag).toBe("li");
    // The `x` Text child must carry its verbatim value (pre-fix: empty "").
    const textChild = (lift.expr.node.children || []).find(
      (c) => c && (c.kind === "text" || c.kind === "Text"),
    );
    expect(textChild).toBeDefined();
    const value = textChild.value ?? textChild.text ?? "";
    expect(value).toContain("x");
  });

  test("nested: outer `<li>` reaches its OWN close, inner `<span>x</span>` nested + child text recovered", () => {
    const ast = nativeParseFile("/closetag/nested.scrml", NESTED).ast;
    const lift = findLiftExpr(ast);
    expect(lift).not.toBeNull();
    expect(lift.expr.node.tag).toBe("li");
    const innerSpan = (lift.expr.node.children || []).find(
      (c) => c && c.kind === "markup" && c.tag === "span",
    );
    expect(innerSpan).toBeDefined();
    const innerText = (innerSpan.children || []).find(
      (c) => c && (c.kind === "text" || c.kind === "Text"),
    );
    expect(innerText).toBeDefined();
    expect((innerText.value ?? innerText.text ?? "")).toContain("x");
  });
});
