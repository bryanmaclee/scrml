/**
 * @module commands/fix-s66
 * The mechanical §66.21 `scrml fix` rules — legacy declaration dialect → the §66 opener dialect.
 * change-id: s449-scrml-fix-s66-twins. Ruling: user-voice-scrml.md S449 "RULED — 'your recs.' —
 * corpus-dialect rulings 1–6" (ruling 6: the mechanical rules are built as the first real
 * `scrml fix`, in impl#1, because impl#1 has the legacy parser, the types and the writes).
 *
 * ═══ WHAT IT DOES ═══
 *
 * `fixS66(source, opts)` rewrites ONE file. It drives impl#1's live front end (splitBlocks +
 * buildAST) to find every legacy construct, and rewrites only at sites the AST located. A text
 * extent the rewrite needs (where an initializer ends) is re-parsed with impl#1's own expression
 * parser and compared to the AST's node (`deepEqualExprNode`) before it is used — a mismatch is a
 * blocker, never a guess.
 *
 * Rules (ids are stable; they appear in reports and in the counter's NOT-TWINNED reasons):
 *
 *   pre-migrate     the older `scrml migrate` rewrites (`< engine` whitespace, `<machine>`, `pure`,
 *                   `const @x`) — chained first, unchanged (migrate.js `applyMigrations`).
 *   rhs-decl        `<x> = v` / `<x>: T = v` / `<x attrs> = v` → `<x:T=v attrs/>` (locked) or
 *                   `let <x:T=v attrs/>`. §66.21 row 1 as amended S449 (dialect ruling 2): LOCKED
 *                   only when the cell is never written AND its initializer reads no cell;
 *                   otherwise `let` (seeded) — a reactive initializer never silently becomes derived.
 *   const-cell      `const <x> = expr` → `<x:T=(expr)/>` (locked; derived exactly when expr reads
 *                   cells — §66.9 rule 7, §66.21 row 2).
 *   engine-simple   `<engine for=T initial=.X [var=|name=]>…</>` → `<v:T=.X single>…</>` (§66.13.3,
 *                   §66.21 row 4). The state-children are carried verbatim. A legacy engine renders
 *                   where it is declared; a `single` declaration renders at `<*v/>` (O5 1i), so when
 *                   any state-child has a body, `<*v/>` is written right after the declaration.
 *   program-wrap    an entry file with no `<program>` root → wrapped in `<program>…</program>`.
 *   program-move    items above (or below) the entry's `<program>` → moved inside it.
 *   unwrap-logic    a `${ … }` block at markup depth 0 whose statements are all items → unwrapped
 *                   (§40.8 / S441: a bare run at a program body top means the same as inside `${}`).
 *
 * Types: an untyped legacy numeric literal is a JS `number` in impl#1 (impl#1 infers no `int`), so
 * the rewrite spells `:number` — `<count=0/>` would infer `int` under §66.3 rule 3 and change the
 * program (`@count / 2` becomes E-INT-DIVISION). A bare variant `.X` gets the enum that declares it
 * (exactly one declaring enum, this file or an aux file). Strings and booleans infer.
 *
 * Project: the files whose writes count are the ones impl#1 itself reaches — its front end's AST
 * and its module resolver (`moduleEdges` → `buildImportGraph`) give the import graph; no text
 * scanner. A file impl#1 cannot read, an import it cannot resolve, or an edge outside the project
 * makes every cell `let` (S239 re-review r4).
 *
 * Writes: a cell is WRITTEN if impl#1's tree yields a write event for it (`writeEvents`: every
 * ExprNode wherever it hangs, every raw string read with impl#1's own parsers — statements,
 * expressions, component bodies — and any string no parser reads counts as an `unknown` write of
 * every `@name` in it) OR a conservative lexical scan of every `@x` occurrence cannot prove it a
 * read. The text scan is only ever an ADDITIONAL reason (a union for the lock; a coverage check
 * for `:int`). Attributes that imply a write
 * (`server`, `pinned`, `persist=`, `reset-on=`, `debounced=`, `throttled=`) count, and a `^{}`
 * meta block makes every cell written. Erring this way only ever yields `let` where locked would
 * do — always meaning-preserving for a legacy cell, which carries the all-permissions grant.
 *
 * Anything else is a BLOCKER: left untouched and reported with a reason (Shape 2, Shape 4,
 * compound cells, components, written sequences, untyped non-literal initializers (O35),
 * render-by-tag `<x/>` of a cell, engines beyond the simple rule, exported cells, declarations
 * in a markup position (O38), top-level prose that a `<program>` body would read as code…).
 *
 * Idempotent: the output contains none of the legacy forms, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { parseExprToNode, deepEqualExprNode, captureTrailingContentWarnings, hasLostTrailingContent, parseStatements, esTreeToExprNode } from "../expression-parser.ts";
import { buildImportGraph, resolveModulePathNative } from "../module-resolver.js";
import { parseComponentBody } from "../component-expander.ts";
import { isUniversalCorePredicate } from "../validator-catalog.ts";
import { applyMigrations } from "./migrate.js";
import { compileScrml } from "../api.js";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The rules whose output impl#1 — the compiler adopters run — still compiles (verified per file). */
export const IMPL1_SAFE_RULES = Object.freeze(["pre-migrate", "program-wrap", "program-move", "unwrap-logic"]);
/** The §66 declaration rules: their output is the §66 opener dialect, which impl#1 does NOT compile. */
export const S66_DECL_RULES = Object.freeze(["rhs-decl", "const-cell", "engine-simple"]);

export const S66_RULES = Object.freeze([
  "pre-migrate",
  "rhs-decl",
  "const-cell",
  "engine-simple",
  "program-wrap",
  "program-move",
  "unwrap-logic",
]);

/** Opener modifiers carried verbatim into the §66 opener (§66.2.5 zone 2). */
const CARRIED_ATTRS = new Set(["server", "pinned", "persist", "debounced", "throttled", "reset-on", "default", "key"]);
/** Of those, the ones under which something other than this file's code writes the cell. */
const WRITE_IMPLYING_ATTRS = new Set(["server", "pinned", "persist", "reset-on", "debounced", "throttled"]);
/** Engine opener attributes the simple engine rule covers. */
// `name=` is NOT covered: §51.0.C makes it the engine's NAME (cross-file `<Name/>` mounting), not
// just its variable, and §66.21 row 4 rewrites only `for=` / `initial=`. `var=` names the variable,
// which O5 (RULED S435) makes the declaration's name.
const ENGINE_SIMPLE_ATTRS = new Set(["for", "initial", "var"]);
/** Methods whose call on a cell's value chain provably does not mutate it. */
const PURE_METHODS = new Set([
  "map", "filter", "slice", "includes", "indexOf", "lastIndexOf", "find", "findIndex", "findLast",
  "findLastIndex", "some", "every", "reduce", "reduceRight", "join", "concat", "toString", "at",
  "flat", "flatMap", "entries", "keys", "values", "forEach", "toUpperCase", "toLowerCase", "trim",
  "trimStart", "trimEnd", "startsWith", "endsWith", "split", "charAt", "charCodeAt", "padStart",
  "padEnd", "repeat", "replace", "replaceAll", "substring", "toFixed", "toPrecision", "localeCompare",
  "toSorted", "toReversed", "toSpliced", "with", "has", "get", "match", "search", "normalize",
]);
/**
 * Statement kinds a depth-0 `${}` may hold and still be unwrapped. S441 makes a bare run at a program
 * body top mean the same as inside `${}`, but impl#1 — whose behaviour adopters get — parses a
 * top-level control-flow statement (`while`, `for`, `if`) or a bare expression differently there
 * (measured: E-LOOP-007 vanishes, E-UNQUOTED-DISPLAY-TEXT appears). Items only; anything else keeps
 * its `${}` (legal §66).
 */
const UNWRAP_ITEM_KINDS = new Set([
  "state-decl", "function-decl", "type-decl", "import-decl", "export-decl", "engine-decl", "comment",
  "use-decl", "component-def",
]);
/** ExprNode kinds the rewrite may parenthesize as an ordinary expression. */
const PLAIN_EXPR_KINDS = new Set([
  "ident", "lit", "member", "index", "call", "binary", "unary", "ternary", "array", "object",
  "new", "cast", "lambda", "map-lit",
]);

// ---------------------------------------------------------------------------
// Small lexical helpers (position-exact; used only at AST-located sites)
// ---------------------------------------------------------------------------

const isIdStart = (ch) => /[A-Za-z_$]/.test(ch ?? "");
const isIdChar = (ch) => /[A-Za-z0-9_$]/.test(ch ?? "");

/** Index just past the string/template literal opening at i (src[i] is a quote). */
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") { j += 2; continue; }
    if (q === "`" && ch === "$" && src[j + 1] === "{") {
      j = skipBalanced(src, j + 1);
      continue;
    }
    if (ch === q) return j + 1;
    if (q !== "`" && ch === "\n") return j; // unterminated single-line string: stop at EOL
    j++;
  }
  return j;
}

/** src[i] is an opening bracket; return the index just past its match (strings skipped). */
function skipBalanced(src, i) {
  const open = src[i];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === "`") { j = skipString(src, j); continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return j;
}

/**
 * Scan a tag opener starting at `<` (index i). Returns { nameEnd, end, selfClosing } where `end`
 * is just past the closing `>` / `/>`, or null when no opener closes on depth 0.
 */
function scanOpener(src, i) {
  if (src[i] !== "<") return null;
  let j = i + 1;
  while (j < src.length && /[A-Za-z0-9_$\-]/.test(src[j])) j++;
  const nameEnd = j;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === "`") { j = skipString(src, j); continue; }
    if (ch === "{" || ch === "(" || ch === "[") { j = skipBalanced(src, j); continue; }
    if (ch === "/" && src[j + 1] === ">") return { nameEnd, end: j + 2, selfClosing: true };
    if (ch === ">") return { nameEnd, end: j + 1, selfClosing: false };
    j++;
  }
  return null;
}

/** Split an opener's attribute text into top-level tokens (`name`, `name=value`, `name(args)`). */
function splitAttrTokens(text) {
  const out = [];
  let j = 0;
  while (j < text.length) {
    while (j < text.length && /\s/.test(text[j])) j++;
    if (j >= text.length) break;
    const start = j;
    while (j < text.length && !/\s/.test(text[j])) {
      const ch = text[j];
      if (ch === '"' || ch === "'" || ch === "`") { j = skipString(text, j); continue; }
      if (ch === "{" || ch === "(" || ch === "[") { j = skipBalanced(text, j); continue; }
      j++;
    }
    out.push(text.slice(start, j));
  }
  return out;
}

const attrName = (tok) => (tok.match(/^[A-Za-z_$][\w$\-:]*/) ?? [""])[0];

