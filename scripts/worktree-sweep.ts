// scripts/worktree-sweep.ts — wrap step 6b's stale-worktree disposition report.
// #dock[ implements=g-wrap-6b-worktree-sweep-probes-branch-merged-which-file-delta-landings-never-satisfy ]
//
// WHY THIS EXISTS (gap `g-wrap-6b-worktree-sweep-probes-branch-merged-which-file-delta-landings-never-satisfy`,
// filed S326, the sweep itself owed since S268 — still unbuilt at S391).
//
// Wrap 6b says to clean up spent `.claude/worktrees/`. The obvious probe is
// `git branch --merged origin/main` (or `merge-base --is-ancestor`). That probe is
// correct under a merge-based landing model and **structurally wrong under ours**:
// we land an agent's work by REVIEWING ITS DELTA and copying file CONTENT —
// `git checkout <agent-branch> -- <files>` onto a PA feature branch — then
// squash-merging THAT. The agent branch is therefore never an ancestor of main,
// **no matter how completely its work landed**, so `--merged` reports "nothing
// prunable" forever. Measured at S391 across all 81 non-protected worktrees:
// 77 "UNLANDED", 0 "LANDED and clean". That is not a backlog, it is a broken test.
//
// This is `pa-base` §10's obligation-vs-probe mismatch — the contract's most-repeated
// failure — sitting inside a MANDATORY wrap step and reading as "correctly found
// nothing", which is why it survived ~120 sessions while the count grew past 100.
//
// THE PREDICATE THAT ACTUALLY DISCRIMINATES IS CONTENT, NOT ANCESTRY.
// For every file the branch touched since `merge-base(<base>, <ref>)`, compare the
// blob on the branch against the blob on `<base>`. All identical ⇒ the content
// landed. Any differ ⇒ the branch still holds work.
//
// AND A SECOND DISCRIMINATOR, because one is not enough. Content-vs-ancestry moves
// the population from 77 "UNLANDED" to 69 HOLDS-WORK — correct, but 69
// undifferentiated rows is still a pile nobody can act on, and a probe whose answer
// is the same for everything conveys nothing whichever way it points. So each
// differing file is further split by an EXACT inference: if the baseline has not
// touched that path since the merge-base, the baseline still holds the merge-base
// blob and the branch's edit provably did NOT land (`unlanded`); if the baseline
// changed it too, the row is genuinely ambiguous (`contested`) — the common case
// for long-lived shared files like SPEC.md, where work lands and main then moves on.
// A worktree whose differing files are ALL contested is a drain candidate for a
// human to confirm; one with any `unlanded` file is definitively still holding work.
//
// DESIGN CONSTRAINTS (pa-base §8 gate-design + §2 detection-is-a-ratio):
//   - DRY RUN, ALWAYS. This increment CANNOT delete anything: no `worktree remove`,
//     no `branch -D`, no `prune`, no write of any kind. Removal stays a separate,
//     explicitly-authorized act. A destructive default over a 100-workspace
//     population is not recoverable, and several of these hold live or deliberately
//     retained work.
//   - READ-ONLY ACROSS OTHER WORKTREES. Every subprocess below is a read: `worktree
//     list`, `merge-base`, `diff`, `ls-tree`, `log`, and `status` under
//     `--no-optional-locks` (which suppresses git's index-refresh write, so a live
//     agent's `index.lock` is never contended).
//   - DETECTION, NOT CONTROL. Exit code is 0 unconditionally, and there is
//     deliberately NO `--check`. A gate instantly red over a pre-existing
//     ~77-workspace backlog is the §8 cry-wolf shape: bypassed, then deleted. Do not
//     wire this into CI.
//   - DETERMINISTIC INPUT. Derives only from git refs + on-disk existence. No
//     wall-clock. (Each row prints its HEAD's COMMIT date — a git fact, not the
//     clock — because "how old is this" is exactly the operator's judgement call.)
//   - NO SHELL WORD-SPLITTING, ANYWHERE. Every git call goes through `spawnSync`
//     with an ARGV ARRAY. ⚑ The S326 filing records that the first hand-cut of this
//     probe passed the file list as an unquoted `-- $files` pathspec; **zsh does not
//     word-split unquoted expansions**, so the newline-joined list became ONE
//     pathspec matching nothing, every branch measured zero files, and the probe
//     reported ALL NINE LANDED — the most reassuring answer available. It was caught
//     only because a live agent's branch was in that list. An argv array cannot have
//     that defect; the vacuous-zero guard below catches the residue.
//
// USAGE
//   bun scripts/worktree-sweep.ts                  report (wrap 6b step)
//   bun scripts/worktree-sweep.ts --all            print every row, including PROTECTED/NO-BRANCH/GONE
//   bun scripts/worktree-sweep.ts --no-exclude     do NOT exclude progress.md/BRIEF.md (bite proof)
//   bun scripts/worktree-sweep.ts --base <ref>     landing baseline (default `origin/main`)
//   bun scripts/worktree-sweep.ts --keep a,b       extra PROTECTED paths/branch substrings
//   bun scripts/worktree-sweep.ts --cap <n>        per-class row cap (default 30; `--all` uncaps)
//
// TRUTH CEILING, STATED NOT BURIED. This verifies that a branch's committed content
// is REACHABLE ON THE BASELINE. It does not verify that the work was reviewed, that
// it was landed deliberately rather than coincidentally, or that anyone wanted it.
// Its two failure directions are asymmetric ON PURPOSE:
//   - toward RETAIN (safe): work that landed and was then further edited on main
//     reads HOLDS-WORK, because the blobs no longer match.
//   - toward SWEEP (dangerous): a branch with NO committed delta is vacuously
//     "fully landed". That is exactly the freshly-cut-worktree-of-a-live-agent case
//     the S326 note warns about. Such rows are tagged `vacuous` and counted
//     separately rather than folded into the sweepable total.

