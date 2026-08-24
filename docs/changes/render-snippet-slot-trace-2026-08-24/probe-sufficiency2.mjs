/**
 * S372 trace probe — sufficiency, rows 2 and 3, plus Q2 limb (i).
 *
 * Same natural experiment as probe-sufficiency.mjs (a `<match>` in the component
 * body forces the LIVE re-parse, which yields the node the proposed
 * translate-expr.js:296 fix would yield), applied to:
 *   row 2  — zero-arg snippet supplied as a prop VALUE  body={ <em>..</em> }
 *   row 3  — parametric snippet  control={ (n) => <strong>${n}</strong> }
 *   Q2 (i) — `if=(snippetProp is some)` with the slot SUPPLIED
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-sufficiency2.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-suff2";
const D = "$";
let seq = 0;

function compileSource(source) {
  const dir = resolve(ROOT, `s-${seq++}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "s.scrml");
  writeFileSync(input, source);
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, "s.client.js");
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  const htmlPath = resolve(outDir, "s.html");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
  };
}

const bodyOf = (h) => h.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");
const squash = (s, n = 260) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

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

// A <match> block placed in the component body; its ONLY job is to trip
// sourceNeedsLiveFallback so the body takes the LIVE re-parse.
const TRIP = [
  "    <match @mode>",
  "      <is \"a\"></is>",
  "      <else></else>",
  "    </match>",
];

function run(label, lines, want) {
  console.log("-".repeat(78));
  console.log(label);
  const c = compileSource(lines.join("\n") + "\n");
  console.log(`  errors=${c.errors.length} ${c.errors.map((e) => e.code).join(",")}`);
  const r = mount(c);
  console.log(`  DOM  : ${squash(r.body.replace(/<script[\s\S]*?<\/script>/g, ""), 300)}`);
  console.log(`  >>> ${want} present: ${r.body.includes(want) ? "YES" : "NO"}`);
}

const mk = (trip, bodyLines, appLine) =>
  [
    "<program>",
    "",
    "  <mode> = \"a\"",
    "",
  ]
    .concat(bodyLines.slice(0, 1))
    .concat(bodyLines.slice(1))
    .concat(trip ? TRIP : [])
    .concat(["  </>", "", "  <div class=\"app\">" + appLine + "</div>", "", "</program>"]);

for (const trip of [false, true]) {
  console.log("=".repeat(78));
  console.log(trip ? "LIVE re-parse forced (post-fix proxy)" : "BASELINE — native re-parse (current)");
  console.log("=".repeat(78));

  run(
    "row 2 — body={ <em>PROPVAL-EM</em> }",
    mk(trip,
      ["  const Card = <div class=\"card\" props={ body: snippet }>",
       "    <div class=\"h\">" + D + "{render body()}</div>"],
      "<Card body={ <em>PROPVAL-EM</em> }/>"),
    "PROPVAL-EM",
  );

  run(
    "row 3 — parametric control={ (n) => <strong>${n}</strong> }",
    mk(trip,
      ["  const Row = <div class=\"row\" props={ label: string, control: snippet }>",
       "    <span class=\"c\">" + D + "{render control(label)}</span>"],
      "<Row label=\"LBL\" control={ (n) => <strong>" + D + "{n}</strong> }/>"),
    "LBL",
  );

  run(
    "Q2 limb (i) — if=(actions is some) with slot=\"actions\" SUPPLIED",
    mk(trip,
      ["  const Card = <div class=\"card\" props={ actions?: snippet }>",
       "    <div class=\"a\" if=(actions is some)>" + D + "{render actions()}</div>"],
      "<Card><button slot=\"actions\">GO-BTN</button></Card>"),
    "GO-BTN",
  );
  console.log("");
}
