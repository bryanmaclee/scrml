/**
 * @module codegen/reactive-deps
 *
 * AST-based reactive dependency extraction for the CG stage.
 *
 * Provides string-literal-aware extraction of @var references from expression strings,
 * replacing inline regex scanning in emit-event-wiring.js and emit-logic.js.
 *
 * The key improvement over naive regex: a scan of `@var` in `"use @theme here"` will
 * correctly return nothing (the reference is inside a string literal), whereas a bare
 * regex test on the full expression string would produce a false positive.
 *
 * Optionally filters results against a known set of reactive variable names collected
 * from the AST. This provides the scope-chain-based filtering described in Phase 4 of
 * the CG rewrite plan.
 */

import { getNodes } from "./collect.ts";
import { extractReactiveDepsFromAST, forEachIdentInExprNode, emitStringFromTree } from "../expression-parser.ts";
import { findMapEntryColon } from "../type-system.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// extractReactiveDeps
// ---------------------------------------------------------------------------

/**
 * Extract all reactive variable names (@var) referenced in an expression string.
 *
 * Respects string literal boundaries — @var inside quoted strings is NOT extracted.
 * Handles single-quoted, double-quoted, and template literal strings.
 * Handles escaped characters inside strings.
 *
 * @param expr — raw expression string (may contain @var references)
 * @param knownReactiveVars — if provided, only return names in this set
 * @returns set of reactive variable names (without @ prefix)
 */
