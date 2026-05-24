import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../compiler/src/api.js";
const testDir = resolve(dirname(new URL(import.meta.url).pathname));
function compileWith(source, parser) {
  const tmpDir = resolve(testDir, `_cl_${parser||"live"}_${Date.now()}`);
  const tmpInput = resolve(tmpDir, `leak.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles:[tmpInput], write:false, outputDir: resolve(tmpDir,"out") };
    if (parser) opts.parser = parser;
    const r = compileScrml(opts);
    let clientJs="";
    for (const [,o] of r.outputs||new Map()) if (o.clientJs) clientJs += o.clientJs;
    return { warnings:r.warnings??[], clientJs };
  } finally { if (existsSync(tmpDir)) rmSync(tmpDir,{recursive:true,force:true}); }
}
const src = `<program db="postgres"></>\n\${\n    ?{\`DELETE FROM credentials\`}.run()\n}\n<p>x</>`;
for (const parser of [null, "scrml-native"]) {
  const { warnings, clientJs } = compileWith(src, parser);
  const leak = /_scrml_sql|DELETE FROM credentials/.test(clientJs);
  console.log(`[${parser||"live"}] W-CG-001=${warnings.some(w=>w.code==="W-CG-001")} client-leak=${leak}`);
  if (leak) { const i = clientJs.search(/_scrml_sql|DELETE/); console.log("  SNIP:", clientJs.slice(Math.max(0,i-30), i+70)); }
}
