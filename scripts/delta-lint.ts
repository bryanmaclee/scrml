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
 * DUPLICATES ARE NOT COSMETIC. The flogence bridge and `scripts/state.ts` both parse the same
 * `[NNNN] <kind> · <body>` entry shape (see ENTRY below) and the bridge uses the number as a CHECKPOINT CURSOR
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
 *   bun scripts/delta-lint.ts            # check; exit 1 on duplicates, exit 2 on an unreadable scope
 *   bun scripts/delta-lint.ts --fix      # renumber duplicates: first occurrence keeps its
 *                                        # number, each later one moves to max+1 in file order.
 *                                        # REFUSES unless every bracketed line parsed (S365).
 *
 * EXIT CODES. 0 pass · 1 a NEW duplicate · 2 the parser could not account for the population —
 * either it saw NONE of it (refuseDegenerateScope) or only PART of it (refuseUnparsedEntries).
 * Both are "the instrument is broken", not "the log is", which is why they share an exit code
 * distinct from 1 and why neither is reachable as a PASS.
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
//
// THE OPTIONAL MARKER (S365). The shape was `[NNNN] <kind> · <body>` — three tokens. The writing
// convention drifted to `[NNNN] <emoji> <kind> · <body>` — four — and the narrow regex could not
// parse it, so FOUR live entries ([561] [562] [565] [727]) were invisible to this gate AND to the
// digest projection while the gate printed PASS at exit 0. That is the silent-drop class this
// gate exists to catch, happening inside the instrument.
//
// The widen is DELIBERATELY NARROW: the optional leading token must START with a non-word,
// non-space character (`[^\w\s]` — an emoji or a symbol), so it accepts the real convention and
// NOTHING ELSE. `[9] two words · body` still does not parse, and refuseUnparsedEntries() below
// then names it. A permissive widen (`(?:\S+\s+)?`) would have swallowed these four AND the next
// drift; the point is to see drift, not to stop failing on it.
//
// Named groups, not indices: adding a capture in the middle silently reindexes every consumer,
// which is the same class of quiet breakage.
const ENTRY = /^\[(?<seq>\d+)\]\s+(?:(?<marker>[^\w\s]\S*)\s+)?(?<kind>\S+)\s+·\s+(?<body>.*)$/;

// A line that CLAIMS to be an entry: it opens with `[NNNN]`. The population this gate must account
// for is bracketed lines, NOT parsed ones — the difference between the two is exactly the blindness.
const BRACKETED = /^\[\d+\]/;

const raw = readFileSync(LOG, "utf8");
// Split on /\r?\n/, not "\n": on a CRLF checkout (Windows, core.autocrlf=true) a plain "\n" split
// leaves a trailing \r on every line, so the ENTRY-shape match below fails on all of them and the lint
// mis-reports a fully-unparsed log locally (same class as state.ts parseDeltaLog, S378). LF-identical.
const lines = raw.split(/\r?\n/);

