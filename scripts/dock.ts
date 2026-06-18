// scripts/dock.ts — flogeance agentic CODE-PROVENANCE DOCK checker (thin slice; RIDES flograph).
//
// Design: scrml-support/docs/deep-dives/agentic-code-provenance-dock-2026-06-17.md (ADOPTED S202).
// Companion: scripts/flograph.ts (the doc-side checker this docks INTO — we resolve dock edges against
// its @node graph, exactly as flograph resolves [[edges]] against @node tokens).
//
// THROWAWAY VALIDATION HARNESS for the #dock token + edge-resolution VOCABULARY, run against scrml's OWN
// code (the richest live code-graph test bed). The product is the dock built in flogeance-in-scrml; this
// proves the vocabulary cheaply first — same "scrml-first" play as flograph (DD frontmatter: "build the
// thin version riding the doc-side checker (flograph)").
//
// "STORE THE EDGE, NOT THE STATE" (converged-core #1): the code holds a live POINTER (#dock[…]); the
// flograph NODE holds the how/why state; this checker resolves pointer→live-node. Rot-proof because the
// only thing in code is the edge — the node's status (open/resolved/superseded) lives on the node.
//
// THIN SLICE (S205) — the two invariants that ride flograph DIRECTLY (DD open #4):
//   inv 2  edge → LIVE node : every implements/decided-by/cites target is a known flograph @node;
//          read its status. dangling target = WARN; edge into a SUPERSEDED node = WARN (the
//          "show me code grounded in a stale decision" surface — converged-core #2).
//   inv 4  provenance sweep : load-bearing decided-by/cites edges NOT `verified` = INFO (converged-core #6).
//   (a malformed/empty #dock[…] is an ERROR — the only gating class day-one.)
// DEFERRED to a later slice (need a per-language definition-walker; DD open #1/#3):
//   inv 1  coverage          : every named definition carries a dock (or a `chore` dock).
//   inv 3  boundary coherence: the dock is attached to a real parseable definition (not orphaned).
//
// TRUTH CEILING (DD open #4, stated not buried): this verifies PRESENCE + RESOLUTION, never TRUTH. A dock
// can be well-formed, resolve to a live node, carry `verified`, and still be WRONG about why the code looks
// the way it does. The dock makes reasoning queryable + its verification-status visible — navigable, not
// authoritative (mirrors flograph's design principle).
//
// MODES:
//   bun scripts/dock.ts                 REPORT   — dock/edge counts + resolution + sweep (stdout)
//   bun scripts/dock.ts --check         CHECK    — malformed(ERROR) + dangling/superseded-target(WARN) + sweep(INFO); exit 1 on ERROR
//   bun scripts/dock.ts --coverage      COVERAGE — scrml-definition coverage (inv1) + orphaned docks (inv3); over .scrml
//   bun scripts/dock.ts --corpus a,b    override the default corpus (code globs for report/check; .scrml dirs/globs for --coverage)
//
// TOKEN (DD open #5 Approach A — inline dev-only, the @gap precedent; `·`-separated fields):
//   #dock[ implements=<node> · decided-by=<node> · cites=<node> · verified ]
//   #dock[ chore ]   — the cheap escape: no decision edge, declares "no reasoning here" (filterable out)
//   edges: implements|decided-by|cites = a flograph @node id ; bare `verified` = the dock-level grounding bit.

import { existsSync, readdirSync } from "fs";
import { readFileSync } from "fs";
import { build, defaultCorpus, SUPERSEDED, globSync, rel, type Node } from "./flograph.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Default CODE corpus: scrml's own scripts (small, self-referential — dog-foods on flograph.ts/dock.ts/
// state.ts). Override with --corpus for a wider sweep. (The thin slice intentionally does NOT default to
// the whole compiler/src tree — coverage (inv 1) is deferred, so a wide scan would only find the few
// hand-authored docks anyway.)
const DEFAULT_CODE_CORPUS = [`${ROOT}/scripts/*.ts`];

const DOCK_EDGE_TYPES = new Set(["implements", "decided-by", "cites"]);
const SWEEP_TYPES = new Set(["decided-by", "cites"]); // the load-bearing grounding edges (DD inv 4)
const CHORE_FLAGS = new Set(["chore", "mechanical"]);
const DOCK_RE = /#dock\[([^\]]*)\]/g;

