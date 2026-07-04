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
 * §59.12 — Recognise whether a raw type-annotation string is a value-native SET
 * type `set[K]`. A set is a THIN DESUGAR over the §59 map (`[K: bool]`), so a
 * set cell rides ALL the map machinery (`_scrml_map_*`, the `map` runtime chunk,
 * bracket-read, `.size`, `.has`, `.remove`); this recognizer is what makes a set
 * cell ALSO a map cell in `collectMapVarNames`, and it backs the strict-subset
 * `collectSetVarNames` used by the set-vocabulary lowering (`.add`/`.elements`/
 * `.union`/`.intersect`/`.difference`) in emit-expr / emit-each.
 *
 * MIRRORS the typer's `set[K]` branch in `type-system.ts:resolveTypeExpr`:
 * leading `set[` affix, trailing `]`, non-empty element. A set is never
 * `@ordered` (no insertion-order surface in v1), so there is no affix to strip.
 */
export function isSetTypeAnnotation(annotation: string): boolean {
  if (!annotation) return false;
  const body = annotation.trim();
  if (!body.startsWith("set[") || !body.endsWith("]")) return false;
  return body.slice("set[".length, -1).trim().length > 0;
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
        // §59.12 — a `set[K]` annotation ALSO makes the cell a map cell (a set
        // desugars to `[K: bool]`), so it rides the full `_scrml_map_*` surface
        // (bracket-read / `.size` / `.has` / `.remove` / the `map` runtime
        // chunk). The set-SPECIFIC vocabulary is keyed on `collectSetVarNames`
        // (a strict subset) separately.
        const anno = (n as any).typeAnnotation;
        if (typeof anno === "string" && (isMapTypeAnnotation(anno) || isSetTypeAnnotation(anno))) {
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
 * §59.12 (D4) — Collect the names of every cell declared as a value-native SET
 * (`set[K]`), so `emit-expr.ts` / `emit-each.ts` can intercept the set-SPECIFIC
 * vocabulary and lower it: `.add(k)` → map `.insert(k, true)`; `.elements()` /
 * `<each in=@s>` → map `.keys()`; `.union` / `.intersect` / `.difference` →
 * the shipped `scrml:data` value-canonical algebra (rebuilt into a set). Names
 * are bare (no `@`), mirroring `collectMapVarNames`.
 *
 * This is the STRICT SUBSET of `collectMapVarNames` whose `state-decl` type
 * annotation is `set[K]`. The shared methods (`.has` / `.remove` / `.size`) and
 * bracket-read need NO set-specific handling — a set IS a map (in
 * `collectMapVarNames`), so they already lower via the `_scrml_map_*` surface.
 * Only the set-NATIVE spellings key on this name-set. A set with NO annotation
 * cannot exist (the empty seed `[:]` is a bare map without the `set[K]` type),
 * so set-ness comes SOLELY from the annotation — unlike maps, there is no
 * literal-RHS inference path (a `[:]` RHS makes a bare MAP, not a set).
 *
 * The fileAST walk mirrors `collectMapVarNames` exactly (logic bodies, children,
 * control-flow bodies) so set cells declared inside `${…}` / control flow are
 * found.
 */
export function collectSetVarNames(fileAST: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  if (!fileAST || typeof fileAST !== "object") return names;
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;

      if (
        (n.kind === "state-decl" || n.kind === "let-decl" || n.kind === "const-decl") &&
        typeof n.name === "string" &&
        n.name.length > 0
      ) {
        const anno = (n as any).typeAnnotation;
        if (typeof anno === "string" && isSetTypeAnnotation(anno)) {
          names.add(n.name as string);
        }
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
  return names;
}

// ---------------------------------------------------------------------------
// §59 (ss52) — NON-REACTIVE LOCAL map/set name collection (scope-aware).
//
// The reactive collectors above key on the `@`-cell sigil: they discover the
// MODULE-LEVEL `@`-prefixed map/set cells, which the emit-expr dispatch sites
// gate on `name.startsWith("@")`. A NON-REACTIVE LOCAL map/set (`let m = [:]`
// inside a pure `fn`) carries NO `@`, lives in a FUNCTION/BLOCK scope, and is
// absent from those file-wide registries — so its `.insert`/`.size`/`m[k]`/set
// methods fell through to RAW emission (`m.insert is not a function` at runtime;
// the (c) bug, PA-verified S225). These collectors discover such locals PER
// FUNCTION SCOPE so the dispatch sites can lower them to the bare-receiver
// `_scrml_map_*` form WITHOUT touching the reactive `@`-path (which stays
// byte-identical — locals key on a SEPARATE `localMapVarNames` set).
//
// Scope-awareness is load-bearing for correctness: a name that is a local MAP
// in one function and a local ARRAY in another must NOT cross-lower (a bare
// `arr[i]` read would mis-lower to `_scrml_map_get`). So the local sets are
// computed from a SINGLE function's body + params, never file-wide.
// ---------------------------------------------------------------------------

// Map methods that RETURN a new map (so `let m2 = m.insert(...)` makes m2 a map).
// Getters (`get`/`getOr`→V, `has`→bool, `keys`/`values`/`entries`/`sorted`→array)
// do NOT return a map and are intentionally excluded.
const MAP_RETURNING_METHODS = new Set<string>(["insert", "remove", "update", "insertAll"]);
// Set methods that RETURN a new set.
const SET_RETURNING_METHODS = new Set<string>(["add", "remove", "union", "intersect", "difference"]);

/**
 * §59 (ss52) — Build a per-file registry of `functionName → "map" | "set"` from
 * each `function-decl`'s RETURN type annotation, so a caller's
 * `let r = makeMap()` can classify `r` as a local map/set syntactically (the
 * "returned from a fn" case). Mirrors the typer's map/set recognizers — codegen
 * re-parses exprs and has no resolved type, so it reads the raw annotation text.
 */
export function buildFnReturnMapKinds(
  fileAST: Record<string, unknown>,
): Map<string, "map" | "set"> {
  const kinds = new Map<string, "map" | "set">();
  if (!fileAST || typeof fileAST !== "object") return kinds;
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as any;
      if (
        n.kind === "function-decl" &&
        typeof n.name === "string" &&
        n.name.length > 0 &&
        typeof n.returnTypeAnnotation === "string"
      ) {
        const ret = n.returnTypeAnnotation as string;
        if (isSetTypeAnnotation(ret)) kinds.set(n.name, "set");
        else if (isMapTypeAnnotation(ret)) kinds.set(n.name, "map");
      }
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "function-decl" && Array.isArray(n.body)) visit(n.body);
      if (n.kind === "match-stmt" && Array.isArray(n.body)) visit(n.body);
      if (n.kind === "if-stmt") {
        if (Array.isArray(n.consequent)) visit(n.consequent);
        if (Array.isArray(n.alternate)) visit(n.alternate);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray(n.body)) visit(n.body);
    }
  }
  visit(nodes as unknown[]);
  return kinds;
}

