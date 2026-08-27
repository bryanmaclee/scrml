#!/usr/bin/env bun
/**
 * corpus-zero-debt.ts — the ENFORCEMENT SURFACE the sliding-doors audit produced (S348).
 *
 * WHY THIS EXISTS. The corpus-zero audit (`scrml-support/docs/audits/sliding-doors-corpus-zero-
 * 2026-08-16/`) set out to find decisions made on "no corpus evidence", and its ⭐⭐ STRUCTURAL
 * FINDING reframed the whole arc: **the rule against this reasoning already existed, and it DECAYED.**
 *
 *   - ~S66 Rule 2 was ratified by name: *"PA must not invoke … 'corpus shows zero so drop it' as
 *     load-bearing reasoning."* (`user-voice-scrml.md:5435`)
 *   - S86 sharpened it: corpus state is *"artifact, NOT evidence of design intent … acceptable as
 *     DATA (descriptive) but not as REASONING (normative)."* (`:6376`)
 *   - S144 APPLIED it — it voided a real decision (the s64 tier-rung, `:9056`).
 *   - S170 · S178 · S230 — then it STOPPED being applied. `set`, js-host Fork 2, D1 all post-date the
 *     rule and all used corpus-zero as load-bearing. S346 the operator re-derived it from scratch.
 *
 * The user-voice slice localized the decay precisely: every positive control was **bryan in the live
 * loop** (`:6599`/`:9175`/`:9832`/`:10086`/`:9899` — he caught it in person each time). The rule
 * decayed in the **autonomous deep-dives / dispatch work outside his view**, where 264/257/290 were
 * ruled. So the deliverable is NOT "adopt a principle" — that principle is in `pa-scrml-overlay.md:521`,
 * `pa-core-scrml.md:97`, and pa-base's corpus-is-artifact kernel already. The failure was not the rule
 * but its APPLICATION, and the fix is the shape this project has a track record with:
 *
 *   an obligation recorded in one place while nothing reads it at the moment of decision (pa-base §10,
 *   named four times — adopter issues, the review floor, the dPA drain, an AST-vs-string trigger).
 *   Here it is a REASONING rule instead of a channel: Rule 2 lives in a boot-read contract, and the
 *   decisions that violated it were authored hours later inside deep-dives that never re-read it.
 *
 * So this reads a deliberation artifact and flags a corpus-zero justification **at authoring time**,
 * the way review-debt.ts reads merged PRs and issue-debt.ts reads open issues.
 *
 * WHAT IT READS, AND WHY THAT SURFACE. `scrml-support/docs/deep-dives/` + `docs/debates/` — the exact
 * autonomous-deliberation surface the audit's user-voice finding named as where the rule decayed.
 * (The boot-read contracts are deliberately NOT scanned: bryan enforces there in person; scanning them
 * would fire on the doctrine files where the RULE ITSELF is stated — the charter's Guard 5, "no corpus
 * citation inside the audit's own reasoning", applied to the probe.)
 *
 * THE grep-CANNOT-CLASSIFY PROBLEM, AND ITS RESOLUTION. The charter is explicit: corpus-zero has a
 * LEGITIMATE use (blast-radius: "how many files break if I change this") and a FORBIDDEN one
 * (load-bearing: "nobody needs this → don't build"), and *"grep cannot classify this"* — the site must
 * be read in context. A pure phrase-classifier would therefore reproduce BOTH failures the audit
 * already measured: the dpa-025 vocabulary hole (false negatives — the bare-zero shape Guard 1 found)
 * AND a high false-positive rate over legitimate blast-radius uses (the §2 cry-wolf shape that gets
 * bypassed and deleted). So this probe does NOT classify. It DETECTS candidates and asks the AUTHOR to
 * dispose each once — review-debt's exact split: the probe finds owed PRs; the reviewer runs the pass
 * and records the verdict. grep can't classify, but the author (human or agent) can, at authoring time,
 * and records it in a marker the probe then parses.
 *
 * THE MARKER (machine-readable, parsed — never prose-grepped; the §2 v2.9 lesson). Placed on/near a
 * corpus-zero justification in a deliberation artifact:
 *
 *   <!-- @corpus-zero role=blast-radius|data|load-bearing disposition=overruled by=S348-peter date=2026-08-16 note=... -->
 *
 * role (following S86 verbatim — DATA is acceptable, REASONING is not):
 *   blast-radius  — the legitimate "how many existing files break" measurement. CLOSED.
 *   data          — cited descriptively, NOT decisive. CLOSED (S86: "acceptable as DATA").
 *   load-bearing  — corpus-zero was DECISIVE. Then `disposition` must justify it:
 *       disposition=overruled — acknowledged and then OVERRULED (the S347 `protect-egress` positive
 *                               template: *"guarded even though no corpus source reaches it today …
 *                               anticipated, not hypothetical"*). CLOSED — this is the reasoning the
 *                               audit exists to PROMOTE, and it is counted and surfaced so the floor
 *                               is not decorative.
 *       (anything else)       — load-bearing and NOT overruled == the Rule-2 violation. The health
 *                               signal; target ~0%.
 *
 * An in-epoch corpus-zero hit with NO marker is OWED — the author has not disposed of it.
 *
 * EPOCH. `CORPUS_ZERO_EPOCH = 2026-08-16` (the audit date). Retroactively marking 280 historical
 * deep-dives is the charter's Guard 2 "rebuild everything" trap — and the audit's own `nodes/
 * classified-*.md` IS that retroactive pass. So this binds only artifacts AUTHORED at/after the epoch;
 * history before it is out of scope BY CONSTRUCTION, never by exemption — the review-debt epoch pattern
 * exactly, so the probe is never red for work predating the rule. Authoring date is read from the
 * filename (`…-YYYY-MM-DD.md`) if present, else frontmatter `last-reviewed`. Deterministic; no
 * wall-clock (the state.ts / issue-debt discipline: a probe whose output moves on its own is not a gate).
 *
 * GUARD 1 (dpa-025 / §8 truncated probe). The vocabulary is a HAND-MAINTAINED list and WILL miss
 * shapes — the audit proved it (a bare-zero source measurement with no "corpus" token was invisible to
 * all 15 phrases). So every run states `N of M` (files scanned, hits found) and the vocabulary is
 * documented as extensible, not authoritative. A companion completeness probe against random non-hit
 * artifacts remains the audit's standing discipline; this file does not pretend to close it.
 *
 * DETECTION, NOT CONTROL (pa-base §8). Never gates a merge, never in CI — a red-over-backlog gate is
 * the cry-wolf shape that gets bypassed and then deleted. It runs at BOOT and reports; `--check` exits
 * non-zero for a human/hook, not for CI.
 *
 * Usage:
 *   bun scripts/corpus-zero-debt.ts            # report (boot step)
 *   bun scripts/corpus-zero-debt.ts --check    # exit 1 if any owed OR any load-bearing violation
 *   bun scripts/corpus-zero-debt.ts --all      # ignore the epoch (audit/backfill view — states so)
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const SUPPORT = `${ROOT}/../scrml-support`;

/** The audit date. Artifacts authored before it are the audit's retroactive population. */
export const CORPUS_ZERO_EPOCH = "2026-08-16";

