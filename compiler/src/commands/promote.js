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
} from "fs";
import { resolve, join, relative, sep } from "path";
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
  console.log(`scrml promote --match|--engine|--each <file|directory> [options]

Mechanically promote scrml code up the tier ladder (primer §1).

Modes:
  --match               Lift an if-else chain over an enum-typed state cell
                        into a \`<match>\` block (Tier 1 promotion). SHIPPED S66.
  --engine              Lift a \`<match>\` block with rule= attributes accruing
                        on its arms into an active \`<engine>\` (Tier 1→2).
                        DEFERRED to Tier C — currently prints "pending".
  --each                Lift a \`\${ for (let x of @cell) { lift <markup/> } }\`
                        Tier-0 iteration site into a \`<each in=@cell as x>\`
                        Tier-1 structural-element block. SHIPPED S134.

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
  --shorthand           (--each only) When the per-item template is a single-
                        expression markup element, apply §4.14 \`:\`-shorthand
                        on the per-item opener. Default: emit bare-body for
                        fidelity preservation.
  --help, -h            Show this message.

Exit codes:
  0   Promoted N sites cleanly, OR no promotable sites found (informational).
  1   File not parseable, OR I/O failure during write.
  2   Ambiguous site needing human disambiguation, OR --engine (Tier C deferred).

Pairs with:
  - I-MATCH-PROMOTABLE info-level lint — surfaces opportunity at compile time.
  - W-EACH-PROMOTABLE info-level lint — surfaces opportunity for --each.
  - bun scrml migrate — different verb (deprecated→current); promote is tier-up.

Examples:
  scrml promote --match src/app.scrml             # promote one file in place
  scrml promote --match src/app.scrml:42          # only the chain at line 42
  scrml promote --match src/ --dry-run            # preview all sites
  scrml promote --each src/app.scrml              # lift \${ for/lift } -> <each>
  scrml promote --each --shorthand src/           # lift + apply :-shorthand
  scrml promote --each --dry-run src/             # preview iteration lifts
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
  let shorthand = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--match") {
      if (mode !== null && mode !== "match") {
        console.error(c.red("error:") + ` Cannot combine --match, --engine, and --each; choose one mode per invocation.`);
        process.exit(1);
      }
      mode = "match";
    } else if (arg === "--engine") {
      if (mode !== null && mode !== "engine") {
        console.error(c.red("error:") + ` Cannot combine --match, --engine, and --each; choose one mode per invocation.`);
        process.exit(1);
      }
      mode = "engine";
    } else if (arg === "--each") {
      if (mode !== null && mode !== "each") {
        console.error(c.red("error:") + ` Cannot combine --match, --engine, and --each; choose one mode per invocation.`);
        process.exit(1);
      }
      mode = "each";
    } else if (arg === "--shorthand") {
      shorthand = true;
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

  return { paths, mode, dryRun, check, include, excludes, shorthand, help };
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
// Sanity-check parse — verify rewritten source still compiles
// ---------------------------------------------------------------------------

/**
 * Parse the rewritten source via the existing pipeline to verify it's still
 * valid scrml.
 *
 * Strategy — option β (transactional in-place rewrite + verify + restore):
 *
 *   The earlier implementation staged the rewritten source under a unique
 *   tmp directory and invoked `compileScrml` on that staged path. That broke
 *   for any file with cross-file imports — `module-resolver.js#resolveModulePath`
 *   resolves relative imports against `dirname(importerPath)`, so an importer
 *   staged under `/tmp/scrml-promote-check-XXX/` resolves `./foo.scrml` to
 *   `/tmp/scrml-promote-check-XXX/foo.scrml` which doesn't exist, MOD fires
 *   E-IMPORT-006, and the gate fails on every multi-file route file.
 *
 *   Option β writes the rewritten content to the file's ORIGINAL path,
 *   invokes `compileScrml` with `gather: true` so the existing auto-gather
 *   pre-pass walks the real import graph, and then ALWAYS restores the
 *   original content from an in-memory backup before returning. The caller
 *   (`promoteMatchOnFile`) decides separately whether to write the rewrite
 *   permanently — this function never leaves the file mutated.
 *
 *   Trade-off: there is a microseconds-wide window during the compile call
 *   where the on-disk content is the rewrite candidate. A SIGKILL or crash
 *   during that window leaves the file at the rewrite candidate's content.
 *   The try/finally always restores the backup on normal control flow,
 *   including compiler crashes. For dry-run mode this is essential — the
 *   user expects no on-disk change. For in-place mode, `promoteMatchOnFile`
 *   writes the rewrite immediately after this returns ok, so the brief
 *   window does not change net behavior.
 *
 *   Constraint: "Do not weaken the gate" (S86 standing rule) is preserved
 *   end-to-end — the compile invocation is identical to the pre-existing one
 *   except for `gather: true` (which is what `compileScrml` defaults to and
 *   what the real `compile` / `dev` / `build` paths use). Cross-file
 *   E-IMPORT-006 and downstream MOD/NR/SYM/TS/DG/CE/CG diagnostics still
 *   fire on real breakage.
 *
 *   Mirror of `compiler/src/commands/migrate.js#sanityCheckParse` (S86
 *   Wave 2 — commit 95bd7f9). Both commands share the same safety-harness
 *   shape because they share the same risk: rewriting a file's content
 *   without breaking its compile.
 *
 * @param {string} rewrittenSource
 * @param {string} originalPath — absolute path of the file under promotion.
 *                                 The rewritten source is written here for
 *                                 the duration of the compile call, then
 *                                 restored from the in-memory backup.
 * @returns {{ ok: boolean, errors: object[] }}
 */
export function sanityCheckParse(rewrittenSource, originalPath) {
  // Step 1: capture the on-disk original so we can always restore.
  //
  // If readFileSync throws here, the file isn't readable — there's nothing
  // sane we can stage or check. Report a synthetic error so the gate fails
  // closed; do NOT attempt the in-place rewrite (we'd be writing to a path
  // we couldn't read, which is recoverable but indicates an unusual state).
  let originalContent;
  try {
    originalContent = readFileSync(originalPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      errors: [{ message: `safety-harness: cannot read original file for backup: ${err.message}` }],
    };
  }

  // Step 2: stage the rewrite in place. Use try/finally so a crash during
  // either the write or the compile call still restores the original.
  let result;
  let stagingError = null;
  try {
    try {
      writeFileSync(originalPath, rewrittenSource, "utf8");
    } catch (err) {
      stagingError = err;
    }

    if (!stagingError) {
      try {
        result = compileScrml({
          inputFiles: [originalPath],
          write: false,
          // Enable auto-gather so the real import graph is walked from the
          // file's real on-disk position — see option-β rationale above.
          gather: true,
          log: () => {},
        });
      } catch (err) {
        return {
          ok: false,
          errors: [{ message: `compiler crashed: ${err.message}` }],
        };
      }
    }
  } finally {
    // Step 3: ALWAYS restore the original content. Even on a thrown error
    // from compileScrml (the outer return above does its own short-circuit,
    // but `finally` runs on the way out regardless). If the restore itself
    // fails, surface that — it indicates a serious environmental issue
    // (filesystem suddenly read-only, etc.) and the user needs to know.
    try {
      writeFileSync(originalPath, originalContent, "utf8");
    } catch (restoreErr) {
      // Restoration failed; data loss is possible. This is a rare edge.
      // Throw rather than silently leave a broken state — the promote
      // command should surface this as a hard failure.
      throw new Error(
        `safety-harness: failed to restore original content at ${originalPath} ` +
        `(file may be left in rewritten state): ${restoreErr.message}`,
      );
    }
  }

  if (stagingError) {
    return {
      ok: false,
      errors: [{ message: `safety-harness: staging write failed: ${stagingError.message}` }],
    };
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
export function promoteMatchOnFile(filePath, targetLine, opts, cwd) {
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

// ===========================================================================
// `--each` mode — Tier 0 → Tier 1 iteration lift (SPEC §56.10)
// ===========================================================================
//
// Lifts `${ for (let x of @cell) { lift <markup/> } }` → `<each in=@cell as x>
// <markup/></each>`. Pairs with the W-EACH-PROMOTABLE info-lint.
//
// Implementation strategy (mirrors --match):
//   1. Compile source, capture typed-AST.
//   2. Walk for-stmt nodes; filter by §56.10.2 promotable predicates.
//   3. For each promotable site, compute the source span (Tier-0 wrapper +
//      for-stmt header + body + optional else clause + closing wrapper).
//   4. Build the `<each>` replacement string from extracted parts.
//   5. Splice into source (descending offsets); sanity-parse; write or diff.
//
// Per §56.10.7, all source outside the rewritten span is preserved verbatim.
// Per §56.10.6, the rewrite is idempotent (re-running on `<each>` is a no-op
// because the detector only finds for-stmts, not <each> elements).

/**
 * Walk a typed FileAST and collect for-stmt nodes that are mechanically
 * promotable to <each>. Mirrors the lint-w-each-promotable walker but
 * returns the FULL nodes for span-based rewriting.
 *
 * @param {object} file
 * @returns {object[]}  for-stmt nodes
 */
function findIterationSites(file) {
  const sites = [];
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.kind === "for-stmt" || node.kind === "for-loop") {
      sites.push(node);
    }
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren", "consequent", "alternate", "components"]) {
      if (Array.isArray(node[k])) walk(node[k]);
    }
  }
  walk(file.ast?.nodes ?? file.nodes ?? file);
  if (file.ast?.components) walk(file.ast.components);
  if (file.components) walk(file.components);
  return sites;
}

/**
 * Parse the for-loop header text to extract iter-variable, iterable expr,
 * and optional `key=expr` clause. The AST flattens `key x.id` into the
 * iterable string (`"@items key x.id"`), so this re-extracts.
 *
 * @param {string} iterableRaw — for-stmt.iterable string
 * @param {string|null} variableRaw — for-stmt.variable string (may be null for C-style)
 * @returns {{
 *   iterVar: string,
 *   iterable: string,
 *   keyExpr: string | null,
 *   countMode: boolean,
 *   countExpr: string | null,
 *   iterInit: string | null,
 * }}
 */
function parseForHeader(iterableRaw, variableRaw) {
  // Detect C-style first: `( init ; cond ; update )` shape.
  // The AST stores C-style iterable as a parenthesized string.
  if (typeof iterableRaw === "string" && iterableRaw.trim().startsWith("(") && iterableRaw.includes(";")) {
    const m = iterableRaw.match(/^\(\s*let\s+(\w+)\s*=\s*(.+?)\s*;\s*(\w+)\s*<\s*(.+?)\s*;\s*\3\s*\+\s*\+\s*\)$/);
    if (m && m[1] === m[3]) {
      return {
        iterVar: m[1],
        iterable: null,
        keyExpr: null,
        countMode: true,
        countExpr: m[4].trim(),
        iterInit: m[2].trim(),
      };
    }
    // Other C-style shapes — not promotable to <each of=N>; signal failure.
    return null;
  }

  // For-of form: iterableRaw is the iter-expr text (post-`of`); variableRaw
  // is the iter-var. The iter-expr may include trailing `key <expr>`.
  if (variableRaw == null || typeof variableRaw !== "string") return null;
  let iterable = iterableRaw == null ? "" : String(iterableRaw).trim();
  let keyExpr = null;
  // Match trailing " key <expr>" — token-aware: `key` is a standalone word
  // followed by a key expression that runs to end-of-string.
  const keyMatch = iterable.match(/\bkey\s+(.+)$/);
  if (keyMatch) {
    // Anchor the key match to a token boundary that is NOT preceded by `.`
    // (rules out `obj.key`). Re-test with stricter regex.
    const strict = iterable.match(/^(.+?)(?:\s+|^)key\s+(\S.*)$/);
    if (strict) {
      iterable = strict[1].trim();
      keyExpr = strict[2].trim();
    }
  }
  // The iterable string may also be a tokenized form like "@contacts key c . id".
  // Re-collapse `.` whitespace.
  iterable = iterable.replace(/\s+\.\s+/g, ".").replace(/\s+/g, " ").trim();
  if (keyExpr) {
    keyExpr = keyExpr.replace(/\s+\.\s+/g, ".").replace(/\s+/g, " ").trim();
  }
  return {
    iterVar: variableRaw,
    iterable,
    keyExpr,
    countMode: false,
    countExpr: null,
    iterInit: null,
  };
}

/**
 * Find the byte offsets of the enclosing Tier-0 `${ ... }` wrapper for a
 * for-stmt site. The wrapper is the closest `${ ` before the for-stmt span
 * whose matching `}` lies AT-OR-AFTER the for-stmt span end (with optional
 * trailing else-block).
 *
 * @param {string} source
 * @param {object} forStmt
 * @returns {{ wrapStart: number, wrapEnd: number, wrapBodyStart: number, wrapBodyEnd: number } | null}
 *   wrapStart/wrapEnd: outer span (`${` ... `}`)
 *   wrapBodyStart/wrapBodyEnd: inside the braces
 *   Returns null if the for-stmt is not wrapped by a `${...}` (logic-context).
 */
function findTier0Wrapper(source, forStmt) {
  const forStart = forStmt.span?.start;
  const forEnd = forStmt.span?.end;
  if (typeof forStart !== "number" || typeof forEnd !== "number") return null;

  // Walk back from forStart looking for `${` while respecting `}` levels.
  let depth = 0;
  let i = forStart - 1;
  while (i >= 0) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        // Check for `${` two chars before
        if (i > 0 && source[i - 1] === "$") {
          // Found the wrapper opener
          const bodyStart = i + 1;
          // Locate the matching `}` from bodyStart, accounting for nested braces.
          let d = 1;
          let j = bodyStart;
          while (j < source.length && d > 0) {
            const c = source[j];
            if (c === "{") d++;
            else if (c === "}") {
              d--;
              if (d === 0) break;
            } else if (c === '"' || c === "'" || c === "`") {
              j = skipStringLiteral(source, j);
              continue;
            } else if (c === "/" && source[j + 1] === "/") {
              const nl = source.indexOf("\n", j);
              j = nl < 0 ? source.length : nl;
              continue;
            } else if (c === "/" && source[j + 1] === "*") {
              const close = source.indexOf("*/", j + 2);
              j = close < 0 ? source.length : close + 2;
              continue;
            }
            j++;
          }
          if (d !== 0) return null;
          // j is at the matching `}`.
          // Sanity: forStmt span must lie within wrap body.
          if (forStart >= bodyStart && forEnd <= j) {
            return {
              wrapStart: i - 1,
              wrapEnd: j + 1,
              wrapBodyStart: bodyStart,
              wrapBodyEnd: j,
            };
          }
          return null;
        }
        return null;
      }
      depth--;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      // Walk back past string literal — for backward scan, find matching quote
      let k = i - 1;
      while (k >= 0) {
        if (source[k] === ch) {
          // Check escape
          let escapes = 0;
          let m = k - 1;
          while (m >= 0 && source[m] === "\\") { escapes++; m--; }
          if (escapes % 2 === 0) break;
        }
        k--;
      }
      i = k;
      if (i < 0) break;
      i--;
      continue;
    }
    i--;
  }
  return null;
}

