/**
 * return+SQL Chained-Call Codegen — Regression Tests
 * (S40 follow-up: fix-cg-sql-ref-placeholder)
 *
 * Reproducer (pre-fix):
 *   server function getAll() {
 *     return ?{`SELECT * FROM users`}.all()
 *   }
 *
 * Pre-fix emitted server JS:
 *   return /* sql-ref:-1 *\/.all();        // syntax-broken: leading dot on placeholder
 *
 * Post-fix emitted server JS (per SPEC §44.3 / §10):
 *   return await _scrml_sql`SELECT * FROM users`;
 *
 * Root cause: the `return` statement parser called collectExpr() which
 * consumed the BLOCK_REF token, then safeParseExprToNode preprocessed the
 * `?{...}` to `__scrml_sql_placeholder__`, parsed it as a CallExpr on a
 * member access, and emit-expr's CallExpr emitter wrote
 * `<sql-ref placeholder>.all()` verbatim.
 *
 * Fix mirrors fix-lift-sql-chained-call (S40, commits 4074ea3..baccf56):
 *   - ast-builder.js: when `return` is immediately followed by a SQL
 *     BLOCK_REF, build the SQL child, consume the chained .method() call,
 *     and attach it as `sqlNode` on the return-stmt. `expr` is left empty
 *     so the batch-planner string scanner does not double-count.
 *   - emit-logic.ts case "return-stmt": when `node.sqlNode` is set, recurse
 *     into emitLogicNode (case "sql") and wrap as `return ...;`.
 *
 * Coverage:
 *   §1  AST shape — `return ?{}.all()` produces return-stmt with sqlNode (kind:"sql"),
 *       chainedCalls captured, no exprNode bag-of-string fallback.
 *   §2  AST shape — `.get()` and `.run()` chains preserved as KEYWORD methods.
 *   §3  Backwards compat — `return <plain-expr>` still uses exprNode (no regression).
 *   §4  emit-logic — return-stmt with sqlNode + .all() emits `return await sql\`...\`;`.
 *   §5  emit-logic — return-stmt with sqlNode + .get() emits `return (await sql\`...\`)[0] ?? null;`.
 *   §6  emit-logic — return-stmt with sqlNode + .run() emits `return await sql\`...\`;`.
 *   §7  E2E — server function with `return ?{}.method()` compiles to parseable JS.
 *   §8  No `/ * sql-ref *\/` placeholder leaks in the emitted server JS.
 *   §9  batch-planner — single SQL site is NOT double-counted as both structured
 *       and string-scanned (would break Tier-1 single-site no-coalesce invariant).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitLogicNode } from "../../src/codegen/emit-logic.ts";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `retsql-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_retsql_${tag}`);
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

function runAst(src) {
  const bs = splitBlocks("return-sql.scrml", src);
  return buildAST(bs).ast;
}

function findFn(ast, name) {
  function walk(nodes) {
    for (const n of nodes ?? []) {
      if (!n) continue;
      if (n.kind === "function-decl" && n.name === name) return n;
      for (const k of ["body", "consequent", "alternate", "children", "nodes"]) {
        const v = n[k];
        if (Array.isArray(v)) {
          const r = walk(v);
          if (r) return r;
        }
      }
    }
    return null;
  }
  return walk(ast.nodes);
}

function parseServerJs(js) {
  return new Bun.Transpiler({ loader: "js" }).scan(js);
}

// ---------------------------------------------------------------------------
// §1  AST shape — return ?{}.all() produces return-stmt with sqlNode
// ---------------------------------------------------------------------------

describe("§1 AST shape — return ?{}.all() produces sqlNode-bearing return-stmt", () => {
  test("server function with return ?{...}.all() — single return-stmt with sqlNode", () => {
    const src = `<program>
\${
  server function getAll() {
    return ?{\`SELECT id FROM things\`}.all()
  }
}
</program>`;
    const ast = runAst(src);
    const fn = findFn(ast, "getAll");
    expect(fn).toBeTruthy();
    expect(fn.body.length).toBe(1);  // single return-stmt, no orphan sibling
    const ret = fn.body[0];
    expect(ret.kind).toBe("return-stmt");
    expect(ret.sqlNode).toBeTruthy();
    expect(ret.sqlNode.kind).toBe("sql");
    expect(ret.sqlNode.query).toContain("SELECT id FROM things");
    // expr is intentionally empty so batch-planner string scan doesn't double-count
    expect(ret.expr).toBe("");
    // exprNode is intentionally absent — semantics flow through sqlNode
    expect(ret.exprNode).toBeFalsy();
  });

  test("chained .all() is consumed onto sqlNode.chainedCalls", () => {
    const src = `<program>
\${
  server function getAll() {
    return ?{\`SELECT 1\`}.all()
  }
}
</program>`;
    const fn = findFn(runAst(src), "getAll");
    const sqlNode = fn.body[0].sqlNode;
    expect(sqlNode.chainedCalls).toBeArray();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// §2  AST shape — .get() (KEYWORD) and .run() chains preserved
// ---------------------------------------------------------------------------

describe("§2 AST shape — .get() and .run() chains attached", () => {
  test(".get() chained call is captured (KEYWORD-tokenized method)", () => {
    const src = `<program>
\${
  server function getOne(id) {
    return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
  }
}
</program>`;
    const fn = findFn(runAst(src), "getOne");
    expect(fn.body.length).toBe(1);
    const sqlNode = fn.body[0].sqlNode;
    expect(sqlNode).toBeTruthy();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("get");
  });

  test(".run() chained call is captured", () => {
    const src = `<program>
\${
  server function purgeAll() {
    return ?{\`DELETE FROM tmp\`}.run()
  }
}
</program>`;
    const fn = findFn(runAst(src), "purgeAll");
    expect(fn.body.length).toBe(1);
    const sqlNode = fn.body[0].sqlNode;
    expect(sqlNode).toBeTruthy();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("run");
  });
});

// ---------------------------------------------------------------------------
// §3  Backwards compat — `return <plain-expr>` still uses exprNode
// ---------------------------------------------------------------------------

describe("§3 Backwards compat — non-SQL return still uses exprNode", () => {
  test("return <ident> still produces exprNode without sqlNode", () => {
    const src = `<program>
\${
  function plainReturn(x) {
    return x + 1
  }
}
</program>`;
    const fn = findFn(runAst(src), "plainReturn");
    expect(fn.body.length).toBe(1);
    const ret = fn.body[0];
    expect(ret.kind).toBe("return-stmt");
    expect(ret.sqlNode).toBeFalsy();
    expect(ret.exprNode).toBeTruthy();
    expect(ret.expr).toBe("x + 1");
  });

  test("bare return (no expr) still produces empty return-stmt", () => {
    const src = `<program>
\${
  function early(flag) {
    if (flag) {
      return
    }
    return flag
  }
}
</program>`;
    const fn = findFn(runAst(src), "early");
    expect(fn).toBeTruthy();
    // Find a return-stmt anywhere in the body tree
    function findAllReturns(nodes, acc = []) {
      for (const n of nodes ?? []) {
        if (!n) continue;
        if (n.kind === "return-stmt") acc.push(n);
        for (const k of ["body", "consequent", "alternate"]) {
          const v = n[k];
          if (Array.isArray(v)) findAllReturns(v, acc);
        }
      }
      return acc;
    }
    const returns = findAllReturns(fn.body);
    // At least one bare return (no expr) and one expr return should be present.
    const bareReturns = returns.filter(r => !r.exprNode && !r.sqlNode && !r.expr);
    expect(bareReturns.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §4  emit-logic — return-stmt with sqlNode + .all() emits return-await form
// ---------------------------------------------------------------------------

describe("§4 emit-logic — return-stmt sqlNode + .all() emits return-await form", () => {
  test("return-stmt with sqlNode {.all()} emits return await sql`...`;", () => {
    const node = {
      kind: "return-stmt",
      expr: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT id, name FROM contacts ORDER BY name",
        chainedCalls: [{ method: "all", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toBe("return await _scrml_sql`SELECT id, name FROM contacts ORDER BY name`;");
  });

  test("emission has no `/* sql-ref:` placeholder", () => {
    const node = {
      kind: "return-stmt",
      expr: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT 1",
        chainedCalls: [{ method: "all", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).not.toContain("sql-ref:");
    expect(out).not.toMatch(/\.\s*all\s*\(/);  // chain is folded into await, not appended
  });
});

// ---------------------------------------------------------------------------
// §5  emit-logic — return-stmt + sqlNode + .get() emits singleton-or-null
// ---------------------------------------------------------------------------

describe("§5 emit-logic — return-stmt sqlNode + .get() emits singleton-or-null", () => {
  test("return-stmt + sqlNode {.get()} with ${param} emits return (await sql`...`)[0] ?? null;", () => {
    const node = {
      kind: "return-stmt",
      expr: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT id, name FROM users WHERE id = ${userId}",
        chainedCalls: [{ method: "get", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toBe("return (await _scrml_sql`SELECT id, name FROM users WHERE id = ${userId}`)[0] ?? null;");
  });
});

// ---------------------------------------------------------------------------
// §6  emit-logic — return-stmt + sqlNode + .run()
// ---------------------------------------------------------------------------

describe("§6 emit-logic — return-stmt sqlNode + .run()", () => {
  test("return-stmt + sqlNode {.run()} emits return await sql`...`;", () => {
    const node = {
      kind: "return-stmt",
      expr: "",
      sqlNode: {
        kind: "sql",
        query: "DELETE FROM tmp WHERE id = ${id}",
        chainedCalls: [{ method: "run", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toBe("return await _scrml_sql`DELETE FROM tmp WHERE id = ${id}`;");
  });
});

// ---------------------------------------------------------------------------
// §7  E2E — server function with return ?{}.method() compiles cleanly
// ---------------------------------------------------------------------------

describe("§7 E2E — full pipeline produces parseable server JS", () => {
  test("server function with return ?{}.all() compiles to syntactically valid JS", () => {
    const src = `<program db="./test.db">
\${
  server function loadContacts() {
    return ?{\`SELECT id, name, email FROM contacts ORDER BY name\`}.all()
  }
}
<div>contacts</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "loadContacts-return-all");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("return await _scrml_sql`SELECT id, name, email FROM contacts ORDER BY name`;");
    // Pre-fix shape must NOT be present.
    expect(serverJs).not.toContain("sql-ref:");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });

  test("server function with return ?{}.get() compiles cleanly", () => {
    const src = `<program db="./test.db">
\${
  server function loadOne(id) {
    return ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "loadOne-return-get");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("return (await _scrml_sql`SELECT id, name FROM users WHERE id = ${id}`)[0] ?? null;");
    expect(serverJs).not.toContain("sql-ref:");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });

  test("server function with return ?{}.run() compiles cleanly", () => {
    const src = `<program db="./test.db">
\${
  server function purgeOne(id) {
    return ?{\`DELETE FROM tmp WHERE id = \${id}\`}.run()
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "purgeOne-return-run");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("return await _scrml_sql`DELETE FROM tmp WHERE id = ${id}`;");
    expect(serverJs).not.toContain("sql-ref:");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §8  No /* sql-ref:N */ placeholder leak anywhere
