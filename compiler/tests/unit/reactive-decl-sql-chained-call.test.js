/**
 * reactive-decl + SQL Chained-Call Codegen — Regression Tests
 * (S40 follow-up: fix-cg-cps-return-sql-ref-placeholder)
 *
 * Reproducer (pre-fix): combined-007-crud.scrml shape, e.g.
 *   server function refreshList() {
 *     @users = ?{`SELECT id, name, email FROM users`}
 *   }
 *
 * Pre-fix emitted server JS (CPS-rewritten — last reactive-decl becomes
 * the continuation):
 *   const _scrml_cps_return = /_* sql-ref:-1 *_/;   // SYNTAX ERROR
 *   return _scrml_cps_return;
 *
 * Pre-fix emitted client JS (top-level same-shape decl):
 *   _scrml_reactive_set("users", /_* sql-ref:-1 *_/);   // also syntactic noise
 *
 * Post-fix emitted server JS:
 *   const _scrml_cps_return = await _scrml_sql.unsafe("SELECT id, name, email FROM users");
 *   return _scrml_cps_return;
 *
 * Root cause: the reactive-decl's RHS `?{...}` was captured as part of the
 * `init` string, then `safeParseExprToNode` preprocessed `?{...}` to the
 * sentinel `__scrml_sql_placeholder__`, which `emit-expr.ts:403` rendered as
 * a `(slash-star) sql-ref:N (star-slash)` comment in expression position.
 *
 * Fix mirrors the parent commit `2a05585` (return-stmt path) and the lift
 * fix in `4074ea3..baccf56`:
 *
 *   - ast-builder.js: when the RHS of `=` in a reactive-decl is a SQL
 *     BLOCK_REF, build the SQL child, consume the chained method calls
 *     via consumeSqlChainedCalls, and attach as `sqlNode` on the
 *     reactive-decl. `init` is "" and `initExpr` is omitted so the
 *     batch-planner string scanner doesn't double-count and downstream
 *     consumers fall through to the structured path.
 *
 *   - emit-server.ts (both CPS sites): when the CPS-return reactive-decl
 *     has `sqlNode`, recurse into emitLogicNode(sqlNode, { boundary: server })
 *     and strip trailing `;` before composing `const _scrml_cps_return = …;`.
 *
 *   - emit-logic.ts case "state-decl": when `node.sqlNode` is present
 *     AND `opts.boundary === "server"`, recurse into case "sql" and emit
 *     `_scrml_reactive_set("name", <sql>);`. (Server-only because
 *     `_scrml_sql` is server-only — E-CG-006 enforces.)
 *
 *   - route-inference.ts: extend `hasServerOnlyResourceInInit()` and the
 *     trigger-1 visitor in `collectStmtTriggers()` to recognize the
 *     structured `sqlNode` field. Without this, CPS eligibility detection
 *     misses SQL-init reactive-decls and routes are dropped (or E-RI-002
 *     fires on what should be a CPS-split function).
 *
 * Coverage:
 *   §1  AST shape — `@x = ?{...}` produces reactive-decl with sqlNode
 *       (kind:"sql"); init is "" and initExpr is undefined.
 *   §2  AST shape — chained .all()/.get()/.run() captured as KEYWORD methods.
 *   §3  AST shape — backwards compat (non-SQL reactive-decl still uses
 *       initExpr; bare `?{}` still works).
 *   §4  AST shape — typed reactive-decl, server modifier, @shared modifier.
 *   §5  E2E — CPS server function with `@x = ?{...}` as final stmt
 *       compiles to `const _scrml_cps_return = await _scrml_sql\`…\`;`.
 *   §6  E2E — Bare `@x = ?{...}` (no chained call) inside CPS-final stmt
 *       compiles to `await _scrml_sql.unsafe("…")` for DDL/no-param shape.
 *   §7  E2E — `@x = ?{…\${id}…}.get()` flows through the param extractor
 *       and emits `(await _scrml_sql\`… \${id}…\`)[0] ?? null;`.
 *   §8  E2E — combined-007-crud.scrml shape compiles cleanly (zero
 *       sql-ref placeholders in the server.js output).
 *   §9  batch-planner — single SQL-init reactive-decl is NOT double-counted.
 *  §10  E-RI-002 — CPS-split detection still works for SQL-init reactive
 *       decls (no false-positive).
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitLogicNode } from "../../src/codegen/emit-logic.ts";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `rdsql-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_rdsql_${tag}`);
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
  const bs = splitBlocks("reactive-decl-sql.scrml", src);
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

function findReactiveDeclByName(ast, name) {
  function walk(nodes) {
    for (const n of nodes ?? []) {
      if (!n) continue;
      if (n.kind === "state-decl" && n.name === name) return n;
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
// §1  AST shape — `@x = ?{...}` produces reactive-decl with sqlNode
// ---------------------------------------------------------------------------

describe("§1 AST shape — @x = ?{...} produces sqlNode-bearing reactive-decl", () => {
  test("reactive-decl with bare ?{...} initializer attaches sqlNode", () => {
    const src = `<program>
\${
  server function refreshList() {
    @users = ?{\`SELECT id FROM users\`}
  }
}
</program>`;
    const ast = runAst(src);
    const fn = findFn(ast, "refreshList");
    expect(fn).toBeTruthy();
    expect(fn.body.length).toBe(1);
    const decl = fn.body[0];
    expect(decl.kind).toBe("state-decl");
    expect(decl.name).toBe("users");
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.kind).toBe("sql");
    expect(decl.sqlNode.query).toContain("SELECT id FROM users");
    // init is "" so batch-planner string scanner doesn't double-count
    expect(decl.init).toBe("");
    // initExpr is intentionally absent — semantics flow through sqlNode
    expect(decl.initExpr).toBeFalsy();
  });

  test("reactive-decl with chained .all() init attaches sqlNode + chainedCalls", () => {
    const src = `<program>
\${
  server function loadAll() {
    @rows = ?{\`SELECT 1\`}.all()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadAll");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls).toBeArray();
    expect(decl.sqlNode.chainedCalls.length).toBe(1);
    expect(decl.sqlNode.chainedCalls[0].method).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// §2  AST shape — .get() (KEYWORD-tokenized) and .run() chains preserved
// ---------------------------------------------------------------------------

describe("§2 AST shape — .get() and .run() chains attached to reactive-decl sqlNode", () => {
  test(".get() chained call captured (KEYWORD-tokenized method)", () => {
    const src = `<program>
\${
  server function loadOne(id) {
    @user = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadOne");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls.length).toBe(1);
    expect(decl.sqlNode.chainedCalls[0].method).toBe("get");
  });

  test(".run() chained call captured", () => {
    const src = `<program>
\${
  server function purgeAll() {
    @ok = ?{\`DELETE FROM tmp\`}.run()
  }
}
</program>`;
    const fn = findFn(runAst(src), "purgeAll");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls.length).toBe(1);
    expect(decl.sqlNode.chainedCalls[0].method).toBe("run");
  });
});

// ---------------------------------------------------------------------------
// §3  AST shape — backwards compat
// ---------------------------------------------------------------------------

describe("§3 Backwards compat — non-SQL reactive-decl still uses initExpr", () => {
  test("reactive-decl with plain expr still produces initExpr without sqlNode", () => {
    const src = `<program>
\${
  function plain() {
    @x = 42
  }
}
</program>`;
    const fn = findFn(runAst(src), "plain");
    const decl = fn.body[0];
    expect(decl.kind).toBe("state-decl");
    expect(decl.sqlNode).toBeFalsy();
    expect(decl.initExpr).toBeTruthy();
    expect(decl.init).toBe("42");
  });

  test("reactive-decl with @ref expr still produces initExpr without sqlNode", () => {
    const src = `<program>
\${
  function copy() {
    @y = @x + 1
  }
}
</program>`;
    const fn = findFn(runAst(src), "copy");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeFalsy();
    expect(decl.initExpr).toBeTruthy();
    expect(decl.init).toBe("@x + 1");
  });
});

// ---------------------------------------------------------------------------
// §4  AST shape — typed / server / @shared modifiers also attach sqlNode
// ---------------------------------------------------------------------------

describe("§4 AST shape — typed + server + @shared modifiers each attach sqlNode", () => {
  test("typed reactive-decl @x: T = ?{...}.all() — sqlNode + typeAnnotation", () => {
    // Use a primitive type that the type-system will accept for an array-of-rows.
    const src = `<program>
\${
  server function loadTyped() {
    @rows: any = ?{\`SELECT 1\`}.all()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadTyped");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.typeAnnotation).toBeTruthy();
    expect(decl.init).toBe("");
  });

  test("server @x = ?{...}.all() — sqlNode + isServer", () => {
    const src = `<program>
\${
  server @x = ?{\`SELECT 1\`}.all()
}
</program>`;
    const decl = findReactiveDeclByName(runAst(src), "x");
    expect(decl).toBeTruthy();
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.isServer).toBe(true);
    expect(decl.init).toBe("");
  });

  test("@shared y = ?{...}.all() — sqlNode + isShared", () => {
    const src = `<program>
\${
  @shared y = ?{\`SELECT 1\`}.all()
}
</program>`;
    const decl = findReactiveDeclByName(runAst(src), "y");
    expect(decl).toBeTruthy();
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.isShared).toBe(true);
    expect(decl.init).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §5  emit-logic — server-boundary reactive-decl + sqlNode emits valid set
// ---------------------------------------------------------------------------

describe("§5 emit-logic — reactive-decl + sqlNode (server boundary) wraps sql in reactive_set", () => {
  test("synthetic reactive-decl + sqlNode {.all()} emits _scrml_reactive_set with await sql`...`", () => {
    const node = {
      kind: "state-decl",
      name: "rows",
      init: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT id, name FROM contacts ORDER BY name",
        chainedCalls: [{ method: "all", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    // _emitReactiveSet emits a `_scrml_reactive_set("name", <expr>);` line.
    expect(out).toContain("_scrml_reactive_set");
    expect(out).toContain("rows");
    expect(out).toContain("await _scrml_sql`SELECT id, name FROM contacts ORDER BY name`");
    expect(out).not.toContain("sql-ref:");
  });

  test("synthetic reactive-decl + sqlNode {.get()} emits singleton-or-null wrap", () => {
    const node = {
      kind: "state-decl",
      name: "user",
      init: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT id, name FROM users WHERE id = ${userId}",
        chainedCalls: [{ method: "get", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toContain("(await _scrml_sql`SELECT id, name FROM users WHERE id = ${userId}`)[0] ?? null");
    expect(out).not.toContain("sql-ref:");
  });
});

// ---------------------------------------------------------------------------
// §6  E2E — CPS-final reactive-decl with bare ?{...} compiles cleanly
// ---------------------------------------------------------------------------

describe("§6 E2E — CPS-final @x = ?{...} compiles to valid server JS", () => {
  test("server fn whose only stmt is `@x = ?{...}` produces `const _scrml_cps_return = await _scrml_sql.unsafe(\"...\");`", () => {
    const src = `<program db="./test.db">
\${
  server function refreshList() {
    @users = ?{\`SELECT id, name FROM users\`}
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "refreshList-bare");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    // Bare ?{} (no chained call) of a no-param SELECT routes through
    // case "sql" branch C and emits sql.unsafe("SELECT ...") — the canonical
    // form matches the prior /* sql-ref:-1 */ slot exactly.
    expect(serverJs).toContain("const _scrml_cps_return = await _scrml_sql.unsafe(\"SELECT id, name FROM users\");");
    expect(serverJs).toContain("return _scrml_cps_return;");
    expect(serverJs).not.toContain("sql-ref:");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §7  E2E — chained .get() with ${param} interpolation
