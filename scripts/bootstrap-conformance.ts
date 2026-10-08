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
 *                server (serverDb / firstPaint / ssr) or tool (stdout) run. The bootstrap emits
 *                no server or tool artifact, so that half is not attempted. (s454 U1b: a
 *                `serverStub` case IS executed — the stub answers the bootstrap's own client
 *                calls over its route manifest; see `stubFetch`.)
 *   FAIL         the bootstrap handled the case and got it WRONG: a required code missing, a
 *                forbidden code fired, a severity / count mismatch, or a runtime-half mismatch —
 *                or (a §66 twin only) it emitted an E- code the case does not assert
 *                (`twin-extra-error`: twins are generated, so a stray error is a defect signal).
 *                A FAIL is a bug or a divergence — the most useful output of this probe.
 *   LEGACY       (--no-twins only) the case is written in the legacy dialect (§66.21 retired
 *                forms — see LEGACY_MARKERS) AND the bootstrap emitted a code the case does not
 *                expect. The bootstrap front end parses only the §66 dialect; this bucket is NEVER a
 *                FAIL. (Honest note: §66.21 Stage 1 says a retired form "parses identically" with a
 *                W-lint, so this bucket is bootstrap debt, not a free pass.)
 *   NOT-TWINNED  (default) a legacy-dialect case whose §66 twin could not be generated: some
 *                construct in it (entry or aux file) is not mechanically rewritable by the
 *                `scrml fix` §66 rules, or a `dialect.s66` override excludes it. The reason is
 *                printed. All-or-nothing: a half-migrated file is never graded.
 *   UNSUPPORTED  a §66-dialect case the bootstrap refuses: an unexpected E-BOOTSTRAP-UNSUPPORTED
 *                (sub-reason `bootstrap-unsupported`), or an unexpected Error-severity PARSE-phase
 *                diagnostic (sub-reason `parse-reject` — a construct the bootstrap parser does not
 *                know; a parse-phase Warning / Info lint is an ACCEPTED form, not a reject; the
 *                case list is printed so a real parser bug cannot hide here).
 *   CRASH        the bootstrap THREW (front end, printer, or the runtime half) — not a verdict.
 *   INVALID      the case's own `expect` block is malformed (S365 container policy) — the
 *                contract cannot be evaluated by ANY implementation.
 *
 * ═══ §66 TWINS (S449 corpus-dialect ruling 1 — model M1) ═══
 *
 * A LEGACY-dialect case (a LEGACY_MARKERS hit, or any source the §66 fix rules change or cannot
 * rewrite) is graded on its §66 TWIN, generated AT TEST TIME by the `scrml fix` §66 rules
 * (compiler/src/commands/fix-s66.js — the single source of truth; nothing generated is
 * committed). Each twin verdict carries `twin: true`. Two per-case knobs:
 *   - `dialect.s66` (JSON, next to expected.json): `{ "exclude": "<reason>" }` keeps the case out
 *     of twinning (NOT-TWINNED), or `{ "expect": { … }, "reason": "<why>" }` replaces the twin's
 *     expectations (the legacy expected.json stays the contract for the legacy source).
 *   - SUPERSEDED_CODE_MAP (below; ruling 5): a code a twin's expectations name that §66 superseded
 *     is mapped to its §66 code — each row cites the SPEC section that superseded it. Applied
 *     only when the case has no `dialect.s66` expect.
 * `--no-twins` reproduces the pre-twin measurement (legacy cases graded as written, LEGACY bucket).
 *
 * Severity (s451-boot-diag-severity): every bootstrap `Diag` (ast.scrml) carries its §34 severity
 * ("Error" | "Warning" | "Info"), derived from its code by the generated table
 * compiler/self-host-v2/severity.scrml. A case asserting `severity` is graded against it, per
 * occurrence, in both streams. "Error" is also what the twin-extra-error rule and the no-artifact
 * message key on — never the code's prefix (§34 makes E-DG-002 a Warning, many W- codes Info). A
 * diagnostic with no severity field is reported "severity unobservable" (a bootstrap defect).
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
 *   bun scripts/bootstrap-conformance.ts --no-twins      grade legacy cases as written (pre-twin)
 *
 * ═══ EXIT STATUS (separate from the output — pa-base §8) ═══
 *
 *   0  a VALID measurement was taken (whatever the numbers say). This is a TRACKING probe, not a
 *      gate: a red exit over a known backlog would be the §8 cry-wolf shape.
 *   1  only with --fail-on-fail (a FAIL or a CRASH was found) or --check (the report file is stale).
 *      CI runs `--check` in the NON-BLOCKING `tracking` job on every PR, and (S457) as a BLOCKING
 *      `gate` step on a pull request whose diff touches `conformance/cases/**` or
 *      `compiler/self-host-v2/**` — the report's STALENESS blocks there, never its FAIL count.
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
import { fixS66, S66_RULES } from "../compiler/src/commands/fix-s66.js";
import { frontEnd as sharedFrontEnd } from "../compiler/self-host-v2/slice-m2/lowered.js";

