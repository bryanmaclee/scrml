/**
 * Conformance runner — codes (a) half + runtime-effect (b) half.
 *
 * Each case dir holds `case.scrml` + `expected.json`. The runner checks:
 *
 *   (a) CODES   — emitted ⊇ expect.codes  AND  emitted ∩ expect.notCodes = ∅
 *       (SUPERSET, not exact: real compiles emit incidental codes the source
 *       conf tests ignore; presence, not line/col — SCOPE OQ3).
 *       Both halves are SET-valued and therefore blind to CARDINALITY. The
 *       optional `expect.codeCounts` is the exact-count escape: it asserts a
 *       named code fired exactly N times, which is the only assertion here that
 *       can see a DOUBLE FIRE. Opt-in and additive — a case without the key is
 *       checked exactly as before.
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
 *   (c) XFAIL   — per-IMPLEMENTATION expected failure (S430 P7). A case may carry
 *       `"xfail": { "impl1-ts": { "gap": "<gap-id>", "fails": <signature> } }`: the case
 *       pins the CORRECT behaviour, impl#1 (TS) is known not to have it, the named gap
 *       is `status=carried` in docs/known-gaps.md (owed by the bootstrap, not by impl#1),
 *       and `fails` records HOW impl#1 fails it (see XfailSignature). Outcomes:
 *         - fails WITH the recorded signature -> XFAIL (not a failure; names the gap)
 *         - fails with a DIFFERENT signature  -> FAIL  (a new failure is not covered by
 *           the carried gap; the diff is printed)
 *         - PASSES on the named impl -> XPASS  (A FAILURE — the gap is fixed, so the
 *           mark must come off and the gap be resolved; a mark cannot stay silently)
 *         - names a gap that is absent, or not `status=carried` -> a FAILURE
 *         - a `status=carried` gap that NO case names          -> a FAILURE
 *       and every run prints `N xfail of M` so a hatch absorbing the suite shows up as
 *       a ratio rather than needing inspection (pa-base §8, the absorbed escape hatch).
 *
 * Run directly:  `bun conformance/run.ts`   (exits non-zero on any failure)
 * Or via bun:test: conformance/conformance-corpus.test.js
 */
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { compile, IMPL_ID } from "./adapters/impl1-ts.ts";
// The gap ledger's OWN marker parser + integrity guards (duplicate-id conflict, malformed marker,
// unclassified status) — one parser for the marker grammar, never a second regex beside it.
import { parseGapMarkers, gapCountsFromTokens, GAP_STATUS_CARRIED } from "../scripts/state.ts";
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
const GAP_LEDGER = join(HERE, "..", "docs", "known-gaps.md");

/**
 * The implementation ids an `xfail` block may name. A key outside this list is a HARD error, not a
 * no-op: `"xfail": { "impl1": … }` (a typo) would otherwise mark nothing, and the case would simply go
 * red — safe, but the author would read the red as the gap and not the typo.
 *
 * ⚑ Only impl#1 is listed. Under S430 P7 the bootstrap (impl#2) is REQUIRED to pass every case, so an
 * impl#2 xfail is a contradiction of the ruling, not a missing feature. Adding an id here is a ruling
 * change, and belongs with the impl#2 adapter that would consume it.
 */
export const KNOWN_IMPL_IDS: readonly string[] = [IMPL_ID];

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
  /** S430 P7 — per-implementation EXPECTED FAILURE: impl id -> { gap: the `status=carried` gap id
   *  that explains it, fails: the recorded failure signature }. See the header's (c) paragraph,
   *  `XfailSignature` and `resolveXfail`. */
  xfail?: Record<string, { gap: string; fails: { codes?: string[]; runtime?: string } }>;
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
    /** Per-code EXACT OCCURRENCE COUNT — the cardinality assertion.
     *
     *  `codes` is a SUPERSET presence check and `notCodes` an absence check, so
     *  both are set-valued: a code that fires TWICE is indistinguishable from one
     *  that fires once. That is a real blind spot, not a theoretical one — the
     *  §4.12.3 nested-program contract is "ONE diagnostic per unbuilt
     *  declaration, never two, never none", and nothing in a set-based harness
     *  can read the "never two" half.
     *
     *  `codeCounts` is checked EXACTLY: the listed code must fire exactly N
     *  times. `N: 0` is a legal and meaningful assertion (a strictly stronger
     *  `notCodes`). Codes NOT listed are unconstrained — the key is per-code, not
     *  a whole-emission exact-match, so it composes with the superset contract.
     *
     *  OPTIONAL and ADDITIVE: a case without the key behaves exactly as before. */
    codeCounts?: Record<string, number>;
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
    /** Fork A opt-in (real-DB conformance adapter). `"real"` runs the emitted
     *  server against a REAL seeded Bun.SQL in-memory SQLite (Fork B: DDL from
     *  the case's `<schema>`, loose-infer fallback) — so WHERE / bound params /
     *  JOIN / RETURNING / aggregate / DDL constraints behave as at deploy. Every
     *  existing case omits this field and keeps the byte-identical regex stub
     *  (`"stub"`, the default) — zero regression. Requires `serverDb`; a
     *  `"real"` case whose seeded table has no `<schema>` DDL must be
     *  loose-inferable (a non-empty seed) or the harness errors. */
    sqlEngine?: "stub" | "real";
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

