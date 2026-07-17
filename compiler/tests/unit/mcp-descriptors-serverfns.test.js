/**
 * mcp-descriptors-serverfns.test.js — MCP-V0.A extractor unit test (serverfns.json)
 *
 * Sub-unit A test follow-on. Compiles a fixture with multiple `server function`
 * decls of varied signatures via the REAL per-route emit path, reads
 * `serverfns.json` from disk, and asserts the descriptor shape per SCOPING §3
 * Sub-unit A + §1 Tool 5 (name + params[{name,type}] + returnType + file +
 * dispatchable:false permanent v0 marker).
 *
 * Server-fn fixture authoring note: `server function f(x: int) { ... }` inside a
 * `${ ... }` block. Per the kickstarter auto-await rule, NO async/await in the
 * body. Param types annotate via `name: Type`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  makeSidecarTmpRoot,
  cleanupSidecarTmpRoot,
  compileAndReadSidecars,
} from "../helpers/mcp-sidecar-compile.js";

let TMP;
beforeAll(() => { TMP = makeSidecarTmpRoot("serverfns"); });
afterAll(() => { cleanupSidecarTmpRoot(TMP); });

const compile = (src) => compileAndReadSidecars(src, TMP);

// ---------------------------------------------------------------------------
// Fixture — three server functions of varied arity / typing.
// ---------------------------------------------------------------------------

const SERVERFN_FIXTURE = `<program title="ServerFns" db="./app.db">

\${
  server function loadRows(limit: int) {
    return ?{\`SELECT id FROM items LIMIT \${limit}\`}.all()
  }

  server function saveName(name: string, active: boolean) {
    ?{\`INSERT INTO names (n, a) VALUES (\${name}, \${active})\`}.run()
  }

  server function ping() {
    return 1
  }
}

<div>placeholder</div>

</program>
`;

describe("MCP-V0.A serverfns.json extractor", () => {
  test("compiles clean + emits serverfns.json as a JSON array of all server fns", () => {
    const { fatal, serverFns } = compile(SERVERFN_FIXTURE);
    expect(fatal).toEqual([]);
    expect(Array.isArray(serverFns)).toBe(true);
    const names = serverFns.map((f) => f.name).sort();
    expect(names).toEqual(["loadRows", "ping", "saveName"]);
  });

  test("params carry name + type from the source annotation", () => {
    const { serverFns } = compile(SERVERFN_FIXTURE);
    const byName = Object.fromEntries(serverFns.map((f) => [f.name, f]));
    expect(byName.loadRows.params).toEqual([{ name: "limit", type: "int" }]);
    expect(byName.saveName.params).toEqual([
      { name: "name", type: "string" },
      { name: "active", type: "boolean" },
    ]);
    expect(byName.ping.params).toEqual([]);
  });

  test("each descriptor carries returnType, declaring file, and dispatchable:false", () => {
    const { serverFns, sourceFile } = compile(SERVERFN_FIXTURE);
    for (const fn of serverFns) {
      expect(typeof fn.returnType).toBe("string"); // "unknown" when unannotated
      expect(fn.file).toBe(sourceFile);
      // Permanent v0 marker — read-only enumeration, no invocation surface.
      expect(fn.dispatchable).toBe(false);
    }
  });

  test("a non-server (client) function is NOT surfaced (isServer gate)", () => {
    const src = `<program title="Mixed" db="./app.db">

\${
  <count> = 0
  server function persist(v: int) {
    ?{\`INSERT INTO t (v) VALUES (\${v})\`}.run()
  }
  function inc() {
    @count = @count + 1
  }
}

<button onclick=inc()>+</button>

</program>
`;
    const { fatal, serverFns } = compile(src);
    expect(fatal).toEqual([]);
    const names = serverFns.map((f) => f.name);
    expect(names).toContain("persist"); // server fn surfaces
    expect(names).not.toContain("inc"); // client fn does not
  });

  test("emitted serverfns.json round-trips as valid JSON", () => {
    const { serverFns } = compile(SERVERFN_FIXTURE);
    expect(() => JSON.stringify(serverFns)).not.toThrow();
  });
});