/**
 * The rules a twin is generated with: the §66 dialect class — every `scrml fix` rule EXCEPT
 * `arm-pipe` (§19.4.5, S452). The `|`-led arm is a §63 spelling deprecation whose legacy form is
 * itself in the conformance contract during the window (§63.5: W-ARM-PIPE-LEGACY is
 * conformance-required), so a case written in it must be graded AS WRITTEN, not on a pipe-less twin.
 * `client-server-call` (§19.9.10, S454 F8) is excluded too: it changes what a case MEANS to the
 * bootstrap (it adds a handler), so it is applied to the corpus source (reviewed, committed), never
 * silently at grading time. `sql-failable` (§19.8.3, S451 R11) likewise: it adds a handler to an
 * unhandled `?{}`.
 */
const TWIN_RULES = S66_RULES.filter((r) => r !== "arm-pipe" && r !== "client-server-call" && r !== "sql-failable");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF_HOST_V2 = join(REPO_ROOT, "compiler", "self-host-v2");
const BOOT_RUNTIME = join(SELF_HOST_V2, "slice-m1", "runtime", "runtime.js");
export const DEFAULT_CASES_DIR = join(REPO_ROOT, "conformance", "cases");
export const REPORT_PATH = join(REPO_ROOT, "docs", "bootstrap-conformance.md");

export type Bucket = "PASS" | "CODES-ONLY" | "FAIL" | "LEGACY" | "NOT-TWINNED" | "UNSUPPORTED" | "CRASH" | "INVALID";
export const BUCKETS: readonly Bucket[] = ["PASS", "CODES-ONLY", "FAIL", "LEGACY", "NOT-TWINNED", "UNSUPPORTED", "CRASH", "INVALID"];

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
  /** The subset of `unexpected` the bootstrap emitted at §34 severity Error (sorted). */
  unexpectedErrors: string[];
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
  /** Graded on the generated §66 twin (not the source as written). */
  twin: boolean;
  /** Twin: the fix rules that rewrote it (sorted, distinct). */
  twinRules: string[];
  /** Twin: the SUPERSEDED_CODE_MAP rows applied to its expectations (`FROM→TO`). */
  mapped: string[];
  /** Twin: a `dialect.s66` override was used ("expect" | "exclude"), else null. */
  override: "expect" | "exclude" | null;
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
// §66 twins (S449 corpus-dialect rulings 1 + 5)
// ---------------------------------------------------------------------------

export const DIALECT_OVERRIDE_FILE = "dialect.s66";

export interface DialectOverride {
  exclude?: string;
  expect?: Record<string, unknown>;
  reason?: string;
}

/** Read a case's `dialect.s66` override, or null. A malformed file is an error, never ignored. */
export function readDialectOverride(caseDir: string): DialectOverride | null {
  const p = join(caseDir, DIALECT_OVERRIDE_FILE);
  if (!existsSync(p)) return null;
  const o = JSON.parse(readFileSync(p, "utf8")) as DialectOverride;
  const hasEx = typeof o.exclude === "string" && o.exclude.trim() !== "";
  const hasExpect = o.expect !== undefined;
  if (hasEx === hasExpect) throw new Error(`${p}: exactly one of "exclude" (a reason) or "expect" (+ "reason") is required`);
  if (hasExpect && (typeof o.expect !== "object" || o.expect === null || Array.isArray(o.expect))) throw new Error(`${p}: "expect" must be an object`);
  if (hasExpect && !(typeof o.reason === "string" && o.reason.trim() !== "")) throw new Error(`${p}: an "expect" override needs a "reason"`);
  return o;
}

/**
 * SUPERSEDED_CODE_MAP (ruling 5) — a code a legacy case asserts whose rule §66 superseded, and the
 * code the §66 twin answers instead. Each APPLIED row cites the SPEC text that supersedes the old
 * rule AND names the new code. A row whose new code no SPEC section names is NOT applied (status
 * "owed"): grading a twin against an unnamed code would make the counter, not the SPEC, the
 * contract. Engines first; the rest of the superseded families are listed as owed.
 *
 * OWED FAMILIES (no rows yet — none of their cases is twinned today, so none is graded): §65 theme
 * codes (E-THEME-*, §66.17 — the theme body is not mechanically twinned, O17); §15/§16 component +
 * slot codes (E-COMPONENT-*, §66.15 — components are hand-migrated); §6.6 derived-cell codes whose
 * subject is the `const <x>` spelling (E-DERIVED-*, §66.9 rule 7); §6.3 compound codes (Tier 2 is
 * not twinned yet). Each gets rows when the fix rules start twinning its cases.
 */
