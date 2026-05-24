import { readFileSync, readdirSync } from "node:fs";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
// scan a broad sample of corpus files; tally distinct native closerForm values
const dirs = ["examples","samples"];
const vals = {};
function walk(node){
  if(!node||typeof node!=="object") return;
  if(node.kind==="markup" && "closerForm" in node){ vals[JSON.stringify(node.closerForm)]=(vals[JSON.stringify(node.closerForm)]||0)+1; }
  for(const k of Object.keys(node)){ const v=node[k]; if(Array.isArray(v)) v.forEach(walk); else if(v&&typeof v==="object") walk(v); }
}
import { readdirSync as rd } from "node:fs";
function files(d){ let out=[]; let ents; try{ents=rd(d,{withFileTypes:true});}catch{return out;} for(const e of ents){ const p=d+"/"+e.name; if(e.isDirectory()) out=out.concat(files(p)); else if(e.name.endsWith(".scrml")) out.push(p);} return out;}
let all=[]; for(const d of dirs) all=all.concat(files(d));
let n=0;
for(const f of all){ try{ const ast=nativeParseFile(f,readFileSync(f,"utf8")).ast; for(const node of ast.nodes) walk(node); n++; }catch{} }
console.log("scanned",n,"files");
console.log("native markup closerForm value tally:", JSON.stringify(vals,null,1));
