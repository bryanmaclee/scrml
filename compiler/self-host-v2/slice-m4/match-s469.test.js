// match-s469.test.js — s469: blockers #4 and #5 of the "can bryan write today's
// scrml" measurement (scrml-support/docs/workability/today-scrml-distance-2026-10-18.md
// §4 rows 4, 5):
//
//   1. `Enum.toEnum(s)` (SPEC §14.4.1) — a typed built-in, `string -> E | not`,
//      case-sensitive on the declared name, `not` otherwise; lowered to `===`
//      tests, so a JS prototype key is never reached.
//   2. THE §18 PLAIN-VALUE `match` — a subject that is not a failable result: an
//      enum, a `T | not`, a string / number / bool; variant arms with payload
//      binding, literal arms, the `not` arm, `_` / `else`, exhaustiveness, value
//      position (in `${}` and as an operand) and statement position.
//   3. `==` is structural (§45) unless the operand type is provably a scalar or a
//      unit-variant enum — `(User | not) == (User | not)` included.
//   4. THE SECURITY LENS: a `match` that decides a login takes the deny arm on a
//      wrong password, for an enum result, a `T | not` and a string literal arm.
//
// Graded on diagnostic codes, the Core shape, and the RUNTIME effect.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => [...new Set(run(src).diags.map((d) => d.code))].sort();
const diag = (src, code) => run(src).diags.find((d) => d.code === code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const parse = (src) => mods.parse.parseFile("t.scrml", src, 0);
function find(x, pred) {
  if (x && typeof x === "object") {
    if (pred(x)) return x;
    for (const v of Object.values(x)) {
      const r = find(v, pred);
      if (r) return r;
    }
  }
  return null;
}
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
let k = 0;
const load = (src, expose = []) => loadProgram(clean(src).core, "s469m-" + k++, expose);

const COLOR = `    type Color:enum = { Red, Green, Blue }\n    let <c:Color=.Red/>`;
const prog = (decls, body) => `<program>\n${decls}\n    <main>\n${body}\n    </main>\n</program>\n`;

// ---------------------------------------------------------------------------
describe("parser — the `not` arm and literal arms", () => {
  test("`not :>` is PNot; a string, a number, `-1` and `true` are PLit", () => {
    const f = parse(`\${ function f(x: int) -> string {\n    return match x {\n        -1 :> "m"\n        2 :> "two"\n        else :> "x"\n    }\n} }\n\${ function g(s: string | not) -> string { return match s { not :> "n", "a" :> "a", else :> "z", } } }\n\${ function h(b: bool) -> string { return match b { true :> "t", false :> "f", } } }`);
    expect(f.diags ?? []).toEqual([]);
    const pats = [];
    find(f, (n) => { if (n && n.pat && typeof n.pat === "object") pats.push(n.pat); return false; });
    const json = JSON.stringify(f);
    expect(json).toContain('"PNot"');
    expect(json).toContain('"-1"');
    expect(json).toContain('"PLit"');
  });
  test("a brace arm body that is one bare name is E-MATCH-ARM-SHORTHAND-AMBIGUOUS — in a `match` and in a `!{}` arm", () => {
    expect(codes(prog(`${COLOR}\n    function f(ok: string) -> string {\n        return match @c {\n            .Red :> { ok }\n            else :> "x"\n        }\n    }`, `        <p>\${f("a")}</p>`))).toContain("E-MATCH-ARM-SHORTHAND-AMBIGUOUS");
    expect(codes(`<program>\n    type E:enum = { Bad }\n    function load()! E { fail E.Bad }\n    function f(ok: string) -> string {\n        const v: string = load() !{ .Bad :> { ok } }\n        return v\n    }\n    <main><p>\${f("a")}</p></main>\n</program>\n`)).toContain("E-MATCH-ARM-SHORTHAND-AMBIGUOUS");
  });
  test("`{ a }` with a `;`, `{ a: a }` and a bare `a` are not refused", () => {
    const src = prog(`${COLOR}\n    function f(ok: string) -> string {\n        return match @c {\n            .Red :> ok\n            else :> "x"\n        }\n    }`, `        <p>\${f("a")}</p>`);
    expect(codes(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("Enum.toEnum(s) — §14.4.1", () => {
  const G = `    type Guess:enum = { Yes, No }`;
  test("typed `string -> E | not`; case-sensitive; prototype keys give `not` (runtime)", async () => {
    const src = prog(`${G}\n    let <s:string=""/>\n    <g:Guess | not=(Guess.toEnum(@s))/>`,
      `        <input id="i" bind:value=@s/>\n        <p id="o">\${match @g { .Yes :> "Y", .No :> "N", not :> "-", }}</p>`);
    await load(src);
    const set = (v) => { const i = $("#i"); i.value = v; i.dispatchEvent(new Event("input")); };
    for (const [v, want] of [["Yes", "Y"], ["No", "N"], ["yes", "-"], ["constructor", "-"], ["__proto__", "-"], ["toString", "-"], ["hasOwnProperty", "-"], ["", "-"], ["Yes ", "-"]]) {
      set(v);
      await new Promise((r) => setTimeout(r, 0));
      expect([v, $("#o").textContent]).toEqual([v, want]);
    }
  });
  test("lowered to a Match of `===` literal arms ending `_ :> not` — no property lookup", () => {
    const r = clean(prog(`${G}\n    let <s:string=""/>\n    <g:Guess | not=(Guess.toEnum(@s))/>`, `        <p>\${match @g { .Yes :> "Y", .No :> "N", not :> "-", }}</p>`));
    const json = JSON.stringify(r.core);
    expect(json).toContain('"Yes"');
    expect(json).toContain('"PWild"');
    expect(json).not.toContain("Index");
  });
  test("the argument must be a string (E-TYPE-031)", () => {
    expect(codes(prog(`${G}\n    let <n:int=1/>\n    <g:Guess | not=(Guess.toEnum(@n))/>`, `        <p>\${match @g { .Yes :> "Y", .No :> "N", not :> "-", }}</p>`))).toEqual(["E-TYPE-031"]);
  });
  test("one argument (E-CALL-ARITY); a struct has no toEnum (E-SCOPE-001); a payload-variant enum is refused", () => {
    expect(codes(prog(`${G}\n    <g:Guess | not=(Guess.toEnum("a", "b"))/>`, `        <p>x</p>`))).toContain("E-CALL-ARITY");
    expect(codes(prog(`    type P:struct = { x: int }\n    <g:int=(P.toEnum("a"))/>`, `        <p>x</p>`))).toContain("E-SCOPE-001");
    const d = diag(prog(`    type R:enum = { Ok, Bad(why: string) }\n    <g:R | not=(R.toEnum("Ok"))/>`, `        <p>x</p>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(d?.message).toContain("payload variant");
  });
});

// ---------------------------------------------------------------------------
describe("the plain-value match — §18", () => {
  test("value position: in `${}`, as an operand, as an initializer, as `return match` (runtime)", async () => {
    const src = prog(`${COLOR}\n    function name(x: Color) -> string {\n        return match x {\n            .Red :> "red"\n            .Green :> "green"\n            .Blue :> "blue"\n        }\n    }\n    <label:string=(match @c { .Red :> "R", else :> "?", })/>`,
      `        <button onclick={ @c = .Blue }>b</button>\n        <p id="a">\${match @c { .Red :> 1, .Green :> 2, .Blue :> 3, }}</p>\n        <p id="b">\${"c=" + match @c { .Blue :> "B", else :> "-", }}</p>\n        <p id="n">\${name(@c)}</p>\n        <p id="l">\${@label}</p>`);
    await load(src);
    expect($("#a").textContent).toBe("1");
    expect($("#l").textContent).toBe("R");
    click(btn("b"));
    expect($("#a").textContent).toBe("3");
    expect($("#b").textContent).toBe("c=B");
    expect($("#n").textContent).toBe("blue");
    expect($("#l").textContent).toBe("?");
  });
  test("a value match ends in its own `_ :> not` arm after a last arm that is not the wildcard (no arm reached by falling through)", () => {
    const r = clean(prog(COLOR, `        <p>\${match @c { .Red :> 1, .Green :> 2, .Blue :> 3, }}</p>`));
    const m = find(r.core, (n) => Array.isArray(n?.arms) && n.arms.length === 5);
    expect(m).not.toBeNull();
    expect(JSON.stringify(m.arms[4].pat)).toContain("PWild");
    expect(JSON.stringify(m.arms[0].pat)).toContain("Absent");   // the absence arm first (a payload test reads `.variant`)
  });
  test("statement position: arms that write, a block arm, payload binders (runtime)", async () => {
    const src = `<program>\n    type E:enum = { NotFound(id: string), Busy(n: int, why: string), Gone }\n    let <log:string=""/>\n    function load(id: string)! E {\n        if (id == "b") fail E.Busy(3, "slow")\n        if (id == "x") fail E.NotFound(id)\n        fail E.Gone\n    }\n    function note(e: E) {\n        match e {\n            .NotFound(id) :> @log = "nf " + id\n            .Busy(n, why) :> {\n                @log = why\n            }\n            .Gone :> @log = "gone"\n        }\n    }\n    function go(id: string) { load(id) !{ _ err :> note(err) } }\n    <main>\n        <button onclick=go("b")>b</button>\n        <button onclick=go("x")>x</button>\n        <button onclick=go("g")>g</button>\n        <p id="log">\${@log}</p>\n    </main>\n</program>\n`;
    await load(src);
    click(btn("b"));
    expect($("#log").textContent).toBe("slow");
    click(btn("x"));
    expect($("#log").textContent).toBe("nf x");
    click(btn("g"));
    expect($("#log").textContent).toBe("gone");
  });
  test("literal arms: string, number, bool; a string match with no `else` gives `not` for an unnamed value (W-MATCH-002)", async () => {
    const src = prog(`    let <s:string="b"/>\n    let <n:int=2/>\n    let <f:bool=false/>`,
      `        <p id="s">[\${match @s { "a" :> "A", "z" :> "Z", }}]</p>\n        <p id="n">\${match @n { 1 :> "one", 2 :> "two", else :> "many", }}</p>\n        <p id="f">\${match @f { true :> "T", false :> "F", }}</p>`);
    expect(codes(src)).toEqual(["W-MATCH-002"]);
    const r = run(src);
    await loadProgram(r.core, "s469m-" + k++, []);
    expect($("#s").textContent).toBe("[]");
    expect($("#n").textContent).toBe("two");
    expect($("#f").textContent).toBe("F");
  });
  test("the `not` arm; the arms after it read the subject as `T` (narrowed)", async () => {
    const src = prog(`    let <name:string | not=not/>`, `        <button onclick={ @name = "b" }>in</button>\n        <p id="w">\${match @name { not :> "nobody", else :> "hi " + @name, }}</p>`);
    await load(src);
    expect($("#w").textContent).toBe("nobody");
    click(btn("in"));
    expect($("#w").textContent).toBe("hi b");
    // unnarrowed, the same `+` is refused
    expect(codes(prog(`    let <name:string | not=not/>`, `        <p>\${"hi " + @name}</p>`))).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("exhaustiveness: E-TYPE-020 names the missing variants; E-MATCH-012 for a `T | not` with no `not` arm", () => {
    const d = diag(prog(COLOR, `        <p>\${match @c { .Red :> 1, }}</p>`), "E-TYPE-020");
    expect(d.message).toContain(".Green, .Blue");
    expect(codes(prog(COLOR, `        <p>\${match @c { .Red :> 1, else :> 2, }}</p>`))).toEqual([]);
    expect(codes(prog(`    type G:enum = { Y, N }\n    let <s:string=""/>\n    <g:G | not=(G.toEnum(@s))/>`, `        <p>\${match @g { .Y :> 1, .N :> 2, }}</p>`))).toEqual(["E-MATCH-012"]);
    expect(codes(prog(`    type G:enum = { Y, N }\n    let <s:string=""/>\n    <g:G | not=(G.toEnum(@s))/>`, `        <p>\${match @g { .Y :> 1, else :> 2, }}</p>`))).toEqual([]);
  });
  test("W-MATCH-001 (a wildcard after full coverage), E-SYNTAX-010 (an arm after it), E-TYPE-023 (a duplicate)", () => {
    expect(codes(prog(COLOR, `        <p>\${match @c { .Red :> 1, .Green :> 2, .Blue :> 3, else :> 4, }}</p>`))).toEqual(["W-MATCH-001"]);
    expect(codes(prog(COLOR, `        <p>\${match @c { else :> 4, .Red :> 1, }}</p>`))).toContain("E-SYNTAX-010");
    expect(codes(prog(COLOR, `        <p>\${match @c { .Red :> 1, .Red :> 2, else :> 3, }}</p>`))).toEqual(["E-TYPE-023"]);
    expect(codes(prog(`    let <s:string=""/>`, `        <p>\${match @s { "a" :> 1, "a" :> 2, else :> 3, }}</p>`))).toEqual(["E-TYPE-023"]);
  });
  test("E-TYPE-028 (a literal over an enum), E-TYPE-VARIANT (a variant over a string / an unknown variant), E-TYPE-001 (a literal of another type)", () => {
    expect(codes(prog(COLOR, `        <p>\${match @c { "Red" :> 1, else :> 2, }}</p>`))).toEqual(["E-TYPE-028"]);
    expect(codes(prog(`    let <s:string=""/>`, `        <p>\${match @s { .Red :> 1, else :> 2, }}</p>`))).toEqual(["E-TYPE-VARIANT"]);
    expect(codes(prog(COLOR, `        <p>\${match @c { .Pink :> 1, else :> 2, }}</p>`))).toEqual(["E-TYPE-VARIANT"]);
    expect(codes(prog(`    let <n:int=1/>`, `        <p>\${match @n { "1" :> 1, else :> 2, }}</p>`))).toEqual(["E-TYPE-001"]);
  });
  test("payload arity (E-TYPE-021); a whole-value binder on a plain match (E-MATCH-BARE-BINDER)", () => {
    const S = `    type E:enum = { A(x: int, y: int), B }\n    function f(e: E) -> int {\n        return match e {\n            ARMS\n        }\n    }`;
    expect(codes(prog(S.replace("ARMS", ".A(x) :> x\n            .B :> 0"), `        <p>x</p>`))).toEqual(["E-TYPE-021"]);
    expect(codes(prog(S.replace("ARMS", ".A(x, y) :> x\n            _ e2 :> 0"), `        <p>x</p>`))).toEqual(["E-MATCH-BARE-BINDER"]);
  });
  test("a subject whose type the binder does not know (a call's result): arms inferred, then checked by the typer", () => {
    const F = `    type Color:enum = { Red, Green }\n    function s() -> string { return "a" }\n    function c() -> Color { return .Red }`;
    expect(codes(prog(F, `        <p>\${match c() { .Red :> 1, .Green :> 2, }}</p>`))).toEqual([]);
    expect(codes(prog(F, `        <p>\${match s() { .Red :> 1, .Green :> 2, }}</p>`))).toEqual(["E-TYPE-VARIANT"]);
    expect(codes(prog(F + `\n    function m() -> Color | not { return not }`, `        <p>\${match m() { .Red :> 1, .Green :> 2, }}</p>`))).toEqual(["E-MATCH-012"]);
  });
  test("a struct subject is E-TYPE-024; a `S | not` presence match is admitted", () => {
    expect(codes(prog(`    type P:struct = { x: int }\n    let <p:P=({ x: 1 })/>`, `        <p>\${match @p { else :> 1, }}</p>`))).toEqual(["E-TYPE-024"]);
    expect(codes(prog(`    type P:struct = { x: int }\n    let <p:P | not=not/>`, `        <p>\${match @p { not :> 0, else :> 1, }}</p>`))).toEqual([]);
  });
  test("qualified patterns and values (§18.13): `Color.Red :>`, `Color::Green :>`, `@c = Color.Blue` (runtime); a wrong qualifier is E-TYPE-VARIANT", async () => {
    const src = prog(COLOR, `        <button onclick={ @c = Color.Blue }>b</button>\n        <p id="q">\${match @c { Color.Red :> "r", Color::Green :> "g", .Blue :> "b", }}</p>`);
    await load(src);
    expect($("#q").textContent).toBe("r");
    click(btn("b"));
    expect($("#q").textContent).toBe("b");
    expect(codes(prog(COLOR + `\n    type Other:enum = { Red, Green, Blue }`, `        <p>\${match @c { Other.Red :> 1, else :> 2, }}</p>`))).toEqual(["E-TYPE-VARIANT"]);
    expect(codes(prog(COLOR, `        <p>\${Color.Pink}</p>`))).toEqual(["E-TYPE-VARIANT"]);
  });
  test("value-position limits: a block arm with statements, a leaving arm, a write — refused by name", () => {
    expect(codes(prog(COLOR + `\n    function f() -> int {\n        return match @c {\n            .Red :> {\n                const a: int = 1\n                a\n            }\n            else :> 2\n        }\n    }`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(COLOR + `\n    let <n:int=0/>`, `        <p>\${match @c { .Red :> @n = 1, else :> 2, }}</p>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

// ---------------------------------------------------------------------------
describe("tapes keep their grants through a match", () => {
  test("a tape is never a match subject — `T[g] | not` included (fail closed, not unwrapped)", () => {
    const d = diag(prog(`    function f(xs: int[append] | not) -> int {\n        return match xs {\n            not :> 0\n            else :> 1\n        }\n    }`, `        <p>x</p>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(d?.message).toContain("tape");
    expect(codes(prog(`    function f(xs: int[append]) -> int {\n        return match xs {\n            else :> 1\n        }\n    }`, `        <p>x</p>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
  test("a write inside a statement match's arm is grant-checked like any other write", () => {
    const D = `    type Color:enum = { Red, Green }\n    let <c:Color=.Red/>\n    <xs:int[free, append]=[]/>`;
    expect(codes(prog(D + `\n    function f() {\n        match @c {\n            .Red :> @xs.push(1)\n            .Green :> @xs.pop()\n        }\n    }`, `        <button onclick=f()>f</button>`))).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
});

// ---------------------------------------------------------------------------
describe("§45 — `==` is structural unless the type is provably scalar", () => {
  const ops = (src) => {
    const json = JSON.stringify(clean(src).core);
    return { struct: json.includes('"EqStruct"'), prim: json.includes('"EqPrim"') };
  };
  test("`(User | not) == (User | not)` is EqStruct, and equal users built apart are equal (runtime)", async () => {
    const src = prog(`    type User:struct = { name: string }\n    let <a:User | not=not/>\n    let <b:User | not=not/>`,
      `        <button onclick={ @a = { name: "x" }; @b = { name: "x" } }>set</button>\n        <p id="eq">\${@a == @b}</p>`);
    expect(ops(src)).toEqual({ struct: true, prim: false });
    await load(src);
    expect($("#eq").textContent).toBe("true");
    click(btn("set"));
    expect($("#eq").textContent).toBe("true");
  });
  test("int, `int | not` and a unit-variant enum stay EqPrim", () => {
    expect(ops(prog(`    let <a:int | not=not/>\n    let <b:int=1/>`, `        <p>\${@a == @b}</p>`))).toEqual({ struct: false, prim: true });
    expect(ops(prog(COLOR, `        <p>\${@c == .Red}</p>`))).toEqual({ struct: false, prim: true });
  });
  test("an operand whose type the binder cannot prove is EqStruct (fail closed)", () => {
    expect(ops(prog(`    type User:struct = { name: string }\n    function u() -> User {\n        const v: User = { name: "a" }\n        return v\n    }`, `        <p>\${u() == u()}</p>`)).struct).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("security lens — the deny arm is reachable and chosen by its own test", () => {
  const LOGIN = (decls, attempt) => `<program>\n    let <wrong:string=""/>\n    let <right:string=""/>\n${decls}\n${attempt}\n    function login() {\n        @wrong = attempt("hunter3")\n        @right = attempt("hunter2")\n    }\n    <main>\n        <button onclick=login()>go</button>\n        <p id="wrong">\${@wrong}</p>\n        <p id="right">\${@right}</p>\n    </main>\n</program>\n`;
  const expectLogin = async (src, deny, allow) => {
    await load(src);
    click(btn("go"));
    expect($("#wrong").textContent).toBe(deny);
    expect($("#right").textContent).toBe(allow);
  };
  const AUTH = `    type Auth:enum = { Granted, Denied }\n    function check(pw: string) -> Auth {\n        if (pw == "hunter2") return .Granted\n        return .Denied\n    }`;
  test("a `match` on an enum result — value form, deny arm first and last", async () => {
    await expectLogin(LOGIN(AUTH, `    function attempt(pw: string) -> string {\n        return match check(pw) {\n            .Granted :> "welcome"\n            .Denied :> "denied"\n        }\n    }`), "denied", "welcome");
    await expectLogin(LOGIN(AUTH, `    function attempt(pw: string) -> string {\n        return match check(pw) {\n            .Denied :> "denied"\n            .Granted :> "welcome"\n        }\n    }`), "denied", "welcome");
  });
  test("a `match` on an enum result — statement form", async () => {
    await expectLogin(LOGIN(AUTH, `    function attempt(pw: string) -> string {\n        let m: string = "unset"\n        match check(pw) {\n            .Granted :> m = "welcome"\n            .Denied :> m = "denied"\n        }\n        return m\n    }`), "denied", "welcome");
  });
  test("a `match` on `T | not` — value and statement form", async () => {
    const FIND = `    type User:struct = { name: string }\n    function find(pw: string) -> User | not {\n        const u: User = { name: "bryan" }\n        if (pw == "hunter2") return u\n        return not\n    }`;
    await expectLogin(LOGIN(FIND, `    function attempt(pw: string) -> string {\n        return match find(pw) {\n            not :> "denied"\n            else :> "welcome"\n        }\n    }`), "denied", "welcome");
    await expectLogin(LOGIN(FIND, `    function attempt(pw: string) -> string {\n        let m: string = "unset"\n        match find(pw) {\n            not :> m = "denied"\n            else :> m = "welcome"\n        }\n        return m\n    }`), "denied", "welcome");
  });
  test("a literal-arm `match` on a string — with `else`, and with none (a wrong password takes no arm)", async () => {
    await expectLogin(LOGIN("", `    function attempt(pw: string) -> string {\n        return match pw {\n            "hunter2" :> "welcome"\n            else :> "denied"\n        }\n    }`), "denied", "welcome");
    const noElse = LOGIN("", `    function grant(pw: string) -> string | not {\n        return match pw {\n            "guest" :> "guest"\n            "hunter2" :> "welcome"\n        }\n    }\n    function attempt(pw: string) -> string {\n        return match grant(pw) {\n            not :> "denied"\n            else :> "granted"\n        }\n    }`);
    expect(codes(noElse)).toEqual(["W-MATCH-002"]);
    const r = run(noElse);
    await loadProgram(r.core, "s469m-" + k++, []);
    click(btn("go"));
    expect($("#wrong").textContent).toBe("denied");
    expect($("#right").textContent).toBe("granted");
  });
});

// ---------------------------------------------------------------------------
// #1471 review HIGH-1: `undefined` (a `-> T | not` function falling off the end) took the
// PRESENT arm — the absence arm tested `=== null`. Both halves fixed: the absence test is
// `== null` (as `is not`), and a function with a declared return type that can fall off the
// end is refused (E-TYPE-043; `-> T | not`: E-BOOTSTRAP-UNSUPPORTED — not lowered to `not`).
describe("review HIGH-1 — absence is `null` and `undefined`; no function falls off the end", () => {
  const js = (src) => mods.print.printProgram(clean(src).core, "t.client.js", "scrml-runtime.js").js;
  const FIND = (tail) => `    type User:struct = { name: string }\n    function find(pw: string) -> User | not {\n        const u: User = { name: "bryan" }\n        if (pw == "hunter2") return u${tail}\n    }`;
  const VAL = `    function attempt(pw: string) -> string {\n        return match find(pw) {\n            not :> "denied"\n            else :> "welcome"\n        }\n    }`;
  const STMT = `    function attempt(pw: string) -> string {\n        let m: string = "denied"\n        match find(pw) {\n            not :> m = "denied"\n            else :> m = "welcome"\n        }\n        return m\n    }`;
  const P2 = (decls) => prog(decls, `        <p>\${attempt("x")}</p>`);
  test("the absence arm prints `== null` (value and statement form), never `=== null`", () => {
    for (const a of [VAL, STMT]) {
      const out = js(P2(FIND("\n        return not") + "\n" + a));
      expect(out).toContain("m$ == null");
      expect(out).not.toContain("=== null");
    }
  });
  test("the reviewer's repro — `-> User | not` falling off the end — is refused, value and statement form", () => {
    for (const a of [VAL, STMT]) {
      const r = run(P2(FIND("") + "\n" + a));
      expect(r.core == null).toBe(true);
      expect(r.diags.map((d) => d.code)).toEqual(["E-TYPE-043"]);   // bryan's ruling "Always explicit": a language error
      expect(r.diags[0].message).toContain("return not;");
    }
  });
  test("`-> string` falling off the end is E-TYPE-043 (§17.6); `string | not` and an enum `| not` too (bryan: Always explicit)", () => {
    expect(codes(prog(`    function f(a: int) -> string {\n        if (a == 1) return "one"\n    }`, `        <p>\${f(1)}</p>`))).toEqual(["E-TYPE-043"]);
    expect(codes(prog(`    function f(a: int) -> string | not {\n        if (a == 1) return "one"\n    }`, `        <p>x</p>`))).toEqual(["E-TYPE-043"]);
    expect(codes(prog(`    type R:enum = { A, B }\n    function f(a: int) -> R | not {\n        if (a == 1) return .A\n    }`, `        <p>x</p>`))).toEqual(["E-TYPE-043"]);
  });
  test("every path returning — if / else, an exhaustive statement match whose arms all return — is not refused; a non-exhaustive one is", () => {
    expect(codes(prog(`    function f(a: int) -> string {\n        if (a == 1) {\n            return "one"\n        } else {\n            return "other"\n        }\n    }`, `        <p>\${f(1)}</p>`))).toEqual([]);
    expect(codes(prog(COLOR + `\n    function f(x: Color) -> string {\n        match x {\n            .Red :> return "r"\n            .Green :> return "g"\n            .Blue :> return "b"\n        }\n    }`, `        <p>\${f(@c)}</p>`))).toEqual([]);
    expect(codes(prog(`    function f(s: string) -> string {\n        match s {\n            "a" :> return "A"\n        }\n    }`, `        <p>\${f("a")}</p>`))).toEqual(["E-TYPE-043", "W-MATCH-002"]);
  });
  test("§42.5: a security program's emitted JS never names `undefined`", () => {
    const out = js(P2(FIND("\n        return not") + "\n" + VAL));
    expect(out).not.toMatch(/\bundefined\b/);
  });
  test("a return-typed function ending in an unreturned expression is E-TYPE-043 — scrml has no implicit tail return (bryan: Always explicit)", () => {
    const d = diag(prog(COLOR + `\n    function f(x: Color) -> string {\n        match x {\n            .Red :> "r"\n            else :> "o"\n        }\n    }`, `        <p>\${f(@c)}</p>`), "E-TYPE-043");
    expect(d?.message).toContain("no implicit tail return");
  });
  test("(review L1) a `not` arm on a subject that cannot be `not` is dead — E-TYPE-044 (binder-known and typer-known)", () => {
    expect(codes(prog(COLOR, `        <p>\${match @c { .Red :> 1, .Green :> 2, .Blue :> 3, not :> 0, }}</p>`))).toEqual(["E-TYPE-044"]);
    expect(codes(prog(`    let <s:string=""/>`, `        <p>\${match @s { "a" :> 1, not :> 0, else :> 2, }}</p>`))).toEqual(["E-TYPE-044"]);
    expect(codes(prog(`    function s() -> string { return "a" }`, `        <p>\${match s() { not :> 0, else :> 2, }}</p>`))).toEqual(["E-TYPE-044"]);
  });
  test("(review L3) `asIs` is refused by name, not as an unknown type", () => {
    const d = diag(prog(`    function f(x: asIs) -> int { return 1 }`, `        <p>x</p>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(d?.message).toContain("asIs");
    expect(codes(prog(`    function f(x: asIs) -> int { return 1 }`, `        <p>x</p>`))).not.toContain("E-TYPE-UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// #1471 delta review: the rest of the fall-off class — a `!` function's success path (HIGH-A),
// an unannotated function (HIGH-B), `== not` (HIGH-B 2, E-EQ-002), a bare `return` in `-> T` (MED-C).
describe("delta review — no path yields `undefined`", () => {
  const LOGIN = (decls, attempt) => `<program>\n    type Denied:enum = { Bad }\n    let <wrong:string=""/>\n    let <right:string=""/>\n${decls}\n${attempt}\n    function login() {\n        @wrong = attempt("hunter3")\n        @right = attempt("hunter2")\n    }\n    <main>\n        <button onclick=login()>go</button>\n        <p id="wrong">\${@wrong}</p>\n        <p id="right">\${@right}</p>\n    </main>\n</program>\n`;
  const ROLE = (tail) => `    function role(pw: string)! Denied {\n        if (pw == "hunter2") return "user"${tail}\n    }`;
  const VAL = `    function attempt(pw: string) -> string {\n        return match role(pw) {\n            .Ok(v) :> "welcome"\n            _ :> "denied"\n        }\n    }`;
  const GUARD = `    function attempt(pw: string) -> string {\n        const r: string = role(pw) !{ _ :> "denied" }\n        if (r == "user") return "welcome"\n        return "denied"\n    }`;
  test("HIGH-A: a `!` function whose success path can fall off is refused — `match` and `!{}` callers", () => {
    for (const a of [VAL, GUARD]) {
      const r = run(LOGIN(ROLE(""), a));
      expect(r.core == null).toBe(true);
      expect(r.diags.map((d) => d.code)).toEqual(["E-RETURN-INCOMPLETE"]);
      expect(r.diags[0].message).toContain("every path");
    }
  });
  test("HIGH-A: with `fail` on the wrong path, the deny arm runs (runtime, both callers)", async () => {
    for (const a of [VAL, GUARD]) {
      await load(LOGIN(ROLE("\n        fail .Bad"), a));
      click(btn("go"));
      expect($("#wrong").textContent).toBe("denied");
      expect($("#right").textContent).toBe("welcome");
    }
  });
  test("HIGH-A: a `!` function that never returns a value is not judged (no success value)", () => {
    expect(codes(`<program>\n    type E:enum = { Bad }\n    let <n:int=0/>\n    function f(x: int)! E {\n        if (x == 0) fail .Bad\n        @n = x\n    }\n    function go() { f(1) !{ _ :> @n = 2 } }\n    <main><button onclick=go()>g</button></main>\n</program>\n`)).toEqual([]);
  });
  test("HIGH-B: an unannotated function that returns a value on one path and falls off (or bare-returns) on another is refused", () => {
    const LOOK = (tail) => `    function look(pw: string) {\n        if (pw == "hunter2") return "user"${tail}\n    }`;
    const A = `    function attempt(pw: string) -> string {\n        if (look(pw) is not) return "denied"\n        return "welcome"\n    }`;
    expect(codes(LOGIN(LOOK(""), A))).toEqual(["E-RETURN-INCOMPLETE"]);
    expect(codes(LOGIN(LOOK("\n        return"), A))).toEqual(["E-RETURN-INCOMPLETE"]);
    // an unannotated function with no value return is a procedure: not judged
    expect(codes(prog(`    let <n:int=0/>\n    function bump(x: int) {\n        if (x > 0) @n = x\n    }`, `        <button onclick=bump(1)>b</button>`))).toEqual([]);
  });
  test("HIGH-B (2): `== not` / `!= not` is E-EQ-002 (§45; E-TYPE-042 retired S305); `===` is refused at parse", () => {
    const F = `    function look(pw: string) -> string | not {\n        if (pw == "hunter2") return "user"\n        return not\n    }`;
    expect(codes(LOGIN(F, `    function attempt(pw: string) -> string {\n        if (look(pw) == not) return "denied"\n        return "welcome"\n    }`))).toEqual(["E-EQ-002"]);
    expect(codes(LOGIN(F, `    function attempt(pw: string) -> string {\n        if (not != look(pw)) return "welcome"\n        return "denied"\n    }`))).toEqual(["E-EQ-002"]);
    expect(codes(LOGIN(F, `    function attempt(pw: string) -> string {\n        if (look(pw) === not) return "denied"\n        return "welcome"\n    }`))).toContain("E-PARSE-STRICT-EQ");
  });
  test("MED-C: a bare `return` in a declared-return function is E-TYPE-043 — `-> T | not` included: write `return not;` (bryan)", () => {
    expect(codes(prog(`    function role(pw: string) -> string {\n        if (pw == "hunter2") return "user"\n        return\n    }`, `        <p>\${role("x")}</p>`))).toEqual(["E-TYPE-043"]);
    expect(codes(prog(`    function role(pw: string) -> string | not {\n        if (pw == "hunter2") return "user"\n        return\n    }`, `        <p>\${match role("x") { not :> "-", else :> "u", }}</p>`))).toEqual(["E-TYPE-043"]);
  });
});

// ---------------------------------------------------------------------------
// #1471 round 2 — bryan's ruling "Always explicit": no implicit return anywhere.
describe("round 2 — always explicit; a no-value result is never read", () => {
  const D = `    type Denied:enum = { Bad }`;
  const ROLE = `${D}\n    function role(pw: string)! Denied {\n        if (pw != "hunter2") return\n        return "user"\n    }`;
  const CHK = `${D}\n    function chk(pw: string)! Denied {\n        if (pw != "hunter2") fail .Bad\n    }`;
  test("HIGH-1: a bare `return` in a `!` function beside a value return is E-RETURN-INCOMPLETE", () => {
    expect(codes(prog(ROLE + `\n    function a(pw: string) -> string {\n        return match role(pw) {\n            .Ok(v) :> v\n            .Bad :> "denied"\n        }\n    }`, `        <p>\${a("x")}</p>`))).toEqual(["E-RETURN-INCOMPLETE"]);
  });
  test("MED-2: a no-value `!` callee's success value read — by `!{}` or a bound `.Ok(v)` — is E-TYPE-001; `.Ok(_)` / a statement is fine", () => {
    expect(codes(prog(CHK + `\n    function a(pw: string) -> string {\n        const r: string = chk(pw) !{ _ :> "denied" }\n        return r\n    }`, `        <p>\${a("x")}</p>`))).toEqual(["E-TYPE-001"]);
    const M = (ok) => `\n    function a(pw: string) -> string {\n        return match chk(pw) {\n            ${ok}\n            .Bad :> "denied"\n        }\n    }`;
    expect(codes(prog(CHK + M('.Ok(v) :> "w" + v'), `        <p>\${a("x")}</p>`))).toEqual(["E-TYPE-001"]);
    expect(codes(prog(CHK + M('.Ok(_) :> "welcome"'), `        <p>\${a("x")}</p>`))).toEqual([]);
    expect(codes(prog(CHK + `\n    let <m:string=""/>\n    function go() { chk("x") !{ _ :> @m = "denied" } }`, `        <button onclick=go()>g</button>`))).toEqual([]);
  });
  test("MED-2: a function with no value used as one — initializer, markup — is E-TYPE-001; as a statement or handler it is fine", () => {
    const N = `    function nothing(x: int) {\n        if (x > 0) {\n            const z: int = x\n        }\n    }`;
    expect(codes(prog(N + `\n    function a() -> string {\n        const s: string = nothing(1)\n        return s\n    }`, `        <p>\${a()}</p>`))).toEqual(["E-TYPE-001"]);
    expect(codes(prog(N, `        <p>\${nothing(1)}</p>`))).toEqual(["E-TYPE-001"]);
    expect(codes(prog(N + `\n    function go() {\n        nothing(2)\n    }`, `        <button onclick=nothing(1)>b</button>\n        <button onclick=go()>g</button>`))).toEqual([]);
  });
});
