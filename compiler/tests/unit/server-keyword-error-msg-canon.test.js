/**
 * server-keyword-error-msg-canon — diagnostics no longer TEACH `server function`
 *
 * S180 eliminated the `server function` modifier from the scrml canon: the
 * modifier is deprecated and the server boundary is INFERRED (§12.2 Triggers).
 * The compiler's OWN user-facing strings must not suggest the now-eliminated
 * form (a "compiler suggests a now-eliminated keyword" inconsistency).
 *
 * change-id: g-server-keyword-error-msg-2026-06-11
 *
 * Scope guard: these tests assert on the user-facing DIAGNOSTIC MESSAGE text,
 * NOT on emitted JS or parser behavior — the parser still ACCEPTS `server
 * function` during the deprecation window (W-DEPRECATED-SERVER-MODIFIER). We
 * are policing what the compiler SUGGESTS, not what it accepts.
 *
 * Cross-stream note: W-* codes land in result.warnings, E-* in result.errors
 * (the diagnostic-stream partition). We collect from BOTH streams so a W-*
 * assertion is not a silent false-negative (S92 precedent).
 */

import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { lintGhostPatterns } from "../../src/lint-ghost-patterns.js";

let TMP;
function ensureTmp() {
  if (!TMP) TMP = mkdtempSync(join(tmpdir(), "skw-errmsg-"));
  return TMP;
}
function fx(relPath, source) {
  const abs = join(ensureTmp(), relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}
function compile(rel, source) {
  const src = fx(rel, source);
  return compileScrml({
    inputFiles: [src],
    outputDir: join(ensureTmp(), dirname(rel), "dist"),
    write: false,
    log: () => {},
  });
}
// Cross-stream collector — W-* in warnings, E-* in errors.
function diagsByCode(result, code) {
  return [...(result.errors || []), ...(result.warnings || [])].filter(
    (d) => d.code === code,
  );
}

describe("server-keyword-error-msg: diagnostics do not teach the deprecated `server function` form", () => {
  test("W-AUTH-001 (no-initial-load) suggests a server-side function, not `server function`", () => {
    // `server @var` with a literal init → the TS-stage W-AUTH-001 nudge fires.
    const result = compile("wauth001/app.scrml", "<program>\n${ server @count = 0 }\n</>");
    const hits = diagsByCode(result, "W-AUTH-001").filter((d) =>
      typeof d.message === "string" && d.message.includes("no detected initial load"),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const msg = hits[0].message;
    // Still teaches the remedy (assign from the server side)…
    expect(msg).toContain("on mount");
    expect(msg).toContain("server-side function");
    // …but never the eliminated modifier form.
    expect(msg).not.toContain("server function");
  });

  test("E-FN-004 (non-det in pure `fn`) points at a `function`, not a `server function`", () => {
    const result = compile("efn004/app.scrml", [
      "${",
      "    import { random } from 'scrml:random'",
      "    fn noisy(x) {",
      "        return x + random()",
      "    }",
      "    server function _use() { return noisy(0) }",
      "}",
      'h1 "non-det in fn — should reject"',
    ].join("\n"));
    const hits = diagsByCode(result, "E-FN-004");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const msg = hits[0].message;
    expect(msg).toContain("random()");
    // The suggestion now names a plain `function` (boundary inferred); the
    // eliminated `server function` form must not appear.
    expect(msg).toContain("`function`");
    expect(msg).not.toContain("server function");
  });

  test("W-LINT-019 (Solid ghost-pattern) resource correction does not depict `server function`", () => {
    // createResource() trips the Solid ghost-pattern lint (W-LINT-019). The
    // correction string previously depicted `${ server function fetch() }`.
    // lintGhostPatterns() is the lint-pass entry point; it returns diagnostics
    // directly (the ghost-pattern lint is a separate channel from the compile
    // diagnostic stream), so we exercise it directly here.
    const diags = lintGhostPatterns(
      "${\n    const r = createResource(fetchUser)\n}\nh1 \"solid ghost\"",
      "/test/solid-ghost.scrml",
    );
    const hits = diags.filter((d) => d.code === "W-LINT-019");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const msg = (hits[0].correction || "") + " " + (hits[0].message || "");
    expect(msg).toContain("RemoteData");
    // The corrected canonical resource shape is a plain `function`…
    expect(msg).toContain("${ function fetch() { ... } }");
    // …never the eliminated `server function` modifier form.
    expect(msg).not.toContain("server function");
  });
});