/** The autonomous-deliberation surface where the user-voice finding located the rule's decay. */
export const SCAN_ROOTS = ["docs/deep-dives", "docs/debates"];

/**
 * The corpus-zero vocabulary — the charter's 15 phrases, plus the load-bearing-flavored extensions
 * the Guard-1 completeness probe supported (it did NOT support the bare-zero patterns, which are
 * blast-radius-dominant and spec/diagnostic-heavy — excluded on purpose).
 *
 * ⚠ HAND-MAINTAINED (dpa-025 class). This WILL miss shapes. It is a candidate detector, not an oracle;
 * the marker + the author's read-in-context is what actually classifies. Extend it as new shapes are
 * found, and keep the completeness probe running — do not treat a clean scan as proof of a clean corpus.
 */
export const VOCAB: string[] = [
  "corpus shows zero", "zero corpus", "no corpus", "corpus is empty", "sliver-empty",
  "witnessed need", "yagni", "measured zero", "migration measured", "no adopter",
  "no real consumer", "corpus demand", "corpus: 0", "no consumer", "nothing in the corpus",
  // Guard-1-supported extensions (load-bearing-flavored, not bare-zero):
  "no demand", "not witnessed", "never witnessed", "nobody has asked", "no witnessed",
];

const VOCAB_RE = new RegExp(
  "\\b(" + VOCAB.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "i",
);

