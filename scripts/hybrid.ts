#!/usr/bin/env bun
/**
 * hybrid.ts — the HYBRID-COMPILER harness. change-id: s430-stage-swap.
 *
 * ═══ THE RULING THIS IMPLEMENTS (bryan S430, P5) ═══
 *
 * A bootstrap module is DONE when a HYBRID compiler — the TS pipeline with that ONE stage swapped
 * for the bootstrap build of it — passes the full conformance suite. A corpus artifact
 * differential against pure TS runs as TRIAGE: each divergence is classified TS-bug /
 * bootstrap-bug / spec-gap. It is NOT a gate. "It compiles" is NOT a gate.
 *
 * ⚑ NARROWED S437 (bryan: "a, freeze self-host" — dpa-051 R1). The bootstrap keeps the S233
 * four-phase re-cut, whose IRs are not impl#1's decorated FileAST, so a single-stage swap exists
 * only at the LEX seam (tokens) and for the whole compiler. For every other bootstrap module, done =
 * its conformance footprint. `compiler/self-host/` (what this harness swaps in today) is FROZEN.
 *
 * ═══ USAGE ═══
 *
 *   bun scripts/hybrid.ts --list
 *       print every substitutable stage: name, PIPELINE.md locus, entry export, signature.
 *
 *   bun scripts/hybrid.ts --swap <STAGE>=<module> [--swap …] --conformance [--filter <substr>]
 *       run the conformance suite through the hybrid (conformance/adapters/hybrid.ts). THE GATE.
 *
 *   bun scripts/hybrid.ts --swap <STAGE>=<module> [--swap …] --differential
 *         [--roots examples,samples,conformance,stdlib,benchmarks] [--files a.scrml,b.scrml]
 *         [--limit N] [--show N] [--json <path>] [--concurrency N]
 *       compile every tracked .scrml under the roots through the hybrid AND pure TS, and print a
 *       divergence report (file, artifact, first diff hunk) with N-of-M totals. TRIAGE, not a gate.
 *
 *   bun scripts/hybrid.ts --swap CG=<module> --footprint [--filter <substr>] [--only a,b] [--report <path.md>] [--json <path>]
 *       FOOTPRINT GRADING (dpa-051 §8.2; s439-bootstrap-m3-ingest). The substitute exports
 *       `footprint(cgArgs) -> { constructs, notYet }`; each case is classified GRADED (footprint
 *       within the implemented set) / NOT-YET (never red) / FRONT-END (a rejected program — its
 *       codes are not the substitute's); the graded cases then run through the conformance path
 *       above. Prints the table (N of M totals). Exit 1 iff a GRADED case fails.
 *
 *   Both --conformance and --differential may be given; conformance runs first.
 *
 *   A substitute may also export `executeClient({ html, clientJs })`: the runtime half then hands
 *   execution of the artifact to it (conformance/adapters/impl1-ts.ts `setClientExecutor`).
 *
 * <module> is LOCATION-AGNOSTIC — where the bootstrap lives (`stdlib/compiler/**` vs
 * `compiler/self-host/`) is unsettled, so the runner takes any path:
 *   - a `.js` / `.ts` / `.mjs` path: imported directly; must export the stage's entry (see --list)
 *     or a default function.
 *   - a `.scrml` path: compiled FIRST by the pure TS compiler in library mode to a temp dir (in a
 *     child process, so the hybrid process keeps a pure compile history), then
 *     the emitted `<base>.js` is imported. A compile failure is reported loud (exit 2) — it is not
 *     a hybrid result.
 *   - the literal `ts`: the TS stage itself, routed THROUGH the seam (validated). This is the
 *     calibration mode: `--swap all=ts` routes every stage through its own contract check.
 *
 * Every substituted stage's output is checked against its stage contract at the boundary
 * (compiler/src/pipeline-seam.ts); a violation aborts that compile with `StageSeamError` naming
 * the stage and the first divergent path.
 *
 * ═══ EXIT CODES ═══
 *   0  every requested run is green (conformance: all cases pass; differential: N of N identical)
 *   1  a requested run is red (a conformance case failed, or the differential found divergences)
 *   2  NOT A VALID RUN — bad invocation, unknown stage, a substitute that failed to load /
 *      compile / lacks its entry export, or an empty source population.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileScrml } from "../compiler/src/api.js";
import { STAGE_SEAMS, StageSeamError, resolveSubstitute, stageSeam } from "../compiler/src/pipeline-seam.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILER_SRC = join(REPO_ROOT, "compiler", "src");

/** The corpus-emit-differential default roots (scripts/corpus-emit-differential.ts DEFAULT_ROOTS). */
export const DEFAULT_ROOTS = ["examples", "samples", "conformance", "stdlib", "benchmarks"];

class InvalidRun extends Error {}

// ---------------------------------------------------------------------------
// Substitute loading
// ---------------------------------------------------------------------------

/**
 * Compile a `.scrml` substitute with the pure TS compiler (library mode) and return its JS path.
 *
 * Runs in a CHILD process, not this one: the TS compiler is not hermetic across compiles in one
 * process (see the note above `runDifferential`), so compiling the substitute here would give the
 * hybrid's first conformance case a different compile history than a pure-TS run's first case.
 */
function compileScrmlSubstitute(scrmlPath: string): string {
  const p = Bun.spawnSync(["bun", fileURLToPath(import.meta.url), "--compile-substitute", scrmlPath], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = p.stdout.toString();
  const m = /^SUBSTITUTE-JS:(.+)$/m.exec(out);
  if (p.exitCode === 0 && m) return m[1];
  const err = p.stderr.toString().replace(/^hybrid: /, "").trim();
  throw new InvalidRun(err || `compiling substitute ${scrmlPath} failed (exit ${p.exitCode})`);
}

/** Child-process body of `compileScrmlSubstitute`. */
function compileScrmlSubstituteInProcess(scrmlPath: string): string {
  const outDir = mkdtempSync(join(tmpdir(), "scrml-hybrid-sub-"));
  const result = compileScrml({
    inputFiles: [scrmlPath],
    outputDir: outDir,
    mode: "library",
    write: true,
    log: () => {},
  }) as { errors?: Array<{ code?: string; message?: string }> };
  const errs = result.errors ?? [];
  if (errs.length > 0) {
    const lines = errs.slice(0, 20).map((e) => `    [${e.code}] ${String(e.message).split("\n")[0]}`);
    throw new InvalidRun(
      `substitute ${scrmlPath} does not compile under pure TS (${errs.length} error(s)) — not a hybrid result:\n${lines.join("\n")}`,
    );
  }
  const want = basename(scrmlPath, ".scrml") + ".js";
  const stack = [outDir];
  while (stack.length) {
    const d = stack.pop() as string;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (e === want) return p;
    }
  }
  throw new InvalidRun(`substitute ${scrmlPath} compiled but emitted no ${want} under ${outDir}`);
}

/**
 * Resolve one `--swap` value to the object handed to `stageOverrides[STAGE]`.
 * `ts` → the TS stage module itself (calibration); otherwise a module path (see header).
 */
