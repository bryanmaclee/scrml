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
 *   2. **structural** — any `*.md` under `docs/` whose LEADING METADATA BLOCK carries
 *      `authority-needed:`. This catches a ruling filed in a directory nobody thought to name
 *      correctly, which is precisely how both known instances happened.
 *
 * ── THE FOUR CORRECTIONS THIS FILE CARRIES (adversarial review + operator reproduction) ─────────
 *
 * F1 · A FAILED ENUMERATION USED TO REPORT A CONFIDENT ✓. `SCRML_SUPPORT=<dir with no docs/>` printed
 *      "0 ruling-shaped artifacts … ✓ every ruling-shaped artifact is reachable". A treeless clone, a
 *      permissions change or a moved sibling repo turned this probe into permanent decorative green —
 *      the EXACT failure class it exists to close. Every read is now accounted: an unresolvable
 *      support root, a missing/unreadable `docs/`, a directory the walk could not list, a candidate
 *      file that would not open, or a queue with no authoritative table rows all produce a loud ⛔
 *      that NAMES what could not be read, and the summary line says COULD NOT ENUMERATE instead of
 *      quoting counts. "Enumerated and found nothing" and "could not enumerate" are now different
 *      sentences. Exit stays 0 in every state.
 *
 * F2 · THE QUEUE PATH IS RESOLVED CANONICALLY, LIKE THE DOC SURFACE. `resolveSupport()` always walked
 *      up to the real sibling checkout; the queue was built from `ROOT` and did not. Run from a
 *      worktree the probe read THAT WORKTREE'S checked-out queue — a different file (277,273 B vs
 *      320,123 B on the day this was written) giving a different answer to the same question at the
 *      same instant: 0 referenced / 3 outside vs 2 referenced / 1 outside. The error runs both ways,
 *      and the green direction is the delivery bug this probe exists for, one level up: a branch
 *      carrying a newer queue entry reads GREEN while `main` — the file the dPA actually opens —
 *      lacks it. `scrml-support/dpa-scrml.md` states the obligation by ABSOLUTE PATH ("Read
 *      `/home/…/scrml/handOffs/dpa-queue.md` (by absolute path) — the work to drain"), so the probe
 *      resolves the same artifact: the git COMMON dir names the main checkout of a worktree family
 *      exactly, with the sibling-name walk as the no-git fallback. The resolved path is printed.
 *
 * F3 · `authority-needed:` IS NOW MANDATED, AND THE MANDATE IS MEASURED. The old docstring called the
 *      field "the stronger signal" while NOTHING required it — 3 artifacts carried it, no contract,
 *      template or process doc asked for it, and a real ruling filed in a third location without it
 *      was invisible. Ruling (bryan, S351): MANDATE the field rather than soften the claim. The
 *      contract half goes in `dpa-scrml.md`; the half that makes it real is here — the probe counts
 *      and names artifacts that are ruling-shaped by their OTHER dPA fields (`rung:` / `routes-to:` /
 *      `requested:`) yet carry no `authority-needed:`. Reported as a SEPARATE ADVISORY line, never as
 *      debt: today's set is legitimately queued, it is a migration backlog, not a miss.
 *
 * F5 · LINKAGE IS ANCHORED TO THE SURFACE `dpa-debt.ts` ALREADY TREATS AS AUTHORITATIVE. It used to
 *      be a bare substring over a 318 KB prose file: a passing mention — "we should get around to
 *      queueing it one of these days" — silenced the probe permanently, and 2 of the 3 artifacts it
 *      found on day one were "linked" by prose alone. Worse, `dpa-debt.ts` reads the queue's status
 *      TABLE *and only the table*, so ONE file had TWO reading rules and a ruling "queued" in prose
 *      was green here and invisible there — the obligation/probe mismatch, inside a single file.
 *      LINKED now means the queue POINTS AT the artifact rather than talks about it:
 *
 *        the path or basename appears in an authoritative TABLE ROW (`| dpa-NNN | … |`, dpa-debt's
 *        own anchor), OR on a `key: value` FIELD LINE inside the section of a `## dpa-NNN` item
 *        WHOSE ID IS A ROW IN THAT TABLE.
 *
 *      Both anchors are dpa-debt's, reused rather than reinvented. The table-membership clause is
 *      load-bearing: an item block with no table row is not drained and does not count as banked.
 *      This is deliberately stricter than "mentioned somewhere", and it costs a real finding: a DD
 *      referenced only by a bold-prose `**Artifact:**` line now reads as outside the drain path.
 *      That is the correct answer — the fix is one `artifact:` field line in the item, which is what
 *      the queue's own house style already does everywhere else.
 *
 * F9 · N of M. It reported how many artifacts it found and never how many files it walked, so F1's
 *      silent zero was unreadable. The denominator is printed.
 *
 * DETECTION, NOT CONTROL. Exits 0 whatever it finds. Never gates, never in CI.
 *
 * TESTABILITY. `SCRML_SUPPORT` and `SCRML_DPA_QUEUE` override the two inputs. They exist so the
 * probe's BITE can be proven — §8: a gate that has never failed is indistinguishable from one that
 * cannot fail — without mutating the real artifacts to do it. Neither is set in normal operation.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

/** Everything this run could NOT read. Non-empty ⟹ the counts below are not trustworthy (F1). */
const readErrors: string[] = [];

// ── input resolution ──────────────────────────────────────────────────────────

/**
 * The support repo and the canonical scrml checkout are SIBLINGS. When this runs from a git worktree
 * (`.claude/worktrees/agent-x`) the plain `../<name>` guess lands in the worktrees directory, so walk
 * up until a sibling with that name appears.
 */
function resolveSibling(name: string): string | null {
  let dir = ROOT;
  for (let i = 0; i < 8; i++) {
    const cand = `${dir}/../${name}`;
    if (existsSync(cand)) return cand;
    const up = dir.replace(/[\\/][^\\/]+$/, "");
    if (!up || up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * The MAIN checkout of this worktree family. `--git-common-dir` points at the shared `.git`, whose
 * parent is the checkout the dPA opens by absolute path — exact, and it does not depend on the
 * directory being *named* `scrml`.
 */
function canonicalCheckoutViaGit(): string | null {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: ROOT, encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const gitDir = (r.stdout ?? "").trim();
  if (!gitDir.endsWith("/.git")) return null;
  return gitDir.slice(0, -"/.git".length);
}

const SUPPORT = process.env.SCRML_SUPPORT ?? resolveSibling("scrml-support");

const canonicalCheckout = canonicalCheckoutViaGit() ?? resolveSibling("scrml");
const queueOverridden = Boolean(process.env.SCRML_DPA_QUEUE);
const QUEUE = process.env.SCRML_DPA_QUEUE ?? `${canonicalCheckout ?? ROOT}/handOffs/dpa-queue.md`;
const queueOrigin = queueOverridden
  ? "SCRML_DPA_QUEUE override"
  : canonicalCheckout
    ? "canonical checkout"
    : "THIS TREE — canonical checkout not found";
if (!queueOverridden && !canonicalCheckout) {
  readErrors.push(
    `the canonical scrml checkout could not be located (git common-dir and the sibling walk both failed),\n` +
      `     so the queue was read from THIS tree — which may not be the file the dPA opens.`
  );
}

if (!SUPPORT) {
  console.log("ruling-debt — ⛔ COULD NOT ENUMERATE: no sibling `scrml-support` checkout found.");
  console.log("  ⛔ the ruling surface was NOT read. This is not a clean bill of health — nothing was checked.");
  process.exit(0);
}
if (!existsSync(QUEUE)) {
  console.log(`ruling-debt — ⛔ COULD NOT ENUMERATE: deliberation queue not found at ${QUEUE} (${queueOrigin}).`);
  console.log("  ⛔ what is drained could NOT be established, so nothing was checked against it.");
  process.exit(0);
}

let queueText = "";
try {
  queueText = readFileSync(QUEUE, "utf8");
} catch (e) {
  console.log(`ruling-debt — ⛔ COULD NOT ENUMERATE: deliberation queue unreadable at ${QUEUE} (${(e as Error).message}).`);
  process.exit(0);
}

// ── walk the doc surface ──────────────────────────────────────────────────────
const SKIP_DIRS = new Set([".git", "node_modules", ".claude", "dist"]);

/** Every `*.md` under `dir`. A directory that will not list is RECORDED, never swallowed (F1). */
function walkMarkdown(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    readErrors.push(`could not list ${dir} (${(e as Error).message}) — its markdown was NOT enumerated`);
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = `${dir}/${name}`;
    let st;
    try {
      st = statSync(full);
    } catch (e) {
      readErrors.push(`could not stat ${full} (${(e as Error).message})`);
      continue;
    }
    if (st.isDirectory()) walkMarkdown(full, acc);
    else if (name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

/**
 * The artifact's LEADING METADATA BLOCK — YAML front matter, or the leading fenced block.
 *
 * BOTH, deliberately, and this is a measurement not a preference: of the 9 artifacts carrying dPA
 * ruling fields today, 3 use YAML front matter and 6 use a fenced ``` header under the H1 (the dPA's
 * house style, e.g. `deep-dives/app-content-i18n-dpa-032-2026-08-17.md`). Reading YAML only would
 * make the F3 mandate unreadable for two thirds of the real corpus — a rule nobody can check, which
 * is the thing this probe family exists to prevent. The fence must OPEN in the first 12 lines, so a
 * code sample deep in the body is not mistaken for a header.
 */
function headerBlock(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    readErrors.push(`could not read ${path} (${(e as Error).message}) — its front matter was NOT inspected`);
    return null;
  }
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    return end < 0 ? text.slice(0, 2000) : text.slice(0, end);
  }
  const lines = text.split("\n");
  const open = lines.findIndex((l, i) => i < 12 && /^```/.test(l));
  if (open < 0) return null;
  const closeRel = lines.slice(open + 1).findIndex((l) => /^```/.test(l));
  const end = closeRel < 0 ? open + 60 : open + 1 + closeRel;
  return lines.slice(open + 1, end).join("\n");
}

const docsRoot = `${SUPPORT}/docs`;
if (!existsSync(docsRoot)) {
  readErrors.push(`${docsRoot} does not exist — the ruling surface was NOT enumerated`);
}
const allDocs = existsSync(docsRoot) ? walkMarkdown(docsRoot) : [];

interface Candidate { rel: string; positional: boolean; structural: boolean; }

const candidates = new Map<string, Candidate>();
/** Ruling-shaped by its other dPA fields, but carrying no `authority-needed:` (F3 advisory). */
const missingAuthority: string[] = [];

for (const full of allDocs) {
  const rel = full.slice(SUPPORT.length + 1).replace(/\\/g, "/");
  const positional = /(^|\/)rulings-pending\//.test(rel);
  const header = headerBlock(full);
  const structural = header !== null && /^authority-needed:/m.test(header);
  if (header !== null && !structural && /^(rung|routes-to|requested):/m.test(header)) {
    missingAuthority.push(rel);
  }
  if (!positional && !structural) continue;
  candidates.set(rel, { rel, positional, structural });
}

// ── the queue's AUTHORITATIVE surfaces (both anchors are dpa-debt.ts's) ────────
const queueLines = queueText.split("\n");

/** `| dpa-NNN | … |` — the PA-maintained status table dpa-debt.ts reads and only reads. */
const tableIds = new Set<string>();
const tableRows: string[] = [];
for (const line of queueLines) {
  const m = line.match(/^\|\s*(dpa-\d+)\s*\|/i);
  if (!m) continue;
  tableIds.add(m[1].toLowerCase());
  tableRows.push(line);
}
if (!tableIds.size) {
  readErrors.push(
    `no authoritative table rows (\`| dpa-NNN | … |\`) found in ${QUEUE} — the drain surface was NOT read`
  );
}

/**
 * `key: value` field lines inside the section of a `## dpa-NNN` item that the TABLE knows about.
 * A bold-prose `**Artifact:** …` line does not match: it is talk, not a pointer.
 */
const itemFieldLines: string[] = [];
{
  let cur = "";
  for (const line of queueLines) {
    const h = line.match(/^##\s+(dpa-\d+)\s*—/i);
    if (h) { cur = h[1].toLowerCase(); continue; }
    if (/^##\s/.test(line)) { cur = ""; continue; } // any other H2 ends the item
    if (!cur || !tableIds.has(cur)) continue;
    if (/^[a-z][a-z0-9-]*:\s/.test(line)) itemFieldLines.push(line);
  }
}

const drainSurface = `${tableRows.join("\n")}\n${itemFieldLines.join("\n")}`;

function isLinked(rel: string): boolean {
  if (drainSurface.includes(rel)) return true;
  const base = rel.split("/").pop()!;
  return drainSurface.includes(base);
}

const list = [...candidates.values()].sort((a, b) => a.rel.localeCompare(b.rel));
const unlinked = list.filter((c) => !isLinked(c.rel));

// ── report ────────────────────────────────────────────────────────────────────
const why = (c: Candidate) =>
  c.positional && c.structural ? "in rulings-pending/ + authority-needed:" : c.positional ? "in rulings-pending/" : "authority-needed: front matter";

const degraded = readErrors.length > 0;

console.log(
  `ruling-debt — ${degraded ? "⛔ COULD NOT ENUMERATE (counts below are NOT trustworthy) · " : ""}` +
    `${list.length} of ${allDocs.length} markdown files under scrml-support/docs are ruling-shaped · ` +
    `${list.length - unlinked.length} referenced by the dPA queue · ${unlinked.length} BANKED OUTSIDE THE DRAIN PATH`
);
console.log(`  queue: ${QUEUE} (${queueOrigin}, ${tableIds.size} table rows)`);

if (degraded) {
  console.log(`\n  ⛔ NOT A CLEAN BILL OF HEALTH — this run did not read everything it reports on:`);
  for (const e of readErrors) console.log(`     ${e}`);
}

if (unlinked.length) {
  console.log(
    `\n  ⚠️ OUTSIDE THE DRAIN PATH — the dPA drains handOffs/dpa-queue.md and nothing else, so these` +
      `\n     will never run. Add a queue entry naming the artifact, or record why it is moot.`
  );
  for (const c of unlinked) console.log(`     ${c.rel}\n        detected by: ${why(c)}`);
} else if (!degraded) {
  console.log("  ✓ every ruling-shaped artifact is reachable from handOffs/dpa-queue.md.");
}

if (missingAuthority.length) {
  console.log(
    `\n  ℹ️ ADVISORY — ${missingAuthority.length} ruling-shaped artifacts carry dPA fields` +
      ` (rung: / routes-to: / requested:)\n     but NO \`authority-needed:\`. dpa-scrml.md mandates it; these are legitimately` +
      ` queued, so this is a\n     MIGRATION BACKLOG, not debt. Without the field a ruling filed outside` +
      ` rulings-pending/ is invisible\n     to the structural detector above.`
  );
  for (const rel of missingAuthority) console.log(`     ${rel}`);
}