type DockEdge = { type: string; target: string };
type Dock = {
  file: string; line: number; raw: string;
  edges: DockEdge[]; verified: boolean; chore: boolean;
  malformed: string | null; // non-null → a structural error (empty, no edges + not chore, unknown field)
};

// ── Parse ────────────────────────────────────────────────────────────────────
function parseDock(inner: string, file: string, line: number, raw: string): Dock {
  const dock: Dock = { file, line, raw, edges: [], verified: false, chore: false, malformed: null };
  const fields = inner.split("·").map(f => f.trim()).filter(Boolean);
  if (fields.length === 0) { dock.malformed = "empty #dock[]"; return dock; }
  const unknown: string[] = [];
  for (const f of fields) {
    if (f === "verified") { dock.verified = true; continue; }
    if (CHORE_FLAGS.has(f)) { dock.chore = true; continue; }
    const eq = f.indexOf("=");
    if (eq > 0) {
      const key = f.slice(0, eq).trim();
      const val = f.slice(eq + 1).trim();
      if (DOCK_EDGE_TYPES.has(key) && val) { dock.edges.push({ type: key, target: val }); continue; }
    }
    unknown.push(f);
  }
  if (unknown.length) dock.malformed = `unknown field(s): ${unknown.join(", ")}`;
  else if (dock.edges.length === 0 && !dock.chore) dock.malformed = "no edge and not `chore`";
  return dock;
}

