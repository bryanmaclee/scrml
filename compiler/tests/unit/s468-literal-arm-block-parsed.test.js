/**
 * s468-literal-arm-block-parsed.test.js — S468 P0 (gap g-literal-arm-block-body-unparsed-s468).
 *
 * A `match` arm whose head is not a single `.Variant` / `else` / `not` — a §18.16
 * literal arm (`1 :>`, `-1 :>`, `"bob" :>`, `true :>`), an alternation (`1 | 2 :>`,
 * `.A | .B :>`), the `_` wildcard alias with a block body, the `::V` alias with a
 * block body — used to be kept by the AST builder as ONE `bare-expr` holding the
 * whole arm TEXT, whose exprNode was the leading literal alone. No stage after the
 * parser saw the statements in its body, so `1 :> { const g = check … g(pass, hash) }`
 * (a waiting function aliased, §13.9.6) was neither refused nor awaited (§13.2): the
 * server tested a Promise and accepted a wrong password.
 *
 * The fix is in the parser (ast-builder.js Form 4 / Inline Form 6): the body is
 * parsed into statements like every other arm kind, and the head is recorded from
 * its tokens (`literals` / `alternates` / `isWildcard` / `variant`). Every match
 * lowering reads the head through one reader (`matchArmBlockToMatchArm`,
 * `matchArmInlineToMatchArm`).
 *
 * This file pins (A) the AST shape per head form, (B) runtime dispatch of every
 * head form in a library module, executed, (C) the analyses now reading the body
 * (§13.9.6 refusal, §42.2.3 E-SYNTAX-043 after a literal arm, §18.8 coverage of a
 * variant alternation block arm). The wrong-password probes themselves live in
 * the security-await-pack family `la1`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s468-litarm-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

/** The arms of every `match` in `src`, in source order. */
function matchArms(src) {
  const r = buildAST(splitBlocks("t.scrml", src));
  const out = [];
  const seen = new Set();
  const visit = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if ((n.kind === "match-stmt" || n.kind === "match-expr") && Array.isArray(n.body)) out.push(n.body);
    for (const k of Object.keys(n)) visit(n[k]);
  };
  visit(r.ast ?? r);
  return out;
}

const inFn = (matchSrc) => `<program>\n\${\n  type K:enum = { A, B, C }\n  function f(n, s, b, k) {\n${matchSrc}\n    return 0\n  }\n}\n</program>\n`;

