/**
 * D1 — `footprintForBlock` SHALLOW dotted-path read/write footprint
 * (change-id `block-analysis-emit-2026-06-18`).
 *
 * The BREAK-1 canary: two fns that each write a DISTINCT field of the same
 * 10-field compound `<quoteForm>` cell (`@quoteForm.originCity` vs
 * `@quoteForm.weightLbs`) must have DISTINCT footprints at DOTTED grain — NOT
 * both collapsed to the root cell `quoteForm` (the body-DG's grain). That
 * distinction is what lets the two fns run as DISJOINT block-leases.
 *
 * R26 / S138: these drive from REAL COMPILED ASTs (`splitBlocks` → `buildAST`,
 * the production BS+TAB path), NOT synthetic AST nodes. A synthesized node
 * would MISS the `_deepSetLeafKey` stamp that `stampCompoundDeepSetTargets`
 * (called idempotently inside `footprintForBlock`) writes onto the real
 * compound-write nodes — and the dotted distinction depends on that stamp.
 *
 * ADD-ALONGSIDE invariant: this module never touches `body-dg-builder.ts`; the
 * footprint is computed separately at a finer grain (SCOPE §2).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { footprintForBlock } from "../../src/block-analysis-footprint.ts";

/** Compile scrml source to a real FileAST via the production BS+TAB path. */
function compileAST(src) {
  const bs = splitBlocks("/test/footprint.scrml", src);
  return buildAST(bs).ast;
}

/** Collect every `function-decl` node by name (descends markup/logic wrappers). */
function functionDecls(ast) {
  const out = {};
  (function walk(nodes) {
    for (const n of nodes ?? []) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "function-decl" && typeof n.name === "string") out[n.name] = n;
      if (Array.isArray(n.children)) walk(n.children);
      if (Array.isArray(n.body)) walk(n.body);
    }
  })(ast.nodes);
  return out;
}

/** The footprint of the named fn in a compiled source. */
function fnFootprint(src, name) {
  const ast = compileAST(src);
  const fns = functionDecls(ast);
  expect(fns[name], `fn ${name} not found in compiled AST`).toBeDefined();
  return footprintForBlock(fns[name], ast);
}

// ---------------------------------------------------------------------------
// The BREAK-1 canary — a 10-field compound `<quoteForm>` (models
// examples/23-trucking-dispatch/pages/customer/quote.scrml)
// ---------------------------------------------------------------------------

const QUOTE_FORM_SRC = `<page>

  <quoteForm>
    <originAddress> = ""
    <originCity req> = ""
    <originState> = "UT"
    <destinationAddress> = ""
    <destinationCity req> = ""
    <destinationState> = "UT"
    <pickupAt req> = ""
    <deliverBy req> = ""
    <commodity req> = ""
    <weightLbs>: int = 0
  </>

  \${
    function setOrigin(city) {
      @quoteForm.originCity = city
    }

    function setWeight(w) {
      @quoteForm.weightLbs = w
    }
  }

  <h1>Quote</h1>
</page>`;

describe("footprintForBlock — BREAK-1 dotted-grain canary (quote-form)", () => {
  test("two fns writing distinct compound fields have DISTINCT dotted footprints", () => {
    const ast = compileAST(QUOTE_FORM_SRC);
    const fns = functionDecls(ast);

    const origin = footprintForBlock(fns.setOrigin, ast);
    const weight = footprintForBlock(fns.setWeight, ast);

    // The headline assertion: dotted grain, NOT root-cell collapse.
    expect(origin.writes).toEqual(["quoteForm.originCity"]);
    expect(weight.writes).toEqual(["quoteForm.weightLbs"]);

    // They are DISTINCT (the disjoint-lease enabler) — NOT both "quoteForm".
    expect(origin.writes).not.toEqual(weight.writes);
    expect(origin.writes).not.toContain("quoteForm");
    expect(weight.writes).not.toContain("quoteForm");
  });

  test("the leaf-key stamp is REAL (stampCompoundDeepSetTargets ran on a compiled AST)", () => {
    const ast = compileAST(QUOTE_FORM_SRC);
    const fns = functionDecls(ast);
    // footprintForBlock stamps idempotently; after it runs, the real
    // reactive-nested-assign node must carry the dotted leaf key.
    footprintForBlock(fns.setOrigin, ast);
    const rna = fns.setOrigin.body.find((s) => s && s.kind === "reactive-nested-assign");
    expect(rna).toBeDefined();
    expect(rna._deepSetLeafKey).toBe("quoteForm.originCity");
  });
});

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

