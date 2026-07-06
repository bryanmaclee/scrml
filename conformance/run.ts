/**
 * Conformance runner — codes (a) half + runtime-effect (b) half.
 *
 * Each case dir holds `case.scrml` + `expected.json`. The runner checks:
 *
 *   (a) CODES   — emitted ⊇ expect.codes  AND  emitted ∩ expect.notCodes = ∅
 *       (SUPERSET, not exact: real compiles emit incidental codes the source
 *       conf tests ignore; presence, not line/col — SCOPE OQ3).
 *
 *   (b) RUNTIME — when expect carries any of { input, dom, domAnchored, state }:
 *       compile + execute the artifact in a DOM (adapter `run()`), drive the
 *       input sequence, then assert:
 *         - state       : merged {cells, derived} snapshot ⊇ expect.state
 *         - dom         : whole-tree normalized <body> === expect.dom
 *         - domAnchored : per-selector assertions hold on the live <body>
 *       HARD INVARIANT: the (b) half reads the POST-run LIVE DOM, never the
 *       static .html (DD OQ1 step 1).
 *
 * Run directly:  `bun conformance/run.ts`   (exits non-zero on any failure)
 * Or via bun:test: conformance/conformance-corpus.test.js
 */
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { compile } from "./adapters/impl1-ts.ts";
import {
  run,
  runServer,
  runTool,
  runAnchored,
  type InputStep,
  type AnchoredAssertion,
  type ServerStub,
  type ServerDb,
  type FirstPaintAssertion,
} from "./adapters/impl1-ts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

export interface ExpectedCase {
  id: string;
  description: string;
  "language-version": string;
  "source-test"?: string;
  "runtime-half-pending"?: boolean;
  "runtime-half-ref"?: string;
  /** OQ4 — MANDATORY spec anchor for (b) runtime cases (the soundness gate). */
  spec?: string;
  rationale?: string;
  expect: {
    codes: string[];
    notCodes: string[];
    /** Family-glob ABSENCE: no emitted code may start with any of these prefixes
     *  (e.g. ["E-FORMFOR-"] asserts the whole E-FORMFOR-* family stays silent). */
    notCodePrefixes?: string[];
    /** Per-code §34 severity assertion ("error" | "warning" | "info"). A case may
     *  assert a code fires AS error vs warning; the adapter's byCode honors the
     *  partition (a W-/I- code never lands in the errors stream). */
    severity?: Record<string, "error" | "warning" | "info">;
    // (b) runtime-effect half:
    input?: InputStep[];
    /** Whole-tree canonical normalized <body> (OQ1 default mode). */
    dom?: string;
    /** Anchored per-selector assertions (OQ1 brittleness escape / authoring surface). */
    domAnchored?: AnchoredAssertion[];
    /** Final state-cell values — compared against merged {cells, derived}. */
    state?: Record<string, unknown>;
    /** §52 server-fn responses — keyed by the IMPL-NEUTRAL scrml-SOURCE fn name
     *  (never impl#1's route encoding). Each value is a plain JSON wire value
     *  (success / the §57.2 `{"__scrml_absent":true}` absence envelope) OR the
     *  impl-neutral error directive `{ "__serverError": { type, variant, data?,
     *  status? } }`. The adapter mocks fetch over the compiler-emitted route and
     *  (for errors) translates the directive to impl#1's wire envelope. */
    serverStub?: ServerStub;
    /** E-ADAPTER server-eval seed (impl-neutral, keyed by TABLE name → rows).
     *  Its presence opts the case OUT of the verbatim `serverStub` mock and INTO
     *  running the REAL emitted server bundle: the §14.8.9 redaction sink + §52.8
     *  SSR compose actually execute (the client observes redacted data / the
     *  composed first-paint). Mutually exclusive with `serverStub`. */
    serverDb?: ServerDb;
    /** E-ADAPTER SSR mode: compose the §52.8 first-paint (`_scrml_ssr_compose_
     *  handler`), mount THAT + seed `window.__scrml_ssr_state`, then hydrate.
     *  Implied by `firstPaint`; set explicitly to hydrate without a first-paint
     *  assertion. Requires `serverDb`. */
    ssr?: boolean;
    /** §52.8 first-paint assertions ({contains,notContains}) on the composed SSR
     *  HTML. Presence enables SSR mode (requires `serverDb`). */
    firstPaint?: FirstPaintAssertion;
    /** §20.7 / §64 — a `kind="tool"` program's exact stdout. Its presence
     *  selects the tool-run half: compile the tool, RUN the emitted `.js` with
     *  `bun`, and assert the captured stdout EQUALS this string (byte-exact —
     *  print()/println() write RAW, undecorated program output). */
    stdout?: string;
  };
}

export interface LoadedCase {
  dir: string;
  relDir: string;
  source: string;
  expected: ExpectedCase;
  /** Aux `.scrml` fixtures in the case dir (the `files` multi-file convention):
   *  every `*.scrml` besides `case.scrml`, keyed by filename, for import graphs. */
  auxFiles: Record<string, string>;
}

