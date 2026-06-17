/**
 * render-corpus-enumerator.js — the e2e RENDER corpus enumerator.
 *
 * Per the e2e-known-failure-map deep dive (docs/deep-dives/
 * e2e-known-failure-map-2026-06-17.md §thin-build step 1): clone the
 * parser-conformance corpus enumerator but at RENDER scope —
 *   - ADD benchmarks/ (the parser enumerator's SCRML_CORPUS_SOURCES does NOT
 *     include it; the DD §Corpus shape notes "Any render corpus enumerator must
 *     add benchmarks/").
 *   - FILTER to files with a `<program` UI root (the render substrate mounts a
 *     `<program>` app; stdlib/self-host are library/compiler code with no UI
 *     root and are EXCLUDED — DD §Corpus shape).
 *   - Classify each enumerated file as a SINGLE-FILE app (a standalone
 *     `<program`-rooted .scrml) or a MULTI-FILE app entry (the `<program`-rooted
 *     file inside a multi-file app dir, e.g. 22-multifile/app.scrml,
 *     23-trucking-dispatch/app.scrml). The multi-file class needs the whole dir
 *     gathered as inputFiles; single-file apps compile alone.
 *
 * Pure inventory — does NOT run the compiler or any parser. The `<program` scan
 * is a substring test over the file head (attr-tolerant: matches `<program>` and
 * `<program db= auth=>` etc.), NOT a parse.
 *
 * Models compiler/tests/parser-conformance/corpus-enumerator.js (same REPO_ROOT
 * resolution, same walkDir skip-set).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// compiler/tests/e2e-render-map/ → ../../.. = repo root
export const REPO_ROOT = join(__dirname, "..", "..", "..");

/**
 * RENDER corpus source directories. Unlike the parser enumerator's
 * SCRML_CORPUS_SOURCES, this:
 *   - INCLUDES benchmarks/ (todomvc + fullstack-scrml + per-route-roles).
 *   - EXCLUDES stdlib/ and self-host/ (library/compiler code; no `<program` UI
 *     root — they would be filtered out anyway, but excluding them up front
 *     keeps the walk cheap).
 */
export const RENDER_CORPUS_SOURCES = [
  { name: "examples", root: join(REPO_ROOT, "examples") },
  { name: "samples", root: join(REPO_ROOT, "samples") },
  { name: "benchmarks", root: join(REPO_ROOT, "benchmarks") },
];

/**
 * Multi-file app dirs — a `<program`-rooted entry file inside one of these
 * needs the WHOLE dir gathered (the import graph spans sibling .scrml). The
 * harness compiles the entry with all dir .scrml as inputFiles.
 *
 * Keyed by repo-relative dir prefix. Any `<program`-rooted file whose relpath
 * starts with one of these is a MULTI-FILE app; everything else is SINGLE-FILE.
 */
export const MULTI_FILE_APP_DIRS = [
  "examples/22-multifile",
  "examples/23-trucking-dispatch",
  "benchmarks/fullstack-scrml",
  "benchmarks/per-route-roles",
];

/**
 * EXPLICIT single-file render-app entries that do NOT carry a `<program` root
 * but ARE renderable apps (a top-level markup-element root + a `${...}` script
 * block — the legacy app shape `scrml dev` accepts). The DD names TodoMVC as a
 * map cell to fold in, but `benchmarks/todomvc/app.scrml` roots at
 * `<div class="todoapp">`, not `<program>`. This allowlist is ADDITIVE — it
 * folds a real app INTO the map. It is NOT an error-class suppression (the
 * opposite of the SERVER_EXAMPLES anti-pattern): it adds apps to observe, it
 * never hides a failure on an app already in the map.
 */
export const EXPLICIT_SINGLE_APP_ENTRIES = [
  "benchmarks/todomvc/app.scrml",
];

/**
 * Recursively walk `dir`, pushing every file ending in `ext`. Skips dist/,
 * node_modules/, build/, .git/, and hidden dirs. (Same skip-set as the parser
 * enumerator, plus we keep dist/ out so we never enumerate compiled output.)
 */
