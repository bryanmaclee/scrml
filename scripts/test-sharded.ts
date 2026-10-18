#!/usr/bin/env bun
// scripts/test-sharded.ts — run a `bun test` file set across N parallel processes. (S468, unit s468-hook-sharding)
//
// USAGE
//   bun scripts/test-sharded.ts [--bail] [--shards=N] [--verbose] [--plan] [<bun test flag>...] <path>...
//
//   <path>      a test FILE or a DIRECTORY (every test file under it, recursively). Exactly the paths the
//               pre-commit hook passes to `bun test`. Unlike `bun test`'s positional args these are PATHS, not
//               substring filters — the file set is enumerated here so it can be split. `--plan` prints it.
//   --bail      stop EVERY shard on the first failure anywhere, print that failure, exit 1.
//   --shards=N  shard count. Precedence: --shards, then $SCRML_HOOK_SHARDS, then the memory-aware default:
//               min(floor(cores/2), 8, floor((MemAvailable - reserve) / shard-mem)), at least 1. An explicit N is
//               honoured as given (the per-shard ceiling below still bounds each shard).
//               N=1 runs one `bun test` process over the same file list (no parallelism).
//   --shard-timeout=S   wall-clock bound per shard, seconds ($SCRML_HOOK_SHARD_TIMEOUT_S, default 1200). A shard
//               still running at S is killed (its whole process group, nothing else) and the run FAILS, naming
//               the shard, the file it was in and its assigned files. Never a pass.
//   --shard-mem=MB      RSS ceiling per shard, MB, summed over the shard's process group (bun test + every
//               child it spawned) ($SCRML_HOOK_SHARD_MEM_MB, default 3072). Over it -> killed, run FAILS, as above.
//               Also the per-shard budget the default N is derived from. Sampled every second (Linux /proc;
//               elsewhere the ceiling is not enforced and N falls back to os.freemem()).
//               A memory-derived N of 1 (memory already short; the whole suite in one shard) doubles the ceiling,
//               so the normal single-process peak (~2.8 GB) cannot false-red it.
//   reserve     $SCRML_HOOK_MEM_RESERVE_MB (default 2048): memory left for everything else when deriving N.
//   --slot-wait=S       how long a shard may wait for a machine-wide slot ($SCRML_HOOK_SLOT_WAIT_S, default 1800);
//               past it the shard never starts and the run FAILS ("NEVER STARTED: no machine-wide test slot").
//   slots       $SCRML_HOOK_SLOTS: the machine-wide concurrent-shard budget (default below, MACHINE-WIDE SLOTS).
//   Second-valued settings above 2,000,000 are refused (exit 2): setTimeout would overflow and fire at once.
//   --verbose   stream every shard's output live (prefixed `[sK]`) instead of only failures + summaries.
//   --plan      print the shard assignment (files + estimated seconds per shard) and exit 0 without running.
//   any other `--flag` is passed through to every `bun test` invocation (e.g. `--timeout=20000`).
//
// WHY THIS EXISTS. The pre-commit hook ran `bun test <unit> <integration> <conformance> <top-level> --bail` in
// ONE process: ~16 min on an idle 32-core box, ~45 min with ten agents committing at once (S468). Every agent
// commit pays it and the work sits unpushed meanwhile — a machine shutdown at S468 caught seven agents mid-hook.
// `bun test` runs files serially inside one process, so all but one core sits idle.
//
// WHAT IT DOES
//   1. Enumerates the test files (bun's naming rule: *.test.* / *_test.* / *.spec.* / *_spec.* with a JS/TS
//      extension; node_modules and dot-directories skipped — the same set `bun test <dir>` collects; the
//      per-shard "across M files" counts are checked against the assignment so a dropped file is an ERROR).
//   2. Balances them into N shards by longest-processing-time-first over a per-file duration estimate: the
//      measured duration from the timing cache when known, else file size scaled by the cache's median
//      seconds-per-byte (pure file size when the cache is empty).
//   3. Runs `bun test <files>` per shard concurrently from the repo root (so bunfig.toml's preload — the S448
//      per-process temp root — applies to every shard; each shard therefore gets its OWN temp root).
//   4. Collects output. Live: one line per `(fail)` and one line per finished shard. At the end: for each failing
//      shard, the file sections that contain a failure (error + stack + `(fail)` line) with the shard's full
//      output kept on disk (path printed; runs older than a day are pruned), then a per-shard pass/fail/skip
//      table and the overall totals, which equal what the single-process run reports for the same file set.
//   5. Records each file's measured duration (bun's junit reporter, per-file `time`) into the timing cache.
//
// TIMING CACHE. `${XDG_CACHE_HOME:-~/.cache}/scrml/test-timings.json` (override: $SCRML_TEST_TIMINGS). It lives
// OUTSIDE the repo deliberately: it is never committed, and every worktree on the machine shares it, so a fresh
// worktree's first commit is balanced by the timings its siblings already measured. Keys are repo-relative
// paths; values are an exponential moving average so one noisy run (a loaded machine) cannot skew the plan.
// Writes are atomic (temp file + rename); a lost race only loses one run's refinement.
//
// ISOLATION / KILLING. Each shard is spawned `detached` (setsid): it is the leader of its own process group, so
// the shard's PIDs are exactly that group. Timeout, memory ceiling, --bail and the runner's own SIGINT/SIGTERM/
// SIGHUP all kill by group (`kill(-pgid)`) — never by name or command line, so the identical `bun test` runs of
// other worktrees are untouched. Backstop: where coreutils `timeout` exists, each shard's command is wrapped in it
// (shard-timeout + 60s, then SIGKILL), so a shard is bounded even if this runner itself is SIGKILLed.
//
// MACHINE-WIDE SLOTS. N per hook is chosen from memory at that hook's start and reserves nothing, so ten hooks
// starting together would each pick N for the whole box. Every shard of every hook on the host therefore also
// holds one flock'd slot file under ~/.cache/scrml/hook-slots/ (next to the timing cache) while it runs; with all
// slots held, a shard WAITS (announced, bounded by slot-wait) rather than start. The lock is on flock(1)'s fd
// inside the shard's process group, so the kernel releases it when the shard's processes die — never a pid file,
// never stale. Placement depends on the plan: which shard waits, and so which files run later, varies with load.
// Without `flock` on PATH (macOS) the budget is not enforced and the runner says so.
//
// SERIAL PINS. A file listed in SERIAL_PINS below is assigned to shard 0 together with every other pinned file,
// so pinned files never run concurrently with EACH OTHER. Use it only for tests that genuinely share an external
// resource between files and cannot be isolated (per-process temp roots, port 0) — never as a way to skip.

