/**
 * #1333 — `is some` / `is not` inside a nested function-expression body
 * emitted `__scrml_is_some__(v)`, a placeholder defined nowhere, into the
 * artifact (gap g-is-some-in-a-function-expression-body-emits-an-undefined-helper).
 *
 * Mechanism: `expression-parser.ts preprocessForAcorn` rewrites `x is some` to
 * the placeholder call `__scrml_is_some__(x)` so acorn can parse it, and
 * `esTreeToExprNode` turns the call back into a `binary` node — but only where
 * it builds a tree. A block-bodied `function (…) { … }` / `(…) => { … }`, an
 * object-literal method, … becomes an escape-hatch whose `raw` is sliced out of
 * the PREPROCESSED text, so the placeholder rode it into the string rewriter,
 * which had no rule for it. ReferenceError at run time, no diagnostic — and
 * behind the adopter's `.catch(function () {})` the code silently never ran.
 *
 * Governing text, SPEC §42:
 *   §42.2.2a "`expr is some` SHALL evaluate to `true` when `expr` is not `not`,
 *            and `false` when `expr` is `not`." Codegen: "`x is some` →
 *            `x !== null && x !== undefined`".
 *   §42.8    "The `is not` operator SHALL compile to `(x === null || x === undefined)`"
 *            and "The `is not not` double-negation pattern … SHALL compile to
 *            `(x !== null && x !== undefined)`".
 *   §42.2.4  "The compiler SHALL evaluate `expr` exactly once."
 *
 * Sections:
 *   A  lowerIsPlaceholders — the string-path lowering (unit)
 *   C  every position: no placeholder in the artifact, the §42 lowering present
 *   D  run it: the issue's reproducer and its siblings answer correctly in happy-dom
 *   F  the paren-operand sibling defect (`(f(n)) is not` lost its `undefined` half)
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { lowerIsPlaceholders } from "../../src/codegen/is-predicate-lowering.ts";

if (!globalThis.document) GlobalRegistrator.register();

// Any compiler-internal placeholder identifier (same shape the gate refuses).
const PLACEHOLDER = /\b__scrml_[A-Za-z0-9_]*[A-Za-z0-9]__\b/;

const PRESENT = (x) => `((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(${x})`;
const ABSENT = (x) => `((__scrml_is_v) => __scrml_is_v === null || __scrml_is_v === undefined)(${x})`;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function compileSource(source, label) {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-1333-${uniq}`);
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
      serverJs: read("app.server.js"),
      html: read("app.html"),
      wroteAnything: existsSync(outDir) && readdirSync(outDir).some((f) => f.endsWith(".js")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A page with a `go` button wired to `probe()` and the `@msg` display. */
const page = (logic) => `<program>
  <page>
    \${
      <msg> = ""
${logic}
    }
    <button onclick=probe()>go</button>
    <p id="out">\${@msg}</p>
  </page>
</program>
`;

