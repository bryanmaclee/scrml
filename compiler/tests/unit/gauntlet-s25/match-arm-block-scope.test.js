/**
 * S25 gauntlet — match-arm-block body pushes its own scope.
 *
 * Prior to this slice, `.Variant => { ... }` arm bodies were walked by the
 * default-case recursion in type-system.ts `visitNode`, with no scope push.
 * That meant a `let x = ...` inside an arm body shared scope with its
 * siblings and the match's enclosing scope. Consequences:
 *
 *   - E-LIN-005 (lin shadowing, added earlier in S25) did not fire inside
 *     match arms that shadowed an outer lin — the inner binding looked
 *     same-scope to the visitor.
 *   - Any future scope-sensitive check would inherit the same gap.
 *
 * Fix adds a dedicated `match-arm-block` case that pushes a fresh scope
 * around the body walk and pops on exit. Expression-only arms
 * (`.Variant => singleExpr` without `{ ... }`) currently parse as
 * bare-expr + raw string and are out of scope for this slice.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-mab-${++tmpCounter}`) {
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

describe("S25 §2a — match-arm-block body scope", () => {
  test("let inside arm body shadowing outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  type R:enum = { A, B }
  function run(r: R) {
    lin token = "abc"
    match r {
      .A => {
        let token = "shadow"
        console.log(token)
      }
      .B => {
        console.log("no shadow here")
      }
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

  test("const inside arm body shadowing outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  type R:enum = { A, B }
  function run(r: R) {
    lin secret = "xyz"
    match r {
      .A => {
        const secret = 1
        console.log(secret)
      }
      .B => {
        console.log("no shadow")
      }
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

  test("lin inside arm body shadowing outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  type R:enum = { A, B }
  function run(r: R) {
    lin k = "outer"
    match r {
      .A => {
        lin k = "inner"
        console.log(k)
      }
      .B => {
        console.log("no shadow")
      }
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

  test("arm body let with distinct name — no E-LIN-005", () => {
    const src = `<program>
\${
  type R:enum = { A, B }
  function run(r: R) {
    lin token = "abc"
    match r {
      .A => {
        let localOnly = 1
        console.log(localOnly)
      }
      .B => {
        console.log("b")
      }
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

  test("arm-local let does not leak to sibling arm", () => {
    // Before the scope push, `armLocal` bound in `.A` would remain in scope
    // for `.B`. With the push in place, it's released on arm exit — a
    // reference in `.B` is then undeclared and fires E-SCOPE-001.
    const src = `<program>
\${
  type R:enum = { A, B }
  function run(r: R) {
    match r {
      .A => {
        let armLocal = 1
        console.log(armLocal)
      }
      .B => {
        console.log(armLocal)
      }
    }
  }
}
<p>ok</>
</program>
`;
    const { errors } = compileSrc(src);
    const scope001 = errors.filter(e => e.code === "E-SCOPE-001");
    expect(scope001.some(e => /\barmLocal\b/.test(e.message))).toBe(true);
  });
});
