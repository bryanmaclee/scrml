/**
 * S19 gauntlet Phase 2 — match exhaustiveness + arm diagnostics regression tests.
 *
 * Covers the 9 match-related fixtures from Phase 2 triage
 * (docs/changes/gauntlet-s19/phase2-bugs.md Category A). Prior to wiring
 * checkExhaustiveness (type-system.ts:3490 orphan), all of these compiled
 * silently; this suite locks in the fired diagnostic codes.
 *
 * One test per diagnostic code, modeled on lin-checker.test.js.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `s19-match-${++tmpCounter}`) {
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
      warnings: result.warnings ?? [],
      all: [...(result.errors ?? []), ...(result.warnings ?? [])],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codesOf(items) {
  return items.map(e => e.code).filter(Boolean);
}

describe("S19 gauntlet Phase 2 — match exhaustiveness + arm diagnostics", () => {

  // -----------------------------------------------------------------
  // A1: non-exhaustive match over an enum → E-TYPE-020
  // -----------------------------------------------------------------
  test("E-TYPE-020: non-exhaustive enum match names missing variants", () => {
    const src = `\${
    type Status:enum = { Active, Banned, Pending }
    let s:Status = .Active
    let x = match s {
        .Active => 1
        .Banned => 2
    }
    log(x)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "t020-nonexhaustive");
    const codes = codesOf(errors);
    expect(codes).toContain("E-TYPE-020");
    const msg = errors.find(e => e.code === "E-TYPE-020")?.message ?? "";
    expect(msg).toContain("Status");
    expect(msg).toContain("::Pending");
  });

  // -----------------------------------------------------------------
  // A2: duplicate variant arm → E-TYPE-023
  // -----------------------------------------------------------------
  test("E-TYPE-023: duplicate match arm for the same variant", () => {
    const src = `\${
    type Status:enum = { Active, Banned }
    let s:Status = .Active
    let x = match s {
        .Active => 1
        .Banned => 2
        .Active => 3
    }
    log(x)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "t023-duplicate");
    const codes = codesOf(errors);
    expect(codes).toContain("E-TYPE-023");
    const msg = errors.find(e => e.code === "E-TYPE-023")?.message ?? "";
    expect(msg).toContain("Active");
  });

  // -----------------------------------------------------------------
  // A3: match on a struct-typed subject → E-TYPE-024
  // -----------------------------------------------------------------
  test("E-TYPE-024: match on struct-typed subject is rejected", () => {
    const src = `\${
    type Point:struct = { x: number, y: number }
    let p:Point = { x: 1, y: 2 }
    let v = match p {
        else => 0
    }
    log(v)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "t024-struct");
    const codes = codesOf(errors);
    expect(codes).toContain("E-TYPE-024");
    const msg = errors.find(e => e.code === "E-TYPE-024")?.message ?? "";
    expect(msg).toContain("Point");
  });

  // -----------------------------------------------------------------
  // A4: match on asIs-typed subject → E-TYPE-025
  // -----------------------------------------------------------------
  test("E-TYPE-025: match on asIs-typed subject is rejected", () => {
    const src = `\${
    let x: asIs = 5
    let r = match x {
        else => 0
    }
    log(r)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "t025-asIs");
    const codes = codesOf(errors);
    expect(codes).toContain("E-TYPE-025");
  });

  // -----------------------------------------------------------------
  // A5: bare match in markup (outside logic context) → E-TYPE-026
  // -----------------------------------------------------------------
  test("E-TYPE-026: bare match in markup is rejected", () => {
    const src = `\${
    type Status:enum = { On, Off }
    @s: Status = .On
}
<program>
    <div>
        match @s {
            .On  => <p>on</>
            .Off => <p>off</>
        }
    </>
</>
`;
    const { errors } = compileWholeScrml(src, "t026-markup-direct");
    const codes = codesOf(errors);
    expect(codes).toContain("E-TYPE-026");
  });

  // -----------------------------------------------------------------
  // A6a: else arm not last (followed by another arm) → E-SYNTAX-010
  // -----------------------------------------------------------------
  test("E-SYNTAX-010: else arm must be the last arm", () => {
    const src = `\${
    type Status:enum = { Active, Banned }
    let s:Status = .Active
    let x = match s {
        else    => 0
        .Active => 1
    }
    log(x)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "syntax010-else-not-last");
    const codes = codesOf(errors);
    expect(codes).toContain("E-SYNTAX-010");
  });

  // -----------------------------------------------------------------
  // A6b: explicit arm after else → E-SYNTAX-010
  // -----------------------------------------------------------------
  test("E-SYNTAX-010: arm-after-else is rejected", () => {
    const src = `\${
    type Status:enum = { Active, Banned }
    let s:Status = .Active
    let x = match s {
        .Active => 1
        else    => 0
        .Banned => 2
    }
    log(x)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "syntax010-arm-after-else");
    const codes = codesOf(errors);
    expect(codes).toContain("E-SYNTAX-010");
  });

  // -----------------------------------------------------------------
  // A7: pattern-side guard clauses (| cond or if cond) → E-SYNTAX-011
  // -----------------------------------------------------------------
  test("E-SYNTAX-011: match arm guard clauses are not supported in v1", () => {
    const src = `\${
    type Shape:enum = { Circle(r: number), Point }
    let s:Shape = .Circle(2)
    let v = match s {
        .Circle(r) if r > 0 => r
        else                => 0
    }
    log(v)
    function log(n: number) { let _ = n }
}
<program>
    <p>ok</>
</>
`;
    const { errors } = compileWholeScrml(src, "syntax011-guard-clause");
    const codes = codesOf(errors);
    expect(codes).toContain("E-SYNTAX-011");
  });

  // -----------------------------------------------------------------
  // A8: partial match where every variant is already covered → W-MATCH-003
  // -----------------------------------------------------------------
  test("W-MATCH-003: partial is unnecessary when all variants are covered", () => {
    const src = `\${
    type Status:enum = { Active, Pending }
    @status: Status = .Active
    function handle() {
        partial match @status {
            .Active  => log("a")
            .Pending => log("p")
        }
    }
    function log(s: string) { let _ = s }
}
<program>
    <p>ok</>
</>
`;
    const { warnings, errors } = compileWholeScrml(src, "wmatch003-unnecessary-partial");
    const codes = [...codesOf(warnings), ...codesOf(errors)];
    expect(codes).toContain("W-MATCH-003");
    // And the match itself must not emit E-TYPE-020 (all variants covered).
    expect(codes).not.toContain("E-TYPE-020");
  });

});
