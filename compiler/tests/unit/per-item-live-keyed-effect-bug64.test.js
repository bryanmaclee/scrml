/**
 * per-item-live-keyed-effect-bug64.test.js — Bug 64 + R28-1c (S159).
 *
 * Unit gate for the EMIT SHAPE of per-item content reactivity on reconcile.
 * Compile-shape assertions (the runtime behavior lives in the happy-dom canary
 * each-per-item-reactivity-bug64.browser.test.js).
 *
 * Both tiers must lower per-item interpolated TEXT and class: bindings into a
 * LIVE-KEYED _scrml_effect: the effect re-resolves the item by its create-time
 * key via _scrml_resolve_item(<container>, <key>), guards `=== null`, then
 * evaluates the binding against the re-bound iter var.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

const tmpRoot = resolve(tmpdir(), "scrml-per-item-live-keyed-unit");

function compileClient(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const TIER0_SRC = `<program>
type Line:struct = { id: string, label: string, active: boolean }
<lines>: Line[] = []
<ul>
  \${ for (line of @lines) {
    lift <li class:on=line.active>\${line.label}</li>
  } }
</ul>
</program>`;

const TIER1_SRC = `<program>
type Line:struct = { id: string, label: string, active: boolean }
<lines>: Line[] = []
<ul>
  <each in=@lines>
    <li class:on=@.active>\${@.label}</li>
  </each>
</ul>
</program>`;

describe("Bug 64 — Tier-0 ${for...lift} per-item bindings are live-keyed", () => {
  test("per-item text + class: both lower to live-keyed _scrml_effect via _scrml_resolve_item", () => {
    const { errors, clientJs } = compileClient(TIER0_SRC, "t0");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    // A per-item key local mirroring the keyFn (id-or-index).
    expect(clientJs).toMatch(/const _scrml_item_key_\d+ = line\?\.id != null \? line\.id : _scrml_idx;/);
    // The class: + text effects re-resolve the item BY KEY and guard === null.
    expect(clientJs).toMatch(/_scrml_resolve_item\(_scrml_list_wrapper_\d+, _scrml_item_key_\d+\)/);
    expect(clientJs).toContain("if (line === null) return;");
    // class: is live-keyed (the toggle lives inside an effect that re-resolves).
    expect(clientJs).toMatch(/_scrml_effect\(\(\) => \{[\s\S]*classList\.toggle\("on", !!\(line\.active\)\)/);
    // text is a stable text node driven by textContent inside the effect.
    expect(clientJs).toMatch(/\.textContent = _scrml_g\.String\(\(line\.label\) \?\? ""\)/);
    // No bare `undefined` keyword leaks (W-CG-UNDEFINED-INTERPOLATION clean).
    expect(clientJs.includes("=== undefined")).toBe(false);
  });
});

describe("R28-1c — Tier-1 <each> per-item bindings are live-keyed (closes sibling-gap #1)", () => {
  test("per-item text + class: both lower to live-keyed _scrml_effect via _scrml_resolve_item", () => {
    const { errors, clientJs } = compileClient(TIER1_SRC, "t1");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    // Per-item key local mirroring the keyFn.
    expect(clientJs).toMatch(/const _scrml_each_key_\d+ = \(_scrml_each_item\?\.id != null \? _scrml_each_item\.id : _scrml_each_idx\);/);
    // Both bindings re-resolve the item by key from the mount + guard === null.
    expect(clientJs).toMatch(/_scrml_resolve_item\(_scrml_mount, _scrml_each_key_\d+\)/);
    expect(clientJs).toContain("if (_scrml_each_item === null) return;");
    // class: is NO LONGER a bare classList.toggle — it lives inside an effect
    // (sibling-gap #1 closed: it was a bare toggle with no reactivity pre-fix).
    expect(clientJs).toMatch(/_scrml_effect\(\(\) => \{[\s\S]*classList\.toggle\("on", !!\(_scrml_each_item\.active\)\)/);
    // text is a stable text node driven by textContent inside the effect.
    expect(clientJs).toMatch(/\.textContent = _scrml_g\.String\(_scrml_each_item\.label\)/);
    expect(clientJs.includes("=== undefined")).toBe(false);
  });
});
