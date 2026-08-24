/**
 * S372 trace probe — Q2 limb (ii) severity + the limb (i) props-map value.
 *
 * (a) Does the bare-identifier `if=(strProp is some)` lowering KILL the rest of
 *     _scrml_boot (i.e. is it a whole-page defect, not a local one)?
 * (b) What value does the props map carry for a snippet prop bound via `slot=`?
 *     (the flagship lowered `actions is some` to `null !== null`.)
 *
 * Mounts the SHIPPED runtime chunk. No compiler source is modified.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-q2-severity.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-q2";
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
    warnings: (result.warnings ?? []),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

const bodyOf = (h) => h.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");
const squash = (s, n = 320) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

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
  return { threw, errs, body: document.body.innerHTML };
}

// ── (a) does the bare-ident if= kill the REST of boot? ────────────────────────
// `<Box>` has a broken if= FIRST; a SECOND, independent if= on a later element
// is the canary. If the canary never mounts, boot died.
console.log("=".repeat(78));
console.log("(a) blast radius of the bare-identifier prop `if=` lowering");
console.log("=".repeat(78));
{
  const src = [
    "<program>",
    "",
    "  <ok> = true",
    "",
    "  const Box = <div class=\"box\" props={ note?: string }>",
    "    <span class=\"broken\" if=(note is some)>BROKEN-BRANCH</span>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Box note=\"present\"/>",
    "    <p class=\"canary\" if=@ok>CANARY-MOUNTED</p>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n");
  const c = compileSource(src, "kill");
  console.log(`  compile errors=${c.errors.length}  warnings=${c.warnings.length}`);
  const r = mount(c);
  console.log(`  threw   : ${r.threw ? `${r.threw.constructor.name}: ${squash(r.threw.message, 80)}` : "no (swallowed by the DOMContentLoaded listener)"}`);
  console.log(`  console.error lines: ${r.errs.length}`);
  for (const e of r.errs.slice(0, 3)) console.log(`      ${squash(e, 160)}`);
  console.log(`  DOM     : ${squash(r.body, 320)}`);
  console.log(`  >>> CANARY MOUNTED: ${r.body.includes("CANARY-MOUNTED") ? "YES (local defect)" : "NO — WHOLE-PAGE BOOT KILL"}`);
}

// Control: same shape, prop OMITTED — should be clean.
console.log("");
{
  const src = [
    "<program>",
    "",
    "  <ok> = true",
    "",
    "  const Box = <div class=\"box\" props={ note?: string }>",
    "    <span class=\"broken\" if=(note is some)>BROKEN-BRANCH</span>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Box/>",
    "    <p class=\"canary\" if=@ok>CANARY-MOUNTED</p>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n");
  const c = compileSource(src, "killctl");
  const r = mount(c);
  console.log("  CONTROL (prop omitted):");
  console.log(`  >>> CANARY MOUNTED: ${r.body.includes("CANARY-MOUNTED") ? "YES" : "NO"}   console.error lines: ${r.errs.length}`);
}

// ── (b) what does the props map carry for a slot-bound snippet prop? ─────────
console.log("");
console.log("=".repeat(78));
console.log("(b) `if=(snippetProp is some)` when the slot IS supplied at the call site");
console.log("=".repeat(78));
{
  const src = [
    "<program>",
    "",
    "  const Card = <div class=\"card\" props={ actions?: snippet }>",
    "    <div class=\"card__actions\" if=(actions is some)>",
    "      " + D + "{render actions()}",
    "    </div>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Card>",
    "      <button slot=\"actions\">GO</button>",
    "    </Card>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n");
  const c = compileSource(src, "snipsome");
  console.log(`  compile errors=${c.errors.length}`);
  const cond = [...c.clientJs.matchAll(/if \(\(\(\((.*?)\)\)\)\)/g)].map((m) => m[1]);
  console.log(`  lowered if= conditions in client: ${JSON.stringify([...new Set(cond)])}`);
  const r = mount(c);
  console.log(`  DOM     : ${squash(r.body, 320)}`);
  console.log(`  >>> actions section mounted: ${r.body.includes("card__actions") && !r.body.includes("<template") ? "YES" : "NO — the slot IS supplied but `is some` sees null"}`);
}
