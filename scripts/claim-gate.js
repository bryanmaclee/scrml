#!/usr/bin/env bun
/**
 * scripts/claim-gate.js
 *
 * The C1 (code-claim) half of the marketing claim-gate. Generalizes the S101
 * `scripts/extract-readme-scrml.js` from one file to a declared PUBLIC SURFACE.
 *
 * WHY (S280): marketing/public content makes CLAIMS, and a claim that was true
 * when written rots silently — nothing fails when a published code sample stops
 * compiling. Evidence: bryan's outreach email carried a worked example using
 * `@name` decls, `<machine>`, and `->` match arms; all three are now invalid
 * syntax. A compile-gate over public content fails that on sight.
 *
 * SCOPE — what is gated and what is deliberately NOT:
 *   GATED   public-facing surfaces (see PUBLIC_SURFACE below). Anything that
 *           leaves the building: README, articles, tutorial, adopter docs, site
 *           copy, outbound marketing.
 *   NOT     `handOffs/incoming/**` — inbound BUG REPRODUCERS. These are
 *           intentionally-broken code by construction; gating them is incoherent.
 *   NOT     `compiler/SPEC.md` — 764 blocks, many of which deliberately
 *           demonstrate a diagnostic firing (an error-demo SHOULD fail to
 *           compile). Gating the spec needs its own expected-outcome grammar.
 *   NOT     `docs/changes/**`, `handOffs/**` — internal briefs + frozen
 *           continuity records, historical by design.
 *
 * Per-block behavior (inherited from the S101 gate, unchanged):
 *   - Default: compile + ghost-pattern-lint clean. Any error fails; any
 *     `W-LINT-*` ghost-pattern lint fails.
 *   - Opt-out: a block whose first non-blank line is `// gate: skip` is skipped
 *     (illustrative fragments that aren't standalone-runnable).
 *   The marker is opt-OUT (default-gated) because accuracy is the load-bearing
 *   intent on a public surface.
 *
 * MODES:
 *   `bun scripts/claim-gate.js`            GATE   — exit 1 on any failure (CI + hook).
 *   `bun scripts/claim-gate.js --report`   REPORT — never exit non-zero; print the
 *                                          tally only. Use to MEASURE a surface
 *                                          before promoting it into the gate
 *                                          (the §8 measured-migration discipline:
 *                                          assumed-zero is not measured-zero).
 *   `bun scripts/claim-gate.js [paths...]` override the surface with explicit paths.
 *
 * Exit: 0 on all-pass (or any --report run); 1 on any failure in GATE mode.
 *
 * Authored S280 (2026-07-22). `scripts/extract-readme-scrml.js` (S101) was
 * RETIRED in the same landing: its gate role passed to `scripts/snippet-gate.js`
 * (real files), and its fence-extraction capability lives on here as a survey
 * instrument.

import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import { execFileSync } from "child_process";
import { lintGhostPatterns } from "../compiler/src/lint-ghost-patterns.js";

/**
 * The declared PUBLIC SURFACE. A path may be a file or a directory (walked
 * recursively for `.md`). Adding a row here is the act that puts a surface
 * under the gate — deliberately explicit, never a broad glob, because the
 * non-gated buckets above are non-gated for real reasons.
 */
const PUBLIC_SURFACE = [
  "README.md",
  "NERDME.md",
  "DESIGN.md",
  "docs/tutorial.md",
  "docs/articles",
  "docs/adopter",
  "marketing", // does not exist yet; tolerated-absent so the row can pre-date the dir
];

const args = process.argv.slice(2);
const reportMode = args.includes("--report");
const explicitPaths = args.filter((a) => !a.startsWith("--"));
const surface = explicitPaths.length > 0 ? explicitPaths : PUBLIC_SURFACE;

/** Expand the surface into a concrete .md file list (tolerates absent rows). */
function collectMarkdown(paths) {
  const out = [];
  const seen = new Set();
  const walk = (p) => {
    if (!existsSync(p)) return; // a declared-but-absent row is not an error
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
      return;
    }
    if (extname(p) !== ".md") return;
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  for (const p of paths) walk(p);
  return out.sort();
}

