/**
 * scrml:data — validator rules are DATA (S462, change s462-data-rules-as-data).
 *
 * Ruling (user-voice S462 Q17 "b"): `scrml:data` rules become a `Rule` enum
 * that `validate(data, schema)` matches on; a developer check is passed AT
 * VALIDATE TIME, never stored in a value. Design landed here: a developer
 * check is `Rule.Custom(tag)` in the schema plus ONE `check(tag, value, data)`
 * function passed as validate's third argument.
 *
 *   §1 PARITY — every retired builder (required/email/minLength/maxLength/
 *      exactLength/pattern/min/max/numeric/integer/matches/oneOf/url and the
 *      three field presets) produces the SAME `validate` result as its Rule
 *      replacement over a battery of values. The pre-S462 builders are
 *      transcribed VERBATIM below as the oracle.
 *   §2 custom checks — passed, not stored; missing check and non-Rule entries
 *      FAIL CLOSED.
 *   §3 no function in any value — Rule values and preset schemas hold none.
 *   §4 lockstep — the shim's `Rule` equals the compiler's lowering of
 *      `export type Rule:enum` in stdlib/data/validate.scrml, AND the compiled
 *      scrml mirror's `validate` agrees with the shim on the §1 battery.
 *   §5 export table — index.scrml / data.js agree; the retired builders are gone.
 *   §6 end-to-end — an adopter file compiles and validates in the PRUNED runtime.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import * as shim from "../../runtime/stdlib/data.js";
import { compileScrml } from "../../src/api.js";

const { Rule, validate, isValid, firstError, emailField, passwordField, passwordConfirmField } = shim;

const REPO = resolve(import.meta.dir, "../../..");
const TMP = mkdtempSync(join(tmpdir(), "data-rules-as-data-"));
afterAll(() => { if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// The pre-S462 builders, VERBATIM from compiler/runtime/stdlib/data.js at
// origin/main 980cb3001 — the parity oracle. (Closures in a JS test file; they
// are exactly the shape the ruling retires from the library.)
// ---------------------------------------------------------------------------
const old = (() => {
  function makeRule(check) { return { check }; }
  function validate(data, schema) {
    const errors = {};
    for (const field of Object.keys(schema)) {
      const value = data[field];
      for (const rule of schema[field]) {
        const result = rule.check(value, data);
        if (!result.valid) { errors[field] = errors[field] || []; errors[field].push(result.message); }
      }
    }
    return errors;
  }
  const required = (message) => makeRule((value) => {
    const valid = value !== null && value !== undefined && value !== "";
    return { valid, message: message || "This field is required" };
  });
  const email = (message) => makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
    return { valid, message: message || "Enter a valid email address" };
  });
  const minLength = (minVal, message) => makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    return { valid: String(value).length >= minVal, message: message || `Must be at least ${minVal} characters` };
  });
  const maxLength = (maxVal, message) => makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    return { valid: String(value).length <= maxVal, message: message || `Must be at most ${maxVal} characters` };
  });
  const exactLength = (len, message) => makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    return { valid: String(value).length === len, message: message || `Must be exactly ${len} characters` };
  });
  const pattern = (regex, message) => makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    return { valid: regex.test(String(value)), message: message || "Invalid format" };
  });
  const min = (minimum, message) => makeRule((value) => {
    const num = Number(value);
    return { valid: !isNaN(num) && num >= minimum, message: message || `Must be at least ${minimum}` };
  });
  const max = (maximum, message) => makeRule((value) => {
    const num = Number(value);
    return { valid: !isNaN(num) && num <= maximum, message: message || `Must be at most ${maximum}` };
  });
  const numeric = (message) => makeRule((value) => {
    if (value === "" || value === null || value === undefined) return { valid: true, message: "" };
    return { valid: !isNaN(Number(value)) && value !== "", message: message || "Must be a number" };
  });
  const integer = (message) => makeRule((value) => {
    if (value === "" || value === null || value === undefined) return { valid: true, message: "" };
    return { valid: Number.isInteger(Number(value)), message: message || "Must be a whole number" };
  });
  const matches = (fieldName, message) => makeRule((value, data) => {
    return { valid: value === data[fieldName], message: message || `Must match ${fieldName}` };
  });
  const oneOf = (allowedValues, message) => makeRule((value) => {
    return { valid: allowedValues.includes(value), message: message || `Must be one of: ${allowedValues.join(", ")}` };
  });
  const url = (message) => makeRule((value) => {
    if (!value) return { valid: true, message: "" };
    try { new URL(String(value)); return { valid: true, message: "" }; }
    catch { return { valid: false, message: message || "Enter a valid URL" }; }
  });
  const custom = (fn) => makeRule((value, data) => {
    const result = fn(value, data);
    if (result === true) return { valid: true, message: "" };
    return { valid: false, message: typeof result === "string" ? result : "Invalid value" };
  });
  const emailField = () => [required(), email()];
  const passwordField = (minLen) => [required(), minLength(minLen || 8)];
  const passwordConfirmField = (fieldName) => [required(), matches(fieldName || "password", "Passwords must match")];
  return { validate, required, email, minLength, maxLength, exactLength, pattern, min, max,
    numeric, integer, matches, oneOf, url, custom, emailField, passwordField, passwordConfirmField };
})();

// The battery: every value shape the builders branch on.
const VALUES = [
  undefined, null, "", " ", "a", "ab", "abc", "abcdefgh", "hello world",
  "test@example.com", "notanemail", "a@b", "a@b.c",
  "https://scrml.dev/x?y=1", "not a url", "mailto:x@y.z",
  "0", "7", "18", "120", "121", "-3", "3.5", "1e3", "NaN", "12abc",
  0, 7, 18, 120, 121, -3, 3.5, NaN, true, false,
  "admin", "user", "root", "secret", "Secret",
];
const OTHER = { password: "secret", other: "abc" };

// Each pair: [label, old schema rule(s), new Rule(s)].
const PAIRS = [
  ["required", [old.required()], [Rule.Req]],
  ["required(msg)", [old.required("Name please")], [Rule.WithMessage(Rule.Req, "Name please")]],
  ["email", [old.email()], [Rule.Email]],
  ["email(msg)", [old.email("Bad email")], [Rule.WithMessage(Rule.Email, "Bad email")]],
  ["minLength(3)", [old.minLength(3)], [Rule.MinLength(3)]],
  ["maxLength(3)", [old.maxLength(3)], [Rule.MaxLength(3)]],
  ["exactLength(3)", [old.exactLength(3)], [Rule.ExactLength(3)]],
  ["pattern", [old.pattern(/^[a-z]+$/)], [Rule.Pattern(/^[a-z]+$/)]],
  ["pattern(msg)", [old.pattern(/^\d+$/, "Digits only")], [Rule.WithMessage(Rule.Pattern(/^\d+$/), "Digits only")]],
  ["min(18)", [old.min(18)], [Rule.Min(18)]],
  ["max(120)", [old.max(120)], [Rule.Max(120)]],
  ["max(120, msg)", [old.max(120, "Too old")], [Rule.WithMessage(Rule.Max(120), "Too old")]],
  ["numeric", [old.numeric()], [Rule.Numeric]],
  ["integer", [old.integer()], [Rule.Integer]],
  ["matches", [old.matches("password")], [Rule.Matches("password")]],
  ["matches(msg)", [old.matches("password", "Passwords must match")], [Rule.WithMessage(Rule.Matches("password"), "Passwords must match")]],
  ["oneOf", [old.oneOf(["admin", "user"])], [Rule.OneOf(["admin", "user"])]],
  ["url", [old.url()], [Rule.Url]],
  ["url(msg)", [old.url("Link?")], [Rule.WithMessage(Rule.Url, "Link?")]],
  ["empty-msg keeps default", [old.min(18, "")], [Rule.WithMessage(Rule.Min(18), "")]],
  ["emailField", old.emailField(), emailField()],
  ["passwordField()", old.passwordField(), passwordField()],
  ["passwordField(12)", old.passwordField(12), passwordField(12)],
  ["passwordConfirmField()", old.passwordConfirmField(), passwordConfirmField()],
  ["passwordConfirmField(other)", old.passwordConfirmField("other"), passwordConfirmField("other")],
  ["stack", [old.required(), old.minLength(2), old.maxLength(5), old.pattern(/^[a-z]+$/)],
    [Rule.Req, Rule.MinLength(2), Rule.MaxLength(5), Rule.Pattern(/^[a-z]+$/)]],
];

// Bad input — shim and compiled mirror must fail closed IDENTICALLY (FIX ROUND 1 F2/F5/F6).
const BAD_CASES = [
  ["legacy { check } object", { f: [{ check: () => ({ valid: true, message: "" }) }] }, undefined],
  ["unknown string tag", { f: ["NotARule"] }, undefined],
  ["number entry", { f: [42] }, undefined],
  ["not entry", { f: [null] }, undefined],
  ["function entry", { f: [() => true] }, undefined],
  ["bare Rule, not in a list", { f: Rule.Req }, undefined],
  ["bare payload Rule, not in a list", { f: Rule.Min(3) }, undefined],
  ["Custom, no check", { f: [Rule.Custom("t")] }, undefined],
  ["Custom, string check", { f: [Rule.Custom("t")] }, "nope"],
  ["Custom, number check", { f: [Rule.Custom("t")] }, 42],
  ["Custom, object check", { f: [Rule.Custom("t")] }, { t: () => true }],
  ["WithMessage 0", { f: [Rule.WithMessage(Rule.Req, 0)] }, undefined],
  ["WithMessage false", { f: [Rule.WithMessage(Rule.Req, false)] }, undefined],
  ["WithMessage NaN", { f: [Rule.WithMessage(Rule.Req, NaN)] }, undefined],
  ["WithMessage not", { f: [Rule.WithMessage(Rule.Req, null)] }, undefined],
  ["WithMessage absent", { f: [Rule.WithMessage(Rule.Req)] }, undefined],
  ["WithMessage non-Rule inner", { f: [Rule.WithMessage("Nope", "Msg")] }, undefined],
];

function badBattery(runValidate) {
  return BAD_CASES.map(([label, schema, check]) => [label, runValidate({ f: "" }, schema, check)]);
}

function battery(runValidate) {
  const out = [];
  for (const [label, , rules] of PAIRS) {
    for (const v of VALUES) out.push([label, String(v), runValidate({ ...OTHER, f: v }, { f: rules })]);
  }
  return out;
}

describe("§1 parity — every retired builder ≡ its Rule replacement", () => {
  for (const [label, oldRules, newRules] of PAIRS) {
    test(label, () => {
      for (const v of VALUES) {
        const data = { ...OTHER, f: v };
        expect([String(v), validate(data, { f: newRules })])
          .toEqual([String(v), old.validate(data, { f: oldRules })]);
      }
    });
  }

  test("custom(fn) ≡ Rule.Custom(tag) + passed check, every result shape", () => {
    const results = [true, "Nope", "", false, 0, null, undefined, { x: 1 }];
    for (const r of results) {
      const fn = () => r;
      for (const v of ["", "x"]) {
        expect(validate({ f: v }, { f: [Rule.Custom("t")] }, () => r))
          .toEqual(old.validate({ f: v }, { f: [old.custom(fn)] }));
      }
    }
  });

  test("a whole multi-field schema, isValid and firstError unchanged", () => {
    const data = { email: "", password: "ab", confirm: "x", age: "12", role: "root" };
    const oldErr = old.validate(data, {
      email: old.emailField(), password: old.passwordField(), confirm: old.passwordConfirmField(),
      age: [old.min(18)], role: [old.oneOf(["admin", "user"])],
    });
    const newErr = validate(data, {
      email: emailField(), password: passwordField(), confirm: passwordConfirmField(),
      age: [Rule.Min(18)], role: [Rule.OneOf(["admin", "user"])],
    });
    expect(newErr).toEqual(oldErr);
    expect(isValid(newErr)).toBe(false);
    expect(firstError(newErr, "email")).toBe("This field is required");
    expect(firstError(newErr, "nope")).toBe(null);
    expect(isValid(validate({ a: "x" }, { a: [Rule.Req] }))).toBe(true);
  });
});

describe("§2 custom checks — passed at the call, never stored", () => {
  test("the check receives (tag, value, data) and dispatches on the tag", () => {
    const seen = [];
    const check = (tag, value, data) => {
      seen.push([tag, value, data.qty]);
      if (tag === "sku") return /^SKU-\d+$/.test(value) ? true : "Not a SKU";
      if (tag === "even") return value % 2 === 0 ? true : "Must be even";
      return true;
    };
    const errs = validate(
      { sku: "nope", qty: 3 },
      { sku: [Rule.Req, Rule.Custom("sku")], qty: [Rule.Custom("even")] },
      check,
    );
    expect(errs).toEqual({ sku: ["Not a SKU"], qty: ["Must be even"] });
    expect(seen).toEqual([["sku", "nope", 3], ["even", 3, 3]]);
  });

  test("WithMessage overrides a custom failure; a passing check stays clean", () => {
    const check = () => "raw";
    expect(validate({ f: 1 }, { f: [Rule.WithMessage(Rule.Custom("t"), "Pretty")] }, check))
      .toEqual({ f: ["Pretty"] });
    expect(validate({ f: 1 }, { f: [Rule.WithMessage(Rule.Custom("t"), "Pretty")] }, () => true))
      .toEqual({});
  });

  test("FAIL CLOSED — Rule.Custom with no check passed is an error, never a pass", () => {
    const errs = validate({ f: "x" }, { f: [Rule.Custom("sku")] });
    expect(errs.f).toHaveLength(1);
    expect(errs.f[0]).toContain('Rule.Custom("sku")');
  });

  test("FAIL CLOSED — a non-function check is an error, never a throw", () => {
    for (const bad of ["nope", 42, {}, true]) {
      const errs = validate({ f: "x" }, { f: [Rule.Custom("sku")] }, bad);
      expect(errs.f).toEqual(['No check function was passed to validate() for Rule.Custom("sku")']);
    }
  });

  test("WithMessage with a non-string or empty message keeps the default (old `message || default`)", () => {
    for (const m of [0, false, NaN, null, undefined, ""]) {
      expect(validate({ f: "" }, { f: [Rule.WithMessage(Rule.Req, m)] })).toEqual({ f: ["This field is required"] });
    }
  });

  test("a schema entry that is not a list gets ONE specific error", () => {
    expect(validate({ f: "" }, { f: Rule.Req })).toEqual({ f: ["The schema entry for f must be a list of Rule values"] });
    expect(validate({ f: "" }, { f: Rule.Min(3) })).toEqual({ f: ["The schema entry for f must be a list of Rule values"] });
  });

  test("FAIL CLOSED — a non-Rule schema entry (a pre-S462 { check } object) is an error", () => {
    const legacy = { check: () => ({ valid: true, message: "" }) };
    const errs = validate({ f: "x" }, { f: [legacy, "NotARule", 42] });
    expect(errs.f).toHaveLength(3);
    for (const m of errs.f) expect(m).toContain("Unknown validation rule");
  });
});

describe("§3 no function lands in a value", () => {
  function functionPaths(v, path = "$", out = []) {
    if (typeof v === "function") out.push(path);
    else if (v && typeof v === "object" && !(v instanceof RegExp)) {
      for (const k of Object.keys(v)) functionPaths(v[k], `${path}.${k}`, out);
    }
    return out;
  }

  test("every Rule value, presets included, is plain data", () => {
    const values = [
      Rule.Req, Rule.Email, Rule.Url, Rule.Numeric, Rule.Integer,
      Rule.Pattern(/x/), Rule.Min(1), Rule.Max(2), Rule.OneOf([1, 2]),
      Rule.MinLength(1), Rule.MaxLength(2), Rule.ExactLength(3), Rule.Matches("a"),
      Rule.Custom("t"), Rule.WithMessage(Rule.WithMessage(Rule.Min(1), "a"), "b"),
      emailField(), passwordField(), passwordConfirmField(),
    ];
    for (const v of values) expect(functionPaths(v)).toEqual([]);
  });

  test("Rule covers exactly the declared variants", () => {
    expect(Rule.variants).toEqual([
      "Req", "Pattern", "Min", "Max", "OneOf", "MinLength", "MaxLength",
      "ExactLength", "Matches", "Email", "Url", "Numeric", "Integer", "Custom", "WithMessage",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §4 — the compiled stdlib/data/validate.scrml vs the shim
// ---------------------------------------------------------------------------
function compileToDir(srcPath, name) {
  const outDir = join(TMP, name);
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcPath], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const base = srcPath.split("/").pop().replace(/\.scrml$/, "");
  const clientPath = join(outDir, `${base}.client.js`);
  const runtimePath = join(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  return {
    errors,
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

// Run runtime + client in one scope, with `hook` appended INSIDE the client's
// outer IIFE (before its final `})();`) so it can read the module's locals.
function runWithHook(compiled, hook) {
  const cl = compiled.clientJs;
  const cut = cl.lastIndexOf("})();");
  const exposed = cl.slice(0, cut) + hook + "\n" + cl.slice(cut);
  const sandbox = {};
  new Function("__out", "globalThis", `${compiled.runtimeJs}\n${exposed}`)(sandbox, globalThis);
  return sandbox;
}

describe("§4 lockstep — compiled validate.scrml ≡ the shim", () => {
  const compiled = compileToDir(join(REPO, "stdlib/data/validate.scrml"), "validate-mirror");

  test("the stdlib source compiles clean", () => {
    expect(compiled.errors.map((e) => e.code)).toEqual([]);
  });

  test("the compiler's Rule lowering equals the shim's Rule, variant by variant", () => {
    const s = runWithHook(compiled, "__out.Rule = Rule;");
    const R = s.Rule;
    expect(R.variants).toEqual(Rule.variants);
    const re = /^x$/;
    const sample = {
      Pattern: [re], Min: [3], Max: [4], OneOf: [[1, 2]], MinLength: [5], MaxLength: [6],
      ExactLength: [7], Matches: ["f"], Custom: ["t"], WithMessage: [Rule.Req, "m"],
    };
    for (const v of Rule.variants) {
      if (typeof Rule[v] === "string") expect(R[v]).toBe(Rule[v]);
      else expect(R[v](...sample[v])).toEqual(Rule[v](...sample[v]));
    }
  });

  test("the compiled scrml validate agrees with the shim on the whole §1 battery", () => {
    const fnName = (compiled.clientJs.match(/function (_scrml_validate_\d+)\(/) || [])[1];
    expect(fnName).toBeTruthy();
    const s = runWithHook(compiled, `__out.validate = ${fnName};`);
    expect(battery(s.validate)).toEqual(battery(validate));
  });

  test("the compiled scrml validate agrees with the shim on BAD input (fails closed the same way)", () => {
    const fnName = (compiled.clientJs.match(/function (_scrml_validate_\d+)\(/) || [])[1];
    const s = runWithHook(compiled, `__out.validate = ${fnName};`);
    const mirror = badBattery(s.validate);
    expect(mirror).toEqual(badBattery(validate));
    // and every bad case is an ERROR, never a silent pass
    for (const [label, errs] of mirror) expect([label, Object.keys(errs).length]).toEqual([label, 1]);
  });
});

describe("§5 export table", () => {
  const index = readFileSync(join(REPO, "stdlib/data/index.scrml"), "utf8");
  const RETIRED = ["required", "email", "minLength", "maxLength", "exactLength", "pattern",
    "min", "max", "numeric", "integer", "matches", "oneOf", "url", "custom"];

  test("index.scrml re-exports Rule from validate.scrml, and no retired builder", () => {
    const m = index.match(/export\s*\{([^}]*)\}\s*from\s*'\.\/validate\.scrml'/);
    expect(m).toBeTruthy();
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    expect(names.sort()).toEqual(
      ["Rule", "validate", "isValid", "firstError", "emailField", "passwordField", "passwordConfirmField"].sort(),
    );
    for (const name of names) expect(name in shim).toBe(true);
  });

  test("the shim no longer exports a retired builder", () => {
    for (const name of RETIRED) expect(name in shim).toBe(false);
  });
});

describe("§6 end-to-end — an adopter validates in the pruned runtime", () => {
  test("Rule values + a passed check produce the expected errors", () => {
    const src = join(TMP, "adopter.scrml");
    writeFileSync(src, `<program>
\${
    import { validate, isValid, Rule, passwordConfirmField } from 'scrml:data'
    function checkSku(tag, value) {
        return value == "SKU-1" ? true : "Not a known SKU"
    }
    const errs = validate(
        { name: "", age: "7", sku: "x", password: "a", confirm: "b" },
        { name: [Rule.Req, Rule.MinLength(2)], age: [Rule.Min(18)], sku: [Rule.Custom("sku")], confirm: passwordConfirmField() },
        checkSku
    )
    const ok = isValid(errs)
}
<p>\${ok}</p>
</program>
`);
    const compiled = compileToDir(src, "adopter");
    expect(compiled.errors.map((e) => e.code)).toEqual([]);
    // The emitted runtime is the PRUNED per-app artifact, and it carries Rule.
    expect(compiled.runtimeJs).toContain("WithMessage");
    const s = runWithHook(compiled, "__out.errs = errs; __out.ok = ok;");
    expect(s.errs).toEqual({
      name: ["This field is required"],
      age: ["Must be at least 18"],
      sku: ["Not a known SKU"],
      confirm: ["Passwords must match"],
    });
    expect(s.ok).toBe(false);
  });
});
