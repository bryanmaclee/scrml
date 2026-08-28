#!/usr/bin/env bun
/**
 * corpus-compile-floor — an ABSOLUTE compile floor over the showcase-program corpus.
 *
 * WHY THIS EXISTS (the gap it closes)
 * ===================================
 * `corpus-emit-differential.ts` is a base-vs-head DIFFERENTIAL: it records per-source compile status
 * but, by its own HARD REQ 5, "a capture NEVER exits non-zero merely because sources failed to
 * compile — compile failure is DATA." So a source that fails to compile IDENTICALLY on both sides
 * produces no diff and the gate stays green. A source broken since before the baseline is therefore
 * INVISIBLE to it. `snippet-gate.js` compiles only public-CITED `.scrml`; `compile-test-samples.sh`
 * compiles a hand-listed 13. None asserts an absolute floor over the shipped showcase PROGRAMS, so
 * `examples/09-error-handling.scrml` failed to compile from S236 (the E-ERROR-009 mint, `760e9f83`)
 * onward with nothing red — a flagship that does not build, uncaught for months.
 * (gap: g-corpus-differential-gate-blind-to-standing-breakage, S382.)
 *
 * WHAT THIS GATES
 * ===============
 * Every SHOWCASE PROGRAM must compile on HEAD with zero fatal errors:
 *   - each top-level single-file program  `examples/*.scrml`
 *   - each multi-file scrml program dir   `examples/<dir>/`, `benchmarks/<dir>/`  (a dir carrying >=1
 *     `.scrml`, compiled as ONE program from all its `.scrml` — mirrors `scrml build <dir>`)
 * These are all POSITIVE cases: shipped, showcased, meant to build. Warnings are ignored (the floor
 * keys on `result.errors`, the fatal set the CLI itself fails the build on).
 *
 * DELIBERATELY OUT OF SCOPE (a visible decision, not an invisible default) — see FOLLOW-ONS below:
 *   - conformance/ and samples/ : MIXED — they carry intentional-ERROR cases (a negative case is
 *     SUPPOSED to fail to compile). An absolute floor over them needs each case's expected-code
 *     metadata to tell positive from negative; without it the floor would false-positive on every
 *     negative case. Left to a follow-on that reads that metadata.
 *   - stdlib/ : library MODULES, not standalone programs — a bare module compiled alone fails on
 *     unresolved cross-module refs. Needs module-compile semantics; follow-on.
 *
 * ANTI-TRUNCATION (pa-base §8 — the truncated probe; the sister lesson corpus-emit-differential is
 * built around). A truncated enumeration reads exactly like a complete one. Defenses:
 *   - the FULL enumerated program set is printed (never a silent subset);
 *   - a HARD FLOOR on the enumerated count (`MIN_PROGRAMS`) fails LOUD if enumeration collapses;
 *   - a directory that is expected to hold scrml but yields zero `.scrml` is reported, not skipped.
 *
 * THE BASELINE (why the floor has one, and why it does not rot)
 * =============================================================
 * A gate that is instantly red for a reason no current change caused "gets bypassed, then deleted"
 * (pa-base §8; the CI file says the same at its delta-lint step). So a KNOWN, tracked, standing
 * failure is BASELINED — `scripts/corpus-compile-floor.baseline.json`, one entry per broken program
 * naming the gap it is tracked under. Baselined programs do not fail the floor; a NEW breakage does.
 * This is the same discipline as `delta-lint` (`delta-log-dupes.baseline.json`) and `browser-baseline`.
 * It is NOT an allowlist that rots: the floor ALSO fails when a baselined program starts compiling
 * again, or is no longer enumerated — a stale baseline entry is a gate failure, so the baseline can
 * only shrink to truth. Add an entry only for a genuinely-tracked bug (a filed gap); remove it the
 * moment the fix (or the example rewrite) lands.
 *
 * USAGE
 *   bun scripts/corpus-compile-floor.ts            # human report; exit 1 on a NEW break or stale baseline
 *   bun scripts/corpus-compile-floor.ts --check    # gate mode (same exit codes, terse)
 *   bun scripts/corpus-compile-floor.ts --json      # machine-readable result on stdout
 *
 * EXIT CODES
 *   0 = every enumerated showcase program compiled clean OR was a known-baselined failure, and every
 *       baseline entry is still both enumerated AND still failing (no stale baseline).
 *   1 = the floor is breached: a NON-baselined program failed to compile, OR a baseline entry is stale
 *       (its program now compiles, or is no longer enumerated) and must be pruned.
 *   2 = NOT A VALID RUN: enumeration collapsed below MIN_PROGRAMS (a truncated probe — refuse to
 *       report a green floor over a shrunken population).
 */

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// The compiler's public entry. Resolved relative to THIS file so the gate is CWD-independent.
import { compileScrml } from "../compiler/src/api.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL("./corpus-compile-floor.baseline.json", import.meta.url));

