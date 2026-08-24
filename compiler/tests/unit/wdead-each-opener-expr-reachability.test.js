// ---------------------------------------------------------------------------
// W-DEAD-FUNCTION must not false-fire on a fn referenced ONLY from an `<each>`
// OPENER expression (`in=` / `of=` / `key=` / `if=`)
// (wdead-each-attr-blind-spot-2026-08-24)
// ---------------------------------------------------------------------------
//
// The D4 dead-function gate (route-inference.ts) suppresses on
// `markupReferencedNames`, built by `walkMarkupContext`. That walker reads
// markup ATTRIBUTES off `node.attrs` — which is how `<span if=fn()>` and
// `<span class=${fn()}>` are already covered — plus a fixed
// `EXPR_STRING_FIELDS` union (`expr`/`init`/`condition`/`value`/`test`/
// `header`/`iterable`) for string-typed expression payloads.
//
// An `<each>` opener matches NEITHER. The parser lowers it to an `each-block`
// node that has **no `attrs` array at all**; its opener expressions live in
// bespoke raw-string fields — `inExprRaw` / `ofExprRaw` / `keyExprRaw`, plus
// `ifRaw` for the §17.1.2 render gate — and none of those names is in
// `EXPR_STRING_FIELDS`. So a fn named ONLY there was invisible to the
// suppressor and W-DEAD-FUNCTION false-fired.
//
// It is a CRY-WOLF, not a breakage: the warning says "It will be tree-shaken
// from the output" and that prediction is FALSE — codegen emits the function
// AND calls it, and the app renders. A gate that cries wolf gets bypassed, and
// a bypassed gate gets deleted (pa-base §8), so the fix is owed even though
// nothing miscompiles.
//
// THE OTHER HALF OF THIS FILE IS THE BITE. A fix that silences the warning
// everywhere is worse than the bug, so the genuinely-dead controls below MUST
// keep firing — including a fn that is dead in a file that CONTAINS an
// `<each>`, and a fn whose name appears only in an unrelated `<each>` opener's
// argument-free sibling position.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "wdead-each-opener-"));
writeFileSync(join(TMP, "package.json"), '{"type":"module"}\n');

let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}

