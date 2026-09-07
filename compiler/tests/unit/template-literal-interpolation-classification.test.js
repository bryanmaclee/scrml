/**
 * template-literal-interpolation-classification.test.js
 *
 * SPEC §7.5.1 x §53.4 — an interpolated back-tick template is a literal whose
 * TYPE is known and whose TEXT is not. §7.5.1 says so normatively:
 *
 *   "a widening of the literal set SHALL NOT convert a §53.4 BOUNDARY
 *    assignment into a STATIC one for a literal whose VALUE is not statically
 *    determined — an interpolated template literal is such a literal (its type
 *    is known, its text is not)."
 *
 * ⚑ WHY THIS FILE EXISTS AND WHY ITS MATRIX IS SHAPED THE WAY IT IS.
 *
 * The §7.5.1 template widening landed with 262 lines of new tests that covered
 * the `let` form ONLY. The state-cell form (`<x>: T(pred) = …`) and the
 * `const`-derived form were never exercised, and a soundness question on those
 * two forms therefore landed GREEN. A partial matrix reads exactly like a
 * complete one from the outside. So every case below is stated for ALL THREE
 * declaration forms and in BOTH directions:
 *
 *   direction A — the guard is EMITTED when the value is not statically known;
 *   direction B — valid code is NOT statically rejected on a value the
 *                 compiler never had.
 *
 * and the degenerate shapes are enumerated rather than assumed:
 *   - a genuinely EMPTY template  ``
 *   - a single-quasi NON-EMPTY template  `abc`
 *   - a multi-quasi template whose interpolations render to the empty string
 *
 * ⚑ AND WHY SOME OF THESE PIN A DEFECT RATHER THAN A FIX. The state-cell and
 * `const`-derived cases at FILE TOP LEVEL do not reach the type system with an
 * interpolated template at all: the block splitter has no back-tick tracking
 * outside a `^{}` meta frame, so a top-level template's `${…}` segments are
 * consumed as LOGIC-BLOCK openers and the initializer reassembles to ``.
 * Those tests are labelled DEFECT PINNED and they assert what the compiler
 * ACTUALLY does today. **When the root is fixed they SHALL FAIL. Invert them;
 * do not delete them.** Pinning the observed behaviour is what makes the fix
 * loud instead of silent — the alternative (a skipped test) rots unread.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";

import { compileScrml } from "../../src/api.js";
import { classifyLiteralFromExprNode, parseExprToNode } from "../../src/expression-parser.ts";
import { extractInitLiteral } from "../../src/type-system.ts";
import { nativeParseFile } from "../../native-parser/parse-file.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a whole `.scrml` source and hand back BOTH the diagnostics AND the
 * emitted JS. The emitted JS is the load-bearing half: §53.4's boundary guard
 * moves no diagnostic when it is deleted, so an assertion on `errors` alone is
 * blind to the failure this file exists to catch.
 */
