/**
 * @module commands/fix-sql-failable
 * The `scrml fix` rule `sql-failable` — SPEC §19.8.3 / §19.8.4 (S451 R11): a `?{}` query is a
 * FAILABLE expression everywhere; outside a `!` function an unhandled one is E-ERROR-002. Ruling:
 * user-voice-scrml.md S451 "your recs on all five" item 5(a) — *"R11 migration = a `scrml fix` rule
 * that writes the old silent behaviour out explicitly (`?{…}.get() !{ | _ :> not }`, `.all() !{ | _
 * :> [] }`, `.run() !{ | _ :> {} }`-shape) — meaning-preserving, silence made visible"*; built at S454
 * "then go on F8" ("alongside the owed R11 rule"), unblocked by the S454 freeze exception (#1305).
 * change-id: s455-scrml-fix-r11-sql-failable.
 *
 * ═══ THE REWRITE ═══
 *
 * At an UNHANDLED `?{}` outside a `!` function the rule writes the SUPERSEDED §19.8.3 meaning out
 * (failed `.get()` → `not`, failed `.all()` → `[]`, no error raised). The arm is §18.2 (no leading
 * `|`, S452):
 *
 *     ?{…}.get()   →  ?{…}.get() !{ _ :> not }
 *     ?{…}.all()   →  ?{…}.all() !{ _ :> [] }
 *     ?{…}         →  ?{…} !{ _ :> [] }          (a bare `?{}` is `.all()`, §44.3)
 *     ?{…}.run()   →  ?{…}.run() !{ _ :> {} }    (statement position only)
 *
 * ⚠ impl#1 never implemented that superseded meaning at run time: an unhandled `?{}` that fails to
 * run THROWS on the server (HTTP 500; the caller aborts) — `g-sql-error-surface-unwired`. Since
 * #1305 a HANDLED `?{}` is really caught. So on impl#1 the rewrite changes the FAILURE path from
 * "throws" to the ruled `not` / `[]` / continue (measured, docs/changes/s455-…/progress.md Phase 0).
 * Every rewritten site therefore carries an INFO saying so. The two success paths (a row / no row)
 * are unchanged.
 *
 * Positions REWRITTEN (Phase 0: success values identical on impl#1, both implementations accept the
 * handled spelling, the failure yields exactly the superseded value) — in the body of a
 * server-placed, non-body-split function, reached only through `if` / `for` / `while` bodies:
 *   - a whole statement `?{…}[.get()|.all()|.run()]`;
 *   - the right-hand side of a `const` / `let` declaration directly in the function body (not
 *     nested, not captured by a closure — impl#1 lowers a guarded declaration to `var`), `.get()` /
 *     `.all()` / bare only;
 *   - the right-hand side of a plain reassignment `x = ?{…}` (`.get()` / `.all()` / bare);
 *   - a `return ?{…}` (`.get()` / `.all()` / bare).
 *
 * Positions LISTED, never rewritten (reported for a human): a `?{}` inside an expression (an `if`
 * condition, a `for … of` iterable, an operand — impl#1 / the bootstrap mis-handle the handled
 * spelling there), in a `lift` (impl#1 drops the lifted value), in a cell write `@x = ?{…}` (impl#1
 * moves the write to the server), at a body top / in markup (impl#1 cannot run it there), in a
 * `transaction { }` / `defer` body / `yield` / closure / handler or match arm, a terminator other
 * than `.get()` / `.all()` / `.run()` (`.first()`, `.prepare()`, a chained member), `.nobatch()`,
 * `.run()` in a value position (no superseded value), a transaction-control statement (`BEGIN` …),
 * a nested / captured declaration, and any `?{}` in a function impl#1 does not place on the server
 * or splits across client and server (body-split).
 *
 * Not touched: a `?{}` inside a `!` function (§19.8.2), a handled `?{}` (a `!{}` on it or a `match`
 * on it), a `<x server>` hydration load (§19.8.3, §52.6.8 — exempt).
 *
 * ═══ HOW IT LOCATES (AST-driven — Rule 7) ═══
 *
 * impl#1 compiles the file in its project with Route Inference captured (`stageOverrides.RI`), so
 * placement and body-split are impl#1's own answers. The sites are the `sql` nodes of the file's
 * AST (every classification above is read from the tree). The edit point comes from the `sql`
 * node's source span: the span must open with `?{` and close the balanced block, the terminator the
 * AST records (`chainedCalls`) must follow it as written, and the statement must end right after.
 * Any mismatch makes the site a blocker — reported, never guessed.
 *
 * ═══ THE GATE (transactional, per file) ═══
 *   1. impl#1's front end re-reads the rewritten file with the same block-splitter error codes.
 *   2. impl#1 re-compiles it in its project: diagnostic codes (errors, warnings, lint) identical.
 *   3. impl#1 batches the file's server calls (§13.2 Promise.all, read from its client JS) the same.
 *   4. The rewritten sites are no longer unhandled (the re-read finds `edits` fewer sites).
 * Any failure reverts the WHOLE file and reports why.
 *
 * Idempotent: a rewritten `?{}` is handled, so a second run makes no edit.
 */