export async function loadSubstitute(stage: string, spec: string): Promise<unknown> {
  const seam = stageSeam(stage);
  if (!seam) {
    throw new InvalidRun(`unknown stage ${JSON.stringify(stage)}. Substitutable stages: ${STAGE_SEAMS.map((s) => s.name).join(", ")}`);
  }
  let mod: unknown;
  if (spec === "ts") {
    mod = await import(pathToFileURL(join(COMPILER_SRC, seam.tsModule)).href);
  } else {
    const abs = resolve(spec);
    if (!existsSync(abs)) throw new InvalidRun(`--swap ${stage}=${spec}: no such file ${abs}`);
    const target = extname(abs) === ".scrml" ? compileScrmlSubstitute(abs) : abs;
    try {
      mod = await import(pathToFileURL(target).href);
    } catch (e) {
      throw new InvalidRun(
        `--swap ${stage}=${spec}: the substitute module failed to load (${target}): ${String((e as Error)?.message ?? e).split("\n")[0]}`,
      );
    }
  }
  // Fail at load time, not mid-run, when the module lacks the entry export.
  try {
    resolveSubstitute(stage, mod);
  } catch (e) {
    if (e instanceof StageSeamError) throw new InvalidRun(`--swap ${stage}=${spec}: ${e.message}`);
    throw e;
  }
  return mod;
}

export async function buildStageOverrides(swaps: Array<[string, string]>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [stage, spec] of swaps) {
    const names = stage === "all" ? STAGE_SEAMS.map((s) => s.name) : [stage];
    if (stage === "all" && spec !== "ts") throw new InvalidRun("--swap all=<x> only accepts `ts` (calibration: every stage through its own seam)");
    for (const n of names) {
      if (n in out) throw new InvalidRun(`stage ${n} swapped twice`);
      out[n] = await loadSubstitute(n, spec);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Differential
// ---------------------------------------------------------------------------

/** What one side of the differential produced for one source. */
export interface SideResult {
  crash: string | null;
  seamViolation: string | null;
  /** artifact key -> text. Key: `<output path relative to repo>#<field>` or `#diagnostics`. */
  artifacts: Map<string, string>;
}

function diagLine(d: Record<string, unknown>, stream: string): string {
  const span = d.span as { line?: number; col?: number } | undefined;
  const line = span?.line ?? d.line ?? "";
  const col = span?.col ?? d.column ?? "";
  return `${stream} ${d.code ?? "<no-code>"} ${d.severity ?? ""} ${line}:${col} ${String(d.message ?? "").split("\n")[0]}`;
}

export function compileSide(file: string, stageOverrides: Record<string, unknown> | null): SideResult {
  const artifacts = new Map<string, string>();
  let result: Record<string, unknown>;
  try {
    result = compileScrml({
      inputFiles: [file],
      write: false,
      log: () => {},
      ...(stageOverrides ? { stageOverrides } : {}),
    }) as Record<string, unknown>;
  } catch (e) {
    const cause = (e as { cause?: unknown })?.cause;
    // A substitute that THREW is a crash of that stage (data, compared against the TS side's
    // crash) — only a CONTRACT violation is a seam violation.
    if (e instanceof StageSeamError && cause === undefined) return { crash: null, seamViolation: e.message, artifacts };
    const err = (e instanceof StageSeamError ? cause : e) as Error;
    return { crash: String(err?.message ?? err).split("\n")[0], seamViolation: null, artifacts };
  }
  const diags: string[] = [];
  for (const [stream, key] of [["error", "errors"], ["warning", "warnings"], ["lint", "lintDiagnostics"]] as const) {
    for (const d of (result[key] as Array<Record<string, unknown>> | undefined) ?? []) diags.push(diagLine(d, stream));
  }
  artifacts.set("#diagnostics", diags.join("\n"));
  const outputs = result.outputs as Map<string, Record<string, unknown>> | undefined;
  for (const [outPath, rec] of outputs ?? []) {
    const rel = relative(REPO_ROOT, outPath);
    for (const field of Object.keys(rec).sort()) {
      const v = rec[field];
      if (typeof v === "string") artifacts.set(`${rel}#${field}`, v);
      else if (v instanceof Map) {
        for (const [k, x] of [...v].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
          if (typeof x === "string") artifacts.set(`${rel}#${field}[${k}]`, x);
        }
      }
    }
  }
  return { crash: null, seamViolation: null, artifacts };
}

export type DivergenceKind = "artifact" | "diagnostics" | "artifact-set" | "seam-violation" | "crash-hybrid-only" | "crash-ts-only" | "crash-differs";

export interface Divergence {
  file: string;
  kind: DivergenceKind;
  artifact: string | null;
  hunk: string;
  /** Triage slot — TS-bug / bootstrap-bug / spec-gap. Filled by a human, never by this tool. */
  classification: null;
}

/** The first differing line of two texts, with context, as a -/+ hunk. */
export function firstDiffHunk(a: string, b: string, context = 2, after = 3): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  let i = 0;
  while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
  const lo = Math.max(0, i - context);
  const out: string[] = [`@@ first difference at line ${i + 1} (ts ${al.length} lines, hybrid ${bl.length} lines) @@`];
  for (let k = lo; k < i; k++) out.push(`  ${al[k]}`);
  for (let k = i; k < Math.min(al.length, i + after); k++) out.push(`- ${al[k]}`);
  for (let k = i; k < Math.min(bl.length, i + after); k++) out.push(`+ ${bl[k]}`);
  return out.map((l) => (l.length > 220 ? l.slice(0, 220) + "…" : l)).join("\n");
}

/** Compare one source's two sides. Returns every divergence (one per differing artifact). */
export function compareSides(file: string, ts: SideResult, hy: SideResult): Divergence[] {
  const d = (kind: DivergenceKind, artifact: string | null, hunk: string): Divergence => ({ file, kind, artifact, hunk, classification: null });
  if (hy.seamViolation) return [d("seam-violation", null, hy.seamViolation)];
  if (ts.crash !== null || hy.crash !== null) {
    if (ts.crash === hy.crash) return [];
    if (ts.crash === null) return [d("crash-hybrid-only", null, `hybrid crashed: ${hy.crash}`)];
    if (hy.crash === null) return [d("crash-ts-only", null, `pure TS crashed: ${ts.crash}`)];
    return [d("crash-differs", null, `ts: ${ts.crash}\nhybrid: ${hy.crash}`)];
  }
  const out: Divergence[] = [];
  const keys = new Set([...ts.artifacts.keys(), ...hy.artifacts.keys()]);
  for (const k of [...keys].sort()) {
    const a = ts.artifacts.get(k);
    const b = hy.artifacts.get(k);
    if (a === b) continue;
    if (a === undefined || b === undefined) {
      out.push(d("artifact-set", k, a === undefined ? "present only in HYBRID output" : "present only in pure-TS output"));
      continue;
    }
    out.push(d(k === "#diagnostics" ? "diagnostics" : "artifact", k, firstDiffHunk(a, b)));
  }
  return out;
}

export function listCorpus(roots: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...roots.map((r) => `${r}/*.scrml`)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean).sort();
}

