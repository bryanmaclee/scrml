/**
 * m65-b4-sql-leak.test.js — M6.5.b.4 (FIX-NATIVE, SECURITY) END-TO-END GATE.
 *
 * THE LOAD-BEARING TEST. The M6.7-STOP leak is NATIVE-PIPELINE-ONLY: under
 * the LIVE parser the bare `?{}` is already `kind:"sql"` and W-CG-001 fires,
 * so the default full suite (which runs under live) does NOT catch the leak.
 * This test drives the NATIVE pipeline (`parser: "scrml-native"`) EXPLICITLY
 * through codegen and asserts:
 *   1. server-only SQL at non-server scope does NOT reach client.js, AND
 *   2. W-CG-001 fires (the server-only block IS detected and suppressed),
 * matching the LIVE pipeline behaviour exactly.
 *
 * Covers both the PRIMARY (bare `?{}` -> kind:"sql") and the SECONDARY
 * (chained `?{}.get()` whose nested sql-ref is caught by isServerOnlyNode).
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let _tmp = 0;

function compile(source, slug, parser) {
  const name = `${slug}-${parser || "live"}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_m65b4_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    let clientJs = "";
    let serverJs = "";
    for (const [, out] of result.outputs || new Map()) {
      if (out.clientJs) clientJs += out.clientJs;
      if (out.serverJs) serverJs += out.serverJs;
    }
    return {
      warnings: result.warnings ?? [],
      errors: result.errors ?? [],
      clientJs,
      serverJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// A server-only `?{}` SQL block at NON-server scope (top-level `${...}`, NOT
// inside a `server fn`). This is exactly the SCOPING §1.1 M6.7-STOP shape.
const BARE_SQL = `<program db="postgres"></>
\${
    ?{\`SELECT secret FROM credentials\`}
}
<p>x</>`;

const CHAINED_SQL = `<program db="postgres"></>
\${
    ?{\`DELETE FROM credentials\`}.run()
}
<p>x</>`;

// A client-side SQL exec would surface as one of these tokens in client.js.
const CLIENT_SQL_LEAK = /_scrml_sql|SELECT secret|DELETE FROM credentials/;

describe("M6.5.b.4 — server-only SQL must NOT leak into client.js (native pipeline)", () => {
  test("PRIMARY: bare ?{} at non-server scope — NO SQL in NATIVE client.js", () => {
    const { clientJs } = compile(BARE_SQL, "bare", "scrml-native");
    expect(CLIENT_SQL_LEAK.test(clientJs)).toBe(false);
  });

  test("PRIMARY: bare ?{} fires W-CG-001 under NATIVE (server-only detected)", () => {
    const { warnings } = compile(BARE_SQL, "bare", "scrml-native");
    expect(warnings.some((w) => w.code === "W-CG-001")).toBe(true);
  });

  test("PRIMARY: NATIVE client.js matches LIVE (no client SQL on either)", () => {
    const live = compile(BARE_SQL, "bare", null);
    const native = compile(BARE_SQL, "bare", "scrml-native");
    expect(CLIENT_SQL_LEAK.test(live.clientJs)).toBe(false);
    expect(CLIENT_SQL_LEAK.test(native.clientJs)).toBe(false);
    expect(live.warnings.some((w) => w.code === "W-CG-001")).toBe(true);
    expect(native.warnings.some((w) => w.code === "W-CG-001")).toBe(true);
  });

  test("SECONDARY: chained ?{}.run() at non-server scope — NO SQL in NATIVE client.js", () => {
    const { clientJs } = compile(CHAINED_SQL, "chained", "scrml-native");
    expect(CLIENT_SQL_LEAK.test(clientJs)).toBe(false);
  });

  test("SECONDARY: chained ?{}.run() fires W-CG-001 under NATIVE (sql-ref detected)", () => {
    const { warnings } = compile(CHAINED_SQL, "chained", "scrml-native");
    expect(warnings.some((w) => w.code === "W-CG-001")).toBe(true);
  });
});
