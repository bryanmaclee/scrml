/**
 * g-server-fn-template-literal-base64-eq-false-e-fn-003 (S362-peter) — the E-FN-003
 * "outer-scope mutation" purity check (§48.3.3, type-system.ts) runs a heuristic
 * ASSIGN_RE over raw statement TEXT as a fallback. A bare `=` inside a STRING or
 * TEMPLATE literal — e.g. a base64 `=` padding char on a continuation line of a
 * `return \`…=\`` — was misread as an outer-scope assignment → a FALSE E-FN-003 on
 * valid code (the pure-fn version of the S133 markup false-positive already skipped).
 *
 * FIX: blank the interior of string / template literals (keeping `${…}` interp
 * bodies — those are code) before the ASSIGN_RE match. An outer-scope write is never
 * inside a string literal, so masking only removes false positives; a real write in
 * a template `${…}` interp still matches.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `fn-eq-literal-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    return compileScrml({ inputFiles: [tmpInput], outDir: tmpDir, emitClient: true, emitServer: true });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

const codes = (result) => (result.errors ?? []).map((e) => e.code);

describe("g-server-fn-template-literal-base64-eq-false-e-fn-003 — `=` in a fn-body string literal", () => {
  test("a base64 `=` on a template continuation line does NOT false-fire E-FN-003", () => {
    const result = compileSource(`<program>
\${ fn enc() -> string { return \`data:image/png;base64,
iVBORw0KGgo=\` } }
<div>\${enc()}</div>
</program>`);
    expect(codes(result)).not.toContain("E-FN-003");
  });

  test("a `=` inside a single-line string literal does NOT false-fire E-FN-003", () => {
    const result = compileSource(`<program>
\${ fn q() -> string { return "a=b&c=d" } }
<div>\${q()}</div>
</program>`);
    expect(codes(result)).not.toContain("E-FN-003");
  });

  // S239 finding — a `=` inside a string NESTED within a `${…}` interpolation must
  // also be masked (the reused maskStringLiteralSpans recurses into nested strings).
  test("a `=` inside a string nested within a template interpolation does NOT false-fire", () => {
    const result = compileSource(`<program>
\${ fn f(obj) -> string { return \`\${ obj["a = b"] }\` } }
<div>\${f({})}</div>
</program>`);
    expect(codes(result)).not.toContain("E-FN-003");
  });

  // §GATE — a REAL outer-scope mutation inside a fn body must STILL fire E-FN-003.
  test("GATE: a genuine outer-scope write in a fn body still fires E-FN-003", () => {
    const result = compileSource(`<program>
\${
  <total> = 0
  fn addOne() -> int { total = total + 1
    return total }
}
<div>\${addOne()}</div>
</program>`);
    expect(codes(result)).toContain("E-FN-003");
  });
});