import { existsSync } from "fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "child_process";
import { basename, dirname } from "path";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

/** Read-only git. Argv array — never a shell string (see the S326 zsh trap above). */
function git(args: string[]): { stdout: string; ok: boolean } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { stdout: r.stdout ?? "", ok: r.status === 0 };
}

// ── The exclusion (⚑ load-bearing; always reported, never silent) ─────────────
//
// `progress.md` and `BRIEF.md` are AGENT CRASH-RECOVERY ARTIFACTS. Every isolated
// dispatch is required to keep a `progress.md` and to archive its `BRIEF.md`, and
// NEITHER EVER LANDS — they are per-dispatch scaffolding by design, not deliverables.
// Left in the comparison they make every completed dispatch read as holding work.
//
// MEASURED on the LANDED control (`worktree-agent-ab043497a0c7c809c`, maps work
// merged as #795): 14 files / 1 differing WITHOUT the exclusion → 13 / 0 WITH it.
// One noise file is the difference between a probe that discriminates and a probe
// that says "unlanded" about literally everything. Excluded by BASENAME (a brief is
// archived under `docs/changes/<id>/BRIEF.md`, a progress file at the worktree root).
//
// EXPORTED so the pin test can assert the set rather than re-encode it.
export const EXCLUDED_BASENAMES = new Set(["progress.md", "BRIEF.md"]);

// ── Worktree records (parsed from `git worktree list --porcelain`) ────────────
export type WorktreeRec = {
  path: string;
  head: string | null;
  /** short branch name (`spa/ss56`, `worktree-agent-x`) or null when detached/bare */
  branch: string | null;
  detached: boolean;
  locked: boolean;
  lockReason: string;
  prunable: boolean;
  bare: boolean;
};

/**
 * Parse `git worktree list --porcelain`.
 *
 * EXPORTED so it can be PINNED (`compiler/tests/unit/worktree-sweep-classify.test.js`).
 * This parser is precisely where a SILENT TRUNCATION would live, and §8's rule is that
 * "a truncated enumeration reads exactly like a complete one" — so the record count it
 * returns is printed as `N of M` against an independently-counted `worktree ` line
 * total, and a mismatch is reported rather than inferable. Both sibling debt probes
 * (`issue-debt.ts`, `corpus-zero-debt.ts`) export their parser for the same reason.
 *
 * Porcelain shape: NUL-free line records separated by blank lines, one attribute per
 * line, LAST RECORD NOT NECESSARILY BLANK-TERMINATED (the off-by-one that would drop
 * exactly one worktree — pinned).
 */
