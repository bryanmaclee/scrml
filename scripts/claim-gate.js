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
 *   NOT     `docs/articles/archive/**` — superseded drafts (S469 "Archive old
 *           drafts"). Each carries a "superseded, do not paste" banner.
 *
 * TWO COMPILERS, CHOSEN BY THE DOCUMENT (S469, "Ruled dialect, bootstrap-gated").
 * Public docs are being rewritten, doc by doc, into today's RULED scrml, which
 * impl#1 does not parse. A document opts in with `<!-- dialect: ruled -->` (or
 * front matter `dialect: ruled`); its blocks are then compiled by the BOOTSTRAP
 * (`scripts/scrml-boot.ts` compileSource — what `bun run boot:compile` runs), and
 * the bootstrap's diagnostics alone decide pass/fail. Every other document keeps
 * the impl#1 behaviour below, so nothing silently stops being gated. The marker
 * grammar lives in `scripts/doc-gate-markers.js`; the contributor guide is
 * `docs/DIALECT.md`.
 *
 * Per-block behavior:
 *   - SNIPPET-DELEGATED: a block under a `<!-- snippet: … -->` marker is a copy of
 *     a file that `scripts/snippet-gate.js` compiles whole (and drift-checks). It
 *     is not compiled here; it is counted as `snippet`.
 *   - SKIP: `<!-- gate: skip — <reason> -->` above the fence (either dialect), or
 *     the legacy `// gate: skip` first line (impl1 documents only). The reason is
 *     mandatory on the HTML marker; a reasonless marker FAILS.
 *   - SPEC-AHEAD (ruled documents only): `<!-- gate: spec-ahead — <what's missing> -->`.
 *     The block is still compiled by the bootstrap. A failure is expected and counted
 *     as `spec-ahead` (listed with its reason). A CLEAN compile is a STALE marker:
 *     reported as "now compiles — remove the marker" (fails only with --strict).
 *   - impl1 default: compile with impl#1 + ghost-pattern-lint clean. Any error
 *     fails; any `W-LINT-*` ghost-pattern lint fails.
 *   - ruled default: compile with the bootstrap. Any Error-severity diagnostic or
 *     printer refusal fails; warnings do not.
 *   - A marker error (unknown kind, no reason, dangling, spec-ahead outside a ruled
 *     document, two markers on one block, an unknown dialect) FAILS.
 *
 * MODES:
 *   `bun scripts/claim-gate.js`            GATE   — exit 1 on any failure.
 *   `bun scripts/claim-gate.js --report`   REPORT — never exit non-zero; print the
 *                                          tally only. Use to MEASURE a surface
 *                                          before promoting it into the gate
 *                                          (the §8 measured-migration discipline:
 *                                          assumed-zero is not measured-zero).
 *   `bun scripts/claim-gate.js --strict`   also fail on a stale spec-ahead marker.
 *   `bun scripts/claim-gate.js --list`     list the resolved surface, compile nothing.
 *   `bun scripts/claim-gate.js [paths...]` override the surface with explicit paths.
 *
 * Exit: 0 on all-pass (or any --report run); 1 on any failure in GATE mode.
 * (Not wired into CI or the hook as of S469 — the surface still has impl#1-era
 * failures being migrated doc by doc. snippet-gate IS a required CI check.)
 *
 * Authored S280 (2026-07-22). `scripts/extract-readme-scrml.js` (S101) was
 * RETIRED in the same landing: its gate role passed to `scripts/snippet-gate.js`
 * (real files), and its fence-extraction capability lives on here as a survey
 * instrument. Bootstrap mode + HTML markers: S469.
 */

import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, extname, resolve, relative, sep } from "path";
import { execFileSync } from "child_process";
import { lintGhostPatterns } from "../compiler/src/lint-ghost-patterns.js";
import { parseDocMarkers } from "./doc-gate-markers.js";
import { isDriftScanned, inSnippetCorpus } from "./snippet-drift.js";
import { PUBLIC_SURFACE, SURFACE_EXCLUDE, SURFACE_UNGATED, uncoveredDocs } from "./claim-gate-surface.js";