/**
 * THE `expect` CONTAINER POLICY (S365) — decided ONCE for the whole vocabulary, not per key.
 *
 * A malformed CONTAINER silently disables the assertion it holds. Measured across 883-case runs:
 *
 *   severity: {} / null / []          -> all PASS   (falsy or zero-key: the loop never runs)
 *   notCodePrefixes: [] / null / ""   -> all PASS   (`?? []` swallows null; "" iterates to nothing)
 *   notCodePrefixes: {}               -> the ENTIRE 883-case run dies, `TypeError: {} is not iterable`
 *   codes: null                       -> PASS       (`ex.codes ?? []` coerced it to a no-op)
 *
 * So the harness had BOTH failure directions at once: a malformed container could turn a case green,
 * or it could take down every other case in the corpus. `codeCounts` was hardened against this in
 * isolation at the same review; the policy below is that treatment generalised rather than a second
 * pattern minted beside it — the per-key container check that used to live inline in the codeCounts
 * block is GONE, replaced by this table.
 *
 * THE RULES:
 *   1. An ABSENT key is free. Every key here is optional-and-additive; omitting it is the documented
 *      way to assert nothing.
 *   2. An empty ARRAY is a legal NO-OP, identical in meaning to omitting the key. `notCodePrefixes:
 *      []` honestly reads "no families forbidden", and 466 `codes: []` / 404 `notCodes: []` /
 *      31 `input: []` cases in the live corpus depend on it.
 *   3. A container that does not CONFORM to the declared kind is a HARD ERROR — `{}` where an array
 *      belongs, `null`, `""`, a number, a boolean. It is malformed under every reading, so there is
 *      nothing to interpret.
 *   4. An empty RECORD is a hard error wherever the record IS the assertion (`severity`,
 *      `codeCounts`, `state`, `firstPaint`). There is no reading of an empty severity map as an
 *      assertion. "I wrote the key and it asserted nothing" is never a pass.
 *   5. `serverStub` / `serverDb` are the deliberate exception to rule 4, and the ONLY one: they are a
 *      MOCK TABLE and a SEED, not assertions, and their mere presence selects a run MODE (real-server
 *      / SSR). An empty seed is therefore a coherent thing to write, so emptiness is allowed here
 *      while the shape is still enforced. Whether an empty seed SHOULD be legal is a semantics
 *      question this policy deliberately does not answer.
 *
 * A violation FAILS ONE CASE with a diagnostic. It never throws: a harness that dies on one
 * malformed case file cannot report on the other 882, which is a robustness bug independent of the
 * policy above.
 *
 * ⚑ KEEP IN LOCKSTEP WITH `ExpectedCase["expect"]` ABOVE. A key in the interface and not in this
 * table is rejected as unknown; a key here and not in the interface is untyped. Adding an assertion
 * key means editing both — which is the point: an unrecognised key (say `notCodePrefix`, singular)
 * is a silently-disabled assertion, the exact defect this policy exists to close.
 */
type ExpectShape =
  | { kind: "stringArray" }
  | { kind: "objectArray" }
  | { kind: "record"; empty: "reject" | "allow"; values?: readonly string[] }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] };

const EXPECT_SHAPES: Record<string, ExpectShape> = {
  // (a) codes half
  codes: { kind: "stringArray" },
  notCodes: { kind: "stringArray" },
  notCodePrefixes: { kind: "stringArray" },
  severity: { kind: "record", empty: "reject", values: ["error", "warning", "info"] },
  codeCounts: { kind: "record", empty: "reject" },
  // (b) runtime half
  input: { kind: "objectArray" },
  dom: { kind: "string" },
  domAnchored: { kind: "objectArray" },
  state: { kind: "record", empty: "reject" },
  serverStub: { kind: "record", empty: "allow" },   // a MOCK TABLE, not an assertion — see rule 5
  serverDb: { kind: "record", empty: "allow" },     // a SEED, not an assertion — see rule 5
  sqlEngine: { kind: "enum", values: ["stub", "real"] },
  ssr: { kind: "boolean" },
  firstPaint: { kind: "record", empty: "reject" },
  stdout: { kind: "string" },
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Human-readable container description, for a diagnostic that names what was actually written. */
function describeContainer(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "an empty array" : "an array";
  if (typeof v === "object") return Object.keys(v).length === 0 ? "an empty object {}" : "an object";
  return `a ${typeof v} (${JSON.stringify(v)})`;
}

/**
 * Validate every container in a case's `expect` block against EXPECT_SHAPES.
 *
 * EXPORTED so the policy is drivable from a test — a validator that can only be reached by running
 * the whole corpus is indistinguishable from one that never fires.
 *
 * Returns a list of diagnostics; empty means the contract is well-formed. Pure: reads only `ex`.
 */
export function validateExpectContainers(ex: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(ex)) {
    return [`expect is ${describeContainer(ex)} — it must be an object holding the assertion keys`];
  }

  for (const key of Object.keys(ex)) {
    const shape = EXPECT_SHAPES[key];
    if (!shape) {
      errors.push(
        `expect.${key} is not a recognised assertion key — it asserts NOTHING. ` +
          `Known keys: ${Object.keys(EXPECT_SHAPES).sort().join(", ")}`,
      );
      continue;
    }
    const v = (ex as Record<string, unknown>)[key];

    switch (shape.kind) {
      case "stringArray":
      case "objectArray": {
        if (!Array.isArray(v)) {
          errors.push(
            `expect.${key} is ${describeContainer(v)}, not an array — a present-but-malformed ` +
              `container silently disables the whole assertion. Omit the key, or write [].`,
          );
          break;
        }
        // An empty array is a legal no-op (rule 2). Element types are still checked.
        const wantString = shape.kind === "stringArray";
        v.forEach((el, i) => {
          const ok = wantString ? typeof el === "string" : isPlainObject(el);
          if (!ok) {
            errors.push(
              `expect.${key}[${i}] is ${describeContainer(el)} — expected ` +
                `${wantString ? "a string" : "an object"}`,
            );
          }
        });
        break;
      }
      case "record": {
        if (!isPlainObject(v)) {
          errors.push(
            `expect.${key} is ${describeContainer(v)}, not an object — a present-but-malformed ` +
              `container silently disables the whole assertion. Omit the key rather than writing one ` +
              `that cannot fail.`,
          );
          break;
        }
        if (shape.empty === "reject" && Object.keys(v).length === 0) {
          errors.push(
            `expect.${key} is present but EMPTY — it asserts nothing. Omit the key (it is optional) ` +
              `rather than writing an assertion that cannot fail.`,
          );
          break;
        }
        if (shape.values) {
          for (const [k, val] of Object.entries(v)) {
            if (typeof val !== "string" || !shape.values.includes(val)) {
              errors.push(
                `expect.${key}['${k}'] is ${JSON.stringify(val)} — expected one of ` +
                  shape.values.map((s) => JSON.stringify(s)).join(" | "),
              );
            }
          }
        }
        break;
      }
      case "string":
        if (typeof v !== "string") {
          errors.push(`expect.${key} is ${describeContainer(v)} — expected a string`);
        }
        break;
      case "boolean":
        if (typeof v !== "boolean") {
          errors.push(`expect.${key} is ${describeContainer(v)} — expected a boolean`);
        }
        break;
      case "enum":
        if (typeof v !== "string" || !shape.values.includes(v)) {
          errors.push(
            `expect.${key} is ${describeContainer(v)} — expected one of ` +
              shape.values.map((s) => JSON.stringify(s)).join(" | "),
          );
        }
        break;
    }
  }

  return errors;
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
  countMismatches: string[]; // codes whose OCCURRENCE COUNT != the asserted one
  /** Malformed `expect` containers (S365) — a contract too broken to evaluate. When non-empty the
   *  case fails on THIS alone and no assertion is attempted: a container that silently disables an
   *  assertion must never be reported as the assertion passing. */
  shapeErrors: string[];
  runtimeHalfPending: boolean;
  /** Runtime (b) half failures (empty when the case has no runtime half or it passed). */
  runtimeFailures: string[];
  /** Per runtime failure, the normalised/structured key the xfail signature hashes (parallel to
   *  runtimeFailures; filled by evaluateCase). Empty => the signature normalises runtimeFailures. */
  runtimeSignatureKeys?: string[];
  /** Per-code occurrence count of everything the compile emitted (the xfail signature pins the
   *  E-* multiset from it, so a NEW error on a carried case is not absorbed). */
  emittedCounts?: Record<string, number>;
  hasRuntimeHalf: boolean;
}

