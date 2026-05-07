/**
 * Symbol Table — Stage 3.06 of the scrml compiler pipeline (SYM).
 *
 * Phase A1b Step B1 — V5-strict symbol-table extension. This module
 * constructs a per-scope state-cell registry over the FileAST produced by
 * TAB and decorated by NR. It is FOUNDATIONAL infrastructure that
 * subsequent A1b steps (B2 onward) build on:
 *
 *   B2 — V5-strict bare-name resolution + E-NAME-COLLIDES-STATE  [LANDED]
 *   B3 — `@name` resolution → record back-pointer on each ExprNode  [LANDED]
 *   B4 — Import binding registration + source-position `pinned` forward-ref
 *        check (E-STATE-PINNED-FORWARD-REF) + best-effort
 *        E-IMPORT-PINNED-INVALID  [LANDED]
 *   B5 — Cell classifier (bindable, markup-typed, derived-with-validators)  [LANDED]
 *   B6 — Render-by-tag E-CELL-NO-RENDER-SPEC + E-CELL-RENDER-SPEC-NOT-BINDABLE
 *   B7 — Derived-cell dep DAG + E-DERIVED-CIRCULAR-DEP
 *   B8 — L21 walker (E-DERIVED-VALUE-MUTATE + E-SYNTHESIZED-WRITE)
 *   B11/B12 — Validity-surface synthesized cells (re-entrancy invariant)
 *
 * Phase A1b Step B2 — V5-strict bare-name resolution. The walker now also
 * visits `let-decl`, `const-decl`, `tilde-decl`, and `lin-decl` nodes (the
 * four local declaration kinds). For each local-decl, looks up the decl's
 * name in the current scope (via `lookupStateCell`'s parent-chain walk). If
 * a registered state-cell record is found at any enclosing scope, fires
 * `E-NAME-COLLIDES-STATE` per SPEC §6.1.3 + §34. Local names cannot shadow
 * registered state-cell names — the V5-strict invariant.
 *
 * Phase A1b Step B5 — Cell classifier. PASS 4 walks every registered
 * `state-decl` (via the per-scope `stateCells` map populated in PASS 1) and
 * stamps a `_cellKind` discriminant + `_isBindable` boolean on the AST decl
 * node. Four kinds:
 *
 *   - `"plain"`        — Shape 1 mutable cell (`<count> = 0`) OR Shape 3
 *                        derived with non-markup RHS (`const <doubled> = @count * 2`).
 *   - `"bindable"`     — Shape 2 with `renderSpec.element.tag` in
 *                        {input, textarea, select} (canonical bindable set,
 *                        per `codegen/emit-html.ts` BIND_DIRECTIVE_TAGS).
 *   - `"markup-typed"` — Shape 3 derived with markup RHS (e.g.,
 *                        `const <badge> = <span>...</span>`) OR a non-bindable
 *                        Shape 2 markup-RHS (defensively classified; A1b/B6
 *                        may later reject as illegal Shape-2).
 *   - `"compound-parent"` — Variant C compound (`<formRes> { <name> = ""; ... }`).
 *                           Children classify recursively as standalone state-decls
 *                           in the compound's sub-scope.
 *
 * Per A1b plan §4.6 line 230, B5 RECORDS classification (annotates AST only);
 * B6 will FIRE `E-CELL-NO-RENDER-SPEC` + `E-CELL-RENDER-SPEC-NOT-BINDABLE`
 * based on the `_cellKind` annotation. B7 will filter to plain/markup-typed
 * + isConst when building the derived-cell dep DAG.
 *
 * Phase A1b Step B3 — `@name` resolution. PASS 3 walks every ExprNode payload
 * on every AST node and, for each `@`-prefixed `IdentExpr`, calls
 * `lookupStateCell(currentScope, name.slice(1))`. The result (a
 * `StateCellRecord` or `null`) is stamped onto the IdentExpr as a
 * non-enumerable `_resolvedStateCell` field. This is the annotated-AST
 * contract that B5+ (cell classifier), B7 (derived-cell dep DAG), B10
 * (validator typer cross-field args), and B22 (`reset(@cell)` keyword)
 * consume to know which cell each `@name` read points to without
 * re-resolving by string lookup. Per A1b plan §4.6 line 228, B3 RECORDS
 * resolution; the resolution-fail catch-all is "existing infra" — B3 stamps
 * `null` on failed lookups (no new error code). Compound nav (`@form.name`)
 * resolves the BASE cell only at B3; deeper path resolution defers to
 * `lookupQualifiedStateCell` consumers when leaf-level resolution is needed.
 *
 * What B1 lands:
 *   - A `Scope` data structure (per-file root, child scopes for function /
 *     engine / component / compound state-decl bodies) with a `stateCells`
 *     `Map<string, StateCellRecord>`.
 *   - A registration walker that visits every `state-decl` node (both
 *     `structuralForm:true` `<x> = init` and `structuralForm:false` legacy
 *     `@x = init`) and registers its name in the containing scope.
 *   - Variant C compound (§6.3) recursive registration: parent name in the
 *     enclosing scope; children registered in the parent's compound sub-scope
 *     under qualified-path keys (e.g., `signup.name`).
 *   - Annotated AST: each `state-decl` gains a `_record: StateCellRecord`
 *     back-pointer; each scope-introducing node gains a `_scope: Scope`
 *     back-pointer; FileAST gains a top-level `_scope: Scope`.
 *   - Public lookup API: `lookupStateCell` (parent-chain walk),
 *     `lookupQualifiedStateCell` (multi-segment paths), `getScopeForNode`
 *     (reverse lookup).
 *
 * What B1 + B2 do NOT do (handled by later B-steps):
 *   - Resolve `@name` reads. B3 walks ExprNode trees and records the
 *     resolution back-pointer.
 *   - Synthesize validity-surface cells (`@compound.isValid` etc.). B11/B12
 *     synthesize and add records to existing scopes via the `_scope`
 *     back-pointer (re-entrancy invariant per BRIEF §6).
 *   - Walk engine state-children or component bodies. Today's AST stores
 *     `engine-decl.rulesRaw: string` and `component-def.raw: string` (no
 *     walkable children), so engine + component scope construction defers
 *     to B14+/B17+. The `ScopeKind` enum reserves `"engine"` and
 *     `"component"` for those steps; B1's walker fills `"file"`,
 *     `"function"`, and `"compound"` only.
 *
 * Performance budget: <= 5 ms per file (single AST traversal + Map inserts).
 */

import type {
  ASTNode,
  FileAST,
  ReactiveDeclNode,
  FunctionDeclNode,
  LetDeclNode,
  ConstDeclNode,
  TildeDeclNode,
  LinDeclNode,
  Span,
  IdentExpr,
  ImportDeclNode,
  ImportSpecifier,
} from "./types/ast.ts";
import { forEachIdentInExprNode } from "./expression-parser.ts";
import {
  ARRAY_MUTATING_METHODS,
  isDerivedMutatingAssignOp,
} from "./derived-mutation-ops.ts";

// ---------------------------------------------------------------------------
// B4 — Import binding registry
// ---------------------------------------------------------------------------
//
// Per A1b Step B4, every import specifier that lands in the file's lexical
// scope is registered into the file scope's `importBindings` map. The record
// captures the local binding name, the originally-imported name, the source
// module, the `pinned` flag, and a back-pointer to the ImportDeclNode (for
// span access during the source-position forward-ref check).
//
// Why on `Scope`, not on a separate structure: imports are scope-introducing
// just like state-decls. A future B-step that supports per-function or
// per-component import scoping rides on the same registry shape.

/**
 * A single import-binding entry. Created at registration in SYM PASS-1.
 */
