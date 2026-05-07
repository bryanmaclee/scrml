/**
 * @module commands/promote
 * scrml promote subcommand — promotion-ergonomics CLI surface.
 *
 * **Status (S66):**
 *   - `--match` SHIPPED: span-based AST→AST rewrite that lifts an if-else
 *     chain over an enum-typed state cell into a `<match>` block. Pairs
 *     with `I-MATCH-PROMOTABLE` info-level lint (SPEC §56).
 *   - `--engine` deferred to Tier C (a follow-up dispatch). The flag is
 *     registered; running it prints "implementation pending — deferred to
 *     Tier C dispatch" and exits with code 2.
 *
 * Predicate matrix (S66 — full restoration after narrowing reversal):
 * `--match` rewrites both `if (@cell is .Variant)` and `if (@cell == .Variant)`
 * predicate shapes. Both produce structurally identical rewrites — they're
 * variant-tag checks. The S66 preprocessor fix (expression-parser.ts) makes
 * `.Variant` parseable as a primary expression, which unblocks `==` recognition.
 * Method-call form `@cell.is(.X)` and bind-on-is `is .X msg` remain out of
 * scope (separate language gaps; not promotion-ergonomics scope).
 *
 * Usage (locked surface):
 *   scrml promote --match <file>[:line]    # if-else → <match>
 *   scrml promote --engine <file>[:line]   # <match> → <engine>  (Tier C)
 *   scrml promote --dry-run --match <file> # preview unified diff
 *   scrml promote --match <dir>            # recurse all .scrml files
 *
 * @see SPEC §56
 * @see compiler/src/lint-i-match-promotable.js — pairing lint
 * @see compiler/src/commands/migrate.js — sibling command (different verb)
 */

import {
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  existsSync,
  mkdtempSync,
} from "fs";
import { resolve, join, relative, sep } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../api.js";
import { findPromotableChains } from "../lint-i-match-promotable.js";

const isTTY = process.stderr.isTTY && process.stdout.isTTY;

const c = {
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

function printHelp() {
  console.log(`scrml promote --match|--engine <file|directory> [options]

Mechanically promote scrml code up the tier ladder (primer §1).

Modes:
  --match               Lift an if-else chain over an enum-typed state cell
                        into a \`<match>\` block (Tier 1 promotion). SHIPPED S66.
  --engine              Lift a \`<match>\` block with rule= attributes accruing
                        on its arms into an active \`<engine>\` (Tier 1→2).
                        DEFERRED to Tier C — currently prints "pending".

Arguments:
  <file>                A single .scrml file (optional :line suffix to target
                        a specific promotable site).
  <directory>           A directory — every .scrml file under it is scanned.

Options:
  --dry-run             Print unified diff to stdout; do not write to disk.
  --check               Exit non-zero if any file would be promoted (CI-friendly).
  --include=<glob>      File pattern (default '*.scrml').
  --exclude=<glob>      Exclude pattern (substring match).
  --no-default-excludes Disable built-in samples/ + tests/ exclusions.
  --help, -h            Show this message.

Exit codes:
  0   Promoted N sites cleanly, OR no promotable sites found (informational).
  1   File not parseable, OR I/O failure during write.
  2   Ambiguous site needing human disambiguation, OR --engine (Tier C deferred).

Pairs with:
  - I-MATCH-PROMOTABLE info-level lint — surfaces opportunity at compile time.
  - bun scrml migrate — different verb (deprecated→current); promote is tier-up.

Examples:
  scrml promote --match src/app.scrml             # promote one file in place
  scrml promote --match src/app.scrml:42          # only the chain at line 42
  scrml promote --match src/ --dry-run            # preview all sites
`);
}

/**
 * Parse argv flags. Same shape and conventions as `migrate`'s arg parser.
 *
 * @param {string[]} args
 */
function parseArgs(args) {
  const paths = [];
  let mode = null;
  let dryRun = false;
  let check = false;
  let include = "*.scrml";
  const excludes = [];
  let useDefaultExcludes = true;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--match") {
      if (mode !== null && mode !== "match") {
        console.error(c.red("error:") + ` Cannot combine --match and --engine; choose one mode per invocation.`);
        process.exit(1);
      }
      mode = "match";
    } else if (arg === "--engine") {
      if (mode !== null && mode !== "engine") {
        console.error(c.red("error:") + ` Cannot combine --match and --engine; choose one mode per invocation.`);
        process.exit(1);
      }
      mode = "engine";
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--check") {
      check = true;
    } else if (arg.startsWith("--include=")) {
      include = arg.slice("--include=".length);
    } else if (arg === "--include") {
      include = args[++i];
    } else if (arg.startsWith("--exclude=")) {
      excludes.push(arg.slice("--exclude=".length));
    } else if (arg === "--exclude") {
      excludes.push(args[++i]);
    } else if (arg === "--no-default-excludes") {
      useDefaultExcludes = false;
    } else if (arg.startsWith("-")) {
      console.error(c.red("error:") + ` Unknown option: ${arg}`);
      console.error(c.dim("Run `scrml promote --help` for usage."));
      process.exit(1);
    } else {
      paths.push(arg);
    }
  }

  if (useDefaultExcludes) {
    excludes.push(`${sep}samples${sep}`);
    excludes.push(`${sep}tests${sep}`);
  }

  return { paths, mode, dryRun, check, include, excludes, help };
}

