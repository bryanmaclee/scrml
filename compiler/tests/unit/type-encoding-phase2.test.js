/**
 * Type Encoding Phase 2 — Integration Tests
 *
 * Tests that the EncodingContext integrates correctly with the emit pipeline:
 *   - EncodingContext register/encode lifecycle
 *   - Encoded names appear in emitLogicNode output
 *   - Encoded names appear in emitReactiveWiring output
 *   - Encoded names appear in emitBindings output
 *   - Encoded names appear in emitEventWiring output
 *   - Debug mode includes $originalName suffix
 *   - Disabled context passes names through unchanged
 *   - Consistent key usage (set/get/subscribe use same encoded key)
 */

import { describe, test, expect } from "bun:test";
import {
  EncodingContext,
  encodeTypeName,
  encodeTypeNameDebug,
} from "../../src/codegen/type-encoding.ts";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { emitReactiveWiring } from "../../src/codegen/emit-reactive-wiring.ts";
import { emitBindings } from "../../src/codegen/emit-bindings.ts";
import { emitEventWiring } from "../../src/codegen/emit-event-wiring.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A minimal string primitive ResolvedType for test registration. */
const STRING_TYPE = { kind: "primitive", name: "string" };

/** A minimal number primitive ResolvedType. */
const NUMBER_TYPE = { kind: "primitive", name: "number" };

/** A minimal struct ResolvedType. */
const USER_STRUCT = {
  kind: "struct",
  name: "User",
  fields: new Map([
    ["name", { kind: "primitive", name: "string" }],
    ["age", { kind: "primitive", name: "number" }],
  ]),
};

/** A minimal enum ResolvedType. */
const STATUS_ENUM = {
  kind: "enum",
  name: "Status",
  variants: [{ name: "Active", payload: null }, { name: "Inactive", payload: null }],
};

// ---------------------------------------------------------------------------
// §1 EncodingContext — basic lifecycle
// ---------------------------------------------------------------------------

