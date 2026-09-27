// lowered.js — run the bootstrap front end (lex → parse → analyze → lower, all
// scrml compiled by impl#1) over source files, and the LOWERED Cores of the
// slice programs — the same programs M1 built by hand (slice-m1/*.core.scrml).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;

/** A slice source, by path relative to slice-m2/ ("src/app.scrml", "fixtures/…"). */
export function readSlice(rel) {
  return readFileSync(join(HERE, rel), "utf8");
}

/**
 * Compile a linked program: `files` = [{ path, src }] in LINK ORDER (imports
 * first, the `<program>` file last). Returns every phase's output and timing.
 */
export function frontEnd(mods, files) {
  const t0 = performance.now();
  let next = 0;
  const asts = [];
  let parseDiags = [];
  for (const f of files) {
    const r = mods.parse.parseFile(f.path, f.src, next);
    next = r.nextId;
    asts.push(r.ast);
    parseDiags = parseDiags.concat(r.diags);
  }
  const t1 = performance.now();
  const tp = mods.analyze.analyze(asts, files[files.length - 1].path);
  const t2 = performance.now();
  const lowered = mods.lower.lower(tp);
  const t3 = performance.now();
  return {
    asts,
    typed: tp,
    core: lowered.core,
    diags: parseDiags.concat(tp.diags),
    nodes: next,
    ms: { parse: t1 - t0, analyze: t2 - t1, lower: t3 - t2, total: t3 - t0 },
  };
}

// The slice programs, as sources. `lib` is the §66.19.3 library.
const LIB = { path: "lib/dropdown.scrml", rel: "src/lib/dropdown.scrml" };
export const PROGRAMS = {
  counter: [{ path: "counter.scrml", rel: "src/counter.scrml" }],
  dropdown: [LIB, { path: "app.scrml", rel: "src/app.scrml" }],
  dropdownReorder: [LIB, { path: "app-reorder.scrml", rel: "fixtures/app-reorder.scrml" }],
  dropdownEarlyRead: [LIB, { path: "app-early.scrml", rel: "fixtures/app-early.scrml" }],
  valuesem: [{ path: "valuesem.scrml", rel: "fixtures/valuesem.scrml" }],
};

export function compileProgram(mods, name) {
  const files = PROGRAMS[name].map((f) => ({ path: f.path, src: readSlice(f.rel) }));
  const r = frontEnd(mods, files);
  if (r.diags.length > 0) {
    throw new Error(`the bootstrap front end reported diagnostics for ${name}:\n` + r.diags.map((d) => `${d.code} ${d.file}@${d.span.start}: ${d.message}`).join("\n"));
  }
  return r;
}

/** The lowered Cores, with the same names as the hand-built providers. */
export function loweredCores(mods) {
  return {
    counter: () => compileProgram(mods, "counter").core,
    dropdown: () => compileProgram(mods, "dropdown").core,
    dropdownReorder: () => compileProgram(mods, "dropdownReorder").core,
    dropdownEarlyRead: () => compileProgram(mods, "dropdownEarlyRead").core,
    valuesem: () => compileProgram(mods, "valuesem").core,
  };
}
