#!/usr/bin/env bun
// scripts/git-merge-generated.ts — a git merge driver for files that carry GENERATED content.
// change-id: s468-generated-merge-driver
//
// ═══ WHY ═══════════════════════════════════════════════════════════════════════════════════════
// Every PR regenerates the same tracked generated content (the `@generated:gap-counts` table in
// docs/known-gaps.md, the `@generated:facts-*` tables in docs/FACTS.md, …), so ANY two open PRs
// conflict on it, and every merge to main re-conflicts every other open PR (S468: 9 open PRs, all
// `dirty`, every one on generated rows). Hand-resolving those hunks is also where the damage comes
// from: picking either side of a count is wrong (it silently drops the other side's entries — the
// memory note `feedback_mixed_generated_doc_conflicts`), and a hand edit once left a stray
// half-table behind in docs/known-gaps.md that is still there.
//
// ═══ THE TWO PHASES — and why it is two, not one (MEASURED, not assumed) ══════════════════════
// The obvious design is "let git merge, then run each producer's `--write` over the merged working
// tree". That premise is FALSE inside a merge driver. Executed at S468 (git 2.55, merge-ort, both
// `git merge` and `git rebase`): while a driver runs, git has handed it three TEMP files and the
// working tree still holds the PRE-MERGE (ours) version of every other path — a sibling file changed
// only by theirs still read `base` — and MERGE_HEAD does not exist yet. merge-ort computes the whole
// merge in memory and checks the result out at the END. So a producer that reads OTHER files
// (facts.ts reads compiler/src, SPEC.md, conformance/; regen-spec-index.ts reads SPEC.md; state.ts's
// recent-sessions reads `git log`) would, run from the driver, derive from ours' tree — a confidently
// wrong value. Hence:
//
//   PHASE 1 — this driver, inside the merge (a pure function of %O %A %B):
//     1. MASK every generated region in all three versions (its body replaced by nothing), so the
//        3-way merge sees only hand-written text. Generated churn can no longer conflict.
//     2. `git merge-file` the masked versions. Any conflict left is in HAND-WRITTEN text. ONE shape of it
//        is resolved: when EVERY conflicted hunk is both sides INSERTING distinct new `@gap` entries at
//        the same spot (empty base side, disjoint ids), the hunks are UNIONED, ours first
//        (`unionEntryAdditions`, ruled S469). Anything else → the file is written with markers and the
//        driver exits 1: a human/agent 3-way is still owed for that.
//     3. Fill each generated region back in:
//          SELF-CONTAINED sections (derived only from the file's own text — today `gap-counts`, from
//          the `@gap` markers of the same file) are REGENERATED EXACTLY from the merged text, by the
//          producer's own exported function (state.ts `gapCountsSection`). ORDER MATTERS: this runs
//          after step 2, so every entry from both sides is already in the text being counted.
//          A clean textual merge is NOT trusted here: two PRs that each add one HIGH both move
//          `HIGH 264` to `265`; git sees an identical change on both sides and keeps ONE — a count
//          that is wrong with no conflict to warn anyone. Hence ALWAYS regenerate.
//          CROSS-FILE sections / rows / wholly-generated files cannot be derived here (see above).
//          A section only ONE side changed takes that side's value — right, because the side that
//          left it alone left its inputs alone too (or its own currency gate failed). A section BOTH
//          sides changed differently has NO right value here: the driver STOPS — the file is written
//          with a REGENERATION REQUIRED marker block over a provisional value, exit 1, a normal
//          conflict — and `--regen` derives it from the merged tree and stages it (S469 review: a
//          provisional value must never be committed silently). History-derived content
//          (recent-sessions: `git log`) is the one exception: it cannot be derived until the merge
//          COMMIT exists, so it stays provisional + pending for the post-merge hook / `--regen`.
//     4. SELF-CHECK — a MULTISET 3-way of every `@gap` id's count (fenced code ignored): the result
//        must hold exactly the count the 3-way implies — no drop, no double-filing, no id whose count
//        both sides changed. A violation FAILS the merge loudly (exit 1, a marker block on top).
//
//   PHASE 2 — `bun scripts/git-merge-generated.ts --regen`: (a) during a merge STOPPED for
//     regeneration (every unmerged path carries the regen block): strips the blocks, runs the
//     producers over the merged tree, stages the files; then commit. (b) after a completed merge /
//     rebase: regenerates pending paths (the post-merge / post-rewrite hooks run it). A pending
//     record is keyed to the operation (ORIG_HEAD) so an aborted merge's record is dropped, never
//     replayed on the next unrelated merge. The CI currency gates (`facts.ts --check`, …) stay the
//     backstop.
//
// ═══ WHAT IS GENERATED (each producer's header read at S468) ════════════════════════════════════
//   docs/known-gaps.md            `@generated:gap-counts`       state.ts       SELF-CONTAINED (own @gap markers)
//   master-list.md                `@generated:recent-sessions`  state.ts       cross (git history)
//   docs/FACTS.md                 `@generated:facts-table`,     facts.ts       cross (compiler/src, SPEC.md, …)
//                                 `@generated:facts-lists`
//   compiler/SPEC-INDEX.md        `@generated:spec-index-totals` + the Lines/Size cells of every
//                                 Sections-table row            regen-spec-index.ts  cross (SPEC.md)
//   docs/bootstrap-conformance.md WHOLE FILE (`@generated by` header)  bootstrap-conformance.ts  cross (a run, ~60 s)
// An `@generated:<name>` section this table does not name is handled as CROSS-FILE (provisional +
// pending), never as hand text and never as self-contained — the safe default.
//
// ═══ INSTALL (merge drivers are PER-CLONE config; all worktrees of a clone share it) ═══════════
//   scripts/install-merge-driver.sh — IDEMPOTENT; run by every `bun run pretest` and by
//   scripts/git-hooks/install.sh; `--uninstall` undoes it. It sets ONLY the config; the attribute and
//   the code are the checked-out branch's own (.gitattributes, scripts/git-merge-generated.{sh,ts}),
//   so a branch that predates the driver never runs it and no other worktree's copy ever runs.
//   git invokes scripts/git-merge-generated.sh, a crash-safe wrapper: if this script exits without
//   writing its result (import-time throw, crash, OOM, no bun), the wrapper writes git's plain 3-way
//   of the original inputs WITH markers under a loud block and exits 1 — never pure ours unmarked.
//   ⚑ DETERMINISM: no phase reads the clock or the network. Phase 1 is a pure function of %O %A %B;
//   phase 2 runs the repo's own producers over the merged tree (+ `git log` for recent-sessions).
//   ⚑ GitHub's server-side merge NEVER runs custom drivers: a PR shows `dirty` on GitHub until its
//   branch is updated locally (`git merge origin/main` with the driver installed) and pushed.
//
// MODES:
//   bun scripts/git-merge-generated.ts %O %A %B %P [%L %S %X %Y]   the driver (git invokes it)
//   bun scripts/git-merge-generated.ts --regen [--all]               phase 2 (pending paths, or all)
//   bun scripts/git-merge-generated.ts --pending                     print the pending record
//
// Exit codes (driver): 0 = merged clean (pending regen recorded if any); 1 = conflict left in
// hand-written text, OR derived content both sides changed (regen block), OR the self-check failed,
// OR an internal error. Every exit-1 file carries conflict markers. Dependency-free (Bun built-ins +
// scripts/state.ts).

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gapCountsSection } from "./state.ts";

