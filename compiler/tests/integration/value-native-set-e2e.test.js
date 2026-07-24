/* SPDX-License-Identifier: MIT
 *
 * §59.12 — value-native SET (`set[K]`, B2 map-alias) END-TO-END integration.
 *
 * A set is a THIN DESUGAR over the §59 value-native map: `set[K]` lowers to the
 * map `[K: bool]` with a fixed `true` membership marker (never author-visible).
 * This compiles a real .scrml file exercising the FULL set surface and asserts:
 *   - NO codegen errors; the emitted client JS is valid JS (vm.Script)
 *   - each set spelling lowers to the right runtime call:
 *       .add(k)        → _scrml_map_insert(s, k, true)
 *       .has(k)        → _scrml_map_has         (shared map surface)
 *       .remove(k)     → _scrml_map_remove      (shared map surface)
 *       .size          → _scrml_map_size        (shared map surface)
 *       .elements()    → _scrml_map_keys
 *       <each in=@s>   → _scrml_map_keys         (bare-set iteration = elements)
 *       .union/.intersect/.difference → _scrml_stdlib.data.{union,intersection,
 *                        difference} rebuilt into a set
 *   - the `map` chunk AND the `stdlib-data` chunk survive tree-shaking
 *   - the operations produce CORRECT results at runtime (membership, dedup-by-
 *     construction, struct-element value-correctness, algebra agreeing with the
 *     scrml:data helpers, order-independent ==).
 *
 * Mirrors value-native-map-e2e-d4.test.js (the §59 map e2e harness).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "set-e2e-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const SRC = `<div class="tags">
    \${
        <tags>: set[string] = [:]
        <other>: set[string] = [:]
        function addTag() {
            @tags = @tags.add("urgent")
            @tags = @tags.add("urgent")
            @tags = @tags.add("review")
        }
        function dropTag() {
            @tags = @tags.remove("urgent")
        }
        const <merged>: set[string] = @tags.union(@other)
        const <common>: set[string] = @tags.intersect(@other)
        const <onlyTags>: set[string] = @tags.difference(@other)
    }
    <p>Count: \${@tags.size}</>
    <p>Has urgent: \${@tags.has("urgent")}</>
    <p>Merged: \${@merged.size}</>
    <ul>
        <each in=@tags as t>
            <li>\${t}</li>
        </each>
    </ul>
    <ul>
        <each in=@tags.elements() as e>
            <li>\${e}</li>
        </each>
    </ul>
    <button onclick=addTag()>Add</>
    <button onclick=dropTag()>Drop</>
</div>`;

function compileSample() {
  const filePath = join(TMP, "tags.scrml");
  writeFileSync(filePath, SRC);
  const outDir = join(TMP, "dist");
  const result = compileScrml({ inputFiles: [filePath], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors || []).filter(e => e.severity == null || e.severity === "error");
  const clientJs = readFileSync(join(outDir, "tags.client.js"), "utf8");
  const runtimeFile = readdirSync(outDir).find(f => f.startsWith("scrml-runtime."));
  const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
  return { errors, clientJs, runtimeJs };
}

describe("§59.12 value-native set — END-TO-END", () => {
  let out;
  beforeAll(() => { out = compileSample(); });

  test("compiles with NO codegen errors", () => {
    expect(out.errors).toEqual([]);
  });

  test("emitted client JS is syntactically valid", () => {
    expect(() => new vm.Script(out.clientJs)).not.toThrow();
  });

  test("emitted runtime JS is syntactically valid", () => {
    expect(() => new vm.Script(out.runtimeJs)).not.toThrow();
  });

  test("empty set literal [:] lowers to _scrml_map_from_entries([], false)", () => {
    expect(out.clientJs).toContain("_scrml_map_from_entries([], false)");
  });

  test(".add(k) lowers to _scrml_map_insert(_, k, true) (the membership marker)", () => {
    expect(out.clientJs).toMatch(/_scrml_map_insert\(_scrml_reactive_get\("tags"\), "urgent", true\)/);
  });

  test(".remove(k) lowers to _scrml_map_remove (shared map surface)", () => {
    expect(out.clientJs).toMatch(/_scrml_map_remove\(_scrml_reactive_get\("tags"\), "urgent"\)/);
  });

  test(".size lowers to _scrml_map_size; .has lowers to _scrml_map_has", () => {
    expect(out.clientJs).toContain('_scrml_map_size(_scrml_reactive_get("tags"))');
    expect(out.clientJs).toContain('_scrml_map_has(_scrml_reactive_get("tags"), "urgent")');
  });

  test("bare <each in=@s> iterates the ELEMENTS via _scrml_map_keys", () => {
    expect(out.clientJs).toContain('_scrml_map_keys(_scrml_reactive_get("tags"))');
  });

  test(".union/.intersect/.difference delegate to _scrml_stdlib.data + rebuild a set", () => {
    expect(out.clientJs).toMatch(/_scrml_stdlib\.data\.union\(_scrml_map_keys\(_scrml_reactive_get\("tags"\)\), _scrml_map_keys\(_scrml_reactive_get\("other"\)\)\)/);
    expect(out.clientJs).toContain("_scrml_stdlib.data.intersection(");
    expect(out.clientJs).toContain("_scrml_stdlib.data.difference(");
    // rebuilds a set: each result element → [k, true] → _scrml_map_from_entries
    expect(out.clientJs).toMatch(/\.map\(function\(_e\) \{ return \[_e, true\]; \}\), false\)/);
  });

  test("the 'map' AND 'stdlib-data' runtime chunks SURVIVE tree-shaking", () => {
    expect(out.runtimeJs).toContain("function _scrml_map_insert");
    expect(out.runtimeJs).toContain("function _scrml_map_keys");
    expect(out.runtimeJs).toContain("function _scrml_value_canonical");
    expect(out.runtimeJs).toContain("_scrml_stdlib.data");
  });

  test("set operations produce CORRECT results at runtime", () => {
    // Extract the brace-matched top-level map helpers.
    function extractFn(src, name) {
      const i = src.indexOf("function " + name + "(");
      if (i < 0) return "";
      let depth = 0, k = src.indexOf("{", i);
      for (; k < src.length; k++) {
        if (src[k] === "{") depth++;
        else if (src[k] === "}") { depth--; if (depth === 0) { k++; break; } }
      }
      return src.slice(i, k) + "\n";
    }
    // Extract the `_scrml_stdlib.data = (function(){…})();` IIFE assignment.
    function extractStdlibData(src) {
      const marker = "_scrml_stdlib.data = (function";
      const i = src.indexOf(marker);
      if (i < 0) return "";
      let depth = 0, k = src.indexOf("{", i), started = false;
      for (; k < src.length; k++) {
        if (src[k] === "{") { depth++; started = true; }
        else if (src[k] === "}") { depth--; if (started && depth === 0) { k++; break; } }
      }
      // include the trailing `)();`
      let tail = src.slice(k);
      const semi = tail.indexOf(";");
      return src.slice(i, k) + tail.slice(0, semi + 1) + "\n";
    }
    // Full §59 map runtime helper set (HAMT representation, ss38). Set methods
    // desugar onto the map surface, so the whole set is listed for robustness.
    const names = [
      "_scrml_fnv1a", "_scrml_value_canonical",
      "_scrml_map_hash", "_scrml_popcount", "_scrml_map_is_leaf",
      "_scrml_hamt_find", "_scrml_hamt_merge_leaves", "_scrml_hamt_put_collision",
      "_scrml_hamt_put", "_scrml_hamt_remove", "_scrml_hamt_collect",
      "_scrml_map_leaves", "_scrml_map_leaves_ordered", "_scrml_map_define_entries",
      "_scrml_map_new", "_scrml_map_empty", "_scrml_map_from_entries",
      "_scrml_map_get", "_scrml_map_has", "_scrml_map_get_or",
      "_scrml_map_insert", "_scrml_map_remove", "_scrml_map_update", "_scrml_map_insert_all",
      "_scrml_map_size", "_scrml_map_keys", "_scrml_map_values", "_scrml_map_entries",
      "_scrml_map_sorted", "_scrml_map_sorted_by",
    ];
    let bundle = "var _scrml_stdlib = {};\n";
    for (const n of names) bundle += extractFn(out.runtimeJs, n);
    bundle += extractStdlibData(out.runtimeJs);
    bundle += "return { " + names.join(", ") + ", data: _scrml_stdlib.data };";
    const h = new Function(bundle)();

    // --- the desugar helpers as the codegen emits them ---
    const add = (s, k) => h._scrml_map_insert(s, k, true);
    const has = (s, k) => h._scrml_map_has(s, k);
    const remove = (s, k) => h._scrml_map_remove(s, k);
    const size = (s) => h._scrml_map_size(s);
    const elements = (s) => h._scrml_map_keys(s);
    const setFromArr = (arr) => h._scrml_map_from_entries(arr.map((e) => [e, true]), false);
    const union = (a, b) => setFromArr(h.data.union(elements(a), elements(b)));
    const intersect = (a, b) => setFromArr(h.data.intersection(elements(a), elements(b)));
    const difference = (a, b) => setFromArr(h.data.difference(elements(a), elements(b)));

    // membership + dedup-by-construction
    let s = h._scrml_map_from_entries([], false);
    expect(size(s)).toBe(0);
    s = add(s, "urgent");
    s = add(s, "urgent"); // duplicate add — set stays size 1
    s = add(s, "review");
    expect(size(s)).toBe(2);
    expect(has(s, "urgent")).toBe(true);
    expect(has(s, "nope")).toBe(false);
    expect(elements(s).sort()).toEqual(["review", "urgent"]);

    // remove (COW — original unchanged)
    const s2 = remove(s, "urgent");
    expect(has(s2, "urgent")).toBe(false);
    expect(has(s, "urgent")).toBe(true); // @s = @s.add(k) COW: original immutable
    expect(size(s2)).toBe(1);

    // struct-element value-correctness (the map's structural key-hash)
    let sp = h._scrml_map_from_entries([], false);
    sp = add(sp, { id: 1, lane: "DAL" });
    sp = add(sp, { id: 1, lane: "DAL" }); // value-equal struct — dedups
    sp = add(sp, { id: 2, lane: "HOU" });
    expect(size(sp)).toBe(2);
    expect(has(sp, { id: 1, lane: "DAL" })).toBe(true); // found by VALUE
    expect(has(sp, { id: 9, lane: "DAL" })).toBe(false);

    // algebra agrees with the scrml:data helpers
    let a = setFromArr(["urgent", "review"]);
    let b = setFromArr(["review", "backlog"]);
    expect(elements(union(a, b)).sort()).toEqual(["backlog", "review", "urgent"]);
    expect(elements(intersect(a, b)).sort()).toEqual(["review"]);
    expect(elements(difference(a, b)).sort()).toEqual(["urgent"]);

    // order-independent == (falls out of map ==): {a,b} == {b,a}
    const x = add(add(h._scrml_map_from_entries([], false), "a"), "b");
    const y = add(add(h._scrml_map_from_entries([], false), "b"), "a");
    // structural equality: same elements regardless of insertion order
    expect(elements(x).sort()).toEqual(elements(y).sort());
    expect(size(x)).toBe(size(y));
  });
});
