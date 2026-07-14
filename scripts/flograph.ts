// scripts/flograph.ts — flogence Project-Graph MVP (validation harness; runs against scrml's corpus).
//
// Spec: scrml-support/docs/flogence-graph-mvp-spec-2026-06-17.md
// House style mirrors scripts/state.ts + scripts/regen-spec-index.ts (plain bun-run TS, readFileSync,
// regex token parse, deterministic output, no timestamps so --check is stable).
//
// THIS IS A THROWAWAY VALIDATION HARNESS for the typed-edge + provenance VOCABULARY, run against
// scrml's own durable corpus (the richest project-graph test bed). The product is flogence-in-scrml;
// this proves the vocabulary cheaply first (see spec §6).
//
// MODES:
//   bun scripts/flograph.ts                  REPORT — node/edge counts + provenance sweep (stdout)
//   bun scripts/flograph.ts --emit           EMIT   — write docs/graph/graph.json + graph.mmd (@generated)
//   bun scripts/flograph.ts --check          CHECK  — dangling(WARN) + dup-id(ERROR) + drift(ERROR) + sweep(INFO); exit 1 on ERROR
//   bun scripts/flograph.ts --mmd            MMD    — print a SCOPED mermaid to stdout (the readable-view filter; S203)
//   bun scripts/flograph.ts --derivation <id> DERIVE — the cites/decided-by/supersedes provenance CHAIN of
//                                            <id>, both directions (S205 slice 4): RESTS-ON + SUPPORTS.
//   bun scripts/flograph.ts --with-support   add the live design corpus (deep-dives + design-insights)
//   bun scripts/flograph.ts --with-archive   ALSO add archive/deep-dives/ (the dereffed superseded tier) so
//                                            supersession + derivation LINEAGE resolves; live dir stays clean.
//   bun scripts/flograph.ts --corpus a,b,c   override the default corpus globs (for the fixture demo)
//
//   --mmd MODIFIERS (the full-corpus graph is unreadable at scale → scope it; canonical --emit stays FULL):
//     --filter k=v[,k=v]   keep nodes matching ALL predicates (k ∈ kind|status|sev). e.g. `--mmd --filter status=open`
//                          = the actionable open-work subgraph; `--mmd --filter sev=HIGH` = criticals only.
//     --focus <id> [--depth N]   keep <id> + its N-hop typed-edge neighborhood (default depth 1; both directions).
//                          combine with --filter to intersect (neighborhood ∩ predicates).
//
// DATA MODEL (spec §2):
//   node token : <!-- @node id=<id> kind=<kind> status=<status> [sev=<sev>] -->   (+ @gap alias → kind=gap)
//   edge       : [[<type>: <target>]]  typed (type ∈ blocks|supersedes|decided-by|cites)
//                [[<target>]]          untyped "relates"
//                [[<type>: <target> verified]]  + the single provenance bit (on decided-by|cites)
//   attribution: an edge belongs to the nearest-preceding @node in document order; else the file-node.
//   examples   : edge syntax inside a code fence OR an inline-code span (`[[...]]`) is NOT parsed —
//                a real edge is BARE [[type: target]]; backtick-wrapped is a syntax-reference.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const SUPPORT = `${ROOT}/../scrml-support`;

