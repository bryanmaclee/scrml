/**
 * CONF-CTRL-i87 | §13.2 Compiler-Managed Asynchrony (position-invariant auto-await)
 *
 * Normative (compiler/SPEC.md:7247): insert `await` at EVERY server-generated
 * fetch call site, and wrap ANY function containing at least one server call in
 * `async`. This is POSITION-INVARIANT — it holds for a call written `const x =
 * fn()` at the top of a function body AND one block deep inside `if`/`for`/
 * `while`, AND for the reassignment form `x = fn()`.
 *
 * Adopter #87 (HIGH, silent): pre-fix, only the top-level `const` form got the
 * `await`; nested + reassign forms emitted a bare unawaited Promise → every
 * `if (res.error)` guard after the call became dead code.
 *
 * Two halves:
 *   CODES  — the emitted client function is `async` and the nested call site
 *            carries `await _scrml_fetch_getFlag_*`.
 *   RUNTIME — executing the emitted function with a stubbed async fetch shim
 *            resolves the value (a bare unawaited Promise would leave `.ok`
 *            undefined). Proves the emitted `await` actually awaits.
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

const NESTED_SRC = `<program>
\${
    server function getFlag() {
        return { ok: true }
    }
    function run(flag) {
        if (flag) {
            const res = getFlag()
            return res.ok
        }
        return false
    }
}
<button onclick=run(true)>Run</button>
</>
`;

describe("CONF-CTRL-i87: nested server-call auto-await (§13.2 position-invariant)", () => {
  test("CODES: nested-in-if server call is `async` + `await`ed", () => {
    const { clientJs, errors } = compileClient(NESTED_SRC, "codes");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    expect(/const res = await _scrml_fetch_getFlag_\d+\s*\(/.test(clientJs)).toBe(true);
  });

  test("RUNTIME: executing the emitted fn awaits the fetch and resolves the value", async () => {
    const { clientJs } = compileClient(NESTED_SRC, "runtime");
    const runSrc = extractFn(clientJs, "_scrml_run_\\d+");
    expect(runSrc).toBeTruthy();
    const fetchName = clientJs.match(/_scrml_fetch_getFlag_\d+/)[0];
    const runName = runSrc.match(/function\s+(_scrml_run_\d+)/)[1];

    // Stub the server fetch shim (async, resolves the server return value), then
    // eval the emitted `run` in that scope and drive it.
    const harness = new Function(fetchName, `${runSrc}\nreturn ${runName};`);
    const run = harness(async () => ({ ok: true }));
    const observed = await run(true);

    // With the emitted `await`, `res` is the resolved object and `res.ok` is
    // `true`. A bare unawaited Promise would make `res.ok` `undefined`.
    expect(observed).toBe(true);
  });
});