/** The matched phrase on a line, or null. Case-insensitive; word-boundaried to avoid `yagni` in prose. */
export function matchVocab(line: string): string | null {
  const m = line.match(VOCAB_RE);
  return m ? m[1].toLowerCase() : null;
}

export interface Marker {
  role: string;         // blast-radius | data | load-bearing | (unknown)
  disposition?: string; // overruled | (unset)
  by?: string;
  raw: string;
}

/**
 * Parse `@corpus-zero` markers from an artifact. The MARKER, never the prose — an entry not in this
 * shape is not an entry (the review-debt / state.ts discipline). Returns every marker in the file.
 */
export function parseMarkers(text: string): Marker[] {
  const out: Marker[] = [];
  // S378: `[^\n]*?` not `[^>]*?` — same class as the S378 review-floor defect.
  const re = /<!--\s*@corpus-zero\s+([^\n]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const bag: Record<string, string> = {};
    for (const kv of m[1].trim().split(/\s+/)) {
      const i = kv.indexOf("=");
      if (i > 0) bag[kv.slice(0, i)] = kv.slice(i + 1);
    }
    // ⛑ S378 round 2 (adversarial finding 4). Skip a doc s own FORMAT EXAMPLE. This module s
    // header documents the marker shape, and `markerCloses()` returns true on `role=blast-radius`
    // ALONE — while `owed` is `hits > 0 && closed === 0 && violations === 0`. So one pasted
    // example containing a `<who>` placeholder (now matchable post-widening) would silently
    // discharge that artifact s ENTIRE corpus-zero debt. Failure direction is toward CLEAN,
    // which is the one that loses obligations rather than inventing them.
    if (Object.values(bag).some(v => v.startsWith("<"))) continue;
    out.push({ role: (bag.role ?? "unknown").toLowerCase(), disposition: bag.disposition?.toLowerCase(), by: bag.by, raw: m[0] });
  }
  return out;
}

/** A marker that CLOSES a corpus-zero hit (legitimate, or acknowledged-and-overruled). */
export function markerCloses(mk: Marker): boolean {
  if (mk.role === "blast-radius" || mk.role === "data") return true;
  if (mk.role === "load-bearing" && mk.disposition === "overruled") return true;
  return false;
}

/** A marker that is a Rule-2 VIOLATION (load-bearing and not overruled) — the health signal. */
export function markerViolates(mk: Marker): boolean {
  return mk.role === "load-bearing" && mk.disposition !== "overruled";
}

const FILE_DATE_RE = /(\d{4}-\d{2}-\d{2})(?=\.[^.]+$|$)/;
const FM_DATE_RE = /^last-reviewed:\s*(\d{4}-\d{2}-\d{2})/m;

/**
 * The artifact's authoring date, as an ISO `YYYY-MM-DD` string, or null if undated. Filename date wins
 * (it is the authoring stamp on this corpus's convention, `…-2026-06-30.md`); frontmatter
 * `last-reviewed` is the fallback. Pure — no clock.
 */
export function artifactDate(pathOrName: string, text: string): string | null {
  const base = pathOrName.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? pathOrName;
  const f = base.match(FILE_DATE_RE);
  if (f) return f[1];
  const fm = text.match(FM_DATE_RE);
  return fm ? fm[1] : null;
}

export interface Artifact { path: string; text: string; }
export interface ArtifactResult {
  path: string;
  date: string | null;
  inEpoch: boolean;      // authored at/after the epoch (or --all)
  hitLines: number[];    // 1-indexed lines carrying a corpus-zero phrase
  closed: number;        // markers that dispose a hit (legitimate or overruled)
  overruled: number;     // the positive-template count (promote this)
  violations: number;    // load-bearing, not overruled
  owed: boolean;         // in-epoch, has hits, and hits are not covered by closing markers
}

/**
 * Classify one artifact. Pure over (path, text, epoch). A file with corpus-zero hits and no closing
 * marker is OWED; markers are counted for the health signal.
 *
 * The hit-vs-marker accounting is deliberately COARSE (per-file, not per-line): a deliberation artifact
 * that raises corpus-zero and carries at least one closing marker is treated as disposed, because these
 * documents argue a decision as a whole, not line-by-line. A load-bearing VIOLATION marker overrides —
 * a file that explicitly self-reports a Rule-2 violation is never silently "closed" by a sibling marker.
 */
