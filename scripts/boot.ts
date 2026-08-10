#!/usr/bin/env bun
/**
 * scripts/boot.ts — the boot read-set gate + PICKUP-led digest.
 *
 * WHY THIS EXISTS (S335 → S336, Peter). The wrap→boot seam had no executable
 * floor. S335 short-booted — skipped BOTH user-voice ledgers + the per-user
 * profile — and led orientation with a fresh option-menu instead of the agreed
 * left-off pickup. Peter caught it, verbatim: "we need the workflow from session
 * to session to be as seamless as possible. Leaving room for misdirection is not
 * okay." A memory NAVIGATES (reminds); it does not GATE — so it "leaves room for
 * misdirection." The remedy is an executable check the boot always runs.
 *
 * WHAT IT DOES. One command the /boot skill runs. It:
 *   1. FETCHES both repos (read-only; never pulls/mutates) and reports behind/ahead/dirty.
 *   2. VERIFIES every Profile-A read-set source EXISTS + is CURRENT (a missing or
 *      unpulled-stale read is LOUD) — the anti-short-boot floor. Both user-voice
 *      ledgers + the per-user profile are in the set BY CONSTRUCTION (the S335 miss).
 *   3. RUNS the mandatory probes by DELEGATING to the authoritative scripts
 *      (review-debt.ts · threads.ts) and gh (issues · pr · run) — never a
 *      reimplementation, so a probe can't drift from its source of truth.
 *   4. EXTRACTS + PRINTS the `## ⏭ NEXT-SESSION PICKUP` block from hand-off.md as
 *      the FIRST thing in the digest — orientation leads with the handshake, not a menu.
 *
 * DESIGN CONSTRAINTS (pa-base §8 gate-design + the S313/S322 boundary):
 *   - ADDITIVE / SCOPED. This is a NEW file. It does NOT touch bryan's boot
 *     contract (.pa-base/profile · /boot · pa-base.md). It is wired into Peter's
 *     /boot only; the shared-contract amendment is ROUTED to bryan.
 *   - DETECTION, NOT CONTROL, BY DEFAULT. The default run never fails a boot on a
 *     network/auth hiccup — it REPORTS. `--check` is the strict human/CI gate: exit
 *     1 iff a read-set file is MISSING or the PICKUP block is ABSENT (the two
 *     failure classes the seam produces). A repo merely BEHIND origin is a warning,
 *     not a failure (timing, not a defect) — the /boot skill still owns pull.
 *   - READ-ONLY. Fetch yes; pull/commit/push never. This can be run any time.
 *   - DERIVE-DON'T-DECLARE, GUARDED. The read-set manifest MIRRORS the
 *     `.pa-base/profile` Profile-A block. Because a hand manifest can drift from the
 *     contract, each item carries a `needle` proving its mandate, and driftCheck
 *     asserts that needle is still present in the mandating artifact (the profile,
 *     or — for the per-user voice ledger S335 added — the pa-profile). So the manifest
 *     cannot silently outlive a read the contract renamed or dropped. RESIDUAL
 *     (v1, honest): the REVERSE direction — the contract adding a read the manifest
 *     lacks — is NOT auto-detected, because the profile prose also NAMES reads it
 *     tells you to SKIP (SPEC.md "too big to full-read"), so a token scan is
 *     cry-wolf (§8). The manifest is reviewed against the profile at each amendment.
 *   - WINDOWS-FIRST. Peter runs this on Windows. ROOT via fileURLToPath (never
 *     new URL().pathname — the S262/#473 Windows break); sub-processes via spawnSync
 *     with explicit arg arrays, no shell.
 *
 * MODES:
 *   bun scripts/boot.ts             DIGEST — the PICKUP-led boot report (default).
 *   bun scripts/boot.ts --json      JSON   — machine-readable {sync, readset, pickup, probes, board}.
 *   bun scripts/boot.ts --check     CHECK  — exit 1 iff a read-set file MISSING or PICKUP absent.
 *   bun scripts/boot.ts --no-probes        — skip the gh/sub-script probes (fast, offline). Still fetches.
 *
 * House style mirrors scripts/state.ts + scripts/threads.ts (plain bun-run TS,
 * dependency-free node/Bun built-ins, spawnSync, ROOT via import.meta.url).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, ""); // strip trailing sep on BOTH OSes (Windows returns a trailing backslash)
const SUPPORT = `${ROOT}/../scrml-support`;
const PROFILE = `${ROOT}/.pa-base/profile`;
const HANDOFF = `${ROOT}/hand-off.md`;

const args = new Set(process.argv.slice(2));
const JSON_MODE = args.has("--json");
const CHECK_MODE = args.has("--check");
const NO_PROBES = args.has("--no-probes");

// ── process helper ────────────────────────────────────────────────────────────
interface Run { ok: boolean; out: string; err: string; }
function run(cmd: string, argv: string[], cwd = ROOT, timeout = 60_000): Run {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout });
  const out = (r.stdout || "").trim();
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    return { ok: false, out, err: code === "ETIMEDOUT" ? `timeout(${timeout}ms)` : (r.error as Error).message };
  }
  if (r.status !== 0) return { ok: false, out, err: (r.stderr || "").trim() || `exit ${r.status}` };
  return { ok: true, out, err: "" };
}

// ── identity ──────────────────────────────────────────────────────────────────
// git config user.name -> lowercase -> first token. bryan maclee -> bryan ; pjoliver11 -> pjoliver11.
function resolveWho(): string {
  const r = run("git", ["config", "user.name"]);
  const name = (r.ok ? r.out : "bryan").toLowerCase().trim();
  return name.split(/\s+/)[0] || "bryan";
}

// ── repo sync (fetch + behind/ahead/dirty) ─────────────────────────────────────
interface RepoSync { name: string; present: boolean; fetched: boolean; behind: number; ahead: number; dirty: number; note: string; }
function syncRepo(name: string, path: string): RepoSync {
  if (!existsSync(path)) return { name, present: false, fetched: false, behind: 0, ahead: 0, dirty: 0, note: "repo path not found" };
  const fetch = NO_PROBES ? { ok: true, out: "", err: "" } : run("git", ["fetch", "origin"], path, 45_000);
  const counts = run("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"], path);
  let behind = 0, ahead = 0;
  if (counts.ok) { const [b, a] = counts.out.split(/\s+/).map(Number); behind = b || 0; ahead = a || 0; }
  const porcelain = run("git", ["status", "--porcelain"], path);
  const dirty = porcelain.ok ? porcelain.out.split("\n").filter(Boolean).length : 0;
  const note = !fetch.ok ? `fetch failed: ${fetch.err}` : (!counts.ok ? `no origin/main (${counts.err})` : "");
  return { name, present: true, fetched: fetch.ok, behind, ahead, dirty, note };
}

// ── the Profile-A read-set manifest (MIRRORS .pa-base/profile) ─────────────────
// `mandate` = which contract artifact obliges the read (drift-guard corpus).
// `needle`  = a stable substring proving that mandate is still declared there.
type Mandate = "profile" | "pa-profile";
interface ReadItem { id: string; label: string; repo: "scrml" | "support"; rel: string; mandate: Mandate; needle: string; pending?: boolean; underived?: boolean; }

/**
 * Resolve the per-user voice ledger by READING the pa-profile's `{{user_voice_ledger}}`
 * section, rather than assuming the filename is `user-voice-<who>.md`.
 *
 * WHY (S337-bryan). The convention-guess is correct for `pjoliver11` and WRONG for `bryan`,
 * whose ledger is `user-voice-scrml.md` — i.e. read 6a. `pa-profile-bryan.md` says so in the
 * very section that mandates the read: "`user-voice-scrml.md` (bryan's verbatim ledger …).
 * **Planned rename → `user-voice-bryan.md`** … (deferred …)". So the gate demanded a file the
 * contract explicitly says does not exist yet, and FAILED every one of bryan's boots while
 * every read had in fact been done.
 *
 * The drift-guard did not catch it because its needle (`"user-voice-"`) matched that same
 * deferral sentence — it proved the MANDATE was still declared without proving the FILE was
 * the one named. A needle can only witness a mandate; it cannot witness a path.
 *
 * A gate that is red on a correct boot is the §8 cry-wolf shape: it trains the operator to
 * skip the one check whose whole value is being believed. Derive the path from the contract
 * (the script's own stated design principle) and fall back to the convention only when the
 * pa-profile names nothing.
 */
