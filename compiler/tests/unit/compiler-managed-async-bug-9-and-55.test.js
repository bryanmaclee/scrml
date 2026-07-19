/**
 * compiler-managed-async-bug-9-and-55.test.js — Bug 9 (L1) + Bug 55 combined
 * regression guard.
 *
 * S138 — paired fixes landed together:
 *
 * **Bug 9 L1**: `route-inference.ts:3018` populates `functionName:
 * record.fnNode.name ?? null` in routeMap.functions entries. Pre-fix the
 * field was structurally declared in the route-map type but never set,
 * so `serverFnNames` in `scheduling.ts:hasServerCallees` was always empty
 * and transitive client-callers were never auto-async-and-awaited.
 *
 * **Bug 55** (surfaced by Bug 9 L1 attempt; class-level): scheduling.ts
 * Promise.all parallelization wrongly included statement-shape stmts
 * (`guarded-expr`, `if-stmt`, `while-stmt`, `do-while-stmt`, `for-stmt`,
 * `return-stmt`) as array-literal elements — JS SyntaxError because a
 * statement isn't a valid expression in array-literal position. Fix:
 * `isStatementShapeStmt` guard at the group-building step forces
 * statement-shape stmts to size-1 groups (single-stmt emission path
 * where multi-stmt + statement-shape is fine at function body top-level).
 *
 * Per pa.md S138 R26 doctrine: combined fix verified on R24/R25 gauntlet
 * sweep (8 sources) — 7/8 PASS (the 1 FAIL is unrelated pre-existing on
 * R24 dev-4-pascal). Pre-Bug-9-L1 baseline was also 7/8.
 *
 * Per the original Bug 9 3-layer framing:
 *   L1 (THIS — RESOLVED S138) — populate route.functionName
 *   L2 (Bug 55 — RESOLVED S138 same commit) — CPS planner shape gate
 *   L3 (RESOLVED — Seam-A colorless-async Gap 2 / GITI-037) — transitive async
 *        coloring across client fn graphs: the plain/client-fn classification
 *        now routes through the transitive computeAsyncFnNames fixpoint (a fn
 *        reaching a server / stdlib-Promise call through a local client peer is
 *        colored async AND awaits the peer). See §8.
 *
 * Coverage:
 *   §1  Direct caller: client fn calling server fn gets `async function`
 *   §2  Server call site is awaited
 *   §3  Regression — server fn shim still `async function`
 *   §4  Regression — pure client fn stays plain `function`
 *   §5  Emitted client.js passes JS syntax check
 *   §6  Bug 55: guarded-expr stays in single-stmt group (not array element)
 *   §7  Bug 55: if-stmt stays in single-stmt group
 *   §8  L3 transitive boundary — RESOLVED (Seam-A Gap 2): outerCaller is async
 *       + awaits its client peer
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bug9-55-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bug9_55_${tag}`);
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
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// §1: Direct caller emits async function (Bug 9 L1)
// ---------------------------------------------------------------------------

describe("§1: client fn that directly calls a server fn emits as `async function`", () => {
  test("`function load() { const c = loadCount(); ... }` emits `async function _scrml_load_*`", () => {
    const src = `<program>
\${
    server function loadCount() {
        return 42
    }

    function load() {
        const count = loadCount()
        @display = count
    }

    <display> = 0
}

<button onclick=load()>Load</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "direct-caller-async");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toMatch(/async function _scrml_load_\d+/);
    expect(clientJs).not.toMatch(/^function _scrml_load_\d+/m);
  });
});

// ---------------------------------------------------------------------------
// §2: Server call inside client wrapper is awaited
// ---------------------------------------------------------------------------

describe("§2: server call inside client wrapper is awaited", () => {
  test("`const count = loadCount()` inside async client fn awaits the server call", () => {
    const src = `<program>
\${
    server function loadCount() {
        return 42
    }

    function load() {
        const count = loadCount()
        @display = count
    }

    <display> = 0
}

<button onclick=load()>Load</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "direct-caller-await");
    expect(clientJs).toBeTruthy();
    const hasAwait = /await[\s\S]*_scrml_fetch_loadCount_\d+\s*\(/.test(clientJs);
    expect(hasAwait).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3: Server fn shim still emits as `async function` (regression)
// ---------------------------------------------------------------------------

describe("§3: regression — server fn shim still emits as `async function`", () => {
  test("`_scrml_fetch_loadCount_*` shim still has `async` prefix", () => {
    const src = `<program>
\${
    server function loadCount() {
        return 42
    }

    function load() {
        const count = loadCount()
        @display = count
    }

    <display> = 0
}

<button onclick=load()>Load</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "server-shim-still-async");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toMatch(/async function _scrml_fetch_loadCount_\d+/);
  });
});

// ---------------------------------------------------------------------------
// §4: Pure-client fn stays plain `function` (regression)
// ---------------------------------------------------------------------------

describe("§4: regression — pure-client fn stays plain `function`", () => {
  test("a fn with no server callees emits as `function`, not `async function`", () => {
    const src = `<program>
\${
    function doMath() {
        @result = 2 + 3
    }

    <result> = 0
}

<button onclick=doMath()>Compute</button>
<span>\${@result}</span>
</>
`;
    const { clientJs } = compileSource(src, "pure-client-stays-sync");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toMatch(/^function _scrml_doMath_\d+/m);
    expect(clientJs).not.toMatch(/async function _scrml_doMath_\d+/);
  });
});

// ---------------------------------------------------------------------------
// §5: Emitted client.js passes JS syntax check
// ---------------------------------------------------------------------------

describe("§5: emitted client.js passes JS syntax check", () => {
  test("`new Function` invariant on the full emitted client.js", () => {
    const src = `<program>
\${
    server function loadCount() {
        return 42
    }

    function load() {
        const count = loadCount()
        @display = count
    }

    <display> = 0
}

<button onclick=load()>Load</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "syntax-check");
    expect(clientJs).toBeTruthy();
    const wrapped = `
      var _scrml_reactive_get = function () { return 0; };
      var _scrml_reactive_set = function () {};
      var document = { addEventListener: function () {}, querySelectorAll: function () { return []; } };
      var fetch = function () { return Promise.resolve({ json: function () { return Promise.resolve(0); } }); };
      ${clientJs}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §6: Bug 55 — guarded-expr in single-stmt group (not array element)
// ---------------------------------------------------------------------------

describe("§6: Bug 55 — guarded-expr stays in single-stmt group, not Promise.all array element", () => {
  test("`let X = call() !{handler}` emits sequentially, NOT inside Promise.all array", () => {
    const src = `<program>
\${
    type LoadError:enum = { Network }

    server function fetchData()! -> LoadError {
        return 42
    }

    function load() {
        let result = fetchData() !{
            | ::Network -> { return }
        }
        @display = result
    }

    <display> = 0
}

<button onclick=load()>Load</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "guarded-expr-single-group");
    expect(clientJs).toBeTruthy();
    // The CRITICAL invariant: a guarded-expr's emitted shape (`let X = await...;
    // if(...){...}`) must NOT live inside a Promise.all array. The pre-Bug-55
    // shape had `let _scrml__scrml_result_NN = await ...; if(...){...},` inside
    // `await Promise.all([...])`.
    const promiseAllMatch = clientJs.match(/Promise\.all\(\[([\s\S]*?)\]\)/);
    if (promiseAllMatch) {
      // If Promise.all exists, its body MUST NOT contain `let ` declarations
      // (which would indicate a guarded-expr leaked into an array element).
      expect(promiseAllMatch[1]).not.toMatch(/\blet\s+_scrml/);
    }
    // The syntax-check invariant — if Bug 55 fired, this would throw.
    const wrapped = `
      var _scrml_reactive_get = function () { return 0; };
      var _scrml_reactive_set = function () {};
      var _scrml_fetch_with_csrf_retry = function () { return Promise.resolve({ json: function () { return Promise.resolve(0); } }); };
      var document = { addEventListener: function () {}, querySelectorAll: function () { return []; } };
      ${clientJs}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §7: Bug 55 — if-stmt in single-stmt group (not Promise.all array element)
// ---------------------------------------------------------------------------

describe("§7: Bug 55 — if-stmt stays in single-stmt group", () => {
  test("`if (cond) { ... }` doesn't end up inside a Promise.all array literal", () => {
    const src = `<program>
\${
    server function fetchData() {
        return 42
    }

    function load() {
        if (@ready) {
            return
        }
        const result = fetchData()
        @display = result
    }

    <ready> = false
    <display> = 0
}

<button onclick=load()>Load</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "if-stmt-single-group");
    expect(clientJs).toBeTruthy();
    const promiseAllMatch = clientJs.match(/Promise\.all\(\[([\s\S]*?)\]\)/);
    if (promiseAllMatch) {
      // If Promise.all exists, its body MUST NOT contain `if (` patterns at
      // the array-element level (which would indicate an if-stmt leaked into
      // an array element).
      expect(promiseAllMatch[1]).not.toMatch(/^\s*if\s*\(/m);
    }
    const wrapped = `
      var _scrml_reactive_get = function () { return false; };
      var _scrml_reactive_set = function () {};
      var _scrml_fetch_with_csrf_retry = function () { return Promise.resolve({ json: function () { return Promise.resolve(0); } }); };
      var document = { addEventListener: function () {}, querySelectorAll: function () { return []; } };
      ${clientJs}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §8: L3 transitive boundary — RESOLVED by Seam-A colorless-async Gap 2 (GITI-037)
// ---------------------------------------------------------------------------

describe("§8: L3 transitive boundary (RESOLVED — Seam-A Gap 2 / GITI-037)", () => {
  test("a fn calling a client-fn-that-calls-server IS transitively async + awaits the peer", () => {
    const src = `<program>
\${
    server function loadCount() {
        return 42
    }

    function clientWrapper() {
        const c = loadCount()
        return c + 10
    }

    function outerCaller() {
        const r = clientWrapper()
        @display = r
    }

    <display> = 0
}

<button onclick=outerCaller()>Outer</button>
<span>\${@display}</span>
</>
`;
    const { clientJs } = compileSource(src, "l3-transitive-tripwire");
    expect(clientJs).toBeTruthy();
    // L1 — clientWrapper correctly gets async (direct server caller).
    expect(clientJs).toMatch(/async function _scrml_clientWrapper_\d+/);
    // L3 RESOLVED (Seam-A Gap 2) — outerCaller calls clientWrapper (an async
    // client peer), so the transitive fixpoint colors outerCaller async AND
    // awaits its peer call. Without both, clientWrapper's Promise leaks into
    // `@display` (`[object Promise]` instead of the resolved value).
    expect(clientJs).toMatch(/async function _scrml_outerCaller_\d+/);
    expect(clientJs).toMatch(/await\s+_scrml_clientWrapper_\d+\s*\(/);
  });
});
