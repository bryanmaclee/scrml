/**
 * s461 — a statement-position reactive array mutation lowered its ARGUMENT LIST
 * as ONE comma-sequence expression (gap g-splice-multi-arg-comma-expression-s459,
 * data loss). `@ls.splice(0, 0, @p)` emitted `.splice((0, 0, p))`: one argument,
 * the value of the last, so the insert never happened.
 *
 * Governing text, SPEC §6.5.1: "The following mutating methods are valid on
 * reactive array variables: … `@arr.splice(start, deleteCount, ...items)` …".
 * Each argument is a separate argument.
 *
 * Root: the ast-builder's `@name.<method>(` recognisers joined the argument
 * tokens' text and parsed the whole list as one expression. They also dropped a
 * STRING token's delimiters, so `"a,b"` became the code `a,b`, and
 * `push({ u: "b", n: @m })` read an undeclared `b` (the sibling gap
 * g-push-object-literal-string-scope-s459, and g-mutating-method-string-args-
 * lose-their-quotes). The list is now split at its top-level commas into one
 * ExprNode per argument (`argExprs`), and codegen lowers each.
 *
 * Sections:
 *   A  AST — one ExprNode per argument, for every argument count and shape
 *   B  emitted shape — no argument list is ever wrapped as one `(a, b)` sequence
 *   C  run it — the mutation's effect in happy-dom, per method
 *   D  positions — function, handler, component body, top-level `${}`
 *   E  reactivity — a coarse `when @cell changes` subscriber fires once per call
 *   F  the string-argument siblings — quotes survive, no E-SCOPE-001
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

if (!globalThis.document) GlobalRegistrator.register();

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function compileSource(source, label) {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s461-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    return {
      errors: (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning" && e.severity !== "info"),
      clientJs: read("app.client.js"),
      html: read("app.html"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Boot a compiled page in a fresh happy-dom window and return a driver. */
async function boot(source, label) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const out = compileSource(source, label);
  if (out.errors.length > 0) {
    throw new Error(`compile errors: ${out.errors.map((e) => e.code + ": " + e.message).join(" | ")}`);
  }
  const pageErrors = [];
  window.addEventListener("error", (e) => pageErrors.push(String(e.message ?? e.error)));
  const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${out.clientJs}\n})();`);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  await settle();
  return {
    ...out,
    pageErrors,
    click: async (sel) => { document.querySelector(sel).click(); await settle(); },
    text: (sel) => document.querySelector(sel).textContent,
  };
}

/** The statement-position mutation nodes of a source, in source order. */
function mutationNodes(source) {
  const ast = buildAST(splitBlocks("/t/app.scrml", source)).ast;
  const found = [];
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.kind === "reactive-array-mutation") found.push(n);
    for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
  };
  walk(ast.nodes);
  return found;
}

const DECLS = `<ls>: number[] = [1, 2]
<p> = 9
<k> = 1
<v> = 0
<obj> = { f: 5 }
<idx> = [7, 8]
<items> = [3, 4]
<words>: string[] = ["x"]
<rows> = []
<m> = 1`;

/** A program with the shared cells, one `go()` function, and `#out` = JSON of `@<cell>`. */
const fnPage = (stmt, cell = "ls") => `<program>
${DECLS}
function f(x) { return x + 1 }
function go() { ${stmt} }
<button id="go" onclick=go()>go</button>
<p id="out">\${JSON.stringify(@${cell})}</p>
</program>
`;

// ---------------------------------------------------------------------------
// A — AST
// ---------------------------------------------------------------------------

