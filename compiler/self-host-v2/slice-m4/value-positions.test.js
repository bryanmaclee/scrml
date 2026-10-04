// value-positions.test.js — SPEC §6.15 "Value Positions Do Not Write Reactive
// State" (bryan, S449, user-voice-scrml.md §S449 item 3): "Evaluating a value
// position SHALL NOT write any reactive cell, directly or through a called
// function. A write found by the analysis below is E-VALUE-WRITES-STATE; a
// value position the analysis cannot prove write-free is
// E-VALUE-WRITE-UNPROVEN." The bootstrap judges each value position at its
// SOURCE (analyze valuePositions / valueDiags) by the write summary the
// `<effect>` rule uses.
//
// Positions: a program cell's initializer (a `let` seed), a derived / locked
// formula, a user declaration's field initializers (attribute and child field),
// a use-site value, a markup interpolation (program body, a `renders`, a
// state-child body), every markup attribute value (`title=`, `class=`,
// `show=`, an `if=` condition, an `<each in=…>` sequence and its `key=`). NOT
// value positions: an event handler, a two-way `bind:` (action positions).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CODE = "E-VALUE-WRITES-STATE";
const UNPROVEN = "E-VALUE-WRITE-UNPROVEN";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const diagsOf = (src) => run(src).diags;
const codes = (src) => diagsOf(src).map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const $ = (sel) => document.querySelector(sel);

// `g` writes `@a`; `h` is its write-free twin. `gs` / `hs` return strings.
const W = [
  `    let <a:int=0/>`,
  `    function g(x: int) -> int {\n        @a = @a + 1\n        return x\n    }`,
  `    fn h(x: int) -> int { return x }`,
  `    function gs() -> string {\n        @a = @a + 1\n        return "w"\n    }`,
  `    fn hs() -> string { return "w" }`,
].join("\n");
const with_ = (decls) => `${W}\n${decls}`;

describe("S449 item 3 — every position class: a writer is an error at the SOURCE; its write-free twin is clean", () => {
  // [label, src(writer?) , the position's name in the message]
  const CASES = [
    ["a program cell's `let` initializer", (w) => P(with_(`    let <b:int=(${w}(1))/>`), ""), "the initializer of `@b`"],
    ["a derived formula (a locked cell reading cells)", (w) => P(with_(`    <d:int=(@a + ${w}(1))/>`), ""), "the formula of derived `@d`"],
    ["a locked initializer calling a function (a call may read cells: a formula, §66.9)", (w) => P(with_(`    <k:int=(${w}(1))/>`), ""), "the formula of derived `@k`"],
    ["a user declaration's attribute-field default (locked, calling a function: a formula)", (w) => P(with_(`    <card title:string=(${w}s())/>\n    renders <b>\${title}</b>`), `        <card/>`), "the formula of derived `@card.title`"],
    ["a user declaration's `let` field (a seed)", (w) => P(with_(`    <box:struct> let <k:int=(${w}(1))/> </>\n    renders <div>\${k}</div>`), ""), "the initializer of `@box.k`"],
    ["a user declaration's child field", (w) => P(with_(`    <panel title:string>\n        let <page:int=(${w}(1))/>\n    </>\n    renders <div>\${page}</div>`), `        <panel title="p"/>`), "the initializer of `@panel.page`"],
    ["a use-site value", (w) => P(with_(`    <card title:string>\n    </>\n    renders <b>\${title}</b>`), `        <card title=(${w}s())/>`), "the use-site value `title=` of `<card>`"],
    ["a markup interpolation", (w) => P(W, `        <p>\${${w}(@a)}</p>`), "the interpolation"],
    ["an interpolation in a declaration's `renders`", (w) => P(with_(`    <card title:string>\n    </>\n    renders <b>\${title}\${${w}s()}</b>`), `        <card title="t"/>`), "the interpolation"],
    ["a bound attribute value", (w) => P(W, `        <p title=(${w}s())>x</p>`), "the `title=` value on `<p>`"],
    ["a `class=` value", (w) => P(W, `        <p class=(${w}s())>x</p>`), "the `class=` value on `<p>`"],
    ["a `show=` condition", (w) => P(W, `        <p show=(${w}(@a) > 0)>x</p>`), "the `show=` condition on `<p>`"],
    ["an `if=` condition", (w) => P(W, `        <p if=(${w}(@a) > 0)>x</p>`), "the `if=` condition on `<p>`"],
    ["an `<each in=…>` sequence", (w) => P(with_(`    <xs:int[]=([1, 2])/>`), `        <ul><each in=@xs.filter(x => ${w}(x) > 0) as x><li>\${x}</li></each></ul>`), "the `<each in=…>` sequence"],
  ];

  for (const [label, src, where] of CASES) {
    test(`${label}: writer → ${CODE}, naming the position and the chain; write-free twin → clean`, () => {
      const ds = diagsOf(src("g"));
      expect(ds.map((d) => d.code)).toEqual([CODE]);
      expect(ds[0].message).toContain(where);
      expect(ds[0].message).toMatch(/`gs?\(\) → @a`/);
      clean(src("h"));
    });
  }

  test("an interpolation in a state-child body (rendered wherever its field renders)", () => {
    const src = (w) => P(with_(`    type Ph:enum = { A, B }\n    <ph:Ph=.A single>\n        <A rule=.B>\${${w}s()}</>\n        <B rule=.A : "B">\n    </>`), `        <p><*ph/></p>`);
    const ds = diagsOf(src("g"));
    expect(ds.map((d) => d.code)).toEqual([CODE]);
    expect(ds[0].message).toContain("the interpolation");
    clean(src("h"));
  });

  test("an `<each key=…>` expression", () => {
    const src = (w) => P(with_(`    type Row:struct = { id: int }\n    <rows:Row[]=([{ id: 1 }])/>`), `        <ul><each in=@rows key=(${w}(@.id)) as r><li>\${r.id}</li></each></ul>`);
    const ds = diagsOf(src("g"));
    expect(ds.map((d) => d.code)).toContain(CODE);
    expect(ds.find((d) => d.code === CODE).message).toContain("the `<each key=…>` key");
  });
});

