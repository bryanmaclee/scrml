/**
 * Tests for `scrml fix` — the mechanical §66.21 rules (change-id s449-scrml-fix-s66-twins,
 * S449 corpus-dialect rulings 2 + 6). compiler/src/commands/fix-s66.js + commands/fix.js.
 *
 * Every rule: a before/after fixture, idempotence (a second run makes no edit and reports
 * nothing new), and a non-mechanical form left untouched + reported.
 *
 *   §1 rhs-decl — locked vs `let` from the write set (assignment, update, compound op, bind:,
 *      reset, field write, mutating method, write-implying modifier); the amended §66.21 rule
 *      (a reactive initializer never silently becomes derived); types (number / inferred /
 *      annotated / bare variant / scalar arrays)
 *   §2 const-cell
 *   §3 engine-simple (+ `<*v/>` when a state-child has a body)
 *   §4 program-wrap / program-move / unwrap-logic
 *   §5 non-mechanical forms: untouched + reported
 *   §6 a §66-dialect file is left alone (idempotence on canonical input)
 *   §7 the CLI: --dry-run, --check, in-place write, --json
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixS66, S66_RULES } from "../../src/commands/fix-s66.js";
import { runFixCommand, classifyEntry, lineDiff } from "../../src/commands/fix.js";

const fix = (src, opts = {}) => fixS66(src, { filePath: "t.scrml", ...opts });

/** Run, assert no blockers, assert idempotent; return the output. */
function clean(src, opts) {
  const r = fix(src, opts);
  expect(r.blockers).toEqual([]);
  const r2 = fix(r.output, opts);
  expect(r2.output).toBe(r.output);
  expect(r2.blockers).toEqual([]);
  expect(r2.applied.filter((a) => a.rule !== "pre-migrate")).toEqual([]);
  return r.output;
}

/** Run, assert the source is untouched at the blocker and a blocker names `needle`. */
function blocked(src, needle, opts) {
  const r = fix(src, opts);
  expect(r.blockers.map((b) => b.reason).join("\n")).toContain(needle);
  return r;
}

const wrapP = (body) => `<program>\n${body}\n</program>\n`;

