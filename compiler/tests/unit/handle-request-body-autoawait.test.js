/**
 * handle-request-body-autoawait.test.js — g-handle-request-formdata-emitted-unawaited
 * (SPEC §39.3, adopter #471).
 *
 * A `handle(request, resolve)` escape-hatch body calling `request.formData()` /
 * `.json()` / `.text()` / `.arrayBuffer()` / `.blob()` emitted the host-method call
 * BARE — `const fd = request.formData()` → `fd` is a Promise → `fd.get("file")` throws.
 * scrml has no `await` keyword (E-AWAIT-NOT-IN-SCRML), and the server-fn auto-await only
 * awaits bare-name scrml SERVER-FN calls, so these Request methods slipped through. The
 * fix (`injectHandleRequestAwaits`, scheduling.ts) awaits them — scoped to the handle
 * body + the request param + the 5 async Request methods, so it never over-awaits.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileServer(source, suffix = "handle-await") {
  const name = `${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const srcFile = resolve(tmpDir, `${name}.scrml`);
  writeFileSync(srcFile, source);
  try {
    const result = compileScrml({ inputFiles: [srcFile], write: true, outputDir: outDir });
    const serverPath = resolve(outDir, `${name}.server.js`);
    return { errors: result.errors ?? [], serverJs: existsSync(serverPath) ? readFileSync(serverPath, "utf8") : "" };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

const HANDLE_SRC = `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
  const body = request.json()
  const fd = request.formData()
  const name = request.formData().get("name")
  const other = request.text()
  return resolve(request)
}
`;

// A different receiver (not the request param) must NOT be awaited — the fix is scoped.
const OTHER_RECEIVER_SRC = `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
  const shape = { formData: () => 1 }
  const v = shape.formData()
  return resolve(request)
}
`;

describe("§39.3 handle() — Request body reads are auto-awaited (g-handle-request-formdata-emitted-unawaited)", () => {
  test("`request.formData()` / `.json()` / `.text()` in a handle body emit WITH await", () => {
    const { serverJs, errors } = compileServer(HANDLE_SRC);
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const body = await request\.json\(\);/);
    expect(serverJs).toMatch(/const fd = await request\.formData\(\);/);
    expect(serverJs).toMatch(/const other = await request\.text\(\);/);
  });

  test("a chained Request read is paren-wrapped: `(await request.formData()).get(...)`", () => {
    const { serverJs } = compileServer(HANDLE_SRC);
    expect(serverJs).toMatch(/\(await request\.formData\(\)\)\.get\("name"\)/);
  });

  test("a `.formData()` on a NON-request receiver is NOT awaited (the fix is scoped)", () => {
    const { serverJs, errors } = compileServer(OTHER_RECEIVER_SRC);
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const v = shape\.formData\(\);/); // bare — not awaited
    expect(serverJs).not.toMatch(/await shape\.formData\(\)/);
  });
});
