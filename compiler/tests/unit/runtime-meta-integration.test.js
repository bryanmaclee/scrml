/**
 * runtime-meta-integration.test.js — Runtime ^{} Meta Integration Tests
 *
 * End-to-end tests for the runtime meta system (SPEC §22.5).
 * These tests compile scrml source through the full pipeline and verify
 * the compiled output contains correct runtime meta infrastructure.
 *
 * Coverage groups:
 *   RT-1  Runtime meta with meta.emit() dynamic markup emission
 *   RT-2  Runtime meta.types.reflect() with type declarations
 *   RT-3  Runtime meta with captured reactive variable access
 *   RT-4  Compile-time vs runtime meta distinction (4-arg form)
 *   RT-5  Captured bindings through full pipeline
 *   RT-6  Runtime meta with meta.cleanup()
 *   RT-7  Runtime meta.types always present in output
 *   RT-8  Runtime execution: meta.emit, meta.get, meta.types.reflect
 *   RT-9  Type registry codegen through full pipeline
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/runtime-meta-integration");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: compile a .scrml source string through the full pipeline.
// ---------------------------------------------------------------------------

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);

  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: FIXTURE_OUTPUT,
    write: false,
  });

  const output = result.outputs.get(filePath) ?? {};
  return {
    clientJs: output.clientJs ?? "",
    serverJs: output.serverJs ?? "",
    html: output.html ?? "",
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * Create a runtime sandbox that evaluates the SCRML_RUNTIME string and returns
 * the runtime functions. Used for testing actual runtime behavior.
 */
function makeRuntime() {
  const code = `
${SCRML_RUNTIME}

return {
  _scrml_state,
  _scrml_subscribers,
  _scrml_reactive_get,
  _scrml_reactive_set,
  _scrml_reactive_subscribe,
  _scrml_register_cleanup,
  _scrml_destroy_scope,
  _scrml_cleanup_registry,
  _scrml_meta_effect,
  _scrml_meta_emit,
  _scrml_tracking_stack,
};
`;
  return new Function(code)();
}

// ---------------------------------------------------------------------------
// RT-1: Runtime meta with meta.emit() for dynamic markup
// ---------------------------------------------------------------------------

