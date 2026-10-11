/* SPDX-License-Identifier: MIT
 *
 * Unit — S462 s462-braceless-if-else-dropped.
 *
 * ⚑ A BRACELESS `if` WITH ITS `else` ON THE SAME LINE LOST THE `else` BRANCH.
 * At exit 0, with zero diagnostics:
 *
 *     if (c) a.push(1) else a.push(2)     emitted     if (c) {
 *                                                       a.push(1);
 *                                                     }
 *
 * The braceless consequent is collected by `collectExpr`, which broke at a statement
 * keyword or at a newline but NOT at a same-line `else` — so it collected
 * `a.push(1) else a.push(2)` as ONE bare expression; acorn parsed `a.push(1)` and the
 * rest (the whole else branch) was dropped. An `else if` chain lost its structure the
 * same way (the second `if` became an unconditional sibling statement and the final
 * `else` vanished), and the dangling-else nesting `if (a) if (b) x else y` lost `y`.
 * The S437 fix (#1106) covered the `;`- and newline-separated spellings only.
 *
 * Every case below EXECUTES the emitted JS and asserts BOTH branches: a filter over the
 * emitted text cannot tell a dropped branch from a present one (the #933 lesson).
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
function build(source, name, mode = "library") {
  TMP = TMP || mkdtempSync(join(tmpdir(), "braceless-if-else-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode,
    write: true, verbose: false, log: () => {},
  });
  const files = {};
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) files[f] = join(outDir, f);
    }
  } catch { /* no artifact */ }
  return { files, errors: (r.errors || []).filter((e) => !String(e.code || "").match(/^[WI]-/) && e.severity !== "warning" && e.severity !== "info") };
}

async function lib(body, name) {
  const { files, errors } = build(`\${\n${body}\n}`, name);
  expect(errors.map((e) => e.code)).toEqual([]);
  const art = files[`${name}.js`];
  expect(art).toBeDefined();
  return import(pathToFileURL(art).href);
}

/** Extract `function <name>(…) { … }` from emitted client JS by brace matching. */
function extractFn(js, re) {
  const m = re.exec(js);
  if (!m) return null;
  let i = js.indexOf("{", m.index), depth = 0;
  for (let j = i; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}" && --depth === 0) return js.slice(m.index, j + 1);
  }
  return null;
}

