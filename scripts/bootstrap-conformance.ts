#!/usr/bin/env bun
/**
 * bootstrap-conformance.ts — how many conformance cases does the BOOTSTRAP pass?
 * change-id: s449-bootstrap-conformance-counter.
 *
 * ═══ WHAT THIS MEASURES ═══
 *
 * Every case under conformance/cases/** (the language-1.0 contract, §62.2: the corpus IS the
 * versioned contract — the same corpus impl#1 is graded on by conformance/run.ts) is run through
 * the PURE bootstrap: the self-host-v2 front end (lex → parse → analyze → lower, the scrml
 * modules compiled by impl#1 via the slice-m2 bundle) for the CODES half, and — where the case
 * has a client-side runtime half — the bootstrap printer (print.scrml) + the bootstrap runtime
 * (slice-m1/runtime/runtime.js) executed in happy-dom for the RUNTIME half, driven by the same
 * 8-verb input driver, virtual clock, DOM normalizer and anchored runner impl#1 is graded with.
 *
 * No impl#1 stage touches a case. (impl#1 compiles the bootstrap's own scrml sources into JS —
 * that is the bootstrap's build, not part of the measured pipeline.) This is NOT the hybrid
 * (scripts/hybrid.ts swaps one stage into impl#1); it is the whole bootstrap, end to end.
 *
 * ═══ THE BUCKETS (each case lands in exactly one) ═══
 *
 *   PASS         codes half holds AND the runtime half (if the case has one) executed and held.
 *   CODES-ONLY   codes half holds; the case HAS a runtime half the bootstrap cannot execute — a
 *                server (serverStub / serverDb / firstPaint / ssr) or tool (stdout) run. The
 *                bootstrap emits no server or tool artifact, so that half is not attempted.
 *   FAIL         the bootstrap handled the case and got it WRONG: a required code missing, a
 *                forbidden code fired, a severity / count mismatch, or a runtime-half mismatch.
 *                A FAIL is a bug or a divergence — the most useful output of this probe.
 *   LEGACY       the case is written in the legacy dialect (§66.21 retired forms — see
 *                LEGACY_MARKERS) AND the bootstrap emitted a code the case does not expect.
 *                The bootstrap front end parses only the §66 dialect; this bucket is NEVER a FAIL.
 *                (Honest note: §66.21 Stage 1 says a retired form "parses identically" with a
 *                W-lint, so this bucket is bootstrap debt, not a free pass — it is just not a
 *                wrong-answer defect.)
 *   UNSUPPORTED  a §66-dialect case the bootstrap refuses: an unexpected E-BOOTSTRAP-UNSUPPORTED
 *                (sub-reason `bootstrap-unsupported`), or an unexpected PARSE-phase diagnostic
 *                (sub-reason `parse-reject` — a construct the bootstrap parser does not know; the
 *                case list is printed so a real parser bug cannot hide here).
 *   CRASH        the bootstrap THREW (front end, printer, or the runtime half) — not a verdict.
 *   INVALID      the case's own `expect` block is malformed (S365 container policy) — the
 *                contract cannot be evaluated by ANY implementation.
 *
 * Severity: the bootstrap's `Diag` (ast.scrml) carries no §34 severity. A case asserting
 * `severity` for a code the bootstrap DID emit fails with "severity unobservable" — it is a real
 * divergence (the language contract partitions by severity), reported as its own family so it
 * does not drown the rest.
 *
 * ═══ USAGE ═══
 *
 *   bun scripts/bootstrap-conformance.ts                 print the report (totals, per-area, FAILs)
 *   bun scripts/bootstrap-conformance.ts --filter <s>    only cases whose relDir contains <s>
 *   bun scripts/bootstrap-conformance.ts --cases <dir>   a different case root (the tests' fixtures)
 *   bun scripts/bootstrap-conformance.ts --json <path>   also write the per-case JSON
 *   bun scripts/bootstrap-conformance.ts --write         also regenerate docs/bootstrap-conformance.md
 *   bun scripts/bootstrap-conformance.ts --check         exit 1 when docs/bootstrap-conformance.md is stale
 *   bun scripts/bootstrap-conformance.ts --fail-on-fail  exit 1 when FAIL or CRASH > 0
 *
 * ═══ EXIT STATUS (separate from the output — pa-base §8) ═══
 *
 *   0  a VALID measurement was taken (whatever the numbers say). This is a TRACKING probe, not a
 *      gate: a red exit over a known backlog would be the §8 cry-wolf shape.
 *   1  only with --fail-on-fail (a FAIL or a CRASH was found) or --check (the report file is stale).
 *      CI runs `--check` in the NON-BLOCKING `tracking` job only.
 *   2  NOT A VALID RUN — the bootstrap bundle failed to build/load, or zero cases were attempted.
 *
 * The report always states its own scope: "N of M cases attempted" (attempted = reached the
 * bootstrap at all; every case is attempted unless --filter narrows the set, which is printed).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { hasRuntimeHalf, loadCases, validateExpectContainers, type LoadedCase } from "../conformance/run.ts";
import { driveInputs, type ConformanceHook, type InputStep } from "../conformance/driver.ts";
import { FakeClock } from "../conformance/fake-clock.ts";
import { normalizeDom, runAnchored } from "../conformance/normalize.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF_HOST_V2 = join(REPO_ROOT, "compiler", "self-host-v2");
const BOOT_RUNTIME = join(SELF_HOST_V2, "slice-m1", "runtime", "runtime.js");
export const DEFAULT_CASES_DIR = join(REPO_ROOT, "conformance", "cases");
export const REPORT_PATH = join(REPO_ROOT, "docs", "bootstrap-conformance.md");

export type Bucket = "PASS" | "CODES-ONLY" | "FAIL" | "LEGACY" | "UNSUPPORTED" | "CRASH" | "INVALID";
export const BUCKETS: readonly Bucket[] = ["PASS", "CODES-ONLY", "FAIL", "LEGACY", "UNSUPPORTED", "CRASH", "INVALID"];

export interface CaseVerdict {
  relDir: string;
  area: string;
  bucket: Bucket;
  /** Sub-reason: the legacy markers hit, the unsupported kind, the crash phase. */
  reason: string;
  /** Every distinct code the bootstrap emitted (sorted). */
  emitted: string[];
  /** Codes the bootstrap emitted that the case does not list in `codes` (sorted). */
  unexpected: string[];
  /** Failure lines (FAIL / CRASH / INVALID). */
  failures: string[];
  /** Did the runtime half execute on the bootstrap? */
  runtimeExecuted: boolean;
  /** PASS / CODES-ONLY only: every assertion that held is an ABSENCE of a code the bootstrap's
   *  sources never mention (so it holds for any input), and no runtime half executed. */
  vacuous: boolean;
  /** Codes the case requires (codes / severity / positive codeCounts) that appear nowhere in the
   *  bootstrap's sources — the check is not implemented at all (vs. implemented and missed). */
  unimplementedCodes: string[];
  /** The legacy-dialect markers the source carries (see LEGACY_MARKERS), whatever the bucket. */
  legacyMarkers: string[];
}