/**
 * Extract the loop body text between the for-stmt header's closing `)` and
 * the matching closing `}`. Returns { bodyText, openBraceOffset, closeBraceOffset }
 * where bodyText is the source between (but not including) `{` and `}`.
 *
 * Also probes for an `else { ... }` clause AFTER the closing brace.
 */
function extractForBodyAndElse(source, forStmt, wrapBodyEnd) {
  const forStart = forStmt.span?.start;
  const forEnd = forStmt.span?.end;
  if (typeof forStart !== "number" || typeof forEnd !== "number") return null;

  // Locate the for-loop's opening brace AFTER its `(...)` header.
  // Strategy: scan forward from forStart finding the first `{` at the
  // top brace level (after the `for(` paren-group).
  // The header `for ( ... )` has paren-balanced parens. We scan until
  // we see `{` outside parens.
  let i = forStart;
  // Skip past `for`
  if (source.slice(forStart, forStart + 3) !== "for") return null;
  i = forStart + 3;
  let depth = 0;
  let openBrace = -1;
  while (i < source.length) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "{" && depth === 0) {
      openBrace = i;
      break;
    } else if (c === '"' || c === "'" || c === "`") {
      i = skipStringLiteral(source, i);
      continue;
    }
    i++;
  }
  if (openBrace < 0) return null;

  // Locate matching close brace
  let d = 1;
  let j = openBrace + 1;
  while (j < source.length && d > 0) {
    const c = source[j];
    if (c === "{") d++;
    else if (c === "}") {
      d--;
      if (d === 0) break;
    } else if (c === '"' || c === "'" || c === "`") {
      j = skipStringLiteral(source, j);
      continue;
    } else if (c === "/" && source[j + 1] === "/") {
      const nl = source.indexOf("\n", j);
      j = nl < 0 ? source.length : nl;
      continue;
    } else if (c === "/" && source[j + 1] === "*") {
      const close = source.indexOf("*/", j + 2);
      j = close < 0 ? source.length : close + 2;
      continue;
    }
    j++;
  }
  if (d !== 0) return null;
  const closeBrace = j;

  // Probe for `else { ... }` clause after closeBrace, before the wrapper end.
  let elseBlock = null;
  let elseEnd = closeBrace + 1;
  let k = closeBrace + 1;
  // Skip whitespace and comments
  while (k < wrapBodyEnd) {
    const c = source[k];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { k++; continue; }
    if (c === "/" && source[k + 1] === "/") {
      const nl = source.indexOf("\n", k);
      k = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (c === "/" && source[k + 1] === "*") {
      const close = source.indexOf("*/", k + 2);
      k = close < 0 ? source.length : close + 2;
      continue;
    }
    break;
  }
  if (source.slice(k, k + 4) === "else" && /[\s{]/.test(source[k + 4] || "")) {
    let p = k + 4;
    // Skip whitespace
    while (p < wrapBodyEnd && /\s/.test(source[p])) p++;
    if (source[p] === "{") {
      // Match the closing brace
      let dd = 1;
      let q = p + 1;
      while (q < source.length && dd > 0) {
        const c = source[q];
        if (c === "{") dd++;
        else if (c === "}") {
          dd--;
          if (dd === 0) break;
        } else if (c === '"' || c === "'" || c === "`") {
          q = skipStringLiteral(source, q);
          continue;
        } else if (c === "/" && source[q + 1] === "/") {
          const nl = source.indexOf("\n", q);
          q = nl < 0 ? source.length : nl;
          continue;
        } else if (c === "/" && source[q + 1] === "*") {
          const close = source.indexOf("*/", q + 2);
          q = close < 0 ? source.length : close + 2;
          continue;
        }
        q++;
      }
      if (dd === 0) {
        elseBlock = {
          openBrace: p,
          closeBrace: q,
          body: source.slice(p + 1, q),
        };
        elseEnd = q + 1;
      }
    }
  }

  return {
    bodyOpenBrace: openBrace,
    bodyCloseBrace: closeBrace,
    bodyText: source.slice(openBrace + 1, closeBrace),
    elseBlock,
    siteEnd: elseEnd,
  };
}

/**
 * Count the lift statements in the for body. Multi-lift bodies skip
 * (per §56.10.2 row 6).
 *
 * @param {object} forStmt
 * @returns {number}
 */
function countLiftsInBody(forStmt) {
  let count = 0;
  function visit(stmts) {
    if (!Array.isArray(stmts)) return;
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      if (s.kind === "lift-expr") count++;
      // Recurse into if/else/etc — but lifts inside conditional bodies still
      // count as lift bodies for the multi-lift check.
      if (Array.isArray(s.body)) visit(s.body);
      if (Array.isArray(s.consequent)) visit(s.consequent);
      if (Array.isArray(s.alternate)) visit(s.alternate);
    }
  }
  visit(forStmt.body);
  return count;
}

