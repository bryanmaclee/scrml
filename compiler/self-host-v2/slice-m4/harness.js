// harness.js — slice M4 (s442): the four remaining SPEC §66.19 worked programs,
// compiled from SOURCE by the bootstrap front end and RUN.
//
// slice-m2 is the M2 proof (the lowered Core EQUALS M1's hand-built oracle for
// §66.19.1 / §66.19.3). The programs here have no hand-built oracle: each is
// graded by running it (print → the slice runtime in happy-dom) and by its
// negative lines. The front end is the M2 bundle (the same modules); this file
// only names the programs and the fixtures derived from them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2 } from "../slice-m2/harness.js";
import { frontEnd } from "../slice-m2/lowered.js";

export { loadM2, frontEnd };

const HERE = import.meta.dir;

/** A slice-m4 file, by path relative to slice-m4/ ("src/engine/after.scrml"). */
export function readM4(rel) {
  return readFileSync(join(HERE, rel), "utf8");
}

// Each program: its files in LINK ORDER (imports first, the `<program>` file
// last). `path` is the name the front end resolves imports by.
export const PROGRAMS = {
  engine: [{ path: "after.scrml", rel: "src/engine/after.scrml" }],
  audit: [{ path: "audit.scrml", rel: "src/audit/audit.scrml" }],
  form: [{ path: "signup.scrml", rel: "src/form/signup.scrml" }],
  theme: [
    { path: "lib/brand-theme.scrml", rel: "src/theme/lib/brand-theme.scrml" },
    { path: "app.scrml", rel: "src/theme/app.scrml" },
  ],
};

/** The program's files as `{ path, src }`, each optionally rewritten by `edit(path, src)`. */
export function programFiles(name, edit = (p, s) => s) {
  return PROGRAMS[name].map((f) => ({ path: f.path, src: edit(f.path, readM4(f.rel)) }));
}

/** Run the front end over `files`; throw (with every diagnostic) unless it is clean. */
export function compileClean(mods, files, label) {
  const r = frontEnd(mods, files);
  if (r.diags.length > 0) {
    throw new Error(`the bootstrap front end reported diagnostics for ${label}:\n` + r.diags.map((d) => `${d.code} ${d.file}@${d.span.start}: ${d.message}`).join("\n"));
  }
  return r;
}

/** The diagnostic codes the front end reports for `files`. */
export function codesOf(mods, files) {
  return frontEnd(mods, files).diags.map((d) => d.code);
}

/**
 * Replace the ONE line of `src` containing `marker` by `replacement` (keeping
 * its indentation). Used to uncomment a program's `→ E-…` negative lines.
 */
export function replaceLine(src, marker, replacement) {
  const lines = src.split("\n");
  const hits = lines.map((l, i) => (l.includes(marker) ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) throw new Error(`expected exactly one line containing ${JSON.stringify(marker)}, found ${hits.length}`);
  const i = hits[0];
  const indent = /^\s*/.exec(lines[i])[0];
  lines[i] = indent + replacement;
  return lines.join("\n");
}

/** Every line of `src` that states a diagnostic (`→ E-…`), in `//` or `<!-- -->` form. */
export function negativeLines(src) {
  return src.split("\n").filter((l) => /(\/\/|<!--).*→\s*E-[A-Z0-9-]+/.test(l));
}
