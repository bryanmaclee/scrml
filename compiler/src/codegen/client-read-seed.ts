/**
 * client-read-seed.ts — WHICH plain identifiers does CLIENT-emitted user code
 * reference in this file?
 *
 * The answer feeds two consumers, both of them about `export const` / `export let`
 * VALUE bindings reaching the browser (GH #263 and its cross-file residual #358):
 *
 *   - the SAME-FILE gate — `emit-client.ts`'s `emitReferencedModuleExportConstLines`
 *     emits an `export const` into this file's own `.client.js` only when a
 *     client-emitted node in this file reads it;
 *   - the CROSS-FILE seed — `codegen/index.ts` runs this over every file in the
 *     compile unit and records, per direct `.scrml` import edge, which of a
 *     dependency's export names some OTHER unit reads client-side. Without it a
 *     directly-imported const is dropped from the dependency's `.client.js` and
 *     the importer reads a free variable: a browser `ReferenceError` at exit 0.
 *
 * THIS FILE DOES NOT ENUMERATE POSITIONS. It used to: the collector carried a
 * hand-rolled parallel copy of the markup/engine/match traversal
 * `dependency-graph.ts` already performed. Two walkers over the same `any`-typed
 * AST, nothing to type-check one against the other, and the set of positions the
 * copy MISSED grew at every review round.
 * That walker is deleted. Positions now come from ONE shared table,
 * `../expr-positions.ts`, which the dependency graph consumes as well; a position
 * added there is seen by both, permanently.
 *
 * ═══ §14.8 — THE INVARIANT THIS FILE EXISTS TO NOT BREAK ═══
 *
 * A SERVER-ONLY value SHALL NEVER be pulled into a client bundle. Everything
 * below is arranged around that, and the arrangement has three parts:
 *
 * 1. PRUNE FIRST. A server-boundary `function-decl` body lowers to a client fetch
 *    STUB that never names what it closes over, so its identifier reads do NOT
 *    cross; a `<x server>` state-decl resolves its initializer server-side; an
 *    `isServerOnlyNode` statement (`?{}` SQL, env reads, server-context meta) is
 *    server-resident. All three subtrees are pruned before any collection, so a
 *    server-only value's identifier never enters the set in the first place.
 *
 * 2. PARSE, NEVER REGEX. Every raw-source position is PARSED and walked as real
 *    ident nodes. A bare-identifier regex over source text reads inside string
 *    literals and comments — that is precisely the string-blind leak the #263
 *    AST-precise gate replaced, and it is why `literal-text` positions (attribute
 *    text with no code in it) are not in this consumer's `SUPPORTS` set at all.
 *    `template-text` goes through the escape-aware `forEachTemplateInterpolation`:
 *    an ESCAPED `\${SECRET}` is literal text codegen never wires, and a consumer
 *    that believes it IS wired ships the secret.
 *
 * 3. FAIL CLOSED. Any shape whose reachability cannot be computed precisely — an
 *    unparseable initializer, a malformed ExprNode — is SKIPPED. That leaves the
 *    original under-emit (a `ReferenceError` the adopter can see and report). An
 *    under-emit is a correctness bug; a leak is a confidentiality breach. They are
 *    not the same size, and the tie always breaks toward under-emit.
 */

import { parseExprToNode, forEachIdentInExprNode } from "../expression-parser.ts";
import { forEachExprPosition, EXPR_NODE_FIELDS, type ExprPositionKind } from "../expr-positions.ts";
import { forEachTemplateInterpolation } from "./rewrite.ts";
import { getNodes, isServerOnlyNode } from "./collect.ts";

/**
 * The position kinds this consumer can read.
 *
 * DELIBERATELY ABSENT, and each absence is load-bearing:
 *   - `literal-text`    attribute text with no code in it. Only a `@`-sigil
 *                       consumer has anything to find there; scanning it for bare
 *                       identifiers is the string-blind leak.
 *   - `cell-name`       a reactive-cell name. `@`-prefixed names are never export
 *                       bindings, and the alternate group hands us the parsed
 *                       `exprNode` instead, which is where a real binding read is.
 *   - `cell-name-list`  same, for a pre-extracted `refs` array.
 */