interface Ledger { path: string; pending: boolean; derived: boolean; }

/**
 * Resolve the per-user voice ledger.
 *
 * AUTHORITY is the pa-profile's MACHINE-READABLE marker:
 *     <!-- @ledger path=user-voice-scrml.md status=live|pending -->
 * The prose stays normative for humans; this function reads the FIELD.
 *
 * WHY A FIELD AND NOT THE PROSE (S337). The first two cuts of this resolver mined the
 * `{{user_voice_ledger}}` prose for both the path and the not-yet-created state. Two adversarial
 * rounds produced ELEVEN findings and every round found another prose shape that broke it:
 *   - `$` under /m ended the section capture at end-of-LINE, so it captured one line and
 *     resolved bryan correctly only by accident (his planned-rename name was on line 2);
 *   - a `###` sub-heading inside the section captured an empty body -> silent fallback to the
 *     very filename guess the function exists to eliminate;
 *   - "first backticked name wins" breaks if a section leads with a CROSS-REFERENCE to another
 *     operator's ledger (pjoliver11's section already names bryan's);
 *   - worst, the pending scan tested the WHOLE section while the path was one name in it, so a
 *     "did not yet exist" clause about a DIFFERENT file could mark the real ledger pending and
 *     make the gate FAIL-OPEN — a green "full read-set present" over an absent mandated read.
 * That is the enumerate-forever shape. A declared field is the converge shape, and it is the
 * pattern this contract already converged on three times (the governing-sentence gate, `locus=`,
 * `prov=`). Prose-scan is retained ONLY as a fallback, and a fallback now WARNS (`derived:false`)
 * instead of passing silently — an unobservable fallback was itself one of the findings.
 */
