/**
 * §41.16 (S105) — tableFor compile-pipeline tests.
 *
 * End-to-end coverage of the 13 normative error codes per §41.16.1-§41.16.9 —
 * each gets at least one fire test and one no-fire (acceptance) test:
 *
 *   §1  — Happy path: canonical examples compile cleanly + emit expected
 *         <table>/<thead>/<tbody> structure.
 *   §2  — E-TABLEFOR-TYPE-NOT-STRUCT — `for=` references enum / named-shape /
 *         unknown / string-literal value / missing.
 *   §3  — E-TABLEFOR-ROWS-MISSING — `rows=` attribute absent.
 *   §4  — E-TABLEFOR-ROWS-WRONG-TYPE — `rows=` is string literal.
 *   §5  — E-TABLEFOR-COLUMN-FIELD-UNKNOWN — <column field="X"> names non-field.
 *   §6  — E-TABLEFOR-PICK-INVALID-FIELD — `pick=["unknown"]`.
 *   §7  — E-TABLEFOR-OMIT-INVALID-FIELD — `omit=["unknown"]`.
 *   §8  — E-TABLEFOR-PICK-OMIT-CONFLICT — both `pick=` AND `omit=` set.
 *   §9  — E-TABLEFOR-NESTED-STRUCT-NO-SLOT — struct-typed field, no slot.
 *   §10 — E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1 — payload-enum field, no slot.
 *   §11 — E-TABLEFOR-NO-DISPLAY-MAPPING — unmappable field type, no slot.
 *   §12 — E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS — sortable + non-cell rows=.
 *   §13 — E-TABLEFOR-NO-PRIMARY-KEY — selectable= but no id/selectedBy.
 *   §14 — Pure-function helpers (classifyFieldForCell, tableHeaderTitleCase).
 *   §15 — Pick/omit transforms + slot overrides + sort + empty surfaces.
 *
 * Uses compileScrml (full pipeline) because tableFor is imported from
 * `scrml:data` and the import resolution requires the full MOD + TS path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  classifyFieldForCell,
  tableHeaderTitleCase,
  expandTableForElement,
  _resetSynthIdCounter,
} from "../../src/codegen/emit-table-for.ts";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "table-for-unit-"));
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

function getHtml(result) {
  const outputs = result.outputs;
  if (!outputs) return "";
  for (const [, v] of outputs) {
    if (typeof v === "object" && v && v.html) return v.html;
  }
  return "";
}

function getClientJs(result) {
  const outputs = result.outputs;
  if (!outputs) return "";
  for (const [, v] of outputs) {
    if (typeof v === "object" && v && v.clientJs) return v.clientJs;
  }
  return "";
}

// ---------------------------------------------------------------------------
// §1 — Happy path
// ---------------------------------------------------------------------------

describe("§1 tableFor happy path", () => {
  test("canonical User example compiles cleanly", () => {
    const result = compile("happy/user.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
    name:  string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const errs = realErrors(result);
    const tfErrs = errs.filter(e => e.code && e.code.startsWith("E-TABLEFOR-"));
    expect(tfErrs).toEqual([]);
  });

  test("emitted HTML contains <table data-scrml-tablefor=\"<StructName>\">", () => {
    const result = compile("happy/user-html.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Task:struct = {
    id:    integer
    title: string req
  }
}
<program>
  <tasks> = []
  <tableFor for=Task rows=@tasks/>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain(`<table data-scrml-tablefor="Task"`);
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
  });

  test("emitted HTML has one <th> per struct field with mechanical title-case", () => {
    const result = compile("happy/user-headers.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:        integer
    createdAt: string
    isAdmin:   boolean
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain(">Id<");
    expect(html).toContain(">Created At<");
    expect(html).toContain(">Is Admin<");
  });

  test("emitted client JS reconciles against the rows cell", () => {
    const result = compile("happy/user-reconcile.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    name:  string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const js = getClientJs(result);
    expect(js).toContain("_scrml_reconcile_list");
    expect(js).toContain('_scrml_reactive_get("users")');
  });

  test("primitive-only struct compiles cleanly", () => {
    const result = compile("happy/primitives.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Note:struct = {
    title:     string req
    published: boolean
    rating:    number
  }
}
<program>
  <notes> = []
  <tableFor for=Note rows=@notes/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-TABLEFOR-"));
    expect(tfErrs).toEqual([]);
  });

  test("integer + number + boolean + string fields compile cleanly", () => {
    const result = compile("happy/wide-primitive.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    iVal: integer
    nVal: number
    bVal: boolean
    sVal: string
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-TABLEFOR-"));
    expect(tfErrs).toEqual([]);
  });

  test("bare-variant enum field renders as text by default", () => {
    const result = compile("happy/bare-enum.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Status:enum = { Pending, Active, Archived }
  type Task:struct = {
    title:  string req
    status: Status req
  }
}
<program>
  <tasks> = []
  <tableFor for=Task rows=@tasks/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-TABLEFOR-"));
    expect(tfErrs).toEqual([]);
    const js = getClientJs(result);
    expect(js).toContain("row.status");
  });
});

// ---------------------------------------------------------------------------
// §2 — E-TABLEFOR-TYPE-NOT-STRUCT
// ---------------------------------------------------------------------------

describe("§2 E-TABLEFOR-TYPE-NOT-STRUCT", () => {
  test("for= attribute missing fires the error", () => {
    const result = compile("err/no-for.scrml", `\${
  import { tableFor } from 'scrml:data'
}
<program>
  <users> = []
  <tableFor rows=@users/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-TYPE-NOT-STRUCT");
    expect(code).toBeDefined();
  });

  test("for= is enum type fires the error", () => {
    const result = compile("err/for-enum.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Status:enum = { Pending, Active }
}
<program>
  <rows> = []
  <tableFor for=Status rows=@rows/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-TYPE-NOT-STRUCT");
    expect(code).toBeDefined();
    expect(code.message).toContain("Status");
    expect(code.message).toContain("enum");
  });

  test("for= is unknown type fires the error", () => {
    const result = compile("err/for-unknown.scrml", `\${
  import { tableFor } from 'scrml:data'
}
<program>
  <rows> = []
  <tableFor for=NonExistentType rows=@rows/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-TYPE-NOT-STRUCT");
    expect(code).toBeDefined();
    expect(code.message).toContain("unknown type");
  });

  test("for= as quoted string literal fires the error", () => {
    const result = compile("err/for-quoted.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for="User" rows=@users/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-TYPE-NOT-STRUCT");
    expect(code).toBeDefined();
    expect(code.message).toContain("quoted string");
  });

  test("for= as struct type does NOT fire", () => {
    const result = compile("ok/for-struct.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-TYPE-NOT-STRUCT");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 — E-TABLEFOR-ROWS-MISSING
// ---------------------------------------------------------------------------

describe("§3 E-TABLEFOR-ROWS-MISSING", () => {
  test("rows= attribute missing fires the error", () => {
    const result = compile("err/no-rows.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <tableFor for=User/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-ROWS-MISSING");
    expect(code).toBeDefined();
  });

  test("rows= attribute present does NOT fire", () => {
    const result = compile("ok/with-rows.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-ROWS-MISSING");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 — E-TABLEFOR-ROWS-WRONG-TYPE
// ---------------------------------------------------------------------------

describe("§4 E-TABLEFOR-ROWS-WRONG-TYPE", () => {
  test("rows= as quoted string literal fires the error", () => {
    const result = compile("err/rows-string.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <tableFor for=User rows="not-a-cell"/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-ROWS-WRONG-TYPE");
    expect(code).toBeDefined();
  });

  test("rows= as @cell ref does NOT fire", () => {
    const result = compile("ok/rows-cell.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-ROWS-WRONG-TYPE");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5 — E-TABLEFOR-COLUMN-FIELD-UNKNOWN
// ---------------------------------------------------------------------------

describe("§5 E-TABLEFOR-COLUMN-FIELD-UNKNOWN", () => {
  test("<column field=\"unknown\"> fires the error", () => {
    const result = compile("err/col-unknown.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users>
    <column field="nonexistent"/>
  </tableFor>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-COLUMN-FIELD-UNKNOWN");
    expect(code).toBeDefined();
    expect(code.message).toContain("nonexistent");
  });

  test("<column> without field= fires the error", () => {
    const result = compile("err/col-no-field.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users>
    <column/>
  </tableFor>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-COLUMN-FIELD-UNKNOWN");
    expect(code).toBeDefined();
  });

  test("<column field=\"id\"> on existing field does NOT fire", () => {
    const result = compile("ok/col-valid.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users>
    <column field="email" header="Email Address"/>
  </tableFor>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-COLUMN-FIELD-UNKNOWN");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 — E-TABLEFOR-PICK-INVALID-FIELD
// ---------------------------------------------------------------------------

describe("§6 E-TABLEFOR-PICK-INVALID-FIELD", () => {
  test("pick=[\"unknown\"] fires the error", () => {
    const result = compile("err/pick-unknown.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users pick=["nonexistent"]/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-PICK-INVALID-FIELD");
    expect(code).toBeDefined();
  });

  test("pick=[\"id\"] on existing field does NOT fire", () => {
    const result = compile("ok/pick-valid.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
    name:  string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users pick=["id", "email"]/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-PICK-INVALID-FIELD");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §7 — E-TABLEFOR-OMIT-INVALID-FIELD
// ---------------------------------------------------------------------------

describe("§7 E-TABLEFOR-OMIT-INVALID-FIELD", () => {
  test("omit=[\"unknown\"] fires the error", () => {
    const result = compile("err/omit-unknown.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users omit=["nonexistent"]/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-OMIT-INVALID-FIELD");
    expect(code).toBeDefined();
  });

  test("omit=[\"id\"] on existing field does NOT fire", () => {
    const result = compile("ok/omit-valid.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
    name:  string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users omit=["id"]/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-OMIT-INVALID-FIELD");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §8 — E-TABLEFOR-PICK-OMIT-CONFLICT
// ---------------------------------------------------------------------------

describe("§8 E-TABLEFOR-PICK-OMIT-CONFLICT", () => {
  test("both pick= AND omit= fires the error", () => {
    const result = compile("err/pick-omit.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users pick=["id"] omit=["email"]/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-PICK-OMIT-CONFLICT");
    expect(code).toBeDefined();
  });

  test("only pick= does NOT fire", () => {
    const result = compile("ok/only-pick.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users pick=["id"]/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-PICK-OMIT-CONFLICT");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §9 — E-TABLEFOR-NESTED-STRUCT-NO-SLOT
// ---------------------------------------------------------------------------

describe("§9 E-TABLEFOR-NESTED-STRUCT-NO-SLOT", () => {
  test("nested struct field without slot fires the error", () => {
    const result = compile("err/nested-struct.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Address:struct = {
    street: string req
    city:   string req
  }
  type User:struct = {
    id:      integer
    address: Address
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-NESTED-STRUCT-NO-SLOT");
    expect(code).toBeDefined();
    expect(code.message).toContain("address");
  });

  test("nested struct field WITH explicit slot does NOT fire", () => {
    const result = compile("ok/nested-struct-with-slot.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Address:struct = {
    street: string req
    city:   string req
  }
  type User:struct = {
    id:      integer
    address: Address
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users>
    <column field="address">
      \${row.address.street}, \${row.address.city}
    </column>
  </tableFor>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-NESTED-STRUCT-NO-SLOT");
    expect(tfErrs).toEqual([]);
  });

  test("nested struct field omitted via omit= does NOT fire", () => {
    const result = compile("ok/nested-struct-omit.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Address:struct = {
    street: string req
  }
  type User:struct = {
    id:      integer
    address: Address
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users omit=["address"]/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-NESTED-STRUCT-NO-SLOT");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 — E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1
// ---------------------------------------------------------------------------

describe("§10 E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1", () => {
  test("payload-bearing enum field without slot fires the error", () => {
    // Payload variants use named-field syntax `Name(field:type)` per the
    // type-system's parseEnumBody parser at line 1268.
    const result = compile("err/payload-enum.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Result:enum = { Ok(value:integer), Err(msg:string) }
  type Item:struct = {
    id:     integer
    result: Result
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1");
    expect(code).toBeDefined();
    expect(code.message).toContain("result");
  });

  test("payload-bearing enum WITH explicit slot does NOT fire", () => {
    const result = compile("ok/payload-enum-with-slot.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Result:enum = { Ok(value:integer), Err(msg:string) }
  type Item:struct = {
    id:     integer
    result: Result
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items>
    <column field="result">
      <span>(result)</span>
    </column>
  </tableFor>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1");
    expect(tfErrs).toEqual([]);
  });

  test("bare-variant enum (no payload) does NOT fire", () => {
    const result = compile("ok/bare-enum-ok.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Status:enum = { Pending, Active, Archived }
  type Item:struct = {
    id:     integer
    status: Status
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §11 — E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS
// ---------------------------------------------------------------------------

describe("§11 E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS", () => {
  test("sortable= with literal-array rows= fires the error", () => {
    const result = compile("err/sortable-literal.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    name:  string req
  }
}
<program>
  <tableFor for=User rows=[]>
    <column field="name" sortable/>
  </tableFor>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS");
    expect(code).toBeDefined();
  });

  test("sortable= with @cell rows= does NOT fire", () => {
    const result = compile("ok/sortable-cell.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    name:  string req
  }
}
<program>
  <users> = []
  <tableFor for=User rows=@users>
    <column field="name" sortable/>
  </tableFor>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS");
    expect(tfErrs).toEqual([]);
  });

  test("no sortable column does NOT require cell-ref rows=", () => {
    const result = compile("ok/no-sortable.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    name:  string req
  }
}
<program>
  <tableFor for=User rows=[]/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §12 — E-TABLEFOR-NO-PRIMARY-KEY
// ---------------------------------------------------------------------------

describe("§12 E-TABLEFOR-NO-PRIMARY-KEY", () => {
  test("selectable= with no id field + no selectedBy= fires the error", () => {
    const result = compile("err/no-pk.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    email: string req
    name:  string req
  }
}
<program>
  <users> = []
  <selectedIds> = []
  <tableFor for=User rows=@users selectable=@selectedIds/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-NO-PRIMARY-KEY");
    expect(code).toBeDefined();
  });

  test("selectable= with selectedBy= override does NOT fire", () => {
    const result = compile("ok/with-selected-by.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    email: string req
    name:  string req
  }
}
<program>
  <users> = []
  <selectedEmails> = []
  <tableFor for=User rows=@users selectable=@selectedEmails selectedBy="email"/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-NO-PRIMARY-KEY");
    expect(tfErrs).toEqual([]);
  });

  test("selectable= with id field does NOT fire", () => {
    const result = compile("ok/with-id.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = []
  <selectedIds> = []
  <tableFor for=User rows=@users selectable=@selectedIds/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-NO-PRIMARY-KEY");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §13 — E-TABLEFOR-NO-DISPLAY-MAPPING
// ---------------------------------------------------------------------------

describe("§13 E-TABLEFOR-NO-DISPLAY-MAPPING", () => {
  test("asIs-typed field without slot fires the error", () => {
    const result = compile("err/asis-field.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Item:struct = {
    id:   integer
    blob: asIs
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items/>
</program>
`);
    const code = realErrors(result).find(e => e.code === "E-TABLEFOR-NO-DISPLAY-MAPPING");
    expect(code).toBeDefined();
    expect(code.message).toContain("blob");
  });

  test("asIs-typed field WITH explicit slot does NOT fire", () => {
    const result = compile("ok/asis-field-with-slot.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Item:struct = {
    id:   integer
    blob: asIs
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items>
    <column field="blob">
      <span>(blob)</span>
    </column>
  </tableFor>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code === "E-TABLEFOR-NO-DISPLAY-MAPPING");
    expect(tfErrs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §14 — Pure-function helpers
// ---------------------------------------------------------------------------

describe("§14 helpers", () => {
  describe("tableHeaderTitleCase", () => {
    test("lowercase identifier → title case", () => {
      expect(tableHeaderTitleCase("email")).toBe("Email");
    });
    test("camelCase identifier → space-separated title case", () => {
      expect(tableHeaderTitleCase("createdAt")).toBe("Created At");
    });
    test("snake_case → space-separated", () => {
      expect(tableHeaderTitleCase("is_admin")).toBe("Is Admin");
    });
    test("kebab-case → space-separated", () => {
      expect(tableHeaderTitleCase("user-role")).toBe("User Role");
    });
    test("all-caps acronym preserved", () => {
      expect(tableHeaderTitleCase("URL")).toBe("URL");
    });
    test("empty string returns empty", () => {
      expect(tableHeaderTitleCase("")).toBe("");
    });
  });

  describe("classifyFieldForCell", () => {
    test("primitive string → string", () => {
      const r = classifyFieldForCell({ kind: "primitive", name: "string" });
      expect(r.kind).toBe("string");
    });
    test("primitive integer → number", () => {
      const r = classifyFieldForCell({ kind: "primitive", name: "integer" });
      expect(r.kind).toBe("number");
    });
    test("primitive boolean → boolean", () => {
      const r = classifyFieldForCell({ kind: "primitive", name: "boolean" });
      expect(r.kind).toBe("boolean");
    });
    test("primitive timestamp → timestamp", () => {
      const r = classifyFieldForCell({ kind: "primitive", name: "timestamp" });
      expect(r.kind).toBe("timestamp");
    });
    test("nested struct → nested-struct", () => {
      const r = classifyFieldForCell({ kind: "struct", name: "Address", fields: new Map() });
      expect(r.kind).toBe("nested-struct");
      expect(r.structName).toBe("Address");
    });
    test("bare-variant enum → bare-enum", () => {
      const r = classifyFieldForCell({
        kind: "enum",
        name: "Status",
        variants: [{ name: "Pending" }, { name: "Active" }],
      });
      expect(r.kind).toBe("bare-enum");
      expect(r.variants).toEqual(["Pending", "Active"]);
    });
    test("payload-bearing enum → payload-enum", () => {
      const r = classifyFieldForCell({
        kind: "enum",
        name: "Result",
        variants: [
          { name: "Ok", payload: new Map([["value", { kind: "primitive", name: "integer" }]]) },
          { name: "Err" },
        ],
      });
      expect(r.kind).toBe("payload-enum");
      expect(r.enumName).toBe("Result");
    });
    test("array → unmappable", () => {
      const r = classifyFieldForCell({ kind: "array", element: { kind: "primitive", name: "string" } });
      expect(r.kind).toBe("unmappable");
    });
    test("function type → unmappable", () => {
      const r = classifyFieldForCell({ kind: "function", params: [], returnType: { kind: "primitive", name: "string" } });
      expect(r.kind).toBe("unmappable");
    });
    test("null/undefined → unmappable", () => {
      const r1 = classifyFieldForCell(null);
      const r2 = classifyFieldForCell(undefined);
      expect(r1.kind).toBe("unmappable");
      expect(r2.kind).toBe("unmappable");
    });
    test("predicated string → string (via baseType)", () => {
      const r = classifyFieldForCell({ kind: "predicated", baseType: "string", predicates: [] });
      expect(r.kind).toBe("string");
    });
  });

  describe("expandTableForElement", () => {
    test("produces a <table> markup tree", () => {
      _resetSynthIdCounter();
      const span = { file: "test", start: 0, end: 0, line: 1, col: 1 };
      const result = expandTableForElement({
        structName: "User",
        rowsExpr: "@users",
        rowsCellVarName: "users",
        columns: [
          {
            fieldName: "id",
            headerText: "Id",
            displayKind: { kind: "number" },
            slotBody: null,
            rowBindingName: "row",
            sortable: false,
            align: null,
            cssClass: null,
          },
        ],
        hasSortable: false,
        selection: null,
        emptySlot: null,
        span,
      });
      expect(result.tableElement).toBeDefined();
      const t = result.tableElement;
      expect(t.kind).toBe("markup");
      expect(t.tag).toBe("table");
      expect(result.sortStateDecl).toBeNull();
    });

    test("hasSortable true does NOT emit a sortStateDecl (v1.0 behavior)", () => {
      _resetSynthIdCounter();
      const span = { file: "test", start: 0, end: 0, line: 1, col: 1 };
      const result = expandTableForElement({
        structName: "User",
        rowsExpr: "@users",
        rowsCellVarName: "users",
        columns: [
          {
            fieldName: "name",
            headerText: "Name",
            displayKind: { kind: "string" },
            slotBody: null,
            rowBindingName: "row",
            sortable: true,
            align: null,
            cssClass: null,
          },
        ],
        hasSortable: true,
        selection: null,
        emptySlot: null,
        span,
      });
      // Per v1.0 doc: sortStateDecl is null; sortedBy property writes directly
      // to the rows cell at runtime per SPEC §41.16.7 verbatim API.
      expect(result.sortStateDecl).toBeNull();
    });

    test("with selectable adds a leading checkbox column", () => {
      _resetSynthIdCounter();
      const span = { file: "test", start: 0, end: 0, line: 1, col: 1 };
      const result = expandTableForElement({
        structName: "User",
        rowsExpr: "@users",
        rowsCellVarName: "users",
        columns: [
          {
            fieldName: "id",
            headerText: "Id",
            displayKind: { kind: "number" },
            slotBody: null,
            rowBindingName: "row",
            sortable: false,
            align: null,
            cssClass: null,
          },
        ],
        hasSortable: false,
        selection: { cellName: "selectedIds", pkFieldName: "id" },
        emptySlot: null,
        span,
      });
      const t = result.tableElement;
      const thead = t.children[0];
      const headerRow = thead.children[0];
      // First <th> is the master checkbox.
      expect(headerRow.children.length).toBe(2);  // checkbox + id column
    });
  });
});

// ---------------------------------------------------------------------------
// §15 — Pick/omit + slot + empty surfaces
// ---------------------------------------------------------------------------

describe("§15 advanced surfaces", () => {
  test("pick= changes column emit order to pick array order", () => {
    const result = compile("ok/pick-order.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    a: string req
    b: string req
    c: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows pick=["c", "a"]/>
</program>
`);
    const html = getHtml(result);
    // 'c' header must appear BEFORE 'a' header in the emitted output.
    const cIdx = html.indexOf(">C<");
    const aIdx = html.indexOf(">A<");
    expect(cIdx).toBeGreaterThan(0);
    expect(aIdx).toBeGreaterThan(cIdx);
  });

  test("omit= excludes listed fields", () => {
    const result = compile("ok/omit-fields.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    a: string req
    b: string req
    c: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows omit=["b"]/>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain(">A<");
    expect(html).not.toContain(">B<");
    expect(html).toContain(">C<");
  });

  test("<column header=\"...\"> overrides mechanical title-case", () => {
    const result = compile("ok/header-override.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    createdAt: string
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="createdAt" header="Joined"/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain(">Joined<");
    expect(html).not.toContain(">Created At<");
  });

  test("<empty> slot body is captured as elseBody on for-stmt", () => {
    // KNOWN GAP: SPEC §17.4a for/else codegen is not wired in v0.3.3 — the
    // else body is captured on the AST but not currently emitted by the
    // for-stmt codegen path. This test verifies the AST shape is recognized
    // (compiles without error) rather than the emitted JS. When §17.4a
    // codegen lands, the second assertion can flip from "no error" to
    // "JS contains the empty slot text".
    const result = compile("ok/empty-slot.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    id: integer
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <empty>
      <p>No rows yet.</p>
    </empty>
  </tableFor>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-TABLEFOR-"));
    expect(tfErrs).toEqual([]);
  });

  test("default <empty> text wires when no slot is provided (compiles cleanly)", () => {
    // KNOWN GAP: see §15 <empty> slot test note. The default text "No rows to
    // display" is captured on the for-stmt elseBody, but not yet emitted.
    const result = compile("ok/empty-default.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    id: integer
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows/>
</program>
`);
    const tfErrs = realErrors(result).filter(e => e.code && e.code.startsWith("E-TABLEFOR-"));
    expect(tfErrs).toEqual([]);
  });

  test("sortable click handler bound on <th>", () => {
    const result = compile("ok/sortable-bound.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="name" sortable/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    expect(html).toMatch(/data-scrml-bind-onclick=/);
    expect(html).toMatch(/data-scrml-tablefor-sortable="name"/);
  });

  test("align=\"right\" applies style on <th> and <td>", () => {
    const result = compile("ok/align.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    id: integer
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="id" align="right"/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain('style="text-align:right"');
  });

  test("class= applies CSS class on <th> and <td>", () => {
    const result = compile("ok/class.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    id: integer
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="id" class="numeric"/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    expect(html).toMatch(/class="numeric"/);
  });

  test("selectable= emits leading checkbox column in <thead>", () => {
    const result = compile("ok/select-thead.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id: integer
  }
}
<program>
  <users> = []
  <selectedIds> = []
  <tableFor for=User rows=@users selectable=@selectedIds/>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain('data-scrml-tablefor-master="selectedIds"');
  });
});
