/**
 * @module commands/fix-client-server-call
 * The `scrml fix` rule `client-server-call` — SPEC §19.9.10 (S451): a client call to a
 * server-placed function is FAILABLE, whether or not the callee is declared `!`; an unhandled one is
 * E-ERROR-002. Ruling: user-voice-scrml.md S454 "all your recs, F3 with the deadline" — F8: *"the
 * §19.9.10 `scrml fix` rule (local `!{ .Transport(t) :> return }`, Info at the … client-function-body
 * sites where callers no longer abort)"*, built at S454 "then go on F8". change-id:
 * s454-scrml-fix-f8-r11.
 *
 * ═══ THE REWRITE ═══
 *
 * At an UNHANDLED client call `f(…)` of a server-placed `f` that is not declared `!`, the rule writes
 * the old behaviour out — a failed call stopped the rest of the code from running:
 *
 *     f(…)            →  f(…) !{ .Transport(_) :> { return } }
 *     @x = f(…)       →  @x = f(…) !{ .Transport(_) :> { return } }
 *     const v = f(…)  →  const v = f(…) !{ .Transport(_) :> { return } }
 *
 * The arm body is BRACED: §18.2 `arm-body ::= expression | block-body`, and `return` is a statement,
 * not an expression (the bootstrap rejects a bare `:> return` — E-SCOPE-001; measured S454 Phase 0,
 * docs/changes/s454-scrml-fix-f8-r11/progress.md). An event-handler value is written in the BRACED
 * form: `onclick=f()` → `onclick={ f() !{ .Transport(_) :> { return } } }` (impl#1 silently drops a
 * `!{}` written after an UNBRACED handler call — §19.4.3 carried gap). `return` is legal in a braced
 * handler: §5.2.3 makes it "the same statement grammar as a function body (§7.3)".
 *
 * Positions rewritten — the call is a whole STATEMENT (an expression statement, or the right-hand
 * side of a `const` / `let` declaration or a cell write `@x =`). NOT a `return`'s expression or a
 * plain reassignment `x = f()`: impl#1 mis-lowers a `!{}` there (it drops the success return /
 * re-declares the variable), so those are listed:
 *   - in the body of a CLIENT-placed function — plus an INFO per site: the local rewrite is not
 *     meaning-identical (before, the failure also aborted every awaiting caller; after, the callers
 *     continue — §19.9.10 "Migration");
 *   - in an event-handler value (braced block, or a bare call / bare assignment, which is braced;
 *     a one-line `${ f() }` / `${ @x = f() }` value that does not read `event` is written as the
 *     braced block, which means the same — §5.2.3).
 *
 * Positions LISTED, never rewritten (each needs a human): a call inside a larger expression (a value
 * position — load it with a `<request>`, §13.7), in a lifecycle body / `<request>`-less markup
 * position / body top / initializer / non-handler attribute, inside a closure or a handler / match
 * arm, a handler REFERENCE (`onclick=f`), a handled call whose `!{}` covers neither `.Transport` nor
 * a catch-all (a `! E` callee's handler naming only E's variants), a `match` on such a call, a
 * `?` on one (§19.9.10: the enclosing enum must declare `Transport(t: ServerCallError)`), and a
 * guarded `const`/`let` inside a nested block / loop or captured by a closure (impl#1 lowers it to a
 * shared function-scoped `var`), a call impl#1 runs in a Promise.all batch (read from its own
 * emitted client JS — a `.Transport` return would serialize the batch and change what a partial
 * failure writes), a call inside a statement-position `match` arm (`match-arm-*` nodes), and a
 * call in a FUNCTION of a module / route file (no top-level `<program>` in the PARSED tree and a
 * route path, or any file that declares
 * an `export` — stdlib modules are `<program>`-rooted and export): §19.9.10 F5 makes
 * "remote" a whole-program fact, and the importing program may place that function on the server.
 *
 * Not touched: a server→server call (the caller is server-placed), a `<request>` body's call, a
 * `<x server>` hydration load, a handled call whose `!{}` already covers the failure set.
 *
 * ═══ HOW IT LOCATES (AST-driven — Rule 7) ═══
 *
 * impl#1 compiles the file in its project (entry + resolved imports at a scratch path) with its
 * Route Inference result captured through the stage seam (`stageOverrides.RI`): placement is
 * impl#1's own whole-program answer, never a guess from text. The sites come from walking the
 * file's AST. impl#1's ExprNode spans are not source offsets, so the edit point is found from the
 * enclosing STATEMENT's (or attribute value's) source offset: the callee name followed by `(`,
 * its closing `)` matched by a string/comment-aware scanner, and the extent CONFIRMED by re-parsing
 * it with impl#1's own expression parser and comparing it to the AST's call node
 * (`deepEqualExprNode`). The text before the call must be the statement's own prefix and the text
 * after it must end the statement. Any check that fails makes the site a blocker — reported, never
 * guessed.
 *
 * ═══ THE GATE (transactional, per file) ═══
 *
 *   1. impl#1's front end re-reads the rewritten file: it must build a tree, with no new block
 *      splitter error.
 *   2. impl#1 re-compiles it in its project: the diagnostic codes (errors, warnings AND the lint
 *      channel) must be identical to before (the emitted artifacts change by design — the
 *      handler's lowering), except that W-/E-CPS-NEEDS-FAILABLE — the lint for exactly this
 *      unhandled call — may drop, and I-FN-PROMOTABLE (an impl#1 false positive, see
 *      TOLERATED_NEW_CODES) may appear.
 *   3. The rewritten sites are no longer unhandled (the re-read finds `edits` fewer sites).
 * Any failure reverts the WHOLE file and reports why.
 *
 * Idempotent: a rewritten call is handled, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { parseExprToNode, deepEqualExprNode, captureTrailingContentWarnings, hasLostTrailingContent } from "../expression-parser.ts";
import { compileScrml } from "../api.js";
import { runRI } from "../route-inference.ts";
import { parse as acornParse } from "acorn";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";

export const CLIENT_SERVER_CALL_RULE = "client-server-call";
/** The handler the rule writes after the call (S454 F8; braced arm body — §18.2). */
// The binder is `_`: the arm does not read the ServerCallError (both implementations accept
// `.Transport(_)` — measured S454 fix round; impl#1 then emits no unused binding).
export const TRANSPORT_HANDLER = "!{ .Transport(_) :> { return } }";