/** S430 P7 — the four outcomes of a case once its `xfail` mark is taken into account. */
export type Outcome = "pass" | "fail" | "xfail" | "xpass";

/**
 * THE EXPECTED-FAILURE SIGNATURE (S430 P7, round 2).
 *
 * A mark that says only "this case fails" absorbs EVERY failure of the case — including a brand-new
 * regression on a carried case, which would then read XFAIL forever (pa-base §8, the absorbed escape
 * hatch, at the scale of a triage that may mark hundreds of cases). So a mark records HOW the case
 * fails, derived from the case's own two contract halves, and any other failure is a plain FAIL:
 *
 *   codes   — the exact, sorted set of failed codes-half assertions, one string each:
 *               `missing:<code>` · `forbidden:<code>` · `prefix:<violation>` ·
 *               `severity:<mismatch>` · `codeCounts:<mismatch>`
 *             PLUS the MULTISET of every E-* code the compile emitted, `emitted:<code>=<n>`
 *             (review round: `missing:E-X` alone does not pin what the compiler emits INSTEAD, so
 *             a new unrelated error on a carried case would stay XFAIL; multiplicity matters).
 *             Readable on purpose: a reviewer can see which codes the carried gap is about.
 *   runtime — `sha256:<16 hex>` over the sorted runtime-half failure KEYS: the failure line with
 *             run-to-run volatile parts normalised (normalizeVolatile), or, for a tool run, a
 *             structured record { expected stdout, actual stdout, exit code, error head } — never
 *             raw stderr. The keys carry the DOM / state diff (which cell, expected vs got; which
 *             anchored selector), so the digest moves when the runtime failure changes in any way.
 *             A digest rather than the text because a whole-tree DOM diff is too large to pin
 *             readably in a JSON file; the run prints the lines themselves under every XFAIL.
 *
 * Either key is omitted when that half does not fail. The signature of a passing case is `{}`, and an
 * empty recorded signature is rejected — a mark cannot pin "fails in no way".
 *
 * Capture it mechanically: `bun conformance/run.ts --xfail-signature <case-id>`.
 */
export interface XfailSignature {
  codes?: string[];
  runtime?: string;
}

/** A resolved, validated mark for one implementation. */
export interface XfailMark {
  gap: string;
  fails: XfailSignature;
}

const RUNTIME_DIGEST_RE = /^sha256:[0-9a-f]{16}$/;

/** The observed failure signature of a result (see XfailSignature). `{}` for a passing case. */
export function failureSignature(r: CaseResult): XfailSignature {
  const codes = [
    ...r.missing.map((c) => "missing:" + c),
    ...r.forbidden.map((c) => "forbidden:" + c),
    ...r.prefixViolations.map((s) => "prefix:" + s),
    ...r.severityMismatches.map((s) => "severity:" + s),
    ...r.countMismatches.map((s) => "codeCounts:" + s),
  ];
  // The E-* multiset is part of HOW the case fails — but only of a case that fails. A passing
  // case's signature stays `{}` (XPASS is decided before signatures are compared).
  const fails = codes.length > 0 || r.runtimeFailures.length > 0;
  if (fails) {
    for (const [code, n] of Object.entries(r.emittedCounts ?? {})) {
      if (code.startsWith("E-")) codes.push(`emitted:${code}=${n}`);
    }
  }
  codes.sort();
  const sig: XfailSignature = {};
  if (codes.length > 0) sig.codes = codes;
  if (r.runtimeFailures.length > 0) {
    const keys =
      r.runtimeSignatureKeys && r.runtimeSignatureKeys.length === r.runtimeFailures.length
        ? r.runtimeSignatureKeys
        : r.runtimeFailures.map(normalizeVolatile);
    const h = createHash("sha256").update([...keys].sort().join("\n")).digest("hex");
    sig.runtime = "sha256:" + h.slice(0, 16);
  }
  return sig;
}