export interface CodeMapRow {
  from: string;
  to: string | null;
  status: "applied" | "owed";
  spec: string;
}
export const SUPERSEDED_CODE_MAP: readonly CodeMapRow[] = [
  {
    from: "E-ENGINE-VAR-DUPLICATE",
    to: "E-SCOPE-010",
    status: "applied",
    spec: "§66.20 retires E-ENGINE-VAR-DUPLICATE with the <engine> element and §51.0.C auto-naming; §66.13.3 — the declaration's name IS its variable, so a second declaration of that name is a duplicate file-scope binding, E-SCOPE-010 (§7.6).",
  },
  {
    from: "E-ENGINE-STATE-CHILD-INVALID-VARIANT",
    to: null,
    status: "owed",
    spec: "§66.2.2 O52 (RULED S435): a state-child must name a variant of the enclosing enum-valued field, checked at the type stage — no §66.20 code is named, and §66.20 does not retire this code (so it is retained). The bootstrap answers the unnamed E-DECL-STATE-CHILD.",
  },
  {
    from: "E-ENGINE-RULE-INVALID-VARIANT",
    to: null,
    status: "owed",
    spec: "§66.13.2: a `rule=` names variants of the field's enum — no §66.20 code is named, and §66.20 does not retire this code (retained). The bootstrap answers the unnamed E-DECL-STATE-CHILD.",
  },
  {
    from: "E-ENGINE-INITIAL-INVALID-VARIANT",
    to: null,
    status: "owed",
    spec: "§66.13.3: `initial=.X` becomes the declaration's own value `=.X`; no §66.20 code is named for a variant the type lacks, and §66.20 does not retire this code (retained). The bootstrap answers the unnamed E-TYPE-VARIANT.",
  },
  {
    from: "E-CELL-NO-RENDER-SPEC",
    to: null,
    status: "owed",
    spec: "§66.20: its fire condition under §66 is OPEN (O51, §66.6.8); it polices the legacy Shape-1 `<x/>` during the window.",
  },
  {
    from: "E-CELL-RENDER-SPEC-NOT-BINDABLE",
    to: null,
    status: "owed",
    spec: "§66.20: retires with the right-hand-side form (no §66 successor named).",
  },
  {
    from: "E-DECL-RHS-INTERP-WRAPPED",
    to: null,
    status: "owed",
    spec: "§66.20: retires with the right-hand-side form (no §66 successor named).",
  },
  {
    from: "E-COMPONENT-010",
    to: null,
    status: "owed",
    spec: "§66.20: E-COMPONENT-010..-014 retire with the `props={…}` block (components are not mechanically twinned).",
  },
];

/** Apply the APPLIED rows of SUPERSEDED_CODE_MAP to an expect block (codes / notCodes / severity / codeCounts keys). */
export function mapSupersededCodes(ex: Record<string, any>): { expect: Record<string, any>; mapped: string[] } {
  const rows = new Map(SUPERSEDED_CODE_MAP.filter((r) => r.status === "applied" && r.to).map((r) => [r.from, r.to as string]));
  const mapped = new Set<string>();
  const m = (c: string) => {
    const to = rows.get(c);
    if (to) mapped.add(`${c}→${to}`);
    return to ?? c;
  };
  const out: Record<string, any> = { ...ex };
  if (Array.isArray(ex.codes)) out.codes = ex.codes.map(m);
  if (Array.isArray(ex.notCodes)) out.notCodes = ex.notCodes.map(m);
  if (ex.severity && typeof ex.severity === "object") out.severity = Object.fromEntries(Object.entries(ex.severity).map(([k, v]) => [m(k), v]));
  if (ex.codeCounts && typeof ex.codeCounts === "object") out.codeCounts = Object.fromEntries(Object.entries(ex.codeCounts).map(([k, v]) => [m(k), v]));
  return { expect: out, mapped: [...mapped].sort() };
}

export interface Twin {
  /** The case is legacy-dialect (a marker, or the fix rules change / refuse something). */
  candidate: boolean;
  /** Every file rewrote with no blocker. */
  twinned: boolean;
  source: string;
  auxFiles: Record<string, string>;
  rules: string[];
  /** `file:line rule: reason` for every blocker (empty when twinned). */
  blockers: string[];
}

