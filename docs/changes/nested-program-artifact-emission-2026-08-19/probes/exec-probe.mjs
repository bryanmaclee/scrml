// EXECUTE, don't grep. Loads an emitted client bundle in happy-dom with the real
// scrml runtime, clicks the button, and reports whether the handler threw.
//
//   bun docs/changes/nested-program-artifact-emission-2026-08-19/probes/exec-probe.mjs <outDir> <basename>
// (run from the repo root)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (!globalThis.document) GlobalRegistrator.register();

const outDir = process.argv[2];
const base = process.argv[3];

const files = readdirSync(outDir);
const runtimeFile = files.find((f) => f.startsWith("scrml-runtime"));
const html = readFileSync(join(outDir, `${base}.html`), "utf8");
const clientJs = readFileSync(join(outDir, `${base}.client.js`), "utf8");

const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
const bodyHtml = bodyMatch ? bodyMatch[1] : html;
document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

// Record every Worker construction attempt without needing a real worker.
const workerRequests = [];
globalThis.Worker = class FakeWorker {
  constructor(url) { workerRequests.push(String(url)); this.url = String(url); }
  postMessage() {}
  addEventListener() {}
  terminate() {}
};

const thrown = [];
let loadError = null;
try {
  // Runtime + client must share ONE scope: the runtime's `const` declarations are
  // eval-local, so two separate evals leave the client unable to see them.
  const runtimeJs = readFileSync(join(outDir, runtimeFile), "utf8");
  eval(`(function(){\n${runtimeJs}\n${clientJs}\n})();`);
} catch (err) {
  loadError = `${err.name}: ${err.message}`;
}

try {
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
} catch (err) {
  thrown.push(`DOMContentLoaded: ${err.name}: ${err.message}`);
}

const btn = document.querySelector("button");
let clickError = null;
if (btn) {
  const origError = console.error;
  console.error = (...args) => { thrown.push(args.map(String).join(" ")); };
  try {
    btn.click();
  } catch (err) {
    clickError = `${err.name}: ${err.message}`;
  }
  console.error = origError;
}

console.log("PROBE " + JSON.stringify({
  buttonFound: Boolean(btn),
  loadError,
  clickError,
  thrown,
  workerRequests,
  // Hash-safe. Under `contentHashAssets` the bundle is written as
  // `<base>.<name>.worker.<hash>.js`, so a bare `.endsWith(".worker.js")` finds
  // ZERO — the same predicate silently voided 20 of the 40 builds in
  // `build-matrix.mjs` before it was corrected there.
  workerFilesOnDisk: files.filter((f) => /\.worker(\.[a-z0-9]+)?\.js$/.test(f)),
}, null, 2));
process.exit(0);