/** Canonical form for comparison: codes sorted, empty halves dropped. */
function canonicalSignature(s: XfailSignature): XfailSignature {
  const out: XfailSignature = {};
  if (s.codes && s.codes.length > 0) out.codes = [...s.codes].sort();
  if (s.runtime !== undefined) out.runtime = s.runtime;
  return out;
}

/** Human-readable differences between a recorded and an observed signature (empty = identical). */
export function signatureDiff(expected: XfailSignature, observed: XfailSignature): string[] {
  const e = canonicalSignature(expected);
  const o = canonicalSignature(observed);
  const out: string[] = [];
  const eCodes = new Set(e.codes ?? []);
  const oCodes = new Set(o.codes ?? []);
  for (const c of oCodes) if (!eCodes.has(c)) out.push(`codes: NEW failure not in the recorded signature: ${c}`);
  for (const c of eCodes) if (!oCodes.has(c)) out.push(`codes: recorded failure no longer occurs: ${c}`);
  if (e.runtime !== o.runtime) {
    out.push(
      `runtime: recorded ${e.runtime ?? "(runtime half passes)"}, observed ${o.runtime ?? "(runtime half passes)"}`,
    );
  }
  return out;
}

export interface EvaluatedCase extends CaseResult {
  /** The carried gap this case is expected to fail for on THIS impl, or null when unmarked. */
  xfailGap: string | null;
  /** The recorded failure signature for THIS impl, or null when unmarked. */
  expectedSignature: XfailSignature | null;
  /** The failure signature actually observed on this run (`{}` when every assertion held). */
  observedSignature: XfailSignature;
  /** Recorded-vs-observed differences for a marked case that FAILED. Non-empty => outcome "fail". */
  signatureMismatch: string[];
  /** A malformed / dangling `xfail` declaration. Non-empty => outcome "fail", whatever the assertions say. */
  xfailErrors: string[];
  outcome: Outcome;
  /** true iff the outcome is green in the gate: pass or xfail. XPASS is NOT ok. */
  ok: boolean;
}

/** Gap id -> status, read through scripts/state.ts's own parser and integrity guards. */
export type GapStatusIndex = ReadonlyMap<string, string>;

/**
 * Build the gap-status index from a known-gaps ledger. EXPORTED so a test can hand the xfail logic a
 * synthetic ledger — the live one carries no `status=carried` gap yet, and a gate whose accepting path
 * can only be reached by editing the live ledger is a gate whose accepting path is never exercised.
 */
export function gapStatusIndexFromText(text: string): GapStatusIndex {
  // gapCountsFromTokens dedups one-marker-per-id, THROWS on a conflicting duplicate and on an
  // unclassified status — the same refusals the §0 counts make. A ledger the counts refuse is not a
  // ledger an xfail can be resolved against either.
  const { tokens } = gapCountsFromTokens(parseGapMarkers(text));
  return new Map(tokens.map((t) => [t.id, t.status]));
}

let liveGapIndex: GapStatusIndex | null = null;
/** The live docs/known-gaps.md index, parsed once per process. */
export function loadGapStatusIndex(): GapStatusIndex {
  if (!liveGapIndex) liveGapIndex = gapStatusIndexFromText(readFileSync(GAP_LEDGER, "utf8"));
  return liveGapIndex;
}

/** Validate a recorded `fails` signature. Returns errors (empty = well-formed). */
function validateSignature(where: string, f: unknown): string[] {
  if (!isPlainObject(f)) {
    return [`${where}.fails is ${describeContainer(f)} — expected { "codes"?: string[], "runtime"?: "sha256:<16 hex>" }`];
  }
  const errors: string[] = [];
  for (const key of Object.keys(f)) {
    if (key !== "codes" && key !== "runtime") errors.push(`${where}.fails.${key} is not a signature key (codes, runtime)`);
  }
  if ("codes" in f) {
    const c = f.codes;
    if (!Array.isArray(c) || c.length === 0 || c.some((s) => typeof s !== "string" || s === "")) {
      errors.push(`${where}.fails.codes is ${describeContainer(c)} — expected a NON-EMPTY array of strings (omit the key when the codes half passes)`);
    }
  }
  if ("runtime" in f) {
    if (typeof f.runtime !== "string" || !RUNTIME_DIGEST_RE.test(f.runtime)) {
      errors.push(`${where}.fails.runtime is ${describeContainer(f.runtime)} — expected "sha256:<16 lowercase hex>"`);
    }
  }
  if (!("codes" in f) && !("runtime" in f)) {
    errors.push(`${where}.fails is EMPTY — a signature must pin at least one failing half (codes and/or runtime)`);
  }
  return errors;
}

/**
 * Validate a case's `xfail` declaration and resolve it for implementation `impl`.
 *
 * Shape: `"xfail": { "<impl-id>": { "gap": "<carried-gap-id>", "fails": <XfailSignature> } }`.
 * The bare-string form `"<impl-id>": "<gap-id>"` is REJECTED — a mark without a failure signature
 * would absorb any failure at all.
 *
 * EVERY entry is validated, not only the one for the running impl — a dangling gap id under another
 * impl's key is still a lie in the corpus. Returns the mark for `impl` (null when the case is not
 * marked for it, or its entry is malformed) plus any declaration errors. Pure: reads only its arguments.
 */