export interface ImportBindingRecord {
  /** Local binding name in the importing file's scope. */
  localName: string;
  /** Original name as exported by the source module (pre-alias). */
  exportedName: string;
  /** Resolved source module path (verbatim from `ImportDeclNode.source`).
   *  May be a relative path (e.g., `"./engines.scrml"`) or a stdlib alias
   *  (e.g., `"scrml:auth"`). Same string the rest of the pipeline carries. */
  sourcePath: string;
  /** True iff the `pinned` bareword modifier was present on this specifier. */
  pinned: boolean;
  /** Back-pointer to the ImportDeclNode for span access. The decl's
   *  `span.start` is the source-position used for forward-ref checks. */
  declNode: ImportDeclNode;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The kind of scope a `Scope` represents.
 *
 * - `"file"` — file-level (per-FileAST) root scope.
 * - `"function"` — body of a `function-decl` node.
 * - `"engine"` — body of an engine declaration. RESERVED for B14+ (today's
 *   AST stores engine bodies as raw text under `engine-decl.rulesRaw`; the
 *   walker does not construct engine scopes yet).
 * - `"component"` — body of a `component-def` node. RESERVED for B17+
 *   (today's AST stores component bodies as raw text under `component-def.raw`).
 * - `"compound"` — body of a Variant C compound state-decl
 *   (`state-decl.children`).
 */
export type ScopeKind = "file" | "function" | "engine" | "component" | "compound";

/**
 * Phase A1b Step B5 — cell-kind discriminant set on each `state-decl` AST node
 * via the non-enumerable `_cellKind` property. Read via `getCellKind`.
 *
 * - `"plain"`           — Shape 1 mutable cell or Shape 3 non-markup derived.
 * - `"bindable"`        — Shape 2 with bindable HTML root (input/textarea/select).
 * - `"markup-typed"`    — Shape 3 markup-RHS derived (display markup), or a
 *                         Shape-2-shaped decl whose render-spec is NOT one of
 *                         the canonical bindable tags.
 * - `"compound-parent"` — Variant C compound parent (has `children[]`).
 */
export type CellKind = "plain" | "bindable" | "markup-typed" | "compound-parent";

/**
 * A single state-cell symbol-table entry. Created at registration; mutated
 * by no later B-step (records are append-only). Cross-references the AST
 * decl node (`declNode`) and its containing scope (`scope`).
 */
export interface StateCellRecord {
  /** Bare cell name (no `@` prefix). For compound children, the LEAF name
   *  (e.g., `"name"` for `signup.name`); use `qualifiedPath` for the full
   *  dotted path. */
  name: string;
  /** Fully-qualified dotted path, scope-relative.  For top-level cells,
   *  equals `name`. For compound children, parent path + `.` + leaf
   *  (e.g., `"signup.name"`, `"outer.inner.leaf"`). */
  qualifiedPath: string;
  /** Back-pointer to the AST decl node. Pre-existing AST shape from TAB. */
  declNode: ReactiveDeclNode;
  /** Back-pointer to the scope this record was registered into. */
  scope: Scope;
  /** True iff the decl used the structural `<x> = init` form (V5-strict
   *  canonical). False iff the legacy `@x = init` form (still legal but
   *  emits no W-DEPRECATED at this phase). Mirrors
   *  `ReactiveDeclNode.structuralForm`. */
  structuralForm: boolean;
  /** RHS-shape discriminant per AST-CONTRACTS-AND-DECOMPOSITION §1.1.
   *  Mirrors `ReactiveDeclNode.shape`. */
  shape: "plain" | "decl-with-spec" | "derived" | undefined;
  /** True iff `const <x> = expr` derived form. Mirrors
   *  `ReactiveDeclNode.isConst`. */
  isConst: boolean;
  /** True iff `pinned` bareword modifier present on the decl. Mirrors
   *  `ReactiveDeclNode.pinned`. Used by B4 for forward-ref legality
   *  (E-STATE-PINNED-FORWARD-REF). */
  isPinned: boolean;
  /** True iff this record is a compound parent (Variant C, has non-empty
   *  `children`). The parent record is registered in the enclosing scope;
   *  child records are registered in the parent's compound sub-scope. */
  isCompoundParent: boolean;
  /** True iff this record is a compound child (registered inside a
   *  `kind:"compound"` scope). The leaf name lives at `name`; the full
   *  dotted path lives at `qualifiedPath`. */
  isCompoundChild: boolean;
  /** True iff `validators[]` is non-empty on the decl node. Used by B5
   *  cell classifier and B11/B12 validity-surface synthesis. Cheap boolean
   *  shorthand; consumers needing the array walk `declNode.validators`. */
  hasValidators: boolean;
  /** True iff `defaultExpr` is non-null on the decl node. Used by B22 for
   *  `reset(@cell)` target validation. */
  hasDefaultExpr: boolean;
  /** True iff `typeAnnotation` is set on the decl node. Used by B20 for
   *  bare-variant inference (M9, §14.10). */
  hasTypeAnnotation: boolean;
}

/**
 * A single lexical scope. Forms a tree via `parent` back-pointers.
 *
 * Scopes are constructed top-down by the SYM walker:
 *   1. File-level root scope (kind `"file"`, parent `null`, qualifiedPath `""`).
 *   2. Function-body scope (kind `"function"`, parent = enclosing scope).
 *   3. Compound-decl sub-scope (kind `"compound"`, parent = enclosing scope,
 *      qualifiedPath = parent's path + parent name + `"."`).
 *   4. Engine / component sub-scopes RESERVED for B14+/B17+.
 *
 * Re-entrancy invariant (per BRIEF §6): scopes are NOT frozen after
 * construction. B11/B12 will add validity-surface synthesized records to
 * existing scopes; the symbol-table API supports `stateCells.set()` calls
 * post-B1.
 */
export interface Scope {
  /** Discriminant — see `ScopeKind`. */
  kind: ScopeKind;
  /** Parent scope, or `null` for the file-level root. */
  parent: Scope | null;
  /** Per-scope state-cell registry. Key is the scope-LOCAL name (the
   *  `StateCellRecord.name` value). For compound sub-scopes, this is the
   *  child's leaf name; the qualified path is recoverable via the
   *  `record.qualifiedPath` field. */
  stateCells: Map<string, StateCellRecord>;
  /** B4 — per-scope import-binding registry. Key is the LOCAL binding name
   *  in the importing scope. Populated only on file-level scopes today
   *  (imports hoist to file scope per existing AST shape — `FileAST.imports`).
   *  Reserved as a `Scope`-level field so a future per-function or
   *  per-component import surface rides the same shape without a schema
   *  change. Empty `Map` on non-file scopes. */
  importBindings: Map<string, ImportBindingRecord>;
  /** Path prefix used to compute child `qualifiedPath` values. For the
   *  file root, `""`. For a function scope, the enclosing scope's prefix
   *  (functions don't extend the dotted path). For a compound scope, the
   *  parent record's `qualifiedPath` followed by `.` (e.g., `"signup."`). */
  qualifiedPath: string;
}

/**
 * Per-file SYM result. Mirrors `NRResult`'s shape (filePath + diagnostic
 * count + summary stats). B1 emitted NO diagnostics, but B2 populates
 * `errors[]` with `E-NAME-COLLIDES-STATE` whenever a local declaration
 * (let/const/tilde/lin) shadows a registered state-cell name.
 */
export interface SYMResult {
  filePath: string;
  /** Errors and warnings emitted by SYM. Empty at B1; B2+ populates. */
  errors: SYMDiagnostic[];
  /** The file-level root scope. Cross-referenced from `FileAST._scope`. */
  fileScope: Scope;
  /** Summary stats (debugging aid). */
  stats: SYMStats;
}

export interface SYMDiagnostic {
  code: string;
  message: string;
  span: Span;
  severity: "error" | "warning";
}

export interface SYMStats {
  /** Total number of state-cell records registered (top-level + nested). */
  totalRecords: number;
  /** Number of compound parent records. */
  compoundParents: number;
  /** Number of compound child records. */
  compoundChildren: number;
  /** Number of scopes constructed (file + function + compound at B1). */
  totalScopes: number;
  /** B4 — number of import-binding records registered at file scope. */
  totalImportBindings: number;
}

export interface SYMInput {
  filePath: string;
  ast: FileAST;
  /**
   * B4 — optional MOD exportRegistry (the `moduleResult.exportRegistry` map
   * of `Map<sourcePath, Map<exportName, {kind, category, isComponent}>>`).
   * When provided, SYM emits `E-IMPORT-PINNED-INVALID` for `pinned` imports
   * of definitively-not-cell-not-engine kinds (function/fn/type/channel).
   * When absent, the check is skipped — back-compat for pre-MOD callers
   * (test harnesses, self-host shim) which only rely on registration +
   * forward-ref check.
   *
   * **Best-effort scope (Option A, S66 dispatch):** const/let imports are
   * ACCEPTED without firing because they may be engine-shaped (Form 1
   * `export <engine var=appPhase>` desugars to `export const appPhase`
   * which is indistinguishable today). B14 (cross-file engine binding,
   * M18) lands engine-aware export-registry annotation; until then, the
   * check trades false negatives for zero false positives. See in-code
   * comment near the const/let accept-branch.
   */
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>>;
}

// ---------------------------------------------------------------------------
// Internal: AST node decoration shape
// ---------------------------------------------------------------------------
//
// SYM mutates the AST in place by adding two annotation fields:
//
//   - `state-decl._record: StateCellRecord`
//     Back-pointer attached to each `state-decl` node after registration.
//     Consumers (B2-B22) recover the record without re-walking the tree.
//
//   - `<scope-introducing-node>._scope: Scope`
//     Attached to each scope-creating AST node (currently `function-decl`
//     and compound `state-decl`). FileAST also gains `_scope: Scope`
//     (the file-level root).
//
// These fields are typed loosely as `any` at the site of mutation (matching
// existing convention in NR's walker — see `name-resolver.ts:305-378` where
// `anyN.resolvedKind = ...`). Reverse lookup via `getScopeForNode` reads
// the field with a typed cast.

interface ScopeAnnotated {
  _scope?: Scope;
}

interface RecordAnnotated {
  _record?: StateCellRecord;
}

/**
 * B3 annotation shape — back-pointer stamped on every `@`-prefixed IdentExpr.
 *
 * Value:
 *   - `StateCellRecord` if the bare name (with `@` stripped) resolves to a
 *     registered cell anywhere on the parent-chain.
 *   - `null` if no such cell exists. Stamping `null` (rather than leaving
 *     the field absent) makes the annotation contract explicit:
 *     "B3 ran on this node; no resolution was found." Distinguishes a
 *     resolved-to-null from an un-walked node (which has no field at all).
 */
interface ResolvedAtNameAnnotated {
  _resolvedStateCell?: StateCellRecord | null;
}

/**
 * B5 annotation shape — back-pointers stamped on every `state-decl` AST node.
 *
 * - `_cellKind`: discriminant per `CellKind` doc.
 * - `_isBindable`: convenience accessor (`_cellKind === "bindable"`); used by
 *   B6's render-by-tag check at `<varname/>` use-sites without a re-switch.
 *
 * Both fields are non-enumerable (Object.defineProperty), mirroring B1's
 * `_record` and B3's `_resolvedStateCell` cycle-safety convention. Generic
 * structural walkers (BP/CG/codegen) skip them.
 */
interface CellKindAnnotated {
  _cellKind?: CellKind;
  _isBindable?: boolean;
}

// ---------------------------------------------------------------------------
// Scope construction primitives
// ---------------------------------------------------------------------------

function createScope(
  kind: ScopeKind,
  parent: Scope | null,
  qualifiedPath: string,
): Scope {
  return {
    kind,
    parent,
    stateCells: new Map(),
    importBindings: new Map(),
    qualifiedPath,
  };
}

function createRecord(
  declNode: ReactiveDeclNode,
  scope: Scope,
  qualifiedPath: string,
  isCompoundChild: boolean,
): StateCellRecord {
  const isCompoundParent = Array.isArray(declNode.children);
  const validators = (declNode as any).validators;
  return {
    name: declNode.name,
    qualifiedPath,
    declNode,
    scope,
    structuralForm: declNode.structuralForm === true,
    shape: declNode.shape,
    isConst: declNode.isConst === true,
    isPinned: declNode.pinned === true,
    isCompoundParent,
    isCompoundChild,
    hasValidators: Array.isArray(validators) && validators.length > 0,
    hasDefaultExpr: declNode.defaultExpr != null,
    hasTypeAnnotation: typeof declNode.typeAnnotation === "string"
      && declNode.typeAnnotation.length > 0,
  };
}

/**
 * Register a single `state-decl` into the given scope. Compound parents
 * (Variant C) recursively register their children in a sub-scope.
 *
 * Returns the created record (the parent record for compound parents).
 */
function registerStateDecl(
  declNode: ReactiveDeclNode,
  parentScope: Scope,
  stats: SYMStats,
  visited: WeakSet<object>,
): StateCellRecord {
  const isCompoundChild = parentScope.kind === "compound";
  const qualifiedPath = parentScope.qualifiedPath + declNode.name;

  const record = createRecord(declNode, parentScope, qualifiedPath, isCompoundChild);
  parentScope.stateCells.set(declNode.name, record);
  // Non-enumerable so generic structural AST walkers (BP/CG/codegen) don't
  // descend through `_record → record.scope → scope.stateCells → record`
  // cycle. Recovered via `getScopeForNode` or direct property access.
  Object.defineProperty(declNode, "_record", {
    value: record,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  stats.totalRecords++;
  if (record.isCompoundParent) stats.compoundParents++;
  if (isCompoundChild) stats.compoundChildren++;

  // Variant C compound: recurse into children in a fresh compound sub-scope.
  if (record.isCompoundParent && Array.isArray(declNode.children)) {
    const compoundScope = createScope(
      "compound",
      parentScope,
      qualifiedPath + ".",
    );
    Object.defineProperty(declNode, "_scope", {
      value: compoundScope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    stats.totalScopes++;

    for (const child of declNode.children) {
      if (child && child.kind === "state-decl" && !visited.has(child)) {
        visited.add(child);
        registerStateDecl(child, compoundScope, stats, visited);
      }
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// B4 — Import-binding registration (PASS 1 sub-step)
// ---------------------------------------------------------------------------
//
// Imports are hoisted onto `FileAST.imports[]` by TAB. Walking that array
// (rather than re-discovering imports inside the AST tree) is the canonical
// path. Default imports (`import X from '...'`) bind a single LOCAL name
// equal to `imp.names[0]` with `pinned:false`; named imports populate
// `imp.specifiers[]` with full `{imported, local, pinned}` data.
//
// Collision policy: if the local name is ALREADY registered in the file
// scope's importBindings (duplicate-import-of-same-local-name), the second
// registration wins last-write. This mirrors how `Map.set` behaves and is
// consistent with the existing E-IMPORT-001/003/004 surface; no new
// diagnostic is fired here at B4.

function registerImportBindings(
  imports: ImportDeclNode[] | undefined,
  fileScope: Scope,
): void {
  if (!Array.isArray(imports)) return;
  for (const imp of imports) {
    if (!imp || imp.kind !== "import-decl") continue;
    if (imp.source == null) continue; // parse-failed import; skip silently.
    const sourcePath = imp.source;

    if (imp.isDefault) {
      // Default imports: single binding, no specifier shape, no pinned modifier.
      const localName = imp.names && imp.names.length > 0 ? imp.names[0] : null;
      if (!localName) continue;
      fileScope.importBindings.set(localName, {
        localName,
        exportedName: localName, // default exports have no separate exported name
        sourcePath,
        pinned: false,
        declNode: imp,
      });
      continue;
    }

    // Named imports: walk specifiers[]. The parser populates specifiers for
    // the braced form (`import { a, b as c pinned } from '...'`); the
    // bare names array is the parallel imported-name list.
    const specs: ImportSpecifier[] = Array.isArray(imp.specifiers) ? imp.specifiers : [];
    for (const spec of specs) {
      if (!spec || typeof spec.local !== "string") continue;
      fileScope.importBindings.set(spec.local, {
        localName: spec.local,
        exportedName: typeof spec.imported === "string" ? spec.imported : spec.local,
        sourcePath,
        pinned: spec.pinned === true,
        declNode: imp,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// B4 — E-IMPORT-PINNED-INVALID best-effort fire (Option A)
// ---------------------------------------------------------------------------
//
// SPEC §21.8.1: "`pinned` on a non-engine non-state-cell import (e.g.,
// `pinned` on a regular function) is E-IMPORT-PINNED-INVALID — `pinned` is
// only meaningful for cell-typed and engine-typed names."
//
// The MOD exportRegistry's per-name shape is `{kind, category, isComponent}`.
// `kind` is the canonical export kind: one of
// `{type, function, fn, const, let, channel, rename, local, re-export,
// re-export-all, unknown}`. There is NO `"engine"` kind today (engine
// exports desugar to `const`); there is no `"state-cell"` kind.
//
// Best-effort scope (Option A, S66 dispatch):
//
// | Source export kind     | pinned import → action            |
// | ---------------------- | --------------------------------- |
// | function, fn           | FIRE E-IMPORT-PINNED-INVALID      |
// | type                   | FIRE                              |
// | channel                | FIRE (channels aren't cells)      |
// | const, let             | ACCEPT (defer to B14)             |
// | re-export(-all),       | ACCEPT if not chasable            |
// |   rename, local,       |                                   |
// |   unknown              |                                   |
//
// Why fire on channel: channels are file-level synchronization primitives,
// not cells. A `pinned` import of a channel name is meaningless (the channel
// IS the binding; "identity-stability" doesn't apply). The spec's definition
// of "cell-typed and engine-typed" excludes channels by enumeration.
//
// Why ACCEPT const/let: Form 1 `export <engine var=appPhase>` desugars to
// `export const appPhase = ...` — an engine binding is a `const` export.
// Until B14 / M18 cross-file engine import lands and the registry
// distinguishes engine-shape const exports from arbitrary const exports,
// firing on `pinned` const imports would false-positive on legitimate
// engine pinning. Trade: false negatives (some `pinned` const-imports of
// non-engines slip through at B4 — the gap closes in B14).

const B4_IMPORT_PINNED_FIRE_KINDS: ReadonlySet<string> = new Set([
  "function",
  "fn",
  "type",
  "channel",
]);

function fireImportPinnedInvalid(
  fileScope: Scope,
  exportRegistry: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | undefined,
  errors: SYMDiagnostic[],
): void {
  if (!exportRegistry) return;
  for (const rec of fileScope.importBindings.values()) {
    if (!rec.pinned) continue;
    const sourceMap = exportRegistry.get(rec.sourcePath);
    if (!sourceMap) continue; // unknown source (resolveModulePath mismatch); skip.
    const exportInfo = sourceMap.get(rec.exportedName);
    if (!exportInfo) continue; // E-IMPORT-004 (unknown name) handled by MOD.
    const exportKind = exportInfo.kind;
    if (!B4_IMPORT_PINNED_FIRE_KINDS.has(exportKind)) {
      // ACCEPT branch — const/let/re-export/rename/local/unknown.
      //
      // B14 follow-up: const/let exports include both engine-shaped (Form 1
      // `export <engine var=appPhase>` desugars to `export const appPhase = ...`)
      // and arbitrary-value exports. B4 cannot distinguish today; B14 lands
      // engine-aware export-registry annotation. Until then, pinned on
      // const/let imports is accepted (false negatives possible).
      continue;
    }
    const declSpan = rec.declNode.span;
    errors.push({
      code: "E-IMPORT-PINNED-INVALID",
      message:
        `E-IMPORT-PINNED-INVALID: \`pinned\` modifier on imported \`${rec.localName}\``
        + (rec.localName !== rec.exportedName ? ` (originally \`${rec.exportedName}\`)` : "")
        + ` from \`${rec.sourcePath}\`. The exported name is a \`${exportKind}\`; `
        + `\`pinned\` is meaningful only for cell-typed and engine-typed names. `
        + `Remove the \`pinned\` modifier (SPEC §21.8.1 + §34).`,
      span: declSpan ?? { file: "", start: 0, end: 0, line: 1, col: 1 },
      severity: "error",
    });
  }
}

// ---------------------------------------------------------------------------
// AST walker — discovers state-decls and scope-introducing nodes
// ---------------------------------------------------------------------------
//
// Walks an arbitrary list of AST nodes within the given scope. State-decls
// register into `currentScope`. Function-decls open a child scope before
// recursing into the body. Compound state-decls handle their own sub-scope
// (in `registerStateDecl`).
//
// B2 extension: visits the four local-decl kinds (`let-decl`, `const-decl`,
// `tilde-decl`, `lin-decl`); for each, looks up its name in the current
// scope's parent chain and fires E-NAME-COLLIDES-STATE if a registered
// state-cell shadows it. The B2 check is a localized extension, not a new
// pass — the SYM walker already passes through let/const/tilde/lin nodes
// when descending function-body / logic-block containers; B1 ignored them,
// B2 consults the table.
//
// Mirrors NR's walker recursion (name-resolver.ts:301-378): visits
// `children`, `body`, `consequent`, `alternate`, `arms[].body`,
// `lift-expr.expr.node`. Engine + component bodies are NOT walked here —
// today's AST stores them as strings (see ScopeKind doc).

/**
 * B2: emit `E-NAME-COLLIDES-STATE` if `decl.name` is registered as a state
 * cell at any enclosing scope (parent-chain walk). Diagnostic carries the
 * decl's span and the name of the collided cell + its qualified path.
 */
function checkLocalDeclCollidesState(
  decl: LetDeclNode | ConstDeclNode | TildeDeclNode | LinDeclNode,
  currentScope: Scope,
  errors: SYMDiagnostic[],
): void {
  if (!decl.name) return;
  const collided = lookupStateCell(currentScope, decl.name);
  if (!collided) return;
  // Render the local-decl keyword display: `let x`, `const x`, `lin x`, or
  // bare `x` (for tilde-decl which has no leading keyword).
  let declDisplay: string;
  switch (decl.kind) {
    case "let-decl":   declDisplay = `let ${decl.name}`;   break;
    case "const-decl": declDisplay = `const ${decl.name}`; break;
    case "lin-decl":   declDisplay = `lin ${decl.name}`;   break;
    case "tilde-decl": declDisplay = `${decl.name}`;       break;
    default:           declDisplay = decl.name;
  }
  // The collision is detected by parent-chain walk; the registered record's
  // qualifiedPath disambiguates which cell is being shadowed (relevant for
  // compound-child collisions where the user's `let` sits in an outer
  // function but the state cell lives at a nested compound qualifiedPath).
  errors.push({
    code: "E-NAME-COLLIDES-STATE",
    message:
      `E-NAME-COLLIDES-STATE: local \`${declDisplay}\` shadows registered state cell \`<${collided.qualifiedPath}>\`. `
      + `Local names cannot shadow registered state-cell names (V5-strict, SPEC §6.1.3). `
      + `Rename the local, or use \`@${collided.qualifiedPath}\` to read the cell directly.`,
    span: decl.span,
    severity: "error",
  });
}

function walk(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  stats: SYMStats,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "state-decl") {
      // The state-decl itself registers + (if compound) opens a sub-scope.
      registerStateDecl(n as ReactiveDeclNode, currentScope, stats, visited);
      // No further recursion: children are handled by registerStateDecl;
      // initExpr / renderSpec are EXPRESSION trees walked by B3 (not B1).
      continue;
    }

    if (kind === "function-decl") {
      // Function body opens a new function-scoped child scope.
      // qualifiedPath unchanged: functions don't introduce a dotted prefix.
      const fnScope = createScope("function", currentScope, currentScope.qualifiedPath);
      Object.defineProperty(anyN, "_scope", {
        value: fnScope,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      stats.totalScopes++;
      walk(anyN.body, fnScope, stats, visited);
      continue;
    }

    // Recurse into common AST containers. Mirrors NR's recursion shape.
    // The `visited` WeakSet guards against `block`/`parent` back-refs that
    // some BS-derived nodes carry (mirroring the test helper's findKind walk).
    if (Array.isArray(anyN.children)) walk(anyN.children, currentScope, stats, visited);
    if (Array.isArray(anyN.body)) walk(anyN.body, currentScope, stats, visited);
    if (Array.isArray(anyN.consequent)) walk(anyN.consequent, currentScope, stats, visited);
    if (Array.isArray(anyN.alternate)) walk(anyN.alternate, currentScope, stats, visited);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walk(arm.body, currentScope, stats, visited);
      }
    }
    // P3-FOLLOW alignment: lift-expr carries a markup tree under expr.node.
    // B1 doesn't have state-cell concerns inside lift-exprs (markup is the
    // value, not a decl-site), but mirroring NR's recursion shape avoids
    // surprises if a downstream B-step extends the walker.
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walk([anyN.expr.node], currentScope, stats, visited);
    }
  }
}

// ---------------------------------------------------------------------------
// B2: Local-decl collision walker (separate from PASS 1)
// ---------------------------------------------------------------------------
//
// Walks the same AST tree as `walk`, but ONLY fires E-NAME-COLLIDES-STATE
// diagnostics on local-decl nodes. Re-uses the `_scope` annotations PASS 1
// attached to scope-introducing nodes (function-decls, compound state-decls,
// FileAST). State-decl registration is NOT performed here — by the time
// PASS 2 runs, the symbol table is fully populated, so `lookupStateCell`
// sees every cell regardless of source-order forward refs.

function walkLocalDeclsForCollisions(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    // B2 — V5-strict local-decl shadow check. The four local declaration
    // kinds (let / const / tilde / lin) cannot use a name registered as a
    // state cell at any enclosing scope. SPEC §6.1.3 + §34
    // E-NAME-COLLIDES-STATE.
    if (
      kind === "let-decl"
      || kind === "const-decl"
      || kind === "tilde-decl"
      || kind === "lin-decl"
    ) {
      checkLocalDeclCollidesState(
        n as LetDeclNode | ConstDeclNode | TildeDeclNode | LinDeclNode,
        currentScope,
        errors,
      );
      // No early-continue: a local-decl may carry an if-/for-/match-as-
      // expression body that contains nested decls. Generic-recursion
      // fallthrough handles its child arrays.
    }

    if (kind === "state-decl") {
      // PASS 2 does not register; descend only into the compound sub-scope
      // (if any) so nested local-decls inside compound bodies are checked.
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkLocalDeclsForCollisions(anyN.children, stateScope, visited, errors);
      }
      continue;
    }

    if (kind === "function-decl") {
      // Use the function scope PASS 1 already created.
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkLocalDeclsForCollisions(anyN.body, fnScope, visited, errors);
      continue;
    }

    // Generic recursion. Same shape as PASS 1.
    if (Array.isArray(anyN.children)) walkLocalDeclsForCollisions(anyN.children, currentScope, visited, errors);
    if (Array.isArray(anyN.body)) walkLocalDeclsForCollisions(anyN.body, currentScope, visited, errors);
    if (Array.isArray(anyN.consequent)) walkLocalDeclsForCollisions(anyN.consequent, currentScope, visited, errors);
    if (Array.isArray(anyN.alternate)) walkLocalDeclsForCollisions(anyN.alternate, currentScope, visited, errors);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkLocalDeclsForCollisions(arm.body, currentScope, visited, errors);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkLocalDeclsForCollisions([anyN.expr.node], currentScope, visited, errors);
    }
  }
}

// ---------------------------------------------------------------------------
// B3: `@name` resolution walker (PASS 3)
// ---------------------------------------------------------------------------
//
// Walks every ExprNode payload on every AST node. For each `@`-prefixed
// IdentExpr encountered, calls `lookupStateCell(currentScope, name.slice(1))`
// and stamps the result onto the IdentExpr as a non-enumerable
// `_resolvedStateCell` field. The stamped value is either a StateCellRecord
// (resolved) or null (resolution failed — no error fired at B3 per A1b plan
// §4.6 line 228; the resolution-fail catch-all is "existing infra").
//
// Why non-enumerable: the resolved record back-points to its scope which
// owns a Map<string, StateCellRecord> — the same cycle pattern that motivated
// B1's `_record` non-enumerable choice. Generic structural walkers (BP/CG)
// must skip the field.
//
// Compound nav (`@form.name.toUpperCase()`): the BASE IdentExpr (`@form`)
// resolves to the compound-parent record. The MemberExpr's `.name` /
// `.toUpperCase()` segments are NOT IdentExprs (they are static property
// names) — `forEachIdentInExprNode` correctly walks `member.object` only.
// Consumers needing the leaf record (B22 `reset(@form.name)`) re-resolve
// via `lookupQualifiedStateCell` using the parsed path.
//
// EXPR_FIELDS: the canonical list of AST-node fields that may carry an
// ExprNode. Mirrors `dependency-graph.ts:227-240` and
// `type-system.ts:7732-7735` (parseVariant Phase 2 walker).

const B3_EXPR_FIELDS: readonly string[] = [
  "exprNode",
  "initExpr",
  "argsExpr",
  "condExpr",
  "headerExpr",
  "iterExpr",
  "conditionExpr",
  "guardExpr",
  "valueExpr",
  "rhsExpr",
  "defaultExpr",
];

/**
 * Resolve every `@name` IdentExpr in an ExprNode subtree, stamp
 * `_resolvedStateCell`, and fire E-STATE-PINNED-FORWARD-REF when the read
 * source-position precedes the pinned cell's (or pinned import's) decl-span
 * end.
 *
 * **Read-position note (load-bearing).** IdentExpr `span` values are produced
 * by `expression-parser.ts → spanFromEstree(node, file, baseOffset)`. When an
 * ExprNode is parsed via `safeParseExprToNode` from inside an isolated
 * substring (function bodies / interpolation segments), `baseOffset` is 0 —
 * so the IdentExpr's `span.start` is the offset WITHIN the substring, not
 * within the whole source file. That makes IdentExpr spans unsuitable as
 * absolute read-positions for the source-position forward-ref check.
 *
 * The fallback is the **enclosing AST node's `span.start`** — passed in via
 * the walker as `readPos`. Every container that B3 traverses
 * (`function-decl`, `state-decl`, statement nodes, etc.) has an absolute
 * span set by ast-builder. That position is the lower bound of the read's
 * source-position; using it is conservative-correct:
 *
 *   - `function f() { return @x } ; <x pinned> = 0` — function.span.start
 *     (~14) < x.span.end (~66) → fires (correct).
 *   - `<x pinned> = 0 ; function f() { return @x }` — function.span.start
 *     (>x.span.end) → no fire (correct).
 *   - `<x pinned> = @x + 1` — state-decl.span.start (=decl.span.start)
 *     < decl.span.end → fires (self-init; correct per spec).
 *
 * The conservative aspect: a read at `function.start + 50` syntactically
 * AFTER a pinned decl that sits at `function.start + 100` would still see
 * the read-position as `function.start`. But that scenario can't occur:
 * pinned decls live at file/program scope and at compound scope, never
 * inside function bodies — function bodies don't open a state-cell decl
 * surface. So the read-position approximation is exact for the cases the
 * spec normatively addresses.
 */
function resolveAtNameOnExprNode(
  exprNode: unknown,
  currentScope: Scope,
  errors: SYMDiagnostic[],
  readPos: number,
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  forEachIdentInExprNode(exprNode as any, (ident: IdentExpr) => {
    if (typeof ident.name !== "string") return;
    if (!ident.name.startsWith("@")) return;
    // Strip the `@` prefix to get the bare cell name. The compound-nav case
    // (e.g., `@form.name`) is handled by MemberExpr → `forEachIdentInExprNode`
    // walks `member.object` and produces the BASE `@form` IdentExpr; the leaf
    // `.name` is a static property string, not an ident. So the `bareName`
    // here is always the cell-name root.
    const bareName = ident.name.slice(1);
    if (!bareName) return; // `@` alone — defensive; tokenizer wouldn't produce this here.
    const resolved = lookupStateCell(currentScope, bareName);
    Object.defineProperty(ident, "_resolvedStateCell", {
      value: resolved,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    // B4 — E-STATE-PINNED-FORWARD-REF source-position check.
    //
    // A read of a `pinned` cell is a forward-reference (per SPEC §6.9.3 /
    // §6.10.2 / §6.10.5 / §7.6.1) when the enclosing-container source-position
    // (`readPos`) precedes the cell's declaration-span end. `decl.span.end`
    // (not `start`) catches both:
    //   - Reads in code before the pinned decl (readPos < decl.start ≤ decl.end).
    //   - Self-init reads inside the cell's own initialiser (the state-decl IS
    //     the enclosing container, so readPos === decl.span.start, which is
    //     < decl.span.end).
    if (resolved && resolved.isPinned) {
      const declSpan = resolved.declNode.span;
      if (
        declSpan
        && typeof declSpan.end === "number"
        && readPos < declSpan.end
      ) {
        const identSpan = makeReportSpan(ident, declSpan.file);
        errors.push({
          code: "E-STATE-PINNED-FORWARD-REF",
          message:
            `E-STATE-PINNED-FORWARD-REF: forward reference to \`pinned\` state cell `
            + `\`<${resolved.qualifiedPath}>\`. The \`pinned\` modifier opts the cell `
            + `out of hoisting; reads before its declaration site (or inside its own `
            + `initialiser) are unsafe (SPEC §6.10 + §34).`,
          span: identSpan,
          severity: "error",
        });
      }
      return; // resolved as state-cell; importBinding fallback irrelevant.
    }

    // B4 — pinned-import forward-ref. When the @-name does NOT resolve to a
    // registered same-file state cell, fall back to importBindings. A pinned
    // import behaves as a same-file pinned cell at file scope (SPEC §21.8.1):
    // reads BEFORE the import-decl's span end fire E-STATE-PINNED-FORWARD-REF.
    if (!resolved) {
      const imp = lookupImportBinding(currentScope, bareName);
      if (imp && imp.pinned) {
        const impSpan = imp.declNode.span;
        if (
          impSpan
          && typeof impSpan.end === "number"
          && readPos < impSpan.end
        ) {
          const identSpan = makeReportSpan(ident, impSpan.file);
          errors.push({
            code: "E-STATE-PINNED-FORWARD-REF",
            message:
              `E-STATE-PINNED-FORWARD-REF: forward reference to \`pinned\` imported `
              + `binding \`${imp.localName}\` (from \`${imp.sourcePath}\`). A pinned `
              + `import behaves as a same-file pinned declaration at file scope; `
              + `reads before the import statement are unsafe (SPEC §21.8.1 + §34).`,
            span: identSpan,
            severity: "error",
          });
        }
      }
    }
  });
}

/**
 * Build the diagnostic-reporting span for an `@name` read. IdentExpr spans
 * are NOT reliable absolute offsets (see `resolveAtNameOnExprNode` doc), so
 * for diagnostics we report a synthetic span anchored at `fileFromDecl` with
 * `start: 0, end: 0`. Callers that need a richer span (LSP / IDE) recover the
 * actual source position from the enclosing AST node — the `readPos` value
 * the walker already tracks. (A future B-step that propagates absolute
 * baseOffsets through expression-parser will let us upgrade this to an
 * exact span; today the diagnostic is correct on code/severity/file even if
 * the column is approximate.)
 */
function makeReportSpan(ident: IdentExpr, fileFromDecl: string): Span {
  const ispan = (ident as any).span;
  return {
    file: (ispan && typeof ispan.file === "string" && ispan.file.length > 0)
      ? ispan.file
      : fileFromDecl,
    start: typeof ispan?.start === "number" ? ispan.start : 0,
    end: typeof ispan?.end === "number" ? ispan.end : 0,
    line: typeof ispan?.line === "number" ? ispan.line : 1,
    col: typeof ispan?.col === "number" ? ispan.col : 1,
  };
}

/**
 * Extract a node's read-position. Prefers `node.span.start` when present;
 * otherwise inherits from the parent walker's `readPos`. The conservative
 * inheritance ensures every IdentExpr reached from a container with a
 * known absolute span uses that span's start as its read-position.
 */
function nodeReadPos(node: any, parentReadPos: number): number {
  const sp = node && node.span;
  if (sp && typeof sp.start === "number") return sp.start;
  return parentReadPos;
}

function walkResolveAtNames(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
  parentReadPos: number,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;
    const readPos = nodeReadPos(anyN, parentReadPos);

    // Resolve any ExprNode payloads this node carries.
    for (const f of B3_EXPR_FIELDS) {
      const v = anyN[f];
      if (v && typeof v === "object") {
        resolveAtNameOnExprNode(v, currentScope, errors, readPos);
      }
    }
    // Special case for c-style for: `cStyleParts: { initExpr, condExpr,
    // updateExpr }`. Each sub-field carries an ExprNode root.
    if (anyN.cStyleParts && typeof anyN.cStyleParts === "object") {
      for (const f of ["initExpr", "condExpr", "updateExpr"]) {
        const v = anyN.cStyleParts[f];
        if (v && typeof v === "object") {
          resolveAtNameOnExprNode(v, currentScope, errors, readPos);
        }
      }
    }
    // For state-decl with `renderSpec` (decl-with-spec / Shape 2 forms),
    // the renderSpec may itself be (or contain) markup or an ExprNode. The
    // `forEachIdentInExprNode` walker silently no-ops on non-ExprNode shapes,
    // and the structural recursion below covers the markup case.

    if (kind === "state-decl") {
      // Use the compound sub-scope for nested @-refs inside compound bodies.
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkResolveAtNames(anyN.children, stateScope, visited, errors, readPos);
      }
      continue;
    }

    if (kind === "function-decl") {
      // Use the function scope PASS 1 attached.
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkResolveAtNames(anyN.body, fnScope, visited, errors, readPos);
      continue;
    }

    // Generic recursion. Same shape as PASS 1 / PASS 2.
    if (Array.isArray(anyN.children)) walkResolveAtNames(anyN.children, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.body)) walkResolveAtNames(anyN.body, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.consequent)) walkResolveAtNames(anyN.consequent, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.alternate)) walkResolveAtNames(anyN.alternate, currentScope, visited, errors, readPos);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkResolveAtNames(arm.body, currentScope, visited, errors, readPos);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkResolveAtNames([anyN.expr.node], currentScope, visited, errors, readPos);
    }
  }
}

// ---------------------------------------------------------------------------
// B5: Cell classifier (PASS 4)
// ---------------------------------------------------------------------------
//
// Walks every registered state-cell record (recovered via the scope tree) and
// classifies its decl node into one of four `CellKind` values. Stamps both
// `_cellKind` and `_isBindable` on the AST decl as non-enumerable properties.
//
// Why iterate the scope tree (not the raw AST)? Every state-decl was
// registered into a scope's `stateCells` map by PASS 1 — that's the canonical
// inventory. Walking it directly:
//   1. Skips ALL non-state-decl nodes (no shape predicates needed).
//   2. Naturally descends into compound sub-scopes (each child's `_record` is
//      already in the compound scope's map).
//   3. Avoids touching engine/component bodies (they're raw text today; their
//      future scopes will simply be empty maps until B14+/B17+ register).
//
// No diagnostics fired. B6 reads `_cellKind` to decide render-vs-error; B7
// reads `_cellKind === "plain" | "markup-typed"` + `record.isConst` to filter
// derived-cell dep-DAG inputs.

/**
 * The canonical bindable HTML element set. Mirrors
 * `codegen/emit-html.ts:19-20` BIND_DIRECTIVE_TAGS["bind:value"]. If this
 * set drifts, both sites must update — a single-line change in each.
 */
const B5_BINDABLE_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);

/**
 * Classify a single state-decl node. Pure switch over A1a Step 4-6 fields:
 * `children` (Variant C parent), `isConst` (Shape 3 derived), `renderSpec`
 * (markup RHS), `renderSpec.element.tag` (bindable set).
 *
 * Algorithm (in priority order):
 *   1. `children` is an array (incl. empty `[]`)            → "compound-parent"
 *   2. `isConst === true` AND `renderSpec` present          → "markup-typed"
 *   3. `isConst === true` (non-markup derived)              → "plain"
 *   4. `renderSpec.element.tag` ∈ {input, textarea, select} → "bindable"
 *   5. `renderSpec` present (non-bindable tag, non-const)   → "markup-typed"
 *   6. Otherwise (Shape 1)                                  → "plain"
 *
 * Notes:
 *   - Step 2 captures Shape 3 markup-typed derived (`const <badge> = <span>...`).
 *     ast-builder routes the markup into `renderSpec` today — see
 *     `tests/integration/kickstarter-v2-smoke.test.js:278-296`.
 *   - Step 5 is defensive: a structural decl with markup RHS that ISN'T
 *     bindable AND isn't `const` is currently classified as markup-typed so
 *     B6's `<varname/>` use-site can render the markup. A1b/B6 may later
 *     tighten and reject this form.
 */
function classifyStateDecl(decl: ReactiveDeclNode): CellKind {
  if (Array.isArray(decl.children)) return "compound-parent";
  const renderSpec = decl.renderSpec;
  const renderTag = renderSpec && renderSpec.element ? renderSpec.element.tag : undefined;
  if (decl.isConst === true) {
    return renderSpec ? "markup-typed" : "plain";
  }
  if (renderTag && B5_BINDABLE_TAGS.has(renderTag)) return "bindable";
  if (renderSpec) return "markup-typed";
  return "plain";
}

/**
 * Stamp `_cellKind` + `_isBindable` on a single decl. Non-enumerable to keep
 * structural-walker invariants intact (mirrors B1's `_record` choice).
 */
function annotateCellKind(decl: ReactiveDeclNode, kind: CellKind): void {
  Object.defineProperty(decl, "_cellKind", {
    value: kind,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(decl, "_isBindable", {
    value: kind === "bindable",
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * Walk the AST classifying every `state-decl` node. Mirrors PASS 1's recursion
 * shape (children/body/consequent/alternate/arms/lift-expr) so any state-decl
 * that PASS 1 registered is also reached here. Variant C compound children are
 * naturally covered: a compound parent's `children[]` contains nested
 * state-decl nodes which the recursion descends into.
 */
function walkClassifyCells(
  nodes: ASTNode[] | undefined,
  visited: WeakSet<object>,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "state-decl") {
      const decl = n as ReactiveDeclNode;
      const cellKind = classifyStateDecl(decl);
      annotateCellKind(decl, cellKind);
      // Descend into compound children (each child is itself a state-decl).
      if (Array.isArray(decl.children)) {
        walkClassifyCells(decl.children as ASTNode[], visited);
      }
      continue;
    }

    if (kind === "function-decl") {
      walkClassifyCells(anyN.body, visited);
      continue;
    }

    if (Array.isArray(anyN.children)) walkClassifyCells(anyN.children, visited);
    if (Array.isArray(anyN.body)) walkClassifyCells(anyN.body, visited);
    if (Array.isArray(anyN.consequent)) walkClassifyCells(anyN.consequent, visited);
    if (Array.isArray(anyN.alternate)) walkClassifyCells(anyN.alternate, visited);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkClassifyCells(arm.body, visited);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkClassifyCells([anyN.expr.node], visited);
    }
  }
}

// ---------------------------------------------------------------------------
// B6: Render-by-tag classifier (PASS 5)
// ---------------------------------------------------------------------------
//
// Walks every MarkupNode in the AST. For each lowercase self-closed tag
// (`<x/>`) that resolves to a registered state cell, fires one of:
//
//   E-CELL-NO-RENDER-SPEC          — cell has no render-spec (Shape 1, Shape 3
//                                    derived plain, Shape 3 markup-typed
//                                    derived, or Variant C compound parent).
//   E-CELL-RENDER-SPEC-NOT-BINDABLE — Shape 2 with non-bindable RHS markup
//                                    (e.g., `<msg> = <div>...</div>`). Use
//                                    Shape 3 (`const`) for display-only markup.
//
// The walker reads B5's `_cellKind` annotation + `decl.isConst` to disambiguate
// the spec-distinct cases collapsed into B5's `"markup-typed"` bucket:
//
//   markup-typed && isConst === true  → Shape 3 markup-typed derived
//                                       → E-CELL-NO-RENDER-SPEC (SPEC §6.6.17 line 3027)
//   markup-typed && isConst === false → Shape 2 non-bindable RHS
//                                       → E-CELL-RENDER-SPEC-NOT-BINDABLE
//
// **Phase 0 dispositions (Bryan-ratified):**
//
//   §3.1 — Compound-parent self-tag (`<formRes/>`) fires E-CELL-NO-RENDER-SPEC.
//          Spec is silent on this exact form; the spec-faithful extension
//          treats compound parents as "cell has no render-spec" (compound
//          parents structurally have `children[]`, mutually exclusive with
//          `renderSpec`). Error message tightens to mention the wrapping form
//          (`<formRes><field/></>`) and `${@formRes.field}` interpolation as
//          spec-canonical alternatives.
//
//   §3.2 — Component RHS render-specs (PascalCase tag in the decl's renderSpec,
//          e.g., `<x> = <MyComp/>`) are DEFERRED. SPEC line 1341 requires
//          component-prop-catalog inspection (B14/M18/M20 territory); B6 v1
//          accepts these silently rather than mis-firing. PascalCase USE-sites
//          (`<MyComponent/>` in markup) are also accepted — the lowercase-tag
//          predicate filters them out before lookup.
//
// **Use-site detection.** A render-by-tag use is:
//   1. `node.kind === "markup"`
//   2. `node.selfClosing === true`
//   3. `node.tag` starts with a lowercase letter (`/^[a-z]/`)
//   4. `lookupStateCell(fileScope, node.tag)` returns non-null
//
// Step 3 is the deferral filter (Phase 0 §3.2). Step 4 is the decisive filter
// — HTML built-ins (`<br/>`, `<input/>`, `<img/>`, ...) are also self-closed
// lowercase markup, but they don't resolve to a state cell, so the walker
// no-ops on them.
//
// **Scope handling.** B6 uses file-scope lookup (`lookupStateCell(fileScope,
// tag)`). Compound sub-scope cells are not addressable as bare `<childName/>`
// from outside the compound — they're addressed as `<parent><childName/></>`
// (the wrapping form, SPEC line 1882). File-scope lookup matches the spec's
// documented use-cases. A compound-internal sibling render-by-tag (rare; only
// possible inside a Shape 3 markup-typed RHS that contains a sibling tag) is
// a known scope-limitation noted in Phase 0 §2.4.

const B6_NO_RENDER_SPEC = "E-CELL-NO-RENDER-SPEC";
const B6_NOT_BINDABLE = "E-CELL-RENDER-SPEC-NOT-BINDABLE";

/** Minimal MarkupNode shape we read here. Avoids importing the full type. */
interface MinimalMarkupNode {
  kind: "markup";
  tag: string;
  selfClosing: boolean;
  span: Span;
  children?: ASTNode[];
}

/**
 * Build the diagnostic for E-CELL-NO-RENDER-SPEC at a `<tag/>` use-site.
 * Message text mirrors §34 line 14205 + tightens for compound parents.
 */
function makeNoRenderSpecDiagnostic(
  use: MinimalMarkupNode,
  decl: ReactiveDeclNode,
  cellKind: CellKind,
): SYMDiagnostic {
  const cellName = decl.name;
  let alternatives: string;
  if (cellKind === "compound-parent") {
    // Phase 0 §3.1 — compound-parent message tightening.
    alternatives =
      `Compound parents have no individual render-spec. Use the wrapping form `
      + `\`<${cellName}><field/></>\` to render a child cell, or \`\${@${cellName}.field}\` `
      + `interpolation to display a field's value.`;
  } else {
    alternatives = `Use \`\${@${cellName}}\` interpolation to display the value.`;
  }
  return {
    code: B6_NO_RENDER_SPEC,
    message:
      `${B6_NO_RENDER_SPEC}: \`<${cellName}/>\` used as render-by-tag in markup, but `
      + `the cell has no render-spec (${describeShape(cellKind, decl)}). ${alternatives} `
      + `(SPEC §6.4 + §34.)`,
    span: use.span,
    severity: "error",
  };
}

/**
 * Build the diagnostic for E-CELL-RENDER-SPEC-NOT-BINDABLE at a `<tag/>`
 * use-site. The decl is Shape 2 with a non-bindable HTML element as the RHS
 * markup (e.g., `<msg> = <div>...</div>`). Spec mandates Shape 3 (`const`)
 * for display-only markup cells.
 */
function makeNotBindableDiagnostic(
  use: MinimalMarkupNode,
  decl: ReactiveDeclNode,
): SYMDiagnostic {
  const cellName = decl.name;
  const renderTag = decl.renderSpec?.element?.tag ?? "(non-bindable)";
  return {
    code: B6_NOT_BINDABLE,
    message:
      `${B6_NOT_BINDABLE}: \`<${cellName}/>\` render-by-tag use is illegal — `
      + `the cell's render-spec root is \`<${renderTag}>\`, which is not a bindable `
      + `form element. Shape 2 (\`<${cellName}> = <markup>\`) requires a bindable `
      + `element (input, textarea, select). For display-only markup, use Shape 3: `
      + `\`const <${cellName}> = <${renderTag}>...</${renderTag}>\` and reference via `
      + `\`\${@${cellName}}\` interpolation. (SPEC §6.2 + §34.)`,
    span: use.span,
    severity: "error",
  };
}

/**
 * Brief shape descriptor for the diagnostic message.  Spec-faithful enumeration
 * matching §34 row text + Phase 0 §3.1 extension for compound-parent.
 */
function describeShape(cellKind: CellKind, decl: ReactiveDeclNode): string {
  switch (cellKind) {
    case "plain":
      return decl.isConst === true
        ? "Shape 3 non-markup derived"
        : "Shape 1 plain cell";
    case "markup-typed":
      // Only reached via the isConst === true branch (markup-typed derived).
      return "Shape 3 markup-typed derived — derived cells do not have render-specs (SPEC §6.6.17)";
    case "compound-parent":
      return "Variant C compound parent";
    case "bindable":
      // Defensive — bindable should not reach this fn.
      return "Shape 2 bindable";
  }
}

/**
 * Check a single MarkupNode for render-by-tag use. If it qualifies as a
 * use-site (lowercase self-closed tag matching a registered cell), apply the
 * cell-kind switch and push the appropriate diagnostic. Returns silently for
 * non-use-site nodes.
 */
function checkRenderByTag(
  node: MinimalMarkupNode,
  fileScope: Scope,
  errors: SYMDiagnostic[],
): void {
  if (!node.selfClosing) return;
  if (typeof node.tag !== "string" || node.tag.length === 0) return;
  // Phase 0 §3.2 — PascalCase use-sites are deferred (component territory).
  const first = node.tag.charCodeAt(0);
  // Lowercase letter range: 'a'-'z' = 97-122. Anything outside (uppercase,
  // digits, special) is not a state-cell render-by-tag use.
  if (first < 97 || first > 122) return;
  const decl = lookupStateCell(fileScope, node.tag);
  if (!decl) return; // HTML built-in, unresolved tag, or compound child — out of scope.
  const declNode = decl.declNode;
  const cellKind = getCellKind(declNode);
  if (cellKind === undefined) return; // not classified — defensive (shouldn't happen post-PASS-4).
  switch (cellKind) {
    case "bindable":
      // Shape 2 with bindable HTML root — accept.
      return;
    case "plain":
      // Shape 1 plain OR Shape 3 non-markup derived — both fire.
      errors.push(makeNoRenderSpecDiagnostic(node, declNode, cellKind));
      return;
    case "compound-parent":
      // Phase 0 §3.1 — spec-silent extension; fire E-CELL-NO-RENDER-SPEC.
      errors.push(makeNoRenderSpecDiagnostic(node, declNode, cellKind));
      return;
    case "markup-typed": {
      const isConst = declNode.isConst === true;
      if (isConst) {
        // Shape 3 markup-typed derived (SPEC §6.6.17 line 3027). Fires
        // E-CELL-NO-RENDER-SPEC regardless of whether the RHS markup looks
        // bindable — derived cells do not have render-specs.
        errors.push(makeNoRenderSpecDiagnostic(node, declNode, cellKind));
        return;
      }
      // Shape 2 non-bindable RHS — but defer if PascalCase RHS (component).
      // Phase 0 §3.2 — deferred to B14/M18/M20 component-prop-catalog work.
      const renderTag = declNode.renderSpec?.element?.tag;
      if (typeof renderTag === "string" && renderTag.length > 0) {
        const rFirst = renderTag.charCodeAt(0);
        if (rFirst >= 65 && rFirst <= 90) {
          // PascalCase RHS — component render-spec; needs prop-catalog.
          // B6 v1 accepts silently; B14/M18/M20 will extend with the
          // bindable-prop check.
          return;
        }
      }
      errors.push(makeNotBindableDiagnostic(node, declNode));
      return;
    }
  }
}

/**
 * Walk the AST checking every MarkupNode for render-by-tag use. Mirrors
 * PASS-1's recursion shape (children/body/consequent/alternate/arms/lift-expr)
 * with the added discrimination that `kind === "markup"` triggers the
 * use-site check before recursing into the markup's own `children`.
 *
 * State-decl nodes are recursed-into for compound children but their own
 * `renderSpec` markup is NOT walked — the renderSpec markup is the cell's
 * VALUE, not a render-by-tag use surface. Walking it would mis-fire on
 * legitimate markup like the `<input/>` inside a Shape 2 RHS.
 */
function walkRenderByTagUses(
  nodes: ASTNode[] | undefined,
  fileScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    if (kind === "markup") {
      // Use-site check on this markup node BEFORE recursion. Recursion is
      // unconditional — even if this node is a self-closed render-by-tag
      // that fires, descendants (none, by selfClosing definition) are still
      // walked for consistency. For non-self-closed markup, children are
      // walked normally.
      checkRenderByTag(n as MinimalMarkupNode, fileScope, errors);
      if (Array.isArray(anyN.children)) {
        walkRenderByTagUses(anyN.children, fileScope, visited, errors);
      }
      continue;
    }

    if (kind === "state-decl") {
      // Don't walk renderSpec markup (the cell's value, not a use-site).
      // DO descend into compound children, but render-by-tag inside a
      // compound's nested context is rare and uses the file-scope lookup
      // (matching Phase 0 §2.4 limitation note).
      if (Array.isArray(anyN.children)) {
        walkRenderByTagUses(anyN.children, fileScope, visited, errors);
      }
      continue;
    }

    if (kind === "function-decl") {
      walkRenderByTagUses(anyN.body, fileScope, visited, errors);
      continue;
    }

    // Generic recursion (mirrors PASS-1 shape).
    if (Array.isArray(anyN.children)) walkRenderByTagUses(anyN.children, fileScope, visited, errors);
    if (Array.isArray(anyN.body)) walkRenderByTagUses(anyN.body, fileScope, visited, errors);
    if (Array.isArray(anyN.consequent)) walkRenderByTagUses(anyN.consequent, fileScope, visited, errors);
    if (Array.isArray(anyN.alternate)) walkRenderByTagUses(anyN.alternate, fileScope, visited, errors);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkRenderByTagUses(arm.body, fileScope, visited, errors);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkRenderByTagUses([anyN.expr.node], fileScope, visited, errors);
    }
  }
}

// ---------------------------------------------------------------------------
// B8: L21 walker — E-DERIVED-VALUE-MUTATE (PASS 6)
// ---------------------------------------------------------------------------
//
// Per SPEC §6.6.18 (lock L21), in-place mutation of a `const`-derived cell
// SHALL be rejected at compile time. Three forbidden form classes:
//
//   1. Array mutating method calls — `@derivedArr.push(x)`, etc. (9 methods
//      per §6.5.1: push, pop, shift, unshift, splice, reverse, sort, fill,
//      copyWithin).
//   2. Object property writes / compound-assignments / delete —
//      `@derivedObj.foo = x`, `@derivedObj.foo += 1`, `delete @derivedObj.foo`,
//      and the 14 compound forms (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=,
//      >>=, >>>=, ??=, ||=, &&=).
//   3. In-compound derived sub-cell — `@form.derivedField.method(...)` /
//      `@form.derivedField.foo = x` where `derivedField` is `const`-declared
//      inside a Variant C compound parent.
//
// AST shape paths (per `tests/integration/parse-mutation-shapes.test.js`):
//
//   - `reactive-array-mutation` (specialized lowering, single-segment receiver,
//     method ∈ ARRAY_MUTATIONS) → check via `target` string + `method`.
//   - `reactive-nested-assign` (specialized lowering, `=` only) → check via
//     `target` string + `path[]`.
//   - `bare-expr` containing one of:
//       - `assign` (compound assigns; computed-index assigns; multi-segment
//         receivers; plain `=` on chained members) → check via leaf-ident
//         walk on `target`.
//       - `call` with `callee.kind === "member"` and method name ∈
//         ARRAY_MUTATING_METHODS — covers compound-receiver chains
//         `@form.errors.push(x)`.
//       - `unary` with `op === "delete"` and `argument.kind ∈ {"member",
//         "index"}` → check via leaf-ident walk on `argument`.
//
// **NEXT-STEP HOOK (E-DERIVED-WRITE):** §6.6.18 normative requires this check
// to share a pass with §6.6.8 E-DERIVED-WRITE (reassignment form). When that
// rule is implemented, it should join this walker — `@derived = newval` is an
// `assign` ExprNode whose `target` is a bare ident (not a member chain), so
// the dispatch is a sibling discriminator, not a separate walk.
//
// **OUT OF B8 SCOPE (deferred):**
//   - E-SYNTHESIZED-WRITE (§55.7) — depends on B11/B12's synth-cell registry
//     which doesn't exist yet. B11 will extend this walker.
//   - Markup-typed derived cells: per §6.6.18, the rule applies uniformly;
//     markup APIs today expose no mutators so the rule is non-firing in
//     practice but no special exemption is needed in the walker.

/**
 * Walk a chained member/index expression to its leaf IdentExpr. Mirrors the
 * `leafIdent` helper in `tests/integration/parse-mutation-shapes.test.js`.
 * Returns the leaf `ident` ExprNode, or null if the chain doesn't terminate
 * in an ident (e.g., `(@a)[0]` parens-wrapped — defensive).
 */
function leafIdentInChain(node: any): any | null {
  let cur = node;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident") return cur;
    if (cur.kind === "member") { cur = cur.object; continue; }
    if (cur.kind === "index") { cur = cur.object; continue; }
    return null;
  }
  return null;
}

/**
 * Collect dotted-path segments from a chained member/index expression.
 * Stops at the leaf ident; returns segments in receiver-to-leaf order
 * EXCLUDING the leaf ident's name. Computed-index segments produce no
 * string segment (compound nav must use static dotted paths to find a
 * registered sub-cell — `@form[i]` cannot resolve to a named compound child).
 *
 * Returns `null` if the chain terminates in something other than an ident
 * (defensive — same shape as leafIdentInChain).
 */
function collectMemberPath(node: any): string[] | null {
  const segments: string[] = [];
  let cur = node;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident") {
      segments.reverse();
      return segments;
    }
    if (cur.kind === "member") {
      // `member.property` is a static string per ESTree-flat scrml AST.
      if (typeof cur.property === "string") segments.push(cur.property);
      cur = cur.object;
      continue;
    }
    if (cur.kind === "index") {
      // Computed index — cannot contribute to a static path. Bail; B8
      // resolves the BASE cell via leaf ident only (case 2-3 still fires
      // when the base is derived; sub-path resolution unavailable).
      return null;
    }
    return null;
  }
  return null;
}

