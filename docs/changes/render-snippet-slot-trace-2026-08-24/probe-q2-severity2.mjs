/**
 * S372 trace probe — CORRECTED canary measurement.
 *
 * The first pass matched "CANARY-MOUNTED" inside the unmounted <template>, which
 * reads as a pass when it is a fail. Query the LIVE DOM instead: an if= section
 * that mounted is a real element in document.body OUTSIDE any <template>.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-q2-severity2.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-q2b";
let seq = 0;

function compileSource(source, baseName) {
  const dir = resolve(ROOT, `${baseName}-${seq++}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  const htmlPath = resolve(outDir, `${baseName}.html`);
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

const bodyOf = (h) => h.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");

function mount(c) {
  document.body.innerHTML = bodyOf(c.html);
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.map(String).join(" "));
  let threw = null;
  try {
    const exec = new Function(
      "window", "document",
      `${c.runtimeJs}\n` + captureInsideChunkScope(c.clientJs, ""),
    );
    exec(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) { threw = e; }
  console.error = origErr;
  return { threw, errs };
}

/** LIVE-DOM check: element matching `sel` present and NOT inside a <template>. */
function liveMounted(sel) {
  const els = [...document.querySelectorAll(sel)];
  return els.some((el) => {
    let p = el.parentNode;
    while (p) {
      if (p.nodeName && String(p.nodeName).toLowerCase() === "template") return false;
      p = p.parentNode;
    }
    return true;
  });
}

const CASE = (boxAttr) =>
  [
    "<program>",
    "",
    "  <ok> = true",
    "",
    "  const Box = <div class=\"box\" props={ note?: string }>",
    "    <span class=\"broken\" if=(note is some)>BROKEN-BRANCH</span>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Box " + boxAttr + "/>",
    "    <p class=\"canary\" if=@ok>CANARY-MOUNTED</p>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n");

console.log("=".repeat(78));
console.log("Q2 limb (ii) — blast radius, measured on the LIVE DOM (template-excluded)");
console.log("=".repeat(78));

for (const [label, attr] of [
  ["prop SUPPLIED  <Box note=\"present\"/>", "note=\"present\""],
  ["CONTROL: prop OMITTED  <Box/>", ""],
]) {
  const c = compileSource(CASE(attr), "k");
  const r = mount(c);
  console.log(`\n  ${label}`);
  console.log(`    compile errors     : ${c.errors.length}`);
  console.log(`    runtime errors     : ${r.errs.length ? r.errs.map((e) => e.slice(0, 70)).join(" | ") : "(none)"}`);
  console.log(`    canary LIVE-mounted: ${liveMounted("p.canary") ? "YES" : "NO"}`);
  console.log(`    verdict            : ${liveMounted("p.canary") ? "boot survived" : "WHOLE-PAGE BOOT KILL — every later if= / handler wiring in _scrml_boot is skipped"}`);
}
