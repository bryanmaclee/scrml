/**
 * §50.8.5 E-ASSIGN-004 × destructured declarations that SHADOW an outer binding
 * (s430-destructure-shadow — regression from #996).
 *
 * A destructured `let` / `const` DECLARES every name it yields, in the CURRENT
 * scope, shadowing any outer binding of the same name — exactly like a plain
 * `let x` / `const x` (§7.3.1 block scoping; §50.9 "`let` is the only
 * declaration form that produces a mutable binding").
 *
 * The defect: the type-system's destructure arm (and the for-of destructured
 * binder arm) guarded every bind with `if (!scopeChain.lookup(bind))`. `lookup`
 * walks the WHOLE chain, so a destructured name that shadowed ANY outer binding
 * was never bound in the inner scope, and its reassignment resolved to the
 * OUTER entry:
 *
 *   FALSE POSITIVE   `const a = 0; function f(o) { let { a, b } = o; a = a + b }`
 *                    → E-ASSIGN-004 on valid code (pre-#996: exit 0).
 *   FALSE NEGATIVE   `let a = 0; function f(o) { const { a } = o; a = a + 1 }`
 *                    → exit 0, runtime `TypeError: Assignment to constant variable`.
 *
 * Every row below is pinned; the controls (plain non-destructured shadow, and a
 * destructured `const` reassigned with no outer binding) pin that the fix did
 * not move anything that was already right.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(source, testName = `e-assign-004-dshadow-${++tmpCounter}`) {
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
    const fatal = result.errors ?? [];
    const out = result.outputs?.get(tmpInput);
    return { fatal, fatalCodes: fatal.map(e => e.code), clientJs: out?.clientJs ?? "" };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const SHELL = `<program>
    <p>hello</>
</>`;

const wrap = (body) => `\${
${body}
}
${SHELL}`;

/**
 * EXECUTE the program's first user function (`_scrml_f_N`, a pure function over
 * its arguments) and return its result. "Compiles clean" is not enough: a
 * shadowing loop binder once compiled at exit 0 into `for (const x …) { const x
 * = x … }`, a TDZ ReferenceError. Throws if the emitted function throws.
 */
