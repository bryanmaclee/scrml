#!/usr/bin/env bun
/**
 * scripts/issue-debt.ts — every OPEN adopter issue has a HOME, or it is OWED.
 *
 * WHY THIS EXISTS (S346). Boot step 0.6 runs `gh issue list --state open` and the PA
 * STATES the open issues. That discharges nothing. At S346 three open issues — #519 (a DX
 * bug, 08-12), #509 (offline/PWA direction, 08-11), #471 (document-workflow direction,
 * 08-08) — had been NAMED in the S343, S344, S345 and S346 boot reports and acted on by
 * nobody: zero comments, no `docs/known-gaps.md` entry, no `handOffs/dpa-queue.md` item.
 * Adopter BUGS have a lane (Peter); a DIRECTION question has none, so it was everyone's and
 * therefore no one's.
 *
 * This is the review-floor hole (`scripts/review-debt.ts` — the model for this file) in a
 * second channel: the probe READS the channel; nothing ASSERTS the obligation. pa-base §10:
 * an obligation and its probe MUST resolve to the same artifact. The obligation is "each
 * open issue has a home", and a HOME is one of exactly two in-repo artifacts:
 *
 *   HOMED-GAP   `#<n>` appears in docs/known-gaps.md   (any entry text; no field required)
 *   HOMED-DPA   `#<n>` appears in handOffs/dpa-queue.md
 *   HOMED-BOTH  both
 *   OWED        neither. Printed with number · age · comment count · title. 0 comments AND
 *               >2 days old is the loud shape (⚠️ SILENT): the adopter has heard nothing and
 *               the repo holds nothing.
 *
 * DESIGN CONSTRAINTS (pa-base §8 gate-design + §2 detection-is-a-ratio):
 *   - DETECTION, NOT CONTROL. Exit 0 always in default mode. NEVER wire this into CI — a
 *     red-over-backlog gate is the §8 cry-wolf shape (instantly red for reasons no change
 *     caused → bypassed → deleted). It runs at BOOT (scripts/boot.ts delegates to it) and
 *     reports; `--check` exists for the PA's own hand, not a hook.
 *   - ANCHORED MATCH. `#51` must NOT match `#519`. An unanchored contains-test is the
 *     repeating false-positive class — boot's PICKUP `indexOf` (#492), the S337 ledger
 *     regex, dpa-debt's status cell (dpa-022/023) — so `mentions()` requires the number to
 *     be followed by a NON-digit (or end of text). A URL form `issues/<n>` is accepted as
 *     the same mention: a home written as a link is still a home.
 *   - PURE CLASSIFIER. `classify()` is a function over strings + a fixed `now` — no gh, no
 *     fs, no clock — so compiler/tests/unit/issue-debt.test.js pins it without a network.
 *     `import.meta.main` gates the CLI (the scripts/state.ts S307 pattern: a gate that
 *     cannot be exercised from a test is an unproven gate).
 *   - SELF-REPORTED TOTALS, NEVER HEAD-CUT (§8 truncated probe). `gh issue list --limit N`
 *     returns at most N rows, and a cut list reads exactly like a full one. Completeness
 *     test: rows < limit ⇒ provably complete (gh returns min(limit, total)). rows == limit
 *     ⇒ auto-widen ×4 up to a ceiling; if STILL full, the first line says
 *     `(of ≥N — SCAN MAY BE TRUNCATED)`. The count is never silently short.
 *   - DETERMINISTIC AGE. `--now=<ISO>` overrides the clock, so a test or a re-run is
 *     reproducible; the default is wall-clock because age IS the signal here.
 *   - WINDOWS-FIRST. ROOT via fileURLToPath (never `new URL().pathname` — the S262/#473
 *     break); sub-process via spawnSync with an explicit arg array, no shell.
 *
 * Usage:
 *   bun scripts/issue-debt.ts                            # report (boot probe) — exit 0
 *   bun scripts/issue-debt.ts --check                    # exit 1 iff any OWED (PA hand-use, never CI)
 *   bun scripts/issue-debt.ts --json                     # {repo, now, open, truncated, homed:[…], owed:[…]}
 *   bun scripts/issue-debt.ts --now=2026-08-15T00:00:00Z # deterministic age
 *   bun scripts/issue-debt.ts --repo=owner/name          # default bryanmaclee/scrml
 *   bun scripts/issue-debt.ts --gaps=<path> --queue=<path>  # ledger overrides (e.g. another ref's copy)
 *   bun scripts/issue-debt.ts --limit=500                # first-fetch size (auto-widens; default 200)
 */

import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, ""); // strip trailing sep on BOTH OSes

