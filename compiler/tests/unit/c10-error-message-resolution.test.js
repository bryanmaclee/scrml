/**
 * c10-error-message-resolution.test.js — A1c Step C10 unit tests
 *
 * Tests 4-level error message resolution chain emission per SPEC §55.10 (the
 * chain) + §55.9 (ValidationError enum) + §41.12 (registerMessages API).
 *
 *   §C10.0  Chunk wiring — `messages` chunk in RUNTIME_CHUNK_ORDER + content
 *   §C10.1  Tree-shaking — chunk omitted when no validator carries
 *           `inlineOverride` (and no future <errors of=> element)
 *   §C10.2  Chunk-detection — adds `messages` when ANY validator has a
 *           non-null inlineOverride
 *   §C10.3  Codegen — `_scrml_messages_register_inline` emission per
 *           override; one call per (cell, validator)
 *   §C10.4  Codegen — `null` emission when no overrides present
 *   §C10.5  Skip rules — server boundary, insideFunctionBody
 *   §C10.6  Runtime Level-3 — default catalog renders for all 14 + Custom +
 *           fallback
 *   §C10.7  Runtime Level-2 — registered message wins over Level-3 default
 *   §C10.8  Runtime Level-1 — inline override wins over Level-2 + Level-3
 *   §C10.9  Runtime — `registerMessages` last-write-wins composition
 *   §C10.10 Runtime — parameterised tags interpolate payload
 *
 * SCOPE: per A1c BRIEF C10 — Level-1 codegen + 4-level runtime helper. OUT OF
 * SCOPE: <errors of=> element (C11), cross-field deps verification (C9),
 * engine-state validators (§55.14 — Wave 4+), match Level-4 escape hatch
 * (consumer-side, not C10).
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { emitInlineMessageOverrides } from "../../src/codegen/emit-messages.ts";
import {
  RUNTIME_CHUNKS,
  RUNTIME_CHUNK_ORDER,
  assembleRuntime,
} from "../../src/codegen/runtime-chunks.ts";

// ---------------------------------------------------------------------------
// AST construction helpers — minimal shapes mirroring c7-test patterns.
// ---------------------------------------------------------------------------

function span() { return { start: 0, end: 0 }; }

function lit(litType, raw) {
  return { kind: "lit", litType, raw, span: span() };
}

function relational(op, value) {
  return { kind: "relational-predicate", op, value, span: span() };
}

function bareValidator(name) {
  return { name, args: null, span: span() };
}

function callValidator(name, args) {
  return { name, args, span: span() };
}

function callValidatorWithOverride(name, args, override) {
  return { name, args, span: span(), inlineOverride: override };
}

function compoundChild(name, init, validators) {
  return {
    kind: "state-decl",
    name,
    init,
    initExpr: lit("string", JSON.stringify(init)),
    shape: "plain",
    structuralForm: true,
    isConst: false,
    _cellKind: "plain",
    validators: validators || [],
    span: span(),
  };
}

function compoundParent(name, children) {
  return {
    kind: "state-decl",
    name,
    init: "",
    initExpr: null,
    shape: "plain",
    structuralForm: true,
    isConst: false,
    _cellKind: "compound-parent",
    children,
    span: span(),
  };
}

function clientOpts() {
  return { boundary: "client" };
}

// ---------------------------------------------------------------------------
// Sandbox helper — assemble runtime + expose helpers as a callable API.
// ---------------------------------------------------------------------------

function buildMessagesSandbox() {
  // Use full RUNTIME_CHUNK_ORDER so any cross-chunk references resolve. The
  // probe `return` exposes the runtime helpers we want to exercise. Each
  // sandbox is fresh — global state (Level-1/Level-2 tables) doesn't leak.
  const runtime = assembleRuntime(new Set(RUNTIME_CHUNK_ORDER));
  const probe = `
    return {
      messageFor: _scrml_message_for,
      registerInline: _scrml_messages_register_inline,
      register: _scrml_messages_register,
      defaults: _SCRML_DEFAULT_MESSAGES,
      tagToValidator: _SCRML_TAG_TO_VALIDATOR,
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(runtime + probe)();
}

// ---------------------------------------------------------------------------
// §C10.0 — Chunk wiring
// ---------------------------------------------------------------------------

describe("C10 §C10.0 — Chunk wiring", () => {
  test("'messages' is registered in RUNTIME_CHUNK_ORDER", () => {
    expect(RUNTIME_CHUNK_ORDER).toContain("messages");
  });

  test("'messages' chunk content includes _scrml_message_for", () => {
    expect(RUNTIME_CHUNKS.messages).toContain("function _scrml_message_for");
  });

  test("'messages' chunk content includes _scrml_messages_register", () => {
    expect(RUNTIME_CHUNKS.messages).toContain("function _scrml_messages_register");
  });

  test("'messages' chunk content includes _scrml_messages_register_inline", () => {
    expect(RUNTIME_CHUNKS.messages).toContain("function _scrml_messages_register_inline");
  });

  test("'messages' chunk content includes _SCRML_DEFAULT_MESSAGES", () => {
    expect(RUNTIME_CHUNKS.messages).toContain("_SCRML_DEFAULT_MESSAGES");
  });

  test("'messages' chunk content includes _SCRML_TAG_TO_VALIDATOR", () => {
    expect(RUNTIME_CHUNKS.messages).toContain("_SCRML_TAG_TO_VALIDATOR");
  });

  test("RUNTIME_CHUNK_ORDER has 29 chunks total (17 + 'engine' added by C13 + 'prefetch' added by A-4.3 + 'mount' + 'vendor-ref' added by A-4.7 + 'wire' added by v0.3.x SPA tree-shake Phase B 3.2 + 4 'stdlib-*' chunks added by Bug 18 S95 + 'modules' added by known-gaps-#6 S152 + 'map' added by §59 map-arc phase-c D3 S169 + 'log' added by §20.6 log-builtin S174)", () => {
    expect(RUNTIME_CHUNK_ORDER.length).toBe(29);
  });
});

// ---------------------------------------------------------------------------
// §C10.1 — Tree-shaking — chunk omitted when not needed
// ---------------------------------------------------------------------------

describe("C10 §C10.1 — Tree-shaking", () => {
  test("core-only assembly does NOT include messages helpers", () => {
    const minimal = assembleRuntime(new Set(["core"]));
    expect(minimal).not.toContain("_scrml_message_for");
    expect(minimal).not.toContain("_scrml_messages_register_inline");
  });

  test("core+validators assembly does NOT include messages helpers", () => {
    // C7 chunk on its own should NOT pull in messages — they're independent.
    const noMessages = assembleRuntime(new Set(["core", "validators"]));
    expect(noMessages).not.toContain("_scrml_message_for");
  });

  test("core+messages assembly includes messages helpers", () => {
    const withMessages = assembleRuntime(new Set(["core", "messages"]));
    expect(withMessages).toContain("function _scrml_message_for");
  });
});

// ---------------------------------------------------------------------------
// §C10.2 — Chunk-detection trigger
// ---------------------------------------------------------------------------
//
// Detection lives in emit-client.ts:detectRuntimeChunks. We test the trigger
// indirectly here by exercising the AST shape — a state-decl with a validator
// carrying inlineOverride should add 'messages' to the chunk set. Since
// detectRuntimeChunks is internal, we only verify the AST shape itself
// (the integration test is implicit in the codegen tests below).

describe("C10 §C10.2 — Inline override AST shape", () => {
  test("validator with non-null inlineOverride is detectable on AST", () => {
    const v = callValidatorWithOverride("req", null, "Please enter your name");
    expect(v.inlineOverride).toBe("Please enter your name");
    expect(typeof v.inlineOverride).toBe("string");
  });

  test("validator with null inlineOverride is detectable on AST", () => {
    const v = bareValidator("req");
    expect(v.inlineOverride).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §C10.3 — Codegen: emit registration per override
// ---------------------------------------------------------------------------

describe("C10 §C10.3 — Codegen emits _scrml_messages_register_inline per override", () => {
  test("single inline override emits one register call", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, "Please enter your name"),
    ]);
    const out = emitInlineMessageOverrides(child, "signup.name", { boundary: "client" });
    expect(out).not.toBeNull();
    expect(out).toContain('_scrml_messages_register_inline("signup.name", "req", "Please enter your name");');
  });

  test("multiple overrides emit multiple register calls — one per validator", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, "Please enter your name"),
      callValidatorWithOverride(
        "length",
        [relational(">=", lit("number", "2")), lit("string", '"Must be at least 2 chars"')],
        "Must be at least 2 chars",
      ),
    ]);
    const out = emitInlineMessageOverrides(child, "signup.name", { boundary: "client" });
    expect(out).not.toBeNull();
    expect(out).toContain('_scrml_messages_register_inline("signup.name", "req", "Please enter your name");');
    expect(out).toContain('_scrml_messages_register_inline("signup.name", "length", "Must be at least 2 chars");');
  });

  test("mixed validators — only those with inlineOverride emit registration", () => {
    const child = compoundChild("email", "", [
      bareValidator("req"),                                                                  // no override
      callValidatorWithOverride("pattern", [lit("regex", "/.+@.+/")], "Please enter an email"), // override
    ]);
    const out = emitInlineMessageOverrides(child, "signup.email", { boundary: "client" });
    expect(out).not.toBeNull();
    expect(out).not.toContain('_scrml_messages_register_inline("signup.email", "req"');
    expect(out).toContain('_scrml_messages_register_inline("signup.email", "pattern", "Please enter an email");');
  });

  test("integration via emitLogicNode — overrides land in compiled output", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, "Please enter your name"),
    ]);
    const parent = compoundParent("signup", [child]);
    const out = emitLogicNode(parent, clientOpts());
    expect(out).toContain('_scrml_messages_register_inline("signup.name", "req", "Please enter your name");');
  });

  test("integration via emitLogicNode — registration appears AFTER validator runner", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, "Please enter your name"),
    ]);
    const parent = compoundParent("signup", [child]);
    const out = emitLogicNode(parent, clientOpts());
    const runnerIdx = out.indexOf('_scrml_derived_declare("signup.name.errors"');
    const registerIdx = out.indexOf('_scrml_messages_register_inline("signup.name", "req"');
    expect(runnerIdx).toBeGreaterThanOrEqual(0);
    expect(registerIdx).toBeGreaterThan(runnerIdx);
  });
});

// ---------------------------------------------------------------------------
// §C10.4 — Codegen: null when no overrides present
// ---------------------------------------------------------------------------

describe("C10 §C10.4 — Codegen returns null when no overrides", () => {
  test("validators with no inlineOverride → null", () => {
    const child = compoundChild("name", "", [
      bareValidator("req"),
      callValidator("length", [relational(">=", lit("number", "2"))]),
    ]);
    const out = emitInlineMessageOverrides(child, "signup.name", { boundary: "client" });
    expect(out).toBeNull();
  });

  test("empty validators array → null", () => {
    const child = compoundChild("name", "", []);
    const out = emitInlineMessageOverrides(child, "signup.name", { boundary: "client" });
    expect(out).toBeNull();
  });

  test("missing validators field → null", () => {
    const child = { kind: "state-decl", name: "x", span: span() };
    const out = emitInlineMessageOverrides(child, "x", { boundary: "client" });
    expect(out).toBeNull();
  });

  test("validator with inlineOverride: null → null", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, null),
    ]);
    const out = emitInlineMessageOverrides(child, "signup.name", { boundary: "client" });
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C10.5 — Skip rules
// ---------------------------------------------------------------------------

describe("C10 §C10.5 — Skip rules", () => {
  test("server boundary skips emission", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, "Please enter your name"),
    ]);
    const out = emitInlineMessageOverrides(child, "signup.name", { boundary: "server" });
    expect(out).toBeNull();
  });

  test("insideFunctionBody skips emission", () => {
    const child = compoundChild("name", "", [
      callValidatorWithOverride("req", null, "Please enter your name"),
    ]);
    const out = emitInlineMessageOverrides(child, "signup.name", {
      boundary: "client",
      insideFunctionBody: true,
    });
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C10.6 — Runtime Level-3 default catalog
// ---------------------------------------------------------------------------

describe("C10 §C10.6 — Level-3 default catalog renders for all tags", () => {
  // Data-driven table — single source of truth for default-message phrasing.
  // Format: [tag, payload-shape, expected-substring-fragments].
  // Phrasing-as-substrings (not full-string) so future tweaks don't churn.
  const cases = [
    ["Required",        { tag: "Required" },                                   ["name", "required"]],
    ["NotSome",         { tag: "NotSome" },                                    ["name", "required"]],
    ["LengthFailed",    { tag: "LengthFailed", predicate: { op: ">=", value: 2 } }, ["name", "length", ">= 2"]],
    ["PatternMismatch", { tag: "PatternMismatch", re: /.+/ },                  ["name", "format"]],
    ["MinFailed",       { tag: "MinFailed", threshold: 18 },                   ["name", "at least", "18"]],
    ["MaxFailed",       { tag: "MaxFailed", threshold: 99 },                   ["name", "at most", "99"]],
    ["GtFailed",        { tag: "GtFailed", expected: 0 },                      ["name", "greater than", "0"]],
    ["LtFailed",        { tag: "LtFailed", expected: 100 },                    ["name", "less than", "100"]],
    ["GteFailed",       { tag: "GteFailed", expected: 0 },                     ["name", "greater than or equal", "0"]],
    ["LteFailed",       { tag: "LteFailed", expected: 100 },                   ["name", "less than or equal", "100"]],
    ["EqFailed",        { tag: "EqFailed", expected: "alice" },                ["name", "equal", "alice"]],
    ["NeqFailed",       { tag: "NeqFailed", forbidden: "admin" },              ["name", "cannot equal", "admin"]],
    ["OneOfFailed",     { tag: "OneOfFailed", set: ["a", "b", "c"] },          ["name", "one of", "a, b, c"]],
    ["NotInFailed",     { tag: "NotInFailed", set: ["root", "admin"] },        ["name", "cannot be any of", "root, admin"]],
    ["Custom",          { tag: "Custom", tag_string: "TooSpicy" },             ["name", "TooSpicy"]],
  ];

  for (const [label, error, fragments] of cases) {
    test(`${label}: default message renders with all expected fragments`, () => {
      const api = buildMessagesSandbox();
      const msg = api.messageFor(error, "name");
      for (const frag of fragments) {
        expect(msg).toContain(frag);
      }
    });
  }

  test("unknown tag falls back to fieldName + ' is invalid.'", () => {
    const api = buildMessagesSandbox();
    const msg = api.messageFor({ tag: "FutureUnknownTag" }, "weirdField");
    expect(msg).toBe("weirdField is invalid.");
  });

  test("null/undefined error falls back to fallback message", () => {
    const api = buildMessagesSandbox();
    expect(api.messageFor(null, "name")).toBe("name is invalid.");
    expect(api.messageFor(undefined, "name")).toBe("name is invalid.");
    expect(api.messageFor({}, "name")).toBe("name is invalid.");
    expect(api.messageFor({ tag: 42 }, "name")).toBe("name is invalid.");
  });
});

// ---------------------------------------------------------------------------
// §C10.7 — Level-2 registered messages win over Level-3 default
// ---------------------------------------------------------------------------

describe("C10 §C10.7 — Level-2 registered wins over Level-3 default", () => {
  test("registered .Required overrides default for that tag", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (field) => "Please fill in " + field + "." });
    expect(api.messageFor({ tag: "Required" }, "email")).toBe("Please fill in email.");
  });

  test("registered tag does NOT affect other tags (still default)", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (field) => "Please fill in " + field + "." });
    // MinFailed not registered — should still hit Level-3.
    const msg = api.messageFor({ tag: "MinFailed", threshold: 18 }, "age");
    expect(msg).toContain("at least");
    expect(msg).toContain("18");
  });

  test("registered function receives positional payload args", () => {
    const api = buildMessagesSandbox();
    api.register({
      MinFailed: (field, threshold) => field + " requires minimum " + threshold,
    });
    expect(api.messageFor({ tag: "MinFailed", threshold: 21 }, "age")).toBe("age requires minimum 21");
  });

  test("registered function returning non-string falls through to Level-3", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: () => 42 }); // bug-shaped registration
    const msg = api.messageFor({ tag: "Required" }, "name");
    expect(msg).toContain("name");
    expect(msg).toContain("required");
  });

  test("registered function that throws falls through to Level-3", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: () => { throw new Error("boom"); } });
    const msg = api.messageFor({ tag: "Required" }, "name");
    expect(msg).toContain("name");
    expect(msg).toContain("required");
  });
});

// ---------------------------------------------------------------------------
// §C10.8 — Level-1 inline override wins over Level-2 + Level-3
// ---------------------------------------------------------------------------

describe("C10 §C10.8 — Level-1 inline override wins over Level-2 + Level-3", () => {
  test("inline override beats registered + default for matching (cell, validator)", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (field) => "Please fill in " + field + "." });
    api.registerInline("signup.name", "req", "Name is required, friend.");
    // Same tag (Required), same cell (signup.name) — Level 1 wins.
    expect(api.messageFor({ tag: "Required" }, "name", "signup.name")).toBe("Name is required, friend.");
  });

  test("inline override on different cell does NOT bleed across cells", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (field) => "Please fill in " + field + "." });
    api.registerInline("signup.name", "req", "Name is required, friend.");
    // Different cell — should fall to Level 2.
    expect(api.messageFor({ tag: "Required" }, "email", "signup.email")).toBe("Please fill in email.");
  });

  test("inline override only fires when cellName is provided", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (field) => "Please fill in " + field + "." });
    api.registerInline("signup.name", "req", "Name is required, friend.");
    // No cellName → Level 1 skipped → Level 2 used.
    expect(api.messageFor({ tag: "Required" }, "name")).toBe("Please fill in name.");
  });

  test("inline override falls through when tag's validator-name not in map", () => {
    const api = buildMessagesSandbox();
    // Defensive: if Tag → validator mapping missing for some weird tag, L1 skips.
    api.registerInline("signup.name", "req", "Name is required, friend.");
    // Pass a tag with no map entry — should hit Level 3.
    const msg = api.messageFor({ tag: "FutureUnknownTag" }, "name", "signup.name");
    expect(msg).toBe("name is invalid.");
  });

  test("inline override with payload tag still wins", () => {
    const api = buildMessagesSandbox();
    api.registerInline("signup.age", "min", "Must be 18 or older.");
    expect(api.messageFor({ tag: "MinFailed", threshold: 18 }, "age", "signup.age")).toBe("Must be 18 or older.");
  });
});

// ---------------------------------------------------------------------------
// §C10.9 — registerMessages last-write-wins composition
// ---------------------------------------------------------------------------

describe("C10 §C10.9 — registerMessages composes (last-write-wins per key)", () => {
  test("two register calls with disjoint keys both apply", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (f) => "REQ:" + f });
    api.register({ MinFailed: (f, n) => "MIN:" + f + ":" + n });
    expect(api.messageFor({ tag: "Required" }, "x")).toBe("REQ:x");
    expect(api.messageFor({ tag: "MinFailed", threshold: 5 }, "y")).toBe("MIN:y:5");
  });

  test("two register calls with overlapping keys — last write wins", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: (f) => "FIRST:" + f });
    api.register({ Required: (f) => "SECOND:" + f });
    expect(api.messageFor({ tag: "Required" }, "x")).toBe("SECOND:x");
  });

  test("register ignores non-function values gracefully", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "not a function", MinFailed: 42 });
    // No registered fn → Level 3 default.
    const msg = api.messageFor({ tag: "Required" }, "x");
    expect(msg).toContain("required");
  });

  test("register ignores null/undefined map gracefully", () => {
    const api = buildMessagesSandbox();
    api.register(null);
    api.register(undefined);
    api.register("not an object");
    // No throws — and no entries added.
    const msg = api.messageFor({ tag: "Required" }, "x");
    expect(msg).toContain("required");
  });
});

// ---------------------------------------------------------------------------
// §C10.10 — Parameterised tags interpolate payload via Level-2
// ---------------------------------------------------------------------------

describe("C10 §C10.10 — Parameterised tags pass payload to Level-2 functions", () => {
  test("LengthFailed payload reaches registered function", () => {
    const api = buildMessagesSandbox();
    api.register({
      LengthFailed: (field, predicate) => field + " " + predicate.op + " " + predicate.value,
    });
    expect(api.messageFor(
      { tag: "LengthFailed", predicate: { op: ">=", value: 8 } },
      "password",
    )).toBe("password >= 8");
  });

  test("OneOfFailed array payload reaches registered function", () => {
    const api = buildMessagesSandbox();
    api.register({
      OneOfFailed: (field, set) => field + " in [" + set.join(",") + "]",
    });
    expect(api.messageFor(
      { tag: "OneOfFailed", set: ["a", "b"] },
      "role",
    )).toBe("role in [a,b]");
  });

  test("Custom payload (tag_string) reaches default-catalog renderer", () => {
    const api = buildMessagesSandbox();
    expect(api.messageFor(
      { tag: "Custom", tag_string: "TooSpicy" },
      "salsa",
    )).toContain("TooSpicy");
  });

  test("Custom payload via legacy customTag field also resolves", () => {
    const api = buildMessagesSandbox();
    expect(api.messageFor(
      { tag: "Custom", customTag: "Legacy" },
      "salsa",
    )).toContain("Legacy");
  });
});

// ---------------------------------------------------------------------------
// §C10.11 — Tag → validator mapping completeness
// ---------------------------------------------------------------------------

describe("C10 §C10.11 — _SCRML_TAG_TO_VALIDATOR covers the 14 universal-core + Custom", () => {
  test("all 14 universal-core tags + Custom present in tag-to-validator map", () => {
    const api = buildMessagesSandbox();
    const expectedTags = [
      "Required", "NotSome", "LengthFailed", "PatternMismatch",
      "MinFailed", "MaxFailed", "GtFailed", "LtFailed", "GteFailed", "LteFailed",
      "EqFailed", "NeqFailed", "OneOfFailed", "NotInFailed",
      "Custom",
    ];
    for (const tag of expectedTags) {
      expect(typeof api.tagToValidator[tag]).toBe("string");
    }
  });

  test("Required maps to 'req' (not 'required')", () => {
    const api = buildMessagesSandbox();
    expect(api.tagToValidator.Required).toBe("req");
  });

  test("NotSome maps to 'is some'", () => {
    const api = buildMessagesSandbox();
    expect(api.tagToValidator.NotSome).toBe("is some");
  });
});
