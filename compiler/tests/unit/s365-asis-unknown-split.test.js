/**
 * S365 (dpa-036 call 1) — the `asIs` / `unknown` split. SPEC §7.5, §14.7.
 *
 * THE RULE BEING TESTED
 *
 *   `asIs` means a developer signed for it. It must never mean the compiler
 *   did not look. Before S365 those were ONE value — expression inference gave
 *   up by returning `tAsIs()`, the same value §14.7 reserves for a deliberate,
 *   named escape hatch — so *absence of a diagnostic* and *success* were the
 *   same observation.
 *
 *   Now inference is STRUCTURALLY INCAPABLE of producing `asIs`. It returns
 *   `InferenceResult` — a discriminated union of `{ ok, type }` / `{ ok, gap }` —
 *   an `InferenceGap` cannot be built without naming an `ExprNode` kind, and the
 *   decl site binds `unknown` carrying that gap while emitting
 *   `W-TYPE-031-UNPROVEN`.
 *
 *   ⚑ SCOPE, CORRECTED IN THE S365 FIX ROUND. That invariant is scoped to
 *   `inferExprType` and to the un-annotated `let`/`const` declaration site. It is
 *   NOT global: `tAsIs()` has 101 call sites and rung 0 converts one. §7.5.2's ⚑
 *   note carries the six-line refutation (an un-annotated function PARAMETER),
 *   and section 6 below pins it as an OPEN gap so a rung-1 landing flips it.
 *
 *   FAIL-LOUD, NOT FAIL-CLOSED. Every gap case here must still COMPILE. If one
 *   of these starts producing an error, the split has stopped being free and
 *   that is a regression, not a stricter compiler.
 *
 * WHAT IS DELIBERATELY *NOT* TESTED HERE
 *   - E-TYPE-031's fire behaviour is unchanged (rung 0 changed nothing about
 *     it); `gauntlet-s19/type-annot-mismatch.test.js` owns that.
 *   - Rungs 1-3 (widening the literal set, argument / return / operand
 *     positions, the builtin-method catalog) are separate dispatches. The
 *     `inferenceGap` arms they will convert are asserted here AS GAPS, on
 *     purpose: when a rung lands, the corresponding test below flips from
 *     "reports a gap" to "infers a type", and that flip is the rung's proof.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { inferExprType, tAsIs } from "../../src/type-system.ts";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/** Compile a whole .scrml source and partition its diagnostics. */
