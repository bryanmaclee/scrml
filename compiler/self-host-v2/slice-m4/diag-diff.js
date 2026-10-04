// diag-diff.js — s452-effect-summary: compare two DIAGNOSTIC LOGS written by
// the SCRML_BOOT_DIAG_LOG hook (slice-m1/harness.js `logAnalyze`).
//
// A refactor of analyze that must not change any diagnostic (the dpa-066
// migration, M0..M6) is proven by running the SAME inputs before and after
// it — every slice test and every conformance-counter case:
//
//   SCRML_BOOT_DIAG_LOG=/abs/before.jsonl bun test ./compiler/self-host-v2/slice-m4/   (… every slice)
//   SCRML_BOOT_DIAG_LOG=/abs/before.jsonl bun scripts/bootstrap-conformance.ts
//   … apply the change, write after.jsonl the same way …
//   bun compiler/self-host-v2/slice-m4/diag-diff.js before.jsonl after.jsonl
//
// Each line is one `analyze` call: the hash of its input ASTs, and every
// diagnostic and info (code, file, span, message) IN ORDER. Two calls with the
// same key must report the same list. Exit 0 when every key both logs share
// agrees and neither log has a key the other lacks; else 1, listing each
// difference.

import { readFileSync } from "node:fs";

function load(path) {
  const m = new Map();
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (l.trim() === "") continue;
    const r = JSON.parse(l);
    const v = JSON.stringify({ diags: r.diags, infos: r.infos });
    if (!m.has(r.key)) m.set(r.key, new Set());
    m.get(r.key).add(v);
  }
  return m;
}

function first(set) {
  return JSON.parse([...set][0]);
}

/** Every difference between two logs, as text lines (empty: none). */
export function diffLogs(beforePath, afterPath) {
  const a = load(beforePath);
  const b = load(afterPath);
  const out = [];
  for (const [k, vs] of a) {
    if (vs.size > 1) out.push(`${k}: BEFORE is not deterministic (${vs.size} different reports)`);
    if (!b.has(k)) {
      out.push(`${k}: analyzed BEFORE only`);
      continue;
    }
    const ws = b.get(k);
    if (ws.size > 1) out.push(`${k}: AFTER is not deterministic (${ws.size} different reports)`);
    const x = [...vs][0];
    const y = [...ws][0];
    if (x !== y) {
      const bx = first(vs);
      const by = first(ws);
      out.push(`${k}: differs`);
      out.push(`  before: ${bx.diags.map((d) => `${d.code}@${d.file}:${d.start}`).join(", ")}`);
      out.push(`  after:  ${by.diags.map((d) => `${d.code}@${d.file}:${d.start}`).join(", ")}`);
      const n = Math.max(bx.diags.length, by.diags.length);
      for (let i = 0; i < n; i++) {
        const p = JSON.stringify(bx.diags[i] ?? null);
        const q = JSON.stringify(by.diags[i] ?? null);
        if (p !== q) {
          out.push(`  #${i} before ${p}`);
          out.push(`  #${i} after  ${q}`);
        }
      }
      if (JSON.stringify(bx.infos) !== JSON.stringify(by.infos)) out.push("  infos differ");
    }
  }
  for (const k of b.keys()) {
    if (!a.has(k)) out.push(`${k}: analyzed AFTER only`);
  }
  return { lines: out, keys: a.size, shadow: shadowLines(afterPath) };
}

/** The effect-summary shadow's disagreements a log recorded (dpa-066 M0), deduplicated. */
export function shadowLines(path) {
  const seen = new Set();
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (l.trim() === "") continue;
    const r = JSON.parse(l);
    for (const s of r.shadow ?? []) seen.add(`${r.key}: ${s}`);
  }
  return [...seen];
}

if (import.meta.main) {
  const [x, y] = process.argv.slice(2);
  if (!x || !y) {
    console.error("usage: bun diag-diff.js <before.jsonl> <after.jsonl>");
    process.exit(2);
  }
  const r = diffLogs(x, y);
  for (const l of r.lines) console.log(l);
  for (const l of r.shadow) console.log(`shadow ${l}`);
  console.log(`${r.keys} distinct analyze inputs compared; ${r.lines.length === 0 ? "IDENTICAL" : "DIFFERENT"}; ${r.shadow.length} shadow disagreement(s) in the AFTER log`);
  process.exit(r.lines.length === 0 ? 0 : 1);
}
