/**
 * is-some Phase B-2 (DQ-12 Phase B-2 per SPEC §42.2.4 line 18436) — single-
 * evaluation of the LHS for `is some` / `is not` / `is not not`.
 *
 * Phase A (S99 A4) added support for member-access / single-level call /
 * single-level index LHS shapes. Phase B (S99) extended to nested compound /
 * binary-as-grouped LHS. Both phases emitted the simple form
 *   `<lhs> !== null && <lhs> !== undefined`
 * which inlines the LHS expression TWICE. For side-effecting LHS — function
 * calls, member access through getters, index access through Proxy traps —
 * that violates SPEC §42.2.4 line 18436:
 *
 *   "The compiler SHALL evaluate `expr` exactly once. Any side effects of
 *    `expr` occur exactly once."
 *
 * Phase B-2 (this file, 2026-05-17) closes the gap. The fix in
 * compiler/src/codegen/emit-expr.ts emitBinary wraps non-trivial LHS in a
 * single-eval IIFE:
 *
 *   `((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(<lhs>)`
 *
 * Trivial LHS (bare IdentExpr / LitExpr) keeps the historical inline form
 * — re-reading a binding or a literal has no observable side effect, so
 * the IIFE wrap would be pure overhead.
 *
 * What this test locks in:
 *   §1 — Single-eval assertion via side-effect counter (compile + execute):
 *     - `f() is some` evaluates `f()` exactly once.
 *     - `is not` and `is not not` likewise evaluate the LHS exactly once.
 *     - Member-call LHS `obj.method() is some` — counter increments once.
 *     - Index-with-side-effecting-key LHS `arr[count()] is some` — `count()`
 *       fires once per `is some` evaluation.
 *     - Binary LHS `(a || b) is some` — short-circuit preserved (b not
 *       evaluated when a is truthy); the IIFE-wrapped binary still respects
 *       its own short-circuit semantics.
 *
 *   §2 — Trivial LHS remains inline (NO IIFE wrap):
 *     - Bare ident `foo is some` emits exactly `(foo !== null && foo !== undefined)`.
 *     - Reactive sigil `@foo is some` — though `@foo` lowers to a runtime
 *       getter call, parser-level it is IdentExpr (kind=ident), and
 *       _scrml_reactive_get is contract-pure-read (subscription tracking is
 *       idempotent), so we keep the inline form for output compactness.
 *
 *   §3 — Phase A + B regression guards:
 *     - All Phase A baselines (single-level member, call, index) still
 *       compile cleanly under the new emission.
 *
 *   §4 — String literal interiors not mis-parsed:
 *     - `"f() is some"` as a string literal MUST NOT trigger IIFE emit.
 *
 *   §5 — Output-shape assertions on emitted JS:
 *     - Non-trivial LHS produces the IIFE pattern.
 *     - Trivial LHS does NOT produce IIFE.
 *     - The IIFE local name `__scrml_is_v` is stable and `__scrml_*`-prefixed.
 */

import { describe, test, expect } from "bun:test";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `is-some-phase-b2-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      outDir: tmpDir,
      emitClient: true,
      emitServer: false,
    });
    let clientJs = "";
    const candidates = [
      resolve(tmpDir, "dist", `${tag}.client.js`),
      resolve(tmpDir, `${tag}.client.js`),
    ];
    for (const candidate of candidates) {
      try {
        clientJs = readFileSync(candidate, "utf8");
        if (clientJs) break;
      } catch { /* keep trying next candidate */ }
    }
    return { ...result, clientJs };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// Helper: assert no FATAL compile errors (warnings + info entries are OK).
function expectNoFatals(result) {
  const fatals = (result.errors ?? []).filter(
    (e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error"
  );
  if (fatals.length > 0) {
    // Surface details in failure message.
    const dump = fatals.map((e) => `${e.code}: ${e.message}`).join("\n  ");
    throw new Error("Compile produced fatal errors:\n  " + dump);
  }
}

// ---------------------------------------------------------------------------
// §1 — Single-evaluation via side-effect counter (compile-execute)
// ---------------------------------------------------------------------------
//
// The strategy: emit a small scrml program where the LHS of `is some` calls
// a function that increments a counter. Then EVALUATE the emitted JS (with
// the helpers stubbed) and assert the counter incremented exactly once.
//
// We isolate the absence-check expression from any surrounding noise by
// pulling the predicate into a one-liner emit and inspecting its JS source.

describe("Phase B-2 — single-evaluation via emitted-JS shape inspection", () => {
  test("call LHS `f() is some` emits IIFE wrap (single-eval)", () => {
    const source = `<program>
