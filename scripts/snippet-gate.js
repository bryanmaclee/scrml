#!/usr/bin/env bun
/**
 * scripts/snippet-gate.js
 *
 * Compile-gate over the PUBLIC SNIPPET CORPUS — every `.scrml` file that a
 * public-facing document cites. If a snippet stops compiling, the document
 * citing it is making a false claim, and this fails the build.
 *
 * WHY (S280): public content makes claims, and a claim that was true when
 * written rots silently — nothing fails when a published sample goes stale.
 * Evidence: bryan's outreach email carried a worked example using `@name`
 * decls, `<machine>`, and `->` match arms; all three are now invalid syntax.
 *
 * WHY REAL FILES AND NOT FENCED BLOCKS — the load-bearing design call.
 * The obvious approach is to extract ```scrml fences from markdown and compile
 * each. It was built (`scripts/claim-gate.js`) and MEASURED first: 24 files,
 * 149 blocks, 92 failures — of which nearly all were artifacts of compiling a
 * NARRATIVE FRAGMENT standalone (a component defined in an earlier block, a
 * `<program db=>` root living elsewhere). It measured "is this a self-contained
 * program", not "is this claim stale".
 *
 * And the fence approach has a worse structural problem. It needs an opt-out
 * marker for genuine fragments — and an opt-out gate under fragment pressure
 * degrades to zero coverage. That is not hypothetical: `README.md` carries 4
 * scrml blocks and ALL FOUR are `// gate: skip`, so the S101 README gate has
 * reported green since 2026-05-18 while checking nothing.
 *
 * A real file has no such failure mode. It is a whole program: it compiles or
 * it does not, there is no marker to abuse, and the document citing it cannot
 * drift from it because there is only one copy.
 *
 * PRECEDENT: this generalizes `docs/tutorial-snippets/verify-tutorial.sh`
 * (which was correct and wired to nothing). Two changes:
 *   1. DISCOVERS `.scrml` files instead of hardcoding a filename list — the
 *      old script named 11 snippets, so a new one dropped in the directory was
 *      silently unchecked.
 *   2. Runs in CI as a required check, not by hand.
 *
 * MODES:
 *   `bun scripts/snippet-gate.js`             GATE  — exit 1 on any failure.
 *   `bun scripts/snippet-gate.js --list`      list the discovered corpus, compile nothing.
 *   `bun scripts/snippet-gate.js [paths...]`  override the corpus with explicit paths
 *                                             (compile only; the drift check needs the full corpus).
 *   `bun scripts/snippet-gate.js --drift-only` run only the DRIFT check (fast, no compiles).
 *   `bun scripts/snippet-gate.js --strict`     also fail on a stale spec-ahead marker.
 *   `bun scripts/snippet-gate.js --docs=a.md,b.md [paths...]` scan these documents (not the
 *                                             repo's) for dialect/spec-ahead markers (tests).
 *
 * DRIFT CHECK (2026-09-29). Real files close the drift hole only when the
 * document LINKS to the file. docs/tutorial.md instead showed COPIES of its
 * snippet files, and the copies drifted while the files stayed green (the
 * tutorial's §2.2 and §5 lost `db=`; §7/§9/§10 never had a file at all). So a
 * fenced block may now carry a `<!-- snippet: path -->` marker, and the gate
 * fails if the block is not the file. The contract and mechanics live in
 * `scripts/snippet-drift.js`. This is not a compile of the fence: the FILE is
 * compiled (here) and the fence is compared to the file (there).
 *
 * TWO COMPILERS (S469, "Ruled dialect, bootstrap-gated"). A file cited by a
 * document marked `<!-- dialect: ruled -->` is in the RULED dialect, which impl#1
 * does not parse, so it is compiled by the BOOTSTRAP (`scripts/scrml-boot.ts`
 * compileSource, what `bun run boot:compile` runs); its diagnostics alone decide.
 * Every other file is compiled by impl#1, as before. The citing document is the
 * one opt-in (scripts/doc-gate-markers.js collectSnippetDialects); the file
 * carries no marker. A citing block marked `<!-- gate: spec-ahead — <reason> -->`
 * makes its file SPEC-AHEAD: still compiled by the bootstrap, a failure is
 * expected and listed, and a CLEAN compile is reported as "remove the marker"
 * (a failure only with `--strict`). A marker error in a citing or ruled document
 * fails the gate. Contributor guide: `docs/DIALECT.md`.
 *
 * Authored S280 (2026-07-22). Bootstrap mode S469.
 */

