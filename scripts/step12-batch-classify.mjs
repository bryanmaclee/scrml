#!/usr/bin/env bun
/**
 * Phase A1a Step 12 — batch classifier. Walks all .scrml files under one
 * or more roots, classifies each `@x = init|expr` site, and outputs a
 * single TSV stream.
 *
 * Usage:
 *   bun scripts/step12-batch-classify.mjs <root1> [<root2> ...]
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
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
  let col = 1;
  const len = source.length;
  let inStr = null;
  while (pos < len) {
    const c = source[pos];
    if (c === "\n") { line++; col = 1; pos++; continue; }
    if (inStr) {
      if (c === "\\" && pos + 1 < len) { pos += 2; col += 2; continue; }
      if (c === inStr) inStr = null;
      pos++; col++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; pos++; col++; continue; }
    if (c === "/" && source[pos + 1] === "/") {
      while (pos < len && source[pos] !== "\n") { pos++; col++; }
      continue;
    }
    if (c === "/" && source[pos + 1] === "*") {
      pos += 2; col += 2;
      while (pos < len && !(source[pos] === "*" && source[pos + 1] === "/")) {
        if (source[pos] === "\n") { line++; col = 1; } else col++;
        pos++;
      }
      pos += 2; col += 2;
      continue;
    }
    if ("$?!^~#".includes(c) && source[pos + 1] === "{") { depth++; pos += 2; col += 2; continue; }
    if (c === "{") { depth++; pos++; col++; continue; }
    if (c === "}") { if (depth > 0) depth--; pos++; col++; continue; }
    if (depth === 0 && c === "@") {
      let p = pos + 1;
      let ident = "";
      while (p < len && /[A-Za-z0-9_]/.test(source[p])) { ident += source[p]; p++; }
      if (ident.length > 0) {
        let q = p;
        while (q < len && /[ \t]/.test(source[q])) q++;
        if (source[q] === "=" && source[q + 1] !== "=") {
          if (!out.has(ident)) {
            const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
            const lineEnd = source.indexOf("\n", pos);
            const snippet = source.slice(lineStart, lineEnd === -1 ? len : lineEnd).trim();
            out.set(ident, { line, col, snippet });
          }
        }
      }
    }
    pos++; col++;
  }
  return out;
}

function classifyFile(filePath, agg) {
  let source;
  try { source = readFileSync(filePath, "utf8"); }
  catch (e) { agg.readErr.push({ filePath, err: e.message }); return; }
  let ast;
  try { ast = buildAST(splitBlocks(filePath, source)); }
  catch (e) { agg.parseErr.push({ filePath, err: e.message }); return; }

  const topLevelDecls = findTopLevelDecls(source);
  for (const [name, info] of topLevelDecls) {
    agg.topLevelBlocked.push({ filePath, name, line: info.line, col: info.col, snippet: info.snippet });
  }

  // Two-pass over AST decls so LEGACY-COMPLEX names register as "decl-seen"
  // ahead of any later plain @-form writes of the same name.
  const allDecls = findKind(ast, "state-decl").filter((d) => d.structuralForm === false);
  allDecls.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));

  // Pass 1: identify all names that have ANY decl (modifier, plain, etc.) in scope.
  const namesWithModifierDecl = new Set();
  for (const d of allDecls) {
    if (d.isServer || d.isShared || d.isConst || (d.shape && d.shape !== "plain")) {
      namesWithModifierDecl.add(d.name);
    }
  }

  // Pass 2: classify each decl.
  const seenPlainNames = new Set();
  for (const d of allDecls) {
    const start = d.span?.start ?? -1;
    const line = d.span?.line ?? 0;
    const col = d.span?.col ?? 0;
    let snippet = "";
    if (start >= 0) {
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = source.indexOf("\n", start);
      snippet = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
    }
    let bucket;
    if (d.isServer || d.isShared || d.isConst || (d.shape && d.shape !== "plain")) {
      bucket = agg.legacyComplex;
    } else if (topLevelDecls.has(d.name)) {
      // Already decl'd at top-level; this is a write.
      bucket = agg.write;
    } else if (namesWithModifierDecl.has(d.name)) {
      // Name is decl'd via a modifier form elsewhere (server/shared/const);
      // this plain @-form is a write, not a re-decl.
      bucket = agg.write;
    } else if (!seenPlainNames.has(d.name)) {
      // No prior decl in scope; this IS the first appearance.
      // HAIRY-SELF-REF guard: a decl line that references its own @-name in
      // the init expression is a self-referential degenerate (e.g.,
      // `@count = @count + 1` as the FIRST appearance). Such patterns do
      // not have a sensible V5-strict structural rewrite — flag separately.
      const selfRefRegex = new RegExp(`@${d.name}\\b`, "g");
      const matches = (snippet.match(selfRefRegex) || []).length;
      if (matches >= 2) {
        bucket = agg.hairySelfRef;
      } else {
        bucket = agg.declCandidate;
      }
      seenPlainNames.add(d.name);
    } else {
      bucket = agg.write;
    }
    bucket.push({ filePath, name: d.name, line, col, snippet });
  }
}

function walk(root, files) {
  const stat = statSync(root);
  if (stat.isFile() && root.endsWith(".scrml")) { files.push(root); return; }
  if (!stat.isDirectory()) return;
  for (const ent of readdirSync(root)) {
    if (ent === "dist") continue; // skip compiled outputs
    walk(join(root, ent), files);
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: bun scripts/step12-batch-classify.mjs <root1> [...]");
  process.exit(1);
}
const allFiles = [];
for (const r of roots) walk(resolve(r), allFiles);

const agg = {
  topLevelBlocked: [],
  declCandidate: [],
  hairySelfRef: [],
  write: [],
  legacyComplex: [],
  readErr: [],
  parseErr: [],
};

for (const f of allFiles) classifyFile(f, agg);

console.log(`# Step 12 classifier: ${allFiles.length} .scrml files scanned`);
console.log(`# topLevelBlocked: ${agg.topLevelBlocked.length}`);
console.log(`# declCandidate:   ${agg.declCandidate.length}  <-- REWRITE THESE`);
console.log(`# hairySelfRef:    ${agg.hairySelfRef.length}  <-- LEAVE (degenerate)`);
console.log(`# write:           ${agg.write.length}`);
console.log(`# legacyComplex:   ${agg.legacyComplex.length}`);
console.log(`# readErr:         ${agg.readErr.length}`);
console.log(`# parseErr:        ${agg.parseErr.length}`);
console.log("");
console.log("# === DECL-CANDIDATE (REWRITE TARGETS) ===");
for (const x of agg.declCandidate) {
  console.log(`DECL-CANDIDATE\t${x.filePath}\t${x.name}\tL${x.line}C${x.col}\t${x.snippet}`);
}
console.log("");
console.log("# === HAIRY-SELF-REF (degenerate first-appearance with self-read; LEAVE) ===");
for (const x of agg.hairySelfRef) {
  console.log(`HAIRY-SELF-REF\t${x.filePath}\t${x.name}\tL${x.line}C${x.col}\t${x.snippet}`);
}
console.log("");
console.log("# === LEGACY-COMPLEX (modifiers/Shape3 — LEAVE) ===");
for (const x of agg.legacyComplex) {
  console.log(`LEGACY-COMPLEX\t${x.filePath}\t${x.name}\tL${x.line}C${x.col}\t${x.snippet}`);
}
console.log("");
console.log("# === TOPLEVEL-BLOCKED (Phase 2 parser gap — LEAVE) ===");
for (const x of agg.topLevelBlocked) {
  console.log(`TOPLEVEL-BLOCKED\t${x.filePath}\t${x.name}\tL${x.line}C${x.col}\t${x.snippet}`);
}
if (agg.parseErr.length > 0) {
  console.log("");
  console.log("# === PARSE-ERR ===");
  for (const x of agg.parseErr) console.log(`PARSE-ERR\t${x.filePath}\t${x.err}`);
}