/** Roots whose immediate sub-DIRECTORIES are each one multi-file program. */
const PROGRAM_DIR_ROOTS = ["examples", "benchmarks"];
/** Root whose top-level `.scrml` FILES are each one single-file program. */
const SINGLE_FILE_ROOT = "examples";
/** Never descend into these directory names. */
const SKIP_DIRS = new Set(["dist", "node_modules", ".git"]);
const SOURCE_EXT = ".scrml";

/**
 * HARD FLOOR on the enumerated program count. The showcase corpus only grows; a run that enumerates
 * fewer than this many programs has almost certainly truncated (a moved directory, a broken walk) and
 * MUST NOT report a green floor over the remnant. Set below the current true count (36) with headroom
 * for pruning, high enough to catch a real collapse. Raise it as the corpus grows.
 */
const MIN_PROGRAMS = 25;

type Program = { id: string; kind: "single" | "multi"; files: string[] };

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

/** Every `.scrml` under `dir`, recursively, excluding SKIP_DIRS. */
function scrmlUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(e)) continue;
      out.push(...scrmlUnder(p));
    } else if (e.endsWith(SOURCE_EXT)) {
      out.push(p);
    }
  }
  return out;
}

/** Enumerate the showcase programs. Throws (→ exit 2) on a truncation signal. */
function enumeratePrograms(): { programs: Program[]; notes: string[] } {
  const programs: Program[] = [];
  const notes: string[] = [];

  // 1. Single-file programs: top-level examples/*.scrml
  const singleRoot = join(REPO_ROOT, SINGLE_FILE_ROOT);
  const topFiles = readdirSync(singleRoot)
    .filter((e) => e.endsWith(SOURCE_EXT) && statSync(join(singleRoot, e)).isFile())
    .sort();
  for (const f of topFiles) {
    programs.push({ id: toPosix(`${SINGLE_FILE_ROOT}/${f}`), kind: "single", files: [join(singleRoot, f)] });
  }

  // 2. Multi-file programs: each immediate sub-dir of a PROGRAM_DIR_ROOT that carries >=1 .scrml.
  //    A dir with zero .scrml (e.g. a react/vue benchmark) is not a scrml program — skipped, but the
  //    fact that it held zero sources is NOT itself an error (those roots legitimately mix stacks).
  for (const root of PROGRAM_DIR_ROOTS) {
    const rootAbs = join(REPO_ROOT, root);
    if (!existsSync(rootAbs)) { notes.push(`root missing: ${root}`); continue; }
    for (const e of readdirSync(rootAbs).sort()) {
      if (SKIP_DIRS.has(e)) continue;
      const dirAbs = join(rootAbs, e);
      if (!statSync(dirAbs).isDirectory()) continue;
      const files = scrmlUnder(dirAbs);
      if (files.length === 0) continue; // non-scrml dir (e.g. a *-react benchmark)
      programs.push({ id: toPosix(`${root}/${e}/`), kind: "multi", files: files.sort() });
    }
  }

  // Anti-truncation floor.
  if (programs.length < MIN_PROGRAMS) {
    throw new TruncationError(
      `enumerated only ${programs.length} showcase program(s) — below the MIN_PROGRAMS floor (${MIN_PROGRAMS}). ` +
      `This is the truncated-probe signal (pa-base §8): refusing to report a green floor over a shrunken population. ` +
      `If the corpus genuinely shrank, lower MIN_PROGRAMS deliberately.`,
    );
  }
  return { programs, notes };
}

class TruncationError extends Error {}

function errorCodesOf(errors: Array<Record<string, unknown>>): string[] {
  const codes = new Set<string>();
  for (const e of errors) {
    const code =
      (typeof e.code === "string" && e.code) ||
      (typeof e.message === "string" && (e.message.match(/E-[A-Z0-9-]+/)?.[0] ?? "")) ||
      "?";
    codes.add(code || "?");
  }
  return [...codes];
}

type Result = { id: string; kind: string; fileCount: number; ok: boolean; errorCount: number; codes: string[] };