// SCOPE. The log numbered PER-SESSION until `## Session 236` (2026-07-03) and has run on a
// single global counter since, with no further section headers. Both consumers agree with
// that: `scripts/state.ts` splits on /^## Session /m and reads only the LAST section, and the
// flogence bridge checkpoints on the (session, seq) PAIR. So uniqueness is required within
// the final section, NOT across the whole file — the 46 "duplicates" a whole-file scan
// reports are the historical per-session [1],[2],… and are correct as they stand.
const lastHeader = lines.reduce((acc, ln, i) => (/^## Session /.test(ln) ? i : acc), -1);
const SCOPE_START = lastHeader + 1;

const seen = new Map<number, number[]>();          // seq -> line numbers (1-based)
const unparsed: number[] = [];                     // bracketed but NOT matched — line numbers (1-based)
let bracketed = 0;
for (let i = SCOPE_START; i < lines.length; i++) {
  if (!BRACKETED.test(lines[i])) continue;
  bracketed++;
  const m = lines[i].match(ENTRY);
  if (!m) { unparsed.push(i + 1); continue; }
  const seq = parseInt(m.groups!.seq, 10);
  seen.set(seq, [...(seen.get(seq) ?? []), i + 1]);
}

const dupes = [...seen.entries()].filter(([, ls]) => ls.length > 1).sort((a, b) => a[0] - b[0]);
const total = [...seen.values()].reduce((n, ls) => n + ls.length, 0);
const maxSeq = seen.size ? Math.max(...seen.keys()) : 0;

/**
 * REFUSE A DEGENERATE SCOPE (S365).
 *
 * This gate was shipped inside the PR whose entire purpose was to stop a silent entry-drop, and
 * it had the silent-drop shape itself: with ZERO entries parsed it fell through to the `!fresh.length`
 * branch and printed `— PASS` at exit 0. Measured, all three directly (`cmd; echo $?`, never through
 * a pipe, which reports the pipe's status and cannot fail):
 *
 *   real NEW duplicate, canonical `·` separator ......... exit 1   correct
 *   THE SAME DUPLICATE, separator drifted `·` -> `-` .... exit 0   "0 entries in the live scope … — PASS"
 *   empty file .......................................... exit 0   PASS
 *
 * So the gate reported PASS over a file containing the very defect it exists to catch, and the
 * blinder the parser got the greener it read. Worse, in that state it also printed
 * "baseline lists 9 duplicate(s) that no longer occur; shrink …" — actively advising the deletion
 * of the debt ledger recording nine real collisions, on the strength of a measurement of nothing.
 *
 * ZERO IS NEVER A LEGITIMATE READING HERE. `handOffs/delta-log.md` is tracked, append-only, and
 * has carried entries continuously since 2026-07-03; the live scope cannot honestly empty. Nor is
 * "the file is empty so there is nothing to check" a defence — a truncated log is the WORST of the
 * failure modes this gate covers, not an exemption from it. So the refusal is unconditional on
 * zero, exactly as `scripts/facts.ts` refuses any counter that reads 0 and `scripts/state.ts`
 * refuses a ledger that yields no markers. Exit 2, distinct from the duplicate exit 1: this is
 * "the instrument is not reading the log", not "the log has a duplicate".
 *
 * The diagnosis names the root cause rather than the symptom, because the two shapes have
 * different fixes: bracketed-but-unparsed means the ENTRY SHAPE drifted (and both consumers are
 * therefore reading an empty log too); nothing-bracketed-at-all means truncation, or a stray
 * `## Session ` header that moved SCOPE_START past every entry.
 *
 * THIS GUARD COVERS THE TOTAL CASE ONLY. It consulted `bracketed` only inside `total === 0`, so a
 * PARTIAL drift — enough entries still parsing that the output looked healthy — walked straight
 * past it. refuseUnparsedEntries() below is the partial case; the two are siblings and both are
 * exit 2. See S365 / g-delta-lint-partially-blind-on-emoji-kind-entries.
 */
function refuseDegenerateScope(): void {
  if (total > 0) return;

  console.error("delta-lint: MEASURED ZERO — refusing to report on a population it cannot see.\n");
  console.error(
    `  handOffs/delta-log.md is ${raw.length} bytes; the live scope starts at line ${SCOPE_START + 1} ` +
      `and the entry parser matched ZERO entries in it.`,
  );
  if (bracketed > 0) {
    console.error(
      `  ${bracketed} line(s) in that scope DO start with [NNNN] but none matched ${ENTRY} —\n` +
        `  the ENTRY SHAPE has drifted (most often the \`·\` separator). scripts/state.ts and the\n` +
        `  flogence bridge parse this same shape, so they are reading an empty log too.`,
    );
  } else if (raw.trim().length === 0) {
    console.error(`  The file is empty. The log has been truncated to nothing.`);
  } else {
    console.error(
      `  No line in that scope even begins with [NNNN] — the log has been truncated, or a stray\n` +
        `  \`## Session \` header has moved the scope past every entry.`,
    );
  }
  console.error(
    `\n  A PASS over zero entries is not a finding, it is the absence of one. This gate exists to\n` +
      `  stop an entry silently dropping out of the digest; reporting green while parsing nothing\n` +
      `  would drop every entry at once and call it clean.`,
  );
  process.exit(2);
}
refuseDegenerateScope();

/**
 * REFUSE A PARTIAL PARSE (S365) — the sibling of refuseDegenerateScope, for the case where the
 * parser sees SOME of the population.
 *
 * MEASURED ON THE LIVE FILE, at exit 0, by a gate that had already been hardened once against the
 * TOTAL-blindness version of this same defect:
 *
 *   bracketed lines in the live scope ... 1405
 *   ENTRY-matched ....................... 1401
 *   BRACKETED BUT UNPARSED ..............    4   [561] [562] [565] [727]
 *
 * The gate printed `1401 entries in the live scope … — PASS`. It was not reporting a smaller
 * number as a warning; it did not know those lines were entries. A duplicate hiding among those
 * four would have been reported clean, which is precisely the entry-silently-drops-from-the-digest
 * failure this whole file exists to prevent.
 *
 * WHY IT SURVIVED THE ZERO-POPULATION GUARD. That guard computed `bracketed` and consulted it only
 * inside the `total === 0` branch. The all-or-nothing shape is the bug: partial blindness READS
 * HEALTHIER THE MORE ENTRIES STILL PARSE, so the louder failure (total) was caught and the quieter,
 * likelier one (partial) was not. The same fix round applied exactly this partial-vs-total insight
 * to scripts/corpus-zero-debt.ts (all-or-nothing guard -> per-root guard) and did not carry it one
 * file over.
 *
 * WHY THIS IS NOT SOLVED BY THE WIDEN ALONE. Widening ENTRY to accept `[NNNN] <emoji> <kind> · body`
 * fixes THESE four. It does nothing about the NEXT convention drift, and a widen with no residual
 * check is how the gate quietly re-enters this state. Accept the real convention AND account for
 * every bracketed line: the gate may never again conclude "nothing to check" from a shape it does
 * not know.
 *
 * Exit 2, not 1 — same class as refuseDegenerateScope. "The instrument is not reading the log" is
 * a different repair from "the log has a duplicate", and conflating them sends the operator to
 * `--fix` (which, under a partial parse, corrupts the file — see the guard in the --fix path).
 */
function refuseUnparsedEntries(): void {
  if (bracketed === total) return;

  console.error("delta-lint: PARTIAL PARSE — refusing to report on a population it can only half see.\n");
  console.error(
    `  ${bracketed} line(s) in the live scope (from line ${SCOPE_START + 1}) start with [NNNN], but only\n` +
      `  ${total} matched the ENTRY shape. ${unparsed.length} bracketed line(s) are NOT being counted:`,
  );
  for (const ln of unparsed) console.error(`    line ${ln}:  ${lines[ln - 1].slice(0, 100)}`);
  console.error(
    `\n  Those lines are invisible to THIS gate (a duplicate among them reads as clean), and\n` +
      `  scripts/state.ts + the flogence bridge parse the same shape, so they are dropping the same\n` +
      `  entries from the digest right now.\n` +
      `\n  Fix ONE of: (a) correct the offending lines to \`[NNNN] <kind> · <body>\` or the marker form\n` +
      `  \`[NNNN] <emoji> <kind> · <body>\`, or (b) if the convention has genuinely moved again, widen\n` +
      `  ENTRY here AND in scripts/state.ts together — they must stay in lockstep or the gate and the\n` +
      `  projection measure different populations.`,
  );
  process.exit(2);
}
refuseUnparsedEntries();

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

/**
 * GATE --fix ON A CLEAN PARSE (S365 — g-delta-lint-fix-corrupts-log-under-partial-blindness).
 *
 * `--fix` renumbers to `maxSeq + 1`, and `maxSeq` is derived from the entries the parser CAN SEE.
 * Under a partial parse it therefore renumbers a duplicate onto a number that already exists in the
 * region it cannot see — MANUFACTURING a real collision in the file it was asked to repair — and
 * the "re-run without --fix to confirm" step then reports PASS over the damage, because the new
 * twin is in the invisible region too. Reproduced end-to-end: a tail-region drift had `--fix`
 * renumber to [1620], which already existed at line 2602, after which the confirm step printed
 * `1328 entries … max [1620] — PASS`, exit 0.
 *
 * refuseUnparsedEntries() above already exits before this point, so this guard is unreachable
 * today. It is written anyway and it is not redundant: the rule is "never renumber against a
 * maxSeq derived from a partial population", and that rule belongs AT the write, not three
 * hundred lines upstream where a later reorder can quietly step over it. A destructive verb
 * states its own precondition.
 *
 * ⚑ THIS GUARD DOES NOT MAKE --fix SAFE ON A MERGE RESULT. A separate, still-open defect: `--fix`
 * keeps FIRST-IN-FILE order, which is blind to which side of a union-merge is already published,
 * so it can renumber the side that other repos have already checkpointed. A clean parse says
 * nothing about that. Out of scope here; the warning printed below is the interim mitigation.
 */
if (bracketed !== total) {
  console.error(`\ndelta-lint: REFUSING TO --fix — the parse is partial (${bracketed} bracketed, ${total} parsed).`);
  console.error(`  Renumbering uses max+1 computed from PARSED entries only, so under a partial parse it`);
  console.error(`  would assign a number that already exists among the ${bracketed - total} unparsed line(s) —`);
  console.error(`  creating a real duplicate and then reporting PASS over it. Repair the entry shape first.`);
  process.exit(2);
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
console.error(
  `\n⚠  MERGE HAZARD (unfixed, separate defect): --fix keeps FIRST-IN-FILE order, which is blind to\n` +
    `   which side of a union-merge is already PUBLISHED. If this file is a merge result, check by hand\n` +
    `   that the renumbered side is YOURS — renumbering an entry another repo has already checkpointed\n` +
    `   drops it from that repo's digest. The clean-parse guard above does NOT cover this.`,
);
console.error(`\nRe-run without --fix to confirm.`);
