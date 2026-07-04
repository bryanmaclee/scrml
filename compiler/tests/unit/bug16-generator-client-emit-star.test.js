/**
 * bug16-generator-client-emit-star.test.js — non-SSE `function*` client codegen.
 *
 * Regression: bug-16 (S178). SPEC §13.6 ratified generators as full language
 * vocabulary — `function*` / `yield` / `yield*` admissible in any function
 * position (S131 HU-4 Q-W3-3). The §37 `server function*` SSE path has a
 * dedicated codegen, but a NON-SSE `function*` in a `${ }` logic block failed.
 *
 * Bug:
 *   Source:  function* counts() { yield 1; yield 2; yield 3 }
 *   Pre-fix emit (client):  function _scrml_counts_2() { yield 1; ... }
 *     — the generator `*` was DROPPED, so `yield` landed inside a plain
 *       (non-generator) function = invalid JS. The S141/S142 emit-validation
 *       parse gate caught it as E-CODEGEN-INVALID-LOGIC "keyword 'yield' is
 *       reserved" → the whole compile FAILED.
 *
 * Root cause:
 *   The client function emitter (compiler/src/codegen/emit-functions.ts) emitted
 *   `${asyncPrefix}function ${name}(...)` with no generator-star branch, even
 *   when the function-decl node carried `isGenerator: true` (ast.ts:836). The
 *   LIBRARY emitter (emit-library.ts:428) and the inline-logic emitter
 *   (emit-logic.ts:3259) already had the branch; the client decl path did not.
 *
 * Fix:
 *   Mirror the `generatorStar = isGenerator ? "*" : ""` pattern into the client
 *   emit path: `function${generatorStar} ${name}(...)`. Computed independently
 *   of asyncPrefix (defensive — a generator does not take the server-call CPS
 *   path, so the two should not co-occur in practice).
 *
 * Coverage:
 *   §1  Minimal generator — `function* counts()` with three `yield`s; star
 *       preserved, `yield` survives, emitted JS is syntactically valid.
 *   §2  SPEC §13.6 worked Fibonacci example — generator + a separate consumer
 *       (`firstN`) that iterates it via `for...of`; the consumer is NOT a
 *       generator (local-not-viral). Star on the generator only.
 *   §3  Regression guard — a plain (non-generator) `function` MUST NOT gain a
 *       spurious star.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/bug16-generator-client-emit-star");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let minimalFx, fibFx, plainFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // §1 — minimal non-SSE generator
  minimalFx = fix("minimal.scrml", `<program>
\${
  function* counts() {
    yield 1
    yield 2
    yield 3
  }
  const <nums> = [...counts()]
}
<p>\${@nums}</p>
</program>
`);

  // §2 — SPEC §13.6 worked Fibonacci example (generator + plain consumer)
  fibFx = fix("fibonacci.scrml", `<program>
\${
  function* fibonacci() {
    let a = 0
    let b = 1
    while (true) {
      yield a
      let next = a + b
      a = b
      b = next
    }
  }
  function firstN(n: int) -> int[] {
    let out = []
    let i = 0
    for (let v of fibonacci()) {
      if (i >= n) { break }
      out = [...out, v]
      i = i + 1
    }
    return out
  }
}
<p>First 8 Fibonacci: \${firstN(8)}</p>
</program>
`);

  // §3 — regression guard: a plain function must NOT gain a star
  plainFx = fix("plain.scrml", `<program>
\${
  @v = 0
  function bump() {
    @v = @v + 1
  }
}
<button onclick=bump()>bump</button>
<div>\${@v}</div>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

function getJs(path) {
  const result = compile(path);
  expect(result.errors).toEqual([]);
  return result.outputs.get(path).clientJs;
}

// ---------------------------------------------------------------------------
// §1 — minimal generator
// ---------------------------------------------------------------------------

describe("§1: function* counts() { yield 1; yield 2; yield 3 }", () => {
  test("compiles without errors (no E-CODEGEN-INVALID-LOGIC)", () => {
    const result = compile(minimalFx);
    expect(result.errors).toEqual([]);
  });

  test("emits `function*` — the generator star is preserved", () => {
    const js = getJs(minimalFx);
    // Star attached to `function`, before the generated name (e.g.
    // `function* _scrml_counts_2(`), mirroring emit-library.ts:430.
    expect(js).toMatch(/function\*\s+_scrml_counts/);
  });

  test("does NOT emit a plain `function` for the generator (the star-drop signature)", () => {
    const js = getJs(minimalFx);
    // The pre-fix bug emitted `function _scrml_counts_2(` (no star). Assert
    // the generator's decl is NOT a plain non-generator function.
    expect(js).not.toMatch(/function\s+_scrml_counts\w*\s*\(/);
  });

  test("the `yield` expressions survive inside the generator body", () => {
    const js = getJs(minimalFx);
    expect(js).toContain("yield 1");
    expect(js).toContain("yield 2");
    expect(js).toContain("yield 3");
  });

  test("emitted JS is syntactically valid (the node --check property)", () => {
    const js = getJs(minimalFx);
    // new Function() requires the whole body to parse; a top-level
    // `function*` decl with `yield` inside is valid, a plain `function` with
    // `yield` is NOT (the pre-fix bug). Same gate as the E-CODEGEN parse check.
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 — SPEC §13.6 Fibonacci (generator + plain consumer)
// ---------------------------------------------------------------------------

describe("§2: SPEC §13.6 Fibonacci — generator + for...of consumer", () => {
  test("compiles without errors", () => {
    const result = compile(fibFx);
    expect(result.errors).toEqual([]);
  });

  test("the generator emits `function*`; the consumer stays a plain `function`", () => {
    const js = getJs(fibFx);
    // local-not-viral: only `fibonacci` is a generator. `firstN` consumes it
    // via `for...of` and remains an ordinary synchronous function.
    expect(js).toMatch(/function\*\s+_scrml_fibonacci/);
    expect(js).toMatch(/function\s+_scrml_firstN\w*\s*\(/);
    expect(js).not.toMatch(/function\*\s+_scrml_firstN/);
  });

  test("the consumer iterates the generated generator name via for...of", () => {
    const js = getJs(fibFx);
    expect(js).toMatch(/for\s*\(\s*const\s+v\s+of\s+_scrml_fibonacci\w*\(\)\s*\)/);
  });

  test("emitted JS is syntactically valid", () => {
    const js = getJs(fibFx);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3 — regression guard: plain function gets NO star
// ---------------------------------------------------------------------------

describe("§3: a plain (non-generator) function must NOT gain a star", () => {
  test("compiles without errors", () => {
    const result = compile(plainFx);
    expect(result.errors).toEqual([]);
  });

  test("the plain function is emitted WITHOUT a generator star", () => {
    const js = getJs(plainFx);
    expect(js).toMatch(/function\s+_scrml_bump\w*\s*\(/);
    expect(js).not.toMatch(/function\*\s+_scrml_bump/);
  });

  test("emitted JS is syntactically valid", () => {
    const js = getJs(plainFx);
    expect(() => new Function(js)).not.toThrow();
  });
});
