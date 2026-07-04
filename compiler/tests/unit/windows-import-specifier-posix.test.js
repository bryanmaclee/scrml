/**
 * GitHub #18 — Windows import specifiers use `\` -> server tier fails to import.
 *
 * On Windows, Node's `path.relative()` returns a `\`-separated path. The
 * compiler embedded that result DIRECTLY into emitted ES-module import
 * specifier strings — e.g. `import { env } from "./_scrml\process.js"`. A `\`
 * in a JS string is an escape sequence: `\p` collapses to `p`, so the specifier
 * became `"./_scrmlprocess.js"` (module not found) and `"..\sheets.js"` became
 * `"..sheets.js"`. Import specifiers are URLs, not filesystem paths, and MUST be
 * `/`-separated on every OS. The runtime shim files were written to the correct
 * on-disk path; only the SPECIFIER STRING was wrong.
 *
 * Fix: `toPosixSpecifier()` in api.js normalizes every relative() result that
 * lands in an emitted import specifier, applied at the three specifier sites
 * (findOutputFiles.relPath, rewriteRelativeImportPaths, rewriteStdlibImports).
 *
 * This bug manifests only on Windows (`path.sep === '\\'`); on a POSIX host
 * `relative()` already returns `/`, so a plain compile cannot reproduce it.
 * These tests are OS-independent: they exercise `toPosixSpecifier` directly with
 * `\`-containing inputs (which never occur on POSIX but are exactly what a
 * Windows `relative()` yields) and assert the emitted-specifier assembly is
 * `/`-only regardless of host OS.
 */

import { describe, test, expect } from "bun:test";
import {
  toPosixSpecifier,
  rewriteRelativeImportPaths,
  rewriteStdlibImports,
} from "../../src/api.js";

// ---------------------------------------------------------------------------
// toPosixSpecifier — the core normalization (OS-independent by construction)
// ---------------------------------------------------------------------------

describe("toPosixSpecifier (GitHub #18)", () => {
  test("rewrites a Windows relative() result to forward slashes", () => {
    expect(toPosixSpecifier("a\\b\\c.js")).toBe("a/b/c.js");
  });

  test("fixes the exact #18 stdlib-shim specifier shape", () => {
    // Windows relative() -> `_scrml\process.js`; embedded raw it collapses to
    // `_scrmlprocess.js`. Normalized it stays a valid `/`-separated specifier.
    expect(toPosixSpecifier("./_scrml\\process.js")).toBe("./_scrml/process.js");
  });

  test("fixes the exact #18 parent-relative specifier shape", () => {
    expect(toPosixSpecifier("..\\sheets.js")).toBe("../sheets.js");
    expect(toPosixSpecifier("..\\..\\ui\\repros\\helper.js")).toBe(
      "../../ui/repros/helper.js",
    );
  });

  test("is a no-op on an already-posix specifier (POSIX host path)", () => {
    expect(toPosixSpecifier("./_scrml/process.js")).toBe("./_scrml/process.js");
    expect(toPosixSpecifier("../../ui/repros/helper.js")).toBe(
      "../../ui/repros/helper.js",
    );
    expect(toPosixSpecifier("helper.js")).toBe("helper.js");
  });

  test("normalizes a mixed-separator path fully to forward slashes", () => {
    expect(toPosixSpecifier("pages\\customer/loads.server.js")).toBe(
      "pages/customer/loads.server.js",
    );
  });

  test("leaves the result free of any backslash", () => {
    const out = toPosixSpecifier("deep\\nested\\path\\mod.js");
    expect(out.includes("\\")).toBe(false);
  });

  test("passes non-string values through untouched", () => {
    expect(toPosixSpecifier(null)).toBeNull();
    expect(toPosixSpecifier(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Site regression: the rewrite functions never emit a backslash specifier.
//
// On a POSIX host relative() already yields `/`, so these are happy-path
// regression fences confirming the normalize wrap did not disturb the existing
// contract. The Windows-specific defect itself is covered by the direct
// toPosixSpecifier tests above (the only OS-independent way to reach it).
// ---------------------------------------------------------------------------

describe("emitted specifiers stay backslash-free (GitHub #18)", () => {
  test("rewriteRelativeImportPaths emits a `/`-only specifier", () => {
    const js = `import { helper } from "./helper.js";`;
    const result = rewriteRelativeImportPaths(
      js,
      "/project/src/sub/app.scrml",
      "/project/dist",
    );
    // Extract the specifier and assert no backslash.
    const spec = result.match(/from\s+"([^"]+)"/)[1];
    expect(spec.includes("\\")).toBe(false);
    expect(spec).toBe("../src/sub/helper.js");
  });

  test("rewriteStdlibImports emits a `/`-only specifier", () => {
    const js = `import { env } from "scrml:process";`;
    const bundled = new Set(["process"]);
    const result = rewriteStdlibImports(
      js,
      "/project/dist/pages/customer",
      "/project/dist",
      bundled,
    );
    const spec = result.match(/from\s+"([^"]+)"/)[1];
    expect(spec.includes("\\")).toBe(false);
    // dist/pages/customer -> dist/_scrml/process.js
    expect(spec).toBe("../../_scrml/process.js");
  });
});
