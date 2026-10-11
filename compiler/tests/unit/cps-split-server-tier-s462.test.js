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

  test("a `lin` declaration that calls a server function is server-tier (and so is its consumer)", () => {
    const split = splitOf(ri(`<program db="sqlite:./n1.db">
<result> = ""
<username> = ""
function mint(u: string) {
  ?{\`INSERT INTO t (u) VALUES (\${u})\`}.run()
  return "tk"
}
function redeem(lin ticket: string) { return ticket }
function login() {
  lin ticket = mint(@username)
  const message = redeem(ticket)
  @result = message
}
<button onclick={ login() }>x</button>
</program>
`));
    // Before S462 the `lin` was client-tier: the server statement `redeem(ticket)`
    // read a `ticket` that only existed in the browser.
    expect(split.serverStmtIndices).toEqual([0, 1, 2]);
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

describe("S462 P0 fix round 1 — the placement rule", () => {
  const prog = (fn, cells = "<row> = {}\n<busy> = false\n<n> = 0\n<rows> = []\n") => `<program db="sqlite:./n1.db">
${cells}${fn}
<button onclick={ f(1) }>x</button>
</program>
`;
  const errorsOf = (r) => (r.errors ?? []).filter((e) => e.code === "E-RI-002");

  test("(c) a client write between the producer and the consumer of a server value joins the batch — one batch", () => {
    const r = ri(prog(`function f(id: number) {
  @row = ?{\`SELECT role FROM users WHERE rowid = \${id}\`}.get()
  @busy = true
  if (@row.role == "admin") { ?{\`DELETE FROM secrets\`}.run() }
}`));
    const split = splitOf(r);
    expect(split.serverStmtIndices).toEqual([0, 1, 2]);
    expect((split.serverBatches ?? []).length).toBeLessThanOrEqual(1);
    expect(errorsOf(r)).toEqual([]);
  });

  test("a client write BEFORE the first server statement stays client (the spinner)", () => {
    const split = splitOf(ri(prog(`function f(id: number) {
  @busy = true
  @rows = ?{\`SELECT name FROM users\`}.all()
  @busy = false
}`)));
    expect(split.serverStmtIndices).toEqual([1]);
    expect(split.clientStmtIndices).toEqual(expect.arrayContaining([0, 2]));
  });

  test("a browser-only statement that only READS a server-written cell stays client — no refusal", () => {
    const r = ri(prog(`function f(id: number) {
  @rows = ?{\`SELECT name FROM users\`}.all()
  localStorage.setItem("n", @rows.length)
}`));
    expect(splitOf(r).serverStmtIndices).toEqual([0]);
    expect(errorsOf(r)).toEqual([]);
  });

  test("a browser-only statement that reads a server LOCAL is refused (E-RI-002)", () => {
    const r = ri(prog(`function f(id: number) {
  const row = ?{\`SELECT name FROM users WHERE rowid = \${id}\`}.get()
  localStorage.setItem("n", row.name)
  @n = 1
}`));
    const e = errorsOf(r);
    expect(e.length).toBe(1);
    expect(e[0].message).toContain("`row`");
    expect(e[0].message).toContain("`localStorage`");
  });

  test("a browser-only statement between a producer and a consumer is refused (E-RI-002)", () => {
    const r = ri(prog(`function f(id: number) {
  @row = ?{\`SELECT role FROM users WHERE rowid = \${id}\`}.get()
  localStorage.setItem("checking", "1")
  if (@row.role == "admin") { ?{\`DELETE FROM secrets\`}.run() }
}`));
    const e = errorsOf(r);
    expect(e.length).toBe(1);
    expect(e[0].message).toContain("`@row`");
  });

  test("(d) a browser statement that derives a value from a server value, read by later server work, is refused", () => {
    const r = ri(prog(`function f(id: number) {
  @row = ?{\`SELECT role FROM users WHERE rowid = \${id}\`}.get()
  @busy = localStorage.getItem(@row.role) == "x"
  const z = @busy
  if (z) { ?{\`DELETE FROM secrets\`}.run() }
}`));
    const e = errorsOf(r);
    expect(e.length).toBe(1);
    // Blames the browser statement (line 2 of the body), names the server value and the derived one.
    expect(e[0].message).toContain("`@row`");
    expect(e[0].message).toContain("`localStorage`");
    expect(e[0].message).toMatch(/later server work reads `(z|@busy)`/);
  });

  test("(d) a browser statement deriving from a server value with NO later server reader is not refused", () => {
    const r = ri(prog(`function f(id: number) {
  @row = ?{\`SELECT role FROM users WHERE rowid = \${id}\`}.get()
  @busy = localStorage.getItem(@row.role) == "x"
}`));
    expect(errorsOf(r)).toEqual([]);
  });

  test("allow-list: a statement naming a global not known to behave the same on the server is not moved — refused", () => {
    const r = ri(prog(`function f(id: number) {
  @row = ?{\`SELECT role FROM users WHERE rowid = \${id}\`}.get()
  @n = setTimeout(() => {}, 0)
  if (@row.role == "admin") { ?{\`DELETE FROM secrets\`}.run() }
}`));
    const e = errorsOf(r);
    expect(e.length).toBe(1);
    expect(e[0].message).toContain("`setTimeout`");
  });

  test("allow-list: pure computation over locals, params, cells and isomorphic globals still moves — one batch", () => {
    const r = ri(prog(`function f(id: number) {
  @row = ?{\`SELECT role FROM users WHERE rowid = \${id}\`}.get()
  @n = Math.max(id, JSON.stringify(@row).length, [1, 2].map((v) => v * 2)[0])
  if (@row.role == "admin" && @n > 0) { ?{\`DELETE FROM secrets\`}.run() }
}`));
    expect(errorsOf(r)).toEqual([]);
    expect(splitOf(r).serverStmtIndices).toEqual([0, 1, 2]);
  });

  // S465 — §19.9.9.8 rule 4: "Statements before the function's first server
  // statement are never moved". The local is CLIENT data: it stays in the browser
  // and travels with the request (`carriedLocals`), like a parameter. (Before S465
  // this test pinned the statement moving to the server.)
  test("a client local declared BEFORE the first server statement stays client and is carried", () => {
    const split = splitOf(ri(prog(`function f(id: number) {
  const y = @n + 1
  @rows = ?{\`SELECT name FROM users WHERE rowid = \${y}\`}.all()
}`)));
    expect(split.serverStmtIndices).toEqual([1]);
    expect(split.carriedLocals).toEqual(["y"]);
  });

  test("a client local declared AFTER the first server statement moves to the server with its reader", () => {
    const split = splitOf(ri(prog(`function f(id: number) {
  @rows = ?{\`SELECT name FROM users\`}.all()
  const y = id + 1
  ?{\`DELETE FROM users WHERE rowid = \${y}\`}.run()
}`)));
    expect(split.serverStmtIndices).toEqual([0, 1, 2]);
    expect(split.carriedLocals).toEqual([]);
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
