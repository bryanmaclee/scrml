/**
 * mutation-arg-string-quotes.test.js — string literals in the arguments of a
 * §6.5.1 reactive array mutation (and a C-style `for` header) keep their quotes.
 *
 * THE DEFECT (S429, reproduced on main d6d6e55a). The `@arr.<mutator>(…)`
 * recognizer in ast-builder.js collected the argument tokens by hand and
 * re-joined `t.text`. A STRING token's `.text` is the literal's INNER text (the
 * tokenizer strips the delimiters), so every string in the argument list lost
 * its quotes:
 *
 *   @groups.push({ id: 2, name: "P" })   ->  .push({id: 2, name: P})   E-SCOPE-001 on `P`
 *   @groups.splice(0, 1, { name: "S" })  ->  .splice(0 , 1 , { name : S })
 *                                            compiled clean, ReferenceError on click
 *   @xs.push("S")  with `const S = …`    ->  .push(S)   silently pushed the binding
 *
 * The same bare `t.text` re-join sat in the three C-style `for (…;…;…)` header
 * collectors: `for (let i = 0; i < "abc".length; i++)` compiled clean to
 * `i < abc.length` with no diagnostic.
 *
 * The recognizer's paren counter also compared `t.text === "("` regardless of
 * kind, so the string `"("` opened a paren and ran the argument list past its
 * close.
 *
 * FIX: `reemitTokenSource` (re-quote a plain string via reemitJsStringLiteral,
 * re-wrap a backtick template) + `collectCallArgsText` (PUNCT-only paren depth),
 * used by both statement parsers' mutation recognizers and all three C-style
 * for-header collectors.
 *
 * The runtime behaviour lives in compiler/tests/browser/browser-mutation-arg-string-quotes.test.js.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const tmpRoot = resolve(tmpdir(), "scrml-mutation-arg-string-quotes");

function compile(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  const input = resolve(dir, `${baseName}.scrml`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Compile a program whose logic lives in `body`; return the client JS, asserting a clean compile. */
function cleanClient(body) {
  const { errors, clientJs } = compile(`<program>\n<xs> = ["a"]\n${body}\n<p>\${@xs.length}</p>\n</program>\n`);
  expect(errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
  expect(clientJs).not.toBe("");
  // The emitted client must parse as a classic script.
  expect(() => new Function(clientJs)).not.toThrow();
  return clientJs;
}

/** The `.method(args)` text of the reactive-array-mutation emit for `@xs`. */
function mutationCall(clientJs, method) {
  const re = new RegExp(`reactive_get\\("xs"\\)\\.${method}\\(([\\s\\S]*?)\\); _scrml(?:_cs)?_reactive_set\\("xs"`);
  const m = re.exec(clientJs);
  expect(m).not.toBeNull();
  return m[1];
}

function astNodes(source) {
  const bs = splitBlocks("/test/app.scrml", source);
  const { ast } = buildAST(bs);
  const out = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.kind === "string") out.push(n);
    for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
  })(ast);
  return out;
}

