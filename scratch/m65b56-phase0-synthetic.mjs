import { readFileSync } from "node:fs";
import { parseMarkupTrace, liftBareBlocks } from "../compiler/native-parser/parse-markup.js";
const fx="examples/14-mario-state-machine.scrml";
const src=readFileSync(fx,"utf8");
const run=parseMarkupTrace(src);
const raw=run.ctx.nodes;
const blocks=liftBareBlocks(raw,src,null,run.ctx);
let count=0;
function walk(b,d=0){ if(!b||d>8) return; if(b._synthetic===true && b.kind==="LogicEscape") count++; if(Array.isArray(b.children)) b.children.forEach(c=>walk(c,d+1)); }
blocks.forEach(b=>walk(b));
console.log("synthetic LogicEscape blocks (lifted) reachable:", count);
