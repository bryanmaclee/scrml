/**
 * CONF-CTRL-fnbody-autoawait-choke-point | §13.2 Compiler-Managed Asynchrony
 * (position-invariant auto-await) — the S320 unified fn-body choke-point.
 *
 * Normative (compiler/SPEC.md §13.2): insert `await` at EVERY server-generated
 * fetch call site, position-invariantly, and mark ANY function containing a
 * server call `async`. Pre-S320 the client-fn-body auto-await was a per-statement
 * STRING-REGEX pass that failed two ways, both silent-wrong-output:
 *
 *   g-hash87  (member-read misparen): `const p = getFlag().ok` emitted
 *             `const p = await getFlag().ok` === `await (getFlag().ok)` — reads
 *             `.ok` off the PENDING Promise (→ undefined), then awaits that.
 *   g-ternary-init: `const r = k==1 ? getFlag().ok : false` bare-prefixed the RHS
 *             (`await eq(k,1) ? … : …`) — bound the CONDITION, never the call.
 *   g-given-block: a server call one block deep in a `given` body emitted BARE
 *             (no await) — the string pass only descended if/for/while, not
 *             given/match-block/try; every guard after the call read a Promise.
 *
 * The fix routes ALL client fn bodies through ONE descend-into-control-flow +
 * paren-correct acorn injector (`injectFnBodyServerCallAwaits`), which wraps only
 * a receiver-tail call (`(await fn()).ok`) and leaves a no-tail call bare
 * (`await fn()`), so the pre-S320 output on the dominant no-tail case is byte-
 * identical.
 *
 * Each case is CODES (emitted shape) + RUNTIME (execute the emitted fn against a
 * stubbed async fetch shim and assert the RESOLVED value — a bare unawaited
 * Promise would make `.ok` undefined). R26: verify by EXECUTION, not static check.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compileClient(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(name)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Extract a top-level `[async] function NAME(...) { ... }` block by matching braces. */
function extractFn(js, nameRe) {
  const m = js.match(new RegExp(`(?:async\\s+)?function\\s+(${nameRe})\\s*\\(`));
  if (!m) return null;
  const start = m.index;
  const open = js.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") { depth--; if (depth === 0) return js.slice(start, i + 1); }
  }
  return null;
}

/**
 * Build a runnable copy of the emitted `run` fn: inject a stubbed async fetch
 * shim (resolves the server return value) and a structural-eq helper, then return
 * the driveable function. A bare unawaited Promise would leave `.ok` undefined.
 */
function drive(clientJs, fetchStub) {
  const runSrc = extractFn(clientJs, "_scrml_run_\\d+");
  if (!runSrc) throw new Error("could not extract _scrml_run_N");
  const fetchName = clientJs.match(/_scrml_fetch_getFlag_\d+/)[0];
  const runName = runSrc.match(/function\s+(_scrml_run_\d+)/)[1];
  const harness = new Function(
    fetchName,
    "_scrml_structural_eq",
    `${runSrc}\nreturn ${runName};`,
  );
  return harness(fetchStub, (a, b) => a === b);
}

const OK_STUB = async () => ({ ok: true });

// ---------------------------------------------------------------------------
// g-hash87 — member-read misparen: `const p = getFlag().ok`
// ---------------------------------------------------------------------------
const HASH87_SRC = `<page>
\${
    server function getFlag() -> { ok: bool } { return { ok: true } }
    function run() {
        const p = getFlag().ok
        return p
    }
}
<button onclick=run()>Run</button>
</>
`;

describe("g-hash87: member-read receiver is paren-wrapped `(await fn()).ok`", () => {
  test("CODES: `(await …).ok`, and NOT the bare `= await fn().ok` misparen", () => {
    const { clientJs, errors } = compileClient(HASH87_SRC, "hash87-codes");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/const p = \(\s*await\s+_scrml_fetch_getFlag_\d+\s*\(\s*\)\s*\)\s*\.\s*ok/.test(clientJs)).toBe(true);
    // The WRONG misparen `= await fn().ok` (no leading `(await`) must NOT appear.
    expect(/=\s*await\s+_scrml_fetch_getFlag_\d+\s*\(\s*\)\s*\.\s*ok/.test(clientJs)).toBe(false);
  });

  test("RUNTIME: resolves `.ok` off the RESOLVED value → true", async () => {
    const { clientJs } = compileClient(HASH87_SRC, "hash87-runtime");
    const run = drive(clientJs, OK_STUB);
    expect(await run()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// g-given-block — descend into a `given` body (the CPS-opaque-boundary root)
// ---------------------------------------------------------------------------
const GIVEN_SRC = `<page>
\${
    server function getFlag() -> { ok: bool } { return { ok: true } }
    function run(k) {
        given k {
            const r = getFlag()
            return r.ok
        }
        return false
    }
}
<button onclick=run(1)>Run</button>
</>
`;

describe("g-given-block: server call nested in a `given` body is async + awaited", () => {
  test("CODES: the given-nested call gets `await` (no-tail → bare) + fn is async", () => {
    const { clientJs, errors } = compileClient(GIVEN_SRC, "given-codes");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    // Descend fix — the call inside the lowered `given` (→ `if (k !== …)`) body
    // is awaited at all (pre-S320 it emitted bare, no await anywhere).
    expect(/const r = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });

  test("RUNTIME: run(1) awaits inside the given body → true; a bare Promise would be undefined", async () => {
    const { clientJs } = compileClient(GIVEN_SRC, "given-runtime");
    const run = drive(clientJs, OK_STUB);
    expect(await run(1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// g-ternary-init — `const r = k==1 ? getFlag().ok : false`
// ---------------------------------------------------------------------------
const TERNARY_SRC = `<page>
\${
    server function getFlag() -> { ok: bool } { return { ok: true } }
    function run(k) {
        const r = k == 1 ? getFlag().ok : false
        return r
    }
}
<button onclick=run(1)>Run</button>
</>
`;

describe("g-ternary-init: the ternary consequent call is awaited, not the condition", () => {
  test("CODES: `? (await fn()).ok :`, and the CONDITION is NOT awaited", () => {
    const { clientJs, errors } = compileClient(TERNARY_SRC, "ternary-codes");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    // `await` scopes to the consequent call (paren-wrapped for the `.ok` tail).
    expect(/\?\s*\(\s*await\s+_scrml_fetch_getFlag_\d+\s*\(\s*\)\s*\)\s*\.\s*ok\s*:/.test(clientJs)).toBe(true);
    // The pre-S320 bug bound the condition: `= await <cond> ? …`. Must NOT appear.
    expect(clientJs).not.toMatch(/=\s*await\s+_scrml_structural_eq/);
  });

  test("RUNTIME: run(1) → true (consequent resolves), run(0) → false", async () => {
    const { clientJs } = compileClient(TERNARY_SRC, "ternary-runtime");
    const run1 = drive(clientJs, OK_STUB);
    expect(await run1(1)).toBe(true);
    const run0 = drive(clientJs, OK_STUB);
    expect(await run0(0)).toBe(false);
  });
});
