/**
 * §18.5 block-arm value lowering — the keyword-PREFIX boundary (S328).
 *
 * PR #447 introduced `_blockTailIsValueExpr` (emit-logic.ts), the predicate that
 * decides whether a block arm's LAST segment is the arm's result expression or a
 * statement. Its statement-head guard was:
 *
 *     /^(const|let|var|return|if|for|while|do|switch|lift|throw|fail|on\b)/
 *
 * The `\b` sat INSIDE the alternation, so it fenced only `on`. Every other
 * keyword matched as a bare PREFIX, so a tail expression whose identifier merely
 * BEGINS with a keyword's letters was misclassified as a statement:
 *
 *     formatted -> for      doc / document / domNode -> do     letter -> let
 *     constant  -> const    returnValue -> return               iface  -> if
 *     lifted    -> lift     failCount -> fail                   varName -> var
 *
 * A misclassified tail is never lifted, so the enclosing result var keeps its
 * `null` seed and the arm silently produces the wrong value. This is a LOUD ->
 * SILENT regression: before #447 the same source failed the compile.
 *
 * SPEC §18.5 (governing): "A block arm is `{ statement* expression? }`. The
 * block's result is its **last expression**." and "A block arm body's result type
 * SHALL be the type of its last expression."
 *
 * The predicate has TWO consumers and both are exercised here:
 *   - `_emitBlockArmValueFromString` (raw / literal-arm path)
 *   - the structured (variant) arm tail check in `emitMatchExprDecl`
 *
 * #447's own two conformance cases used tails named `base` / `b`, which dodge the
 * bug entirely — which is exactly why it shipped. Every identifier below is
 * keyword-prefixed on purpose.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `mbkt-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_mbkt_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), validateEmit: true });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

// W-/I- codes partition into result.warnings; anything on the error stream with a
// code is a hard error.
const hardErrors = (r) => (r.errors ?? []).filter((e) => e && e.code !== undefined);

/**
 * The DEAD-LET symptom of the structured-arm path: the tail was handed to the
 * shared bare-expr handler, which minted a FRESH `let _scrml_tilde_N = <tail>`
 * that nobody reads, while the arm's real result var stayed null.
 */
const deadLetFor = (ident) => new RegExp(`let\\s+_scrml_tilde_\\d+\\s*=\\s*${ident}\\b`);

/** The CORRECT lowering: the tail assigns to an ALREADY-DECLARED result var. */
const liftAssignFor = (rhs) => new RegExp(`(?<!let\\s)_scrml_tilde_\\d+ = ${rhs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`);

// Every keyword in the guard's alternation, paired with a realistic identifier
// that merely BEGINS with it. `on` is included deliberately: it is the one
// keyword that already carried a boundary, so it pins the fix as INERT there.
const KEYWORD_PREFIXED_IDENTIFIERS = [
  ["const", "constant"],
  ["let", "letter"],
  ["var", "varName"],
  ["return", "returnValue"],
  ["if", "iface"],
  ["for", "formatted"],
  ["while", "whileLoop"],
  ["do", "document"],
  ["switch", "switchState"],
  ["lift", "lifted"],
  ["fail", "failCount"],
  ["on", "online"],
];

describe("§18.5 — a keyword-PREFIXED block tail is an expression, not a statement head", () => {
  describe("raw / literal-arm path", () => {
    for (const [keyword, ident] of KEYWORD_PREFIXED_IDENTIFIERS) {
      test(`\`${ident}\` (prefix \`${keyword}\`) lifts to the arm result var`, () => {
        const r = compileSource(`fn pick(k: int) -> string {
    const res = match k {
        1 :> { const ${ident} = "hit"; ${ident} + "!" }
        _ :> "miss"
    }
    return res
}
<page><main>
<p id="out">\${ pick(1) }</p>
</main></page>
`, `raw${keyword}`);
        expect(hardErrors(r)).toEqual([]);
        expect(r.clientJs).toMatch(liftAssignFor(`${ident} + "!"`));
        // Pre-fix the tail was emitted as a bare, value-discarding statement.
        expect(r.clientJs).not.toMatch(new RegExp(`^\\s*${ident} \\+ "!";\\s*$`, "m"));
      });
    }
  });

  describe("structured / variant-arm path", () => {
    for (const [keyword, ident] of KEYWORD_PREFIXED_IDENTIFIERS) {
      test(`\`${ident}\` (prefix \`${keyword}\`) lifts to the arm result var`, () => {
        const r = compileSource(`type Tier:enum = { Low, High }
fn tint(t: Tier) -> string {
    const res = match t {
        .Low  :> { const ${ident} = "hit"; ${ident} + "!" }
        .High :> { "other" }
    }
    return res
}
<page><main>
<p id="out">\${ tint(Tier.Low) }</p>
</main></page>
`, `var${keyword}`);
        expect(hardErrors(r)).toEqual([]);
        expect(r.clientJs).toMatch(liftAssignFor(`${ident} + "!"`));
        // Pre-fix symptom: a fresh `let _scrml_tilde_N = …` nobody reads.
        expect(r.clientJs).not.toMatch(deadLetFor(ident));
      });
    }
  });
});

describe("§18.5 — the guard still fences REAL statement heads (no widening)", () => {
  // The fix strictly SHRINKS the set of tails classified as statements, so the
  // load-bearing non-regression is that genuine statements are still statements.
  const VOID_TAILS = [
    ["a local reassignment", `let acc = "x"; acc = "y"`],
    ["a trailing const decl", `const first = "x"; const second = first`],
    ["a `let` keyword head with a following space", `const seed = 1; let later = seed`],
  ];

  for (const [label, body] of VOID_TAILS) {
    test(`${label} leaves the arm void (result var keeps its null seed)`, () => {
      const r = compileSource(`fn pick(k: int) -> string {
    const res = match k {
        1 :> { ${body} }
        _ :> "miss"
    }
    return res
}
<page><main>
<p id="out">\${ pick(1) }</p>
</main></page>
`, `void${label.replace(/[^a-z]/gi, "")}`);
      expect(hardErrors(r)).toEqual([]);
      // The arm's `1` branch must NOT assign the tail to the result var.
      const armBody = /=== 1\) \{([\s\S]*?)\n  \}/.exec(r.clientJs ?? "");
      expect(armBody).not.toBeNull();
      expect(armBody[1]).not.toMatch(/_scrml_tilde_\d+ =/);
    });
  }

  test("a real `on` statement head is still NOT a value tail", () => {
    // `on` is the one keyword whose boundary already worked. Moving the `\b` out
    // of the group must leave it byte-identical: `online` lifts (above), a bare
    // `on <target>` head does not.
    const r = compileSource(`fn pick(k: int) -> string {
    const res = match k {
        1 :> { const online = "a"; online }
        _ :> "miss"
    }
    return res
}
<page><main>
<p id="out">\${ pick(1) }</p>
</main></page>
`, "onboundary");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toMatch(liftAssignFor("online"));
  });
});