// ---------------------------------------------------------------------------

describe("§7 E2E — `@x = ?{…\${id}…}.get()` — singleton-or-null tagged template", () => {
  test("reactive-decl with .get() and template param emits tagged sql + singleton wrap", () => {
    const src = `<program db="./test.db">
\${
  server function loadOne(id) {
    @user = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "loadOne-get-param");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    // Expect singleton-or-null wrap with tagged template
    expect(serverJs).toContain("(await _scrml_sql`SELECT id, name FROM users WHERE id = ${id}`)[0] ?? null;");
    expect(serverJs).not.toContain("sql-ref:");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §8  E2E — combined-007-crud-shape compiles cleanly (zero placeholder leak)
// ---------------------------------------------------------------------------

describe("§8 E2E — combined-007-crud.scrml shape compiles without sql-ref leaks", () => {
  test("multi-server-fn module with bare @users = ?{...} on every fn produces zero sql-ref placeholders", () => {
    const src = `<program db="./test.db">
\${
  @users = ?{\`SELECT id, name, email FROM users\`}

  server function createUser() {
    ?{\`INSERT INTO users (name, email) VALUES ('New', 'new@example.com')\`}
    @users = ?{\`SELECT id, name, email FROM users\`}
  }

  server function refreshList() {
    @users = ?{\`SELECT id, name, email FROM users\`}
  }
}
<div>${"$"}{@users.length}</div>
</program>`;
    const { errors, serverJs, clientJs } = compileSource(src, "combined-007-shape");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(clientJs).toBeTruthy();
    expect(serverJs).not.toContain("sql-ref:");
    // CPS-return rewrite for both server functions
    expect(serverJs).toContain("const _scrml_cps_return = await _scrml_sql.unsafe(\"SELECT id, name, email FROM users\");");
    expect(() => parseServerJs(serverJs)).not.toThrow();
    expect(() => parseServerJs(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §9  batch-planner — single SQL-init reactive-decl is NOT double-counted
// ---------------------------------------------------------------------------

describe("§9 batch-planner — SQL-init reactive-decl counted exactly once", () => {
  test("single `@x = ?{}.get()` does not trigger Tier-1 coalescing", async () => {
    const tag = "single-rdsql-batch";
    const tmpDir = resolve(testDir, `_tmp_rdsql_${tag}`);
    const tmpInput = resolve(tmpDir, `${tag}.scrml`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpInput, [
      '<program db="test.db">',
      "${ server function one(id) {",
      "    @user = ?{`SELECT * FROM users WHERE id = ${id}`}.get()",
      "} }",
      "<div>x</div>",
      "</>",
    ].join("\n"));
    try {
      const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
      let plan = null;
      for (const [, output] of result.outputs) {
        if (output.batchPlan) plan = output.batchPlan;
      }
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

// ---------------------------------------------------------------------------
// §10  RI — CPS-split detection still works for SQL-init reactive-decls
// ---------------------------------------------------------------------------

describe("§10 RI — CPS-split detection for SQL-init reactive-decl still works", () => {
  test("server fn whose only stmt is `@x = ?{...}` is recognized as CPS-eligible (no E-RI-002)", () => {
    const src = `<program db="./test.db">
\${
  server function refreshList() {
    @users = ?{\`SELECT id FROM users\`}
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "refreshList-no-erri002");
    // No E-RI-002 even though the function assigns to @users — CPS splits it
    // out as the continuation-return.
    expect(errors.filter(e => e.code === "E-RI-002")).toEqual([]);
    expect(serverJs).toBeTruthy();
    // The fn is server-escalated: it should be present in routes.
    expect(serverJs).toContain("__ri_route_refreshList");
  });
});

// ---------------------------------------------------------------------------
// §11  CG client boundary — top-level / client-context @x = ?{...} does not
//      emit a bare `_scrml_reactive_set("x", )` (empty arg)
//      (fix-cg-mounthydrate-sql-ref-placeholder, S40 follow-up sibling)
// ---------------------------------------------------------------------------

describe("§11 CG client — bare @x = ?{...} suppresses empty-arg reactive_set", () => {
  test("synthetic reactive-decl + sqlNode (client boundary) emits comment, NOT _scrml_reactive_set", () => {
    const node = {
      kind: "state-decl",
      name: "rows",
      init: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT id, name FROM users",
        chainedCalls: [],
      },
    };
    const out = emitLogicNode(node, { boundary: "client" });
    // Pre-fix: `_scrml_reactive_set("rows", );` (empty arg). Post-fix: comment line.
    expect(out).not.toMatch(/_scrml_reactive_set\(\s*"rows"\s*,\s*\)/);
    expect(out).toContain("// SQL-init for @rows");
    expect(out).toContain("E-CG-006");
    expect(out).toContain("§8.11");
  });

  test("synthetic reactive-decl + sqlNode {.all()} (client boundary) — same suppression", () => {
    const node = {
      kind: "state-decl",
      name: "users",
      init: "",
      sqlNode: {
        kind: "sql",
        query: "SELECT id FROM users",
        chainedCalls: [{ method: "all", args: "" }],
      },
    };
    const out = emitLogicNode(node, { boundary: "client" });
    expect(out).not.toMatch(/_scrml_reactive_set\(\s*"users"\s*,\s*\)/);
    expect(out).toContain("// SQL-init for @users");
  });

  test("synthetic reactive-decl + sqlNode (no boundary in opts) — defaults to client suppression path", () => {
    // When opts.boundary is undefined we fall through past the server check.
    // The client-side suppression should still fire because the sqlNode short-circuit
    // is placed at the top of the post-server fallthrough.
    const node = {
      kind: "state-decl",
      name: "x",
      init: "",
      sqlNode: { kind: "sql", query: "SELECT 1", chainedCalls: [] },
    };
    const out = emitLogicNode(node, {}); // no boundary
    expect(out).not.toMatch(/_scrml_reactive_set\(\s*"x"\s*,\s*\)/);
    expect(out).toContain("// SQL-init for @x");
  });

  test("non-SQL reactive-decl is unaffected — legacy emitter still fires (no regression)", () => {
    // Sanity: `@count = 0` must continue to emit `_scrml_reactive_set("count", 0);`.
    const src = `<program>
\${
  @count = 0
}
<div>\${@count}</div>
</program>`;
    const { errors, clientJs } = compileSource(src, "count-zero-baseline");
    expect(errors).toEqual([]);
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain('_scrml_reactive_set("count", 0)');
  });

  test("E2E — combined-007-crud shape: client.js has zero empty-arg reactive_set", () => {
    const src = `<program db="./test.db">
\${
  @users = ?{\`SELECT id, name, email FROM users\`}
  @editingId = not
  @newName = ""
  @newEmail = ""

  function createUser() {
    ?{\`INSERT INTO users (name, email) VALUES ('New', 'new@example.com')\`}
    @users = ?{\`SELECT id, name, email FROM users\`}
  }

  function refreshList() {
    @users = ?{\`SELECT id, name, email FROM users\`}
  }
}
<div>\${@users.length}</div>
</program>`;
    const { errors, serverJs, clientJs } = compileSource(src, "combined-007-empty-arg");
    expect(errors).toEqual([]);
    expect(clientJs).toBeTruthy();
    expect(serverJs).toBeTruthy();

    // Primary regression: zero `_scrml_reactive_set("X", )` empty-arg sites.
    expect(clientJs).not.toMatch(/_scrml_reactive_set\(\s*"users"\s*,\s*\)/);
    expect(clientJs).not.toMatch(/_scrml_reactive_set\(\s*"[A-Za-z_$][A-Za-z0-9_$]*"\s*,\s*\)/);

    // The other vars (initialized to literals) MUST still emit their reactive_set.
    expect(clientJs).toContain('_scrml_reactive_set("editingId", null)');
    expect(clientJs).toContain('_scrml_reactive_set("newName", "")');
    expect(clientJs).toContain('_scrml_reactive_set("newEmail", "")');

    // The suppressed @users decl emits the explanatory comment.
    expect(clientJs).toContain("// SQL-init for @users");

    // Both files still parse cleanly.
    expect(() => parseServerJs(serverJs)).not.toThrow();
    expect(() => parseServerJs(clientJs)).not.toThrow();
  });
});
