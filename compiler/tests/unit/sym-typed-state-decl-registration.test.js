/**
 * v024-4 — SYM PASS 1 typed-decl registration.
 *
 * Repro: `<cards>: { id: number, title: string, status: Status }[] = [...]`
 * in `examples/06-kanban-board.scrml` failed to register as a state cell.
 * Root cause: `collectTypeAnnotation()` in `compiler/src/ast-builder.js`
 * tracked only paren depth — the comma INSIDE the object-type braces
 * (`{a:T, b:T}`) was at "depth 0", prematurely terminating type collection.
 * `tryParseStructuralDecl` then saw `,` instead of `=`, restored the cursor,
 * and the construct fell through to `html-fragment`. The decl never
 * surfaced as a `state-decl` AST node, so SYM PASS 1's registration walker
 * had nothing to register.
 *
 * Fix: extend `collectTypeAnnotation` to track brace + bracket depth
 * independently from paren depth; only treat `=` / `,` as terminators
 * when ALL THREE depths are zero. Symbol-table.ts is unchanged — the
 * existing walker handles typed-decls uniformly once they reach it.
 *
 * Coverage (per brief acceptance):
 *
 * §1 — Object-array type:        `<x>: { a: number, b: string }[] = []`
 * §2 — Tuple-array type:         `<x>: [number, string][] = []`
 * §3 — Refinement type:          `<x>: number(>=0, <=100) = 50`
 * §4 — Simple type (regression): `<x>: number = 0`
 * §5 — Custom struct array:      `<cards>: Card[] = []`
 * §6 — Full kanban shape:        `<cards>: { id: number, title: string, status: Status }[] = []`
 *
 * For each: assert
 *   (a) `lookupStateCell(scope, name)` returns a non-null record,
 *   (b) the record's declNode carries `kind: "state-decl"` and a present
 *       `typeAnnotation`,
 *   (c) the file-scope's stateCells map size includes the decl.
 *
 * Plus the broader system slice:
 *   §7 — `@x` reads in markup resolve via B3 (`_resolvedStateCell` annotation).
 *   §8 — Pre-fix html-fragment shape is GONE for these cases.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM, lookupStateCell } from "../../src/symbol-table.ts";

function buildSYM(source) {
  const bs = splitBlocks("test.scrml", source);
  const tab = buildAST(bs);
  const sym = runSYM({ filePath: "test.scrml", ast: tab.ast });
  return { ast: tab.ast, errors: tab.errors, sym };
}

function findStateDecl(ast, name) {
  const seen = new WeakSet();
  let found = null;
  function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (n.kind === "state-decl" && n.name === name) {
      found = n;
      return;
    }
    for (const key of ["nodes", "children", "body", "consequent", "alternate", "arms"]) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(walk);
    }
  }
  walk(ast);
  return found;
}

// Collect every state-decl by walking the file AST tree (not the scope map)
// so we can detect the deceptive-success html-fragment fallback even when
// SYM hasn't been run.
function collectStateDeclKinds(ast) {
  const kinds = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (n.kind === "state-decl") kinds.push({ name: n.name, kind: "state-decl" });
    if (n.kind === "html-fragment") kinds.push({ kind: "html-fragment", content: n.content });
    for (const key of ["nodes", "children", "body", "consequent", "alternate", "arms"]) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(walk);
    }
  }
  walk(ast);
  return kinds;
}

function assertRegistered(source, name, { hasTypeAnnotation = true } = {}) {
  const { ast, sym } = buildSYM(source);
  const fileScope = ast._scope;
  expect(fileScope).toBeDefined();
  const record = lookupStateCell(fileScope, name);
  expect(record).not.toBeNull();
  expect(record).toBeDefined();
  expect(record.declNode).toBeDefined();
  expect(record.declNode.kind).toBe("state-decl");
  expect(record.declNode.name).toBe(name);
  if (hasTypeAnnotation) {
    expect(record.declNode.typeAnnotation).toBeTruthy();
  }
  // No SYM diagnostics blocking registration
  for (const d of sym.errors) {
    // E-NAME-COLLIDES-STATE, E-STATE-PINNED-FORWARD-REF, etc. would surface here
    expect(d.code).not.toMatch(/^E-/);
  }
  return record;
}

describe("v024-4 — SYM PASS 1 typed state-decl registration", () => {

  test("§1 — Object-array type registers (`{ a: number, b: string }[]`)", () => {
    const src = `<program>\n\${\n  <x>: { a: number, b: string }[] = []\n}\n</program>`;
    const record = assertRegistered(src, "x");
    expect(record.declNode.typeAnnotation).toContain("{");
    expect(record.declNode.typeAnnotation).toContain(",");
    expect(record.declNode.typeAnnotation).toContain("[]");
  });

  test("§2 — Tuple-array type registers (`[number, string][]`)", () => {
    const src = `<program>\n\${\n  <x>: [number, string][] = []\n}\n</program>`;
    const record = assertRegistered(src, "x");
    expect(record.declNode.typeAnnotation).toContain("[");
    expect(record.declNode.typeAnnotation).toContain(",");
  });

  test("§3 — Refinement type registers (`number(>=0, <=100)`)", () => {
    const src = `<program>\n\${\n  <x>: number(>=0, <=100) = 50\n}\n</program>`;
    const record = assertRegistered(src, "x");
    expect(record.declNode.typeAnnotation).toContain("number");
    expect(record.declNode.typeAnnotation).toContain("(");
    expect(record.declNode.typeAnnotation).toContain(",");
  });

  test("§4 — Simple type registers — REGRESSION GATE (`number`)", () => {
    const src = `<program>\n\${\n  <x>: number = 0\n}\n</program>`;
    const record = assertRegistered(src, "x");
    expect(record.declNode.typeAnnotation).toContain("number");
  });

  test("§5 — Custom struct array registers (`Card[]` after `type Card:struct`)", () => {
    const src = [
      `<program>`,
      `\${`,
      `  type Card:struct = { id: number, title: string }`,
      `  <cards>: Card[] = []`,
      `}`,
      `</program>`,
    ].join("\n");
    const record = assertRegistered(src, "cards");
    expect(record.declNode.typeAnnotation).toContain("Card");
    expect(record.declNode.typeAnnotation).toContain("[]");
  });

  test("§6 — Full kanban shape registers (the exact 06-kanban-board.scrml form)", () => {
    const src = [
      `<program>`,
      `\${`,
      `  type Status:enum = .Todo | .InProgress | .Done`,
      `  <cards>: { id: number, title: string, status: Status }[] = [`,
      `    { id: 1, title: "Buy milk", status: .Todo },`,
      `  ]`,
      `}`,
      `</program>`,
    ].join("\n");
    const record = assertRegistered(src, "cards");
    expect(record.declNode.typeAnnotation).toContain("id");
    expect(record.declNode.typeAnnotation).toContain("title");
    expect(record.declNode.typeAnnotation).toContain("status");
    expect(record.declNode.typeAnnotation).toContain("Status");
    expect(record.declNode.shape).toBe("plain");
  });

  test("§7 — `@cards` read in markup resolves via B3 (_resolvedStateCell stamped)", () => {
    const src = [
      `<program>`,
      `\${`,
      `  type Status:enum = .Todo | .InProgress | .Done`,
      `  <cards>: { id: number, title: string, status: Status }[] = []`,
      `}`,
      `<div>`,
      `\${`,
      `  for (let c of @cards) {`,
      `    lift <span>\${c.title}</span>`,
      `  }`,
      `}`,
      `</div>`,
      `</program>`,
    ].join("\n");
    const { ast, sym } = buildSYM(src);
    // Find all `@cards` identifier reads and verify each gained
    // `_resolvedStateCell` (B3 PASS 3 annotation). The `@`-form ident has
    // `kind: "ident"` with `name: "@cards"` (sigil preserved on the name).
    let foundResolved = 0;
    const seen = new WeakSet();
    function walk(n) {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (n.kind === "ident" && n.name === "@cards" && n._resolvedStateCell) {
        foundResolved++;
      }
      for (const key of Object.keys(n)) {
        const v = n[key];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    }
    walk(ast);
    // At least one resolved @cards read must exist; B3 stamps every
    // `@`-form IdentExpr it visits.
    expect(foundResolved).toBeGreaterThanOrEqual(1);
  });

  test("§8 — Pre-fix deceptive-success path is gone — no html-fragment swallowing", () => {
    const src = [
      `<program>`,
      `\${`,
      `  <a>: { x: number, y: string }[] = []`,
      `  <b>: { p: boolean }[] = []`,
      `}`,
      `</program>`,
    ].join("\n");
    const { ast } = buildSYM(src);
    const found = collectStateDeclKinds(ast);
    const stateDeclNames = found.filter(f => f.kind === "state-decl").map(f => f.name);
    expect(stateDeclNames).toContain("a");
    expect(stateDeclNames).toContain("b");
    // The pre-fix path produced an html-fragment containing the entire raw
    // text — confirm that none of those leaked through.
    const fragments = found.filter(f => f.kind === "html-fragment");
    for (const f of fragments) {
      expect(f.content ?? "").not.toContain("<a>");
      expect(f.content ?? "").not.toContain("<b>");
    }
  });

  test("§9 — Multi-typed decl mix still classifies cleanly", () => {
    // Mix simple, object-array, refinement, and custom-struct typed decls in
    // one file. Stress: every shape registers without cross-talk.
    const src = [
      `<program>`,
      `\${`,
      `  type Status:enum = .Todo | .Done`,
      `  type Card:struct = { id: number, title: string }`,
      `  <count>: number = 0`,
      `  <amount>: number(>=0) = 0`,
      `  <items>: { id: number, label: string }[] = []`,
      `  <cards>: Card[] = []`,
      `  <statuses>: Status[] = []`,
      `}`,
      `</program>`,
    ].join("\n");
    const { ast } = buildSYM(src);
    const fileScope = ast._scope;
    for (const name of ["count", "amount", "items", "cards", "statuses"]) {
      const r = lookupStateCell(fileScope, name);
      expect(r).not.toBeNull();
      expect(r.declNode.name).toBe(name);
      expect(r.declNode.typeAnnotation).toBeTruthy();
    }
  });
});
