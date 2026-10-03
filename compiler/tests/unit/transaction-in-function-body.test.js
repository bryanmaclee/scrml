/**
 * S450 — g-transaction-block-not-recognized-inside-a-function-body (UNIT half).
 *
 * `transaction { }` (§19.10.2) parsed only at the TOP LEVEL of a `${}` block: the
 * nested-body statement parser (`parseOneStatement`, which every function body —
 * all five fn-decl sites, incl. the `export` re-parse — and every if/else, loop and
 * match-arm block goes through) had no `transaction` arm, so the keyword fell into
 * the expression path and degraded to an undeclared identifier (E-SCOPE-001).
 *
 * This file pins, structurally (no emitted-text greps for the runtime claims —
 * those live in the integration twin, which EXECUTES the emitted server):
 *   §1 the parse — a `transaction-block` node in every nested position and fn form;
 *   §2 the §19.10.4 checker (validators/lint-transaction.ts) — E-ERROR-001,
 *      E-ERROR-007, E-TRANSACTION-CONTROL-FLOW and what stays legal;
 *   §3 the lowering marks — every `fail` / `?` at ANY depth in the block (not only
 *      a direct child) carries the rollback, and one in a nested function does not.
 */
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runTransactionChecks } from "../../src/validators/lint-transaction.ts";
import { emitLogicNode } from "../../src/codegen/emit-logic.ts";

function parse(src) {
  const bs = splitBlocks("t.scrml", src);
  return buildAST(bs);
}

function collect(root, kind) {
  const out = [];
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === kind) out.push(n);
    for (const k of Object.keys(n)) if (k !== "span" && k !== "parent") walk(n[k]);
  };
  walk(root);
  return out;
}

function fnNamed(ast, name) {
  return collect(ast, "function-decl").find((f) => f.name === name);
}

function codes(src) {
  const { ast } = parse(src);
  return runTransactionChecks(ast).map((d) => d.code);
}

const TX = "transaction { ?{`UPDATE t SET v = 1`}.run() }";

describe("§1 parse — transaction-block in nested bodies", () => {
  const forms = [
    ["function", `\${ type E:enum = { Bad } function f()! -> E { ${TX} } }`],
    ["server function", `\${ type E:enum = { Bad } server function f()! -> E { ${TX} } }`],
    ["export function", `\${ type E:enum = { Bad } export function f()! -> E { ${TX} } }`],
    ["export server function", `\${ type E:enum = { Bad } export server function f()! -> E { ${TX} } }`],
    ["nested function", `\${ type E:enum = { Bad } function outer() { function f()! -> E { ${TX} } } }`],
  ];
  for (const [label, src] of forms) {
    test(`${label}: the body holds a transaction-block, no E-SCOPE-001-shaped bare-expr`, () => {
      const { ast, errors } = parse(src);
      const f = fnNamed(ast, "f");
      expect(f).toBeDefined();
      const tx = f.body.find((s) => s.kind === "transaction-block");
      expect(tx).toBeDefined();
      expect(tx.body.length).toBe(1);
      // the pre-fix shape: `transaction` as an identifier in a bare expression
      expect(collect(f.body, "bare-expr").some((b) => /\btransaction\b/.test(String(b.expr ?? "")))).toBe(false);
      expect((errors ?? []).filter((e) => e.severity !== "warning").map((e) => e.code)).toEqual([]);
    });
  }

  const positions = [
    ["if body", `if (a) { ${TX} }`],
    ["else body", `if (a) { log(1) } else { ${TX} }`],
    ["for body", `for (let i = 0; i < 2; i++) { ${TX} }`],
    ["while body", `while (a) { ${TX} }`],
    ["match arm block", `match a { .A :> { ${TX} } .B :> { log(2) } }`],
  ];
  for (const [label, stmt] of positions) {
    test(`${label}: a transaction-block is reached`, () => {
      const { ast } = parse(`\${ type M:enum = { A B } type E:enum = { Bad } function f(a)! -> E { ${stmt} } }`);
      const f = fnNamed(ast, "f");
      expect(collect(f.body, "transaction-block").length).toBe(1);
    });
  }

  test("top level is unchanged: still a transaction-block", () => {
    const { ast } = parse(`\${ ${TX} }`);
    expect(collect(ast, "transaction-block").length).toBe(1);
  });
});

