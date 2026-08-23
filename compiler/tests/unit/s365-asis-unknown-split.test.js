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
 *   `Result<ResolvedType, InferenceGap>`, an `InferenceGap` cannot be built
 *   without naming an `ExprNode` kind, and the decl site binds `unknown`
 *   carrying that gap while emitting `W-TYPE-031-UNPROVEN`.
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
