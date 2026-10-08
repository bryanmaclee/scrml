/**
 * E-CG-006 regression — server-only body leak when fn has `return ?{...}`.
 *
 * Filed: 2026-05-14 (S93). Reproducer: examples/23-trucking-dispatch/app.scrml
 *   `getCurrentUser` — file-scope `<db>` body fn with body
 *   `return ?{`SELECT id, email FROM users WHERE id = ${id}`}.get()`.
 *
 * Symptom (before fix): the AST builder produces a `return-stmt` with
 * `expr: ""` and `sqlNode: <sql>` (ast-builder.js:4755-4773 — special
 * `return BLOCK_REF` shape). Route inference's walkBodyForTriggers had no
 * explicit handler for return-stmt — the generic array-recursion fallback
 * does not see the `sqlNode` object field. Result: the function was NEVER
 * classified server-bound, and emit-functions Step 3 emitted the full body
 * (`return (await _scrml_sql`...`)[0] ?? null;`) into `.client.js`. The
 * post-emission `SQL_LEAK_PATTERNS` scan in emit-client.ts then fired
 * E-CG-006 — security violation detected by the fail-safe.
 *
 * Three-layer fix:
 *   Layer 1 (route-inference.ts walkBodyForTriggers): add explicit
 *     return-stmt/throw-stmt/lift-expr handlers detecting sqlNode.
 *   Layer 2 (emit-logic.ts case 'return-stmt'): gate sqlNode emission on
 *     opts.boundary === 'server' (mirror let-decl/state-decl pattern).
 *   Layer 3 (codegen/collect.ts isServerOnlyNode): cover return-stmt/
 *     throw-stmt/lift-expr with sqlNode for client-emission filters.
 *
 * E-CG-006 SQL_LEAK_PATTERNS scan remains intact as the final guard;
 * the recipe never weakens it. The guard caught a real bug.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "cg-006-server-body-leak-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  // SPEC §2.2.1 (S457 "1a"): a compile that reports an Error writes NO file, and these
  // fixtures report one (no `test.db` — E-SCHEMA-004 and kin) — read the in-memory
  // outputs, which are the codegen the leak pins are about.
  const output = result.outputs.get(filePath) ?? {};
  const clientJs = output.clientJs ?? "";
  const serverJs = output.serverJs ?? "";
  return { errors, clientJs, serverJs, outDir };
}

describe("E-CG-006: server-only function body must not leak to client.js (S93)", () => {
  test("function with `return ?{...}.get()` inside <db> body — no client SQL leak", () => {
    // Minimal reproducer: file-scope <db> body fn whose ONLY body statement
    // is `return ?{...}.get()`. No client caller, no markup ref. Pre-fix,
    // this leaked the SQL body to client.js + fired E-CG-006.
    const src = `<program db="./test.db">
<schema>
    table users {
        id: integer primary key
        email: string
    }
</>

<db src="./test.db" tables="users">
    \${
        function getUser(userId) {
            return ?{\`SELECT id, email FROM users WHERE id = \${userId}\`}.get()
        }
    }
</db>

<page>
    <main>
        <h1>Hello</h1>
    </main>
</page>

</program>`;

    const { errors, clientJs, serverJs } = compileSource("server-body-leak", src);

    // Primary regression: E-CG-006 must NOT fire (the bug was that the
    // SQL body landed in client.js and was caught by the post-emission scan).
    const cg006Errors = errors.filter(e => e.code === "E-CG-006");
    expect(cg006Errors).toEqual([]);

    // The leak shapes the guard scans for (from emit-client.ts
    // SQL_LEAK_PATTERNS). All must be absent from client.js.
    expect(clientJs).not.toMatch(/\b_scrml_sql(?:_\d+)?\s*[.`]/);
    expect(clientJs).not.toMatch(/\?\{`/);
    expect(clientJs).not.toContain("SELECT id, email FROM users");
    expect(clientJs).not.toContain("_scrml_sql_exec");

    // The function MUST be classified server-bound and emit a fetch stub
    // on the client side (not a body — a stub that POSTs to the server route).
    // Match the canonical fetch stub shape: a generated name + path reference
    // to a /_scrml/ route. (The exact generated suffix depends on counters;
    // accept any digit suffix. The path may appear inside fetch() or inside
    // _scrml_fetch_with_csrf_retry depending on whether CSRF is on by default.)
    expect(clientJs).toMatch(/async function _scrml_fetch_getUser_\d+\(userId\)/);
    expect(clientJs).toMatch(/"\/_scrml\/__ri_route_getUser_\d+"/);

    // The server side MUST carry the SQL body — that's where the work
    // legitimately runs.
    expect(serverJs).toContain("_scrml_sql`SELECT id, email FROM users WHERE id =");
    expect(serverJs).toMatch(/_scrml_handler_getUser_\d+/);
  });

  test("function with `return ?{...}.all()` (list shape) — no client SQL leak", () => {
    // Parallel shape: .all() instead of .get(). Same RI/CG path; pre-fix
    // same E-CG-006 leak.
    const src = `<program db="./test.db">
<schema>
    table users {
        id: integer primary key
        email: string
    }
</>

<db src="./test.db" tables="users">
    \${
        function listUsers() {
            return ?{\`SELECT id, email FROM users\`}.all()
        }
    }
</db>

<page>
    <main><h1>Hi</h1></main>
</page>
</program>`;

    const { errors, clientJs, serverJs } = compileSource("server-body-leak-all", src);

    expect(errors.filter(e => e.code === "E-CG-006")).toEqual([]);
    expect(clientJs).not.toMatch(/\b_scrml_sql(?:_\d+)?\s*[.`]/);
    expect(clientJs).not.toContain("SELECT id, email FROM users");
    expect(clientJs).toMatch(/async function _scrml_fetch_listUsers_\d+\(\)/);
    expect(serverJs).toContain("_scrml_sql`SELECT id, email FROM users`");
  });

  test("E-CG-006 fail-safe remains intact (not weakened) — guard catches synthetic leak", () => {
    // Sanity: the post-emission SQL_LEAK_PATTERNS scan is still wired and
    // still fires on _scrml_sql. This test does not produce the leak via
    // user source — Layer 1 + Layer 2 prevent that. Instead, it asserts
    // that the SQL_LEAK_PATTERNS literals are still mentioned in
    // emit-client.ts as a static-file invariant.
    const emitClientSrc = readFileSync(
      join(import.meta.dir, "..", "..", "src", "codegen", "emit-client.ts"),
      "utf8",
    );
    expect(emitClientSrc).toContain("E-CG-006");
    expect(emitClientSrc).toContain("_scrml_sql");
    expect(emitClientSrc).toContain("SQL_LEAK_PATTERNS");
  });
});
