/**
 * S372 verify-before-dispatch probe — reproduce the three S371 HIGHs on current HEAD.
 *
 * ⚑ METHOD (the S371 correction): every mount loads the SHIPPED runtime CHUNK
 * (`result.runtimeFilename`), never `runtime-template.js`. A harness that evals the
 * full template defines everything the pruned chunk omits and masks the whole class.
 *
 * Run: bun scratchpad-s372-probe.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT = "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372";
let seq = 0;

function compileSource(source, baseName) {
  const dir = resolve(ROOT, `${baseName}-${seq++}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  return compileFile(input, outDir, baseName);
}

function compileFile(inputPath, outDir, baseName) {
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [inputPath], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  const htmlPath = resolve(outDir, `${baseName}.html`);
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    runtimeFilename: result.runtimeFilename,
    outDir,
  };
}

/** Mount exactly the way the emitted HTML does: shipped runtime chunk, then the client. */
function mount(compiled, bodyHtml) {
  document.body.innerHTML = bodyHtml ?? "";
  let threw = null;
  try {
    const exec = new Function(
      "window",
      "document",
      `${compiled.runtimeJs}\n` + captureInsideChunkScope(compiled.clientJs, ""),
    );
    exec(globalThis.window, globalThis.document);
    // fire boot the way the browser does
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    threw = e;
  }
  return { threw, body: document.body.innerHTML };
}

function head(s, n = 420) {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

console.log("=".repeat(78));
console.log("PROBE 1 — g-each-lift-path-client-calls-reconcile-list-absent-from-shipped-runtime");
console.log("=".repeat(78));
{
  const src = resolve("conformance/cases/each/ternary-markup-giti033/case.scrml");
  const c = compileFile(src, resolve(ROOT, "p1/out"), "case");
  const calls = (c.clientJs.match(/_scrml_reconcile_list\s*\(/g) ?? []).length;
  const defs = (c.runtimeJs.match(/function\s+_scrml_reconcile_list/g) ?? []).length;
  console.log(`  errors: ${c.errors.length}`);
  console.log(`  client CALLS _scrml_reconcile_list: ${calls}`);
  console.log(`  shipped chunk (${c.runtimeFilename}) DEFINES it: ${defs}`);
  const r = mount(c);
  console.log(`  mount threw: ${r.threw ? `${r.threw.constructor.name}: ${r.threw.message}` : "no"}`);
  console.log(`  body: ${head(r.body, 200)}`);
  console.log(`  VERDICT: ${calls > 0 && defs === 0 ? "REPRODUCES" : "does NOT reproduce"}`);
}

console.log("");
console.log("=".repeat(78));
console.log("PROBE 2 — g-render-snippet-slot-renders-empty (flagship example)");
console.log("=".repeat(78));
{
  const src = resolve("examples/12-snippets-slots.scrml");
  const c = compileFile(src, resolve(ROOT, "p2/out"), "12-snippets-slots");
  console.log(`  errors: ${c.errors.length}`);
  const cards = [...(c.html.matchAll(/<div class="card__(header|body)"[^>]*>([\s\S]{0,160}?)<\/div>/g))];
  console.log(`  card__header / card__body sites in emitted HTML: ${cards.length}`);
  for (const m of cards.slice(0, 6)) console.log(`    card__${m[1]}: ${JSON.stringify(head(m[2], 90))}`);
  const r = mount(c, c.html.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, ""));
  console.log(`  mount threw: ${r.threw ? `${r.threw.constructor.name}: ${r.threw.message}` : "no"}`);
  const after = [...(r.body.matchAll(/<div class="card__(header|body)"[^>]*>([\s\S]{0,160}?)<\/div>/g))];
  for (const m of after.slice(0, 6)) console.log(`    AFTER card__${m[1]}: ${JSON.stringify(head(m[2], 90))}`);
  const anyEmpty = after.some((m) => head(m[2]).replace(/<span data-scrml-logic="[^"]*"><\/span>/g, "").trim() === "");
  console.log(`  VERDICT: ${anyEmpty || after.length === 0 ? "REPRODUCES (render sites empty)" : "does NOT reproduce"}`);
}

console.log("");
console.log("=".repeat(78));
console.log("PROBE 3 — g-if-attr-per-field-synth-cell-crashes-boot (4-way discriminator)");
console.log("=".repeat(78));
{
  const shapes = {
    "@flag (plain cell)": "@flag",
    "@signup.name (2-level field)": "@signup.name",
    "@signup.isValid (compound-level synth)": "@signup.isValid",
    "@signup.name.touched (PER-FIELD synth, 3-level)": "@signup.name.touched",
  };
  for (const [label, cond] of Object.entries(shapes)) {
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
      "<p>${@flag}</p>",
      "",
      "</program>",
      "",
    ].join("\n");
    const c = compileSource(source, "ifprobe");
    const r = mount(c, "<main id=\"root\"></main>");
    const status = r.threw ? `THREW ${r.threw.constructor.name}: ${head(r.threw.message, 120)}` : "ok";
    console.log(`  ${label.padEnd(48)} errors=${c.errors.length}  ${status}`);
  }
}

console.log("");
console.log("done.");
