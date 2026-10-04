// error-model.test.js — s451 bootstrap unit Ue: the error model (SPEC §19) end
// to end — §66 source → parse → analyze (the binder's E-ERROR-* rules, the
// exhaustiveness of `!{}` / `match`, `?` compatibility) → lower (Stmt.Attempt /
// Stmt.Fail) → check (C-E1..C-E4) → print (`rt.fail` / `rt.failed`) → the
// slice runtime in happy-dom. Design: docs/changes/s451-boot-ue/DESIGN.md.
//
// Graded on tier 1 — the diagnostic CODES and the RUNTIME effect (D3). One
// describe per §19 normative statement; a `?{}` (server-placed) is graded by
// codes and Core only — the printer refuses a program with a query (U1c).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";
import * as rtDirect from "../slice-m1/runtime/runtime.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const sorted = (src) => codes(src).slice().sort();
const msg = (src, code) => (run(src).diags.find((d) => d.code === code) || { message: "" }).message;
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const v = (x) => (x && typeof x === "object" ? x.variant : x);
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
const SQ = "?" + "{";

// The error enum most tests use.
const TYPES = `    type LoadError:enum = { NotFound(id: string), Timeout }`;
// `load(id)` fails NotFound for "x", Timeout for "y", else succeeds with the id.
const LOAD = `    function load(id: string)! LoadError {\n        if (id == "x") fail LoadError.NotFound(id)\n        if (id == "y") fail LoadError.Timeout\n        return id\n    }`;

// A program: string cells log / out, int cell n, the given declarations, one button per name.
const P = (decls, buttons = [], extra = "") =>
  `<program>\n    let <log:string=""/>\n    let <out:string=""/>\n    let <n:int=0/>\n${decls}\n    <main>\n${buttons
    .map((b) => `        <button onclick=${b}()>${b}</button>`)
    .join("\n")}\n${extra}        <p id="log">\${@log}</p>\n        <p id="out">\${@out}</p>\n        <p id="n">\${@n}</p>\n    </main>\n</program>\n`;

let k = 0;
async function runProgram(decls, buttons, press) {
  const r = clean(P(decls, buttons));
  await loadProgram(r.core, "ue-" + k++);
  for (const b of press) click(btn(b));
  return { log: $("#log").textContent, out: $("#out").textContent, n: $("#n").textContent };
}

const DB = ` db="./app.db"`;
const PDB = (decls) => `<program${DB}>\n${decls}\n    <main><p>x</p></main>\n</program>\n`;

