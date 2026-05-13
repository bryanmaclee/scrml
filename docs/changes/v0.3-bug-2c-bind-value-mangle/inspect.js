// Inspect the component-def raw and the post-CE expanded AST attrs.
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { runCE } from "../../../compiler/src/component-expander.ts";
import fs from "fs";

// Inline copy of normalizeTokenizedRaw for tracing
function normalizeTokenizedRaw(raw) {
  let s = raw.trim();
  console.log("\n--- normalize trace ---");
  console.log("input :", JSON.stringify(s));
  s = s.replace(/< \/ >/g, "</>");
  s = s.replace(/< \/ ([A-Za-z][A-Za-z0-9_-]*) >/g, "</$1>");
  s = s.replace(/< ([A-Za-z])/g, "<$1");
  console.log("after step1:", JSON.stringify(s));
  s = s.replace(/([A-Za-z0-9_"])\s+>/g, "$1>");
  s = s.replace(/\s+\/\s+>/g, "/>");
  s = s.replace(/\s+\/\s+>(\s*)$/, "/>");
  s = s.replace(/\s+\/>\s*$/, "/>");
  s = s.replace(/\s+>\s*$/, ">");
  s = s.replace(/(\w)\s+-\s+(\w)/g, "$1-$2");
  s = s.replace(/(\w)\s+\?\s*:/g, "$1?:");
  s = s.replace(/(\w)\s+=\s+/g, "$1=");
  s = s.replace(/\s+=\s+/g, "=");
  console.log("output:", JSON.stringify(s));
  return s;
}
const sample = `< input type = "text" bind : value = @firstName / >`;
normalizeTokenizedRaw(sample);

const samplePropsBlock = `< input props = { name : string , type : string } type = "text" bind : value = @firstName / >`;
normalizeTokenizedRaw(samplePropsBlock);

const sampleArith = `< div onclick = ${`{count: a - b}`} bind : value = @x />`;
normalizeTokenizedRaw(sampleArith);


const path = "docs/changes/v0.3-bug-2c-bind-value-mangle/repro.scrml";
const src = fs.readFileSync(path, "utf8");
const blocks = splitBlocks(path, src);
const tab = buildAST(blocks);
const ast = tab.ast;

function walkAndShow(n, label="root", depth=0) {
  if (!n || typeof n !== "object") return;
  if (n.kind === "component-def") {
    console.log("=== component-def name:", n.name);
    console.log("raw:", JSON.stringify(n.raw));
    console.log("");
  }
  if (n.kind === "markup" && n.tag === "input") {
    console.log("=== input markup attrs (BEFORE CE) [", label, "]:");
    console.log(JSON.stringify(n.attrs, null, 2));
  }
  for (const k of Object.keys(n)) {
    if (k === "span" || k === "id") continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c, i) => walkAndShow(c, `${label}.${k}[${i}]`, depth+1));
    else if (v && typeof v === "object") walkAndShow(v, `${label}.${k}`, depth+1);
  }
}

console.log("##### PRE-CE #####");
walkAndShow(ast);

const ceOut = runCE({ files: [{ filePath: path, ast }] });
console.log("\n##### POST-CE #####");
console.log("CE errors:", ceOut.errors);
walkAndShow(ceOut.files[0].ast);
