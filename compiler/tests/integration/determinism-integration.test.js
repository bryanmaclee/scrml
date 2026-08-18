/**
 * A-5.5 — cross-wave determinism end-to-end (Family F-3).
 *
 * Final integration sub-phase of the A-5 wave (last Approach A
 * sub-wave; v0.3.0 critical path). Verifies that the closure-analysis
 * pipeline (Stage 7.55 AG → Stage 7.6 RS → Stage 8 CG splitter)
 * preserves §47 content-addressing + R1-R4 recoverability END-TO-END
 * by running `compileScrml` twice on the same source and asserting
 * BIT-IDENTICAL output across every observable surface:
 *
 *   1. chunks.json manifest (canonical-JSON serialization, §40.9.8).
 *   2. per-chunk payloadJs (route-splitter emit determinism).
 *   3. per-chunk filename + FNV-1a 32-bit base36 hash (§47.1.3).
 *   4. per-route HTML (HTML augmentation determinism, A-4.7).
 *   5. reachability.json (canonical comparator + stable role/EP order,
 *      §40.9.8 + A-2.8).
 *   6. determinism under explicit chunkSizeBudgetBytes (Q-OPEN-5
 *      plumbing) — same source + same budget → same bytes.
 *   7. determinism across consecutive consecutive runs (10 runs)
 *      — guards against latent insertion-order non-determinism in
 *      Map iterations / property-key iteration / RNG-tainted JS.
 *
 * Reuses FX-1 cornerstone fixture per the SCOPING dive ("no new
 * fixtures needed"); see `multipage-multirole-integration.test.js` §11
 * for the in-fixture determinism assertions covering chunks/HTML, this
 * file extends the reach to (a) reachabilityRecord canonical JSON,
 * (b) explicit budget plumbing, (c) higher-N replay defence.
 *
 * Family F-3; underwrites §40.9.8 normative claim:
 *   "All inputs to playable_surface(E, N) are STATIC ... The output is
 *    therefore deterministic-from-source-only: same source produces
 *    same closure produces same chunk assignments produces same
 *    content addresses."
 *
 * Spec authority:
 *   - SPEC.md §40.9.8 (line 17800) — Determinism preservation +
 *     R1-R4 recoverability anchor.
 *   - SPEC.md §47.1.3 (line 18973) — FNV-1a 32-bit base36 hash;
 *     pure function of canonical-string normalization, no time/RNG.
 *   - SPEC.md §47.1.4 — Canonical String Normalization.
 *   - SPEC.md §47.5 — Output Name Encoding scope.
 *
 * SCOPING: scrml-support/docs/deep-dives/a-5-integration-tests-SCOPING-2026-05-14.md
 *   §3.1 family F-3 + §4.2 A-5.5 sub-phase.
 *
 * Note on the `compiler` field:
 *   chunks.json's `compiler` field sources from package.json (Q-OPEN-4).
 *   The field is stable across all compiles in the same test run because
 *   package.json is not mutated. We therefore expect chunks.json byte-
 *   identity unconditionally; if you ever see this assertion fail with
 *   a `compiler` field diff, check whether some other test mutated
 *   package.json in the same run.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml, compareInputPathsCanonical } from "../../src/api.js";

// ---------------------------------------------------------------------------
// FX-1 fixture reuse (cornerstone — `multipage-multirole/routes/{index, loads, admin}.scrml`)
// ---------------------------------------------------------------------------

const FX1_DIR = join(
  import.meta.dir,
  "fixtures",
  "a5",
  "multipage-multirole",
);
const FX1_INDEX = join(FX1_DIR, "routes", "index.scrml");
const FX1_LOADS = join(FX1_DIR, "routes", "loads.scrml");
const FX1_ADMIN = join(FX1_DIR, "routes", "admin.scrml");
const FX1_INPUTS = [FX1_INDEX, FX1_LOADS, FX1_ADMIN];

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "a5-determinism-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileFx1(extraOptions = {}) {
  return compileScrml({
    inputFiles: FX1_INPUTS,
    outputDir: join(TMP, "dist"),
    write: false,
    emitPerRoute: true,
    log: () => {},
    ...extraOptions,
  });
}

/**
 * Cross-stream helper. Combines `result.errors` and `result.warnings`
 * into one array. Required when filtering by a `W-*` (or `I-*`) code,
 * because api.js:1674-1675 partitions the diagnostic stream:
 *
 *   result.errors   = !code.startsWith("W-") AND severity !== "warning"
 *   result.warnings = code.startsWith("W-")  OR severity === "warning"
 *
 * Matches A-5.3 / A-5.4 / A-5.1 (post-fix) helper convention.
 */
