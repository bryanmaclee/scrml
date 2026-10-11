/* SPDX-License-Identifier: MIT
 *
 * Unit — S462 s462-braceless-if-else-dropped, review round 2 (S465), finding 1.
 *
 * ⚑ AN if/else EVENT HANDLER CALLED A RUNTIME HELPER THE BUILD DID NOT SHIP.
 *
 *     <o> = { a: { b: 1 } }
 *     <button onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>
 *
 * compiled at exit 0 to a client.js that calls `_scrml_deep_set(...)`, while no output
 * file defined it → `ReferenceError` on every click. The s462 fix lowers a one-line
 * if/else handler through its parsed statement list (`attr.value.handlerBlock.stmts`,
 * ast-builder attachHandlerStatementList), and the runtime-chunk walk in
 * `emit-client.ts` `detectRuntimeChunks` never visited a handler statement list — so the
 * `reactive-nested-assign` → `utilities` trigger never fired. The same hole broke the
 * pre-existing multi-line handler and `;`-sequence handler (`{ @r = "s"; @o.a.b = 5 }`)
 * on base too. The fix walks every attribute's handler statement list like a function
 * body.
 *
 * The guard here is GROUND TRUTH over the emitted files, independent of which chunk
 * trigger a shape takes: every `_scrml_*(` call in `*.client.js` must have a definition
 * in a shipped `.js` file (the runtime chunk bundle or the client itself). A call behind
 * a `typeof _scrml_x === "function"` guard is exempt — that is the deliberate optional-
 * helper idiom, not a dangling reference. Execution of the same shapes is pinned in
 * `compiler/tests/browser/browser-handler-if-else-helpers-s462.browser.test.js`.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = mkdtempSync(join(tmpdir(), "s462-handler-helpers-"));

function build(source, name) {
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source);
  const outDir = join(TMP, `${name}.dist`);
  const r = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, verbose: false, log: () => {} });
  const errors = (r.errors || []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const files = {};
  try {
    for (const f of readdirSync(outDir)) if (f.endsWith(".js")) files[f] = readFileSync(join(outDir, f), "utf8");
  } catch { /* no artifact */ }
  return { errors, files };
}

/** Names a set of JS sources DEFINES (declarations, assignments, destructuring, params). */
export function definedScrmlNames(all) {
  const defs = new Set();
  const add = (re, g = 1) => { for (const m of all.matchAll(re)) defs.add(m[g]); };
  add(/(?:function\*?\s+|(?:const|let|var)\s+|class\s+)(_scrml_\w+)/g);
  add(/(?:^|[\s;,{(])(_scrml_\w+)\s*=(?!=)/gm);
  for (const re of [/(?:const|let|var)\s*\{([^}]*)\}/g, /function\s*\w*\s*\(([^)]*)\)/g, /\(([^()]*)\)\s*=>/g]) {
    for (const m of all.matchAll(re)) for (const n of m[1].matchAll(/(_scrml_\w+)/g)) defs.add(n[1]);
  }
  return defs;
}

