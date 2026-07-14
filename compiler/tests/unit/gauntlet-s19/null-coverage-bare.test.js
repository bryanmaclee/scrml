/**
 * GCP3 null-coverage — bare null/undefined literal sweep (W3.1, F-NULL-003).
 *
 * The S19 GCP3 detector previously flagged `null` / `undefined` only when
 * they appeared as operands of `==` / `!=` / `===` / `!==` (W3 — F-NULL-001 +
 * F-NULL-002). FRICTION F-NULL-003 surfaced the deferred gap: bare `null` /
 * `undefined` literals in value position (declarations, returns, object
 * property values, array elements, ternary branches, assignment RHS) silently
 * passed.
 *
 * Per SPEC §42.7 (W3 amendment): the rejection of `null` / `undefined` SHALL
 * apply uniformly across **every** scrml source position. W3.1 closes the
 * value-position path with a `forEachLitNull` walker that visits every
 * forbidden-absence literal (and `ident{ name: "null" | "undefined" }`)
 * reachable from any exprNode.
 *
 * §42 absence canon (S90 M-7C-D-12 Track 1): parser sites manufacture only
 * `lit{ litType: "not" }`; the `raw` field discriminates user-source token
 * provenance — `raw:"null"` / `raw:"undefined"` are user-source forbidden
 * tokens (fire E-SYNTAX-042); `raw:"not"` is canonical or internal synthesis
 * (no fire). Pre-S90 AST snapshots may still carry deprecated `litType:"null"`
 * / `litType:"undefined"`; the detector recognizes those as legacy fallback.
 *
 * Suppression rules verified here:
 *   - Direct lit-null operands of binary `==` / `!=` / `===` / `!==` are
 *     handled by checkEqNode (W3) — not double-emitted.
 *   - Direct lit-null operands of binary `is-not` / `is-some` / `is-not-not`
 *     are SYNTHETIC (the expression-parser desugars `x is not` → `binary{
 *     op:"is-not", left:x, right:lit{ litType:"not", raw:"not" } }`). The
 *     synthetic operand is not a forbidden source token; the walker's
 *     isForbiddenAbsenceLit helper returns false for it.
 *
 * Each negative test asserts E-SYNTAX-042 is emitted. Each positive control
 * asserts NO E-SYNTAX-042 is emitted.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `null-bare-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(items) {
  return items.map(e => e.code).sort();
}

describe("W3.1 — bare null/undefined literal sweep (F-NULL-003)", () => {

  // ===============================================================
  // Declaration initializer — `@x = null` / `let x = null`.
  // ===============================================================
  describe("declaration initializer", () => {

    test("`@x = null` (reactive declaration init) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = null
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "decl-reactive-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`@x = undefined` (reactive declaration init) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = undefined
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "decl-reactive-undefined");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`let x = null` (let declaration init) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  let x = null
  @y = "init"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "decl-let-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`const x = undefined` (const declaration init) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  const x = undefined
  @y = "init"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "decl-const-undefined");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("diagnostic span has non-zero line/col", () => {
      const src = `<program>
\${
  @x = null
}
<div>x</div>
</program>`;
      const { errors } = compileWholeScrml(src, "decl-source-loc");
      const e042 = errors.find(e => e.code === "E-SYNTAX-042");
      expect(e042).toBeDefined();
      expect(e042.span).toBeDefined();
      expect(e042.span.line).toBeGreaterThan(0);
    });

  });

  // ===============================================================
  // return expression — `return null` / `return undefined`.
  // ===============================================================
  describe("return expression", () => {

    test("`return null` (top-level fn body) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  function f() {
    return null
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ret-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`return undefined` (top-level fn body) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  function f() {
    return undefined
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ret-undefined");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`return null` inside conditional → E-SYNTAX-042", () => {
      const src = `<program>
\${
  function f(x) {
    if (x > 0) {
      return x
    }
    return null
  }
  @y = "ready"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ret-null-in-if");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Object property value — `{ field: null }`.
  // ===============================================================
  describe("object property value", () => {

    test("`{ val: null }` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = { name: "hi", val: null }
}
<div>\${@x.name}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "obj-prop-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`{ a: 1, b: undefined }` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = { a: 1, b: undefined }
}
<div>\${@x.a}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "obj-prop-undefined");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Array element — `[null, ...]`, `[..., undefined, ...]`.
  // ===============================================================
  describe("array element", () => {

    test("`[1, null, 2]` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = [1, null, 2]
}
<div>\${@x.length}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "arr-elt-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`[null]` (single null element) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = [null]
}
<div>\${@x.length}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "arr-single-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Ternary branch — `cond ? a : null`, `cond ? null : b`.
  // ===============================================================
  describe("ternary branch", () => {

    test("ternary alternate is bare null → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = 0
  @y = @x > 0 ? "yes" : null
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tern-alt-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("ternary consequent is bare null → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = 0
  @y = @x > 0 ? null : "no"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tern-cons-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Assignment RHS inside fn body — `@x = null` after declaration.
  // ===============================================================
  describe("assignment RHS", () => {

    test("`@x = null` inside fn body → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
  function clear() { @x = null }
  @y = "init"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "assign-null-fn");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`@x = undefined` inside fn body → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
  function clear() { @x = undefined }
  @y = "init"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "assign-undefined-fn");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Suppression — synthetic null operands of `is`-family operators.
  // ===============================================================
  describe("suppression — synthetic lit-null in is-* operators", () => {

    test("`if (x is not)` does NOT emit E-SYNTAX-042 (synthetic right operand)", () => {
      const src = `<program>
\${
  let x: string | not = not
  if (x is not) {
    let _local = 1
  }
}
<div>x</div>
</program>`;
      const { errors } = compileWholeScrml(src, "supp-isnot");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`if (x is some)` does NOT emit E-SYNTAX-042 (synthetic right operand)", () => {
      const src = `<program>
\${
  let x: string | not = not
  if (x is some) {
    let _local = 1
  }
}
<div>x</div>
</program>`;
      const { errors } = compileWholeScrml(src, "supp-issome");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`@x is not not` (presence check) does NOT emit E-SYNTAX-042", () => {
      const src = `<program>
\${
  let x: string | not = "hello"
  @y = x is not not
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "supp-isnotnot");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Suppression — equality-operand null is handled by checkEqNode
  // (not double-emitted by W3.1 walker).
  // ===============================================================
  describe("suppression — `== null` / `!= null` only emit once", () => {

    test("`if (x == null)` emits exactly one E-SYNTAX-042", () => {
      const src = `<program>
\${
  function check(target) {
    if (target == null) return 0
    return 24
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "supp-eq-null-single");
      const e042s = errors.filter(e => e.code === "E-SYNTAX-042");
      // checkEqNode fires once on the `target == null` operand. W3.1 must
      // NOT additionally fire on the lit-null right operand.
      expect(e042s.length).toBe(1);
    });

    test("`if (x != undefined)` emits exactly one E-SYNTAX-042", () => {
      const src = `<program>
\${
  function check(target) {
    if (target != undefined) return 1
    return 0
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "supp-neq-undefined-single");
      const e042s = errors.filter(e => e.code === "E-SYNTAX-042");
      expect(e042s.length).toBe(1);
    });

  });

  // ===============================================================
  // Positive controls — spec-compliant code compiles clean.
  // ===============================================================
  describe("positive controls — spec-compliant alternatives compile", () => {

    test("`@x = not` (initializer) → no E-SYNTAX-042", () => {
      const src = `<program>
\${
  let x: string | not = not
  @y = x is some ? "present" : "absent"
}
<div>\${@y}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-decl-not");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`return not` (return expr) → no E-SYNTAX-042", () => {
      const src = `<program>
\${
  function f(): string | not {
    return not
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-ret-not");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`{ field: not }` (object prop) → no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = { name: "hi", val: not }
}
<div>\${@x.name}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-obj-not");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`[1, not, 2]` (array elt) → no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = [1, not, 2]
}
<div>\${@x.length}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-arr-not");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("plain numeric/string init → no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = 0
  @y = "hello"
  @z = true
}
<div>\${@x} \${@y} \${@z}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-plain-vals");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

  });

});
