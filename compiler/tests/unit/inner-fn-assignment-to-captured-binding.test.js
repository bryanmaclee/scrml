/* SPDX-License-Identifier: MIT
 *
 * Unit — g-inner-function-assignment-to-captured-binding-emits-const-decl (S412).
 *
 * SPEC.md:5986 is normative: *"Inner `function` declarations MAY mutate outer `let`
 * bindings."* They did not. `emit-logic.ts`'s `case "function-decl"` built its child
 * options with `declaredNames: new Set()` — a FRESH EMPTY set — on the reasoning that
 * "a function body has its own scope for declared names".
 *
 * That premise is half right and the wrong half is load-bearing. A function body owns
 * its own DECLARATIONS, but it does not lose sight of the bindings around it: JS
 * scoping is lexical and NESTED. `declaredNames` is precisely what decides whether a
 * bare `x = expr` emits as an ASSIGNMENT (x is known) or as a DECLARATION (x is not),
 * so starting empty made every CAPTURED binding read as undeclared.
 *
 * ⚑ BOTH FAILURE HALVES WERE LIVE, AND THE SILENT ONE IS THE WORSE ONE:
 *
 *     pos = pos + 1   ->  const pos = pos + 1;   ReferenceError (reads its own TDZ)
 *     col = 1         ->  const col = 1;         SILENT — shadows, outer never updates
 *
 * Both compiled at exit 0 with zero diagnostics. This is what produced the 74 failing
 * `tokenizeLogic`/`tokenizeCSS` cases in compiler/tests/self-host/tab.test.js, whose
 * `advance()` closure mutates the captured `pos` / `line` / `col`.
 *
 * The fix seeds the child scope from the enclosing one (a COPY, so inner declarations
 * do not leak back out and shadowing still works).
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
function emit(source, name, mode = "library") {
  TMP = TMP || mkdtempSync(join(tmpdir(), "inner-fn-assign-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.${mode}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode,
    write: true, verbose: false, log: () => {},
  });
  let js = "", artifact = null;
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) { js += readFileSync(join(outDir, f), "utf8"); artifact = join(outDir, f); }
    }
  } catch { /* no artifact */ }
  return { js, artifact, errors: r.errors || [] };
}

/** An assignment that emitted as `const <name> =` was turned into a declaration. */
const becameDecl = (js, name) => new RegExp(`\\bconst\\s+${name}\\s*=`).test(js);

describe("an inner function may mutate a captured binding (§5986, S412)", () => {
  test("the self-host shape — a captured counter incremented in an inner fn", () => {
    const { js, errors } = emit(
      `\${\n  export function outer() {\n    let pos = 0\n    function advance() { pos = pos + 1\n      return pos }\n    return advance()\n  }\n}`,
      "captured-increment",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(becameDecl(js, "pos")).toBe(false);
  });

  test("⚑ RUNTIME-VERIFY — the mutation actually reaches the outer binding", async () => {
    const { artifact, errors } = emit(
      `\${\n  export function outer() {\n    let pos = 0\n    function advance() { pos = pos + 1\n      return pos }\n    let a = advance()\n    let b = advance()\n    return pos + a + b\n  }\n}`,
      "runtime-verify",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    // pos ends at 2; a = 1, b = 2  =>  5. Before the fix this threw a
    // ReferenceError from `const pos = pos + 1` reading its own TDZ.
    expect(mod.outer()).toBe(5);
  });

  test("⚑ the SILENT half — a non-self-referencing assignment must not shadow", async () => {
    // `col = 1` became `const col = 1`: no throw, and the outer `col` was simply
    // never updated. This is the half a ReferenceError-shaped test would miss.
    const { js, artifact, errors } = emit(
      // ⚑ NOT named `reset`: a fn by that name collides with a compiler-recognised
      // construct and emits `undefined` with an internal "B22 should have rejected"
      // comment, which has nothing to do with this gap. Filed separately.
      `\${\n  export function outer() {\n    let col = 0\n    function setCol() { col = 7\n      return 0 }\n    let r = setCol()\n    return col + r\n  }\n}`,
      "silent-shadow",
    );
    // ⚑ This case USED to raise a pre-existing `E-MU-001` over-fire (`col` reported
    // "declared but never used" while `return col + r` plainly reads it). It was filed
    // as its own gap and pinned HERE as `["E-MU-001"]` rather than asserted clean,
    // because pinning it clean would have pinned a defect that fix did not own.
    //
    // That gap is now RESOLVED (`g-e-mu-001-overfires-on-binding-mutated-from-inner-fn`):
    // `type-system.ts` was withholding `parentBindings` from every inner-function body
    // on the premise that "outer names cannot be reassigned from inside (E-FN-003
    // enforces that)" — which SPEC.md:5986 makes true of `fn` and false of `function`.
    // Same root as the emit-side defect this file pins, in a second consumer.
    //
    // ⚑ The pin BROKE LOUDLY when that landed, which is exactly what it was for: it had
    // recorded the over-fire precisely enough that removing it could not pass silently.
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(becameDecl(js, "col")).toBe(false);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.outer()).toBe(7);
  });

  test("nesting depth is irrelevant — inside an `if` inside a `while`", () => {
    const { js, errors } = emit(
      `\${\n  export function outer() {\n    let pos = 0\n    function run() { let i = 0\n      while (i < 3) { if (i > 0) { pos = pos + 1 }\n        i = i + 1 }\n      return pos }\n    return run()\n  }\n}`,
      "deep-nesting",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(becameDecl(js, "pos")).toBe(false);
  });

  test("the same defect was present in BROWSER mode too (not a library-path bug)", () => {
    const { js } = emit(
      `\${\n  export function outer() {\n    let pos = 0\n    function advance() { pos = pos + 1\n      return pos }\n    return advance()\n  }\n}`,
      "browser-mode",
      "browser",
    );
    expect(becameDecl(js, "pos")).toBe(false);
  });

  // --- CONTROLS: the cases that always worked must keep working ------------------
  test("CONTROL — a variable LOCAL to the inner fn still declares", () => {
    const { js, errors } = emit(
      `\${\n  export function outer() {\n    function inner() { let loc = 0\n      loc = loc + 1\n      return loc }\n    return inner()\n  }\n}`,
      "local-declares",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    // `let loc = 0` is a real declaration and must stay one.
    expect(/\blet\s+loc\s*=/.test(js)).toBe(true);
  });

  test("CONTROL — shadowing still works (the child set is a COPY)", () => {
    // An inner `let pos` shadows the outer one: it is a genuine declaration site and
    // must emit as a declaration, and it must not leak back to the enclosing scope.
    const { js, errors } = emit(
      `\${\n  export function outer() {\n    let pos = 0\n    function inner() { let pos = 5\n      return pos }\n    let r = inner()\n    return pos + r\n  }\n}`,
      "shadowing",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(/\blet\s+pos\s*=\s*5/.test(js)).toBe(true);
  });

  test("CONTROL — an assignment with NO inner fn was never affected", () => {
    const { js, errors } = emit(
      `\${\n  export function outer() {\n    let pos = 0\n    if (pos < 9) { pos = 1 }\n    return pos\n  }\n}`,
      "no-inner-fn",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(becameDecl(js, "pos")).toBe(false);
  });

  test("CONTROL — a reassigned PARAM was never affected", () => {
    const { js, errors } = emit(
      `\${\n  export function f(n) {\n    if (n > 0) { n = n + 1 }\n    return n\n  }\n}`,
      "param-reassign",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(becameDecl(js, "n")).toBe(false);
  });
});
