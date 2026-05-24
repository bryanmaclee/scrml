// m65b3-hoist-sweep.js — Phase-0 corpus-wide hoist-gap sweep (M6.5.b.3).
// For every corpus .scrml file, run BOTH pipelines and compare the SIX
// hoisted-collection LENGTHS (imports/exports/typeDecls/components/
// machineDecls/channelDecls) + hasProgramRoot. Reports every file where
// native length < live length (the hoist-gap signature), and every file
// where native length > live (over-count). Tells us if ANY hoist gap
// remains at this HEAD.
import { readFileSync } from "node:fs";
import { splitBlocks } from "../../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../../compiler/src/ast-builder.js";
import { nativeParseFile } from "../../../../compiler/native-parser/parse-file.js";
import { enumerateScrmlCorpus } from "../../../../compiler/tests/parser-conformance/corpus-enumerator.js";

const KEYS = ["imports","exports","typeDecls","components","machineDecls","channelDecls"];
const corpus = enumerateScrmlCorpus();
let gapFiles = 0, overFiles = 0, progRootMismatch = 0, crashed = 0;
const progRootList = [];
const gaps = [];
const overs = [];

for (const row of corpus) {
  let src;
  try { src = readFileSync(row.path, "utf8"); } catch { continue; }
  let live, native;
  try {
    const bs = splitBlocks(row.path, src);
    live = buildAST(bs).ast;
    native = nativeParseFile(row.path, src).ast;
  } catch (e) {
    crashed++; continue;
  }
  const lenL = {}, lenN = {};
  for (const k of KEYS) {
    lenL[k] = Array.isArray(live[k]) ? live[k].length : 0;
    lenN[k] = Array.isArray(native[k]) ? native[k].length : 0;
  }
  const fileGaps = KEYS.filter(k => lenN[k] < lenL[k]);
  const fileOvers = KEYS.filter(k => lenN[k] > lenL[k]);
  if (fileGaps.length) { gapFiles++; gaps.push({ relpath: row.relpath, gaps: fileGaps.map(k => `${k}:${lenN[k]}<${lenL[k]}`), prog: !!live.hasProgramRoot }); }
  if (fileOvers.length) { overFiles++; overs.push({ relpath: row.relpath, overs: fileOvers.map(k => `${k}:${lenN[k]}>${lenL[k]}`) }); }
  if (!!live.hasProgramRoot !== !!native.hasProgramRoot) { progRootMismatch++; progRootList.push(`${row.relpath} liveProg=${!!live.hasProgramRoot} nativeProg=${!!native.hasProgramRoot}`); }
}

console.log(`Corpus files: ${corpus.length}; crashed: ${crashed}`);
console.log(`hasProgramRoot mismatch files: ${progRootMismatch}`);
for (const x of progRootList) console.log(`  PROGROOT: ${x}`);
console.log(`\n=== HOIST-GAP files (native length < live length) : ${gapFiles} ===`);
for (const g of gaps) console.log(`  ${g.relpath}  [program=${g.prog}]  ${g.gaps.join(" ")}`);
console.log(`\n=== OVER-COUNT files (native length > live length) : ${overFiles} ===`);
for (const o of overs.slice(0,40)) console.log(`  ${o.relpath}  ${o.overs.join(" ")}`);
if (overs.length > 40) console.log(`  ... and ${overs.length - 40} more`);