// ---------------------------------------------------------------------------

describe("§8 No sql-ref placeholder leak after fix", () => {
  test("emitted server JS for mixed return forms contains zero `/* sql-ref:` placeholders", () => {
    const src = `<program db="./test.db">
\${
  server function a() { return ?{\`SELECT 1\`}.all() }
  server function b(id) { return ?{\`SELECT * FROM t WHERE id = \${id}\`}.get() }
  server function c(id) { return ?{\`DELETE FROM t WHERE id = \${id}\`}.run() }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "no-placeholder-leak");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).not.toContain("sql-ref:");
    // Chain method must not appear as an orphan dot-statement
    expect(serverJs).not.toMatch(/^\s*\.\s*(all|get|run)\s*\(/m);
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §9  batch-planner — single SQL site is NOT double-counted
// ---------------------------------------------------------------------------

describe("§9 batch-planner — return-stmt sqlNode counted exactly once", () => {
  test("single `return ?{}.get()` does NOT trigger Tier-1 coalescing (single-site invariant)", async () => {
    // If the SQL site were counted both via the structured walk (sqlNode -> kind:"sql")
    // AND via a string scan (raw ?{...} text on `expr`), the planner would see 2 sites
    // for what is really 1, and emit a coalescing group. The fix sets expr:"" so the
    // string scanner finds nothing.
    //
    // Mirror of compiler/tests/unit/batch-planner.test.js §9 Tier 1 single-site test,
    // but exercising the `return ?{}.method()` path that this fix introduces.
    const { compileScrml } = await import("../../src/api.js");
    const tag = "single-return-sql";
    const tmpDir = resolve(testDir, `_tmp_retsql_${tag}`);
    const tmpInput = resolve(tmpDir, `${tag}.scrml`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpInput, [
      '<program db="test.db">',
      "${ server function one(id) {",
      "    return ?{`SELECT * FROM users WHERE id = ${id}`}.get()",
      "} }",
      "</>",
    ].join("\n"));
    try {
      const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
      // Find the batch plan from the per-file metadata. The api result contains
      // outputs map keyed by file path with a `batchPlan` field per output.
      let plan = null;
      for (const [, output] of result.outputs) {
        if (output.batchPlan) plan = output.batchPlan;
      }
      // batchPlan may be on a per-result field — fall back to result.batchPlan.
      plan = plan ?? result.batchPlan;
      expect(plan).toBeTruthy();
      // Single SQL site MUST NOT produce a coalescing group.
      expect(plan.coalescedHandlers.size).toBe(0);
    } finally {
      if (existsSync(tmpInput)) rmSync(tmpInput);
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    }
  });
});