describe("S449 item 3 — the write summary, as the effect rule uses it", () => {
  test("a write two calls down names the whole chain", () => {
    const ds = diagsOf(P(with_(`    function mid(x: int) -> int { return g(x) }`), `        <p>\${mid(@a)}</p>`));
    expect(ds.map((d) => d.code)).toEqual([CODE]);
    expect(ds[0].message).toContain("`mid() → g() → @a`");
  });

  test("a direct write in an interpolation (an edit call) is a write too", () => {
    const ds = diagsOf(P(`    <xs:int[free, append]=[]/>`, `        <p>\${@xs.push(1)}</p>`));
    expect(ds.map((d) => d.code)).toContain(CODE);
    expect(ds.find((d) => d.code === CODE).message).toContain("writes `@xs`");
  });

  test("recursion that writes is found (the fixed point)", () => {
    const rec = `    function r1(k: int) -> int {\n        if (k > 0) { return r2(k - 1) }\n        return 0\n    }\n    function r2(k: int) -> int {\n        @a = k\n        return r1(k)\n    }`;
    expect(codes(P(with_(rec), `        <p>\${r1(3)}</p>`))).toEqual([CODE]);
  });

  test("an unresolvable call reached from a render position fails closed — " + UNPROVEN, () => {
    const via = `    function viaLocal() -> int {\n        const k = h\n        return k(1)\n    }`;
    const ds = diagsOf(P(with_(via), `        <p>\${viaLocal()}</p>`));
    expect(ds.map((d) => d.code)).toEqual([UNPROVEN]);
    expect(ds[0].message).toContain("through `viaLocal()`");
    expect(ds[0].message).toContain("fails closed");
  });

  test("reading cells and calling write-free functions — clean in every position", () => {
    clean(P(with_(`    <d:int=(@a * 2 + h(1))/>\n    let <s:int=(h(@a))/>`),
      `        <p title=(hs()) if=(@d > -1)>\${h(@s)} \${h(@d)}</p>`));
  });
});

describe("S449 item 3 — NOT render positions: an event handler and a two-way bind may write", () => {
  test("`onclick=` calling a writer, a handler block writing, `bind:value` — clean", () => {
    clean(P(with_(`    let <q:string=""/>`),
      `        <button onclick=g(1)>a</button>\n        <button onclick={ @a = @a + 1 }>b</button>\n        <input bind:value=@q/>\n        <p>\${@a}</p>`));
  });
});

describe("closes g-bootstrap-render-writer-call-hangs — the render self-write is rejected at compile time", () => {
  test("`<p>${g(@a)}</p>` with `g` writing `@a` (it hung at mount) is " + CODE + "; its write-free twin mounts and renders", async () => {
    const src = (w) => P(W, `        <p class="out">\${${w}(@a)}</p>`);
    expect(codes(src("g"))).toEqual([CODE]);
    await loadProgram(clean(src("h")).core, "nwf-render-twin");
    expect($("p.out").textContent).toBe("0");
  });

  test("a render↔render cycle (each hole writes what the other reads) is rejected at both holes", () => {
    const fns = `    let <b:int=0/>\n    function wa() -> int {\n        @a = @b + 1\n        return @a\n    }\n    function wb() -> int {\n        @b = @a + 1\n        return @b\n    }`;
    expect(codes(P(`    let <a:int=0/>\n${fns}`, `        <p>\${wa()}</p>\n        <p>\${wb()}</p>`))).toEqual([CODE, CODE]);
  });
});

// The §6.15 conformance cases (conformance/cases/reactive/no-write-*) are written in the §66 opener form,
// which impl#1 does not parse (their positives xfail there under
// g-impl1-value-writes-state-codes-unimplemented-s449). The bootstrap IS the implementation that executes
// them: each case's codes half, judged here exactly as the conformance runner judges it (superset / disjoint).
describe("§6.15 conformance cases, executed by the bootstrap", () => {
  const CASES_DIR = join(import.meta.dir, "..", "..", "..", "conformance", "cases", "reactive");
  const ids = readdirSync(CASES_DIR).filter((d) => d.startsWith("no-write-")).sort();
  test("the case set is present: 6 position classes × pos / neg, an UNPROVEN positive, a handler negative", () => {
    expect(ids.length).toBe(14);
  });
  for (const id of ids) {
    test(id, () => {
      const src = readFileSync(join(CASES_DIR, id, "case.scrml"), "utf8");
      const exp = JSON.parse(readFileSync(join(CASES_DIR, id, "expected.json"), "utf8")).expect;
      const got = codes(src);
      for (const c of exp.codes ?? []) expect(got).toContain(c);
      for (const c of exp.notCodes ?? []) expect(got).not.toContain(c);
      // a negative twin is a CLEAN program on the bootstrap, not merely one without these two codes
      if (!exp.codes) expect(got).toEqual([]);
    });
  }
});
