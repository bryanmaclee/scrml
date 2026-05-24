// m65b56-phase0-dump.mjs — Phase-0 F+G field divergence dump (M6.5.b.5/b.6)
// Runs LIVE (splitBlocks+buildAST) and NATIVE (nativeParseFile) on the brief
// fixtures, classifies, and prints F-class (FIELD-SHAPE/MISSING/EXTRA) +
// G-class (SPAN-COORD) samples filtered to the candidate fields.
import { readFileSync } from "node:fs";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";
import { classifyDivergences } from "../compiler/src/native-parser-canary/within-node-classifier.ts";

const FIXTURES = [
  "examples/01-hello.scrml",
  "examples/22-multifile/app.scrml",
];
// pick a lifted-blocks fixture from arg
if (process.argv[2]) FIXTURES.push(process.argv[2]);

const FIELD_INTEREST = /\b(closerForm|sourceText|openerHadSpaceAfterLt|_p3aIsExport|_p3aExportName|_synthetic)\b/;

for (const fx of FIXTURES) {
  let src;
  try { src = readFileSync(fx, "utf8"); } catch (e) { console.log(`SKIP ${fx}: ${e.message}`); continue; }
  let live=null, native=null, lc=false, nc=false;
  try { live = buildAST(splitBlocks(fx, src), null).ast; } catch(e){ lc=true; console.log(`LIVE CRASH ${fx}: ${e.message}`);}
  try { native = nativeParseFile(fx, src).ast; } catch(e){ nc=true; console.log(`NATIVE CRASH ${fx}: ${e.message}`);}
  if (lc||nc) continue;
  const { classCounts, samples } = classifyDivergences(live, native);
  console.log(`\n======== ${fx} ========`);
  console.log("class histogram:", JSON.stringify(classCounts));
  // F-class candidate-field samples
  const fField = samples.filter(s =>
    (s.class==="FIELD-SHAPE"||s.class==="MISSING-FIELD"||s.class==="EXTRA-FIELD") &&
    FIELD_INTEREST.test(s.path));
  // tally which candidate fields appear
  const tally = {};
  for (const s of fField) {
    const m = s.path.match(FIELD_INTEREST);
    const key = `${m[1]} [${s.class}]`;
    tally[key] = (tally[key]||0)+1;
  }
  console.log("F-candidate field tally:", JSON.stringify(tally, null, 0));
  // show up to 4 example samples per candidate field
  const seen = {};
  for (const s of fField) {
    const m = s.path.match(FIELD_INTEREST);
    const key = `${m[1]}[${s.class}]`;
    seen[key] = (seen[key]||0);
    if (seen[key] < 3) {
      console.log(`  ${s.class} ${s.path}\n     live=${s.live}\n     native=${s.native}`);
      seen[key]++;
    }
  }
  // SPAN-COORD: how many are pure key-set (file missing) vs offset deltas
  const span = samples.filter(s => s.class==="SPAN-COORD");
  let keysetOnly=0, offsetDelta=0;
  for (const s of span) {
    // key-set divergences record live=keylist native=keylist (comma-joined, no JSON braces)
    if (!s.live.startsWith("{") && s.live.includes(",")) keysetOnly++;
    else offsetDelta++;
  }
  console.log(`SPAN-COORD total=${span.length} keyset(file-missing-style)=${keysetOnly} offsetDelta=${offsetDelta}`);
  if (span.length) console.log(`  example span sample: live=${span[0].live} native=${span[0].native}`);
}
