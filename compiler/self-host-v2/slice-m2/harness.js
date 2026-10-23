// harness.js — compile + load the slice-M2 bootstrap (the M1 modules plus the
// front end: lex → parse → analyze → lower) with impl#1, and read the §66.19
// sources the front end compiles.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBundle, MODULES, SELF_HOST_V2 } from "../slice-m1/harness.js";

export const M2_MODULES = [
  ...MODULES,
  "lex.scrml",
  "severity.scrml",
  "ast.scrml",
  "css-syntax.scrml",
  "sql.scrml",
  "parse.scrml",
  "link.scrml",
  "effects.scrml",
  "analyze.scrml",
  "lower.scrml",
];

export function loadM2() {
  return loadBundle(join(SELF_HOST_V2, "slice-m2", "bundle.scrml"), M2_MODULES);
}

export const SRC = join(import.meta.dir, "src");

/** The source of a slice-M2 input file (relative to slice-m2/src/). */
export function source(rel) {
  return readFileSync(join(SRC, rel), "utf8");
}

/**
 * s469 — `src` with the dpa-073 terminators written in: a `;` at every
 * E-STMT-MISSING-SEMICOLON and a `,` at every E-MATCH-ARM-SEPARATOR the
 * bootstrap parser reports (each report's span is the empty span where the
 * terminator goes), to a fixed point. The SPEC §66.19 worked programs are still
 * written newline-terminated (the SPEC's own migration is owed — dpa-073 F5
 * step 3); the slice sources are those programs WITH their terminators, so the
 * drift guards compare `terminated(block)` with the source. Only those two
 * codes are acted on; any other diagnostic is left for the guard to see.
 */
export function terminated(mods, src) {
  let s = src;
  for (let pass = 0; pass < 50; pass++) {
    const ins = mods.parse.parseFile("guard.scrml", s, 0).diags
      .filter((d) => (d.code === "E-STMT-MISSING-SEMICOLON" || d.code === "E-MATCH-ARM-SEPARATOR") && d.span.start === d.span.end)
      .map((d) => [d.span.start, d.code === "E-STMT-MISSING-SEMICOLON" ? ";" : ","])
      .sort((a, b) => b[0] - a[0]);
    if (ins.length === 0) return s;
    for (const [at, ch] of ins) s = s.slice(0, at) + ch + s.slice(at);
  }
  return s;
}