// ---------------------------------------------------------------------------
describe("§19.3 `fail` — returns the error value to the caller (runtime)", () => {
  test("a qualified `fail` reaches the caller's `!{}` arm with its payload", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{\n            | .NotFound(m) :> @log = "nf:" + m\n            | .Timeout :> @log = "t"\n        }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("nf:x");
  });

  test("the bare form `fail .V(args)` resolves against the declared `! E` (§19.3.3)", async () => {
    const o = await runProgram(`${TYPES}\n    function load(id: string)! LoadError {\n        if (id == "y") fail .Timeout\n        fail .NotFound(id)\n    }\n    function go() {\n        load("y") !{\n            | .NotFound(m) :> @log = "nf"\n            | .Timeout :> @log = "t"\n        }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("t");
  });

  test("`fail E::V` and `fail ::V` are the same forms (§19 alias note)", async () => {
    const o = await runProgram(`${TYPES}\n    function a()! LoadError {\n        fail LoadError::Timeout\n    }\n    function b()! LoadError {\n        fail ::NotFound("q")\n    }\n    function go() {\n        a() !{ | .Timeout :> @log = @log + "1" | _ :> @log = @log + "?" }\n        b() !{ | .NotFound(m) :> @log = @log + m | _ :> @log = @log + "?" }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("1q");
  });

  test("`fail` returns immediately: the statements after it do not run", async () => {
    const o = await runProgram(`${TYPES}\n    function a()! LoadError {\n        @log = "a"\n        fail .Timeout\n        @log = "unreachable"\n    }\n    function go() {\n        a() !{ | _ :> @n = 1 }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("a");
    expect(o.n).toBe("1");
  });

  test("a bare `!` function's error type is the built-in `Error` — `Generic(message)` (§19.4.2)", async () => {
    const o = await runProgram(`    function check(v: int)! {\n        if (v == 0) fail .Generic("zero")\n        return v\n    }\n    function go() {\n        check(0) !{ | .Generic(m) :> @log = m }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("zero");
  });

  test("`fail Error.Generic(…)` qualified, in a bare `!` function", () => {
    clean(P(`    function check()! {\n        fail Error.Generic("x")\n    }\n    function go() {\n        check() !{ | _ :> @n = 1 }\n    }`, ["go"]));
  });
});

describe("§19.3.3 — E-ERROR-001 / E-ERROR-009 / E-TYPE-082", () => {
  test("E-ERROR-001 — `fail` in a function not declared `!` (mirror: error/fail-outside-failable)", () => {
    expect(codes(P(`${TYPES}\n    function f() {\n        fail LoadError.Timeout\n    }`))).toEqual(["E-ERROR-001"]);
  });

  test("E-ERROR-001 — `fail` in an event handler (a handler is not a `!` function)", () => {
    expect(codes(P(TYPES, [], `        <button onclick={ fail LoadError.Timeout }>x</button>\n`))).toEqual(["E-ERROR-001"]);
  });

  test("E-ERROR-009 — a variant the declared enum does not have (mirror: error/fail-variant-undeclared-neg)", () => {
    expect(codes(P(`${TYPES}\n    function f()! LoadError {\n        fail LoadError.Nope\n    }`))).toEqual(["E-ERROR-009"]);
  });

  test("E-ERROR-009 — the bare form with an undeclared variant (mirror: error/fail-bare-variant-undeclared-neg)", () => {
    expect(codes(P(`${TYPES}\n    function f()! LoadError {\n        fail .Nope\n    }`))).toEqual(["E-ERROR-009"]);
  });

  test("E-ERROR-009 — a foreign enum entirely (mirror: error/fail-variant-foreign-enum-neg)", () => {
    expect(codes(P(`${TYPES}\n    type Other:enum = { Timeout }\n    function f()! LoadError {\n        fail Other.Timeout\n    }`))).toEqual(["E-ERROR-009"]);
  });

  test("E-ERROR-009 — a target that is not a variant (mirror: error/fail-non-enum-neg)", () => {
    const src = P(`${TYPES}\n    function f()! LoadError {\n        fail "just a string"\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-009"]);
    expect(codes(src)).not.toContain("E-ERROR-001");
  });

  test("E-TYPE-082 — too many, too few, a payload on a unit variant; never with E-ERROR-009", () => {
    expect(codes(P(`${TYPES}\n    function f()! LoadError {\n        fail .NotFound("a", "b")\n    }`))).toEqual(["E-TYPE-082"]);
    expect(codes(P(`${TYPES}\n    function f()! LoadError {\n        fail .NotFound\n    }`))).toEqual(["E-TYPE-082"]);
    expect(codes(P(`${TYPES}\n    function f()! LoadError {\n        fail .Timeout("x")\n    }`))).toEqual(["E-TYPE-082"]);
  });

  test("a payload value of the wrong type is a type error (the `fail` is a construction)", () => {
    expect(codes(P(`${TYPES}\n    function f()! LoadError {\n        fail .NotFound(42)\n    }`))).toEqual(["E-TYPE-031"]);
  });
});

describe("§19.4.4.1 — the error type SHALL be an enum (E-ERROR-011)", () => {
  for (const ty of ["string", "string[]", "int | not"]) {
    test(`\`! ${ty}\` → E-ERROR-011`, () => {
      expect(codes(P(`    function f()! ${ty} {\n        return 1\n    }`))).toEqual(["E-ERROR-011"]);
    });
  }
  test("the arrow form `! -> E` and the bare form `! E` are equivalent (S137)", () => {
    clean(P(`${TYPES}\n    function a()! -> LoadError {\n        fail .Timeout\n    }\n    function b()! LoadError {\n        fail .Timeout\n    }\n    function go() {\n        a() !{ | _ :> @n = 1 }\n        b() !{ | _ :> @n = 2 }\n    }`, ["go"]));
  });
  test("a failable function has no success-type slot: `)! E -> T` is a parse error (§19.4.1)", () => {
    expect(codes(P(`${TYPES}\n    function a()! LoadError -> int {\n        return 1\n    }`))).toContain("E-PARSE-FN");
  });
});

describe("§19.4.3 — a `!` call SHALL NOT be ignored (E-ERROR-002)", () => {
  test("a statement-position call", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("a")\n    }`))).toEqual(["E-ERROR-002"]);
  });
  test("a value-position call (`let x = f()`, an argument, a write's value)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        const x = load("a")\n    }`))).toEqual(["E-ERROR-002"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    fn id(s: string) -> string { return s }\n    function go() {\n        @out = id(load("a"))\n    }`))).toEqual(["E-ERROR-002"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        @out = load("a")\n    }`))).toEqual(["E-ERROR-002"]);
  });
  test("an event-handler call — bare and braced (S439 #14; mirror: error/handler-unhandled-failable-*)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}`, [], `        <button onclick=load("a")>x</button>\n`))).toEqual(["E-ERROR-002"]);
    expect(codes(P(`${TYPES}\n${LOAD}`, [], `        <button onclick={ load("a") }>x</button>\n`))).toEqual(["E-ERROR-002"]);
  });
  test("an event-handler REFERENCE to a `!` function (S441; mirror: error/handler-failable-reference-pos)", () => {
    const src = P(`${TYPES}\n    function risky()! LoadError {\n        fail .Timeout\n    }`, [], `        <button onclick=risky>x</button>\n`);
    expect(codes(src)).toEqual(["E-ERROR-002"]);
    expect(msg(src, "E-ERROR-002")).toContain("reference");
  });
  test("twin: a reference to a non-failable function is an ordinary handler", () => {
    clean(P(`    function ok() {\n        @n = 1\n    }`, [], `        <button onclick=ok>x</button>\n`));
  });
  test("a render-position call is E-ERROR-002 — the bootstrap has no `<errorBoundary>` (§19.4.3 item 4 needs one)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}`, [], `        <p>\${load("a")}</p>\n`))).toEqual(["E-ERROR-002"]);
  });
  test("a handled call in an event handler runs its arm (runtime)", async () => {
    const r = clean(P(`${TYPES}\n${LOAD}`, [], `        <button onclick={ load("x") !{ | .NotFound(m) :> @log = m | _ :> @log = "?" } }>h</button>\n`));
    await loadProgram(r.core, "ue-h" + k++);
    click(btn("h"));
    expect($("#log").textContent).toBe("x");
  });
});

