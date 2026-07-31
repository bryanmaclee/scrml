/**
 * machine-or-alternation.test.js — | alternation in machine transition rules
 *
 * Added S21: `.A | .B => .C | .D` desugars to N single-pair rules before the
 * type checker. Reduces line count on dense fan-in/fan-out machines.
 * Duplicate (from, to) pairs — within a line or across lines — emit E-ENGINE-014.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/machine-or-alternation");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(source, filename) {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
  const allErrors = result.errors || [];
  const fatalErrors = allErrors.filter((e) => e.severity !== "warning");
  const outPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".client.js"));
  const clientJs = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  return { errors: allErrors, fatalErrors, clientJs };
}

describe("Machine rule | alternation (§51.3)", () => {
  test(".A => .B | .C | .D expands to three single-pair transitions", () => {
    const source = `\${
  type S:enum = { Small, Big, Fire, Cape }
  @s: M = S.Small
}
< engine name=M for=S>
  .Small => .Big | .Fire | .Cape
</>
<p>\${@s}</>`;
    const { fatalErrors, clientJs } = compileSource(source, "rhs-or.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toContain(`"Small:Big": true`);
    expect(clientJs).toContain(`"Small:Fire": true`);
    expect(clientJs).toContain(`"Small:Cape": true`);
  });

  test(".A | .B => .C expands to two single-pair transitions (LHS alternation)", () => {
    const source = `\${
  type S:enum = { Fire, Cape, Small }
  @s: M = S.Fire
}
< engine name=M for=S>
  .Fire | .Cape => .Small
</>
<p>\${@s}</>`;
    const { fatalErrors, clientJs } = compileSource(source, "lhs-or.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toContain(`"Fire:Small": true`);
    expect(clientJs).toContain(`"Cape:Small": true`);
  });

  test(".A | .B => .C | .D produces the full 2x2 cross-product", () => {
    const source = `\${
  type S:enum = { A, B, C, D }
  @s: M = S.A
}
< engine name=M for=S>
  .A | .B => .C | .D
</>
<p>\${@s}</>`;
    const { fatalErrors, clientJs } = compileSource(source, "cross-product.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toContain(`"A:C": true`);
    expect(clientJs).toContain(`"A:D": true`);
    expect(clientJs).toContain(`"B:C": true`);
    expect(clientJs).toContain(`"B:D": true`);
  });

  test("Mario machine: 8 transitions in 3 lines produces identical output to 8 rules", () => {
    const source = `\${
  type MarioState:enum = { Small, Big, Fire, Cape }
  @state: MarioMachine = MarioState.Small
}
< engine name=MarioMachine for=MarioState>
  .Small        => .Big | .Fire | .Cape
  .Big          => .Fire | .Cape | .Small
  .Fire | .Cape => .Small
</>
<p>\${@state}</>`;
    const { fatalErrors, clientJs } = compileSource(source, "mario.scrml");
    expect(fatalErrors.length).toBe(0);
    const expected = [
      "Small:Big", "Small:Fire", "Small:Cape",
      "Big:Fire", "Big:Cape", "Big:Small",
      "Fire:Small", "Cape:Small",
    ];
    for (const t of expected) {
      expect(clientJs).toContain(`"${t}": true`);
    }
  });

  test("duplicate from→to pair across lines fires E-ENGINE-014", () => {
    const source = `\${
  type S:enum = { A, B, C }
  @s: M = S.A
}
< engine name=M for=S>
  .A => .B
  .A => .B | .C
</>
<p>\${@s}</>`;
    const { fatalErrors } = compileSource(source, "dup-cross.scrml");
    const e014 = fatalErrors.filter((e) => e.code === "E-ENGINE-014");
    expect(e014.length).toBeGreaterThanOrEqual(1);
  });

  test("duplicate from→to pair within one line fires E-ENGINE-014", () => {
    const source = `\${
  type S:enum = { A, B }
  @s: M = S.A
}
< engine name=M for=S>
  .A | .A => .B
</>
<p>\${@s}</>`;
    const { fatalErrors } = compileSource(source, "dup-within.scrml");
    const e014 = fatalErrors.filter((e) => e.code === "E-ENGINE-014");
    expect(e014.length).toBeGreaterThanOrEqual(1);
  });

  test("plain .A => .B still parses (no regression)", () => {
    const source = `\${
  type S:enum = { A, B }
  @s: M = S.A
}
< engine name=M for=S>
  .A => .B
</>
<p>\${@s}</>`;
    const { fatalErrors, clientJs } = compileSource(source, "plain.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toContain(`"A:B": true`);
  });

  test("| with guard clause attaches the guard to every expansion", () => {
    const source = `\${
  type S:enum = { A, B, C }
  @s: M = S.A
  @allow = true
}
< engine name=M for=S>
  .A => .B | .C given (@allow)
</>
<p>\${@s}</>`;
    const { fatalErrors, clientJs } = compileSource(source, "with-guard.scrml");
    expect(fatalErrors.length).toBe(0);
    // Both generated transitions carry the guard — look for two guard entries
    const guardMatches = clientJs.match(/guard:/g) || [];
    expect(guardMatches.length).toBeGreaterThanOrEqual(2);
  });
});
