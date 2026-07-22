// scripts/threads.ts — the thread board: executable done-probes, AUTO-DISCOVERED from BRIEF `DONE-PROBE:` fields.
// change-id: thread-board-build-2026-07-16
// #dock[ implements=thread-board-build-2026-07-16 · verified ]
//
// WHY (the S259 meta-lesson): prose "open threads" lists in the hand-off DRIFT — a thread reads as open long
// after it landed, or as done when it isn't (this session alone hit several "is X actually done?" hand-checks).
// This makes thread-state EXECUTABLE and AUTO-DISCOVERED — there is NO registry the PA must remember to update:
// any `docs/changes/<id>/BRIEF.md` that declares a `DONE-PROBE:` line IS a tracked thread, and the probe (a
// cheap shell command) ASSERTS the thread's completion against real artifacts. Derive-don't-declare, like
// scripts/state.ts (@gap tokens) — the board can never silently diverge from what actually landed.
//
// MODES:
//   bun scripts/threads.ts            PRINT  — aligned table of every tracked thread + DONE/OPEN/ERROR (read-only).
//   bun scripts/threads.ts --open     OPEN   — only OPEN + ERROR threads (the boot / "what's left" view). exit 0.
//   bun scripts/threads.ts --json     JSON   — machine-readable array (boot / CI consumption).
//   bun scripts/threads.ts --check    CHECK  — exit 1 IFF any probe ERRORS (malformed / times out). An OPEN
//                                              thread is NOT a failure; CHECK guards against rotted/broken probes.
//
// DONE-PROBE CONTRACT — put ONE line anywhere in a BRIEF.md:
//   DONE-PROBE: <shell command>
//   The probe is first VALIDATED as a real shell command, then RUN: exit 0 => DONE ; exit non-0 => OPEN ;
//   spawn-failure / timeout => ERROR ; MALFORMED (not a command) => ERROR. It runs `bash -c <command>`
//   with cwd = repo root, 10s timeout. Keep it CHEAP + DETERMINISTIC — a grep on a landed artifact, a
//   conformance-case existence check, a `bun test -t <name>` name match. It runs on every boot: no network,
//   no full-suite, no side effects.
//   MALFORMED-PROBE GUARD (S278): a PROSE sentence in this field is NOT a shell command, but `bash -c`
//   runs it to a non-zero exit indistinguishable from a legit-open probe — so it silently read as OPEN,
//   masquerading as real open work (four S277 threads did exactly this — the false-OPEN class the board
//   exists to prevent, re-entered through the probe-authoring door). runProbe now validates STRUCTURALLY
//   before running: (1) `bash -n` must parse it, and (2) its FIRST TOKEN must resolve to a command
//   (`command -v`). Either check failing => ERROR (loud), never OPEN. So a prose probe fails the board
//   loudly (and `--check`, run at boot/CI, exits 1 on it) instead of hiding as open work.
//
// House style mirrors scripts/state.ts (plain bun-run TS, dependency-free Bun/node built-ins, spawnSync,
// ROOT via import.meta.url).

import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

type Status = "DONE" | "OPEN" | "ERROR";
interface Thread {
  id: string;
  brief: string;
  title: string;
  probe: string;
  status: Status;
  detail: string;
}

function sh(cmd: string, args: string[], timeout?: number) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout });
}

// A real field line: `DONE-PROBE:` at line start (allowing leading whitespace) with a non-empty command.
const PROBE_RE = /^[ \t]*DONE-PROBE:[ \t]*(\S.*?)[ \t]*$/m;
// Title = the BRIEF's first H1, minus an optional "BRIEF — " prefix; falls back to the change-id.
const TITLE_RE = /^#[ \t]+(?:BRIEF[ \t]*[—–-][ \t]*)?(.+?)[ \t]*$/m;

function discover(): Omit<Thread, "status" | "detail">[] {
  // grep-first so we only READ the handful of BRIEFs that declare a probe — cheap even at 400+ briefs.
  const g = sh("grep", ["-rlZ", "--include=BRIEF.md", "-e", "DONE-PROBE:", "docs/changes"]);
  const files = (g.stdout || "").split("\0").filter(Boolean);
  const threads: Omit<Thread, "status" | "detail">[] = [];
  for (const rel of files) {
    const text = readFileSync(`${ROOT}/${rel}`, "utf8");
    const pm = text.match(PROBE_RE);
    if (!pm) continue; // grep matched a prose mention / code sample, not a real field line
    const parts = rel.split("/");
    const id = parts[parts.length - 2] ?? rel; // docs/changes/<id>/BRIEF.md -> <id>
    const tm = text.match(TITLE_RE);
    threads.push({ id, brief: rel, title: (tm ? tm[1] : id).slice(0, 80), probe: pm[1] });
  }
  return threads;
}