/** Generate a case's §66 twin with the `scrml fix` §66 rules (entry + every aux file). */
export function twinOf(c: { source: string; auxFiles: Record<string, string> }): Twin {
  const rules = new Set<string>();
  const blockers: string[] = [];
  let changed = false;
  const entry = fixS66(c.source, { filePath: "case.scrml", entry: true, auxSources: c.auxFiles, rules: TWIN_RULES });
  for (const a of entry.applied) rules.add(a.rule);
  for (const b of entry.blockers) blockers.push(`case.scrml:${b.line} ${b.rule}: ${b.reason}`);
  changed ||= entry.changed;
  const auxFiles: Record<string, string> = {};
  for (const p of Object.keys(c.auxFiles).sort()) {
    const others = { ...c.auxFiles, "case.scrml": c.source };
    delete others[p];
    const r = fixS66(c.auxFiles[p], { filePath: p, entry: false, auxSources: others, rules: TWIN_RULES });
    for (const a of r.applied) rules.add(a.rule);
    for (const b of r.blockers) blockers.push(`${p}:${b.line} ${b.rule}: ${b.reason}`);
    changed ||= r.changed;
    auxFiles[p] = r.output;
  }
  const candidate = legacyMarkers(c.source).length > 0 || changed || blockers.length > 0;
  return { candidate, twinned: candidate && blockers.length === 0, source: entry.output, auxFiles, rules: [...rules].sort(), blockers };
}

// ---------------------------------------------------------------------------
// The bootstrap
// ---------------------------------------------------------------------------

interface Diag {
  code: string;
  /** The code's §34 severity — "Error" | "Warning" | "Info" (compiler/self-host-v2/severity.scrml). */
  severity?: string;
  message: string;
  file: string;
}

/** A diagnostic's §34 severity as a conformance `severity` value ("error" | "warning" | "info"), or null. */
export function severityOfDiag(d: Diag): string | null {
  return typeof d.severity === "string" ? d.severity.toLowerCase() : null;
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
  for (const m of ["parse", "link", "analyze", "lower", "check", "print"]) {
    if (!mods[m]) throw new Error(`bootstrap module '${m}' missing from the slice-m2 bundle`);
  }
  const knownCodes = codeLiterals((M2_MODULES as string[]).map((m) => readFileSync(join(SELF_HOST_V2, m), "utf8")));
  return { mods, knownCodes };
}

/**
 * The front end, phase-separated: the ONE driver, compiler/self-host-v2/slice-m2/lowered.js
 * `frontEnd` (s452-boot-determinism — this used to be a copy of it that read the entry off the
 * list's last position). The file SET goes in in any order; link.scrml canonicalizes it (path
 * order, then link order), so a verdict is a function of the case's files alone. The entry is
 * named. The PARSE-phase diagnostics are kept apart — they decide the `parse-reject` bucket.
 */
function frontEnd(mods: Record<string, any>, files: Array<{ path: string; src: string }>, entry: string) {
  const r = sharedFrontEnd(mods, files, entry);
  // `infos`: the bootstrap's non-fatal I- notes (s449 — SPEC §55.17.6 I-FORM-SUBMIT-GATED "reports in
  // the warnings stream"), kept apart from `diags` by the bootstrap.
  return { core: r.core, parseDiags: r.parseDiags as Diag[], diags: r.diags as Diag[], infos: ((r.infos ?? []) as Diag[]) };
}