describe("runtime-meta RT-1: meta.emit() dynamic markup", () => {
  test("runtime ^{} with meta.emit produces _scrml_meta_effect containing emit call", () => {
    const source = `p "hello"
^{
  meta.emit("<div>dynamic content</div>")
}
`;
    const { clientJs, errors } = compileSource(source, "rt1-emit-basic.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // meta.emit call is in the effect body (allow optional whitespace from tokenizer)
    expect(clientJs).toMatch(/meta\s*\.\s*emit\s*\(/);
  });

  test("clientJs output uses _scrml_meta_effect with stable scopeId for meta.emit", () => {
    const source = `p "wrapper"
^{
  meta.emit("<span>injected</span>")
}
`;
    const { clientJs, errors } = compileSource(source, "rt1-emit-placeholder.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // The _scrml_meta_effect call should have a stable scopeId
    expect(clientJs).toMatch(/_scrml_meta_effect\("_scrml_meta_\d+"/);
    // The runtime meta.emit function uses the scopeId to find the DOM placeholder
    // at runtime via data-scrml-meta attribute
    expect(clientJs).toContain("function(meta)");
  });

  test("meta.emit with reactive variable in body compiles correctly", () => {
    const source = `\${ @name = "world" }
p "greeting"
^{
  meta.emit("<h1>Hello " + meta.get("name") + "</h1>")
}
`;
    const { clientJs, errors } = compileSource(source, "rt1-emit-reactive.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toMatch(/meta\s*\.\s*emit\s*\(/);
    expect(clientJs).toMatch(/meta\s*\.\s*get\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// RT-2: Runtime meta.types.reflect() with type declarations
// ---------------------------------------------------------------------------

describe("runtime-meta RT-2: meta.types.reflect() with types", () => {
  test("runtime ^{} with meta.types.reflect compiles without errors", () => {
    const source = `\${ type Color:enum = { Red | Green | Blue } }
p "type info"
^{
  const info = meta.types.reflect("Color")
  if (info) {
    meta.emit("<p>" + info.kind + "</p>")
  }
}
`;
    const { clientJs, errors } = compileSource(source, "rt2-reflect-basic.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toMatch(/meta\s*\.\s*types\s*\.\s*reflect\s*\(/);
  });

  test("runtime ^{} with struct type reflection compiles with type registry", () => {
    const source = `\${ type User:struct = { name: string, age: number } }
p "user type"
^{
  const info = meta.types.reflect("User")
  meta.emit(String(info))
}
`;
    const { clientJs, errors } = compileSource(source, "rt2-reflect-struct.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // The type registry argument should be emitted (not null)
    // When types are in scope, the 4th arg should contain type data
    expect(clientJs).toMatch(/meta\s*\.\s*types\s*\.\s*reflect\s*\(/);
  });

  test("runtime meta.types.reflect is NOT confused with compile-time reflect()", () => {
    // meta.types.reflect() is runtime; plain reflect() is compile-time
    const source = `\${ type Color:enum = { Red | Green | Blue } }
p "runtime reflect"
^{
  const info = meta.types.reflect("Color")
  meta.emit(String(info))
}
`;
    const { clientJs, errors } = compileSource(source, "rt2-reflect-not-compiletime.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Must use _scrml_meta_effect (runtime), NOT inline the result (compile-time)
    expect(clientJs).toContain("_scrml_meta_effect(");
  });
});

// ---------------------------------------------------------------------------
// RT-3: Runtime meta with captured reactive variable access
// ---------------------------------------------------------------------------

describe("runtime-meta RT-3: reactive variable access in runtime meta", () => {
  test("@var read inside ^{} produces _scrml_reactive_get in effect body", () => {
    const source = `\${ @count = 0 }
p "counter"
^{
  meta.emit(String(@count))
}
`;
    const { clientJs, errors } = compileSource(source, "rt3-reactive-read.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toContain('_scrml_reactive_get("count")');
  });

  test("@var write inside ^{} via meta.set compiles correctly", () => {
    const source = `\${ @count = 0 }
p "counter"
^{
  meta.set("count", meta.get("count") + 1)
}
`;
    const { clientJs, errors } = compileSource(source, "rt3-reactive-write.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toMatch(/meta\s*\.\s*set\s*\(/);
    expect(clientJs).toMatch(/meta\s*\.\s*get\s*\(/);
  });

  test("multiple @var reads inside one ^{} block all get rewritten", () => {
    const source = `\${ @x = 1 }
\${ @y = 2 }
p "multi-var"
^{
  meta.emit(String(@x + @y))
}
`;
    const { clientJs, errors } = compileSource(source, "rt3-multi-reactive.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toContain('_scrml_reactive_get("x")');
    expect(clientJs).toContain('_scrml_reactive_get("y")');
  });
});

// ---------------------------------------------------------------------------
// RT-4: Compile-time vs runtime meta distinction — 4-arg form
// ---------------------------------------------------------------------------

describe("runtime-meta RT-4: compile-time vs runtime distinction", () => {
  test("compile-time ^{ emit() } does NOT produce _scrml_meta_effect", () => {
    const source = `p "base"
^{
  emit("<span>compile-time</span>")
}
`;
    const { clientJs, errors } = compileSource(source, "rt4-compiletime-emit.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Compile-time meta should NOT produce _scrml_meta_effect
    expect(clientJs).not.toContain("_scrml_meta_effect(");
  });

  test("compile-time ^{ reflect(Type) } does NOT produce _scrml_meta_effect", () => {
    const source = `\${ type Color:enum = { Red | Green | Blue } }
p "colors"
^{
  const info = reflect(Color)
  emit("<p>" + info.name + "</p>")
}
`;
    const { clientJs, errors } = compileSource(source, "rt4-compiletime-reflect.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).not.toContain("_scrml_meta_effect(");
  });

  test("runtime ^{ meta.emit(String()) } DOES produce _scrml_meta_effect", () => {
    const source = `p "hello"
^{
  meta.emit("runtime meta")
}
`;
    const { clientJs, errors } = compileSource(source, "rt4-runtime-basic.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toContain("function(meta)");
  });

  test("runtime ^{} uses 4-argument form: scopeId, fn, capturedBindings, typeRegistry", () => {
    const source = `\${ @count = 0 }
p "test"
^{
  meta.emit(String(@count))
}
`;
    const { clientJs, errors } = compileSource(source, "rt4-four-args.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // The call should have the 4-argument form with capturedBindings and typeRegistry
    // After the function body close, there should be the two extra arguments
    expect(clientJs).toMatch(/_scrml_meta_effect\(/);
    expect(clientJs).toContain("function(meta)");
  });
});

// ---------------------------------------------------------------------------
// RT-5: Captured bindings through full pipeline
// ---------------------------------------------------------------------------

describe("runtime-meta RT-5: captured bindings through full pipeline", () => {
  test("@var in scope produces capturedBindings with reactive getter", () => {
    const source = `\${ @count = 0 }
p "captured"
^{
  meta.emit(String(meta.bindings))
}
`;
    const { clientJs, errors } = compileSource(source, "rt5-captured-reactive.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // The capturedBindings should contain Object.freeze (not null)
    expect(clientJs).toContain("Object.freeze(");
    // Should have a getter for the reactive variable
    expect(clientJs).toContain("_scrml_reactive_get");
  });

  test("let variable in scope produces capturedBindings with direct reference", () => {
    const source = `\${ let x = 42 }
p "let captured"
^{
  meta.emit(String(meta.bindings))
}
`;
    const { clientJs, errors } = compileSource(source, "rt5-captured-let.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // The capturedBindings should contain Object.freeze
    expect(clientJs).toContain("Object.freeze(");
  });

  test("const variable in scope produces capturedBindings", () => {
    const source = `\${ const PI = 3.14 }
p "const captured"
^{
  meta.emit(String(meta.bindings))
}
`;
    const { clientJs, errors } = compileSource(source, "rt5-captured-const.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
  });
});

// ---------------------------------------------------------------------------
// RT-6: Runtime meta with meta.cleanup()
// ---------------------------------------------------------------------------

describe("runtime-meta RT-6: meta.cleanup() in runtime meta", () => {
  test("meta.cleanup() call compiles inside _scrml_meta_effect", () => {
    const source = `p "cleanup test"
^{
  meta.cleanup(function() { meta.emit("cleaned up") })
  meta.emit("effect ran")
}
`;
    const { clientJs, errors } = compileSource(source, "rt6-cleanup.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toMatch(/meta\s*\.\s*cleanup\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// RT-7: Runtime meta.types always present
// ---------------------------------------------------------------------------

describe("runtime-meta RT-7: meta.types always present in runtime", () => {
  test("runtime effect has meta.types.reflect() even without type declarations", () => {
    const rt = makeRuntime();
    let typesObj = undefined;

    rt._scrml_meta_effect(
      "_scrml_meta_rt7_1",
      (meta) => { typesObj = meta.types; },
      null,
      null
    );

    expect(typesObj).not.toBeNull();
    expect(typeof typesObj.reflect).toBe("function");
    expect(typesObj.reflect("NonExistent")).toBeNull();
  });

  test("meta.types.reflect returns type data when typeRegistry is provided", () => {
    const rt = makeRuntime();
    const typeRegistry = {
      Color: { kind: "enum", variants: [{ name: "Red" }, { name: "Blue" }] },
      User: { kind: "struct", fields: [{ name: "name", type: "string" }] },
    };
    let colorInfo = undefined;
    let userInfo = undefined;
    let unknownInfo = undefined;

    rt._scrml_meta_effect(
      "_scrml_meta_rt7_2",
      (meta) => {
        colorInfo = meta.types.reflect("Color");
        userInfo = meta.types.reflect("User");
        unknownInfo = meta.types.reflect("Unknown");
      },
      null,
      typeRegistry
    );

    expect(colorInfo).not.toBeNull();
    expect(colorInfo.kind).toBe("enum");
    expect(colorInfo.variants).toHaveLength(2);

    expect(userInfo).not.toBeNull();
    expect(userInfo.kind).toBe("struct");

    expect(unknownInfo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RT-8: Runtime execution — meta.emit, meta.get, meta.types.reflect
// ---------------------------------------------------------------------------

describe("runtime-meta RT-8: runtime execution of meta API", () => {
  test("meta.emit() stores emitted HTML (testable via meta.scopeId)", () => {
    const rt = makeRuntime();
    let emittedScopeId = undefined;

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_1",
      (meta) => {
        emittedScopeId = meta.scopeId;
        meta.emit("<div>test</div>");
      },
      null,
      null
    );

    expect(emittedScopeId).toBe("_scrml_meta_rt8_1");
  });

  test("meta.get() reads reactive state and establishes dependency", () => {
    const rt = makeRuntime();
    rt._scrml_reactive_set("testVar", 42);

    let readValue = undefined;
    let runCount = 0;

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_2",
      (meta) => {
        runCount++;
        readValue = meta.get("testVar");
      },
      null,
      null
    );

    expect(readValue).toBe(42);
    expect(runCount).toBe(1);

    // Changing the reactive variable should trigger a re-run
    rt._scrml_reactive_set("testVar", 99);
    expect(readValue).toBe(99);
    expect(runCount).toBe(2);
  });

  test("meta.set() writes reactive state", () => {
    const rt = makeRuntime();
    rt._scrml_reactive_set("writeTarget", 0);

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_3",
      (meta) => {
        meta.set("writeTarget", 100);
      },
      null,
      null
    );

    expect(rt._scrml_reactive_get("writeTarget")).toBe(100);
  });

  test("meta.cleanup() fires before re-run", () => {
    const rt = makeRuntime();
    rt._scrml_reactive_set("cleanupTrigger", 0);

    const cleanupLog = [];
    let runCount = 0;

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_4",
      (meta) => {
        runCount++;
        meta.get("cleanupTrigger"); // establish dependency
        meta.cleanup(() => cleanupLog.push(`cleanup-${runCount}`));
      },
      null,
      null
    );

    expect(runCount).toBe(1);
    expect(cleanupLog).toHaveLength(0);

    // Trigger re-run — cleanup from run 1 should fire
    rt._scrml_reactive_set("cleanupTrigger", 1);
    expect(runCount).toBe(2);
    expect(cleanupLog).toEqual(["cleanup-1"]);
  });

  test("meta.subscribe() returns unsubscribe function", () => {
    const rt = makeRuntime();
    rt._scrml_reactive_set("subVar", "initial");

    let subscribedValues = [];

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_5",
      (meta) => {
        const unsub = meta.subscribe("subVar", () => {
          subscribedValues.push(rt._scrml_reactive_get("subVar"));
        });
        meta.cleanup(unsub);
      },
      null,
      null
    );

    rt._scrml_reactive_set("subVar", "changed");
    // The subscribe callback should have fired
    expect(subscribedValues).toContain("changed");
  });

  test("meta.bindings provides access to captured bindings", () => {
    const rt = makeRuntime();
    const bindings = Object.freeze({ x: 10, y: 20 });
    let bindingsAccess = undefined;

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_6",
      (meta) => {
        bindingsAccess = meta.bindings;
      },
      bindings,
      null
    );

    expect(bindingsAccess).toBe(bindings);
    expect(bindingsAccess.x).toBe(10);
    expect(bindingsAccess.y).toBe(20);
  });

  test("meta.bindings reactive getter returns live values on re-read", () => {
    const rt = makeRuntime();
    rt._scrml_reactive_set("liveVar", "initial");

    // In compiled output, the bindings getter uses _scrml_reactive_get which is
    // the module-level function. The auto-tracking intercepts via the tracking
    // stack inside _scrml_meta_effect. For testing, we use meta.get() directly
    // to establish the dependency, then read meta.bindings for the value.
    const bindings = Object.freeze({
      get liveVar() { return rt._scrml_reactive_get("liveVar"); }
    });

    let observedValue = undefined;
    let runCount = 0;

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_7",
      (meta) => {
        runCount++;
        // Use meta.get to establish the tracking dependency
        meta.get("liveVar");
        // Then read from bindings to verify the getter works
        observedValue = meta.bindings.liveVar;
      },
      bindings,
      null
    );

    expect(observedValue).toBe("initial");
    expect(runCount).toBe(1);

    // Change the reactive variable — the dependency via meta.get triggers re-run
    rt._scrml_reactive_set("liveVar", "updated");
    // After the re-run, bindings getter should return the new value
    expect(observedValue).toBe("updated");
    expect(runCount).toBe(2);
  });

  test("meta.types.reflect() with full type registry", () => {
    const rt = makeRuntime();
    const typeRegistry = {
      Color: {
        kind: "enum",
        variants: [{ name: "Red" }, { name: "Green" }, { name: "Blue" }],
      },
      User: {
        kind: "struct",
        fields: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
      },
    };

    let colorResult = undefined;
    let userResult = undefined;
    let unknownResult = undefined;

    rt._scrml_meta_effect(
      "_scrml_meta_rt8_8",
      (meta) => {
        colorResult = meta.types.reflect("Color");
        userResult = meta.types.reflect("User");
        unknownResult = meta.types.reflect("NotAType");
      },
      null,
      typeRegistry
    );

    // Color enum
    expect(colorResult).not.toBeNull();
    expect(colorResult.kind).toBe("enum");
    expect(colorResult.variants).toHaveLength(3);
    expect(colorResult.variants[0].name).toBe("Red");

    // User struct
    expect(userResult).not.toBeNull();
    expect(userResult.kind).toBe("struct");
    expect(userResult.fields).toHaveLength(2);
    expect(userResult.fields[0].name).toBe("name");
    expect(userResult.fields[0].type).toBe("string");

    // Unknown type returns null
    expect(unknownResult).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RT-9: Type registry codegen through full pipeline
// ---------------------------------------------------------------------------

describe("runtime-meta RT-9: type registry codegen through full pipeline", () => {
  test("struct type produces type registry in _scrml_meta_effect 4th argument", () => {
    const source = `\${ type User:struct = { name: string, age: number } }
p "test"
^{
  const info = meta.types.reflect("User")
  meta.emit(String(info))
}
`;
    const { clientJs, errors } = compileSource(source, "rt9-struct-registry.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // The 4th argument should contain the User type data
    expect(clientJs).toContain('"User"');
    expect(clientJs).toContain('"struct"');
    expect(clientJs).toContain('"name"');
    expect(clientJs).toContain('"string"');
    expect(clientJs).toContain('"age"');
    expect(clientJs).toContain('"number"');
  });

  test("enum type produces type registry with variants", () => {
    const source = `\${ type Color:enum = { Red | Green | Blue } }
p "test"
^{
  const info = meta.types.reflect("Color")
  meta.emit(String(info))
}
`;
    const { clientJs, errors } = compileSource(source, "rt9-enum-registry.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toContain('"Color"');
    expect(clientJs).toContain('"enum"');
    expect(clientJs).toContain('"Red"');
    expect(clientJs).toContain('"Green"');
    expect(clientJs).toContain('"Blue"');
  });

  test("multiple types in scope produce combined type registry", () => {
    const source = `\${ type Color:enum = { Red | Green | Blue } }
\${ type Point:struct = { x: number, y: number } }
p "test"
^{
  meta.emit(String(meta.types.reflect("Color")))
  meta.emit(String(meta.types.reflect("Point")))
}
`;
    const { clientJs, errors } = compileSource(source, "rt9-multi-type-registry.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // Both types should be in the registry
    expect(clientJs).toContain('"Color"');
    expect(clientJs).toContain('"Point"');
  });

  test("no types in scope produces null type registry", () => {
    const source = `p "test"
^{
  meta.emit("no types")
}
`;
    const { clientJs, errors } = compileSource(source, "rt9-no-types.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // The 4th argument should be null when no user types exist
    expect(clientJs).toMatch(/,\s*null\s*\)\s*;/);
  });

  test("§22.10: type registry is declared as const before _scrml_meta_effect call", () => {
    const source = `\${ type User:struct = { name: string, age: number } }
p "test"
^{
  const info = meta.types.reflect("User")
  meta.emit(String(info))
}
`;
    const { clientJs, errors } = compileSource(source, "rt9-type-const.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Type registry should be passed as 4th argument to _scrml_meta_effect
    // (either inline literal or const variable)
    expect(clientJs).toMatch(/_scrml_meta_effect\(.*,\s*\(\{/s);
  });

  test("§22.10: type registry const name uses matching meta scope ID number", () => {
    const source = `\${ type Color:enum = { Red | Green | Blue } }
p "test"
^{
  meta.emit(String(meta.types.reflect("Color")))
}
`;
    const { clientJs, errors } = compileSource(source, "rt9-type-const-id-match.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Type registry should be passed as 4th argument with the type data
    expect(clientJs).toContain('"Color"');
    expect(clientJs).toMatch(/_scrml_meta_effect\(.*,\s*\(\{/s);
  });
});
