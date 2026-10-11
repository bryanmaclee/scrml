/**
 * S462 P0 — unit pins for the CPS split's server tier and the per-batch cell plan.
 *
 * (1) THE TIER. A statement is server-tier when the escalation walker would escalate
 *     a function made of it alone (`buildCpsStatementServerProbe`): an ALIASED
 *     server-only import (`verifyPassword as vp`) and a server-only reference in a
 *     control-flow HEAD both count. Before S462 the CPS classifier keyed imports on
 *     the imported name and never read a head, so the login check landed client-side.
 * (2) DATA BY PLACEMENT. A statement that reads a local a server statement declared
 *     consumes server data and runs on the server too — the raw value never has to
 *     cross to the client.
 * (3) THE BATCH PLAN (`planBatchCellReturn`). The pre-S462 bare return is kept only
 *     for its exact shape; anything else returns the written cells' final values, and
 *     a write the batch cannot carry is listed for refusal.
 * The end-to-end proof is compiler/tests/integration/cps-server-logic-stays-server-s462.test.js.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runRI } from "../../src/route-inference.js";
import { planBatchCellReturn } from "../../src/codegen/cps-cell-writes.ts";

function ri(source) {
  const fileAST = buildAST(splitBlocks("/t/app.scrml", source));
  return runRI({ files: [fileAST], protectAnalysis: { views: new Map() } });
}

function splitOf(result) {
  for (const [, route] of result.routeMap.functions) if (route.cpsSplit) return route.cpsSplit;
  return null;
}

function bodyOf(source, fnName) {
  const r = buildAST(splitBlocks("/t/app.scrml", source));
  const ast = r.ast ?? r;
  let found = null;
  const seen = new WeakSet();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n) || found) return;
    seen.add(n);
    if (n.kind === "function-decl" && n.name === fnName) { found = n; return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
  };
  walk(ast);
  return found.body;
}

const LOGIN = `<program db="sqlite:./n1.db">
<out> = ""
\${ import { verifyPassword as vp } from "scrml:auth" }
function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!vp(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}
<button onclick={ login("x") }>l</button>
</program>
`;

describe("S462 — the CPS server tier", () => {
  test("an aliased server-only import in an `if` head puts the `if` on the server", () => {
    const split = splitOf(ri(LOGIN));
    expect(split).not.toBeNull();
    expect(split.serverStmtIndices).toEqual([0, 1]);
  });

  test("the same `if`, unaliased, is server-tier too", () => {
    const split = splitOf(ri(LOGIN.replace("verifyPassword as vp", "verifyPassword").replace("!vp(", "!verifyPassword(")));
    expect(split.serverStmtIndices).toEqual([0, 1]);
  });

  test("a `for` over a query is server-tier (the `?{}` lives in the iterable head)", () => {
    const split = splitOf(ri(`<program db="sqlite:./n1.db">
<last> = ""
<done> = false
function scan() {
  for (const r of ?{\`SELECT name FROM users\`}.all()) { @last = r.name }
  @done = true
}
<button onclick={ scan() }>s</button>
</program>
`));
    expect(split.serverStmtIndices).toEqual([0]);
  });

  test("a statement reading a server-declared local runs on the server; one that does not stays client", () => {
    const split = splitOf(ri(`<program db="sqlite:./n1.db">
<msg> = ""
<busy> = false
function f(n: string) {
  @busy = true
  const row = ?{\`SELECT name FROM users WHERE name = \${n}\`}.get()
  @msg = row.name
  @busy = false
}
<button onclick={ f("bob") }>x</button>
</program>
`));
    // 0 `@busy = true` client · 1 the query · 2 reads `row` → server · 3 client.
    expect(split.serverStmtIndices).toEqual([1, 2]);
    expect(split.clientStmtIndices).toContain(0);
    expect(split.clientStmtIndices).toContain(3);
  });

  test("a parameter shadowing the import is not the import", () => {
    const split = splitOf(ri(`<program db="sqlite:./n1.db">
<out> = ""
\${ import { verifyPassword as vp } from "scrml:auth" }
function f(vp: string) {
  @out = ?{\`SELECT name FROM users\`}.get()
  if (vp == "a") { @busy = 1 }
}
<button onclick={ f("a") }>x</button>
</program>
`));
    expect(split.serverStmtIndices).toEqual([0]);
  });
});

describe("S462 — planBatchCellReturn", () => {
  const SRC = (body) => `<program db="sqlite:./n1.db">
<a> = 0
<b> = 0
<o> = { k: 1 }
function f(x: number) {
${body}
}
<button onclick={ f(1) }>x</button>
</program>
`;

  test("one top-level write as the batch's last statement keeps the legacy bare return", () => {
    const body = bodyOf(SRC("  @a = ?{`SELECT 1 AS n`}.get()"), "f");
    expect(planBatchCellReturn(body, [0], "a")).toEqual({ mode: "legacy", cells: [], unsupported: [] });
  });

  test("a write followed by more server work returns the cells (the read must see the batch's value)", () => {
    const body = bodyOf(SRC("  @a = ?{`SELECT 1 AS n`}.get()\n  ?{`INSERT INTO t (v) VALUES (${@a})`}.run()"), "f");
    const plan = planBatchCellReturn(body, [0, 1], "a");
    expect(plan.mode).toBe("cells");
    expect(plan.cells).toEqual(["a"]);
  });

  test("two writes return both cells", () => {
    const body = bodyOf(SRC("  @a = ?{`SELECT 1 AS n`}.get()\n  @b = ?{`SELECT 2 AS n`}.get()"), "f");
    expect(planBatchCellReturn(body, [0, 1], "a").cells).toEqual(["a", "b"]);
  });

  test("a write nested in a server statement returns the cells", () => {
    const body = bodyOf(SRC("  if (?{`SELECT 1 AS n`}.get()) { @a = 1 } else { @b = 2 }"), "f");
    const plan = planBatchCellReturn(body, [0], null);
    expect(plan.mode).toBe("cells");
    expect(plan.cells).toEqual(["a", "b"]);
  });

  test("an in-place field write is listed for refusal", () => {
    const body = bodyOf(SRC("  const r = ?{`SELECT 1 AS n`}.get()\n  @o.k = r.n"), "f");
    const plan = planBatchCellReturn(body, [0, 1], null);
    expect(plan.unsupported.map((u) => u.cell)).toEqual(["o"]);
  });

  test("a `return` inside a cells-mode batch is listed for refusal; the legacy shape keeps it", () => {
    const cells = bodyOf(SRC("  if (?{`SELECT 1 AS n`}.get()) { @a = 1\n return 5 }"), "f");
    expect(planBatchCellReturn(cells, [0], null).unsupported.length).toBe(1);
    const legacy = bodyOf(SRC("  if (?{`SELECT 1 AS n`}.get()) { return 5 }"), "f");
    expect(planBatchCellReturn(legacy, [0], null)).toEqual({ mode: "legacy", cells: [], unsupported: [] });
  });
});