/** Boot a compiled page in a fresh happy-dom window and return a reader. */
async function boot(source, label) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const out = compileSource(source, label);
  if (out.errors.length > 0) {
    throw new Error(`compile errors: ${out.errors.map((e) => e.code + ": " + e.message).join(" | ")}`);
  }
  const pageErrors = [];
  window.addEventListener("error", (e) => pageErrors.push(String(e.message ?? e.error)));
  window.addEventListener("unhandledrejection", (e) => pageErrors.push(String(e.reason)));
  const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${out.clientJs}\n})();`);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    ...out,
    pageErrors,
    settle,
    click: async () => { document.querySelector("button").click(); await settle(); },
    text: () => document.querySelector("#out").textContent,
  };
}

// ---------------------------------------------------------------------------
// A — lowerIsPlaceholders
// ---------------------------------------------------------------------------

describe("A — lowerIsPlaceholders (string-path lowering of the parser's placeholders)", () => {
  test("A1 each placeholder lowers to its §42 form; a bare name needs no IIFE", () => {
    expect(lowerIsPlaceholders("if (__scrml_is_some__(v)) {}")).toBe("if ((v !== null && v !== undefined)) {}");
    expect(lowerIsPlaceholders("__scrml_is_not__(v)")).toBe("(v === null || v === undefined)");
    expect(lowerIsPlaceholders("__scrml_is_not_not__(@x)")).toBe("(@x !== null && @x !== undefined)");
  });

  test("A2 a compound operand is bound once (§42.2.4)", () => {
    expect(lowerIsPlaceholders("return __scrml_is_some__(f(n))")).toBe("return " + PRESENT("f(n)"));
    expect(lowerIsPlaceholders("__scrml_is_not__(o . a)")).toBe(ABSENT("o . a"));
    const out = lowerIsPlaceholders("__scrml_is_not__(sideEffect())");
    expect(out.indexOf("sideEffect()")).toBe(out.lastIndexOf("sideEffect()"));
  });

  test("A3 the variant placeholder lowers to the tag-normalized test the structured path emits", () => {
    const out = lowerIsPlaceholders('__scrml_is_variant__(v, ".On")');
    expect(out).toBe('(function(__v){return (typeof __v === "object" && __v !== null && typeof __v.variant === "string" ? __v.variant : __v) === "On";})(v)');
    expect(lowerIsPlaceholders('__scrml_is_variant__(v, "Mode.On")')).toBe(out);
    const run = (val) => new Function("v", `return ${out};`)(val);
    expect(run("On")).toBe(true);
    expect(run({ variant: "On", data: 1 })).toBe(true);
    expect(run("Off")).toBe(false);
  });

  test("A4 nested placeholders lower inside-out", () => {
    const out = lowerIsPlaceholders("__scrml_is_some__(g(__scrml_is_not__(v)))");
    expect(out).toBe(PRESENT("g((v === null || v === undefined))"));
    expect(out).not.toMatch(PLACEHOLDER);
  });

  test("A5 string, comment and regex interiors are left alone; template interpolations are lowered", () => {
    expect(lowerIsPlaceholders('"__scrml_is_some__(v)"')).toBe('"__scrml_is_some__(v)"');
    expect(lowerIsPlaceholders("// __scrml_is_some__(v)\nx")).toBe("// __scrml_is_some__(v)\nx");
    expect(lowerIsPlaceholders("/__scrml_is_some__(v)/.test(s)")).toBe("/__scrml_is_some__(v)/.test(s)");
    expect(lowerIsPlaceholders("`a ${__scrml_is_some__(v)} __scrml_is_not__(w)`"))
      .toBe("`a ${(v !== null && v !== undefined)} __scrml_is_not__(w)`");
    expect(lowerIsPlaceholders('f(")", __scrml_is_some__(v))')).toBe('f(")", (v !== null && v !== undefined))');
  });

  test("A6 identity when there is no placeholder; a member name or a malformed call is left in place", () => {
    const plain = "function (v) { return v + 1 }";
    expect(lowerIsPlaceholders(plain)).toBe(plain);
    expect(lowerIsPlaceholders("o.__scrml_is_some__(v)")).toBe("o.__scrml_is_some__(v)");
    expect(lowerIsPlaceholders("__scrml_is_some__(a, b)")).toBe("__scrml_is_some__(a, b)");
    expect(lowerIsPlaceholders("__scrml_is_some__")).toBe("__scrml_is_some__");
  });
});

// ---------------------------------------------------------------------------
// C — every position
// ---------------------------------------------------------------------------

const POSITIONS = {
  "function expression passed as an argument (the issue)": [page(`      function probe() {
        Promise.resolve(5).then(function (v) {
          if (v is some) { @msg = "some" }
        })
      }`), "v !== null && v !== undefined"],
  "`is not` in a function expression": [page(`      function probe() {
        Promise.resolve(5).then(function (v) { if (v is not) { @msg = "not" } else { @msg = "some" } })
      }`), "v === null || v === undefined"],
  "`is not not` in a function expression": [page(`      function probe() {
        Promise.resolve(5).then(function (v) { if (v is not not) { @msg = "some" } })
      }`), "v !== null && v !== undefined"],
  "`is given` in a function expression": [page(`      function probe() {
        Promise.resolve(5).then(function (v) { if (v is given) { @msg = "some" } })
      }`), "v !== null && v !== undefined"],
  "call-tail operand in a function expression": [page(`      function f(n) { return n }
      function probe() {
        if ([1, 2].some(function (n) { return f(n) is some })) { @msg = "some" }
      }`), "__scrml_is_v !== null && __scrml_is_v !== undefined"],
  "member operand in a function expression": [page(`      function probe() {
        if ([{ a: 1 }].filter(function (o) { return o.a is some }).length == 1) { @msg = "some" }
      }`), "__scrml_is_v !== null && __scrml_is_v !== undefined"],
  "arrow with a block body": [page(`      function probe() {
        Promise.resolve(5).then((v) => { if (v is some) { @msg = "some" } })
      }`), "v !== null && v !== undefined"],
  "arrow with an expression body": [page(`      function probe() {
        if ([5].filter((v) => v is some).length == 1) { @msg = "some" }
      }`), "v !== null && v !== undefined"],
  "object-literal method (function value)": [page(`      function probe() {
        const o = { check: function (v) { return v is some } }
        if (o.check(5)) { @msg = "some" }
      }`), "v !== null && v !== undefined"],
  "nested function declaration": [page(`      function probe() {
        function inner(v) { return v is some }
        if (inner(5)) { @msg = "some" }
      }`), "v !== null && v !== undefined"],
  "function expression inside a function expression": [page(`      function probe() {
        Promise.resolve(5).then(function (v) {
          [v].forEach(function (w) { if (w is some) { @msg = "some" } })
        })
      }`), "w !== null && w !== undefined"],
  "function expression in an `fn` body": [page(`      fn chk(xs) {
        return xs.filter(function (v) { return v is some }).length
      }
      function probe() { if (chk([1, 2]) == 2) { @msg = "some" } }`), "v !== null && v !== undefined"],
  "variant test in a function expression": [page(`      type Mode:enum = { On, Off }
      function probe() {
        Promise.resolve(Mode.On).then(function (v) { if (v is .On) { @msg = "some" } })
      }`), '__v.variant : __v) === "On"'],
  "template interpolation in a function expression": [page("      function probe() {\n        Promise.resolve(5).then(function (v) { @msg = `${v is some}` == \"true\" ? \"some\" : \"x\" })\n      }"), "v !== null && v !== undefined"],
  "`when … changes` body": [`<program>
  <page>
    \${
      <msg> = ""
      <n> = 0
      when @n changes {
        [@n].forEach(function (v) { if (v is some) { @msg = "some" } })
      }
      function probe() { @n = @n + 1 }
    }
    <button onclick=probe()>go</button>
    <p id="out">\${@msg}</p>
  </page>