// ── Corpus (spec §2.4 durable tier) ─────────────────────────────────────────
// "scrml first" (S202 ruling): default = scrml's OWN durable docs only. The scrml-support design
// corpus (design-insights + deep-dives) is OPT-IN via --with-support (it adds ~230 doc-nodes of
// noise that drowns scrml's own graph). --corpus a,b,c overrides entirely.
export function defaultCorpus(
  withSupport = process.argv.includes("--with-support"),
  withArchive = process.argv.includes("--with-archive"),
): string[] {
  const files: string[] = [`${ROOT}/docs/known-gaps.md`, `${ROOT}/master-list.md`];
  // --with-archive implies the live design corpus too (you want history ON TOP of current, not instead).
  if (withSupport || withArchive) {
    const insights = `${SUPPORT}/design-insights.md`;
    if (existsSync(insights)) files.push(insights);
    const ddDir = `${SUPPORT}/docs/deep-dives`;
    if (existsSync(ddDir)) for (const f of readdirSync(ddDir)) if (f.endsWith(".md")) files.push(`${ddDir}/${f}`);
  }
  // --with-archive (S205): ALSO include the dereffed superseded tier (archive/deep-dives/) so the
  // supersession + derivation LINEAGE resolves as nodes (frontmatter status:superseded marks them). The
  // live DIRECTORY stays clean (the deref's goal — dev-agent navigation); this is a DIAGNOSTIC provenance
  // tier for currency/derivation queries. Completes the currency model: the sweep can now catch a LIVE
  // node citing an ARCHIVED (superseded) node — the ouroboros — with the archived docs as resolvable nodes.
  if (withArchive) {
    const archDir = `${SUPPORT}/archive/deep-dives`;
    if (existsSync(archDir)) for (const f of readdirSync(archDir)) if (f.endsWith(".md")) files.push(`${archDir}/${f}`);
  }
  return files.filter(existsSync);
}

const EDGE_TYPES = new Set(["blocks", "supersedes", "decided-by", "cites"]);
export const LOAD_BEARING = new Set(["resolved", "current"]); // statuses whose claims should be ground-truthed
export const SUPERSEDED = new Set(["superseded", "partially-superseded"]); // write-once-tier stale statuses (spec §2.1)

export type Node = { id: string; kind: string; status: string; sev: string | null; file: string; line: number };
export type Edge = { from: string; type: string; target: string; verified: boolean; file: string; line: number };

// ── Parse ────────────────────────────────────────────────────────────────────
const GAP_RE = /<!--\s*@gap\s+id=(\S+)\s+sev=(HIGH|MED|LOW|NOMINAL)\s+status=(\S+)\s*-->/;
const NODE_RE = /<!--\s*@node\s+([^>]*?)-->/;
const LINK_RE = /\[\[([^\]]+)\]\]/g;

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)=(\S+)/g)) out[m[1]] = m[2];
  return out;
}

function stem(file: string): string {
  return file.split("/").pop()!.replace(/\.md$/, "");
}

// Read the write-once-tier YAML frontmatter (spec §2.1): a doc's `status:` drives node currency, and
// `superseded-by:` is the authored INVERSE of a supersedes edge (the corpus records it on the OLD doc) —
// so we synthesize the supersedes edge FROM the named successor automatically. Zero manual annotation.
function parseFrontmatter(lines: string[]): { status: string | null; supersededBy: string | null; companions: string[] } {
  if ((lines[0] ?? "").trim() !== "---") return { status: null, supersededBy: null, companions: [] };
  let status: string | null = null, supersededBy: string | null = null;
  const companions: string[] = [];
  for (let i = 1; i < lines.length && i < 60; i++) {
    if (lines[i].trim() === "---") break;
    const s = lines[i].match(/^status:\s*(\S+)/); if (s && !status) status = s[1];
    // first `<stem>.md` in the value (handles path-prefixed, multi-target `A + B`, and prose forms)
    const sb = lines[i].match(/^superseded-by:.*?([A-Za-z0-9._-]+)\.md/); if (sb && !supersededBy) supersededBy = sb[1];
    // companion: → cites (the DERIVATION layer, S205 slice 4): "this doc builds alongside / docks INTO X".
    // The authored INVERSE-free derivation edge — same frontmatter-driven, zero-manual-annotation pattern
    // as superseded-by (§2.1). Multi-target (`A.md · B.md`) supported; targets not yet @node'd dangle (a
    // finding: the cited doc lives outside the graph corpus, e.g. a docs/ sibling not in deep-dives/).
    const cm = lines[i].match(/^companion:\s*(.+)/);
    if (cm) for (const m of cm[1].matchAll(/([A-Za-z0-9._-]+)\.md/g)) companions.push(m[1]);
  }
  return { status, supersededBy, companions };
}

