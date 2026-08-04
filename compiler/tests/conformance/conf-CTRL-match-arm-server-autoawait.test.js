/**
 * CONF-CTRL-match-arm | §13.2 Compiler-Managed Asynchrony (position-invariant
 * auto-await) + §19.9.3 (match arms are a CPS-eligible position)
 *
 * Normative (compiler/SPEC.md:7247): insert `await` at EVERY server-generated
 * fetch call site, and wrap ANY function containing at least one server call in
 * `async`. §13.2 is POSITION-INVARIANT — the value-form `match` arm
 * (`const x = match k { 1 :> getFlag().ok  _ :> false }`) is such a position.
 *
 * Gap `g-match-arm-server-call-no-autoawait` (MED, silent): pre-fix, a server
 * call inside a client value-form match arm re-emitted from a raw expression
 * string on a path the #87 statement-level auto-await never reached — so it
 * shipped a BARE unawaited Promise and the enclosing fn stayed sync. `.ok` read
 * off the pending Promise → `undefined` (reviews as correct, silent-wrong).
 *
 * Two halves:
 *   CODES  — the emitted client function is `async`, and the arm-body call site
 *            carries a PARENTHESIZED `(await _scrml_fetch_getFlag_*()).ok` (the
 *            paren is load-bearing: `await f().ok` awaits the `.ok` read off the
 *            Promise, the wrong thing).
 *   RUNTIME — executing the emitted function with a stubbed async fetch shim
 *            resolves `run(1)` to `true` (a bare unawaited Promise would make the
 *            `.ok` read `undefined`). Proves the emitted `await` actually awaits.
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

const MATCH_SRC = `<program>
\${
    server function getFlag() {
        return { ok: true }
    }
    function run(k: int) {
        const label = match k {
            1 :> getFlag().ok
            _ :> false
        }
        return label
    }
}
<button onclick=run(1)>Run</button>
</>
`;

describe("CONF-CTRL-match-arm: value-form match-arm server-call auto-await (§13.2 / §19.9.3)", () => {
  test("CODES: match-arm server call is `async` + parenthesized `(await …)`", () => {
    const { clientJs, errors } = compileClient(MATCH_SRC, "codes");
    expect(errors.filter(e => e.severity !== "warning").length).toBe(0);
    // (1) the enclosing client fn is `async`.
    expect(clientJs).toMatch(/async function _scrml_run_\d+/);
    // (2) the arm-body server call is awaited AND parenthesized so `.ok` reads the
    //     RESOLVED value: `(await _scrml_fetch_getFlag_N(...)) . ok`.
    expect(/\(\s*await\s+_scrml_fetch_getFlag_\d+\s*\(\s*\)\s*\)\s*\.\s*ok/.test(clientJs)).toBe(true);
    // (3) the WRONG bare form must NOT appear: `= _scrml_fetch_getFlag_N ( ) . ok`
    //     with no leading `(await`.
    expect(/=\s*_scrml_fetch_getFlag_\d+\s*\(\s*\)\s*\.\s*ok/.test(clientJs)).toBe(false);
  });

  test("RUNTIME: executing the emitted fn awaits the fetch and resolves the value", async () => {
    const { clientJs } = compileClient(MATCH_SRC, "runtime");
    const runSrc = extractFn(clientJs, "_scrml_run_\\d+");
    expect(runSrc).toBeTruthy();
    const fetchName = clientJs.match(/_scrml_fetch_getFlag_\d+/)[0];
    const runName = runSrc.match(/function\s+(_scrml_run_\d+)/)[1];

    // Stub the server fetch shim (async, resolves the server return value), then
    // eval the emitted `run` in that scope and drive it.
    const harness = new Function(fetchName, `${runSrc}\nreturn ${runName};`);
    const run = harness(async () => ({ ok: true }));
    const observed = await run(1);

    // With the emitted `(await fetch()).ok`, the result is `true`. A bare unawaited
    // Promise would make `.ok` `undefined`.
    expect(observed).toBe(true);
  });
});
