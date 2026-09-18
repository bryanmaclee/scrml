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
 * ⛑ S417 — THAT SENTENCE WAS VACUOUSLY TRUE WHEN IT WAS WRITTEN, AND THAT IS WHY IT READ CLEAN.
 * As landed, this file carried NO case that had a real recorded difference: one `toBe(0)` on the
 * identity floor and six `toBe(2)` on refusals. There was no `toBe(1)` anywhere, and
 * `withRealDifference` — the helper built for exactly that case — was defined and never called.
 * So the quantifier ranged over an empty set and the claim cost nothing to satisfy.
 *
 * The gate's PRIMARY verdict was therefore untested in the one instrument compiler PRs cite as
 * landing evidence. Measured: blinding the content comparison (`ba.sha256 === ha.sha256` -> `true`)
 * left the suite at 7 pass / 0 fail. With the VERDICT-floor cases below it goes 7 pass / 2 fail,
 * and the two that die are exactly those cases. The sentence above is now load-bearing.
 *
 * The general lesson, worth more than the fix: **a claim quantified over "every case that X" is
 * satisfied for free when no case does X.** Check the population before trusting the property.
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
 *
 * ⛑ S419 — THE S417 VERDICT FLOOR HAD ONE MUTATION DETECTOR FOR A TWELVE-TERM SUM.
 * `findings` in the script sums twelve difference kinds, and both S417 `toBe(1)` cases built only an
 * artifact CONTENT-hash difference. Measured: replacing the whole sum with `contentDiffs.length`
 * left this file 9 pass / 0 fail. So a gate that silently stopped counting new compile failures or
 * diagnostic-code changes stayed green. The same vacuity, one level down. Now:
 *   - FINDING_TERMS below carries ONE isolated exit-1 case per term (the pair differs in exactly that
 *     term and nothing else, so removing the term from the sum drops `findings` to 0 and exit to 0);
 *   - a CENSUS reads the sum out of the script and fails if a term has no case, so a thirteenth
 *     term cannot land uncovered;
 *   - the "opt-in must not suppress the verdict" case now uses the SAME revision, where the opt-in
 *     is actually effective (it was inert on a different-revision pair);
 *   - the numeric-flag case uses capture's real numeric flags (diff mode has none; the old case
 *     passed `--reverify-limit`, which exists in neither mode on main, and re-tested the unknown-flag
 *     branch — exit 2 on a VALID value too);
 *   - invalid runs (missing / corrupt / wrongly-shaped manifest, capture abort, crash) assert exit 2,
 *     and a non-toplevel `--compiler-root` asserts a `<unknown>` revision and the guard refusing it.
 * Every new case was mutation-proven to go red with its subject removed:
 * `docs/changes/s419-differential-verdict-coverage/progress.md`.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
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
let stubRoot;

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
  // A real capture of this checkout, which IS its own git toplevel, must record a real revision —
  // the positive control for the gap-2 toplevel check (a check that always said "<unknown>" would
  // otherwise pass every refusal case below).
  expect(baseManifest.revision).toMatch(/^[0-9a-f]{40}$/);

  // A tiny NON-git compiler root for capture cases that must fail fast, so they never walk the repo.
  stubRoot = join(tmp, "stub-root");
  mkdirSync(join(stubRoot, "src"), { recursive: true });
  writeFileSync(join(stubRoot, "src", "a.scrml"), "<p>stub</p>\n");
  writeFileSync(join(stubRoot, "not-a-dir.txt"), "a file, so a root pointing at it is unreadable as a directory\n");
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
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout };
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
// the VERDICT floor — exit 1, the branch this gate exists to reach
//
// ⛑ S417. These are the cases the file was landed WITHOUT, and their absence made the header's
// own boast ("every case that carries a real recorded difference asserts a NON-zero exit")
// VACUOUSLY true — there were no such cases. The landed rig asserted exit 0 once and exit 2 six
// times; `withRealDifference` above was defined and never called. So the gate's PRIMARY verdict
// — "differences found" — had no coverage at all, in the one instrument compiler PRs cite as
// landing evidence (#956 cited "0 artifact content diffs" from it in the same session).
//
// The concrete hole, measured: blinding the content comparison at the `ba.sha256 === ha.sha256`
// site to `if (true)` left the suite at 7 pass / 0 fail. Nothing here could see a gate that had
// stopped comparing. These cases close that: they are the mutation detector for the compare path.
// ---------------------------------------------------------------------------------------------

