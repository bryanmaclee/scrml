// empirical.js — s446 (U0) evidence: compile two real `when` programs from §66 SOURCE through the
// bootstrap front end (parse → analyze → lower → Core), check the Core, print it, and RUN it in
// happy-dom against the slice runtime, clicking through the scenario. Output is pasted in progress.md.
//
//   bun docs/changes/s446-bootstrap-u0-when-effects/empirical.js

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2 } from "../../../compiler/self-host-v2/slice-m2/harness.js";
import { frontEnd } from "../../../compiler/self-host-v2/slice-m2/lowered.js";
import { loadProgram, click } from "../../../compiler/self-host-v2/slice-m1/load-program.js";

const { mods } = loadM2();
const $ = (s) => document.querySelector(s);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

async function program(file, steps) {
  const src = readFileSync(join(import.meta.dir, file), "utf8");
  const r = frontEnd(mods, [{ path: file, src }]);
  console.log(`\n=== ${file}`);
  console.log(`diagnostics: ${JSON.stringify(r.diags.map((d) => d.code))}`);
  console.log(`checkCore:   ${JSON.stringify(mods.check.checkCore(r.core))}`);
  const { rt, out } = await loadProgram(r.core, file.replace(/\W/g, "-"));
  console.log("emitted (the when registration):");
  const js = out.js.split("\n");
  const i = js.findIndex((l) => l.includes("rt.when("));
  console.log(js.slice(i, i + 4).map((l) => "    " + l).join("\n"));
  const show = (what) => console.log(`  ${what.padEnd(34)} p.out = "${$("p.out").textContent}"  live whens = ${rt.stats.whens}`);
  show("mounted");
  for (const [label, note] of steps) {
    click(btn(label));
    show(`click ${label}${note ? " (" + note + ")" : ""}`);
  }
}

await program("derived.scrml", [
  ["price", "price 11 → @total 22 read in the body"],
  ["qty", "@qty is unlisted: no run"],
  ["price", "price 12, qty 3 → 36"],
]);
await program("scoped.scrml", [
  ["inc", "fires while mounted"],
  ["toggle", "destroy the if= scope"],
  ["inc", "stopped firing"],
  ["inc", "stopped firing"],
  ["toggle", "remount"],
  ["inc", "ONE run per change"],
]);
