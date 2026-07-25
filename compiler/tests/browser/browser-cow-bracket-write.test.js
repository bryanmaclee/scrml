/**
 * browser-cow-bracket-write.test.js — cycles-prereq (S168 COW-all bracket-write)
 * happy-dom RUNTIME acceptance.
 *
 * RATIFIED (user, S168): value-cycles are FORBIDDEN; the language must make
 * "acyclic value-data" actually true. `@arr[0] = @arr` was a constructible true
 * self-cycle TODAY — it compiled to a RAW IN-PLACE write against the live
 * backing array, so `arr[0] === arr` survived into the reactive cell.
 *
 * Fix (COW-all): bracket-index WRITES route through `reactive-nested-assign` ->
 * `_scrml_deep_set` (clone-mutate-replace, SPEC §6.5.1). The clone breaks any
 * self-reference into a STALE, ACYCLIC snapshot.
 *
 * `node --check`-clean ≠ correct (S139/S140/S152): the emit-shape proof lives in
 * compiler/tests/unit/cow-bracket-write-emit.test.js. THIS test drives the full
 * DOM-event → handler → reactive-set path and asserts (a) the bracket-write
 * mutation ACTUALLY APPLIES and (b) the self-ref write produces NO live cycle
 * (arr[0] !== arr, JSON.stringify does not throw).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-cow-bracket-write");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const htmlPath = resolve(outDir, `${baseName}.html`);
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  return {
    tmpDir,
    clientPath,
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

function mount(compiled) {
  const { html, clientJs, runtimeJs } = compiled;
  document.documentElement.innerHTML = html;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
  );
  let threw = null;
  try {
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (e) {
    threw = e;
  }
  return {
    threw,
    get: (name) => globalThis.__scrml_get__(name),
    button: (id) => document.getElementById(id),
  };
}

const SET_SRC = `<program>
<arr> = [1, 2, 3]
<sel> = 1
function bump() { @arr[@sel] = 99 }
<button id="go" onclick=bump()>go</button>
</program>`;

const EVIL_SRC = `<program>
<arr> = [1, 2, 3]
function evil() { @arr[0] = @arr }
<button id="evil" onclick=evil()>evil</button>
</program>`;

describe("COW-all bracket-write — RUNTIME (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("compiles clean + emitted client.js passes node --check", () => {
    const compiled = compileToOutputs(SET_SRC, "bump");
    try {
      expect(compiled.errors).toEqual([]);
      expect(() => execFileSync("node", ["--check", compiled.clientPath])).not.toThrow();
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("computed-index write applies: clicking sets arr[1] = 99 (COW reassign)", () => {
    const compiled = compileToOutputs(SET_SRC, "bump");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("arr")).toEqual([1, 2, 3]);
      app.button("go").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(app.get("arr")).toEqual([1, 99, 3]);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("self-ref write `@arr[0] = @arr` produces NO live cycle (stale acyclic snapshot)", () => {
    const compiled = compileToOutputs(EVIL_SRC, "evil");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      app.button("evil").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      const arr = app.get("arr");
      // The COW clone-then-set broke the self-ref: arr[0] is the OLD snapshot,
      // NOT the live array. No cycle survives into the reactive cell.
      expect(arr[0]).not.toBe(arr);
      expect(arr[0]).toEqual([1, 2, 3]);
      // JSON.stringify must terminate (a live cycle would throw).
      expect(() => JSON.stringify(arr)).not.toThrow();
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });
});
