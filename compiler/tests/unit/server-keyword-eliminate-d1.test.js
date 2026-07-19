/**
 * server-keyword-eliminate-d1.test.js — D1 proof test
 *
 * Change-id: server-keyword-eliminate-2026-06-10 (dispatch D1 of 5).
 *
 * D1 re-points THREE codegen/type decisions from the deprecated explicit
 * `server` KEYWORD (`node.isServer === true`) to the INFERRED server boundary
 * computed by route-inference (§12) — `routeMap.functions[...].boundary ===
 * "server"`. After D1, the `server` keyword is BEHAVIOR-IRRELEVANT for an
 * escalating function: a keyless `function f()` whose body escalates it to the
 * server boundary (a `?{}` SQL block, a server-only import, file-IO, a
 * protected-field access, a server callee) behaves IDENTICALLY to the
 * `server function f()` form on all three axes.
 *
 * The three re-pointed sites:
 *   Site 1  emit-client.ts detectRuntimeChunks — the `wire` chunk gate (§57
 *           `_scrml_wire_decode` dual-decoder referenced by server-fn fetch
 *           stubs). Must light up for a keyless escalating server fn.
 *   Site 2  mcp-descriptors.ts collectServerFnNodes — MCP RPC discovery
 *           (serverfns.json). Must surface a keyless escalating server fn.
 *   Site 3  type-system.ts checkLiftInFn — the §10.4 lift-as-return permission.
 *           A SERVER-boundary `function` MAY use `lift` as a return; a plain
 *           (client) `function` may NOT (E-SYNTAX-002). The permission must
 *           follow the INFERRED boundary, so a keyless escalating server fn
 *           that lifts is STILL permitted.
 *
 * The assertions pin three equivalences + two negatives:
 *   - keyless-escalating  ==  keyword-server      (wire + mcp + lift-permitted)
 *   - pure-client fn      !=  server              (no wire, no mcp)
 *   - pure-client fn + lift  -> E-SYNTAX-002      (no §10.4 permission)
 *
 * Drives the REAL compile path (compileScrml) — no hand-fabricated state.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "d1-server-keyword-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

let _ctr = 0;
/** Compile a single `.scrml` source via the real per-route emit path; return
 *  fatal errors, all error codes, the assembled runtime text, and the parsed
 *  serverfns.json descriptor array. */
function compileOne(source) {
  const dir = join(TMP, `c${_ctr++}`);
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, source);
  const outDir = join(dir, "dist");
  const result = compileScrml({
    inputFiles: [fp],
    outputDir: outDir,
    write: true,
    emitPerRoute: true,
    log: () => {},
  });
  const allCodes = (result.errors ?? []).map((e) => e.code);
  const fatal = (result.errors ?? []).filter(
    (e) =>
      e.severity !== "warning" &&
      !String(e.code ?? "").startsWith("W-") &&
      !String(e.code ?? "").startsWith("I-"),
  );
  const runtime = result.runtimeFilename
    ? readFileSync(join(outDir, result.runtimeFilename), "utf8")
    : "";
  const sfPath = join(outDir, "serverfns.json");
  const serverFns = existsSync(sfPath)
    ? JSON.parse(readFileSync(sfPath, "utf8"))
    : [];
  return { result, fatal, allCodes, runtime, serverFns, filePath: fp };
}

const wirePresent = (runtime) => runtime.includes("function _scrml_wire_decode");
const fnNames = (serverFns) => serverFns.map((f) => f.name).sort();

// ---------------------------------------------------------------------------
// Fixtures — same single-page shape, three function forms.
// ---------------------------------------------------------------------------

// (A) keyless fn whose body escalates via a `?{}` SQL block (§12 inference).
const KEYLESS_ESCALATING = `<program db="./app.db">
<count> = 0

\${
  function loadCount() {
    return ?{\`SELECT count(*) AS n FROM items\`}.get()
  }
}

<button onclick={ @count = @count + 1 }>count is \${@count}</button>
</program>
`;

// (B) the explicit `server function` form — same body. Behavior baseline.
const KEYWORD_SERVER = `<program db="./app.db">
<count> = 0

\${
  server function loadCount() {
    return ?{\`SELECT count(*) AS n FROM items\`}.get()
  }
}

<button onclick={ @count = @count + 1 }>count is \${@count}</button>
</program>
`;

