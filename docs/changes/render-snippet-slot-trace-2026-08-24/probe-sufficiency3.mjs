/**
 * S372 trace probe — sufficiency, CORRECTED.
 *
 * probe-sufficiency2.mjs had two harness faults:
 *   - row 3 asserted on "LBL", which also matches the `label="LBL"` ATTRIBUTE,
 *     so a dead render site read as a pass. Assert on the snippet's own markup
 *     (`<strong>`) instead.
 *   - it did not verify that the <match> trip actually forced the LIVE path.
 *     Verify by re-running sourceNeedsLiveFallback on the captured component raw.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-sufficiency3.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-suff3";
const D = "$";
let seq = 0;

/** Verbatim copy of component-expander.ts:1079. */
function sourceNeedsLiveFallback(source) {
  if (/\b(?:const|let|tilde|lin)\s+(?:fn|lin|server|pure)\s*[:=]/.test(source)) return true;
  if (/`[^`]*\$\{/.test(source)) return true;
  if (/<\s*(?:each|match)\b/.test(source)) return true;
  return false;
}

function compileSource(source) {
  const dir = resolve(ROOT, `s-${seq++}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "s.scrml");
  writeFileSync(input, source);
  mkdirSync(outDir, { recursive: true });
  let tab = null;
  const result = compileScrml({
    inputFiles: [input], write: true, outputDir: outDir,
    selfHostModules: { buildAST: (bs) => (tab = buildAST(bs, null)) },
  });
  const defs = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.kind === "component-def" && typeof n.raw === "string") defs.push(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "parent") continue;
      if (v && typeof v === "object") walk(v);
    }
  })(tab?.ast);
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(resolve(outDir, "s.client.js")) ? readFileSync(resolve(outDir, "s.client.js"), "utf8") : "",
    runtimeJs: existsSync(resolve(outDir, result.runtimeFilename ?? "x")) ? readFileSync(resolve(outDir, result.runtimeFilename), "utf8") : "",
    html: existsSync(resolve(outDir, "s.html")) ? readFileSync(resolve(outDir, "s.html"), "utf8") : "",
    livePath: defs.map((d) => `${d.name}:${sourceNeedsLiveFallback(d.raw) ? "LIVE" : "native"}`),
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

const TRIP = ["    <match @mode>", "      <is \"a\"></is>", "      <else></else>", "    </match>"];

function run(label, defLines, appLine, trip, assertFn) {
  const lines = ["<program>", "", "  <mode> = \"a\"", ""]
    .concat(defLines).concat(trip ? TRIP : [])
    .concat(["  </>", "", "  <div class=\"app\">" + appLine + "</div>", "", "</program>"]);
  const c = compileSource(lines.join("\n") + "\n");
  const r = mount(c);
  const dom = r.body.replace(/<script[\s\S]*?<\/script>/g, "");
  console.log(`  ${label}`);
  console.log(`     re-parse path : ${c.livePath.join(",")}   errors=${c.errors.length} ${c.errors.map((e) => e.code).join(",")}`);
  console.log(`     DOM           : ${squash(dom, 300)}`);
  console.log(`     >>> ${assertFn(dom) ? "RENDER SITE FILLED" : "RENDER SITE EMPTY"}`);
}

for (const trip of [false, true]) {
  console.log("=".repeat(78));
  console.log(trip ? "LIVE re-parse forced (proxy for the proposed translate-expr.js:296 fix)"
                   : "BASELINE — native re-parse (current behaviour)");
  console.log("=".repeat(78));

  run("row 1 — slot=\"body\"",
    ["  const Card = <div class=\"card\" props={ body: snippet }>",
     "    <div class=\"h\">" + D + "{render body()}</div>"],
    "<Card><em slot=\"body\">SLOTTED-EM</em></Card>", trip,
    (d) => /<div class="h"><em>SLOTTED-EM<\/em><\/div>/.test(d));

  run("row 2 — body={ <em>PROPVAL-EM</em> }",
    ["  const Card = <div class=\"card\" props={ body: snippet }>",
     "    <div class=\"h\">" + D + "{render body()}</div>"],
    "<Card body={ <em>PROPVAL-EM</em> }/>", trip,
    (d) => d.includes("PROPVAL-EM"));

  run("row 3 — parametric control={ (n) => <strong>${n}</strong> }",
    ["  const Row = <div class=\"row\" props={ label: string, control: snippet }>",
     "    <span class=\"c\">" + D + "{render control(label)}</span>"],
    "<Row label=\"LBL\" control={ (n) => <strong>" + D + "{n}</strong> }/>", trip,
    (d) => /<span class="c">[\s\S]*<strong>/.test(d));

  console.log("");
}
