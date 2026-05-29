/**
 * Bug 1 (S95) — value-return `match expr { .Variant(payload) => expr, _ => default }`
 *
 * Regression tests for the JS-style value-return match expression in
 * expression position (e.g. `return match @x { ... }`). Prior to the fix,
 * the emitter shim in emit-expr.ts:emitMatchExpr reconstructed the match as
 * a string and ran rewriteExpr (legacy string pipeline), which had no
 * payload-binding lowering and dropped `_ =>` wildcard arms.
 *
 * The fix routes MatchExpr { subject, rawArms } through the structured
 * emitter in emit-control-flow.ts:emitMatchExpr, which:
 *   - Destructures payload bindings: `.Variant(d)` → `const d = _scrml_match_N.data.<field>`.
 *   - Lowers `_ =>` (and `else =>`) wildcard arms to a clean `else` branch.
 *
 * These tests cover ALL FOUR arm-pattern shapes per the brief:
 *   1. `.Variant`              — unit, no binding
 *   2. `.Variant(x)`           — single positional binding
 *   3. `.Variant(x, y)`        — multi-positional binding
 *   4. `_` / `else`            — wildcard catch-all
 *
 * Plus a mixed-arms case and a brief-reproducer end-to-end compile test.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { emitMatchExpr, setVariantFieldsForFile, parseMatchArm, splitMultiArmString } from "../../src/codegen/emit-control-flow.js";
import { rewriteMatchExpr } from "../../src/codegen/rewrite.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// Direct emitter tests — feed bare-expr arm strings (the shape produced by
// the emit-expr.ts bridge for expression-position match-expr nodes).
// ---------------------------------------------------------------------------

describe("Bug 1 — JS-style `_ => expr` wildcard arm (parseMatchArm + splitMultiArmString)", () => {
  it("recognises `_ =>` as wildcard arm (parity with `else =>`)", () => {
    const node = {
      header: "phase",
      body: [
        { kind: "bare-expr", expr: ".Idle => 0" },
        { kind: "bare-expr", expr: "_ => 1" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Idle") return 0');
    expect(result).toContain("else return 1");
    // Negative: _ must NOT leak verbatim into output
    expect(result).not.toContain("_ => 1");
  });

  it("recognises `_ :>` as wildcard arm (narrows-to alias)", () => {
    const node = {
      header: "phase",
      body: [
        { kind: "bare-expr", expr: ".Idle :> 0" },
        { kind: "bare-expr", expr: "_ :> 1" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Idle") return 0');
    expect(result).toContain("else return 1");
  });

  it("splits concatenated `.V(d) => expr _ => default` arm string at the `_` boundary", () => {
    // Simulates the shape produced by expression-position parsing when the
    // expression-parser's splitMatchArms misses an `_` arm boundary and merges
    // two arms into one rawArms entry.
    const node = {
      header: "phase",
      body: [
        { kind: "bare-expr", expr: ".Dragging(d) => d == targetId _ => false" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('=== "Dragging"');
    expect(result).toContain("else return false");
    // Negative: _ => false must NOT leak into the .Dragging arm result
    expect(result).not.toMatch(/d == targetId _ => false/);
  });
});

// ---------------------------------------------------------------------------
// All four arm-pattern shapes per the brief
// ---------------------------------------------------------------------------

describe("Bug 1 — four arm-pattern shapes", () => {
  it("Shape 1: `.Variant` unit (no binding) — all variants emit string-tag comparison", () => {
    const node = {
      header: "p",
      body: [
        { kind: "bare-expr", expr: ".Idle => 0" },
        { kind: "bare-expr", expr: ".Dragging => 1" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Idle") return 0');
    expect(result).toContain('else if (_scrml_match_1 === "Dragging") return 1');
    // No payload destructure for unit variants
    expect(result).not.toContain(".data.");
  });

  it("Shape 2: `.Variant(x)` single positional binding — destructures from .data.<field>", () => {
    setVariantFieldsForFile(
      new Map([["Dragging", ["id"]]]),
      new Set(),
    );
    try {
      const node = {
        header: "p",
        body: [
          { kind: "bare-expr", expr: ".Dragging(d) => d" },
          { kind: "bare-expr", expr: "_ => 0" },
        ],
      };
      const result = emitMatchExpr(node);
      expect(result).toMatch(/const d = _scrml_match_\d+\.data\.id;/);
      expect(result).toContain("else return 0");
    } finally {
      setVariantFieldsForFile(null, null);
    }
  });

  it("Shape 3: `.Variant(x, y)` multi-positional binding — destructures both fields", () => {
    setVariantFieldsForFile(
      new Map([["Dragging2", ["id", "kind"]]]),
      new Set(),
    );
    try {
      const node = {
        header: "p",
        body: [
          { kind: "bare-expr", expr: ".Dragging2(d, k) => k" },
          { kind: "bare-expr", expr: "_ => \"none\"" },
        ],
      };
      const result = emitMatchExpr(node);
      expect(result).toMatch(/const d = _scrml_match_\d+\.data\.id;/);
      expect(result).toMatch(/const k = _scrml_match_\d+\.data\.kind;/);
      expect(result).toContain('else return "none"');
    } finally {
      setVariantFieldsForFile(null, null);
    }
  });

  it("Shape 4: `_` / `else` wildcard-only — clean else branch", () => {
    const node = {
      header: "p",
      body: [
        { kind: "bare-expr", expr: ".Idle => 0" },
        { kind: "bare-expr", expr: "_ => 1" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain("else return 1");
    expect(result).not.toContain("_ =>");
  });

  it("Mixed: variant with payload + variant unit + wildcard — all three coexist", () => {
    setVariantFieldsForFile(
      new Map([["Dragging", ["id"]]]),
      new Set(),
    );
    try {
      const node = {
        header: "p",
        body: [
          { kind: "bare-expr", expr: '.Dragging(d) => "drag-" + d' },
          { kind: "bare-expr", expr: '.Idle => "idle"' },
          { kind: "bare-expr", expr: '_ => "none"' },
        ],
      };
      const result = emitMatchExpr(node);
      expect(result).toMatch(/const d = _scrml_match_\d+\.data\.id;/);
      expect(result).toContain('return "drag-" + d');
      expect(result).toMatch(/=== "Idle"\) return "idle"/);
      expect(result).toContain('else return "none"');
    } finally {
      setVariantFieldsForFile(null, null);
    }
  });
});

// ---------------------------------------------------------------------------
// Low-level splitter / parser parity tests
// ---------------------------------------------------------------------------

describe("Bug 1 — parseMatchArm recognises `_ =>` / `_ :>`", () => {
  it("parses `_ => expr` as wildcard arm", () => {
    const arm = parseMatchArm("_ => false");
    expect(arm).not.toBeNull();
    expect(arm.kind).toBe("wildcard");
    expect(arm.result).toBe("false");
  });

  it("parses `_ :> expr` as wildcard arm (narrows-to alias)", () => {
    const arm = parseMatchArm("_ :> 42");
    expect(arm).not.toBeNull();
    expect(arm.kind).toBe("wildcard");
    expect(arm.result).toBe("42");
  });

  it("still parses legacy `_ -> expr` form", () => {
    const arm = parseMatchArm("_ -> null");
    expect(arm).not.toBeNull();
    expect(arm.kind).toBe("wildcard");
  });
});

describe("Bug 1 — splitMultiArmString boundary detection at `_` token", () => {
  it("splits `.V(b) => a _ => b` into two arms", () => {
    const parts = splitMultiArmString(".Dragging(d) => d _ => false");
    expect(parts.length).toBe(2);
    expect(parts[0].startsWith(".Dragging")).toBe(true);
    expect(parts[1].startsWith("_")).toBe(true);
  });

  it("does NOT split `foo_` (identifier-suffix _)", () => {
    // `foo_` is not a wildcard arm — the `_` is part of the identifier.
    const parts = splitMultiArmString(".A => foo_ + 1");
    expect(parts.length).toBe(1);
  });

  it("does NOT split bare `_var_name` (identifier starting with _)", () => {
    // `_var_name` starts with `_` but is NOT followed by `=> / :> / ->` — it's
    // an identifier, not an arm start.
    const parts = splitMultiArmString(".A => _hidden + 1");
    expect(parts.length).toBe(1);
  });
});

describe("Bug 1 — rewriteMatchExpr (legacy string pipeline) parity for `_ =>`", () => {
  it("emits `else return` for `_ => expr` arm", () => {
    const out = rewriteMatchExpr(`match x { .A => 1 _ => 2 }`);
    expect(out).toContain("else return 2");
    // _ must not leak verbatim
    expect(out).not.toMatch(/_ => 2/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end compile test — uses compileScrml to verify the full pipeline
// (ast-builder + expression-parser + emit-expr.ts:emitMatchExpr bridge +
// structured emitter) produces correct JS for the brief's reproducer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// C2 (R27) — value-return match with `->` arms (the §18.2 canonical alias).
// The `->` separator is tokenized as two PUNCT tokens (`-` `>`) and rejoined
// with a space in default-logic mode (`.Idle - > "Idle"`). Previously the
// arm-parser only accepted `=>` / `:>`, so `->` arms were dropped and
// emitMatchExpr emitted a "could not be compiled" stub (invalid JS at exit-0).
// Now `->` lowers IDENTICALLY to `=>` (SPEC §18.2: `->` is a legal alias;
// canonical is `=>`).
// ---------------------------------------------------------------------------

describe("C2 (R27) — `->` value-return match arm alias", () => {
  it("parseMatchArm accepts canonical `.Variant -> result`", () => {
    const arm = parseMatchArm('.Idle -> "Idle"');
    expect(arm).not.toBeNull();
    expect(arm.kind).toBe("variant");
    expect(arm.test).toBe("Idle");
    expect(arm.result).toBe('"Idle"');
  });

  it("parseMatchArm repairs the rejoin-spaced `- >` arrow", () => {
    const arm = parseMatchArm('. Idle - > "Idle"');
    expect(arm).not.toBeNull();
    expect(arm.kind).toBe("variant");
    expect(arm.test).toBe("Idle");
    expect(arm.result).toBe('"Idle"');
  });

  it("emitMatchExpr lowers `->` arms to a valid if/else IIFE (no stub)", () => {
    const node = {
      header: "phase",
      body: [
        { kind: "bare-expr", expr: '. Idle - > "Idle"' },
        { kind: "bare-expr", expr: '. Busy - > "Busy"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).not.toContain("could not be compiled");
    expect(result).toContain('if (_scrml_match_1 === "Idle") return "Idle"');
    expect(result).toContain('else if (_scrml_match_1 === "Busy") return "Busy"');
  });

  it("`->` and `=>` arms emit identical bodies", () => {
    const arrowNode = (sep) => ({
      header: "phase",
      body: [
        { kind: "bare-expr", expr: `.Idle ${sep} "Idle"` },
        { kind: "bare-expr", expr: `.Busy ${sep} "Busy"` },
      ],
    });
    resetVarCounter();
    const withArrow = emitMatchExpr(arrowNode("->"));
    resetVarCounter();
    const withFat = emitMatchExpr(arrowNode("=>"));
    expect(withArrow).toBe(withFat);
  });
});

describe("Bug 1 — end-to-end reproducer from brief", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bug-1-s95-"));
  });

  function compile(src) {
    const srcPath = join(tmpDir, "repro.scrml");
    const outDir = join(tmpDir, "dist");
    writeFileSync(srcPath, src);
    const result = compileScrml({
      inputFiles: [srcPath],
      outputDir: outDir,
      log: () => {},
    });
    const outPath = join(outDir, "repro.client.js");
    let out = "";
    try { out = readFileSync(outPath, "utf8"); } catch {}
    return { result, out };
  }

  it("brief reproducer compiles + emits valid JS with payload binding + else branch", () => {
    const src = `<program title="Bug 1 Repro">
    type DragPhase:enum = {
        Idle
        Dragging(id: number)
    }

    <dragPhase>: DragPhase = .Idle

    function isDraggingThis(targetId) {
        return match @dragPhase {
            .Dragging(d) => d == targetId
            _ => false
        }
    }

    <button onclick=isDraggingThis(1)>test</>
</program>
`;
    const { out } = compile(src);
    // Sanity: the bug's signature lines are GONE
    expect(out).not.toMatch(/else return d === targetId _ => false/);
    expect(out).not.toMatch(/_ => false;/);
    // Positive shape: payload binding correctly destructured
    expect(out).toMatch(/const d = _scrml_match_\d+\.data\.id;/);
    // Positive shape: wildcard arm correctly lowered
    expect(out).toMatch(/else return false;/);
    // Output parses as JS (the bug was a SyntaxError).
    // Use Function constructor to validate parse (stub globals first).
    expect(() => {
      new Function(
        "_scrml_reactive_get",
        "_scrml_reactive_set",
        "_scrml_init_set",
        "document",
        out.replace(/^\/\/ Requires:.*\n/, ""),
      );
    }).not.toThrow();
  });

  it("C2 (R27) — value-return `const <label> = match @phase { .Idle -> ... }` compiles to valid JS", () => {
    const src = `<program>
\${ type Phase:enum = { Idle, Busy } }
<phase>: Phase = .Idle
const <label> = match @phase {
  .Idle -> "Idle"
  .Busy -> "Busy"
}
<p>\${@label}</p>
</program>
`;
    const { out } = compile(src);
    // The silent-stub signature must be GONE.
    expect(out).not.toContain("could not be compiled");
    // The derived label must lower to the if/else IIFE (same as `=>`).
    expect(out).toMatch(/if \(_scrml_match_\d+ === "Idle"\) return "Idle";/);
    expect(out).toMatch(/else if \(_scrml_match_\d+ === "Busy"\) return "Busy";/);
    // Output parses as JS (the bug was a SyntaxError: stray `;)`).
    expect(() => {
      new Function(
        "_scrml_reactive_get",
        "_scrml_reactive_set",
        "_scrml_init_set",
        "_scrml_derived_declare",
        "_scrml_derived_subscribe",
        "_scrml_derived_get",
        "document",
        out.replace(/^\/\/ Requires:.*\n/, ""),
      );
    }).not.toThrow();
  });
});