describe("(A) AST: every arm head with a `{ … }` body is a match-arm-block with a parsed body", () => {
  const cases = [
    ["number", `1 :> { const g = 1\n        return g }`, { literals: ["1"], isWildcard: false, variant: null }, ["const-decl", "return-stmt"]],
    ["negative number", `-2 :> { return 2 }`, { literals: ["-2"] }, ["return-stmt"]],
    ["hex number", `0x1F -> { return 4 }`, { literals: ["0x1F"], armArrow: "->" }, ["return-stmt"]],
    ["double-quoted string", `"bob" => { return 1 }`, { literals: ['"bob"'], armArrow: "=>" }, ["return-stmt"]],
    ["single-quoted string", `'al' :> { return 2 }`, { literals: ["'al'"] }, ["return-stmt"]],
    ["boolean", `true :> { return 1 }`, { literals: ["true"] }, ["return-stmt"]],
    ["number alternation", `3 | 4 :> { return 3 }`, { literals: ["3", "4"], pattern: "3 | 4" }, ["return-stmt"]],
    ["string alternation", `"a" | "b" :> { return 3 }`, { literals: ['"a"', '"b"'] }, ["return-stmt"]],
    ["variant alternation", `.A | .B :> { return 1 }`, { alternates: ["A", "B"], variant: null }, ["return-stmt"]],
    ["variant alternation with discards", `.A(_) | .B :> { return 1 }`, { alternates: ["A", "B"] }, ["return-stmt"]],
    ["`_` wildcard", `_ :> { return 5 }`, { isWildcard: true }, ["return-stmt"]],
    ["alternation holding `_`", `_ | .A :> { return 5 }`, { isWildcard: true }, ["return-stmt"]],
    ["`::V` alias", `::C :> { return 2 }`, { variant: "C", isWildcard: false }, ["return-stmt"]],
  ];
  for (const [name, arm, fields, bodyKinds] of cases) {
    test(name, () => {
      const [arms] = matchArms(inFn(`    match n {\n      ${arm}\n      else :> { return 9 }\n    }`));
      const a = arms[0];
      expect(a.kind).toBe("match-arm-block");
      for (const [k, v] of Object.entries(fields)) expect(a[k]).toEqual(v);
      expect(a.body.map((s) => s.kind)).toEqual(bodyKinds);
    });
  }

  test("`::V(binding) :> { … }` takes Form 1b (the payload binding is scoped into the body)", () => {
    const [arms] = matchArms(inFn(`    match k {\n      ::A(x) :> { return x }\n      else :> { return 9 }\n    }`));
    expect(arms[0].kind).toBe("match-arm-block");
    expect(arms[0].variant).toBe("A");
    expect(arms[0].payloadBindings).toEqual(["x"]);
  });

  test("a value-position `match` reads the same way", () => {
    const [arms] = matchArms(inFn(`    const v = match n {\n      1 :> { const q = 2\n        q }\n      else :> 0\n    }`));
    expect(arms[0].kind).toBe("match-arm-block");
    expect(arms[0].literals).toEqual(["1"]);
    expect(arms[0].body.map((s) => s.kind)).toEqual(["const-decl", "bare-expr"]);
  });

  test("outside a match body, `_ => { … }` is still an arrow function (no arm form there)", () => {
    const r = buildAST(splitBlocks("t.scrml", `<program>\n\${\n  function f() {\n    const h = _ => { return 1 }\n    return h(0)\n  }\n}\n</program>\n`));
    const json = JSON.stringify(r.ast ?? r);
    expect(json.includes('"match-arm-block"')).toBe(false);
  });

  test("a head mixing literal and variant alternates stays on the text path (unchanged)", () => {
    const [arms] = matchArms(inFn(`    match n {\n      .A | 1 :> { return 1 }\n      else :> { return 9 }\n    }`));
    expect(arms[0].kind).toBe("bare-expr");
  });
});

describe("(A) AST: a single-expression literal / alternation arm is a match-arm-inline with a parsed result", () => {
  const cases = [
    ["number", `1 :> drive(n)`, { test: "1", literals: ["1"] }],
    ["negative number", `-1 :> drive(n)`, { literals: ["-1"] }],
    ["boolean", `false :> drive(n)`, { literals: ["false"] }],
    ["number alternation", `1 | 2 :> drive(n)`, { test: "1 | 2", literals: ["1", "2"] }],
    ["string alternation", `"a" | "b" :> drive(n)`, { literals: ['"a"', '"b"'] }],
    ["variant alternation", `.A | .B :> drive(n)`, { test: ".A | .B", alternates: ["A", "B"] }],
    ["alternation holding `_`", `.A | _ :> drive(n)`, { test: "else" }],
  ];
  for (const [name, arm, fields] of cases) {
    test(name, () => {
      const [arms] = matchArms(inFn(`    const v = match n {\n      ${arm}\n      else :> 0\n    }`));
      const a = arms[0];
      expect(a.kind).toBe("match-arm-inline");
      for (const [k, v] of Object.entries(fields)) expect(a[k]).toEqual(v);
      expect(a.result.replace(/\s+/g, "")).toBe("drive(n)");
      expect(a.resultExpr?.kind).toBe("call");
    });
  }
});

function compileLib(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({ inputFiles: [filePath], outputDir: outDir, mode: "library", write: true, validateEmit: true, log: () => {} });
  const errors = (result.errors || []).filter((e) => e.severity == null || e.severity === "error");
  const libPath = join(outDir, `${name}.js`);
  return { errorCodes: errors.map((e) => e.code), libPath, libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "" };
}
const loadLib = (p) => import(`${pathToFileURL(p).href}?t=${Date.now()}`);

