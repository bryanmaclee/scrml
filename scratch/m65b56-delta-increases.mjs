import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateScrmlCorpus } from "../compiler/tests/parser-conformance/corpus-enumerator.js";
import { classifyDivergences } from "../compiler/src/native-parser-canary/within-node-classifier.ts";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
const ALLOWLIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "../compiler/tests/parser-conformance-within-node-allowlist.json");
const OLD = JSON.parse(readFileSync(ALLOWLIST_PATH,"utf8"));
const CORPUS = enumerateScrmlCorpus();
const incReport=[]; const totalDelta={};
for (const row of CORPUS){
  const src=readFileSync(row.path,"utf8");
  let live=null,native=null; try{live=buildAST(splitBlocks(row.path,src),null).ast;}catch{} try{native=nativeParseFile(row.path,src).ast;}catch{}
  const r=classifyDivergences(live,native);
  const oldE=OLD[row.relpath]||{};
  const inc={};
  for(const k of Object.keys(r.classCounts)){
    const o=oldE[k]||0, n=r.classCounts[k];
    totalDelta[k]=(totalDelta[k]||0)+(n-o);
    if(n>o) inc[k]={old:o,new:n,delta:n-o};
  }
  if(Object.keys(inc).length) incReport.push({file:row.relpath,inc});
}
console.log("=== FIXTURES WITH ANY CLASS INCREASE (vs committed allowlist) ===");
for(const d of incReport) console.log(d.file, JSON.stringify(d.inc));
console.log(`\nTotal fixtures with an increase: ${incReport.length}`);
console.log("Corpus-wide NET per-class delta:", JSON.stringify(totalDelta));