const LIFECYCLE_TAGS = new Set(["onMount", "onmount", "effect", "timer", "poll", "timeout", "engine", "onDismount"]);
const DECL_KINDS = new Set(["state-decl", "const-decl", "let-decl", "tilde-decl"]);
/** Bodies where a `return` does not leave the handler / function the call is in. */
// (impl#1 lowers a `defer { }` block to a try-stmt's `finallyNode`; the walk marks it `defer-stmt`.)
const SPECIAL_BODY_KINDS = new Set(["defer-stmt", "when-effect", "transaction-block", "cleanup-registration", "each-block", "for-expr", "if-expr", "lift-expr"]);
/** Codes the rewrite exists to clear (allowed to DROP after it, never to appear). */
const CLEARED_CODES = new Set(["W-CPS-NEEDS-FAILABLE", "E-CPS-NEEDS-FAILABLE"]);
/**
 * Codes allowed to APPEAR after the rewrite: I-FN-PROMOTABLE (an Info nudge). impl#1's purity probe
 * does not see a server call or a cell write inside a `!{}`-guarded statement, so after the rewrite
 * it suggests `fn` for a function that calls a server function — an impl#1 false positive, not a
 * change the rewrite makes to the program (measured S454 Phase 2: 25 corpus files).
 */
const TOLERATED_NEW_CODES = new Set(["I-FN-PROMOTABLE"]);

// ---------------------------------------------------------------------------
// Source scanning (locates a span the AST names; never decides anything)
// ---------------------------------------------------------------------------

const isIdent = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/** Index just past the string / template literal starting at `i`. */
function skipString(src, i) {
  const q = src[i];
  let k = i + 1;
  while (k < src.length) {
    const c = src[k];
    if (c === "\\") { k += 2; continue; }
    if (c === q) return k + 1;
    if (q === "`" && c === "$" && src[k + 1] === "{") { k = skipBalanced(src, k + 1); continue; }
    if (q !== "`" && c === "\n") return k;
    k++;
  }
  return k;
}

/** Index just past the comment starting at `i` (`//` or `/*`), or `i` when there is none. */
function skipComment(src, i) {
  if (src[i] !== "/") return i;
  if (src[i + 1] === "/") { const e = src.indexOf("\n", i); return e === -1 ? src.length : e; }
  if (src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); return e === -1 ? src.length : e + 2; }
  return i;
}

/** Index just past the bracket group opening at `i` (`(` / `[` / `{`), or -1 when unclosed. */
function skipBalanced(src, i) {
  const stack = [];
  let k = i;
  while (k < src.length) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") { k = skipString(src, k); continue; }
    if (c === "/" && (src[k + 1] === "/" || src[k + 1] === "*")) { k = skipComment(src, k); continue; }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      const open = stack.pop();
      if (!open || "([{".indexOf(open) !== ")]}".indexOf(c)) return -1;
      if (stack.length === 0) return k + 1;
    }
    k++;
  }
  return -1;
}

/** Candidate call starts: `name` (not a member, not part of a longer identifier) followed by `(`. */
function callCandidates(src, name, from, limit) {
  const out = [];
  let k = from;
  while (k < limit && k < src.length) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") { k = skipString(src, k); continue; }
    if (c === "/" && (src[k + 1] === "/" || src[k + 1] === "*")) { k = skipComment(src, k); continue; }
    if (src.startsWith(name, k) && !isIdent(src[k - 1]) && !isIdent(src[k + name.length])) {
      let p = k - 1;
      while (p >= 0 && (src[p] === " " || src[p] === "\t")) p--;
      let j = k + name.length;
      while (src[j] === " " || src[j] === "\t") j++;
      if (src[p] !== "." && src[j] === "(") out.push({ start: k, paren: j });
      k += name.length;
      continue;
    }
    k++;
  }
  return out;
}

/** Does the AST call node equal the parse of `text`? (`call` or a bare-handler `call-ref`.) */
function confirmsCall(text, node, filePath, offset) {
  let parsed;
  try {
    parsed = captureTrailingContentWarnings(() => parseExprToNode(text, filePath, offset)).result;
  } catch { return false; }
  if (!parsed || hasLostTrailingContent(parsed) || parsed.kind !== "call") return false;
  if (node.kind === "call") return deepEqualExprNode(parsed, node);
  if (node.kind === "call-ref") {
    if (parsed.callee?.kind !== "ident" || parsed.callee.name !== node.name) return false;
    const want = Array.isArray(node.argExprNodes) ? node.argExprNodes : null;
    if (!want) return (parsed.args ?? []).length === (node.args ?? []).length;
    if (want.length !== (parsed.args ?? []).length) return false;
    return want.every((a, i) => a && deepEqualExprNode(parsed.args[i], a));
  }
  return false;
}

/**
 * Find the call `node` (callee `name`) whose text starts in [from, limit]: returns `{ start, end }`
 * (end = just past its `)`) or null.
 */
function locateCall(src, node, name, from, limit, filePath) {
  for (const c of callCandidates(src, name, from, Math.min(limit + 1, src.length))) {
    const end = skipBalanced(src, c.paren);
    if (end < 0) continue;
    if (confirmsCall(src.slice(c.start, end), node, filePath, c.start)) return { start: c.start, end };
  }
  return null;
}