export interface DifferentialReport {
  total: number;
  identical: number;
  bothCrash: number;
  divergentFiles: number;
  byKind: Record<string, number>;
  divergences: Divergence[];
}

/**
 * WHY EACH SIDE RUNS IN ITS OWN PROCESS, OVER THE SAME FILE SEQUENCE.
 *
 * The TS compiler is NOT hermetic across compiles in one process: module-level codegen state
 * survives from one `compileScrml` call into the next (measured at this change's base — compiling
 * `conformance/cases/error/handler-recovery-into-cell/case.scrml` twice in one process emits a
 * `_scrml_cs_init_set("result", …)` line the first time and not the second; the leak is
 * `emit-logic.ts`'s module-level `_structuralDeclNamesForFile`, which function-body emission reads
 * before `emit-reactive-wiring` resets it for the current file). Interleaving pure and hybrid
 * compiles in one process would give the two sides DIFFERENT compile histories and report that
 * leak as a swap-caused divergence — the identity swap came back 4 of 1929 divergent before this
 * design. So: one process per side (per shard), each compiling the SAME files in the SAME order.
 * The two sides' histories then differ only by the swapped stage, which is the thing measured.
 */
export interface DifferentialOptions {
  /** Worker pairs to run in parallel (each pair: one pure-TS process + one hybrid process). */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

function spawnSide(files: string[], swapArgs: string[], outDir: string): Promise<void> {
  const listFile = join(outDir, "files.json");
  writeFileSync(listFile, JSON.stringify(files));
  const proc = Bun.spawn(["bun", fileURLToPath(import.meta.url), "--side-worker", outDir, ...swapArgs], {
    cwd: REPO_ROOT,
    stdout: "ignore",
    stderr: "pipe",
  });
  return proc.exited.then(async (code: number) => {
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new InvalidRun(`differential side worker (${swapArgs.length ? "hybrid" : "pure TS"}) exited ${code}:\n${err.slice(-2000)}`);
    }
  });
}

function readSide(dir: string, i: number): SideResult {
  const raw = JSON.parse(readFileSync(join(dir, `${i}.json`), "utf8")) as { crash: string | null; seamViolation: string | null; artifacts: Array<[string, string]> };
  return { crash: raw.crash, seamViolation: raw.seamViolation, artifacts: new Map(raw.artifacts) };
}

/**
 * Run the differential over `files` (repo-relative). `swaps` are RESOLVED specs: `ts` or a path
 * to an importable module (a `.scrml` substitute must already be compiled — see
 * `resolveSwapSpecs` — so the hybrid process's compile history is not perturbed by it).
 */
export async function runDifferential(files: string[], swaps: Array<[string, string]>, opts: DifferentialOptions = {}): Promise<DifferentialReport> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, files.length));
  const work = mkdtempSync(join(tmpdir(), "scrml-hybrid-diff-"));
  const swapArgs = swaps.flatMap(([st, m]) => ["--swap", `${st}=${m}`]);
  const shards: Array<{ files: string[]; start: number }> = [];
  const per = Math.ceil(files.length / concurrency);
  for (let k = 0; k < concurrency; k++) {
    const part = files.slice(k * per, (k + 1) * per);
    if (part.length) shards.push({ files: part, start: k * per });
  }
  const divergences: Divergence[] = [];
  let identical = 0;
  let bothCrash = 0;
  let divergentFiles = 0;
  let done = 0;
  const byKind: Record<string, number> = {};
  try {
    await Promise.all(
      shards.map(async (sh, k) => {
        const tsDir = join(work, `ts-${k}`);
        const hyDir = join(work, `hy-${k}`);
        mkdirSync(tsDir);
        mkdirSync(hyDir);
        await Promise.all([spawnSide(sh.files, [], tsDir), spawnSide(sh.files, swapArgs, hyDir)]);
        sh.files.forEach((rel, i) => {
          const ds = compareSides(rel, readSide(tsDir, i), readSide(hyDir, i));
          if (ds.length === 0) {
            identical++;
            if (readSide(tsDir, i).crash !== null) bothCrash++;
          } else {
            divergentFiles++;
            for (const x of ds) {
              divergences.push(x);
              byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
            }
          }
        });
        done += sh.files.length;
        opts.onProgress?.(done, files.length);
      }),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // Shards finish in any order; report in corpus order.
  const order = new Map(files.map((f, i) => [f, i]));
  divergences.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0));
  return { total: files.length, identical, bothCrash, divergentFiles, byKind, divergences };
}

/** Child-process body for one differential side: compile each listed file, write `<i>.json`. */
async function sideWorker(outDir: string, swaps: Array<[string, string]>): Promise<void> {
  const files = JSON.parse(readFileSync(join(outDir, "files.json"), "utf8")) as string[];
  const stageOverrides = swaps.length ? await buildStageOverrides(swaps) : null;
  files.forEach((rel, i) => {
    const r = compileSide(resolve(REPO_ROOT, rel), stageOverrides);
    writeFileSync(join(outDir, `${i}.json`), JSON.stringify({ crash: r.crash, seamViolation: r.seamViolation, artifacts: [...r.artifacts] }));
  });
}

/**
 * Resolve `--swap` specs for hand-off to side workers: a `.scrml` substitute is compiled ONCE
 * here (pure TS, library mode) and replaced by the path of its emitted JS.
 */
export function resolveSwapSpecs(swaps: Array<[string, string]>): Array<[string, string]> {
  return swaps.map(([st, m]) => [st, m !== "ts" && extname(m) === ".scrml" ? compileScrmlSubstitute(resolve(m)) : m === "ts" ? m : resolve(m)]);
}

// ---------------------------------------------------------------------------
// Conformance
// ---------------------------------------------------------------------------

export interface ConformanceReport {
  total: number;
  passed: number;
  failures: Array<{ relDir: string; reasons: string[] }>;
  /** Cases carrying an impl1-ts xfail mark that still fail WITH their recorded signature — ok. */
  xfailed: Array<{ relDir: string; gap: string }>;
  /** Cases carrying an impl1-ts xfail mark that PASS through the hybrid. REPORTED, NOT RED (see below). */
  xpassed: Array<{ relDir: string; gap: string }>;
}

/**
 * P5 x P7 (PA ruling S430, consistent with bryan's P5 + P7): a HYBRID is the TS pipeline with one
 * stage swapped, so it still contains TS stages and the impl1-ts xfail marks APPLY to it. Every case
 * therefore goes through the runner's own `evaluateCase` (the same outcome table the gated bridge
 * uses), with ONE deliberate difference in how the outcome is read:
 *
 *   pass  -> passed                                   xfail -> ok (listed in `xfailed`)
 *   fail  -> RED (incl. a marked case that fails DIFFERENTLY from its recorded signature, a
 *            dangling/non-carried/unsigned mark, a malformed contract, a seam violation, a crash)
 *   xpass -> REPORTED and counted in `xpassed`, but NOT red: the swapped stage may be the very one
 *            that fixes the carried gap. The pure-impl1 gate still turns that same case red, so the
 *            mark cannot go stale unnoticed.
 *
 * The full-bootstrap requirement (no xfail for impl#2) is unchanged: KNOWN_IMPL_IDS admits impl1-ts
 * only. Before this, the runner called runCase/runCaseRuntime directly and ignored xfail, so the
 * first carried gap would have made the P5 module-done gate unreachable.
 *
 * `opts.casesDir` / `opts.gaps` exist so a test can drive a synthetic carried case through the real
 * hybrid path; the CLI never sets them.
 */
