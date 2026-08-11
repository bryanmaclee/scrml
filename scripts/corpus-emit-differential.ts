#!/usr/bin/env bun
/**
 * corpus-emit-differential — a wide-corpus emit-differential + `node --check` harness.
 *
 * WHY THIS IS A REPO TOOL AND NOT ANOTHER PER-ARC SCRIPT
 * =====================================================
 * The same defect has now shipped three times, each time in a throwaway harness, each time
 * leaving a gate that reported green while measuring a fraction of its population:
 *
 *   1. `docs/changes/chunk-namespacing/artifact-diff.mjs` @ e3584cc5 (S282) — `walk()` recursed but
 *      re-anchored `relative()` on the SUBdirectory, so nested files entered the set as bare
 *      basenames, `readFileSync` threw, and a `catch { continue }` swallowed it. On a 115-file tree
 *      it compared 8 files and reported PASS.
 *   2. `scripts/u1-corpus-emit.sh` (S319) — globbed `examples/*.scrml` +
 *      `samples/compilation-tests/*.scrml`: TOP LEVEL ONLY, two directories. It measured 329 of
 *      1818 sources and reported 708/708 byte-identical.
 *   3. the same script's `node --check` half — inherited the same population, reported base 2 /
 *      head 2, while an independent wide measurement of the same two revisions got base 44/head 46.
 *
 * `pa-base v2.13 §8` names this THE TRUNCATED PROBE: "a truncated enumeration reads exactly like a
 * complete one. There is no error, the output is well-formed, and every downstream count, ratio and
 * scoping decision inherits the truncation."
 *
 * Every design decision below is a defense against that failure class. They are called out
 * individually at their site with a `HARD REQ n` marker so a future editor can see what they would
 * be removing.
 *
 * USAGE
 * =====
 *   # capture one side
 *   bun scripts/corpus-emit-differential.ts capture \
 *       --compiler-root /abs/path/to/a/scrml/checkout \
 *       --label base-20a15c15 \
 *       --work   /scratch/base \
 *       --manifest /scratch/base.manifest.json
 *       [--roots examples,samples,conformance,stdlib,benchmarks]  # default; recursive; ARGUMENTS
 *       [--concurrency 10]
 *       [--expect-total 1816]                    # hard enumeration assertion, fails loud
 *       [--reuse-artifacts]                      # skip compilation, re-hash + re-check the work
 *                                                # tree in place (this is what makes the gate's
 *                                                # own bite cheap to prove)
 *       [--no-syntax-check]
 *
 *   # compare two sides
 *   bun scripts/corpus-emit-differential.ts diff \
 *       --base /scratch/base.manifest.json \
 *       --head /scratch/head.manifest.json
 *       [--json /scratch/diff.json]
 *       [--allow-same-revision]                  # opt in to a self-diff (proves determinism)
 *       [--allow-reuse-manifest]                 # opt in to comparing artifacts/syntax only
 *       [--no-reverify]                          # do NOT serially re-verify the delta (HARD REQ 9)
 *       [--reverify-limit 300]                   # 0 = no cap; the re-verification is all-or-nothing
 *
 * SYNTAX GOGGLES — read `scripts/corpus-check-goggles.js` before changing anything here.
 *   `node --check` is NOT used and must not be reintroduced. It PASSES a top-level `await` in a
 *   bare `.js` (module auto-detection), while the compiler emits `<script src="...client.js">`
 *   with no `type="module"` — a classic script, where the same bytes are a fatal SyntaxError. Every
 *   artifact is parsed under BOTH goggles, and the load context is derived from the emitted HTML.
 *
 * EXIT CODES
 *   capture: 0 = manifest written and every self-check agreed. 1 = a self-check FAILED (an
 *            enumeration disagreement, an expect-total mismatch, a slug collision, an unreadable
 *            artifact). A capture NEVER exits non-zero merely because sources failed to compile —
 *            compile failure is DATA (HARD REQ 5).
 *   diff:    0 = no differences at all. 1 = differences found. 2 = NOT A VALID COMPARISON —
 *            different roots, an enumeration disagreement, the same revision on both sides,
 *            differing check contexts, a DIVERGENT CHUNK-NAMESPACE ANCHOR (HARD REQ 8), a
 *            reuse-artifacts manifest, or a VACUOUS run in which zero artifacts were compared or
 *            zero checkable artifacts were checked.
 *
 *            There are exactly THREE outcomes and no fourth. A run that had to discard harness
 *            flakes (HARD REQ 9) is still 0 or 1 — the flakes are excluded from the finding total
 *            and named in the banner, because a flake is a statement about the HARNESS, not about
 *            whether the two revisions differ.
 */

import { createHash } from "node:crypto";
import { readdirSync, lstatSync, readFileSync, mkdirSync, rmSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 3;

/**
 * Default corpus roots.
 *
 * `stdlib/` and `benchmarks/` were ADDED after an adversarial review pointed out that the original
 * three roots covered 1818 of 2368 `.scrml` sources in the tree, and that the excluded set included
 * shipped scrml (`stdlib/`, 53) and the most app-shaped programs in the repository
 * (`benchmarks/fullstack-scrml/app.scrml`, `benchmarks/todomvc/app.scrml`).
 *
 * Everything still outside the default set is REPORTED at capture time with per-directory counts
 * (see `reportExcludedPopulation`), so what is not measured is a visible decision rather than an
 * invisible default. The remaining exclusions and why they are not shipped-program corpora:
 *   docs/                   illustrative snippets, many deliberately partial
 *   compiler/native-parser/ parser fixtures, deliberately malformed in places
 *   handOffs/               session artifacts
 */
const DEFAULT_ROOTS = ["examples", "samples", "conformance", "stdlib", "benchmarks"];
const SOURCE_EXT = ".scrml";
const CHECKABLE_EXT = new Set([".js", ".mjs", ".cjs"]);

/**
 * How an emitted artifact is actually LOADED, which decides which parser goggle its syntax must
 * satisfy. See `scripts/corpus-check-goggles.js` for why this distinction is load-bearing: a
 * top-level `await` is legal in a module and fatal in a classic script, and `node --check` reports
 * the permissive answer for a bare `.js`.
 */
type Goggle = "script" | "module";
const ALL_GOGGLES: Goggle[] = ["script", "module"];

/** The §47 content-addressed shared runtime. Its FILENAME moves when its CONTENT moves, which is
 *  the content hash doing its job — not an artifact appearing/disappearing. Keyed by a normalized
 *  name so the two sides still line up; the real name and the content hash are both retained, so a
 *  genuine runtime change is still reported (as a content difference, which is what it is). */
const RUNTIME_FILE = /^scrml-runtime\.[0-9a-z]+\.js$/;
const RUNTIME_KEY = "scrml-runtime.<HASH>.js";

// ---------------------------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------------------------

interface GoggleResult {
  ok: boolean;
  message: string;
}

interface ArtifactRecord {
  /** Comparison key: root-relative within the source's own output dir, runtime filename normalized. */
  key: string;
  /** The real on-disk basename/relpath, retained so the key normalization is never lossy. */
  realPath: string;
  sha256: string;
  bytes: number;
  /**
   * Which goggle this artifact is actually loaded under, derived from the emitted HTML in its own
   * output dir (`<script src="X">` without `type="module"` ⇒ classic script). Artifacts no HTML
   * references — server bundles, dynamically-imported chunks — default to `module`.
   */
  loadedAs?: Goggle;
  /** Why `loadedAs` is what it is. Recorded so the derivation is auditable, not magic. */
  loadedAsReason?: string;
  /** Client server-fn call sites in this artifact, split awaited vs BARE. Omitted when zero. */
  serverFnCallSites?: { total: number; awaited: number; bare: number };
  /**
   * BOTH goggles, always, for every checkable artifact. Recording only the effective one would
   * hide the case where a change flips an artifact's load context.
   * `undefined` when the artifact is not checkable JS, or when --no-syntax-check was passed.
   */
  syntax?: Record<Goggle, GoggleResult>;
}

interface SourceRecord {
  path: string;
  /** Corpus-shape metadata. Recorded so a report can DESCRIBE the corpus; never used to filter it. */
  role: "entry" | "auxiliary-module";
  compile: {
    exitCode: number;
    ok: boolean;
    /** Normalized (absolute paths and wall-clock timings folded out) so two checkouts at two
     *  different filesystem paths produce comparable text. Stored IN FULL — a digest would make a
     *  changed diagnostic visible but unreadable, and this tool exists to make things readable. */
    stdout: string;
    stderr: string;
    /** Derived from the normalized streams purely for readable reporting. */
    diagnosticCodes: string[];
  };
  artifacts: ArtifactRecord[];
}

/**
 * Everything OUTSIDE the artifact bytes that can change a syntax verdict. Recorded so `diff` can
 * refuse to compare two sides that were measured under different rules.
 *
 * This exists because the previous implementation used `node --check`, whose answer depends on the
 * nearest `package.json` `"type"` field — an input that lived outside the manifest entirely. A base
 * captured under one context and a head captured under another produced a large, entirely spurious
 * "FIXED in head" delta with no way to detect it. The current goggles (`vm.Script` /
 * `vm.SourceTextModule`) consult nothing but the source text, so this block should be constant;
 * it is recorded and compared anyway, because "should be constant" is what the last one assumed.
 */
interface CheckContext {
  /** e.g. "vm.Script + vm.SourceTextModule (explicit goggles, context-free)" */
  method: string;
  /** The checker runtime — a V8 version change can legitimately move a syntax verdict. */
  nodeVersion: string;
  /** The work tree the artifacts were checked in. Recorded per H3; not compared as a string. */
  work: string;
}

/**
 * HARD REQ 8 — the two sides must have resolved the SAME chunk-namespace ANCHOR, or no
 * artifact-content comparison between them means anything.
 *
 * `nsId` / `nsName` / `nsCellKey` (`compiler/src/codegen/chunk-namespace.ts`) namespace every
 * runtime-global token a chunk emits with `fnv1aHash(projectRelativeSourcePath)`. The path is
 * relative to the PROJECT ROOT, found by walking up for `scrml.toml` then `.git`
 * (`resolveProjectRoot`, that file's `:108`). When the walk finds no marker the compiler anchors on
 * the ABSOLUTE path instead — deliberately and correctly, because an absolute path is strictly more
 * injective than a project-relative one (see that file's "no-project-root tier").
 *
 * The consequence for THIS tool is severe, and it was measured, not theorised. A reference tree
 * extracted with `git archive` carries no `.git`, so every one of its namespace tokens embeds the
 * extraction directory, every emitted artifact therefore differs, and the report is a well-formed
 * list of PHANTOM content differences with nothing to tell the reader they are phantom. One capture
 * pair reported 1014 of them; `mkdir .git` in the reference tree took the SAME comparison to 0 of
 * 7375. Reproduced from first principles here: two trees holding byte-identical sources, differing
 * only in whether a `.git` marker exists above them, emit `// --- chunk cell scope (01t8u5va) ---`
 * and `(002qn9lf)` respectively.
 *
 * Two rules keep the check honest:
 *
 *   - It is resolved by the COMPILER UNDER TEST'S OWN resolver, dynamically imported from
 *     `--compiler-root`. Never by re-implementing the walk here, and never by pattern-matching a
 *     path string: a re-implementation would drift from the compiler and the drift would be
 *     invisible, which is this file's whole failure class.
 *   - What is COMPARED is the PREFIX each corpus-relative source path gains when re-expressed
 *     project-relative — NOT the project root's absolute path. Two checkouts always live at two
 *     different absolute paths; that is the normal case, not a defect. The prefix is exactly the
 *     part of the hashed string that a tree's LOCATION can move, so comparing it refuses on
 *     environment divergence and never on a compiler change. A revision that changed the hash
 *     FUNCTION would leave the prefixes equal and show up as artifact differences, which is what it
 *     is.
 */
interface NamespaceAnchor {
  /**
   * FALSE when the compiler under test does not expose the resolver at all — a revision from
   * before chunk-namespacing landed, or one that moved the module. Recorded rather than inferred,
   * because a guard that silently evaluates to "nothing to check" is a disarmed guard.
   */
  resolverAvailable: boolean;
  /** How the anchor was obtained, or the exact reason it could not be. */
  method: string;
  /**
   * Distinct resolved project roots across the enumerated corpus, with the marker that stopped the
   * walk and how many sources resolved to each. `projectRoot: null` means the walk reached the
   * filesystem root without finding a marker, so the compiler anchored on the ABSOLUTE path and
   * every token is a function of WHERE THE TREE LIVES.
   */
  roots: Array<{ projectRoot: string | null; marker: string | null; sources: number }>;
  /**
   * The prefix a corpus-relative source path GAINS when re-expressed project-relative. `""` is the
   * healthy shape: the corpus root is the project root, so the hashed string is the corpus-relative
   * path verbatim and is reproducible in any checkout at any location.
   */
  prefixes: Array<{ prefix: string; sources: number }>;
  /**
   * sha256 over `<corpus-relative path>\0<prefix>` for every enumerated source, sorted. THIS is the
   * comparable: equal digests mean both sides hash the same string for the same source, so no
   * artifact-content difference between them can be an artefact of tree location.
   */
  prefixDigest: string;
  /**
   * sha256 over `<corpus-relative path>\0<namespace token>`, sorted. Reported, never used to refuse
   * — a token digest can move because the HASH changed, which is a finding, not an incomparability.
   */
  tokenDigest: string;
}

interface Manifest {
  schemaVersion: number;
  label: string;
  /** Provenance only. NEVER compared — the whole point is that two different checkouts compare. */
  compilerRoot: string;
  revision: string;
  roots: string[];
  /** HARD REQ 8 — see `NamespaceAnchor`. */
  namespaceAnchor: NamespaceAnchor;
  /**
   * TRUE when this manifest was produced by `--reuse-artifacts`, i.e. the compile stage did NOT
   * run and the compile outcomes in it are NOT measurements. `diff` refuses to draw compile
   * conclusions from such a manifest and says so loudly.
   */
  reuseArtifacts: boolean;
  checkContext: CheckContext;
  /** `.scrml` sources present in the tree but OUTSIDE the selected roots. Visible, not hidden. */
  excludedPopulation: { total: number; perTopLevelDir: Record<string, number> };
  enumeration: {
    perRoot: Record<string, number>;
    total: number;
    /** HARD REQ 4 — the walk must not be its own oracle. */
    crossCheck: {
      method: string;
      perRoot: Record<string, number>;
      total: number;
      agrees: boolean;
      onlyInWalk: string[];
      onlyInOracle: string[];
    };
  };
  totals: {
    enumerated: number;
    compileAttempted: number;
    compileOk: number;
    compileFailed: number;
    artifactsEmitted: number;
    artifactsCheckable: number;
    syntaxChecked: number;
    /** Failures under the goggle the artifact is ACTUALLY loaded under. The headline number. */
    syntaxFailedEffective: number;
    /** Per-goggle failure counts, so neither goggle's answer is hidden behind the effective one. */
    syntaxFailedScript: number;
    syntaxFailedModule: number;
    /** Honesty about the content-hash memo below. */
    syntaxDistinctKeys: number;
    syntaxResolvedFromCache: number;
    loadedAsScript: number;
    loadedAsModule: number;
  };
  sources: SourceRecord[];
}

// ---------------------------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------------------------

/**
 * STRICT argument parsing. Every rule here exists because its absence let a flag DISARM SILENTLY.
 *
 * The previous parser inferred "boolean" from "no value follows" and accepted any flag name. So
 * `--expect-total` in trailing position, `--expect-totals 1818` (typo), and `--roooots examples`
 * all ran happily with the assertion absent or the roots silently defaulted. The only evidence was
 * an ABSENCE in the output. Since the roots are arguments, one typo re-creates the exact
 * narrowed-population defect this tool was written to kill — and a narrowed population applied to
 * BOTH sides is perfectly comparable and perfectly green.
 *
 * So: names are whitelisted per mode, value-flags REQUIRE a value, boolean flags REJECT one, and
 * repeats are rejected.
 */
const VALUE_FLAGS: Record<string, string[]> = {
  capture: ["compiler-root", "label", "work", "manifest", "roots", "concurrency", "expect-total"],
  diff: ["base", "head", "json", "reverify-limit"],
};
const BOOL_FLAGS: Record<string, string[]> = {
  capture: ["reuse-artifacts", "no-syntax-check"],
  diff: ["allow-same-revision", "allow-reuse-manifest", "no-reverify"],
};

/**
 * HARD REQ 9 — how many sources the serial re-verification will re-compile before it declines.
 *
 * The cap exists because re-verification is SERIAL by construction (serialising is the whole
 * point), so its cost is linear in the delta. It declines ALL-OR-NOTHING: a partial
 * re-verification that reads like a complete one is exactly the truncated-probe shape in this
 * file's header, and it would be worse here than nowhere, because the reader would believe the
 * findings had been checked.
 *
 * 300 is chosen to cover the phantom class comfortably (the witnessed event was 8 sources) while
 * declining a delta that is a real change by construction — a codegen change that legitimately
 * moves 300+ sources does not need a phantom filter to be believed.
 *
 * ⚠ The residual, stated rather than papered over: a MASS phantom event — the harness failing
 * hundreds of compiles at once — exceeds this cap and is reported UNVERIFIED. The banner says so,
 * which is the honest floor, but it is not the same as being caught. `--reverify-limit 0` removes
 * the cap.
 */
const DEFAULT_REVERIFY_LIMIT = 300;

function parseArgs(argv: string[]): { mode: string; flags: Record<string, string>; bools: Set<string> } {
  const mode = argv[0] ?? "";
  if (!VALUE_FLAGS[mode]) die(`unknown mode "${mode}" — expected "capture" or "diff". See the header of this file for usage.`);
  const valueOk = new Set(VALUE_FLAGS[mode]);
  const boolOk = new Set(BOOL_FLAGS[mode]);
  const flags: Record<string, string> = {};
  const bools = new Set<string>();

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected positional argument: ${a}`);
    const name = a.slice(2);

    if (valueOk.has(name)) {
      if (name in flags) die(`--${name} given more than once`);
      const next = argv[i + 1];
      // A value-flag with nothing after it is the silent-disarm case. Reject it.
      if (next === undefined || next.startsWith("--")) die(`--${name} requires a value (got ${next === undefined ? "end of arguments" : `the next flag "${next}"`})`);
      flags[name] = next;
      i++;
    } else if (boolOk.has(name)) {
      if (bools.has(name)) die(`--${name} given more than once`);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) die(`--${name} is a boolean flag and takes no value (got "${next}")`);
      bools.add(name);
    } else {
      // A typo must never be silently ignored — that is how --expect-total disarms.
      die(
        `unknown flag --${name} for mode "${mode}".\n` +
          `  value flags  : ${[...valueOk].map((f) => "--" + f).join(" ")}\n` +
          `  boolean flags: ${[...boolOk].map((f) => "--" + f).join(" ")}`,
      );
    }
  }
  return { mode, flags, bools };
}

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

function req(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (v === undefined) die(`--${name} is required`);
  return v;
}

// ---------------------------------------------------------------------------------------------
// enumeration
// ---------------------------------------------------------------------------------------------

/**
 * Recursive walk. HARD REQ 3.
 *
 * The S282 defect lived in exactly this function's ancestor: it recursed but computed the relative
 * path against the directory it was CURRENTLY in rather than the root it started from, so nested
 * entries came back as bare basenames. `root` is threaded through and `dir` is the cursor; the two
 * are deliberately separate parameters and `relative()` is anchored on `root`, never on `dir`.
 *
 * Symlinks are skipped rather than followed — a symlinked corpus directory would double-count and,
 * worse, could loop. Skipped symlinks are RETURNED to the caller rather than dropped, because a
 * skip nobody is told about is the same class of bug as a truncation.
 */
function walkSources(root: string, dir: string, out: string[], skippedLinks: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e: any) {
    // Never swallow. An unreadable directory is a truncation with a friendly face.
    throw new Error(`unreadable directory ${dir}: ${e.code ?? e.message}`);
  }
  // Sort for determinism (HARD REQ 7). readdir order is filesystem-dependent.
  entries.sort();
  for (const e of entries) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      skippedLinks.push(p);
      continue;
    }
    if (st.isDirectory()) walkSources(root, p, out, skippedLinks);
    else if (e.endsWith(SOURCE_EXT)) out.push(toPosix(relative(root, p)));
  }
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * HARD REQ 4 — cross-check the walk against an INDEPENDENT enumerator and fail loud on any
 * disagreement.
 *
 * `find` is a genuinely independent implementation: a different program, a different traversal, a
 * different language. Comparing COUNTS alone would be weak (two truncations can agree on a count);
 * this compares the full SETS in both directions and prints the symmetric difference.
 */
async function oracleEnumerate(absRoot: string): Promise<string[]> {
  const proc = Bun.spawn(["find", absRoot, "-type", "f", "-name", `*${SOURCE_EXT}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`oracle enumerator failed on ${absRoot} (exit ${code}): ${stderr.trim()}`);
  return stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => toPosix(relative(absRoot, l)));
}

