#!/usr/bin/env bun
/**
 * Per-Route Per-Role Chunk Variance Benchmark — v0.3.0 NEW.
 *
 * Compiles a 5-page 5-role fixture with --emit-per-route, then:
 *  1. Reads chunks.json manifest.
 *  2. For each (entryPoint, role) pair, gzips the chunk files referenced by
 *     `initial` for that role at that entry point — the bytes a visitor at
 *     that route with that role downloads up-front.
 *  3. Computes the role-overhead delta vs the Anonymous baseline.
 *  4. Compares each role's average initial bundle against a hypothetical
 *     single-bundle (all unique chunk files combined).
 *  5. Compiles the fixture 10 times; verifies the chunks.json manifest's
 *     chunk filenames are byte-identical across all runs (FNV-1a
 *     content-addressing determinism, §47.5).
 *
 * Output: markdown sections suitable for benchmarks/RESULTS.md.
 *
 * Manifest shape (per A-4.7 / §40.9.7):
 *   {
 *     version, compiler,
 *     entryPoints: {
 *       <epId>: { <role>: { initial: <filename>, tier1: <filename>, tier2: <filename> } }
 *     }
 *   }
 * Filenames are relative paths starting with "/" — they are stored on disk
 * relative to the output dir (output_dir + relative-path).
 *
 * Usage: bun benchmarks/per-route-roles/bench.js
 */

import { gzipSync } from "bun";
import { existsSync, readFileSync, rmSync, mkdtempSync, statSync } from "fs";
import { join, dirname, resolve, basename } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { compileScrml } from "../../compiler/src/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = __dirname;
const INPUTS = [
  resolve(FIXTURE_DIR, "routes/index.scrml"),
  resolve(FIXTURE_DIR, "routes/loads.scrml"),
  resolve(FIXTURE_DIR, "routes/customer.scrml"),
  resolve(FIXTURE_DIR, "routes/dispatch.scrml"),
  resolve(FIXTURE_DIR, "routes/admin.scrml"),
];

const TMP_BASE = mkdtempSync(join(tmpdir(), "per-route-roles-bench-"));

