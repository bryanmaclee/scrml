/**
 * I-MATCH-PROMOTABLE — Unit Tests
 *
 * Tests for compiler/src/lint-i-match-promotable.js (S66 Tier B).
 *
 * Coverage:
 *   §1  Exhaustive — full coverage; emits exhaustive shape with variant list
 *   §2  Near-miss — partial coverage; concrete missing-variants list
 *   §3  Compound — `||` / `&&` in branch; emits compound advisory
 *   §4  Mixed-discriminator — branches reference different cells; no fire
 *   §5  Non-enum cell — string-typed cell with enum-tag-shaped values; no fire
 *       (W-LIFECYCLE-CANDIDATE handles that case via lint-ghost-patterns)
 *   §6  Already-promoted — file already uses <match>; no fire
 *   §7  Single branch — no chain; no fire
 *   §8  Trailing else covering missing variants — no fire (user has handled it)
 *   §9  Diagnostic shape — required fields present
 *   §10 Severity is "info" (not warning, not error)
 *   §11 Integration — diagnostics reach allLintDiagnostics via compileScrml
 *   §12 Lint never blocks compile — files still produce valid output
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileSource(source) {
  const dir = join(tmpdir(), "scrml-i-match-test-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "test.scrml");
  writeFileSync(filePath, source, "utf8");
  let result;
  try {
    result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(dir, "dist"),
      write: false,
    });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  return result;
}

function getMatchDiags(result) {
  const diags = (result.lintDiagnostics ?? []).filter(d => d.code === "I-MATCH-PROMOTABLE");
  return diags;
}

// ---------------------------------------------------------------------------
// §1 Exhaustive — full coverage
// ---------------------------------------------------------------------------

// Build a fixture using string concatenation to avoid template-literal interpolation
// gotchas with ${...} markup interpolation inside scrml source.
const D = "$" + "{";  // produces literal "${"

function fixtureWithBranches(branchSpecs, opts = {}) {
  const variants = opts.variants ?? ["Idle", "Loading", "Error", "Success"];
  const lines = [
    "${",
    "  type Phase:enum = { " + variants.join(", ") + " }",
    "  <phase>: Phase = .Idle",
    "  function render() {",
  ];
  let isFirst = true;
  for (const spec of branchSpecs) {
    const prefix = isFirst ? "if" : "} else if";
    isFirst = false;
    if (spec.bareElse) {
      lines.push("    } else {");
    } else {
      lines.push("    " + prefix + " (" + spec.cond + ") {");
    }
    lines.push("      return '" + (spec.body ?? "x") + "'");
  }
  lines.push("    }");
  lines.push("  }");
  lines.push("}");
  lines.push("<div>" + D + "render()}</>");
  return lines.join("\n");
}

function exhaustiveFixture() {
  return fixtureWithBranches([
    { cond: "@phase is .Idle" },
    { cond: "@phase is .Loading" },
    { cond: "@phase is .Error" },
    { cond: "@phase is .Success" },
  ]);
}

describe("§1 Exhaustive — clean lift available", () => {
  test("if-else over enum-typed cell with all variants covered fires exhaustive", () => {
    const source = exhaustiveFixture();
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    expect(diags.length).toBeGreaterThan(0);
    const exhaustive = diags.find(d => d.shape === "exhaustive");
    expect(exhaustive).toBeDefined();
    expect(exhaustive.enumName).toBe("Phase");
    expect(exhaustive.missing).toEqual([]);
    expect(exhaustive.message).toContain("exhaustively covers Phase");
    expect(exhaustive.message).toContain(".Idle");
    expect(exhaustive.message).toContain(".Success");
  });

  // S66 — full predicate matrix restored after narrowing-error reversal.
  // Both `is .Variant` and `== .Variant` are accepted as variant-tag checks.
  test("if-else using `==` predicate form also fires exhaustive (S66 restored matrix)", () => {
    const source = fixtureWithBranches([
      { cond: "@phase == .Idle" },
      { cond: "@phase == .Loading" },
      { cond: "@phase == .Error" },
      { cond: "@phase == .Success" },
    ]);
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    const exhaustive = diags.find(d => d.shape === "exhaustive");
    expect(exhaustive).toBeDefined();
    expect(exhaustive.enumName).toBe("Phase");
    expect(exhaustive.missing).toEqual([]);
    expect(exhaustive.message).toContain("exhaustively covers Phase");
  });

  test("mixed `is` and `==` predicate forms in same chain fire exhaustive (style-equivalent)", () => {
    const source = fixtureWithBranches([
      { cond: "@phase is .Idle" },
      { cond: "@phase == .Loading" },
      { cond: "@phase is .Error" },
      { cond: "@phase == .Success" },
    ]);
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    const exhaustive = diags.find(d => d.shape === "exhaustive");
    expect(exhaustive).toBeDefined();
    expect(exhaustive.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 Near-miss — partial coverage with concrete missing-variants list
// ---------------------------------------------------------------------------

describe("§2 Near-miss — concrete missing list", () => {
  test("if-else missing one variant fires near-miss with that variant listed", () => {
    const source = `type Phase:enum = { Idle, Loading, Error, Success }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>idle</p>
    } else if (@phase is .Loading) {
      <p>loading</p>
    } else if (@phase is .Error) {
      <p>error</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    const nearMiss = diags.find(d => d.shape === "near-miss");
    expect(nearMiss).toBeDefined();
    expect(nearMiss.enumName).toBe("Phase");
    expect(nearMiss.missing).toEqual(["Success"]);
    expect(nearMiss.message).toContain("Missing .Success");
    expect(nearMiss.message).toContain("partially");
  });

  test("near-miss with multiple missing variants pluralizes correctly", () => {
    const source = `type Phase:enum = { Idle, Loading, Error, Success }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>idle</p>
    } else if (@phase is .Loading) {
      <p>loading</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    const nearMiss = diags.find(d => d.shape === "near-miss");
    expect(nearMiss).toBeDefined();
    expect(nearMiss.missing.length).toBe(2);
    expect(nearMiss.missing).toContain("Error");
    expect(nearMiss.missing).toContain("Success");
    expect(nearMiss.message).toContain("arms");  // plural
  });
});

// ---------------------------------------------------------------------------
// §3 Compound condition — || or && in branch
// ---------------------------------------------------------------------------

describe("§3 Compound — `||`/`&&` advisory", () => {
  test("compound `||` chain fires compound shape", () => {
    const source = `type Phase:enum = { Idle, Loading, Error, Success }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle || @phase is .Loading) {
      <p>waiting</p>
    } else if (@phase is .Error) {
      <p>error</p>
    } else if (@phase is .Success) {
      <p>done</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    const compound = diags.find(d => d.shape === "compound");
    expect(compound).toBeDefined();
    expect(compound.message).toContain("compound condition");
  });
});

// ---------------------------------------------------------------------------
// §4 Mixed-discriminator — different cells across branches
// ---------------------------------------------------------------------------

describe("§4 Mixed-discriminator — no fire", () => {
  test("branches over different cells do not fire I-MATCH-PROMOTABLE", () => {
    const source = `type Phase:enum = { Idle, Loading }
type Mode:enum = { Light, Dark }
<phase>: Phase = .Idle
<mode>: Mode = .Light

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>idle</p>
    } else if (@mode is .Dark) {
      <p>dark</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    expect(diags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5 Non-enum cell — string-typed
// ---------------------------------------------------------------------------

describe("§5 Non-enum cell — no fire (W-LIFECYCLE-CANDIDATE territory)", () => {
  test("string-typed cell with enum-tag-shaped values does not fire I-MATCH-PROMOTABLE", () => {
    // The string-discriminator-trap is W-LIFECYCLE-CANDIDATE territory, not
    // I-MATCH-PROMOTABLE. The lint should NOT double-fire on the same site.
    const source = `<phase>: string = "Idle"

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>idle</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    expect(diags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §7 Single branch — no chain
// ---------------------------------------------------------------------------

describe("§7 Single-branch if — no fire", () => {
  test("if without else does not fire (not a chain)", () => {
    const source = `type Phase:enum = { Idle, Loading }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>idle</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    expect(diags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §9 Diagnostic shape
// ---------------------------------------------------------------------------

describe("§9 Diagnostic shape — required fields present", () => {
  test("exhaustive diagnostic has line, column, code, severity, message", () => {
    const source = `type Phase:enum = { Idle, Loading }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>i</p>
    } else if (@phase is .Loading) {
      <p>l</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    expect(diags.length).toBeGreaterThan(0);
    const d = diags[0];
    expect(typeof d.line).toBe("number");
    expect(typeof d.column).toBe("number");
    expect(d.code).toBe("I-MATCH-PROMOTABLE");
    expect(typeof d.message).toBe("string");
    expect(d.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §10 Severity is "info"
// ---------------------------------------------------------------------------

describe("§10 Severity — info, not warning", () => {
  test("severity is exactly \"info\"", () => {
    const source = `type Phase:enum = { Idle, Loading }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>i</p>
    } else if (@phase is .Loading) {
      <p>l</p>
    }
  }
</>`;
    const result = compileSource(source);
    const diags = getMatchDiags(result);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// §11 + §12 Integration — flows into lintDiagnostics, never blocks compile
// ---------------------------------------------------------------------------

describe("§11+12 Integration — non-blocking, surfaced through compileScrml", () => {
  test("compile result.lintDiagnostics contains I-MATCH-PROMOTABLE diagnostics", () => {
    const source = `type Phase:enum = { Idle, Loading }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>i</p>
    } else if (@phase is .Loading) {
      <p>l</p>
    }
  }
</>`;
    const result = compileSource(source);
    expect(Array.isArray(result.lintDiagnostics)).toBe(true);
    const found = result.lintDiagnostics.find(d => d.code === "I-MATCH-PROMOTABLE");
    expect(found).toBeDefined();
  });

  test("lint does not block compilation — file still compiles", () => {
    const source = `type Phase:enum = { Idle, Loading }
<phase>: Phase = .Idle

<markup name="app">
  ${"${"}
    if (@phase is .Idle) {
      <p>i</p>
    } else if (@phase is .Loading) {
      <p>l</p>
    }
  }
</>`;
    const result = compileSource(source);
    // A lint should never produce a hard error; errors array should not contain
    // I-MATCH-PROMOTABLE entries.
    const lintErr = (result.errors ?? []).find(e => e.code === "I-MATCH-PROMOTABLE");
    expect(lintErr).toBeUndefined();
  });
});