test("a real artifact CONTENT difference is REPORTED and exits 1", () => {
  const b = manifest("content-base");
  let touched = 0;
  const h = manifest("content-head", (m) => { touched = withRealDifference(m, "1".repeat(40)); });
  // The fixture must actually carry a difference, or this case proves nothing.
  expect(touched).toBeGreaterThan(0);

  const { code, out } = runDiff(b, h);
  // ⛑ S419 — the comment here used to say the DIFFERING assertion below "is the assertion that dies
  // if the sha comparison is ever short-circuited". It is not the FIRST to die: a blinded comparison
  // yields "VERDICT: NO DIFFERENCES", so the line directly below fails before it is reached. The
  // DIFFERING line is the one that pins the COUNT (all perturbed artifacts, not some of them).
  expect(out).not.toContain("VERDICT: NO DIFFERENCES");
  expect(out).not.toContain("[INCOMPARABLE]");
  expect(out).toContain("DIFFERENCE(S)");
  // Every artifact was perturbed, so every COMPARED artifact must be reported as DIFFERING.
  // Anchored on the whole line, so `4 of 40` / `14 of 4` can never satisfy a `4 of 4` expectation.
  expect(out).toMatch(new RegExp(`^\\s*DIFFERING\\s+: ${touched} of ${touched} compared\\r?$`, "m"));
  expect(code).toBe(1);
});

test("SAME revision + --allow-same-revision + a real difference exits 1 — the opt-in lifts the refusal, never the verdict", () => {
  // ⛑ S419. The previous version of this case built a DIFFERENT revision, so --allow-same-revision
  // was inert in it and a verdict suppressed exactly when the opt-in is effective passed. Here the
  // revisions are equal, and the first half proves the opt-in is load-bearing on this very pair.
  const b = manifest("sameopt-base", (m) => { m.sources.push(synthSource({ artifacts: [plainArtifact("zz.txt", "0")] })); });
  const h = manifest("sameopt-head", (m) => { m.sources.push(synthSource({ artifacts: [plainArtifact("zz.txt", "1")] })); });
  expect(JSON.parse(readFileSync(b, "utf8")).revision).toBe(JSON.parse(readFileSync(h, "utf8")).revision);

  const refused = runDiff(b, h);
  expect(refused.out).toContain("[INCOMPARABLE]");
  expect(refused.code).toBe(2);

  const { code, out } = runDiff(b, h, "--allow-same-revision");
  expect(out).not.toContain("[INCOMPARABLE]");
  expect(out).toContain("VERDICT: 1 DIFFERENCE(S)");
  expect(code).toBe(1);
});

// ---------------------------------------------------------------------------------------------
// the VERDICT floor, per term — one isolated exit-1 case for EVERY term of the `findings` sum
//
// Each pair differs in exactly ONE term and nothing else, asserted via the `--json` report
// (`findings === 1` and that term's list has one entry). That isolation is what makes each case a
// mutation detector for its own term: drop the term from the sum and `findings` is 0, exit is 0.
// A case whose pair also tripped a second term would stay at exit 1 with its own term removed.
// ---------------------------------------------------------------------------------------------

const SYN_PATH = `${ROOT}/zz-synthetic.scrml`;

/** A synthetic source record, independent of whatever the real fixture compiled to. */
function synthSource({ compile = {}, artifacts = [] } = {}) {
  return {
    path: SYN_PATH,
    role: "entry",
    compile: { exitCode: 0, ok: true, stdout: "Compiled 1 file in <MS>ms\n", stderr: "", diagnosticCodes: [], ...compile },
    artifacts,
  };
}

/** A non-checkable artifact (no syntax record), so it can only ever move the artifact terms. */
function plainArtifact(key, shaDigit) {
  return { key, realPath: key, sha256: shaDigit.repeat(64), bytes: 1 };
}

/** A checkable artifact loaded as a module, whose module-goggle verdict is `module`. */
function jsArtifact(module) {
  return {
    key: "zz-synthetic.client.js", realPath: "zz-synthetic.client.js", sha256: "0".repeat(64), bytes: 1,
    loadedAs: "module", loadedAsReason: "synthetic",
    syntax: { script: { ok: true, message: "" }, module },
  };
}
const OK = { ok: true, message: "" };
const BAD = (message) => ({ ok: false, message });