describe("§6.5.1 mutation args — AST `args` keeps string delimiters (both statement parsers)", () => {
  test("function body: reactive-array-mutation args carry the quoted strings", () => {
    const nodes = astNodes(`<program>\n<xs> = []\nfunction f() { @xs.splice(0, 1, { id: 1, name: "S" }, 'q') }\n</program>\n`);
    const ram = nodes.filter((n) => n.kind === "reactive-array-mutation");
    expect(ram.length).toBe(1);
    expect(ram[0].method).toBe("splice");
    expect(ram[0].args).toBe(`0 , 1 , { id : 1 , name : "S" } , "q"`);
  });

  test("top-level ${} logic block: reactive-array-mutation args carry the quoted strings", () => {
    const nodes = astNodes(`<program>\n<xs> = []\n\${ @xs.push("d", 'e') }\n</program>\n`);
    const ram = nodes.filter((n) => n.kind === "reactive-array-mutation");
    expect(ram.length).toBe(1);
    expect(ram[0].args).toBe(`"d" , "e"`);
  });

  test("a string whose text is a paren does not move the paren depth", () => {
    const nodes = astNodes(`<program>\n<xs> = []\nfunction f() { @xs.push("(", ")", "((") }\n</program>\n`);
    const ram = nodes.filter((n) => n.kind === "reactive-array-mutation");
    expect(ram.length).toBe(1);
    expect(ram[0].args).toBe(`"(" , ")" , "(("`);
  });

  test("an UNBALANCED paren string neither truncates nor over-runs the argument list", () => {
    const close = astNodes(`<program>\n<xs> = []\nfunction f() { @xs.push(")", "tail") }\n</program>\n`)
      .filter((n) => n.kind === "reactive-array-mutation");
    expect(close.length).toBe(1);
    expect(close[0].args).toBe(`")" , "tail"`);
    const open = astNodes(`<program>\n<xs> = []\nfunction f() { @xs.push("(")\n@xs.push("next") }\n</program>\n`)
      .filter((n) => n.kind === "reactive-array-mutation");
    expect(open.map((n) => n.args)).toEqual([`"("`, `"next"`]);
  });

  test("an unbalanced paren string compiles and emits intact", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.push(")", "(") }`), "push")).toBe(`")", "("`);
  });
});

describe("§6.5.1 mutation args — emit shape, every mutator", () => {
  test("push: a bare double-quoted string (the `push(\"d\")` → `push(d)` report)", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.push("d") }`), "push")).toBe(`"d"`);
  });

  test("push: object literal with a string value (the reported `name: P` shape)", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.push({ id: 2, name: "P" }) }`), "push"))
      .toBe(`{id: 2, name: "P"}`);
  });

  test("splice: multi-arg with an object-literal string (the reported `name : S` shape)", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.splice(0, 1, { id: 1, name: "S" }) }`), "splice"))
      .toBe(`0, 1, {id: 1, name: "S"}`);
  });

  test("unshift: single-quoted and double-quoted, multi-arg", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.unshift('e', "f") }`), "unshift")).toBe(`"e", "f"`);
  });

  test("fill: string value with numeric bounds", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.fill("z", 0, 1) }`), "fill")).toBe(`"z", 0, 1`);
  });

  test("sort: a string inside the comparator arrow", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.sort((a, b) => a.localeCompare(b, "en")) }`), "sort"))
      .toBe(`(a, b) => a.localeCompare(b, "en")`);
  });

  test("pop / shift / reverse (no args) are unchanged", () => {
    const js = cleanClient(`function f() { @xs.pop()\n@xs.shift()\n@xs.reverse() }`);
    expect(js).toMatch(/reactive_get\("xs"\)\.pop\(\);/);
    expect(js).toMatch(/reactive_get\("xs"\)\.shift\(\);/);
    expect(js).toMatch(/reactive_get\("xs"\)\.reverse\(\);/);
  });
});

describe("§6.5.1 mutation args — string shapes", () => {
  test("strings containing the other quote, escaped quotes, and escapes", () => {
    const args = mutationCall(
      cleanClient(`function f() { @xs.splice(0, 1, "it's", 'say "hi"', "a\\"b", 'c\\'d', "tab\\there") }`),
      "splice",
    );
    expect(args).toBe(`0, 1, "it's", "say \\"hi\\"", "a\\"b", "c'd", "tab\\there"`);
    // The emitted literals evaluate to the source strings.
    expect(new Function(`return [${args}]`)()).toEqual([0, 1, "it's", 'say "hi"', 'a"b', "c'd", "tab\there"]);
  });

  test("empty string", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.push("") }`), "push")).toBe(`""`);
  });

  test("backtick template with ${} interpolation stays a template", () => {
    expect(mutationCall(cleanClient("function f() { @xs.unshift(`t${1 + 1}x`) }"), "unshift")).toBe("`t${1 + 1}x`");
  });

  test("multi-line backtick template", () => {
    expect(mutationCall(cleanClient("function f() { @xs.push(`multi\nline`) }"), "push")).toBe("`multi\nline`");
  });

  test("`${…}` text inside a DOUBLE-quoted string is not an interpolation", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.push("\${notInterp}") }`), "push")).toBe(`"\${notInterp}"`);
  });

  test("strings nested in arrays and objects, and as computed keys", () => {
    const args = mutationCall(
      cleanClient("function f() { @xs.push({ k: \"v\", n: [1, \"two\", { z: 'three' }], [\"ck\"]: 1, [`t${2}`]: 2 }) }"),
      "push",
    );
    expect(args).toBe("{k: \"v\", n: [1, \"two\", {z: \"three\"}], [\"ck\"]: 1, [`t${2}`]: 2}");
  });

  test("regex, number, boolean and `not` args are unchanged", () => {
    expect(mutationCall(cleanClient(`function f() { @xs.push(/ab+c/gi, 42, true, not) }`), "push"))
      .toBe(`/ab+c/gi, 42, true, null`);
  });

  test("a string whose text names an in-scope binding stays a string (no silent capture)", () => {
    const js = cleanClient(`const S = "CAPTURED"\nfunction f() { @xs.push(S, "S") }`);
    expect(mutationCall(js, "push")).toBe(`S, "S"`);
  });
});

