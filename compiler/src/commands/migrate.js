/**
 * @module commands/migrate
 * scrml migrate subcommand.
 *
 * Automated source rewrites for the deprecation/migration patterns introduced
 * in S52+S53. The CLI is opt-in — it never runs as part of `compile`/`dev`/`build`.
 *
 * Migrations shipped (P4):
 *   1. Whitespace-after-`<` (W-WHITESPACE-001):  `< db>` → `<db>`, etc.
 *      Applies only to known scrml lifecycle/structural keywords.
 *   2. `<machine>` keyword (W-DEPRECATED-001):   `<machine` → `<engine`.
 *   3. `pure` modifier   (W-PURE-DEPRECATED):  `pure function`/`pure fn` → `fn`;
 *                                              `[server ]pure[ server ]function` → `server fn`.
 *   4b. `const @name` derived cell (W-CONST-AT-DEPRECATED, sym-cell-registration-
 *                                  completeness): `const @name = ...` → `const <name> = ...`
 *                                  (the SOLE derived-decl form per §6.6.1).
 *
 * Migrations gated by `--fix` (AST/compile-aware — see the migrateFile tier):
 *   - arm-arrow `:>`, given-guard `:>`, `:`-shorthand inside-opener (SPEC §18.2 /
 *     §42.2.3 / §4.14). See `rewriteMatchArmArrows` / `rewriteGivenGuardArrows` /
 *     `rewriteColonShorthandPlacement` below.
 *   4. `server` keyword on `server function` (W-DEPRECATED-SERVER-MODIFIER,
 *     server-keyword-eliminate S180): strip the deprecated `server` keyword from
 *     `server function NAME(` declarations that STILL escalate server without it
 *     (the lint firing IS the proof it is safe). Excludes the SSE generator
 *     `server function*` (deferred) and never `server fn`. Diagnostic-driven —
 *     see `rewriteServerFunctionKeyword` below.
 *
 *   5. `server` keyword on a `server function` CHANNEL PUBLISHER
 *     (E-CHANNEL-SERVER-CELL-READ, channel-cell-write-client-side-A RULING A):
 *     strip the deprecated `server` keyword from a `server function NAME(`
 *     channel publisher that read-modify-writes a channel cell, where the
 *     keyword is the SOLE server-placement reason (E-CHANNEL fires AND
 *     W-DEPRECATED does NOT) — the strip flips it to a client-side `function`
 *     that syncs via `__sync` (§38.4), clearing the error. Excludes generators
 *     and broadcast/SQL-escalated publishers (those need a manual payload
 *     rewrite, §38.6.1). Diagnostic-driven — see `rewriteChannelServerPublisher`.
 *
 * Migration gated by `--program-shape` (v0.3 Wave 2 — S86):
 *   - Program-shape rewrite per SPEC §40.8 (one-program-per-application).
 *      File classified as entry / route / module / schema-anchor / ambiguous;
 *      route files with per-route-only attrs rewrite `<program ...>` → `<page ...>`.
 *      Entry files unwrap redundant `${...}` wrappers around top-level decls.
 *      Schema-anchor files (`<schema>` + `<program db=>`) are LEFT ALONE per
 *      §39.12.0 v0.3 workaround; advisory emitted in `--report` mode.
 *      See `classifyFile` + `applyProgramShapeRewrite` below.
 *
 * Migrations deferred (P4):
 *   3a. Form 2 → Form 1 component desugaring (`export const Name = <markup>` →
 *      `export <Name>{markup}</>`). Deferred because text-substitution can't
 *      cleanly handle the surrounding `${ ... }` block boundary — the
 *      transformation requires either splitting the block or an AST-level
 *      rewrite. Tracked for P5+.
 *
 * Usage:
 *   scrml migrate <file|dir> [options]
 *
 * Options:
 *   --dry-run            Print unified diff to stdout without writing
 *   --check              Exit non-zero if any file would be modified (CI-friendly)
 *   --include=<glob>     File pattern to match (default: '*.scrml')
 *   --exclude=<glob>     Pattern to exclude (default: 'samples/' is excluded by default)
 *   --no-default-excludes  Disable the built-in `samples/` exclusion
 *   --program-shape      Enable v0.3 program-shape rewrites (SPEC §40.8)
 *   --report             With --dry-run --program-shape, emit structured advisory report
 *   --help, -h           Show this message
 *
 * Safety model:
 *   - For each file: read source, apply text-substitution migrations, then
 *     verify the rewritten source via `compileScrml({ write: false })` using
 *     a transactional in-place stage (write rewrite to original path, run
 *     compile, restore original) so cross-file imports resolve correctly.
 *     See `sanityCheckParse` for the full option-β rationale. If the
 *     rewritten source fails to compile, the file is restored from the
 *     in-memory backup and the failure is reported.
 *   - `samples/compilation-tests/` and `compiler/tests/` directories are
 *     excluded by default — those exercise deprecation paths intentionally.
 *   - Default operation is in-place rewriting. Use `--dry-run` for preview.
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
import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { parseMatchArms } from "../match-statechild-parser.ts";
import { parseEngineStateChildren } from "../engine-statechild-parser.ts";

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const isTTY = process.stderr.isTTY && process.stdout.isTTY;

const c = {
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Migration rules
// ---------------------------------------------------------------------------

/**
 * Lifecycle / structural keywords whose openers may legitimately be rewritten.
 *
 * These are the keywords that NR / TAB recognize as compiler-known top-level
 * forms — never user-defined identifiers, never plain HTML tags. Only these
 * are rewritten to keep Migration 1 conservative (false-positives on a generic
 * lowercase `<\s+ident>` would mangle bareword text inside `${ }` blocks or
 * literal HTML body content.)
 *
 * Sourced from name-resolver.ts LIFECYCLE_CATEGORY plus structural keywords
 * (program / page / body / lin) recognized by BS / TAB.
 */
const KNOWN_KEYWORDS = new Set([
  // Lifecycle (name-resolver.ts LIFECYCLE_CATEGORY)
  "channel",
  "engine",
  "machine",
  "timer",
  "poll",
  "db",
  "schema",
  "request",
  "errorBoundary",
  "errorboundary",
  // Structural (top-level scrml constructs)
  "program",
  "page",
  "body",
  "lin",
]);

/**
 * Apply Migration 1 (W-WHITESPACE-001) and Migration 2 (W-DEPRECATED-001)
 * to a source string. Returns the rewritten source.
 *
 * Migration 1 — whitespace-after-`<`:
 *   `< db>` / `< schema/>` / `< channel for=X>` → `<db>` / `<schema/>` etc.
 *
 *   The regex captures the `<`, any whitespace, an identifier matching a known
 *   keyword, and the boundary character (whitespace, `>`, or `/`). It rewrites
 *   to `<ident<boundary>`, preserving the rest of the opener verbatim.
 *
 *   We restrict the identifier to the KNOWN_KEYWORDS list. A generic
 *   `< [a-z]+` rule would falsely match arbitrary lowercase HTML / component
 *   refs and even tag-like text inside string literals, which the regex
 *   approach can't disambiguate.
 *
 *   We also avoid rewriting `< /name>` (close tag) — the regex only matches
 *   when the next char after `<\s+` is a letter, not `/`.
 *
 * Migration 2 — `<machine>` keyword:
 *   `<machine` / `< machine` → `<engine` / `< engine` (preserving any
 *   leading whitespace after `<` — Migration 1 will normalize that on a
 *   follow-up pass).
 *
 *   Applied AFTER Migration 1 in the same pass: Migration 1 may have already
 *   normalized `< machine` → `<machine`, in which case Migration 2 picks it
 *   up here. If Migration 2 runs first on `< machine`, it produces `< engine`,
 *   and Migration 1 then normalizes that to `<engine`.
 *
 * Migration 3 — `pure` modifier (W-PURE-DEPRECATED, deprecate-pure-modifier-2026-06-09):
 *   `pure function NAME(` / `pure fn NAME(` → `fn NAME(`;
 *   `pure server function NAME(` / `server pure function NAME(` → `server fn NAME(`.
 *   The `pure` modifier is deprecated language-wide; `fn` is the canonical pure
 *   form (mirrors the `<machine>`→`<engine>` deprecation, Migration 2). The
 *   regex anchors on the DECLARATION shape (`pure` [+ `server`] + `function`/`fn`
 *   + name + `(`) so prose/comments that merely mention "pure function" are not
 *   rewritten. Idempotent — a `fn NAME(` produced by a prior run has no leading
 *   `pure` to match. Applied after Migrations 1+2 in the same pass.
 *
 * Migration 4 — legacy derived cell `const @name` (W-CONST-AT-DEPRECATED,
 *   sym-cell-registration-completeness-2026-06-13):
 *   `const @name = ...` / `const @name: T = ...` → `const <name> = ...` /
 *   `const <name>: T = ...`. The canonical (and per SPEC §6.6.1 SOLE) derived-cell
 *   form is `const <name>`; the `@`-form is not recognized inside a markup element
 *   body (silently drops the cell). The regex anchors on a LINE-LEADING `const @ident`
 *   (after optional indentation), so `//`-comments and inline prose mentioning
 *   `const @x` are not rewritten (a comment line starts with `//`, not `const`).
 *   Idempotent — a `const <name>` from a prior run has no `@` to match. Applied
 *   after Migrations 1-3 in the same pass.
 *
 * @param {string} source — raw source text
 * @returns {{ rewritten: string, changed: boolean, migrations: { whitespace: number, machine: number, pure: number, constAt: number } }}
 */