export function resolveXfail(
  expected: ExpectedCase,
  impl: string,
  gaps: GapStatusIndex,
): { mark: XfailMark | null; errors: string[] } {
  if (!("xfail" in expected)) return { mark: null, errors: [] };
  const x = (expected as { xfail?: unknown }).xfail;
  if (!isPlainObject(x)) {
    return {
      mark: null,
      errors: [`xfail is ${describeContainer(x)} — expected an object { "<impl-id>": { "gap": …, "fails": … } }`],
    };
  }
  if (Object.keys(x).length === 0) {
    return {
      mark: null,
      errors: ["xfail is present but EMPTY — it marks nothing. Omit the key, or name an impl, a carried gap and a signature."],
    };
  }
  const errors: string[] = [];
  let mine: XfailMark | null = null;
  for (const [k, v] of Object.entries(x)) {
    const where = `xfail['${k}']`;
    if (!KNOWN_IMPL_IDS.includes(k)) {
      errors.push(`${where} names an unknown implementation — known: ${KNOWN_IMPL_IDS.join(", ")}`);
      continue;
    }
    if (typeof v === "string") {
      errors.push(
        `${where} is a bare gap id — xfail needs a failure signature: { "gap": ${JSON.stringify(v)}, "fails": … }. ` +
          `Capture it with \`bun conformance/run.ts --xfail-signature ${expected.id}\`.`,
      );
      continue;
    }
    if (!isPlainObject(v)) {
      errors.push(`${where} is ${describeContainer(v)} — expected { "gap": "<carried-gap-id>", "fails": <signature> }`);
      continue;
    }
    const before = errors.length;
    for (const key of Object.keys(v)) {
      if (key !== "gap" && key !== "fails") errors.push(`${where}.${key} is not a mark key (gap, fails)`);
    }
    const gap = v.gap;
    if (typeof gap !== "string" || gap.trim() === "") {
      errors.push(`${where}.gap is ${describeContainer(gap)} — expected a carried gap id string`);
    } else {
      const status = gaps.get(gap);
      if (status === undefined) {
        errors.push(`${where} names gap '${gap}', which has no @gap marker in docs/known-gaps.md`);
      } else if (!GAP_STATUS_CARRIED.has(status)) {
        errors.push(
          `${where} names gap '${gap}', whose marker says status=${status} — an expected failure must ` +
            `name a status=carried gap (S430 P7: carried = owed by the bootstrap, xfail on impl#1)`,
        );
      }
    }
    if (!("fails" in v)) {
      errors.push(
        `${where} has no "fails" — xfail needs a failure signature. ` +
          `Capture it with \`bun conformance/run.ts --xfail-signature ${expected.id}\`.`,
      );
    } else {
      errors.push(...validateSignature(where, v.fails));
    }
    if (k === impl && errors.length === before) {
      mine = { gap: gap as string, fails: canonicalSignature(v.fails as XfailSignature) };
    }
  }
  return { mark: mine, errors };
}

/**
 * The outcome table. A malformed contract (`shapeErrors`) or a malformed/dangling xfail is ALWAYS a
 * failure — an xfail mark absorbs a behavioural gap, never a broken case file. A marked case that
 * fails DIFFERENTLY from its recorded signature is a FAIL: the carried gap does not cover a new failure.
 */
export function classifyOutcome(
  assertionsPass: boolean,
  shapeErrors: readonly string[],
  xfailGap: string | null,
  xfailErrors: readonly string[],
  signatureMatches: boolean = true,
): Outcome {
  if (shapeErrors.length > 0 || xfailErrors.length > 0) return "fail";
  if (xfailGap === null) return assertionsPass ? "pass" : "fail";
  if (assertionsPass) return "xpass";
  return signatureMatches ? "xfail" : "fail";
}

/**
 * The reverse direction: every `status=carried` gap must be pinned by at least one case marked xfail
 * for it. A carried gap no case pins has no executable statement of the correct behaviour — which is
 * the whole of what "carried" promises the bootstrap. Returns the unpinned gap ids, sorted.
 * (A malformed mark still counts as naming its gap here: that case is already red on its own, and
 * reporting the gap unpinned too would double-report one defect.)
 */