function parseFile(file: string, nodes: Map<string, Node>, dupes: string[], edges: Edge[]) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  // Every file is implicitly a node (id = stem, kind=doc); its currency is the frontmatter `status:` (§2.1).
  const fm = parseFrontmatter(lines);
  const fileNode: Node = { id: stem(file), kind: "doc", status: fm.status ?? "current", sev: null, file, line: 1 };
  if (!nodes.has(fileNode.id)) nodes.set(fileNode.id, fileNode);
  // `superseded-by:` → a synthesized supersedes edge FROM the successor TO this (now-stale) doc.
  if (fm.supersededBy) edges.push({ from: fm.supersededBy, type: "supersedes", target: fileNode.id, verified: false, file, line: 1 });
  // `companion:` → a synthesized `cites` derivation edge FROM this doc TO each named companion (slice 4).
  for (const c of fm.companions) edges.push({ from: fileNode.id, type: "cites", target: c, verified: false, file, line: 1 });
  let current = fileNode.id;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }

    // node tokens — scanned regardless of fence so @gap count matches state.ts + defines boundaries
    const gap = line.match(GAP_RE);
    if (gap) {
      const n: Node = { id: gap[1], kind: "gap", status: gap[3], sev: gap[2], file, line: i + 1 };
      if (nodes.has(n.id) && nodes.get(n.id)!.kind !== "doc") dupes.push(`${n.id} (${rel(file)}:${i + 1})`);
      nodes.set(n.id, n);
      current = n.id;
      continue;
    }
    const node = line.match(NODE_RE);
    if (node) {
      const a = attrs(node[1]);
      if (a.id) {
        const n: Node = { id: a.id, kind: a.kind ?? "node", status: a.status ?? "current", sev: a.sev ?? null, file, line: i + 1 };
        if (nodes.has(n.id) && nodes.get(n.id)!.kind !== "doc") dupes.push(`${n.id} (${rel(file)}:${i + 1})`);
        nodes.set(n.id, n);
        current = n.id;
      }
      continue;
    }

    // edges — skip inside code fences AND inline-code spans, so edge syntax DISCUSSED as an
    // example (e.g. `[[decided-by: X]]` in a DD that is ABOUT the graph) is not parsed as a real
    // edge. CONVENTION: a real edge is BARE `[[type: target]]`; backtick-wrapped / fenced is a
    // syntax-reference, not an assertion. (Mirrors the existing scrml-support [[links]] style.)
    if (inFence) continue;
    const scanLine = line.replace(/`[^`]*`/g, "");
    for (const lm of scanLine.matchAll(LINK_RE)) {
      const inner = lm[1].trim();
      const colon = inner.indexOf(":");
      if (colon > 0 && EDGE_TYPES.has(inner.slice(0, colon).trim())) {
        const type = inner.slice(0, colon).trim();
        const rest = inner.slice(colon + 1).trim().split(/\s+/);
        const verified = rest[rest.length - 1] === "verified";
        const target = (verified ? rest.slice(0, -1) : rest).join(" ").trim();
        edges.push({ from: current, type, target, verified, file, line: i + 1 });
      } else {
        edges.push({ from: current, type: "relates", target: inner, verified: false, file, line: i + 1 });
      }
    }
  }
}

export function build(corpus: string[]) {
  const nodes = new Map<string, Node>();
  const dupes: string[] = [];
  const edges: Edge[] = [];
  for (const f of corpus) parseFile(f, nodes, dupes, edges);
  return { nodes, dupes, edges };
}

// ── Emit (deterministic; no timestamps) ───────────────────────────────────────
function sanitize(id: string): string { return "n_" + id.replace(/[^A-Za-z0-9_]/g, "_"); }

function toJson(nodes: Map<string, Node>, edges: Edge[]): string {
  const ns = [...nodes.values()].sort((a, b) => a.id < b.id ? -1 : 1);
  const es = [...edges].sort((a, b) => `${a.from}|${a.type}|${a.target}` < `${b.from}|${b.type}|${b.target}` ? -1 : 1);
  return JSON.stringify({ nodes: ns, edges: es }, null, 2) + "\n";
}

function toMermaid(nodes: Map<string, Node>, edges: Edge[]): string {
  const out: string[] = ["flowchart TD"];
  const ids = new Set(nodes.keys());
  for (const n of [...nodes.values()].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const label = `${n.id}<br/>${n.kind}·${n.status}${n.sev ? "·" + n.sev : ""}`;
    out.push(`  ${sanitize(n.id)}["${label}"]:::${n.status}`);
  }
  for (const e of [...edges].sort((a, b) => `${a.from}|${a.target}` < `${b.from}|${b.target}` ? -1 : 1)) {
    if (!ids.has(e.target)) continue; // dangling edges omitted from the render (listed in --check)
    if (e.type === "relates") continue; // untyped links omitted from the flowchart to keep topology legible
    const lbl = e.type + (e.verified ? " ✓" : "");
    out.push(`  ${sanitize(e.from)} -->|${lbl}| ${sanitize(e.target)}`);
  }
  out.push("classDef open fill:#fee,stroke:#c00;");
  out.push("classDef resolved fill:#efe,stroke:#0a0;");
  out.push("classDef current fill:#eef,stroke:#06c;");
  out.push("classDef doc fill:#f7f7f7,stroke:#999,stroke-dasharray:3;");
  return out.join("\n") + "\n";
}

// ── Scoped render (S203 — the full-corpus .mmd is unreadable at scale; this filters a READABLE
// subgraph to STDOUT). Applies ONLY to `--mmd`; the canonical `--emit` artifacts + `--check` drift
// gate + the `--report` state.ts round-trip stay FULL/unfiltered (deputy + gate depend on them). ──
type Scope = { kind?: string; status?: string; sev?: string };
function parseFilter(s: string | undefined): Scope {
  const out: Scope = {};
  if (!s) return out;
  for (const kv of s.split(",")) {
    const [k, v] = kv.split("=").map((x) => x.trim());
    if (k === "kind" || k === "status" || k === "sev") out[k] = v;
  }
  return out;
}
function nodeMatches(n: Node, f: Scope): boolean {
  if (f.kind && n.kind !== f.kind) return false;
  if (f.status && n.status !== f.status) return false;
  if (f.sev && n.sev !== f.sev) return false;
  return true;
}
// Attribute filter (keep nodes matching ALL of k=v) OR a focus node + N-hop typed-edge neighborhood
// (both directions; `relates` edges excluded so the topology stays the typed-edge graph). When both
// are given, the focus neighborhood is intersected with the attribute filter. Edges kept iff both
// endpoints are kept.
function applyScope(nodes: Map<string, Node>, edges: Edge[], f: Scope, focus: string | null, depth: number): { nodes: Map<string, Node>; edges: Edge[] } {
  const keep = new Set<string>();
  if (focus) {
    keep.add(focus);
    for (let d = 0; d < depth; d++) {
      let grew = false;
      for (const e of edges) {
        if (e.type === "relates") continue;
        if (keep.has(e.from) && !keep.has(e.target)) { keep.add(e.target); grew = true; }
        if (keep.has(e.target) && !keep.has(e.from)) { keep.add(e.from); grew = true; }
      }
      if (!grew) break;
    }
    if (f.kind || f.status || f.sev) for (const id of [...keep]) { const n = nodes.get(id); if (n && !nodeMatches(n, f)) keep.delete(id); }
  } else {
    for (const [id, n] of nodes) if (nodeMatches(n, f)) keep.add(id);
  }
  const sn = new Map<string, Node>();
  for (const id of keep) { const n = nodes.get(id); if (n) sn.set(id, n); }
  const se = edges.filter((e) => keep.has(e.from) && keep.has(e.target));
  return { nodes: sn, edges: se };
}
function mmdMode(corpus: string[], f: Scope, focus: string | null, depth: number): number {
  const { nodes, edges } = build(corpus);
  const scoped = (f.kind || f.status || f.sev || focus) ? applyScope(nodes, edges, f, focus, depth) : { nodes, edges };
  process.stderr.write(`flograph --mmd: ${scoped.nodes.size}/${nodes.size} nodes${focus ? ` (focus ${focus}, depth ${depth})` : ""}${(f.kind || f.status || f.sev) ? ` (filter ${[f.kind && "kind=" + f.kind, f.status && "status=" + f.status, f.sev && "sev=" + f.sev].filter(Boolean).join(",")})` : ""}\n`);
  process.stdout.write(toMermaid(scoped.nodes, scoped.edges));
  return 0;
}

// ── Derivation traversal (S205 slice 4 — the cites/derivation layer made QUERYABLE) ─────────
// Walks the PROVENANCE edge set {cites, decided-by, supersedes} from <id> in both directions:
//   RESTS ON  (outgoing) = what this node's content derives from / cites / supersedes;
//   SUPPORTS  (incoming) = what rests on / was decided-by / is superseded-by this node.
// This is the derivation-chain query the bare edge counts couldn't answer ("what does decision X
// rest on, transitively?"). Distinct from --focus (which walks ALL typed edges 1 hop); --derivation
// is provenance-only + transitive + directional.
const PROVENANCE = new Set(["cites", "decided-by", "supersedes"]);
function deriveMode(corpus: string[], id: string): number {
  const { nodes, edges } = build(corpus);
  if (!nodes.has(id)) { process.stderr.write(`flograph --derivation: '${id}' is not a node (try a @node id)\n`); return 1; }
  const prov = edges.filter(e => PROVENANCE.has(e.type));
  const status = (x: string) => nodes.has(x) ? nodes.get(x)!.status : "dangling — not a @node";
  function walk(dir: "out" | "in"): { id: string; via: string; depth: number }[] {
    const seen = new Set([id]); const order: { id: string; via: string; depth: number }[] = [];
    let frontier = [{ id, depth: 0 }];
    while (frontier.length) {
      const next: { id: string; depth: number }[] = [];
      for (const f of frontier) for (const e of prov) {
        const [a, b] = dir === "out" ? [e.from, e.target] : [e.target, e.from];
        if (a === f.id && !seen.has(b)) { seen.add(b); order.push({ id: b, via: e.type, depth: f.depth + 1 }); next.push({ id: b, depth: f.depth + 1 }); }
      }
      frontier = next;
    }
    return order;
  }
  console.log(`flograph --derivation: ${id}  [${status(id)}]`);
  const restsOn = walk("out");
  console.log(`  RESTS ON (${restsOn.length}) — what ${id} derives from:`);
  for (const r of restsOn) console.log(`    ${"  ".repeat(r.depth - 1)}└ ${r.via} → ${r.id} [${status(r.id)}]`);
  if (!restsOn.length) console.log(`    (no outgoing cites/decided-by/supersedes — no recorded basis)`);
  const supports = walk("in");
  console.log(`  SUPPORTS (${supports.length}) — what rests on ${id}:`);
  for (const s of supports) console.log(`    ${"  ".repeat(s.depth - 1)}└ ${s.via} ← ${s.id} [${status(s.id)}]`);
  if (!supports.length) console.log(`    (nothing recorded as resting on this node)`);
  return 0;
}

// ── Report ─────────────────────────────────────────────────────────────────
function report(corpus: string[]) {
  const { nodes, dupes, edges } = build(corpus);
  const byKind: Record<string, number> = {};
  const gapByStatusSev: Record<string, number> = {};
  for (const n of nodes.values()) {
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    if (n.kind === "gap") gapByStatusSev[`${n.sev} ${n.status}`] = (gapByStatusSev[`${n.sev} ${n.status}`] ?? 0) + 1;
  }
  const byType: Record<string, number> = {};
  for (const e of edges) byType[e.type] = (byType[e.type] ?? 0) + 1;

  console.log("flograph — project-graph report (MVP harness)");
  console.log(`  corpus: ${corpus.length} file(s)`);
  console.log(`  nodes:  ${nodes.size}  (${Object.entries(byKind).sort().map(([k, v]) => `${k}:${v}`).join(" ")})`);
  console.log(`  GAP round-trip (must match state.ts): HIGH open=${gapByStatusSev["HIGH open"] ?? 0} · MED open=${gapByStatusSev["MED open"] ?? 0} · LOW open=${gapByStatusSev["LOW open"] ?? 0}`);
  console.log(`  edges:  ${edges.length}  (${Object.entries(byType).sort().map(([k, v]) => `${k}:${v}`).join(" ")})`);

  const ids = new Set(nodes.keys());
  const dangling = edges.filter(e => !ids.has(e.target));
  console.log(`  dangling edges: ${dangling.length} (targets not yet @node — expected on an un-annotated corpus)`);

  const sweep = edges.filter(e => (e.type === "decided-by" || e.type === "cites") && !e.verified && LOAD_BEARING.has(nodes.get(e.from)?.status ?? ""));
  console.log(`  provenance sweep: ${sweep.length} load-bearing decided-by/cites edge(s) NOT verified (assert→verify candidates)`);

  const superseded = [...nodes.values()].filter(n => SUPERSEDED.has(n.status));
  console.log(`  superseded nodes: ${superseded.length} (write-once-tier docs marked stale via frontmatter)`);
  const currency = edges.filter(e => e.type !== "supersedes" && SUPERSEDED.has(nodes.get(e.target)?.status ?? "") && !SUPERSEDED.has(nodes.get(e.from)?.status ?? "current"));
  console.log(`  currency sweep: ${currency.length} edge(s) from a LIVE node into a SUPERSEDED node (references-stale-truth candidates)`);
  if (dupes.length) console.log(`  DUPLICATE node ids: ${dupes.length}`);
}

// ── Emit mode ─────────────────────────────────────────────────────────────
function emit(corpus: string[]): number {
  const { nodes, edges } = build(corpus);
  const dir = `${ROOT}/docs/graph`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/graph.json`, toJson(nodes, edges));
  writeFileSync(`${dir}/graph.mmd`, toMermaid(nodes, edges));
  console.log(`flograph --emit: wrote ${rel(dir)}/graph.json + graph.mmd (${nodes.size} nodes, ${edges.length} edges)`);
  return 0;
}

