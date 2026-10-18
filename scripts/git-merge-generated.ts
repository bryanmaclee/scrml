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
//     2. `git merge-file` the masked versions. Any conflict left is in HAND-WRITTEN text → the file is
//        written with markers and the driver exits 1: a human/agent 3-way is still owed for that.
//     3. Fill each generated region back in:
//          SELF-CONTAINED sections (derived only from the file's own text — today `gap-counts`, from
//          the `@gap` markers of the same file) are REGENERATED EXACTLY from the merged text, by the
//          producer's own exported function (state.ts `gapCountsSection`). ORDER MATTERS: this runs
//          after step 2, so every entry from both sides is already in the text being counted.
//          A clean textual merge is NOT trusted here: two PRs that each add one HIGH both move
//          `HIGH 264` to `265`; git sees an identical change on both sides and keeps ONE — a count
//          that is wrong with no conflict to warn anyone. Hence ALWAYS regenerate.
//          CROSS-FILE sections / rows / wholly-generated files cannot be derived here (see above).
//          They get a PROVISIONAL value by a section-level 3-way (a side that did not change it
//          yields to the side that did; a true two-sided change keeps ours), and the path is
//          recorded as PENDING regeneration. They never produce conflict markers.
//     4. SELF-CHECK — the gap-id union invariant: every `@gap` id present on either side survives
//        unless one side deliberately deleted it; no id appears more often than it did on either
//        side. A violation FAILS the merge loudly (exit 1, a marker block at the top of the file).
//
//   PHASE 2 — `bun scripts/git-merge-generated.ts --regen`, AFTER the merge is complete (the working
//     tree now holds the merged result of every path): runs each pending path's producer `--write`
//     over the merged tree and clears the pending record. The `post-merge` and `post-rewrite` hooks
//     in scripts/git-hooks/ run it automatically when a pending record exists; after a merge that
//     stopped on a hand-written conflict, run it yourself after committing. The CI / pre-push
//     currency gates (`facts.ts --check`, `regen-spec-index.ts --check`, `bootstrap-conformance.ts
//     --check`) are the backstop if it is skipped: a provisional value is never silently final.
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
//   ./scripts/git-hooks/install.sh   — sets `merge.scrml-generated.driver` (see that script), and
//   mirrors the attribute lines into the clone's info/attributes: a merge reads .gitattributes from
//   OURS' working tree, so a branch cut before the lines landed would otherwise never use the driver.
//   .gitattributes maps the five files above to `merge=scrml-generated`. Without the config, git
//   ignores the attribute and falls back to its normal text merge (conflicts as before — never worse).
//   ⚑ GitHub's server-side merge NEVER runs custom drivers: a PR shows `dirty` on GitHub until its
//   branch is updated locally (`git merge origin/main` with the driver installed) and pushed.
//
// MODES:
//   bun scripts/git-merge-generated.ts %O %A %B %P [%L %S %X %Y]   the driver (git invokes it)
//   bun scripts/git-merge-generated.ts --regen [--all]               phase 2 (pending paths, or all)
//   bun scripts/git-merge-generated.ts --pending                     print the pending record
//
// Exit codes (driver): 0 = merged clean (pending regen recorded if any); 1 = conflict left in
// hand-written text, OR the self-check failed, OR an internal error (file holds a plain 3-way merge
// with a loud marker block). Dependency-free (Bun built-ins + scripts/state.ts).

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
  if (a === undefined) return b ?? o ?? "";
  if (b === undefined) return a;
  if (a === b) return a;
  if (a === o) return b;
  if (b === o) return a;
  return a; // a true two-sided change: provisional ours; phase 2 regenerates it from the merged tree
}

// ─── gap-id union invariant ─────────────────────────────────────────────────────────────────────

/** Multiset of real `@gap` ids (the doc's own `id=<placeholder>` format examples excluded). */
export function gapIdCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(/<!--\s*@gap\s+([\s\S]*?)\s*-->/g)) {
    for (const pair of m[1].trim().split(/\s+/)) {
      if (!pair.startsWith("id=")) continue;
      const id = pair.slice(3);
      if (id && !id.startsWith("<")) out.set(id, (out.get(id) ?? 0) + 1);
      break;
    }
  }
  return out;
}

