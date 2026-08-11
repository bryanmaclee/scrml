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
 * THE TABLE SHARES WHICH FIELDS, NOT WHICH NODES. Recursion is still this file's
 * (see `visit`), and it descends only ARRAY-valued children — while
 * `dependency-graph.ts` carries an explicit OBJECT descent for `lift-expr`, whose
 * `.expr` is a `LiftTarget` union rather than an array. A `lift` body is
 * therefore invisible HERE no matter how well the table describes it, and that
 * is three live cross-file `ReferenceError`s on this ref and on `main` alike:
 * `g-263-lift-body-invisible-to-the-client-read-seed-node-traversal`.
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
  "expr-node", "expr-source", "statement-source", "markup-source",
  "template-text", "callee-name",
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

/**
 * Per-file memo. BOTH consumers ask the same question about the same file in one
 * compile — `runCG`'s cross-file precompute walks every importing file, and the
 * per-file `emitReferencedModuleExportConstLines` walks the file again — and the
 * walk is not cheap (it PARSES every raw-source position rather than regexing it).
 * Keyed on AST object identity, so a fresh compile with fresh ASTs never hits a
 * stale entry; the `routeMap` is recorded and checked because server-boundary
 * classification is an input to the answer.
 */
const _memo = new WeakMap<object, { routeMap: unknown; refs: Set<string> }>();

/**
 * Collect the names of MODULE-SCOPE bindings that CLIENT-emitted user code in
 * this file reads.
 *
 * ═══ MODULE-SCOPE IS THE WHOLE POINT, AND IT IS WHY THIS IS SCOPE-AWARE ═══
 *
 * Every caller asks the same question — "does client code read the module-level
 * binding `X`?" — and a name that is BOUND by an enclosing client scope is not a
 * read of `X`, it is a read of the shadow. Getting that wrong costs in both
 * directions, and both costs are real and were MEASURED:
 *
 *   LEAK (§14.8, critical). `fn compute() { return @rows.map(SECRET => SECRET + 1) }`
 *   alongside a server-only `export const SECRET`. The lambda param has nothing
 *   to do with the export, but a scope-blind collector records `SECRET` as read
 *   and the exporter ships the value to the browser.
 *
 *   UNDER-EMIT (#263/#358, high). `function greet(NEEDED) { … }` alongside
 *   `on mount { @a = NEEDED }` where `NEEDED` is a directly-imported const. The
 *   `on mount` read is a genuine module-scope read; suppressing it because some
 *   unrelated function happens to bind that name drops the const from the
 *   dependency's `.client.js` and the browser throws `ReferenceError` at exit 0.
 *
 * A FLAT BAG OF BOUND NAMES CANNOT SEPARATE THOSE TWO, and the previous design
 * tried: it collected bindings into a set and asked callers to subtract it. That
 * is an over-approximation whose error is always "suppress", i.e. always the
 * under-emit this arc exists to eliminate — and it was applied at ONE of the two
 * call sites, so the other leaked. A scope STACK answers both correctly, costs a
 * push and a pop per scope, and removes the caller-side policy entirely: there is
 * now nothing for a call site to get wrong, because there is nothing for it to do.
 *
 * ═══ §14.8 — THE OTHER THREE DISCIPLINES ═══
 *
 * 1. PRUNE FIRST. A server-boundary `function-decl` body lowers to a client fetch
 *    STUB that never names what it closes over; a `<x server>` state-decl resolves
 *    its initializer server-side; an `isServerOnlyNode` statement (`?{}` SQL, env
 *    reads, server-context meta) is server-resident. All three subtrees are pruned
 *    before any collection.
 * 2. PARSE, NEVER REGEX. Every raw-source position is PARSED and walked as real
 *    ident nodes. A bare-identifier regex over source text reads inside string
 *    literals and comments — the string-blind leak the #263 AST-precise gate
 *    replaced, and why `literal-text` is not in this consumer's `SUPPORTS` set.
 *    `template-text` goes through the escape-aware `forEachTemplateInterpolation`:
 *    an ESCAPED `\${SECRET}` is literal text codegen never wires.
 * 3. FAIL CLOSED on shape, but NOT on scope. An unparseable initializer is
 *    skipped. Scope is different: a name whose binding structure cannot be read is
 *    treated as BOUND (suppress), because there the safe direction is the leak-free
 *    one.
 *
 * @param fileAST  the file AST (post symbol-table, so `_record` is populated).
 * @param filePath the file's path, for span-anchored re-parses and the routeMap key.
 * @param routeMap the compile unit's route map (server-boundary classification).
 */
