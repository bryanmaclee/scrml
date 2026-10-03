// program-shape.test.js — s451: two FAIL-OPEN shapes in the bootstrap's program
// shape now fail closed (gaps g-bootstrap-program-attrs-ignored-fail-open and
// g-bootstrap-entry-content-outside-program-dropped-silently).
//   (A) every `<program>` attribute was parsed and never read — `auth="bogus"`,
//       `frobnicate="1"`, `capabilities=[teleport]`, a nested `<program auth=…>`
//       compiled with zero diagnostics. Each attribute now gets its SPEC code
//       where the rule is static (§52.13.2, §23.5.3, §39.2.4, §4.12.2, §52.13.3,
//       §58.8) and is otherwise refused (E-BOOTSTRAP-UNSUPPORTED). A LEGAL
//       `auth=` is refused too: the bootstrap emits no login gate, so it never
//       compiles an `auth="required"` program ungated.
//   (B) a second top-level `<program>` silently won (the LAST was kept), and
//       markup at a file's top level outside any `<program>` was dropped. Now
//       E-PROGRAM-002 (§40.8) and, for file-top markup, the SPEC's code where one
//       exists (§38.1, §20.8.1, §23.6) else E-BOOTSTRAP-UNSUPPORTED.
// The governing sentences: docs/changes/s451-boot-program-shape/progress.md.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const prog = (attrs, body = "<p>x</p>") => `<program ${attrs}>\n    ${body}\n</program>\n`;