export async function runHybridConformance(
  stageOverrides: Record<string, unknown>,
  filter: string | null = null,
  opts: {
    casesDir?: string;
    gaps?: ReadonlyMap<string, string>;
    /** Run ONLY these cases (by relDir) — the footprint grader's graded set. */
    only?: ReadonlySet<string>;
    /** The substitute's client executor (see `clientExecutorOf`); default: impl#1's execution. */
    executor?: ((artifact: { html: string; clientJs: string }) => Promise<void>) | null;
  } = {},
): Promise<ConformanceReport> {
  const { installHybrid, uninstallHybrid } = await import("../conformance/adapters/hybrid.ts");
  const { loadCases, evaluateCase, loadGapStatusIndex } = await import("../conformance/run.ts");
  const gaps = opts.gaps ?? loadGapStatusIndex();
  installHybrid(stageOverrides, opts.executor ?? null);
  const failures: ConformanceReport["failures"] = [];
  const xfailed: ConformanceReport["xfailed"] = [];
  const xpassed: ConformanceReport["xpassed"] = [];
  let total = 0;
  let passed = 0;
  try {
    for (const c of opts.casesDir ? loadCases(opts.casesDir) : loadCases()) {
      if (filter && !c.relDir.includes(filter)) continue;
      if (opts.only && !opts.only.has(c.relDir)) continue;
      total++;
      const reasons: string[] = [];
      try {
        const r = await evaluateCase(c, gaps);
        if (r.outcome === "pass") {
          passed++;
          continue;
        }
        if (r.outcome === "xfail") {
          xfailed.push({ relDir: c.relDir, gap: r.xfailGap as string });
          continue;
        }
        if (r.outcome === "xpass") {
          xpassed.push({ relDir: c.relDir, gap: r.xfailGap as string });
          continue;
        }
        for (const s of r.xfailErrors) reasons.push(`xfail: ${s}`);
        if (r.signatureMismatch.length > 0) {
          reasons.push(`FAILS DIFFERENTLY from the recorded impl1-ts xfail signature for '${r.xfailGap}':`);
          for (const s of r.signatureMismatch) reasons.push(`  ${s}`);
        }
        for (const s of r.shapeErrors) reasons.push(`MALFORMED expect: ${s}`);
        if (r.missing.length) reasons.push(`missing required codes: ${JSON.stringify(r.missing)} (emitted ${JSON.stringify(r.emitted)})`);
        if (r.forbidden.length) reasons.push(`forbidden codes present: ${JSON.stringify(r.forbidden)}`);
        for (const s of r.prefixViolations) reasons.push(`forbidden-prefix: ${s}`);
        for (const s of r.severityMismatches) reasons.push(`severity: ${s}`);
        for (const s of r.countMismatches) reasons.push(`codeCounts: ${s}`);
        for (const s of r.runtimeFailures) reasons.push(`runtime: ${s}`);
      } catch (e) {
        reasons.push(`${e instanceof StageSeamError ? "SEAM VIOLATION" : "CRASH"}: ${String((e as Error)?.message ?? e).split("\n")[0]}`);
      }
      failures.push({ relDir: c.relDir, reasons });
    }
  } finally {
    uninstallHybrid();
  }
  return { total, passed, failures, xfailed, xpassed };
}

// ---------------------------------------------------------------------------
// Footprint grading (s439-bootstrap-m3-ingest; dpa-051 §8.2, S233 §5)
// ---------------------------------------------------------------------------

/**
 * A substitute whose artifacts are not impl#1-shaped exports `executeClient` (see
 * conformance/adapters/impl1-ts.ts `setClientExecutor`). At most one substitute may.
 */
export function clientExecutorOf(
  stageOverrides: Record<string, unknown>,
): ((artifact: { html: string; clientJs: string }) => Promise<void>) | null {
  let found: ((artifact: { html: string; clientJs: string }) => Promise<void>) | null = null;
  for (const [name, sub] of Object.entries(stageOverrides)) {
    const x = sub && typeof sub === "object" ? (sub as Record<string, unknown>).executeClient : undefined;
    if (typeof x !== "function") continue;
    if (found) throw new InvalidRun(`two substitutes export executeClient (the second is ${name}); a run has one client executor`);
    found = x as (artifact: { html: string; clientJs: string }) => Promise<void>;
  }
  return found;
}

/** What the grader knows about one case before grading it. */
export interface FootprintInput {
  /** ERROR-severity diagnostics impl#1's FRONT END reported (CG replaced by a stand-in): the program is rejected. */
  impl1Errors: string[];
  /** Codes the case requires (`expect.codes` / `expect.severity`) that impl#1's front end did NOT emit — CG/post-CG codes. */
  cgCodes: string[];
  /** The substitute's not-yet reasons (shapes outside the implemented footprint). */
  notYet: string[];
  /** The substitute's `footprint()` threw: a bootstrap defect, graded as a FAIL. */
  crash: string | null;
}

export type FootprintClass = "graded" | "not-yet" | "front-end" | "crashed";

/**
 * THE CLASSIFIER.
 *   crashed   — the substitute's `footprint()` threw. A bootstrap defect: a loud FAIL.
 *   front-end — impl#1's FRONT END rejects the program (an error-severity diagnostic before CG). Its
 *               codes come from stages the substitute does not own, so it is never graded; it is
 *               bootstrap `analyze`'s queue. (Judged by rejection, not by an `E-` prefix: an `E-`
 *               code at warning severity rejects nothing.)
 *   not-yet   — the footprint leaves the implemented set, OR the case requires a code impl#1's front
 *               end does not emit (a CG/post-CG code the substitute does not produce yet). Never red.
 *   graded    — everything else.
 */
export function classifyFootprint(x: FootprintInput): FootprintClass {
  if (x.crash !== null) return "crashed";
  if (x.impl1Errors.length > 0) return "front-end";
  if (x.notYet.length > 0 || x.cgCodes.length > 0) return "not-yet";
  return "graded";
}

export interface FootprintCase {
  relDir: string;
  cls: FootprintClass;
  hasRuntime: boolean;
  constructs: string[];
  /** Not-yet reasons, including one "expects code X, not emitted by impl#1's front end" per CG code. */
  notYet: string[];
  impl1Errors: string[];
  crash: string | null;
}

export interface FootprintReport {
  /** Case directories found by an enumeration INDEPENDENT of the grading loop (so truncation shows). */
  enumerated: number;
  cases: FootprintCase[];
  conformance: ConformanceReport;
  /** Union of the footprints of the PASSING RUNTIME-HALF cases — candidates for certification (bite matrix). */
  exercised: string[];
  /** not-yet reason → number of cases carrying it, most frequent first. */
  notYetByReason: Array<[string, number]>;
  /** The CSS half (s440) — present when the substitute exports `gradeCss`. */
  css?: CssHalf;
}