const SUPPORTS: ReadonlySet<ExprPositionKind> = new Set<ExprPositionKind>([
  "expr-node", "expr-source", "block-source", "template-text", "callee-name",
]);

/**
 * Is this `function-decl` node a SERVER-boundary fn (its body lowers to a client
 * fetch STUB, so its identifier references do NOT cross to the client)?
 *
 * Uses BOTH available signals and ORs them (fail-closed toward "server" — a fn
 * we wrongly treat as server merely under-emits a const it closes over):
 *   - the AST `isServer` flag (set by the fn-boundary classifier), and
 *   - the routeMap boundary (the emitter's own source of truth for what lowers
 *     to a stub — covers CPS-split / channel-handler shapes too).
 */
function fnNodeIsServerBoundary(node: any, filePath: string, routeMap: any): boolean {
  if (node?.isServer === true) return true;
  const start = node?.span?.start;
  if (typeof start === "number" && routeMap?.functions?.get) {
    const route = routeMap.functions.get(`${filePath}::${start}`);
    if (route && route.boundary === "server") return true;
  }
  return false;
}

export interface ClientReadOptions {
  /**
   * When provided, receives every CLIENT-side BINDING name reachable in this file
   * (each-loop vars, lambda params, local `let`/`const`/`fn` decls and their
   * params).
   *
   * THE SCOPE-BLINDNESS GUARD. The returned identifier set is a flat bag of NAMES;
   * it cannot tell a read of an IMPORT binding `X` apart from a read of a
   * client-side binding named `X` that shadows it. Cross-marking a server-only
   * export off such a shadow would emit its value to the client — a §14.8 leak,
   * strictly worse than the under-emit this whole mechanism fixes. The cross-file
   * caller therefore requires `refs.has(local) && !bound.has(local)` before
   * cross-marking. Over-collection here is SAFE by construction: an extra name in
   * `boundOut` only ever SUPPRESSES a cross-mark.
   */
  boundOut?: Set<string>;
}

/**
 * Per-file memo. BOTH consumers ask the same question about the same file in one
 * compile — `runCG`'s cross-file precompute walks every importing file, and the
 * per-file `emitReferencedModuleExportConstLines` walks the file again — and the
 * walk is not cheap (it PARSES every raw-source position rather than regexing it).
 * Keyed on AST object identity, so a fresh compile with fresh ASTs never hits a
 * stale entry; the `routeMap` is recorded and checked because server-boundary
 * classification is an input to the answer.
 */
const _memo = new WeakMap<object, { routeMap: unknown; refs: Set<string>; bound: Set<string> }>();

/**
 * Collect the identifier names CLIENT-emitted user code in this file references.
 *
 * @param fileAST  the file AST (post symbol-table, so `_record` is populated).
 * @param filePath the file's path, for span-anchored re-parses and the routeMap key.
 * @param routeMap the compile unit's route map (server-boundary classification).
 */
