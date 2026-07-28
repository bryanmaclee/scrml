/**
 * d4-dist-relative-server-specifier.test.js — D-4 (S296), unit lock on
 * `emit-server.ts` `distRelativeServerSpecifier`.
 *
 * THE BUG. A `.scrml` file under `pages/` that server-imports another local
 * `.scrml` module emitted its import specifier in SOURCE coordinate space (a
 * bare `stmt.source.replace(/\.scrml$/, ".server.js")`). The dist tree is NOT a
 * mirror of the source tree — SPEC §47.9.5 strips a leading `pages/` segment
 * from `dirname(relative(outputBaseDir, source))`, so `pages/login.scrml` lands
 * at `dist/login.server.js`. The emitted specifier therefore overshot by exactly
 * that one segment, at EVERY depth (the strip removes exactly one), and the
 * `.server.js` died at runtime with `Cannot find module` — on a compile that
 * exited 0 with zero errors.
 *
 * The fix expresses BOTH endpoints in the post-strip dist space and takes the
 * relative path between them — the same computation `emit-client-esm.ts` already
 * performs for the client half (which is why the client half always resolved),
 * over the same `pathFor`-mirroring `stripPagesPrefix` transform
 * `computeServedPath` uses.
 *
 * These are the pure-function locks. The end-to-end compile locks (real dist
 * artifacts, on-disk resolution, the `W-SERVER-IMPORT-UNEMITTED` guard) live in
 * `compiler/tests/integration/d4-server-import-dist-space.test.js`.
 *
 * SPEC anchors: §47.9.5 (leading `pages/` segment strip), §47.9.2
 * (filesystem-inferred routes), §40 (imports).
 */

import { describe, test, expect } from "bun:test";
import { sep, join as pathJoin } from "node:path";
import { distRelativeServerSpecifier } from "../../src/codegen/emit-server.ts";

// Absolute paths, built with the HOST separator so the assertions exercise the
// real `path.relative` behaviour on whichever OS the gate runs on.
const BASE = pathJoin(sep, "proj");
const at = (...segs) => pathJoin(BASE, ...segs);

describe("D-4 §1 — a `pages/` importer emits a DIST-space specifier", () => {
  test("depth-1: pages/login.scrml -> ./models/auth.server.js (was ../models/…)", () => {
    // dist: login.server.js at the root, models/auth.server.js one dir down.
    expect(
      distRelativeServerSpecifier("../models/auth.scrml", at("pages", "login.scrml"), BASE),
    ).toBe("./models/auth.server.js");
  });

  test("depth-2: pages/auth/login.scrml -> ../models/auth.server.js (was ../../models/…)", () => {
    // dist: auth/login.server.js, so exactly ONE `../` reaches models/.
    expect(
      distRelativeServerSpecifier("../../models/auth.scrml", at("pages", "auth", "login.scrml"), BASE),
    ).toBe("../models/auth.server.js");
  });

  test("depth-3: the overshoot is a CONSTANT one segment, not depth-proportional", () => {
    expect(
      distRelativeServerSpecifier(
        "../../../models/auth.scrml",
        at("pages", "a", "b", "login.scrml"),
        BASE,
      ),
    ).toBe("../../models/auth.server.js");
  });

  test("a `pages/`-internal sibling import is unaffected (both sides strip)", () => {
    // pages/a/x.scrml -> pages/a/y.scrml : dist a/x.server.js -> a/y.server.js.
    expect(
      distRelativeServerSpecifier("./y.scrml", at("pages", "a", "x.scrml"), BASE),
    ).toBe("./y.server.js");
  });

  test("a `pages/` importer of a `pages/` module in another subdir", () => {
    // pages/a/x.scrml -> pages/b/y.scrml : dist a/x.server.js -> b/y.server.js.
    expect(
      distRelativeServerSpecifier("../b/y.scrml", at("pages", "a", "x.scrml"), BASE),
    ).toBe("../b/y.server.js");
  });
});

describe("D-4 §2 — the CONTROL and the no-`pages/` case are byte-identical to pre-fix", () => {
  // Every expectation here is EXACTLY `source.replace(/\.scrml$/, ".server.js")`
  // — i.e. the pre-fix output — which is what makes the fix a no-op for any
  // project without a `pages/` segment.
  test("root importer: app.scrml -> ./models/auth.server.js (the reproducer's control)", () => {
    expect(
      distRelativeServerSpecifier("./models/auth.scrml", at("app.scrml"), BASE),
    ).toBe("./models/auth.server.js");
  });

  test("flat siblings at the base", () => {
    expect(distRelativeServerSpecifier("./b.scrml", at("a.scrml"), BASE)).toBe("./b.server.js");
  });

  test("a non-`pages/` subdir importing downward", () => {
    expect(
      distRelativeServerSpecifier("./util.scrml", at("src", "a.scrml"), BASE),
    ).toBe("./util.server.js");
  });

  test("a non-`pages/` subdir importing upward", () => {
    expect(
      distRelativeServerSpecifier("../shared/x.scrml", at("src", "a.scrml"), BASE),
    ).toBe("../shared/x.server.js");
  });

  test("a deep non-`pages/` tree", () => {
    expect(
      distRelativeServerSpecifier("../../lib/x.scrml", at("a", "b", "c.scrml"), BASE),
    ).toBe("../../lib/x.server.js");
  });
});

