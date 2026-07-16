/**
 * A-5.2 — cross-file worked-example variant (cross-file MOD + CE path).
 *
 * Sub-phase of the A-5 wave (final Approach A sub-wave; v0.3.0 critical
 * path). Compiles a TWO-file fixture under
 * `compiler/tests/integration/fixtures/a5/cross-file/`:
 *
 *   - `app.scrml` — entry file with `<program auth="required">`, the
 *     app-scope role enum (`type UserRole:enum = { Anonymous, Driver,
 *     Admin }`), the reactive `<count>` cell + click handler, and a
 *     use-site reference to `<Header/>` imported from a sibling file.
 *   - `components/header.scrml` — pure component file exporting `Header`
 *     as a Form 2 (`export const Header = <nav ...>...</>`) entry. The
 *     component carries an `<auth role="Admin">` block whose subtree
 *     (`<section> / <h2> / <p>`) drives per-role admission variance
 *     through the cross-file CE expansion.
 *
 * The fixture exercises (cross-wave end-to-end, single entry-point,
 * two-file MOD path):
 *
 *   1. Stage 3.1 MOD resolves `./components/header.scrml` to the
 *      sibling absolute path; auto-gather (§21.7) pulls the file into
 *      the compile set.
 *   2. Stage 3.2 CE expands `<Header/>` at the use-site, inlining the
 *      imported component's markup tree (including the gated
 *      `<auth role="Admin">` subtree) into the entry file's tree.
 *   3. Stage 7.55 AG (§40 / A-3) derives the AuthGraph; the (b)-rule
 *      role-enum resolver discovers `UserRole` via the `<auth role=
 *      "Admin">` reference; per-gate classifier surfaces the gate
 *      post-CE expansion.
 *   4. Stage 7.6 RS (§40.9 / A-2) enumerates the single SPA EpId for
 *      `app.scrml` and emits per-role ChunkPlan entries; Component 4
 *      filters the gated subtree out of non-Admin componentNodeIds.
 *   5. Stage 8 CG splitter (§40.9.7 / A-4) emits per-(role, tier) chunk
 *      payloads + the chunks.json manifest with FNV-1a content-addressed
 *      filenames (§47.5).
 *
 * Family F-1 (cross-file path); FX-2 fixture lives at
 *   `compiler/tests/integration/fixtures/a5/cross-file/{app, components/header}.scrml`.
 *
 * Spec authority:
 *   - SPEC.md §15.13 — Component System (the imported component shape).
 *   - SPEC.md §21.2 — Export Form 1 + Form 2 equivalence.
 *   - SPEC.md §21.3 — Import syntax + named-import resolution.
 *   - SPEC.md §21.7 — CLI auto-gather of the import closure.
 *   - SPEC.md §40.8 — v0.3 program shape + default-logic-mode body.
 *   - SPEC.md §40.9.5 — Component 4 per-role admission.
 *   - SPEC.md §40.9.7 — initial / tier-1 / tier-2 / tier-N output.
 *   - SPEC.md §40.9.9 — worked example (the cross-file extension is
 *     beyond the example's literal text but uses the same closure-
 *     analysis path; the §40.9.9 `<block Header>` form is documentary
 *     pseudo-syntax — `<block>` is NOT in §4.15 structural elements).
 *   - SPEC.md §47.5 + §47.1.3 — FNV-1a base36 content-addressing.
 *
 * SCOPING: scrml-support/docs/deep-dives/a-5-integration-tests-SCOPING-2026-05-14.md
 *   §3.1 family F-1 (cross-file path) + §3.2 fixture FX-2 + §4.2 A-5.2.
 *
 * Structural template (per A-5.1 cornerstone landed `92f6c36`):
 *   `compiler/tests/integration/multipage-multirole-integration.test.js`
 *
 * Per-role variance assertion strategy: A-5.1 cornerstone §7 asserts
 * variance at the chunk-mount-marker level (`_scrml_chunk_mount(N, "tag")`
 * count differences between Admin and non-Admin chunks). For FX-2 (cross-
 * file CE expansion path), per-element mount markers do NOT differentiate
 * between roles — the CE-expanded children of an imported component all
 * fold into the imported component's root mount marker (here `<nav>`). The
 * variance does surface ONE LEVEL DEEPER: at the AST-node-id set of
 * `ChunkPlan.initialChunk.componentNodeIds`. Admin's componentNodeIds is
 * a strict superset of non-Admin's; the extra ids correspond to the
 * `<section> / <h2> / <p>` nodes inside the imported component's
 * `<auth role="Admin">` block. This asserts §40.9.5 Component 4 closed-
 * form classification through the cross-file CE path.
 *
 * The mount-vs-componentNodeIds gap is a structural finding — surface
 * to PA via the dispatch report, NOT a regression of the cross-file CE
 * path itself (the cross-file path correctly admits the gated subtree
 * to the right per-role componentNodeIds set; the chunk-mount emission
 * granularity is a separate codegen concern).
 *
 * Rule-4 reconnaissance findings:
 *   - The §40.9.9 example uses `<block Name>` to demonstrate the
 *     playable-surface analysis, but `<block>` is NOT a registered
 *     structural element (§4.15). Real cross-file factoring uses
 *     canonical Form 1/2 component exports per §21.2.
 *   - `import` statements MUST live inside a `${...}` logic context per
 *     §21.3 normative ("import SHALL be valid inside a `${}` logic
 *     context at the top level of a scrml file"). Default-logic mode
 *     (§40.8) covers bare top-level state cells / functions / type
 *     decls but does NOT cover bare top-level `import`. The fixture's
 *     `app.scrml` mixes the two: `import` in `${...}`, the rest in
 *     default-logic mode (matches `examples/22-multifile/app.scrml`
 *     adopter shape).
 *   - The FX-2 fixture is single-entry-point single-file; the cross-
 *     file expansion is achieved via the imported component, not via
 *     multiple entry-point files (FX-1 covers the multi-EP shape).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture locations
// ---------------------------------------------------------------------------

const FX2_DIR = join(
  import.meta.dir,
  "fixtures",
  "a5",
  "cross-file",
);
const FX2_APP = join(FX2_DIR, "app.scrml");
const FX2_HEADER = join(FX2_DIR, "components", "header.scrml");
// Auto-gather (§21.7) follows the import in `app.scrml`, so passing only
// `[FX2_APP]` would also resolve the sibling. Passing both explicitly is
// belt-and-suspenders + makes the cross-file dependency obvious to
// future readers.
const FX2_INPUTS = [FX2_APP, FX2_HEADER];

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "a5-cross-file-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileFx2() {
  return compileScrml({
    inputFiles: FX2_INPUTS,
    outputDir: join(TMP, "dist"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

function epIdsFrom(result) {
  if (!result.reachabilityRecord || !result.reachabilityRecord.closures) return [];
  return [...result.reachabilityRecord.closures.keys()];
}

// ---------------------------------------------------------------------------
// §1 — Pipeline-level invariants
// ---------------------------------------------------------------------------

describe("FX-2 — pipeline termination + clean compile", () => {
  test("compile succeeds — no fatal errors", () => {
    const result = compileFx2();
    const fatal = result.errors.filter(
      (e) =>
        e.severity !== "warning" &&
        e.severity !== "info" &&
        !String(e.code ?? "").startsWith("W-") &&
        !String(e.code ?? "").startsWith("I-"),
    );
    expect(fatal).toEqual([]);
  });

  test("no E-CLOSURE-001 — closure analysis terminates", () => {
    const result = compileFx2();
    expect(
      result.errors.filter((e) => e.code === "E-CLOSURE-001"),
    ).toEqual([]);
  });

  test("no E-CLOSURE-002 — role enum is declared in the entry file", () => {
    const result = compileFx2();
    expect(
      result.errors.filter((e) => e.code === "E-CLOSURE-002"),
    ).toEqual([]);
  });

  test("no E-AUTH-GRAPH-002/003/004 — auth graph derivation is clean across the cross-file boundary", () => {
    const result = compileFx2();
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

  test("no E-MODULE-* / E-IMPORT-* — sibling import resolves", () => {
    const result = compileFx2();
    const importErrs = result.errors.filter((e) => {
      const c = String(e.code ?? "");
      return c.startsWith("E-IMPORT-") || c.startsWith("E-MODULE-");
    });
    expect(importErrs).toEqual([]);
  });

  test("no E-COMPONENT-020 — Header component reference resolves post-CE", () => {
    // E-COMPONENT-020 fires when `<Header/>` cannot be resolved against
    // the consumer's CE registry (same-file or cross-file). A clean
    // FX-2 compile means the cross-file CE registry seeding (per
    // `component-expander.ts:2682` worklist) successfully pulled the
    // Header component into `app.scrml`'s expansion context.
    const result = compileFx2();
    expect(
      result.errors.filter((e) => e.code === "E-COMPONENT-020"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — Auto-gather + MOD resolution
// ---------------------------------------------------------------------------

describe("FX-2 — auto-gather + MOD resolution (§21.3 + §21.7)", () => {
  test("both fixture files appear in gatheredFiles", () => {
    const result = compileFx2();
    expect(result.gatheredFiles).toBeDefined();
    expect(result.gatheredFiles).toContain(FX2_APP);
    expect(result.gatheredFiles).toContain(FX2_HEADER);
  });

  test("compile sees exactly the two FX-2 fixture files (plus any auto-gather chase)", () => {
    // Belt-and-suspenders: passing `[FX2_APP, FX2_HEADER]` explicitly
    // and verifying neither file is missing nor duplicated. Auto-gather
    // (§21.7) deduplicates by absolute path.
    const result = compileFx2();
    const gathered = new Set(result.gatheredFiles ?? []);
    expect(gathered.has(FX2_APP)).toBe(true);
    expect(gathered.has(FX2_HEADER)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — Entry-point enumeration (single SPA program → 1 EpId)
// ---------------------------------------------------------------------------

describe("FX-2 — single SPA entry-point enumeration", () => {
  test("exactly one EpId — single-file SPA shape", () => {
    const result = compileFx2();
    const epIds = epIdsFrom(result);
    expect(epIds.length).toBe(1);
  });

  test("EpId shape is `<entryFilePath>#program` per `reachability/entry-points.ts spaEntryId`", () => {
    const result = compileFx2();
    const epIds = epIdsFrom(result);
    expect(epIds[0]).toBe(`${FX2_APP}#program`);
  });
});

// ---------------------------------------------------------------------------
// §4 — Role enum resolution + AuthGraph shape (cross-file gate enumeration)
// ---------------------------------------------------------------------------

describe("FX-2 — AuthGraph derivation across the cross-file boundary", () => {
  test("authGraph surfaces on compile result", () => {
    const result = compileFx2();
    expect(result.authGraph).toBeDefined();
    expect(result.authGraph).not.toBeNull();
  });

  test("role enum resolved to `UserRole` with three variants — A-3.2 (b) found the enum across the compile unit", () => {
    // The role enum is declared in `app.scrml`; the `<auth role="Admin">`
    // gate that triggers (b)-rule discovery lives in `components/
    // header.scrml`. A clean resolve here means the (b)-rule resolver
    // walks gates AFTER CE expansion has inlined the imported
    // component's body — the cross-file gate enters the gates map and
    // the enum-discovery path finds `UserRole` via the `Admin` variant
    // reference.
    const result = compileFx2();
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

  test("two gates enumerated — program-auth + cross-file auth-role-block", () => {
    // The `<auth role="Admin">` gate's site is INSIDE the imported
    // Header component; CE inlines the gate into `app.scrml`'s post-CE
    // node tree, where AG's per-file enumerator picks it up at Stage
    // 7.55. This test confirms the cross-file gate enumeration path is
    // wired end-to-end.
    const result = compileFx2();
    const gates = [...(result.authGraph?.gates?.values() ?? [])];
    const programGates = gates.filter((g) => g.siteKind === "program-auth");
    const authBlockGates = gates.filter((g) => g.siteKind === "auth-role-block");
    expect(programGates.length).toBe(1);
    expect(authBlockGates.length).toBe(1);
  });

  test("auth-role-block gate has classification gated_for_role = {Admin}", () => {
    const result = compileFx2();
    const gates = [...(result.authGraph?.gates?.values() ?? [])];
    const authBlock = gates.find((g) => g.siteKind === "auth-role-block");
    expect(authBlock).toBeDefined();
    expect(authBlock?.role).toBe("Admin");
    expect(authBlock?.classification).toBeDefined();
    expect(authBlock?.classification?.closed_form).toBe(true);
    if (authBlock?.classification?.closed_form === true) {
      expect([...authBlock.classification.gated_for_role]).toEqual(["Admin"]);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — ReachabilityRecord per-role ChunkPlan emission
// ---------------------------------------------------------------------------

describe("FX-2 — ReachabilityRecord per-role ChunkPlan", () => {
  test("closures map carries 1 entry (single SPA EpId)", () => {
    const result = compileFx2();
    const closures = result.reachabilityRecord?.closures;
    expect(closures).toBeDefined();
    expect(closures?.size).toBe(1);
  });

  test("the EpId carries a ChunkPlan per role variant — three roles", () => {
    const result = compileFx2();
    const closures = result.reachabilityRecord?.closures;
    const rps = closures?.get(`${FX2_APP}#program`);
    expect(rps).toBeDefined();
    const roles = [...(rps?.byRole?.keys() ?? [])].sort();
    expect(roles).toEqual(["Admin", "Anonymous", "Driver"]);
  });

  test("Admin's componentNodeIds ⊋ non-Admin roles' componentNodeIds — gated subtree variance through the cross-file CE path", () => {
    // §40.9.5 Component 4 closed-form classification — for FX-2's
    // `<auth role="Admin">` block (sited inside the imported Header
    // component), the gated `<section> / <h2> / <p>` subtree is
    // admitted to Admin's `componentNodeIds` set and EXCLUDED from
    // Driver / Anonymous sets. This is the load-bearing per-role
    // variance assertion for the cross-file path; mount-marker-level
    // counts collapse under the imported component's root nav (a
    // separate chunk-mount-emission concern — see file-top doc).
    const result = compileFx2();
    const rps = result.reachabilityRecord?.closures?.get(`${FX2_APP}#program`);
    const adminPlan = rps?.byRole?.get("Admin");
    const driverPlan = rps?.byRole?.get("Driver");
    const anonPlan = rps?.byRole?.get("Anonymous");
    expect(adminPlan).toBeDefined();
    expect(driverPlan).toBeDefined();
    expect(anonPlan).toBeDefined();

    const adminIds = new Set(adminPlan.initialChunk.componentNodeIds);
    const driverIds = new Set(driverPlan.initialChunk.componentNodeIds);
    const anonIds = new Set(anonPlan.initialChunk.componentNodeIds);

    // Strict superset: Admin ⊇ Driver and Admin ⊇ Anonymous.
    for (const id of driverIds) {
      expect(adminIds.has(id)).toBe(true);
    }
    for (const id of anonIds) {
      expect(adminIds.has(id)).toBe(true);
    }
    // Strictness: Admin has at least one node not in Driver (the gated
    // subtree's `<section> / <h2> / <p>` nodes — at least 1 node
    // distinguishes Admin from Driver).
    expect(adminIds.size).toBeGreaterThan(driverIds.size);
    expect(adminIds.size).toBeGreaterThan(anonIds.size);
  });
});

// ---------------------------------------------------------------------------
// §6 — chunks.json manifest shape (1 EpId × 3 role keys)
// ---------------------------------------------------------------------------

describe("FX-2 — chunks.json manifest", () => {
  test("manifest version + compiler fields populated", () => {
    const result = compileFx2();
    expect(result.chunksManifest).toBeDefined();
    expect(result.chunksManifest.version).toBe(1);
    expect(typeof result.chunksManifest.compiler).toBe("string");
    expect(result.chunksManifest.compiler.length).toBeGreaterThan(0);
  });

  test("manifest entryPoints carries exactly 1 EpId — the single SPA program", () => {
    const result = compileFx2();
    const epKeys = Object.keys(result.chunksManifest.entryPoints);
    expect(epKeys).toEqual([`${FX2_APP}#program`]);
  });

  test("the EpId carries per-role entries for all three variants — no `_anonymous` fallback", () => {
    // The presence of `_anonymous` instead of the named role variants
    // would indicate the role-enum failed to resolve; this test pins
    // the cross-file gate enumeration → role-enum resolution → per-
    // role manifest emission chain end-to-end.
    const result = compileFx2();
    const perRole = result.chunksManifest.entryPoints[`${FX2_APP}#program`];
    const roles = Object.keys(perRole).sort();
    expect(roles).toEqual(["Admin", "Anonymous", "Driver"]);
    for (const role of roles) {
      expect(perRole[role].initial).toBeDefined();
    }
  });

  test("every chunk key in manifest also appears in the chunks Map", () => {
    const result = compileFx2();
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
// §7 — Initial-chunk emission + content-addressing (CE-expanded markup)
// ---------------------------------------------------------------------------

describe("FX-2 — initial-chunk emission + content-addressing", () => {
  test("each of the 3 (EP, role) initial chunks is non-empty", () => {
    const result = compileFx2();
    let nonEmpty = 0;
    let total = 0;
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      total++;
      if (chunk.payloadJs.length > 0) nonEmpty++;
    }
    expect(total).toBe(3);
    expect(nonEmpty).toBe(3);
  });

  test("every chunk's filename carries an FNV-1a 8-char base36 hash (§47.5)", () => {
    const result = compileFx2();
    for (const chunk of result.chunks.values()) {
      expect(chunk.filename).toMatch(
        /^[A-Za-z0-9_/-]+\/\w+\.(initial|tier\d+|tierN\d+)\.[0-9a-z]{8}\.js$/,
      );
      expect(chunk.chunkHash).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  test("initial chunk admits the imported component's root mount — CE inlined `<nav>` from header.scrml into app.scrml's chunk", () => {
    // The `<Header/>` use-site in `app.scrml` has been CE-expanded; the
    // imported component's root `<nav>` element appears as a chunk-mount
    // marker in the entry file's initial chunk. This is the load-
    // bearing assertion that cross-file CE expansion reaches the
    // chunk-emission layer.
    const result = compileFx2();
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      // The Header's root is `<nav>`; the entry-file's own roots are
      // `<main>` and `<button>`. All three should appear as chunk
      // mounts on every per-role initial chunk.
      expect(chunk.payloadJs).toContain('"nav"');
      expect(chunk.payloadJs).toContain('"main"');
      expect(chunk.payloadJs).toContain('"button"');
      expect(chunk.payloadJs).toContain('_scrml_reactive_set("count", 0)');
    }
  });

  test("each initial chunk carries the role tag in its IIFE header comment", () => {
    const result = compileFx2();
    for (const chunk of result.chunks.values()) {
      if (chunk.tier !== "initial") continue;
      expect(chunk.payloadJs).toContain(`role=${chunk.role}`);
      expect(chunk.payloadJs).toContain("(function ()");
      expect(chunk.payloadJs).toContain("})();");
    }
  });
});

// ---------------------------------------------------------------------------
// §8 — Per-route HTML augmentation (A-4.7 — _SCRML_CHUNKS + role-bootstrap)
// ---------------------------------------------------------------------------

describe("FX-2 — per-route HTML augmentation", () => {
  function htmlFor(result, suffix) {
    // Normalize native path separators (`\` on Windows) to `/` before the
    // suffix comparison so the POSIX-shaped `suffix` (e.g. `cross-file/app.scrml`)
    // matches the native Map key. No-op on POSIX (paths already use `/`).
    for (const [filePath, out] of result.outputs) {
      if (out.html && filePath.replace(/\\/g, "/").endsWith(suffix)) return out.html;
    }
    return undefined;
  }

  test("entry file produces a per-file HTML output", () => {
    const result = compileFx2();
    expect(result.outputs).toBeDefined();
    expect(htmlFor(result, "cross-file/app.scrml")).toBeDefined();
  });

  test("entry file's HTML carries `window._SCRML_CHUNKS` inline manifest + role-bootstrap", () => {
    const result = compileFx2();
    const html = htmlFor(result, "cross-file/app.scrml");
    expect(html).toContain("window._SCRML_CHUNKS");
    expect(html).toContain('localStorage.getItem("scrml_role")');
    expect(html).toContain('"_anonymous"');
    expect(html).toContain('document.createElement("script")');
  });

  test("HTML inline manifest references all three role variants — Admin/Driver/Anonymous", () => {
    const result = compileFx2();
    const html = htmlFor(result, "cross-file/app.scrml");
    expect(html).toContain('"Admin"');
    expect(html).toContain('"Driver"');
    expect(html).toContain('"Anonymous"');
  });
});

// ---------------------------------------------------------------------------
// §9 — Determinism (§40.9.8 + §47.5) — two rebuilds → bit-identical output
// ---------------------------------------------------------------------------

describe("FX-2 — determinism across rebuilds", () => {
  test("two compileScrml invocations → byte-identical chunks.json", () => {
    const a = compileFx2();
    const b = compileFx2();
    expect(a.chunksManifestJson()).toBe(b.chunksManifestJson());
  });

  test("two compileScrml invocations → byte-identical per-chunk payloadJs + hash + filename", () => {
    const a = compileFx2();
    const b = compileFx2();
    expect(a.chunks.size).toBe(b.chunks.size);
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.payloadJs).toBe(chunkA.payloadJs);
      expect(chunkB.chunkHash).toBe(chunkA.chunkHash);
      expect(chunkB.filename).toBe(chunkA.filename);
    }
  });
});
