// M6.5.b.4 Phase-0 leak repro: drive the NATIVE pipeline through codegen and
// assert whether server-only SQL leaks into the client bundle.
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../compiler/src/api.js";

const testDir = resolve(dirname(new URL(import.meta.url).pathname));

function compileWith(source, parser) {
  const tmpDir = resolve(testDir, `_leak_${parser || "live"}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `leak.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    let clientJs = "";
    let serverJs = "";
    for (const [, out] of result.outputs || new Map()) {
      if (out.clientJs) clientJs += out.clientJs;
      if (out.serverJs) serverJs += out.serverJs;
    }
    return {
      warnings: result.warnings ?? [],
      errors: result.errors ?? [],
      clientJs,
      serverJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Non-server-scope ${ ?{...} } — SQL at top-level logic, NOT inside a server fn.
const src = `<program db="postgres"></>
\${
    ?{\`SELECT secret FROM credentials\`}
}
<p>x</>`;

for (const parser of [null, "scrml-native"]) {
  const label = parser || "live";
  const { warnings, clientJs } = compileWith(src, parser);
  const leak = /_scrml_sql/.test(clientJs);
  const wcg001 = warnings.some(w => w.code === "W-CG-001");
  console.log(`[${label}] W-CG-001=${wcg001}  client-has-_scrml_sql=${leak}  clientLen=${clientJs.length}`);
  if (leak) {
    const idx = clientJs.indexOf("_scrml_sql");
    console.log(`  LEAK SNIPPET: ...${clientJs.slice(Math.max(0, idx - 40), idx + 60)}...`);
  }
}
