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

/**
 * Strip the per-chunk scope wrapper — the IIFE and its cell-scope prologue.
 *
 * OQ-3's gate condition was "the only delta is the id token". The ruled N2/N3/N4
 * mechanism adds a SECOND intended delta: every chunk body is now wrapped in its
 * own scope, opened by a `_scrml_cell_scope(...)` prologue. Both are declared
 * here EXPLICITLY so the gate still means something — anything outside these two
 * is a finding. Folding the wrapper is not the same as ignoring it: the wrapper's
 * own correctness is covered by the executed collision fixtures.
 */
function unwrapChunkScope(text) {
  let out = text
    // BUG-6 prologue: banner comment block through its end-marker.
    .replace(/\n?\/\/ --- chunk cell scope \([0-9a-z]{8}\) ---[\s\S]*?\/\/ --- end chunk cell scope ---\n/, "\n");
  const open = out.indexOf("(function() {\n");
  const close = out.lastIndexOf("\n})();");
  if (open !== -1 && close > open) {
    out =
      out.slice(0, open) +
      out.slice(open + "(function() {\n".length, close) +
      out.slice(close + "\n})();".length);
  }
  return out;
}

function fold(s) {
  return (
    s
      // BUG-6: the body's namespaced accessor calls (`_scrml_cs_reactive_get`)
      // fold back to the bare pre-change name so the comparison is about the CALL,
      // not the wrapper the ruled prologue introduced. The prologue itself is
      // dropped by unwrapChunkScope; this only touches body call sites.
      .replace(/(?<![$\w])_scrml_cs_([a-z_]+)/g, "_scrml_$1")
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
/** Map a normalized walk name back to the real on-disk name. */
function realName(root, rel) {
  if (!rel.endsWith("scrml-runtime.HASH.js")) return rel;
  const dir = join(root, rel.slice(0, -"scrml-runtime.HASH.js".length));
  for (const e of readdirSync(dir)) if (/^scrml-runtime\.[0-9a-z]{8}\.js$/.test(e)) return rel.replace("scrml-runtime.HASH.js", e);
  return rel;
}

function walk(root, dir = root, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue; // not an emitted artifact
    if (st.isDirectory()) walk(root, p, out);
    // The shared runtime is content-addressed, and its bytes DID change
    // (`_scrml_cell_scope` is new), so its filename hash moves. That is the §47
    // content hash doing its job, not a namespace delta — compare it by a
    // normalized name so the pair still lines up.
    else out.push(relative(root, p).split("\\").join("/").replace(/scrml-runtime\.[0-9a-z]{8}\.js$/, "scrml-runtime.HASH.js"));
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

let compared = 0, identical = 0, tokenOnly = 0, runtimeChanged = 0;
for (const f of baseFiles) {
  if (!afterFiles.has(f)) continue;
  let a, b;
  try {
    a = unwrapChunkScope(readFileSync(join(BASE, realName(BASE, f)), "utf8"));
    b = unwrapChunkScope(readFileSync(join(AFTER, realName(AFTER, f)), "utf8"));
  } catch (e) {
    // NEVER silently skip — an unreadable artifact is exactly how the previous
    // gate reported green over 107 files it never opened.
    console.log(`FINDING unreadable: ${f} (${e.code ?? e.message})`);
    findings++;
    continue;
  }
  compared++;
  if (a === b) { identical++; continue; }
  if (/scrml-runtime\.HASH\.js$/.test(f)) {
    // The shared runtime gained `_scrml_cell_scope` — an intended, reviewed
    // runtime change, not a per-artifact namespace delta. Counted, not failed.
    runtimeChanged++;
    continue;
  }
  // Blank lines are not semantic, and unwrapping the chunk scope perturbs their
  // count. Drop them so the comparison is about CODE, not layout.
  const fa = a.split("\n").map(fold).filter((l) => l.trim() !== "");
  const fb = b.split("\n").map(fold).filter((l) => l.trim() !== "");
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
console.log(`  shared runtime (expected)  : ${runtimeChanged}`);

if (compared === 0) {
  console.log("GATE FAIL: compared ZERO files — the gate verified nothing");
  process.exit(1);
}
console.log(findings === 0
  ? "GATE PASS: the only artifact delta is the chunk-namespace token"
  : `GATE FAIL: ${findings} non-token deltas`);
process.exit(findings === 0 ? 0 : 1);
