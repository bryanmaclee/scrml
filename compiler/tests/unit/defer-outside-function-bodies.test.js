/**
 * defer-outside-function-bodies.test.js — SPEC §19.16.3 rule 4 (S432 review, A1/A2).
 *
 * `defer` SHALL appear only inside a function-DECLARATION body (or a block
 * nested in one); every other body is E-DEFER-OUTSIDE-FUNCTION. The S430 checker
 * reached the bodies the front-ends parse into statement lists, but NOT the
 * statement bodies a node carries — and codegen lowers — as TEXT. On the live
 * (default) pipeline a `defer` in a `when @x changes { }` body was a codegen
 * crash ("compiler defect") or, for `defer [1, 2].forEach(f)`, compiled CLEAN
 * and emitted `defer[…]` (a runtime ReferenceError).
 *
 * The table below is every non-function body kind × both front-ends. A row's
 * `live` / `native` value is the code that MUST be present; `"fails"` means the
 * front-end rejects the program for a reason owned by a separately-filed
 * front-end gap (native does not parse `when`, drops `~{}` test blocks, and
 * parses only the first expression of `on mount`) — asserted only to fail
 * closed (a compile error, never clean output).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compile(src, opts = {}) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve("/tmp", `scrml-defer-bodies-${uniq}`);
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
const OUT = "E-DEFER-OUTSIDE-FUNCTION";

const HEAD = `\${
    <trace> = ""
    <n> = 0
    function note(x) { @trace = @trace + x + ";" }
    function go() { @n = @n + 1 }`;
const FOOT = `}
<program>
    <button id="go" onclick=go()>Go</>
    <p id="out">\${@trace}</p>
</program>
`;
const logic = (body) => `${HEAD}\n${body}\n${FOOT}`;
const page = (logicBody, markup) =>
  `\${\n    <trace> = ""\n    <items> = [1, 2]\n    function note(x) { @trace = @trace + x + ";" }\n${logicBody}\n}\n<program>\n${markup}\n    <p id="out">\${@trace}</p>\n</program>\n`;

const ROWS = [
  // --- text-carried bodies codegen lowers as text (the A1 class) ---
  { name: "when-changes body: `defer f(x)`", src: logic(`    when @n changes {\n        defer note("d")\n        note("w")\n    }`), live: OUT, native: "fails" },
  { name: "when-changes body: `defer [1, 2].forEach(f)` (was CLEAN + runtime ReferenceError)", src: logic(`    when @n changes {\n        defer [1, 2].forEach(note)\n        note("w")\n    }`), live: OUT, native: "fails" },
  { name: "when-changes body: `defer @cell = …`", src: logic(`    when @n changes {\n        defer @trace = @trace + "D;"\n        note("w")\n    }`), live: OUT, native: "fails" },
  { name: "when-changes body: block form", src: logic(`    when @n changes {\n        defer { note("d") }\n        note("w")\n    }`), live: OUT, native: "fails" },
  { name: "when-changes body: a function DECLARED in it (the body is lowered as text)", src: logic(`    when @n changes {\n        function inner() { defer note("d"); note("i") }\n        inner()\n    }`), live: OUT, native: "fails" },
  { name: "worker self-handler + parent `when message from`", src: `<program>\n<program name="w1">\n    \${\n        when message(data) {\n            defer send({ r: 1 })\n            send({ r: 2 })\n        }\n    }\n</>\n\${\n    <trace> = ""\n    function go() { <#w1>.send({ v: 1 }) }\n    when message from <#w1> (data) {\n        defer note("d")\n        @trace = @trace + data.r + ";"\n    }\n    function note(x) { @trace = @trace + x + ";" }\n}\n<button id="go" onclick=go()>Go</>\n<p id="out">\${@trace}</p>\n</program>\n`, live: OUT, native: "fails" },
  { name: "event-handler attribute `onclick=${defer f()}`", src: page("", `    <button id="go" onclick=\${defer note("d")}>Go</>`), live: OUT, native: OUT },
  { name: "event-handler attribute inside <each>", src: page("", `    <each in=@items as it>\n        <button onclick=\${defer note("d")}>x</>\n    </each>`), live: OUT, native: OUT },
  { name: "`~{}` test body", src: `\${\n    <trace> = ""\n    function note(x) { @trace = @trace + x + ";" }\n}\n~{ "t"\n    test "x" {\n        defer note("d")\n        assert 1 == 1\n    }\n}\n<program>\n    <p id="out">\${@trace}</p>\n</program>\n`, live: OUT, native: "dropped" },
  // --- text-carried arm / block bodies at the TOP level (no enclosing function) ---
  { name: "top-level braced match arm", src: logic(`    type M:enum = { A, B }\n    let mm: M = M.A\n    match mm {\n        .A :> {\n            defer note("d")\n            note("a")\n        }\n        .B :> { note("b") }\n    }`), live: OUT, native: OUT },
  { name: "top-level unbraced match arm", src: logic(`    type M:enum = { A, B }\n    let mm: M = M.A\n    match mm {\n        .A :> defer note("d")\n        .B :> note("b")\n    }`), live: OUT, native: "E-DEFER-UNSUPPORTED-SITE" },
  { name: "top-level `!{}` handler arm", src: logic(`    type E:enum = { Bad }\n    function risky()! -> E { return 1 }\n    risky() !{\n        | _ :> { defer note("d") }\n    }`), live: OUT, native: OUT },
  { name: "top-level bare `{ }` block", src: logic(`    {\n        defer note("d")\n    }`), live: OUT, native: OUT },
  // --- bodies the checker already reached structurally (regression pins) ---
  { name: "top-level statement", src: logic(`    defer note("d")`), live: OUT, native: OUT },
  { name: "top-level `defer [ … ]` lead", src: logic(`    defer [1, 2].forEach(note)`), live: OUT, native: OUT },
  { name: "top-level if body", src: logic(`    if (@n == 0) {\n        defer note("d")\n    }`), live: OUT, native: OUT },
  { name: "top-level for body", src: logic(`    for (const k of [1]) {\n        defer note("d")\n    }`), live: OUT, native: OUT },
  { name: "top-level while body", src: logic(`    let q = 0\n    while (q < 1) {\n        defer note("d")\n        q = q + 1\n    }`), live: OUT, native: OUT },
  { name: "top-level given body", src: logic(`    let gv = 1\n    given gv => {\n        defer note("d")\n    }`), live: OUT, native: OUT },
  { name: "top-level transaction body", src: logic(`    transaction {\n        defer note("d")\n    }`), live: OUT, native: OUT },
  { name: "`on mount { }` body", src: logic(`    on mount {\n        defer note("d")\n    }`), live: OUT, native: "fails" },
  { name: "cleanup(() => { … }) lambda", src: logic(`    cleanup(() => { defer note("d") })`), live: OUT, native: OUT },
  { name: "arrow in a handler attribute", src: page("", `    <button id="go" onclick=\${() => { defer note("d"); note("a") }}>Go</>`), live: OUT, native: OUT },
  { name: "function expression in a handler attribute", src: page("", `    <button id="go" onclick=\${function() { defer note("d"); note("a") }}>Go</>`), live: OUT, native: OUT },
  { name: "`${ }` in markup", src: page("", `    <div>\${ defer note("d") }</div>`), live: OUT, native: OUT },
  { name: "engine state-child body", src: `\${\n    <trace> = ""\n    function note(x) { @trace = @trace + x + ";" }\n    type P:enum = { Idle, Busy }\n}\n<program>\n    <engine for=P initial=.Idle>\n        <Idle>\${ defer note("d") }</>\n        <Busy>"busy"</>\n    </engine>\n    <p id="out">\${@trace}</p>\n</program>\n`, live: OUT, native: OUT },
];

describe("§19.16.3 rule 4 — every non-function body kind × both front-ends", () => {
  for (const row of ROWS) {
    for (const [pipe, want] of [["live", row.live], ["native", row.native]]) {
      test(`${row.name} — ${pipe}`, () => {
        const r = compile(row.src, pipe === "native" ? { parser: "scrml-native" } : {});
        const c = codes(r);
        // Never a silent pass-through to codegen, on any row.
        expect(c).not.toContain("E-CODEGEN-INVALID-LOGIC");
        if (want === "dropped") {
          // native drops `~{}` test blocks entirely (separate front-end gap): nothing is emitted.
          expect(r.clientJs).not.toMatch(/\bdefer\b/);
          return;
        }
        expect(c.length).toBeGreaterThan(0);
        if (want !== "fails") expect(c).toContain(want);
      });
    }
  }

  test("the live when-body diagnostic fires exactly once, names the body, and anchors on the `when`", () => {
    const r = compile(logic(`    when @n changes {\n        defer [1, 2].forEach(note)\n        note("w")\n    }`));
    const hits = r.errors.filter((e) => e.code === OUT);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("`when … changes { }` body");
    expect(hits[0].span?.line).toBe(6);
  });

  test("a function declared in a when body is reported under the when rule, not the lambda rule", () => {
    const r = compile(logic(`    when @n changes {\n        function inner() { defer note("d") }\n        inner()\n    }`));
    const hits = r.errors.filter((e) => e.code === OUT);
    expect(hits.length).toBe(1);
    expect(hits[0].message).not.toContain("arrow-function");
  });

  test("`defer` as an identifier in a when body / handler attribute is untouched (§19.16.1)", () => {
    const r = compile(logic(`    let defer = 1\n    when @n changes {\n        note(defer)\n    }`));
    expect(codes(r).filter((c) => c.startsWith("E-DEFER-"))).toEqual([]);
  });

  test("a `defer` in a function the handler CALLS is legal (the function-declaration body is the site)", () => {
    const r = compile(logic(`    function h() {\n        defer note("d")\n        note("h")\n    }\n    when @n changes {\n        h()\n    }`));
    expect(codes(r)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A2 — `defer` in a braced `match` STATEMENT arm inside a function (§19.16.2
// lists "a braced match arm block" as a defer site). Live: supported (the arm is
// a structured `match-arm-block`). Native: the bridge carries every
// statement-position match as a `match-expr` with TEXT arms (`rawArms`), lowered
// by `rewriteBlockBody`, so there is no statement list to attach the deferred
// statement to; it is rejected (E-DEFER-UNSUPPORTED-SITE), never mis-lowered.
// Documented as a known divergence (SPEC §19.16.8, hold branch); the runtime
// behaviour is pinned by conformance/cases/defer/match-stmt-braced-arm.
// ---------------------------------------------------------------------------

describe("§19.16.2 braced match-statement arm — live supports, native fails closed", () => {
  const src = `\${
    <trace> = ""
    type M:enum = { A, B }
    function f(m: M) {
        match m {
            .A :> {
                defer @trace = @trace + "MA;"
                @trace = @trace + "ma;"
            }
            .B :> {
                @trace = @trace + "mb;"
            }
        }
        @trace = @trace + "end;"
    }
    function go() {
        f(M.A)
        f(M.B)
    }
}
<program>
    <button id="go" onclick=go()>Go</>
    <p id="out">\${@trace}</p>
</program>
`;
  test("live: compiles clean and lowers the arm's defer stack", () => {
    const r = compile(src);
    expect(codes(r)).toEqual([]);
    expect(r.clientJs).toContain("_scrml_defers_");
  });
  test("native: E-DEFER-UNSUPPORTED-SITE (documented divergence), no output", () => {
    const r = compile(src, { parser: "scrml-native" });
    expect(codes(r)).toContain("E-DEFER-UNSUPPORTED-SITE");
    expect(codes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });
});
