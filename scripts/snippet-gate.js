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
 *   `bun scripts/snippet-gate.js [paths...]`  override the corpus with explicit paths.
 *
 * Authored S280 (2026-07-22).
 */

import { existsSync, statSync, readdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import { execFileSync } from "child_process";

/**
 * The PUBLIC SNIPPET CORPUS. Every `.scrml` under these roots must compile.
 * Adding a row is the act that puts a surface under the gate — deliberately
 * explicit. A declared-but-absent row is tolerated so a row may pre-date its
 * directory.
 */
const SNIPPET_CORPUS = [
  "docs/tutorial-snippets",
  "docs/readme-snippets",
];

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
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
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  for (const r of roots) walk(r);
  return out.sort();
}

const files = discover(corpus);

if (files.length === 0) {
  console.log("snippet-gate: no .scrml files discovered in the declared corpus.");
  console.log(`  corpus: ${corpus.join(", ")}`);
  process.exit(0);
}

if (listOnly) {
  console.log(`snippet-gate — ${files.length} snippet(s) in corpus:`);
  for (const f of files) console.log(`  ${f}`);
  process.exit(0);
}

const outDir = mkdtempSync(join(tmpdir(), "snippet-gate-"));
let passed = 0;
const failures = [];

for (const file of files) {
  try {
    execFileSync("bun", ["compiler/bin/scrml.js", "compile", file, "-o", outDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    passed++;
    console.log(`  PASS  ${file}`);
  } catch (err) {
    const output =
      (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
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

console.log("");
console.log(
  `snippet-gate: ${passed} passed, ${failures.length} failed (${files.length} total).`,
);

if (failures.length > 0) {
  console.error("");
  console.error(
    "A public document cites each of these files. A snippet that no longer compiles " +
      "means that document is making a false claim — fix the snippet, or if the feature " +
      "genuinely changed, fix the document too.",
  );
}

process.exit(failures.length > 0 ? 1 : 0);