function compileSrc(source, testName = `s365-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    const errors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    // W-*/I-* codes partition into result.warnings, so a cross-stream helper is
    // needed to assert on them (see the diagnostic-stream partition contract).
    const all = [...errors, ...warnings];
    return {
      errors,
      warnings,
      gaps: all.filter(d => d.code === "W-TYPE-031-UNPROVEN"),
      codes: all.map(d => d.code),
      errorCodes: errors.map(d => d.code),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Same as `compileSrc`, but ACTUALLY EMITS. Some diagnostics — E-CODEGEN-INVALID-LOGIC
 * among them — are raised by the emit pass and are invisible to a `write: false`
 * compile, so a test that needs one must pay for the write.
 */
function compileSrcEmitting(source, testName = `s365e-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    const errors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    const all = [...errors, ...warnings];
    return {
      errors,
      warnings,
      gaps: all.filter(d => d.code === "W-TYPE-031-UNPROVEN"),
      codes: all.map(d => d.code),
      errorCodes: errors.map(d => d.code),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Wrap a logic body in the canonical single-file `<program>` shape. */
const P = (body) => `<program>\n${body}\n</program>\n`;

/** The AST node kind named by a gap warning's message. */
function gapKind(diag) {
  const m = /AST node kind `([^`]+)`/.exec(diag.message ?? "");
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 1. THE INVARIANT — inference cannot produce `asIs`, at all, ever
// ---------------------------------------------------------------------------

describe("S365 §7.5 — inference is structurally incapable of producing `asIs`", () => {

  // Every ExprNode kind, driven through the exported inference entry point.
  // The union has 22 members (compiler/src/types/ast.ts). This list is the
  // COVERAGE LEDGER: if a member is added to `ExprNode`, the `never`
  // fallthrough in `inferExprType` makes it a TypeScript error at the source,
  // and this list is where the corresponding test arm goes.
  const EVERY_EXPR_FORM = [
    ["ident",            "someIdentifier"],
    ["lit (number)",     "42"],
    ["lit (string)",     '"hello"'],
    ["lit (bool)",       "true"],
    ["array",            "[1, 2, 3]"],
    ["object",           "{ a: 1 }"],
    ["unary",            "-42"],
    ["unary (not-lit)",  "-someVar"],
    ["binary",           '"x" * 2'],
    ["ternary",          "cond ? 1 : 2"],
    ["member",           "obj.field"],
    ["index",            "arr[0]"],
    ["call",             "doThing()"],
    ["lambda",           "(x) => x"],
    ["map-lit",          "[ 1: 2 ]"],
  ];

  for (const [label, exprSrc] of EVERY_EXPR_FORM) {
    test(`\`${exprSrc}\` (${label}) — inference returns ok|gap, never asIs`, () => {
      const node = parseExprToNode(exprSrc);
      // A parse failure here is a test-authoring bug, not a finding.
      expect(node, `\`${exprSrc}\` did not parse to an ExprNode`).toBeTruthy();

      const result = inferExprType(node);

      // The Result shape itself is the contract: callers MUST branch.
      expect(typeof result.ok).toBe("boolean");

      if (result.ok) {
        // THE LOAD-BEARING ASSERTION. Inference never hands back the
        // developer's escape hatch — it has no standing to sign for one.
        expect(result.type.kind).not.toBe("asIs");
        expect(result.type.kind).not.toBe("unknown");
      } else {
        // A gap MUST name a real AST node kind. This is the property the
        // `InferenceGap` constructor signature enforces at compile time; this
        // asserts it survives to runtime.
        expect(typeof result.gap.nodeKind).toBe("string");
        expect(result.gap.nodeKind.length).toBeGreaterThan(0);
        expect(result.gap.nodeKind).toBe(node.kind);
        expect(typeof result.gap.detail).toBe("string");
        expect(result.gap.detail.length).toBeGreaterThan(0);
      }
    });
  }

  test("the typed forms are exactly today's inference power (rung 0 widens nothing)", () => {
    const typed = [
      ["42", "number"],
      ["-42", "number"],
      ['"hello"', "string"],
    ];
    for (const [src, expectedName] of typed) {
      const r = inferExprType(parseExprToNode(src));
      expect(r.ok, `${src} should infer`).toBe(true);
      expect(r.type.kind).toBe("primitive");
      expect(r.type.name).toBe(expectedName);
    }
  });

  test("`asIs` is still constructible BY HAND — the hatch is not removed, only un-shared", () => {
    // The split narrows WHO may produce `asIs`, not whether it exists. §14.7's
    // developer-facing hatch is untouched.
    expect(tAsIs().kind).toBe("asIs");
  });
});

// ---------------------------------------------------------------------------
// 2. DIRECTION A — an AUTHORED `asIs` stays SILENT
// ---------------------------------------------------------------------------