// ---------------------------------------------------------------------------------------------
// corpus-shape classification (metadata only — NEVER a filter)
// ---------------------------------------------------------------------------------------------

/**
 * A conformance case directory holds one `case.scrml` ENTRY POINT and, in 15 places corpus-wide,
 * auxiliary modules that the case IMPORTS (`m.scrml`, `lib.scrml`, `a.scrml`, ...).
 *
 * This classification is recorded so a report can honestly describe the corpus. It is deliberately
 * NOT wired to any filter. Compiling an auxiliary module standalone is a legitimate measurement:
 * whatever it does, it does identically on both sides unless the change under test altered it, and
 * that is the only signal this tool is looking for. Dropping the 15 "because they are not entry
 * points" would be the S282/S319 defect wearing a justification.
 */
function classifyRole(relPath: string): "entry" | "auxiliary-module" {
  const parts = relPath.split("/");
  if (parts[0] !== "conformance") return "entry";
  const base = parts[parts.length - 1];
  return base === "case.scrml" ? "entry" : "auxiliary-module";
}

// ---------------------------------------------------------------------------------------------
// normalization — what must be folded out for two CHECKOUTS to be comparable
// ---------------------------------------------------------------------------------------------

/**
 * Two revisions live at two different filesystem paths and compile at two different wall-clock
 * instants. Both leak into the compiler's own console output. Folding exactly these two — and
 * nothing else — keeps the comparison about the COMPILER'S BEHAVIOUR while leaving every genuine
 * text change visible.
 *
 * The emitted ARTIFACTS were separately verified to contain no absolute-path leak, so artifacts are
 * compared byte-exact with no normalization at all. Only the console streams are normalized.
 */
function normalizeStream(text: string, compilerRoot: string, workRoot: string): string {
  let out = text;
  // Longest-first so a nested path does not get half-replaced.
  for (const [abs, token] of [
    [workRoot, "<OUT>"],
    [compilerRoot, "<ROOT>"],
  ] as const) {
    if (abs) out = out.split(abs).join(token);
  }
  return out
    // "Compiled 1 file in 295.5ms" — wall clock (HARD REQ 7).
    .replace(/\bin \d+(?:\.\d+)?ms\b/g, "in <MS>ms")
    // §47 content-addressed runtime filename.
    .replace(/scrml-runtime\.[0-9a-z]+\.js/g, RUNTIME_KEY)
    // Normalize CRLF so a checkout-level line-ending difference is not read as a behaviour change.
    .replace(/\r\n/g, "\n");
}