import { spawn } from "bun";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from "fs";
import { availableParallelism, cpus, freemem, homedir, totalmem } from "os";
import { dirname, join, relative, resolve, sep } from "path";

// ---------------------------------------------------------------------------------------------------------------
// Pins. Each entry: repo-relative path + why it cannot run concurrently with the other pinned files.
// ---------------------------------------------------------------------------------------------------------------
const SERIAL_PINS: { file: string; why: string }[] = [];

const REPO_ROOT = resolve(import.meta.dir, "..");
const TEST_FILE = /(\.test|_test|\.spec|_spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
interface Options {
  bail: boolean;
  shards: number;
  verbose: boolean;
  plan: boolean;
  timeoutS: number;
  memMb: number;
  slotWaitS: number;
  shardsWhy?: string;
  passthrough: string[];
  paths: string[];
}

// MemAvailable (bytes) from /proc/meminfo — the kernel's estimate of what can be allocated without swapping,
// which counts reclaimable page cache (os.freemem() on Linux does not). Falls back to os.freemem().
function availableMemoryBytes(): number {
  try {
    const m = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
    if (m) return Number(m[1]) * 1024;
  } catch {
    /* not Linux */
  }
  return freemem();
}

const MB = 1024 * 1024;

function defaultShards(memMb: number): { n: number; why: string } {
  const cores = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  const reserveMb = envNumber("SCRML_HOOK_MEM_RESERVE_MB", 2048);
  const availMb = Math.floor(availableMemoryBytes() / MB);
  const byCores = Math.min(Math.floor(cores / 2), 8);
  const byMem = Math.floor((availMb - reserveMb) / memMb);
  const n = Math.max(1, Math.min(byCores, byMem));
  return { n, why: `cores ${cores} -> ${byCores}; ${availMb} MB available - ${reserveMb} reserve / ${memMb} per shard -> ${Math.max(0, byMem)}` };
}

function envNumber(name: string, dflt: number, max?: number): number {
  const v = process.env[name];
  return v !== undefined && v !== "" ? parsePositive(v, name, max) : dflt;
}

// setTimeout holds a signed 32-bit millisecond count; anything larger fires immediately. 2e6 s (~23 days) is far
// past any sane bound and well inside it.
const MAX_SECONDS = 2_000_000;

function parsePositive(raw: string, from: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > max) {
    console.error(`test-sharded: ${from} must be a positive number${max < Number.MAX_SAFE_INTEGER ? ` <= ${max}` : ""}, got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return n;
}

// MACHINE-WIDE SLOT BUDGET. N per hook is derived from memory at that hook's START, and nothing reserves it — ten
// agents committing together would each see the same free memory and together ask for several times the box.
// So every shard of every hook on the host also holds one of SLOTS flock'd slot files under
// ~/.cache/scrml/hook-slots/ while it runs. SLOTS = min(floor(cores/2), floor(MemTotal * 0.8 / ceiling)), >= 1
// ($SCRML_HOOK_SLOTS overrides). It is a property of the machine, not of the moment, so concurrent hooks agree.
const SLOT_BUSY = 199;
const SLOT_MARKER = "__scrml_test_sharded_slot_acquired__";

function totalMemoryBytes(): number {
  try {
    const m = /^MemTotal:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
    if (m) return Number(m[1]) * 1024;
  } catch {
    /* not Linux */
  }
  return totalmem();
}

function slotBudget(memMb: number): { count: number; dir: string; flock: string; why: string } | null {
  const flock = Bun.which("flock");
  if (!flock) return null;
  const dir = join(dirname(timingsPath()), "hook-slots");
  mkdirSync(dir, { recursive: true });
  const env = process.env.SCRML_HOOK_SLOTS;
  if (env !== undefined && env !== "") return { count: parseShardCount(env, "SCRML_HOOK_SLOTS"), dir, flock, why: "SCRML_HOOK_SLOTS" };
  const cores = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  const totalMb = Math.floor(totalMemoryBytes() / MB);
  const byMem = Math.floor((totalMb * 0.8) / memMb);
  const count = Math.max(1, Math.min(Math.floor(cores / 2), byMem));
  return { count, dir, flock, why: `cores ${cores} -> ${Math.floor(cores / 2)}; ${totalMb} MB total x 0.8 / ${memMb} per shard -> ${byMem}` };
}

function parseShardCount(raw: string, from: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`test-sharded: ${from} must be a positive integer, got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return n;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { bail: false, shards: 0, verbose: false, plan: false, timeoutS: 0, memMb: 0, slotWaitS: 0, passthrough: [], paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bail") o.bail = true;
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--plan") o.plan = true;
    else if (a.startsWith("--shards=")) o.shards = parseShardCount(a.slice("--shards=".length), "--shards");
    else if (a === "--shards") o.shards = parseShardCount(argv[++i] ?? "", "--shards");
    else if (a.startsWith("--shard-timeout=")) o.timeoutS = parsePositive(a.slice("--shard-timeout=".length), "--shard-timeout", MAX_SECONDS);
    else if (a.startsWith("--slot-wait=")) o.slotWaitS = parsePositive(a.slice("--slot-wait=".length), "--slot-wait", MAX_SECONDS);
    else if (a.startsWith("--shard-mem=")) o.memMb = parsePositive(a.slice("--shard-mem=".length), "--shard-mem");
    else if (a.startsWith("-")) o.passthrough.push(a);
    else o.paths.push(a);
  }
  if (o.timeoutS === 0) o.timeoutS = envNumber("SCRML_HOOK_SHARD_TIMEOUT_S", 1200, MAX_SECONDS);
  if (o.slotWaitS === 0) o.slotWaitS = envNumber("SCRML_HOOK_SLOT_WAIT_S", 1800, MAX_SECONDS);
  if (o.memMb === 0) o.memMb = envNumber("SCRML_HOOK_SHARD_MEM_MB", 3072);
  o.shardsWhy = "explicit";
  if (o.shards === 0) {
    const env = process.env.SCRML_HOOK_SHARDS;
    if (env !== undefined && env !== "") {
      o.shards = parseShardCount(env, "SCRML_HOOK_SHARDS");
      o.shardsWhy = "SCRML_HOOK_SHARDS";
    } else {
      const d = defaultShards(o.memMb);
      o.shards = d.n;
      o.shardsWhy = d.why;
      // Memory-derived N=1 happens only when memory is already short, and then the WHOLE suite is one shard: the
      // per-shard ceiling (sized for 1/Nth of the suite) would false-red it (sequential peaks ~2.8 GB). Lift it to
      // twice the configured value — still a bound against a runaway, no longer a trap for the normal run.
      if (d.n === 1) {
        o.memMb *= 2;
        o.shardsWhy += `; N=1 -> ceiling lifted to ${o.memMb} MB`;
      }
    }
  }
  if (o.paths.length === 0) {
    console.error("test-sharded: no test paths given (e.g. compiler/tests/unit)");
    process.exit(2);
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// File enumeration
// ---------------------------------------------------------------------------------------------------------------
function collect(abs: string, out: Set<string>): void {
  const st = statSync(abs);
  if (st.isFile()) {
    out.add(abs);
    return;
  }
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const p = join(abs, ent.name);
    if (ent.isDirectory()) collect(p, out);
    else if (ent.isFile() && TEST_FILE.test(ent.name)) out.add(p);
  }
}

function enumerate(paths: string[]): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    const abs = resolve(REPO_ROOT, p);
    if (!existsSync(abs)) {
      console.error(`test-sharded: path does not exist: ${p}`);
      process.exit(2);
    }
    collect(abs, set);
  }
  return [...set].map((f) => relative(REPO_ROOT, f).split(sep).join("/")).sort();
}

// ---------------------------------------------------------------------------------------------------------------
// Timing cache
// ---------------------------------------------------------------------------------------------------------------
type Timings = Record<string, number>;

function timingsPath(): string {
  if (process.env.SCRML_TEST_TIMINGS) return process.env.SCRML_TEST_TIMINGS;
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache"), "scrml", "test-timings.json");
}

function loadTimings(): Timings {
  try {
    const raw = JSON.parse(readFileSync(timingsPath(), "utf8"));
    return raw && typeof raw === "object" && raw.files && typeof raw.files === "object" ? raw.files : {};
  } catch {
    return {};
  }
}

function saveTimings(measured: Timings): void {
  if (Object.keys(measured).length === 0) return;
  const path = timingsPath();
  try {
    const files = loadTimings(); // re-read: another worktree may have written since we loaded
    for (const [f, t] of Object.entries(measured)) {
      const prev = files[f];
      files[f] = typeof prev === "number" && prev > 0 ? 0.5 * prev + 0.5 * t : t;
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, files }, null, 0));
    renameSync(tmp, path);
  } catch (e) {
    console.error(`test-sharded: could not write timing cache ${path}: ${(e as Error).message}`);
  }
}

