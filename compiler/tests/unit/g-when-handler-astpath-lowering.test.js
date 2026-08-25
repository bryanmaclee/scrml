/**
 * g-when-handler-multistatement-body-loses-ast-path-lowerings (S374)
 *
 * A `when @var changes` (when-effect) / `when message|error from <#w>` (when-worker)
 * handler whose body contains a value-native MAP/SET method (`@m.insert`, `@s.add`)
 * used to mis-lower: #693/#695 moved the handler body onto `rewriteBlockBody`, whose
 * per-statement RHS was emitted via the STRING fallback (`rewriteExprWithDerived`),
 * which does NOT do `emitMember` interception — so `@m.insert(k,v)` emitted a bare
 * `_scrml_reactive_get("m").insert(k,v)` (a runtime TypeError: the map object has no
 * `.insert` method) instead of `_scrml_map_insert(...)`.
 *
 * Fix (S374): `rewriteBlockBody` gained an opt-in `astExprCtx` param; the three
 * when-emit sites pass `_makeExprCtx(opts)`, so each statement expression is parsed
 * to an ExprNode and lowered via the AST path (`emitExpr` → `emitMember`), which
 * intercepts map/set/request/dbVar/synth forms.
 *
 * These tests are BITING: pre-fix, the emitted body contains a bare `.insert(` /
 * `.add(` and NO `_scrml_map_insert`.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { unwrapChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-g-when-handler-astpath");
function compileToClient(src) {
  const tmpDir = resolve(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(resolve(tmpDir, "app.scrml"), src);
  try {
    const result = compileScrml({ inputFiles: [resolve(tmpDir, "app.scrml")], write: true, outputDir: outDir });
    return { clientJs: unwrapChunkScope(readFileSync(resolve(outDir, "app.client.js"), "utf-8")), errors: result.errors ?? [] };
  } finally { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); }
}
const noErr = (errors) => expect(errors.filter((e) => e.severity === "error" || e.code?.startsWith("E-"))).toHaveLength(0);
const WORKER = `<program name="w">\${ when message(d) { send(d) } }</program>`;

describe("g-when-handler-multistatement-body-loses-ast-path-lowerings (S374)", () => {
  test("§1 when-effect: a map `.insert` lowers to `_scrml_map_insert` (not a bare `.insert(`)", () => {
    const src =
      `<div>\n  \${\n    <fareByLane>: [string: int] = ["DAL-001": 4500]\n    <count> = 0\n` +
      `    when @count changes {\n      @fareByLane = @fareByLane.insert("HOU-002", 3800)\n      @count = @count\n    }\n  }\n` +
      `  <p>\${@fareByLane["DAL-001"]}</p>\n</div>\n`;
    const { clientJs, errors } = compileToClient(src);
    noErr(errors);
    expect(clientJs).toContain("_scrml_map_insert");
    expect(clientJs).not.toMatch(/\.insert\(/); // BITING: pre-fix a bare `.insert(` was emitted
  });

  test("§2 when-worker-message: a map `.insert` across TWO statements lowers both", () => {
    const src =
      `<program>\n  ${WORKER}\n  \${\n    <fareByLane>: [string: int] = ["DAL-001": 4500]\n` +
      `    when message from <#w> (m) {\n      @fareByLane = @fareByLane.insert("HOU-002", m)\n      @fareByLane = @fareByLane.insert("SAN-003", m)\n    }\n  }\n` +
      `  <p>\${@fareByLane["DAL-001"]}</p>\n</program>\n`;
    const { clientJs, errors } = compileToClient(src);
    noErr(errors);
    expect((clientJs.match(/_scrml_map_insert/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(clientJs).not.toMatch(/\.insert\(/);
  });

  test("§3 when-effect: a SET `.add` lowers to `_scrml_map_insert` (membership marker)", () => {
    const src =
      `<div>\n  \${\n    <tags>: set[string] = [:]\n    <count> = 0\n` +
      `    when @count changes {\n      @tags = @tags.add("urgent")\n      @count = @count\n    }\n  }\n` +
      `  <p>\${@count}</p>\n</div>\n`;
    const { clientJs, errors } = compileToClient(src);
    noErr(errors);
    expect(clientJs).toContain("_scrml_map_insert");
    expect(clientJs).not.toMatch(/\.add\(/);
  });

  test("§4 regression: a plain multi-statement when-effect still emits every reactive set", () => {
    const src =
      `<div>\n  \${\n    <a> = 0\n    <b> = 0\n    <count> = 0\n` +
      `    when @count changes {\n      @a = @count\n      @b = @count * 2\n    }\n  }\n` +
      `  <p>\${@a}-\${@b}</p>\n</div>\n`;
    const { clientJs, errors } = compileToClient(src);
    noErr(errors);
    expect(clientJs).toContain(`_scrml_reactive_set("a"`);
    expect(clientJs).toContain(`_scrml_reactive_set("b"`);
  });
});
