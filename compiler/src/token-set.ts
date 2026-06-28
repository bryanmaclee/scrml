/**
 * @module token-set
 *
 * `--emit-token-set` — the scrml-side half of the flogence docs↔code-drift DD
 * (flogence S17, ratified; scrml ss54 / S229).
 *
 * Emits ONE `token-set.json` per compile: a CHEAP, READ-ONLY projection of the
 * compiler-owned identifier vocabulary that flogence consumes as a second
 * flograph "currency" pass — flagging a doc that cites a now-dead symbol /
 * error-code / keyword. **scrml owns ONLY the emit.** The consume / display /
 * confidence-tiering all live in flogence.
 *
 * Shape:
 *
 *   { "version":    "<8-char fnv1a fingerprint of the canonical body>",
 *     "symbols":    [ {"name":"sendMessage","kind":"function"}, ... ],
 *     "errorCodes": [ "E-...","W-...","I-..." ],
 *     "keywords":   [ "match","lift", ..., "scrml:data", ... ] }
 *
 * **Hard constraints (from the DD):**
 *   (i)   INFO, never a gate — wired into nothing pass/fail; a pure CLI byproduct.
 *   (ii)  Rides existing projections, NOT a new identity store — every field is a
 *         read-only projection of the symbol table / AST / tokenizer / source,
 *         written to an artifact the compiler NEVER reads back (anti-ouroboros).
 *   (iii) Confidence-tiering SUPPORTED via per-symbol `kind`.
 *   (iv)  Emits no "this doc is current" signal.
 *
 * **Design decisions (ss54 survey):**
 *   - version = CONTENT FINGERPRINT (fnv1a, §47.1.3 normative). The re-check
 *     invariant flogence stated ("changes when the symbol set changes; stable
 *     when source is unchanged") IS a content hash — a monotonic / commit-SHA key
 *     would churn on every commit. Semantically a fingerprint, not a version no.
 *   - symbols carry `kind`. v1 enum: function|component|engine|type|channel
 *     (from `buildBlockAnalysis`) + state-cell (file-level `_scope.stateCells`).
 *     enum-variant / server-fn / stdlib-export granularity is DEFERRED; stdlib
 *     vocab rides the `keywords` field.
 *   - errorCodes = a LIVE SOURCE-SCAN of `compiler/src` (no programmatic §34
 *     catalog exists; the scattered `(E|W|I)-*` literals are the de-facto
 *     emittable set). Over-inclusion is SAFE: the oracle flags codes ABSENT
 *     from the set, so an over-broad set only loses true-positives, never adds
 *     false ones. A committed registry would impose a per-diagnostic refactor-tax
 *     (co-location axiom) and BE a second identity store (constraint ii). The
 *     scan is drift-free + read-only. Depends on the run-from-source distribution
 *     model (bun runs `compiler/src` directly); a future bundled package without
 *     source would need a generated-constant fallback.
 */

import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildBlockAnalysis } from "./block-analysis.ts";
import { KEYWORDS } from "./tokenizer.ts";
import { fnv1aHash } from "./codegen/fnv1a-hash.ts";

/** One declared compiler-owned identifier + its kind. */
export interface TokenSetSymbol {
  name: string;
  /** function | component | engine | type | channel | state-cell (v1 enum). */
  kind: string;
}

/** The emitted token-set artifact. */
export interface TokenSet {
  version: string;
  symbols: TokenSetSymbol[];
  errorCodes: string[];
  keywords: string[];
}

/** Static-vocab injection point. The CLI passes nothing (the collectors run
 *  their default FS scans); tests inject fixed sets so `buildTokenSet`'s
 *  symbol + version logic is unit-testable without touching the filesystem. */
export interface TokenSetVocab {
  errorCodes?: string[];
  keywords?: string[];
}

// ---------------------------------------------------------------------------
// symbols — projection of the symbol table / named-block AST
// ---------------------------------------------------------------------------

/** Unwrap a metaFiles entry to its inner FileAST (mirrors block-analysis.ts). */
function unwrapAst(file: unknown): any {
  if (!file || typeof file !== "object") return file;
  const inner = (file as any).ast;
  return inner && typeof inner === "object" ? inner : file;
}

/**
 * Project the declared compiler-owned identifiers across all compiled files.
 *
 * Named blocks (function | component | engine | type | channel) reuse the
 * tested, deterministic `buildBlockAnalysis` projection. File-level reactive
 * state-cells are read from each file's `_scope.stateCells` (SYM attaches
 * `_scope` to the FileAST). Deduped by `kind|name`, sorted by (kind, name).
 */
