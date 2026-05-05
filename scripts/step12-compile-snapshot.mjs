#!/usr/bin/env bun
/**
 * Phase A1a Step 12 — compile every .scrml under given roots; record
 * pass/fail per file. Output is a TSV: STATUS\tFILE.
 *   PASS — compiled with 0 errors (warnings OK)
 *   FAIL — compile reported errors
 *
 * Used to capture pre-rewrite + post-rewrite compile state for diff.
 *
 * Usage:
 *   bun scripts/step12-compile-snapshot.mjs <root1> [<root2> ...] > snapshot.tsv
 *
 * NOT FOR PRODUCTION — temporary Step 12 dispatch helper.
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";

function walk(root, files) {
  const stat = statSync(root);
  if (stat.isFile() && root.endsWith(".scrml")) { files.push(root); return; }
  if (!stat.isDirectory()) return;
  for (const ent of readdirSync(root)) {
    if (ent === "dist") continue;
    walk(join(root, ent), files);
  }
}

function compileSnapshot(filePath) {
  let source;
  try { source = readFileSync(filePath, "utf8"); }
  catch (e) { return { status: "FAIL", err: "read-error: " + e.message }; }
  let bs, tab;
  try {
    bs = splitBlocks(filePath, source);
    tab = buildAST(bs);
  } catch (e) {
    return { status: "FAIL", err: "build-error: " + e.message };
  }
  const bsErrors = bs.errors || [];
  if (bsErrors.length > 0) {
    return { status: "FAIL", err: "bs-errors: " + bsErrors.length };
  }
  const tabErrors = tab.errors || [];
  if (tabErrors.length > 0) {
    return { status: "FAIL", err: "tab-errors: " + tabErrors.length };
  }
  return { status: "PASS" };
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: bun scripts/step12-compile-snapshot.mjs <root1> [...]");
  process.exit(1);
}
const allFiles = [];
for (const r of roots) walk(resolve(r), allFiles);

let pass = 0, fail = 0;
const results = [];
for (const f of allFiles) {
  const res = compileSnapshot(f);
  if (res.status === "PASS") pass++; else fail++;
  results.push(`${res.status}\t${f}\t${res.err || ""}`);
}
console.log(`# Snapshot: ${allFiles.length} files; PASS=${pass}, FAIL=${fail}`);
for (const r of results) console.log(r);
