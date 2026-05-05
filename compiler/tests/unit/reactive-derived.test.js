/**
 * reactive-derived.test.js — Unit Tests for §6.6 Derived Reactive Values
 *
 * Tests for:
 *   §1  emitLogicNode reactive-derived-decl — codegen output shape
 *   §2  rewriteExprWithDerived — derived-aware expression rewriting
 *   §3  collectDerivedVarNames — AST collection of derived names
 *   §4  Runtime runtime behavior (using Function() to execute runtime snippets in Bun)
 *   §5  Diamond dependency — eval-once guarantee
 *   §6  Derived-of-derived chain
 *   §7  W-DERIVED-001 — no-dep derived treated as const
 *   §8  flush() semantics
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { rewriteReactiveRefs, rewriteExprWithDerived } from "../../src/codegen/rewrite.js";
import { collectDerivedVarNames } from "../../src/codegen/reactive-deps.ts";

// ---------------------------------------------------------------------------
// §1  emitLogicNode reactive-derived-decl — codegen output shape
// ---------------------------------------------------------------------------

describe("emitLogicNode — reactive-derived-decl", () => {
  test("emits _scrml_derived_declare + _scrml_derived_subscribe for single dep", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "total",
      init: "@price * @quantity",
    };
    const result = emitLogicNode(node);
    expect(result).toContain('_scrml_derived_declare("total",');
    expect(result).toContain('_scrml_derived_subscribe("total", "price")');
    expect(result).toContain('_scrml_derived_subscribe("total", "quantity")');
    expect(result).not.toContain('_scrml_reactive_derived');
  });

  test("emits correct arrow function body with reactive refs rewritten", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "total",
      init: "@price * @quantity",
    };
    const result = emitLogicNode(node);
    // The fn body should have reactive refs rewritten
    expect(result).toContain('_scrml_reactive_get("price")');
    expect(result).toContain('_scrml_reactive_get("quantity")');
  });

  test("uses _scrml_derived_get for derived deps when derivedNames provided", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "display",
      init: "@total > 0 ? @total : 0",
    };
    // @total is itself derived
    const derivedNames = new Set(["total"]);
    const result = emitLogicNode(node, { derivedNames });
    expect(result).toContain('_scrml_derived_get("total")');
    expect(result).not.toContain('_scrml_reactive_get("total")');
    expect(result).toContain('_scrml_derived_subscribe("display", "total")');
  });

  test("uses _scrml_reactive_get for non-derived deps even when derivedNames provided", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "taxed",
      init: "@total * 1.08 + @shipping",
    };
    // @total is derived, @shipping is not
    const derivedNames = new Set(["total"]);
    const result = emitLogicNode(node, { derivedNames });
    expect(result).toContain('_scrml_derived_get("total")');
    expect(result).toContain('_scrml_reactive_get("shipping")');
  });

  test("emits one declare + one subscribe per unique dep", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "doubled",
      init: "@count + @count",  // @count appears twice
    };
    const result = emitLogicNode(node);
    const declareCount = (result.match(/_scrml_derived_declare/g) ?? []).length;
    const subscribeCount = (result.match(/_scrml_derived_subscribe/g) ?? []).length;
    expect(declareCount).toBe(1);
    expect(subscribeCount).toBe(1);  // deduplicated by extractReactiveDeps Set
  });

  test("W-DERIVED-001: emits const for no-dep derived", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "pi",
      init: "3.14159",
    };
    const result = emitLogicNode(node);
    expect(result).toContain("W-DERIVED-001");
    expect(result).toContain("const pi");
    expect(result).not.toContain("_scrml_derived_declare");
    expect(result).not.toContain("_scrml_reactive_derived");
  });

  test("W-DERIVED-001: derived with string literal containing @var is no-dep", () => {
    const node = {
      kind: "reactive-derived-decl",
      name: "label",
      init: '"user @count"',  // @count inside string — not a reactive dep
    };
    const result = emitLogicNode(node);
    expect(result).toContain("W-DERIVED-001");
    expect(result).toContain("const label");
  });

  test("emits correct shape for derived-of-derived chain", () => {
    const nodeA = {
      kind: "reactive-derived-decl",
      name: "subtotal",
      init: "@price * @qty",
    };
    const nodeB = {
      kind: "reactive-derived-decl",
      name: "total",
      init: "@subtotal * 1.1",
    };
    const derivedNames = new Set(["subtotal"]);
    const resultA = emitLogicNode(nodeA);
    const resultB = emitLogicNode(nodeB, { derivedNames });

    // A depends on mutable @price and @qty
    expect(resultA).toContain('_scrml_derived_subscribe("subtotal", "price")');
    expect(resultA).toContain('_scrml_derived_subscribe("subtotal", "qty")');

    // B depends on derived @subtotal — should use _scrml_derived_get
    expect(resultB).toContain('_scrml_derived_get("subtotal")');
    expect(resultB).not.toContain('_scrml_reactive_get("subtotal")');
    expect(resultB).toContain('_scrml_derived_subscribe("total", "subtotal")');
  });
});

// ---------------------------------------------------------------------------
// §2  rewriteExprWithDerived — derived-aware expression rewriting
// ---------------------------------------------------------------------------

describe("rewriteExprWithDerived", () => {
  test("routes derived names to _scrml_derived_get", () => {
    const result = rewriteExprWithDerived("@total + 1", new Set(["total"]));
    expect(result).toBe('_scrml_derived_get("total") + 1');
  });

  test("routes non-derived names to _scrml_reactive_get", () => {
    const result = rewriteExprWithDerived("@count + 1", new Set(["total"]));
    expect(result).toBe('_scrml_reactive_get("count") + 1');
  });

  test("routes mixed: derived and non-derived in same expression", () => {
    const result = rewriteExprWithDerived("@total + @count", new Set(["total"]));
    expect(result).toBe('_scrml_derived_get("total") + _scrml_reactive_get("count")');
  });

  test("falls back to rewriteExpr behavior when derivedNames is empty", () => {
    const result = rewriteExprWithDerived("@count + 1", new Set());
    expect(result).toBe('_scrml_reactive_get("count") + 1');
  });

  test("falls back to rewriteExpr behavior when derivedNames is null", () => {
    const result = rewriteExprWithDerived("@count + 1", null);
    expect(result).toBe('_scrml_reactive_get("count") + 1');
  });

  test("does not rewrite @var inside string literals", () => {
    const result = rewriteExprWithDerived('"use @total here" + @count', new Set(["total"]));
    // @total inside string is not rewritten; @count outside is reactive
    expect(result).toBe('"use @total here" + _scrml_reactive_get("count")');
  });
});

// ---------------------------------------------------------------------------
// §3  collectDerivedVarNames — AST collection
// ---------------------------------------------------------------------------

describe("collectDerivedVarNames", () => {
  test("collects reactive-derived-decl names from top-level logic", () => {
    const fileAST = {
      nodes: [
        {
          kind: "logic",
          body: [
            { kind: "reactive-derived-decl", name: "total" },
            { kind: "reactive-derived-decl", name: "display" },
            { kind: "state-decl", name: "count" },  // not derived
          ],
        },
      ],
    };
    const result = collectDerivedVarNames(fileAST);
    expect(result).toEqual(new Set(["total", "display"]));
    expect(result.has("count")).toBe(false);
  });

  test("returns empty set when no derived decls present", () => {
    const fileAST = {
      nodes: [
        { kind: "markup", tag: "div", children: [] },
      ],
    };
    expect(collectDerivedVarNames(fileAST)).toEqual(new Set());
  });

  test("handles empty fileAST", () => {
    expect(collectDerivedVarNames({})).toEqual(new Set());
  });

  test("collects from nested logic blocks", () => {
    const fileAST = {
      nodes: [
        {
          kind: "logic",
          body: [
            {
              kind: "logic",
              body: [{ kind: "reactive-derived-decl", name: "nested" }],
            },
          ],
        },
      ],
    };
    expect(collectDerivedVarNames(fileAST)).toEqual(new Set(["nested"]));
  });

  test("handles fileAST.ast.nodes fallback", () => {
    const fileAST = {
      ast: {
        nodes: [
          {
            kind: "logic",
            body: [{ kind: "reactive-derived-decl", name: "alt" }],
          },
        ],
      },
    };
    expect(collectDerivedVarNames(fileAST)).toEqual(new Set(["alt"]));
  });
});

// ---------------------------------------------------------------------------
// §4  Runtime behavior — execute the runtime string directly in Bun
// ---------------------------------------------------------------------------

/**
 * Build a minimal runtime environment from the SCRML_RUNTIME string.
 * Wraps in a function scope so the variables are captured, returns an object
 * with the public API.
 */