</program>
`, "v !== null && v !== undefined"],
  "engine effect= body": [`<program>
  <page>
    \${
      type Phase:enum = { Idle, Done }
      <msg> = ""
      function probe() { }
    }
    <engine for=Phase initial=.Idle effect=\${ [5].forEach(function (v) { if (v is some) { @msg = "some" } }) }>
      <Idle rule=.Done>
        <p>idle</p>
      </>
      <Done>
        <p>done</p>
      </>
    </>
    <button onclick=probe()>go</button>
    <p id="out">\${@msg}</p>
  </page>
</program>
`, "v !== null && v !== undefined"],
  "`<each>` row": [`<program>
  <page>
    \${
      <items> = [{ id: 1, v: 5 }]
    }
    <each in=@items key=@.id as it>
      <span>\${[it.v].filter(function (v) { return v is some }).length}</span>
    </each>
  </page>
</program>
`, "v !== null && v !== undefined"],
  "event-handler attribute": [`<program>
  <page>
    <msg> = ""
    <button onclick=\${ Promise.resolve(5).then(function (v) { if (v is some) { @msg = "some" } }) }>go</button>
    <p id="out">\${@msg}</p>
  </page>
</program>
`, "v !== null && v !== undefined"],
};

describe("C — every position: no placeholder reaches the artifact; the §42 lowering is there", () => {
  for (const [name, [source, lowering]] of Object.entries(POSITIONS)) {
    test(name, () => {
      const out = compileSource(source, "pos");
      expect(out.errors.map((e) => e.code)).toEqual([]);
      expect(out.clientJs).not.toMatch(PLACEHOLDER);
      expect(out.clientJs).toContain(lowering);
    });
  }

  test("server artifact: a function expression in a `server function` body", () => {
    const out = compileSource(`<program>
  <page>
    \${
      <msg> = ""
      server function check(xs) {
        return xs.filter(function (v) { return v is some }).length
      }
      function probe() {
        check([1, 2]).then(function (n) { if (n == 2) { @msg = "some" } })
      }
    }
    <button onclick=probe()>go</button>
    <p id="out">\${@msg}</p>
  </page>
