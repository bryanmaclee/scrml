#!/usr/bin/env node
// Per-REPO Claude Code status line — a bold COLORED repo bar so a glance tells you which repository
// this terminal is in (the repo↔repo mix-up guard). Self-contained + committed to THIS repo, so it
// syncs to every machine via git and OVERRIDES the global statusline for this repo only. It keeps
// everything the global bar shows (branch · model · ctx/5h/wk gauges) and just adds the color.
//
// ┌─ TO PICK THIS REPO'S COLOR: change COLOR to a 256-color code. ───────────────────────────────────┐
// │  27 blue · 208 orange · 28 green · 129 purple · 160 red · 100 olive · 39 cyan · 201 magenta       │
// │  (FG is the text on that bar — 231 white for dark colors, 16 black for light ones.)               │
// └───────────────────────────────────────────────────────────────────────────────────────────────────┘
const COLOR = 208;   // ← scrml = orange
const FG = 231;

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const R = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const SEP = `${DIM}·${R}`;
const tint = (pct) => (pct >= 50 ? '\x1b[32m' : pct >= 20 ? '\x1b[33m' : '\x1b[31m');

function readStdin() { try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return {}; } }

// Read .git/HEAD directly rather than spawning git — this runs on every render.
function branchOf(dir) {
  if (!dir) return null;
  try {
    const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: ') ? head.slice(5).replace('refs/heads/', '') : head.slice(0, 7);
  } catch { return null; }
}

function untilReset(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return mins % 60 ? `${hrs}h${mins % 60}m` : `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function gauge(label, leftPct, resetsAt) {
  const pct = Math.max(0, Math.min(100, Math.round(leftPct)));
  const reset = pct < 25 ? untilReset(resetsAt) : null;
  return `${DIM}${label}${R} ${tint(pct)}${pct}%${R}${reset ? `${DIM} ${reset}${R}` : ''}`;
}

const d = readStdin();
const dir = d.workspace?.current_dir || d.cwd || '';
const parts = [];

// ── the colored repo bar (this repo's signature) ──
const name = dir.split(/[\\/]/).filter(Boolean).pop() || '?';
parts.push(`\x1b[48;5;${COLOR}m\x1b[38;5;${FG}m${BOLD} ${name} ${R}`);

const branch = branchOf(dir);
if (branch) parts.push(`${DIM}⎇ ${branch}${R}`);
if (d.model?.display_name) parts.push(`${DIM}${d.model.display_name}${R}`);

const gauges = [];
const ctx = d.context_window;
if (typeof ctx?.remaining_percentage === 'number') gauges.push(gauge('ctx', ctx.remaining_percentage));
const rl = d.rate_limits;
if (typeof rl?.five_hour?.used_percentage === 'number') gauges.push(gauge('5h', 100 - rl.five_hour.used_percentage, rl.five_hour.resets_at));
if (typeof rl?.seven_day?.used_percentage === 'number') gauges.push(gauge('wk', 100 - rl.seven_day.used_percentage, rl.seven_day.resets_at));
if (gauges.length) parts.push(`${DIM}left${R} ${gauges.join(' ')}`);

process.stdout.write(parts.join(` ${SEP} `));
