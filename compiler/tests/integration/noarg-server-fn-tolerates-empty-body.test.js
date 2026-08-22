// A no-ARGUMENT server function must not require a request body.
//
// The server-fn handler emits `const _scrml_body = await _scrml_req.json();` and then
// binds each parameter from it (`_scrml_body["p"]`). For a ZERO-parameter function that
// read is dead — nothing consumes `_scrml_body` — but it is UNGUARDED, so an external,
// non-scrml-client caller (curl, an API consumer, a test) POSTing the endpoint with an
// empty/absent body hits an uncaught `await req.json()` throw ("Unexpected end of JSON
// input") → an opaque 500. (The scrml client always sends `JSON.stringify({})`, so the
// happy path masks it.) bun 1.4.0 makes the throw reliable where 1.3.x could be lenient.
//
// Fix (emit-server.ts): when a server function has zero parameters, tolerate an empty
// body with `.json().catch(() => ({}))`. `_scrml_body` stays defined (safe for any
// server-mode `@cell` read), and the ARG-BEARING path keeps the strict read verbatim —
// a missing body for a call that carries arguments IS an error, unchanged.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "node:url";
import { compileScrml } from "../../src/api.js";

const testDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_noarg_empty_body");
let n = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compile(src, tagBase) {
  const tag = `${tagBase}-${++n}`;
  const dir = resolve(TMP_ROOT, tag);
  const outDir = resolve(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(dir, `${tag}.scrml`);
  writeFileSync(input, src);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const serverJsPath = join(outDir, `${tag}.server.js`);
  return {
    errors: (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "")),
    serverJs: existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf-8") : null,
    serverJsPath,
  };
}

const NO_ARG = `<program>
  \${
    export server function ping() {
      return "pong"
    }
  }
  <button onclick=ping()>Ping</button>
</program>`;

const ONE_ARG = `<program>
  \${
    export server function echo(msg) {
      return msg
    }
  }
  <button onclick=echo("x")>Echo</button>
</program>`;

describe("no-arg server fn tolerates an empty request body", () => {
  test("emission — a ZERO-param handler reads the body with a `.catch(() => ({}))` guard", () => {
    const { errors, serverJs } = compile(NO_ARG, "noarg");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("await _scrml_req.json().catch(() => ({}))");
  });

  test("emission — an ARG-BEARING handler keeps the STRICT read (no `.catch`), unchanged", () => {
    const { errors, serverJs } = compile(ONE_ARG, "onearg");
    expect(errors).toEqual([]);
    // The strict form is still present …
    expect(serverJs).toContain("const _scrml_body = await _scrml_req.json();");
    // … and the arg-bearing handler must NOT acquire the tolerant guard (the fix is
    // scoped to zero-param functions only, so the arg wire semantics are untouched).
    expect(serverJs).not.toContain("await _scrml_req.json().catch(() => ({}))");
  });

  test("runtime — a CSRF-valid POST with NO body resolves 200 (was an uncaught 500)", async () => {
    // happy-dom (registered globally by sibling browser tests in a full-suite run)
    // swaps in a spec-strict Request that strips forbidden headers; the exchange below
    // needs bun's native Request. The emission assertions above always run.
    if (typeof globalThis.document !== "undefined") return;

    const { errors, serverJsPath } = compile(NO_ARG, "noarg-rt");
    expect(errors).toEqual([]);
    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const route = (mod.routes ?? []).find((r) => String(r.path).includes("ping"));
    expect(route).toBeTruthy();

    // Baseline double-submit CSRF: a matching cookie + header pair. No body at all.
    const T = "csrf-test-token";
    const res = await route.handler(
      new Request(`http://localhost${route.path}`, {
        method: "POST",
        headers: { "X-CSRF-Token": T, Cookie: `scrml_csrf=${T}` },
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(await res.json()).toBe("pong");
  });
});