export function parseWorktreeList(porcelain: string): WorktreeRec[] {
  const out: WorktreeRec[] = [];
  let cur: WorktreeRec | null = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };

  for (const raw of porcelain.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") { flush(); continue; }
    const sp = line.indexOf(" ");
    const key = sp === -1 ? line : line.slice(0, sp);
    const val = sp === -1 ? "" : line.slice(sp + 1);

    if (key === "worktree") {
      flush();
      cur = { path: val, head: null, branch: null, detached: false, locked: false, lockReason: "", prunable: false, bare: false };
      continue;
    }
    if (!cur) continue; // an attribute before any `worktree ` line — not ours to interpret
    if (key === "HEAD") cur.head = val;
    else if (key === "branch") cur.branch = val.replace(/^refs\/heads\//, "");
    else if (key === "detached") cur.detached = true;
    else if (key === "locked") { cur.locked = true; cur.lockReason = val; }
    else if (key === "prunable") cur.prunable = true;
    else if (key === "bare") cur.bare = true;
  }
  flush();
  return out;
}

// ── Classification ────────────────────────────────────────────────────────────
export type Klass =
  | "SWEEPABLE"   // content fully landed on the baseline AND the tree is clean
  | "HOLDS-WORK"  // at least one touched file's blob differs from the baseline
  | "DIRTY"       // uncommitted changes — never sweepable regardless of content
  | "PROTECTED"   // explicit keep-list: main, self, locked-by-a-live-agent, --keep
  | "NO-BRANCH"   // detached/bare — degenerate; no branch to compare or delete
  | "GONE"        // the directory no longer exists (git prune territory)
  | "UNMEASURED"; // a fact could not be obtained — NOT a guess in either direction

export type Facts = {
  exists: boolean;
  /** non-null ⇒ PROTECTED, and this is the reason printed */
  protectedReason: string | null;
  /** null when detached/bare — there is no branch ref */
  branch: string | null;
  /** count of `git status --porcelain` lines; null ⇒ could not measure */
  dirtyCount: number | null;
  /** null ⇒ could not measure (no merge-base, unreadable tree, …) */
  content: {
    considered: number;
    excluded: number;
    differing: string[];
    /**
     * Differing files the BASELINE has not touched since the merge-base — so the
     * baseline still holds the merge-base version and the branch's edit provably
     * did NOT land. Exact, not heuristic.
     */
    unlanded: string[];
    /**
     * Differing files the baseline ALSO changed since the merge-base. Genuinely
     * ambiguous: the branch may have landed and main moved on, or the branch may
     * be stale, or both edited the same file independently.
     */
    contested: string[];
  } | null;
};

/**
 * The disposition decision, as a PURE function of the facts.
 *
 * EXPORTED and pinned. `pa-base` §8: a probe never shown to discriminate is
 * indistinguishable from one that cannot — and the two controls this was built
 * against (a LANDED worktree and a deliberately RETAINED one) are the bite proof.
 *
 * PRECEDENCE, and why each step is where it is:
 *   1. GONE       — nothing on disk to reason about.
 *   2. PROTECTED  — an explicit "do not touch" outranks every measurement. A LOCKED
 *                   worktree is a LIVE agent; measuring it is fine, acting on it is not.
 *   3. NO-BRANCH  — degenerate. Reported with its content evidence anyway, so the row
 *                   is actionable, but never auto-classed sweepable: there is no branch
 *                   to delete and a detached HEAD is usually a harness artifact.
 *   4. UNMEASURED — ⚑ an honest SEVENTH class, beyond the five the brief named.
 *                   Folding an unmeasurable worktree into SWEEPABLE fails toward
 *                   deletion (the one direction this instrument must not have);
 *                   folding it into HOLDS-WORK would disguise a BROKEN PROBE as a
 *                   backlog item — which is the exact §10 shape this whole gap is
 *                   about. `review-debt.ts` takes the same line on PRs whose file
 *                   list `gh` withheld: "an absent file list is not evidence of
 *                   docs-only." So it gets its own bucket and gets said out loud.
 *   5. DIRTY      — uncommitted changes, never sweepable REGARDLESS of content. Ranked
 *                   above HOLDS-WORK because it is the stronger prohibition; the row
 *                   still prints its content evidence so nothing is hidden by the class.
 *   6. HOLDS-WORK / SWEEPABLE — the content predicate.
 */