// ─── file classification ────────────────────────────────────────────────────────────────────────

/** Sections whose body derives ONLY from the text of the file they sit in. name → producer. */
export const SELF_CONTAINED: Record<string, (mergedText: string) => string> = {
  "gap-counts": (t) => gapCountsSection(t),
};

/** Repo-relative path → the producer command that regenerates its generated content (phase 2). */
export const PRODUCERS: { path: string; cmd: string[]; historyDerived?: boolean; slow?: boolean }[] = [
  { path: "compiler/SPEC-INDEX.md", cmd: ["bun", "run", "scripts/regen-spec-index.ts"] },
  { path: "docs/FACTS.md", cmd: ["bun", "scripts/facts.ts", "--write"] },
  // state.ts --write regenerates BOTH gap-counts (known-gaps.md) and recent-sessions (master-list.md);
  // recent-sessions reads `git log` of HEAD, so it is only right once the merge COMMIT exists.
  { path: "docs/known-gaps.md", cmd: ["bun", "scripts/state.ts", "--write"], historyDerived: true },
  { path: "master-list.md", cmd: ["bun", "scripts/state.ts", "--write"], historyDerived: true },
  { path: "docs/bootstrap-conformance.md", cmd: ["bun", "scripts/bootstrap-conformance.ts", "--write"], slow: true },
];

const SPEC_INDEX_PATH = "compiler/SPEC-INDEX.md";

// ─── masking ────────────────────────────────────────────────────────────────────────────────────

const START_RE = /<!--\s*@generated:([A-Za-z0-9_.-]+)\s+START\b[^>]*-->/g;
const endReFor = (name: string) =>
  new RegExp(`<!--\\s*@generated:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+END\\b[^>]*-->`, "g");

type Masked = { text: string; values: Map<string, string>; names: Set<string> };

/**
 * Walk every START…END pair (START of a name, then the NEXT END of that same name). Calls `fn` with
 * the pair's key (`<name>#<occurrence>`) and its current body; `fn` returns the body to put back.
 * The body boundary matches state.ts `findAnchorSpan`: the newline after START and the newline
 * before END belong to the markers, so an empty body is `START\nEND`.
 * A START with no matching END is left as hand text (the stray-fragment case).
 */
