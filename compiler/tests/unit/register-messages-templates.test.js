/**
 * register-messages-templates.test.js — SPEC §41.12 / §41.12.1 (S462).
 *
 * `registerMessages` values are MESSAGE TEMPLATES with named slots, not functions. This file pins
 * the compile-time half (type-system.ts `checkRegisterMessagesCalls`):
 *   §1 the template reader itself (runtime-message-templates.js — the ONE reader, shared with the
 *      runtime): grammar, escapes, slot table
 *   §2 E-MESSAGE-NOT-TEMPLATE      — a function value (arrow / fn / function) or a non-string literal
 *   §3 E-MESSAGE-SLOT-UNKNOWN      — a literal template naming a slot its variant lacks
 *   §4 E-MESSAGE-TEMPLATE-MALFORMED — a literal template with a `{` that opens no slot
 *   §5 E-MESSAGE-VARIANT-UNKNOWN   — a key that is not a ValidationError variant
 *   §6 what the compiler leaves to the runtime (non-literal templates) and what it never touches
 *      (a user function of the same name, an aliased import)
 * The runtime half (rendering + fail-closed refusal) is c10-error-message-resolution.test.js
 * §C10.10/§C10.10b and the conformance cases forms/msgchain-l2-template-*.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  _SCRML_MESSAGE_SLOTS,
  _scrml_message_template_parse,
  _scrml_message_template_render,
} from "../../src/runtime-message-templates.js";

let TMP;
let n = 0;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "register-messages-templates-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compile(source) {
  n += 1;
  const dir = join(TMP, `c${n}`);
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, "app.scrml");
  writeFileSync(abs, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(dir, "dist"), write: false, log: () => {} });
}

function messageErrors(result) {
  return (result.errors || []).filter((e) => e && typeof e.code === "string" && e.code.startsWith("E-MESSAGE-"));
}

function page(entries, extra = "") {
  return `<program>
\${
    import { registerMessages } from 'scrml:data'
    ${extra}
    registerMessages({
${entries}
    })
    <signup>
        <name req length(>=2)> = <input id="name" type="text"/>
    </>
}
<signup><name/></>
<div id="err"><errors of=@signup.name/></div>
</program>
`;
}

// ---------------------------------------------------------------------------
// §1 — the template reader
// ---------------------------------------------------------------------------

describe("§1 the template reader (runtime-message-templates.js)", () => {
  const slots = ["field", "threshold"];

  test("text and slots alternate in parts", () => {
    const r = _scrml_message_template_parse("{field} must be {threshold}.", slots);
    expect(r.ok).toBe(true);
    expect(r.parts).toEqual([{ slot: "field" }, " must be ", { slot: "threshold" }, "."]);
  });

  test("{{ is a literal {; a lone } is text", () => {
    const r = _scrml_message_template_parse("{{x}} {field}}", slots);
    expect(r.ok).toBe(true);
    expect(_scrml_message_template_render(r.parts, { tag: "MinFailed" }, "age")).toBe("{x}} age}");
  });

  test("a template with no slots is legal", () => {
    expect(_scrml_message_template_parse("Required.", slots).ok).toBe(true);
    expect(_scrml_message_template_parse("", slots).ok).toBe(true);
  });

  test("malformed: unclosed, empty, spaced, digit-led, trailing {", () => {
    for (const bad of ["{field", "{}", "{ field}", "{field }", "{1a}", "x {", "{fi-eld}"]) {
      const r = _scrml_message_template_parse(bad, slots);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("malformed");
    }
  });

  test("malformed reports the offset of the offending {", () => {
    expect(_scrml_message_template_parse("ab {x", slots).at).toBe(3);
  });

  test("unknown slot reports the name", () => {
    const r = _scrml_message_template_parse("{field} {expected}", slots);
    expect(r).toEqual({ ok: false, reason: "unknown-slot", at: 8, slot: "expected" });
  });

  test("the slot table is field + the §55.9 payload names, for all 15 variants", () => {
    expect(Object.keys(_SCRML_MESSAGE_SLOTS).sort()).toEqual([
      "Custom", "EqFailed", "GtFailed", "GteFailed", "LengthFailed", "LtFailed", "LteFailed",
      "MaxFailed", "MinFailed", "NeqFailed", "NotInFailed", "NotSome", "OneOfFailed",
      "PatternMismatch", "Required",
    ]);
    expect(_SCRML_MESSAGE_SLOTS.Required).toEqual(["field"]);
    expect(_SCRML_MESSAGE_SLOTS.LengthFailed).toEqual(["field", "predicate"]);
    expect(_SCRML_MESSAGE_SLOTS.PatternMismatch).toEqual(["field", "re"]);
    expect(_SCRML_MESSAGE_SLOTS.MinFailed).toEqual(["field", "threshold"]);
    expect(_SCRML_MESSAGE_SLOTS.EqFailed).toEqual(["field", "expected"]);
    expect(_SCRML_MESSAGE_SLOTS.NeqFailed).toEqual(["field", "forbidden"]);
    expect(_SCRML_MESSAGE_SLOTS.OneOfFailed).toEqual(["field", "set"]);
    expect(_SCRML_MESSAGE_SLOTS.Custom).toEqual(["field", "tag"]);
    expect(Object.getPrototypeOf(_SCRML_MESSAGE_SLOTS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2 — E-MESSAGE-NOT-TEMPLATE
// ---------------------------------------------------------------------------

describe("§2 E-MESSAGE-NOT-TEMPLATE", () => {
  test("an arrow function value is refused, and the message shows the template form + slots", () => {
    const errs = messageErrors(compile(page("        .Required: (field) => `${field} is required`,")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-NOT-TEMPLATE"]);
    expect(errs[0].message).toContain(".Required");
    expect(errs[0].message).toContain("{field}");
    expect(errs[0].message.toLowerCase()).toContain("message template");
  });

  test("the diagnostic is reported at the registerMessages statement, not at 1:1", () => {
    const errs = messageErrors(compile(page("        .Required: (field) => `${field} is required`,")));
    expect(errs[0].span.line).toBeGreaterThan(1);
  });

  test("a `function` expression value is refused", () => {
    const errs = messageErrors(compile(page("        .Required: function (field) { return field },")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-NOT-TEMPLATE"]);
  });

  test("one diagnostic per function-valued entry", () => {
    const errs = messageErrors(compile(page(
      "        .Required: (f) => `${f}`,\n        .LengthFailed: (f, p) => `${f} ${p}`,")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-NOT-TEMPLATE", "E-MESSAGE-NOT-TEMPLATE"]);
  });

  test("a number literal value is refused", () => {
    const errs = messageErrors(compile(page("        .Required: 42,")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-NOT-TEMPLATE"]);
  });

  test("an object literal value is refused", () => {
    const errs = messageErrors(compile(page("        .Required: { text: \"x\" },")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-NOT-TEMPLATE"]);
  });
});

// ---------------------------------------------------------------------------
// §3 / §4 / §5 — literal-template checks
// ---------------------------------------------------------------------------

describe("§3 E-MESSAGE-SLOT-UNKNOWN", () => {
  test("a slot the variant lacks is refused; the message lists the variant's slots", () => {
    const errs = messageErrors(compile(page("        .Required: \"{field} needs {threshold}\",")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-SLOT-UNKNOWN"]);
    expect(errs[0].message).toContain("{threshold}");
    expect(errs[0].message).toContain("Required");
    expect(errs[0].message).toContain("{field}");
  });

  test("a back-tick template with no ${} is a literal and is checked", () => {
    const errs = messageErrors(compile(page("        .Required: `{field} needs {set}`,")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-SLOT-UNKNOWN"]);
  });
});

describe("§4 E-MESSAGE-TEMPLATE-MALFORMED", () => {
  test("an unclosed slot is refused", () => {
    const errs = messageErrors(compile(page("        .Required: \"{field is required\",")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-TEMPLATE-MALFORMED"]);
  });

  test("a spaced slot is refused", () => {
    const errs = messageErrors(compile(page("        .Required: \"{ field } is required\",")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-TEMPLATE-MALFORMED"]);
  });

  test("{{ is the escape — no diagnostic", () => {
    const errs = messageErrors(compile(page("        .Required: \"{{{field}} is required\",")));
    expect(errs).toEqual([]);
  });
});

describe("§5 E-MESSAGE-VARIANT-UNKNOWN", () => {
  test("a key that is not a ValidationError variant is refused", () => {
    const errs = messageErrors(compile(page("        .TooShort: \"{field} is short\",")));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-VARIANT-UNKNOWN"]);
    expect(errs[0].message).toContain(".LengthFailed");
  });
});

// ---------------------------------------------------------------------------
// §6 — positive controls and boundaries
// ---------------------------------------------------------------------------

describe("§6 boundaries", () => {
  test("well-formed literal templates for every slot compile clean", () => {
    const entries = [
      ".Required:        \"{field} is required\",",
      ".LengthFailed:    \"{field} needs {predicate}\",",
      ".PatternMismatch: \"{field} must match {re}\",",
      ".MinFailed:       \"{field} >= {threshold}\",",
      ".GtFailed:        \"{field} > {expected}\",",
      ".NeqFailed:       \"{field} != {forbidden}\",",
      ".OneOfFailed:     \"{field} in {set}\",",
      ".Custom:          \"{field}: {tag}\",",
    ].map((l) => "        " + l).join("\n");
    const r = compile(page(entries));
    expect(messageErrors(r)).toEqual([]);
    expect((r.errors || []).filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
  });

  test("a non-literal template (a const string) is left to the runtime — no compile diagnostic", () => {
    const errs = messageErrors(compile(page("        .Required: later,", "const later = \"{field} {bogus}\"")));
    expect(errs).toEqual([]);
  });

  test("a back-tick template WITH ${} is not a literal — left to the runtime", () => {
    const errs = messageErrors(compile(page("        .Required: `{bogus} ${brand}`,", "const brand = \"Acme\"")));
    expect(errs).toEqual([]);
  });

  test("an aliased import is checked too", () => {
    const src = page("        .Required: (f) => f,").replace(
      "import { registerMessages } from 'scrml:data'",
      "import { registerMessages as setMessages } from 'scrml:data'",
    ).replace("registerMessages({", "setMessages({");
    const errs = messageErrors(compile(src));
    expect(errs.map((e) => e.code)).toEqual(["E-MESSAGE-NOT-TEMPLATE"]);
  });

  test("a user function named registerMessages (not from scrml:data) is not checked", () => {
    const src = `<program>
\${
    function registerMessages(m) { return m }
    registerMessages({ .Bogus: 1 })
}
<p>x</p>
</program>
`;
    expect(messageErrors(compile(src))).toEqual([]);
  });
});