/**
 * §59 (ss52) — Collect the BARE names of every NON-REACTIVE LOCAL value-native
 * map/set binding within a SINGLE function's scope. Returns three sets
 * (mirroring the file-wide reactive trio): the local map names, the local set
 * names (a strict subset — a set IS a map, so set names are ALSO map names),
 * and the local `@ordered` map names.
 *
 * Seeded from (syntactic — SYM annotations are unreliable at codegen):
 *   - PARAMS with a `[K:V]` / `set[K]` type annotation (`fn f(m: [string:int])`);
 *   - `let`/`const`/`tilde`/`state` decls with a `[K:V]` / `set[K]` annotation;
 *   - `let`/`const` decls whose init RHS is a `map-lit` (`let m = [:]`, `["a":1]`);
 *   - decls/reassigns whose init RHS is map/set-RETURNING — a `.insert`/`.add`/
 *     `.union`/… call on an already-known local map/set, a bare ref to a known
 *     local, or a call to a file fn whose RETURN annotation is a map/set.
 *
 * The walk recurses control-flow bodies (so block-scoped `let m = [:]` inside an
 * `if`/`for`/`match` arm is found) but STOPS at nested `function-decl`s — those
 * are a DIFFERENT scope and get their own collection at emit time. A fixpoint
 * over the body handles forward references (a decl classified only once an
 * earlier-named map propagates).
 */