function allDiags(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}

// ---------------------------------------------------------------------------
// §1 — chunks.json byte-identity (canonical-JSON serialization, §40.9.8)
// ---------------------------------------------------------------------------

describe("FX-1 — chunks.json byte-identity across compiles", () => {
  test("two compileScrml invocations produce byte-identical chunksManifestJson()", () => {
    const a = compileFx1();
    const b = compileFx1();
    const ja = a.chunksManifestJson();
    const jb = b.chunksManifestJson();
    // Direct string equality — chunks.json serialization is canonical
    // (object keys sorted, deterministic indentation per §40.9.8).
    expect(ja).toBe(jb);
  });

  test("manifest entryPoints object key order is stable across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    const epKeysA = Object.keys(a.chunksManifest.entryPoints);
    const epKeysB = Object.keys(b.chunksManifest.entryPoints);
    expect(epKeysA).toEqual(epKeysB);
  });

  test("per-EP role key order is stable across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    for (const epId of Object.keys(a.chunksManifest.entryPoints)) {
      const rolesA = Object.keys(a.chunksManifest.entryPoints[epId]);
      const rolesB = Object.keys(b.chunksManifest.entryPoints[epId]);
      expect(rolesA).toEqual(rolesB);
    }
  });

  test("manifest version + compiler fields are stable across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    expect(a.chunksManifest.version).toBe(b.chunksManifest.version);
    // The `compiler` field sources from package.json (Q-OPEN-4); stable
    // because the test run does not mutate package.json.
    expect(a.chunksManifest.compiler).toBe(b.chunksManifest.compiler);
  });
});

// ---------------------------------------------------------------------------
// §2 — Per-chunk payloadJs + filename + FNV-1a hash byte-identity
// ---------------------------------------------------------------------------

describe("FX-1 — per-chunk payloadJs + filename + hash byte-identity", () => {
  test("two compiles emit the same set of chunk keys", () => {
    const a = compileFx1();
    const b = compileFx1();
    const keysA = [...a.chunks.keys()].sort();
    const keysB = [...b.chunks.keys()].sort();
    expect(keysA).toEqual(keysB);
  });

  test("every chunk's payloadJs is byte-identical across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.payloadJs).toBe(chunkA.payloadJs);
    }
  });

  test("every chunk's filename is byte-identical across compiles (§47.5 + §47.1.3)", () => {
    const a = compileFx1();
    const b = compileFx1();
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.filename).toBe(chunkA.filename);
    }
  });

  test("every chunk's FNV-1a 8-char base36 hash is byte-identical across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.chunkHash).toBe(chunkA.chunkHash);
      // Hash must be 8 lowercase base36 chars (§47.1.3) AND not be the
      // `00000000` placeholder — both runs must compute the real hash
      // identically.
      expect(chunkA.chunkHash).toMatch(/^[0-9a-z]{8}$/);
      expect(chunkA.chunkHash).not.toBe("00000000");
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — Per-route HTML byte-identity (A-4.7)
// ---------------------------------------------------------------------------

describe("FX-1 — per-route HTML byte-identity", () => {
  test("every input file's HTML output is byte-identical across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    // Build a path → html map from each result and assert equality
    // across all keys.
    function htmlByPath(result) {
      const m = new Map();
      for (const [path, out] of result.outputs) {
        if (out.html) m.set(path, out.html);
      }
      return m;
    }
    const ma = htmlByPath(a);
    const mb = htmlByPath(b);
    expect([...ma.keys()].sort()).toEqual([...mb.keys()].sort());
    for (const [path, htmlA] of ma) {
      const htmlB = mb.get(path);
      expect(htmlB).toBe(htmlA);
    }
  });

  test("inline _SCRML_CHUNKS manifest (in HTML) is byte-stable", () => {
    const a = compileFx1();
    const b = compileFx1();
    // Spot-check the home page's HTML — pick the inline-manifest slice
    // and assert byte-identity. The slice is bounded by the assignment
    // `window._SCRML_CHUNKS = ` and a `;` terminator on the same line
    // family per A-4.7's emit shape.
    function homeHtml(result) {
      for (const [path, out] of result.outputs) {
        if (out.html && path.endsWith("routes/index.scrml")) return out.html;
      }
      return undefined;
    }
    const ha = homeHtml(a);
    const hb = homeHtml(b);
    expect(ha).toBe(hb);
  });
});

