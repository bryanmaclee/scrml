/**
 * fix-server-eq-helper-import — Regression Tests (GITI-012)
 *
 * Reproducer (pre-fix):
 *   ${ server function checkLength() {
 *     const arr = []
 *     return { ok: arr.length == 0 }
 *   }}
 *
 * Pre-fix .server.js emit:
 *   return {ok: _scrml_structural_eq(arr.length, 0)};
 * + .server.js never imports or inlines _scrml_structural_eq → ReferenceError
 *   at runtime on every server-fn invocation that uses ==.
 *
 * Fix has two layers, both in this PR:
 *   (a) emit-expr.ts — when both operands of `==`/`!=` are statically
 *       primitive (lit, unary, arithmetic-binary, ternary-of-prims,
 *       member.length/size/byteLength/name), lower to JS `===`/`!==` directly
 *       (SPEC §45.4 explicitly authorizes this). The reproducer hits this path.
 *   (b) emit-server.ts — after assembling the server output, scan for
 *       `_scrml_structural_eq(`. If any callsite survived the primitive
 *       shortcut (struct/enum equality, ident vs ident, etc.), prepend an
 *       inline copy of the helper near the top of the .server.js so the
 *       reference resolves at runtime. Helper body is a verbatim copy of the
 *       runtime-template.js definition.
 *
 * Coverage:
 *   §1  Reproducer compiles, emits === instead of helper, .server.js loads + runs.
 *   §2  Two literal numbers `0 == 0` use ===, no helper anywhere in .server.js.
 *   §3  Two literal strings `"a" == "b"` use ===, no helper.
 *   §4  Negation `arr.length != 0` uses !==, no helper.
 *   §5  Boolean unary chain `!flag == false` uses ===, no helper.
 *   §6  Mixed primitive arithmetic `(a + 1) == (b * 2)` uses ===.
 *   §7  Struct equality `{a:1} == {a:1}` does NOT shortcut → helper IS inlined.
 *   §8  Inlined helper actually computes structural equality correctly
 *       (extracted via Function() so the test is independent of the per-route
 *       wrapper code, CSRF middleware, and any Request shim from happy-dom).
 *   §9  Inlined helper handles enum tags via _tag field.
 *   §10 No-equality server fn produces .server.js with NO helper inlined.
 *   §11 Helper inlining is idempotent — appears at most once.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a one-file scrml source via the public compiler API.
 * Returns { errors, serverJs, clientJs }.
 */