export function classify(f: Facts): { klass: Klass; why: string } {
  if (!f.exists) return { klass: "GONE", why: "directory does not exist" };
  if (f.protectedReason) return { klass: "PROTECTED", why: f.protectedReason };
  if (!f.branch) return { klass: "NO-BRANCH", why: "detached or bare — no branch ref" };
  if (f.dirtyCount === null) return { klass: "UNMEASURED", why: "could not read working-tree status" };
  if (f.content === null) return { klass: "UNMEASURED", why: "could not compute the content delta (no merge-base?)" };
  if (f.dirtyCount > 0) return { klass: "DIRTY", why: `${f.dirtyCount} uncommitted change(s)` };
  if (f.content.differing.length > 0) {
    // ⚑ THE SECOND DISCRIMINATOR, and it is load-bearing for the same reason the
    // first one is. Content-vs-ancestry moved the population from 77 "UNLANDED"
    // to 69 HOLDS-WORK — better, but 69 undifferentiated rows is still a pile
    // nobody can act on, and the S326 filing's whole complaint is that a probe
    // whose answer is the same for everything conveys nothing. A probe red about
    // ALL of it is as useless as one green about all of it.
    //
    // So split the differing files by an EXACT inference, not a heuristic:
    //   unlanded  — the baseline has NOT touched this path since the merge-base,
    //               so the baseline still holds the merge-base blob, and the
    //               branch's blob differs from it. The edit definitively did not
    //               land. No judgement required.
    //   contested — the baseline changed this path too. The branch may have landed
    //               and main moved on (the common case for long-lived shared files
    //               like SPEC.md), or the branch may be stale. Needs a human.
    // A worktree with zero `unlanded` files is a genuine drain candidate for the
    // operator to confirm; one with any is definitively still holding work.
    const c = f.content;
    const shape = c.unlanded.length > 0
      ? `${c.unlanded.length} definitively unlanded${c.contested.length ? ` · ${c.contested.length} contested` : ""}`
      : `0 definitively unlanded · all ${c.contested.length} contested — may have landed then drifted`;
    return { klass: "HOLDS-WORK", why: `${c.differing.length} of ${c.considered} file(s) differ  (${shape})` };
  }
  // ⚑ VACUOUS SWEEPABLE — see the truth-ceiling note in the header. Zero committed
  // files is "fully landed" only in the sense that there is nothing to lose. It is
  // also exactly what a freshly-cut worktree holding a LIVE agent that has not
  // committed yet looks like, which is the S326 "would have said prune everything
  // with a straight face" case. Tagged, counted separately, never silently pooled.
  if (f.content.considered === 0) {
    return { klass: "SWEEPABLE", why: "vacuous — no committed delta vs merge-base; confirm no live agent holds it" };
  }
  return { klass: "SWEEPABLE", why: `all ${f.content.considered} touched file(s) present verbatim on the baseline` };
}

// ── Fact gathering (every call read-only) ─────────────────────────────────────

/** `git status --porcelain` line count, under `--no-optional-locks` so no index write occurs. */
function dirtyCount(path: string): number | null {
  const r = git(["--no-optional-locks", "-C", path, "status", "--porcelain"]);
  if (!r.ok) return null;
  return r.stdout.split("\n").filter((l) => l.trim() !== "").length;
}

/** path → blob sha for the WANTED paths only, from one `ls-tree` per ref. */
function blobsAt(ref: string, wanted: Set<string>): Map<string, string> | null {
  const out = new Map<string, string>();
  if (wanted.size === 0) return out;
  // `-z` so paths are raw (git C-quotes them otherwise) and `-r` to recurse. The
  // pathspec narrows the walk; we still filter against `wanted` on the way out,
  // because a git pathspec PREFIX-matches directories and we want exact paths.
  const r = git(["ls-tree", "-r", "-z", ref, "--", ...wanted]);
  if (!r.ok) return null;
  for (const entry of r.stdout.split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const meta = entry.slice(0, tab).split(/\s+/); // <mode> <type> <object>
    const path = entry.slice(tab + 1);
    if (meta.length < 3 || !wanted.has(path)) continue;
    out.set(path, meta[2]);
  }
  return out;
}

/**
 * The content predicate. Returns null when it could not be computed (→ UNMEASURED).
 *
 * A path absent from BOTH trees compares equal — which is correct: a deletion that
 * also happened on the baseline is a deletion that landed.
 */