// ---------------------------------------------------------------------------
// §4 — reachability.json byte-identity (§40.9.8 + A-2.8 canonical comparator)
// ---------------------------------------------------------------------------

describe("FX-1 — reachabilityRecordJson byte-identity (A-2.8)", () => {
  test("two compiles produce byte-identical reachabilityRecordJson()", () => {
    const a = compileFx1();
    const b = compileFx1();
    const ja = a.reachabilityRecordJson();
    const jb = b.reachabilityRecordJson();
    expect(ja).toBe(jb);
  });

  test("closures Map iteration order is stable across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    const closuresA = a.reachabilityRecord?.closures;
    const closuresB = b.reachabilityRecord?.closures;
    expect(closuresA).toBeDefined();
    expect(closuresB).toBeDefined();
    expect([...closuresA.keys()]).toEqual([...closuresB.keys()]);
  });
});

// ---------------------------------------------------------------------------
// §5 — Determinism under explicit chunkSizeBudgetBytes (Q-OPEN-5)
// ---------------------------------------------------------------------------

describe("FX-1 — determinism under explicit chunkSizeBudgetBytes", () => {
  // Q-OPEN-5 plumbed `chunkSizeBudgetBytes` through compileScrml as
  // a soft budget for the W-CG-CHUNK-LARGE lint. The budget value
  // should not introduce any ordering drift in chunks.json or per-
  // chunk payloads — it only affects whether the lint fires.
  test("same source + same budget → byte-identical chunks.json", () => {
    const a = compileFx1({ chunkSizeBudgetBytes: 200000 });
    const b = compileFx1({ chunkSizeBudgetBytes: 200000 });
    expect(a.chunksManifestJson()).toBe(b.chunksManifestJson());
  });

  test("same source + same budget → byte-identical per-chunk payloads", () => {
    const a = compileFx1({ chunkSizeBudgetBytes: 200000 });
    const b = compileFx1({ chunkSizeBudgetBytes: 200000 });
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.payloadJs).toBe(chunkA.payloadJs);
      expect(chunkB.chunkHash).toBe(chunkA.chunkHash);
    }
  });

  test("differing budget DOES NOT affect chunk content (only lint surface)", () => {
    // The budget is consumed by the W-CG-CHUNK-LARGE lint only — chunk
    // emission itself does not branch on it. Verify by comparing two
    // compiles with different budget values: chunks must be identical;
    // diagnostics may differ.
    const a = compileFx1({ chunkSizeBudgetBytes: 50 });
    const b = compileFx1({ chunkSizeBudgetBytes: 1000000 });
    // Chunk keys + filenames + payloads + hashes all identical.
    const keysA = [...a.chunks.keys()].sort();
    const keysB = [...b.chunks.keys()].sort();
    expect(keysA).toEqual(keysB);
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB.payloadJs).toBe(chunkA.payloadJs);
      expect(chunkB.chunkHash).toBe(chunkA.chunkHash);
      expect(chunkB.filename).toBe(chunkA.filename);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — N-run replay defence (10 consecutive compiles)
// ---------------------------------------------------------------------------

describe("FX-1 — 10-run replay defence", () => {
  test("ten consecutive compiles produce byte-identical chunksManifestJson()", () => {
    const baseline = compileFx1().chunksManifestJson();
    for (let i = 0; i < 10; i++) {
      const next = compileFx1().chunksManifestJson();
      expect(next).toBe(baseline);
    }
  });

  test("ten consecutive compiles produce byte-identical reachabilityRecordJson()", () => {
    const baseline = compileFx1().reachabilityRecordJson();
    for (let i = 0; i < 10; i++) {
      const next = compileFx1().reachabilityRecordJson();
      expect(next).toBe(baseline);
    }
  });

  test("ten consecutive compiles produce the same chunk-hash set", () => {
    const baseline = new Set(
      [...compileFx1().chunks.values()].map((c) => `${c.tier}/${c.role}/${c.chunkHash}`),
    );
    for (let i = 0; i < 10; i++) {
      const next = new Set(
        [...compileFx1().chunks.values()].map((c) => `${c.tier}/${c.role}/${c.chunkHash}`),
      );
      expect(next).toEqual(baseline);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — Diagnostic stream determinism (canonical order under §40.9.8)
// ---------------------------------------------------------------------------

describe("FX-1 — diagnostic stream determinism", () => {
  // FX-1 is canonical-shape (no diagnostics expected to fire); the
  // diagnostic stream's ordering across two compiles is therefore
  // trivially stable. Verify both streams are identical-length and
  // share the same code/severity profile across runs. This catches
  // any latent stream-order drift the cornerstone test does not catch
  // (the cornerstone asserts content equality at chunk + manifest
  // levels but not at the diagnostic-array level).
  test("result.errors length + (code, severity) tuples are stable across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    expect(a.errors.length).toBe(b.errors.length);
    const tupleA = a.errors.map((d) => `${d.code ?? ""}/${d.severity ?? ""}`);
    const tupleB = b.errors.map((d) => `${d.code ?? ""}/${d.severity ?? ""}`);
    expect(tupleA).toEqual(tupleB);
  });

  test("result.warnings length + (code, severity) tuples are stable across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    expect(a.warnings.length).toBe(b.warnings.length);
    const tupleA = a.warnings.map((d) => `${d.code ?? ""}/${d.severity ?? ""}`);
    const tupleB = b.warnings.map((d) => `${d.code ?? ""}/${d.severity ?? ""}`);
    expect(tupleA).toEqual(tupleB);
  });

  test("combined diagnostic stream (errors + warnings) preserves order across compiles", () => {
    const a = compileFx1();
    const b = compileFx1();
    const tupleA = allDiags(a).map((d) => `${d.code ?? ""}/${d.severity ?? ""}`);
    const tupleB = allDiags(b).map((d) => `${d.code ?? ""}/${d.severity ?? ""}`);
    expect(tupleA).toEqual(tupleB);
  });
});

// ---------------------------------------------------------------------------
// §8 — INPUT-ORDER invariance (g-compilescrml-input-order-dependent-emission, S347)
//
// Every FX-1 test above re-compiles with the SAME `inputFiles` order, so they
// prove same-source→same-bytes but NOT that the emitted artifact is a pure
// function of the file SET. It was not: `compileScrml` minted route/logic/
// fetch-stub ids in `inputFiles` TRAVERSAL order, and `resolvedInputFiles`
// (api.js gather seed) was never canonicalised — so the SAME set passed in a
// different argv/glob order (locale-dependent shell collation) emitted DIFFERENT
// artifacts, INCLUDING generated server route URLs (`__ri_route__…_1` vs `…_63`).
// Two machines could build a client and a server that disagree about where to
// fetch — a §47 content-addressing + §58 determinism violation.
//
// Bite (verified pre-fix on this exact fixture): FORWARD vs REVERSED inputFiles
// produced 5 differing emitted files. The fix canonicalises the seed
// (`resolvedInputFiles.sort()`, code-unit order). This block is the pin.
// ---------------------------------------------------------------------------
describe("FX-1 — INPUT-ORDER invariance (§47/§58: same SET → same bytes, any order)", () => {
  const REVERSED = [...FX1_INPUTS].reverse();

  // Collect every string-valued output field per path, so the comparison covers
  // .html AND the server emit where the route-URL divergence actually lived.
  function outputsByPath(result) {
    const m = new Map();
    for (const [path, out] of result.outputs) {
      const fields = {};
      for (const [k, v] of Object.entries(out)) {
        if (typeof v === "string") fields[k] = v;
      }
      m.set(path, fields);
    }
    return m;
  }

  test("chunks.json manifest is byte-identical FORWARD vs REVERSED input order", () => {
    const fwd = compileFx1({ inputFiles: FX1_INPUTS });
    const rev = compileFx1({ inputFiles: REVERSED });
    expect(rev.chunksManifestJson()).toBe(fwd.chunksManifestJson());
  });

  test("every emitted output field (HTML + server JS, incl. route URLs) is byte-identical across input order", () => {
    const fwd = outputsByPath(compileFx1({ inputFiles: FX1_INPUTS }));
    const rev = outputsByPath(compileFx1({ inputFiles: REVERSED }));
    // Same set of emitted paths.
    expect([...rev.keys()].sort()).toEqual([...fwd.keys()].sort());
    for (const [path, fFwd] of fwd) {
      const fRev = rev.get(path);
      expect(Object.keys(fRev).sort()).toEqual(Object.keys(fFwd).sort());
      for (const [field, valFwd] of Object.entries(fFwd)) {
        // Byte-for-byte — a single minted-id delta (e.g. __ri_route__…_N) fails here.
        expect(fRev[field]).toBe(valFwd);
      }
    }
  });

  test("generated server route ids do not depend on input order", () => {
    const routesOf = (result) => {
      const ids = new Set();
      for (const [, out] of result.outputs) {
        for (const v of Object.values(out)) {
          if (typeof v !== "string") continue;
          for (const m of v.matchAll(/__ri_route__[A-Za-z0-9_]+/g)) ids.add(m[0]);
        }
      }
      return [...ids].sort();
    };
    const fwd = routesOf(compileFx1({ inputFiles: FX1_INPUTS }));
    const rev = routesOf(compileFx1({ inputFiles: REVERSED }));
    expect(rev).toEqual(fwd);
  });
});

// ---------------------------------------------------------------------------
// §9 — CROSS-OS input-order invariance (g-api-cross-os-sort-key-native-separator, S349)
//
// §8 proves same-machine order-invariance but re-compiles on ONE host, so every
// resolved path shares ONE separator — it CANNOT catch the cross-OS flip. The §8
// seed sorted the NATIVE path: `\`=0x5C sorts AFTER digits, `/`=0x2F BEFORE, so a
// nested-subdir entry vs a prefix-colliding sibling flips order across OS, ids
// mint in traversal order, and a Windows client + Linux server disagree — the very
// §58 "two machines" divergence §8 exists to close, left open on the separator
// axis. The fix folds `\`↔`/` for the compare KEY (compareInputPathsCanonical).
//
// This is a SYNTHETIC cross-OS pin: it feeds both-separator spellings of the SAME
// logical set directly to the comparator, so it runs (and must pass) on EITHER
// host — a plain `.sort()` here fails on Windows spellings while passing on POSIX.
// ---------------------------------------------------------------------------
describe("§9 — compareInputPathsCanonical: separator-invariant order (cross-OS)", () => {
  const posixKey = (arr) => [...arr].sort(compareInputPathsCanonical).map((p) => p.replaceAll("\\", "/"));

  test("the flip case — nested entry vs prefix-colliding sibling sorts identically under \\ and /", () => {
    // `sub/a.scrml` vs `sub2.scrml`: `/`<`2`<`\`, so a native `.sort()` orders
    // them oppositely on Windows vs POSIX. The canonical comparator must not.
    const posix = posixKey(["/r/sub/a.scrml", "/r/sub2.scrml"]);
    const win   = posixKey(["\\r\\sub\\a.scrml", "\\r\\sub2.scrml"]);
    expect(win).toEqual(posix);
    expect(posix).toEqual(["/r/sub/a.scrml", "/r/sub2.scrml"]); // POSIX-native order is the canon
  });

  test("input argv order does not matter, on EITHER separator", () => {
    const canon = ["/r/a/x.scrml", "/r/a2.scrml", "/r/a/y.scrml"];
    for (const spell of [
      ["/r/a2.scrml", "/r/a/y.scrml", "/r/a/x.scrml"],          // POSIX, shuffled
      ["\\r\\a2.scrml", "\\r\\a\\y.scrml", "\\r\\a\\x.scrml"],  // Windows, shuffled
    ]) {
      expect(posixKey(spell)).toEqual(posixKey(canon));
    }
  });

  test("comparator is a total order (antisymmetric + reflexive) so the sort is stable", () => {
    const p = "\\r\\sub\\a.scrml", q = "/r/sub/a.scrml";
    expect(compareInputPathsCanonical(p, p)).toBe(0);
    expect(compareInputPathsCanonical(p, q)).toBe(0);         // same logical path, either spelling
    expect(compareInputPathsCanonical("/a", "/b")).toBe(-1);
    expect(compareInputPathsCanonical("/b", "/a")).toBe(1);
  });
});
