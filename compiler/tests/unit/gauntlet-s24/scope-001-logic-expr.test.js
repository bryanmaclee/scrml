/**
 * S24 gauntlet — §2a E-SCOPE-001 in logic expression initializers.
 *
 * Before S24, E-SCOPE-001 fired only for unquoted identifiers in markup
 * attribute values (type-system.ts:visitAttr). Undeclared identifiers
 * inside `${}` logic expressions compiled clean — a typo in a let/const
 * initializer would fall through to JS runtime with a ReferenceError,
 * with no compile-time diagnostic.
 *
 * This initial MVP walks the initExpr of every `let` / `const` declaration
 * and emits E-SCOPE-001 for any bare ident that cannot be resolved against:
 *   - the current ScopeChain (function params, prior let/const, prior
 *     function-decls, imports, pre-bound exports),
 *   - the type registry (user-declared enum/struct names),
 *   - the global allowlist (JS/DOM/scrml-meta built-ins),
 *   - underscore-prefixed names (runtime helpers).
 *
 * Skipped: `@`-prefixed reactive refs (DG handles those); member-access
 * chains lookup only the base ident; numeric-looking tokens.
 *
 * Future work: extend coverage from let/const init to bare-expr statements,
 * if-stmt conditions, match-stmt subjects, return-expr operands, and the
 * body-level bare-expr path. This MVP keeps the blast radius bounded to
 * the existing err-scope-001-undeclared.scrml fixture.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s24-scope-${++tmpCounter}`) {
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
      scope001: (result.errors ?? []).filter(e => e.code === "E-SCOPE-001"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S24 §2a — E-SCOPE-001 on undeclared ident in let/const init", () => {
  test("bare undeclared ident in let init → E-SCOPE-001", () => {
    const src = `<program>
\${
  let x = undeclaredVar + 1
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredVar/.test(e.message))).toBe(true);
  });

  test("bare undeclared ident in const init → E-SCOPE-001", () => {
    const src = `<program>
\${
  const y = alsoUndeclared + 2
}
<p>y</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /alsoUndeclared/.test(e.message))).toBe(true);
  });

  test("declared-first sibling let is resolvable", () => {
    const src = `<program>
\${
  let a = 1
  let b = a + 1
}
<p>\${b}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("function param is resolvable in let init inside body", () => {
    const src = `<program>
\${
  function fn(x) {
    let y = x * 2
    return y
  }
}
<p>\${fn(5)}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("JS built-ins (Math, JSON) don't fire E-SCOPE-001", () => {
    const src = `<program>
\${
  let r = Math.random()
  let s = JSON.stringify({x: 1})
  let p = parseInt("42")
  let c = console.log
}
<p>ok</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("member access chain — only base ident is resolved", () => {
    const src = `<program>
\${
  type Color:enum = { Red, Green, Blue }
  let c = Color.Red
  let d = undeclaredBase.field.nested
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredBase/.test(e.message))).toBe(true);
    expect(scope001.some(e => /\bColor\b/.test(e.message))).toBe(false);
  });

  test("reactive @var references are skipped (DG owns those)", () => {
    const src = `<program>
\${
  @counter = 0
  let x = @counter + 1
}
<p>\${x}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("underscore-prefixed names are skipped (runtime helpers)", () => {
    const src = `<program>
\${
  let x = _scrml_something_not_in_scope
  let y = _anyInternal
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("self-reference in init does not flag the binding's own name", () => {
    const src = `<program>
\${
  let x = x
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /\bx\b/.test(e.message))).toBe(false);
  });

  test("undeclared ident in state-decl init → E-SCOPE-001", () => {
    const src = `<program>
\${
  @x = undeclaredReactiveInit + 1
}
<p>\${@x}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredReactiveInit/.test(e.message))).toBe(true);
  });

  test("typed reactive init with declared initializer resolves clean", () => {
    const src = `<program>
\${
  type Status:enum = { Todo, Done }
  @status: Status = Status.Todo
  @count = 0
}
<p>\${@count}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("state-decl init referring to a later-declared @var still errors", () => {
    const src = `<program>
\${
  @a = @nonexistent + 1
}
<p>\${@a}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    // @-prefixed refs are skipped (DG owns those); this test just confirms
    // the reactive walker doesn't spuriously fire on @nonexistent. DG emits
    // its own diagnostic for unresolved reactives elsewhere.
    expect(scope001).toEqual([]);
  });

  test("forward reference to a later-declared export still resolves", () => {
    const src = `<program>
\${
  function consumer() {
    const result = laterHelper(1)
    return result
  }
  export function laterHelper(n) { return n * 2 }
}
<p>\${consumer()}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });
});

describe("S24 §2a slice 2 — if / return / match-subject coverage", () => {
  test("undeclared ident in if-stmt condition → E-SCOPE-001", () => {
    const src = `<program>
\${
  function test() {
    if (undeclaredCondIdent) { return 1 }
    return 2
  }
}
<p>\${test()}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredCondIdent/.test(e.message))).toBe(true);
  });

  test("undeclared ident in return-stmt expression → E-SCOPE-001", () => {
    const src = `<program>
\${
  function test() {
    return undeclaredReturnIdent
  }
}
<p>\${test()}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredReturnIdent/.test(e.message))).toBe(true);
  });

  test("undeclared ident in match-stmt subject → E-SCOPE-001", () => {
    const src = `<program>
\${
  function test() {
    match undeclaredSubjectIdent {
      .A => 1
      else => 2
    }
    return 0
  }
}
<p>\${test()}</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredSubjectIdent/.test(e.message))).toBe(true);
  });

  test("for-loop counter in if-cond inside body resolves (loop-scope plumb)", () => {
    const src = `<program>
\${
  function sieve(limit) {
    const primes = []
    for (let i = 2; i <= limit; i++) {
      if (i > 1) { primes.push(i) }
    }
    return primes
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("for-of counter used in return inside body resolves", () => {
    const src = `<program>
\${
  function findFirst(arr) {
    for (item of arr) {
      if (item > 0) { return item }
    }
    return 0
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("undeclared ident in lin-decl init → E-SCOPE-001", () => {
    const src = `<program>
\${
  lin token = undeclaredLinInit
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredLinInit/.test(e.message))).toBe(true);
  });

  test("undeclared ident in tilde-decl init → E-SCOPE-001", () => {
    const src = `<program>
\${
  ~accum = undeclaredTildeInit
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredTildeInit/.test(e.message))).toBe(true);
  });

  test("undeclared ident in derived state-decl init (const @x) → E-SCOPE-001", () => {
    const src = `<program>
\${
  const @derived = undeclaredDerivedInit + 1
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredDerivedInit/.test(e.message))).toBe(true);
  });

  test("undeclared ident in reactive-nested-assign RHS → E-SCOPE-001", () => {
    const src = `<program>
\${
  @obj = { nested: { value: 0 } }
  function setIt() {
    @obj.nested.value = undeclaredNestedAssign
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredNestedAssign/.test(e.message))).toBe(true);
  });

  test("undeclared ident in reactive-array-mutation arg → E-SCOPE-001", () => {
    const src = `<program>
\${
  @items = [1, 2, 3]
  function addIt() {
    @items.push(undeclaredPushArg)
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredPushArg/.test(e.message))).toBe(true);
  });

  test("undeclared bare-expr call → E-SCOPE-001", () => {
    const src = `<program>
\${
  function ok() {
    undeclaredBareCall()
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredBareCall/.test(e.message))).toBe(true);
  });

  test("undeclared bare-expr binary → E-SCOPE-001", () => {
    const src = `<program>
\${
  function ok(x) {
    x + undeclaredBareBinary
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredBareBinary/.test(e.message))).toBe(true);
  });

  test("declared function callee resolves in bare-expr", () => {
    const src = `<program>
\${
  function helper(n) { return n + 1 }
  function caller() {
    helper(5)
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("alternate type-decl form (type:enum Name {}) populates typeRegistry", () => {
    const src = `<program>
\${
  type:enum Color {
    Red;
    Green;
    Blue;
  }
  function pickColor() {
    let c = Color.Red
    return c
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /\bColor\b/.test(e.message))).toBe(false);
  });

  test("undeclared ident in throw-stmt → E-SCOPE-001", () => {
    const src = `<program>
\${
  function throwIt() {
    throw undeclaredThrowTarget
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredThrowTarget/.test(e.message))).toBe(true);
  });

  test("undeclared ident in fail-expr args → E-SCOPE-001", () => {
    const src = `<program>
\${
  type E:enum = { Bad(msg: string) }
  function failIt()! -> E {
    fail E.Bad(undeclaredFailArg)
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredFailArg/.test(e.message))).toBe(true);
  });

  // S79 — `undeclared ident in reactive-debounced-decl init` test RETIRED.
  // Pre-v0.next `@debounced(N) name = expr` is gone (SPEC §6.13). The new
  // attribute form `<name debounced=Nms> = expr` is a regular state-decl
  // and inherits state-decl's E-SCOPE-001 init-expression checking via the
  // existing `state-decl init E-SCOPE-001` test elsewhere in this suite.

  test("undeclared ident in value-lift expression → E-SCOPE-001", () => {
    const src = `<program>
\${
  function gen() {
    for x of [1, 2, 3] {
      lift undeclaredLiftValue
    }
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /undeclaredLiftValue/.test(e.message))).toBe(true);
  });

  test("declared arg to array mutation resolves clean", () => {
    const src = `<program>
\${
  @items = []
  function addIt(x) {
    @items.push(x)
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("lin name is scope-visible after decl", () => {
    const src = `<program>
\${
  lin token = "secret"
  let x = token
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("derived reactive visible to later @-refs", () => {
    const src = `<program>
\${
  @base = 5
  const @doubled = @base * 2
  let x = @doubled
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("propagate-expr binding is scope-visible to later statements", () => {
    const src = `<program>
\${
  type E:enum = { Bad }
  function risky(n)! -> E {
    if (n < 0) { fail E.Bad("neg") }
    return n
  }
  function caller(n)! -> E {
    let x = risky(n)?
    return x
  }
}
<p>x</>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });
});
