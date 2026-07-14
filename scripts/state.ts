// scripts/state.ts — DD3 Fork 3A/3B/4. change-id: dd3-state-self-evidence-2026-06-07
// #dock[ implements=project-state-self-evidence-2026-06-07 · verified ]
//
// THREE MODES (single source of truth = the @gap tokens + git/fs; derive-don't-declare):
//   `bun scripts/state.ts`         PRINT  — read-only "state at HEAD" report to stdout (Fork 3A).
//   `bun scripts/state.ts --write` WRITE  — in-place-regenerate every `@generated:*` section in the
//                                           docs from the same derive functions (Fork 3B). Idempotent.
//   `bun scripts/state.ts --check` CHECK  — regenerate every `@generated:*` section in memory + compare
//                                           to on-disk; exit 1 on any stale section (Fork 4). Maps-behind
//                                           is WARN-only (maps are refreshed by project-mapper, a
//                                           different seam — see GEN policy note below; a future pa.md
//                                           wrap-gate calls this).
// Run with Bun. Dependency-free (Bun built-ins only).
//
// House style mirrors scripts/regen-spec-index.ts (plain bun-run TS, readFileSync, anchor find/replace).
//
// COUNT BASIS (the whole point of DD3 Fork 2 — see docs/known-gaps.md §0 "Count basis" legend):
//   Every gap in docs/known-gaps.md carries a grep token
//     <!-- @gap id=<id> sev=<HIGH|MED|LOW|NOMINAL> status=<open|resolved|deferred|nominal|non-gap|forensic> -->
//   Headline counts derive ONLY from these tokens:
//     HIGH/MED/LOW open = `sev=<SEV> status=open`
//     Nominal line      = `sev=NOMINAL status=nominal`
//   Everything else (resolved/deferred/non-gap/forensic, and a non-NOMINAL status=nominal such as the
//   framing-corrected Bug 10) is excluded — those are the four entries a human silently discounts.
//   The §R28/§R27 cluster-table OPEN rows DO count (their tokens live inline in each row's final cell).
//   This reproduces the canonical S170 hand-count HIGH 0 · MED 9 · LOW 18 · Nominal 9.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

function sh(cmd: string, args: string[]): { stdout: string; stderr: string; ok: boolean } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", ok: r.status === 0 };
}

// ── Gap counts (from @gap tokens) ──────────────────────────────────────────
function gapCounts() {
  const text = readFileSync(`${ROOT}/docs/known-gaps.md`, "utf8");
  const re = /<!--\s*@gap\s+id=(\S+)\s+sev=(HIGH|MED|LOW|NOMINAL)\s+status=(open|resolved|deferred|nominal|non-gap|forensic)\s*-->/g;
  const tokens: { id: string; sev: string; status: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ id: m[1], sev: m[2], status: m[3] });
  const openBy = (sev: string) => tokens.filter((t) => t.sev === sev && t.status === "open").length;
  const high = openBy("HIGH");
  const med = openBy("MED");
  const low = openBy("LOW");
  const nominal = tokens.filter((t) => t.sev === "NOMINAL" && t.status === "nominal").length;
  return { tokens, high, med, low, nominal };
}

// ── Generated-section registry (Fork 3B/4) ──────────────────────────────────
// Each entry names a doc file + an anchor NAME and a `produce()` that returns the BETWEEN-content
// (the text the rewriter places between the START/END markers). The same derive functions feed
// both PRINT and WRITE/CHECK, so the doc artifact can never silently diverge from the report.
//
// Anchor convention (mirrors regen-spec-index.ts determinism):
//   <!-- @generated:<NAME> START (do not edit — `bun scripts/state.ts --write`) -->
//   ...generated content...
//   <!-- @generated:<NAME> END -->
type GenSection = { name: string; file: string; produce: () => string };

