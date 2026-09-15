/* SPDX-License-Identifier: MIT
 *
 * corpus-emit-differential — ASSERTED EXIT CODES for the decline / refuse branches MAIN implements.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT UNIT TESTS
 * =================================================
 * `scripts/corpus-emit-differential.ts` is the standing pre-land gate for codegen changes — it is
 * the evidence cited in compiler PRs, this session's #956 included — and on `main` it had NO test
 * surface at all. Unit tests over the pure helpers would not catch its failure mode: every defect
 * found in it was a question about which BRANCH a real pair of manifests takes. So this asserts the
 * thing that actually matters: given a fixture pair, WHICH BRANCH, and WHAT EXIT CODE.
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
 *
 * ⛑ PROVENANCE, AND THE NINE CASES THAT ARE NOT HERE — READ THIS BEFORE "RESTORING" THEM.
 * ========================================================================================
 * This file was RECOVERED (S416) from `origin/worktree-agent-ab7336c5da32f10ed`, where it was
 * written and never merged. `docs/known-gaps.md` asserted it had landed; it had not. The same
 * branch carries ~1,250 lines of harness hardening that also never reached `main`:
 *
 *     HARD REQ on main   : 2, 3, 4, 5, 7            (scripts/corpus-emit-differential.ts, 1,549 LOC)
 *     HARD REQ on branch : 2, 3, 4, 5, 7, 8, 9, 9.1, 10, 11              (same file, 2,802 LOC)
 *
 * Measured by symbol count, main vs branch: `resolveNamespaceAnchor` 0/2, `corpusCleanliness` 0/15,
 * `anchorMismatches` 0/2, `sourceDifferences` 0/4, and the whole `reverify` / `FLAKE_DEMOTION_RULE`
 * layer 0/63. Nine of the original sixteen cases assert that machinery, so on `main` they fail — not
 * because the assertions are wrong, but because the code under test is absent. They are DROPPED
 * here rather than skipped, because a permanently-skipped case is a hollow gate:
 *
 *     HARD REQ 8   — divergent chunk-namespace anchor is INCOMPARABLE
 *     F6           — an absent anchor measurement is a mismatch, never an implicit match
 *     HARD REQ 11  — an untracked enumerated source is INCOMPARABLE
 *     F2           — a modified enumerated source is INCOMPARABLE (the leading-space class)
 *     F1 ×2       — shared compiler root / revision drift decline re-verification, KEEP findings
 *     G3           — a manifest recording a DIRTY corpus is never a re-verification oracle
 *     G4           — a DETERMINISM run never demotes            ← was passing VACUOUSLY on main
 *     --no-reverify — a real difference with re-verification off is reported, never discarded
 *
 * ⚠ G4 is the one to notice: it PASSED on `main` and is still dropped, because it passed against a
 * script with no demotion machinery to exercise. A green that cannot fail is the failure this repo
 * files as the hollow gate; keeping it would have overstated main's coverage by one case.
 *
 * Restoring those nine is MECHANICAL once the hardening lands — take them from the branch above.
 * Tracked as `g-emit-differential-hardening-never-reached-main`.
 *
 * ⛑ WINDOWS. The recovered file called `symlinkSync(REPO, linkRoot, "dir")`, which needs
 * SeCreateSymbolicLinkPrivilege on win32 — it threw EPERM in `beforeAll` and took the WHOLE file
 * down, 0 pass / 1 fail, so no case in it had ever run on a Windows clone. Now a junction there;
 * see the note at `linkRoot`.
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
 *
 * ⛑ WINDOWS — `"junction"`, NOT `"dir"`. A `"dir"` symlink needs SeCreateSymbolicLinkPrivilege
 * (elevation or Developer Mode) on win32, so `symlinkSync` threw EPERM in `beforeAll` and took the
 * WHOLE FILE down: 0 pass / 1 fail, no case in this file ever ran on a Windows clone. A junction is
 * a directory reparse point, needs no privilege, and gives the same property this fixture wants — a
 * distinct absolute path string resolving to the same checkout. Junctions are directory-only and
 * absolute-only, which is exactly this use. On POSIX the `type` argument is ignored, so the one
 * expression is correct on both platforms.
 */
let linkRoot;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ced-exit-codes-"));
  linkRoot = join(tmp, "root-link");
  symlinkSync(REPO, linkRoot, process.platform === "win32" ? "junction" : "dir");
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