describe("S462 — a braceless `if` keeps its `else` (library mode, executed)", () => {
  test("same-line `if (c) a.push(x) else a.push(y)`", async () => {
    const m = await lib(`export function f(c) {\n  const a = []\n  if (c) a.push(1) else a.push(2)\n  return a\n}`, "same-line");
    expect(m.f(true)).toEqual([1]);
    expect(m.f(false)).toEqual([2]);
  });

  test("brace-less if and brace-less else on separate lines (control — S437)", async () => {
    const m = await lib(`export function f(c) {\n  const a = []\n  if (c) a.push(1)\n  else a.push(2)\n  return a\n}`, "sep-lines");
    expect(m.f(true)).toEqual([1]);
    expect(m.f(false)).toEqual([2]);
  });

  test("`;`-separated else (control — S437)", async () => {
    const m = await lib(`export function f(c) {\n  const a = []\n  if (c) a.push(1); else a.push(2)\n  return a\n}`, "semi");
    expect(m.f(true)).toEqual([1]);
    expect(m.f(false)).toEqual([2]);
  });

  test("brace-less else-if chain on one line — every arm reachable, only one runs", async () => {
    const m = await lib(`export function f(n) {\n  const a = []\n  if (n == 1) a.push("one") else if (n == 2) a.push("two") else a.push("many")\n  return a\n}`, "chain");
    expect(m.f(1)).toEqual(["one"]);
    expect(m.f(2)).toEqual(["two"]);
    expect(m.f(3)).toEqual(["many"]);
  });

  test("brace-less else-if chain across lines", async () => {
    const m = await lib(`export function f(n) {\n  const a = []\n  if (n == 1) a.push("one")\n  else if (n == 2) a.push("two")\n  else a.push("many")\n  return a\n}`, "chain-lines");
    expect(m.f(1)).toEqual(["one"]);
    expect(m.f(2)).toEqual(["two"]);
    expect(m.f(3)).toEqual(["many"]);
  });

  test("inside a braced loop body", async () => {
    const m = await lib(`export function f(xs) {\n  const a = []\n  for (const x of xs) {\n    if (x > 1) a.push("big") else a.push("small")\n  }\n  return a\n}`, "in-loop");
    expect(m.f([1, 2, 3])).toEqual(["small", "big", "big"]);
  });

  test("as a brace-less `for` body", async () => {
    const m = await lib(`export function f(xs) {\n  const a = []\n  for (const x of xs) if (x > 1) a.push("big") else a.push("small")\n  return a\n}`, "for-body");
    expect(m.f([1, 2, 3])).toEqual(["small", "big", "big"]);
  });

  test("as a brace-less `while` body", async () => {
    const m = await lib(`export function f(n) {\n  const a = []\n  let i = 0\n  while (i < n) if (i++ % 2 == 0) a.push("e") else a.push("o")\n  return a\n}`, "while-body");
    expect(m.f(4)).toEqual(["e", "o", "e", "o"]);
  });

  test("inside a match arm block", async () => {
    const m = await lib(
      `type Shape:enum = { Circle, Square }\nexport function f(s: Shape, c) {\n  const a = []\n  match s {\n    .Circle :> { if (c) a.push("c-yes") else a.push("c-no") }\n    else :> a.push("other")\n  }\n  return a\n}`,
      "match-arm",
    );
    expect(m.f("Circle", true)).toEqual(["c-yes"]);
    expect(m.f("Circle", false)).toEqual(["c-no"]);
    expect(m.f("Square", true)).toEqual(["other"]);
  });

  test("a single-expression match arm `if (c) { … } else { … }` keeps working (control)", async () => {
    const m = await lib(
      `type Shape:enum = { Circle, Square }\nexport function f(s: Shape, c) {\n  const a = []\n  match s {\n    .Circle :> if (c) { a.push(1) } else { a.push(2) }\n    else :> a.push(3)\n  }\n  return a\n}`,
      "match-arm-expr",
    );
    expect(m.f("Circle", true)).toEqual([1]);
    expect(m.f("Circle", false)).toEqual([2]);
    expect(m.f("Square", false)).toEqual([3]);
  });

  test("`if (c) return x else return y`", async () => {
    const m = await lib(`export function f(c) {\n  if (c) return "yes" else return "no"\n}`, "ret");
    expect(m.f(true)).toBe("yes");
    expect(m.f(false)).toBe("no");
  });

  test("`if … return … else if … return … else return …`", async () => {
    const m = await lib(`export function f(n) {\n  if (n == 1) return "one" else if (n == 2) return "two" else return "many"\n}`, "ret-chain");
    expect([m.f(1), m.f(2), m.f(3)]).toEqual(["one", "two", "many"]);
  });

  test("dangling else binds to the NEAREST if: `if (a) if (b) x else y`", async () => {
    const m = await lib(`export function f(a, b) {\n  const r = []\n  if (a) if (b) r.push("ab") else r.push("a-notb")\n  return r\n}`, "dangling");
    expect(m.f(true, true)).toEqual(["ab"]);
    expect(m.f(true, false)).toEqual(["a-notb"]);
    expect(m.f(false, true)).toEqual([]);
    expect(m.f(false, false)).toEqual([]);
  });

  test("three-deep nesting with three elses binds innermost-first", async () => {
    const m = await lib(`export function f(a, b, c) {\n  const r = []\n  if (a) if (b) if (c) r.push("abc") else r.push("ab-") else r.push("a--") else r.push("---")\n  return r\n}`, "deep");
    expect(m.f(1, 1, 1)).toEqual(["abc"]);
    expect(m.f(1, 1, 0)).toEqual(["ab-"]);
    expect(m.f(1, 0, 0)).toEqual(["a--"]);
    expect(m.f(0, 0, 0)).toEqual(["---"]);
  });

  test("`if (c) lift x else lift 0` in a for/lift body — the else lift is NOT unconditional", async () => {
    // Pre-fix the `else` was dropped and `lift 0` became an unconditional sibling,
    // so every iteration pushed BOTH values.
    const m = await lib(`export function f(c, xs) {\n  const v = for (x of xs) { if (c) lift x else lift 0 }\n  return v\n}`, "lift-else");
    expect(m.f(true, [1, 2])).toEqual([1, 2]);
    expect(m.f(false, [1, 2])).toEqual([0, 0]);
  });

  test("assignment arms `if (c) x = 1 else x = 2`", async () => {
    const m = await lib(`export function f(c) {\n  let x = 0\n  if (c) x = 1 else x = 2\n  return x\n}`, "assign");
    expect(m.f(true)).toBe(1);
    expect(m.f(false)).toBe(2);
  });
});

