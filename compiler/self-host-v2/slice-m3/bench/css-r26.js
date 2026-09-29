// css-r26.js — R26 triage for the stylesheet pass (s440-bootstrap-css-theme-t3): compile real sources
// with PURE impl#1 and with the CSS sub-seam swapped for the bootstrap, and print how the two
// stylesheets differ. Parity is NOT the grade (the css oracle is); every difference printed here is
// to be CLASSIFIED — bootstrap bug / impl#1 bug / spec-directed difference — in the change's notes.
//
//   bun compiler/self-host-v2/slice-m3/bench/css-r26.js <file.scrml> …

import { readFileSync } from "node:fs";
import { compileScrml } from "../../../src/api.js";
import * as sub from "../css-substitute.js";

function cssOf(file, stageOverrides) {
  const r = compileScrml({ inputFiles: [file], write: false, log: () => {}, ...(stageOverrides ? { stageOverrides } : {}) });
  const errs = (r.errors ?? []).filter((e) => e?.severity !== "warning" && e?.severity !== "info").map((e) => e.code);
  const out = [...(r.outputs?.values?.() ?? [])].find((o) => o.sourceFile === file) ?? [...(r.outputs?.values?.() ?? [])][0];
  return { css: out?.css ?? "", errs };
}

// Whitespace-insensitive statement units: whole-sheet whitespace collapsed, then split after each `}`
// and each top-level `;` statement, so line-wrapping / indentation (impl freedom) never shows up.
const lines = (s) =>
  s.replace(/\s+/g, " ").replace(/\{ /g, "{").replace(/ \}/g, "}")
    .split(/(?<=\})|(?<=;)(?=\s*@)|(?<=^[^{]*;)/)
    .map((l) => l.trim()).filter(Boolean);

for (const file of process.argv.slice(2)) {
  let a, b;
  try {
    a = cssOf(file, null);
  } catch (e) {
    console.log(`\n## ${file}\n  impl#1 THREW: ${String(e?.message ?? e).split("\n")[0]}`);
    continue;
  }
  if (a.errs.length > 0) {
    console.log(`\n## ${file}\n  impl#1 front end rejects it (${a.errs.join(", ")}) — not comparable`);
    continue;
  }
  try {
    b = cssOf(file, { CSS: sub });
  } catch (e) {
    const m = String(e?.message ?? e).split("\n")[0].replace(/^.*not-yet — /, "");
    console.log(`\n## ${file}\n  bootstrap NOT-YET: ${m.slice(0, 600)}`);
    continue;
  }
  const la = lines(a.css), lb = lines(b.css);
  const onlyA = la.filter((l) => !lb.includes(l));
  const onlyB = lb.filter((l) => !la.includes(l));
  if (onlyA.length === 0 && onlyB.length === 0) {
    console.log(`\n## ${file}\n  same lines (${la.length}; order ${la.join("\n") === lb.join("\n") ? "same" : "DIFFERS"})`);
    continue;
  }
  console.log(`\n## ${file}`);
  for (const l of onlyA) console.log(`  - impl#1:    ${l}`);
  for (const l of onlyB) console.log(`  + bootstrap: ${l}`);
}
await sub.closeCss();