// The declared surface, its walked-past excludes, and the FLOOR (every fenced public
// document must be gated or excused with a reason) live in scripts/claim-gate-surface.js.

const args = process.argv.slice(2);
const reportMode = args.includes("--report");
const strictMode = args.includes("--strict");
const explicitPaths = args.filter((a) => !a.startsWith("--"));
const surface = explicitPaths.length > 0 ? explicitPaths : PUBLIC_SURFACE;

// Repo-relative (not cwd-relative), so the excludes hold wherever the gate is run from.
const toRel = (p) => relative(resolve(import.meta.dir, ".."), resolve(p)).split(sep).join("/");

/** Expand the surface into a concrete .md file list (tolerates absent rows). */
function collectMarkdown(paths) {
  const out = [];
  const seen = new Set();
  const walk = (p, explicit) => {
    if (!existsSync(p)) return; // a declared-but-absent row is not an error
    const st = statSync(p);
    // An excluded row may be a directory or a single file (S469 "Banner + exempt": the dated
    // articles are excused one by one, so a NEW page under docs/articles is still gated).
    if (!explicit && SURFACE_EXCLUDE.includes(toRel(p))) return;
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry), false);
      return;
    }
    if (extname(p) !== ".md") return;
    // POSIX separators (S469): `join` writes `\` on Windows; every printed path and the
    // floor's gated set are `/`-separated. Bun's fs accepts `/` on Windows too.
    const posix = p.split(sep).join("/");
    if (seen.has(posix)) return;
    seen.add(posix);
    out.push(posix);
  };
  for (const p of paths) walk(p, explicitPaths.length > 0);
  return out.sort();
}

const files = collectMarkdown(surface);
if (files.length === 0) {
  console.log("claim-gate: no markdown files resolved from the declared surface.");
  process.exit(0);
}
// FLOOR (round 3): with the declared surface (no explicit paths), every README / NERDME /
// DESIGN / docs/**.md holding a scrml fence must be gated or excused in SURFACE_UNGATED.
const REPO_ROOT_FLOOR = resolve(import.meta.dir, "..");
const floorMisses = explicitPaths.length > 0
  ? []
  : uncoveredDocs(REPO_ROOT_FLOOR, new Set(files.map((f) => relative(REPO_ROOT_FLOOR, resolve(f)).split(sep).join("/"))));

if (args.includes("--list")) {
  console.log(`claim-gate — ${files.length} file(s) in the surface:`);
  for (const f of files) console.log(`  ${f}`);
  for (const f of floorMisses) console.log(`  UNGATED (surface floor) ${f}`);
  process.exit(floorMisses.length > 0 ? 1 : 0);
}

// Loaded lazily: an impl1-only run never pays for the bootstrap bundle.
let bootCheckFn = null;
async function bootCheck(path, text) {
  if (bootCheckFn === null) bootCheckFn = await import("./doc-boot-check.js");
  return bootCheckFn.bootCheck(path, text);
}
async function classifySpecAhead(r, pins) {
  if (bootCheckFn === null) bootCheckFn = await import("./doc-boot-check.js");
  return bootCheckFn.classifySpecAhead(r, pins);
}
const REPO_ROOT = resolve(import.meta.dir, "..");
const repoRel = (p) => relative(REPO_ROOT, resolve(p)).split(sep).join("/");
/** Why a snippet-marked block in `doc` would NOT be checked by snippet-gate, or null. */
function delegationProblem(doc, target) {
  const rel = target.startsWith("/") ? repoRel(target) : target;
  if (!existsSync(resolve(REPO_ROOT, rel)) || !statSync(resolve(REPO_ROOT, rel)).isFile()) return `target ${target} does not exist`;
  if (!inSnippetCorpus(rel)) return `target ${target} is outside the compiled snippet corpus`;
  if (!isDriftScanned(repoRel(doc))) return `${repoRel(doc)} is not drift-scanned, so the copy is never compared to the file`;
  return null;
}
async function codeSummary(codes) {
  if (bootCheckFn === null) bootCheckFn = await import("./doc-boot-check.js");
  return bootCheckFn.codeSummary(codes);
}

