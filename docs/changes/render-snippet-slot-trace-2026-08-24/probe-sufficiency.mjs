/**
 * S372 trace probe — SUFFICIENCY of the proposed fix, by natural experiment.
 *
 * `sourceNeedsLiveFallback` (component-expander.ts:1079) routes a component body
 * to the LIVE BS+TAB re-parse when the body contains `<each>` / `<match>`, a
 * template-literal interpolation, or a `const fn:` binding. The LIVE parser
 * produces exactly the node the proposed translate-expr.js:296 fix would produce
 * (`call` / callee `__scrml_render_NAME__`). So: put a fallback trigger in the
 * component body and the rest of the pipeline runs AS IF the fix were in.
 *
 * If the render slot fills under the fallback, the bridge is the WHOLE fix.
 * If it still does not fill, there is a SECOND hole downstream and the trace
 * must say so.
 *
 * Mounts the SHIPPED runtime chunk. No compiler source is modified.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-sufficiency.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-suff";
const D = "$";
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
const squash = (s, n = 300) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function mount(c) {
  document.body.innerHTML = bodyOf(c.html);
  let threw = null;
  try {
    const exec = new Function("window", "document",
      `${c.runtimeJs}\n` + captureInsideChunkScope(c.clientJs, ""));
    exec(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) { threw = e; }
  return { threw, body: document.body.innerHTML };
}

function run(label, lines) {
  console.log("-".repeat(78));
  console.log(label);
  const c = compileSource(lines.join("\n") + "\n", "s");
  console.log(`  errors=${c.errors.length} ${c.errors.map((e) => e.code).join(",")}`);
  console.log(`  HTML : ${squash(bodyOf(c.html).replace(/<script[\s\S]*?<\/script>/g, ""), 300)}`);
  const r = mount(c);
  console.log(`  DOM  : ${squash(r.body.replace(/<script[\s\S]*?<\/script>/g, ""), 300)}`);
  const filled = r.body.includes("SLOTTED-EM");
  const emptyPlaceholder = /<div class="h"><span data-scrml-logic="[^"]*"><\/span>/.test(r.body);
  console.log(`  >>> slot content present: ${filled ? "YES" : "NO"} | empty placeholder at render site: ${emptyPlaceholder ? "YES" : "no"}`);
}

console.log("=".repeat(78));
console.log("BASELINE — native re-parse path (current behaviour)");
console.log("=".repeat(78));
run("no fallback trigger in the component body", [
  "<program>",
  "",
  "  const Card = <div class=\"card\" props={ body: snippet }>",
  "    <div class=\"h\">" + D + "{render body()}</div>",
  "  </>",
  "",
  "  <div class=\"app\"><Card><em slot=\"body\">SLOTTED-EM</em></Card></div>",
  "",
  "</program>",
]);

console.log("");
console.log("=".repeat(78));
console.log("NATURAL EXPERIMENT — same file + an <each> in the body forces the LIVE re-parse,");
console.log("which yields exactly the node the proposed translate-expr.js:296 fix would yield.");
console.log("=".repeat(78));
run("fallback trigger: <each> in the component body", [
  "<program>",
  "",
  "  <ns> = [1]",
  "",
  "  const Card = <div class=\"card\" props={ body: snippet }>",
  "    <div class=\"h\">" + D + "{render body()}</div>",
  "    <each n of @ns><i>" + D + "{n}</i></each>",
  "  </>",
  "",
  "  <div class=\"app\"><Card><em slot=\"body\">SLOTTED-EM</em></Card></div>",
  "",
  "</program>",
]);

run("fallback trigger: <match> in the component body", [
  "<program>",
  "",
  "  <mode> = \"a\"",
  "",
  "  const Card = <div class=\"card\" props={ body: snippet }>",
  "    <div class=\"h\">" + D + "{render body()}</div>",
  "    <match @mode>",
  "      <is \"a\"><i>A</i></is>",
  "      <else><i>B</i></else>",
  "    </match>",
  "  </>",
  "",
  "  <div class=\"app\"><Card><em slot=\"body\">SLOTTED-EM</em></Card></div>",
  "",
  "</program>",
]);
