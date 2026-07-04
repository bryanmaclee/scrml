/**
 * Nested-function SQL server-escalation — g-sql-in-nested-function-client-leak.
 *
 * Filed: S225 (ss49 item 1), MED. Surfaced as an adjacent shape by the S224
 * Ryan #12 (`?{}`-in-arrow-body) agent.
 *
 * Symptom (before fix): a nested `function q(v){ ?{…} }` declared INSIDE another
 * function did NOT participate in §12 server-placement inference. Codegen emits
 * a nested function-decl INLINE inside its parent (codegen `collectFunctions`
 * does not recurse into nested bodies, so a nested decl never becomes its own
 * server route). The enclosing function therefore stayed client-bound and the
 * nested `?{}` SQL was either silently stubbed to `return null` (a SILENT data
 * drop) or tripped the loud E-CG-006 leak guard. Hoisting the same function to
 * a sibling top-level decl escalated cleanly — so a *legal* nested-function-
 * with-SQL pattern was rejected.
 *
 * Two-part fix:
 *   route-inference.ts walkBodyForTriggers — the function-decl case now recurses
 *     (a nested walkBodyForTriggers call) and merges the nested fn's
 *     server-escalation triggers (server-only-resource / protected-field-access)
 *     into the ENCLOSING fn, so the enclosing fn escalates to server. fn-in-fn-in-fn
 *     escalates the outermost via the recursion. A nested fn with NO server-only
 *     resource yields no trigger, so a genuinely-client helper never drags its
 *     parent server-side (the server/client partition holds).
 *   emit-logic.ts case "function-decl" — a nested fn whose emitted body contains
 *     a top-level `await` (the server-placed `?{}` lowers to `await _scrml_sql`)
 *     is emitted as `async function` so the `await` is valid JS (mirrors the
 *     meta-effect wrapper). On the client path the same body stubs SQL to
 *     `return null` (no await), so the fn stays synchronous.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "nested-fn-sql-escalation-"));
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
  let clientJs = "";
  let serverJs = "";
  try { clientJs = readFileSync(join(outDir, `${name}.client.js`), "utf8"); } catch { /* missing */ }
  try { serverJs = readFileSync(join(outDir, `${name}.server.js`), "utf8"); } catch { /* missing */ }
  return { errors, clientJs, serverJs, outDir };
}

describe("g-sql-in-nested-function-client-leak: nested-fn SQL escalates enclosing fn (S225)", () => {
  test("nested `function q(){ ?{...} }` inside a server-eligible parent — parent escalates, no client leak", () => {
    const src = `<program db="./test.db">
<schema>
    table items {
        id: integer primary key
        name: string
    }
</>

<db src="./test.db" tables="items">
    \${
        function getItem(id) {
            function q(v) {
                return ?{\`SELECT id, name FROM items WHERE id = \${v}\`}.get()
            }
            return q(id)
        }
    }
</db>

<page>
    <main><h1>Hi</h1></main>
</page>
</program>`;

    const { errors, clientJs, serverJs } = compileSource("nested-sql-case1", src);

    // No leak guard fired, and the emitted JS is valid (validate-emit gate).
    expect(errors.filter(e => e.code === "E-CG-006")).toEqual([]);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);

    // The nested SQL must NOT leak into the client bundle.
    expect(clientJs).not.toMatch(/\b_scrml_sql(?:_\d+)?\s*[.`]/);
    expect(clientJs).not.toContain("SELECT id, name FROM items");

    // The enclosing fn escalated to server: the client gets a fetch stub + route.
    expect(clientJs).toMatch(/async function _scrml_fetch_getItem_\d+\(id\)/);
    expect(clientJs).toMatch(/"\/_scrml\/__ri_route_getItem_\d+"/);

    // The SQL legitimately runs server-side, and the nested fn is emitted as an
    // `async function` (so its `await _scrml_sql` is valid JS).
    expect(serverJs).toContain("_scrml_sql`SELECT id, name FROM items WHERE id =");
    expect(serverJs).toMatch(/async function q\(v\)/);
    expect(serverJs).toMatch(/_scrml_handler_getItem_\d+/);
  });

  test("fn-in-fn-in-fn with `?{}` innermost — the outermost enclosing fn escalates", () => {
    const src = `<program db="./test.db">
<schema>
    table items {
        id: integer primary key
        name: string
    }
</>

<db src="./test.db" tables="items">
    \${
        function level1() {
            function level2() {
                function level3(v) {
                    return ?{\`SELECT id, name FROM items WHERE id = \${v}\`}.get()
                }
                return level3(1)
            }
            return level2()
        }
    }
</db>

<page>
    <main><h1>Hi</h1></main>
</page>
</program>`;

    const { errors, clientJs, serverJs } = compileSource("nested-sql-deep", src);

    expect(errors.filter(e => e.code === "E-CG-006")).toEqual([]);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);

    // No leak; the deeply-nested SQL lands server-side.
    expect(clientJs).not.toMatch(/\b_scrml_sql(?:_\d+)?\s*[.`]/);
    expect(clientJs).not.toContain("SELECT id, name FROM items");

    // The OUTERMOST fn (level1) escalated — its client form is a fetch stub.
    expect(clientJs).toMatch(/async function _scrml_fetch_level1_\d+\(\)/);

    // Both inner fns lower to `async function` server-side (await _scrml_sql).
    expect(serverJs).toMatch(/async function level2\(\)/);
    expect(serverJs).toMatch(/async function level3\(v\)/);
    expect(serverJs).toContain("_scrml_sql`SELECT id, name FROM items WHERE id =");
  });

  test("S215 partition: a genuinely-client nested helper does NOT escalate its parent", () => {
    // `outer` nests a PURE helper (no server-only resource) and is called by a
    // client handler that writes @state. The partition must hold — `outer` stays
    // client (no server route, no fetch stub for it).
    const src = `<program db="./test.db">
<schema>
    table items {
        id: integer primary key
        name: string
    }
</>

<db src="./test.db" tables="items">
    \${
        <count> = 0

        function outer() {
            function helper(x) { return x + 1 }
            return helper(5)
        }

        function bump() {
            @count = outer()
        }
    }
</db>

<page>
    <main>
        <button onclick=bump()>Go</button>
        <p>@count</p>
    </main>
</page>
</program>`;

    const { errors, clientJs, serverJs } = compileSource("nested-pure-partition", src);

    expect(errors.filter(e => e.code === "E-CG-006")).toEqual([]);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);

    // `outer` must stay client: no server route, no fetch stub.
    expect(serverJs).not.toMatch(/__ri_route_outer_\d+/);
    expect(clientJs).not.toMatch(/_scrml_fetch_outer_\d+/);

    // `outer` is emitted as a plain (non-async, non-stub) client function with
    // its pure helper inlined.
    expect(clientJs).toMatch(/function _scrml_outer_\d+\(\)/);
    expect(clientJs).toMatch(/function helper\(x\)/);
  });
});
