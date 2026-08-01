/**
 * E-TYPE-UNKNOWN-NAME — every type must be defined (§14.1.2 / §34).
 *
 * An unrecognized (typo'd / undefined) PascalCase type NAME in ANY type-
 * annotation position is a hard ERROR. Before this check it resolved SILENTLY to
 * `asIs` with ZERO diagnostic (the leak the §14.1.1 `any`-reject deferred). The
 * sanctioned untyped escape hatch is `asIs` (a named opt-out), which does NOT
 * fire. A built-in, a same-file declaration (incl. a forward ref), and an
 * imported type all resolve and do NOT fire.
 *
 * E- prefix → result.errors (fatal). Tests assert over BOTH streams via a
 * cross-stream helper so a partition regression (an E- code silently moving to
 * result.warnings) is caught rather than silently passing.
 *
 * Ratified S174 (committed follow-on to the any-reject). Fire site:
 * type-system.ts `checkUnknownTypeNames` (registry-dependent, post import-seed).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "unknown-forbidden-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream: E- partitions to result.errors, but assert over BOTH streams so
// a partition regression is caught (memory: a result.errors.filter on a W-/I-
// code silently passes; lock the partition for the E- code too).
function unknownDiags(res) {
  return [...(res.errors || []), ...(res.warnings || [])]
    .filter((d) => d.code === "E-TYPE-UNKNOWN-NAME");
}
function partitionOk(res) {
  // E- code must NEVER land in result.warnings.
  const inWarnings = (res.warnings || []).some((d) => d.code === "E-TYPE-UNKNOWN-NAME");
  return !inWarnings;
}

// ---------------------------------------------------------------------------
// POSITIVE — an unknown name fires in every type-annotation position
// ---------------------------------------------------------------------------

describe("E-TYPE-UNKNOWN-NAME — positive (fires at every locus)", () => {
  test("state-cell annotation `<x>: Frobnicate` fires", () => {
    const res = compile(`<ul>
\${ <x>: Frobnicate = 0 }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
    expect(partitionOk(res)).toBe(true);
    expect((res.errors || []).some((d) => d.code === "E-TYPE-UNKNOWN-NAME")).toBe(true);
  });

  test("struct field type fires", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: Frobnicate, b: string } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
    expect(partitionOk(res)).toBe(true);
  });

  test("enum-variant payload field type fires", () => {
    const res = compile(`<ul>
\${ type P:enum = { Ok(p: Frobnicate), Err } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
    expect(partitionOk(res)).toBe(true);
  });

  test("type-alias RHS fires", () => {
    const res = compile(`<ul>
\${ type A = Frobnicate }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
    expect(partitionOk(res)).toBe(true);
  });

  test("fn parameter type fires", () => {
    const res = compile(`<ul>
\${ fn f(x: Frobnicate) -> string { return "" } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
  });

  test("fn return type fires", () => {
    const res = compile(`<ul>
\${ fn g() -> Frobnicate { return 0 } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
  });

  test("array element type fires", () => {
    const res = compile(`<ul>
\${ <x>: Frobnicate[] = [] }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
  });

  test("inline-struct field type fires", () => {
    const res = compile(`<ul>
\${ <x>: { a: Frobnicate } = {} }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
  });

  test("union member type fires", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: string | Frobnicate } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
  });

  test("map VALUE type fires", () => {
    const res = compile(`<ul>
\${ <m>: [string: Frobnicate] = {} }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — defined / sanctioned names do NOT fire
// ---------------------------------------------------------------------------

describe("E-TYPE-UNKNOWN-NAME — negative (defined names stay clean)", () => {
  test("primitives string/number/int do NOT fire", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: string, b: number, c: int } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("`asIs` (the escape hatch) does NOT fire at any locus", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: asIs } }
\${ type A = asIs }
\${ type P:enum = { Ok(p: asIs), Err } }
\${ <x>: asIs = 0 }
\${ <y>: asIs[] = [] }
\${ fn f(p: asIs) -> asIs { return p } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("named-shape lowercase vocabulary (email/url/uuid/phone/date/time/color) do NOT fire", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: email, b: url, c: uuid, d: phone, e: date, f: time, g: color } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("built-in error types do NOT fire", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: NetworkError, b: ValidationError, c: SQLError } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("same-file declared struct name does NOT fire", () => {
    const res = compile(`<ul>
\${ type Inner:struct = { x: number } }
\${ type Outer:struct = { i: Inner } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("forward-ref (referenced before declared) does NOT fire", () => {
    const res = compile(`<ul>
\${ type Outer:struct = { i: Inner } }
\${ type Inner:struct = { x: number } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("PascalCase substring guard — `Company` does NOT fire (it is declared)", () => {
    const res = compile(`<ul>
\${ type Company:struct = { name: string } }
\${ type T:struct = { c: Company } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("trailing validators stripped — `Status req` does NOT fire (Status declared)", () => {
    const res = compile(`<ul>
\${ type Status:enum = { Active, Done } }
\${ type T:struct = { s: Status req } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("enum-subset `Status oneOf([.Active])` does NOT fire (variant literals carved)", () => {
    const res = compile(`<ul>
\${ type Status:enum = { Active, Done } }
\${ <s>: Status oneOf([.Active]) = .Active }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });

  test("inline predicate `number(>0)` does NOT fire", () => {
    const res = compile(`<ul>
\${ type T:struct = { n: number(>0) } }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CROSS-FILE — imported types are exempt (multi-file AND aliased), single-file too
// ---------------------------------------------------------------------------

describe("E-TYPE-UNKNOWN-NAME — cross-file imports exempt", () => {
  function compileDir(files) {
    const dir = mkdtempSync(join(TMP, "proj-"));
    let entry = null;
    for (const [rel, content] of Object.entries(files)) {
      const fp = join(dir, rel);
      writeFileSync(fp, content);
      if (rel === "main.scrml") entry = fp;
    }
    return compileScrml({ inputFiles: [entry], outputDir: join(dir, "dist"), write: false, log: () => {} });
  }

  test("multi-file: imported struct name does NOT fire", () => {
    const res = compileDir({
      "dep.scrml": `<ul>\n\${ export type Row:struct = { id: number } }\n<li>d</li>\n</ul>`,
      "main.scrml": `<ul>\n\${ import { Row } from './dep.scrml' }\n\${ <rows>: Row[] = [] }\n<li>m</li>\n</ul>`,
    });
    expect(unknownDiags(res).length).toBe(0);
  });

  test("multi-file aliased import: `import { Row as LocalRow }` does NOT fire on the alias", () => {
    const res = compileDir({
      "dep.scrml": `<ul>\n\${ export type Row:struct = { id: number } }\n<li>d</li>\n</ul>`,
      "main.scrml": `<ul>\n\${ import { Row as LocalRow } from './dep.scrml' }\n\${ <rows>: LocalRow[] = [] }\n<li>m</li>\n</ul>`,
    });
    expect(unknownDiags(res).length).toBe(0);
  });

  test("single-file mode: an imported name (dep NOT in compile set) does NOT false-fire", () => {
    // Compile ONLY the importing file — no dep is processed, so the imported
    // type is genuinely absent from the registry; the import-specifier exemption
    // must keep it clean (the flagship board.scrml single-file landmine).
    const res = compile(`<ul>
\${ import { Row } from './not-compiled.scrml' }
\${ <rows>: Row[] = [] }
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// INTERACTION — an unknown MAP KEY is owned by E-MAP-KEY-NOT-COMPARABLE (no double-fire)
// ---------------------------------------------------------------------------

describe("E-TYPE-UNKNOWN-NAME — map-key interaction", () => {
  test("unknown map KEY fires E-MAP-KEY-NOT-COMPARABLE but NOT E-TYPE-UNKNOWN-NAME (no double-fire)", () => {
    const res = compile(`<ul>
\${ <m>: [Frobnicate: string] = {} }
<li>x</li>
</ul>`);
    const all = [...(res.errors || []), ...(res.warnings || [])];
    // The existing map-key check still owns this locus.
    expect(all.some((d) => d.code === "E-MAP-KEY-NOT-COMPARABLE")).toBe(true);
    // The unknown-name check defers to it (no double-fire on the key position).
    expect(unknownDiags(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MACHINE-TYPED CELL — a machine name is NOT a typeRegistry type; must NOT fire
// ---------------------------------------------------------------------------

describe("E-TYPE-UNKNOWN-NAME — machine-typed state cell exempt", () => {
  test("`@state: M` where `< engine name=M for=S>` does NOT fire (machine lives in machineRegistry)", () => {
    const res = compile(`<ul>
\${ type S:enum = { Idle, Run } }
\${
  @state: M = S.Idle
}
< engine name=M for=S>
  .Idle => .Run
</ machine>
<li>x</li>
</ul>`);
    expect(unknownDiags(res).length).toBe(0);
  });
});
