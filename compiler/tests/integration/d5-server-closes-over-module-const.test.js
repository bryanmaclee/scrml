/**
 * d5-server-closes-over-module-const.test.js — D-5 (adopter report, S293).
 *
 * A module-level `const` closed over by a server-promoted fn shipped to the
 * CLIENT bundle only. The server bundle emitted the reference with no
 * declaration anywhere in it:
 *
 *     ${ const ROLES = ["admin", "editor", "viewer"]
 *        fn labelFor(i) { return ROLES[i] }
 *        server fn describe(i) -> string { return labelFor(i) } }
 *
 *     // reproD5.server.js
 *     async function labelFor(i) { return ROLES[i]; }   // ROLES: never declared
 *
 * -> `ReferenceError: ROLES is not defined` at RUNTIME, with ZERO compile errors
 * and ZERO warnings. `fn` declarations crossed the boundary fine; a module-level
 * `const` did not. The reporter said this cost them the most debugging time.
 *
 * The check EXECUTES the emitted server bundle (a grep for `const ROLES` in the
 * text would pass on a bundle that still crashes for an unrelated reason, and the
 * whole class of defect here is "compiled green, dead at runtime").
 *
 * §14.8.9 note: the fix ADDS the declaration to the server bundle; it does NOT
 * remove it from the client. §3 pins that — nothing left the client output, so
 * the protect-floor surface is untouched.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "d5-module-const-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

const SRC = `\${
    const ROLES = ["admin", "editor", "viewer"]
    const FALLBACK = ROLES[2]

    function labelFor(i) {
        return ROLES[i]
    }

    server function describe(i) -> string {
        return labelFor(i)
    }

    server function fallback() -> string {
        return FALLBACK
    }

    @out = not
    on mount { @out = describe(0) }
}

<div>
    <p>\${@out}</>
</div>
`;

function compileFixture(name, source) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const input = join(dir, `${name}.scrml`);
  writeFileSync(input, source);
  const outDir = join(dir, "out");
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const read = (f) => (existsSync(join(outDir, f)) ? readFileSync(join(outDir, f), "utf8") : "");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    serverPath: join(outDir, `${name}.server.js`),
    serverJs: read(`${name}.server.js`),
    clientJs: read(`${name}.client.js`),
  };
}

/**
 * A minimal request stub, NOT a global `Request`.
 *
 * When a sibling browser test has registered happy-dom, the global `Headers`
 * enforces the fetch spec's forbidden-header list and SILENTLY DROPS `Cookie`.
 * The emitted handler's double-submit CSRF check then sees an empty cookie token
 * and answers 403 — so this test passed in isolation and failed in the full
 * suite. The stub supplies exactly the four members the emitted handler reads
 * (`url`, `method`, `headers.get`, `json`), which keeps it independent of
 * whichever `Request` implementation happens to be installed globally.
 */
function stubRequest(path, body) {
  const headers = new Map([
    ["content-type", "application/json"],
    ["x-csrf-token", "tok"],
    ["cookie", "scrml_csrf=tok"],
  ]);
  return {
    url: `http://localhost${path}`,
    method: "POST",
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    json: async () => body,
  };
}

async function callRoute(serverPath, path, body) {
  const mod = await import(serverPath);
  const res = await mod.fetch(stubRequest(path, body));
  return { status: res.status, body: JSON.parse(await res.text()) };
}

describe("D-5 — a module const the server bundle closes over", () => {
  let compiled;
  beforeAll(() => { compiled = compileFixture("d5repro", SRC); });

  test("compiles clean", () => {
    expect(compiled.errors).toEqual([]);
  });

  test("§1 the server bundle DECLARES the const it references", () => {
    expect(compiled.serverJs).toContain("return ROLES[i];");
    expect(compiled.serverJs).toMatch(/^const ROLES = \["admin", "editor", "viewer"\];$/m);
  });

  test("§2 EXECUTES: the route resolves instead of throwing ReferenceError", async () => {
    const r = await callRoute(compiled.serverPath, "/_scrml/__ri_route_describe_2", { i: 0 });
    expect(r.status).toBe(200);
    expect(r.body).toBe("admin");
  });

  test("§2b EXECUTES: a const that reads an EARLIER const also resolves", async () => {
    const r = await callRoute(compiled.serverPath, "/_scrml/__ri_route_fallback_3", {});
    expect(r.status).toBe(200);
    expect(r.body).toBe("viewer");
  });

  test("§3 the CLIENT bundle is unchanged — nothing was relocated (§14.8.9)", () => {
    expect(compiled.clientJs).toContain(`const ROLES = ["admin", "editor", "viewer"];`);
  });

  test("§4 a client-only const is NOT copied into the server bundle", () => {
    const c = compileFixture(
      "d5clientonly",
      `\${
    const CLIENT_ONLY = ["a", "b"]
    @label = CLIENT_ONLY[0]

    server function ping() -> string {
        return "pong"
    }
}

<div><p>\${@label}</></div>
`,
    );
    expect(c.errors).toEqual([]);
    expect(c.serverJs).not.toContain("CLIENT_ONLY");
    expect(c.clientJs).toContain("CLIENT_ONLY");
  });

  test("§5 a const whose initializer cannot resolve server-side is SKIPPED, not guessed", () => {
    // `compute()` is not emitted into the server bundle; emitting
    // `const DERIVED = compute();` at server module scope would turn a call-time
    // ReferenceError into a module-LOAD crash. Fail-closed: skip it.
    const c = compileFixture(
      "d5unresolvable",
      `\${
    function compute() { return 7 }
    const DERIVED = compute()

    server function readIt() -> number {
        return DERIVED
    }
}

<div><p>x</></div>
`,
    );
    expect(c.errors).toEqual([]);
    expect(c.serverJs).not.toMatch(/^const DERIVED = /m);
  });
});
