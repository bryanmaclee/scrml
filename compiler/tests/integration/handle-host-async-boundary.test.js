/**
 * §19.9.8 JS-host async boundary inside the §39.3 `handle()` escape hatch
 * (dpa-030 D3).
 *
 * §19.9.8 is absolute: `await` is not valid scrml source anywhere
 * (`E-AWAIT-NOT-IN-SCRML`). §39.3.2 defines the handler's signature as
 *
 *     function handle(request: Request, resolve: (req: Request) => Response) -> Response
 *
 * `resolve` is compiler-emitted `async` (it dispatches the route) and `request`
 * is a WHATWG `Request` whose `Body`-mixin methods return Promises. Unawaited,
 * BOTH of SPEC's own worked examples throw at runtime — and the adopter cannot
 * fix either one, because writing `await` is a compile error. Only the compiler
 * can insert the boundary, and §19.9.8's JS-host clause says it must:
 *
 *   "the JS-side mechanism is bounded at the boundary; the scrml-side surface
 *    is uniform."
 *
 * These tests EXECUTE the emitted middleware wrapper. "The `await` is present in
 * the text" is a hypothesis; a 200 with the right body is the result.
 */
import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compileHandle(handleBody) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-handle-async-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, `<program db="app.db">
  \${
${handleBody}
  }
  <div><p>hi</p></div>
</program>`);
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dir, validateEmit: true, log: () => {} });
  const serverJs = readFileSync(join(dir, "app.server.js"), "utf8");
  return { result, serverJs };
}

/**
 * Extract `_scrml_mw_wrap` VERBATIM from the emitted artifact and run it. No
 * re-implementation: this is the code the adopter's server executes.
 */
function runMiddleware(serverJs, request, routeHandler = async () => new Response("ok", { status: 200 })) {
  const start = serverJs.indexOf("function _scrml_mw_wrap(");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = serverJs.indexOf("\n}\n", start) + 3;
  const make = new Function(
    "_scrml_structural_eq",
    serverJs.slice(start, end) + "\nreturn _scrml_mw_wrap;",
  );
  const wrap = make((a, b) => a === b);
  return wrap(routeHandler)(request);
}

const formPost = (body = "name=ada") =>
  new Request("http://x/", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

describe("§39.3.1 — SPEC's own primary `handle()` example runs", () => {
  // Verbatim from SPEC.md:22604-22613.
  const SPEC_3931 = `    function handle(request, resolve) {
      const start = Date.now()
      const response = resolve(request)
      response.headers.set("X-Response-Time", \`\${Date.now() - start}ms\`)
      return response
    }`;

  test("EXECUTED: it returns 200 (before: TypeError on response.headers.set)", async () => {
    const { serverJs } = compileHandle(SPEC_3931);
    const res = await runMiddleware(serverJs, new Request("http://x/"));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("X-Response-Time")).toMatch(/^\d+ms$/);
  });

  test("the emitted dispatch is awaited", () => {
    const { serverJs } = compileHandle(SPEC_3931);
    expect(serverJs).toContain("const response = await resolve(request);");
  });
});