export function classifyArtifact(path: string, text: string, epoch: string, all = false): ArtifactResult {
  const date = artifactDate(path, text);
  // Undated in-scope files are treated as in-epoch (fail-toward-visible): an undated deliberation
  // artifact is more likely new-and-unstamped than pre-epoch, and the alternative hides it forever.
  const inEpoch = all || date === null || date >= epoch;

  const lines = text.split("\n");
  const hitLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // A line that IS a marker is not itself a hit (it would match `load-bearing`/`corpus`).
    if (/@corpus-zero\b/.test(lines[i])) continue;
    if (matchVocab(lines[i])) hitLines.push(i + 1);
  }

  const markers = parseMarkers(text);
  const closed = markers.filter(markerCloses).length;
  const overruled = markers.filter((m) => m.role === "load-bearing" && m.disposition === "overruled").length;
  const violations = markers.filter(markerViolates).length;

  const owed = inEpoch && hitLines.length > 0 && closed === 0 && violations === 0;
  return { path, date, inEpoch, hitLines, closed, overruled, violations, owed };
}

export interface Summary {
  scanned: number;       // M — files read
  withHits: number;      // files carrying at least one corpus-zero phrase
  inScope: number;       // in-epoch files with hits
  owed: ArtifactResult[];
  violations: ArtifactResult[];
  overruled: number;     // total positive-template markers across the corpus
}

/** Aggregate. Pure over the artifact list + epoch. */
export function classify(artifacts: Artifact[], epoch: string, all = false): Summary {
  const results = artifacts.map((a) => classifyArtifact(a.path, a.text, epoch, all));
  const withHits = results.filter((r) => r.hitLines.length > 0);
  return {
    scanned: artifacts.length,
    withHits: withHits.length,
    inScope: withHits.filter((r) => r.inEpoch).length,
    owed: results.filter((r) => r.owed).sort((a, b) => a.path.localeCompare(b.path)),
    violations: results.filter((r) => r.violations > 0).sort((a, b) => a.path.localeCompare(b.path)),
    overruled: results.reduce((n, r) => n + r.overruled, 0),
  };
}

