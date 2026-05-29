/**
 * §41.14 (S102) — formFor compile-pipeline tests.
 *
 * End-to-end coverage:
 *   §1 — Happy path: canonical example compiles cleanly + emits expected
 *        Shape 2 + <form> + <errors> structure.
 *   §2 — E-FORMFOR-TYPE-NOT-STRUCT — `for=` references enum / named-shape /
 *        unknown / string-literal value.
 *   §3 — E-FORMFOR-SLOT-UNKNOWN — `<slot name="X">` not in struct fields
 *        or "submit".
 *   §4 — E-FORMFOR-PICK-INVALID-FIELD — `pick=["unknown"]`.
 *   §5 — E-FORMFOR-OMIT-INVALID-FIELD — `omit=["unknown"]`.
 *   §6 — E-FORMFOR-PICK-OMIT-CONFLICT — both `pick=` AND `omit=` set.
 *   §7 — E-FORMFOR-ONSUBMIT-SIGNATURE — handler arg type mismatch / zero args.
 *   §8 — E-FORMFOR-ERROR-STRATEGY-INVALID — `error-strategy="invalid"`.
 *   §9 — E-FORMFOR-NESTED-STRUCT-NO-SLOT — struct-typed field, no slot override.
 *   §10 — Pick/omit/partial transforms behave correctly.
 *   §11 — Slot overrides replace the input position.
 *
 * Uses compileScrml (full pipeline) because formFor is imported from
 * `scrml:data` and the import resolution requires the full MOD + TS path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import vm from "node:vm";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "form-for-unit-"));
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

/** Combine error+warning streams (info-level codes can land on either; §34 uses cross-stream codes). */
function allDiagnostics(result) {
  return [...(result.errors || []), ...(result.warnings || [])];
}

/** Filter the error stream to real errors (fatal). */
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