describe("§1 rhs-decl", () => {
  test("never written + literal → LOCKED; untyped number spells :number (impl#1 has no int inference)", () => {
    const out = clean(wrapP(`<step> = 1\n<p>\${@step}</p>`));
    expect(out).toContain("<step:number=1/>");
    expect(out).not.toContain("let <step");
  });

  test("strings and booleans infer (no annotation written)", () => {
    const out = clean(wrapP(`<name> = "Ada"\n<on> = true\n<p>\${@name}\${@on}</p>`));
    expect(out).toContain(`<name="Ada"/>`);
    expect(out).toContain(`<on=true/>`);
  });

  test("an annotation is kept verbatim: <n>: int = 5 → <n:int=5/>", () => {
    expect(clean(wrapP(`<n>: int = 5\n<p>\${@n}</p>`))).toContain("<n:int=5/>");
  });

  for (const [label, write] of [
    ["assignment", "@c = 2"],
    ["compound operator", "@c += 2"],
    ["postfix update", "@c++"],
    ["prefix update", "--@c"],
    ["reset", "reset(@c)"],
  ]) {
    test(`written by ${label} → let`, () => {
      const out = clean(wrapP(`<c> = 0\nfunction f() { ${write} }\n<button onclick=f()>x</button>\n<p>\${@c}</p>`));
      expect(out).toContain("let <c:number=0/>");
    });
  }

  test("written by bind: → let", () => {
    const out = clean(wrapP(`<name> = ""\n<input bind:value=@name/>`));
    expect(out).toContain(`let <name=""/>`);
  });

  test("written through a field → let", () => {
    const out = clean(wrapP(`<s> = "a"\nfunction f() { @s.x = 1 }\n<button onclick=f()>x</button>`));
    expect(out).toContain(`let <s="a"/>`);
  });

  test("a write-implying modifier (`server`, `persist=`, `debounced=`…) → let, carried into the opener", () => {
    const out = clean(wrapP(`<v debounced=1s> = 0\n<p>\${@v}</p>`));
    expect(out).toContain("let <v:number=0 debounced=1s/>");
  });

  test("a `^{}` meta block makes every cell written", () => {
    const out = clean(wrapP(`<k> = 1\n^{ emit("x") }\n<p>\${@k}</p>`));
    expect(out).toContain("let <k:number=1/>");
  });

  test("S449 ruling 2 (amended §66.21): a REACTIVE initializer on a never-written cell → let (seeded), never locked (derived)", () => {
    const out = clean(wrapP(`<a> = 1\n<b>: number = @a\n<p>\${@b}</p>`));
    expect(out).toContain("let <b:number=@a/>");
    expect(out).not.toMatch(/(^|\n)<b:number=@a\/>/);
    expect(out).toContain("<a:number=1/>"); // `a` is read, never written: locked
  });

  test("a non-literal untyped initializer is left untouched + reported (O35)", () => {
    const src = wrapP(`<a> = 1\n<b> = @a + 1\n<p>\${@b}</p>`);
    const r = blocked(src, "needs a type (CTX — O35)");
    expect(r.output).toContain("<b> = @a + 1");
    expect(r.output).toContain("<a:number=1/>"); // the mechanical site still rewrote
  });

  test("a bare variant gets the enum that declares it", () => {
    const out = clean(wrapP(`type Mode:enum = { Light, Dark }\n<m> = .Light\nfunction t() { @m = .Dark }\n<button onclick=t()>x</button>`));
    expect(out).toContain("let <m:Mode=.Light/>");
  });

  test("a bare variant two enums declare is reported, not guessed", () => {
    blocked(wrapP(`type A:enum = { On, Off }\ntype B:enum = { On, Idle }\n<m> = .On\n<p>\${@m}</p>`), "declared by 2 enums");
  });

  test("a never-written scalar array → locked, element type inferred, parenthesized (O32)", () => {
    expect(clean(wrapP(`<xs> = [1, 2, 3]\n<p>\${@xs.length}</p>`))).toContain("<xs:number[]=([1, 2, 3])/>");
  });

  test("a WRITTEN sequence is reported (its grants are CTX), the decl left untouched", () => {
    const r = blocked(wrapP(`<xs> = [1]\nfunction f() { @xs.push(2) }\n<button onclick=f()>x</button>`), "written sequence");
    expect(r.output).toContain("<xs> = [1]");
  });

  test("a sequence passed bare to a function may be aliased → treated as written", () => {
    blocked(wrapP(`<xs> = [1]\nfunction f() { g(@xs) }\n<button onclick=f()>x</button>`), "written sequence");
  });

  test("a type with a top-level space (a union) is reported — its opener spelling is not ruled", () => {
    blocked(wrapP(`<u>: string | not = not\n<p>\${@u}</p>`), "has a space at its top level");
  });

  test("a refinement / lifecycle type stands bare in the opener (S449 ruling 4)", () => {
    expect(clean(wrapP(`<hp>: number(>0) = 5\n<p>\${@hp}</p>`))).toContain("<hp:number(>0)=5/>");
  });

  test("a trailing `;` on the legacy statement is absorbed", () => {
    expect(clean(wrapP(`<z> = "q";\n<p>\${@z}</p>`))).toContain(`<z="q"/>\n`);
  });
});

describe("§2 const-cell", () => {
  test("annotated derived → locked declaration with a parenthesized reactive initializer (§66.9 rule 7)", () => {
    const out = clean(wrapP(`<a> = 1\nconst <d>: number = @a * 2\nfunction f() { @a = 3 }\n<button onclick=f()>x</button>\n<p>\${@d}</p>`));
    expect(out).toContain("<d:number=(@a * 2)/>");
    expect(out).not.toContain("let <d");
    expect(out).not.toContain("const");
  });

  test("an untyped non-literal derived value is reported (O35)", () => {
    blocked(wrapP(`<a> = 1\nconst <d> = @a * 2\n<p>\${@d}</p>`), "needs a type");
  });
});

describe("§3 engine-simple", () => {
  const base = `type Phase:enum = { Idle, Busy }\n`;
  test("<engine for=T initial=.X> → <t:T=.X single>, state-children verbatim, closer normalized", () => {
    const out = clean(wrapP(`${base}<engine for=Phase initial=.Idle>\n    <Idle rule=.Busy></>\n    <Busy rule=.Idle></>\n</engine>\n<p>\${@phase}</p>`));
    expect(out).toContain("<phase:Phase=.Idle single>\n    <Idle rule=.Busy></>\n    <Busy rule=.Idle></>\n</>");
    expect(out).not.toContain("<*phase/>"); // no state-child body renders anything
  });

  test("`var=` names the declaration", () => {
    expect(clean(wrapP(`${base}<engine for=Phase initial=.Idle var=st>\n    <Idle rule=.Busy></>\n    <Busy rule=.Idle></>\n</>`))).toContain("<st:Phase=.Idle single>");
  });

  test("a state-child with a body: <*v/> keeps the render where the legacy engine rendered (O5 1i)", () => {
    const out = clean(wrapP(`${base}<engine for=Phase initial=.Idle>\n    <Idle rule=.Busy><p>idle</p></>\n    <Busy rule=.Idle></>\n</>`));
    expect(out).toMatch(/<\/>\n<\*phase\/>/);
  });

  test("engine surface beyond the simple rule is reported (accepts= / derived= / effect= …)", () => {
    const r = blocked(wrapP(`${base}type M:enum = { Go }\n<engine for=Phase initial=.Idle accepts=M>\n    <Idle rule=.Busy></>\n    <Busy rule=.Idle></>\n</>`), "beyond the simple rule");
    expect(r.output).toContain("<engine for=Phase initial=.Idle accepts=M>");
  });
});