/** Is a passing verdict vacuous over the bootstrap's known-code set? (see CaseVerdict.vacuous) */
export function isVacuousPass(ex: Record<string, any>, knownCodes: Set<string>, runtimeExecuted: boolean): boolean {
  if (runtimeExecuted) return false;
  if ((ex.codes ?? []).length > 0) return false;
  if (Object.keys(ex.severity ?? {}).length > 0) return false;
  for (const [c, n] of Object.entries(ex.codeCounts ?? {})) if (n !== 0 || knownCodes.has(c)) return false;
  for (const c of ex.notCodes ?? []) if (knownCodes.has(c)) return false;
  for (const p of ex.notCodePrefixes ?? []) for (const k of knownCodes) if (k.startsWith(p)) return false;
  return true;
}

/** The required codes of a case that the bootstrap's sources never mention. */
export function unimplementedRequired(ex: Record<string, any>, knownCodes: Set<string>): string[] {
  const req = new Set<string>([...(ex.codes ?? []), ...Object.keys(ex.severity ?? {})]);
  for (const [c, n] of Object.entries(ex.codeCounts ?? {})) if (typeof n === "number" && n > 0) req.add(c);
  return [...req].filter((c) => !knownCodes.has(c)).sort();
}

// ---------------------------------------------------------------------------
// The legacy-dialect detector
// ---------------------------------------------------------------------------

