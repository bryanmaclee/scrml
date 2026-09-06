#!/usr/bin/env bun
/**
 * parse-raw-attribution.ts — attribute each of the 271 flipped failures to the
 * ASSERTION (or throw) that produced it, by reading the harness's captured
 * suite output. Survey-only; reads, writes one artifact.
 *
 * bun prints, per failure, an error block then a `(fail) <name>` line. Within
 * the error block the LAST `corpus-bridge.test.js:<line>:<col>` frame is the
 * assertion site. Line numbers are resolved to assertion NAMES by reading the
 * test file, so a future edit to corpus-bridge.test.js cannot silently
 * mis-attribute.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const HERE = import.meta.dir;
const REPO = resolve(HERE, "../../..");
const RAW = join(REPO, "docs/changes/native-bridge-field-carrying-survey-2026-09-06/artifacts/harness-run/flipped.raw.txt");
const TESTFILE = join(REPO, "compiler/tests/conformance/corpus-bridge.test.js");
const OUT = join(HERE, "artifacts");

// Resolve assertion line -> label by reading the test source.
const testLines = readFileSync(TESTFILE, "utf8").split("\n");
function labelFor(line: number): string {
  const src = (testLines[line - 1] ?? "").trim();
  const m = /expect\(([^)]*)\)/.exec(src);
  if (m) return `assert ${m[1]}`;
  if (/runCaseRuntime/.test(src)) return "THREW inside runCaseRuntime (runtime half)";
  if (/runCase\(/.test(src)) return "THREW inside runCase (codes half)";
  return `line ${line}: ${src.slice(0, 60)}`;
}

const raw = readFileSync(RAW, "utf8").split("\n");
interface Rec { name: string; label: string; errline: string; frames: number[] }
const recs: Rec[] = [];
let frames: number[] = [];
let errline = "";
for (const line of raw) {
  const fr = /corpus-bridge\.test\.js:(\d+):(\d+)/.exec(line);
  if (fr) { frames.push(Number(fr[1])); continue; }
  if (/^(?:error|TypeError|ReferenceError|SyntaxError|RangeError):/.test(line)) {
    errline = line.trim();
    continue;
  }
  const fail = /^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/.exec(line);
  if (fail) {
    // The assertion site is the SHALLOWEST frame in the test body — i.e. the
    // last one printed before the (fail) line for a bun expect stack. Take the
    // max-frequency frame when several appear; ties resolve to the last.
    const site = frames.length > 0 ? frames[frames.length - 1] : -1;
    recs.push({
      name: fail[1],
      label: site === -1 ? "(no frame captured)" : labelFor(site),
      errline,
      frames: [...frames],
    });
    frames = [];
    errline = "";
    continue;
  }
}

const hist = new Map<string, number>();
for (const r of recs) hist.set(r.label, (hist.get(r.label) ?? 0) + 1);
console.log(`failures parsed: ${recs.length}`);
console.log("");
console.log("attribution:");
for (const [k, v] of [...hist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

// Error-text histogram for the THROWN ones.
console.log("");
console.log("error lines for non-expect failures:");
const errHist = new Map<string, number>();
for (const r of recs) {
  if (/^error: expect\(/.test(r.errline)) continue;
  const norm = r.errline.replace(/'[^']*'/g, "'X'").replace(/"[^"]*"/g, '"X"').slice(0, 120);
  errHist.set(norm, (errHist.get(norm) ?? 0) + 1);
}
for (const [k, v] of [...errHist].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

writeFileSync(join(OUT, "attribution.json"), JSON.stringify(recs, null, 2), "utf8");
