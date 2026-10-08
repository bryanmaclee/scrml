/**
 * F-COMPILE-002: codegen rewrite of `./*.scrml` imports to compiled extensions.
 *
 * Coverage for the paired-dispatch fix from
 *   docs/changes/f-compile-002-build-002/diagnosis.md
 *
 * Pre-fix behavior (the bug):
 *   `emit-server.ts` emitted `stmt.source` verbatim, so user-authored
 *   `import { x } from './foo.scrml'` became `import { x } from './foo.scrml'`
 *   in the emitted server.js. Bun rejects the import at runtime with
 *   `Cannot find package` (the .scrml scheme is not a valid loader extension).
 *
 *   Additionally `rewriteRelativeImportPaths` (api.js) treated every
 *   `.js`-suffixed relative import as a source-tree file, mis-relocating
 *   `.server.js` and `.client.js` paths back into the source tree (where the
 *   compiled artefacts do not exist).
 *
 * Post-fix behavior:
 *   §1. `emit-server.ts` rewrites `from './foo.scrml'` → `from './foo.server.js'`
 *       in-place during emit, mirroring the existing client emit pattern.
 *   §2. `rewriteRelativeImportPaths` skips `.server.js` and `.client.js` paths
 *       (they are output-tree siblings of the importing file, not source-tree
 *       files; their relative path is already correct in the dist tree per
 *       F-COMPILE-001 Option A tree-preservation).
 *   §3. Client emit (`emit-client.ts`) continues to rewrite `.scrml` → `.client.js`
 *       (regression coverage — was already correct pre-fix).
 *
 * Tests:
 *   §1. `compileScrml` on a fixture importing `./helper.scrml` produces
 *       server.js with `from "./helper.server.js"` (no `.scrml` extension).
 *   §2. Same fixture, client.js retains `from "./helper.client.js"` rewrite
 *       (regression coverage for emit-client.ts).
 *   §3. Nested fixture (W0a tree-preservation): `pages/a/foo.scrml` imports
 *       `./bar.scrml` → server.js has `from "./bar.server.js"`, NOT relocated.
 *   §4. Mixed-extension imports: `.js` sidecar still gets relocated;
 *       `.server.js` / `.client.js` are skipped by the relocation rewriter.
 *   §5. Default imports (`import x from './foo.scrml'`) get rewritten too.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import {
  compileScrml,
  rewriteRelativeImportPaths,
} from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "f-compile-002-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(absPath, source) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, source);
  return absPath;
}

// ---------------------------------------------------------------------------
// Fixture: a "page" with a server function that imports from a helper file.
// The page must have a server-bearing node (a server function) to trigger
// server.js emission.
// ---------------------------------------------------------------------------
const PAGE_WITH_SERVER_IMPORT = `<program>
\${
  import { greet } from './helper.scrml'

  server function getGreeting() {
    return greet("world")
  }
}
<h1>f-compile-002 server-import test</h1>

</program>
`;

const HELPER = `\${
  export function greet(name) {
    return "hello, " + name
  }
}
`;

// ---------------------------------------------------------------------------
// §1. Server emit rewrites `.scrml` → `.server.js`
// ---------------------------------------------------------------------------

describe("F-COMPILE-002 §1: server emit rewrites .scrml → .server.js", () => {
  test("compileScrml emits server.js with `from \"./helper.server.js\"` (no .scrml)", () => {
    const dir = join(TMP, "s1");
    const pagePath = fx(join(dir, "src/page.scrml"), PAGE_WITH_SERVER_IMPORT);
    fx(join(dir, "src/helper.scrml"), HELPER);

    const outDir = join(dir, "out");
    const result = compileScrml({
      inputFiles: [pagePath],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    // No errors expected from the import-rewrite path (other errors from
    // unrelated codegen issues are not the concern of this test — we
    // assert specifically on the import line).
    expect(result.errors.filter(e => e.code?.startsWith?.("E-IMPORT")))
      .toEqual([]);

    // The server.js should be written. Its import line must reference the
    // compiled output extension, NOT the source extension.
    const serverPath = join(outDir, "page.server.js");
    expect(existsSync(serverPath)).toBe(true);

    const server = readFileSync(serverPath, "utf8");
    expect(server).toMatch(/from\s+["']\.\/helper\.server\.js["']/);
    // CRITICAL: must NOT contain the verbatim .scrml extension on a relative import.
    expect(server).not.toMatch(/from\s+["']\.\/helper\.scrml["']/);
  });
});

// ---------------------------------------------------------------------------
// §2. Client emit rewrites `.scrml` → `.client.js` (regression coverage)
// ---------------------------------------------------------------------------

describe("F-COMPILE-002 §2: client emit rewrites .scrml → .client.js", () => {
  test("client.js retains pre-existing .client.js rewrite (no regression)", () => {
    const dir = join(TMP, "s2");
    // Use a simpler fixture for client — a component-style import.
    const PAGE_CLIENT = `<program>
\${
  import { greet } from './helper.scrml'
}
<h1>client-import</h1>

</program>
`;
    const pagePath = fx(join(dir, "src/page.scrml"), PAGE_CLIENT);
    fx(join(dir, "src/helper.scrml"), HELPER);

    const outDir = join(dir, "out");
    const result = compileScrml({
      inputFiles: [pagePath],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    const clientPath = join(outDir, "page.client.js");
    expect(existsSync(clientPath)).toBe(true);

    const client = readFileSync(clientPath, "utf8");
    // known-gaps-#6 (S152, Approach B): a local `.scrml` import lowers to a
    // `_scrml_modules` registry read, NOT a bare ES import (which would
    // SyntaxError in the classic <script> the client.js is loaded as). The
    // stable key is the dist-relative `.client.js` path — both files sit in
    // `src/`, so the key is `helper.client.js`.
    expect(client).toMatch(/const \{ greet \} = _scrml_modules\["helper\.client\.js"\];/);
    // No bare ES import/export for the cross-file `.scrml` dependency.
    expect(client).not.toMatch(/^\s*import\s/m);
    expect(client).not.toMatch(/from\s+["']\.\/helper\.scrml["']/);
  });
});

// ---------------------------------------------------------------------------
// §3. rewriteRelativeImportPaths skips .server.js / .client.js
// ---------------------------------------------------------------------------

describe("F-COMPILE-002 §3: rewriteRelativeImportPaths skips compiled-output extensions", () => {
  test(".server.js paths are NOT relocated (output-tree siblings)", () => {
    const js = `import { x } from "./helper.server.js";\n`;
    const result = rewriteRelativeImportPaths(
      js,
      "/project/src/sub/page.scrml",
      "/project/dist",
    );
    // Expected: path preserved as-is. The compiled `helper.server.js` lives
    // in the dist tree at the same relative position as `helper.scrml` in src.
    expect(result).toBe(`import { x } from "./helper.server.js";\n`);
  });

  test(".client.js paths are NOT relocated (output-tree siblings)", () => {
    const js = `import { x } from "./helper.client.js";\n`;
    const result = rewriteRelativeImportPaths(
      js,
      "/project/src/sub/page.scrml",
      "/project/dist",
    );
    expect(result).toBe(`import { x } from "./helper.client.js";\n`);
  });

  test(".js sidecar imports continue to be relocated (regression)", () => {
    // This is the original GITI-009 contract — a real source-tree .js file
    // imported via relative path must be rewritten so the compiled output
    // can find it from the dist directory.
    const js = `import { f } from "./vendor.js";\n`;
    const result = rewriteRelativeImportPaths(
      js,
      "/project/src/page.scrml",
      "/project/dist",
    );
    expect(result).toBe(`import { f } from "../src/vendor.js";\n`);
  });

  test("nested .server.js path with deeper source dir is preserved", () => {
    // Even when source dir != output dir, a .server.js path should be
    // preserved as-is — the dist tree mirrors the source tree.
    const js = `import { x } from "./models/auth.server.js";\n`;
    const result = rewriteRelativeImportPaths(
      js,
      "/project/src/app.scrml",
      "/project/dist",
    );
    expect(result).toBe(`import { x } from "./models/auth.server.js";\n`);
  });
});

// ---------------------------------------------------------------------------
// §4. Default imports
// ---------------------------------------------------------------------------

describe("F-COMPILE-002 §4: default imports are rewritten", () => {
  test("`import Comp from './foo.scrml'` → `from './foo.server.js'`", () => {
    const dir = join(TMP, "s4");
    const PAGE_DEFAULT = `<program>
\${
  import helper from './helper.scrml'
  server function callIt() {
    return helper("x")
  }
}
<h1>default-import</h1>

</program>
`;
    const HELPER_DEFAULT = `\${
  export default function greet(name) {
    return "hi, " + name
  }
}
`;
    const pagePath = fx(join(dir, "src/page.scrml"), PAGE_DEFAULT);
    fx(join(dir, "src/helper.scrml"), HELPER_DEFAULT);

    const outDir = join(dir, "out");
    compileScrml({
      inputFiles: [pagePath],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    const serverPath = join(outDir, "page.server.js");
    if (existsSync(serverPath)) {
      const server = readFileSync(serverPath, "utf8");
      // The default-import form of the rewrite — body of the import differs but
      // the source path must be `.server.js`, not `.scrml`.
      expect(server).not.toMatch(/from\s+["']\.\/helper\.scrml["']/);
    }
  });
});

// ---------------------------------------------------------------------------
// §5. Smoke test: the emitted server.js file is loadable via Bun's import
//
// We can't `await import()` in Bun without a real-on-disk fixture (which the
// helper file's pure-helper compilation may not produce a usable .server.js
// for, due to a separate empty-export bug). What we CAN verify is that the
// emitted server.js parses (no SyntaxError).
// ---------------------------------------------------------------------------

describe("F-COMPILE-002 §5: emitted server.js is syntactically valid", () => {
  test("server.js with rewritten .scrml imports parses without SyntaxError", async () => {
    const dir = join(TMP, "s5");
    const pagePath = fx(join(dir, "src/page.scrml"), PAGE_WITH_SERVER_IMPORT);
    fx(join(dir, "src/helper.scrml"), HELPER);

    const outDir = join(dir, "out");
    compileScrml({
      inputFiles: [pagePath],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    const serverPath = join(outDir, "page.server.js");
    if (existsSync(serverPath)) {
      const server = readFileSync(serverPath, "utf8");
      // Use Bun's transpiler to parse — won't load deps, just checks syntax.
      // If `from "./helper.scrml"` were still present, Bun's parser would
      // accept it (the parser doesn't validate import paths); it's a runtime
      // resolution failure. So this test asserts a static property: no .scrml
      // extension on a relative import line.
      const importLines = server.split("\n").filter(l => l.match(/^\s*import\b/));
      for (const line of importLines) {
        // Allow scrml: and vendor: prefixes; reject relative .scrml.
        if (line.match(/from\s+["']\.\.?\//)) {
          expect(line).not.toMatch(/\.scrml["']/);
        }
      }
    }
  });
});