/**
 * Source markers of the LEGACY dialect: the §66.21 retired forms, plus a file with no `<program>`
 * root (every §66 program — the §66.19 worked programs — has one; the bootstrap requires it and
 * reports E-PROGRAM-MISSING). A heuristic over source text; the report prints the per-marker
 * counts so it is auditable, and a legacy case the bootstrap accepts cleanly is graded normally.
 */
export const LEGACY_MARKERS: ReadonlyArray<[string, RegExp]> = [
  // §66.21 row 1: `<x> = v`, `<x>: T = v` (also inside `${ … }`)
  // (with or without attributes: `<count server> = 0`)
  ["rhs-decl", /<[A-Za-z_][\w]*(?:\s[^<>\n]*)?>\s*(?::[^=\n]*)?=(?!=)/],
  // §66.21 row 2: `const <x> = expr`
  ["const-cell", /\bconst\s+<[A-Za-z_]/],
  // §66.21 row 3: `const X = <root …>` component
  ["component-const", /\bconst\s+[A-Z]\w*\s*=\s*</],
  // §66.21 row 4: `<engine for=T …>`
  ["engine-element", /<engine\b/],
  // no `<program>` root in the entry file
  ["no-program-root", /^(?![\s\S]*<program\b)/],
];

export function legacyMarkers(source: string): string[] {
  const s = stripComments(source);
  return LEGACY_MARKERS.filter(([, re]) => re.test(s)).map(([n]) => n);
}

/** Drop `//` line comments and `<!-- -->` blocks so a marker named in a comment does not count. */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

// ---------------------------------------------------------------------------
// The bootstrap
// ---------------------------------------------------------------------------

interface Diag {
  code: string;
  message: string;
  file: string;
}

export interface Bootstrap {
  mods: Record<string, any>;
  /** Every diagnostic-code string LITERAL in the bundle's scrml sources — the codes the bootstrap
   *  can emit at all. Used only to ANNOTATE (vacuous passes; unimplemented-check FAILs), never to
   *  change a verdict. */
  knownCodes: Set<string>;
}

/** The quoted `"E-…"` / `"W-…"` / `"I-…"` literals in the given scrml sources. */
export function codeLiterals(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(/"([EWI]-[A-Z0-9]+(?:-[A-Z0-9]+)*)"/g)) out.add(m[1]);
  return out;
}

/** Build + load the bootstrap (the slice-m2 bundle: core..measure + lex/ast/parse/analyze/lower). */
export async function loadBootstrapModules(): Promise<Bootstrap> {
  const { loadM2, M2_MODULES } = await import("../compiler/self-host-v2/slice-m2/harness.js");
  const { mods } = loadM2();
  for (const m of ["parse", "analyze", "lower", "check", "print"]) {
    if (!mods[m]) throw new Error(`bootstrap module '${m}' missing from the slice-m2 bundle`);
  }
  const knownCodes = codeLiterals((M2_MODULES as string[]).map((m) => readFileSync(join(SELF_HOST_V2, m), "utf8")));
  return { mods, knownCodes };
}

/**
 * The front end, phase-separated. Mirrors compiler/self-host-v2/slice-m2/lowered.js `frontEnd`
 * (files in LINK ORDER: aux imports first, the entry last), but keeps the PARSE-phase diagnostics
 * apart — they decide the `parse-reject` bucket.
 */
function frontEnd(mods: Record<string, any>, files: Array<{ path: string; src: string }>) {
  let next = 0;
  const asts: unknown[] = [];
  let parseDiags: Diag[] = [];
  for (const f of files) {
    const r = mods.parse.parseFile(f.path, f.src, next);
    next = r.nextId;
    asts.push(r.ast);
    parseDiags = parseDiags.concat(r.diags);
  }
  const tp = mods.analyze.analyze(asts, files[files.length - 1].path);
  const lowered = mods.lower.lower(tp);
  // `infos`: the bootstrap's non-fatal I- notes (s449 — SPEC §55.17.6 I-FORM-SUBMIT-GATED "reports in
  // the warnings stream"), kept apart from `diags` by the bootstrap.
  return { core: lowered.core, parseDiags, diags: parseDiags.concat(tp.diags as Diag[]), infos: ((tp.infos ?? []) as Diag[]) };
}

