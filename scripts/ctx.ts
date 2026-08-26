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
 * ⚑ ONE ASSISTANT MESSAGE IS MANY JSONL RECORDS (S376). Claude Code persists a single
 * logical assistant turn as N separate records — the text block, the thinking block, and
 * one per `tool_use` — and EVERY one of them repeats the SAME `message.usage`. Summing
 * `output_tokens` across records therefore double-counts by ~2x, and so does counting
 * "turns". Measured on two real transcripts: 546 records → 270 messages (output 618,885 →
 * 274,412), 742 → 351 (763,930 → 326,311). All cumulative figures below are computed over
 * MESSAGES, grouped by `message.id`; the usage of every record in a group was verified
 * byte-identical (0 divergences in 1,288 records) before this grouping was adopted.
 * The headline occupancy is deliberately still read off the LAST RECORD, not off a group,
 * so that it cannot drift if that assumption ever stops holding.
 *
 * That double-count did not just inflate a number, it manufactured a CONCLUSION: the tool
 * compared the (inflated) cumulative output against the (correct) resident output and
 * narrated the ~2x gap as "thinking blocks being dropped from later prompts". Nothing was
 * being dropped. Re-measured after the dedupe across 77 transcripts, 56 have a residual of
 * exactly zero and the only two over 1,000 tokens are the two that hit a compaction. The
 * ⚑ line now reports the residual and attaches no mechanism to it.
 *
 * ⚑ ACCURACY BOUNDARY — read this before quoting a number from `--breakdown`.
 *   - TOTALS are EXACT. They are the provider's own accounting, echoed back.
 *   - PER-SOURCE ATTRIBUTION IS AN ESTIMATE. The transcript records what the window cost
 *     in aggregate per request, never per block. So growth between two consecutive
 *     assistant MESSAGES is split as: the earlier message's `output_tokens` attributed
 *     EXACTLY (the provider counted it), and the remainder divided across the intervening
 *     entries in proportion to their serialized character length. That is a good estimator
 *     and it is not a measurement. Every estimated figure is marked `~`.
 *   - A NEGATIVE delta is real and expected: compaction, cache expiry, or a `/clear`-adjacent
 *     boundary can shrink the prompt. Negative growth is reported as `reclaimed`, never
 *     silently clamped to zero — clamping would make the columns sum to something that
 *     never happened. After a reclaim the per-source figures describe cumulative INTAKE
 *     across the session, not what is resident now, and `--breakdown` says so out loud
 *     rather than rescaling the buckets to a shape nobody measured.
 *
 * ⚑ THE WINDOW SIZE IS NOT DISCOVERABLE FROM THE TRANSCRIPT. The `model` field reads
 * `claude-opus-5` whether or not the 1M-context variant is active, so this script CANNOT
 * infer it and does not pretend to. It defaults to 1,000,000, states that basis in every
 * output, and takes `--window` / `$CLAUDE_CTX_WINDOW` to override. A tool that guessed
 * silently would be the §8 hollow-gate shape: an authoritative-looking number with nothing
 * behind it — and so would one that accepted `--window abc` and printed `NaN%`. Every
 * numeric argument is validated and a bad one exits 2.
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
 * EXIT CODES: 0 ok · 2 no transcript resolvable, or a bad argument
 *             (fails LOUD — never reports 0%, NaN% or Infinity%)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const DEFAULT_WINDOW = 1_000_000;

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);

/** Every bad-argument exit goes through here, so the failure mode is one shape. */
function die(msg: string): never {
  console.error(`ctx — ${msg}`);
  console.error(`  Refusing to print a number derived from an argument this tool could not read.`);
  process.exit(2);
}

/**
 * The value after a flag. A flag is NEVER a value: `--window --json` used to swallow
 * `--json` and print `NaN%` at exit 0, which is the same failure class as reporting 0%
 * for a transcript that could not be found.
 */
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  if (i < 0) return null;
  if (i + 1 >= argv.length) die(`${f} needs a value, but nothing followed it.`);
  const next = argv[i + 1];
  if (next.startsWith("--")) die(`${f} needs a value, but the next argument is the flag \`${next}\`.`);
  return next;
};

/** Strictly a positive integer. `parseInt` is not used: it reads "1e9x" as 1 and "1M" as 1. */
const posInt = (raw: string, source: string): number => {
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) die(`${source} expects a positive integer, got \`${raw}\`.`);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) die(`${source} expects a positive integer, got \`${raw}\`.`);
  return n;
};

const asJson = has("--json");
const wantBreakdown = has("--breakdown");
const turnsArg = val("--turns");
const wantTurns = turnsArg !== null ? posInt(turnsArg, "--turns") : 0;
const topArg = val("--top");
const wantTop = topArg !== null ? posInt(topArg, "--top") : 0;

