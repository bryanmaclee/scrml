/**
 * A4 regression (S99) — `is some` / `is given` / `is not` operator parser-coupling
 * must preserve member-access LHS so the TS scope walker does not fire
 * E-SCOPE-001 on the property name.
 *
 * Provenance:
 *   Bug brief (S99 A4) — examples/23-trucking-dispatch/components/invoice-card.scrml
 *   L15/L16 fire E-SCOPE-001 on `paid_at` / `due_at` because the preprocessor in
 *   `compiler/src/expression-parser.ts:preprocessForAcorn` ran with an LHS
 *   pattern (`[A-Za-z_$@][A-Za-z0-9_$.]*`) that allowed `.` inside its char
 *   class but NOT whitespace around the `.`.
 *
 *   The collectExpr → joinWithNewlines path produces space-tokenized strings:
 *   `inv.paid_at is some` arrives at the preprocessor as `inv . paid_at is some`,
 *   so the regex matched only the trailing `paid_at` segment and emitted the
 *   inverted shape `inv . __scrml_is_some__(paid_at)`. Downstream the AST
 *   surfaced as `inv.__scrml_is_some__(paid_at)` — a member-call where the
 *   property name is a free-ident call argument. TS's scope walker then fired
 *   E-SCOPE-001 on `paid_at` as if it were an undeclared identifier.
 *
 *   Fix: widen the LHS pattern to allow whitespace-tolerant member-access
 *   tails (and bracketed index / call-paren tails) per §42.2.4. Concretely,
 *   the new shared `LHS_IDENT_CHAIN` constant captures the full chain so the
 *   regex emits `__scrml_is_some__(inv . paid_at)` and acorn produces a clean
 *   `BinaryExpr { op: "is-some", left: MemberExpr(inv, paid_at), … }`.
 *
 * What this test locks in:
 *   - Bare ident `is some`        (baseline)
 *   - Member-access  `obj.prop is some`
 *   - Whitespace-tokenized form   (`obj . prop is some`)  — the actual breakage
 *   - `is not` variant            on member-access
 *   - `is given` alias            on member-access (§42.2 / OQ-9)
 *   - Reactive sigil `@cell.member is some`
 *   - Chained call tail           `obj.method().prop is some`
 *   - Index-access tail           `arr[0] is some`
 *   - Parenthesized compound      `(expr) is some` — must still route through
 *                                 the paren-form rule per §42.2.4 Phase A.
 *   - And critically: no E-SCOPE-001 is fired on the property name of any
 *     member-access shape that compiles cleanly under the new pattern.
 *
 * Failure mode this test catches (write-test-always rule, pa.md feedback):
 *   - preprocessForAcorn regresses to a pattern that drops whitespace around
 *     dots, restoring the inverted-receiver emission.
 *   - A regex-ordering reshuffle breaks the paren-form fall-through.
 *   - The TS scope walker starts looking up member-access property names
 *     (the bug also fires if `forEachIdentInExprNode` recurses into
 *     MemberExpr.property — currently only walks .object).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Compile a one-file scrml source and return the result. Cleans up its tmp dir
 * even on failure.
 */