describe("footprintForBlock — write shapes", () => {
  test("bare reactive cell write — `@x = v` writes the bare cell name", () => {
    const src = `<page>
  <errorMessage> = ""
  \${
    function clear() {
      @errorMessage = ""
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "clear");
    expect(fp.writes).toEqual(["errorMessage"]);
  });

  test("bare-expr member-assign KEEPS segments (inverse of addAssignTargetWrites)", () => {
    // `@stats.hits += 1` parses to a bare-expr `assign` with a member target.
    // The body-DG collapses this to root `stats`; the footprint KEEPS the
    // dotted segment `stats.hits`. The `+=` also reads the target.
    const src = `<page>
  <stats> = { hits: 0 }
  \${
    function bumpHits() {
      @stats.hits += 1
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "bumpHits");
    expect(fp.writes).toEqual(["stats.hits"]);
    expect(fp.reads).toContain("stats");
  });

  test("compound `+=` on a bare cell reads AND writes that cell", () => {
    const src = `<page>
  <count> = 0
  \${
    function bump() {
      @count += 1
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "bump");
    expect(fp.writes).toEqual(["count"]);
    expect(fp.reads).toEqual(["count"]);
  });

  test("computed index `@grid[@sel] = v` writes the BASE cell + reads the index expr", () => {
    const src = `<page>
  <grid> = [[0]]
  <sel> = 0
  \${
    function setCell(v) {
      @grid[@sel] = v
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "setCell");
    // A computed index cannot extend a static dotted leaf — the write is the
    // base cell `grid`; the index `@sel` is a read.
    expect(fp.writes).toEqual(["grid"]);
    expect(fp.reads).toEqual(["sel"]);
  });

  test("a local-object mutation (`obj.a = 5`) is NOT lease footprint", () => {
    const src = `<page>
  \${
    function setLocal() {
      const obj = { a: 0 }
      obj.a = 5
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "setLocal");
    expect(fp.writes).toEqual([]);
  });
});

describe("footprintForBlock — read shapes", () => {
  test("RHS / arg reads are collected; string-literal `@x` is NOT a read", () => {
    const src = `<page>
  <themeMode> = "dark"
  <total> = 0
  \${
    function read() {
      const t = @themeMode
      const msg = "use @ignored here"
      const r = compute(@total)
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "read");
    expect(fp.reads).toContain("themeMode");
    expect(fp.reads).toContain("total");
    // `@ignored` lives inside a string literal — extractReactiveDepsFromExprNode
    // is string-literal-aware, so it is NOT a read.
    expect(fp.reads).not.toContain("ignored");
  });
});

describe("footprintForBlock — SHALLOW depth (no call-graph)", () => {
  test("`@x = sendThing()` records x's write but NOT the callee's writes", () => {
    // sendThing writes @sent; the caller only writes @result. SHALLOW = the
    // caller does NOT pull @sent (no call-graph).
    const src = `<page>
  <result> = ""
  <sent> = false
  \${
    function sendThing() {
      @sent = true
      return "ok"
    }
    function caller() {
      @result = sendThing()
    }
  }
  <h1>x</h1>
</page>`;
    const caller = fnFootprint(src, "caller");
    expect(caller.writes).toEqual(["result"]);
    // The callee's write `sent` is NOT pulled into the caller's footprint.
    expect(caller.writes).not.toContain("sent");
  });

  test("control-flow bodies (if / for) ARE lexically inside the block — recursed", () => {
    const src = `<page>
  <a> = 0
  <b> = 0
  <items> = []
  <sel> = 0
  \${
    function branchy() {
      if (@sel) {
        @a = 1
      } else {
        @b = 2
      }
      for (const it of @items) {
        @a = it
      }
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "branchy");
    // Writes inside the if/else branches AND the for body are all in-span.
    expect(fp.writes).toEqual(["a", "b"]);
    // The if condition + the for iterable are reads.
    expect(fp.reads).toContain("sel");
    expect(fp.reads).toContain("items");
  });
});

describe("footprintForBlock — output discipline", () => {
  test("writes + reads are SORTED, de-duplicated, and carry NO `@` prefix", () => {
    const src = `<page>
  <zeta> = 0
  <alpha> = 0
  <mid> = 0
  \${
    function many() {
      @zeta = 1
      @alpha = 2
      @mid = @zeta
      @alpha = 3
    }
  }
  <h1>x</h1>
</page>`;
    const fp = fnFootprint(src, "many");
    // sorted + deduped (alpha written twice → once), no @ prefix.
    expect(fp.writes).toEqual(["alpha", "mid", "zeta"]);
    for (const w of fp.writes) expect(w.startsWith("@")).toBe(false);
    for (const r of fp.reads) expect(r.startsWith("@")).toBe(false);
  });
});

describe("footprintForBlock — honest-empty for unstructured-body blocks", () => {
  test("a node with no structured body yields empty footprints", () => {
    // component-def / engine-decl carry raw body text (no LogicStatement[]) at
    // v1 → honest-empty (SCOPE §3). A bare synthetic-shaped node with no body
    // exercises the same branch.
    const fp = footprintForBlock({ kind: "component-def", name: "Badge", raw: "<span>x</span>" });
    expect(fp.reads).toEqual([]);
    expect(fp.writes).toEqual([]);
  });

  test("footprintForBlock works without a fileAST (no stamp) on bare-cell writes", () => {
    // The fileAST arg is optional; without it the idempotent stamp is skipped.
    // A bare-cell write still resolves (no compound leaf-key needed).
    const ast = compileAST(`<page>
  <flag> = false
  \${
    function toggle() {
      @flag = true
    }
  }
  <h1>x</h1>
</page>`);
    const fns = functionDecls(ast);
    const fp = footprintForBlock(fns.toggle); // no fileAST
    expect(fp.writes).toEqual(["flag"]);
  });
});
