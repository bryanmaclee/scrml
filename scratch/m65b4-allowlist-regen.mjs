// Regenerate the within-node allowlist from current raw counts, and report
// the per-fixture delta vs the committed allowlist.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateScrmlCorpus } from "../compiler/tests/parser-conformance/corpus-enumerator.js";
import { classifyDivergences } from "../compiler/src/native-parser-canary/within-node-classifier.ts";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";

const ALLOWLIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "../compiler/tests/parser-conformance-within-node-allowlist.json");
const OLD = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
const CORPUS = enumerateScrmlCorpus();

function bothPipelines(fp, src) {
  let live=null, native=null;
  try { live = buildAST(splitBlocks(fp, src), null).ast; } catch {}
  try { native = nativeParseFile(fp, src).ast; } catch {}
  return { live, native };
}

const NEW = {};
const deltas = [];
for (const row of CORPUS) {
  const src = readFileSync(row.path, "utf8");
  const { live, native } = bothPipelines(row.path, src);
  const r = classifyDivergences(live, native);
  // Only keep non-empty class entries (allowlist style).
  const entry = {};
  for (const k of Object.keys(r.classCounts)) {
    if (r.classCounts[k] > 0) entry[k] = r.classCounts[k];
  }
  if (Object.keys(entry).length > 0) NEW[row.relpath] = entry;

  // Compare vs OLD per class.
  const oldEntry = OLD[row.relpath] || {};
  const allKeys = new Set([...Object.keys(oldEntry), ...Object.keys(entry)]);
  const cls = {};
  let changed = false;
  for (const k of allKeys) {
    const o = oldEntry[k] || 0, n = entry[k] || 0;
    if (o !== n) { cls[k] = { old: o, new: n, delta: n - o }; changed = true; }
  }
  if (changed) deltas.push({ file: row.relpath, cls });
}

console.log("=== Per-fixture allowlist deltas (old -> new) ===");
for (const d of deltas) console.log(d.file, JSON.stringify(d.cls));
console.log(`\nTotal fixtures with deltas: ${deltas.length}`);
const anyIncrease = deltas.some(d => Object.values(d.cls).some(c => c.delta > 0));
console.log("Any class INCREASED (regression risk):", anyIncrease);

// Write regenerated allowlist (sorted keys for stable diff).
const sorted = {};
for (const k of Object.keys(NEW).sort()) sorted[k] = NEW[k];
writeFileSync(ALLOWLIST_PATH, JSON.stringify(sorted, null, 2) + "\n");
console.log(`\nWrote regenerated allowlist: ${Object.keys(sorted).length} entries to ${ALLOWLIST_PATH}`);