const withSyn = (opts) => (m) => { m.sources.push(synthSource(opts)); };

/**
 * `term` is the expression as it appears in the script's `findings` sum (minus `.length`); the
 * census test below checks this list against the script, so it cannot drift from the code.
 */
const FINDING_TERMS = [
  { term: "srcDelta.onlyA", what: "a source REMOVED in head",
    base: withSyn(), head: undefined, list: (r) => r.sourceSetDelta.onlyA },
  { term: "srcDelta.onlyB", what: "a source ADDED in head",
    base: undefined, head: withSyn(), list: (r) => r.sourceSetDelta.onlyB },
  { term: "newlyFailing", what: "a source NEWLY FAILING to compile",
    base: withSyn(), head: withSyn({ compile: { exitCode: 1, ok: false } }), list: (r) => r.compileFailureDelta.newlyFailing },
  { term: "newlyPassing", what: "a source NEWLY PASSING compile",
    base: withSyn({ compile: { exitCode: 1, ok: false } }), head: withSyn(), list: (r) => r.compileFailureDelta.newlyPassing },
  { term: "diagChanged", what: "a diagnostic-CODE change",
    base: withSyn({ compile: { diagnosticCodes: ["W-SYNTH-A"] } }), head: withSyn({ compile: { diagnosticCodes: ["W-SYNTH-B"] } }),
    list: (r) => r.diagnosticCodeChanges },
  { term: "streamChanged", what: "a diagnostic-TEXT-only change",
    base: withSyn({ compile: { stderr: "note: one\n" } }), head: withSyn({ compile: { stderr: "note: two\n" } }),
    list: (r) => r.diagnosticTextOnlyChanges },
  { term: "artifactAdded", what: "an artifact ADDED in head",
    base: withSyn(), head: withSyn({ artifacts: [plainArtifact("zz.txt", "0")] }), list: (r) => r.artifactSetDelta.added },
  { term: "artifactRemoved", what: "an artifact REMOVED in head",
    base: withSyn({ artifacts: [plainArtifact("zz.txt", "0")] }), head: withSyn(), list: (r) => r.artifactSetDelta.removed },
  { term: "contentDiffs", what: "an artifact CONTENT difference",
    base: withSyn({ artifacts: [plainArtifact("zz.txt", "0")] }), head: withSyn({ artifacts: [plainArtifact("zz.txt", "1")] }),
    list: (r) => r.artifactContentDiffs },
  { term: "checkDelta.onlyA", what: "a syntax failure FIXED in head (effective goggle)",
    base: withSyn({ artifacts: [jsArtifact(BAD("SyntaxError: synthetic"))] }), head: withSyn({ artifacts: [jsArtifact(OK)] }),
    list: (r) => r.syntaxDelta.effective.fixedInHead },
  { term: "checkDelta.onlyB", what: "a syntax failure NEW in head (effective goggle)",
    base: withSyn({ artifacts: [jsArtifact(OK)] }), head: withSyn({ artifacts: [jsArtifact(BAD("SyntaxError: synthetic"))] }),
    list: (r) => r.syntaxDelta.effective.newInHead },
  { term: "messageChanged", what: "a syntax failure on both sides with a CHANGED message",
    base: withSyn({ artifacts: [jsArtifact(BAD("SyntaxError: one"))] }), head: withSyn({ artifacts: [jsArtifact(BAD("SyntaxError: two"))] }),
    list: (r) => r.syntaxDelta.effective.messageChanged },
];

test("the per-term table is populated (a table that empties must fail, not pass vacuously)", () => {
  expect(FINDING_TERMS.length).toBeGreaterThanOrEqual(12);
});

for (const t of FINDING_TERMS) {
  test(`exit 1 on ${t.what} ALONE  [findings term: ${t.term}]`, () => {
    const name = `term-${t.term.replace(/\W/g, "_")}`;
    const b = manifest(`${name}-base`, t.base);
    const h = manifest(`${name}-head`, (m) => { m.revision = "1".repeat(40); if (t.head) t.head(m); });
    const jsonPath = join(tmp, `${name}.diff.json`);
    const { code, out } = runDiff(b, h, "--json", jsonPath);
    expect(out).not.toContain("[INCOMPARABLE]");
    expect(out).not.toContain("[VACUOUS]");
    expect(existsSync(jsonPath)).toBe(true);
    const report = JSON.parse(readFileSync(jsonPath, "utf8"));
    // Isolation: this term, and only this term, carries the difference.
    expect(t.list(report).length).toBe(1);
    expect(report.findings).toBe(1);
    expect(out).toContain("VERDICT: 1 DIFFERENCE(S)");
    expect(code).toBe(1);
  });
}