function mapAnchors(text: string, fn: (key: string, name: string, body: string) => string): string {
  let out = "";
  let pos = 0;
  const seen = new Map<string, number>();
  START_RE.lastIndex = 0;
  for (;;) {
    START_RE.lastIndex = pos;
    const sm = START_RE.exec(text);
    if (!sm) break;
    const name = sm[1];
    const startEnd = sm.index + sm[0].length;
    const er = endReFor(name);
    er.lastIndex = startEnd;
    const em = er.exec(text);
    if (!em) {
      out += text.slice(pos, startEnd);
      pos = startEnd;
      continue;
    }
    const eol = text[startEnd] === "\r" ? "\r\n" : "\n";
    let bs = startEnd;
    if (text[bs] === "\r") bs++;
    if (text[bs] === "\n") bs++;
    let be = em.index;
    if (text[be - 1] === "\n") be--;
    if (text[be - 1] === "\r") be--;
    const body = be > bs ? text.slice(bs, be) : "";
    const k = seen.get(name) ?? 0;
    seen.set(name, k + 1);
    const next = fn(`${name}#${k}`, name, body);
    out += text.slice(pos, startEnd) + eol + (next === "" ? "" : next + eol);
    pos = em.index;
  }
  return out + text.slice(pos);
}

// SPEC-INDEX Sections-table rows: the Lines + Size cells are generated, the rest of the row is not.
// The row grammar is regen-spec-index.ts's own (`| key | name | range | size | summary`).
const ROW_RE = /^\| (.+?) \| (.+?) \| (\d+(?:-\d+)?|—) \| (\d+|—) \| /;
const MASKED_ROW_RE = /^\| (.+?) \| (.+?) \| ~ \| ~ \| /;

function mapSpecIndexRows(
  text: string,
  re: RegExp,
  fn: (key: string, cells: string) => string,
): string {
  const lines = text.split("\n");
  const seen = new Map<string, number>();
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith("| § | Section ")) { inTable = true; continue; }
    if (!inTable) continue;
    if (ln.startsWith("|---")) continue;
    if (!ln.startsWith("|")) { inTable = false; continue; }
    const m = re.exec(ln);
    if (!m) continue;
    const key = m[1].trim();
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const cells = m[3] !== undefined ? `${m[3]} | ${m[4]}` : "";
    const next = fn(`row:${key}#${k}`, cells);
    lines[i] = `| ${m[1]} | ${m[2]} | ${next} | ${ln.slice(m[0].length)}`;
  }
  return lines.join("\n");
}

export function isWhollyGenerated(text: string): boolean {
  return /<!--\s*@generated by\b/.test(text.split("\n").slice(0, 10).join("\n"));
}

export function mask(text: string, path: string): Masked {
  const values = new Map<string, string>();
  const names = new Set<string>();
  if (isWhollyGenerated(text)) {
    values.set("whole#0", text);
    names.add("whole");
    return { text: "", values, names };
  }
  let t = mapAnchors(text, (key, name, body) => {
    values.set(key, body);
    names.add(name);
    return "";
  });
  if (path.replace(/\\/g, "/").endsWith(SPEC_INDEX_PATH)) {
    t = mapSpecIndexRows(t, ROW_RE, (key, cells) => {
      values.set(key, cells);
      names.add("spec-index-rows");
      return "~ | ~";
    });
  }
  return { text: t, values, names };
}

/** Section-level 3-way. A side that left the value at base yields to the side that changed it. */
function pick3(o: string | undefined, a: string | undefined, b: string | undefined): string {
  return pick3x(o, a, b).v;
}

/**
 * pick3 + whether it was a TRUE two-sided change (both sides moved the value, differently). For
 * content derived from OTHER files that case has no right answer inside the driver: both parents'
 * values are stale for the merged tree. (A one-sided change is right: the side that did not touch
 * the section did not touch its inputs either, or its own currency gate would have failed.)
 */
function pick3x(o: string | undefined, a: string | undefined, b: string | undefined): { v: string; twoSided: boolean } {
  if (a === undefined) return { v: b ?? o ?? "", twoSided: false };
  if (b === undefined) return { v: a, twoSided: false };
  if (a === b) return { v: a, twoSided: false };
  if (a === o) return { v: b, twoSided: false };
  if (b === o) return { v: a, twoSided: false };
  return { v: a, twoSided: true };
}

/** Sections whose producer reads git HISTORY: regenerable only once the merge commit exists. */
const HISTORY_DERIVED_SECTIONS = new Set(["recent-sessions"]);

// ─── gap-id union invariant ─────────────────────────────────────────────────────────────────────

/** Multiset of real `@gap` ids (the doc's own `id=<placeholder>` format examples excluded). */
export function gapIdCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  // A marker inside a fenced code block is an EXAMPLE, not an entry — it must not let a dropped entry
  // with the same id pass the self-check.
  for (const m of stripFences(text).matchAll(/<!--\s*@gap\s+([\s\S]*?)\s*-->/g)) {
    for (const pair of m[1].trim().split(/\s+/)) {
      if (!pair.startsWith("id=")) continue;
      const id = pair.slice(3);
      if (id && !id.startsWith("<")) out.set(id, (out.get(id) ?? 0) + 1);
      break;
    }
  }
  return out;
}

