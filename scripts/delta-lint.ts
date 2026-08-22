#!/usr/bin/env bun
/**
 * delta-lint — the delta-log sequence integrity check.
 *
 * WHY THIS EXISTS (S354). `handOffs/delta-log.md` numbers entries `[NNNN]` from a single
 * shared counter, and its own header states a **single-writer rule** ("only the LIVE PA
 * appends"). That invariant stopped being true when the project went to two concurrent
 * operators. It was never updated, so both sessions read the same max and both append
 * N+1 — SEVEN collisions in one window, each resolved by a hand-written renumber.
 *
 * DUPLICATES ARE NOT COSMETIC. The flogence bridge and `scripts/state.ts` both parse
 * `^\[(\d+)\]\s+(\S+)\s+·\s+(.*)$` and the bridge uses the number as a CHECKPOINT CURSOR
 * (`last_seq`). Given two entries sharing a number, the first to merge advances the
 * cursor past both — and the second is skipped as already-absorbed. A duplicate silently
 * DROPS an entry from the digest. That is the failure this gate exists to prevent.
 *
 * The companion change is `.gitattributes` (`merge=union`), which stops the tail-append
 * conflict happening at all: both sides' lines are kept automatically. That trades a
 * merge conflict for a duplicate — which is the right trade only because this check is
 * loud about duplicates. The two land together; neither is sufficient alone.
 *
 * NOT A MONOTONICITY CHECK. Under union-merge two sessions' entries interleave by content,
 * not by number, and that is fine — the cursor only needs uniqueness and a max. Ordering
 * is deliberately NOT enforced; enforcing it would fail every honest concurrent merge.
 *
 * Usage:
 *   bun scripts/delta-lint.ts            # check; exit 1 on duplicates
 *   bun scripts/delta-lint.ts --fix      # renumber duplicates: first occurrence keeps its
 *                                        # number, each later one moves to max+1 in file order
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "handOffs/delta-log.md");
const BASELINE = join(ROOT, "handOffs/delta-log-dupes.baseline.json");
const FIX = process.argv.includes("--fix");

// PRE-EXISTING DEBT IS BASELINED, NOT ENFORCED (pa-base §8). Nine duplicates already sit in
// the live scope, every one a multi-writer collision from before this gate existed. A check
// that is instantly red for reasons no change caused gets bypassed and then deleted — the
// repo says so in its own CI comments — so the baseline carries them and only a NEW duplicate
// fails. The baseline is a debt ledger: it may shrink, and it must never grow silently.
const baselined: Set<number> = new Set(
  existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")).duplicates ?? []) : [],
);

// The EXACT shape both consumers parse. Keep in lockstep with scripts/state.ts:~579 and
// flogence src/ports/bridge-tool.scrml — a divergence here is a silently different population.
const ENTRY = /^\[(\d+)\]\s+(\S+)\s+·\s+(.*)$/;

const lines = readFileSync(LOG, "utf8").split("\n");

// SCOPE. The log numbered PER-SESSION until `## Session 236` (2026-07-03) and has run on a
// single global counter since, with no further section headers. Both consumers agree with
// that: `scripts/state.ts` splits on /^## Session /m and reads only the LAST section, and the
// flogence bridge checkpoints on the (session, seq) PAIR. So uniqueness is required within
// the final section, NOT across the whole file — the 46 "duplicates" a whole-file scan
// reports are the historical per-session [1],[2],… and are correct as they stand.
const lastHeader = lines.reduce((acc, ln, i) => (/^## Session /.test(ln) ? i : acc), -1);
const SCOPE_START = lastHeader + 1;

const seen = new Map<number, number[]>();          // seq -> line numbers (1-based)
for (let i = SCOPE_START; i < lines.length; i++) {
  const m = lines[i].match(ENTRY);
  if (!m) continue;
  const seq = parseInt(m[1], 10);
  seen.set(seq, [...(seen.get(seq) ?? []), i + 1]);
}

const dupes = [...seen.entries()].filter(([, ls]) => ls.length > 1).sort((a, b) => a[0] - b[0]);
const total = [...seen.values()].reduce((n, ls) => n + ls.length, 0);
const maxSeq = seen.size ? Math.max(...seen.keys()) : 0;

const fresh = dupes.filter(([seq]) => !baselined.has(seq));
const carried = dupes.filter(([seq]) => baselined.has(seq));

if (carried.length) {
  console.log(`delta-lint — ${carried.length} baselined duplicate(s) carried as known debt: ${carried.map(([s2]) => `[${s2}]`).join(" ")}`);
}
if (baselined.size && !carried.length) {
  console.log(`delta-lint — baseline lists ${baselined.size} duplicate(s) that no longer occur; shrink handOffs/delta-log-dupes.baseline.json`);
}

if (!fresh.length) {
  console.log(`delta-lint — ${total} entries in the live scope (from line ${SCOPE_START + 1}), ${seen.size} distinct sequence numbers, max [${maxSeq}] — PASS`);
  process.exit(0);
}

console.error(`delta-lint FAILED — ${fresh.length} NEW duplicated sequence number(s) across ${total} entries:\n`);
for (const [seq, ls] of fresh) {
  console.error(`  [${seq}] appears ${ls.length}× at lines ${ls.join(", ")}`);
  for (const ln of ls) console.error(`        ${lines[ln - 1].slice(0, 100)}`);
}

if (!FIX) {
  console.error(`\nA duplicate is not cosmetic: the flogence bridge uses the sequence as a checkpoint`);
  console.error(`cursor, so the second entry to merge is skipped as already-absorbed and DROPS OUT`);
  console.error(`of the digest.\n`);
  console.error(`Fix:  bun scripts/delta-lint.ts --fix   (first occurrence keeps its number;`);
  console.error(`      each later one is renumbered to max+1 in file order)`);
  process.exit(1);
}

let next = maxSeq + 1;
const moved: string[] = [];
for (const [seq, ls] of fresh) {
  for (const ln of ls.slice(1)) {                  // first occurrence keeps the number
    lines[ln - 1] = lines[ln - 1].replace(/^\[\d+\]/, `[${next}]`);
    moved.push(`  [${seq}] (line ${ln}) -> [${next}]`);
    next++;
  }
}
writeFileSync(LOG, lines.join("\n"));
console.error(`\nRenumbered ${moved.length} duplicate entr${moved.length === 1 ? "y" : "ies"}:`);
for (const m of moved) console.error(m);
console.error(`\nRe-run without --fix to confirm.`);
