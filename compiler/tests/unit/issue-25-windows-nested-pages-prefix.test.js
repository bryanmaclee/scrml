/**
 * issue-25-windows-nested-pages-prefix.test.js — MPA nested-route 404
 * (Windows path-separator variant).
 *
 * Issue #25 (Peter, Windows 11): the clean-URL `pages/` strip runs on a
 * `dirname(relative(outputBaseDir, source))` result, which uses the HOST
 * separator — `\` on Windows. The strip branches (`=== "pages"` /
 * `startsWith("pages/")`) and every caller's later `.split("/")` are all
 * `/`-oriented, so on Windows:
 *
 *     relDir = "pages\auth"                       (path.dirname → native `\`)
 *     relDir === "pages"                → false   (has a separator)
 *     relDir.startsWith("pages/")       → false   (`\` ≠ `/`)
 *
 * → neither branch fires → the `pages` prefix survives → the dist file lands at
 * `dist/pages/auth/login.html` and the served route registers as
 * `/pages\auth/login` → every NESTED page 404s at its intended clean URL.
 * Top-level `pages\foo` has no separator, so `=== "pages"` fires and it strips
 * correctly — hence the bug is nested-ONLY, and invisible on POSIX (all `/`).
 *
 * The fix (`stripPagesPrefix`, codegen/utils.ts — shared by BOTH the dist-write
 * site `api.js pathFor` and the served-route site `emit-server computeServedPath`)
 * normalizes the HOST separator to `/` BEFORE the strip, via `.split(sep).join("/")`
 * — the platform `sep`, NOT a hardcoded `\`, so it stays a TRUE no-op on POSIX
 * (where a literal backslash is a legal filename char that must be preserved).
 *
 * CROSS-OS testing without branching the suite: native-separator inputs are built
 * with `sep`, so on the Linux gate they validate the POSIX path and on the S255
 * Windows CI job (`windows-latest`) they validate the real backslash path. The
 * POSIX-literal assertions hold on every OS; the backslash-preservation assertion
 * (the guard for the `.split(sep)` no-op) is POSIX-gated.
 *
 * SPEC anchors: §47.9.2 filesystem-inferred routes, §40.8.1 `pages/` convention.
 */

import { describe, test, expect } from "bun:test";
import { sep } from "node:path";
import { stripPagesPrefix } from "../../src/codegen/utils.ts";

// Build a relative dir with the HOST separator — exactly what
// `path.dirname(path.relative(...))` yields on THIS OS. On Windows this is the
// `\`-bearing string the bug tripped on; on POSIX it is the `/`-form.
const nativeDir = (...segs) => segs.join(sep);

describe("issue #25 — clean-URL pages-strip is separator-canonical", () => {
  test("native-separator nested path strips the leading `pages` segment", () => {
    // The exact repro: pages/auth/login.scrml, pages/customer/home.scrml.
    // On the Windows CI job these inputs are `pages\auth` / `pages\customer\home`.
    expect(stripPagesPrefix(nativeDir("pages", "auth"))).toBe("auth");
    expect(stripPagesPrefix(nativeDir("pages", "customer"))).toBe("customer");
    expect(stripPagesPrefix(nativeDir("pages", "customer", "home"))).toBe("customer/home");
  });

  test("POSIX path (`/`) always strips — cross-OS, no regression", () => {
    expect(stripPagesPrefix("pages/auth")).toBe("auth");
    expect(stripPagesPrefix("pages/customer/home")).toBe("customer/home");
  });

  test("top-level `pages` (no separator) collapses to root on both OSes", () => {
    expect(stripPagesPrefix("pages")).toBe(".");
  });

  test("output-root (`.`) is unchanged", () => {
    expect(stripPagesPrefix(".")).toBe(".");
  });

  test("strip is segment-aligned — a non-leading `pages` is NOT stripped", () => {
    // Preserves outputBase semantics for a non-`./` outputBase: only an exact
    // LEADING `pages` segment is removed.
    expect(stripPagesPrefix(nativeDir("sub", "pages", "x"))).toBe("sub/pages/x");
    expect(stripPagesPrefix("sub/pages/x")).toBe("sub/pages/x");
    // A directory literally named `pagesfoo` is not a `pages/` prefix.
    expect(stripPagesPrefix(nativeDir("pagesfoo", "x"))).toBe("pagesfoo/x");
  });

  test("output is always `/`-separated — no host separator survives", () => {
    // No `\` (nor any native sep) may leak into a route/URL key or a downstream
    // `.split('/')`. On Windows the `\`s normalize; on POSIX there were none.
    const out = stripPagesPrefix(nativeDir("pages", "a", "b", "c"));
    expect(out).toBe("a/b/c");
    expect(out.includes(sep) && sep !== "/").toBe(false);
  });

  if (sep === "/") {
    test("POSIX no-op guard — a literal backslash in a Unix dir name is PRESERVED", () => {
      // Backslash is a legal filename char on ext4/APFS. `.split(sep)` (sep === "/")
      // must NOT touch it — a hardcoded backslash→'/' rewrite would silently rename
      // the dir and relocate output/routes (the divergence the #25 review flagged).
      // This proves the normalization is a TRUE no-op on POSIX.
      expect(stripPagesPrefix("pages/we\\ird")).toBe("we\\ird");
      expect(stripPagesPrefix("we\\ird")).toBe("we\\ird");
    });
  }
});