export function extractReactiveDeps(
  expr: string,
  knownReactiveVars: Set<string> | null = null,
): Set<string> {
  if (!expr || typeof expr !== "string") return new Set();

  // Phase 1 restructure: try acorn-based extraction first.
  // Falls back to manual scanner for expressions acorn can't parse.
  try {
    const astResult = extractReactiveDepsFromAST(expr, knownReactiveVars);
    if (astResult.size > 0) return astResult;
  } catch {
    // Acorn parse failed — fall through to manual scanner
  }

  const found = new Set<string>();
  let inString: string | null = null; // null, '"', "'", or '`'
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (inString === null) {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        i++;
        continue;
      }
      // Check for @varName pattern
      if (ch === '@') {
        // Peek ahead: must be followed by an identifier start char
        const rest = expr.slice(i + 1);
        const m = rest.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (m) {
          const varName = m[1];
          if (knownReactiveVars === null || knownReactiveVars.has(varName)) {
            found.add(varName);
          }
          i += 1 + varName.length;
          continue;
        }
      }
      i++;
    } else {
      // Inside a string literal
      if (ch === '\\') {
        // Skip the escaped character
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i++;
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// collectReactiveVarNames
// ---------------------------------------------------------------------------

/**
 * Collect all reactive variable names declared in a fileAST.
 *
 * Walks logic blocks for state-decl nodes and returns their names.
 * This gives a fast lookup set for use with extractReactiveDeps filtering.
 *
 * @param fileAST
 * @returns set of reactive variable names (without @ prefix)
 */
export function collectReactiveVarNames(fileAST: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const nodes = getNodes(fileAST);

  // §51.9 — projected vars from derived machines are not declared via
  // state-decl; they're synthesized at runtime in _scrml_derived_fns.
  // Without them in this set, extractReactiveDeps filters out @ui references
  // in markup interpolations, and emit-event-wiring never wraps the DOM
  // binding in _scrml_effect — so writes to the source @order don't flow to
  // the DOM. Include projected var names so downstream effect emission sees
  // them as reactive.
  const machineRegistry = fileAST.machineRegistry as Map<string, unknown> | undefined;
  if (machineRegistry && typeof (machineRegistry as any).values === "function") {
    for (const m of (machineRegistry as Map<string, { isDerived?: boolean; projectedVarName?: string | null }>).values()) {
      if (m && m.isDerived && m.projectedVarName) {
        names.add(m.projectedVarName);
      }
    }
  }

  // Bug 1.5 (S87 follow-on) — §51.0.C auto-declared engine variables.
  // `<engine for=Type>` (and legacy `<machine name=N for=Type>`) declares a
  // reactive cell whose name is computed by ast-builder per §51.0.C
  // (lowercase-first-character literal rule). The variable is stamped onto
  // the `engine-decl` AST node as `node.varName` (ast-builder.js:9508) AND
  // mirrored to SYM PASS 10.A's `_record.engineMeta.varName` annotation.
  //
  // Without this set, markup interpolations like `${@marioState}` get
  // filtered by `extractReactiveDeps` (`marioState` is not a known reactive
  // name), `emit-event-wiring.ts:832` sees `varRefs.length === 0`, and the
  // reactive-display effect is never emitted — the placeholder span stays
  // blank in the rendered DOM.
  //
  // We prefer `fileAST.machineDecls` (ast-builder's pre-collected list of
  // engine-decl nodes) so we cover engines in markup-child position without
  // needing the markup visit() loop to reach them. Fall back to walking
  // engine-decl encountered during the visit (covers test fixtures that
  // bypass ast-builder's collectHoisted pass).
  const machineDecls = (fileAST.machineDecls as Array<Record<string, unknown>> | undefined)
    ?? ((fileAST.ast as Record<string, unknown> | undefined)?.machineDecls as Array<Record<string, unknown>> | undefined);
  if (Array.isArray(machineDecls)) {
    for (const decl of machineDecls) {
      const engineVarName = _resolveEngineVarName(decl);
      if (engineVarName) names.add(engineVarName);
    }
  }

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      // Bug 1.5 — engine-decl auto-declares a reactive cell per §51.0.C.
      // Covers nested `<engine>` (§51.0.Q.1) found inside bodyChildren as
      // well as engine-decls in fixtures that bypass machineDecls pre-
      // collection. Idempotent with the machineDecls pre-collected path
      // above (Set semantics dedupe).
      if (n.kind === "engine-decl") {
        const engineVarName = _resolveEngineVarName(n);
        if (engineVarName) names.add(engineVarName);
        if (Array.isArray((n as any).bodyChildren)) {
          visit((n as any).bodyChildren as unknown[]);
        }
      }
      if (n.kind === "state-decl" && n.name) {
        names.add(n.name as string);
      }
      // Bug 4 fix: derived reactive decls (`const @name = expr`, post-Step-
      // 11.5 represented as state-decl with shape:"derived") must be
      // recognized by the markup display-wiring pass. Without them in this
      // set, `extractReactiveDeps` filters `${@isInsert}` out of binding
      // reactive refs, emit-event-wiring sees empty varRefs, no effect wrap
      // is emitted, and the named derived reference never updates in the DOM
      // after the first render. The wiring target calls _scrml_derived_get
      // inside _scrml_effect — on first run the derived fn evaluates, reads
      // its upstream @roots via _scrml_reactive_get, and the outer effect
      // picks up those deps. Subsequent mutations propagate dirty-flags and
      // re-fire the effect normally.
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
      if (n.kind === "state-decl" && (n as any).shape === "derived" && n.name) {
        names.add(n.name as string);
      }
      // Tilde-decl with reactive deps compiles to a derived reactive
      // Phase 4d: ExprNode-first — check initExpr for @-prefixed idents, string fallback
      if (n.kind === "tilde-decl" && n.name) {
        const initExpr = n.initExpr;
        const hasReactiveDep = initExpr
          ? _exprNodeHasReactiveRef(initExpr)
          : /@/.test((n.init as string) ?? "");
        if (hasReactiveDep) {
          names.add(n.name as string);
        }
      }
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      // Recurse into control flow bodies (match arms, if/else, for/while, try)
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return names;
}

// ---------------------------------------------------------------------------
// collectDerivedVarNames
// ---------------------------------------------------------------------------

/**
 * Collect all derived reactive variable names declared in a fileAST.
 *
 * Walks logic blocks for derived state-decl nodes and returns their names.
 * This set is used by rewriteReactiveRefs to route reads of derived names through
 * _scrml_derived_get() instead of _scrml_reactive_get().
 *
 * Per §6.6: `const @name = expr` declarations produce state-decl nodes with
 * shape:"derived" + structuralForm:false (post Phase A1a Step 11.5 fold of the
 * retired `reactive-derived-decl` kind). Their values live in the derived
 * cache, not the reactive state map. Reads must use _scrml_derived_get to
 * benefit from lazy pull + dirty flag semantics.
 *
 * @param fileAST
 * @returns set of derived variable names (without @ prefix)
 */
export function collectDerivedVarNames(fileAST: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
      if (n.kind === "state-decl" && (n as any).shape === "derived" && n.name) {
        names.add(n.name as string);
      }
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      // Recurse into control flow bodies (match arms, if/else, for/while, try)
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return names;
}

// ---------------------------------------------------------------------------
// collectMapVarNames (§59 — value-native maps, D4)
// ---------------------------------------------------------------------------

/**
 * §59.4 — Recognise whether a raw type-annotation string is a value-native map
 * type `[KeyT: ValT]` (optionally suffixed `@ordered`, §59.8).
 *
 * This MIRRORS the typer's map-type recognizer branch in
 * `type-system.ts:resolveTypeExpr` (the §59.2/§59.3 block): strip a trailing
 * `@ordered` affix, require the body to be a `[...]` bracket, and require a
 * depth-1 entry-colon that is NOT a ternary alternative-separator (via the
 * shared, exported `findMapEntryColon`). The array affix `T[]` ends in `[]`
 * with no internal colon, so it is correctly excluded.
 *
 * Codegen has NO resolved type at the emit site (it re-parses expressions), so
 * this string-level recognizer reproduces the typer's decision from the raw
 * annotation text carried on the decl node (`typeAnnotation`). The recognition
 * is deliberately conservative: a string that does not match the map shape is
 * simply not a map (it falls through to ordinary array/index/call emission).
 */
export function isMapTypeAnnotation(annotation: string): boolean {
  if (!annotation) return false;
  let body = annotation.trim();
  if (body.endsWith("@ordered")) {
    body = body.slice(0, -"@ordered".length).trim();
  }
  if (!body.startsWith("[") || !body.endsWith("]")) return false;
  const inner = body.slice(1, -1);
  return findMapEntryColon(inner) >= 0;
}

/**
 * §59 (D4) — Collect the names of every cell that holds a value-native MAP, so
 * `emit-expr.ts` can intercept `@m[k]` reads, `@m.<method>(…)` calls, and the
 * `@m.size` member and lower them to the `_scrml_map_*` runtime (§59.6/§59.7/
 * §59.8). Names are bare (no `@` prefix), mirroring `collectEngineVarNames`.
 *
 * A cell is a map iff EITHER:
 *   (a) its `state-decl` type annotation resolves to a `[KeyT: ValT]` map type
 *       (`<fareByLane>: [string: Money] = [:]`), OR
 *   (b) its initializer RHS is a `map-lit` expression (`<m> = ["a": 1]` makes
 *       `m` a map even without an annotation — and `<m> = [:]` the empty map).
 *
 * This is the name-set the survey (SURVEY-SYNTHESIS D4 Q2) prescribes: codegen
 * cannot key the map-vs-array branch on a resolved type (there is none at the
 * emit site), so it keys on this collected name-set, exactly as `.advance`
 * interception keys on `engineVarNames`.
 *
 * The fileAST walk mirrors `collectDerivedVarNames` (logic bodies, children,
 * control-flow bodies) so map cells declared inside `${…}` logic blocks /
 * control flow are discovered. Both `state-decl` (the reactive `@m` cells that
 * brackets/methods operate on) and plain `let`/`const` decls are scanned; only
 * `state-decl` carries `typeAnnotation`, so let/const map-ness comes solely from
 * a `map-lit` RHS.
 */
export function collectMapVarNames(fileAST: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  // Null-safe: synthetic test harnesses (and some emit paths) may pass a null /
  // undefined fileAST. `getNodes` dereferences `.nodes`, so guard before it.
  if (!fileAST || typeof fileAST !== "object") return names;
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;

      // Map-cell signals: an annotated map-typed state-decl OR a map-lit RHS.
      if (
        (n.kind === "state-decl" ||
          n.kind === "let-decl" ||
          n.kind === "const-decl") &&
        typeof n.name === "string" &&
        n.name.length > 0
      ) {
        // (a) typed `[KeyT: ValT]` annotation (state-decl only carries it).
        const anno = (n as any).typeAnnotation;
        if (typeof anno === "string" && isMapTypeAnnotation(anno)) {
          names.add(n.name as string);
        }
        // (b) `map-lit` initializer RHS — including the `[:]` empty map. This
        // makes an un-annotated cell a map by inference from its literal.
        const init = (n as any).initExpr;
        if (init && typeof init === "object" && (init as any).kind === "map-lit") {
          names.add(n.name as string);
        }
      }

      // Recurse the same structures as collectDerivedVarNames so map cells
      // declared inside logic blocks / compounds / control flow are found.
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return names;
}

/**
 * §59.8 (S169) — Collect the names of every cell whose `state-decl` type
 * annotation is an `@ordered` value-native map (`[KeyT: ValT]@ordered`). This is
 * the STRICT subset of `collectMapVarNames` for which a map-literal VALUE must
 * lower to insertion-order iteration (`_scrml_map_from_entries([...], true)`).
 *
 * The ordered-ness of a map VALUE is a property of the TARGET CELL's type, NOT
 * of the literal — a bare `["a": 1]` is unordered; the same literal assigned to
 * an `@ordered` cell is ordered. Codegen has no resolved type at the emit site,
 * so `emit-expr.ts` keys the ordered-vs-unordered branch on this name-set
 * (`emitAssign` reassignments) exactly as `mapVarNames` keys the map-vs-array
 * branch. The decl's OWN init RHS is handled directly from `node.typeAnnotation`
 * in `emit-logic.ts` (no set lookup needed there).
 *
 * Mirrors `collectMapVarNames`, but admits a cell ONLY when its `typeAnnotation`
 * is an `@ordered` map: `isMapTypeAnnotation(ann)` AND the trimmed annotation
 * ends in `@ordered`. A `map-lit` RHS WITHOUT the affix does NOT make a cell
 * ordered (the §59 default is unordered), so the (b) RHS-inference branch of
 * `collectMapVarNames` is deliberately omitted here.
 */
export function collectOrderedMapVarNames(
  fileAST: Record<string, unknown>,
): Set<string> {
  const names = new Set<string>();
  if (!fileAST || typeof fileAST !== "object") return names;
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;

      // Only `state-decl` carries a `typeAnnotation`, and only an `@ordered`
      // map annotation makes a cell ordered.
      if (
        n.kind === "state-decl" &&
        typeof n.name === "string" &&
        n.name.length > 0
      ) {
        const anno = (n as any).typeAnnotation;
        if (
          typeof anno === "string" &&
          isMapTypeAnnotation(anno) &&
          anno.trim().endsWith("@ordered")
        ) {
          names.add(n.name as string);
        }
      }

      // Recurse the same structures as collectMapVarNames so ordered map cells
      // declared inside logic blocks / compounds / control flow are found.
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return names;
}

/**
 * §59 (D4) — Does this file USE a value-native map ANYWHERE? Drives the `'map'`
 * runtime chunk gate in `emit-client.ts:detectRuntimeChunks` — without the
 * chunk, a map-using build ReferenceErrors on `_scrml_map_get` (the helpers are
 * tree-shaken out of the assembled runtime).
 *
 * Returns true iff EITHER (a) the file declares at least one map cell (a
 * `[KeyT: ValT]` annotation or a `map-lit` RHS — via `collectMapVarNames`), OR
 * (b) a `map-lit` ExprNode appears ANYWHERE in the AST (a standalone literal, a
 * `.insertAll(["a": 1])` argument, a nested-map value literal, etc.).
 *
 * The (b) deep scan uses `forEachMapLitExprInExprNode` (expression-parser.ts) on
 * every `exprNode`/`initExpr` field reachable in the AST, so a map literal that
 * is never bound to a cell still lights up the chunk. Conservative by design:
 * a false positive (chunk included, map not used) is a few KB; a false negative
 * is a runtime crash (SURVEY-SYNTHESIS D4 R2).
 */
export function fileHasMapUsage(fileAST: Record<string, unknown>): boolean {
  if (!fileAST || typeof fileAST !== "object") return false;
  // (a) any declared map cell.
  if (collectMapVarNames(fileAST).size > 0) return true;
  // (b) any map-lit ExprNode anywhere — deep walk over all exprNode-bearing
  // fields. We require the structured walker lazily to avoid a cycle at module
  // load and to keep this dependency-light.
  const { forEachMapLitExprInExprNode } = require("../expression-parser.ts") as {
    forEachMapLitExprInExprNode: (n: any, cb: (m: any) => void) => void;
  };
  let found = false;
  const seen = new WeakSet<object>();
  const EXPR_FIELDS = ["exprNode", "initExpr", "inExprNode", "defaultExpr", "condExprNode", "bodyExprNode", "handlerExprNode", "value"];
  function walk(node: unknown): void {
    if (found || !node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Record<string, unknown>;
    // Direct map-lit node.
    if ((n.kind as string) === "map-lit") { found = true; return; }
    // Any expr-bearing field — descend the ExprNode tree for a nested map-lit.
    for (const f of EXPR_FIELDS) {
      const e = n[f];
      if (e && typeof e === "object" && (e as any).kind) {
        try { forEachMapLitExprInExprNode(e, () => { found = true; }); } catch { /* non-ExprNode shape */ }
        if (found) return;
      }
    }
    // Recurse arrays + child objects (logic bodies, children, control flow).
    for (const key in n) {
      const v = n[key];
      if (Array.isArray(v)) { for (const c of v) { walk(c); if (found) return; } }
      else if (v && typeof v === "object") { walk(v); if (found) return; }
    }
  }
  const nodes = getNodes(fileAST);
  for (const node of nodes as unknown[]) { walk(node); if (found) break; }
  return found;
}

// ---------------------------------------------------------------------------
// collectSynthCellKeys (Bug 61)
// ---------------------------------------------------------------------------

/**
 * Collect every DOTTED synth-cell key declared by emit-synth-surface.ts for the
 * compound parents in a fileAST (§55.5 / §55.6 / §55.7 validity surface).
 *
 * This set is the precise OVER-FIRE guard for emit-expr.ts:emitMember's Bug 61
 * branch: a member chain `@<compound>[.<field>].<synthProp>` collapses to
 * `_scrml_reactive_get("<dotted>")` ONLY when `<dotted>` is in this set. A plain
 * cell whose value happens to carry a field named `errors`/`submitted`/etc.
 * (`<config> = { errors: [] }` → `@config.errors`) is NOT in the set, so it
 * falls through to ordinary member access on the value object.
 *
 * KEY GENERATION mirrors `emit-synth-surface.ts:emitCompoundSynthSurface`
 * (line 115) EXACTLY so there is zero drift between the keys emit-synth-surface
 * DECLARES and the keys this collector authorizes for routing:
 *   - Compound parent at qualified name `q`: `q.errors`, `q.isValid`,
 *     `q.touched`, `q.submitted`.
 *   - Each FIELD CHILD passing the same fieldChildren filter as
 *     emit-synth-surface.ts:135: `q.<field>.errors`, `q.<field>.isValid`,
 *     `q.<field>.touched` (no `submitted` — per-field has no submitted, §55.7).
 *   - Nested compound-typed children recurse with `q = q + "." + childName`
 *     (matches the emit-logic.ts:1652 `compoundPathPrefix` recursion).
 *
 * The fileAST WALK mirrors `collectDerivedVarNames` above (logic bodies,
 * children, control-flow bodies) so compounds declared inside `${...}` logic
 * blocks / control flow are discovered.
 *
 * Keys are PLAIN (un-encoded) — they match the within-file synth declares + the
 * read sites (emit-synth-surface only encodes when a chunk encodingCtx is set;
 * the client.js declares + reads are plain). This collector runs at the
 * top-level (non-chunked) read-path, so plain keys are correct.
 *
 * @param fileAST
 * @returns set of dotted synth-cell keys (without @ prefix)
 */
export function collectSynthCellKeys(fileAST: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const nodes = getNodes(fileAST);

  // True iff `node` is a compound parent — same predicate as
  // emit-synth-surface.ts:122 + emit-logic.ts:1647.
  const isCompoundParent = (node: any): boolean =>
    node?._cellKind === "compound-parent" || Array.isArray(node?.children);

  // Mirror of emit-synth-surface.ts:135 fieldChildren filter — the children
  // that get a per-field synth surface (errors/isValid/touched). Compound-typed
  // children are EXCLUDED here (they get their own recursive surface) and
  // handled by the recursion in addCompoundKeys.
  const isFieldChild = (c: any): boolean => {
    if (!c || typeof c !== "object") return false;
    if (c.kind !== "state-decl") return false;
    if (c._cellKind === "compound-parent" || Array.isArray(c.children)) return false;
    if (c._cellKind === "markup-typed") return false;
    if (c.shape === "derived" && c.isConst === true) return false;
    return true;
  };

  // Generate keys for a compound parent at qualified name `q`, then recurse
  // into compound-typed children. Mirrors the emit-logic.ts compound-parent
  // recursion (compoundPathPrefix threading) + emit-synth-surface key-gen.
  const addCompoundKeys = (node: any, q: string): void => {
    // Compound-level surface (4 properties, §55.5).
    keys.add(`${q}.errors`);
    keys.add(`${q}.isValid`);
    keys.add(`${q}.touched`);
    keys.add(`${q}.submitted`);

    const children: any[] = Array.isArray(node?.children) ? node.children : [];
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      const childName: string = child.name;
      if (!childName) continue;
      if (isCompoundParent(child)) {
        // Nested compound — recurse with extended qualified name. Its own
        // compound-level surface + (recursively) its field surface are added
        // by the recursive call; it has NO per-field surface from the parent.
        addCompoundKeys(child, `${q}.${childName}`);
      } else if (isFieldChild(child)) {
        // Per-field surface (3 properties, §55.6 — no submitted).
        keys.add(`${q}.${childName}.errors`);
        keys.add(`${q}.${childName}.isValid`);
        keys.add(`${q}.${childName}.touched`);
      }
    }
  };

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      if (n.kind === "state-decl" && isCompoundParent(n) && n.name) {
        addCompoundKeys(n, n.name as string);
        // Do NOT also recurse `visit` into this compound's children —
        // addCompoundKeys already walked them (incl. nested compounds). A
        // compound's children are state-decls scoped to the compound, not
        // independent top-level declarations.
        continue;
      }
      if (n.kind === "logic" && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        visit(n.children as unknown[]);
      }
      // Recurse into control flow bodies (match arms, if/else, for/while, try)
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return keys;
}

// ---------------------------------------------------------------------------
// collectCompoundLeafTargets + stampCompoundDeepSetTargets (Bug B)
// ---------------------------------------------------------------------------

/**
 * Bug B (structural-compound deep-set mistarget). A field write on a Variant C
 * structural compound — `@a.ref = "p"` where `<a> <ref>="" </>` — must update
 * the field's BACKING LEAF cell (`a.ref`), NOT the compound parent (`a`).
 *
 * The compound parent `a` is emitted as a `_scrml_derived_declare("a", () =>
 * ({ ref: _scrml_reactive_get("a.ref") }))` composite that RECOMPUTES from the
 * leaf on every read (see emit-logic.ts state-decl compound-parent arm, where
 * each leaf registers at `${qualifiedName}.${childName}`). Writing the composite
 * via `_scrml_reactive_set("a", _scrml_deep_set(...))` is silently clobbered by
 * the next recompute — a lost mutation (SPEC §6.3.2 line 2229: `@formRes.name =
 * "Alice"` writes to 'name').
 *
 * This collector returns the two sets a deep-set retarget needs:
 *   - `parentNames`: every compound-parent qualified name (top-level + nested)
 *     — the gate. A deep-set is retargeted ONLY when its `target` is one of
 *     these. A FLAT-object cell (`<a> = { ref: "" }`) is NOT a compound parent,
 *     so `@a.ref = v` keeps the correct `_scrml_deep_set` on the cell value.
 *   - `leafKeys`: every BACKING leaf cell key — the qualified path of each
 *     field child that gets a real `_scrml_reactive_set` storage. Used to find
 *     the deepest STATICALLY-resolvable backing leaf along a write path.
 *
 * The compound-parent predicate + qualified-path recursion MIRROR
 * `collectSynthCellKeys` (and emit-logic.ts's compound-parent arm) EXACTLY so
 * the leaf-key naming has zero drift from what emit-logic DECLARES.
 */
export function collectCompoundLeafTargets(
  fileAST: Record<string, unknown>,
): { leafKeys: Set<string>; parentNames: Set<string> } {
  const leafKeys = new Set<string>();
  const parentNames = new Set<string>();
  const nodes = getNodes(fileAST);

  const isCompoundParent = (node: any): boolean =>
    node?._cellKind === "compound-parent" || Array.isArray(node?.children);

  // A field child registers a BACKING leaf cell (a real `_scrml_reactive_set`
  // storage) when it is a state-decl that is NOT itself a compound parent
  // (those recurse) — markup-typed and `const`-derived children are also
  // derived composites with no plain backing storage, so they are NOT
  // retarget destinations for a value write.
  const isBackingLeafChild = (c: any): boolean => {
    if (!c || typeof c !== "object") return false;
    if (c.kind !== "state-decl") return false;
    if (isCompoundParent(c)) return false;
    if (c._cellKind === "markup-typed") return false;
    if (c.shape === "derived" && c.isConst === true) return false;
    return true;
  };

  // Record a compound parent at qualified name `q`: register `q` as a parent,
  // each backing-leaf child at `q.<child>`, and recurse into nested compounds.
  const addCompound = (node: any, q: string): void => {
    parentNames.add(q);
    const children: any[] = Array.isArray(node?.children) ? node.children : [];
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      const childName: string = child.name;
      if (!childName) continue;
      const childQ = `${q}.${childName}`;
      if (isCompoundParent(child)) {
        // A nested compound is ALSO a backing path target at its own leaves;
        // recurse to register its parent name + its children's leaves.
        addCompound(child, childQ);
      } else if (isBackingLeafChild(child)) {
        leafKeys.add(childQ);
      }
    }
  };

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      if (n.kind === "state-decl" && isCompoundParent(n) && n.name) {
        addCompound(n, n.name as string);
        // addCompound already walked this compound's children (incl. nested
        // compounds) — do NOT also `visit` them as top-level decls.
        continue;
      }
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body as unknown[]);
      if (Array.isArray(n.children)) visit(n.children as unknown[]);
      if (n.kind === "match-stmt" && Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
      if (n.kind === "if-stmt") {
        if (Array.isArray((n as any).consequent)) visit((n as any).consequent as unknown[]);
        if (Array.isArray((n as any).alternate)) visit((n as any).alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray((n as any).body)) {
        visit((n as any).body as unknown[]);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray((n as any).body)) visit((n as any).body as unknown[]);
        if ((n as any).catchNode && Array.isArray((n as any).catchNode.body)) visit((n as any).catchNode.body as unknown[]);
        if (Array.isArray((n as any).finallyBody)) visit((n as any).finallyBody as unknown[]);
      }
    }
  }

  visit(nodes as unknown[]);
  return { leafKeys, parentNames };
}