function scan(corpus: string[]): Dock[] {
  const docks: Dock[] = [];
  for (const file of corpus) {
    // Never scan the token-definer's own source: dock.ts is FULL of `#dock[…]` grammar examples +
    // string literals (e.g. the "empty #dock[]" diagnostic) that are syntax-references, not real docks.
    // (flograph sidesteps the analogous problem for free — it scans the DOC corpus, never its own .ts.)
    if (file.endsWith("scripts/dock.ts")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      // A real dock is a `#dock[…]` token in COMMENT position (the @gap precedent: an inline metadata
      // token, canonically a standalone comment line on/above the definition — DD open #5 Approach A).
      // Thin-slice heuristic: require the token to be the first non-trivial content of the line (after
      // an optional comment marker `//` `#` `*` `<!--`), which excludes mid-line string-literal mentions
      // in OTHER files without a full comment-vs-string parse. (Comment-context precision deferred.)
      if (!/^\s*(?:\/\/+|#+(?!dock)|\*+|<!--)?\s*#dock\[/.test(lines[i])) continue;
      for (const m of lines[i].matchAll(DOCK_RE)) {
        docks.push(parseDock(m[1], file, i + 1, m[0]));
      }
    }
  }
  return docks;
}

// ── Resolve dock edges against the flograph node graph (the "riding") ──────────
function nodeGraph(): Map<string, Node> {
  // resolve against the FULL graph (with-support) — dock edges naturally point at DD / insight / gap nodes
  // that live in the scrml-support design corpus.
  return build(defaultCorpus(true)).nodes;
}

type Resolved = { dock: Dock; edge: DockEdge; node: Node | undefined };
function resolveEdges(docks: Dock[], nodes: Map<string, Node>): Resolved[] {
  const out: Resolved[] = [];
  for (const d of docks) for (const e of d.edges) out.push({ dock: d, edge: e, node: nodes.get(e.target) });
  return out;
}

// ── Report ─────────────────────────────────────────────────────────────────
function report(corpus: string[]) {
  const docks = scan(corpus);
  const nodes = nodeGraph();
  const resolved = resolveEdges(docks, nodes);

  const real = docks.filter(d => !d.chore && !d.malformed);
  const byType: Record<string, number> = {};
  for (const r of resolved) byType[r.edge.type] = (byType[r.edge.type] ?? 0) + 1;
  const dangling = resolved.filter(r => !r.node);
  const supersededTarget = resolved.filter(r => r.node && SUPERSEDED.has(r.node.status));
  const sweep = resolved.filter(r => SWEEP_TYPES.has(r.edge.type) && !r.dock.verified && r.node);
  const malformed = docks.filter(d => d.malformed);

  console.log("dock — code-provenance report (thin slice; rides flograph)");
  console.log(`  corpus:   ${corpus.length} code file(s) · ${nodes.size} flograph nodes (resolution graph)`);
  console.log(`  docks:    ${docks.length}  (real:${real.length} chore:${docks.filter(d => d.chore).length} malformed:${malformed.length})`);
  console.log(`  edges:    ${resolved.length}  (${Object.entries(byType).sort().map(([k, v]) => `${k}:${v}`).join(" ") || "none"})`);
  console.log(`  inv2 dangling edges:    ${dangling.length} (target not a flograph @node)`);
  console.log(`  inv2 superseded-target: ${supersededTarget.length} (code grounded in a SUPERSEDED decision — stale-truth)`);
  console.log(`  inv4 provenance sweep:  ${sweep.length} load-bearing decided-by/cites edge(s) NOT verified (assert→verify candidates)`);
  if (malformed.length) console.log(`  MALFORMED docks:        ${malformed.length}`);
}

// ── Check ────────────────────────────────────────────────────────────────────
function check(corpus: string[]): number {
  const docks = scan(corpus);
  const nodes = nodeGraph();
  const resolved = resolveEdges(docks, nodes);
  let errors = 0;
  console.log("dock --check");

  // malformed → ERROR (the only gating class day-one)
  for (const d of docks.filter(x => x.malformed)) { errors++; console.log(`  ERROR  malformed dock (${d.malformed}): ${d.raw} in ${rel(d.file)}:${d.line}`); }

  // inv 2a dangling → WARN
  const dangling = resolved.filter(r => !r.node);
  for (const r of dangling.slice(0, 12)) console.log(`  WARN   dangling #dock edge [${r.edge.type}=${r.edge.target}] in ${rel(r.dock.file)}:${r.dock.line} (target not a flograph @node)`);
  if (dangling.length > 12) console.log(`  WARN   … +${dangling.length - 12} more dangling dock edges`);

  // inv 2b edge into a SUPERSEDED node → WARN (the stale-decision / ouroboros catch over CODE)
  const stale = resolved.filter(r => r.node && SUPERSEDED.has(r.node.status));
  for (const r of stale.slice(0, 12)) console.log(`  WARN   #dock [${r.edge.type}=${r.edge.target}] grounds code in SUPERSEDED ${r.edge.target} (${rel(r.dock.file)}:${r.dock.line})`);
  if (stale.length > 12) console.log(`  WARN   … +${stale.length - 12} more superseded-target dock edges`);

  // inv 4 provenance sweep → INFO (non-gating)
  const sweep = resolved.filter(r => SWEEP_TYPES.has(r.edge.type) && !r.dock.verified && r.node);
  for (const r of sweep.slice(0, 12)) console.log(`  INFO   #dock [${r.edge.type}=${r.edge.target}] is asserted, not verified (${rel(r.dock.file)}:${r.dock.line})`);
  if (sweep.length > 12) console.log(`  INFO   … +${sweep.length - 12} more assert→verify candidates`);

  console.log(`  ${errors ? "FAIL" : "PASS"} — ${docks.filter(d => d.malformed).length} malformed · ${dangling.length} dangling(warn) · ${stale.length} superseded-target(warn) · ${sweep.length} unverified(info) · ${errors} error(s)`);
  return errors ? 1 : 0;
}

// ── Coverage walker (S205 dock slice 2 — inv1 coverage + inv3 boundary, over scrml .scrml defs) ──
// The INVERSE of the edge-checker: instead of "which docks resolve?", ask "which DEFINITIONS carry a
// dock?". A reasoning-unit (DD open #1) is a NAMED scrml definition — engine / component / fn|function /
// type / channel. The scrml dock form is a `// #dock[…]` COMMENT on/just-above the definition (scrml
// comments are non-emitted, so no strip-at-build is needed for this form — DD open #5 Approach A).
//   inv1 coverage         : a definition is "docked" iff a #dock sits within [defLine-2, defLine]. → WARN.
//   inv3 boundary coherence: a #dock with NO definition within [dockLine, dockLine+2] is ORPHANED. → WARN.
// Deliberately scopes to the SUBSTANTIVE definition forms (not every `<x>=0` state cell — that is part of
// its enclosing unit, and the `chore` escape covers genuinely-reasonless code). Thin regex extraction —
// no scrml-parser integration (stays a harness; flogeance-in-scrml uses the real parser later).
const SCRML_DEFS: { kind: string; re: RegExp }[] = [
  { kind: "engine",    re: /<engine\b[^>]*?\b(?:for|var)=\.?(\w+)/ },
  { kind: "channel",   re: /<channel\b[^>]*?\bname=["']?(\w+)/ },
  { kind: "function",  re: /^\s*(?:export\s+)?(?:server\s+)?(?:function|fn)\s+(\w+)\s*\(/ },
  { kind: "type",      re: /^\s*(?:export\s+)?type\s+(\w+)\s*:/ },
  { kind: "component", re: /^\s*(?:export\s+)?const\s+([A-Z]\w*)\s*=\s*</ },
  { kind: "component", re: /^\s*export\s+<([A-Z]\w*)/ },
];

type Def = { kind: string; name: string; file: string; line: number };
function extractDefs(file: string): Def[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const defs: Def[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const p of SCRML_DEFS) {
      const m = lines[i].match(p.re);
      if (m) { defs.push({ kind: p.kind, name: m[1] ?? "(anon)", file, line: i + 1 }); break; }
    }
  }
  return defs;
}

function findScrml(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root, { recursive: true }) as string[]) if (f.endsWith(".scrml")) out.push(`${root}/${f}`);
  }
  return out;
}

function coverageMode(corpus: string[]): number {
  const docks = scan(corpus);
  const docksByFile = new Map<string, number[]>();
  for (const d of docks) { const a = docksByFile.get(d.file) ?? []; a.push(d.line); docksByFile.set(d.file, a); }

  let totalDefs = 0, docked = 0;
  const byKind: Record<string, { n: number; docked: number }> = {};
  const defLineByFile = new Map<string, Set<number>>();
  for (const file of corpus) {
    const defs = extractDefs(file);
    const dlines = docksByFile.get(file) ?? [];
    const ds = new Set<number>(); defLineByFile.set(file, ds);
    for (const def of defs) {
      ds.add(def.line);
      totalDefs++;
      byKind[def.kind] ??= { n: 0, docked: 0 }; byKind[def.kind].n++;
      if (dlines.some(dl => dl >= def.line - 2 && dl <= def.line)) { docked++; byKind[def.kind].docked++; }
    }
  }
  // inv3: a dock with no definition within [dockLine, dockLine+2] is orphaned (boundary-incoherent).
  const orphans = docks.filter(dk => { const s = defLineByFile.get(dk.file); return !s || ![dk.line, dk.line + 1, dk.line + 2].some(l => s.has(l)); });
  const pct = totalDefs ? (100 * docked / totalDefs).toFixed(1) + "%" : "n/a";

  console.log("dock --coverage (scrml definitions; inv1 coverage + inv3 boundary)");
  console.log(`  corpus:  ${corpus.length} .scrml file(s)`);
  console.log(`  defs:    ${totalDefs}  (${Object.entries(byKind).sort().map(([k, v]) => `${k}:${v.docked}/${v.n}`).join(" ") || "none found"})`);
  console.log(`  inv1 coverage:        ${docked}/${totalDefs} definitions docked (${pct})`);
  console.log(`  inv3 orphaned docks:  ${orphans.length} (#dock not adjacent to a definition)`);
  for (const o of orphans.slice(0, 8)) console.log(`         orphan: ${o.raw} in ${rel(o.file)}:${o.line}`);
  return 0;
}

// ── main ──────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2);
  const cIdx = args.indexOf("--corpus");
  const override = cIdx >= 0 ? args[cIdx + 1].split(",").map(p => p.startsWith("/") ? p : `${ROOT}/${p}`) : null;

  if (args.includes("--coverage")) {
    // default scrml corpus = real authored scrml (stdlib + examples); --corpus overrides (recursive).
    const roots = override ?? [`${ROOT}/stdlib`, `${ROOT}/examples`];
    const scrmlCorpus = override ? override.flatMap(p => p.includes("*") ? globSync(p) : (p.endsWith(".scrml") ? [p] : findScrml([p]))).filter(existsSync) : findScrml(roots);
    process.exit(coverageMode(scrmlCorpus));
  }

  const corpus = (override ?? DEFAULT_CODE_CORPUS).flatMap(p => p.includes("*") ? globSync(p) : [p]).filter(existsSync);
  if (args.includes("--check")) process.exit(check(corpus));
  else report(corpus);
}