// A probe must be a real shell command, not prose. A prose sentence bash-c-runs to a non-zero exit that
// is indistinguishable from a legit-open probe (the S278 false-OPEN class). So validate STRUCTURALLY,
// before running: it must parse (`bash -n`) AND its first token must resolve to a command (`command -v`).
// Either check failing => the probe is malformed => ERROR (loud), never a silent OPEN. See the header
// MALFORMED-PROBE GUARD note. (cmd is passed as a bash positional arg `$1`, never interpolated — no
// injection, and no premature expansion of backticks in a prose probe.)
function validateProbe(cmd: string): string | null {
  const syn = sh("bash", ["-n", "-c", cmd], 10_000);
  if (syn.status !== 0) {
    const msg = (syn.stderr || "").trim().split("\n").pop() || "bash -n rejected it";
    return `malformed probe (syntax error — prose, not a command?): ${msg}`;
  }
  const tokR = sh("bash", ["-c", 'read -ra t <<< "$1"; printf %s "${t[0]-}"', "_", cmd]);
  const tok = (tokR.stdout || "").trim();
  const cv = sh("bash", ["-c", 'command -v -- "$1" >/dev/null 2>&1', "_", tok]);
  if (cv.status !== 0) return `malformed probe (first token '${tok}' is not a command — prose, not a shell probe?)`;
  return null;
}

function runProbe(cmd: string): { status: Status; detail: string } {
  const bad = validateProbe(cmd);
  if (bad) return { status: "ERROR", detail: bad };

  const r = sh("bash", ["-c", cmd], 10_000);
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    return { status: "ERROR", detail: code === "ETIMEDOUT" ? "timeout(10s)" : (r.error as Error).message };
  }
  if (r.signal) return { status: "ERROR", detail: `killed(${r.signal})` }; // timeout kill
  return r.status === 0 ? { status: "DONE", detail: "" } : { status: "OPEN", detail: `exit ${r.status}` };
}

function evaluate(): Thread[] {
  return discover()
    .map((t) => ({ ...t, ...runProbe(t.probe) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── output ──────────────────────────────────────────────────────────────────
const GLYPH: Record<Status, string> = { DONE: "✓", OPEN: "•", ERROR: "✗" };
const RANK: Record<Status, number> = { OPEN: 0, ERROR: 1, DONE: 2 };
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

function printTable(threads: Thread[], onlyOpen: boolean) {
  const open = threads.filter((t) => t.status === "OPEN").length;
  const err = threads.filter((t) => t.status === "ERROR").length;
  const done = threads.filter((t) => t.status === "DONE").length;
  const rows = (onlyOpen ? threads.filter((t) => t.status !== "DONE") : threads)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.id.localeCompare(b.id));

  if (threads.length === 0) {
    console.log("thread-board: no BRIEF.md declares a DONE-PROBE: yet — see scripts/threads.ts header for the contract.");
    return;
  }
  console.log(`thread-board — ${threads.length} tracked · ${open} open · ${done} done${err ? ` · ${err} ERROR` : ""}`);
  if (rows.length === 0) {
    console.log("  (all tracked threads DONE)");
    return;
  }
  console.log("");
  for (const t of rows) {
    const tail = t.status === "ERROR" ? `  [${t.detail}]` : "";
    console.log(`  ${GLYPH[t.status]} ${pad(t.status, 5)} ${pad(t.id, 46)} ${t.title}${tail}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const arg = process.argv[2] ?? "";
const threads = evaluate();

if (arg === "--json") {
  console.log(JSON.stringify(threads, null, 2));
} else if (arg === "--check") {
  const errored = threads.filter((t) => t.status === "ERROR");
  if (errored.length) {
    console.error(`thread-board --check FAILED — ${errored.length} probe(s) ERRORED (malformed / timeout):`);
    for (const t of errored) console.error(`  ✗ ${t.id}: ${t.detail}  (probe: ${t.probe})`);
    process.exit(1);
  }
  console.log(`thread-board --check OK — ${threads.length} probe(s) ran, 0 errored (${threads.filter((t) => t.status === "OPEN").length} open).`);
} else {
  printTable(threads, arg === "--open");
}
