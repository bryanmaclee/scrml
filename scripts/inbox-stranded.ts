#!/usr/bin/env bun
/**
 * scripts/inbox-stranded.ts — the STRANDED-INBOX probe.
 *
 * WHY THIS EXISTS. `pa-base` §10 already says a drop is not delivered until it is COMMITTED AND
 * PUSHED, and tells the receiver to list the inbox "from the VCS's view, not only the
 * filesystem's" — i.e. `ls handOffs/incoming/` plus `git status --porcelain` for untracked drops.
 *
 * **Both of those are blind to the same thing: a message that is committed AND pushed, on a branch
 * that is not `main`.** It is tracked, so `git status` is silent. It is not in this checkout's
 * working tree, so `ls` is silent. Every boot reports a clean inbox and the message does not exist.
 *
 * That is not hypothetical. Measured on this repo the day this probe was written, three messages
 * were stranded exactly that way — including a HIGH-severity bug report from the `scrml-site`
 * adopter (`2026-08-18-...-soft-nav-drops-page-stylesheet.md`) which is committed on TWO refs
 * (`origin/inbox/scrml-site-soft-nav-stylesheet` unread, and `origin/continuity/s350` already moved
 * to `read/`) and present on NEITHER in main. It had been "archived as read" on a branch that never
 * landed, which is the worst version of the failure: it looks handled from the branch that handled
 * it, and it was never seen from the branch anyone reads.
 *
 * THE PREDICATE. Delivered ⟺ `main`'s HISTORY ever added a file with that BASENAME under
 * `handOffs/incoming/`. Two deliberate choices:
 *
 *   - **basename, with any `read/` segment stripped.** Messages are archived by moving
 *     `incoming/X.md` -> `incoming/read/X.md`. Matching on full path would report every
 *     correctly-archived message as stranded — the §8 cry-wolf shape, red over the whole backlog,
 *     bypassed and then deleted.
 *   - **history, not tree.** A message delivered and later deleted was still SEEN. Matching on
 *     main's current tree would resurrect every cleaned-up message as a false positive.
 *
 * F1 · A FAILED ENUMERATION USED TO REPORT A CONFIDENT ✓ (adversarial review, S351). The old `git()`
 * helper returned `""` on EVERY non-zero exit, so a failed log read was indistinguishable from a
 * repo with no inbox history: both produced `0 messages · 0 delivered · 0 STRANDED` followed by
 * "✓ nothing stranded". A treeless clone, a corrupt pack, a permissions change, or a `git` that is
 * not on PATH turned this probe into permanent decorative green — the EXACT failure class it exists
 * to close, since a probe that reads nothing and reports green is worse than no probe at all.
 *
 * So every enumerating read now goes through `gitEnumerate()`, which RECORDS a non-zero exit with
 * the command and its stderr instead of swallowing it. Any recorded failure turns the summary line
 * into `⛔ COULD NOT ENUMERATE` and suppresses the ✓. Two further states are called out rather than
 * certified:
 *
 *   - **an empty population.** Zero inbox messages on any ref is not "clean" — there is nothing to
 *     be clean ABOUT, and it is exactly what a silently-failed read looks like. It says so.
 *   - **zero delivered while messages exist.** Every message stranded is far more likely to be a
 *     failed read of main's history than a real finding, so it is flagged as suspect.
 *
 * `refExists()` is deliberately EXEMPT: `rev-parse --verify --quiet <ref>` exits non-zero to mean
 * "no such ref", which is an ANSWER, not a failure.
 *
 * DETECTION, NOT CONTROL. Exits 0 whatever it finds, in every state above. Never gates, never in CI.
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const INBOX_GLOB = "handOffs/incoming/*";

/** Everything this run could NOT read. Non-empty ⟹ the counts below are not trustworthy. */
const readErrors: string[] = [];

interface GitResult { ok: boolean; out: string; err: string; }

function gitRun(argv: string[]): GitResult {
  const r = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, out: "", err: r.error.message };
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
}

/**
 * An ENUMERATING read: its emptiness is a claim about the world, so a failure must never be
 * laundered into "found nothing". Records the command and its stderr, then returns empty.
 */
function gitEnumerate(what: string, argv: string[]): string {
  const r = gitRun(argv);
  if (!r.ok) {
    readErrors.push(`${what} — \`git ${argv.join(" ")}\` failed${r.err ? `: ${r.err.split("\n")[0]}` : ""}`);
    return "";
  }
  return r.out;
}