test("CENSUS: every term of the script's `findings` sum has a case in FINDING_TERMS, and nothing else is summed", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const m = /const findings =([\s\S]*?);/.exec(src);
  expect(m).not.toBeNull();
  const TERM = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.length\b/g;
  const terms = [...m[1].matchAll(TERM)].map((x) => x[1]);
  expect(terms.length).toBeGreaterThan(0);
  // Anything in the sum that is not `<expr>.length` joined by `+` is a term this census cannot see —
  // fail rather than silently under-count.
  expect(m[1].replace(TERM, "").replace(/[+\s]/g, "")).toBe("");
  expect([...terms].sort()).toEqual(FINDING_TERMS.map((t) => t.term).sort());
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

/** Run `capture` against a throwaway work/manifest pair. */
function runCapture(name, ...args) {
  const r = spawnSync(
    "bun",
    [SCRIPT, "capture", "--label", name, "--work", join(tmp, `${name}-work`), "--manifest", join(tmp, `${name}.json`), ...args],
    { encoding: "utf8", cwd: REPO, env: gitFreeEnv() },
  );
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, manifestPath: join(tmp, `${name}.json`) };
}

test("a non-numeric, EMPTY, fractional or out-of-range numeric flag value is rejected, not coerced", () => {
  // ⛑ S419. This case used to pass `--reverify-limit` to `diff`. That flag does not exist on main in
  // EITHER mode, so the case re-tested the unknown-flag branch (it exited 2 on a VALID value too)
  // and proved nothing about numeric values. `diff` has no numeric value flag at all; `capture` has
  // two, `--concurrency` (>= 1) and `--expect-total` (>= 0), and both were plain `Number()` coercion
  // — `"abc"` became NaN, `""` became 0, `"1.5"` an --expect-total that can never match.
  //
  // `--roots` names a root that does not exist, so a flag that is NOT rejected up front still ends in
  // a fast self-check abort (also exit 2) — which is why the MESSAGE is the load-bearing assertion.
  const cases = [
    // `0` for --concurrency is a deliberate BREAK: it used to be clamped to 1 and run. `+2` and ` 3`
    // are refused on purpose — decimal digits only, no sign, no padding (see the script header).
    ...["abc", "", " ", "1.5", "-1", "0", "+2", " 3", "1e1"].map((v) => ["concurrency", v]),
    ...["abc", "", " ", "1.5", "-1", "+2", " 3", "1e1"].map((v) => ["expect-total", v]),
  ];
  expect(cases.length).toBeGreaterThan(0);
  for (const [flag, bad] of cases) {
    const { code, out } = runCapture("argcheck", "--compiler-root", stubRoot, "--roots", "no-such-root", `--${flag}`, bad);
    expect(out).toContain(`--${flag} must be a whole number`);
    expect(code).toBe(2);
  }
  // Control: a VALID value is not rejected by that rule (so the message above is specific to bad input).
  const ok = runCapture("argcheck-ok", "--compiler-root", stubRoot, "--roots", "no-such-root", "--concurrency", "3", "--expect-total", "0");
  expect(ok.out).not.toContain("must be a whole number");
  expect(ok.out).toContain("CAPTURE ABORTED");
});

