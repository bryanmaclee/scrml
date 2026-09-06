#!/usr/bin/env bun
/**
 * bridge-survey-codes.ts — STAGE 1 of the native-bridge field-carrying survey.
 *
 * SURVEY-ONLY INSTRUMENT. Changes nothing; writes only under this change-dir.
 *
 * WHAT IT MEASURES
 * ----------------
 * For every conformance corpus case, compile the SAME source twice through the
 * SAME entry point (`compileScrml`, compiler/src/api.js):
 *   - CONTROL: default options (live BS+TAB path)
 *   - FLIP:    `parser: "scrml-native"` (routes the per-file parse through
 *              `nativeParseFile`, compiler/native-parser/parse-file.js)
 *
 * `parser: "scrml-native"` ALSO fires the I-PARSER-NATIVE-SHADOW routing-
 * confirmation info diagnostic into result.warnings (api.js, the
 * `if (parser === "scrml-native")` site). The committed flip harness's
 * `--mode=routing` patches `useNativeParser` to `true` instead, precisely so
 * that diagnostic does NOT fire. To be EQUIVALENT to routing-mode this script
 * filters I-PARSER-NATIVE-SHADOW out of the flipped code-set.
 *
 * OUTPUT: <out>/codes.json — per case:
 *   { id, relDir, requiredCodes, controlCodes, flipCodes,
 *     controlMissing, flipMissing, newlyMissing, controlThrew, flipThrew }
 *
 * `newlyMissing` is the survey's unit: required codes that FIRE on control and
 * do NOT fire under the flip. That is the population the 271 is made of.
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadCases } from "../../../conformance/run.ts";
import { compileScrml } from "../../../compiler/src/api.js";

const HERE = import.meta.dir;
const OUT = resolve(HERE, "artifacts");
mkdirSync(OUT, { recursive: true });

const SHADOW = "I-PARSER-NATIVE-SHADOW";

function writeCaseFiles(
  dir: string,
  source: string,
  auxFiles: Record<string, string>,
): string {
  const entry = join(dir, "case.scrml");
  writeFileSync(entry, source, "utf8");
  for (const [name, content] of Object.entries(auxFiles)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  return entry;
}

interface Run {
  codes: string[];
  threw: string | null;
}

function compileOnce(
  source: string,
  auxFiles: Record<string, string>,
  native: boolean,
): Run {
  const dir = mkdtempSync(join(tmpdir(), "scrml-bridge-survey-"));
  try {
    const file = writeCaseFiles(dir, source, auxFiles);
    const opts: Record<string, unknown> = {
      inputFiles: [file],
      write: false,
      outputDir: join(dir, "out"),
      log: () => {},
    };
    if (native) opts.parser = "scrml-native";
    const result = compileScrml(opts) as {
      errors?: Array<{ code?: string }>;
      warnings?: Array<{ code?: string }>;
    };
    const set = new Set<string>();
    for (const d of result.errors ?? []) if (typeof d?.code === "string" && d.code) set.add(d.code);
    for (const d of result.warnings ?? []) if (typeof d?.code === "string" && d.code) set.add(d.code);
    set.delete(SHADOW);
    return { codes: [...set].sort(), threw: null };
  } catch (e) {
    return { codes: [], threw: String((e as Error)?.message ?? e).slice(0, 300) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = loadCases();
console.log(`cases discovered: ${cases.length}`);

const rows: unknown[] = [];
let n = 0;
for (const c of cases) {
  n++;
  if (n % 100 === 0) console.log(`  ... ${n}/${cases.length}`);
  const required: string[] = Array.isArray(c.expected.expect?.codes)
    ? (c.expected.expect.codes as string[])
    : [];
  const control = compileOnce(c.source, c.auxFiles, false);
  const flip = compileOnce(c.source, c.auxFiles, true);
  const controlSet = new Set(control.codes);
  const flipSet = new Set(flip.codes);
  const controlMissing = required.filter((k) => !controlSet.has(k));
  const flipMissing = required.filter((k) => !flipSet.has(k));
  const newlyMissing = flipMissing.filter((k) => controlSet.has(k));
  rows.push({
    id: c.expected.id,
    relDir: c.relDir,
    requiredCodes: required,
    controlCodes: control.codes,
    flipCodes: flip.codes,
    controlMissing,
    flipMissing,
    newlyMissing,
    newlyFired: flip.codes.filter((k) => !controlSet.has(k)),
    controlThrew: control.threw,
    flipThrew: flip.threw,
  });
}

writeFileSync(join(OUT, "codes.json"), JSON.stringify(rows, null, 2), "utf8");

// --- headline ---------------------------------------------------------------
const withNewlyMissing = rows.filter((r: any) => r.newlyMissing.length > 0);
const codeHist = new Map<string, number>();
for (const r of rows as any[]) {
  for (const k of r.newlyMissing) codeHist.set(k, (codeHist.get(k) ?? 0) + 1);
}
const flipThrew = rows.filter((r: any) => r.flipThrew && !r.controlThrew);
console.log("");
console.log(`cases                                : ${rows.length}`);
console.log(`cases w/ newlyMissing (flip-caused)  : ${withNewlyMissing.length}`);
console.log(`distinct newly-missing CODES         : ${codeHist.size}`);
console.log(`cases where the FLIP threw (ctl ok)  : ${flipThrew.length}`);
console.log("");
console.log("top newly-missing codes:");
for (const [k, v] of [...codeHist].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