/**
 * Bug B — stamp every `reactive-nested-assign` node whose `target` is a
 * structural-compound parent with its TRUE write destination:
 *   - `_deepSetLeafKey`: the deepest STATICALLY-resolvable backing leaf cell
 *     key along the write path (e.g. `a.ref`, `a.b.ref`, or `a.cfg` when the
 *     remainder is a plain-object nav `@a.cfg.deep`).
 *   - `_deepSetResidualPath`: the path segments PAST that leaf (the heterogeneous
 *     `string | { index }` shape preserved verbatim, S168). Empty → a plain
 *     `_scrml_reactive_set(leaf, value)`. Non-empty → a `_scrml_deep_set` of the
 *     remainder INTO the leaf cell's value.
 *
 * Resolution walks the STATIC string prefix of `path` (stopping at the first
 * computed `{ index }` segment, which cannot join into a leaf key), building
 * candidate keys `target.path[0]`, `target.path[0].path[1]`, … and selecting
 * the DEEPEST candidate present in `leafKeys`. A computed-index segment in the
 * remainder rides into `_deepSetResidualPath` and is deep-set verbatim.
 *
 * Nodes whose `target` is a FLAT cell (not in `parentNames`) are left UNSTAMPED —
 * emit-logic keeps the existing cell-targeted `_scrml_deep_set`, so flat-object
 * field writes (`<a> = { ref: "" }`; `@a.ref = v`) do NOT regress.
 *
 * Stamping is in-place on the shared AST nodes (mirrors SYM `_cellKind`/`_record`)
 * so emit-logic reads `node._deepSetLeafKey` regardless of which opts path the
 * statement reaches the emitter through. The walk recurses into FUNCTION bodies
 * (where the reproducer's deep-sets live) in addition to the structural bodies
 * `collectSynthCellKeys` covers.
 */
