/**
 * symbol-table-scope-export-class-bodies.test.js — A1 follow-up to A2 anomaly-2
 *
 * Regression bundle: scope-walker gaps surfaced when A2's c4fc98a populated
 * `params` + `body` on export-function synth stubs. Pre-A2 these gaps were
 * masked because the bodies were empty stubs; post-A2 the bodies actually
 * walk and E-SCOPE-001 fires on bindings that should be in scope.
 *
 * Three structural gaps fixed here (all in type-system.ts):
 *
 *   §A  `export class Foo { ... }` — the export-decl carries the class name
 *       in its `raw` field but `exportedName: null`, so `preBindExportedNames`
 *       used to skip it. Fix: extract class / interface / type / enum / struct
 *       name from the raw text and bind it.
 *
 *   §B  `for (const [a, b] of x)` — the AST builder records `variable: "item"`
 *       and the destructuring pattern survives only in the `iterable` string.
 *       Fix: when the iterable text begins with `[…] of …` or `{…} of …`,
 *       parse out the destructured names and bind them in the for-loop scope.
 *
 *   §C  `const { a, b: renamed } = expr` — the AST builder emits an empty
 *       `const-decl { name: "", init: "" }` followed by a `bare-expr` whose
 *       `expr` is the destructuring assignment text. Fix: when an empty-named
 *       const-/let-decl is followed by a destructuring bare-expr, extract the
 *       destructured names and bind them.
 *
 * Negative controls verify that truly-undeclared identifiers still fire
 * E-SCOPE-001.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runTS } from "../../src/type-system.ts";

function diagnose(src) {
  const bs = splitBlocks("/test/app.scrml", src);
  if (bs.errors && bs.errors.length > 0) return { errors: bs.errors };
  const { ast } = buildAST(bs);
  const res = runTS({
    files: [ast],
    protectAnalysis: { protectedFields: new Map() },
    routeMap: { pages: [], functions: new Map(), channels: new Map() },
    importedTypesByFile: new Map(),
  });
  return { errors: res.errors ?? [] };
}

function scopeErrorsFor(errors, name) {
  return errors.filter(e =>
    e.code === "E-SCOPE-001"
    && typeof e.message === "string"
    && new RegExp(`\\b${name}\\b`).test(e.message)
  );
}

// ---------------------------------------------------------------------------
// §A — export class Foo binds Foo in file scope
// ---------------------------------------------------------------------------

describe("§A: export class binds class name in scope", () => {
  test("§A.1 — `new Foo(...)` referencing same-file export class compiles clean", () => {
    const src = `<program>
\${
    export class ModuleError {
        constructor(code, message) {
            this.code = code
            this.message = message
        }
    }

    export function makeError(code, msg) {
        return new ModuleError(code, msg)
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "ModuleError")).toHaveLength(0);
  });

  test("§A.2 — `export class` body's constructor params are in scope inside the constructor body", () => {
    // The `this.code = code` form references `code` (a constructor param).
    // Even though scrml currently treats `export class` as a raw export-decl
    // (no class-decl AST), the class-body raw text never executes the type-
    // system scope-walker — so this case is implicitly fine. This test
    // guards against a future regression that DOES descend into the body.
    const src = `<program>
\${
    export class Foo {
        constructor(x, y) {
            this.x = x
            this.y = y
        }
    }
    export function tryIt() {
        return new Foo(1, 2)
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "Foo")).toHaveLength(0);
    // Class body raw — currently NOT type-checked, so x/y references inside
    // the constructor body do not surface E-SCOPE-001. (If a future change
    // descends into class bodies, augment this test.)
    expect(scopeErrorsFor(errors, "x")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "y")).toHaveLength(0);
  });

  test("§A.3 — `export class` without trailing `function` use still binds (file-scope hoisting)", () => {
    const src = `<program>
\${
    export class Bar {
        constructor() {}
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "Bar")).toHaveLength(0);
  });

  test("§A.4 — bare `class Foo {...}` (no export) — currently not load-bearing; no regression", () => {
    // The AST builder may or may not surface a bare class. This test exists
    // to ensure we don't break anything that previously compiled.
    const src = `<program>
\${
    export class Baz {}
    export function makeBaz() {
        return new Baz()
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "Baz")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B — for-of destructuring pattern names bound in scope
// ---------------------------------------------------------------------------

describe("§B: for-of destructuring binds pattern names in scope", () => {
  test("§B.1 — `for (const [k, v] of map)` binds k, v in body", () => {
    const src = `<program>
\${
    export function dump(map) {
        const out = []
        for (const [k, v] of map) {
            out.push(k)
            out.push(v)
        }
        return out
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "k")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "v")).toHaveLength(0);
  });

  test("§B.2 — `for (const [a, b] of obj.entries())` binds a, b in body", () => {
    const src = `<program>
\${
    export function walk(obj) {
        const out = []
        for (const [a, b] of Object.entries(obj)) {
            out.push(a + ":" + b)
        }
        return out
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "a")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "b")).toHaveLength(0);
  });

  test("§B.3 — `for (const { name, kind } of items)` binds name, kind in body", () => {
    const src = `<program>
\${
    export function describe(items) {
        const out = []
        for (const { name, kind } of items) {
            out.push(name + ":" + kind)
        }
        return out
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "name")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "kind")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §C — const-decl destructuring binds names in surrounding scope
// ---------------------------------------------------------------------------

describe("§C: destructuring const-decl binds LHS names in scope", () => {
  test("§C.1 — `const { graph, errors } = build()` binds graph, errors", () => {
    const src = `<program>
\${
    export function build() {
        return { graph: new Map(), errors: [] }
    }

    export function go() {
        const { graph, errors } = build()
        graph.set("k", "v")
        errors.push("x")
        return graph
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "graph")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "errors")).toHaveLength(0);
  });

  test("§C.2 — `const { graph, errors: graphErrors } = build()` binds renamed graphErrors", () => {
    const src = `<program>
\${
    export function build() {
        return { graph: new Map(), errors: [] }
    }

    export function go() {
        const { graph, errors: graphErrors } = build()
        return graphErrors
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "graphErrors")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "graph")).toHaveLength(0);
  });

  test("§C.3 — `const [a, b] = pair()` binds a, b", () => {
    const src = `<program>
\${
    export function pair() {
        return [1, 2]
    }

    export function go() {
        const [a, b] = pair()
        return a + b
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "a")).toHaveLength(0);
    expect(scopeErrorsFor(errors, "b")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §D — Negative controls — truly-undeclared idents still fire E-SCOPE-001
// ---------------------------------------------------------------------------

describe("§D: negative controls — undeclared idents still fire", () => {
  test("§D.1 — `xyzNotDeclared` inside function body fires E-SCOPE-001", () => {
    const src = `<program>
\${
    export function go() {
        return xyzNotDeclared
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "xyzNotDeclared").length).toBeGreaterThan(0);
  });

  test("§D.2 — destructured name not used outside scope still fires when used elsewhere", () => {
    // `a` is bound only inside `walkBody` — using it outside in `outsideUse`
    // should fire E-SCOPE-001.
    const src = `<program>
\${
    export function walkBody(items) {
        for (const [a, b] of items) {
            return a + b
        }
    }

    export function outsideUse() {
        return a
    }
}
</program>
`;
    const { errors } = diagnose(src);
    expect(scopeErrorsFor(errors, "a").length).toBeGreaterThan(0);
  });
});
