// R11 population on this base (impl#1 front end AST walk). Run from the worktree root.
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import fs from "fs";
import path from "path";
const DIRS = ["examples", "samples", "conformance/cases", "stdlib"];
function listScrml(dir) {
  const out = []; const stack = [dir];
  while (stack.length) {
    const d = stack.pop(); let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue; stack.push(p); }
      else if (e.name.endsWith(".scrml")) out.push(p);
    }
  }
  return out.sort();
}
const TX = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const tally = {}; const ex = {}; let files = 0, fail = 0;
const bump = (k, rel, line) => { tally[k] = (tally[k] ?? 0) + 1; (ex[k] ??= []).length < 4 && ex[k].push(rel + ":" + line); };
for (const dir of DIRS) for (const file of listScrml(dir)) {
  files++;
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("?{")) continue;
  let root;
  try { root = buildAST(splitBlocks(file, src)).ast; } catch { fail++; continue; }
  const seen = new WeakSet(); const counted = new Set();
  const lineOf = (o) => src.slice(0, o).split("\n").length;
  (function walk(x, anc) {
    if (!x || typeof x !== "object" || seen.has(x)) return; seen.add(x);
    if (Array.isArray(x)) { x.forEach((y) => walk(y, anc)); return; }
    if ((x.kind === "sql" || x.kind === "sql-ref") && !(x.kind === "sql" && x.node)) {
      const key = x.id ?? (x.raw + ":" + x.span?.start + ":" + anc.length);
      if (!counted.has(key)) {
        counted.add(key);
        let fi = -1; for (let i = anc.length - 1; i >= 0; i--) if (anc[i].kind === "function-decl") { fi = i; break; }
        const fn = fi >= 0 ? anc[fi] : null;
        const local = anc.slice(fi + 1);
        const line = x.span && typeof x.span.start === "number" && x.kind === "sql" ? lineOf(x.span.start) : "?";
        const rel = file;
        let k;
        if (anc.some((a) => a.kind === "function-decl" && a.canFail)) k = "in-bang-fn";
        else if (local.some((a) => a.kind === "guarded-expr" || /^match/.test(a.kind ?? ""))) k = "handled";
        else if (TX.test(x.query ?? x.raw ?? "")) k = "tx";
        else if (anc.some((a) => a.kind === "state-decl" && a.isServer)) k = "patternC";
        else {
          const p = anc[anc.length - 1];
          const top = fn ? "" : "@top";
          k = "U:" + (p?.kind ?? "root") + (p?.kind === "bare-expr" ? ":" + p.exprNode?.kind : "") + top + ":" + (x.chainedCalls?.[0]?.method ?? (x.kind === "sql-ref" ? "ref" : "bare"));
        }
        bump(k, rel, line);
      }
    }
    for (const kk of Object.keys(x)) if (kk !== "parent") walk(x[kk], anc.concat([x]));
  })(root, []);
}
console.log("files", files, "parseFail", fail);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k, "  e.g.", ex[k].slice(0, 2).join(" "));