// ── fs glue (kept out of the pure core so the test needs no disk) ─────────────────

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  // SORTED — deterministic enumeration (the S345 order-dependency lesson; readdir order is not stable
  // cross-OS and a probe whose output reorders on its own reads as a change nothing caused).
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = `${dir}/${name.name}`;
    if (name.isDirectory()) out.push(...walk(full));
    else if (name.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function loadArtifacts(): Artifact[] {
  const out: Artifact[] = [];
  for (const root of SCAN_ROOTS) {
    for (const full of walk(`${SUPPORT}/${root}`)) {
      // Report the repo-relative path, not the absolute one.
      const rel = full.slice(SUPPORT.length + 1);
      out.push({ path: rel, text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

// Skip the fs/console when imported by the test (Bun sets import.meta.main only for the entrypoint).
if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2));
  const all = args.has("--all");

  const artifacts = loadArtifacts();
  const s = classify(artifacts, CORPUS_ZERO_EPOCH, all);

  const scope = all ? "ALL (epoch ignored — backfill view)" : `authored ≥ ${CORPUS_ZERO_EPOCH}`;
  // Guard 1: state N of M on every run.
  console.log(
    `corpus-zero-debt — ${s.scanned} artifacts scanned · ${s.withHits} carry a corpus-zero phrase · ` +
    `${s.inScope} in scope (${scope}) · ${s.owed.length} OWED · ${s.violations.length} VIOLATION` +
    (s.overruled ? ` · ${s.overruled} overruled ✓` : ""),
  );
  console.log(`  vocabulary: ${VOCAB.length} phrases (hand-maintained, dpa-025 class — a clean scan is NOT proof of a clean corpus).`);

  if (s.violations.length) {
    console.log(`\n  ⛔ RULE-2 VIOLATION — load-bearing corpus-zero, self-reported not-overruled:`);
    for (const r of s.violations) console.log(`     ${r.path}  (${r.violations})`);
  }

  if (s.owed.length) {
    console.log(`\n  ⚠️ OWED — corpus-zero raised in an in-epoch deliberation artifact, no @corpus-zero marker:`);
    for (const r of s.owed) {
      const where = r.hitLines.slice(0, 4).join(",") + (r.hitLines.length > 4 ? "…" : "");
      console.log(`     ${r.path}  L${where}${r.date ? "" : "  (undated → treated in-epoch)"}`);
    }
    console.log(`\n  Read each hit IN CONTEXT (grep cannot classify it) and mark it:`);
    console.log(`  <!-- @corpus-zero role=blast-radius|data|load-bearing disposition=overruled by=S<N>-<who> date=<ISO> note=<what> -->`);
  }

  // NOT-VERIFIED IS A DISTINCT STATE FROM ZERO DEBT (S364).
  //
  // Scanning zero artifacts previously produced the identical "✅ no corpus-zero debt" a genuinely
  // clean corpus produces. That is not hypothetical: `SUPPORT` is `<repo>/../scrml-support`, which
  // does NOT resolve from a git worktree under `.claude/worktrees/<agent>/` — so every dispatched
  // agent, and the boot probe in scripts/boot.ts:311, read a green tick over 322 unscanned
  // deliberation artifacts (295 deep-dives + 27 debates — BOTH entries of SCAN_ROOTS; the figure
  // first written here said "288 deep-dives", which was stale AND counted only one of the two
  // roots). A probe read as evidence must never report a clean bill of health for a scan that
  // did not happen.
  //
  // EXIT SHAPE follows this repo's own established boot-probe pattern (review-debt.ts /
  // issue-debt.ts): report loudly, do NOT break the boot in report mode — "a probe that breaks the
  // boot is a probe that gets removed" — but a `--check` that verified nothing is not a pass.
  // PER-ROOT, NOT ALL-OR-NOTHING (S365 review). The guard above was written as
  // `artifacts.length === 0`, which only fires when EVERY root is dead. SCAN_ROOTS has two, and
  // they are wildly unequal — 295 deep-dives to 27 debates — so ONE renamed or moved directory
  // left ~92% coverage printing the clean tick with no hint that the rest was never opened.
  // Measured on a constructed tree: 4 artifacts across both roots → `✅ no corpus-zero debt`,
  // exit 0; `docs/debates` renamed → `✅ no corpus-zero debt — all 2 …`, STILL exit 0 under
  // `--check`. Half the corpus vanished and the denominator merely got quieter.
  //
  // PARTIAL blindness is the harder case to notice precisely because the number still looks
  // healthy — a zero is at least conspicuous. So every root reports its own count, and a root
  // that yields nothing is named whether or not its siblings did.
  const perRoot = SCAN_ROOTS.map((root) => ({
    root,
    path: `${SUPPORT}/${root}`,
    n: artifacts.filter((a) => a.path === root || a.path.startsWith(`${root}/`)).length,
  }));
  const dead = perRoot.filter((r) => r.n === 0);

  if (dead.length) {
    if (artifacts.length === 0) {
      console.log(`\n  ⚠️ NOT VERIFIED — scanned ZERO artifacts, so this run proves NOTHING.`);
      console.log(`     A zero scan and a clean corpus print the same tick; they are not the same fact.`);
    } else {
      console.log(`\n  ⚠️ PARTIALLY VERIFIED — ${dead.length} of ${SCAN_ROOTS.length} scan roots yielded ZERO artifacts.`);
      console.log(`     ${artifacts.length} artifact(s) WERE scanned, so any tick above covers part of the corpus`);
      console.log(`     and none of the rest. A partial scan and a clean corpus print the same tick.`);
    }
    for (const r of perRoot) {
      const state = r.n > 0 ? `${String(r.n).padStart(5)} scanned`
        : existsSync(r.path) ? `    0 EMPTY  `
        : `   UNRESOLVED`;
      console.log(`     ${state}  ${r.path}`);
    }
    console.log(`     Most likely cause: running from a git worktree, where \`../scrml-support\` does not`);
    console.log(`     resolve to the sibling repo — or a scan root renamed out from under SCAN_ROOTS.`);
    console.log(`     Corpus-zero debt NOT verified — say so in the boot report.`);
    if (args.has("--check")) process.exit(1);
  } else if (!s.owed.length && !s.violations.length) {
    console.log(`  ✅ no corpus-zero debt — all ${artifacts.length} in-epoch deliberation artifact(s) disposed`);
    console.log(`     across all ${SCAN_ROOTS.length} scan roots (${perRoot.map((r) => `${r.root} ${r.n}`).join(" · ")}).`);
  }

  if (args.has("--check") && (s.owed.length > 0 || s.violations.length > 0)) process.exit(1);
}