import { existsSync, statSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, extname, dirname, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { checkDrift, discoverDocs, SNIPPET_CORPUS as DRIFT_SNIPPET_CORPUS } from "./snippet-drift.js";
import { collectSnippetDialects } from "./doc-gate-markers.js";
import { execFileSync } from "child_process";

/**
 * The PUBLIC SNIPPET CORPUS. Every `.scrml` under these roots must compile.
 * Adding a row is the act that puts a surface under the gate — deliberately
 * explicit. A declared-but-absent row is tolerated so a row may pre-date its
 * directory.
 */
// The list lives in scripts/snippet-drift.js (SNIPPET_CORPUS: docs/tutorial-snippets,
// docs/readme-snippets, docs/website) so claim-gate can check a snippet marker's target
// against it. S292 added docs/website — the scrml.dev pages, the most-read public surface,
// gated as a root so a new page is gated by existing. NB: this gates that a page
// COMPILES; it cannot gate whether its PROSE is true.
const SNIPPET_CORPUS = DRIFT_SNIPPET_CORPUS;

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const driftOnly = args.includes("--drift-only");
const strictMode = args.includes("--strict");
const explicit = args.filter((a) => !a.startsWith("--"));
const corpus = explicit.length > 0 ? explicit : SNIPPET_CORPUS;

/** Recursively discover every `.scrml` under the corpus roots. */
function discover(roots) {
  const out = [];
  const seen = new Set();
  const walk = (p) => {
    if (!existsSync(p)) return; // declared-but-absent is not an error
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
      return;
    }
    if (extname(p) !== ".scrml") return;
    // POSIX separators (S469): `join` writes `\` on Windows, and every printed path, the
    // dialect map and the tests compare `/`-separated paths. Bun's fs accepts `/` there too.
    const posix = p.split(sep).join("/");
    if (seen.has(posix)) return;
    seen.add(posix);
    out.push(posix);
  };
  for (const r of roots) walk(r);
  return out.sort();
}

const files = discover(corpus);

// REFUSE AN EMPTY CORPUS (S364). This previously exited 0 — a gate reporting
// success while compiling nothing. It is a BLOCKING CI check, so the failure
// mode was: rename `docs/website`, and the most-read public surface leaves the
// gate silently while CI stays green. The gate's own header already records this
// exact class one directory over ("the S101 README gate has reported green since
// 2026-05-18 while checking nothing"); it had the shape itself.
//
// Zero discovered files is never a legitimate success. It means a declared root
// was renamed away, the extension filter drifted, or an explicit path argument
// was wrong — every one of which is a thing to hear about. Mirrors
// scripts/browser-baseline.ts's refusal, which is the reference pattern here.
if (files.length === 0) {
  console.error("snippet-gate: NO .scrml FILES DISCOVERED — refusing to report success.");
  console.error("  A gate that compiled nothing has verified nothing (that is the hollow-gate shape).");
  console.error(`  corpus: ${corpus.join(", ")}`);
  for (const r of corpus) {
    console.error(`    ${existsSync(r) ? "exists but holds no .scrml" : "DOES NOT EXIST"}  ${r}`);
  }
  console.error("  Most likely cause: a declared corpus root was renamed or moved.");
  process.exit(1);
}

