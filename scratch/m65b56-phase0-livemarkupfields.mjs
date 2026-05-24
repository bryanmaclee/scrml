import { readFileSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
// Across corpus-ish sample: do ANY live markup nodes OMIT openerHadSpaceAfterLt?
// And classify by whether they're under a 'body'/'expr' (logic/lift) ancestor.
import { readdirSync } from "node:fs";
function files(d){let o=[];let e;try{e=readdirSync(d,{withFileTypes:true});}catch{return o;}for(const x of e){const p=d+"/"+x.name;if(x.isDirectory())o=o.concat(files(p));else if(x.name.endsWith(".scrml"))o.push(p);}return o;}
let all=files("examples").concat(files("samples")).slice(0,200);
let withField=0, withoutField=0, withoutUnderExpr=0, withoutNotUnderExpr=0;
function walk(node, underExpr){
  if(!node||typeof node!=="object") return;
  if(Array.isArray(node)){ node.forEach(n=>walk(n,underExpr)); return; }
  if(node.kind==="markup"){
    if("openerHadSpaceAfterLt" in node) withField++;
    else { withoutField++; if(underExpr) withoutUnderExpr++; else withoutNotUnderExpr++; }
  }
  for(const k of Object.keys(node)){
    const v=node[k];
    const ue = underExpr || k==="expr" || k==="node" || k==="exprNode";
    if(v&&typeof v==="object") walk(v, ue);
  }
}
for(const f of all){ try{ const ast=buildAST(splitBlocks(f,readFileSync(f,"utf8")),null).ast; ast.nodes.forEach(n=>walk(n,false)); }catch{} }
console.log("LIVE markup nodes: withField(openerHadSpaceAfterLt)=",withField," withoutField=",withoutField);
console.log("  without: underExpr/node/exprNode ancestor=",withoutUnderExpr," NOT-under-expr=",withoutNotUnderExpr);