describe("§19.5 `?` — propagation", () => {
  const OUTER = `    function outer(id: string)! LoadError {\n        const v = load(id)?\n        @log = @log + "after;"\n        return v\n    }`;

  test("success unwraps; the value flows on (mirror: error/propagate-success-unwrap)", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n${OUTER}\n    function go() {\n        @out = outer("ok") !{ | _ :> "failed" }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("ok");
    expect(o.log).toBe("after;");
  });

  test("a failure returns from the enclosing function at once and reaches the caller's arm (mirror: error/propagate-reaches-handler)", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n${OUTER}\n    function go() {\n        outer("x") !{\n            | .NotFound(m) :> @out = "nf:" + m\n            | .Timeout :> @out = "t"\n        }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("nf:x");
    expect(o.log).toBe("");
  });

  test("`return f()?` and a statement `f()?`", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function a(id: string)! LoadError {\n        return load(id)?\n    }\n    function b(id: string)! LoadError {\n        load(id)?\n        @n = @n + 1\n    }\n    function go() {\n        @out = a("y") !{ | .Timeout :> "T" | _ :> "?" }\n        b("ok") !{ | _ :> @n = 100 }\n        b("y") !{ | _ :> @n = @n + 10 }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("T");
    expect(o.n).toBe("11");
  });

  test("across two enums whose variants match by name and payload, the failure is re-tagged (§19.5.2's desugaring)", async () => {
    const o = await runProgram(`${TYPES}\n    type Outer:enum = { Timeout, NotFound(id: string), Other }\n${LOAD}\n    function outer(id: string)! Outer {\n        const v = load(id)?\n        return v\n    }\n    function go() {\n        outer("x") !{\n            | .NotFound(m) :> @out = "outer-nf:" + m\n            | _ :> @out = "?"\n        }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("outer-nf:x");
  });

  test("E-ERROR-003 — `?` in a function not declared `!` (mirror: error/propagate-in-non-failable-fn-pos)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        const v = load("a")?\n    }`))).toEqual(["E-ERROR-003"]);
  });

  test("E-ERROR-003 — `?` in an event handler", () => {
    expect(codes(P(`${TYPES}\n${LOAD}`, [], `        <button onclick={ load("a")? }>x</button>\n`))).toEqual(["E-ERROR-003"]);
  });

  test("E-ERROR-004 — `?` on a call of a function that cannot fail (mirror: error/propagate-non-failable-callee-pos)", () => {
    expect(codes(P(`${TYPES}\n    fn safe() -> int { return 1 }\n    function f()! LoadError {\n        const v = safe()?\n        return v\n    }`))).toEqual(["E-ERROR-004"]);
  });

  test("E-ERROR-010 — callee variants the enclosing enum lacks (mirror: error/propagate-incompat-variants)", () => {
    const src = P(`    type InnerError:enum = { Alpha, Beta }\n    type OuterError:enum = { Gamma }\n    function inner(x: int)! InnerError {\n        if (x < 0) fail .Alpha\n        return 1\n    }\n    function outer(x: int)! OuterError {\n        const v = inner(x)?\n        return v\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-010"]);
    expect(msg(src, "E-ERROR-010")).toContain("Alpha, Beta");
  });

  test("E-ERROR-010 — a same-named variant with a different payload", () => {
    expect(codes(P(`${TYPES}\n    type Outer:enum = { NotFound(code: int), Timeout }\n${LOAD}\n    function outer(id: string)! Outer {\n        return load(id)?\n    }`))).toEqual(["E-ERROR-010"]);
  });
});

describe("§19.7 — `match` on a failable result", () => {
  test("`.Ok(v)` + every error variant; statement arms (mirror: error/match-failable-ok-arm-rt)", async () => {
    const o = await runProgram(`    type DivErr:enum = { DivByZero }\n    function safeDiv(a: int, b: int)! DivErr {\n        if (b == 0) fail DivErr.DivByZero\n        return a - b\n    }\n    function okCase() {\n        match safeDiv(10, 2) {\n            .Ok(v) :> @n = v\n            .DivByZero :> @n = -1\n        }\n    }\n    function errCase() {\n        match safeDiv(10, 0) {\n            ::Ok(v) :> @log = "ok"\n            ::DivByZero :> @log = "ERR"\n        }\n    }`, ["okCase", "errCase"], ["okCase", "errCase"]);
    expect(o.n).toBe("8");
    expect(o.log).toBe("ERR");
  });

  test("a value-producing `match`: the Ok arm transforms, `else` covers the rest — the success value too", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function go() {\n        @out = match load("ok") {\n            .Ok(v) :> "got:" + v\n            else :> "none"\n        }\n        @log = match load("x") {\n            .Timeout :> "t"\n            else :> "other"\n        }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("got:ok");
    expect(o.log).toBe("other");
  });

  test("a wildcard-only `match` takes the success value through the wildcard arm (§19.7.3)", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function go() {\n        @out = match load("ok") {\n            _ :> "w"\n        }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("w");
  });

  test("E-TYPE-020 — a missing error variant (mirror: error/failable-match-nonexhaustive-err)", () => {
    const src = P(`    type LoadError2:enum = { NotFound, Timeout }\n    function loadThing(id: int)! LoadError2 {\n        if (id < 0) fail LoadError2.NotFound\n        return "ok"\n    }\n    function useIt(id: int) -> string {\n        return match loadThing(id) {\n            ::Ok(v) :> "ok"\n            ::NotFound :> "nf"\n        }\n    }`);
    expect(codes(src)).toEqual(["E-TYPE-020"]);
    expect(msg(src, "E-TYPE-020")).toContain("Timeout");
  });

  test("E-TYPE-020 — a missing `.Ok` (the success value is a variant to cover)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        match load("a") {\n            .NotFound(m) :> @n = 1\n            .Timeout :> @n = 2\n        }\n    }`))).toEqual(["E-TYPE-020"]);
  });

  test("a `match` over a value that cannot fail is the §18 match unit's — refused", () => {
    const src = P(`    type Mode:enum = { A, B }\n    function go(m: Mode) -> int {\n        return match m {\n            .A :> 1\n            .B :> 2\n        }\n    }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(msg(src, "E-BOOTSTRAP-UNSUPPORTED")).toContain("§18");
  });

  test("an error enum with a variant named `Ok` cannot be matched (ambiguous with the success arm) — refused", () => {
    expect(codes(P(`    type E:enum = { Ok, Bad }\n    function f()! E {\n        fail .Bad\n    }\n    function go() {\n        match f() {\n            .Ok :> @n = 1\n            else :> @n = 2\n        }\n    }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

describe("§19.4.3 item 3 / §34 E-TYPE-080 — `!{}` handlers", () => {
  const H = (arms) => P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{\n${arms}\n        }\n    }`);
  test("E-TYPE-080 — a handler that leaves a variant uncovered (mirror: error/handler-non-exhaustive)", () => {
    expect(codes(H(`            | .NotFound(m) :> @log = m`))).toEqual(["E-TYPE-080"]);
  });
  test("full enumeration is exhaustive (mirror: error/handler-exhaustive-neg)", () => {
    clean(H(`            | .NotFound(m) :> @log = m\n            | .Timeout :> @log = "t"`));
  });
  test("a `_` arm covers the rest (mirror: error/handler-wildcard-escape)", () => {
    clean(H(`            | .NotFound(m) :> @log = m\n            | _ :> @log = "other"`));
  });
  test("arms without the leading `|`, one per line", () => {
    clean(H(`            .NotFound(m) :> @log = m\n            .Timeout :> @log = "t"`));
  });
  test("E-TYPE-VARIANT — an arm naming no variant of the enum; `.Ok` in a `!{}`", () => {
    expect(codes(H(`            | .Nope :> @log = "n"\n            | _ :> @log = "o"`))).toEqual(["E-TYPE-VARIANT"]);
    expect(codes(H(`            | .Ok(v) :> @log = v\n            | _ :> @log = "o"`))).toEqual(["E-TYPE-VARIANT"]);
  });
  test("E-TYPE-021 — binders that do not match the payload", () => {
    expect(codes(H(`            | .NotFound(a, b) :> @log = a\n            | _ :> @log = "o"`))).toEqual(["E-TYPE-021"]);
    expect(codes(H(`            | .Timeout(a) :> @log = a\n            | _ :> @log = "o"`))).toEqual(["E-TYPE-021"]);
  });
  test("a payload arm written without binders binds nothing; `_` as a binder ignores a field", () => {
    clean(H(`            | .NotFound :> @log = "nf"\n            | .Timeout :> @log = "t"`));
    clean(H(`            | .NotFound(_) :> @log = "nf"\n            | .Timeout :> @log = "t"`));
  });
  test("a value-producing handler: the arm values are the fallbacks; a block arm may `return`", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function name(id: string) -> string {\n        const v = load(id) !{\n            | .NotFound(m) :> "missing " + m\n            | .Timeout :> { return "gave up" }\n        }\n        return "[" + v + "]"\n    }\n    function go() {\n        @log = name("ok") + name("x") + name("y")\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("[ok][missing x]gave up");
  });
  test("a handling form inside an arm — as a statement and as the arm's value (each Attempt names its own result)", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ :> load("y") !{ | _ :> @log = "inner" } }\n        @out = load("x") !{ | _ :> load("y") !{ | .Timeout :> "z" | _ :> "?" } }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("inner");
    expect(o.out).toBe("z");
  });

  test("one-line arms: `!{ | .A :> 1 | _ :> 2 }`", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function go() {\n        @out = load("y") !{ | .Timeout :> "t" | _ :> "?" }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("t");
  });
  test("W-MATCH-ARROW-LEGACY — the deprecated `=>` / `->` separators parse identically (warning, non-fatal)", async () => {
    const src = H(`            | .NotFound(m) => @log = m\n            | _ -> @log = "o"`);
    expect(codes(src)).toEqual(["W-MATCH-ARROW-LEGACY", "W-MATCH-ARROW-LEGACY"]);
    const r = run(src);
    expect(r.core == null).toBe(false);
  });
  // s452: S451 ruling 3 — E-ERROR-013 (error-rulings.test.js), no longer a refusal
  test("a handler on a call that cannot fail is E-ERROR-013", () => {
    expect(codes(P(`    fn safe() -> int { return 1 }\n    function go() {\n        safe() !{ | _ :> @n = 1 }\n    }`))).toEqual(["E-ERROR-013"]);
  });
});

describe("Ue2 — slice limits, refused (never accepted and ignored)", () => {
  test("a handled failable inside a larger expression (an argument, an operand)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    fn id(s: string) -> string { return s }\n    function go() {\n        @out = id(load("a") !{ | _ :> "z" })\n    }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go()! LoadError {\n        @out = "a" + load("a")?\n    }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  // s452: S451 ruling 1a decided these — E-ERROR-012 (error-rulings.test.js), no longer Ue2 refusals
  test("an arm that writes but yields no value, where the result is used as a value — E-ERROR-012", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        const r = load("x") !{ | _ :> @n = 1 }\n    }`))).toEqual(["E-ERROR-012"]);
  });
  test("a block arm that falls through, where the result is used as a value — E-ERROR-012", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        const r = load("x") !{ | _ :> { @n = 1 } }\n    }`))).toEqual(["E-ERROR-012"]);
  });
  // s452: the paren-free binder is the legacy spelling of `.V(m)` in a `!{}` arm (§19.4.3 ruling 2,
  // S452 ruling c) — accepted; error-rulings.test.js covers its arity and the `match` parse error
  test("a payload binder without parentheses (`| .V m :>`) binds the payload — accepted as the legacy spelling", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | .NotFound m :> @log = m | _ :> @log = "o" }\n    }`))).toEqual([]);
    // s452: `| _ e :>` is the whole-error binder (§18.6.1) — error-rulings.test.js
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ e :> @log = "o" }\n    }`))).toEqual([]);
  });
  test("`transaction { … }` names unit U1e", () => {
    const src = P(`${TYPES}\n    function f()! LoadError {\n        transaction {\n            @n = 1\n        }\n    }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(msg(src, "E-BOOTSTRAP-UNSUPPORTED")).toContain("U1e");
  });
});