const tempDir = mkdtempSync(join(tmpdir(), "claim-gate-"));
const mode = {
  impl1: { files: 0, passed: 0, skipped: 0, failed: 0, snippet: 0 },
  ruled: { files: 0, passed: 0, skipped: 0, failed: 0, snippet: 0, specAhead: 0, stale: 0 },
};
let blockTotal = 0;
const failures = [];
const specAheadList = [];
const staleList = [];
const perFile = [];

for (const miss of floorMisses) {
  failures.push({
    file: miss, blockNum: null, startLine: 1,
    why: "surface floor: this document has scrml fences but is neither in PUBLIC_SURFACE nor excused in SURFACE_UNGATED (scripts/claim-gate-surface.js) — add it to one, with a reason for an exclusion",
    compileOutput: "", ghostDiags: [],
  });
  mode.impl1.failed++;
}

for (const file of files) {
  const doc = parseDocMarkers(readFileSync(file, "utf8"));
  const m = mode[doc.dialect];
  const f = { file, dialect: doc.dialect, passed: 0, skipped: 0, failed: 0, snippet: 0, specAhead: 0, stale: 0 };

  // Marker errors fail the document even when it has no blocks.
  for (const e of doc.errors) {
    f.failed++;
    m.failed++;
    failures.push({ file, blockNum: null, startLine: e.line, why: `marker error: ${e.message}`, compileOutput: "", ghostDiags: [] });
  }
  if (doc.blocks.length === 0 && doc.errors.length === 0) continue;
  m.files++;

  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    const blockNum = i + 1;
    blockTotal++;

    if (b.snippet) {
      // Delegate only when snippet-gate really checks it (round 2, A2): the target exists,
      // is in the compiled snippet corpus, and this document is drift-scanned (so the copy
      // is compared to the file). Anything else would be counted as gated while nobody checks it.
      const why = delegationProblem(file, b.snippet.path);
      if (why === null) {
        f.snippet++;
        m.snippet++;
      } else {
        f.failed++;
        m.failed++;
        failures.push({ file, blockNum, startLine: b.startLine, why: `snippet marker not checked by snippet-gate: ${why}`, compileOutput: "", ghostDiags: [] });
      }
      continue;
    }
    if (b.gate?.kind === "skip" || (doc.dialect === "impl1" && b.legacySkip && !b.gate)) {
      f.skipped++;
      m.skipped++;
      continue;
    }
    if (b.legacySkip && doc.dialect === "ruled") continue; // already a marker error

    const path = join(tempDir, `block-${blockTotal}.scrml`);

    if (doc.dialect === "ruled") {
      if (b.gate?.kind === "spec-ahead" && doc.dialect === "ruled") {
        const r = await bootCheck(path, b.body);
        // One rule for both gates (doc-boot-check.js classifySpecAhead): a crash is never an
        // expected failure; a pinned block must fail the pinned way.
        const c = await classifySpecAhead(r, b.gate.codes);
        if (c.verdict === "crash" || c.verdict === "pin-mismatch") {
          f.failed++;
          m.failed++;
          failures.push({ file, blockNum, startLine: b.startLine, why: `spec-ahead ${c.verdict}: ${c.message}`, compileOutput: r.lines.join("\n"), ghostDiags: [] });
          continue;
        }
        if (r.ok) {
          f.stale++;
          m.stale++;
          staleList.push({ file, line: b.gate.line, startLine: b.startLine, reason: b.gate.reason });
          if (strictMode) {
            f.failed++;
            m.failed++;
            failures.push({ file, blockNum, startLine: b.startLine, why: "stale spec-ahead marker (--strict): the block now compiles on the bootstrap", compileOutput: "", ghostDiags: [] });
          }
        } else {
          f.specAhead++;
          m.specAhead++;
          specAheadList.push({ file, startLine: b.startLine, reason: b.gate.reason, said: await codeSummary(r.codes) });
        }
        continue;
      }
      const r = await bootCheck(path, b.body);
      if (r.ok) {
        f.passed++;
        m.passed++;
      } else {
        f.failed++;
        m.failed++;
        failures.push({ file, blockNum, startLine: b.startLine, why: r.crash ? "bootstrap crash" : "bootstrap compile-fail", compileOutput: r.lines.join("\n"), ghostDiags: [] });
      }
      continue;
    }

    // impl1 mode (unchanged S101/S280 behaviour).
    writeFileSync(path, b.body);
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
    const ghostDiags = lintGhostPatterns(b.body, path);
    const ghostFailing = ghostDiags.length > 0;

    if (compileOk && !ghostFailing) {
      f.passed++;
      m.passed++;
      continue;
    }

    f.failed++;
    m.failed++;
    const why = [];
    if (!compileOk) why.push("compile-fail");
    if (ghostFailing) why.push(`${ghostDiags.length} ghost-pattern lint(s)`);
    failures.push({ file, blockNum, startLine: b.startLine, why: why.join("; "), compileOutput, ghostDiags });
  }

  perFile.push(f);
}