describe("§2 §19.10.4 checks (lint-transaction)", () => {
  test("non-`!` function → E-ERROR-001 (once)", () => {
    expect(codes(`\${ function f() { ${TX} } }`)).toEqual(["E-ERROR-001"]);
  });
  test("`!` function → no diagnostic", () => {
    expect(codes(`\${ type E:enum = { Bad } function f()! -> E { ${TX} } }`)).toEqual([]);
  });
  test("bare `!` (default Error) function → no diagnostic", () => {
    expect(codes(`\${ function f()! { ${TX} } }`)).toEqual([]);
  });
  test("nested transaction → E-ERROR-007 (at any depth inside the outer block)", () => {
    expect(codes(`\${ type E:enum = { Bad } function f(a)! -> E { transaction { if (a) { ${TX} } } } }`)).toEqual(["E-ERROR-007"]);
  });
  test("nested transaction at TOP level → E-ERROR-007 (was E-SCOPE-001 — still rejected)", () => {
    expect(codes(`\${ transaction { ${TX} } }`)).toEqual(["E-ERROR-007"]);
  });
  test("top-level transaction alone → no diagnostic (top level unchanged)", () => {
    expect(codes(`\${ ${TX} }`)).toEqual([]);
  });
  test("a transaction in a function nested INSIDE a transaction is its own scope (no E-ERROR-007)", () => {
    expect(codes(`\${ type E:enum = { Bad } function f()! -> E { transaction { function g()! -> E { ${TX} } } } }`)).toEqual([]);
  });

  test("`return` inside the block → E-TRANSACTION-CONTROL-FLOW", () => {
    expect(codes(`\${ type E:enum = { Bad } function f(a)! -> E { transaction { if (a) { return 1 } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });
  test("`break` / `continue` targeting a loop OUTSIDE the block → E-TRANSACTION-CONTROL-FLOW each", () => {
    expect(codes(`\${ type E:enum = { Bad } function f(a)! -> E { for (let i = 0; i < 2; i++) { transaction { if (a) { break } } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
    expect(codes(`\${ type E:enum = { Bad } function f(a)! -> E { while (a) { transaction { if (a) { continue } } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });
  test("labeled break to a label outside the block → E-TRANSACTION-CONTROL-FLOW; inside → legal", () => {
    expect(codes(`\${ type E:enum = { Bad } function f(a)! -> E { outer: for (let i = 0; i < 2; i++) { transaction { for (let j = 0; j < 2; j++) { break outer } } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
    expect(codes(`\${ type E:enum = { Bad } function f(a)! -> E { transaction { inner: for (let j = 0; j < 2; j++) { break inner } } } }`)).toEqual([]);
  });
  test("`return` inside a `!{}` handler arm carried as text, inside the block → E-TRANSACTION-CONTROL-FLOW", () => {
    const src = `\${ type E:enum = { Bad } function g()! -> E { fail E::Bad } function f()! -> E { transaction { g() !{ | _ :> return 3 } } } }`;
    expect(codes(src)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });
  test("S450 fix round: `fail` / `?` in a STATEMENT-match arm in the block → E-TRANSACTION-CONTROL-FLOW (braced, unbraced/text-carried, in a loop)", () => {
    const pre = "type M:enum = {\n A\n B\n }\n type E:enum = { Bad }\n function g()! -> E { fail E::Bad }\n";
    expect(codes(`\${ ${pre} function f(m: M)! -> E { transaction { match m {\n .A :> { fail E::Bad }\n .B :> { log(1) }\n } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
    expect(codes(`\${ ${pre} function f(m: M)! -> E { transaction { match m {\n .A :> fail E::Bad\n .B :> log(1)\n } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
    expect(codes(`\${ ${pre} function f(m: M)! -> E { transaction { match m {\n .A :> { let x = g()? }\n .B :> { log(1) }\n } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
    expect(codes(`\${ ${pre} function f(m: M)! -> E { transaction { while (true) { match m {\n .A :> { if (m) { fail E::Bad } }\n .B :> { log(1) }\n } } } } }`)).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
    // expression-position match, and a statement match with no fail/?, stay legal
    expect(codes(`\${ ${pre} function f(m: M)! -> E { transaction { let v = match m {\n .A :> fail E::Bad\n .B :> 2\n }\n match m {\n .A :> { log(1) }\n .B :> { log(2) }\n } } } }`)).toEqual([]);
  });

  test("legal exits: `fail` / `?` at any depth, loop-internal break/continue, `return` after the block, `return` in a nested function", () => {
    const src = `\${ type E:enum = { Bad } function g()! -> E { fail E::Bad }
      function f(a)! -> E {
        transaction {
          for (let i = 0; i < 2; i++) { if (a) { continue } if (i) { break } }
          if (a) { fail E::Bad }
          let v = g()?
          function h() { return 1 }
        }
        return 2
      } }`;
    expect(codes(src)).toEqual([]);
  });
});

describe("§3 lowering — rollback before every fail / ? in the block", () => {
  function emitTxIn(src) {
    const { ast } = parse(src);
    const f = fnNamed(ast, "f");
    const tx = collect(f.body, "transaction-block")[0];
    return { code: emitLogicNode(tx, { boundary: "server", dbVar: "_scrml_sql" }), tx };
  }

  // The rollback closure the block declares: `const _scrml_txn_rollback_N = async () => …`.
  const rollbackName = (code) => (code.match(/const (_scrml_txn_rollback_\d+) = async/) ?? [])[1];

  test("a `fail` nested in an if (NOT a direct child) rolls back before it returns", () => {
    const { code, tx } = emitTxIn(`\${ type E:enum = { Bad } function f(a)! -> E { transaction { if (a) { fail E::Bad } } } }`);
    const rb = rollbackName(code);
    expect(rb).toBeDefined();
    expect(code).toContain(`return (await ${rb}(), {`);
    // pre-S450 the only rollback before a fail was for a DIRECT child; this one is nested
    expect(tx.body.some((s) => s.kind === "fail-expr")).toBe(false);
    // the transient mark is cleared once the block is emitted (no leak to other emissions)
    expect(collect(tx, "fail-expr")[0]._scrmlTxnRollback).toBeUndefined();
  });

  test("a `?` propagation in the block rolls back before it returns", () => {
    const { code, tx } = emitTxIn(`\${ type E:enum = { Bad } function g()! -> E { fail E::Bad } function f(a)! -> E { transaction { let v = g()? } } }`);
    expect(collect(tx, "propagate-expr").length).toBe(1);
    expect(code).toContain(`return (await ${rollbackName(code)}(), `);
  });

  test("a `fail` inside a function nested in the block is NOT rolled back by the block (it returns from that function)", () => {
    const { code, tx } = emitTxIn(`\${ type E:enum = { Bad } function f(a)! -> E { transaction { function h()! -> E { fail E::Bad } } } }`);
    expect(collect(tx, "fail-expr").length).toBe(1);
    expect(code).not.toContain(`return (await ${rollbackName(code)}(), `);
  });

  test("the emitted block is syntactically valid async JS", () => {
    const { code } = emitTxIn(`\${ type E:enum = { Bad } function f(a)! -> E { transaction { if (a) { fail E::Bad } ?{\`UPDATE t SET v = 1\`}.run() } } }`);
    // throws on a syntax error
    expect(() => new Function(`return (async () => { const _scrml_sql = null; const a = 0; ${code} })`)).not.toThrow();
  });
});