describe("§19.8 — `SqlError` and the R11 rule (codes + Core; the printer refuses queries, U1c)", () => {
  const Q = `${SQ}\`SELECT a FROM t\`}.get()`;
  test("inside a `!` function a `?{}` propagates implicitly when the enum has every SqlError variant (§19.8.2)", () => {
    expect(codes(PDB(`    function f()! SqlError {\n        const r = ${Q}\n        return r\n    }`))).toEqual([]);
    expect(codes(PDB(`    type DbErr:enum = { QueryFailed(message: string), ConstraintViolation(field: string), ConnectionLost, Other }\n    function f()! DbErr {\n        const r = ${Q}\n        return r\n    }`))).toEqual([]);
  });
  test("E-ERROR-010 — inside a `!` function whose enum lacks SqlError's variants (§19.8.4)", () => {
    const src = PDB(`    type UserError:enum = { NotFound(id: string) }\n    function f()! UserError {\n        const r = ${Q}\n        return r\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-010"]);
    expect(msg(src, "E-ERROR-010")).toContain("QueryFailed");
  });
  test("handled at the site, a query needs no compatible enum", () => {
    expect(codes(PDB(`    type UserError:enum = { NotFound(id: string) }\n    function f()! UserError {\n        const r = ${Q} !{ | _ :> not }\n        if (r == not) fail .NotFound("x")\n        return r\n    }`))).toEqual([]);
  });
  test("the lowered implicit propagation: an Attempt over the query, one re-fail arm per SqlError variant", () => {
    const r = run(PDB(`    function f()! SqlError {\n        ${SQ}\`DELETE FROM t\`}.run()\n    }`));
    expect(r.diags).toEqual([]);
    const at = r.core.server[0].body.stmts[0];
    expect(v(at)).toBe("Attempt");
    expect(v(at.data.call)).toBe("FSql");
    expect(at.data.arms.map((a) => v(a.body.stmts[0]))).toEqual(["Fail", "Fail", "Fail"]);
    expect(r.core.sqlError.hint).toBe("SqlError");
    expect(mods.check.checkCore(r.core)).toEqual([]);
  });
  test("`match` on a query with SqlError arms; an arm naming no SqlError variant is E-TYPE-VARIANT", () => {
    expect(codes(PDB(`    function f() -> int {\n        return match ${Q} {\n            .Ok(row) :> 1\n            .QueryFailed(m) :> 2\n            _ :> 3\n        }\n    }`))).toEqual([]);
    expect(codes(PDB(`    function f() -> int {\n        return match ${Q} {\n            .Ok(row) :> 1\n            .Nope :> 2\n            _ :> 3\n        }\n    }`))).toEqual(["E-TYPE-VARIANT"]);
  });
  test("a `!{}` on a query that names only some SqlError variants is E-TYPE-080", () => {
    expect(codes(PDB(`    function f() {\n        const r = ${Q} !{ | .ConnectionLost :> not }\n    }`))).toEqual(["E-TYPE-080"]);
  });
  test("`?` on a query: inside a `!` function it is the implicit propagation; outside, E-ERROR-003", () => {
    expect(codes(PDB(`    function f()! SqlError {\n        const r = ${Q}?\n        return r\n    }`))).toEqual([]);
    expect(codes(PDB(`    function f() {\n        const r = ${Q}?\n    }`))).toEqual(["E-ERROR-003"]);
  });
  test("a query a `!` function would propagate from inside a larger expression — refused (Ue2)", () => {
    expect(codes(PDB(`    fn id(s: int) -> int { return s }\n    function f()! SqlError {\n        const r = id(${Q})\n        return r\n    }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("`SqlError` is built in: a user `type SqlError` is refused (§19.8.4 \"SHALL NOT redefine it\")", () => {
    expect(codes(P(`    type SqlError:enum = { A }`))).toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("a user enum named `Error` is legal and shadows the built-in by name", () => {
    clean(P(`    type Error:enum = { Mine }\n    function f()! Error {\n        fail .Mine\n    }\n    function go() {\n        f() !{ | .Mine :> @n = 1 }\n    }`, ["go"]));
  });
});

describe("§19.16 — `defer` on the `fail` / `?` exits", () => {
  test("a deferred body runs when the function `fail`s — before the caller's arm (§19.16.2 \"`fail` (§19.3)\")", async () => {
    const o = await runProgram(`${TYPES}\n    function a()! LoadError {\n        defer @log = @log + "d;"\n        @log = @log + "a;"\n        fail .Timeout\n    }\n    function go() {\n        a() !{ | _ :> @log = @log + "arm;" }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("a;d;arm;");
  });

  test("a deferred body runs on a `?` exit (§19.16.2 \"`?` propagation (§19.5)\")", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function a(id: string)! LoadError {\n        defer @log = @log + "d;"\n        const v = load(id)?\n        @log = @log + "after;"\n        return v\n    }\n    function go() {\n        a("x") !{ | _ :> @log = @log + "arm;" }\n        a("ok") !{ | _ :> @log = @log + "no;" }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("d;arm;after;d;");
  });

  test("a deferred body in a braced arm block runs at that block's exit", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{\n            | .NotFound(m) :> {\n                defer @log = @log + "d;"\n                @log = @log + "arm;"\n            }\n            | _ :> @log = "?"\n        }\n        @log = @log + "end;"\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("arm;d;end;");
  });

  test("E-DEFER-CONTROL-FLOW — `fail` / `?` / an arm's `return` inside a deferred body (§19.16.3 rule 1)", () => {
    expect(codes(P(`${TYPES}\n    function a()! LoadError {\n        defer fail .Timeout\n    }`))).toEqual(["E-DEFER-CONTROL-FLOW"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    function a()! LoadError {\n        defer {\n            const v = load("x")?\n        }\n    }`))).toEqual(["E-DEFER-CONTROL-FLOW"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    function a() {\n        defer load("x") !{ | _ :> { return } }\n    }`))).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });

  test("E-DEFER-UNHANDLED-FAILABLE — an unhandled failable call in a deferred body REPLACES E-ERROR-002, even inside a `!` function", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function a() {\n        defer load("x")\n    }`))).toEqual(["E-DEFER-UNHANDLED-FAILABLE"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    function a()! LoadError {\n        defer load("x")\n    }`))).toEqual(["E-DEFER-UNHANDLED-FAILABLE"]);
  });

  test("E-DEFER-UNHANDLED-FAILABLE — a deferred `!{}` without a catch-all `_` arm, even when it lists every variant", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function a() {\n        defer load("x") !{ | .NotFound(m) :> @log = m | .Timeout :> @log = "t" }\n    }`))).toEqual(["E-DEFER-UNHANDLED-FAILABLE"]);
  });

  test("a total deferred handler is legal and runs at the exit (mirror: defer/handled-failable-ok)", async () => {
    const o = await runProgram(`${TYPES}\n${LOAD}\n    function a() {\n        defer load("x") !{ | .NotFound(m) :> @log = @log + "nf:" + m | _ :> @log = @log + "?" }\n        @log = @log + "body;"\n    }`, ["a"], ["a"]);
    expect(o.log).toBe("body;nf:x");
  });

  test("E-DEFER-LATER-SHADOW reaches a deferred body inside an arm block", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        let w = 1\n        load("x") !{\n            | _ :> {\n                defer @n = w\n                const w = 2\n            }\n        }\n    }`))).toContain("E-DEFER-LATER-SHADOW");
  });
});

