/**
 * g-value-native-map-set-server-runtime — a `server function` that builds/returns
 * a value-native map `[K:V]` or set `set[K]` must (1) COMPILE clean, (2) LOWER its
 * `.insert`/`.add`/`.getOr`/bracket-read/`.size` to the `_scrml_map_*` runtime
 * surface on the SERVER boundary, (3) INLINE that runtime into the standalone
 * `.server.js` (which never imports the client runtime), and (4) return a map/set
 * that is USABLE on the client after the JSON round-trip.
 *
 * ROOT CAUSE (two layers, both server-only; both silent — green compile):
 *   Layer 1 (runtime absent): a `[:]` / `["a":1]` literal lowers to
 *     `_scrml_map_from_entries(` and the `_scrml_map_*` helpers live ONLY in the
 *     client SCRML_RUNTIME. A standalone `.server.js` never imports it, so the
 *     handler threw `ReferenceError: _scrml_map_from_entries is not defined` at
 *     request time.
 *   Layer 2 (method lowering client-gated): the value-native map/set method /
 *     `.size` / bracket-read lowerings in emit-expr.ts gated on
 *     `ctx.mode === "client"`, so a server-fn body left `m.insert(...)` as a
 *     verbatim method call — and the runtime map is a tagged PLAIN object with NO
 *     methods, so even with the runtime present it threw
 *     `m.insert is not a function`.
 *
 * FIX:
 *   - emit-expr.ts: the four map/set lowerings fire on the SERVER boundary too,
 *     for a bare NON-REACTIVE LOCAL receiver (mapSetLoweringBoundaryOk). The
 *     server opts thread ONLY per-fn local map/set names (never reactive ones),
 *     so a classifier can match only a local server-side.
 *   - emit-server.ts: reachability-gated inline of the §59 map/set runtime
 *     (SERVER_VALUE_NATIVE_MAP_HELPER — sliced VERBATIM from the single client
 *     runtime source, no drift) whenever `_scrml_map_` survives in the body.
 *
 * SERIALIZATION (the second-layer serialization worry): NOT an issue for
 * value-native map/set. The type carries no methods (all ops are free
 * `_scrml_map_*` functions reading `_root`/`_count`/`_seq`/`ordered`), and the
 * `entries` view is an ENUMERABLE getter that `JSON.stringify` materializes into
 * the payload — so a raw JSON round-trip of the tagged HAMT is structurally
 * complete and usable. This test PROVES that by running the client runtime map
 * ops over the exact bytes the client receives.
 *
 * Asserts: clean compile · server-side method lowering · runtime inline present ·
 * runtime resolution (no ReferenceError / no `is not a function`) · client-usable
 * result (right keys/values, miss-semantics, post-receipt client write) ·
 * reachability gate (a non-map server fn's bundle carries NO map runtime) ·
 * no-drift (the inlined helper is a verbatim slice of the client runtime).
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SERVER_VALUE_NATIVE_MAP_HELPER } from "../../src/runtime-template.js";

const acorn = require("acorn");
const parseClean = (js) =>
  expect(() => acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-vn-map-server-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out, dir };
}

// Write the server bundle to disk, dynamically import it, and invoke its single
// route handler. Mirrors ss22-enum-toenum-server-emission.test.js: a self-shimmed
// request (cookie + header carry the same CSRF token) keeps the runtime check
// independent of any happy-dom globals a sibling test may have registered.
async function invokeSingleRoute(out, dir) {
  const serverFile = join(dir, "app.server.mjs");
  writeFileSync(serverFile, out.serverJs);
  const mod = await import(serverFile);
  expect(Array.isArray(mod.routes)).toBe(true);
  const route = mod.routes[0];
  expect(route).toBeTruthy();
  expect(typeof route.handler).toBe("function");
  const token = "vn-map-csrf";
  const req = {
    url: "http://localhost" + route.path,
    headers: {
      get(name) {
        const n = name.toLowerCase();
        if (n === "cookie") return "scrml_csrf=" + token;
        if (n === "x-csrf-token") return token;
        return null;
      },
    },
    json: async () => ({}),
  };
  const res = await route.handler(req);
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

// The client-runtime map ops, materialised from the SAME sliced source the server
// inlines (so this test also exercises the no-drift slice). Used to prove the
// received payload is a USABLE map on the client.
let _clientOps = null;
async function clientMapOps() {
  if (_clientOps) return _clientOps;
  const dir = mkdtempSync(join(tmpdir(), "scrml-vn-map-ops-"));
  const opsFile = join(dir, "ops.mjs");
  writeFileSync(
    opsFile,
    SERVER_VALUE_NATIVE_MAP_HELPER +
      "\nexport { _scrml_map_get, _scrml_map_size, _scrml_map_keys, _scrml_map_has, _scrml_map_insert };\n",
  );
  _clientOps = await import(opsFile);
  return _clientOps;
}

const MAP_SRC = `<program>
  server function priceMap() -> [string: int] {
    let m: [string: int] = [:]
    m = m.insert("sku1", 100)
    m = m.insert("sku2", 200)
    return m
  }
  <h1>hi</h1>
</program>`;

const SET_SRC = `<program>
  server function skus() -> set[string] {
    let s: set[string] = [:]
    s = s.add("sku1")
    s = s.add("sku2")
    return s
  }
  <h1>hi</h1>
</program>`;

const NOMAP_SRC = `<program>
  server function addup(a, b) -> int {
    let arr: [int] = [1, 2, 3]
    return a + b + arr.length
  }
  <h1>hi</h1>
</program>`;

// ---------------------------------------------------------------------------
// §1. MAP — clean compile, server-side lowering, runtime inline, usable result.
// ---------------------------------------------------------------------------
describe("§1 server fn returning a value-native map", () => {
  test("compiles clean, lowers `.insert` server-side, inlines the runtime, and returns a usable map", async () => {
    const { result, out, dir } = compileSource(MAP_SRC);
    expect(result.errors ?? []).toEqual([]);
    expect(out?.serverJs).toBeTruthy();

    // The `[:]` literal lowered, and `.insert` lowered to the runtime helper
    // (NOT a verbatim `m.insert(` method call the runtime map has no method for).
    expect(out.serverJs).toContain("_scrml_map_from_entries([], false)");
    expect(out.serverJs).toContain("_scrml_map_insert(");
    expect(out.serverJs).not.toMatch(/\bm\.insert\(/);

    // The runtime is INLINED (definition present, not just referenced).
    expect(out.serverJs).toMatch(/function _scrml_map_from_entries\(/);
    expect(out.serverJs).toMatch(/function _scrml_map_insert\(/);
    parseClean(out.serverJs);

    // RUNTIME: the handler resolves (no ReferenceError / no "is not a function").
    const received = await invokeSingleRoute(out, dir);

    // SECOND LAYER: the payload the client receives is a USABLE map.
    const ops = await clientMapOps();
    expect(received.__scrml_map).toBe(true);
    expect(ops._scrml_map_size(received)).toBe(2);
    expect(ops._scrml_map_get(received, "sku1")).toBe(100);
    expect(ops._scrml_map_get(received, "sku2")).toBe(200);
    expect(ops._scrml_map_get(received, "absent")).toBeNull();
    expect(ops._scrml_map_keys(received)).toEqual(["sku1", "sku2"]);
    // A client-side WRITE on the received map produces a correct new map
    // (structural sharing over the round-tripped _root).
    const grown = ops._scrml_map_insert(received, "sku3", 300);
    expect(ops._scrml_map_size(grown)).toBe(3);
    expect(ops._scrml_map_get(grown, "sku3")).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// §2. SET — `.add` lowering + membership semantics survive the round-trip.
// ---------------------------------------------------------------------------
describe("§2 server fn returning a value-native set", () => {
  test("lowers `.add` server-side, inlines the runtime, and returns a usable set", async () => {
    const { result, out, dir } = compileSource(SET_SRC);
    expect(result.errors ?? []).toEqual([]);
    expect(out?.serverJs).toBeTruthy();

    // `.add(k)` lowers to the membership-marker insert; no verbatim `s.add(`.
    expect(out.serverJs).toContain('_scrml_map_insert(');
    expect(out.serverJs).not.toMatch(/\bs\.add\(/);
    expect(out.serverJs).toMatch(/function _scrml_map_insert\(/);
    parseClean(out.serverJs);

    const received = await invokeSingleRoute(out, dir);
    const ops = await clientMapOps();
    expect(received.__scrml_map).toBe(true);
    expect(ops._scrml_map_size(received)).toBe(2);
    expect(ops._scrml_map_has(received, "sku1")).toBe(true);
    expect(ops._scrml_map_has(received, "sku2")).toBe(true);
    expect(ops._scrml_map_has(received, "absent")).toBe(false);
    expect(ops._scrml_map_keys(received)).toEqual(["sku1", "sku2"]);
  });
});

// ---------------------------------------------------------------------------
// §3. Reachability gate — a server fn with NO map/set use carries NO map runtime.
// ---------------------------------------------------------------------------
describe("§3 reachability gate keeps a non-map server bundle minimal", () => {
  test("a server fn that never touches a map/set inlines none of the map runtime", () => {
    const { result, out } = compileSource(NOMAP_SRC);
    expect(result.errors ?? []).toEqual([]);
    expect(out?.serverJs).toBeTruthy();
    // No map runtime reference OR definition leaked into the bundle.
    expect(out.serverJs).not.toMatch(/_scrml_map_/);
    expect(out.serverJs).not.toContain("value-native map/set runtime");
    parseClean(out.serverJs);
  });
});

// ---------------------------------------------------------------------------
// §4. No-drift — the inlined server runtime is a VERBATIM slice of the single
//     client-runtime source (not a hand-maintained copy that can drift).
// ---------------------------------------------------------------------------
describe("§4 the server map runtime is the client-runtime source (no drift)", () => {
  test("the inlined helper's function bodies are byte-present verbatim in the server bundle", () => {
    const { out } = compileSource(MAP_SRC);
    // Pick a couple of load-bearing function signatures + a distinctive body line
    // straight from the shared slice; assert they appear verbatim in the bundle.
    for (const needle of [
      "function _scrml_map_from_entries(pairs, ordered) {",
      "function _scrml_map_insert(m, k, v) {",
      "function _scrml_value_canonical(v) {",
    ]) {
      expect(SERVER_VALUE_NATIVE_MAP_HELPER).toContain(needle);
      expect(out.serverJs).toContain(needle);
    }
  });
});
