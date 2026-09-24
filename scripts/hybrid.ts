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
 *   Both --conformance and --differential may be given; conformance runs first.
 *
 * <module> is LOCATION-AGNOSTIC — where the bootstrap lives (`stdlib/compiler/**` vs
 * `compiler/self-host/`) is unsettled, so the runner takes any path:
 *   - a `.js` / `.ts` / `.mjs` path: imported directly; must export the stage's entry (see --list)
 *     or a default function.
 *   - a `.scrml` path: compiled FIRST by the pure TS compiler in library mode to a temp dir, then
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

/** Compile a `.scrml` substitute with the pure TS compiler (library mode) and return its JS path. */
function compileScrmlSubstitute(scrmlPath: string): string {
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
}

export async function runHybridConformance(stageOverrides: Record<string, unknown>, filter: string | null = null): Promise<ConformanceReport> {
  const { installHybrid, uninstallHybrid } = await import("../conformance/adapters/hybrid.ts");
  const { loadCases, runCase, runCaseRuntime } = await import("../conformance/run.ts");
  installHybrid(stageOverrides);
  const failures: ConformanceReport["failures"] = [];
  let total = 0;
  let passed = 0;
  try {
    for (const c of loadCases()) {
      if (filter && !c.relDir.includes(filter)) continue;
      total++;
      const reasons: string[] = [];
      try {
        const r = runCase(c);
        for (const s of r.shapeErrors) reasons.push(`MALFORMED expect: ${s}`);
        if (r.missing.length) reasons.push(`missing required codes: ${JSON.stringify(r.missing)} (emitted ${JSON.stringify(r.emitted)})`);
        if (r.forbidden.length) reasons.push(`forbidden codes present: ${JSON.stringify(r.forbidden)}`);
        for (const s of r.prefixViolations) reasons.push(`forbidden-prefix: ${s}`);
        for (const s of r.severityMismatches) reasons.push(`severity: ${s}`);
        for (const s of r.countMismatches) reasons.push(`codeCounts: ${s}`);
        if (r.hasRuntimeHalf) {
          for (const s of await runCaseRuntime(c)) reasons.push(`runtime: ${s}`);
        }
      } catch (e) {
        reasons.push(`${e instanceof StageSeamError ? "SEAM VIOLATION" : "CRASH"}: ${String((e as Error)?.message ?? e).split("\n")[0]}`);
      }
      if (reasons.length === 0) passed++;
      else failures.push({ relDir: c.relDir, reasons });
    }
  } finally {
    uninstallHybrid();
  }
  return { total, passed, failures };
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
    filter: null as string | null,
    roots: DEFAULT_ROOTS,
    files: null as string[] | null,
    limit: null as number | null,
    show: 25,
    json: null as string | null,
    concurrency: 4,
    sideWorker: null as string | null,
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
  if (opts.sideWorker) {
    await sideWorker(opts.sideWorker, opts.swaps);
    return 0;
  }
  if (opts.list) {
    printStages();
    if (!opts.conformance && !opts.differential) return 0;
  }
  if (!opts.conformance && !opts.differential) throw new InvalidRun("nothing to do: pass --conformance and/or --differential (or --list)");
  if (opts.swaps.length === 0) throw new InvalidRun("no --swap given: a hybrid run with no substituted stage is pure TS");

  const stageOverrides = await buildStageOverrides(opts.swaps);
  const swapLabel = opts.swaps.map(([s, m]) => `${s}=${m}`).join(" ");
  let red = false;

  if (opts.conformance) {
    const t0 = performance.now();
    const rep = await runHybridConformance(stageOverrides, opts.filter);
    if (rep.total === 0) throw new InvalidRun(`conformance: zero cases selected${opts.filter ? ` by --filter ${opts.filter}` : ""}`);
    for (const f of rep.failures) {
      console.log(`FAIL  ${f.relDir}`);
      for (const r of f.reasons) console.log(`        ${r}`);
    }
    console.log(
      `\nhybrid conformance [${swapLabel}]: ${rep.passed} of ${rep.total} cases pass` +
        (rep.failures.length ? `, ${rep.failures.length} FAILED` : "") +
        `  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
    );
    if (rep.failures.length) red = true;
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