describe("the printed shape and the runtime half", () => {
  test("`fail` prints `return rt.failure(<value>)`; a handled call prints `rt.failed(…)` — no try/catch", () => {
    const r = clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ :> @n = 1 }\n    }`, ["go"]));
    const js = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js;
    expect(js).toContain(`return rt.failure({ variant: "NotFound", data: [id /* id */] });`);
    expect(js).toContain(`return rt.failure("Timeout");`);
    expect(js).toContain("rt.failed(");
    expect(js).not.toContain("catch");
  });

  test("rt.failed tells a failure from ANY success value — a lookalike object is a success", () => {
    expect(rtDirect.failed(rtDirect.failure("Timeout"))).toBe(true);
    expect(rtDirect.failed({ error: "Timeout" })).toBe(false);
    expect(rtDirect.failed(undefined)).toBe(false);
    expect(Object.isFrozen(rtDirect.failure({ tag: "A" }))).toBe(true);
  });

  test("a pure `fn` may be failable (§19.4.4)", async () => {
    const o = await runProgram(`${TYPES}\n    fn half(x: int)! LoadError {\n        if (x % 2 == 1) fail .Timeout\n        return x - 1\n    }\n    function go() {\n        @n = half(8) !{ | _ :> -1 }\n    }`, ["go"], ["go"]);
    expect(o.n).toBe("7");
  });
});

describe("S239 review fix round (114e6ef80)", () => {
  // HIGH-1: a payload field named like the discriminant overwrote it (`{ tag: "A", tag: "zz" }`)
  test("HIGH-1 — payload fields named `tag`, `variant`, `data` never touch the discriminant (runtime)", async () => {
    const o = await runProgram(`    type E:enum = { A(tag: string), B, C(x: int), D(variant: string, data: string) }\n    function f(k: int)! E {\n        if (k == 0) fail .A("zz")\n        if (k == 1) fail .D("v", "d")\n        if (k == 2) fail .C(7)\n        fail .B\n    }\n    function go() {\n        f(0) !{ | .A(t) :> @log = @log + "A:" + t + ";" | .C(x) :> @log = @log + "C;" | .B :> @log = @log + "B;" | .D(a, b) :> @log = @log + "D;" }\n        f(1) !{ | .A(t) :> @log = @log + "A;" | .C(x) :> @log = @log + "C;" | .B :> @log = @log + "B;" | .D(a, b) :> @log = @log + "D:" + a + b + ";" }\n        f(2) !{ | .A(t) :> @log = @log + "A;" | .C(x) :> @n = x | .B :> @log = @log + "B;" | .D(a, b) :> @log = @log + "D;" }\n        f(3) !{ | .A(t) :> @log = @log + "A;" | .C(x) :> @log = @log + "C;" | .B :> @log = @log + "B;" | .D(a, b) :> @log = @log + "D;" }\n    }`, ["go"], ["go"]);
    expect(o.log).toBe("A:zz;D:vd;B;");
    expect(o.n).toBe("7");
  });

  test("HIGH-1 — the printed value: `{ variant, data: [ … ] }`, no field name as a key", () => {
    const r = clean(P(`    type E:enum = { A(tag: string) }\n    function f()! E {\n        fail .A("zz")\n    }\n    function go() {\n        f() !{ | .A(t) :> @log = t }\n    }`, ["go"]));
    const js = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js;
    expect(js).toContain(`rt.failure({ variant: "A", data: ["zz" /* tag */] })`);
    expect(js).not.toContain("tag: ");
  });

  // HIGH-2: a function named without a call was lowered as `null`
  test("HIGH-2 — a function value (alias, return, argument) is refused, never lowered as `null`", () => {
    const ok = `    function ok() -> int {\n        return 3\n    }`;
    expect(codes(P(`${ok}\n    function go() {\n        const g = ok\n        @n = g()\n    }`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(codes(P(`${ok}\n    function go() -> int {\n        return ok\n    }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`${ok}\n    fn id(x: int) -> int { return x }\n    function go() {\n        @n = id(ok)\n    }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("HIGH-2 — a `!` function used as a value is E-ERROR-002 (its error would be dropped by whoever calls it)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        const g = load\n    }`))).toEqual(["E-ERROR-002"]);
  });

  test("HIGH-2 — an event-handler reference CALLS the function (bare and braced; it used to do nothing)", async () => {
    const r = clean(P(`    function bump() {\n        @n = @n + 1\n    }`, [], `        <button onclick=bump>a</button>\n        <button onclick={ bump }>b</button>\n`));
    await loadProgram(r.core, "ue-ref" + k++);
    click(btn("a"));
    click(btn("b"));
    expect($("#n").textContent).toBe("2");
  });

  test("HIGH-2 — a handler reference to a function with parameters is refused (the event would be its argument)", () => {
    expect(codes(P(`    function set(v: int) {\n        @n = v\n    }`, [], `        <button onclick=set>a</button>\n`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("MED-1 — E-TYPE-023: two `!{}` arms for one variant; two `.Ok` arms in a `match` (§18.8.1)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | .Timeout :> @n = 1 | .Timeout :> @n = 2 | _ :> @n = 3 }\n    }`))).toEqual(["E-TYPE-023"]);
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        match load("x") {\n            .Ok(v) :> @n = 1\n            .Ok(w) :> @n = 2\n            else :> @n = 3\n        }\n    }`))).toEqual(["E-TYPE-023"]);
  });

  // s452 r2: §18.6 names the code — "An `else` arm that is not the last arm SHALL be … E-SYNTAX-010"
  test("LOW-1 — an arm after the wildcard is E-SYNTAX-010 (the wildcard is last, §18.6)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ :> @n = 1 | .Timeout :> @n = 2 }\n    }`))).toEqual(["E-SYNTAX-010"]);
  });

  test("LOW-2 — `.V(args) :> fail E.V(args)` (§19.5.2's spelling) is a `fail` arm (runtime)", async () => {
    const o = await runProgram(`${TYPES}\n    type Outer:enum = { Lost(id: string), Slow }\n${LOAD}\n    function outer(id: string)! Outer {\n        const v = load(id) !{\n            | .NotFound(m) :> fail Outer.Lost(m)\n            | .Timeout :> fail .Slow\n        }\n        return v\n    }\n    function go() {\n        outer("x") !{ | .Lost(m) :> @out = "lost:" + m | .Slow :> @out = "slow" }\n    }`, ["go"], ["go"]);
    expect(o.out).toBe("lost:x");
  });
});

