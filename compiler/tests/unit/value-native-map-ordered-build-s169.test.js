/**
 * S169 — `@ordered` value-native map builds ordered (§59.2 / §59.8).
 *
 * The bug: every `emitMapLit` emission hardcoded the runtime `ordered` flag to
 * `false`, so an `@ordered`-typed cell (`<m>: [K: V]@ordered = [...]`) was built
 * UNORDERED. The ordered-ness of a map VALUE is a property of the TARGET CELL's
 * type, not of the literal, so codegen threads the target cell's `@ordered`-ness
 * to the OUTERMOST literal emission:
 *
 *   - `emitMapLit` reads the transient `ctx.emitMapLitOrdered` flag (cleared for
 *     the recursion into entry keys/values so NESTED map-VALUE literals stay
 *     unordered — a separate known v1 gap).
 *   - `emitAssign` sets the flag for a reassignment `@m = [...]` whose target
 *     cell is in `ctx.orderedMapVarNames`.
 *   - `collectOrderedMapVarNames` is the file-level `@ordered`-typed subset of
 *     `collectMapVarNames` that drives the threading.
 *
 * These tests exercise the emit-level + collector-level seams directly (an
 * end-to-end compile assertion lives in the integration suite). The runtime is
 * untouched: `_scrml_map_from_entries(pairs, ordered)` already honors `true`.
 */

import { describe, test, expect } from "bun:test";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { collectOrderedMapVarNames, collectMapVarNames } from "../../src/codegen/reactive-deps.ts";

// AST builders mirroring value-native-map-codegen-emit-d4.test.js.
const litStr = (s) => ({ kind: "lit", litType: "string", raw: JSON.stringify(s), value: s });
const litNum = (n) => ({ kind: "lit", litType: "number", raw: String(n), value: n });
const atIdent = (name) => ({ kind: "ident", name: `@${name}` });
const mapLit = (entries) => ({ kind: "map-lit", entries });
const entry = (k, v) => ({ key: k, value: v });

function assertValidJs(jsExpr) {
  expect(() => new Function(`return (${jsExpr});`)).not.toThrow();
}

// ---------------------------------------------------------------------------
// §A  emitMapLit — the transient `emitMapLitOrdered` flag drives the runtime
//     `ordered` argument.
// ---------------------------------------------------------------------------

describe("emitMapLit — ordered flag emission (S169)", () => {
  test("DEFAULT (no flag) lowers the empty map [:] unordered", () => {
    const js = emitExpr(mapLit([]), { mode: "client" });
    expect(js).toBe("_scrml_map_from_entries([], false)");
    assertValidJs(js);
  });

  test("DEFAULT (no flag) lowers a non-empty literal unordered", () => {
    const js = emitExpr(mapLit([entry(litStr("b"), litNum(2)), entry(litStr("a"), litNum(1))]), { mode: "client" });
    expect(js).toBe('_scrml_map_from_entries([["b", 2], ["a", 1]], false)');
    assertValidJs(js);
  });

  test("emitMapLitOrdered:true lowers the empty map [:] ORDERED", () => {
    const js = emitExpr(mapLit([]), { mode: "client", emitMapLitOrdered: true });
    expect(js).toBe("_scrml_map_from_entries([], true)");
    assertValidJs(js);
  });

  test("emitMapLitOrdered:true lowers a non-empty literal ORDERED", () => {
    const js = emitExpr(mapLit([entry(litStr("b"), litNum(2)), entry(litStr("a"), litNum(1))]), { mode: "client", emitMapLitOrdered: true });
    expect(js).toBe('_scrml_map_from_entries([["b", 2], ["a", 1]], true)');
    assertValidJs(js);
  });

  test("emitMapLitOrdered:false lowers unordered (explicit false)", () => {
    const js = emitExpr(mapLit([entry(litStr("a"), litNum(1))]), { mode: "client", emitMapLitOrdered: false });
    expect(js).toContain(", false)");
    assertValidJs(js);
  });

  test("a NESTED map-VALUE literal stays UNORDERED even when the outer is ordered", () => {
    // `["outer": ["b": 2, "a": 1]]` — outer ordered, inner value-map unordered.
    const inner = mapLit([entry(litStr("b"), litNum(2)), entry(litStr("a"), litNum(1))]);
    const outer = mapLit([entry(litStr("outer"), inner)]);
    const js = emitExpr(outer, { mode: "client", emitMapLitOrdered: true });
    // Outermost ordered, the inner stays unordered (per-value @ordered is a
    // separate v1 gap — codegen has no per-value annotation).
    expect(js).toBe('_scrml_map_from_entries([["outer", _scrml_map_from_entries([["b", 2], ["a", 1]], false)]], true)');
    // Exactly one `true` (the outer) and one `false` (the inner).
    expect(js.match(/, true\)/g)?.length).toBe(1);
    expect(js.match(/, false\)/g)?.length).toBe(1);
    assertValidJs(js);
  });
});

// ---------------------------------------------------------------------------
// §B  emitAssign — a reassignment `@m = [...]` to an @ordered cell lowers the
//     RHS literal ordered; a reassignment to a non-ordered cell stays unordered.
// ---------------------------------------------------------------------------

function assign(targetName, valueNode) {
  return { kind: "assign", op: "=", target: atIdent(targetName), value: valueNode };
}

