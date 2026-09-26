/**
 * defer-spec-calls.test.js — S432 post-merge review of #1051, the three SPEC calls
 * gift-wrapped for bryan on `hold/s432-defer-spec-calls`:
 *
 *   B1 §7.3.3 — a nested `function` declaration named like a parameter is outside
 *      E-SCOPE-REDECLARE (JS-legal, and compiled + ran before the rule; the
 *      rule's own direction-of-change sentence says it rejects only programs
 *      that already failed at codegen).
 *   B2 §19.16.1 — `defer [` while a binding named `defer` is in scope is
 *      ambiguous (index the binding vs defer a statement that starts with an
 *      array literal): E-DEFER-AMBIGUOUS-LEAD, never a silent re-reading.
 *   B3 §19.16.2 — the deferred body cannot rebind the RETURNED value, but the
 *      value is not frozen: a deferred mutation of a returned object is visible
 *      (pinned at runtime by conformance/cases/defer/return-value-contents-not-frozen).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compile(src, opts = {}) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve("/tmp", `scrml-defer-spec-${uniq}`);
  const input = resolve(tmpDir, `app.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: false, outputDir: resolve(tmpDir, "out"), ...opts });
    const out = [...(result.outputs?.values?.() ?? [])][0] ?? {};
    return { errors: result.errors ?? [], clientJs: out.clientJs ?? "" };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}
const codes = (r) => r.errors.map((e) => e.code);
const BOTH = [["live", {}], ["native", { parser: "scrml-native" }]];
const page = (logic) => `\${\n    <trace> = ""\n    function note(x) { @trace = @trace + x + ";" }\n${logic}\n}\n<program>\n    <button id="go" onclick=go()>Go</>\n    <p id="out">\${@trace}</p>\n</program>\n`;


describe("B1 §7.3.3 — a nested function declaration named like a parameter", () => {
  const fnOverParam = page(`    function f(x) {\n        function x() {\n            return 7\n        }\n        return x()\n    }\n    function go() { @trace = @trace + f(1) + ";" }`);
  for (const [pipe, opts] of BOTH) {
    test(`is not E-SCOPE-REDECLARE (${pipe})`, () => {
      expect(codes(compile(fnOverParam, opts))).toEqual([]);
    });
  }
  test("with a defer in the block it compiles too (the try-block function shadows the parameter)", () => {
    const src = page(`    function f(x) {\n        defer note("d")\n        function x() {\n            return 7\n        }\n        return x()\n    }\n    function go() { @trace = @trace + f(1) + ";" }`);
    expect(codes(compile(src))).toEqual([]);
  });
  test("a let / const / lin over a parameter is still rejected", () => {
    const src = page(`    function f(x) {\n        let x = 5\n        return x\n    }\n    function go() { @trace = @trace + f(1) + ";" }`);
    expect(codes(compile(src))).toContain("E-SCOPE-REDECLARE");
  });
  test("a let after a function-over-parameter still collides with the parameter", () => {
    const src = page(`    function f(x) {\n        function x() { return 7 }\n        let x = 5\n        return x\n    }\n    function go() { @trace = @trace + f(1) + ";" }`);
    expect(codes(compile(src)).filter((c) => c === "E-SCOPE-REDECLARE").length).toBe(1);
  });
  test("a function over a same-block let/const is still rejected", () => {
    const src = page(`    function f() {\n        const z = 1\n        function z() { return 2 }\n        return z\n    }\n    function go() { @trace = @trace + f() + ";" }`);
    expect(codes(compile(src))).toContain("E-SCOPE-REDECLARE");
  });
});

describe("B2 §19.16.1 — `defer [` while `defer` is a binding in scope", () => {
  const ambiguous = {
    "index assignment `defer [0] = 9` (compiled on base)": `        let defer = [1, 2]\n        defer [0] = 9\n        @trace = @trace + "a" + defer[0] + ";"`,
    "member write `defer [0].m = 5` (was silently re-read as a deferred statement)": `        let defer = [{ m: 1 }, 2]\n        defer [0].m = 5\n        @trace = @trace + "a" + defer[0].m + ";"`,
    "method call `defer [0].forEach(note)` (was silently re-read)": `        let defer = [[7], 2]\n        defer [0].forEach(note)\n        @trace = @trace + "a;"`,
  };
  for (const [name, body] of Object.entries(ambiguous)) {
    for (const [pipe, opts] of BOTH) {
      test(`${name} — E-DEFER-AMBIGUOUS-LEAD (${pipe})`, () => {
        const r = compile(page(`    function go() {\n${body}\n    }`), opts);
        expect(codes(r)).toContain("E-DEFER-AMBIGUOUS-LEAD");
        expect(codes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      });
    }
  }
  const bindings = {
    "a parameter": `    function go2(defer) {\n        defer [0].forEach(note)\n    }\n    function go() { go2([[1]]) }`,
    "a file-level function": `    function defer(x) { return x }\n    function go() {\n        defer [1].forEach(note)\n    }`,
    "a hoisted nested `function defer` declared after the use": `    function go() {
        defer [1].forEach(note)
        function defer(x) { return x }
    }`,
    "an enclosing block's earlier `let`": `    function go() {
        let defer = [[1]]
        if (true) {
            defer [0].forEach(note)
        }
    }`,
    "a match-arm PAYLOAD binder (review B-1)": `    type M:enum = { A(defer: string), B }
    function h(m: M) {
        match m {
            .A(defer) :> {
                defer [1].split("").forEach(note)
                note("a")
            }
            .B :> {
                note("b")
            }
        }
    }
    function go() { h(M.A("xy")) }`,
    "a `given`-narrowed binding (review B-1)": `    function go2(v) {
        let defer = v
        given defer => {
            defer [0].forEach(note)
        }
    }
    function go() { go2([[1]]) }`,
    "a destructured for-of binder": `    function go() {
        for (const [defer] of [[[[1]]]]) {
            defer [0].forEach(note)
        }
    }`,
    "a destructured parameter": `    function go2({ defer }) {
        defer [0].forEach(note)
    }
    function go() { go2({ defer: [[1]] }) }`,
    "a for-of binder": `    function go() {\n        for (const defer of [[[1]]]) {\n            defer [0].forEach(note)\n        }\n    }`,
  };
  for (const [name, logic] of Object.entries(bindings)) {
    test(`the binding is ${name} — E-DEFER-AMBIGUOUS-LEAD`, () => {
      expect(codes(compile(page(logic)))).toContain("E-DEFER-AMBIGUOUS-LEAD");
    });
  }
  const unaffected = {
    "the ratified round-6 lead with no `defer` binding": `    function go() {\n        defer ["a", "b"].forEach(note)\n        note("x")\n    }`,
    "adjacent `defer[0]` indexes the binding": `    function go() {\n        let defer = [[7], 2]\n        defer[0].forEach(note)\n        note("x")\n    }`,
    "block form defers an array-lead statement even with a binding": `    function go() {\n        let defer = 1\n        defer { [1].forEach(note) }\n        note("x" + defer)\n    }`,
    "a binding in ANOTHER function does not make this one ambiguous": `    function other() {\n        let defer = 1\n        return defer\n    }\n    function go() {\n        defer ["a"].forEach(note)\n        note("x")\n    }`,
    "a `let defer` declared LATER in the block is not visible at the `defer` (round-6 array-literal-lead)": `    function go() {
        defer ["a;", "b;"].forEach(note)
        let defer = [7]
        note("v" + defer[0])
    }`,
    "a binding in a sibling nested block is not visible": `    function go() {
        if (true) {
            let defer = 1
            note("x" + defer)
        }
        defer ["a"].forEach(note)
    }`,
    "a non-`[` lead with a binding in scope is the defer statement (§19.16.1, unchanged)": `    function go() {\n        let defer = 1\n        defer note("d")\n        note("x")\n    }`,
  };
  for (const [name, logic] of Object.entries(unaffected)) {
    for (const [pipe, opts] of BOTH) {
      test(`${name} — no E-DEFER-AMBIGUOUS-LEAD (${pipe})`, () => {
        expect(codes(compile(page(logic), opts))).not.toContain("E-DEFER-AMBIGUOUS-LEAD");
      });
    }
  }
});
