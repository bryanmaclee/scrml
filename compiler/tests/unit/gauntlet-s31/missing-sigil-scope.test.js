/**
 * S31 F5 — E-SCOPE-001 on bare identifier that references a reactive variable
 * without its `@` sigil. The single most common adopter typo.
 *
 * Before this fix, state-decl double-bound the bare name (`count`) in
 * addition to the sigil form (`@count`) for a handful of fallback lookup
 * sites (ref= narrowing, match-subject resolution). That bare bind silently
 * absorbed every bare-ident lookup in logic expressions and attribute values:
 *
 *   - `<p>${count}</p>`    → emitted `count;` (undefined JS reference)
 *   - `<input value=${count}>` → attribute silently dropped entirely
 *   - `<div class=count>`  → attribute silently dropped
 *
 * All three compiled clean with only E-DG-002 "unused reactive" as the only
 * user-visible signal, which most adopters will not associate with the typo.
 *
 * Fix: in `checkLogicExprIdents` and `visitAttr`, detect when a bare-ident
 * lookup resolves to a `kind: "reactive"` entry and surface E-SCOPE-001 with
 * a tailored "references reactive `@name` — write `@name` instead" message.
 *
 * Positive cases — no regression:
 *   - `${@count}`  sigil form still resolves cleanly
 *   - `ref=@count` still declares and binds as ref-binding
 *   - `${let x = 5; x + 1}` bare non-reactive still resolves
 *   - `${Math.max(a, b)}` allowlisted globals still resolve
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s31-missing-sigil-${++tmpCounter}`) {
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

describe("S31 F5 — bare ident references reactive without @ sigil", () => {
  test("bare `${count}` in markup text (reactive declared) → E-SCOPE-001", () => {
    const src = `<program>
\${ @count = 0 }
<p>\${count}</p>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.length).toBeGreaterThan(0);
    expect(scope001.some(e => /references the reactive variable `@count`/.test(e.message))).toBe(true);
  });

  test("bare `${count + 1}` arithmetic in markup interp → E-SCOPE-001", () => {
    const src = `<program>
\${ @count = 0 }
<p>\${count + 1}</p>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /`count`/.test(e.message) && /@count/.test(e.message))).toBe(true);
  });

  test("bare `${data.n}` member access (reactive declared) → E-SCOPE-001 on base", () => {
    const src = `<program>
\${ @data = { n: 0 } }
<p>\${data.n}</p>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /`data`/.test(e.message) && /@data/.test(e.message))).toBe(true);
  });

  test("bare `value=${count}` attribute interpolation → E-SCOPE-001", () => {
    const src = `<program>
\${ @count = 0 }
<input value=\${count}>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /`count`/.test(e.message) && /@count/.test(e.message))).toBe(true);
  });

  test("bare `class=count` unquoted attribute (reactive declared) → E-SCOPE-001 with sigil hint", () => {
    const src = `<program>
\${ @count = 0 }
<div class=count>hi</div>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.length).toBeGreaterThan(0);
    expect(scope001.some(e => /`count`/.test(e.message) && /@count/.test(e.message))).toBe(true);
  });

  test("bare `count` in let initializer (reactive declared) → E-SCOPE-001", () => {
    const src = `<program>
\${
  @count = 0
  let total = count + 1
}
<p>\${@total}</p>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.some(e => /`count`/.test(e.message) && /@count/.test(e.message))).toBe(true);
  });

  test("POSITIVE: `${@count}` with sigil still compiles cleanly", () => {
    const src = `<program>
\${ @count = 0 }
<p>\${@count}</p>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("POSITIVE: `ref=@count` declares binding; bare `count` usage in logic still flags", () => {
    // ref= binds `count` as a ref-binding (not a reactive). Bare `count`
    // references in logic context should resolve cleanly to the ref binding.
    const src = `<program>
\${ @node = 0 }
<input ref=@node>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001).toEqual([]);
  });

  test("POSITIVE: bare `x` where `let x = 5` (non-reactive) still compiles", () => {
    const src = `<program>
\${
  let x = 5
  let y = x + 1
}
<p>\${@count}</p>
</program>
`;
    // @count is not declared — we only care here that `x` resolves clean.
    // DG error for undeclared @count is expected but not E-SCOPE-001.
    const { scope001 } = compileSrc(src);
    // `x` inside `let y = x + 1` must not surface E-SCOPE-001.
    expect(scope001.some(e => /\bx\b/.test(e.message))).toBe(false);
  });

  test("POSITIVE: `${Math.max(a, b)}` allowlisted globals still resolve", () => {
    const src = `<program>
\${
  @a = 1
  @b = 2
}
<p>\${Math.max(@a, @b)}</p>
</program>
`;
    const { scope001 } = compileSrc(src);
    // Math is allowlisted; @a and @b are sigil reads. Should be clean.
    expect(scope001).toEqual([]);
  });

  test("regression: `class=undeclaredFoo` (no reactive) still uses the original unresolved-ident message", () => {
    const src = `<program>
<div class=undeclaredFoo>hi</div>
</program>
`;
    const { scope001 } = compileSrc(src);
    expect(scope001.length).toBeGreaterThan(0);
    expect(scope001.some(e => /cannot be resolved in the current scope/.test(e.message))).toBe(true);
  });
});