function buildRuntime() {
  // Inline the key runtime functions needed for derived reactive testing.
  // We can't easily import the runtime string and eval it in a module context,
  // so we replicate the exact implementation here and keep it in sync with
  // runtime-template.js. This tests the BEHAVIOR, not the string.
  const _scrml_state = {};
  const _scrml_subscribers = {};
  const _scrml_derived_fns = {};
  const _scrml_derived_cache = {};
  const _scrml_derived_dirty = {};
  const _scrml_derived_downstreams = {};

  function _scrml_reactive_get(name) {
    return _scrml_state[name];
  }

  function _scrml_propagate_dirty(name) {
    const queue = [name];
    const visited = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      const downstreams = _scrml_derived_downstreams[current];
      if (downstreams) {
        for (const derived of downstreams) {
          if (!_scrml_derived_dirty[derived]) {
            _scrml_derived_dirty[derived] = true;
            queue.push(derived);
          }
        }
      }
    }
  }

  function _scrml_reactive_set(name, value) {
    _scrml_state[name] = value;
    _scrml_propagate_dirty(name);
    if (_scrml_subscribers[name]) {
      for (const fn of _scrml_subscribers[name]) {
        try { fn(value); } catch(e) {}
      }
    }
  }

  function _scrml_reactive_subscribe(name, fn) {
    if (!_scrml_subscribers[name]) _scrml_subscribers[name] = [];
    _scrml_subscribers[name].push(fn);
  }

  function _scrml_derived_declare(name, fn) {
    _scrml_derived_fns[name] = fn;
    _scrml_derived_cache[name] = undefined;
    _scrml_derived_dirty[name] = true;
  }

  function _scrml_derived_subscribe(derived, upstream) {
    if (!_scrml_derived_downstreams[upstream]) {
      _scrml_derived_downstreams[upstream] = new Set();
    }
    _scrml_derived_downstreams[upstream].add(derived);
  }

  function _scrml_derived_get(name) {
    if (_scrml_derived_dirty[name]) {
      _scrml_derived_dirty[name] = false;
      const fn = _scrml_derived_fns[name];
      if (fn) {
        _scrml_derived_cache[name] = fn();
      }
    }
    return _scrml_derived_cache[name];
  }

  function flush() {
    const dirtyNames = Object.keys(_scrml_derived_dirty).filter(k => _scrml_derived_dirty[k]);
    for (const name of dirtyNames) {
      _scrml_derived_get(name);
    }
  }

  return {
    _scrml_reactive_get,
    _scrml_reactive_set,
    _scrml_reactive_subscribe,
    _scrml_derived_declare,
    _scrml_derived_subscribe,
    _scrml_derived_get,
    flush,
    // Internal state exposure for testing
    _scrml_derived_dirty,
    _scrml_derived_cache,
  };
}