/** The runtime half's server/tool selectors — halves the bootstrap emits no artifact for. */
export function nonClientRuntimeKeys(c: LoadedCase): string[] {
  const e = c.expected.expect as Record<string, unknown>;
  return ["serverStub", "serverDb", "firstPaint", "stdout", "ssr"].filter((k) => e[k] !== undefined && e[k] !== false);
}

function between(html: string, open: string, close: string): string {
  const i = html.indexOf(open);
  const j = html.lastIndexOf(close);
  return i === -1 || j === -1 ? "" : html.slice(i + open.length, j);
}

/**
 * Execute the bootstrap's artifact for one case and return `{ dom, state, body }` — the same
 * observation impl#1's adapter returns. The OQ3 hook is published over the bootstrap runtime's own
 * model (the program instance's fields by source name), exactly as the M3 substitute's executor
 * (compiler/self-host-v2/slice-m3/substitute.js `executeClient`) does — duplicated here rather than
 * imported because importing that module builds the M3 ingest bundle as a side effect.
 */
async function runBootstrapArtifact(html: string, js: string, input: InputStep[]) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const clock = new FakeClock();
  const dir = mkdtempSync(join(tmpdir(), "scrml-bootconf-"));
  try {
    const doc = (globalThis as any).document;
    const strip = (s: string) => s.replace(/<script[^>]*><\/script>/g, "");
    doc.head.innerHTML = strip(between(html, "<head>", "</head>"));
    doc.body.innerHTML = strip(between(html, "<body>", "</body>")).trim();
    copyFileSync(BOOT_RUNTIME, join(dir, "scrml-runtime.js"));
    writeFileSync(join(dir, "program.client.js"), js);
    clock.install();
    const rt = await import(join(dir, "scrml-runtime.js"));
    await import(join(dir, "program.client.js"));
    const program = () => [...rt.devtools.instances.values()].find((i: any) => i.id === 0 && i.decl.name === "program");
    const hook: ConformanceHook = {
      snapshot() {
        const inst = program();
        const cells: Record<string, unknown> = {};
        if (inst) {
          const snap = rt.snapshot(inst);
          for (const k of Object.keys(snap)) cells[k] = snap[k] === undefined ? null : snap[k];
        }
        return { cells, derived: {} };
      },
      settled() {
        return new Promise((r) => {
          Promise.resolve().then(() => setTimeout(r, 0));
        });
      },
    };
    (globalThis as any).__scrml_conformance = hook;
    doc.dispatchEvent(new (globalThis as any).Event("DOMContentLoaded", { bubbles: true }));
    await hook.settled();
    await driveInputs(doc, input, hook, clock);
    await hook.settled();
    return { dom: normalizeDom(doc.body), state: hook.snapshot(), body: doc.body };
  } finally {
    clock.restore();
    delete (globalThis as any).__scrml_conformance;
    rmSync(dir, { recursive: true, force: true });
  }
}

const stableKey = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableKey).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableKey(o[k])).join(",") + "}";
};

/**
 * The codes-half assertions, judged exactly as conformance/run.ts `runCase` judges impl#1: the codes
 * are the union of BOTH streams (`diags` and the non-fatal `infos`). Severity is observable for the
 * `infos` stream only — a code there IS an info; a code in `diags` carries no §34 severity.
 */
export function codesHalfFailures(ex: Record<string, any>, diags: Diag[], infos: Diag[] = []): string[] {
  const all = diags.concat(infos);
  const emitted = new Set(all.map((d) => d.code));
  const asInfo = new Set(infos.map((d) => d.code));
  const counts: Record<string, number> = {};
  for (const d of all) counts[d.code] = (counts[d.code] ?? 0) + 1;
  const out: string[] = [];
  for (const c of ex.codes ?? []) if (!emitted.has(c)) out.push(`missing ${c}`);
  for (const c of ex.notCodes ?? []) if (emitted.has(c)) out.push(`forbidden ${c} fired`);
  for (const p of ex.notCodePrefixes ?? []) for (const c of emitted) if (c.startsWith(p)) out.push(`forbidden family ${p}* fired: ${c}`);
  for (const [c, want] of Object.entries(ex.severity ?? {})) {
    if (!emitted.has(c)) out.push(`severity: ${c} did not fire (expected ${want})`);
    else if (asInfo.has(c)) { if (want !== "info") out.push(`severity: ${c} fired as info (expected ${want})`); }
    else out.push(`severity unobservable: ${c} fired but the bootstrap Diag carries no §34 severity (expected ${want})`);
  }
  for (const [c, want] of Object.entries(ex.codeCounts ?? {})) {
    if (typeof want !== "number" || !Number.isInteger(want) || want < 0) out.push(`codeCounts['${c}'] malformed`);
    else if ((counts[c] ?? 0) !== want) out.push(`count: ${c} fired ${counts[c] ?? 0} time(s), expected exactly ${want}`);
  }
  return out;
}

