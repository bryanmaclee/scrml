/**
 * @module commands/semdiff
 * scrml semdiff subcommand — #6b P0 (the "honest floor").
 *
 *   scrml semdiff <base> <head> [--json]
 *
 * Compile BOTH .scrml versions in-process (full pipeline, write:false), capture
 * the byproducts (emitted artifacts + diagnostic set + the canonical
 * blockAnalyses entity projection), and classify head-vs-base by AXIS + soundness
 * TIER (never a boolean "safe"). The exit code is the standard diff convention:
 * `0` = cosmetic / no-op · `1` = behavioral · `2` = a version failed to compile
 * (fail-closed — the compiler is the first reviewer). The synthesized top-level
 * `verdict` field is the single value a consumer should key on.
 *
 * The classification math lives in ../semdiff.ts (pure, unit-tested). This
 * command is the I/O shell: arg-parse, compile-both, resolve entities from the
 * raw source, format, exit.
 *
 * DD: scrml-support/docs/deep-dives/6b-semantic-diff-primitive-design-2026-07-17.md
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { compileScrml } from "../api.js";
import {
  classifySemdiff,
  collectEmitArtifacts,
  fingerprintEntity,
  detectForeignRegions,
} from "../semdiff.ts";

// ---------------------------------------------------------------------------
// ANSI helpers (mirror commands/compile.js)
// ---------------------------------------------------------------------------

const isTTY = process.stderr.isTTY && process.stdout.isTTY;
const c = {
  red: (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  magenta: (s) => (isTTY ? `\x1b[35m${s}\x1b[0m` : s),
};

function printHelp() {
  console.log(`scrml semdiff <base> <head> [--json]

Semantic-diff / behavioral-classification (#6b P0 — the honest floor).

Given two versions of a scrml program, classify head-vs-base by AXIS + soundness
TIER — never a boolean "safe". An opaque region (foreign \`_={ }=\` block, unresolved
import, dynamic dispatch) is behavioral-BY-CONSTRUCTION (forced Tier-2). Gating /
auto-merge policy stays CONSUMER-SIDE — this reports only.

Arguments:
  <base>                 The base .scrml file
  <head>                 The head .scrml file

Options:
  --json                 Structured JSON output (the consumer review-row / merge input)
  --help, -h             Show this message

Tiers (per matched entity):
  0  emit-identity modulo bound-rename (byte-identical output — a reformat / comment /
     non-exported alpha-rename)
  2  behavioral-on-axis-X (opaque | use-site | source | context) — names the moved axis

Verdict (the synthesized top-level field a consumer should key on):
  cosmetic     every entity Tier-0 AND no add/remove AND no new use-site diagnostic
               AND no unmodeled-axis signal
  behavioral   otherwise (a route-add lands only in unmatched.added — the verdict
               catches it where a naive "all entities Tier-0" would not)

Exit (standard diff convention — 0/1/2):
  0  cosmetic / no-op    (safe to auto-approve on the modeled axes)
  1  behavioral          (a change on some axis — the consumer must review / gate)
  2  error               (a version failed to compile — fail-closed)
`);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const positional = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--emit-classification") {
      // D4 — REDUNDANT with the default: the command ALWAYS emits the
      // classification (human or `--json`), so this flag added nothing. Removed
      // from `--help`; still accepted (no error) as a back-compat no-op so an
      // early consumer that passes it is not broken.
      continue;
    } else if (arg.startsWith("-")) {
      console.error(c.red("error:") + ` Unknown option: ${arg}`);
      console.error(c.dim("Run `scrml semdiff --help` for usage."));
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, json };
}

// ---------------------------------------------------------------------------
// Compile one version + resolve its entities / diagnostics / emit corpus
// ---------------------------------------------------------------------------

/** Normalize a compiler diagnostic (error / warning / lint) to a SemDiagnostic. */
function normalizeDiagnostic(d) {
  const span =
    d.span && typeof d.span.start === "number"
      ? { start: d.span.start, end: typeof d.span.end === "number" ? d.span.end : d.span.start, line: d.span.line }
      : undefined;
  return {
    code: d.code || "",
    message: d.message || "",
    severity: d.severity,
    span,
    line: typeof d.line === "number" ? d.line : span ? span.line : undefined,
  };
}

