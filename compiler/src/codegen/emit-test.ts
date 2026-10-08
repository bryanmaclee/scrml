/**
 * @module codegen/emit-test
 *
 * Generates bun:test output from TestGroup[] IR nodes collected from ~{} blocks.
 *
 * Output format:
 *   import { test, expect, describe, beforeEach } from "bun:test";
 *   describe("filename.scrml", () => {
 *     describe("groupName (line N)", () => {
 *       let scopeVar = initValue;
 *       beforeEach(() => { scopeVar = initValue; });
 *       test("caseName", () => {
 *         expect(lhs).toEqual(rhs);
 *       });
 *     });
 *   });
 *
 * Called by the CG orchestrator (index.ts) when testMode is enabled.
 * Returns null when no test groups exist (no ~{} blocks in source file).
 *
 * Assert compilation table:
 *   assert expr       → expect(expr).toBeTruthy()
 *   assert a == b     → expect(a).toEqual(b)
 *   assert a != b     → expect(a).not.toEqual(b)
 *   assert a > b      → expect(a).toBeGreaterThan(b)
 *   assert a >= b     → expect(a).toBeGreaterThanOrEqual(b)
 *   assert a < b      → expect(a).toBeLessThan(b)
 *   assert a <= b     → expect(a).toBeLessThanOrEqual(b)
 */

import { basename } from "path";
import type { TestGroup, TestBindDecl, AssertStmt } from "./ir.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A scope variable snapshot entry for beforeEach resets.
 *
 * Each entry corresponds to a variable declared in the surrounding scrml scope
 * that the test body may read or mutate. Emitted as `let name = initValue;`
 * declarations with a `beforeEach` reset block.
 */
export interface ScopeVarEntry {
  /** JavaScript identifier name (already encoded for the compiled output). */
  name: string;
  /** Initialization expression string (e.g., "0", '""', "false"). */
  initValue: string;
}

// ---------------------------------------------------------------------------
// `test-bind` dispatch helpers (SPEC §19.12.6 / §19.12.7)
// ---------------------------------------------------------------------------

/**
 * Phase A6-4 — Emit a single `test-bind` dispatch binding per SPEC §19.12.7.
 *
 * Per the dispatch contract:
 *   - `bindKind === "handler"` → invoke the binding with the call-site args.
 *     Emit `const ${ident} = ${expression};` (RHS already evaluates to a
 *     callable function value).
 *   - `bindKind === "return-stub"` → ignore call-site args and return the
 *     binding value verbatim. Emit `const ${ident} = (...) => (${expression});`
 *     so call-sites of shape `${ident}(args)` work uniformly.
 *   - `bindKind === undefined` (defensive default per IR comment) →
 *     treat as `"return-stub"`. SYM PASS 18 should always populate this
 *     field; the fallback exists for test harnesses that bypass SYM.
 *
 * The `expression` field is the RAW SOURCE of the RHS as collected by the
 * A6-2 parser. It is emitted verbatim into the test JS — A6-3 has already
 * validated that the RHS is well-formed at the syntactic / scope level.
 */
function emitTestBindDispatch(bind: TestBindDecl, indent: string): string {
  const kind = bind.bindKind ?? "return-stub";
  if (kind === "handler") {
    return `${indent}const ${bind.identifier} = ${bind.expression};`;
  }
  // return-stub form — wrap in an arity-agnostic lambda so call-site
  // shape `name(args)` works while the binding ignores args and returns
  // the value verbatim per §19.12.7.
  return `${indent}const ${bind.identifier} = () => (${bind.expression});`;
}

/**
 * Phase A6-4 — Emit an E-TEST-006 fail-fast thrower stub for a server-fn
 * that lacks a `test-bind` declaration in the enclosing `~{}` block.
 *
 * Per SPEC §19.12.7 #2: "If no `test-bind` declaration for the called
 * server function is in scope, the dispatch SHALL emit error code
 * E-TEST-006 and halt the test execution at that call site. Silent
 * passthrough to the production server-fn call SHALL NOT occur."
 *
 * Implementation: shadow the bare server-fn name with a `const` thrower
 * at the inner describe scope so any `${fnName}(...)` inside any test case
 * of this `~{}` block raises E-TEST-006 immediately. bun:test surfaces
 * thrown errors as test failures, fulfilling "halt the test execution".
 */