export function stampCompoundDeepSetTargets(fileAST: Record<string, unknown>): void {
  const { leafKeys, parentNames } = collectCompoundLeafTargets(fileAST);
  if (parentNames.size === 0) return; // no compound parents → nothing to retarget
  const nodes = getNodes(fileAST);
  const seen = new WeakSet<object>();

  const stampNode = (n: any): void => {
    const target = n.target;
    if (typeof target !== "string" || !parentNames.has(target)) return;
    const path: Array<string | { index?: unknown }> = Array.isArray(n.path) ? n.path : [];
    if (path.length === 0) return;
    // Walk the static string prefix, deepest-leaf wins.
    let bestKey: string | null = null;
    let bestLen = 0; // number of leading path segments consumed by bestKey
    let acc = target;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      if (typeof seg !== "string") break; // computed { index } — cannot extend the leaf key
      acc = `${acc}.${seg}`;
      if (leafKeys.has(acc)) {
        bestKey = acc;
        bestLen = i + 1;
      }
    }
    if (bestKey === null) return; // no backing leaf on the static prefix — leave to existing path
    n._deepSetLeafKey = bestKey;
    n._deepSetResidualPath = path.slice(bestLen);
  };

  const walk = (nodeList: unknown[]): void => {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) continue;
      seen.add(node);
      const n = node as any;
      if (n.kind === "reactive-nested-assign") {
        stampNode(n);
        // leaf node — no statement-body recursion (valueExpr is an ExprNode,
        // not a statement list).
        continue;
      }
      if (Array.isArray(n.body)) walk(n.body as unknown[]);
      if (Array.isArray(n.children)) walk(n.children as unknown[]);
      if (Array.isArray(n.consequent)) walk(n.consequent as unknown[]);
      if (Array.isArray(n.alternate)) walk(n.alternate as unknown[]);
      if (Array.isArray(n.bodyChildren)) walk(n.bodyChildren as unknown[]);
      if (Array.isArray(n.arms)) {
        for (const arm of n.arms) {
          if (arm && Array.isArray(arm.body)) walk(arm.body as unknown[]);
        }
      }
      if (n.kind === "match-stmt" && Array.isArray(n.body)) walk(n.body as unknown[]);
      if (n.kind === "try-stmt") {
        if (Array.isArray(n.body)) walk(n.body as unknown[]);
        if (n.catchNode && Array.isArray(n.catchNode.body)) walk(n.catchNode.body as unknown[]);
        if (Array.isArray(n.finallyBody)) walk(n.finallyBody as unknown[]);
      }
      if (n.expr && n.expr.node && typeof n.expr.node === "object") {
        walk([n.expr.node] as unknown[]);
      }
    }
  };

  walk(nodes as unknown[]);
}

