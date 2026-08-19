#!/usr/bin/env bun
/**
 * scripts/ruling-debt.ts — the RULING-BANKED-OUTSIDE-THE-DRAIN-PATH probe.
 *
 * WHY THIS EXISTS. `scripts/dpa-debt.ts` closed the hole where nothing read the deliberation queue.
 * It left the complementary one open: **the dPA drains `handOffs/dpa-queue.md` and NOTHING ELSE, so
 * a ruling-shaped artifact filed anywhere else never runs and no probe notices.** Same `pa-base` §10
 * shape as its sibling, inverted — dpa-debt asks "is everything in the queue disposed?", this asks
 * "is everything that needs disposing IN the queue?"
 *
 * Measured on this repo the day it was written, against `origin/main`, TWO artifacts were banked
 * outside the drain path:
 *
 *   - `docs/audits/sliding-doors-corpus-zero-2026-08-16/rulings-pending/R5-d1-no-editions.md`
 *     — prepared S348, hand-delivered as `dpa-034` only after a human noticed.
 *   - `docs/rulings-pending/dpa-029-Q1-egress-envelope.md`
 *     — prepared S349, still unqueued, in a `rulings-pending/` directory at a DIFFERENT level of
 *       the tree than the first one.
 *
 * That second find is why the probe does not hardcode a path. Two of these already exist in two
 * places; a third will be filed in a third. So the surface is defined two ways, and a hit on either
 * counts:
 *
 *   1. **positional** — any `*.md` inside any directory named `rulings-pending`, at any depth.
 *   2. **structural** — any `*.md` under `docs/` whose YAML front matter carries `authority-needed:`.
 *      This is the stronger signal: it catches a ruling filed in a directory nobody thought to name
 *      correctly, which is precisely how both known instances happened.
 *
 * LINKED ⟺ the queue text mentions the artifact's path or its basename. Deliberately loose: the
 * queue is prose plus a table, and an artifact is drainable the moment the queue points at it. A
 * stricter parse would go red over correct entries, which is the §8 cry-wolf shape.
 *
 * DETECTION, NOT CONTROL. Exits 0 whatever it finds. Never gates, never in CI.
 *
 * TESTABILITY. `SCRML_SUPPORT` and `SCRML_DPA_QUEUE` override the two inputs. They exist so the
 * probe's BITE can be proven — §8: a gate that has never failed is indistinguishable from one that
 * cannot fail — without mutating the real artifacts to do it. Neither is set in normal operation.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

/**
 * The support repo is a SIBLING of the scrml checkout. When this runs from a git worktree
 * (`.claude/worktrees/agent-x`) the plain `../scrml-support` guess lands in the worktrees
 * directory, so walk up until a sibling with that name appears.
 */
function resolveSupport(): string | null {
  if (process.env.SCRML_SUPPORT) return process.env.SCRML_SUPPORT;
  let dir = ROOT;
  for (let i = 0; i < 8; i++) {
    const cand = `${dir}/../scrml-support`;
    if (existsSync(cand)) return cand;
    const up = dir.replace(/[\\/][^\\/]+$/, "");
    if (!up || up === dir) break;
    dir = up;
  }
  return null;
}

const SUPPORT = resolveSupport();
const QUEUE = process.env.SCRML_DPA_QUEUE ?? `${ROOT}/handOffs/dpa-queue.md`;

if (!SUPPORT) {
  console.log("ruling-debt — no sibling `scrml-support` checkout found; cannot read the ruling surface.");
  process.exit(0);
}
if (!existsSync(QUEUE)) {
  console.log(`ruling-debt — deliberation queue not found at ${QUEUE}; cannot establish what is drained.`);
  process.exit(0);
}

const queueText = readFileSync(QUEUE, "utf8");

// ── walk the doc surface ──────────────────────────────────────────────────────
const SKIP_DIRS = new Set([".git", "node_modules", ".claude", "dist"]);

function walkMarkdown(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = `${dir}/${name}`;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMarkdown(full, acc);
    else if (name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

/** `authority-needed:` inside the leading `---` front-matter block only. */
function hasAuthorityNeeded(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (!text.startsWith("---")) return false;
  const end = text.indexOf("\n---", 3);
  const fm = end < 0 ? text.slice(0, 2000) : text.slice(0, end);
  return /^authority-needed:/m.test(fm);
}

const docsRoot = `${SUPPORT}/docs`;
const allDocs = existsSync(docsRoot) ? walkMarkdown(docsRoot) : [];

interface Candidate { rel: string; positional: boolean; structural: boolean; }

const candidates = new Map<string, Candidate>();
for (const full of allDocs) {
  const rel = full.slice(SUPPORT.length + 1).replace(/\\/g, "/");
  const positional = /(^|\/)rulings-pending\//.test(rel);
  const structural = hasAuthorityNeeded(full);
  if (!positional && !structural) continue;
  candidates.set(rel, { rel, positional, structural });
}

// ── linkage ───────────────────────────────────────────────────────────────────
function isLinked(rel: string): boolean {
  if (queueText.includes(rel)) return true;
  const base = rel.split("/").pop()!;
  return queueText.includes(base);
}

const list = [...candidates.values()].sort((a, b) => a.rel.localeCompare(b.rel));
const unlinked = list.filter((c) => !isLinked(c.rel));

// ── report ────────────────────────────────────────────────────────────────────
const why = (c: Candidate) =>
  c.positional && c.structural ? "in rulings-pending/ + authority-needed:" : c.positional ? "in rulings-pending/" : "authority-needed: front matter";

console.log(
  `ruling-debt — ${list.length} ruling-shaped artifacts in scrml-support/docs · ` +
    `${list.length - unlinked.length} referenced by the dPA queue · ${unlinked.length} BANKED OUTSIDE THE DRAIN PATH`
);

if (!unlinked.length) {
  console.log("  ✓ every ruling-shaped artifact is reachable from handOffs/dpa-queue.md.");
  process.exit(0);
}

console.log(
  `\n  ⚠️ OUTSIDE THE DRAIN PATH — the dPA drains handOffs/dpa-queue.md and nothing else, so these` +
    `\n     will never run. Add a queue entry naming the artifact, or record why it is moot.`
);
for (const c of unlinked) console.log(`     ${c.rel}\n        detected by: ${why(c)}`);
