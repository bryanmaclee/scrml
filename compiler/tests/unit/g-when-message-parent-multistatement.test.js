/**
 * g-when-message-parent-handler-drops-all-but-the-first-statement (S372)
 *
 * A parent-side `when message from <#w>` (and `when error from <#w>`) handler
 * whose body has MORE THAN ONE statement used to emit ONLY the first statement:
 * the body was captured as space-joined tokens (losing statement boundaries) and
 * emitted through the single-expression `emitExprField(bodyExpr, …)` path, so
 * `safeParseExprToNode` recovered one expression and the rest were silently
 * dropped (exit 0, no diagnostic). Fix: preserve source statement boundaries in
 * `bodyRaw` (ast-builder) + emit the body through `rewriteBlockBody`'s
 * multi-statement lowering (emit-logic), mirroring the inline event-handler path.
 *
 * These tests are BITING: pre-fix, the second `_scrml_*reactive_set(...)` is
 * absent from the emitted handler.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { unwrapChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-g-when-message-parent-multistatement");

function compileToClient(src) {
  const tmpDir = resolve(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientJs = readFileSync(resolve(outDir, "app.client.js"), "utf-8");
    return { clientJs: unwrapChunkScope(clientJs), errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Grab the `<worker>.onmessage = function(event){ … }` handler body text.
function onmessageBody(clientJs) {
  const m = clientJs.match(/onmessage\s*=\s*function\s*\(event\)\s*\{([\s\S]*?)\};/);
  return m ? m[1] : "";
}
function onerrorBody(clientJs) {
  const m = clientJs.match(/onerror\s*=\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\};/);
  return m ? m[1] : "";
}

const WORKER = `<program name="w">\${ when message(d) { send(d) } }</program>`;

describe("g-when-message-parent-handler-drops-all-but-the-first-statement (§4.12.4)", () => {
  test("§1 a 2-statement `when message from` body emits BOTH statements", () => {
    const src =
      `<program>\n  ${WORKER}\n` +
      `  \${\n    <a> = 0\n    <b> = 0\n` +
      `    when message from <#w> (m) {\n      @a = m\n      @b = m\n    }\n  }\n` +
      `  <p>\${@a}-\${@b}</p>\n</program>\n`;
    const { clientJs, errors } = compileToClient(src);
    expect(errors.filter((e) => e.severity === "error" || e.code?.startsWith("E-"))).toHaveLength(0);
    const body = onmessageBody(clientJs);
    // BITING: pre-fix only the first set is present.
    expect(body).toContain(`_scrml_reactive_set("a", m)`);
    expect(body).toContain(`_scrml_reactive_set("b", m)`);
  });

  test("§2 a trailing `//` comment is filtered, not lowered into invalid JS", () => {
    const src =
      `<program>\n  ${WORKER}\n` +
      `  \${\n    <running> = true\n` +
      `    when error from <#w> (e) {\n      @running = false\n      // surface this to the user\n    }\n  }\n` +
      `  <p>\${@running}</p>\n</program>\n`;
    const { clientJs, errors } = compileToClient(src);
    // Pre-comment-filter this compiled to E-CODEGEN-INVALID-LOGIC.
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    const body = onerrorBody(clientJs);
    expect(body).toContain(`_scrml_reactive_set("running", false)`);
    expect(body).not.toContain("surface this to the user");
  });

  test("§3 regression: a single-statement `when message from` body still emits", () => {
    const src =
      `<program>\n  ${WORKER}\n` +
      `  \${\n    <a> = 0\n    when message from <#w> (m) {\n      @a = m\n    }\n  }\n` +
      `  <p>\${@a}</p>\n</program>\n`;
    const { clientJs } = compileToClient(src);
    expect(onmessageBody(clientJs)).toContain(`_scrml_reactive_set("a", m)`);
  });

  test("§4 a MULTI-LINE object literal keeps all its fields (not `{}`)", () => {
    // Regression guard (S239 finding 1): a line-granular reconstruction dropped
    // the object's continuation lines, emitting `@cfg = {}`. The nest-aware join
    // keeps a multi-line literal on one logical line.
    const src =
      `<program>\n  ${WORKER}\n` +
      `  \${\n    <cfg> = {}\n` +
      `    when message from <#w> (m) {\n      @cfg = {\n        x: m,\n        y: m\n      }\n    }\n  }\n` +
      `  <p>\${@cfg.x}</p>\n</program>\n`;
    const { clientJs, errors } = compileToClient(src);
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    const body = onmessageBody(clientJs);
    expect(body).toContain("x :");
    expect(body).toContain("y :");
    expect(body).not.toMatch(/reactive_set\("cfg",\s*\{\s*\}\s*\)/); // not the empty-object regression
  });

  test("§5 an INLINE trailing `//` comment is dropped, not lowered into invalid JS", () => {
    // Regression guard (S239 finding 4): a trailing comment on the same line as a
    // statement must not leak into the emitted expression.
    const src =
      `<program>\n  ${WORKER}\n` +
      `  \${\n    <running> = true\n` +
      `    when message from <#w> (m) {\n      @running = false // stop the spinner\n    }\n  }\n` +
      `  <p>\${@running}</p>\n</program>\n`;
    const { clientJs, errors } = compileToClient(src);
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    const body = onmessageBody(clientJs);
    expect(body).toContain(`_scrml_reactive_set("running", false)`);
    expect(body).not.toContain("stop the spinner");
  });

  test("§6 a string literal containing a bracket does not corrupt statement splitting", () => {
    // Regression guard (S239 round-2, findings 1+2): bracket accounting must skip
    // STRING tokens — a `(` or `}` INSIDE a string literal must not change nest/brace
    // depth. Pre-fix: `@a = f("(")` suppressed the newline (2nd stmt dropped → E-CODEGEN);
    // `@a = f("}")` terminated the body loop early (parse desync).
    const decls = `    <a> = ""\n    <b> = 0\n    fn lab(s: string) { return s }\n`;
    for (const inner of [`"("`, `"}"`, `")"`, `"{"`]) {
      const src =
        `<program>\n  ${WORKER}\n` +
        `  \${\n${decls}` +
        `    when message from <#w> (m) {\n      @a = lab(${inner})\n      @b = m\n    }\n  }\n` +
        `  <p>\${@a}\${@b}</p>\n</program>\n`;
      const { clientJs, errors } = compileToClient(src);
      expect(
        errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC" || e.code === "E-PARSE-001"),
      ).toHaveLength(0);
      const body = onmessageBody(clientJs);
      // BOTH statements survive.
      expect(body).toContain(`_scrml_reactive_set("b", m)`);
      expect(body).toMatch(/reactive_set\("a"/);
    }
  });
});