export function collectClientReadIdents(
  fileAST: any,
  filePath: string,
  routeMap: any,
  opts?: ClientReadOptions,
): Set<string> {
  if (fileAST && typeof fileAST === "object") {
    const hit = _memo.get(fileAST);
    if (hit && hit.routeMap === routeMap) {
      if (opts?.boundOut) for (const b of hit.bound) opts.boundOut.add(b);
      return hit.refs;
    }
  }
  const refs = new Set<string>();
  // Bindings are ALWAYS collected (not only when the caller asked), so the memo
  // can serve a later caller that does ask. Collection is cheap and the set is
  // never consulted unless a caller passes `boundOut`.
  const bound = new Set<string>();
  const boundOut = bound;

  const addName = (n: unknown): void => {
    if (typeof n === "string" && n && !n.startsWith("@")) refs.add(n);
  };

  // Collect every client-side binding name reachable through a binding-target
  // field (a bare string loop-var / decl name, a `{name}` param, an array of
  // such, or a nested destructure pattern).
  const collectBindingsInto = (x: any, out: Set<string>): void => {
    if (x == null) return;
    if (typeof x === "string") { if (x && !x.startsWith("@")) out.add(x); return; }
    if (Array.isArray(x)) { for (const el of x) collectBindingsInto(el, out); return; }
    if (typeof x === "object") {
      collectBindingsInto(x.name, out);
      for (const k of ["elements", "properties", "props", "value", "values",
                       "argument", "left", "fields", "entries", "items", "params"]) {
        if (x[k] != null && typeof x[k] === "object") collectBindingsInto(x[k], out);
      }
    }
  };

  /**
   * Structural descent over an ExprNode graph collecting every real `ident` node.
   * `forEachIdentInExprNode` stops at a lambda scope boundary (that boundary is
   * correct for `lin` capture tracking and wrong for us — a const read inside a
   * client-side `() => …` IS a client read), so this walk supplements it.
   *
   * A member expression's `.property` is a plain STRING, not an ident node, so
   * property names can never be collected here. Locals and params it also gathers
   * are harmless: they simply never match an export-const candidate name.
   */
  const collectIdentNamesDeep = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) collectIdentNamesDeep(x); return; }
    if (n.kind === "ident") addName(n.name);
    // A lambda in client code introduces param bindings; record them so a
    // `x => …` param named like an import SHADOWS (and so does not cross-mark) it.
    if (n.kind === "lambda" && boundOut) collectBindingsInto(n.params, boundOut);
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "kind" || k === "name") continue;
      const v = n[k];
      if (v && typeof v === "object") collectIdentNamesDeep(v);
    }
  };

  const collectFromExprNode = (expr: any): void => {
    if (!expr || typeof expr !== "object" || typeof expr.kind !== "string") return;
    try {
      forEachIdentInExprNode(expr, (id: any) => addName(id?.name));
    } catch { /* defensive — a malformed ExprNode never widens the client set */ }
    collectIdentNamesDeep(expr);
  };

  /** Parse ONE expression's source and collect. Fail-closed on a parse failure. */
  const collectFromExprSource = (raw: unknown): void => {
    if (typeof raw !== "string" || !raw.trim()) return;
    let node: any = null;
    try { node = parseExprToNode(raw, filePath, 0); } catch { return; }
    if (node) collectFromExprNode(node);
  };

  /**
   * Collect from source that may hold SEVERAL statements and/or markup.
   *
   * Two passes, both parse-based:
   *   (a) consume statements the way `mountBodyExprNode` detects them — parse,
   *       then advance past the parsed span — so a multi-statement body is fully
   *       walked. Any parse failure just stops (fail-closed).
   *   (b) scan `${…}` interiors with the ESCAPE-AWARE shared scanner and parse
   *       each. Markup body text does not parse as an expression, but its
   *       interpolation interiors are exactly the code codegen wires.
   */
  const collectFromBlockSource = (raw: unknown): void => {
    if (typeof raw !== "string" || !raw.trim()) return;
    let rest = raw;
    let guard = 0;
    while (rest.trim() && guard++ < 256) {
      let node: any = null;
      try { node = parseExprToNode(rest, filePath, 0); } catch { break; }
      if (!node || !node.span || typeof node.span.end !== "number" || node.span.end <= 0) {
        if (node) collectFromExprNode(node);
        break;
      }
      collectFromExprNode(node);
      rest = rest.slice(node.span.end);
    }
    if (raw.includes("${")) {
      forEachTemplateInterpolation(raw, (interior) => { collectFromExprSource(interior); });
    }
  };

  /** `${…}`-bearing attribute text. The ESCAPE-AWARE scan is the §14.8 half. */
  const collectFromTemplateText = (raw: unknown): void => {
    if (typeof raw !== "string" || !raw.includes("${")) return;
    forEachTemplateInterpolation(raw, (interior) => { collectFromExprSource(interior); });
  };

  /**
   * A call-ref callee. `handleClick` names one binding; `utils.handleClick` names
   * the binding `utils` plus a property. The BASE segment is the binding — the
   * emitted client handler is literally `utils.handleClick(id)`, so `utils` must
   * resolve there.
   */
  const collectFromCalleeName = (raw: unknown): void => {
    if (typeof raw !== "string" || !raw) return;
    const base = raw.split(".")[0];
    if (base) addName(base);
  };

  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;

    // ---- PRUNES (see §14.8 part 1 in the file header). ---------------------
    if (node.kind === "function-decl") {
      // Server fn → its body lowers to a stub; its refs do NOT cross. Prune.
      if (fnNodeIsServerBoundary(node, filePath, routeMap)) return;
      if (boundOut) { collectBindingsInto(node.name, boundOut); collectBindingsInto(node.params, boundOut); }
      // Client fn → walk its body (nested server fns are pruned on recursion).
      if (Array.isArray(node.body)) for (const s of node.body) visit(s);
      return;
    }
    // A candidate export const/let: skip. A candidate's own initializer
    // references are resolved separately by the transitive closure; seeding from
    // them would let a NON-reachable const drag a server-only ident in.
    if (node.kind === "export-decl") return;
    // §52 server-authority cell (`<x server> = …`): its initializer is resolved
    // SERVER-side (the client receives a hydration seed, never the init
    // expression), so refs in it do NOT cross. `isServerOnlyNode` does NOT catch
    // this — it classifies SQL/`?{}`/env/meta inits, not a server-authority cell
    // with a plain-value init. A CLIENT cell (`isServer` falsy) DOES ship its
    // init and is NOT pruned.
    if (node.kind === "state-decl" && node.isServer === true) return;
    // Server-only statement (SQL / env / server-context meta): prune subtree.
    if (isServerOnlyNode(node)) return;

    // ---- Client-side BINDING names (the scope-blindness guard). ------------
    if (boundOut) {
      if (node.kind === "each-block") { collectBindingsInto(node.asName, boundOut); collectBindingsInto(node.asNames, boundOut); }
      else if (node.kind === "for-stmt") { collectBindingsInto(node.variable, boundOut); }
      else if (node.kind === "let-decl" || node.kind === "const-decl" ||
               node.kind === "tilde-decl" || node.kind === "lin-decl") { collectBindingsInto(node.name, boundOut); }
    }

    // ---- The node's own ExprNode fields, from the SHARED field list. -------
    for (const f of EXPR_NODE_FIELDS) collectFromExprNode(node[f]);

    // ---- Every other position, from the ONE shared table. ------------------
    forEachExprPosition(node, SUPPORTS, (p) => {
      switch (p.kind) {
        case "expr-node":     collectFromExprNode(p.value); break;
        case "expr-source":   collectFromExprSource(p.value); break;
        case "block-source":  collectFromBlockSource(p.value); break;
        case "template-text": collectFromTemplateText(p.value); break;
        case "callee-name":   collectFromCalleeName(p.value); break;
        // `literal-text` / `cell-name` / `cell-name-list` are not in SUPPORTS
        // and can never arrive here.
        default: break;
      }
    });

    // ---- Recurse into every array-valued child (body / children / …). ------
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && typeof child.kind === "string") visit(child);
        }
      }
    }
  };

  for (const node of getNodes(fileAST)) visit(node);
  if (fileAST && typeof fileAST === "object") _memo.set(fileAST, { routeMap, refs, bound });
  if (opts?.boundOut) for (const b of bound) opts.boundOut.add(b);
  return refs;
}
