/**
 * g-tool-artifact-import-specifier-dangles (S317) — a §64 `kind="tool"` artifact
 * under `pages/` that imports a cross-directory `.scrml` library must emit an
 * import specifier that RESOLVES in the dist tree, not a source-space one that
 * dies at runtime with `Cannot find module` on a green compile.
 *
 * The dist tree strips a leading `pages/` segment (SPEC §47.9.5), so
 * `pages/mytool.scrml` lands at `dist/mytool.js` while `models/lib.scrml` lands
 * at `dist/models/lib.js`. The tool's source-space `../models/lib.scrml` import
 * was emitted verbatim as `../models/lib.js` — which from the dist-root
 * `mytool.js` overshoots dist by one segment. `node --check` passes (a missing
 * FILE is not a syntax error); `bun mytool.js` dies. The fix re-bases the
 * bare-`.js` scrml-library specifier to dist space via `distRelativeLocalSpecifier`
 * (the same treatment S296 gave the `.server.js` half).
 *
 * The oracle here is DISK RESOLUTION of the emitted specifier — the same check
 * `corpus-emitted-specifier-resolution.test.js` sweeps corpus-wide — not a string
 * match, so it pins the runtime contract rather than a particular spelling.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "g-tool-import-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const LIB = `\${
    export function greet(name) { return "hello " + name }
}
`;
const TOOL = `<program kind="tool" lang="ts">
\${ import { greet } from "IMPORT_PATH" }
function main(args: string[]): number {
    print(greet("world"))
    return 0
}
</program>
`;

// Compile a multi-file project rooted at `dir`; return {errors, dist}.
function compileProject(name, files) {
  const dir = join(TMP, name);
  const paths = [];
  for (const [rel, contents] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, contents);
    paths.push(p);
  }
  const dist = join(dir, "dist");
  const result = compileScrml({ inputFiles: paths, outputDir: dist, write: true, log: () => {} });
  const errors = (result.errors || []).filter((e) => e.severity == null || e.severity === "error");
  return { errors, dist };
}

// Every relative import specifier in every emitted .js that does NOT resolve on disk.
function danglingSpecifiers(dist) {
  const out = [];
  const walk = (d) => {
    for (const n of require("fs").readdirSync(d)) {
      const p = join(d, n);
      if (require("fs").statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".js")) continue;
      const re = /^\s*import\s+[^;]*?\s*from\s*["'](\.\.?\/[^"']+\.js)["']/gm;
      const src = readFileSync(p, "utf8");
      let m;
      while ((m = re.exec(src))) {
        if (!existsSync(resolve(dirname(p), m[1]))) out.push(`${p.slice(dist.length + 1)} -> ${m[1]}`);
      }
    }
  };
  walk(dist);
  return out;
}

describe("g-tool-artifact-import-specifier-dangles — a tool's cross-dir .scrml import resolves in dist", () => {
  test("a `pages/` tool importing `../models/lib.scrml` emits a specifier that RESOLVES on disk", () => {
    const { errors, dist } = compileProject("under-pages", {
      "models/lib.scrml": LIB,
      "pages/mytool.scrml": TOOL.replace("IMPORT_PATH", "../models/lib.scrml"),
    });
    // Green compile — the exact signature of the bug (it compiles clean, then dies).
    expect(errors).toEqual([]);
    // The dist tree strips `pages/`, so the tool lands at dist root and the
    // library at `models/lib.js`; the emitted specifier must point there.
    const toolJs = readFileSync(join(dist, "mytool.js"), "utf8");
    expect(toolJs).toMatch(/import \{ greet \} from "\.\/models\/lib\.js";/);
    // The runtime contract: every emitted specifier resolves on disk.
    expect(danglingSpecifiers(dist)).toEqual([]);
  });

  test("NON-REGRESSION — a root-level tool importing a same-dir `./lib.scrml` still resolves (no `pages/` strip → byte-identical space)", () => {
    const { errors, dist } = compileProject("no-pages", {
      "lib.scrml": LIB,
      "mytool.scrml": TOOL.replace("IMPORT_PATH", "./lib.scrml"),
    });
    expect(errors).toEqual([]);
    const toolJs = readFileSync(join(dist, "mytool.js"), "utf8");
    expect(toolJs).toMatch(/import \{ greet \} from "\.\/lib\.js";/);
    expect(danglingSpecifiers(dist)).toEqual([]);
  });
});
