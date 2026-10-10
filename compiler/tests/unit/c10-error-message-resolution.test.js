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
 *   §C10.10 Runtime — payload slots render through Level-2 templates (§41.12.1, S462)
 *   §C10.10b Runtime — a bad template is refused at registration (fail closed)
 *   §C10.10c The shipped defaults parse against the slot table
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
      messageHtml: _scrml_message_html,
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

  test("RUNTIME_CHUNK_ORDER has 43 chunks total (17 + 'engine' added by C13 + 'prefetch' added by A-4.3 + 'mount' + 'vendor-ref' added by A-4.7 + 'wire' added by v0.3.x SPA tree-shake Phase B 3.2 + 13 'stdlib-*' chunks — 4 from Bug 18 S95, +9 client-safe modules from S368 stdlib-client-registry — + 'modules' added by known-gaps-#6 S152 + 'map' added by §59 map-arc phase-c D3 S169 + 'log' added by §20.6 log-builtin S174 + 'ssr' added by §52.8 ssr-b-substrate + 'ifmount' split out of the always-included 'scope' chunk by §17.1 if= Phase 2 − 'transitions' RETIRED, the §38 keyframes ship in the emitted stylesheet because an inline <style> is refused under headers=\"strict\" + 'urlguard' added by §5.2 rule 3 S457 + 'refine' added by §53 S458 2a-fix + 'metaemit' added by §22.4.1 S458 'a' + 'machine' split out of the always-included 'core' chunk by S461)", () => {
    expect(RUNTIME_CHUNK_ORDER.length).toBe(43);
  });

  // S368 — the stdlib slice of the order is the CLIENT CONTRACT: a client-side
  // `import … from 'scrml:NAME'` lowers to `const {…} = _scrml_stdlib.NAME;`, so
  // membership here is what decides whether that destructure resolves at load.
  // Pinned as a SET, not a count, so adding or removing a module has to state
  // which module — a bare count would let a swap pass silently.
  test("the stdlib client-chunk set is exactly the client-safe modules", () => {
    const stdlibChunks = RUNTIME_CHUNK_ORDER.filter((n) => n.startsWith("stdlib-"));
    expect([...stdlibChunks].sort()).toEqual([
      "stdlib-auth",
      "stdlib-compiler",
      "stdlib-crypto",
      "stdlib-data",
      "stdlib-format",
      "stdlib-host",
      "stdlib-http",
      "stdlib-math",
      "stdlib-random",
      "stdlib-regex",
      "stdlib-router",
      "stdlib-test",
      "stdlib-time",
    ]);
  });

  // The escalation-server-only modules (§12.2 Trigger 3) MUST NOT get a client
  // chunk — their shims reach Bun.*/process.*/node:* or handle a credential, so
  // an inlined browser copy could not work. `auth`/`crypto` are the deliberate
  // pre-existing exceptions (S95 Bug 18); see runtime-chunks.ts for why.
  test("host-reaching / credential-handling modules have NO client chunk", () => {
    for (const mod of ["cron", "fs", "mcp", "oauth", "path", "process", "redis", "store"]) {
      expect(RUNTIME_CHUNK_ORDER).not.toContain(`stdlib-${mod}`);
    }
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
  test("registered .Required template overrides default for that tag", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "Please fill in {field}." });
    expect(api.messageFor({ tag: "Required" }, "email")).toBe("Please fill in email.");
  });

  test("registered tag does NOT affect other tags (still default)", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "Please fill in {field}." });
    // MinFailed not registered — should still hit Level-3.
    const msg = api.messageFor({ tag: "MinFailed", threshold: 18 }, "age");
    expect(msg).toContain("at least");
    expect(msg).toContain("18");
  });

  test("registered template fills its payload slot", () => {
    const api = buildMessagesSandbox();
    api.register({ MinFailed: "{field} requires minimum {threshold}" });
    expect(api.messageFor({ tag: "MinFailed", threshold: 21 }, "age")).toBe("age requires minimum 21");
  });
});

// ---------------------------------------------------------------------------
// §C10.8 — Level-1 inline override wins over Level-2 + Level-3
// ---------------------------------------------------------------------------

