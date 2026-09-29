/**
 * scripts/snippet-drift.js
 *
 * DRIFT half of the snippet gate (`scripts/snippet-gate.js` runs it).
 *
 * The compile half proves each snippet FILE compiles. That leaves one hole: a
 * document that shows a COPY of the file. The copy is what readers see, and it
 * can drift while the file stays green. That is exactly how docs/tutorial.md
 * broke — its opening line promised "every snippet here is a working .scrml
 * file in docs/tutorial-snippets/", the files compiled, and the tutorial's
 * copies had lost `db=`, kept a stale `${}` wrapper, and diverged in comments.
 *
 * THE CONTRACT. A fenced ```scrml block may be tied to a file with a marker on
 * the line(s) directly above it (blank lines between are allowed):
 *
 *     <!-- snippet: docs/tutorial-snippets/02-counter.scrml -->
 *     ```scrml
 *     ...exact file contents...
 *     ```
 *
 * or to an inclusive, 1-based line range of a file (an excerpt):
 *
 *     <!-- snippet: docs/tutorial-snippets/03-todos.scrml#L20-L24 -->
 *
 * Checks, each a hard failure:
 *   1. The marker is followed by a ```scrml fence (a dangling marker checks nothing).
 *   2. The target file exists and the range (if any) is inside it.
 *   3. The target is inside the compile-gated corpus — otherwise "matches the
 *      file" would not imply "compiles", and the chain would be hollow.
 *   4. The block equals the file/range, modulo trailing whitespace per line,
 *      CRLF, and leading/trailing blank lines. For a RANGE, the common leading
 *      indentation of both sides is also removed, so an excerpt from inside an
 *      indented body can be shown flush-left.
 *   5. OPT-IN COMPLETENESS: in a document that uses at least one marker, an
 *      UNMARKED scrml block that contains a `<program` opener fails. A document
 *      that has opted in to the contract does not get to add a whole program
 *      that nobody compiles. Short excerpts without `<program` stay free (they
 *      must be labelled as fragments in prose — the gate cannot check prose).
 *
 * Unmarked blocks in documents with no markers are not checked at all. That is
 * deliberate and matches snippet-gate's header: fence extraction as a
 * compile-gate was measured and rejected. This check is not a compile of the
 * fence — the file is compiled; the fence is compared to the file.
 *
 * Authored 2026-09-29 (tutorial drift fix).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

/** Documents scanned for markers. `docs/changes/` is the internal change archive, not public. */
export const DRIFT_DOC_ROOTS = ["README.md", "docs"];
const DRIFT_DOC_EXCLUDE = ["docs/changes"];

/**
 * Documents that MUST carry markers. Without this floor, deleting every marker
 * from a document would take it out of the check while the gate stays green
 * (the hollow-gate shape snippet-gate.js's header records). Adding a row is how
 * a document commits to the contract permanently.
 */
export const DRIFT_REQUIRED_DOCS = ["docs/tutorial.md"];

const MARKER_RE = /^\s*<!--\s*snippet:\s*(\S+?)(?:#L(\d+)-L(\d+))?\s*-->\s*$/;
const FENCE_OPEN_RE = /^\s*```scrml\s*$/;
const FENCE_ANY_RE = /^\s*```/;

/** Discover the markdown documents to scan, repo-relative with `/` separators. */
export function discoverDocs(repoRoot, roots = DRIFT_DOC_ROOTS) {
  const out = [];
  const walk = (abs) => {
    const rel = relative(repoRoot, abs).split(sep).join("/");
    if (DRIFT_DOC_EXCLUDE.some((x) => rel === x || rel.startsWith(x + "/"))) return;
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (rel.endsWith("node_modules")) return;
      for (const e of readdirSync(abs)) walk(join(abs, e));
      return;
    }
    if (rel.endsWith(".md")) out.push(rel);
  };
  for (const r of roots) walk(join(repoRoot, r));
  return out.sort();
}

/**
 * Parse a markdown text into its scrml fences, each with the marker that
 * precedes it (if any). Also reports dangling markers.
 * @returns {{ blocks: Array<{line:number, body:string[], marker: null | {path:string, from:number|null, to:number|null, line:number}}>, dangling: Array<{line:number, raw:string}> }}
 */
export function parseDoc(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const dangling = [];
  let pending = null; // marker waiting for its fence
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = MARKER_RE.exec(line);
    if (m) {
      if (pending) dangling.push({ line: pending.line, raw: pending.raw });
      pending = {
        path: m[1],
        from: m[2] ? Number(m[2]) : null,
        to: m[3] ? Number(m[3]) : null,
        line: i + 1,
        raw: line.trim(),
      };
      continue;
    }
    if (FENCE_ANY_RE.test(line)) {
      const isScrml = FENCE_OPEN_RE.test(line);
      const start = i;
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (isScrml) {
        blocks.push({ line: start + 1, body, marker: pending });
      } else if (pending) {
        dangling.push({ line: pending.line, raw: pending.raw });
      }
      pending = null;
      continue;
    }
    if (pending && line.trim() !== "") {
      dangling.push({ line: pending.line, raw: pending.raw });
      pending = null;
    }
  }
  if (pending) dangling.push({ line: pending.line, raw: pending.raw });
  return { blocks, dangling };
}

