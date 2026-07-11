/**
 * Bare-identifier `result = ?{...}` SQL-init codegen — Regression Tests
 * (D-SFN-2, wave-2 verify-harden; server-fn fail-silent).
 *
 * Sibling of const-let-sql-init.test.js. That fix wired `tryConsumeSqlInit`
 * into the `let-decl` / `const-decl` entry points; the BARE-identifier
 * assignment form `result = ?{...}` (no `const` / `let` keyword — the
 * tilde-decl entry point) was the lone remaining gap.
 *
 * Reproducer (pre-fix): the 6-of-7 server-fn conformance cases, e.g.
 *   function loadTasks() : Task[] {
 *     result = ?{`SELECT id, text FROM tasks`}
 *     return result
 *   }
 *
 * Pre-fix emitted server JS (fail-silent — NO diagnostic):
 *   const result = null /* sql-ref unresolved: nodeId=-1 —
 *     upstream parser/AST bug, please report *_/;
 *
 * The bare RHS `?{...}` flowed through collectExpr → safeParseExprToNode →
 * an unresolved sql-ref ExprNode (nodeId: -1) → emit-logic's tilde-decl arm
 * rendered emit-expr's negative-nodeId sentinel. The conformance oracle could
 * NOT catch this — its serverStub intercepts the fetch and never runs the real
 * query, so the cases were green on broken code.
 *
 * Fix (ast-builder.js, TILDE-DECL path): when the RHS of a bare `name = ...`
 * is a SQL BLOCK_REF, route it through `tryConsumeSqlInit` and emit the SAME
 * `const-decl` + `sqlNode` shape the `const <name> = ?{}` path produces. The
 * bare form is thus AST-identical to the const form and flows through
 * emit-logic's already-tested const-decl sqlNode arm →
 * `const result = await _scrml_sql`...``. Matches the const behavior (RESOLVE,
 * not reject) and preserves the invariant that `?{}` reaches codegen only on
 * let/const-kind decl nodes (never a bare tilde-decl).
 *
 * Coverage:
 *   §1  AST shape — `result = ?{...}` produces const-decl with sqlNode
 *   §2  AST shape — chained `.all()` / `.get()` captured
 *   §3  Codegen — server fn body emits real `const result = await _scrml_sql…`,
 *       NOT the `nodeId=-1` sentinel
 *   §4  Backwards compat — a non-SQL bare assignment still produces tilde-decl
 *   §5  E2E — the basic-load-hydrate conformance shape: server.js has real SQL
 *       and no sentinel; client.js does not leak _scrml_sql (E-CG-006)
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `basi-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_basi_${tag}`);
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
  const bs = splitBlocks("bare-assign-sql.scrml", src);
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
// §1 AST shape — bare `result = ?{...}` produces const-decl with sqlNode
// ---------------------------------------------------------------------------

describe("§1 AST shape — bare result = ?{...} produces sqlNode-bearing const-decl", () => {
  test("bare identifier assignment + ?{} initializer attaches sqlNode", () => {
    const src = `<program>
\${
  server function loadRows() {
    result = ?{\`SELECT id FROM users\`}
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadRows");
    expect(fn).toBeTruthy();
    expect(fn.body.length).toBe(1);
    const decl = fn.body[0];
    // The bare form is normalized to the const-decl shape (AST-identical to
    // `const result = ?{...}`), NOT the fail-silent tilde-decl.
    expect(decl.kind).toBe("const-decl");
    expect(decl.name).toBe("result");
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.kind).toBe("sql");
    expect(decl.sqlNode.query).toContain("SELECT id FROM users");
    expect(decl.init).toBe("");
    // Critically: no unresolved sql-ref ExprNode (nodeId: -1) captured.
    expect(decl.initExpr).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// §2 AST shape — chained .all() / .get() captured on the bare form
// ---------------------------------------------------------------------------

describe("§2 AST shape — bare form captures chained calls", () => {
  test("rows = ?{...}.all() attaches sqlNode + chainedCalls", () => {
    const src = `<program>
\${
  server function loadAll() {
    rows = ?{\`SELECT 1\`}.all()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadAll");
    const decl = fn.body[0];
    expect(decl.kind).toBe("const-decl");
    expect(decl.sqlNode).toBeTruthy();
    expect(decl.sqlNode.chainedCalls).toBeArray();
    expect(decl.sqlNode.chainedCalls.length).toBe(1);
    expect(decl.sqlNode.chainedCalls[0].method).toBe("all");
  });

  test("user = ?{...}.get() attaches sqlNode + chainedCalls", () => {
    const src = `<program>
\${
  server function loadOne(id) {
    user = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadOne");
    const decl = fn.body[0];
    expect(decl.kind).toBe("const-decl");
    expect(decl.sqlNode.chainedCalls[0].method).toBe("get");
  });
});

// ---------------------------------------------------------------------------
// §3 Codegen — server fn body emits real SQL, NOT the nodeId=-1 sentinel
// ---------------------------------------------------------------------------

describe("§3 Codegen — bare result = ?{...} in server fn body", () => {
  test("emits await _scrml_sql init, not the fail-silent null sentinel", () => {
    const src = `<program db="./test.db">
<db src="./test.db" tables="tasks">
\${
  server function loadTasks() {
    result = ?{\`SELECT id, text FROM tasks\`}
    return result
  }
}
</>
</program>`;
    const { errors, serverJs } = compileSource(src, "bare-init");
    expect(errors.filter(e => e.severity === "error" || e.fatal)).toEqual([]);
    expect(serverJs).toBeTruthy();
    // The bug: the self-flagged sentinel must be gone.
    expect(serverJs).not.toContain("sql-ref unresolved");
    expect(serverJs).not.toContain("nodeId=-1");
    expect(serverJs).not.toMatch(/sql-ref:-?\d+/);
    // The fix: real SQL init bound to `result`.
    expect(serverJs).toContain("_scrml_sql");
    expect(serverJs).toMatch(/const result = await _scrml_sql/);
  });
});

// ---------------------------------------------------------------------------
// §4 Backwards compat — non-SQL bare assignment still produces tilde-decl
// ---------------------------------------------------------------------------

describe("§4 Backwards compat — non-SQL bare assignment unchanged", () => {
  test("total = 42 still produces a tilde-decl with initExpr, no sqlNode", () => {
    const src = `<program>
\${
  function plain() {
    total = 42
  }
}
</program>`;
    const fn = findFn(runAst(src), "plain");
    const decl = fn.body[0];
    expect(decl.kind).toBe("tilde-decl");
    expect(decl.sqlNode).toBeFalsy();
    expect(decl.initExpr).toBeTruthy();
    expect(decl.init).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// §5 E2E — the basic-load-hydrate conformance shape
// ---------------------------------------------------------------------------

describe("§5 E2E — server-fn conformance shape (bare result = ?{})", () => {
  test("server.js has real SQL + no sentinel; client.js does not leak _scrml_sql", () => {
    const src = `<program db="./test.db">
<db src="./test.db" tables="tasks">
\${
  type Task:struct = { id: number, text: string }
  <items> : Task[] = []
  function loadTasks() : Task[] {
    result = ?{\`SELECT id, text FROM tasks\`}
    return result
  }
}
<button id="load" onclick=@items = loadTasks()>Load</>
<p id="count">Count: \${@items.length}</p>
</>
</program>`;
    const { errors, serverJs, clientJs } = compileSource(src, "e2e-hydrate");
    expect(errors.filter(e => e.severity === "error" || e.fatal)).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).not.toMatch(/sql-ref:-?\d+/);
    expect(serverJs).not.toContain("sql-ref unresolved");
    expect(serverJs).toContain("_scrml_sql");
    expect(serverJs).toContain("_scrml_handler_loadTasks");
    // Security: the server-only SQL must NOT leak into client output.
    expect(errors.filter(e => e.code === "E-CG-006")).toEqual([]);
    if (clientJs) {
      expect(clientJs).not.toMatch(/\b_scrml_sql\s*[.`]/);
      expect(clientJs).not.toMatch(/sql-ref:-?\d+/);
    }
  });
});