export function unpinnedCarriedGaps(cases: readonly LoadedCase[], gaps: GapStatusIndex): string[] {
  const pinned = new Set<string>();
  for (const c of cases) {
    const x = (c.expected as { xfail?: unknown }).xfail;
    if (!isPlainObject(x)) continue;
    for (const v of Object.values(x)) {
      if (typeof v === "string") pinned.add(v);
      else if (isPlainObject(v) && typeof v.gap === "string") pinned.add(v.gap);
    }
  }
  const out: string[] = [];
  for (const [id, status] of gaps) if (GAP_STATUS_CARRIED.has(status) && !pinned.has(id)) out.push(id);
  return out.sort();
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
      // PRESENCE, not truthiness (S365). `ex.codes ?? []` coerced an explicit `"codes": null` into a
      // silent no-op, so a malformed container reached runCase already laundered into a passing one.
      // An ABSENT key still defaults to []; a PRESENT-but-malformed one now survives to be reported.
      if (!("codes" in ex)) ex.codes = [];
      if (!("notCodes" in ex)) ex.notCodes = [];
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
  const ex = c.expected.expect;

  // CONTAINER POLICY FIRST (S365) — before the compile and before any assertion touches `ex`.
  // Order is load-bearing twice over: `ex.codes.filter(...)` throws outright on `"codes": {}`, and
  // `for (const p of ex.notCodePrefixes ?? [])` throws `{} is not iterable` — either one aborted the
  // whole 883-case run from inside a single bad case file. Validating first converts both into ONE
  // failed case carrying a diagnostic, which is what a harness owes its operator.
  const shapeErrors = validateExpectContainers(ex);
  if (shapeErrors.length > 0) {
    return {
      id: c.expected.id,
      relDir: c.relDir,
      pass: false,
      emitted: [],
      missing: [],
      forbidden: [],
      prefixViolations: [],
      severityMismatches: [],
      countMismatches: [],
      shapeErrors,
      runtimeHalfPending: c.expected["runtime-half-pending"] === true,
      runtimeFailures: [],
      // A contract this broken cannot be trusted to say whether it HAS a runtime half, and running
      // one against a malformed expect block is how the harness died in the first place.
      hasRuntimeHalf: false,
    };
  }

  const { codes: emitted, byCode, counts } = compile(c.source, c.auxFiles);
  const emittedSet = new Set(emitted);
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

  // codeCounts — EXACT per-code cardinality. The one assertion in this harness
  // that is not set-valued: it reads how many times the compiler pushed the code,
  // so a double fire is visible. A malformed value is a HARD failure rather than
  // a skip — a cardinality assertion that silently does nothing is the exact
  // hollow-gate shape this key was added to close.
  //
  // THE CONTAINER IS CHECKED, NOT JUST THE VALUE (S365 review). The paragraph above promised a
  // malformed VALUE is a hard failure — and the first cut delivered exactly that and no more, so
  // the CONTAINER could still turn the whole assertion off in silence:
  //   "codeCounts": null   -> falsy, block skipped, case green
  //   "codeCounts": ""     -> falsy, block skipped, case green
  //   "codeCounts": {}     -> truthy, zero keys, loop never runs, case green
  //   "codeCounts": []     -> truthy, zero keys, loop never runs, case green
  // A hollow assertion inside the anti-hollow-assertion feature.
  //
  // That container check no longer lives here: it was the FIRST instance of a defect the whole
  // `expect` vocabulary had, so it was generalised into EXPECT_SHAPES / validateExpectContainers
  // above rather than copied per key. runCase() returns before this point on any container
  // violation, so what remains here is what is genuinely codeCounts-specific — the VALUE contract
  // (a non-negative integer) and the cardinality comparison itself.
  const countMismatches: string[] = [];
  if ("codeCounts" in ex) {
    const cc = ex.codeCounts as Record<string, unknown>;
    for (const code of Object.keys(cc)) {
      const want = cc[code];
      if (typeof want !== "number" || !Number.isInteger(want) || want < 0) {
        countMismatches.push(
          "codeCounts['" + code + "'] is not a non-negative integer (got " + JSON.stringify(want) + ")",
        );
        continue;
      }
      const got = counts[code] ?? 0;
      if (got !== want) {
        countMismatches.push("code '" + code + "' fired " + got + " time(s), expected exactly " + want);
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
      severityMismatches.length === 0 &&
      countMismatches.length === 0,
    emitted,
    missing,
    forbidden,
    prefixViolations,
    severityMismatches,
    countMismatches,
    shapeErrors: [],   // unreachable non-empty: runCase returns early on any container violation
    runtimeHalfPending: c.expected["runtime-half-pending"] === true,
    runtimeFailures: [],
    emittedCounts: counts,
    hasRuntimeHalf: hasRuntimeHalf(c),
  };
}

/**
 * Run one case's RUNTIME (b) half — compile + execute + drive + assert
 * state/dom/domAnchored. Returns the failure list (empty = pass). A case with
 * no runtime half returns an empty list.
 */
export async function runCaseRuntime(c: LoadedCase): Promise<string[]> {
  return (await runCaseRuntimeDetailed(c)).failures;
}

/**
 * Normalise the run-to-run VOLATILE parts of a failure text before it is hashed into an xfail
 * signature (S430 P7 review, MED): mkdtemp paths, the Bun version banner, the line:col of a frame
 * in a generated temp file, and the `NN |` source-frame gutter Bun prints above an uncaught error.
 * Without this a "tool crashes on impl#1" case produced a new digest on every run and could never
 * be carried. Display text is NOT normalised — only the signature input.
 */
export function normalizeVolatile(text: string): string {
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathTail = String.raw`[^\s:'"\\)]*`;
  return text
    // the platform temp dir (os.tmpdir()) and the conventional /tmp, /private/tmp, /var/folders roots
    .replace(new RegExp(escapeRe(tmpdir()) + "/" + pathTail, "g"), "<TMP>")
    .replace(new RegExp(String.raw`/(?:private/)?tmp/` + pathTail, "g"), "<TMP>")
    .replace(new RegExp(String.raw`/var/folders/` + pathTail, "g"), "<TMP>")
    // line:col after a temp path (generated-code positions)
    .replace(/<TMP>:\d+(?::\d+)?/g, "<TMP>:<L>")
    // the Bun version banner
    .replace(/Bun v\d+\.\d+\.\d+[^\n"\\]*/g, "Bun <VERSION>")
    // the `NN | source` frame gutter, at a real line start, after an escaped `\n` in JSON text, or
    // right after the opening quote of a JSON-stringified stderr
    .replace(/(^|\n|\\n|")([ \t]*)\d+( \|)/g, "$1$2N$3");
}

/**
 * The error head of a process's stderr: the `SomethingError: message` / `error: …` lines, paths
 * normalised. What a crash IS, without the frames, gutters and banner around it.
 */
function errorHead(stderr: string): string {
  const heads = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([A-Z][A-Za-z]*(Error|Exception)|error|panic)\b/.test(l));
  return normalizeVolatile(heads.length > 0 ? heads.join("\n") : stderr.trim());
}

/**
 * The runtime half with, beside each human-readable failure line, the STRUCTURED key the xfail
 * signature hashes: for a tool run, `{ expected stdout, actual stdout, exit code, error head }`
 * (never the raw stderr); for every other assertion, the failure line with volatile parts
 * normalised. `failures[i]` and `keys[i]` describe the same failure.
 */
export async function runCaseRuntimeDetailed(c: LoadedCase): Promise<{ failures: string[]; keys: string[] }> {
  const structured: string[] = [];
  const failures = await runtimeBody(c, structured);
  return { failures, keys: failures.map((f, i) => structured[i] ?? normalizeVolatile(f)) };
}

async function runtimeBody(c: LoadedCase, structuredKeys: string[]): Promise<string[]> {
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
      structuredKeys[failures.length] =
        "stdout:" +
        JSON.stringify({
          expected: e.stdout,
          actual: normalizeVolatile(tr.stdout),
          exitCode: tr.exitCode,
          error: tr.stderr ? errorHead(tr.stderr) : "",
        });
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
  // Fork A validation: `sqlEngine:"real"` is meaningful only over a serverDb
  // seed (it swaps the `_scrml_sql` stub for a real seeded Bun.SQL). A "real"
  // case with no seed is a case-authoring error — fail loud, not silently-stub.
  if (e.sqlEngine === "real" && e.serverDb === undefined) {
    return ['sqlEngine:"real" requires a `serverDb` seed (nothing to stand up a real DB from)'];
  }
  const r =
    e.serverDb !== undefined
      ? await runServer(c.source, {
          input: e.input ?? [],
          auxFiles: c.auxFiles,
          serverDb: e.serverDb,
          ssr,
          sqlEngine: e.sqlEngine,
        })
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

/**
 * Run BOTH halves of one case on this impl and resolve its outcome against its `xfail` mark.
 *
 * `pass` on the result keeps its pre-S430 meaning — every assertion held — so a reader of the raw lists
 * is never misled; `outcome` / `ok` are the gate's verdict. A runtime half that THROWS is recorded as a
 * runtime failure rather than escaping: an xfail case that crashes impl#1 is still a failing case, and
 * the thrown message is kept so an XFAIL line never hides WHAT failed.
 */
export async function evaluateCase(
  c: LoadedCase,
  gaps: GapStatusIndex = loadGapStatusIndex(),
  impl: string = IMPL_ID,
): Promise<EvaluatedCase> {
  const r = runCase(c);
  if (r.hasRuntimeHalf) {
    try {
      const d = await runCaseRuntimeDetailed(c);
      r.runtimeFailures = d.failures;
      r.runtimeSignatureKeys = d.keys;
    } catch (e) {
      // A stage-seam violation (s430-stage-swap hybrid) is a defect of the substituted STAGE, never a
      // behaviour an xfail mark could describe — let it reach the hybrid runner, which labels it.
      if (e instanceof Error && e.name === "StageSeamError") throw e;
      const name = e instanceof Error ? e.name : typeof e;
      const message = e instanceof Error ? e.message : String(e);
      r.runtimeFailures = ["runtime half threw: " + message];
      // The signature pins WHAT was thrown (name + message), paths/versions normalised — not the
      // raw message, which can carry a per-run temp path.
      r.runtimeSignatureKeys = ["threw:" + name + ": " + normalizeVolatile(message)];
    }
    if (r.runtimeFailures.length > 0) r.pass = false;
  }
  const { mark, errors } = resolveXfail(c.expected, impl, gaps);
  const observed = failureSignature(r);
  // Only a marked case that FAILED is compared: a passing one is XPASS regardless of its signature.
  const signatureMismatch = mark && !r.pass ? signatureDiff(mark.fails, observed) : [];
  const outcome = classifyOutcome(r.pass, r.shapeErrors, mark?.gap ?? null, errors, signatureMismatch.length === 0);
  return {
    ...r,
    xfailGap: mark?.gap ?? null,
    expectedSignature: mark?.fails ?? null,
    observedSignature: observed,
    signatureMismatch,
    xfailErrors: errors,
    outcome,
    ok: outcome === "pass" || outcome === "xfail",
  };
}

/** One-line-per-item summary of what failed, for XFAIL reporting (so the mark never hides the failure). */
export function failureSummary(r: CaseResult): string[] {
  const out: string[] = [];
  if (r.missing.length) out.push("missing " + JSON.stringify(r.missing));
  if (r.forbidden.length) out.push("forbidden " + JSON.stringify(r.forbidden));
  for (const f of r.prefixViolations) out.push("forbidden-prefix " + f);
  for (const f of r.severityMismatches) out.push("severity " + f);
  for (const f of r.countMismatches) out.push("codeCounts " + f);
  // Multi-line failures (a stdout mismatch is `stdout mismatch:` + expected/got/stderr lines) are
  // collapsed onto one line, so the summary shows WHAT mismatched rather than just the heading.
  for (const f of r.runtimeFailures) {
    const one = f.replace(/\s*\n\s*/g, " / ");
    out.push("runtime " + (one.length > 300 ? one.slice(0, 300) + "…" : one));
  }
  return out;
}

export async function runAll(
  casesDir: string = CASES_DIR,
  gaps: GapStatusIndex = loadGapStatusIndex(),
): Promise<{
  results: EvaluatedCase[];
  passed: number;
  failed: number;
  xfailed: number;
  xpassed: number;
  /** status=carried gaps no case pins — each one is a failure of the run. */
  unpinnedCarried: string[];
}> {
  const cases = loadCases(casesDir);
  const results: EvaluatedCase[] = [];
  for (const c of cases) results.push(await evaluateCase(c, gaps));
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  return {
    results,
    passed: count("pass"),
    failed: count("fail"),
    xfailed: count("xfail"),
    xpassed: count("xpass"),
    unpinnedCarried: unpinnedCarriedGaps(cases, gaps),
  };
}

/** The ratio line — printed by every entry point, so an absorbing hatch is visible as a number. */
export function xfailRatioLine(xfailed: number, total: number, xpassed: number): string {
  return (
    `conformance (${IMPL_ID}): ${xfailed} xfail of ${total} cases` +
    (xpassed > 0 ? `, ${xpassed} XPASS (failures)` : "")
  );
}

/**
 * `--xfail-signature <case-id|relDir>` — print the CURRENT failure signature of one case as a ready-to-
 * paste `xfail` block, so a triage records the signature mechanically rather than by hand. Exit 1 when
 * the case PASSES (there is no failure to pin — and marking a passing case would be an XPASS).
 * The `gap` field is the case's existing mark when it has one, else the literal "<carried-gap-id>",
 * which the runner rejects until it is replaced with a real status=carried id.
 */
async function printSignature(which: string): Promise<number> {
  const cases = loadCases();
  const c = cases.find((k) => k.expected.id === which || k.relDir === which);
  if (!c) {
    console.error(`--xfail-signature: no case with id or dir '${which}'`);
    return 2;
  }
  const r = await evaluateCase(c);
  if (r.shapeErrors.length > 0) {
    console.error(`--xfail-signature: ${c.relDir} has a malformed expect block — fix the contract first:`);
    for (const f of r.shapeErrors) console.error(`  ${f}`);
    return 1;
  }
  if (r.pass) {
    console.error(`--xfail-signature: ${c.relDir} PASSES on ${IMPL_ID} — there is no failure to record.`);
    return 1;
  }
  const existing = (c.expected as { xfail?: Record<string, { gap?: unknown }> }).xfail?.[IMPL_ID];
  const gap = existing && typeof existing === "object" && typeof existing.gap === "string" ? existing.gap : "<carried-gap-id>";
  // The failures the signature pins, human-readable, on stderr so stdout stays pasteable JSON.
  console.error(`# ${c.relDir} (${c.expected.id}) fails on ${IMPL_ID} with:`);
  for (const f of failureSummary(r)) console.error(`#   ${f}`);
  console.log(JSON.stringify({ xfail: { [IMPL_ID]: { gap, fails: r.observedSignature } } }, null, 2));
  return 0;
}

async function main(): Promise<void> {
  const sigAt = process.argv.indexOf("--xfail-signature");
  if (sigAt >= 0) {
    const which = process.argv[sigAt + 1];
    if (!which) {
      console.error("usage: bun conformance/run.ts --xfail-signature <case-id|relDir>");
      process.exit(2);
    }
    process.exit(await printSignature(which));
  }
  const { results, passed, failed, xfailed, xpassed, unpinnedCarried } = await runAll();
  for (const r of results) {
    const tag = r.outcome.toUpperCase();
    const rt = r.runtimeHalfPending ? "  [runtime-half-pending]" : r.hasRuntimeHalf ? "  [runtime]" : "";
    const gapNote = r.xfailGap ? `  [xfail ${IMPL_ID}: ${r.xfailGap}]` : "";
    console.log(`${tag}  ${r.relDir}${rt}${gapNote}`);
    for (const f of r.xfailErrors) console.log(`        xfail: ${f}`);
    if (r.signatureMismatch.length > 0) {
      console.log(`        FAILS DIFFERENTLY from the recorded xfail signature for gap '${r.xfailGap}':`);
      for (const f of r.signatureMismatch) console.log(`          ${f}`);
    }
    if (r.outcome === "xfail") {
      // Still say WHAT failed: an XFAIL that has quietly started failing for a different reason must
      // be readable from the run, not only from a debugger.
      for (const f of failureSummary(r)) console.log(`        (expected) ${f}`);
    }
    if (r.outcome === "xpass") {
      console.log(
        `        XPASS — every assertion holds on ${IMPL_ID}, so gap '${r.xfailGap}' is FIXED here. Remove the ` +
          `xfail mark and resolve the gap; a fixed gap cannot stay marked carried.`,
      );
    }
    if (!r.pass && r.outcome !== "xfail") {
      // First and alone when present: the contract itself is malformed, so every other list is
      // empty by construction and printing them would read as "nothing else wrong".
      for (const f of r.shapeErrors) {
        console.log(`        MALFORMED expect: ${f}`);
      }
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
      for (const f of r.countMismatches) {
        console.log(`        codeCounts: ${f}`);
      }
      for (const f of r.runtimeFailures) {
        console.log(`        runtime: ${f}`);
      }
    }
  }
  for (const g of unpinnedCarried) {
    console.log(`UNPINNED  gap '${g}' is status=carried but no case carries "xfail": { "${IMPL_ID}": { "gap": "${g}", … } }`);
  }
  console.log(
    `\nconformance (impl#1): ${passed}/${results.length} cases pass` +
      (failed > 0 ? `, ${failed} FAILED` : "") +
      (unpinnedCarried.length > 0 ? `, ${unpinnedCarried.length} carried gap(s) UNPINNED` : ""),
  );
  console.log(xfailRatioLine(xfailed, results.length, xpassed));
  process.exit(failed === 0 && xpassed === 0 && unpinnedCarried.length === 0 ? 0 : 1);
}

// `import.meta.main` is a Bun extension (true when run as the entrypoint).
if ((import.meta as unknown as { main?: boolean }).main) main();
