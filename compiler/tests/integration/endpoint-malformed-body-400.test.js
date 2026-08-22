// §61.3/§61.5 — an <endpoint> with a malformed (or empty) request body must return
// the compiler-owned `{ error: { kind, message } }` 400 envelope, NOT throw.
//
// Regression for g-endpoint-malformed-json-body-throws-instead-of-400 (HIGH, S360-peter).
// The emitted `_scrml_endpoint_<n>` prologue used `await _scrml_req.json()`, which throws
// an uncaught SyntaxError on a malformed/empty body BEFORE the §41.13 decode IIFE runs —
// so the ::ParseError::Malformed → 400 path (which exists and is correct) was structurally
// unreachable for that input class. <endpoint> is the public foreign-caller surface (§61.1),
// so a malformed body is exactly the class most likely to arrive. Fix (emit-server.ts): read
// the body as RAW TEXT; the decode IIFE JSON-parses the string in its own try/catch and routes
// a parse throw to ::Malformed. Well-formed bodies round-trip identically.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "node:url";
import { compileScrml } from "../../src/api.js";

const testDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_endpoint_malformed_400");
let n = 0;

beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(() => { if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true }); });

const EP = `type M:enum = { Ping, Dispatch(prompt: string, project: string) }
fn handleDispatch(p: string, q: string) -> string { p }
<endpoint path="/x" method="POST" accepts=M>
  <Ping : { ok: true }>
  <Dispatch(prompt, project) : { echo: handleDispatch(prompt, project) }>
</endpoint>`;

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

describe("§61 <endpoint> malformed body → 400 (g-endpoint-malformed-json-body-throws-instead-of-400)", () => {
  test("emission — the endpoint prologue reads the body as raw text (`.text()`)", () => {
    const { errors, serverJs } = compile(EP, "emit");
    expect(errors).toEqual([]);
    // The <endpoint> prologue reads the body as raw text so the decode IIFE owns the
    // JSON.parse → ::Malformed → 400. (Whole-file `.not.toContain(".json()")` would be
    // brittle — a server-fn route in the same file legitimately still uses `.json()`.)
    expect(serverJs).toContain("const _scrml_body = await _scrml_req.text();");
  });

  test("runtime — valid bodies 200, malformed/empty bodies 400 ::Malformed (not a throw)", async () => {
    const { errors, serverJsPath } = compile(EP, "rt");
    expect(errors).toEqual([]);
    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const route = (mod.routes ?? []).find((r) => String(r.path).includes("/x"));
    expect(route).toBeTruthy();

    // The endpoint handler reads ONLY `_scrml_req.text()`, so a minimal duck-typed request
    // drives it — no dependency on the global Request (happy-dom-safe → runs in full-suite,
    // unlike a `.json()`-consuming server-fn handler which needs bun's native Request).
    const call = (body) =>
      route.handler({ method: "POST", url: `http://localhost${route.path}`, headers: new Headers(), text: async () => body });

    // Valid — unchanged behavior.
    const ok = await call(JSON.stringify({ tag: "Ping" }));
    expect(ok.status).toBe(200);

    // Existing decode-failure classes — unchanged (still 400, their own kinds).
    const missing = await call(JSON.stringify({ tag: "Dispatch" }));
    expect(missing.status).toBe(400);
    const unknown = await call(JSON.stringify({ tag: "Nope" }));
    expect(unknown.status).toBe(400);

    // THE FIX — malformed + empty bodies now route to the ::Malformed 400 envelope
    // instead of throwing an uncaught SyntaxError.
    for (const [label, body] of [["malformed", "{"], ["not-json", "not json"], ["empty", ""]]) {
      const res = await call(body);
      expect(res.status, `malformed-body class: ${label}`).toBe(400);
      const j = await res.json();
      expect(j.error?.kind, `malformed-body class: ${label}`).toBe("Malformed");
    }
  });
});
