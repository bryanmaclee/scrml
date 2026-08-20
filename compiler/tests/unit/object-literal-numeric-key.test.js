/**
 * object-literal-numeric-key.test.js — g-object-literal-bare-numeric-key-fails-codegen.
 *
 * A bare (unquoted) numeric object-literal key — `{ 0: x }` — trips
 * E-CODEGEN-INVALID-LOGIC with no emit. Root: expression-parser.ts mapped a
 * non-computed key as `keyNode.name ?? keyNode.value`, so a numeric Literal key
 * arrives as the NUMBER 0 (not a string); emitProp's `typeof key === "string"`
 * guard then routes the bare number into emitExpr as if it were an ExprNode.
 * Fix: stringify the literal key value at parse time — it then flows through
 * emitObjectKey (an integer re-emits bare, a float re-quotes). The quoted form
 * (`{ "0": x }`) always worked because its value is the string "0".
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileServer(source, suffix = "objkey") {
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

const wrap = (body) => `<program>
  <page><h1>u</h1></page>
</program>

function handle(request, resolve) {
${body}
  return resolve(request)
}
`;

describe("object literal — a bare numeric key compiles (g-object-literal-bare-numeric-key-fails-codegen)", () => {
  test("bare integer keys `{ 0: …, 42: … }` compile clean and emit BARE (valid JS)", () => {
    const { errors, serverJs } = compileServer(wrap(`  const h = { 0: "a", 42: "b" }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const h = \{0: "a", 42: "b"\}/);
  });

  test("the bare form matches the quoted form byte-for-byte", () => {
    const bare = compileServer(wrap(`  const h = { 0: "a" }`)).serverJs.match(/const h = [^\n;]*/)[0];
    const quoted = compileServer(wrap(`  const h = { "0": "a" }`)).serverJs.match(/const h = [^\n;]*/)[0];
    expect(bare).toBe(quoted);
    expect(bare).toBe(`const h = {0: "a"}`);
  });

  test("a float key `{ 1.5: … }` re-quotes (a bare `1.5:` would be invalid JS)", () => {
    const { errors, serverJs } = compileServer(wrap(`  const h = { 1.5: "a" }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const h = \{"1\.5": "a"\}/);
  });

  test("mixed keys: integer bare, identifier bare, hyphen quoted — no regression", () => {
    const { errors, serverJs } = compileServer(wrap(`  const h = { 0: "a", foo: "b", "content-type": "c" }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const h = \{0: "a", foo: "b", "content-type": "c"\}/);
  });
});