// ── Check mode ─────────────────────────────────────────────────────────────
function check(corpus: string[]): number {
  const { nodes, dupes, edges } = build(corpus);
  const ids = new Set(nodes.keys());
  let errors = 0;
  console.log("flograph --check");

  // 1. duplicate id → ERROR
  if (dupes.length) { errors += dupes.length; for (const d of dupes) console.log(`  ERROR  duplicate node id: ${d}`); }

  // 2. dangling edge → WARN (honors [[name]]-as-todo)
  const dangling = edges.filter(e => !ids.has(e.target));
  for (const e of dangling.slice(0, 12)) console.log(`  WARN   dangling [[${e.type === "relates" ? "" : e.type + ": "}${e.target}]] in ${rel(e.file)}:${e.line} (target not a @node)`);
  if (dangling.length > 12) console.log(`  WARN   … +${dangling.length - 12} more dangling edges`);

  // 3. drift → ERROR (only if the artifacts exist on disk)
  const jf = `${ROOT}/docs/graph/graph.json`, mf = `${ROOT}/docs/graph/graph.mmd`;
  if (existsSync(jf) && readFileSync(jf, "utf8") !== toJson(nodes, edges)) { errors++; console.log(`  ERROR  docs/graph/graph.json stale — run \`bun scripts/flograph.ts --emit\``); }
  if (existsSync(mf) && readFileSync(mf, "utf8") !== toMermaid(nodes, edges)) { errors++; console.log(`  ERROR  docs/graph/graph.mmd stale — run \`bun scripts/flograph.ts --emit\``); }

  // 4. provenance sweep → INFO (non-gating)
  const sweep = edges.filter(e => (e.type === "decided-by" || e.type === "cites") && !e.verified && LOAD_BEARING.has(nodes.get(e.from)?.status ?? ""));
  for (const e of sweep.slice(0, 12)) console.log(`  INFO   ${e.from} [[${e.type}: ${e.target}]] is asserted, not verified (${rel(e.file)}:${e.line})`);
  if (sweep.length > 12) console.log(`  INFO   … +${sweep.length - 12} more assert→verify candidates`);

  // 5. currency sweep → INFO (a LIVE node references a SUPERSEDED node = citing stale truth; the ouroboros catch)
  const currency = edges.filter(e => e.type !== "supersedes" && SUPERSEDED.has(nodes.get(e.target)?.status ?? "") && !SUPERSEDED.has(nodes.get(e.from)?.status ?? "current"));
  for (const e of currency.slice(0, 12)) console.log(`  INFO   ${e.from} [[${e.type === "relates" ? "" : e.type + ": "}${e.target}]] references SUPERSEDED ${e.target} (${rel(e.file)}:${e.line})`);
  if (currency.length > 12) console.log(`  INFO   … +${currency.length - 12} more references-stale-truth`);

  console.log(`  ${errors ? "FAIL" : "PASS"} — ${dupes.length} dup · ${dangling.length} dangling(warn) · ${sweep.length} unverified · ${currency.length} stale-ref (info) · ${errors} error(s)`);
  return errors ? 1 : 0;
}