describe("S462 — client code (reactive `@x` arms), executed", () => {
  const src = `<program>
<c> = true
<n> = 0
\${
  function setN(c) { if (c) @n = 1 else @n = 2 }
}
<p>\${@n}</p>
<button onclick=setN(true)>a</button>
<button onclick={ if (@c) @n = 10 else @n = 20 }>b</button>
</program>`;

  test("`if (c) @x = 1 else @x = 2` in a client function runs the right arm", () => {
    const { files, errors } = build(src, "client-reactive", "browser");
    expect(errors.map((e) => e.code)).toEqual([]);
    const js = readFileSync(files["client-reactive.client.js"], "utf8");
    const fnSrc = extractFn(js, /function _scrml_setN_\d+\(c\)/);
    expect(fnSrc).not.toBeNull();
    const store = new Map();
    const run = new Function("_scrml_cs_reactive_get", "_scrml_cs_reactive_set", `${fnSrc}\nreturn ${/function (\w+)/.exec(fnSrc)[1]};`);
    const setN = run((k) => store.get(k), (k, v) => store.set(k, v));
    setN(true);
    expect(store.get("n")).toBe(1);
    setN(false);
    expect(store.get("n")).toBe(2);
  });

  test("an inline handler `{ if (@c) @n = 10 else @n = 20 }` compiles and runs both arms", () => {
    const { files, errors } = build(src, "client-handler", "browser");
    expect(errors.map((e) => e.code)).toEqual([]);
    const js = readFileSync(files["client-handler.client.js"], "utf8");
    const h = /"_scrml_attr_onclick_\d+": (function\(_scrml_event\) \{ if \(_scrml_cs_reactive_get\("c"\)\)[\s\S]*?\} \}),\n/.exec(js);
    expect(h).not.toBeNull();
    const store = new Map();
    const mk = new Function("_scrml_cs_reactive_get", "_scrml_cs_reactive_set", `return (${h[1]});`);
    const handler = mk((k) => store.get(k), (k, v) => store.set(k, v));
    store.set("c", true); handler({});
    expect(store.get("n")).toBe(10);
    store.set("c", false); handler({});
    expect(store.get("n")).toBe(20);
  });
});

describe("S462 review — a client template literal that reads a cell is lowered", () => {
  // The if/else handler reroute (S462) exposed this: the handler statement path
  // and every client FUNCTION BODY emitted `` `x ${@n}` `` with the bare `@n`
  // (invalid JS, E-CODEGEN-INVALID-LOGIC). Pre-existing in function bodies.
  test("in a function body and in a braced if/else handler, both branches", () => {
    const { files, errors } = build(
      `<program>\n<c> = true\n<n> = 7\n<s> = "q"\n\${\n  function f() {\n    @s = \`x \${@n}-\${"a@b"}\`\n  }\n}\n<button onclick=f()>f</button>\n<button onclick={ if (@c) { @s = \`h \${@n}\` } else { @s = 'y' } }>h</button>\n<p>\${@s}</p>\n</program>`,
      "template-cell",
      "browser",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    const js = readFileSync(files["template-cell.client.js"], "utf8");
    const store = new Map([["n", 7]]);
    const get = (k) => store.get(k), set = (k, v) => store.set(k, v);
    const fnSrc = extractFn(js, /function _scrml_f_\d+\(\)/);
    const f = new Function("_scrml_cs_reactive_get", "_scrml_cs_reactive_set", `${fnSrc}\nreturn ${/function (\w+)/.exec(fnSrc)[1]};`)(get, set);
    f();
    expect(store.get("s")).toBe("x 7-a@b");
    const h = /"_scrml_attr_onclick_\d+": (function\(_scrml_event\) \{ if \(_scrml_cs_reactive_get\("c"\)\)[\s\S]*?\} \}),\n/.exec(js);
    expect(h).not.toBeNull();
    const handler = new Function("_scrml_cs_reactive_get", "_scrml_cs_reactive_set", `return (${h[1]});`)(get, set);
    store.set("c", true); handler({});
    expect(store.get("s")).toBe("h 7");
    store.set("c", false); handler({});
    expect(store.get("s")).toBe("y");
  });
});