/**
 * Build the full path used to look up the receiver cell record in the scope:
 * `[leafIdentNameWithoutAt, ...memberPathSegments]`. The leaf ident's `@`
 * prefix is stripped. For a single-segment receiver (e.g., `@arr` in
 * `@arr.push(1)`), returns `["arr"]`. For a compound receiver
 * (e.g., `@form.errors` in `@form.errors.push(1)`), returns `["form", "errors"]`.
 */
function buildReceiverPath(chainRoot: any): string[] | null {
  const leaf = leafIdentInChain(chainRoot);
  if (!leaf || typeof leaf.name !== "string") return null;
  if (!leaf.name.startsWith("@")) return null;
  const baseName = leaf.name.slice(1);
  if (!baseName) return null;
  const segments = collectMemberPath(chainRoot);
  if (segments === null) return null;
  return [baseName, ...segments];
}

/**
 * Resolve a receiver chain to its `StateCellRecord` if any, returning the
 * record + the qualified path used to look it up. The record's `isConst`
 * field tells the caller whether this is a derived cell.
 *
 * For specialized-lowering kinds (`reactive-array-mutation`,
 * `reactive-nested-assign`), the caller passes the constructed path
 * directly (cheaper than walking the ExprNode).
 */
function resolveReceiverRecord(
  scope: Scope,
  path: string[],
): StateCellRecord | null {
  if (path.length === 0) return null;
  if (path.length === 1) return lookupStateCell(scope, path[0]);
  return lookupQualifiedStateCell(scope, path);
}

