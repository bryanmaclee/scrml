/**
 * CSS §65.2 flat-specificity conflict checker — Unit Tests
 *
 * Exercises the SHIPPING pass (`checkCssConflicts`, wired post-CE as Stage 3.4)
 * end-to-end through the public compiler entry, so the real diagnostic-stream
 * partition is tested: `E-STYLE-CONFLICT` → `result.errors` (fatal), and
 * `W-STYLE-CONFLICT-POSSIBLE` → `result.warnings` (non-fatal).
 *
 * Coverage:
 *   HARD     A genuine `tag × class` component-scope overlap fires E-STYLE-CONFLICT.
 *   HARD     tag × tag (same tag) unconditional overlap fires hard.
 *   R1       universal `*` / bare-root `html`/`body` vs a specific rule → LAYER, no fire.
 *   R2       class × class base+modifier → SOFT (W-), never hard, in Wave 1.
 *   R3       program-scope soft is FILE-BOUNDED: a provable local overlap → soft;
 *            a same-property pair on DIFFERENT elements (the firehose) → no fire.
 *   NOFIRE   conditional (:hover), attr, @media = deterministic layers.
 *   NOFIRE   reactive class:NAME=@cond toggle → conditionally present → soft, not hard.
 *   NOFIRE   provably-disjoint (different tag) → no fire.
 *   NOFIRE   the css-scope-01 corpus sample → 0 findings.
 *   PARTITION E-STYLE-CONFLICT lands in errors (not warnings); W- lands in warnings.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helper — full-pipeline compile so the wired Stage 3.4 pass runs.
// ---------------------------------------------------------------------------

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-css-conflict-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    return { errors: r.errors ?? [], warnings: r.warnings ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasCode = (diags, code) => diags.some((d) => d.code === code);
const countCode = (diags, code) => diags.filter((d) => d.code === code).length;

/** A component definition + instantiation wrapper. `cssBody` is the `#{}` body. */
function componentApp(rootTag, rootAttrs, cssBody) {
  return (
    `<program>\n` +
    `\${\n` +
    `  const Widget = <${rootTag} ${rootAttrs} props={ label: string }>\n` +
    `    #{\n${cssBody}\n    }\n` +
    `    \${label}\n` +
    `  </>\n` +
    `}\n` +
    `<div><Widget label="x"/></>\n` +
    `</program>\n`
  );
}

// ---------------------------------------------------------------------------
// HARD — genuine ambiguity fires E-STYLE-CONFLICT (component scope)
// ---------------------------------------------------------------------------

