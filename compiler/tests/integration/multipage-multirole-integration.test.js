/**
 * A-5.1 — multi-entry-point + multi-role expansion of §40.9.9 worked example.
 *
 * Cornerstone integration test for the A-5 wave (final Approach A
 * sub-wave; v0.3.0 critical path). Compiles a single .scrml file
 * containing a §40.9.9-shape `<program auth="required">` extended with
 * three direct `<page>` children (`/`, `/loads`, `/admin`) and a
 * three-variant role enum {Anonymous, Driver, Admin}, then asserts
 * cross-wave end-to-end coherence:
 *
 *   1. Entry-point enumeration (A-2.2.a) — three EpIds emit in
 *      deterministic source order with `#page@<path>` ids per
 *      `reachability/entry-points.ts` ratification.
 *   2. AuthGraph derivation (A-3) — role enum resolves to three
 *      variants; per-gate classifier surfaces program-auth and
 *      auth-role-block gates.
 *   3. Reachability solver (A-2) — per-(EP, role) ChunkPlan emit;
 *      total nine RolePlan instances (3 EPs × 3 roles).
 *   4. Per-route artifact splitter (A-4) — chunks.json carries
 *      three entryPoint keys; each chunk's filename has the FNV-1a
 *      8-char base36 hash (§47.5); per-role per-page chunk variance
 *      visible at the chunk-output layer.
 *   5. Per-route HTML augmentation (A-4.7) — every route's HTML
 *      includes the `_SCRML_CHUNKS` inline manifest + role-detection
 *      bootstrap.
 *   6. Determinism (A-2.8 + A-4.6) — two compileScrml invocations
 *      on the same source produce byte-identical chunks.json AND
 *      byte-identical per-chunk JS payloads + per-chunk content hashes.
 *
 * Family F-1 (single-program path); FX-1 fixture lives at
 * `compiler/tests/integration/fixtures/a5/single-program-multipage-multirole.scrml`.
 *
 * Spec authority:
 *   - SPEC.md §40.9.9 (line 17819) — worked example normative text.
 *   - SPEC.md §40.8 — v0.3 program shape + `<page>` direct-child rule.
 *   - SPEC.md §40.9.5 — Component 4 per-role admission.
 *   - SPEC.md §40.9.7 — initial / tier-1 / tier-2 / tier-N output.
 *   - SPEC.md §40.9.8 — determinism preservation + R1-R4 recoverability.
 *   - SPEC.md §47.5 + §47.1.3 — FNV-1a base36 content-addressing.
 *   - SPEC.md §6.X line 6914 — case-sensitive variant matching.
 *
 * SCOPING: scrml-support/docs/deep-dives/a-5-integration-tests-SCOPING-2026-05-14.md
 *   §3.1 family F-1 + §3.2 fixture FX-1 + §4.2 A-5.1 sub-phase.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture — FX-1 lives as a fixture DIRECTORY (multi-file `routes/` shape
// per `route-inference.ts buildPageRouteTree`, since v0.3 forbids
// `<page path=>` per E-PAGE-INVALID-ATTR / SPEC §4.15 + §40.8 — the
// multi-page mechanism is multi-file under `routes/`, NOT one file with
// multiple `<page path=>` children).
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
  TMP = mkdtempSync(join(tmpdir(), "a5-multipage-multirole-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileFx1() {
  return compileScrml({
    inputFiles: FX1_INPUTS,
    outputDir: join(TMP, "dist"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

function chunksByTierForRole(result, tier, role) {
  if (!result.chunks) return [];
  const out = [];
  for (const chunk of result.chunks.values()) {
    if (chunk.tier === tier && chunk.role === role) out.push(chunk);
  }
  return out;
}

function epIdsFrom(result) {
  if (!result.reachabilityRecord || !result.reachabilityRecord.closures) return [];
  return [...result.reachabilityRecord.closures.keys()];
}

/**
 * Cross-stream helper. Combines `result.errors` and `result.warnings` into
 * one array. Required when filtering by a `W-*` (or `I-*`) code, because
 * api.js:1674-1675 partitions the diagnostic stream:
 *
 *   result.errors   = diagnostics where !code.startsWith("W-") AND severity !== "warning"
 *   result.warnings = diagnostics where code.startsWith("W-") OR severity === "warning"
 *
 * `result.errors.filter(e => e.code === "W-...")` is therefore a structural
 * false negative — always returns []. Match A-5.3/A-5.4 helper convention.
 */