// Per-file `time` (seconds) of every top-level <testsuite> in a bun junit report. The report is bun's own
// fixed-format output, so a line scan is sufficient; nested suites (describe blocks) are skipped.
function parseJunitFileTimes(xml: string): Timings {
  const out: Timings = {};
  for (const line of xml.split("\n")) {
    if (!line.startsWith("  <testsuite ")) continue;
    const file = /\bfile="([^"]*)"/.exec(line)?.[1];
    const time = /\btime="([0-9.eE+-]+)"/.exec(line)?.[1];
    if (file && time !== undefined && Number.isFinite(Number(time))) out[file] = Number(time);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------------------------
interface Shard {
  index: number;
  files: string[];
  estimate: number;
}

function estimates(files: string[], timings: Timings): Map<string, number> {
  const sizes = new Map(files.map((f) => [f, Math.max(1, statSync(join(REPO_ROOT, f)).size)]));
  const ratios = files
    .filter((f) => typeof timings[f] === "number" && timings[f] > 0)
    .map((f) => timings[f] / sizes.get(f)!)
    .sort((a, b) => a - b);
  // No measurements at all: plain size (units do not matter, only proportions do).
  const perByte = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 1;
  return new Map(files.map((f) => [f, typeof timings[f] === "number" && timings[f] > 0 ? timings[f] : sizes.get(f)! * perByte]));
}