export function collectLocalMapSetNames(
  fnNode: Record<string, unknown>,
  fnReturnKinds?: Map<string, "map" | "set"> | null,
): {
  localMapVarNames: Set<string>;
  localSetVarNames: Set<string>;
  localOrderedMapVarNames: Set<string>;
} {
  const mapNames = new Set<string>();
  const setNames = new Set<string>();
  const orderedNames = new Set<string>();
  const empty = {
    localMapVarNames: mapNames,
    localSetVarNames: setNames,
    localOrderedMapVarNames: orderedNames,
  };
  if (!fnNode || typeof fnNode !== "object") return empty;

  let changed = false;
  const addMap = (nm: string): void => {
    if (!mapNames.has(nm)) { mapNames.add(nm); changed = true; }
  };
  const addSet = (nm: string): void => {
    if (!setNames.has(nm)) { setNames.add(nm); changed = true; }
    addMap(nm);
  };
  const addOrdered = (nm: string): void => {
    if (!orderedNames.has(nm)) { orderedNames.add(nm); changed = true; }
    addMap(nm);
  };

  // Classify a name from a raw type-annotation string. Returns true if it was a
  // map/set annotation (and registers the name accordingly).
  function seedFromAnnotation(nm: string, anno: unknown): boolean {
    if (typeof anno !== "string") return false;
    if (isSetTypeAnnotation(anno)) { addSet(nm); return true; }
    if (isMapTypeAnnotation(anno)) {
      if (anno.trim().endsWith("@ordered")) addOrdered(nm);
      else addMap(nm);
      return true;
    }
    return false;
  }

  // Classify an init/value expression as map- or set-returning, given the
  // names known SO FAR (the fixpoint re-runs until stable).
  function exprMapSetKind(expr: any): "map" | "set" | null {
    if (!expr || typeof expr !== "object") return null;
    if (expr.kind === "map-lit") return "map";
    if (expr.kind === "ident" && typeof expr.name === "string") {
      const nm = expr.name.startsWith("@") ? expr.name.slice(1) : expr.name;
      if (setNames.has(nm)) return "set";
      if (mapNames.has(nm)) return "map";
      return null;
    }
    if (expr.kind === "call" && expr.callee && typeof expr.callee === "object") {
      const callee = expr.callee;
      // `recv.METHOD(...)` — receiver-kind + method classifies the result.
      if (callee.kind === "member" && typeof callee.property === "string" && callee.object) {
        const recvKind = exprMapSetKind(callee.object);
        if (recvKind === null) return null;
        const method = callee.property as string;
        if (recvKind === "set") {
          if (SET_RETURNING_METHODS.has(method)) return "set";
          if (MAP_RETURNING_METHODS.has(method)) return "map";
          return null;
        }
        // recvKind === "map"
        if (MAP_RETURNING_METHODS.has(method)) return "map";
        return null;
      }
      // `makeMap(...)` — bare call to a file fn with a map/set return annotation.
      if (callee.kind === "ident" && typeof callee.name === "string" && fnReturnKinds) {
        return fnReturnKinds.get(callee.name) ?? null;
      }
    }
    return null;
  }

  // (1) Params — fixed (do NOT change across passes).
  const params = (fnNode as any).params;
  if (Array.isArray(params)) {
    for (const p of params) {
      if (!p || typeof p !== "object") continue;
      const pname = (p as any).name;
      if (typeof pname !== "string" || pname.length === 0) continue;
      seedFromAnnotation(pname, (p as any).typeAnnotation);
    }
  }

  // (2) Body — a fixpoint over decls/reassigns, recursing control-flow but NOT
  // nested function-decls (those are a separate scope).
  function scanStatements(stmts: unknown): void {
    if (!Array.isArray(stmts)) return;
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      const n = s as any;
      if (
        (n.kind === "let-decl" ||
          n.kind === "const-decl" ||
          n.kind === "tilde-decl" ||
          n.kind === "state-decl") &&
        typeof n.name === "string" &&
        n.name.length > 0
      ) {
        seedFromAnnotation(n.name, n.typeAnnotation);
        const k = exprMapSetKind(n.initExpr);
        if (k === "set") addSet(n.name);
        else if (k === "map") addMap(n.name);
      }
      // Recurse control-flow bodies (block-scoped locals) — but NOT into nested
      // function-decls (different scope).
      if (n.kind === "function-decl") continue;
      if (n.kind === "logic" && Array.isArray(n.body)) scanStatements(n.body);
      if (n.kind === "match-stmt" && Array.isArray(n.body)) scanStatements(n.body);
      if (n.kind === "match-arm-block" && Array.isArray(n.body)) scanStatements(n.body);
      if (n.kind === "if-stmt") {
        if (Array.isArray(n.consequent)) scanStatements(n.consequent);
        if (Array.isArray(n.alternate)) scanStatements(n.alternate);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray(n.body)) {
        scanStatements(n.body);
      }
      if (n.kind === "try-stmt") {
        if (Array.isArray(n.body)) scanStatements(n.body);
        if (n.catchNode && Array.isArray(n.catchNode.body)) scanStatements(n.catchNode.body);
        if (Array.isArray(n.finallyBody)) scanStatements(n.finallyBody);
      }
    }
  }

  const fnBody = (fnNode as any).body;
  let guard = 0;
  do {
    changed = false;
    scanStatements(fnBody);
  } while (changed && guard++ < 64);

  return empty;
}

