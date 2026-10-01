// harness.js — compile the slice-M1 bootstrap modules with impl#1 and load them.
//
// The bootstrap is written in scrml that impl#1 compiles today. Every module is
// a `${ export … }` library; `bundle.scrml` is the `<program>` entry that makes
// impl#1 lower them through its real emitter (progress.md F1/F11). Each emitted
// chunk registers its exports into `_scrml_modules["<name>.client.js"]` and
// destructures its imports from the same registry, so the chunks are evaluated
// in dependency order against one shared registry object.
//
// The pure bootstrap code references exactly one impl#1 runtime helper,
// `_scrml_structural_eq` (emitted for `==`), supplied here.

import { compileScrml } from "../../src/api.js";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const SELF_HOST_V2 = join(import.meta.dir, "..");

export const MODULES = [
  "core.scrml",
  "walk.scrml",
  "js.scrml",
  "html.scrml",
  "names.scrml",
  "print.scrml",
  "check.scrml",
  "measure.scrml",
  "slice-m1/counter.core.scrml",
  "slice-m1/dropdown.core.scrml",
  "slice-m1/valuesem.core.scrml",
];

function _scrml_structural_eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!_scrml_structural_eq(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => _scrml_structural_eq(a[k], b[k]));
}

function listClientJs(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) listClientJs(p, out);
    else if (name.name.endsWith(".client.js")) out.push(p);
  }
  return out;
}

const cache = new Map();

/**
 * Compile + load every module. Returns { mods, warnings } where `mods` maps a
 * module base name (e.g. "print") to its export object.
 */
export function loadBootstrap() {
  return loadBundle(join(SELF_HOST_V2, "slice-m1", "bundle.scrml"), MODULES);
}

/**
 * Compile a `<program>` bundle entry + `modules` (paths relative to
 * compiler/self-host-v2/) with impl#1 and load every emitted chunk (used by
 * slice-m1 and slice-m2). Cached per bundle.
 */
export function loadBundle(bundle, modules) {
  if (cache.has(bundle)) return cache.get(bundle);
  const outDir = mkdtempSync(join(tmpdir(), "self-host-v2-bundle-"));
  const inputFiles = [bundle, ...modules.map((m) => join(SELF_HOST_V2, m))].filter((f) => existsSync(f));
  const result = compileScrml({ inputFiles, outputDir: outDir, write: true, validateEmit: true, log: () => {} });
  const errs = (result.errors ?? []).filter((e) => e && e.code !== undefined);
  if (errs.length > 0) {
    throw new Error("bootstrap bundle failed to compile under impl#1:\n" + errs.map((e) => `${e.code} ${e.message ?? ""}`).join("\n"));
  }
  const chunks = listClientJs(outDir).map((file) => {
    const src = readFileSync(file, "utf8");
    const reg = /_scrml_modules\["([^"]+)"\]\s*=/.exec(src);
    const deps = [...src.matchAll(/=\s*_scrml_modules\["([^"]+)"\];/g)].map((m) => m[1]);
    return { file, src, name: reg ? reg[1] : null, deps };
  });
  const registry = {};
  const pending = chunks.filter((c) => c.name !== null);
  while (pending.length > 0) {
    const i = pending.findIndex((c) => c.deps.every((d) => d in registry));
    if (i === -1) throw new Error("cyclic or missing chunk dependency: " + pending.map((c) => c.name).join(", "));
    const [c] = pending.splice(i, 1);
    new Function("_scrml_modules", "_scrml_structural_eq", c.src)(registry, _scrml_structural_eq);
  }
  const mods = {};
  for (const [k, v] of Object.entries(registry)) mods[k.replace(/\.client\.js$/, "").replace(/^.*\//, "")] = v;
  const loaded = { mods, warnings: result.warnings ?? [] };
  cache.set(bundle, loaded);
  return loaded;
}