// (C) a pure CLIENT fn — no escalation, no keyword.
const PURE_CLIENT = `<count> = 0

\${
  function pureAdd(a: int, b: int) {
    return a + b
  }
}

<button onclick={ @count = @count + 1 }>count is \${@count}</button>
`;

// lift-as-return §10.4 fixtures.
// (D) keyless escalating fn that `lift`s — permitted (server boundary).
const KEYLESS_ESCALATING_LIFT = `<program db="./app.db">
\${
  function buildRows() {
    \${ ?{\`SELECT id FROM items\`}.all() }
    lift <li>x</li>
  }
}
<ul>\${ buildRows() }</ul>
</program>
`;

// (E) keyword server fn that `lift`s — permitted (baseline).
const KEYWORD_SERVER_LIFT = `<program db="./app.db">
\${
  server function buildRows() {
    \${ ?{\`SELECT id FROM items\`}.all() }
    lift <li>x</li>
  }
}
<ul>\${ buildRows() }</ul>
</program>
`;

// (F) pure client fn that `lift`s — E-SYNTAX-002 (no §10.4 permission).
const PURE_CLIENT_LIFT = `\${
  function buildRows() {
    lift <li>x</li>
  }
}
<ul>\${ buildRows() }</ul>
`;

describe("D1 — `server` keyword is non-load-bearing for an escalating fn", () => {
  // -------------------------------------------------------------------------
  // Axis 1 — `wire` chunk (Site 1, emit-client.ts detectRuntimeChunks).
  // -------------------------------------------------------------------------
  test("Site 1 — keyless escalating fn lights the `wire` chunk (== keyword form)", () => {
    const keyless = compileOne(KEYLESS_ESCALATING);
    const keyword = compileOne(KEYWORD_SERVER);
    expect(keyless.fatal).toEqual([]);
    expect(keyword.fatal).toEqual([]);
    // Both forms ship the §57 dual-decoder — the keyword is irrelevant.
    expect(wirePresent(keyless.runtime)).toBe(true);
    expect(wirePresent(keyword.runtime)).toBe(true);
  });

  test("Site 1 — pure client fn does NOT light the `wire` chunk", () => {
    const client = compileOne(PURE_CLIENT);
    expect(client.fatal).toEqual([]);
    expect(wirePresent(client.runtime)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Axis 2 — MCP descriptors (Site 2, mcp-descriptors.ts).
  // -------------------------------------------------------------------------
  test("Site 2 — keyless escalating fn surfaces in serverfns.json (== keyword form)", () => {
    const keyless = compileOne(KEYLESS_ESCALATING);
    const keyword = compileOne(KEYWORD_SERVER);
    expect(fnNames(keyless.serverFns)).toEqual(["loadCount"]);
    expect(fnNames(keyword.serverFns)).toEqual(["loadCount"]);
  });

  test("Site 2 — pure client fn does NOT surface in serverfns.json", () => {
    const client = compileOne(PURE_CLIENT);
    expect(client.serverFns).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Axis 3 — §10.4 lift-as-return permission (Site 3, type-system.ts).
  // -------------------------------------------------------------------------
  test("Site 3 — keyless escalating fn may use lift-as-return (no E-SYNTAX-002, == keyword form)", () => {
    const keyless = compileOne(KEYLESS_ESCALATING_LIFT);
    const keyword = compileOne(KEYWORD_SERVER_LIFT);
    expect(keyless.allCodes).not.toContain("E-SYNTAX-002");
    expect(keyword.allCodes).not.toContain("E-SYNTAX-002");
  });

  test("Site 3 — pure client fn that lifts STILL fires E-SYNTAX-002 (no §10.4 permission)", () => {
    const client = compileOne(PURE_CLIENT_LIFT);
    expect(client.allCodes).toContain("E-SYNTAX-002");
  });

  // -------------------------------------------------------------------------
  // Cross-axis equivalence — the keyless escalating form is byte-equivalent to
  // the keyword form on all three observable surfaces simultaneously.
  // -------------------------------------------------------------------------
  test("keyless escalating ≡ keyword server on { wire, mcp } simultaneously", () => {
    const keyless = compileOne(KEYLESS_ESCALATING);
    const keyword = compileOne(KEYWORD_SERVER);
    expect(wirePresent(keyless.runtime)).toBe(wirePresent(keyword.runtime));
    expect(fnNames(keyless.serverFns)).toEqual(fnNames(keyword.serverFns));
  });
});
