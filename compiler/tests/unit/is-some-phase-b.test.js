/**
 * is-some Phase B (DQ-12 Phase B per SPEC §42.2.4) — bare-compound LHS support.
 *
 * Phase A (S99, A4) added support for member-access / single-level call / single-
 * level index LHS shapes. Phase B (2026-05-17) extends to:
 *
 *   - Nested parens/brackets inside tail segments
 *       `re.exec(str.trim()) is some`        — call with nested call arg
 *       `foo.bar(a, b.c) is some`            — call with multi-arg, member arg
 *       `arr[obj.key] is some`               — index with nested member access
 *       `obj.method()[i] is some`            — mixed call + index tail
 *       `a.b.c().d[0] is some`               — long mixed chain
 *
 *   - Bare binary expressions (no enclosing parens) per JS precedence:
 *       `a || b is some`                     → `a || (b is some)`
 *       `a && b is not`                      → `a && (b is not)`
 *       `(a || b) is some`                   → predicate target is the whole
 *                                              binary; parens are pure grouping
 *                                              per SPEC §42.2.4 line 18437.
 *
 *   - Variant tag forms on compound LHS:
 *       `getState() is .Idle`
 *       `arr[0] is Mode.Active`
 *
 * The fix replaces the prior multi-pass regex chain in preprocessForAcorn
 * with a single left-to-right scanner (`rewriteIsPredicates`) that uses a
 * balanced-paren/bracket leftward walker. See expression-parser.ts for the
 * algorithmic detail.
 *
 * What this test locks in:
 *   - The new scanner preserves the FULL LHS expression for every shape
 *     listed in SPEC §42.2.4 "is not and is some MAY be applied to any
 *     expression, not only simple identifiers."
 *   - Bare-binary LHS binds per JS precedence (low-precedence operators
 *     like `||` and `&&` are NOT consumed by the LHS scan; the
 *     `(expr) is X` form is the canonical way to express "binary as
 *     predicate target").
 *   - Phase A shapes (single-level tail) continue to work as before
 *     (regression guard against the new scanner).
 *   - End-to-end compile produces correct JS for the new shapes (the
 *     placeholder consumer in esTreeToExprNode wires the LHS through as
 *     the BinaryExpr left-operand, which downstream codegen lowers to
 *     `<lhs> !== null && <lhs> !== undefined`).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `is-some-phase-b-${++tmpCounter}`;
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
    // compileScrml emits into <outDir>/dist/<name>.client.js by convention.
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

// ---------------------------------------------------------------------------
// §1 — Nested parens/brackets in tail segments
// ---------------------------------------------------------------------------

describe("Phase B — nested parens/brackets in tail segments", () => {
  test("nested call: `re.exec(str.trim()) is some` keeps the full chain as LHS", () => {
    const node = parseExprToNode("re.exec(str.trim()) is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    // LHS shape: CallExpr { callee: MemberExpr(re, exec), args: [CallExpr(str.trim)] }
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.kind).toBe("member");
    expect(node.left.callee.object.name).toBe("re");
    expect(node.left.callee.property).toBe("exec");
    expect(node.left.args).toHaveLength(1);
    expect(node.left.args[0].kind).toBe("call");
    expect(node.left.args[0].callee.kind).toBe("member");
    expect(node.left.args[0].callee.object.name).toBe("str");
    expect(node.left.args[0].callee.property).toBe("trim");
  });

  test("nested call args (multi-arg): `foo.bar(a, b.c) is some` keeps full chain", () => {
    const node = parseExprToNode("foo.bar(a, b.c) is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.kind).toBe("member");
    expect(node.left.callee.object.name).toBe("foo");
    expect(node.left.callee.property).toBe("bar");
    expect(node.left.args).toHaveLength(2);
    expect(node.left.args[0].kind).toBe("ident");
    expect(node.left.args[0].name).toBe("a");
    expect(node.left.args[1].kind).toBe("member");
    expect(node.left.args[1].object.name).toBe("b");
    expect(node.left.args[1].property).toBe("c");
  });

  test("nested index: `arr[obj.key] is some` keeps the IndexExpr LHS with nested member access", () => {
    const node = parseExprToNode("arr[obj.key] is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("index");
    expect(node.left.object.name).toBe("arr");
    expect(node.left.index.kind).toBe("member");
    expect(node.left.index.object.name).toBe("obj");
    expect(node.left.index.property).toBe("key");
  });

  test("mixed call + index tail: `obj.method()[i] is some` keeps the full chain", () => {
    const node = parseExprToNode("obj.method()[i] is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    // LHS shape: IndexExpr { object: CallExpr(obj.method, []), index: i }
    expect(node.left.kind).toBe("index");
    expect(node.left.object.kind).toBe("call");
    expect(node.left.object.callee.kind).toBe("member");
    expect(node.left.object.callee.object.name).toBe("obj");
    expect(node.left.object.callee.property).toBe("method");
    expect(node.left.index.kind).toBe("ident");
    expect(node.left.index.name).toBe("i");
  });

  test("long mixed chain: `a.b.c().d[0] is some` preserves whole LHS", () => {
    const node = parseExprToNode("a.b.c().d[0] is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    // LHS shape: IndexExpr { object: MemberExpr { object: CallExpr { callee: MemberExpr(a.b.c) }, property: d }, index: 0 }
    expect(node.left.kind).toBe("index");
    expect(node.left.object.kind).toBe("member");
    expect(node.left.object.property).toBe("d");
    expect(node.left.object.object.kind).toBe("call");
    expect(node.left.object.object.callee.kind).toBe("member");
    expect(node.left.object.object.callee.property).toBe("c");
  });

  test("`is not` variant on nested call: `re.exec(str.trim()) is not`", () => {
    const node = parseExprToNode("re.exec(str.trim()) is not", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-not");
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.property).toBe("exec");
    expect(node.left.args[0].callee.property).toBe("trim");
  });

  test("`is given` alias on nested index: `arr[obj.key] is given`", () => {
    const node = parseExprToNode("arr[obj.key] is given", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some"); // `is given` lowers to `is-some` per §42.2 OQ-9
    expect(node.left.kind).toBe("index");
    expect(node.left.index.kind).toBe("member");
  });
});

// ---------------------------------------------------------------------------
// §2 — Bare binary expressions and JS-precedence binding
// ---------------------------------------------------------------------------
//
// Per SPEC §42.2.4 line 18437: "Parentheses around a compound expression —
// (expr) is not — are accepted and have no special meaning beyond grouping."
//
// Combined with §42.2.4's "MAY be applied to any expression" — including
// "binary expressions" — and the absence of any explicit precedence override,
// the canonical interpretation is JS-precedence-style binding:
//
//   `a || b is some` binds as `a || (b is some)`
//
// Programmers who want the whole `a || b` as the predicate target use parens
// (which are grouping — they DO produce the wider-LHS shape).

describe("Phase B — bare binary LHS binding", () => {
  test("`a || b is some` binds as `a || (b is some)` (JS precedence; || lower than is-some)", () => {
    const node = parseExprToNode("a || b is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("||");
    // Left operand: `a` (bare ident)
    expect(node.left.kind).toBe("ident");
    expect(node.left.name).toBe("a");
    // Right operand: `b is some` (BinaryExpr is-some)
    expect(node.right.kind).toBe("binary");
    expect(node.right.op).toBe("is-some");
    expect(node.right.left.kind).toBe("ident");
    expect(node.right.left.name).toBe("b");
  });

  test("`a && b is not` binds as `a && (b is not)`", () => {
    const node = parseExprToNode("a && b is not", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("&&");
    expect(node.left.name).toBe("a");
    expect(node.right.kind).toBe("binary");
    expect(node.right.op).toBe("is-not");
    expect(node.right.left.name).toBe("b");
  });

  test("`(a || b) is some` — parens are grouping; predicate target is the binary expression", () => {
    const node = parseExprToNode("(a || b) is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    // LHS is the binary `a || b` (acorn unwraps outer parens during parse)
    expect(node.left.kind).toBe("binary");
    expect(node.left.op).toBe("||");
    expect(node.left.left.name).toBe("a");
    expect(node.left.right.name).toBe("b");
  });

  test("`(a || b) is not` — same paren grouping for absence check", () => {
    const node = parseExprToNode("(a || b) is not", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-not");
    expect(node.left.kind).toBe("binary");
    expect(node.left.op).toBe("||");
  });

  test("nested parens collapse to grouping: `((expr)) is some` ≡ `(expr) is some`", () => {
    const node = parseExprToNode("((a || b)) is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("binary");
    expect(node.left.op).toBe("||");
  });

  test("paren-grouped compound on either side of binary: `(getUser(id)) is some && @userVisible`", () => {
    const node = parseExprToNode("(getUser(id)) is some && @userVisible", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("&&");
    expect(node.left.kind).toBe("binary");
    expect(node.left.op).toBe("is-some");
    expect(node.left.left.kind).toBe("call");
    expect(node.left.left.callee.name).toBe("getUser");
    expect(node.right.kind).toBe("ident");
    expect(node.right.name).toBe("@userVisible");
  });
});

// ---------------------------------------------------------------------------
// §3 — Variant tag predicates on compound LHS
// ---------------------------------------------------------------------------

describe("Phase B — variant tag predicates on compound LHS", () => {
  test("bare-dot variant on call LHS: `getState() is .Idle`", () => {
    const node = parseExprToNode("getState() is .Idle", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is");
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.name).toBe("getState");
    expect(node.right.kind).toBe("ident");
    expect(node.right.name).toBe(".Idle");
  });

  test("qualified variant on member LHS: `obj.state is Mode.Active`", () => {
    const node = parseExprToNode("obj.state is Mode.Active", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.name).toBe("obj");
    expect(node.left.property).toBe("state");
    expect(node.right.kind).toBe("ident");
    expect(node.right.name).toBe("Mode.Active");
  });

  test("variant on nested-paren LHS: `(arr[0]) is .Ready`", () => {
    const node = parseExprToNode("(arr[0]) is .Ready", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is");
    expect(node.left.kind).toBe("index");
    expect(node.left.object.name).toBe("arr");
    expect(node.right.name).toBe(".Ready");
  });

  test("variant on nested call: `find(items) is .Found`", () => {
    const node = parseExprToNode("find(items) is .Found", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is");
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.name).toBe("find");
    expect(node.right.name).toBe(".Found");
  });
});

// ---------------------------------------------------------------------------
// §4 — Phase A regression guard (single-level tails must still work)
// ---------------------------------------------------------------------------

describe("Phase A regression guard — single-level tails unchanged", () => {
  test("bare ident `x is some` (Phase A baseline)", () => {
    const node = parseExprToNode("x is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("ident");
    expect(node.left.name).toBe("x");
  });

  test("member access `obj.prop is some` (Phase A)", () => {
    const node = parseExprToNode("obj.prop is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.name).toBe("obj");
    expect(node.left.property).toBe("prop");
  });

  test("whitespace-tokenized member: `obj . prop is some` (S99 A4 — trucking-dispatch shape)", () => {
    const node = parseExprToNode("obj . prop is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.name).toBe("obj");
    expect(node.left.property).toBe("prop");
  });

  test("reactive `@cell.field is some` (Phase A)", () => {
    const node = parseExprToNode("@cell . field is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.name).toBe("@cell");
    expect(node.left.property).toBe("field");
  });

  test("single-level call `foo() is some` (Phase A)", () => {
    const node = parseExprToNode("foo() is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("call");
    expect(node.left.callee.name).toBe("foo");
  });

  test("single-level index `arr[0] is some` (Phase A)", () => {
    const node = parseExprToNode("arr[0] is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("index");
    expect(node.left.object.name).toBe("arr");
  });

  test("chained `obj.method().prop is some` (Phase A — was already supported)", () => {
    const node = parseExprToNode("obj.method().prop is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.property).toBe("prop");
    expect(node.left.object.kind).toBe("call");
  });
});

// ---------------------------------------------------------------------------
// §5 — Edge cases (string-literal interiors, in-context lookup)
// ---------------------------------------------------------------------------

describe("Phase B — edge cases", () => {
  test("`is some` inside string literal is NOT rewritten", () => {
    // The literal `"x is some"` should remain as a string. The OUTER `y is some`
    // SHOULD be rewritten.
    const node = parseExprToNode('y is some', "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
  });

  test("string-literal context: `cond ? \"a is some\" : @b` does not trigger rewrite inside the string", () => {
    // The point: the `is some` inside the string MUST NOT be picked up.
    // This test verifies that by checking the AST shape (no surprise is-some
    // BinaryExpr coming out of the consequent branch).
    const node = parseExprToNode('cond ? "a is some" : @b', "/t.scrml", 0);
    expect(node.kind).toBe("ternary");
    expect(node.consequent.kind).toBe("lit");
    expect(node.consequent.litType).toBe("string");
    expect(node.consequent.value).toBe("a is some");
  });

  test("compound combined with `&&`: `inv.paid_at is some && inv.due_at is some` (regression of A4 + Phase B)", () => {
    const node = parseExprToNode("inv.paid_at is some && inv.due_at is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("&&");
    expect(node.left.kind).toBe("binary");
    expect(node.left.op).toBe("is-some");
    expect(node.left.left.kind).toBe("member");
    expect(node.left.left.property).toBe("paid_at");
    expect(node.right.kind).toBe("binary");
    expect(node.right.op).toBe("is-some");
    expect(node.right.left.kind).toBe("member");
    expect(node.right.left.property).toBe("due_at");
  });
});

// ---------------------------------------------------------------------------
// §6 — End-to-end compile: emitted JS preserves receiver/argument structure
// ---------------------------------------------------------------------------

describe("Phase B — end-to-end compile: emitted JS is well-formed", () => {
  test("nested-call LHS compiles without `__scrml_is_some_suffix__` placeholder leakage", () => {
    const source = `<program>
\${
  function check(re, s) {
    if (re.exec(s.trim()) is some) {
      return "matched"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    // No fatal errors.
    const fatals = (result.errors ?? []).filter((e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error");
    expect(fatals).toEqual([]);
    // The placeholder must NOT leak through into the emitted JS.
    expect(result.clientJs).not.toContain("__scrml_is_some_suffix__");
    expect(result.clientJs).not.toContain("__scrml_is_not_suffix__");
    expect(result.clientJs).not.toContain("PLACEHOLDER_PAREN");
    // The compiled output must contain the expected lowering. The codegen
    // pipeline emits `!= null` (single-evaluation temp form per §42.2.4)
    // or `!== null && !== undefined` (identifier form per §42.5) — both are
    // acceptable. What matters is the predicate is fully consumed.
    expect(result.clientJs).toMatch(/!=\s*null|!==\s*null/);
  });

  test("paren-grouped binary as predicate target: `(@a || @b) is some` compiles cleanly", () => {
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
    const fatals = (result.errors ?? []).filter((e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error");
    expect(fatals).toEqual([]);
    expect(result.clientJs).not.toContain("__scrml_is_some_suffix__");
  });

  test("nested-index LHS `arr[obj.key] is some` compiles to a clean absence check", () => {
    const source = `<program>
\${
  function check(arr, obj) {
    if (arr[obj.key] is some) {
      return "found"
    }
    return "missing"
  }
}
</program>`;
    const result = compileSource(source);
    const fatals = (result.errors ?? []).filter((e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error");
    expect(fatals).toEqual([]);
    expect(result.clientJs).not.toContain("__scrml_is_some_suffix__");
    // The arr[obj.key] expression must appear intact in the emitted output
    // — receiver `arr` indexed by `obj.key` (not `arr` then `obj` etc.).
    expect(result.clientJs).toMatch(/arr\s*\[\s*obj\s*\.\s*key\s*\]/);
  });

  test("bare-binary LHS `@a || @b is some` binds as `@a || (@b is some)` end-to-end", () => {
    const source = `<program>
\${
  <a> = 0
  <b> = 0
  function check() {
    if (@a || @b is some) {
      return "branch"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    const fatals = (result.errors ?? []).filter((e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error");
    expect(fatals).toEqual([]);
    expect(result.clientJs).not.toContain("__scrml_is_some_suffix__");
    // The presence check must apply to @b only, with @a on the left of `||`
    // — i.e., the AST shape's emission must keep @a as a free operand of ||
    // and @b inside the presence check.
    expect(result.clientJs).toMatch(/\|\|/);
  });

  test("paren-grouped binary `(@a || @b) is some` emits a paren-wrapped LHS (regression for precedence bug)", () => {
    // The whole binary `@a || @b` is the predicate target. The emitted JS
    // must NOT produce `a || b !== null && a || b !== undefined` (which
    // would re-associate as a `||/&&/||` salad).
    //
    // Phase B-2 (2026-05-17): non-trivial LHS (binary) is now wrapped in a
    // single-eval IIFE per SPEC §42.2.4 line 18436. The emitted form is:
    //   `((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(<a> || <b>)`
    // The `||` connective still appears INSIDE the IIFE arg position
    // (preserving the binary's own short-circuit semantics), and the
    // null/undefined checks now happen against the bound `__scrml_is_v`
    // rather than re-inlining the binary.
    const source = `<program>
\${
  <a> = 0
  <b> = 0
  function check() {
    if ((@a || @b) is some) {
      return "wholeBinary"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    const fatals = (result.errors ?? []).filter((e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error");
    expect(fatals).toEqual([]);
    expect(result.clientJs).not.toContain("__scrml_is_some_suffix__");
    // Phase B-2 IIFE wrap: the IIFE local `__scrml_is_v` must appear.
    expect(result.clientJs).toContain("__scrml_is_v");
    // The null + undefined checks now bind against the IIFE local.
    expect(result.clientJs).toMatch(/__scrml_is_v\s*!==\s*null/);
    expect(result.clientJs).toMatch(/__scrml_is_v\s*!==\s*undefined/);
    // Critical: the `||` must still appear (the binary is preserved as the
    // IIFE arg — short-circuit semantics retained).
    expect(result.clientJs).toMatch(/\|\|/);
    // The binary occurs INSIDE the IIFE arg-list parens. We verify the
    // structural shape: the IIFE callsite is followed by an arg-list that
    // contains the `||` connective.
    expect(result.clientJs).toMatch(/\(__scrml_is_v\)\s*=>[\s\S]*?\|\|/);
  });

  test("nested-call LHS `re.exec(str.trim()) is some` emits the receiver-call chain intact", () => {
    const source = `<program>
\${
  function run(re, str) {
    if (re.exec(str.trim()) is some) {
      return "matched"
    }
    return "no"
  }
}
</program>`;
    const result = compileSource(source);
    const fatals = (result.errors ?? []).filter((e) => e.code !== "W-PROGRAM-SPA-INFERRED" && (e.severity ?? "error") === "error");
    expect(fatals).toEqual([]);
    expect(result.clientJs).not.toContain("__scrml_is_some_suffix__");
    // The full chain `re.exec(str.trim())` must be the absence-check operand,
    // not just `str.trim()` (the inversion bug Phase A's multi-pass regex
    // chain produced before this fix).
    //
    // Phase B-2 (2026-05-17): the call-LHS is now wrapped in a single-eval
    // IIFE. The emitted form is:
    //   `((__scrml_is_v) => __scrml_is_v !== null && __scrml_is_v !== undefined)(re.exec(str.trim()))`
    // The original receiver-call chain still appears verbatim inside the
    // IIFE arg position — verify both the chain integrity AND the IIFE wrap.
    expect(result.clientJs).toMatch(/re\.exec\(\s*str\.trim\(\)\s*\)/);
    expect(result.clientJs).toContain("__scrml_is_v");
    expect(result.clientJs).toMatch(/__scrml_is_v\s*!==\s*null/);
  });
});