/** Read the raw source that an analysis's spans index into. */
function sourceForAnalysis(analysisFile, gatheredFiles, primaryPath, cache) {
  const want = (analysisFile || "").replace(/\\/g, "/");
  for (const g of gatheredFiles || []) {
    const gp = g.replace(/\\/g, "/");
    if (gp === want || gp.endsWith("/" + want)) {
      if (!cache.has(g)) cache.set(g, readFileSync(g, "utf8"));
      return cache.get(g);
    }
  }
  // Fallback: basename match against the primary file, else read the primary.
  if (want && basename(want) === basename(primaryPath)) {
    if (!cache.has(primaryPath)) cache.set(primaryPath, readFileSync(primaryPath, "utf8"));
    return cache.get(primaryPath);
  }
  // Last resort — single-file compile: the one gathered file is the source.
  if ((gatheredFiles || []).length === 1) {
    const g = gatheredFiles[0];
    if (!cache.has(g)) cache.set(g, readFileSync(g, "utf8"));
    return cache.get(g);
  }
  if (!cache.has(primaryPath)) cache.set(primaryPath, readFileSync(primaryPath, "utf8"));
  return cache.get(primaryPath);
}

/**
 * Detect unresolved-import diagnostics (module-not-found) for the opaque signal.
 * An entity whose span contains such a diagnostic (or a top-level import that
 * maps to no entity) is an unmodeled region (constraint §0(2)). Returns the
 * diagnostics that carry a span so the caller can attribute per-entity.
 */
function unresolvedImportDiagnostics(diagnostics) {
  return diagnostics.filter(
    (d) =>
      typeof d.code === "string" &&
      d.code.startsWith("E-IMPORT") &&
      /not\s+found|cannot\s+find|unresolved|does not exist/i.test(d.message),
  );
}

/**
 * Is the block at `spanStart` an EXPORTED declaration (D1)? scrml writes the
 * visibility modifier as a leading `export` token on the SAME line, immediately
 * before the block keyword (`export fn NAME`, `export function NAME`, `export
 * async function NAME`, `export type NAME`). The block's `span.start` points at
 * the block keyword, so the text from the line start up to `span.start` holds
 * only indentation + modifiers — an `export` word there means the entity is
 * exported (an observable public symbol whose name is FIXED, Fork D).
 */
function isExportedDecl(source, spanStart) {
  if (typeof source !== "string" || typeof spanStart !== "number") return false;
  const lineStart = source.lastIndexOf("\n", spanStart - 1) + 1;
  const prefix = source.slice(lineStart, spanStart);
  return /(^|[^A-Za-z0-9_$])export([^A-Za-z0-9_$]|$)/.test(prefix);
}

// The unmodeled-axis attributes P0 does not classify but MUST signal on change
// (D3 — confidentiality is Fork A / P4-deferred). `protect=` is the concrete
// `<db>` confidentiality attribute; the list is the extension point for other
// structurally-similar unmodeled security attributes.
const UNMODELED_AXIS_ATTRS = ["protect"];

/**
 * Lift the unmodeled-axis declaration attributes (`protect="…"`) out of raw
 * source text (D3). Returns one `{ attr, value }` per occurrence — the classifier
 * aggregates + diffs them, surfacing a breadcrumb when the axis moves so a
 * `protect=` narrowing with no local SELECT is never a silent Tier-0 (§0(2)).
 */
function extractUnmodeledAxisAttrs(source) {
  const attrs = [];
  if (typeof source !== "string") return attrs;
  for (const name of UNMODELED_AXIS_ATTRS) {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "g");
    let m;
    while ((m = re.exec(source)) !== null) attrs.push({ attr: name, value: m[1] });
  }
  return attrs;
}

