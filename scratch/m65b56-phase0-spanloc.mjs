import { readFileSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
import { classifyDivergences } from "../compiler/src/native-parser-canary/within-node-classifier.ts";
const fx = process.argv[2] || "examples/14-mario-state-machine.scrml";
const src = readFileSync(fx,"utf8");
const live = buildAST(splitBlocks(fx,src),null).ast;
const native = nativeParseFile(fx,src).ast;
const { samples } = classifyDivergences(live, native);
// bucket SPAN-COORD + sourceText by top-level path prefix
const bucket = {};
for (const s of samples) {
  if (s.class !== "SPAN-COORD" && !/sourceText/.test(s.path)) continue;
  const top = s.path.split(/[\.\[]/).slice(0,2).join(".");
  const key = `${s.class}:${top}`;
  bucket[key]=(bucket[key]||0)+1;
}
console.log(fx);
console.log(JSON.stringify(bucket,null,1));
// Does live engine-decl carry bodyChildren? does live machineDecls span have file?
const md = live.machineDecls && live.machineDecls[0];
console.log("live machineDecls[0] keys:", md? Object.keys(md): "none");
console.log("live machineDecls[0].span:", md? JSON.stringify(md.span): "none");
const nmd = native.machineDecls && native.machineDecls[0];
console.log("native machineDecls[0] keys:", nmd? Object.keys(nmd): "none");
console.log("native machineDecls[0].span:", nmd? JSON.stringify(nmd.span): "none");
// live node span sample
console.log("live nodes[4].span:", JSON.stringify(live.nodes[4] && live.nodes[4].span));
