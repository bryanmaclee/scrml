/**
 * g-tool-import-prune-drops-dollar-local (S338) — the `kind="tool"` import
 * tree-shake must not classify a `$`-prefixed import local as DEAD.
 *
 * ROOT: the prune landed with its OWN copy of the liveness predicate
 * (`identReferencedInSrc`), built on `\b`. `\b` sits between a word char and a
 * non-word char, and `$` is NOT a word char — so `\b$rs\b` cannot match at the
 * start of `$rs`. Every specifier of `import { routeScore as $rs }` was therefore
 * judged dead, and `buildImportHeader`'s all-dead branch dropped the WHOLE import
 * while the body kept `return $rs(21)`. Result: exit 0, ZERO diagnostics, and
 * `ReferenceError: $rs is not defined` at runtime. `node --check` passes on that
 * output — a missing import is not a syntax error — so this class is only visible
 * by EXECUTING the emitted tool, which the first test below does.
 *
 * The sibling prune it claimed to match (emit-server.ts, S207) had already
 * documented this exact hazard in a comment and guarded the boundaries manually.
 *
 * FIX: delete the second copy. `localServerImportNameUsed` is exported from
 * emit-server.ts and is now the ONE local-import liveness predicate in codegen,
 * and the tool prune scans the EMITTED MODULE BODY (unioned with the scrml source
 * of the non-import top-level statements) rather than scrml source text alone —
 * the same scan-root shape emit-server's prune uses.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileMulti(files, order) {
  const dir = mkdtempSync(join(tmpdir(), "tool-import-prune-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const paths = [];
  for (const name of order) {
    const p = join(dir, name + ".scrml");
    writeFileSync(p, files[name]);
    paths.push(p);
  }
  const result = compileScrml({ inputFiles: paths, write: true, outputDir: dist, log: () => {} });
  return { result, dist };
}

function errorCodes(result) {
  return (result.errors ?? []).map((e) => e.code).filter((c) => c && String(c).startsWith("E-"));
}

/** The emitted tool's import line for the local lib, or "" when none survived. */
function libImportLine(dist, toolName = "tool") {
  const toolJs = readFileSync(join(dist, toolName + ".js"), "utf8");
  return toolJs.split("\n").find((l) => /from "\.\/lib\.js"/.test(l)) ?? "";
}

const LIB = `\${
export function routeScore(x) { return x * 2 }
export function ensureSchema() { return 1 }
}`;

describe("g-tool-import-prune-drops-dollar-local", () => {
  test("a `$`-prefixed import local survives the prune AND the emitted tool RUNS", () => {
    const tool = `<program kind="tool">
\${ import { routeScore as $rs } from "./lib.scrml" }
export function main() { return $rs(21) }
</program>`;
    const { result, dist } = compileMulti({ lib: LIB, tool }, ["lib", "tool"]);
    expect(errorCodes(result)).toEqual([]);

    const importLine = libImportLine(dist);
    expect(importLine).toContain("routeScore as $rs");
    // The prune still does its job — the un-referenced export stays out.
    expect(importLine).not.toContain("ensureSchema");

    // THE LOAD-BEARING ASSERTION. A dropped import is not a syntax error, so
    // `node --check` is blind to it; only execution catches the ReferenceError.
    const run = Bun.spawnSync([process.execPath, join(dist, "tool.js")], { stdout: "pipe", stderr: "pipe" });
    const stderr = run.stderr.toString();
    expect(stderr).not.toContain("ReferenceError");
    expect(run.exitCode).toBe(0);
  });

  test("an `_`-prefixed import local survives the prune", () => {
    const tool = `<program kind="tool">
\${ import { routeScore as _rs } from "./lib.scrml" }
export function main() { return _rs(21) }
</program>`;
    const { result, dist } = compileMulti({ lib: LIB, tool }, ["lib", "tool"]);
    expect(errorCodes(result)).toEqual([]);
    expect(libImportLine(dist)).toContain("routeScore as _rs");
  });

  test("a plain aliased import local survives the prune", () => {
    const tool = `<program kind="tool">
\${ import { routeScore as rs } from "./lib.scrml" }
export function main() { return rs(21) }
</program>`;
    const { result, dist } = compileMulti({ lib: LIB, tool }, ["lib", "tool"]);
    expect(errorCodes(result)).toEqual([]);
    expect(libImportLine(dist)).toContain("routeScore as rs");
  });

  test("the prune is not fooled by a LONGER identifier that contains the local name", () => {
    // The body references `routeScoreTotal` (a local fn) but never `routeScore`
    // itself — the boundary-guarded predicate must still classify the import DEAD.
    const tool = `<program kind="tool">
\${ import { routeScore } from "./lib.scrml" }
function routeScoreTotal(x) { return x + 1 }
export function main() { return routeScoreTotal(21) }
</program>`;
    const { result, dist } = compileMulti({ lib: LIB, tool }, ["lib", "tool"]);
    expect(errorCodes(result)).toEqual([]);
    expect(libImportLine(dist)).toBe("");
  });

  test("the prune does not treat a `$`-prefixed OTHER name as a use of the bare local", () => {
    // The precise boundary-set difference between `\b` and the shared predicate.
    // `\b` sits between a word char and a non-word char, and `$` is non-word, so
    // `\brs\b` MATCHES inside `$rs` — a `\b` predicate would keep the `rs` import
    // alive on a reference to an unrelated `$rs`. The shared predicate puts `$` in
    // the excluded neighbour class, so `rs` is correctly dead here.
    const tool = `<program kind="tool">
\${ import { routeScore as rs } from "./lib.scrml" }
function $rs(x) { return x + 1 }
export function main() { return $rs(21) }
</program>`;
    const { result, dist } = compileMulti({ lib: LIB, tool }, ["lib", "tool"]);
    expect(errorCodes(result)).toEqual([]);
    expect(libImportLine(dist)).toBe("");
  });

  test("an import whose every local is genuinely dead still drops entirely", () => {
    const tool = `<program kind="tool">
\${ import { routeScore as $rs } from "./lib.scrml" }
export function main() { return 1 }
</program>`;
    const { result, dist } = compileMulti({ lib: LIB, tool }, ["lib", "tool"]);
    expect(errorCodes(result)).toEqual([]);
    expect(libImportLine(dist)).toBe("");
  });
});