export function applyMigrations(source) {
  let result = source;
  let whitespaceCount = 0;
  let machineCount = 0;

  // Migration 1: `< KEYWORD<boundary>` → `<KEYWORD<boundary>`
  //
  // Pattern: `<` + at-least-one whitespace char + lowercase identifier +
  //          (whitespace | `>` | `/`).
  // Capture the identifier and the boundary char so we can re-emit them.
  // Apply only when the identifier is a known scrml keyword.
  result = result.replace(
    /<(\s+)([a-zA-Z][a-zA-Z0-9]*)(\s|>|\/)/g,
    (match, _ws, ident, boundary) => {
      if (!KNOWN_KEYWORDS.has(ident)) return match;
      whitespaceCount++;
      return `<${ident}${boundary}`;
    }
  );

  // Migration 2: `<\s*machine` (opener) → `<\s*engine`
  //
  // Pattern matches `<` + optional whitespace + `machine` + (whitespace | `>` |
  // `/`). The trailing-boundary check ensures we don't mangle identifiers
  // like `<machineState>` (false positive — `machineState` starts with
  // `machine` but isn't `machine` itself).
  result = result.replace(
    /<(\s*)machine(\s|>|\/)/g,
    (_match, ws, boundary) => {
      machineCount++;
      return `<${ws}engine${boundary}`;
    }
  );

  // Migration 3: `pure` modifier (W-PURE-DEPRECATED) → drop it; `fn` is canonical.
  //
  // The `pure` modifier is deprecated language-wide. Canonical pure form is `fn`
  // (and `server fn`). Rewrites the DECLARATION forms only (anchored on a name +
  // `(` so prose mentions of "pure function" are untouched):
  //   `pure function NAME(`            → `fn NAME(`
  //   `pure fn NAME(`                  → `fn NAME(`
  //   `pure server function NAME(`     → `server fn NAME(`
  //   `server pure function NAME(`     → `server fn NAME(`
  // `export` (when present) precedes `pure` and is left in place by the regex,
  // so `export pure function NAME(` → `export fn NAME(` falls out naturally.
  // Idempotent: a `fn NAME(` from a prior run carries no leading `pure`.
  let pureCount = 0;
  result = result.replace(
    // group 1: optional leading `server ` (the `server pure` ordering)
    // keyword: `pure` then optional ` server`, then `function` or `fn`
    // group 2: the trailing whitespace + name + `(` we re-emit verbatim
    /\b(server\s+)?pure(\s+server)?\s+(?:function|fn)(\s+[A-Za-z_$][\w$]*\s*\()/g,
    (_match, leadServer, midServer, tail) => {
      pureCount++;
      const isServer = Boolean(leadServer) || Boolean(midServer);
      return `${isServer ? "server " : ""}fn${tail}`;
    }
  );

  // Migration 4: legacy derived cell `const @name` (W-CONST-AT-DEPRECATED) →
  // canonical `const <name>`. Anchored LINE-LEADING (start-of-line + optional
  // indentation) so comment / prose mentions of `const @x` are not rewritten.
  // Captures an optional `: type` segment up to the `=` and re-emits it verbatim.
  //   `const @doubled = ...`            → `const <doubled> = ...`
  //   `const @total: number = ...`      → `const <total>: number = ...`
  // Idempotent: a `const <name>` from a prior run carries no `@`.
  let constAtCount = 0;
  result = result.replace(
    /^([ \t]*)const @([A-Za-z_$][\w$]*)(\s*(?::[^=\n]+?)?\s*=)/gm,
    (_match, indent, name, tail) => {
      constAtCount++;
      return `${indent}const <${name}>${tail}`;
    }
  );

  return {
    rewritten: result,
    changed: result !== source,
    migrations: {
      whitespace: whitespaceCount,
      machine: machineCount,
      pure: pureCount,
      constAt: constAtCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Arm-arrow `:>` canonicalisation migration (SPEC §18.2 / §34, S147)
// ---------------------------------------------------------------------------

/**
 * Rewrite deprecated `match` / `!{}`-handler arm separators (`=>` / `->`) to
 * the canonical `:>` (SPEC §18.2; surfaces W-MATCH-ARROW-LEGACY pre-migration).
 *
 * This MUST be AST/parser-position-driven, NOT a regex text-replace — `=>` is
 * also the arrow-function glyph (`(x) => ...`) and `->` is the `fn ... -> Type`
 * return separator + legacy machine event-arrow. A blind text replace would
 * destroy every lambda and fn signature. We drive the LIVE front-end
 * (splitBlocks + buildAST) and rewrite ONLY at recorded arm-separator
 * positions:
 *   - `match-arm-inline` / `match-arm-block` nodes carry `armArrow` (the source
 *     glyph) and a `span` whose `.start` is the arm-pattern start.
 *   - `guarded-expr.arms[]` carry `armArrow` and an arm `span`.
 * For each arm whose `armArrow` is `=>` / `->`, we locate the FIRST occurrence
 * of that exact glyph at or after the arm's `span.start` (the arm pattern never
 * contains an arm arrow, so the first one IS the separator) and splice in `:>`.
 * Rewrites are applied right-to-left so earlier offsets stay valid.
 *
 * Returns `{ rewritten, changed, count }`. On any parse trouble (no AST, or a
 * located glyph that does not match the recorded one) the affected arm is
 * skipped — fail-safe: never rewrite a position we cannot confirm.
 *
 * @param {string} source — raw source text
 * @param {string} filePath — for the block splitter's diagnostics
 * @returns {{ rewritten: string, changed: boolean, count: number }}
 */
export function rewriteMatchArmArrows(source, filePath) {
  let ast;
  try {
    const bs = splitBlocks(filePath, source);
    ({ ast } = buildAST(bs));
  } catch {
    // Front-end could not build an AST — do not guess at arm positions.
    return { rewritten: source, changed: false, count: 0 };
  }
  if (!ast || typeof ast !== "object") {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Collect every deprecated-glyph arm rewrite as a { offset, glyph } edit.
  // `offset` is the source index of the glyph's first char; `glyph` is `=>`
  // or `->` (both 2 chars wide — replaced by the 2-char `:>`).
  const edits = [];
  const seenOffsets = new Set();

  const recordArm = (glyph, armStartRaw) => {
    if (glyph !== "=>" && glyph !== "->") return;
    if (typeof armStartRaw !== "number" || armStartRaw < 0) return;
    // Find the first occurrence of THIS glyph at/after the arm-pattern start.
    const at = source.indexOf(glyph, armStartRaw);
    if (at < 0) return;
    if (seenOffsets.has(at)) return;
    seenOffsets.add(at);
    edits.push({ offset: at, glyph });
  };

  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    const kind = n.kind;
    if (kind === "match-arm-inline" || kind === "match-arm-block") {
      const span = n.span;
      recordArm(n.armArrow, span && typeof span.start === "number" ? span.start : -1);
    } else if (kind === "guarded-expr" && Array.isArray(n.arms)) {
      for (const arm of n.arms) {
        if (!arm || typeof arm !== "object") continue;
        const aspan = arm.span;
        recordArm(arm.armArrow, aspan && typeof aspan.start === "number" ? aspan.start : -1);
      }
    } else if (kind === "engine-decl" && Array.isArray(n.inlineMatchArmArrows)) {
      // S171 — §51.0.J derived-engine `derived=match @VAR { ... }` arms join the
      // `:>` deprecation. The body is captured as RAW TEXT (no structured arm
      // nodes), so the parser stamps `inlineMatchArmArrows`: one entry per arm
      // with the separator glyph + its ABSOLUTE source offset (already the exact
      // glyph position, computed arm-context-scoped — never a body-internal
      // arrow-fn `=>` / `->`). Record each directly by offset (no indexOf needed
      // — the offset IS the glyph's first char). recordArm's indexOf(glyph,
      // offset) is a no-op (the glyph is already at `offset`), and the
      // right-to-left splice + byte-check apply uniformly.
      for (const a of n.inlineMatchArmArrows) {
        if (!a || typeof a !== "object") continue;
        recordArm(a.glyph, typeof a.srcOffset === "number" ? a.srcOffset : -1);
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      walk(n[k]);
    }
  };
  walk(ast);

  if (edits.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Apply right-to-left so earlier offsets remain valid. Each glyph is exactly
  // 2 chars (`=>` / `->`) and is replaced by the 2-char `:>` — verify the
  // bytes at the recorded offset still match the recorded glyph (fail-safe).
  edits.sort((a, b) => b.offset - a.offset);
  let rewritten = source;
  let count = 0;
  for (const { offset, glyph } of edits) {
    if (rewritten.slice(offset, offset + 2) !== glyph) continue; // moved/clobbered — skip
    rewritten = rewritten.slice(0, offset) + ":>" + rewritten.slice(offset + 2);
    count++;
  }

  return { rewritten, changed: rewritten !== source, count };
}

/**
 * AST-driven rewrite of deprecated standalone-`given` presence-guard separators
 * `=>` → the canonical `:>` (SPEC §42.2.3 / §34 — the `given`-guard sibling of
 * `rewriteMatchArmArrows`). Powers the W-GIVEN-ARROW-LEGACY lint's
 * `bun scrml migrate --fix` suggestion.
 *
 * This MUST be AST/parser-position-driven, NOT a regex text-replace — `=>` is
 * ALSO the arrow-function glyph (`(x) => ...`). A blind text replace would
 * destroy every lambda. We drive the LIVE front-end (splitBlocks + buildAST)
 * and rewrite ONLY at recorded `given-guard` separator positions:
 *   - every `given-guard` node carries `separatorGlyph` (`":>"` / `"=>"`, set by
 *     the given-guard parser) and a `span` whose `.start` is the `given` keyword.
 *   - the identifier-list between `given` and the separator never contains a
 *     `=>`, so the FIRST `=>` at/after `span.start` IS the guard separator.
 * Rewrites are applied right-to-left so earlier offsets stay valid; each glyph
 * is exactly 2 chars (`=>` → `:>`). A byte-check at the recorded offset is the
 * fail-safe: never rewrite a position we cannot confirm.
 *
 * NOT in-match-scoped: an in-`match` `given x => ...` arm also parses to a
 * `given-guard` node, and its `=>` separator IS a `given`-guard separator that
 * SHALL become `:>` (§42.2.3) — so it is rewritten here too. (The lint scoping
 * that suppresses a DOUBLE W-GIVEN/W-MATCH diagnostic is a lint-only concern;
 * the byte-rewrite target is the same canonical `:>` either way.)
 *
 * @param {string} source — raw source text
 * @param {string} filePath — for the block splitter's diagnostics
 * @returns {{ rewritten: string, changed: boolean, count: number }}
 */
export function rewriteGivenGuardArrows(source, filePath) {
  let ast;
  try {
    const bs = splitBlocks(filePath, source);
    ({ ast } = buildAST(bs));
  } catch {
    // Front-end could not build an AST — do not guess at guard positions.
    return { rewritten: source, changed: false, count: 0 };
  }
  if (!ast || typeof ast !== "object") {
    return { rewritten: source, changed: false, count: 0 };
  }

  const edits = [];
  const seenOffsets = new Set();

  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.kind === "given-guard" && n.separatorGlyph === "=>") {
      const span = n.span;
      const start = span && typeof span.start === "number" ? span.start : -1;
      if (start >= 0) {
        // The first `=>` at/after the `given` keyword is the guard separator
        // (the identifier-list contains no `=>`).
        const at = source.indexOf("=>", start);
        if (at >= 0 && !seenOffsets.has(at)) {
          seenOffsets.add(at);
          edits.push({ offset: at });
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      walk(n[k]);
    }
  };
  walk(ast);

  if (edits.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Apply right-to-left so earlier offsets remain valid. Verify the bytes at
  // the recorded offset still read `=>` (fail-safe — never clobber otherwise).
  edits.sort((a, b) => b.offset - a.offset);
  let rewritten = source;
  let count = 0;
  for (const { offset } of edits) {
    if (rewritten.slice(offset, offset + 2) !== "=>") continue; // moved/clobbered — skip
    rewritten = rewritten.slice(0, offset) + ":>" + rewritten.slice(offset + 2);
    count++;
  }

  return { rewritten, changed: rewritten !== source, count };
}

// ---------------------------------------------------------------------------
// `:`-shorthand placement canonicalisation (SPEC §4.14 / §51.0.I / §18.0.1, S160)
// ---------------------------------------------------------------------------

/**
 * S160 (S154 ruling (b)) — given a body text (an engine `rulesRaw` or a match
 * `armsRaw`) and the parser-detected legacy after-`>` arms, rewrite each legacy
 * arm in place from the after-`>` placement (`<Variant attrs> : expr`) to the
 * canonical inside-opener placement (`<Variant attrs : expr>`). Returns the
 * rewritten body (unchanged when no legacy arms are present) and the rewrite
 * count.
 *
 * String-precise per arm: for each arm whose opener is at `openerStart` (local
 * to `body`), scan to the opener's terminating `>` (string-/paren-/`${}`-aware),
 * then to the post-`>` `:` body-introducer, then to the body's end (the parser
 * already captured `bodyRaw`). The rewrite removes the `>` and the post-`>` `:`,
 * splices ` : ` before the original `>` position, and re-emits the body inside
 * the opener. Applied right-to-left so earlier offsets stay valid.
 *
 * @param {string} body — the engine/match body text
 * @param {Array<{openerStart:number, legacy:boolean}>} legacyArms — opener-local
 *   offsets of the legacy after-`>` arms (the caller derives these from the
 *   parser entries)
 * @returns {{ rewritten: string, count: number }}
 */
function rewriteColonPlacementInBody(body, legacyArms) {
  if (!legacyArms.length) return { rewritten: body, count: 0 };

  // Scan an opener from `<` to its terminating `>` (string-/paren-/`${}`-aware).
  // Returns the index of the `>` or -1.
  const findOpenerGt = (s, from) => {
    let i = from;
    let paren = 0;
    let q = "";
    while (i < s.length) {
      const c = s[i];
      if (q) { if (c === q) q = ""; i++; continue; }
      if (c === '"' || c === "'") { q = c; i++; continue; }
      if (c === "$" && s[i + 1] === "{") {
        i += 2; let d = 1;
        while (i < s.length && d > 0) { const c2 = s[i]; if (c2 === "{") d++; else if (c2 === "}") d--; i++; }
        continue;
      }
      if (c === "(") paren++;
      else if (c === ")") { if (paren > 0) paren--; }
      else if (c === ">" && paren === 0) return i;
      i++;
    }
    return -1;
  };

  // Build the edits (offset of opener `>`, end of the `: expr` body run).
  const edits = [];
  for (const arm of legacyArms) {
    if (!arm.legacy) continue;
    const gt = findOpenerGt(body, arm.openerStart);
    if (gt < 0) continue;
    // After `>`, optional whitespace, then `:`.
    let p = gt + 1;
    while (p < body.length && (body[p] === " " || body[p] === "\t")) p++;
    if (body[p] !== ":") continue; // not the legacy after-`>` shape — skip (fail-safe)
    const colonAt = p;
    // The body runs from one past the `:` to end-of-line (the canonical
    // single-expression `:`-form). Capture the post-`:` expression text.
    let bodyEnd = colonAt + 1;
    while (bodyEnd < body.length && body[bodyEnd] !== "\n") bodyEnd++;
    const exprText = body.slice(colonAt + 1, bodyEnd).trim();
    if (!exprText) continue;
    edits.push({ openerGt: gt, segEnd: bodyEnd, exprText });
  }
  if (!edits.length) return { rewritten: body, count: 0 };

  // Apply right-to-left so earlier offsets stay valid. Replace the slice
  // `[openerGt, segEnd)` (`>` through end-of-line) with ` : <expr>>` placed
  // inside the opener (before the `>`): the opener attribute text [.. , openerGt)
  // is preserved verbatim; the body moves inside.
  edits.sort((a, b) => b.openerGt - a.openerGt);
  let out = body;
  let count = 0;
  for (const { openerGt, segEnd, exprText } of edits) {
    if (out[openerGt] !== ">") continue; // moved/clobbered — fail-safe skip
    out = out.slice(0, openerGt) + ` : ${exprText}>` + out.slice(segEnd);
    count++;
  }
  return { rewritten: out, count };
}

/**
 * AST-driven rewrite of legacy after-`>` `:`-shorthand placements to the
 * canonical inside-opener placement (SPEC §4.14 / §51.0.I / §18.0.1, S160 —
 * S154 ruling (b)). Powers the `W-COLON-SHORTHAND-LEGACY-PLACEMENT` lint's
 * `bun scrml migrate --fix` suggestion.
 *
 * This MUST be AST/parser-position-driven, NOT a regex text-replace — a `>`
 * can appear inside a string attribute value (`<Required("(>=2)")> : ...`) or a
 * nested markup-as-value body (`<Idle> : <button>x</button>`), exactly the
 * string-/angleDepth-awareness cases. We drive the LIVE front-end (splitBlocks
 * + buildAST), locate every `engine-decl` (with its verbatim `rulesRaw`) and
 * `match-block` (with its verbatim `armsRaw`), re-parse each body with the
 * statechild parsers to find arms whose `legacyColonPlacement` is true, rewrite
 * those arms inside the isolated body text, and splice the rewritten body back
 * at its absolute source offset (`source.indexOf(body, span.start)`). Splices
 * are applied right-to-left so earlier offsets stay valid; a verbatim re-find of
 * the original body at the recorded offset is the fail-safe.
 *
 * @param {string} source — raw source text
 * @param {string} filePath — for the block splitter's diagnostics
 * @returns {{ rewritten: string, changed: boolean, count: number }}
 */
export function rewriteColonShorthandPlacement(source, filePath) {
  let ast;
  try {
    const bs = splitBlocks(filePath, source);
    ({ ast } = buildAST(bs));
  } catch {
    return { rewritten: source, changed: false, count: 0 };
  }
  if (!ast || typeof ast !== "object") {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Collect a body-level rewrite per engine-decl / match-block: the absolute
  // source offset of the verbatim body text + the rewritten body.
  const bodyEdits = [];

  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }

    if (n.kind === "engine-decl" && typeof n.rulesRaw === "string" && n.rulesRaw.length > 0) {
      const start = n.span && typeof n.span.start === "number" ? n.span.start : 0;
      const at = source.indexOf(n.rulesRaw, start);
      if (at >= 0) {
        const entries = parseEngineStateChildren(n.rulesRaw);
        const legacyArms = entries.map((e) => ({
          openerStart: typeof e.rawOffset === "number" ? e.rawOffset : -1,
          legacy: e.legacyColonPlacement === true,
        }));
        const { rewritten, count } = rewriteColonPlacementInBody(n.rulesRaw, legacyArms);
        if (count > 0) bodyEdits.push({ at, original: n.rulesRaw, rewritten, armCount: count });
      }
    } else if (n.kind === "match-block" && typeof n.armsRaw === "string" && n.armsRaw.length > 0) {
      const start = n.span && typeof n.span.start === "number" ? n.span.start : 0;
      const at = source.indexOf(n.armsRaw, start);
      if (at >= 0) {
        const { arms } = parseMatchArms(n.armsRaw);
        const legacyArms = arms.map((a) => ({
          openerStart: typeof a.openerStart === "number" ? a.openerStart : -1,
          legacy: a.legacyColonPlacement === true,
        }));
        const { rewritten, count } = rewriteColonPlacementInBody(n.armsRaw, legacyArms);
        if (count > 0) bodyEdits.push({ at, original: n.armsRaw, rewritten, armCount: count });
      }
    }

    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      walk(n[k]);
    }
  };
  walk(ast);

  if (bodyEdits.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Apply right-to-left so earlier offsets stay valid. Verify the original body
  // still sits at the recorded offset (fail-safe — never clobber otherwise).
  // `count` reports the number of ARMS rewritten (one per legacy placement),
  // matching the per-arm W-COLON-SHORTHAND-LEGACY-PLACEMENT lint emission.
  bodyEdits.sort((a, b) => b.at - a.at);
  let rewritten = source;
  let count = 0;
  for (const { at, original, rewritten: newBody, armCount } of bodyEdits) {
    if (rewritten.slice(at, at + original.length) !== original) continue;
    rewritten = rewritten.slice(0, at) + newBody + rewritten.slice(at + original.length);
    count += armCount;
  }

  return { rewritten, changed: rewritten !== source, count };
}

// ---------------------------------------------------------------------------
// Migration 4 (server-keyword-eliminate) — strip the deprecated `server`
// keyword from `server function NAME(` declarations, but ONLY where it is
// SAFE: where the function STILL escalates server without it.
//
// `server function` and `function` are NOT synonyms — `server` is a server-
// vs-client EXECUTION boundary, not a no-op. A naive text rewrite would
// silently CLIENT-FLIP a security/auth/payment function (regress §10.4
// lift-permission, the §12.2 wire-chunk gate, MCP discovery). The safety
// comes from one clean compiler signal:
//
//   W-DEPRECATED-SERVER-MODIFIER (route-inference.ts Step 5d / D5) fires iff a
//   function is keyword-`server`-annotated AND has at least one NON-explicit-
//   annotation escalation reason (T1/T2/T3 body content, T5 caller-context,
//   T7 channel cell-write/broadcast, T8 reserved-name handle) — i.e. EXACTLY
//   when the keyword is REDUNDANT. So:
//     - lint FIRES on a `server function`  → dropping `server` keeps it server
//       (the other reason remains)         → SAFE to strip.
//     - lint does NOT fire on `server fn`  → pure-server pin → auto-preserved.
//     - lint does NOT fire on a keyword-only-no-trigger `server function`
//       (the pure/stub CLIENT-FLIP danger) → left untouched (correct).
//
// Migration 4 therefore strips `server ` at each W-DEPRECATED fire-site's
// `server function NAME(` declaration, with ONE explicit exclusion: never a
// generator `server function*` (SSE is DEFERRED to its own DD — and a SQL-
// bearing SSE WOULD fire W-DEPRECATED, so the `function*` exclusion is
// required, not belt-and-suspenders). Belt-and-suspenders: never `server fn`
// (the lint won't fire there anyway).
//
// This is a `--fix`-tier migration (it needs `result.warnings` from a staged
// compile, like the AST-driven rewrites), NOT a pure-text `applyMigrations`
// rule — a pure regex cannot distinguish an escalating `server function` from
// a keyword-only one and would client-flip the danger sites.
// ---------------------------------------------------------------------------

/**
 * Staged-compile the source IN PLACE (mirrors `sanityCheckParse`'s option-β
 * harness) and return the W-DEPRECATED-SERVER-MODIFIER diagnostics so
 * Migration 4 can locate the redundant-`server` declarations. The compile
 * must run from the file's real on-disk position so cross-file imports +
 * caller-context (T5) escalation resolve correctly.
 *
 * Returns the list of `{ span }` for each fire-site (the function-decl span;
 * `span.start` anchors the forward scan for the `server function NAME(`).
 * On any read/stage/compile failure, returns `[]` (fail closed — strip
 * nothing rather than strip blindly).
 *
 * @param {string} source — the (already W-* `:>`-migrated) source to analyse
 * @param {string} filePath — real on-disk path (for the import graph)
 * @returns {Array<{ span: { start: number, end: number } | null }>}
 */
function gatherDeprecatedServerWarnings(source, filePath) {
  let originalContent;
  try {
    originalContent = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let result;
  let stagingError = null;
  try {
    try {
      writeFileSync(filePath, source, "utf8");
    } catch (err) {
      stagingError = err;
    }
    if (!stagingError) {
      try {
        result = compileScrml({
          inputFiles: [filePath],
          write: false,
          gather: true,
          log: () => {},
        });
      } catch {
        return [];
      }
    }
  } finally {
    try {
      writeFileSync(filePath, originalContent, "utf8");
    } catch (restoreErr) {
      // Restoration failed; surface loudly — same contract as sanityCheckParse.
      throw new Error(
        `Migration 4 harness: failed to restore original content at ${filePath} ` +
        `(file may be left in staged state): ${restoreErr.message}`,
      );
    }
  }

  if (stagingError || !result) return [];

  // W-* diagnostics land in `result.warnings` (the W-/I- partition). Be
  // defensive and also scan `result.errors` in case a build routes a
  // warning-severity diagnostic there.
  const streams = [];
  if (Array.isArray(result.warnings)) streams.push(...result.warnings);
  if (Array.isArray(result.errors)) streams.push(...result.errors);

  const sites = [];
  for (const d of streams) {
    if (!d || d.code !== "W-DEPRECATED-SERVER-MODIFIER") continue;
    sites.push({ span: d.span ?? null });
  }
  return sites;
}

/**
 * Migration 4 — strip the redundant deprecated `server` keyword from
 * `server function NAME(` declarations that STILL escalate server without it
 * (proven by W-DEPRECATED-SERVER-MODIFIER firing on them).
 *
 * Diagnostic-driven (compile → collect fire-sites → span-rewrite), NOT a
 * pure-text regex (which cannot tell an escalating `server function` from a
 * keyword-only one — see the block comment above).
 *
 * The strip predicate, per fire-site `span.start`:
 *   1. Scan forward from `span.start`, skipping any `pure`/`async` modifier
 *      words + interleaving whitespace, to find the `server` keyword token.
 *      (`pure server function` / `async server function` are valid prefixes;
 *      the W-DEPRECATED span.start may sit on `pure`/`async`, not `server`.)
 *   2. Confirm the word immediately after `server` (one whitespace run) is
 *      the literal `function` keyword.
 *   3. EXCLUDE a generator: if the char after `function` (skipping nothing —
 *      `function*` has no gap) is `*`, do NOT strip. SSE is deferred.
 *   4. Belt-and-suspenders: if the keyword after `server` is `fn` (not
 *      `function`), do NOT strip. (The lint won't fire on `server fn`, but
 *      we never want a stray `server fn` stripped by a span coincidence.)
 *   5. Strip the `server` keyword + the single whitespace run that follows it,
 *      leaving `function NAME(`.
 *
 * Applied right-to-left so earlier offsets stay valid. A re-run on an
 * already-stripped `function NAME(` finds no W-DEPRECATED → no edit
 * (idempotent). The rewritten source is then re-verified by the standard
 * `sanityCheckParse` gate in `migrateFile`.
 *
 * @param {string} source — raw source text (post W-* `:>` migration)
 * @param {string} filePath — real on-disk path (for the import graph)
 * @returns {{ rewritten: string, changed: boolean, count: number }}
 */
export function rewriteServerFunctionKeyword(source, filePath) {
  const sites = gatherDeprecatedServerWarnings(source, filePath);
  if (sites.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  // A scrml identifier/keyword word char (for word-boundary scanning).
  const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);

  // From `from`, read the next contiguous word token (returns { word, start,
  // end }) or null if the next non-whitespace char is not a word char.
  const readWordAt = (from) => {
    let i = from;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length || !isWordChar(source[i])) return null;
    const start = i;
    while (i < source.length && isWordChar(source[i])) i++;
    return { word: source.slice(start, i), start, end: i };
  };

  // Collect one strip-edit per fire-site: the [server-start, function-start)
  // slice to delete (the `server` keyword + its trailing whitespace run).
  const edits = [];
  const seen = new Set();

  for (const { span } of sites) {
    const anchor = span && typeof span.start === "number" && span.start >= 0
      ? span.start
      : -1;
    if (anchor < 0) continue;

    // Walk past optional leading `pure`/`async` modifier words to reach
    // `server`. Stop after at most two modifier words (the closed prefix set).
    let cursor = anchor;
    let serverTok = null;
    for (let hops = 0; hops < 3; hops++) {
      const w = readWordAt(cursor);
      if (!w) break;
      if (w.word === "server") { serverTok = w; break; }
      if (w.word === "pure" || w.word === "async") { cursor = w.end; continue; }
      // Any other word at the anchor means this isn't a `[pure|async] server
      // function` decl shape — don't strip.
      break;
    }
    if (!serverTok) continue;

    // The token immediately after `server` must be the `function` keyword.
    const next = readWordAt(serverTok.end);
    if (!next) continue;
    if (next.word !== "function") {
      // `server fn` (or anything else) — never strip (belt-and-suspenders).
      continue;
    }

    // EXCLUDE the SSE generator `server function*`: a `*` immediately follows
    // `function` (the `*` is glued; `function *` is also possible — skip
    // whitespace to the `*`). DEFER per ruling 1.
    let k = next.end;
    while (k < source.length && /\s/.test(source[k])) k++;
    if (source[k] === "*") continue;

    // Strip [serverTok.start, next.start): the `server` keyword + the single
    // whitespace run that separates it from `function`.
    const delStart = serverTok.start;
    const delEnd = next.start;
    const key = `${delStart}:${delEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edits.push({ delStart, delEnd });
  }

  if (edits.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Apply right-to-left so earlier offsets stay valid. Fail-safe: confirm the
  // slice we're about to delete still reads `server` + whitespace.
  edits.sort((a, b) => b.delStart - a.delStart);
  let rewritten = source;
  let count = 0;
  for (const { delStart, delEnd } of edits) {
    const slice = rewritten.slice(delStart, delEnd);
    if (!/^server\s+$/.test(slice)) continue; // moved/clobbered — skip
    rewritten = rewritten.slice(0, delStart) + rewritten.slice(delEnd);
    count++;
  }

  return { rewritten, changed: rewritten !== source, count };
}


// ---------------------------------------------------------------------------
// Migration 5 (channel-server-publisher-eliminate — RULING A / Enhanced-A) —
// strip the deprecated `server` keyword from a `server function NAME(` CHANNEL
// PUBLISHER that read-modify-writes a channel-declared cell, so the publisher
// runs CLIENT-side (§38.4) and syncs via the auto-`__sync` reactive effect.
//
// Background (change-id `channel-cell-write-client-side-A-2026-06-12`, RULING A,
// S189): §12.2 Trigger 7a (channel-cell-WRITE escalation) was DROPPED — a
// channel-cell write is a CLIENT-side sync-emit (§38.4, §38.10). A legacy
// `server function` publisher that read-modify-writes a channel cell is
// therefore server-PLACED by the `server` keyword ALONE, and its server-side
// READ of the client-held cell fires E-CHANNEL-SERVER-CELL-READ (§34, §38.4).
// The canonical fix is to drop `server` → the publisher becomes a plain
// client-side `function` (exactly the onclient Bug-2b shape, §38.10) → the cell
// read is a valid client-held read → the error clears. Minimal-A (S189) left
// this MANUAL (Enhanced-A deferred); THIS migration is Enhanced-A.
//
// SAFETY — strip ONLY where dropping `server` actually FIXES the error, i.e.
// where the `server` keyword is the SOLE server-placement reason. The
// discriminator is the INVERSE of Migration 4's W-DEPRECATED signal:
//   - E-CHANNEL-SERVER-CELL-READ fires on the fn (a channel-cell read in a
//     server-context body), AND
//   - W-DEPRECATED-SERVER-MODIFIER does NOT fire on the fn.
// W-DEPRECATED fires iff a NON-keyword escalation reason exists (T1/T2/T3 body,
// T5 caller-context, T7 broadcast/disconnect, T8 reserved-name handle). Its
// ABSENCE on an E-CHANNEL-firing `server function` proves the keyword is the
// sole reason → stripping declassifies the fn to the client → the read becomes
// a valid client-held read → the error clears. If W-DEPRECATED DOES fire (a
// broadcast()/disconnect()- or SQL-escalated publisher that ALSO reads a cell),
// stripping leaves the fn server (Migration 4 handles the now-redundant
// keyword) and the E-CHANNEL error PERSISTS — that case needs a manual payload
// rewrite (§38.6.1), NOT a keyword strip. Generators (`server function*`, SSE)
// are excluded, mirroring Migration 4.
//
// Like Migration 4 this is a `--fix`-tier, DIAGNOSTIC-driven migration (it
// staged-compiles to collect the fire-sites) — a pure-text regex cannot tell a
// keyword-sole channel publisher from a broadcast/SQL-escalated one and would
// leave a dangling error or mis-strip.
// ---------------------------------------------------------------------------

/**
 * Staged-compile the source IN PLACE (mirrors `gatherDeprecatedServerWarnings`)
 * and return BOTH the E-CHANNEL-SERVER-CELL-READ fire-sites (the channel-cell
 * READ spans, inside the offending function body) AND the
 * W-DEPRECATED-SERVER-MODIFIER fire-sites (the decl-anchored spans) from ONE
 * compile, so Migration 5 can apply the keyword-sole discriminator without a
 * second staged compile. On any read/stage/compile failure, returns empty
 * arrays (fail closed — strip nothing rather than strip blindly).
 *
 * @param {string} source — the (already W-* `:>`-migrated) source to analyse
 * @param {string} filePath — real on-disk path (for the import graph)
 * @returns {{ chanSites: Array<{ span: { start: number } | null }>,
 *             wdepSites: Array<{ span: { start: number } | null }> }}
 */
function gatherChannelServerCellReadSites(source, filePath) {
  let originalContent;
  try {
    originalContent = readFileSync(filePath, "utf8");
  } catch {
    return { chanSites: [], wdepSites: [] };
  }

  let result;
  let stagingError = null;
  try {
    try {
      writeFileSync(filePath, source, "utf8");
    } catch (err) {
      stagingError = err;
    }
    if (!stagingError) {
      try {
        result = compileScrml({
          inputFiles: [filePath],
          write: false,
          gather: true,
          log: () => {},
        });
      } catch {
        return { chanSites: [], wdepSites: [] };
      }
    }
  } finally {
    try {
      writeFileSync(filePath, originalContent, "utf8");
    } catch (restoreErr) {
      // Restoration failed; surface loudly — same contract as sanityCheckParse.
      throw new Error(
        `Migration 5 harness: failed to restore original content at ${filePath} ` +
        `(file may be left in staged state): ${restoreErr.message}`,
      );
    }
  }

  if (stagingError || !result) return { chanSites: [], wdepSites: [] };

  // E-CHANNEL is an Error (result.errors); W-DEPRECATED is a Warning
  // (result.warnings). Scan both streams defensively (cross-stream partition).
  const streams = [];
  if (Array.isArray(result.warnings)) streams.push(...result.warnings);
  if (Array.isArray(result.errors)) streams.push(...result.errors);

  const chanSites = [];
  const wdepSites = [];
  for (const d of streams) {
    if (!d) continue;
    if (d.code === "E-CHANNEL-SERVER-CELL-READ") chanSites.push({ span: d.span ?? null });
    else if (d.code === "W-DEPRECATED-SERVER-MODIFIER") wdepSites.push({ span: d.span ?? null });
  }
  return { chanSites, wdepSites };
}

/**
 * Migration 5 — strip the deprecated `server` keyword from a `server function
 * NAME(` channel publisher whose server-side channel-cell READ fires
 * E-CHANNEL-SERVER-CELL-READ AND on which W-DEPRECATED-SERVER-MODIFIER does NOT
 * fire (i.e. the keyword is the SOLE server-placement reason — stripping
 * declassifies the fn to the client and CLEARS the error). See the block
 * comment above for the safety rationale.
 *
 * Per declaration, the strip predicate is:
 *   1. Enumerate every `[pure|async] server function [*]NAME(...) { ... }` decl
 *      with its header range `[headerStart, bodyOpen)` and body range
 *      `[bodyOpen, bodyEnd)` (via brace matching).
 *   2. EXCLUDE a generator (`server function*`) — SSE is deferred (Migration 4
 *      parity).
 *   3. readsCell: an E-CHANNEL read span falls within `[headerStart, bodyEnd)`
 *      (the read statement is in the body; the `record.fnNode.span` fallback is
 *      at the header — both covered).
 *   4. keywordRedundant: a W-DEPRECATED span falls within `[headerStart,
 *      bodyOpen)` (the decl header). If so, this is a Migration-4 site (another
 *      escalation reason present) — stripping would NOT clear the channel read
 *      error → skip.
 *   5. Strip `[serverStart, functionStart)` — the `server` keyword + the single
 *      whitespace run that follows it, leaving `function NAME(`.
 *
 * Applied right-to-left so earlier offsets stay valid, with a `^server\s+$`
 * fail-safe on each slice. A re-run on the stripped `function NAME(` finds no
 * E-CHANNEL (it is now client-side) → no edit (idempotent). The rewritten
 * source is re-verified by the `sanityCheckParse` gate in `migrateFile`.
 *
 * @param {string} source — raw source text (post W-* `:>` migration)
 * @param {string} filePath — real on-disk path (for the import graph)
 * @returns {{ rewritten: string, changed: boolean, count: number }}
 */
export function rewriteChannelServerPublisher(source, filePath) {
  const { chanSites, wdepSites } = gatherChannelServerCellReadSites(source, filePath);
  if (chanSites.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);

  // Enumerate every `[pure|async] server function [*]NAME(...) { ... }` decl.
  const decls = [];
  let scan = 0;
  while (true) {
    const idx = source.indexOf("server", scan);
    if (idx === -1) break;
    scan = idx + "server".length;

    // `server` must be a standalone word (not a substring like `myserver`).
    const before = idx > 0 ? source[idx - 1] : "";
    if (before && isWordChar(before)) continue;
    if (isWordChar(source[idx + "server".length] || "")) continue;

    // The next word must be the `function` keyword.
    let i = idx + "server".length;
    while (i < source.length && /\s/.test(source[i])) i++;
    const fnStart = i;
    let j = i;
    while (j < source.length && isWordChar(source[j])) j++;
    if (source.slice(fnStart, j) !== "function") continue;

    // EXCLUDE a generator `server function*` (SSE — deferred, Migration 4 parity).
    let k = j;
    while (k < source.length && /\s/.test(source[k])) k++;
    if (source[k] === "*") continue;

    // Skip NAME, then the param list `(...)`, then locate the body `{`.
    while (k < source.length && isWordChar(source[k])) k++; // NAME
    while (k < source.length && /\s/.test(source[k])) k++;
    if (source[k] !== "(") continue;
    let depth = 0;
    let q = k;
    for (; q < source.length; q++) {
      const ch = source[q];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) { q++; break; } }
    }
    while (q < source.length && /\s/.test(source[q])) q++;
    if (source[q] !== "{") continue;
    const bodyOpen = q;
    const bodyEnd = skipBracedBlock(source, bodyOpen);
    if (bodyEnd === -1) continue;

    // Header start: walk back over a preceding `pure`/`async` modifier word so a
    // W-DEPRECATED span anchored on the modifier still maps to this decl.
    let headerStart = idx;
    for (let hops = 0; hops < 2; hops++) {
      let b = headerStart - 1;
      while (b >= 0 && /\s/.test(source[b])) b--;
      const wordEnd = b + 1;
      while (b >= 0 && isWordChar(source[b])) b--;
      const w = source.slice(b + 1, wordEnd);
      if (w === "pure" || w === "async") headerStart = b + 1;
      else break;
    }

    decls.push({ serverStart: idx, functionStart: fnStart, headerStart, bodyOpen, bodyEnd });
  }

  const within = (pos, lo, hi) =>
    typeof pos === "number" && pos >= lo && pos < hi;

  const edits = [];
  for (const decl of decls) {
    const readsCell = chanSites.some(
      (s) => s.span && within(s.span.start, decl.headerStart, decl.bodyEnd),
    );
    if (!readsCell) continue;
    const keywordRedundant = wdepSites.some(
      (s) => s.span && within(s.span.start, decl.headerStart, decl.bodyOpen),
    );
    if (keywordRedundant) continue; // Migration-4 site — a strip won't clear the read error.
    edits.push({ delStart: decl.serverStart, delEnd: decl.functionStart });
  }

  if (edits.length === 0) {
    return { rewritten: source, changed: false, count: 0 };
  }

  // Apply right-to-left so earlier offsets stay valid; confirm each slice still
  // reads `server` + whitespace before deleting.
  edits.sort((a, b) => b.delStart - a.delStart);
  let rewritten = source;
  let count = 0;
  for (const { delStart, delEnd } of edits) {
    const slice = rewritten.slice(delStart, delEnd);
    if (!/^server\s+$/.test(slice)) continue; // moved/clobbered — skip
    rewritten = rewritten.slice(0, delStart) + rewritten.slice(delEnd);
    count++;
  }

  return { rewritten, changed: rewritten !== source, count };
}

// ---------------------------------------------------------------------------
// v0.3 program-shape migration (SPEC §40.8) — classification + rewrite
// ---------------------------------------------------------------------------

/**
 * Per-route attributes allowed on `<page>` per SPEC §4.15 + §40.8 row.
 * Source-of-truth: the four PER-ROUTE concerns.
 */
const PER_ROUTE_ATTRS = new Set(["db", "auth", "csrf", "ratelimit"]);

/**
 * App-wide attributes — these belong on `<program>` per SPEC §40.8.
 * If a `<program>` opener carries ONLY per-route attrs (and none of these),
 * it is a candidate for `<program>` → `<page>` rewrite when classified as
 * a route file. If it carries MIXED (per-route + app-wide), surface to
 * `--report` and SKIP the rewrite (the author must split manually).
 */
const APP_WIDE_ATTRS = new Set([
  // §40.7 documentary
  "title", "description", "version", "author", "license",
  // §40.2 + §38.3.1 middleware
  "cors", "cors-max-age", "log", "headers",
  "idempotency-store", "idempotency-ttl",
  "channel-reconnect",
  // §43 nested-program attrs (also app-/process-scope)
  "name", "lang", "mode", "build", "port", "health",
  "protect", "callchar", "restart", "max-restarts",
  "within", "autostart",
]);

/**
 * Match the file-top `<program ...>` opener (NOT close tag, NOT nested).
 *
 * We scan from the top of the file, skipping blank lines and single-line
 * scrml/HTML comments (`//`, `<!--...-->`), and match the FIRST opener.
 * Returns `{ name, attrs, openerStart, openerEnd, attrsRaw }` or null.
 *
 * `attrs` is an array of `{name, value, raw, valueStart}` for each attribute
 * found. We keep parsing lightweight — regex-based — because the migrate
 * command runs PRE-parse (we don't have the AST at this point).
 *
 * @param {string} source
 * @returns {{name: string, attrs: Array<{name: string}>, openerStart: number, openerEnd: number, attrsRaw: string} | null}
 */
function findFileTopOpener(source) {
  // Skip a BOM if present.
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  // Skip leading whitespace, `//` line comments, `<!--...-->` block comments,
  // and `${...}` logic blocks (legacy v0.2 file-top wrapper shape that v0.3
  // discourages but the migrate command must still tolerate when classifying).
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      // Line comment — skip to EOL.
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === "<" && source[i + 1] === "!" && source[i + 2] === "-" && source[i + 3] === "-") {
      const end = source.indexOf("-->", i + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (ch === "$" && source[i + 1] === "{") {
      // Skip past the matching `}` (brace-balanced, quote-aware).
      const close = findMatchingDollarClose(source, i);
      if (close === -1) return null;
      i = close + 1;
      continue;
    }
    break;
  }

  if (i >= source.length) return null;
  if (source[i] !== "<") return null;

  // Match an opener: `<identifier ... >` (skip close tags `</...>`).
  if (source[i + 1] === "/") return null;

  const openerStart = i;
  // Match identifier (allow alphanumeric + `-` since scrml uses kebab none here but be permissive).
  let j = i + 1;
  // Allow optional whitespace after `<` (the existing W-WHITESPACE-001 path,
  // but we treat that as still-valid input — we don't refuse to classify
  // a file whose `<program>` opener still has leading whitespace).
  while (j < source.length && (source[j] === " " || source[j] === "\t")) j++;
  const nameStart = j;
  while (j < source.length && /[A-Za-z0-9_-]/.test(source[j])) j++;
  if (j === nameStart) return null;
  const name = source.slice(nameStart, j);

  // Find the closing `>` of the opener. Watch out for `=...` attrs with
  // quoted values that may contain `>`. We track a quote state.
  let openerEnd = -1;
  let q = null;
  while (j < source.length) {
    const ch = source[j];
    if (q) {
      if (ch === q) q = null;
      j++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      j++;
      continue;
    }
    if (ch === ">") {
      openerEnd = j;
      break;
    }
    j++;
  }
  if (openerEnd === -1) return null;

  // Extract the attrs region — between end-of-name and `>`. Strip a trailing
  // `/` if present (self-closing form).
  let attrsRaw = source.slice(nameStart + name.length, openerEnd);
  // Self-closing `<x .../>` has a trailing `/`; strip it from attrs region.
  attrsRaw = attrsRaw.replace(/\/\s*$/, "");

  const attrs = parseAttrsRaw(attrsRaw);

  return { name, attrs, openerStart, openerEnd, attrsRaw };
}

/**
 * Lightweight attribute parser for opener attrs. Returns a list of `{name}`
 * objects. We don't need values for classification — we only need the names.
 *
 * Handles: `attr`, `attr=value`, `attr="value"`, `attr='value'`. Skips
 * leading/trailing whitespace.
 *
 * @param {string} raw
 * @returns {Array<{name: string}>}
 */
function parseAttrsRaw(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    // Skip whitespace.
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;
    // Read attr name.
    const nameStart = i;
    while (i < raw.length && /[A-Za-z0-9_-]/.test(raw[i])) i++;
    if (i === nameStart) {
      // No name — bail.
      i++;
      continue;
    }
    const name = raw.slice(nameStart, i);
    // Skip whitespace before `=` or next attr.
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i < raw.length && raw[i] === "=") {
      i++; // consume `=`
      while (i < raw.length && /\s/.test(raw[i])) i++;
      // Skip the value.
      if (i < raw.length && (raw[i] === '"' || raw[i] === "'")) {
        const q = raw[i];
        i++;
        while (i < raw.length && raw[i] !== q) i++;
        if (i < raw.length) i++; // consume closing quote
      } else {
        // Unquoted value — read until whitespace.
        while (i < raw.length && !/\s/.test(raw[i])) i++;
      }
    }
    out.push({ name });
  }
  return out;
}

/**
 * Classify a `.scrml` file into one of five buckets per SPEC §40.8 +
 * page-helper-design.md Phase 2.1:
 *
 * - **entry**         — file contains a top-level `<program ...>` opener AND
 *                       is NOT located under a `pages/**` or `routes/**` parent.
 * - **route**         — file path matches `pages/**` or `routes/**` and the
 *                       basename is not `_layout.scrml`. (May or may not have
 *                       `<program>` — the rewrite handler decides what to do
 *                       based on the opener content.)
 * - **module**        — no `<program>` opener at file top AND not under
 *                       `pages/**` / `routes/**`. Module-shape: exports +
 *                       helpers + components, no app-wide markup wrapper.
 * - **schema-anchor** — file contains a `<schema>` block AND a `<program db=>`
 *                       wrapper. SPECIAL: per §39.12.0 v0.3 workaround, left
 *                       alone (advisory only in `--report`).
 * - **ambiguous**     — heuristic returns multi-bucket; surface to `--report`
 *                       and SKIP rewrite.
 *
 * @param {string} absPath — absolute file path
 * @param {string} sourceText
 * @param {string} projectRoot — absolute project root (used for relative-path
 *                               classification)
 * @returns {{bucket: string, evidence: string[]}}
 */
export function classifyFile(absPath, sourceText, projectRoot) {
  const evidence = [];
  const rel = projectRoot
    ? relative(projectRoot, absPath).split(sep).join("/")
    : absPath.split(sep).join("/");

  // Normalize: lower-case path-segment check (case-sensitive on the filename
  // itself, but the `pages/` / `routes/` directory convention is case-fixed).
  const pathSegments = rel.split("/");
  const inPages = pathSegments.includes("pages");
  const inRoutes = pathSegments.includes("routes");
  const isLayoutFile = pathSegments[pathSegments.length - 1] === "_layout.scrml";

  // Content-level checks.
  const hasSchemaBlock = /<\s*schema\b[\s>/]/.test(sourceText);
  // Detect a file-top `<program ...>` opener (skipping comments/whitespace).
  const opener = findFileTopOpener(sourceText);
  const hasProgramOpener = !!opener && opener.name === "program";
  const hasPageOpener = !!opener && opener.name === "page";

  // Schema-anchor check: `<schema>` present + `<program db=>` wrapper.
  if (hasSchemaBlock && hasProgramOpener) {
    const hasDbAttr = opener.attrs.some((a) => a.name === "db");
    if (hasDbAttr) {
      evidence.push("contains `<schema>` block");
      evidence.push("file-top opener is `<program db=...>` (db-anchor)");
      return { bucket: "schema-anchor", evidence };
    }
  }

  // Route file: under pages/ or routes/, not a _layout.
  if ((inPages || inRoutes) && !isLayoutFile) {
    evidence.push(
      inPages ? "located under `pages/`" : "located under `routes/`"
    );
    if (hasProgramOpener) {
      evidence.push("file-top opener is `<program ...>`");
    } else if (hasPageOpener) {
      evidence.push("file-top opener is `<page ...>` (already v0.3 shape)");
    } else if (opener) {
      evidence.push(`file-top opener is \`<${opener.name}...>\``);
    } else {
      evidence.push("no recognizable file-top structural opener");
    }
    return { bucket: "route", evidence };
  }

  // Entry file: `<program ...>` at top, not under pages/routes/.
  if (hasProgramOpener) {
    evidence.push("file-top opener is `<program ...>`");
    if (inPages || inRoutes) {
      // Ambiguous: under pages/routes/ AND has <program> — but we already
      // returned "route" above for the (inPages||inRoutes)&&!isLayoutFile
      // branch. If we got here, it's a _layout.scrml under pages — that's a
      // route convention layout file; mark ambiguous.
      evidence.push("but located under pages/ or routes/ (ambiguous)");
      return { bucket: "ambiguous", evidence };
    }
    return { bucket: "entry", evidence };
  }

  // Module file: no <program> wrapper, not a route file.
  evidence.push("no file-top `<program>` opener");
  if (opener) {
    evidence.push(`file-top opener is \`<${opener.name}...>\``);
  } else {
    evidence.push("no recognizable file-top structural opener");
  }
  return { bucket: "module", evidence };
}

/**
 * Apply v0.3 program-shape rewrites per bucket. See SPEC §40.8 + brief §3.3.2.
 *
 * Bucket-by-bucket behavior:
 *
 * - **entry**:
 *   - Preserve `<program ...>` opener verbatim.
 *   - If the entry file has a file-top `${...}` block OUTSIDE `<program>`,
 *     surface as ADVISORY (user must move it manually).
 *   - Inside `<program>` body: if a top-level `${...}` block contains ONLY
 *     recognized top-level declarations (V5-strict decls, function, fn, type,
 *     const, let, etc.), UNWRAP — the declarations become direct text
 *     children of `<program>` (the §40.8 default-logic body shape).
 *   - Otherwise leave wrapped + advisory.
 *
 * - **route**:
 *   - If opener is `<program ...>` with ONLY per-route attrs: REWRITE
 *     `<program` → `<page` (opener and matching close tag).
 *   - If opener is `<program ...>` with MIXED attrs: SKIP; advisory.
 *   - If opener is `<page ...>` already: no-op (idempotent).
 *   - If opener is something else: SKIP; advisory.
 *
 * - **module**:
 *   - Leave alone. If a `<program>` wrapper is present, advisory only (no
 *     automatic strip in Wave 2 — defer to Wave 3 sweep).
 *
 * - **schema-anchor**:
 *   - Leave alone (per §39.12.0); advisory only ("v0.3 workaround; v0.4 will
 *     promote `<schema db=>` direct").
 *
 * - **ambiguous**:
 *   - SKIP + advisory.
 *
 * @param {string} source
 * @param {{bucket: string, evidence: string[]}} classification
 * @returns {{rewritten: string, changed: boolean, advisories: Array<{level: string, message: string, hint?: string}>, action: string}}
 */
export function applyProgramShapeRewrite(source, classification) {
  const advisories = [];
  const bucket = classification.bucket;

  if (bucket === "schema-anchor") {
    advisories.push({
      level: "info",
      message:
        "schema-anchor file uses `<program db=>` v0.3 workaround (SPEC §39.12.0).",
      hint:
        "v0.4 will promote `<schema db=>` direct; the wrapper will be removed automatically when v0.4 ships. No action needed now.",
    });
    return { rewritten: source, changed: false, advisories, action: "ADVISORY" };
  }

  if (bucket === "module") {
    const opener = findFileTopOpener(source);
    if (opener && opener.name === "program") {
      advisories.push({
        level: "warn",
        message:
          "module-shape file carries a `<program ...>` wrapper. Under v0.3 one-program-per-application (SPEC §40.8), only the entry file declares `<program>`.",
        hint:
          "Manually strip the wrapper, leaving the file as a pure module (exports + helpers + components). Wave 3 sweep will not auto-strip (deferred).",
      });
    }
    return { rewritten: source, changed: false, advisories, action: "ADVISORY" };
  }

  if (bucket === "ambiguous") {
    advisories.push({
      level: "warn",
      message:
        "file classification is ambiguous (e.g. `<program>` under `pages/` named `_layout.scrml`).",
      hint:
        "Inspect the file manually and migrate by hand. The migrate command requires unambiguous bucket assignment to rewrite.",
    });
    return { rewritten: source, changed: false, advisories, action: "SKIP" };
  }

  if (bucket === "route") {
    const opener = findFileTopOpener(source);
    if (!opener) {
      advisories.push({
        level: "info",
        message:
          "route file has no file-top structural opener; no rewrite possible.",
      });
      return { rewritten: source, changed: false, advisories, action: "SKIP" };
    }
    if (opener.name === "page") {
      // Already v0.3 shape — idempotent no-op.
      return {
        rewritten: source,
        changed: false,
        advisories,
        action: "NOOP",
      };
    }
    if (opener.name !== "program") {
      advisories.push({
        level: "info",
        message: `route file file-top opener is \`<${opener.name}...>\`; not a `+
          `\`<program>\`-shaped route. Skipping rewrite.`,
        hint:
          "If this file should be a route, ensure the file-top opener is `<page ...>` (v0.3 shape) or `<program ...>` (legacy v0.2 shape eligible for rewrite).",
      });
      return { rewritten: source, changed: false, advisories, action: "SKIP" };
    }

    // Opener is `<program ...>`. Classify its attrs.
    const attrNames = opener.attrs.map((a) => a.name);
    const perRouteAttrs = attrNames.filter((n) => PER_ROUTE_ATTRS.has(n));
    const appWideAttrs = attrNames.filter((n) => APP_WIDE_ATTRS.has(n));
    const unknownAttrs = attrNames.filter(
      (n) => !PER_ROUTE_ATTRS.has(n) && !APP_WIDE_ATTRS.has(n)
    );

    if (appWideAttrs.length > 0) {
      advisories.push({
        level: "warn",
        message:
          `route file's \`<program>\` opener carries app-wide attrs `+
          `(${appWideAttrs.join(", ")}) mixed with `+
          `${perRouteAttrs.length > 0 ? `per-route attrs (${perRouteAttrs.join(", ")})` : "no per-route attrs"}. `+
          `Cannot auto-split.`,
        hint:
          "Manually split: move app-wide attrs to the entry file's `<program>`; keep only `{db, auth, csrf, ratelimit}` on this file (then re-run with `--program-shape`).",
      });
      return { rewritten: source, changed: false, advisories, action: "SKIP" };
    }

    // Pure per-route (or empty) attrs: REWRITE `<program` → `<page` at the
    // opener, AND rewrite the matching close tag `</program>` → `</page>`.
    // Both rewrites need to happen exactly once at known sites. Close tag
    // `</>` (close-elision) is preserved as-is.
    if (unknownAttrs.length > 0) {
      advisories.push({
        level: "info",
        message:
          `route file's \`<program>\` opener carries unrecognized attrs `+
          `(${unknownAttrs.join(", ")}); rewriting opener to \`<page>\` `+
          `but downstream may emit E-PAGE-INVALID-ATTR on these.`,
      });
    }

    const rewritten = rewriteProgramToPage(source, opener);
    if (rewritten === source) {
      // No-op fallback (shouldn't generally happen).
      return { rewritten, changed: false, advisories, action: "NOOP" };
    }
    return {
      rewritten,
      changed: true,
      advisories,
      action: "REWRITE",
    };
  }

  if (bucket === "entry") {
    // Entry file: preserve `<program ...>` opener; check for file-top `${...}`
    // OUTSIDE `<program>` and emit advisory; UNWRAP `${...}` inside the program
    // body if its content is ALL top-level decls.
    const opener = findFileTopOpener(source);
    if (!opener || opener.name !== "program") {
      // Should not happen for "entry" bucket, but defensive.
      return { rewritten: source, changed: false, advisories, action: "SKIP" };
    }

    // Find file-top `${...}` OUTSIDE `<program>` — between start-of-file and
    // openerStart.
    const preOpener = source.slice(0, opener.openerStart);
    if (/\$\{/.test(preOpener)) {
      advisories.push({
        level: "warn",
        message:
          "entry file has a `${...}` logic block ABOVE the `<program>` opener.",
        hint:
          "Move the `${...}` block contents INSIDE the `<program>` body. The migrate command does not auto-move pre-`<program>` logic blocks.",
      });
    }

    // Inside `<program>` body: find the matching `</program>` close tag (or
    // `</>` close-elision sibling — we conservatively use `</program>` since
    // close-elision is unambiguous only in context).
    const bodyStart = opener.openerEnd + 1;
    const closeMatch = findMatchingProgramClose(source, bodyStart);
    if (closeMatch === -1) {
      // Couldn't find the matching close — bail without rewriting.
      advisories.push({
        level: "info",
        message:
          "entry file's `<program>` close tag not found (close-elision or malformed); skipping body-unwrap pass.",
      });
      return { rewritten: source, changed: false, advisories, action: "SKIP" };
    }
    const body = source.slice(bodyStart, closeMatch);

    const unwrapResult = unwrapRedundantLogicBlocks(body);
    if (!unwrapResult.changed) {
      return {
        rewritten: source,
        changed: false,
        advisories: advisories.concat(unwrapResult.advisories),
        action: advisories.length > 0 ? "ADVISORY" : "NOOP",
      };
    }
    const rewritten =
      source.slice(0, bodyStart) +
      unwrapResult.rewritten +
      source.slice(closeMatch);
    return {
      rewritten,
      changed: true,
      advisories: advisories.concat(unwrapResult.advisories),
      action: "REWRITE",
    };
  }

  // Fall-through (unknown bucket).
  return { rewritten: source, changed: false, advisories, action: "SKIP" };
}

/**
 * Rewrite `<program ...>` opener and its matching `</program>` close tag to
 * `<page ...>` / `</page>`. Preserves attrs verbatim. Does NOT touch `</>`
 * close-elision sibling — those are syntactic neutrals.
 *
 * @param {string} source
 * @param {{name: string, openerStart: number, openerEnd: number}} opener
 * @returns {string}
 */
function rewriteProgramToPage(source, opener) {
  // The opener begins with `<` followed by optional whitespace then `program`.
  // We want to rewrite the IDENTIFIER `program` to `page` at the opener site.
  const beforeOpener = source.slice(0, opener.openerStart);
  const openerSlice = source.slice(opener.openerStart, opener.openerEnd + 1);
  // Replace exactly one occurrence of `program` in the opener slice (the
  // identifier — should be the first identifier-like token after `<`).
  const newOpenerSlice = openerSlice.replace(/^<(\s*)program\b/, "<$1page");
  if (newOpenerSlice === openerSlice) return source;

  const afterOpener = source.slice(opener.openerEnd + 1);

  // Find the matching `</program>` close tag in afterOpener. We use the
  // same nesting-aware scan to avoid mis-pairing on nested `<program>` (e.g.
  // §43 worker) — though Wave 2 explicitly does not handle nested.
  const closeIdx = findMatchingProgramClose(afterOpener, 0);
  if (closeIdx === -1) {
    // No explicit close tag (close-elision); just rewrite opener.
    return beforeOpener + newOpenerSlice + afterOpener;
  }

  // The matching close tag spans `</program>` — rewrite to `</page>`.
  // closeIdx points at the `<` of `</program>` (per findMatchingProgramClose).
  // Length of `</program>` is 10.
  const beforeClose = afterOpener.slice(0, closeIdx);
  const closeSlice = afterOpener.slice(closeIdx, closeIdx + "</program>".length);
  const afterClose = afterOpener.slice(closeIdx + "</program>".length);
  if (closeSlice !== "</program>") {
    // Defensive — shouldn't happen if findMatchingProgramClose is correct.
    return beforeOpener + newOpenerSlice + afterOpener;
  }
  return (
    beforeOpener +
    newOpenerSlice +
    beforeClose +
    "</page>" +
    afterClose
  );
}

/**
 * Find the matching `</program>` close tag in `source` starting from offset
 * `start`. Tracks nesting on `<program ...>` openers to handle nested
 * `<program>` blocks (§43 worker form). Returns the absolute index of `<`
 * of the matching close tag, or -1 if not found.
 *
 * NOTE: we use this for BOTH the entry-file body unwrap pass AND the
 * route-file rewrite pass. The function is conservative: it does NOT
 * resolve `</>` close-elision (which is permitted scrml syntax; an explicit
 * `</program>` is the only shape we can safely rewrite).
 *
 * @param {string} source
 * @param {number} start
 * @returns {number}
 */
function findMatchingProgramClose(source, start) {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch !== "<") {
      i++;
      continue;
    }
    // Skip strings / `${...}` carefully — but for `</program>` detection we
    // just need to avoid matching `<` inside attribute values. We track quote
    // state on `<...>` parses only. Keep it simple: look for the exact
    // sequences `<program ` / `<program>` / `<program/` / `</program>`.
    if (source.startsWith("</program>", i)) {
      depth--;
      if (depth === 0) return i;
      i += "</program>".length;
      continue;
    }
    // Detect a NESTED `<program>` opener — increment depth.
    if (
      source.startsWith("<program", i) &&
      i + "<program".length < source.length &&
      /[\s>/]/.test(source[i + "<program".length])
    ) {
      depth++;
      i += "<program".length;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Inside an entry file's `<program>` body, find top-level `${...}` blocks
 * whose content is ENTIRELY recognized top-level declarations (state-decl,
 * derived-decl, function, fn, type, plain const/let), and unwrap them so the
 * declarations sit directly in the `<program>` body (the §40.8 default-logic
 * body shape).
 *
 * Conservative: if a `${...}` block contains anything other than recognized
 * top-level declarations (e.g. imperative statements, control flow, calls),
 * leave it wrapped + emit an `info` advisory.
 *
 * @param {string} body — the contents between `<program ...>` opener-end and
 *                        `</program>` close-start (or close-elision boundary).
 * @returns {{rewritten: string, changed: boolean, advisories: Array}}
 */
function unwrapRedundantLogicBlocks(body) {
  const advisories = [];
  let changed = false;
  let result = "";
  let i = 0;

  // v0.3 Wave 3.5 (S87) — container-depth tracking.
  //
  // Bug A (Cat B in RECON-S87): the original heuristic looked backward for the
  // most recent `>` and considered `${...}` "top-level" if only whitespace
  // followed. False-fired inside nested containers (`<db>`, `<ul>`, `<channel>`,
  // etc) — `>` could close an OPENER tag, leaving the `${...}` inside the
  // container body, not at program-body top level. Result: E-CTX-001 / E-CTX-003
  // on parse because BS auto-lift only fires inside `<program>` / `<page>` /
  // `<channel>` bodies, not arbitrary structural containers.
  //
  // Fix: walk the body as a mini-parser, tracking markup-container depth
  // (incremented on `<X ...>`, decremented on `</X>` or `</>`). Only consider
  // `${...}` for unwrap when at depth 0 (immediate program-body level).
  //
  // The walker also skips contents of `${...}`, `?{...}`, `#{...}`, quoted
  // strings, and comments so they don't perturb depth tracking.
  let markupDepth = 0;

  while (i < body.length) {
    const ch = body[i];

    // Skip line comments (in markup-text position, BS treats `//` as comment
    // block-separators, but in attribute-value position they're string content).
    // Conservative: skip in both cases — we only need to recognize `${` and
    // markup container open/close.
    if (ch === "/" && body[i + 1] === "/") {
      const nl = body.indexOf("\n", i);
      const end = nl === -1 ? body.length : nl + 1;
      result += body.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      const stop = end === -1 ? body.length : end + 2;
      result += body.slice(i, stop);
      i = stop;
      continue;
    }

    // Skip nested logic / SQL / CSS blocks (don't recurse — preserve them
    // verbatim and continue walking after). Note: nested `${...}` blocks at
    // markup-depth > 0 are SKIPPED (no unwrap consideration); nested at
    // markup-depth = 0 might be eligible but only the OUTERMOST `${...}` at a
    // given site is processed (we continue past the close).
    if (ch === "?" && body[i + 1] === "{") {
      const closeIdx = findMatchingDollarClose(body, i - 0); // ?{ has same brace shape as ${
      // Actually `?{...}` uses same brace-matching as `${...}` from `findMatchingDollarClose`
      // which expects the brace-opener at `dollarIdx + 2`. Adapt: pass i-1 as if `$?{` started 1 earlier.
      // Simpler: write a local skip.
      const close = skipBracedBlock(body, i + 1);
      if (close === -1) {
        result += body.slice(i);
        break;
      }
      result += body.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (ch === "#" && body[i + 1] === "{") {
      const close = skipBracedBlock(body, i + 1);
      if (close === -1) {
        result += body.slice(i);
        break;
      }
      result += body.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    // Quoted strings — skip contents.
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      const start = i;
      i++;
      while (i < body.length && body[i] !== q) {
        if (body[i] === "\\") i++;
        i++;
      }
      i = Math.min(i + 1, body.length);
      result += body.slice(start, i);
      continue;
    }

    // `${...}` logic block — the only thing we may unwrap.
    if (ch === "$" && body[i + 1] === "{") {
      const dollarIdx = i;
      const closeIdx = findMatchingDollarClose(body, dollarIdx);
      if (closeIdx === -1) {
        // Unmatched — emit rest and bail.
        result += body.slice(i);
        break;
      }

      // Container-aware gate (Bug A): only consider unwrap at markup-depth 0.
      if (markupDepth > 0) {
        // Inside a nested markup container — preserve the `${...}` verbatim.
        result += body.slice(dollarIdx, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }

      // At program-body top level — apply the existing safety gates.
      const inner = body.slice(dollarIdx + 2, closeIdx);
      if (isTopLevelDeclOnly(inner) && isUnwrapSafe(inner)) {
        result += inner;
        changed = true;
        advisories.push({
          level: "info",
          message:
            "unwrapped a `${...}` block whose contents are all top-level declarations (v0.3 default-logic body — SPEC §40.8).",
        });
        i = closeIdx + 1;
      } else {
        // Mixed / imperative content OR scope-unsafe — leave wrapped.
        advisories.push({
          level: "info",
          message:
            "a `${...}` block was left wrapped (contains non-declaration content or scope-sensitive locals).",
        });
        result += body.slice(dollarIdx, closeIdx + 1);
        i = closeIdx + 1;
      }
      continue;
    }

    // Markup tag boundary — increment / decrement container depth.
    if (ch === "<") {
      const close = body.indexOf(">", i);
      if (close === -1) {
        // Malformed — emit rest and bail.
        result += body.slice(i);
        break;
      }
      const tagSlice = body.slice(i, close + 1);
      const isCloser = tagSlice.startsWith("</");
      // `</>` is close-elision — pops a container.
      // `</NAME>` is explicit close — pops a container.
      // `<NAME ... />` is self-closing — no depth change.
      // `<NAME ...>` is opener — pushes a container.
      const isSelfClosing = !isCloser && tagSlice.endsWith("/>");
      // V5-strict state-decl shape (`<x> = ...` / `<x>: T = ...`) is a
      // declaration, NOT a markup container. The literal `>` is followed by
      // whitespace then `=` or `:` (after attrs). Don't change depth on these.
      // Detect: tag opener (not closer, not self-closing) immediately followed
      // by `=` or `:` (with optional whitespace). Check the chars after `>`.
      let isStateDecl = false;
      if (!isCloser && !isSelfClosing) {
        // Peek past the `>` for `=` / `:` (whitespace-tolerant). If found,
        // this is a state-decl, not a container-opener.
        let j = close + 1;
        while (j < body.length && (body[j] === " " || body[j] === "\t")) j++;
        if (j < body.length && (body[j] === "=" || body[j] === ":")) {
          isStateDecl = true;
        }
      }

      result += tagSlice;
      i = close + 1;

      if (isStateDecl) continue;
      if (isCloser) {
        markupDepth = Math.max(0, markupDepth - 1);
      } else if (!isSelfClosing) {
        markupDepth++;
      }
      continue;
    }

    result += ch;
    i++;
  }
  return { rewritten: result, changed, advisories };
}

/**
 * Skip a `{...}` braced block starting at `openBraceIdx` (the `{` itself).
 * Tracks brace nesting + string/comment state. Returns the absolute index of
 * the matching `}`, or -1 if unmatched. Used by `unwrapRedundantLogicBlocks`
 * to skip past `?{...}` and `#{...}` blocks without misinterpreting their
 * contents as markup.
 *
 * @param {string} src
 * @param {number} openBraceIdx — index of the `{` to match
 * @returns {number}
 */
function skipBracedBlock(src, openBraceIdx) {
  let i = openBraceIdx + 1;
  let depth = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Stricter unwrap-safety check (v0.3 Wave 3.5 S87, Bugs B + C).
 *
 * Even when every statement parsed by `splitTopLevelStatements` looks like a
 * recognized top-level decl, unwrapping can still break the rewritten file if
 * the inner content has structural features that don't survive the
 * `${...}` → bare-text transition. Specifically:
 *
 * - **Comments inside the block (Bug C).** BS-layer's block-splitter
 *   recognizes `//` line comments and `/* … *\/` block comments as comment
 *   block-separators OUTSIDE logic context. A function body with a `// …`
 *   comment inside (e.g. `function f() { // note\n  match @x { … }\n }`)
 *   becomes ONE text block inside `${...}` (where the comment is just a JS
 *   comment in the function body). After unwrap, BS sees the `//` as a
 *   block-separator, splitting the text into pre-comment + comment + post-
 *   comment pieces; the post-comment piece (`}\n}\n\nfunction other() { match … }`)
 *   may not start with a recognized declaration keyword — it ends up at
 *   markup level and the inner `match` fires E-TYPE-026.
 *
 * - **`lift` keyword inside the block (Bug B / mixed-content).** `lift` is
 *   only valid in markup-emit positions (function bodies / template scopes).
 *   Its presence at the unwrap-candidate level signals the block is mixed-
 *   content (the splitter mis-detected because of embedded markup template
 *   literals) — preserve the wrap.
 *
 * - **`lin` declaration inside the block (Bug B).** Linear-type scope must
 *   be preserved end-to-end; the `lin` rules track the variable across all
 *   execution paths. A `lin` decl at the unwrap level is fine in itself,
 *   but if the block also contains markup-emit positions referencing it via
 *   a function-body-internal `lin ticket = …` decl, unwrap can sever the
 *   scope. Conservative: any `lin` declaration → preserve wrap.
 *
 * - **Bare control-flow keywords (`match`, `for`, `while`, `if`, `try`, `do`)
 *   at the immediate inner level.** `splitTopLevelStatements` may falsely
 *   collapse mixed content into one statement (e.g. `for { … lift <li>${x}</li> }`)
 *   and only check the FIRST keyword. The first keyword (`const q = …`)
 *   matches but the rest is non-decl. Detect any of these keywords appearing
 *   at the (apparent) top level of the inner block via a non-anchored scan.
 *
 * @param {string} inner — the contents between `${` and matching `}`.
 * @returns {boolean} true iff unwrap is safe; false to preserve the wrap.
 */
function isUnwrapSafe(inner) {
  // Quick scan for `//` line comments (anywhere outside string content) — this
  // is the most common Bug-C trigger.
  if (containsBareToken(inner, "//")) return false;
  // `/* */` block comments — same hazard.
  if (containsBareToken(inner, "/*")) return false;
  // `lift` keyword — markup-emit construct, signals mixed content.
  if (containsBareKeyword(inner, "lift")) return false;
  // `lin` declaration — linear-type scope must be preserved (Bug B family).
  if (containsBareKeyword(inner, "lin")) return false;
  // Bare control-flow keywords at top-level of the inner block — non-decl
  // statements that signal the splitter mis-collapsed mixed content.
  // Note: these keywords are FINE inside function/type bodies (which the
  // brace-tracker correctly nests through). We scan only at depth 0.
  if (containsTopLevelKeyword(inner, ["match", "for", "while", "if", "try", "do"])) {
    return false;
  }
  return true;
}

/**
 * True iff `token` appears in `src` outside of:
 *   - quoted strings (`"..."`, `'...'`, `` `...` ``)
 *   - line comments (`// ...` to EOL) — comments themselves are the trigger
 *     for `containsBareToken("//", ...)`; we don't recurse on those
 *   - block comments — same caveat as line comments
 *
 * Used to detect `//` / `/(asterisk)` outside string content. The function is
 * intentionally lenient on its own token (e.g. `//` inside a block-comment
 * is fine because the comment swallows it).
 *
 * @param {string} src
 * @param {string} token  — the literal substring to find
 * @returns {boolean}
 */
function containsBareToken(src, token) {
  let i = 0;
  while (i < src.length) {
    if (src.startsWith(token, i)) return true;
    const ch = src[i];
    // Skip strings (quoted contents may contain `//` legitimately, e.g. URL strings).
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return false;
}

/**
 * True iff `keyword` appears in `src` as a standalone identifier-bounded
 * token outside of quoted strings / comments. Word-boundary matched on both
 * sides.
 *
 * @param {string} src
 * @param {string} keyword
 * @returns {boolean}
 */
function containsBareKeyword(src, keyword) {
  const re = new RegExp(`(^|[^A-Za-z0-9_$])${keyword}(?![A-Za-z0-9_$])`);
  // Strip strings and comments first, then test.
  const stripped = stripStringsAndComments(src);
  return re.test(stripped);
}

/**
 * True iff any of `keywords` appears at the TOP-LEVEL of `src` — outside any
 * `{...}` / `(...)` / `[...]` nesting. Strings + comments stripped.
 *
 * @param {string} src
 * @param {string[]} keywords
 * @returns {boolean}
 */
function containsTopLevelKeyword(src, keywords) {
  let i = 0;
  let depth = 0;
  const stripped = stripStringsAndComments(src);
  while (i < stripped.length) {
    const ch = stripped[i];
    if (ch === "{" || ch === "(" || ch === "[") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      // Read identifier.
      let j = i;
      while (j < stripped.length && /[A-Za-z0-9_$]/.test(stripped[j])) j++;
      const ident = stripped.slice(i, j);
      if (keywords.includes(ident)) return true;
      i = j;
      continue;
    }
    i++;
  }
  return false;
}

/**
 * Replace string contents and comments in `src` with whitespace of equal
 * length so positions are preserved but the contents don't false-match
 * keyword scans.
 *
 * @param {string} src
 * @returns {string}
 */
function stripStringsAndComments(src) {
  const buf = src.split("");
  let i = 0;
  while (i < buf.length) {
    const ch = buf[i];
    if (ch === "/" && buf[i + 1] === "/") {
      while (i < buf.length && buf[i] !== "\n") {
        buf[i] = " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && buf[i + 1] === "*") {
      let j = i;
      while (j < buf.length && !(buf[j] === "*" && buf[j + 1] === "/")) {
        if (buf[j] !== "\n") buf[j] = " ";
        j++;
      }
      if (j < buf.length) {
        buf[j] = " ";
        buf[j + 1] = " ";
        j += 2;
      }
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < buf.length && buf[i] !== q) {
        if (buf[i] === "\\") {
          buf[i] = " ";
          i++;
        }
        if (buf[i] !== "\n") buf[i] = " ";
        i++;
      }
      if (i < buf.length) {
        buf[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return buf.join("");
}

/**
 * Find the matching `}` for a `${...}` block at `dollarIdx`. Tracks brace
 * nesting, string state (`"..."`, `'...'`, backticks), and `//` / `/* *\/`
 * comments. Returns the absolute index of the matching `}`, or -1 if
 * unmatched.
 *
 * @param {string} src
 * @param {number} dollarIdx — index of the `$` of `${`
 * @returns {number}
 */
function findMatchingDollarClose(src, dollarIdx) {
  let i = dollarIdx + 2;
  let depth = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // Skip string contents.
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Heuristic: does a `${...}` body contain ONLY top-level declarations?
 *
 * Recognized shapes (per SPEC §40.8 default-logic body + cross-ref §21):
 * - V5-strict state decl: `<x> = ...` / `const <x> = ...` / `<x>: Type = ...`
 * - `import ... from ...`
 * - `export ... { ... }` / `export const ... = ...` / `export function ...`
 * - `function name(...) { ... }`
 * - `fn name(...) ...`
 * - `server function name(...) { ... }`
 * - `type Name:enum = { ... }` / `type Name = { ... }`
 * - `const name = ...` / `let name = ...` (plain locals)
 *
 * If ANY non-recognized statement appears (control flow, bare call,
 * assignment, etc.), return false.
 *
 * @param {string} inner
 * @returns {boolean}
 */
function isTopLevelDeclOnly(inner) {
  // Split into statements by walking and respecting brace/quote depth.
  const stmts = splitTopLevelStatements(inner);
  if (stmts.length === 0) return false;
  for (const stmt of stmts) {
    const trimmed = stmt.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*")) continue;
    if (!isRecognizedTopLevelDecl(trimmed)) return false;
  }
  return true;
}

/**
 * Recognize a single statement as a top-level declaration shape.
 *
 * Conservative — matches by anchored regex on the trimmed statement text.
 *
 * @param {string} stmt — trimmed statement
 * @returns {boolean}
 */
function isRecognizedTopLevelDecl(stmt) {
  // V5-strict state decl shapes: `<x> = ...`, `<x>: Type = ...`,
  // `const <x> = ...`, `export const <x> = ...`.
  if (/^(?:export\s+)?(?:const\s+)?<\s*[A-Za-z_][A-Za-z0-9_]*\s*>\s*[=:]/.test(stmt)) {
    return true;
  }
  // import
  if (/^import\s/.test(stmt)) return true;
  // export ... { ... } / export const / export let / export function / export fn / export type
  // (export prefix consumed in subsequent rules; check `export` alone for `export { X }`).
  if (/^export\s*\{/.test(stmt)) return true;
  if (/^export\s+(?:default\s+)?(?:const|let|var|function|fn|type|server)\b/.test(stmt)) {
    return true;
  }
  // function / fn / server function / type / const / let
  if (/^function\s+[A-Za-z_]/.test(stmt)) return true;
  if (/^fn\s+[A-Za-z_]/.test(stmt)) return true;
  if (/^server\s+function\s+[A-Za-z_]/.test(stmt)) return true;
  if (/^type\s+[A-Za-z_]/.test(stmt)) return true;
  if (/^const\s+[A-Za-z_]/.test(stmt)) return true;
  if (/^let\s+[A-Za-z_]/.test(stmt)) return true;
  return false;
}

/**
 * Split a `${...}` body into top-level statements. Statements are separated
 * by either:
 *   - one or more blank lines (multi-decl text block convention), OR
 *   - a top-level `}` closer (function body / type body / object literal at
 *     a top-level decl), recognized as end-of-statement when followed by
 *     newline.
 *
 * Naive but workable: we walk char-by-char, tracking brace depth + string
 * state. When brace depth returns to 0 AND we hit either a newline or a `;`,
 * we flush the current statement.
 *
 * @param {string} src
 * @returns {string[]}
 */
function splitTopLevelStatements(src) {
  const out = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  // Track whether we've seen non-whitespace since last flush — empty buffer
  // skips on flush.
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      buf += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      buf += src.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      const start = i;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i = Math.min(i + 1, src.length);
      buf += src.slice(start, i);
      continue;
    }
    if (ch === "{") {
      depth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      i++;
      // If depth went to zero and the next non-whitespace char is a newline,
      // treat as end-of-statement.
      if (depth === 0) {
        // Peek ahead — flush after consuming trailing whitespace on the line.
        let j = i;
        while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
        if (j === src.length || src[j] === "\n" || src[j] === ";") {
          out.push(buf);
          buf = "";
          i = j;
          if (src[i] === "\n" || src[i] === ";") i++;
        }
      }
      continue;
    }
    if (ch === ";" && depth === 0) {
      buf += ch;
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    if (ch === "\n" && depth === 0) {
      // Statement boundary on blank-line OR if the buffer contains a
      // complete decl already.
      // Look for the next non-whitespace char. If it's another non-blank
      // line, AND the buf has terminated (e.g. `<x> = 0` then newline),
      // flush.
      // Heuristic: flush only on blank-line boundary, otherwise we'd split
      // multi-line statements like `const x = {\n  a: 1,\n}`. We already
      // handle the `}` closer above; here we just flush if the next line is
      // blank.
      buf += ch;
      // Peek next char.
      let j = i + 1;
      while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
      if (j < src.length && src[j] === "\n") {
        // Blank line — flush.
        out.push(buf);
        buf = "";
        i = j + 1;
        continue;
      }
      // Single newline — keep accumulating, but check if buf is a complete
      // V5-strict-style decl in one line (e.g. `<x> = 0\n<y> = 1`).
      // Detect single-line decls: trimmed buf matches our recognized decl
      // shapes AND ends with not-an-opener.
      const trimmed = buf.trim();
      if (
        depth === 0 &&
        trimmed !== "" &&
        /^(?:export\s+)?(?:const\s+)?<\s*[A-Za-z_][A-Za-z0-9_]*\s*>\s*[=:][^{]*$/.test(
          trimmed
        )
      ) {
        out.push(buf);
        buf = "";
      }
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim() !== "") {
    out.push(buf);
  }
  return out;
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
 *   staged under `/tmp/scrml-migrate-check-XXX/` resolves `./foo.scrml` to
 *   `/tmp/scrml-migrate-check-XXX/foo.scrml` which doesn't exist, MOD fires
 *   E-IMPORT-006, and the gate fails on every multi-file route file.
 *
 *   Option β writes the rewritten content to the file's ORIGINAL path,
 *   invokes `compileScrml` with `gather: true` so the existing auto-gather
 *   pre-pass walks the real import graph, and then ALWAYS restores the
 *   original content from an in-memory backup before returning. The caller
 *   (`migrateFile`) decides separately whether to write the rewrite
 *   permanently — this function never leaves the file mutated.
 *
 *   Trade-off: there is a microseconds-wide window during the compile call
 *   where the on-disk content is the rewrite candidate. A SIGKILL or crash
 *   during that window leaves the file at the rewrite candidate's content.
 *   The try/finally always restores the backup on normal control flow,
 *   including compiler crashes. For dry-run mode this is essential — the
 *   user expects no on-disk change. For in-place mode, `migrateFile` writes
 *   the rewrite immediately after this returns ok, so the brief window does
 *   not change net behavior.
 *
 *   Constraint: "Do not weaken the gate" (S86 standing rule) is preserved
 *   end-to-end — the compile invocation is identical to the pre-existing one
 *   except for `gather: true` (which is what `compileScrml` defaults to and
 *   what the real `compile` / `dev` / `build` paths use). Cross-file
 *   E-IMPORT-006 and downstream MOD/NR/SYM/TS/DG/CE/CG diagnostics still
 *   fire on real breakage.
 *
 * @param {string} rewrittenSource
 * @param {string} originalPath — absolute path of the file under migration.
 *                                 The rewritten source is written here for
 *                                 the duration of the compile call, then
 *                                 restored from the in-memory backup.
 * @returns {{ ok: boolean, errors: object[] }}
 */
function sanityCheckParse(rewrittenSource, originalPath) {
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
      // Throw rather than silently leave a broken state — the migrate
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

  // Errors (severity 'error' or unspecified) block the migration.
  // Warnings are fine — the whole point is fixing W-WHITESPACE-001 /
  // W-DEPRECATED-001, but the rewritten source may still surface OTHER
  // unrelated warnings, which we don't want to block on.
  const blockingErrors = (result.errors || []).filter(
    (e) => !e.severity || e.severity === "error"
  );

  return {
    ok: blockingErrors.length === 0,
    errors: blockingErrors,
  };
}

// ---------------------------------------------------------------------------
// Diff rendering (unified, simplified — no external deps)
// ---------------------------------------------------------------------------

/**
 * Produce a simple unified-diff-style preview of two source texts.
 *
 * Not a full unified diff — we don't need hunks. We just emit:
 *   - file header
 *   - line-by-line `-` (removed) / `+` (added) for changed lines
 *   - unchanged lines elided to `...`
 *
 * @param {string} oldText
 * @param {string} newText
 * @param {string} relPath
 * @returns {string}
 */
function simpleDiff(oldText, newText, relPath) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const out = [];

  out.push(c.bold(`--- ${relPath}`));
  out.push(c.bold(`+++ ${relPath}`));

  // Walk both line arrays. When lines match, advance both. When they differ,
  // emit a `-` for the old line and a `+` for the new line. We don't try to
  // align — the migrations are line-local, so 1-for-1 substitution holds.
  const max = Math.max(oldLines.length, newLines.length);
  let inHunk = false;
  for (let i = 0; i < max; i++) {
    const oldL = i < oldLines.length ? oldLines[i] : null;
    const newL = i < newLines.length ? newLines[i] : null;
    if (oldL === newL) {
      if (inHunk) {
        out.push(c.dim("..."));
        inHunk = false;
      }
      continue;
    }
    inHunk = true;
    if (oldL !== null) out.push(c.red(`- ${oldL}`));
    if (newL !== null) out.push(c.green(`+ ${newL}`));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`scrml migrate <file|directory> [options]

Apply automated source rewrites for deprecated scrml syntax patterns.

Migrations shipped:
  - Whitespace-after-\`<\`  (W-WHITESPACE-001): \`< db>\` → \`<db>\`
  - \`<machine>\` keyword     (W-DEPRECATED-001): \`<machine\` → \`<engine\`
  - \`pure\` modifier        (W-PURE-DEPRECATED): \`pure function\`/\`pure fn\` → \`fn\`;
                            \`[server ]pure[ server ]function\` → \`server fn\`
  - \`const @name\` cell     (W-CONST-AT-DEPRECATED): \`const @name = ...\` →
                            \`const <name> = ...\` (the SOLE derived-decl form, §6.6.1)

Optional migrations (opt-in flags):
  - v0.3 program-shape      (--program-shape, SPEC §40.8): rewrites legacy
                            v0.2 source into v0.3 one-program-per-application
                            shape. Route files with per-route attrs only get
                            \`<program ...>\` → \`<page ...>\` rewrite; entry files
                            unwrap redundant \`\${...}\` wrappers around top-level
                            declarations. Schema-anchor files (per §39.12.0
                            workaround) are left alone with an advisory.
  - arm-arrow \`:>\`         (--fix, SPEC §18.2 / §34): rewrites deprecated
                            \`match\` / \`!{}\`-handler arm separators \`=>\` / \`->\`
                            to the canonical \`:>\`. AST-driven — arrow-function
                            \`=>\` and \`fn ... -> Type\` returns are NOT touched.
                            Surfaces W-MATCH-ARROW-LEGACY pre-migration.
  - given-guard \`:>\`      (--fix, SPEC §42.2.3 / §34): rewrites the deprecated
                            standalone \`given\` presence-guard separator \`=>\`
                            to the canonical \`:>\`. AST-driven — arrow-function
                            \`=>\` is NOT touched. Surfaces W-GIVEN-ARROW-LEGACY
                            pre-migration.
  - \`:\`-shorthand inside-opener (--fix, SPEC §4.14 / §51.0.I / §18.0.1 / §34):
                            rewrites the legacy AFTER-\`>\` \`:\`-shorthand placement
                            (\`<Variant> : expr\`) to the canonical inside-opener
                            placement (\`<Variant : expr>\`) on engine state-child
                            and \`<match>\` arm bodies. AST-driven — string- and
                            angleDepth-aware (a \`>\` inside a string value or
                            markup body is opaque). Surfaces
                            W-COLON-SHORTHAND-LEGACY-PLACEMENT pre-migration.
  - \`server\` keyword       (--fix, W-DEPRECATED-SERVER-MODIFIER, S180): strips
                            the deprecated \`server\` keyword from
                            \`server function NAME(\` declarations that STILL
                            escalate server WITHOUT it (the lint firing IS the
                            safety proof). Diagnostic-driven — staged-compiles to
                            find the redundant-keyword sites. Excludes the SSE
                            generator \`server function*\` (deferred) and never
                            touches \`server fn\` (pure-server pin).
  - channel publisher     (--fix, E-CHANNEL-SERVER-CELL-READ, RULING A): strips
                            the deprecated \`server\` keyword from a \`server
                            function NAME(\` CHANNEL PUBLISHER that read-modify-
                            writes a channel cell, so it runs client-side and
                            syncs via \`__sync\` (SPEC §38.4). Diagnostic-driven —
                            strips ONLY where E-CHANNEL-SERVER-CELL-READ fires and
                            W-DEPRECATED-SERVER-MODIFIER does NOT (the keyword is
                            the sole server-placement reason). A broadcast/SQL-
                            escalated publisher (keyword redundant) is left for
                            the manual payload rewrite (§38.6.1).

Arguments:
  <file>                  A single .scrml file
  <directory>             A directory — all matching files inside are migrated

Options:
  --dry-run               Print unified diff to stdout without writing
  --check                 Exit non-zero if any file would be modified (CI-friendly)
  --include=<glob>        File pattern (default: '*.scrml')
  --exclude=<glob>        Additional exclude pattern (substring match)
  --no-default-excludes   Disable built-in samples/ + tests/ exclusions
  --program-shape         Enable v0.3 program-shape migration (SPEC §40.8)
  --fix                   Enable the AST/compile-aware canonicalisation rewrites:
                          \`:>\` arm-arrow (SPEC §18.2 / §34): \`=>\` / \`->\` arm
                          separators → \`:>\`; given-guard (SPEC §42.2.3 / §34):
                          standalone \`given x => { ... }\` → \`given x :> { ... }\`;
                          \`:\`-shorthand inside-opener placement; and the
                          \`server\`-keyword strip (W-DEPRECATED-SERVER-MODIFIER,
                          S180): \`server function NAME(\` → \`function NAME(\` where
                          the function still escalates server (excludes
                          \`server function*\` SSE + \`server fn\`); and the
                          channel-publisher \`server\`-strip
                          (E-CHANNEL-SERVER-CELL-READ, RULING A): a deprecated
                          \`server function\` channel publisher that writes a
                          channel cell → client-side \`function\` (SPEC §38.4).
  --report                With --dry-run --program-shape, emit a structured
                          advisory report listing every in-scope file's bucket,
                          evidence, and proposed action (REWRITE / SKIP /
                          ADVISORY / NOOP). Recommended first step before
                          running --program-shape rewrites in place.
  --help, -h              Show this message

Safety:
  Each file is sanity-parsed after rewriting. If the result fails to compile,
  the file is left untouched and the failure is reported.

  By default, paths under \`samples/\` or \`tests/\` are skipped — they exercise
  deprecation paths on purpose. Pass --no-default-excludes to override.

Examples:
  scrml migrate src/                                # in-place rewrite (W-* only)
  scrml migrate src/app.scrml --dry-run             # preview only
  scrml migrate src/ --check                        # CI gate
  scrml migrate src/ --program-shape --dry-run --report   # v0.3 report
  scrml migrate src/ --program-shape                # apply v0.3 rewrites
  scrml migrate src/ --fix --dry-run                # preview arm-arrow :> rewrite
  scrml migrate src/ --fix                          # apply arm-arrow :> rewrite
`);
}

/**
 * @param {string[]} args
 * @returns {{ paths: string[], dryRun: boolean, check: boolean,
 *             include: string, excludes: string[], help: boolean,
 *             programShape: boolean, report: boolean }}
 */
function parseArgs(args) {
  const paths = [];
  let dryRun = false;
  let check = false;
  let include = "*.scrml";
  const excludes = [];
  let useDefaultExcludes = true;
  let help = false;
  let programShape = false;
  let report = false;
  let fix = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--check") {
      check = true;
    } else if (arg.startsWith("--include=")) {
      include = arg.slice("--include=".length);
    } else if (arg === "--include") {
      include = args[++i];
      if (!include) {
        console.error(c.red("error:") + ` --include requires a value`);
        process.exit(1);
      }
    } else if (arg.startsWith("--exclude=")) {
      excludes.push(arg.slice("--exclude=".length));
    } else if (arg === "--exclude") {
      const val = args[++i];
      if (!val) {
        console.error(c.red("error:") + ` --exclude requires a value`);
        process.exit(1);
      }
      excludes.push(val);
    } else if (arg === "--no-default-excludes") {
      useDefaultExcludes = false;
    } else if (arg === "--program-shape") {
      programShape = true;
    } else if (arg === "--fix") {
      fix = true;
    } else if (arg === "--report") {
      report = true;
    } else if (arg.startsWith("-")) {
      console.error(c.red("error:") + ` Unknown option: ${arg}`);
      console.error(c.dim("Run `scrml migrate --help` for usage."));
      process.exit(1);
    } else {
      paths.push(arg);
    }
  }

  if (useDefaultExcludes) {
    // Skip directories that exercise deprecation paths on purpose.
    excludes.push(`${sep}samples${sep}`);
    excludes.push(`${sep}tests${sep}`);
  }

  return { paths, dryRun, check, include, excludes, help, programShape, report, fix };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively collect .scrml files under a path.
 *
 * Filters: include pattern (suffix-only, since we accept '*.scrml'-style
 * globs), exclude substring matches.
 *
 * @param {string} root — absolute path to a file or directory
 * @param {string} include — pattern (e.g. '*.scrml')
 * @param {string[]} excludes — substring exclude patterns
 * @returns {string[]} absolute file paths
 */
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
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue; // skip dotfiles / .git
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (isExcluded(full + sep)) continue;
        walk(full);
      } else if (st.isFile()) {
        if (isExcluded(full)) continue;
        if (full.endsWith(suffix)) {
          out.push(full);
        }
      }
    }
  }

  let st;
  try { st = statSync(root); } catch {
    return [];
  }
  if (st.isFile()) {
    if (!isExcluded(root) && root.endsWith(suffix)) {
      out.push(root);
    }
  } else if (st.isDirectory()) {
    walk(root);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Per-file processing
// ---------------------------------------------------------------------------

/**
 * Process a single file: read, apply migrations, sanity-parse, write or report.
 *
 * When `opts.programShape` is true, the v0.3 program-shape migration is run
 * in addition to the existing W-* migrations. The flow is:
 *   1. Apply W-* migrations (existing).
 *   2. Classify the file (entry / route / module / schema-anchor / ambiguous).
 *   3. Apply program-shape rewrite per bucket.
 *   4. Sanity-parse the combined rewrite.
 *
 * @param {string} filePath
 * @param {{ dryRun: boolean, check: boolean, programShape?: boolean,
 *           report?: boolean, projectRoot?: string }} opts
 * @param {string} cwd
 * @returns {{ status: 'unchanged' | 'changed' | 'failed' | 'unreadable',
 *             migrations?: { whitespace: number, machine: number },
 *             reason?: string,
 *             diff?: string,
 *             classification?: {bucket: string, evidence: string[]},
 *             advisories?: Array<{level: string, message: string, hint?: string}>,
 *             action?: string }}
 */
export function migrateFile(filePath, opts, cwd) {
  const relPath = relative(cwd, filePath);
  const projectRoot = opts.projectRoot || cwd;

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    return { status: "unreadable", reason: err.message };
  }

  // Step 1: apply baseline W-* migrations.
  const baseline = applyMigrations(source);
  let rewritten = baseline.rewritten;
  let changed = baseline.changed;
  const migrations = baseline.migrations;

  // Step 1b: optionally apply the arm-arrow `:>` canonicalisation (--fix).
  // AST-driven (rewriteMatchArmArrows) — rewrites ONLY match / `!{}`-handler
  // arm-separator `=>` / `->` to the canonical `:>` (SPEC §18.2 / §34); arrow-
  // function and fn-return arrows are untouched. Opt-in per the
  // W-MATCH-ARROW-LEGACY lint's `bun scrml migrate --fix` suggestion.
  if (opts.fix) {
    const armResult = rewriteMatchArmArrows(rewritten, filePath);
    if (armResult.changed) {
      rewritten = armResult.rewritten;
      changed = true;
    }
    migrations.matchArmArrow = armResult.count;

    // Step 1c: standalone-`given` presence-guard separator `=>` → `:>`
    // (SPEC §42.2.3 / §34 — the `given`-guard sibling of the arm-arrow rewrite).
    // AST-driven (rewriteGivenGuardArrows); rewrites ONLY recorded given-guard
    // separators, never an arrow-function `=>`. Reported separately from the
    // arm-arrow count. Runs on the post-arm-rewrite text so offsets are fresh.
    const ggResult = rewriteGivenGuardArrows(rewritten, filePath);
    if (ggResult.changed) {
      rewritten = ggResult.rewritten;
      changed = true;
    }
    migrations.givenGuardArrow = ggResult.count;

    // Step 1d: `:`-shorthand placement canonicalisation — legacy after-`>`
    // (`<Variant> : expr`) → inside-opener (`<Variant : expr>`) (SPEC §4.14 /
    // §51.0.I / §18.0.1, S160 — S154 ruling (b)). AST-driven
    // (rewriteColonShorthandPlacement); rewrites ONLY engine state-child / match
    // arm bodies whose parser-detected `legacyColonPlacement` is true. Runs on
    // the post-arm/guard text so offsets are fresh. Powers the
    // W-COLON-SHORTHAND-LEGACY-PLACEMENT lint's `migrate --fix` suggestion.
    const csResult = rewriteColonShorthandPlacement(rewritten, filePath);
    if (csResult.changed) {
      rewritten = csResult.rewritten;
      changed = true;
    }
    migrations.colonShorthandPlacement = csResult.count;

    // Step 1e: Migration 4 (server-keyword-eliminate) — strip the redundant
    // deprecated `server` keyword from `server function NAME(` declarations
    // that STILL escalate server without it (proven by the
    // W-DEPRECATED-SERVER-MODIFIER lint firing on them). DIAGNOSTIC-driven —
    // it staged-compiles the post-`:>`-migration text to collect the fire-
    // sites, then span-strips `server ` at each. Excludes the SSE generator
    // `server function*` (deferred) and never touches `server fn` (the lint
    // won't fire there). Runs LAST in the `--fix` chain so it analyses the
    // fully-canonicalised text. See `rewriteServerFunctionKeyword` for the
    // safety rationale (why a pure-text regex would client-flip the danger
    // sites).
    const sfResult = rewriteServerFunctionKeyword(rewritten, filePath);
    if (sfResult.changed) {
      rewritten = sfResult.rewritten;
      changed = true;
    }
    migrations.serverFnKeyword = sfResult.count;

    // Step 1f: Migration 5 (channel-server-publisher-eliminate, RULING A /
    // Enhanced-A) — strip the deprecated `server` keyword from a `server
    // function NAME(` CHANNEL PUBLISHER whose server-side channel-cell READ
    // fires E-CHANNEL-SERVER-CELL-READ AND on which W-DEPRECATED-SERVER-MODIFIER
    // does NOT fire (the keyword is the SOLE server-placement reason → stripping
    // it declassifies the publisher to the client per §38.4 / RULING A, where
    // the cell-write syncs via `__sync` and the read is valid → the error
    // clears). DIAGNOSTIC-driven (staged compile → discriminator → span-strip).
    // Runs AFTER Migration 4 on the post-`server`-strip text: Migration 4 has
    // already removed the redundant keyword from broadcast/SQL-escalated
    // publishers (W-DEPRECATED fire-sites), so the only `server function`
    // channel publishers left for Migration 5 are the keyword-sole ones it can
    // safely flip to the client. See `rewriteChannelServerPublisher`.
    const cpResult = rewriteChannelServerPublisher(rewritten, filePath);
    if (cpResult.changed) {
      rewritten = cpResult.rewritten;
      changed = true;
    }
    migrations.channelServerPublisher = cpResult.count;
  }

  // Step 2: optionally apply v0.3 program-shape migration.
  let classification = null;
  let advisories = [];
  let action = changed ? "REWRITE" : "NOOP";
  if (opts.programShape) {
    classification = classifyFile(filePath, rewritten, projectRoot);
    const shapeResult = applyProgramShapeRewrite(rewritten, classification);
    if (shapeResult.changed) {
      rewritten = shapeResult.rewritten;
      changed = true;
      action = "REWRITE";
    } else if (changed) {
      // W-* migration produced a change; keep REWRITE.
      action = "REWRITE";
    } else if (shapeResult.action === "ADVISORY") {
      action = "ADVISORY";
    } else if (shapeResult.action === "SKIP") {
      action = "SKIP";
    } else {
      action = shapeResult.action || "NOOP";
    }
    advisories = shapeResult.advisories || [];
  }

  if (!changed) {
    // Always return classification + advisories when programShape is on so
    // --report can render them.
    return opts.programShape
      ? {
          status: "unchanged",
          classification,
          advisories,
          action,
        }
      : { status: "unchanged" };
  }

  // Step 3: sanity-check parse the rewritten source.
  const parseResult = sanityCheckParse(rewritten, filePath);
  if (!parseResult.ok) {
    const messages = parseResult.errors.map(e => e.message || String(e)).join("; ");
    return {
      status: "failed",
      reason: `rewritten source failed to parse: ${messages}`,
      classification,
      advisories,
      action,
    };
  }

  if (opts.dryRun) {
    const diff = simpleDiff(source, rewritten, relPath);
    return {
      status: "changed",
      migrations,
      diff,
      classification,
      advisories,
      action,
    };
  }

  if (opts.check) {
    // --check: do not write; signal "would change" via status.
    return {
      status: "changed",
      migrations,
      classification,
      advisories,
      action,
    };
  }

  // Write in-place.
  try {
    writeFileSync(filePath, rewritten, "utf8");
  } catch (err) {
    return { status: "failed", reason: `write failed: ${err.message}` };
  }
  return {
    status: "changed",
    migrations,
    classification,
    advisories,
    action,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Entry point for the migrate subcommand.
 *
 * @param {string[]} args — raw argv slice after "migrate"
 */
export function runMigrate(args) {
  const { paths, dryRun, check, include, excludes, help, programShape, report, fix } = parseArgs(args);

  if (help) {
    printHelp();
    return;
  }

  if (paths.length === 0) {
    console.error(c.red("error:") + " scrml migrate requires at least one file or directory");
    console.error(c.dim("Run `scrml migrate --help` for usage."));
    process.exit(1);
  }

  if (report && !programShape) {
    console.error(c.yellow("warning:") + " --report has no effect without --program-shape; ignoring.");
  }

  const cwd = process.cwd();

  // Collect all files to process across all input paths.
  const allFiles = [];
  for (const p of paths) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) {
      console.error(c.red("error:") + ` Path not found: ${p}`);
      process.exit(1);
    }
    const files = collectFiles(abs, include, excludes);
    allFiles.push(...files);
  }

  // Dedupe (paths may overlap when both a parent dir and child file are passed).
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

  // Process.
  let changedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  let totalWhitespace = 0;
  let totalMachine = 0;
  let totalPure = 0;
  let totalMatchArmArrow = 0;
  let totalGivenGuardArrow = 0;
  let totalColonShorthandPlacement = 0;
  let totalServerFnKeyword = 0;
  let totalChannelServerPublisher = 0;
  let totalConstAt = 0;
  const failures = [];
  const reportRows = []; // for --report aggregation

  // Determine project root for classification (heuristic: deepest common
  // ancestor of input paths, falling back to cwd).
  const projectRoot = cwd;

  for (const file of uniqueFiles) {
    const r = migrateFile(
      file,
      { dryRun, check, programShape, report, fix, projectRoot },
      cwd
    );
    if (programShape && report) {
      reportRows.push({ file: relative(cwd, file), result: r });
    }
    if (r.status === "changed") {
      changedCount++;
      if (r.migrations) {
        totalWhitespace += r.migrations.whitespace;
        totalMachine += r.migrations.machine;
        totalPure += r.migrations.pure ?? 0;
        totalMatchArmArrow += r.migrations.matchArmArrow ?? 0;
        totalGivenGuardArrow += r.migrations.givenGuardArrow ?? 0;
        totalColonShorthandPlacement += r.migrations.colonShorthandPlacement ?? 0;
        totalServerFnKeyword += r.migrations.serverFnKeyword ?? 0;
        totalChannelServerPublisher += r.migrations.channelServerPublisher ?? 0;
        totalConstAt += r.migrations.constAt ?? 0;
      }
      if (dryRun && r.diff && !report) {
        console.log(r.diff);
        console.log("");
      } else if (!dryRun) {
        const verb = check ? "would migrate" : "migrated";
        console.log(c.green(`  ${verb}`) + `  ${relative(cwd, file)}`);
      }
    } else if (r.status === "unchanged") {
      unchangedCount++;
    } else {
      failedCount++;
      failures.push({ file: relative(cwd, file), reason: r.reason });
      console.error(c.red("  failed   ") + `${relative(cwd, file)}: ${r.reason}`);
    }
  }

  // Emit structured --report output (only when --program-shape + --report).
  if (programShape && report) {
    emitProgramShapeReport(reportRows);
  }

  // Summary.
  console.log("");
  console.log(c.bold("Summary:"));
  console.log(`  ${uniqueFiles.length} file${uniqueFiles.length !== 1 ? "s" : ""} scanned`);
  if (changedCount > 0) {
    const verb = dryRun ? "would change" : (check ? "would change" : "changed");
    console.log(`  ${c.green(changedCount)} ${verb}`);
    if (totalWhitespace > 0) console.log(`    ${c.dim(`whitespace migrations:`)} ${totalWhitespace}`);
    if (totalMachine > 0) console.log(`    ${c.dim(`<machine> migrations:`)} ${totalMachine}`);
    if (totalPure > 0) console.log(`    ${c.dim(`\`pure\` modifier migrations:`)} ${totalPure}`);
    if (totalMatchArmArrow > 0) console.log(`    ${c.dim(`arm-arrow \`:>\` migrations:`)} ${totalMatchArmArrow}`);
    if (totalGivenGuardArrow > 0) console.log(`    ${c.dim(`given-guard \`:>\` migrations:`)} ${totalGivenGuardArrow}`);
    if (totalColonShorthandPlacement > 0) console.log(`    ${c.dim(`\`:\`-shorthand inside-opener migrations:`)} ${totalColonShorthandPlacement}`);
    if (totalServerFnKeyword > 0) console.log(`    ${c.dim(`\`server\` keyword strips (\`server function\` -> \`function\`):`)} ${totalServerFnKeyword}`);
    if (totalChannelServerPublisher > 0) console.log(`    ${c.dim(`channel-publisher \`server\` strips (RULING A, client-side cell-write):`)} ${totalChannelServerPublisher}`);
    if (totalConstAt > 0) console.log(`    ${c.dim(`\`const @name\` -> \`const <name>\` migrations:`)} ${totalConstAt}`);
  }
  if (unchangedCount > 0) {
    console.log(`  ${c.dim(`${unchangedCount} unchanged`)}`);
  }
  if (failedCount > 0) {
    console.log(`  ${c.red(failedCount)} failed`);
  }

  // Exit codes:
  //   --check   → 1 if any file would change OR any file failed
  //   default   → 1 if any file failed (writes succeeded → 0)
  if (check && (changedCount > 0 || failedCount > 0)) {
    process.exit(1);
  }
  if (!check && failedCount > 0) {
    process.exit(1);
  }
}

/**
 * Emit a structured `--report` listing each file's bucket, evidence, proposed
 * action, and advisories. Format is human-readable but stable (snapshot-able).
 *
 * @param {Array<{file: string, result: object}>} rows
 */
function emitProgramShapeReport(rows) {
  console.log("");
  console.log(c.bold("Program-shape report (v0.3 SPEC §40.8):"));
  console.log("");

  // Group by bucket for easier scanning.
  const groups = new Map();
  for (const row of rows) {
    const bucket = (row.result.classification && row.result.classification.bucket) || "unknown";
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(row);
  }

  // Stable group ordering.
  const order = ["entry", "route", "module", "schema-anchor", "ambiguous", "unknown"];
  for (const bucket of order) {
    if (!groups.has(bucket)) continue;
    const items = groups.get(bucket);
    console.log(c.bold(`[${bucket}]`) + c.dim(`  (${items.length} file${items.length !== 1 ? "s" : ""})`));
    for (const row of items) {
      const action = row.result.action || "UNKNOWN";
      const actionTag =
        action === "REWRITE" ? c.green(action) :
        action === "SKIP"    ? c.yellow(action) :
        action === "ADVISORY"? c.yellow(action) :
                               c.dim(action);
      console.log(`  ${actionTag}  ${row.file}`);
      if (row.result.classification && row.result.classification.evidence) {
        for (const ev of row.result.classification.evidence) {
          console.log(`    ${c.dim("·")} ${c.dim(ev)}`);
        }
      }
      if (row.result.advisories && row.result.advisories.length > 0) {
        for (const adv of row.result.advisories) {
          const tag = adv.level === "warn" ? c.yellow("warn:") : c.dim("info:");
          console.log(`    ${tag} ${adv.message}`);
          if (adv.hint) {
            console.log(`      ${c.dim("hint:")} ${c.dim(adv.hint)}`);
          }
        }
      }
    }
    console.log("");
  }
}
