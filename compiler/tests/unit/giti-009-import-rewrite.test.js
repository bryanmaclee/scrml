/**
 * GITI-009: Relative-import path rewriting.
 *
 * When a .scrml file imports a .js sidecar via a relative path, the compiled
 * output must rewrite that path so it resolves from the output directory, not
 * the source file directory.
 *
 * Bug: import paths were forwarded verbatim from source to compiled output,
 * causing runtime ENOENT when the output directory differs from the source.
 *
 * Fix: rewriteRelativeImportPaths() in api.js post-processes generated JS
 * before writing to disk.
 */

import { describe, test, expect } from "bun:test";
import { rewriteRelativeImportPaths } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Unit tests for rewriteRelativeImportPaths()
// ---------------------------------------------------------------------------

describe("rewriteRelativeImportPaths", () => {

  test("rewrites ./helper.js when output dir differs from source dir", () => {
    const js = `import { helper } from "./helper.js";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/sub/app.scrml", "/project/dist");
    expect(result).toBe(`import { helper } from "../src/sub/helper.js";`);
  });

  test("rewrites ../shared.js when output dir differs from source dir", () => {
    const js = `import { util } from "../shared.js";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/sub/app.scrml", "/project/dist");
    expect(result).toBe(`import { util } from "../src/shared.js";`);
  });

  test("preserves path when source dir equals output dir", () => {
    const js = `import { helper } from "./helper.js";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/app.scrml", "/project/src");
    expect(result).toBe(`import { helper } from "./helper.js";`);
  });

  test("rewrites multiple import lines independently", () => {
    const js = [
      `import { a } from "./a.js";`,
      `import { b } from "../lib/b.js";`,
      `// some code`,
      `import { c } from "./c.js";`,
    ].join("\n");
    const result = rewriteRelativeImportPaths(js, "/project/src/deep/app.scrml", "/project/dist");
    const lines = result.split("\n");
    expect(lines[0]).toBe(`import { a } from "../src/deep/a.js";`);
    expect(lines[1]).toBe(`import { b } from "../src/lib/b.js";`);
    expect(lines[2]).toBe(`// some code`);
    expect(lines[3]).toBe(`import { c } from "../src/deep/c.js";`);
  });

  test("does not rewrite non-relative imports", () => {
    const js = [
      `import { x } from "scrml:crypto";`,
      `import { y } from "vendor:lodash";`,
      `import { z } from "./local.js";`,
    ].join("\n");
    const result = rewriteRelativeImportPaths(js, "/project/src/app.scrml", "/project/dist");
    const lines = result.split("\n");
    // scrml: and vendor: imports should be untouched
    expect(lines[0]).toBe(`import { x } from "scrml:crypto";`);
    expect(lines[1]).toBe(`import { y } from "vendor:lodash";`);
    // relative .js import should be rewritten
    expect(lines[2]).toBe(`import { z } from "../src/local.js";`);
  });

  test("does not rewrite .scrml imports", () => {
    const js = `import { Comp } from "./other.scrml";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/app.scrml", "/project/dist");
    // .scrml imports are not .js — should not be touched
    expect(result).toBe(`import { Comp } from "./other.scrml";`);
  });

  test("handles default imports", () => {
    const js = `import helper from "./helper.js";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/sub/app.scrml", "/project/dist");
    expect(result).toBe(`import helper from "../src/sub/helper.js";`);
  });

  test("handles deeply nested source with shallow output", () => {
    const js = `import { db } from "./db-client.js";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/a/b/c/app.scrml", "/project/dist");
    expect(result).toBe(`import { db } from "../src/a/b/c/db-client.js";`);
  });

  test("returns input unchanged when jsCode is falsy", () => {
    expect(rewriteRelativeImportPaths("", "/a.scrml", "/dist")).toBe("");
    expect(rewriteRelativeImportPaths(null, "/a.scrml", "/dist")).toBeNull();
    expect(rewriteRelativeImportPaths(undefined, "/a.scrml", "/dist")).toBeUndefined();
  });

  test("returns input unchanged when sourceFilePath is falsy", () => {
    const js = `import { x } from "./x.js";`;
    expect(rewriteRelativeImportPaths(js, null, "/dist")).toBe(js);
    expect(rewriteRelativeImportPaths(js, "", "/dist")).toBe(js);
  });

  test("returns input unchanged when outputDir is falsy", () => {
    const js = `import { x } from "./x.js";`;
    expect(rewriteRelativeImportPaths(js, "/src/app.scrml", null)).toBe(js);
    expect(rewriteRelativeImportPaths(js, "/src/app.scrml", "")).toBe(js);
  });

  test("handles import with multiple named exports", () => {
    const js = `import { a, b, c } from "./utils.js";`;
    const result = rewriteRelativeImportPaths(js, "/project/src/app.scrml", "/project/dist");
    expect(result).toBe(`import { a, b, c } from "../src/utils.js";`);
  });

  test("handles single-quoted imports", () => {
    const js = `import { helper } from './helper.js';`;
    const result = rewriteRelativeImportPaths(js, "/project/src/sub/app.scrml", "/project/dist");
    expect(result).toBe(`import { helper } from '../src/sub/helper.js';`);
  });

  test("does not touch non-import lines containing .js paths", () => {
    const js = [
      `const path = "./helper.js";`,
      `import { x } from "./x.js";`,
      `console.log("./foo.js");`,
    ].join("\n");
    const result = rewriteRelativeImportPaths(js, "/project/src/app.scrml", "/project/dist");
    const lines = result.split("\n");
    expect(lines[0]).toBe(`const path = "./helper.js";`);
    expect(lines[1]).toBe(`import { x } from "../src/x.js";`);
    expect(lines[2]).toBe(`console.log("./foo.js");`);
  });
});

// ---------------------------------------------------------------------------
// Integration: compile and verify rewritten import in output
// ---------------------------------------------------------------------------

import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

describe("GITI-009 integration: compile rewrites import paths", () => {

  const tmpDir = join(import.meta.dir, "_tmp_giti009");

  function setup() {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(tmpDir, "src", "sub"), { recursive: true });
    mkdirSync(join(tmpDir, "dist"), { recursive: true });

    writeFileSync(join(tmpDir, "src", "sub", "app.scrml"), `<program>

\${
  import { helper } from './app-helper.js'

  server function getValue() {
    return { value: helper() }
  }
}

<div>
  <p>value: \${getValue().value}</p>
</div>

</program>`);

    writeFileSync(join(tmpDir, "src", "sub", "app-helper.js"),
      `export function helper() { return 42; }`);
  }

  function cleanup() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  test("serverJs import path resolves from output dir, not source dir", () => {
    setup();
    try {
      const result = compileScrml({
        inputFiles: [join(tmpDir, "src", "sub", "app.scrml")],
        outputDir: join(tmpDir, "dist"),
        write: true,
      });

      expect(result.errors.length).toBe(0);

      const serverJs = readFileSync(join(tmpDir, "dist", "app.server.js"), "utf8");
      // The import should resolve from dist/ to src/sub/app-helper.js
      expect(serverJs).toContain("../src/sub/app-helper.js");
      // It should NOT contain the original source-relative path
      expect(serverJs).not.toContain("from \"./app-helper.js\"");
      expect(serverJs).not.toContain("from './app-helper.js'");
    } finally {
      cleanup();
    }
  });

  test("no rewriting when output dir equals source dir", () => {
    setup();
    try {
      const srcDir = join(tmpDir, "src", "sub");
      const result = compileScrml({
        inputFiles: [join(srcDir, "app.scrml")],
        outputDir: srcDir,
        write: true,
      });

      expect(result.errors.length).toBe(0);

      const serverJs = readFileSync(join(srcDir, "app.server.js"), "utf8");
      // Path should be unchanged when outputting to same directory as source
      expect(serverJs).toContain("./app-helper.js");
    } finally {
      cleanup();
    }
  });
});