/** Blank out fenced code blocks (``` / ~~~), keeping line structure. */
export function stripFences(text: string): string {
  let fence: string | null = null;
  return text.split("\n").map((ln) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(ln);
    if (fence === null) {
      if (m) { fence = m[1][0]; return ""; }
      return ln;
    }
    if (m && m[1][0] === fence) fence = null;
    return "";
  }).join("\n");
}

/**
 * A MULTISET 3-way check, per id, against both parents. The expected count of each id in the result
 * is the 3-way of its counts: unchanged on a side → the other side's count; equal on both → that.
 * The result must hold EXACTLY that many. So a drop (fewer), a double-filing (more), and an id whose
 * count both sides changed differently (no right answer) all fail.
 * ⚑ A side deliberately DELETING an entry the other left alone is a legitimate 3-way outcome (count
 * 1 → 0 on one side → expected 0), not a drop — the literal `ids(ours) ∪ ids(theirs) ⊆ ids(result)`
 * would false-fail it.
 */
export function gapIdSelfCheck(
  o: string, a: string, b: string, result: string,
): { dropped: string[]; duplicated: string[]; ambiguous: string[] } {
  const O = gapIdCounts(o), A = gapIdCounts(a), B = gapIdCounts(b), R = gapIdCounts(result);
  const dropped: string[] = [], duplicated: string[] = [], ambiguous: string[] = [];
  for (const id of new Set([...O.keys(), ...A.keys(), ...B.keys(), ...R.keys()])) {
    const on = O.get(id) ?? 0, an = A.get(id) ?? 0, bn = B.get(id) ?? 0, rn = R.get(id) ?? 0;
    let exp: number | null;
    if (an === bn) exp = an;
    else if (an === on) exp = bn;
    else if (bn === on) exp = an;
    else exp = null;
    if (exp === null) ambiguous.push(id);
    else if (rn < exp) dropped.push(id);
    else if (rn > exp) duplicated.push(id);
  }
  return { dropped: dropped.sort(), duplicated: duplicated.sort(), ambiguous: ambiguous.sort() };
}

// ─── the merge ──────────────────────────────────────────────────────────────────────────────────

export type MergeResult = {
  text: string;
  conflicts: number;           // conflicts left in HAND-WRITTEN text (0 = clean)
  pending: boolean;            // cross-file generated content holds a PROVISIONAL value
  regenerated: string[];       // self-contained sections regenerated exactly
  provisional: string[];       // cross-file sections / rows / whole file given a provisional value
  unioned: number;             // same-spot entry-addition hunks resolved by the union rule
  /** cross-file sections BOTH sides changed differently: no right value exists inside the driver,
   *  so the merge STOPS on them (exit 1) until `--regen` derives them from the merged tree. */
  needsRegen: string[];
  selfCheck: { dropped: string[]; duplicated: string[]; ambiguous: string[] };
};

export type Labels = { ours: string; base: string; theirs: string };

function scratchDir(): string {
  return mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scrml-merge-gen-"));
}

