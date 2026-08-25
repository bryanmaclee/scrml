#!/usr/bin/env bun
/**
 * ctx.ts — what is actually in the context window right now, and what put it there.
 *
 * WHY THIS EXISTS (S375, bryan): a Profile-A boot measured ~43% of a 1M window before
 * any work started. That is a trajectory question, and it was unanswerable because the
 * PA had no instrument — the only context signal available was the operator reading a
 * number off his own UI and telling the agent. An agent that cannot measure its own
 * occupancy cannot pace itself, cannot tell which read was expensive, and cannot report
 * honestly on whether a boot read earned its cost.
 *
 * WHAT IT READS. Claude Code appends one JSON object per line to
 *   ~/.claude/projects/<slugified-cwd>/<session-id>.jsonl
 * Every assistant record carries `message.usage`, and the PROMPT half of that usage is
 * the context window occupancy at the moment that request was sent:
 *
 *   prompt = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *
 * The cache split is a BILLING distinction, not a context one — a cache-read token
 * occupies exactly as much window as a fresh one. Summing all three is the whole point;
 * reading `input_tokens` alone reports ~2 and is the single easiest way to get this wrong.
 *
 * ⚑ ACCURACY BOUNDARY — read this before quoting a number from `--breakdown`.
 *   - TOTALS are EXACT. They are the provider's own accounting, echoed back.
 *   - PER-SOURCE ATTRIBUTION IS AN ESTIMATE. The transcript records what the window cost
 *     in aggregate per request, never per block. So growth between two consecutive
 *     assistant records is split as: the earlier assistant's `output_tokens` attributed
 *     EXACTLY (the provider counted it), and the remainder divided across the intervening
 *     entries in proportion to their serialized character length. That is a good estimator
 *     and it is not a measurement. Every estimated figure is marked `~`.
 *   - A NEGATIVE delta is real and expected: compaction, cache expiry, or a `/clear`-adjacent
 *     boundary can shrink the prompt. Negative growth is reported as `reclaimed`, never
 *     silently clamped to zero — clamping would make the columns sum to something that
 *     never happened.
 *
 * ⚑ THE WINDOW SIZE IS NOT DISCOVERABLE FROM THE TRANSCRIPT. The `model` field reads
 * `claude-opus-5` whether or not the 1M-context variant is active, so this script CANNOT
 * infer it and does not pretend to. It defaults to 1,000,000, states that basis in every
 * output, and takes `--window` / `$CLAUDE_CTX_WINDOW` to override. A tool that guessed
 * silently would be the §8 hollow-gate shape: an authoritative-looking number with nothing
 * behind it.
 *
 * USAGE
 *   bun scripts/ctx.ts                 # occupancy + %  (the one-liner)
 *   bun scripts/ctx.ts --breakdown     # + where the tokens went, by source
 *   bun scripts/ctx.ts --turns 20      # + per-turn growth, most recent 20
 *   bun scripts/ctx.ts --json          # machine-readable
 *   bun scripts/ctx.ts --window 200000 # non-1M session
 *   bun scripts/ctx.ts --session <id>  # another session (default: $CLAUDE_CODE_SESSION_ID)
 *   bun scripts/ctx.ts --list          # sessions for this project, newest first
 *
 * EXIT CODES: 0 ok · 2 no transcript resolvable (fails LOUD — never reports 0%)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const DEFAULT_WINDOW = 1_000_000;

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

const asJson = has("--json");
const wantBreakdown = has("--breakdown");
const turnsArg = val("--turns");
const wantTurns = turnsArg !== null ? Math.max(1, parseInt(turnsArg, 10) || 20) : 0;
const topArg = val("--top");
const wantTop = topArg !== null ? Math.max(1, parseInt(topArg, 10) || 15) : 0;

const windowArg = val("--window") ?? process.env.CLAUDE_CTX_WINDOW ?? null;
const WINDOW = windowArg ? parseInt(windowArg, 10) : DEFAULT_WINDOW;
const windowBasis = windowArg
  ? (val("--window") ? "--window flag" : "$CLAUDE_CTX_WINDOW")
  : "DEFAULT (not discoverable from the transcript — override with --window)";

// ── resolve the transcript ──────────────────────────────────────────────────
function projectDirs(): string[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .map((d) => join(PROJECTS_DIR, d))
    .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
}

/** Search every project dir for <id>.jsonl — avoids having to reproduce the cwd-slug rule. */
function findBySessionId(id: string): string | null {
  for (const dir of projectDirs()) {
    const p = join(dir, `${id}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Project dir for a cwd, by the observed slug rule: every non-alphanumeric run → "-". */
function slugDirForCwd(cwd: string): string {
  return join(PROJECTS_DIR, cwd.replace(/[^A-Za-z0-9]+/g, "-"));
}

function sessionsForCwd(cwd: string): { path: string; mtime: number; id: string }[] {
  const dir = slugDirForCwd(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const p = join(dir, f);
      return { path: p, mtime: statSync(p).mtimeMs, id: f.replace(/\.jsonl$/, "") };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

// ── parse ───────────────────────────────────────────────────────────────────
type Usage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
};
type Entry = {
  idx: number;
  type: string;
  isSidechain: boolean;
  role: string | null;
  usage: Usage | null;
  chars: number;
  /** human label for attribution: "tool:Read", "user message", "assistant output", … */
  label: string;
  /** what the call was ABOUT — the file path, the command, the agent description. */
  detail: string;
  ts: string | null;
};

const TOOL_RESULT_KINDS = new Set(["tool_result"]);

type ToolInfo = { name: string; detail: string };

/** One line describing what a tool call was ABOUT, so --top names the file, not just the tool. */
function toolDetail(name: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  const first = (...keys: string[]) => {
    for (const k of keys) if (typeof input[k] === "string" && input[k]) return input[k] as string;
    return "";
  };
  const raw =
    name === "Bash" ? (first("description") || first("command"))
    : first("file_path", "path", "pattern", "query", "prompt", "description", "url", "command");
  return raw.replace(/\s+/g, " ").slice(0, 78);
}

function classify(rec: any, tools: Map<string, ToolInfo>): { label: string; chars: number; role: string | null; detail: string } {
  const msg = rec?.message ?? {};
  const role: string | null = msg.role ?? null;
  const content = msg.content;
  const chars = content == null ? 0 : JSON.stringify(content).length;

  if (rec.type === "assistant") return { label: "assistant output", chars, role, detail: "" };

  if (Array.isArray(content)) {
    const labels = new Set<string>();
    const details: string[] = [];
    for (const b of content) {
      if (b && TOOL_RESULT_KINDS.has(b.type)) {
        const t = tools.get(b.tool_use_id);
        labels.add(`tool:${t?.name ?? "unknown"}`);
        if (t?.detail) details.push(t.detail);
      } else if (b && b.type === "text") {
        labels.add("user message");
      } else if (b && b.type) {
        labels.add(`block:${b.type}`);
      }
    }
    const detail = details.join(" | ").slice(0, 96);
    if (labels.size === 1) return { label: [...labels][0], chars, role, detail };
    if (labels.size > 1) return { label: [...labels].sort().join(" + "), chars, role, detail };
  }
  if (typeof content === "string") return { label: "user message", chars, role, detail: "" };
  return { label: rec.type ?? "unknown", chars, role, detail: "" };
}

function load(path: string): Entry[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  // pass 1 — tool_use_id → {name, detail}, so a tool_result can name its tool AND its target.
  const tools = new Map<string, ToolInfo>();
  const parsed: any[] = [];
  for (const line of lines) {
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    parsed.push(rec);
    const content = rec?.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === "tool_use" && b.id) {
          const name = b.name ?? "unknown";
          tools.set(b.id, { name, detail: toolDetail(name, b.input) });
        }
      }
    }
  }

  // pass 2 — entries, main-loop only.
  const out: Entry[] = [];
  parsed.forEach((rec, i) => {
    if (rec?.isSidechain === true) return; // a dispatched agent's own turns are NOT our window
    const { label, chars, role, detail } = classify(rec, tools);
    out.push({
      idx: i,
      type: rec.type ?? "unknown",
      isSidechain: false,
      role,
      usage: rec?.message?.usage ?? null,
      chars,
      label,
      detail,
      ts: rec?.timestamp ?? null,
    });
  });
  return out;
}

const promptOf = (u: Usage): number =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

// ── main ────────────────────────────────────────────────────────────────────
const cwd = process.cwd();

if (has("--list")) {
  const rows = sessionsForCwd(cwd);
  if (rows.length === 0) { console.error(`ctx — no sessions found for ${cwd}`); process.exit(2); }
  console.log(`ctx — ${rows.length} session(s) for ${cwd}, newest first`);
  for (const r of rows) {
    const cur = r.id === process.env.CLAUDE_CODE_SESSION_ID ? "  ← current" : "";
    console.log(`  ${r.id}  ${(statSync(r.path).size / 1024 / 1024).toFixed(1)} MB  ${new Date(r.mtime).toISOString()}${cur}`);
  }
  process.exit(0);
}

const explicitId = val("--session");
const wantedId = explicitId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
let transcript: string | null = wantedId ? findBySessionId(wantedId) : null;
let resolvedBy = wantedId && transcript ? (explicitId ? "--session" : "$CLAUDE_CODE_SESSION_ID") : "";

// An EXPLICIT --session that does not resolve must fail LOUD. Falling through to the
// newest-for-cwd fallback would answer a question nobody asked — a well-formed number
// about a DIFFERENT session, which is the failure mode this file's header calls out.
if (explicitId && !transcript) {
  console.error(
    `ctx — --session ${explicitId} NOT FOUND under ${PROJECTS_DIR}.\n` +
    `  Refusing to fall back to another session: a number about the wrong transcript is worse than no number.\n` +
    `  Run \`bun scripts/ctx.ts --list\` to see the sessions for this project.`,
  );
  process.exit(2);
}

if (!transcript) {
  const rows = sessionsForCwd(cwd);
  if (rows.length > 0) { transcript = rows[0].path; resolvedBy = "newest transcript for this cwd (FALLBACK — may be a sidechain)"; }
}
if (!transcript) {
  console.error(
    `ctx — NO TRANSCRIPT RESOLVABLE.\n` +
    `  tried session id : ${wantedId ?? "(none — $CLAUDE_CODE_SESSION_ID unset)"}\n` +
    `  tried project dir: ${slugDirForCwd(cwd)}\n` +
    `  Refusing to report 0% — an unfindable transcript is not an empty one.`,
  );
  process.exit(2);
}

const entries = load(transcript);
const withUsage = entries.filter((e) => e.type === "assistant" && e.usage && promptOf(e.usage) > 0);

if (withUsage.length === 0) {
  console.error(`ctx — transcript has no assistant usage records yet: ${transcript}`);
  process.exit(2);
}

const last = withUsage[withUsage.length - 1];
const prompt = promptOf(last.usage!);
const lastOut = last.usage!.output_tokens ?? 0;
const occupied = prompt + lastOut; // what the NEXT request will carry
const pct = (occupied / WINDOW) * 100;
const remaining = WINDOW - occupied;

// cumulative output (exact) — the assistant's own contribution across the session
let totalOut = 0, totalThinking = 0;
for (const e of withUsage) {
  totalOut += e.usage!.output_tokens ?? 0;
  totalThinking += e.usage!.output_tokens_details?.thinking_tokens ?? 0;
}

// ── attribution ─────────────────────────────────────────────────────────────
type Bucket = { label: string; est: number; count: number };
const buckets = new Map<string, Bucket>();
const turnRows: { at: string | null; growth: number; sources: string }[] = [];
const itemRows: { label: string; est: number; detail: string; at: string | null }[] = [];
let reclaimed = 0;
let residentOutput = 0;

const bump = (label: string, est: number) => {
  const b = buckets.get(label) ?? { label, est: 0, count: 0 };
  b.est += est; b.count += 1; buckets.set(label, b);
};

// baseline: the very first prompt is the system prompt + tools + any preloaded context.
const firstPrompt = promptOf(withUsage[0].usage!);
bump("session baseline (system prompt + tools + CLAUDE.md + memory)", firstPrompt);

for (let i = 1; i < withUsage.length; i++) {
  const prev = withUsage[i - 1];
  const cur = withUsage[i];
  const growth = promptOf(cur.usage!) - promptOf(prev.usage!);

  if (growth < 0) { reclaimed += -growth; turnRows.push({ at: cur.ts, growth, sources: "(context reclaimed — compaction / cache boundary)" }); continue; }

  // the previous assistant's output is now part of the prompt — attributed EXACTLY.
  const prevOut = Math.min(prev.usage!.output_tokens ?? 0, growth);
  bump("assistant output (incl. thinking)", prevOut);
  residentOutput += prevOut;

  // the remainder belongs to whatever arrived between the two assistant records.
  const between = entries.filter((e) => e.idx > prev.idx && e.idx < cur.idx && e.type !== "assistant");
  const rest = growth - prevOut;
  const totalChars = between.reduce((s, e) => s + e.chars, 0);
  if (rest > 0 && between.length > 0 && totalChars > 0) {
    for (const e of between) {
      const est = Math.round((e.chars / totalChars) * rest);
      bump(e.label, est);
      if (est > 0) itemRows.push({ label: e.label, est, detail: e.detail, at: e.ts });
    }
  } else if (rest > 0) {
    bump("unattributed (no intervening entry)", rest);
  }

  if (wantTurns) {
    const srcs = between.length ? [...new Set(between.map((e) => e.label))].join(", ") : "assistant output only";
    turnRows.push({ at: cur.ts, growth, sources: srcs });
  }
}

const sorted = [...buckets.values()].sort((a, b) => b.est - a.est);
const attributedTotal = sorted.reduce((s, b) => s + b.est, 0);

// ── output ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("en-US");
const bar = (p: number, w = 34) => {
  const f = Math.max(0, Math.min(w, Math.round((p / 100) * w)));
  return "█".repeat(f) + "·".repeat(w - f);
};

if (asJson) {
  console.log(JSON.stringify({
    sessionId: wantedId, transcript, resolvedBy,
    window: WINDOW, windowBasis,
    occupied, pct: +pct.toFixed(2), remaining,
    prompt, lastOutput: lastOut,
    exact: { totalOutputTokens: totalOut, totalThinkingTokens: totalThinking, assistantTurns: withUsage.length, reclaimed },
    estimatedBySource: sorted.map((b) => ({ label: b.label, estTokens: b.est, occurrences: b.count })),
    note: "totals exact; estimatedBySource is a proportional estimate — see the header comment in scripts/ctx.ts",
  }, null, 2));
  process.exit(0);
}

console.log(`ctx — ${fmt(occupied)} / ${fmt(WINDOW)} tokens · ${pct.toFixed(1)}% used · ${fmt(remaining)} left`);
console.log(`  [${bar(pct)}]`);
console.log(`  window basis : ${windowBasis}`);
console.log(`  transcript   : ${transcript.replace(homedir(), "~")}`);
console.log(`  resolved by  : ${resolvedBy}`);
console.log(`  assistant turns: ${withUsage.length} · cumulative output ${fmt(totalOut)} (thinking ${fmt(totalThinking)})${reclaimed ? ` · reclaimed ${fmt(reclaimed)}` : ""}`);
if (totalOut - residentOutput > 1000) {
  console.log(`  ⚑ of ${fmt(totalOut)} tokens this session emitted, only ~${fmt(residentOutput)} are still resident`);
  console.log(`    (~${fmt(totalOut - residentOutput)} not carried forward — arithmetically consistent with thinking`);
  console.log(`     blocks being dropped from later prompts, though this measures the GAP, not the mechanism).`);
}

if (wantBreakdown) {
  console.log(`\nWHERE IT WENT — ${sorted.length} sources, ~${fmt(attributedTotal)} attributed of ${fmt(occupied)} occupied`);
  console.log(`  ⚑ totals above are EXACT; the per-source figures below are ESTIMATES (~) —`);
  console.log(`    growth is split by serialized length across the entries in each turn.`);
  const width = Math.max(...sorted.map((b) => b.label.length));
  for (const b of sorted) {
    if (b.est <= 0) continue;
    const share = (b.est / Math.max(1, attributedTotal)) * 100;
    console.log(`  ~${fmt(b.est).padStart(9)}  ${share.toFixed(1).padStart(5)}%  ${b.label.padEnd(width)}  (${b.count}×)`);
  }
}

if (wantTop) {
  const rows = [...itemRows].sort((a, b) => b.est - a.est).slice(0, wantTop);
  console.log(`\nTOP ${rows.length} SINGLE CALLS — of ${itemRows.length} attributed entries`);
  console.log(`  ⚑ estimates (~). This is the list to read when deciding what to STOP loading.`);
  for (const r of rows) {
    console.log(`  ~${fmt(r.est).padStart(8)}  ${r.label.padEnd(14)} ${r.detail || "(no detail)"}`);
  }
}

if (wantTurns) {
  const rows = turnRows.slice(-wantTurns);
  console.log(`\nPER-TURN GROWTH — last ${rows.length} of ${turnRows.length} turns`);
  for (const r of rows) {
    const g = r.growth >= 0 ? `+${fmt(r.growth)}` : fmt(r.growth);
    console.log(`  ${(r.at ?? "").slice(11, 19)}  ${g.padStart(9)}  ${r.sources}`);
  }
}