/**
 * §59 (ss52) — FILE-WIDE union of every function's non-reactive local map/set/
 * ordered names. Used ONLY by the conservative runtime-CHUNK gates
 * (`fileHasMapUsage` / `fileHasSetAlgebraUsage`): chunk inclusion does not need
 * per-fn precision (over-inclusion costs a few KB; a miss is a runtime crash),
 * so a file-wide union of local names is the right granularity there. NOT used
 * for the per-fn emit-ctx threading (that stays scope-precise via
 * `collectLocalMapSetNames` per function).
 */
export function collectAllLocalMapSetNames(
  fileAST: Record<string, unknown>,
): { map: Set<string>; set: Set<string>; ordered: Set<string> } {
  const map = new Set<string>();
  const set = new Set<string>();
  const ordered = new Set<string>();
  if (!fileAST || typeof fileAST !== "object") return { map, set, ordered };
  const fnReturnKinds = buildFnReturnMapKinds(fileAST);
  const nodes = getNodes(fileAST);

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as any;
      if (n.kind === "function-decl") {
        const r = collectLocalMapSetNames(n, fnReturnKinds);
        for (const x of r.localMapVarNames) map.add(x);
        for (const x of r.localSetVarNames) set.add(x);
        for (const x of r.localOrderedMapVarNames) ordered.add(x);
        if (Array.isArray(n.body)) visit(n.body); // nested function-decls
      }
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "match-stmt" && Array.isArray(n.body)) visit(n.body);
      if (n.kind === "match-arm-block" && Array.isArray(n.body)) visit(n.body);
      if (n.kind === "if-stmt") {
        if (Array.isArray(n.consequent)) visit(n.consequent);
        if (Array.isArray(n.alternate)) visit(n.alternate);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray(n.body)) visit(n.body);
      if (n.kind === "try-stmt") {
        if (Array.isArray(n.body)) visit(n.body);
        if (n.catchNode && Array.isArray(n.catchNode.body)) visit(n.catchNode.body);
        if (Array.isArray(n.finallyBody)) visit(n.finallyBody);
      }
    }
  }
  visit(nodes as unknown[]);
  return { map, set, ordered };
}

/**
 * §6.7.7 / §60.4 — Collect every `<request>` `id` value in the file. A `<#id>`
 * markup ref whose id is in this set is a REQUEST-STATE ref: its `.loading` /
 * `.data` / `.error` / `.stale` live on the `_scrml_deep_reactive`-wrapped
 * `_scrml_request_<id>` object (which IS reactive — §6.7.7), NOT the §36
 * input-state registry (`_scrml_input_state_registry`, which a `<request>` never
 * populates — reading it returns `undefined` and a `.loading` access throws).
 *
 * Codegen has no resolved type at the `<#id>` emit site, so `emit-expr.ts` keys
 * the request-vs-input lowering on this collected name-set exactly as
 * `mapVarNames` keys the map-vs-array branch and `engineVarNames` keys the
 * `.advance` interception. A non-request `<#id>` falls through to the §36 registry
 * lowering (render-once non-reactive by design, §36.6 — left UNCHANGED).
 *
 * `<request>` nodes can be declared at the top level OR nested inside engine
 * state-child bodies (`bodyChildren`), so the walk mirrors the reactive-wiring
 * collector's descent (emit-reactive-wiring.ts `collectAllCells`).
 */