import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { captureTrailingContentWarnings, guardCallArmsRaw } from "../expression-parser.ts";
import { rmSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { skipBalanced, endsStatement, lineOf, scratchProject, compileWithRI, promiseAllBatches } from "./fix-client-server-call.js";

export const SQL_FAILABLE_RULE = "sql-failable";

/** The arm the rule writes, per terminator (S451 item 5(a); §18.2 arm, no leading `|`). */
export const SQL_FALLBACK = Object.freeze({ get: "!{ _ :> not }", all: "!{ _ :> [] }", bare: "!{ _ :> [] }", run: "!{ _ :> {} }" });
const FALLBACK_WORD = { get: "`not`", all: "`[]`", bare: "`[]`", run: "nothing — execution continues" };

/** Statement containers a rewritten `?{}` may sit under, between its function and itself. */
const CONTAINERS = new Set(["if-stmt", "for-stmt", "while-stmt", "do-while-stmt", "block"]);
/** A `?{}` that is itself a statement has one of these as its parent. */
const STATEMENT_PARENTS = new Set(["function-decl", "if-stmt", "for-stmt", "while-stmt", "do-while-stmt", "block"]);
const TX = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END|START\s+TRANSACTION|ABORT)\b/i;

const KIND_WORD = {
  "lift-expr": "a `lift` (impl#1 drops the lifted value of a handled `?{}`)",
  "state-decl": "a cell write `@x = ?{…}` (impl#1 moves a handled write to the server, so the cell is never set)",
  "transaction-block": "a `transaction { }` body",
  "defer-stmt": "a `defer` body",
  "yield-stmt": "a `yield`",
  "lambda": "a closure",
  "arm": "a handler / match arm",
};

/**
 * Same diagnostic codes (with counts) before and after — NO tolerance list. (S455 Phase 2 tried
 * tolerating W-TYPE-031-UNPROVEN, which a handled `?{}` declaration adds on impl#1 — its return-type
 * inference does not see through the handler — and the trucking-dispatch diagnostic baseline, which
 * pins that count and says it SHALL only fall, caught it. A file where the rewrite adds it is
 * reverted and listed; the inference gap is reported, not absorbed.)
 */
function sameCodes(before, after) {
  return before.join(",") === after.join(",");
}

/** Is the identifier `name` read inside a closure (lambda / nested function) anywhere under `scope`? */
function capturedByClosure(scope, name) {
  let hit = false;
  const seen = new WeakSet();
  (function w(x, inClosure) {
    if (hit || !x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) w(y, inClosure); return; }
    const closure = inClosure || ((x.kind === "lambda" || x.kind === "function-decl") && x !== scope);
    if (closure && (x.kind === "ident" || x.kind === "variable-ref") && x.name === name) { hit = true; return; }
    for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k], closure);
  })(scope, false);
  return hit;
}