/** 1-based line of an offset. */
function lineOf(src, off) {
  let n = 1;
  for (let k = 0; k < off && k < src.length; k++) if (src[k] === "\n") n++;
  return n;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

const SKIP_KEYS = new Set(["span", "initExpr", "exprNode", "argsExpr", "condExpr", "headerExpr", "derivedExprNode"]);

/** Visit every AST node with its ancestor chain (outermost first). */
function walkAst(root, fn) {
  const seen = new WeakSet();
  const stack = [];
  const visit = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    const isNode = typeof n.kind === "string";
    if (isNode) fn(n, stack);
    if (isNode) stack.push(n);
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
    if (isNode) stack.pop();
  };
  visit(root);
}

/** The cell an lvalue ExprNode is rooted at (`@x`, `@x.a`, `@x[0]`), or null. */
function lvalueRoot(e) {
  let cur = e;
  while (cur && (cur.kind === "member" || cur.kind === "index")) cur = cur.object;
  if (cur && cur.kind === "ident" && typeof cur.name === "string" && cur.name.startsWith("@")) return cur.name.slice(1);
  return null;
}

/** Enum variants by enum name, from every `type X:enum = { … }` in the given ASTs. */
function collectEnums(asts) {
  const enums = new Map();
  for (const ast of asts) {
    walkAst(ast, (n) => {
      if (n.kind !== "type-decl" || n.typeKind !== "enum" || typeof n.raw !== "string") return;
      const body = n.raw.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
      const variants = [];
      let depth = 0;
      let cur = "";
      for (const ch of body) {
        if (ch === "(" || ch === "{" || ch === "[") depth++;
        if (ch === ")" || ch === "}" || ch === "]") depth--;
        if ((ch === "," || ch === "\n") && depth === 0) { variants.push(cur); cur = ""; continue; }
        cur += ch;
      }
      variants.push(cur);
      const names = variants.map((v) => (v.trim().match(/^[A-Za-z_$][\w$]*/) ?? [null])[0]).filter(Boolean);
      enums.set(n.name, new Set(names));
    });
  }
  return enums;
}

/**
 * impl#1's front-end reading of a file (splitBlocks + buildAST), memoized per (path, source): the
 * AST and the error codes the block splitter / AST builder raised. null when the front end throws
 * or builds no AST — impl#1 cannot read the file.
 */
const FRONT_END_MEMO = new Map();
function frontEndMemo(filePath, source) {
  const key = `${filePath}\u0000${source}`;
  if (FRONT_END_MEMO.has(key)) return FRONT_END_MEMO.get(key);
  let r = null;
  try {
    r = captureTrailingContentWarnings(() => {
      const bs = splitBlocks(filePath, source);
      const built = buildAST(bs);
      if (!built || !built.ast) return null;
      const errorCodes = [...(bs.errors ?? []), ...(built.errors ?? [])]
        .filter((e) => e && typeof e.code === "string" && e.code.startsWith("E-") && e.severity !== "warning" && e.severity !== "info")
        .map((e) => e.code);
      return { ast: built.ast, errorCodes };
    }).result;
  } catch {
    r = null;
  }
  if (FRONT_END_MEMO.size > 4000) FRONT_END_MEMO.clear();
  FRONT_END_MEMO.set(key, r);
  return r;
}
/** The AST impl#1 builds for a project file, or null when it cannot read it. */
function parseAstMemo(filePath, source) {
  return frontEndMemo(filePath, source)?.ast ?? null;
}

function parseAst(filePath, source) {
  // The front end's "statement boundary" console warnings are about the INPUT; a fix run reports
  // through its own blockers, so they are captured here rather than printed.
  return captureTrailingContentWarnings(() => {
    const bs = splitBlocks(filePath, source);
    return buildAST(bs).ast;
  }).result;
}

/** Codes that describe the program SHAPE itself (what the structural rules exist to change). */
const SHAPE_LINT_CODES = new Set(["W-PROGRAM-001", "W-PROGRAM-REDUNDANT-LOGIC", "W-PROGRAM-SPA-INFERRED"]);

/**
 * impl#1's full compile of a source (write:false, in a scratch dir with the aux files beside it):
 * the sorted multiset of diagnostic codes, shape lints excluded. null when the compiler throws.
 */
function compiledCodes(filePath, source, auxSources) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-verify-"));
  try {
    // Mirror the file and its project (aux keys are absolute, or relative to the file's directory)
    // under one scratch root, keeping their relative layout so imports resolve as they do on disk.
    const self = resolve(filePath);
    const files = new Map([[self, source]]);
    for (const [p, s] of Object.entries(auxSources ?? {})) {
      const ap = absKey(filePath, p);
      if (ap !== self) files.set(ap, s);
    }
    const root = commonDir([...files.keys()]);
    let f = null;
    for (const [ap, s] of files) {
      const out = join(dir, relative(root, ap));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, s);
      if (ap === self) f = out;
    }
    // The verify compile is internal: its terminal output (Note(PA) lines, stage notices) is about
    // a scratch copy, so it is silenced for the duration and restored in `finally`.
    const saved = { log: console.log, warn: console.warn, error: console.error, out: process.stdout.write, err: process.stderr.write };
    let r;
    try {
      console.log = console.warn = console.error = () => {};
      process.stdout.write = process.stderr.write = () => true;
      r = captureTrailingContentWarnings(() => compileScrml({ inputFiles: [f], write: false, outputDir: join(dir, "out"), log: () => {} })).result;
    } finally {
      console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
      process.stdout.write = saved.out; process.stderr.write = saved.err;
    }
    return [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d?.code).filter((c) => typeof c === "string" && !SHAPE_LINT_CODES.has(c)).sort();
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An aux key as an absolute path: absolute keys stay, relative ones resolve against the file's dir. */
function absKey(filePath, key) {
  return isAbsolute(key) ? resolve(key) : resolve(dirname(resolve(filePath)), key);
}

/** The deepest directory containing every given absolute path. */
function commonDir(paths) {
  let parts = dirname(paths[0]).split(sep);
  for (const p of paths.slice(1)) {
    const q = dirname(p).split(sep);
    let i = 0;
    while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(sep) || sep;
}

/**
 * A file's module edges AS IMPL#1 READS THEM (S239 re-review r4 — the root fix): impl#1's front end
 * builds the file's AST, and impl#1's own module resolver (`buildImportGraph`, the MOD stage's graph
 * builder) resolves its import declarations. No text scanner decides what a file imports.
 *
 *   ok          impl#1 read the file: the front end built an AST and raised no `E-` code. A file it
 *               cannot read may hide an import — the caller treats it as unextracted.
 *   edges       absolute paths of every relative import / re-export target (impl#1's resolution).
 *               `scrml:` / `vendor:` modules are not project files and are not edges.
 *   unresolved  reasons impl#1 could not resolve an import: an `E-IMPORT-*` from the graph builder
 *               (E-IMPORT-006 missing file, E-IMPORT-005 bare specifier, host-import errors), or an
 *               import declaration with no readable source. Any → the caller treats every cell as
 *               possibly written by a file it cannot see.
 * Every `import-decl` node anywhere in the tree counts, not only the hoisted list impl#1 resolves —
 * one more edge only adds writes.
 * @returns {{ ok: boolean, edges: string[], unresolved: string[] }}
 */
export function moduleEdges(filePath, source) {
  const fe = frontEndMemo(filePath, source);
  if (!fe) return { ok: false, edges: [], unresolved: ["impl#1's front end could not read the file"] };
  const unresolved = fe.errorCodes.map((c) => `front end ${c}`);
  const edges = [];
  const ast = fe.ast;
  let graph;
  try {
    const built = buildImportGraph([{ filePath, ast }]);
    graph = built.graph;
    for (const e of built.errors ?? []) if (e && typeof e.code === "string" && e.code.startsWith("E-IMPORT")) unresolved.push(e.code);
  } catch (e) {
    return { ok: false, edges: [], unresolved: [`impl#1's module resolver threw: ${String(e?.message ?? e).split("\n")[0]}`] };
  }
  const isProjectSpec = (s) => !/^(?:scrml|vendor):/.test(s);
  const addSpec = (s) => {
    if (typeof s !== "string" || s.length === 0) { unresolved.push("an import with no readable source"); return; }
    if (!isProjectSpec(s)) return;
    if (!s.startsWith(".")) { unresolved.push(`non-relative import ${s}`); return; }
    edges.push(resolveModulePathNative(s, filePath));
  };
  // impl#1's resolved graph entry (imports it could resolve; E-IMPORT-006 ones are in `unresolved`).
  const entry = graph?.get(filePath);
  for (const imp of entry?.imports ?? []) addSpec(imp.source);
  // The hoisted import list, every `import-decl` in the tree, and every re-export source.
  const decls = new Set(Array.isArray(ast.imports) ? ast.imports : []);
  walkAst(ast, (n) => { if (n.kind === "import-decl") decls.add(n); });
  for (const d of decls) addSpec(d.source);
  const exportDecls = new Set(Array.isArray(ast.exports) ? ast.exports : []);
  walkAst(ast, (n) => { if (n.kind === "export-decl") exportDecls.add(n); });
  for (const ex of exportDecls) {
    if (!ex) continue;
    if (ex.reExportSource !== undefined && ex.reExportSource !== null) addSpec(ex.reExportSource);
    else if (ex.isReExportAll) unresolved.push("a re-export with no readable source");
    // An export declaration impl#1 built but could not read (`export type {…} from x`,
    // `export * from someVar`): what it re-exports is unknown — fail closed.
    else if (!ex.exportedName && !ex.exportKind) unresolved.push("an export declaration impl#1 could not read");
  }
  return { ok: fe.errorCodes.length === 0, edges: [...new Set(edges)], unresolved };
}

/**
 * impl#1's front-end reading of a source: its top-level `<program>` count and the diagnostic codes
 * the block splitter + AST builder raise (shape lints excluded). null when the front end throws.
 */
function frontEndReading(filePath, source) {
  try {
    return captureTrailingContentWarnings(() => {
      const bs = splitBlocks(filePath, source);
      const built = buildAST(bs);
      const nodes = Array.isArray(built.ast?.nodes) ? built.ast.nodes : [];
      const codes = new Set();
      for (const e of [...(bs.errors ?? []), ...(built.errors ?? [])]) if (e && typeof e.code === "string" && !SHAPE_LINT_CODES.has(e.code)) codes.add(e.code);
      return { programs: nodes.filter((n) => n.kind === "markup" && n.tag === "program").length, codes };
    }).result;
  } catch {
    return null;
  }
}

/**
 * Replace every comment (`//` to end of line, `/* … *\/`, `<!-- … -->`) with an inert placeholder,
 * strings skipped. `restore` puts the comments back.
 */
function maskComments(src) {
  const saved = [];
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "`") { const j = skipString(src, i); out += src.slice(i, j); i = j; continue; }
    let end = -1;
    if (ch === "/" && src[i + 1] === "/" && src[i - 1] !== ":") { end = src.indexOf("\n", i); if (end === -1) end = src.length; }
    else if (ch === "/" && src[i + 1] === "*") { end = src.indexOf("*/", i + 2); end = end === -1 ? src.length : end + 2; }
    else if (src.startsWith("<!--", i)) { end = src.indexOf("-->", i + 4); end = end === -1 ? src.length : end + 3; }
    if (end !== -1) { saved.push(src.slice(i, end)); out += `\u0001${saved.length - 1}\u0001`; i = end; continue; }
    out += ch;
    i++;
  }
  return { text: out, restore: (t) => t.replace(/\u0001(\d+)\u0001/g, (_, n) => saved[Number(n)]) };
}

