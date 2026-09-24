/**
 * s430 fix round (F1) — the mutability of a `for (… of …)` loop binder, in EVERY
 * loop, not only a rendering one. Closes
 * `g-non-rendering-loop-write-to-its-own-binder-emits-a-tdz-referenceerror`.
 *
 * Governing: §50.9 "`let` is the only declaration form that produces a mutable
 * binding"; §50.8.5 E-ASSIGN-004 (reassigning a `const` binding).
 *
 * (a) CODEGEN. s427 (#1032) taught a RENDERING loop that a write to its own
 *     `let` binder is an assignment (`let` head, binder in the body's declared
 *     names — forHeadKeyword / withLoopBinders in emit-lift.js). A NON-rendering
 *     loop was left "unchanged", so `for (let x of xs) { x = x * 2 }` resolved the
 *     write against the ENCLOSING scope and emitted
 *         for (const x of xs) { const x = x * 2; … }
 *     — exit 0, TDZ ReferenceError on the first iteration. Every for-of emitter now
 *     routes through the same rule (loopBodyDeclaredNames): the plain loop, the
 *     §8.10 batch-hoisted loop, the tilde (if-arm) loop and the for-as-expression.
 *
 * (b) TYPER. The type system bound EVERY loop binder mutable (the head keyword
 *     never reached it), so a write to an explicit `const` binder compiled
 *     silently. The parser now records `constBinder: true` and the for-arm binds it
 *     `isConst`, so E-ASSIGN-004 fires.
 *
 * KEYWORDLESS binders (`for (x of xs)`) are deliberately UNCHANGED — whether they
 * are mutable is a language ruling still pending with bryan. The last block pins
 * that they behave exactly as before this change.
 *
 * Every accepted program here is EXECUTED, not just compiled: "exit 0" is the
 * claim that hid this bug.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s430-binder-"));
  const file = join(dir, "t.scrml");
  writeFileSync(file, source);
  try {
    const r = compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {} });
    const fatal = r.errors ?? [];
    const out = r.outputs?.get(file) ?? [...(r.outputs?.values() ?? [])][0];
    return {
      fatal,
      codes: fatal.map((e) => e.code),
      clientJs: out?.clientJs ?? "",
      serverJs: [...(r.outputs?.values() ?? [])].map((o) => o.serverJs ?? "").join("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const wrap = (body) => `\${
${body}
}
<program>
    <p>hello</>
</>`;

/** Slice the balanced `{ … }` block that starts at the first `{` at/after `from`. */
function balanced(js, from) {
  const open = js.indexOf("{", from);
  let depth = 0, end = open;
  for (; end < js.length; end++) {
    if (js[end] === "{") depth++;
    else if (js[end] === "}" && --depth === 0) break;
  }
  return js.slice(from, end + 1);
}

