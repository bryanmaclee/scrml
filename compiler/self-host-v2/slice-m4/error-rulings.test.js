// error-rulings.test.js — s452 bootstrap: the S451 error-model rulings (SPEC
// #1266-#1269) — E-ERROR-012 (a value-position arm that falls through),
// E-ERROR-013 (`!{}` on something that cannot fail), E-ERROR-014 (a `!{}`
// attached to nothing, in markup), E-ERROR-015 (manual transaction SQL outside
// a `!` function), E-MATCH-BARE-BINDER, the whole-error binder `| _ err :>`
// (§18.6.1), and `<db src>` database resolution (§8.1.1 as amended S451).
// Design: docs/changes/s452-boot-rulings/DESIGN.md.
//
// Graded on tier 1 — the diagnostic CODES (and that no Core is produced when an
// Error fires), and the RUNTIME effect where the printer can print the program
// (a program with a `?{}` is refused by the printer until U1c: codes + Core).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const msg = (src, code) => (run(src).diags.find((d) => d.code === code) || { message: "" }).message;
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
// An Error-severity diagnostic SHALL leave no artifact (§34, §2.2.1): no Core.
const rejected = (src, code) => {
  const r = run(src);
  expect(r.diags.map((d) => d.code)).toContain(code);
  expect(r.core == null).toBe(true);
  return r;
};
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
const SQ = "?" + "{";

const TYPES = `    type LoadError:enum = { NotFound(id: string), Timeout }`;
const LOAD = `    function load(id: string)! LoadError {\n        if (id == "x") fail LoadError.NotFound(id)\n        if (id == "y") fail LoadError.Timeout\n        return id\n    }`;

const P = (decls, buttons = [], extra = "") =>
  `<program>\n    let <log:string=""/>\n    let <out:string=""/>\n    let <n:int=0/>\n${decls}\n    <main>\n${buttons
    .map((b) => `        <button onclick=${b}()>${b}</button>`)
    .join("\n")}\n${extra}        <p id="log">\${@log}</p>\n        <p id="out">\${@out}</p>\n        <p id="n">\${@n}</p>\n    </main>\n</program>\n`;

let k = 0;
async function load(src, expose = []) {
  const r = clean(src);
  return loadProgram(r.core, "rulings-" + k++, expose);
}
// The first Attempt statement of a function's body (its payload).
const attemptOf = (fn) => fn.body.stmts.find((s) => s.variant === "Attempt").data;
const text = () => ({ log: $("#log").textContent, out: $("#out").textContent, n: $("#n").textContent });