export interface CaseResult {
  id: string;
  relDir: string;
  pass: boolean;
  emitted: string[];
  missing: string[]; // required codes that did NOT fire
  forbidden: string[]; // notCodes that DID fire
  prefixViolations: string[]; // emitted codes matching a forbidden family prefix
  severityMismatches: string[]; // codes whose §34 severity != the asserted one
  runtimeHalfPending: boolean;
  /** Runtime (b) half failures (empty when the case has no runtime half or it passed). */
  runtimeFailures: string[];
  hasRuntimeHalf: boolean;
}

/** Recursively collect every leaf case dir (one holding case.scrml + expected.json). */
export function loadCases(casesDir: string = CASES_DIR): LoadedCase[] {
  const out: LoadedCase[] = [];
  const stack: string[] = [casesDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const scrml = join(dir, "case.scrml");
    const exp = join(dir, "expected.json");
    if (existsSync(scrml) && existsSync(exp)) {
      const expected = JSON.parse(readFileSync(exp, "utf8")) as ExpectedCase;
      const ex = expected.expect ?? { codes: [], notCodes: [] };
      ex.codes = ex.codes ?? [];
      ex.notCodes = ex.notCodes ?? [];
      expected.expect = ex;
      // `files` convention: every *.scrml besides case.scrml is an aux import
      // fixture written alongside the entry at compile/run time (§21.3).
      const auxFiles: Record<string, string> = {};
      for (const entry of readdirSync(dir)) {
        if (entry !== "case.scrml" && entry.endsWith(".scrml")) {
          auxFiles[entry] = readFileSync(join(dir, entry), "utf8");
        }
      }
      out.push({
        dir,
        relDir: relative(casesDir, dir),
        source: readFileSync(scrml, "utf8"),
        expected,
        auxFiles,
      });
      continue; // a case dir is a leaf — do not descend further
    }
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) stack.push(p);
    }
  }
  return out.sort((a, b) => a.relDir.localeCompare(b.relDir));
}

/** True when the case declares any (b) runtime-effect expectation. */
export function hasRuntimeHalf(c: LoadedCase): boolean {
  const e = c.expected.expect;
  return (
    e.input !== undefined ||
    e.dom !== undefined ||
    e.domAnchored !== undefined ||
    e.state !== undefined ||
    e.serverStub !== undefined ||
    e.serverDb !== undefined ||
    e.firstPaint !== undefined ||
    e.stdout !== undefined
  );
}

/** Stable structural equality (order-insensitive for plain objects). */
function stableKey(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableKey).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableKey(o[k])).join(",") + "}";
}
function deepEqual(a: unknown, b: unknown): boolean {
  return stableKey(a) === stableKey(b);
}

/** Run one case's CODES (a) half through impl#1 and diff against the contract. */
export function runCase(c: LoadedCase): CaseResult {
  const { codes: emitted, byCode } = compile(c.source, c.auxFiles);
  const emittedSet = new Set(emitted);
  const ex = c.expected.expect;
  const missing = ex.codes.filter((code) => !emittedSet.has(code));
  const forbidden = ex.notCodes.filter((code) => emittedSet.has(code));

  // notCodePrefixes — family-glob ABSENCE: no emitted code may start with a
  // forbidden prefix.
  const prefixViolations: string[] = [];
  for (const prefix of ex.notCodePrefixes ?? []) {
    for (const code of emitted) {
      if (code.startsWith(prefix)) prefixViolations.push(code + " (matches forbidden " + prefix + "*)");
    }
  }

  // severity — per-code §34 partition assertion (cross-stream honest).
  const severityMismatches: string[] = [];
  if (ex.severity) {
    for (const code of Object.keys(ex.severity)) {
      const want = ex.severity[code];
      const got = byCode[code];
      if (got === undefined) {
        severityMismatches.push("code '" + code + "' did not fire (expected severity " + want + ")");
      } else if (got !== want) {
        severityMismatches.push("code '" + code + "' severity expected " + want + ", got " + got);
      }
    }
  }

  return {
    id: c.expected.id,
    relDir: c.relDir,
    pass:
      missing.length === 0 &&
      forbidden.length === 0 &&
      prefixViolations.length === 0 &&
      severityMismatches.length === 0,
    emitted,
    missing,
    forbidden,
    prefixViolations,
    severityMismatches,
    runtimeHalfPending: c.expected["runtime-half-pending"] === true,
    runtimeFailures: [],
    hasRuntimeHalf: hasRuntimeHalf(c),
  };
}

/**
 * Run one case's RUNTIME (b) half — compile + execute + drive + assert
 * state/dom/domAnchored. Returns the failure list (empty = pass). A case with
 * no runtime half returns an empty list.
 */