/** Does the statement end right after `end`? (only spaces/tabs, then a newline, `;`, `}`, a comment or EOF.) */
function endsStatement(src, end) {
  let k = end;
  while (src[k] === " " || src[k] === "\t") k++;
  if (k >= src.length) return true;
  const c = src[k];
  if (c === "\n" || c === "\r" || c === ";" || c === "}") return true;
  return c === "/" && (src[k + 1] === "/" || src[k + 1] === "*");
}

function lineOf(src, off) {
  let n = 1;
  for (let i = 0; i < off && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

// ---------------------------------------------------------------------------
// impl#1's reading: a compile in the project, Route Inference captured
// ---------------------------------------------------------------------------

function absKey(filePath, key) {
  return isAbsolute(key) ? resolve(key) : resolve(dirname(resolve(filePath)), key);
}
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

/** Build the scratch project once per file: `{ dir, target, run(text) }`. */
function scratchProject(filePath, source, auxSources) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-fix-csc-"));
  const self = resolve(filePath);
  const files = new Map([[self, source]]);
  for (const [p, s] of Object.entries(auxSources ?? {})) {
    const ap = absKey(filePath, p);
    if (ap !== self) files.set(ap, s);
  }
  const root = commonDir([...files.keys()]);
  let target = null;
  for (const [ap, s] of files) {
    const out = join(dir, "src", relative(root, ap));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, s);
    if (ap === self) target = out;
  }
  return { dir, target };
}

/**
 * Compile `text` (at the scratch target) and capture Route Inference. Returns `{ codes, ri, ast }`
 * — `ast` is the target file's AST as RI saw it — or `{ error }`.
 */
function compileWithRI(proj, text) {
  writeFileSync(proj.target, text);
  const saved = { log: console.log, warn: console.warn, error: console.error, out: process.stdout.write, err: process.stderr.write };
  let cap = null;
  let r = null;
  try {
    console.log = console.warn = console.error = () => {};
    process.stdout.write = process.stderr.write = () => true;
    r = captureTrailingContentWarnings(() => compileScrml({
      inputFiles: [proj.target], write: false, outputDir: join(proj.dir, "out"), log: () => {},
      stageOverrides: { RI: (args) => { const res = runRI(args); cap = { args, res }; return res; } },
    })).result;
  } catch (e) {
    if (!cap) return { error: `impl#1 threw compiling this file: ${String(e?.message ?? e).split("\n")[0]}` };
  } finally {
    console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
    process.stdout.write = saved.out; process.stderr.write = saved.err;
  }
  const codes = [...(r?.errors ?? []), ...(r?.warnings ?? []), ...(r?.lintDiagnostics ?? [])].map((d) => d?.code).filter((c) => typeof c === "string").sort();
  if (!cap) return { error: "impl#1 stopped before Route Inference on this file", codes };
  const files = cap.args.files ?? [];
  const me = files.find((f) => resolve(f.filePath ?? f.ast?.filePath ?? "") === resolve(proj.target));
  let clientJs = null;
  for (const [k, v] of r?.outputs ?? new Map()) if (resolve(k) === resolve(proj.target) && typeof v?.clientJs === "string") clientJs = v.clientJs;
  return { codes, ri: cap.res, files, ast: me ? (me.ast ?? me) : null, clientJs };
}

/**
 * impl#1's OWN batching decision (codegen/scheduling.ts `scheduleStatements`, §13.2): which server
 * calls it emitted as members of a `Promise.all([...])` batch. Read from the emitted client JS of
 * the BEFORE compile — not re-derived. Returns `{ inFn: Set<"fn::callee">, inHandler: Set<callee> }`,
 * or null when the client JS cannot be parsed (the caller then rewrites nothing in the file).
 */
export function promiseAllBatches(clientJs) {
  const out = { inFn: new Set(), inHandler: new Set() };
  // No batch can exist in output that never calls Promise.all (also covers client JS impl#1 emitted
  // malformed — that file fails impl#1's own emit gate whatever this rule does).
  if (!clientJs || !clientJs.includes("Promise.all")) return out;
  let ast;
  try { ast = acornParse(clientJs, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch { try { ast = acornParse(clientJs, { ecmaVersion: "latest", sourceType: "module" }); } catch { return null; } }
  const calleeOf = (n) => {
    const names = [];
    (function w(x) {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(w); return; }
      if (x.type === "CallExpression" && x.callee?.type === "Identifier") {
        const m = /^_scrml_(?:fetch|cps)_(.+)_\d+$/.exec(x.callee.name);
        if (m) names.push(m[1]);
      }
      if (/Function/.test(x.type ?? "")) return;
      for (const k of Object.keys(x)) if (k !== "loc" && k !== "start" && k !== "end") w(x[k]);
    })(n);
    return names;
  };
  (function walk(x, ctx) {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { for (const y of x) walk(y, ctx); return; }
    let here = ctx;
    if (x.type === "FunctionDeclaration" && x.id?.name) {
      const m = /^_scrml_(.+)_\d+$/.exec(x.id.name);
      here = m ? { fn: m[1] } : ctx;
    } else if (x.type === "Property" && /^_scrml_attr_/.test(String(x.key?.value ?? x.key?.name ?? ""))) {
      here = { handler: true };
    }
    if (x.type === "CallExpression" && x.callee?.type === "MemberExpression" && x.callee.object?.name === "Promise" && x.callee.property?.name === "all") {
      const arr = x.arguments?.[0];
      for (const el of arr?.type === "ArrayExpression" ? arr.elements : []) {
        for (const c of calleeOf(el)) {
          if (here?.fn) out.inFn.add(`${here.fn}::${c}`);
          else out.inHandler.add(c);
        }
      }
    }
    for (const k of Object.keys(x)) if (k !== "loc" && k !== "start" && k !== "end") walk(x[k], here);
  })(ast, null);
  return out;
}

/** Is the identifier `name` read inside a closure (lambda / nested function) anywhere under `scope`? */
function capturedByClosure(scope, name, self) {
  let hit = false;
  const seen = new WeakSet();
  (function w(x, inClosure) {
    if (hit || !x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) w(y, inClosure); return; }
    const closure = inClosure || ((x.kind === "lambda" || x.kind === "function-decl") && x !== self);
    if (closure && (x.kind === "ident" || x.kind === "variable-ref") && x.name === name) { hit = true; return; }
    for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k], closure);
  })(scope, false);
  return hit;
}

