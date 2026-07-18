/**
 * @module codegen/log-loc
 *
 * §20.6 — `file:line` resolution for the location-transparent `log()` builtin.
 *
 * The `log()` lowering (emit-expr.ts) needs the AUTHOR-VISIBLE `file:line` of
 * the call site to bake into the origin tag `[server|client] msg (file:line)`.
 *
 * Why this module exists: an ExprNode's `span` carries the correct `file`
 * (absolute path) and `start` (BYTE OFFSET into the preprocessed source), but
 * its `line` field is NOT reliable — `parseExprToNode` / `esTreeToExprNode`
 * stamp `line: 1` because the line is parsed RELATIVE to the re-parsed
 * expression fragment, not the original file (verified empirically: a
 * `log("x")` node at offset 120 reports `{start:120,line:1}`). The byte offset,
 * however, is exact in source coordinates — so the line is recoverable by
 * indexing the file's source once and locating the offset, exactly as the
 * source-map builder does (`build-source-map.ts` → `LineIndex.locate`).
 *
 * Resolution happens at COMPILE time (the result is a literal string baked into
 * the emitted `_scrml_log(...)` call) so there is zero runtime offset work.
 *
 * The per-file source is REGISTERED by the codegen driver (`runCG`) before it
 * emits each file — the same `fileAST._sourceText` it already threads to the
 * source-map builder. A `file → LineIndex` cache keeps the line-start scan to
 * once per file. `span.file` on the node disambiguates which file's index to
 * use, so cross-file emission (component expansion) resolves correctly.
 */

import { LineIndex } from "./source-map.ts";

/** Minimal span shape this module reads (a subset of ExprSpan). */
export interface LogLocSpan {
  file?: string;
  start?: number;
  line?: number;
}

/** Per-compile registry of file source text, keyed by absolute file path. */
const _sourceByFile = new Map<string, string>();
/** Lazily-built LineIndex cache, keyed by absolute file path. */
const _indexByFile = new Map<string, LineIndex>();

/**
 * Register a file's source text so `resolveLogLoc` can map a byte offset to a
 * 1-based line. Called once per file by `runCG` before emission. Idempotent;
 * a re-register with the same text is a no-op, a different text rebuilds the
 * index (defensive — codegen processes one file's source at a time).
 */
export function registerFileSource(filePath: string, source: string): void {
  if (!filePath) return;
  if (_sourceByFile.get(filePath) === source) return;
  _sourceByFile.set(filePath, source ?? "");
  _indexByFile.delete(filePath);
}

/** Clear all registered sources (test isolation; new-compile hygiene). */
export function resetLogLoc(): void {
  _sourceByFile.clear();
  _indexByFile.clear();
}

function indexFor(filePath: string): LineIndex | null {
  if (!filePath) return null;
  const cached = _indexByFile.get(filePath);
  if (cached) return cached;
  const src = _sourceByFile.get(filePath);
  if (src === undefined) return null;
  const idx = new LineIndex(src);
  _indexByFile.set(filePath, idx);
  return idx;
}

/**
 * Resolve a span to the author-visible `file:line` string for a `log()` origin
 * tag. `file` is the BASENAME of the source path (the full absolute path is
 * noise in a terminal log line; the basename is what a printf-debugger reads).
 * `line` is 1-based, resolved from `span.start` against the registered source.
 *
 * Fallbacks (never throws, always returns a usable string):
 *   - no span / no file        → "" (caller omits the `(…)` suffix)
 *   - file registered, offset resolvable → "basename:line"
 *   - file NOT registered (harness bypassed runCG registration), but the span
 *     carries a >1 line → "basename:line" from the span's own line (best effort)
 *   - otherwise                 → "basename" (no line)
 */