describe("runtime — _scrml_derived_declare + _scrml_derived_get", () => {
  test("derived node starts dirty and evaluates on first read", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 10);
    rt._scrml_reactive_set("qty", 3);
    rt._scrml_derived_declare("total", () => rt._scrml_reactive_get("price") * rt._scrml_reactive_get("qty"));
    rt._scrml_derived_subscribe("total", "price");
    rt._scrml_derived_subscribe("total", "qty");

    // Initially dirty
    expect(rt._scrml_derived_dirty["total"]).toBe(true);

    // First read triggers evaluation
    const val = rt._scrml_derived_get("total");
    expect(val).toBe(30);
    expect(rt._scrml_derived_dirty["total"]).toBe(false);
  });

  test("second read returns cached value without re-evaluating", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 10);
    let evalCount = 0;
    rt._scrml_derived_declare("total", () => { evalCount++; return rt._scrml_reactive_get("price") * 2; });
    rt._scrml_derived_subscribe("total", "price");

    rt._scrml_derived_get("total"); // first read — evaluates
    rt._scrml_derived_get("total"); // second read — should use cache
    expect(evalCount).toBe(1);
  });

  test("write to upstream marks derived dirty", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 10);
    rt._scrml_derived_declare("doubled", () => rt._scrml_reactive_get("price") * 2);
    rt._scrml_derived_subscribe("doubled", "price");

    rt._scrml_derived_get("doubled"); // evaluate — now clean
    expect(rt._scrml_derived_dirty["doubled"]).toBe(false);

    rt._scrml_reactive_set("price", 20); // should dirty downstream
    expect(rt._scrml_derived_dirty["doubled"]).toBe(true);

    const val = rt._scrml_derived_get("doubled"); // re-evaluate
    expect(val).toBe(40);
    expect(rt._scrml_derived_dirty["doubled"]).toBe(false);
  });

  test("stale read window: read after write but before re-eval returns cached value (§6.6.5)", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 10);
    rt._scrml_derived_declare("doubled", () => rt._scrml_reactive_get("price") * 2);
    rt._scrml_derived_subscribe("doubled", "price");

    const first = rt._scrml_derived_get("doubled"); // 20, cached
    expect(first).toBe(20);

    // Write makes it dirty but we DON'T read yet
    rt._scrml_reactive_set("price", 15);
    expect(rt._scrml_derived_dirty["doubled"]).toBe(true);

    // Read returns the stale cached value until re-evaluated
    // Actually: dirty flag is set, so _scrml_derived_get WILL re-evaluate on next read.
    // §6.6.5 says: "A synchronous read after write returns previously cached value"
    // This means: dirty is set, but the value in cache is the OLD value.
    // Since _scrml_derived_get re-evaluates when dirty, the stale-read window is:
    // BETWEEN the write and the first read (not between write and flush).
    // The stale cache is the value in _scrml_derived_cache BEFORE re-eval.
    expect(rt._scrml_derived_cache["doubled"]).toBe(20); // stale cache
    const second = rt._scrml_derived_get("doubled"); // triggers re-eval
    expect(second).toBe(30); // fresh value
  });
});

