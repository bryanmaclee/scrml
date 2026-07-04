/**
 * g-each-peritem-attr-ternary-quoted-arms.test.js
 *
 * Regression for the MED gap g-each-peritem-attr-ternary-quoted-arms
 * (change-id g-each-peritem-attr-ternary-quoted-arms-2026-06-18).
 *
 * BUG: an interpolated double-quoted attribute value whose `${...}` interior
 * is an inline ternary with QUOTED string-literal arms mis-compiled to
 * E-CODEGEN-INVALID-LOGIC — the emitted JS truncated to `...) ? }` (BOTH arms
 * dropped) → "Unexpected token" at the CG validate-emit gate, no artifacts.
 *
 * ROOT CAUSE (NOT emit-each, NOT each-specific): tokenizer.ts
 * `tokenizeAttributes` double-quoted attr-value reader terminated the attr
 * string at the FIRST inner `"` with no `${...}` interpolation-awareness, so
 * `class="${ cond ? "bg-yellow" : "bg-white" }"` truncated the captured value
 * to `${ cond ? ` (the opening `"` of `"bg-yellow"` read as the string
 * terminator). The fix tracks `${`/sigil-`{`/bare-`{` interpolation depth so
 * the value-terminating `"` is only the one seen at interpolation depth 0.
 *
 * Coverage:
 *   §1 — the repro: quoted-arm ternary in an <each> per-item interpolated attr
 *        → compiles, valid JS, BOTH arms present
 *   §2 — boundary: function-CALL interpolation still works (no inner `"`)
 *   §3 — boundary: per-item body `${...}` interpolation still works
 *   §4 — mixed: ternary with a function-call arm + a quoted arm
 *   §5 — single-quoted arms variant
 *   §6 — multi-segment: literal + interpolated quoted-arm ternary + trailing literal
 *   §7 — the same quoted-arm ternary in a NON-each attr (the bug was shared
 *        upstream; this guards the broader tokenizer fix)
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToClient(source, suffix = "qarms") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// node --check equivalent: try to construct a Function from the source. A
// truncated ternary (`...) ? }`) throws a SyntaxError here, mirroring the
// validate-emit gate's E-CODEGEN-INVALID-LOGIC. The runtime helpers are not
// invoked — Function() only parses — so undefined globals are fine.
function isParseableJs(src) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(src);
    return true;
  } catch {
    return false;
  }
}

const EACH_PRELUDE = `type Row:struct = { id: int, n: int }
<rows>: Row[] = [{ id: 1, n: 5 }, { id: 2, n: 9 }]
<hi> = 9
`;

describe("g-each-peritem-attr-ternary-quoted-arms §1 — the repro", () => {
  test("quoted-arm ternary in an <each> per-item interpolated attr compiles with BOTH arms", () => {
    const { errors, clientJs } = compileToClient(`${EACH_PRELUDE}
<ul>
    <each in=@rows as r key=@.id>
        <li class="\${(r.n == @hi) ? "bg-yellow" : "bg-white"}">\${r.n}</li>
    </each>
</ul>
`);
    // No E-CODEGEN-INVALID-LOGIC (the headline failure).
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    expect(clientJs.length).toBeGreaterThan(0);
    // Both ternary arms survive (the truncation dropped both).
    expect(clientJs).toContain("bg-yellow");
    expect(clientJs).toContain("bg-white");
    // The truncation signature `) ? }` must NOT appear.
    expect(clientJs).not.toContain(") ? }");
    // Emitted JS is parseable (mirrors node --check / validate-emit gate).
    expect(isParseableJs(clientJs)).toBe(true);
  });
});

describe("g-each-peritem-attr-ternary-quoted-arms §2 — function-call boundary", () => {
  test("a function-call interpolation in the same per-item attr still works", () => {
    const { errors, clientJs } = compileToClient(`${EACH_PRELUDE}
fn cls(v: int): string = "x"
<ul>
    <each in=@rows as r key=@.id>
        <li class="base \${cls(r.n)}">\${r.n}</li>
    </each>
</ul>
`);
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    // Bug 1 fix (g-attr-interp-fn-name-not-renamed, codegen-interp-literal-2026-06-20):
    // the fn call inside the per-item attr template literal `base ${cls(r.n)}`
    // is now correctly mangled to the encoded name `_scrml_cls_N(r.n)`. The
    // prior assertion `toContain("cls(")` was LOCKING the pre-fix bare-name
    // miscompile (a runtime ReferenceError on `cls`). Assert the encoded form.
    expect(clientJs).toMatch(/base \$\{_scrml_cls_\d+\(r\.n\)\}/);
    expect(clientJs).not.toMatch(/base \$\{\s*cls\s*\(/);
    expect(isParseableJs(clientJs)).toBe(true);
  });
});

describe("g-each-peritem-attr-ternary-quoted-arms §3 — body interpolation boundary", () => {
  test("the per-item body `${...}` interpolation still works", () => {
    const { errors, clientJs } = compileToClient(`${EACH_PRELUDE}
<ul>
    <each in=@rows as r key=@.id>
        <li>value: \${r.n}</li>
    </each>
</ul>
`);
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    expect(clientJs).toContain("r.n");
    expect(isParseableJs(clientJs)).toBe(true);
  });
});

describe("g-each-peritem-attr-ternary-quoted-arms §4 — mixed ternary (fn-call arm + quoted arm)", () => {
  test("a ternary with one function-call arm and one quoted arm compiles with both arms", () => {
    const { errors, clientJs } = compileToClient(`${EACH_PRELUDE}
fn label(v: int): string = "hot"
<ul>
    <each in=@rows as r key=@.id>
        <li class="\${(r.n == @hi) ? label(r.n) : "cold"}">\${r.n}</li>
    </each>
</ul>
`);
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    // Bug 1 fix: the fn-call arm `label(r.n)` inside the ternary in the
    // per-item attr template literal is now correctly mangled to `_scrml_label_N(`.
    // The quoted `"cold"` arm is a string literal inside the interp and is NOT
    // mangled (string-literal opacity preserved). Prior `toContain("label(")`
    // asserted the pre-fix bare-name miscompile.
    expect(clientJs).toMatch(/_scrml_label_\d+\(r\.n\)/);
    expect(clientJs).not.toMatch(/\? \s*label\s*\(/);
    expect(clientJs).toContain("cold");
    expect(clientJs).not.toContain(") ? }");
    expect(isParseableJs(clientJs)).toBe(true);
  });
});

describe("g-each-peritem-attr-ternary-quoted-arms §5 — single-quoted arms", () => {
  test("single-quoted ternary arms in a per-item attr compile with both arms", () => {
    const { errors, clientJs } = compileToClient(`${EACH_PRELUDE}
<ul>
    <each in=@rows as r key=@.id>
        <li class="\${(r.n == @hi) ? 'bg-yellow' : 'bg-white'}">\${r.n}</li>
    </each>
</ul>
`);
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    expect(clientJs).toContain("bg-yellow");
    expect(clientJs).toContain("bg-white");
    expect(isParseableJs(clientJs)).toBe(true);
  });
});

describe("g-each-peritem-attr-ternary-quoted-arms §6 — multi-segment literal + interp + literal", () => {
  test("a literal prefix + interpolated quoted-arm ternary + literal suffix all survive", () => {
    const { errors, clientJs } = compileToClient(`${EACH_PRELUDE}
<ul>
    <each in=@rows as r key=@.id>
        <li class="pill \${(r.n == @hi) ? "on" : "off"} rounded">\${r.n}</li>
    </each>
</ul>
`);
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    expect(clientJs).toContain("pill ");
    expect(clientJs).toContain(" rounded");
    expect(clientJs).toContain('"on"');
    expect(clientJs).toContain('"off"');
    expect(isParseableJs(clientJs)).toBe(true);
  });
});

describe("g-each-peritem-attr-ternary-quoted-arms §7 — NON-each attr (shared upstream fix)", () => {
  test("the same quoted-arm ternary in a non-each interpolated attr compiles with both arms", () => {
    const { errors, clientJs } = compileToClient(`<n> = 9
<hi> = 9
<div>
    <li class="\${(@n == @hi) ? "bg-yellow" : "bg-white"}">\${@n}</li>
</div>
`);
    expect(errors.find((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBeUndefined();
    expect(clientJs).toContain("bg-yellow");
    expect(clientJs).toContain("bg-white");
    expect(clientJs).not.toContain(") ? }");
    expect(isParseableJs(clientJs)).toBe(true);
  });
});