/**
 * Compile one version + resolve its SemVersion (entities / diagnostics / emit
 * artifacts). Exported so the test suite can drive the real pipeline without
 * spawning the CLI (and without `runSemdiff`'s process.exit).
 *
 * @param {string} absPath — absolute path to the version's .scrml file
 * @param {string} label   — the base/head label carried into the classification
 * @returns {import("../semdiff.ts").SemVersion}
 */
export function compileVersion(absPath, label) {
  const outputDir = join(dirname(absPath), "__semdiff_dist");
  let result;
  try {
    result = compileScrml({
      inputFiles: [absPath],
      write: false,
      outputDir,
    });
  } catch (err) {
    // A hard crash (not a diagnostic) — treat as a failed compile (fail-closed).
    return {
      label,
      entities: [],
      diagnostics: [
        { code: "E-SEMDIFF-COMPILE-CRASH", message: String(err && err.message ? err.message : err), severity: "error" },
      ],
      emitArtifacts: [],
      failedToCompile: true,
    };
  }

  const diagnostics = [
    ...(result.errors || []),
    ...(result.warnings || []),
    ...(result.lintDiagnostics || []),
  ].map(normalizeDiagnostic);

  const emitArtifacts = collectEmitArtifacts(result.outputs || new Map());
  const failedToCompile = (result.errors || []).length > 0;

  // Resolve entities from the canonical blockAnalyses projection + raw source.
  const entities = [];
  const cache = new Map();
  const gatheredFiles = result.gatheredFiles || [absPath];
  const importErrs = unresolvedImportDiagnostics(diagnostics);
  let analyses = [];
  try {
    analyses = typeof result.blockAnalyses === "function" ? result.blockAnalyses() : [];
  } catch {
    analyses = [];
  }
  for (const analysis of analyses) {
    const source = sourceForAnalysis(analysis.file, gatheredFiles, absPath, cache);
    for (const block of analysis.blocks || []) {
      const bodySpan = block.bodySpan || { start: block.span.start, end: block.span.end };
      const bodyText =
        typeof source === "string" ? source.slice(bodySpan.start, bodySpan.end) : "";
      const reasons = detectForeignRegions(bodyText);
      // Unresolved-import opaque escalation: a module-not-found diagnostic whose
      // span falls inside this entity marks it unmodeled (constraint §0(2)).
      for (const ie of importErrs) {
        if (ie.span && ie.span.start >= block.span.start && ie.span.start < block.span.end) {
          reasons.push("unresolved-import");
        }
      }
      const uniqueReasons = Array.from(new Set(reasons));
      entities.push({
        id: block.id,
        kind: block.kind,
        name: block.name,
        span: block.span,
        bodySpan,
        bodyText,
        fingerprint: fingerprintEntity(bodyText, block.name),
        opaque: uniqueReasons.length > 0,
        opaqueReasons: uniqueReasons,
        // D1 — capture visibility so an exported name is never folded into the
        // alpha-rename map (an export rename is behavioral, Fork D).
        exported: typeof source === "string" ? isExportedDecl(source, block.span.start) : false,
      });
    }
  }

  // D3 — lift unmodeled-axis attributes (`protect=`) from every gathered source
  // so a change to an axis P0 does not model surfaces a breadcrumb, not silence.
  const unmodeledAxisAttrs = [];
  for (const g of gatheredFiles) {
    const src = cache.has(g) ? cache.get(g) : (() => {
      try { const s = readFileSync(g, "utf8"); cache.set(g, s); return s; } catch { return undefined; }
    })();
    for (const a of extractUnmodeledAxisAttrs(src)) unmodeledAxisAttrs.push(a);
  }

  // D2 — the source basename stem (no dir, no `.scrml`) bakes into emitted
  // content; the classifier neutralizes it so a rename-only diff reads Tier-0.
  const sourceBasename = basename(absPath, ".scrml");

  return {
    label,
    entities,
    diagnostics,
    emitArtifacts,
    failedToCompile,
    sourceBasename,
    unmodeledAxisAttrs,
  };
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function tierLabel(tier, opaque) {
  if (tier === "0") return c.green("[T0]");
  if (opaque) return c.magenta("[T2 opaque]");
  return c.yellow("[T2]");
}

function verdictLine(cl) {
  if (cl.exitCode === 2) {
    return c.red("verdict: error (exit 2) — a version failed to compile (fail-closed — the compiler is the first reviewer)");
  }
  if (cl.verdict === "cosmetic") {
    return c.green("verdict: cosmetic (exit 0) — no-op on every modeled axis");
  }
  return c.yellow("verdict: behavioral (exit 1) — a change on some axis; gate/review consumer-side");
}

function printHuman(cl) {
  console.log(`${c.bold("semdiff")}: ${cl.base} ${c.cyan("->")} ${cl.head}`);
  console.log(verdictLine(cl));
  console.log("");
  console.log(`${c.bold("entities")} (${cl.entities.length}):`);
  if (cl.entities.length === 0) console.log(c.dim("  (none matched)"));
  for (const e of cl.entities) {
    console.log(
      `  ${tierLabel(e.tier, e.opaque)}  ${c.bold(e.entity)} (${e.kind})  ${c.dim("matched:" + e.matchedBy)}`,
    );
    for (const ax of e.axes) {
      let detail = "";
      if (ax.axis === "opaque") detail = (ax.detail && ax.detail.reasons ? ax.detail.reasons.join(", ") : "");
      else if (ax.axis === "use-site") detail = (ax.detail && ax.detail.codes ? ax.detail.codes.join(", ") : "");
      else if (ax.detail && ax.detail.note) detail = ax.detail.note;
      console.log(`      ${c.dim("-")} ${c.cyan(ax.axis)}${detail ? ": " + detail : ""}`);
    }
  }
  console.log("");
  console.log(
    `${c.bold("unmatched")}: added=[${cl.unmatched.added.join(", ")}] removed=[${cl.unmatched.removed.join(", ")}]`,
  );
  if (cl.diagnostics.added.length > 0 || cl.diagnostics.removed.length > 0) {
    console.log("");
    console.log(`${c.bold("diagnostics")} (use-site set diff):`);
    for (const d of cl.diagnostics.added) console.log(`  ${c.red("+")} ${d.code}: ${d.message}`);
    for (const d of cl.diagnostics.removed) console.log(`  ${c.green("-")} ${d.code}: ${d.message}`);
  }
  if (cl.signals && cl.signals.length > 0) {
    console.log("");
    console.log(`${c.bold("signals")} (unmodeled-axis breadcrumbs — not fully modeled by P0):`);
    for (const s of cl.signals) console.log(`  ${c.magenta("!")} ${s.code}: ${s.message}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runSemdiff(args) {
  const { positional, json } = parseArgs(args);

  if (positional.length < 2) {
    console.error(c.red("error:") + " semdiff requires two arguments: <base> <head>\n");
    console.error("Usage: scrml semdiff <base> <head> [--json]");
    console.error("Run `scrml semdiff --help` for details.");
    process.exit(1);
  }

  const [baseArg, headArg] = positional;
  const basePath = resolve(baseArg);
  const headPath = resolve(headArg);

  for (const [p, arg] of [[basePath, baseArg], [headPath, headArg]]) {
    if (!existsSync(p) || !statSync(p).isFile()) {
      console.error(c.red("error:") + ` Cannot find file: ${arg}`);
      process.exit(2); // fail-closed — a version is unavailable
    }
  }

  const baseVersion = compileVersion(basePath, baseArg);
  const headVersion = compileVersion(headPath, headArg);

  const classification = classifySemdiff(baseVersion, headVersion);

  if (json) {
    console.log(JSON.stringify(classification, null, 2));
  } else {
    printHuman(classification);
  }

  process.exit(classification.exitCode);
}