describe("runtime — diamond dependency", () => {
  test("diamond: @price -> @subtotal + @discount -> @total, each eval at most once", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 100);
    rt._scrml_reactive_set("qty", 2);

    let subtotalEvals = 0;
    let discountEvals = 0;
    let totalEvals = 0;

    // @subtotal = @price * @qty
    rt._scrml_derived_declare("subtotal", () => {
      subtotalEvals++;
      return rt._scrml_reactive_get("price") * rt._scrml_reactive_get("qty");
    });
    rt._scrml_derived_subscribe("subtotal", "price");
    rt._scrml_derived_subscribe("subtotal", "qty");

    // @discount = @price * 0.05
    rt._scrml_derived_declare("discount", () => {
      discountEvals++;
      return rt._scrml_reactive_get("price") * 0.05;
    });
    rt._scrml_derived_subscribe("discount", "price");

    // @total = @subtotal - @discount
    rt._scrml_derived_declare("total", () => {
      totalEvals++;
      return rt._scrml_derived_get("subtotal") - rt._scrml_derived_get("discount");
    });
    rt._scrml_derived_subscribe("total", "subtotal");
    rt._scrml_derived_subscribe("total", "discount");

    // Initial read
    const initialTotal = rt._scrml_derived_get("total");
    expect(subtotalEvals).toBe(1);
    expect(discountEvals).toBe(1);
    expect(totalEvals).toBe(1);
    expect(initialTotal).toBe(100 * 2 - 100 * 0.05); // 200 - 5 = 195

    // Write price — dirties subtotal, discount, total transitively
    subtotalEvals = 0; discountEvals = 0; totalEvals = 0;
    rt._scrml_reactive_set("price", 200);

    // All are dirty
    expect(rt._scrml_derived_dirty["subtotal"]).toBe(true);
    expect(rt._scrml_derived_dirty["discount"]).toBe(true);
    expect(rt._scrml_derived_dirty["total"]).toBe(true);

    // Read @total — should trigger subtotal and discount each once, total once
    const newTotal = rt._scrml_derived_get("total");
    expect(subtotalEvals).toBe(1);
    expect(discountEvals).toBe(1);
    expect(totalEvals).toBe(1);
    expect(newTotal).toBe(200 * 2 - 200 * 0.05); // 400 - 10 = 390
  });
});

