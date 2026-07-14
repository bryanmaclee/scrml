/**
 * §14.1.1 Option D — curated host-method return-type table (soundness).
 *
 * Deep-dive: scrml-support/docs/deep-dives/typer-soundness-poison-2026-07-12.md
 * (bryan S251). change-id: typer-option-d-hostmethod-table-2026-07-12.
 *
 * SCOPE (post S239 review — bryan ruling): SHIP the SOUND, receiver-KEYED
 * type-system half (`HOST_METHOD_RETURNS` / `HOST_PROPERTY_RETURNS` in
 * type-system.ts) that closes F5 (a `match` on a `substring()` result). DEFER
 * the equality half: the GCP3 syntactic mirror was DROPPED because keying on
 * method NAME alone (GCP3 cannot resolve receiver types) was a SOUNDNESS
 * INVERSION — a host method on an `asIs` receiver (`(x: asIs).indexOf(...)`)
 * was wrongly typed and hard-errored on a mismatched comparison, when `asIs`
 * methods MUST stay exempt (§14.1.1, the checking-disabled hatch). The
 * reproducible host-method equality silent-accept (`s.charCodeAt() == "x"`) is
 * therefore a KNOWN DEFERRED gap (PA-filed), NOT closed here.
 *
 * The type-system half is sound BECAUSE it is receiver-keyed: it upgrades a
 * member-call binding ONLY when the receiver resolves to a modeled shape
 * (string / array / number). An `asIs` receiver -> `hostReceiverKind` returns
 * null -> the value stays `asIs` (the sanctioned silent hatch). Un-modeled /
 * polymorphic methods (map/filter/pop/slice/…) also stay `asIs`.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(source, testName = `hostmethod-${++tmpCounter}`) {
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
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const errCodes = (r) => r.errors.map(e => e.code);

describe("§14.1.1 Option D — type-system half (F5, SOUND, shipped)", () => {

  // F5 — the loud friction face. A `match` on a `substring()` result no longer
  // fires E-TYPE-025 (the result now types as `string`, no annotation needed).
  test("F5: `match c.source.substring(...)` → NO E-TYPE-025", () => {
    const src = `\${
    type Cursor:struct = { source: string, pos: int }
    fn classify(c: Cursor) -> string {
        const ch = c.source.substring(c.pos, c.pos + 1)
        return match ch {
            "a" :> "vowel"
            _ :> "other"
        }
    }
    <firstKind>: string = classify({ source: "abc", pos: 0 })
}
<p id="out">\${@firstKind}</>`;
    const r = compile(src, "f5-substring-match");
    expect(errCodes(r)).not.toContain("E-TYPE-025");
    expect(errCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // The whole modeled chain compiles clean (no error stream at all).
  test("F5: substring→match→derived-cell compiles with an empty error stream", () => {
    const src = `\${
    type Cursor:struct = { source: string, pos: int }
    fn classify(c: Cursor) -> string {
        const ch = c.source.substring(c.pos, c.pos + 1)
        return match ch {
            "a" :> "vowel"
            _ :> "other"
        }
    }
    <firstKind>: string = classify({ source: "abc", pos: 0 })
}
<p id="out">\${@firstKind}</>`;
    expect(compile(src, "f5-clean").errors).toHaveLength(0);
  });

  // A modeled string-returning method (charAt) on a struct-field receiver types
  // as string → a match on it is a typed-primitive subject (no E-TYPE-025).
  test("F5: `match c.source.charAt(i)` (string) → NO E-TYPE-025", () => {
    const src = `\${
    type Cursor:struct = { source: string, pos: int }
    fn first(c: Cursor) -> string {
        const ch = c.source.charAt(c.pos)
        return match ch {
            "a" :> "a"
            _ :> "z"
        }
    }
    <k>: string = first({ source: "abc", pos: 0 })
}
<p id="out">\${@k}</>`;
    expect(errCodes(compile(src, "f5-charat")).includes("E-TYPE-025")).toBe(false);
  });
});

describe("§14.1.1 Option D — equality half DEFERRED: soundness re-verification (mirror dropped, S251)", () => {

  // The type-system table is receiver-KEYED: an `asIs` receiver -> null kind ->
  // the value stays `asIs` (the sanctioned silent hatch). A host method on an
  // `asIs` receiver compared to a mismatched primitive MUST stay CLEAN — this is
  // the exact class the dropped GCP3 mirror WRONGLY hard-errored (the soundness
  // inversion). These are the regression guards against re-introducing it.
  test("asIs receiver: `const r = x.indexOf(\"a\"); r == \"missing\"` → CLEAN", () => {
    const src = `\${
    fn probe(x: asIs) -> boolean {
        const r = x.indexOf("a")
        if (r == "missing") { return true }
        return false
    }
}
<p>x</>`;
    expect(errCodes(compile(src, "asis-indexof"))).not.toContain("E-EQ-001");
  });

  test("asIs receiver: `x.replace(\"a\",\"b\") == 5` → CLEAN", () => {
    const src = `\${
    fn probe(x: asIs) -> boolean {
        if (x.replace("a", "b") == 5) { return true }
        return false
    }
}
<p>x</>`;
    expect(errCodes(compile(src, "asis-replace"))).not.toContain("E-EQ-001");
  });

  test("asIs receiver: `x.push(1) == \"tag\"` → CLEAN", () => {
    const src = `\${
    fn probe(x: asIs) -> boolean {
        if (x.push(1) == "tag") { return true }
        return false
    }
}
<p>x</>`;
    expect(errCodes(compile(src, "asis-push"))).not.toContain("E-EQ-001");
  });

  test("asIs receiver: `x.includes(\"k\") == 5` → CLEAN", () => {
    const src = `\${
    fn probe(x: asIs) -> boolean {
        if (x.includes("k") == 5) { return true }
        return false
    }
}
<p>x</>`;
    expect(errCodes(compile(src, "asis-includes"))).not.toContain("E-EQ-001");
  });

  // Finding 2 — GCP3's `collectBindings` is a FLAT (cross-scope, last-write-wins)
  // map. The dropped mirror gave a sibling fn's `const i = s.indexOf(...)` a
  // `number` primType that leaked into THIS fn's `i == "world"` (a string
  // comparison) → a spurious E-EQ-001. With the mirror gone, the member-call
  // binding carries no primType, so the string fn's comparison stays CLEAN.
  test("Finding 2: string fn `i == \"world\"` stays CLEAN despite a sibling `const i = s.indexOf()`", () => {
    const src = `\${
    fn strFn() -> boolean {
        const i = "world"
        return i == "world"
    }
    fn indexFn(s: string) -> boolean {
        const i = s.indexOf("x")
        return i == 5
    }
}
<p>x</>`;
    expect(errCodes(compile(src, "finding2-no-poison"))).not.toContain("E-EQ-001");
  });
});
