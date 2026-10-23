// arms-union-s469.test.js — s469 bootstrap parser: blockers #2 and #3 of the
// "can bryan write today's scrml" measurement
// (scrml-support/docs/workability/today-scrml-distance-2026-10-18.md §4 rows 2, 3).
//
//   1. COMMA ARM LISTS (dpa-073 F2 (iii) + F2 (i), S469): `{ .A :> 1, .B :> 2, }` —
//      a `,` after every arm, block arms included, the trailing one optional; one
//      arm grammar for `match` and `!{}` (S452). The newline-separated list is
//      still read (dpa-073 F5: enforcement follows the `scrml fix` codemod). A list
//      that mixes the two is E-MATCH-ARM-SEPARATOR, once. Engine message arms
//      (§51.0.S.2.3) are not in the bootstrap at all — refused by name, in either
//      spelling.
//   2. A UNION TYPE IN A DECLARATION OPENER (§66.2.4, S451: "a bootstrap rejection
//      of it is a parser bug"): `<g:Guess | not=.Yes/>`, spaced or not, followed by
//      a value, a closer or attributes. `T | not` is the bootstrap's TMaybe; any
//      other union is read whole and refused (E-BOOTSTRAP-UNSUPPORTED) — the
//      bootstrap type system has `T | not` only.
//
// Graded on the diagnostic codes, the parsed shape, and the RUNTIME effect where
// the printer can print the program.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const diag = (src, code) => run(src).diags.find((d) => d.code === code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const parse = (src) => mods.parse.parseFile("t.scrml", src, 0);
// The first node (depth-first) satisfying `pred`, or null.
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
const load = (src, expose = []) => loadProgram(clean(src).core, "s469-" + k++, expose);

const TYPES = `    type LoadError:enum = { NotFound(id: string), Timeout }`;
const LOAD = `    function load(id: string)! LoadError {\n        if (id == "x") fail LoadError.NotFound(id);\n        if (id == "y") fail LoadError.Timeout;\n        return id;\n    }`;
const JOIN = `    function join2(a: string, b: string) -> string { return a + ":" + b; }`;
const P = (decls, buttons = []) =>
  `<program>\n    let <out:string=""/>\n    let <n:int=0/>\n${TYPES}\n${LOAD}\n${JOIN}\n${decls}\n    <main>\n${buttons
    .map((b) => `        <button onclick=${b}()>${b}</button>`)
    .join("\n")}\n        <p; id="out">\${@out}</p>\n        <p id="n">\${@n}</p>\n    </main>\n</program>\n`;
const fn = (name, body) => `    function ${name}() {\n${body}\n    }`;

