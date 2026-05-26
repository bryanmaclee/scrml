/**
 * meta-integration.test.js — Runtime ^{} Integration Tests
 *
 * Tests that compile actual .scrml source files containing ^{} meta blocks
 * and verify the compiled JS output uses `_scrml_meta_effect` (not IIFEs).
 *
 * These tests exercise the full compiler pipeline (BS→TAB→CE→BPP→PA→RI→TS→MC→ME→DG→CG)
 * to confirm that:
 *   - Runtime ^{} blocks produce `_scrml_meta_effect(scopeId, function(meta) { ... })`
 *   - Compile-time ^{} blocks (emit() / reflect()) do NOT produce `_scrml_meta_effect`
 *   - @var reads inside runtime ^{} blocks are rewritten to `_scrml_reactive_get`
 *   - Multiple ^{} blocks get independent scopeIds
 *
 * Coverage:
 *   §1  Runtime ^{} compiles to _scrml_meta_effect
 *   §2  Runtime ^{} with @var reads compiles to effect with _scrml_reactive_get
 *   §3  Compile-time ^{} with emit() does NOT use _scrml_meta_effect
 *   §4  Compile-time ^{} with reflect() does NOT use _scrml_meta_effect
 *   §5  Runtime ^{} meta.get/set appears in output
 *   §6  Multiple ^{} blocks get independent scopeIds
 *   §7  ^{} alongside a component definition still compiles to _scrml_meta_effect
 *
 * Note on codegen output format: the scrml tokenizer inserts spaces around
 * punctuation and operators (e.g., `meta.get(` may appear as `meta . get (`
 * in the output). Assertions that check for meta method calls use regex patterns
 * that tolerate optional whitespace around the `.` and `(`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-integration");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: compile a .scrml source string through the full pipeline.
// Returns { clientJs, serverJs, html, errors, warnings } for the compiled file.
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

// ---------------------------------------------------------------------------
// §1: Runtime ^{} compiles to _scrml_meta_effect
// ---------------------------------------------------------------------------

describe("meta-integration §1: runtime ^{} → _scrml_meta_effect", () => {
  test("^{ meta.emit('hello') } produces _scrml_meta_effect in clientJs", () => {
    const source = `h1 "hello"
^{
  meta.emit("hello")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-runtime-basic.scrml");

    // Should compile without fatal errors
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Must contain _scrml_meta_effect
    expect(clientJs).toContain("_scrml_meta_effect(");

    // Must NOT contain IIFE pattern (Phase 1 output)
    expect(clientJs).not.toMatch(/\(\(\)\s*=>\s*\{/);
  });

  test("_scrml_meta_effect uses a stable scopeId pattern", () => {
    const source = `p "test"
^{
  meta.emit("world")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-scopeid.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // ScopeId should follow the pattern "_scrml_meta_<integer>"
    expect(clientJs).toMatch(/_scrml_meta_effect\("_scrml_meta_\d+"/);
  });

  test("_scrml_meta_effect wraps a function(meta) callback", () => {
    const source = `p "test"
^{
  meta.emit("meta callback")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-callback-shape.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Callback must be function(meta)
    expect(clientJs).toContain("function(meta)");
  });
});

// ---------------------------------------------------------------------------
// §2: Runtime ^{} with @var reads compiles to effect with _scrml_reactive_get
// ---------------------------------------------------------------------------

describe("meta-integration §2: runtime ^{} @var reads", () => {
  test("^{ const x = @count } rewrites @count to _scrml_reactive_get", () => {
    // V-kill (S123): wrapped the prior bare-fixture in `<program>` and moved
    // the `<count> = 0` decl into an explicit `${...}` to avoid BS's default-
    // logic auto-lift swallowing the trailing `p "..."` markup statement.
    // Pre-V-kill the test's first line was `@count = 0` — a TEXT node that
    // never declared a cell; the reactive ref inside ^{} silently resolved
    // to null. The new fixture exercises the SAME meta-block codegen path
    // (still rewrites @count to _scrml_reactive_get) but uses a legal
    // structural decl. See auto-state-cell-synthesis DD §6 / S123.
    const source = `<program>
\${ <count> = 0 }
<p>count: \${@count}</>
^{
  const x = @count
  meta.emit(String(x))
}
</>
`;
    const { clientJs, errors } = compileSource(source, "meta-reactive-read.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Must contain _scrml_meta_effect
    expect(clientJs).toContain("_scrml_meta_effect(");

    // The @count reference inside the meta block must be rewritten.
    // The reactive get for "count" must appear somewhere in the output.
    expect(clientJs).toContain('"count"');
    expect(clientJs).toContain("_scrml_reactive_get");
  });

  test("@var read inside ^{} body — _scrml_reactive_get for variable appears in output", () => {
    // V-kill (S123): same wrapping rationale as §2.1 above — pre-V-kill the
    // `@value = "hello"` line was a TEXT node, never a real decl. Replaced
    // with explicit `<program>` + `${ <value> = "hello" }` so the structural
    // decl is unambiguous and the markup boundary stays clean.
    const source = `<program>
\${ <value> = "hello" }
<p>\${@value}</>
^{
  meta.emit(String(@value))
}
</>
`;
    const { clientJs, errors } = compileSource(source, "meta-reactive-in-body.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // The reactive get must appear inside the effect wrapper
    expect(clientJs).toContain("_scrml_meta_effect(");
    expect(clientJs).toContain("_scrml_reactive_get");
    expect(clientJs).toContain('"value"');
  });
});

// ---------------------------------------------------------------------------
// §3: Compile-time ^{} with emit() does NOT use _scrml_meta_effect
// ---------------------------------------------------------------------------

describe("meta-integration §3: compile-time ^{} with emit() — no _scrml_meta_effect", () => {
  test("^{ emit('<div>hi</>') } does NOT produce _scrml_meta_effect", () => {
    const source = `p "wrapper"
^{
  emit("<div>hi</>")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-emit-compiletime.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Must NOT wrap in _scrml_meta_effect — this was compile-time evaluated
    expect(clientJs).not.toContain("_scrml_meta_effect(");
  });

  test("emit() output is inlined — div appears in HTML output", () => {
    const source = `p "wrapper"
^{
  emit("<div>hi</>")
}
`;
    const { html, errors } = compileSource(source, "meta-emit-inlined.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // The emitted div should appear in the compiled HTML
    expect(html).toContain("<div>");
  });
});

// ---------------------------------------------------------------------------
// §4: Compile-time ^{} with reflect() does NOT use _scrml_meta_effect
// ---------------------------------------------------------------------------

describe("meta-integration §4: compile-time ^{} with reflect() — no _scrml_meta_effect", () => {
  test("^{ reflect() } with a struct does NOT produce _scrml_meta_effect", () => {
    // Declare a struct type and use reflect() on it — compile-time classification
    // Note: \${ } is the scrml logic context sigil (escaped in JS template literal)
    const source = `\${ type Point:struct = { x: number, y: number } }
p "point info"
^{
  const info = reflect(Point)
  emit("<p>" + info.name + "</>")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-reflect-compiletime.scrml");

    // reflect() on a known type is compile-time — no _scrml_meta_effect
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Must NOT wrap in _scrml_meta_effect
    expect(clientJs).not.toContain("_scrml_meta_effect(");
  });

  test("reflect() with emit() produces inlined output in HTML", () => {
    const source = `\${ type Color:enum = { Red, Green, Blue } }
p "colors"
^{
  const info = reflect(Color)
  emit("<p>" + info.name + "</>")
}
`;
    const { html, errors } = compileSource(source, "meta-reflect-emit-inlined.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // The emitted content (info.name = "Color") should appear in HTML
    expect(html).toContain("Color");
  });
});

// ---------------------------------------------------------------------------
// §5: Runtime ^{} meta.get/set in output
//
// Note: the codegen tokenizer may emit `meta . get (` with spaces around
// punctuation. Assertions use regex patterns that tolerate optional whitespace.
// ---------------------------------------------------------------------------

describe("meta-integration §5: meta.get/meta.set in compiled output", () => {
  test("^{ meta.set('x', meta.get('y') + 1) } appears in the effect body", () => {
    const source = `@y = 10
p "meta set test"
^{
  meta.set("x", meta.get("y") + 1)
}
`;
    const { clientJs, errors } = compileSource(source, "meta-get-set.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Must be wrapped in _scrml_meta_effect
    expect(clientJs).toContain("_scrml_meta_effect(");

    // meta.get and meta.set must appear (with optional whitespace around . and ())
    expect(clientJs).toMatch(/meta\s*\.\s*get\s*\(/);
    expect(clientJs).toMatch(/meta\s*\.\s*set\s*\(/);
  });

  test("meta.cleanup() call is preserved in the output", () => {
    const source = `p "meta cleanup test"
^{
  meta.cleanup(function() { meta.emit("cleanup") })
}
`;
    const { clientJs, errors } = compileSource(source, "meta-cleanup.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    expect(clientJs).toContain("_scrml_meta_effect(");
    // meta.cleanup must appear (with optional whitespace)
    expect(clientJs).toMatch(/meta\s*\.\s*cleanup\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// §6: Multiple ^{} blocks get independent scopeIds
// ---------------------------------------------------------------------------

describe("meta-integration §6: multiple ^{} blocks — independent scopeIds", () => {
  test("two runtime ^{} blocks produce two _scrml_meta_effect calls", () => {
    const source = `p "first"
^{
  meta.emit("block one")
}
p "second"
^{
  meta.emit("block two")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-two-blocks.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Count occurrences of _scrml_meta_effect(
    const matches = (clientJs.match(/_scrml_meta_effect\(/g) || []).length;
    expect(matches).toBe(2);
  });

  test("two ^{} blocks have different scopeIds", () => {
    const source = `p "first"
^{
  meta.emit("alpha")
}
p "second"
^{
  meta.emit("beta")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-two-scopeids.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Extract all scopeIds from the output
    const scopeIdMatches = clientJs.match(/_scrml_meta_effect\("(_scrml_meta_\d+)"/g) || [];
    expect(scopeIdMatches.length).toBe(2);

    // ScopeIds must be distinct
    const ids = new Set(scopeIdMatches);
    expect(ids.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §7: ^{} alongside a component definition
//
// A file that defines a component AND has a top-level runtime ^{} block.
// The meta block must still compile to _scrml_meta_effect even when the
// file also defines components.
// ---------------------------------------------------------------------------

describe("meta-integration §7: ^{} alongside component definition", () => {
  test("runtime ^{} co-existing with a component definition compiles to _scrml_meta_effect", () => {
    // Note: \${ } is the scrml logic context sigil (escaped in JS template literal)
    // Component definition uses self-closing syntax (tested form)
    const source = `\${ const Card = <div class="card"/> }
<Card/>
^{
  meta.emit("meta alongside component")
}
`;
    const { clientJs, errors } = compileSource(source, "meta-with-component.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // The meta block must still compile to _scrml_meta_effect
    expect(clientJs).toContain("_scrml_meta_effect(");
  });

  test("component definition does not suppress meta block scope tracking", () => {
    // V-kill (S123): replaced pre-V-kill `@count = 0` (a TEXT node, not a
    // decl) with `<count> = 0` structural decl. See §2 fixtures above for
    // the same pattern.
    const source = `\${ const Badge = <span class="badge"/> }
<count> = 0
<Badge/>
^{
  meta.emit(String(@count))
}
`;
    const { clientJs, errors } = compileSource(source, "meta-component-reactive.scrml");

    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);

    // Meta block with @var read must compile to _scrml_meta_effect
    expect(clientJs).toContain("_scrml_meta_effect(");
    // The @count read must be rewritten
    expect(clientJs).toContain("_scrml_reactive_get");
  });
});

// ---------------------------------------------------------------------------
// §8: JS-style for (const x of array) inside compile-time ^{} — E-META-001 fix
//
// `for (const x of array)` inside compile-time ^{} must NOT produce E-META-001
// for the loop variable `x`. The parser must extract `x` as the variable name
// (not default "item") and `array` as the iterable (not "(const x of array)").
// collectMetaLocals must register `x` so the phase-separation check skips it.
// ---------------------------------------------------------------------------

describe("meta-integration §8: for (const x of array) in compile-time ^{}", () => {
  test("§8a no E-META-001 for loop variable in compile-time ^{} with emit()", () => {
    // A compile-time meta block (has emit()) with JS-style for-of.
    // x is the iterator — must not fire E-META-001.
    const source = `
^{
  const items = ["a", "b", "c"]
  for (const x of items) {
    emit(x)
  }
}
`;
    const { errors } = compileSource(source, "meta-for-of-emit.scrml");
    const meta001s = errors.filter(e => e.code === "E-META-001");
    const xErrors = meta001s.filter(e => e.message && e.message.includes("'x'"));
    expect(xErrors).toHaveLength(0);
  });

  test("§8b parser extracts correct variable name from JS-style for-of", () => {
    // The parser must set variable: "x", not variable: "item" (the default)
    // We verify indirectly: if variable were "item", then "x" would fire E-META-001
    // for uses of x inside the loop body. No E-META-001 for x confirms correct parse.
    const source = `
^{
  const types = ["Foo", "Bar"]
  for (const x of types) {
    emit(x)
  }
  emit("done")
}
`;
    const { errors } = compileSource(source, "meta-for-of-varname.scrml");
    const meta001s = errors.filter(e => e.code === "E-META-001");
    const xErrors = meta001s.filter(e => e.message && e.message.includes("'x'"));
    expect(xErrors).toHaveLength(0);
  });
});

// §9: Bug R18 — emit() as sole child of <program>
//
// When ^{ emit(...) } is the sole content inside <program>, the meta-eval
// replacement produces text/markup nodes with no sibling markup. The codegen
// hasMarkup guard must detect renderable content, not just markup nodes.

describe("meta-integration §9: emit() as sole child of <program> (bug R18)", () => {
  test("emit() as sole child of <program> produces HTML output", () => {
    const source = `<program>
  ^{
    emit('<div>hello from meta</div>')
  }
</program>`;
    const { html, errors } = compileSource(source, "meta-sole-child.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);
    expect(html).not.toBeNull();
    expect(html).toContain("<div>hello from meta</div>");
  });

  test("emit() as sole child of implicit program produces HTML output", () => {
    const source = `^{
  emit('<div>hello from meta</div>')
}
`;
    const { html, errors } = compileSource(source, "meta-sole-child-implicit.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);
    expect(html).not.toBeNull();
    expect(html).toContain("<div>hello from meta</div>");
  });

  test("emit() producing plain text as sole child", () => {
    const source = `^{
  emit('hello world')
}
`;
    const { html, errors } = compileSource(source, "meta-sole-text.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);
    expect(html).toContain("hello world");
  });

  test("multiple emit() calls as sole child", () => {
    const source = `^{
  emit('<p>first</p>')
  emit('<p>second</p>')
}
`;
    const { html, errors } = compileSource(source, "meta-sole-multi-emit.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);
    expect(html).toContain("<p>first</p>");
    expect(html).toContain("<p>second</p>");
  });

  test("emit() with nested elements as sole child", () => {
    const source = `^{
  emit('<div><span>nested</span></div>')
}
`;
    const { html, errors } = compileSource(source, "meta-sole-nested.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);
    expect(html).toContain("<div>");
    expect(html).toContain("<span>nested</span>");
  });

  test("multiple sequential emit() calls produce all output", () => {
    const source = `^{
  emit('<li>item A</li>')
  emit('<li>item B</li>')
  emit('<li>item C</li>')
}
`;
    const { html, errors } = compileSource(source, "meta-sole-seq-emit.scrml");
    const fatalErrors = errors.filter(e => e.severity !== "warning");
    expect(fatalErrors).toHaveLength(0);
    expect(html).toContain("<li>item A</li>");
    expect(html).toContain("<li>item B</li>");
    expect(html).toContain("<li>item C</li>");
  });
});