describe("(A) §52.13.2 — `auth=` on the top-level `<program>`", () => {
  for (const [label, attr] of [
    ["an unrecognized literal", `auth="bogus"`],
    ["a wrong-case literal", `auth="Required"`],
    ["padding", `auth=" required"`],
    ["the empty string", `auth=""`],
    ["a bare attribute", `auth`],
    ["a cell", `auth=@mode`],
  ]) {
    test(`${label} (${attr}) → exactly one E-AUTH-ATTR-INVALID listing the three legal values (was: no diagnostic)`, () => {
      const d = run(prog(attr)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-AUTH-ATTR-INVALID"]);
      for (const v of ["required", "optional", "none"]) expect(d[0].message).toContain(`"${v}"`);
    });
  }
  test("the message names a literal value as written", () => {
    expect(run(prog(`auth="Required"`)).diags[0].message).toContain(`"Required"`);
  });
  for (const v of ["required", "optional", "none"]) {
    test(`a legal \`auth="${v}"\` is REFUSED (E-BOOTSTRAP-UNSUPPORTED) — never compiled ungated`, () => {
      const d = run(prog(`auth="${v}"`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain(`auth="${v}"`);
    });
  }
});

describe("(A) §39.2.4 — `ratelimit=` is `N/unit`, unit ∈ { sec, min, hour }", () => {
  for (const v of ["100/fortnight", "/min", "1x/min", "100", "100/Min", ""]) {
    test(`ratelimit="${v}" → E-MW-002`, () => {
      expect(codes(prog(`ratelimit="${v}"`))).toEqual(["E-MW-002"]);
    });
  }
  test("a non-literal value does not match the form → E-MW-002", () => {
    expect(codes(prog(`ratelimit=@r`))).toEqual(["E-MW-002"]);
  });
  for (const v of ["100/min", "10/sec", "1000/hour"]) {
    test(`a valid ratelimit="${v}" is REFUSED (the bootstrap has no request pipeline), not dropped`, () => {
      const d = run(prog(`ratelimit="${v}"`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain("ratelimit");
    });
  }
});

describe("(A) §23.5 — `capabilities=[…]` over the closed vocabulary", () => {
  test("an unknown token → E-FOREIGN-CAPABILITY-UNKNOWN naming it", () => {
    const d = run(prog(`capabilities=[teleport]`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-FOREIGN-CAPABILITY-UNKNOWN"]);
    expect(d[0].message).toContain("`teleport`");
  });
  test("a valid leading token does not mask a later unknown one; each unknown is reported", () => {
    expect(codes(prog(`capabilities=[network("a.com"), teleport, fs-teleport("x")]`))).toEqual(["E-FOREIGN-CAPABILITY-UNKNOWN", "E-FOREIGN-CAPABILITY-UNKNOWN"]);
  });
  test("every v1 token, hyphenated ones included, is accepted (advisory in v1.0; it governs only foreign code, which the bootstrap refuses)", () => {
    expect(codes(prog(`capabilities=[network("a.com"), fs-read("/etc"), fs-write, spawn("ls"), env("HOME"), db]`))).toEqual([]);
    expect(codes(prog(`capabilities=[]`))).toEqual([]);
  });
  for (const [label, attr] of [
    ["`db` with arguments", `capabilities=[db("x")]`],
    ["a non-string argument", `capabilities=[network(1)]`],
    ["a quoted value", `capabilities="network"`],
  ]) {
    test(`${label} is outside the §23.5.2 grammar → refused`, () => {
      expect(codes(prog(attr))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    });
  }
});

describe("(A) every other top-level attribute: its code, or a refusal — never silence", () => {
  test("an unknown name → W-ATTR-001 (§52.13.3: `<program>` has a closed attribute set)", () => {
    const d = run(prog(`frobnicate="1"`)).diags;
    expect(d.map((x) => x.code)).toEqual(["W-ATTR-001"]);
    expect(d[0].message).toContain("`frobnicate`");
  });
  test("`story=` on the top-level `<program>` → W-STORY-ON-TOP-LEVEL (§58.8)", () => {
    expect(codes(prog(`story="s"`))).toEqual(["W-STORY-ON-TOP-LEVEL"]);
  });
  test("`name=` on the top-level `<program>` (§4.12.2 MUST NOT, no code named) → refused", () => {
    expect(codes(prog(`name="n"`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  for (const a of ["title", "description", "reset", "db", "tables", "cors", "log", "headers", "csrf", "loginRedirect",
                   "sessionExpiry", "session-secure", "lang", "kind", "mcp", "idempotency-store", "transactions"]) {
    test(`\`${a}=\` is not read by the bootstrap → one E-BOOTSTRAP-UNSUPPORTED naming it`, () => {
      const d = run(prog(`${a}="v"`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain(`<program ${a}=…>`);
    });
  }
  test("twin: a `<program>` with no attributes is clean", () => {
    expect(codes(prog(""))).toEqual([]);
  });
});

describe("(A) §4.12.2 — a `<program>` in a program body is NESTED", () => {
  const nested = (attrs) => `<program>\n    <program name="w" ${attrs}>\n        <p>w</p>\n    </program>\n    <p>home</p>\n</program>\n`;
  test("the nested program itself is refused (was: ignored — its body dropped)", () => {
    const d = run(nested("")).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("nested `<program>`");
  });
  test("`auth=` there is E-PROGRAM-NESTED-AUTH whatever its value, and never also E-AUTH-ATTR-INVALID", () => {
    for (const v of [`auth="Bogus"`, `auth="required"`, `auth`]) {
      const c = codes(nested(v));
      expect(c.filter((x) => x === "E-PROGRAM-NESTED-AUTH").length).toBe(1);
      expect(c).not.toContain("E-AUTH-ATTR-INVALID");
    }
  });
  test("the conformance shape: top-level auth refused, nested auth one E-PROGRAM-NESTED-AUTH", () => {
    const c = codes(`<program auth="required">\n<program name="w" auth="Bogus">\n<p>w</p>\n</program>\n<p>home</p>\n</program>\n`);
    expect(c.sort()).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-PROGRAM-NESTED-AUTH"]);
  });
  test("cookie attributes → E-PROGRAM-NESTED-SESSION each; documentary → W-PROGRAM-TITLE-NESTED; app-level → E-PROGRAM-NESTED-ATTR; unknown → W-ATTR-001", () => {
    const c = codes(nested(`sessionExpiry="1h" session-secure="false" title="t" cors="*" ratelimit="1/min" zap="1"`));
    expect(c).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-PROGRAM-NESTED-SESSION", "E-PROGRAM-NESTED-SESSION", "W-PROGRAM-TITLE-NESTED",
                       "E-PROGRAM-NESTED-ATTR", "E-PROGRAM-NESTED-ATTR", "W-ATTR-001"]);
  });
  test("the §4.12.2 table's attributes add nothing beyond the refusal; `capabilities=` is still vocabulary-checked", () => {
    expect(codes(nested(`lang="go" db="./x.db" build="make" port="9" autostart="false"`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(nested(`capabilities=[teleport]`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-FOREIGN-CAPABILITY-UNKNOWN"]);
  });
  test("a program nested two deep is walked too", () => {
    const c = codes(`<program>\n<program name="a">\n<program name="b" auth="none"></program>\n</program>\n</program>\n`);
    expect(c).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-PROGRAM-NESTED-AUTH"]);
  });
});

describe("(B) §40.8 — a second top-level `<program>` in one file is E-PROGRAM-002", () => {
  test("two programs → exactly one E-PROGRAM-002, at the second (was: no diagnostic, the LAST kept)", () => {
    const src = `<program>\n<p>public</p>\n</program>\n<program auth="required">\n<p>admin</p>\n</program>\n`;
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-PROGRAM-002"]);
    expect(d[0].span.start).toBe(src.indexOf(`<program auth`));
  });
  test("three programs → one E-PROGRAM-002 per later program", () => {
    expect(codes(`<program><p>a</p></program>\n<program><p>b</p></program>\n<program><p>c</p></program>\n`)).toEqual(["E-PROGRAM-002", "E-PROGRAM-002"]);
  });
  test("the FIRST program is the one analyzed; a later program's body is not read as the program", () => {
    const r = run(`<program>\n<p>public</p>\n</program>\n<program>\n<p>\${@undeclared}</p>\n</program>\n`);
    expect(r.diags.map((x) => x.code)).toEqual(["E-PROGRAM-002"]);
    const main = r.core.decls.find((d) => d.sym.id === r.core.program.id);
    expect(JSON.stringify(main.renders)).toContain("public");
  });
});

describe("(B) markup at a file's top level, outside any `<program>`", () => {
  test("`<p>` before or after the program → E-BOOTSTRAP-UNSUPPORTED naming it (was: dropped silently)", () => {
    for (const src of [`<p>stray</p>\n<program><p>x</p></program>\n`, `<program><p>x</p></program>\n<p>stray</p>\n`]) {
      const d = run(src).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain("`<p>` at a file's top level");
    }
  });
  test("a structural element (`<engine>`) before the program is refused, as it is inside one", () => {
    const d = run(`<engine for=P initial=.A></>\n<program><p>x</p></program>\n`).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("`<engine>`");
  });
  test("an `<effect>` at file top → refused", () => {
    expect(codes(`<effect deps=[@n]>\${ f() }</>\n<program>\n let <n:int=0/>\n <p>x</p>\n</program>\n`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("`<channel>` outside `<program>` in a file with a `<program>` → E-CHANNEL-OUTSIDE-PROGRAM (§38.1)", () => {
    expect(codes(`<channel name="c"></>\n<program><p>x</p></program>\n`)).toEqual(["E-CHANNEL-OUTSIDE-PROGRAM"]);
  });
  test("`<outlet>` outside a `<program>` shell → E-OUTLET-OUTSIDE-SHELL (§20.8.1)", () => {
    expect(codes(`<outlet/>\n<program><p>x</p></program>\n`)).toEqual(["E-OUTLET-OUTSIDE-SHELL"]);
  });
  test("`<foreign lang>` in a file with a `<program>` → E-FOREIGN-LANG-IN-PROGRAM (§23.6); the program's `lang=` is refused", () => {
    expect(codes(`<foreign lang="ts" />\n<program lang="ts">\n  <p>hi</p>\n</program>\n`)).toEqual(["E-FOREIGN-LANG-IN-PROGRAM", "E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("in a library file (no `<program>`) a `<channel>` is not E-CHANNEL-OUTSIDE-PROGRAM — it is refused; other markup is refused too", () => {
    const lib = { path: "lib.scrml", src: `export fn one() -> int { return 1 }\n<channel name="c"></>\n<p>stray</p>\n` };
    const app = { path: "app.scrml", src: `\${ import { one } from "./lib.scrml" }\n<program>\n <p>\${one()}</p>\n</program>\n` };
    const d = frontEnd(mods, [lib, app]).diags;
    expect(d.map((x) => `${x.code}@${x.file}`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED@lib.scrml", "E-BOOTSTRAP-UNSUPPORTED@lib.scrml"]);
  });
  test("twin: types, functions and imports at file top beside the program are clean", () => {
    expect(codes(`type T:enum = { A, B }\nfn f() -> int { return 1 }\n<program><p>\${f()}</p></program>\n`)).toEqual([]);
  });
});

// s451 fix round (S239 review MED-1): AProgram keeps only the opener's plain
// attributes, so everything else a `<program>` opener parses is refused at
// parse time rather than dropped (no SPEC code governs it — searched §4.12,
// §40.8, §66.2).
describe("(A) a `<program>` opener carries plain attributes only", () => {
  for (const [label, src] of [
    ["a typed attribute `auth:x=…`", `<program auth:x="required"><p>x</p></program>\n`],
    ["a typed attribute `auth:string=…`", `<program auth:string="required"><p>x</p></program>\n`],
    ["a typed attribute `ratelimit:x=…`", `<program ratelimit:x="100/fortnight"><p>x</p></program>\n`],
    ["a typed attribute `capabilities:x=[…]`", `<program capabilities:x=[teleport]><p>x</p></program>\n`],
    ["a typed attribute `foo:bar=…`", `<program foo:bar="1"><p>x</p></program>\n`],
    ["a validator call", `<program min(3)><p>x</p></program>\n`],
    ["an own value", `<program=5><p>x</p></program>\n`],
    ["an own type", `<program:int><p>x</p></program>\n`],
    ["`export`", `export <program><p>x</p></program>\n`],
  ]) {
    test(`${label} → refused (was: compiled clean, the attribute never checked)`, () => {
      const d = run(src).diags;
      expect(d.some((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("on `<program>` is not in the bootstrap"))).toBe(true);
    });
  }
  test("twin: plain attributes alone add no parse refusal", () => {
    expect(codes(prog(`capabilities=[db]`))).toEqual([]);
  });
});

// s451 fix round (LOW-2): a second top-level program's types and functions are
// not pulled into the namespace, so they cannot mask an unresolved name in the first.
describe("(B) a second top-level program contributes no names", () => {
  test("a function only the SECOND program declares does not resolve in the first", () => {
    const c = codes(`<program>\n<p>\${g()}</p>\n</program>\n<program>\nfn g() -> int { return 1 }\n<p>y</p>\n</program>\n`);
    expect(c).toContain("E-PROGRAM-002");
    expect(c.filter((x) => x !== "E-PROGRAM-002").length).toBeGreaterThan(0);
  });
  test("bite: the same function declared in the FIRST program resolves", () => {
    expect(codes(`<program>\nfn g() -> int { return 1 }\n<p>\${g()}</p>\n</program>\n`)).toEqual([]);
  });
});