// ---------------------------------------------------------------------------
describe("dpa-073 F2 — comma-separated arm lists", () => {
  test("`match` over a failable: comma arms, a trailing comma, a `,` inside an arm body (runtime)", async () => {
    const src = P(
      [
        fn("ok", `        @out = match load("a") { .Ok(v) :> join2("ok", v), .NotFound(m) :> join2("nf", m), .Timeout :> "to", };`),
        fn("nf", `        @out = match load("x") { .Ok(v) :> join2("ok", v), .NotFound(m) :> join2("nf", m), .Timeout :> "to", };`),
        fn("to", `        @out = match load("y") { .Ok(v) :> join2("ok", v), .NotFound(m) :> join2("nf", m), .Timeout :> "to" };`),
      ].join("\n"),
      ["ok", "nf", "to"],
    );
    await load(src);
    click(btn("ok"));
    expect($("#out").textContent).toBe("ok:a");
    click(btn("nf"));
    expect($("#out").textContent).toBe("nf:x");
    click(btn("to"));
    expect($("#out").textContent).toBe("to");
  });

  test("`!{}` handler arms: comma arms, block arms, a comma list across lines (runtime)", async () => {
    const src = P(
      [
        fn("v", `        @out = load("x") !{ .NotFound(m) :> join2("nf", m), .Timeout :> "to", };`),
        fn("blk", `        load("y") !{\n            .NotFound(m) :> {\n                @out = m;\n            },\n            .Timeout :> {\n                @n = @n + 1;\n                @out = join2("t", "o");\n            },\n        };`),
        fn("tail", `        @out = load("x") !{\n            .NotFound(m) :> [m, "b"].map(s => s + "!").length + 40,\n            .Timeout :> 0\n        } + ""`),
      ].join("\n"),
      ["v", "blk"],
    );
    // `tail`: a value-position `!{}` inside a larger expression is out of the slice
    // (E-BOOTSTRAP-UNSUPPORTED) — drop it for the runtime run; the parse of its
    // arm list is checked below.
    const runnable = src.replace(/    function tail\(\) \{[\s\S]*?\n    \}\n/, "");
    await load(runnable);
    click(btn("v"));
    expect($("#out").textContent).toBe("nf:x");
    click(btn("blk"));
    expect($("#out").textContent).toBe("t:o");
    expect($("#n").textContent).toBe("1");
    // the commas inside `[m, "b"]` and the `.map(…)` call are the body's own: two arms, no arm error
    const tailCodes = codes(src);
    expect(tailCodes).not.toContain("E-PARSE-ARM");
    expect(tailCodes).not.toContain("E-MATCH-ARM-SEPARATOR");
  });

  test("a `,` inside an arm body at depth > 0 is the body's; at depth 0 it ends the arm", () => {
    const ast = parse(`<program>\n${TYPES}\n${LOAD}\n${JOIN}\n    function f() -> string {\n        return load("x") !{ .NotFound(m) :> join2(m, join2("a", "b")), .Timeout :> "t", }\n    }\n</program>\n`);
    expect(ast.diags.map((d) => d.code)).toEqual([]);
    // two arms, and the first arm's body is ONE (outer) call
    const guard = find(ast, (x) => x.variant === "Guard");
    expect(guard).not.toBeNull();
    const arms = guard.data.arms;
    expect(arms.length).toBe(2);
    const body = arms[0].body;
    expect(body.variant).toBe("ArmExpr");
    expect(body.data.e.k.variant).toBe("Call");
  });

  test("the `|`-led legacy `!{}` arm takes commas too (still W-ARM-PIPE-LEGACY, one per arm)", () => {
    const c = codes(P(fn("f", `        @out = load("x") !{ | .NotFound(m) :> m, | .Timeout :> "t", };`)));
    expect(c.filter((x) => x === "W-ARM-PIPE-LEGACY").length).toBe(2);
    expect(c.filter((x) => x.startsWith("E-"))).toEqual([]);
  });

  test("newline-separated arms are still read (dpa-073 F5 — enforcement follows the codemod) (runtime)", async () => {
    const src = P(fn("go", `        @out = load("x") !{\n            .NotFound(m) :> join2("nf", m),\n            .Timeout :> "to"\n        };`), ["go"]);
    await load(src);
    click(btn("go"));
    expect($("#out").textContent).toBe("nf:x");
  });

  test("a list that mixes `,` and newline separators is E-MATCH-ARM-SEPARATOR, once, at the first arm with no `,` before it", () => {
    const body = `        @out = load("x") !{\n            .NotFound(m) :> "nf",\n            .Timeout :> "to",\n            .Other :> "o"\n        };`;
    const src = P(fn("f", body));
    const c = codes(src);
    expect(c.filter((x) => x === "E-MATCH-ARM-SEPARATOR").length).toBe(1);
    const d = diag(src, "E-MATCH-ARM-SEPARATOR");
    expect(src.substring(d.span.start, d.span.start + 6)).toBe(".Other");
    expect(d.message).toContain("one list takes one spelling");
    expect(d.message).toContain("dpa-073 F2");
    expect(run(src).core == null).toBe(true);
  });

  test("a trailing `,` on a newline list is mixed; a newline list with no `,` and a comma list with no trailing `,` are not", () => {
    const mixed = `        @out = load("x") !{\n            .NotFound(m) :> "nf",\n            .Timeout :> "to",\n        };`;
    expect(codes(P(fn("f", mixed)))).toEqual(["E-MATCH-ARM-SEPARATOR"]);
    const commaNoTrail = `        @out = load("x") !{\n            .NotFound(m) :> "nf",\n            .Timeout :> "to"\n        }`;
    expect(codes(P(fn("f", commaNoTrail)))).toEqual([]);
    const oneArmTrail = `        @out = load("x") !{ _ :> "w", }`;
    expect(codes(P(fn("f", oneArmTrail)))).toEqual([]);
  });

  test("the same mixing rule for `match` arms", () => {
    const src = P(fn("f", `        @out = match load("x") {\n            .Ok(v) :> v,\n            .NotFound(m) :> m,\n            .Timeout :> "t"\n        };`));
    expect(codes(src)).toEqual(["E-MATCH-ARM-SEPARATOR"]);
  });

  test("a `,` with no arm before it is one E-PARSE-ARM, and the list goes on (no cascade)", () => {
    expect(codes(P(fn("f", `        @out = load("x") !{ .NotFound(m) :> "nf",, .Timeout :> "to" }`)))).toEqual(["E-PARSE-ARM"]);
    expect(codes(P(fn("f", `        @out = load("x") !{ , .NotFound(m) :> "nf", .Timeout :> "to" }`)))).toEqual(["E-PARSE-ARM"]);
  });

  // review r1 (LOW, pinned, not built): armEnd's depth-0 `,` counts TOKEN brackets
  // only, so a markup arm body's text `,` would end the arm. Markup arm bodies are
  // not in the bootstrap — today this fails LOUDLY (no artifact). When they land,
  // this pin breaks and the arm-boundary rule must learn markup depth.
  test("PIN: a markup arm body with a `,` in its text fails loudly today (no artifact)", () => {
    const src = P(fn("f", `        @out = match load("a") { .Ok(v) :> <b>ok, yes</b>, .NotFound(m) :> "nf", .Timeout :> "to", }`));
    const r = run(src);
    expect(r.core == null).toBe(true);
    expect(r.diags.map((d) => d.code)).toContain("E-PARSE-UNCLOSED");
  });

  test("engine message arms (§51.0.S.2.3) are not in the bootstrap: refused by name, comma or newline list — never read as display text", () => {
    const eng = (arms) =>
      `<program>\n    type Phase:enum = { Idle, Loading }\n    type Msg:enum = { Go, Stop }\n    <phase:Phase=.Idle single accepts=Msg>\n        <Idle rule=.Loading>\n${arms}\n            "Ready"\n        </>\n        <Loading rule=.Idle : "Loading">\n    </>\n    <main><p><*phase/></p></main>\n</program>\n`;
    for (const arms of [
      "            .Go :> .Loading,\n            .Stop :> .Idle,",
      "            .Go :> .Loading\n            .Stop :> .Idle",
      "            | .Go :> .Loading",
    ]) {
      const src = eng(arms);
      const c = codes(src);
      expect(c).toContain("E-BOOTSTRAP-UNSUPPORTED");
      expect(c).not.toContain("E-UNQUOTED-DISPLAY-TEXT");
      expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("engine message arms");
    }
  });
});

