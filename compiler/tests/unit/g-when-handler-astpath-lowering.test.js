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
    const cp = resolve(outDir, "app.client.js");
    // A compile that errors out (e.g. the §5 malformed juxtaposition → loud
    // E-CODEGEN-INVALID-LOGIC) writes no client.js; return "" so the caller sees
    // the error rather than a thrown ENOENT.
    const clientJs = existsSync(cp) ? unwrapChunkScope(readFileSync(cp, "utf-8")) : "";
    return { clientJs, errors: result.errors ?? [] };
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

  test("§5 the AST path never SILENTLY drops trailing tokens (full-consumption guard)", () => {
    // S374 review #2: `foo(1) bar(2)` on one line parses to just `foo(1)`; without
    // the guard the AST path emitted only that and dropped `bar(2)` with zero
    // diagnostics — a silent statement drop, the exact class this arc closes. The
    // guard falls back to the string path, so the malformed juxtaposition is either
    // fully emitted or a LOUD error — never a silent truncation to its first expr.
    const src =
      `<div>\n  \${\n    <count> = 0\n    fn foo(x: int) { return x }\n    fn bar(x: int) { return x }\n` +
      `    when @count changes {\n      foo(1) bar(2)\n    }\n  }\n` +
      `  <p>\${@count}</p>\n</div>\n`;
    const { clientJs, errors } = compileToClient(src);
    const hadError = errors.some((e) => e.severity === "error" || e.code?.startsWith("E-"));
    const droppedBar = /foo_?\d*\(1\)/.test(clientJs) && !/bar_?\d*\(2\)/.test(clientJs);
    // BITING: pre-guard, this compiled clean AND emitted only foo(1) (bar silently gone).
    expect(hadError || !droppedBar).toBe(true);
  });

  test("§6 a promise-returning call in a when-effect strands NO `await` in the sync wrapper", () => {
    // S374 review #1: the body is wrapped in a non-async `_scrml_effect(function(){})`;
    // `clientAsyncBody:false` in the lowering ctx guarantees no `await` is emitted
    // into it (an `await` in a sync function is a whole-bundle SyntaxError).
    const src =
      `<div>\n  \${\n    <count> = 0\n    <res> = 0\n` +
      `    when @count changes {\n      @res = safeCallAsync(() => fetch("/x"))\n    }\n  }\n` +
      `  <p>\${@res}</p>\n</div>\n`;
    const { clientJs, errors } = compileToClient(src);
    noErr(errors);
    const m = clientJs.match(/_scrml_effect\(function\(\)\s*\{[\s\S]*?\}\);/g) || [];
    const effect = m.find((s) => /res/.test(s)) || "";
    expect(effect).not.toMatch(/\bawait\b/); // BITING: no stranded await in the sync effect wrapper
  });
});
