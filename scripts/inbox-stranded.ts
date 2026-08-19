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
 * DETECTION, NOT CONTROL. Exits 0 whatever it finds. Never gates, never in CI.
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const INBOX_GLOB = "handOffs/incoming/*";

function git(...argv: string[]): string {
  const r = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout ?? "") : "";
}

/** `handOffs/incoming/read/2026-01-01-x.md` -> `2026-01-01-x.md` */
function basenameOf(path: string): string {
  return path.replace(/^handOffs\/incoming\//, "").replace(/^read\//, "");
}

/** Every inbox basename ever ADDED on any ref reachable from this clone, with the refs carrying it. */
function addedOnAnyRef(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  // `%x00%H` marks commit boundaries so name-only lines can be attributed to a commit.
  const log = git("log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:%x00%H", "--", INBOX_GLOB);
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
  const log = git("log", ref, "--diff-filter=A", "--name-only", "--pretty=format:", "--", INBOX_GLOB);
  for (const line of log.split("\n")) {
    const p = line.trim();
    if (!p.startsWith("handOffs/incoming/")) continue;
    const b = basenameOf(p);
    if (b) out.add(b);
  }
  return out;
}

function refExists(ref: string): boolean {
  return git("rev-parse", "--verify", "--quiet", ref).trim().length > 0;
}

/** Human-readable ref names carrying a commit — a stranded message is only actionable with these. */
function refsFor(shas: Set<string>): string[] {
  const names = new Set<string>();
  for (const sha of shas) {
    if (!sha) continue;
    const r = git("branch", "--all", "--format=%(refname:short)", "--contains", sha);
    for (const n of r.split("\n").map((s) => s.trim()).filter(Boolean)) names.add(n);
  }
  return [...names].sort();
}

// ── main-side delivery surface ────────────────────────────────────────────────
// Both `main` and `origin/main` count as delivered: a message on origin/main arrives in this
// checkout at the next sync, and one committed to a local main is already visible here.
const mainRefs = ["main", "origin/main"].filter(refExists);

if (mainRefs.length === 0) {
  console.log("inbox-stranded — no `main` or `origin/main` ref in this clone; cannot establish a delivery baseline.");
  process.exit(0);
}

const delivered = new Set<string>();
for (const ref of mainRefs) for (const b of addedInHistoryOf(ref)) delivered.add(b);

const everywhere = addedOnAnyRef();
const stranded = [...everywhere.entries()].filter(([b]) => !delivered.has(b)).sort((a, b) => a[0].localeCompare(b[0]));

// ── report ────────────────────────────────────────────────────────────────────
console.log(
  `inbox-stranded — ${everywhere.size} inbox messages ever committed on any ref · ` +
    `${delivered.size} reached ${mainRefs.join("/")} · ${stranded.length} STRANDED`
);

if (!stranded.length) {
  console.log("  ✓ nothing stranded — every committed inbox message reached main.");
  process.exit(0);
}

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
