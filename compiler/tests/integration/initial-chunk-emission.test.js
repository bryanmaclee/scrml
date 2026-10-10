/**
 * A-4.2 initial-chunk emission — §40.9.9 worked-example end-to-end replay.
 *
 * S91 wave A-4.2 wires `composeInitialChunk` into the per-(EP, role,
 * tier) iteration in `route-splitter.ts` so the `initial` tier carries
 * real admission-filtered JS payload. This test exercises the full
 * driver — `compileScrml({ emitPerRoute: true })` — and asserts the
 * §40.9.9 normative claims for the worked-example fixture.
 *
 * Spec authority:
 *   - SPEC.md §40.9.7 — initial_chunk(E) normative (lines 17774-17793).
 *   - SPEC.md §40.9.8 — determinism preservation (lines 17794-17812).
 *   - SPEC.md §40.9.9 — worked example normative text (lines 17815-17883).
 *   - docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md §3.2.
 *
 * Coverage (≥10 tests target):
 *   §1  Pipeline-level — compile succeeds with `emitPerRoute: true`.
 *   §2  Initial-chunk content — admitted components surface in the
 *       initial-tier `payloadJs` for the Driver role.
 *   §3  Per-role variance — Admin chunk admits the `<auth role="Admin">`
 *       subtree's components; Driver chunk omits them.
 *   §4  Reactive-cell admission — `@count` registration line present.
 *   §5  Server-fn admission — fetch stub emitted for boundary fns.
 *   §6  Determinism (R1 dive-A) — two builds produce byte-identical
 *       initial-chunk payload.
 *   §7  Regression — per-file `.client.js` byte-identical to baseline
 *       (the per-file emitter MUST NOT have shifted at A-4.2).
 *   §8  Tier 1 / tier 2 / tierN remain EMPTY at A-4.2 (A-4.3+ scope).
 *   §9  Single-file path with `emitPerRoute: false` produces no chunks.
 *
 * Reference test (already landed at A-3.5): `compiler/tests/integration/
 * auth-graph-spec-40-9-9-worked-example.test.js` — that test asserts the
 * AuthGraph + ReachabilityRecord shape. This test layers on top: it
 * asserts the chunk-emission output.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture — §40.9.9 worked-example, case-matched variant names
// (same shape as auth-graph-spec-40-9-9-worked-example.test.js)
// ---------------------------------------------------------------------------

const WORKED_EXAMPLE_SOURCE = `<program title="Dispatch" auth="required">

type UserRole:enum = { Anonymous, Driver, Dispatcher, Admin }

<count> = 0

function increment() {
  @count = @count + 1
}

<nav class="flex items-center gap-3 p-4 border-b">
  <h1 class="text-xl font-semibold">Dispatch</h1>
  <a href="/loads" class="text-blue-600">Loads</a>
  <auth role="Admin">
    <a href="/admin" class="text-red-600">Admin</a>
  </auth>
</nav>

<button onclick=increment()
        class="px-3 py-1 rounded bg-slate-100">
  \${@count}
</button>

</program>
`;

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "a42-initial-chunk-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileWorked({ emitPerRoute = true, outDir } = {}) {
  const filePath = join(TMP, "app.scrml");
  writeFileSync(filePath, WORKED_EXAMPLE_SOURCE);
  return compileScrml({
    inputFiles: [filePath],
    outputDir: outDir ?? join(TMP, "dist"),
    write: false,
    emitPerRoute,
    log: () => {},
  });
}

function getInitialChunk(result, role) {
  const chunks = result.chunks;
  if (!chunks) return undefined;
  for (const chunk of chunks.values()) {
    if (chunk.tier === "initial" && chunk.role === role) return chunk;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// §1 — Pipeline succeeds + chunks surfaced
// ---------------------------------------------------------------------------

describe("§40.9.9 + A-4.2 — pipeline integration", () => {
  test("compileScrml with emitPerRoute=true succeeds + surfaces chunks", () => {
    const result = compileWorked();
    const fatal = result.errors.filter((e) => e.severity !== "warning" && !String(e.code ?? "").startsWith("W-") && !String(e.code ?? "").startsWith("I-"));
    expect(fatal).toEqual([]);
    expect(result.chunks).toBeDefined();
    expect(result.chunksManifest).toBeDefined();
  });

  test("per-role initial chunk present for all four UserRole variants", () => {
    const result = compileWorked();
    for (const role of ["Admin", "Anonymous", "Dispatcher", "Driver"]) {
      const chunk = getInitialChunk(result, role);
      expect(chunk).toBeDefined();
      // Real admission-filtered payload (non-empty) — composeInitialChunk
      // produced a chunk body with the §40.9.7 admitted set.
      expect(typeof chunk.payloadJs).toBe("string");
      expect(chunk.payloadJs.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — Initial-chunk content for viewer=Driver (§40.9.9 step 5 normative)
// ---------------------------------------------------------------------------

describe("§40.9.9 — viewer=Driver initial chunk", () => {
  test("driver chunk carries IIFE shell + role-tagged header", () => {
    const result = compileWorked();
    const driver = getInitialChunk(result, "Driver");
    expect(driver).toBeDefined();
    expect(driver.payloadJs).toContain("scrml initial chunk");
    expect(driver.payloadJs).toContain("role=Driver");
    expect(driver.payloadJs).toContain("(function ()");
    expect(driver.payloadJs).toContain("})();");
  });

  test("driver chunk admits the `@count` reactive cell registration", () => {
    const result = compileWorked();
    const driver = getInitialChunk(result, "Driver");
    expect(driver.payloadJs).toContain(`_scrml_reactive_set("count", 0);`);
  });

  test("driver chunk surfaces server-fn fetch stub section header when admitted", () => {
    // The fixture has no `server function` decl — server-fn section is
    // tree-shaken (the worked example exercises reactive + auth-gate
    // paths only). This test pins the negative: NO fetch stub section
    // for this fixture's playable surface.
    const result = compileWorked();
    const driver = getInitialChunk(result, "Driver");
    expect(driver.payloadJs).not.toContain("server-fn fetch stubs");
    expect(driver.payloadJs).not.toContain("_scrml_fetch_");
  });

  test("driver chunk admits the <nav> + <button> markup mount markers (worst-case-union)", () => {
    // §40.9.2 worst-case-union admits ALL markup descendants of the
    // playable surface; the driver chunk's admitted-components section
    // therefore includes <nav>, <h1>, <button>, and similar leaves.
    const result = compileWorked();
    const driver = getInitialChunk(result, "Driver");
    expect(driver.payloadJs).toContain("admitted components");
    expect(driver.payloadJs).toMatch(/_scrml_chunk_mount\(\d+, "nav"\);/);
    expect(driver.payloadJs).toMatch(/_scrml_chunk_mount\(\d+, "button"\);/);
  });
});

// ---------------------------------------------------------------------------
// §3 — Per-role variance: Admin chunk admits `<auth role="Admin">` subtree
// ---------------------------------------------------------------------------

describe("§40.9.9 — per-role variance (Driver vs Admin)", () => {
  test("Admin chunk admits the `<a>` link inside `<auth>`; Driver chunk omits it", () => {
    const result = compileWorked();
    const admin = getInitialChunk(result, "Admin");
    const driver = getInitialChunk(result, "Driver");
    expect(admin).toBeDefined();
    expect(driver).toBeDefined();
    // Per §40.9.9 Component 4 normative: the `<auth role="Admin">`
    // *element itself* is admitted to all chunks (it's an in-tree gate
    // declaration, not a "drop" classification); ONLY ITS DESCENDANT
    // markup `<a href="/admin">` is gated OUT for non-Admin roles.
    // Both chunks therefore carry `_scrml_chunk_mount(N, "auth")`; only
    // Admin's chunk additionally carries `_scrml_chunk_mount(M, "a")`
    // for the admin-link descendant.
    const adminLinkMatches = (admin.payloadJs.match(/_scrml_chunk_mount\(\d+, "a"\);/g) ?? []).length;
    const driverLinkMatches = (driver.payloadJs.match(/_scrml_chunk_mount\(\d+, "a"\);/g) ?? []).length;
    // Admin sees the admin-link `<a>`; Driver does not (its admission
    // set is a subset). The fixture has NO other `<a>` elements at
    // this admission depth, so the count delta is exactly 1.
    expect(adminLinkMatches).toBeGreaterThan(driverLinkMatches);
  });

  test("Admin chunk has STRICTLY MORE component mount markers than Driver chunk", () => {
    const result = compileWorked();
    const admin = getInitialChunk(result, "Admin");
    const driver = getInitialChunk(result, "Driver");
    const countMounts = (s) => (s.match(/_scrml_chunk_mount\(/g) ?? []).length;
    const adminMounts = countMounts(admin.payloadJs);
    const driverMounts = countMounts(driver.payloadJs);
    expect(adminMounts).toBeGreaterThan(driverMounts);
  });

  test("non-Admin roles produce identical chunk content where the admitted-set overlaps", () => {
    // Per §40.9.9 the non-Admin viewers (Anonymous / Driver / Dispatcher)
    // all see the same playable surface (the `<auth role="Admin">` gate
    // is OUT for all three). Their admission sets — and therefore their
    // chunk payloads — are identical.
    const result = compileWorked();
    const driver = getInitialChunk(result, "Driver");
    const dispatcher = getInitialChunk(result, "Dispatcher");
    expect(driver).toBeDefined();
    expect(dispatcher).toBeDefined();
    // The role tag in the header differs (Driver vs Dispatcher), so
    // strip it and compare bodies.
    const normalize = (s) => s.replace(/role=\w+/g, "role=<X>");
    expect(normalize(driver.payloadJs)).toBe(normalize(dispatcher.payloadJs));
  });
});

// ---------------------------------------------------------------------------
// §4 — Determinism (R1 reproducibility dive A; A-4.6 hashing prerequisite)
// ---------------------------------------------------------------------------

describe("§40.9.8 — chunk determinism (two builds → byte-identical)", () => {
  test("two compileScrml invocations on identical source → byte-identical initial chunk JS", () => {
    const a = compileWorked();
    const b = compileWorked();
    for (const role of ["Admin", "Driver"]) {
      const ca = getInitialChunk(a, role);
      const cb = getInitialChunk(b, role);
      expect(ca.payloadJs).toBe(cb.payloadJs);
    }
  });

  test("chunks.json manifest serializes byte-identically across builds", () => {
    const a = compileWorked();
    const b = compileWorked();
    const aJson = a.chunksManifestJson();
    const bJson = b.chunksManifestJson();
    expect(aJson).toBe(bJson);
  });

  // -- A-4.6 content-addressing determinism --
  test("A-4.6 hash byte-identity — two builds → identical chunkHash per chunk", () => {
    const a = compileWorked();
    const b = compileWorked();
    expect(a.chunks.size).toBe(b.chunks.size);
    for (const [key, chunkA] of a.chunks) {
      const chunkB = b.chunks.get(key);
      expect(chunkB).toBeDefined();
      expect(chunkB.chunkHash).toBe(chunkA.chunkHash);
      expect(chunkB.filename).toBe(chunkA.filename);
    }
  });

  test("A-4.6 5-run hash replay — same source produces same hash across N=5 builds", () => {
    const runs = Array.from({ length: 5 }, () => compileWorked());
    const baseline = runs[0];
    for (let i = 1; i < runs.length; i++) {
      for (const [key, baselineChunk] of baseline.chunks) {
        const replayChunk = runs[i].chunks.get(key);
        expect(replayChunk).toBeDefined();
        expect(replayChunk.chunkHash).toBe(baselineChunk.chunkHash);
        expect(replayChunk.payloadJs).toBe(baselineChunk.payloadJs);
      }
    }
  });

  // -- A-4.6 §47.5 source-change → hash-change --
  test("A-4.6 source-change → hash-change — modifying source flips at least one chunk hash", () => {
    const a = compileWorked();
    // Modify the worked-example source: increment the @count seed
    // value from 0 to 1. The reactive cell's init line bytes change
    // → initial chunk payloadJs changes → hash changes.
    const modifiedSource = WORKED_EXAMPLE_SOURCE.replace("<count> = 0", "<count> = 1");
    expect(modifiedSource).not.toBe(WORKED_EXAMPLE_SOURCE);
    const fixturePath = join(TMP, "modified.scrml");
    writeFileSync(fixturePath, modifiedSource);
    const outDir = join(TMP, "out-modified");
    mkdirSync(outDir, { recursive: true });
    const b = compileScrml({
      inputFiles: [fixturePath],
      outputDir: outDir,
      emitPerRoute: true,
      write: false,
    });
    expect(b.chunks).toBeDefined();
    // The chunk-key shape includes the source-file path, so the
    // chunks Maps don't share keys cleanly. We compare via tier
    // and role grouping: at least one (tier, role) initial chunk's
    // hash must differ between the baseline + the modified source.
    const baselineHashesByLabel = new Map();
    for (const chunk of a.chunks.values()) {
      baselineHashesByLabel.set(`${chunk.role}::${chunk.tier}`, chunk.chunkHash);
    }
    let foundDifference = false;
    for (const chunk of b.chunks.values()) {
      const baselineHash = baselineHashesByLabel.get(`${chunk.role}::${chunk.tier}`);
      if (baselineHash !== undefined && baselineHash !== chunk.chunkHash) {
        foundDifference = true;
        break;
      }
    }
    expect(foundDifference).toBe(true);
  });

  // -- A-4.6 no placeholder leak --
  test("A-4.6 NO placeholder leak — emitted chunks contain ZERO occurrences of `00000000`", () => {
    const result = compileWorked();
    for (const chunk of result.chunks.values()) {
      expect(chunk.chunkHash).not.toBe("00000000");
      expect(chunk.filename).not.toContain(".00000000.js");
      // The payload itself must not embed a chunk-URL referencing the
      // placeholder. The initial-chunk IIFE-tail prefetch URL is the
      // primary risk surface — it must reference the real-hash tier-1
      // filename (when tier-1 admission is non-empty).
      expect(chunk.payloadJs).not.toContain("00000000.js");
    }
    // The on-disk chunks.json shape (URL-style) must also be clean.
    const manifestJson = result.chunksManifestJson();
    expect(manifestJson).not.toContain("00000000");
  });
});

// ---------------------------------------------------------------------------
// §5 — Tier 1 / tier 2 / tierN remain empty at A-4.2 (A-4.3+ scope)
// ---------------------------------------------------------------------------

describe("§40.9.7 — tier 1/2/N still empty at A-4.2 (A-4.3+ deferred)", () => {
  test("tier1 + tier2 chunks have empty payloadJs", () => {
    const result = compileWorked();
    for (const chunk of result.chunks.values()) {
      if (chunk.tier === "tier1" || chunk.tier === "tier2") {
        expect(chunk.payloadJs).toBe("");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Single-file path regression: .client.js byte-identical to baseline
// ---------------------------------------------------------------------------

describe("§40.9.7 — per-file .client.js path NOT touched by A-4.2", () => {
  test("compileScrml without emitPerRoute → no chunks; per-file client.js produced as before", () => {
    const result = compileWorked({ emitPerRoute: false });
    expect(result.chunks).toBeUndefined();
    expect(result.chunksManifest).toBeUndefined();
    // The per-file client.js output is still present in `outputs`.
    const outputs = result.outputs;
    expect(outputs.size).toBeGreaterThan(0);
    for (const [, out] of outputs) {
      expect(typeof out.clientJs).toBe("string");
      expect(out.clientJs.length).toBeGreaterThan(0);
    }
  });

  test("client.js bytes IDENTICAL with vs without emitPerRoute (atom emitters are additive — no side effects on per-file emission)", () => {
    const without = compileWorked({ emitPerRoute: false });
    const withFlag = compileWorked({ emitPerRoute: true });
    for (const [filePath, withoutOut] of without.outputs) {
      const withOut = withFlag.outputs.get(filePath);
      expect(withOut).toBeDefined();
      // The per-file .client.js MUST be byte-identical — the chunk
      // emitter is an additive POST-pass; it does not feed back into
      // the per-file emit pipeline.
      // S461 — the per-file BODY must be byte-identical. The one line that may differ is the
      // `// Requires: scrml-runtime.<hash>.js` header: under emitPerRoute the shared runtime
      // legitimately carries the route-splitter-only chunks ('mount' / 'vendor-ref' /
      // 'prefetch'), so its content hash — and so its filename — differs.
      const normRuntime = (js) => js.replace(/scrml-runtime\.[0-9a-z]+\.js/g, "scrml-runtime.<HASH>.js");
      expect(normRuntime(withOut.clientJs)).toBe(normRuntime(withoutOut.clientJs));
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — Chunk filename + manifest wiring still well-formed under real emission
// ---------------------------------------------------------------------------

describe("§40.9.7 — chunk filename + manifest manifest still well-formed", () => {
  test("chunk filenames follow OQ-A4-C `<route>/<RoleVariant>.<tier>.<8-char-hash>.js` pattern", () => {
    const result = compileWorked();
    for (const chunk of result.chunks.values()) {
      // Pattern: <segment>/<RoleVariant>.<tier>.<8-char-hash>.js
      expect(chunk.filename).toMatch(/^[A-Za-z0-9_/-]+\/\w+\.(initial|tier\d+|tierN\d+)\.[0-9a-zA-Z]{8}\.js$/);
      // A-4.6 wired content-addressing: the chunkHash is the real
      // FNV-1a base36 8-char hash, NOT the A-4.1 placeholder. The
      // placeholder remains a constant in route-splitter.ts as the
      // regression-guard sentinel (so this assertion proves the
      // replacement happened).
      expect(chunk.chunkHash).not.toBe("00000000");
      expect(chunk.chunkHash).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  test("manifest references every chunk by canonical key", () => {
    const result = compileWorked();
    const manifest = result.chunksManifest;
    const keysInChunks = new Set([...result.chunks.keys()]);
    const keysInManifest = new Set();
    for (const epId of Object.keys(manifest.entryPoints)) {
      for (const role of Object.keys(manifest.entryPoints[epId])) {
        const entry = manifest.entryPoints[epId][role];
        if (entry.initial) keysInManifest.add(entry.initial);
        if (entry.tier1) keysInManifest.add(entry.tier1);
        if (entry.tier2) keysInManifest.add(entry.tier2);
        if (entry.tierN) {
          for (const k of entry.tierN) keysInManifest.add(k);
        }
      }
    }
    // Every key in chunks Map is in manifest and vice versa.
    expect(keysInChunks).toEqual(keysInManifest);
  });
});