/**
 * Construct a synthetic Span for a B8 diagnostic anchored at the AST node
 * that carries the mutation. Mirrors B6/B4 synthetic-span pattern: `start`
 * and `end` may be 0 if the underlying ExprNode lacks reliable absolute
 * offsets, but `file` is always set.
 */
function spanFromMutationNode(node: any, fileFromScope: string): Span {
  const sp = node && node.span;
  return {
    file: (sp && typeof sp.file === "string" && sp.file.length > 0)
      ? sp.file
      : fileFromScope,
    start: typeof sp?.start === "number" ? sp.start : 0,
    end: typeof sp?.end === "number" ? sp.end : 0,
    line: typeof sp?.line === "number" ? sp.line : 1,
    col: typeof sp?.col === "number" ? sp.col : 1,
  };
}

/**
 * Build the human-readable cell-reference string used in diagnostic messages.
 * `["form", "derivedField"]` → `"@form.derivedField"`. For single-segment,
 * `["doubled"]` → `"@doubled"`.
 */
function formatReceiver(path: string[]): string {
  return "@" + path.join(".");
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for a method-call form (case 1).
 * Caller has already verified the receiver resolves to a derived cell.
 */
function fireMethodCall(
  errors: SYMDiagnostic[],
  receiverPath: string[],
  method: string,
  span: Span,
): void {
  const ref = formatReceiver(receiverPath);
  errors.push({
    code: "E-DERIVED-VALUE-MUTATE",
    message:
      `E-DERIVED-VALUE-MUTATE: in-place mutation of derived cell \`${ref}\` `
      + `via \`.${method}(...)\`. \`${ref}\` is \`const\`-derived; mutating its `
      + `value is forbidden — the mutation would be silently clobbered the next `
      + `time upstream dependencies fire (SPEC §6.6.18 + §34). Fix: mutate the `
      + `upstream cell instead, or declare a separate mutable cell for `
      + `independent storage.`,
    span,
    severity: "error",
  });
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for a property-assignment form (case 2 plain
 * `=` or compound-assign `+=` etc.).
 */
function firePropertyAssign(
  errors: SYMDiagnostic[],
  receiverPath: string[],
  op: string,
  pathTail: string[],
  span: Span,
): void {
  const ref = formatReceiver(receiverPath);
  const tailDesc = pathTail.length > 0 ? `.${pathTail.join(".")}` : "";
  errors.push({
    code: "E-DERIVED-VALUE-MUTATE",
    message:
      `E-DERIVED-VALUE-MUTATE: in-place mutation of derived cell \`${ref}\` `
      + `via property write \`${ref}${tailDesc} ${op} ...\`. \`${ref}\` is `
      + `\`const\`-derived; mutating its value is forbidden — the mutation `
      + `would be silently clobbered the next time upstream dependencies `
      + `fire (SPEC §6.6.18 + §34). Fix: mutate the upstream cell instead, `
      + `or declare a separate mutable cell for independent storage.`,
    span,
    severity: "error",
  });
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for a delete form (`delete @derivedObj.foo`).
 */
function fireDelete(
  errors: SYMDiagnostic[],
  receiverPath: string[],
  span: Span,
): void {
  const ref = formatReceiver(receiverPath);
  errors.push({
    code: "E-DERIVED-VALUE-MUTATE",
    message:
      `E-DERIVED-VALUE-MUTATE: in-place mutation of derived cell \`${ref}\` `
      + `via \`delete\`. \`${ref}\` is \`const\`-derived; deleting properties of `
      + `its value is forbidden — the deletion would be silently clobbered the `
      + `next time upstream dependencies fire (SPEC §6.6.18 + §34). Fix: mutate `
      + `the upstream cell instead, or declare a separate mutable cell.`,
    span,
    severity: "error",
  });
}

/**
 * Scan path prefixes longest→shortest, looking for a registered StateCell
 * record. The deepest registered record on the prefix is the leaf cell
 * (handles single-segment `["copy"]` and compound-nav
 * `["form", "derivedField"]` uniformly).
 *
 * Returns the matched record + the prefix path that resolved it, or null.
 */
function findDeepestRegisteredOnPrefix(
  scope: Scope,
  fullPath: string[],
): { record: StateCellRecord; path: string[] } | null {
  for (let len = fullPath.length; len >= 1; len--) {
    const prefix = fullPath.slice(0, len);
    const rec = resolveReceiverRecord(scope, prefix);
    if (rec) return { record: rec, path: prefix };
  }
  return null;
}

/**
 * Fire E-DERIVED-VALUE-MUTATE for an assign-form (`+=`, plain `=`, etc.) when
 * the receiver chain root resolves to a derived cell. Returns true if fired.
 *
 * `assignNode.target` is the (member|index) being assigned to; the receiver
 * is `assignNode.target.object`. `fullReceiverPath` was built from that
 * object.
 */
function scanPrefixesAndFireAssign(
  fullReceiverPath: string[],
  assignNode: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  containerSpan: Span,
): boolean {
  const hit = findDeepestRegisteredOnPrefix(scope, fullReceiverPath);
  if (!hit || !hit.record.isConst) return false;
  // Compute the property tail — segments AFTER the matched derived cell, plus
  // the final assigned property.
  const tail: string[] = fullReceiverPath.slice(hit.path.length);
  if (assignNode.target.kind === "member" && typeof assignNode.target.property === "string") {
    tail.push(assignNode.target.property);
  } else if (assignNode.target.kind === "index") {
    tail.push("[…]");
  }
  firePropertyAssign(errors, hit.path, assignNode.op, tail, containerSpan);
  return true;
}

/**
 * Inspect an ExprNode subtree for embedded mutation forms targeting a
 * derived cell. Walks `assign`, `call`, and `unary` expressions; for each
 * matching shape that resolves to a derived receiver, fires the
 * appropriate diagnostic.
 *
 * `containerSpan` is the source-anchor for diagnostic spans (the enclosing
 * statement-level node); ExprNode spans are not reliable absolute offsets
 * (see B3 doc).
 */
function checkExprNodeForMutations(
  exprNode: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  containerSpan: Span,
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  const seen = new WeakSet<object>();
  function walk(n: any): void {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    const k = n.kind;
    if (k === "assign" && n.target && typeof n.op === "string"
        && (n.target.kind === "member" || n.target.kind === "index")
        && isDerivedMutatingAssignOp(n.op)) {
      // The receiver chain is `n.target.object` (everything BEFORE the
      // final property/index segment). The final segment IS the assign
      // target; it's not part of the receiver path.
      const fullPath = buildReceiverPath(n.target.object);
      if (fullPath) {
        // Walk prefixes longest→shortest; the deepest registered record is
        // the leaf cell (covers single-segment `["copy"]`, compound-nav
        // `["form", "derivedField"]`, etc.). Fire if `isConst`.
        const fired = scanPrefixesAndFireAssign(fullPath, n, scope, errors, containerSpan);
        // (no-op when not derived; scan returns boolean for future use)
        void fired;
      }
    }
    if (k === "call" && n.callee && n.callee.kind === "member"
        && typeof n.callee.property === "string"
        && ARRAY_MUTATING_METHODS.has(n.callee.property)) {
      // The receiver is `n.callee.object` (everything BEFORE `.method`).
      const fullPath = buildReceiverPath(n.callee.object);
      if (fullPath) {
        const hit = findDeepestRegisteredOnPrefix(scope, fullPath);
        if (hit && hit.record.isConst) {
          fireMethodCall(errors, hit.path, n.callee.property, containerSpan);
        }
      }
    }
    if (k === "unary" && n.op === "delete" && n.argument
        && (n.argument.kind === "member" || n.argument.kind === "index")) {
      // The DELETED property is `n.argument.property` (or computed index);
      // the receiver chain is `n.argument.object`.
      const fullPath = buildReceiverPath(n.argument.object);
      if (fullPath) {
        const hit = findDeepestRegisteredOnPrefix(scope, fullPath);
        if (hit && hit.record.isConst) {
          fireDelete(errors, hit.path, containerSpan);
        }
      }
    }
    // Recurse into structural sub-fields. ExprNode shapes carry various child
    // ExprNodes (operands, arguments, callees, properties, etc.). A generic
    // walk over enumerable object/array properties is sufficient and safe.
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "_resolvedStateCell") continue;
      const v = (n as any)[key];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (const item of v) walk(item);
        } else {
          walk(v);
        }
      }
    }
  }
  walk(exprNode);
}

