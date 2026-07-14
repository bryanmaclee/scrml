/**
 * S25 gauntlet — §35 E-LIN-005: shadowing a `lin` variable.
 *
 * Deep-dive: scrml-support/docs/deep-dives/lin-discontinuous-scoping-2026-04-13.md
 *
 * Rule (from §35.5 draft): "A `let`, `const`, or `lin` declaration with the
 * same name as an in-scope `lin` variable from a parent scope SHALL be a
 * compile error. Shadowing a `lin` variable prevents the compiler from
 * determining which binding a consumption refers to."
 *
 * Implementation: ScopeEntry.isLin is set on lin-decl and on function
 * parameters declared with the `lin` prefix (§35.2.1). When a
 * let/const/lin declaration binds a name already in scope via a parent
 * scope's isLin entry, E-LIN-005 fires. Same-scope rebinding is out of
 * scope — that's a general redeclaration concern, not shadowing.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-lin005-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      lin005: (result.errors ?? []).filter(e => e.code === "E-LIN-005"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §35 — E-LIN-005 lin shadowing", () => {
  test("let inside for-loop shadows outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  function run() {
    lin token = "abc"
    for (let i = 0; i < 3; i = i + 1) {
      let token = i
      console.log(token)
    }
    console.log(token)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.some(e => /\btoken\b/.test(e.message))).toBe(true);
  });

  test("const inside for-loop shadows outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  function run() {
    lin secret = "xyz"
    for (let i = 0; i < 3; i = i + 1) {
      const secret = i
      console.log(secret)
    }
    console.log(secret)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.some(e => /\bsecret\b/.test(e.message))).toBe(true);
  });

  test("lin inside nested function shadows outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  function outer() {
    lin k = "outer"
    function inner() {
      lin k = "inner"
      console.log(k)
    }
    console.log(k)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.some(e => /\bk\b/.test(e.message))).toBe(true);
  });

  test("lin param shadowed by nested-for let → E-LIN-005", () => {
    const src = `<program>
\${
  function use(lin t) {
    for (let i = 0; i < 2; i = i + 1) {
      let t = i
      console.log(t)
    }
    console.log(t)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.some(e => /\bt\b/.test(e.message))).toBe(true);
  });

  test("different names — no E-LIN-005", () => {
    const src = `<program>
\${
  function run() {
    lin token = "abc"
    for (let i = 0; i < 3; i = i + 1) {
      let other = i
      console.log(other)
    }
    console.log(token)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005).toEqual([]);
  });

  test("parent is plain let (not lin) — no E-LIN-005", () => {
    const src = `<program>
\${
  function run() {
    let token = "abc"
    for (let i = 0; i < 3; i = i + 1) {
      let token = i
      console.log(token)
    }
    console.log(token)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005).toEqual([]);
  });

  test("same-scope rebind — not treated as shadowing", () => {
    const src = `<program>
\${
  function run() {
    lin token = "abc"
    let token2 = 1
    console.log(token)
    console.log(token2)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005).toEqual([]);
  });

  test("lin in nested function body does not shadow its own declaration", () => {
    const src = `<program>
\${
  function run() {
    function inner() {
      lin k = "local"
      console.log(k)
    }
    inner()
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005).toEqual([]);
  });

  test("nested while-loop let shadows outer lin → E-LIN-005", () => {
    // S25 follow-up: while-stmt now pushes its own scope in visitNode (merged
    // from the two duplicate cases), so E-LIN-005 fires on inner let-decls
    // that shadow an outer lin. Before the fix, while-stmt never pushed a
    // scope and this case went undetected.
    const src = `<program>
\${
  function run() {
    lin hkey = 1
    let i = 0
    while (i < 2) {
      let hkey = i
      console.log(hkey)
      i = i + 1
    }
    console.log(hkey)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.some(e => /\bhkey\b/.test(e.message))).toBe(true);
  });

  test("nested function body shadows outer lin (closure capture case) → E-LIN-005", () => {
    // The outer lin binding is marked isLin; the nested function pushes a
    // new scope at binding time. A let-decl inside the nested function with
    // the same name walks up to the outer function scope during lookup and
    // sees the isLin entry → E-LIN-005.
    const src = `<program>
\${
  function outer() {
    lin hkey = "abc"
    function helper() {
      let hkey = "nested"
      console.log(hkey)
    }
    helper()
    console.log(hkey)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.some(e => /\bhkey\b/.test(e.message))).toBe(true);
  });

  test("message names the shadowed variable and suggests rename", () => {
    const src = `<program>
\${
  function run() {
    lin alpha = 1
    for (let i = 0; i < 1; i = i + 1) {
      let alpha = i
      console.log(alpha)
    }
    console.log(alpha)
  }
}
<p>ok</>
</program>
`;
    const { lin005 } = compileSrc(src);
    expect(lin005.length).toBeGreaterThan(0);
    const msg = lin005[0].message;
    expect(msg).toMatch(/alpha/);
    expect(msg).toMatch(/shadow/i);
    expect(msg).toMatch(/rename|consume/i);
  });
});
