#!/usr/bin/env bun
/**
 * scripts/dpa-debt.ts — the DELIBERATION-QUEUE probe.
 *
 * WHY THIS EXISTS (S337). `handOffs/dpa-queue.md` is the ONE file the dPA drains, and until now
 * **no boot probe read it.** The boot gate probes review-debt, the thread-board, gh issues/PRs and
 * CI — every inbound channel except the deliberation queue. Measured cost:
 *
 *   - **dpa-024** sat `BANKED — UNRUN` from S331 to S337 (6 sessions). The PA had filed its Q4 under
 *     "OWED BY BRYAN" — but Q4 was the question only the DD could answer, so it landed in a list
 *     where it could never move, while bryan waited on the agreed "say when it's ready" signal.
 *     He surfaced it himself: *"i never saw the results of the perfect compiler dpa."*
 *   - **dpa-022 / dpa-023** read `BANKED — UNRUN` for a full day AFTER they had run, and one of them
 *     had already had its re-ruling request acted on. Corrected by hand at S325.
 *
 * This is `pa-base` §10's most-repeated failure: **an obligation recorded in one artifact while
 * every probe reads another.** The rule it discharges: *a channel the probe does not read does not
 * exist to the PA.*
 *
 * WHAT IT READS, AND WHY THAT SURFACE. The queue states, in its own words, that the PA-maintained
 * status TABLE "SUPERSEDES the per-item `status:` lines" and to "trust this table over any per-item
 * status line". So the table is the authoritative surface and this probe reads it. Reading the
 * per-item lines instead would reproduce the exact obligation/probe mismatch this file exists to close.
 *
 * BIDIRECTIONAL, deliberately. It ALSO parses the per-item `status:` lines and reports any
 * DISAGREEMENT with the table — because the dpa-022/023 miss was a STALE TABLE, and a probe that
 * trusts the authoritative surface unconditionally cannot see that surface go wrong.
 *
 * DETECTION, NOT CONTROL. Never gates, never in CI (a red-over-backlog gate is the §8 cry-wolf shape
 * that gets bypassed and then deleted). It prints what is owed; the PA states the number at boot.
 */

import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const QUEUE = `${ROOT}/handOffs/dpa-queue.md`;

interface Row { id: string; state: string; raw: string; }

/**
 * Classify a row from its dPA-status cell (col 2) AND its ratification cell (col 3).
 *
 * ANCHORED TO THE LEADING TOKEN, deliberately. A `contains` test reports dpa-022/023 as UNRUN
 * because their cells NARRATE the string ("this row read \"BANKED — UNRUN\" until S325 corrected
 * it") — a false positive on the very rows whose past staleness motivated this probe. Same
 * unanchored-match class as the boot gate's PICKUP `indexOf` bug (#492) and the S337 ledger-section
 * regex: the THIRD instance, so it is anchored here by construction.
 *
 * Ratification lives in COLUMN 3, not column 2 — the dPA never flips a row to `ratified`
 * (RUN-not-RATIFY), so a row can read "COMPLETE (ADVISORY)" in col 2 while col 3 records the PA's
 * ratification. Reading col 2 alone reports dpa-019/020/021 as owed when they were RATIFIED S319.
 */
function classify(statusCell: string, ruleCell: string): string {
  if (/\bRATIFIED\b/i.test(ruleCell)) return "ratified";
  const head = statusCell.replace(/[*_`\s]+/g, " ").trim().toUpperCase();
  if (/^BANKED\s*[—-]\s*UNRUN/.test(head)) return "unrun";
  if (/^RATIFIED\b/.test(head)) return "ratified";
  if (/^COMPLETE\b/.test(head)) return "advisory";
  if (/^(ROUTED|DECLINE)/.test(head)) return "routed";
  return "other";
}

const text = existsSync(QUEUE) ? readFileSync(QUEUE, "utf8") : "";
if (!text) { console.log(`dpa-debt — queue not found at ${QUEUE}`); process.exit(0); }

// ── the authoritative TABLE ────────────────────────────────────────────────────
const rows: Row[] = [];
for (const line of text.split("\n")) {
  const m = line.match(/^\|\s*(dpa-\d+)\s*\|(.*)$/i);
  if (!m) continue;
  const cells = m[2].split("|");
  const statusCell = cells[0] ?? "";
  const ruleCell = cells[1] ?? "";
  rows.push({ id: m[1].toLowerCase(), state: classify(statusCell, ruleCell), raw: statusCell.trim() });
}

// ── the per-item `status:` lines (cross-check ONLY, never authority) ───────────
const items = new Map<string, string>();
{
  const lines = text.split("\n");
  let cur = "";
  for (const line of lines) {
    const h = line.match(/^##\s+(dpa-\d+)\s*—/i);
    if (h) { cur = h[1].toLowerCase(); continue; }
    const st = line.match(/^status:\s*(\S+)/);
    if (st && cur && !items.has(cur)) items.set(cur, st[1].toLowerCase());
  }
}

const unrun = rows.filter((r) => r.state === "unrun");
const advisory = rows.filter((r) => r.state === "advisory");

// table-vs-item disagreement — the dpa-022/023 shape (a STALE TABLE)
const drift: string[] = [];
for (const r of rows) {
  const it = items.get(r.id);
  if (!it) continue;
  const tableSaysUnrun = r.state === "unrun";
  const itemSaysRun = it === "complete" || it === "ratified";
  if (tableSaysUnrun && itemSaysRun) drift.push(`${r.id}: table=UNRUN but item status=${it} — the S325 shape (table stale); VERIFY which is true before acting`);
  if (r.state === "ratified" && it === "banked") drift.push(`${r.id}: table=RATIFIED but item status=banked`);
}

const short = (s: string, n = 96) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

console.log(`dpa-debt — ${rows.length} queued items · ${unrun.length} UNRUN (need firing) · ${advisory.length} ADVISORY (need ratify/reject)`);

if (unrun.length) {
  console.log(`\n  ⚠️ UNRUN — banked but never run. bryan fires the dPA; the PA owes the "it is ready" signal.`);
  for (const r of unrun) console.log(`     ${r.id}  ${short(r.raw.replace(/\*\*/g, ""))}`);
}
if (advisory.length) {
  console.log(`\n  ⚠️ ADVISORY — ran, unratified. Each needs ratify / reject / re-frame.`);
  for (const r of advisory) console.log(`     ${r.id}  ${short(r.raw.replace(/\*\*/g, ""))}`);
}
if (drift.length) {
  console.log(`\n  ⛔ TABLE/ITEM DISAGREEMENT — the status table is the authority, and it may be STALE:`);
  for (const d of drift) console.log(`     ${d}`);
}
if (!unrun.length && !advisory.length && !drift.length) console.log(`  ✓ nothing owed — no unrun, no unratified, no drift.`);