// ---------------------------------------------------------------------------
// File discovery (mirror migrate.js)
// ---------------------------------------------------------------------------

function collectFiles(root, include, excludes) {
  const suffix = include.startsWith("*") ? include.slice(1) : include;
  const out = [];

  function isExcluded(absPath) {
    for (const pat of excludes) {
      if (absPath.includes(pat)) return true;
    }
    return false;
  }

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (isExcluded(full + sep)) continue;
        walk(full);
      } else if (st.isFile()) {
        if (isExcluded(full)) continue;
        if (full.endsWith(suffix)) out.push(full);
      }
    }
  }

  let st;
  try { st = statSync(root); } catch { return []; }
  if (st.isFile()) {
    if (!isExcluded(root) && root.endsWith(suffix)) out.push(root);
  } else if (st.isDirectory()) {
    walk(root);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Path-with-line parsing (`<file>:<line>` syntax)
// ---------------------------------------------------------------------------

function splitPathAndLine(arg) {
  // Match `path:line` only when the trailing token is purely numeric. Also
  // tolerate Windows drive letters (C:/foo) by requiring the colon-numeric
  // token to be at the end.
  const m = /^(.+):(\d+)$/.exec(arg);
  if (m) return { path: m[1], line: parseInt(m[2], 10) };
  return { path: arg, line: null };
}

// ---------------------------------------------------------------------------
// Span-based rewrite — the core transformation
// ---------------------------------------------------------------------------

/**
 * Compute the rewritten source for one file. Returns { rewritten, count,
 * skipped } where skipped is an array of {line, reason} for sites that
 * could not be cleanly rewritten.
 *
 * Strategy:
 *   1. Find all promotable chains in the typed-AST via findPromotableChains.
 *   2. Sort them by start byte DESCENDING — process from end of file to start
 *      so byte offsets in the source remain valid through all rewrites.
 *   3. For each chain, locate its byte span (chainHead.span.start ..
 *      lastBranch.ifNode.span.end), extract the body source for each branch,
 *      construct the `<match>` block string, splice into source.
 *
 * The resulting source preserves all content outside each rewritten span
 * verbatim. Inside the rewritten span, only the chain shape changes — body
 * content is sliced from the original source and embedded in arms.
 *
 * @param {string} sourceText
 * @param {Array} promotableChains — output of findPromotableChains
 * @param {number|null} targetLine — restrict to chain at this line (1-based), or null for all
 * @returns {{ rewritten: string, count: number, skipped: Array<{line:number,reason:string}> }}
 */
function applyMatchRewrite(sourceText, promotableChains, targetLine) {
  let rewritten = sourceText;
  let count = 0;
  const skipped = [];

  // Filter by targetLine if specified. The chain "head line" is the line of
  // the first if-stmt's span. Allow ±1 lenience to accommodate parser line-
  // assignment quirks.
  let chains = promotableChains;
  if (targetLine != null) {
    chains = chains.filter(ch => {
      const ln = ch.chainHead.span?.line ?? 0;
      return ln === targetLine;
    });
    if (chains.length === 0) {
      skipped.push({
        line: targetLine,
        reason: "no promotable site at this line (lint may have flagged near-miss/compound; those need manual fixes)",
      });
      return { rewritten, count, skipped };
    }
  }

  // Sort by start DESCENDING so later-in-file rewrites don't shift earlier
  // byte offsets.
  const sortedChains = chains.slice().sort((a, b) => {
    const aStart = a.chainHead.span?.start ?? 0;
    const bStart = b.chainHead.span?.start ?? 0;
    return bStart - aStart;
  });

  for (const ch of sortedChains) {
    const result = rewriteOneChain(rewritten, ch);
    if (result.ok) {
      rewritten = result.rewritten;
      count++;
    } else {
      skipped.push({ line: ch.chainHead.span?.line ?? 0, reason: result.reason });
    }
  }

  return { rewritten, count, skipped };
}

/**
 * Rewrite a single chain in-place in source text. Returns { ok, rewritten?, reason? }.
 *
 * The chain's outer span runs from chainHead.span.start to the LAST branch's
 * `ifNode.span.end`. We slice each branch body from `consequent[0].span.start`
 * to `consequent[last].span.end` — preserving body source verbatim. The
 * indentation of the chain head line is detected and reused for arms.
 */
function rewriteOneChain(source, ch) {
  const head = ch.chainHead;
  const lastBranch = ch.branches[ch.branches.length - 1];
  const headStart = head.span?.start;
  const lastEnd = lastBranch.ifNode?.span?.end;

  if (typeof headStart !== "number" || typeof lastEnd !== "number" ||
      headStart >= lastEnd || headStart < 0 || lastEnd > source.length) {
    return { ok: false, reason: "chain spans not available — cannot rewrite safely" };
  }

  // Indentation: take the leading whitespace of the chain head's line.
  const lineStart = source.lastIndexOf("\n", headStart - 1) + 1;
  const headIndent = source.slice(lineStart, headStart).replace(/[^\s]/g, "");

  // Body indent: nest one level deeper than the chain head.
  // Detect tab vs space style.
  const useTab = headIndent.includes("\t");
  const oneStep = useTab ? "\t" : (detectIndentStep(source, headIndent) || "    ");
  const armIndent = headIndent + oneStep;
  const innerIndent = armIndent + oneStep;

  // Build arm source for each branch.
  const armChunks = [];
  for (let i = 0; i < ch.branches.length; i++) {
    const b = ch.branches[i];
    const variantTag = ch.variantTagsInOrder[i];
    const bodySrc = extractBranchBody(source, b);
    if (bodySrc == null) {
      return { ok: false, reason: `branch ${i + 1} body span not extractable` };
    }
    const bodyTrimmed = bodySrc.trim();
    // Re-indent body to the inner level
    const reIndented = reindent(bodyTrimmed, innerIndent);
    armChunks.push(`${armIndent}<${variantTag}>\n${reIndented}\n${armIndent}</>`);
  }

  const matchBlock =
    `<match for=${ch.enumName} on=@${stripAtPrefix(ch.cellName)}>\n` +
    armChunks.join("\n") + "\n" +
    `${headIndent}</>`;

  const rewritten = source.slice(0, headStart) + matchBlock + source.slice(lastEnd);
  return { ok: true, rewritten };
}

/**
 * Extract the source text of a branch's consequent body. Returns the raw
 * source between the consequent's opening `{` and the matching closing `}`,
 * exclusive of the braces themselves.
 *
 * Strategy: locate the consequent[0].span.start as the FIRST statement; walk
 * back to find the `{` immediately preceding it. Then locate consequent[last]
 * .span.end and walk forward to the matching `}`. Slice between them.
 *
 * If consequent is empty (rare), look for `{ }` after the if-condition close.
 */
function extractBranchBody(source, branch) {
  const cons = branch.consequent ?? [];
  if (cons.length === 0) {
    // Empty body — caller should treat as empty arm
    return "";
  }
  const firstStart = cons[0]?.span?.start;
  const lastEnd = cons[cons.length - 1]?.span?.end;
  if (typeof firstStart !== "number" || typeof lastEnd !== "number") {
    return null;
  }
  // Find the opening `{` preceding firstStart
  let openBrace = source.lastIndexOf("{", firstStart);
  if (openBrace < 0) return null;
  // Find the closing `}` at or after lastEnd. Use a brace-balanced scan to
  // be robust against nested blocks inside the body.
  let depth = 1;
  let i = openBrace + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      // Skip string literals
      i = skipStringLiteral(source, i);
      continue;
    } else if (ch === "/" && source[i + 1] === "/") {
      // Line comment
      const nl = source.indexOf("\n", i);
      i = nl < 0 ? source.length : nl;
      continue;
    } else if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close < 0 ? source.length : close + 2;
      continue;
    }
    i++;
  }
  if (depth !== 0) return null;
  // Slice between openBrace+1 and i (the closing `}`)
  return source.slice(openBrace + 1, i);
}