/** Normalize for comparison: CRLF, trailing whitespace, outer blank lines; optional dedent. */
export function normalize(lines, dedent = false) {
  let out = lines.map((l) => l.replace(/\r$/, "").replace(/\s+$/, ""));
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  if (dedent) {
    const indents = out.filter((l) => l !== "").map((l) => l.match(/^[ \t]*/)[0].length);
    const n = indents.length ? Math.min(...indents) : 0;
    out = out.map((l) => l.slice(n));
  }
  return out;
}

/** A small LCS line diff. Returns lines prefixed "  ", "- " (file), "+ " (doc). */
export function lineDiff(expected, actual) {
  const n = expected.length;
  const m = actual.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = expected[i] === actual[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === actual[j]) { out.push(`  ${expected[i]}`); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`- ${expected[i]}`); i++; }
    else { out.push(`+ ${actual[j]}`); j++; }
  }
  while (i < n) out.push(`- ${expected[i++]}`);
  while (j < m) out.push(`+ ${actual[j++]}`);
  return out;
}

/** Keep changed lines plus `ctx` lines of context around them. */
function trimDiff(diff, ctx = 2) {
  const keep = new Set();
  diff.forEach((l, k) => {
    if (!l.startsWith("  ")) for (let d = -ctx; d <= ctx; d++) keep.add(k + d);
  });
  const out = [];
  let last = -2;
  diff.forEach((l, k) => {
    if (!keep.has(k)) return;
    if (k !== last + 1 && out.length) out.push("  ...");
    out.push(l);
    last = k;
  });
  return out;
}

/**
 * Run the drift check.
 * @param {string} repoRoot
 * @param {string[]} gatedRoots  the compile corpus roots (repo-relative)
 * @param {string[]} [docs]      override the document list (repo-relative)
 * @returns {{ checked: number, docsWithMarkers: string[], failures: Array<{doc:string, line:number, message:string, diff?:string[]}> }}
 */
export function checkDrift(repoRoot, gatedRoots, docs = discoverDocs(repoRoot), required = DRIFT_REQUIRED_DOCS) {
  const failures = [];
  const docsWithMarkers = [];
  let checked = 0;
  for (const req of required) {
    const abs = join(repoRoot, req);
    const has = existsSync(abs) && parseDoc(readFileSync(abs, "utf8")).blocks.some((b) => b.marker);
    if (!has) {
      failures.push({ doc: req, line: 0, message: "required document has no `<!-- snippet: ... -->` markers (missing, or its markers were removed)" });
    }
  }
  const inCorpus = (p) => gatedRoots.some((r) => p === r || p.startsWith(r.replace(/\/$/, "") + "/"));

  for (const doc of docs) {
    const text = readFileSync(join(repoRoot, doc), "utf8");
    if (!text.includes("snippet:")) continue;
    const { blocks, dangling } = parseDoc(text);
    const marked = blocks.filter((b) => b.marker);
    if (marked.length === 0 && dangling.length === 0) continue;
    docsWithMarkers.push(doc);

    for (const d of dangling) {
      failures.push({ doc, line: d.line, message: `marker is not followed by a \`\`\`scrml fence: ${d.raw}` });
    }

    for (const b of blocks) {
      if (!b.marker) {
        if (b.body.some((l) => /<program[\s>]/.test(l))) {
          failures.push({
            doc,
            line: b.line,
            message:
              "unmarked scrml block contains a `<program` opener in a document that uses snippet markers — " +
              "make it a gated file and add `<!-- snippet: path -->` above the fence",
          });
        }
        continue;
      }
      const { path, from, to } = b.marker;
      const where = from ? `${path}#L${from}-L${to}` : path;
      if (!inCorpus(path)) {
        failures.push({ doc, line: b.line, message: `marker target ${path} is outside the compile-gated corpus (${gatedRoots.join(", ")})` });
        continue;
      }
      const abs = join(repoRoot, path);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        failures.push({ doc, line: b.line, message: `marker target does not exist: ${path}` });
        continue;
      }
      let fileLines = readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n");
      if (from) {
        if (from < 1 || to < from || to > fileLines.length) {
          failures.push({ doc, line: b.line, message: `marker range ${where} is outside the file (${fileLines.length} lines)` });
          continue;
        }
        fileLines = fileLines.slice(from - 1, to);
      }
      checked++;
      const expected = normalize(fileLines, Boolean(from));
      const actual = normalize(b.body, Boolean(from));
      if (expected.length === actual.length && expected.every((l, k) => l === actual[k])) continue;
      failures.push({
        doc,
        line: b.line,
        message: `block drifted from ${where}  (- file, + document)`,
        diff: trimDiff(lineDiff(expected, actual)).slice(0, 60),
      });
    }
  }
  return { checked, docsWithMarkers, failures };
}