/** The runtime-half assertions over one observation, judged as conformance/run.ts `runtimeBody`. */
function runtimeHalfFailures(ex: Record<string, any>, r: { dom: string; state: { cells: any; derived: any }; body: any }): string[] {
  const out: string[] = [];
  if (ex.state) {
    const merged = { ...r.state.cells, ...r.state.derived };
    for (const k of Object.keys(ex.state)) {
      if (!(k in merged)) out.push(`state: cell '${k}' absent from snapshot`);
      else if (stableKey(merged[k]) !== stableKey(ex.state[k])) out.push(`state: cell '${k}' expected ${JSON.stringify(ex.state[k])}, got ${JSON.stringify(merged[k])}`);
    }
  }
  if (ex.dom !== undefined && r.dom !== ex.dom) out.push(`dom (whole-tree) mismatch: expected ${JSON.stringify(ex.dom)} got ${JSON.stringify(r.dom)}`);
  if (ex.domAnchored) for (const f of runAnchored(r.body, ex.domAnchored).failures) out.push("domAnchored: " + f);
  return out;
}

const PARSE_PHASE_HINT = /^E-(PARSE|SYNTAX|CLOSER|UNQUOTED)-/;

/** Classify ONE case on the bootstrap. Never throws (a throw is the CRASH bucket). */
export async function classifyCase(boot: Bootstrap, c: LoadedCase): Promise<CaseVerdict> {
  const area = c.relDir.split("/")[0];
  const ex = c.expected.expect as Record<string, any>;
  const legacy = legacyMarkers(c.source);
  const v = (bucket0: Bucket, reason0: string, rest: Partial<CaseVerdict> = {}): CaseVerdict => {
    // A legacy-dialect case is never a FAIL (brief: dialect artefacts are their own bucket) — even
    // when the bootstrap ACCEPTED the legacy form with no unexpected code and then answered wrong.
    // That silent acceptance is reported (reason `accepted-silently`), not hidden.
    const silent = bucket0 === "FAIL" && legacy.length > 0;
    const bucket: Bucket = silent ? "LEGACY" : bucket0;
    const reason = silent ? `${legacy.join("+")} · accepted-silently, then ${reason0} wrong` : reason0;
    const out: CaseVerdict = {
      relDir: c.relDir,
      area,
      bucket,
      reason,
      emitted: [],
      unexpected: [],
      failures: [],
      runtimeExecuted: false,
      vacuous: false,
      unimplementedCodes: [],
      legacyMarkers: legacy,
      ...rest,
    };
    if (bucket === "PASS" || bucket === "CODES-ONLY") out.vacuous = isVacuousPass(ex, boot.knownCodes, out.runtimeExecuted);
    if (bucket === "FAIL") out.unimplementedCodes = unimplementedRequired(ex, boot.knownCodes);
    return out;
  };
  const shape = validateExpectContainers(ex);
  if (shape.length > 0) return v("INVALID", "malformed expect", { failures: shape });

  const files = [
    ...Object.keys(c.auxFiles).sort().map((p) => ({ path: p, src: c.auxFiles[p] })),
    { path: "case.scrml", src: c.source },
  ];
  let fe: ReturnType<typeof frontEnd>;
  try {
    fe = frontEnd(boot.mods, files);
  } catch (e) {
    return v("CRASH", "front end threw", { failures: [String((e as Error)?.message ?? e).split("\n")[0]] });
  }
  const expectedCodes = new Set<string>(ex.codes ?? []);
  const emitted = [...new Set(fe.diags.map((d) => d.code))].sort();
  const unexpected = emitted.filter((code) => !expectedCodes.has(code));
  const base = { emitted, unexpected };

  if (legacy.length > 0 && unexpected.length > 0) return v("LEGACY", legacy.join("+"), base);
  if (unexpected.includes("E-BOOTSTRAP-UNSUPPORTED")) {
    const msgs = [...new Set(fe.diags.filter((d) => d.code === "E-BOOTSTRAP-UNSUPPORTED").map((d) => d.message))];
    return v("UNSUPPORTED", "bootstrap-unsupported", { ...base, failures: msgs });
  }
  const parseUnexpected = [...new Set(fe.parseDiags.map((d) => d.code))].filter((code) => !expectedCodes.has(code));
  if (parseUnexpected.length > 0 || unexpected.some((code) => PARSE_PHASE_HINT.test(code))) {
    const msgs = fe.parseDiags.filter((d) => !expectedCodes.has(d.code)).slice(0, 3).map((d) => `${d.code}: ${d.message}`);
    return v("UNSUPPORTED", "parse-reject", { ...base, failures: msgs });
  }

  const codeFailures = codesHalfFailures(ex, fe.diags, fe.infos);
  if (!hasRuntimeHalf(c)) {
    return codeFailures.length === 0 ? v("PASS", "codes", base) : v("FAIL", "codes", { ...base, failures: codeFailures });
  }
  const nonClient = nonClientRuntimeKeys(c);
  if (nonClient.length > 0) {
    return codeFailures.length === 0
      ? v("CODES-ONLY", `runtime half not executable: ${nonClient.join("+")}`, base)
      : v("FAIL", "codes", { ...base, failures: codeFailures });
  }

  // The client runtime half — execute the bootstrap's own artifact.
  const ill = boot.mods.check.checkCore(fe.core) as string[];
  if (ill.length > 0) {
    return v("FAIL", codeFailures.length ? "codes+runtime" : "runtime", {
      ...base,
      failures: [...codeFailures, `runtime: the lowered Core is ill-formed (check): ${ill.slice(0, 3).join("; ")}`],
    });
  }
  let rtFailures: string[];
  try {
    const out = boot.mods.print.printProgram(fe.core, "program.client.js", "scrml-runtime.js");
    const r = await runBootstrapArtifact(out.html, out.js, (ex.input ?? []) as InputStep[]);
    rtFailures = runtimeHalfFailures(ex, r);
  } catch (e) {
    return v("CRASH", "runtime half threw", {
      ...base,
      runtimeExecuted: true,
      failures: [...codeFailures, String((e as Error)?.message ?? e).split("\n")[0]],
    });
  }
  const all = [...codeFailures, ...rtFailures];
  if (all.length === 0) return v("PASS", "codes+runtime", { ...base, runtimeExecuted: true });
  const why = codeFailures.length && rtFailures.length ? "codes+runtime" : codeFailures.length ? "codes" : "runtime";
  return v("FAIL", why, { ...base, failures: all, runtimeExecuted: true });
}

