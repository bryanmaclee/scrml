/**
 * lift+SQL Chained-Call Codegen — Regression Tests (S40, fix-lift-sql-chained-call)
 *
 * Reproducer (pre-fix):
 *   server function loadContacts() {
 *     lift ?{`SELECT id, name FROM contacts ORDER BY name`}.all()
 *   }
 *
 * Pre-fix emitted server JS:
 *   return null; (comment: server-lift non-expr form)
 *   . all ( );    [orphan, syntax error]
 *
 * Post-fix emitted server JS (per SPEC §44.3 / §10):
 *   return await _scrml_sql`SELECT id, name FROM contacts ORDER BY name`;
 *
 * Root causes (both in compiler/src/ast-builder.js, fixed by 4074ea3):
 *   1. The `lift` + BLOCK_REF branch wrapped the SQL child as
 *      `expr.kind === "markup"` (lying about content kind — SQL is not markup).
 *   2. The trailing `.method()` chain was not consumed and fell through to the
 *      parent token stream as a sibling bare-expr.
 *
 * Codegen wiring in compiler/src/codegen/emit-logic.ts (fixed by 5195c4b):
 *   The lift-expr handler now recognises `liftE.kind === "sql"` and recurses on
 *   the SQL child to reuse the existing `case "sql":` emission.
 *
 * Coverage:
 *   §1  AST shape — `lift ?{}.all()` produces lift-expr.expr.kind === "sql" with chainedCalls
 *   §2  AST shape — `.get()` and `.run()` chains preserved
 *   §3  AST shape — markup BLOCK_REF (no SQL) still wraps as `kind: "markup"` (no regression)
 *   §4  emit-logic — server boundary `.all()` produces `return await sql\`...\``
 *   §5  emit-logic — server boundary `.get()` produces `return (await sql\`...\`)[0] ?? null`
 *   §6  emit-logic — server boundary `.run()` produces `return await sql\`...\``
 *   §7  E2E — examples-style server function compiles and produces parseable JS
 *   §8  No orphan `. all ( );` / `. get ( );` after fix
 *   §9  Bare `?{}.method()` at non-lift sites — parseOneStatement + buildBlock body-loop
 *       (S40 follow-up: fix-lift-sql-chained-call-parallel-sites — closes the same
 *        IDENT-only bug at the 2 BLOCK_REF sites that don't go through the `lift`
 *        keyword path; previously, KEYWORD method names like `.get()` would be left
 *        orphan in the parent token stream because both inline duplicate loops only
 *        accepted IDENT method tokens.)
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
  const tag = testName ?? `liftsql-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_liftsql_${tag}`);
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
  const bs = splitBlocks("lift-sql.scrml", src);
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

// Parse server JS as an ES module. `new Function()` rejects top-level
// import/export, so we use Bun.Transpiler.scan() — it parses ES module
// syntax and throws on real syntax errors (verified empirically).
function parseServerJs(js) {
  return new Bun.Transpiler({ loader: "js" }).scan(js);
}

// ---------------------------------------------------------------------------
// §1  AST shape — lift ?{}.all() produces lift-expr.expr.kind === "sql"
// ---------------------------------------------------------------------------

describe("§1 AST shape — lift ?{}.all() produces sql-variant lift-expr", () => {
  test("server function with lift ?{...}.all() — single lift-expr, no orphan bare-expr", () => {
    const src = `<program>
\${
  server function loadRows() {
    lift ?{\`SELECT id FROM things\`}.all()
  }
}
</program>`;
    const ast = runAst(src);
    const fn = findFn(ast, "loadRows");
    expect(fn).toBeTruthy();
    expect(fn.body.length).toBe(1);  // exactly ONE statement, no orphan sibling
    const lift = fn.body[0];
    expect(lift.kind).toBe("lift-expr");
    expect(lift.expr.kind).toBe("sql");  // not "markup"
    expect(lift.expr.node.kind).toBe("sql");
    expect(lift.expr.node.query).toContain("SELECT id FROM things");
  });

  test("chained .all() is consumed onto the SQL node's chainedCalls", () => {
    const src = `<program>
\${
  server function loadRows() {
    lift ?{\`SELECT 1\`}.all()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadRows");
    const sqlNode = fn.body[0].expr.node;
    expect(sqlNode.chainedCalls).toBeArray();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// §2  AST shape — .get() and .run() chains preserved
// ---------------------------------------------------------------------------

describe("§2 AST shape — .get() and .run() chains attached", () => {
  test(".get() chained call is captured", () => {
    const src = `<program>
\${
  server function loadOne(id) {
    lift ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
  }
}
</program>`;
    const fn = findFn(runAst(src), "loadOne");
    expect(fn.body.length).toBe(1);
    const sqlNode = fn.body[0].expr.node;
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("get");
  });

  test(".run() chained call is captured", () => {
    const src = `<program>
\${
  server function purgeAll() {
    lift ?{\`DELETE FROM tmp\`}.run()
  }
}
</program>`;
    const fn = findFn(runAst(src), "purgeAll");
    expect(fn.body.length).toBe(1);
    const sqlNode = fn.body[0].expr.node;
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("run");
  });
});

// ---------------------------------------------------------------------------
// §3  AST shape — markup BLOCK_REF still wraps as kind: "markup" (no regression)
// ---------------------------------------------------------------------------

describe("§3 AST shape — markup BLOCK_REF lift unchanged", () => {
  test("`lift <li>...</>` still produces lift-expr.expr.kind === 'markup'", () => {
    const src = `<program>
<ul>\${
  for (let item of items) {
    lift <li>\${item}</li>
  }
}</ul>
</program>`;
    const ast = runAst(src);
    function findLift(nodes) {
      for (const n of nodes ?? []) {
        if (!n) continue;
        if (n.kind === "lift-expr") return n;
        for (const k of ["body", "consequent", "alternate", "children", "nodes"]) {
          const v = n[k];
          if (Array.isArray(v)) {
            const r = findLift(v);
            if (r) return r;
          }
        }
      }
      return null;
    }
    const lift = findLift(ast.nodes);
    expect(lift).toBeTruthy();
    expect(lift.expr.kind).toBe("markup");  // not "sql"
  });
});

// ---------------------------------------------------------------------------
// §4  emit-logic — server boundary .all() emits return-await form
// ---------------------------------------------------------------------------

describe("§4 emit-logic — server boundary .all() emits return-await form", () => {
  test("lift-expr {kind:'sql'} with .all() emits return await _scrml_sql`...`;", () => {
    const node = {
      kind: "lift-expr",
      expr: {
        kind: "sql",
        node: {
          kind: "sql",
          query: "SELECT id, name FROM contacts ORDER BY name",
          chainedCalls: [{ method: "all", args: "" }],
        },
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toBe("return await _scrml_sql`SELECT id, name FROM contacts ORDER BY name`;");
  });

  test("emission has no orphan `. all`", () => {
    const node = {
      kind: "lift-expr",
      expr: {
        kind: "sql",
        node: {
          kind: "sql",
          query: "SELECT 1",
          chainedCalls: [{ method: "all", args: "" }],
        },
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).not.toMatch(/^\s*\.\s*all/);
    expect(out).not.toContain("return null");
    expect(out).not.toContain("server-lift: non-expr form");
  });
});

// ---------------------------------------------------------------------------
// §5  emit-logic — server boundary .get() emits singleton-or-null
// ---------------------------------------------------------------------------

describe("§5 emit-logic — server boundary .get() emits singleton-or-null", () => {
  test("lift-expr {kind:'sql'} with .get() and ${param} emits return (await sql`...`)[0] ?? null;", () => {
    const node = {
      kind: "lift-expr",
      expr: {
        kind: "sql",
        node: {
          kind: "sql",
          query: "SELECT id, name FROM users WHERE id = ${userId}",
          chainedCalls: [{ method: "get", args: "" }],
        },
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toBe("return (await _scrml_sql`SELECT id, name FROM users WHERE id = ${userId}`)[0] ?? null;");
  });
});

// ---------------------------------------------------------------------------
// §6  emit-logic — server boundary .run()
// ---------------------------------------------------------------------------

describe("§6 emit-logic — server boundary .run()", () => {
  test("lift-expr {kind:'sql'} with .run() emits return await sql`...`;", () => {
    const node = {
      kind: "lift-expr",
      expr: {
        kind: "sql",
        node: {
          kind: "sql",
          query: "DELETE FROM tmp WHERE id = ${id}",
          chainedCalls: [{ method: "run", args: "" }],
        },
      },
    };
    const out = emitLogicNode(node, { boundary: "server" });
    expect(out).toBe("return await _scrml_sql`DELETE FROM tmp WHERE id = ${id}`;");
  });
});

// ---------------------------------------------------------------------------
// §7  E2E — examples-style server function compiles and parses
// ---------------------------------------------------------------------------

describe("§7 E2E — full pipeline produces parseable server JS", () => {
  test("server function with lift ?{}.all() compiles to syntactically valid JS", () => {
    const src = `<program db="./test.db">
\${
  server function loadContacts() {
    lift ?{\`SELECT id, name, email FROM contacts ORDER BY name\`}.all()
  }
}
<div>contacts</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "loadContacts-all");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    // Must contain the canonical Bun.SQL emission (§44.3).
    expect(serverJs).toContain("return await _scrml_sql`SELECT id, name, email FROM contacts ORDER BY name`;");
    // Must NOT contain the broken pre-fix shape.
    expect(serverJs).not.toContain("server-lift: non-expr form");
    expect(serverJs).not.toMatch(/^\s*\.\s*all\s*\(/m);
    // Must parse (no syntax error). new Function() throws on parse failure.
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });

  test("server function with lift ?{}.get() compiles cleanly", () => {
    const src = `<program db="./test.db">
\${
  server function loadOne(id) {
    lift ?{\`SELECT id, name FROM users WHERE id = \${id}\`}.get()
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "loadOne-get");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("return (await _scrml_sql`SELECT id, name FROM users WHERE id = ${id}`)[0] ?? null;");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });

  test("server function with lift ?{}.run() compiles cleanly", () => {
    const src = `<program db="./test.db">
\${
  server function purge(id) {
    lift ?{\`DELETE FROM tmp WHERE id = \${id}\`}.run()
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "purge-run");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("return await _scrml_sql`DELETE FROM tmp WHERE id = ${id}`;");
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §8  No orphan `. all ( );` / `. get ( );` anywhere in the output
// ---------------------------------------------------------------------------

describe("§8 No orphan chained-call statement after fix", () => {
  test("emitted server JS for lift+SQL contains zero orphan `.method ( );` statements", () => {
    const src = `<program db="./test.db">
\${
  server function a() { lift ?{\`SELECT 1\`}.all() }
  server function b() { lift ?{\`SELECT 2\`}.get() }
  server function c() { lift ?{\`SELECT 3\`}.run() }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "no-orphan");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    // Negative assertion: an orphan `.method ( )` line indicates the chained call
    // was left in the parent token stream rather than attached to the SQL node.
    expect(serverJs).not.toMatch(/^\s*\.\s*(all|get|run)\s*\(/m);
    // The full server bundle must parse.
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});


// ---------------------------------------------------------------------------
// §9  Bare `?{}.method()` at the 2 non-lift BLOCK_REF sites in parseLogicBody
//
// These exercise the parseOneStatement BLOCK_REF case (Site A) and the
// buildBlock body-loop BLOCK_REF case (Site B). Both sites previously
// duplicated the chain-consumption loop with an IDENT-only method-name check
// that would skip KEYWORD-tokenized methods like .get() and .set(). The
// helper consumeSqlChainedCalls (S40, baccf56) accepts both IDENT and
// KEYWORD; this change applies it at both bare-BLOCK_REF sites too.
//
// Site A: bare ?{}.method() inside a function body
//   server function fnA() { ?{`SELECT 1`}.all() }
//   parseRecursiveBody → parseOneStatement → BLOCK_REF case
//
// Site B: bare ?{}.method() at the top level of a ${} logic block
//   ${ ?{`SELECT 1`}.run() }
//   parseLogicBody outer while-loop → BLOCK_REF case
// ---------------------------------------------------------------------------

// Walk a logic block (`kind: "logic"`) and return its `body` array. Used for
// Site B tests, where the SQL node lives directly under the logic-block body
// rather than inside a function-decl.
function findLogicBody(ast) {
  function walk(nodes) {
    for (const n of nodes ?? []) {
      if (!n) continue;
      if (n.kind === "logic" && Array.isArray(n.body)) return n.body;
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

describe("§9 Bare `?{}.method()` — parseOneStatement BLOCK_REF case (Site A)", () => {
  test("§9.1 `?{...}.all()` inside a server function — chainedCalls captured, no orphan sibling", () => {
    const src = `<program db="./test.db">
\${
  server function fnA() {
    ?{\`SELECT 1\`}.all()
  }
}
<div>x</div>
</program>`;
    const ast = runAst(src);
    const fn = findFn(ast, "fnA");
    expect(fn).toBeTruthy();
    // Exactly ONE statement — no orphan bare-expr sibling holding the .all() chain.
    expect(fn.body.length).toBe(1);
    const sqlNode = fn.body[0];
    expect(sqlNode.kind).toBe("sql");
    expect(sqlNode.query).toContain("SELECT 1");
    expect(sqlNode.chainedCalls).toBeArray();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("all");
  });

  test("§9.2 `?{...}.get()` inside a server function — KEYWORD method captured, no orphan sibling", () => {
    // .get() is the previously-buggy case at this site: `get` tokenizes as
    // KEYWORD (tokenizer.ts:62), and the pre-fix inline loop only matched IDENT.
    const src = `<program db="./test.db">
\${
  server function fnB() {
    ?{\`SELECT 1\`}.get()
  }
}
<div>x</div>
</program>`;
    const ast = runAst(src);
    const fn = findFn(ast, "fnB");
    expect(fn).toBeTruthy();
    expect(fn.body.length).toBe(1);
    const sqlNode = fn.body[0];
    expect(sqlNode.kind).toBe("sql");
    expect(sqlNode.chainedCalls).toBeArray();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("get");
    // Negative: no sibling bare-expr holding the orphan ".get()" tokens.
    const orphans = fn.body.filter(n => n && n.kind === "bare-expr");
    expect(orphans).toEqual([]);
  });

  test("§9.2b `?{...}.get()` — server JS emits singleton-or-null form (no orphan dot-statement)", () => {
    // Codegen check for the previously-latent KEYWORD path. With the fix,
    // .get() inside a server function compiles to the canonical
    // `(await sql\`...\`)[0] ?? null` shape (per emit-logic.ts).
    const src = `<program db="./test.db">
\${
  server function fnB() {
    ?{\`SELECT id FROM users WHERE id = 1\`}.get()
  }
}
<div>x</div>
</program>`;
    const { errors, serverJs } = compileSource(src, "bare-get-server");
    expect(errors).toEqual([]);
    expect(serverJs).toBeTruthy();
    expect(serverJs).toContain("(await _scrml_sql`SELECT id FROM users WHERE id = 1`)[0] ?? null");
    // Pre-fix shape would have left a bare `. get ( )` line in the handler body.
    expect(serverJs).not.toMatch(/^\s*\.\s*get\s*\(/m);
    expect(() => parseServerJs(serverJs)).not.toThrow();
  });
});

describe("§9 Bare `?{}.method()` — buildBlock body-loop BLOCK_REF case (Site B)", () => {
  test("§9.3 `?{...}.run()` at top-level \${} — chainedCalls captured, no orphan sibling", () => {
    const src = `<program db="./test.db">
\${
  ?{\`DELETE FROM tmp\`}.run()
}
<div>x</div>
</program>`;
    const ast = runAst(src);
    const body = findLogicBody(ast);
    expect(body).toBeTruthy();
    // The logic body should contain exactly one node (the SQL), not two
    // (SQL + orphan bare-expr).
    expect(body.length).toBe(1);
    const sqlNode = body[0];
    expect(sqlNode.kind).toBe("sql");
    expect(sqlNode.query).toContain("DELETE FROM tmp");
    expect(sqlNode.chainedCalls).toBeArray();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("run");
  });

  test("§9.4 `?{...}.get()` at top-level \${} — KEYWORD method captured, no orphan sibling", () => {
    // The previously-buggy KEYWORD case at Site B. Pre-fix: `.get()` would
    // fall through to the parent stream and be parsed as an orphan bare-expr,
    // producing a sibling node. Post-fix: chain is consumed by the helper.
    const src = `<program db="./test.db">
\${
  ?{\`SELECT 1\`}.get()
}
<div>x</div>
</program>`;
    const ast = runAst(src);
    const body = findLogicBody(ast);
    expect(body).toBeTruthy();
    expect(body.length).toBe(1);
    const sqlNode = body[0];
    expect(sqlNode.kind).toBe("sql");
    expect(sqlNode.chainedCalls).toBeArray();
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("get");
    // Negative: no sibling bare-expr holding the orphan `.get()` tokens.
    const orphans = body.filter(n => n && n.kind === "bare-expr");
    expect(orphans).toEqual([]);
  });

  test("§9.5 `?{...}.run().nobatch()` at top-level \${} — chained .nobatch marker still honored", () => {
    // The helper has special-case behavior for `.nobatch()` (§8.9.5): instead
    // of pushing onto chainedCalls, it sets sqlNode.nobatch = true. Verify
    // that special-case still fires through the helper at Site B.
    const src = `<program db="./test.db">
\${
  ?{\`INSERT INTO logs VALUES (1)\`}.run().nobatch()
}
<div>x</div>
</program>`;
    const ast = runAst(src);
    const body = findLogicBody(ast);
    expect(body).toBeTruthy();
    expect(body.length).toBe(1);
    const sqlNode = body[0];
    expect(sqlNode.kind).toBe("sql");
    // .run() landed on chainedCalls (one entry), .nobatch() flipped the flag.
    expect(sqlNode.chainedCalls.length).toBe(1);
    expect(sqlNode.chainedCalls[0].method).toBe("run");
    expect(sqlNode.nobatch).toBe(true);
  });
});