/**
 * Check a `reactive-array-mutation` AST node (specialized lowering, case 1).
 * Receiver is single-segment (`target` is the cell name); method is one of
 * the ARRAY_MUTATIONS list per ast-builder. We re-validate against the
 * canonical 9-method set from SPEC §6.5.1 (defensive — ast-builder list may
 * drift from spec).
 */
function checkReactiveArrayMutation(
  n: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): void {
  if (typeof n.target !== "string" || typeof n.method !== "string") return;
  if (!ARRAY_MUTATING_METHODS.has(n.method)) return;
  const rec = lookupStateCell(scope, n.target);
  if (rec && rec.isConst) {
    fireMethodCall(errors, [n.target], n.method, spanFromMutationNode(n, fileFromScope));
  }
}

/**
 * Check a `reactive-nested-assign` AST node (specialized lowering, case 2
 * plain `=` on dotted-path receiver). Receiver path is `target` (cell name)
 * + `path[]` LESS the final segment (which is the assign target property).
 *
 * For `@obj.foo = 1` → `target: "obj"`, `path: ["foo"]`. The receiver IS
 * `@obj`; the property being assigned is `foo`.
 *
 * For `@form.config.mode = "x"` → `target: "form"`, `path: ["config", "mode"]`.
 * Receiver chain is `@form.config`; final assigned property is `mode`. To
 * fire correctly when the LEAF cell (`@form.config` resolved through compound
 * lookup) or the BASE cell (`@form`) is derived, we resolve the deepest
 * registered record on the prefix path and check `isConst`.
 */