// ---------------------------------------------------------------------------
// The run + report
// ---------------------------------------------------------------------------

export interface Report {
  total: number;
  attempted: number;
  filter: string | null;
  counts: Record<Bucket, number>;
  byArea: Map<string, Record<Bucket, number>>;
  legacyMarkerCounts: Record<string, number>;
  unsupportedReasons: Record<string, number>;
  runtimeExecuted: number;
  verdicts: CaseVerdict[];
  ms: number;
}

const zero = (): Record<Bucket, number> => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;

export async function runBootstrapConformance(boot: Bootstrap, cases: LoadedCase[], totalInCorpus: number, filter: string | null): Promise<Report> {
  const t0 = performance.now();
  const verdicts: CaseVerdict[] = [];
  for (const c of cases) verdicts.push(await classifyCase(boot, c));
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  const counts = zero();
  const byArea = new Map<string, Record<Bucket, number>>();
  const legacyMarkerCounts: Record<string, number> = {};
  const unsupportedReasons: Record<string, number> = {};
  let runtimeExecuted = 0;
  for (const v of verdicts) {
    counts[v.bucket]++;
    if (!byArea.has(v.area)) byArea.set(v.area, zero());
    byArea.get(v.area)![v.bucket]++;
    if (v.bucket === "LEGACY") for (const m of v.legacyMarkers) legacyMarkerCounts[m] = (legacyMarkerCounts[m] ?? 0) + 1;
    if (v.bucket === "UNSUPPORTED") unsupportedReasons[v.reason] = (unsupportedReasons[v.reason] ?? 0) + 1;
    if (v.runtimeExecuted) runtimeExecuted++;
  }
  return {
    total: totalInCorpus,
    attempted: cases.length,
    filter,
    counts,
    byArea,
    legacyMarkerCounts,
    unsupportedReasons,
    runtimeExecuted,
    verdicts,
    ms: performance.now() - t0,
  };
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);