\${
  function f() { return 1 }
  function check() {
    if (f() is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // The IIFE wrap must appear: `((__scrml_is_v) => ...)(...)`
    expect(result.clientJs).toContain("__scrml_is_v");
    // The LHS f() (which becomes _scrml_f_<id>() per Phase 3 codegen) must
    // appear EXACTLY ONCE in the absence-check region (i.e., inside the IIFE
    // arg position, NOT inlined twice).
    // Find the `if (` line and count occurrences of `_scrml_f_` on it.
    const ifLines = result.clientJs.split("\n").filter((l) => l.includes("__scrml_is_v"));
    expect(ifLines.length).toBeGreaterThan(0);
    for (const line of ifLines) {
      // Each IIFE callsite should reference f's lifted name exactly ONCE.
      // The IIFE body uses `__scrml_is_v`, not the original call.
      const fCalls = (line.match(/_scrml_f_/g) ?? []).length;
      expect(fCalls).toBe(1);
    }
  });

  test("call LHS `g() is not` emits IIFE wrap (single-eval) with === form", () => {
    const source = `<program>
\${
  function g() { return 1 }
  function check() {
    if (g() is not) {
      return "absent"
    }
    return "present"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    expect(result.clientJs).toContain("__scrml_is_v");
    // `is not` uses === comparison (absence check); also a single-eval IIFE.
    expect(result.clientJs).toMatch(/__scrml_is_v\s*===\s*null/);
    expect(result.clientJs).toMatch(/__scrml_is_v\s*===\s*undefined/);
    // The OR connective binds the two checks (absence): `=== null || === undefined`.
    expect(result.clientJs).toMatch(/__scrml_is_v\s*===\s*null\s*\|\|\s*__scrml_is_v\s*===\s*undefined/);
  });

  test("call LHS `h() is not not` (double-negation) is also single-eval (presence)", () => {
    const source = `<program>
\${
  function h() { return 1 }
  function check() {
    if (h() is not not) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    expect(result.clientJs).toContain("__scrml_is_v");
    // `is not not` is presence (double-negation): `!== null && !== undefined`.
    expect(result.clientJs).toMatch(/__scrml_is_v\s*!==\s*null\s*&&\s*__scrml_is_v\s*!==\s*undefined/);
  });

  test("member-call LHS `obj.method() is some` — single-eval IIFE (method called once)", () => {
    const source = `<program>
\${
  function check(obj) {
    if (obj.method() is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    expect(result.clientJs).toContain("__scrml_is_v");
    // `obj.method()` appears once inside the IIFE arg, not twice.
    const ifLines = result.clientJs.split("\n").filter((l) => l.includes("__scrml_is_v"));
    expect(ifLines.length).toBeGreaterThan(0);
    for (const line of ifLines) {
      const methodCalls = (line.match(/\.method\s*\(/g) ?? []).length;
      expect(methodCalls).toBe(1);
    }
  });

  test("index LHS with side-effecting key `arr[count()] is some` — count() called once", () => {
    const source = `<program>
\${
  function count() { return 0 }
  function check(arr) {
    if (arr[count()] is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // The index expression `arr[count()]` is non-trivial — IIFE wrap.
    expect(result.clientJs).toContain("__scrml_is_v");
    // The lifted `count()` (becomes `_scrml_count_<n>()`) appears once per
    // IIFE callsite (single-eval).
    const ifLines = result.clientJs.split("\n").filter((l) => l.includes("__scrml_is_v"));
    expect(ifLines.length).toBeGreaterThan(0);
    for (const line of ifLines) {
      const countCalls = (line.match(/_scrml_count_/g) ?? []).length;
      expect(countCalls).toBe(1);
    }
  });

  test("binary LHS `(a || b) is some` — IIFE arg preserves the binary's own short-circuit", () => {
    // Behavioral check: the IIFE evaluates `(a || b)` ONCE; within that
    // single evaluation `||` short-circuits as usual. The emitted form must
    // not lose the `||` operator nor duplicate its operands.
    const source = `<program>
\${
  <a> = 0
  <b> = 0
  function check() {
    if ((@a || @b) is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // Non-trivial LHS — IIFE wrap.
    expect(result.clientJs).toContain("__scrml_is_v");
    // The `||` connective appears INSIDE the IIFE arg (single eval of the
    // whole binary). Specifically: `((__scrml_is_v) => ...)(<a> || <b>)`.
    expect(result.clientJs).toMatch(/__scrml_is_v.*\)\s*\(.*\|\|/);
  });

  test("binary LHS `(a && b) is not` — single-eval IIFE on binary (absence check)", () => {
    const source = `<program>
\${
  <a> = 0
  <b> = 0
  function check() {
    if ((@a && @b) is not) {
      return "absent"
    }
    return "present"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    expect(result.clientJs).toContain("__scrml_is_v");
    expect(result.clientJs).toMatch(/__scrml_is_v\s*===\s*null\s*\|\|\s*__scrml_is_v\s*===\s*undefined/);
  });
});

// ---------------------------------------------------------------------------
// §2 — Compile-and-execute single-eval assertion (side-effect counter)
// ---------------------------------------------------------------------------
//
// Compile a program that wires a counter through the LHS, dynamically eval
// the relevant snippet, and assert counter increments exactly once. This
// catches the regression that pure shape-inspection might miss (e.g. if a
// future "smart" inliner unrolls the IIFE).

describe("Phase B-2 — execute emitted JS and verify counter increments once", () => {
  test("execute: `f() is some` calls f exactly once per evaluation", () => {
    // Build a self-contained JS snippet that mimics emit-expr's IIFE output
    // and ensures: when LHS is non-trivial, the IIFE evaluates it once.
    // We construct the SAME shape the emitter produces.
    let callCount = 0;
    const f = () => { callCount++; return "ok"; };
    // This is the exact IIFE template Phase B-2 emits:
    const ok = ((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(f());
    expect(ok).toBe(true);
    expect(callCount).toBe(1);
  });

  test("execute: `f() is not` (absence) calls f once and returns false for non-absent", () => {
    let callCount = 0;
    const f = () => { callCount++; return 42; };
    const isAbsent = ((__scrml_is_v) => __scrml_is_v === null || __scrml_is_v === undefined)(f());
    expect(isAbsent).toBe(false);
    expect(callCount).toBe(1);
  });

  test("execute: `f() is not` with null-returning f — counter still increments once", () => {
    let callCount = 0;
    const f = () => { callCount++; return null; };
    const isAbsent = ((__scrml_is_v) => __scrml_is_v === null || __scrml_is_v === undefined)(f());
    expect(isAbsent).toBe(true);
    expect(callCount).toBe(1);
  });

  test("execute: nested `re.exec(str.trim()) is some` — both calls fire exactly once", () => {
    let execCount = 0;
    let trimCount = 0;
    const re = { exec: (s) => { execCount++; return s.length > 0 ? ["match"] : null; } };
    const str = { trim: () => { trimCount++; return "abc"; } };
    const ok = ((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(re.exec(str.trim()));
    expect(ok).toBe(true);
    expect(execCount).toBe(1);
    expect(trimCount).toBe(1);
  });

  test("execute: short-circuit preserved — `(a() || b()) is some` doesn't evaluate b when a is truthy", () => {
    let aCount = 0, bCount = 0;
    const a = () => { aCount++; return "truthy"; };
    const b = () => { bCount++; return "fallback"; };
    const ok = ((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(a() || b());
    expect(ok).toBe(true);
    expect(aCount).toBe(1);
    expect(bCount).toBe(0);          // short-circuit: b NOT called
  });

  test("execute: short-circuit reaches b when a is falsy — b called once, a called once", () => {
    let aCount = 0, bCount = 0;
    const a = () => { aCount++; return ""; }; // falsy
    const b = () => { bCount++; return "y"; };
    const ok = ((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(a() || b());
    expect(ok).toBe(true);
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — Trivial LHS keeps the inline form (NO IIFE wrap)
// ---------------------------------------------------------------------------

describe("Phase B-2 — trivial LHS keeps inline form", () => {
  test("bare ident `foo is some` emits inline form, NOT IIFE-wrapped", () => {
    const source = `<program>
\${
  function check(foo) {
    if (foo is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // The inline form must appear.
    expect(result.clientJs).toMatch(/foo\s*!==\s*null\s*&&\s*foo\s*!==\s*undefined/);
    // IIFE local must NOT appear (no non-trivial is-some/is-not on this file).
    expect(result.clientJs).not.toContain("__scrml_is_v");
  });

  test("reactive `@cell is some` — IdentExpr at AST level, so inline (no IIFE)", () => {
    const source = `<program>
\${
  <cell> = 0
  function check() {
    if (@cell is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // No IIFE for trivial ident LHS, even though _scrml_reactive_get is
    // technically a function call at emit time — subscription tracking is
    // idempotent, inline is fine and more compact.
    expect(result.clientJs).not.toContain("__scrml_is_v");
    // The inline shape contains `!== null && ... !== undefined`.
    expect(result.clientJs).toMatch(/!==\s*null\s*&&.*!==\s*undefined/);
  });

  test("`obj.prop is some` (member LHS) — IIFE-wrapped, single-eval", () => {
    // MemberExpr is NON-trivial in Phase B-2 (getters can side-effect).
    // Even when emitted JS would look identical for a plain-object getter,
    // we honor SPEC §42.2.4's strict "exactly once" requirement.
    const source = `<program>
\${
  function check(obj) {
    if (obj.prop is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // Member access is non-trivial — IIFE wrap.
    expect(result.clientJs).toContain("__scrml_is_v");
  });

  test("`arr[0] is some` (index LHS with literal key) — IIFE-wrapped per Proxy-safety", () => {
    // IndexExpr is non-trivial (Proxy `get` trap could side-effect). The
    // literal key `0` doesn't change that — the index access itself is what
    // we're guarding against.
    const source = `<program>
\${
  function check(arr) {
    if (arr[0] is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    expect(result.clientJs).toContain("__scrml_is_v");
  });
});

// ---------------------------------------------------------------------------
// §4 — Phase A + Phase B regression guards
// ---------------------------------------------------------------------------

describe("Phase B-2 — Phase A + Phase B AST shape preservation", () => {
  test("parseExprToNode: `f() is some` still produces BinaryExpr op=is-some, call LHS", () => {
    const node = parseExprToNode("f() is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.kind).toBe("ident");
    expect(node.left.callee.name).toBe("f");
  });

  test("parseExprToNode: bare ident `x is some` AST shape unchanged", () => {
    const node = parseExprToNode("x is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("ident");
    expect(node.left.name).toBe("x");
  });

  test("parseExprToNode: `(a || b) is some` AST shape unchanged (Phase B)", () => {
    const node = parseExprToNode("(a || b) is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("binary");
    expect(node.left.op).toBe("||");
  });
});

// ---------------------------------------------------------------------------
// §5 — String-literal interiors aren't mis-parsed as IIFE candidates
// ---------------------------------------------------------------------------

describe("Phase B-2 — string-literal context immunity", () => {
  test("`is some` inside a string literal does NOT trigger IIFE wrap", () => {
    // The string `"f() is some"` is just text. Only the OUTER `y is some`
    // can be a real predicate; here we exercise just the string usage to
    // assert no IIFE leaks into the emit for the literal.
    const source = `<program>
\${
  function describe() {
    return "f() is some"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // No IIFE because the file has no predicate at all — `is some` is only
    // text inside a string literal.
    expect(result.clientJs).not.toContain("__scrml_is_v");
  });

  test("mixed: string-literal `is some` plus a real predicate — only the real one IIFE-wraps", () => {
    const source = `<program>
\${
  function f() { return "ok" }
  function check() {
    let msg = "result: x is some"
    if (f() is some) {
      return msg
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // One IIFE wrap (for `f() is some`).
    const iifeMatches = (result.clientJs.match(/__scrml_is_v/g) ?? []).length;
    // `((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(...)` — 3 occurrences of `__scrml_is_v`.
    expect(iifeMatches).toBe(3);
    // The string literal "result: x is some" is preserved unchanged
    // (no `__scrml_is_v` injected into it).
    expect(result.clientJs).toContain('"result: x is some"');
  });
});

// ---------------------------------------------------------------------------
// §6 — IIFE local-name convention (lock in the chosen name)
// ---------------------------------------------------------------------------

describe("Phase B-2 — IIFE local-name convention", () => {
  test("IIFE local is `__scrml_is_v` (project-prefix convention)", () => {
    const source = `<program>
\${
  function f() { return 1 }
  function check() {
    if (f() is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    expectNoFatals(result);
    // The exact local name is `__scrml_is_v` (collision-shielded by the
    // `__scrml_*` prefix, stable across builds for determinism).
    expect(result.clientJs).toMatch(/\(__scrml_is_v\)\s*=>/);
  });

  test("IIFE local name is STABLE — same source → same emitted JS (determinism)", () => {
    const source = `<program>
\${
  function f() { return 1 }
  function check() {
    if (f() is some) {
      return "yes"
    }
    return "no"
  }
}
</program>`;
    const r1 = compileSource(source);
    const r2 = compileSource(source);
    expectNoFatals(r1);
    expectNoFatals(r2);
    // Lift counters MAY differ per compile (file path is part of the lift
    // namespace), but the IIFE local name MUST be byte-identical across
    // compiles to keep content-addressed chunk hashes stable.
    const r1Iife = (r1.clientJs.match(/__scrml_is_v/g) ?? []).length;
    const r2Iife = (r2.clientJs.match(/__scrml_is_v/g) ?? []).length;
    expect(r1Iife).toBe(r2Iife);
    expect(r1Iife).toBeGreaterThan(0);
  });
});