function plan(files: string[], n: number, timings: Timings): Shard[] {
  const count = Math.max(1, Math.min(n, files.length));
  const shards: Shard[] = Array.from({ length: count }, (_, index) => ({ index, files: [], estimate: 0 }));
  const est = estimates(files, timings);
  const pinned = new Set(SERIAL_PINS.map((p) => p.file));
  for (const f of files) {
    if (!pinned.has(f)) continue;
    shards[0].files.push(f);
    shards[0].estimate += est.get(f)!;
  }
  // Longest-processing-time-first; ties broken by path so the same inputs give the same plan.
  const rest = files.filter((f) => !pinned.has(f)).sort((a, b) => est.get(b)! - est.get(a)! || (a < b ? -1 : 1));
  for (const f of rest) {
    let best = shards[0];
    for (const s of shards) if (s.estimate < best.estimate) best = s;
    best.files.push(f);
    best.estimate += est.get(f)!;
  }
  for (const s of shards) s.files.sort();
  return shards;
}

// ---------------------------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------------------------
interface Counts {
  pass: number;
  fail: number;
  skip: number;
  todo: number;
  expects: number;
  tests: number;
  files: number;
}

interface ShardResult {
  shard: Shard;
  exitCode: number | null;
  output: string[];
  counts: Counts | null; // null when bun printed no summary (bail-out, crash, killed)
  failLines: string[];
  // How the shard ended. "stopped" = this runner stopped it because ANOTHER shard failed under --bail (not a
  // failure of its own). Every other non-"ok" outcome fails the run — including "signal": a shard killed by
  // something other than this runner (the kernel OOM killer, a stray kill) has no summary and must never pass.
  outcome: "ok" | "failed" | "stopped" | "timeout" | "memory" | "signal" | "noslot";
  lastFile: string | null; // the last file header bun printed — the file a killed shard was most likely in
  peakRssMb: number;
  seconds: number;
}

