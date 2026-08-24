/**
 * S372 trace probe — is the EXISTING diagnostic net defeated by the same blanking?
 *
 * `codegen/rewrite.ts:2478 rewriteRenderKeyword` emits E-TYPE-071 when the TEXT
 * `render name(` survives to the rewrite phase. Inside a component body the native
 * bridge blanks the expression to raw:"", so the text never reaches rewrite and the
 * net cannot fire. Outside a component body the LIVE parser runs, the text survives,
 * and the net SHOULD fire. Measure both.
 *
 * Also measures which of §16.8.1's four SHALL-reject codes fire on their own shapes.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-diagnostic-net.mjs
 */
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-diag";
const D = "$";
let seq = 0;

function compile(label, lines) {
  const name = "d" + seq++;
  const dir = resolve(ROOT, name);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, name + ".scrml");
  writeFileSync(input, lines.join("\n") + "\n");
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "out") });
  const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
  const codes = [...new Set(all.map((e) => `${e.code ?? "?"}/${e.severity ?? "error"}`))];
  console.log(`  ${label.padEnd(58)} -> ${codes.join(", ") || "(NO DIAGNOSTICS)"}`);
}

console.log("=".repeat(88));
console.log("Is the E-TYPE-071 net defeated INSIDE a component body but live OUTSIDE it?");
console.log("=".repeat(88));

compile("render OUTSIDE any component body (SPEC: E-TYPE-071 SHALL)", [
  "<program>",
  "",
  "<div class=\"x\">" + D + "{render header()}</div>",
  "",
  "</program>",
]);

compile("render INSIDE a component body, prop DECLARED (SPEC: valid)", [
  "<program>",
  "",
  "  const Card = <div class=\"card\" props={ header: snippet }>",
  "    <div class=\"h\">" + D + "{render header()}</div>",
  "  </>",
  "",
  "  <div class=\"app\"><Card><em slot=\"header\">H</em></Card></div>",
  "",
  "</program>",
]);

console.log("");
console.log("=".repeat(88));
console.log("Which of the four SHALL-reject codes of SPEC 16.8.1 actually fire?");
console.log("=".repeat(88));

compile("(1) E-COMPONENT-023: render NAME not a declared snippet prop", [
  "<program>",
  "",
  "  const Card = <div class=\"card\" props={ header: snippet }>",
  "    <div class=\"h\">" + D + "{render nosuch()}</div>",
  "  </>",
  "",
  "  <div class=\"app\"><Card><em slot=\"header\">H</em></Card></div>",
  "",
  "</program>",
]);

compile("(3a) E-TYPE-072: zero-arg render on a PARAMETRIC snippet", [
  "<program>",
  "",
  "  const Row = <div class=\"row\" props={ control: snippet(n: string) }>",
  "    <span>" + D + "{render control()}</span>",
  "  </>",
  "",
  "  <div class=\"app\"><Row control={ (n) => <b>" + D + "{n}</b> }/></div>",
  "",
  "</program>",
]);

compile("(3b) E-TYPE-072: one-arg render on a ZERO-PARAM snippet", [
  "<program>",
  "",
  "  <lbl> = \"L\"",
  "",
  "  const Row = <div class=\"row\" props={ control: snippet }>",
  "    <span>" + D + "{render control(@lbl)}</span>",
  "  </>",
  "",
  "  <div class=\"app\"><Row><b slot=\"control\">C</b></Row></div>",
  "",
  "</program>",
]);

compile("(16.8.2-2) E-TYPE-073: unguarded render on an OPTIONAL snippet", [
  "<program>",
  "",
  "  const Card = <div class=\"card\" props={ extra?: snippet }>",
  "    <div class=\"e\">" + D + "{render extra()}</div>",
  "  </>",
  "",
  "  <div class=\"app\"><Card/></div>",
  "",
  "</program>",
]);