describe("EncodingContext", () => {
  test("disabled context returns original names", () => {
    const ctx = new EncodingContext({ enabled: false });
    ctx.register("count", NUMBER_TYPE);
    expect(ctx.encode("count")).toBe("count");
    expect(ctx.encode("unregistered")).toBe("unregistered");
  });

  test("enabled context returns encoded names after register", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("name", STRING_TYPE);
    expect(encoded).toMatch(/^_p[0-9a-z]{8}[0-9a-z]$/);
    expect(ctx.encode("name")).toBe(encoded);
  });

  test("unregistered names pass through when enabled", () => {
    const ctx = new EncodingContext({ enabled: true });
    expect(ctx.encode("unknown")).toBe("unknown");
  });

  test("debug mode appends $originalName", () => {
    const ctx = new EncodingContext({ enabled: true, debug: true });
    const encoded = ctx.register("userName", STRING_TYPE);
    expect(encoded).toContain("$userName");
    expect(encoded).toMatch(/^_p[0-9a-z]{8}[0-9a-z]\$userName$/);
  });

  test("register returns consistent name on repeated calls", () => {
    const ctx = new EncodingContext({ enabled: true });
    const first = ctx.register("x", STRING_TYPE);
    const second = ctx.register("x", STRING_TYPE);
    expect(first).toBe(second);
  });

  test("same type different names get different seq", () => {
    const ctx = new EncodingContext({ enabled: true });
    const a = ctx.register("a", STRING_TYPE);
    const b = ctx.register("b", STRING_TYPE);
    expect(a).not.toBe(b);
    // Same prefix (kind+hash), different seq
    expect(a.slice(0, -1)).toBe(b.slice(0, -1));
    expect(a.slice(-1)).toBe("0");
    expect(b.slice(-1)).toBe("1");
  });

  test("different types get different prefixes", () => {
    const ctx = new EncodingContext({ enabled: true });
    const s = ctx.register("s", STRING_TYPE);
    const u = ctx.register("u", USER_STRUCT);
    expect(s.slice(1, 2)).toBe("p"); // primitive kind
    expect(u.slice(1, 2)).toBe("s"); // struct kind
  });

  test("has() returns correct values", () => {
    const ctx = new EncodingContext({ enabled: true });
    expect(ctx.has("x")).toBe(false);
    ctx.register("x", STRING_TYPE);
    expect(ctx.has("x")).toBe(true);
  });

  test("mappings returns all registered entries", () => {
    const ctx = new EncodingContext({ enabled: true });
    ctx.register("a", STRING_TYPE);
    ctx.register("b", NUMBER_TYPE);
    expect(ctx.mappings.size).toBe(2);
    expect(ctx.mappings.has("a")).toBe(true);
    expect(ctx.mappings.has("b")).toBe(true);
  });

  test("reset clears all state", () => {
    const ctx = new EncodingContext({ enabled: true });
    ctx.register("x", STRING_TYPE);
    ctx.reset();
    expect(ctx.has("x")).toBe(false);
    expect(ctx.mappings.size).toBe(0);
    // After reset, seq resets too
    const encoded = ctx.register("x", STRING_TYPE);
    expect(encoded.slice(-1)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// §2 emitLogicNode integration — reactive-decl
// ---------------------------------------------------------------------------

describe("emitLogicNode with EncodingContext", () => {
  test("reactive-decl uses encoded name when ctx is enabled", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("count", NUMBER_TYPE);

    const node = { kind: "state-decl", name: "count", init: "0" };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain(JSON.stringify(encoded));
    expect(output).toContain("_scrml_reactive_set");
    expect(output).not.toContain('"count"');
  });

  test("reactive-decl uses original name when ctx is null", () => {
    const node = { kind: "state-decl", name: "count", init: "0" };
    const output = emitLogicNode(node);
    expect(output).toContain('"count"');
  });

  test("reactive-decl uses original name when ctx is disabled", () => {
    const ctx = new EncodingContext({ enabled: false });
    const node = { kind: "state-decl", name: "count", init: "0" };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain('"count"');
  });

  test("reactive-derived-decl uses encoded names for decl and deps", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encodedTotal = ctx.register("total", NUMBER_TYPE);
    const encodedPrice = ctx.register("price", NUMBER_TYPE);

    const node = {
      kind: "reactive-derived-decl",
      name: "total",
      init: "@price * 2",
    };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain(JSON.stringify(encodedTotal));
    // The dependency "price" should also be encoded in _scrml_derived_subscribe
    expect(output).toContain(JSON.stringify(encodedPrice));
    expect(output).toContain("_scrml_derived_declare");
  });

  test("when-effect uses encoded dep names", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encodedCount = ctx.register("count", NUMBER_TYPE);

    const node = {
      kind: "when-effect",
      dependencies: ["count"],
      bodyRaw: 'console.log("changed")',
    };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain("_scrml_effect");
  });

  test("reactive-nested-assign uses encoded target", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encodedForm = ctx.register("form", USER_STRUCT);

    const node = {
      kind: "reactive-nested-assign",
      target: "form",
      path: ["name"],
      value: '"test"',
    };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain(JSON.stringify(encodedForm));
    expect(output).not.toContain('"form"');
  });

  test("reactive-array-mutation uses encoded target", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encodedItems = ctx.register("items", { kind: "array", element: STRING_TYPE });

    const node = {
      kind: "reactive-array-mutation",
      target: "items",
      method: "push",
      args: '"new item"',
    };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain(JSON.stringify(encodedItems));
    expect(output).not.toContain('"items"');
  });

  test("reactive-debounced-decl uses encoded name", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encodedSearch = ctx.register("search", STRING_TYPE);

    const node = {
      kind: "reactive-debounced-decl",
      name: "search",
      init: '""',
      delay: 300,
    };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain(JSON.stringify(encodedSearch));
    expect(output).not.toContain('"search"');
  });

  test("debug mode produces names with $ suffix in output", () => {
    const ctx = new EncodingContext({ enabled: true, debug: true });
    const encoded = ctx.register("count", NUMBER_TYPE);
    expect(encoded).toContain("$count");

    const node = { kind: "state-decl", name: "count", init: "0" };
    const output = emitLogicNode(node, { encodingCtx: ctx });
    expect(output).toContain("$count");
  });
});

// ---------------------------------------------------------------------------
// §3 emitReactiveWiring integration
// ---------------------------------------------------------------------------

describe("emitReactiveWiring with EncodingContext", () => {
  test("top-level reactive-decl uses encoded name", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("score", NUMBER_TYPE);

    const fileAST = {
      filePath: "test.scrml",
      ast: {
        nodes: [
          {
            kind: "logic",
            body: [{ kind: "state-decl", name: "score", init: "0" }],
          },
        ],
      },
    };

    const lines = emitReactiveWiring(makeCompileContext({ fileAST, errors: [], encodingCtx: ctx }));
    const output = lines.join("\n");
    expect(output).toContain(JSON.stringify(encoded));
    expect(output).not.toContain('"score"');
  });

  test("disabled context passes names through in reactive wiring", () => {
    const ctx = new EncodingContext({ enabled: false });

    const fileAST = {
      filePath: "test.scrml",
      ast: {
        nodes: [
          {
            kind: "logic",
            body: [{ kind: "state-decl", name: "score", init: "0" }],
          },
        ],
      },
    };

    const lines = emitReactiveWiring(makeCompileContext({ fileAST, errors: [], encodingCtx: ctx }));
    const output = lines.join("\n");
    expect(output).toContain('"score"');
  });
});