// ---------------------------------------------------------------------------
describe("§18.6.1 — the whole-error binder `| _ err :>`", () => {
  const CATCH = `    function caught(id: string) -> LoadError {\n        load(id) !{ | _ err :> { return err } }\n        return .Timeout\n    }`;

  test("in a `!{}` arm, `err` is the WHOLE error value — variant and payload (runtime)", async () => {
    const { program } = await load(P(`${TYPES}\n${LOAD}\n${CATCH}`), ["caught"]);
    expect(program.caught("x")).toEqual({ variant: "NotFound", data: ["x"] });
    expect(program.caught("y")).toBe("Timeout");
  });

  test("after earlier arms it takes only the variants they left (runtime)", async () => {
    const { program } = await load(P(`${TYPES}\n${LOAD}\n    function rest(id: string) -> LoadError {\n        load(id) !{\n            | .NotFound(m) :> @log = "nf:" + m\n            | _ err :> {\n                @n = 7\n                return err\n            }\n        }\n        return .Timeout\n    }`), ["rest"]);
    expect(program.rest("x")).toBe("Timeout");
    expect(text().log).toBe("nf:x");
    expect(text().n).toBe("0");
    expect(program.rest("y")).toBe("Timeout");
    expect(text().n).toBe("7");
  });

  test("in a `match` on a failable result it binds an ERROR, never the success value (runtime)", async () => {
    const { program } = await load(P(`${TYPES}\n${LOAD}\n    function viaMatch(id: string) -> LoadError {\n        match load(id) {\n            .Ok(v) :> @log = "ok:" + v\n            _ err :> { return err }\n        }\n        return .Timeout\n    }`), ["viaMatch"]);
    expect(program.viaMatch("x")).toEqual({ variant: "NotFound", data: ["x"] });
    expect(program.viaMatch("a")).toBe("Timeout");
    expect(text().log).toBe("ok:a");
  });

  test("`_ err` does not cover `.Ok`: a `match` without `.Ok` is E-TYPE-020 (§18.6.1)", () => {
    const src = P(`${TYPES}\n${LOAD}\n    function go() {\n        match load("a") {\n            _ err :> @n = 1\n        }\n    }`);
    expect(codes(src)).toEqual(["E-TYPE-020"]);
    expect(msg(src, "E-TYPE-020")).toContain("Ok");
  });

  test("a plain `_` still takes the success value too (§19.7.3, unchanged)", () => {
    clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        match load("a") {\n            _ :> @n = 1\n        }\n    }`));
  });

  test("it is the wildcard: a `!{}` with only `| _ err :>` is exhaustive; a deferred one is total (§19.16.3 r3)", () => {
    clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ err :> @n = 1 }\n    }`));
    clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        defer load("x") !{ | _ err :> @n = 2 }\n        @n = 1\n    }`));
  });

  test("its static type is the whole error enum: assigning it to a string is a type error, returning it as the enum is not", () => {
    const bad = codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ err :> @out = err }\n    }`));
    expect(bad.length).toBe(1);
    expect(bad[0]).toMatch(/^E-TYPE-/);
    clean(P(`${TYPES}\n${LOAD}\n${CATCH}`));
  });

  test("Core: the arm is a PWild ErrArm with `whole` = the binder's Sym; the printed arm binds `<raw>.error`", () => {
    const r = clean(P(`${TYPES}\n${LOAD}\n${CATCH}`));
    const fn = r.core.fns.find((f) => f.sym.hint === "caught");
    const arms = attemptOf(fn).arms;
    expect(arms.length).toBe(1);
    expect(arms[0].whole && arms[0].whole.hint).toBe("err");
    const js = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js;
    expect(js).toMatch(/const err\w* = \w+\.error;/);
  });

  test("check C-E2: a `whole` binder on a variant arm is rejected", () => {
    const r = clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{\n            | .NotFound(m) :> @n = 1\n            | _ err :> @n = 2\n        }\n    }`));
    const fn = r.core.fns.find((f) => f.sym.hint === "go");
    const arms = attemptOf(fn).arms;
    arms[0].whole = arms[1].whole;
    expect(mods.check.checkCore(r.core).join("\n")).toContain("C-E2: an Attempt arm binds the whole error but is not the wildcard");
  });

  test("on a `?{}` the binder is a SqlError (codes + Core; the printer refuses queries, U1c)", () => {
    const r = clean(`<program db="./app.db">\n    function f() -> int {\n        ${SQ}\`DELETE FROM t\`}.run() !{ | _ err :> { return 0 } }\n        return 1\n    }\n    <main><p>x</p></main>\n</program>\n`);
    const fn = r.core.server.find((f) => f.sym.hint === "f");
    const a = attemptOf(fn);
    expect(a.err.hint).toBe("SqlError");
    expect(a.arms[0].whole.hint).toBe("err");
  });
});

