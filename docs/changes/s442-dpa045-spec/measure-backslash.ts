// dpa-045 E(b): backslash-in-plain-markup-free-text count + code-default escape-catalog use count.
// Structural: uses the shipping block splitter (splitBlocks) to find text runs whose parent is a
// plain-markup element (free-text production). Excludes: logic/sql/css/etc. children, <program>/<page>
// bodies (default-logic, §40.8), engine/match bodies + their state-children/arms (code-default),
// and buckets <pre>/<code> (raw-content, §4.17) separately.
import { splitBlocks } from "/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a33767a8215d9e61d/compiler/src/block-splitter.js";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const W = "/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a33767a8215d9e61d";
const DIRS = (process.env.DIRS ?? "examples,samples/compilation-tests,conformance/cases,stdlib,docs/tutorial-snippets,docs/readme-snippets,compiler/self-host-v2").split(",");

function files(d: string): string[] {
  const out: string[] = [];
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...files(p));
    else if (e.endsWith(".scrml")) out.push(p);
  }
  return out;
}

const CODE_DEFAULT_PARENTS = new Set(["engine", "match"]);
const DEFAULT_LOGIC = new Set(["program", "page"]);
const RAW = new Set(["pre", "code"]);

type Hit = { file: string; line: number; ctx: string; bucket: string; parent: string };
const hits: Hit[] = [];
const escHits: { file: string; line: number; esc: string; ctx: string; locus: string }[] = [];
const perDir: Record<string, { files: number; parsed: number; failed: number }> = {};
let logicBackslashOutsideStrings = 0;

function lineOf(src: string, off: number) { let n = 1; for (let i = 0; i < off; i++) if (src.charCodeAt(i) === 10) n++; return n; }

const litCount: Record<string, number> = {};
function scanLiteralEscapes(file: string, src: string, lit: string, baseOff: number, locus: string) {
  litCount[locus] = (litCount[locus] ?? 0) + 1;
  // lit is a "..." display-text literal (with quotes)
  for (let i = 1; i < lit.length - 1; i++) {
    if (lit[i] === "\\") {
      const nx = lit[i + 1];
      const esc = nx === '"' ? '\\"' : nx === "\\" ? "\\\\" : (nx === "$" && lit[i + 2] === "{") ? "\\${" : "\\" + nx + "(malformed)";
      escHits.push({ file, line: lineOf(src, baseOff + i), esc, ctx: lit.slice(0, 80), locus });
      i++;
    }
  }
}

for (const d of DIRS) {
  const fs = files(d.startsWith("/") ? d : join(W, d));
  perDir[d] = { files: fs.length, parsed: 0, failed: 0 };
  for (const f of fs) {
    const src = readFileSync(f, "utf8");
    let r: any;
    try { r = splitBlocks(f, src); perDir[d].parsed++; } catch (e) { perDir[d].failed++; continue; }
    const rel = relative(W, f);
    const walk = (bs: any[], parent: any, grand: any, inRaw: boolean) => {
      for (const b of bs) {
        if (b.type === "text") {
          const pt = parent?.type ?? "root";
          const pn = parent?.name ?? "(root)";
          let bucket: string | null = null;
          if (pt === "markup" || pt === "state") {
            if (DEFAULT_LOGIC.has(pn)) bucket = null;                 // default-logic
            else if (CODE_DEFAULT_PARENTS.has(pn)) bucket = null;     // inter-child whitespace
            else if (grand && CODE_DEFAULT_PARENTS.has(grand.name)) bucket = "code-default";
            else if (inRaw || RAW.has(pn)) bucket = "raw-content";
            else bucket = "free-text";
          } else if (pt === "root") bucket = "root-text";
          if (bucket === "code-default") {
            // display-text literals in block-form bodies
            const re = /"(?:[^"\\]|\\.)*"/g; let m;
            while ((m = re.exec(b.raw))) scanLiteralEscapes(rel, src, m[0], b.span.start + m.index, "block-form");
          }
          if (bucket && bucket !== "code-default") {
            for (let i = 0; i < b.raw.length; i++) if (b.raw[i] === "\\") {
              const off = b.span.start + i;
              hits.push({ file: rel, line: lineOf(src, off), ctx: b.raw.slice(Math.max(0, i - 25), i + 25).replace(/\n/g, "⏎"), bucket, parent: pn });
            }
          }
        }
        if ((b.type === "markup" || b.type === "state") && parent && CODE_DEFAULT_PARENTS.has(parent.name) && b.closerForm === "shorthand") {
          // :-shorthand opener — the literal after the colon
          const openerTxt = b.raw;
          const ci = b.shorthandColonOff;
          const after = openerTxt.slice(ci ?? 0);
          const m = /:\s*("(?:[^"\\]|\\.)*")/.exec(after);
          if (m) scanLiteralEscapes(rel, src, m[1], b.span.start + (ci ?? 0) + m.index + m[0].indexOf('"'), "shorthand");
        }
        if (b.children && b.children.length) walk(b.children, b, parent, inRaw || (b.type === "markup" && RAW.has(b.name)));
      }
    };
    walk(r.blocks, null, null, false);
  }
}

console.log("PER-DIR", JSON.stringify(perDir));
const byBucket: Record<string, number> = {};
for (const h of hits) byBucket[h.bucket] = (byBucket[h.bucket] ?? 0) + 1;
console.log("BACKSLASH HITS by bucket", JSON.stringify(byBucket));
for (const h of hits) console.log(`HIT\t${h.bucket}\t${h.file}:${h.line}\t<${h.parent}>\t${h.ctx}`);
console.log("ESCAPE-CATALOG HITS", escHits.length);
for (const e of escHits) console.log(`ESC\t${e.locus}\t${e.esc}\t${e.file}:${e.line}\t${e.ctx}`);
console.log("DISPLAY-TEXT LITERALS SEEN", JSON.stringify(litCount));