describe("D-4 §3 — the strip stays segment-aligned (it must not over-strip)", () => {
  test("a NON-LEADING `pages` segment is NOT stripped", () => {
    // sub/pages/x.scrml keeps its dir (preserves outputBase semantics for a
    // non-`./` outputBase — the `stripPagesPrefix` contract).
    expect(
      distRelativeServerSpecifier("../../models/auth.scrml", at("sub", "pages", "x.scrml"), BASE),
    ).toBe("../../models/auth.server.js");
  });

  test("`pages/pages/` strips exactly ONE leading segment", () => {
    // dist: pages/x.server.js  ->  models/auth.server.js is one `../` away.
    expect(
      distRelativeServerSpecifier("../../models/auth.scrml", at("pages", "pages", "x.scrml"), BASE),
    ).toBe("../models/auth.server.js");
  });

  test("a root file literally named `pages.scrml` is not a `pages/` prefix", () => {
    expect(
      distRelativeServerSpecifier("./models/auth.scrml", at("pages.scrml"), BASE),
    ).toBe("./models/auth.server.js");
  });

  test("a dir named `pagesfoo` is not a `pages/` prefix", () => {
    expect(
      distRelativeServerSpecifier("../models/auth.scrml", at("pagesfoo", "x.scrml"), BASE),
    ).toBe("../models/auth.server.js");
  });

  test("the TARGET side strips too — a `pages/` module imported from the root", () => {
    // pages/mod.scrml emits dist/mod.server.js, so the root importer reaches it
    // with `./mod.server.js`, NOT the source-space `./pages/mod.server.js`.
    expect(
      distRelativeServerSpecifier("./pages/mod.scrml", at("app.scrml"), BASE),
    ).toBe("./mod.server.js");
  });
});

describe("D-4 §4 — fallbacks preserve pre-fix behaviour exactly", () => {
  test("no outputBaseDir (legacy single-file callers) -> verbatim source-space swap", () => {
    for (const base of [null, undefined, ""]) {
      expect(
        distRelativeServerSpecifier("../models/auth.scrml", at("pages", "login.scrml"), base),
      ).toBe("../models/auth.server.js");
    }
  });

  test("no importer path -> verbatim source-space swap", () => {
    expect(distRelativeServerSpecifier("../models/auth.scrml", "", BASE)).toBe(
      "../models/auth.server.js",
    );
  });

  test("a TARGET outside the output base -> verbatim (no dist coordinate exists)", () => {
    // Nothing is written to dist for a file outside the base, so there is no
    // dist coordinate to express; pre-fix behaviour is preserved untouched.
    expect(
      distRelativeServerSpecifier("../../outside/x.scrml", at("app.scrml"), BASE),
    ).toBe("../../outside/x.server.js");
  });

  test("an IMPORTER outside the output base -> verbatim", () => {
    expect(
      distRelativeServerSpecifier("./x.scrml", pathJoin(sep, "elsewhere", "a.scrml"), BASE),
    ).toBe("./x.server.js");
  });
});

describe("D-4 §5 — the result is always a well-formed relative ES specifier", () => {
  test("never a BARE specifier (a bare `models/x.server.js` would hit node_modules)", () => {
    const cases = [
      ["../models/auth.scrml", at("pages", "login.scrml")],
      ["./y.scrml", at("pages", "a", "x.scrml")],
      ["./models/auth.scrml", at("app.scrml")],
      ["./pages/mod.scrml", at("app.scrml")],
    ];
    for (const [spec, importer] of cases) {
      const out = distRelativeServerSpecifier(spec, importer, BASE);
      expect(out.startsWith("./") || out.startsWith("../")).toBe(true);
    }
  });

  test("always POSIX-separated — no host separator leaks into the specifier", () => {
    const out = distRelativeServerSpecifier(
      "../../models/auth.scrml",
      at("pages", "auth", "login.scrml"),
      BASE,
    );
    expect(out).toBe("../models/auth.server.js");
    // On Windows `path.relative` returns `\`; the emitter must normalize it or
    // the ES specifier is invalid in every runtime.
    expect(out.includes("\\")).toBe(false);
  });

  test("always ends in `.server.js` — the extension swap still happens", () => {
    expect(
      distRelativeServerSpecifier("../models/auth.scrml", at("pages", "login.scrml"), BASE),
    ).toMatch(/\.server\.js$/);
  });
});
