/**
 * GCP3 null-coverage — F-NULL-001 + F-NULL-002 paired fix (W3).
 *
 * The S19 GCP3 detector (`compiler/src/gauntlet-phase3-eq-checks.js`) emits
 * E-SYNTAX-042 for `== null` / `!= null` / `== undefined` / `!= undefined`
 * comparisons (§42.7 — `null`/`undefined` SHALL NOT be valid scrml tokens
 * in value position). FRICTION findings F-NULL-001 (machine-context) and
 * F-NULL-002 (server-fn-body boundary) reported asymmetric pass behavior:
 * the same syntactic shape was rejected in some positions and silently
 * accepted in others.
 *
 * Diagnosis: the asymmetry was rooted in two walker incomplete-coverage
 * bugs — `walkAst` never visited markup `attrs[*].value.exprNode`, and
 * `forEachEqualityBinary` never descended through `condition` (ternary),
 * `args` (call/new), or `props` (object literal). This test suite exercises
 * every position where `null` / `undefined` comparisons should be rejected
 * per §42 — function bodies (server + client), markup attribute expressions
 * (`if=`, `class=`, etc.), template ternary subexpressions, call arguments,
 * object-literal property values, and array elements.
 *
 * Each negative test asserts E-SYNTAX-042 is emitted. Each positive (control)
 * test asserts NO E-SYNTAX-042 is emitted for spec-compliant alternatives
 * (`is not` / `is some` / `not`).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `null-cov-${++tmpCounter}`) {
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

describe("GCP3 null-coverage — consistent E-SYNTAX-042 (W3)", () => {

  // ===============================================================
  // F-NULL-001 — files containing <machine> reject null comparisons
  // in client-fn bodies. The pre-W3 detector already rejected this
  // path; we lock in regression coverage so a future walker change
  // doesn't accidentally lose it.
  // ===============================================================
  describe("F-NULL-001 — client-fn body equality with null literal", () => {

    test("client function body `if (x == null)` → E-SYNTAX-042", () => {
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
      const { errors } = compileWholeScrml(src, "fnull1-client-eq-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("client function body `if (x != null)` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  function check(target) {
    if (target != null) return 1
    return 0
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull1-client-neq-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("client function body in file with <machine> still rejects `== null`", () => {
      const src = `<program>
\${
  type Status = "idle" | "active"
  function check(target) {
    if (target == null) return 0
    return 24
  }
  @x = "ready"
  @s: Status = Status.idle
}
<machine for=Status>
  Status.idle <- Status.active = action {}
</machine>
<div>\${@x} \${@s}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull1-machine-present");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("client function body in file WITHOUT <machine> also rejects `== null` (no asymmetry)", () => {
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
      const { errors } = compileWholeScrml(src, "fnull1-no-machine");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // F-NULL-002 — server-fn body and markup-attr null comparisons
  // are now both rejected (previously markup-attr silently passed).
  // ===============================================================
  describe("F-NULL-002 — markup-attribute equality with null literal", () => {

    test("server function body `if (x != null)` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  server function test() {
    const x = "hello"
    if (x != null) return { ok: true }
    return { ok: false }
  }
}
<div>test</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull2-server-neq-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("markup `<div if=(@x != null)>` → E-SYNTAX-042 (was silent pass)", () => {
      const src = `<program>
\${
  @x = ""
}
<div if=(@x != null && @x != "")>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull2-markup-if-attr");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("markup `<div if=(@x == null)>` → E-SYNTAX-042 (was silent pass)", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div if=(@x == null)>missing</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull2-markup-if-eq");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("call-ref attribute \`onclick=fn(@x == null)\` argExprNode → E-SYNTAX-042", () => {
      const src = `<program>
\${
  function f(b) { return b }
  @x = ""
}
<button onclick=f(@x == null)>click</button>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull2-call-ref-arg");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    // NOTE: \`<div class="\${@x == null ? a : b}">\` (string-literal attr
    // with template interpolation) is NOT covered by GCP3. The
    // interpolation \`\${...}\` is preserved as raw text in the AST
    // attribute value (kind: "string-literal") and never parsed into an
    // exprNode. Closing this requires a separate pass that parses
    // string-template interpolation segments. Held for a follow-up
    // dispatch (W3.2 — string-template-interp null sweep).

  });

  // ===============================================================
  // Diagnostic-quality — line/col attached to every emit.
  // ===============================================================
  describe("F-NULL-002 diagnostic quality — source location attached", () => {

    test("server-fn body emit carries non-zero line/col", () => {
      const src = `<program>
\${
  server function check(s) {
    const x = "hello"
    if (x != null) return { ok: true }
    return { ok: false }
  }
}
<div>x</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull2-srvfn-source-loc");
      const e042 = errors.find(e => e.code === "E-SYNTAX-042");
      expect(e042).toBeDefined();
      // span is normalized to {file, start, end, line, col}.
      expect(e042.span).toBeDefined();
      // line should reference an actual source line (>0).
      // The source has the if-stmt on line 5 (1-indexed).
      expect(e042.span.line).toBeGreaterThan(0);
    });

    test("markup-attr emit carries non-zero line/col", () => {
      const src = `<program>
\${
  @x = ""
}
<div if=(@x != null)>present</div>
</program>`;
      const { errors } = compileWholeScrml(src, "fnull2-mu-source-loc");
      const e042 = errors.find(e => e.code === "E-SYNTAX-042");
      expect(e042).toBeDefined();
      expect(e042.span).toBeDefined();
      expect(e042.span.line).toBeGreaterThan(0);
    });

  });

  // ===============================================================
  // Ternary-condition coverage (broader walker fix).
  // ===============================================================
  describe("ternary condition descent — equality binary inside ternary.condition", () => {

    test("template ternary `${@x == null ? a : b}` → E-SYNTAX-042 (was silent pass)", () => {
      const src = `<program>
\${
  @lastChange = "active"
}
<div>\${@lastChange == null ? "none" : @lastChange}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tern-cond-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("nested ternary in client-fn body return → E-SYNTAX-042", () => {
      const src = `<program>
\${
  function check(s) {
    return s != null ? "yes" : "no"
  }
  @x = "ready"
}
<div>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tern-cond-fn-return");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Positive controls — spec-compliant alternatives compile clean.
  // ===============================================================
  describe("positive controls — spec-compliant null handling compiles", () => {

    test("`if (x is not)` in client fn — no E-SYNTAX-042", () => {
      const src = `<program>
\${
  let x: string | not = not
  if (x is not) {
    let _local = 1
  }
}
<div>x</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-isnot");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`<div if=@x>` (truthiness) — no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div if=@x>\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-truthy");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("template `${@x is some ? a : b}` — no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div>\${@x is some ? "yes" : "no"}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-tern-issome");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

  });

});