/** impl#1's route entry for a function node (Route Inference keys functions `file::span.start`). */
function routeOf(ri, fn) {
  const start = fn?.span?.start;
  if (typeof start !== "number") return null;
  const hits = [];
  for (const [id, f] of ri?.routeMap?.functions ?? []) if (typeof id === "string" && id.endsWith(`::${start}`) && f?.functionName === fn.name) hits.push(f);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Walk the file's AST; classify every `?{}`. A site is
 * `{ action: "rewrite" | "list" | "skip", at, ... }`.
 */
export function collectSqlSites(ast, ri) {
  const sites = [];
  const seen = new WeakSet();
  const classify = (sql, path) => {
    // A statement node's span is a source offset; an ExprNode's (the `sql-ref` and its parents) is
    // relative to its expression, so the site is placed at its enclosing statement.
    const srcSpan = (n) => (n && /-stmt$|-decl$/.test(n.kind ?? "") && typeof n.span?.start === "number" ? n.span.start : null);
    let at = sql.kind === "sql" && typeof sql.span?.start === "number" ? sql.span.start : null;
    for (let i = path.length - 1; at === null && i >= 0; i--) at = srcSpan(path[i].node);
    let fi = -1;
    for (let i = path.length - 1; i >= 0; i--) if (path[i].node.kind === "function-decl") { fi = i; break; }
    const fn = fi >= 0 ? path[fi].node : null;
    const base = { at, sql };
    if (path.some((p) => p.node.kind === "function-decl" && p.node.canFail)) return { ...base, action: "skip", why: "inside a `!` function (§19.8.2)" };
    if (path.some((p) => p.node.kind === "state-decl" && p.node.isServer)) return { ...base, action: "skip", why: "`<x server>` hydration load (§19.8.3, exempt)" };
    // Handled: the `?{}` is the guarded operand of a `!{}` (statement or expression form) or a match subject.
    for (let i = fi + 1; i < path.length; i++) {
      const { node, key } = path[i];
      if (node.kind === "guarded-expr" && key === "guardedNode") return { ...base, action: "skip", why: "handled (`!{}`)" };
      if (node.kind === "call" && key === "callee" && guardCallArmsRaw(node)) return { ...base, action: "skip", why: "handled (`!{}` in an expression)" };
      if (/^match/.test(node.kind ?? "") && !/arm/i.test(key)) return { ...base, action: "skip", why: "handled (`match`)" };
    }
    const local = path.slice(fi + 1);
    if (sql.kind === "sql-ref") {
      const owner = local.slice().reverse().find((p) => p.node.kind === "if-stmt" || p.node.kind === "for-stmt" || p.node.kind === "while-stmt");
      const where = owner?.node.kind === "if-stmt" ? "an `if` condition" : owner?.node.kind === "for-stmt" ? "a `for` header" : owner?.node.kind === "while-stmt" ? "a `while` condition" : "an expression";
      return { ...base, action: "list", kind: "expression", reason: `an unhandled \`?{}\` inside ${where} — the handled spelling does not lower there on impl#1 / the bootstrap; handle it by hand (§19.8.3, E-ERROR-002)` };
    }
    const query = String(sql.query ?? "");
    if (TX.test(query)) return { ...base, action: "list", kind: "tx-control", reason: "an unhandled transaction-control `?{}` — handle it by hand (§19.8.3, §19.10)" };
    if (!fn) return { ...base, action: "list", kind: "body-top", reason: "an unhandled `?{}` at a body top / in markup — move it into a function (or a `!` function loaded by a `<request>`) and handle it (§19.8.3, E-ERROR-002)" };
    // Every node between the function and the `?{}` must be a plain statement container.
    const parentEntry = local[local.length - 1];
    const parent = parentEntry?.node ?? fn;
    const between = local.slice(0, -1);
    for (const p of between) {
      if (CONTAINERS.has(p.node.kind)) continue;
      const k = p.node.kind === "try-stmt" && p.key === "finallyNode" ? "defer-stmt" : /arm/i.test(p.key ?? "") ? "arm" : p.node.kind;
      return { ...base, action: "list", kind: k, reason: `an unhandled \`?{}\` inside ${KIND_WORD[k] ?? `a \`${k}\``} — handle it by hand (§19.8.3, E-ERROR-002)` };
    }
    if (parent && !STATEMENT_PARENTS.has(parent.kind) && !["const-decl", "let-decl", "return-stmt"].includes(parent.kind)) {
      const k = /arm/i.test(parentEntry?.key ?? "") ? "arm" : parent.kind;
      return { ...base, action: "list", kind: k, reason: `an unhandled \`?{}\` in ${KIND_WORD[k] ?? `a \`${k}\``} — handle it by hand (§19.8.3, E-ERROR-002)` };
    }
    // Terminator (§44.3).
    const chain = Array.isArray(sql.chainedCalls) ? sql.chainedCalls : [];
    if (sql.nobatch) return { ...base, action: "list", kind: "nobatch", reason: "an unhandled `?{…}.nobatch()` — handle it by hand (§19.8.3, §8.9.5)" };
    if (chain.length > 1) return { ...base, action: "list", kind: "expression", reason: `an unhandled \`?{}\` whose result is used inside an expression (\`.${chain.map((c) => c.method).join("().")}()\`) — handle it by hand (§19.8.3)` };
    const term = chain.length === 0 ? "bare" : chain[0].method;
    if (!(term in SQL_FALLBACK) || (chain[0] && String(chain[0].args ?? "").trim() !== "")) return { ...base, action: "list", kind: "terminator", reason: `an unhandled \`?{…}.${term}()\` — not a §44.3 terminator the superseded rule defined a value for; handle it by hand (§19.8.3)` };
    // Placement — impl#1's own Route Inference.
    const route = routeOf(ri, fn);
    if (!route) return { ...base, action: "list", kind: "unplaced", reason: `\`${fn.name}\`'s placement could not be read from impl#1 — handle this \`?{}\` by hand (§19.8.3)` };
    if (route.boundary !== "server") return { ...base, action: "list", kind: "unplaced", reason: `\`${fn.name}\` is not server-placed on impl#1 — handle this \`?{}\` by hand (§19.8.3)` };
    if (route.cpsSplit) return { ...base, action: "list", kind: "body-split", reason: `\`${fn.name}\` is split across client and server (it also writes a cell) — impl#1 does not lower a handled \`?{}\` there; handle it by hand (§19.8.3)` };
    // Position.
    if (STATEMENT_PARENTS.has(parent.kind)) return { ...base, action: "rewrite", kind: "statement", term, fn };
    if (parent.kind === "return-stmt") {
      if (term === "run") return { ...base, action: "list", kind: "run-value", reason: "`return ?{…}.run()` — `.run()` has no superseded value; handle it by hand (§19.8.3)" };
      return { ...base, action: "rewrite", kind: "return", term, fn, stmt: parent };
    }
    // const / let (impl#1 records a plain reassignment `x = …` as a const-decl with `_bareAssign`).
    if (parent.sqlNode !== sql) return { ...base, action: "list", kind: "expression", reason: "an unhandled `?{}` inside a declaration's initializer expression — handle it by hand (§19.8.3)" };
    if (term === "run") return { ...base, action: "list", kind: "run-value", reason: "`.run()` as a value — it has no superseded value; handle it by hand (§19.8.3)" };
    // A keywordless `x = ?{…}` is a reassignment when `x` is already bound, and impl#1's implicit
    // declaration otherwise (base emits `const x = …`); handled, impl#1 emits `var x` for the
    // latter (measured S455 Phase 2), so the same nested / captured hazard applies to both.
    const nested = between.length > 0;
    if (nested || (typeof parent.name === "string" && capturedByClosure(fn, parent.name))) {
      return { ...base, action: "list", kind: "decl-var-scoping", reason: `\`${parent.name}\` = ?{…} ${nested ? "inside a nested block / loop" : "captured by a closure"}: impl#1 lowers a handled declaration to \`var\`, so the binding would be shared — handle it by hand (§19.8.3)` };
    }
    return { ...base, action: "rewrite", kind: parent._bareAssign ? "reassign" : "decl", term, fn, stmt: parent };
  };
  const walk = (x, path) => {
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) walk(y, path); return; }
    if (x.kind === "sql" && x.node && typeof x.node === "object") {
      // a wrapper (`lift ?{…}`): the inner sql node carries the site
      for (const k of Object.keys(x)) if (k !== "parent") walkKey(x, k, path);
      return;
    }
    if (x.kind === "sql" || x.kind === "sql-ref") sites.push(classify(x, path));
    for (const k of Object.keys(x)) if (k !== "parent") walkKey(x, k, path);
  };
  const walkKey = (x, k, path) => {
    const v = x[k];
    if (!v || typeof v !== "object") return;
    walk(v, path.concat([{ node: x, key: k }]));
  };
  walk(ast, []);
  return sites;
}

