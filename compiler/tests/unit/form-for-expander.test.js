/**
 * §41.14 (S102) — formFor expander unit tests.
 *
 * Tests the pure helper functions in compiler/src/codegen/emit-form-for.ts
 * — validator parsing, mechanical label derivation, camelize, and the
 * expandFormFor() AST builder.
 *
 * These are the building blocks for the higher-level integration coverage
 * in form-for.test.js (full compile pipeline).
 */

import { describe, test, expect } from "bun:test";
import {
  parseValidatorClauses,
  mechanicalLabel,
  camelizeStructName,
  inputShapeForFieldType,
  expandFormFor,
  _resetSynthIdCounter,
} from "../../src/codegen/emit-form-for.ts";

const TEST_SPAN = { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };

describe("parseValidatorClauses", () => {
  test("empty input → no validators", () => {
    expect(parseValidatorClauses("")).toEqual([]);
    expect(parseValidatorClauses("   ")).toEqual([]);
  });

  test("bare base type → no validators", () => {
    expect(parseValidatorClauses("string")).toEqual([]);
    expect(parseValidatorClauses("number")).toEqual([]);
    expect(parseValidatorClauses("boolean")).toEqual([]);
  });

  test("`string req` → [{name:'req'}]", () => {
    expect(parseValidatorClauses("string req")).toEqual([
      { name: "req", argsRaw: null },
    ]);
  });

  test("`string req length(>=2)` → [req, length]", () => {
    expect(parseValidatorClauses("string req length(>=2)")).toEqual([
      { name: "req", argsRaw: null },
      { name: "length", argsRaw: ">=2" },
    ]);
  });

  test("`string req pattern(/^[^@]+@[^@]+$/)` → [req, pattern]", () => {
    const result = parseValidatorClauses("string req pattern(/^[^@]+@[^@]+$/)");
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ name: "req", argsRaw: null });
    expect(result[1].name).toBe("pattern");
    expect(result[1].argsRaw).toBe("/^[^@]+@[^@]+$/");
  });

  test("`boolean req` → [req]", () => {
    expect(parseValidatorClauses("boolean req")).toEqual([
      { name: "req", argsRaw: null },
    ]);
  });

  test("lifecycle annotation `(string -> string)` → no validators", () => {
    expect(parseValidatorClauses("(string -> string)")).toEqual([]);
  });

  test("`number min(0) max(100)` → [min, max]", () => {
    expect(parseValidatorClauses("number min(0) max(100)")).toEqual([
      { name: "min", argsRaw: "0" },
      { name: "max", argsRaw: "100" },
    ]);
  });
});

describe("mechanicalLabel", () => {
  test("simple field → title-cased", () => {
    expect(mechanicalLabel("email")).toBe("Email");
    expect(mechanicalLabel("agree")).toBe("Agree");
    expect(mechanicalLabel("name")).toBe("Name");
  });

  test("camelCase field → space-separated title case", () => {
    expect(mechanicalLabel("emailAddress")).toBe("Email Address");
    expect(mechanicalLabel("firstName")).toBe("First Name");
    expect(mechanicalLabel("agreeToTerms")).toBe("Agree To Terms");
  });

  test("empty string → empty string", () => {
    expect(mechanicalLabel("")).toBe("");
  });
});

describe("camelizeStructName", () => {
  test("PascalCase → camelCase", () => {
    expect(camelizeStructName("Signup")).toBe("signup");
    expect(camelizeStructName("UserAccount")).toBe("userAccount");
  });

  test("single uppercase → lowercase", () => {
    expect(camelizeStructName("X")).toBe("x");
  });

  test("empty → empty", () => {
    expect(camelizeStructName("")).toBe("");
  });
});