// ---------------------------------------------------------------------------
// ExprNode-aware reactive ref detection (Phase 4d)
// ---------------------------------------------------------------------------

/**
 * Bug 1.5 — resolve the auto-declared variable name of an `engine-decl` AST
 * node. Prefers SYM PASS 10.A's `_record.engineMeta.varName` annotation
 * (post-symbol-table); falls back to ast-builder's stamped `node.varName`
 * (pre-symbol-table or test-fixture path); finally falls back to
 * `node.engineName` for the legacy `<machine name=N for=Type>` form where
 * `engineName` carries the auto-derived or `name=`-supplied identifier.
 *
 * Returns the name (without `@` prefix) or `null` when none could be
 * resolved (e.g. parse failure — SYM/TAB diagnostics handle that case).
 */
function _resolveEngineVarName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const record = n._record as { engineMeta?: { varName?: unknown } } | undefined;
  const fromRecord = record?.engineMeta?.varName;
  if (typeof fromRecord === "string" && fromRecord.length > 0) return fromRecord;
  if (typeof n.varName === "string" && (n.varName as string).length > 0) return n.varName as string;
  if (typeof n.engineName === "string" && (n.engineName as string).length > 0) return n.engineName as string;
  return null;
}

/**
 * Check whether an ExprNode tree contains any @-prefixed ident (reactive ref).
 * Used as a fast boolean check — no need to collect all names.
 */
