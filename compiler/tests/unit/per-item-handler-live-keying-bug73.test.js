/**
 * per-item-handler-live-keying-bug73.test.js — Bug 73 (S159) emit-shape gate.
 *
 * Sibling-gap #2 of Bug 64. Per-item EVENT HANDLERS in a reconciled list must
 * re-resolve the LIVE item at FIRE TIME (not close over the create-time
 * snapshot). The fix routes the handler body through the existing
 * `_scrml_resolve_item` plumbing: when the handler READS the iter var, the
 * emitted listener body is prefixed with
 *   `let <iterVar> = _scrml_resolve_item(<mount>, <key>); if (<iterVar> === null) return;`
 * so a same-key reconcile fires the handler with live data.
 *
 * These are EMIT-SHAPE assertions (the runtime behavior is gated by
 * each-per-item-handler-live-keying-bug73.browser.test.js). They lock:
 *   - an iter-reading handler emits the resolve-prelude + null-guard INSIDE the
 *     listener, for BOTH tiers (Tier-1 <each>, Tier-0 ${for...lift});
 *   - a GLOBAL handler (reads no item) stays PLAIN (no prelude) — the iter-scope
 *     token scan must not false-wrap it.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileClient(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-bug73-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("bug73 — per-item handler live-keying emit shape", () => {
  // -- Tier-1 <each> --------------------------------------------------------

  test("Tier-1: iter-reading handler emits the resolve-prelude + null-guard inside the listener", () => {
    const src = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = [{ id: "a", name: "Alpha" }]
function pick(nm) { @items = @items }
<ul>
  <each in=@items key=@.id>
    <li onclick=pick(@.name)>\${@.name}</li>
  </each>
</ul>
</program>`;
    const { errors, clientJs } = compileClient(src, "t1-iter");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    // The per-item handler re-resolves the live item by its create-time key,
    // bails on canonical absence (null), THEN calls the handler with the live field.
    expect(clientJs).toMatch(
      /\.addEventListener\("click", function\(event\) \{ let _scrml_each_item = _scrml_resolve_item\(_mount, _scrml_each_key_\d+\); if \(_scrml_each_item === null\) return; _scrml_pick_\d+\(_scrml_each_item\.name\); \}\)/,
    );
  });

  test("Tier-1: a GLOBAL handler (reads no item) stays plain — no resolve-prelude", () => {
    const src = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = [{ id: "a", name: "Alpha" }]
function reorder() { @items = @items }
<ul>
  <each in=@items key=@.id>
    <li onclick=reorder()>\${@.name}</li>
  </each>
</ul>
</program>`;
    const { errors, clientJs } = compileClient(src, "t1-global");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    // The display binding for @.name re-resolves (Bug 64), but the global
    // reorder() handler reads NO item. Tier-1 emits a bare-call global handler as
    // a per-item addEventListener too (NOT delegated), so it MUST stay plain — no
    // resolve-prelude (the iter-scope token scan gates it out).
    expect(clientJs).toMatch(
      /\.addEventListener\("click", function\(event\) \{ _scrml_reorder_\d+\(\); \}\)/,
    );
    expect(clientJs).not.toMatch(
      /_scrml_resolve_item\([^)]*\); if \(_scrml_each_item === null\) return; _scrml_reorder_\d+\(\)/,
    );
  });

  // -- Tier-0 ${for...lift} -------------------------------------------------

  test("Tier-0: iter-reading handler emits the resolve-prelude + null-guard inside the listener", () => {
    const src = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = [{ id: "a", name: "Alpha" }]
function pick(nm) { @items = @items }
<ul>\${
  for (it of @items) {
    lift <li onclick=pick(it.name)>\${it.name}</li>
  }
}</ul>
</program>`;
    const { errors, clientJs } = compileClient(src, "t0-iter");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    expect(clientJs).toMatch(
      /\.addEventListener\("click", function\(event\) \{ let it = _scrml_resolve_item\(_scrml_list_wrapper_\d+, _scrml_item_key_\d+\); if \(it === null\) return; _scrml_pick_\d+\(it\.name\); \}\)/,
    );
  });

  test("Tier-0: a GLOBAL handler (reads no item) stays plain — no resolve-prelude", () => {
    const src = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = [{ id: "a", name: "Alpha" }]
function swap() { @items = @items }
<ul>\${
  for (it of @items) {
    lift <li onclick=swap()>\${it.name}</li>
  }
}</ul>
</program>`;
    const { errors, clientJs } = compileClient(src, "t0-global");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    // The swap() handler reads no item — its listener stays a plain call with no
    // resolve-prelude (the iter-scope token scan gates it out).
    expect(clientJs).toMatch(/\.addEventListener\("click", function\(event\) \{ _scrml_swap_\d+\(\); \}\)/);
    expect(clientJs).not.toMatch(/_scrml_resolve_item\([^)]*\); if \(it === null\) return; _scrml_swap_/);
  });
});