/** Plain `git merge-file -p` over three texts. Returns the merged text + the conflict count. */
export function gitMergeFile(o: string, a: string, b: string, markerSize: number, labels: Labels): { text: string; conflicts: number } {
  const dir = scratchDir();
  try {
    const po = join(dir, "base"), pa = join(dir, "ours"), pb = join(dir, "theirs");
    writeFileSync(po, o);
    writeFileSync(pa, a);
    writeFileSync(pb, b);
    const r = spawnSync(
      "git",
      ["merge-file", "-p", `--marker-size=${markerSize}`, "-L", labels.ours, "-L", labels.base, "-L", labels.theirs, pa, po, pb],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (r.status === null || r.status > 127 || r.error) {
      throw new Error(`git merge-file failed (status ${r.status}): ${r.stderr || r.error}`);
    }
    return { text: r.stdout, conflicts: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function mergeGenerated(
  o: string,
  a: string,
  b: string,
  path: string,
  markerSize = 7,
  labels: Labels = { ours: "ours", base: "base", theirs: "theirs" },
): MergeResult {
  const mo = mask(o, path), ma = mask(a, path), mb = mask(b, path);
  const regenerated: string[] = [];
  const provisional: string[] = [];

  // Wholly-generated file: there is no hand text to merge.
  if (ma.names.has("whole") || mb.names.has("whole")) {
    const p = pick3x(mo.values.get("whole#0"), ma.values.get("whole#0"), mb.values.get("whole#0"));
    provisional.push("(whole file)");
    return {
      text: p.v, conflicts: 0, pending: true, regenerated, provisional, unioned: 0,
      needsRegen: p.twoSided ? ["(whole file)"] : [], selfCheck: gapIdSelfCheck(o, a, b, p.v),
    };
  }

  // Step 2 — hand text only. A conflict left there is retried as a UNION when every conflicted hunk
  // is two sides each ADDING whole, distinct ledger entries at the same spot (see unionEntryAdditions).
  let merged = gitMergeFile(mo.text, ma.text, mb.text, markerSize, labels);
  let unioned = 0;
  if (merged.conflicts > 0) {
    const u = unionEntryAdditions(mo.text, ma.text, mb.text, markerSize, labels);
    if (u) { merged = { text: u.text, conflicts: 0 }; unioned = u.hunks; }
  }

  // Step 3 — fill. Self-contained sections derive from the merged HAND text (every entry of both
  // sides is in it by now); the generated bodies hold no @gap markers, so the masked text counts the same.
  const selfCache = new Map<string, string>();
  const needsRegen: string[] = [];
  const cross = (name: string, o1?: string, a1?: string, b1?: string): string => {
    const p = pick3x(o1, a1, b1);
    if (p.twoSided && !HISTORY_DERIVED_SECTIONS.has(name) && !needsRegen.includes(name)) needsRegen.push(name);
    return p.v;
  };
  let text = mapAnchors(merged.text, (key, name) => {
    const self = SELF_CONTAINED[name];
    if (self && merged.conflicts === 0) {
      if (!selfCache.has(name)) selfCache.set(name, self(merged.text));
      if (!regenerated.includes(name)) regenerated.push(name);
      return selfCache.get(name)!;
    }
    // A self-contained section in a CONFLICTED file cannot be counted (the markers hold both sides),
    // so it is provisional too; resolving the conflict + phase 2 regenerates it.
    if (!provisional.includes(name)) provisional.push(name);
    if (self) return pick3(mo.values.get(key), ma.values.get(key), mb.values.get(key));
    return cross(name, mo.values.get(key), ma.values.get(key), mb.values.get(key));
  });
  if (path.replace(/\\/g, "/").endsWith(SPEC_INDEX_PATH)) {
    text = mapSpecIndexRows(text, MASKED_ROW_RE, (key) => {
      if (!provisional.includes("spec-index-rows")) provisional.push("spec-index-rows");
      return cross("spec-index-rows", mo.values.get(key), ma.values.get(key), mb.values.get(key)) || "— | —";
    });
  }
  const pending = provisional.length > 0;
  const selfCheck = merged.conflicts === 0 ? gapIdSelfCheck(o, a, b, text) : { dropped: [], duplicated: [], ambiguous: [] };
  return { text, conflicts: merged.conflicts, pending, regenerated, provisional, unioned, needsRegen, selfCheck };
}

/**
 * The UNION rule for same-spot ledger additions (ruled S469: "union gap entries").
 * Two PRs that each file a NEW gap entry at the same place (the tail of a section — the usual case)
 * conflict in hand-written text with an EMPTY base side: neither replaced anything, both inserted.
 * Keeping both is then the only right answer, so the driver takes ours-then-theirs — but ONLY when
 * EVERY conflicted hunk satisfies all of:
 *   - the base side of the hunk is empty (whitespace only) — a pure insertion on both sides;
 *   - each side's insertion carries at least one `@gap id=` marker (it is ledger entries, not prose);
 *   - the two sides' id sets are disjoint (the same id filed twice is a real conflict, not a union);
 *   - no non-blank line appears in BOTH insertions (a union would file that line twice).
 * The diff3 output is parsed with a marker size of UNION_MARKER and the exact labels, the base marker
 * must come first and its body must be blank, so a content line such as a setext `=======` underline
 * can never be read as a separator.
 * Any hunk failing any test → null, and the caller keeps the plain conflict: the rule never
 * resolves a hunk where one side changed or deleted existing text. Order is deterministic (ours
 * first). The gap-id self-check still runs on the result.
 */
const UNION_MARKER = 31;

export function unionEntryAdditions(
  o: string, a: string, b: string, markerSize: number, labels: Labels,
): { text: string; hunks: number } | null {
  const dir = scratchDir();
  let r;
  try {
    const po = join(dir, "base"), pa = join(dir, "ours"), pb = join(dir, "theirs");
    writeFileSync(po, o); writeFileSync(pa, a); writeFileSync(pb, b);
    r = spawnSync(
      "git",
      ["merge-file", "-p", "--diff3", `--marker-size=${UNION_MARKER}`, "-L", "U-OURS", "-L", "U-BASE", "-L", "U-THEIRS", pa, po, pb],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (r.status === null || r.status > 127 || r.error || r.status === 0) return null;
  const OPEN = "<".repeat(UNION_MARKER) + " U-OURS", BASE = "|".repeat(UNION_MARKER) + " U-BASE";
  const SEP = "=".repeat(UNION_MARKER), CLOSE = ">".repeat(UNION_MARKER) + " U-THEIRS";
  const isMark = (ln: string, m: string) => ln === m;
  const lines = r.stdout.split("\n");
  const out: string[] = [];
  let hunks = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isMark(lines[i], OPEN)) { out.push(lines[i]); continue; }
    const ours: string[] = [], base: string[] = [], theirs: string[] = [];
    let cur = ours, j = i + 1, closed = false;
    for (; j < lines.length; j++) {
      const ln = lines[j];
      if (cur === ours && isMark(ln, BASE)) { cur = base; continue; }
      if (cur === base && ln === SEP) { cur = theirs; continue; }
      if (cur === theirs && isMark(ln, CLOSE)) { closed = true; break; }
      if (isMark(ln, OPEN)) return null; // nested / malformed
      cur.push(ln);
    }
    if (!closed || cur !== theirs) return null; // no base marker first, or unterminated
    if (base.some((l) => l.trim() !== "")) return null;
    const ia = gapIdCounts(ours.join("\n")), ib = gapIdCounts(theirs.join("\n"));
    if (ia.size === 0 || ib.size === 0) return null;
    for (const id of ia.keys()) if (ib.has(id)) return null;
    const oursLines = new Set(ours.filter((l) => l.trim() !== ""));
    if (theirs.some((l) => l.trim() !== "" && oursLines.has(l))) return null;
    // Keep the ledger's blank-line separation between the two insertions.
    const joint = [...ours];
    if (joint.length && joint[joint.length - 1].trim() !== "" && theirs.length && theirs[0].trim() !== "") joint.push("");
    out.push(...joint, ...theirs);
    hunks++;
    i = j;
  }
  return hunks > 0 ? { text: out.join("\n"), hunks } : null;
}


// ─── pending record (per worktree: `git rev-parse --git-path` resolves to the worktree's own dir) ─
//
// Line 1 `key <sha>`: the commit the operation started from — HEAD for a merge, the branch's
// pre-rebase tip for a rebase (git's own `rebase-*/orig-head`). Both equal ORIG_HEAD once the
// operation completes, which is how a record is told apart from a STALE one: after
// `git merge --abort` HEAD is still the key (nothing was merged → the record is dropped), and a
// later unrelated merge has a different ORIG_HEAD… unless it starts from the same commit, so phase 2
// also only regenerates a pending path the completed operation actually changed (ORIG_HEAD..HEAD).

function git(args: string[], cwd?: string): { out: string; ok: boolean } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
}

function gitPath(p: string, cwd?: string): string {
  return git(["rev-parse", "--path-format=absolute", "--git-path", p], cwd).out;
}

function pendingFile(cwd?: string): string {
  return gitPath("scrml-generated-pending", cwd);
}

function rebaseOrigHead(cwd?: string): string {
  for (const d of ["rebase-merge", "rebase-apply"]) {
    const f = gitPath(`${d}/orig-head`, cwd);
    if (f && existsSync(f)) return readFileSync(f, "utf8").trim();
  }
  return "";
}

function operationInProgress(cwd?: string): boolean {
  if (rebaseOrigHead(cwd)) return true;
  return ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD"].some((h) => git(["rev-parse", "-q", "--verify", h], cwd).ok);
}

/** The key a driver run records: the rebase's original tip, else HEAD. */
function currentKey(cwd?: string): string {
  return rebaseOrigHead(cwd) || git(["rev-parse", "-q", "--verify", "HEAD"], cwd).out;
}

type PendingRecord = { key: string; paths: string[] };

function readRecord(cwd?: string): PendingRecord {
  const f = pendingFile(cwd);
  if (!f || !existsSync(f)) return { key: "", paths: [] };
  const lines = readFileSync(f, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  const key = lines[0]?.startsWith("key ") ? lines.shift()!.slice(4) : "";
  return { key, paths: lines };
}

function writeRecord(rec: PendingRecord, cwd?: string): void {
  const f = pendingFile(cwd);
  if (!f) return;
  const uniq = [...new Set(rec.paths)].sort();
  if (uniq.length === 0) { rmSync(f, { force: true }); return; }
  writeFileSync(f, `key ${rec.key}\n` + uniq.join("\n") + "\n");
}

/** The record's paths IF it belongs to the operation in progress / just completed; a stale record is dropped. */
export function readPending(cwd?: string): string[] {
  const rec = readRecord(cwd);
  if (rec.paths.length === 0) return [];
  if (operationInProgress(cwd)) {
    if (rec.key === currentKey(cwd)) return rec.paths;
    writeRecord({ key: "", paths: [] }, cwd);
    return [];
  }
  const head = git(["rev-parse", "-q", "--verify", "HEAD"], cwd).out;
  const orig = git(["rev-parse", "-q", "--verify", "ORIG_HEAD"], cwd).out;
  if (!rec.key || rec.key === head || rec.key !== orig) {
    // aborted (HEAD never moved), or left over from an operation that is not the one that just ran
    writeRecord({ key: "", paths: [] }, cwd);
    return [];
  }
  return rec.paths.filter((p) => !git(["diff", "--quiet", orig, head, "--", p], cwd).ok);
}

function addPending(path: string, cwd?: string): void {
  const key = currentKey(cwd);
  const rec = readRecord(cwd);
  writeRecord({ key, paths: rec.key === key ? [...rec.paths, path] : [path] }, cwd);
}

// ─── driver entry ───────────────────────────────────────────────────────────────────────────────

const MARK = (c: string, n: number) => c.repeat(n);
const REGEN_TAG = "scrml-generated-merge: REGENERATION REQUIRED";

function failBlock(n: number, why: string): string {
  // A real marker block, so `conflict-marker-gate.ts` and every editor see it as unresolved.
  return `${MARK("<", n)} scrml-generated-merge: ${why}\n` +
    `This merge was STOPPED by scripts/git-merge-generated.ts. Below is git's plain 3-way merge.\n` +
    `${MARK("=", n)}\n` +
    `${MARK(">", n)} resolve by hand, then delete this block\n`;
}

/** The block on a file whose derived content both sides changed. `--regen` removes it. */
export function regenBlock(n: number, sections: string[]): string {
  return `${MARK("<", n)} ${REGEN_TAG} — both sides changed derived content: ${sections.join(", ")}\n` +
    `Run \`bun scripts/git-merge-generated.ts --regen\`: it regenerates this file from the MERGED tree and stages it.\n` +
    `${MARK("=", n)}\n` +
    `${MARK(">", n)} (the text below is provisional)\n`;
}

/** If `text` starts with a regen block (and holds no OTHER conflict marker), the text without it. */
export function stripRegenBlock(text: string): string | null {
  const m = /^(<{7,}) scrml-generated-merge: REGENERATION REQUIRED[^\n]*\n[^\n]*\n(={7,})\n(>{7,}) [^\n]*\n/.exec(text);
  if (!m || m[1].length !== m[2].length || m[1].length !== m[3].length) return null;
  const rest = text.slice(m[0].length);
  const n = m[1].length;
  const marker = new RegExp(`^(${"<".repeat(n)}|${"=".repeat(n)}|${">".repeat(n)})( |$)`, "m");
  return marker.test(rest) ? null : rest;
}

function label(s: string | undefined, dflt: string): string {
  return !s || s.startsWith("%") ? dflt : s;
}

function runDriver(argv: string[]): number {
  const [pO, pA, pB, pathArg, markerArg, sArg, xArg, yArg] = argv;
  const path = (pathArg ?? pA).replace(/\\/g, "/");
  const markerSize = Number(markerArg) > 0 ? Number(markerArg) : 7;
  const labels: Labels = { ours: label(xArg, "ours"), base: label(sArg, "base"), theirs: label(yArg, "theirs") };
  const o = readFileSync(pO, "utf8"), a = readFileSync(pA, "utf8"), b = readFileSync(pB, "utf8");
  const tag = `scrml-generated-merge [${path}]`;
  // The wrapper (scripts/git-merge-generated.sh) treats a run that exits WITHOUT this sentinel as a
  // crash and writes git's plain 3-way (with markers) itself — so it is written only after %A is.
  const done = (rc: number): number => { writeFileSync(`${pA}.scrml-done`, String(rc)); return rc; };
  const plainOr = (): string => { try { return gitMergeFile(o, a, b, markerSize, labels).text; } catch { return a; } };
  let r: MergeResult;
  try {
    r = mergeGenerated(o, a, b, path, markerSize, labels);
  } catch (e) {
    writeFileSync(pA, failBlock(markerSize, `INTERNAL ERROR: ${String((e as Error)?.message ?? e).split("\n")[0]}`) + plainOr());
    console.error(`${tag}: INTERNAL ERROR — fell back to git's plain 3-way merge; resolve by hand.\n${(e as Error)?.stack ?? e}`);
    return done(1);
  }
  const sc = r.selfCheck;
  if (sc.dropped.length || sc.duplicated.length || sc.ambiguous.length) {
    const why = [
      sc.dropped.length ? `gap ids DROPPED: ${sc.dropped.join(", ")}` : "",
      sc.duplicated.length ? `gap ids DUPLICATED: ${sc.duplicated.join(", ")}` : "",
      sc.ambiguous.length ? `gap ids whose count BOTH sides changed: ${sc.ambiguous.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    writeFileSync(pA, failBlock(markerSize, `GAP-ID SELF-CHECK FAILED — ${why}`) + plainOr());
    console.error(`${tag}: GAP-ID SELF-CHECK FAILED — ${why}. The merge would have lost or double-filed a ledger entry; refusing it.`);
    return done(1);
  }
  const bits = [
    r.unioned ? `unioned ${r.unioned} same-spot gap-entry addition(s) (ours first)` : "",
    r.regenerated.length ? `regenerated ${r.regenerated.join(", ")}` : "",
    r.provisional.length ? `provisional ${r.provisional.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  if (r.conflicts > 0) {
    writeFileSync(pA, r.text);
    if (r.pending) addPending(path);
    console.error(`${tag}: ${r.conflicts} conflict(s) in HAND-WRITTEN text — resolve them, then \`bun scripts/git-merge-generated.ts --regen\`.${bits ? " " + bits : ""}`);
    return done(1);
  }
  if (r.needsRegen.length > 0) {
    writeFileSync(pA, regenBlock(markerSize, r.needsRegen) + r.text);
    addPending(path);
    console.error(`${tag}: both sides changed derived content (${r.needsRegen.join(", ")}) — left CONFLICTED; run \`bun scripts/git-merge-generated.ts --regen\` to derive it from the merged tree.${bits ? " " + bits : ""}`);
    return done(1);
  }
  writeFileSync(pA, r.text);
  if (r.pending) addPending(path);
  console.error(`${tag}: generated-content conflicts resolved, 0 markers.${bits ? " " + bits : ""}`);
  return done(0);
}

// ─── phase 2 ────────────────────────────────────────────────────────────────────────────────────

function runRegen(all: boolean): number {
  const root = git(["rev-parse", "--show-toplevel"]).out;
  if (!root) { console.error("--regen: not inside a git work tree"); return 2; }
  const inProgress = operationInProgress(root);
  // Unmerged paths are allowed only when every one is a file the DRIVER stopped for regeneration
  // (it starts with the regen block and holds no other marker). Anything else is a real conflict
  // the producers must not read through.
  const unmerged = [...new Set(git(["ls-files", "-u"], root).out.split("\n").filter(Boolean).map((l) => l.split("\t")[1]))];
  const blocked = new Map<string, string>();
  const others: string[] = [];
  for (const p of unmerged) {
    const f = join(root, p);
    const stripped = existsSync(f) ? stripRegenBlock(readFileSync(f, "utf8")) : null;
    if (stripped === null) others.push(p); else blocked.set(p, stripped);
  }
  if (others.length) {
    console.error(`--regen: unmerged paths remain that are not regeneration stops — resolve and \`git add\` them first (producers must read the MERGED tree):\n  ${others.join("\n  ")}`);
    return 1;
  }
  const pending = all ? PRODUCERS.map((p) => p.path) : [...new Set([...readPending(root), ...blocked.keys()])];
  if (pending.length === 0) { console.log("--regen: nothing pending."); return 0; }
  for (const [p, text] of blocked) writeFileSync(join(root, p), text);
  const remaining = new Set(pending);
  const ran = new Map<string, boolean>();
  let failed = 0;
  for (const p of PRODUCERS) {
    if (!pending.includes(p.path)) continue;
    if (p.historyDerived && inProgress) {
      console.log(`--regen: DEFERRED ${p.path} — its producer reads git history, which does not include the other side until the merge/rebase is COMMITTED. Re-run --regen after committing.`);
      continue;
    }
    const key = p.cmd.join(" ");
    if (!ran.has(key)) {
      console.log(`--regen: ${key}${p.slow ? "   (slow — runs the bootstrap over the conformance corpus)" : ""}`);
      const r = spawnSync(p.cmd[0], p.cmd.slice(1), { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
      ran.set(key, r.status === 0);
      if (r.status !== 0) console.error(`--regen: FAILED (${r.status}): ${key}`);
    }
    if (!ran.get(key)) { failed++; continue; }
    remaining.delete(p.path);
  }
  for (const p of pending) if (!PRODUCERS.some((q) => q.path === p)) remaining.delete(p);
  // A regeneration stop is staged only once its producer succeeded; otherwise the block goes back.
  for (const [p, text] of blocked) {
    if (remaining.has(p)) {
      writeFileSync(join(root, p), regenBlock(7, ["(regeneration failed — see above)"]) + text);
    } else {
      git(["add", "--", p], root);
      console.log(`--regen: staged ${p} (regenerated from the merged tree)`);
    }
  }
  const rec = readRecord(root);
  writeRecord({ key: rec.key || currentKey(root), paths: [...remaining] }, root);
  const changed = git(["status", "--short", "--", ...pending], root).out;
  if (changed) console.log(`--regen: status of regenerated paths — COMMIT them:\n${changed}`);
  else console.log("--regen: generated content already current.");
  if (remaining.size) console.log(`--regen: still pending: ${[...remaining].join(", ")}`);
  return failed ? 1 : 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--regen") process.exit(runRegen(argv.includes("--all")));
  else if (argv[0] === "--pending") { for (const p of readPending()) console.log(p); process.exit(0); }
  else if (argv.length >= 3) process.exit(runDriver(argv));
  else {
    console.error("usage: git-merge-generated.ts %O %A %B %P [%L %S %X %Y]  |  --regen [--all]  |  --pending");
    process.exit(2);
  }
}
