// S458 2a-fix — classify every output that differs between two emit manifests
// (s458-refinement-every-position/repro/emit-manifest.mjs) by the lines that changed.
// Usage: bun classify-diff.mjs <a.json> <b.json> <aOutRoot> <bOutRoot>
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
const [aj, bj, ar, br] = process.argv.slice(2).map((p) => resolve(p));
const A = JSON.parse(readFileSync(aj, "utf8")), B = JSON.parse(readFileSync(bj, "utf8"));
const norm = (s) => s.replace(/scrml-runtime\.[a-z0-9]+\.js/g, "scrml-runtime.<h>.js").replace(/_scrml_judge_(\w+?)_[a-z0-9]+\b/g, "_scrml_judge_$1_<id>");
const walk = (d, pre = "") => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(d, e.name), pre + e.name + "/") : [pre + e.name]) : [];
const classes = new Map();
const add = (c, f) => { if (!classes.has(c)) classes.set(c, []); classes.get(c).push(f); };
for (const f of Object.keys(B).sort()) {
  const a = A[f], b = B[f];
  if (!a) { add("new file", f); continue; }
  if (JSON.stringify(a.codes) !== JSON.stringify(b.codes)) add(`codes changed: ${JSON.stringify(a.codes.filter((c) => !b.codes.includes(c)))} -> ${JSON.stringify(b.codes.filter((c) => !a.codes.includes(c)))}`, f);
  const da = resolve(ar, String(a.idx)), db = resolve(br, String(b.idx));
  const files = new Set([...walk(da), ...walk(db)].map((x) => x.replace(/scrml-runtime\.[a-z0-9]+\.js/, "RUNTIME")));
  const tags = new Set();
  for (const rel of files) {
    const read = (d) => { const real = rel === "RUNTIME" ? walk(d).find((x) => /scrml-runtime\./.test(x)) : rel; return real && existsSync(resolve(d, real)) ? norm(readFileSync(resolve(d, real), "utf8")) : null; };
    const x = read(da), y = read(db);
    if (x === y) continue;
    if (x === null || y === null) { tags.add(`${rel}: ${x === null ? "added" : "removed"}`); continue; }
    const xs = new Set(x.split("\n")), ys = new Set(y.split("\n"));
    const plus = [...ys].filter((l) => !xs.has(l)), minus = [...xs].filter((l) => !ys.has(l));
    const kind = (l) =>
      /refine_register|_scrml_refine_/.test(l) ? "cell-judge-registration/refine-chunk" :
      /_scrml_judge_|§53 judge/.test(l) ? "hoisted-judge" :
      /E-CONTRACT-001-RT|Constraint: \(|Value constraint|_scrml_chk_|Location: |throw new Error\(|^\s*\);?$|^\s*\}$|"  Value: "|"  Variable: "/.test(l) ? "check-text" :
      /_scrml_bv|bind:value|Number\(event\.target\.value\)/.test(l) ? "bind-gate" :
      /_scrml_refine_check\(varName/.test(l) ? "engine-direct-write-judge" :
      /^\s*$/.test(l) ? "blank" : "OTHER";
    const ks = new Set([...plus, ...minus].map(kind));
    ks.delete("blank");
    tags.add(`${rel.replace(/^.*\./, ".")}: ${[...ks].sort().join("+") || "whitespace"}`);
    if (ks.has("OTHER") && process.env.SHOW) console.log(f, rel, "\n  -", minus.filter((l) => kind(l) === "OTHER").slice(0, 3).join("\n  - "), "\n  +", plus.filter((l) => kind(l) === "OTHER").slice(0, 3).join("\n  + "));
  }
  if (tags.size) add([...tags].sort().join(" | "), f);
}
for (const [c, fs] of [...classes].sort((p, q) => q[1].length - p[1].length)) {
  console.log(`${String(fs.length).padStart(4)}  ${c}`);
  for (const f of fs.slice(0, Number(process.env.N ?? 2))) console.log(`        e.g. ${f}`);
}
