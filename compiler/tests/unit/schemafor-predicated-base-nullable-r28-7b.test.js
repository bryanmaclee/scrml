/**
 * schemafor-predicated-base-nullable-r28-7b.test.js — S177 r28-7b (LOW).
 *
 * SPEC §41.15.8a — a nullable field (`T | not`) lowers to T's column WITHOUT
 * NOT NULL/req. The schemaFor §41.15.8a conflict-case recovery (type-system.ts
 * ~15559) reconstitutes the non-`not` member of a `[asIs, not]` union (where the
 * top-level `|` split + a trailing predicate dropped the base member to `asIs`).
 *
 * BUG r28-7b: that recovery ONLY called `_schemaForRecoverEnumSubset`, which
 * needs an enum-subset head (`oneOf`/`notIn`) and returns null for a PREDICATED
 * PRIMITIVE base like `string req length(<=200)`. The base stayed `asIs`, so
 * `classifyFieldForSql([asIs, not])` yielded no-mapping → a bogus
 * E-SCHEMAFOR-NO-SQL-MAPPING on the field. The bare `string | not` control (no
 * predicate) worked.
 *
 * FIX: when the subset recovery returns null, fall back to recovering the
 * leading primitive token from the raw clause's non-`not` portion (mirror the
 * whole-field `asIs` recovery) and re-synthesize `[resolvedPrimitive, not]` so
 * the field rides the existing nullable path. CHECK constraints parse
 * independently from the raw clause (parseValidatorClauses) and are unaffected.
 *
 * Coverage:
 *   §1 — `bio: string req length(<=200) | not` compiles clean (was the bug)
 *   §2 — control `bio: string | not` (no predicate) still clean
 *   §3 — `count: integer min(0) | not` (predicated int base) clean
 *   §4 — enum-subset `role: Role oneOf([.A,.B]) | not` still clean (no regress)
 *   §5 — classifyFieldForSql([string, not]) → ok/text/nullable (mapping proof)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { classifyFieldForSql } from "../../src/codegen/emit-schema-for.ts";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "r28-7b-schemafor-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function schemaForErrors(result) {
  return (result.errors || [])
    .filter((e) => e && e.severity !== "warning" && e.severity !== "info")
    .filter((e) => e.code && e.code.startsWith("E-SCHEMAFOR-"))
    .map((e) => e.code);
}

describe("§1 predicated primitive base in `| not` union (r28-7b)", () => {
  test("`bio: string req length(<=200) | not` compiles clean (no E-SCHEMAFOR-NO-SQL-MAPPING)", () => {
    const result = compile("fix.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Profile:struct = {
    name: string req length(>=2, <=80)
    bio:  string req length(<=200) | not
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Profile) }
  </>
</program>`);
    expect(schemaForErrors(result)).toEqual([]);
  });
});

describe("§2 control — bare `string | not` (no predicate)", () => {
  test("`bio: string | not` still compiles clean", () => {
    const result = compile("ctrl.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Profile:struct = {
    name: string req length(>=2, <=80)
    bio:  string | not
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Profile) }
  </>
</program>`);
    expect(schemaForErrors(result)).toEqual([]);
  });
});

describe("§3 predicated integer base in `| not` union", () => {
  test("`count: integer min(0) | not` compiles clean", () => {
    const result = compile("int.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Profile:struct = {
    name:  string req
    count: integer min(0) | not
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Profile) }
  </>
</program>`);
    expect(schemaForErrors(result)).toEqual([]);
  });
});

describe("§4 enum-subset `| not` (existing path, no regression)", () => {
  test("`role: Role oneOf([.Admin, .Editor]) | not` still compiles clean", () => {
    const result = compile("enum.scrml", `\${
  import { schemaFor } from 'scrml:data'
  type Role:enum = { Admin, Editor, Viewer }
  type Profile:struct = {
    name: string req
    role: Role oneOf([.Admin, .Editor]) | not
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Profile) }
  </>
</program>`);
    expect(schemaForErrors(result)).toEqual([]);
  });
});

describe("§5 mapping proof — [string, not] -> ok/text/nullable", () => {
  test("classifyFieldForSql([string, not]) is the nullable text column", () => {
    const r = classifyFieldForSql({
      kind: "union",
      members: [{ kind: "primitive", name: "string" }, { kind: "not" }],
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.columnType).toBe("text");
      expect(r.nullable).toBe(true);
    }
  });
});