describe("A — one ExprNode per argument (argExprs)", () => {
  const cases = [
    { src: "@ls.splice(1)", kinds: ["lit"] },
    { src: "@ls.splice(0, @k)", kinds: ["lit", "ident"] },
    { src: "@ls.splice(0, 0, @p)", kinds: ["lit", "lit", "ident"] },
    { src: "@ls.splice(0, 0, @p, @obj.f, @idx[0], f(@p))", kinds: ["lit", "lit", "ident", "member", "index", "call"] },
    { src: "@ls.splice(0, 0, ...@items)", kinds: ["lit", "lit", "spread"] },
    { src: '@words.splice(0, 0, "a,b", @p)', kinds: ["lit", "lit", "lit", "ident"] },
    { src: "@ls.push(@p, @obj.f, 3)", kinds: ["ident", "member", "lit"] },
    { src: "@ls.fill(@v, 0, 2)", kinds: ["ident", "lit", "lit"] },
    { src: "@ls.sort((a, b) => (a - b) * @k)", kinds: ["lambda"] },
    { src: "@ls.pop()", kinds: [] },
    { src: "@ls.push(1, )", kinds: ["lit"] },
  ];
  for (const { src, kinds } of cases) {
    test(`\`${src}\` → [${kinds.join(", ")}]`, () => {
      const nodes = mutationNodes(fnPage(src));
      expect(nodes).toHaveLength(1);
      const n = nodes[0];
      expect(Array.isArray(n.argExprs)).toBe(true);
      expect(n.argExprs.map((a) => a.kind)).toEqual(kinds);
      // Never the pre-fix single sequence node.
      expect(n.argsExpr).toBeUndefined();
    });
  }

  test("a string argument keeps its value, a comma inside it is not a separator", () => {
    const [n] = mutationNodes(fnPage('@words.splice(0, 0, "a,b", @p)'));
    expect(n.argExprs[2]).toMatchObject({ kind: "lit", value: "a,b" });
    expect(n.args).toBe('0, 0, "a,b", @p');
  });

  test("a spread argument wraps its operand", () => {
    const [n] = mutationNodes(fnPage("@ls.splice(0, 0, ...@items)"));
    expect(n.argExprs[2].kind).toBe("spread");
    expect(n.argExprs[2].argument).toMatchObject({ kind: "ident", name: "@items" });
  });
});

// ---------------------------------------------------------------------------
// B — emitted shape
// ---------------------------------------------------------------------------