test("an unknown flag NAME is rejected rather than ignored", () => {
  const p = manifest("argcheck2");
  const r = spawnSync("bun", [SCRIPT, "diff", "--base", p, "--head", p, "--reverify-limits", "10"], {
    encoding: "utf8", cwd: REPO,
  });
  expect(r.status).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// invalid runs — exit 2, NEVER exit 1 (g-differential-invalid-run-exits-1-…)
//
// Exit 1 means "a valid comparison found differences". Before S419 an unwrapped
// `JSON.parse(readFileSync(p))` made a MISSING manifest exit 1, so a wrapper keying on `!= 0` read
// it as a real red and one keying on `== 2` read it as a valid comparison. Each case asserts the
// specific message as well as the code, because the top-level guard ALSO exits 2: a case asserting
// only the code would stay green with the specific handling removed.
// ---------------------------------------------------------------------------------------------

test("a MISSING manifest (either side) is NOT A VALID COMPARISON — exit 2, not 1", () => {
  const good = manifest("missing-good", (m) => { m.revision = "f".repeat(40); });
  const absent = join(tmp, "definitely-not-written.json");
  expect(existsSync(absent)).toBe(false);

  const asBase = runDiff(absent, good);
  expect(asBase.out).toContain("base manifest");
  expect(asBase.out).toContain("cannot be read");
  expect(asBase.code).toBe(2);

  const asHead = runDiff(manifest("missing-good-base"), absent);
  expect(asHead.out).toContain("head manifest");
  expect(asHead.out).toContain("cannot be read");
  expect(asHead.code).toBe(2);
});

test("a CORRUPT (non-JSON) manifest is NOT A VALID COMPARISON — exit 2, not 1", () => {
  const good = manifest("corrupt-good", (m) => { m.revision = "f".repeat(40); });
  const corrupt = join(tmp, "corrupt.json");
  // A truncated real manifest: the realistic corruption (a capture killed mid-write).
  const text = readFileSync(good, "utf8");
  writeFileSync(corrupt, text.slice(0, Math.floor(text.length / 2)));
  const { code, out } = runDiff(corrupt, good);
  expect(out).toContain("is not valid JSON");
  expect(code).toBe(2);
});

test("valid JSON that is not a manifest is NOT A VALID COMPARISON — exit 2, not 1", () => {
  const good = manifest("shape-good", (m) => { m.revision = "f".repeat(40); });
  const cases = [
    ["null", "is not a JSON object"],
    ["[]", "is not a JSON object"],
    [`{"schemaVersion": ${baseManifest.schemaVersion}}`, "is missing or has a wrongly-typed field: label"],
    // Top level intact, one SOURCE element malformed: without the per-element check this still
    // exits 2, but only via the top-level guard's stack trace, so the message is what pins it.
    [JSON.stringify({ ...baseManifest, sources: [...baseManifest.sources, { path: "x.scrml" }] }), "sources[].{path,compile,artifacts}"],
  ];
  expect(cases.length).toBeGreaterThan(0);
  for (const [i, [body, msg]] of cases.entries()) {
    const p = join(tmp, `shape-${i}.json`);
    writeFileSync(p, body + "\n");
    const { code, out } = runDiff(p, good);
    expect(out).toContain(msg);
    expect(code).toBe(2);
  }
});

test("an UNEXPECTED throw in diff (an unwritable --json path) exits 2 via the top-level guard, not 1", () => {
  const b = manifest("guard-base");
  const h = manifest("guard-head", (m) => { m.revision = "f".repeat(40); });
  // Control: the same pair WITHOUT --json is a valid, clean comparison that prints its verdict on
  // stdout — so the absence asserted below is caused by the failure, not by a pair that never
  // reaches a verdict.
  const clean = runDiff(b, h);
  expect(clean.code).toBe(0);
  expect(clean.stdout).toMatch(/^VERDICT: NO DIFFERENCES/m);

  // `tmp` is a directory, so writing the JSON report to it throws EISDIR after the verdict is computed.
  const { code, out, stdout } = runDiff(b, h, "--json", tmp);
  expect(out).toContain("NOT A VALID RUN");
  expect(code).toBe(2);
  // ⛑ S419 fix round. STDOUT ALONE must carry no verdict. The JSON write used to follow the banner,
  // so a stdout-only log of this crashed run read `VERDICT: NO DIFFERENCES`. Combined output cannot
  // see that (the stderr NOT A VALID RUN is in it too), so this reads stdout by itself.
  expect(stdout).not.toMatch(/VERDICT:/);
});

test("a capture SELF-CHECK abort exits 2 (a capture never exits 1)", () => {
  const { code, out, manifestPath } = runCapture("abort", "--compiler-root", stubRoot, "--roots", "no-such-root");
  expect(out).toContain("CAPTURE ABORTED");
  expect(existsSync(manifestPath)).toBe(false);
  expect(code).toBe(2);
});

test("an UNEXPECTED throw in capture (a root that is a file) exits 2 via the top-level guard, not 1", () => {
  const { code, out, manifestPath } = runCapture("crash", "--compiler-root", stubRoot, "--roots", "not-a-dir.txt");
  expect(out).toContain("NOT A VALID RUN");
  expect(out).toContain("unreadable directory");
  expect(existsSync(manifestPath)).toBe(false);
  expect(code).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// revision provenance — g-emit-differential-revision-inherited-from-enclosing-repo
//
// `gitRevision()` ran `git rev-parse HEAD` in `--compiler-root`, and git walks UPWARD, so a root
// that is not its own git toplevel recorded the ENCLOSING repository's HEAD. The fixture below is a
// throwaway git repo (OUTER) with a stub compiler, and a non-git directory INSIDE it (INNER) with
// its own stub compiler. The stub writes one artifact per source so a capture is real and fast.
// ---------------------------------------------------------------------------------------------

/** The child environment minus GIT_* — a GIT_DIR inherited from a hook would redirect every git call. */
function gitFreeEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/i.test(k)) delete env[k];
  return env;
}

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", env: gitFreeEnv(),
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

const STUB_CLI =
  `import { mkdirSync, writeFileSync } from "node:fs";\n` +
  `import { join } from "node:path";\n` +
  `const out = process.argv[process.argv.indexOf("-o") + 1];\n` +
  `mkdirSync(out, { recursive: true });\n` +
  `writeFileSync(join(out, "a.client.js"), "var a = 1;\\n");\n`;

function stubCompilerTree(dir, cli = STUB_CLI) {
  mkdirSync(join(dir, "compiler", "src"), { recursive: true });
  writeFileSync(join(dir, "compiler", "src", "cli.js"), cli);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.scrml"), "<p>stub</p>\n");
}

let outer;
let outerHead;
beforeAll(() => {
  outer = join(tmp, "outer-repo");
  stubCompilerTree(outer);
  stubCompilerTree(join(outer, "inner"));
  git(outer, "init", "-q");
  git(outer, "commit", "-q", "--allow-empty", "-m", "fixture");
  outerHead = git(outer, "rev-parse", "HEAD");
  expect(outerHead).toMatch(/^[0-9a-f]{40}$/);
}, 60_000);

test("a compiler root that IS its own git toplevel records that repo's HEAD (positive control)", () => {
  const { code, out, manifestPath } = runCapture("rev-outer", "--compiler-root", outer, "--roots", "src", "--concurrency", "1");
  expect(code, out).toBe(0);
  expect(JSON.parse(readFileSync(manifestPath, "utf8")).revision).toBe(outerHead);
});

test("a compiler root reached through a junction/symlink to its own toplevel still records the real HEAD", () => {
  const link = join(tmp, "outer-link");
  symlinkSync(outer, link, process.platform === "win32" ? "junction" : "dir");
  const { code, out, manifestPath } = runCapture("rev-link", "--compiler-root", link, "--roots", "src", "--concurrency", "1");
  expect(code, out).toBe(0);
  expect(JSON.parse(readFileSync(manifestPath, "utf8")).revision).toBe(outerHead);
});

test("a compiler root spelled in a different CASE (win32) still records the real HEAD", () => {
  // git reports the toplevel as `C:/x/y`; the root arrives however the caller typed it. On win32 the
  // filesystem is case-insensitive, so an upper-cased spelling is the same directory. On POSIX the
  // spelling is left as-is and this is a second positive control.
  const spelled = process.platform === "win32" ? outer.toUpperCase() : outer;
  const { code, out, manifestPath } = runCapture("rev-case", "--compiler-root", spelled, "--roots", "src", "--concurrency", "1");
  expect(code, out).toBe(0);
  expect(JSON.parse(readFileSync(manifestPath, "utf8")).revision).toBe(outerHead);
});

test("a compiler root that is NOT its own git toplevel records <unknown>, never the ENCLOSING repo's HEAD", () => {
  const { code, out, manifestPath } = runCapture("rev-inner", "--compiler-root", join(outer, "inner"), "--roots", "src", "--concurrency", "1");
  expect(code, out).toBe(0);
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  expect(m.sources.some((s) => s.artifacts.length > 0)).toBe(true);
  expect(m.revision).not.toBe(outerHead);
  expect(m.revision).toBe("<unknown>");
  expect(out).toContain("is NOT its own git toplevel");
});

test("the same-revision guard REFUSES an inherited-revision manifest instead of reasoning about a HEAD it never had", () => {
  // Pre-S419 this pair was base = the ENCLOSING repo's HEAD vs head = a different revision with
  // identical content: a clean exit 0 over provenance neither side has.
  const inner = runCapture("rev-inner-guard", "--compiler-root", join(outer, "inner"), "--roots", "src", "--concurrency", "1");
  expect(inner.code, inner.out).toBe(0);
  const headPath = join(tmp, "rev-inner-guard-head.json");
  const hm = JSON.parse(readFileSync(inner.manifestPath, "utf8"));
  hm.revision = "f".repeat(40);
  hm.label = "rev-inner-guard-head";
  writeFileSync(headPath, JSON.stringify(hm, null, 2) + "\n");

  const { code, out } = runDiff(inner.manifestPath, headPath);
  expect(out).toContain(`revision is "<unknown>"`);
  expect(out).toContain("[INCOMPARABLE]");
  expect(code).toBe(2);
});

// ---------------------------------------------------------------------------------------------
// the two LATER capture abort sites — exit 2 (S419 fix round: both were unpinned; reverting either
// to `return 1` left the suite green)
// ---------------------------------------------------------------------------------------------

test("a capture ARTIFACT-stage abort (two artifacts collapsing to one comparison key) exits 2", () => {
  // Two content-addressed runtime files normalise to the same key `scrml-runtime.<HASH>.js`, so one
  // would silently shadow the other in every comparison. Capture refuses; this is the real
  // artifact-stage self-check, reached hermetically with a stub compiler that emits both.
  const root = join(tmp, "dup-key-root");
  stubCompilerTree(
    root,
    `import { mkdirSync, writeFileSync } from "node:fs";\n` +
      `import { join } from "node:path";\n` +
      `const out = process.argv[process.argv.indexOf("-o") + 1];\n` +
      `mkdirSync(out, { recursive: true });\n` +
      `writeFileSync(join(out, "scrml-runtime.aaaa1111.js"), "var a = 1;\\n");\n` +
      `writeFileSync(join(out, "scrml-runtime.bbbb2222.js"), "var b = 2;\\n");\n`,
  );
  const { code, out, manifestPath } = runCapture("dup-key", "--compiler-root", root, "--roots", "src", "--concurrency", "1");
  expect(out).toContain("duplicate artifact keys");
  expect(out).toContain("artifact-stage self-check failure");
  expect(existsSync(manifestPath)).toBe(false);
  expect(code).toBe(2);
});

test("a capture SYNTAX-stage abort (the goggle worker returns no result for a job) exits 2", () => {
  // The shipped worker writes a result for every job id it is given, so this branch is unreachable
  // through it; it is the defence against a worker that misbehaves. The worker is resolved NEXT TO
  // the script (`import.meta.url`), so the hermetic way in is a byte-identical copy of the script
  // beside a worker that exits 0 having answered nothing. The script under test is unmodified.
  const dir = join(tmp, "script-copy");
  mkdirSync(dir, { recursive: true });
  const copy = join(dir, "corpus-emit-differential.ts");
  writeFileSync(copy, readFileSync(SCRIPT));
  expect(readFileSync(copy).equals(readFileSync(SCRIPT))).toBe(true);
  // The repo's own package.json declares `"type": "module"`, which is what makes the REAL
  // `corpus-check-goggles.js` parse as ESM. A copy that omits it is not a faithful copy: node
  // falls back to CJS for a bare `.js`, the stub below dies at its `import` with a SyntaxError,
  // and the script aborts for the WRONG reason — so the assertion below was being satisfied by
  // a parse failure rather than by the no-result branch it names. Carry the declaration with
  // the copy, exactly as the script's real neighbourhood supplies it.
  writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`);
  writeFileSync(
    join(dir, "corpus-check-goggles.js"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[3], "{}");\n`,
  );
  const root = join(tmp, "no-result-root");
  stubCompilerTree(root); // emits one checkable a.client.js, so the goggle stage has a job
  const r = spawnSync(
    "bun",
    [copy, "capture", "--label", "no-result", "--work", join(tmp, "no-result-work"), "--manifest", join(tmp, "no-result.json"),
     "--compiler-root", root, "--roots", "src", "--concurrency", "1"],
    { encoding: "utf8", cwd: REPO, env: gitFreeEnv() },
  );
  const out = `${r.stdout}\n${r.stderr}`;
  expect(out).toContain("goggle worker returned no result");
  expect(out).toContain("syntax-stage self-check failure");
  expect(existsSync(join(tmp, "no-result.json"))).toBe(false);
  expect(r.status).toBe(2);
});
