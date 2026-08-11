/**
 * corpus-emit-differential — ASSERTED EXIT CODES for every decline / refuse / demote branch.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT UNIT TESTS
 * =================================================
 * `scripts/corpus-emit-differential.ts` is the standing pre-land gate for codegen changes, and for
 * its whole life it had NO test surface at all. Across three adversarial review rounds it was found
 * to report wrong answers in nine distinct ways. The decisive one — a re-verification that discarded
 * 66 measured real differences and turned exit 1 into exit 0 — was INTRODUCED BY A FIX, survived a
 * hand-written bite proof aimed at the right mechanism in the wrong deployment, and was caught only
 * by an adversarial read.
 *
 * The failure mode of this instrument is EXIT 0. Nothing else in the tree would notice it. Unit
 * tests over the pure helpers would not have caught a single one of the nine, because every one of
 * them was a question about which BRANCH a real pair of manifests takes. So this asserts the thing
 * that actually matters: given a fixture pair, WHICH BRANCH, and WHAT EXIT CODE.
 *
 *   exit 0 = no differences        exit 1 = differences found        exit 2 = NOT A VALID COMPARISON
 *
 * Fixtures are synthesised from ONE real capture over the smallest corpus root in the tree
 * (`benchmarks/todomvc`, a single source), so the whole file runs in seconds and needs no network,
 * no second checkout and no build products.
 *
 * ⚠ THE ASSERTION THAT MATTERS MOST IS THAT NOTHING HERE EXPECTS 0 BY ACCIDENT. Every case that
 * carries a real recorded difference asserts a NON-zero exit; the only 0s are on pairs that are
 * genuinely identical.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(REPO, "scripts/corpus-emit-differential.ts");
const ROOT = "benchmarks/todomvc";

let tmp;
let baseManifest; // a real, clean capture — the fixture every case is derived from
/**
 * A SECOND, DISTINCT compiler-root path that still resolves to this checkout.
 *
 * The re-verification preconditions are ordered (shared root, then revision drift, then dirty
 * oracle), so isolating a later one needs an earlier one satisfied. A symlink gives a genuinely
 * different `compilerRoot` STRING — `path.resolve` is lexical and does not follow links — while
 * `git rev-parse HEAD` inside it still answers with this checkout's revision. That is the cheapest
 * honest way to reach the later branches without a second clone.
 */