/** A legacy declaration statement (line-leading), for the after-the-fact safety net. */
const LEGACY_DECL_LINE = /^[ \t]*(?:export[ \t]+)?(const[ \t]+)?<([A-Za-z_][\w]*)(?:[ \t][^<>\n]*)?>[ \t]*(?::[^=\n]*)?=(?![=>])/gm;
// ---------------------------------------------------------------------------
// The write set — read from impl#1's tree (S239 re-review r4, the root fix)
//
// Every write to a cell is a WRITE EVENT found in impl#1's AST of a file:
//   { name, w: "assign", op, value }   `@x = v` / `@x += v` … (value: an ExprNode, or null if unknown)
//   { name, w: "incdec" }              `@x++` / `@x--`
//   { name, w: "reset" }               `reset(@x)` (back to its initializer)
//   { name, w: "unknown" }             any write whose value cannot be judged (field / index write,
//                                      mutating method, destructuring target, bind:, ref=, `@set`,
//                                      `delete`, a `for (… of …)` target) — or ANY mention of the cell
//                                      in text impl#1 keeps raw that impl#1's parsers cannot read
//   { name, w: "div" }                 a READ as an operand of `/` (not a write; rules `int` out)
// Each event carries `span` — the source extent of the innermost AST node (not ExprNode) it was found
// in — so a lexical write site can be checked against the tree (see intWriteVerdict).
//
// BY CONSTRUCTION there is no list of "where expressions live": the walk visits EVERY object in the
// AST, classifies every ExprNode by its kind wherever it hangs, and sends EVERY string that mentions
// `@name` — whatever node and key holds it — through impl#1's own parsers:
//   1. parseStatements (impl#1's acorn-based ScrmlParser, `@x` identifiers) → the ESTree is classified;
//   2. else parseExprToNode (impl#1's scrml expression parser) read in full → the ExprNode is
//      classified the same way (its own strings recurse; the string itself again → unknown);
//   3. else every `@name` in the string is an `unknown` write (per occurrence, regardless of how
//      many other writes the cell has).
// A duplicate (a raw string impl#1 ALSO parsed into a node) only yields the same event twice.
// ---------------------------------------------------------------------------

/** ExprNode kinds (types/ast.ts ExprNode) — never an event's span owner (their spans are relative). */
const EXPR_KINDS = new Set([
  "ident", "lit", "array", "object", "spread", "unary", "binary", "assign", "ternary", "member", "index",
  "call", "new", "lambda", "cast", "match-expr", "map-lit", "sql-ref", "input-state-ref", "escape-hatch",
  "markup-value", "reset-expr", "update", "prop", "shorthand",
]);
const AT_NAME = /@([A-Za-z_$][\w$]*)/g;
const mentionsIn = (s) => [...s.matchAll(AT_NAME)].map((m) => m[1]);
/** Every `@name` mentioned in any string inside an object graph. */
function deepMentions(obj, out = new Set(), seen = new WeakSet()) {
  if (typeof obj === "string") { for (const n of mentionsIn(obj)) out.add(n); return out; }
  if (!obj || typeof obj !== "object" || seen.has(obj)) return out;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) if (k !== "span") deepMentions(v, out, seen);
  return out;
}

/** Root `@name` of an ESTree lvalue chain (`@x`, `@x.a`, `@x[i]`), or null. */
function esRoot(n) {
  let cur = n;
  while (cur && (cur.type === "MemberExpression" || cur.type === "ChainExpression")) cur = cur.type === "ChainExpression" ? cur.expression : cur.object;
  return cur && cur.type === "Identifier" && typeof cur.name === "string" && cur.name.startsWith("@") ? cur.name.slice(1) : null;
}
/** Every `@name` identifier in an ESTree subtree. */
function esMentions(n, out = new Set()) {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) { for (const x of n) esMentions(x, out); return out; }
  if (n.type === "Identifier" && typeof n.name === "string" && n.name.startsWith("@")) out.add(n.name.slice(1));
  if (n.type === "Literal" && typeof n.value === "string") for (const m of mentionsIn(n.value)) out.add(m);
  for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "range" && v && typeof v === "object") esMentions(v, out);
  return out;
}

/** Write events in an ESTree (impl#1's parseStatements output). */
function esEvents(root, filePath) {
  const ev = [];
  const unknown = (names) => { for (const n of names) if (n) ev.push({ name: n, w: "unknown" }); };
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    switch (n.type) {
      case "AssignmentExpression":
        if (n.left?.type === "Identifier" && n.left.name?.startsWith("@")) {
          let value = null;
          try { value = esTreeToExprNode(n.right, filePath, 0); } catch { value = null; }
          ev.push({ name: n.left.name.slice(1), w: "assign", op: n.operator, value });
        } else if (n.left?.type === "MemberExpression") unknown([esRoot(n.left)]);
        else unknown(esMentions(n.left)); // destructuring pattern: every cell named in it
        break;
      case "UpdateExpression":
        if (n.argument?.type === "Identifier" && n.argument.name?.startsWith("@")) ev.push({ name: n.argument.name.slice(1), w: "incdec" });
        else unknown([esRoot(n.argument)]);
        break;
      case "UnaryExpression":
        if (n.operator === "delete") unknown([esRoot(n.argument)]);
        break;
      case "CallExpression": {
        const c = n.callee?.type === "ChainExpression" ? n.callee.expression : n.callee;
        if (c?.type === "MemberExpression") {
          const pure = !c.computed && c.property?.type === "Identifier" && PURE_METHODS.has(c.property.name);
          if (!pure) unknown([esRoot(c.object)]);
        } else if (c?.type === "Identifier" && c.name === "reset") {
          const a = n.arguments?.[0];
          if (a?.type === "Identifier" && a.name?.startsWith("@") && n.arguments.length === 1) ev.push({ name: a.name.slice(1), w: "reset" });
          else unknown(esMentions(n.arguments));
        } else if (c?.type === "Identifier" && c.name === "@set") {
          unknown(esMentions(n.arguments));
          for (const a of n.arguments ?? []) if (a?.type === "Identifier") unknown([a.name.replace(/^@/, "")]);
        }
        break;
      }
      case "ForOfStatement":
      case "ForInStatement":
        unknown(esMentions(n.left));
        break;
      case "BinaryExpression":
        if (n.operator === "/") for (const o of [n.left, n.right]) if (o?.type === "Identifier" && o.name?.startsWith("@")) ev.push({ name: o.name.slice(1), w: "div" });
        break;
      default:
        break;
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "range" && v && typeof v === "object") visit(v);
  };
  visit(root);
  return ev;
}

/** Write events of one AST node (AST statement or ExprNode), structurally. */
function nodeEvents(n, push) {
  const unknown = (names) => { for (const x of names) if (x) push({ name: x, w: "unknown" }); };
  // impl#1's own reading (dependency-graph.ts): a non-structural state-decl that is not the folded
  // `const @x` derived form is a WRITE (`@x = v` in a function body / handler / logic block).
  if (n.kind === "state-decl" && n.name && (n._isReactiveAssign || (n.structuralForm === false && n.shape !== "derived"))) {
    push(n.initExpr ? { name: n.name, w: "assign", op: "=", value: n.initExpr } : { name: n.name, w: "unknown" });
  }
  if ((n.kind === "reactive-array-mutation" || n.kind === "reactive-nested-assign") && n.target) unknown([String(n.target).replace(/^@/, "")]);
  // `@set(…)`: the target is named in the raw args — every word there counts (over-approximation).
  if (n.kind === "reactive-explicit-set") unknown([...deepMentions(n), ...(typeof n.args === "string" ? n.args.match(/[A-Za-z_$][\w$]*/g) ?? [] : [])]);
  // `bind:attr=…` writes every cell its value names; so does `ref=…` (the element, at mount).
  if (n.kind === "markup" && Array.isArray(n.attrs)) {
    for (const a of n.attrs) {
      if (!a || typeof a.name !== "string" || !(a.name.startsWith("bind:") || a.name === "ref")) continue;
      unknown(deepMentions(a.value));
      if (a.value && typeof a.value.name === "string") unknown([a.value.name.replace(/^@/, "").split(/[.[]/)[0]]);
    }
  }
  if (n.kind === "assign") {
    const t = n.target ?? n.left;
    if (t && t.kind === "ident" && typeof t.name === "string" && t.name.startsWith("@")) push({ name: t.name.slice(1), w: "assign", op: n.op, value: n.value ?? null });
    else { const r = lvalueRoot(t); if (r) unknown([r]); else unknown(deepMentions(t)); }
  }
  if ((n.kind === "unary" || n.kind === "update") && (n.op === "++" || n.op === "--")) {
    const a = n.argument;
    if (a && a.kind === "ident" && typeof a.name === "string" && a.name.startsWith("@")) push({ name: a.name.slice(1), w: "incdec" });
    else { const r = lvalueRoot(a); if (r) unknown([r]); else unknown(deepMentions(a)); }
  }
  if (n.kind === "unary" && n.op === "delete") { const r = lvalueRoot(n.argument); unknown(r ? [r] : deepMentions(n.argument)); }
  if (n.kind === "reset-expr") {
    const t = n.target;
    if (t && t.kind === "ident" && typeof t.name === "string" && t.name.startsWith("@")) push({ name: t.name.slice(1), w: "reset" });
    else { const r = lvalueRoot(t); unknown(r ? [r] : deepMentions(t)); }
  }
  if (n.kind === "call" && n.callee && n.callee.kind === "member" && !PURE_METHODS.has(n.callee.property)) {
    const r = lvalueRoot(n.callee.object);
    if (r) unknown([r]);
  }
  if (n.kind === "call" && n.callee && n.callee.kind === "ident" && n.callee.name === "@set") unknown(deepMentions(n.args));
  if (n.kind === "binary" && n.op === "/") {
    for (const o of [n.left, n.right]) if (o && o.kind === "ident" && typeof o.name === "string" && o.name.startsWith("@")) push({ name: o.name.slice(1), w: "div" });
  }
}

/** Events of a raw string impl#1 holds, through impl#1's parsers (see the section header). */
function rawTextEvents(str, filePath, stack) {
  const names = [...new Set(mentionsIn(str))];
  if (names.length === 0) return [];
  if (stack.has(str)) return names.map((name) => ({ name, w: "unknown" }));
  // 1. statements (also any single expression)
  try {
    const r = parseStatements(str);
    if (r && r.ast && !r.error) return esEvents(r.ast, filePath);
  } catch { /* not statements */ }
  // 2. one scrml expression, read in full
  try {
    const e = captureTrailingContentWarnings(() => parseExprToNode(str, filePath, 0)).result;
    if (e && typeof e === "object" && e.kind !== "escape-hatch" && !hasLostTrailingContent(e)) {
      const seen = deepMentions(e);
      const out = names.filter((nm) => !seen.has(nm)).map((name) => ({ name, w: "unknown" })); // a dropped mention
      stack.add(str);
      try { walkEvents(e, filePath, (ev) => out.push(ev), null, stack); } finally { stack.delete(str); }
      return out;
    }
  } catch { /* not an expression */ }
  // 3. unreadable: every mention is a write of unknown kind
  return names.map((name) => ({ name, w: "unknown" }));
}

/**
 * The markup body of a component definition, as impl#1's component expander reads it: a
 * `component-def` node's `raw`, or — for `export const Name = <markup>` — the export-decl `raw` past
 * its `export const Name =` prefix (component-expander.ts, cross-file path (b)). null otherwise.
 */
function componentBodyOf(n) {
  if (typeof n.raw !== "string") return null;
  let body = null;
  if (n.kind === "component-def" && typeof n.name === "string") body = n.raw;
  else if (n.kind === "export-decl" && n.exportKind === "const" && typeof n.exportedName === "string") {
    const prefix = `export const ${n.exportedName} =`;
    const idx = n.raw.indexOf(prefix);
    if (idx !== -1) body = n.raw.slice(idx + prefix.length).trimStart();
  }
  return body !== null && body.trimStart().startsWith("<") ? body : null;
}

/**
 * Events of a component body, re-parsed with impl#1's OWN component-body parser
 * (component-expander.ts `parseComponentBody` — what the expander instantiates). A parse error, or
 * a `@name` of the body that the re-parsed nodes no longer mention (dropped text), → `unknown`.
 */
function componentEvents(body, name, filePath, stack) {
  const unknownAll = () => [...new Set(mentionsIn(body))].map((nm) => ({ name: nm, w: "unknown" }));
  let r;
  try {
    r = captureTrailingContentWarnings(() => parseComponentBody(body, name, filePath)).result;
  } catch {
    return unknownAll();
  }
  if (!r || !Array.isArray(r.nodes) || (r.errors ?? []).length > 0) return unknownAll();
  const seen = new Set();
  for (const n of r.nodes) deepMentions(n, seen);
  const out = [...new Set(mentionsIn(body))].filter((nm) => !seen.has(nm)).map((nm) => ({ name: nm, w: "unknown" }));
  walkEvents(r.nodes, filePath, (ev) => out.push(ev), null, stack, true);
  return out;
}

/**
 * Walk every object under `root`; push every event with its owner span. `fixed`: keep `ownerSpan`
 * for the whole subtree (a re-parsed body's own spans are relative to the body, not the file).
 */
function walkEvents(root, filePath, push, ownerSpan, stack, fixed = false) {
  const seen = new WeakSet();
  const visit = (n, owner) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) visit(x, owner); return; }
    const isNode = typeof n.kind === "string";
    let own = owner;
    if (!fixed && isNode && !EXPR_KINDS.has(n.kind) && n.span && typeof n.span.start === "number" && typeof n.span.end === "number") own = { start: n.span.start, end: n.span.end };
    if (isNode) nodeEvents(n, (ev) => push({ ...ev, span: own }));
    // A component definition's markup body is read with impl#1's component-body parser.
    const body = isNode ? componentBodyOf(n) : null;
    if (body !== null) for (const ev of componentEvents(body, n.name ?? n.exportedName, filePath, stack)) push({ ...ev, span: own });
    for (const [k, v] of Object.entries(n)) {
      if (k === "span" || (body !== null && k === "raw")) continue;
      if (typeof v === "string") { if (v.includes("@")) for (const ev of rawTextEvents(v, filePath, stack)) push({ ...ev, span: own }); }
      else if (v && typeof v === "object") visit(v, own);
    }
  };
  visit(root, ownerSpan);
}