const windowFlag = val("--window");
// An exported-but-empty env var means "not set", not "window of zero".
const windowEnv = (process.env.CLAUDE_CTX_WINDOW ?? "").trim() || null;
const WINDOW =
  windowFlag !== null ? posInt(windowFlag, "--window")
  : windowEnv !== null ? posInt(windowEnv, "$CLAUDE_CTX_WINDOW")
  : DEFAULT_WINDOW;
const windowBasis =
  windowFlag !== null ? "--window flag"
  : windowEnv !== null ? "$CLAUDE_CTX_WINDOW"
  : "DEFAULT (not discoverable from the transcript — override with --window)";

// An argument this tool does not recognise is the SAME failure class as `--window abc`,
// and a worse one, because the number still looks right: `-window 200000` (one dash) or
// `--window=200000` (equals form) are both silently ignored, and the tool then reports
// 78% of a 1M window for a session that is actually over capacity in a 200k one.
const FLAGS_NO_VALUE = new Set(["--json", "--breakdown", "--list"]);
const FLAGS_WITH_VALUE = new Set(["--turns", "--top", "--window", "--session"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (FLAGS_NO_VALUE.has(a)) continue;
  if (FLAGS_WITH_VALUE.has(a)) { i++; continue; } // its value was validated above
  die(
    `unrecognised argument \`${a}\`.\n` +
    `  known: ${[...FLAGS_NO_VALUE].join(" ")} · ${[...FLAGS_WITH_VALUE].map((f) => `${f} <value>`).join(" ")}\n` +
    `  (note the two-dash spelling and the SPACE before a value — \`--window=200000\` is not accepted)`,
  );
}

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

/**
 * The cwd → project-dir slug rule, matched to the shipped binary EXACTLY:
 *   slug = cwd.replace(/[^a-zA-Z0-9]/g, "-")   ← per CHARACTER, runs are NOT collapsed
 * Verified two ways (S376): the rule is `h1r`/`qY` in the 2.1.240 and 2.1.241 binaries,
 * and running the real binary with cwd = a git worktree created
 *   -home-…-scrml--claude-worktrees-agent-…   ← note the DOUBLE dash from "/.claude/"
 * A collapsing regex (`[^A-Za-z0-9]+`) computes a single dash and finds nothing, which is
 * how `--list` came to report "no sessions found" from every worktree in this repo.
 */
const SLUG_MAX = 200; // the binary truncates past this and appends a hash of the cwd
function slugForCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Past SLUG_MAX the binary appends `-${hash(cwd)}` using an internal hash this script
 * deliberately does NOT reproduce — guessing it would be the hollow-gate shape. Instead
 * we scan for the truncated prefix, and refuse to choose if it is ambiguous.
 */
function projectDirForCwd(cwd: string): string | null {
  const slug = slugForCwd(cwd);
  const exact = join(PROJECTS_DIR, slug);
  if (existsSync(exact)) return exact;
  if (slug.length <= SLUG_MAX) return null;
  const prefix = `${slug.slice(0, SLUG_MAX)}-`;
  const hits = projectDirs().filter((p) => p.slice(PROJECTS_DIR.length + 1).startsWith(prefix));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    console.error(`ctx — ⚑ ${hits.length} project dirs share the truncated slug \`${prefix}\`; refusing to guess between them.`);
  }
  return null;
}

/** What `slugForCwd` WOULD produce, for the not-found diagnostic. */
function slugDirForCwd(cwd: string): string {
  return join(PROJECTS_DIR, slugForCwd(cwd));
}

