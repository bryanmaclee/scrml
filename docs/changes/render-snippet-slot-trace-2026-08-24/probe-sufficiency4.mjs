/**
 * S372 trace probe — row 3 with the SPEC-CORRECT declaration.
 *
 * probe-sufficiency3.mjs declared `control: snippet` (plain) and passed a lambda.
 * SPEC 16.6 requires the PARAMETRIC declaration `snippet(param: Type)` for the
 * lambda call-site form; component-expander.ts:2680 skips any prop whose
 * `snippetParamType === null`, so the plain declaration can never populate
 * `parametricSnippets`. Re-run with `snippet(n: string)`.
 *
 * Also re-checks whether the parametric path needs the bridge fix at all.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-sufficiency4.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-suff4";
const D = "$";
let seq = 0;

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
    warnings: (result.warnings ?? []),
    clientJs: existsSync(resolve(outDir, "s.client.js")) ? readFileSync(resolve(outDir, "s.client.js"), "utf8") : "",
    runtimeJs: result.runtimeFilename && existsSync(resolve(outDir, result.runtimeFilename)) ? readFileSync(resolve(outDir, result.runtimeFilename), "utf8") : "",
    html: existsSync(resolve(outDir, "s.html")) ? readFileSync(resolve(outDir, "s.html"), "utf8") : "",
    livePath: defs.map((d) => `${d.name}:${sourceNeedsLiveFallback(d.raw) ? "LIVE" : "native"}`),
  };
}

const bodyOf = (h) => h.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");
const squash = (s, n = 320) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

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

function run(label, defLines, appLine, trip) {
  const lines = ["<program>", "", "  <mode> = \"a\"", ""]
    .concat(defLines).concat(trip ? TRIP : [])
    .concat(["  </>", "", "  <div class=\"app\">" + appLine + "</div>", "", "</program>"]);
  const c = compileSource(lines.join("\n") + "\n");
  const r = mount(c);
  const dom = r.body.replace(/<script[\s\S]*?<\/script>/g, "");
  console.log(`  ${label}`);
  console.log(`     path=${c.livePath.join(",")} errors=${c.errors.length} ${c.errors.map((e) => e.code).join(",")} | threw=${r.threw ? r.threw.constructor.name + ": " + String(r.threw.message).slice(0, 60) : "no"}`);
  console.log(`     DOM: ${squash(dom, 320)}`);
  console.log(`     >>> <strong> inside span.c : ${/<span class="c">[\s\S]*?<strong>/.test(dom) ? "FILLED" : "EMPTY"}`);
}

for (const trip of [false, true]) {
  console.log("=".repeat(78));
  console.log(trip ? "LIVE re-parse forced (proxy for the translate-expr.js:296 fix)"
                   : "BASELINE — native re-parse (current)");
  console.log("=".repeat(78));
  run("row 3 SPEC-correct — control: snippet(n: string) + control={ (n) => <strong>${n}</strong> }",
    ["  const Row = <div class=\"row\" props={ label: string, control: snippet(n: string) }>",
     "    <span class=\"c\">" + D + "{render control(label)}</span>"],
    "<Row label=\"LBL\" control={ (n) => <strong>" + D + "{n}</strong> }/>", trip);
  console.log("");
}
