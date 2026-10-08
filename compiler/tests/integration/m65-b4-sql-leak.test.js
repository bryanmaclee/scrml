/**
 * m65-b4-sql-leak.test.js — M6.5.b.4 (FIX-NATIVE, SECURITY) END-TO-END GATE.
 *
 * The M6.7-STOP leak was NATIVE-ONLY: under the LIVE parser the bare `?{}` is
 * already `kind:"sql"` and W-CG-001 fires. This file used to drive the whole
 * pipeline through the retired `parser: "scrml-native"` flag.
 *
 * S449 RE-POINT (security coverage kept, on the paths that exist):
 *   1. the native tree — `nativeParseFile` (the entry impl#1 calls for
 *      component / `^{}` / `<match>` re-parse) promotes both forms to a
 *      `kind:"sql"` statement, which is what isServerOnlyNode classifies;
 *   2. the PRODUCTION native path — a component whose body holds a `?{}` is
 *      re-parsed by `nativeParseFile` inside component-expander (no
 *      live-fallback pattern matches it); its SQL must not reach client.js and
 *      W-CG-001 must fire;
 *   3. the default pipeline — the original top-level shapes, no client SQL +
 *      W-CG-001.
 *
 * Covers both the bare `?{}` -> kind:"sql" form AND the chained
 * `?{}.get()` form. As of F2a (native-sql-chained-form-f2a-2026-06-04) the
 * chained form ALSO promotes to a kind:"sql" LogicStatement (translate-stmt.js
 * reconstructChainedSql), so isServerOnlyNode classifies it via the same
 * `kind === "sql"` path as the bare form (previously the chained form relied on
 * the SECONDARY isServerOnlyNode sql-ref hardening — now the primary path).
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { nativeAst, findNodes, errorsOf } from "../helpers/native-ast.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-live-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_m65b4_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
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

// A component whose body holds a server-only `?{}`. component-expander
// re-parses this body with `nativeParseFile` (none of its live-fallback
// patterns — hard-keyword binding, template interpolation, <each>/<match>,
// render call — matches), so the native `kind:"sql"` promotion is what keeps
// the query out of the client.
const COMPONENT_SQL = `<program db="postgres">
\${
  const Leaky = <div>\${ ?{\`SELECT secret FROM credentials\`} }</div>
}
<Leaky/>
</program>`;

describe("M6.5.b.4 — native tree: both ?{} forms promote to kind:\"sql\"", () => {
  test("bare ?{} at non-server scope", () => {
    const r = nativeAst(BARE_SQL);
    expect(errorsOf(r)).toEqual([]);
    const sql = findNodes(r.ast, (n) => n.kind === "sql");
    expect(sql).toHaveLength(1);
    expect(sql[0].query).toBe("SELECT secret FROM credentials");
  });

  test("chained ?{}.run() at non-server scope", () => {
    const r = nativeAst(CHAINED_SQL);
    expect(errorsOf(r)).toEqual([]);
    const sql = findNodes(r.ast, (n) => n.kind === "sql");
    expect(sql).toHaveLength(1);
    expect(sql[0].query).toBe("DELETE FROM credentials");
    expect(sql[0].chainedCalls.map((c) => c.method)).toEqual(["run"]);
  });
});

describe("M6.5.b.4 — server-only SQL in a component body (production native re-parse path)", () => {
  test("NO SQL in client.js", () => {
    const { clientJs } = compile(COMPONENT_SQL, "component");
    expect(CLIENT_SQL_LEAK.test(clientJs)).toBe(false);
  });

  test("W-CG-001 fires (server-only detected)", () => {
    const { warnings } = compile(COMPONENT_SQL, "component");
    expect(warnings.some((w) => w.code === "W-CG-001")).toBe(true);
  });
});

describe("M6.5.b.4 — server-only SQL at non-server scope (default pipeline)", () => {
  test("bare ?{} — NO SQL in client.js, W-CG-001 fires", () => {
    const live = compile(BARE_SQL, "bare");
    expect(CLIENT_SQL_LEAK.test(live.clientJs)).toBe(false);
    expect(live.warnings.some((w) => w.code === "W-CG-001")).toBe(true);
  });

  test("chained ?{}.run() — NO SQL in client.js, W-CG-001 fires", () => {
    const live = compile(CHAINED_SQL, "chained");
    expect(CLIENT_SQL_LEAK.test(live.clientJs)).toBe(false);
    expect(live.warnings.some((w) => w.code === "W-CG-001")).toBe(true);
  });
});