describe("§18.2 / §18.6.1 — E-MATCH-BARE-BINDER", () => {
  test("a bare name as a `!{}` arm's whole pattern (`| err :>`) — one report, no E-SCOPE-001 / E-TYPE-080 cascade", () => {
    const src = P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | err :> @log = "e" }\n    }`);
    expect(codes(src)).toEqual(["E-MATCH-BARE-BINDER"]);
    expect(msg(src, "E-MATCH-BARE-BINDER")).toBe("Arm pattern 'err' is a bare name. To bind the whole error, write '_ err' (e.g. '| _ err :>'); for a catch-all that binds nothing write '_' (or 'else'); or name the variant ('.V(x)') to bind its payload.");
    rejected(src, "E-MATCH-BARE-BINDER");
  });

  test("a bare name in a `match` on a failable result (`err :>`)", () => {
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        match load("x") {\n            .Ok(v) :> @log = v\n            err :> @n = 1\n        }\n    }`))).toEqual(["E-MATCH-BARE-BINDER"]);
  });

  test("`else <name>` — in a `!{}` and in a `match` (it offers `_ <name>`)", () => {
    const src = P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | else err :> @n = 1 }\n    }`);
    expect(codes(src)).toEqual(["E-MATCH-BARE-BINDER"]);
    expect(msg(src, "E-MATCH-BARE-BINDER")).toContain("'_ err'");
    expect(codes(P(`${TYPES}\n${LOAD}\n    function go() {\n        match load("x") {\n            .Ok(v) :> @log = v\n            else err :> @n = 1\n        }\n    }`))).toEqual(["E-MATCH-BARE-BINDER"]);
  });

  test("`_ <name>` on a `match` whose subject is NOT a failable result (the §18 match unit stays refused beside it)", () => {
    const src = P(`    type Mode:enum = { A, B }\n    function go(m: Mode) -> int {\n        return match m {\n            .A :> 1\n            _ rest :> 2\n        }\n    }`);
    expect(codes(src).slice().sort()).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-MATCH-BARE-BINDER"]);
    expect(msg(src, "E-MATCH-BARE-BINDER")).toContain("only where that value is an error");
  });

  test("a bare name on a non-failable `match` takes §18.2's plain message", () => {
    const src = P(`    type Mode:enum = { A, B }\n    function go(m: Mode) -> int {\n        return match m {\n            .A :> 1\n            other :> 2\n        }\n    }`);
    expect(msg(src, "E-MATCH-BARE-BINDER")).toBe("Arm pattern 'other' is a bare name. A match arm does not bind the whole value: write '_' (or 'else') for a catch-all, or name the variant ('.V(x)') to bind its payload.");
  });

  test("near-miss: `| _ :>` and `| _ err :>` compile", () => {
    clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        load("x") !{ | _ :> @n = 1 }\n        load("y") !{ | _ err :> @n = 2 }\n    }`));
  });
});