function parseCounts(lines: string[]): Counts | null {
  const c: Counts = { pass: 0, fail: 0, skip: 0, todo: 0, expects: 0, tests: 0, files: 0 };
  let sawSummary = false;
  for (const line of lines) {
    let m = /^\s*(\d+) (pass|fail|skip|todo)$/.exec(line);
    if (m) {
      c[m[2] as "pass" | "fail" | "skip" | "todo"] = Number(m[1]);
      continue;
    }
    m = /^\s*(\d+) expect\(\) calls?$/.exec(line);
    if (m) {
      c.expects = Number(m[1]);
      continue;
    }
    m = /^Ran (\d+) tests? across (\d+) files?\./.exec(line);
    if (m) {
      c.tests = Number(m[1]);
      c.files = Number(m[2]);
      sawSummary = true;
    }
  }
  // "Ran N tests across M files." is also printed on a bail-out, without the pass/fail lines; only a run
  // that printed the pass line finished normally.
  return sawSummary && lines.some((l) => /^\s*\d+ pass$/.test(l)) ? c : null;
}

// bun prints, per file that produced output, a `<path>:` header followed by that file's console output and its
// failures. The failure report is every file section that contains a `(fail)` line (its last REPORT_TAIL lines —
// the error and stack sit just above the `(fail)` line), plus bun's closing summary. A shard that died without a
// `(fail)` line (a crash, an error outside any test) gets its last REPORT_TAIL lines instead.
const REPORT_TAIL = 150;
const FILE_HEADER = /^\S.*(\.test|_test|\.spec|_spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts):$/;
const SUMMARY_LINE = /^\s*\d+ (pass|fail|skip|todo|expect\(\) calls?)$|^Ran \d+ tests? across|^Bailed out after/;