function compileOnce() {
  const out = join(TMP_BASE, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const result = compileScrml({
    inputFiles: INPUTS,
    outputDir: out,
    write: true,
    emitPerRoute: true,
    log: () => {},
  });
  return { result, outDir: out };
}

function gzipBytesForFile(outDir, relativePath) {
  // Filenames in manifest are typically "/index/Anonymous.initial.HASH.js".
  // Strip leading "/" and join with outDir.
  const cleaned = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
  const path = join(outDir, cleaned);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  const gz = gzipSync(raw);
  return { raw: raw.length, gzip: gz.length };
}

// ---------------------------------------------------------------------------
// Step 1 — compile once, gather chunk size data
// ---------------------------------------------------------------------------

const { result, outDir } = compileOnce();

if (!result.chunks || result.chunks.size === 0) {
  console.error("No chunks emitted. Compile may have failed:");
  if (result.diagnostics) {
    for (const d of result.diagnostics) {
      if (d.severity === "error") console.error(`  ${d.code}: ${d.message}`);
    }
  }
  process.exit(1);
}

const chunksManifestPath = join(outDir, "chunks.json");
if (!existsSync(chunksManifestPath)) {
  console.error("No chunks.json emitted at", chunksManifestPath);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(chunksManifestPath, "utf-8"));

// ---------------------------------------------------------------------------
// Step 2 — extract per-(EP, role) initial-tier sizes from the manifest.
// ---------------------------------------------------------------------------

if (!manifest.entryPoints) {
  console.error("Manifest has no entryPoints key");
  process.exit(1);
}

// Convert absolute-path-based epIds to short labels: extract the basename
// without extension (e.g. "index", "loads", "customer", "dispatch", "admin").
function shortLabel(epId) {
  // epId format: "<abs path>#program"
  const pathPart = epId.split("#")[0];
  const base = basename(pathPart, ".scrml");
  return base;
}

const epRoles = {}; // shortEpId -> role -> { rawBytes, gzipBytes, filename }
const allRoles = new Set();
const allChunkFiles = new Set(); // for single-bundle hypothetical

for (const [epId, roles] of Object.entries(manifest.entryPoints)) {
  const short = shortLabel(epId);
  epRoles[short] = {};
  for (const [role, tiers] of Object.entries(roles)) {
    allRoles.add(role);
    const initialPath = tiers.initial;
    if (!initialPath) continue;
    const sizes = gzipBytesForFile(outDir, initialPath);
    if (!sizes) {
      console.warn(`Missing chunk file for ${short}/${role}: ${initialPath}`);
      continue;
    }
    epRoles[short][role] = {
      rawBytes: sizes.raw,
      gzipBytes: sizes.gzip,
      filename: initialPath,
    };
    allChunkFiles.add(initialPath);
    // Also add tier1+tier2 chunks to the all-files set (single-bundle).
    if (tiers.tier1) allChunkFiles.add(tiers.tier1);
    if (tiers.tier2) allChunkFiles.add(tiers.tier2);
  }
}

// Compute single-bundle hypothetical: sum of all unique chunk files.
let singleBundleRaw = 0;
let singleBundleGzip = 0;
for (const filename of allChunkFiles) {
  const sizes = gzipBytesForFile(outDir, filename);
  if (sizes) {
    singleBundleRaw += sizes.raw;
    singleBundleGzip += sizes.gzip;
  }
}

// Also: scrml-runtime.js is loaded by every route. Get its size separately.
let runtimeRaw = 0;
let runtimeGzip = 0;
const runtimePath = join(outDir, "scrml-runtime.js");
if (existsSync(runtimePath)) {
  const raw = readFileSync(runtimePath);
  const gz = gzipSync(raw);
  runtimeRaw = raw.length;
  runtimeGzip = gz.length;
}

// ---------------------------------------------------------------------------
// Step 3 — determinism check: compile 10x, verify chunk filenames are
// byte-identical across all runs.
// ---------------------------------------------------------------------------

const DETERMINISM_RUNS = 10;
const filenameSetsPerRun = [];
for (let i = 0; i < DETERMINISM_RUNS; i++) {
  const { result: r, outDir: d } = compileOnce();
  if (!r.chunks || r.chunks.size === 0) {
    console.error(`Determinism run ${i + 1} produced no chunks`);
    process.exit(1);
  }
  const mp = join(d, "chunks.json");
  if (!existsSync(mp)) {
    console.error(`Determinism run ${i + 1} produced no manifest`);
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(mp, "utf-8"));
  const filenames = new Set();
  if (m.entryPoints) {
    for (const [epId, roles] of Object.entries(m.entryPoints)) {
      for (const [role, tiers] of Object.entries(roles)) {
        if (tiers.initial) filenames.add(tiers.initial);
        if (tiers.tier1) filenames.add(tiers.tier1);
        if (tiers.tier2) filenames.add(tiers.tier2);
      }
    }
  }
  filenameSetsPerRun.push([...filenames].sort());
}

const baseline = filenameSetsPerRun[0];
let allIdentical = true;
for (let i = 1; i < filenameSetsPerRun.length; i++) {
  const cur = filenameSetsPerRun[i];
  if (cur.length !== baseline.length) { allIdentical = false; break; }
  for (let j = 0; j < baseline.length; j++) {
    if (cur[j] !== baseline[j]) { allIdentical = false; break; }
  }
  if (!allIdentical) break;
}

// ---------------------------------------------------------------------------
// Step 4 — emit markdown summary
// ---------------------------------------------------------------------------

const KB = (b) => (b / 1024).toFixed(2);

console.log("=".repeat(72));
console.log("Per-Route Per-Role Chunk Variance Benchmark — v0.3.0 NEW");
console.log("=".repeat(72));
console.log();
console.log(`Fixture: benchmarks/per-route-roles/routes/{index,loads,customer,dispatch,admin}.scrml`);
console.log(`Roles: ${Array.from(allRoles).sort().join(", ")}`);
console.log(`Entry points: ${Object.keys(epRoles).length}`);
console.log(`Compiler: ${manifest.compiler || "(not in manifest)"}`);
console.log(`scrml-runtime.js (shared, every route): raw=${KB(runtimeRaw)} KB, gzip=${KB(runtimeGzip)} KB`);
console.log();

// Order roles: Anonymous first, then alphabetical
const orderedRoles = Array.from(allRoles).sort((a, b) => {
  if (a === "Anonymous") return -1;
  if (b === "Anonymous") return 1;
  return a.localeCompare(b);
});

console.log("## Per-Route Per-Role Initial Chunk Sizes (gzipped, KB)");
console.log();
console.log(`Numbers below are the *initial-tier* chunk for each (entry-point, role) — the`);
console.log(`bytes a visitor with that role at that route downloads as the per-page chunk.`);
console.log(`scrml-runtime.js (${KB(runtimeGzip)} KB gzip) is shared across every route + role and is NOT`);
console.log(`included in these per-role numbers (it's amortized across all routes).`);
console.log();

const orderedEps = Object.keys(epRoles).sort();
const headerRoles = orderedRoles.join(" | ");
console.log(`| Entry Point | ${headerRoles} |`);
console.log(`|---|${"---:|".repeat(orderedRoles.length)}`);
for (const ep of orderedEps) {
  const row = [ep];
  for (const role of orderedRoles) {
    const data = epRoles[ep][role];
    row.push(data ? KB(data.gzipBytes) : "—");
  }
  console.log(`| ${row.join(" | ")} |`);
}

console.log();
console.log("## Per-Role Average Initial-Chunk Size vs Anonymous Baseline");
console.log();
console.log("| Role | Avg initial (gzip) | vs Anonymous baseline |");
console.log("|---|---:|---:|");

const roleAvgs = {};
for (const role of orderedRoles) {
  let total = 0;
  let count = 0;
  for (const ep of orderedEps) {
    const data = epRoles[ep][role];
    if (data) { total += data.gzipBytes; count++; }
  }
  roleAvgs[role] = count > 0 ? total / count : 0;
}

const anonAvg = roleAvgs["Anonymous"] || 0;
for (const role of orderedRoles) {
  const avg = roleAvgs[role];
  const delta = role === "Anonymous"
    ? "— (baseline)"
    : (anonAvg > 0
      ? `${avg > anonAvg ? "+" : ""}${KB(avg - anonAvg)} KB (${avg > anonAvg ? "+" : ""}${((avg - anonAvg) / anonAvg * 100).toFixed(1)}%)`
      : "—");
  console.log(`| ${role} | ${KB(avg)} KB | ${delta} |`);
}

console.log();
console.log("## Per-Role Bundle vs Single-Bundle Hypothetical");
console.log();
console.log("If scrml emitted a single uniform bundle containing ALL chunks for");
console.log("all routes and all roles, that bundle would be:");
console.log();
console.log(`- **Single-bundle (raw):** ${KB(singleBundleRaw)} KB`);
console.log(`- **Single-bundle (gzip):** ${KB(singleBundleGzip)} KB`);
console.log();
console.log("Per-role savings vs single-bundle:");
console.log();
console.log("| Role | Avg per-route bundle (gzip) | vs Single-Bundle |");
console.log("|---|---:|---:|");
for (const role of orderedRoles) {
  const avg = roleAvgs[role];
  const reduction = singleBundleGzip > 0
    ? `-${((singleBundleGzip - avg) / singleBundleGzip * 100).toFixed(1)}%`
    : "—";
  console.log(`| ${role} | ${KB(avg)} KB | ${reduction} |`);
}

console.log();
console.log("## Content-Addressing Stability (FNV-1a, §47.5)");
console.log();
console.log(`Compiled ${DETERMINISM_RUNS}x; chunks.json filenames byte-identical across all runs: ${allIdentical ? "**YES**" : "**NO**"}`);

if (!allIdentical) {
  console.log("\nDifferences across runs (first run vs others):");
  for (let i = 1; i < filenameSetsPerRun.length; i++) {
    const a = new Set(baseline);
    const b = new Set(filenameSetsPerRun[i]);
    const aOnly = [...a].filter(x => !b.has(x));
    const bOnly = [...b].filter(x => !a.has(x));
    if (aOnly.length || bOnly.length) {
      console.log(`  Run 1 only: ${aOnly.join(", ")}`);
      console.log(`  Run ${i + 1} only: ${bOnly.join(", ")}`);
    }
  }
}

// Cleanup tmp dir
try { rmSync(TMP_BASE, { recursive: true, force: true }); } catch {}
