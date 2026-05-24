import { readFileSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
const fx="examples/22-multifile/app.scrml";
const live=buildAST(splitBlocks(fx,readFileSync(fx,"utf8")),null).ast;
// navigate to ast.nodes[13].children[25].children[9].children[1].body[0].body[0].expr
let cur=live.nodes[13];
for(const seg of [["children",25],["children",9],["children",1],["body",0],["body",0]]) cur=cur[seg[0]][seg[1]];
console.log("live expr kind:", cur.expr && cur.expr.kind, "keys:", cur.expr && Object.keys(cur.expr));
const en = cur.expr && cur.expr.node;
console.log("live expr.node kind:", en && en.kind, "has openerHadSpaceAfterLt:", en && ("openerHadSpaceAfterLt" in en), "has _p3aIsExport:", en && ("_p3aIsExport" in en));
console.log("live expr.node keys:", en && Object.keys(en));