describe("emitAssign — reassignment to an @ordered cell (S169)", () => {
  test("@m = [...] where m is @ordered lowers the RHS ORDERED", () => {
    const node = assign("m", mapLit([entry(litStr("b"), litNum(2)), entry(litStr("a"), litNum(1))]));
    const js = emitExpr(node, {
      mode: "client",
      mapVarNames: new Set(["m"]),
      orderedMapVarNames: new Set(["m"]),
    });
    expect(js).toContain('_scrml_reactive_set("m", _scrml_map_from_entries([["b", 2], ["a", 1]], true))');
    assertValidJs(js);
  });

  test("@m = [:] where m is @ordered lowers the empty RHS ORDERED", () => {
    const node = assign("m", mapLit([]));
    const js = emitExpr(node, {
      mode: "client",
      mapVarNames: new Set(["m"]),
      orderedMapVarNames: new Set(["m"]),
    });
    expect(js).toContain('_scrml_reactive_set("m", _scrml_map_from_entries([], true))');
    assertValidJs(js);
  });

  test("@n = [...] where n is a NON-ordered map cell stays UNORDERED", () => {
    const node = assign("n", mapLit([entry(litStr("b"), litNum(2))]));
    const js = emitExpr(node, {
      mode: "client",
      mapVarNames: new Set(["n"]),
      orderedMapVarNames: new Set(["m"]), // n is NOT in the ordered set
    });
    expect(js).toContain(", false)");
    expect(js).not.toContain(", true)");
    assertValidJs(js);
  });

  test("@m = [...] with NO orderedMapVarNames context stays UNORDERED (synthetic-AST safe)", () => {
    const node = assign("m", mapLit([entry(litStr("a"), litNum(1))]));
    const js = emitExpr(node, { mode: "client", mapVarNames: new Set(["m"]) });
    expect(js).toContain(", false)");
    assertValidJs(js);
  });

  test("the RHS of an @ordered reassignment keeps a NESTED value-map literal unordered", () => {
    const inner = mapLit([entry(litStr("b"), litNum(2))]);
    const node = assign("m", mapLit([entry(litStr("outer"), inner)]));
    const js = emitExpr(node, {
      mode: "client",
      mapVarNames: new Set(["m"]),
      orderedMapVarNames: new Set(["m"]),
    });
    expect(js.match(/, true\)/g)?.length).toBe(1);  // outer only
    expect(js.match(/, false\)/g)?.length).toBe(1); // inner value-map
    assertValidJs(js);
  });
});

// ---------------------------------------------------------------------------
// §C  collectOrderedMapVarNames — the @ordered-typed strict subset of
//     collectMapVarNames that drives the threading.
// ---------------------------------------------------------------------------

const stateDecl = (name, typeAnnotation, initExpr) => ({
  kind: "state-decl",
  name,
  ...(typeAnnotation != null ? { typeAnnotation } : {}),
  ...(initExpr != null ? { initExpr } : {}),
});

const fileAST = (nodes) => ({ nodes });

describe("collectOrderedMapVarNames (S169)", () => {
  test("admits an @ordered-typed map cell", () => {
    const ast = fileAST([stateDecl("m", "[string: int]@ordered", mapLit([]))]);
    expect([...collectOrderedMapVarNames(ast)]).toEqual(["m"]);
  });

  test("EXCLUDES a non-ordered map cell (no @ordered affix)", () => {
    const ast = fileAST([stateDecl("n", "[string: int]", mapLit([]))]);
    expect(collectOrderedMapVarNames(ast).has("n")).toBe(false);
    // but collectMapVarNames still recognises it as a map.
    expect(collectMapVarNames(ast).has("n")).toBe(true);
  });

  test("EXCLUDES a map-lit-RHS-only cell (an @ordered affix is required, not inferred)", () => {
    // `<m> = ["a": 1]` makes m a map (collectMapVarNames) but NOT ordered: the
    // §59 default is unordered, the affix is the only ordering signal.
    const ast = fileAST([stateDecl("m", null, mapLit([entry(litStr("a"), litNum(1))]))]);
    expect(collectMapVarNames(ast).has("m")).toBe(true);
    expect(collectOrderedMapVarNames(ast).has("m")).toBe(false);
  });

  test("EXCLUDES a non-map @ordered-suffixed annotation (defensive — array affix etc.)", () => {
    // `int[]` ends in `]` with no entry-colon → not a map → not ordered-map.
    const ast = fileAST([stateDecl("arr", "int[]", null)]);
    expect(collectOrderedMapVarNames(ast).has("arr")).toBe(false);
  });

  test("collects ordered cells declared inside a logic block", () => {
    const ast = fileAST([
      { kind: "logic", body: [stateDecl("m", "[string: int]@ordered", mapLit([]))] },
    ]);
    expect(collectOrderedMapVarNames(ast).has("m")).toBe(true);
  });

  test("returns an empty set for a null / non-object fileAST", () => {
    expect(collectOrderedMapVarNames(null).size).toBe(0);
    expect(collectOrderedMapVarNames(undefined).size).toBe(0);
  });

  test("the ordered set is a SUBSET of the map set", () => {
    const ast = fileAST([
      stateDecl("ordered", "[string: int]@ordered", mapLit([])),
      stateDecl("plain", "[string: int]", mapLit([])),
    ]);
    const maps = collectMapVarNames(ast);
    const ordered = collectOrderedMapVarNames(ast);
    expect(maps.has("ordered")).toBe(true);
    expect(maps.has("plain")).toBe(true);
    expect(ordered.has("ordered")).toBe(true);
    expect(ordered.has("plain")).toBe(false);
    for (const n of ordered) expect(maps.has(n)).toBe(true);
  });
});
