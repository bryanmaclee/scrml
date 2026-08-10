/**
 * tare-observed-values.probe.mjs — NOT a test. A one-shot EXECUTION probe that
 * prints the values §6.8.4's two worked cases actually produce, so a reviewer
 * can read the numbers rather than infer them from a green assertion.
 *
 * Run: `bun run compiler/tests/browser/tare-observed-values.probe.mjs`
 *
 * The assertions live in `browser-tare-reset-baseline.test.js`; this file
 * exists because "verified by grepping the emitted text" has shipped a dead
 * client feature here before (S265). It compiles, loads the REAL runtime plus
 * the REAL client bundle into happy-dom, dispatches REAL clicks, and prints
 * what came back.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";

const here = dirname(fileURLToPath(import.meta.url));
const { compileScrml } = await import(resolve(here, "../../src/api.js"));
const { captureInsideChunkScope } = await import(resolve(here, "../helpers/chunk-scope.js"));

const tmpRoot = resolve("/tmp", "scrml-tare-probe");

function build(source, baseName) {
  const dir = resolve(tmpRoot, `${baseName}-${Date.now().toString(36)}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const out = {
    dir,
    errors: errors.map((e) => e.code),
    html: readFileSync(resolve(outDir, `${baseName}.html`), "utf8"),
    clientJs: readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8"),
    runtimeJs: readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8"),
  };
  return out;
}

function mount(built) {
  document.documentElement.innerHTML = built.html;
  const exec = new Function(
    "window", "document",
    `${built.runtimeJs}\n` + captureInsideChunkScope(built.clientJs, `globalThis.__get__ = _scrml_reactive_get;\n`),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    get: (n) => globalThis.__get__(n),
    click: (id) => document.getElementById(id)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  };
}

const COUNTER_NO_TARE = `<program>
\${
    @x = 0
    @x = @x + 1
    function doReset() { reset(@x) }
}
<button id="rst" onclick=doReset()>reset</button>
</program>`;

const COUNTER_TARED = `<program>
\${
    @x = 0
    tare(@x)
    @x = @x + 1
    function doReset() { reset(@x) }
}
<button id="rst" onclick=doReset()>reset</button>
</program>`;

const CONFIG_MERGE = `<program>
\${
    @config = base()
    @config = merge(base(), overrides())
    tare(@config)

    function base() { return { theme: "light", size: 1 } }
    function overrides() { return { theme: "dark" } }
    function merge(a, b) { return { theme: b.theme, size: a.size } }
    function scramble() { @config = { theme: "scrambled", size: 99 } }
    function doReset() { reset(@config) }
}
<p id="shown">\${@config.theme}</p>
<button id="scramble" onclick=scramble()>scramble</button>
<button id="rst" onclick=doReset()>reset</button>
</program>`;

const EXPLICIT_DEFAULT = `<program>
<factor> = 10
\${
    @n = 1
    tare(@n, @factor * 2)
    @n = 999
    function bumpFactor() { @factor = 50 }
    function doReset() { reset(@n) }
}
<button id="bump" onclick=bumpFactor()>bump</button>
<button id="rst" onclick=doReset()>reset</button>
</program>`;

GlobalRegistrator.register();

const built = [
  ["counter (NO tare) — the defect", COUNTER_NO_TARE, "counter_plain"],
  ["counter (tare after FIRST write)", COUNTER_TARED, "counter_tared"],
  ["config merge (tare after LAST write)", CONFIG_MERGE, "config_merge"],
  ["explicit default tare(@n, @factor * 2)", EXPLICIT_DEFAULT, "explicit_default"],
].map(([label, src, name]) => [label, build(src, name)]);

try {
  const [, plain] = built[0];
  let app = mount(plain);
  console.log(`\n[1] counter, NO tare — compile errors: ${JSON.stringify(plain.errors)}`);
  console.log(`    after module-init : @x = ${app.get("x")}`);
  app.click("rst");
  console.log(`    after reset(@x)   : @x = ${app.get("x")}      <- INCREMENTS (the defect)`);

  const [, tared] = built[1];
  app = mount(tared);
  console.log(`\n[2] counter, tare(@x) after the first write — compile errors: ${JSON.stringify(tared.errors)}`);
  console.log(`    after module-init : @x = ${app.get("x")}`);
  app.click("rst");
  console.log(`    after reset(@x)   : @x = ${app.get("x")}      <- RESTORES 0`);
  app.click("rst");
  console.log(`    after reset again : @x = ${app.get("x")}      <- idempotent`);

  const [, cfg] = built[2];
  app = mount(cfg);
  console.log(`\n[3] config merge, tare(@config) after the last write — compile errors: ${JSON.stringify(cfg.errors)}`);
  console.log(`    after module-init : @config = ${JSON.stringify(app.get("config"))}`);
  app.click("scramble");
  console.log(`    after scramble    : @config = ${JSON.stringify(app.get("config"))}`);
  app.click("rst");
  console.log(`    after reset       : @config = ${JSON.stringify(app.get("config"))}   <- RESTORES THE MERGED VALUE`);
  console.log(`    rendered <p>      : "${document.getElementById("shown").textContent}"`);

  const [, exp] = built[3];
  app = mount(exp);
  console.log(`\n[4] tare(@n, @factor * 2) — compile errors: ${JSON.stringify(exp.errors)}`);
  console.log(`    after module-init : @n = ${app.get("n")}, @factor = ${app.get("factor")}`);
  app.click("rst");
  console.log(`    after reset(@n)   : @n = ${app.get("n")}     <- @factor(10) * 2`);
  app.click("bump");
  app.click("rst");
  console.log(`    @factor -> 50, reset again : @n = ${app.get("n")}    <- THUNK re-evaluated, not a snapshot`);
  console.log("");
} finally {
  for (const [, b] of built) {
    if (existsSync(b.dir)) rmSync(b.dir, { recursive: true, force: true });
  }
  await GlobalRegistrator.unregister();
}