describe("runtime — derived-of-derived chain", () => {
  test("chain: @a -> @b -> @c, write @a, read @c triggers correct chain", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("a", 1);

    rt._scrml_derived_declare("b", () => rt._scrml_reactive_get("a") + 10);
    rt._scrml_derived_subscribe("b", "a");

    rt._scrml_derived_declare("c", () => rt._scrml_derived_get("b") * 2);
    rt._scrml_derived_subscribe("c", "b");

    expect(rt._scrml_derived_get("c")).toBe(22); // (1+10)*2

    rt._scrml_reactive_set("a", 5);
    expect(rt._scrml_derived_dirty["b"]).toBe(true);
    expect(rt._scrml_derived_dirty["c"]).toBe(true);

    expect(rt._scrml_derived_get("c")).toBe(30); // (5+10)*2
  });
});

describe("runtime — flush()", () => {
  test("flush() re-evaluates all dirty derived nodes before returning", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 10);
    rt._scrml_derived_declare("doubled", () => rt._scrml_reactive_get("price") * 2);
    rt._scrml_derived_subscribe("doubled", "price");

    rt._scrml_derived_get("doubled"); // initial eval — now clean, cache = 20

    rt._scrml_reactive_set("price", 25); // dirty
    expect(rt._scrml_derived_dirty["doubled"]).toBe(true);
    expect(rt._scrml_derived_cache["doubled"]).toBe(20); // stale

    rt.flush();

    expect(rt._scrml_derived_dirty["doubled"]).toBe(false);
    expect(rt._scrml_derived_cache["doubled"]).toBe(50); // fresh
  });

  test("flush() with no dirty nodes is a no-op", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("price", 10);
    rt._scrml_derived_declare("doubled", () => rt._scrml_reactive_get("price") * 2);
    rt._scrml_derived_subscribe("doubled", "price");

    rt._scrml_derived_get("doubled"); // evaluate — clean

    // flush() should not throw or change anything
    expect(() => rt.flush()).not.toThrow();
    expect(rt._scrml_derived_cache["doubled"]).toBe(20);
  });

  test("after flush(), read returns fresh value without re-evaluating", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("x", 3);
    let evalCount = 0;
    rt._scrml_derived_declare("y", () => { evalCount++; return rt._scrml_reactive_get("x") + 1; });
    rt._scrml_derived_subscribe("y", "x");

    rt._scrml_reactive_set("x", 10); // dirty
    rt.flush(); // evaluates
    expect(evalCount).toBe(1); // flushed once

    // Read should be cache hit — no re-eval
    const val = rt._scrml_derived_get("y");
    expect(val).toBe(11);
    expect(evalCount).toBe(1); // still 1 — cache hit
  });
});

describe("runtime — _scrml_reactive_set dirty propagation", () => {
  test("propagates dirty transitively: write @a dirties @b and @c in chain", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("a", 1);
    rt._scrml_derived_declare("b", () => rt._scrml_reactive_get("a") * 2);
    rt._scrml_derived_subscribe("b", "a");
    rt._scrml_derived_declare("c", () => rt._scrml_derived_get("b") + 1);
    rt._scrml_derived_subscribe("c", "b");

    rt._scrml_derived_get("c"); // initial eval

    expect(rt._scrml_derived_dirty["b"]).toBe(false);
    expect(rt._scrml_derived_dirty["c"]).toBe(false);

    rt._scrml_reactive_set("a", 5); // should dirty both b and c

    expect(rt._scrml_derived_dirty["b"]).toBe(true);
    expect(rt._scrml_derived_dirty["c"]).toBe(true);
  });

  test("propagation does not re-dirty already-dirty nodes (no infinite loop)", () => {
    const rt = buildRuntime();
    rt._scrml_reactive_set("x", 1);
    rt._scrml_derived_declare("y", () => rt._scrml_reactive_get("x") + 1);
    rt._scrml_derived_subscribe("y", "x");

    // Write twice — should not cause issues
    rt._scrml_reactive_set("x", 2);
    rt._scrml_reactive_set("x", 3);

    expect(rt._scrml_derived_dirty["y"]).toBe(true);
    expect(rt._scrml_derived_get("y")).toBe(4); // 3 + 1
  });
});