/** Extract every ```scrml fenced block plus its 1-based start line. */
function extractBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  let inBlock = false;
  let blockStartLine = 0;
  let blockBody = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && line.trimEnd() === "```scrml") {
      inBlock = true;
      blockStartLine = i + 2; // first content line is i+2 (1-based)
      blockBody = [];
      continue;
    }
    if (inBlock && line.trimEnd() === "```") {
      blocks.push({ startLine: blockStartLine, body: blockBody.join("\n") });
      inBlock = false;
      continue;
    }
    if (inBlock) blockBody.push(line);
  }
  return blocks;
}

const files = collectMarkdown(surface);
if (files.length === 0) {
  console.log("claim-gate: no markdown files resolved from the declared surface.");
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), "claim-gate-"));
let passed = 0;
let skipped = 0;
let failed = 0;
let blockTotal = 0;
const failures = [];
const perFile = [];

for (const file of files) {
  const blocks = extractBlocks(readFileSync(file, "utf8"));
  if (blocks.length === 0) continue;

  let filePassed = 0;
  let fileSkipped = 0;
  let fileFailed = 0;

  for (let i = 0; i < blocks.length; i++) {
    const { body, startLine } = blocks[i];
    const blockNum = i + 1;
    blockTotal++;

    const firstContentLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
    if (/^\s*\/\/\s*gate:\s*skip\b/.test(firstContentLine)) {
      skipped++;
      fileSkipped++;
      continue;
    }

    // Compile check.
    const path = join(tempDir, `snippet-${blockTotal}.scrml`);
    writeFileSync(path, body);
    let compileOk = true;
    let compileOutput = "";
    try {
      execFileSync("bun", ["run", "compiler/src/cli.js", "compile", path], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      compileOk = false;
      compileOutput =
        (err.stderr ? err.stderr.toString() : "") + (err.stdout ? err.stdout.toString() : "");
    }

    // Ghost-pattern lint (run regardless of compile result — both classes surface).
    const ghostDiags = lintGhostPatterns(body, path);
    const ghostFailing = ghostDiags.length > 0;

    if (compileOk && !ghostFailing) {
      passed++;
      filePassed++;
      continue;
    }

    failed++;
    fileFailed++;
    const why = [];
    if (!compileOk) why.push("compile-fail");
    if (ghostFailing) why.push(`${ghostDiags.length} ghost-pattern lint(s)`);
    failures.push({ file, blockNum, startLine, why: why.join("; "), compileOutput, ghostDiags });
  }

  perFile.push({ file, passed: filePassed, skipped: fileSkipped, failed: fileFailed });
}

rmSync(tempDir, { recursive: true, force: true });

// ---- report -------------------------------------------------------------
console.log(`claim-gate — ${files.length} file(s), ${blockTotal} scrml block(s)`);
console.log("");
for (const f of perFile) {
  const flag = f.failed > 0 ? "FAIL" : "ok  ";
  console.log(
    `  ${flag}  ${f.file}  (${f.passed} pass, ${f.skipped} skip, ${f.failed} fail)`,
  );
}

if (failed > 0 && !reportMode) {
  console.error("");
  console.error("=== claim-gate — failure detail ===");
  for (const f of failures) {
    console.error(`\n--- ${f.file}:${f.startLine}  block #${f.blockNum} — ${f.why} ---`);
    if (f.compileOutput) {
      console.error(
        f.compileOutput
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(0, 10)
          .map((l) => `  ${l}`)
          .join("\n"),
      );
    }
    for (const d of f.ghostDiags.slice(0, 5)) {
      console.error(`    ${d.code ?? "W-LINT-?"}: ${d.message ?? ""}`);
    }
  }
}

console.log("");
console.log(
  `claim-gate: ${passed} passed, ${skipped} skipped, ${failed} failed (${blockTotal} total).`,
);

if (failed > 0) {
  console.log("");
  console.log(
    "A genuinely non-runnable illustrative fragment may opt out with `// gate: skip` " +
      "as its first content line. Everything else is a real stale-claim finding.",
  );
}

if (reportMode) {
  console.log("");
  console.log("(--report: measurement mode, exit 0 regardless.)");
  process.exit(0);
}

process.exit(failed > 0 ? 1 : 0);
