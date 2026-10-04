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
