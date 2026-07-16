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
//   Runs `bash -c <command>` with cwd = repo root, 10s timeout. exit 0 => DONE ; exit non-0 => OPEN ;
//   spawn-failure / timeout => ERROR. Keep it CHEAP + DETERMINISTIC — a grep on a landed artifact, a
//   conformance-case existence check, a `bun test -t <name>` name match. It runs on every boot: no network,
//   no full-suite, no side effects.
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

function runProbe(cmd: string): { status: Status; detail: string } {
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
