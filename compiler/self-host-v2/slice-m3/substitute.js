// substitute.js — the bootstrap CG SUBSTITUTE for the hybrid harness (M3 item 3).
//
//   bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint
//
// It sits at the existing CG stage seam (compiler/src/pipeline-seam.ts, `runCG`):
// impl#1's FileAST → the ingest shim (../ingest.scrml) → Core → check → the bootstrap
// printer (../print.scrml) → the `FileOutput` shape the seam validates. It is the JS glue
// around the scrml modules and makes no language decision of its own:
//
//   - `encode` turns impl#1's AST into the shim's schema-free `IVal` tree: every own key of
//     every object, by name, with NO knowledge of any node kind (only `span` — a source
//     position — is left out). Every interpretation happens in ingest.scrml.
//   - `runCG` refuses (throws) when the shim reports a not-yet shape: a case outside the
//     implemented footprint is never graded (the footprint grader filters first), and a
//     silent partial output would be a guessed mapping.
//   - `executeClient` is the runtime half's EXECUTION of the bootstrap's artifact. The
//     bootstrap prints an ES module over its own runtime (slice-m1/runtime/runtime.js), not
//     impl#1's IIFE-over-SCRML_RUNTIME, so the conformance adapter hands execution to this
//     function when the hybrid is installed (conformance/adapters/impl1-ts.ts
//     `setClientExecutor`). It publishes the OQ3 `__scrml_conformance` hook over the
//     bootstrap runtime's own model: the program declaration's instance fields, by source
//     name (the ratified contract: "impl#2 implements the same signature over its own model").
//
// THROWAWAY, with ingest.scrml: delete this directory when bootstrap `analyze` produces a
// TypedProgram for the conformance corpus.

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { loadBundle, SELF_HOST_V2 } from "../slice-m1/harness.js";
import { makeEncoder } from "./encode.js";

export const M3_MODULES = [
  "core.scrml",
  "walk.scrml",
  "js.scrml",
  "codec.scrml",
  "html.scrml",
  "names.scrml",
  "print.scrml",
  "check.scrml",
  "measure.scrml",
  "ingest.scrml",
];

export const RUNTIME = join(SELF_HOST_V2, "slice-m1", "runtime", "runtime.js");

/** The compiled bootstrap modules (ingest · check · print · …), compiled once by impl#1. */
export function loadM3() {
  return loadBundle(join(SELF_HOST_V2, "slice-m3", "bundle.scrml"), M3_MODULES);
}

const { mods } = loadM3();
const I = mods.ingest;

// The schema-free encoding (see header) — shared with css-substitute.js (encode.js).
export const { encode, encodeNode } = makeEncoder(I);

/** Run the ingest shim over the files CG receives. → { core, why: string[] } */
export function ingestFiles(files) {
  const enc = files.map((f) => I.mkFile(f.filePath ?? f.ast?.filePath ?? "", encodeNode(f.ast)));
  return I.ingest(enc);
}

/**
 * The FOOTPRINT of a compile (dpa-051 §8.2): the Core constructs the ingested program uses and
 * the not-yet reasons (legacy shapes with no Core mapping yet). Called by the footprint grader
 * with the CG arguments of each case.
 */
export function footprint(cgArgs) {
  const r = ingestFiles(cgArgs.files);
  return { constructs: r.why.length === 0 ? [...I.footprint(r.core)].sort() : [], notYet: [...r.why] };
}

/** The CG stage entry: `({ files, … }) -> { outputs: Map<source, FileOutput>, errors }`. */
export function runCG(args) {
  const r = ingestFiles(args.files);
  if (r.why.length > 0) throw new Error(`ingest: not-yet — ${r.why.join("; ")}`);
  const problems = mods.check.checkCore(r.core);
  if (problems.length > 0) throw new Error(`ingest produced an ill-formed Core — ${problems.join("; ")}`);
  const outputs = new Map();
  const file = args.files[0];
  const src = file.filePath ?? file.ast?.filePath;
  const out = mods.print.printProgram(r.core, `${basename(src, ".scrml")}.client.js`, "scrml-runtime.js");
  outputs.set(src, { sourceFile: src, html: out.html, css: null, clientJs: out.js, serverJs: null });
  return { outputs, errors: [] };
}

function between(html, open, close) {
  const i = html.indexOf(open);
  const j = html.lastIndexOf(close);
  return i === -1 || j === -1 ? "" : html.slice(i + open.length, j);
}

/**
 * Execute the bootstrap's artifact in the current (happy-dom) document: mount the page — its
 * <head> templates and its <body> — then import the runtime and the program as ES modules from a
 * fresh directory, so each run gets its own runtime module instance. Publishes the OQ3 hook.
 */
export async function executeClient({ html, clientJs }) {
  const doc = globalThis.document;
  const strip = (s) => s.replace(/<script[^>]*><\/script>/g, "");
  doc.head.innerHTML = strip(between(html, "<head>", "</head>"));
  doc.body.innerHTML = strip(between(html, "<body>", "</body>")).trim();
  const dir = mkdtempSync(join(tmpdir(), "scrml-m3-run-"));
  copyFileSync(RUNTIME, join(dir, "scrml-runtime.js"));
  writeFileSync(join(dir, "program.client.js"), clientJs);
  let rt;
  try {
    rt = await import(join(dir, "scrml-runtime.js"));
    await import(join(dir, "program.client.js"));
  } finally {
    // Both modules are loaded (and the program booted) once the imports settle.
    rmSync(dir, { recursive: true, force: true });
  }
  const program = () => [...rt.devtools.instances.values()].find((i) => i.id === 0 && i.decl.name === "program");
  globalThis.__scrml_conformance = {
    snapshot() {
      const inst = program();
      const cells = {};
      if (inst) {
        const snap = rt.snapshot(inst);
        for (const k of Object.keys(snap)) cells[k] = snap[k] === undefined ? null : snap[k];
      }
      return { cells, derived: {} };
    },
    settled() {
      return new Promise((resolve) => {
        Promise.resolve().then(() => setTimeout(resolve, 0));
      });
    },
  };
}