function compileWholeScrml(source, testName = `tpl-interp-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      emittedJs: collectEmittedJs(result),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Concatenate every JS artifact the compile produced. `compileScrml` returns
 * `outputs` as a MAP (keyed by input file) whose values carry `clientJs` /
 * `serverJs` / `libraryJs` — NOT a plain object keyed by filename. Iterating it
 * the wrong way yields "" for every compile, and every artifact assertion in
 * this file then passes or fails for the wrong reason.
 */
function collectEmittedJs(result) {
  const outs = result?.outputs;
  if (!outs || typeof outs.values !== "function") return "";
  const parts = [];
  for (const o of outs.values()) {
    for (const k of ["clientJs", "serverJs", "libraryJs"]) {
      if (o && typeof o[k] === "string") parts.push(o[k]);
    }
  }
  return parts.join("\n");
}

function codes(diagnostics) {
  return (diagnostics ?? []).map(d => d.code).filter(Boolean);
}

/** How many §53.4.5 runtime boundary guards did codegen emit? */
function guardCount(js) {
  return (String(js).match(/E-CONTRACT-001-RT/g) ?? []).length;
}

// =============================================================================
// LAYER 1 — the classifier, on nodes built BY THE PARSER
//
// This is the layer §7.5.1's sentence actually constrains. The two questions
// it answers are different and must not be collapsed: "what TYPE is this
// literal" (position 1 / position 2, E-TYPE-031) and "what VALUE does it have"
// (§53.4's predicate zone). An interpolated template answers the first and
// must decline the second.
// =============================================================================

describe("classifyLiteralFromExprNode — parser-built template literals", () => {

  test("a single-quasi NON-EMPTY template is a decided literal carrying its text", () => {
    const node = parseExprToNode("`abc`", "t.scrml", 0);
    expect(node.kind).toBe("lit");
    expect(node.litType).toBe("template");
    expect(node.hasInterpolation).toBe(false);
    expect(classifyLiteralFromExprNode(node)).toEqual({ kind: "literal", value: "abc" });
  });

  test("a GENUINELY EMPTY template is a decided literal carrying the empty string", () => {
    // The degenerate shape. Its value IS "" — that is a real answer, not a
    // missing one, and the classifier must give it rather than declining.
    const node = parseExprToNode("``", "t.scrml", 0);
    expect(node.kind).toBe("lit");
    expect(node.litType).toBe("template");
    expect(node.hasInterpolation).toBe(false);
    expect(classifyLiteralFromExprNode(node)).toEqual({ kind: "literal", value: "" });
  });

  test("an INTERPOLATED template declines the value and keeps the type", () => {
    const node = parseExprToNode("`${a} world`", "t.scrml", 0);
    expect(node.kind).toBe("lit");
    expect(node.litType).toBe("template");
    expect(node.hasInterpolation).toBe(true);
    expect(classifyLiteralFromExprNode(node)).toEqual({ kind: "literal-type-only", type: "string" });
  });

  test("an interpolated template whose interpolations RENDER EMPTY still declines the value", () => {
    // The compiler cannot know that `a` is "". Statically the text is unknown,
    // and "unknown" is the answer regardless of what it turns out to be.
    const node = parseExprToNode("`${a}${b}`", "t.scrml", 0);
    expect(node.hasInterpolation).toBe(true);
    expect(classifyLiteralFromExprNode(node)).toEqual({ kind: "literal-type-only", type: "string" });
  });

  test("an ESCAPED \\${ is literal text, not an interpolation", () => {
    const node = parseExprToNode("`a\\${b}c`", "t.scrml", 0);
    expect(node.litType).toBe("template");
    expect(node.hasInterpolation).toBe(false);
    expect(classifyLiteralFromExprNode(node).kind).toBe("literal");
  });
});

// =============================================================================
// LAYER 2 — the REGRESSION GUARD for the (raw, value) aliasing
//
// `isStaticTemplateLit` used to answer this question by reconstructing
// "`" + value + "`" and comparing it to `raw`, and its doc comment called that
// "an exact test, not a heuristic". It is not exact: the reconstruction is
// ALSO satisfied by raw === "``" / value === "", which is what a multi-quasi
// template degrades to whenever its source text could not be recovered — the
// astring last-resort fallback in the `TemplateLiteral` arm sets literally
// that pair, and so does any upstream stage that truncated the initializer.
//
// These nodes are hand-built ON PURPOSE. They are the shapes a parser-built
// node cannot be made to take from source, and they are exactly the shapes
// that made the aliasing reachable.
// =============================================================================

describe("classifyLiteralFromExprNode — the degraded-template aliasing", () => {

  const span = { file: "t.scrml", start: 0, end: 0, line: 1, col: 1 };

  test("a DEGRADED interpolated template (raw '``', value '') declines the value", () => {
    // ⚑ THE REGRESSION GUARD. Before `hasInterpolation` was carried, this node
    // was indistinguishable from a genuinely empty template and classified
    // `{ kind: "literal", value: "" }` — which routes §53.4 to the STATIC zone
    // and evaluates the predicate against a value the literal does not have.
    const degraded = {
      kind: "lit", span, raw: "``", value: "", litType: "template",
      hasInterpolation: true,
    };
    expect(classifyLiteralFromExprNode(degraded))
      .toEqual({ kind: "literal-type-only", type: "string" });
  });

  test("a genuinely empty template with the SAME (raw, value) pair still decides", () => {
    // The pair is identical to the case above. Only the carried flag separates
    // them, which is the whole point of carrying it.
    const empty = {
      kind: "lit", span, raw: "``", value: "", litType: "template",
      hasInterpolation: false,
    };
    expect(classifyLiteralFromExprNode(empty)).toEqual({ kind: "literal", value: "" });
  });

  test("with the flag ABSENT the fallback scans `raw` — it does not reconstruct", () => {
    // Hand-synthesized nodes (older synthesis paths, other tests) carry no
    // flag. The fallback must be a real test on real text.
    const interpolated = {
      kind: "lit", span, raw: "`${a} world`", value: "", litType: "template",
    };
    expect(classifyLiteralFromExprNode(interpolated))
      .toEqual({ kind: "literal-type-only", type: "string" });

    const staticTpl = {
      kind: "lit", span, raw: "`abc`", value: "abc", litType: "template",
    };
    expect(classifyLiteralFromExprNode(staticTpl)).toEqual({ kind: "literal", value: "abc" });
  });
});

// =============================================================================
// LAYER 2b — THE NATIVE PIPELINE. `value` is the COOKED body, not `raw`.
//
// ⚑ WHY THIS LAYER IS NOT OPTIONAL. `translateTemplateLit` used to construct
// its node as `makeLit(raw, raw, …)`, so a native template's `value` carried
// the DELIMITERS: `` `abc` `` (5 characters) for a literal whose value is
// `abc` (3). That was survivable ONLY by accident — `isStaticTemplateLit` used
// to reconstruct "`" + value + "`" and compare it to `raw`, a test that can
// never match once `value` already has the backticks, so every native template
// fell through to `literal-type-only` and kept its §53.4 runtime guard.
//
// Carrying `hasInterpolation` removes that accidental fall-through. A stamped
// `hasInterpolation: false` over a corrupt `value` routes the node into the
// STATIC zone with a 5-character value where the real one is 3 — a false
// `E-CONTRACT-001` on valid code in one direction and a silently elided
// boundary guard in the other. Carrying the flag and fixing `value` are ONE
// change; either alone is worse than neither.
//
// The native path is not exotic. `sourceNeedsLiveFallback`
// (`component-expander.ts:1087`) sends only INTERPOLATED templates to the live
// parser, so STATIC templates reach the native translator BY DESIGN.
//
// These tests drive the REAL native parser. Hand-built `TemplateLit` nodes are
// the WRONG REFERENT here: they carry no `cooked`, so they cannot distinguish
// a fixed translator from a broken one.
// =============================================================================

describe("the NATIVE pipeline — LitExpr.value is the cooked body", () => {

  const BT = String.fromCharCode(96);
  const DOLLAR = "$";

  /** Every `litType: "template"` node the native parser built for this source. */
  function nativeTemplateLits(source) {
    const tmpDir = resolve(testDir, `_tmp_native_${++tmpCounter}`);
    const tmpInput = resolve(tmpDir, "app.scrml");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpInput, source);
    try {
      const res = nativeParseFile(tmpInput, source);
      const found = [];
      const seen = new Set();
      (function walk(node) {
        if (!node || typeof node !== "object" || seen.has(node)) return;
        seen.add(node);
        if (node.kind === "lit" && node.litType === "template") found.push(node);
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === "object") walk(v);
        }
      })(res?.ast ?? res);
      return found;
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const wrap = (init) => `${DOLLAR}{
  let s = ${init}
  log(s)
}
<p>ok</>`;

  test("a STATIC template carries the cooked body, WITHOUT the delimiters", () => {
    const [lit] = nativeTemplateLits(wrap(BT + "abc" + BT));
    expect(lit).toBeDefined();
    expect(lit.raw).toBe(BT + "abc" + BT);
    // ⚑ THE REGRESSION GUARD. `value` was `raw` — delimiters and all.
    expect(lit.value).toBe("abc");
    expect(lit.hasInterpolation).toBe(false);
    expect(classifyLiteralFromExprNode(lit)).toEqual({ kind: "literal", value: "abc" });
  });

  test("ESCAPES are resolved in `value`, exactly as the live pipeline resolves them", () => {
    const [lit] = nativeTemplateLits(wrap(BT + "a\\nb" + BT));
    expect(lit).toBeDefined();
    expect(lit.value).toBe("a\nb");          // three characters, real newline
    expect(lit.value.length).toBe(3);
    expect(classifyLiteralFromExprNode(lit)).toEqual({ kind: "literal", value: "a\nb" });
  });

  test("an EMPTY template carries the empty string", () => {
    const [lit] = nativeTemplateLits(wrap(BT + BT));
    expect(lit).toBeDefined();
    expect(lit.value).toBe("");
    expect(lit.hasInterpolation).toBe(false);
    expect(classifyLiteralFromExprNode(lit)).toEqual({ kind: "literal", value: "" });
  });

  test("an INTERPOLATED template declines the value, matching the live multi-quasi branch", () => {
    const [lit] = nativeTemplateLits(wrap(BT + DOLLAR + "{a} world" + BT));
    expect(lit).toBeDefined();
    expect(lit.hasInterpolation).toBe(true);
    // "" is NOT the text. `hasInterpolation` is what says so — which is the
    // whole reason the flag is carried rather than inferred.
    expect(lit.value).toBe("");
    expect(classifyLiteralFromExprNode(lit)).toEqual({ kind: "literal-type-only", type: "string" });
  });

  test("the two pipelines AGREE on a static template — same value, same classification", () => {
    const [nativeLit] = nativeTemplateLits(wrap(BT + "abc" + BT));
    const liveLit = parseExprToNode(BT + "abc" + BT, "t.scrml", 0);
    expect(nativeLit.value).toBe(liveLit.value);
    expect(nativeLit.hasInterpolation).toBe(liveLit.hasInterpolation);
    expect(classifyLiteralFromExprNode(nativeLit))
      .toEqual(classifyLiteralFromExprNode(liveLit));
  });
});

// =============================================================================
// LAYER 3 — `extractInitLiteral`, the FALLBACK path
//
// Used only where a declaration carries no parsed `initExpr`. It and
// `classifyLiteralFromExprNode` SHALL agree on the literal set, or §7.5.1
// enforcement depends on which parse path a declaration happened to take.
// =============================================================================

describe("extractInitLiteral — the string fallback path", () => {

  test("a static template yields its body as the value", () => {
    expect(extractInitLiteral("`abc`")).toEqual({ kind: "literal", value: "abc" });
  });

  test("an interpolated template yields type-only", () => {
    expect(extractInitLiteral("`${a} world`")).toEqual({ kind: "literal-type-only", type: "string" });
  });

  test("an empty template yields the empty string", () => {
    expect(extractInitLiteral("``")).toEqual({ kind: "literal", value: "" });
  });

  test("CONCATENATED templates are arithmetic, not an 11-character literal", () => {
    // ⚑ REGRESSION GUARD. "starts with a back-tick and ends with a back-tick"
    // is not "is one template literal". This ran BEFORE the arithmetic test,
    // so `` `abc` + `de` `` used to return a literal of 11 characters (the
    // body `` abc` + `de ``) for an expression whose runtime value is 5 —
    // eliding a §53.4 boundary guard against a value nobody computed.
    expect(extractInitLiteral("`abc` + `de`")).toEqual({ kind: "arithmetic" });
  });

  test("CONCATENATED quoted strings are arithmetic too — the identical twin bug", () => {
    // ⚑ The quoted-string branch sat ONE LINE ABOVE the template branch with
    // the same defect, and fixing only the second is how the `let`-vs-state-cell
    // asymmetry happened in the §7.5.1 widening. `"ab" + "cd"` returned a
    // literal of 9 characters (`ab" + "cd`) for a runtime value of 4.
    expect(extractInitLiteral('"ab" + "cd"')).toEqual({ kind: "arithmetic" });
    expect(extractInitLiteral("'ab' + 'cd'")).toEqual({ kind: "arithmetic" });
  });

  test("a static literal whose BODY contains `+` is still a literal", () => {
    // Why the fix is a SCANNER and not a reordering below the arithmetic test:
    // that test is a bare /[+*\/]/ over the whole string and cannot see
    // quoting, so reordering would break both of these.
    expect(extractInitLiteral("`a + b`")).toEqual({ kind: "literal", value: "a + b" });
    expect(extractInitLiteral('"a + b"')).toEqual({ kind: "literal", value: "a + b" });
  });

  test("the value is COOKED, not the raw body", () => {
    // ⚑ THIS TEST PREVIOUSLY LOCKED IN THE WRONG ANSWER. It asserted the
    // 4-character raw body `a\`b` where the structured classifier reports the
    // 3-character cooked value `a`b`. §53.4 evaluates that value against a
    // predicate, so a one-character difference is a wrong answer, not a
    // cosmetic one.
    expect(extractInitLiteral("`a\\`b`")).toEqual({ kind: "literal", value: "a`b" });
    expect(extractInitLiteral("`a\\nb`")).toEqual({ kind: "literal", value: "a\nb" });
    expect(extractInitLiteral('"a\\tb"')).toEqual({ kind: "literal", value: "a\tb" });
    expect(extractInitLiteral("`a\\u0041b`")).toEqual({ kind: "literal", value: "aAb" });
  });

  test("an ESCAPED \\${ is literal text — the fallback is escape-aware too", () => {
    // ⚑ REGRESSION GUARD for the invariant this function's own docstring
    // declares. The structured classifier counts backslash parity; the
    // fallback used a naive `body.includes("${")`, so `` `a\${b}c` `` was
    // `literal-type-only` on one path and a decided `literal` on the other —
    // making §7.5.1 enforcement depend on which parse path a declaration
    // happened to take, which is precisely what the docstring forbids.
    expect(extractInitLiteral("`a\\${b}c`")).toEqual({ kind: "literal", value: "a${b}c" });
  });

  test("a NESTED template inside an interpolation is one interpolated template", () => {
    // ⚑ REGRESSION GUARD for a narrowing that silently removed a check.
    // Rejecting any body containing a back-tick also rejected a legitimate
    // nested template, dropping `` `a${`b`}c` `` from `literal-type-only` to
    // `unconstrained` — and `sourcePrimitiveType(unconstrained)` is null, so
    // `<n>: number = \`a${\`b\`}c\`` stopped firing E-TYPE-031 on this path.
    expect(extractInitLiteral("`a${`b`}c`")).toEqual({ kind: "literal-type-only", type: "string" });
  });

  test("an UNTERMINATED literal is not a literal", () => {
    expect(extractInitLiteral("`abc")).toEqual({ kind: "unconstrained" });
    expect(extractInitLiteral('"abc')).toEqual({ kind: "unconstrained" });
    expect(extractInitLiteral("`a${b`")).toEqual({ kind: "unconstrained" });
  });
});

