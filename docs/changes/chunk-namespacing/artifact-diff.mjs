// OQ-3 artifact-diff gate: across a corpus, assert the ONLY delta between the
// BASE artifacts and the AFTER artifacts is the chunk-namespace TOKEN. Anything
// else in the diff is a finding, not noise.
//
//   bun artifact-diff.mjs <baseDist> <afterDist>
//
// OQ-3 made this gate the merge condition, so the gate itself has to be
// trustworthy. The version shipped at e3584cc5 was NOT: `walk()` recursed but
// re-anchored `relative()` on the SUBdirectory, so nested files entered the set
// as bare basenames, `readFileSync` threw on them, and a `catch { continue; }`
// swallowed it. On a 115-file tree it compared 8 files and reported PASS. Two
// consequences are designed out here:
//
//   - the walk keeps the ORIGINAL root, so paths are genuinely root-relative;
//   - nothing is silently skipped. An unreadable file is a FINDING, and a run
//     that compares zero files FAILS rather than passing vacuously.
import { readdirSync, readFileSync, statSync, existsSync, lstatSync } from "fs";
import { join, relative } from "path";

const [BASE, AFTER] = process.argv.slice(2);
if (!BASE || !AFTER) {
  console.error("usage: bun artifact-diff.mjs <baseDist> <afterDist>");
  process.exit(2);
}

// Fold the namespace token out of a line so the comparison sees the pre-change
// shape. Tokens are EXACTLY 8 lowercase base36 chars and always begin with `0`
// (fnv1a is a u32 and 36^7 > 2^32), followed by `_` and then the id or name the
// token namespaces. Anchoring on that shape matters: the earlier unanchored
// `[0-9a-z]{8}_(\d+)` ate the trailing 8 characters of any identifier sitting
// in front of `_<digits>`.
// The preceding char may be `_` — N4 names look like
// `__scrml_engine_002cvy2b_dragPhase_msg_arms` — but must not be alphanumeric,
// which is what keeps this off the tail of a real identifier. A JS identifier
// cannot begin with a digit, so `0`+7 base36 in that position is always a token.
const TOKEN = /(?<![0-9a-z])0[0-9a-z]{7}_(?=[0-9A-Za-z_])/g;

function fold(s) {
  return (
    s
      // `each_01nk4qam_24` -> `each_24`; `01nk4qam_phase` -> `phase`
      .replace(TOKEN, "")
      // content-addressed runtime/chunk filenames move when the runtime moves;
      // that is the §47 content hash, not a namespace token.
      .replace(/scrml-runtime\.[0-9a-z]{8}\.js/g, "scrml-runtime.HASH.js")
      // The each-anchor id is now a STRING rather than a bare numeric literal —
      // the one deliberate CALL-SHAPE change the design carries (the runtime
      // already concatenates the argument, so no runtime change was needed).
      .replace(/_scrml_find_each_anchor\(document, "(\d+)"\)/g, "_scrml_find_each_anchor(document, $1)")
  );
}

/** Root-relative paths of every regular file under `root`. */
function walk(root, dir = root, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue; // not an emitted artifact
    if (st.isDirectory()) walk(root, p, out);
    else out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

const baseList = walk(BASE);
const afterList = walk(AFTER);
const baseFiles = new Set(baseList);
const afterFiles = new Set(afterList);

// A Set collapses duplicates. With the old broken walk, same-basename files in
// different route dirs collapsed into one another — so check for that rather
// than let it hide.
if (baseFiles.size !== baseList.length || afterFiles.size !== afterList.length) {
  console.log(`FINDING duplicate relative paths in the walk (base ${baseList.length}->${baseFiles.size}, after ${afterList.length}->${afterFiles.size})`);
}

let findings = 0;
for (const f of baseFiles) if (!afterFiles.has(f)) { console.log(`FINDING missing in AFTER: ${f}`); findings++; }
for (const f of afterFiles) if (!baseFiles.has(f)) { console.log(`FINDING new in AFTER:     ${f}`); findings++; }

let compared = 0, identical = 0, tokenOnly = 0;
for (const f of baseFiles) {
  if (!afterFiles.has(f)) continue;
  let a, b;
  try {
    a = readFileSync(join(BASE, f), "utf8");
    b = readFileSync(join(AFTER, f), "utf8");
  } catch (e) {
    // NEVER silently skip — an unreadable artifact is exactly how the previous
    // gate reported green over 107 files it never opened.
    console.log(`FINDING unreadable: ${f} (${e.code ?? e.message})`);
    findings++;
    continue;
  }
  compared++;
  if (a === b) { identical++; continue; }
  const fa = a.split("\n").map(fold);
  const fb = b.split("\n").map(fold);
  if (fa.length !== fb.length) {
    console.log(`FINDING line-count delta: ${f} (${fa.length} -> ${fb.length})`);
    findings++;
    continue;
  }
  let residual = 0;
  for (let i = 0; i < fa.length; i++) {
    if (fa[i] !== fb[i]) {
      if (residual < 5) console.log(`FINDING ${f}:${i + 1}\n  base : ${fa[i].slice(0, 160)}\n  after: ${fb[i].slice(0, 160)}`);
      residual++;
    }
  }
  if (residual === 0) tokenOnly++;
  else findings += residual;
}

console.log(`\nfiles walked (base/after)    : ${baseList.length} / ${afterList.length}`);
console.log(`files COMPARED               : ${compared}`);
console.log(`  byte-identical             : ${identical}`);
console.log(`  differing BY TOKEN ONLY    : ${tokenOnly}`);

if (compared === 0) {
  console.log("GATE FAIL: compared ZERO files — the gate verified nothing");
  process.exit(1);
}
console.log(findings === 0
  ? "GATE PASS: the only artifact delta is the chunk-namespace token"
  : `GATE FAIL: ${findings} non-token deltas`);
process.exit(findings === 0 ? 0 : 1);