describe("§6.5.1 mutation args — contexts", () => {
  test("top-level ${} logic block", () => {
    expect(mutationCall(cleanClient(`\${ @xs.push("blk", '(', ")") }`), "push")).toBe(`"blk", "(", ")"`);
  });

  test("arrow handler (expression path) keeps its strings", () => {
    const js = cleanClient(`<button onclick=\${() => @xs.push("arrow")}>b</button>`);
    expect(js).toContain(`.push("arrow")`);
  });

  test("when-changes body keeps its strings", () => {
    const js = cleanClient(`<n> = 0\n\${\n  when @n changes {\n    @xs.unshift("when")\n  }\n}`);
    expect(js).toContain(`.unshift("when")`);
  });

  test("the same calls on a NON-reactive local are untouched", () => {
    const js = cleanClient(`function f() { let loc = ["l"]; loc.push("x", 'y'); loc.splice(0, 1, { a: "b" }); return loc }`);
    expect(js).toContain(`loc.push("x", "y");`);
    expect(js).toContain(`loc.splice(0, 1, {a: "b"});`);
  });
});

describe("C-style for header — string literals keep their delimiters (all three collectors)", () => {
  test("statement for inside a function body", () => {
    const js = cleanClient(`<n> = 0\nfunction g() {\n  for (let i = 0; i < "abc".length; i++) { @n = @n + 1 }\n}`);
    expect(js).toContain(`i < "abc".length`);
  });

  test("statement for inside a top-level ${} logic block", () => {
    const js = cleanClient(`<n> = 0\n\${\n  for (let i = 0; i < 'ab'.length; i++) { @n = @n + 1 }\n}`);
    expect(js).toContain(`i < "ab".length`);
  });

  test("for-as-expression (`const r = for (…;…;…) { lift … }`)", () => {
    const nodes = astNodes(`<program>\n\${\n  const r = for (let i = 0; i < "abc".length; i++) { lift i }\n}\n</program>\n`);
    const iterables = nodes.filter((n) => typeof n.iterable === "string" && n.iterable.includes("length")).map((n) => n.iterable);
    expect(iterables.length).toBeGreaterThan(0);
    for (const it of iterables) expect(it).toContain(`"abc"`);
  });
});

// ---------------------------------------------------------------------------
// Round 2 — nothing on these paths emits from RAW TEXT any more.
// ---------------------------------------------------------------------------

function ramNodes(body) {
  return astNodes(`<program>\n<xs> = []\n${body}\n</program>\n`).filter((n) => n.kind === "reactive-array-mutation");
}

describe("round 2 — the argument LIST is a parsed node, not an escape-hatch", () => {
  test("multi-arg: argsExpr is an array of the arguments, argsIsList set", () => {
    const [n] = ramNodes(`function f() { @xs.push("use fn here", 1, { k: "v" }) }`);
    expect(n.argsIsList).toBe(true);
    expect(n.argsExpr.kind).toBe("array");
    expect(n.argsExpr.elements.map((e) => e.kind)).toEqual(["lit", "lit", "object"]);
  });

  test("single non-spread argument: unchanged (its own node, no argsIsList)", () => {
    const [n] = ramNodes(`function f() { @xs.push("d") }`);
    expect(n.argsIsList).toBeUndefined();
    expect(n.argsExpr.kind).toBe("lit");
  });

  test("single spread argument: a list of one spread", () => {
    const [n] = ramNodes(`function f() { @xs.push(...["a", "b"]) }`);
    expect(n.argsIsList).toBe(true);
    expect(n.argsExpr.elements.map((e) => e.kind)).toEqual(["spread"]);
  });

  test("an argument that does not parse is isolated; its siblings still get nodes", () => {
    const [n] = ramNodes(`function f() { @xs.push("use fn here", Point { x: 1 }) }`);
    expect(n.argsIsList).toBe(true);
    expect(n.argsExpr.elements[0]).toMatchObject({ kind: "lit", value: "use fn here" });
    expect(n.argsExpr.elements[1].kind).toBe("escape-hatch");
  });

  test("emit: the reported strings are printed verbatim", () => {
    const js = cleanClient("${ @xs.push(\"Point { x: 1 }\", \"use fn here\", 1)\n@xs.push(`navigate(${1})`, \"is not\", 2) }");
    expect(js).toContain(`.push("Point { x: 1 }", "use fn here", 1);`);
    expect(js).toContain(".push(`navigate(${1})`, \"is not\", 2);");
  });

  test("LOUD gain: an undeclared identifier in a multi-arg list is E-SCOPE-001 (was clean + ReferenceError)", () => {
    const { errors } = compile(`<program>\n<xs> = []\nfunction f() { @xs.splice(0, 1, S) }\n<p>\${@xs.length}</p>\n</program>\n`);
    expect(errors.map((e) => e.code)).toContain("E-SCOPE-001");
  });

  test("a block comment in the arguments is dropped (was re-emitted without its `/*`)", () => {
    const [n] = ramNodes(`function f() { @xs.push(1 /* x */, 2) }`);
    expect(n.args).toBe(`1 , 2`);
    expect(mutationCall(cleanClient(`function f() { @xs.push(1 /* x */, 2) }`), "push")).toBe(`1, 2`);
  });
});