function skipStringLiteral(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function detectIndentStep(source, headIndent) {
  // Try to detect 2- vs 4-space indent by scanning a few lines after.
  const lines = source.split("\n").slice(0, 200);
  for (const ln of lines) {
    const m = /^( +)\S/.exec(ln);
    if (m && m[1].length > 0 && m[1].length <= 8) {
      return m[1].length === 2 ? "  " : (m[1].length === 4 ? "    " : "  ");
    }
  }
  return "  ";
}

function reindent(body, targetIndent) {
  // Split body into lines, find min existing indent of non-empty lines,
  // strip it, then prepend targetIndent.
  const lines = body.split("\n");
  let minIndent = Infinity;
  for (const ln of lines) {
    if (ln.trim().length === 0) continue;
    const m = /^[ \t]*/.exec(ln);
    if (m) minIndent = Math.min(minIndent, m[0].length);
  }
  if (!isFinite(minIndent)) minIndent = 0;
  return lines
    .map(ln => ln.length === 0 ? ln : (targetIndent + ln.slice(minIndent)))
    .join("\n");
}

function stripAtPrefix(name) {
  return typeof name === "string" && name.startsWith("@") ? name.slice(1) : name;
}

// ---------------------------------------------------------------------------
// Sanity-check parse (mirror migrate.js pattern)
// ---------------------------------------------------------------------------

function sanityCheckParse(rewrittenSource, originalPath) {
  const stagingDir = mkdtempSync(join(tmpdir(), "scrml-promote-check-"));
  const baseName = originalPath.split(sep).pop() || "staged.scrml";
  const stagedPath = join(stagingDir, baseName);
  writeFileSync(stagedPath, rewrittenSource, "utf8");
  let result;
  try {
    result = compileScrml({
      inputFiles: [stagedPath],
      write: false,
      gather: false,
      log: () => {},
    });
  } catch (err) {
    return { ok: false, errors: [{ message: `compiler crashed: ${err.message}` }] };
  }
  const blockingErrors = (result.errors || []).filter(
    (e) => !e.severity || e.severity === "error"
  );
  return { ok: blockingErrors.length === 0, errors: blockingErrors };
}

// ---------------------------------------------------------------------------
// Diff renderer (mirror migrate.js)
// ---------------------------------------------------------------------------

function simpleDiff(oldText, newText, relPath) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const out = [];
  out.push(c.bold(`--- ${relPath}`));
  out.push(c.bold(`+++ ${relPath}`));
  const max = Math.max(oldLines.length, newLines.length);
  let inHunk = false;
  for (let i = 0; i < max; i++) {
    const oldL = i < oldLines.length ? oldLines[i] : null;
    const newL = i < newLines.length ? newLines[i] : null;
    if (oldL === newL) {
      if (inHunk) { out.push(c.dim("...")); inHunk = false; }
      continue;
    }
    inHunk = true;
    if (oldL !== null) out.push(c.red(`- ${oldL}`));
    if (newL !== null) out.push(c.green(`+ ${newL}`));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Per-file --match processing
// ---------------------------------------------------------------------------

/**
 * Promote a single file. Returns a result object describing what happened.
 *
 * @param {string} filePath
 * @param {number|null} targetLine
 * @param {{ dryRun: boolean, check: boolean }} opts
 * @param {string} cwd
 */
function promoteMatchOnFile(filePath, targetLine, opts, cwd) {
  const relPath = relative(cwd, filePath);

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    return { status: "unreadable", reason: err.message, relPath };
  }

  // Compile to get the typed-AST.
  let compileResult;
  try {
    compileResult = compileScrml({
      inputFiles: [filePath],
      write: false,
      gather: false,
      log: () => {},
    });
  } catch (err) {
    return { status: "failed", reason: `compile crashed: ${err.message}`, relPath };
  }

  const blockingErrors = (compileResult.errors || []).filter(
    (e) => !e.severity || e.severity === "error"
  );
  if (blockingErrors.length > 0) {
    const msg = blockingErrors.slice(0, 2).map(e => e.message || e.code || String(e)).join("; ");
    return { status: "failed", reason: `source has compile errors: ${msg}`, relPath };
  }

  // Pull out the promotable chains via the lint sibling API.
  // compileResult.outputs / cgResult is opaque; we need the typed-AST. The
  // compileScrml API doesn't currently expose tsResult.files directly. Work
  // around: re-run compileScrml with a hook that captures it via lintDiagnostics
  // metadata — or recreate via api internals. Simpler: re-walk by reading the
  // .scrml ourselves with an internal helper.
  //
  // Approach: register a one-shot collector by passing a custom flag. The
  // cleanest path here is to leverage that I-MATCH-PROMOTABLE diagnostics
  // already carry the line; the rewriter then needs the typed-AST. To avoid
  // re-architecting api.js, we expose an internal helper here that re-runs
  // the same TS pass. For Tier B ship, we use compileResult.lintDiagnostics
  // to identify CANDIDATE LINES and parse the source ourselves.

  // Use a side-channel: compileScrml exposes the typed-AST through internal
  // hooks that we can invoke via dynamic import. For now, gate to using
  // lintDiagnostics line info plus a re-parse.
  const matchDiags = (compileResult.lintDiagnostics || []).filter(
    d => d.code === "I-MATCH-PROMOTABLE" && d.shape === "exhaustive"
  );

  if (matchDiags.length === 0) {
    return { status: "no-sites", relPath };
  }

  // For span access we need the full typed-AST. Bridge via a fresh
  // `_internalCompileForPromote` helper.
  const typedFiles = collectTypedFiles(filePath);
  if (!typedFiles || typedFiles.length === 0) {
    return { status: "failed", reason: "could not access typed-AST", relPath };
  }
  const fileAST = typedFiles.find(f => f.filePath === filePath) ?? typedFiles[0];

  const promotable = findPromotableChains(fileAST);
  if (promotable.length === 0) {
    return { status: "no-sites", relPath };
  }

  // Filter by targetLine if specified. Loose match to handle ±1 line drift.
  let chains = promotable;
  if (targetLine != null) {
    chains = promotable.filter(ch => Math.abs((ch.chainHead.span?.line ?? 0) - targetLine) <= 1);
    if (chains.length === 0) {
      return {
        status: "ambiguous",
        reason: `no exhaustive promotable site at line ${targetLine}; lint may have flagged a near-miss/compound (those need manual fixes first)`,
        relPath,
      };
    }
  }

  const { rewritten, count, skipped } = applyMatchRewrite(source, chains, null);
  if (count === 0) {
    return { status: "ambiguous", reason: "found promotable chains but none could be cleanly rewritten", relPath, skipped };
  }

  // Sanity-check the rewritten source.
  const parseResult = sanityCheckParse(rewritten, filePath);
  if (!parseResult.ok) {
    const messages = (parseResult.errors || []).slice(0, 2)
      .map(e => e.message || String(e)).join("; ");
    return {
      status: "failed",
      reason: `rewritten source failed to parse — file left untouched: ${messages}`,
      relPath,
    };
  }

  // Idempotency: if rewritten === source, treat as no-op.
  if (rewritten === source) {
    return { status: "no-sites", relPath };
  }

  if (opts.dryRun) {
    const diff = simpleDiff(source, rewritten, relPath);
    return { status: "promoted", count, skipped, diff, relPath };
  }
  if (opts.check) {
    return { status: "promoted", count, skipped, relPath };
  }
  try {
    writeFileSync(filePath, rewritten, "utf8");
  } catch (err) {
    return { status: "failed", reason: `write failed: ${err.message}`, relPath };
  }
  return { status: "promoted", count, skipped, relPath };
}

/**
 * Bridge to the typed-AST. Re-runs the relevant compiler passes inline.
 * Implementation: we lean on api.js internals via a dynamic import so we
 * don't have to re-export from there explicitly.
 */
function collectTypedFiles(filePath) {
  // Read source, run BS → … → TS by invoking compileScrml with a
  // side-channel that captures tsResult.files via a special opt. compileScrml
  // does not currently surface tsResult.files on its return; we add a small
  // capture here.
  //
  // Approach: monkey-patch via globalThis hook. compileScrml's internal
  // `runTS` invocation is not easily intercepted, so instead we rely on
  // compileScrml's `outputs` which contains per-file CG output but not the
  // typed-AST. We need a different bridge.
  //
  // For S66 ship: re-run BS through TS manually, mirroring api.js's setup
  // for these stages but skipping META/DG/CG (we only need TS output).
  return _collectTypedFilesViaApi(filePath);
}

function _collectTypedFilesViaApi(filePath) {
  // We'll set a globalThis flag that api.js inspects; if set, api.js stashes
  // tsResult.files on it. This is non-invasive and reversible.
  const captureKey = Symbol.for("__SCRML_PROMOTE_TS_CAPTURE__");
  globalThis[captureKey] = { files: null };
  try {
    compileScrml({
      inputFiles: [filePath],
      write: false,
      gather: false,
      log: () => {},
    });
    return globalThis[captureKey].files;
  } finally {
    delete globalThis[captureKey];
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runPromote(args) {
  const { paths, mode, dryRun, check, include, excludes, help } = parseArgs(args);

  if (help) {
    printHelp();
    return;
  }

  if (mode === null) {
    console.error(c.red("error:") + " scrml promote requires either --match or --engine.");
    console.error(c.dim("Run `scrml promote --help` for usage."));
    process.exit(1);
  }

  if (paths.length === 0) {
    console.error(c.red("error:") + ` scrml promote --${mode} requires at least one file or directory.`);
    console.error(c.dim("Run `scrml promote --help` for usage."));
    process.exit(1);
  }

  // --engine: Tier C deferred — preserve stub behaviour.
  if (mode === "engine") {
    const heading = c.yellow(c.bold("scrml promote --engine: implementation pending (Tier C)"));
    console.error("");
    console.error(`  ${heading}`);
    console.error("");
    console.error(`  The \`<match>\` → \`<engine>\` rewrite is deferred to a Tier C dispatch.`);
    console.error(`  It pairs with the \`W-MATCH-TRANSITIONS-ACCRUING\` lint, which has no §34`);
    console.error(`  catalog row, no §28 suppression config, and no source impl today. Tier C`);
    console.error(`  will land all four pieces together.`);
    console.error("");
    console.error(`  Targets:          ${paths.map(p => c.cyan(p)).join(", ")}`);
    console.error(`  Design lock:      ${c.dim("docs/changes/promotion-ergonomics/SCOPE.md")}`);
    console.error(`  See SPEC §56.6 for the Tier C work-item list.`);
    console.error("");
    process.exit(2);
  }

  // --match: real rewrite path.
  const cwd = process.cwd();

  // Expand path:line forms; collect files.
  const allFiles = [];
  const lineByFile = new Map();
  for (const p of paths) {
    const { path: rawPath, line } = splitPathAndLine(p);
    const abs = resolve(cwd, rawPath);
    if (!existsSync(abs)) {
      console.error(c.red("error:") + ` Path not found: ${rawPath}`);
      process.exit(1);
    }
    const files = collectFiles(abs, include, excludes);
    for (const f of files) {
      allFiles.push(f);
      if (line != null) lineByFile.set(f, line);
    }
  }

  const seen = new Set();
  const uniqueFiles = [];
  for (const f of allFiles) {
    if (seen.has(f)) continue;
    seen.add(f);
    uniqueFiles.push(f);
  }

  if (uniqueFiles.length === 0) {
    console.log(c.yellow("No files matched."));
    return;
  }

  let promotedCount = 0;
  let totalSites = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  const failures = [];
  const ambiguous = [];

  for (const file of uniqueFiles) {
    const targetLine = lineByFile.get(file) ?? null;
    const r = promoteMatchOnFile(file, targetLine, { dryRun, check }, cwd);
    if (r.status === "promoted") {
      promotedCount++;
      totalSites += r.count ?? 0;
      if (dryRun && r.diff) {
        console.log(r.diff);
        console.log("");
      } else {
        const verb = check ? "would promote" : "promoted";
        console.log(c.green(`  ${verb}`) + `  ${r.relPath}  (${r.count} site${r.count !== 1 ? "s" : ""})`);
      }
      if (r.skipped && r.skipped.length > 0) {
        for (const s of r.skipped) {
          console.log(c.dim(`    skipped @ line ${s.line}: ${s.reason}`));
        }
      }
    } else if (r.status === "no-sites") {
      unchangedCount++;
    } else if (r.status === "ambiguous") {
      ambiguous.push({ file: r.relPath, reason: r.reason });
      console.error(c.yellow("  ambiguous ") + `${r.relPath}: ${r.reason}`);
    } else {
      failedCount++;
      failures.push({ file: r.relPath, reason: r.reason });
      console.error(c.red("  failed   ") + `${r.relPath}: ${r.reason}`);
    }
  }

  console.log("");
  console.log(c.bold("Summary:"));
  console.log(`  ${uniqueFiles.length} file${uniqueFiles.length !== 1 ? "s" : ""} scanned`);
  if (promotedCount > 0) {
    const verb = dryRun ? "would change" : (check ? "would change" : "changed");
    console.log(`  ${c.green(promotedCount)} ${verb}, ${c.green(totalSites)} site${totalSites !== 1 ? "s" : ""} promoted`);
  }
  if (unchangedCount > 0) {
    console.log(`  ${c.dim(`${unchangedCount} unchanged (no promotable sites)`)}`);
  }
  if (ambiguous.length > 0) {
    console.log(`  ${c.yellow(ambiguous.length)} ambiguous (need human action)`);
  }
  if (failedCount > 0) {
    console.log(`  ${c.red(failedCount)} failed`);
  }

  // Exit codes per SPEC §56.5.5:
  //   0 — promoted N OR no sites found
  //   1 — file not parseable / I/O failure
  //   2 — ambiguous site needing human disambiguation
  if (failedCount > 0) process.exit(1);
  if (check && promotedCount > 0) process.exit(1);
  if (ambiguous.length > 0) process.exit(2);
}
