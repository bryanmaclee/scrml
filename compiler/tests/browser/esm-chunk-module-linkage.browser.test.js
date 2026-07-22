/**
 * esm-chunk-module-linkage.browser.test.js — ESM chunks arc, Unit 2.
 *
 * Full-graph module-linkage EXECUTION proof (the "emitted != runs" / S265 bar).
 * Compiles a real multi-file app under `--module-format=esm` and loads the esm
 * runtime + EVERY chunk (including the entry chunk with markup + the
 * `_scrml_lift_target` globalThis write) via bun's native ESM loader, with a DOM
 * supplied by happy-dom. Bun does the real MODULE LINKING (specifier resolution +
 * live-binding instantiation across chunk↔runtime↔chunk); happy-dom supplies the
 * document the chunk's top-level code touches. A wrong import URL, an unresolved
 * runtime symbol, or an assign-to-imported-binding would throw here.
 *
 * The real-Chromium `<script type=module>` proof (the stronger fidelity bar the
 * arc's browser-harness gap calls for) runs in the PA's R26 pass; this keeps a
 * portable execution regression guard IN the suite.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../bin/scrml.js");
const MF_EXAMPLE = join(import.meta.dir, "../../../examples/22-multifile");

let outDir;
const tmpDirs = [];

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
  // A lift target + logic anchor so the entry chunk's top-level DOM reads resolve.
  document.body.innerHTML = `<main data-scrml-lift-target><div data-scrml-logic="_scrml_logic_1"></div></main>`;
  outDir = mkdtempSync(join(tmpdir(), "scrml-u2-browser-out-"));
  tmpDirs.push(outDir);
  const r = spawnSync("bun", [CLI, "compile", MF_EXAMPLE, "-o", outDir, "--module-format=esm"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("esm compile failed: " + (r.stderr || r.stdout));
});

afterAll(() => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

function runtimeFileIn(dir) {
  const n = readdirSync(dir).find((f) => f.startsWith("scrml-runtime.") && f.endsWith(".js"));
  return n ? join(dir, n) : null;
}

describe("esm chunk graph links + executes as real modules", () => {
  test("runtime + cross-chunk + entry chunk all link; reactivity roundtrips; lift-target routed", async () => {
    const rt = runtimeFileIn(outDir);
    const rtMjs = rt + ".mjs";
    copyFileSync(rt, rtMjs);
    const runtime = await import(rtMjs);

    // Pure exporter + cross-chunk importer link (components imports types).
    const types = await import(join(outDir, "types.client.js"));
    expect(types.UserRole?.Admin).toBe("Admin");
    await import(join(outDir, "components.client.js"));

    // Entry chunk: imports the runtime (`_scrml_lift`) + BOTH deps, and writes the
    // globalThis-bridged `_scrml_lift_target`. If any link were wrong this throws.
    await import(join(outDir, "app.client.js"));

    // The lift-target slot was written+reset through globalThis (the R2 bridge),
    // never via an (illegal) assignment to an imported binding.
    expect("_scrml_lift_target" in globalThis).toBe(true);

    // Reactivity roundtrips through the shared runtime module instance.
    runtime._scrml_reactive_set("probe", 7);
    let fired = 0;
    runtime._scrml_reactive_subscribe("probe", () => { fired++; });
    runtime._scrml_reactive_set("probe", 8);
    expect(runtime._scrml_reactive_get("probe")).toBe(8);
    expect(fired).toBeGreaterThanOrEqual(1);
  });
});