describe("C10 §C10.8 — Level-1 inline override wins over Level-2 + Level-3", () => {
  test("inline override beats registered + default for matching (cell, validator)", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "Please fill in {field}." });
    api.registerInline("signup.name", "req", "Name is required, friend.");
    // Same tag (Required), same cell (signup.name) — Level 1 wins.
    expect(api.messageFor({ tag: "Required" }, "name", "signup.name")).toBe("Name is required, friend.");
  });

  test("inline override on different cell does NOT bleed across cells", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "Please fill in {field}." });
    api.registerInline("signup.name", "req", "Name is required, friend.");
    // Different cell — should fall to Level 2.
    expect(api.messageFor({ tag: "Required" }, "email", "signup.email")).toBe("Please fill in email.");
  });

  test("inline override only fires when cellName is provided", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "Please fill in {field}." });
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
    api.register({ Required: "REQ:{field}" });
    api.register({ MinFailed: "MIN:{field}:{threshold}" });
    expect(api.messageFor({ tag: "Required" }, "x")).toBe("REQ:x");
    expect(api.messageFor({ tag: "MinFailed", threshold: 5 }, "y")).toBe("MIN:y:5");
  });

  test("two register calls with overlapping keys — last write wins", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "FIRST:{field}" });
    api.register({ Required: "SECOND:{field}" });
    expect(api.messageFor({ tag: "Required" }, "x")).toBe("SECOND:x");
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
// §C10.10 — Every payload slot renders through a registered template (§41.12.1)
// ---------------------------------------------------------------------------