/**
 * THE CSS HALF (s440-bootstrap-css-theme-t3). Conformance never observes CSS (conformance/normalize.ts
 * defers computed style), so a stylesheet substitute exports `gradeCss`: a css ORACLE (SPEC-derived
 * computed-style assertions, evaluated in a real browser over the hybrid's build) judges each GRADED case
 * that has one. Three populations: `conformance` (a conformance case's css half), `source` (a css-only
 * source outside the suite — the substitute's `cssExtraCases()`; classified by the same footprint loop,
 * not run through conformance: it has no codes/runtime contract), `core` (a hand-built Core graded by the
 * substitute's `gradeCssCores()` — shapes impl#1's front end cannot carry). A css FAIL is red.
 */
export interface CssResult {
  relDir: string;
  population: "conformance" | "source" | "core";
  cls: FootprintClass;
  constructs: string[];
  notYet: string[];
  /** null = graded, but no css oracle for it (its css is unobserved — not evidence). */
  pass: boolean | null;
  reasons: string[];
}
export interface CssHalf {
  results: CssResult[];
  /** Union of the footprints of the css PASSES — candidates for certification (bite matrix, CSS phase). */
  exercised: string[];
}
export type CssGrader = (x: {
  stageOverrides: Record<string, unknown>;
  cases: Array<{ relDir: string; source: string; auxFiles: Record<string, string> }>;
}) => Promise<Map<string, { pass: boolean; reasons: string[] } | null>>;
export interface CssSubstitute {
  gradeCss: CssGrader;
  cssExtraCases?: () => Array<{ relDir: string; source: string; auxFiles: Record<string, string> }>;
  gradeCssCores?: (x: { only?: ReadonlySet<string> }) => Promise<Array<{ relDir: string; constructs: string[]; pass: boolean; reasons: string[] }>>;
}

type FootprintFn = (cgArgs: unknown) => { constructs: string[]; notYet: string[] };

/**
 * The case directories under `dir` (a directory holding `case.scrml`), by a filesystem glob that
 * shares no code with `loadCases`. The report's "N of M" takes M from here, so a grading loop that
 * silently skips or stops early shows as N < M.
 */
export function enumerateCaseDirs(dir: string): string[] {
  const out: string[] = [];
  for (const p of new Bun.Glob("**/case.scrml").scanSync({ cwd: dir, onlyFiles: true })) out.push(dirname(p));
  return out.sort();
}

/**
 * Compute each case's footprint (impl#1's front end + the substitute's `footprint(cgArgs)` at the
 * CG seam — nothing is printed), classify it, then run the GRADED cases through the unchanged
 * hybrid conformance path (`runHybridConformance`, codes half + runtime half).
 */