function failureReport(output: string[]): string[] {
  const sections: string[][] = [];
  let cur: string[] = [];
  for (const line of output) {
    if (/^bun test v\d/.test(line)) continue;
    if (FILE_HEADER.test(line)) {
      sections.push(cur);
      cur = [];
    }
    cur.push(line);
  }
  sections.push(cur);
  const out: string[] = [];
  const failing = sections.filter((s) => s.some((l) => l.startsWith("(fail) ")));
  const clip = (lines: string[]) =>
    lines.length > REPORT_TAIL ? [`  … ${lines.length - REPORT_TAIL} earlier line(s) in the full log …`, ...lines.slice(-REPORT_TAIL)] : lines;
  if (failing.length === 0) return clip(output.filter((l) => !/^bun test v\d/.test(l)));
  for (const s of failing) {
    const body = s.filter((l) => !SUMMARY_LINE.test(l));
    out.push(...(FILE_HEADER.test(body[0] ?? "") ? [body[0], ...clip(body.slice(1))] : clip(body)));
  }
  out.push("", ...output.filter((l) => SUMMARY_LINE.test(l)));
  return out;
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, nl).replace(/\r$/, ""));
      buf = buf.slice(nl + 1);
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) onLine(buf);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const files = enumerate(opts.paths);
  if (files.length === 0) {
    console.error("test-sharded: no test files under the given paths");
    process.exit(2);
  }
  const shards = plan(files, opts.shards, loadTimings());

  if (opts.plan) {
    for (const s of shards) {
      console.log(`shard ${s.index}: ${s.files.length} files, est ${s.estimate.toFixed(1)}`);
      for (const f of s.files) console.log(`  ${f}`);
    }
    return;
  }

  // Per-run scratch (junit reports; the full output of a failing shard). Under the user cache dir, not
  // $TMPDIR — a failing run keeps its logs for reading, and /tmp must not accumulate them (S448). Runs older
  // than a day are pruned here.
  const runsDir = join(dirname(timingsPath()), "test-sharded-runs");
  mkdirSync(runsDir, { recursive: true });
  for (const name of readdirSync(runsDir)) {
    try {
      if (Date.now() - statSync(join(runsDir, name)).mtimeMs > 24 * 60 * 60 * 1000) rmSync(join(runsDir, name), { recursive: true, force: true });
    } catch {
      /* raced with another run's prune */
    }
  }
  const workDir = mkdtempSync(join(runsDir, `${process.pid}-`));
  const started = Date.now();
  console.log(
    `test-sharded: ${files.length} files in ${shards.length} shard(s)` +
      `${opts.bail ? " (--bail)" : ""} [N: ${opts.shardsWhy}]; timeout ${opts.timeoutS}s, ceiling ${opts.memMb} MB per shard;` +
      ` SCRML_HOOK_SHARDS=1 for the single-process run`,
  );

  const timeoutBin = Bun.which("timeout"); // coreutils backstop; absent on macOS — the runner's own timer remains
  const groups = new Map<number, number>(); // shard index -> pgid (== the spawned leader's pid, via setsid)
  const procs = new Map<number, ReturnType<typeof spawn>>();
  const stopReason = new Map<number, "stopped" | "timeout" | "memory">();
  const peakRss = new Map<number, number>();
  let peakTotalRss = 0;
  let bailedBy: number | null = null;

  const killGroup = (index: number, sig: NodeJS.Signals) => {
    const pgid = groups.get(index);
    if (pgid === undefined) return;
    try {
      process.kill(-pgid, sig);
    } catch {
      /* group already gone */
    }
  };
  // Stop a shard: SIGTERM, then SIGKILL 5s later if anything in the group is still alive.
  const stop = (index: number, why: "stopped" | "timeout" | "memory", sig: NodeJS.Signals = "SIGTERM") => {
    if (!stopReason.has(index)) stopReason.set(index, why);
    killGroup(index, sig);
    if (sig !== "SIGKILL") setTimeout(() => killGroup(index, "SIGKILL"), 5000).unref();
  };
  const running = (index: number) => {
    const p = procs.get(index);
    return p !== undefined && p.exitCode === null && p.signalCode === null;
  };
  const stopOthers = (except: number) => {
    for (const i of procs.keys()) if (i !== except && running(i) && !stopReason.has(i)) stop(i, "stopped");
  };
  const bail = (index: number) => {
    if (opts.bail && bailedBy === null) {
      bailedBy = index;
      stopOthers(index);
    }
  };
  // The runner itself interrupted (Ctrl-C on the hook, a killed terminal): take every shard down with it.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      for (const i of groups.keys()) killGroup(i, "SIGKILL");
      console.error(`\ntest-sharded: interrupted by ${sig}; every shard killed.`);
      process.exit(130);
    });
  }

  // Memory sampler (Linux): every second, sum VmRSS over each shard's process group; a group over the ceiling is
  // killed. Also the measurement source for the per-shard peak column.
  const sampleMemory = () => {
    let names: string[];
    try {
      names = readdirSync("/proc");
    } catch {
      return; // no /proc: ceiling not enforceable here
    }
    const byGroup = new Map<number, number>();
    const wanted = new Set(groups.values());
    for (const name of names) {
      const c0 = name.charCodeAt(0);
      if (c0 < 48 || c0 > 57) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        const pgrp = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
        if (!wanted.has(pgrp)) continue;
        const kb = Number(/^VmRSS:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${name}/status`, "utf8"))?.[1] ?? 0);
        byGroup.set(pgrp, (byGroup.get(pgrp) ?? 0) + kb * 1024);
      } catch {
        /* process exited between readdir and read */
      }
    }
    let total = 0;
    for (const [index, pgid] of groups) {
      if (!running(index)) continue;
      const mb = (byGroup.get(pgid) ?? 0) / MB;
      total += mb;
      if (mb > (peakRss.get(index) ?? 0)) peakRss.set(index, mb);
      if (mb > opts.memMb && !stopReason.has(index)) {
        console.log(`[s${index}] MEMORY CEILING: ${mb.toFixed(0)} MB > ${opts.memMb} MB — killing shard ${index}`);
        stop(index, "memory", "SIGKILL");
        bail(index);
      }
    }
    if (total > peakTotalRss) peakTotalRss = total;
  };
  const sampler = setInterval(sampleMemory, 1000);

  const slots = slotBudget(envNumber("SCRML_HOOK_SHARD_MEM_MB", 3072)); // the configured ceiling, not an N=1 lift: every hook on the host must agree
  if (slots === null) console.log("test-sharded: no `flock` on PATH — machine-wide slot budget NOT enforced on this host");
  else console.log(`test-sharded: machine-wide budget ${slots.count} concurrent shard(s) across every hook on this host [${slots.why}]`);
  const neverStarted = (shard: Shard, outcome: "stopped" | "noslot"): ShardResult => {
    if (outcome === "noslot") {
      console.log(`[s${shard.index}] NO SLOT: every machine-wide slot stayed busy for ${opts.slotWaitS}s — shard ${shard.index} never started`);
      bail(shard.index);
    }
    return { shard, exitCode: null, output: [], counts: null, failLines: [], outcome, lastFile: null, peakRssMb: 0, seconds: 0 };
  };

  const results = await Promise.all(
    shards.map(async (shard): Promise<ShardResult> => {
      const junit = join(workDir, `shard-${shard.index}.xml`);
      const t0 = Date.now();
      const testCmd = [
        process.execPath,
        "test",
        ...(opts.bail ? ["--bail"] : []),
        ...opts.passthrough,
        "--reporter=junit",
        `--reporter-outfile=${junit}`,
        ...shard.files.map((f) => `./${f}`),
      ];
      // The coreutils `timeout` backstop goes OUTERMOST: without --foreground it calls setpgid(0, 0), so anywhere
      // but the group leader it would move bun into a group of its own — out of reach of the group kill and the
      // memory sampler. As the detached leader that call is a no-op and flock / sh / bun stay in the shard's group.
      const bound = (inner: string[]) => (timeoutBin ? [timeoutBin, "--kill-after=10", `${Math.ceil(opts.timeoutS) + 60}`, ...inner] : inner);
      // Machine-wide slot: `flock -n -E 199 <slot-file> sh -c 'echo MARKER; exec "$@"' sh <cmd>` takes the slot
      // atomically and starts the shard only if it was free; busy -> exit 199 at once, nothing printed. The marker
      // line (filtered out of the output) says the slot was taken — no timing guess. The lock lives on flock's fd and
      // dies with the shard's process group, so a killed runner never leaks a slot. Slots are tried from a
      // per-shard offset; when every one is busy the shard waits (bounded by slot-wait) instead of oversubscribing.
      const output: string[] = [];
      const failLines: string[] = [];
      let lastFile: string | null = null;
      let onAcquired: () => void = () => {};
      const onLine = (line: string) => {
        if (line === SLOT_MARKER) return onAcquired();
        output.push(line);
        if (FILE_HEADER.test(line)) lastFile = line.slice(0, -1);
        if (opts.verbose) console.log(`[s${shard.index}] ${line}`);
        if (line.startsWith("(fail) ")) {
          failLines.push(line);
          if (!opts.verbose) console.log(`[s${shard.index}] ${line}`);
          if (!stopReason.has(shard.index)) bail(shard.index);
        }
      };
      const spawnOpts = { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env, detached: true } as const;
      const pumpAll = (p: ReturnType<typeof spawn>) =>
        Promise.all([pump(p.stdout as ReadableStream<Uint8Array>, onLine), pump(p.stderr as ReadableStream<Uint8Array>, onLine)]);
      let proc: ReturnType<typeof spawn>;
      let pumped: Promise<unknown>;
      let slotWaitAnnounced = false;
      for (let attempt = 0; ; attempt++) {
        if (bailedBy !== null) return neverStarted(shard, "stopped");
        if (slots === null) {
          proc = spawn(bound(testCmd), spawnOpts);
          pumped = pumpAll(proc);
          break;
        }
        const slot = (shard.index + attempt + process.pid) % slots.count;
        const p = spawn(
          bound([slots.flock, "-n", "-E", String(SLOT_BUSY), join(slots.dir, `slot-${slot}`), "sh", "-c", `echo ${SLOT_MARKER}; exec "$@"`, "sh", ...testCmd]),
          spawnOpts,
        );
        const acquired = new Promise<"acquired">((res) => (onAcquired = () => res("acquired")));
        const pp = pumpAll(p);
        const first = await Promise.race([acquired, p.exited]);
        if (first === SLOT_BUSY) {
          await pp;
          if ((attempt + 1) % slots.count === 0) {
            if ((Date.now() - t0) / 1000 > opts.slotWaitS) return neverStarted(shard, "noslot");
            if (!slotWaitAnnounced) {
              console.log(`[s${shard.index}] waiting for a machine-wide test slot (all ${slots.count} busy; bounded at ${opts.slotWaitS}s)`);
              slotWaitAnnounced = true;
            }
            await Bun.sleep(1000 + Math.floor(Math.random() * 1000));
          }
          continue;
        }
        proc = p; // acquired — or flock itself failed, which surfaces as this shard's failure with its output
        pumped = pp;
        break;
      }
      if (slotWaitAnnounced) console.log(`[s${shard.index}] got a slot after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      const tRun = Date.now();
      procs.set(shard.index, proc);
      groups.set(shard.index, proc.pid);
      const timer = setTimeout(() => {
        console.log(`[s${shard.index}] TIMEOUT: still running after ${opts.timeoutS}s — killing shard ${shard.index}`);
        stop(shard.index, "timeout", "SIGKILL");
        bail(shard.index);
      }, opts.timeoutS * 1000);
      await pumped;
      const exitCode = await proc.exited;
      clearTimeout(timer);
      // Anything the shard's tests left running in its group (a server a test never stopped) dies with it.
      killGroup(shard.index, "SIGKILL");
      const seconds = (Date.now() - tRun) / 1000;
      const counts = parseCounts(output);
      const signalled = (proc.signalCode !== null && proc.signalCode !== undefined) || (timeoutBin !== null && (exitCode === 124 || exitCode === 137));
      const ours = stopReason.get(shard.index);
      let outcome: ShardResult["outcome"];
      if (ours === "timeout" || ours === "memory") outcome = ours;
      else if (exitCode === 0 && !signalled) outcome = "ok";
      else if (ours === "stopped" && failLines.length === 0) outcome = "stopped";
      else if (signalled && failLines.length === 0) outcome = timeoutBin !== null && exitCode === 124 ? "timeout" : "signal";
      else outcome = "failed";
      // A shard that failed without printing a (fail) line (crash, error outside any test) still bails the run.
      if (outcome !== "ok" && outcome !== "stopped") bail(shard.index);
      if (!opts.verbose) {
        const status = outcome === "ok" ? "ok" : outcome === "stopped" ? "stopped" : `${outcome.toUpperCase()} (exit ${exitCode})`;
        const c = counts ? `${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip` : "no summary";
        console.log(`[s${shard.index}] ${status}: ${shard.files.length} files, ${c}, ${seconds.toFixed(1)}s`);
      }
      let measured: Timings = {};
      try {
        measured = parseJunitFileTimes(readFileSync(junit, "utf8"));
      } catch {
        /* killed / bailed before the report was written */
      }
      saveTimings(measured);
      return { shard, exitCode, output, counts, failLines, outcome, lastFile, peakRssMb: peakRss.get(shard.index) ?? 0, seconds };
    }),
  );
  clearInterval(sampler);
  // ----- report -----
  const failed = results.filter((r) => r.outcome !== "ok" && r.outcome !== "stopped");
  for (const r of failed) {
    // Keep the shard's full output on disk; print only the part that explains the failure.
    const log = join(workDir, `shard-${r.shard.index}.log`);
    writeFileSync(log, r.output.join("\n") + "\n");
    const head =
      r.outcome === "timeout"
        ? `TIMED OUT (limit ${opts.timeoutS}s; killed after ${r.seconds.toFixed(0)}s)`
        : r.outcome === "memory"
          ? `KILLED AT THE MEMORY CEILING (${opts.memMb} MB; peak ${r.peakRssMb.toFixed(0)} MB)`
          : r.outcome === "noslot"
            ? `NEVER STARTED: no machine-wide test slot within ${opts.slotWaitS}s (other hooks held all of them)`
            : r.outcome === "signal"
            ? `KILLED BY A SIGNAL THIS RUNNER DID NOT SEND (exit ${r.exitCode}; OOM killer?)`
              : `FAILED (exit ${r.exitCode})`;
    console.log(`\n===== shard ${r.shard.index} ${head} — failure report; full output: ${log} =====`);
    if (r.outcome !== "failed") {
      console.log(`last file header printed: ${r.lastFile ?? "(none)"}`);
      console.log(`assigned files (${r.shard.files.length}):`);
      for (const f of r.shard.files) console.log(`  ${f}`);
      console.log("last output:");
    }
    for (const line of failureReport(r.output)) console.log(line);
  }
  if (failed.length === 0) rmSync(workDir, { recursive: true, force: true });

  // Integrity: every shard that ran to completion must report exactly the files it was given. A shortfall
  // means a file was silently not run — that would make the totals lie.
  const integrity: string[] = [];
  for (const r of results) {
    if (r.counts && r.counts.files !== r.shard.files.length) {
      integrity.push(`shard ${r.shard.index}: bun ran ${r.counts.files} files, ${r.shard.files.length} were assigned`);
    }
    if (r.outcome === "ok" && !r.counts) {
      integrity.push(`shard ${r.shard.index}: exited 0 but printed no test summary`);
    }
  }

  const total: Counts = { pass: 0, fail: 0, skip: 0, todo: 0, expects: 0, tests: 0, files: 0 };
  console.log("\nshard  files   pass  fail  skip  todo  seconds  peakMB");
  for (const r of results) {
    const c = r.counts;
    const state =
      r.outcome === "stopped"
        ? "  (stopped by --bail)"
        : r.outcome === "ok" || r.outcome === "failed"
          ? c
            ? ""
            : `  (no summary, exit ${r.exitCode})`
          : `  (${r.outcome.toUpperCase()})`;
    console.log(
      `${String(r.shard.index).padStart(5)}  ${String(r.shard.files.length).padStart(5)}  ` +
        (c
          ? `${String(c.pass).padStart(5)} ${String(c.fail).padStart(5)} ${String(c.skip).padStart(5)} ${String(c.todo).padStart(5)}`
          : "    -     -     -     -") +
        `  ${r.seconds.toFixed(1).padStart(7)}  ${r.peakRssMb.toFixed(0).padStart(6)}${state}`,
    );
    if (c) for (const k of Object.keys(total) as (keyof Counts)[]) total[k] += c[k];
  }
  const complete = results.every((r) => r.counts !== null);
  const wall = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${complete ? "TOTAL" : "PARTIAL TOTAL (not every shard finished)"}: ` +
      `${total.pass} pass, ${total.fail} fail, ${total.skip} skip, ${total.todo} todo, ` +
      `${total.expects} expect() calls; ran ${total.tests} tests across ${total.files} files in ${wall}s wall`,
  );
  console.log(`peak RSS, all shards together: ${peakTotalRss.toFixed(0)} MB (ceiling ${opts.memMb} MB per shard; timeout ${opts.timeoutS}s per shard)`);

  if (integrity.length > 0) {
    console.log("\nINTEGRITY ERROR:");
    for (const m of integrity) console.log(`  ${m}`);
  }
  if (bailedBy !== null) console.log(`\nBailed out: first failure in shard ${bailedBy}; other shards stopped.`);
  if (failed.length > 0) console.log(`\nFAILED shard(s): ${failed.map((r) => `${r.shard.index} (${r.outcome})`).join(", ")}`);
  process.exit(failed.length > 0 || integrity.length > 0 || bailedBy !== null ? 1 : 0);
}

await main();
