/**
 * Parse reset-keyword — Phase A1a Step 9
 *
 * Step 9 — wire the parser side of `reset(@cell)`. The `reset` keyword was
 * reserved at lex time in Step 1 (`tokenizer.ts:70`). Step 8 added the
 * E-RESERVED-IDENTIFIER decl-site shadow check. Step 9 lifts the
 * expression-position `reset(<expr>)` form into a structurally-distinct
 * `reset-expr` AST node (per AST-CONTRACTS §1.3).
 *
 * **Scope:** parser-only.
 *   - Step 9 emits `kind: "reset-expr"` with `target: ExprNode` and `span`.
 *   - Step 9 emits `E-RESET-NO-ARG` (§34) for zero-arg, multi-arg, and
 *     spread-arg forms (single error code reused with arity-specific message;
 *     see Step 9 progress.md §survey-spec for rationale).
 *   - Step 9 does NOT validate target shape (`@cell` vs arbitrary expression).
 *     A1b owns target validation (E-RESET-INVALID-TARGET family).
 *   - Step 9 does NOT lower codegen. A1c will replace the conservative
 *     `reset(<target>)` emit with the proper runtime call wired to `default=`.
 *
 * **Spec authority:**
 *   §6.8.2 — `reset(@cell)` keyword + γ semantics, supersedes earlier L10
 *            `reset()` form (per L18).
 *   §34    — E-RESET-NO-ARG ("reset() called with no argument; the reset
 *            keyword requires an explicit cell argument").
 *   §AST-CONTRACTS-AND-DECOMPOSITION §1.3 — `reset-expr` AST shape.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function findKind(ast, target) {
  const out = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.kind === target) out.push(n);
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return out;
}

function hasErrorCode(errors, code) {
  return (errors || []).some((e) => e?.code === code);
}

function getErrorByCode(errors, code) {
  return (errors || []).find((e) => e?.code === code);
}

describe("A1a Step 9 — `reset(@cell)` keyword expression parsing", () => {
  // ---------------------------------------------------------------------------
  // §R9.1 — positive: simple cell target
  // ---------------------------------------------------------------------------
  test("§R9.1 `reset(@count)` parses to reset-expr with @count target", () => {
    const src = `<program>\${ reset(@count) }</program>`;
    const { ast, errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(false);
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(1);
    const r = resets[0];
    expect(r.kind).toBe("reset-expr");
    expect(r.target).toBeTruthy();
    expect(r.target.kind).toBe("ident");
    expect(r.target.name).toBe("@count");
    // Happy path: no diagnostic attached.
    expect(r.diagnostic).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // §R9.2 — positive: compound field target
  // ---------------------------------------------------------------------------
  test("§R9.2 `reset(@form.email)` parses with MemberExpr target", () => {
    const src = `<program>\${ reset(@form.email) }</program>`;
    const { ast, errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(false);
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(1);
    const r = resets[0];
    expect(r.target.kind).toBe("member");
    expect(r.target.object.kind).toBe("ident");
    expect(r.target.object.name).toBe("@form");
    expect(r.target.property).toBe("email");
  });

  // ---------------------------------------------------------------------------
  // §R9.3 — negative: zero-arg fires E-RESET-NO-ARG
  // ---------------------------------------------------------------------------
  test("§R9.3 `reset()` fires E-RESET-NO-ARG with zero-arg message", () => {
    const src = `<program>\${ reset() }</program>`;
    const { ast, errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(true);
    const err = getErrorByCode(errors, "E-RESET-NO-ARG");
    expect(err).toBeTruthy();
    // Message variant: zero-arg form
    expect(err.message).toMatch(/called with no argument/);
    // The reset-expr node is still produced (parse continues), with a
    // synthesized undefined target.
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(1);
    expect(resets[0].diagnostic).toBeTruthy();
    expect(resets[0].diagnostic.code).toBe("E-RESET-NO-ARG");
    expect(resets[0].target.kind).toBe("lit");
    expect(resets[0].target.litType).toBe("undefined");
  });

  // ---------------------------------------------------------------------------
  // §R9.4 — negative: multi-arg fires E-RESET-NO-ARG (reused code)
  // ---------------------------------------------------------------------------
  test("§R9.4 `reset(@a, @b)` fires E-RESET-NO-ARG with arity message", () => {
    const src = `<program>\${ reset(@a, @b) }</program>`;
    const { ast, errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(true);
    const err = getErrorByCode(errors, "E-RESET-NO-ARG");
    // Message variant: multi-arg form
    expect(err.message).toMatch(/expected exactly one argument, got 2/);
    // The reset-expr node carries the first arg as target so A1b can still
    // reason about target shape (best-effort partial parse).
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(1);
    expect(resets[0].target.kind).toBe("ident");
    expect(resets[0].target.name).toBe("@a");
    expect(resets[0].diagnostic).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // §R9.5 — regression: Step 8 E-RESERVED-IDENTIFIER on bare `function reset`
  //          must still fire (Step 9 must not regress decl-site shadow check).
  // ---------------------------------------------------------------------------
  test("§R9.5 Step 8 regression — `function reset() {}` still fires E-RESERVED-IDENTIFIER", () => {
    const src = `<program>\${ function reset() {} }</program>`;
    const { errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESERVED-IDENTIFIER")).toBe(true);
    // Independent of Step 9: no E-RESET-NO-ARG should fire on the decl shape
    // (the `reset(...)` here is a function-decl signature, not an expression
    // call).
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // §R9.6 — positive: ANY ExprNode target accepted at parse time. A1b will
  //          later reject non-canonical shapes (E-RESET-INVALID-TARGET).
  // ---------------------------------------------------------------------------
  test("§R9.6 `reset(@count + 1)` parses clean (target shape deferred to A1b)", () => {
    const src = `<program>\${ reset(@count + 1) }</program>`;
    const { ast, errors } = parse(src);
    // Step 9 does NOT validate target shape — should NOT fire E-RESET-NO-ARG
    // or any other reset-related error.
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(false);
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(1);
    expect(resets[0].diagnostic).toBeUndefined();
    // Target is a BinaryExpr — that's fine at parse time.
    expect(resets[0].target.kind).toBe("binary");
    expect(resets[0].target.op).toBe("+");
  });

  // ---------------------------------------------------------------------------
  // §R9.7 — regression: member-call `obj.reset(x)` is NOT lifted to reset-expr.
  //          Member calls are ordinary method calls on user objects (e.g.
  //          rate-limiters in the stdlib). Only bare-Identifier `reset` calls
  //          are language-level.
  // ---------------------------------------------------------------------------
  test("§R9.7 `limiter.reset(\"key\")` stays a regular call (not lifted)", () => {
    const src = `<program>\${ limiter.reset("key") }</program>`;
    const { ast, errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(false);
    // No reset-expr should be produced — the call is still kind "call" with
    // a MemberExpr callee.
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(0);
    // Confirm the regular call is still present.
    const calls = findKind(ast, "call");
    const memberCalls = calls.filter((c) => c.callee?.kind === "member");
    expect(memberCalls.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // §R9.8 — positive: compound-only reset `reset(@form)` (the §6.8.2 third
  //          shape — reset every field of a compound). Parser still produces
  //          a reset-expr; target is a bare ident.
  // ---------------------------------------------------------------------------
  test("§R9.8 `reset(@form)` (compound-whole) parses to reset-expr with bare ident target", () => {
    const src = `<program>\${ reset(@form) }</program>`;
    const { ast, errors } = parse(src);
    expect(hasErrorCode(errors, "E-RESET-NO-ARG")).toBe(false);
    const resets = findKind(ast, "reset-expr");
    expect(resets.length).toBe(1);
    expect(resets[0].target.kind).toBe("ident");
    expect(resets[0].target.name).toBe("@form");
    expect(resets[0].diagnostic).toBeUndefined();
  });
});