function _exprNodeHasReactiveRef(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  let found = false;
  forEachIdentInExprNode(node as any, (ident) => {
    if (!found && typeof ident.name === "string" && ident.name.startsWith("@")) {
      found = true;
    }
  });
  return found;
}

/**
 * Extract all reactive variable names (@var) from an ExprNode tree.
 * ExprNode-first counterpart to extractReactiveDeps (string-based).
 *
 * @param node - An ExprNode tree (e.g. initExpr, condExpr)
 * @param knownReactiveVars - Optional filter set (without @ prefix)
 * @returns Set of reactive variable names (without @ prefix)
 */
export function extractReactiveDepsFromExprNode(
  node: unknown,
  knownReactiveVars: Set<string> | null = null,
): Set<string> {
  const found = new Set<string>();
  if (!node || typeof node !== "object") return found;
  forEachIdentInExprNode(node as any, (ident) => {
    if (typeof ident.name === "string" && ident.name.startsWith("@")) {
      const varName = ident.name.slice(1); // strip @
      if (knownReactiveVars === null || knownReactiveVars.has(varName)) {
        found.add(varName);
      }
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Transitive reactive dependency extraction via call-graph BFS (Bug J fix)
// ---------------------------------------------------------------------------

/**
 * A registry of function bodies for call-graph traversal.
 * Maps function name → array of function body statements.
 * Multiple entries per name are possible (cross-file).
 */
export type FunctionBodyRegistry = Map<string, { body: unknown[]; params: string[] }[]>;

/**
 * Build a FunctionBodyRegistry from a FileAST.
 * Collects all function-decl nodes and indexes them by name.
 */
export function buildFunctionBodyRegistry(fileAST: Record<string, unknown>): FunctionBodyRegistry {
  const registry: FunctionBodyRegistry = new Map();
  const nodes = getNodes(fileAST);

  function collectFunctions(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;

      if (n.kind === "function-decl" && n.name && Array.isArray(n.body)) {
        const name = n.name as string;
        if (!registry.has(name)) registry.set(name, []);
        registry.get(name)!.push({
          body: n.body as unknown[],
          params: (n.params as string[]) ?? [],
        });
        // Recurse into nested functions
        collectFunctions(n.body as unknown[]);
      }

      if (n.kind === "logic" && Array.isArray(n.body)) {
        collectFunctions(n.body as unknown[]);
      }
      if (Array.isArray(n.children)) {
        collectFunctions(n.children as unknown[]);
      }
    }
  }

  collectFunctions(nodes as unknown[]);
  return registry;
}

/**
 * Extract callee names from an expression string.
 * Simple direct-call extraction: `name(` pattern.
 */
function extractCalleesFromExprString(expr: string): string[] {
  const names: string[] = [];
  const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Extract reactive deps from a function body (flat scan — no recursion).
 * Walks body statements for @var patterns in expression strings.
 */
function extractReactiveDepsFromBody(
  body: unknown[],
  knownReactiveVars: Set<string> | null,
): { deps: Set<string>; callees: string[] } {
  const deps = new Set<string>();
  const callees: string[] = [];

  function visitStmt(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as ASTNode;

    // Skip nested function bodies — they have their own scope
    if (n.kind === "function-decl") return;

    // Extract from expression strings
    let exprStr = "";
    if (n.kind === "bare-expr") {
      exprStr = (n as any).exprNode
        ? emitStringFromTreeSafe((n as any).exprNode)
        : ((n.expr as string) ?? "");
    } else if (
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
      n.kind === "let-decl" ||
      n.kind === "const-decl" ||
      n.kind === "tilde-decl" ||
      n.kind === "state-decl"
    ) {
      exprStr = (n as any).initExpr
        ? emitStringFromTreeSafe((n as any).initExpr)
        : ((n.init as string) ?? "");
    } else if (n.kind === "return-stmt") {
      exprStr = (n as any).exprNode
        ? emitStringFromTreeSafe((n as any).exprNode)
        : ((n.expr as string) ?? "");
    }

    if (exprStr) {
      const exprDeps = extractReactiveDeps(exprStr, knownReactiveVars);
      for (const d of exprDeps) deps.add(d);
      callees.push(...extractCalleesFromExprString(exprStr));
    }

    // S96 transitive-dep tracker fix — pre-fix, the if-stmt / while-stmt /
    // for-stmt's `condition` (string) + `condExpr` (ExprNode) were silently
    // skipped because the recursion below only descends into Array-valued
    // children (consequent, alternate, body). That made `@mode` reads in
    // `if (@mode == "A") { ... }` invisible to derived-cell dep tracking,
    // even though direct-reads collection in dependency-graph.ts DOES walk
    // condExpr at line 339. The two paths were inconsistent.
    //
    // Mirrors the EXPR_STRING_FIELDS pattern in route-inference.ts:2298 (S87
    // Trio A fix) + collectReactiveRefsFromExprNode's exprNodeFields list
    // (dependency-graph.ts:338-341). Both string + ExprNode forms walked.
    const EXPR_STRING_FIELDS = ["condition", "test", "header", "iterable"] as const;
    for (const field of EXPR_STRING_FIELDS) {
      const v = (n as any)[field];
      if (typeof v === "string" && v) {
        const fieldDeps = extractReactiveDeps(v, knownReactiveVars);
        for (const d of fieldDeps) deps.add(d);
        callees.push(...extractCalleesFromExprString(v));
      }
    }
    const EXPR_NODE_FIELDS = ["condExpr", "testExpr", "headerExpr", "iterExpr"] as const;
    for (const field of EXPR_NODE_FIELDS) {
      const v = (n as any)[field];
      if (v && typeof v === "object" && (v as { kind?: string }).kind) {
        try {
          const s = emitStringFromTreeSafe(v);
          if (s) {
            const fieldDeps = extractReactiveDeps(s, knownReactiveVars);
            for (const d of fieldDeps) deps.add(d);
            callees.push(...extractCalleesFromExprString(s));
          }
        } catch { /* defensive — emitStringFromTreeSafe already catches */ }
      }
    }

    // Recurse into control flow children (but not nested functions)
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "id" || key === "name") continue;
      const val = (n as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === "object" && (child as ASTNode).kind) {
            visitStmt(child);
          }
        }
      }
    }
  }

  for (const stmt of body) {
    visitStmt(stmt);
  }

  return { deps, callees };
}

