#!/usr/bin/env bun
/**
 * Phase A1a Step 12 — apply DECL-CANDIDATE rewrites.
 *
 * For each file in the input list, run the classifier and then rewrite
 * each DECL-CANDIDATE line in-place. The rewrite is mechanical:
 *   `@<name>` at the start of a decl token sequence → `<<name>>`
 *
 * The decl token sequence is: optional whitespace + `@<name>` + optional
 * type annotation `: Type` + `=` + init expr. We rewrite the `@<name>` to
 * `<<name>>` and leave the rest unchanged.
 *
 * Boundary safety:
 *   - Only rewrite the `@<name>` token; do NOT touch any other `@<name>`
 *     references on the same line or elsewhere in the file.
 *   - Use the line+col span from the classifier to locate the exact site.
 *
 * Usage:
 *   bun scripts/step12-rewrite.mjs <root1> [<root2> ...]
 *
 * Outputs the list of files modified, with site count per file.
 *
 * NOT FOR PRODUCTION — temporary Step 12 dispatch helper.
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";

function findKind(ast, target) {
  const out = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === target) out.push(n);
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return out;
}

function findTopLevelDecls(source) {
  const out = new Map();
  let depth = 0;
  let pos = 0;
  let line = 1;
  const len = source.length;
  let inStr = null;
  while (pos < len) {
    const c = source[pos];
    if (c === "\n") { line++; pos++; continue; }
    if (inStr) {
      if (c === "\\" && pos + 1 < len) { pos += 2; continue; }
      if (c === inStr) inStr = null;
      pos++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; pos++; continue; }
    if (c === "/" && source[pos + 1] === "/") {
      while (pos < len && source[pos] !== "\n") pos++;
      continue;
    }
    if (c === "/" && source[pos + 1] === "*") {
      pos += 2;
      while (pos < len && !(source[pos] === "*" && source[pos + 1] === "/")) {
        if (source[pos] === "\n") line++;
        pos++;
      }
      pos += 2;
      continue;
    }
    if ("$?!^~#".includes(c) && source[pos + 1] === "{") { depth++; pos += 2; continue; }
    if (c === "{") { depth++; pos++; continue; }
    if (c === "}") { if (depth > 0) depth--; pos++; continue; }
    if (depth === 0 && c === "@") {
      let p = pos + 1;
      let ident = "";
      while (p < len && /[A-Za-z0-9_]/.test(source[p])) { ident += source[p]; p++; }
      if (ident.length > 0) {
        let q = p;
        while (q < len && /[ \t]/.test(source[q])) q++;
        if (source[q] === "=" && source[q + 1] !== "=") {
          if (!out.has(ident)) out.set(ident, true);
        }
      }
    }
    pos++;
  }
  return out;
}

/**
 * Collect DECL-CANDIDATE sites for a file. Returns array of {start, end, name}
 * where start/end are byte offsets of the `@<name>` token to be replaced.
 */
function collectRewriteSites(filePath, source) {
  let ast;
  try { ast = buildAST(splitBlocks(filePath, source)); }
  catch (e) { return { sites: [], error: e.message }; }

  const topLevelDecls = findTopLevelDecls(source);
  const allDecls = findKind(ast, "state-decl").filter((d) => d.structuralForm === false);
  allDecls.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));

  const namesWithModifierDecl = new Set();
  for (const d of allDecls) {
    if (d.isServer || d.isShared || d.isConst || (d.shape && d.shape !== "plain")) {
      namesWithModifierDecl.add(d.name);
    }
  }

  const seenPlainNames = new Set();
  const sites = [];
  for (const d of allDecls) {
    if (d.isServer || d.isShared || d.isConst || (d.shape && d.shape !== "plain")) continue;
    if (topLevelDecls.has(d.name)) continue;
    if (namesWithModifierDecl.has(d.name)) continue;
    if (seenPlainNames.has(d.name)) continue;
    seenPlainNames.add(d.name);

    // HAIRY-SELF-REF guard
    const start = d.span?.start ?? -1;
    if (start < 0) continue;
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = source.indexOf("\n", start);
    const snippet = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    const selfRefRegex = new RegExp(`@${d.name}\\b`, "g");
    const matches = (snippet.match(selfRefRegex) || []).length;
    if (matches >= 2) continue;

    // Find the `@<name>` token in the source. The state-decl span starts AT
    // the `@`. Verify by reading the next chars.
    if (source[start] !== "@") {
      // Span is misaligned (could happen for typed-decl forms?). Find the
      // first `@<name>` between `start` and the next `=`.
      const equalsIdx = source.indexOf("=", start);
      if (equalsIdx < 0) continue;
      const slice = source.slice(start, equalsIdx);
      const m = new RegExp(`@${d.name}\\b`).exec(slice);
      if (!m) continue;
      const atIdx = start + m.index;
      sites.push({ atStart: atIdx, atEnd: atIdx + 1 + d.name.length, name: d.name });
      continue;
    }
    // start IS the `@`. Verify name follows.
    const expected = "@" + d.name;
    if (source.slice(start, start + expected.length) === expected) {
      sites.push({ atStart: start, atEnd: start + expected.length, name: d.name });
    }
  }
  return { sites, error: null };
}

function rewriteFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const { sites, error } = collectRewriteSites(filePath, source);
  if (error) return { rewrites: 0, error, filePath };
  if (sites.length === 0) return { rewrites: 0, error: null, filePath };

  // Sort sites by start offset DESCENDING so we can edit in place without
  // shifting offsets.
  sites.sort((a, b) => b.atStart - a.atStart);

  let out = source;
  for (const s of sites) {
    const before = out.slice(0, s.atStart);
    const after = out.slice(s.atEnd);
    out = before + `<${s.name}>` + after;
  }
  writeFileSync(filePath, out);
  return { rewrites: sites.length, error: null, filePath };
}

function walk(root, files) {
  const stat = statSync(root);
  if (stat.isFile() && root.endsWith(".scrml")) { files.push(root); return; }
  if (!stat.isDirectory()) return;
  for (const ent of readdirSync(root)) {
    if (ent === "dist") continue;
    walk(join(root, ent), files);
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: bun scripts/step12-rewrite.mjs <root1> [...]");
  process.exit(1);
}
const allFiles = [];
for (const r of roots) walk(resolve(r), allFiles);

let totalRewrites = 0;
let totalFiles = 0;
let errors = [];
for (const f of allFiles) {
  const res = rewriteFile(f);
  if (res.error) {
    errors.push(res);
    continue;
  }
  if (res.rewrites > 0) {
    totalFiles++;
    totalRewrites += res.rewrites;
    console.log(`REWRITE\t${f}\tn=${res.rewrites}`);
  }
}
console.log("");
console.log(`# Total: ${totalRewrites} rewrites across ${totalFiles} files`);
if (errors.length > 0) {
  console.log(`# Parse errors: ${errors.length}`);
  for (const e of errors) console.log(`PARSE-ERR\t${e.filePath}\t${e.error}`);
}