/** Execute the first emitted user function `_scrml_f_N` (pure over its args). */
function runF(clientJs, ...args) {
  const m = /function (_scrml_f\w*)\(/.exec(clientJs);
  if (!m) throw new Error("no emitted user function in clientJs");
  const text = balanced(clientJs, m.index);
  return new Function(`${text}; return ${m[1]};`)()(...args);
}

function assign004(fatal) {
  return fatal
    .filter((e) => e.code === "E-ASSIGN-004")
    .map((e) => {
      const m = /`([^`]+)` at line (\d+)/.exec(e.message ?? "");
      return m ? `${m[1]}@${m[2]}` : "?";
    });
}

// ---------------------------------------------------------------------------
// (a) codegen — a `let` binder written in a NON-rendering loop
// ---------------------------------------------------------------------------

describe("(a) a non-rendering loop's `let` binder write is an ASSIGNMENT — compiles and RUNS", () => {
  test("plain binder, `=`: `let` head, `x = x * 2`, correct sum", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (let x of xs) {
            x = x * 2
            s = s + x
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let x of xs)");
    expect(r.clientJs).not.toContain("const x = x");
    expect(runF(r.clientJs, [1, 2, 3])).toBe(12);
  });

  test("compound `+=` and `++` on the binder", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (let x of xs) {
            x += 10
            x++
            s = s + x
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let x of xs)");
    expect(runF(r.clientJs, [1, 2])).toBe(25);
  });

  test("write inside a nested `if` in the body", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (let x of xs) {
            if (x > 1) {
                x = x * 100
            }
            s = s + x
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let x of xs)");
    expect(runF(r.clientJs, [1, 2, 3])).toBe(501);
  });

  test("destructured object binder (no outer binding)", () => {
    const r = compile(wrap(`    function f(rows) {
        let out = ""
        for (let { name, n } of rows) {
            name = name + n
            out = out + name
        }
        return out
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let { name, n } of rows)");
    expect(runF(r.clientJs, [{ name: "a", n: 1 }, { name: "b", n: 2 }])).toBe("a1b2");
  });

  test("destructured array binder shadowing an outer `let` — the outer is untouched", () => {
    const r = compile(wrap(`    function f(pairs) {
        let k = 100
        let s = 0
        for (let [k, v] of pairs) {
            k = k * v
            s = s + k
        }
        return s + k
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, [[2, 3], [4, 5]])).toBe(126);
  });

  test("nested loops: the outer `let` binder is written, the inner is not", () => {
    const r = compile(wrap(`    function f(xss) {
        let s = 0
        for (let xs of xss) {
            xs = xs.concat([1])
            for (const x of xs) {
                s = s + x
            }
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let xs of xss)");
    expect(r.clientJs).toContain("for (const x of xs)");
    expect(runF(r.clientJs, [[1, 2], [3]])).toBe(8);
  });

  test("for-as-expression (`const ys = for (let x of xs) { … lift x }`)", () => {
    const r = compile(wrap(`    function f(xs) {
        const ys = for (let x of xs) {
            x = x + 1
            lift x
        }
        return ys
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let x of xs)");
    expect(r.clientJs).not.toContain("const x = x");
    expect(runF(r.clientJs, [1, 2])).toEqual([2, 3]);
  });

  test("tilde loop inside an if-as-expression arm: the loop lowers the write as an assignment", () => {
    // The arm-result accumulator here is `null` at run time — a PRE-EXISTING,
    // separate defect of a loop lifted inside an if-as-expression arm (see the
    // precedence note in emit-logic.ts _emitForStmtWithTilde). So this row pins the
    // LOOP's lowering (and that the TDZ ReferenceError is gone), not the arm result.
    const r = compile(wrap(`    function f(xs) {
        const ys = if (xs.length > 0) {
            for (let x of xs) {
                x = x * 10
                lift x
            }
        } else {
            lift 0
        }
        return ys
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let x of xs)");
    expect(r.clientJs).toContain("x = x * 10;");
    expect(r.clientJs).not.toContain("const x = x");
    let err = null;
    try { runF(r.clientJs, [1]); } catch (e) { err = e; }
    expect(err === null || !(err instanceof ReferenceError)).toBe(true);
  });

  test("§8.10 batch-hoisted server loop: `let` head, assignment, and the handler RUNS", async () => {
    const r = compile([
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    let out = []",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id, name FROM users WHERE id = ${x.id}`}.get()",
      "        x = row",
      "        out.push(x)",
      "    }",
      "    return out",
      "} }",
      "<p>hi</p>",
      "</>",
    ].join("\n"));
    expect(r.fatal).toEqual([]);
    const js = r.serverJs;
    expect(js).toMatch(/for \(let x of ids\) \{/);
    expect(js).not.toContain("const x = row");
    // Execute the handler body with a stubbed request + SQL: the rows come back
    // keyed by id, the loop reassigns its binder to each row.
    const start = js.indexOf("const _scrml_result = await (async () => {");
    expect(start).toBeGreaterThan(-1);
    const iife = balanced(js, start);
    const run = new Function(
      "_scrml_req", "_scrml_sql",
      `return (async () => { ${iife})(); return _scrml_result; })();`,
    );
    const req = { json: async () => ({ ids: [{ id: 1 }, { id: 2 }] }) };
    const sql = { unsafe: async (_q, keys) => keys.map((id) => ({ id, name: "n" + id })) };
    expect(await run(req, sql)).toEqual([{ id: 1, name: "n1" }, { id: 2, name: "n2" }]);
  });

  test("control: a `let` binder the body does NOT write keeps a `const` head (byte-identical)", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (let x of xs) {
            s = s + x
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (const x of xs)");
    expect(runF(r.clientJs, [1, 2])).toBe(3);
  });

  test("control: a nested `let x` inside the body takes the write; the binder stays `const`", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (let x of xs) {
            if (x > 0) {
                let x = 5
                x = x + 1
                s = s + x
            }
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (const x of xs)");
    expect(runF(r.clientJs, [1, 2])).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// (b) typer — an explicit `const` binder is immutable in EVERY loop
// ---------------------------------------------------------------------------

describe("(b) an explicit `const` loop binder is immutable — E-ASSIGN-004", () => {
  test("plain `for (const x of xs) { x = 1 }`", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (const x of xs) {
            x = 1
            s = s + x
        }
        return s
    }`));
    expect(assign004(r.fatal)).toEqual(["x@5"]);
  });

  test("destructured object `for (const { a } of rows) { a = a + 1 }`", () => {
    const r = compile(wrap(`    function f(rows) {
        let s = 0
        for (const { a } of rows) {
            a = a + 1
            s = s + a
        }
        return s
    }`));
    expect(assign004(r.fatal)).toEqual(["a@5"]);
  });

  test("destructured array, compound `+=`", () => {
    const r = compile(wrap(`    function f(pairs) {
        let s = 0
        for (const [k, v] of pairs) {
            v += 1
            s = s + k + v
        }
        return s
    }`));
    expect(assign004(r.fatal)).toEqual(["v@5"]);
  });

  test("the mirror: a `const` binder shadowing an outer `let` is still immutable", () => {
    const r = compile(wrap(`    function f(rows) {
        let name = ""
        for (const { name } of rows) {
            name = name + "!"
        }
        name = "outer-ok"
        return name
    }`));
    // Line 5 targets the const binder; line 7 targets the outer `let` (legal).
    expect(assign004(r.fatal)).toEqual(["name@5"]);
  });

  test("control: reading a `const` binder is clean and runs", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (const x of xs) {
            s = s + x
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, [4, 5])).toBe(9);
  });

  test("control: a member write through a `const` binder is not a rebind", () => {
    const r = compile(wrap(`    function f(rows) {
        for (const r of rows) {
            r.seen = 1
        }
        return rows
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, [{}, {}])).toEqual([{ seen: 1 }, { seen: 1 }]);
  });

  test("control: a nested `let` shadowing a `const` binder takes the write", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (const x of xs) {
            if (x > 0) {
                let x = 7
                x = x + 1
                s = s + x
            }
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, [1])).toBe(8);
  });

  test("control: a C-style counter is unaffected", () => {
    const r = compile(wrap(`    function f(n) {
        let s = 0
        for (let i = 0; i < n; i = i + 1) {
            s = s + i
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, 4)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// KEYWORDLESS binders — UNCHANGED, RULING PENDING
// ---------------------------------------------------------------------------

describe("keywordless `for (x of xs)` binder — UNCHANGED from base, RULING PENDING", () => {
  // ⚑ Whether a keywordless loop binder is mutable is a LANGUAGE ruling pending
  // with bryan (peter's Q1). Until it lands this change must not move it in
  // either direction. These rows pin today's behaviour, including that a
  // non-rendering write still lowers to the same `const x = x + 1` as base (a TDZ
  // at run time). When the ruling lands, REPLACE these rows — do not "fix" them.
  test("a non-rendering write: no E-ASSIGN-004, head and body lowering exactly as base", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (x of xs) {
            x = x + 1
            s = s + x
        }
        return s
    }`));
    expect(r.codes).not.toContain("E-ASSIGN-004");
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (const x of xs)");
    expect(r.clientJs).toContain("const x = x + 1;");
  });

  test("a keywordless binder that is only READ compiles and runs", () => {
    const r = compile(wrap(`    function f(xs) {
        let s = 0
        for (x of xs) {
            s = s + x
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, [1, 2, 3])).toBe(6);
  });
});