describe("S462 — a markup value-form `${ if (@c) \"yes\" else \"no\" }`", () => {
  test("renders the else value when the condition is false (pre-fix: empty)", () => {
    const { files, errors } = build(
      `<program>\n<c> = true\n<p>\${ if (@c) "yes" else "no" }</p>\n</program>`,
      "value-form",
      "browser",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    const js = readFileSync(files["value-form.client.js"], "utf8");
    const m = /const _scrml_cf__scrml_logic_\d+ = (function\(\) \{ return [^\n]*\}); \};|const _scrml_cf__scrml_logic_\d+ = (function\(\) \{ return [^\n]*?; \});/.exec(js);
    expect(m).not.toBeNull();
    const fnText = m[1] ?? m[2];
    const store = new Map();
    const fn = new Function("_scrml_cs_reactive_get", `return (${fnText});`)((k) => store.get(k));
    store.set("c", true);
    expect(fn()).toBe("yes");
    store.set("c", false);
    expect(fn()).toBe("no");
  });
});

describe("S462 — server function, executed through its route handler", () => {
  test("`server function` with `if (c) a.push(x) else a.push(y)` returns the right arm", async () => {
    const src = `<program>
\${
  server function srv(c) {
    const a = []
    if (c) a.push("yes") else a.push("no")
    return a
  }
}
<button onclick=srv(true)>s</button>
</program>`;
    const { files, errors } = build(src, "server-fn", "browser");
    expect(errors.map((e) => e.code)).toEqual([]);
    const art = files["server-fn.server.js"];
    expect(art).toBeDefined();
    const mod = await import(pathToFileURL(art).href);
    const route = mod.routes[0];
    const call = async (c) => {
      const res = await route.handler(new Request("http://localhost" + route.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
        body: JSON.stringify({ c }),
      }));
      return res.json();
    };
    expect(await call(true)).toEqual(["yes"]);
    expect(await call(false)).toEqual(["no"]);
  });
});

describe("S462 — an `else` nothing can claim is a compile error, never a silent drop", () => {
  const cases = [
    ["after a call", "foo() else bar()"],
    ["after a declaration", "const y = 1 else 2"],
    ["after a return", "return 1 else 2"],
    ["after a ternary", "let z = c ? 1 : 2 else 3"],
    ["on its own line after a call", "foo()\n    else bar()"],
    ["a second else after a complete if/else", "if (c) foo() else bar() else foo()"],
  ];
  for (const [label, body] of cases) {
    test(label, () => {
      const { errors, files } = build(
        `\${\n  function foo() { return 1 }\n  function bar() { return 2 }\n  export function t(c) {\n    ${body}\n  }\n}`,
        "dangling-" + label.replace(/\W+/g, "-"),
      );
      expect(errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");
      expect(Object.keys(files)).toEqual([]);
    });
  }

  test("a match wildcard arm `else :>` is NOT a dangling else (control)", async () => {
    const m = await lib(
      `type Shape:enum = { Circle, Square }\nexport function f(s: Shape) {\n  const a = []\n  match s { .Circle :> a.push("c") else :> a.push("o") }\n  return a\n}`,
      "match-else-arm",
    );
    expect(m.f("Circle")).toEqual(["c"]);
    expect(m.f("Square")).toEqual(["o"]);
  });

  test("a value-position `for … else` names the for, not a missing `if`", () => {
    const { errors } = build(
      `\${\n  export function f(xs) {\n    const v = for (x of xs) { lift x } else { lift 0 }\n    return v\n  }\n}`,
      "for-value-else",
    );
    const e = errors.find((x) => x.code === "E-STMT-UNEXPECTED-TOKEN");
    expect(e).toBeDefined();
    expect(e.message).toContain("follows a `for` used as a value");
    expect(e.message).not.toContain("has no `if`");
  });

  // NARROW CLAIM: this only pins that the parser does not REJECT a statement-level
  // §17.4a `for/lift … else` as a dangling else. It does NOT claim the else body
  // renders — it does not (silently dropped, on base too):
  // g-for-lift-else-empty-state-body-dropped-s462.
  test("a `for/lift … else` empty-state block is not rejected as a dangling else (parse only)", () => {
    const { errors } = build(
      `<program>\n<items> = []\n<ul>\${ for (x of @items) { lift <li>\${x}</li> } else { lift <li>none</li> } }</ul>\n</program>`,
      "for-else",
      "browser",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
  });
});