// W-DEAD-FUNCTION is a W- prefixed (non-fatal) diagnostic — it partitions into
// result.warnings, NOT result.errors. Scan BOTH streams so a partition shift
// cannot silently pass the assertion.
function deadFnNames(r) {
  const all = [...(r.warnings ?? []), ...(r.errors ?? [])];
  return all
    .filter((d) => (d.code ?? "") === "W-DEAD-FUNCTION")
    .map((d) => {
      const m = String(d.message ?? "").match(/Function `([^`]+)`/);
      return m ? m[1] : "";
    })
    .sort();
}

function clientJs(r) {
  let out = "";
  for (const [, e] of (r.outputs ?? new Map())) {
    if (e && typeof e === "object" && typeof e.clientJs === "string") out += e.clientJs + "\n";
  }
  return out;
}

describe("W-DEAD-FUNCTION — `<each>` opener expressions are reachability roots", () => {
  // -- The four false-positive positions, each measured on the base ---------

  test("`<each in=fn()>` — the collection callee is not dead", () => {
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn onlyInEachIn() { return [\"x\"] }\n" +
      "}\n" +
      "<ul><each in=onlyInEachIn()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  test("`<each of=fn()>` — the count callee is not dead", () => {
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn onlyInEachOf() { return 3 }\n" +
      "}\n" +
      "<ul><each of=onlyInEachOf()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  test("`<each key=fn()>` — the key callee is not dead", () => {
    const r = compile(
      "<program>\n" +
      "<rows> = [\"a\", \"b\"]\n" +
      "${\n" +
      "    fn onlyInKeyAttr() { return \"k\" }\n" +
      "}\n" +
      "<ul><each in=@rows key=onlyInKeyAttr()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  test("`<each if=fn()>` — the §17.1.2 render-gate callee is not dead", () => {
    const r = compile(
      "<program>\n" +
      "<rows> = [\"a\", \"b\"]\n" +
      "${\n" +
      "    fn onlyInEachIf() { return true }\n" +
      "}\n" +
      "<ul><each in=@rows if=onlyInEachIf()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  test("all four opener positions in ONE file — zero W-DEAD-FUNCTION", () => {
    const r = compile(
      "<program>\n" +
      "<rows> = [\"a\", \"b\"]\n" +
      "${\n" +
      "    fn inEachIn()     { return [\"x\"] }\n" +
      "    fn inEachOf()     { return 2 }\n" +
      "    fn inKeyAttr()    { return \"k\" }\n" +
      "    fn inEachIfAttr() { return true }\n" +
      "}\n" +
      "<ul><each in=inEachIn()><li>${@.}</li></each></ul>\n" +
      "<ul><each of=inEachOf()><li>${@.}</li></each></ul>\n" +
      "<ul><each in=@rows key=inKeyAttr()><li>${@.}</li></each></ul>\n" +
      "<ul><each in=@rows if=inEachIfAttr()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  test("a fn named in an `<each in=>` ARGUMENT (not the callee) is also not dead", () => {
    // `in=filterRows(pickDefault())` — `pickDefault` is an argument-position
    // callee. The suppressor is an identifier scan, so both names must land.
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn pickDefault() { return 1 }\n" +
      "    fn filterRows(n) { return [n] }\n" +
      "}\n" +
      "<ul><each in=filterRows(pickDefault())><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  // -- THE BITE: the gate must still fire on genuinely dead functions -------

  test("BITE — a genuinely unused fn in a file that CONTAINS an `<each>` still fires", () => {
    const r = compile(
      "<program>\n" +
      "<rows> = [\"a\", \"b\"]\n" +
      "${\n" +
      "    fn usedInEach()    { return @rows }\n" +
      "    fn genuinelyDead() { return 1 }\n" +
      "}\n" +
      "<ul><each in=usedInEach()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual(["genuinelyDead"]);
  });

  test("BITE — a dead fn in a file with NO `<each>` at all still fires", () => {
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn genuinelyDead() { return 1 }\n" +
      "}\n" +
      "<p>hi</p>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual(["genuinelyDead"]);
  });

  test("BITE — a dead fn whose name merely RESEMBLES an each-opener callee still fires", () => {
    // `rowsFor` is the each callee; `rowsForNothing` is a distinct, dead fn.
    // Guards against a fix that suppresses by substring rather than by token.
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn rowsFor()        { return [1] }\n" +
      "    fn rowsForNothing() { return [2] }\n" +
      "}\n" +
      "<ul><each in=rowsFor()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual(["rowsForNothing"]);
  });

  // -- Non-regression: the positions that ALREADY worked ---------------------

  test("non-regression — plain-markup `if=fn()` and `class=${fn()}` stay silent", () => {
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn inIfAttr()    { return true }\n" +
      "    fn inClassAttr() { return \"cls\" }\n" +
      "}\n" +
      "<span if=inIfAttr()>gated</span>\n" +
      "<span class=${inClassAttr()}>styled</span>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  test("non-regression — a fn called from an `<each>` BODY interpolation stays silent", () => {
    const r = compile(
      "<program>\n" +
      "<rows> = [\"a\", \"b\"]\n" +
      "${\n" +
      "    fn inEachBody() { return \"b\" }\n" +
      "}\n" +
      "<ul><each in=@rows><li>${inEachBody()}</li></each></ul>\n" +
      "</program>\n",
    );
    expect(deadFnNames(r)).toEqual([]);
  });

  // -- The cry-wolf premise itself, pinned ----------------------------------

  test("the warning's own prediction is what makes this cry-wolf: the fn IS emitted and called", () => {
    const r = compile(
      "<program>\n" +
      "${\n" +
      "    fn onlyInEachIn() { return [\"x\"] }\n" +
      "}\n" +
      "<ul><each in=onlyInEachIn()><li>${@.}</li></each></ul>\n" +
      "</program>\n",
    );
    const js = clientJs(r);
    const sites = js.match(/_scrml_onlyInEachIn_\d+/g) ?? [];
    // A declaration AND at least one call site — so "It will be tree-shaken
    // from the output" was never true for this shape.
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(js).toMatch(/function _scrml_onlyInEachIn_\d+\s*\(/);
  });
});