describe("§4 program-wrap / program-move / unwrap-logic", () => {
  test("an entry with no <program> is wrapped; the depth-0 ${} unwraps", () => {
    const out = clean("${\n    <count> = 0\n    function inc() { @count = @count + 1 }\n}\n<button onclick=inc()>+</button>\n");
    expect(out).toBe("<program>\n    let <count:number=0/>\n    function inc() { @count = @count + 1 }\n<button onclick=inc()>+</button>\n</program>\n");
  });

  test("a non-entry (module) file is never wrapped and its ${} stays", () => {
    const r = fix("${ export function f() { return 1 } }\n", { entry: false });
    expect(r.output).toBe("${ export function f() { return 1 } }\n");
    expect(r.blockers).toEqual([]);
  });

  test("items above <program> move inside it", () => {
    const out = clean("${\n    type P:enum = { A, B }\n}\n<program>\n<p>x</p>\n</program>\n");
    expect(out.startsWith("<program>\n")).toBe(true);
    expect(out).toContain("type P:enum = { A, B }");
    expect(out.indexOf("type P")).toBeGreaterThan(out.indexOf("<program>"));
  });

  test("a ${} inside markup is NOT unwrapped (depth 0 only), and a declaration there is reported (O38)", () => {
    const r = blocked(wrapP(`<div>\${ <inner> = 1 }</div>`), "markup position");
    expect(r.output).toContain("<div>${ <inner> = 1 }</div>");
  });

  test("a top-level ${} holding an expression statement (rendered in legacy) is not unwrapped", () => {
    const r = fix("${ <n> = 1\n  @n }\n<p>x</p>\n");
    expect(r.blockers.map((b) => b.rule)).toContain("unwrap-logic");
  });

  test("top-level prose blocks the wrap (a <program> body reads it as code — S441)", () => {
    blocked("${ <n> = 1 }\nHello there\n<p>\${@n}</p>\n", "top-level prose");
  });

  test("verify: a wrap impl#1 reads differently is WITHDRAWN and reported (an <outlet/> outside a shell)", () => {
    const src = "<div>\n  <h1>Not a shell</h1>\n  <outlet/>\n</div>\n";
    const r = fix(src);
    expect(r.output).toBe(src);
    expect(r.blockers.map((b) => b.reason).join("\n")).toContain("impl#1 reads the restructured file differently (-E-OUTLET-OUTSIDE-SHELL)");
    // BITE: with verify off the wrap goes through — the compile is what caught it
    const r2 = fix(src, { verify: false });
    expect(r2.output.startsWith("<program>")).toBe(true);
  });

  test("a top-level ${} holding a non-item statement (a logic `const`, a loop) keeps its ${}", () => {
    const out = clean("${\n    const k = 3\n}\n<p>${k}</p>\n");
    expect(out).toContain("${\n    const k = 3\n}");
  });

  test("a file with no top-level markup element is not wrapped (impl#1 emits no page for it)", () => {
    const r = fix("${\n    function f() { return 1 }\n}\n");
    expect(r.output).toBe("${\n    function f() { return 1 }\n}\n");
    expect(r.blockers).toEqual([]);
  });

  test("a bare declaration at the root of a file that stays without <program> is reported, not rewritten", () => {
    const r = blocked("<count> = 0\n<match on=@count>\n</>\n", "root of a file with no `<program>`");
    expect(r.output).toContain("<count> = 0");
  });

  test("two top-level <program>s (a live E-PROGRAM-002 case) is not restructured and not reported", () => {
    const r = fix("<program>\n<p>a</p>\n</program>\n<program>\n<p>b</p>\n</program>\n");
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual([]);
  });
});

