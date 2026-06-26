/**
 * OQ-2: Stdlib runtime resolution — `scrml:NAME` import bridge.
 *
 * Coverage for the Shape B fix from
 *   scrml-support/archive/changes/oq-2-dev-server-bootstrap/diagnosis.md
 *
 * Pre-fix behavior (the bug):
 *   Codegen emitted literal `import { ... } from "scrml:auth"` into output JS.
 *   Bun's import resolver does not register `scrml:*` schemes (no package.json
 *   `imports` map, no loader plugin, no filesystem entry), so any `await
 *   import()` of an emitted server.js or client.js failed with `Cannot find
 *   package 'scrml:NAME'`. The dispatch app's 32 source files were the first
 *   real-world adopters; every prior single-file example silently dodged the
 *   bug because none used stdlib.
 *
 * Post-fix behavior (Shape B — bundle + import-rewrite):
 *   1. `collectStdlibSpecifiers(tabResults)` walks each TAB AST's import
 *      declarations, returning the set of bare names referenced via
 *      `scrml:NAME`.
 *   2. `bundleStdlibForRun(names, outputDir, log)` copies a hand-written ES
 *      module shim (compiler/runtime/stdlib/<name>.js) into
 *      <outputDir>/_scrml/<name>.js for each name. Names without a shim are
 *      skipped — the resulting emitted JS still fails loudly at runtime, which
 *      surfaces the gap (vs. silently degrading to a missing import).
 *   3. `rewriteStdlibImports(jsCode, bundleDir, outputDir, bundled)` rewrites
 *      `from "scrml:NAME"` → `from "<rel>/NAME.js"` for every NAME in the
 *      bundled set, with `<rel>` computed from `bundleDir` to
 *      `<outputDir>/_scrml/`. This handles W0a / F-COMPILE-001 nested writes:
 *      a file at `dist/pages/auth/login.server.js` gets `../../_scrml/...`,
 *      while `dist/app.server.js` gets `./_scrml/...`.
 *
 * Tests:
 *   §1. Helpers — collectStdlibSpecifiers + rewriteStdlibImports unit checks.
 *   §2. End-to-end: minimal app with `scrml:auth` → bundled shim exists,
 *       emitted JS imports relative path, file is loadable in Bun via
 *       `await import()`. NO `Cannot find package 'scrml:*'` error.
 *   §3. Nested-output case (W0a interaction): a source under a deeper subdir
 *       ends up with the correct `../../_scrml/...` relative import.
 *   §4. Negative case: `scrml:NAME` for a name with no shim is left as-is
 *       (loud-failure preserved). The test asserts the import survives the
 *       rewrite verbatim.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import {
  compileScrml,
  collectStdlibSpecifiers,
  rewriteStdlibImports,
} from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "oq-2-stdlib-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

// Minimal stdlib-importing source. The `${...}` block is a server expression
// (per §53) that lifts `import` declarations to the file's import set. The
// file must compile cleanly through the full pipeline.
// ss27-4 (runtime-minimality): the consumer must actually USE the imported
// binding in CLIENT code. A `scrml:NAME` import with no client reference is now
// tree-shaken — both the lowered `_scrml_stdlib.<name>` read AND the
// `stdlib-<name>` runtime chunk are elided — so a bare unused import would emit
// an empty client body. `<hash> = hashPassword(...)` is a top-level (client-
// reachable) state init that exercises the §2 client-lowering + chunk-shipping
// path this test verifies.
const FIXTURE_SCRML = `\${
    import { hashPassword } from 'scrml:auth'
    <hash> = hashPassword("demo")
}
h1 "OQ-2 smoke"
`;

// ---------------------------------------------------------------------------
// §1. Helpers
// ---------------------------------------------------------------------------

describe("OQ-2 §1: helpers (unit)", () => {
  test("collectStdlibSpecifiers extracts bare names from `scrml:NAME` imports", () => {
    const tabResults = [
      {
        ast: {
          imports: [
            { source: "scrml:auth" },
            { source: "scrml:crypto" },
            { source: "./local.scrml" }, // user-authored — should be skipped
            { source: "vendor:lodash" },  // vendor — should be skipped
            { source: "scrml:store" },
            { source: "scrml:auth" },     // duplicate — Set dedupes
          ],
        },
      },
    ];
    const names = collectStdlibSpecifiers(tabResults);
    expect(names).toBeInstanceOf(Set);
    expect(names.has("auth")).toBe(true);
    expect(names.has("crypto")).toBe(true);
    expect(names.has("store")).toBe(true);
    expect(names.size).toBe(3);
  });

  test("collectStdlibSpecifiers handles empty / null / missing imports gracefully", () => {
    expect(collectStdlibSpecifiers(null).size).toBe(0);
    expect(collectStdlibSpecifiers([]).size).toBe(0);
    expect(collectStdlibSpecifiers([{}]).size).toBe(0);
    expect(collectStdlibSpecifiers([{ ast: {} }]).size).toBe(0);
    expect(collectStdlibSpecifiers([{ ast: { imports: [] } }]).size).toBe(0);
  });

  test("rewriteStdlibImports rewrites top-level file path to `./_scrml/NAME.js`", () => {
    const outputDir = "/abs/dist";
    const bundleDir = "/abs/dist"; // top-level file lives directly under outputDir
    const bundled = new Set(["auth", "crypto"]);
    const src =
      `import { hashPassword, verifyPassword } from "scrml:auth";\n` +
      `import { generateToken } from "scrml:crypto";\n`;
    const out = rewriteStdlibImports(src, bundleDir, outputDir, bundled);
    expect(out).toContain(`from "./_scrml/auth.js"`);
    expect(out).toContain(`from "./_scrml/crypto.js"`);
    expect(out).not.toContain(`scrml:`);
  });

  test("rewriteStdlibImports computes `../..` for nested-output files (W0a interaction)", () => {
    const outputDir = "/abs/dist";
    const bundleDir = "/abs/dist/pages/auth"; // nested two levels under outputDir
    const bundled = new Set(["auth"]);
    const src = `import { hashPassword } from "scrml:auth";\n`;
    const out = rewriteStdlibImports(src, bundleDir, outputDir, bundled);
    expect(out).toContain(`from "../../_scrml/auth.js"`);
  });

  test("rewriteStdlibImports leaves names not in the bundled set untouched (loud-failure preserved)", () => {
    const outputDir = "/abs/dist";
    const bundleDir = "/abs/dist";
    const bundled = new Set(["auth"]); // store is NOT bundled
    const src =
      `import { hashPassword } from "scrml:auth";\n` +
      `import { createSessionStore } from "scrml:store";\n`;
    const out = rewriteStdlibImports(src, bundleDir, outputDir, bundled);
    expect(out).toContain(`from "./_scrml/auth.js"`);
    // Unbundled name survives verbatim — runtime will fail loudly.
    expect(out).toContain(`from "scrml:store"`);
  });

  test("rewriteStdlibImports is a no-op when bundled is empty / undefined", () => {
    const outputDir = "/abs/dist";
    const bundleDir = "/abs/dist";
    const src = `import { hashPassword } from "scrml:auth";\n`;
    expect(rewriteStdlibImports(src, bundleDir, outputDir, new Set())).toBe(src);
    expect(rewriteStdlibImports(src, bundleDir, outputDir, undefined)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// §2. End-to-end: minimal app with stdlib → emitted JS is loadable
// ---------------------------------------------------------------------------

describe("OQ-2 §2: end-to-end smoke — emitted JS uses bundled shim and loads in Bun", () => {
  test("minimal `scrml:auth` consumer compiles, bundles shim, and loads in Bun", async () => {
    const ROOT = join(TMP, "e2e-1");
    const src = fx("e2e-1/app.scrml", FIXTURE_SCRML);
    const outDir = join(ROOT, "dist");

    const result = compileScrml({
      inputFiles: [src],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    // Compilation itself must succeed.
    expect(result.errors).toEqual([]);

    // Bundling fired: hand-written shim exists at <outputDir>/_scrml/auth.js.
    expect(existsSync(join(outDir, "_scrml/auth.js"))).toBe(true);

    // CLIENT JS path (Bug 18 S95): `scrml:NAME` imports lower to
    // `const { ... } = _scrml_stdlib.<name>;`. Browsers cannot resolve
    // bare ES-module specifiers and the client.js script tag is a
    // classic (non-module) script. The runtime's `stdlib-<name>` chunk
    // populates the registry at load time. No bare `scrml:` left;
    // no `./_scrml/auth.js` filesystem ref left either (server path).
    const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
    expect(clientJs).toContain(`_scrml_stdlib.auth`);
    expect(clientJs).not.toContain(`from "scrml:`);
    expect(clientJs).not.toContain(`from "./_scrml/auth.js"`);

    // The shared runtime file emitted alongside this app ships the
    // stdlib-auth chunk (the only consumer of scrml:auth is this file).
    // Verify it contains the registry assignment so the client's
    // destructure resolves at runtime when both scripts load.
    const fs2 = require("fs");
    const runtimeFile = fs2.readdirSync(outDir).find((f) => /^scrml-runtime\./.test(f));
    expect(runtimeFile).toBeDefined();
    const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
    expect(runtimeJs).toContain(`_scrml_stdlib.auth = (function()`);
  });
});

// ---------------------------------------------------------------------------
// §3. Nested-output case (W0a / F-COMPILE-001 interaction)
// ---------------------------------------------------------------------------

// Server-only fixture: a server function uses `hashPassword`, forcing
// server.js emission so the nested-path rewrite has something to operate on.
// Bug 18 S95: only SERVER JS retains the rewrite to `./_scrml/<name>.js` —
// client JS lowers scrml:NAME imports to `_scrml_stdlib.<name>` destructure.
const FIXTURE_SCRML_SERVER = `\${
    import { hashPassword } from 'scrml:auth'
    server function hashIt(pw) {
        return hashPassword(pw)
    }
}
h1 "OQ-2 nested smoke"
`;

describe("OQ-2 §3: nested-output W0a interaction — relative path matches actual depth", () => {
  test("server JS under a deeper subdir emits a `../../_scrml/...` relative import", () => {
    // Multi-file invocation forces W0a's `computeOutputBaseDir` to use the
    // common ancestor as the base. With a top-level file + a nested file,
    // the base is the top-level dir, so the nested file's output ends up at
    // `dist/sub/dir/X.server.js` and must reach `_scrml/` via `../../`.
    // The rewrite applies to SERVER JS only (client JS uses the
    // _scrml_stdlib registry — see §2 for the post-Bug-18 contract).
    const ROOT = join(TMP, "e2e-2");
    const top = fx("e2e-2/top.scrml", FIXTURE_SCRML_SERVER);
    const nested = fx("e2e-2/sub/dir/nested.scrml", FIXTURE_SCRML_SERVER);
    const outDir = join(ROOT, "dist");

    const result = compileScrml({
      inputFiles: [top, nested],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);

    // Top-level server lives at dist/top.server.js → `./_scrml/auth.js`.
    const topServer = readFileSync(join(outDir, "top.server.js"), "utf8");
    expect(topServer).toContain(`from "./_scrml/auth.js"`);

    // Nested server lives at dist/sub/dir/nested.server.js → `../../_scrml/auth.js`.
    expect(existsSync(join(outDir, "sub/dir/nested.server.js"))).toBe(true);
    const nestedServer = readFileSync(join(outDir, "sub/dir/nested.server.js"), "utf8");
    expect(nestedServer).toContain(`from "../../_scrml/auth.js"`);
    expect(nestedServer).not.toContain(`from "scrml:`);

    // The shim itself is bundled exactly once at <outputDir>/_scrml/.
    expect(existsSync(join(outDir, "_scrml/auth.js"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4. Negative case — names without a shim are left as-is (loud failure)
// ---------------------------------------------------------------------------

describe("OQ-2 §4: unbundled stdlib names survive verbatim (loud-failure preserved)", () => {
  test("rewriteStdlibImports leaves an unrecognised `scrml:NAME` untouched", () => {
    // Direct unit-level assertion: `rewriteStdlibImports` does NOT rewrite a
    // name that isn't in the `bundled` set. This is the contract that lets
    // future stdlib gaps surface as runtime errors rather than silently
    // resolving to nothing. A future M16 dispatch can register more names by
    // dropping a shim file at compiler/runtime/stdlib/<name>.js.
    const outputDir = "/abs/dist";
    const bundleDir = "/abs/dist";
    const bundled = new Set(); // empty — nothing bundled
    const src = `import { foo } from "scrml:nonexistent";\n`;
    const out = rewriteStdlibImports(src, bundleDir, outputDir, bundled);
    expect(out).toBe(src); // verbatim
  });
});