// -----------------------------------------------------------------------------
// The invariant `extractInitLiteral`'s docstring DECLARES, asserted directly.
//
//   "`classifyLiteralFromExprNode` is the structured equivalent and the two
//    SHALL agree on the literal set, or §7.5.1 enforcement would depend on
//    which parse path a declaration happened to take."
//
// A docstring that states an invariant nothing checks is a comment, not a
// contract. This table is the check.
// -----------------------------------------------------------------------------

describe("the two paths SHALL agree — structured vs fallback", () => {

  const BT = String.fromCharCode(96);
  const D = "$";

  const table = [
    ["static template",            BT + "abc" + BT],
    ["empty template",             BT + BT],
    ["interpolated template",      BT + D + "{a} world" + BT],
    ["escaped-dollar template",    BT + "a\\" + D + "{b}c" + BT],
    ["nested template in interp",  BT + "a" + D + "{" + BT + "b" + BT + "}c" + BT],
    ["escaped back-tick",          BT + "a\\" + BT + "b" + BT],
    ["escaped newline",            BT + "a\\nb" + BT],
    ["template body with plus",    BT + "a + b" + BT],
    ["concatenated templates",     BT + "abc" + BT + " + " + BT + "de" + BT],
    ["double-quoted string",       '"abc"'],
    ["single-quoted string",       "'abc'"],
    ["concatenated dquote",        '"ab" + "cd"'],
    ["concatenated squote",        "'ab' + 'cd'"],
    ["numeric literal",            "42"],
    ["boolean literal",            "true"],
  ];

  for (const [name, src] of table) {
    test(`${name} — same answer on both paths`, () => {
      const fallback = extractInitLiteral(src);
      const structured = classifyLiteralFromExprNode(parseExprToNode(src, "t.scrml", 0));
      expect(fallback).toEqual(structured);
    });
  }
});

