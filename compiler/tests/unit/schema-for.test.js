/**
 * §41.15 (S104) — schemaFor compile-pipeline tests.
 *
 * End-to-end coverage of the 8 normative error codes per §41.15.1, §41.15.4,
 * §41.15.7, §41.15.8 — each gets at least one fire test and one no-fire
 * (acceptance) test:
 *
 *   §1  — Happy path: canonical examples compile cleanly + emit expected
 *         shared-core table-declaration text + the flagship enum-lowering
 *         (OQ-SCH-12 — bare-variant enum fields lower to oneOf([...])).
 *   §2  — E-SCHEMAFOR-TYPE-NOT-STRUCT — first arg is not a `:struct`.
 *   §3  — E-SCHEMAFOR-PICK-INVALID-FIELD — pick names a non-field.
 *   §4  — E-SCHEMAFOR-OMIT-INVALID-FIELD — omit names a non-field.
 *   §5  — E-SCHEMAFOR-PICK-OMIT-CONFLICT — both pick + omit given.
 *   §6  — E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1 — struct field; FK derivation deferred.
 *   §7  — E-SCHEMAFOR-NO-SQL-MAPPING — field type has no v1.0 SQL mapping.
 *   §8  — E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1 — payload-bearing enum field.
 *   §9  — E-SCHEMAFOR-INVALID-CALL-CONTEXT — call outside `<schema>` block.
 *   §10 — Pluralization rule (SPEC §41.15.2 lowercase + trailing `s`).
 *   §11 — Pick/omit transforms behave correctly + multi-table composition.
 *   §12 — Pure-function helper coverage (pluralize, classifyFieldForSql,
 *         lowerFieldToSharedCore, renderValidator).
 *
 * Uses compileScrml (full pipeline) because schemaFor is imported from
 * `scrml:data` and import resolution requires the full MOD + TS path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  pluralizeStructName,
  classifyFieldForSql,
  lowerFieldToSharedCore,
  renderValidator,
  expandSchemaFor,
} from "../../src/codegen/emit-schema-for.ts";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "schema-for-unit-"));
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
// §1 — Happy path
// ---------------------------------------------------------------------------

describe("§1 schemaFor happy path", () => {
  test("canonical User example compiles cleanly", () => {
    const result = compile("happy/user.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type UserRole:enum = { Admin, Editor, Viewer }
  type User:struct = {
    email: string req length(<=120)
    name:  string req length(>=2, <=80)
    role:  UserRole req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`);
    const errs = realErrors(result);
    const sfErrs = errs.filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });

  test("primitive-only struct compiles cleanly", () => {
    const result = compile("happy/primitives.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Note:struct = {
    title: string req
    body:  string req length(>=1)
    published: boolean
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Note) }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });

  test("integer + number + boolean fields compile cleanly", () => {
    const result = compile("happy/numeric.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Stats:struct = {
    count:   integer min(0)
    score:   number min(0) max(1.0)
    active:  boolean req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Stats) }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });

  // C3 (R27): bare `int` struct field is an alias of `integer` and must lower
  // to an `integer` SQL column, NOT resolve to `asIs` (which previously fired
  // E-SCHEMAFOR-NO-SQL-MAPPING). Mirrors the `bool`→`boolean` alias.
  test("bare `int` struct field compiles cleanly + lowers to integer", () => {
    const result = compile("happy/int-alias.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type T:struct = {
    id:   int
    name: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(T) }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — E-SCHEMAFOR-TYPE-NOT-STRUCT
// ---------------------------------------------------------------------------

describe("§2 E-SCHEMAFOR-TYPE-NOT-STRUCT", () => {
  test("first arg is an :enum type → fires", () => {
    const result = compile("err/type-enum.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Status:enum = { Pending, Active, Archived }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Status) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-TYPE-NOT-STRUCT");
  });

  test("first arg is an undeclared type → fires", () => {
    const result = compile("err/type-undeclared.scrml", `\${
  import { schemaFor } from 'scrml:data'
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(NeverDeclared) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-TYPE-NOT-STRUCT");
  });

  test("first arg is a string-literal → fires", () => {
    const result = compile("err/type-string.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = { name: string }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor("User") }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-TYPE-NOT-STRUCT");
  });

  test("first arg is a valid struct → does NOT fire", () => {
    const result = compile("no-fire/type-struct.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = { name: string req }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-TYPE-NOT-STRUCT");
  });
});

// ---------------------------------------------------------------------------
// §3 — E-SCHEMAFOR-PICK-INVALID-FIELD
// ---------------------------------------------------------------------------

describe("§3 E-SCHEMAFOR-PICK-INVALID-FIELD", () => {
  test("pick names a non-field → fires", () => {
    const result = compile("err/pick-invalid.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string
    email: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { pick: ["name", "phoneNumber"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-PICK-INVALID-FIELD");
  });

  test("pick lists only valid fields → does NOT fire", () => {
    const result = compile("no-fire/pick-valid.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string
    email: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { pick: ["name"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-PICK-INVALID-FIELD");
  });
});

// ---------------------------------------------------------------------------
// §4 — E-SCHEMAFOR-OMIT-INVALID-FIELD
// ---------------------------------------------------------------------------

describe("§4 E-SCHEMAFOR-OMIT-INVALID-FIELD", () => {
  test("omit names a non-field → fires", () => {
    const result = compile("err/omit-invalid.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string
    email: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { omit: ["middleName"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-OMIT-INVALID-FIELD");
  });

  test("omit lists only valid fields → does NOT fire", () => {
    const result = compile("no-fire/omit-valid.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string
    email: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { omit: ["email"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-OMIT-INVALID-FIELD");
  });
});

// ---------------------------------------------------------------------------
// §5 — E-SCHEMAFOR-PICK-OMIT-CONFLICT
// ---------------------------------------------------------------------------

describe("§5 E-SCHEMAFOR-PICK-OMIT-CONFLICT", () => {
  test("both pick + omit given → fires", () => {
    const result = compile("err/pick-omit.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string
    email: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { pick: ["name"], omit: ["email"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-PICK-OMIT-CONFLICT");
  });

  test("pick alone → does NOT fire", () => {
    const result = compile("no-fire/pick-alone.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = { name: string, email: string }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { pick: ["name"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-PICK-OMIT-CONFLICT");
  });

  test("omit alone → does NOT fire", () => {
    const result = compile("no-fire/omit-alone.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = { name: string, email: string }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { omit: ["email"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-PICK-OMIT-CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// §6 — E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1
// ---------------------------------------------------------------------------

describe("§6 E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1", () => {
  test("struct field with nested struct → fires", () => {
    const result = compile("err/nested-struct.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Address:struct = {
    street: string req
    city:   string req
  }
  type User:struct = {
    name:    string req
    address: Address
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1");
  });

  test("primitive-only struct → does NOT fire", () => {
    const result = compile("no-fire/flat-struct.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string req
    email: string req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1");
  });

  test("nested struct excluded via omit → does NOT fire", () => {
    const result = compile("no-fire/nested-omitted.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Address:struct = { street: string req }
  type User:struct = {
    name:    string req
    address: Address
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { omit: ["address"] }) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1");
  });
});

// ---------------------------------------------------------------------------
// §7 — E-SCHEMAFOR-NO-SQL-MAPPING
// ---------------------------------------------------------------------------

describe("§7 E-SCHEMAFOR-NO-SQL-MAPPING", () => {
  test("array field type → fires", () => {
    const result = compile("err/array-field.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Doc:struct = {
    title: string req
    tags:  [string]
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Doc) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-NO-SQL-MAPPING");
  });

  test("all-primitive struct → does NOT fire", () => {
    const result = compile("no-fire/all-primitive.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Doc:struct = {
    title:  string req
    score:  number
    active: boolean
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Doc) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-NO-SQL-MAPPING");
  });
});

// ---------------------------------------------------------------------------
// §8 — E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1
// ---------------------------------------------------------------------------

describe("§8 E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1", () => {
  test("payload-bearing enum field → fires", () => {
    const result = compile("err/payload-enum.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type ParseResult:enum = {
    Ok(value: string)
    Err(reason: string)
  }
  type Job:struct = {
    name:   string req
    result: ParseResult
  }
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

  test("bare-variant enum field → does NOT fire (the flagship enum-lowering path)", () => {
    const result = compile("no-fire/bare-variant-enum.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type Status:enum = { Pending, Active, Archived }
  type Task:struct = {
    name:   string req
    status: Status req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(Task) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1");
  });
});

// ---------------------------------------------------------------------------
// §9 — E-SCHEMAFOR-INVALID-CALL-CONTEXT
// ---------------------------------------------------------------------------

describe("§9 E-SCHEMAFOR-INVALID-CALL-CONTEXT", () => {
  test("schemaFor called at top-level logic position → fires", () => {
    const result = compile("err/call-context-toplevel.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = { name: string req }

  const sql = schemaFor(User)
}
<program>
  <body>
    <p>nothing here</p>
  </body>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-SCHEMAFOR-INVALID-CALL-CONTEXT");
  });

  test("schemaFor inside <schema> block → does NOT fire", () => {
    const result = compile("no-fire/call-context-schema.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = { name: string req }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
  </>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).not.toContain("E-SCHEMAFOR-INVALID-CALL-CONTEXT");
  });
});

// ---------------------------------------------------------------------------
// §10 — Pluralization rule (pure helper)
// ---------------------------------------------------------------------------

describe("§10 pluralizeStructName (SPEC §41.15.2)", () => {
  test("'User' → 'users'", () => {
    expect(pluralizeStructName("User")).toBe("users");
  });

  test("'LoadAssignment' → 'loadassignments' (no snake_case)", () => {
    // SPEC §41.15.2 is authoritative: lowercase + trailing s. Deep-dive
    // snake_case framing is superseded.
    expect(pluralizeStructName("LoadAssignment")).toBe("loadassignments");
  });

  test("'Person' → 'persons' (intentionally imperfect — irregular)", () => {
    expect(pluralizeStructName("Person")).toBe("persons");
  });

  test("'Child' → 'childs' (intentionally imperfect — irregular)", () => {
    expect(pluralizeStructName("Child")).toBe("childs");
  });

  test("'News' → 'news' (already ends in s)", () => {
    expect(pluralizeStructName("News")).toBe("news");
  });

  test("'Status' → 'status' (already ends in s)", () => {
    expect(pluralizeStructName("Status")).toBe("status");
  });

  test("empty string → empty string", () => {
    expect(pluralizeStructName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §11 — Pick / omit transforms + multi-table composition
// ---------------------------------------------------------------------------

describe("§11 transforms + multi-table composition", () => {
  test("pick: ['name'] restricts the included field set", () => {
    const result = compile("xform/pick.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:   string req
    email:  string req
    secret: string
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User, { pick: ["name"] }) }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });

  test("multi-table composition — two schemaFor calls in one <schema>", () => {
    const result = compile("xform/multi.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string req
    email: string req
  }
  type Post:struct = {
    title: string req
    body:  string req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }
    \${ schemaFor(Post) }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });

  test("interleaved hand-authored + schemaFor compiles", () => {
    const result = compile("xform/interleaved.scrml", `\${
  import { schemaFor } from 'scrml:data'

  type User:struct = {
    name:  string req
    email: string req
  }
}
<program db="./db.sqlite">
  <schema>
    \${ schemaFor(User) }

    posts {
      author_id: integer req references(users.id)
      title:     text req length(<=200)
    }
  </>
</program>
`);
    const sfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-SCHEMAFOR-"));
    expect(sfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §12 — Pure-function helper coverage
// ---------------------------------------------------------------------------

describe("§12 classifyFieldForSql", () => {
  test("primitive string → ok with text columnType", () => {
    const r = classifyFieldForSql({ kind: "primitive", name: "string" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.columnType).toBe("text");
  });

  test("primitive integer → ok with integer columnType", () => {
    const r = classifyFieldForSql({ kind: "primitive", name: "integer" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.columnType).toBe("integer");
  });

  test("primitive boolean → ok with boolean columnType", () => {
    const r = classifyFieldForSql({ kind: "primitive", name: "boolean" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.columnType).toBe("boolean");
  });

  test("nested struct → nested-struct mapping", () => {
    const r = classifyFieldForSql({ kind: "struct", name: "Address", fields: new Map() });
    expect(r.kind).toBe("nested-struct");
  });

  test("bare-variant enum → bare-enum mapping with variant names captured", () => {
    const r = classifyFieldForSql({
      kind: "enum",
      name: "Status",
      variants: [{ name: "Pending", payload: null }, { name: "Active", payload: null }],
    });
    expect(r.kind).toBe("bare-enum");
    if (r.kind === "bare-enum") {
      expect(r.enumName).toBe("Status");
      expect(r.variants).toEqual(["Pending", "Active"]);
    }
  });

  test("payload-bearing enum → payload-enum mapping", () => {
    const payload = new Map();
    payload.set("value", { kind: "primitive", name: "string" });
    const r = classifyFieldForSql({
      kind: "enum",
      name: "Result",
      variants: [{ name: "Ok", payload }, { name: "Err", payload: null }],
    });
    expect(r.kind).toBe("payload-enum");
  });

  test("array field type → no-mapping", () => {
    const r = classifyFieldForSql({ kind: "array", element: { kind: "primitive", name: "string" } });
    expect(r.kind).toBe("no-mapping");
  });

  test("function/asIs/unknown → no-mapping", () => {
    expect(classifyFieldForSql({ kind: "asIs" }).kind).toBe("no-mapping");
    expect(classifyFieldForSql({ kind: "function" }).kind).toBe("no-mapping");
    expect(classifyFieldForSql({ kind: "unknown" }).kind).toBe("no-mapping");
  });

  test("null / non-object input → no-mapping", () => {
    expect(classifyFieldForSql(null).kind).toBe("no-mapping");
    expect(classifyFieldForSql(undefined).kind).toBe("no-mapping");
    expect(classifyFieldForSql("string").kind).toBe("no-mapping");
  });
});

describe("§12 renderValidator", () => {
  test("bare req → 'req'", () => {
    expect(renderValidator({ name: "req", argsRaw: null })).toBe("req");
  });

  test("length(>=2) round-trip", () => {
    expect(renderValidator({ name: "length", argsRaw: ">=2" })).toBe("length(>=2)");
  });

  test("oneOf already bracketed preserved", () => {
    expect(renderValidator({ name: "oneOf", argsRaw: `["a", "b"]` })).toBe(`oneOf(["a", "b"])`);
  });

  test("oneOf un-bracketed is re-wrapped", () => {
    expect(renderValidator({ name: "oneOf", argsRaw: `"a", "b"` })).toBe(`oneOf(["a", "b"])`);
  });

  test("pattern with regex args preserved verbatim", () => {
    expect(renderValidator({ name: "pattern", argsRaw: "/^[^@]+@[^@]+$/" })).toBe("pattern(/^[^@]+@[^@]+$/)");
  });
});

describe("§12 lowerFieldToSharedCore", () => {
  test("primitive field with validators emits 'name: text req length(...)'", () => {
    const line = lowerFieldToSharedCore({
      name: "email",
      columnType: "text",
      validators: [{ name: "req", argsRaw: null }, { name: "length", argsRaw: "<=120" }],
      bareVariantNames: [],
    });
    expect(line).toBe("email: text req length(<=120)");
  });

  test("enum field auto-injects oneOf(['variants']) with single quotes per §39.5.8", () => {
    const line = lowerFieldToSharedCore({
      name: "status",
      columnType: "text",
      validators: [{ name: "req", argsRaw: null }],
      bareVariantNames: ["Pending", "Active", "Archived"],
    });
    expect(line).toBe(`status: text req oneOf(['Pending', 'Active', 'Archived'])`);
  });

  test("enum field with user-authored oneOf is NOT double-injected", () => {
    // If the adopter hand-narrowed the variant set on the field, honor it
    // over the full enum's variant list.
    const line = lowerFieldToSharedCore({
      name: "status",
      columnType: "text",
      validators: [
        { name: "req", argsRaw: null },
        { name: "oneOf", argsRaw: `["Active"]` },
      ],
      bareVariantNames: ["Pending", "Active", "Archived"],
    });
    // oneOf appears ONCE — the user's narrower set.
    const matches = line.match(/oneOf\(/g);
    expect(matches.length).toBe(1);
    expect(line).toContain(`oneOf(["Active"])`);
  });

  test("field with no validators emits bare 'name: type'", () => {
    const line = lowerFieldToSharedCore({
      name: "bio",
      columnType: "text",
      validators: [],
      bareVariantNames: [],
    });
    expect(line).toBe("bio: text");
  });
});

describe("§12 expandSchemaFor", () => {
  test("produces the full table-declaration text shape", () => {
    const text = expandSchemaFor({
      tableName: "users",
      structName: "User",
      includedFields: [
        { name: "email", columnType: "text", validators: [{ name: "req", argsRaw: null }], bareVariantNames: [] },
        { name: "name",  columnType: "text", validators: [{ name: "req", argsRaw: null }], bareVariantNames: [] },
      ],
      span: { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 },
    });
    expect(text).toContain("users {");
    expect(text).toContain("    email: text req");
    expect(text).toContain("    name: text req");
    expect(text).toContain("}");
    // Trailing newline for multi-table composition.
    expect(text.endsWith("\n")).toBe(true);
  });

  test("empty included fields emits bare 'tablename { }'", () => {
    const text = expandSchemaFor({
      tableName: "users",
      structName: "User",
      includedFields: [],
      span: { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 },
    });
    expect(text).toMatch(/^users \{\n\}\n$/);
  });
});