describe("§19.4.3 ruling 1a — E-ERROR-012: in a value position every arm yields a value or leaves", () => {
  const go = (body, buttons = ["go"]) => P(`${TYPES}\n${LOAD}\n    function noop() {\n        @n = 1\n    }\n    function vd() -> void {\n        @n = 2\n    }\n${body}`, buttons);

  test("an arm that writes (`let r = f() !{ | _ :> @n = 1 }`) — the SPEC's message, no Core", () => {
    const src = go(`    function go() {\n        const r = load("x") !{ | _ :> @n = 1 }\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-012"]);
    expect(msg(src, "E-ERROR-012")).toBe("Arm '_' of the handler on 'load(…)' produces no value, but the handler's result is used here (the initializer of `r`). In a value position every arm must yield a value of 'load's success type or leave with 'return' / 'fail'. End the arm with a fallback value (e.g. '| _ :> { @phase = …; fallback }'), leave with 'return', or call 'load(…) !{ … }' as a statement and keep the writes in its arms.");
    rejected(src, "E-ERROR-012");
  });

  test("every value position: an assignment's right-hand side, a `return` operand", () => {
    expect(msg(go(`    function go() {\n        @log = load("x") !{ | _ :> @n = 1 }\n    }`), "E-ERROR-012")).toContain("(the right-hand side of an assignment)");
    expect(msg(go(`    function go() -> string {\n        return load("x") !{ | _ :> @n = 1 }\n    }`), "E-ERROR-012")).toContain("(a `return` operand)");
  });

  test("a call that yields nothing: no `return <value>` in its body, `-> void`, `reset(@x)`", () => {
    expect(codes(go(`    function go() {\n        const r = load("x") !{ | _ :> noop() }\n    }`))).toEqual(["E-ERROR-012"]);
    expect(codes(go(`    function go() {\n        @log = load("x") !{ | _ :> vd() }\n    }`))).toEqual(["E-ERROR-012"]);
    expect(codes(go(`    function go() {\n        const r = load("x") !{ | _ :> reset(@n) }\n    }`))).toEqual(["E-ERROR-012"]);
  });

  test("a block arm whose last statement is not an expression: a write, a declaration, a non-leaving `if`, an empty block", () => {
    expect(codes(go(`    function go() {\n        const r = load("x") !{ | _ :> { @n = 1 } }\n    }`))).toEqual(["E-ERROR-012"]);
    expect(codes(go(`    function go() -> string {\n        return load("x") !{ | _ :> {\n            const q = "a"\n        } }\n    }`))).toEqual(["E-ERROR-012"]);
    expect(codes(go(`    function go() -> string {\n        const r = load("x") !{ | _ :> {\n            if (@n == 0) { return "a" }\n        } }\n        return r\n    }`))).toEqual(["E-ERROR-012"]);
    expect(codes(go(`    function go() {\n        @log = load("x") !{ | _ :> { } }\n    }`))).toEqual(["E-ERROR-012"]);
  });

  test("one report per falling arm; the arm is named by its pattern", () => {
    const src = go(`    function go() {\n        const r = load("x") !{\n            | .NotFound(mid) :> @log = mid\n            | .Timeout :> @n = 1\n        }\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-012", "E-ERROR-012"]);
    const ms = run(src).diags.map((d) => d.message);
    expect(ms[0]).toContain("Arm '.NotFound(mid)'");
    expect(ms[1]).toContain("Arm '.Timeout'");
  });

  test("a `match` on a failable result in a value position — the `.Ok(v)` arm is an arm like any other", () => {
    const src = go(`    function go() -> string {\n        return match load("x") {\n            .Ok(v) :> @log = v\n            else :> "e"\n        }\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-012"]);
    expect(msg(src, "E-ERROR-012")).toContain("Arm '.Ok(v)' of the match on 'load(…)'");
  });

  test("on a `?{}` query the message names the query (codes only — the printer refuses queries, U1c)", () => {
    const src = `<program db="./app.db">\n    function f() -> int {\n        const r = ${SQ}\`SELECT a FROM t\`}.get() !{ | _ :> { const z = 1 } }\n        return 1\n    }\n    <main><p>x</p></main>\n</program>\n`;
    expect(codes(src)).toEqual(["E-ERROR-012"]);
    expect(msg(src, "E-ERROR-012")).toContain("the `" + SQ + "}` query");
  });

  test("near-miss: statement position MAY fall through (runtime)", async () => {
    await load(go(`    function go() {\n        load("x") !{ | _ :> @n = 5 }\n    }`));
    click(btn("go"));
    expect(text().n).toBe("5");
  });

  test("a block arm yields its LAST EXPRESSION (§18.5), its statements run first (runtime)", async () => {
    await load(go(`    function go() {\n        const r = load("x") !{ | _ :> {\n            @n = 1\n            "z"\n        } }\n        const s = load("ok") !{ | _ :> {\n            @n = 2\n            "never"\n        } }\n        @log = r + s\n    }`));
    click(btn("go"));
    expect(text().log).toBe("zok");
    expect(text().n).toBe("1");
  });

  test("a block arm's value may read its own locals, and its `defer` runs after the value is taken (runtime)", async () => {
    await load(go(`    function go() {\n        @log = load("x") !{ | _ :> {\n            const t = "v"\n            defer @n = @n + 10\n            @n = 1\n            t + "!"\n        } }\n    }`));
    click(btn("go"));
    expect(text().log).toBe("v!");
    expect(text().n).toBe("11");
  });

  test("a block arm whose last expression is a handling form: its own Attempt, then its value (runtime)", async () => {
    await load(go(`    function go() {\n        @log = load("x") !{ | _ :> {\n            @n = 3\n            load("y") !{ | _ :> "inner" }\n        } }\n    }`));
    click(btn("go"));
    expect(text().log).toBe("inner");
    expect(text().n).toBe("3");
  });

  test("arms that leave (`return` / `fail` / an `if` both of whose branches leave) need no value (runtime)", async () => {
    const { program } = await load(go(`    function pick(id: string) -> string {\n        const r = load(id) !{\n            | .NotFound(m) :> { return "nf:" + m }\n            | .Timeout :> {\n                if (@n == 0) { return "t0" } else { return "t1" }\n            }\n        }\n        return "ok:" + r\n    }\n    function relay(id: string)! LoadError {\n        const r = load(id) !{ | .NotFound(m) :> { fail .NotFound(m) } | .Timeout :> "t" }\n        return r\n    }`, []), ["pick"]);
    expect(program.pick("x")).toBe("nf:x");
    expect(program.pick("y")).toBe("t0");
    expect(program.pick("a")).toBe("ok:a");
  });

  test("a call of a function that returns a value is a value", () => {
    clean(go(`    fn d() -> string { return "q" }\n    function e() { return "w" }\n    function go() {\n        @log = load("x") !{ | .NotFound(m) :> d() | .Timeout :> e() }\n    }`));
  });
});

describe("§19.4.3 ruling 3 — E-ERROR-013: a `!{}` on something that cannot fail", () => {
  test("a call of an ordinary function — the SPEC's message, no Core", () => {
    const src = P(`    fn parseCount(src: string) -> int { return src.length }\n    function show(src: string) {\n        let n = parseCount(src) !{ | _ :> 0 }\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-013"]);
    expect(msg(src, "E-ERROR-013")).toBe("'!{}' handler on 'parseCount(…)', which cannot fail: 'parseCount' is not a failable function, so none of its arms can run. Remove the '!{ … }' handler, or declare 'parseCount' with '!' if it can fail.");
    rejected(src, "E-ERROR-013");
  });

  test("statement position too (the handler is dead wherever it stands)", () => {
    expect(codes(P(`    fn safe() -> int { return 1 }\n    function go() {\n        safe() !{ | _ :> @n = 1 }\n    }`))).toEqual(["E-ERROR-013"]);
  });

  test("an expression that is not a call (`let data = not !{ … }`) — the message names the expression", () => {
    const src = P(`    function go() {\n        let data = not !{ | _ :> 1 }\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-013"]);
    expect(msg(src, "E-ERROR-013")).toContain("'!{}' handler on 'not', which cannot fail");
  });

  test("a host call (`Date.now()`) cannot fail either", () => {
    const src = P(`    function go() {\n        @n = Date.now() !{ | _ :> 0 }\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-013"]);
  });

  test("a name that does not resolve is reported once (E-SCOPE-001 — e.g. the built-in `parseVariant` the bootstrap lacks)", () => {
    expect(codes(P(`    function go() {\n        @n = nope(1) !{ | _ :> 0 }\n    }`))).toEqual(["E-SCOPE-001"]);
  });

  test("a function whose body can place it on the server: a client call of it is failable (§19.9.10) — refused (U1b), never E-ERROR-013", () => {
    const src = `<program db="./app.db">\n    let <n:int=0/>\n    function count() -> int {\n        const r = ${SQ}\`SELECT 1 AS a\`}.get() !{ | _ :> not }\n        return 1\n    }\n    function go() {\n        @n = count() !{ | _ :> 0 }\n    }\n    <main><button onclick=go()>go</button></main>\n</program>\n`;
    const cs = codes(src);
    expect(cs).not.toContain("E-ERROR-013");
    expect(cs).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(msg(src, "E-BOOTSTRAP-UNSUPPORTED")).toContain("§19.9.10");
  });

  test("a `match` on a non-failable value is not affected (the §18 `match` unit — refused as before)", () => {
    const src = P(`    type Mode:enum = { A, B }\n    function go(m: Mode) -> int {\n        return match m {\n            .A :> 1\n            .B :> 2\n        }\n    }`);
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("near-miss: a `!{}` on a `!` call and on a `?{}` compile", () => {
    clean(P(`${TYPES}\n${LOAD}\n    function go() {\n        @log = load("x") !{ | _ :> "z" }\n    }`));
    expect(codes(`<program db="./app.db">\n    function f() -> int {\n        ${SQ}\`DELETE FROM t\`}.run() !{ | _ :> { return 0 } }\n        return 1\n    }\n    <main><p>x</p></main>\n</program>\n`)).toEqual([]);
  });
});

describe("§19.4.3 — E-ERROR-014: a `!{}` written as markup content, attached to nothing", () => {
  test("inside an element — the SPEC's message, no Core", () => {
    const src = `<program>\n    <div>\n        !{\n            | _ :> <p class="error">Something went wrong</p>\n        }\n        <p>Content</p>\n    </div>\n</program>\n`;
    expect(codes(src)).toEqual(["E-ERROR-014"]);
    expect(msg(src, "E-ERROR-014")).toBe("'!{}' handler attached to nothing: a '!{ … }' handler handles the failure of the call written immediately before it. Attach it to a call ('save() !{ … }'), use a '<request>' and read '<#id>.error' for a load, or wrap render-time calls in an '<errorBoundary>'.");
    rejected(src, "E-ERROR-014");
  });

  test("after an element, at the program body top", () => {
    expect(codes(`<program>\n    <main><p>x</p></main>\n    !{\n        | _ :> <p>bad</p>\n    }\n</program>\n`)).toEqual(["E-ERROR-014"]);
  });

  test("near-miss: a handler attached to a call in an event-handler body compiles", () => {
    clean(P(`${TYPES}\n${LOAD}`, [], `        <button onclick={ load("x") !{ | _ :> @n = 1 } }>go</button>\n`));
  });
});

describe("§19.10.4 — E-ERROR-015: manual transaction control outside a `!` function", () => {
  const DBP = (body) => `<program db="./app.db">\n${body}\n    <main><p>x</p></main>\n</program>\n`;
  const H = (sql) => `${SQ}\`${sql}\`}.run() !{ | _ :> { return 0 } }`;

  test("`?{BEGIN}` in a function without `!` — the SPEC's message, no Core", () => {
    const src = DBP(`    function plain() -> int {\n        ${H("BEGIN")}\n        return 1\n    }`);
    expect(codes(src)).toEqual(["E-ERROR-015"]);
    expect(msg(src, "E-ERROR-015")).toBe("Manual transaction control 'BEGIN' in 'plain', which is not declared '!'. A transaction is '!'-gated (§19.10.4): its rollback promise needs a failure path. Declare 'plain' with '!' and use 'transaction { … }' (§19.10.2), which commits or rolls back on every exit.");
    rejected(src, "E-ERROR-015");
  });

  test("every transaction-control statement, in any form, after leading comments and whitespace", () => {
    for (const sql of ["BEGIN", "begin transaction", "BEGIN IMMEDIATE", "COMMIT", "END", "ROLLBACK", "ROLLBACK TO sp1", "SAVEPOINT sp1", "RELEASE sp1", "  -- start\n  BEGIN", "/* x */ COMMIT"]) {
      expect([sql, codes(DBP(`    function plain() -> int {\n        ${H(sql)}\n        return 1\n    }`))]).toEqual([sql, ["E-ERROR-015"]]);
    }
  });

  test("an unhandled one is ALSO E-ERROR-002 (the R11 rule — a different rule; both fire)", () => {
    expect(codes(DBP(`    function plain() {\n        ${SQ}\`COMMIT\`}.run()\n    }`)).slice().sort()).toEqual(["E-ERROR-002", "E-ERROR-015"]);
  });

  test("near-miss: inside a `!` function it stays valid; an ordinary statement is not transaction control", () => {
    expect(codes(DBP(`    function tx()! SqlError {\n        ${SQ}\`BEGIN\`}.run()\n        ${SQ}\`COMMIT\`}.run()\n    }`))).toEqual([]);
    expect(codes(DBP(`    function plain() -> int {\n        ${H("UPDATE t SET a = 1")}\n        ${H("SELECT ending FROM t")}\n        return 1\n    }`))).toEqual([]);
  });
});

describe("§8.1.1 (S451) — `<db src>` database scopes: the nearest scope wins; E-SQL-004 whatever the count", () => {
  // f(): a server function whose query is handled at the site; returns 1.
  const FN = (name = "f") => `    function ${name}() -> int {\n        ${SQ}\`DELETE FROM t\`}.run() !{ | _ :> { return 0 } }\n        return 1\n    }`;
  const dbOfQuery = (r, fname = "f") => {
    const fn = r.core.server.find((x) => x.sym.hint === fname);
    const at = attemptOf(fn);
    const db = r.core.dbs.find((d) => d.sym.id === at.call.data.q.db.id);
    return db && db.target;
  };

  test("ruling 11a — a `<program>` without `db=` whose ONE direct child is `<db src>`: its functions run on that database", () => {
    const r = clean(`<program>\n    <db src="./app.db">\n        <p>in the db block</p>\n    </db>\n${FN()}\n    <main><p>x</p></main>\n</program>\n`);
    expect(dbOfQuery(r)).toBe("./app.db");
    expect(r.core.dbs.length).toBe(1);
  });

  test("a direct-child `<db src>` of a `<program db=>` does not change the program's database", () => {
    const r = clean(`<program db="./a.db">\n    <db src="./b.db">\n        <p>b</p>\n    </db>\n${FN()}\n    <main><p>x</p></main>\n</program>\n`);
    expect(dbOfQuery(r)).toBe("./a.db");
    expect(r.core.dbs.map((d) => d.target).sort()).toEqual(["./a.db", "./b.db"]);
  });

  test("two direct-child `<db src>`: NONE supplies — a function's query has no scope (E-SQL-004)", () => {
    expect(codes(`<program>\n    <db src="./a.db"><p>a</p></db>\n    <db src="./b.db"><p>b</p></db>\n${FN()}\n    <main><p>x</p></main>\n</program>\n`)).toEqual(["E-SQL-004"]);
  });

  test("a `<db src>` nested deeper (not a direct child) does not supply the program", () => {
    expect(codes(`<program>\n    <main>\n        <db src="./a.db"><p>a</p></db>\n    </main>\n${FN()}\n</program>\n`)).toEqual(["E-SQL-004"]);
  });

  test("an unscoped `?{}` is E-SQL-004 — with the S451 message (no database scope of any kind)", () => {
    const src = `<program>\n${FN()}\n    <main><p>x</p></main>\n</program>\n`;
    expect(codes(src)).toEqual(["E-SQL-004"]);
    expect(msg(src, "E-SQL-004")).toContain("no database scope");
  });

  // (A nested `<program>` — §4.12 — is refused by the bootstrap, so the
  // program-in-program half of "nearest" has no runnable case here.)

  test("a `?{}` in a markup position inside a `<db src>` is resolved by position (no E-SQL-004 — it is refused for running in a value position, §13.7)", () => {
    const inDb = codes(`<program>\n    let <n:int=0/>\n    <main>\n        <db src="./a.db">\n            <p>\${${SQ}\`SELECT 1 AS a\`}.get() !{ | _ :> not }}</p>\n        </db>\n    </main>\n</program>\n`);
    expect(inDb).not.toContain("E-SQL-004");
    expect(inDb).toContain("E-VALUE-SERVER-CALL");
    const outside = codes(`<program>\n    let <n:int=0/>\n    <main>\n        <db src="./a.db"><p>a</p></db>\n        <p>\${${SQ}\`SELECT 1 AS a\`}.get() !{ | _ :> not }}</p>\n    </main>\n</program>\n`);
    expect(outside).toContain("E-SQL-004");
  });

  test("`src=` is checked like `db=` (E-SQL-005), and must be a literal", () => {
    const src = `<program>\n    <db src="mongodb://x/y"><p>a</p></db>\n    <main><p>x</p></main>\n</program>\n`;
    expect(codes(src)).toEqual(["E-SQL-005"]);
    expect(msg(src, "E-SQL-005")).toContain("`src=");
  });

  test("`tables=` / `protect=` / other attributes / a missing `src=` are refused, never ignored", () => {
    const t = codes(`<program>\n    <db src="./a.db" tables="users" protect="passwordHash"><p>a</p></db>\n    <main><p>x</p></main>\n</program>\n`);
    expect(t).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(`<program>\n    <db><p>a</p></db>\n    <main><p>x</p></main>\n</program>\n`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("the printer still refuses a program whose queries need the server artifact (U1c)", () => {
    const r = clean(`<program>\n    <db src="./app.db"><p>a</p></db>\n${FN()}\n    <main><p>x</p></main>\n</program>\n`);
    const out = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js");
    expect(out.js).toBe("");
    expect(out.refused.join("\n")).toContain("U1c");
  });

  test("near-miss: a `<db src>` direct-child program with no query compiles and RUNS; its children render in place; no connection string reaches the client (runtime)", async () => {
    const src = `<program>\n    let <n:int=0/>\n    <db src="./secret-app.db">\n        <p id="inside">inside \${@n}</p>\n        <button onclick=bump()>bump</button>\n    </db>\n    function bump() {\n        @n = @n + 1\n    }\n</program>\n`;
    const { out } = await load(src);
    expect(out.js).not.toContain("secret-app");
    expect(out.html).not.toContain("secret-app");
    expect(document.querySelector("db")).toBe(null);
    click(btn("bump"));
    expect($("#inside").textContent).toBe("inside 1");
  });
});