function sessionsForCwd(cwd: string): { path: string; mtime: number; size: number; id: string }[] {
  const dir = projectDirForCwd(cwd);
  if (dir === null) return [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const rows: { path: string; mtime: number; size: number; id: string }[] = [];
  for (const f of names) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(dir, f);
    // A transcript can be rotated or deleted between readdir and stat. That is a reason to
    // skip one file, never a reason to kill the run — an unguarded stat here used to abort
    // the DEFAULT code path with an ENOENT stack trace and exit 1.
    let st;
    try { st = statSync(p); } catch { continue; }
    rows.push({ path: p, mtime: st.mtimeMs, size: st.size, id: f.replace(/\.jsonl$/, "") });
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
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
  /** the id of the logical assistant message this record belongs to, when it has one */
  messageId: string | null;
  chars: number;
  /** human label for attribution: "tool:Read", "user message", "attachment:skill_listing", … */
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

  // `attachment` records carry NO `message` field — their payload lives under `.attachment`.
  // Scoring them off `message.content` gave them zero weight, so the proportional split
  // silently pushed their real tokens onto whatever tool_result shared the turn. Weigh the
  // attachment payload itself; the JSONL envelope (uuid/timestamp/cwd/gitBranch) is
  // persistence metadata that never enters the window and is deliberately NOT counted.
  if (rec?.type === "attachment") {
    const a = rec.attachment;
    const kind = typeof a?.type === "string" ? a.type : "unknown";
    return { label: `attachment:${kind}`, chars: a == null ? 0 : JSON.stringify(a).length, role, detail: "" };
  }

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
    const mid = rec?.message?.id;
    out.push({
      idx: i,
      type: rec.type ?? "unknown",
      isSidechain: false,
      role,
      usage: rec?.message?.usage ?? null,
      messageId: typeof mid === "string" && mid.length > 0 ? mid : null,
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
  if (rows.length === 0) {
    console.error(`ctx — no sessions found for ${cwd}`);
    console.error(`  looked in: ${slugDirForCwd(cwd)}`);
    process.exit(2);
  }
  console.log(`ctx — ${rows.length} session(s) for ${cwd}, newest first`);
  for (const r of rows) {
    const cur = r.id === process.env.CLAUDE_CODE_SESSION_ID ? "  ← current" : "";
    console.log(`  ${r.id}  ${(r.size / 1024 / 1024).toFixed(1)} MB  ${new Date(r.mtime).toISOString()}${cur}`);
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
  if (rows.length > 0) {
    transcript = rows[0].path;
    resolvedBy = "newest transcript for this cwd (FALLBACK — $CLAUDE_CODE_SESSION_ID was unset)";
    // The real hazard here is NOT a sidechain — sidechain records are filtered in load(),
    // and no transcript file is itself a sidechain. It is that this repo runs CONCURRENT
    // sessions in one checkout, so "newest by mtime" can be somebody else's window.
    if (rows.length > 1) {
      console.error(
        `ctx — ⚑ FALLBACK: $CLAUDE_CODE_SESSION_ID is unset, so this is the newest of ${rows.length}\n` +
        `  transcripts for this cwd — under concurrent sessions that may be a DIFFERENT window\n` +
        `  than the one you are asking about. Pass --session <id> to be sure (--list to see them).`,
      );
    }
  }
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

// ── headline ────────────────────────────────────────────────────────────────
// Read off the LAST RECORD, not off a message group. Duplicated records repeat the same
// usage, so this is already correct — and computing it from records keeps it correct even
// if the one-message-many-records assumption ever changes.
const last = withUsage[withUsage.length - 1];
const prompt = promptOf(last.usage!);
const lastOut = last.usage!.output_tokens ?? 0;
const occupied = prompt + lastOut; // what the NEXT request will carry
const pct = (occupied / WINDOW) * 100;
const remaining = WINDOW - occupied;

// ── records → logical messages ──────────────────────────────────────────────
// N records share one `message.id` and repeat its usage verbatim. Group them, so that
// "turns", cumulative output and cumulative thinking count each message ONCE.
// Grouped by CONSECUTIVE RUN of the same id, not by id across the whole file. The two are
// identical on all 79 transcripts on this machine (0 disagreements), but a run is immune to
// a reused id — a forked or resumed session that repeated one would otherwise merge two
// distant messages and take the far one's usage. When a run cannot merge, it degrades to
// today's record-level behaviour, which is the safe direction.
type Msg = { first: Entry; last: Entry; usage: Usage };
const messages: Msg[] = [];
for (const e of withUsage) {
  const open = messages[messages.length - 1];
  // A record with no id (older transcripts, synthesized records) never merges.
  const mergeable = e.messageId !== null && open !== undefined && open.first.messageId === e.messageId;
  if (mergeable) { open.last = e; open.usage = e.usage!; }
  else messages.push({ first: e, last: e, usage: e.usage! });
}

// cumulative output (exact) — the assistant's own contribution, once per MESSAGE
let totalOut = 0, totalThinking = 0;
for (const m of messages) {
  totalOut += m.usage.output_tokens ?? 0;
  totalThinking += m.usage.output_tokens_details?.thinking_tokens ?? 0;
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

// Which entries belong to which turn, in ONE forward pass. Turn k owns the entries lying
// strictly between message k-1's first record and message k's first record; those two
// bounds are assistant records, so the spans tile the transcript with no gap and no
// overlap. (A per-turn `entries.filter(...)` was O(turns × entries) for the same answer.)
const bounds = messages.map((m) => m.first.idx);
const spans: Entry[][] = messages.map(() => []);
{
  let k = 0;
  for (const e of entries) {
    if (e.type === "assistant") continue;
    while (k < bounds.length && e.idx > bounds[k]) k++;
    if (k === 0) continue;            // before the first message → part of the session baseline
    if (k >= bounds.length) continue; // after the last message → not yet in any prompt we can see
    spans[k].push(e);
  }
}

// baseline: the very first prompt is the system prompt + tools + any preloaded context.
const firstPrompt = promptOf(messages[0].usage);
bump("session baseline (system prompt + tools + CLAUDE.md + memory)", firstPrompt);

for (let i = 1; i < messages.length; i++) {
  const prev = messages[i - 1];
  const cur = messages[i];
  const growth = promptOf(cur.usage) - promptOf(prev.usage);

  if (growth < 0) { reclaimed += -growth; turnRows.push({ at: cur.first.ts, growth, sources: "(context reclaimed — compaction / cache boundary)" }); continue; }

  // the previous message's output is now part of the prompt — attributed EXACTLY.
  const prevOut = Math.min(prev.usage.output_tokens ?? 0, growth);
  bump("assistant output (incl. thinking)", prevOut);
  residentOutput += prevOut;

  // the remainder belongs to whatever arrived between the two assistant messages.
  const between = spans[i];
  const rest = growth - prevOut;
  const totalChars = between.reduce((s, e) => s + e.chars, 0);
  if (rest > 0 && between.length > 0 && totalChars > 0) {
    for (const e of between) {
      const est = Math.round((e.chars / totalChars) * rest);
      bump(e.label, est);
      if (est > 0) itemRows.push({ label: e.label, est, detail: e.detail, at: e.ts });
    }
  } else if (rest > 0) {
    // Be precise about WHY it is unattributed: "no intervening entry" was a false label
    // whenever entries were present but every one of them scored zero characters.
    bump(
      between.length === 0
        ? "unattributed (no intervening entry)"
        : "unattributed (intervening entries carry no measurable payload)",
      rest,
    );
  }

  if (wantTurns) {
    const srcs = between.length ? [...new Set(between.map((e) => e.label))].join(", ") : "assistant output only";
    turnRows.push({ at: cur.first.ts, growth, sources: srcs });
  }
}

const sorted = [...buckets.values()].sort((a, b) => b.est - a.est);
const attributedTotal = sorted.reduce((s, b) => s + b.est, 0);

// How much emitted output is genuinely unaccounted for?
//   residentOutput   — output the NEXT request's prompt was measured to carry
//   pendingOutput    — the final message's output; no later request exists to carry it, so
//                      it can never be resident and must not be counted as "dropped"
// Before the S376 dedupe, `totalOut` was ~2x reality and this residual came out at roughly
// half the session's output, which the tool then narrated as "thinking blocks being dropped
// from later prompts". It was an artifact. Measured across 77 real transcripts after the
// dedupe: 56 have a residual of EXACTLY 0, and the only two above 1,000 are the two sessions
// that hit a compaction. So the honest report is the number and no mechanism.
const pendingOutput = messages[messages.length - 1].usage.output_tokens ?? 0;
const unaccountedOutput = totalOut - residentOutput - pendingOutput;

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
    exact: { totalOutputTokens: totalOut, totalThinkingTokens: totalThinking, assistantTurns: messages.length, reclaimed },
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
console.log(`  assistant turns: ${messages.length} · cumulative output ${fmt(totalOut)} (thinking ${fmt(totalThinking)})${reclaimed ? ` · reclaimed ${fmt(reclaimed)}` : ""}`);
if (unaccountedOutput > 1000) {
  console.log(`  ⚑ ${fmt(unaccountedOutput)} of the ${fmt(totalOut)} tokens emitted this session cannot be found in any`);
  console.log(`    later prompt (~${fmt(residentOutput)} are resident; ${fmt(pendingOutput)} is the final turn's output, which`);
  console.log(`    no later request has carried yet). This is a GAP with no mechanism attached.`);
  if (reclaimed > 0) console.log(`    This session reclaimed ${fmt(reclaimed)} tokens — a compaction boundary produces a gap of this shape.`);
}

if (wantBreakdown) {
  console.log(`\nWHERE IT WENT — ${sorted.length} sources, ~${fmt(attributedTotal)} attributed of ${fmt(occupied)} occupied`);
  console.log(`  ⚑ totals above are EXACT; the per-source figures below are ESTIMATES (~) —`);
  console.log(`    growth is split by serialized length across the entries in each turn.`);
  if (reclaimed > 0) {
    console.log(`  ⚑ ${fmt(reclaimed)} tokens were RECLAIMED during this session (compaction / cache boundary).`);
    console.log(`    The figures below are cumulative INTAKE, not current residency, so they sum to`);
    console.log(`    ~${fmt(attributedTotal)} — MORE than the ${fmt(occupied)} occupied now. They are not rescaled: the`);
    console.log(`    transcript does not record WHICH sources were evicted, and a proportional shrink`);
    console.log(`    would invent a distribution nobody measured.`);
  }
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
  const lw = Math.max(14, ...rows.map((r) => r.label.length));
  for (const r of rows) {
    console.log(`  ~${fmt(r.est).padStart(8)}  ${r.label.padEnd(lw)} ${r.detail || "(no detail)"}`);
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