export function collectClientReadIdents(
  fileAST: any,
  filePath: string,
  routeMap: any,
): Set<string> {
  if (fileAST && typeof fileAST === "object") {
    const hit = _memo.get(fileAST);
    if (hit && hit.routeMap === routeMap) return hit.refs;
  }
  const refs = new Set<string>();

  // ---- The scope stack. ----------------------------------------------------
  // One frame per client scope that BINDS names: a `function`/`fn` body (its
  // params), a lambda body (its params), an `<each>` body (its `as` names), a
  // `for` body (its loop variable). Locals (`let`/`const`/`~`/`lin`) are added to
  // the frame they appear in.
  const scopes: Array<Set<string>> = [];
  const isShadowed = (n: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return true;
    return false;
  };
  /** Bind `names` into the CURRENT frame (module scope has no frame — see below). */
  const bindHere = (names: Iterable<string>): void => {
    const frame = scopes[scopes.length - 1];
    if (!frame) return; // module scope: a top-level local IS the module binding
    for (const n of names) frame.add(n);
  };

  const addName = (n: unknown): void => {
    if (typeof n !== "string" || !n || n.startsWith("@")) return;
    if (isShadowed(n)) return; // a read of the shadow, not of the module binding
    refs.add(n);
  };

  /**
   * Every binding name reachable through a binding-target field: a bare string
   * loop-var / decl name, a `{name}` param, an array of such, or a nested
   * destructure pattern. Over-collection here is the LEAK-SAFE direction (an
   * extra bound name only ever suppresses a read), which is why the pattern walk
   * is generous rather than exact.
   */
  const bindingNamesOf = (x: any, out: Set<string>): Set<string> => {
    if (x == null) return out;
    if (typeof x === "string") { if (x && !x.startsWith("@")) out.add(x); return out; }
    if (Array.isArray(x)) { for (const el of x) bindingNamesOf(el, out); return out; }
    if (typeof x === "object") {
      bindingNamesOf(x.name, out);
      for (const k of ["elements", "properties", "props", "value", "values",
                       "argument", "left", "fields", "entries", "items", "params"]) {
        if (x[k] != null && typeof x[k] === "object") bindingNamesOf(x[k], out);
      }
    }
    return out;
  };

  /** Run `body` with one extra scope frame holding `names`. */
  const inScope = (names: Set<string>, body: () => void): void => {
    scopes.push(names);
    try { body(); } finally { scopes.pop(); }
  };

  /**
   * Structural descent over an ExprNode graph collecting every real `ident` node.
   * `forEachIdentInExprNode` stops at a lambda scope boundary (that boundary is
   * correct for `lin` capture tracking and wrong for us — a const read inside a
   * client-side `() => …` IS a client read), so this walk supplements it and
   * pushes the lambda's own scope while descending its body.
   *
   * A member expression's `.property` is a plain STRING, not an ident node, so
   * property names can never be collected here.
   */
  const collectIdentNamesDeep = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) collectIdentNamesDeep(x); return; }
    if (n.kind === "ident") addName(n.name);
    const descend = (): void => {
      for (const k of Object.keys(n)) {
        if (k === "span" || k === "kind" || k === "name") continue;
        const v = n[k];
        if (v && typeof v === "object") collectIdentNamesDeep(v);
      }
    };
    // A lambda binds its params for the whole of its own subtree — including its
    // default-value expressions, which is the leak-safe over-approximation.
    if (n.kind === "lambda") inScope(bindingNamesOf(n.params, new Set<string>()), descend);
    else descend();
  };

  const collectFromExprNode = (expr: any): void => {
    if (!expr || typeof expr !== "object" || typeof expr.kind !== "string") return;
    try {
      // Guarded by the SAME scope stack: `forEachIdentInExprNode` stops AT a
      // lambda boundary, so anything it reports is outside one — but a read
      // inside an enclosing `function`/`each`/`for` scope still has to be
      // filtered, and `addName` is where that happens.
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
   * Client-executed STATEMENTS given as raw source — an `on mount` body, an
   * engine `:`-shorthand state-child or `<onTransition>` body. Consume statements
   * the way `mountBodyExprNode` detects them: parse, then advance past the parsed
   * span. Any parse failure just stops (fail-closed).
   */
  const collectFromStatementSource = (raw: unknown): void => {
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
    // A statement body may still carry `${…}` (the `<onTransition>${…}</>` form).
    if (raw.includes("${")) {
      forEachTemplateInterpolation(raw, (interior) => { collectFromExprSource(interior); });
    }
  };

  /**
   * A RENDERED BODY given as raw source — an `<each>` per-item template,
   * `<match>` arms, a bare-body engine state-child, an engine `rulesRaw`.
   *
   * ONLY THE `${…}` INTERIORS ARE READ, and that is the whole point. The rest is
   * prose the compiler emits as a text node, and running prose through the
   * expression parser turns rendered words into "client reads":
   *
   *     <each in=@rows as r>SECRET items</each>
   *
   * shipped `const SECRET = "…"` into the client bundle beside the
   * `createTextNode("SECRET items")` that proves the body is pure literal. This
   * file's own rule is PARSE, NEVER REGEX, because a regex reads inside string
   * literals; parsing prose is the same string-blindness pointed the other way,
   * and it fails toward the leak. The fix is not a better heuristic — the shared
   * table now DECLARES which raw bodies are statements and which are markup, from
   * the AST that already knows.
   */
  const collectFromMarkupSource = (raw: unknown): void => {
    if (typeof raw !== "string" || !raw.includes("${")) return;
    forEachTemplateInterpolation(raw, (interior) => { collectFromExprSource(interior); });
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

  /** The positions + child recursion for one node, under whatever scope is live. */
  const visitBody = (node: any): void => {
    // ---- The node's own ExprNode fields, from the SHARED field list. -------
    for (const f of EXPR_NODE_FIELDS) collectFromExprNode(node[f]);

    // ---- Every other position, from the ONE shared table. ------------------
    forEachExprPosition(node, SUPPORTS, (p) => {
      // ═══ THE CLIENT-BINDING GATE — the ruling this file exists under ═══
      //
      // The shared table answers "where does user expression SOURCE appear?".
      // THIS consumer asks "which identifiers must the emitted bundle DECLARE?".
      // Those are different questions, and every gap between them has been a
      // §14.8 leak: prose the compiler renders as text, an attribute it lowers to
      // a static HTML string, an `if=` predicate it lowers to a STRING KEY into
      // the reactive store, a name that is merely shadowed.
      //
      // Over-emitting silently ships a secret; under-emitting throws a loud
      // `ReferenceError` an adopter can see and report. That asymmetry is why the
      // table's type has no "undetermined" value to fall through: a position must
      // declare a measured answer, and `"not-binding"` is the fail-closed one.
      if (p.clientBinding !== "binding") return;
      switch (p.kind) {
        case "expr-node":        collectFromExprNode(p.value); break;
        case "expr-source":      collectFromExprSource(p.value); break;
        case "statement-source": collectFromStatementSource(p.value); break;
        case "markup-source":    collectFromMarkupSource(p.value); break;
        case "template-text":    collectFromTemplateText(p.value); break;
        case "callee-name":      collectFromCalleeName(p.value); break;
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

  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;

    // ---- PRUNES (see §14.8 discipline 1 in the doc above). -----------------
    if (node.kind === "function-decl") {
      // Server fn → its body lowers to a stub; its refs do NOT cross. Prune.
      if (fnNodeIsServerBoundary(node, filePath, routeMap)) return;
      // The fn's NAME binds in the ENCLOSING scope — a top-level `function greet`
      // IS a module binding, and if an import shares that name the local wins, so
      // the import is genuinely not read. The PARAMS bind only inside the body.
      bindHere(bindingNamesOf(node.name, new Set<string>()));
      inScope(bindingNamesOf(node.params, new Set<string>()), () => {
        if (Array.isArray(node.body)) for (const s of node.body) visit(s);
      });
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

    // ---- Scope-INTRODUCING nodes. ------------------------------------------
    // `<each … as X>` binds X for its body; the body includes the raw `bodyRaw`
    // position, which is why the frame wraps the whole node visit and not just
    // the child recursion.
    if (node.kind === "each-block") {
      const names = bindingNamesOf(node.asName, new Set<string>());
      bindingNamesOf(node.asNames, names);
      inScope(names, () => visitBody(node));
      return;
    }
    if (node.kind === "for-stmt" || node.kind === "for-expr") {
      inScope(bindingNamesOf(node.variable, new Set<string>()), () => visitBody(node));
      return;
    }

    // ---- Locals bind in the frame they appear in. --------------------------
    // Added BEFORE this node's own positions are read, so a local's initializer
    // that mentions its own name resolves to the local. Order within a block is
    // deliberately ignored (a read textually above the declaration is also
    // treated as shadowed) — that is the leak-safe direction.
    if (node.kind === "let-decl" || node.kind === "const-decl" ||
        node.kind === "tilde-decl" || node.kind === "lin-decl") {
      bindHere(bindingNamesOf(node.name, new Set<string>()));
    }

    visitBody(node);
  };

  for (const node of getNodes(fileAST)) visit(node);
  if (fileAST && typeof fileAST === "object") _memo.set(fileAST, { routeMap, refs });
  return refs;
}