function checkReactiveNestedAssign(
  n: any,
  scope: Scope,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): void {
  if (typeof n.target !== "string" || !Array.isArray(n.path)) return;
  // Receiver path = [target, ...path[0..length-1]] — the assigned property
  // is the LAST element of `path` (or `path` itself is the property if
  // length === 1).
  // We try resolving from the longest prefix down. The deepest registered
  // record wins; if any registered record on the prefix is derived, fire.
  // Spec §6.6.18 case 2 fires when the receiver root resolves to a `const`-
  // declared cell — so we scan prefixes including [target] alone.
  const fullPrefix = [n.target, ...n.path.slice(0, n.path.length - 1)];
  // For length=1 path (e.g., `@obj.foo = x`), fullPrefix = ["obj"].
  // For length=2 path (e.g., `@form.config.mode = x`), fullPrefix = ["form", "config"].
  // Try the deepest qualified path first; if that doesn't resolve, walk shorter.
  let derivedRec: StateCellRecord | null = null;
  let derivedPath: string[] = [];
  for (let len = fullPrefix.length; len >= 1; len--) {
    const prefix = fullPrefix.slice(0, len);
    const rec = resolveReceiverRecord(scope, prefix);
    if (rec && rec.isConst) {
      derivedRec = rec;
      derivedPath = prefix;
      break;
    }
  }
  if (derivedRec) {
    const tail = n.path.slice(derivedPath.length - 1);
    firePropertyAssign(
      errors,
      derivedPath,
      "=",
      tail,
      spanFromMutationNode(n, fileFromScope),
    );
  }
}

