/**
 * S372 probe 3, corrected detector — g-if-attr-per-field-synth-cell-crashes-boot.
 *
 * "no throw" is NOT the discriminator: happy-dom swallows exceptions thrown inside
 * a listener (the gap entry says so itself). The claim is that the TypeError lands
 * inside `_scrml_boot` and therefore "kills every ${…} interpolation on the page".
 * So the observable is: DID THE SIBLING INTERPOLATION WIRE?
 *
 * Control interp is `<p id="ctl">${@flag}</p>` with `<flag> = true` — it must render
 * "true" when boot completes, and stay empty when boot dies.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT = "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372p3";
let seq = 0;

function compileSource(source) {
  const dir = resolve(ROOT, `c${seq++}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "ifprobe.scrml");
  writeFileSync(input, source);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, "ifprobe.client.js");
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  const htmlPath = resolve(outDir, "ifprobe.html");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

function bodyOf(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}

function run(source) {
  const c = compileSource(source);
  document.body.innerHTML = bodyOf(c.html);

  // Capture anything the runtime reports, including swallowed listener errors.
  const seen = [];
  const origErr = console.error;
  console.error = (...a) => { seen.push(a.map(String).join(" ")); };
  globalThis.window.addEventListener("error", (e) => seen.push(`window.error: ${e.message ?? e}`));

  let threw = null;
  try {
    const exec = new Function("window", "document",
      `${c.runtimeJs}\n` + captureInsideChunkScope(c.clientJs, ""));
    exec(globalThis.window, globalThis.document);
  } catch (e) { threw = e; }

  // Fire boot the way the browser does, but call the listener DIRECTLY too so a
  // swallowed dispatch cannot hide the failure.
  let bootThrew = null;
  try {
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) { bootThrew = e; }

  console.error = origErr;
  const ctl = document.getElementById("ctl");
  return {
    errors: c.errors.length,
    loweredIf: (c.clientJs.match(/reactive_get\("[^"]*"\)(\.[A-Za-z_$][\w$]*)+/g) ?? []).slice(0, 3),
    flatKeys: (c.clientJs.match(/reactive_set\("signup\.[^"]*"/g) ?? []).slice(0, 4),
    threw: threw ? `${threw.constructor.name}: ${threw.message}` : null,
    bootThrew: bootThrew ? `${bootThrew.constructor.name}: ${bootThrew.message}` : null,
    consoleErrors: seen.slice(0, 3),
    control: ctl ? JSON.stringify(ctl.textContent) : "(#ctl missing)",
  };
}

const shapes = [
  ["@flag                  (plain Shape-1 cell)", "@flag"],
  ["@signup.name           (2-level compound field)", "@signup.name"],
  ["@signup.isValid        (compound-level synth)", "@signup.isValid"],
  ["@signup.name.touched   (PER-FIELD synth, 3-level)", "@signup.name.touched"],
  ["@signup.name.isValid   (PER-FIELD synth, 3-level)", "@signup.name.isValid"],
];

console.log("Control interp is <p id=\"ctl\">${@flag}</p> with <flag> = true.");
console.log("Boot completed  => control renders \"true\".   Boot died => control stays empty.\n");

for (const [label, cond] of shapes) {
  const source = [
    "<program>",
    "",
    "<flag> = true",
    "",
    "<signup>",
    '    <name req length(>=2)> = <input type="text"/>',
    "</>",
    "",
    `<span if=${cond}>GATED</span>`,
    '<p id="ctl">${@flag}</p>',
    "",
    "</program>",
    "",
  ].join("\n");
  const r = run(source);
  console.log(`── ${label}`);
  console.log(`     compile errors : ${r.errors}`);
  console.log(`     load threw     : ${r.threw ?? "no"}`);
  console.log(`     boot threw     : ${r.bootThrew ?? "no"}`);
  if (r.consoleErrors.length) console.log(`     console.error  : ${r.consoleErrors.join(" | ").slice(0, 200)}`);
  console.log(`     CONTROL #ctl   : ${r.control}      <-- the discriminator`);
  if (r.loweredIf.length) console.log(`     lowered if=    : ${r.loweredIf.join(", ")}`);
  if (r.flatKeys.length) console.log(`     flat keys exist: ${r.flatKeys.join(", ")}`);
  console.log("");
}