describe("(B) runtime: every head form dispatches correctly (library module, executed)", () => {
  test("statement-position block arms: literal, negative, hex, string, boolean, alternations, `_`", async () => {
    const r = compileLib("stmt", `export fn num(n: int) {
  let r = "none"
  match n {
    1 :> { const t = "one"
      r = t }
    -1 :> { r = "minus one" }
    0x1F :> { r = "thirty-one" }
    2 | 3 :> { r = "two-or-three" }
    _ :> { r = "other" }
  }
  return r
}
export fn str(s: string) {
  let r = "none"
  match s {
    "bob" :> { r = "B" }
    'al' | "cy" :> { r = "AC" }
    else :> { r = "?" }
  }
  return r
}
export fn bool(b: boolean) {
  let r = "none"
  match b {
    true :> { r = "T" }
    false :> { r = "F" }
  }
  return r
}`);
    expect(r.errorCodes).toEqual([]);
    const m = await loadLib(r.libPath);
    expect([m.num(1), m.num(-1), m.num(31), m.num(2), m.num(3), m.num(7)]).toEqual(["one", "minus one", "thirty-one", "two-or-three", "two-or-three", "other"]);
    expect([m.str("bob"), m.str("al"), m.str("cy"), m.str("zed")]).toEqual(["B", "AC", "AC", "?"]);
    expect([m.bool(true), m.bool(false)]).toEqual(["T", "F"]);
  });

  test("value-position block arms lift their tail; object-literal arms are values", async () => {
    const r = compileLib("value", `export fn pick(n: int) {
  const v = match n {
    1 :> { const base = "gr"
      base + "een" }
    2 | 3 :> { "few" }
    else :> "many"
  }
  return v
}
export const OBJ = match 1 { 1 :> { x: 1 } _ :> { y: 2 } }
export fn ret(n: int) { return match n { 1 :> { const q = 10
      q + 1 } _ :> 0 } }`);
    expect(r.errorCodes).toEqual([]);
    const m = await loadLib(r.libPath);
    expect([m.pick(1), m.pick(2), m.pick(3), m.pick(4)]).toEqual(["green", "few", "few", "many"]);
    expect(m.OBJ).toEqual({ x: 1 });
    expect([m.ret(1), m.ret(5)]).toEqual([11, 0]);
  });

  test("variant alternation and `::V` block arms over an enum (previously `::V :> { … }` never matched)", async () => {
    const r = compileLib("variant", `export type K:enum = { A, B, C }
export fn k(x: K) {
  let r = "none"
  match x {
    .A | .B :> { r = "AB" }
    ::C :> { r = "C" }
  }
  return r
}`);
    expect(r.errorCodes).toEqual([]);
    const m = await loadLib(r.libPath);
    // An enum value in a library module is its variant tag (unit variants).
    expect([m.k("A"), m.k("B"), m.k("C")]).toEqual(["AB", "AB", "C"]);
  });

  test("single-expression literal / alternation arms (Inline Form 6)", async () => {
    const r = compileLib("inline", `export fn lab(n: int) {
  const v = match n {
    1 :> "one"
    -1 :> "minus"
    2 | 3 :> "few"
    else :> "many"
  }
  return v
}`);
    expect(r.errorCodes).toEqual([]);
    const m = await loadLib(r.libPath);
    expect([m.lab(1), m.lab(-1), m.lab(2), m.lab(3), m.lab(9)]).toEqual(["one", "minus", "few", "few", "many"]);
  });
});

function compileApp(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(TMP, `${name}.dist`), write: false, log: () => {} });
  return (result.errors || []).filter((e) => e.severity == null || e.severity === "error").map((e) => e.code);
}

