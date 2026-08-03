/**
 * Parser-conformance corpus enumerator.
 *
 * Enumerates the four .scrml corpus sources used by the conformance harness
 * (per scrml-native-parser-design-2026-05-17.md §D6) plus the curated bench
 * .js corpus. Pure inventory — does NOT run any parser.
 *
 * Per primer Pillar 5b: enumerating files is a calculation over the filesystem.
 * Implemented as a `fn` (function in JS-land) — pure-ish (the readdir surface
 * is the only state-touch and is read-only).
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Project repo root — the directory above compiler/.
 * Resolved from this file's location so the enumerator works regardless of
 * the runner's cwd. (Worktrees move; absolute paths stay correct.)
 */
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// compiler/tests/parser-conformance/ → ../../.. = repo root
export const REPO_ROOT = join(__dirname, "..", "..", "..");

/** Source corpus directories enumerated for .scrml files. */
export const SCRML_CORPUS_SOURCES = [
  { name: "samples", root: join(REPO_ROOT, "samples") },
  { name: "examples", root: join(REPO_ROOT, "examples") },
  { name: "stdlib", root: join(REPO_ROOT, "stdlib") },
  { name: "self-host", root: join(REPO_ROOT, "compiler", "self-host") },
];

/** Bench corpus directory — .js single-feature fixtures. */
export const BENCH_DIR = join(REPO_ROOT, "compiler", "tests", "parser-conformance", "bench");

/**
 * Recursively walk `dir`, yielding all files whose name ends with `ext`.
 * Skips dist/, node_modules/, .git/, and any directory whose basename
 * starts with "." (hidden).
 */
function walkDir(dir, ext, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return; // missing dir is treated as empty
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith(".")) continue;
      if (ent.name === "node_modules") continue;
      if (ent.name === "dist") continue;
      if (ent.name === "build") continue;
      walkDir(full, ext, out);
    } else if (ent.isFile() && ent.name.endsWith(ext)) {
      out.push(full);
    }
  }
}

/**
 * Enumerate every .scrml file under each source.
 * @returns {Array<{ source: string, path: string, relpath: string }>}
 */
export function enumerateScrmlCorpus() {
  const out = [];
  for (const src of SCRML_CORPUS_SOURCES) {
    const files = [];
    walkDir(src.root, ".scrml", files);
    for (const f of files) {
      out.push({
        source: src.name,
        path: f,
        // Normalize to POSIX separators so `relpath` matches the forward-slash
        // allowlist keys on EVERY OS. `path.relative` returns backslash-
        // separated paths on Windows, which never matched the committed
        // (Linux-generated) allowlist — the within-node parity gate reported
        // every fixture as fully over-budget on a Windows checkout. No-op on
        // Linux CI (already forward-slash). (g-subparse-span-not-rebased —
        // cross-OS canary, Peter's Windows-portability lane.)
        relpath: relative(REPO_ROOT, f).replaceAll("\\", "/"),
      });
    }
  }
  return out;
}

/**
 * Enumerate the curated bench corpus (.js files in compiler/tests/parser-conformance/bench/).
 * @returns {Array<{ source: "bench", path: string, relpath: string }>}
 */
export function enumerateBenchCorpus() {
  const out = [];
  walkDir(BENCH_DIR, ".js", out);
  return out.map((f) => ({
    source: "bench",
    path: f,
    relpath: relative(REPO_ROOT, f).replaceAll("\\", "/"),
  }));
}

/**
 * Per-source counts for the DONE report and for spotting drift over time.
 * @returns {{ samples: number, examples: number, stdlib: number, "self-host": number, bench: number, total: number }}
 */
export function corpusSizes() {
  const scrml = enumerateScrmlCorpus();
  const bench = enumerateBenchCorpus();
  const counts = { samples: 0, examples: 0, stdlib: 0, "self-host": 0, bench: bench.length, total: 0 };
  for (const e of scrml) counts[e.source]++;
  counts.total = scrml.length + bench.length;
  return counts;
}