/**
 * Every id present on either side must survive, UNLESS a side deliberately deleted it (present at
 * base, absent on that side) — a deletion is a legitimate 3-way outcome, not a drop. And no id may
 * appear more often than on either side (a union-style resolve that DUPLICATES an entry
 * double-files it and makes state.ts throw on the next count).
 * ⚑ The brief stated the invariant as `ids(ours) ∪ ids(theirs) ⊆ ids(result)`. Taken literally that
 * FALSE-FAILS every merge in which one side deletes an entry the other left alone; the deletion
 * carve-out above is the narrowest form that still catches every drop the merge itself caused.
 */
export function gapIdSelfCheck(o: string, a: string, b: string, result: string): { dropped: string[]; duplicated: string[] } {
  const O = gapIdCounts(o), A = gapIdCounts(a), B = gapIdCounts(b), R = gapIdCounts(result);
  const dropped: string[] = [];
  const duplicated: string[] = [];
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const deletedBySide = O.has(id) && (!A.has(id) || !B.has(id));
    if (!deletedBySide && !R.has(id)) dropped.push(id);
  }
  for (const [id, n] of R) {
    if (n > Math.max(A.get(id) ?? 0, B.get(id) ?? 0)) duplicated.push(id);
  }
  return { dropped: dropped.sort(), duplicated: duplicated.sort() };
}

// ─── the merge ──────────────────────────────────────────────────────────────────────────────────

export type MergeResult = {
  text: string;
  conflicts: number;           // conflicts left in HAND-WRITTEN text (0 = clean)
  pending: boolean;            // cross-file generated content holds a PROVISIONAL value
  regenerated: string[];       // self-contained sections regenerated exactly
  provisional: string[];       // cross-file sections / rows / whole file given a provisional value
  selfCheck: { dropped: string[]; duplicated: string[] };
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
    const text = pick3(mo.values.get("whole#0"), ma.values.get("whole#0"), mb.values.get("whole#0"));
    provisional.push("(whole file)");
    return { text, conflicts: 0, pending: true, regenerated, provisional, selfCheck: gapIdSelfCheck(o, a, b, text) };
  }

  // Step 2 — hand text only.
  const merged = gitMergeFile(mo.text, ma.text, mb.text, markerSize, labels);

  // Step 3 — fill. Self-contained sections derive from the merged HAND text (every entry of both
  // sides is in it by now); the generated bodies hold no @gap markers, so the masked text counts the same.
  const selfCache = new Map<string, string>();
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
    return pick3(mo.values.get(key), ma.values.get(key), mb.values.get(key));
  });
  if (path.replace(/\\/g, "/").endsWith(SPEC_INDEX_PATH)) {
    text = mapSpecIndexRows(text, MASKED_ROW_RE, (key) => {
      if (!provisional.includes("spec-index-rows")) provisional.push("spec-index-rows");
      return pick3(mo.values.get(key), ma.values.get(key), mb.values.get(key)) || "— | —";
    });
  }
  const pending = provisional.length > 0;
  const selfCheck = merged.conflicts === 0 ? gapIdSelfCheck(o, a, b, text) : { dropped: [], duplicated: [] };
  return { text, conflicts: merged.conflicts, pending, regenerated, provisional, selfCheck };
}

// ─── pending record (per worktree: `git rev-parse --git-path` resolves to the worktree's own dir) ─

function git(args: string[], cwd?: string): { out: string; ok: boolean } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
}

function pendingFile(cwd?: string): string {
  return git(["rev-parse", "--path-format=absolute", "--git-path", "scrml-generated-pending"], cwd).out;
}