function runF(clientJs, ...args) {
  const m = /function (_scrml_f\w*)\(/.exec(clientJs);
  if (!m) throw new Error("no emitted user function in clientJs");
  const open = clientJs.indexOf("{", m.index);
  let depth = 0, end = open;
  for (; end < clientJs.length; end++) {
    if (clientJs[end] === "{") depth++;
    else if (clientJs[end] === "}" && --depth === 0) break;
  }
  const text = clientJs.slice(m.index, end + 1);
  return new Function(`${text}; return ${m[1]};`)()(...args);
}

/** E-ASSIGN-004 diagnostics, as `name@line` for precise assertions. */
function assign004(fatal) {
  return fatal
    .filter(e => e.code === "E-ASSIGN-004")
    .map(e => {
      const m = /`([^`]+)` at line (\d+)/.exec(e.message ?? "");
      return m ? `${m[1]}@${m[2]}` : "?";
    });
}

// ---------------------------------------------------------------------------
// FALSE POSITIVES — a destructured `let` shadowing an outer immutable binding
// ---------------------------------------------------------------------------

describe("destructured `let` shadowing an outer immutable binding is MUTABLE", () => {
  test("object pattern in a function body shadows an outer `const` (the reported repro)", () => {
    const r = compile(wrap(`    const a = 0
    function f(o) {
        let { a, b } = o
        a = a + b
        return a
    }`));
    expect(r.fatalCodes).not.toContain("E-ASSIGN-004");
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("let { a, b } = o;");
    expect(runF(r.clientJs, { a: 1, b: 2 })).toBe(3);
  });

  test("object pattern shadows an outer BARE-named (implicitly const) binding", () => {
    const r = compile(wrap(`    a = 0
    function f(o) {
        let { a, b } = o
        a = a + b
        return a
    }`));
    // E-MU-001 on the unused top-level `a = 0` is expected and unrelated; the
    // point is that the inner write is NOT E-ASSIGN-004 and the function runs.
    expect(r.fatalCodes).not.toContain("E-ASSIGN-004");
    expect(r.fatalCodes).toEqual(["E-MU-001"]);
    expect(runF(r.clientJs, { a: 1, b: 2 })).toBe(3);
  });

  test("block-level `let { a } = o` inside an `if` shadows an outer `const`", () => {
    const r = compile(wrap(`    const a = 0
    function f(o, c) {
        if (c) {
            let { a } = o
            a = a + 1
            return a
        }
        return 0
    }`));
    expect(r.fatalCodes).not.toContain("E-ASSIGN-004");
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, { a: 4 }, true)).toBe(5);
  });

  test("array pattern with a nested object + rest shadows outer `const`s", () => {
    const r = compile(wrap(`    const a = 0
    const r = 0
    function f(o) {
        let [ { a }, ...r ] = o
        a = a + r.length
        r = []
        return a
    }`));
    expect(r.fatalCodes).not.toContain("E-ASSIGN-004");
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, [{ a: 10 }, 1, 2, 3])).toBe(13);
  });

  test("renamed object property binds the ALIAS, which may shadow", () => {
    const r = compile(wrap(`    const b = 0
    function f(o) {
        let { a: b } = o
        b = b + 1
        return b
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, { a: 41 })).toBe(42);
  });

  // s430 fix round (F1) — these two once asserted only "no E-ASSIGN-004" on a
  // program that compiled at exit 0 into `for (const { name } of rows) { const
  // name = name + "!"` — a TDZ ReferenceError. They now EXECUTE the output.
  test("for-of object-pattern binder shadows an outer `const` — compiles AND runs", () => {
    const r = compile(wrap(`    const name = ""
    function f(rows) {
        let out = ""
        for (let { name } of rows) {
            name = name + "!"
            out = out + name
        }
        return out
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toContain("for (let { name } of rows)");
    expect(r.clientJs).not.toContain("const name = name");
    expect(runF(r.clientJs, [{ name: "a" }, { name: "b" }])).toBe("a!b!");
  });

  test("for-of array-pattern binder shadows outer `const`s — compiles AND runs", () => {
    const r = compile(wrap(`    const k = 0
    const v = 0
    function f(pairs) {
        let s = 0
        for (let [k, v] of pairs) {
            k = k + v
            s = s + k
        }
        return s
    }`));
    expect(r.fatal).toEqual([]);
    expect(r.clientJs).toMatch(/for \(let \[\s*k,\s*v\s*\] of pairs\)/);
    expect(runF(r.clientJs, [[1, 2], [3, 4]])).toBe(10);
  });

  test("control: a NON-destructured `let` shadow was already clean and stays clean", () => {
    const r = compile(wrap(`    const a = 0
    function f(o) {
        let a = o
        a = a + 1
        return a
    }`));
    expect(r.fatal).toEqual([]);
    expect(runF(r.clientJs, 1)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// FALSE NEGATIVES — the mirror: a destructured `const` shadowing an outer `let`
// ---------------------------------------------------------------------------

describe("destructured `const` shadowing an outer mutable binding is IMMUTABLE", () => {
  test("object pattern in a function body shadows an outer `let` (the mirror repro)", () => {
    const r = compile(wrap(`    let a = 0
    function f(o) {
        const { a } = o
        a = a + 1
        return a
    }`));
    expect(assign004(r.fatal)).toEqual(["a@5"]);
  });

  test("array pattern in an `if` block shadows a function-local `let`", () => {
    const r = compile(wrap(`    function f(o, c) {
        let a = 0
        if (c) {
            const [a] = o
            a = 5
        }
        a = a + 1
        return a
    }`));
    // Only the INNER reassignment (line 6) fires; after the block closes the
    // outer `let a` is back in scope, so line 8 is legal.
    expect(assign004(r.fatal)).toEqual(["a@6"]);
  });

  test("destructured `const` shadowing a function PARAMETER is immutable", () => {
    const r = compile(wrap(`    function f(a, o) {
        if (o) {
            const { a } = o
            a = 1
        }
        return a
    }`));
    expect(assign004(r.fatal)).toEqual(["a@5"]);
  });
});

// ---------------------------------------------------------------------------
// Scope restoration + the unconditional rule
// ---------------------------------------------------------------------------

describe("the shadow ends with its scope; E-ASSIGN-004 still fires on a destructured `const`", () => {
  test("an inner destructured `let` does not leak mutability to the outer `const`", () => {
    const r = compile(wrap(`    const a = 0
    function f(o, c) {
        if (c) {
            let { a } = o
            a = 1
        }
        a = 2
        return a
    }`));
    // Line 6 targets the inner `let` (legal); line 8 targets the outer `const`.
    expect(assign004(r.fatal)).toEqual(["a@8"]);
  });

  test("a destructured `const` reassigned with NO outer binding still fires", () => {
    const r = compile(wrap(`    function f(o) {
        const { a, b } = o
        a = a + b
        return a
    }`));
    expect(assign004(r.fatal)).toEqual(["a@4"]);
  });

  test("a destructured `const` reassigned via compound assignment still fires", () => {
    const r = compile(wrap(`    function f(o) {
        const [a] = o
        a += 1
        return a
    }`));
    expect(assign004(r.fatal)).toEqual(["a@4"]);
  });

  test("a destructured `let` with no outer binding stays mutable", () => {
    const r = compile(wrap(`    function f(o) {
        let { a, b } = o
        a = a + b
        b = 0
        return a + b
    }`));
    expect(r.fatal).toEqual([]);
  });
});
