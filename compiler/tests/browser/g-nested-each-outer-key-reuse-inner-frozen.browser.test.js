/**
 * g-nested-each-outer-key-reuse-inner-frozen.browser.test.js
 *
 * Regression gate for change-id `ss17-each-peritem-emitter-2026-06-25` ITEM 3
 * (g-nested-each-outer-key-reuse-inner-frozen, Bug-72 / S212 Approach-C residual).
 *
 * BUG: a NESTED `<each in=@.subitems>` inside an OUTER `<each>` was emitted with a
 * per-item `_scrml_effect` (the S212 Approach-C subscription fix) whose source-read
 * `const items = g.subitems` read the OUTER iter var off the CREATE-TIME factory
 * closure — never re-resolved by key. So when the OUTER row node is REUSED on a
 * keyed reconcile (same outer key) AND the outer item's iterated field changes
 * (array-replace / push into @.subitems), the inner `<each>` stayed FROZEN at the
 * create-time outer value. (Distinct from S212 g-nested-each-no-own-subscription,
 * which had NO subscription at all; THIS is reuse-not-rebound.)
 *
 * FIX (emit-each.ts): inject the outer-item live-keying prelude
 * (`let g = _scrml_resolve_item(<outerMount>, <outerKey>); if (g === null) return;`)
 * into the inner-each `_scrml_effect` body, using the OUTER reconcile ctx, so the
 * source read hits the LIVE outer item. _scrml_resolve_item tracks the outer
 * mount's item slot, so the outer reconcile re-fires the inner effect.
 *
 * Runtime gate (S140/S152 lesson): drives a same-key outer REPLACE + an in-place
 * push and asserts the inner list re-renders. Pre-fix the inner list stays frozen.
 *
 * Models: g-nested-each-no-own-subscription.browser.test.js (same machinery,
 * exercising REUSE rather than fresh inner mounts).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// Outer each keyed on g.id; inner each over the outer item's OWN field @.subitems.
const SRC = `<program>
type Group:struct = { id: string, name: string, subitems: string[] }
<groups>: Group[] = []
<ul>
  <each in=@groups as g key=g.id>
    <li>
      <h3>${DOLLAR}{g.name}</h3>
      <each in=@.subitems as s key=s><span class="sub">${DOLLAR}{s}</span></each>
    </li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-nested-each-outer-reuse-item3");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-nested-each-outer-key-reuse-inner-frozen — item3 (S212 Approach-C residual)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      outerLis: () => [...document.querySelectorAll("li")],
      subs: () => [...document.querySelectorAll("span.sub")].map((n) => n.textContent.trim()),
    };
  }

  test("THE bug: same-key outer REPLACE with new subitems re-renders the inner list", () => {
    const app = mount(SRC, "outer-replace");
    app.set("groups", [{ id: "g1", name: "G1", subitems: ["a", "b"] }]);
    expect(app.subs()).toEqual(["a", "b"]);
    const before = app.outerLis();

    // SAME outer key (g1), NEW subitems — forces OUTER-ROW REUSE.
    app.set("groups", [{ id: "g1", name: "G1", subitems: ["x", "y", "z"] }]);
    const after = app.outerLis();
    // The outer <li> node was REUSED (same key) — a stale create-time closure bites.
    expect(after[0]).toBe(before[0]);
    // Pre-fix the inner list stays ["a","b"]; post-fix it re-renders.
    expect(app.subs()).toEqual(["x", "y", "z"]);
  });

  test("in-place push into the outer item's subitems re-renders the inner list", () => {
    const app = mount(SRC, "inplace-push");
    app.set("groups", [{ id: "g1", name: "G1", subitems: ["a", "b"] }]);
    expect(app.subs()).toEqual(["a", "b"]);
    const live = app.get("groups");
    live[0].subitems.push("c");
    expect(app.subs()).toEqual(["a", "b", "c"]);
  });

  test("two outer rows: a same-key replace of ONE row updates only its inner list", () => {
    const app = mount(SRC, "two-rows");
    app.set("groups", [
      { id: "g1", name: "G1", subitems: ["a"] },
      { id: "g2", name: "G2", subitems: ["m", "n"] },
    ]);
    expect(app.subs()).toEqual(["a", "m", "n"]);
    // Replace the whole array — SAME keys, g1 gets new subitems, g2 unchanged.
    app.set("groups", [
      { id: "g1", name: "G1", subitems: ["a", "b", "c"] },
      { id: "g2", name: "G2", subitems: ["m", "n"] },
    ]);
    expect(app.subs()).toEqual(["a", "b", "c", "m", "n"]);
  });
});