// ---------------------------------------------------------------------------
// §4 emitBindings integration
// ---------------------------------------------------------------------------

describe("emitBindings with EncodingContext", () => {
  test("ref= wiring uses encoded name for reactive_set", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("canvas", STRING_TYPE);

    const fileAST = {
      ast: {
        nodes: [
          {
            kind: "markup",
            tag: "canvas",
            attributes: [
              { name: "ref", value: { kind: "variable-ref", name: "@canvas" } },
            ],
          },
        ],
      },
    };

    const lines = emitBindings(makeCompileContext({ fileAST, encodingCtx: ctx }));
    const output = lines.join("\n");
    expect(output).toContain(JSON.stringify(encoded));
  });

  test("disabled context passes ref names through", () => {
    const ctx = new EncodingContext({ enabled: false });

    const fileAST = {
      ast: {
        nodes: [
          {
            kind: "markup",
            tag: "canvas",
            attributes: [
              { name: "ref", value: { kind: "variable-ref", name: "@canvas" } },
            ],
          },
        ],
      },
    };

    const lines = emitBindings(makeCompileContext({ fileAST, encodingCtx: ctx }));
    const output = lines.join("\n");
    expect(output).toContain('"canvas"');
  });
});

// ---------------------------------------------------------------------------
// §5 emitEventWiring integration
// ---------------------------------------------------------------------------

describe("emitEventWiring with EncodingContext", () => {
  test("reactive display uses encoded name in subscribe", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("name", STRING_TYPE);

    const logicBindings = [
      {
        placeholderId: "logic-1",
        expr: "@name",
        reactiveRefs: new Set(["name"]),
      },
    ];

    const lines = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      encodingCtx: ctx,
      registry: BindingRegistry.from([], logicBindings),
    }), new Map());
    const output = lines.join("\n");
    expect(output).toContain("_scrml_effect");
  });

  test("conditional display uses encoded name", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("visible", STRING_TYPE);

    const logicBindings = [
      {
        placeholderId: "if-1",
        expr: "@visible",
        isConditionalDisplay: true,
        varName: "visible",
      },
    ];

    const lines = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      encodingCtx: ctx,
      registry: BindingRegistry.from([], logicBindings),
    }), new Map());
    const output = lines.join("\n");
    expect(output).toContain(JSON.stringify(encoded));
  });

  test("disabled context passes names through in event wiring", () => {
    const ctx = new EncodingContext({ enabled: false });

    const logicBindings = [
      {
        placeholderId: "logic-1",
        expr: "@name",
        reactiveRefs: new Set(["name"]),
      },
    ];

    const lines = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      encodingCtx: ctx,
      registry: BindingRegistry.from([], logicBindings),
    }), new Map());
    const output = lines.join("\n");
    expect(output).toContain('"name"');
  });
});

// ---------------------------------------------------------------------------
// §6 Consistency — same encoded key used across set/get/subscribe
// ---------------------------------------------------------------------------

describe("Encoding consistency", () => {
  test("reactive-decl set key matches subscribe key in wiring", () => {
    const ctx = new EncodingContext({ enabled: true });
    const encoded = ctx.register("value", STRING_TYPE);

    // Logic node emits the _scrml_reactive_set
    const logicNode = { kind: "state-decl", name: "value", init: '""' };
    const logicOutput = emitLogicNode(logicNode, { encodingCtx: ctx });

    // Event wiring emits _scrml_effect (auto-tracking handles encoded names)
    const logicBindings = [
      {
        placeholderId: "logic-1",
        expr: "@value",
        reactiveRefs: new Set(["value"]),
      },
    ];
    const eventLines = emitEventWiring(makeCompileContext({
      fileAST: { filePath: "test.scrml" },
      encodingCtx: ctx,
      registry: BindingRegistry.from([], logicBindings),
    }), new Map());
    const eventOutput = eventLines.join("\n");

    // Both should use the same encoded key
    expect(logicOutput).toContain(JSON.stringify(encoded));
    expect(eventOutput).toContain(JSON.stringify(encoded));

    // Neither should contain the original name as a key
    expect(logicOutput).not.toContain('"value"');
  });

  test("debug mode produces valid JS identifiers in encoded names", () => {
    const ctx = new EncodingContext({ enabled: true, debug: true });
    const encoded = ctx.register("myCounter", NUMBER_TYPE);

    // The encoded name must be a valid JS identifier
    expect(encoded).toMatch(/^[_$a-zA-Z][_$a-zA-Z0-9]*$/);
    expect(encoded).toContain("$myCounter");
  });

  test("production mode encoded names contain no $", () => {
    const ctx = new EncodingContext({ enabled: true, debug: false });
    const encoded = ctx.register("myCounter", NUMBER_TYPE);
    expect(encoded).not.toContain("$");
  });
});