/**
 * Check whether the iterable expression is a single `@cell` ref.
 * Per §56.10.2 row 5, literal arrays / fn-call results are skipped.
 *
 * @param {string} iterable
 * @returns {boolean}
 */
function iterableIsCellRef(iterable) {
  if (!iterable) return false;
  // Strict: bare `@ident` or `@ident.field.chain`.
  return /^@[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(iterable);
}

/**
 * Apply §56.10.3 :-shorthand heuristic: the body is a SINGLE markup element
 * (no siblings, no surrounding text) whose body is a SINGLE `${...}`
 * interpolation OR a single bare display-text run.
 *
 * Returns { ok: true, opener, body } if the heuristic matches; { ok: false }
 * otherwise. `opener` is the tag-open-with-attrs (e.g. `<li>` or `<li class="x">`),
 * `body` is the inner expression text or display text.
 */
function tryShorthandHeuristic(bodyText, iterVar) {
  const trimmed = bodyText.trim();
  // Strip optional trailing `;` after lift expression.
  // Pattern: `lift <tag ...>...</tag>;?`  OR  `lift <tag ... />`
  const m = trimmed.match(/^lift\s+(<[^>]*>)([\s\S]*?)(<\/[^>]*>|<\/>);?\s*$/);
  if (!m) return { ok: false };
  const opener = m[1].trim();
  const inner = m[2];
  // Reject if opener contains `${` (interpolation in attrs)
  if (opener.includes("${")) return { ok: false };
  // Inner must be a single ${...} interpolation OR plain display text.
  const interpolationMatch = inner.match(/^\s*\$\{([\s\S]*?)\}\s*$/);
  let bodyExpr;
  if (interpolationMatch) {
    bodyExpr = interpolationMatch[1].trim();
  } else if (/^[\s\S]*\$\{/.test(inner)) {
    // Mixed text + interpolation — heuristic fails.
    return { ok: false };
  } else {
    // Plain display text — admissible per §56.10.3 ("single bare display-text run").
    bodyExpr = JSON.stringify(inner.trim());
  }
  // Apply transform: replace bare iter-var refs in body with @. semantics.
  // - `iterVar.field` → `@.field` (drops the iterVar AND its trailing dot)
  // - bare `iterVar`  → `@.`
  // Only when the iter-var appears as a standalone identifier (not nested
  // inside another identifier or after a `.`).
  //
  // The `@.` sigil per §17.7.3 means "the current iteration value." Property
  // access composes as `@.field` (one dot between `@.` and `field`).
  let transformed = bodyExpr.replace(
    new RegExp("(^|[^\\w.$])" + iterVar + "\\.", "g"),
    "$1@.",
  );
  // Then handle bare iter-var (no trailing `.field`)
  transformed = transformed.replace(
    new RegExp("(^|[^\\w.$])" + iterVar + "(\\b)(?!\\.)", "g"),
    "$1@.$2",
  );
  // Only emit shorthand if the transform actually used @. (i.e. iter-var
  // was referenced). Otherwise the heuristic fails ("EXACTLY ONE reference").
  if (transformed === bodyExpr) {
    // No iter-var ref — heuristic fails per §56.10.3 condition 3.
    return { ok: false };
  }
  return { ok: true, opener, body: transformed };
}

/**
 * Rewrite a single iteration site. Returns { ok, rewritten, replaceStart,
 * replaceEnd, reason }. On failure, ok:false + reason; rewritten/replace*
 * undefined.
 *
 * @param {string} source
 * @param {object} forStmt
 * @param {{ shorthand: boolean }} opts
 * @returns {{ ok: boolean, rewritten?: string, replaceStart?: number, replaceEnd?: number, reason?: string }}
 */
function rewriteOneIteration(source, forStmt, opts) {
  // Step 1: parse the for-header.
  const header = parseForHeader(forStmt.iterable, forStmt.variable);
  if (!header) {
    return { ok: false, reason: "for-loop header could not be parsed (C-style or destructured form)" };
  }

  // Step 2: validate iterable per §56.10.2.
  if (header.countMode) {
    // C-style count-loop — admissible per §56.10.2 row 4.
    // The count expression and init must be standard `let i = 0; i < N; i++` shape.
    if (header.iterInit !== "0") {
      return { ok: false, reason: "C-style count-loop init must be `0` (non-zero init not promotable)" };
    }
  } else {
    if (!iterableIsCellRef(header.iterable)) {
      return { ok: false, reason: "iterable is not an `@cell` reference (literal arrays + function-call results are not promotable per §56.10.2)" };
    }
  }

  // Step 3: count lifts; multi-lift bodies are skipped.
  const liftCount = countLiftsInBody(forStmt);
  if (liftCount === 0) {
    return { ok: false, reason: "for-loop body contains no `lift` statement" };
  }
  if (liftCount > 1) {
    return { ok: false, reason: "for-loop body contains multiple `lift` statements (per-item template must be one markup expression)" };
  }

  // Step 4: locate the Tier-0 `${...}` wrapper that encloses this for-stmt.
  const wrap = findTier0Wrapper(source, forStmt);
  if (!wrap) {
    return { ok: false, reason: "for-loop is not inside a Tier-0 `${...}` logic-context wrapper" };
  }

  // Step 5: extract body + optional else clause.
  const parts = extractForBodyAndElse(source, forStmt, wrap.wrapBodyEnd);
  if (!parts) {
    return { ok: false, reason: "for-loop body span could not be extracted" };
  }

  // Step 6: verify the wrapper contains ONLY this for-loop (allowing
  // surrounding whitespace + the trailing else-block). If there is other
  // content inside the wrapper (e.g. statements before/after the for-loop),
  // skip — the safe rewrite would require pulling that content out, which
  // is outside Landing 3 scope.
  const wrapBody = source.slice(wrap.wrapBodyStart, wrap.wrapBodyEnd);
  const preForBody = source.slice(wrap.wrapBodyStart, forStmt.span.start).trim();
  if (preForBody.length > 0) {
    return { ok: false, reason: "Tier-0 wrapper contains statements before the for-loop (not single-purpose; skipping)" };
  }
  const postSiteBody = source.slice(parts.siteEnd, wrap.wrapBodyEnd).trim();
  if (postSiteBody.length > 0) {
    return { ok: false, reason: "Tier-0 wrapper contains statements after the for-loop (not single-purpose; skipping)" };
  }

  // Step 7: derive indentation from the wrapper opener line.
  const lineStart = source.lastIndexOf("\n", wrap.wrapStart - 1) + 1;
  const wrapIndent = source.slice(lineStart, wrap.wrapStart).replace(/[^\s]/g, "");
  const useTab = wrapIndent.includes("\t");
  const oneStep = useTab ? "\t" : (detectIndentStep(source, wrapIndent) || "    ");
  const innerIndent = wrapIndent + oneStep;

  // Step 8 — try :-shorthand FIRST (because it determines whether the
  // opener carries `as iterVar` per §56.10.3 example: bare-body retains the
  // `as` clause; shorthand drops it since `@.` is contextual).
  let shorthandOutcome = null;
  if (opts.shorthand && !header.countMode) {
    const sh = tryShorthandHeuristic(parts.bodyText, header.iterVar);
    if (sh.ok) shorthandOutcome = sh;
  }

  // Step 9: build the <each> opener.
  let opener;
  if (header.countMode) {
    opener = `<each of=${header.countExpr} as ${header.iterVar}>`;
  } else {
    opener = `<each in=${header.iterable}`;
    // When shorthand applies, drop the `as iterVar` — the per-item body uses
    // `@.` instead. When bare-body, keep `as iterVar` for the original name.
    if (!shorthandOutcome) {
      opener += ` as ${header.iterVar}`;
    }
    if (header.keyExpr) {
      opener += ` key=${header.keyExpr}`;
    }
    opener += ">";
  }

  // Step 10: build the per-item template body.
  const bodyLines = [];
  if (shorthandOutcome) {
    const openerInner = shorthandOutcome.opener.slice(1, -1).trim();
    bodyLines.push(`${innerIndent}<${openerInner} : ${shorthandOutcome.body}>`);
  } else {
    // Bare-body emission — extract markup verbatim from `lift <markup>;`.
    const trimmedBody = parts.bodyText.trim();
    // Strip leading `lift ` and trailing `;`.
    const liftMatch = trimmedBody.match(/^lift\s+([\s\S]*?);?\s*$/);
    let markup = liftMatch ? liftMatch[1].trim() : trimmedBody;
    // Re-indent markup to innerIndent.
    bodyLines.push(reindent(markup, innerIndent));
  }

  // Step 11: append <empty>...</empty> if the source had an `else { lift ... }`.
  if (parts.elseBlock) {
    const elseInner = parts.elseBlock.body.trim();
    const elseLiftMatch = elseInner.match(/^lift\s+([\s\S]*?);?\s*$/);
    let elseMarkup = elseLiftMatch ? elseLiftMatch[1].trim() : elseInner;
    bodyLines.push(`${innerIndent}<empty>${elseMarkup}</empty>`);
  }

  // Step 12: assemble final <each> block.
  const eachBlock = [
    opener,
    ...bodyLines,
    `${wrapIndent}</each>`,
  ].join("\n");

  // Step 13: substitute the wrapper span with the <each> block. The wrapper
  // spans `${` ... `}` inclusive.
  const replaceStart = wrap.wrapStart;
  const replaceEnd = wrap.wrapEnd;

  // Final assembled rewrite: re-indent the opener line. The wrap span is from
  // the `$` of `${`. The opener begins at the `<each ...` text. Combine.
  const finalText = eachBlock;
  const rewritten = source.slice(0, replaceStart) + finalText + source.slice(replaceEnd);
  return { ok: true, rewritten, replaceStart, replaceEnd };
}

/**
 * Apply --each rewrites across all iteration sites in a file. Mirrors the
 * applyMatchRewrite shape: descending offsets so earlier rewrites don't
 * shift later ones.
 *
 * @param {string} sourceText
 * @param {object[]} sites — for-stmt nodes
 * @param {number|null} targetLine — restrict to site at this line (±1 lenient)
 * @param {{ shorthand: boolean }} opts
 */
function applyEachRewrite(sourceText, sites, targetLine, opts) {
  let rewritten = sourceText;
  let count = 0;
  const skipped = [];

  let chosen = sites;
  if (targetLine != null) {
    chosen = sites.filter(s => {
      const ln = s.span?.line ?? 0;
      return Math.abs(ln - targetLine) <= 1;
    });
    if (chosen.length === 0) {
      skipped.push({
        line: targetLine,
        reason: "no promotable iteration site at this line",
      });
      return { rewritten, count, skipped };
    }
  }

  // Sort descending by start offset so we splice from end to start.
  const sorted = chosen.slice().sort((a, b) => {
    const aStart = a.span?.start ?? 0;
    const bStart = b.span?.start ?? 0;
    return bStart - aStart;
  });

  for (const site of sorted) {
    const r = rewriteOneIteration(rewritten, site, opts);
    if (r.ok) {
      rewritten = r.rewritten;
      count++;
    } else {
      skipped.push({ line: site.span?.line ?? 0, reason: r.reason });
    }
  }

  return { rewritten, count, skipped };
}

/**
 * Promote a single file via --each. Mirrors promoteMatchOnFile in shape.
 *
 * @param {string} filePath
 * @param {number|null} targetLine
 * @param {{ dryRun: boolean, check: boolean, shorthand: boolean }} opts
 * @param {string} cwd
 */
export function promoteEachOnFile(filePath, targetLine, opts, cwd) {
  const relPath = relative(cwd, filePath);

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    return { status: "unreadable", reason: err.message, relPath };
  }

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

  // Get typed-AST via the bridge.
  const typedFiles = collectTypedFiles(filePath);
  if (!typedFiles || typedFiles.length === 0) {
    return { status: "failed", reason: "could not access typed-AST", relPath };
  }
  const fileAST = typedFiles.find(f => f.filePath === filePath) ?? typedFiles[0];

  const sites = findIterationSites(fileAST);
  if (sites.length === 0) {
    return { status: "no-sites", relPath };
  }

  const { rewritten, count, skipped } = applyEachRewrite(source, sites, targetLine, opts);
  if (count === 0) {
    if (targetLine != null) {
      return {
        status: "ambiguous",
        reason: `no promotable iteration site at line ${targetLine}`,
        relPath,
        skipped,
      };
    }
    // No promotable sites — return no-sites + surface skip reasons informationally.
    return { status: "no-sites", relPath, skipped };
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

  // Idempotency check.
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runPromote(args) {
  const { paths, mode, dryRun, check, include, excludes, shorthand, help } = parseArgs(args);

  if (help) {
    printHelp();
    return;
  }

  if (mode === null) {
    console.error(c.red("error:") + " scrml promote requires one of --match, --engine, or --each.");
    console.error(c.dim("Run `scrml promote --help` for usage."));
    process.exit(1);
  }

  // --shorthand is meaningful only on --each. Reject on other modes.
  if (shorthand && mode !== "each") {
    console.error(c.red("error:") + ` --shorthand is meaningful only with --each (current mode: --${mode}).`);
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

  // --match and --each: real rewrite paths sharing file-walk machinery.
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
    const r = mode === "each"
      ? promoteEachOnFile(file, targetLine, { dryRun, check, shorthand }, cwd)
      : promoteMatchOnFile(file, targetLine, { dryRun, check }, cwd);
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