export function collectRequestIds(fileAST: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  if (!fileAST || typeof fileAST !== "object") return ids;
  const nodes = getNodes(fileAST);

  function extractId(node: any): string | null {
    const attrs: any[] = node.attrs ?? node.attributes ?? [];
    for (const a of attrs) {
      if (a?.name !== "id") continue;
      const v = a.value;
      if (v?.kind === "string-literal" && typeof v.value === "string") return v.value;
      if (typeof v === "string") return v;
      if (typeof v?.value === "string") return v.value;
    }
    return null;
  }

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as any;

      if (n.kind === "markup" && n.tag === "request") {
        const id = extractId(n);
        if (id) ids.add(id);
      }

      // Descend the same structures as the reactive-wiring collector so a
      // `<request>` nested in markup children / engine state-child bodies /
      // logic blocks is found.
      if (Array.isArray(n.children)) visit(n.children as unknown[]);
      if (Array.isArray(n.bodyChildren)) visit(n.bodyChildren as unknown[]);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body as unknown[]);
      if (n.kind === "if-stmt") {
        if (Array.isArray(n.consequent)) visit(n.consequent as unknown[]);
        if (Array.isArray(n.alternate)) visit(n.alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (n.kind === "match-stmt" && Array.isArray(n.body)) visit(n.body as unknown[]);
    }
  }

  visit(nodes as unknown[]);
  return ids;
}

/**
 * §6.7.7 — the reactive-assign settle info for each body-form `<request>`.
 * `<request id="R">${ @cell = serverFn(...) }</>` — the "body form" that has NO
 * `url=` and NO `api=` attr (those two drive their own fetch machinery in
 * `emitRequestNode`; the body form's fetch IS the body's server-fn call).
 */
export interface RequestBodyCell {
  /** The `<request id="R">` id — names the hoisted `_scrml_request_<R>` state object. */
  requestId: string;
  /** The `@variable` reads that trigger a re-fetch (explicit `deps=` OR inferred). */
  depsVars: string[];
}

/**
 * §6.7.7 — map each body-form `<request>`'s assigned cell NAME → its settle info.
 *
 * Keyed by the body's assigned cell (`@cell` in `${ @cell = serverFn() }`) so the
 * emit-client auto-await pass — which sees the lowered `_scrml_reactive_set("cell",
 * stub(...))` — can recognize a request-body reactive-assign and wrap it with the
 * full loading/data/error/stale settle machine that mutates `_scrml_request_<R>`.
 *
 * ONLY the body form is collected: a `<request url=>` / `<request api=>` already
 * emits its own settle machine in `emitRequestNode`, and its body (if any) is not
 * a server-fn reactive-assign of this shape.
 */