export async function runCaseRuntime(c: LoadedCase): Promise<string[]> {
  if (!hasRuntimeHalf(c)) return [];
  const e = c.expected.expect;
  const failures: string[] = [];

  // §20.7 / §64 — `stdout` selects the tool-run half: a `kind="tool"` program
  // has no client boundary (no DOM), so compile + RUN the emitted module with
  // `bun` and assert its captured stdout byte-for-byte. Standalone (returns
  // early — a tool case carries no dom/state/server half).
  if (e.stdout !== undefined) {
    const tr = runTool(c.source, c.auxFiles);
    if (tr.stdout !== e.stdout) {
      failures.push(
        "stdout mismatch:\n    expected: " + JSON.stringify(e.stdout) +
          "\n    got:      " + JSON.stringify(tr.stdout) +
          (tr.stderr ? "\n    stderr:   " + JSON.stringify(tr.stderr) : ""),
      );
    }
    return failures;
  }

  // E-ADAPTER: `serverDb` selects server-eval mode (run the REAL emitted server
  // handlers so the §14.8.9 redaction sink + §52.8 SSR compose execute); absent
  // it, the verbatim `serverStub` mock path. `firstPaint` (or explicit `ssr`)
  // selects the SSR compose→hydrate flow.
  const ssr = e.ssr === true || e.firstPaint !== undefined;
  const r =
    e.serverDb !== undefined
      ? await runServer(c.source, { input: e.input ?? [], auxFiles: c.auxFiles, serverDb: e.serverDb, ssr })
      : await run(c.source, e.input ?? [], c.auxFiles, e.serverStub ?? {});

  // firstPaint — §52.8 composed first-paint substring assertions (SSR mode). The
  // contains-set proves the server pre-rendered the rows into view-source; the
  // notContains-set proves §14.8.9 redaction stripped the protected column.
  if (e.firstPaint) {
    const fp = (r as { firstPaint?: string }).firstPaint;
    if (fp === undefined) {
      failures.push("firstPaint: no composed first-paint (SSR mode not engaged / no compose handler)");
    } else {
      for (const s of e.firstPaint.contains ?? []) {
        if (!fp.includes(s)) failures.push("firstPaint: expected to contain " + JSON.stringify(s));
      }
      for (const s of e.firstPaint.notContains ?? []) {
        if (fp.includes(s)) failures.push("firstPaint: expected NOT to contain " + JSON.stringify(s));
      }
    }
  }

  // state — merged {cells, derived}, expected is a subset.
  if (e.state) {
    const merged: Record<string, unknown> = { ...r.state.cells, ...r.state.derived };
    for (const k of Object.keys(e.state)) {
      if (!(k in merged)) {
        failures.push("state: cell '" + k + "' absent from snapshot");
      } else if (!deepEqual(merged[k], e.state[k])) {
        failures.push(
          "state: cell '" + k + "' expected " + JSON.stringify(e.state[k]) +
            ", got " + JSON.stringify(merged[k]),
        );
      }
    }
  }

  // dom — whole-tree canonical compare (OQ1 default mode).
  if (e.dom !== undefined && r.dom !== e.dom) {
    failures.push("dom (whole-tree) mismatch:\n    expected: " + JSON.stringify(e.dom) + "\n    got:      " + JSON.stringify(r.dom));
  }

  // domAnchored — per-selector assertions on the live <body> (OQ1 anchored mode).
  if (e.domAnchored) {
    const anchored = runAnchored(r.body, e.domAnchored);
    for (const f of anchored.failures) failures.push("domAnchored: " + f);
  }

  return failures;
}

export async function runAll(casesDir: string = CASES_DIR): Promise<{
  results: CaseResult[];
  passed: number;
  failed: number;
}> {
  const cases = loadCases(casesDir);
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = runCase(c);
    if (r.hasRuntimeHalf) {
      r.runtimeFailures = await runCaseRuntime(c);
      if (r.runtimeFailures.length > 0) r.pass = false;
    }
    results.push(r);
  }
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, failed: results.length - passed };
}

async function main(): Promise<void> {
  const { results, passed, failed } = await runAll();
  for (const r of results) {
    const tag = r.pass ? "PASS" : "FAIL";
    const rt = r.runtimeHalfPending ? "  [runtime-half-pending]" : r.hasRuntimeHalf ? "  [runtime]" : "";
    console.log(`${tag}  ${r.relDir}${rt}`);
    if (!r.pass) {
      if (r.missing.length > 0) {
        console.log(`        missing required codes: ${JSON.stringify(r.missing)}`);
      }
      if (r.forbidden.length > 0) {
        console.log(`        forbidden codes present: ${JSON.stringify(r.forbidden)}`);
      }
      if (r.missing.length > 0 || r.forbidden.length > 0 || r.prefixViolations.length > 0) {
        console.log(`        emitted: ${JSON.stringify(r.emitted)}`);
      }
      for (const f of r.prefixViolations) {
        console.log(`        forbidden-prefix: ${f}`);
      }
      for (const f of r.severityMismatches) {
        console.log(`        severity: ${f}`);
      }
      for (const f of r.runtimeFailures) {
        console.log(`        runtime: ${f}`);
      }
    }
  }
  console.log(
    `\nconformance (impl#1): ${passed}/${results.length} cases pass` +
      (failed > 0 ? `, ${failed} FAILED` : ""),
  );
  process.exit(failed === 0 ? 0 : 1);
}

// `import.meta.main` is a Bun extension (true when run as the entrypoint).
if ((import.meta as unknown as { main?: boolean }).main) main();
