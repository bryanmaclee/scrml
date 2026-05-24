import { readFileSync } from "node:fs";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
const fx = "examples/14-mario-state-machine.scrml";
const native = nativeParseFile(fx, readFileSync(fx,"utf8")).ast;
const md = native.machineDecls[0];
console.log("native engine bodyChildren[1].kind:", md.bodyChildren[1] && md.bodyChildren[1].kind);
console.log("native engine bodyChildren[1].attrs[0]:", JSON.stringify(md.bodyChildren[1] && md.bodyChildren[1].attrs && md.bodyChildren[1].attrs[0]));
// translated markup node kind
function findMarkup(n, d=0){ if(!n||d>6) return null; if(n.kind==="markup"&&Array.isArray(n.attrs)&&n.attrs.some(a=>a&&a.value&&"sourceText" in a.value)) return n; if(Array.isArray(n.children)) for(const c of n.children){const r=findMarkup(c,d+1); if(r) return r;} return null;}
const m = findMarkup(native.nodes.find(x=>x.kind==="markup")) || native.nodes.map(x=>findMarkup(x)).find(Boolean);
console.log("translated markup node kind:", m&&m.kind, "attrs[0].value:", m&&JSON.stringify(m.attrs[0].value));