// ---------------------------------------------------------------------------
// Site collection
// ---------------------------------------------------------------------------

/** Does a `!{}` handler's arm list cover the `Transport` variant (by name or a catch-all)? */
export function armsCoverTransport(arms) {
  for (const a of arms ?? []) {
    const p = String(a?.pattern ?? "").trim();
    if (p === "_" || p === "else") return true;
    if (/^(?:[A-Z]\w*)?(?:\.|::)Transport$/.test(p)) return true;
    // impl#1 reads a lone lower-case binder (`| e :>`) as the whole-error arm.
    if (/^[a-z_]\w*$/.test(p)) return true;
  }
  return false;
}

/** Visit every object node once. */
function walkObjects(root, fn) {
  const seen = new WeakSet();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    if (!Array.isArray(n)) fn(n);
    for (const k of Object.keys(n)) if (k !== "parent" && n[k] && typeof n[k] === "object") stack.push(n[k]);
  }
}

/** Is the identifier `name` read anywhere in the ExprNode? */
function mentionsIdent(node, name) {
  let hit = false;
  const seen = new WeakSet();
  (function w(x) {
    if (hit || !x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { x.forEach(w); return; }
    if (x.kind === "ident" && x.name === name) { hit = true; return; }
    for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k]);
  })(node);
  return hit;
}

/** Same diagnostic codes before and after — except that a CLEARED_CODES code may drop. */
function sameCodes(before, after) {
  const count = (xs) => xs.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map());
  const a = count(before);
  const b = count(after);
  for (const c of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(c) ?? 0;
    const y = b.get(c) ?? 0;
    if (x === y) continue;
    if (CLEARED_CODES.has(c) && y < x) continue;
    if (TOLERATED_NEW_CODES.has(c) && y > x) continue;
    return false;
  }
  return true;
}

/** The expression a statement evaluates as its whole value (null for other kinds). */
function wholeExprOf(stmt) {
  if (!stmt || typeof stmt !== "object") return null;
  if (stmt.kind === "bare-expr") return stmt.exprNode?.kind === "assign" ? stmt.exprNode.value : stmt.exprNode;
  if (DECL_KINDS.has(stmt.kind)) return stmt.initExpr;
  if (stmt.kind === "return-stmt") return stmt.exprNode ?? stmt.expr;
  return null;
}

/**
 * Walk the file's AST; classify every call of a server-placed function.
 * Returns `{ sites }`; a site is `{ action: "rewrite" | "list" | "skip", ... }`.
 */