function allDiags(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}

// ---------------------------------------------------------------------------
// §1 — Pipeline-level invariants
// ---------------------------------------------------------------------------

describe("FX-1 — pipeline termination + clean compile", () => {
  test("compile succeeds — no fatal errors", () => {
    const result = compileFx1();
    const fatal = result.errors.filter(
      (e) =>
        e.severity !== "warning" &&
        !String(e.code ?? "").startsWith("W-") &&
        !String(e.code ?? "").startsWith("I-"),
    );
    expect(fatal).toEqual([]);
  });

  test("no E-CLOSURE-001 — closure analysis terminates", () => {
    const result = compileFx1();
    expect(
      result.errors.filter((e) => e.code === "E-CLOSURE-001"),
    ).toEqual([]);
  });

  test("no E-CLOSURE-002 — role enum is declared", () => {
    const result = compileFx1();
    expect(
      result.errors.filter((e) => e.code === "E-CLOSURE-002"),
    ).toEqual([]);
  });

  test("no E-AUTH-GRAPH-002/003/004 — auth graph derivation is clean", () => {
    const result = compileFx1();
    expect(
      result.errors.filter((e) => e.code === "E-AUTH-GRAPH-002"),
    ).toEqual([]);
    expect(
      result.errors.filter((e) => e.code === "E-AUTH-GRAPH-003"),
    ).toEqual([]);
    expect(
      result.errors.filter((e) => e.code === "E-AUTH-GRAPH-004"),
    ).toEqual([]);
  });

  test("no W-AUTH-PAGE-INFERRED — every <page> declares auth= explicitly", () => {
    const result = compileFx1();
    // W-* codes flow into result.warnings per api.js:1674-1675 — use the
    // cross-stream helper to avoid the structural false negative the
    // single-stream `result.errors.filter(...)` would silently exhibit.
    expect(
      allDiags(result).filter((e) => e.code === "W-AUTH-PAGE-INFERRED"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — Entry-point enumeration (3 pages → 3 EpIds in deterministic order)
// ---------------------------------------------------------------------------

describe("FX-1 — entry-point enumeration", () => {
  test("three EpIds emitted — one per route file (SPA-program shape)", () => {
    const result = compileFx1();
    const epIds = epIdsFrom(result);
    expect(epIds.length).toBe(3);
  });

  test("EpId shape is `<filePath>#program` per `reachability/entry-points.ts spaEntryId`", () => {
    // Per `entry-points.ts`: a file with <program> + zero direct <page>
    // children → SPA shape; EpId is `${filePath}#program`. The route
    // URL surfaces separately via RouteMap.pages (filesystem-derived).
    const result = compileFx1();
    const epIds = epIdsFrom(result);
    // File-iteration order is preserved per `enumerateEntryPoints`'s
    // determinism guarantee. Inputs were [index, loads, admin].
    expect(epIds).toContain(`${FX1_INDEX}#program`);
    expect(epIds).toContain(`${FX1_LOADS}#program`);
    expect(epIds).toContain(`${FX1_ADMIN}#program`);
  });
});

// ---------------------------------------------------------------------------
// §3 — Role enum resolution + AuthGraph shape
// ---------------------------------------------------------------------------

describe("FX-1 — AuthGraph derivation", () => {
  test("authGraph surfaces on compile result", () => {
    const result = compileFx1();
    expect(result.authGraph).toBeDefined();
    expect(result.authGraph).not.toBeNull();
  });

  test("role enum resolved to `UserRole` with three variants in canonical order", () => {
    const result = compileFx1();
    const roleEnum = result.authGraph?.roleEnum;
    expect(roleEnum).toBeDefined();
    expect(roleEnum?.name).toBe("UserRole");
    expect(roleEnum?.isImplicitAnonymous).toBe(false);
    expect([...(roleEnum?.variants ?? [])].sort()).toEqual([
      "Admin",
      "Anonymous",
      "Driver",
    ]);
  });

  test("auth gates enumerated — at least one program-auth + one auth-role-block", () => {
    const result = compileFx1();
    const gates = [...(result.authGraph?.gates?.values() ?? [])];
    // Program-auth (from <program auth="required">) + per-page auth
    // attributes + the <auth role="Admin"> block in the /admin page.
    const programGates = gates.filter((g) => g.siteKind === "program-auth");
    const authBlockGates = gates.filter((g) => g.siteKind === "auth-role-block");
    expect(programGates.length).toBeGreaterThanOrEqual(1);
    expect(authBlockGates.length).toBeGreaterThanOrEqual(1);
  });

  test("auth-role-block gate has classification gated_for_role = {Admin}", () => {
    const result = compileFx1();
    const gates = [...(result.authGraph?.gates?.values() ?? [])];
    const adminBlocks = gates.filter(
      (g) => g.siteKind === "auth-role-block" && g.role === "Admin",
    );
    expect(adminBlocks.length).toBeGreaterThanOrEqual(1);
    for (const gate of adminBlocks) {
      expect(gate.classification).toBeDefined();
      expect(gate.classification?.closed_form).toBe(true);
      if (gate.classification?.closed_form === true) {
        const gatedFor = [...gate.classification.gated_for_role];
        expect(gatedFor).toEqual(["Admin"]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — ReachabilityRecord shape (3 EPs × 3 roles = 9 RolePlan instances)
// ---------------------------------------------------------------------------

describe("FX-1 — ReachabilityRecord shape", () => {
  test("closures map carries 3 entries (one per EpId)", () => {
    const result = compileFx1();
    const closures = result.reachabilityRecord?.closures;
    expect(closures).toBeDefined();
    expect(closures?.size).toBe(3);
  });

  test("each EpId carries a ChunkPlan per role variant (3 roles each)", () => {
    const result = compileFx1();
    const closures = result.reachabilityRecord?.closures;
    expect(closures).toBeDefined();
    let totalRolePlans = 0;
    for (const [, rps] of closures ?? []) {
      const roles = [...(rps.byRole?.keys() ?? [])].sort();
      expect(roles).toEqual(["Admin", "Anonymous", "Driver"]);
      totalRolePlans += roles.length;
    }
    // 3 EpIds × 3 roles = 9 RolePlan instances.
    expect(totalRolePlans).toBe(9);
  });

  test("every ChunkPlan carries the four ChunkContents tiers", () => {
    const result = compileFx1();
    const closures = result.reachabilityRecord?.closures;
    expect(closures).toBeDefined();
    for (const [, rps] of closures ?? []) {
      for (const [, plan] of rps.byRole ?? []) {
        expect(plan.initialChunk).toBeDefined();
        expect(plan.prefetchTier1).toBeDefined();
        expect(plan.prefetchTier2).toBeDefined();
        expect(plan.prefetchTierN).toBeDefined();
        expect(plan.initialChunk.componentNodeIds).toBeDefined();
        expect(plan.initialChunk.reactiveCellNodeIds).toBeDefined();
        expect(plan.initialChunk.serverFnNodeIds).toBeDefined();
        expect(plan.initialChunk.vendorUnitNames).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — chunks.json manifest shape (3 entryPoint keys × 3 role keys)
// ---------------------------------------------------------------------------

describe("FX-1 — chunks.json manifest", () => {
  test("manifest version + compiler fields populated", () => {
    const result = compileFx1();
    expect(result.chunksManifest).toBeDefined();
    expect(result.chunksManifest.version).toBe(1);
    expect(typeof result.chunksManifest.compiler).toBe("string");
    expect(result.chunksManifest.compiler.length).toBeGreaterThan(0);
  });

  test("manifest entryPoints carries 3 EpId keys — one per route file", () => {
    const result = compileFx1();
    const epKeys = Object.keys(result.chunksManifest.entryPoints);
    expect(epKeys.length).toBe(3);
    expect(epKeys).toContain(`${FX1_INDEX}#program`);
    expect(epKeys).toContain(`${FX1_LOADS}#program`);
    expect(epKeys).toContain(`${FX1_ADMIN}#program`);
  });

  test("each entryPoint has per-role entries for all three variants", () => {
    const result = compileFx1();
    for (const epId of Object.keys(result.chunksManifest.entryPoints)) {
      const perRole = result.chunksManifest.entryPoints[epId];
      const roles = Object.keys(perRole).sort();
      expect(roles).toEqual(["Admin", "Anonymous", "Driver"]);
      // Each role entry carries an `initial` chunk key reference.
      for (const role of roles) {
        expect(perRole[role].initial).toBeDefined();
      }
    }
  });

  test("every chunk key in manifest also appears in chunks Map", () => {
    const result = compileFx1();
    const chunkKeys = new Set([...result.chunks.keys()]);
    const manifestKeys = new Set();
    for (const epId of Object.keys(result.chunksManifest.entryPoints)) {
      for (const role of Object.keys(result.chunksManifest.entryPoints[epId])) {
        const entry = result.chunksManifest.entryPoints[epId][role];
        if (entry.initial) manifestKeys.add(entry.initial);
        if (entry.tier1) manifestKeys.add(entry.tier1);
        if (entry.tier2) manifestKeys.add(entry.tier2);
        if (entry.tierN) for (const k of entry.tierN) manifestKeys.add(k);
      }
    }
    expect(chunkKeys).toEqual(manifestKeys);
  });
});

// ---------------------------------------------------------------------------
// §6 — Initial-chunk per-page non-empty + content-addressing
// ---------------------------------------------------------------------------

describe("FX-1 — initial-chunk emission", () => {
  test("each of the 9 (EP, role) pairs has a non-empty initial chunk", () => {
    const result = compileFx1();
    let nonEmpty = 0;
    let total = 0;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      total++;
      if (chunk.payloadJs.length > 0) nonEmpty++;
    }
    expect(total).toBe(9); // 3 EPs × 3 roles
    expect(nonEmpty).toBe(9);
  });

  test("every chunk's filename carries FNV-1a 8-char base36 hash (§47.5)", () => {
    const result = compileFx1();
    for (const chunk of result.chunks.values()) {
      // Filename shape: `<route>/<RoleVariant>.<tier>.<8-char-hash>.js`.
      expect(chunk.filename).toMatch(
        /^[A-Za-z0-9_/-]+\/\w+\.(initial|tier\d+|tierN\d+)\.[0-9a-z]{8}\.js$/,
      );
      // FNV-1a base36 hash — not the placeholder.
      expect(chunk.chunkHash).not.toBe("00000000");
      expect(chunk.chunkHash).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  test("each initial chunk carries the role tag in its IIFE header", () => {
    const result = compileFx1();
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      expect(chunk.payloadJs).toContain(`role=${chunk.role}`);
      expect(chunk.payloadJs).toContain("(function ()");
      expect(chunk.payloadJs).toContain("})();");
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — Per-role per-page chunk variance (Admin ⊇ non-Admin at /admin)
// ---------------------------------------------------------------------------

describe("FX-1 — per-role per-page chunk variance", () => {
  test("/admin Admin chunk has strictly more component mount markers than /admin Driver chunk", () => {
    // The /admin page contains an <auth role="Admin"> block whose
    // descendant <section> + <h2> + <p> are admitted ONLY for the
    // Admin role. Driver's /admin chunk omits the gated subtree →
    // strictly fewer mounts.
    const result = compileFx1();
    const adminEpId = `${FX1_ADMIN}#program`;
    const adminChunks = [...result.chunks.values()].filter(
      (c) => c.entryPointId === adminEpId && c.tier === "initial",
    );
    expect(adminChunks.length).toBe(3);
    const byRole = Object.create(null);
    for (const c of adminChunks) byRole[c.role] = c;
    const countMounts = (s) => (s.match(/_scrml_chunk_mount\(/g) ?? []).length;
    const adminMounts = countMounts(byRole.Admin.payloadJs);
    const driverMounts = countMounts(byRole.Driver.payloadJs);
    const anonMounts = countMounts(byRole.Anonymous.payloadJs);
    expect(adminMounts).toBeGreaterThan(driverMounts);
    expect(adminMounts).toBeGreaterThan(anonMounts);
  });

  test("/ Admin chunk admits the admin-link <a> inside the home-page <auth> block; Driver chunk does not", () => {
    // The home (`/`) page has `<auth role="Admin"><a href="/admin">...</a></auth>`
    // — Admin sees the link, Driver does not.
    const result = compileFx1();
    const homeEpId = `${FX1_INDEX}#program`;
    const homeChunks = [...result.chunks.values()].filter(
      (c) => c.entryPointId === homeEpId && c.tier === "initial",
    );
    const byRole = Object.create(null);
    for (const c of homeChunks) byRole[c.role] = c;
    const countAnchors = (s) =>
      (s.match(/_scrml_chunk_mount\(\d+, "a"\);/g) ?? []).length;
    const adminAnchors = countAnchors(byRole.Admin.payloadJs);
    const driverAnchors = countAnchors(byRole.Driver.payloadJs);
    expect(adminAnchors).toBeGreaterThan(driverAnchors);
  });

  test("/loads page chunks structurally differ from / page chunks (per-EP variance)", () => {
    // The two pages have different markup trees; their per-role
    // chunks have different payloadJs bytes. The simplest cross-page
    // variance check: chunk URLs in the manifest entry for / differ
    // from the chunk URLs in the manifest entry for /loads.
    const result = compileFx1();
    const homeEntry = result.chunksManifest.entryPoints[`${FX1_INDEX}#program`];
    const loadsEntry =
      result.chunksManifest.entryPoints[`${FX1_LOADS}#program`];
    expect(homeEntry.Driver.initial).not.toBe(loadsEntry.Driver.initial);
  });
});

// ---------------------------------------------------------------------------
// §8 — Per-route HTML augmentation (role-bootstrap + _SCRML_CHUNKS manifest)
// ---------------------------------------------------------------------------

describe("FX-1 — per-route HTML augmentation (A-4.7)", () => {
  function htmlByFile(result, suffix) {
    // Normalize native path separators (`\` on Windows) to `/` before the
    // suffix comparison so the POSIX-shaped `suffix` (e.g. `routes/index.scrml`)
    // matches the native Map key. No-op on POSIX (paths already use `/`).
    for (const [filePath, out] of result.outputs) {
      if (out.html && filePath.replace(/\\/g, "/").endsWith(suffix)) return out.html;
    }
    return undefined;
  }

  test("each input file produces a per-file HTML output", () => {
    const result = compileFx1();
    expect(result.outputs).toBeDefined();
    expect(htmlByFile(result, "routes/index.scrml")).toBeDefined();
    expect(htmlByFile(result, "routes/loads.scrml")).toBeDefined();
    expect(htmlByFile(result, "routes/admin.scrml")).toBeDefined();
  });

  test("every route's HTML carries `window._SCRML_CHUNKS` inline manifest", () => {
    const result = compileFx1();
    for (const suffix of [
      "routes/index.scrml",
      "routes/loads.scrml",
      "routes/admin.scrml",
    ]) {
      const html = htmlByFile(result, suffix);
      expect(html).toContain("window._SCRML_CHUNKS");
    }
  });

  test("every route's HTML carries the role-detection bootstrap (localStorage + script-loader)", () => {
    const result = compileFx1();
    for (const suffix of [
      "routes/index.scrml",
      "routes/loads.scrml",
      "routes/admin.scrml",
    ]) {
      const html = htmlByFile(result, suffix);
      expect(html).toContain('localStorage.getItem("scrml_role")');
      expect(html).toContain('"_anonymous"');
      expect(html).toContain('document.createElement("script")');
    }
  });

  test("HTML inline manifest references all three role variants", () => {
    const result = compileFx1();
    const html = htmlByFile(result, "routes/index.scrml");
    expect(html).toContain('"Admin"');
    expect(html).toContain('"Anonymous"');
    expect(html).toContain('"Driver"');
  });

  test("HTML inline manifest is keyed by route URL pattern (`/`, `/loads`, `/admin`) per A-4.7 EpId→route translation", () => {
    const result = compileFx1();
    const html = htmlByFile(result, "routes/index.scrml");
    // The route-keyed manifest emits at the inline-`_SCRML_CHUNKS` site.
    // Quoting around keys per JSON.stringify(..., null, 2) shape.
    expect(html).toContain('"/":');
    expect(html).toContain('"/loads":');
    expect(html).toContain('"/admin":');
  });
});

// ---------------------------------------------------------------------------
// §9 — Tier-1 / Tier-2 prefetch wiring (A-4.3 + A-4.4)
// ---------------------------------------------------------------------------

describe("FX-1 — tier-1 / tier-2 prefetch wiring", () => {
  test("tier-1 chunk descriptors exist for every (EP, role) — possibly empty payload", () => {
    const result = compileFx1();
    let tier1Count = 0;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier === "tier1") tier1Count++;
    }
    expect(tier1Count).toBe(9); // 3 EPs × 3 roles
  });

  test("tier-2 chunk descriptors exist for every (EP, role) — possibly empty payload", () => {
    const result = compileFx1();
    let tier2Count = 0;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier === "tier2") tier2Count++;
    }
    expect(tier2Count).toBe(9); // 3 EPs × 3 roles
  });

  test("home page's <a href='/loads'> is wired with data-scrml-prefetch", () => {
    // The / route's index.scrml has `<a href="/loads">` and `<a href="/admin">`
    // (inside <auth role="Admin">). Both target known pages in this compile
    // unit, so A-4.4 wires data-scrml-prefetch on both anchors.
    const result = compileFx1();
    let html;
    for (const [filePath, out] of result.outputs) {
      if (out.html && filePath.replace(/\\/g, "/").endsWith("routes/index.scrml")) html = out.html;
    }
    expect(html).toContain('data-scrml-prefetch="/loads"');
    expect(html).toContain('data-scrml-prefetch="/admin"');
  });

  test("loads page's <a href='/'> is wired with data-scrml-prefetch back to /", () => {
    const result = compileFx1();
    let html;
    for (const [filePath, out] of result.outputs) {
      if (out.html && filePath.replace(/\\/g, "/").endsWith("routes/loads.scrml")) html = out.html;
    }
    expect(html).toContain('data-scrml-prefetch="/"');
  });

  test("initial-chunk IIFE tail attaches hover-handler when fixture has internal links", () => {
    const result = compileFx1();
    let foundHandler = false;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      if (chunk.payloadJs.includes(`a[data-scrml-prefetch]`)) {
        foundHandler = true;
        expect(chunk.payloadJs).toContain("_scrml_prefetch_tier2");
      }
    }
    expect(foundHandler).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10 — W-CG-CHUNK-* lint baseline (canonical-shape fixture → no fires)
// ---------------------------------------------------------------------------

describe("FX-1 — W-CG-CHUNK-* lint baseline", () => {
  // All four W-CG-CHUNK-* codes flow into result.warnings per
  // api.js:1674-1675 (W- codes go to the warnings stream, not errors).
  // Use the cross-stream helper allDiags(result) to avoid the structural
  // false negative the single-stream `result.errors.filter(...)` would
  // silently exhibit (always [], regardless of whether the lint fired).
  test("W-CG-CHUNK-EMPTY does NOT fire — every page has non-empty content", () => {
    const result = compileFx1();
    expect(
      allDiags(result).filter((e) => e.code === "W-CG-CHUNK-EMPTY"),
    ).toEqual([]);
  });

  test("W-CG-CHUNK-MISSING-ROLE does NOT fire — every Admin gate has a corresponding chunk", () => {
    const result = compileFx1();
    expect(
      allDiags(result).filter((e) => e.code === "W-CG-CHUNK-MISSING-ROLE"),
    ).toEqual([]);
  });

  test("W-CG-CHUNK-LARGE does NOT fire — fixture stays well under the 100 KB soft budget", () => {
    const result = compileFx1();
    expect(
      allDiags(result).filter((e) => e.code === "W-CG-CHUNK-LARGE"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §11 — Determinism (§40.9.8 + §47.5)
// ---------------------------------------------------------------------------

describe("FX-1 — determinism (§40.9.8 + §47.5)", () => {
  test("two compileScrml invocations → byte-identical chunks.json", () => {
    const a = compileFx1();
    const b = compileFx1();
    expect(a.chunksManifestJson()).toBe(b.chunksManifestJson());
  });

  test("two compileScrml invocations → byte-identical per-chunk payloadJs + hash", () => {
    const a = compileFx1();
    const b = compileFx1();
    expect(a.chunks.size).toBe(b.chunks.size);
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.payloadJs).toBe(chunkA.payloadJs);
      expect(chunkB.chunkHash).toBe(chunkA.chunkHash);
      expect(chunkB.filename).toBe(chunkA.filename);
    }
  });

  test("two compileScrml invocations → byte-identical per-route HTML", () => {
    const a = compileFx1();
    const b = compileFx1();
    let htmlA;
    let htmlB;
    for (const [, out] of a.outputs) if (out.html) htmlA = out.html;
    for (const [, out] of b.outputs) if (out.html) htmlB = out.html;
    expect(htmlA).toBe(htmlB);
  });
});