function getHtml(result, abs) {
  const outputs = result.outputs;
  if (!outputs) return "";
  for (const [k, v] of outputs) {
    if (k === abs && typeof v === "object" && v.html) return v.html;
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

describe("§1 formFor happy path", () => {
  test("canonical signup example compiles cleanly", () => {
    const result = compile("happy/signup.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string req length(>=2)
    email: string req
    agree: boolean req
  }

  server function persistSignup(values: Signup) ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`);
    const errs = realErrors(result);
    const ffErrs = errs.filter(e => e.code && e.code.startsWith("E-FORMFOR-"));
    expect(ffErrs).toEqual([]);
  });

  test("emitted HTML contains the synthesized <form data-scrml-formfor=> wrapper", () => {
    const result = compile("happy/signup-html.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
  }

  server function persistSignup(values: Signup) ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`);
    const html = getHtml(result, fx("happy/signup-html.scrml", ""));
    expect(html).toContain(`data-scrml-formfor="Signup"`);
    expect(html).toContain(`data-scrml-formfor-field="name"`);
    expect(html).toContain(`data-scrml-formfor-field="email"`);
    // Submit button.
    expect(html).toContain(`<button type="submit"`);
    // Per-field <errors> placeholder (default per-field strategy).
    expect(html).toContain(`data-scrml-errors-anchor`);
    // <label> elements emit a `${_scrml_label_for(...)}` interpolation
    // placeholder (S108 B5 — Level-2 label-store consultation per SPEC
    // §41.14.7). The static HTML carries the placeholder; one-shot
    // textContent write at DOMContentLoaded resolves Level 2 (registerLabels)
    // → Level 4 (mechanical title-case) via the typeof-guarded runtime call.
    expect(html).toMatch(/<label><span data-scrml-logic="_scrml_logic_\d+"><\/span><\/label>/);
    const clientJs = getClientJs(result, fx("happy/signup-html.scrml", ""));
    // Wiring contains the _scrml_label_for call for the name + email fields
    expect(clientJs).toContain(`_scrml_label_for`);
    expect(clientJs).toContain(`"Signup"`);
    expect(clientJs).toContain(`"name"`);
    expect(clientJs).toContain(`"email"`);
    // Mechanical default literals embedded as typeof-guard fallback
    expect(clientJs).toContain(`"Name"`);
    expect(clientJs).toContain(`"Email"`);
  });

  test("emitted clientJs subscribes to signup.<field>.errors", () => {
    const result = compile("happy/signup-js.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string req
    email: string req
  }

  server function persistSignup(values: Signup) ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`);
    const js = getClientJs(result);
    expect(js).toContain(`signup.name.errors`);
    expect(js).toContain(`signup.email.errors`);
  });

  // C1 (R27): the two-bound range form `length(>=N, <=M)` on a formFor struct
  // field previously emitted a malformed comparator object literal
  // (`{ op: ">=", value: 2 , <= 120 }`) — invalid JS at compile-exit-0.
  // Each bound must now fire as a separate `_scrml_validator_fire("length",...)`
  // call (AND-composed) and the emitted client JS must parse cleanly.
  test("C1 — two-bound length(>=N, <=M) formFor field emits valid JS (node-parseable)", () => {
    const result = compile("happy/len2.scrml", `\${
  import { formFor } from 'scrml:data'

  type NewExpense:struct = {
    merchant: string req length(>=2, <=120)
    amount:   number req min(0.01)
  }

  server function onsub(values: NewExpense) ! string { return "ok" }
}
<program>
  <formFor for=NewExpense onsubmit=onsub pick=["merchant", "amount"]/>
</program>
`);
    expect(realErrors(result)).toEqual([]);
    const js = getClientJs(result);
    // No malformed splice — the second bound must NOT be raw text inside the
    // comparator object.
    expect(js).not.toContain(`, <= 120`);
    // Two separate length fires, one per bound.
    expect(js).toContain(`_scrml_validator_fire("length", value, { op: ">=", value: 2 })`);
    expect(js).toContain(`_scrml_validator_fire("length", value, { op: "<=", value: 120 })`);
    // The emitted client JS must be syntactically valid JavaScript.
    expect(() => new vm.Script(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 — E-FORMFOR-TYPE-NOT-STRUCT
// ---------------------------------------------------------------------------

describe("§2 E-FORMFOR-TYPE-NOT-STRUCT", () => {
  test("for= references an :enum type", () => {
    const result = compile("err/for-enum.scrml", `\${
  import { formFor } from 'scrml:data'

  type Status:enum = { Pending, Active, Closed }

  function clientHandler(values) {
    return true
  }
}
<program>
  <formFor for=Status onsubmit=clientHandler/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-TYPE-NOT-STRUCT");
  });

  test("for= references an undeclared type", () => {
    const result = compile("err/for-undeclared.scrml", `\${
  import { formFor } from 'scrml:data'
}
<program>
  <formFor for=NeverDeclared/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-TYPE-NOT-STRUCT");
  });

  test("for= references a string-literal value (must be bare ident)", () => {
    const result = compile("err/for-string.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = { name: string }
}
<program>
  <formFor for="Signup"/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-TYPE-NOT-STRUCT");
  });
});

// ---------------------------------------------------------------------------
// §3 — E-FORMFOR-SLOT-UNKNOWN
// ---------------------------------------------------------------------------

describe("§3 E-FORMFOR-SLOT-UNKNOWN", () => {
  test("slot name does not match any struct field", () => {
    const result = compile("err/slot-unknown.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
  }
}
<program>
  <formFor for=Signup>
    <slot name="emial">typo'd field name</slot>
  </formFor>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-SLOT-UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// §4 — E-FORMFOR-PICK-INVALID-FIELD
// ---------------------------------------------------------------------------

describe("§4 E-FORMFOR-PICK-INVALID-FIELD", () => {
  test("pick= references a field not on the struct", () => {
    const result = compile("err/pick-invalid.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
  }
}
<program>
  <formFor for=Signup pick=["name", "phoneNumber"]/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-PICK-INVALID-FIELD");
  });
});

// ---------------------------------------------------------------------------
// §5 — E-FORMFOR-OMIT-INVALID-FIELD
// ---------------------------------------------------------------------------

describe("§5 E-FORMFOR-OMIT-INVALID-FIELD", () => {
  test("omit= references a field not on the struct", () => {
    const result = compile("err/omit-invalid.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
  }
}
<program>
  <formFor for=Signup omit=["middleName"]/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-OMIT-INVALID-FIELD");
  });
});

// ---------------------------------------------------------------------------
// §6 — E-FORMFOR-PICK-OMIT-CONFLICT
// ---------------------------------------------------------------------------

describe("§6 E-FORMFOR-PICK-OMIT-CONFLICT", () => {
  test("both pick= and omit= present is forbidden", () => {
    const result = compile("err/pick-omit.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
    agree: boolean
  }
}
<program>
  <formFor for=Signup pick=["name"] omit=["agree"]/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-PICK-OMIT-CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// §7 — E-FORMFOR-ONSUBMIT-SIGNATURE
// ---------------------------------------------------------------------------

describe("§7 E-FORMFOR-ONSUBMIT-SIGNATURE", () => {
  test("handler takes zero arguments", () => {
    const result = compile("err/onsubmit-zero-arg.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
  }

  server function persistSignup() ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-ONSUBMIT-SIGNATURE");
  });

  test("handler's first arg type is a different struct", () => {
    const result = compile("err/onsubmit-wrong-struct.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = { name: string }
  type OtherShape:struct = { foo: number }

  server function persistSignup(values: OtherShape) ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-ONSUBMIT-SIGNATURE");
  });
});

// ---------------------------------------------------------------------------
// §8 — E-FORMFOR-ERROR-STRATEGY-INVALID
// ---------------------------------------------------------------------------

describe("§8 E-FORMFOR-ERROR-STRATEGY-INVALID", () => {
  test('error-strategy="invalid" rejected', () => {
    const result = compile("err/error-strategy-invalid.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = { name: string }
}
<program>
  <formFor for=Signup error-strategy="invalid"/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-ERROR-STRATEGY-INVALID");
  });

  test('error-strategy="per-field" / "summary" / "both" are all accepted', () => {
    for (const strategy of ["per-field", "summary", "both"]) {
      const result = compile(`happy/error-strategy-${strategy}.scrml`, `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = { name: string }
}
<program>
  <formFor for=Signup error-strategy="${strategy}"/>
</program>
`);
      const codes = realErrors(result).map(e => e.code);
      expect(codes.filter(c => c.startsWith("E-FORMFOR-"))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// §9 — E-FORMFOR-NESTED-STRUCT-NO-SLOT
// ---------------------------------------------------------------------------

describe("§9 E-FORMFOR-NESTED-STRUCT-NO-SLOT", () => {
  test("struct-typed field with no slot override fires", () => {
    const result = compile("err/nested-struct-no-slot.scrml", `\${
  import { formFor } from 'scrml:data'

  type Address:struct = {
    street: string
    city:   string
  }

  type User:struct = {
    name:    string
    address: Address
  }
}
<program>
  <formFor for=User/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes).toContain("E-FORMFOR-NESTED-STRUCT-NO-SLOT");
  });

  test("struct-typed field with omit excludes it (no error)", () => {
    const result = compile("happy/nested-struct-omitted.scrml", `\${
  import { formFor } from 'scrml:data'

  type Address:struct = {
    street: string
    city:   string
  }

  type User:struct = {
    name:    string
    address: Address
  }
}
<program>
  <formFor for=User omit=["address"]/>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes.filter(c => c.startsWith("E-FORMFOR-"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 — Pick / omit / partial behavioral tests
// ---------------------------------------------------------------------------

describe("§10 pick / omit / partial transforms", () => {
  test("pick=[name, email] emits only those two fields", () => {
    const result = compile("happy/pick-transform.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
    agree: boolean
  }
}
<program>
  <formFor for=Signup pick=["name", "email"]/>
</program>
`);
    const html = getHtml(result, fx("happy/pick-transform.scrml", ""));
    expect(html).toContain(`data-scrml-formfor-field="name"`);
    expect(html).toContain(`data-scrml-formfor-field="email"`);
    expect(html).not.toContain(`data-scrml-formfor-field="agree"`);
  });

  test("omit=[agree] emits name + email (not agree)", () => {
    const result = compile("happy/omit-transform.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
    agree: boolean
  }
}
<program>
  <formFor for=Signup omit=["agree"]/>
</program>
`);
    const html = getHtml(result, fx("happy/omit-transform.scrml", ""));
    expect(html).toContain(`data-scrml-formfor-field="name"`);
    expect(html).toContain(`data-scrml-formfor-field="email"`);
    expect(html).not.toContain(`data-scrml-formfor-field="agree"`);
  });
});

// ---------------------------------------------------------------------------
// §11 — Slot override behavior
// ---------------------------------------------------------------------------

describe("§11 slot overrides", () => {
  test("compile accepts a <slot name='email'> override (no error)", () => {
    const result = compile("happy/slot-override.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string
    email: string
  }
}
<program>
  <formFor for=Signup>
    <slot name="email"><input type="email" class="branded"/></slot>
  </formFor>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes.filter(c => c.startsWith("E-FORMFOR-"))).toEqual([]);
  });

  test("submit slot override accepts custom button", () => {
    const result = compile("happy/submit-override.scrml", `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name: string
  }
}
<program>
  <formFor for=Signup>
    <slot name="submit"><button type="submit" class="primary">Sign up</button></slot>
  </formFor>
</program>
`);
    const codes = realErrors(result).map(e => e.code);
    expect(codes.filter(c => c.startsWith("E-FORMFOR-"))).toEqual([]);
  });
});