/**
 * Rewrite every unhandled `?{}` outside a `!` function in ONE file (§19.8.3).
 * @param {string} source
 * @param {{ filePath?: string, auxSources?: Record<string,string>, verify?: boolean }} [opts]
 * @returns {{ output: string, changed: boolean, applied: Array<{rule:string,line:number,detail:string}>,
 *             blockers: Array<{rule:string,line:number,reason:string,snippet:string}>,
 *             infos: Array<{rule:string,line:number,message:string}> }}
 */
export function fixSqlFailable(source, opts = {}) {
  const filePath = opts.filePath ?? "input.scrml";
  const blockers = [];
  const infos = [];
  const none = { output: source, changed: false, applied: [], blockers, infos };
  if (!source.includes("?{")) return none;
  const snippetAt = (off) => {
    const ls = source.lastIndexOf("\n", off - 1) + 1;
    const le = source.indexOf("\n", off);
    return source.slice(ls, le === -1 ? source.length : le).trim().slice(0, 120);
  };
  const block = (off, reason) => blockers.push({ rule: SQL_FAILABLE_RULE, line: typeof off === "number" ? lineOf(source, off) : 0, reason, snippet: typeof off === "number" ? snippetAt(off) : "" });

  const proj = scratchProject(filePath, source, opts.auxSources);
  // The verify compile reads a `<db src=…>` database beside the file when one exists (its schema
  // decides e.g. `SELECT *` expansion under `protect=`, I-PROTECT-STRIP-001). Mirror the file's
  // sibling database files into the scratch project so before/after see what an in-place compile
  // sees (measured S455 Phase 2: a gate blind to `test.db` passed a file whose in-place codes changed).
  try {
    const here = dirname(resolve(filePath));
    if (existsSync(here)) for (const f of readdirSync(here)) if (/\.(db|sqlite3?)$/i.test(f)) copyFileSync(join(here, f), join(dirname(proj.target), f));
  } catch { /* best effort: the gate then compiles without the database, as before */ }
  try {
    const before = compileWithRI(proj, source);
    if (before.error || !before.ast) {
      block(0, `${before.error ?? "impl#1 built no tree for this file"} — its \`?{}\` sites are not located; check by hand (§19.8.3)`);
      return none;
    }
    const sites = collectSqlSites(before.ast, before.ri);
    const edits = [];
    const listed = new Set();
    for (const s of sites) {
      if (s.action === "skip") continue;
      if (s.action === "list") {
        const key = `${s.at}:${s.reason}`;
        if (!listed.has(key)) { listed.add(key); block(s.at, s.reason); }
        continue;
      }
      const st = s.sql.span?.start;
      const en = s.sql.span?.end;
      if (typeof st !== "number" || typeof en !== "number" || !source.startsWith("?{", st) || skipBalanced(source, st + 1) !== en) {
        block(st, "cannot confirm this `?{}` against impl#1's reading — left for a human");
        continue;
      }
      // The terminator the AST records, as written.
      let point = en;
      if (s.term !== "bare") {
        const m = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(en));
        if (!m || m[1] !== s.term) { block(st, "the terminator after this `?{}` is not the one impl#1 recorded — left for a human"); continue; }
        const close = skipBalanced(source, en + m[0].length - 1);
        if (close < 0 || source.slice(en + m[0].length, close - 1).trim() !== "") { block(st, "cannot confirm the terminator call after this `?{}` — left for a human"); continue; }
        point = close;
      }
      if (!endsStatement(source, point)) { block(st, "this `?{}` does not end its statement as written — left for a human"); continue; }
      // The text before it must be the statement's own prefix.
      const lineStart = source.lastIndexOf("\n", st - 1) + 1;
      const pre = source.slice(lineStart, st);
      let prefixOk;
      if (s.kind === "statement") prefixOk = /(^|[;{}])\s*$/.test(pre);
      else if (s.kind === "return") prefixOk = /(^|[;{}\s])return\s+$/.test(pre);
      else {
        const name = String(s.stmt?.name ?? "");
        const esc = name.replace(/[$]/g, "\\$");
        prefixOk = name !== "" && (s.kind === "reassign"
          ? new RegExp(`(^|[;{}\\s])${esc}\\s*=\\s*$`).test(pre)
          : new RegExp(`(^|[;{}\\s])(const|let)\\s+${esc}\\s*(:[^=]*)?=\\s*$`).test(pre));
      }
      if (!prefixOk) { block(st, "this `?{}` is not the whole right-hand side / statement as written — left for a human"); continue; }
      edits.push({ start: point, end: point, text: ` ${SQL_FALLBACK[s.term]}`, line: lineOf(source, st), kind: s.kind, term: s.term, fn: s.fn?.name });
    }
    if (edits.length === 0) return none;

    edits.sort((a, b) => a.start - b.start);
    const uniq = [];
    for (const e of edits) {
      const last = uniq[uniq.length - 1];
      if (last && last.start === e.start) continue;
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
    if (!fb.ast || fb.codes !== fa.codes) { block(uniq[0].start, "impl#1's front end reads the rewritten file differently — no `?{}` in this file rewritten"); return none; }
    // Gates 2 + 3 — the re-compile.
    if (opts.verify !== false) {
      const after = compileWithRI(proj, output);
      if (after.error || !after.ast) { block(uniq[0].start, `${after.error ?? "impl#1 built no tree"} after the rewrite — no \`?{}\` in this file rewritten`); return none; }
      if (!sameCodes(before.codes, after.codes)) {
        block(uniq[0].start, `impl#1 reports different codes after the rewrite (${before.codes.join(",") || "none"} → ${after.codes.join(",") || "none"}) — no \`?{}\` in this file rewritten`);
        return none;
      }
      // impl#1 stops batching a CALLER's independent calls (§13.2 Promise.all) of a function that
      // now holds a handled `?{}` (measured S455 Phase 2: sql-transaction-*-rt). Sequential calls
      // change what a partial failure writes, so a file whose own client batches change is
      // reverted — read from impl#1's emitted client JS on both sides, not re-derived.
      const batchesBefore = promiseAllBatches(before.clientJs);
      const batchesAfter = promiseAllBatches(after.clientJs);
      const key = (b) => (b ? [...b.inFn, ...[...b.inHandler].map((c) => `handler::${c}`)].sort().join("|") : "(unreadable)");
      if (key(batchesBefore) !== key(batchesAfter)) {
        block(uniq[0].start, "impl#1 batches this file's server calls differently after the rewrite (its Promise.all batching, §13.2, would change what a partial failure writes) — no `?{}` in this file rewritten");
        return none;
      }
      const had = sites.filter((s) => s.action === "rewrite").length;
      const left = collectSqlSites(after.ast, after.ri).filter((s) => s.action === "rewrite").length;
      if (left !== had - uniq.length) { block(uniq[0].start, `after the rewrite impl#1 still reads ${left} unhandled \`?{}\` where ${had - uniq.length} were expected — no \`?{}\` in this file rewritten`); return none; }
    }
    const applied = uniq.map((e) => ({ rule: SQL_FAILABLE_RULE, line: e.line, detail: `\`?{…}${e.term === "bare" ? "" : `.${e.term}()`}\` → \`… ${SQL_FALLBACK[e.term]}\`` }));
    for (const e of uniq) {
      infos.push({
        rule: SQL_FAILABLE_RULE, line: e.line,
        message: `a failure here used to throw on impl#1 (HTTP 500, caller aborted); it now ${e.term === "run" || e.kind === "statement" ? "continues" : `yields ${FALLBACK_WORD[e.term]}`} — the §19.8.3 meaning made explicit; change the arm to handle it`,
      });
    }
    return { output, changed: output !== source, applied, blockers, infos };
  } finally {
    rmSync(proj.dir, { recursive: true, force: true });
  }
}