/** `_scrml_*(` calls in the client bundle(s) with no shipped definition. */
export function undefinedHelperCalls(files) {
  const all = Object.values(files).join("\n");
  const defs = definedScrmlNames(all);
  const guarded = new Set([...all.matchAll(/typeof\s+(_scrml_\w+)/g)].map((m) => m[1]));
  const missing = new Set();
  for (const [name, src] of Object.entries(files)) {
    if (!name.endsWith(".client.js")) continue;
    for (const m of src.matchAll(/(?<![\w.$])(_scrml_\w+)\s*\(/g)) {
      if (!defs.has(m[1]) && !guarded.has(m[1])) missing.add(m[1]);
    }
  }
  return [...missing].sort();
}

const TOG = `<button id="tog" onclick={ @c = !@c }>tog</button>\n`;
const O = `<c> = true\n<o> = { a: { b: 1 } }\n`;
const P = `<p id="o">\${@o.a.b}</p>\n`;
const D = `<c> = true\n<o> = { a: 1 }\n<q> = { a: 1 }\n<xs> = [1, 2]\n<r> = "-"\ntype Col:enum = { Red, Blue }\n<col>: Col = .Red\n`;
const OUT = `<p id="o">\${@r}|\${@xs.length}|\${@o.a}</p>\n`;

// The s462 handler fixtures: every handler-statement-list spelling × the helper families
// an if/else handler can emit (deep set, index set, structural ==, match, spread,
// compound assign, `?.`, `is .Variant`, delete).
export const FIXTURES = [
  ["deepset-oneline", O + `<button id="b" onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button>\n` + TOG + P],
  ["deepset-braceless", O + `<button id="b" onclick={ if (@c) @o.a.b = 5 else @o.a.b = 9 }>b</button>\n` + TOG + P],
  ["deepset-dollar", O + `<button id="b" onclick=\${ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button>\n` + TOG + P],
  ["deepset-multiline", O + `<button id="b" onclick={\n  if (@c) {\n    @o.a.b = 5\n  } else {\n    @o.a.b = 9\n  }\n}>b</button>\n` + TOG + P],
  ["deepset-program", `<program>\n` + O + `<button id="b" onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button>\n` + TOG + P + `</program>\n`],
  ["deepset-semiseq", O + `<r> = "-"\n<button id="b" onclick={ @r = "s"; @o.a.b = 5 }>b</button>\n` + TOG + `<p id="o">\${@o.a.b}\${@r}</p>\n`],
  ["deepset-p2x", `<c> = true\n<p2> = { x: 1 }\n<button id="b" onclick={ if (@c) { @p2.x = 5 } else { @p2.x = 9 } }>b</button>\n` + TOG + `<p id="o">\${@p2.x}</p>\n`],
  ["deepset-index", `<c> = true\n<xs> = [1, 2]\n<button id="b" onclick={ if (@c) { @xs[0] = 9 } else { @xs[0] = 4 } }>b</button>\n` + TOG + `<p id="o">\${@xs[0]}</p>\n`],
  ["deepset-each-row", `<c> = true\n<rows> = [{ id: 1, v: 0 }]\n<ul><each in=@rows key=@.id as r><li><button id="b" onclick={ if (@c) { @rows[0].v = 5 } else { @rows[0].v = 9 } }>\${r.v}</button></li></each></ul>\n` + TOG + `<p id="o">\${@rows[0].v}</p>\n`],
  ["h-struct-eq", D + `<button id="b" onclick={ if (@c) { @r = String(@o == @q) } else { @r = String(@o != @q) } }>b</button>\n` + TOG + OUT],
  ["h-match", D + `<button id="b" onclick={ if (@c) { @r = match @col { .Red :> "R" .Blue :> "B" } } else { @r = "n" } }>b</button>\n` + TOG + OUT],
  ["h-index-set", D + `<button id="b" onclick={ if (@c) { @xs[0] = 9; @r = String(@xs[0]) } else { @r = "n" } }>b</button>\n` + TOG + OUT],
  ["h-spread", D + `<button id="b" onclick={ if (@c) { @xs = [...@xs, 3] } else { @xs = @xs.slice(1) } }>b</button>\n` + TOG + OUT],
  ["h-compound", D + `<button id="b" onclick={ if (@c) { @o.a += 2 } else { @o.a -= 1 } }>b</button>\n` + TOG + OUT],
  ["h-optional", D + `<button id="b" onclick={ if (@c) { @r = String(@o?.a ?? 0) } else { @r = "n" } }>b</button>\n` + TOG + OUT],
  ["h-is-variant", D + `<button id="b" onclick={ if (@col is .Red) { @r = "red" } else { @r = "nr" } }>b</button>\n` + TOG + OUT],
  ["h-delete", D + `<button id="b" onclick={ if (@c) { delete @o.a } else { @o = { a: 4 } } }>b</button>\n` + TOG + OUT],
];

describe("S462 r2 — every runtime helper an if/else handler calls is shipped", () => {
  for (const [name, src] of FIXTURES) {
    test(name, () => {
      const { errors, files } = build(src, name);
      expect(errors).toEqual([]);
      expect(Object.keys(files).some((f) => f.endsWith(".client.js"))).toBe(true);
      expect(undefinedHelperCalls(files)).toEqual([]);
    });
  }

  // Review round 2, finding 2 — §14.10 ("a previously-declared cell or local with a known
  // type") + §66.3 rule 5(a) ("a QUALIFIED unit variant `E.V` … is a literal of `E`"):
  // `<col> = Col.Red` types the cell `Col`, so `@col = .Blue` resolves on every path.
  // Executed in browser-handler-if-else-helpers-s462.browser.test.js.
  const EN = `type Col:enum = { Red, Blue }\n<c> = true\n<col> = Col.Red\n`;
  for (const [label, body] of [
    ["en-handler-oneline", `<button id="b" onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n`],
    ["en-handler-multiline", `<button id="b" onclick={\n  if (@c) {\n    @col = .Blue\n  } else {\n    @col = .Red\n  }\n}>b</button>\n`],
    ["en-fn-body", `\${ function go() { if (@c) { @col = .Blue } else { @col = .Red } } }\n<button id="b" onclick=go()>b</button>\n`],
    ["en-fn-body-single", `\${ function go() { @col = .Blue } }\n<button id="b" onclick=go()>b</button>\n`],
  ]) {
    test(`${label}: an unannotated qualified-variant cell gives a bare variant its type`, () => {
      const { errors, files } = build(EN + body + `<p id="o">\${@col}</p>\n`, label);
      expect(errors).toEqual([]);
      expect(undefinedHelperCalls(files)).toEqual([]);
    });
  }
  test("en: a variant `Col` does not declare is E-TYPE-063; a string-initialised cell stays E-VARIANT-AMBIGUOUS", () => {
    expect(build(EN + `<button onclick={ if (@c) { @col = .Green } else { @col = .Red } }>b</button>\n`, "en-wrong").errors)
      .toContain("E-TYPE-063");
    expect(build(`<c> = true\n<col> = "Red"\n<button onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n`, "en-str").errors)
      .toContain("E-VARIANT-AMBIGUOUS");
  });

  test("the guard itself catches a dangling helper call (control)", () => {
    const files = {
      "x.client.js": "_scrml_deep_set(_scrml_reactive_get(\"o\"), [\"a\"], 1);\nif (typeof _scrml_opt === \"function\") _scrml_opt();\n",
      "rt.js": "function _scrml_reactive_get(n) { return n; }\n",
    };
    expect(undefinedHelperCalls(files)).toEqual(["_scrml_deep_set"]);
  });
});
