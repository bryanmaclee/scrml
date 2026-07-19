/**
 * i87-nested-server-call-autoawait.test.js — §13.2 position-invariant auto-await.
 *
 * Adopter #87 (HIGH, silent): `await` was inserted (and the enclosing fn marked
 * `async`) ONLY for a top-level `const x = fn()`. One block deep — inside
 * `if`/`else`/`for`/`while`/`do-while`, OR in an `x = fn()` reassignment — the
 * identical server call emitted a BARE unawaited Promise and the enclosing fn
 * stayed synchronous, so every `if (res.error)` guard after it became dead code.
 *
 * SPEC §13.2 (compiler/SPEC.md:7247) is POSITION-INVARIANT: insert `await` at
 * EVERY server-fetch call site; wrap ANY function containing at least one server
 * call in `async`.
 *
 * Coverage:
 *   §1  nested `const res = fn()` inside `if`   → async + await   (case B)
 *   §2  `res = fn()` reassignment                → async + `res = await` (case C)
 *   §3  nested `const res = fn()` inside `for`   → async + await   (case D)
 *   §4  nested inside `while`                     → async + await
 *   §5  nested inside `else`                      → async + await
 *   §6  top-level `const res = fn()`             → async + await   (case A, unchanged)
 *   §7  emitted client.js passes JS syntax check (no `await let/res = …`)
 *   §8  fail-closed — a peer server-fn call in a sync `.some` callback nested in
 *       an `if` body STILL raises E-SERVER-FN-IN-SYNC-CALLBACK (server mode).
 *   §9  regression — a pure-client fn with a nested `if` stays plain `function`.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `i87-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_i87_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    let serverJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) { clientJs = output.clientJs ?? null; serverJs = output.serverJs ?? null; }
    }
    return { errors: result.errors ?? [], clientJs, serverJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function srcWith(bodyFn) {
  return `<program>
\${
    server function getFlag() {
        return { ok: true }
    }

${bodyFn}

    <display> = 0
}

<button onclick=run()>Run</button>
<span>\${@display}</span>
</>
`;
}

// §1 — case B: nested const inside if
describe("§1: `const res = fn()` inside an `if` body is async + awaited (case B)", () => {
  test("nested const gets `await` and the fn is `async`", () => {
    const src = srcWith(`    function run(flag) {
        if (flag) {
            const res = getFlag()
            @display = res.ok
        }
    }`);
    const { clientJs, errors } = compileSource(src, "case-b-nested-if");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(clientJs).not.toMatch(/^function _scrml_run_\d+/m);
    expect(/const res = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });
});

// §2 — case C: reassignment form
describe("§2: `res = fn()` reassignment is async + `res = await` (case C)", () => {
  test("assign-form injects await after `=`, not before the whole statement", () => {
    const src = srcWith(`    function run() {
        let res = not
        res = getFlag()
        @display = res.ok
    }`);
    const { clientJs, errors } = compileSource(src, "case-c-reassign");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/\bres = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
    // Must NOT emit the invalid `await res = …` / `await let res = …`.
    expect(clientJs).not.toMatch(/await\s+(?:let|const)?\s*res\s*=/);
  });
});

// §3 — case D: nested const inside for
describe("§3: `const res = fn()` inside a `for` body is async + awaited (case D)", () => {
  test("nested-in-loop const gets `await` and the fn is `async`", () => {
    const src = srcWith(`    function run() {
        for (const i of [1]) {
            const res = getFlag()
            @display = res.ok
        }
    }`);
    const { clientJs, errors } = compileSource(src, "case-d-for");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/const res = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });
});

// §4 — while body
describe("§4: `const res = fn()` inside a `while` body is async + awaited", () => {
  test("nested-in-while const gets `await`", () => {
    const src = srcWith(`    function run() {
        let go = true
        while (go) {
            const res = getFlag()
            @display = res.ok
            go = false
        }
    }`);
    const { clientJs, errors } = compileSource(src, "while-body");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/const res = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });
});

// §5 — else branch
describe("§5: `const res = fn()` inside an `else` body is async + awaited", () => {
  test("nested-in-else const gets `await`", () => {
    const src = srcWith(`    function run(flag) {
        if (flag) {
            @display = 1
        } else {
            const res = getFlag()
            @display = res.ok
        }
    }`);
    const { clientJs, errors } = compileSource(src, "else-body");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/const res = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });
});

// §6 — case A regression: top-level const still async + await
describe("§6: regression — top-level `const res = fn()` still async + awaited (case A)", () => {
  test("top-level const is unchanged", () => {
    const src = srcWith(`    function run() {
        const res = getFlag()
        @display = res.ok
    }`);
    const { clientJs, errors } = compileSource(src, "case-a-toplevel");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/const res = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });
});

// §7 — emitted client parses (no `await let/res = …`)
describe("§7: emitted client.js for the nested cases passes JS syntax check", () => {
  test("nested if / for / reassign all produce parseable JS", () => {
    const src = srcWith(`    function nestedConst(flag) { if (flag) { const res = getFlag(); @display = res.ok } }
    function assignToLet() { let res = not; res = getFlag(); @display = res.ok }
    function insideLoop() { for (const i of [1]) { const res = getFlag(); @display = res.ok } }
    function run() { nestedConst(true) }`);
    const { clientJs } = compileSource(src, "syntax-check");
    expect(clientJs).toBeTruthy();
    // Throws SyntaxError on `await let X = …` / `await res = …`.
    expect(() => new Function(clientJs)).not.toThrow();
  });
});

// §8 — PHASE-2 (DD colorless-async-boundaries FORK 1, ratified S259): a clean-family
// collection method with an async callback — INCLUDING a peer-server-fn callback (a
// peer is async: it does SQL) — lowers to the async combinator. The Phase-1 interim
// E-SERVER-FN-IN-SYNC-CALLBACK for `.some(x => peer())` is superseded by the transform.
describe("§8: peer server-fn in a `.some` callback nested in `if` lowers to the combinator", () => {
  test("`.some(x => peer())` lowers to `await _scrml_someAsync(...)`, no E-SERVER-FN-IN-SYNC-CALLBACK", () => {
    const src = `<program>
\${
    server function peer() {
        return true
    }
    server function outer(flag) {
        const xs = [1, 2]
        if (flag) {
            const bad = xs.some(x => peer())
            return bad
        }
        return false
    }
}
<span>\${outer(true)}</span>
</>
`;
    const { serverJs, errors } = compileSource(src, "combinator-nested-some");
    const codes = errors.map(e => e.code ?? "");
    expect(codes).not.toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
    expect(serverJs).toMatch(/await _scrml_someAsync\(xs,\s*async\s*\(x\)\s*=>\s*await\s+peer\(\)\)/);
    expect(serverJs).toMatch(/async function _scrml_someAsync\(coll, cb\)/);
  });
});

// §9 — regression: pure-client fn with a nested if stays plain `function`
describe("§9: regression — a pure-client fn with a nested `if` stays plain `function`", () => {
  test("no server callee anywhere → not async, no await injected", () => {
    const src = `<program>
\${
    function run(flag) {
        if (flag) {
            const x = 2 + 3
            @display = x
        }
    }
    <display> = 0
}
<button onclick=run(true)>Go</button>
<span>\${@display}</span>
</>
`;
    const { clientJs, errors } = compileSource(src, "pure-client-nested");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/^function _scrml_run_\d+/m);
    expect(clientJs).not.toMatch(/async function _scrml_run_\d+/);
    expect(clientJs).not.toMatch(/\bawait\b/);
  });
});
