/**
 * s430 fix round (F2) — name checks that looked only at a STRING `decl.name`
 * and so let every name of a DESTRUCTURED declaration through.
 *
 *   E-NAME-COLLIDES-STATE (§6.1.3) — "a local identifier declaration uses the same
 *     name as a registered state cell". `<count> = 0` + `const { count } = o`
 *     compiled at exit 0 once the type system bound destructured names correctly
 *     (base failed it only by accident, with an E-SCOPE-001 that named the wrong
 *     cause). symbol-table.ts checkLocalDeclCollidesState now walks the pattern,
 *     and a destructured `for (… of …)` binder is checked the same way.
 *   E-LIN-005 — a destructured `const { tok }` shadowing an in-scope `lin tok`
 *     (type-system.ts checkLinShadowing call site). Base: silent.
 *   E-SCOPE-010 — two file-scope `const { a } = …` (gauntlet-phase1-checks.js).
 *     Base: the pattern OBJECT was the Map key, so it never collided and fell
 *     through to E-CODEGEN-INVALID-LOGIC ("this is a compiler defect").
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s430-dnames-"));
  const file = join(dir, "t.scrml");
  writeFileSync(file, source);
  try {
    const r = compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {} });
    const fatal = r.errors ?? [];
    return { fatal, codes: fatal.map((e) => e.code) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const collides = (fatal) =>
  fatal.filter((e) => e.code === "E-NAME-COLLIDES-STATE").map((e) => /local `([^`]+)`/.exec(e.message)?.[1]);

describe("E-NAME-COLLIDES-STATE — every name a destructure pattern yields", () => {
  test("destructured `const` in a function body", () => {
    const r = compile(`<count> = 0
\${
    function f(o) {
        const { count } = o
        return count
    }
}
<program><p>\${@count}</p></>
`);
    expect(collides(r.fatal)).toEqual(["const count"]);
    expect(r.codes).not.toContain("E-SCOPE-001");
  });

  test("destructured `let` array pattern, nested + rest", () => {
    const r = compile(`<count> = 0
<rest> = 0
\${
    function f(o) {
        let [ { count }, ...rest ] = o
        return count + rest.length
    }
}
<program><p>\${@count}\${@rest}</p></>
`);
    expect(collides(r.fatal).sort()).toEqual(["let count", "let rest"]);
  });

  test("renamed property collides by its ALIAS, not its key", () => {
    const aliasHit = compile(`<count> = 0
\${
    function f(o) {
        const { n: count } = o
        return count
    }
}
<program><p>\${@count}</p></>
`);
    expect(collides(aliasHit.fatal)).toEqual(["const count"]);
    const keyOnly = compile(`<count> = 0
\${
    function f(o) {
        const { count: n } = o
        return n
    }
}
<program><p>\${@count}</p></>
`);
    expect(keyOnly.codes).not.toContain("E-NAME-COLLIDES-STATE");
    expect(keyOnly.fatal).toEqual([]);
  });

  test("destructured `for (… of …)` binder", () => {
    const r = compile(`<count> = 0
\${
    function f(rows) {
        let s = 0
        for (const { count } of rows) {
            s = s + count
        }
        return s
    }
}
<program><p>\${@count}</p></>
`);
    expect(collides(r.fatal)).toEqual(["const count"]);
  });

  test("inside a server function body", () => {
    const r = compile(`<count> = 0
\${
    server function f(o) {
        const { count } = o
        return count
    }
}
<program><p>\${@count}</p></>
`);
    expect(collides(r.fatal)).toEqual(["const count"]);
  });

  test("control: a destructured name that is NOT a state cell is clean", () => {
    const r = compile(`<count> = 0
\${
    function f(o) {
        const { total } = o
        return total
    }
}
<program><p>\${@count}</p></>
`);
    expect(r.fatal).toEqual([]);
  });
});

describe("E-LIN-005 — a destructured name shadowing an in-scope `lin`", () => {
  test("`const { tok } = o` inside a block shadows `lin tok`", () => {
    const r = compile(`\${
    function f(o) {
        lin tok = o.t
        if (o.c) {
            const { tok } = o
            return tok
        }
        return tok
    }
}
<program><p>hello</></>
`);
    expect(r.codes).toContain("E-LIN-005");
  });

  test("control: a destructured name that does not shadow a `lin` does not fire", () => {
    const r = compile(`\${
    function f(o) {
        lin tok = o.t
        const { other } = o
        return tok + other
    }
}
<program><p>hello</></>
`);
    expect(r.codes).not.toContain("E-LIN-005");
  });
});

describe("E-SCOPE-010 — a destructured name declared twice at file scope", () => {
  test("two file-scope `const { a } = …` blocks collide on `a`", () => {
    const r = compile(`\${
    const { a } = { a: 1 }
}
\${
    const { a } = { a: 2 }
}
<program><p>\${a}</p></>
`);
    expect(r.codes).toContain("E-SCOPE-010");
    expect(r.codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("a destructured name colliding with a plain file-scope declaration", () => {
    const r = compile(`\${
    const a = 1
}
\${
    const [a, b] = [2, 3]
}
<program><p>\${a}\${b}</p></>
`);
    expect(r.codes).toContain("E-SCOPE-010");
  });

  test("control: disjoint destructured names across blocks are clean", () => {
    const r = compile(`\${
    const { a } = { a: 1 }
}
\${
    const { b } = { b: 2 }
}
<program><p>\${a}\${b}</p></>
`);
    expect(r.codes).not.toContain("E-SCOPE-010");
    expect(r.fatal).toEqual([]);
  });
});
