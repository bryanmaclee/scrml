/**
 * path-canonical.test.js — the internal path-key canonicalization boundary.
 *
 * Cross-OS path-model refactor. `toPosix` + `PathKeyedMap`/`PathKeyedSet` are the
 * ONE boundary that keeps the module graph, export registries, and cross-file
 * type/component lookups keyed consistently on Windows (native `\`) and POSIX
 * (`/`). A desync here reintroduces the ~26 Windows-only cross-file failures this
 * arc cleared (and, at the #26 stdlib carve-out, a security surface).
 *
 * Windows-guard-without-a-Windows-runner: native-separator inputs are built with
 * `sep`, so on the Linux gate they exercise the POSIX path and on the S255
 * `windows-latest` CI job they exercise the real `\` path. The POSIX-only
 * backslash-preservation assertions (the sep-awareness guard) are `sep`-gated.
 */

import { describe, test, expect } from "bun:test";
import { sep } from "node:path";
import { toPosix, PathKeyedMap, PathKeyedSet } from "../../src/path-canonical.js";

// A path with the HOST separator — `\`-bearing on Windows, `/`-form on POSIX.
const nativeDir = (...segs) => segs.join(sep);

describe("toPosix — sep-aware separator folding", () => {
  test("folds the host separator to `/`", () => {
    expect(toPosix(nativeDir("app", "models", "auth.scrml"))).toBe("app/models/auth.scrml");
    expect(toPosix("already/posix/path.scrml")).toBe("already/posix/path.scrml");
  });

  test("non-string passes through untouched", () => {
    expect(toPosix(null)).toBe(null);
    expect(toPosix(undefined)).toBe(undefined);
  });

  test("output never contains the host separator", () => {
    expect(toPosix(nativeDir("a", "b", "c"))).not.toContain("\\");
  });

  if (sep === "/") {
    test("POSIX no-op guard — a literal backslash in a Unix filename is PRESERVED", () => {
      // On POSIX `\` is a legal filename char; folding it would corrupt the path
      // AND widen the #26 stdlib carve-out (a `stdlib\evil.scrml` must NOT match).
      expect(toPosix("dir/we\\ird.scrml")).toBe("dir/we\\ird.scrml");
      expect(toPosix("a\\b")).toBe("a\\b");
    });
  }
});

describe("PathKeyedMap — keys canonicalize at the boundary", () => {
  test("native-form set matches posix-form get (and vice versa)", () => {
    const m = new PathKeyedMap();
    m.set(nativeDir("app", "x.scrml"), 1);
    expect(m.get("app/x.scrml")).toBe(1); // posix lookup hits native-keyed set
    expect(m.has(nativeDir("app", "x.scrml"))).toBe(true);

    m.set("app/y.scrml", 2); // posix set
    expect(m.get(nativeDir("app", "y.scrml"))).toBe(2); // native lookup hits posix set
  });

  test("iteration yields posix keys (consistent for downstream derived maps)", () => {
    const m = new PathKeyedMap();
    m.set(nativeDir("a", "b.scrml"), 1);
    expect([...m.keys()]).toEqual(["a/b.scrml"]);
  });

  test("delete canonicalizes", () => {
    const m = new PathKeyedMap();
    m.set("a/b.scrml", 1);
    expect(m.delete(nativeDir("a", "b.scrml"))).toBe(true);
    expect(m.has("a/b.scrml")).toBe(false);
  });

  test("extends Map — instanceof + size preserved", () => {
    const m = new PathKeyedMap();
    m.set(nativeDir("a", "b"), 1);
    expect(m instanceof Map).toBe(true);
    expect(m.size).toBe(1);
  });
});

describe("PathKeyedSet — membership canonicalizes", () => {
  test("native-form add matches posix-form has (and vice versa)", () => {
    const s = new PathKeyedSet();
    s.add(nativeDir("app", "x.scrml"));
    expect(s.has("app/x.scrml")).toBe(true);
    s.add("app/y.scrml");
    expect(s.has(nativeDir("app", "y.scrml"))).toBe(true);
  });
});