// =============================================================================
// LAYER 4 — the THREE DECLARATION FORMS, compiled end to end, BOTH directions
//
// This is the layer the §7.5.1 widening shipped without. Each form gets:
//   direction A — an interpolated template that would OVERFLOW its predicate
//                 must still be guarded at runtime;
//   direction B — an interpolated template that SATISFIES its predicate must
//                 not be statically rejected.
// =============================================================================

describe("three declaration forms x both directions — `let`", () => {

  test("A: an interpolated template that may overflow keeps its runtime guard", () => {
    const src = `\${
    let a = "hello"
    let s: string(.length <= 3) = \`\${a} world here\`
    log(s)
}
<p>ok</>`;
    const { errors, emittedJs } = compileWholeScrml(src, "let-dirA");
    expect(codes(errors)).not.toContain("E-CONTRACT-001");
    expect(guardCount(emittedJs)).toBeGreaterThan(0);
  });

  test("B: an interpolated template that satisfies its predicate is not rejected", () => {
    const src = `\${
    let a = "hello"
    let s: string(.length >= 5) = \`\${a} world here\`
    log(s)
}
<p>ok</>`;
    const { errors, emittedJs } = compileWholeScrml(src, "let-dirB");
    expect(codes(errors)).toEqual([]);
    expect(guardCount(emittedJs)).toBeGreaterThan(0);
  });

  test("the degenerate shapes: empty / single-quasi / interpolations-render-empty", () => {
    const mk = (init, pred) => `\${
    let a = ""
    let s: string(${pred}) = ${init}
    log(s)
}
<p>ok</>`;

    // A genuinely EMPTY template IS decided — and it fails a `>= 5` predicate
    // at COMPILE time, because "" is its real value.
    const empty = compileWholeScrml(mk("``", ".length >= 5"), "degen-empty");
    expect(codes(empty.errors)).toContain("E-CONTRACT-001");

    // A single-quasi NON-EMPTY template is decided the same way.
    const single = compileWholeScrml(mk("`hi`", ".length >= 5"), "degen-single");
    expect(codes(single.errors)).toContain("E-CONTRACT-001");

    // An INTERPOLATED template whose interpolations happen to render empty is
    // NOT decided — the compiler cannot know that, and must not pretend to.
    // (`a` is declared `""` above, so the runtime text really is "". A
    // compiler that mistook `value: ""` for the template's text would reject
    // this at COMPILE time and delete the guard that catches it at runtime.)
    const interp = compileWholeScrml(mk("`${a}`", ".length >= 5"), "degen-interp-empty");
    expect(codes(interp.errors)).not.toContain("E-CONTRACT-001");
    expect(guardCount(interp.emittedJs)).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// The `const` form — its STATIC half is verified; its BOUNDARY half is a
// DEFECT PINNED.
//
// ⚑ MEASURED AT `499eecce` (the parent of the §7.5.1 widening) AND AT HEAD,
// by executing both: a `const` carrying a PREDICATED annotation emits ZERO
// §53.4 boundary guards for ANY initializer whose value is not statically
// known — an interpolated template AND a plain identifier alike. The sibling
// `let` with the identical initializer emits 2. This is NOT template-specific
// and NOT a regression from the widening; the whole BOUNDARY limb of the
// `const` form is absent, while its STATIC limb works.
// -----------------------------------------------------------------------------

describe("`const` form — static limb verified, boundary limb DEFECT PINNED", () => {

  test("the STATIC limb works: a decided literal that fails its predicate is rejected", () => {
    const src = `\${
    const s: string(.length >= 5) = "hi"
    log(s)
}
<p>ok</>`;
    const { errors } = compileWholeScrml(src, "const-static-limb");
    expect(codes(errors)).toContain("E-CONTRACT-001");
  });

  test("B: an interpolated template that satisfies its predicate is not rejected", () => {
    // This direction IS correct today, and it is the direction the widening
    // could have broken. Keep it.
    const src = `\${
    let a = "hello"
    const s: string(.length >= 5) = \`\${a} world here\`
    log(s)
}
<p>ok</>`;
    const { errors } = compileWholeScrml(src, "const-dirB");
    expect(codes(errors)).toEqual([]);
  });

  test("DEFECT PINNED: the boundary limb emits no guard, for a template OR an ident", () => {
    // What it SHOULD be once the `const` boundary limb is implemented:
    //   expect(guardCount(tpl.emittedJs)).toBeGreaterThan(0);
    //   expect(guardCount(ident.emittedJs)).toBeGreaterThan(0);
    // What it IS today, on both sides of the widening:
    const mk = (init) => `\${
    let a = "hello"
    const s: string(.length <= 3) = ${init}
    log(s)
}
<p>ok</>`;
    const tpl = compileWholeScrml(mk("`${a} world here`"), "const-pinned-tpl");
    const ident = compileWholeScrml(mk("a"), "const-pinned-ident");
    expect(guardCount(tpl.emittedJs)).toBe(0);
    expect(guardCount(ident.emittedJs)).toBe(0);

    // The contrast that makes this a DEFECT and not a design choice: the same
    // initializer under `let` IS guarded.
    const asLet = compileWholeScrml(`\${
    let a = "hello"
    let s: string(.length <= 3) = a
    log(s)
}
<p>ok</>`, "const-pinned-contrast-let");
    expect(guardCount(asLet.emittedJs)).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// The STATE-CELL form — DEFECT PINNED, not verified.
//
// ⚑ READ THIS BEFORE YOU "FIX" A FAILURE HERE.
//
// `<x>: T(pred) = \`${@a} ${@b}\`` at FILE TOP LEVEL never reaches the type
// system as an interpolated template. `splitBlocks` has no back-tick tracking
// outside a `frame.type === "meta"` frame, so at top level the template's
// `${…}` segments are consumed as LOGIC-BLOCK openers:
//
//   text  : "<full>: string(.length <= 8) = `"
//   logic : "${@first}"
//   text  : " "
//   logic : "${@last}"
//   text  : "`"
//
// The declaration's initializer reassembles to `` — the interpolation is GONE
// from the AST and from the emitted output, and the two orphaned logic blocks
// are emitted as bare `_scrml_reactive_get(...)` expression statements. This
// is UPSTREAM of every classification question in this file, it PRE-DATES the
// §7.5.1 template widening, and no change to the literal set can repair it.
//
// The tests below therefore assert what the compiler ACTUALLY does. They are a
// tripwire, not a contract: **when the splitter root is fixed they SHALL FAIL.
// Invert them to the `let`/`const` expectations above; do not delete them.**
// -----------------------------------------------------------------------------

describe("state-cell form — DEFECT PINNED (top-level template loses its interpolation)", () => {

  test("the interpolation does not survive to the emitted output", () => {
    const src = `<first>: string = "Bartholomew"
<last>: string = "Vanderbilt"
<full>: string = \`\${@first} \${@last}\`

<program>
  <p>\${@full}</p>
</program>`;
    const { emittedJs } = compileWholeScrml(src, "cell-pinned-value");
    // What it SHOULD be once the root is fixed:
    //   expect(emittedJs).toContain('_scrml_reactive_get("first")');  // inside the template
    // What it IS today — the cell is initialized to an EMPTY template:
    expect(emittedJs).toMatch(/reactive_set\("full", ``\)/);
  });

  test("a predicated state cell is classified STATIC because its value is ''", () => {
    const src = `<first>: string = "Bartholomew"
<last>: string = "Vanderbilt"
<full>: string(.length <= 8) = \`\${@first} \${@last}\`

<program>
  <p>\${@full}</p>
</program>`;
    const { errors, emittedJs } = compileWholeScrml(src, "cell-pinned-guard");
    // What it SHOULD be once the root is fixed:
    //   expect(guardCount(emittedJs)).toBeGreaterThan(0);
    // What it IS today — `""` satisfies `.length <= 8` at compile time, so the
    // zone is STATIC and no guard is emitted. Note the compile is CLEAN: this
    // failure moves NO diagnostic, which is why it needs an artifact assertion.
    expect(codes(errors)).toEqual([]);
    expect(guardCount(emittedJs)).toBe(0);
  });
});
