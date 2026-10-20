/**
 * e-error-002-template-interp-s469.test.js — SPEC §19.4.3, E-ERROR-002: an unhandled `!` call
 * inside a template-literal interpolation (found by the #1444 review; present on main).
 *
 * §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a
 * compile error: E-ERROR-002". `check(p)` is a `!` function; `login` builds `s` from a template and
 * logs in when `s == "Y"`. An unhandled call hands the interpolation the error object — truthy — so
 * a WRONG password logged in.
 *
 * Root cause (confirmed): `templateInterpolationNodesAll` re-parsed each `${…}` with bare
 * `parseExpression` and converted it with NO source text (`esTreeToExprNode` without `rawSource`).
 * Every escape hatch inside an interpolation — a sequence, a block-bodied arrow / function
 * expression, a tagged template — carried `raw: ""`; the failable walk then called
 * `unreadText("")`, which returned false without refusing anything and without setting
 * `unreadable`. Fail-open.
 *
 * Fixed twice over:
 *   - the source: the interpolations are the parse's OWN nodes (`_tplExprs`, the ones the
 *     structural template emitter writes) or a re-read through `parseExprToNode` — ONE reader;
 *     `rawSource` is threaded at the converter's dropped recursion sites (an arrow's expression
 *     body, a spread, a parameter default);
 *   - the walk: a non-Literal escape hatch with no source text is refused (E-ERROR-002) and marks
 *     the walk `unreadable`; a ParseError hatch marks it `unreadable`.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { forEachCallInValuePosition } from "../../src/failable-value-calls.ts";
import { parseExprToNode, templateInterpolationNodesAll } from "../../src/expression-parser.ts";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compileSource(source, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s469ti-${uniq}`);
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
    const all = result.errors ?? [];
    const errors = all.filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    return { errors, codes: errors.map((e) => e.code), clientJs: read("app.client.js"), html: read("app.html") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The login page: `login` builds `s` (from `decl`) and logs in when `s == "Y"`. */
const LOGIN = (decl) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function tagf(s, v) { return s[0] + v }
    const g = check
    function login(p) {
        ${decl}
        const ok = s == "Y"
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

async function boot(source) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const out = compileSource(source, "login");
  if (out.errors.length > 0) throw new Error(`compile errors: ${out.codes.join(", ")}`);
  const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${out.clientJs}\n})();`);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  await settle();
  return {
    click: async (sel) => { document.querySelector(sel).click(); await settle(); },
    text: (sel) => document.querySelector(sel).textContent,
  };
}

// ---------------------------------------------------------------------------
// The wrong-password shapes: each is refused (E-ERROR-002)
// ---------------------------------------------------------------------------

describe("an unhandled `!` call inside a template-literal interpolation is E-ERROR-002", () => {
  const shapes = [
    ["a sequence", 'const s = `${(check(p), 1) ? "Y" : "N"}`'],
    ["a block-bodied arrow IIFE", 'const s = `${(() => { return check(p) })() ? "Y" : "N"}`'],
    ["a function-expression IIFE through an alias", 'const s = `${(function(){ return g(p) })() ? "Y" : "N"}`'],
    ["a String.raw tagged template around an alias call", "const s = `${String.raw`${g(p) ? 'Y' : 'N'}`}`"],
    ["a tagged template whose tag is an alias", 'const s = `${g`${p}` ? "Y" : "N"}`'],
    ["a tagged template whose tag is the `!` function", 'const s = `${check`${p}` ? "Y" : "N"}`'],
    ["an expression-bodied arrow holding a sequence", 'const s = `${(() => (check(p), 1))() ? "Y" : "N"}`'],
    ["an expression-bodied arrow holding a sequence (no template)", 'const s = (() => (check(p), 1))() ? "Y" : "N"'],
    ["a direct call", 'const s = `${check(p) ? "Y" : "N"}`'],
  ];
  for (const [what, decl] of shapes) {
    test(what, () => {
      const out = compileSource(LOGIN(decl), "wrong");
      expect(out.codes).toContain("E-ERROR-002");
    });
  }

  test("in markup: a template inside an interpolation", () => {
    const src = `type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<p id="out">\${\`\${(() => { return check("wrong") })() ? "LOGGED IN" : "rejected"}\`}</p>
`;
    expect(compileSource(src, "markup").codes).toContain("E-ERROR-002");
  });
});

// ---------------------------------------------------------------------------
// No new false positives: plain templates, non-failable tags, handled-then-used
// ---------------------------------------------------------------------------