/**
 * Safe wrapper for emitStringFromTree that catches errors.
 */
function emitStringFromTreeSafe(node: unknown): string {
  try {
    return emitStringFromTree(node as any);
  } catch {
    return "";
  }
}

/**
 * Extract reactive dependencies transitively through function calls.
 *
 * Given an expression like `${upperOf(getMsg())}`, this function:
 * 1. Extracts direct @var refs from the expression (standard behavior)
 * 2. Extracts callee names from the expression
 * 3. For each callee, looks up its body in the function registry
 * 4. BFS through the call graph collecting reactive deps from each body
 * 5. Returns the union of all reactive deps found
 *
 * This fixes Bug J where markup interpolations using helper functions
 * that wrap reactive reads get no display-wiring because the @var
 * references are inside the helper function's body, not the
 * interpolation expression itself.
 *
 * @param expr — the interpolation expression string
 * @param knownReactiveVars — known reactive variable names for filtering
 * @param fnRegistry — function body registry from buildFunctionBodyRegistry
 * @returns set of reactive variable names (without @ prefix)
 */
export function extractReactiveDepsTransitive(
  expr: string,
  knownReactiveVars: Set<string> | null,
  fnRegistry: FunctionBodyRegistry,
): Set<string> {
  // Step 1: Extract direct deps from the expression itself
  const allDeps = extractReactiveDeps(expr, knownReactiveVars);

  // Step 2: BFS through call graph
  const visited = new Set<string>();
  const queue = extractCalleesFromExprString(expr);

  while (queue.length > 0) {
    const calleeName = queue.shift()!;
    if (visited.has(calleeName)) continue;
    visited.add(calleeName);

    const fnEntries = fnRegistry.get(calleeName);
    if (!fnEntries) continue;

    for (const { body } of fnEntries) {
      const { deps, callees } = extractReactiveDepsFromBody(body, knownReactiveVars);
      for (const d of deps) allDeps.add(d);
      for (const c of callees) {
        if (!visited.has(c)) queue.push(c);
      }
    }
  }

  return allDeps;
}

