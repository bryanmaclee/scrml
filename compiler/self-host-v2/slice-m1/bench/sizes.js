// sizes.js — measurements (b) and (c) of slice M1.
//
// (b) Core size per program: node counts by kind (walk.allNodes, measure.scrml)
//     vs the SOURCE (the SPEC §66.19 code block: bytes / non-blank lines / tokens,
//     tokens by the native-parser lexer — token-identical to the bootstrap lexer).
// (c) Printer output size vs impl#1's output for the nearest impl#1-compilable
//     equivalent (bench/impl1-*.scrml): client JS, HTML, runtime — raw + gzip.
//
// usage: bun compiler/self-host-v2/slice-m1/bench/sizes.js

import { readFileSync, readdirSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { compileScrml } from "../../../src/api.js";
import { lex } from "../../../native-parser/lex.js";
import { loadBootstrap } from "../harness.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SPEC = readFileSync(join(ROOT, "compiler", "SPEC.md"), "utf8");

// The ```scrml blocks under a SPEC heading, joined.
function specBlocks(heading) {
  const at = SPEC.indexOf(heading);
  const end = SPEC.indexOf("\n#### ", at + heading.length);
  const section = SPEC.slice(at, end);
  return [...section.matchAll(/```scrml\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
}

function sourceStats(src) {
  const tokens = lex(src).filter((t) => t.kind !== "EOF").length;
  const lines = src.split("\n").filter((l) => l.trim().length > 0).length;
  return { bytes: Buffer.byteLength(src), lines, tokens };
}

const gz = (s) => gzipSync(Buffer.from(s)).length;

function family(kind) { return kind.split(".")[0]; }

const { mods } = loadBootstrap();
const runtimeSrc = readFileSync(join(import.meta.dir, "..", "runtime", "runtime.js"), "utf8");

function impl1(file) {
  const out = mkdtempSync(join(tmpdir(), "impl1-size-"));
  const r = compileScrml({ inputFiles: [join(import.meta.dir, file)], outputDir: out, write: true, log: () => {} });
  const errs = (r.errors ?? []).filter((e) => e && e.code);
  if (errs.length) throw new Error(file + ": " + errs.map((e) => e.code).join(","));
  const files = readdirSync(out);
  const read = (suffix) => readFileSync(join(out, files.find((f) => f.endsWith(suffix))), "utf8");
  const rtFile = files.find((f) => f.startsWith("scrml-runtime"));
  return { js: read(".client.js"), html: read(".html"), runtime: readFileSync(join(out, rtFile), "utf8") };
}

const programs = [
  { name: "counter", heading: "#### 66.19.1", core: () => mods["counter.core"].counterCore(), impl1: "impl1-counter.scrml" },
  { name: "dropdown", heading: "#### 66.19.3", core: () => mods["dropdown.core"].dropdownCore(), impl1: "impl1-dropdown.scrml" },
];

const lines = [];
for (const p of programs) {
  const src = specBlocks(p.heading);
  const s = sourceStats(src);
  const core = p.core();
  const counts = mods.measure.countNodes(core);
  const total = counts.reduce((a, c) => a + c.count, 0);
  const byFamily = {};
  for (const c of counts) byFamily[family(c.kind)] = (byFamily[family(c.kind)] ?? 0) + c.count;
  lines.push(`## ${p.name}`);
  lines.push(`source (SPEC ${p.heading.slice(5)}): ${s.bytes} bytes, ${s.lines} non-blank lines, ${s.tokens} tokens`);
  lines.push(`Core: ${total} nodes (${(total / s.tokens).toFixed(2)} nodes/token) — by family: ${JSON.stringify(byFamily)}`);
  lines.push(`Core by kind: ${counts.map((c) => `${c.kind}=${c.count}`).join(", ")}`);
  const out = mods.print.printProgram(core, `${p.name}.client.js`, "scrml-runtime.js");
  const i1 = impl1(p.impl1);
  lines.push(`| artifact | bootstrap (bytes / gzip) | impl#1 (bytes / gzip) |`);
  lines.push(`|---|---|---|`);
  lines.push(`| client JS | ${out.js.length} / ${gz(out.js)} | ${i1.js.length} / ${gz(i1.js)} |`);
  lines.push(`| HTML | ${out.html.length} / ${gz(out.html)} | ${i1.html.length} / ${gz(i1.html)} |`);
  lines.push(`| runtime | ${runtimeSrc.length} / ${gz(runtimeSrc)} | ${i1.runtime.length} / ${gz(i1.runtime)} |`);
  lines.push(`| JS lines | ${out.js.split("\n").length} | ${i1.js.split("\n").length} |`);
  lines.push("");
}
console.log(lines.join("\n"));