function contentDelta(ref: string, base: string, exclude: boolean): Facts["content"] {
  const mb = git(["merge-base", base, ref]);
  if (!mb.ok) return null;
  const mergeBase = mb.stdout.trim();
  if (!mergeBase) return null;

  // `--no-renames` so a rename reports BOTH paths: a rename that did not land must
  // be caught on the old side as well as the new one.
  const d = git(["diff", "--no-renames", "--name-only", "-z", mergeBase, ref]);
  if (!d.ok) return null;

  const all = d.stdout.split("\0").filter((p) => p !== "");
  const kept: string[] = [];
  let excluded = 0;
  for (const p of all) {
    if (exclude && EXCLUDED_BASENAMES.has(basename(p))) { excluded++; continue; }
    kept.push(p);
  }

  const wanted = new Set(kept);
  const onBranch = blobsAt(ref, wanted);
  const onBase = blobsAt(base, wanted);
  if (!onBranch || !onBase) return null;

  // What the BASELINE itself changed since the merge-base — the second
  // discriminator's input (see `classify`). A differing path absent from this set
  // means the baseline still holds the merge-base blob, so the branch's edit
  // provably did not land.
  const bd = git(["diff", "--no-renames", "--name-only", "-z", mergeBase, base]);
  if (!bd.ok) return null;
  const baselineTouched = new Set(bd.stdout.split("\0").filter((p) => p !== ""));

  const differing = kept.filter((p) => onBranch.get(p) !== onBase.get(p)).sort();
  return {
    considered: kept.length,
    excluded,
    differing,
    unlanded: differing.filter((p) => !baselineTouched.has(p)),
    contested: differing.filter((p) => baselineTouched.has(p)),
  };
}

/** ISO date of the ref's tip commit — a git fact, never the wall clock. */
function headDate(ref: string): string {
  const r = git(["log", "-1", "--format=%cs", ref]);
  return r.ok ? r.stdout.trim() : "?";
}

/** The absolute path of the repo's MAIN working tree (the one holding `.git/`). */
function mainWorktreePath(): string | null {
  const r = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!r.ok) return null;
  const commonDir = r.stdout.trim().replace(/\/$/, "");
  return commonDir.endsWith("/.git") ? dirname(commonDir) : null;
}

// ── Report ────────────────────────────────────────────────────────────────────

type Row = {
  rec: WorktreeRec;
  klass: Klass;
  why: string;
  facts: Facts;
  date: string;
  population: "agent" | "spa" | "main" | "other";
};

/**
 * Display label. Agent worktrees are all siblings under one directory, so the
 * basename identifies them unambiguously; everything else (the spa checkouts, the
 * main checkout, anything unexpected) prints its FULL PATH, because those live in
 * arbitrary places and a bare basename would be a row you cannot safely act on.
 */
function label(r: Row | { rec: WorktreeRec; population: Row["population"] }): string {
  return r.population === "agent" ? basename(r.rec.path) : r.rec.path;
}