function emitTestBindThrowerStub(fnName: string, indent: string): string {
  const msg =
    `E-TEST-006: server function \`${fnName}\` was called inside a ~{} ` +
    `test block but has no \`test-bind\` declaration in scope. ` +
    `Per SPEC §19.12.7, fail-fast over silent passthrough. ` +
    `Add \`test-bind ${fnName} = <stub>\` to the ~{} block.`;
  return `${indent}const ${fnName} = (...args) => { throw new _scrml_g.Error(${JSON.stringify(msg)}); };`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a scrml assert operator to the bun:test expect() method call.
 *
 * @param lhs — left-hand side expression string
 * @param op  — comparison operator from AssertStmt.op
 * @param rhs — right-hand side expression string
 * @returns   — a complete `expect(lhs).method(rhs)` call string
 */
function assertOpToExpect(lhs: string, op: string, rhs: string): string {
  switch (op) {
    case "==":  return `expect(${lhs}).toEqual(${rhs})`;
    case "!=":  return `expect(${lhs}).not.toEqual(${rhs})`;
    case ">":   return `expect(${lhs}).toBeGreaterThan(${rhs})`;
    case ">=":  return `expect(${lhs}).toBeGreaterThanOrEqual(${rhs})`;
    case "<":   return `expect(${lhs}).toBeLessThan(${rhs})`;
    case "<=":  return `expect(${lhs}).toBeLessThanOrEqual(${rhs})`;
    default:    return `expect(${lhs}).toEqual(${rhs})`;
  }
}

/**
 * Emit a single AssertStmt as a bun:test expect() call.
 *
 * @param stmt   — parsed assert statement from parseTestBody
 * @param indent — indentation string to prefix
 * @returns      — one line of JS (without trailing newline)
 */
function emitAssert(stmt: AssertStmt, indent: string): string {
  if (stmt.op !== null && stmt.lhs !== null && stmt.rhs !== null) {
    return `${indent}${assertOpToExpect(stmt.lhs, stmt.op, stmt.rhs)};`;
  }
  // Bare assert: assert expr → expect(expr).toBeTruthy()
  return `${indent}expect(${stmt.raw}).toBeTruthy();`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a bun:test JS file from TestGroup[] IR nodes.
 *
 * Produces a string of JavaScript that can be written as `<base>.test.js`
 * and run directly with `bun test`. The generated file uses describe/test/expect
 * from bun:test and needs no additional dependencies.
 *
 * @param filePath      — source .scrml file path (used for the outer describe label)
 * @param testGroups    — test groups collected from ~{} AST nodes during the analysis pass
 * @param scopeSnapshot — scope variables to declare and reset in beforeEach (optional)
 * @param serverFnNames — same-file server-function names in scope. Phase A6-4
 *                        (SPEC §19.12.7): each name in this set that is NOT
 *                        bound by a `test-bind` declaration in a `~{}` block
 *                        gets shadowed by an `E-TEST-006` thrower stub, so
 *                        unbound server-fn calls inside `~{}` fail-fast over
 *                        silently passing through to the production server-fn
 *                        call. Default `[]` for backward compat.
 * @returns             — JS string, or null if testGroups is empty
 */
export function generateTestJs(
  filePath: string,
  testGroups: TestGroup[],
  scopeSnapshot: ScopeVarEntry[] = [],
  serverFnNames: string[] = [],
): string | null {
  if (testGroups.length === 0) return null;

  const fileName = basename(filePath);
  const lines: string[] = [];

  // Imports — only import what is used
  const needsBeforeEach = testGroups.some(
    (g) => (g.before !== null && g.before.length > 0) || scopeSnapshot.length > 0
  );
  const importParts = ["test", "expect", "describe"];
  if (needsBeforeEach) importParts.push("beforeEach");
  lines.push(`import { ${importParts.join(", ")} } from "bun:test";`);
  lines.push(``);

  // Outer describe block — labelled with the source file name
  lines.push(`describe(${JSON.stringify(fileName)}, () => {`);

  for (const group of testGroups) {
    const groupLabel = group.name
      ? `${group.name} (line ${group.line})`
      : `(line ${group.line})`;

    lines.push(`  describe(${JSON.stringify(groupLabel)}, () => {`);

    // Phase A6-4 (SPEC §19.12.6 / §19.12.7) — `test-bind` dispatch hook.
    //
    // Scope-local to this `~{}` block (per SPEC §19.12.6 "scope-local to
    // the enclosing `~{}` block"). Emitted at the inner describe scope so
    // every `test()` case inside this block sees the bindings.
    //
    // Two flavours of binding:
    //   1. Bound server-fns — emit a `const ${ident} = ...` per `test-bind`
    //      declaration, kind-discriminated by `bindKind` (A6-3 SYM PASS 18).
    //   2. Unbound same-file server-fns — emit a `const ${fnName} = (...) => { throw ... }`
    //      thrower stub so any unbound server-fn call inside this `~{}` fires
    //      E-TEST-006 fail-fast (SPEC §19.12.7 #2).
    //
    // The `const`-shadow approach gives lexical scope-isolation between
    // sibling `~{}` blocks for free: each inner describe declares its own
    // bindings; sibling blocks are independent describe scopes and SHALL NOT
    // see this block's bindings (SPEC §19.12.6 scope contract).
    const testBinds = group.testBinds ?? [];
    const boundNames = new Set(testBinds.map((b) => b.identifier));

    if (testBinds.length > 0 || serverFnNames.length > 0) {
      // Bound test-binds first — order is declaration order (A6-2 parser).
      for (const bind of testBinds) {
        lines.push(emitTestBindDispatch(bind, "    "));
      }
      // Thrower stubs for same-file server-fns NOT bound in this block.
      // Skip any that are already shadowed by a `test-bind` declaration —
      // those would conflict at JS const-binding level.
      for (const fnName of serverFnNames) {
        if (boundNames.has(fnName)) continue;
        lines.push(emitTestBindThrowerStub(fnName, "    "));
      }
    }

    // Scope variable declarations (let) — declared at describe scope for beforeEach access
    for (const v of scopeSnapshot) {
      lines.push(`    let ${v.name} = ${v.initValue};`);
    }

    // beforeEach block — present when scope vars need reset or a before{} block exists
    const hasBeforeEach = scopeSnapshot.length > 0 || (group.before !== null && group.before.length > 0);
    if (hasBeforeEach) {
      lines.push(`    beforeEach(() => {`);
      // Reset scope variables first
      for (const v of scopeSnapshot) {
        lines.push(`      ${v.name} = ${v.initValue};`);
      }
      // Then run before{} statements
      if (group.before !== null) {
        for (const stmt of group.before) {
          if (stmt) lines.push(`      ${stmt}`);
        }
      }
      lines.push(`    });`);
    }

    // Emit each test case
    for (const testCase of group.tests) {
      const caseName = testCase.name || "(anonymous)";
      lines.push(`    test(${JSON.stringify(caseName)}, () => {`);

      // Emit non-assert body statements first (setup code)
      for (const stmt of testCase.body) {
        if (!stmt.startsWith("assert ")) {
          lines.push(`      ${stmt}`);
        }
      }

      // Emit assert statements
      for (const assertStmt of testCase.asserts) {
        lines.push(emitAssert(assertStmt, "      "));
      }

      lines.push(`    });`);
    }

    lines.push(`  });`);
  }

  lines.push(`});`);
  lines.push(``); // trailing newline

  return lines.join("\n");
}