export function readPending(cwd?: string): string[] {
  const f = pendingFile(cwd);
  if (!f || !existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
}

function writePending(paths: string[], cwd?: string): void {
  const f = pendingFile(cwd);
  if (!f) return;
  const uniq = [...new Set(paths)].sort();
  if (uniq.length === 0) { rmSync(f, { force: true }); return; }
  writeFileSync(f, uniq.join("\n") + "\n");
}

// ─── driver entry ───────────────────────────────────────────────────────────────────────────────

const MARK = (c: string, n: number) => c.repeat(n);

function failBlock(n: number, why: string): string {
  // A real marker block, so `conflict-marker-gate.ts` and every editor see it as unresolved.
  return `${MARK("<", n)} scrml-generated-merge: ${why}\n` +
    `This merge was STOPPED by scripts/git-merge-generated.ts. Below is git's plain 3-way merge.\n` +
    `${MARK("=", n)}\n` +
    `${MARK(">", n)} resolve by hand, then delete this block\n`;
}

function label(s: string | undefined, dflt: string): string {
  return !s || s.startsWith("%") ? dflt : s;
}

function runDriver(argv: string[]): number {
  const [pO, pA, pB, pathArg, markerArg, sArg, xArg, yArg] = argv;
  const path = pathArg ?? pA;
  const markerSize = Number(markerArg) > 0 ? Number(markerArg) : 7;
  const labels: Labels = { ours: label(xArg, "ours"), base: label(sArg, "base"), theirs: label(yArg, "theirs") };
  const o = readFileSync(pO, "utf8"), a = readFileSync(pA, "utf8"), b = readFileSync(pB, "utf8");
  const tag = `scrml-generated-merge [${path}]`;
  let r: MergeResult;
  try {
    r = mergeGenerated(o, a, b, path, markerSize, labels);
  } catch (e) {
    // Never leave %A as an unmarked copy of ours: git would show it conflicted while the file reads clean.
    let plain = "";
    try { plain = gitMergeFile(o, a, b, markerSize, labels).text; } catch { plain = a; }
    writeFileSync(pA, failBlock(markerSize, `INTERNAL ERROR: ${String((e as Error)?.message ?? e).split("\n")[0]}`) + plain);
    console.error(`${tag}: INTERNAL ERROR — fell back to git's plain 3-way merge; resolve by hand.\n${(e as Error)?.stack ?? e}`);
    return 1;
  }
  if (r.selfCheck.dropped.length || r.selfCheck.duplicated.length) {
    const why = [
      r.selfCheck.dropped.length ? `gap ids DROPPED: ${r.selfCheck.dropped.join(", ")}` : "",
      r.selfCheck.duplicated.length ? `gap ids DUPLICATED: ${r.selfCheck.duplicated.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    let plain = "";
    try { plain = gitMergeFile(o, a, b, markerSize, labels).text; } catch { plain = a; }
    writeFileSync(pA, failBlock(markerSize, `GAP-ID SELF-CHECK FAILED — ${why}`) + plain);
    console.error(`${tag}: GAP-ID SELF-CHECK FAILED — ${why}. The merge would have lost or double-filed a ledger entry; refusing it.`);
    return 1;
  }
  writeFileSync(pA, r.text);
  if (r.pending) writePending([...readPending(), path.replace(/\\/g, "/")]);
  const bits = [
    r.regenerated.length ? `regenerated ${r.regenerated.join(", ")}` : "",
    r.provisional.length ? `provisional ${r.provisional.join(", ")} (PENDING — after the merge completes: bun scripts/git-merge-generated.ts --regen)` : "",
  ].filter(Boolean).join("; ");
  if (r.conflicts > 0) {
    console.error(`${tag}: ${r.conflicts} conflict(s) in HAND-WRITTEN text — resolve them; generated content was not the cause.${bits ? " " + bits : ""}`);
    return 1;
  }
  console.error(`${tag}: generated-content conflicts resolved, 0 markers.${bits ? " " + bits : ""}`);
  return 0;
}

// ─── phase 2 ────────────────────────────────────────────────────────────────────────────────────

function runRegen(all: boolean): number {
  const root = git(["rev-parse", "--show-toplevel"]).out;
  if (!root) { console.error("--regen: not inside a git work tree"); return 2; }
  const unmerged = git(["ls-files", "-u"], root).out;
  if (unmerged) {
    console.error("--regen: unmerged paths remain — resolve the merge first (producers must read the MERGED tree).");
    return 1;
  }
  const inProgress = ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD"].some((h) => git(["rev-parse", "-q", "--verify", h], root).ok);
  const pending = all ? PRODUCERS.map((p) => p.path) : readPending(root);
  if (pending.length === 0) { console.log("--regen: nothing pending."); return 0; }
  const remaining = new Set(pending);
  const ran = new Set<string>();
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
      ran.add(key);
      if (r.status !== 0) { console.error(`--regen: FAILED (${r.status}): ${key}`); failed++; continue; }
    }
    remaining.delete(p.path);
  }
  for (const p of pending) if (!PRODUCERS.some((q) => q.path === p)) remaining.delete(p);
  writePending([...remaining], root);
  const changed = git(["status", "--short", "--", ...pending], root).out;
  if (changed) console.log(`--regen: regenerated — COMMIT these:\n${changed}`);
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