let linkRoot;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ced-exit-codes-"));
  linkRoot = join(tmp, "root-link");
  symlinkSync(REPO, linkRoot, "dir");
  const r = spawnSync(
    "bun",
    [SCRIPT, "capture", "--compiler-root", REPO, "--label", "fixture",
     "--work", join(tmp, "work"), "--manifest", join(tmp, "fixture.json"),
     "--roots", ROOT, "--concurrency", "2"],
    { encoding: "utf8", cwd: REPO },
  );
  if (r.status !== 0) throw new Error(`fixture capture failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  baseManifest = JSON.parse(readFileSync(join(tmp, "fixture.json"), "utf8"));
  // The fixture must be non-vacuous or every assertion below is meaningless.
  expect(baseManifest.sources.length).toBeGreaterThan(0);
  expect(baseManifest.sources.some((s) => s.artifacts.length > 0)).toBe(true);
}, 300_000);

afterAll(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

/** Deep-clone the fixture and apply `mutate`, then write it and hand back the path. */
function manifest(name, mutate) {
  const m = JSON.parse(JSON.stringify(baseManifest));
  m.label = name;
  if (mutate) mutate(m);
  const p = join(tmp, `${name}.json`);
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  return p;
}

function runDiff(basePath, headPath, ...flags) {
  const r = spawnSync("bun", [SCRIPT, "diff", "--base", basePath, "--head", headPath, ...flags], {
    encoding: "utf8",
    cwd: REPO,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/**
 * Give a manifest a DIFFERENT revision and a real recorded difference, so the pair is a genuine
 * base/head with something to find. Returns the number of artifacts it perturbed.
 */
function withRealDifference(m, revision) {
  m.revision = revision;
  let touched = 0;
  for (const s of m.sources) {
    for (const a of s.artifacts) {
      a.sha256 = a.sha256.replace(/^./, (c) => (c === "a" ? "b" : "a"));
      touched++;
    }
  }
  return touched;
}

// ---------------------------------------------------------------------------------------------
// the identity floor
// ---------------------------------------------------------------------------------------------

test("a self-diff of one manifest reports NO DIFFERENCES and exits 0", () => {
  const p = manifest("self");
  const { code, out } = runDiff(p, p, "--allow-same-revision");
  expect(out).toContain("VERDICT: NO DIFFERENCES");
  expect(code).toBe(0);
});

test("the SAME revision on both sides is NOT A VALID COMPARISON without the opt-in", () => {
  const p = manifest("same-rev");
  const { code, out } = runDiff(p, p);
  expect(out).toContain("[INCOMPARABLE]");
  expect(code).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// refusals — exit 2
// ---------------------------------------------------------------------------------------------

test("an unknown revision on either side is NOT A VALID COMPARISON", () => {
  const b = manifest("unknown-rev", (m) => { m.revision = "<unknown>"; });
  const h = manifest("known-rev", (m) => { m.revision = "f".repeat(40); });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("[INCOMPARABLE]");
  expect(code).toBe(2);
});

test("a DIVERGENT CHUNK-NAMESPACE ANCHOR is NOT A VALID COMPARISON (HARD REQ 8)", () => {
  const b = manifest("anchor-a");
  const h = manifest("anchor-b", (m) => {
    m.revision = "f".repeat(40);
    for (const k of Object.keys(m.namespaceAnchor.prefixBySource)) {
      m.namespaceAnchor.prefixBySource[k] = "somewhere-else/";
    }
  });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("DIFFERENT chunk-namespace ANCHORS");
  expect(code).toBe(2);
});

test("an ABSENT anchor measurement is a MISMATCH, never an implicit match (F6)", () => {
  const b = manifest("anchor-present");
  const h = manifest("anchor-absent", (m) => {
    m.revision = "f".repeat(40);
    m.namespaceAnchor.prefixBySource = {}; // measured nothing, claims nothing
  });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("DIFFERENT chunk-namespace ANCHORS");
  expect(code).toBe(2);
});

test("an UNTRACKED enumerated source is NOT A VALID COMPARISON (HARD REQ 11)", () => {
  const b = manifest("dirty", (m) => { m.corpusCleanliness.untracked = ["benchmarks/todomvc/stray.scrml"]; });
  const h = manifest("clean-head", (m) => { m.revision = "f".repeat(40); });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("ENUMERATED CORPUS is not reproducible");
  expect(code).toBe(2);
});

test("a MODIFIED enumerated source is NOT A VALID COMPARISON (F2 — the leading-space class)", () => {
  const b = manifest("dirty-mod", (m) => { m.corpusCleanliness.modified = ["benchmarks/todomvc/app.scrml"]; });
  const h = manifest("clean-head-2", (m) => { m.revision = "f".repeat(40); });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("ENUMERATED CORPUS is not reproducible");
  expect(code).toBe(2);
});

test("a VACUOUS run comparing zero artifacts is NOT A VALID COMPARISON", () => {
  const b = manifest("vacuous-a", (m) => { for (const s of m.sources) s.artifacts = []; });
  const h = manifest("vacuous-b", (m) => {
    m.revision = "f".repeat(40);
    for (const s of m.sources) s.artifacts = [];
  });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("[VACUOUS]");
  expect(code).toBe(2);
});

test("a stale schemaVersion is refused, not silently read", () => {
  const b = manifest("old-schema", (m) => { m.schemaVersion = 1; });
  const h = manifest("cur-schema", (m) => { m.revision = "f".repeat(40); });
  const { code } = runDiff(b, h);
  expect(code).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// THE FALSE-GREEN CLASS — every one of these carries a REAL recorded difference and must NOT exit 0
// ---------------------------------------------------------------------------------------------

test("F1 — a SHARED compiler root declines re-verification and KEEPS the findings", () => {
  const b = manifest("shared-a");
  const h = manifest("shared-b", (m) => { withRealDifference(m, "f".repeat(40)); });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("both manifests name the SAME compiler root");
  expect(out).toContain("DELTA NOT RE-VERIFIED");
  expect(out).not.toContain("VERDICT: NO DIFFERENCES");
  expect(code).toBe(1);
});

test("F1 — a compiler root NO LONGER AT its captured revision declines and KEEPS the findings", () => {
  const b = manifest("drift-a", (m) => {
    m.compilerRoot = tmp; // exists, but is not a checkout at m.revision
    m.revision = "a".repeat(40);
  });
  const h = manifest("drift-b", (m) => { withRealDifference(m, "f".repeat(40)); });
  const { code, out } = runDiff(b, h);
  expect(out).toContain("DELTA NOT RE-VERIFIED");
  expect(out).not.toContain("VERDICT: NO DIFFERENCES");
  expect(code).toBe(1);
});

test("G3 — a manifest recording a DIRTY corpus is never a re-verification oracle", () => {
  // --allow-dirty-corpus permits the COMPARISON. It must not license re-compiling from that tree.
  // Distinct roots + matching revisions, so the SHARED-root and REVISION-drift guards are both
  // satisfied and the dirty-oracle guard is the one under test.
  const b = manifest("oracle-dirty", (m) => {
    m.compilerRoot = linkRoot;
    m.corpusCleanliness.modified = ["benchmarks/todomvc/app.scrml"];
  });
  const h = manifest("oracle-head", (m) => { withRealDifference(m, baseManifest.revision); });
  const { code, out } = runDiff(b, h, "--allow-dirty-corpus", "--allow-same-revision");
  expect(out).toContain("recorded a DIRTY corpus");
  expect(out).toContain("DELTA NOT RE-VERIFIED");
  expect(out).not.toContain("VERDICT: NO DIFFERENCES");
  expect(code).toBe(1);
});

test("G4 — a DETERMINISM run never demotes; a non-reproducing difference is the finding", () => {
  const b = manifest("det-a");
  const h = manifest("det-b", (m) => { withRealDifference(m, baseManifest.revision); });
  const { code, out } = runDiff(b, h, "--allow-same-revision");
  expect(out).not.toContain("VERDICT: NO DIFFERENCES");
  expect(code).toBe(1);
});

test("a real difference with re-verification DISABLED is reported, never discarded", () => {
  const b = manifest("nrv-a");
  const h = manifest("nrv-b", (m) => { withRealDifference(m, "f".repeat(40)); });
  const { code, out } = runDiff(b, h, "--no-reverify");
  expect(out).toContain("DIFFERENCE(S)");
  expect(out).not.toContain("VERDICT: NO DIFFERENCES");
  expect(code).toBe(1);
});

// ---------------------------------------------------------------------------------------------
// argument strictness — a disarmed guard is a silent one (F8 / G7)
// ---------------------------------------------------------------------------------------------

test("a non-numeric or EMPTY numeric flag value is rejected, not coerced", () => {
  const p = manifest("argcheck");
  for (const bad of ["abc", "", " ", "1.5", "-1"]) {
    const r = spawnSync("bun", [SCRIPT, "diff", "--base", p, "--head", p, "--reverify-limit", bad], {
      encoding: "utf8", cwd: REPO,
    });
    expect(`${r.stdout}${r.stderr}`).toContain("--reverify-limit");
    expect(r.status).toBe(2);
  }
});

test("an unknown flag NAME is rejected rather than ignored", () => {
  const p = manifest("argcheck2");
  const r = spawnSync("bun", [SCRIPT, "diff", "--base", p, "--head", p, "--reverify-limits", "10"], {
    encoding: "utf8", cwd: REPO,
  });
  expect(r.status).toBe(2);
});