const GEN_SECTIONS: GenSection[] = [
  {
    name: "gap-counts",
    file: `${ROOT}/docs/known-gaps.md`,
    // The §0 at-a-glance table's four data rows — derived from the @gap tokens, so they always
    // equal what PRINT reports. Header + separator + the "Count basis" legend stay STATIC (hand-doc).
    produce: () => {
      const g = gapCounts();
      return [
        `| HIGH | ${g.high} |`,
        `| MED | ${g.med} |`,
        `| LOW | ${g.low} |`,
        `| Nominal (spec-ahead-of-impl) | ${g.nominal} |`,
      ].join("\n");
    },
  },
  {
    name: "recent-sessions",
    file: `${ROOT}/master-list.md`,
    // The master-list §0.6 generated index — last-N wrap anchors + push-state + tag-cut (DD3 Fork 1,
    // S173). Per-session narrative lives in docs/changelog.md (the ONE narrative SoT); this is the
    // startup-load-bearing forensic index only.
    produce: () => recentSessions(8),
  },
];

// Find the START/END anchor pair for NAME in `text`. Returns the byte offsets of the content
// region (between the START line's trailing newline and the END line's leading newline) plus the
// current between-content, or null if either marker is missing.
type AnchorSpan = { betweenStart: number; betweenEnd: number; current: string };
function findAnchorSpan(text: string, name: string): AnchorSpan | null {
  // START marker may carry the parenthetical "(do not edit …)" tail; match the prefix only.
  const startRe = new RegExp(`<!--\\s*@generated:${escapeRe(name)}\\s+START\\b[^>]*-->`);
  const endRe = new RegExp(`<!--\\s*@generated:${escapeRe(name)}\\s+END\\b[^>]*-->`);
  const sm = startRe.exec(text);
  if (!sm) return null;
  const em = endRe.exec(text);
  if (!em) return null;
  const startMarkerEnd = sm.index + sm[0].length;
  const endMarkerStart = em.index;
  if (endMarkerStart < startMarkerEnd) return null; // END before START → malformed
  // Content lives between the newline after START and the newline before END.
  // Handle BOTH LF and CRLF (Windows): skip a leading "\r\n" as one unit, else a
  // lone "\r" after START leaves the generated block spliced onto the marker line.
  let betweenStart = startMarkerEnd;
  if (text[betweenStart] === "\r") betweenStart += 1;
  if (text[betweenStart] === "\n") betweenStart += 1;
  let betweenEnd = endMarkerStart;
  if (text[betweenEnd - 1] === "\n") betweenEnd -= 1;
  if (text[betweenEnd - 1] === "\r") betweenEnd -= 1;
  return { betweenStart, betweenEnd, current: text.slice(betweenStart, betweenEnd) };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalize CRLF→LF so cross-platform (Windows CRLF vs LF) content compares equal.
function eolNorm(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

// Regenerate one section's content in-place within `text`. Returns the new text + whether it
// changed, or null if the anchor pair is missing (caller reports, does not crash).
function regenInText(text: string, sec: GenSection): { text: string; changed: boolean } | null {
  const span = findAnchorSpan(text, sec.name);
  if (!span) return null;
  // Emit the generated block in the file's own EOL so a CRLF (Windows) doc stays
  // CRLF; compare EOL-normalized so a CRLF file is not perpetually reported stale.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const fresh = sec.produce().replace(/\r\n/g, "\n").replace(/\n/g, eol);
  if (eolNorm(span.current) === eolNorm(fresh)) return { text, changed: false };
  const next = text.slice(0, span.betweenStart) + fresh + text.slice(span.betweenEnd);
  return { text: next, changed: true };
}

// ── WRITE mode (Fork 3B) ─────────────────────────────────────────────────────
function runWrite(): number {
  // Group sections by file so each file is read/written once (idempotent across multiple sections).
  const byFile = new Map<string, GenSection[]>();
  for (const s of GEN_SECTIONS) {
    const arr = byFile.get(s.file) ?? [];
    arr.push(s);
    byFile.set(s.file, arr);
  }
  let anyChanged = false;
  const missing: string[] = [];
  for (const [file, secs] of byFile) {
    let text = readFileSync(file, "utf8");
    let fileChanged = false;
    for (const sec of secs) {
      const r = regenInText(text, sec);
      if (r === null) {
        missing.push(`@generated:${sec.name} (in ${rel(file)})`);
        continue;
      }
      if (r.changed) {
        text = r.text;
        fileChanged = true;
        console.log(`  regenerated @generated:${sec.name} in ${rel(file)}`);
      } else {
        console.log(`  @generated:${sec.name} already current in ${rel(file)}`);
      }
    }
    if (fileChanged) {
      writeFileSync(file, text);
      anyChanged = true;
    }
  }
  if (missing.length) {
    console.log("");
    console.log("⚠ MISSING anchor pair(s) — not regenerated:");
    for (const m of missing) console.log(`  ${m}`);
  }
  console.log("");
  console.log(anyChanged ? "--write: sections regenerated." : "--write: no changes (already current).");
  // Missing anchors are a report, not a crash (per brief); WRITE still exits 0.
  return 0;
}

// ── CHECK mode (Fork 4) ──────────────────────────────────────────────────────
// Regenerate every @generated section in memory + compare to on-disk. FAIL (exit 1) on any stale
// section OR any missing anchor pair. Maps-behind is WARN-ONLY: maps are refreshed by project-mapper
// (a different seam), so the future pa.md wrap-gate should NOT block doc-currency on map staleness —
// it prints the maps line for visibility but does not gate on it yet. (TODO future pa.md wrap-gate:
// decide whether to promote maps-behind to a hard fail once map-refresh joins the wrap flow.)
function runCheck(): number {
  const stale: string[] = [];
  const missing: string[] = [];
  const ok: string[] = [];
  // Read each file once.
  const fileText = new Map<string, string>();
  for (const sec of GEN_SECTIONS) {
    if (!fileText.has(sec.file)) fileText.set(sec.file, readFileSync(sec.file, "utf8"));
    const text = fileText.get(sec.file)!;
    const span = findAnchorSpan(text, sec.name);
    if (!span) {
      missing.push(`@generated:${sec.name} (in ${rel(sec.file)})`);
      continue;
    }
    const fresh = sec.produce();
    if (eolNorm(span.current) === eolNorm(fresh)) ok.push(`@generated:${sec.name} (${rel(sec.file)})`);
    else stale.push(`@generated:${sec.name} (${rel(sec.file)})`);
  }

  const maps = mapsStaleness();
  const failed = stale.length > 0 || missing.length > 0;

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  bun scripts/state.ts --check  —  @generated currency gate");
  console.log("══════════════════════════════════════════════════════════════════");
  for (const s of ok) console.log(`  PASS  ${s}`);
  for (const s of stale) console.log(`  STALE ${s}  ← run \`bun scripts/state.ts --write\``);
  for (const m of missing) console.log(`  MISSING ${m}`);
  console.log("");
  // Maps-staleness: WARN-only this unit (do NOT gate). See policy note above.
  console.log(`  ${maps.note}  [WARN-only — not gated; project-mapper seam]`);
  console.log(`  ${digestStaleness().note}  [WARN-only — not gated; PA-start freshness guard]`);
  console.log("");
  if (failed) {
    const names = [...stale, ...missing].join(", ");
    console.log(`  FAIL — stale/missing @generated section(s): ${names}`);
    console.log("══════════════════════════════════════════════════════════════════");
    return 1;
  }
  console.log("  PASS — all @generated sections current.");
  console.log("══════════════════════════════════════════════════════════════════");
  return 0;
}

function rel(abs: string): string {
  return abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : abs;
}

// ── bun test (pre-commit subset) ────────────────────────────────────────────
function testSummary() {
  const dirs = ["compiler/tests/unit", "compiler/tests/integration", "compiler/tests/conformance"];
  const r = sh("bun", ["test", ...dirs]);
  const out = r.stdout + "\n" + r.stderr; // bun prints the summary to stderr
  const grab = (label: string) => {
    const mm = out.match(new RegExp(`^\\s*(\\d+)\\s+${label}\\b`, "m"));
    return mm ? parseInt(mm[1], 10) : null;
  };
  return { pass: grab("pass"), skip: grab("skip"), fail: grab("fail"), exitOk: r.ok };
}

// ── version ─────────────────────────────────────────────────────────────────
function version() {
  return JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")).version as string;
}

// ── last-N session anchors (session-close commits) ───────────────────────────
function sessionAnchors(n: number) {
  const r = sh("git", ["log", "--pretty=%h %s", "-n", "600"]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of r.stdout.split("\n")) {
    const subj = l.slice(l.indexOf(" ") + 1);
    if (!isSessionClose(subj)) continue;
    const s = sessionNumOf(subj);
    if (s && seen.has(s)) continue;
    if (s) seen.add(s);
    out.push(l);
    if (out.length >= n) break;
  }
  return out;
}

// ── recent-session index (the generated master-list §0.6 stub — DD3 Fork 1, S173) ──────
// Per-session NARRATIVE is the changelog dated blocks (`docs/changelog.md`) — the ONE narrative
// source of truth (DD3 Fork 1). §0.6's old append-only per-session prose was deleted; this derives
// ONLY the startup-load-bearing forensic index: which wraps are recent, are they pushed (vs
// origin/main), and was a release tag cut. Regenerated by --write; gated by --check.
// A session-close commit uses one of two historical subject forms:
//   `wrap(sNN): …`   (current) OR   `docs(sNN): WRAP — …`   (S150–S167 era).
function isSessionClose(subj: string): boolean {
  return /\bwrap\(s\d+\)/i.test(subj) || /\(s\d+\):\s*wrap\b/i.test(subj);
}
function sessionNumOf(subj: string): string | null {
  const m = subj.match(/\(s(\d+)\)/i);
  return m ? m[1] : null;
}
function recentSessions(n: number): string {
  const r = sh("git", ["log", "--pretty=%h %s", "-n", "600"]);
  const seen = new Set<string>();
  const picked: { sha: string; subj: string }[] = [];
  for (const line of r.stdout.split("\n")) {
    const sp = line.indexOf(" ");
    const sha = sp >= 0 ? line.slice(0, sp) : line;
    const subj = sp >= 0 ? line.slice(sp + 1) : "";
    if (!isSessionClose(subj)) continue;
    const sess = sessionNumOf(subj);
    if (sess && seen.has(sess)) continue; // one anchor per session (newest close commit)
    if (sess) seen.add(sess);
    picked.push({ sha, subj });
    if (picked.length >= n) break;
  }
  if (picked.length === 0) return "_(no session-wrap commits found)_";
  const lines: string[] = [];
  for (const { sha, subj } of picked) {
    const pushed = sh("git", ["merge-base", "--is-ancestor", sha, "origin/main"]).ok
      ? "pushed"
      : "LOCAL-ONLY";
    const tags = sh("git", ["tag", "--points-at", sha]).stdout
      .split("\n").map((t) => t.trim()).filter(Boolean);
    const tagNote = tags.length ? ` · tag \`${tags.join(", ")}\`` : "";
    lines.push(`- \`${sha}\` — ${subj} — **${pushed}**${tagNote}`);
  }
  return lines.join("\n");
}

// ── inventory ─────────────────────────────────────────────────────────────────
function findCount(dir: string, pattern: string): number {
  const r = sh("find", [dir, "-name", pattern]);
  return r.stdout.split("\n").filter((l) => l.trim().length > 0).length;
}
function inventory() {
  const testFiles = findCount("compiler/tests", "*.test.*");
  const samples = findCount("samples", "*.scrml");
  const examples = findCount("examples", "*.scrml");
  const specLines = readFileSync(`${ROOT}/compiler/SPEC.md`, "utf8").split("\n").length;
  return { testFiles, samples, examples, specLines };
}

// ── maps staleness ────────────────────────────────────────────────────────────
function mapsStaleness() {
  const mapText = readFileSync(`${ROOT}/.claude/maps/primary.map.md`, "utf8");
  const line3 = mapText.split("\n")[2] ?? "";
  const wm = line3.match(/commit:\s*([0-9a-f]+)/i);
  const watermark = wm ? wm[1] : null;
  const head = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  if (!watermark) return { watermark: null, head, note: "maps: watermark not parseable" };
  if (watermark === head) return { watermark, head, note: "maps: current" };
  // count commits between watermark and HEAD (how far behind the maps are)
  const rng = sh("git", ["rev-list", "--count", `${watermark}..HEAD`]);
  const behind = rng.ok ? rng.stdout.trim() : "?";
  return { watermark, head, note: `maps: ${behind} commits behind HEAD (watermark ${watermark}, HEAD ${head})` };
}

// ── delta-log projection (the volatile PA-state stream) ─────────────────────────
// Parse handOffs/delta-log.md: the LATEST `## Session` section's `[N] kind · body` entries.
// Returns recent rulings + recent activity + the last seq. Pure file-read projection (no test run).
function deltaLog() {
  let text = "";
  try { text = readFileSync(`${ROOT}/handOffs/delta-log.md`, "utf8"); } catch { return null; }
  const parts = text.split(/^## Session /m);
  const latest = parts[parts.length - 1] ?? text;
  const sessHeader = "S" + (latest.split("\n")[0] ?? "").trim();
  const entries: { seq: number; kind: string; body: string }[] = [];
  for (const ln of latest.split("\n")) {
    const m = ln.match(/^\[(\d+)\]\s+(\S+)\s+·\s+(.*)$/);
    if (m) entries.push({ seq: parseInt(m[1], 10), kind: m[2], body: m[3] });
  }
  const lastSeq = entries.length ? entries[entries.length - 1].seq : null;
  const rulings = entries.filter((e) => e.kind.includes("rule")).slice(-5);
  const activity = entries.filter((e) => /disp|land|find|state/.test(e.kind)).slice(-6);
  return { sessHeader, lastSeq, rulings, activity, total: entries.length };
}

function fmtEntry(e: { seq: number; kind: string; body: string }): string {
  // The pointer is the LAST `→` ("what · → pointer"); bodies may contain mid-text arrows
  // (e.g. "baton → deputy") so split on lastIndexOf, then truncate the narrative.
  const arrow = e.body.lastIndexOf("→");
  let what = (arrow >= 0 ? e.body.slice(0, arrow) : e.body).trim().replace(/[·\s]+$/, "");
  const ptr = arrow >= 0 ? e.body.slice(arrow + 1).trim() : "";
  if (what.length > 160) what = what.slice(0, 160).trim() + "…";
  return `\`[${e.seq}]\` ${e.kind} · ${what}${ptr ? ` → ${ptr}` : ""}`;
}

// ── digest (Function 1 — the verified session-start projection) ─────────────────
// The deputy regenerates handOffs/digest.md per maintenance tick. The PA reads it FIRST at
// session-start: if `head=` == actual HEAD, TRUST the volatile board/rulings/activity and skip
// re-deriving them; if behind, DISTRUST + fall back to the authoritative reads. The expert reads
// (PRIMER/SPEC-INDEX/Rules) are NEVER digested (that would be the corpus-ouroboros). Pure projection
// — no test run (keeps the per-tick regen cheap); no wall-clock (git-SHA anchored, deterministic).
function digest(): string {
  const head = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const g = gapCounts();
  const highIds = g.tokens.filter((t) => t.sev === "HIGH" && t.status === "open").map((t) => t.id);
  const maps = mapsStaleness();
  const dl = deltaLog();
  const anchors = sessionAnchors(3);
  const seq = dl?.lastSeq ?? "?";

  const L: string[] = [];
  L.push(`<!-- @digest head=${head} delta-seq=${seq} -->`);
  L.push(`# scrml — session-start digest (@generated — do NOT hand-edit)`);
  L.push("");
  L.push(`> ⚠ **FRESHNESS GUARD (PA — read this first).** This digest is a mechanical projection reflecting`);
  L.push(`> **HEAD \`${head}\`** + delta-log **[${seq}]**. To check freshness, run \`bun scripts/state.ts\` and read`);
  L.push(`> its \`digest:\` line — it is SOURCE-based (the digest is current unless a commit since stamp \`${head}\``);
  L.push(`> touched a source it projects from — known-gaps · delta-log · maps · version; the digest's own`);
  L.push(`> commit does NOT stale it). **If it reports STALE, DISTRUST this digest** and fall back to the`);
  L.push(`> authoritative reads (master-list §0 + hand-off.md + delta-log tail). Every line below is`);
  L.push(`> \`asserted\` (a projection), never \`verified\`. **A drifted digest is worse than reading cold.**`);
  L.push(`>`);
  L.push(`> Generated by \`bun scripts/state.ts --digest\` (the deputy regenerates it per maintenance tick).`);
  L.push(`> It thins the VOLATILE re-derivation only (board · rulings · activity); the expert reads`);
  L.push(`> (PRIMER · SPEC-INDEX · pa.md Rules) are UNAFFECTED — always cold.`);
  L.push("");
  L.push(`## Board — from \`@gap\` tokens @ \`${head}\``);
  L.push(`- **HIGH ${g.high}** · MED ${g.med} · LOW ${g.low} · Nominal ${g.nominal}`);
  L.push(`- Named open HIGHs: ${highIds.length ? highIds.map((i) => `\`${i}\``).join(", ") : "_none_"}`);
  L.push("");
  if (dl) {
    L.push(`## Recent rulings — last ${dl.rulings.length} \`rule\` (delta-log ${dl.sessHeader})`);
    if (dl.rulings.length === 0) L.push("- _(none in the latest session)_");
    for (const e of dl.rulings) L.push(`- ${fmtEntry(e)}`);
    L.push("");
    L.push(`## Recent activity — last ${dl.activity.length} \`disp\`/\`land\`/\`find\`/\`state\``);
    for (const e of dl.activity) L.push(`- ${fmtEntry(e)}`);
    L.push("");
  } else {
    L.push(`## Delta-log`);
    L.push(`- _(delta-log not found — read hand-off.md for session state)_`);
    L.push("");
  }
  L.push(`## State`);
  L.push(`- Version: ${version()} · ${maps.note}`);
  L.push(`- Recent wraps:${anchors.length ? "" : " _none_"}`);
  for (const a of anchors) L.push(`  - ${a}`);
  L.push("");
  L.push(`## NOT in the digest (read source for these)`);
  L.push(`- Open questions awaiting you → \`hand-off.md\` §"OPEN THREADS / Open questions"`);
  L.push(`- Full in-flight + reasoning detail → the delta-log tail + \`hand-off.md\``);
  L.push(`- Language/spec expertise → PRIMER · SPEC-INDEX · pa.md (always cold; never digested)`);
  return L.join("\n");
}

function runDigest(): number {
  const out = digest();
  const path = `${ROOT}/handOffs/digest.md`;
  writeFileSync(path, out + "\n");
  const head = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  console.log(`--digest: wrote ${rel(path)} (head ${head}, delta-seq ${deltaLog()?.lastSeq ?? "?"}).`);
  return 0;
}

// Digest freshness (WARN-only in --check + the no-arg report; NOT gated — the PA-start guard consumes it).
// SOURCE-based, not strict head==HEAD: the digest's OWN commit always advances HEAD past its `head=`
// stamp, so strict equality would mark it always-stale-by-one (Function 1 would never fire). The digest
// is FRESH iff no commit since the stamp touched a source it PROJECTS FROM; commits that only touch
// digest.md (or other deputy-derived files) don't stale it.
const DIGEST_SOURCES = ["docs/known-gaps.md", "handOffs/delta-log.md", ".claude/maps/primary.map.md", "package.json"];
function digestStaleness() {
  let text = "";
  try { text = readFileSync(`${ROOT}/handOffs/digest.md`, "utf8"); } catch { return { fresh: false, note: "digest: not generated yet → PA falls back to authoritative reads" }; }
  const m = text.match(/<!--\s*@digest\s+head=([0-9a-f]+)\s+delta-seq=(\S+?)\s*-->/i);
  const head = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  if (!m) return { fresh: false, note: "digest: header not parseable → PA falls back" };
  const stamp = m[1];
  if (stamp === head) return { fresh: true, note: `digest: current (head ${stamp}, delta-seq ${m[2]})` };
  const diff = sh("git", ["diff", "--name-only", `${stamp}..HEAD`, "--", ...DIGEST_SOURCES]);
  const changed = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (diff.ok && changed.length === 0) {
    return { fresh: true, note: `digest: current (stamp ${stamp}; only derived commits since → sources unchanged @ HEAD ${head})` };
  }
  const why = changed.length ? changed.map((c) => c.replace(/^.*\//, "")).join(", ") : "history diverged from stamp";
  return { fresh: false, note: `digest: STALE — sources changed since stamp ${stamp} (${why}) → PA distrusts + falls back` };
}

// ── render ──────────────────────────────────────────────────────────────────
function main() {
  const head = sh("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const g = gapCounts();
  const inv = inventory();
  const maps = mapsStaleness();
  const anchors = sessionAnchors(8);

  const L: string[] = [];
  L.push("══════════════════════════════════════════════════════════════════");
  L.push(`  scrml — state at HEAD ${head}   (bun scripts/state.ts)`);
  L.push("══════════════════════════════════════════════════════════════════");
  L.push("");
  L.push(`Version: ${version()}`);
  L.push("");
  L.push("Open-gap inventory (derived from docs/known-gaps.md @gap tokens):");
  L.push(`  HIGH    open : ${g.high}`);
  L.push(`  MED     open : ${g.med}`);
  L.push(`  LOW     open : ${g.low}`);
  L.push(`  Nominal      : ${g.nominal}   (spec-ahead-of-impl)`);
  L.push(`  (${g.tokens.length} @gap tokens total; non-open excluded from the headline count)`);
  L.push("");

  L.push("Tests — pre-commit subset (unit + integration + conformance; NOT the browser suite):");
  const t = testSummary();
  if (t.pass === null && t.fail === null) {
    L.push("  (could not parse bun test summary — run `bun test` manually)");
  } else {
    L.push(`  pass : ${t.pass ?? "?"}    skip : ${t.skip ?? "?"}    fail : ${t.fail ?? "?"}`);
    if (t.fail && t.fail > 0) L.push("  ⚠ FAILURES present");
  }
  L.push("");

  L.push("Inventory (ground-truth scans):");
  L.push(`  test files (compiler/tests/*.test.*) : ${inv.testFiles}`);
  L.push(`  samples (samples/**/*.scrml)         : ${inv.samples}`);
  L.push(`  examples (examples/**/*.scrml)       : ${inv.examples}`);
  L.push(`  SPEC.md lines                        : ${inv.specLines}`);
  L.push("");

  L.push(`Maps: ${maps.note}`);
  L.push(`Digest: ${digestStaleness().note}`);
  L.push("");

  L.push(`Last ${anchors.length} session anchors (wrap(s…) commits):`);
  for (const a of anchors) L.push(`  ${a}`);
  L.push("");
  L.push("══════════════════════════════════════════════════════════════════");

  console.log(L.join("\n"));
}

// ── dispatch ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--write")) {
  process.exit(runWrite());
} else if (argv.includes("--check")) {
  process.exit(runCheck());
} else if (argv.includes("--digest")) {
  process.exit(runDigest());
} else {
  main();
}
