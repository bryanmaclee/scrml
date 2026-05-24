import { readFileSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
import { classifyDivergences } from "../compiler/src/native-parser-canary/within-node-classifier.ts";
// For each F field, what is the .kind of the NATIVE node at the divergence path?
for (const fx of ["examples/14-mario-state-machine.scrml","examples/22-multifile/app.scrml"]) {
  const src=readFileSync(fx,"utf8");
  const live=buildAST(splitBlocks(fx,src),null).ast;
  const native=nativeParseFile(fx,src).ast;
  const { samples }=classifyDivergences(live,native);
  // resolve native node kind at a path's parent (strip last .field)
  function resolve(root, path){ // path like ast.nodes[4].children[1].openerHadSpaceAfterLt
    const parts = path.replace(/^ast\.?/,"").split(/\.(?![^\[]*\])/);
    let cur = root;
    for (let i=0;i<parts.length-1;i++){ // stop before last field
      const seg=parts[i]; const m=seg.match(/^([a-zA-Z0-9_]+)((\[\d+\])*)$/); if(!m){cur=undefined;break;}
      cur = cur && cur[m[1]];
      const idxs=(m[2].match(/\d+/g)||[]); for(const ix of idxs){ cur = cur && cur[+ix]; }
      if(cur==null) break;
    }
    return cur && cur.kind;
  }
  const tally={};
  for(const s of samples){
    if(!/(openerHadSpaceAfterLt|_p3aIsExport|_synthetic)$/.test(s.path)) continue;
    const m=s.path.match(/(openerHadSpaceAfterLt|_p3aIsExport|_synthetic)$/)[1];
    const k=resolve({nodes:native.nodes,machineDecls:native.machineDecls,typeDecls:native.typeDecls},s.path) || "?";
    const key=`${m} @ live-node-kind=${resolve({nodes:live.nodes,machineDecls:live.machineDecls,typeDecls:live.typeDecls},s.path)||"?"}`;
    tally[key]=(tally[key]||0)+1;
  }
  console.log(fx); console.log(JSON.stringify(tally,null,1));
}