/**
 * PASS 6 walker — descends the AST tree visiting every statement-level
 * node. For each candidate mutation form, dispatches to one of the three
 * checkers above. Mirrors the structural-recursion pattern used by PASS 3
 * (walkResolveAtNames) and PASS 5 (walkRenderByTagUses).
 */
function walkDerivedValueMutate(
  nodes: ASTNode[] | undefined,
  currentScope: Scope,
  visited: WeakSet<object>,
  errors: SYMDiagnostic[],
  fileFromScope: string,
): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (visited.has(n)) continue;
    visited.add(n);
    const anyN = n as any;
    const kind = anyN.kind as string;

    // Specialized-lowering kinds (case 1 single-segment, case 2 plain `=`).
    if (kind === "reactive-array-mutation") {
      checkReactiveArrayMutation(anyN, currentScope, errors, fileFromScope);
      // No body recursion — these are leaf statement nodes. argsExpr may
      // contain nested ExprNodes (e.g., `@a.push(@b.push(1))`); walk them
      // for nested mutations.
      if (anyN.argsExpr) {
        checkExprNodeForMutations(
          anyN.argsExpr,
          currentScope,
          errors,
          spanFromMutationNode(anyN, fileFromScope),
        );
      }
      continue;
    }
    if (kind === "reactive-nested-assign") {
      checkReactiveNestedAssign(anyN, currentScope, errors, fileFromScope);
      if (anyN.valueExpr) {
        checkExprNodeForMutations(
          anyN.valueExpr,
          currentScope,
          errors,
          spanFromMutationNode(anyN, fileFromScope),
        );
      }
      continue;
    }

    // Generic ExprNode-bearing nodes — walk all carried ExprNodes for
    // embedded mutations. Mirrors B3_EXPR_FIELDS coverage.
    const containerSpan = spanFromMutationNode(anyN, fileFromScope);
    for (const f of B3_EXPR_FIELDS) {
      const v = anyN[f];
      if (v && typeof v === "object") {
        checkExprNodeForMutations(v, currentScope, errors, containerSpan);
      }
    }
    if (anyN.cStyleParts && typeof anyN.cStyleParts === "object") {
      for (const f of ["initExpr", "condExpr", "updateExpr"]) {
        const v = anyN.cStyleParts[f];
        if (v && typeof v === "object") {
          checkExprNodeForMutations(v, currentScope, errors, containerSpan);
        }
      }
    }

    // Scope-aware recursion.
    if (kind === "state-decl") {
      const stateScope = (anyN as ReactiveDeclNode & ScopeAnnotated)._scope;
      if (stateScope && Array.isArray(anyN.children)) {
        walkDerivedValueMutate(anyN.children, stateScope, visited, errors, fileFromScope);
      }
      continue;
    }
    if (kind === "function-decl") {
      const fnScope = (anyN as ScopeAnnotated)._scope ?? currentScope;
      walkDerivedValueMutate(anyN.body, fnScope, visited, errors, fileFromScope);
      continue;
    }

    // Generic recursion (mirrors PASS 3 / PASS 5 structural recursion).
    if (Array.isArray(anyN.children)) walkDerivedValueMutate(anyN.children, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.body)) walkDerivedValueMutate(anyN.body, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.consequent)) walkDerivedValueMutate(anyN.consequent, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.alternate)) walkDerivedValueMutate(anyN.alternate, currentScope, visited, errors, fileFromScope);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walkDerivedValueMutate(arm.body, currentScope, visited, errors, fileFromScope);
      }
    }
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walkDerivedValueMutate([anyN.expr.node], currentScope, visited, errors, fileFromScope);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run SYM over a single file's AST. Mutates `ast` in place by adding
 * `_scope` to scope-introducing nodes and `_record` to each state-decl;
 * also attaches `_scope` to the FileAST itself.
 *
 * Stage 3.06 of the compiler pipeline (between NR and CE).
 */