// ---------------------------------------------------------------------------
describe("§66.2.4 (S451) — a union type in a declaration opener", () => {
  const G = `    type Guess:enum = { Yes, No }`;
  const prog = (decls, main = "<p>x</p>") => `<program>\n${G}\n${decls}\n    <main>${main}</main>\n</program>\n`;
  const declType = (src, name) => {
    const ast = parse(src);
    const j = JSON.stringify(ast);
    return { diags: ast.diags.map((d) => d.code), j };
  };

  test("`<g:Guess | not=.Yes/>` — spaced, then an own value: the type is `Guess | not` (TMaybe), no parse error", () => {
    const src = prog(`    <g:Guess | not=.Yes/>`);
    const { diags, j } = declType(src, "g");
    expect(diags).toEqual([]);
    expect(j).toContain('"variant":"TMaybe","data":{"inner":{');
    expect(j).toContain('"variant":"TName","data":{"name":"Guess"}');
    expect(codes(src)).toEqual([]);
  });

  test("unspaced `<g:Guess|not=.Yes/>`, reversed `<g:not | Guess/>` and `let <email:string | not=\"\"/>` (the SPEC's example)", () => {
    expect(codes(prog(`    <g:Guess|not=.Yes/>`))).toEqual([]);
    expect(codes(prog(`    let <email:string | not=""/>`))).toEqual([]);
    const rev = declType(prog(`    let <h:not | Guess=.No/>`)).j;
    expect(rev).toContain('"variant":"TMaybe"');
  });

  test("a union followed by attributes / a closer: `|` continues the type, the next word after a member is an attribute", () => {
    // a component's typed attributes, each a union, then a plain typed one
    const lib = `export <box n:string | not=not label:string="x" m:int|not=0/>\nrenders <p>\${label}</p>\n`;
    const r = frontEnd(mods, [{ path: "lib.scrml", src: lib }, { path: "app.scrml", src: `<program>\n    import { box } from "./lib.scrml";\n    <main><box n=("a") m=(not)/></main>\n</program>\n` }]);
    expect(r.diags.map((d) => d.code)).toEqual([]);
    const j = JSON.stringify(mods.parse.parseFile("lib.scrml", lib, 0));
    expect((j.match(/"variant":"TMaybe"/g) || []).length).toBe(2);
    // a union before `/>` with no value, and before `>` of a bodied opener
    expect(parse(prog(`    let <g:Guess | not/>`)).diags.map((d) => d.code)).not.toContain("E-PARSE-TAG");
  });

  test("the `| not` cell's value is checked against `Guess | not`: `@g = not` is legal, `@g = 5` is E-TYPE-031", () => {
    expect(codes(prog(`    let <g:Guess | not=.Yes/>\n    function f() { @g = not; }`))).toEqual([]);
    expect(codes(prog(`    let <g:Guess | not=.Yes/>\n    function f() { @g = 5; }`))).toContain("E-TYPE-031");
  });

  test("a union cell renders and narrows (runtime): `if=(@name is given)` follows writes of a value and of `not`", async () => {
    const src = prog(
      `    let <name:string | not=not/>\n    function setIt() { @name = "bryan"; }\n    function clear() { @name = not; }`,
      `\n        <p id="a" if=(@name is given)>given</p>\n        <button onclick=setIt()>set</button>\n        <button onclick=clear()>clear</button>\n    `,
    );
    await load(src);
    expect(document.querySelectorAll("#a").length).toBe(0);
    click(btn("set"));
    expect(document.querySelectorAll("#a").length).toBe(1);
    click(btn("clear"));
    expect(document.querySelectorAll("#a").length).toBe(0);
  });

  test("a union other than `T | not` (`<id:int | string=0/>`, `T | U | not`) is read whole, then refused — E-BOOTSTRAP-UNSUPPORTED naming the type, no E-PARSE-TAG", () => {
    for (const [decl, ty] of [[`    <id:int | string=0/>`, "int | string"], [`    <id:int | string | not=0/>`, "int | string | not"]]) {
      const src = prog(decl);
      const c = codes(src);
      expect(c).not.toContain("E-PARSE-TAG");
      expect(c).toContain("E-BOOTSTRAP-UNSUPPORTED");
      expect(diag(src, "E-BOOTSTRAP-UNSUPPORTED").message).toContain("`" + ty + "`");
    }
  });

  test("`|` with no member after it is E-PARSE-TYPE only — no second union refusal; `||` is not a union", () => {
    for (const d of [`    <g:Guess | =.Yes/>`, `    <g:Guess |=.Yes/>`, `    <g:Guess | />`]) {
      const c = codes(prog(d));
      expect(c).toContain("E-PARSE-TYPE");
      expect(c).not.toContain("E-BOOTSTRAP-UNSUPPORTED");
    }
    expect(codes(prog(`    <g:Guess || not=.Yes/>`))).toContain("E-PARSE-TAG");
  });

  // review r1 (HIGH): the grant checks do not see through `| not`, so a tape inside an
  // opener union would escape its grants (`.shift()` / `= []` / `= not` compiled clean).
  // Every union with a sequence member is refused, with or without `let`, either order,
  // own type or typed attribute.
  describe("a tape in an opener union is refused (its grants would not be checked)", () => {
    const E = `    type Entry:struct = { at: int, actor: string, action: string }`;
    const writes = `    function bad() { @audit.shift(); }\n    function bad2() { @audit = []; }\n    function bad3() { @audit = not; }`;
    const tape = (decl) => `<program>\n${E}\n${decl}\n${writes}\n    <main><button onclick=bad()>x</button><p>x</p></main>\n</program>\n`;
    const refused = (src) => {
      const r = run(src);
      expect(r.core == null).toBe(true);
      const d = r.diags.find((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("sequence in a union type"));
      expect(d).toBeDefined();
      return r;
    };
    test("the review repro: `let <audit:Entry[free, append] | not=[]/>`", () => {
      refused(tape(`    let <audit:Entry[free, append] | not=[]/>`));
    });
    test("without `let`: `<audit:Entry[free, append] | not=[]/>`", () => {
      refused(tape(`    <audit:Entry[free, append] | not=[]/>`));
    });
    test("`not` first: `<audit:not | Entry[free, append]=[]/>`, and unspaced `Entry[append]|not`", () => {
      refused(tape(`    <audit:not | Entry[free, append]=[]/>`));
      refused(tape(`    <audit:Entry[append]|not=[]/>`));
    });
    test("`Guess | not[free]` (a `not` tape) is refused too", () => {
      const c = codes(prog(`    <g:Guess | not[free]=.Yes/>`));
      expect(c).toContain("E-BOOTSTRAP-UNSUPPORTED");
    });
    test("a tape member in a typed attribute (`export <box xs:int[append] | not=[]/>`)", () => {
      const lib = `export <box xs:int[append] | not=[]/>\nrenders <p>x</p>\n`;
      const r = frontEnd(mods, [{ path: "lib.scrml", src: lib }, { path: "app.scrml", src: `<program>\n    import { box } from "./lib.scrml";\n    <main><box/></main>\n</program>\n` }]);
      expect(r.core == null).toBe(true);
      expect(r.diags.some((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("sequence in a union type"))).toBe(true);
    });
    test("a tape alone is unaffected: the granted append compiles, an ungranted shift is E-WRITE-NOT-GRANTED", () => {
      const ok = `<program>\n${E}\n    <audit:Entry[free, append]=[]/>\n    function add() { @audit.append({ at: 1, actor: "a", action: "b" }); }\n    <main><p>x</p></main>\n</program>\n`;
      expect(codes(ok)).toEqual([]);
      expect(codes(ok.replace("function add()", "function bad() { @audit.shift(); }\n    function add()"))).toEqual(["E-WRITE-NOT-GRANTED"]);
    });
    // review r2 (HIGH, pre-existing on main): the CODE-position type parser wrapped a
    // tape in `| not` too. One shared check (parse.scrml seqUnionCheck) now refuses it
    // in every type position: return type, struct field, parameter, local annotation.
    const inProg = (body) => `<program>\n${E}\n${body}\n    <main><p>x</p></main>\n</program>\n`;
    const refusedCode = (src, text) => {
      const r = run(src);
      expect(r.core == null).toBe(true);
      const d = r.diags.find((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("sequence in a union type"));
      expect(d).toBeDefined();
      if (text) expect(d.message).toContain("`" + text + "`");
    };
    test("repro A — a return type `-> Entry[free, append] | not` seeding a cell", () => {
      refusedCode(inProg(`    function mk() -> Entry[free, append] | not { return []; }\n    let <audit=(mk())/>\n    function bad() { @audit.shift(); @audit = []; }`), "Entry[free, append] | not");
    });
    test("repro B — a struct field `xs: Entry[free, append] | not`", () => {
      refusedCode(inProg(`    type Box:struct = { xs: Entry[free, append] | not }\n    let <b:Box=({ xs: [] })/>\n    function bad() { @b.xs = []; @b.xs = not; }`), "Entry[free, append] | not");
    });
    test("a parameter, a local annotation, and `not | T[…]` in a return type", () => {
      refusedCode(inProg(`    function p(xs: Entry[free, append] | not) -> int { return 1; }`));
      refusedCode(inProg(`    function q() -> int {\n        let ys: Entry[append] | not = []\n        return 1;\n    }`));
      refusedCode(inProg(`    function r() -> not | Entry[append] { return []; }`), "not | Entry[append]");
    });
    test("an UNGRANTED `S | not` (§17.7.2 admits it) parses in every position, and is never writable through `let`", () => {
      expect(codes(inProg(`    function g(z: int[] | not) -> int[] | not { return z; }\n    function f() -> int {\n        let ys: int[] | not = not;\n        return 1;\n    }`))).toEqual([]);
      // `let` on it is `let` on a sequence — seen through `| not`
      expect(codes(inProg(`    let <xs:int[] | not=not/>`))).toContain("E-GRANT-LET-ON-SEQUENCE");
      expect(codes(inProg(`    function mk() -> int[] | not { return not; }\n    let <xs=(mk())/>`))).toContain("E-GRANT-LET-ON-SEQUENCE");
      // without `let` it is locked: a whole write and a removal are refused
      const c = codes(inProg(`    <xs:int[] | not=not/>\n    function w() { @xs = [1]; }\n    function r() { @xs.shift(); }`));
      expect(c.filter((x) => x === "E-WRITE-NOT-GRANTED").length).toBe(2);
    });
    test("r3: the no-`let` advice sees through `| not` — a locked `Entry[] | not` cell and a derived one", () => {
      const locked = diag(inProg(`    <xs:Entry[] | not=[]/>\n    function w() { @xs = []; }`), "E-WRITE-NOT-GRANTED");
      expect(locked).toBeDefined();
      expect(locked.message).not.toContain("Declare it `let");
      expect(locked.message).toContain("`T[replace]`");
      const derived = diag(inProg(`    function give() -> Entry[] | not { return []; }\n    <ys=(give())/>\n    function w() { @ys = []; }`), "E-DERIVED-WRITE");
      expect(derived).toBeDefined();
      expect(derived.message).not.toContain("declare it `let`");
      expect(derived.message).toContain("E-GRANT-LET-ON-SEQUENCE");
    });
    test("a non-tape `T | not` in code positions is unaffected, either order", () => {
      expect(codes(inProg(`    function ok(n: int | not) -> not | string { return not; }`))).toEqual([]);
      expect(codes(inProg(`    type Box:struct = { s: string | not }\n    let <b:Box=({ s: not })/>\n    function w() { @b.s = "x"; }`))).toEqual([]);
    });
    test("a derived tape's E-DERIVED-WRITE never advises `let` (E-GRANT-LET-ON-SEQUENCE)", () => {
      const src = inProg(`    <src:Entry[free, append]=[]/>\n    <d:Entry[free, append]=(@src)/>\n    function w() { @d = []; }`);
      const d = diag(src, "E-DERIVED-WRITE");
      expect(d).toBeDefined();
      expect(d.message).not.toContain("declare it `let`");
      expect(d.message).toContain("E-GRANT-LET-ON-SEQUENCE");
      expect(d.message).toContain("`T[replace]`");
      // a non-sequence derived cell keeps the `let`-seeding advice
      const n = diag(inProg(`    let <a:int=1/>\n    <b:int=(@a + 1)/>\n    function w() { @b = 0; }`), "E-DERIVED-WRITE");
      expect(n.message).toContain("declare it `let`");
    });

    test("the locked-tape message never advises `let` (E-GRANT-LET-ON-SEQUENCE): it names `replace` in the grants", () => {
      const src = `<program>\n${E}\n    <ent:Entry[]=[]/>\n    function w() { @ent = []; }\n    <main><p>x</p></main>\n</program>\n`;
      const d = diag(src, "E-WRITE-NOT-GRANTED");
      expect(d).toBeDefined();
      expect(d.message).not.toContain("Declare it `let");
      expect(d.message).toContain("`replace`");
      // and `let` there is indeed refused, so the old advice pointed at an error
      expect(codes(src.replace("<ent:", "let <ent:"))).toContain("E-GRANT-LET-ON-SEQUENCE");
    });
  });

  test("`<g:Guess | not=Guess.Yes/>` — the union parses; the qualified value is an opener expression to parenthesize (§66.2.4), and `(Guess.Yes)` is a qualified variant (s469: admitted)", () => {
    const bare = codes(prog(`    <g:Guess | not=Guess.Yes/>`));
    expect(bare).not.toContain("E-PARSE-TAG");
    expect(bare).toContain("E-DECL-OPENER-EXPR-UNPARENTHESIZED");
    const paren = codes(prog(`    <g:Guess | not=(Guess.Yes)/>`));
    expect(paren).not.toContain("E-PARSE-TAG");
    expect(paren).toEqual([]);
  });
});