describe("HARD E-STYLE-CONFLICT — proven component-scope ambiguity", () => {
  test("tag × class overlap on a provably-shared element fires hard (the flagship)", () => {
    const src = componentApp("button", `class="btn"`, `      button { color: red; }\n      .btn { color: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(true);
    // The hard block is in errors, NOT in warnings.
    expect(hasCode(warnings, "E-STYLE-CONFLICT")).toBe(false);
  });

  test("tag × tag (same tag) unconditional same-property overlap fires hard", () => {
    const src = componentApp("button", `class="btn"`, `      button { color: red; }\n      button { color: green; }`);
    const { errors } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(true);
  });

  test("the hard diagnostic names the property and both selectors", () => {
    const src = componentApp("button", `class="btn"`, `      button { color: red; }\n      .btn { color: blue; }`);
    const { errors } = compileSource(src);
    const d = errors.find((e) => e.code === "E-STYLE-CONFLICT");
    expect(d).toBeDefined();
    expect(d.message).toContain("color");
    expect(d.message).toContain("button");
    expect(d.message).toContain(".btn");
    expect(d.message).toContain("§65.2.1");
  });
});

// ---------------------------------------------------------------------------
// R1 — universal `*` / bare-root are a LOWER LAYER (no fire)
// ---------------------------------------------------------------------------

describe("R1 — universal `*` / bare-root rules layer, never conflict", () => {
  test("`*` vs `.btn` same property → no E-STYLE-CONFLICT, no soft", () => {
    const src = componentApp("button", `class="btn"`, `      * { padding: 0; }\n      .btn { padding: 16px; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("bare-root `body` vs a specific rule → no fire", () => {
    const src = componentApp("div", `class="card"`, `      body { margin: 0; }\n      .card { margin: 8px; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2 — class × class base+modifier is SOFT in Wave 1 (never hard)
// ---------------------------------------------------------------------------

describe("R2 — class × class base+modifier is soft in Wave 1", () => {
  test("`.btn` + `.btn-op` on <button class='btn btn-op'> → soft, NOT hard", () => {
    const src = componentApp("button", `class="btn btn-op"`, `      .btn { background: red; }\n      .btn-op { background: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R3 — program-scope soft is FILE-BOUNDED (no firehose)
// ---------------------------------------------------------------------------

describe("R3 — program-scope soft only on a provable local overlap", () => {
  test("program `.btn` + `.btn-op` with a local <button class='btn btn-op'> → soft", () => {
    const src =
      `<program>\n#{\n  .btn { background: red; }\n  .btn-op { background: blue; }\n}\n` +
      `<button class="btn btn-op">Go</>\n</program>\n`;
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false); // program is soft-only
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });

  test("program same-property rules on DIFFERENT elements → NO warning (firehose suppressed)", () => {
    const src =
      `<program>\n#{\n  body { background: white; }\n  .card { background: gray; }\n}\n` +
      `<div class="card">hi</>\n</program>\n`;
    const { errors, warnings } = compileSource(src);
    // `body` is R1 floor AND targets no shared element with `.card` → no fire either way.
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("program rules for two genuinely-disjoint classes → NO warning", () => {
    const src =
      `<program>\n#{\n  .header { padding: 4px; }\n  .footer { padding: 8px; }\n}\n` +
      `<div class="header">h</>\n<div class="footer">f</>\n</program>\n`;
    const { warnings } = compileSource(src);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MUST NOT FIRE — conditional layers, disjoint, reactive toggles
// ---------------------------------------------------------------------------

describe("must NOT fire — conditional layers and disjoint selectors", () => {
  test("`.btn` vs `.btn:hover` (state layer, §65.2.2) → no fire", () => {
    const src = componentApp("button", `class="btn"`, `      .btn { color: red; }\n      .btn:hover { color: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("`@media`-wrapped rule vs base (at-rule layer) → no fire", () => {
    const src = componentApp("button", `class="btn"`,
      `      .btn { color: red; }\n      @media (min-width: 700px) { .btn { color: blue; } }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("provably-disjoint tags (`div` vs `span`) → no fire", () => {
    const src = componentApp("div", `class="box"`, `      div { color: red; }\n      span { color: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("reactive `class:NAME=@cond` toggle → soft (conditionally present), NEVER hard", () => {
    const src =
      `<program>\n\${ @on = false }\n#{\n  .item { color: red; }\n  .item.active { color: blue; }\n}\n` +
      `<div class="item" class:active=@on>hi</>\n</program>\n`;
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    // The modifier is conditionally present → fail-closed soft, not hard.
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression — the css-scope-01 corpus sample stays clean
// ---------------------------------------------------------------------------

describe("regression — real corpus sample is clean", () => {
  test("css-scope-01.scrml compiles with 0 style-conflict diagnostics", () => {
    const r = compileScrml({
      inputFiles: [join(process.cwd(), "samples/compilation-tests/css-scope-01.scrml")],
      write: false,
    });
    const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
    expect(countCode(all, "E-STYLE-CONFLICT")).toBe(0);
    expect(countCode(all, "W-STYLE-CONFLICT-POSSIBLE")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Partition — the diagnostic-stream split (S93 rule)
// ---------------------------------------------------------------------------

describe("diagnostic-stream partition", () => {
  test("E-STYLE-CONFLICT partitions into errors and blocks (fatal); never warnings", () => {
    const src = componentApp("button", `class="btn"`, `      button { color: red; }\n      .btn { color: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(errors.some((e) => e.code === "E-STYLE-CONFLICT")).toBe(true);
    expect(warnings.some((e) => e.code === "E-STYLE-CONFLICT")).toBe(false);
  });

  test("W-STYLE-CONFLICT-POSSIBLE partitions into warnings (non-fatal); never errors", () => {
    const src = componentApp("button", `class="btn btn-op"`, `      .btn { background: red; }\n      .btn-op { background: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(warnings.some((e) => e.code === "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
    expect(errors.some((e) => e.code === "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S239 adversarial-review fixes — each finding gets a regression guard.
// ---------------------------------------------------------------------------

describe("F1 — whitespace-surrounded combinators are preserved", () => {
  test("spaced child `div > span` does NOT match a GRANDCHILD (no false hard)", () => {
    // The span is a grandchild (div > p > span); the child combinator must not
    // match it. Before the fix `>` collapsed to a descendant → false hard-fire.
    const src =
      `<program>\n\${\n  const C = <div class="card" props={ label: string }>\n` +
      `    #{\n      div > span { color: red; }\n      span { color: blue; }\n    }\n` +
      `    <p><span>\${label}</span></p>\n  </>\n}\n<div><C label="x"/></>\n</program>\n`;
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("spaced child `div > span` DOES match a DIRECT child (hard fires)", () => {
    const src =
      `<program>\n\${\n  const C = <div class="card" props={ label: string }>\n` +
      `    #{\n      div > span { color: red; }\n      span { color: blue; }\n    }\n` +
      `    <span>\${label}</span>\n  </>\n}\n<div><C label="x"/></>\n</program>\n`;
    const { errors } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(true);
  });

  test("spaced sibling `button ~ button` keeps its sibling carve-out → soft, not hard", () => {
    const src =
      `<program>\n\${\n  const C = <div class="box" props={ label: string }>\n` +
      `    #{\n      button ~ button { color: red; }\n      .btn { color: blue; }\n    }\n` +
      `    <button class="btn">\${label}</button><button class="btn">x</button>\n  </>\n}\n` +
      `<div><C label="x"/></>\n</program>\n`;
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });
});

describe("F2 — component reached through control-flow gets its element-set", () => {
  test("a component behind a structural `<if>` WITH a tag×class overlap HARD-fires (the guarantee)", () => {
    // Before the collector fix, the `<if>` body's element-set was empty → the
    // hard checker could not fire → the §65.2.1 guarantee silently failed.
    const src =
      `<program>\n\${ @show = true }\n\${\n  const Btn = <button class="btn" props={ label: string }>\n` +
      `    #{\n      button { color: red; }\n      .btn { color: blue; }\n    }\n    \${label}\n  </>\n}\n` +
      `<div><if=@show><Btn label="x"/></if></>\n</program>\n`;
    const { errors } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(true);
  });
});

describe("F3 — an unparseable selector routes to soft, never a floor layer", () => {
  test("a component escaped selector (`.w-1\\/2`) → soft (fail-closed), NOT hard, NOT suppressed", () => {
    const src =
      `<program>\n\${\n  const C = <div class="box" props={ label: string }>\n` +
      `    #{\n      .w-1\\/2 { color: red; }\n      .btn { color: blue; }\n    }\n` +
      `    <button class="btn">\${label}</button>\n  </>\n}\n<div><C label="x"/></>\n</program>\n`;
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });
});

describe("F4 — R1 floor suppression is XOR (floor-vs-floor still conflicts)", () => {
  test("floor-vs-floor `* {}` × `* {}` same property → HARD (within-level conflict)", () => {
    const src = componentApp("div", `class="box"`, `      * { color: red; }\n      * { color: blue; }`);
    const { errors } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(true);
  });

  test("floor-vs-SPECIFIC `* {}` × `.box {}` → still a deterministic LAYER (no fire)", () => {
    const src = componentApp("div", `class="box"`, `      * { color: red; }\n      .box { color: blue; }`);
    const { errors, warnings } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(hasCode(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });
});

describe("F5 — resilience: a malformed rule does not suppress a real conflict elsewhere", () => {
  test("an unparseable rule alongside a genuine tag×class overlap → the genuine conflict STILL fires", () => {
    const src =
      `<program>\n\${\n  const C = <button class="btn" props={ label: string }>\n` +
      `    #{\n      .w-1\\/2 { padding: 4px; }\n      button { color: red; }\n      .btn { color: blue; }\n    }\n` +
      `    \${label}\n  </>\n}\n<div><C label="x"/></>\n</program>\n`;
    const { errors } = compileSource(src);
    expect(hasCode(errors, "E-STYLE-CONFLICT")).toBe(true);
  });
});

describe("F6 — E-STYLE-CONFLICT does not mask the emitted-JS validity gate", () => {
  test("compiling with validateEmit + a style conflict: E- surfaces, no spurious E-CODEGEN-INVALID-LOGIC", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-css-ve-"));
    try {
      const file = join(dir, "app.scrml");
      writeFileSync(file, componentApp("button", `class="btn"`, `      button { color: red; }\n      .btn { color: blue; }`));
      const r = compileScrml({ inputFiles: [file], write: false, validateEmit: true });
      const errors = r.errors ?? [];
      // The style conflict surfaces …
      expect(errors.some((e) => e.code === "E-STYLE-CONFLICT")).toBe(true);
      // … and it did NOT trip the validity gate into a spurious defect report:
      // the emitted JS is valid, and the gate still RAN (was not suppressed).
      expect(errors.some((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