function resolveVoiceLedger(who: string, paProfileText: string): Ledger {
  const mk = paProfileText.match(/<!--\s*@ledger\s+([^>]*?)-->/);
  if (mk) {
    const attrs = mk[1];
    const path = attrs.match(/\bpath=([^\s]+)/)?.[1];
    const status = (attrs.match(/\bstatus=([^\s]+)/)?.[1] ?? "live").toLowerCase();
    if (path) return { path, pending: status === "pending", derived: true };
  }
  // ── fallback: no marker on this profile. Derive from prose, and SAY SO (derived:false).
  const sec = paProfileText.match(/^#{1,6}\s.*\{\{user_voice_ledger\}\}.*\n([\s\S]*?)(?=\n#{1,6}\s|(?![\s\S]))/m);
  const hay = sec ? sec[1] : "";
  // Anchor on the OPERATOR's own name first; fall back to positional order. This is immune to a
  // section that leads with a cross-reference to someone else's ledger.
  const own = hay.match(new RegExp("`(user-voice-" + who.replace(/[^A-Za-z0-9_-]/g, "") + "\\.md)`"));
  const first = hay.match(/`(user-voice-[A-Za-z0-9._-]+\.md)`/);
  const hit = own ?? first;
  if (!hit) return { path: `user-voice-${who}.md`, pending: false, derived: false };
  return { path: hit[1], pending: false, derived: false };
}

function readSet(who: string, paProfileText: string): ReadItem[] {
  const ledger = resolveVoiceLedger(who, paProfileText);
  const sharedWithBryan = ledger.path === "user-voice-scrml.md";
  return [
    { id: "1a", label: "pa-base (universal doctrine)",          repo: "support", rel: "pa-base.md",                  mandate: "profile",    needle: "pa-base.md" },
    { id: "1b", label: "pa-scrml-overlay (project delta)",      repo: "support", rel: "pa-scrml-overlay.md",         mandate: "profile",    needle: "pa-scrml-overlay.md" },
    { id: "2",  label: "PA-SCRML-PRIMER (language snapshot)",   repo: "scrml",   rel: "docs/PA-SCRML-PRIMER.md",     mandate: "profile",    needle: "PA-SCRML-PRIMER.md" },
    { id: "3",  label: "SPEC-INDEX (spec navigation map)",      repo: "scrml",   rel: "compiler/SPEC-INDEX.md",      mandate: "profile",    needle: "SPEC-INDEX.md" },
    { id: "4",  label: "master-list §0 (phase dashboard)",      repo: "scrml",   rel: "master-list.md",              mandate: "profile",    needle: "master-list.md" },
    { id: "5",  label: "hand-off (live session state)",         repo: "scrml",   rel: "hand-off.md",                 mandate: "profile",    needle: "hand-off.md" },
    { id: "6a", label: "user-voice-scrml (bryan — binds all)",  repo: "support", rel: "user-voice-scrml.md",         mandate: "profile",    needle: "user-voice-scrml.md" },
    // 6b — the per-user voice ledger S335 short-booted. Mandated by the pa-profile ({{user_voice_ledger}}
    // says "read its tail … in addition to bryan's"), NOT the profile read-set line — so its drift corpus
    // is the pa-profile. Item 7 (reading the pa-profile itself) IS named by profile read-set line 7.
    // `pending` = the pa-profile itself declares this ledger not-yet-created (ryan today). Such a
    // read is absent BY CONTRACT, so its absence is a WARNING, never a FAIL.
    // `sharedWithBryan` = this operator's ledger IS 6a (bryan today, until the deferred
    // user-voice-bryan.md rename lands). Label it, so a ✓ here is not read as independent
    // evidence that a SECOND ledger was read — 6b's whole point is "in addition to bryan's".
    { id: "6b", label: sharedWithBryan ? `${ledger.path.replace(/\.md$/, "")} (your own ledger — SAME FILE as 6a)`
                                       : `${ledger.path.replace(/\.md$/, "")} (your own ledger)`,
      repo: "support", rel: ledger.path, mandate: "pa-profile", needle: "user-voice-", pending: ledger.pending, underived: !ledger.derived },
    { id: "7",  label: `pa-profile-${who} (personal layer)`,    repo: "support", rel: `pa-profile-${who}.md`,        mandate: "profile",    needle: "pa-profile-" },
  ];
}

interface ReadStatus extends ReadItem { abs: string; exists: boolean; behindPath: number; named: boolean; }
function checkRead(it: ReadItem, profileText: string, paProfileText: string): ReadStatus {
  const base = it.repo === "scrml" ? ROOT : SUPPORT;
  const abs = `${base}/${it.rel}`;
  const exists = existsSync(abs);
  // per-file staleness: # origin commits touching this path not yet in HEAD (needs the prior fetch).
  let behindPath = 0;
  if (exists) {
    const r = run("git", ["rev-list", "--count", "HEAD..origin/main", "--", it.rel], base);
    if (r.ok) behindPath = Number(r.out) || 0;
  }
  // drift-guard: the mandating artifact must still NAME this read.
  const corpus = it.mandate === "profile" ? profileText : paProfileText;
  const named = corpus.includes(it.needle);
  return { ...it, abs, exists, behindPath, named };
}

// ── active-sessions board liveness (potential live siblings) ───────────────────
// The board dir is APPEND-ONLY history — most files are wrapped sessions that were
// never flipped to `status: WRAPPED`, so a status-only filter surfaces months of
// dead files (the §8 cry-wolf shape). A concurrent sibling is by nature RECENT, so
// bound the scan by mtime: only non-wrapped files touched within the window are
// candidates. Actual liveness is still reconciled against the delta-log (a recent
// header can be a wrapped session that never flipped — the S331-bryan case).
const BOARD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 72h
interface Sibling { file: string; who: string; status: string; ageH: number; }
function boardLiveness(): Sibling[] {
  const dir = `${SUPPORT}/handOffs/active-sessions`;
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const files = readdirSync(dir).filter((f) => /^S\d+(-[a-z0-9]+)?\.md$/i.test(f));
  const out: Sibling[] = [];
  for (const f of files) {
    const abs = `${dir}/${f}`;
    let mtime = 0;
    try { mtime = statSync(abs).mtimeMs; } catch { continue; }
    if (now - mtime > BOARD_WINDOW_MS) continue; // ancient → wrapped-by-construction
    let status = "?";
    try {
      const text = readFileSync(abs, "utf8");
      const m = text.match(/^status:\s*(\S+)/mi);
      if (m) status = m[1].toUpperCase();
      else if (/\bWRAPPED\b/i.test(text.slice(0, 400))) status = "WRAPPED";
      else if (/\bLIVE\b/i.test(text.slice(0, 400))) status = "LIVE";
    } catch { /* unreadable → status ? */ }
    if (status !== "WRAPPED") { // only recent + non-wrapped are candidate live siblings
      const who = (f.match(/-([a-z0-9]+)\.md$/i)?.[1]) ?? "?";
      out.push({ file: f, who, status, ageH: Math.round((now - mtime) / 3_600_000) });
    }
  }
  return out.sort((a, b) => a.ageH - b.ageH);
}

// ── PICKUP block extraction ────────────────────────────────────────────────────
function extractPickup(handoffText: string): string | null {
  // Anchor to LINE-START (/m). An unanchored indexOf would match the literal string inside a
  // backtick/code-span MENTION — and the wrap template itself contains one ("a standardized
  // `## ⏭ NEXT-SESSION PICKUP` block") — so on a hand-off that LACKS the real heading it would
  // FALSE-PASS the gate (pickupAbsent=false), the exact short-boot this exists to catch.
  // Exact canonical heading first; else any H2 (not H3 — the (?!#) guard) line that still says it.
  const m = handoffText.match(/^## ⏭ NEXT-SESSION PICKUP/m)
         ?? handoffText.match(/^##(?!#)[^\n]*NEXT-SESSION PICKUP/m);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  const nlAfterHeading = handoffText.indexOf("\n", start);
  const heading = nlAfterHeading < 0 ? handoffText.slice(start) : handoffText.slice(start, nlAfterHeading);
  const body = nlAfterHeading < 0 ? "" : handoffText.slice(nlAfterHeading + 1);
  const nextH2 = body.search(/^##\s/m); // stop at the next H2
  const section = nextH2 < 0 ? body : body.slice(0, nextH2);
  return `${heading}\n${section}`.trim();
}

// ── mandatory probes (delegated to the authoritative sources) ──────────────────
interface Probe { id: string; label: string; ok: boolean; out: string; err: string; }
function runProbe(id: string, label: string, cmd: string, argv: string[], timeout = 120_000): Probe {
  const r = run(cmd, argv, ROOT, timeout);
  return { id, label, ok: r.ok, out: r.out, err: r.err };
}
function allProbes(): Probe[] {
  return [
    runProbe("review-debt", "Review floor (owed reviews)", "bun", ["scripts/review-debt.ts"]),
    runProbe("threads", "Thread-board (open threads)", "bun", ["scripts/threads.ts", "--open"]),
    // S337: the deliberation queue had NO probe. dpa-024 sat BANKED-UNRUN for 6 sessions and was
    // surfaced by bryan, not by the boot ("i never saw the results of the perfect compiler dpa"),
    // and dpa-022/023 read UNRUN for a day AFTER running. pa-base §10: a channel the probe does
    // not read does not exist to the PA.
    runProbe("dpa", "Deliberation queue (unrun / unratified)", "bun", ["scripts/dpa-debt.ts"]),
    runProbe("issues", "Adopter issues (open)", "gh", ["issue", "list", "--repo", "bryanmaclee/scrml", "--state", "open"], 45_000),
    runProbe("prs", "Open PRs", "gh", ["pr", "list"], 45_000),
    runProbe("runs", "CI runs (main, last 3)", "gh", ["run", "list", "--branch", "main", "--limit", "3"], 45_000),
  ];
}

// ── assemble ───────────────────────────────────────────────────────────────────
const who = resolveWho();
const profileText = existsSync(PROFILE) ? readFileSync(PROFILE, "utf8") : "";
const paProfilePath = `${SUPPORT}/pa-profile-${who}.md`;
const paProfileText = existsSync(paProfilePath) ? readFileSync(paProfilePath, "utf8") : "";
const handoffText = existsSync(HANDOFF) ? readFileSync(HANDOFF, "utf8") : "";

const sync = [syncRepo("scrml", ROOT), syncRepo("scrml-support", SUPPORT)];
const reads = readSet(who, paProfileText).map((it) => checkRead(it, profileText, paProfileText));
const pickup = extractPickup(handoffText);
const board = boardLiveness();
const probes = NO_PROBES ? [] : allProbes();

// failure classes for --check: a missing read, or an absent PICKUP block.
// A read the pa-profile itself declares not-yet-created (`pending`) is absent BY CONTRACT.
// Failing on it is the §8 cry-wolf shape — red on a correct boot, for a file the contract says
// should not exist yet. Surface it as a warning; only an UNEXPLAINED absence fails the gate.
const missingReads = reads.filter((r) => !r.exists && !r.pending);
const pendingReads = reads.filter((r) => !r.exists && r.pending);
const pickupAbsent = pickup === null;
const FAIL = missingReads.length > 0 || pickupAbsent;

// warnings (never fail the boot): behind repos, per-file staleness, manifest drift, unavailable probes.
const staleReads = reads.filter((r) => r.exists && r.behindPath > 0);
const driftReads = reads.filter((r) => !r.named);
const behindRepos = sync.filter((s) => s.present && s.behind > 0);
const deadProbes = probes.filter((p) => !p.ok);

// ── JSON mode ──────────────────────────────────────────────────────────────────
if (JSON_MODE) {
  console.log(JSON.stringify({
    who, gate: FAIL ? "FAIL" : "PASS",
    sync, pickupPresent: !pickupAbsent, pickup,
    // pending/underived MUST ship: without them a consumer's `readset.every(r => r.exists)`
    // disagrees with `gate`, since a pending read is absent-by-contract yet the gate passes.
    readset: reads.map(({ id, label, rel, exists, behindPath, named, pending, underived }) => ({ id, label, rel, exists, pending: !!pending, underived: !!underived, behindPath, named })),
    board, probes: probes.map(({ id, ok, err }) => ({ id, ok, err })),
    warnings: { staleReads: staleReads.map((r) => r.id), driftReads: driftReads.map((r) => r.id), behindRepos: behindRepos.map((r) => r.name), deadProbes: deadProbes.map((p) => p.id), pendingReads: pendingReads.map((r) => r.id), underivedLedger: reads.filter((r) => r.underived).map((r) => r.id) },
  }, null, 2));
  process.exit(CHECK_MODE && FAIL ? 1 : 0);
}

// ── digest output ──────────────────────────────────────────────────────────────
const line = (s = "") => console.log(s);
const H = (s: string) => { line(); line(s); line("─".repeat(Math.min(s.length, 72))); };

// 1. THE PICKUP — first, always. This is the whole point: orientation leads with the handshake.
line();
if (pickup) {
  line(pickup);
} else {
  line("## ⏭ NEXT-SESSION PICKUP");
  line("");
  line("  ✗ ABSENT — hand-off.md has no `## ⏭ NEXT-SESSION PICKUP` block.");
  line("    The wrap did not write the standardized handshake. Do NOT improvise a menu:");
  line("    reconstruct the left-off state from hand-off.md + the delta-log tail before orienting.");
}

// 2. sync
H("SYNC");
for (const s of sync) {
  if (!s.present) { line(`  ✗ ${s.name.padEnd(14)} MISSING (${s.note})`); continue; }
  const flags = [
    s.behind > 0 ? `behind ${s.behind}` : "",
    s.ahead > 0 ? `ahead ${s.ahead}` : "",
    s.dirty > 0 ? `${s.dirty} dirty` : "",
    s.note,
  ].filter(Boolean).join(" · ");
  const glyph = s.behind > 0 || s.note ? "⚠" : "✓";
  line(`  ${glyph} ${s.name.padEnd(14)} ${flags || "in sync (0/0, clean)"}`);
}
if (behindRepos.length) line(`  → pull --rebase before reading: reads may be stale (the /boot skill owns the pull).`);

// 3. read-set
H("PROFILE-A READ-SET");
for (const r of reads) {
  const glyph = (!r.exists && r.pending) ? "⚠" : !r.exists ? "✗" : r.behindPath > 0 ? "⚠" : !r.named ? "⚠" : "✓";
  const tail = (!r.exists && r.pending) ? "pending (contract says not yet created)" : !r.exists ? "MISSING" : r.behindPath > 0 ? `stale (${r.behindPath} unpulled)` : !r.named ? "DRIFT (not named in contract)" : "";
  line(`  ${glyph} ${r.id.padEnd(3)} ${r.label.padEnd(38)} ${tail}`);
}
if (driftReads.length) line(`  → DRIFT: the manifest names a read its contract no longer declares — reconcile scripts/boot.ts with .pa-base/profile.`);

// 4. probes
if (!NO_PROBES) {
  H("PROBES");
  for (const p of probes) {
    if (!p.ok) { line(`  ⚠ ${p.label} — UNAVAILABLE (${p.err}). NOT verified this session; say so in the report.`); continue; }
    line(`  ▸ ${p.label}`);
    for (const l of p.out.split("\n")) line(`      ${l}`);
  }
}

// 5. board liveness
H("BOARD — recent non-wrapped sessions (72h)");
if (board.length === 0) {
  line("  ✓ no recent non-wrapped session files — SOLO.");
} else {
  for (const b of board) line(`  • ${b.file.padEnd(20)} status=${b.status.padEnd(7)} ${b.ageH}h ago  (${b.who})`);
  line("  ⚠ A board header can be STALE (a wrapped session that never flipped status). Cross-check the");
  line("    delta-log tail before treating a sibling as LIVE — header LIVE ≠ actually landing.");
}

// 6. gate verdict
H("BOOT-GATE");
if (FAIL) {
  if (missingReads.length) line(`  ✗ FAIL — ${missingReads.length} read-set file(s) MISSING: ${missingReads.map((r) => r.id).join(", ")}`);
  if (pendingReads.length) line(`  ⚠ pending (not a failure — contract declares not-yet-created): ${pendingReads.map((r) => r.id).join(", ")}`);
  if (pickupAbsent) line(`  ✗ FAIL — PICKUP block absent from hand-off.md`);
  line(`  A skipped read is the S335 short-boot. Resolve before orienting.`);
} else if (pendingReads.length) {
  // Do NOT claim "full read-set present" — a read IS absent; the contract just says so on purpose.
  line(`  ✓ PASS — PICKUP present; every read present except ${pendingReads.length} declared pending.`);
} else {
  line(`  ✓ PASS — full read-set present, PICKUP present.`);
}
// Outside the FAIL branch: for the only real case (a pending ledger with nothing else wrong)
// FAIL is false, so a warning nested under it could never print.
if (pendingReads.length) line(`  ⚠ pending (absent BY CONTRACT — warn, never fail): ${pendingReads.map((r) => r.id).join(", ")}`);
const underived = reads.filter((r) => r.underived);
if (underived.length) line(`  ⚠ ledger path GUESSED (no @ledger marker in the pa-profile): ${underived.map((r) => r.id).join(", ")}`);
const warnN = staleReads.length + driftReads.length + behindRepos.length + deadProbes.length + pendingReads.length + reads.filter((r) => r.underived).length;
if (warnN) line(`  ${warnN} warning(s): ${[staleReads.length && `${staleReads.length} stale`, driftReads.length && `${driftReads.length} drift`, behindRepos.length && `${behindRepos.length} behind`, deadProbes.length && `${deadProbes.length} probe-unavailable`, pendingReads.length && `${pendingReads.length} pending`, reads.filter((r) => r.underived).length && `${reads.filter((r) => r.underived).length} guessed-path`].filter(Boolean).join(" · ")}`);
line();

if (CHECK_MODE && FAIL) process.exit(1);
