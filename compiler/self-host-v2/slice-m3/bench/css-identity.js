// css-identity.js — the byte-identity proof for the CSS sub-seam (s440-bootstrap-css-theme-t3).
//
// Compiles every conformance case with PURE impl#1 (no stage substituted) and records a digest of each
// FileOutput artifact (html · css · clientJs · serverJs · libraryJs), plus the css text itself. Run it
// before and after a change to compiler/src, then `--diff` the two snapshots: an unswapped compile must
// be byte-identical (the seam hands back impl#1's own function when nothing is swapped).
//
//   bun compiler/self-host-v2/slice-m3/bench/css-identity.js --out <snapshot.json>
//   bun compiler/self-host-v2/slice-m3/bench/css-identity.js --diff <before.json> <after.json>

import { compileScrml } from "../../../src/api.js";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CASES = join(ROOT, "conformance", "cases");
const ARTIFACTS = ["html", "css", "clientJs", "serverJs", "libraryJs"];

const digest = (s) => (s == null ? null : createHash("sha256").update(s).digest("hex").slice(0, 16));

// A FIXED root is required, not a per-run temp dir: impl#1's artifacts depend on the source's absolute
// path (measured: two identical compiles from two random temp dirs differed in 629 of 1048 cases), so
// a before/after comparison must compile from the same place. Review F7: the root is therefore
// WORKTREE-local (the gitignored `.tmp/`, never a directory shared with other worktrees or agents in
// the system tmpdir), and guarded by a mkdir mutex so two runs in one worktree cannot clobber it.
const ROOT_DIR = join(ROOT, ".tmp", "css-identity");
const LOCK = join(ROOT, ".tmp", "css-identity.lock");

function snapshot() {
  mkdirSync(join(ROOT, ".tmp"), { recursive: true });
  try {
    mkdirSync(LOCK);
  } catch {
    console.error(`css-identity: another run holds ${LOCK} (remove it if no run is live)`);
    process.exit(2);
  }
  try {
    return snapshotLocked();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

function snapshotLocked() {
  const out = {};
  const rels = [...new Bun.Glob("**/case.scrml").scanSync({ cwd: CASES, onlyFiles: true })].map((p) => dirname(p)).sort();
  for (const rel of rels) {
    const dir = join(ROOT_DIR, rel);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      const src = join(CASES, rel);
      for (const p of new Bun.Glob("*.scrml").scanSync({ cwd: src, onlyFiles: true })) {
        writeFileSync(join(dir, p), readFileSync(join(src, p), "utf8"));
      }
      let r;
      try {
        r = compileScrml({ inputFiles: [join(dir, "case.scrml")], write: false, log: () => {} });
      } catch (e) {
        out[rel] = { crash: String(e?.message ?? e).split("\n")[0] };
        continue;
      }
      const o = [...(r.outputs?.values?.() ?? [])].find((x) => String(x.sourceFile).endsWith("case.scrml"));
      const rec = { codes: [...(r.errors ?? []), ...(r.warnings ?? [])].map((e) => e.code).sort() };
      for (const a of ARTIFACTS) rec[a] = digest(o?.[a]);
      rec.cssText = o?.css ?? null;
      out[rel] = rec;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}

const argv = process.argv.slice(2);
if (argv[0] === "--out") {
  const snap = snapshot();
  writeFileSync(argv[1], JSON.stringify(snap, null, 1));
  const n = Object.keys(snap).length;
  const withCss = Object.values(snap).filter((r) => r.cssText).length;
  console.log(`snapshot: ${n} cases, ${withCss} with a css artifact → ${argv[1]}`);
} else if (argv[0] === "--diff") {
  const a = JSON.parse(readFileSync(argv[1], "utf8"));
  const b = JSON.parse(readFileSync(argv[2], "utf8"));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  let diffs = 0;
  let cssCompared = 0;
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (x?.cssText != null || y?.cssText != null) cssCompared++;
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      diffs++;
      console.log(`DIFF ${k}`);
    }
  }
  console.log(`${keys.length} cases compared (${cssCompared} carry css); ${diffs} differ in any artifact digest, code list or css text`);
  process.exit(diffs === 0 ? 0 : 1);
} else {
  console.error("usage: css-identity.js --out <file> | --diff <before> <after>");
  process.exit(2);
}