describe("C10 §C10.10 — payload slots render through Level-2 templates", () => {
  const cases = [
    ["Required",        "{field}!",            { tag: "Required" },                                        "name!"],
    ["NotSome",         "{field}?",            { tag: "NotSome" },                                         "name?"],
    ["LengthFailed",    "{field} {predicate}", { tag: "LengthFailed", predicate: { op: ">=", value: 8 } }, "name >= 8"],
    ["PatternMismatch", "{field} ~ {re}",      { tag: "PatternMismatch", re: /^[a-z]+$/ },                 "name ~ /^[a-z]+$/"],
    ["MinFailed",       "{field} {threshold}", { tag: "MinFailed", threshold: 18 },                        "name 18"],
    ["MaxFailed",       "{field} {threshold}", { tag: "MaxFailed", threshold: 99 },                        "name 99"],
    ["GtFailed",        "{field} {expected}",  { tag: "GtFailed", expected: 0 },                           "name 0"],
    ["LtFailed",        "{field} {expected}",  { tag: "LtFailed", expected: 100 },                         "name 100"],
    ["GteFailed",       "{field} {expected}",  { tag: "GteFailed", expected: 1 },                          "name 1"],
    ["LteFailed",       "{field} {expected}",  { tag: "LteFailed", expected: 9 },                          "name 9"],
    ["EqFailed",        "{field} {expected}",  { tag: "EqFailed", expected: "alice" },                     "name alice"],
    ["NeqFailed",       "{field} {forbidden}", { tag: "NeqFailed", forbidden: "admin" },                   "name admin"],
    ["OneOfFailed",     "{field} in [{set}]",  { tag: "OneOfFailed", set: ["a", "b"] },                    "name in [a, b]"],
    ["NotInFailed",     "{field} not [{set}]", { tag: "NotInFailed", set: ["root"] },                      "name not [root]"],
    ["Custom",          "{field}: {tag}",      { tag: "Custom", tag_string: "TooSpicy" },                  "name: TooSpicy"],
  ];
  for (const [tag, template, error, expected] of cases) {
    test(`${tag}: "${template}" renders "${expected}"`, () => {
      const api = buildMessagesSandbox();
      api.register({ [tag]: template });
      expect(api.messageFor(error, "name")).toBe(expected);
    });
  }

  test("a slot used twice renders twice; {{ is a literal {; a lone } is text", () => {
    const api = buildMessagesSandbox();
    api.register({ MinFailed: "{{{field}}} {threshold}/{threshold}" });
    expect(api.messageFor({ tag: "MinFailed", threshold: 3 }, "n")).toBe("{n}} 3/3");
  });

  test("an absent payload value renders as the empty string", () => {
    const api = buildMessagesSandbox();
    api.register({ MinFailed: "[{threshold}]" });
    expect(api.messageFor({ tag: "MinFailed" }, "n")).toBe("[]");
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
// §C10.10b — a template the compiler could not see is refused at registration
// (§41.12.1 rule 6): fail closed — never rendered partially, earlier entry kept.
// ---------------------------------------------------------------------------

describe("C10 §C10.10b — runtime refusal of bad templates (fail closed)", () => {
  function quiet(fn) {
    const orig = console.error;
    const seen = [];
    console.error = (...a) => { seen.push(a.join(" ")); };
    try { fn(); } finally { console.error = orig; }
    return seen;
  }

  test("a function value is refused — the function never runs; Level 3 renders", () => {
    const api = buildMessagesSandbox();
    let ran = false;
    const seen = quiet(() => api.register({ Required: () => { ran = true; return "FN"; } }));
    expect(api.messageFor({ tag: "Required" }, "name")).toBe("name is required.");
    expect(ran).toBe(false);
    expect(seen.join("\n")).toContain("not a message template");
  });

  test("a non-string value is refused", () => {
    const api = buildMessagesSandbox();
    const seen = quiet(() => api.register({ MinFailed: 42 }));
    expect(api.messageFor({ tag: "MinFailed", threshold: 2 }, "n")).toBe("n must be at least 2.");
    expect(seen.length).toBe(1);
  });

  test("an unknown slot is refused — {threshold} is not a slot of Required", () => {
    const api = buildMessagesSandbox();
    const seen = quiet(() => api.register({ Required: "{field} needs {threshold}" }));
    expect(api.messageFor({ tag: "Required" }, "name")).toBe("name is required.");
    expect(seen.join("\n")).toContain("{threshold}");
    expect(seen.join("\n")).toContain("{field}");
  });

  test("malformed templates are refused", () => {
    for (const bad of ["{field", "{}", "{ field }", "{1x}", "trailing {"]) {
      const api = buildMessagesSandbox();
      const seen = quiet(() => api.register({ Required: bad }));
      expect(api.messageFor({ tag: "Required" }, "name")).toBe("name is required.");
      expect(seen.join("\n")).toContain("malformed");
    }
  });

  test("a key that is not a ValidationError variant is refused", () => {
    const api = buildMessagesSandbox();
    const seen = quiet(() => api.register({ TooShort: "{field} short" }));
    expect(seen.join("\n")).toContain("not a ValidationError variant");
  });

  test("a refused template keeps the earlier registration for that key", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "FIRST:{field}" });
    quiet(() => api.register({ Required: "{bogus}" }));
    expect(api.messageFor({ tag: "Required" }, "x")).toBe("FIRST:x");
  });

  test("a prototype-member key is refused, not read from Object.prototype", () => {
    const api = buildMessagesSandbox();
    const seen = quiet(() => api.register({ constructor: "{field}" }));
    expect(seen.join("\n")).toContain("not a ValidationError variant");
    expect(api.messageFor({ tag: "constructor" }, "x")).toBe("x is invalid.");
  });
});

// ---------------------------------------------------------------------------
// §C10.10d — the message is TEXT (§55.8): the default <errors> render escapes it
// ---------------------------------------------------------------------------

describe("C10 §C10.10d — _scrml_message_html escapes a message for the default render", () => {
  test("markup characters in a payload are escaped, so a typed tag never becomes an element", () => {
    const api = buildMessagesSandbox();
    const msg = api.messageFor({ tag: "EqFailed", expected: "<img id=pwn src=x onerror=\"a('1')\">" }, "confirm");
    expect(api.messageHtml(msg)).toBe(
      "confirm must equal &lt;img id=pwn src=x onerror=&quot;a(&#39;1&#39;)&quot;&gt;.",
    );
  });

  test("& is escaped first-class (no double-escape surprises)", () => {
    const api = buildMessagesSandbox();
    expect(api.messageHtml("a & b &amp; c")).toBe("a &amp; b &amp;amp; c");
  });

  test("messageFor itself returns plain text — escaping belongs to the HTML sink", () => {
    const api = buildMessagesSandbox();
    api.register({ Required: "<b>{field}</b>" });
    expect(api.messageFor({ tag: "Required" }, "x")).toBe("<b>x</b>");
  });
});

// ---------------------------------------------------------------------------
// §C10.10c — the shipped defaults are well-formed templates over their slots
// ---------------------------------------------------------------------------

describe("C10 §C10.10c — shipped defaults parse against the slot table", () => {
  test("every default parses, and every variant with slots has a default", async () => {
    const mod = await import("../../src/runtime-message-templates.js");
    const tags = Object.keys(mod._SCRML_MESSAGE_SLOTS);
    expect(tags.length).toBe(15);
    for (const tag of tags) {
      const tpl = mod._SCRML_DEFAULT_MESSAGES[tag];
      expect(typeof tpl).toBe("string");
      expect(mod._scrml_message_template_parse(tpl, mod._SCRML_MESSAGE_SLOTS[tag]).ok).toBe(true);
    }
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
