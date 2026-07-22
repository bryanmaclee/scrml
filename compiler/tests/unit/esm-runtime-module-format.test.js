/**
 * esm-runtime-module-format.test.js — ESM chunks arc, Unit 1.
 *
 * Covers the `--module-format=classic|esm` runtime shape:
 *   §1  classic default emits BYTE-IDENTICAL output to today (compile diff).
 *   §2  esm emits a runtime that PARSES as an ES module and IMPORTS without
 *       throwing (bun native ESM import of the emitted file).
 *   §3  the esm export surface is DERIVED from the sliced runtime's top-level
 *       declarations (no rot), non-empty, dup-free, and never names a
 *       tree-shaken-out symbol.
 *   §4  functional R1 — the esm runtime, imported as a module, does a reactive
 *       set/get roundtrip, fires a subscriber, AND (the R1 rework) tracks a
 *       module-binding `_scrml_reactive_get` read inside a `^{}` meta-effect so
 *       the effect re-runs on dependency change. Under a broken esm runtime the
 *       module binding would bypass the interception and the effect would NOT
 *       re-run.
 *   §5  drift guard — the transform's anchors still match the runtime template
 *       (the guard-simplification + R1 edits are present in the esm output).
 *
 * Unit 1 introduces the flag + esm runtime shape only; the default stays
 * `classic` and byte-identical. Chunk-side import emit is a later arc unit.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { compileScrml } from "../../src/api.js";
import { RUNTIME_CHUNK_ORDER, assembleRuntime } from "../../src/codegen/runtime-chunks.ts";
import { toEsmRuntime, deriveTopLevelExportNames } from "../../src/codegen/runtime-esm.ts";
import { moduleFormatNotices, W_MODULE_FORMAT_ESM_INCOMPLETE } from "../../src/commands/module-format-notice.js";
import * as acorn from "acorn";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A trivial markup fixture — enough to emit a shared runtime file. Byte-identity
// of the runtime is independent of the source; this keeps the test self-contained.
const FIXTURE_SRC = `<div>\n    <p>hello</p>\n</div>\n`;

const tmpDirs = [];
function freshDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function writeFixture(dir) {
  const f = join(dir, "app.scrml");
  writeFileSync(f, FIXTURE_SRC);
  return f;
}
function runtimeFileIn(dir) {
  const name = readdirSync(dir).find((n) => n.startsWith("scrml-runtime.") && n.endsWith(".js"));
  return name ? join(dir, name) : null;
}
function compileFixture(moduleFormat) {
  const dir = freshDir(`scrml-u1-${moduleFormat}-`);
  const input = writeFixture(dir);
  const outDir = freshDir(`scrml-u1-out-${moduleFormat}-`);
  const opts = { inputFiles: [input], outputDir: outDir, write: true, log: () => {} };
  if (moduleFormat !== undefined) opts.moduleFormat = moduleFormat;
  const result = compileScrml(opts);
  return { result, outDir };
}

afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe("§1 classic default is byte-identical", () => {
  test("default (no flag) and explicit --module-format=classic emit identical runtime bytes + filename", () => {
    const a = compileFixture(undefined);   // default
    const b = compileFixture("classic");   // explicit classic
    expect(a.result.errors.length).toBe(0);
    expect(b.result.errors.length).toBe(0);

    const rtA = runtimeFileIn(a.outDir);
    const rtB = runtimeFileIn(b.outDir);
    expect(rtA).not.toBeNull();
    expect(rtB).not.toBeNull();

    // Same content-hashed filename == same bytes (the runtime is FNV-hashed).
    expect(rtA.split("/").pop()).toBe(rtB.split("/").pop());
    const bytesA = readFileSync(rtA);
    const bytesB = readFileSync(rtB);
    expect(Buffer.compare(bytesA, bytesB)).toBe(0);

    // The classic runtime carries NO ESM export surface.
    expect(readFileSync(rtA, "utf8").includes("\nexport {")).toBe(false);
  });
});

describe("§2 esm emits an importable ES module", () => {
  test("compiled esm runtime parses as a module and imports without throwing", async () => {
    const { result, outDir } = compileFixture("esm");
    expect(result.errors.length).toBe(0);

    const rt = runtimeFileIn(outDir);
    expect(rt).not.toBeNull();

    const src = readFileSync(rt, "utf8");
    // A distinct content hash from classic (different bytes → different key).
    const classic = compileFixture("classic");
    expect(rt.split("/").pop()).not.toBe(runtimeFileIn(classic.outDir).split("/").pop());

    // Parses under the module goal (a script goal would reject `export`).
    expect(() => acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();

    // Native ESM import (bun) — copy to a .mjs so the loader treats it as ESM.
    const mjs = rt + ".mjs";
    copyFileSync(rt, mjs);
    const mod = await import(mjs);
    expect(Object.keys(mod).length).toBeGreaterThan(0);
    // Core reactive surface is exported.
    expect(typeof mod._scrml_reactive_set).toBe("function");
    expect(typeof mod._scrml_reactive_get).toBe("function");
    expect(typeof mod._scrml_reactive_subscribe).toBe("function");
  });
});

describe("§3 export surface is derived, not curated", () => {
  test("full-runtime export set is non-empty, dup-free, and only names top-level decls", () => {
    const full = assembleRuntime(new Set(RUNTIME_CHUNK_ORDER));
    const names = deriveTopLevelExportNames(full);
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length); // no duplicates

    // Every derived name is a top-level declaration (Acorn-cross-checked).
    const ast = acorn.parse(full, { ecmaVersion: 2022, sourceType: "script" });
    const topLevel = new Set();
    for (const node of ast.body) {
      if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
        topLevel.add(node.id.name);
      } else if (node.type === "VariableDeclaration") {
        for (const d of node.declarations) if (d.id.type === "Identifier") topLevel.add(d.id.name);
      }
    }
    for (const n of names) expect(topLevel.has(n)).toBe(true);
  });

  test("a sliced (tree-shaken) runtime exports fewer symbols than the full runtime", () => {
    const always = new Set(["core", "scope", "errors", "transitions"]);
    const sliced = deriveTopLevelExportNames(assembleRuntime(always));
    const full = deriveTopLevelExportNames(assembleRuntime(new Set(RUNTIME_CHUNK_ORDER)));
    expect(sliced.length).toBeGreaterThan(0);
    expect(sliced.length).toBeLessThan(full.length);
    // The export block would never name a symbol not in the sliced body.
    const slicedBody = assembleRuntime(always);
    for (const n of sliced) expect(slicedBody.includes(n)).toBe(true);
  });
});

describe("§4 functional R1 — reactivity + meta-block dep tracking under module bindings", () => {
  let mod;
  let mjsPath;

  beforeAll(async () => {
    // Transform the FULL assembled runtime (deterministically includes the
    // `meta` chunk) into an ES module and import it. DOM-free: the transitions
    // injector is `typeof document`-guarded and no-ops under bun.
    const esm = toEsmRuntime(assembleRuntime(new Set(RUNTIME_CHUNK_ORDER)));
    const dir = freshDir("scrml-u1-r1-");
    mjsPath = join(dir, "runtime.mjs");
    writeFileSync(mjsPath, esm);
    mod = await import(mjsPath);
  });

  test("reactive set/get roundtrip and subscriber fires", () => {
    mod._scrml_reactive_set("count", 10);
    expect(mod._scrml_reactive_get("count")).toBe(10);

    let seen;
    mod._scrml_reactive_subscribe("count", (v) => { seen = v; });
    mod._scrml_reactive_set("count", 20);
    expect(seen).toBe(20);
    expect(mod._scrml_reactive_get("count")).toBe(20);
  });

  test("a meta-effect tracks a module-binding _scrml_reactive_get read and re-runs on change (R1)", () => {
    mod._scrml_reactive_set("meta_dep", 1);

    let runs = 0;
    let lastSeen;
    // The effect body reads via the MODULE binding `_scrml_reactive_get` — the
    // exact call shape compiled `@meta_dep` reads produce. R1 routes it through
    // the override slot so the read registers as a dependency.
    mod._scrml_meta_effect("_scrml_meta_r1_test", () => {
      runs++;
      lastSeen = mod._scrml_reactive_get("meta_dep");
    }, null, null);

    expect(runs).toBe(1);
    expect(lastSeen).toBe(1);

    // Change the tracked cell — the effect MUST re-run (proof the module-binding
    // read was intercepted). A broken esm runtime leaves runs at 1.
    mod._scrml_reactive_set("meta_dep", 2);
    expect(runs).toBe(2);
    expect(lastSeen).toBe(2);
  });

  test("the override slot is restored after the effect — normal reads take the plain path", () => {
    // After the meta-effect above, __scrml_reactive_get_override must be cleared
    // so an ordinary read resolves through _scrml_state (and derived cells), not
    // the stale tracking function.
    expect(globalThis.__scrml_reactive_get_override).toBeFalsy();
    mod._scrml_reactive_set("plain", 42);
    expect(mod._scrml_reactive_get("plain")).toBe(42);
  });
});

describe("§5 drift guard — esm transforms present in the output", () => {
  test("R1 override slot is installed and the old globalThis swap is gone; redeclare guards simplified", () => {
    const esm = toEsmRuntime(assembleRuntime(new Set(RUNTIME_CHUNK_ORDER)));

    // R1: reactive_get consults the override slot; meta-effect sets it.
    expect(esm.includes("globalThis.__scrml_reactive_get_override(name)")).toBe(true);
    expect(esm.includes("globalThis.__scrml_reactive_get_override = trackingGet")).toBe(true);
    // The classic global-property swap is replaced.
    expect(esm.includes("globalThis._scrml_reactive_get = trackingGet")).toBe(false);

    // Redeclare self-guards simplified away (top-level registry decls).
    expect(esm.includes('var _scrml_modules = (typeof _scrml_modules !== "undefined")')).toBe(false);
    expect(esm.includes('var _SCRML_MOUNTS = (typeof _SCRML_MOUNTS !== "undefined")')).toBe(false);
    expect(esm.includes("var _scrml_modules = {};")).toBe(true);

    // A single trailing export block.
    expect(esm.split("\nexport {").length - 1).toBe(1);
  });

  test("toEsmRuntime throws loudly if a required anchor drifts (fail-loud, not silent)", () => {
    // A runtime string missing the reactive_get header anchor must throw rather
    // than silently ship a runtime whose meta-tracking is broken.
    expect(() => toEsmRuntime("const x = 1;\n")).toThrow(/anchor .*reactive_get header/);
  });
});

describe("§6 operational notice — esm is not yet browser-loadable (fail-closed-Nominal)", () => {
  test("classic (and any non-esm) format produces NO notice — default path stays silent", () => {
    expect(moduleFormatNotices("classic", false)).toEqual([]);
    expect(moduleFormatNotices("classic", true)).toEqual([]);
    expect(moduleFormatNotices(undefined, false)).toEqual([]);
  });

  test("esm produces a single browser-not-loadable warning line", () => {
    const lines = moduleFormatNotices("esm", false);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(W_MODULE_FORMAT_ESM_INCOMPLETE);
    expect(lines[0]).toContain("not yet browser-loadable");
  });

  test("esm + --embed-runtime adds an honest note that esm is dropped for embedded runtimes", () => {
    const lines = moduleFormatNotices("esm", true);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain(W_MODULE_FORMAT_ESM_INCOMPLETE);
    expect(lines[1]).toContain("--embed-runtime");
    expect(lines[1]).toContain("no effect");
  });

  test("CLI surface — `compile --module-format=esm` prints the warning to stderr; classic does not", () => {
    const cli = join(import.meta.dir, "../../bin/scrml.js");
    const sample = join(import.meta.dir, "../../../samples/compilation-tests/basic-003-nested-tags.scrml");
    const outDir = freshDir("scrml-u1-cli-");

    const runEsm = spawnSync("bun", [cli, "compile", sample, "-o", outDir, "--module-format=esm"], { encoding: "utf8" });
    const runClassic = spawnSync("bun", [cli, "compile", sample, "-o", outDir, "--module-format=classic"], { encoding: "utf8" });

    expect(runEsm.status).toBe(0);
    expect(runClassic.status).toBe(0);
    // The warning is an OPERATIONAL stderr line, not a §34 source diagnostic.
    expect(runEsm.stderr).toContain(W_MODULE_FORMAT_ESM_INCOMPLETE);
    expect(runClassic.stderr).not.toContain(W_MODULE_FORMAT_ESM_INCOMPLETE);
  });
});
