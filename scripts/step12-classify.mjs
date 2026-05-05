#!/usr/bin/env bun
/**
 * Phase A1a Step 12 helper — classify @x = init occurrences in sample files.
 *
 * Three cases per SPEC §6.1.2 + Phase 2 finding:
 *
 *   Case 1: top-level `@x = init` (outside `${...}`) — parser does NOT
 *           generate a state-decl AST node (BS-stage parses this as raw text).
 *           Phase 2 finding: top-level structural Shape 1 form `<x> = init`
 *           is NOT recognized by BS at top level. So Case 1 sites are NOT
 *           Step 12 REWRITE candidates (parser gap, follow-up P-FUP-1).
 *
 *   Case 2: inside-`${...}` `@x = init` (first appearance file-wide; no
 *           Case 1 for this name) — REWRITE candidate per S61 Q2 Option A.
 *
 *   Case 3: inside-`${...}` `@x = newval` (post-decl write OR subsequent
 *           write to a Case-1-decl'd name) — LEAVE per SPEC §6.1.2 canonical
 *           write form.
 *
 * Approach:
 *   1. Scan raw source for top-level `@x = ` patterns (lines NOT inside any
 *      `${...}` brace pair). Produces topLevelDecls Set<name>.
 *   2. From the AST, get all `state-decl{structuralForm:false}` (and not
 *      modifier-flagged like isServer / isShared / isConst). These are the
 *      inside-`${...}` AST-recognized decls.
 *   3. Sort by source position. For each unique name, the FIRST AST occurrence
 *      is DECL-CANDIDATE iff name is NOT in topLevelDecls. All others WRITE.
 *
 * Output (TSV; one line per match):
 *   STATUS\tFILE\tNAME\tLINE\tCOL\tSOURCE_LINE
 * Plus a TOPLEVEL line for each Case 1 site (informational; NOT a REWRITE
 * candidate, but documents what's blocked by the parser gap).
 *
 * NOT FOR PRODUCTION — temporary Step 12 dispatch helper.
 */

import { readFileSync, existsSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";

function findKind(ast, target) {
  const out = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.kind === target) out.push(n);
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return out;
}

/**
 * Find top-level `@x = ` patterns by scanning source with brace-depth
 * tracking. Returns Map<name, {line, col, snippet}> for each FIRST
 * top-level appearance per name.
 *
 * "Top-level" here means: not inside any `${...}` `?{...}` `!{...}` `^{...}`
 * `~{...}` `#{...}` brace pair, AND not inside a multi-char-delimited block
 * like `<...>` markup tags. This is approximate — the goal is to identify
 * file-level decls where the parser leaves them as text.
 */
function findTopLevelDecls(source) {
  const out = new Map();
  let depth = 0;
  let pos = 0;
  let line = 1;
  let col = 1;
  const len = source.length;

  // Track inside-string state for safety.
  let inStr = null; // null | '"' | "'" | "`"

  while (pos < len) {
    const c = source[pos];

    // Newline tracking
    if (c === "\n") { line++; col = 1; pos++; continue; }

    // String tracking (skip contents)
    if (inStr) {
      if (c === "\\" && pos + 1 < len) { pos += 2; col += 2; continue; }
      if (c === inStr) inStr = null;
      pos++; col++; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      pos++; col++; continue;
    }

    // Comment skipping (// to end of line, /* ... */)
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

    // Sigil-block opener: $, ?, !, ^, ~, # followed by `{`
    if ("$?!^~#".includes(c) && source[pos + 1] === "{") {
      depth++;
      pos += 2; col += 2;
      continue;
    }

    // Bare `{` — also increases depth (function body, object literal, etc.)
    if (c === "{") {
      depth++;
      pos++; col++;
      continue;
    }
    if (c === "}") {
      if (depth > 0) depth--;
      pos++; col++;
      continue;
    }

    // At top level (depth=0), look for `@ident = ` pattern.
    if (depth === 0 && c === "@") {
      // Scan ident
      let p = pos + 1;
      let ident = "";
      while (p < len && /[A-Za-z0-9_]/.test(source[p])) {
        ident += source[p];
        p++;
      }
      if (ident.length > 0) {
        // Skip whitespace
        let q = p;
        while (q < len && /[ \t]/.test(source[q])) q++;
        if (source[q] === "=" && source[q + 1] !== "=") {
          // Found @ident = ... at top level.
          if (!out.has(ident)) {
            const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
            const lineEnd = source.indexOf("\n", pos);
            const snippet = source.slice(lineStart, lineEnd === -1 ? len : lineEnd).trim();
            out.set(ident, { line, col, snippet });
          }
          // Don't change depth — `=` is not a brace.
          pos = q + 1; col += (q + 1 - pos);
          continue;
        }
      }
    }

    pos++; col++;
  }
  return out;
}

function classifyFile(filePath) {
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (e) {
    console.log(`READ-ERROR\t${filePath}\t${e.message}`);
    return;
  }
  let bs, ast;
  try {
    bs = splitBlocks(filePath, source);
    ast = buildAST(bs);
  } catch (e) {
    console.log(`PARSE-ERROR\t${filePath}\t${e.message}`);
    return;
  }
  // Step 1: top-level decls (NOT REWRITE candidates per Phase 2 finding).
  const topLevelDecls = findTopLevelDecls(source);
  for (const [name, info] of topLevelDecls) {
    console.log(`TOPLEVEL-BLOCKED\t${filePath}\t${name}\tL${info.line}C${info.col}\t${info.snippet}`);
  }

  // Step 2: AST-recognized state-decls with structuralForm:false.
  let decls = findKind(ast, "state-decl").filter((d) => d.structuralForm === false);
  // Sort by source position.
  decls.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));

  const seenInsideNames = new Set();
  for (const d of decls) {
    const start = d.span?.start ?? -1;
    const line = d.span?.line ?? "?";
    const col = d.span?.col ?? "?";
    let snippet = "";
    if (start >= 0) {
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = source.indexOf("\n", start);
      snippet = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
    }
    let status;
    if (d.isServer || d.isShared || d.isConst || (d.shape && d.shape !== "plain")) {
      status = "LEGACY-COMPLEX";
    } else if (topLevelDecls.has(d.name)) {
      // The name was decl'd at top level (Case 1). All inside-${...} writes are Case 3.
      status = "WRITE";
    } else if (!seenInsideNames.has(d.name)) {
      // No top-level decl for this name; first AST occurrence is the decl.
      status = "DECL-CANDIDATE";
      seenInsideNames.add(d.name);
    } else {
      status = "WRITE";
    }
    console.log(`${status}\t${filePath}\t${d.name}\tL${line}C${col}\t${snippet}`);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun scripts/step12-classify.mjs <file1> [...]");
  process.exit(1);
}
for (const f of args) {
  if (!existsSync(f)) {
    console.log(`MISSING\t${f}`);
    continue;
  }
  classifyFile(f);
}
