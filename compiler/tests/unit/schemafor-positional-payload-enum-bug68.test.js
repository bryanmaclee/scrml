/**
 * Bug 68 (S157) — positional-payload enum variant not materialized at the
 * enum-parse layer → escaped E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1.
 *
 * Root cause: `type-system.ts parseEnumBody` (and the codegen-side
 * `emit-client.ts getAllVariantInfo` raw-fallback) required a `:` to record a
 * payload field. A POSITIONAL payload declaration — `Ok(int)` (no field name,
 * a bare type expr) — therefore materialized to a SIZE-0 payload Map and the
 * variant was misclassified as a bare-variant enum. The named form
 * (`Ok(value: int)`) materialized correctly and fired the rejection. This is
 * an ASYMMETRY: §34 / §41.15 cite `Result:enum = { Ok(int), Err(string) }`
 * (the POSITIONAL form) as the CANONICAL payload-bearing-enum exemplar for
 * E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1, so the positional form MUST classify as
 * payload-bearing.
 *
 * Fix: positional payload fields are recorded with a synthetic index-based key
 * `_<i>` (mirrors §18.7 positional binding + emit-logic.ts `schema[i] ?? _${i}`)
 * so the payload Map is non-empty and the variant classifies payload-bearing.
 * The synthetic key never surfaces to the adopter — positional bindings resolve
 * by index.
 *
 * Mirrors compiler/tests/unit/schema-for.test.js §8 assertion style.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { classifyFieldForSql } from "../../src/codegen/emit-schema-for.ts";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "schemafor-bug68-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function realErrors(result) {
  return (result.errors || []).filter(e => e && e.severity !== "warning");
}

function compile(filename, source) {
  const abs = fx(filename, source);
  return compileScrml({
    inputFiles: [abs],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
}

// ---------------------------------------------------------------------------
// Bug 68 — the asymmetry: positional payload now fires (parity with named).
// ---------------------------------------------------------------------------

describe("Bug 68 — positional-payload enum schemaFor classification", () => {
  test("POSITIONAL payload `Ok(int)` → FIRES E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1 (the fix)", () => {
    const result = compile("a-positional.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Result:enum = { Ok(int), Err(string) }
  type Job:struct = { id: int, status: Result }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Job) }
  </>
</program>
`);
    const errs = realErrors(result);
    const codes = errs.map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1");
    // The diagnostic names the offending field + enum.
    const msg = errs.find(e => e.code === "E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1").message;
    expect(msg).toContain("field 'status'");
    expect(msg).toContain("payload-bearing enum 'Result'");
  });

  test("NAMED payload `Ok(value: int)` → still FIRES (no regression on the working sibling)", () => {
    const result = compile("b-named.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Result:enum = { Ok(value: int), Err(reason: string) }
  type Job:struct = { id: int, status: Result }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Job) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1");
  });

  test("BARE-variant enum `{ Admin, Editor, Viewer }` → stays CLEAN (no over-fire — the flagship lowering)", () => {
    const result = compile("c-bare.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Role:enum = { Admin, Editor, Viewer }
  type User:struct = { id: int, role: Role }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    // A genuinely bare-variant enum is legitimately lowerable (§41.15.6) — the
    // positional-payload fix must NOT make this over-fire.
    expect(sfErrs).toEqual([]);
  });

  test("MIXED struct: bare-variant field + positional-payload field → the payload field rejects", () => {
    const result = compile("d-mixed.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Role:enum = { Admin, Editor, Viewer }
  type Result:enum = { Ok(int), Err(string) }
  type Account:struct = { id: int, role: Role, status: Result }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Account) }
  </>
</program>
`);
    const errs = realErrors(result);
    const codes = errs.map(e => e.code);
    // The positional-payload `status: Result` field rejects; the bare `role`
    // field is independently lowerable (proven by the c-bare test).
    expect(codes).toContain("E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1");
    const msg = errs.find(e => e.code === "E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1").message;
    expect(msg).toContain("field 'status'");
    expect(msg).toContain("'Result'");
  });

  test("multi-field POSITIONAL payload `Rect(int, int)` → FIRES (each positional field keyed _0, _1)", () => {
    const result = compile("e-multifield.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Shape:enum = { Rect(int, int), Dot }
  type Drawing:struct = { id: int, shape: Shape }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Drawing) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1");
  });
});

// ---------------------------------------------------------------------------
// classifyFieldForSql direct-helper guard — a positionally-keyed payload Map
// (`_0` synthetic key) classifies payload-bearing, NOT bare-enum. Mirrors the
// schema-for.test.js §13 synthetic-type classify style. This pins the contract
// the parseEnumBody materialization now satisfies: a non-empty payload Map (by
// ANY key, including the synthetic `_<i>`) → payload-enum.
// ---------------------------------------------------------------------------

describe("Bug 68 — classifyFieldForSql honors synthetic positional payload keys", () => {
  test("enum with `_0`-keyed payload variant → payload-enum (not bare-enum)", () => {
    const payload = new Map();
    payload.set("_0", { kind: "primitive", name: "integer" });
    const en = {
      kind: "enum",
      name: "Result",
      variants: [
        { name: "Ok", payload },
        { name: "Err", payload: null },
      ],
    };
    const r = classifyFieldForSql(en);
    expect(r.kind).toBe("payload-enum");
    if (r.kind === "payload-enum") expect(r.enumName).toBe("Result");
  });

  test("enum with all-unit variants (null payload) → bare-enum (regression guard)", () => {
    const en = {
      kind: "enum",
      name: "Role",
      variants: [
        { name: "Admin", payload: null },
        { name: "Editor", payload: null },
      ],
    };
    const r = classifyFieldForSql(en);
    expect(r.kind).toBe("bare-enum");
    if (r.kind === "bare-enum") expect(r.variants).toEqual(["Admin", "Editor"]);
  });
});

// ---------------------------------------------------------------------------
// tableFor sibling — the fix is at the SHARED enum-parse materialization point
// (`parseEnumBody` populates the type registry both schemaFor + tableFor read),
// so a positional-payload enum column ALSO now classifies payload-bearing and
// fires E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1. Mirrors table-for.test.js §10.
// ---------------------------------------------------------------------------

describe("Bug 68 — positional-payload enum tableFor classification (shared materialization)", () => {
  test("POSITIONAL payload column `Ok(int)` → FIRES E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1", () => {
    const result = compile("t-positional.scrml", `\${
  import { tableFor } from 'scrml:data'
  type Result:enum = { Ok(int), Err(string) }
  type Item:struct = { id: int, result: Result }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items/>
</program>
`);
    const errs = realErrors(result);
    const code = errs.find(e => e.code === "E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1");
    expect(code).toBeDefined();
    expect(code.message).toContain("'result'");
    expect(code.message).toContain("'Result'");
  });
});
