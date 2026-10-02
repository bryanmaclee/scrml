#!/usr/bin/env bun
/**
 * Migrate bare `/` and trailing `/` closers to `</>` in .scrml files.
 *
 * Uses the compiler's splitBlocks() to find all inferred closers,
 * then replaces the `/` at those source positions with `</>`.
 *
 * Usage: bun scripts/migrate-closers.js [--dry-run] [dir1 dir2 ...]
 * Default dirs: samples/ examples/ benchmarks/ stdlib/
 */

import { splitBlocks } from "../compiler/src/block-splitter.js";
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dirs = args.filter(a => !a.startsWith("--"));

if (dirs.length === 0) {
  dirs.push("samples", "examples", "benchmarks", "stdlib");
}

function findScrmlFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findScrmlFiles(full));
      } else if (extname(entry.name) === ".scrml") {
        results.push(full);
      }
    }
  } catch { /* dir doesn't exist */ }
  return results;
}

/**
 * Walk the block tree and collect source positions of inferred closers.
 * Each position is the index of the `/` character that serves as the closer.
 */
function collectInferredCloserPositions(block, source) {
  const positions = [];

  function walk(b) {
    if (b.closerForm === "inferred" && b.span) {
      // The closer is at the end of the block's span.
      // For bare `/` on its own line or trailing `/`, the `/` is at span.end - 1.
      // We need to find the actual `/` character near span.end.
      let endPos = b.span.end - 1;
      // Search backward from endPos for the `/` character
      while (endPos >= 0 && source[endPos] !== "/") endPos--;
      if (endPos >= 0 && source[endPos] === "/") {
        // Make sure this isn't already `</>`
        if (!(endPos >= 2 && source[endPos - 1] === "/" && source[endPos - 2] === "<")) {
          // Make sure it's not `/>` (self-closing)
          if (!(endPos > 0 && source[endPos - 1] !== "<" && source[endPos + 1] === ">")) {
            positions.push(endPos);
          }
        }
      }
    }
    if (b.children) {
      for (const child of b.children) {
        if (child && typeof child === "object") walk(child);
      }
    }
  }

  walk(block);
  return positions;
}

let totalFiles = 0;
let totalMigrated = 0;
let totalReplacements = 0;

for (const dir of dirs) {
  const files = findScrmlFiles(dir);
  for (const file of files) {
    totalFiles++;
    const source = readFileSync(file, "utf-8");

    // Parse with block splitter to find inferred closers
    let result;
    try {
      result = splitBlocks(file, source);
    } catch {
      console.log(`  SKIP  ${file} (parse error)`);
      continue;
    }

    // Collect all inferred closer positions
    const positions = [];
    for (const block of result.blocks) {
      positions.push(...collectInferredCloserPositions(block, source));
    }

    if (positions.length === 0) continue;

    // Sort positions descending so we can replace from end to start
    positions.sort((a, b) => b - a);

    // Deduplicate
    const unique = [...new Set(positions)];

    // Apply replacements
    let modified = source;
    for (const pos of unique) {
      // Replace single `/` with `</>`
      modified = modified.slice(0, pos) + "</>" + modified.slice(pos + 1);
    }

    if (modified !== source) {
      totalMigrated++;
      totalReplacements += unique.length;
      if (dryRun) {
        console.log(`  DRY   ${file} (${unique.length} replacements)`);
      } else {
        writeFileSync(file, modified);
        console.log(`  DONE  ${file} (${unique.length} replacements)`);
      }
    }
  }
}

console.log(`\n${dryRun ? "DRY RUN — " : ""}${totalFiles} files scanned, ${totalMigrated} files modified, ${totalReplacements} total replacements`);