describe("templates with no unhandled `!` call compile and run", () => {
  const clean = [
    ["a plain template", 'const s = `${p == "secret" ? "Y" : "N"}`'],
    ["a plain sequence in a template", 'const s = `${(0, p == "secret") ? "Y" : "N"}`'],
    ["a plain block-bodied arrow IIFE in a template", 'const s = `${(() => { return p == "secret" })() ? "Y" : "N"}`'],
    ["String.raw over a plain interpolation", 'const s = String.raw`${p == "secret" ? "Y" : "N"}`'],
    ["a non-failable tag", 'const t = tagf`a${p}`\n        const s = t == "asecret" ? "Y" : "N"'],
    ["a nested template", 'const s = `${`${p == "secret" ? "Y" : "N"}`}`'],
    ["a handled result read in a template", 'const r = check(p) !{ .Denied :> false }\n        const s = `${r ? "Y" : "N"}`'],
  ];
  for (const [what, decl] of clean) {
    test(what, async () => {
      expect(compileSource(LOGIN(decl), "clean").codes).toEqual([]);
      const page = await boot(LOGIN(decl));
      await page.click("#wrong");
      expect(page.text("#out")).toBe("rejected");
      await page.click("#right");
      expect(page.text("#out")).toBe("LOGGED IN");
    });
  }
});

// ---------------------------------------------------------------------------
// The reader: interpolation hatches carry their source text (ONE reader)
// ---------------------------------------------------------------------------

describe("templateInterpolationNodesAll — the parse's own nodes, with their text", () => {
  const interp = (src) => {
    const lit = parseExprToNode(src, "t.scrml", 0);
    expect(lit.kind).toBe("lit");
    return templateInterpolationNodesAll(lit);
  };

  test("a sequence hatch carries its text", () => {
    const [n] = interp('`${(check(p), 1) ? "Y" : "N"}`');
    expect(n.kind).toBe("ternary");
    expect(n.condition.kind).toBe("escape-hatch");
    expect(n.condition.raw).toBe("(check(p), 1)");
  });

  test("a block-bodied arrow hatch carries its body text", () => {
    const [n] = interp('`${(() => { return check(p) })() ? "Y" : "N"}`');
    const callee = n.condition.callee;
    expect(callee.kind).toBe("escape-hatch");
    expect(callee.raw).toContain("check(p)");
    expect(callee.bodyRaw).toContain("return check(p)");
  });

  test("a tagged-template hatch carries its text", () => {
    const [n] = interp('`${g`${p}` ? "Y" : "N"}`');
    expect(n.condition.kind).toBe("escape-hatch");
    expect(n.condition.raw).toBe("g`${p}`");
  });

  test("the nodes ARE the parse's own interpolation nodes (the ones the emitter writes)", () => {
    const lit = parseExprToNode('`a ${x} b ${y}`', "t.scrml", 0);
    expect(templateInterpolationNodesAll(lit)).toEqual(lit._tplExprs);
  });

  test("a literal carried as text (no structure) is re-read by the same reader", () => {
    const lit = { kind: "lit", litType: "template", raw: '`${(check(p), 1)}`', span: { file: "t", start: 0, end: 18, line: 1, col: 1 } };
    const [n] = templateInterpolationNodesAll(lit);
    expect(n.kind).toBe("escape-hatch");
    expect(n.raw).toBe("(check(p), 1)");
  });

  test("an interpolation that does not read whole is a fallback hatch carrying its text", () => {
    const lit = { kind: "lit", litType: "template", raw: "`${check(p) ) (}`", span: { file: "t", start: 0, end: 16, line: 1, col: 1 } };
    const nodes = templateInterpolationNodesAll(lit);
    expect(nodes.length).toBe(1);
    expect(nodes[0].nativeKind).toBe("TemplateInterpFallback");
    expect(nodes[0].raw).toContain("check(p)");
  });
});

// ---------------------------------------------------------------------------
// The walk: a hatch with no text fails CLOSED
// ---------------------------------------------------------------------------

describe("an escape hatch with no source text is refused at the walk", () => {
  const env = {
    resolveOuter: (n) => (n === "check" ? "check" : null),
    resolveOuterReturns: () => null,
    resolveOuterExact: (n) => (n === "check" ? ["check"] : null),
    resolveOuterReturnsExact: () => null,
    parseStatements: () => null,
    parseExpr: () => null,
    parseGuardArms: () => null,
    matchArmBodyText: () => null,
  };
  const found = (node) => { const out = []; forEachCallInValuePosition(node, "none", env, (c) => out.push(c)); return out; };
  const hatch = (nativeKind, raw) => ({ kind: "escape-hatch", nativeKind, ...(raw === undefined ? {} : { raw }), span: { start: 0, end: 0, line: 1, col: 1 } });

  for (const nk of ["SequenceExpression", "ArrowFunctionExpression", "FunctionExpression", "TaggedTemplateExpression", "ClassExpression", "TemplateInterpFallback"]) {
    test(`${nk} with raw "" is refused (unreadable-expr)`, () => {
      const out = found(hatch(nk, ""));
      expect(out.length).toBe(1);
      expect(out[0].refKind).toBe("unreadable-expr");
      expect(out[0].text).toBe(nk);
    });
  }

  test("a hatch with NO raw at all is refused", () => {
    expect(found(hatch("SequenceExpression", undefined)).map((c) => c.refKind)).toEqual(["unreadable-expr"]);
  });

  test("whitespace-only raw is refused", () => {
    expect(found(hatch("SequenceExpression", "   ")).map((c) => c.refKind)).toEqual(["unreadable-expr"]);
  });

  test("inside a template ternary, through the walk", () => {
    const tern = { kind: "ternary", condition: hatch("SequenceExpression", ""), consequent: { kind: "lit", litType: "string", raw: '"Y"', value: "Y" }, alternate: { kind: "lit", litType: "string", raw: '"N"', value: "N" } };
    expect(found(tern).map((c) => c.refKind)).toEqual(["unreadable-expr"]);
  });

  test("a regular-expression / BigInt literal holds no code (not refused)", () => {
    expect(found(hatch("Literal", "")).length).toBe(0);
    expect(found(hatch("Literal", "/check/g")).length).toBe(0);
  });

  test("a hatch WITH text still reads by name (unchanged)", () => {
    expect(found(hatch("SequenceExpression", "(check(p), 1)")).map((c) => c.calleeName)).toEqual(["check"]);
  });
});

