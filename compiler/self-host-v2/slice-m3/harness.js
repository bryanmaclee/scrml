// harness.js — test helpers for the M3 ingest shim: run impl#1's front end over a source and
// capture the arguments its CG stage receives (the shim's input), without printing anything.

import { compileScrml } from "../../src/api.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const CASES = join(import.meta.dir, "..", "..", "..", "conformance", "cases");

/** The CG-stage arguments impl#1 builds for `source` (+ aux files), and its fatal error codes. */
export function cgArgsOf(source, auxFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-m3-cgargs-"));
  try {
    const file = join(dir, "case.scrml");
    writeFileSync(file, source);
    for (const [n, s] of Object.entries(auxFiles)) writeFileSync(join(dir, n), s);
    let args = null;
    const result = compileScrml({
      inputFiles: [file],
      write: false,
      log: () => {},
      stageOverrides: { CG: (a) => { args = a; return { outputs: new Map(), errors: [] }; } },
    });
    return { args, errors: (result.errors ?? []).map((e) => e.code) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A conformance case's source, by its directory under conformance/cases/. */
export function caseSource(rel) {
  return readFileSync(join(CASES, rel, "case.scrml"), "utf8");
}
