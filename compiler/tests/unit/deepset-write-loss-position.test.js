// high-deepset-write-loss (2026-06-06) — emit-shape regression.
//
// BUG (HIGH): consecutive dotted-path deep-set writes (`@obj.field = value`,
// AST kind `reactive-nested-assign`) inside a `function` body were SILENTLY
// DROPPED at codegen — exit 0, no diagnostic, lost mutations. The drop rule
// was exactly: a deep-set survived iff it was the FIRST statement of the body;
// any deep-set at position 2+ vanished. The sibling array-mutation form
// (`@arr.push(...)`) had the same consuming-side bug.
//
// Root cause (ast-builder.js:collectExpr depth-0 assignment-boundary check,
// ~L2715): the boundary only broke when peek(1) was `=` / `+=` / `:`. A deep-set
// is `@ident . path = value` (peek(1) is `.`), so no boundary fired and the
// PRECEDING collectExpr-RHS statement greedily swallowed the whole dotted-path
// statement into its own RHS. Fix: recognize the dotted-path reactive forms
// (`@obj.path = val` deep-set + `@arr.method(...)` array-mutation) as a
// statement boundary at EVERY body position via a forward-scan of the
// `(.ident)+` chain that confirms statement termination.
//
// This is the S139/S140 "emit-string-only test masks runtime miscompiles" lower
// bound — the runtime acceptance proof lives in
// compiler/tests/browser/browser-deepset-write-loss.test.js. This file asserts
// the EMIT SHAPE: the right number of _scrml_deep_set(...) calls survive with
// the right path + value, in source order, for every row of the position matrix.

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compile(scrmlSource) {
  const tag = `ds-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_deepset_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    let clientJs = "";
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? "";
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Extract the body of the generated `_scrml_multi_*()` function.
function multiBody(clientJs) {
  const m = clientJs.match(/function _scrml_multi_\d+\(\)\s*\{([\s\S]*?)\n\}/);
  return m ? m[1] : null;
}

// Build a single-file program whose `multi()` body is the given statement list.
// `deep` = `@a.ref = "<val>"` ; `scalar` = `@c = <n>` ; `arr` = `@arr.push(<n>)`.
//
// FORM NOTE: `<a>` is a FLAT object cell `{ ref: "" }`, NOT a structural compound
// (`<a> <ref>="" </>`). This test's concern is the S167 STATEMENT-SURVIVAL fix
// (a deep-set / array-mutation at body position 2+ must not be swallowed by the
// preceding statement's collectExpr-RHS) — orthogonal to the cell's storage
// shape. A flat object cell keeps the canonical
// `_scrml_deep_set(_scrml_reactive_get("a"), ["ref"], v)` shape these rows
// assert. (A STRUCTURAL COMPOUND would correctly retarget the backing leaf
// `a.ref` per Bug B / SPEC §6.3.2 — covered by structural-compound-deepset.test.js
// — which is a different emit shape and would mask the survival concern here.)
function program(bodyLines) {
  return [
    '<a> = { ref: "" }',
    "<c> = 0",
    "<arr> = []",
    "function multi() {",
    ...bodyLines.map((l) => "    " + l),
    "}",
    "<button onclick=multi()>go</button>",
    "<p>${@c} ${@a.ref}</p>",
  ].join("\n") + "\n";
}

describe("high-deepset-write-loss — deep-set survives at every body position (emit shape)", () => {
  // The exact 8-row trigger matrix from the bug characterization. Pre-fix, every
  // deep-set at position 2+ was dropped. Each row asserts the surviving
  // _scrml_deep_set count + ordered values.
  const matrix = [
    { name: "[deep]",                lines: ['@a.ref = "p"'],                                    deepVals: ["p"] },
    { name: "[deep,deep]",           lines: ['@a.ref = "p"', '@a.ref = "q"'],                    deepVals: ["p", "q"] },
    { name: "[scalar,deep]",         lines: ["@c = 1", '@a.ref = "p"'],                          deepVals: ["p"] },
    { name: "[deep,scalar]",         lines: ['@a.ref = "p"', "@c = 1"],                          deepVals: ["p"] },
    { name: "[scalar,scalar,deep]",  lines: ["@c = 1", "@c = 2", '@a.ref = "p"'],                deepVals: ["p"] },
    { name: "[deep,deep,deep]",      lines: ['@a.ref = "p"', '@a.ref = "q"', '@a.ref = "r"'],    deepVals: ["p", "q", "r"] },
    { name: "[scalar,deep,scalar]",  lines: ["@c = 1", '@a.ref = "p"', "@c = 2"],                deepVals: ["p"] },
    { name: "[deep,deep,scalar]",    lines: ['@a.ref = "p"', '@a.ref = "q"', "@c = 1"],          deepVals: ["p", "q"] },
  ];

  for (const { name, lines, deepVals } of matrix) {
    test(`${name}: every deep-set survives codegen`, () => {
      const r = compile(program(lines));
      expect(r.errors).toHaveLength(0);
      const body = multiBody(r.clientJs);
      expect(body).not.toBeNull();

      // Count surviving deep-sets.
      const deepSetCalls = body.match(/_scrml_deep_set\(/g) ?? [];
      expect(deepSetCalls.length).toBe(deepVals.length);

      // Each deep-set emits the canonical reactive-set-of-deep-set shape with
      // the right path + value, in source order.
      for (const v of deepVals) {
        expect(body).toContain(
          `_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "${v}"))`,
        );
      }
      // Order check: the deep-set values appear in the same order as authored.
      const seen = [...body.matchAll(/_scrml_deep_set\(_scrml_reactive_get\("a"\), \["ref"\], "([^"]+)"\)/g)].map(
        (mm) => mm[1],
      );
      expect(seen).toEqual(deepVals);

      // No statement-boundary drop warning should have fired.
      const dropWarn = (r.warnings ?? []).find((w) =>
        String(w.message ?? "").includes("statement boundary not detected"),
      );
      expect(dropWarn).toBeUndefined();
    });
  }

  test("canonical repro: @c=1; @a.ref=p; @c=2; @a.ref=q — all four statements emit in order", () => {
    const r = compile(program(["@c = 1", '@a.ref = "p"', "@c = 2", '@a.ref = "q"']));
    expect(r.errors).toHaveLength(0);
    const body = multiBody(r.clientJs);
    expect(body).not.toBeNull();
    // Pre-fix body was ONLY the two scalar sets; both deep-sets vanished.
    expect(body).toContain('_scrml_reactive_set("c", 1)');
    expect(body).toContain('_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "p"))');
    expect(body).toContain('_scrml_reactive_set("c", 2)');
    expect(body).toContain('_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "q"))');
    expect((body.match(/_scrml_deep_set\(/g) ?? []).length).toBe(2);
  });

  test("RHS operand read is NOT mis-split: @y = @x.prop collects @x.prop as the value", () => {
    // The fix's `lastPart !== "="` guard must preserve legitimate operand reads:
    // `@y = @x.prop` is a SINGLE statement whose RHS is `@x.prop`, NOT a deep-set
    // statement boundary. Regression guard against over-eager breaking.
    const src = [
      "<x>",
      "    <prop> = 0",
      "</>",
      "<y> = 0",
      "function multi() {",
      "    @y = @x.prop",
      "}",
      "<button onclick=multi()>go</button>",
    ].join("\n") + "\n";
    const r = compile(src);
    expect(r.errors).toHaveLength(0);
    const body = multiBody(r.clientJs);
    expect(body).not.toBeNull();
    // It is a `@y = ...` set whose RHS reads @x.prop — NOT a deep-set on @x.
    expect(body).toContain('_scrml_reactive_set("y"');
    expect(body).not.toContain("_scrml_deep_set(");
  });
});

describe("high-deepset-write-loss — array-mutation sibling survives at every position (emit shape)", () => {
  function pushBody(clientJs) {
    return multiBody(clientJs);
  }

  const matrix = [
    { name: "[arr]",            lines: ["@arr.push(5)"],                pushVals: ["5"] },
    { name: "[scalar,arr]",     lines: ["@c = 1", "@arr.push(5)"],      pushVals: ["5"] },
    { name: "[arr,arr]",        lines: ["@arr.push(5)", "@arr.push(6)"], pushVals: ["5", "6"] },
    { name: "[arr,scalar]",     lines: ["@arr.push(5)", "@c = 1"],      pushVals: ["5"] },
    { name: "[deep,arr]",       lines: ['@a.ref = "p"', "@arr.push(5)"], pushVals: ["5"] },
    { name: "[scalar,deep,arr]", lines: ["@c = 1", '@a.ref = "p"', "@arr.push(5)"], pushVals: ["5"] },
  ];

  for (const { name, lines, pushVals } of matrix) {
    test(`${name}: every @arr.push survives codegen`, () => {
      const r = compile(program(lines));
      expect(r.errors).toHaveLength(0);
      const body = pushBody(r.clientJs);
      expect(body).not.toBeNull();
      // Array mutations lower to `_scrml_reactive_get("arr").push(N); ...`. Assert
      // the surviving push count matches AND each pushed value appears in source
      // order. Pre-fix, a position-2+ array-mutation was swallowed whole.
      const pushCalls = [...body.matchAll(/_scrml_reactive_get\("arr"\)\.push\(([^)]*)\)/g)].map((m) => m[1]);
      expect(pushCalls).toEqual(pushVals);
      // The pre-fix bug swallowed a position-2+ array-mutation into the
      // preceding statement's RHS — verify no statement-boundary drop warning.
      const dropWarn = (r.warnings ?? []).find((w) =>
        String(w.message ?? "").includes("statement boundary not detected"),
      );
      expect(dropWarn).toBeUndefined();
    });
  }
});