describe("check — the error model in Core (C-E1..C-E4)", () => {
  const base = () => clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{\n            | .NotFound(m) :> @log = m\n            | .Timeout :> @log = "t"\n        }\n    }`, ["go"])).core;
  const issues = (core, tag) => mods.check.checkCore(core).filter((s) => s.startsWith(tag));
  const goOf = (core) => core.fns.find((f) => f.sym.hint === "go");
  const withGo = (core, stmts) => ({ ...core, fns: core.fns.map((f) => (f.sym.hint === "go" ? { ...f, body: { stmts } } : f)) });

  test("C-E1 graft: a plain Call of a `!` function", () => {
    const core = base();
    const load = core.fns.find((f) => f.sym.hint === "load");
    const call = { variant: "Eval", data: { e: { variant: "Call", data: { callee: load.sym, args: [{ variant: "Lit", data: { lit: { variant: "Str", data: { v: "x" } } } }] } } } };
    expect(issues(withGo(core, [call]), "C-E1").length).toBe(1);
  });

  test("C-E2 graft (the bite of totality): an Attempt that drops an arm", () => {
    const core = base();
    const at = goOf(core).body.stmts[0];
    const cut = { ...at, data: { ...at.data, arms: at.data.arms.slice(0, 1) } };
    expect(issues(withGo(core, [cut]), "C-E2").length).toBe(1);
  });

  test("C-E3 graft: an Attempt with a result whose arm has no value and does not diverge", () => {
    const core = base();
    const at = goOf(core).body.stmts[0];
    const res = { ...at, data: { ...at.data, result: { id: 99999, hint: "res" } } };
    expect(issues(withGo(core, [res]), "C-E3").length).toBeGreaterThan(0);
  });

  test("C-E4 graft: a Fail in a function not declared `!`", () => {
    const core = base();
    const load = core.fns.find((f) => f.sym.hint === "load");
    const fail = load.body.stmts[0].data.thenB.stmts[0];
    expect(v(fail)).toBe("Fail");
    expect(issues(withGo(core, [fail]), "C-E4").length).toBe(1);
  });

  test("C16: a Fail inside a Defer body", () => {
    const core = base();
    const load = core.fns.find((f) => f.sym.hint === "load");
    const fail = load.body.stmts[0].data.thenB.stmts[0];
    const g = { ...core, fns: core.fns.map((f) => (f.sym.hint === "load" ? { ...f, body: { stmts: [{ variant: "Defer", data: { body: { stmts: [fail] } } }, ...f.body.stmts] } } : f)) };
    expect(issues(g, "C16").length).toBe(1);
  });
});
