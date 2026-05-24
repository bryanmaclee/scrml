import { readFileSync } from "node:fs";
import { compileScrml } from "../compiler/src/api.js";
const fx="examples/01-hello.scrml";
const src=readFileSync(fx,"utf8");
const r=await compileScrml({ files:[{ path:fx, content:src }], parser:"scrml-native", mode:"app" });
console.log("return keys:", Object.keys(r));
const errs=(r.errors||[]).filter(e=>e&&e.severity!=="warning"&&e.severity!=="info");
console.log("hard errors:", errs.length, errs.slice(0,3).map(e=>e.code||String(e)));
// confirm some output produced
const files = r.files || r.outputs || r.output || null;
console.log("output container type:", files && (Array.isArray(files)?"array["+files.length+"]":typeof files));
