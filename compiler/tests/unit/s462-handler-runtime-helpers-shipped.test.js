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
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "fs";
import {
  RUNTIME_CHUNKS,
  RUNTIME_HELPER_DEFINING_CHUNK,
  RUNTIME_HELPER_AMBIGUOUS,
  chunksForEmittedHelpers,
} from "../../src/codegen/runtime-chunks.ts";
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
    // Comments are not calls: an emitted diagnostic comment such as
    // `// client cannot evaluate _scrml_sql (E-CG-006)` must not read as one. Strips
    // `//` comments that start a line or follow whitespace / `;` `{` `}` (never the
    // `//` of a `https://` string) and `/* … */` blocks.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}])\/\/[^\n]*/g, "$1");
    for (const m of code.matchAll(/(?<![\w.$])(_scrml_\w+)\s*\(/g)) {
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

// Review round 3 (S465), finding 1 — the same handlers inside a `<match>` block arm. An arm
// body is `armsRaw` TEXT at TAB and only becomes AST in emit-match `buildMatchArms`, so the
// chunk walk (which text-probed `armsRaw` for `<each` and nothing else) never saw an arm's
// handler statement lists. Fixed by walking the lowered arm bodies (`matchBlockArmBodies`).
const MC = `type Col:enum = { Red, Blue }\n<col>: Col = .Red\n<c> = true\n<o> = { a: { b: 1 } }\n`;
const MH = `onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }`;
const mArm = (red, open = `<match on=@col>`) => `${open}\n  <Red>${red}</>\n  <Blue><span>blue</span></>\n</match>\n`;
const mBtn = (h = MH) => `<button id="b" ${h}>b</button>`;
export const MATCH_FIXTURES = [
  ["m-oneline", MC + mArm(mBtn()) + TOG + P],
  ["m-dollar", MC + mArm(mBtn(`onclick=\${ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }`)) + TOG + P],
  ["m-for-on", MC + mArm(mBtn(), `<match for=Col on=@col>`) + TOG + P],
  ["m-nested-div-section", MC + mArm(`<div><section>${mBtn()}</section></div>`) + TOG + P],
  ["m-braceless", MC + mArm(mBtn(`onclick={ if (@c) @o.a.b = 5 else @o.a.b = 9 }`)) + TOG + P],
  ["m-multiline", MC + mArm(mBtn(`onclick={\n    if (@c) {\n      @o.a.b = 5\n    } else {\n      @o.a.b = 9\n    }\n  }`)) + TOG + P],
  ["m-semiseq", MC + `<r> = "-"\n` + mArm(mBtn(`onclick={ @r = "s"; @o.a.b = 5 }`)) + TOG + P],
  ["m-index", `type Col:enum = { Red, Blue }\n<col>: Col = .Red\n<c> = true\n<xs> = [1, 2]\n` + mArm(mBtn(`onclick={ if (@c) { @xs[0] = 7 } else { @xs[0] = 4 } }`)) + TOG + `<p id="o">\${@xs[0]}</p>\n`],
  ["m-shorthand-arm", MC + `<match on=@col>\n  <Red> : ${mBtn()}\n  <Blue> : <span>blue</span>\n</match>\n` + TOG + P],
  ["m-each-bearing-arm", MC + `<rows> = [1]\n` + mArm(`<ul><each in=@rows as r><li>\${r}</li></each></ul>${mBtn()}`) + TOG + P],
  ["m-in-component", MC + `const Panel = <div>\n${mArm(mBtn())}</div>\n<Panel/>\n` + TOG + P],
  ["m-in-engine-arm", `type Phase:enum = { Idle, Active }\n` + MC + `<program>\n<engine for=Phase initial=.Active>\n  <Idle rule=.Active><p>idle</p></>\n  <Active rule=.Idle>${mArm(mBtn())}</>\n</>\n` + TOG + P + `</program>\n`],
  ["m-match-in-match", MC + `<match on=@col>\n  <Red>${mArm(mBtn())}</>\n  <Blue><span>blue</span></>\n</match>\n` + TOG + P],
];

// Round 3 sweep — the OTHER bodies that are raw text until emit time and are re-parsed to
// statement ASTs there (emit-engine `parseEngineSynthLogicBody`): an engine `(state ×
// message)` arm body and the opener `effect=` body. Both dangled `_scrml_deep_set` on base.
// (The remaining emit-time re-parses — `!{}` arm handlers incl. nested, engine `:` shorthand
// arms, match-statement arms, `parseExprToNode` expression re-parses — emit no chunk helper
// the walk misses; pinned here so a future lowering change cannot regress silently.)
const ENG = `<program>\n\${\n  type Ph:enum = { Idle, Busy }\n  type Msg:enum = { Go, Stop }\n}\n` + O;
const ERRF = `\${\n  type LoadError:enum = { Bad }\n  function risky() ! LoadError { fail LoadError.Bad }\n}\n`;
export const DEFERRED_BODY_FIXTURES = [
  ["engine-message-arm", ENG + `<engine for=Ph initial=.Idle accepts=Msg>\n  <Idle rule=.Busy>\n    | .Go :> { @o.a.b = 5; .Busy }\n    | _ :> @ph\n    <p>idle</p>\n  </>\n  <Busy rule=.Idle>\n    | .Stop :> .Idle\n    | _ :> @ph\n    <p>busy</p>\n  </>\n</>\n<button id="b" onclick=@ph.advance(.Go)>b</button>\n` + P + `</program>\n`],
  ["engine-opener-effect", ENG + `<engine for=Ph initial=.Idle effect=\${\n    @o.a.b = 5\n}>\n  <Idle rule=.Busy><p>idle</p></>\n  <Busy rule=.Idle><p>busy</p></>\n</>\n` + P + `</program>\n`],
  ["engine-shorthand-arm", ENG + `<engine for=Ph initial=.Idle>\n  <Idle rule=.Busy> : ${mBtn()}\n  <Busy rule=.Idle><p>busy</p></>\n</>\n` + TOG + P + `</program>\n`],
  ["guard-arm-fn", O + ERRF + `\${ function go() { const r = risky() !{ | e :> { @o.a.b = 5 } } } }\n<button id="b" onclick=go()>b</button>\n` + P],
  ["guard-arm-nested", O + ERRF + `\${ function go() { const r = risky() !{ | e :> { const q = risky() !{ | f :> { @o.a.b = 7 } } } } } }\n<button id="b" onclick=go()>b</button>\n` + P],
  ["guard-arm-handler", O + ERRF + `<button id="b" onclick={ const r = risky() !{ | e :> { @o.a.b = 5 } } }>b</button>\n` + P],
  ["match-stmt-arms", MC + `\${ function go() { match @col { .Red :> { @o.a.b = 5 } .Blue :> { @o.a.b = 9 } } } }\n<button id="b" onclick=go()>b</button>\n` + P],
];

describe("S462 r3 — `<match>` arm handlers and emit-time-parsed bodies ship their helpers", () => {
  for (const [name, src] of [...MATCH_FIXTURES, ...DEFERRED_BODY_FIXTURES]) {
    test(name, () => {
      const { errors, files } = build(src, name);
      expect(errors).toEqual([]);
      expect(Object.keys(files).some((f) => f.endsWith(".client.js"))).toBe(true);
      expect(undefinedHelperCalls(files)).toEqual([]);
    });
  }
});

describe("S462 r2 — every runtime helper an if/else handler calls is shipped", () => {
  for (const [name, src] of FIXTURES) {
    test(name, () => {
      const { errors, files } = build(src, name);
      expect(errors).toEqual([]);
      expect(Object.keys(files).some((f) => f.endsWith(".client.js"))).toBe(true);
      expect(undefinedHelperCalls(files)).toEqual([]);
    });
  }

  // Bare-variant writes from an if/else handler (round 3, S465 PA ruling — the round-2
  // enum-context widening for UNANNOTATED cells is REMOVED). §14.10: the resolution source
  // is "a previously-declared cell or local with a known type (`@cell = .V` where
  // `@cell: T`)", and an unannotated `let x = .Small` is E-VARIANT-AMBIGUOUS. So:
  // the annotated cell `<col>: Col = .Red` resolves on every path (handler AND function
  // body); an UNANNOTATED cell is E-VARIANT-AMBIGUOUS on every path — the handler now
  // reports exactly what a function body always did. Executed in
  // browser-handler-if-else-helpers-s462.browser.test.js.
  const FORMS = [
    ["oneline", `<button id="b" onclick={ if (@c) { @col = .Blue } else { @col = .Red } }>b</button>\n`],
    ["braceless", `<button id="b" onclick={ if (@c) @col = .Blue else @col = .Red }>b</button>\n`],
    ["multiline", `<button id="b" onclick={\n  if (@c) {\n    @col = .Blue\n  } else {\n    @col = .Red\n  }\n}>b</button>\n`],
    ["fn-body", `\${ function go() { if (@c) { @col = .Blue } else { @col = .Red } } }\n<button id="b" onclick=go()>b</button>\n`],
    ["fn-body-single", `\${ function go() { @col = .Blue } }\n<button id="b" onclick=go()>b</button>\n`],
  ];
  const ENA = `type Col:enum = { Red, Blue }\n<c> = true\n<col>: Col = .Red\n`;
  const ENU = `type Col:enum = { Red, Blue }\n<c> = true\n<col> = Col.Red\n`;
  for (const [label, body] of FORMS) {
    test(`en-annotated-${label}: \`<col>: Col\` gives a bare variant its type`, () => {
      const { errors, files } = build(ENA + body + `<p id="o">\${@col}</p>\n`, `ena-${label}`);
      expect(errors).toEqual([]);
      expect(undefinedHelperCalls(files)).toEqual([]);
    });
    test(`en-unannotated-${label}: \`<col> = Col.Red\` is no §14.10 context → E-VARIANT-AMBIGUOUS`, () => {
      expect(build(ENU + body + `<p id="o">\${@col}</p>\n`, `enu-${label}`).errors).toContain("E-VARIANT-AMBIGUOUS");
    });
  }
  test("en: a variant `Col` does not declare is E-TYPE-063 (annotated cell); a string-initialised cell is E-VARIANT-AMBIGUOUS", () => {
    expect(build(ENA + `<button onclick={ if (@c) { @col = .Green } else { @col = .Red } }>b</button>\n`, "en-wrong").errors)
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

// ---------------------------------------------------------------------------
// Review round 4 (S465) — markup LIFTED inside a component body or a `<match>` arm.
//
//   const Panel = <div>${ if (@c) { lift <button onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button> } }</div>
//
// called `_scrml_deep_set` with no `utilities` chunk shipped. This was the FOURTH position
// in which the pre-emit chunk walk failed to predict a helper an emitter wrote (handler
// lists → `<match>` arms → engine bodies → lifted markup), so the fix is not a fifth walk
// case: the chunk set is now completed FROM THE EMITTED TEXT against an index DERIVED from
// the runtime chunk sources (runtime-chunks.ts RUNTIME_HELPER_DEFINING_CHUNK /
// chunksForEmittedHelpers, applied by emit-client gateChunksByEmittedReference over the
// emitted lines AND the final body). Any position that emits a helper ships it.
// ---------------------------------------------------------------------------
const LO = `<c> = true\n<o> = { a: { b: 1 } }\n<xs> = [1, 2]\n<n> = 1\n`;
const LP = `<p id="o">\${@o.a.b}|\${@xs[0]}|\${@n}</p>\n`;
const LH = {
  ifelse: `{ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }`,
  braceless: `{ if (@c) @o.a.b = 5 else @o.a.b = 9 }`,
  multiline: `{\n  if (@c) {\n    @o.a.b = 5\n  } else {\n    @o.a.b = 9\n  }\n}`,
  seq: `{ @n = 2; @o.a.b = 7 }`,
  index: `{ if (@c) { @xs[0] = 5 } else { @xs[0] = 9 } }`,
  compound: `{ if (@c) { @o.a.b += 2 } else { @o.a.b -= 1 } }`,
  del: `{ if (@c) { delete @o.a.b } else { @o.a.b = 3 } }`,
};
const lBtn = (h, dollar = false) => `<button id="b" onclick=${dollar ? "$" : ""}${h}>b</button>`;
const lArm = (inner) => `type Col:enum = { Red, Blue }\n<col>: Col = .Red\n<match on=@col>\n  <Red><div>${inner}</div></>\n  <Blue><span>blue</span></>\n</match>\n`;
export const LIFT_SHAPES = {
  "comp-if-lift": (h) => `const Panel = <div>\${ if (@n > 0) { lift ${lBtn(h)} } }</div>\n<Panel/>\n`,
  "comp-if-lift-dollar": (h) => `const Panel = <div>\${ if (@n > 0) { lift ${lBtn(h, true)} } }</div>\n<Panel/>\n`,
  "comp-bare-lift": (h) => `const Panel = <div>\${ lift ${lBtn(h)} }</div>\n<Panel/>\n`,
  "comp-for-lift": (h) => `const Panel = <div>\${ for (const x of [1]) { lift ${lBtn(h)} } }</div>\n<Panel/>\n`,
  "match-bare-lift": (h) => lArm(`\${ lift ${lBtn(h)} }`),
  "match-if-lift": (h) => lArm(`\${ if (@n > 0) { lift ${lBtn(h)} } }`),
};
export const LIFT_HANDLERS = LH;
export const LIFT_FIXTURES = [];
for (const [sk, sf] of Object.entries(LIFT_SHAPES)) {
  for (const [hk, h] of Object.entries(LH)) {
    // `onclick=${ if (c) a else b }` (braceless, `${}` form) inside a component's lift is
    // E-COMPONENT-021 on cf4b0a6e too — the CE body re-parse goes through the native parser,
    // which rejects the same-line else there. Filed
    // (g-component-lift-dollar-braceless-else-ce-reparse-rejects-s465); not this fix.
    if (sk === "comp-if-lift-dollar" && hk === "braceless") continue;
    LIFT_FIXTURES.push([`${sk}-${hk}`, LO + sf(h) + TOG + LP]);
  }
}
LIFT_FIXTURES.push(["reviewer-repro", `<c> = true\n<o> = { a: { b: 1 } }\nconst Panel = <div>\${ if (@c) { lift <button class="bb" onclick={ if (@c) { @o.a.b = 5 } else { @o.a.b = 9 } }>b</button> } }</div>\n<Panel/>\n<p id="o">\${@o.a.b}</p>\n`]);

describe("S462 r4 — markup lifted in a component body / `<match>` arm ships its helpers", () => {
  for (const [name, src] of LIFT_FIXTURES) {
    test(name, () => {
      const { errors, files } = build(src, `r4-${name}`);
      expect(errors).toEqual([]);
      expect(Object.keys(files).some((f) => f.endsWith(".client.js"))).toBe(true);
      expect(undefinedHelperCalls(files)).toEqual([]);
    });
  }
});

describe("S462 r4 — the runtime helper index is derived, complete and unambiguous", () => {
  test("no `_scrml_*` name is declared at top level in two non-stdlib chunks", () => {
    expect([...RUNTIME_HELPER_AMBIGUOUS]).toEqual([]);
  });

  test("every top-level `_scrml_*` function a non-stdlib chunk declares maps back to that chunk", () => {
    let checked = 0;
    for (const [chunk, src] of Object.entries(RUNTIME_CHUNKS)) {
      if (chunk.startsWith("stdlib-")) continue;
      for (const m of src.matchAll(/(?:^|\n)(?:async\s+)?function\*?\s+(_scrml_\w+)/g)) {
        expect([m[1], RUNTIME_HELPER_DEFINING_CHUNK.get(m[1])]).toEqual([m[1], chunk]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(RUNTIME_HELPER_DEFINING_CHUNK.get("_scrml_deep_set")).toBe("utilities");
  });

  test("chunksForEmittedHelpers: a reference ships its chunk; typeof / string / client-declared / member do not", () => {
    const run = (text) => { const s = new Set(["core"]); chunksForEmittedHelpers(text, s); return [...s].sort(); };
    expect(run(`_scrml_deep_set(_scrml_reactive_get("o"), ["a"], 1);`)).toEqual(["core", "utilities"]);
    expect(run(`if (typeof _scrml_deep_set === "function") _x();`)).toEqual(["core"]);
    // The guarded use on the guard's own line is part of the optional-helper idiom (the
    // corpus emits both spellings: `_scrml_register_rehydrator`, `_scrml_chunk_loading`).
    expect(run(`if (typeof _scrml_deep_set === "function") _scrml_deep_set(o, ["a"], 1);`)).toEqual(["core"]);
    expect(run(`if (typeof _scrml_deep_set !== "undefined" && _scrml_deep_set) {}`)).toEqual(["core"]);
    expect(run(`if (typeof _scrml_deep_set === "function") _x();\n_scrml_deep_set(o, ["a"], 1);`)).toEqual(["core", "utilities"]);
    expect(run(`const k = "_scrml_deep_set";`)).toEqual(["core"]);
    expect(run(`function _scrml_deep_set(a) { return a; }\n_scrml_deep_set(1);`)).toEqual(["core"]);
    expect(run(`obj._scrml_deep_set(1);`)).toEqual(["core"]);
    expect(run(`_scrml_deep_set_x(1);`)).toEqual(["core"]);
  });
});

// The broad guard: the dangling-helper invariant over a large fixed compiled set, so the
// next position a walk misses is caught here rather than by a reviewer. Every top-level
// `examples/*.scrml` and `samples/compilation-tests/*.scrml`, compiled one file at a time
// (the way a page loads against its own pruned runtime). The full corpus (examples/,
// samples/, conformance/cases/, stdlib/, benchmarks/) is measured by the round-4 corpus
// differential (docs/changes/s462-braceless-if-else-dropped/progress.md).
const REPO = join(import.meta.dir, "..", "..", "..");
function topLevelScrml(dir) {
  const abs = join(REPO, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".scrml") && statSync(join(abs, f)).isFile())
    .sort()
    .map((f) => join(abs, f));
}
describe("S462 r4 — broad set: no emitted `_scrml_*(` call without a shipped definition", () => {
  const sources = [...topLevelScrml("examples"), ...topLevelScrml("samples/compilation-tests")];
  test("every compiled page ships every helper it calls", () => {
    expect(sources.length).toBeGreaterThan(300);
    const dangling = [];
    let pages = 0;
    for (const file of sources) {
      const rel = file.slice(REPO.length + 1);
      const outDir = join(TMP, "broad", rel.replace(/[\\/]/g, "__"));
      try {
        compileScrml({ inputFiles: [file], outputDir: outDir, write: true, verbose: false, log: () => {} });
      } catch { continue; }
      if (!existsSync(outDir)) continue;
      const files = {};
      for (const f of readdirSync(outDir)) if (f.endsWith(".js")) files[f] = readFileSync(join(outDir, f), "utf8");
      if (!Object.keys(files).some((f) => f.endsWith(".client.js"))) continue;
      pages++;
      const missing = undefinedHelperCalls(files);
      if (missing.length) dangling.push(`${rel}: ${missing.join(", ")}`);
    }
    expect(pages).toBeGreaterThan(200);
    if (dangling.length) console.log("dangling runtime helper calls:\n  " + dangling.join("\n  "));
    expect(dangling).toEqual([]);
  }, 900000);
});