describe("S365 §14.7 — an authored `asIs` is silent, because a human signed for it", () => {

  test("`let box: asIs = loadBox()` — no gap warning", () => {
    const { gaps, errorCodes } = compileSrc(P(
      '${\n  fn loadBox() {\n    return 1\n  }\n  let box: asIs = loadBox()\n  print(box)\n}\n<p>ok</>',
    ), "authored-asis-call");
    expect(gaps.length).toBe(0);
    expect(errorCodes).toEqual([]);
  });

  test("ANY annotation suppresses the gap — the author stated the type", () => {
    const { gaps } = compileSrc(P(
      '${\n  fn loadBox() {\n    return 1\n  }\n  let box: number = loadBox()\n  print(box)\n}\n<p>ok</>',
    ), "annotated-call");
    expect(gaps.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. DIRECTION B — a DEFEATED inference is loud, counted, and still passes
// ---------------------------------------------------------------------------

describe("S365 §7.5 — a defeated inference warns, names the node kind, and still compiles", () => {

  const GAP_CASES = [
    ["call",    'fn loadBox() {\n    return 1\n  }\n  let box = loadBox()\n  print(box)'],
    ["array",   "let xs = [1, 2, 3]\n  print(xs.length)"],
    ["object",  "let cfg = { a: 1 }\n  print(cfg.a)"],
    ["lit",     "let flag = true\n  print(flag)"],
    ["binary",  'let z = "x" * 2\n  print(z)'],
    ["ternary", "let n = 1\n  let t = n > 0 ? 1 : 2\n  print(t)"],
  ];

  for (const [expectedKind, body] of GAP_CASES) {
    test(`gap at \`${expectedKind}\` — warns, names the kind, and does NOT error`, () => {
      const { gaps, errors } = compileSrc(P(`\${\n  ${body}\n}\n<p>ok</>`), `gap-${expectedKind}`);

      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.map(gapKind)).toContain(expectedKind);

      // FAIL-LOUD, NOT FAIL-CLOSED. The whole design is that the adopter is
      // billed NOTHING for the compiler's own coverage gap.
      expect(errors.map(e => e.code)).toEqual([]);

      // The diagnostic partitions into the non-fatal stream.
      for (const g of gaps) expect(g.severity).toBe("warning");
    });
  }

  test("the warning names the DECLARATION, so it is actionable", () => {
    const { gaps } = compileSrc(P(
      '${\n  fn loadBox() {\n    return 1\n  }\n  let inventoryBox = loadBox()\n  print(inventoryBox)\n}\n<p>ok</>',
    ), "gap-names-decl");
    expect(gaps.length).toBe(1);
    expect(gaps[0].message).toContain("inventoryBox");
    // It must steer to BOTH exits — prove it, or sign for it.
    expect(gaps[0].message).toContain("asIs");
  });

  test("one warning per unproven declaration — the gap is COUNTED, not deduped away", () => {
    const { gaps } = compileSrc(P(
      '${\n  fn a() {\n    return 1\n  }\n  let x = a()\n  let y = a()\n  let z = a()\n  print(x)\n  print(y)\n  print(z)\n}\n<p>ok</>',
    ), "gap-counted");
    expect(gaps.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. CONTROLS — what must stay silent stays silent
// ---------------------------------------------------------------------------

describe("S365 — inference that SUCCEEDS stays silent", () => {

  const SILENT_CASES = [
    ["number literal", "let n = 5\n  print(n)"],
    ["string literal", 'let s = "hi"\n  print(s)'],
    ["negative number literal", "let n = -42\n  print(n)"],
    ["annotated primitive", "let n: number = 5\n  print(n)"],
  ];

  for (const [label, body] of SILENT_CASES) {
    test(`${label} — no gap warning`, () => {
      const { gaps, errors } = compileSrc(P(`\${\n  ${body}\n}\n<p>ok</>`), `silent-${label.replace(/\W+/g, "-")}`);
      expect(gaps.length).toBe(0);
      expect(errors.map(e => e.code)).toEqual([]);
    });
  }

  test("a `?{ … }` SQL initializer is carved out — W-SQL-ROW-UNTYPED owns that path", () => {
    // The projection typer already has a graceful-degrade diagnostic. Two codes
    // for one condition is noise, and the SQL one is more specific.
    const { gaps, codes } = compileSrc(
      '<program db="sqlite:./s365.db">\n' +
      '  <schema>\n    <table name="t">\n      <column name="id" type="integer" pk/>\n    </table>\n  </schema>\n' +
      '  ${\n    const rows = ?{ SELECT * FROM t }.all()\n    print(rows.length)\n  }\n' +
      '  <p>ok</>\n</program>\n',
      "sql-carveout",
    );
    // NON-VACUITY GUARD. Asserting only `gaps.length === 0` would also pass if
    // this fixture silently stopped exercising the SQL path at all. The
    // projection typer's own degrade warning proves the row really is untyped
    // here — which is exactly the condition the gap warning would otherwise
    // double-report.
    expect(codes).toContain("W-SQL-ROW-UNTYPED");
    expect(gaps.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. NO REGRESSION — the diagnostics that depended on the old collapse
// ---------------------------------------------------------------------------

describe("S365 — the split buys no regression", () => {

  test("E-TYPE-025 still fires on an un-annotated match subject (§18.8.2)", () => {
    // BEFORE the split this fired because `let p = powerUp` resolved to `asIs`.
    // After the split it resolves to `unknown`. An unproven subject is exactly
    // as un-narrowed as a hatched one, so the code must keep firing — otherwise
    // the split would have silently retired a real diagnostic.
    const { errorCodes } = compileSrc(P(
      "${\n  type PowerUp:enum = { Mushroom(n: number), Flower(n: number) }\n" +
      "  function eat(powerUp) {\n    let p = powerUp\n    match p {\n" +
      '      .Mushroom(n) :> print(n)\n      .Flower(n) :> print(n)\n    }\n  }\n}\n<p>ok</>',
    ), "no-regress-e-type-025");
    expect(errorCodes).toContain("E-TYPE-025");
  });

  test("E-TYPE-031 fire behaviour is untouched (call 5 is HELD; rung 0 changes no severity)", () => {
    const mismatch = compileSrc(P('${\n  let n: number = "nope"\n  print(n)\n}\n<p>ok</>'), "e031-fires");
    expect(mismatch.errorCodes).toContain("E-TYPE-031");

    const ok = compileSrc(P("${\n  let n: number = 5\n  print(n)\n}\n<p>ok</>"), "e031-silent");
    expect(ok.errorCodes).not.toContain("E-TYPE-031");
  });

  test("E-CG-001 still fires for a genuine internal `unknown` — the codegen gate was NARROWED, not deleted", () => {
    // The reason-aware gate exempts ONLY `source: "inference-gap"`. Asserted at
    // the predicate rather than through a whole compile, because manufacturing a
    // leaked internal sentinel through the front end is not reproducible from
    // source — that is what makes it an internal-defect marker.
    const exempt = { kind: "unknown", reason: { source: "inference-gap", gap: { nodeKind: "call", detail: "call result" } } };
    const notExempt = { kind: "unknown", reason: { source: "not-a-node" } };
    const forwardRef = { kind: "unknown", reason: { source: "forward-ref", typeName: "T" } };

    const fires = (t) => t && t.kind === "unknown" && t.reason?.source !== "inference-gap";
    expect(fires(exempt)).toBe(false);
    expect(fires(notExempt)).toBe(true);
    expect(fires(forwardRef)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. THE FIX ROUND — what the adversarial pass found, pinned so it stays fixed
// ---------------------------------------------------------------------------

describe("S365 fix round — the `_={ … }=` foreign carve-out (§7.5.2), which had no test", () => {

  // The branch shipped a test for the `?{ }` SQL carve-out and none for `_{ }`,
  // and the un-tested one turned out to be the conditional one.
  const FOREIGN_IN_FN = `<program lang="ts">
  export function readIt(path: string) {
    const out = _={ in: { path }
      await Bun.file(path).text()
    }=
    return out
  }
</program>
`;

  test("a `_={ … }=` initializer inside a FUNCTION BODY is carved out — writing `_{ }` IS the signature", () => {
    const { gaps, errors } = compileSrc(FOREIGN_IN_FN, "foreign-carveout-fn");
    expect(gaps.length).toBe(0);
    expect(errors.map(e => e.code)).toEqual([]);
  });

  test("NON-VACUITY — the same fixture really does carry a foreign slice (the carve-out is doing work)", () => {
    // Without this, the assertion above would also pass if the fixture stopped
    // parsing as foreign code at all — the failure mode that let the untested
    // carve-out ship. Proven structurally: the decl carries the `foreignNode`
    // sidecar the carve-out keys on.
    const { ast } = buildAST(splitBlocks("foreign-carveout.scrml", FOREIGN_IN_FN));
    let found = false;
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if ((n.kind === "const-decl" || n.kind === "let-decl") && n.foreignNode?.kind === "foreign") found = true;
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    })(ast);
    expect(found).toBe(true);
  });

  test("BOUNDARY — at bare logic-statement scope the slice is NOT attached, and the text says so (§7.5.2 ⚑)", () => {
    // The SPEC's carve-out was unconditional in text and conditional in code.
    // Resolved on the TEXT side, not the guard: at bare logic-statement scope
    // `_={ … }=` is not admitted at all — it does not lower, and
    // E-CODEGEN-INVALID-LOGIC is the governing diagnostic. Widening the guard
    // would have to key on the generic `escape-hatch` node, which also carries
    // regex literals and parse failures, manufacturing silence where nobody
    // signed. This test pins the boundary so that if §23.2.2 later ADMITS the
    // shape here, this test fails and the SPEC text gets re-widened with it.
    //
    // ⚑ COMPILED WITH `write: true` ON PURPOSE. E-CODEGEN-INVALID-LOGIC is raised
    // by the EMIT pass, so a `write: false` compile of this same source reports
    // an empty error list — the shape looks clean right up until it is asked to
    // produce output. Measured, not assumed: `write: false` -> [], `write: true`
    // -> ["E-CODEGEN-INVALID-LOGIC"].
    const { gaps, errorCodes } = compileSrcEmitting(
      '<program lang="ts">\n' +
      '  ${\n' +
      '    const path = "/etc/hostname"\n' +
      '    const out = _={ in: { path }\n      await Bun.file(path).text()\n    }=\n' +
      '    print(out)\n  }\n' +
      '  <p>ok</>\n</program>\n',
      "foreign-boundary-logic",
    );
    expect(errorCodes).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(gaps.length).toBe(1);
    // And when it DOES reach the diagnostic, it is named for what it is.
    expect(gaps[0].message).toContain("foreign-code escape hatch");
  });
});

describe("S365 fix round — the warning names the construct the adopter actually wrote", () => {

  test("a regex literal is a REGEX literal, not an \"escape hatch\" the adopter never wrote", () => {
    // `escape-hatch` is the parser's catch-all, not a synonym for `_{ }`. Every
    // sampled `escape-hatch` gap in the corpus was `const re = /ab+c/g`, reported
    // as "inference stopped at foreign-code escape hatch". That told an adopter
    // they had written a construct that is not in their file.
    const { gaps } = compileSrc(P('${\n  const re = /ab+c/g\n  print(re)\n}\n<p>ok</>'), "regex-detail");
    expect(gaps.length).toBe(1);
    expect(gapKind(gaps[0])).toBe("escape-hatch");
    expect(gaps[0].message).toContain("regular-expression literal");
    expect(gaps[0].message).not.toContain("foreign-code escape hatch");
  });

  test("a destructuring declaration is named `{ a, b }`, not `[object Object]`", () => {
    // `name` is `string | DestructurePattern`; reading it as a string rendered
    // `[object Object]` for 122 of the 9,954 warnings at introduction (1.2%).
    // A warning whose only two resolutions are "annotate THAT declaration" is
    // worth nothing if it cannot say which declaration.
    const { gaps } = compileSrc(P(
      '${\n  fn someObj() {\n    return 1\n  }\n  const { a, b } = someObj()\n  print(a)\n  print(b)\n}\n<p>ok</>',
    ), "destructure-name");
    expect(gaps.length).toBe(1);
    expect(gaps[0].message).toContain("{ a, b }");
    expect(gaps[0].message).not.toContain("[object Object]");
  });

  test("an array destructuring declaration is named `[first, second]`", () => {
    const { gaps } = compileSrc(P(
      '${\n  fn someList() {\n    return 1\n  }\n  const [first, second] = someList()\n  print(first)\n  print(second)\n}\n<p>ok</>',
    ), "destructure-array-name");
    expect(gaps.length).toBe(1);
    expect(gaps[0].message).toContain("[first, second]");
    expect(gaps[0].message).not.toContain("[object Object]");
  });
});

describe("S365 fix round — the OPEN positions, pinned as open (rungs 1-3)", () => {

  test("⚑ an un-annotated function PARAMETER still binds `asIs` — the §7.5.2 refutation, pinned", () => {
    // This is the six-line program that refuted the branch's original headline
    // SHALL ("Type inference SHALL NOT produce `asIs`"). Nobody signed for the
    // `asIs` on `powerUp`; the compiler put it there, and then blamed the author
    // for a hatch that is not in the source.
    //
    // It is pinned as an OPEN gap on purpose. When rung 1 closes the parameter
    // position, this test FAILS — and that failure is the rung's proof, exactly
    // as the gap-case tests in section 3 are.
    const { errorCodes } = compileSrc(P(
      '${\n  function eat(powerUp) {\n    match powerUp {\n      .Mushroom(n) :> n\n      .Star        :> 0\n    }\n  }\n}\n<p>ok</>',
    ), "open-param-asis");
    expect(errorCodes).toContain("E-TYPE-025");
  });

  test("⚑ a `match`-as-expression initializer is NOT reached by the guard — silent `asIs` survives", () => {
    // ~60 corpus sites. `match`- and `if`-as-expression initializers land in the
    // decl's `matchExpr` / `ifExpr` sidecar rather than in `initExpr`, so the
    // guard's `initExpr` precondition skips them entirely and a defeated
    // inference still produces a SILENT `asIs`. `inferExprType`'s
    // `case "match-expr"` arm is therefore unreachable from its only production
    // call site. Deliberately NOT fixed in this round (scoped out); pinned so it
    // cannot be forgotten and so the fix flips a red test green.
    const { gaps, errors } = compileSrc(P(
      '${\n  let x = 1\n  const r = match x {\n    1 => 10\n    else => 20\n  }\n  print(r)\n}\n<p>ok</>',
    ), "open-matchexpr-sidecar");
    expect(errors.map(e => e.code)).toEqual([]);
    expect(gaps.length).toBe(0);   // ⚑ FLIP TO >0 WHEN THE SIDECAR POSITION IS WIRED
  });
});