describe("inputShapeForFieldType", () => {
  test("string → text input", () => {
    expect(inputShapeForFieldType("string")).toEqual({ tag: "input", type: "text" });
  });

  test("boolean → checkbox", () => {
    expect(inputShapeForFieldType("boolean")).toEqual({ tag: "input", type: "checkbox" });
  });

  test("number → number input", () => {
    expect(inputShapeForFieldType("number")).toEqual({ tag: "input", type: "number" });
  });

  test("integer → number input with step=1", () => {
    expect(inputShapeForFieldType("integer")).toEqual({ tag: "input", type: "number", step: "1" });
  });

  test("unknown → text input fallback", () => {
    expect(inputShapeForFieldType("asIs")).toEqual({ tag: "input", type: "text" });
  });
});

describe("expandFormFor — synthesized AST shape", () => {
  test("happy path — Signup struct, server fn handler", () => {
    _resetSynthIdCounter();
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        {
          name: "name",
          baseTypeName: "string",
          label: "Name",
          validators: [{ name: "req", argsRaw: null }],
          isNestedStruct: false,
        },
        {
          name: "email",
          baseTypeName: "string",
          label: "Email",
          validators: [{ name: "req", argsRaw: null }],
          isNestedStruct: false,
        },
        {
          name: "agree",
          baseTypeName: "boolean",
          label: "Agree",
          validators: [{ name: "req", argsRaw: null }],
          isNestedStruct: false,
        },
      ],
      slotOverrides: new Map(),
      onsubmitFnName: "persistSignup",
      onsubmitBoundary: "server",
      peActionUrl: "/api/persistSignup",
      errorStrategy: "per-field",
      partial: false,
      span: TEST_SPAN,
    };
    const [compoundDecl, formElement] = expandFormFor(exp);

    // Compound state-decl shape.
    expect(compoundDecl.kind).toBe("state-decl");
    expect(compoundDecl.name).toBe("signup");
    expect(compoundDecl.structuralForm).toBe(true);
    expect(compoundDecl.shape).toBe("plain");
    expect(compoundDecl._formForSynth).toBe(true);
    expect(compoundDecl.children).toBeArrayOfSize(3);

    // Each child is a Shape 2 state-decl with render-spec + validators.
    const nameField = compoundDecl.children[0];
    expect(nameField.kind).toBe("state-decl");
    expect(nameField.name).toBe("name");
    expect(nameField.shape).toBe("decl-with-spec");
    expect(nameField.renderSpec).toBeDefined();
    expect(nameField.renderSpec.element.tag).toBe("input");
    expect(nameField.validators).toEqual([{ name: "req", argsRaw: null }]);

    const agreeField = compoundDecl.children[2];
    expect(agreeField.renderSpec.element.tag).toBe("input");
    expect(agreeField.renderSpec.element.attrs.find(a => a.name === "type").value.value).toBe("checkbox");

    // <form> element shape.
    expect(formElement.kind).toBe("markup");
    expect(formElement.tag).toBe("form");
    expect(formElement._formForSynth).toBe(true);

    // PE-default action= + method= for server-fn handler.
    const actionAttr = formElement.attrs.find(a => a.name === "action");
    expect(actionAttr).toBeDefined();
    expect(actionAttr.value.value).toBe("/api/persistSignup");
    const methodAttr = formElement.attrs.find(a => a.name === "method");
    expect(methodAttr.value.value).toBe("POST");

    // onsubmit=fn bare-form event handler.
    const onsubmitAttr = formElement.attrs.find(a => a.name === "onsubmit");
    expect(onsubmitAttr).toBeDefined();
    expect(onsubmitAttr.value.kind).toBe("call-ref");
    expect(onsubmitAttr.value.name).toBe("persistSignup");

    // data-scrml-formfor data-attr for selector stability.
    const formForAttr = formElement.attrs.find(a => a.name === "data-scrml-formfor");
    expect(formForAttr.value.value).toBe("Signup");

    // 3 field <div>s + 1 submit button = 4 children (no summary block for per-field strategy).
    expect(formElement.children).toBeArrayOfSize(4);

    // Last child is the submit button.
    const submit = formElement.children[3];
    expect(submit.tag).toBe("button");
    const submitTypeAttr = submit.attrs.find(a => a.name === "type");
    expect(submitTypeAttr.value.value).toBe("submit");
    const submitDisabledAttr = submit.attrs.find(a => a.name === "disabled");
    expect(submitDisabledAttr.value.kind).toBe("expr");
    expect(submitDisabledAttr.value.raw).toBe("!@signup.isValid");

    // Each field <div> contains <label> + compound-wrap render + <errors of=>.
    const firstFieldDiv = formElement.children[0];
    expect(firstFieldDiv.tag).toBe("div");
    const fieldClass = firstFieldDiv.attrs.find(a => a.name === "class");
    expect(fieldClass.value.value).toBe("field");
    const fieldDataAttr = firstFieldDiv.attrs.find(a => a.name === "data-scrml-formfor-field");
    expect(fieldDataAttr.value.value).toBe("name");

    // Children: label, compound-wrap, errors.
    expect(firstFieldDiv.children[0].tag).toBe("label");
    // S108 B5 — Label child is now a synthesized `logic` node carrying a
    // `${_scrml_label_for("Signup", "name")}` interpolation (typeof-guarded
    // for `messages` chunk tree-shake — falls back to "Name" mechanical
    // default literal). Pre-B5 was a plain text node with the title-case
    // value baked at compile time. Bug 5 P1 β-path one-shot binding at
    // DOMContentLoaded wires `registerLabels` consultation per
    // SPEC §41.14.7 Level 2 → Level 4 chain.
    const labelChild = firstFieldDiv.children[0].children[0];
    expect(labelChild.kind).toBe("logic");
    expect(labelChild.body[0].kind).toBe("bare-expr");
    expect(labelChild.body[0].expr).toContain("_scrml_label_for");
    expect(labelChild.body[0].expr).toContain('"Signup"');
    expect(labelChild.body[0].expr).toContain('"name"');
    // Mechanical default literal is the typeof-guard fallback
    expect(labelChild.body[0].expr).toContain('"Name"');
    expect(firstFieldDiv.children[2].tag).toBe("errors");
    const errorsOfAttr = firstFieldDiv.children[2].attrs.find(a => a.name === "of");
    expect(errorsOfAttr.value.kind).toBe("variable-ref");
    expect(errorsOfAttr.value.name).toBe("@signup.name");
  });

  test("client-fn handler — no PE-default action=/method=", () => {
    _resetSynthIdCounter();
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        {
          name: "name",
          baseTypeName: "string",
          label: "Name",
          validators: [],
          isNestedStruct: false,
        },
      ],
      slotOverrides: new Map(),
      onsubmitFnName: "clientHandler",
      onsubmitBoundary: "client",
      peActionUrl: "",
      errorStrategy: "per-field",
      partial: false,
      span: TEST_SPAN,
    };
    const [, formElement] = expandFormFor(exp);
    expect(formElement.attrs.find(a => a.name === "action")).toBeUndefined();
    expect(formElement.attrs.find(a => a.name === "method")).toBeUndefined();
    expect(formElement.attrs.find(a => a.name === "onsubmit").value.name).toBe("clientHandler");
  });

  test("error-strategy='summary' — only summary <errors all/> at form level", () => {
    _resetSynthIdCounter();
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        {
          name: "name",
          baseTypeName: "string",
          label: "Name",
          validators: [{ name: "req", argsRaw: null }],
          isNestedStruct: false,
        },
      ],
      slotOverrides: new Map(),
      onsubmitFnName: null,
      onsubmitBoundary: null,
      peActionUrl: "",
      errorStrategy: "summary",
      partial: false,
      span: TEST_SPAN,
    };
    const [, formElement] = expandFormFor(exp);
    // No per-field <errors> in the field div.
    const fieldDiv = formElement.children[0];
    const hasErrorsChild = fieldDiv.children.some(c => c.tag === "errors");
    expect(hasErrorsChild).toBe(false);

    // Form-level summary <errors of=@signup all/>.
    const summary = formElement.children.find(c => c.tag === "errors");
    expect(summary).toBeDefined();
    const summaryOf = summary.attrs.find(a => a.name === "of");
    expect(summaryOf.value.name).toBe("@signup");
    const allFlag = summary.attrs.find(a => a.name === "all");
    expect(allFlag).toBeDefined();
  });

  test("error-strategy='both' — per-field AND summary", () => {
    _resetSynthIdCounter();
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        { name: "name", baseTypeName: "string", label: "Name", validators: [], isNestedStruct: false },
      ],
      slotOverrides: new Map(),
      onsubmitFnName: null,
      onsubmitBoundary: null,
      peActionUrl: "",
      errorStrategy: "both",
      partial: false,
      span: TEST_SPAN,
    };
    const [, formElement] = expandFormFor(exp);
    // Field div has per-field <errors>.
    const fieldDiv = formElement.children[0];
    expect(fieldDiv.children.some(c => c.tag === "errors")).toBe(true);
    // Form has summary <errors>.
    expect(formElement.children.some(c => c.tag === "errors")).toBe(true);
  });

  test("partial=true relaxes req validators per field", () => {
    _resetSynthIdCounter();
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        {
          name: "name",
          baseTypeName: "string",
          label: "Name",
          validators: [
            { name: "req", argsRaw: null },
            { name: "length", argsRaw: ">=2" },
          ],
          isNestedStruct: false,
        },
      ],
      slotOverrides: new Map(),
      onsubmitFnName: null,
      onsubmitBoundary: null,
      peActionUrl: "",
      errorStrategy: "per-field",
      partial: true,
      span: TEST_SPAN,
    };
    const [compoundDecl] = expandFormFor(exp);
    const nameField = compoundDecl.children[0];
    // req filtered out; length retained.
    expect(nameField.validators).toEqual([{ name: "length", argsRaw: ">=2" }]);
  });

  test("submit slot override replaces default submit button", () => {
    _resetSynthIdCounter();
    const customSubmit = {
      kind: "markup",
      tag: "button",
      attrs: [
        { name: "type", value: { kind: "string-literal", value: "submit" } },
        { name: "class", value: { kind: "string-literal", value: "branded" } },
      ],
      attributes: [
        { name: "type", value: { kind: "string-literal", value: "submit" } },
        { name: "class", value: { kind: "string-literal", value: "branded" } },
      ],
      children: [{ kind: "text", value: "Sign up" }],
    };
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        { name: "name", baseTypeName: "string", label: "Name", validators: [], isNestedStruct: false },
      ],
      slotOverrides: new Map([
        ["submit", [customSubmit]],
      ]),
      onsubmitFnName: null,
      onsubmitBoundary: null,
      peActionUrl: "",
      errorStrategy: "per-field",
      partial: false,
      span: TEST_SPAN,
    };
    const [, formElement] = expandFormFor(exp);
    // Last child is the override (not the default <button>Submit</button>).
    const submit = formElement.children[formElement.children.length - 1];
    const classAttr = submit.attrs.find(a => a.name === "class");
    expect(classAttr.value.value).toBe("branded");
  });

  test("per-field slot override replaces input position", () => {
    _resetSynthIdCounter();
    const customInput = {
      kind: "markup",
      tag: "input",
      attrs: [{ name: "type", value: { kind: "string-literal", value: "email" } }],
      attributes: [{ name: "type", value: { kind: "string-literal", value: "email" } }],
      children: [],
    };
    const exp = {
      cellName: "signup",
      structName: "Signup",
      includedFields: [
        { name: "email", baseTypeName: "string", label: "Email", validators: [], isNestedStruct: false },
      ],
      slotOverrides: new Map([
        ["email", [customInput]],
      ]),
      onsubmitFnName: null,
      onsubmitBoundary: null,
      peActionUrl: "",
      errorStrategy: "per-field",
      partial: false,
      span: TEST_SPAN,
    };
    const [, formElement] = expandFormFor(exp);
    const fieldDiv = formElement.children[0];
    // Children: label, custom input, <errors>
    expect(fieldDiv.children[1].tag).toBe("input");
    const inputType = fieldDiv.children[1].attrs.find(a => a.name === "type");
    expect(inputType.value.value).toBe("email");
    // <errors of=...> still emitted (slot doesn't own the validity surface).
    expect(fieldDiv.children[2].tag).toBe("errors");
  });
});