describe("B — no argument list is emitted as one comma-sequence expression", () => {
  const stmts = [
    "@ls.splice(0, @k)",
    "@ls.splice(0, 0, @p)",
    "@ls.splice(0, 0, @p, @obj.f, @idx[0], f(@p))",
    "@ls.splice(0, 0, ...@items)",
    "@ls.push(@p, @obj.f, 3)",
    "@ls.unshift(@p, @k)",
    "@ls.fill(@v, 0, 2)",
  ];
  for (const stmt of stmts) {
    test(`\`${stmt}\``, () => {
      const out = compileSource(fnPage(stmt), "b");
      expect(out.errors).toEqual([]);
      const method = stmt.match(/\.(\w+)\(/)[1];
      const call = out.clientJs.match(new RegExp(`\\.${method}\\((.*?)\\); _scrml_\\w*reactive_set`));
      expect(call).not.toBeNull();
      // The list is NOT one parenthesised sequence `((a, b, c))`.
      expect(call[1].startsWith("(")).toBe(false);
    });
  }

  test("the lowered splice is exactly three arguments", () => {
    const out = compileSource(fnPage("@ls.splice(0, 0, @p)"), "b-exact");
    expect(out.clientJs).toMatch(/\.splice\(0, 0, _scrml_\w*reactive_get\("p"\)\); _scrml_\w*reactive_set\("ls"/);
  });
});

// ---------------------------------------------------------------------------
// C — run it
// ---------------------------------------------------------------------------

describe("C — run it: the mutation's effect, per method and argument count", () => {
  const cases = [
    { name: "splice, 1 arg", stmt: "@ls.splice(1)", want: [1] },
    { name: "splice, 2 args (cell-read deleteCount)", stmt: "@ls.splice(0, @k)", want: [2] },
    { name: "splice, 3 args — the gap's reproducer", stmt: "@ls.splice(0, 0, @p)", want: [9, 1, 2] },
    { name: "splice, 6 args — @p, @obj.f, @idx[0], f(@p)", stmt: "@ls.splice(0, 0, @p, @obj.f, @idx[0], f(@p))", want: [9, 5, 7, 10, 1, 2] },
    { name: "splice, spread", stmt: "@ls.splice(1, 0, ...@items)", want: [1, 3, 4, 2] },
    { name: "splice, a string with a comma", stmt: '@words.splice(0, 0, "a,b", @p)', cell: "words", want: ["a,b", 9, "x"] },
    { name: "push, three args", stmt: "@ls.push(@p, @obj.f, 3)", want: [1, 2, 9, 5, 3] },
    { name: "unshift, two cell args", stmt: "@ls.unshift(@p, @k)", want: [9, 1, 1, 2] },
    { name: "fill(@v, 0, 2)", stmt: "@ls.fill(@v, 0, 2)", want: [0, 0] },
    { name: "fill(@p, 1) — start only", stmt: "@ls.fill(@p, 1)", want: [1, 9] },
    { name: "copyWithin(0, @k)", stmt: "@ls.copyWithin(0, @k)", want: [2, 2] },
    { name: "sort with a cell-reading compareFn", stmt: "@ls.sort((a, b) => (b - a) * @k)", want: [2, 1] },
    { name: "push of an object literal with a string and a cell read", stmt: '@rows.push({ u: "b", n: @m })', cell: "rows", want: [{ u: "b", n: 1 }] },
  ];
  for (const { name, stmt, cell = "ls", want } of cases) {
    test(name, async () => {
      const p = await boot(fnPage(stmt, cell), "c");
      await p.click("#go");
      expect(JSON.parse(p.text("#out"))).toEqual(want);
      expect(p.pageErrors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// D — positions
// ---------------------------------------------------------------------------

describe("D — every position lowers the list as separate arguments", () => {
  test("D1 function body", async () => {
    const p = await boot(fnPage("@ls.splice(0, 0, @p)"), "d1");
    await p.click("#go");
    expect(p.text("#out")).toBe("[9,1,2]");
  });

  test("D2 handler, expression form `onclick=${ … }`", async () => {
    const p = await boot(`<program>
<ls>: number[] = [1, 2]
<p> = 9
<button id="go" onclick=\${ @ls.splice(0, 0, @p) }>go</button>
<p id="out">\${JSON.stringify(@ls)}</p>
</program>
`, "d2");
    await p.click("#go");
    expect(p.text("#out")).toBe("[9,1,2]");
  });

  test("D3 handler, block-bodied arrow", async () => {
    const p = await boot(`<program>
<ls>: number[] = [1, 2]
<p> = 9
<button id="go" onclick=\${() => { @ls.splice(0, 0, @p) }}>go</button>
<p id="out">\${JSON.stringify(@ls)}</p>
</program>
`, "d3");
    await p.click("#go");
    expect(p.text("#out")).toBe("[9,1,2]");
  });

  test("D4 component body", async () => {
    const p = await boot(`<program>
<ls>: number[] = [1, 2]
<p> = 9
const C = <div class="c">
    \${ function ins() { @ls.splice(0, 0, @p) } }
    <button id="go" onclick=ins()>go</button>
</>
<C/>
<p id="out">\${JSON.stringify(@ls)}</p>
</program>
`, "d4");
    await p.click("#go");
    expect(p.text("#out")).toBe("[9,1,2]");
  });

  test("D5 top-level logic `${ … }` statement (runs at boot)", async () => {
    const p = await boot(`<program>
\${
    <ls>: number[] = [1, 2]
    <p> = 9
    @ls.splice(0, 0, @p)
}
<p id="out">\${JSON.stringify(@ls)}</p>
</program>
`, "d5");
    expect(p.text("#out")).toBe("[9,1,2]");
  });

  test("D6 markup interpolation `${ … }` in expression position", async () => {
    const p = await boot(`<program>
<ls>: number[] = [1, 2]
<p> = 9
<button id="go" onclick=\${ @ls.push(@p, @p) }>go</button>
<p id="out">\${JSON.stringify(@ls)}</p>
</program>
`, "d6");
    await p.click("#go");
    expect(p.text("#out")).toBe("[1,2,9,9]");
  });
});

// ---------------------------------------------------------------------------
// E — reactivity
// ---------------------------------------------------------------------------

describe("E — the coarse subscriber still fires exactly once per call", () => {
  for (const stmt of ["@ls.splice(0, 0, @p)", "@ls.push(@p, @k)", "@ls.fill(@v, 0, 2)"]) {
    test(`\`${stmt}\``, async () => {
      const p = await boot(`<program>
\${
    <ls>: number[] = [1, 2]
    <p> = 9
    <k> = 1
    <v> = 0
    <n> = 0
    when @ls changes { @n = @n + 1 }
    function go() { ${stmt} }
}
<button id="go" onclick=go()>go</button>
<p id="n">\${@n}</p>
</program>
`, "e");
      const before = Number(p.text("#n"));
      await p.click("#go");
      expect(Number(p.text("#n"))).toBe(before + 1);
      await p.click("#go");
      expect(Number(p.text("#n"))).toBe(before + 2);
    });
  }
});

// ---------------------------------------------------------------------------
// F — string arguments
// ---------------------------------------------------------------------------

describe("F — string arguments keep their quotes (no E-SCOPE-001, no rewrite inside them)", () => {
  const strings = ['"x"', '"use fn here"', '"x + +y"', '"@p"', '"a,b"', '"f(x)"', '"("', '")"', '"is not"', '"a == b"', "'it\\'s'"];
  test("each string is pushed verbatim", async () => {
    const p = await boot(fnPage(`@words.push(${strings.join(", ")})`, "words"), "f1");
    await p.click("#go");
    expect(JSON.parse(p.text("#out"))).toEqual(["x", "x", "use fn here", "x + +y", "@p", "a,b", "f(x)", "(", ")", "is not", "a == b", "it's"]);
  });

  test("the sibling: push({ u: \"b\", n: @m }) compiles clean", () => {
    const out = compileSource(fnPage('@rows.push({ u: "b", n: @m })', "rows"), "f2");
    expect(out.errors).toEqual([]);
  });

  // NEW in s461: base never checked a multi-argument list (it was an opaque
  // escape-hatch), so this compiled clean there and threw ReferenceError at run time.
  test("an undeclared name in a multi-arg list is now E-SCOPE-001 (base compiled it silently)", () => {
    const out = compileSource(fnPage("@ls.splice(0, 0, nope)"), "f3");
    expect(out.errors.map((e) => e.code)).toContain("E-SCOPE-001");
  });
});

// ---------------------------------------------------------------------------
// G — markup-value arguments are atomic (s461 review B1)
// ---------------------------------------------------------------------------

/** A page whose `go()` runs `stmt`; `#n` = `@ls.length`, `#list` = each element's text, `|`-joined. */
const markupPage = (stmt) => `\${
    <ls> = []
    <who> = "Ann"
    <a> = 1
    <b> = 2
    function join2(x, y) { return String(x) + "-" + String(y) }
    function go() { ${stmt} }
}
<button id="go" onclick=go()>go</button>
<p id="n">\${@ls.length}</p>
<p id="list">\${@ls.map((e) => typeof e == "string" ? e : e.textContent).join("|")}</p>
`;

describe("G — a markup value is ONE argument: its text's `,` `(` `)` are content", () => {
  const cases = [
    { name: "m01 `push(<li>x, y</li>)`, a comma in the markup text", stmt: "@ls.push(<li>x, y</li>)", n: 1, text: "x, y", args: 1 },
    { name: "m05 `push(<li>Hello, ${@who}</li>)`, comma text + an interpolation", stmt: "@ls.push(<li>Hello, ${@who}</li>)", n: 1, text: "Hello,Ann", args: 1 },
    { name: "m03 `push(<li class=\"q\">x (y</li>)`, an unbalanced `(` in the text (pinned: base pushed nothing)", stmt: '@ls.push(<li class="q">x (y</li>)', n: 1, text: "x (y", args: 1 },
    { name: "an unbalanced `)` in the text", stmt: "@ls.push(<li>x) y</li>)", n: 1, text: "x) y", args: 1 },
    { name: "nested markup with commas at every level", stmt: "@ls.push(<li><b>a, b</b>, <i>c, d</i></li>)", n: 1, text: "a, b,c, d", args: 1 },
    { name: "an interpolation `${…}` whose own call has a comma", stmt: "@ls.push(<li>v ${join2(@a, @b)}</li>)", n: 1, text: "v1-2", args: 1 },
    { name: "two markup arguments", stmt: "@ls.push(<li>a, 1</li>, <li>b, 2</li>)", n: 2, text: "a, 1|b, 2", args: 2 },
    // (A bare void `<br>` as a value is E-CODEGEN-INVALID-LOGIC on base too — markup-value parser, not this list.)
    { name: "two self-closed elements as two arguments", stmt: "@ls.push(<hr/>, <br/>)", n: 2, text: "|", args: 2 },
    { name: "markup then a cell read, in splice", stmt: "@ls.splice(0, 0, <li>x, y</li>, @who)", n: 2, text: "x, y|Ann", args: 4 },
  ];
  for (const { name, stmt, n, text, args } of cases) {
    test(name, async () => {
      const [node] = mutationNodes(markupPage(stmt));
      expect(node.argExprs).toHaveLength(args);
      const p = await boot(markupPage(stmt), "g");
      await p.click("#go");
      expect(p.text("#n")).toBe(String(n));
      expect(p.text("#list")).toBe(text);
      expect(p.pageErrors).toEqual([]);
    });
  }

  test("`a < b` is still a comparison, not markup", async () => {
    const p = await boot(fnPage("@ls.push(@k < @p, @p > @k)"), "g-lt");
    await p.click("#go");
    expect(JSON.parse(p.text("#out"))).toEqual([1, 2, true, true]);
  });
});
