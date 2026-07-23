// OQ-3 artifact-diff gate: across a corpus, assert the ONLY delta between the
// BASE artifacts and the AFTER artifacts is the chunk-namespace ID TOKEN.
// Anything else in the diff is a finding, not noise.
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const [BASE, AFTER] = process.argv.slice(2);

// Fold the namespace token out of a line so the comparison sees the pre-change
// shape. `<token>_<digits>` -> `<digits>`; `"<token>$name"` -> `"name"`.
function fold(s) {
  return s
    .replace(/\b[0-9a-z]{8}_(\d+)\b/g, "$1")
    .replace(/([0-9a-z]{8})_(\d+)/g, "$2")
    .replace(/"[0-9a-z]{8}\$/g, '"')
    // content-addressed runtime/chunk filenames move when the runtime moves;
    // that is the §47 hash, not a namespace token.
    .replace(/scrml-runtime\.[0-9a-z]{8}\.js/g, "scrml-runtime.HASH.js")
    // The each-anchor id is now a STRING rather than a bare numeric literal —
    // the one deliberate CALL-SHAPE change the design carries (the runtime
    // already concatenates the argument, so no runtime change was needed).
    .replace(/_scrml_find_each_anchor\(document, "(\d+)"\)/g, "_scrml_find_each_anchor(document, $1)");
}

function walk(root, out = []) {
  if (!existsSync(root)) return out;
  for (const e of readdirSync(root)) {
    const p = join(root, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push(relative(root, p));
  }
  return out;
}

const baseFiles = new Set(walk(BASE));
const afterFiles = new Set(walk(AFTER));
let findings = 0;

for (const f of baseFiles) if (!afterFiles.has(f)) { console.log(`FINDING missing in AFTER: ${f}`); findings++; }
for (const f of afterFiles) if (!baseFiles.has(f)) { console.log(`FINDING new in AFTER:     ${f}`); findings++; }

let identical = 0, tokenOnly = 0;
for (const f of baseFiles) {
  if (!afterFiles.has(f)) continue;
  let a, b;
  try { a = readFileSync(join(BASE, f), "utf8"); b = readFileSync(join(AFTER, f), "utf8"); }
  catch { continue; } // symlink / binary artifact — not part of the token gate
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
console.log(`\nfiles identical            : ${identical}`);
console.log(`files differing BY TOKEN ONLY: ${tokenOnly}`);
console.log(findings === 0
  ? "GATE PASS: the only artifact delta is the chunk-namespace token"
  : `GATE FAIL: ${findings} non-token deltas`);
