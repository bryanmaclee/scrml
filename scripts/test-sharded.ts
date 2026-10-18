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
//   --shards=N  shard count. Precedence: --shards, then $SCRML_HOOK_SHARDS, then min(floor(cores/2), 8).
//               N=1 runs one `bun test` process over the same file list (no parallelism).
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
// SERIAL PINS. A file listed in SERIAL_PINS below is assigned to shard 0 together with every other pinned file,
// so pinned files never run concurrently with EACH OTHER. Use it only for tests that genuinely share an external
// resource between files and cannot be isolated (per-process temp roots, port 0) — never as a way to skip.

import { spawn } from "bun";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from "fs";
import { availableParallelism, cpus, homedir } from "os";
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
  passthrough: string[];
  paths: string[];
}

function defaultShards(): number {
  const cores = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(Math.floor(cores / 2), 8));
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
  const o: Options = { bail: false, shards: 0, verbose: false, plan: false, passthrough: [], paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bail") o.bail = true;
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--plan") o.plan = true;
    else if (a.startsWith("--shards=")) o.shards = parseShardCount(a.slice("--shards=".length), "--shards");
    else if (a === "--shards") o.shards = parseShardCount(argv[++i] ?? "", "--shards");
    else if (a.startsWith("-")) o.passthrough.push(a);
    else o.paths.push(a);
  }
  if (o.shards === 0) {
    const env = process.env.SCRML_HOOK_SHARDS;
    o.shards = env !== undefined && env !== "" ? parseShardCount(env, "SCRML_HOOK_SHARDS") : defaultShards();
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
  killed: boolean;
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
      `${opts.bail ? " (--bail)" : ""}; set SCRML_HOOK_SHARDS=1 for the single-process run`,
  );

  const procs = new Map<number, ReturnType<typeof spawn>>();
  let bailedBy: number | null = null;

  const stopOthers = (except: number) => {
    for (const [i, p] of procs) if (i !== except && p.exitCode === null) p.kill("SIGTERM");
  };

  const results = await Promise.all(
    shards.map(async (shard): Promise<ShardResult> => {
      const junit = join(workDir, `shard-${shard.index}.xml`);
      const t0 = Date.now();
      const proc = spawn(
        [
          process.execPath,
          "test",
          ...(opts.bail ? ["--bail"] : []),
          ...opts.passthrough,
          "--reporter=junit",
          `--reporter-outfile=${junit}`,
          ...shard.files.map((f) => `./${f}`),
        ],
        { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env },
      );
      procs.set(shard.index, proc);
      const output: string[] = [];
      const failLines: string[] = [];
      const onLine = (line: string) => {
        output.push(line);
        if (opts.verbose) console.log(`[s${shard.index}] ${line}`);
        if (line.startsWith("(fail) ")) {
          failLines.push(line);
          if (!opts.verbose) console.log(`[s${shard.index}] ${line}`);
          if (opts.bail && bailedBy === null) {
            bailedBy = shard.index;
            stopOthers(shard.index);
          }
        }
      };
      await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>, onLine), pump(proc.stderr as ReadableStream<Uint8Array>, onLine)]);
      const exitCode = await proc.exited;
      const killed = proc.signalCode !== null && proc.signalCode !== undefined;
      const seconds = (Date.now() - t0) / 1000;
      const counts = parseCounts(output);
      // A shard that failed without printing a (fail) line (crash, error outside any test) still bails the run.
      if (opts.bail && exitCode !== 0 && !killed && bailedBy === null) {
        bailedBy = shard.index;
        stopOthers(shard.index);
      }
      if (!opts.verbose) {
        const status = killed ? "stopped" : exitCode === 0 ? "ok" : `FAILED (exit ${exitCode})`;
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
      return { shard, exitCode, output, counts, failLines, killed, seconds };
    }),
  );
  // ----- report -----
  const failed = results.filter((r) => !r.killed && r.exitCode !== 0);
  for (const r of failed) {
    // Keep the shard's full output on disk; print only the part that explains the failure.
    const log = join(workDir, `shard-${r.shard.index}.log`);
    writeFileSync(log, r.output.join("\n") + "\n");
    console.log(`\n===== shard ${r.shard.index} (exit ${r.exitCode}) — failure report; full output: ${log} =====`);
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
    if (!r.killed && r.exitCode === 0 && !r.counts) {
      integrity.push(`shard ${r.shard.index}: exited 0 but printed no test summary`);
    }
  }

  const total: Counts = { pass: 0, fail: 0, skip: 0, todo: 0, expects: 0, tests: 0, files: 0 };
  console.log("\nshard  files   pass  fail  skip  todo  seconds");
  for (const r of results) {
    const c = r.counts;
    const state = r.killed ? "  (stopped by --bail)" : c ? "" : `  (no summary, exit ${r.exitCode})`;
    console.log(
      `${String(r.shard.index).padStart(5)}  ${String(r.shard.files.length).padStart(5)}  ` +
        (c
          ? `${String(c.pass).padStart(5)} ${String(c.fail).padStart(5)} ${String(c.skip).padStart(5)} ${String(c.todo).padStart(5)}`
          : "    -     -     -     -") +
        `  ${r.seconds.toFixed(1).padStart(7)}${state}`,
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

  if (integrity.length > 0) {
    console.log("\nINTEGRITY ERROR:");
    for (const m of integrity) console.log(`  ${m}`);
  }
  if (bailedBy !== null) console.log(`\nBailed out: first failure in shard ${bailedBy}; other shards stopped.`);
  process.exit(failed.length > 0 || integrity.length > 0 || bailedBy !== null ? 1 : 0);
}

await main();
