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
  "sql.scrml",
  "parse.scrml",
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