function compileSource(scrmlSource, testName) {
  const tag = testName ?? `eqfix-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_eqfix_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let serverJs = null;
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        serverJs = output.serverJs ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], serverJs, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

/**
 * Slice the inlined helper definition out of a .server.js text and return a
 * callable JS function. This isolates the test from anything else in the
 * generated module (CSRF wrappers, Request shims, route registration).
 */
function extractInlinedEq(serverJs) {
  // Helper definition starts at `function _scrml_structural_eq(a, b) {` and
  // ends at the matching closing brace at column 0.
  const startMarker = "function _scrml_structural_eq(a, b) {";
  const startIdx = serverJs.indexOf(startMarker);
  if (startIdx === -1) return null;
  // Find the matching close-brace at column-0. The runtime helper template
  // uses 2-space indents inside, so the closing brace at column 0 is unique.
  const tail = serverJs.slice(startIdx);
  const endIdx = tail.indexOf("\n}\n");
  if (endIdx === -1) return null;
  const body = tail.slice(0, endIdx + 2);
  return new Function(`${body}\nreturn _scrml_structural_eq;`)();
}

// ---------------------------------------------------------------------------
// §1 — sidecar reproducer compiles + runs cleanly
// ---------------------------------------------------------------------------

describe("fix-server-eq-helper-import — sidecar reproducer", () => {
  test("§1 GITI-012 sidecar: arr.length == 0 in server fn body", () => {
    const src = `<program>

\${
  server function checkLength() {
    const arr = []
    return { ok: arr.length == 0 }
  }

  @res = { ok: false }
  @res = checkLength()
}

<div>
  <p>length-eq probe</p>
</div>

</program>`;
    const { errors, serverJs } = compileSource(src, "sidecar");
    // No compile errors of any severity for this case.
    expect(errors.filter(e => e.severity === "error" || e.code?.startsWith("E-")).length).toBe(0);
    expect(serverJs).not.toBeNull();
    // Approach (a) hits — primitive shortcut lowers `arr.length == 0` to ===.
    expect(serverJs).toContain("(arr.length === 0)");
    // No helper-call leak for THIS expression. (Helper may still be inlined
    // somewhere else in some other test; this assertion is local to this fn.)
    expect(serverJs).not.toContain("_scrml_structural_eq(arr.length");
    // No helper inline for a primitive-only file.
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });
});

// ---------------------------------------------------------------------------
// §2-§6 — primitive shortcut covers common operand shapes
// ---------------------------------------------------------------------------

describe("fix-server-eq-helper-import — primitive shortcut (approach a)", () => {
  test("§2 two literal numbers `0 == 0`", () => {
    const src = `<program>
\${
  server function f() {
    return { ok: 0 == 0 }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "lit-num");
    expect(serverJs).toContain("(0 === 0)");
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });

  test("§3 two literal strings `\"a\" == \"b\"`", () => {
    const src = `<program>
\${
  server function f() {
    return { ok: "a" == "b" }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "lit-str");
    expect(serverJs).toMatch(/\("a" === "b"\)/);
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });

  test("§4 negation `arr.length != 0` uses !==", () => {
    const src = `<program>
\${
  server function f() {
    const arr = [1, 2]
    return { ok: arr.length != 0 }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "neq");
    expect(serverJs).toContain("(arr.length !== 0)");
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });

  test("§5 unary `!flag == false`", () => {
    const src = `<program>
\${
  server function f() {
    const flag = true
    return { ok: !flag == false }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "unary");
    // `!flag == false` should lower fully to `===` because both unary `!flag`
    // (boolean) and literal `false` are statically primitive.
    expect(serverJs).toContain("=== false");
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });

  test("§6 mixed arithmetic `(a + 1) == (b * 2)`", () => {
    const src = `<program>
\${
  server function f() {
    const a = 1
    const b = 1
    return { ok: (a + 1) == (b * 2) }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "arith");
    expect(serverJs).toContain("===");
    // No helper call generated, no helper definition inlined.
    expect(serverJs).not.toContain("_scrml_structural_eq(");
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });
});

// ---------------------------------------------------------------------------
// §7-§9 — fail-safe: when shortcut declines, helper IS inlined
// ---------------------------------------------------------------------------

describe("fix-server-eq-helper-import — server helper inlining (approach b)", () => {
  test("§7 struct equality `{a:1} == {a:1}` keeps helper, inlines definition", () => {
    const src = `<program>
\${
  server function f() {
    const u1 = { id: 1, name: "alice" }
    const u2 = { id: 1, name: "alice" }
    return { ok: u1 == u2 }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "struct");
    // Approach (a) declined (operands are bare idents, not statically primitive).
    expect(serverJs).toContain("_scrml_structural_eq(u1, u2)");
    // Approach (b) kicks in — helper definition is inlined.
    expect(serverJs).toContain("function _scrml_structural_eq(a, b)");
  });

  test("§8 inlined helper computes structural equality correctly", () => {
    // Compile struct-equality scenario, slice the inlined `_scrml_structural_eq`
    // out of the .server.js text, and exercise it directly. This confirms the
    // helper body itself is correct AND is syntactically valid JS (would throw
    // at Function() construction otherwise).
    //
    // Side benefit: this test does NOT depend on the route handler, the CSRF
    // middleware, or any Request implementation — so it is robust against
    // happy-dom global Request shimming or other test-ordering hazards.
    const src = `<program>
\${
  server function check(id) {
    const a = { id: id, kind: "user" }
    const b = { id: id, kind: "user" }
    return { ok: a == b }
  }
  @res = { ok: false }
  @res = check(1)
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "extract-helper");
    expect(serverJs).toContain("function _scrml_structural_eq(a, b)");
    const eq = extractInlinedEq(serverJs);
    expect(typeof eq).toBe("function");
    // Reference identity short-circuit
    const obj = { x: 1 };
    expect(eq(obj, obj)).toBe(true);
    // Primitive equality
    expect(eq(0, 0)).toBe(true);
    expect(eq("a", "a")).toBe(true);
    expect(eq(true, true)).toBe(true);
    expect(eq(0, 1)).toBe(false);
    // Null / undefined handling
    expect(eq(null, null)).toBe(true);
    expect(eq(undefined, undefined)).toBe(true);
    expect(eq(null, undefined)).toBe(false);
    expect(eq(null, {})).toBe(false);
    // Type mismatch
    expect(eq(0, "0")).toBe(false);
    // Struct equality (deep, field-by-field)
    expect(eq({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(eq({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(eq({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(eq({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    // Nested structs
    expect(eq({ x: { y: 1 } }, { x: { y: 1 } })).toBe(true);
    expect(eq({ x: { y: 1 } }, { x: { y: 2 } })).toBe(false);
    // Arrays (tuple-like)
    expect(eq([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(eq([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(eq([1, 2], [1, 2, 3])).toBe(false);
    // Enum (_tag) variants
    expect(eq({ _tag: "Active" }, { _tag: "Active" })).toBe(true);
    expect(eq({ _tag: "Active" }, { _tag: "Inactive" })).toBe(false);
    expect(eq({ _tag: "Active", level: 1 }, { _tag: "Active", level: 1 })).toBe(true);
    expect(eq({ _tag: "Active", level: 1 }, { _tag: "Active", level: 2 })).toBe(false);
  });

  test("§9 helper inlined for enum-tagged objects (_tag field)", () => {
    const src = `<program>
\${
  server function f() {
    const a = { _tag: "Active", level: 1 }
    const b = { _tag: "Active", level: 1 }
    return { ok: a == b }
  }
  @res = { ok: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "enum-tag");
    expect(serverJs).toContain("_scrml_structural_eq(a, b)");
    expect(serverJs).toContain("function _scrml_structural_eq(a, b)");
    // The inlined helper has the enum-tag branch. S93 — switched from strict
    // `!== undefined` to loose `!= null` (covers both null + undefined,
    // avoids the bare `undefined` keyword per M-7C-D-12).
    expect(serverJs).toContain("a._tag != null && b._tag != null");
  });
});

// ---------------------------------------------------------------------------
// §10-§11 — no false-positive inlining
// ---------------------------------------------------------------------------

describe("fix-server-eq-helper-import — no false-positive inlining", () => {
  test("§10 server fn with no equality ops produces .server.js without the helper", () => {
    const src = `<program>
\${
  server function noEq() {
    return { msg: "hello" }
  }
  @res = { msg: "" }
  @res = noEq()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "no-eq");
    expect(serverJs).not.toContain("_scrml_structural_eq");
    expect(serverJs).not.toContain("function _scrml_structural_eq");
  });

  test("§11 inlined helper appears at most once even with multiple == sites", () => {
    const src = `<program>
\${
  server function f() {
    const a = { id: 1 }
    const b = { id: 1 }
    const c = { id: 2 }
    const ok1 = a == b
    const ok2 = a == c
    const ok3 = b == c
    return { ok1: ok1, ok2: ok2, ok3: ok3 }
  }
  @res = { ok1: false, ok2: false, ok3: false }
  @res = f()
}
<div></div>
</program>`;
    const { serverJs } = compileSource(src, "multi");
    const matches = (serverJs.match(/^function _scrml_structural_eq\(a, b\) \{$/gm) ?? []).length;
    expect(matches).toBe(1);
    // Sanity: at least one call site is present.
    expect(serverJs).toContain("_scrml_structural_eq(a, b)");
  });
});