/** `handOffs/incoming/read/2026-01-01-x.md` -> `2026-01-01-x.md` */
function basenameOf(path: string): string {
  return path.replace(/^handOffs\/incoming\//, "").replace(/^read\//, "");
}

/** Every inbox basename ever ADDED on any ref reachable from this clone, with the refs carrying it. */
function addedOnAnyRef(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  // `%x00%H` marks commit boundaries so name-only lines can be attributed to a commit.
  const log = gitEnumerate("the all-refs inbox history", [
    "log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:%x00%H", "--", INBOX_GLOB,
  ]);
  let sha = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) { sha = line.slice(1).trim(); continue; }
    const p = line.trim();
    if (!p.startsWith("handOffs/incoming/")) continue;
    const b = basenameOf(p);
    if (!b || b.endsWith("/")) continue;
    if (!out.has(b)) out.set(b, new Set());
    out.get(b)!.add(sha);
  }
  return out;
}

/** Every inbox basename ever ADDED in a given ref's history. */
function addedInHistoryOf(ref: string): Set<string> {
  const out = new Set<string>();
  const log = gitEnumerate(`the delivery baseline (${ref})`, [
    "log", ref, "--diff-filter=A", "--name-only", "--pretty=format:", "--", INBOX_GLOB,
  ]);
  for (const line of log.split("\n")) {
    const p = line.trim();
    if (!p.startsWith("handOffs/incoming/")) continue;
    const b = basenameOf(p);
    if (b) out.add(b);
  }
  return out;
}

/** EXEMPT from gitEnumerate: a non-zero exit here means "no such ref", which is an answer. */
function refExists(ref: string): boolean {
  return gitRun(["rev-parse", "--verify", "--quiet", ref]).out.trim().length > 0;
}

/** Human-readable ref names carrying a commit — a stranded message is only actionable with these. */
function refsFor(shas: Set<string>): string[] {
  const names = new Set<string>();
  for (const sha of shas) {
    if (!sha) continue;
    const r = gitEnumerate(`the ref names carrying ${sha.slice(0, 8)}`, [
      "branch", "--all", "--format=%(refname:short)", "--contains", sha,
    ]);
    for (const n of r.split("\n").map((s) => s.trim()).filter(Boolean)) names.add(n);
  }
  return [...names].sort();
}

// ── main-side delivery surface ────────────────────────────────────────────────
// Both `main` and `origin/main` count as delivered: a message on origin/main arrives in this
// checkout at the next sync, and one committed to a local main is already visible here.
const mainRefs = ["main", "origin/main"].filter(refExists);

if (mainRefs.length === 0) {
  console.log("inbox-stranded — ⛔ COULD NOT ENUMERATE: no `main` or `origin/main` ref in this clone.");
  console.log("  ⛔ the delivery baseline could NOT be established, so NOTHING was checked against it.");
  console.log("     This is not a clean bill of health — it is a probe that did not run.");
  process.exit(0);
}

const delivered = new Set<string>();
for (const ref of mainRefs) for (const b of addedInHistoryOf(ref)) delivered.add(b);

const everywhere = addedOnAnyRef();
const stranded = [...everywhere.entries()].filter(([b]) => !delivered.has(b)).sort((a, b) => a[0].localeCompare(b[0]));

// ── states that must not be certified ─────────────────────────────────────────
if (!everywhere.size && !readErrors.length) {
  readErrors.push(
    "the all-refs inbox history enumerated ZERO messages — either this clone has no inbox history at\n" +
      "     all, or that history is not readable here. There is no population to certify clean."
  );
}
if (everywhere.size && !delivered.size) {
  readErrors.push(
    `NOT ONE of ${everywhere.size} messages reached ${mainRefs.join("/")} — far more likely a failed read\n` +
      "     of main's history than a real finding. Treat the list below as suspect until the baseline is\n" +
      "     verified by hand."
  );
}

// ── report ────────────────────────────────────────────────────────────────────
const degraded = readErrors.length > 0;

console.log(
  `inbox-stranded — ${degraded ? "⛔ COULD NOT ENUMERATE (counts below are NOT trustworthy) · " : ""}` +
    `${everywhere.size} inbox messages ever committed on any ref · ` +
    `${delivered.size} reached ${mainRefs.join("/")} · ${stranded.length} STRANDED`
);

if (degraded) {
  console.log(`\n  ⛔ NOT A CLEAN BILL OF HEALTH — this run did not read everything it reports on:`);
  for (const e of readErrors) console.log(`     ${e}`);
}

if (stranded.length) {
  console.log(
    `\n  ⚠️ STRANDED — committed on a branch, never on main. \`ls handOffs/incoming/\` and` +
      `\n     \`git status --porcelain\` are both blind to these: they are tracked, and they are not` +
      `\n     in this working tree. Deliver each (cherry-pick / re-drop) or record why it is moot.`
  );
  for (const [name, shas] of stranded) {
    const refs = refsFor(shas);
    console.log(`     ${name}`);
    console.log(`        on: ${refs.length ? refs.join(", ") : "(no named ref — reachable only from a detached/deleted branch)"}`);
  }
} else if (!degraded) {
  console.log("  ✓ nothing stranded — every committed inbox message reached main.");
}
