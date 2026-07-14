/**
 * S25 gauntlet — if-stmt consequent / alternate branches each push a scope.
 *
 * Prior to this slice, `if (cond) { ... } else { ... }` walked both branches
 * in the enclosing scope. Consequences:
 *
 *   - `let` / `const` declared inside an if body leaked to the surrounding
 *     scope, contradicting JS block-scope semantics for `let`/`const`.
 *   - E-LIN-005 (lin shadowing) did not fire on let/const/lin declarations
 *     inside if bodies that shadowed an outer lin.
 *   - Arm-local bindings in `.A => { ... }` match arms did leak similarly
 *     until slice 5 added match-arm-block scope push.
 *
 * Fix wraps the consequent and alternate walks in their own pushed scopes
 * (separate scopes — a binding declared in the consequent is NOT visible in
 * the alternate). Only applies to `if-stmt`; `while-stmt` body scope is
 * handled in the same combined case via `n.kind === "while-stmt"`.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-ifscope-${++tmpCounter}`) {
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
    const errors = result.errors ?? [];
    return {
      errors,
      lin005: errors.filter(e => e.code === "E-LIN-005"),
      scope001: errors.filter(e => e.code === "E-SCOPE-001"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §2a — if-stmt branch scope", () => {
  test("let inside if body shadowing outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  function run() {
    lin token = "abc"
    if (true) {
      let token = "shadow"
      console.log(token)
    } else {
      console.log("no shadow")
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

  test("const inside else body shadowing outer lin → E-LIN-005", () => {
    const src = `<program>
\${
  function run() {
    lin secret = "xyz"
    if (false) {
      console.log("then")
    } else {
      const secret = 1
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

  test("let inside consequent does not leak to outer scope", () => {
    // Before the scope push, `thenLocal` would remain in scope after the if.
    // Now, the reference after the if is undeclared → E-SCOPE-001.
    const src = `<program>
\${
  function run() {
    if (true) {
      let thenLocal = 1
      console.log(thenLocal)
    }
    console.log(thenLocal)
  }
}
<p>ok</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /\bthenLocal\b/.test(e.message))).toBe(true);
  });

  test("let inside consequent does not leak to alternate", () => {
    const src = `<program>
\${
  function run() {
    if (true) {
      let fromThen = 1
      console.log(fromThen)
    } else {
      console.log(fromThen)
    }
  }
}
<p>ok</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /\bfromThen\b/.test(e.message))).toBe(true);
  });

  test("let inside alternate does not leak to outer scope", () => {
    const src = `<program>
\${
  function run() {
    if (false) {
      console.log("then")
    } else {
      let elseLocal = 2
      console.log(elseLocal)
    }
    console.log(elseLocal)
  }
}
<p>ok</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /\belseLocal\b/.test(e.message))).toBe(true);
  });

  test("distinct names inside branches — no false positive", () => {
    const src = `<program>
\${
  function run() {
    lin token = "abc"
    if (true) {
      let thenLocal = 1
      console.log(thenLocal)
    } else {
      let elseLocal = 2
      console.log(elseLocal)
    }
    console.log(token)
  }
}
<p>ok</>
</program>
`;
    const { lin005, scope001 } = compileSrc(src);
    expect(lin005).toEqual([]);
    expect(scope001).toEqual([]);
  });
});