describe("round 2 — C-style header parts come from the TOKENS", () => {
  function forNode(body) {
    return astNodes(`<program>\n<n> = 0\n${body}\n</program>\n`).find((n) => n.kind === "for-stmt");
  }

  test("a `;` inside a string does not split the header", () => {
    const n = forNode(`function g() { for (let s = "a;b"; s != "a;b;"; s = s + ";") { @n = 1 } }`);
    expect(n.cStyleParts.condExpr).toMatchObject({ kind: "binary" });
    expect(n.cStyleParts.initExpr.raw).toBe(`let s = "a;b"`);
  });

  test("the `+ +` normaliser no longer rewrites a string (or a unary plus)", () => {
    const n = forNode(`function g() { for (let q = "x + +y"; q.length < +3; q = q + + "!") { @n = 1 } }`);
    expect(n.cStyleParts.initExpr.raw).toBe(`let q = "x + +y"`);
    const js = cleanClient(`<n> = 0\nfunction g() { for (let q = "x + +y"; q.length < 9; q = q + + "!") { @n = 1 } }`);
    expect(js).toContain(`for (let q = "x + +y"; q.length < 9; q = q + +"!") {`);
  });

  test("`i++` still emits as a postfix increment", () => {
    const js = cleanClient(`<n> = 0\nfunction g() { for (let i = 0; i < 3; i++) { @n = @n + 1 } }`);
    expect(js).toContain(`for (let i = 0; i < 3; i++) {`);
  });

  test("an EMPTY part is null in cStyleParts and emits empty", () => {
    const n = forNode(`function g() { for (let s = "fn"; ; ) { break } }`);
    expect(n.cStyleParts.condExpr).toBeNull();
    expect(n.cStyleParts.updateExpr).toBeNull();
    const js = cleanClient(`function g() { for (let s = "fn"; ; ) { break } }`);
    expect(js).toContain(`for (let s = "fn"; ; ) {`);
  });

  test("a `let` init with a string is printed through the ExprNode printer (no `fn` rewrite)", () => {
    const js = cleanClient(`<n> = 0\nfunction g() { for (let t = "fn", u = 'use fn'; t.length < 9; t = t + "!") { @n = 1 } }`);
    expect(js).toContain(`for (let t = "fn", u = "use fn"; t.length < 9; t = t + "!") {`);
  });
});

describe("round 2 — sibling collectors re-quote strings", () => {
  test("computed bracket index: @m[\"a\" + x] = 5 keeps the string", () => {
    const js = cleanClient(`<m> = { }\n\${\n  const x = "k"\n  @m["a" + x] = 5\n}`);
    expect(js).toContain(`_scrml_deep_set(_scrml_cs_reactive_get("m"), ["a" + x], 5)`);
  });

  test("@set(@o, \"a\", 9) lowers to the COW deep-set on the cell NAME", () => {
    const js = cleanClient(`<o> = { a: 1 }\nfunction f() { @set(@o, "a", "use fn") }\nfunction g() { @set(@o, "b.c", 9) }`);
    expect(js).toContain(`_scrml_cs_reactive_set("o", _scrml_deep_set(_scrml_cs_reactive_get("o"), ["a"], "use fn"));`);
    expect(js).toContain(`_scrml_cs_reactive_set("o", _scrml_deep_set(_scrml_cs_reactive_get("o"), ["b","c"], 9));`);
  });

  test("upload(file, url): a string first argument keeps its quotes; a string \"(\" / \",\" is not structure", () => {
    const n = astNodes(`<program>\n\${\n  upload("a,(b", "/up")\n}\n</program>\n`).find((x) => x.kind === "upload-call");
    expect(n.file).toBe(`"a,(b"`);
    expect(n.url).toBe(`"/up"`);
  });
});