function collectSites(ast, ri, files, isEntry = true, batches = { inFn: new Set(), inHandler: new Set() }) {
  const boundary = new Map(); // name -> "server" | "client" | "mixed"
  for (const [, f] of ri?.routeMap?.functions ?? []) {
    if (!f?.functionName) continue;
    const b = f.boundary === "server" || f.boundary === "middleware" ? "server" : "client";
    const prev = boundary.get(f.functionName);
    boundary.set(f.functionName, prev && prev !== b ? "mixed" : b);
  }
  const canFail = new Map();
  const seenD = new WeakSet();
  for (const f of files ?? []) (function w(x) {
    if (!x || typeof x !== "object" || seenD.has(x)) return;
    seenD.add(x);
    if (Array.isArray(x)) { x.forEach(w); return; }
    if (x.kind === "function-decl" && x.name) canFail.set(x.name, !!x.canFail || !!canFail.get(x.name));
    for (const k of Object.keys(x)) if (k !== "parent") w(x[k]);
  })(f.ast ?? f);
  const isServer = (n) => boundary.get(n) === "server";
  const sites = [];
  const seen = new WeakSet();

  const classify = (call, name, anc) => {
    // Context indices.
    let fi = -1;
    for (let i = anc.length - 1; i >= 0; i--) if (anc[i].kind === "function-decl") { fi = i; break; }
    const fn = fi >= 0 ? anc[fi] : null;
    let ai = -1;
    for (let i = anc.length - 1; i > fi; i--) if (anc[i].__cscAttr) { ai = i; break; }
    const attr = ai >= 0 ? anc[ai] : null;
    const ctxIdx = Math.max(fi, ai);
    const local = anc.slice(ctxIdx + 1);
    const where = local.concat().reverse().find((a) => a.span && typeof a.span.start === "number") ?? attr?.__cscValue ?? fn ?? null;
    const at = where?.span?.start ?? 0;
    const base = { name, at, fn: fn?.name ?? null };

    if (fn && fn.name && isServer(fn.name)) return { ...base, action: "skip", why: "server→server" };
    if (boundary.get(name) === "mixed") return { ...base, action: "list", kind: "ambiguous", reason: `\`${name}\` names more than one function with different placements in this project — check this call by hand` };
    if (anc.some((a) => a.kind === "markup" && a.tag === "request")) return { ...base, action: "skip", why: "<request> body" };
    if (anc.some((a) => a.kind === "state-decl" && a.isServer)) return { ...base, action: "skip", why: "<x server> hydration load" };

    // Handled? The call is the whole expression of a statement that a guarded-expr guards.
    const parent = anc[anc.length - 1];
    const stmt = parent?.kind === "assign" ? anc[anc.length - 2] : parent;
    const whole = stmt && wholeExprOf(stmt) === call;
    const guard = whole ? anc[anc.indexOf(stmt) - 1] : null;
    if (guard && guard.kind === "guarded-expr" && guard.guardedNode === stmt) {
      if (armsCoverTransport(guard.arms)) return { ...base, action: "skip", why: "handled" };
      return {
        ...base, action: "list", kind: "handled-not-covering",
        reason: `the \`!{}\` on this call of \`${name}\` names neither \`.Transport(t)\` nor a catch-all — a client call of a server function also fails with \`Transport(t: ServerCallError)\` (§19.9.10); add the arm you want (e.g. \`.Transport(_) :> { return }\`)`,
      };
    }
    if (parent && (parent.kind === "match-expr" || parent.kind === "match-stmt" || parent.kind === "match-block")) {
      return { ...base, action: "list", kind: "match", reason: `a \`match\` on a call of server function \`${name}\` — confirm it covers \`.Transport(t)\` (§19.9.10)` };
    }
    if (parent && parent.kind === "propagate-expr") {
      return { ...base, action: "list", kind: "propagate", reason: `\`?\` on a client call of server function \`${name}\` — the enclosing function's error enum must declare \`Transport(t: ServerCallError)\` (§19.9.10)` };
    }
    if (canFail.get(name)) return { ...base, action: "skip", why: "declared `!` (already E-ERROR-002 when unhandled)" };

    // Unhandled, non-`!` callee.
    if (local.some((a) => a.kind === "lambda" || a.kind === "function-decl")) {
      return { ...base, action: "list", kind: "closure", reason: `a call of server function \`${name}\` inside a closure — a \`return\` there would leave only the closure; handle it by hand (§19.9.10)` };
    }
    const special = local.find((a) => SPECIAL_BODY_KINDS.has(a.kind));
    if (special) {
      return { ...base, action: "list", kind: "special-body", reason: `a call of server function \`${name}\` inside a \`${special.kind}\` body — a \`return\` there does not mean "stop here" (e.g. E-DEFER-CONTROL-FLOW); handle it by hand (§19.9.10)` };
    }
    if (local.some((a) => a.__cscArm || /^match-arm/.test(a.kind ?? ""))) {
      return { ...base, action: "list", kind: "arm", reason: `a call of server function \`${name}\` inside a handler / match arm — handle it by hand (§19.9.10)` };
    }
    if (attr && !attr.__cscHandler) {
      return { ...base, action: "list", kind: "value-position", reason: `a call of server function \`${name}\` in an attribute value — a value position (E-VALUE-SERVER-CALL, §13.7): load it with a \`<request>\`` };
    }
    if (!fn && !attr) {
      if (anc.some((a) => a.kind === "markup" && LIFECYCLE_TAGS.has(a.tag))) {
        return { ...base, action: "list", kind: "lifecycle", reason: `a call of server function \`${name}\` in a lifecycle body — handle it by hand (§19.9.10)` };
      }
      if (anc.some((a) => a.kind === "state-decl")) {
        return { ...base, action: "list", kind: "value-position", reason: `a call of server function \`${name}\` in an initializer — a value position (E-VALUE-SERVER-CALL, §13.7): load it with a \`<request>\`` };
      }
      return { ...base, action: "list", kind: "body-top", reason: `a call of server function \`${name}\` at the body top — handle it by hand (§19.9.10)` };
    }
    // The call must be a whole statement (directly under it, or under its assignment).
    const unbraced = attr && attr.__cscHandler && !attr.__cscBraced;
    if (unbraced) {
      const v = attr.__cscValue;
      const top = v.kind === "call-ref" ? v : (v.exprNode?.kind === "assign" ? v.exprNode.value : v.exprNode);
      if (top !== call) {
        return { ...base, action: "list", kind: "value-position", reason: `a call of server function \`${name}\` inside a larger handler expression — handle it by hand (§19.9.10)` };
      }
      // impl#1 adds `event.preventDefault()` only to a BARE `onsubmit=f()` (the call-ref path,
      // emit-event-wiring.ts); written braced, the form would submit natively (measured S454
      // Phase 2: examples/19-lin-token, two samples). Not rewritten.
      if (v.kind === "call-ref" && /^onsubmit$/i.test(attr.__cscName ?? "")) {
        return { ...base, action: "list", kind: "onsubmit-bare", reason: `a bare \`onsubmit=${name}(…)\` handler: impl#1 calls \`event.preventDefault()\` only for this bare form, so writing it braced would let the form submit natively — handle it by hand (§19.9.10)` };
      }
      return { ...base, action: "rewrite", kind: "handler-unbraced", call, value: v };
    }
    if (!whole) {
      return { ...base, action: "list", kind: "value-position", reason: `a call of server function \`${name}\` inside a larger expression — a value position: load it with a \`<request>\` (§13.7) or handle it by hand` };
    }
    // impl#1 mis-lowers a `!{}` on two statement shapes (measured S454 Phase 2): on a `return`'s
    // expression it DROPS the success return (the function returns nothing — silent-wrong), and on
    // a plain reassignment `x = f()` it re-declares `x` (`var x`, invalid JS). Neither is rewritten.
    if (stmt.kind === "return-stmt" || stmt.kind === "tilde-decl" || (stmt.kind === "bare-expr" && stmt.exprNode?.kind === "assign")) {
      const what = stmt.kind === "return-stmt" ? "a `return`'s expression" : "a reassignment";
      return { ...base, action: "list", kind: "impl1-lowering", reason: `a call of server function \`${name}\` as ${what}: impl#1 lowers a \`!{}\` there wrongly (${stmt.kind === "return-stmt" ? "the success value is not returned" : "the variable is re-declared"}), so it is not rewritten — handle it by hand (§19.9.10)` };
    }
    // impl#1 lowers a guarded `const`/`let` to `var` (function-scoped): inside a loop or a nested
    // block, or captured by a closure, every iteration / closure would share ONE binding (S239
    // review: `for (…) { const v = save(i); fns.push(() => v.n) }` → "1,2,3" becomes "3,3,3" on
    // the success path). Such declarations are listed.
    if (stmt.kind === "const-decl" || stmt.kind === "let-decl") {
      const nested = local.indexOf(stmt) > 0;
      const scope = fn ?? attr?.__cscValue ?? null;
      if (nested || (scope && typeof stmt.name === "string" && capturedByClosure(scope, stmt.name, fn))) {
        return { ...base, action: "list", kind: "decl-var-scoping", reason: `a call of server function \`${name}\` as the initializer of \`${stmt.name}\` ${nested ? "inside a nested block / loop" : "which a closure captures"}: impl#1 lowers a guarded declaration to \`var\`, so the binding would be shared — handle it by hand (§19.9.10)` };
      }
    }
    // impl#1 BATCHES independent server calls with Promise.all (§13.2, codegen/scheduling.ts). A
    // `.Transport` arm's `return` makes the statements a control dependency: the batch is lost, a
    // later call is never sent when an earlier one fails, and an earlier write lands when a later
    // one fails (S239 review). A call impl#1 batched is listed.
    if (fn ? batches.inFn.has(`${fn.name}::${name}`) : batches.inHandler.has(name)) {
      return { ...base, action: "list", kind: "batched", reason: `a call of server function \`${name}\` that impl#1 runs in a Promise.all batch with its independent siblings (§13.2): a \`.Transport\` arm's \`return\` would serialize them and change what is written when one fails — handle the batch by hand (§19.9.10)` };
    }
    if (fn && !isEntry) {
      // §19.9.10 F5: "remote" is a WHOLE-PROGRAM placement fact. A function in a module / route
      // file is placed by the program that imports it — a caller there may make it server-placed
      // (Trigger 5), and then this call is server→server and a `.Transport` arm is dead handling.
      return { ...base, action: "list", kind: "module-function", reason: `a call of server function \`${name}\` in \`${fn.name}\`, a function of a module / route file: whether it is a client call depends on the program that imports this file (§19.9.10 — placement is whole-program); handle it by hand once that is known` };
    }
    return { ...base, action: "rewrite", kind: fn ? "client-function-body" : "handler-braced", call, stmt };
  };

  const walk = (x, anc) => {
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) walk(y, anc); return; }
    if (x.kind === "call" && x.callee?.kind === "ident" && isServer(x.callee.name)) sites.push(classify(x, x.callee.name, anc));
    else if (x.kind === "call-ref" && isServer(x.name)) sites.push(classify(x, x.name, anc));
    const next = anc.concat([x]);
    if (x.kind === "markup" && Array.isArray(x.attrs)) {
      for (const a of x.attrs) {
        const v = a?.value;
        if (!v || typeof v !== "object") continue;
        // `onserver:*` (a `<channel>`'s server-side handler, §38) runs on the server: its calls
        // are server→server, never client calls.
        if (typeof a.name === "string" && /^onserver:/i.test(a.name)) continue;
        const handler = typeof a.name === "string" && /^on/i.test(a.name);
        const braced = !!(v.handlerBlock && Array.isArray(v.handlerBlock.stmts));
        const marker = { kind: "attr", __cscAttr: true, __cscHandler: handler, __cscBraced: braced, __cscValue: v, __cscName: a.name, span: v.span };
        if (handler && v.kind === "variable-ref" && typeof v.name === "string" && isServer(v.name)) {
          sites.push({ name: v.name, at: v.span?.start ?? 0, action: "list", kind: "handler-reference", reason: `a handler reference to server function \`${v.name}\` — write the call braced and handled, e.g. \`{ ${v.name}() ${TRANSPORT_HANDLER} }\` (§19.9.10)` });
          continue;
        }
        if (braced) walk(v.handlerBlock.stmts, next.concat([marker]));
        else walk(v, next.concat([marker]));
      }
    }
    if (x.kind === "guarded-expr" && Array.isArray(x.arms)) {
      walk(x.guardedNode, next);
      for (const arm of x.arms) walk(arm, next.concat([{ kind: "arm", __cscArm: true }]));
      return;
    }
    for (const k of Object.keys(x)) {
      if (k === "parent") continue;
      if (x.kind === "markup" && k === "attrs") continue;
      const v = x[k];
      if ((x.kind === "match-expr" || x.kind === "match-stmt" || x.kind === "match-block") && /arms/i.test(k)) { walk(v, next.concat([{ kind: "arm", __cscArm: true }])); continue; }
      // impl#1 lowers `defer { B }` to a try-stmt whose `finallyNode` is B (the statements after
      // the defer are its try block and stay ordinary statements).
      if (x.kind === "try-stmt" && k === "finallyNode") { walk(v, next.concat([{ kind: "defer-stmt" }])); continue; }
      walk(v, next);
    }
  };
  walk(ast, []);
  return sites;
}