function compileSource(scrmlSource) {
  const tag = `is-some-member-access-${++tmpCounter}`;
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
    return result;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// §1 — parseExprToNode unit tests (raw expression-parser surface)
// ---------------------------------------------------------------------------

describe("A4 is-some member-access — parseExprToNode unit-level", () => {
  test("bare ident `x is some` produces BinaryExpr op:is-some with IdentExpr LHS", () => {
    const node = parseExprToNode("x is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("ident");
    expect(node.left.name).toBe("x");
  });

  test("member access `obj.prop is some` produces BinaryExpr with MemberExpr LHS (no-whitespace form)", () => {
    const node = parseExprToNode("obj.prop is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.kind).toBe("ident");
    expect(node.left.object.name).toBe("obj");
    expect(node.left.property).toBe("prop");
  });

  test("member access `obj . prop is some` preserves LHS (whitespace-tokenized form — the trucking-dispatch breakage)", () => {
    // This is the exact shape that joinWithNewlines produces for `obj.prop is some`.
    const node = parseExprToNode("obj . prop is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.kind).toBe("ident");
    expect(node.left.object.name).toBe("obj");
    expect(node.left.property).toBe("prop");
    // Critically: ensure it is NOT a member-call shape (the pre-fix bug)
    expect(node.left.kind).not.toBe("call");
  });

  test("`is given` alias (§42.2 OQ-9) on member access produces the same shape as `is some`", () => {
    const node = parseExprToNode("inv . paid_at is given", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.property).toBe("paid_at");
  });

  test("`is not` (negation) on member access preserves LHS — same parser-coupling site", () => {
    const node = parseExprToNode("inv . paid_at is not", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-not");
    expect(node.left.kind).toBe("member");
    expect(node.left.property).toBe("paid_at");
  });

  test("reactive `@cell.member is some` keeps the @-base in the member chain", () => {
    const node = parseExprToNode("@cell . field is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("member");
    expect(node.left.object.name).toBe("@cell");
    expect(node.left.property).toBe("field");
  });

  test("chained call+member `obj.method().prop is some` keeps the chain on the LHS", () => {
    const node = parseExprToNode("obj.method().prop is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    // LHS should be the full chain ending in `.prop` — a MemberExpr whose
    // object is a CallExpr whose callee is `obj.method`.
    expect(node.left.kind).toBe("member");
    expect(node.left.property).toBe("prop");
    expect(node.left.object.kind).toBe("call");
  });

  test("index access `arr[0] is some` keeps the IndexExpr on the LHS", () => {
    const node = parseExprToNode("arr[0] is some", "/t.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("is-some");
    expect(node.left.kind).toBe("index");
    expect(node.left.object.kind).toBe("ident");
    expect(node.left.object.name).toBe("arr");
  });

  test("compound `inv.paid_at is some && inv.paid_at != \"\"` produces nested binary with both LHS sides intact", () => {
    // Test the EXACT shape from invoice-card.scrml L15, plus its whitespace-
    // tokenized form (what collectIfCondition produces).
    for (const src of [
      `inv.paid_at is some && inv.paid_at != ""`,
      `inv . paid_at is some && inv . paid_at != ""`,
      `( inv . paid_at is some && inv . paid_at != "" )`,
    ]) {
      const node = parseExprToNode(src, "/t.scrml", 0);
      expect(node.kind).toBe("binary");
      expect(node.op).toBe("&&");
      expect(node.left.kind).toBe("binary");
      expect(node.left.op).toBe("is-some");
      expect(node.left.left.kind).toBe("member");
      expect(node.left.left.property).toBe("paid_at");
    }
  });

  test("parenthesized compound `(getUser(id)) is some` falls through to the paren-form rule (Phase A path)", () => {
    // Per SPEC §42.2.4 the paren-form is the supported shape for nested-paren
    // compounds. Our widened regex matches only non-nested tails, so this
    // expression routes through the existing `\(([^)]+)\)` rule.
    const node = parseExprToNode("(getUser(id)) is some", "/t.scrml", 0);
    // The exact AST kind is implementation-defined (it may be an escape-hatch
    // or a binary with a call on the LHS depending on how the un-mask resolves).
    // What we lock in: NO call node has `__scrml_is_some__` as a member name
    // (i.e., the inversion bug specifically did NOT happen here).
    const json = JSON.stringify(node);
    expect(json).not.toContain('"property":"__scrml_is_some__"');
  });
});

// ---------------------------------------------------------------------------
// §2 — End-to-end compile: E-SCOPE-001 must NOT fire on member-access property
// ---------------------------------------------------------------------------

describe("A4 is-some member-access — no E-SCOPE-001 on property name", () => {
  test("invoice-card-style: `inv.paid_at is some` inside if-condition does not fire E-SCOPE-001 on `paid_at`", () => {
    const source = `\${
      export fn invoiceStatus(inv: any, todayIso: string) -> string {
        if (inv.paid_at is some && inv.paid_at != "") return "paid"
        if (inv.due_at is some && inv.due_at != "" && inv.due_at < todayIso) return "overdue"
        return "outstanding"
      }
    }`;
    const result = compileSource(source);
    const scopeErrors = (result.errors ?? []).filter((e) => e.code === "E-SCOPE-001");
    // Pin to the exact bug shape: ZERO E-SCOPE-001 on paid_at or due_at.
    const paidAtFires = scopeErrors.filter((e) => e.message.includes("`paid_at`"));
    const dueAtFires  = scopeErrors.filter((e) => e.message.includes("`due_at`"));
    expect(paidAtFires).toEqual([]);
    expect(dueAtFires).toEqual([]);
  });

  test("`is given` alias does not fire E-SCOPE-001 on member-access property", () => {
    const source = `\${
      export fn check(obj: any) -> boolean {
        if (obj.field is given) return true
        return false
      }
    }`;
    const result = compileSource(source);
    const scopeErrors = (result.errors ?? []).filter((e) => e.code === "E-SCOPE-001");
    const fieldFires = scopeErrors.filter((e) => e.message.includes("`field`"));
    expect(fieldFires).toEqual([]);
  });

  test("`is not` (negation) does not fire E-SCOPE-001 on member-access property", () => {
    const source = `\${
      export fn check(obj: any) -> boolean {
        if (obj.field is not) return false
        return true
      }
    }`;
    const result = compileSource(source);
    const scopeErrors = (result.errors ?? []).filter((e) => e.code === "E-SCOPE-001");
    const fieldFires = scopeErrors.filter((e) => e.message.includes("`field`"));
    expect(fieldFires).toEqual([]);
  });
});
