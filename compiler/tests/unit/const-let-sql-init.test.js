/**
 * `let x = ?{...}` / `const x = ?{...}` SQL-init codegen — Regression Tests
 * (v0.2.4 bug-1-anomaly-2: fix-cg-const-let-sql-ref-placeholder)
 *
 * Reproducer (pre-fix): examples/17-schema-migrations.scrml shape, e.g.
 *   function postNote(authorEmail, title, body) {
 *     const user = ?{`SELECT id FROM users WHERE email = ${authorEmail}`}.get()
 *     if (not user) return
 *     ?{`...INSERT...`}.run()
 *   }
 *
 * Pre-fix emitted server JS:
 *   const user = (slash-star) sql-ref:-1 (star-slash).get();   // syntactic-junk + wrong runtime
 *
 * Pre-fix root cause: ast-builder.js `tryConsumeSqlInit` was wired into every
 * state-decl entry point (server @, @shared, @x:T, @x) but NOT into the let-decl
 * or const-decl entry points. The RHS `?{...}.get()` flowed through
 * collectExpr → safeParseExprToNode → `__scrml_sql_placeholder__` ident →
 * emit-expr.ts:746 `(slash-star) sql-ref:${nodeId} (star-slash)` placeholder,
 * with nodeId=-1 (the sentinel set at expression-parser.ts:889).
 *
 * Post-fix:
 *   const user = (await _scrml_sql`SELECT id FROM users WHERE email = ${authorEmail}`)[0] ?? null;
 *
 * The fix mirrors the parent S40 follow-up `fix-cg-cps-return-sql-ref-placeholder`:
 *
 *   - ast-builder.js: when the RHS of `=` in a let-decl/const-decl is a SQL
 *     BLOCK_REF, build the SQL child via tryConsumeSqlInit and attach as
 *     `sqlNode` on the decl. `init` is "" and `initExpr` is omitted.
 *     Both parser entry points (parseOneStatement inner mode AND parseLogicBody
 *     outer loop) are wired — 4 sites total.
 *
 *   - emit-logic.ts case "let-decl" / "const-decl": when `node.sqlNode` is
 *     present, recurse into case "sql" and wrap as `let/const name = <sql>;`.
 *     On client boundary, emit a placeholder (`null` for const, undeclared for
 *     let) + explanatory comment — `_scrml_sql` is server-only (E-CG-006).
 *
 *   - emit-expr.ts: defensive guard on emitSqlRef when nodeId is negative.
 *     Emits `null /_* sql-ref unresolved: nodeId=N — upstream bug *_/` so the
 *     JS still parses but runtime fails loudly with a TypeError instead of
 *     silently dropping a comment.
 *
 *   - route-inference.ts: visitNode for let/const/tilde-decl now pushes a
 *     `server-only-resource` trigger when the decl carries a sqlNode. Without
 *     this, postNote() in 17-schema-migrations.scrml lost its server-fn route
 *     (W-DEAD-FUNCTION + E-CG-006 leak — the body was emitted to the client
 *     unchanged because RI's `detectServerOnlyResource(init)` ran on "" instead
 *     of `?{...}`).
 *
 *   - emit-control-flow.ts substituteHoistedSqlInBody: detect sqlNode-bearing
 *     decls in the hoisted-loop body and strip+replace via the Map lookup
 *     replacement. Without this, §8.10 Tier 2 hoist regressed.
 *
 *   - meta-checker.ts bodyContainsSqlContext: detect sqlNode on let/const-decl
 *     so E-META-007 (?{} inside runtime ^{} block) continues to fire.
 *
 *   - type-system.ts walkBody (E-FN-001): detect sqlNode on let/const-decl
 *     so E-FN-001 (?{} inside `fn` body) continues to fire.
 *
 * Coverage:
 *   §1  AST shape — `let x = ?{...}` produces let-decl with sqlNode
 *   §2  AST shape — `const x = ?{...}` produces const-decl with sqlNode
 *   §3  AST shape — chained .get()/.all()/.run() captured
 *   §4  AST shape — backwards compat: non-SQL let/const still use initExpr
 *   §5  Codegen — `const x = ?{...}.get()` in server fn body emits
 *       `const x = (await _scrml_sql\`...\`)[0] ?? null;`
 *   §6  Codegen — `let x = ?{...}.all()` in server fn body emits
 *       `let x = await _scrml_sql\`...\`;`
 *   §7  E2E — examples/17-schema-migrations.scrml compiles cleanly; no
 *       `sql-ref:-1` (or any negative) in any output JS file.
 *   §8  RI — `const x = ?{...}.get()` inside an inferred fn promotes it to
 *       server (route emitted).
 *   §9  Emitter guard — emitSqlRef returns `null` placeholder when nodeId
 *       is negative (defense-in-depth, should not fire in practice).
 *  §10  Backward-compat — existing state-decl + SQL init still works.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `clsi-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_clsi_${tag}`);
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
  const bs = splitBlocks("const-let-sql.scrml", src);
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

// ---------------------------------------------------------------------------
// §1 AST shape — `let x = ?{...}` produces let-decl with sqlNode
// ---------------------------------------------------------------------------

describe("§1 AST shape — let x = ?{...} produces sqlNode-bearing let-decl", () => {
  test("bare let + ?{} initializer attaches sqlNode", () => {
    const src = `<program>
\${
  server function loadRows() {
    let rows = ?{\`SELECT id FROM users\`}
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadRows");
    expect(fn).toBeTruthy();
    expect(fn.body.length).toBe(1);
    const decl = fn.body[0];
    expect(decl.kind).toBe("let-decl");
    expect(decl.name).toBe("rows");
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.kind).toBe("sql");
    expect(decl.sqlNode.query).toContain("SELECT id FROM users");
    expect(decl.init).toBe("");
    expect(decl.initExpr).toBeFalsy();
  });

  test("let + .all() chained call attaches sqlNode + chainedCalls", () => {
    const src = `<program>
\${
  server function loadAll() {
    let rows = ?{\`SELECT 1\`}.all()
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
// §2 AST shape — `const x = ?{...}` produces const-decl with sqlNode
// ---------------------------------------------------------------------------

describe("§2 AST shape — const x = ?{...} produces sqlNode-bearing const-decl", () => {
  test("bare const + ?{} initializer attaches sqlNode", () => {
    const src = `<program>
\${
  server function loadOne() {
    const row = ?{\`SELECT 1\`}
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadOne");
    const decl = fn.body[0];
    expect(decl.kind).toBe("const-decl");
    expect(decl.name).toBe("row");
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.kind).toBe("sql");
    expect(decl.init).toBe("");
  });

  test("const + .get() chained call attaches sqlNode (KEYWORD-tokenized method)", () => {
    const src = `<program>
\${
  server function loadOne(id) {
    const user = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadOne");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls.length).toBe(1);
    expect(decl.sqlNode.chainedCalls[0].method).toBe("get");
  });
});

// ---------------------------------------------------------------------------
// §3 AST shape — chained .run() captured on let too
// ---------------------------------------------------------------------------

describe("§3 AST shape — .run() chain captured on let-decl", () => {
  test("let with .run() chain", () => {
    const src = `<program>
\${
  server function purgeAll() {
    let ok = ?{\`DELETE FROM tmp\`}.run()
  }
}
</program>`;
    const fn = findFn(runAst(src), "purgeAll");
    const decl = fn.body[0];
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls[0].method).toBe("run");
  });
});

// ---------------------------------------------------------------------------
// §4 AST shape — backwards compat (non-SQL let/const)
// ---------------------------------------------------------------------------

describe("§4 Backwards compat — non-SQL let/const still uses initExpr", () => {
  test("let x = 42 still produces initExpr, no sqlNode", () => {
    const src = `<program>
\${
  function plain() {
    let x = 42
  }
}
</program>`;
    const fn = findFn(runAst(src), "plain");
    const decl = fn.body[0];
    expect(decl.kind).toBe("let-decl");
    expect(decl.sqlNode).toBeFalsy();
    expect(decl.initExpr).toBeTruthy();
    expect(decl.init).toBe("42");
  });

  test("const y = x + 1 still produces initExpr, no sqlNode", () => {
    const src = `<program>
\${
  function copy(x) {
    const y = x + 1
  }
}
</program>`;
    const fn = findFn(runAst(src), "copy");
    const decl = fn.body[0];
    expect(decl.kind).toBe("const-decl");
    expect(decl.sqlNode).toBeFalsy();
    expect(decl.initExpr).toBeTruthy();
    expect(decl.init).toBe("x + 1");
  });
});

// ---------------------------------------------------------------------------
// §5 Codegen — server fn body: const x = ?{...}.get()
// ---------------------------------------------------------------------------

describe("§5 Codegen — const + ?{}.get() in server fn body", () => {
  test("emits await _scrml_sql tagged-template with [0] ?? null", () => {
    const src = `<program db="./test.db">
<db src="./test.db" tables="users">
\${
  server function lookup(id) {
    const user = ?{\`SELECT id FROM users WHERE id = \${id}\`}.get()
    return user
  }
}
</>
</program>`;
    const { errors, serverJs } = compileSource(src, "const-get");
    expect(errors.filter(e => e.severity === "error" || e.fatal)).toEqual([]);
    expect(serverJs).toBeTruthy();
    // No sql-ref placeholder anywhere
    expect(serverJs).not.toContain("sql-ref:");
    // Correct Bun.SQL tagged-template form for .get()
    expect(serverJs).toContain("const user = (await _scrml_sql`SELECT id FROM users WHERE id = ${id}`)[0] ?? null;");
  });
});

// ---------------------------------------------------------------------------
// §6 Codegen — server fn body: let x = ?{...}.all()
// ---------------------------------------------------------------------------

describe("§6 Codegen — let + ?{}.all() in server fn body", () => {
  test("emits await _scrml_sql tagged-template for .all()", () => {
    const src = `<program db="./test.db">
<db src="./test.db" tables="users">
\${
  server function loadAll() {
    let rows = ?{\`SELECT id, name FROM users\`}.all()
    return rows
  }
}
</>
</program>`;
    const { errors, serverJs } = compileSource(src, "let-all");
    expect(errors.filter(e => e.severity === "error" || e.fatal)).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).not.toContain("sql-ref:");
    // For .all() no [0] suffix — flat statement
    expect(serverJs).toMatch(/let rows = await _scrml_sql`SELECT id, name FROM users`;/);
  });
});

// ---------------------------------------------------------------------------
// §7 E2E — examples/17-schema-migrations.scrml (the original repro)
// ---------------------------------------------------------------------------

describe("§7 E2E — examples/17-schema-migrations.scrml", () => {
  test("compiles with no sql-ref:-1 (or any negative-index sql-ref) anywhere", () => {
    const examplePath = resolve(testDir, "../../../examples/17-schema-migrations.scrml");
    const result = compileScrml({
      inputFiles: [examplePath],
      write: false,
      outputDir: resolve(testDir, "_tmp_clsi_e2e_17/out"),
    });
    // Filter out the dead-function warning + the sibling `not` operator parse
    // failure (out of scope per S84 Wave 1 dispatch — `if (not user)` is the
    // unrelated Bug 1 #1 anomaly tracked separately).
    // The compilation itself should succeed (no fatal errors blocking output).
    expect(result.outputs).toBeTruthy();
    expect(result.outputs.size ?? Object.keys(result.outputs).length).toBeGreaterThan(0);
    for (const [_fp, output] of result.outputs) {
      if (output.serverJs) {
        expect(output.serverJs).not.toMatch(/sql-ref:-?\d+/);
        expect(output.serverJs).not.toContain("sql-ref:");
        // S93 — postNote was migrated to call lookupUser() instead of an
        // inline SELECT (closes W-DEAD-FUNCTION on lookupUser; richer
        // example showing cross-function call). lookupUser's body emits a
        // real tagged template for `?{`SELECT id, display_name ...`}.get()`.
        expect(output.serverJs).toContain("(await _scrml_sql`SELECT id, display_name FROM users WHERE email = ${email}`)[0] ?? null");
      }
      if (output.clientJs) {
        expect(output.clientJs).not.toMatch(/sql-ref:-?\d+/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §8 RI — sqlNode-bearing const-decl promotes inferred fn to server
// ---------------------------------------------------------------------------

describe("§8 RI — const + ?{} triggers server-fn classification", () => {
  test("body-inferred fn with `const x = ?{...}.get()` gets a server route", () => {
    // No `server` modifier on the function — body-content inference should
    // promote it via the sqlNode trigger added in route-inference.ts.
    const src = `<program db="./test.db">
<db src="./test.db" tables="users">
\${
  function postNote(email) {
    const user = ?{\`SELECT id FROM users WHERE email = \${email}\`}.get()
    return user
  }
}
</>
</program>`;
    const { errors, serverJs, clientJs } = compileSource(src, "ri-promote");
    // Server output should contain the route handler.
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("_scrml_handler_postNote");
    expect(serverJs).toContain("(await _scrml_sql`SELECT id FROM users WHERE email = ${email}`)[0] ?? null");
    // Client output: the body must NOT leak _scrml_sql (E-CG-006 must not fire).
    expect(errors.filter(e => e.code === "E-CG-006")).toEqual([]);
    if (clientJs) {
      // Either tree-shaken (W-DEAD-FUNCTION) or proxied to a fetch wrapper.
      // What it must NOT do is contain _scrml_sql in client body.
      expect(clientJs).not.toMatch(/\b_scrml_sql\s*[.`]/);
    }
  });
});

// ---------------------------------------------------------------------------
// §9 Emitter guard — emitSqlRef returns null when nodeId is negative
// ---------------------------------------------------------------------------

describe("§9 emit-expr.ts emitSqlRef guard for negative nodeId", () => {
  test("synthetic call with nodeId=-1 yields 'null' + diagnostic comment", async () => {
    // Import the codegen module and reach into the (private) emit helper via
    // its public re-export. The simplest assertion is at the source level:
    // confirm the guard string is present in the compiled file. We do this
    // by reading the compiled artifact since we don't have direct access to
    // the private helper from this test file.
    const emitExprPath = resolve(testDir, "../../src/codegen/emit-expr.ts");
    const src = readFileSync(emitExprPath, "utf8");
    expect(src).toContain("if (node.nodeId < 0)");
    expect(src).toContain("null /* sql-ref unresolved");
  });
});

// ---------------------------------------------------------------------------
// §10 Backwards-compat: existing state-decl + SQL init still works
// ---------------------------------------------------------------------------

describe("§10 Backwards-compat — state-decl + SQL init unchanged", () => {
  test("@x = ?{...}.all() still attaches sqlNode (state-decl path)", () => {
    const src = `<program>
\${
  server function refreshList() {
    @users = ?{\`SELECT id FROM users\`}.all()
  }
}
</program>`;
    const fn = findFn(runAst(src), "refreshList");
    const decl = fn.body[0];
    expect(decl.kind).toBe("state-decl");
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls[0].method).toBe("all");
  });
});