// ---------------------------------------------------------------------------
// fixClientServerCall
// ---------------------------------------------------------------------------

/**
 * Rewrite every unhandled client call of a server function in ONE file (§19.9.10).
 * @param {string} source
 * @param {{ filePath?: string, auxSources?: Record<string,string>, verify?: boolean, entry?: boolean }} [opts]
 *   `entry: false` — a module / route file: its FUNCTION bodies are listed, not rewritten (placement is
 *   whole-program, §19.9.10 F5); its handler values are client code wherever it is mounted.
 * @returns {{ output: string, changed: boolean, applied: Array<{rule:string,line:number,detail:string}>,
 *             blockers: Array<{rule:string,line:number,reason:string,snippet:string}>,
 *             infos: Array<{rule:string,line:number,message:string}> }}
 */
export function fixClientServerCall(source, opts = {}) {
  const filePath = opts.filePath ?? "input.scrml";
  const blockers = [];
  const infos = [];
  const none = { output: source, changed: false, applied: [], blockers, infos };
  const snippetAt = (off) => {
    const ls = source.lastIndexOf("\n", off - 1) + 1;
    const le = source.indexOf("\n", off);
    return source.slice(ls, le === -1 ? source.length : le).trim().slice(0, 120);
  };
  const block = (off, reason) => blockers.push({ rule: CLIENT_SERVER_CALL_RULE, line: lineOf(source, off), reason, snippet: snippetAt(off) });
  // Cheap pre-check: no call at all.
  if (!source.includes("(") && !/on\w+\s*=/.test(source)) return none;

  const proj = scratchProject(filePath, source, opts.auxSources);
  try {
    const before = compileWithRI(proj, source);
    if (before.error || !before.ast) {
      // A file impl#1 cannot take through Route Inference has no placement facts: nothing is
      // rewritten, and it is said only when the file could hold a server call.
      if (/\bfunction\b|\bserver\b|\bimport\b/.test(source)) block(0, `${before.error ?? "impl#1 built no tree for this file"} — calls of server functions here are not located; check by hand`);
      return none;
    }
    // A file that exports anything is a module whatever its root: its functions can be called by
    // an importing program (stdlib modules are `<program>`-rooted and export).
    let exportsSomething = false;
    walkObjects(before.ast, (n) => { if (n.kind === "export-decl") exportsSomething = true; });
    // Entry vs module from the PARSED tree (Rule 7): a top-level `<program>` node makes an entry; a
    // file without one is an entry only when the caller classified it so AND it is not a route
    // file (under pages/ or routes/). A `<program` inside a comment decides nothing.
    const topNodes = Array.isArray(before.ast?.nodes) ? before.ast.nodes : [];
    const hasProgram = topNodes.some((n) => n && n.kind === "markup" && n.tag === "program");
    const routeFile = /(^|[\\/])(pages|routes)[\\/]/.test(filePath);
    const isEntry = !exportsSomething && (hasProgram || (opts.entry !== false && !routeFile));
    const batches = promiseAllBatches(before.clientJs);
    if (batches === null) { block(0, "impl#1's client output for this file could not be read to find its Promise.all batches — no call in this file rewritten"); return none; }
    const sites = collectSites(before.ast, before.ri, before.files, isEntry, batches);
    const edits = [];
    const listed = new Set();
    for (const s of sites) {
      if (s.action === "skip") continue;
      if (s.action === "list") {
        const key = `${lineOf(source, s.at)}:${s.reason}`;
        if (!listed.has(key)) { listed.add(key); block(s.at, s.reason); }
        continue;
      }
      // rewrite
      if (s.kind === "handler-unbraced") {
        const v = s.value;
        const vs = v.span?.start;
        const ve = v.span?.end;
        if (typeof vs !== "number" || typeof ve !== "number" || "\"'".includes(source[vs]) || (source[vs] === "$" && source[vs + 1] !== "{")) { block(vs ?? 0, `cannot place the handler value calling \`${s.name}\` — left for a human`); continue; }
        let end = ve;
        while (end > vs && /\s/.test(source[end - 1])) end--;
        if (source[vs] === "$") {
          // A `${ expr }` handler value whose expression IS the call (or a cell write of it) and
          // that does not read the event object: the braced block form says the same (§5.2.3).
          const innerStart = vs + 2;
          const innerEnd = end - 1;
          if (source[end - 1] !== "}" || mentionsIdent(v.exprNode, "event")) { block(vs, `a \`\${…}\` handler value calling \`${s.name}\` — left for a human`); continue; }
          const loc = locateCall(source, s.call, s.name, innerStart, innerEnd, filePath);
          const isAssign = v.exprNode?.kind === "assign";
          const prefix = loc ? source.slice(innerStart, loc.start) : "";
          const prefixOk = isAssign ? /=\s*$/.test(prefix) && !/[=!<>]=\s*$/.test(prefix) : /^\s*$/.test(prefix);
          const tailOk = loc && /^\s*$/.test(source.slice(loc.end, innerEnd));
          if (!loc || !prefixOk || !tailOk || source.slice(innerStart, innerEnd).includes("\n")) { block(vs, `cannot confirm the call of \`${s.name}\` in this \`\${…}\` handler value against impl#1's reading — left for a human`); continue; }
          const inner = source.slice(innerStart, innerEnd).trim();
          edits.push({ start: vs, end, text: `{ ${inner} ${TRANSPORT_HANDLER} }`, line: lineOf(source, vs), kind: "handler-unbraced", name: s.name });
          continue;
        }
        if (source[vs] === "{") {
          // A braced handler holding ONE statement (impl#1 keeps it as an expression value).
          if (source[end - 1] !== "}") { block(vs, `cannot place the braced handler value calling \`${s.name}\` — left for a human`); continue; }
          const loc = locateCall(source, s.call, s.name, vs + 1, end - 1, filePath);
          const isAssign = v.exprNode?.kind === "assign";
          const prefix = loc ? source.slice(vs + 1, loc.start) : "";
          const prefixOk = isAssign ? /=\s*$/.test(prefix) && !/[=!<>]=\s*$/.test(prefix) : /^\s*$/.test(prefix);
          if (!loc || !prefixOk || !endsStatement(source, loc.end)) { block(vs, `cannot confirm the call of \`${s.name}\` in this handler block against impl#1's reading — left for a human`); continue; }
          edits.push({ start: loc.end, end: loc.end, text: ` ${TRANSPORT_HANDLER}`, line: lineOf(source, loc.start), kind: "handler-braced", name: s.name });
          continue;
        }
        const loc = locateCall(source, s.call, s.name, vs, end, filePath);
        if (!loc || loc.end !== end) { block(vs, `cannot confirm the call of \`${s.name}\` in this handler value against impl#1's reading — left for a human`); continue; }
        const text = source.slice(vs, end);
        edits.push({ start: vs, end, text: `{ ${text} ${TRANSPORT_HANDLER} }`, line: lineOf(source, vs), kind: s.kind, name: s.name });
        continue;
      }
      const st = s.stmt?.span?.start;
      if (typeof st !== "number") { block(s.at, `cannot place the call of \`${s.name}\` — left for a human`); continue; }
      const limit = Math.max(s.stmt.span.end ?? st, st) ;
      const loc = locateCall(source, s.call, s.name, st, limit, filePath);
      if (!loc) { block(st, `cannot confirm the call of \`${s.name}\` against impl#1's reading — left for a human`); continue; }
      const prefix = source.slice(st, loc.start);
      const stmtKind = s.stmt.kind;
      const isAssign = stmtKind === "bare-expr" && s.stmt.exprNode?.kind === "assign";
      const prefixOk = stmtKind === "return-stmt" ? /^\s*return\s+$/.test(prefix)
        : (DECL_KINDS.has(stmtKind) || isAssign) ? /=\s*$/.test(prefix) && !/[=!<>]=\s*$/.test(prefix)
        : /^\s*$/.test(prefix);
      if (!prefixOk) { block(st, `the call of \`${s.name}\` is not the whole statement as written — left for a human`); continue; }
      if (!endsStatement(source, loc.end)) { block(st, `the call of \`${s.name}\` does not end its statement as written — left for a human`); continue; }
      edits.push({ start: loc.end, end: loc.end, text: ` ${TRANSPORT_HANDLER}`, line: lineOf(source, loc.start), kind: s.kind, name: s.name, fn: s.fn });
    }
    if (edits.length === 0) return none;

    // Deduplicate (a component instance can name the same source text twice) and check overlap.
    edits.sort((a, b) => a.start - b.start || a.end - b.end);
    const uniq = [];
    for (const e of edits) {
      const last = uniq[uniq.length - 1];
      if (last && last.start === e.start && last.end === e.end) continue;
      if (last && e.start < last.end) { block(e.start, "overlapping rewrites — file left untouched"); return none; }
      uniq.push(e);
    }
    let output = "";
    let cur = 0;
    for (const e of uniq) { output += source.slice(cur, e.start) + e.text; cur = e.end; }
    output += source.slice(cur);

    // Gate 1 — impl#1's front end re-reads the file.
    const fe = (text) => {
      try {
        return captureTrailingContentWarnings(() => {
          const bs = splitBlocks(filePath, text);
          const ast = buildAST(bs)?.ast ?? null;
          const codes = (bs.errors ?? []).map((e) => e?.code).filter((c) => typeof c === "string" && c.startsWith("E-")).sort();
          return { ast, codes: codes.join(",") };
        }).result;
      } catch { return { ast: null, codes: "(threw)" }; }
    };
    const fa = fe(source);
    const fb = fe(output);
    if (!fb.ast || fb.codes !== fa.codes) { block(uniq[0].start, "impl#1's front end reads the rewritten file differently (it no longer parses cleanly) — no call in this file rewritten"); return none; }
    // Gates 2 + 3 — the re-compile.
    if (opts.verify !== false) {
      const after = compileWithRI(proj, output);
      if (after.error || !after.ast) { block(uniq[0].start, `${after.error ?? "impl#1 built no tree"} after the rewrite — no call in this file rewritten`); return none; }
      if (!sameCodes(before.codes, after.codes)) {
        block(uniq[0].start, `impl#1 reports different codes after the rewrite (${before.codes.join(",") || "none"} → ${after.codes.join(",") || "none"}) — no call in this file rewritten`);
        return none;
      }
      const left = collectSites(after.ast, after.ri, after.files, isEntry, batches).filter((s) => s.action === "rewrite").length;
      const had = sites.filter((s) => s.action === "rewrite").length;
      if (left !== had - uniq.length) { block(uniq[0].start, `after the rewrite impl#1 still reads ${left} unhandled call(s) where ${had - uniq.length} were expected — no call in this file rewritten`); return none; }
    }
    const applied = uniq.map((e) => ({
      rule: CLIENT_SERVER_CALL_RULE, line: e.line,
      detail: e.kind === "handler-unbraced" ? `\`${e.name}(…)\` handler value → braced, with \`${TRANSPORT_HANDLER}\`` : `\`${e.name}(…)\` → \`${e.name}(…) ${TRANSPORT_HANDLER}\``,
    }));
    for (const e of uniq) {
      if (e.kind !== "client-function-body") continue;
      infos.push({
        rule: CLIENT_SERVER_CALL_RULE, line: e.line,
        message: `callers no longer abort: before, a failed call of \`${e.name}\` here stopped \`${e.fn}\` AND every caller awaiting it; now the \`.Transport\` arm returns from \`${e.fn}\` and its callers continue (§19.9.10). To keep the old reach, propagate with \`?\` from a \`!\` function whose enum declares \`Transport(t: ServerCallError)\` and handle it at the callers.`,
      });
    }
    return { output, changed: output !== source, applied, blockers, infos };
  } finally {
    rmSync(proj.dir, { recursive: true, force: true });
  }
}