export function runSYM(input: SYMInput): SYMResult {
  const { filePath, ast, exportRegistry } = input;

  const fileScope = createScope("file", null, "");
  Object.defineProperty(ast, "_scope", {
    value: fileScope,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  const stats: SYMStats = {
    totalRecords: 0,
    compoundParents: 0,
    compoundChildren: 0,
    totalScopes: 1, // the file-level root counts
    totalImportBindings: 0,
  };

  // PASS 1.b (B4): Register every import specifier into the file-level
  // scope's importBindings map. Imports are hoisted onto `FileAST.imports[]`
  // by TAB, so walking that array is the canonical path; this avoids
  // re-discovering import nodes inside the AST tree (which would require
  // tagging logic-block contents). Runs BEFORE state-decl registration so
  // PASS 3's pinned-forward-ref check (which reads importBindings) sees a
  // populated table from the first walk step.
  registerImportBindings(ast.imports, fileScope);
  stats.totalImportBindings = fileScope.importBindings.size;

  // PASS 1 (B1): Construct scopes + register state-decls. The state-cell
  // table is fully populated when this returns, so PASS 2 can do a clean
  // parent-chain walk for collision detection regardless of source order.
  // (State-decls hoist per SPEC §6 — they are visible at any local-decl
  // in the same or enclosing scope.)
  const visited = new WeakSet<object>();
  walk(ast.nodes, fileScope, stats, visited);

  // PASS 2 (B2): Walk local-decl nodes (let/const/tilde/lin); look up each
  // by name in the current-scope parent chain; fire E-NAME-COLLIDES-STATE
  // if a state-cell record is found. Re-uses the `_scope` annotations PASS 1
  // attached to function-decls (so we can set the correct currentScope as
  // we descend without re-creating scopes).
  const errors: SYMDiagnostic[] = [];
  const visited2 = new WeakSet<object>();
  walkLocalDeclsForCollisions(ast.nodes, fileScope, visited2, errors);

  // PASS 2.b (B4): E-IMPORT-PINNED-INVALID best-effort fire. For every
  // pinned import-binding registered at file scope, look up the source
  // file's exportRegistry entry; if the export kind is definitively-not-
  // cell-not-engine (function/fn/type/channel), fire the diagnostic.
  // const/let imports are accepted with a documented B14 deferral. When
  // no exportRegistry is supplied (test-harness path), the check is
  // skipped silently.
  fireImportPinnedInvalid(fileScope, exportRegistry, errors);

  // PASS 3 (B3): Walk every ExprNode payload on every AST node; for each
  // `@`-prefixed IdentExpr, stamp `_resolvedStateCell` (record or null) via
  // a parent-chain lookup. Re-uses the `_scope` annotations PASS 1 attached
  // to function-decls + compound state-decls. No diagnostics fired here —
  // resolution failures stamp `null`; the existing-infra catch-all
  // (E-SCOPE-001 / DG sweep) handles any ultimate "unknown reactive" error
  // surface.
  // Initial readPos = 0 (file start). Top-level nodes will override via
  // their own span.start; nodes lacking spans inherit (defensively).
  const visited3 = new WeakSet<object>();
  walkResolveAtNames(ast.nodes, fileScope, visited3, errors, 0);

  // PASS 4 (B5): Classify each state-decl into a CellKind discriminant.
  // Stamps `_cellKind` and `_isBindable` non-enumerable properties on the
  // decl node. No diagnostics — B6 will fire render-by-tag errors based on
  // the annotation; B7 will filter derived-cell DAG inputs.
  const visited4 = new WeakSet<object>();
  walkClassifyCells(ast.nodes, visited4);

  // PASS 5 (B6): Walk every MarkupNode in the AST. For lowercase self-closed
  // tags resolving to a registered state cell, fire E-CELL-NO-RENDER-SPEC or
  // E-CELL-RENDER-SPEC-NOT-BINDABLE based on B5's `_cellKind` annotation +
  // `decl.isConst`. Phase 0 dispositions: compound-parent fires
  // E-CELL-NO-RENDER-SPEC (§3.1); PascalCase RHS deferred (§3.2).
  const visited5 = new WeakSet<object>();
  walkRenderByTagUses(ast.nodes, fileScope, visited5, errors);

  // PASS 6 (B8): L21 walker — fire E-DERIVED-VALUE-MUTATE on in-place
  // mutations of `const`-derived cells per SPEC §6.6.18. Three forms covered:
  // array mutating method calls, object property writes (incl. compound
  // assigns + delete), in-compound derived sub-cells. Reads PASS 1's scope
  // tree + StateCellRecord.isConst; no annotations written. E-DERIVED-WRITE
  // (§6.6.8) is the sibling rule that will join this walker when implemented;
  // E-SYNTHESIZED-WRITE (§55.7) is deferred to B11.
  const visited6 = new WeakSet<object>();
  walkDerivedValueMutate(ast.nodes, fileScope, visited6, errors, filePath);

  return {
    filePath,
    errors,
    fileScope,
    stats,
  };
}

/**
 * Run SYM over a batch of TAB results (mirrors `runNRBatch` shape).
 * Each AST is mutated in place. Returns per-file results in input order.
 *
 * B4: optional `exportRegistry` (from MOD) enables `E-IMPORT-PINNED-INVALID`
 * firing. When omitted (test-harness path), the registry check is skipped.
 */
export function runSYMBatch(
  tabResults: Array<{ filePath: string; ast: FileAST }>,
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>>,
): SYMResult[] {
  const out: SYMResult[] = [];
  for (const r of tabResults) {
    if (!r || !r.ast) continue;
    out.push(runSYM({ filePath: r.filePath, ast: r.ast, exportRegistry }));
  }
  return out;
}

/**
 * Look up a state-cell by leaf name, walking the scope's parent chain.
 * Returns the closest enclosing record, or `null` if not found.
 *
 * V5-strict semantic: B2 uses this lookup for the E-NAME-COLLIDES-STATE
 * check (a local `let`/`const`/`tilde`/`lin` redeclaring a name registered
 * in this scope or any enclosing parent fires the error). B3 will use it
 * for `@name` resolution.
 */
export function lookupStateCell(
  scope: Scope | null | undefined,
  name: string,
): StateCellRecord | null {
  let s: Scope | null | undefined = scope;
  while (s) {
    const rec = s.stateCells.get(name);
    if (rec) return rec;
    s = s.parent;
  }
  return null;
}

/**
 * Look up a multi-segment qualified state-cell path.  Used for
 * `@signup.name` / `@outer.inner.leaf` resolution.
 *
 * Algorithm: resolve the FIRST segment via the parent-chain walk
 * (`lookupStateCell`); then for each subsequent segment, resolve into the
 * current record's compound sub-scope (the `_scope` annotation on the
 * compound parent's decl node).
 *
 * Returns the LEAF record on success, `null` if any segment fails.
 *
 * Edge cases:
 *   - Empty path → `null`.
 *   - Single-segment path → equivalent to `lookupStateCell`.
 *   - Intermediate segment isn't a compound parent → `null` (cannot descend).
 */
export function lookupQualifiedStateCell(
  scope: Scope | null | undefined,
  path: string[],
): StateCellRecord | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  let current = lookupStateCell(scope, path[0]);
  if (!current) return null;
  for (let i = 1; i < path.length; i++) {
    if (!current.isCompoundParent) return null;
    const subScope = (current.declNode as ReactiveDeclNode & ScopeAnnotated)._scope;
    if (!subScope) return null;
    const next = subScope.stateCells.get(path[i]);
    if (!next) return null;
    current = next;
  }
  return current;
}

/**
 * B4 — Look up an import binding by local name. Walks the parent chain (so a
 * future per-function or per-component import-binding scope is forward-
 * compatible); today's importBindings live only on the file-level root.
 *
 * Returns the closest enclosing record, or `null` if not found.
 */
export function lookupImportBinding(
  scope: Scope | null | undefined,
  localName: string,
): ImportBindingRecord | null {
  let s: Scope | null | undefined = scope;
  while (s) {
    const rec = s.importBindings.get(localName);
    if (rec) return rec;
    s = s.parent;
  }
  return null;
}

/**
 * Reverse lookup: given an AST node, return the scope it lives in (the
 * scope created AT this node for scope-introducing nodes; otherwise the
 * scope of its declared/registered state-cell).
 *
 * Returns:
 *   - For a scope-introducing node (`function-decl`, FileAST, compound
 *     `state-decl`): the scope that node OPENS (its body's scope).
 *   - For a state-decl that is NOT a compound parent: the scope it's
 *     REGISTERED in (i.e., `_record.scope`).
 *   - For all other nodes: `null` (B1 does not annotate non-scope, non-decl
 *     nodes; future B-steps may extend this).
 */
export function getScopeForNode(node: ASTNode | FileAST | null | undefined): Scope | null {
  if (!node) return null;
  const annotated = node as (ASTNode | FileAST) & ScopeAnnotated & RecordAnnotated;
  if (annotated._scope) return annotated._scope;
  if (annotated._record) return annotated._record.scope;
  return null;
}

/**
 * B3 read API — return the resolved `StateCellRecord` stamped onto an
 * IdentExpr by PASS 3.
 *
 * Return shape:
 *   - `StateCellRecord` — `@name` was `@`-prefixed and resolved to a
 *     registered cell.
 *   - `null` — `@name` was `@`-prefixed but no cell with that name was
 *     registered in any enclosing scope (the resolution-fail case;
 *     B3 stamps null, no error).
 *   - `undefined` — the IdentExpr was either (a) not `@`-prefixed (so PASS 3
 *     correctly skipped it) or (b) the IdentExpr lives in an ExprNode
 *     position PASS 3's walker didn't traverse. Consumers should treat
 *     `undefined` as "not annotated" and fall back to their own resolution
 *     if needed.
 */
export function getResolvedStateCell(
  ident: IdentExpr | null | undefined,
): StateCellRecord | null | undefined {
  if (!ident) return undefined;
  const annotated = ident as IdentExpr & ResolvedAtNameAnnotated;
  return annotated._resolvedStateCell;
}

/**
 * B5 read API — return the `CellKind` stamped onto a state-decl node by
 * PASS 4.
 *
 * Return shape:
 *   - `CellKind` — one of `"plain" | "bindable" | "markup-typed" | "compound-parent"`.
 *   - `undefined` — the node was either not a state-decl, not walked by SYM
 *     (e.g., raw test-helper construction), or `null`. Consumers should treat
 *     `undefined` as "not classified" and either treat as plain (B6 fires
 *     `E-CELL-NO-RENDER-SPEC` on plain) or fall back to a fresh classifier
 *     call.
 */
export function getCellKind(
  decl: ReactiveDeclNode | null | undefined,
): CellKind | undefined {
  if (!decl) return undefined;
  const annotated = decl as ReactiveDeclNode & CellKindAnnotated;
  return annotated._cellKind;
}

/**
 * B5 read API — return the `_isBindable` boolean stamped onto a state-decl
 * node by PASS 4. Equivalent to `getCellKind(decl) === "bindable"` but
 * convenient for B6's hot-path render-by-tag check.
 *
 * Returns `undefined` when the node was not classified (treat as `false`).
 */
export function isCellBindable(
  decl: ReactiveDeclNode | null | undefined,
): boolean | undefined {
  if (!decl) return undefined;
  const annotated = decl as ReactiveDeclNode & CellKindAnnotated;
  return annotated._isBindable;
}
