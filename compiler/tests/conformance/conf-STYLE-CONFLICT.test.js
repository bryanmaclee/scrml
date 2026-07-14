/**
 * CONF-STYLE-CONFLICT | §34 / §65.2 / §65.2.4
 *
 * Catalog: the CSS Wave-1 flat-specificity conflict checker.
 *   - E-STYLE-CONFLICT (Error) — an UNCONDITIONAL same-property overlap on a
 *     provably-shared element between two component-scope `#{}` selector rules
 *     at the same precedence level. scrml deletes specificity (§65.2), so the
 *     compiler refuses to silently pick a winner. Partitions into result.errors.
 *   - W-STYLE-CONFLICT-POSSIBLE (Info) — the fail-closed soft residue + the
 *     Wave-1 calibration carve-outs (§65.2.4 R2 class×class, R3 program-scope).
 *     Partitions into result.warnings (non-fatal).
 *
 * Firing site: `checkCssConflicts` in `compiler/src/codegen/css-conflict-check.ts`,
 * invoked from `compiler/src/api.js` Stage 3.4 (post-CE). The E-/W- prefix +
 * severity route each into the correct diagnostic stream per api.js partition.
 *
 * These assertions are the "codes-half" conformance: they lock the fire/no-fire
 * boundary of the two named codes, INCLUDING the ratified R1/R2/R3 carve-outs.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_style_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const has = (diags, code) => diags.some((d) => d.code === code);

/** Component definition (root tag + attrs + `#{}` body) then an instantiation. */
function widget(rootTag, rootAttrs, cssBody) {
  return (
    `<program>\n\${\n  const Widget = <${rootTag} ${rootAttrs} props={ label: string }>\n` +
    `    #{\n${cssBody}\n    }\n    \${label}\n  </>\n}\n<div><Widget label="x"/></>\n</program>\n`
  );
}