export function rel(abs: string): string { return abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : abs.replace(SUPPORT + "/", "../scrml-support/"); }

export function globSync(pat: string): string[] {
  const dir = pat.slice(0, pat.lastIndexOf("/"));
  const re = new RegExp("^" + pat.slice(pat.lastIndexOf("/") + 1).replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$");
  return existsSync(dir) ? readdirSync(dir).filter(f => re.test(f)).map(f => `${dir}/${f}`) : [];
}

// ── main (guarded so dock.ts can `import { build, defaultCorpus } from "./flograph"` without
//    triggering this dispatch — S205 dock-thin-build refactor) ───────────────────────────────
// #dock[ cites=agentic-code-provenance-dock-2026-06-17 · verified ]
if (import.meta.main) {
  const args = process.argv.slice(2);
  const cIdx = args.indexOf("--corpus");
  const corpus = cIdx >= 0 ? args[cIdx + 1].split(",").map(p => p.startsWith("/") ? p : `${ROOT}/${p}`) : defaultCorpus();
  const expandedCorpus = corpus.flatMap(p => p.includes("*") ? globSync(p) : [p]).filter(existsSync);

  const fIdx = args.indexOf("--filter");
  const filter = parseFilter(fIdx >= 0 ? args[fIdx + 1] : undefined);
  const focIdx = args.indexOf("--focus");
  const focus = focIdx >= 0 ? args[focIdx + 1] : null;
  const depIdx = args.indexOf("--depth");
  const depth = depIdx >= 0 ? (parseInt(args[depIdx + 1], 10) || 1) : 1;

  const derIdx = args.indexOf("--derivation");

  if (args.includes("--emit")) process.exit(emit(expandedCorpus));
  else if (args.includes("--check")) process.exit(check(expandedCorpus));
  else if (args.includes("--mmd")) process.exit(mmdMode(expandedCorpus, filter, focus, depth));
  else if (derIdx >= 0) process.exit(deriveMode(expandedCorpus, args[derIdx + 1]));
  else report(expandedCorpus);
}