// ---------------------------------------------------------------------------
// Same review, LOW: an object shorthand `{ check }` is a value read
// ---------------------------------------------------------------------------

describe("an object shorthand of a failable function is a value read (E-IMPL1-FAILABLE-FN-VALUE)", () => {
  const env = {
    resolveOuter: (n) => (n === "check" ? "check" : n === "g" ? "check" : null),
    resolveOuterReturns: () => null,
    resolveOuterExact: () => null,
    resolveOuterReturnsExact: () => null,
    parseStatements: () => null,
    parseExpr: () => null,
    parseGuardArms: () => null,
    matchArmBodyText: () => null,
  };
  const found = (node) => { const out = []; forEachCallInValuePosition(node, "none", env, (c) => out.push(c)); return out; };

  test("`{ check }` and `{ g }` are fn-value reads; `{ x }` is not", () => {
    expect(found(parseExprToNode("{ check }", "t", 0)).map((c) => [c.refKind, c.calleeName])).toEqual([["fn-value", "check"]]);
    expect(found(parseExprToNode("{ g }", "t", 0)).map((c) => [c.refKind, c.calleeName, c.via])).toEqual([["fn-value", "check", "g"]]);
    expect(found(parseExprToNode("{ x }", "t", 0)).length).toBe(0);
  });

  test("compiled: `const o = { check }` is refused", () => {
    const codes = compileSource(LOGIN('const o = { check }\n        const s = o.check(p) ? "Y" : "N"'), "short").codes;
    expect(codes).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });
});

// ---------------------------------------------------------------------------
// Same review, MEDIUM: an exported `const` alias reaches importers unchecked
// ---------------------------------------------------------------------------

function compileProject(files, label = "proj") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s469ti-${uniq}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(files)) writeFileSync(resolve(dir, name), src);
  try {
    const result = compileScrml({ inputFiles: [resolve(dir, "app.scrml")], write: true, outputDir: resolve(dir, "out"), log: () => {} });
    return (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("an exported `const` alias of a failable function is refused (E-IMPL1-FAILABLE-FN-VALUE)", () => {
  const LIB = (tail) => `\${
    export type AuthErr:enum = { Denied }
    export function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    ${tail}
}
`;
  const APP = (imp, use) => `<msg> = "init"
\${
    import { ${imp}, AuthErr } from "./lib.scrml"
    function login(p) {
        ${use}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<p id="out">\${@msg}</p>
`;
  const USE_G = "const ok = g(p)";
  const HANDLED = "const ok = check(p) !{ .Denied :> false }";

  test("`export const g = check`", () => {
    expect(compileProject({ "app.scrml": APP("g", USE_G), "lib.scrml": LIB("export const g = check") })).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });
  test("`const g = check` + `export { g }` (the export written first)", () => {
    expect(compileProject({ "app.scrml": APP("g", USE_G), "lib.scrml": LIB("export { g }\n    const g = check") })).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });
  test("`export { g as h }`", () => {
    expect(compileProject({ "app.scrml": APP("h", "const ok = h(p)"), "lib.scrml": LIB("const g = check\n    export { g as h }") })).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });
  test("through `export *`", () => {
    const STAR = "${\n    export * from \"./lib.scrml\"\n}\n";
    const app = APP("g", USE_G).replace('"./lib.scrml"', '"./star.scrml"');
    expect(compileProject({ "app.scrml": app, "star.scrml": STAR, "lib.scrml": LIB("export const g = check") })).toContain("E-IMPL1-FAILABLE-FN-VALUE");
  });
  test("an exported initializer is a value position: an unhandled call is E-ERROR-002", () => {
    expect(compileProject({ "app.scrml": APP("v", "const ok = v"), "lib.scrml": LIB('export const v = check("wrong")') })).toContain("E-ERROR-002");
  });
  test("no false positive: exporting the `!` function itself, a plain const", () => {
    expect(compileProject({ "app.scrml": APP("check", HANDLED), "lib.scrml": LIB("export const n = 1") })).toEqual([]);
  });
  test("no false positive: a local `const` alias that is not exported", () => {
    expect(compileProject({ "app.scrml": APP("check", HANDLED), "lib.scrml": LIB("const g = check\n    export const n = 1") })).toEqual([]);
  });
});