export function collectRequestBodyCells(
  fileAST: Record<string, unknown>,
): Map<string, RequestBodyCell> {
  const out = new Map<string, RequestBodyCell>();
  if (!fileAST || typeof fileAST !== "object") return out;
  const nodes = getNodes(fileAST);

  function attrValue(node: any, name: string): string | null {
    const attrs: any[] = node.attrs ?? node.attributes ?? [];
    for (const a of attrs) {
      if (a?.name !== name) continue;
      const v = a.value;
      if (v?.kind === "string-literal" && typeof v.value === "string") return v.value;
      if (v?.kind === "variable-ref") return (v.name ?? "").replace(/^@/, "");
      if (typeof v === "string") return v;
      if (typeof v?.value === "string") return v.value;
    }
    return null;
  }

  function hasAttr(node: any, name: string): boolean {
    const attrs: any[] = node.attrs ?? node.attributes ?? [];
    return attrs.some((a) => a?.name === name);
  }

  // Explicit `deps=[@a, @b]` → the @-var names (mirrors emitRequestNode).
  function explicitDeps(node: any): string[] {
    const attrs: any[] = node.attrs ?? node.attributes ?? [];
    const depsAttr = attrs.find((a) => a?.name === "deps");
    if (!depsAttr) return [];
    const v = depsAttr.value;
    const found: string[] = [];
    if (v?.kind === "array" && Array.isArray(v.elements)) {
      for (const el of v.elements) {
        if (el?.kind === "variable-ref") found.push((el.name ?? "").replace(/^@/, ""));
      }
    } else if (typeof v?.value === "string") {
      for (const m of v.value.matchAll(/@([A-Za-z_$][A-Za-z0-9_$]*)/g)) found.push(m[1]);
    }
    return found;
  }

  function visit(nodeList: unknown[]): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as any;

      if (
        n.kind === "markup" && n.tag === "request" &&
        !hasAttr(n, "url") && !hasAttr(n, "api")
      ) {
        const requestId = attrValue(n, "id");
        // The body is a `logic` child whose first `state-decl` is `@cell = expr`.
        let cell: string | null = null;
        let initSrc = "";
        for (const child of (n.children ?? [])) {
          if (child && child.kind === "logic" && Array.isArray(child.body)) {
            for (const stmt of child.body) {
              if (stmt && stmt.kind === "state-decl" && typeof stmt.name === "string") {
                cell = stmt.name;
                initSrc = typeof stmt.init === "string" ? stmt.init : "";
                break;
              }
            }
          }
          if (cell) break;
        }
        if (requestId && cell) {
          // deps=[...] wins; else infer @var reads from the body expr (§6.7.7).
          let depsVars = explicitDeps(n);
          if (depsVars.length === 0 && initSrc) {
            depsVars = [...extractReactiveDeps(initSrc, null)];
          }
          out.set(cell, { requestId, depsVars });
        }
      }

      if (Array.isArray(n.children)) visit(n.children as unknown[]);
      if (Array.isArray(n.bodyChildren)) visit(n.bodyChildren as unknown[]);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body as unknown[]);
      if (n.kind === "if-stmt") {
        if (Array.isArray(n.consequent)) visit(n.consequent as unknown[]);
        if (Array.isArray(n.alternate)) visit(n.alternate as unknown[]);
      }
      if ((n.kind === "for-stmt" || n.kind === "while-stmt") && Array.isArray(n.body)) {
        visit(n.body as unknown[]);
      }
      if (n.kind === "match-stmt" && Array.isArray(n.body)) visit(n.body as unknown[]);
    }
  }

  visit(nodes as unknown[]);
  return out;
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
  // (a2) ss52 — any NON-REACTIVE LOCAL map/set binding (a `let m = [:]`, a
  // `m: [K:V]` / `set[K]` param/decl, a `r = makeMap()` whose fn returns a map).
  // Covers the library-mode / param-only case where a fn does `m.size` on a map
  // PARAM but the file contains NO map literal (so the (b) deep scan misses it).
  {
    const local = collectAllLocalMapSetNames(fileAST);
    if (local.map.size > 0 || local.set.size > 0) return true;
  }
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

/**
 * §59.12 (D4) — Does this file invoke a set-ALGEBRA method (`.union` /
 * `.intersect` / `.difference`) on a known set cell? Drives the `stdlib-data`
 * runtime chunk gate in `emit-client.ts:detectRuntimeChunks`: those three
 * methods DELEGATE to the shipped `scrml:data` value-canonical algebra
 * (`_scrml_stdlib.data.union/intersection/difference`), so the chunk that
 * populates `_scrml_stdlib.data` must ship even though the author never wrote a
 * `scrml:data` import. The other set methods (`.add`/`.has`/`.remove`/`.size`/
 * `.elements`) lower to the `map` chunk's `_scrml_map_*` helpers and need NO
 * data chunk — so this gate is PRECISE (a set that never uses algebra ships no
 * data chunk; minimal-runtime discipline).
 *
 * Detection is shallow-receiver: a `CallExpr` whose callee is a `MemberExpr`
 * with property ∈ {union, intersect, difference} and immediate object a known
 * set — REACTIVE `@<set>` (`<set>` ∈ `setVarNames`) OR a NON-REACTIVE LOCAL
 * `<set>` (`<set>` ∈ `localSetNames`, ss52). A CHAINED algebra call
 * (`@s.union(@t).intersect(…)`) is covered because its FIRST link is on the set.
 */