export function resolveLogLoc(span: LogLocSpan | null | undefined): string {
  if (!span || typeof span.file !== "string" || !span.file) return "";
  const base = baseName(span.file);
  const idx = indexFor(span.file);
  if (idx && typeof span.start === "number" && span.start >= 0) {
    const { line } = idx.locate(span.start); // 0-indexed
    return `${base}:${line + 1}`;
  }
  // Best-effort: a span whose own line is meaningful (>1) when no source is
  // registered (e.g. a test that constructs spans directly).
  if (typeof span.line === "number" && span.line > 1) {
    return `${base}:${span.line}`;
  }
  return base;
}

/** Path basename without requiring node:path (codegen stays dependency-light). */
function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

// ---------------------------------------------------------------------------
// §20.6 — shadowing detection (Open-Q3).
//
// A user-declared `function log` / `fn log` anywhere in the file shadows the
// location-transparent builtin (file-scope functions are in scope across the
// whole file). `fileDeclaresLog` walks the file AST for any function/fn decl
// named `log`. The result is a per-file fact; the emitter consults it (a
// module-level flag, mirroring the production-strip toggle) so the lowering
// yields to the user `log` + fires W-LOG-SHADOWED. A LOCAL `let log` / param
// is handled separately via EmitExprContext.declaredNames (scope-precise).
// ---------------------------------------------------------------------------

const _FN_DECL_KINDS = new Set(["function-decl", "fn-decl", "function", "fn"]);

/**
 * True when the file declares a `function <name>` / `fn <name>` (any scope).
 * Generalised from `fileDeclaresLog` (ss16 C3) so the same builtin-shadowing
 * detection serves both `log` (§20.6) and `render` (the client component-render
 * builtin). File-scope functions are in scope across the whole file, so a
 * top-level decl named `<name>` shadows the same-named builtin everywhere.
 */