export async function runFootprintGrade(
  stageOverrides: Record<string, unknown>,
  footprintFn: FootprintFn,
  filter: string | null = null,
  opts: {
    casesDir?: string;
    gaps?: ReadonlyMap<string, string>;
    /** Grade only these case dirs (the bite matrix re-grades the clean run's passes). */
    only?: ReadonlySet<string>;
    onProgress?: (done: number, total: number) => void;
    /** The stylesheet substitute's css half (s440); absent = no css half. */
    css?: CssSubstitute | null;
  } = {},
): Promise<FootprintReport> {
  const { loadCases, hasRuntimeHalf } = await import("../conformance/run.ts");
  const casesRoot = opts.casesDir ?? join(REPO_ROOT, "conformance", "cases");
  const selected = (rel: string) => (!filter || rel.includes(filter)) && (!opts.only || opts.only.has(rel));
  const enumerated = enumerateCaseDirs(casesRoot).filter(selected).length;
  const all = loadCases(casesRoot).filter((c) => selected(c.relDir));
  // css-only sources (outside the conformance suite): classified by this same loop, never run through
  // conformance (they carry no codes / runtime contract — only a css oracle).
  const extras = (opts.css?.cssExtraCases?.() ?? [])
    .filter((x) => selected(x.relDir))
    .map((x) => ({ ...x, dir: "", expected: { expect: { codes: [], notCodes: [] } } }));
  const extraDirs = new Set(extras.map((x) => x.relDir));
  const cases: FootprintCase[] = [];
  for (const c of [...all, ...extras] as typeof all) {
    const dir = mkdtempSync(join(tmpdir(), "scrml-footprint-"));
    let fp: { constructs: string[]; notYet: string[] } | null = null;
    let impl1Errors: string[] = [];
    let emitted = new Set<string>();
    let crash: string | null = null;
    try {
      const file = join(dir, "case.scrml");
      writeFileSync(file, c.source);
      for (const [n, s] of Object.entries(c.auxFiles)) writeFileSync(join(dir, n), s);
      const result = compileScrml({
        inputFiles: [file],
        write: false,
        outputDir: join(dir, "out"),
        log: () => {},
        stageOverrides: {
          CG: (cgArgs: unknown) => {
            try {
              fp = footprintFn(cgArgs);
            } catch (e) {
              crash = String((e as Error)?.message ?? e).split("\n")[0];
            }
            return { outputs: new Map(), errors: [] };
          },
        },
      }) as { errors?: Array<{ code?: string; severity?: string }>; warnings?: Array<{ code?: string }> };
      const errs = result.errors ?? [];
      impl1Errors = errs.filter((e) => e?.severity !== "warning" && e?.severity !== "info").map((e) => String(e?.code ?? "<no-code>"));
      emitted = new Set([...errs, ...(result.warnings ?? [])].map((e) => String(e?.code)));
    } catch (e) {
      crash = crash ?? `impl#1's front end threw: ${String((e as Error)?.message ?? e).split("\n")[0]}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const f = fp ?? { constructs: [], notYet: crash ? [] : ["CG was never reached"] };
    const ex = c.expected.expect;
    const required = [...new Set([...(ex.codes ?? []), ...Object.keys(ex.severity ?? {})])];
    const cgCodes = required.filter((code) => !emitted.has(code));
    const notYet = [...f.notYet, ...cgCodes.map((code) => `expects code ${code}, not emitted by impl#1's front end (CG/post-CG)`)];
    const cls = classifyFootprint({ impl1Errors, cgCodes, notYet: f.notYet, crash });
    cases.push({ relDir: c.relDir, cls, hasRuntime: hasRuntimeHalf(c), constructs: f.constructs, notYet, impl1Errors, crash });
    opts.onProgress?.(cases.length, all.length + extras.length);
  }
  // The css-only extras live in the css half only; every conformance bucket below counts suite cases.
  const extraCases = cases.filter((c) => extraDirs.has(c.relDir));
  const suiteCases = cases.filter((c) => !extraDirs.has(c.relDir));
  const graded = new Set(suiteCases.filter((c) => c.cls === "graded").map((c) => c.relDir));
  const conformance: ConformanceReport = graded.size > 0
    ? await runHybridConformance(stageOverrides, null, { casesDir: opts.casesDir, gaps: opts.gaps, only: graded, executor: clientExecutorOf(stageOverrides) })
    : { total: 0, passed: 0, failures: [], xfailed: [], xpassed: [] };
  // A crashed footprint is a FAIL of that case (loud), never a silent pass or an empty footprint.
  for (const c of suiteCases) if (c.cls === "crashed") conformance.failures.push({ relDir: c.relDir, reasons: [`CRASH in the substitute's footprint(): ${c.crash}`] });
  const css = opts.css ? await runCssHalf(stageOverrides, opts.css, [...suiteCases, ...extraCases], [...all, ...extras], extraDirs, opts.only) : undefined;
  // A css FAIL of a conformance case is a FAIL of that case (the hybrid broke what the css oracle observes).
  if (css) {
    for (const r of css.results) {
      if (r.population === "conformance" && r.pass === false) conformance.failures.push({ relDir: r.relDir, reasons: r.reasons.map((x) => `css: ${x}`) });
    }
  }
  const failed = new Set(conformance.failures.map((f) => f.relDir));
  const exercised = [...new Set(suiteCases.filter((c) => c.cls === "graded" && c.hasRuntime && !failed.has(c.relDir)).flatMap((c) => c.constructs))].sort();
  const byReason = new Map<string, number>();
  for (const c of suiteCases) if (c.cls === "not-yet") for (const r of c.notYet) byReason.set(r, (byReason.get(r) ?? 0) + 1);
  const notYetByReason = [...byReason].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { enumerated, cases: suiteCases, conformance, exercised, notYetByReason, ...(css ? { css } : {}) };
}

/** The css half over the classified cases (see `CssHalf`). */
async function runCssHalf(
  stageOverrides: Record<string, unknown>,
  sub: CssSubstitute,
  cases: FootprintCase[],
  sources: Array<{ relDir: string; source: string; auxFiles: Record<string, string> }>,
  extraDirs: ReadonlySet<string>,
  only: ReadonlySet<string> | undefined,
): Promise<CssHalf> {
  const byDir = new Map(sources.map((s) => [s.relDir, s]));
  const graded = cases.filter((c) => c.cls === "graded");
  const verdicts = await sub.gradeCss({
    stageOverrides,
    cases: graded.map((c) => byDir.get(c.relDir)!).map((s) => ({ relDir: s.relDir, source: s.source, auxFiles: s.auxFiles })),
  });
  const results: CssResult[] = [];
  for (const c of cases) {
    const population = extraDirs.has(c.relDir) ? "source" : "conformance";
    if (c.cls !== "graded") {
      // Only the css-bearing ones are listed: an extra always, a conformance case never (its bucket
      // is in the footprint table already).
      if (population === "source") results.push({ relDir: c.relDir, population, cls: c.cls, constructs: c.constructs, notYet: c.notYet, pass: null, reasons: c.impl1Errors.length ? [`impl#1's front end rejects it: ${c.impl1Errors.join(", ")}`] : [] });
      continue;
    }
    const v = verdicts.get(c.relDir) ?? null;
    results.push({ relDir: c.relDir, population, cls: c.cls, constructs: c.constructs, notYet: [], pass: v ? v.pass : null, reasons: v ? v.reasons : [] });
  }
  for (const k of (await sub.gradeCssCores?.({ only })) ?? []) {
    results.push({ relDir: k.relDir, population: "core", cls: "graded", constructs: k.constructs, notYet: [], pass: k.pass, reasons: k.reasons });
  }
  const exercised = [...new Set(results.filter((r) => r.pass === true).flatMap((r) => r.constructs))].sort();
  return { results, exercised };
}

/** Runtime-half and codes-only passes / fails of a footprint report (a crashed case is a fail). */
export function footprintCounts(rep: FootprintReport) {
  const failed = new Set(rep.conformance.failures.map((f) => f.relDir));
  const graded = rep.cases.filter((c) => c.cls === "graded" || c.cls === "crashed");
  const rt = graded.filter((c) => c.hasRuntime);
  const co = graded.filter((c) => !c.hasRuntime);
  return {
    runtimeGraded: rt.length,
    runtimePass: rt.filter((c) => !failed.has(c.relDir)).map((c) => c.relDir),
    runtimeFail: rt.filter((c) => failed.has(c.relDir)).map((c) => c.relDir),
    codesGraded: co.length,
    codesPass: co.filter((c) => !failed.has(c.relDir)).map((c) => c.relDir),
    codesFail: co.filter((c) => failed.has(c.relDir)).map((c) => c.relDir),
    // The css half (s440): graded entries WITH a css oracle, all three populations.
    cssPass: (rep.css?.results ?? []).filter((r) => r.pass === true).map((r) => r.relDir),
    cssFail: (rep.css?.results ?? []).filter((r) => r.pass === false).map((r) => r.relDir),
    cssUnobserved: (rep.css?.results ?? []).filter((r) => r.cls === "graded" && r.pass === null).map((r) => r.relDir),
  };
}

/** The css-half section of the footprint table (s440). */
export function cssTable(rep: FootprintReport): string {
  const css = rep.css;
  if (!css) return "";
  const k = footprintCounts(rep);
  const pop = (p: CssResult["population"]) => css.results.filter((r) => r.population === p);
  const L: string[] = [];
  L.push("## CSS half — computed style in Chromium against SPEC-derived oracles (s440)", "");
  L.push(`**Headline: ${k.cssPass.length} CSS passes of ${k.cssPass.length + k.cssFail.length} graded css-oracle cases** (${k.cssFail.length} fail).`, "");
  L.push("| population | graded with an oracle | pass | fail | graded, no oracle (css unobserved — not evidence) | not graded |", "|---|---|---|---|---|---|");
  for (const p of ["conformance", "source", "core"] as const) {
    const rs = pop(p);
    const g = rs.filter((r) => r.cls === "graded");
    L.push(`| ${p} | ${g.filter((r) => r.pass !== null).length} | ${g.filter((r) => r.pass === true).length} | ${g.filter((r) => r.pass === false).length} | ${g.filter((r) => r.pass === null).length} | ${rs.length - g.length} |`);
  }
  L.push("", "### Constructs exercised by CSS passes (candidates — certified only by the bite matrix)", "");
  L.push(css.exercised.map((c) => "`" + c + "`").join(" · ") || "(none)", "");
  L.push("### CSS passes", "");
  for (const r of css.results.filter((x) => x.pass === true)) L.push(`- \`${r.relDir}\` (${r.population})`);
  L.push("", "### CSS fails", "");
  const fails = css.results.filter((x) => x.pass === false);
  if (fails.length === 0) L.push("(none)");
  for (const r of fails) L.push(`- \`${r.relDir}\` (${r.population}) — ${String(r.reasons[0] ?? "").slice(0, 400)}`);
  const ng = css.results.filter((x) => x.cls !== "graded");
  if (ng.length > 0) {
    L.push("", "### css-only sources NOT graded (the reason)", "");
    for (const r of ng) L.push(`- \`${r.relDir}\` — ${r.cls}: ${(r.notYet.length ? r.notYet : r.reasons).join("; ").slice(0, 400)}`);
  }
  return L.join("\n") + "\n";
}

/** The footprint table (markdown). `swapLabel` names the substitute. */
export function footprintTable(rep: FootprintReport, swapLabel: string, top = 40): string {
  const n = (cls: FootprintClass) => rep.cases.filter((c) => c.cls === cls).length;
  const k = footprintCounts(rep);
  const L: string[] = [];
  L.push(`# Footprint grade — ${swapLabel}`, "");
  L.push(
    `Cases graded or classified: **${rep.cases.length} of ${rep.enumerated}** case directories found by an independent ` +
      `enumeration${rep.cases.length === rep.enumerated ? "" : " — ⚠ MISMATCH: the grading loop did not see every case directory"}.`,
    "",
  );
  L.push(`**Headline: ${k.runtimePass.length} RUNTIME passes of ${k.runtimeGraded} graded runtime-half cases** (${k.runtimeFail.length} fail).`, "");
  L.push("| bucket | cases |", "|---|---|");
  L.push(`| GRADED, runtime half — pass | ${k.runtimePass.length} |`);
  L.push(`| GRADED, runtime half — fail | ${k.runtimeFail.length} |`);
  L.push(`| GRADED, codes-only — pass (front-end codes — NOT bootstrap evidence) | ${k.codesPass.length} |`);
  L.push(`| GRADED, codes-only — fail | ${k.codesFail.length} |`);
  L.push(`| — of which xfail (impl1-ts mark, failing as recorded) | ${rep.conformance.xfailed.length} |`);
  L.push(`| — of which xpass (reported, not red) | ${rep.conformance.xpassed.length} |`);
  L.push(`| CRASHED in footprint() (counted in the fails above) | ${n("crashed")} |`);
  L.push(`| NOT-YET (footprint outside the implemented set, or expects a CG-emitted code — never red) | ${n("not-yet")} |`);
  L.push(`| FRONT-END (impl#1's front end rejects the program — bootstrap analyze's queue, not graded) | ${n("front-end")} |`);
  L.push(`| graded cases run by the conformance runner | ${rep.conformance.total} of ${n("graded")} |`, "");
  L.push("## Constructs exercised by passing RUNTIME cases (candidates — certified only by the bite matrix)", "");
  L.push(rep.exercised.map((c) => "`" + c + "`").join(" · ") || "(none)", "");
  L.push("## Fail list (first diverging reason per case)", "");
  if (rep.conformance.failures.length === 0) L.push("(none)");
  for (const f of rep.conformance.failures) L.push(`- \`${f.relDir}\` — ${String(f.reasons[0] ?? "(no reason)").replace(/\n\s*/g, " ⏎ ").slice(0, 500)}`);
  L.push("", "## Passing RUNTIME cases", "");
  for (const r of k.runtimePass) L.push(`- \`${r}\``);
  L.push("", "## Passing codes-only cases (front-end codes — NOT bootstrap evidence; never count toward certification)", "");
  for (const r of k.codesPass) L.push(`- \`${r}\``);
  L.push("", `## Top not-yet reasons by case count (the M3/M4 work queue) — ${rep.notYetByReason.length} distinct`, "");
  L.push("| cases | reason |", "|---|---|");
  for (const [r, c] of rep.notYetByReason.slice(0, top)) L.push(`| ${c} | ${r.replace(/\|/g, "\\|")} |`);
  const oneAway = new Map<string, number>();
  for (const c of rep.cases) if (c.cls === "not-yet" && c.notYet.length === 1) oneAway.set(c.notYet[0], (oneAway.get(c.notYet[0]) ?? 0) + 1);
  L.push("", "## Cases ONE reason away from graded (by that reason)", "");
  L.push("| cases | the one reason |", "|---|---|");
  for (const [r, c] of [...oneAway].sort((a, b) => b[1] - a[1]).slice(0, top)) L.push(`| ${c} | ${r.replace(/\|/g, "\\|")} |`);
  const css = cssTable(rep);
  return L.join("\n") + "\n" + (css ? "\n" + css : "");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const opts = {
    list: false,
    swaps: [] as Array<[string, string]>,
    conformance: false,
    differential: false,
    footprint: false,
    report: null as string | null,
    only: null as string[] | null,
    filter: null as string | null,
    roots: DEFAULT_ROOTS,
    files: null as string[] | null,
    limit: null as number | null,
    show: 25,
    json: null as string | null,
    concurrency: 4,
    sideWorker: null as string | null,
    compileSubstitute: null as string | null,
  };
  const need = (i: number, flag: string) => {
    if (i >= argv.length) throw new InvalidRun(`${flag} needs a value`);
    return argv[i];
  };
  const whole = (v: string, flag: string) => {
    if (!/^\d+$/.test(v)) throw new InvalidRun(`${flag} takes a whole number, got ${JSON.stringify(v)}`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") opts.list = true;
    else if (a === "--conformance") opts.conformance = true;
    else if (a === "--differential") opts.differential = true;
    else if (a === "--footprint") opts.footprint = true;
    else if (a === "--report") opts.report = need(++i, a);
    else if (a === "--only") opts.only = need(++i, a).split(",").filter(Boolean);
    else if (a === "--swap") {
      const v = need(++i, a);
      const eq = v.indexOf("=");
      if (eq <= 0 || eq === v.length - 1) throw new InvalidRun(`--swap takes <STAGE>=<module>, got ${JSON.stringify(v)}`);
      opts.swaps.push([v.slice(0, eq), v.slice(eq + 1)]);
    } else if (a === "--filter") opts.filter = need(++i, a);
    else if (a === "--roots") opts.roots = need(++i, a).split(",").filter(Boolean);
    else if (a === "--files") opts.files = need(++i, a).split(",").filter(Boolean);
    else if (a === "--limit") opts.limit = whole(need(++i, a), a);
    else if (a === "--show") opts.show = whole(need(++i, a), a);
    else if (a === "--json") opts.json = need(++i, a);
    else if (a === "--concurrency") {
      opts.concurrency = whole(need(++i, a), a);
      if (opts.concurrency < 1) throw new InvalidRun("--concurrency must be >= 1");
    } else if (a === "--side-worker") opts.sideWorker = need(++i, a); // internal: see runDifferential
    else if (a === "--compile-substitute") opts.compileSubstitute = need(++i, a); // internal: see compileScrmlSubstitute
    else throw new InvalidRun(`unknown argument ${JSON.stringify(a)}`);
  }
  return opts;
}

function printStages(): void {
  console.log("substitutable stages (compiler/src/pipeline-seam.ts STAGE_SEAMS, pipeline order):\n");
  for (const s of STAGE_SEAMS) {
    console.log(`  ${s.name.padEnd(26)} ${s.pipeline.padEnd(24)} export \`${s.entry}\`  [ts: compiler/src/${s.tsModule.replace(/^\.\//, "")}]`);
    console.log(`  ${"".padEnd(26)} ${s.signature}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.compileSubstitute) {
    console.log(`SUBSTITUTE-JS:${compileScrmlSubstituteInProcess(resolve(opts.compileSubstitute))}`);
    return 0;
  }
  if (opts.sideWorker) {
    await sideWorker(opts.sideWorker, opts.swaps);
    return 0;
  }
  if (opts.list) {
    printStages();
    if (!opts.conformance && !opts.differential && !opts.footprint) return 0;
  }
  if (!opts.conformance && !opts.differential && !opts.footprint) {
    throw new InvalidRun("nothing to do: pass --conformance, --differential and/or --footprint (or --list)");
  }
  if (opts.swaps.length === 0) throw new InvalidRun("no --swap given: a hybrid run with no substituted stage is pure TS");

  const stageOverrides = await buildStageOverrides(opts.swaps);
  for (const name of Object.keys(stageOverrides)) {
    const seam = stageSeam(name);
    if (seam?.reentry?.length && opts.swaps.every(([s]) => s !== "all")) {
      console.error(
        `hybrid: NOTE — ${name} is re-entered directly (TS implementation) from ${seam.reentry.length} file(s) outside the ` +
          `pipeline call: ${seam.reentry.join(", ")}. Those re-parses still run TS; see PARSE_REENTRY_FILES in pipeline-seam.ts.`,
      );
    }
  }
  const swapLabel = opts.swaps.map(([s, m]) => `${s}=${m}`).join(" ");
  let red = false;

  if (opts.conformance) {
    const t0 = performance.now();
    const rep = await runHybridConformance(stageOverrides, opts.filter, { executor: clientExecutorOf(stageOverrides) });
    if (rep.total === 0) throw new InvalidRun(`conformance: zero cases selected${opts.filter ? ` by --filter ${opts.filter}` : ""}`);
    for (const f of rep.failures) {
      console.log(`FAIL  ${f.relDir}`);
      for (const r of f.reasons) console.log(`        ${r}`);
    }
    for (const x of rep.xpassed) {
      console.log(
        `XPASS ${x.relDir}  [impl1-ts xfail: ${x.gap}] — passes through this hybrid (reported, not red: the ` +
          `swapped stage may be what fixes the carried gap)`,
      );
    }
    console.log(
      `\nhybrid conformance [${swapLabel}]: ${rep.passed} of ${rep.total} cases pass` +
        (rep.failures.length ? `, ${rep.failures.length} FAILED` : "") +
        `, ${rep.xfailed.length} xfail of ${rep.total}` +
        (rep.xpassed.length ? `, ${rep.xpassed.length} XPASS (reported, not red)` : "") +
        `  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
    );
    if (rep.failures.length) red = true;
  }

  if (opts.footprint) {
    const t0 = performance.now();
    const withFp = Object.entries(stageOverrides).filter(([, m]) => m && typeof (m as Record<string, unknown>).footprint === "function");
    if (withFp.length !== 1) throw new InvalidRun("--footprint needs exactly one substitute that exports `footprint(cgArgs)`");
    const fpFn = (withFp[0][1] as { footprint: FootprintFn }).footprint;
    // s440 — a stylesheet substitute brings the css half (`gradeCss`, optional extras + Core oracles).
    const cssSub = (typeof (withFp[0][1] as Record<string, unknown>).gradeCss === "function" ? withFp[0][1] : null) as CssSubstitute | null;
    let rep: FootprintReport;
    try {
      rep = await runFootprintGrade(stageOverrides, fpFn, opts.filter, {
        only: opts.only ? new Set(opts.only) : undefined,
        onProgress: (i, n) => { if (i % 100 === 0 || i === n) process.stderr.write(`  footprint: ${i}/${n} cases classified\n`); },
        css: cssSub,
      });
    } finally {
      await (cssSub as { closeCss?: () => Promise<void> } | null)?.closeCss?.();
    }
    if (rep.enumerated === 0 && (rep.css?.results.length ?? 0) === 0) throw new InvalidRun(`footprint: zero cases selected${opts.filter ? ` by --filter ${opts.filter}` : ""}`);
    const table = footprintTable(rep, swapLabel);
    console.log(table);
    console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    if (opts.report) {
      writeFileSync(opts.report, table);
      console.log(`  report: ${opts.report}`);
    }
    if (opts.json) {
      writeFileSync(opts.json, JSON.stringify({ swap: opts.swaps, counts: footprintCounts(rep), ...rep }, null, 2));
      console.log(`  json: ${opts.json}`);
    }
    if (rep.conformance.failures.length > 0) red = true;
    if ((rep.css?.results ?? []).some((r) => r.pass === false)) red = true;
  }

  if (opts.differential) {
    let files = opts.files ?? listCorpus(opts.roots);
    if (opts.limit !== null) files = files.slice(0, opts.limit);
    if (files.length === 0) throw new InvalidRun("differential: zero sources selected");
    const t0 = performance.now();
    const rep = await runDifferential(files, resolveSwapSpecs(opts.swaps), {
      concurrency: opts.concurrency,
      onProgress: (i, n) => process.stderr.write(`  differential: ${i}/${n} sources compiled both ways\n`),
    });
    const shown = new Set<string>();
    let printed = 0;
    for (const x of rep.divergences) {
      if (printed >= opts.show) break;
      const first = !shown.has(x.file);
      shown.add(x.file);
      if (first) console.log(`\nDIVERGENT  ${x.file}`);
      console.log(`  [${x.kind}]${x.artifact ? ` ${x.artifact}` : ""}`);
      for (const l of x.hunk.split("\n")) console.log(`    ${l}`);
      printed++;
    }
    if (rep.divergences.length > printed) console.log(`\n  … ${rep.divergences.length - printed} more divergence(s) not shown (--show N, or --json <path> for all)`);
    const kinds = Object.entries(rep.byKind).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(
      `\nhybrid differential [${swapLabel}] over ${opts.files ? "--files" : opts.roots.join(",")}:` +
        `\n  IDENTICAL  ${rep.identical} of ${rep.total} sources` + (rep.bothCrash ? `  (${rep.bothCrash} of them crash identically on both sides)` : "") +
        `\n  DIVERGENT  ${rep.divergentFiles} of ${rep.total} sources` + (kinds ? `  — ${rep.divergences.length} divergence(s): ${kinds}` : "") +
        `\n  (${((performance.now() - t0) / 1000).toFixed(1)}s; triage each divergence as TS-bug / bootstrap-bug / spec-gap — the differential is not a gate)`,
    );
    if (opts.json) {
      writeFileSync(opts.json, JSON.stringify({ swap: opts.swaps, roots: opts.files ? null : opts.roots, ...rep }, null, 2));
      console.log(`  report: ${opts.json}`);
    }
    if (rep.divergentFiles > 0) red = true;
  }
  return red ? 1 : 0;
}

if ((import.meta as unknown as { main?: boolean }).main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      if (e instanceof InvalidRun) {
        console.error(`hybrid: ${e.message}`);
        process.exit(2);
      }
      console.error(`hybrid: crashed — not a valid run\n${(e as Error)?.stack ?? e}`);
      process.exit(2);
    },
  );
}
