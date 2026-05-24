import { readFileSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
const fx="examples/23-trucking-dispatch/channels/load-events.scrml";
const src=readFileSync(fx,"utf8");
const live=buildAST(splitBlocks(fx,src),null).ast;
const native=nativeParseFile(fx,src).ast;
const lc=live.channelDecls&&live.channelDecls[0], nc=native.channelDecls&&native.channelDecls[0];
console.log("live channelDecls[0].kind:",lc&&lc.kind,"keys:",lc&&Object.keys(lc));
console.log("native channelDecls[0].kind:",nc&&nc.kind,"keys:",nc&&Object.keys(nc));
// is channelDecls[0] === some node in nodes (shared ref)?
console.log("native channel shared with a node?:", native.nodes.includes(nc));
console.log("live channel shared with a node?:", live.nodes.includes(lc));