export function fileHasSetAlgebraUsage(
  fileAST: Record<string, unknown>,
  setVarNames: Set<string>,
  localSetNames?: Set<string> | null,
): boolean {
  if (!fileAST || typeof fileAST !== "object") return false;
  const _localSet = localSetNames ?? new Set<string>();
  if (setVarNames.size === 0 && _localSet.size === 0) return false;
  const ALGEBRA = new Set(["union", "intersect", "difference"]);
  let found = false;
  const seen = new WeakSet<object>();
  function walk(node: unknown): void {
    if (found || !node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Record<string, unknown>;
    if (n.kind === "call") {
      const callee = n.callee as Record<string, unknown> | undefined;
      if (
        callee && callee.kind === "member" &&
        typeof callee.property === "string" && ALGEBRA.has(callee.property) &&
        callee.object && typeof callee.object === "object"
      ) {
        const obj = callee.object as Record<string, unknown>;
        if (obj.kind === "ident" && typeof obj.name === "string") {
          // Reactive `@s` cell OR non-reactive local `s` set.
          if ((obj.name.startsWith("@") && setVarNames.has(obj.name.slice(1))) ||
              (!obj.name.startsWith("@") && _localSet.has(obj.name))) {
            found = true;
            return;
          }
        }
      }
    }
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

/**
 * Does a for-stmt body render markup (i.e. contain a `lift` statement)?
 *
 * This is the RENDER-CONTEXT discriminator for the reactive for-of lowering.
 * Per SPEC §17.4 (Iteration — Tier 0), a `for` loop is a DOM list-render ONLY
 * when its body `lift`s markup: `for (item of items) { lift <li>${item.name}</> }`.
 * A `for` loop WITHOUT `lift` (SPEC §17.4a: "A `for` loop without `lift`…") is a
 * plain loop — it iterates a value / produces a result, it does not render.
 *
 * GitHub #23 (Peter): a plain, non-render function that iterates a reactive cell —
 *   `function unitLabelFor(num) { for (let p of @unitParts) { if (p.unit == num) return p.unit } }`
 * — was mis-lowered to the reactive list-render path (`_scrml_render_list` /
 * `_scrml_reconcile_list` + `document.createElement`/`_scrml_lift`) purely because
 * the iterable held a reactive `@`-ref, with no check that the body is a render
 * context. That emitted DOM code (E-SCOPE-001 / runtime `appendChild` throw) where
 * a plain snapshot loop was intended. The reactive list-render lowering SHALL apply
 * ONLY when this predicate holds; a reactive-iterable for-of whose body does NOT
 * lift markup lowers to a plain `for (const x of <snapshot>) { … }` over the cell's
 * current value (the iterable's `@`-refs still lower to `_scrml_reactive_get(...)`).
 *
 * The walk is recursive: a `lift` nested inside an `if`/`for`/`while`/match-arm
 * body (e.g. `for (x of @xs) { if (x.ok) { lift <li/> } }`) still counts as a
 * render context. Expression-tree fields (`exprNode`, `*Expr`) and `span` are not
 * descended — only statement-body arrays.
 *
 * @param body — the for-stmt body statement array (`node.body`)
 * @returns true if any `lift-expr` node exists anywhere in the body subtree
 */
export function forBodyLiftsMarkup(body: unknown): boolean {
  if (!Array.isArray(body)) return false;
  for (const node of body) {
    if (!node || typeof node !== "object") continue;
    if ((node as { kind?: unknown }).kind === "lift-expr") return true;
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "exprNode" || key.endsWith("Expr")) continue;
      const v = (node as Record<string, unknown>)[key];
      if (Array.isArray(v) && forBodyLiftsMarkup(v)) return true;
    }
  }
  return false;
}
