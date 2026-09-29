/**
 * measure-loose-body-prose.ts — S441 "prose must be DECLARED" migration measurement.
 *
 * Ruling (user-voice-scrml.md S441): a `<program>` / `<page>` body carries no loose
 * prose; a bare text run there is CODE; displayed text is declared by a markup
 * element (`<p>…</p>`) or a `"..."` display-text literal (§4.18.3).
 *
 * This probe answers: WHAT DOES THAT RULE TOUCH? It parses every `.scrml` file with
 * BOTH front ends — the default live pipeline (`splitBlocks` + `buildAST`) and the
 * native parser (`nativeParseFile`, i.e. `--parser=scrml-native`) — and, for every
 * `<program>` / `<page>` body (`<channel>` bodies and the file root reported
 * SEPARATELY), collects each direct-child `text` node. A direct-child text node is by
 * construction NOT inside a markup element and NOT an existing lifted declaration
 * (the §40.8 lift turns those into a `_synthetic` `logic` node, which is skipped).
 * Those text nodes are exactly the runs the new rule would re-read as code.
 *
 * WHITESPACE: a text node whose value is whitespace-only is counted in `wsRuns` and
 * is NOT a run — whitespace between children is source formatting under the rule
 * (§4.18.5, "whitespace outside a literal ... is NOT content"). Inside a counted run,
 * whitespace-only LINES are dropped before classification.
 *
 * Each non-blank line of a run is classified (heuristic; see classifyLine):
 *   prose            — words meant for display
 *   prose-as-expr    — prose that is ALSO a valid bare expression (one identifier /
 *                      number), e.g. `Counter` — under the rule it silently becomes an
 *                      identifier reference, not an E-UNQUOTED-DISPLAY-TEXT
 *   separator        — punctuation / entities only (`|`, `&nbsp;·&nbsp;`, `—`)
 *   quoted           — a whole-line `"..."`: renders WITH its quotes today; under the
 *                      rule it is a display-text literal and the quotes disappear
 *   stray-code       — code that ships as page text by accident today
 *                      (class/try/await/if(/for(/a call/assignment/braces/`;`)
 *   comment          — `//` `/*` `<!--` shaped text that reached a text node
 *   markup-debris    — a line starting with `<`, `</`, `/>` or `>`
 * A run's primary class: stray-code if any line is code (`mixed` if it also has
 * prose), else prose / prose-as-expr / separator / quoted / comment / markup-debris.
 * A run is `interp-adjacent` when an author-written `${…}` sibling sits on the same
 * source line (e.g. `Count is ${@count} now.`) — the fix must merge the siblings.
 *
 * Fix class (the §63.4 question — can a mechanical `scrml fix` rewrite it?):
 *   mechanical  — prose / separator / prose-as-expr (incl. interp-adjacent): wrap the
 *                 line in a `"..."` display-text literal (behaviour-preserving; the
 *                 literal's `${}` covers the interp-adjacent merge, §4.18.4)
 *   quoted      — mechanical too, but the author choice matters: escape to keep the
 *                 quotes rendered (`"\"x\""`) or accept the drop (the likely intent)
 *   human       — stray-code / mixed / markup-debris: the current output is already
 *                 wrong (code shipped as text); a rewrite cannot know the intent
 *   comment     — no display impact either way (reported, not a migration site)
 * Also reported: `lifted-bare-expr` — a bare-expr the §40.8 lift ALREADY swallowed
 * from a text run that follows a declaration (e.g. prose right after `<x> = 0` lifts
 * as `Hello world , …` and fails E-SCOPE-001 today) — already code-default in effect.
 *
 * Run:  bun scripts/measure-loose-body-prose.ts [--json <out.json>] [--examples N] [root...]
 * Default roots: examples samples conformance/cases docs/readme-snippets
 *   docs/tutorial-snippets stdlib + ../../scrml-site + ../../flogence (read-only; the
 *   probe only reads files). `dist/`, `node_modules/`, `.git/`, `.claude/` are skipped.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { nativeParseFile } from "../compiler/native-parser/parse-file.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MASTER = resolve(ROOT, "..");

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
let jsonOut: string | null = null;
let nExamples = 12;
const roots: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--json") jsonOut = argv[++i];
  else if (argv[i] === "--examples") nExamples = Number(argv[++i]);
  else roots.push(resolve(argv[i]));
}
if (roots.length === 0) {
  for (const r of ["examples", "samples", "conformance/cases", "docs/readme-snippets", "docs/tutorial-snippets", "stdlib"]) roots.push(join(ROOT, r));
  // The sibling repos. MASTER is resolved from the main checkout even when run in a worktree.
  const master = ROOT.includes("/.claude/worktrees/") ? ROOT.split("/scrml/.claude/worktrees/")[0] : MASTER;
  for (const r of ["scrml-site", "flogence"]) roots.push(join(master, r));
}

const SKIP_DIRS = new Set(["dist", "node_modules", ".git", ".claude"]);
function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith(".scrml")) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------- classification
type LineClass = "prose" | "prose-as-expr" | "separator" | "quoted" | "stray-code" | "comment" | "markup-debris";

const KW_HEAD = /^(class|try|catch|finally|throw|await|async|for|while|do|if|else|switch|case|default|return|when|on|export|import|const|let|var|function|fn|type|match|lift|new|yield|break|continue|server|use|enum|struct)\b/;
const CODE_PUNCT = /[{}();=]|=>/;

export function classifyLine(t: string): LineClass {
  // HTML entities (`&nbsp;`, `&#8212;`) are display characters — strip them before
  // the code checks so `&nbsp;|&nbsp;` is not read as a `;`-terminated statement.
  const noEnt = t.replace(/&[A-Za-z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, "\u00a0");
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return "quoted";
  if (/^(\/\/|\/\*|\*\/|\*\s|<!--|-->)/.test(t)) return "comment";
  // `<…`, `/>`, `>`, and a legacy bare closer (`/div`, `/form`) — a markup fragment.
  if (/^(<|\/>|>)/.test(t) || /^\/[a-z][\w-]*$/.test(t)) return "markup-debris";
  // code shapes
  if (/^[?_#!^~]\{/.test(t)) return "stray-code"; // a scrml sigil block (`?{sql}`, `_{js}`, …)
  if (KW_HEAD.test(t)) {
    const kw = t.match(KW_HEAD)![1];
    if (t === kw || CODE_PUNCT.test(t)) return "stray-code";
    // `class Foo extends Bar`, `await foo`, `throw err`, `import x from "y"` — code
    // even without punctuation when the keyword is not also a common English opener.
    if (/^(class|await|throw|async|fn|function|const|let|var|import|export|enum|struct|lift|yield)\s+[A-Za-z_$@][\w$.]*\s*$/.test(t)) return "stray-code";
    if (/^import\s.+\sfrom\s/.test(t)) return "stray-code";
    if (/^use\s+[\w-]+:[\w-]/.test(t)) return "stray-code"; // `use scrml:ui` (§21)
  }
  if (/^[}\])]/.test(noEnt) || /[{;]$/.test(noEnt)) return "stray-code";
  if (/^@?[A-Za-z_$][\w$.]*(\[[^\]]*\])*\s*(=(?!=)|\+=|-=|\*=|\/=|\+\+|--)/.test(t)) return "stray-code";
  if (/^@?[A-Za-z_$][\w$.]*\s*\(.*\)\s*;?$/.test(t) && !/\s/.test(t.replace(/\(.*\)/, ""))) return "stray-code";
  if (/=>/.test(t)) return "stray-code";
  // display shapes
  if (!/[\p{L}\p{N}]/u.test(noEnt)) return "separator";
  if (/^[A-Za-z_$][\w$]*$/.test(t) || /^\d+(\.\d+)?$/.test(t)) return "prose-as-expr";
  return "prose";
}

type Surface = "program" | "page" | "channel" | "file-root";
interface Line { line: number; text: string; cls: LineClass }
interface Run {
  file: string; surface: Surface; line: number; lines: Line[];
  primary: string; interpAdjacent: boolean; fix: "mechanical" | "quoted" | "human" | "comment";
}

function primaryOf(lines: Line[]): string {
  const has = (c: LineClass) => lines.some((l) => l.cls === c);
  const disp = has("prose") || has("prose-as-expr") || has("separator") || has("quoted");
  if (has("stray-code")) return disp ? "mixed" : "stray-code";
  if (has("markup-debris")) return "markup-debris";
  if (has("prose")) return "prose";
  if (has("prose-as-expr")) return "prose-as-expr";
  if (has("quoted")) return "quoted";
  if (has("separator")) return "separator";
  return "comment";
}
function fixOf(primary: string): Run["fix"] {
  if (primary === "prose" || primary === "prose-as-expr" || primary === "separator") return "mechanical";
  if (primary === "quoted") return "quoted";
  if (primary === "comment") return "comment";
  return "human";
}

interface FileResult {
  runs: Run[]; wsRuns: number; declaredLiterals: number; surfaces: Record<Surface, number>; liftedBareExpr: { line: number; expr: string }[]; crash?: string;
}

function isInlineLogic(n: any): boolean {
  return n && n.kind === "logic" && !n._synthetic;
}

function analyze(src: string, rel: string, nodes: any[]): FileResult {
  const res: FileResult = { runs: [], wsRuns: 0, declaredLiterals: 0, surfaces: { program: 0, page: 0, channel: 0, "file-root": 0 }, liftedBareExpr: [] };
  const scanBody = (children: any[], surface: Surface) => {
    res.surfaces[surface]++;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (!c) continue;
      if (c.kind === "logic" && c._synthetic && surface !== "file-root") {
        for (const s of c.body || []) {
          // Source text by span — the native pipeline leaves `.expr` empty (it carries
          // the structured exprNode instead), so read both from the source.
          const txt = s && s.kind === "bare-expr" && s.span ? src.slice(s.span.start, s.span.end).trim() : "";
          if (txt !== "") res.liftedBareExpr.push({ line: s.span?.line ?? 0, expr: txt });
        }
      }
      if (c.kind !== "text") continue;
      // S441 — a declared `"..."` display-text literal is not a loose run.
      if (c._displayLiteral === true) { res.declaredLiterals++; continue; }
      const v: string = c.value ?? "";
      if (v.trim() === "") { res.wsRuns++; continue; }
      const baseLine = c.span?.line ?? 0;
      const lines: Line[] = [];
      const parts = v.split("\n");
      for (let k = 0; k < parts.length; k++) {
        const t = parts[k].trim();
        if (t === "") continue;
        lines.push({ line: baseLine + k, text: t, cls: classifyLine(t) });
      }
      const firstLine = lines[0].line, lastLine = lines[lines.length - 1].line;
      const prev = children[i - 1], next = children[i + 1];
      const interpAdjacent =
        (isInlineLogic(prev) && (prev.span?.line === firstLine || (prev.span?.line ?? -1) + 0 === baseLine) && !v.startsWith("\n")) ||
        (isInlineLogic(next) && next.span?.line === lastLine && !/\n\s*$/.test(v));
      const primary = primaryOf(lines);
      res.runs.push({ file: rel, surface, line: firstLine, lines, primary, interpAdjacent, fix: fixOf(primary) });
    }
  };
  const visit = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.kind === "markup") {
      const tag = n.tag;
      if (tag === "program" || tag === "page" || tag === "channel") scanBody(n.children || [], tag);
      for (const ch of n.children || []) visit(ch);
    }
  };
  // file root: top-level text outside any program/page/channel
  scanBody(nodes, "file-root");
  for (const n of nodes) visit(n);
  return res;
}

function parseLive(file: string, src: string) {
  const bs = splitBlocks(file, src);
  return buildAST(bs, null).ast;
}
function parseNative(file: string, src: string) {
  return nativeParseFile(file, src).ast;
}

// ---------------------------------------------------------------- main
const files: { abs: string; rel: string; root: string }[] = [];
for (const r of roots) {
  if (!existsSync(r)) { console.error(`# (skip missing root ${r})`); continue; }
  for (const f of walk(r)) {
    const rel = f.startsWith(ROOT) ? relative(ROOT, f) : relative(resolve(r, ".."), f);
    files.push({ abs: f, rel, root: r.startsWith(ROOT) ? relative(ROOT, r) : relative(resolve(r, ".."), r) });
  }
}

const pipelines = { live: parseLive, native: parseNative } as const;
type P = keyof typeof pipelines;
const results: Record<P, Map<string, FileResult>> = { live: new Map(), native: new Map() };
for (const { abs, rel } of files) {
  const src = readFileSync(abs, "utf8");
  for (const p of Object.keys(pipelines) as P[]) {
    try {
      const ast = pipelines[p](abs, src);
      results[p].set(rel, analyze(src, rel, ast?.nodes ?? []));
    } catch (e) {
      results[p].set(rel, { runs: [], wsRuns: 0, declaredLiterals: 0, surfaces: { program: 0, page: 0, channel: 0, "file-root": 0 }, liftedBareExpr: [], crash: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }
}

function pct(a: number, b: number) { return b ? ((100 * a) / b).toFixed(1) + "%" : "-"; }

const out: any = { files: files.length, roots: {} as Record<string, number>, pipelines: {} };
for (const f of files) out.roots[f.root] = (out.roots[f.root] || 0) + 1;

console.log(`# measure-loose-body-prose — S441 "prose must be DECLARED"`);
console.log(`# ${files.length} .scrml files`);
for (const [r, n] of Object.entries(out.roots)) console.log(`#   ${r}: ${n}`);

const SURF: Surface[] = ["program", "page", "channel", "file-root"];
for (const p of Object.keys(pipelines) as P[]) {
  const m = results[p];
  const all = [...m.values()];
  const runs = all.flatMap((r) => r.runs);
  const crashes = [...m.entries()].filter(([, r]) => r.crash);
  const pd: any = { crashes: crashes.length, surfaces: {}, bySurface: {} };
  console.log(`\n## pipeline: ${p === "live" ? "default (splitBlocks+buildAST)" : "--parser=scrml-native (nativeParseFile)"}`);
  console.log(`parse crashes: ${crashes.length}${crashes.length ? " — " + crashes.slice(0, 3).map(([f, r]) => `${f}: ${r.crash}`).join(" | ") : ""}`);
  for (const s of SURF) {
    const bodies = all.reduce((a, r) => a + r.surfaces[s], 0);
    const sr = runs.filter((r) => r.surface === s);
    const filesAff = new Set(sr.map((r) => r.file)).size;
    const ws = 0;
    const byPrimary: Record<string, number> = {};
    const byFix: Record<string, number> = {};
    const byLine: Record<string, number> = {};
    let interp = 0;
    for (const r of sr) {
      byPrimary[r.primary] = (byPrimary[r.primary] || 0) + 1;
      byFix[r.fix] = (byFix[r.fix] || 0) + 1;
      if (r.interpAdjacent) interp++;
      for (const l of r.lines) byLine[l.cls] = (byLine[l.cls] || 0) + 1;
    }
    const filesByFix: Record<string, number> = {};
    for (const fx of ["mechanical", "quoted", "human", "comment"]) filesByFix[fx] = new Set(sr.filter((r) => r.fix === fx).map((r) => r.file)).size;
    pd.bySurface[s] = { bodies, runs: sr.length, filesAffected: filesAff, byPrimary, byFix, filesByFix, byLine, interpAdjacent: interp };
    console.log(`\n### surface <${s}> — bodies scanned: ${bodies}; loose runs: ${sr.length}; files affected: ${filesAff}; interp-adjacent runs: ${interp}`);
    if (sr.length === 0) continue;
    console.log(`  run primary class : ` + Object.entries(byPrimary).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
    console.log(`  line class        : ` + Object.entries(byLine).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
    console.log(`  fix class (runs)  : ` + Object.entries(byFix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
    console.log(`  fix class (files) : ` + Object.entries(filesByFix).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("  "));
    const perRoot: Record<string, number> = {};
    for (const r of sr) { const root = files.find((f) => f.rel === r.file)?.root ?? "?"; perRoot[root] = (perRoot[root] || 0) + 1; }
    console.log(`  runs per root     : ` + Object.entries(perRoot).map(([k, v]) => `${k}=${v}`).join("  "));
  }
  const wsTotal = all.reduce((a, r) => a + r.wsRuns, 0);
  const lifted = all.flatMap((r) => r.liftedBareExpr.map((x) => ({ ...x })));
  const liftedFiles = [...m.entries()].filter(([, r]) => r.liftedBareExpr.length).map(([f, r]) => ({ f, r }));
  pd.whitespaceOnlyRuns = wsTotal;
  console.log(`\nwhitespace-only text nodes (excluded, formatting): ${wsTotal}`);
  console.log(`declared "..." display-text literals (S441; excluded, declared prose): ${all.reduce((a, r) => a + r.declaredLiterals, 0)}`);
  if (p === "live") {
    // Live only: the native builder's bare-expr spans / node-kind use differ (its
    // best-effort logic-body parse emits bare-expr for statements live types
    // precisely), so the native count is not comparable and is not reported.
    pd.liftedBareExpr = lifted.length;
    console.log(`bare-expr nodes already swallowed by the §40.8 lift (code today): ${lifted.length} in ${liftedFiles.length} files`);
    for (const { f, r } of liftedFiles) for (const x of r.liftedBareExpr) console.log(`    ${f}:${x.line}  ${JSON.stringify(x.expr).slice(0, 90)}`);
  }
  out.pipelines[p] = pd;
}

// cross-pipeline agreement (program+page+channel)
const key = (r: Run) => `${r.surface}:${r.line}:${r.primary}`;
let disagree: string[] = [];
for (const { rel } of files) {
  const a = (results.live.get(rel)?.runs ?? []).filter((r) => r.surface !== "file-root").map(key).sort().join("|");
  const b = (results.native.get(rel)?.runs ?? []).filter((r) => r.surface !== "file-root").map(key).sort().join("|");
  if (a !== b) disagree.push(rel);
}
out.pipelineDisagreementFiles = disagree;
console.log(`\n## live vs native: ${disagree.length} files differ in program/page/channel runs`);
for (const f of disagree.slice(0, 15)) {
  const a = (results.live.get(f)?.runs ?? []).filter((r) => r.surface !== "file-root").map(key);
  const b = (results.native.get(f)?.runs ?? []).filter((r) => r.surface !== "file-root").map(key);
  console.log(`  ${f}\n     live:   ${a.join(" ")}\n     native: ${b.join(" ")}`);
}

// examples (live pipeline, program/page/channel)
const liveRuns = [...results.live.values()].flatMap((r) => r.runs);
console.log(`\n## examples (default pipeline; up to ${nExamples} per class)`);
const byClass: Record<string, Run[]> = {};
for (const r of liveRuns) (byClass[r.primary] ||= []).push(r);
out.examples = {};
for (const [cls, rs] of Object.entries(byClass).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n### ${cls} (${rs.length} runs)`);
  // spread examples across files
  const seen = new Set<string>(); const picks: Run[] = [];
  for (const r of rs) { if (picks.length >= nExamples) break; const k = r.file + ":" + r.line; if (seen.has(k)) continue; seen.add(k); picks.push(r); }
  out.examples[cls] = picks.map((r) => ({ at: `${r.file}:${r.line}`, surface: r.surface, fix: r.fix, interp: r.interpAdjacent, text: r.lines.map((l) => l.text).join(" ⏎ ").slice(0, 160) }));
  for (const e of out.examples[cls]) console.log(`  ${e.at} <${e.surface}> [${e.fix}${e.interp ? ", interp" : ""}] ${JSON.stringify(e.text)}`);
}

// per-file listing (live) for the report
out.filesLive = {};
for (const [f, r] of results.live) if (r.runs.length) out.filesLive[f] = r.runs.map((x) => ({ line: x.line, surface: x.surface, primary: x.primary, fix: x.fix, text: x.lines.map((l) => l.text).join(" ⏎ ").slice(0, 200) }));

if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log(`\n# json -> ${jsonOut}`); }