if (listOnly) {
  console.log(`snippet-gate — ${files.length} snippet(s) in corpus:`);
  for (const f of files) console.log(`  ${f}`);
  process.exit(0);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─── DIALECT: which compiler each file gets (S469) ─────────────────────────
// Derived from the documents that cite the files; computed on every run, so an
// explicit-path compile uses the same compiler CI would.
// `--docs=a.md,b.md` overrides the scanned documents (tests; a doc outside the repo).
const docsArg = args.find((a) => a.startsWith("--docs="));
const dialects = collectSnippetDialects(
  (doc) => readFileSync(resolve(repoRoot, doc), "utf8"),
  // POSIX like every other printed path (S469): discoverDocs already yields `/`-separated
  // repo-relative paths; an explicit `--docs=` path built with `join` on Windows does not.
  docsArg ? docsArg.slice("--docs=".length).split(",").filter(Boolean).map((d) => d.split(sep).join("/")) : discoverDocs(repoRoot),
);
// Marker paths are repo-relative (or absolute); compare as absolute paths.
const dialectByAbs = new Map([...dialects.byFile].map(([p, d]) => [resolve(repoRoot, p), d]));
const dialectOf = (file) => dialectByAbs.get(resolve(file)) ?? { dialect: "impl1", specAhead: null };
for (const e of dialects.errors) console.error(`  MARKER ${e.doc}:${e.line} — ${e.message}`);
const markerFailed = dialects.errors.length > 0;

// ─── DRIFT: a documented copy must equal its file ──────────────────────────
// Runs whenever the full corpus is in play (not for an explicit-path compile).
let driftFailed = false;
if (explicit.length === 0) {
  const drift = checkDrift(repoRoot, SNIPPET_CORPUS);
  for (const f of drift.failures) {
    console.error(`  DRIFT ${f.doc}:${f.line} — ${f.message}`);
    if (f.diff) for (const l of f.diff) console.error(`        ${l}`);
  }
  console.log(
    `snippet-gate drift: ${drift.checked} marked block(s) checked across ` +
      `${drift.docsWithMarkers.length} document(s), ${drift.failures.length} failure(s).`,
  );
  driftFailed = drift.failures.length > 0;
  if (driftFailed) {
    console.error(
      "A document shows a copy of a snippet file that no longer matches the file. Make them " +
        "equal: the FILE is what CI compiles, so decide which side is correct scrml today and copy it to the other.",
    );
  }
}
if (driftOnly) process.exit(driftFailed || markerFailed ? 1 : 0);

const outDir = mkdtempSync(join(tmpdir(), "snippet-gate-"));
let passed = 0;
const failures = [];
const perMode = {
  impl1: { files: 0, passed: 0, failed: 0 },
  ruled: { files: 0, passed: 0, failed: 0, specAhead: 0, stale: 0 },
};
const specAheadList = [];
const staleList = [];
let bootMod = null; // loaded only when a ruled file exists: an impl1-only run never pays for the bundle

for (const file of files) {
  const d = dialectOf(file);
  if (d.dialect === "ruled") {
    perMode.ruled.files++;
    if (bootMod === null) bootMod = await import("./doc-boot-check.js");
    const r = await bootMod.bootCheck(resolve(file));
    if (d.specAhead) {
      // One rule for both gates (doc-boot-check.js classifySpecAhead): a crash or a
      // pin mismatch is a failure; a clean compile is stale; else the expected failure.
      const c = bootMod.classifySpecAhead(r, d.specAhead.codes);
      if (c.verdict === "crash" || c.verdict === "pin-mismatch") {
        perMode.ruled.failed++;
        failures.push({ file, output: `spec-ahead marker at ${d.specAhead.doc}:${d.specAhead.line}: ${c.message}\n${r.lines.join("\n")}` });
        console.log(`  FAIL  ${file}  (bootstrap; spec-ahead ${c.verdict})`);
        continue;
      }
      if (r.ok) {
        perMode.ruled.stale++;
        staleList.push({ file, ...d.specAhead });
        console.log(`  STALE ${file}  (bootstrap; spec-ahead marker at ${d.specAhead.doc}:${d.specAhead.line} — it compiles now, remove the marker)`);
        if (strictMode) {
          perMode.ruled.failed++;
          failures.push({ file, output: `stale spec-ahead marker (--strict): ${file} now compiles on the bootstrap — remove the marker at ${d.specAhead.doc}:${d.specAhead.line}` });
        }
      } else {
        perMode.ruled.specAhead++;
        specAheadList.push({ file, ...d.specAhead, said: bootMod.codeSummary(r.codes) });
        console.log(`  AHEAD ${file}  (bootstrap; spec-ahead — ${d.specAhead.reason})`);
      }
      continue;
    }
    if (r.ok) {
      passed++;
      perMode.ruled.passed++;
      console.log(`  PASS  ${file}  (bootstrap)`);
    } else {
      perMode.ruled.failed++;
      failures.push({ file, output: r.lines.join("\n") });
      console.log(`  FAIL  ${file}  (bootstrap)`);
    }
    continue;
  }
  perMode.impl1.files++;
  try {
    execFileSync("bun", ["compiler/bin/scrml.js", "compile", file, "-o", outDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    passed++;
    perMode.impl1.passed++;
    console.log(`  PASS  ${file}`);
  } catch (err) {
    const output =
      (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
    perMode.impl1.failed++;
    failures.push({ file, output });
    console.log(`  FAIL  ${file}`);
  }
}

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error("");
  console.error("=== snippet-gate — failure detail ===");
  for (const f of failures) {
    console.error(`\n--- ${f.file} ---`);
    console.error(
      f.output
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .slice(-12)
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }
}

if (specAheadList.length > 0) {
  console.log("");
  console.log(`spec-ahead files (${specAheadList.length}) — ruled scrml the bootstrap cannot compile yet:`);
  for (const s of specAheadList) console.log(`  ${s.file} — ${s.reason}  [bootstrap: ${s.said}]  (marker ${s.doc}:${s.line})`);
}
if (staleList.length > 0) {
  console.log("");
  console.log(`STALE spec-ahead markers (${staleList.length}) — these files NOW COMPILE on the bootstrap; remove the marker:`);
  for (const s of staleList) console.log(`  ${s.doc}:${s.line} — ${s.file} (was: ${s.reason})`);
}

console.log("");
console.log(
  `per mode: impl1 — ${perMode.impl1.files} file(s), ${perMode.impl1.passed} pass, ${perMode.impl1.failed} fail · ` +
    `bootstrap (ruled) — ${perMode.ruled.files} file(s), ${perMode.ruled.passed} pass, ` +
    `${perMode.ruled.specAhead} spec-ahead, ${perMode.ruled.stale} stale, ${perMode.ruled.failed} fail`,
);
const aheadTotal = perMode.ruled.specAhead + perMode.ruled.stale;
console.log(
  `snippet-gate: ${passed} passed, ${failures.length} failed${aheadTotal ? `, ${aheadTotal} spec-ahead` : ""} (${files.length} total).`,
);

if (failures.length > 0) {
  console.error("");
  console.error(
    "A public document cites each of these files. A snippet that no longer compiles " +
      "means that document is making a false claim — fix the snippet, or if the feature " +
      "genuinely changed, fix the document too.",
  );
}

if (markerFailed) {
  console.error("");
  console.error("A citing document has a gate/dialect marker error (MARKER lines above) — see docs/DIALECT.md.");
}

process.exit(failures.length > 0 || driftFailed || markerFailed ? 1 : 0);