function populationOf(rec: WorktreeRec, mainPath: string | null): Row["population"] {
  if (mainPath && rec.path === mainPath) return "main";
  if (rec.path.includes("/.claude/worktrees/")) return "agent";
  if (/\/scrml-spa-ss\d+$/.test(rec.path) || (rec.branch ?? "").startsWith("spa/")) return "spa";
  return "other";
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printRows(rows: Row[], cap: number, uncapped: boolean): void {
  const shown = uncapped ? rows : rows.slice(0, cap);
  const w = Math.min(24, Math.max(10, ...shown.map((r) => label(r).length)));
  for (const r of shown) {
    const br = r.rec.branch ?? (r.rec.detached ? "(detached)" : "(bare)");
    console.log(`    ${pad(label(r), w)}  ${pad(br, 40)}  ${r.date}  ${r.why}`);
    // §5 per-row evidence: a row nobody can act on is a row nobody acts on. The
    // DEFINITIVELY-UNLANDED files sort first, so the three that fit are the three
    // that decide the row rather than three arbitrary ones.
    const c = r.facts.content;
    if (c && c.differing.length > 0) {
      const ordered = [...c.unlanded.map((p) => `[unlanded ] ${p}`), ...c.contested.map((p) => `[contested] ${p}`)];
      for (const line of ordered.slice(0, 3)) console.log(`      ${" ".repeat(w)}  ↳ ${line}`);
      const more = ordered.length - 3;
      if (more > 0) console.log(`      ${" ".repeat(w)}  ↳ … +${more} more differing file(s)`);
    }
  }
  if (!uncapped && rows.length > cap) {
    // The cap is PRINTED, not inferable — §4. A truncated enumeration otherwise
    // reads exactly like a complete one.
    console.log(`    … +${rows.length - cap} more row(s) NOT PRINTED (display cap ${cap}; re-run with --all)`);
  }
}

function main(argv: string[]): number {
  const uncapped = argv.includes("--all");
  const exclude = !argv.includes("--no-exclude");
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const base = at("--base") ?? "origin/main";
  const cap = Number(at("--cap") ?? 30);
  const keep = (at("--keep") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const baseSha = git(["rev-parse", base]);
  if (!baseSha.ok) {
    // Never fail a wrap on an unresolvable ref — report and move on (the
    // `review-debt.ts` UNAVAILABLE convention). Exit 0: detection, not control.
    console.log(`worktree-sweep: UNAVAILABLE — baseline ref \`${base}\` does not resolve.`);
    console.log("  Disposition NOT verified this session. Say so in the wrap report.");
    return 0;
  }

  const wl = git(["worktree", "list", "--porcelain"]);
  if (!wl.ok) {
    console.log("worktree-sweep: UNAVAILABLE — `git worktree list` failed.");
    return 0;
  }
  const recs = parseWorktreeList(wl.stdout);

  // TRUNCATION / PARSE GUARD (§4). `git worktree list` is not paginated, so there is
  // no fetch cap to widen — the only way this enumeration could be short is a PARSER
  // defect (e.g. dropping the last, non-blank-terminated record). So cross-check the
  // parsed count against an independent count of `worktree ` lines and SAY the number.
  const rawCount = wl.stdout.split("\n").filter((l) => l.startsWith("worktree ")).length;

  const mainPath = mainWorktreePath();
  const selfPath = ROOT;

  const rows: Row[] = [];
  for (const rec of recs) {
    const exists = existsSync(rec.path) && !rec.prunable;
    const ref = rec.branch ?? rec.head ?? "";

    let protectedReason: string | null = null;
    if (rec.path === mainPath || rec.branch === "main") protectedReason = "the MAIN checkout";
    else if (rec.path === selfPath) protectedReason = "this script's own worktree";
    else if (rec.locked) protectedReason = `LOCKED — a live agent holds it${rec.lockReason ? ` (${rec.lockReason})` : ""}`;
    else if (keep.some((k) => rec.path.includes(k) || (rec.branch ?? "").includes(k))) protectedReason = "--keep";

    const facts: Facts = {
      exists,
      protectedReason,
      branch: rec.branch,
      dirtyCount: exists ? dirtyCount(rec.path) : null,
      content: exists && ref ? contentDelta(ref, base, exclude) : null,
    };
    const { klass, why } = classify(facts);
    rows.push({ rec, klass, why, facts, date: exists && ref ? headDate(ref) : "?", population: populationOf(rec, mainPath) });
  }

  const M = rows.length;
  const of = (n: number) => `${n} of ${M}`;
  const byClass = (k: Klass) => rows.filter((r) => r.klass === k);

  const sweepable = byClass("SWEEPABLE");
  const vacuous = sweepable.filter((r) => (r.facts.content?.considered ?? 0) === 0);
  const substantive = sweepable.filter((r) => (r.facts.content?.considered ?? 0) > 0);
  const holds = byClass("HOLDS-WORK");
  const definite = holds.filter((r) => (r.facts.content?.unlanded.length ?? 0) > 0);
  const drifted = holds.filter((r) => (r.facts.content?.unlanded.length ?? 0) === 0);

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  worktree-sweep — wrap 6b disposition (DRY RUN; this script deletes NOTHING)");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`Baseline: ${base} @ ${baseSha.stdout.trim().slice(0, 8)}   (local ref — run \`git fetch\` yourself if it may be behind)`);
  console.log(`Predicate: CONTENT, not ancestry — for each file touched since merge-base(${base}, <ref>),`);
  console.log(`           compare the branch blob against the ${base} blob. \`git branch --merged\` is`);
  console.log(`           structurally wrong here: file-delta landings are never ancestors.`);
  console.log(exclude
    ? `Excluded from the comparison, BY BASENAME: ${[...EXCLUDED_BASENAMES].join(", ")} — agent crash-recovery artifacts that never land by design.`
    : `Exclusions DISABLED (--no-exclude): ${[...EXCLUDED_BASENAMES].join(", ")} ARE being compared. Expect landed worktrees to read HOLDS-WORK.`);
  console.log("");
  console.log(`Scanned: ${M} worktree(s) parsed from \`git worktree list --porcelain\` (${rawCount} \`worktree \` records in the raw output).`);
  if (M !== rawCount) {
    console.log(`  ⚠️ PARSE MISMATCH — ${rawCount} records in, ${M} out. Every count below may be short. Do not act on this run.`);
  }
  console.log(`  populations: agent ${rows.filter((r) => r.population === "agent").length} · spa ${rows.filter((r) => r.population === "spa").length} · main ${rows.filter((r) => r.population === "main").length} · other ${rows.filter((r) => r.population === "other").length}`);
  console.log("");
  console.log("Disposition:");
  console.log(`  SWEEPABLE  : ${of(sweepable.length)}   (${substantive.length} with landed content · ${vacuous.length} VACUOUS — zero committed delta)`);
  console.log(`  HOLDS-WORK : ${of(holds.length)}   (${definite.length} with ≥1 file the baseline never touched → DEFINITIVELY unlanded · ${drifted.length} all-contested → may have landed then drifted)`);
  console.log(`  DIRTY      : ${of(byClass("DIRTY").length)}   (uncommitted — never sweepable regardless of content)`);
  console.log(`  PROTECTED  : ${of(byClass("PROTECTED").length)}`);
  console.log(`  NO-BRANCH  : ${of(byClass("NO-BRANCH").length)}`);
  console.log(`  GONE       : ${of(byClass("GONE").length)}`);
  console.log(`  UNMEASURED : ${of(byClass("UNMEASURED").length)}   (a fact could not be read — NOT assumed either way)`);
  console.log("");

  console.log("Per-file evidence tags: [unlanded ] the baseline never touched this path since the merge-base,");
  console.log("                        so the branch's edit provably did NOT land — no judgement required.");
  console.log("                        [contested] the baseline changed it too — may have landed then drifted.");
  console.log("");

  // The ACTIONABLE classes print in full by default; the inert ones are summarised
  // unless --all. Both halves state their own cap.
  for (const k of ["SWEEPABLE", "HOLDS-WORK", "DIRTY", "UNMEASURED"] as Klass[]) {
    let rs = byClass(k);
    if (rs.length === 0) continue;
    // HOLDS-WORK is the big pile, so order it by how close each row is to being
    // drainable — fewest definitively-unlanded files first. Under a display cap
    // that puts the rows an operator can actually resolve above the fold instead
    // of leaving them at position 60-of-69.
    if (k === "HOLDS-WORK") {
      rs = [...rs].sort((a, b) => (a.facts.content?.unlanded.length ?? 0) - (b.facts.content?.unlanded.length ?? 0));
    }
    console.log(`${k} — ${rs.length}:`);
    printRows(rs, cap, uncapped);
    console.log("");
  }
  for (const k of ["PROTECTED", "NO-BRANCH", "GONE"] as Klass[]) {
    const rs = byClass(k);
    if (rs.length === 0) continue;
    if (!uncapped) {
      console.log(`${k} — ${rs.length} (summarised; --all prints every row)`);
      printRows(rs, Math.min(cap, 6), false);
    } else {
      console.log(`${k} — ${rs.length}:`);
      printRows(rs, cap, true);
    }
    console.log("");
  }

  console.log("This is a REPORT. Removal is a separate, explicitly-authorized act — confirm each");
  console.log("SWEEPABLE row against the hand-off before `git worktree remove` / `git branch -D`.");
  console.log("══════════════════════════════════════════════════════════════════");

  // ⚑ ALWAYS 0. Detection, not control (pa-base §8). A gate red over a pre-existing
  // ~77-workspace backlog gets bypassed and then deleted, and there is deliberately
  // no `--check` for the same reason. Do NOT wire this into CI.
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