describe("(C) the analyses read a literal arm's body", () => {
  test("§13.9.6: a waiting function aliased inside a literal block arm is refused", () => {
    const codes = compileApp("f4", `<program>
\${
  import { verifyPassword } from "scrml:auth"
  function run(p: string, h: string) {
    const n = 1
    match n {
      1 :> { const g = verifyPassword
        return g(p, h) }
      else :> { return false }
    }
    return false
  }
}
<button onclick={ run("a", "b") }>go</button>
</program>
`);
    expect(codes).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  });

  test("§13.2: a waiting function passed from a single-expression literal arm is refused", () => {
    const codes = compileApp("f4inline", `<program>
\${
  import { verifyPassword } from "scrml:auth"
  function drive(cb, p, h) { if (cb(p, h)) { return true }
    return false }
  function run(p: string, h: string) {
    const n = 1
    const ok = match n {
      1 | 2 :> drive(verifyPassword, p, h)
      else :> false
    }
    return ok
  }
}
<button onclick={ run("a", "b") }>go</button>
</program>
`);
    expect(codes).toContain("E-ASYNC-FN-ESCAPES-AS-VALUE");
  });

  test("§4: a forbidden statement inside a client literal arm is refused as at top level (was shipped verbatim)", () => {
    const codes = compileApp("sw", `<program>
\${
  <msg> = ""
  function cl(k: string) {
    let r = "n"
    match (k) {
      "a" :> { switch (k) { case "a": r = "sw" } }
      else :> { r = "n" }
    }
    @msg = r
  }
}
<button onclick={ cl("a") }>go</button>
<p>\${@msg}</p>
</program>
`);
    expect(codes).toContain("E-SWITCH-FORBIDDEN");
  });

  test("a nested match inside a string arm's block lowers on the client (was E-CODEGEN-INVALID-LOGIC)", () => {
    const codes = compileApp("nested", `<program>
\${
  <ok>: boolean = false
  <msg> = ""
  function post(name: string, pass: string) {
    @ok = pass == "x"
    const k: string = name
    match (k) {
      "bob" :> { const b: boolean = @ok
        match (b) { true :> { @msg = "ok" } else :> { @msg = "no" } } }
      else :> { @msg = "x" }
    }
  }
}
<button onclick={ post("bob", "x") }>go</button>
<p>\${@msg}</p>
</program>
`);
    expect(codes).toEqual([]);
  });

  test("a function called only from a top-level single-expression arm is not W-DEAD-FUNCTION (literal, `_`)", () => {
    const filePath = join(TMP, "dead.scrml");
    writeFileSync(filePath, `\${
    let n = 3
    match n {
        0 :> handleZero()
        1 | 2 :> handleOne()
        _ :> handleOther()
    }
    function handleZero()  { let _ = 1 }
    function handleOne()   { let _ = 1 }
    function handleOther() { let _ = 1 }
}
<program>
    <p>ok</>
</>
`);
    const result = compileScrml({ inputFiles: [filePath], outputDir: join(TMP, "dead.dist"), write: false, log: () => {} });
    const all = [...(result.errors ?? []), ...(result.warnings ?? [])];
    expect(all.filter((e) => e.code === "W-DEAD-FUNCTION").map((e) => e.message)).toEqual([]);
  });

  test("§18.8: a variant alternation block arm covers every alternate (no false E-TYPE-020)", () => {
    const ok = compileApp("cover", `<program>
\${
  type K:enum = { A, B, C }
  <msg> = ""
  function g(x: K) {
    match x {
      .A | .B :> { @msg = "ab" }
      .C :> { @msg = "c" }
    }
  }
}
<button onclick={ g(.A) }>go</button>
<p>\${@msg}</p>
</program>
`);
    expect(ok).not.toContain("E-TYPE-020");
    const missing = compileApp("cover-missing", `<program>
\${
  type K:enum = { A, B, C }
  <msg> = ""
  function g(x: K) {
    match x {
      .A | .B :> { @msg = "ab" }
    }
  }
}
<button onclick={ g(.A) }>go</button>
<p>\${@msg}</p>
</program>
`);
    expect(missing).toContain("E-TYPE-020");
  });
});