describe("CONF-STYLE-CONFLICT: E-STYLE-CONFLICT (hard) fires on proven ambiguity", () => {
  test("POS: component tag × class same-property overlap fires E-STYLE-CONFLICT", () => {
    const { errors } = compile(
      widget("button", `class="btn"`, `      button { color: red; }\n      .btn { color: blue; }`),
      "hard-tag-class",
    );
    const hit = errors.find((e) => e.code === "E-STYLE-CONFLICT");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("error");
    expect(hit.message).toMatch(/§65\.2\.1/);
    expect(hit.message).toMatch(/color/);
  });

  test("POS: component tag × tag (same tag) unconditional overlap fires hard", () => {
    const { errors } = compile(
      widget("button", `class="btn"`, `      button { background: red; }\n      button { background: green; }`),
      "hard-tag-tag",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(true);
  });

  test("NEG: conditional `:hover` layer does NOT fire hard (§65.2.2)", () => {
    const { errors, warnings } = compile(
      widget("button", `class="btn"`, `      .btn { color: red; }\n      .btn:hover { color: blue; }`),
      "neg-hover",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("NEG: provably-disjoint tags (`div` vs `span`) do NOT fire", () => {
    const { errors, warnings } = compile(
      widget("div", `class="box"`, `      div { color: red; }\n      span { color: blue; }`),
      "neg-disjoint",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });
});

describe("CONF-STYLE-CONFLICT: R1/R2/R3 calibration carve-outs", () => {
  test("R1: universal `*` vs a specific class → LAYER (no E-, no W-)", () => {
    const { errors, warnings } = compile(
      widget("button", `class="btn"`, `      * { padding: 0; }\n      .btn { padding: 16px; }`),
      "r1-universal",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("R2: component class × class base+modifier → SOFT (W-), never hard", () => {
    const { errors, warnings } = compile(
      widget("button", `class="btn btn-op"`, `      .btn { background: red; }\n      .btn-op { background: blue; }`),
      "r2-bem",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    const hit = warnings.find((w) => w.code === "W-STYLE-CONFLICT-POSSIBLE");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("info");
    expect(hit.message).toMatch(/§65\.2\.4/);
  });

  test("R3: program-scope provable LOCAL overlap → SOFT (program is soft-only)", () => {
    const { errors, warnings } = compile(
      `<program>\n#{\n  .btn { background: red; }\n  .btn-op { background: blue; }\n}\n<button class="btn btn-op">Go</>\n</program>\n`,
      "r3-program-local",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });

  test("R3: program same-property rules on DIFFERENT elements → NO warning (firehose off)", () => {
    const { errors, warnings } = compile(
      `<program>\n#{\n  .header { padding: 4px; }\n  .footer { padding: 8px; }\n}\n<div class="header">h</>\n<div class="footer">f</>\n</program>\n`,
      "r3-firehose-off",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("reactive `class:NAME=@cond` toggle → SOFT (conditionally present), never hard", () => {
    const { errors, warnings } = compile(
      `<program>\n\${ @on = false }\n#{\n  .item { color: red; }\n  .item.active { color: blue; }\n}\n<div class="item" class:active=@on>hi</>\n</program>\n`,
      "reactive-toggle",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
  });
});

describe("CONF-STYLE-CONFLICT: diagnostic-stream partition", () => {
  test("E-STYLE-CONFLICT is in errors, NOT warnings", () => {
    const { errors, warnings } = compile(
      widget("button", `class="btn"`, `      button { color: red; }\n      .btn { color: blue; }`),
      "partition-hard",
    );
    expect(errors.some((e) => e.code === "E-STYLE-CONFLICT")).toBe(true);
    expect(warnings.some((e) => e.code === "E-STYLE-CONFLICT")).toBe(false);
  });

  test("W-STYLE-CONFLICT-POSSIBLE is in warnings, NOT errors", () => {
    const { errors, warnings } = compile(
      widget("button", `class="btn btn-op"`, `      .btn { background: red; }\n      .btn-op { background: blue; }`),
      "partition-soft",
    );
    expect(warnings.some((w) => w.code === "W-STYLE-CONFLICT-POSSIBLE")).toBe(true);
    expect(errors.some((w) => w.code === "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });
});

describe("CONF-STYLE-CONFLICT: S239 adversarial-review boundary locks", () => {
  test("spaced child combinator `div > span` does NOT hard-fire on a grandchild (F1)", () => {
    const { errors } = compile(
      `<program>\n\${\n  const C = <div class="card" props={ label: string }>\n` +
      `    #{\n      div > span { color: red; }\n      span { color: blue; }\n    }\n` +
      `    <p><span>\${label}</span></p>\n  </>\n}\n<div><C label="x"/></>\n</program>\n`,
      "f1-child-grandchild",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(false);
  });

  test("component behind a structural `<if>` with a tag×class overlap HARD-fires (F2)", () => {
    const { errors } = compile(
      `<program>\n\${ @show = true }\n\${\n  const Btn = <button class="btn" props={ label: string }>\n` +
      `    #{\n      button { color: red; }\n      .btn { color: blue; }\n    }\n    \${label}\n  </>\n}\n` +
      `<div><if=@show><Btn label="x"/></if></>\n</program>\n`,
      "f2-if-nested",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(true);
  });

  test("floor-vs-floor `* {}` × `* {}` fires; floor-vs-specific stays a layer (F4)", () => {
    const both = compile(widget("div", `class="box"`, `      * { color: red; }\n      * { color: blue; }`), "f4-floor-floor");
    expect(has(both.errors, "E-STYLE-CONFLICT")).toBe(true);
    const layered = compile(widget("div", `class="box"`, `      * { color: red; }\n      .box { color: blue; }`), "f4-floor-specific");
    expect(has(layered.errors, "E-STYLE-CONFLICT")).toBe(false);
    expect(has(layered.warnings, "W-STYLE-CONFLICT-POSSIBLE")).toBe(false);
  });

  test("an unparseable rule does NOT suppress a genuine conflict elsewhere in the scope (F3/F5)", () => {
    const { errors } = compile(
      `<program>\n\${\n  const C = <button class="btn" props={ label: string }>\n` +
      `    #{\n      .w-1\\/2 { padding: 4px; }\n      button { color: red; }\n      .btn { color: blue; }\n    }\n` +
      `    \${label}\n  </>\n}\n<div><C label="x"/></>\n</program>\n`,
      "f3-f5-resilience",
    );
    expect(has(errors, "E-STYLE-CONFLICT")).toBe(true);
  });
});
