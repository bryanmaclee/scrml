import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../compiler/src/api.js";
const testDir = resolve(dirname(new URL(import.meta.url).pathname));
function compileWith(source, parser) {
  const tmpDir = resolve(testDir, `_dump_${parser || "live"}_${Date.now()}`);
  const tmpInput = resolve(tmpDir, `leak.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    let clientJs = "", serverJs = "";
    for (const [, out] of result.outputs || new Map()) {
      if (out.clientJs) clientJs += out.clientJs;
      if (out.serverJs) serverJs += out.serverJs;
    }
    return { warnings: result.warnings ?? [], errors: result.errors ?? [], clientJs, serverJs };
  } finally { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); }
}
const src = `<program db="postgres"></>
\${
    ?{\`SELECT secret FROM credentials\`}
}
<p>x</>`;
for (const parser of [null, "scrml-native"]) {
  const label = parser || "live";
  const r = compileWith(src, parser);
  console.log(`\n========== ${label} ==========`);
  console.log("warnings:", r.warnings.map(w => w.code).join(",") || "(none)");
  console.log("errors:", r.errors.map(e => e.code || e.message).join(",") || "(none)");
  console.log("--- CLIENT JS ---");
  console.log(r.clientJs);
  console.log("--- has SELECT/credentials in client? ---", /SELECT|credentials|_scrml_sql/.test(r.clientJs));
}