/** Code-unit order (no locale): the report's order cannot depend on the build host's locale. */
export function codeUnitCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The runtime half's server/tool selectors — halves the bootstrap emits no artifact for.
 *  (s454 U1b: `serverStub` is not one — its stub answers the client artifact's calls.) */
export function nonClientRuntimeKeys(c: LoadedCase): string[] {
  const e = c.expected.expect as Record<string, unknown>;
  return ["serverDb", "firstPaint", "stdout", "ssr"].filter((k) => e[k] !== undefined && e[k] !== false);
}

/** A route of the bootstrap's client artifact (print.scrml `Output.routes` — the manifest). */
export type BootRoute = { fn: string; path: string; value: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(v, k);

/**
 * s454 (U1b, design Item 3.4) — the bootstrap's `serverStub` adapter: a `fetch` that answers the
 * client artifact's calls (`rt.call` POSTs to a route of the manifest) with HTTP-shaped responses,
 * keyed — like impl#1's adapter — by the IMPL-NEUTRAL scrml-source function name. The bootstrap's
 * client decodes STRICTLY (§57.4 R10), so the stub's values are read under impl#2's wire rules:
 *   - a plain value → 200 + its JSON (a raw `null` is not absence: the §57.2 envelope is);
 *   - `null` / no stub, for a function that yields no value → 204 (the no-value contract); no stub
 *     for a value function → 200 `null` (impl#1's "deterministic empty 200" — which a strict
 *     client reads as Malformed);
 *   - `{ "__serverError": { type, variant, data?, status? } }` → `status` (default 500, §19.9.2) + the
 *     §57.8 `fail` envelope `{ __scrml_error: true, type, variant, data }` (`data` absent → `{}`, the
 *     §57.8 shape of a variant with no fields);
 *   - `{ "__httpError": { status, body? } }` → that status + the raw body (no envelope);
 *   - `{ "__batches": [r0, …] }` → batch 0 (the bootstrap has no body split — U1d — so a route is
 *     one batch).
 * An impl#1-shaped error stub (`type: "CpsError"`) answering a function with another declared enum
 * is therefore `Transport(Malformed)` on the bootstrap — the case's `_` arm still catches it.
 */
export function stubFetch(stub: Record<string, unknown>, routes: BootRoute[]) {
  const response = (status: number, text: string) => ({ status, text: () => Promise.resolve(text) });
  return async (input: unknown): Promise<unknown> => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    const r = routes.find((x) => x.path === url);
    let body: unknown = r && own(stub, r.fn) ? stub[r.fn] : undefined;
    if (isObj(body) && Array.isArray(body.__batches)) body = (body.__batches as unknown[])[0];
    if (isObj(body) && own(body, "__serverError")) {
      const e = body.__serverError as { type?: unknown; variant?: unknown; data?: unknown; status?: unknown };
      const status = typeof e.status === "number" ? e.status : 500;
      return response(status, JSON.stringify({ __scrml_error: true, type: e.type, variant: e.variant, data: e.data === undefined ? {} : e.data }));
    }
    if (isObj(body) && own(body, "__httpError")) {
      const h = body.__httpError as { status?: unknown; body?: unknown };
      const status = typeof h.status === "number" ? h.status : 500;
      return response(status, JSON.stringify(h.body === undefined ? { error: "Internal server error", detail: "" } : h.body));
    }
    if (body === undefined || body === null) {
      if (r && !r.value) return response(204, "");
      return response(200, "null");
    }
    return response(200, JSON.stringify(body));
  };
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
async function runBootstrapArtifact(html: string, js: string, input: InputStep[], serverStub: Record<string, unknown> | undefined, routes: BootRoute[]) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  // s454 (U1b): the client artifact's server calls are answered by the case's stub (none: every call 501-free empty)
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = stubFetch(serverStub ?? {}, routes);
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
    (globalThis as any).fetch = realFetch;
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
 * are the union of BOTH streams (`diags` and the non-fatal `infos`). Severity is each diagnostic's
 * own §34 severity (the `severity` field the bootstrap derives from the code); every occurrence of
 * an asserted code must carry the asserted severity.
 */
export function codesHalfFailures(ex: Record<string, any>, diags: Diag[], infos: Diag[] = []): string[] {
  const all = diags.concat(infos);
  const emitted = new Set(all.map((d) => d.code));
  const counts: Record<string, number> = {};
  for (const d of all) counts[d.code] = (counts[d.code] ?? 0) + 1;
  const out: string[] = [];
  for (const c of ex.codes ?? []) if (!emitted.has(c)) out.push(`missing ${c}`);
  for (const c of ex.notCodes ?? []) if (emitted.has(c)) out.push(`forbidden ${c} fired`);
  for (const p of ex.notCodePrefixes ?? []) for (const c of emitted) if (c.startsWith(p)) out.push(`forbidden family ${p}* fired: ${c}`);
  for (const [c, want] of Object.entries(ex.severity ?? {})) {
    if (!emitted.has(c)) { out.push(`severity: ${c} did not fire (expected ${want})`); continue; }
    const got = [...new Set(all.filter((d) => d.code === c).map(severityOfDiag))];
    if (got.includes(null)) out.push(`severity unobservable: ${c} fired with no severity on its Diag (expected ${want})`);
    else if (got.some((g) => g !== want)) out.push(`severity: ${c} fired as ${got.sort().join("+")} (expected ${want})`);
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

export interface ClassifyOptions {
  /** Grade legacy-dialect cases on their generated §66 twin (default true). */
  twins?: boolean;
}

/** Classify ONE case on the bootstrap. Never throws (a throw is the CRASH bucket). */
export async function classifyCase(boot: Bootstrap, c: LoadedCase, opts: ClassifyOptions = {}): Promise<CaseVerdict> {
  const ex0 = c.expected.expect as Record<string, any>;
  const legacy = legacyMarkers(c.source);
  if (opts.twins === false) return gradeCase(boot, c, { source: c.source, auxFiles: c.auxFiles, ex: ex0, legacy });
  const area = c.relDir.split("/")[0];
  const notTwinned = (reason: string, failures: string[], override: CaseVerdict["override"] = null): CaseVerdict => ({
    relDir: c.relDir, area, bucket: "NOT-TWINNED", reason, emitted: [], unexpected: [], unexpectedErrors: [], failures, runtimeExecuted: false,
    vacuous: false, unimplementedCodes: [], legacyMarkers: legacy, twin: false, twinRules: [], mapped: [], override,
  });
  let tw: Twin;
  try {
    tw = twinOf(c);
  } catch (e) {
    return notTwinned("fix threw", [String((e as Error)?.message ?? e).split("\n")[0]]);
  }
  if (!tw.candidate) return gradeCase(boot, c, { source: c.source, auxFiles: c.auxFiles, ex: ex0, legacy: [] });
  let ov: DialectOverride | null;
  try {
    ov = readDialectOverride(c.dir);
  } catch (e) {
    return { ...notTwinned("malformed dialect.s66", [String((e as Error).message)]), bucket: "INVALID" };
  }
  if (ov?.exclude) return notTwinned(`excluded (dialect.s66): ${ov.exclude}`, [], "exclude");
  if (!tw.twinned) return notTwinned(`not mechanical: ${summarizeBlockers(tw.blockers)}`, tw.blockers);
  const { expect: mappedEx, mapped } = ov?.expect ? { expect: ov.expect as Record<string, any>, mapped: [] } : mapSupersededCodes(ex0);
  const ex = { codes: [], notCodes: [], ...mappedEx };
  const verdict = await gradeCase(boot, c, { source: tw.source, auxFiles: tw.auxFiles, ex, legacy: [] });
  const out: CaseVerdict = { ...verdict, legacyMarkers: legacy, twin: true, twinRules: tw.rules, mapped, override: ov?.expect ? "expect" : null };
  // A twin is GENERATED: an error the case does not assert is a codemod-defect signal (or a
  // bootstrap one), never a free pass. A passing twin that emitted one is graded FAIL.
  const extraErrors = out.unexpectedErrors;
  if ((out.bucket === "PASS" || out.bucket === "CODES-ONLY") && extraErrors.length > 0) {
    return {
      ...out,
      bucket: "FAIL",
      reason: "twin-extra-error",
      vacuous: false,
      failures: [`twin emitted unasserted error(s): ${extraErrors.join(", ")}`],
      unimplementedCodes: unimplementedRequired(ex, boot.knownCodes),
    };
  }
  return out;
}

/** A blocker list as one short, stable reason (the distinct `rule: reason` texts, first 3). */
export function summarizeBlockers(blockers: string[]): string {
  const distinct = [...new Set(blockers.map((b) => b.replace(/^[^ ]+ /, "")))];
  return distinct.slice(0, 3).join(" · ") + (distinct.length > 3 ? ` · (+${distinct.length - 3} more)` : "");
}

interface GradeInput {
  source: string;
  auxFiles: Record<string, string>;
  ex: Record<string, any>;
  legacy: string[];
}

/** Grade one (source, expectations) pair on the bootstrap. Never throws. */
async function gradeCase(boot: Bootstrap, c: LoadedCase, g: GradeInput): Promise<CaseVerdict> {
  const area = c.relDir.split("/")[0];
  const ex = g.ex;
  const legacy = g.legacy;
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
      unexpectedErrors: [],
      failures: [],
      runtimeExecuted: false,
      vacuous: false,
      unimplementedCodes: [],
      legacyMarkers: legacy,
      twin: false,
      twinRules: [],
      mapped: [],
      override: null,
      ...rest,
    };
    if (bucket === "PASS" || bucket === "CODES-ONLY") out.vacuous = isVacuousPass(ex, boot.knownCodes, out.runtimeExecuted);
    if (bucket === "FAIL") out.unimplementedCodes = unimplementedRequired(ex, boot.knownCodes);
    return out;
  };
  const shape = validateExpectContainers(ex);
  if (shape.length > 0) return v("INVALID", "malformed expect", { failures: shape });

  // the case's file SET (its aux imports + the entry); the front end orders it
  const files = [
    ...Object.keys(g.auxFiles).map((p) => ({ path: p, src: g.auxFiles[p] })),
    { path: "case.scrml", src: g.source },
  ];
  let fe: ReturnType<typeof frontEnd>;
  try {
    fe = frontEnd(boot.mods, files, "case.scrml");
  } catch (e) {
    return v("CRASH", "front end threw", { failures: [String((e as Error)?.message ?? e).split("\n")[0]] });
  }
  const expectedCodes = new Set<string>(ex.codes ?? []);
  const emitted = [...new Set(fe.diags.map((d) => d.code))].sort();
  const unexpected = emitted.filter((code) => !expectedCodes.has(code));
  const errorCodes = new Set(fe.diags.concat(fe.infos).filter((d) => severityOfDiag(d) !== "warning" && severityOfDiag(d) !== "info").map((d) => d.code));
  const unexpectedErrors = unexpected.filter((code) => errorCodes.has(code));
  const base = { emitted, unexpected, unexpectedErrors };

  if (legacy.length > 0 && unexpected.length > 0) return v("LEGACY", legacy.join("+"), base);
  if (unexpected.includes("E-BOOTSTRAP-UNSUPPORTED")) {
    const msgs = [...new Set(fe.diags.filter((d) => d.code === "E-BOOTSTRAP-UNSUPPORTED").map((d) => d.message))];
    return v("UNSUPPORTED", "bootstrap-unsupported", { ...base, failures: msgs });
  }
  // s452-boot-arm-pipe: only an ERROR-severity parse diagnostic is a parse rejection. A parse-phase
  // Warning / Info (W-ARM-PIPE-LEGACY, §19.4.5 — the first one) means the parser KNEW the form and
  // accepted it (§34: Warning and Info "do not fail the compile"); it is graded like any other
  // unasserted non-error code (allowed), never bucketed UNSUPPORTED.
  const parseRejects = fe.parseDiags.filter((d) => !expectedCodes.has(d.code) && errorCodes.has(d.code));
  if (parseRejects.length > 0 || unexpected.some((code) => PARSE_PHASE_HINT.test(code))) {
    const msgs = parseRejects.slice(0, 3).map((d) => `${d.code}: ${d.message}`);
    return v("UNSUPPORTED", "parse-reject", { ...base, failures: msgs });
  }

  const codeFailures = codesHalfFailures(ex, fe.diags, fe.infos);
  // The runtime-half selectors are read off the EFFECTIVE expectations (a twin's override may differ).
  const cx = { ...c, expected: { ...c.expected, expect: ex } } as LoadedCase;
  if (!hasRuntimeHalf(cx)) {
    return codeFailures.length === 0 ? v("PASS", "codes", base) : v("FAIL", "codes", { ...base, failures: codeFailures });
  }
  const nonClient = nonClientRuntimeKeys(cx);
  if (nonClient.length > 0) {
    return codeFailures.length === 0
      ? v("CODES-ONLY", `runtime half not executable: ${nonClient.join("+")}`, base)
      : v("FAIL", "codes", { ...base, failures: codeFailures });
  }

  // The client runtime half — execute the bootstrap's own artifact.
  // s451: a compile with an error has no Core (lower.scrml's diagnostics gate), so no artifact
  // exists to execute — the runtime half cannot hold.
  if (fe.core == null) {
    return v("FAIL", codeFailures.length ? "codes+runtime" : "runtime", {
      ...base,
      failures: [...codeFailures, `runtime: no artifact — the compile reported an error (${emitted.filter((c) => errorCodes.has(c)).join(", ")})`],
    });
  }
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
    // s451 (U1a): a printer refusal is an unsupported construct, not a verdict on the case.
    // (s454 U1b: a program with server functions prints its client artifact.)
    if (out.refused && out.refused.length > 0) {
      return v("UNSUPPORTED", "bootstrap-unsupported", { ...base, failures: out.refused });
    }
    const r = await runBootstrapArtifact(out.html, out.js, (ex.input ?? []) as InputStep[], ex.serverStub as Record<string, unknown> | undefined, (out.routes ?? []) as BootRoute[]);
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
  /** Legacy cases graded on their §66 twin (false = --no-twins). */
  twins: boolean;
  /** NOT-TWINNED: cases per distinct blocker reason (a case counts once per reason). */
  notTwinnedReasons: Record<string, number>;
}

const zero = (): Record<Bucket, number> => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;

export async function runBootstrapConformance(
  boot: Bootstrap,
  cases: LoadedCase[],
  totalInCorpus: number,
  filter: string | null,
  opts: ClassifyOptions = {},
): Promise<Report> {
  const t0 = performance.now();
  const verdicts: CaseVerdict[] = [];
  for (const c of cases) verdicts.push(await classifyCase(boot, c, opts));
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  const counts = zero();
  const byArea = new Map<string, Record<Bucket, number>>();
  const legacyMarkerCounts: Record<string, number> = {};
  const unsupportedReasons: Record<string, number> = {};
  const notTwinnedReasons: Record<string, number> = {};
  let runtimeExecuted = 0;
  for (const v of verdicts) {
    if (v.bucket === "NOT-TWINNED") {
      const keys = v.override === "exclude" ? ["excluded by dialect.s66"] : [...new Set(v.failures.map(normalizeBlocker))];
      for (const k of keys) notTwinnedReasons[k] = (notTwinnedReasons[k] ?? 0) + 1;
    }
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
    twins: opts.twins !== false,
    notTwinnedReasons,
  };
}

/** A blocker line without its file:line and its quoted specifics — the reason FAMILY. */
export function normalizeBlocker(b: string): string {
  return b.replace(/^[^ ]+ /, "").replace(/`[^`]*`/g, "`…`").replace(/\.[A-Z][\w]*/g, ".X").replace(/\d+ enums/, "N enums");
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
  if (r.twins) {
    const tw = r.verdicts.filter((v) => v.twin);
    const twBy = (b: Bucket) => tw.filter((v) => v.bucket === b).length;
    const twHeld = twBy("PASS") + twBy("CODES-ONLY");
    const twVac = tw.filter((v) => v.vacuous).length;
    L.push("### §66 twins (S449 dialect ruling 1 — generated at test time by the `scrml fix` §66 rules)");
    L.push("");
    L.push(`Legacy-dialect cases graded on their generated §66 twin: **${tw.length}** — `
      + BUCKETS.filter((b) => twBy(b) > 0).map((b) => `${b} ${twBy(b)}`).join(" · ")
      + `. Twin holds ${twHeld} (non-vacuous ${twHeld - twVac}). Every twin verdict above is included in the bucket table.`);
    const ovE = r.verdicts.filter((v) => v.override === "expect").length;
    const ovX = r.verdicts.filter((v) => v.override === "exclude").length;
    const mapped = r.verdicts.filter((v) => v.mapped.length > 0);
    L.push(`- \`dialect.s66\` overrides: ${ovE} replace a twin's expectations · ${ovX} exclude a case.`);
    L.push(`- Superseded-code mappings applied: ${mapped.length} case(s)${mapped.length ? ` (${[...new Set(mapped.flatMap((v) => v.mapped))].sort().join(", ")})` : ""}. `
      + `Rows: ${SUPERSEDED_CODE_MAP.map((m) => `${m.from}→${m.to ?? "∅"} [${m.status}]`).join(" · ")}.`);
    L.push("");
    L.push(`NOT-TWINNED by reason (${r.counts["NOT-TWINNED"]} cases; a case counts once per distinct reason):`);
    L.push("");
    const nt = Object.entries(r.notTwinnedReasons).sort((a, b) => b[1] - a[1] || codeUnitCmp(a[0], b[0]));
    if (nt.length === 0) L.push("none");
    for (const [k, n] of nt) L.push(`- ${n} — ${k}`);
    L.push("");
  }
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
      L.push(`- \`${v.relDir}\` (${v.twin ? "twin · " : ""}${v.reason}${un}${v.mapped.length ? `; mapped ${v.mapped.join(", ")}` : ""})`);
      for (const f of v.failures) L.push(`  - ${f.length > 300 ? f.slice(0, 300) + "…" : f}`);
    }
    L.push("");
  }
  const silent = r.verdicts.filter((v) => v.bucket === "LEGACY" && v.reason.includes("accepted-silently"));
  if (!r.twins) {
    // (twin mode has no LEGACY bucket: a legacy case is twinned or NOT-TWINNED)
    L.push(`### LEGACY, accepted silently (${silent.length})`);
    L.push("");
    L.push("Legacy-dialect cases the bootstrap compiled with NO unexpected diagnostic and then answered wrong — not a");
    L.push("dialect parse failure: the bootstrap took a retired / unknown form as something else, with no W-lint (§66.21) and no refusal.");
    L.push("");
    if (silent.length === 0) L.push("none");
    for (const v of silent) L.push(`- \`${v.relDir}\` (${v.reason}): ${v.failures.slice(0, 2).join(" · ")}`);
    L.push("");
  }
  const ps = r.verdicts.filter((v) => v.bucket === "PASS" || v.bucket === "CODES-ONLY");
  L.push(`### PASS / CODES-ONLY (${ps.length})`);
  L.push("");
  for (const v of ps) {
    L.push(`- \`${v.relDir}\` — ${v.bucket}${v.twin ? " · TWIN" : ""}${v.vacuous ? " · VACUOUS" : ""}${v.unexpected.length ? ` (also emitted, unasserted: ${v.unexpected.join(", ")})` : ""}`);
  }
  L.push("");
  const pr = r.verdicts.filter((v) => v.bucket === "UNSUPPORTED");
  L.push(`### UNSUPPORTED (${pr.length})`);
  L.push("");
  for (const v of pr) L.push(`- \`${v.relDir}\` — ${v.twin ? "twin · " : ""}${v.reason}: ${(v.failures[0] ?? "").slice(0, 200)}`);
  L.push("");
  if (r.twins) {
    const nt = r.verdicts.filter((v) => v.bucket === "NOT-TWINNED");
    L.push(`### NOT-TWINNED (${nt.length})`);
    L.push("");
    for (const v of nt) L.push(`- \`${v.relDir}\` — ${v.reason.slice(0, 240)}`);
    L.push("");
  }
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
  const twins = !args.includes("--no-twins");

  if (!existsSync(casesDir)) {
    console.error(`bootstrap-conformance: no case root ${casesDir}`);
    return 2;
  }
  // loadCases orders by `localeCompare` (host-locale dependent); this report orders by code unit
  const all = loadCases(casesDir).sort((a, b) => codeUnitCmp(a.relDir, b.relDir));
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
  const r = await runBootstrapConformance(boot, cases, all.length, filter, { twins });
  const body = renderReport(r);
  console.log(`bootstrap conformance (pure bootstrap, ${relative(REPO_ROOT, casesDir) || casesDir})\n`);
  console.log(body);
  console.log(`(bundle build ${(loadMs / 1000).toFixed(1)} s · cases ${(r.ms / 1000).toFixed(1)} s)`);
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ ...r, byArea: Object.fromEntries(r.byArea) }, null, 2) + "\n");
  if ((write || check) && (filter || casesDir !== DEFAULT_CASES_DIR || !twins)) {
    console.error("bootstrap-conformance: --write / --check need the full default corpus with twins (no --filter / --cases / --no-twins)");
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
