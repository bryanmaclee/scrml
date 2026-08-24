/**
 * S372 trace probe — discriminating matrix for g-render-snippet-slot-renders-empty.
 *
 * Mounts the SHIPPED runtime chunk (result.runtimeFilename), never runtime-template.js.
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-matrix.mjs
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { captureInsideChunkScope } from "../../../compiler/tests/helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-matrix";
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
    warnings: result.warnings ?? [],
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    runtimeFilename: result.runtimeFilename,
    outDir,
  };
}

function bodyOf(html) {
  return html.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");
}

function mount(compiled) {
  document.body.innerHTML = bodyOf(compiled.html);
  let threw = null;
  try {
    const exec = new Function(
      "window",
      "document",
      `${compiled.runtimeJs}\n` + captureInsideChunkScope(compiled.clientJs, ""),
    );
    exec(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    threw = e;
  }
  return { threw, body: document.body.innerHTML };
}

const squash = (s, n = 300) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function run(label, source, name) {
  console.log("-".repeat(78));
  console.log(label);
  const c = compileSource(source, name);
  console.log(
    `  errors=${c.errors.length} ${c.errors.map((e) => e.code ?? String(e.message).slice(0, 40)).join(",")}`,
  );
  console.log(`  HTML  : ${squash(bodyOf(c.html).replace(/<script[\s\S]*?<\/script>/g, ""), 340)}`);
  const r = mount(c);
  console.log(
    `  threw : ${r.threw ? `${r.threw.constructor.name}: ${squash(r.threw.message, 90)}` : "no"}`,
  );
  console.log(`  DOM   : ${squash(r.body, 340)}`);
  return c;
}

const NL = "\n";

// Build sources without heredoc-hostile characters by joining lines.
const src = (lines) => lines.join(NL) + NL;
const D = "$"; // interpolation sigil, kept out of JS template literals

// Q2 DISCRIMINATOR
console.log("=".repeat(78));
console.log("Q2 - is the `null !== null` if= lowering an INDEPENDENT prop-resolution defect?");
console.log("=".repeat(78));

run(
  "A1  component, plain prop, if=(prop is some), prop SUPPLIED - NO snippet anywhere",
  src([
    "<program>",
    "",
    "  const Box = <div class=\"box\" props={ tag: string, note?: string }>",
    "    <span class=\"t\">" + D + "{tag}</span>",
    "    <span class=\"n\" if=(note is some)>" + D + "{note}</span>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Box tag=\"hello\" note=\"present\"/>",
    "  </div>",
    "",
    "</program>",
  ]),
  "a1",
);

run(
  "A2  same, optional prop OMITTED - expect the if= to be false",
  src([
    "<program>",
    "",
    "  const Box = <div class=\"box\" props={ tag: string, note?: string }>",
    "    <span class=\"t\">" + D + "{tag}</span>",
    "    <span class=\"n\" if=(note is some)>" + D + "{note}</span>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Box tag=\"hello\"/>",
    "  </div>",
    "",
    "</program>",
  ]),
  "a2",
);

// Q3 SHARED ROOT
console.log("");
console.log("=".repeat(78));
console.log("Q3 - the three call-site shapes");
console.log("=".repeat(78));

run(
  "B1  zero-arg snippet via canonical slot= (SPEC 14.9)",
  src([
    "<program>",
    "",
    "  const Card = <div class=\"card\" props={ body: snippet }>",
    "    <div class=\"card__body\">" + D + "{render body()}</div>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Card>",
    "      <em slot=\"body\">SLOTTED-EM</em>",
    "    </Card>",
    "  </div>",
    "",
    "</program>",
  ]),
  "b1",
);

run(
  "B2  zero-arg snippet via prop-value markup  body={ <em>..</em> }",
  src([
    "<program>",
    "",
    "  const Card = <div class=\"card\" props={ body: snippet }>",
    "    <div class=\"card__body\">" + D + "{render body()}</div>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Card body={ <em>PROPVAL-EM</em> }/>",
    "  </div>",
    "",
    "</program>",
  ]),
  "b2",
);

run(
  "B3  parametric snippet  control={ (n) => <strong>..</strong> } (SPEC 16.6)",
  src([
    "<program>",
    "",
    "  <label> = \"LBL\"",
    "",
    "  const Row = <div class=\"row\" props={ label: string, control: snippet }>",
    "    <span class=\"l\">" + D + "{label}</span>",
    "    <span class=\"c\">" + D + "{render control(label)}</span>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Row label=@label control={ (n) => <strong>" + D + "{n}</strong> }/>",
    "  </div>",
    "",
    "</program>",
  ]),
  "b3",
);

run(
  "C1  CONTROL - ${children} unslotted spread (expected working)",
  src([
    "<program>",
    "",
    "  const Card = <div class=\"card\">",
    "    <div class=\"card__body\">" + D + "{children}</div>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Card><em>UNSLOTTED-EM</em></Card>",
    "  </div>",
    "",
    "</program>",
  ]),
  "c1",
);

console.log("");
console.log("done.");