export const DEFAULT_REPO = "bryanmaclee/scrml";
export const GAPS_LEDGER = "docs/known-gaps.md";
export const DPA_QUEUE = "handOffs/dpa-queue.md";
/** An OWED issue with ZERO comments older than this is ⚠️ SILENT — nobody has said anything, anywhere. */
export const SILENT_AFTER_DAYS = 2;
const DAY_MS = 86_400_000;

// ── the pure classifier (no gh, no fs, no clock) ───────────────────────────────

export interface Issue {
  number: number;
  title: string;
  createdAt: string;      // ISO
  comments: number;       // count
  labels?: string[];
}

export type Home = "HOMED-GAP" | "HOMED-DPA" | "HOMED-BOTH" | "OWED";

export interface Classified extends Issue {
  labels: string[];
  home: Home;
  ageDays: number;        // whole days, floored — for display
  silent: boolean;        // comments === 0 && age > SILENT_AFTER_DAYS (exact ms, not floored)
}

export interface Report {
  open: number;
  homed: Classified[];
  owed: Classified[];
}

/**
 * Does `text` mention issue `n`? Accepts `#<n>` and the URL form `issues/<n>`.
 *
 * ANCHORED ON THE TAIL, deliberately: the number must be followed by a non-digit or the end
 * of text, so `#51` does not match `#519` and `#519` does not match `#5190`. The head needs
 * no anchor — `#` (or `issues/`) is itself the delimiter, and `#519` inside `##519` or
 * `issue#519` is still a mention of 519.
 */
export function mentions(text: string, n: number): boolean {
  if (!Number.isInteger(n) || n <= 0) return false;
  return new RegExp(`(?:#|\\bissues/)${n}(?![0-9])`).test(text);
}

export function classifyIssue(issue: Issue, gapsText: string, queueText: string, nowMs: number): Classified {
  const inGap = mentions(gapsText, issue.number);
  const inDpa = mentions(queueText, issue.number);
  const home: Home = inGap && inDpa ? "HOMED-BOTH" : inGap ? "HOMED-GAP" : inDpa ? "HOMED-DPA" : "OWED";
  const created = Date.parse(issue.createdAt);
  const ageMs = Number.isFinite(created) ? Math.max(0, nowMs - created) : 0;
  return {
    ...issue,
    labels: issue.labels ?? [],
    home,
    ageDays: Math.floor(ageMs / DAY_MS),
    silent: issue.comments === 0 && ageMs > SILENT_AFTER_DAYS * DAY_MS,
  };
}

/** Oldest first within each bucket — the longest silence is the loudest. */
export function classify(issues: Issue[], gapsText: string, queueText: string, nowMs: number): Report {
  const all = issues.map((i) => classifyIssue(i, gapsText, queueText, nowMs));
  const byAge = (a: Classified, b: Classified) => b.ageDays - a.ageDays || a.number - b.number;
  return {
    open: all.length,
    homed: all.filter((c) => c.home !== "OWED").sort(byAge),
    owed: all.filter((c) => c.home === "OWED").sort(byAge),
  };
}

// ── gh (the only external dependency) ─────────────────────────────────────────

interface RawIssue { number: number; title: string; createdAt: string; comments?: unknown[]; labels?: Array<{ name: string }> }

