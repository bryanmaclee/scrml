// lowered.js — run the bootstrap front end (lex → parse → analyze → lower, all
// scrml compiled by impl#1) over source files, and the LOWERED Cores of the
// slice programs — the same programs M1 built by hand (slice-m1/*.core.scrml).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;

/** A slice source, by path relative to slice-m2/ ("src/app.scrml", "fixtures/…"). */
export function readSlice(rel) {
  return readFileSync(join(HERE, rel), "utf8");
}

/**
 * A path the compiler may be handed: project-relative, `/`-separated. An
 * absolute path (or a `\`) would carry the build host's directory layout into
 * diagnostics — SPEC §58.1, no build-host identity in the output.
 */
export function assertProjectRelative(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\")) {
    throw new Error(`the bootstrap front end takes project-relative "/"-separated paths, got ${JSON.stringify(path)}`);
  }
}

/**
 * Compile a linked program. `files` = [{ path, src }] as a SET — any order:
 * link.scrml `parseProgram` puts them in the canonical order (path order, then
 * link order) so the result is a function of the set and `entry` alone
 * (s452-boot-determinism, SPEC §58.1/§58.12). `entry` is the path of the
 * `<program>` file; omitted, it is the LAST file listed (the legacy link-order
 * convention — the one input here that reads the list's order, and an explicit
 * one). Returns every phase's output and timing.
 */
export function frontEnd(mods, files, entry = files[files.length - 1].path) {
  for (const f of files) assertProjectRelative(f.path);
  const t0 = performance.now();
  const linked = mods.link.parseProgram(files.map((f) => ({ path: f.path, src: f.src })), entry);
  const asts = linked.files;
  const parseDiags = linked.diags;
  const next = linked.nextId;
  const t1 = performance.now();
  const tp = mods.analyze.analyze(asts, entry);
  const t2 = performance.now();
  const lowered = mods.lower.lower(tp);
  const t3 = performance.now();
  return {
    asts,
    typed: tp,
    core: lowered.core,
    // the parse phase's diagnostics, apart (the conformance probe buckets on them)
    parseDiags,
    diags: parseDiags.concat(tp.diags),
    // s449: the non-fatal I- notes (§55.17.6: I-FORM-SUBMIT-GATED "reports in the warnings stream")
    infos: tp.infos,
    nodes: next,
    ms: { parse: t1 - t0, analyze: t2 - t1, lower: t3 - t2, total: t3 - t0 },
  };
}

/**
 * A project on disk as the front end's input: every `.scrml` file under
 * `root`, each named by its path RELATIVE to `root` ("/"-separated). The list is
 * in whatever order the filesystem enumerates — deliberately unsorted: the
 * front end canonicalizes (link.scrml), so neither enumeration order nor where
 * `root` sits on disk (nor the working directory) reaches the compile.
 */
export function projectSources(root, dir = "") {
  const out = [];
  for (const e of readdirSync(dir === "" ? root : join(root, dir), { withFileTypes: true })) {
    const rel = dir === "" ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...projectSources(root, rel));
    else if (e.name.endsWith(".scrml")) out.push({ path: rel, src: readFileSync(join(root, rel), "utf8") });
  }
  return out;
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