const EVENTS_MEMO = new WeakMap();
/** Every write event in impl#1's AST of one file (memoized per AST object). */
export function writeEvents(ast, filePath = "input.scrml") {
  if (!ast || typeof ast !== "object") return [];
  if (EVENTS_MEMO.has(ast)) return EVENTS_MEMO.get(ast);
  const out = [];
  walkEvents(ast, filePath, (ev) => out.push(ev), null, new Set());
  EVENTS_MEMO.set(ast, out);
  return out;
}

/** Cells impl#1's AST shows as (possibly) written anywhere in the file. */
export function astWrites(ast, filePath) {
  return new Set(writeEvents(ast, filePath).filter((e) => e.w !== "div").map((e) => e.name));
}

/**
 * Lexical write classification of every `@name` occurrence: the offsets of the occurrences it
 * cannot prove a read. `isSequence` makes any bare use (a possible alias) a write. Comments are
 * NOT stripped — a mention in a comment counting as a write only yields `let`.
 * A TEXT check: it is used ONLY as an additional reason to fail closed (the LOCK path's union; the
 * `int` path's coverage check), never to clear a write the tree shows.
 */
export function lexicalWriteSites(src, name, isSequence) {
  const hits = [];
  const re = new RegExp(`@${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  occ: for (const m of src.matchAll(re)) {
    const at = m.index;
    if (at > 0 && (isIdChar(src[at - 1]) || src[at - 1] === ".")) continue;
    const hit = () => hits.push(at);
    const before = src.slice(Math.max(0, at - 80), at);
    if (/(\+\+|--)\s*$/.test(before)) { hit(); continue; }
    if (/\bbind:[\w-]+\s*=\s*(\$?\{\s*)?$/.test(before)) { hit(); continue; }
    if (/\bref\s*=\s*(\$?\{\s*)?$/.test(before)) { hit(); continue; }
    if (/\breset\s*\(\s*$/.test(before)) { hit(); continue; }
    if (/\bdelete\s+$/.test(before)) { hit(); continue; }
    // walk the member / index / call chain
    let j = at + m[0].length;
    let chainLen = 0;
    let lastWasLength = false;
    let lastWasPureCall = false;
    for (;;) {
      if (src[j] === "?" && src[j + 1] === ".") j++;
      if (src[j] === "." && isIdStart(src[j + 1])) {
        let k = j + 1;
        while (isIdChar(src[k])) k++;
        const prop = src.slice(j + 1, k);
        j = k;
        chainLen++;
        lastWasLength = prop === "length";
        lastWasPureCall = false;
        if (src[j] === "(") {
          if (!PURE_METHODS.has(prop)) { hit(); continue occ; }
          j = skipBalanced(src, j);
          lastWasPureCall = true;
          lastWasLength = false;
        }
        continue;
      }
      if (src[j] === "[") { j = skipBalanced(src, j); chainLen++; lastWasLength = false; lastWasPureCall = false; continue; }
      break;
    }
    let k = j;
    while (src[k] === " " || src[k] === "\t") k++;
    const rest = src.slice(k, k + 4);
    if (/^(\+\+|--)/.test(rest)) { hit(); continue; }
    if (/^(\*\*=|>>>=|<<=|>>=|&&=|\|\|=|\?\?=|[+\-*/%&|^]=)/.test(rest)) { hit(); continue; }
    if (rest[0] === "=" && rest[1] !== "=" && rest[1] !== ">") { hit(); continue; }
    if (isSequence) {
      if (chainLen > 0 && (lastWasLength || lastWasPureCall)) continue;
      if (chainLen === 0) {
        if (/\bin\s*=\s*$/.test(before) || /\bof\s+$/.test(before) || /\.\.\.\s*$/.test(before)) continue;
        if (/\$\{\s*$/.test(before) && /^\s*\}/.test(src.slice(j, j + 3))) continue;
      }
      hit(); // a bare use or element access of a sequence may alias it
    }
  }
  return hits;
}

/** Does the lexical scan find any occurrence of `@name` it cannot prove a read? */
export function lexicalWritten(src, name, isSequence) {
  return lexicalWriteSites(src, name, isSequence).length > 0;
}

/**
 * Cells a lifecycle construct requires to be writable: every `@x` named in `deps=[…]`,
 * `reset-on=[…]` or `when … changes` (§6.7.4 / §6.8.4 — each rejects a non-writable cell,
 * E-LIFECYCLE-007 / E-RESET-ON-NOT-WRITABLE). Over the raw text,
 * comments included (a false hit only yields `let`).
 */
export function lifecycleNamedCells(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:deps|reset-on)\s*=\s*(\[[^\]]*\]|\$?\{[^}]*\}|@[\w$]+)/g)) {
    for (const r of m[1].matchAll(/@([A-Za-z_$][\w$]*)/g)) out.add(r[1]);
  }
  // `when @a, @b changes { … }` — the keyword spelling of an effect's dependency list (§6.7.4).
  for (const m of src.matchAll(/\bwhen\s+([^{}\n]*?)\s+changes\b/g)) {
    for (const r of m[1].matchAll(/@([A-Za-z_$][\w$]*)/g)) out.add(r[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-cell resolution (S239 re-review r3, HIGH 2): which DECLARATION a `@name` in a given file
// refers to — that file's own declaration, else the declaration its `import { name }` names
// (transitively). Never a regex, never keyed on the name across the project. Unresolvable → null.
// ---------------------------------------------------------------------------

/** A legacy cell declaration node (not the `@x = v` write impl#1 also builds as a state-decl). */
const isCellDecl = (n) => n.kind === "state-decl" && n.structuralForm && !n._isReactiveAssign;

/**
 * A resolver over project files `[{ path, ast }]` (absolute paths; files[0] = the file being fixed).
 * `resolveCell(i, name)` → `{ file, decls }` (the declaring file index and its declaration nodes
 * of that name), or null when `@name` in files[i] resolves to no declaration the tool can see.
 */
function cellResolver(files) {
  const index = new Map();
  const info = (i) => {
    if (!index.has(i)) {
      const decls = new Map();
      const imports = [];
      walkAst(files[i].ast, (n) => {
        if (isCellDecl(n) && typeof n.name === "string") decls.set(n.name, [...(decls.get(n.name) ?? []), n]);
        if (n.kind === "import-decl" && typeof n.source === "string" && Array.isArray(n.specifiers)) imports.push(n);
      });
      index.set(i, { decls, imports });
    }
    return index.get(i);
  };
  const byPath = new Map(files.map((f, i) => [f.path, i]));
  const resolveCell = (i, name, seen = new Set()) => {
    const key = `${i}\u0000${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const { decls, imports } = info(i);
    if (decls.has(name)) return { file: i, decls: decls.get(name) };
    for (const im of imports) {
      const sp = im.specifiers.find((s) => s && (s.local === name || s.local === `@${name}`));
      if (!sp || !im.source.startsWith(".")) continue;
      const base = resolve(dirname(files[i].path), im.source);
      const j = byPath.get(base) ?? byPath.get(base + ".scrml");
      if (j === undefined) return null;
      return resolveCell(j, String(sp.imported ?? name).replace(/^@/, ""), seen);
    }
    return null;
  };
  /** Is `@name` in files[i] an `int` cell by its declaration's own annotation? Unresolvable → no. */
  const isIntCell = (i, name) => {
    const r = resolveCell(i, name);
    return !!r && r.decls.length > 0 && r.decls.every((d) => typeof d.typeAnnotation === "string" && /^(?:int|integer)$/.test(d.typeAnnotation.trim()));
  };
  return { resolveCell, isIntCell, info };
}

/** Every `@cell` identifier an ExprNode reads. */
function exprCellReads(e, out = new Set()) {
  if (!e || typeof e !== "object") return out;
  if (Array.isArray(e)) { for (const x of e) exprCellReads(x, out); return out; }
  if (e.kind === "ident" && typeof e.name === "string" && e.name.startsWith("@")) out.add(e.name.slice(1));
  for (const [k, v] of Object.entries(e)) if (k !== "span" && v && typeof v === "object") exprCellReads(v, out);
  return out;
}

/**
 * Cells of files[0] read by an `int`-annotated declaration's initializer (`<d>: int = @x * 2`) in
 * any project file — each read resolved per file to its declaration: an untyped integer cell
 * feeding one must be `int`, not `number`.
 */
function intReaderCells(files, resolver) {
  const out = new Set();
  files.forEach((f, i) => {
    for (const ds of resolver.info(i).decls.values()) {
      for (const d of ds) {
        if (typeof d.typeAnnotation !== "string" || !/^(?:int|integer)$/.test(d.typeAnnotation.trim())) continue;
        for (const x of exprCellReads(d.initExpr)) if (resolver.resolveCell(i, x)?.file === 0) out.add(x);
      }
    }
  });
  return out;
}

/** Is an ExprNode provably an integer? `isInt(name)` answers for a `@name` operand (`self` counts as int). */
function isIntegerExpr(e, isInt, self) {
  if (!e) return false;
  switch (e.kind) {
    case "lit":
      return e.litType === "number" && Number.isInteger(e.value) && !/[.eE]/.test(String(e.raw ?? ""));
    case "unary":
      return (e.op === "-" || e.op === "+") && isIntegerExpr(e.argument, isInt, self);
    case "binary":
      return ["+", "-", "*", "%"].includes(e.op) && isIntegerExpr(e.left, isInt, self) && isIntegerExpr(e.right, isInt, self);
    case "ident":
      return typeof e.name === "string" && e.name.startsWith("@") && (e.name.slice(1) === self || isInt(e.name.slice(1)));
    default:
      return false;
  }
}

/**
 * Every write to `@name` across the project, judged for integer-ness from the write EVENTS impl#1's
 * trees yield (writeEvents — structured nodes AND raw text, each event judged on its own):
 *   "int"      — each write is `@x = <integer expr>`, `@x += / -= / *= / %= <integer expr>`, `@x++` /
 *                `@x--`, or `reset(@x)` (back to its integer initializer);
 *   "not-int"  — some write's value is not provably integer, or the cell is an operand of `/`;
 *   "unknown"  — some write is of unknown kind (see writeEvents), OR a lexical write site of `@name`
 *                in a file lies outside every tree node that yielded a write event for it there (a
 *                write the tree did not surface — the text check only ever adds this reason).
 * Events are gathered by NAME across every project file (over-inclusion only makes the verdict
 * stricter); an OPERAND `@x` is `int` only by its own declaration as resolved from the file the
 * write sits in (`resolver.isIntCell`) — unresolvable → not int.
 * @param {Array<{ path: string, ast: object, source: string }>} files
 */
function intWriteVerdict(name, files, resolver) {
  let verdict = "int";
  const worse = (v) => { if (v === "unknown" || verdict === "int") verdict = verdict === "unknown" ? "unknown" : v; };
  for (let fi = 0; fi < files.length; fi++) {
    const isInt = (x) => resolver.isIntCell(fi, x);
    const evs = writeEvents(files[fi].ast, files[fi].path).filter((e) => e.name === name);
    for (const e of evs) {
      if (e.w === "assign") {
        if (!["=", "+=", "-=", "*=", "%="].includes(e.op) || !isIntegerExpr(e.value, isInt, name)) worse("not-int");
      } else if (e.w === "div") worse("not-int");
      else if (e.w === "unknown") worse("unknown");
    }
    // Coverage: every lexical write site must sit inside a tree node that yielded a write event.
    const covers = evs.filter((e) => e.w !== "div" && e.span).map((e) => e.span);
    for (const at of lexicalWriteSites(files[fi].source ?? "", name, false)) {
      if (!covers.some((s) => at >= s.start && at < s.end)) { worse("unknown"); break; }
    }
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// Initializer classification
// ---------------------------------------------------------------------------

/**
 * Classify a legacy initializer ExprNode. Returns
 *   { kind: "literal", type, valueText }      — a literal: reads no cell, no call
 *   { kind: "expr", valueText }               — any other plain expression (parenthesized)
 *   { kind: "blocked", reason }
 */
function classifyInit(e, text, annotation, enums) {
  const paren = (t) => `(${t.trim()})`;
  if (!e) return { kind: "blocked", reason: "initializer not parsed by impl#1" };
  if (!PLAIN_EXPR_KINDS.has(e.kind)) return { kind: "blocked", reason: `initializer kind '${e.kind}' (positional / escape-hatch form — §66.18)` };
  if (e.kind === "lit") {
    if (e.litType === "number") return { kind: "literal", type: annotation ?? "number", valueText: text.trim() };
    if (e.litType === "string") return { kind: "literal", type: annotation, valueText: text.trim() };
    if (e.litType === "bool" || e.litType === "boolean") return { kind: "literal", type: annotation, valueText: text.trim() };
    if (e.litType === "not") {
      if (!annotation) return { kind: "blocked", reason: "`not` initializer needs a type (CTX — O35)" };
      return { kind: "literal", type: annotation, valueText: "not" };
    }
    if (e.litType === "template") {
      if (e.hasInterpolation) return { kind: "expr", valueText: paren(text) };
      return { kind: "literal", type: annotation ?? "string", valueText: paren(text) };
    }
    return { kind: "blocked", reason: `literal type '${e.litType}'` };
  }
  if (e.kind === "ident" && typeof e.name === "string" && e.name.startsWith(".")) {
    const v = e.name.slice(1);
    if (annotation) return { kind: "literal", type: annotation, valueText: e.name };
    const owners = [...enums].filter(([, vs]) => vs.has(v)).map(([n]) => n);
    if (owners.length !== 1) return { kind: "blocked", reason: `bare variant ${e.name} declared by ${owners.length} enums (needs a type)` };
    return { kind: "literal", type: owners[0], valueText: e.name };
  }
  if (e.kind === "member" && e.object && e.object.kind === "ident" && enums.has(e.object.name) && enums.get(e.object.name).has(e.property)) {
    return { kind: "literal", type: annotation ?? e.object.name, valueText: paren(text) };
  }
  if (e.kind === "unary" && e.op === "-" && e.argument && e.argument.kind === "lit" && e.argument.litType === "number") {
    return { kind: "literal", type: annotation ?? "number", valueText: paren(text) };
  }
  if (e.kind === "array") {
    if (e.elements.length === 0) {
      if (!annotation) return { kind: "blocked", reason: "empty `[]` needs an element type (CTX — O35)" };
      return { kind: "literal", type: annotation, valueText: "[]", sequence: true };
    }
    const kinds = new Set(e.elements.map((x) => (x && x.kind === "lit" ? (x.litType === "boolean" ? "bool" : x.litType) : x && x.kind === "unary" && x.argument?.litType === "number" ? "number" : "other")));
    if (kinds.size !== 1 || ![...kinds].every((k) => k === "number" || k === "string" || k === "bool")) {
      if (!annotation) return { kind: "blocked", reason: "array of non-scalar / mixed elements needs a type (CTX — O35)" };
      return { kind: "expr", valueText: paren(text), sequence: true };
    }
    const el = [...kinds][0];
    return { kind: "literal", type: annotation ?? `${el}[]`, valueText: paren(text), sequence: true };
  }
  if (e.kind === "object" || e.kind === "map-lit") {
    if (!annotation) return { kind: "blocked", reason: "object literal needs a struct type (CTX)" };
    return { kind: "expr", valueText: paren(text) };
  }
  if (e.kind === "ident" && typeof e.name === "string" && e.name.startsWith("@") && /^@[A-Za-z_$][\w$]*$/.test(text.trim())) {
    if (!annotation) return { kind: "blocked", reason: "non-literal initializer needs a type (CTX — O35)" };
    return { kind: "expr", valueText: text.trim() };
  }
  if (!annotation) return { kind: "blocked", reason: "non-literal initializer needs a type (CTX — O35)" };
  return { kind: "expr", valueText: paren(text) };
}

/** Does a type expression contain whitespace outside every bracket (`string | not`)? */
function hasTopLevelSpace(t) {
  let depth = 0;
  const s = t.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (/\s/.test(ch) && depth === 0) return true;
  }
  return false;
}

const isSequenceType = (t) => typeof t === "string" && /\]\s*$/.test(t.trim());

// ---------------------------------------------------------------------------
// The declaration site parser
// ---------------------------------------------------------------------------

/**
 * Locate and parse the legacy declaration text for a `state-decl` node. Returns
 * { start, end, attrsText, annotation, exprStart, exprEnd } or { blocked: reason }.
 */
function parseDeclSite(src, node, filePath) {
  const name = node.name;
  const s0 = node.span?.start ?? -1;
  const re = new RegExp(`<${name.replace(/\$/g, "\\$")}(?![\\w$\\-])`, "g");
  let best = -1;
  for (const m of src.matchAll(re)) {
    if (Math.abs(m.index - s0) <= 64 && (best === -1 || Math.abs(m.index - s0) < Math.abs(best - s0))) best = m.index;
  }
  if (best === -1) return { blocked: "declaration text not found at the AST site" };
  let start = best;
  const pre = src.slice(Math.max(0, best - 40), best);
  const constM = pre.match(/\bconst\s+$/);
  if (node.isConst) {
    if (!constM) return { blocked: "`const` keyword not found before the derived declaration" };
    start = best - constM[0].length;
  }
  if (/\bexport\s+(const\s+)?$/.test(pre)) return { blocked: "exported cell (cross-file write set unknown — §66.14)" };
  const op = scanOpener(src, best);
  if (!op || op.selfClosing) return { blocked: "declaration opener not closed" };
  const attrsText = src.slice(op.nameEnd, op.end - 1).trim();
  let j = op.end;
  while (src[j] === " " || src[j] === "\t") j++;
  let annotation = null;
  if (src[j] === ":") {
    let k = j + 1;
    while (k < src.length) {
      const ch = src[k];
      if (ch === "\n") break;
      if (ch === '"' || ch === "'" || ch === "`") { k = skipString(src, k); continue; }
      if (ch === "(" || ch === "[" || ch === "{") { k = skipBalanced(src, k); continue; }
      if (ch === "=" && src[k + 1] !== "=" && src[k + 1] !== ">" && !/[<>!]/.test(src[k - 1])) break;
      k++;
    }
    annotation = src.slice(j + 1, k).trim();
    j = k;
  }
  while (src[j] === " " || src[j] === "\t") j++;
  if (src[j] !== "=" || src[j + 1] === "=") {
    return { blocked: annotation ? "typed declaration with no initializer (Shape 4 — O31/O33)" : "declaration with no `=` initializer" };
  }
  j++;
  while (src[j] === " " || src[j] === "\t") j++;
  const exprStart = j;
  // Candidate ends: each depth-0 newline / `;` / enclosing closer, verified against the AST.
  const target = node.initExpr;
  if (!target) return { blocked: "initializer not parsed by impl#1" };
  let k = exprStart;
  let depth = 0;
  let tries = 0;
  const tryEnd = (end) => {
    const text = src.slice(exprStart, end).replace(/\s+$/, "");
    if (!text) return null;
    try {
      const { result: parsed } = captureTrailingContentWarnings(() => parseExprToNode(text, filePath, exprStart));
      if (parsed && !hasLostTrailingContent(parsed) && deepEqualExprNode(parsed, target)) return exprStart + text.length;
    } catch { /* not this extent */ }
    return null;
  };
  while (k <= src.length && tries < 12) {
    const ch = src[k];
    if (k === src.length) { const e = tryEnd(k); if (e !== null) return finish(e); break; }
    if (ch === '"' || ch === "'" || ch === "`") { k = skipString(src, k); continue; }
    if (ch === "/" && src[k + 1] === "/" && depth === 0) {
      const e = tryEnd(k); if (e !== null) return finish(e);
      tries++;
      while (k < src.length && src[k] !== "\n") k++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; k++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) { const e = tryEnd(k); if (e !== null) return finish(e); break; }
      depth--; k++; continue;
    }
    if ((ch === "\n" || ch === ";") && depth === 0) {
      const e = tryEnd(k); if (e !== null) return finish(e);
      tries++;
    }
    k++;
  }
  return { blocked: "initializer extent could not be verified against impl#1's AST" };

  function finish(exprEnd) {
    let end = exprEnd;
    let m = end;
    while (src[m] === " " || src[m] === "\t") m++;
    if (src[m] === ";") end = m + 1;
    return { start, end, attrsText, annotation, exprStart, exprEnd };
  }
}

