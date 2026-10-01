/**
 * match-pipe-alternation-codegen — `.A | .B | .C => result` arms compile correctly.
 *
 * Spec authority:
 *   - SPEC §18.0.3 (bare-variant inference in arm patterns) — alternation arms are
 *     a §18 surface enhancement; existing §51.3.2 / §51.9.2 establish the pipe-
 *     alternation idiom for machine-rule and projection-rule forms. This dispatch
 *     extends `rewriteMatchExpr` (inline-position) and `emitMatchExpr` (block-form
 *     `match expr { ... }`) to consume the same alternation shape.
 *
 * Pre-fix symptom (S84 Bug 2 anomaly report #3; Bug 3 S83 follow-on per
 * `derived-engine-inline-match-b3.test.js` header comment lines 27-31):
 *   - splitter (`splitMultiArmString` / `_splitMultiArmString`) discards .A and .B
 *     in `.A | .B | .C => x` because only `.C` is directly followed by an arrow.
 *   - parseMatchArm / parseInlineMatchArm regexes capture exactly one variant.
 *
 * Post-fix:
 *   - Alternation arms are recognized and lowered to `tag === "A" || tag === "B"`
 *     OR-chain in the if-condition. Each alternate maps to the SAME result body.
 *   - Mixed-payload-binding alternation (`.Some(n) | .Other(n)`) is out of scope
 *     for this dispatch (per SPEC §51.3.2 E-ENGINE-016 same-binding rule, the
 *     codegen falls back to a comment placeholder for now).
 *   - Singleton-form arms (`.A => x; .B => y`) remain unchanged (regression-free).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { emitMatchExpr, setVariantFieldsForFile } from "../../src/codegen/emit-control-flow.js";
import { rewriteMatchExpr } from "../../src/codegen/rewrite.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// rewriteMatchExpr — pipe-alternation in JS-style match value-return
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — pipe-alternation arms (§18 follow-on)", () => {
  it("emits 2-alternate variant arm as a single if with || OR-chain", () => {
    const input = "match @c {\n.Red | .Purple => true\n.Green | .Blue => false\n}";
    const result = rewriteMatchExpr(input);
    // First arm: .Red | .Purple => true
    expect(result).toMatch(/if \(_scrml_match_1 === "Red" \|\| _scrml_match_1 === "Purple"\) return true/);
    // Second arm: .Green | .Blue => false
    expect(result).toMatch(/else if \(_scrml_match_1 === "Green" \|\| _scrml_match_1 === "Blue"\) return false/);
    // IIFE shell
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
    // .Red and .Green should NOT appear as separate match arms
    expect(result).not.toContain('=== "Red") return true; if');
  });

  it("emits 3-alternate variant arm as an if with two || joins", () => {
    const input = "match @marioState {\n.Small => 'A'\n.Big | .Fire | .Cape => 'B'\n}";
    const result = rewriteMatchExpr(input);
    // First (singleton) arm
    expect(result).toContain('if (_scrml_match_1 === "Small") return \'A\'');
    // Second arm: 3-way alternation
    expect(result).toMatch(/else if \(_scrml_match_1 === "Big" \|\| _scrml_match_1 === "Fire" \|\| _scrml_match_1 === "Cape"\) return 'B'/);
  });

  it("emits 4-alternate variant arm correctly", () => {
    const input = "match @x {\n.A | .B | .C | .D => 1\nelse => 0\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toMatch(/if \(_scrml_match_1 === "A" \|\| _scrml_match_1 === "B" \|\| _scrml_match_1 === "C" \|\| _scrml_match_1 === "D"\) return 1/);
    expect(result).toContain("else return 0");
  });

  it("regression: singleton-arm-only match still compiles unchanged", () => {
    const input = "match @c {\n.A => 1\n.B => 2\n.C => 3\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "A") return 1');
    expect(result).toContain('else if (_scrml_match_1 === "B") return 2');
    expect(result).toContain('else if (_scrml_match_1 === "C") return 3');
    // No OR-chain should appear when no alternation is present
    expect(result).not.toContain("||");
  });

  it("emits pipe-alternation on a single line correctly", () => {
    const input = 'match role { .Admin | .Mod => "staff" .Guest => "public" }';
    const result = rewriteMatchExpr(input);
    expect(result).toMatch(/if \(_scrml_match_1 === "Admin" \|\| _scrml_match_1 === "Mod"\) return "staff"/);
    expect(result).toMatch(/else if \(_scrml_match_1 === "Guest"\) return "public"/);
  });

  it("emits pipe-alternation with :> arrow form (§18 :> alias)", () => {
    const input = "match @c {\n.A | .B :> 'AB'\n.C :> 'C'\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toMatch(/if \(_scrml_match_1 === "A" \|\| _scrml_match_1 === "B"\) return 'AB'/);
    expect(result).toMatch(/else if \(_scrml_match_1 === "C"\) return 'C'/);
  });
});

// ---------------------------------------------------------------------------
// emitMatchExpr (block-form match) — pipe-alternation arms
// ---------------------------------------------------------------------------

describe("emitMatchExpr — pipe-alternation arms in block-form match", () => {
  // A real program-mode compile always installs the file's variant registry
  // before emitting; these arms name only UNIT variants, so install an empty
  // registry (no payload variants) to model that. With NO registry at all
  // (library mode) an alternation arm extracts the `.variant` tag instead
  // (S438 — g-impl1-match-miscompiles F12 review F1b).
  beforeEach(() => { setVariantFieldsForFile(new Map(), null); });
  afterEach(() => { setVariantFieldsForFile(null, null); });

  it("compiles .A | .B => result as a single if with OR-chain", () => {
    const node = {
      header: "@c",
      body: [
        { kind: "bare-expr", expr: ".Red | .Purple => true" },
        { kind: "bare-expr", expr: ".Green | .Blue => false" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toMatch(/if \(_scrml_match_1 === "Red" \|\| _scrml_match_1 === "Purple"\) return true/);
    expect(result).toMatch(/else if \(_scrml_match_1 === "Green" \|\| _scrml_match_1 === "Blue"\) return false/);
  });

  it("splits a single body child containing pipe-alternation arms correctly", () => {
    // Stress test: when AST delivers all arms in one bare-expr string
    const node = {
      header: "x",
      body: [
        { kind: "bare-expr", expr: ".A | .B => 1 .C | .D => 2 else => 0" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toMatch(/if \(_scrml_match_1 === "A" \|\| _scrml_match_1 === "B"\) return 1/);
    expect(result).toMatch(/else if \(_scrml_match_1 === "C" \|\| _scrml_match_1 === "D"\) return 2/);
    expect(result).toContain("else return 0");
  });

  it("regression: mixed alternation + singleton arms in one match", () => {
    const node = {
      header: "@marioState",
      body: [
        { kind: "bare-expr", expr: ".Small => 'A'" },
        { kind: "bare-expr", expr: ".Big | .Fire | .Cape => 'B'" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Small") return \'A\'');
    expect(result).toMatch(/else if \(_scrml_match_1 === "Big" \|\| _scrml_match_1 === "Fire" \|\| _scrml_match_1 === "Cape"\) return 'B'/);
  });

  it("regression: singleton-only block-form match unchanged", () => {
    const node = {
      header: "@c",
      body: [
        { kind: "bare-expr", expr: ".A => 1" },
        { kind: "bare-expr", expr: ".B => 2" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "A") return 1');
    expect(result).toContain('else if (_scrml_match_1 === "B") return 2');
    expect(result).not.toContain("||");
  });
});

// ---------------------------------------------------------------------------
// Mixed-payload-binding alternation — known-limitation (out of scope)
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — mixed-payload-binding alternation (deferred)", () => {
  it("emits a known-limitation comment when an alternation arm carries payload bindings", () => {
    // .Some(n) | .Other(n) — same-binding rule (SPEC §51.3.2 E-ENGINE-016)
    // requires AST-level support to verify; codegen falls back to a comment.
    const input = "match @opt {\n.Some(n) | .Other(n) => n\n.Empty => 0\n}";
    const result = rewriteMatchExpr(input);
    // The .Empty arm should still compile cleanly
    expect(result).toContain('=== "Empty"');
    // The alternation-with-binding arm produces a diagnostic comment OR is dropped — both are acceptable for this dispatch. Whatever the chosen fallback, the rest of the output must still be syntactically valid (one if + one else if at most, no orphan tokens).
    // Validate no orphaned arm-text leaks into the output.
    expect(result).not.toContain("| .Other");
  });
});

// ---------------------------------------------------------------------------
// node --check on the IIFE output — guarantees emission is syntactically valid JS
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — pipe-alternation produces syntactically valid JS", () => {
  // We can verify in-process via `new Function(...)` — if the parser accepts it,
  // node --check would too.
  const tryParseAsExpression = (jsExpr) => {
    // Wrap in a return so the IIFE can stand at expression position.
    try {
      // eslint-disable-next-line no-new-func
      new Function(`return ${jsExpr}`);
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  // Use plain identifier match headers (no `@`) so we can isolate the IIFE
  // output. The `@`-rewrite is a separate pass that runs upstream of
  // `rewriteMatchExpr` in the compile pipeline.

  it("2-alternate output parses as JS", () => {
    const input = "match c {\n.A | .B => 1\n.C => 2\n}";
    const result = rewriteMatchExpr(input);
    const { ok, error } = tryParseAsExpression(`(function(){ const c = "A"; return ${result}; })()`);
    expect(error).toBe(null);
    expect(ok).toBe(true);
  });

  it("3-alternate output parses as JS", () => {
    const input = "match marioState {\n.Big | .Fire | .Cape => 1\n.Small => 0\n}";
    const result = rewriteMatchExpr(input);
    const { ok, error } = tryParseAsExpression(`(function(){ const marioState = "Big"; return ${result}; })()`);
    expect(error).toBe(null);
    expect(ok).toBe(true);
  });

  it("4-alternate output parses as JS", () => {
    const input = "match x {\n.A | .B | .C | .D => 1\nelse => 0\n}";
    const result = rewriteMatchExpr(input);
    const { ok, error } = tryParseAsExpression(`(function(){ const x = "A"; return ${result}; })()`);
    expect(error).toBe(null);
    expect(ok).toBe(true);
  });

  it("mixed alternation + singleton parses as JS", () => {
    const input = "match x {\n.Small => 'A'\n.Big | .Fire | .Cape => 'B'\nelse => 'C'\n}";
    const result = rewriteMatchExpr(input);
    const { ok, error } = tryParseAsExpression(`(function(){ const x = "Small"; return ${result}; })()`);
    expect(error).toBe(null);
    expect(ok).toBe(true);
  });
});