describe("§19.9.8 — `request` Body-mixin methods cross the boundary", () => {
  test("EXECUTED: request.formData() (before: TypeError: fd.get is not a function)", async () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      if (request.method == "POST") {
        const fd = request.formData()
        const name = fd.get("name")
        return new Response(name, { status: 200 })
      }
      return resolve(request)
    }`);
    // The `if` nesting is load-bearing: control-flow emitters rebuild a FRESH
    // EmitExprContext, which is exactly why the classifier is file-scoped rather
    // than ctx-threaded. A ctx-threaded fix would silently miss this shape.
    expect(serverJs).toContain("const fd = await request.formData();");
    const res = await runMiddleware(serverJs, formPost());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ada");
  });

  test("EXECUTED: request.text()", async () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      const body = request.text()
      return new Response(body, { status: 200 })
    }`);
    expect(serverJs).toContain("await request.text()");
    const res = await runMiddleware(serverJs, formPost("raw-bytes"));
    expect(await res.text()).toBe("raw-bytes");
  });

  test("EXECUTED: request.json()", async () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      const body = request.json()
      return new Response(body.who, { status: 200 })
    }`);
    expect(serverJs).toContain("await request.json()");
    const res = await runMiddleware(serverJs, new Request("http://x/", {
      method: "POST", body: JSON.stringify({ who: "ada" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(await res.text()).toBe("ada");
  });

  test("RECEIVER POSITION: `request.formData().get(k)` gets the precedence parens", async () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      return new Response(request.formData().get("name"), { status: 200 })
    }`);
    // Without the wrap this is `await (request.formData().get("name"))` — awaiting
    // `undefined.get`, i.e. a TypeError, or worse a silent wrong value.
    expect(serverJs).toContain('(await request.formData()).get("name")');
    const res = await runMiddleware(serverJs, formPost());
    expect(await res.text()).toBe("ada");
  });

  // ⚠ CORRECTION, recorded because I got it wrong first and the test caught it.
  // I assumed §39.3.2's signature left the parameter SPELLINGS free and wrote a
  // test for `function handle(req, next)`. It does not: §12.2 Trigger 8 pins
  // recognition to "exactly two parameters named `request` and `resolve`"
  // (`isHandleEscapeHatch`, ast-builder.js), so `handle(req, next)` is not the
  // escape hatch at all — it is a dead ordinary function, W-DEAD-FUNCTION, and
  // NO `.server.js` is emitted. Pinned here so the assumption is not re-made.
  test("the parameter names are PINNED — `handle(req, next)` is not the escape hatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-handle-async-names-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, `<program db="app.db">
  \${
    function handle(req, next) {
      const fd = req.formData()
      return new Response(fd.get("name"), { status: 200 })
    }
  }
  <div><p>hi</p></div>
</program>`);
    const result = compileScrml({ inputFiles: [file], write: true, outputDir: dir, validateEmit: true, log: () => {} });
    const all = [...(result.warnings ?? []), ...(result.errors ?? []), ...(result.lintDiagnostics ?? [])];
    expect(all.some((d) => d.code === "W-DEAD-FUNCTION")).toBe(true);
    expect(existsSync(join(dir, "app.server.js"))).toBe(false);
  });
});

describe("NEGATIVE CONTROLS — the boundary is narrow on purpose", () => {
  test("a SYNC host method is NOT awaited (`clone()` is not a Body-mixin method)", () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      const r2 = request.clone()
      return resolve(r2)
    }`);
    expect(serverJs).toContain("const r2 = request.clone();");
    expect(serverJs).not.toContain("await request.clone()");
  });

  test("a plain PROPERTY read is untouched", () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      const m = request.method
      return resolve(request)
    }`);
    expect(serverJs).toContain("const m = request.method;");
    expect(serverJs).not.toContain("await request.method");
  });

  test("the binding map is scoped to the handle() body — a SIBLING fn is unaffected", () => {
    const { serverJs } = compileHandle(`    function handle(request, resolve) {
      return resolve(request)
    }
    export function elsewhere(request) {
      return request.text()
    }`);
    // Inside handle(): awaited.
    expect(serverJs).toContain("return await resolve(request);");
    // In a sibling fn a parameter that merely SHARES the name is an ordinary
    // value with no §39.3.2 type behind it — awaiting it would be a guess.
    const elsewhereIdx = serverJs.indexOf("function elsewhere(");
    if (elsewhereIdx >= 0) {
      const tail = serverJs.slice(elsewhereIdx, elsewhereIdx + 300);
      expect(tail).not.toContain("await request.text()");
    }
  });

  test("a program with NO handle() emits no host-async lowering at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-handle-async-none-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, `<program db="app.db">
  \${
    export server function ping(request) {
      return request.text()
    }
  }
  <div><p>hi</p></div>
</program>`);
    compileScrml({ inputFiles: [file], write: true, outputDir: dir, validateEmit: true, log: () => {} });
    const serverJs = readFileSync(join(dir, "app.server.js"), "utf8");
    expect(serverJs).not.toContain("await request.text()");
  });
});