describe("§5 non-mechanical forms — untouched + reported", () => {
  test("Shape 2 (render-spec RHS)", () => {
    const r = blocked(wrapP(`<who req> = <input type="text"/>`), "Shape 2");
    expect(r.output).toContain(`<who req> = <input type="text"/>`);
  });
  test("component `const X = <root>`", () => {
    blocked(wrapP(`const Card = <div class="c">\${children}</div>\n<Card/>`), "component");
  });
  test("compound cell", () => {
    blocked(wrapP(`<form1>\n    <name> = ""\n</>`), "compound");
  });
  test("render-by-tag of a cell", () => {
    blocked(wrapP(`<count> = 0\n<count/>`), "render-by-tag");
  });
  test("Shape 4 (typed, no initializer)", () => {
    blocked(wrapP(`\${ <s>: string }\n<p>\${@s}</p>`), "Shape 4");
  });
  test("an exported cell", () => {
    blocked("${ export <x> = 1 }\n", "exported cell", { entry: false });
  });
});

describe("§6 canonical §66 input is left alone", () => {
  test("a §66-dialect program: no edit, no blocker", () => {
    const src = wrapP(`let <count:int=0/>\n<step=1/>\nfunction inc() { @count = @count + 1 }\n<button onclick=inc()>+</button>`);
    const r = fix(src);
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual([]);
  });
  test("S66_RULES is the stable rule-id list", () => {
    expect([...S66_RULES]).toEqual(["pre-migrate", "rhs-decl", "const-cell", "engine-simple", "program-wrap", "program-move", "unwrap-logic"]);
  });
  test("a rules subset applies only those rules", () => {
    const r = fix("${\n    <count> = 0\n}\n<p>${@count}</p>\n", { rules: ["program-wrap"] });
    expect(r.output).toContain("<count> = 0");
    expect(r.output.startsWith("<program>")).toBe(true);
  });
});

describe("§7 the CLI", () => {
  const legacy = "${\n    <count> = 0\n    function inc() { @count = @count + 1 }\n}\n<button onclick=inc()>+</button>\n";
  const io = () => {
    const o = { out: [], err: [] };
    return { o, io: { out: (s) => o.out.push(s), err: (s) => o.err.push(s) } };
  };

  test("--dry-run prints the diff and writes nothing; --check exits 1; a plain run writes in place; a re-run is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, legacy);
      const a = io();
      expect(runFixCommand([f, "--dry-run"], a.io)).toBe(0);
      expect(a.o.out.join("\n")).toContain("+    let <count:number=0/>");
      expect(readFileSync(f, "utf8")).toBe(legacy);
      expect(runFixCommand([f, "--check"], io().io)).toBe(1);
      expect(readFileSync(f, "utf8")).toBe(legacy);
      expect(runFixCommand([f], io().io)).toBe(0);
      expect(readFileSync(f, "utf8")).toContain("let <count:number=0/>");
      expect(runFixCommand([f, "--check"], io().io)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a blocker is reported as path:line rule: reason (and the file is still written for what IS mechanical)", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, "<program>\n<a> = 1\n<who req> = <input/>\n</program>\n");
      const a = io();
      runFixCommand([f], a.io);
      expect(a.o.err.join("\n")).toMatch(/app\.scrml:3 rhs-decl: Shape 2/);
      expect(readFileSync(f, "utf8")).toContain("<a:number=1/>");
      expect(readFileSync(f, "utf8")).toContain("<who req> = <input/>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--json reports applied rules and blockers", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-fix-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, legacy);
      const a = io();
      runFixCommand([f, "--json", "--dry-run"], a.io);
      const j = JSON.parse(a.o.out.join("\n"));
      expect(j.files[0].applied.map((x) => x.rule)).toContain("rhs-decl");
      expect(j.files[0].blockers).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown rule / option is a usage error", () => {
    expect(runFixCommand(["x.scrml", "--rules=nope"], io().io)).toBe(1);
    expect(runFixCommand(["x.scrml", "--frobnicate"], io().io)).toBe(1);
  });

  test("classifyEntry: modules and route files are not wrapped", () => {
    expect(classifyEntry("${ export function f() {} }", "lib/x.scrml").entry).toBe(false);
    expect(classifyEntry("<p>x</p>", "pages/x.scrml").entry).toBe(false);
    expect(classifyEntry("<p>x</p>", "app.scrml").entry).toBe(true);
    expect(classifyEntry("${ function f() {} }", "app.scrml").entry).toBe(false);
  });

  test("lineDiff marks removals and additions", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc", "f");
    expect(d).toContain("-b");
    expect(d).toContain("+B");
  });
});