function walkDir(dir, ext, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return; // missing dir treated as empty
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
 * Attr-tolerant `<program` root test. Reads the file and tests whether a
 * `<program` opener appears (matches `<program>` and `<program db= ...>`).
 * NOT a parse — a substring probe sufficient to distinguish a UI-root app from
 * a fragment / schema-only / module file.
 */
function hasProgramRoot(filePath) {
  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch (_e) {
    return false;
  }
  return /<program[>\s]/.test(src);
}

/**
 * Classify a `<program`-rooted file's app-kind by its relpath.
 * @returns {{ kind: "single" | "multi", appDir: string | null }}
 */
function classifyApp(relpath) {
  for (const dirPrefix of MULTI_FILE_APP_DIRS) {
    if (relpath === dirPrefix || relpath.startsWith(dirPrefix + "/")) {
      return { kind: "multi", appDir: dirPrefix };
    }
  }
  return { kind: "single", appDir: null };
}

/**
 * Enumerate every `<program`-rooted .scrml render-corpus app.
 *
 * For MULTI-FILE apps, only the ENTRY file (app.scrml if present, else the
 * first `<program`-rooted file in the dir) yields a corpus row; the row carries
 * the full sibling-.scrml set as `inputFiles`. Non-entry `<program` files in a
 * multi-file dir are folded into their app's inputFiles, not enumerated as
 * standalone rows (they would never mount alone — the import graph is the app).
 *
 * @returns {Array<{
 *   source: string, path: string, relpath: string, kind: "single"|"multi",
 *   appDir: string|null, inputFiles: string[]
 * }>}
 */
export function enumerateRenderCorpus() {
  const single = [];
  // Group multi-file apps by appDir so each emits ONE entry row.
  const multiByDir = new Map(); // appDir -> { programFiles: [], allScrml: Set }

  for (const src of RENDER_CORPUS_SOURCES) {
    const files = [];
    walkDir(src.root, ".scrml", files);
    for (const f of files) {
      const relpath = relative(REPO_ROOT, f);
      const { kind, appDir } = classifyApp(relpath);
      if (kind === "multi") {
        if (!multiByDir.has(appDir)) {
          multiByDir.set(appDir, {
            source: src.name,
            programFiles: [],
            allScrml: [],
          });
        }
        const entry = multiByDir.get(appDir);
        entry.allScrml.push({ path: f, relpath });
        if (hasProgramRoot(f)) entry.programFiles.push({ path: f, relpath });
      } else {
        // single-file class: enumerate if it carries a <program root OR it is
        // an EXPLICIT named app entry (a renderable non-<program> app, TodoMVC).
        if (hasProgramRoot(f) || EXPLICIT_SINGLE_APP_ENTRIES.includes(relpath)) {
          single.push({
            source: src.name,
            path: f,
            relpath,
            kind: "single",
            appDir: null,
            inputFiles: [f],
          });
        }
      }
    }
  }

  // Emit one row per multi-file app, picking the entry file.
  const multi = [];
  for (const [appDir, entry] of multiByDir) {
    if (entry.programFiles.length === 0) continue; // no UI root → not a render app
    // Prefer app.scrml as the entry; else the first <program-rooted file.
    const appScrml = entry.programFiles.find((p) =>
      p.relpath.endsWith("/app.scrml"),
    );
    const chosen = appScrml ?? entry.programFiles[0];
    multi.push({
      source: entry.source,
      path: chosen.path,
      relpath: chosen.relpath,
      kind: "multi",
      appDir,
      inputFiles: entry.allScrml.map((s) => s.path),
    });
  }

  // Deterministic order: source then relpath.
  const all = [...single, ...multi];
  all.sort((a, b) =>
    a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0,
  );
  return all;
}

/**
 * Per-source + per-kind counts for the DONE report and drift-spotting.
 */
export function renderCorpusSizes() {
  const apps = enumerateRenderCorpus();
  const counts = {
    examples: 0,
    samples: 0,
    benchmarks: 0,
    single: 0,
    multi: 0,
    total: apps.length,
  };
  for (const a of apps) {
    counts[a.source] = (counts[a.source] ?? 0) + 1;
    counts[a.kind]++;
  }
  return counts;
}