function compileProgram(p: Program): Result {
  try {
    const r = compileScrml({ inputFiles: p.files, write: false }) as { errors?: Array<Record<string, unknown>> };
    const errors = r.errors ?? [];
    return { id: p.id, kind: p.kind, fileCount: p.files.length, ok: errors.length === 0, errorCount: errors.length, codes: errorCodesOf(errors) };
  } catch (e) {
    // A THROW from the compiler is also a floor breach (the program did not build).
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 80);
    return { id: p.id, kind: p.kind, fileCount: p.files.length, ok: false, errorCount: 1, codes: [`THREW:${msg}`] };
  }
}

type BaselineEntry = { id: string; gap: string; note?: string };

/** Load the known-failure baseline. Absent file = empty baseline (the floor is absolute). */
function loadBaseline(): BaselineEntry[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const entries: unknown = Array.isArray(raw) ? raw : raw?.entries;
  if (!Array.isArray(entries)) throw new Error(`baseline malformed: expected an array (or {entries:[...]}) in ${BASELINE_PATH}`);
  return entries.map((e) => {
    if (!e || typeof e.id !== "string" || typeof e.gap !== "string") {
      throw new Error(`baseline entry malformed (needs {id, gap}): ${JSON.stringify(e)}`);
    }
    return { id: e.id, gap: e.gap, note: typeof e.note === "string" ? e.note : undefined };
  });
}

function main(): number {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const json = args.includes("--json");

  let programs: Program[];
  let notes: string[];
  try {
    ({ programs, notes } = enumeratePrograms());
  } catch (e) {
    if (e instanceof TruncationError) {
      console.error(`corpus-compile-floor: NOT A VALID RUN — ${e.message}`);
      return 2;
    }
    throw e;
  }

  const baseline = loadBaseline();
  const baselineById = new Map(baseline.map((b) => [b.id, b]));
  const enumeratedIds = new Set(programs.map((p) => p.id));

  const results = programs.map(compileProgram);
  const byId = new Map(results.map((r) => [r.id, r]));

  const newFailures = results.filter((r) => !r.ok && !baselineById.has(r.id));
  const knownFailures = results.filter((r) => !r.ok && baselineById.has(r.id));

  // Stale baseline: an entry whose program now COMPILES, or is no longer enumerated. Either way the
  // entry is a lie and must be pruned — a gate failure, so the baseline can only shrink to truth.
  const staleBaseline = baseline.filter((b) => {
    if (!enumeratedIds.has(b.id)) return true;      // no longer a program
    return byId.get(b.id)?.ok === true;             // now compiles clean
  });

  const breached = newFailures.length > 0 || staleBaseline.length > 0;

  if (json) {
    console.log(JSON.stringify({
      total: results.length, newFailures, knownFailures, staleBaseline,
    }, null, 2));
    return breached ? 1 : 0;
  }

  const nSingle = results.filter((r) => r.kind === "single").length;
  const nMulti = results.filter((r) => r.kind === "multi").length;
  if (!check) {
    console.log(`\ncorpus-compile-floor — ${results.length} showcase program(s): ${nSingle} single-file + ${nMulti} multi-file`);
    for (const n of notes) console.log(`  note: ${n}`);
  }

  for (const r of knownFailures) {
    const b = baselineById.get(r.id)!;
    console.log(`  known-broken (baselined): ${r.id}  [${r.codes.join(", ")}]  → ${b.gap}${b.note ? `  (${b.note})` : ""}`);
  }

  if (!breached) {
    console.log(`  PASS — every showcase program compiles clean on HEAD, or is a tracked baselined failure (${knownFailures.length}).`);
    return 0;
  }

  if (newFailures.length > 0) {
    console.error(`\n  FAIL — ${newFailures.length} NEW showcase-program compile break(s) (not baselined):`);
    for (const r of newFailures) {
      console.error(`    ✗ ${r.id}  [${r.codes.join(", ")}]  (${r.errorCount} fatal error(s), ${r.fileCount} file(s))`);
    }
    console.error(`\n  A showcase program that does not build is a shipped defect. Fix it, or — if it is a genuinely\n  tracked bug awaiting a ruling — file the gap and add a baseline entry naming that gap.`);
  }
  if (staleBaseline.length > 0) {
    console.error(`\n  FAIL — ${staleBaseline.length} STALE baseline entr(y/ies) — prune from ${relPath(BASELINE_PATH)}:`);
    for (const b of staleBaseline) {
      const reason = !enumeratedIds.has(b.id) ? "no longer an enumerated program" : "now compiles clean — the fix landed";
      console.error(`    ✗ ${b.id}  (${reason})  [was: ${b.gap}]`);
    }
  }
  return 1;
}

function relPath(abs: string): string {
  return toPosix(abs.startsWith(REPO_ROOT) ? abs.slice(REPO_ROOT.length) : abs);
}

process.exit(main());