</program>
`, "server");
    expect(out.errors.map((e) => e.code)).toEqual([]);
    expect(out.serverJs).toContain("filter(function ( v ) { return (v !== null && v !== undefined) })");
    expect(out.serverJs).not.toMatch(PLACEHOLDER);
    expect(out.clientJs).not.toMatch(PLACEHOLDER);
  });
});

// ---------------------------------------------------------------------------
// D — run it
// ---------------------------------------------------------------------------

describe("D — run it: the code that used to throw ReferenceError now answers", () => {
  test("D1 the issue's reproducer, verbatim shape: @msg becomes \"some\"", async () => {
    const p = await boot(page(`      function probe() {
        Promise.resolve(5).then(function (v) {
          if (v is some) { @msg = "some" }
        })
      }`), "d1");
    expect(p.text()).toBe("");
    await p.click();
    expect(p.text()).toBe("some");
    expect(p.pageErrors).toEqual([]);
  });

  test("D2 behind the adopter's `.catch(function () {})` — the case that hid the bug", async () => {
    const p = await boot(page(`      function probe() {
        Promise.resolve(5).then(function (v) {
          if (v is some) { @msg = "some" }
        }).catch(function () { @msg = "swallowed" })
      }`), "d2");
    await p.click();
    expect(p.text()).toBe("some");
  });

  test("D3 `is not` answers TRUE for undefined as well as null (§42.8)", async () => {
    const p = await boot(page(`      function probe() {
        const xs = [1]
        Promise.resolve(xs[5]).then(function (v) { if (v is not) { @msg = "some" } else { @msg = "wrong" } })
      }`), "d3");
    await p.click();
    expect(p.text()).toBe("some");
  });

  const RUNS = [
    "`is not not` in a function expression",
    "call-tail operand in a function expression",
    "member operand in a function expression",
    "arrow with a block body",
    "object-literal method (function value)",
    "function expression inside a function expression",
    "function expression in an `fn` body",
    "variant test in a function expression",
    "template interpolation in a function expression",
    "`when … changes` body",
    "event-handler attribute",
  ];
  for (const name of RUNS) {
    test(`D4 ${name}`, async () => {
      const p = await boot(POSITIONS[name][0], "d4");
      await p.click();
      expect(p.text()).toBe("some");
      expect(p.pageErrors).toEqual([]);
    });
  }

  test("D5 engine effect= body runs on mount", async () => {
    const p = await boot(POSITIONS["engine effect= body"][0], "d5");
    await p.settle();
    expect(p.text()).toBe("some");
    expect(p.pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F — the parenthesised-operand sibling
// ---------------------------------------------------------------------------

describe("F — `(expr) is not` keeps both halves (§42.8)", () => {
  test("F1 `return (f(n)) is not` in a function expression parses (keyword is not a callee) and lowers once", () => {
    const out = compileSource(page(`      function f(n) { return n }
      function probe() {
        const none = [1, 2].some(function (n) { return (f(n)) is not })
        if (none) { @msg = "wrong" } else { @msg = "some" }
      }`), "f1");
    expect(out.errors.map((e) => e.code)).toEqual([]);
    expect(out.clientJs).toContain("__scrml_is_v === null || __scrml_is_v === undefined");
    expect(out.clientJs).not.toMatch(/\) === null\)/);
  });

  test("F2 runtime: an undefined operand is absent", async () => {
    const p = await boot(page(`      function probe() {
        const xs = [1]
        if ([0].some(function (i) { return (xs[i + 3]) is not })) { @msg = "some" } else { @msg = "wrong" }
      }`), "f2");
    await p.click();
    expect(p.text()).toBe("some");
  });
});

// ---------------------------------------------------------------------------
// G — S239 review round (R1-R4): no regression against the pre-#1333 base
// ---------------------------------------------------------------------------

describe("G — review round: the operand scan does not change legal programs", () => {
  // R1 — `of` is a legal identifier; a user function named `of` is a callee.
  test("G1 R1 a user function `of` stays the operand's callee", async () => {
    const fn = `      function of(x) { return x }\n`;
    let p = await boot(page(fn + `      function probe() { const r = of(not) is some\n        @msg = r ? "a" : "b" }`), "g1a");
    expect(p.clientJs).toContain("(_scrml_of_3(null))");
    await p.click();
    expect(p.text()).toBe("b");
    p = await boot(page(fn + `      function probe() { @msg = of(not) is not ? "a" : "b" }`), "g1b");
    await p.click();
    expect(p.text()).toBe("a");
    p = await boot(page(fn + `      function probe() { if (of(5) is some) { @msg = "a" } }`), "g1c");
    expect(p.clientJs).toContain("(_scrml_of_3(5))");
    await p.click();
    expect(p.text()).toBe("a");
  });

  // R2 — `new X(args)` is one operand. Before #1333 the operand stopped at
  // `X(args)` and the placeholder landed between `new` and its callee
  // (`new __scrml_is_some__(Object(v))`, a ReferenceError at run time).
  test("G2 R2 `new Object(v) is some` tests the constructed value", async () => {
    for (const body of [
      `      function probe() { const v = 1\n        if (new Object(v) is some) { @msg = "a" } }`,
      `      function probe() { const v = 1\n        if ((new Object(v)) is some) { @msg = "a" } }`,
      `      function probe() {\n        Promise.resolve(2).then(function (i) { if (new Object(i) is some) { @msg = "a" } })\n      }`,
    ]) {
      const p = await boot(page(body), "g2");
      expect(p.clientJs).toContain("(new Object(");
      expect(p.clientJs).not.toMatch(/new \(/);
      await p.click();
      expect(p.text()).toBe("a");
      expect(p.pageErrors).toEqual([]);
    }
  });

  // R3 — precedence of `is` against `typeof`/`void`/`delete` is unruled; the
  // pre-#1333 reading (operator INSIDE the operand) is kept byte-for-byte.
  test("G3 R3 unary-operator operands keep the pre-#1333 reading", () => {
    const cases = [
      [`      function probe() { const v = 1\n        @msg = typeof (v) is some }`, PRESENT("typeof v")],
      [`      function f(x) { return x }\n      function probe() { const v = 1\n        @msg = typeof (f(v)) is not }`, ABSENT("typeof _scrml_f_3(v)")],
      [`      function probe() { const v = 1\n        @msg = void (v) is not }`, ABSENT("void v")],
      [`      function probe() { const o = { k: 1 }\n        @msg = delete (o.k) is some }`, PRESENT("delete o.k")],
    ];
    for (const [body, lowering] of cases) {
      const out = compileSource(page(body), "g3");
      expect(out.errors.map((e) => e.code)).toEqual([]);
      expect(out.clientJs).toContain(lowering);
    }
  });

  // N1 — emitted artifacts are ES modules, where `yield` is reserved: inside a
  // generator `yield (v) is some` yields the TEST, not `v`.
  test("G6 N1 `yield (v) is some` in a generator inside a callback yields the boolean", async () => {
    const p = await boot(page(`      function probe() {
        Promise.resolve(5).then(function (v) {
          function* gg() { yield (v) is some }
          @msg = "" + gg().next().value
        })
      }`), "g6");
    expect(p.clientJs).not.toMatch(/\(yield /);
    await p.click();
    expect(p.text()).toBe("true");
    expect(p.pageErrors).toEqual([]);
  });

  // Author-written `__scrml_<name>__` identifiers (§47.1.1 reserves `_scrml_`
  // only) in markup positions compile and run, as on main.
  const ROUND3 = {
    "onclick lambda parameter": [`<program>\n  <page>\n    <msg> = ""\n    <button onclick=\${(__scrml_ev__) => { @msg = "" + (__scrml_ev__ is some) }}>go</button>\n    <p id="out">\${@msg}</p>\n  </page>\n</program>\n`, "true"],
    "title=\"${…}\"": [page(`      const __scrml_t__ = "tt"\n      function probe() { @msg = document.querySelector("#t").getAttribute("title") }`).replace(`<p id="out">`, `<p id="t" title="\${__scrml_t__}">x</p>\n    <p id="out">`), "tt"],
    "if=(…)": [page(`      const __scrml_t__ = "tt"\n      function probe() { @msg = document.querySelector("#c") ? "shown" : "hidden" }`).replace(`<p id="out">`, `<p id="c" if=(__scrml_t__ == "tt")>x</p>\n    <p id="out">`), "shown"],
    "each … as + body": [page(`      <items> = [{ id: 1, n: "one" }]\n      function probe() { @msg = document.querySelector(".r").textContent }`).replace(`<p id="out">`, `<each in=@items key=@.id as __scrml_it__>\n      <span class="r">\${__scrml_it__.n}</span>\n    </each>\n    <p id="out">`), "one"],
    "each-row attribute": [page(`      <items> = [{ id: 1, n: "one" }]\n      function probe() { @msg = document.querySelector(".r").getAttribute("title") }`).replace(`<p id="out">`, `<each in=@items key=@.id as __scrml_it__>\n      <span class="r" title=\${__scrml_it__.n}>x</span>\n    </each>\n    <p id="out">`), "one"],
  };
  for (const [name, [source, expected]] of Object.entries(ROUND3)) {
    test(`G9 round 3 — author name in ${name} compiles and runs`, async () => {
      const p = await boot(source, "g9");
      await p.click();
      expect(p.text()).toBe(expected);
      expect(p.pageErrors).toEqual([]);
    });
  }

});
