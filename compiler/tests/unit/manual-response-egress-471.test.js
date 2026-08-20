/**
 * manual-response-egress-471.test.js — the §40 / §14.8.9 manual-`Response`
 * egress path, adopter #471 (enterprise document workflows: PDF/binary bodies).
 *
 * Two independent defects, both surfaced by the same `handle()` body building a
 * PDF response and both fixed together:
 *
 *   1. E-SCOPE-001 on the bare host global `Response`. The Fetch-Standard
 *      constructors (`Response`/`Request`/`Headers`) were never in
 *      LOGIC_SCOPE_GLOBAL_ALLOWLIST (type-system.ts), so `new Response(body, …)`
 *      in a handle body fired a spurious "Undeclared identifier `Response`".
 *      (`File`/`FormData`/`Blob` deliberately NOT allowlisted — the file-upload
 *      arrival-shape primitive is an open dpa-030 deliberation.)
 *
 *   2. A non-identifier object-literal key emitted UNQUOTED. `{ "content-type":
 *      … }` — the header an adopter must set on a PDF response — lowered to
 *      `{content-type: …}` (quotes stripped), invalid JS → E-CODEGEN-INVALID-LOGIC.
 *      emitObjectKey (emit-expr.ts) now re-quotes any key that is not a valid JS
 *      IdentifierName or a non-negative integer index.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileServer(source, suffix = "resp-egress") {
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

const RESPONSE_SRC = `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
  const r = new Response("hello", { status: 200 })
  return r
}
`;

// The realistic #471 shape: a PDF body with a hyphenated content-type header —
// exercises BOTH fixes at once (the `Response` global AND the quoted hyphen key).
const PDF_RESPONSE_SRC = `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
  return new Response("pdf-bytes", { headers: { "content-type": "application/pdf" } })
}
`;

const HYPHEN_KEY_SRC = `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
  const h = { "content-type": "application/pdf" }
  return resolve(request)
}
`;

const IDENT_KEY_SRC = `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
  const h = { contentType: "application/pdf", status: 200 }
  return resolve(request)
}
`;

describe("§39.3 handle() — `Response` is an allowlisted host global (#471)", () => {
  test("`new Response(...)` in a handle body compiles clean (no E-SCOPE-001)", () => {
    const { errors, serverJs } = compileServer(RESPONSE_SRC);
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/new Response\("hello", \{status: 200\}\)/);
  });

  test("the full #471 PDF-egress shape compiles (Response global + hyphen header key)", () => {
    const { errors, serverJs } = compileServer(PDF_RESPONSE_SRC);
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/new Response\("pdf-bytes"/);
    expect(serverJs).toMatch(/\{"content-type": "application\/pdf"\}/);
  });
});

describe("object-literal — a non-identifier quoted key is re-quoted (#471 content-type header)", () => {
  test("a hyphenated key `\"content-type\"` emits QUOTED (valid JS, was E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors, serverJs } = compileServer(HYPHEN_KEY_SRC);
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/\{"content-type": "application\/pdf"\}/);
  });

  test("valid-identifier keys stay BARE — no regression to the common case", () => {
    const { errors, serverJs } = compileServer(IDENT_KEY_SRC);
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/contentType: "application\/pdf"/);
    expect(serverJs).not.toMatch(/"contentType":/);
    expect(serverJs).toMatch(/status: 200/);
  });
});