export function collectSymbols(metaFiles: unknown): TokenSetSymbol[] {
  const out: TokenSetSymbol[] = [];

  // Named blocks — function | component | engine | type | channel.
  for (const analysis of buildBlockAnalysis(metaFiles)) {
    for (const b of analysis.blocks) out.push({ name: b.name, kind: b.kind });
  }

  // File-level state-cells.
  const list = Array.isArray(metaFiles)
    ? metaFiles
    : metaFiles != null
      ? [metaFiles]
      : [];
  for (const file of list) {
    const ast = unwrapAst(file);
    const cells = ast && ast._scope && ast._scope.stateCells;
    if (cells && typeof cells.forEach === "function") {
      cells.forEach((rec: any) => {
        const name = rec && (rec.qualifiedPath || rec.name);
        if (name) out.push({ name, kind: "state-cell" });
      });
    }
  }

  // Dedupe by kind|name; stable sort by (kind, name).
  const seen = new Set<string>();
  const dedup: TokenSetSymbol[] = [];
  for (const s of out) {
    const key = s.kind + "|" + s.name;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(s);
  }
  dedup.sort((a, b) =>
    a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return dedup;
}

// ---------------------------------------------------------------------------
// errorCodes — live source-scan of compiler/src
// ---------------------------------------------------------------------------

/** Default `compiler/src` root: this module's own directory. */
function defaultSrcDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Default `stdlib/` root: repo-root sibling of `compiler/`. */
function defaultStdlibDir(): string {
  return join(defaultSrcDir(), "..", "..", "stdlib");
}

/** Recursively yield `.ts` / `.js` source files under `dir` (skips
 *  `node_modules` and dot-directories). Tolerant of unreadable dirs. */
function* walkSourceFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkSourceFiles(full);
    } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".js"))) {
      yield full;
    }
  }
}

const CODE_LITERAL = /(["'])((?:E|W|I)-[A-Z0-9_-]+)\1/g;

/**
 * The §34 error/warning/info code set, scanned live from quoted `(E|W|I)-*`
 * string literals across `compiler/src`. Over-inclusive by design (safe — see
 * the module header). Deduped + sorted.
 */
export function collectErrorCodes(srcDir: string = defaultSrcDir()): string[] {
  const codes = new Set<string>();
  for (const file of walkSourceFiles(srcDir)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    CODE_LITERAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CODE_LITERAL.exec(text)) !== null) codes.add(m[2]);
  }
  return [...codes].sort();
}

// ---------------------------------------------------------------------------
// keywords — tokenizer reserved set ∪ stdlib namespaces
// ---------------------------------------------------------------------------

/** stdlib module namespaces (`scrml:<dir>`) — one dir per module under `stdlib/`. */
function listStdlibNamespaces(stdlibDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(stdlibDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => "scrml:" + e.name);
}

/**
 * The keyword vocabulary: the tokenizer's reserved `KEYWORDS` set ∪ the stdlib
 * module namespaces (`scrml:data`, `scrml:http`, ...). Deduped + sorted.
 */
export function collectKeywords(stdlibDir: string = defaultStdlibDir()): string[] {
  const out = new Set<string>(KEYWORDS as Set<string>);
  for (const ns of listStdlibNamespaces(stdlibDir)) out.add(ns);
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

function uniqSorted(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

/**
 * Build the token-set for a compile. `metaFiles` is the orchestrator's per-file
 * resolved set (api.js). `vocab` injects the static sets for tests; the CLI
 * omits it so the collectors run their default `compiler/src` / `stdlib/` scans.
 *
 * The `version` is an fnv1a fingerprint of the CANONICAL body (`symbols`,
 * `errorCodes`, `keywords`) — it excludes itself (chicken-and-egg) and changes
 * iff the projected vocabulary changes.
 */
export function buildTokenSet(metaFiles: unknown, vocab?: TokenSetVocab): TokenSet {
  const symbols = collectSymbols(metaFiles);
  const errorCodes = vocab?.errorCodes ? uniqSorted(vocab.errorCodes) : collectErrorCodes();
  const keywords = vocab?.keywords ? uniqSorted(vocab.keywords) : collectKeywords();
  const body = JSON.stringify({ symbols, errorCodes, keywords });
  const version = fnv1aHash(body);
  return { version, symbols, errorCodes, keywords };
}

/**
 * Serialize a `TokenSet` to deterministic, pretty-printed JSON (2-space indent,
 * trailing newline). The fixed key-insertion order + pre-sorted arrays make the
 * output byte-stable across compiles for unchanged source.
 */
export function serializeTokenSet(ts: TokenSet): string {
  return JSON.stringify(ts, null, 2) + "\n";
}