/**
 * S96 Issue C — Reactive iterable detection for `for (let x of EXPR)`.
 *
 * Returns true when EXPR contains AT LEAST ONE `@`-prefixed reactive ref —
 * either directly (`@cell`, `@cell.filter(...)`, `[...@cells, ...]`) OR
 * transitively through function-call indirection (`fn()` where `fn` body
 * reads `@state`).
 *
 * Per pa.md Rule 4 + SPEC V5-strict (§6.1.3): bare identifiers are LOCAL
 * (and shadow-collisions fire E-NAME-COLLIDES-STATE), so the V5-strict
 * boundary makes this predicate principled — "no `@`-ref in iterable" is
 * unambiguously snapshot semantics.
 *
 * Pre-S96 Issue C, both the chunk-gate in `emit-client.ts:detectRuntimeChunks`
 * and the for-stmt emitter in `emit-control-flow.ts:emitForStmt` matched only
 * the bare `@ident` shape. Iterables like `@tasks.filter(...)` (Case 3) and
 * `visibleItems()` (transitive) silently fell through to plain-for emission
 * — the surrounding `<ul>` rendered once at module-init and never re-rendered
 * on `@state` change. Adopter-visible "list never updates" bug.
 *
 * The fix preserves snapshot semantics for genuinely non-reactive iterables
 * (`fetchUsers()` reading only DB state, `localVar.filter(...)` where local
 * is a snapshot copy) — those produce empty dep sets and short-circuit to
 * the existing plain-for path.
 *
 * @param node — for-stmt AST node (carries `iterExpr` ExprNode and/or
 *   string fallback `iterable` / `collection`)
 * @param fnRegistry — function body registry from `buildFunctionBodyRegistry`.
 *   When null, only direct refs are checked (snapshot-correct but misses
 *   the transitive case).
 * @returns true if iterable depends on at least one reactive cell
 */
export function iterableHasReactiveRefs(
  node: { iterExpr?: unknown; iterable?: string; collection?: string },
  fnRegistry: FunctionBodyRegistry | null,
): boolean {
  const iterStr = (node.iterExpr && typeof node.iterExpr === "object")
    ? emitStringFromTreeSafe(node.iterExpr)
    : ((node.iterable as string | undefined) ?? (node.collection as string | undefined) ?? "");
  if (!iterStr) return false;
  if (fnRegistry) {
    return extractReactiveDepsTransitive(iterStr, null, fnRegistry).size > 0;
  }
  return extractReactiveDeps(iterStr, null).size > 0;
}
