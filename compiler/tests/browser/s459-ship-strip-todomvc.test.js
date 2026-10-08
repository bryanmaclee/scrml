/**
 * S459 (SPEC §47.9.9) — a STRIPPED build of TodoMVC behaves exactly like the emitted one.
 *
 * `scrml build` ships browser JavaScript with comments and indentation removed
 * (`stripShippedJs`); `scrml compile` / `scrml dev` ship it as emitted. The strip is proven
 * token-identical at compile time (`codegen/ship-strip.ts`); this test is the executed half of
 * that claim on a real app: benchmarks/todomvc/app.scrml is compiled BOTH ways, each output
 * is loaded — the runtime file the page's own `<script src>` names, then the page bundle — in
 * a FRESH happy-dom process, the same TodoMVC interaction script is driven against each, and
 * the observable results must be identical (and non-trivial).
 *
 * Each side runs in its own `bun` subprocess so no runtime global, DOM node or localStorage
 * entry can carry over from one side to the other (happy-dom global state leaks across
 * in-process runs).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { createRequire } from "module";
import { compileScrml } from "../../src/api.js";

const TODOMVC = resolve(import.meta.dir, "../../../benchmarks/todomvc/app.scrml");
const REGISTRATOR = createRequire(import.meta.url).resolve("@happy-dom/global-registrator");

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "s459-ship-strip-todomvc-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// The driver: load page markup, run runtime + bundle as the page would, drive TodoMVC.
const PROBE = `
import { GlobalRegistrator } from ${JSON.stringify(REGISTRATOR)};
import { readFileSync } from "fs";
import { join } from "path";
GlobalRegistrator.register();
const dir = process.argv[2];
const html = readFileSync(join(dir, "app.html"), "utf8");
const runtimeName = /scrml-runtime\\.[0-9a-z]+\\.js/.exec(html)[0];
const runtimeJs = readFileSync(join(dir, runtimeName), "utf8");
const clientJs = readFileSync(join(dir, "app.client.js"), "utf8");
const errors = [];
globalThis.addEventListener?.("error", (e) => errors.push(String(e.message || e)));
const body = (html.match(/<body[^>]*>([\\s\\S]*)<\\/body>/i) || [, html])[1];
document.body.innerHTML = body.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/g, "");
try {
  // One scope for both classic scripts, as two <script> tags share one global lexical scope.
  new Function(runtimeJs + "\\n;\\n" + clientJs)();
} catch (e) { errors.push("load: " + e.message); }
document.dispatchEvent(new Event("DOMContentLoaded"));
const tick = () => new Promise((r) => setTimeout(r, 20));
await tick();
const snap = (label) => ({
  label,
  items: document.querySelectorAll(".todo-list li").length,
  texts: [...document.querySelectorAll(".todo-list li label")].map((l) => l.textContent.trim()),
  count: (document.querySelector(".todo-count") || {}).textContent?.replace(/\\s+/g, " ").trim() ?? null,
});
const out = [];
const input = document.querySelector(".new-todo");
const form = input && input.closest("form");
for (const t of ["alpha", "beta", "gamma"]) {
  input.value = t;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await tick();
}
out.push(snap("added"));
const firstToggle = document.querySelector(".todo-list li .toggle");
if (firstToggle) { firstToggle.click(); await tick(); }
out.push(snap("toggled"));
for (const href of ["#/active", "#/completed", "#/"]) {
  const a = document.querySelector('a[href="' + href + '"]');
  if (a) { a.click(); await tick(); }
  out.push(snap("filter " + href));
}
const clear = document.querySelector(".clear-completed");
if (clear) { clear.click(); await tick(); }
out.push(snap("cleared"));
console.log(JSON.stringify({ out, errors }));
process.exit(0);
`;

function compileTo(label, stripShippedJs) {
  const outDir = join(TMP, label);
  const r = compileScrml({ inputFiles: [TODOMVC], outputDir: outDir, write: true, log: () => {}, stripShippedJs });
  expect(r.errors.length).toBe(0);
  return { outDir, runtimeFilename: r.runtimeFilename, warnings: r.warnings };
}

function drive(outDir) {
  const probe = join(TMP, "probe.mjs");
  writeFileSync(probe, PROBE);
  const p = Bun.spawnSync(["bun", probe, outDir], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
  const lines = String(p.stdout).trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

describe("S459 — stripped TodoMVC behaves identically to the emitted TodoMVC", () => {
  test("both builds drive to the same, non-trivial result with no errors", () => {
    const dev = compileTo("emitted", false);
    const prod = compileTo("stripped", true);

    // The production build really was stripped, and fell back nowhere.
    expect(prod.warnings.some((w) => w.code === "W-CG-SHIP-STRIP-FALLBACK")).toBe(false);
    const devRt = readFileSync(join(dev.outDir, dev.runtimeFilename), "utf8");
    const prodRt = readFileSync(join(prod.outDir, prod.runtimeFilename), "utf8");
    expect(prodRt.length).toBeLessThan(devRt.length / 2);
    expect(prod.runtimeFilename).not.toBe(dev.runtimeFilename); // the hash names the shipped bytes
    const prodClient = readFileSync(join(prod.outDir, "app.client.js"), "utf8");
    expect(prodClient).not.toMatch(/^\s*\/\//m);

    const a = drive(dev.outDir);
    const b = drive(prod.outDir);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    // Non-trivial: the interaction script really added and filtered todos.
    expect(a.out[0].items).toBe(3);
    expect(a.out[0].texts).toEqual(["alpha", "beta", "gamma"]);
    expect(a.out[1].count).toBe("2 items left"); // the toggle landed
    expect(a.out[2].items).toBe(2); // #/active filtered
    expect(a.out[3].items).toBe(1); // #/completed filtered
    if (process.env.S459_PRINT) console.log(JSON.stringify(a.out));
    expect(b.out).toEqual(a.out);
  });
});
