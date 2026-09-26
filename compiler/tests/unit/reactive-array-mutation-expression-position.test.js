/**
 * §6.5.1 — an EXPRESSION-position mutating array method on a reactive cell
 * notifies the cell, exactly as the STATEMENT lowering does.
 *
 * SPEC §6.5.1: calling one of the mutating array methods (derived-mutation-ops.ts
 * ARRAY_MUTATING_METHODS — push pop shift unshift splice reverse sort fill
 * copyWithin) on a mutable reactive cell SHALL write the cell back through
 * `_scrml_reactive_set`, which triggers all subscribers.
 *
 * The statement form (`reactive-array-mutation`, emit-logic.ts) always emitted
 * `{ get(k).push(x); _scrml_reactive_set(k, get(k)); }`. Every expression form —
 * an inline handler, an arrow, a ternary / `&&` arm, a value-using position, a
 * block-bodied arrow or function expression (the string pipeline) — emitted the
 * bare in-place call, so only the Proxy's fine-grained effects saw it: a coarse
 * `_scrml_reactive_subscribe` subscriber (`when @items changes`, §6.7.4) never
 * fired. Runtime proof lives in
 * tests/browser/when-changes-dep-list.browser.test.js; this file pins the emitted
 * shape per position, the value-preservation contract, and the receivers that
 * must NOT be touched.
 *
 * Two lowering paths carry expression position, and both are covered:
 *   - the STRUCTURED path — emit-expr.ts emitCall (reactiveArrayMutationCell);
 *   - the STRING path — expression-parser.ts rewriteReactiveRefsAST (block-bodied
 *     arrows / function expressions, handler `@x = …` bodies), an ESTree rewrite.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { parseExprToNode, rewriteReactiveRefsAST } from "../../src/expression-parser.ts";
import { ARRAY_MUTATING_METHODS } from "../../src/derived-mutation-ops.ts";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const WRAP = (k, call) =>
  `((_scrml_m) => (_scrml_reactive_set(${JSON.stringify(k)}, _scrml_reactive_get(${JSON.stringify(k)})), _scrml_m))(${call})`;

function emit(src, ctx = {}) {
  return emitExpr(parseExprToNode(src, "/t.scrml", 0), { mode: "client", ...ctx });
}

function compile(body) {
  const TMP = mkdtempSync(join(tmpdir(), "ram-expr-"));
  try {
    const abs = join(TMP, "m.scrml");
    writeFileSync(abs, body);
    const out = join(TMP, "dist");
    const result = compileScrml({ inputFiles: [abs], outputDir: out, write: true, log: () => {} });
    const errors = (result.errors || []).filter((e) => e && (e.severity ?? "error") === "error");
    expect(errors.map((e) => e.code + " " + e.message)).toEqual([]);
    return foldChunkNamespacing(readFileSync(join(out, "m.client.js"), "utf8"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

const SET_ITEMS = `_scrml_reactive_set("items", _scrml_reactive_get("items"))`;

// ---------------------------------------------------------------------------
// Structured path — emit-expr.ts emitCall
// ---------------------------------------------------------------------------

describe("structured path (emitCall)", () => {
  test("a bare `@items.push(v)` notifies once and returns the call's value", () => {
    expect(emit("@items.push(v)")).toBe(WRAP("items", `_scrml_reactive_get("items").push(v)`));
  });

  for (const m of ARRAY_MUTATING_METHODS) {
    test(`all nine methods: \`@items.${m}(…)\``, () => {
      const out = emit(`@items.${m}(a, b)`);
      expect(out).toBe(WRAP("items", `_scrml_reactive_get("items").${m}(a, b)`));
      expect(count(out, `_scrml_reactive_set("items"`)).toBe(1);
    });
  }

  test("value-using: `n = @items.push(v)` keeps push's return", () => {
    expect(emit("n = @items.push(v)")).toBe(`n = ${WRAP("items", `_scrml_reactive_get("items").push(v)`)}`);
  });

  test("ternary arms each wrap independently", () => {
    expect(emit("c ? @items.push(v) : @items.pop()")).toBe(
      `c ? ${WRAP("items", `_scrml_reactive_get("items").push(v)`)} : ${WRAP("items", `_scrml_reactive_get("items").pop()`)}`,
    );
  });

  test("`&&` right operand", () => {
    expect(emit("c && @items.push(v)")).toBe(`c && ${WRAP("items", `_scrml_reactive_get("items").push(v)`)}`);
  });

  test("expression-bodied arrow", () => {
    expect(emit("() => @items.push(v)")).toContain(WRAP("items", `_scrml_reactive_get("items").push(v)`));
  });

  test("a nested mutation in an argument is wrapped once, inside the outer wrap", () => {
    const out = emit("@a.push(@b.pop())");
    expect(out).toBe(WRAP("a", `_scrml_reactive_get("a").push(${WRAP("b", `_scrml_reactive_get("b").pop()`)})`));
  });

  test("a non-mutating array method is untouched", () => {
    expect(emit("@items.slice(0)")).toBe(`_scrml_reactive_get("items").slice(0)`);
    expect(emit("@items.map(f)")).toBe(`_scrml_reactive_get("items").map(f)`);
  });

  test("a non-reactive receiver is untouched", () => {
    expect(emit("local.push(v)")).toBe("local.push(v)");
  });

  test("a deeper receiver is untouched — same as the statement form (§6.5.6)", () => {
    expect(emit("@obj.list.push(v)")).toBe(`_scrml_reactive_get("obj").list.push(v)`);
    expect(emit("@rows[0].tags.push(v)")).toBe(`_scrml_reactive_get("rows")[0].tags.push(v)`);
  });

  test("optional call / member is untouched", () => {
    expect(emit("@items?.push(v)")).not.toContain("_scrml_reactive_set");
    expect(emit("@items.push?.(v)")).not.toContain("_scrml_reactive_set");
  });

  test("server mode is untouched (no reactive store server-side)", () => {
    expect(emit("@items.push(v)", { mode: "server" })).toBe(`_scrml_body["items"].push(v)`);
  });

  test("a derived cell is untouched (read-only — E-DERIVED-VALUE-MUTATE owns it)", () => {
    expect(emit("@d.push(v)", { derivedNames: new Set(["d"]) })).toBe(`_scrml_derived_get("d").push(v)`);
  });

  test("an engine cell is untouched", () => {
    expect(emit("@phase.push(v)", { engineVarNames: new Set(["phase"]) })).not.toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// String path — expression-parser.ts rewriteReactiveRefsAST
// ---------------------------------------------------------------------------

describe("string path (rewriteReactiveRefsAST)", () => {
  const rw = (s, d = null) => {
    const r = rewriteReactiveRefsAST(s, d);
    expect(r.ok).toBe(true);
    return r.result;
  };

  test("block-bodied arrow statement is wrapped", () => {
    const out = rw("() => { @items.push(v) }");
    expect(count(out, SET_ITEMS)).toBe(1);
    expect(out).toContain(`_scrml_reactive_get("items").push(v)`);
  });

  test("function expression `return @items.shift()` keeps the returned value", () => {
    const out = rw("function () { return @items.shift() }");
    expect(out).toMatch(/return \(?\(?_scrml_m\)? => \(_scrml_reactive_set\("items", _scrml_reactive_get\("items"\)\), _scrml_m\)\)\(_scrml_reactive_get\("items"\)\.shift\(\)\)/);
  });

  test("the rewritten JS is valid and preserves push's return value at runtime", () => {
    const js = rw("n = @items.push(7)");
    const state = { items: [1, 2] };
    let sets = 0;
    const _scrml_reactive_get = (k) => state[k];
    const _scrml_reactive_set = (k, v) => { sets++; state[k] = v; return v; };
    let n;
    // eslint-disable-next-line no-eval
    eval(js);
    expect(n).toBe(3);
    expect(sets).toBe(1);
    expect(state.items).toEqual([1, 2, 7]);
  });

  for (const m of ARRAY_MUTATING_METHODS) {
    test(`all nine methods: \`@items.${m}(…)\``, () => {
      expect(count(rw(`x = @items.${m}(a)`), SET_ITEMS)).toBe(1);
    });
  }

  test("nested mutation wraps each exactly once", () => {
    const out = rw("@a.push(@b.pop())");
    expect(count(out, `_scrml_reactive_set("a"`)).toBe(1);
    expect(count(out, `_scrml_reactive_set("b"`)).toBe(1);
  });

  test("untouched: local receiver, deep receiver, non-mutating method, derived cell, optional", () => {
    expect(rw("() => { local.push(v); @x.slice(0) }")).not.toContain("_scrml_reactive_set");
    expect(rw("() => { @obj.list.push(v) }")).not.toContain("_scrml_reactive_set");
    expect(rw("() => { @d.push(v) }", new Set(["d"]))).not.toContain("_scrml_reactive_set");
    expect(rw("() => { @items?.push(v) }")).not.toContain("_scrml_reactive_set");
  });
});

// ---------------------------------------------------------------------------
// End to end — every position, and no double notify on the statement form
// ---------------------------------------------------------------------------

describe("end to end (compileScrml)", () => {
  const js = compile(`<program>
\${
  @items = []
  @obj = { list: [] }
  @last = 0
  @flag = true
  const v = 1
  let local = []
  when @items changes { @last = @last + 1 }
  function stmt() { @items.push(v) }
  function stmtIf(c) { if (c) @items.push(v) }
  function stmtLoop() { for (let i = 0; i < 2; i++) @items.push(i) }
  function valUse() { const n = @items.push(v); @last = n }
  function ret() { return @items.pop() }
  function deep() { @obj.list.push(v) }
  function alias() { const a = @items; a.push(v) }
  function loc() { local.push(v) }
  const fx = function() { return @items.shift() }
  const blk = () => { @items.unshift(v) }
}
<button onclick=\${@items.push(v)}>1</button>
<button onclick=\${() => @items.reverse()}>2</button>
<button onclick=\${() => { @items.sort() }}>3</button>
<button onclick=\${@flag ? @items.fill(0) : @items.splice(0, 1)}>4</button>
<button onclick=\${@flag && @items.copyWithin(0, 1)}>5</button>
<button onclick=\${@last = @items.push(v)}>6</button>
<button onclick=\${stmt()}>7</button>
<button onclick=\${stmtIf(1)}>8</button>
<button onclick=\${stmtLoop()}>9</button>
<button onclick=\${valUse()}>10</button>
<button onclick=\${ret()}>11</button>
<button onclick=\${deep()}>12</button>
<button onclick=\${alias()}>13</button>
<button onclick=\${loc()}>14</button>
<button onclick=\${fx()}>15</button>
<button onclick=\${blk()}>16</button>
<p>\${@items.length}</p>
</program>
`);

  // Every `.method(` on the `items` receiver is followed, in the same emitted
  // construct, by exactly one `_scrml_reactive_set("items", …)`.
  const mutations = [...ARRAY_MUTATING_METHODS].reduce(
    (n, m) => n + count(js, `_scrml_reactive_get("items").${m}(`), 0);

  test("every mutation of @items notifies @items exactly once", () => {
    // 6 inline handlers (push, reverse, sort, fill, splice, copyWithin, push = 7
    // calls) + stmt + stmtIf + stmtLoop + valUse + ret + fx + blk = 14.
    expect(mutations).toBe(14);
    expect(count(js, SET_ITEMS)).toBe(14);
  });

  test("the statement form keeps its block lowering and is not double-wrapped", () => {
    expect(js).toContain(`{ _scrml_reactive_get("items").push(v); ${SET_ITEMS}; }`);
    expect(js).toContain(`{ _scrml_reactive_get("items").push(i); ${SET_ITEMS}; }`);
    expect(js).not.toMatch(/_scrml_m\)\)\(_scrml_reactive_get\("items"\)\.push\(v\)\); _scrml_reactive_set/);
  });

  test("deep receiver, local alias and plain local are not notified", () => {
    expect(js).toContain(`_scrml_reactive_get("obj").list.push(v);`);
    expect(js).not.toContain(`_scrml_reactive_set("obj", _scrml_reactive_get("obj"))`);
    expect(js).toMatch(/\ba\.push\(v\);/);
    expect(js).toMatch(/\blocal\.push\(v\);/);
  });
});

// ---------------------------------------------------------------------------
// Field / index writes (§6.3, §6.6.18) — same notify shape, root cell key
// ---------------------------------------------------------------------------

describe("field / index write in expression position notifies the root cell", () => {
  const rw = (s) => rewriteReactiveRefsAST(s, null).result;

  for (const [src, inner] of [
    ["@o.x = @o.x + 1", `_scrml_reactive_get("o").x = _scrml_reactive_get("o").x + 1`],
    ["@o.n += 2", `_scrml_reactive_get("o").n += 2`],
    ["@o.n++", `_scrml_reactive_get("o").n++`],
    ["--@o.n", `--_scrml_reactive_get("o").n`],
    ["delete @o.tmp", `delete _scrml_reactive_get("o").tmp`],
    ["@o.a.b = 3", `_scrml_reactive_get("o").a.b = 3`],
    ["@rows[i].done = true", `_scrml_reactive_get("rows")[i].done = true`],
  ]) {
    test(`structured: \`${src}\``, () => {
      const root = src.match(/@(\w+)/)[1];
      expect(emit(src)).toBe(WRAP(root, inner));
    });
    test(`string path: \`${src}\``, () => {
      const root = src.match(/@(\w+)/)[1];
      const out = rw(src);
      expect(count(out, `_scrml_reactive_set("${root}", _scrml_reactive_get("${root}"))`)).toBe(1);
    });
  }

  test("a bare `@x = v` / `@x++` keeps its own reactive-set lowering (no wrap)", () => {
    expect(emit("@x = 1")).toBe(`_scrml_reactive_set("x", 1)`);
    expect(emit("@x++")).toBe(`_scrml_reactive_set("x", _scrml_reactive_get("x") + 1)`);
    expect(rw("@x = 1")).not.toContain("_scrml_m");
  });

  test("§6.5.7: a loop-alias / local path is untouched", () => {
    expect(emit("t.done = true")).toBe("t.done = true");
    expect(rw("() => { for (const t of @ts) { t.done = true } }")).not.toContain("_scrml_reactive_set");
  });

  test("server mode, derived root, optional chain are untouched", () => {
    expect(emit("@o.x = 1", { mode: "server" })).toBe(`_scrml_body["o"].x = 1`);
    expect(emit("@d.x = 1", { derivedNames: new Set(["d"]) })).not.toContain("_scrml_m");
  });

  test("the wrapped assignment keeps its value (assignment-expression result)", () => {
    const js = rw("n = (@o.x = 9)");
    const state = { o: { x: 1 } };
    let sets = 0;
    const _scrml_reactive_get = (k) => state[k];
    const _scrml_reactive_set = (k, v) => { sets++; state[k] = v; return v; };
    let n;
    // eslint-disable-next-line no-eval
    eval(js);
    expect(n).toBe(9);
    expect(state.o.x).toBe(9);
    expect(sets).toBe(1);
  });
});