// ---------------------------------------------------------------------------
// fixS66
// ---------------------------------------------------------------------------

/**
 * @param {string} source
 * @param {{ filePath?: string, entry?: boolean, auxSources?: Record<string,string>, rules?: string[], verify?: boolean }} [opts]
 *   entry       the file is an application entry (program-wrap / program-move apply). Default true.
 *   auxSources  sibling files (path → source) consulted for enum declarations, and written beside
 *               the file for the verify compile.
 *   scanSources further files (path → source) read only for writes to this file's cells.
 *   rules       restrict to a subset of S66_RULES (default: all).
 *   verify      compile the structural-only rewrite with impl#1 and withdraw it unless the diagnostic
 *               codes are unchanged (default true).
 * @returns {{ output: string, changed: boolean, applied: Array<{rule:string,line:number,detail:string}>,
 *             blockers: Array<{rule:string,line:number,reason:string,snippet:string}> }}
 */
export function fixS66(source, opts = {}) {
  const filePath = opts.filePath ?? "input.scrml";
  const entry = opts.entry !== false;
  const enabled = new Set(opts.rules ?? S66_RULES);
  /** Any §66 declaration rule on: legacy-declaration blockers are reported only then. */
  const declMode = S66_DECL_RULES.some((r) => enabled.has(r));
  const applied = [];
  const blockers = [];

  let src = source;
  if (enabled.has("pre-migrate")) {
    // The older rules are text rewrites; comments are masked first so prose in a comment
    // (`// was <machine>`) is never rewritten.
    const masked = maskComments(src);
    const pm0 = applyMigrations(masked.text);
    const pm = { ...pm0, rewritten: masked.restore(pm0.rewritten) };
    pm.changed = pm.rewritten !== src;
    if (pm.changed) {
      // The older migrate rules are verified the same way as the structural ones: impl#1 must read
      // the migrated file with the same codes, aside from the codes those rules exist to clear (incl.
      // E-DEPRECATED-001, the hard error impl#1 now raises on `<machine>`).
      const PM_LINTS = new Set(["W-WHITESPACE-001", "W-DEPRECATED-001", "E-DEPRECATED-001", "W-PURE-DEPRECATED", "W-CONST-AT-DEPRECATED"]);
      const strip = (cs) => cs && cs.filter((c) => !PM_LINTS.has(c));
      const a = opts.verify === false ? [] : strip(compiledCodes(filePath, src, opts.auxSources));
      const b = opts.verify === false ? [] : strip(compiledCodes(filePath, pm.rewritten, opts.auxSources));
      if (a && b && a.join() === b.join()) {
        src = pm.rewritten;
        applied.push({ rule: "pre-migrate", line: 0, detail: JSON.stringify(pm.migrations) });
      } else {
        blockers.push({ rule: "pre-migrate", line: 0, reason: "the chained `scrml migrate` rewrites change impl#1's reading of this file — not applied", snippet: "" });
      }
    }
  }

  let ast;
  try {
    ast = parseAst(filePath, src);
  } catch (e) {
    blockers.push({ rule: "parse", line: 0, reason: `impl#1 front end threw: ${String(e?.message ?? e).split("\n")[0]}`, snippet: "" });
    return { output: source, changed: false, applied: [], blockers };
  }
  if (!ast) {
    blockers.push({ rule: "parse", line: 0, reason: "impl#1 front end built no AST", snippet: "" });
    return { output: source, changed: false, applied: [], blockers };
  }

  // The project: every other file (aux / resolved imports). Its ASTs feed the enum lookup AND the
  // write set — a component in another file can write this file's cell (an ambient `@count`).
  const project = Object.entries(opts.auxSources ?? {}).filter(([p]) => absKey(filePath, p) !== resolve(filePath));
  // scanSources: further files read ONLY for writes (the CLI passes the rest of the target tree).
  const projKeys = new Set(project.map(([q]) => absKey(filePath, q)));
  const scanOnly = Object.entries(opts.scanSources ?? {}).filter(([p]) => absKey(filePath, p) !== resolve(filePath) && !projKeys.has(absKey(filePath, p)));
  const auxAsts = [];
  const projectAsts = []; // parallel to `project` (null where impl#1 built no AST)
  let projectUnknown = false; // a file we cannot read for writes: every cell is then `let`
  for (const [p, s] of project) {
    const a = parseAstMemo(p, s);
    projectAsts.push(a);
    if (a) auxAsts.push(a); else projectUnknown = true;
  }
  const scanAsts = [];
  const scanOnlyAsts = []; // parallel to `scanOnly`
  for (const [p, s] of scanOnly) {
    const a = parseAstMemo(p, s);
    scanOnlyAsts.push(a);
    if (a) scanAsts.push(a); else projectUnknown = true;
  }
  // The import graph, AS IMPL#1 READS IT (moduleEdges: impl#1's front end + its module resolver).
  // A file impl#1 cannot read, an import it cannot resolve, or an edge to a file outside the
  // project hides a file that may write a cell → every cell is `let` (S239 re-review r4).
  const known = new Set([resolve(filePath), ...project.map(([p]) => absKey(filePath, p))]);
  const unextracted = [];
  for (const [p, s] of [[filePath, src], ...project]) {
    const base = p === filePath ? resolve(filePath) : absKey(filePath, p);
    const me = moduleEdges(base, s);
    if (!me.ok || me.unresolved.length > 0) unextracted.push(`${relative(dirname(resolve(filePath)), base) || basename(base)}: ${me.unresolved.join(", ") || "unreadable"}`);
    for (const target of me.edges) if (!known.has(target)) unextracted.push(`${relative(dirname(resolve(filePath)), base) || basename(base)}: import of ${target} is outside the project`);
  }
  if (unextracted.length > 0) projectUnknown = true;
  const enums = collectEnums([ast, ...auxAsts]);
  const block = (rule, off, reason) => {
    const ls = src.lastIndexOf("\n", off - 1) + 1;
    const le = src.indexOf("\n", off);
    blockers.push({ rule, line: lineOf(src, off), reason, snippet: src.slice(ls, le === -1 ? src.length : le).trim().slice(0, 120) });
  };

  const topNodes = Array.isArray(ast.nodes) ? ast.nodes : [];
  const programs = topNodes.filter((n) => n.kind === "markup" && n.tag === "program");
  const program = programs.length === 1 ? programs[0] : null;
  /** Is this node at markup depth 0 (file root, or a direct child of the single top-level program)? */
  const atDepth0 = (stack) => {
    const markups = stack.filter((a) => a.kind === "markup");
    if (markups.length === 0) return true;
    return markups.length === 1 && markups[0] === program;
  };

  // ---- collect the legacy sites --------------------------------------------------------------
  const decls = [];   // { node, stack }
  const engines = []; // { node, stack }
  const edits = [];   // { start, end, text, rule, detail }
  const tagUses = new Map(); // tag name → first offset (render-by-tag detection)
  const hasMeta = /\^\{/.test(src);
  const markupStarts = new Set();

  walkAst(ast, (n, stack) => {
    const off = n.span?.start ?? 0;
    if (n.kind === "state-decl" && n.structuralForm && !n._isReactiveAssign) decls.push({ node: n, stack: [...stack] });
    else if (n.kind === "engine-decl") engines.push({ node: n, stack: [...stack] });
    else if (n.kind === "component-def" && declMode) block("component-const", off, "component `const X = <root …>` (structural rewrite — §66.15; hand-migrate)");
    else if (n.kind === "theme-decl" && declMode) block("theme-body", off, "`<theme>` body (§66.17 — blocked on O17)");
    else if (n.kind === "export-decl" && declMode && typeof n.raw === "string" && /^export\s+(const\s+)?</.test(n.raw)) block("rhs-decl", off, "exported cell (cross-file write set unknown — §66.14)");
    else if (n.kind === "markup" && typeof n.tag === "string") {
      markupStarts.add(off);
      if (!tagUses.has(n.tag)) tagUses.set(n.tag, off);
    }
  });

  const cellNames = new Set(decls.map((d) => d.node.name));
  const engineNames = new Set(engines.map((e) => e.node.varName).filter(Boolean));
  for (const [tag, off] of declMode ? tagUses : []) {
    if (cellNames.has(tag) || engineNames.has(tag)) block("render-by-tag", off, `markup tag \`<${tag}>\` shares a cell's name — render-by-tag (→ \`<*${tag}/>\`, SAME-ARC) or a collision; in §66 it would be an instance of the declaration (CTX — §66.6.6)`);
  }
  for (const e of declMode ? engines : []) {
    if (e.node.governedType && tagUses.has(e.node.governedType)) {
      block("render-by-tag", tagUses.get(e.node.governedType), `\`<${e.node.governedType}/>\` mounts an engine by name (→ \`<*${e.node.varName}/>\`, CTX — §66.13.3)`);
    }
  }

  // Per-cell resolution over the project's ASTs (files[0] = this file): which declaration each
  // `@name` in each file refers to. `int`-ness is read from THAT declaration only (S239 r3 HIGH 2).
  const cellFiles = [
    { path: resolve(filePath), ast, source: src },
    ...project.map(([p, s], k) => ({ path: absKey(filePath, p), ast: projectAsts[k], source: s })),
    ...scanOnly.map(([p, s], k) => ({ path: absKey(filePath, p), ast: scanOnlyAsts[k], source: s })),
  ].filter((f) => f.ast);
  // The write set: every write event impl#1's trees yield, in every project file (writeEvents).
  const writes = new Set();
  for (const f of cellFiles) for (const w of astWrites(f.ast, f.path)) writes.add(w);
  const allSources = [src, ...project.map(([, s]) => s), ...scanOnly.map(([, s]) => s)];
  const lifecycleCells = new Set(allSources.flatMap((s) => [...lifecycleNamedCells(s)]));
  const resolver = cellResolver(cellFiles);
  const intReaders = intReaderCells(cellFiles, resolver);

  // ---- declarations ----------------------------------------------------------------------------
  for (const { node, stack } of decls) {
    const off = node.span?.start ?? 0;
    const rule = node.isConst ? "const-cell" : "rhs-decl";
    if (!enabled.has(rule)) continue;
    const parentDecl = stack.some((a) => a.kind === "state-decl");
    if (parentDecl) { block(rule, off, "field of a compound cell (Tier 2 — `<x:struct>` rewrite owed)"); continue; }
    if (Array.isArray(node.children) && node.children.length > 0) {
      block(rule, off, "compound cell with child declarations (Tier 2 — `<x:struct>` rewrite owed)");
      continue;
    }
    if (stack.some((a) => a.kind === "function-decl" || a.kind === "engine-decl")) { block(rule, off, "declaration inside a function / engine body"); continue; }
    if (!atDepth0(stack)) { block(rule, off, "declaration in a markup position (⚑ O38)"); continue; }
    if (node.shape === "decl-with-spec" || node.renderSpec) { block(rule, off, "Shape 2 `<x …> = <input …/>` (→ `renders`, CTX — ⚑ O25)"); continue; }
    if (node.isConst && node.shape !== "derived") { block(rule, off, `const declaration of shape '${node.shape}'`); continue; }
    if (!node.isConst && node.shape !== "plain") { block(rule, off, `declaration of shape '${node.shape}'`); continue; }
    const site = parseDeclSite(src, node, filePath);
    if (site.blocked) { block(rule, off, site.blocked); continue; }
    if (node.initExpr && (node.initExpr.kind === "markup" || /^</.test(src.slice(site.exprStart, site.exprStart + 1)))) {
      block(rule, off, "markup-valued initializer (⚑ O24)");
      continue;
    }
    // attributes
    const attrToks = splitAttrTokens(site.attrsText);
    const badAttr = attrToks.find((t) => {
      const nm = attrName(t);
      return !(CARRIED_ATTRS.has(nm) || isUniversalCorePredicate(nm));
    });
    if (badAttr) { block(rule, off, `opener attribute \`${badAttr}\` has no mechanical §66 spelling`); continue; }
    const writeAttr = attrToks.some((t) => WRITE_IMPLYING_ATTRS.has(attrName(t)));
    if (site.annotation && hasTopLevelSpace(site.annotation)) {
      block(rule, off, `type \`${site.annotation}\` has a space at its top level — how it stands in an opener is not ruled (§66.2.4 covers refinement / lifecycle types only)`);
      continue;
    }
    if (site.annotation && /^\{/.test(site.annotation.trim())) {
      block(rule, off, "anonymous record type annotation (no §66 spelling — a named `:struct` is owed)");
      continue;
    }
    const exprText = src.slice(site.exprStart, site.exprEnd);
    const cls = classifyInit(node.initExpr, exprText, site.annotation, enums);
    if (cls.kind === "blocked") { block(rule, off, cls.reason); continue; }
    const sequence = !!cls.sequence || isSequenceType(cls.type ?? site.annotation);
    let isLet = false;
    if (!node.isConst) {
      const written = hasMeta || writeAttr || projectUnknown || writes.has(node.name)
        || lifecycleCells.has(node.name) || allSources.some((s) => lexicalWritten(s, node.name, sequence));
      const readsNoCell = cls.kind === "literal";
      isLet = written || !readsNoCell; // S449 dialect ruling 2 (amended §66.21 row 1)
      if (isLet && sequence) {
        block(rule, off, written
          ? "written sequence — its grants are the least §66.12 axes its writes use (CTX — grants)"
          : "sequence with a reactive / non-literal initializer (`let` on a sequence is E-GRANT-LET-ON-SEQUENCE)");
        continue;
      }
    } else if (cls.kind === "literal" && !cls.type && !site.annotation) {
      // a literal derived value: the inferred type is fine (string / bool)
    }
    let type = cls.type ?? site.annotation ?? null;
    // An untyped integer literal is a JS number in impl#1 (`:number`), but a cell an `int`-typed
    // declaration reads must be `int` (else E-TYPE-031). `int` is chosen only when EVERY write to the
    // cell, in every project file, is provably integer from impl#1's AST (an integer literal, or an
    // integer expression of `int` cells); anything else — or any write the AST cannot classify —
    // leaves int-vs-number not mechanical: reported, untouched.
    if (!site.annotation && type === "number" && cls.kind === "literal" && /^-?\(?-?\d+\)?$/.test(cls.valueText) && intReaders.has(node.name)) {
      const v = projectUnknown || hasMeta || writeAttr ? "unknown" : intWriteVerdict(node.name, cellFiles, resolver);
      if (v !== "int") { block(rule, off, `an untyped integer cell feeds an \`int\`-typed reader, but its writes are ${v === "not-int" ? "not all provably integer" : "not all classifiable"} — \`int\` vs \`number\` is not mechanical`); continue; }
      type = "int";
    }
    if (node.isConst && !type && cls.kind !== "literal") { block(rule, off, "derived value needs a type (CTX — O35)"); continue; }
    const opener = `${isLet ? "let " : ""}<${node.name}${type ? `:${type}` : ""}=${cls.valueText}${attrToks.length ? " " + attrToks.join(" ") : ""}/>`;
    edits.push({ start: site.start, end: site.end, text: opener, rule, detail: opener });
  }

  // ---- engines -----------------------------------------------------------------------------------
  for (const { node, stack } of engines) {
    if (!enabled.has("engine-simple")) continue;
    const start = node.span?.start ?? -1;
    const end = node.span?.end ?? -1;
    if (start < 0 || !src.startsWith("<engine", start)) { block("engine-simple", start, "engine declaration text not found at the AST site"); continue; }
    if (!atDepth0(stack) || stack.some((a) => a.kind === "function-decl" || a.kind === "state-decl" || a.kind === "engine-decl")) {
      block("engine-simple", start, "engine in a nested / markup position (O38 / nested engine)");
      continue;
    }
    const op = scanOpener(src, start);
    if (!op) { block("engine-simple", start, "engine opener not closed"); continue; }
    const toks = splitAttrTokens(src.slice(op.nameEnd, op.end - (op.selfClosing ? 2 : 1)));
    const extra = toks.filter((t) => !ENGINE_SIMPLE_ATTRS.has(attrName(t)));
    if (extra.some((t) => attrName(t) === "name")) { block("engine-simple", start, "`name=` names the engine itself (§51.0.C — cross-file `<Name/>` mounting); §66.21 row 4 rewrites only `for=` / `initial=` — left untouched"); continue; }
    if (extra.length) { block("engine-simple", start, `engine surface beyond the simple rule: ${extra.map(attrName).filter(Boolean).join(", ")} (⚑ O5 surface)`); continue; }
    const get = (nm) => { const t = toks.find((x) => attrName(x) === nm); return t ? t.slice(nm.length + 1) : null; };
    const forT = get("for");
    const initial = get("initial");
    if (!forT || !/^[A-Za-z_$][\w$]*$/.test(forT)) { block("engine-simple", start, "engine without a plain `for=Type`"); continue; }
    if (!initial || !/^\.[A-Za-z_$][\w$]*$/.test(initial)) { block("engine-simple", start, "engine without a bare-variant `initial=.X`"); continue; }
    const v = node.varName;
    if (!v || !/^[A-Za-z_$][\w$]*$/.test(v)) { block("engine-simple", start, "engine variable name not derivable"); continue; }
    if (typeof node.rulesRaw === "string" && /<\s*engine\b/.test(node.rulesRaw)) { block("engine-simple", start, "nested engine (→ enum-valued child field, structural)"); continue; }
    const declOpen = `<${v}:${forT}=${initial} single`;
    let text;
    if (op.selfClosing) {
      text = `${declOpen}/>`;
    } else {
      const whole = src.slice(start, end);
      const closeM = whole.match(/<\/(engine)?>\s*$/);
      if (!closeM) { block("engine-simple", start, "engine closer not found at the AST span end"); continue; }
      const closeStart = start + whole.length - closeM[0].length;
      const body = src.slice(op.end, closeStart);
      const renders = (node.bodyChildren ?? []).some((c) =>
        c && c.kind === "markup" && ((Array.isArray(c.children) && c.children.some((g) => g && (g.kind !== "text" || /\S/.test(g.value ?? ""))))
          || (typeof c.shorthandBodyRaw === "string" && /\S/.test(c.shorthandBodyRaw.replace(/^\s*:/, "").replace(/^\s*""\s*$/, "")))));
      text = `${declOpen}>${body}</>${renders ? `\n<*${v}/>` : ""}`;
    }
    edits.push({ start, end: start + src.slice(start, end).replace(/\s+$/, "").length, text, rule: "engine-simple", detail: `<engine for=${forT} …> → <${v}:${forT}=${initial} single>` });
  }

  // ---- program root -----------------------------------------------------------------------------
  let structural = null; // { kind: "wrap" } | { kind: "move", ps, openEnd, closeStart, closeEnd }
  if (entry) {
    if (programs.length > 1) {
      // Two top-level programs is not a legacy form (E-PROGRAM-002 is a live rule): nothing to restructure.
    } else if (programs.length === 0) {
      if (enabled.has("program-wrap")) {
        const prose = topNodes.find((n) => n.kind === "text" && /\S/.test(n.value ?? ""));
        const page = topNodes.find((n) => n.kind === "markup" && n.tag === "page");
        if (page) block("program-wrap", page.span?.start ?? 0, "`<page>` root with no `<program>` (route-file shape — not wrapped)");
        else if (prose) block("program-wrap", prose.span?.start ?? 0, "top-level prose (a `<program>` body reads it as code — §4.18.1 / S441)");
        else if (/<program\b/.test(src)) block("program-wrap", 0, "a `<program>` the front end does not recognize as the root (malformed source)");
        else if (!topNodes.some((n) => n.kind === "markup")) {
          // No top-level markup element: impl#1 emits no page for such a file (a module / library, or a
          // file of only `<match>` / `^{}` / logic) — wrapping would turn it into an application. Not wrapped.
        } else structural = { kind: "wrap" };
      }
    } else if (enabled.has("program-move")) {
      const ps = program.span.start;
      const pe = program.span.end;
      const op = scanOpener(src, ps);
      const whole = src.slice(ps, pe);
      const closeM = whole.match(/<\/(program)?>\s*$/);
      if (op && closeM) {
        const closeStart = ps + whole.length - closeM[0].length;
        const outside = topNodes.filter((n) => n !== program);
        const movable = (n) => n.kind === "logic" || n.kind === "engine-decl" || n.kind === "comment" || (n.kind === "text" && !/\S/.test(n.value ?? ""));
        const strayMarkup = outside.find((n) => !movable(n));
        const substantive = outside.some((n) => n.kind === "logic" || n.kind === "engine-decl");
        if (strayMarkup && substantive) {
          block("program-move", strayMarkup.span?.start ?? 0, `\`${strayMarkup.kind}${strayMarkup.tag ? ` <${strayMarkup.tag}>` : ""}\` outside \`<program>\` (where it renders is not mechanical)`);
        } else if (substantive) {
          structural = { kind: "move", openEnd: op.end, closeStart, closeEnd: ps + whole.replace(/\s+$/, "").length, ps };
        }
      }
    }
  }

  // ---- depth-0 `${}` unwrap ------------------------------------------------------------------------
  // Only where the result is a program body: inside the single <program>, the items moved into
  // it, or a file being wrapped. Elsewhere (a module file, an outside block that stays outside)
  // an unwrapped run would land in a free-text body and become prose.
  const unwrapCandidates = structural?.kind === "wrap" ? topNodes
    : program ? [...(program.children ?? []), ...(structural?.kind === "move" ? topNodes.filter((n) => n !== program) : [])]
    : [];
  for (const n of unwrapCandidates) {
    if (!enabled.has("unwrap-logic")) break;
    if (n.kind !== "logic" || n._synthetic) continue;
    const s = n.span?.start ?? -1;
    const e = n.span?.end ?? -1;
    if (s < 0 || !src.startsWith("${", s) || src[e - 1] !== "}") continue;
    const stmts = Array.isArray(n.body) ? n.body : [];
    const bad = stmts.find((x) => x && !UNWRAP_ITEM_KINDS.has(x.kind) && !(x.kind === "text" && !/\S/.test(x.value ?? "")));
    if (bad) {
      // A block that holds no legacy construct can stay: `${}` at a body top is legal §66 (S441).
      const holdsLegacy = decls.some((d) => d.stack.includes(n)) || engines.some((d) => d.stack.includes(n));
      if (holdsLegacy && declMode) block("unwrap-logic", s, `top-level \`\${}\` holding a legacy declaration also holds a \`${bad.kind}\` statement, which impl#1 reads differently outside \`\${}\` (S441) — not unwrapped`);
      continue;
    }
    // Delete the delimiters; a delimiter alone on its line takes the line with it (readability).
    let os = s, oe = s + 2;
    const lineStart = src.lastIndexOf("\n", s - 1) + 1;
    const afterOpen = src.slice(oe).match(/^[ \t]*\n/);
    if (afterOpen) { oe += afterOpen[0].length; if (/^[ \t]*$/.test(src.slice(lineStart, s))) os = lineStart; }
    let cs = e - 1, ce = e;
    const closeLineStart = src.lastIndexOf("\n", cs - 1) + 1;
    const afterClose = src.slice(ce).match(/^[ \t]*(\n|$)/);
    if (afterClose && /^[ \t]*$/.test(src.slice(closeLineStart, cs)) && closeLineStart >= oe) { cs = closeLineStart; ce += afterClose[0].length; }
    edits.push({ start: os, end: oe, text: "", rule: "unwrap-logic", detail: "${" });
    edits.push({ start: cs, end: ce, text: "", rule: "unwrap-logic", detail: "}" });
  }

  // ---- safety net: a legacy form impl#1's AST did not surface is reported, never left silently ----
  const covered = (off) => edits.some((ed) => off >= ed.start && off < ed.end) || blockers.some((b) => b.line === lineOf(src, off));
  for (const m of declMode ? src.matchAll(LEGACY_DECL_LINE) : []) {
    const tag = m[2];
    const lt = m.index + m[0].indexOf("<");
    if (markupStarts.has(lt)) continue; // an element the front end parsed as markup (`<span>=</span>`)
    const off = m.index + m[0].indexOf(m[1] ? "const" : "<");
    if (covered(off) || covered(m.index + m[0].indexOf("<"))) continue;
    block(m[1] ? "const-cell" : "rhs-decl", off, "legacy declaration impl#1's front end did not surface as a declaration (left untouched)");
  }
  for (const m of declMode ? src.matchAll(/<engine\b/g) : []) {
    if (!covered(m.index)) block("engine-simple", m.index, "`<engine>` impl#1's front end did not surface as an engine declaration (left untouched)");
  }

  // ---- a declaration left at the root of a file that has no <program> after the fix ----------------
  // A bare legacy declaration at a no-program file root sits in impl#1's synthetic logic; its §66
  // opener there would be free-text prose. Such a site is reported, and its rewrite withdrawn.
  if (!program && structural?.kind !== "wrap") {
    for (let i = edits.length - 1; i >= 0; i--) {
      const ed = edits[i];
      if (ed.rule !== "rhs-decl" && ed.rule !== "const-cell" && ed.rule !== "engine-simple") continue;
      const d = decls.find((x) => x.node.span && lineOf(src, x.node.span.start) === lineOf(src, ed.start))
        ?? engines.find((x) => x.node.span && x.node.span.start === ed.start);
      const inSynthetic = d && d.stack.some((a) => a.kind === "logic" && a._synthetic);
      const atRoot = d && d.stack.filter((a) => a.kind === "logic" && !a._synthetic).length === 0;
      if (inSynthetic || atRoot) {
        block(ed.rule, ed.start, "declaration at the root of a file with no `<program>` (its §66 opener would be free-text there)");
        edits.splice(i, 1);
      }
    }
  }

  // ---- apply ------------------------------------------------------------------------------------
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end) {
      block("internal", edits[i].start, `overlapping rewrites (${edits[i - 1].rule} / ${edits[i].rule}) — file left untouched`);
      return { output: source, changed: false, applied: [], blockers };
    }
  }
  /** Assemble the output from the edits `keep` admits, restructured when `st` is given. */
  const assemble = (keep, st) => {
    const Ek = (a, b) => {
      let out = "";
      let cur = a;
      for (const ed of edits) {
        if (!keep(ed) || ed.start < a || ed.end > b) continue;
        out += src.slice(cur, ed.start) + ed.text;
        cur = ed.end;
      }
      return out + src.slice(cur, b);
    };
    if (st?.kind === "wrap") {
      const body = Ek(0, src.length).replace(/^\s*\n/, "").replace(/\s+$/, "");
      return `<program>\n${body}\n</program>\n`;
    }
    if (st?.kind === "move") {
      const pre = Ek(0, st.ps).replace(/^\s+/, "").replace(/\s+$/, "");
      const body = Ek(st.openEnd, st.closeStart).replace(/\s+$/, "");
      const post = Ek(st.closeEnd, src.length).replace(/^\s+/, "").replace(/\s+$/, "");
      const opener = src.slice(st.ps, st.openEnd);
      const closer = src.slice(st.closeStart, st.closeEnd);
      return `${opener}\n${pre}${body.startsWith("\n") ? "" : "\n"}${body}${post ? "\n" + post : ""}\n${closer}\n`;
    }
    return Ek(0, src.length);
  };
  // Self-check, on the rules impl#1 itself compiles: the structural-only rewrite (program-wrap /
  // program-move / unwrap-logic, no declaration rewrite) must mean the same TO IMPL#1 — one top-level
  // <program> when restructured, and (opts.verify, default on) the SAME multiset of diagnostic codes
  // from a full impl#1 compile (shape lints aside); without verify, no new front-end code. Otherwise
  // every structural edit is withdrawn and the reason reported (the declaration edits stand).
  const isStructEdit = (ed) => ed.rule === "unwrap-logic";
  if (structural || edits.some(isStructEdit)) {
    const structSrc = assemble(isStructEdit, structural);
    const before = frontEndReading(filePath, src);
    const after = frontEndReading(filePath, structSrc);
    const badCount = structural && (!after || after.programs !== 1);
    let changedCodes = null;
    if (before && after && !badCount) {
      if (opts.verify !== false) {
        const a = compiledCodes(filePath, src, opts.auxSources);
        const b = compiledCodes(filePath, structSrc, opts.auxSources);
        if (!a || !b) changedCodes = ["impl#1 compile threw"];
        else if (a.join() !== b.join()) {
          const lost = a.filter((c, i) => a.indexOf(c) === i && a.filter((x) => x === c).length > b.filter((x) => x === c).length);
          const gained = b.filter((c, i) => b.indexOf(c) === i && b.filter((x) => x === c).length > a.filter((x) => x === c).length);
          changedCodes = [...lost.map((c) => `-${c}`), ...gained.map((c) => `+${c}`)];
        }
      } else {
        const fresh = [...after.codes].filter((c) => !before.codes.has(c)).sort();
        if (fresh.length) changedCodes = fresh.map((c) => `+${c}`);
      }
    }
    if (!before || !after || badCount || changedCodes) {
      const what = structural ? (structural.kind === "wrap" ? "program-wrap" : "program-move") : "unwrap-logic";
      const why = badCount
        ? "the restructured file does not parse to one top-level `<program>` (malformed source)"
        : `impl#1 reads the restructured file differently (${changedCodes ? changedCodes.join(", ") : "front-end failure"})`;
      block(what, 0, `${why} — not restructured, no \`\${}\` unwrapped`);
      structural = null;
      for (let i = edits.length - 1; i >= 0; i--) if (isStructEdit(edits[i])) edits.splice(i, 1);
    }
  }
  const output = assemble(() => true, structural);
  if (structural?.kind === "wrap") applied.push({ rule: "program-wrap", line: 1, detail: "wrapped the file in <program>" });
  if (structural?.kind === "move") applied.push({ rule: "program-move", line: 1, detail: "moved items outside <program> inside it" });
  for (const ed of edits) {
    if (ed.rule === "unwrap-logic" && ed.detail === "}") continue;
    applied.push({ rule: ed.rule, line: lineOf(src, ed.start), detail: ed.detail });
  }
  return { output, changed: output !== source, applied, blockers };
}

/** Convenience: true when the file has nothing left for a human (every legacy site rewrote). */
export const isMechanical = (r) => r.blockers.length === 0;
