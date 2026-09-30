/**
 * S441 declared-prose — review round 5 (PA review `review/s443-prose-r4`,
 * docs/known-gaps.md `g-body-top-invariant-bypassed-by-raw-text-nodes`).
 *
 * The coverage invariant credits a body-top statement only for the tokens it
 * COMPILES (SPEC §40.8 S441 coverage bullet; ruling S443 item 4 — "a node
 * covers only tokens it compiles"). Shared grammar: native-parser/
 * body-top-coverage.js.
 *   A — import / export / type stop where their grammar ends: the rest of the
 *       line is reported, a swallowed next line is compiled; a declaration that
 *       compiles nothing (`import stuff`, `type here`, `export data`,
 *       `fn heading`) and a bare literal statement (`404`) are errors.
 *   B — a body-top `;` is formatting (native fired E-INTERNAL on it).
 *   C — a label on a statement that is not a loop compiles nothing
 *       (`Total: 42` vanished on native).
 *   D — a tagged template the native bridge drops is no longer silent.
 * Every case runs on BOTH front ends.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const DIR = "/tmp/s441-review-r5-fixtures";
mkdirSync(DIR, { recursive: true });
writeFileSync(join(DIR, "a.js"), "export const a = 1; export default 2;\n");
let n = 0;
function compile(bodyLines, parser) {
  const f = join(DIR, `c-${++n}.scrml`);
  writeFileSync(f, `<program>\nfunction log(x) { console.log(x) }\n${bodyLines}\n<p id="z">end</p>\n</program>\n`);
  const out = join(DIR, `out-${n}`);
  if (existsSync(out)) rmSync(out, { recursive: true });
  const r = compileScrml({ inputFiles: [f], outputDir: out, write: true, log: () => {}, parser: parser ?? null });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (ext) => (existsSync(join(out, `c-${n}.${ext}`)) ? readFileSync(join(out, `c-${n}.${ext}`), "utf8") : "");
  return { errors, codes: errors.map((e) => e.code), client: read("client.js"), html: read("html") };
}
const at = (e) => e.tabSpan ?? e.span ?? {};
const BOTH = [["default", null], ["scrml-native", "scrml-native"]];

for (const [label, parser] of BOTH) {
  describe(`A — a statement covers only what it compiles (${label})`, () => {
    // ruling S443 item 4: body-top code that does nothing is a compile error.
    for (const src of ["import stuff", "type here", "export data", "fn heading", "404", "-1", "true", "[1, 2]", "\"a\" + 1"]) {
      test(`\`${src}\` compiles nothing → a compile error at line 3, never silent`, () => {
        const r = compile(src, parser);
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.codes).not.toContain("E-INTERNAL-BODY-TOP-DROPPED");
        expect(r.errors.some((e) => at(e).line === 3 || at(e).line === 4)).toBe(true);
      });
    }
    for (const [src, rest] of [
      ["type Color = \"red\" | \"blue\" zqxone zqxtwo", "zqxone"],
      ["type N = number zqxone", "zqxone"],
      ["export type T = number zqxone", "zqxone"],
    ]) {
      test(`\`${src}\` — the type ends before the line does: \`${rest}\` is reported`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(r.errors[0].message).toContain(rest);
        expect(at(r.errors[0]).line).toBe(3);
      });
    }
    test("`type Color = \"red\" | \"blue\",⏎Welcome to the store` — both lines reported", () => {
      const r = compile("type Color = \"red\" | \"blue\",\nWelcome to the store", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT", "E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors.map((e) => at(e).line).sort()).toEqual([3, 4]);
    });
    test("a body token named like an Object.prototype member (`toString`, `constructor`) is not read as a bracket", () => {
      const r = compile("function enc(h) {\n    return String(h).toString() + \"constructor\".valueOf()\n}\nlog(enc(1))", parser);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("toString");
    });
    test("well-formed declarations still compile, and the next line is its own statement", () => {
      const r = compile("import { a } from \"./a.js\";\ntype T = number;\ntype U = \"x\" | \"y\"\ntype P = number(>0)\nexport type Q = number\nlog(\"after\")", parser);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("after");
    });
  });

  describe(`B — a body-top \`;\` is source formatting (${label})`, () => {
    for (const src of ["<count> = 0\n@count = 1;", "log(1); log(2);", ";", "log(1); ; log(2)"]) {
      test(`${JSON.stringify(src)} compiles clean`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual([]);
      });
    }
  });

  describe(`C — a label on a non-loop compiles nothing (${label})`, () => {
    for (const src of ["Total: 42", "Step1: \"Install the app\"", "Docs: https://example.com/x", "Status: ready"]) {
      test(`\`${src}\` → E-UNQUOTED-DISPLAY-TEXT at line 3`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(at(r.errors[0]).line).toBe(3);
      });
    }
    test("a label a `break` targets is code (§49)", () => {
      // (A labelled `break` then fails codegen — E-CODEGEN-INVALID-LOGIC, a
      // pre-existing gap the label check does not own; the body-top check
      // itself accepts the label.)
      const r = compile("outer: for (const a of [1]) { for (const b of [2]) { if (b) { break outer } log(\"loop\" + b) } }", parser);
      expect(r.codes).not.toContain("E-UNQUOTED-DISPLAY-TEXT");
      expect(r.codes).not.toContain("E-STMT-NO-EFFECT");
      expect(r.codes).not.toContain("E-INTERNAL-BODY-TOP-DROPPED");
    });
    test("a label nothing targets is an error on the label; the loop compiles (ruling S445 #2)", () => {
      const r = compile("outer: for (const x of [1, 2]) { log(\"loop\" + x) }", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain("`outer");
      expect(at(r.errors[0]).line).toBe(3);
    });
  });
}

describe("A — default front end: a declaration that swallowed the next line gives it back", () => {
  test("`import { a } from \"./a.js\" -⏎log(\"side effect\")` — `-` reported, the call compiles", () => {
    const r = compile("import { a } from \"./a.js\" -\nlog(\"side effect\")", null);
    expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    expect(r.errors[0].message).toContain("`-`");
    expect(at(r.errors[0]).line).toBe(3);
  });
  for (const [src, rest] of [
    ["import zz from \"./a.js\" zqxone", "zqxone"],
    ["export 3.14 zqF", "3.14"],
    ["export const zq = 1 zqxone", "zqxone"],
    ["export function f2() { return 1 } zqxone", "zqxone"],
    ["export { log } zqxone", "zqxone"],
    ["export * from \"./a.js\" zqxone", "zqxone"],
  ]) {
    test(`\`${src}\` → the uncompiled \`${rest}\` is reported`, () => {
      const r = compile(src, null);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain(rest);
    });
  }
});

describe("D — native: a tagged template the bridge drops is not silent", () => {
  test("`log`x`` at body top fails closed on native (the bridge translates it to an empty escape-hatch)", () => {
    const r = compile("log`x`", "scrml-native");
    expect(r.codes).toEqual(["E-INTERNAL-BODY-TOP-DROPPED"]);
  });
});

// ---------------------------------------------------------------------------
// Round 5b — S239 review of review/s445-prose-r5.
// ---------------------------------------------------------------------------
writeFileSync(join(DIR, "x.js"), "export const a = 1;\n");
for (const [label, parser] of BOTH) {
  describe(`N1 — an export the live AST cannot carry, and a comma sequence, never compile clean (${label})`, () => {
    for (const src of [
      "export default function helperZq() { return 1 }\n<p>${helperZq()}</p>",
      "export default 42",
      "export default { a: 1 }",
      "export * as ns from \"./x.js\"",
      "function step() { console.log(\"s\") }\n(step(), 1)",
      "function step() { console.log(\"s\") }\n(step(), step())",
    ]) {
      test(`${JSON.stringify(src)} → E-UNQUOTED-DISPLAY-TEXT, never a clean compile with the code dropped`, () => {
        const r = compile(src, parser);
        expect(r.codes).toContain("E-UNQUOTED-DISPLAY-TEXT");
        expect(r.codes).not.toContain("E-INTERNAL-BODY-TOP-DROPPED");
      });
    }
  });

  describe(`N2 — a do/while statement covers its closing \`)\` (${label})`, () => {
    test("`do { … } while (@zq > 3)` compiles clean", () => {
      const r = compile("<zq> = 0\ndo { @zq = @zq + 1 } while (@zq > 3)\n<p>${@zq}</p>", parser);
      expect(r.codes).toEqual([]);
    });
  });

  describe(`D2 — a braced type is an operand of the type grammar (${label})`, () => {
    for (const src of ["type L = { a: number }[]", "type U = { a: number } | { b: string }", "type I = { a: number } & { b: string }"]) {
      test(`\`${src}\` compiles clean`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual([]);
      });
    }
    test("`type L = { a: number }[] zqx` — the rest of the line is still reported", () => {
      const r = compile("type L = { a: number }[] zqx", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain("zqx");
    });
  });

  describe(`D3 — a bare read before a state declaration is two statements (${label})`, () => {
    // (Since ruling S445 #2 the bare read is itself an error — "has no
    // effect" — but on ITS line only: the declaration below it survives.)
    for (const [src, read] of [["<count> = 0\n@count\n<total> = 0\n<p>${@count} ${@total}</p>", "@count"], ["<o> = { a: 1 }\n@o.a\n<total> = 0\n<p>${@o.a} ${@total}</p>", "@o.a"]]) {
      test(`${JSON.stringify(src)} → E-STMT-NO-EFFECT on \`${read}\`, the declaration survives`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual(["E-STMT-NO-EFFECT"]);
        expect(r.errors[0].message).toContain("`" + read + "` has no effect");
        expect(at(r.errors[0]).line).toBe(4);
      });
    }
  });

  describe(`S445 #2 — an expression statement with no effect is an error (${label})`, () => {
    const PRE = "<a> = 0\n<count> = 0\n<x> = false\n<o> = { a: 1 }\nfunction step() { return 1 }\n";
    for (const src of ["@a == 1", "\"Total: \" + @count", "!@x", "typeof @x", "@x ? 1 : 2", "\"abc\".length", "x => x", "this", "@count", "@o.a", "step"]) {
      test(`\`${src}\` → E-STMT-NO-EFFECT`, () => {
        const r = compile(PRE + src + "\n<p>${@a}${@count}${@x}${@o.a}</p>", parser);
        expect(r.codes).toEqual(["E-STMT-NO-EFFECT"]);
        expect(r.errors[0].message).toContain("has no effect");
      });
    }
    test("`--@a` has an effect (a body-top check never rejects it; codegen of a prefix `--` on a cell is a separate, pre-existing E-CODEGEN gap)", () => {
      const r = compile(PRE + "--@a\n<p>${@a}${@count}${@x}${@o.a}</p>", parser);
      expect(r.codes).not.toContain("E-STMT-NO-EFFECT");
      expect(r.codes).not.toContain("E-UNQUOTED-DISPLAY-TEXT");
    });
    for (const src of ["step()", "log(@a)", "@a = 1", "@a += 1", "@a++", "@o.a = 2", "(@a = 5)", "\"abc\".toUpperCase()", "@x ? step() : log(1)", "@a == 1 || step()", "new Date()", "on mount { log(1) }"]) {
      test(`\`${src}\` has an effect → compiles clean`, () => {
        const r = compile(PRE + src + "\n<p>${@a}${@count}${@x}${@o.a}</p>", parser);
        expect(r.codes).toEqual([]);
      });
    }
    test("an untargeted label on a `while` is reported on the label; the loop compiles", () => {
      const r = compile(PRE + "Instructions:\nwhile (@a != 3) { @a = @a + 1 }\n<p>${@a}${@count}${@x}${@o.a}</p>", parser);
      expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
      expect(r.errors[0].message).toContain("Instructions");
    });
  });
}

describe("N1 — native: a nested expression the bridge cannot translate fails closed", () => {
  test("`go((step(), 7))` — the argument would be dropped → E-INTERNAL-BODY-TOP-DROPPED, not a clean compile", () => {
    const r = compile("function step() { return 1 }\nfunction go(x) { console.log(x) }\ngo((step(), 7))", "scrml-native");
    expect(r.codes).toEqual(["E-INTERNAL-BODY-TOP-DROPPED"]);
  });
});

// ---------------------------------------------------------------------------
// Round 5c — re-review of 53161db07.
// ---------------------------------------------------------------------------
describe("R1 — a C-style `for` header is three clauses, not prose (default)", () => {
  for (const head of ["let i = 0; i != 3; i++", "let i = 0; i <3; i++", "let i = 3; i > 0; i--"]) {
    test(`\`for (${head}) { … }\` compiles clean and emits the loop`, () => {
      const r = compile(`<zc> = 0\nfor (${head}) { @zc = @zc + i }\n<p>\${@zc}</p>`, null);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("for (let i =");
    });
  }
  test("prose inside the header is still not code", () => {
    const r = compile("for (let i = 0; the loop; runs) { log(i) }", null);
    expect(r.codes).toContain("E-UNQUOTED-DISPLAY-TEXT");
  });
  test("native: the bridge drops the init (`for (; …)`) — that fails closed, never compiles clean", () => {
    // Pre-existing native bridge gap (main native emits `for (; i != 3; i++)`).
    const r = compile("<zc> = 0\nfor (let i = 0; i != 3; i++) { @zc = @zc + i }\n<p>${@zc}</p>", "scrml-native");
    expect(r.codes).toContain("E-INTERNAL-BODY-TOP-DROPPED");
  });
});

for (const [label, parser] of BOTH) {
  describe(`R2 — tokens between a function's head and its body are reported (${label})`, () => {
    for (const [src, rest] of [
      ["function f() -> number oops junk { return 1 }\n<p>${f()}</p>", "oops junk"],
      ["export function g() -> number bad { return 1 }", "bad"],
    ]) {
      test(`${JSON.stringify(src)} → E-UNQUOTED-DISPLAY-TEXT quoting \`${rest}\``, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
        expect(r.errors[0].message).toContain("`" + rest + "`");
        expect(at(r.errors[0]).line).toBe(3);
      });
    }
  });
}
describe("R2 — default: `: T junk {` multi-line", () => {
  test("`function f(): number junk {⏎…⏎}` → `junk` reported; the body still compiles", () => {
    // (native does not parse a `:` return type on `function` — pre-existing gap)
    const r = compile("function f(): number junk {\n  return 1\n}\n<p>${f()}</p>", null);
    expect(r.codes).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    expect(r.errors[0].message).toContain("`junk`");
  });
  test("a well-formed failable / braced-return head has no gap", () => {
    const r = compile("type E:enum = { A, B }\nserver fn h() ! -> E {\n  return 1\n}\nserver function h2() ! E {\n  fail E::A\n}\nfn k(a) -> { ok: boolean } { return { ok: true } }", null);
    expect(r.codes).toEqual([]);
  });
});

describe("D1 — default: a braced RETURN type is not the function body", () => {
  // (The native parser does not read a `->` / `:` return type on `function`
  // at all — a pre-existing native gap, E-STMT-* on main too.)
  for (const src of [
    "function f() -> { a: number } { return { a: 1 } }\n<p>${f().a}</p>",
    "function f(): { a: number } { return { a: 1 } }\n<p>${f().a}</p>",
    "server function f() -> { ok: boolean } { return { ok: true } }",
  ]) {
    test(`${JSON.stringify(src)} compiles clean`, () => {
      const r = compile(src, null);
      expect(r.codes).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Round 5d — re-review of 55ac55d2f.
// ---------------------------------------------------------------------------
for (const [label, parser] of BOTH) {
  describe(`5d #1 — \`reset(@a)\` is a cell write (§6.8), an effect (${label})`, () => {
    test("`reset(@a)` at body top compiles clean", () => {
      const r = compile("<a> = 1\nreset(@a)\n<p>${@a}</p>", parser);
      expect(r.codes).toEqual([]);
    });
  });
  describe(`5d #2 — empty clauses in a C-style \`for\` header (${label})`, () => {
    for (const src of ["for (;;) { break }", "<a> = 1\nfor (; @a != 3; @a++) { }"]) {
      test(`${JSON.stringify(src)} compiles clean`, () => {
        const r = compile(src, parser);
        expect(r.codes).toEqual([]);
      });
    }
  });
  describe(`5d nit — \`@a; @b\` is two statements with no effect (${label})`, () => {
    test("→ E-STMT-NO-EFFECT, not E-UNQUOTED", () => {
      const r = compile("<a> = 0\n<b> = 1\n@a; @b\n<p>${@a}${@b}</p>", parser);
      expect(r.codes).toEqual(["E-STMT-NO-EFFECT"]);
    });
  });
}
describe("5d #3 — default: a regex literal alone on a line has no effect", () => {
  test("`/abc/` after markup → E-STMT-NO-EFFECT (was: counted as an effect, compiled clean)", () => {
    // (The block splitter also reads the `/` before the next closer as a
    // legacy bare closer, E-SYNTAX-050 — pre-existing.)
    const r = compile("<p>x</p>\n/abc/", null);
    expect(r.codes).toContain("E-STMT-NO-EFFECT");
  });
  test("an unmodelled expression WITH an effect still compiles (a block-body lambda call)", () => {
    const r = compile("(() => { console.log(1) })()", null);
    expect(r.codes).not.toContain("E-STMT-NO-EFFECT");
  });
});
for (const [label, parser] of BOTH) {
  describe(`5d — a named function in statement position is a declaration, not a no-effect value (${label})`, () => {
    test("`on mount { function inner(x) {…} … }` compiles clean", () => {
      const r = compile("<verdict> = \"unset\"\nserver function isOk(n) { return n > 100 }\non mount {\n  function inner(x) { return isOk(x) }\n  const any = [1, 2, 3].some(x => inner(x))\n  @verdict = any ? \"accepted\" : \"rejected\"\n}\n<p>${@verdict}</p>", parser);
      expect(r.codes).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------------------
// Round 5e — a `renders <markup>` clause is markup: its text is kept exactly.
// ---------------------------------------------------------------------------
for (const [label, parser] of BOTH) {
  describe(`5e — \`renders\` markup is taken verbatim (dpa-045) (${label})`, () => {
    test("`No #${id}` keeps its `#`, inserts no space; sibling sigils `^` `!` `~` before `${` are content; runs of spaces are kept", () => {
      const r = compile("type LE:enum = { Alpha(id: string) renders <p class=\"r\">No #${id} c^${id} b!${id} t~${id} end</p>, Beta(n: string) renders <span class=\"s\">  two  spaces ${n}  </span> }\n<a>: LE = .Alpha(\"42\")\n<b>: LE = .Beta(\"7\")\n<div><render of=@a/><render of=@b/></div>", parser);
      expect(r.codes).toEqual([]);
      expect(r.client).toContain("<p class=\\\"r\\\">No #\" + ");
      expect(r.client).toContain("\" c^\" + ");
      expect(r.client).toContain("\" b!\" + ");
      expect(r.client).toContain("\" t~\" + ");
      expect(r.client).toContain("<span class=\\\"s\\\">  two  spaces \" + ");
      expect(r.client).not.toContain("$ { ");
    });
  });
}