/** Diagnostic codes, for readable reporting only. Derived from the normalized streams. */
function extractDiagnosticCodes(text: string): string[] {
  const codes = new Set<string>();
  for (const m of text.matchAll(/\b([EWI]-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g)) codes.add(m[1]);
  return [...codes].sort();
}

/**
 * Derive, for one source's output directory, which emitted files are loaded as CLASSIC SCRIPTS.
 *
 * The compiler emits, for a page:
 *     <script src="scrml-runtime.01ouojs1.js">
 *     <script src="02-counter.client.js">
 * with no `type="module"`. Those two files must therefore parse as classic scripts, where a
 * top-level `await` is a fatal SyntaxError. A server bundle, by contrast, is ESM
 * (`import { SQL } from "bun"`) and must parse as a module.
 *
 * Returns a map from output-dir-relative path to (goggle, reason). Anything not named by an HTML
 * `<script src>` is left out and defaults to `module` at the call site.
 */
function deriveLoadContexts(outDir: string, htmlFiles: string[]): Map<string, { goggle: Goggle; reason: string }> {
  const out = new Map<string, { goggle: Goggle; reason: string }>();
  for (const htmlRel of htmlFiles) {
    let html: string;
    try {
      html = readFileSync(join(outDir, htmlRel), "utf8");
    } catch {
      continue; // an unreadable HTML is reported by the artifact-hashing stage, not silently here
    }
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = m[1];
      const srcM = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      if (!srcM) continue; // inline script — not a separately-emitted artifact
      const src = srcM[1];
      if (/^[a-z]+:/i.test(src) || src.startsWith("//")) continue; // external URL
      const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
      // Resolve the src relative to the HTML file's own directory, then re-anchor on outDir.
      const resolved = toPosix(relative(outDir, resolve(dirname(join(outDir, htmlRel)), src.replace(/^\.\//, ""))));
      const goggle: Goggle = isModule ? "module" : "script";
      const reason = `<script${isModule ? ' type="module"' : ""} src="${src}"> in ${htmlRel}`;
      const prior = out.get(resolved);
      if (prior && prior.goggle !== goggle) {
        // Referenced both ways. Take the STRICTER goggle and say so — never silently pick one.
        out.set(resolved, { goggle: "script", reason: `CONFLICT: ${prior.reason} vs ${reason} — using stricter (script)` });
      } else if (!prior) {
        out.set(resolved, { goggle, reason });
      }
    }
  }
  return out;
}

/**
 * Count `.scrml` sources that exist in the tree but fall OUTSIDE the selected roots.
 *
 * HARD REQ 2 in spirit: the tool is allowed to measure a subset, but the subset must be a VISIBLE
 * decision. Reporting the excluded population by directory is what turns "we only look at three
 * directories" from an invisible default into a stated one.
 */
async function excludedPopulation(compilerRoot: string, roots: string[]): Promise<{ total: number; perTopLevelDir: Record<string, number> }> {
  const proc = Bun.spawn(
    ["find", compilerRoot, "-name", `*${SOURCE_EXT}`, "-type", "f", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) return { total: 0, perTopLevelDir: {} };
  const selected = roots.map((r) => r.replace(/\/+$/, "") + "/");
  const perTopLevelDir: Record<string, number> = {};
  let total = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const rel = toPosix(relative(compilerRoot, line));
    if (rel.startsWith("..")) continue;
    if (selected.some((s) => rel.startsWith(s))) continue;
    total++;
    const top = rel.split("/")[0];
    perTopLevelDir[top] = (perTopLevelDir[top] ?? 0) + 1;
  }
  return { total, perTopLevelDir };
}

/**
 * Count client server-fn call sites (`_scrml_fetch_*(`) and split them awaited vs BARE.
 *
 * This is the standing metric for auto-await work: a BARE call site is a server fn whose Promise is
 * being consumed as if it were a value. The count tells you whether an auto-await change actually
 * moved anything — a change that reports "no regression" while the bare count is unchanged has not
 * reached the instances of the bug already sitting in the corpus.
 *
 * Deliberately a simple lexical scan, not a parse: it is a TREND metric compared between two sides
 * of the same corpus, where a consistent counting rule matters more than an exact one. The raw
 * counts are reported alongside the delta so the rule's absolute accuracy is never load-bearing.
 */
const FETCH_CALL = /_scrml_fetch_[A-Za-z0-9_]+\s*\(/g;
function countServerFnCallSites(text: string): { total: number; awaited: number; bare: number } {
  let total = 0;
  let awaited = 0;
  for (const m of text.matchAll(FETCH_CALL)) {
    const before = text.slice(Math.max(0, m.index! - 40), m.index!);
    // A DECLARATION (`async function _scrml_fetch_foo_12(userId) {`) matches the same shape as a
    // call. It is not a call site and must not be counted — an early version of this metric
    // counted them and roughly doubled the totals.
    if (/\bfunction\s+$/.test(before)) continue;
    total++;
    // `await f(`, and the parenthesized form `(await f(` that the match-arm lowering emits.
    if (/\bawait\s*$/.test(before) || /\bawait\s*\(\s*$/.test(before)) awaited++;
  }
  return { total, awaited, bare: total - awaited };
}

/**
 * HARD REQ 8 — measure the chunk-namespace ANCHOR with the compiler-under-test's OWN resolver.
 *
 * See the `NamespaceAnchor` docstring for why this exists and what is compared. Notes on fidelity,
 * because "close enough" is how a guard reports the wrong answer:
 *
 *   - The compiler starts its walk at `computeOutputBaseDir(cgSourcePaths)` (`api.js:2407`), which
 *     for a ONE-FILE compile is exactly `dirname(resolve(sourcePath))` (`api.js:200`). `compileOne`
 *     spawns one process per source, so a one-file compile is the only shape this tool ever
 *     produces, and `dirname(abs)` is the faithful start path — not an approximation of one.
 *   - `resolveProjectRoot` returns only the directory, not which marker stopped it. The marker is
 *     re-derived by asking the filesystem about the RESOLVED root, which is also exactly what the
 *     remedy acts on (`mkdir <root>/.git`).
 *   - Verified end-to-end: for two probe trees this function reproduces `01t8u5va` / `002qn9lf`,
 *     the tokens the compiler actually emitted into `// --- chunk cell scope (…) ---`.
 */
async function resolveNamespaceAnchor(compilerRoot: string, sources: string[]): Promise<NamespaceAnchor> {
  const modPath = join(compilerRoot, "compiler/src/codegen/chunk-namespace.ts");
  const unavailable = (why: string): NamespaceAnchor => ({
    resolverAvailable: false,
    method: why,
    roots: [],
    prefixes: [],
    prefixDigest: "",
    tokenDigest: "",
  });

  if (!existsSync(modPath)) return unavailable(`<unavailable: ${toPosix(relative(compilerRoot, modPath))} does not exist in this checkout>`);
  let mod: any;
  try {
    mod = await import(modPath);
  } catch (e: any) {
    return unavailable(`<unavailable: importing ${toPosix(relative(compilerRoot, modPath))} threw — ${e?.message ?? e}>`);
  }
  for (const fn of ["resolveProjectRoot", "projectRelativeSourcePath", "chunkNamespaceToken"]) {
    if (typeof mod[fn] !== "function") {
      return unavailable(`<unavailable: ${toPosix(relative(compilerRoot, modPath))} exports no ${fn}()>`);
    }
  }

  const rootCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();
  const prefixLines: string[] = [];
  const tokenLines: string[] = [];

  for (const rel of sources) {
    const abs = join(compilerRoot, rel);
    const root: string | null = mod.resolveProjectRoot(dirname(abs)) ?? null;
    const projectRel: string = mod.projectRelativeSourcePath(abs, root);
    const token: string = mod.chunkNamespaceToken(abs, root);
    // `projectRel` is `<prefix><rel>` in every shape where the source lives under the corpus root,
    // which is every shape this tool enumerates. The non-suffix case is recorded verbatim rather
    // than papered over — an unexplained shape must be visible, not normalized away.
    const prefix = projectRel.endsWith(rel) ? projectRel.slice(0, projectRel.length - rel.length) : `<NOT-A-SUFFIX:${projectRel}>`;
    rootCounts.set(root ?? "", (rootCounts.get(root ?? "") ?? 0) + 1);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    prefixLines.push(`${rel}\0${prefix}`);
    tokenLines.push(`${rel}\0${token}`);
  }

  const roots = [...rootCounts.entries()].sort().map(([root, count]) => {
    const marker = root === ""
      ? null
      : (PROJECT_ROOT_MARKER_NAMES.find((m) => existsSync(join(root, m))) ?? null);
    return { projectRoot: root === "" ? null : root, marker, sources: count };
  });
  const prefixes = [...prefixCounts.entries()].sort().map(([prefix, count]) => ({ prefix, sources: count }));

  return {
    resolverAvailable: true,
    method: `${toPosix(relative(compilerRoot, modPath))} :: resolveProjectRoot(dirname(source)) + projectRelativeSourcePath + chunkNamespaceToken, from the compiler under test`,
    roots,
    prefixes,
    // `sources` arrives sorted (capture sorts it before this is called); hashing in that order is
    // what makes the digest a stable comparable rather than a walk-order artefact.
    prefixDigest: createHash("sha256").update(prefixLines.join("\n")).digest("hex"),
    tokenDigest: createHash("sha256").update(tokenLines.join("\n")).digest("hex"),
  };
}

/**
 * The markers `resolveProjectRoot` walks up for, in its own priority order. Duplicated here ONLY to
 * name which one stopped the walk — the walk itself is never re-implemented (Rule 7: resolve it, do
 * not pattern-match it). If `chunk-namespace.ts` ever gains a third marker this list goes stale in
 * the one direction that is safe: the root is still correct, the reported marker reads `null`.
 */
const PROJECT_ROOT_MARKER_NAMES = ["scrml.toml", ".git"] as const;

/** One-line human rendering of an anchor, for capture logs and diff findings. */
function describeAnchor(a: NamespaceAnchor): string {
  if (!a.resolverAvailable) return a.method;
  const roots = a.roots
    .map((r) => `${r.projectRoot ?? "<none — walk reached the filesystem root>"}${r.marker ? ` (marker ${r.marker})` : ""} x${r.sources}`)
    .join(" | ");
  const prefixes = a.prefixes.map((p) => `"${p.prefix}" x${p.sources}`).join(" | ");
  return `root ${roots}   source-path prefix ${prefixes}`;
}

function artifactKey(relPath: string): string {
  const parts = relPath.split("/");
  const base = parts[parts.length - 1];
  if (RUNTIME_FILE.test(base)) {
    parts[parts.length - 1] = RUNTIME_KEY;
    return parts.join("/");
  }
  return relPath;
}

// ---------------------------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------------------------

interface CaptureOptions {
  compilerRoot: string;
  label: string;
  work: string;
  manifestPath: string;
  roots: string[];
  concurrency: number;
  expectTotal?: number;
  reuseArtifacts: boolean;
  syntaxCheck: boolean;
}

async function capture(opts: CaptureOptions): Promise<number> {
  const { compilerRoot, work, roots } = opts;

  console.log("=".repeat(92));
  console.log(`CAPTURE  label=${opts.label}`);
  console.log(`  compiler root : ${compilerRoot}`);
  console.log(`  work tree     : ${work}`);
  console.log(`  roots         : ${roots.join(", ")}  (recursive)`);
  console.log(`  concurrency   : ${opts.concurrency}`);
  console.log(`  mode          : ${opts.reuseArtifacts ? "REUSE existing artifacts (no compile)" : "compile"}`);
  console.log("=".repeat(92));

  const revision = await gitRevision(compilerRoot);
  console.log(`  revision      : ${revision}`);

  // ---- stage 1: enumerate -------------------------------------------------------------------
  const perRoot: Record<string, number> = {};
  const oraclePerRoot: Record<string, number> = {};
  const allSources: string[] = [];
  const oracleAll: string[] = [];
  const skippedLinks: string[] = [];
  let selfCheckFailed = false;

  for (const root of roots) {
    const absRoot = resolve(compilerRoot, root);
    if (!existsSync(absRoot)) {
      // A missing root is LOUD. Silently enumerating zero files from a mistyped root is precisely
      // how a narrowed corpus passes for a wide one.
      console.error(`\nSELF-CHECK FAILED: root does not exist: ${root} (resolved ${absRoot})`);
      selfCheckFailed = true;
      perRoot[root] = 0;
      oraclePerRoot[root] = 0;
      continue;
    }
    const found: string[] = [];
    walkSources(absRoot, absRoot, found, skippedLinks);
    const oracle = await oracleEnumerate(absRoot);
    perRoot[root] = found.length;
    oraclePerRoot[root] = oracle.length;
    for (const f of found) allSources.push(`${root}/${f}`);
    for (const f of oracle) oracleAll.push(`${root}/${f}`);
  }

  allSources.sort();
  oracleAll.sort();

  const walkSet = new Set(allSources);
  const oracleSet = new Set(oracleAll);
  const onlyInWalk = allSources.filter((s) => !oracleSet.has(s));
  const onlyInOracle = oracleAll.filter((s) => !walkSet.has(s));
  const agrees = onlyInWalk.length === 0 && onlyInOracle.length === 0 && allSources.length === oracleAll.length;

  console.log(`\n[1/5] ENUMERATION`);
  for (const root of roots) {
    console.log(
      `      ${root.padEnd(14)} ${String(perRoot[root]).padStart(5)} of ${String(allSources.length).padStart(5)} total` +
        `   (independent oracle: ${oraclePerRoot[root]})`,
    );
  }
  console.log(`      ${"TOTAL".padEnd(14)} ${String(allSources.length).padStart(5)} of ${String(allSources.length).padStart(5)} total   (independent oracle: ${oracleAll.length})`);
  if (walkSet.size !== allSources.length) {
    console.error(`SELF-CHECK FAILED: the walk produced duplicate relative paths (${allSources.length} entries -> ${walkSet.size} unique)`);
    selfCheckFailed = true;
  }
  if (!agrees) {
    console.error(`SELF-CHECK FAILED: walk and independent oracle DISAGREE (walk ${allSources.length}, oracle ${oracleAll.length})`);
    // No cap. The whole symmetric difference prints (HARD REQ 2).
    for (const s of onlyInWalk) console.error(`        only in WALK  : ${s}`);
    for (const s of onlyInOracle) console.error(`        only in ORACLE: ${s}`);
    selfCheckFailed = true;
  } else {
    console.log(`      cross-check   : AGREE (walk set == independent \`find\` set, both directions)`);
  }
  if (skippedLinks.length > 0) {
    // A deliberate skip, declared with its full contents. HARD REQ 2: a bounded measurement is not
    // allowed, but a declared exclusion is honest.
    console.log(`      symlinks SKIPPED (not emitted artifacts): ${skippedLinks.length}`);
    for (const l of skippedLinks) console.log(`        ${l}`);
  }
  // ALWAYS print the assertion's status, present or absent. The failure mode being closed here is
  // a silently-disarmed guard: previously, if `--expect-total` never made it through argument
  // parsing, the output was simply missing this line and nothing said so. An absence is not a
  // signal a human reliably notices.
  if (opts.expectTotal !== undefined) {
    if (allSources.length !== opts.expectTotal) {
      console.error(
        `SELF-CHECK FAILED: --expect-total ${opts.expectTotal} but enumerated ${allSources.length}` +
          ` (difference ${allSources.length - opts.expectTotal})`,
      );
      selfCheckFailed = true;
    } else {
      console.log(`      expect-total  : ASSERTED and MATCHED (${opts.expectTotal})`);
    }
  } else {
    console.log(`      expect-total  : NOT ASSERTED — no --expect-total given, so the enumerated count is unverified against any external expectation`);
  }

  const excluded = await excludedPopulation(compilerRoot, roots);
  if (excluded.total > 0) {
    const byDir = Object.keys(excluded.perTopLevelDir).sort().map((d) => `${d} ${excluded.perTopLevelDir[d]}`).join(", ");
    console.log(
      `      EXCLUDED      : ${excluded.total} *${SOURCE_EXT} source(s) exist outside the selected roots and are NOT measured\n` +
        `                      ${byDir}`,
    );
  } else {
    console.log(`      EXCLUDED      : 0 — the selected roots cover every *${SOURCE_EXT} source in the tree`);
  }

  const roleCounts = { entry: 0, "auxiliary-module": 0 };
  for (const s of allSources) roleCounts[classifyRole(s)]++;
  console.log(
    `      corpus shape  : ${roleCounts.entry} entry + ${roleCounts["auxiliary-module"]} auxiliary-module` +
      ` = ${allSources.length} of ${allSources.length} (metadata only — nothing is filtered)`,
  );

  // HARD REQ 8 — the chunk-namespace anchor. Measured here, at the earliest point it CAN be
  // measured, because the alternative is finding out after both sides have been captured that
  // neither comparison meant anything.
  const namespaceAnchor = await resolveNamespaceAnchor(compilerRoot, allSources);
  console.log(`      ns anchor     : ${describeAnchor(namespaceAnchor)}`);
  if (!namespaceAnchor.resolverAvailable) {
    console.log(
      `                      *** THE CHUNK-NAMESPACE ANCHOR IS UNMEASURED ON THIS SIDE. ***\n` +
        `                      \`diff\` cannot verify that this capture and its counterpart hashed the\n` +
        `                      same source paths, so an artifact-content difference may be an artefact\n` +
        `                      of WHERE THIS TREE LIVES rather than of the compiler. Expected for a\n` +
        `                      revision predating chunk-namespacing; a defect for any modern one.`,
    );
  } else {
    const nonEmpty = namespaceAnchor.prefixes.filter((p) => p.prefix !== "");
    if (nonEmpty.length > 0) {
      console.log(
        `                      *** WARNING: ${nonEmpty.reduce((n, p) => n + p.sources, 0)} source(s) hash a path with a NON-EMPTY prefix. ***\n` +
          `                      Every namespace token on this side embeds this tree's LOCATION, so it\n` +
          `                      only compares against a counterpart whose prefix is byte-identical.\n` +
          `                      Usual cause: this tree has no \`scrml.toml\` and no \`.git\` (a \`git\n` +
          `                      archive\` extraction), so the compiler anchored on the absolute path.\n` +
          `                      Remedy: \`mkdir ${compilerRoot}/.git\` and re-capture this side.`,
      );
    }
  }

  // Slug collision check. Output dirs are derived from source paths; if two sources mapped to one
  // dir, one would silently overwrite the other's artifacts.
  const slugs = new Map<string, string>();
  for (const s of allSources) {
    const slug = sourceSlug(s);
    const prior = slugs.get(slug);
    if (prior !== undefined) {
      console.error(`SELF-CHECK FAILED: output-dir slug collision "${slug}" between ${prior} and ${s}`);
      selfCheckFailed = true;
    }
    slugs.set(slug, s);
  }

  if (selfCheckFailed) {
    console.error(`\nCAPTURE ABORTED: one or more self-checks failed. No manifest written.`);
    return 1;
  }

  // ---- stage 2: compile ---------------------------------------------------------------------
  const records = new Map<string, SourceRecord>();

  if (opts.reuseArtifacts) {
    console.log(
      `\n[2/5] COMPILE — SKIPPED (--reuse-artifacts): re-hashing the existing work tree in place.\n` +
        `      COMPILE OUTCOMES IN THIS MANIFEST ARE NOT MEASUREMENTS. Every source is recorded\n` +
        `      exitCode=-1 / ok=false. The manifest carries reuseArtifacts=true and \`diff\` refuses\n` +
        `      to draw compile conclusions from it without --allow-reuse-manifest.`,
    );
    for (const s of allSources) {
      records.set(s, {
        path: s,
        role: classifyRole(s),
        // NOT `existsSync(outDir)`. The previous version used exactly that, and because
        // `compileOne` unconditionally `mkdirSync`s the output dir, EVERY source came back
        // "compiled OK" — a real capture reported 60 of 71, the reuse capture of the same tree
        // reported 71 of 71. A fabricated success is worse than a declared unknown, so this is
        // now uniformly `ok: false` with a sentinel exit code, and the manifest-level
        // `reuseArtifacts` flag is what `diff` keys off.
        compile: { exitCode: -1, ok: false, stdout: "<reuse-artifacts: compile NOT re-measured>", stderr: "<reuse-artifacts: compile NOT re-measured>", diagnosticCodes: [] },
        artifacts: [],
      });
    }
  } else {
    if (existsSync(work)) rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    console.log(`\n[2/5] COMPILE — ${allSources.length} sources, concurrency ${opts.concurrency}`);
    let done = 0;
    await pool(allSources, opts.concurrency, async (src) => {
      const rec = await compileOne(src, opts.compilerRoot, opts.work);
      records.set(src, rec);
      done++;
      if (done % 200 === 0 || done === allSources.length) {
        console.log(`      compiled ${done} of ${allSources.length}`);
      }
    });
  }

  let compileOk = 0;
  let compileFailed = 0;
  for (const s of allSources) {
    const r = records.get(s)!;
    if (r.compile.ok) compileOk++;
    else compileFailed++;
  }
  if (opts.reuseArtifacts) {
    console.log(`      attempted     : 0 of ${allSources.length} enumerated — compile stage did not run`);
  } else {
    console.log(
      `      attempted     : ${allSources.length} of ${allSources.length} enumerated\n` +
        `      compiled OK   : ${compileOk} of ${allSources.length} attempted\n` +
        `      compile FAILED: ${compileFailed} of ${allSources.length} attempted  ` +
        `(HARD REQ 5 — failures are DATA; the signal is the failure SET changing, never the count being nonzero)`,
    );
  }

  // ---- stage 3: hash artifacts --------------------------------------------------------------
  console.log(`\n[3/5] ARTIFACT HASHING`);
  let artifactsEmitted = 0;
  let unreadable = 0;
  for (const s of allSources) {
    const rec = records.get(s)!;
    const outDir = join(work, sourceSlug(s));
    if (!existsSync(outDir)) continue;
    const files: string[] = [];
    const links: string[] = [];
    walkAny(outDir, outDir, files, links);
    for (const l of links) console.log(`      symlink skipped in output tree: ${toPosix(relative(work, l))}`);
    for (const f of files.sort()) {
      let buf: Buffer;
      try {
        buf = readFileSync(join(outDir, f));
      } catch (e: any) {
        // NEVER silently skip — an unreadable artifact is exactly how the S282 gate reported green
        // over 107 files it never opened.
        console.error(`SELF-CHECK FAILED: unreadable artifact ${s} :: ${f} (${e.code ?? e.message})`);
        unreadable++;
        continue;
      }
      const ext = f.slice(f.lastIndexOf("."));
      const art: ArtifactRecord = {
        key: artifactKey(f),
        realPath: f,
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.length,
      };
      if (CHECKABLE_EXT.has(ext)) {
        const c = countServerFnCallSites(buf.toString("utf8"));
        if (c.total > 0) art.serverFnCallSites = c;
      }
      rec.artifacts.push(art);
      artifactsEmitted++;
    }
    rec.artifacts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const keys = new Set(rec.artifacts.map((a) => a.key));
    if (keys.size !== rec.artifacts.length) {
      console.error(`SELF-CHECK FAILED: duplicate artifact keys under ${s} (${rec.artifacts.length} -> ${keys.size})`);
      unreadable++;
    }

    // Which goggle does each artifact actually get loaded under? Derived from the emitted HTML in
    // this source's own output dir. Anything the HTML does not name defaults to `module`.
    const htmlFiles = rec.artifacts.filter((a) => a.realPath.toLowerCase().endsWith(".html")).map((a) => a.realPath);
    const contexts = deriveLoadContexts(outDir, htmlFiles);
    for (const art of rec.artifacts) {
      const ext = art.realPath.slice(art.realPath.lastIndexOf("."));
      if (!CHECKABLE_EXT.has(ext)) continue;
      const ctx = contexts.get(art.realPath);
      if (ctx) {
        art.loadedAs = ctx.goggle;
        art.loadedAsReason = ctx.reason;
      } else if (ext === ".cjs") {
        art.loadedAs = "script";
        art.loadedAsReason = "no HTML reference; .cjs extension implies CommonJS (script goggles)";
      } else {
        art.loadedAs = "module";
        art.loadedAsReason = "no HTML <script> reference — treated as an imported module (server bundle / dynamic chunk)";
      }
    }
  }
  const sourcesWithArtifacts = allSources.filter((s) => records.get(s)!.artifacts.length > 0).length;
  console.log(
    `      sources emitting artifacts: ${sourcesWithArtifacts} of ${allSources.length} enumerated\n` +
      `      artifacts hashed          : ${artifactsEmitted} of ${artifactsEmitted} discovered`,
  );
  const fx = serverFnCallSiteTotals(allSources.map((s) => records.get(s)!), true);
  const fxAll = serverFnCallSiteTotals(allSources.map((s) => records.get(s)!), false);
  console.log(
    `      client server-fn call sites (_scrml_fetch_*) in CLEANLY-COMPILING sources:\n` +
      `        ${fx.total} total in ${fx.sources} sources — ${fx.awaited} awaited, ${fx.bare} BARE\n` +
      `        (whole corpus incl. failing compiles: ${fxAll.total} total, ${fxAll.bare} bare)`,
  );
  if (unreadable > 0) {
    console.error(`\nCAPTURE ABORTED: ${unreadable} artifact-stage self-check failure(s). No manifest written.`);
    return 1;
  }

  // ---- stage 4: syntax check under EXPLICIT goggles ------------------------------------------
  let artifactsCheckable = 0;
  let syntaxChecked = 0;
  let syntaxFailedEffective = 0;
  let syntaxFailedScript = 0;
  let syntaxFailedModule = 0;
  let resolvedFromCache = 0;
  let loadedAsScript = 0;
  let loadedAsModule = 0;
  const checkCache = new Map<string, Record<Goggle, GoggleResult>>();

  const checkable: Array<{ rec: SourceRecord; art: ArtifactRecord; abs: string }> = [];
  for (const s of allSources) {
    const rec = records.get(s)!;
    for (const art of rec.artifacts) {
      const ext = art.realPath.slice(art.realPath.lastIndexOf("."));
      if (!CHECKABLE_EXT.has(ext)) continue;
      artifactsCheckable++;
      if (art.loadedAs === "script") loadedAsScript++;
      else loadedAsModule++;
      checkable.push({ rec, art, abs: join(work, sourceSlug(s), art.realPath) });
    }
  }

  if (!opts.syntaxCheck) {
    console.log(
      `\n[4/5] SYNTAX CHECK — SKIPPED (--no-syntax-check). ${artifactsCheckable} of ${artifactsEmitted} emitted artifacts NOT checked.\n` +
        `      A manifest captured this way records syntaxChecked=0. \`diff\` treats a run in which\n` +
        `      BOTH sides checked nothing while checkable artifacts existed as VACUOUS, not as clean.`,
    );
  } else {
    console.log(
      `\n[4/5] SYNTAX CHECK — ${artifactsCheckable} checkable artifacts of ${artifactsEmitted} emitted\n` +
        `      goggles: BOTH, for every artifact — classic script (vm.Script) AND module (vm.SourceTextModule)\n` +
        `      load context derived from emitted HTML: ${loadedAsScript} loaded as SCRIPT, ${loadedAsModule} as MODULE`,
    );
    // Content-keyed memoization.
    //
    // The key is (sha256, extension) — NOT sha256 alone. The previous version keyed on content and
    // justified it with "the check is a pure function of CONTENT". That was false: the same bytes
    // as `twin.cjs` and `twin.mjs` get different verdicts. The extension is part of the input, so
    // it is part of the key. The goggle context is no longer an ambient input at all: `vm.Script`
    // and `vm.SourceTextModule` read the source text and nothing else, and BOTH are computed for
    // every artifact, so nothing about the memo can hide a load-context change.
    const distinct = new Map<string, Array<{ rec: SourceRecord; art: ArtifactRecord; abs: string }>>();
    for (const c of checkable) {
      const ext = c.art.realPath.slice(c.art.realPath.lastIndexOf("."));
      const memoKey = `${c.art.sha256}|${ext}`;
      const g = distinct.get(memoKey);
      if (g) g.push(c);
      else distinct.set(memoKey, [c]);
    }
    const reps = [...distinct.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const results = await runGoggles(reps.map(([key, group]) => ({ id: key, path: group[0].abs })), opts);
    for (const [key] of reps) {
      const r = results[key];
      if (!r) {
        console.error(`SELF-CHECK FAILED: goggle worker returned no result for ${key}`);
        return 1;
      }
      checkCache.set(key, r);
    }
    for (const c of checkable) {
      const ext = c.art.realPath.slice(c.art.realPath.lastIndexOf("."));
      const r = checkCache.get(`${c.art.sha256}|${ext}`)!;
      c.art.syntax = r;
      syntaxChecked++;
      if (!r.script.ok) syntaxFailedScript++;
      if (!r.module.ok) syntaxFailedModule++;
      if (!r[c.art.loadedAs ?? "module"].ok) syntaxFailedEffective++;
    }
    resolvedFromCache = syntaxChecked - reps.length;
    console.log(
      `      checked       : ${syntaxChecked} of ${artifactsCheckable} checkable\n` +
        `        distinct (content, ext) keys actually parsed : ${reps.length} of ${syntaxChecked}\n` +
        `        resolved from memo                           : ${resolvedFromCache} of ${syntaxChecked} (identical bytes AND identical extension)\n` +
        `      FAILING under the goggle each artifact is ACTUALLY loaded under : ${syntaxFailedEffective} of ${syntaxChecked}\n` +
        `        (for reference — script goggles on all: ${syntaxFailedScript}, module goggles on all: ${syntaxFailedModule})`,
    );
  }

  // ---- stage 5: manifest --------------------------------------------------------------------
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    label: opts.label,
    compilerRoot,
    revision,
    roots,
    namespaceAnchor,
    reuseArtifacts: opts.reuseArtifacts,
    checkContext: {
      method: opts.syntaxCheck
        ? "vm.Script (classic script) + vm.SourceTextModule (module) — explicit goggles, no package.json/extension resolution"
        : "<no syntax check performed>",
      nodeVersion: opts.syntaxCheck ? await checkerNodeVersion() : "<none>",
      work,
    },
    excludedPopulation: excluded,
    enumeration: {
      perRoot,
      total: allSources.length,
      crossCheck: { method: "find -type f -name '*.scrml'", perRoot: oraclePerRoot, total: oracleAll.length, agrees, onlyInWalk, onlyInOracle },
    },
    totals: {
      enumerated: allSources.length,
      compileAttempted: opts.reuseArtifacts ? 0 : allSources.length,
      compileOk,
      compileFailed,
      artifactsEmitted,
      artifactsCheckable,
      syntaxChecked,
      syntaxFailedEffective,
      syntaxFailedScript,
      syntaxFailedModule,
      syntaxDistinctKeys: checkCache.size,
      syntaxResolvedFromCache: resolvedFromCache,
      loadedAsScript,
      loadedAsModule,
    },
    // Sorted by path (allSources is already sorted) — determinism, HARD REQ 7.
    sources: allSources.map((s) => records.get(s)!),
  };

  mkdirSync(dirname(opts.manifestPath), { recursive: true });
  // Deliberately NOT `JSON.stringify(x, null, 2)` on a Map-derived object with unstable key order:
  // every container above is built in sorted order, so the serialization is byte-stable.
  writeFileSync(opts.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n[5/5] MANIFEST -> ${opts.manifestPath}`);
  console.log(
    `      enumerated ${manifest.totals.enumerated} · attempted ${manifest.totals.compileAttempted}` +
      ` · compiled ${manifest.totals.compileOk} · emitted ${manifest.totals.artifactsEmitted}` +
      ` · checked ${manifest.totals.syntaxChecked} · syntax-failing (effective) ${manifest.totals.syntaxFailedEffective}`,
  );
  return 0;
}

/**
 * Aggregate the per-artifact server-fn call-site counts.
 *
 * `cleanOnly` restricts to sources that COMPILED — that is the population the metric is about. A
 * bare call site in an artifact emitted from a failing compile is garbage, not a live instance of
 * the bug.
 */
function serverFnCallSiteTotals(records: SourceRecord[], cleanOnly: boolean): { total: number; awaited: number; bare: number; sources: number } {
  let total = 0;
  let awaited = 0;
  let bare = 0;
  let sources = 0;
  for (const rec of records) {
    if (cleanOnly && !rec.compile.ok) continue;
    let any = false;
    for (const a of rec.artifacts) {
      if (!a.serverFnCallSites) continue;
      any = true;
      total += a.serverFnCallSites.total;
      awaited += a.serverFnCallSites.awaited;
      bare += a.serverFnCallSites.bare;
    }
    if (any) sources++;
  }
  return { total, awaited, bare, sources };
}

async function checkerNodeVersion(): Promise<string> {
  const proc = Bun.spawn(["node", "--version"], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : "<unknown>";
}

/** Output directory name for a source. Injective by construction; asserted non-colliding above. */
function sourceSlug(relPath: string): string {
  return relPath.replace(/\.scrml$/, "").split("/").join("~");
}

async function gitRevision(root: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : "<unknown>";
}

function walkAny(root: string, dir: string, out: string[], links: string[]): void {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      links.push(p);
      continue;
    }
    // Anchored on `root`, never on `dir` — see walkSources.
    if (st.isDirectory()) walkAny(root, p, out, links);
    else out.push(toPosix(relative(root, p)));
  }
}

/**
 * Compile ONE source with ONE compiler into ONE output dir.
 *
 * Takes `compilerRoot`/`work` directly rather than a whole `CaptureOptions` because the HARD REQ 9
 * re-verification calls it with a DIFFERENT compiler root and a DIFFERENT work tree per side, and
 * a shared parameter object would have invited a second, drifting copy of this function.
 */
async function compileOne(src: string, compilerRoot: string, work: string): Promise<SourceRecord> {
  const outDir = join(work, sourceSlug(src));
  mkdirSync(outDir, { recursive: true });
  const proc = Bun.spawn(["bun", join(compilerRoot, "compiler/src/cli.js"), "compile", src, "-o", outDir], {
    cwd: compilerRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const nOut = normalizeStream(stdout, compilerRoot, work);
  const nErr = normalizeStream(stderr, compilerRoot, work);
  return {
    path: src,
    role: classifyRole(src),
    compile: { exitCode, ok: exitCode === 0, stdout: nOut, stderr: nErr, diagnosticCodes: extractDiagnosticCodes(nOut + "\n" + nErr) },
    artifacts: [],
  };
}

/**
 * Run BOTH parser goggles over a batch of artifacts, in a separate NODE process.
 *
 * `node --check` is deliberately NOT used. Three measured reasons, all documented at length in
 * `scripts/corpus-check-goggles.js`:
 *   - it PASSES a top-level `await` in a bare `.js` (module auto-detection), while the emitted HTML
 *     loads client bundles as classic `<script src=...>` where that is a fatal SyntaxError;
 *   - its verdict depends on the nearest `package.json` `"type"`, an input outside the manifest;
 *   - and it cannot be replaced by an in-process Bun `vm.Script`, because Bun's does not reject a
 *     top-level await at all.
 *
 * Batched through one worker process: correctness without a spawn per artifact.
 */
async function runGoggles(jobs: Array<{ id: string; path: string }>, opts: CaptureOptions): Promise<Record<string, Record<Goggle, GoggleResult>>> {
  if (jobs.length === 0) return {};
  const dir = mkdtempSync(join(tmpdir(), "corpus-goggles-"));
  const jobsPath = join(dir, "jobs.json");
  const resultsPath = join(dir, "results.json");
  try {
    writeFileSync(jobsPath, JSON.stringify(jobs.map((j) => ({ ...j, goggles: ALL_GOGGLES }))));
    const worker = join(dirname(fileURLToPath(import.meta.url)), "corpus-check-goggles.js");
    const proc = Bun.spawn(["node", "--experimental-vm-modules", "--no-warnings", worker, jobsPath, resultsPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      // A checker that cannot run must never look like a checker that passed.
      throw new Error(`goggle worker exited ${code}: ${stderr.trim()}`);
    }
    const raw = JSON.parse(readFileSync(resultsPath, "utf8")) as Record<string, Record<Goggle, GoggleResult>>;
    // Normalize messages so two checkouts at two different paths compare.
    for (const id of Object.keys(raw)) {
      for (const g of ALL_GOGGLES) {
        const r = raw[id][g];
        if (r) r.message = normalizeStream(r.message, opts.compilerRoot, opts.work).trim();
      }
    }
    return raw;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bounded-concurrency map. Bounds PARALLELISM, never the population. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------------------------
// HARD REQ 9 — serial re-verification of the DELTA
// ---------------------------------------------------------------------------------------------

/**
 * DEFECT 2. At the default `--concurrency 10` a capture reported 8 newly-failing sources, 8
 * diagnostic changes and 27 removed artifacts. Direct in-process compilation of those same sources
 * under both compilers was IDENTICAL, and a re-capture matched the control exactly. The findings
 * were manufactured by the harness, and the report gave the reader no hint.
 *
 * ROOT-CAUSE STATUS, stated honestly because a wrong in-source rationale is worse than none: NOT
 * FOUND. Two full 1906-source captures at `--concurrency 10` on one revision were compared per
 * source — compile outcome, exit code, both normalized streams, artifact SET and every artifact
 * sha256 — and produced ZERO differences. `compileOne` spawns independent processes with per-source
 * output directories; the compiler writes nothing to a shared cache or fixed-name temp path. The
 * remaining candidates are all MACHINE-STATE, not program logic: memory pressure from concurrent
 * work on the same host (measured single-compile peak RSS ~120MB, so ten at a time is ~1.2GB before
 * anything else is running), and process/file-descriptor exhaustion. That means it cannot be closed
 * by reading the code, and a mitigation that does not depend on knowing the cause is the correct
 * shape — not a fallback from one.
 *
 * WHY THIS SHAPE. The measurement that matters is the failure SET CHANGING (HARD REQ 5) — ~680 of
 * 1906 corpus sources legitimately fail to compile standalone and that is DATA. So only outcomes
 * that DIFFER between the two captures can be phantom, and only those are re-compiled: the work is
 * bounded by the DELTA, never by the population. Serialising the whole run instead would trade a
 * five-minute gate for an hour-long one to check ~8 sources.
 *
 * WHY THE UNIT IS THE SOURCE, NOT THE FINDING. One phantom compile produces a compile-outcome
 * finding AND a diagnostic finding AND an artifact-set finding AND content findings, all from the
 * same spawned process. Re-verifying per finding would re-compile the same source four times and
 * could reach four different conclusions about one event.
 *
 * ⚠ THE SWALLOW RISK IS THE THING TO WATCH, and it is why the flake test is asymmetric. A
 * re-verification that quietly reclassified real findings as flakes would convert this instrument
 * from one that lies loudly into one that lies quietly, which is strictly worse. So:
 *
 *     a source is a FLAKE only if its serial re-compilation shows NO DIFFERENCE AT ALL.
 *
 * Not "the same difference did not reproduce" — ANY difference, in any class, keeps every finding
 * for that source. A genuinely nondeterministic source therefore reports as a finding whenever its
 * re-run happens to diverge, and the re-verification can only ever discard a source that looked
 * identical under both compilers when compiled alone. A re-compilation that ERRORS is likewise not
 * a flake; it keeps its findings and is reported separately.
 */
interface ReverifyReport {
  ran: boolean;
  /** Why it ran, or the exact reason it did not. Printed either way. */
  reason: string;
  /** Sources implicated in at least one per-source difference, with the classes that implicated them. */
  implicated: Array<{ path: string; classes: string[] }>;
  /** Sources whose difference REPRODUCED under serial re-compilation, with what reproduced. */
  reproduced: Array<{ path: string; differences: string[] }>;
  /** Sources that showed NO difference at all on serial re-compilation — HARNESS FLAKES. */
  flaked: Array<{ path: string; classes: string[] }>;
  /** Sources whose re-compilation could not be performed. NOT flakes; their findings stand. */
  errored: Array<{ path: string; message: string }>;
}

/** Hash one output directory the same way capture's stage 3 does, keyed identically. */
function hashOutputDir(outDir: string): { arts: Map<string, string>; error?: string } {
  const arts = new Map<string, string>();
  if (!existsSync(outDir)) return { arts };
  const files: string[] = [];
  const links: string[] = [];
  try {
    walkAny(outDir, outDir, files, links);
  } catch (e: any) {
    return { arts, error: `unreadable output tree: ${e?.message ?? e}` };
  }
  for (const f of files.sort()) {
    try {
      arts.set(artifactKey(f), createHash("sha256").update(readFileSync(join(outDir, f))).digest("hex"));
    } catch (e: any) {
      return { arts, error: `unreadable artifact ${f}: ${e.code ?? e.message}` };
    }
  }
  return { arts };
}

/**
 * Every way one source can differ between two compilers. The union of the classes `diff` reports
 * per source — deliberately, so that "no difference here" means the same thing in both places.
 */
function sourceDifferences(
  b: SourceRecord,
  bArts: Map<string, string>,
  h: SourceRecord,
  hArts: Map<string, string>,
): string[] {
  const d: string[] = [];
  if (b.compile.ok !== h.compile.ok) d.push(`compile outcome: ${b.compile.ok ? "ok" : "FAILED"} -> ${h.compile.ok ? "ok" : "FAILED"}`);
  else if (b.compile.exitCode !== h.compile.exitCode) d.push(`exit code: ${b.compile.exitCode} -> ${h.compile.exitCode}`);
  const bc = b.compile.diagnosticCodes.join(",");
  const hc = h.compile.diagnosticCodes.join(",");
  if (bc !== hc) d.push(`diagnostic codes: ${bc || "(none)"} -> ${hc || "(none)"}`);
  if (b.compile.stdout !== h.compile.stdout || b.compile.stderr !== h.compile.stderr) d.push(`diagnostic text (same codes)`);
  for (const k of bArts.keys()) if (!hArts.has(k)) d.push(`artifact REMOVED: ${k}`);
  for (const k of hArts.keys()) if (!bArts.has(k)) d.push(`artifact ADDED: ${k}`);
  for (const [k, sha] of bArts) {
    const o = hArts.get(k);
    if (o && o !== sha) d.push(`artifact CONTENT: ${k}`);
  }
  return d;
}

async function reverifyDelta(
  base: Manifest,
  head: Manifest,
  implicated: Array<{ path: string; classes: string[] }>,
  limit: number,
  enabled: boolean,
): Promise<ReverifyReport> {
  const empty = (ran: boolean, reason: string): ReverifyReport => ({ ran, reason, implicated, reproduced: [], flaked: [], errored: [] });

  if (!enabled) return empty(false, `DECLINED — --no-reverify was passed. Every difference below is reported exactly as measured, unverified.`);
  if (implicated.length === 0) {
    return empty(false, `NOT NEEDED — no per-source difference was reported, so there is nothing a phantom could be hiding in.`);
  }
  for (const [side, m] of [["base", base], ["head", head]] as const) {
    const cli = join(m.compilerRoot, "compiler/src/cli.js");
    if (!existsSync(cli)) {
      return empty(
        false,
        `IMPOSSIBLE HERE — the ${side} manifest's compiler root is not on this machine (${cli} does not exist).\n` +
          `      Re-verification re-COMPILES, so it only runs where both captures were taken. The ${implicated.length}\n` +
          `      difference-bearing source(s) below are reported UNVERIFIED.`,
      );
    }
  }
  if (limit > 0 && implicated.length > limit) {
    return empty(
      false,
      `DECLINED — ${implicated.length} difference-bearing sources exceeds the serial re-verification limit of ${limit}.\n` +
        `      It declines ALL-OR-NOTHING on purpose: a partial re-verification that reads like a complete one\n` +
        `      is the truncated-probe shape this whole file exists to kill. A delta this wide is a real change\n` +
        `      by construction. Pass --reverify-limit 0 to remove the cap, or a larger number to raise it.`,
    );
  }

  const dir = mkdtempSync(join(tmpdir(), "corpus-reverify-"));
  const baseWork = join(dir, "base");
  const headWork = join(dir, "head");
  const report: ReverifyReport = {
    ran: true,
    reason: `RAN — ${implicated.length} difference-bearing source(s), re-compiled SERIALLY (concurrency 1) on both compilers.`,
    implicated,
    reproduced: [],
    flaked: [],
    errored: [],
  };
  try {
    for (const item of implicated) {
      try {
        // Serial by construction: base, then head, then the next source. Never a `pool`.
        const bRec = await compileOne(item.path, base.compilerRoot, baseWork);
        const bArts = hashOutputDir(join(baseWork, sourceSlug(item.path)));
        const hRec = await compileOne(item.path, head.compilerRoot, headWork);
        const hArts = hashOutputDir(join(headWork, sourceSlug(item.path)));
        if (bArts.error || hArts.error) {
          report.errored.push({ path: item.path, message: `${bArts.error ?? ""} ${hArts.error ?? ""}`.trim() });
          continue;
        }
        const diffs = sourceDifferences(bRec, bArts.arts, hRec, hArts.arts);
        if (diffs.length === 0) report.flaked.push({ path: item.path, classes: item.classes });
        else report.reproduced.push({ path: item.path, differences: diffs });
      } catch (e: any) {
        // An error is NOT a flake. The finding stands.
        report.errored.push({ path: item.path, message: String(e?.message ?? e) });
      } finally {
        // Reclaim as we go — a wide delta would otherwise hold a full second corpus on disk.
        rmSync(join(baseWork, sourceSlug(item.path)), { recursive: true, force: true });
        rmSync(join(headWork, sourceSlug(item.path)), { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------------------------

function loadManifest(p: string): Manifest {
  const m = JSON.parse(readFileSync(p, "utf8")) as Manifest;
  if (m.schemaVersion !== SCHEMA_VERSION) die(`${p}: schemaVersion ${m.schemaVersion}, expected ${SCHEMA_VERSION}`);
  return m;
}

function setDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return { onlyA: a.filter((x) => !sb.has(x)).sort(), onlyB: b.filter((x) => !sa.has(x)).sort() };
}

function h1(s: string): void {
  console.log(`\n${"=".repeat(92)}\n${s}\n${"=".repeat(92)}`);
}

async function diff(
  basePath: string,
  headPath: string,
  jsonOut: string | undefined,
  allowSameRevision: boolean,
  allowReuseManifest: boolean,
  reverifyEnabled: boolean,
  reverifyLimit: number,
): Promise<number> {
  const base = loadManifest(basePath);
  const head = loadManifest(headPath);

  h1(`EMIT DIFFERENTIAL   base=${base.label} (${base.revision.slice(0, 8)})   head=${head.label} (${head.revision.slice(0, 8)})`);

  let incomparable = false;
  if (base.roots.join(",") !== head.roots.join(",")) {
    console.error(`FINDING [INCOMPARABLE] root sets differ: base [${base.roots.join(", ")}] vs head [${head.roots.join(", ")}]`);
    incomparable = true;
  }
  for (const [side, m] of [["base", base], ["head", head]] as const) {
    if (!m.enumeration.crossCheck.agrees) {
      console.error(`FINDING [INCOMPARABLE] ${side} manifest's enumeration cross-check DISAGREED — that side's population is untrustworthy`);
      incomparable = true;
    }
  }

  // A diff of a revision against ITSELF is trivially clean and reads exactly like a real pass. The
  // revision was previously captured and printed but never compared, so pointing both
  // --compiler-root flags at the same checkout produced a green report.
  if (base.revision === head.revision && !allowSameRevision) {
    console.error(
      `FINDING [INCOMPARABLE] both sides are the SAME revision (${base.revision}). A revision compared\n` +
        `  against itself is clean by construction and proves nothing. Pass --allow-same-revision if\n` +
        `  this is a deliberate self-diff (e.g. proving the harness is deterministic).`,
    );
    incomparable = true;
  }
  if (base.revision === "<unknown>" || head.revision === "<unknown>") {
    console.error(`FINDING [INCOMPARABLE] a side's revision is "<unknown>" (git rev-parse failed at capture) — provenance cannot be established`);
    incomparable = true;
  }

  // HARD REQ 8 — the chunk-namespace ANCHOR. See the `NamespaceAnchor` docstring.
  //
  // This joins the same-revision and unknown-revision guards above because it answers the same
  // question they do: is this a valid comparison at all? It is NOT a difference-counter — a
  // divergent anchor does not make ONE finding, it makes every artifact-content finding on the run
  // meaningless, which is precisely what exit 2 exists to say.
  const bAnchor = base.namespaceAnchor;
  const hAnchor = head.namespaceAnchor;
  if (bAnchor.resolverAvailable && hAnchor.resolverAvailable) {
    if (bAnchor.prefixDigest !== hAnchor.prefixDigest) {
      console.error(
        `FINDING [INCOMPARABLE] the two sides resolved DIFFERENT chunk-namespace ANCHORS, so they hash\n` +
          `  DIFFERENT strings for the SAME source. Every namespace token differs, so every artifact\n` +
          `  differs, and EVERY artifact-content difference reported below is an artefact of WHERE THE\n` +
          `  TREES LIVE — not of the compiler.\n` +
          `    base: ${describeAnchor(bAnchor)}\n` +
          `    head: ${describeAnchor(hAnchor)}\n` +
          `  \`nsId\` hashes the source path RELATIVE TO THE PROJECT ROOT, which the compiler finds by\n` +
          `  walking up for \`scrml.toml\` then \`.git\` (compiler/src/codegen/chunk-namespace.ts). A tree\n` +
          `  extracted with \`git archive\` carries neither, so the compiler anchors on the ABSOLUTE path\n` +
          `  and every token embeds the extraction directory.\n` +
          `  REMEDY: give the side whose prefix is non-empty a project-root marker — \`mkdir <that\n` +
          `  checkout>/.git\` (or add \`scrml.toml\`) — and re-capture it. A measured pair went from 1014\n` +
          `  content differences to 0 of 7375 on exactly that one-line change.`,
      );
      incomparable = true;
    }
  } else {
    // Deliberately NOT a refusal. A side that predates chunk-namespacing has no tokens at all, so
    // its artifacts cannot be poisoned by tree location — and refusing would block the legitimate
    // before/after comparison of the arc that introduced them. But an UNVERIFIED anchor must never
    // read as a verified one, so it says so where the findings are.
    console.log(
      `NOTE: the chunk-namespace ANCHOR could not be compared — it is unmeasured on at least one side.\n` +
        `      base: ${describeAnchor(bAnchor)}\n` +
        `      head: ${describeAnchor(hAnchor)}\n` +
        `      Artifact-content differences below are NOT verified free of a namespace-anchor artefact.\n` +
        `      Expected when one side predates chunk-namespacing; a defect if both sides are modern.`,
    );
  }

  // The syntax verdict is only meaningful if both sides were measured under the same rules.
  if (base.checkContext.method !== head.checkContext.method || base.checkContext.nodeVersion !== head.checkContext.nodeVersion) {
    console.error(
      `FINDING [INCOMPARABLE] the two sides were syntax-checked under DIFFERENT contexts:\n` +
        `    base: ${base.checkContext.method}  node ${base.checkContext.nodeVersion}\n` +
        `    head: ${head.checkContext.method}  node ${head.checkContext.nodeVersion}\n` +
        `  A context difference can manufacture an entire failure-set delta in either direction.`,
    );
    incomparable = true;
  }

  // A reuse-captured manifest contains fabricated-looking compile outcomes (uniformly not-ok) and
  // must not be read as a compile measurement.
  for (const [side, m] of [["base", base], ["head", head]] as const) {
    if (m.reuseArtifacts) {
      if (allowReuseManifest) {
        console.log(`NOTE: ${side} manifest is --reuse-artifacts; its COMPILE outcomes are not measurements and are ignored below.`);
      } else {
        console.error(
          `FINDING [INCOMPARABLE] ${side} manifest was captured with --reuse-artifacts, so its compile\n` +
            `  outcomes were never measured. Pass --allow-reuse-manifest to compare artifacts/syntax only.`,
        );
        incomparable = true;
      }
    }
  }
  const compileComparable = !base.reuseArtifacts && !head.reuseArtifacts;

  // ---- enumeration --------------------------------------------------------------------------
  console.log(`\n-- ENUMERATION -----------------------------------------------------------------------------`);
  for (const root of base.roots) {
    const b = base.enumeration.perRoot[root] ?? 0;
    const hh = head.enumeration.perRoot[root] ?? 0;
    const mark = b === hh ? "" : "   <-- DIFFERS";
    console.log(`   ${root.padEnd(14)} base ${String(b).padStart(5)} of ${String(base.enumeration.total).padStart(5)}    head ${String(hh).padStart(5)} of ${String(head.enumeration.total).padStart(5)}${mark}`);
  }
  console.log(`   ${"TOTAL".padEnd(14)} base ${String(base.enumeration.total).padStart(5)} of ${String(base.enumeration.total).padStart(5)}    head ${String(head.enumeration.total).padStart(5)} of ${String(head.enumeration.total).padStart(5)}`);

  const basePaths = base.sources.map((s) => s.path);
  const headPaths = head.sources.map((s) => s.path);
  const srcDelta = setDiff(basePaths, headPaths);
  if (srcDelta.onlyA.length || srcDelta.onlyB.length) {
    console.log(`   source SET delta: ${srcDelta.onlyA.length} removed, ${srcDelta.onlyB.length} added (full lists, no cap):`);
    for (const s of srcDelta.onlyA) console.log(`     - REMOVED in head: ${s}`);
    for (const s of srcDelta.onlyB) console.log(`     + ADDED   in head: ${s}`);
  } else {
    console.log(`   source SET delta: none — the two sides enumerated the SAME ${base.enumeration.total} sources`);
  }
  // Printed on EVERY run, matching or not. A guard whose output only appears when it fires is a
  // guard a reader cannot tell from an absent one.
  console.log(
    `   chunk-namespace anchor:\n` +
      `     base ${describeAnchor(bAnchor)}\n` +
      `     head ${describeAnchor(hAnchor)}\n` +
      `     ${
        !bAnchor.resolverAvailable || !hAnchor.resolverAvailable
          ? "NOT COMPARED — unmeasured on at least one side (see the NOTE above)"
          : bAnchor.prefixDigest === hAnchor.prefixDigest
            ? "MATCH — both sides hash the same string for the same source, so no artifact difference below is a location artefact"
            : "MISMATCH — see the INCOMPARABLE finding above"
      }`,
  );

  const baseBy = new Map(base.sources.map((s) => [s.path, s]));
  const headBy = new Map(head.sources.map((s) => [s.path, s]));
  const common = basePaths.filter((p) => headBy.has(p)).sort();

  // ---- per-source difference COMPUTATION, before any of it is reported ------------------------
  //
  // Computation is separated from reporting so HARD REQ 9's serial re-verification can run BETWEEN
  // them. A phantom finding must never be PRINTED as a difference and then retracted three sections
  // later; a reader who scans the ARTIFACTS block and stops has to see the truth there.
  const baseFailSet = base.sources.filter((s) => !s.compile.ok).map((s) => s.path);
  const headFailSet = head.sources.filter((s) => !s.compile.ok).map((s) => s.path);
  const failDelta = setDiff(baseFailSet, headFailSet);
  let newlyPassing = failDelta.onlyA.filter((p) => headBy.has(p));
  let newlyFailing = failDelta.onlyB.filter((p) => baseBy.has(p));

  // Diagnostics can change while the pass/fail outcome holds. That is still a behaviour change.
  let diagChanged: Array<{ path: string; baseCodes: string; headCodes: string }> = [];
  let streamChanged: string[] = [];
  if (compileComparable) {
    for (const p of common) {
      const b = baseBy.get(p)!;
      const hh = headBy.get(p)!;
      const bc = b.compile.diagnosticCodes.join(",");
      const hc = hh.compile.diagnosticCodes.join(",");
      if (bc !== hc) diagChanged.push({ path: p, baseCodes: bc || "(none)", headCodes: hc || "(none)" });
      else if (b.compile.stdout !== hh.compile.stdout || b.compile.stderr !== hh.compile.stderr) streamChanged.push(p);
    }
  }

  let comparedArtifacts = 0;
  let identicalArtifacts = 0;
  // Kept as {source,key} rather than a pre-joined string: the SOURCE is the re-verification unit,
  // so it has to survive as a field rather than be re-parsed out of a display string.
  let artifactAdded: Array<{ source: string; key: string }> = [];
  let artifactRemoved: Array<{ source: string; key: string }> = [];
  let contentDiffs: Array<{ source: string; key: string; baseSha: string; headSha: string; baseBytes: number; headBytes: number }> = [];

  for (const p of common) {
    const b = baseBy.get(p)!;
    const hh = headBy.get(p)!;
    const bMap = new Map(b.artifacts.map((a) => [a.key, a]));
    const hMap = new Map(hh.artifacts.map((a) => [a.key, a]));
    for (const [k] of bMap) if (!hMap.has(k)) artifactRemoved.push({ source: p, key: k });
    for (const [k] of hMap) if (!bMap.has(k)) artifactAdded.push({ source: p, key: k });
    for (const [k, ba] of bMap) {
      const ha = hMap.get(k);
      if (!ha) continue;
      comparedArtifacts++;
      if (ba.sha256 === ha.sha256) identicalArtifacts++;
      else contentDiffs.push({ source: p, key: k, baseSha: ba.sha256, headSha: ha.sha256, baseBytes: ba.bytes, headBytes: ha.bytes });
    }
  }

  // ---- HARD REQ 9: serial re-verification of the DELTA ----------------------------------------
  //
  // The implicated set is every source carrying at least one PER-SOURCE difference. The source-SET
  // delta is deliberately absent: a source present on only one side cannot be compiled on both, so
  // there is nothing to re-verify. Syntax findings are absent as INPUTS for the same reason they
  // are filtered as OUTPUTS — they are derived from a source's artifacts, so the source that
  // emitted them is already implicated by the artifact difference itself.
  const implicatedMap = new Map<string, string[]>();
  const implicate = (p: string, cls: string) => {
    const g = implicatedMap.get(p);
    if (g) { if (!g.includes(cls)) g.push(cls); }
    else implicatedMap.set(p, [cls]);
  };
  for (const p of newlyFailing) implicate(p, "newly FAILING");
  for (const p of newlyPassing) implicate(p, "newly PASSING");
  for (const d of diagChanged) implicate(d.path, "diagnostic CODE change");
  for (const p of streamChanged) implicate(p, "diagnostic TEXT change");
  for (const a of artifactRemoved) implicate(a.source, "artifact REMOVED");
  for (const a of artifactAdded) implicate(a.source, "artifact ADDED");
  for (const d of contentDiffs) implicate(d.source, "artifact CONTENT difference");
  const implicated = [...implicatedMap.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([path, classes]) => ({ path, classes }));

  const reverify = await reverifyDelta(base, head, implicated, reverifyLimit, reverifyEnabled);
  const flakedSources = new Set(reverify.flaked.map((f) => f.path));
  if (flakedSources.size > 0) {
    newlyFailing = newlyFailing.filter((p) => !flakedSources.has(p));
    newlyPassing = newlyPassing.filter((p) => !flakedSources.has(p));
    diagChanged = diagChanged.filter((d) => !flakedSources.has(d.path));
    streamChanged = streamChanged.filter((p) => !flakedSources.has(p));
    artifactAdded = artifactAdded.filter((a) => !flakedSources.has(a.source));
    artifactRemoved = artifactRemoved.filter((a) => !flakedSources.has(a.source));
    contentDiffs = contentDiffs.filter((d) => !flakedSources.has(d.source));
  }

  // ---- compile outcome ----------------------------------------------------------------------
  console.log(`\n-- COMPILE OUTCOME -------------------------------------------------------------------------`);
  if (!compileComparable) console.log(`   NOT MEASURED — at least one side is a --reuse-artifacts manifest. Skipping compile comparison.`);
  console.log(
    `   base: ok ${base.totals.compileOk} of ${base.totals.compileAttempted} attempted, failed ${base.totals.compileFailed}\n` +
      `   head: ok ${head.totals.compileOk} of ${head.totals.compileAttempted} attempted, failed ${head.totals.compileFailed}`,
  );
  console.log(`   compile-failure SET delta: ${newlyFailing.length} newly FAILING, ${newlyPassing.length} newly PASSING (full lists, no cap):`);
  for (const p of newlyFailing) console.log(`     ! NEWLY FAILING in head: ${p}  (base exit ${baseBy.get(p)!.compile.exitCode} -> head exit ${headBy.get(p)!.compile.exitCode})`);
  for (const p of newlyPassing) console.log(`     ~ NEWLY PASSING in head: ${p}  (base exit ${baseBy.get(p)!.compile.exitCode} -> head exit ${headBy.get(p)!.compile.exitCode})`);
  if (!newlyFailing.length && !newlyPassing.length) console.log(`     (empty — the failure SET is identical on both sides)`);
  console.log(`   diagnostic-CODE changes (outcome unchanged): ${diagChanged.length} of ${common.length} common sources (full list, no cap):`);
  for (const d of diagChanged) console.log(`     * ${d.path}\n         base codes: ${d.baseCodes}\n         head codes: ${d.headCodes}`);
  if (!diagChanged.length) console.log(`     (empty)`);
  console.log(`   diagnostic-TEXT-only changes (same codes): ${streamChanged.length} of ${common.length} common sources (full list, no cap):`);
  for (const p of streamChanged) console.log(`     * ${p}`);
  if (!streamChanged.length) console.log(`     (empty)`);
  if (flakedSources.size > 0) console.log(`   (${flakedSources.size} source(s) excluded as HARNESS FLAKES — see the RE-VERIFICATION section)`);

  // ---- artifacts ----------------------------------------------------------------------------
  console.log(`\n-- ARTIFACTS -------------------------------------------------------------------------------`);
  console.log(`   base emitted ${base.totals.artifactsEmitted} artifacts from ${base.sources.filter((s) => s.artifacts.length).length} of ${base.totals.enumerated} sources`);
  console.log(`   head emitted ${head.totals.artifactsEmitted} artifacts from ${head.sources.filter((s) => s.artifacts.length).length} of ${head.totals.enumerated} sources`);
  console.log(`   artifacts COMPARED (present on both sides, keyed by source+name): ${comparedArtifacts}`);
  console.log(`     byte-identical : ${identicalArtifacts} of ${comparedArtifacts} compared`);
  console.log(`     DIFFERING      : ${contentDiffs.length} of ${comparedArtifacts} compared`);
  console.log(`   artifact SET delta: ${artifactRemoved.length} removed, ${artifactAdded.length} added (full lists, no cap):`);
  for (const a of artifactRemoved) console.log(`     - REMOVED in head: ${a.source} :: ${a.key}`);
  for (const a of artifactAdded) console.log(`     + ADDED   in head: ${a.source} :: ${a.key}`);
  if (!artifactRemoved.length && !artifactAdded.length) console.log(`     (empty)`);

  if (contentDiffs.length) {
    console.log(`\n   CONTENT DIFFERENCES, grouped by source (full list, no cap):`);
    const bySource = new Map<string, typeof contentDiffs>();
    for (const d of contentDiffs) {
      const g = bySource.get(d.source);
      if (g) g.push(d);
      else bySource.set(d.source, [d]);
    }
    for (const src of [...bySource.keys()].sort()) {
      console.log(`     ${src}`);
      for (const d of bySource.get(src)!) {
        console.log(`       ${d.key}   ${d.baseBytes} -> ${d.headBytes} bytes   ${d.baseSha.slice(0, 12)} -> ${d.headSha.slice(0, 12)}`);
      }
    }
  }

  if (comparedArtifacts === 0) {
    // The S282 lesson, promoted to a first-class outcome: a run that compared nothing must not read
    // as a pass.
    console.error(`\nFINDING [VACUOUS] compared ZERO artifacts — this run verified NOTHING.`);
    incomparable = true;
  }

  // ---- HARD REQ 9: re-verification report ------------------------------------------------------
  //
  // Printed on EVERY run, including the runs where it did nothing. A section that appears only when
  // it has something to say is a section a reader cannot distinguish from an absent one — which is
  // how a disarmed guard stays invisible.
  console.log(`\n-- RE-VERIFICATION OF THE DELTA (serial) ----------------------------------------------------`);
  console.log(`   ${reverify.reason}`);
  console.log(`   difference-bearing sources: ${reverify.implicated.length}   (the source SET delta is excluded — a one-sided source cannot be compiled on both)`);
  if (reverify.ran) {
    console.log(`   REPRODUCED : ${reverify.reproduced.length} of ${reverify.implicated.length} — real differences, reported above`);
    console.log(`   HARNESS FLAKES (did NOT reproduce; EXCLUDED from the findings total): ${reverify.flaked.length} (full list, no cap):`);
    for (const f of reverify.flaked) console.log(`     ~ FLAKE: ${f.path}\n         discarded finding(s): ${f.classes.join(", ")}`);
    if (!reverify.flaked.length) console.log(`     (empty — every reported difference reproduced under serial re-compilation)`);
    if (reverify.errored.length) {
      console.error(`   RE-COMPILATION ERRORED (NOT flakes — their findings STAND): ${reverify.errored.length} (full list, no cap):`);
      for (const e of reverify.errored) console.error(`     ! ${e.path}: ${e.message}`);
    }
  } else if (reverify.implicated.length > 0) {
    console.error(`   *** ${reverify.implicated.length} DIFFERENCE-BEARING SOURCE(S) WERE NOT RE-VERIFIED. ***`);
    console.error(`   The differences above are reported exactly as the two captures measured them. A harness`);
    console.error(`   phantom — a compile that failed for a reason that is not the compiler — would read`);
    console.error(`   identically. Re-run \`diff\` on a machine holding both compiler roots to check.`);
  }

  // ---- syntax, under explicit goggles ---------------------------------------------------------
  console.log(`\n-- SYNTAX (explicit goggles: classic script + module) ---------------------------------------`);
  console.log(`   checker: ${base.checkContext.method}   node ${base.checkContext.nodeVersion}`);
  console.log(
    `   base: ${base.totals.syntaxFailedEffective} FAILING (effective) of ${base.totals.syntaxChecked} checked of ${base.totals.artifactsCheckable} checkable of ${base.totals.artifactsEmitted} emitted` +
      `   [load context: ${base.totals.loadedAsScript} script / ${base.totals.loadedAsModule} module]`,
  );
  console.log(
    `   head: ${head.totals.syntaxFailedEffective} FAILING (effective) of ${head.totals.syntaxChecked} checked of ${head.totals.artifactsCheckable} checkable of ${head.totals.artifactsEmitted} emitted` +
      `   [load context: ${head.totals.loadedAsScript} script / ${head.totals.loadedAsModule} module]`,
  );

  // VACUITY FLOOR for the syntax half. The artifact half has had one since the S282 lesson; this
  // half did not, so `--no-syntax-check` on both sides left every checkable artifact unmeasured and
  // still exited 0 with a NO DIFFERENCES banner. That is defect #3 from this file's own header,
  // reproduced structurally.
  if (base.totals.syntaxChecked === 0 && base.totals.artifactsCheckable > 0) {
    console.error(`FINDING [VACUOUS] base checked 0 of ${base.totals.artifactsCheckable} checkable artifacts — the syntax half verified NOTHING on that side.`);
    incomparable = true;
  }
  if (head.totals.syntaxChecked === 0 && head.totals.artifactsCheckable > 0) {
    console.error(`FINDING [VACUOUS] head checked 0 of ${head.totals.artifactsCheckable} checkable artifacts — the syntax half verified NOTHING on that side.`);
    incomparable = true;
  }

  // Report the delta under EVERY goggle, plus the effective one. `effective` is the headline
  // because it is the goggle the artifact is actually loaded under; the per-goggle rows are kept so
  // that a change which flips an artifact's load context cannot hide inside the effective number.
  const goggleReports: Array<{ label: string; delta: ReturnType<typeof setDiff>; messageChanged: string[]; baseMap: Map<string, string>; headMap: Map<string, string> }> = [];
  for (const which of ["effective", "script", "module"] as const) {
    const baseMap = collectSyntaxFailures(base, which);
    const headMap = collectSyntaxFailures(head, which);
    // HARD REQ 9 — a syntax verdict is a property of an ARTIFACT, and a flaked source's artifacts
    // are the output of a compile that did not happen properly. Its syntax delta is discarded on
    // the same evidence as its artifact delta. The key is `<source path> :: <artifact key>`.
    const delta = setDiff([...baseMap.keys()], [...headMap.keys()]);
    delta.onlyA = delta.onlyA.filter((k) => !flakedSources.has(k.split(" :: ")[0]));
    delta.onlyB = delta.onlyB.filter((k) => !flakedSources.has(k.split(" :: ")[0]));
    const msgChanged: string[] = [];
    for (const [k, msg] of baseMap) {
      if (flakedSources.has(k.split(" :: ")[0])) continue;
      const hm = headMap.get(k);
      if (hm !== undefined && hm !== msg) msgChanged.push(k);
    }
    goggleReports.push({ label: which, delta, messageChanged: msgChanged, baseMap, headMap });

    const isHeadline = which === "effective";
    console.log(
      `\n   [${which.toUpperCase()}${isHeadline ? " — the goggle each artifact is actually loaded under" : " goggle applied to ALL artifacts"}]` +
        `  base ${baseMap.size} failing, head ${headMap.size} failing`,
    );
    console.log(`   failure SET delta: ${delta.onlyB.length} NEW in head, ${delta.onlyA.length} FIXED in head (full lists, no cap):`);
    for (const k of delta.onlyB) console.log(`     ! NEW failing in head : ${k}\n         ${headMap.get(k)!.split("\n").join("\n         ")}`);
    for (const k of delta.onlyA) console.log(`     ~ FIXED in head       : ${k}\n         ${baseMap.get(k)!.split("\n").join("\n         ")}`);
    if (!delta.onlyA.length && !delta.onlyB.length) console.log(`     (empty — the failure SET is identical on both sides)`);
    console.log(`   failures on BOTH sides with a CHANGED message: ${msgChanged.length} (full list, no cap):`);
    for (const k of msgChanged) console.log(`     * ${k}\n         base: ${baseMap.get(k)}\n         head: ${headMap.get(k)}`);
    if (!msgChanged.length) console.log(`     (empty)`);
  }

  // Load-context changes are their own finding: an artifact that moves from module to script
  // goggles has changed how it is loaded, which is a behaviour change even at identical bytes.
  const loadContextChanged: string[] = [];
  for (const p of common) {
    const bMap = new Map(baseBy.get(p)!.artifacts.map((a) => [a.key, a]));
    for (const ha of headBy.get(p)!.artifacts) {
      const ba = bMap.get(ha.key);
      if (ba && ba.loadedAs && ha.loadedAs && ba.loadedAs !== ha.loadedAs) {
        loadContextChanged.push(`${p} :: ${ha.key}  ${ba.loadedAs} -> ${ha.loadedAs}`);
      }
    }
  }
  console.log(`\n   artifacts whose LOAD CONTEXT changed: ${loadContextChanged.length} (full list, no cap):`);
  for (const l of loadContextChanged) console.log(`     * ${l}`);
  if (!loadContextChanged.length) console.log(`     (empty)`);

  // ---- client server-fn call sites (the auto-await trend metric) -------------------------------
  console.log(`\n-- CLIENT SERVER-FN CALL SITES (_scrml_fetch_*) ---------------------------------------------`);
  const bFx = serverFnCallSiteTotals(base.sources, true);
  const hFx = serverFnCallSiteTotals(head.sources, true);
  console.log(`   in CLEANLY-COMPILING sources only:`);
  console.log(`     base: ${bFx.total} total in ${bFx.sources} sources — ${bFx.awaited} awaited, ${bFx.bare} BARE`);
  console.log(`     head: ${hFx.total} total in ${hFx.sources} sources — ${hFx.awaited} awaited, ${hFx.bare} BARE`);
  const bareDelta = hFx.bare - bFx.bare;
  console.log(
    `     BARE delta: ${bareDelta > 0 ? "+" : ""}${bareDelta}` +
      (bareDelta === 0
        ? `  — an auto-await change that leaves this at 0 has NOT reached the instances of the bug already in the corpus`
        : `  — the change moved ${Math.abs(bareDelta)} call site(s)`),
  );
  const fxSourceDelta: string[] = [];
  for (const p of common) {
    const b = serverFnCallSiteTotals([baseBy.get(p)!], true);
    const hh = serverFnCallSiteTotals([headBy.get(p)!], true);
    if (b.bare !== hh.bare || b.awaited !== hh.awaited) {
      fxSourceDelta.push(`${p}  awaited ${b.awaited}->${hh.awaited}, bare ${b.bare}->${hh.bare}`);
    }
  }
  console.log(`   sources whose awaited/bare split CHANGED: ${fxSourceDelta.length} (full list, no cap):`);
  for (const f of fxSourceDelta) console.log(`     * ${f}`);
  if (!fxSourceDelta.length) console.log(`     (empty)`);

  const effective = goggleReports[0];
  const checkDelta = effective.delta;
  const messageChanged = effective.messageChanged;
  const baseChecks = effective.baseMap;
  const headChecks = effective.headMap;

  // ---- verdict --------------------------------------------------------------------------------
  const findings =
    srcDelta.onlyA.length + srcDelta.onlyB.length +
    newlyFailing.length + newlyPassing.length +
    diagChanged.length + streamChanged.length +
    artifactAdded.length + artifactRemoved.length +
    contentDiffs.length +
    checkDelta.onlyA.length + checkDelta.onlyB.length + messageChanged.length;

  // The banner NEVER says "NO DIFFERENCES" on a run that was not a valid comparison.
  //
  // Previously the VACUOUS/INCOMPARABLE dissent went to stderr while this banner went to stdout, so
  // a stdout-only log of a run that verified nothing read as a clean pass. The exit code was right
  // and the human-readable output was wrong; a human reads the banner.
  const verdictWord = incomparable
    ? `NOT A VALID COMPARISON — ${findings} difference(s) reported below are UNTRUSTWORTHY`
    : findings === 0
      ? "NO DIFFERENCES"
      : `${findings} DIFFERENCE(S)`;
  // HARD REQ 9 annotations. NOT a fourth verdict — the three outcomes are unchanged and so is the
  // exit code. These say what the number was arrived at THROUGH, because a run that had to discard
  // flakes is not a clean run, and a run whose delta went unchecked is not a verified one.
  const reverifyNote = reverify.flaked.length > 0
    ? `   [${reverify.flaked.length} HARNESS FLAKE(S) DISCARDED — the harness, not the compiler]`
    : reverify.ran
      ? reverify.errored.length > 0
        ? `   [delta re-verified serially; ${reverify.errored.length} source(s) could not be re-compiled and their findings STAND]`
        : `   [delta re-verified serially: all ${reverify.reproduced.length} reproduced]`
      : reverify.implicated.length > 0
        ? `   [DELTA NOT RE-VERIFIED — ${reverify.implicated.length} difference-bearing source(s) unchecked]`
        : ``;
  const banner =
    `VERDICT: ${verdictWord}` +
    `   over ${common.length} common sources of ${base.enumeration.total} base / ${head.enumeration.total} head enumerated` +
    `   and ${comparedArtifacts} compared artifacts` +
    reverifyNote;
  if (incomparable) {
    // Same stream as the findings that made it incomparable.
    console.error(`\n${"=".repeat(92)}\n${banner}\n${"=".repeat(92)}`);
    console.log(`\n${"=".repeat(92)}\n${banner}\n${"=".repeat(92)}`);
  } else {
    h1(banner);
  }
  console.log(
    `  sources enumerated        base ${base.enumeration.total}   head ${head.enumeration.total}\n` +
      `  chunk-namespace anchor    ${
        !bAnchor.resolverAvailable || !hAnchor.resolverAvailable
          ? "NOT COMPARED (unmeasured on at least one side)"
          : bAnchor.prefixDigest === hAnchor.prefixDigest
            ? "MATCH"
            : "MISMATCH — the artifact-content rows below are MEANINGLESS"
      }\n` +
      `  delta re-verification     ${
        reverify.ran
          ? `RAN over ${reverify.implicated.length} source(s) — ${reverify.reproduced.length} reproduced, ${reverify.flaked.length} FLAKE(S) discarded, ${reverify.errored.length} errored`
          : reverify.implicated.length > 0
            ? `DID NOT RUN — ${reverify.implicated.length} difference-bearing source(s) UNVERIFIED`
            : `not needed — no per-source difference`
      }\n` +
      `  source set delta          ${srcDelta.onlyA.length + srcDelta.onlyB.length}\n` +
      `  compile-failure delta     ${compileComparable ? `${newlyFailing.length} newly failing / ${newlyPassing.length} newly passing` : "NOT MEASURED (reuse-artifacts manifest)"}\n` +
      `  diagnostic changes        ${compileComparable ? `${diagChanged.length} code / ${streamChanged.length} text-only` : "NOT MEASURED (reuse-artifacts manifest)"}\n` +
      `  artifact set delta        ${artifactAdded.length} added / ${artifactRemoved.length} removed\n` +
      `  artifact content diffs    ${contentDiffs.length} of ${comparedArtifacts} compared\n` +
      `  syntax delta (effective)  ${checkDelta.onlyB.length} new / ${checkDelta.onlyA.length} fixed / ${messageChanged.length} message-changed\n` +
      `  syntax delta (script)     ${goggleReports[1].delta.onlyB.length} new / ${goggleReports[1].delta.onlyA.length} fixed\n` +
      `  syntax delta (module)     ${goggleReports[2].delta.onlyB.length} new / ${goggleReports[2].delta.onlyA.length} fixed\n` +
      `  load-context changes      ${loadContextChanged.length}\n` +
      `  bare server-fn sites      base ${bFx.bare} / head ${hFx.bare}  (delta ${bareDelta > 0 ? "+" : ""}${bareDelta}, in ${fxSourceDelta.length} source(s))`,
  );

  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          base: { label: base.label, revision: base.revision, totals: base.totals, enumeration: base.enumeration, namespaceAnchor: bAnchor },
          head: { label: head.label, revision: head.revision, totals: head.totals, enumeration: head.enumeration, namespaceAnchor: hAnchor },
          namespaceAnchorComparable: bAnchor.resolverAvailable && hAnchor.resolverAvailable,
          namespaceAnchorMatches: bAnchor.resolverAvailable && hAnchor.resolverAvailable && bAnchor.prefixDigest === hAnchor.prefixDigest,
          sourceSetDelta: srcDelta,
          compileFailureDelta: { newlyFailing, newlyPassing },
          diagnosticCodeChanges: diagChanged,
          diagnosticTextOnlyChanges: streamChanged,
          artifactSetDelta: {
            added: artifactAdded.map((a) => `${a.source} :: ${a.key}`),
            removed: artifactRemoved.map((a) => `${a.source} :: ${a.key}`),
          },
          artifactContentDiffs: contentDiffs,
          reverification: reverify,
          loadContextChanged,
          serverFnCallSites: { base: bFx, head: hFx, bareDelta, changedSources: fxSourceDelta },
          syntaxDelta: Object.fromEntries(
            goggleReports.map((r) => [
              r.label,
              {
                newInHead: r.delta.onlyB.map((k) => ({ key: k, message: r.headMap.get(k) })),
                fixedInHead: r.delta.onlyA.map((k) => ({ key: k, message: r.baseMap.get(k) })),
                messageChanged: r.messageChanged.map((k) => ({ key: k, base: r.baseMap.get(k), head: r.headMap.get(k) })),
                baseFailures: [...r.baseMap.entries()].map(([key, message]) => ({ key, message })),
                headFailures: [...r.headMap.entries()].map(([key, message]) => ({ key, message })),
              },
            ]),
          ),
          incomparable,
          compileComparable,
          findings,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\n  machine-readable diff -> ${jsonOut}`);
  }

  if (incomparable) return 2;
  return findings === 0 ? 0 : 1;
}

/**
 * `source :: artifactKey` -> normalized failure message, for every FAILING artifact. Sorted.
 *
 * `which` selects the goggle: `"effective"` uses each artifact's own derived load context (the
 * headline), `"script"` / `"module"` apply one goggle uniformly so neither answer can hide.
 */
function collectSyntaxFailures(m: Manifest, which: "effective" | Goggle): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of m.sources) {
    for (const a of s.artifacts) {
      if (!a.syntax) continue;
      const goggle: Goggle = which === "effective" ? (a.loadedAs ?? "module") : which;
      const r = a.syntax[goggle];
      if (r && !r.ok) out.set(`${s.path} :: ${a.key}`, r.message);
    }
  }
  return new Map([...out.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

const { mode, flags, bools } = parseArgs(process.argv.slice(2));

if (mode === "capture") {
  const compilerRoot = resolve(req(flags, "compiler-root"));
  const code = await capture({
    compilerRoot,
    label: req(flags, "label"),
    work: resolve(req(flags, "work")),
    manifestPath: resolve(req(flags, "manifest")),
    roots: (flags["roots"] ?? DEFAULT_ROOTS.join(",")).split(",").map((r) => r.trim()).filter(Boolean),
    concurrency: Number(flags["concurrency"] ?? 10),
    expectTotal: flags["expect-total"] !== undefined ? Number(flags["expect-total"]) : undefined,
    reuseArtifacts: bools.has("reuse-artifacts"),
    syntaxCheck: !bools.has("no-syntax-check"),
  });
  process.exit(code);
} else {
  // parseArgs already rejected any mode other than capture/diff.
  process.exit(
    await diff(
      resolve(req(flags, "base")),
      resolve(req(flags, "head")),
      flags["json"] ? resolve(flags["json"]) : undefined,
      bools.has("allow-same-revision"),
      bools.has("allow-reuse-manifest"),
      !bools.has("no-reverify"),
      flags["reverify-limit"] !== undefined ? Number(flags["reverify-limit"]) : DEFAULT_REVERIFY_LIMIT,
    ),
  );
}