function fetchOpenIssues(repo: string, limit: number): Issue[] {
  const r = spawnSync(
    "gh",
    ["issue", "list", "--repo", repo, "--state", "open", "--limit", String(limit),
     "--json", "number,title,createdAt,labels,comments"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  );
  if (r.error) throw new Error((r.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? "gh timed out (60s)" : (r.error as Error).message);
  if (r.status !== 0) throw new Error(`gh issue list failed (exit ${r.status}): ${(r.stderr || "").trim()}`);
  const raw = JSON.parse(r.stdout || "[]") as RawIssue[];
  return raw.map((i) => ({
    number: i.number,
    title: i.title ?? "",
    createdAt: i.createdAt ?? "",
    comments: Array.isArray(i.comments) ? i.comments.length : 0,
    labels: (i.labels ?? []).map((l) => l.name),
  }));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function argValue(argv: string[], name: string): string | undefined {
  // accepts `--name=value` and `--name value`
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === name) return argv[i + 1];
    if (a.startsWith(name + "=")) return a.slice(name.length + 1);
  }
  return undefined;
}

function readLedger(rel: string, override?: string): { text: string; path: string; found: boolean } {
  const path = override ?? `${ROOT}/${rel}`;
  const found = existsSync(path);
  return { text: found ? readFileSync(path, "utf8") : "", path, found };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.split("=")[0]));
  const JSON_MODE = flags.has("--json");
  const CHECK_MODE = flags.has("--check");
  const repo = argValue(argv, "--repo") ?? DEFAULT_REPO;

  const nowArg = argValue(argv, "--now");
  const nowMs = nowArg === undefined ? Date.now() : Date.parse(nowArg);
  if (!Number.isFinite(nowMs)) {
    console.error(`issue-debt: --now must be an ISO date (got ${JSON.stringify(nowArg)})`);
    process.exit(2); // usage error, not detection
  }

  const limitArg = Number(argValue(argv, "--limit") ?? 200);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 200;

  const gaps = readLedger(GAPS_LEDGER, argValue(argv, "--gaps"));
  const queue = readLedger(DPA_QUEUE, argValue(argv, "--queue"));

  let issues: Issue[];
  let widened = limit;
  try {
    issues = fetchOpenIssues(repo, widened);
    // TRUNCATION GUARD + AUTO-WIDEN (§8 truncated probe; the review-debt.ts shape). gh returns
    // min(limit, total), so `rows < limit` PROVES completeness. `rows == limit` may be a cut —
    // widen until it is not, or until the ceiling; the ceiling case is reported, never hidden.
    const WIDEN_CEILING = 2000;
    while (issues.length >= widened && widened < WIDEN_CEILING) {
      widened = Math.min(widened * 4, WIDEN_CEILING);
      issues = fetchOpenIssues(repo, widened);
    }
  } catch (e) {
    // Never fail a boot on a network/auth hiccup — report and move on. A probe that breaks the
    // boot is a probe that gets removed. NOT-VERIFIED is a distinct state from 0 OWED.
    const msg = (e as Error).message;
    if (JSON_MODE) {
      console.log(JSON.stringify({ repo, now: new Date(nowMs).toISOString(), open: null, error: msg, homed: [], owed: [] }, null, 2));
    } else {
      console.log(`issue-debt: UNAVAILABLE (${msg})`);
      console.log("  gh unreachable — issue homes NOT verified this session. Say so in the boot report.");
    }
    process.exit(0);
  }
  const truncated = issues.length >= widened;

  const report = classify(issues, gaps.text, queue.text, nowMs);

  if (JSON_MODE) {
    console.log(JSON.stringify({
      repo, now: new Date(nowMs).toISOString(), open: report.open, truncated,
      ledgers: { gaps: { path: gaps.path, found: gaps.found }, queue: { path: queue.path, found: queue.found } },
      homed: report.homed, owed: report.owed,
    }, null, 2));
    process.exit(CHECK_MODE && report.owed.length > 0 ? 1 : 0);
  }

  const short = (s: string, n = 84) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);
  const openStr = truncated ? `${report.open} open (of ≥${report.open} — SCAN MAY BE TRUNCATED at --limit ${widened})` : `${report.open} open`;
  console.log(`issue-debt — ${openStr} · ${report.homed.length} homed · ${report.owed.length} OWED`);
  if (widened !== limit && !truncated) console.log(`  (scan auto-widened ${limit} → ${widened} to prove the enumeration complete)`);
  if (!gaps.found) console.log(`  ⚠️ ${GAPS_LEDGER} NOT FOUND at ${gaps.path} — no issue can read HOMED-GAP; every OWED below may be a missing-ledger artefact.`);
  if (!queue.found) console.log(`  ⚠️ ${DPA_QUEUE} NOT FOUND at ${queue.path} — no issue can read HOMED-DPA.`);

  if (report.owed.length > 0) {
    console.log("");
    for (const c of report.owed) {
      const tag = c.silent ? "⚠️ SILENT" : "⚠️ OWED  ";
      console.log(`  ${tag}  #${c.number}  ${String(c.ageDays).padStart(3)}d  ${c.comments} comment${c.comments === 1 ? "" : "s"}  ${short(c.title)}`);
    }
    console.log("");
    console.log(`  Each OWED issue needs a HOME naming #<n>: a ${GAPS_LEDGER} entry (bug / DX) or a ${DPA_QUEUE} item`);
    console.log(`  (direction question) — and an ack comment on the issue (the S310 return leg). SILENT = 0 comments and >${SILENT_AFTER_DAYS} days old.`);
  }
  if (report.homed.length > 0) {
    console.log("");
    for (const c of report.homed) {
      console.log(`  ✓ ${c.home.padEnd(10)}  #${c.number}  ${String(c.ageDays).padStart(3)}d  ${c.comments} comment${c.comments === 1 ? "" : "s"}${c.silent ? "  (silent on the issue)" : ""}  ${short(c.title, 72)}`);
    }
  }
  if (report.open === 0) console.log("  ✅ no open issues");
  else if (report.owed.length === 0) console.log("  ✅ every open issue has a home");

  if (CHECK_MODE && report.owed.length > 0) process.exit(1);
}
