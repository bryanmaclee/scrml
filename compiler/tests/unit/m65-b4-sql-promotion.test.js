/**
 * m65-b4-sql-promotion.test.js — M6.5.b.4 (FIX-NATIVE, SECURITY).
 *
 * The native parser MUST promote a BARE `?{ ... }` SQL block at statement
 * position (inside `${...}` at non-server scope) to a first-class
 * `kind:"sql"` LogicStatement that matches the LIVE pipeline shape, rather
 * than wrapping it in `bare-expr` + `sql-ref`.
 *
 * WHY (security): the live W-CG-001 server-only detector
 * (codegen/collect.ts:isServerOnlyNode) classifies SQL as server-only by
 * `kind === "sql"` (collect.ts:420). The pre-fix native shape `bare-expr` +
 * `sql-ref` slipped through (its SQL_SIGIL_PATTERN test ran against the
 * sql-ref's comment-placeholder round-trip, which never matched) — letting
 * server-only SQL escape the server-only emission path. This is the
 * M6.7-STOP / 845-failure root-cause class.
 *
 * UNIT scope: AST-shape parity (native kind:"sql" === live kind:"sql") +
 * the documented-deferred CHAINED `?{...}.get()` form (still bare-expr, a
 * follow-on). The end-to-end client-leak assertion lives in the integration
 * test (m65-b4-sql-leak.test.js) which drives codegen.
 */
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";

// findLogicStatements — collect every logic.body[] statement in a FileAST,
// in document order, by walking the tree.
function findLogicStatements(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.kind === "logic" && Array.isArray(node.body)) {
    for (const s of node.body) out.push(s);
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => findLogicStatements(x, out));
    else if (v && typeof v === "object") findLogicStatements(v, out);
  }
  return out;
}

function firstSql(statements) {
  return statements.find((s) => s && s.kind === "sql");
}

function parseBoth(source) {
  const fp = "m65b4.scrml";
  const live = buildAST(splitBlocks(fp, source), null).ast;
  const native = nativeParseFile(fp, source).ast;
  return {
    liveStmts: findLogicStatements(live),
    nativeStmts: findLogicStatements(native),
  };
}

describe("M6.5.b.4 — bare ?{} statement promotion to kind:sql", () => {
  const BARE = `<program db="postgres"></>
\${
    ?{\`SELECT 1\`}
}
<p>x</>`;

  test("NATIVE promotes bare ?{} statement to a kind:sql LogicStatement", () => {
    const { nativeStmts } = parseBoth(BARE);
    const sql = firstSql(nativeStmts);
    expect(sql).toBeDefined();
    expect(sql.kind).toBe("sql");
  });

  test("NATIVE kind:sql shape matches LIVE (kind/query/chainedCalls)", () => {
    const { liveStmts, nativeStmts } = parseBoth(BARE);
    const liveSql = firstSql(liveStmts);
    const nativeSql = firstSql(nativeStmts);
    expect(liveSql).toBeDefined();
    expect(nativeSql).toBeDefined();
    // The query text MUST be extracted from the backtick fence — no `?{`,
    // no `}`, no backticks. Live and native MUST agree.
    expect(nativeSql.query).toBe("SELECT 1");
    expect(nativeSql.query).toBe(liveSql.query);
    // chainedCalls is [] for the bare form on BOTH pipelines.
    expect(Array.isArray(nativeSql.chainedCalls)).toBe(true);
    expect(nativeSql.chainedCalls.length).toBe(0);
    expect(nativeSql.chainedCalls).toEqual(liveSql.chainedCalls);
    // The full field set matches (id is counter-derived — compare the rest).
    const strip = (n) => {
      const { id, span, ...rest } = n;
      return rest;
    };
    expect(strip(nativeSql)).toEqual(strip(liveSql));
  });

  test("NATIVE no longer produces bare-expr+sql-ref for the bare ?{} statement", () => {
    const { nativeStmts } = parseBoth(BARE);
    const bareWithSqlRef = nativeStmts.find(
      (s) => s && s.kind === "bare-expr" && s.exprNode && s.exprNode.kind === "sql-ref",
    );
    expect(bareWithSqlRef).toBeUndefined();
  });

  test("the promoted query strips the ?{ / } delimiters and backtick fence", () => {
    const src = `<program db="postgres"></>
\${
    ?{\`SELECT id, name FROM users WHERE role = 'admin'\`}
}
<p>x</>`;
    const { nativeStmts } = parseBoth(src);
    const sql = firstSql(nativeStmts);
    expect(sql).toBeDefined();
    expect(sql.query).toBe("SELECT id, name FROM users WHERE role = 'admin'");
  });

  // --- DEFERRED: chained ?{...}.get() / .all() / .run() -----------------------
  // The chained form parses as a Call-headed expression (the Sql atom wrapped
  // in a postfix Member+Call chain), NOT a bare Sql atom. Faithful
  // chainedCalls reconstruction is a separable follow-on (SCOPING §3). This
  // test PINS the current deferred state so a future chained-promotion landing
  // updates it deliberately (it is NOT a leak: the SECONDARY isServerOnlyNode
  // hardening classifies the nested sql-ref as server-only — see the
  // integration leak test).
  test("DEFERRED: chained ?{}.run() stays bare-expr (documented follow-on)", () => {
    const src = `<program db="postgres"></>
\${
    ?{\`DELETE FROM t\`}.run()
}
<p>x</>`;
    const { nativeStmts } = parseBoth(src);
    // No kind:sql promotion for the chained form yet.
    expect(firstSql(nativeStmts)).toBeUndefined();
    const chained = nativeStmts.find(
      (s) => s && s.kind === "bare-expr" && s.exprNode && s.exprNode.kind === "call",
    );
    expect(chained).toBeDefined();
  });
});