rmSync(tempDir, { recursive: true, force: true });

// ---- report -------------------------------------------------------------
const sum = (k) => mode.impl1[k] + mode.ruled[k];
const passed = sum("passed");
const skipped = sum("skipped");
const failed = sum("failed");
const snippet = sum("snippet");
const specAhead = mode.ruled.specAhead;
const stale = mode.ruled.stale;

console.log(`claim-gate — ${files.length} file(s), ${blockTotal} scrml block(s)`);
console.log("");
for (const f of perFile) {
  const flag = f.failed > 0 ? "FAIL" : "ok  ";
  const tag = f.dialect === "ruled" ? "[ruled] " : "";
  const extra = [];
  if (f.snippet) extra.push(`${f.snippet} snippet`);
  if (f.specAhead) extra.push(`${f.specAhead} spec-ahead`);
  if (f.stale) extra.push(`${f.stale} STALE spec-ahead`);
  console.log(
    `  ${flag}  ${tag}${f.file}  (${f.passed} pass, ${f.skipped} skip, ${f.failed} fail${extra.length ? ", " + extra.join(", ") : ""})`,
  );
}

if (specAheadList.length > 0) {
  console.log("");
  console.log(`spec-ahead blocks (${specAheadList.length}) — ruled scrml the bootstrap cannot compile yet:`);
  for (const s of specAheadList) console.log(`  ${s.file}:${s.startLine} — ${s.reason}  [bootstrap: ${s.said}]`);
}
if (staleList.length > 0) {
  console.log("");
  console.log(`STALE spec-ahead markers (${staleList.length}) — these blocks NOW COMPILE on the bootstrap; remove the marker:`);
  for (const s of staleList) console.log(`  ${s.file}:${s.line} — remove the marker (was: ${s.reason})`);
}

if (failed > 0 && !reportMode) {
  console.error("");
  console.error("=== claim-gate — failure detail ===");
  for (const f of failures) {
    const where = f.blockNum === null ? "" : `  block #${f.blockNum}`;
    console.error(`\n--- ${f.file}:${f.startLine}${where} — ${f.why} ---`);
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
  `per mode: impl1 — ${mode.impl1.files} file(s), ${mode.impl1.passed} pass, ${mode.impl1.skipped} skip, ` +
    `${mode.impl1.snippet} snippet, ${mode.impl1.failed} fail · ` +
    `bootstrap (ruled) — ${mode.ruled.files} file(s), ${mode.ruled.passed} pass, ${mode.ruled.skipped} skip, ` +
    `${mode.ruled.snippet} snippet, ${mode.ruled.specAhead} spec-ahead, ${mode.ruled.stale} stale, ${mode.ruled.failed} fail`,
);
console.log(
  `claim-gate: ${passed} passed, ${skipped} skipped, ${snippet} snippet-gated, ${specAhead + stale} spec-ahead${stale ? ` (${stale} stale)` : ""}, ${failed} failed (${blockTotal} total).`,
);

if (failed > 0) {
  console.log("");
  console.log(
    "A genuinely non-runnable illustrative fragment may opt out with `<!-- gate: skip — <reason> -->` " +
      "above its fence (docs/DIALECT.md). Everything else is a real stale-claim finding.",
  );
}

if (reportMode) {
  console.log("");
  console.log("(--report: measurement mode, exit 0 regardless.)");
  process.exit(0);
}

process.exit(failed > 0 ? 1 : 0);
