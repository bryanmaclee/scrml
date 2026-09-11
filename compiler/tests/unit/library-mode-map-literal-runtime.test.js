/* SPDX-License-Identifier: MIT
 *
 * Unit — g-map-literal-in-fn-body-does-not-lower-in-library-mode (S412).
 *
 * A §59 map literal in a `fn` body compiled clean under `mode:"browser"` and failed
 * `E-CODEGEN-INVALID-LOGIC` under `mode:"library"`. The lowering was never missing —
 * `emitLibraryFnMember` lowers the literal correctly to `_scrml_map_from_entries(…)`.
 * What was missing was the RUNTIME: `LIB_RUNTIME_HELPERS` carried three helpers, so
 * `unmetRuntimeHelperRefs` reported `_scrml_map_from_entries` unmet, the last gate
 * discarded the correct emit, and the fn fell back to the raw path — where the
 * verbatim `["k": 1]` is not valid JS and trips the §2.2.1 emit gate.
 *
 * The fix reuses the SAME marker-delimited slice of `runtime-template.js` that
 * `emit-server.ts` already injects (`SERVER_VALUE_NATIVE_MAP_HELPER`), gated on the
 * same `/_scrml_map_[a-z]/` reachability probe, so there is one source of truth and
 * no hand-copied runtime to drift.
 *
 * ⚑ THE BRACKET-READ NEGATIVES BELOW ARE THE LOAD-BEARING HALF. §59.6's read
 * lowering (`emitIndex`) fires only on the client/server boundary, so on the library
 * path `m["k"]` emits a RAW property access. Shipping the runtime WITHOUT the guard
 * would make such a fn compile clean, export, and return `undefined` — silent-wrong,
 * which this file's own `rawFallbackReason` already ruled is strictly worse than the
 * raw path's honest failure. A map-READING fn must therefore still fail LOUDLY.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
function emit(source, name, mode) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "lib-map-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.${mode}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode,
    write: true, verbose: false, log: () => {},
  });
  let js = "";
  let artifact = null;
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) { js += readFileSync(join(outDir, f), "utf8"); artifact = join(outDir, f); }
    }
  } catch { /* no artifact */ }
  return { js, artifact, errors: r.errors || [] };
}

const CONSTRUCT_ONLY = `\${
  export fn realMap() { let m = ["k": 1, "j": 2]; return m }
  export fn emptyMap() { let m = [:]; return m }
}`;

describe("a §59 map literal lowers in library mode (S412)", () => {
  test("the reported shape compiles clean under mode:library", () => {
    const { errors } = emit(CONSTRUCT_ONLY, "construct", "library");
    expect(errors.map((e) => e.code)).toEqual([]);
  });

  test("CONTROL — the same source was always clean under mode:browser", () => {
    const { errors } = emit(CONSTRUCT_ONLY, "construct-browser", "browser");
    expect(errors.map((e) => e.code)).toEqual([]);
  });

  test("the literal is LOWERED, not shipped verbatim", () => {
    const { js } = emit(CONSTRUCT_ONLY, "lowered", "library");
    expect(js).toContain("_scrml_map_from_entries(");
    // The raw scrml map literal must NOT survive into the importable module.
    expect(js).not.toContain(`["k": 1`);
  });

  test("the map runtime TRAVELS with the module (not just a reference to it)", () => {
    const { js } = emit(CONSTRUCT_ONLY, "runtime-travels", "library");
    // A reference without a definition is a ReferenceError at import time — the
    // exact failure `LIB_RUNTIME_HELPERS` exists to prevent.
    expect(js).toContain("function _scrml_map_from_entries(");
    expect(js).toContain("function _scrml_map_insert(");
  });

  // --- the gate that matters: it has to RUN, not merely parse -------------------
  test("⚑ RUNTIME-VERIFY — the emitted module imports and returns real tagged maps", async () => {
    const { artifact, errors } = emit(CONSTRUCT_ONLY, "runtime-verify", "library");
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(artifact).not.toBeNull();
    const mod = await import(pathToFileURL(artifact).href);
    // A green compile proves the module PARSES. Only calling it proves the runtime
    // it needs actually travelled with it.
    expect(mod.realMap().__scrml_map).toBe(true);
    expect(mod.emptyMap().__scrml_map).toBe(true);
  });

  // --- NEGATIVES: the half that is NOT fixed must stay LOUD ---------------------
  test("NEGATIVE — a map bracket-READ still fails loudly rather than returning undefined", () => {
    // §59.6's read lowering does not reach the library boundary, so routing this fn
    // would emit `return m["k"]` on a HAMT node => undefined. Silent-wrong is worse
    // than failing; it must stay on the raw path.
    const { errors } = emit(
      `\${\n  export fn readBack() { let m = ["k": 7]; return m["k"] }\n}`,
      "bracket-read",
      "library",
    );
    expect(errors.map((e) => e.code)).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("NEGATIVE — a map-free fn is untouched by the map-runtime gate", () => {
    const { js, errors } = emit(
      `\${\n  export fn plain(a, b) { return a + b }\n}`,
      "no-map",
      "library",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    // On-use: a module that lowers no map literal carries none of the 512-line slice.
    expect(js).not.toContain("_scrml_map_from_entries");
    expect(js).not.toContain("function _scrml_hamt_put(");
  });

  test("NEGATIVE — an ARRAY index read on a map-free fn still routes (the guard is narrow)", () => {
    // `containsIndexExpr` is consulted ONLY for a map-bearing emit. An ordinary
    // array index in a map-free fn must not be pushed onto the raw path by it.
    const { js, errors } = emit(
      `\${\n  export fn firstOf(xs) { return xs[0] }\n}`,
      "array-index",
      "library",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toContain("export function firstOf");
  });
});