export function fileDeclaresFn(fileAST: unknown, name: string): boolean {
  const seen = new WeakSet<object>();
  let found = false;
  function walk(node: unknown): void {
    if (found || !node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Record<string, unknown>;
    if (_FN_DECL_KINDS.has(n.kind as string) && n.name === name) { found = true; return; }
    for (const key in n) {
      const v = n[key];
      if (Array.isArray(v)) { for (const c of v) walk(c); }
      else if (v && typeof v === "object") walk(v);
      if (found) return;
    }
  }
  const root = (fileAST as any)?.ast ?? fileAST;
  const nodes = (root as any)?.nodes ?? (fileAST as any)?.nodes ?? [];
  for (const n of nodes) { walk(n); if (found) break; }
  return found;
}

/** True when the file declares a `function log` / `fn log` (any scope). */
export function fileDeclaresLog(fileAST: unknown): boolean {
  return fileDeclaresFn(fileAST, "log");
}

/**
 * §20.7 — the print/println builtins a file shadows via a top-level
 * `function print` / `fn println` (any scope). Returns the subset of
 * `["print", "println"]` the file declares — each shadowed name yields to the
 * user binding across the whole file (mirrors `fileDeclaresLog`, name-precise
 * so a `function println` shadows ONLY `println`, not the `print` builtin).
 */
export function filePrintBuiltinsShadowed(fileAST: unknown): string[] {
  const out: string[] = [];
  if (fileDeclaresFn(fileAST, "print")) out.push("print");
  if (fileDeclaresFn(fileAST, "println")) out.push("println");
  return out;
}

/**
 * ss16 C3 — True when the file declares a `function render` / `fn render`
 * (any scope). Such a decl shadows the `render()` client component-render
 * builtin; the emitter yields to the user fn (mirrors `fileDeclaresLog`).
 */
export function fileDeclaresRender(fileAST: unknown): boolean {
  return fileDeclaresFn(fileAST, "render");
}

// §20.5 (B2.5, S266) — decl kinds that create a FILE-SCOPE binding capable of
// shadowing a reserved builtin: a `let`/`const`/`var` decl, a reactive
// `state-decl`, or a `function`/`fn` decl. (A `<engine>` also declares a cell, but
// its computed §51.0.C name is never a reserved builtin, so it is irrelevant here.)
const _FILE_SCOPE_BINDING_KINDS = new Set([
  "let-decl", "const-decl", "var-decl", "state-decl", "function-decl", "fn-decl", "function", "fn",
]);
// Nodes whose BODY / PARAMS introduce a NESTED (non-file) scope — a binding
// declared inside one of these is handler-local, NOT file-scope, and is handled
// scope-precisely by the emitter's `declaredNames` set, so the walk MUST NOT
// descend into their bodies (else a handler-local `let session` would wrongly set
// the whole-file shadow flag and disable the builtin in a SIBLING handler).
const _NESTED_SCOPE_KINDS = new Set(["function-decl", "fn-decl", "function", "fn", "lambda"]);
const _NESTED_SCOPE_BODY_KEYS = new Set(["body", "params"]);

/**
 * §20.5 (B2.5, S266) — True when the file declares a FILE-SCOPE binding named
 * `name` (a `let`/`const`/`var`/`state`/`function`/`fn` decl at file scope — NOT
 * inside a function/fn/lambda body). Used to detect a file-scope `let session`
 * that shadows the reserved server `session` establishment builtin (SPEC §20.5:
 * such a decl "binds cleanly today and shadows the builtin silently"). The walk
 * DOES record a top-level `function <name>` decl node itself, but does NOT descend
 * into ANY function/fn/lambda body (those bindings are handler-local — the
 * emitter's per-handler `declaredNames` set owns them).
 */
export function fileDeclaresFileScopeBinding(fileAST: unknown, name: string): boolean {
  const seen = new WeakSet<object>();
  let found = false;
  function walk(node: unknown): void {
    if (found || !node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Record<string, unknown>;
    if (_FILE_SCOPE_BINDING_KINDS.has(n.kind as string) && n.name === name) { found = true; return; }
    const isNestedScope = _NESTED_SCOPE_KINDS.has(n.kind as string);
    for (const key in n) {
      if (key === "span" || key === "loc") continue;
      // Do not descend into a function/fn/lambda BODY or PARAMS — those bind
      // handler-local names, not file-scope ones.
      if (isNestedScope && _NESTED_SCOPE_BODY_KEYS.has(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) { for (const c of v) walk(c); }
      else if (v && typeof v === "object") walk(v);
      if (found) return;
    }
  }
  const root = (fileAST as any)?.ast ?? fileAST;
  const nodes = (root as any)?.nodes ?? (fileAST as any)?.nodes ?? [];
  for (const n of nodes) { walk(n); if (found) break; }
  return found;
}

// ---------------------------------------------------------------------------
// §20.6 — server-inlined log() runtime.
//
// `.server.js` never imports the client runtime (emit-server.ts), so when a
// SERVER-side `log()` survives to emission its `_scrml_log` / `_scrml_log_render`
// helpers must be inlined at the top of the server module (the same pattern as
// `SERVER_WIRE_ENCODER_HELPER` / the structural-eq helper). Server `log()`
// prints to stdout/terminal — there is no browser-console / dev-forward leg.
//
// KEEP IN SYNC with the `log` chunk in compiler/src/runtime-template.js. The
// two copies are intentionally separate (client runtime is a template literal;
// the server inline is a plain hoisted function block) — the BEHAVIOUR must
// match: never throw, value-faithful render, `[side] msg (loc)` line.
// ---------------------------------------------------------------------------
export const SERVER_LOG_HELPER: string = String.raw`
// --- §20.6 log() runtime (inlined for server; no client runtime here) ---
function _scrml_log_render(v, depth, seen) {
  if (typeof depth === "undefined") depth = 0;
  if (typeof seen === "undefined") seen = [];
  if (v === null || typeof v === "undefined") return "not";
  var t = typeof v;
  if (t === "string") return v;
  if (t === "number" || t === "boolean") return String(v);
  if (t === "function") return "<fn>";
  if (depth > 8) return "...";
  if (v && typeof v === "object") {
    if (seen.indexOf(v) !== -1) return "<cycle>";
    seen = seen.concat([v]);
  }
  if (v && typeof v === "object" && (v.__scrml_markup === true || v.__scrml_el || (typeof v.tag === "string" && (typeof v.children !== "undefined" || typeof v.attrs !== "undefined" || typeof v.attributes !== "undefined")))) {
    var mtag = v.tag || v.__scrml_el || "markup";
    return "<" + String(mtag) + " …/>";
  }
  if (v && v.__scrml_map === true) {
    var mkeys = Object.keys(v.entries);
    var mparts = [];
    for (var mi = 0; mi < mkeys.length; mi++) {
      var ent = v.entries[mkeys[mi]];
      mparts.push(_scrml_log_render(ent.k, depth + 1, seen) + ": " + _scrml_log_render(ent.v, depth + 1, seen));
    }
    return "{" + mparts.join(", ") + "}";
  }
  if (Array.isArray(v)) {
    var aparts = [];
    for (var ai = 0; ai < v.length; ai++) aparts.push(_scrml_log_render(v[ai], depth + 1, seen));
    return "[" + aparts.join(", ") + "]";
  }
  if (v && typeof v._tag !== "undefined") {
    var tag = String(v._tag);
    var eKeys = Object.keys(v).filter(function (k) { return k !== "_tag"; }).sort();
    if (eKeys.length === 0) return tag;
    var eparts = [];
    for (var ei = 0; ei < eKeys.length; ei++) {
      eparts.push(eKeys[ei] + ": " + _scrml_log_render(v[eKeys[ei]], depth + 1, seen));
    }
    return tag + "(" + eparts.join(", ") + ")";
  }
  var sKeys = Object.keys(v).sort();
  var sparts = [];
  for (var si = 0; si < sKeys.length; si++) {
    sparts.push(sKeys[si] + ": " + _scrml_log_render(v[sKeys[si]], depth + 1, seen));
  }
  return "{" + sparts.join(", ") + "}";
}
function _scrml_log(side, loc) {
  var rendered = [];
  for (var i = 2; i < arguments.length; i++) {
    var piece;
    try { piece = _scrml_log_render(arguments[i]); }
    catch (e) { piece = "<unrenderable>"; }
    rendered.push(piece);
  }
  var body = rendered.join(" ");
  var locSuffix = (typeof loc === "string" && loc.length > 0) ? " (" + loc + ")" : "";
  var line = "[" + String(side) + "] " + body + locSuffix;
  if (typeof console !== "undefined" && typeof console.log === "function") {
    try { console.log(line); } catch (e) { /* never throw */ }
  }
}
`;

// ---------------------------------------------------------------------------
// §20.7 — print() / println() clean-stdout runtime helper.
//
// `print`/`println` write host `process.stdout` as RAW text — no origin tag,
// no `file:line`, no side classification (the deliberate contrast with
// `_scrml_log`). The codegen lowering (emit-expr.ts) pre-joins the args with a
// single space and appends `"\n"` for `println`, so this helper receives ONE
// already-joined string and writes it verbatim. Unlike `_scrml_log`, print is
// PROGRAM OUTPUT — it is NOT stripped in production.
//
// Inlined into a `kind="tool"` module (emit-tool.ts TOOL_RUNTIME_HELPERS) and
// into a web-app server bundle (emit-server.ts) whenever a `_scrml_print(`
// reference survives — the same on-use inline pattern as SERVER_LOG_HELPER.
// The `String(s)` fallback is defensive: E-PRINT-NON-PRIMITIVE (§20.7.2)
// already rejects non-primitive args at type-check, so `s` is a string here.
// ---------------------------------------------------------------------------
export const SERVER_PRINT_HELPER: string = String.raw`
// --- §20.7 print() / println() runtime (raw stdout, no decoration) ---
function _scrml_print(s) {
  try {
    if (typeof process !== "undefined" && process.stdout && typeof process.stdout.write === "function") {
      process.stdout.write(typeof s === "string" ? s : String(s));
    }
  } catch (e) { /* never throw */ }
}
`;