/** The report as markdown (also the stdout form). Deterministic: no timing, no paths outside the repo. */
export function renderReport(r: Report): string {
  const L: string[] = [];
  const graded = r.counts.PASS + r.counts["CODES-ONLY"] + r.counts.FAIL;
  L.push(`Scope: **${r.attempted} of ${r.total} cases attempted**${r.filter ? ` (filter: \`${r.filter}\`)` : ""} — every attempted case reached the pure bootstrap (no impl#1 stage).`);
  L.push("");
  L.push("| bucket | cases | share of attempted |");
  L.push("|---|---:|---:|");
  for (const b of BUCKETS) L.push(`| ${b} | ${r.counts[b]} | ${pct(r.counts[b], r.attempted)} |`);
  L.push("");
  const held = r.counts.PASS + r.counts["CODES-ONLY"];
  const vac = r.verdicts.filter((v) => v.vacuous).length;
  const unimpl = r.verdicts.filter((v) => v.bucket === "FAIL" && v.unimplementedCodes.length > 0).length;
  L.push(`**Graded** (the bootstrap handled the case: PASS + CODES-ONLY + FAIL) = ${graded}; of those, `
    + `${held} hold (${pct(held, graded)}). `
    + `Runtime half executed on the bootstrap for ${r.runtimeExecuted} case(s).`);
  L.push("");
  L.push(`- **Vacuous** passes: ${vac} of ${held} — every assertion is the absence of a code the bootstrap's sources never mention, `
    + `so it would hold for any program. Non-vacuous holds: **${held - vac}**.`);
  L.push(`- FAILs whose required code appears nowhere in the bootstrap's sources (check not implemented): ${unimpl} of ${r.counts.FAIL}; `
    + `the other ${r.counts.FAIL - unimpl} are implemented checks that answered wrong.`);
  L.push("");
  L.push(`LEGACY by marker (a case may carry several): ${Object.entries(r.legacyMarkerCounts).sort().map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}.`);
  L.push(`UNSUPPORTED by reason: ${Object.entries(r.unsupportedReasons).sort().map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}.`);
  L.push("");
  L.push("### Per area (case directory)");
  L.push("");
  L.push(`| area | cases | ${BUCKETS.join(" | ")} |`);
  L.push(`|---|---:|${BUCKETS.map(() => "---:").join("|")}|`);
  for (const area of [...r.byArea.keys()].sort()) {
    const a = r.byArea.get(area)!;
    const n = BUCKETS.reduce((s, b) => s + a[b], 0);
    L.push(`| ${area} | ${n} | ${BUCKETS.map((b) => (a[b] ? String(a[b]) : "·")).join(" | ")} |`);
  }
  L.push("");
  for (const b of ["FAIL", "CRASH", "INVALID"] as const) {
    const vs = r.verdicts.filter((v) => v.bucket === b);
    L.push(`### ${b} (${vs.length})`);
    L.push("");
    if (vs.length === 0) L.push("none");
    for (const v of vs) {
      const un = v.unimplementedCodes.length ? `; not in the bootstrap: ${v.unimplementedCodes.join(", ")}` : "";
      L.push(`- \`${v.relDir}\` (${v.reason}${un})`);
      for (const f of v.failures) L.push(`  - ${f.length > 300 ? f.slice(0, 300) + "…" : f}`);
    }
    L.push("");
  }
  const silent = r.verdicts.filter((v) => v.bucket === "LEGACY" && v.reason.includes("accepted-silently"));
  L.push(`### LEGACY, accepted silently (${silent.length})`);
  L.push("");
  L.push("Legacy-dialect cases the bootstrap compiled with NO unexpected diagnostic and then answered wrong — not a");
  L.push("dialect parse failure: the bootstrap took a retired / unknown form as something else, with no W-lint (§66.21) and no refusal.");
  L.push("");
  if (silent.length === 0) L.push("none");
  for (const v of silent) L.push(`- \`${v.relDir}\` (${v.reason}): ${v.failures.slice(0, 2).join(" · ")}`);
  L.push("");
  const ps = r.verdicts.filter((v) => v.bucket === "PASS" || v.bucket === "CODES-ONLY");
  L.push(`### PASS / CODES-ONLY (${ps.length})`);
  L.push("");
  for (const v of ps) {
    L.push(`- \`${v.relDir}\` — ${v.bucket}${v.vacuous ? " · VACUOUS" : ""}${v.unexpected.length ? ` (also emitted, unasserted: ${v.unexpected.join(", ")})` : ""}`);
  }
  L.push("");
  const pr = r.verdicts.filter((v) => v.bucket === "UNSUPPORTED");
  L.push(`### UNSUPPORTED (${pr.length})`);
  L.push("");
  for (const v of pr) L.push(`- \`${v.relDir}\` — ${v.reason}: ${(v.failures[0] ?? "").slice(0, 200)}`);
  L.push("");
  return L.join("\n");
}

const REPORT_HEADER = `# Bootstrap conformance — generated

<!-- @generated by \`bun scripts/bootstrap-conformance.ts --write\` (change-id s449-bootstrap-conformance-counter). Do not hand-edit. -->

How many language-1.0 conformance cases (\`conformance/cases/**\`, the corpus impl#1 is graded on) the
PURE bootstrap (\`compiler/self-host-v2/\` front end + printer + runtime, no impl#1 stage) passes.
Bucket definitions: the header of \`scripts/bootstrap-conformance.ts\`. A TRACKING number, not a gate.
It is a run, not a static count, so it is NOT a \`docs/FACTS.md\` row (FACTS excludes run-derived figures).

`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1] ?? null;
  };
  const filter = opt("--filter");
  const casesDir = opt("--cases") ? resolve(opt("--cases")!) : DEFAULT_CASES_DIR;
  const jsonPath = opt("--json");
  const write = args.includes("--write");
  const failOnFail = args.includes("--fail-on-fail");
  const check = args.includes("--check");

  if (!existsSync(casesDir)) {
    console.error(`bootstrap-conformance: no case root ${casesDir}`);
    return 2;
  }
  const all = loadCases(casesDir);
  const cases = filter ? all.filter((c) => c.relDir.includes(filter)) : all;
  if (cases.length === 0) {
    console.error(`bootstrap-conformance: zero cases attempted (of ${all.length}) — not a valid run`);
    return 2;
  }
  let boot: Bootstrap;
  const tLoad = performance.now();
  try {
    boot = await loadBootstrapModules();
  } catch (e) {
    console.error(`bootstrap-conformance: the bootstrap failed to build/load — not a valid run:\n${(e as Error).message}`);
    return 2;
  }
  const loadMs = performance.now() - tLoad;
  const r = await runBootstrapConformance(boot, cases, all.length, filter);
  const body = renderReport(r);
  console.log(`bootstrap conformance (pure bootstrap, ${relative(REPO_ROOT, casesDir) || casesDir})\n`);
  console.log(body);
  console.log(`(bundle build ${(loadMs / 1000).toFixed(1)} s · cases ${(r.ms / 1000).toFixed(1)} s)`);
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ ...r, byArea: Object.fromEntries(r.byArea) }, null, 2) + "\n");
  if ((write || check) && (filter || casesDir !== DEFAULT_CASES_DIR)) {
    console.error("bootstrap-conformance: --write / --check need the full default corpus (no --filter / --cases)");
    return 2;
  }
  if (write) {
    writeFileSync(REPORT_PATH, REPORT_HEADER + body);
    console.error(`wrote ${relative(REPO_ROOT, REPORT_PATH)}`);
  }
  let stale = false;
  if (check) {
    const onDisk = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, "utf8") : "";
    stale = onDisk !== REPORT_HEADER + body;
    console.error(stale
      ? `bootstrap-conformance: ${relative(REPO_ROOT, REPORT_PATH)} is STALE — regenerate with --write`
      : `bootstrap-conformance: ${relative(REPO_ROOT, REPORT_PATH)} is current`);
  }
  if (failOnFail && r.counts.FAIL + r.counts.CRASH > 0) return 1;
  if (stale) return 1;
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`bootstrap-conformance: ${(e as Error)?.stack ?? e}`);
      process.exit(2);
    },
  );
}
