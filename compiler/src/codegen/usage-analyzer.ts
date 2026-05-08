/**
 * Phase A1c Step C0 — feature-usage analysis pass.
 *
 * Foundational analysis pass for the A1c codegen runtime-elision strategy
 * (SCOPE-AND-DECOMPOSITION §11, ratified Q3). Walks A1b's annotated AST and
 * produces a `FeatureUsage` bitmap recording which v0.next features the app
 * actually touches. Bitmap is consumed by every downstream runtime-emission
 * step (C5, C6, C8, C12, C14, C16, C18) so the runtime library is emitted
 * per-app based on actual feature usage.
 *
 * Soundness > completeness > minimal-output-size (per SCOPE §11.2 ratified):
 * conservative inclusion via structural-AST-kind triggers. False-negatives
 * crash apps at runtime; false-positives only bloat. When a question arises,
 * C0 sets the flag (fires `true`).
 *
 * **What C0 does NOT do:** zero new diagnostics, zero AST mutation, zero
 * emission. Pure analysis pass producing a structured data record.
 *
 * Cross-references:
 *   - docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md §4.0, §11
 *   - docs/changes/phase-a1c-codegen/SURVEY.md §2 (canonical bitmap shape)
 *   - SPEC §55.1 — universal-core 14-predicate catalog (validators)
 *   - SPEC §51.0 + §51.0.M-Q — engine surface (history/internal/onTimeout; §51.0.P parallel attribute STRUCK 2026-05-08)
 *   - SPEC §53 — refinement types (three-zone classification)
 *   - SPEC §38 — channel WebSocket
 *   - SPEC §6.8 — `reset(@cell)` + `default=`
 *   - SPEC §40.7 — `<program>` documentary attrs
 *   - SPEC §14.10 — bare-variant inference (M9 / B20)
 *   - primer §13.7 — B-step decoration table
 */

import { UNIVERSAL_CORE_PREDICATES } from "../validator-catalog.ts";
import { forEachIdentInExprNode, forEachResetExprInExprNode } from "../expression-parser.ts";
import type { ExprNode, IdentExpr } from "../types/ast.ts";

// ---------------------------------------------------------------------------
// Types — the per-app FeatureUsage bitmap
// ---------------------------------------------------------------------------

/**
 * The feature-usage bitmap. Per-flag soundness contract: structural inclusion
 * via AST-kind triggers; false-positives bloat, false-negatives crash.
 *
 * Per-predicate validator flags (14): one boolean per universal-core predicate
 * (SPEC §55.1). Other flags: one boolean per v0.next runtime feature.
 *
 * When new features land, add a flag here AND to `emptyUsage()` /
 * `fullUsage()` / `mergeUsage()` AND to the per-flag walker logic in
 * `analyzeUsage()`.
 */
export interface FeatureUsage {
  // -------- Validators (per-predicate flags; SPEC §55.1, L4) --------
  // 14 universal-core predicates per validator-catalog.ts.
  // (NOT in catalog: email/url/numeric/integer — stdlib `scrml:data`; custom — §55.9 enum tag.)
  validators: {
    req: boolean;
    "is some": boolean;       // V5-strict: 2-word predicate name
    length: boolean;
    pattern: boolean;
    min: boolean;
    max: boolean;
    gt: boolean;
    lt: boolean;
    gte: boolean;
    lte: boolean;
    eq: boolean;
    neq: boolean;
    oneOf: boolean;
    notIn: boolean;
  };

  // -------- Engines + temporal (B14 + A5-2/A5-3) --------
  /** Any engine-decl present (file-scope OR nested). */
  engines: boolean;
  /** Any engine with derived=expr (§51.0.J). */
  derivedEngines: boolean;
  /** Any engine state-child carrying `history` bareword (§51.0.N). */
  engineHistory: boolean;
  /** Any engine state-child with `internal:rule=` (§51.0.O). */
  engineInternalRules: boolean;
  /** Any `<onTimeout>` element inside an engine state-child (§51.0.M). */
  engineOnTimeout: boolean;
  /** Any nested `<engine>` inside a state-child (§51.0.Q). */
  engineNested: boolean;
  /** Any `<onTransition>` markup element (§51.0.J). */
  onTransitionHooks: boolean;

  // -------- Channels (§38, B19) --------
  /** Any `<channel>` markup node (file-level). Captures both exporter and
   *  consumer (post-CHX-inline) sides — per-file bitmap reflects per-file
   *  usage at the AST level, not codegen attribution. */
  channels: boolean;

  // -------- Refinement types (§53, three-zone — B21) --------
  /** Any decl with `predicateCheck.zone === "boundary"` (the only zone that
   *  emits runtime checks; static + trusted both elide). C16 consults this. */
  refinementTypes: boolean;
  /** Any decl with any `predicateCheck` (regardless of zone). Useful for
   *  output-budgeting / IDE tooling / future optimization passes. */
  refinementTypesAny: boolean;

  // -------- Validity surface (B11 + B12) --------
  /** Any compound-parent state-decl exists. Per primer §13.7 B11: synthesis
   *  is unconditional per §55.5/§55.6 predictability rule, so any
   *  compound-parent triggers the surface (even compound-parent without any
   *  validators in subtree synthesizes trivially-valid defaults). Conservative
   *  trigger: any `_cellKind === "compound-parent"`. */
  validitySurface: boolean;

  // -------- Render-spec / markup-typed --------
  /** Any state-decl with `shape === "decl-with-spec"` (Shape 2). */
  renderSpec: boolean;
  /** Any state-decl with `_cellKind === "markup-typed"` (Shape 3 markup-derived). */
  markupTypedDerived: boolean;

  // -------- Reset + default (§6.8, B22) --------
  /** Any `reset-expr` AST node. Captured via deep ExprNode walk. */
  reset: boolean;
  /** Any state-decl with `defaultExpr !== null`. */
  defaultExpr: boolean;

  // -------- Variant C compound (Tier 2 reactive proxy) --------
  /** Any state-decl with `children !== undefined` (compound parent). Same
   *  trigger as `validitySurface`, included as a separate flag for clarity
   *  (compound shapes drive distinct codegen paths beyond validity). */
  variantCCompound: boolean;

  // -------- Bare-variant inference (§14.10 / M9 / B20) --------
  /** Any IdentExpr with `name` matching `.UpperCase…` shape (bare-variant
   *  reference) — these compile-time desugar via B20. */
  bareVariantInference: boolean;

  // -------- typeAsArgument (parseVariant — L22 / future C22) --------
  /** Any parseVariant<T>(...) call site. Detection-stub returning false
   *  always until parseVariant Phase 2 lands; included for forward-compat
   *  per BRIEF §13 Q4. */
  typeAsArgument: boolean;

  // -------- <program> documentary attrs (§40.7 / C19) --------
  /** Any `<program>` markup with title/description/version/author/license attrs. */
  programDocAttrs: boolean;
}

// ---------------------------------------------------------------------------
// Skeleton constructors + merge
// ---------------------------------------------------------------------------

/**
 * Construct a `FeatureUsage` with every flag `false`.
 *
 * Used as the seed for OR-merge across files and as the starting point for
 * per-file analysis. A file's bitmap starts here and flips flags `true` as
 * the walker discovers feature use.
 */
export function emptyUsage(): FeatureUsage {
  return {
    validators: {
      req: false,
      "is some": false,
      length: false,
      pattern: false,
      min: false,
      max: false,
      gt: false,
      lt: false,
      gte: false,
      lte: false,
      eq: false,
      neq: false,
      oneOf: false,
      notIn: false,
    },
    engines: false,
    derivedEngines: false,
    engineHistory: false,
    engineInternalRules: false,
    engineOnTimeout: false,
    engineNested: false,
    onTransitionHooks: false,
    channels: false,
    refinementTypes: false,
    refinementTypesAny: false,
    validitySurface: false,
    renderSpec: false,
    markupTypedDerived: false,
    reset: false,
    defaultExpr: false,
    variantCCompound: false,
    bareVariantInference: false,
    typeAsArgument: false,
    programDocAttrs: false,
  };
}

/**
 * Construct a `FeatureUsage` with every flag `true`.
 *
 * Debug + safety-net constructor: emitting against `fullUsage()` produces the
 * full v0.next runtime (no elision). Used by tests and by emitters that want
 * to opt out of elision until consumers wire through.
 */
export function fullUsage(): FeatureUsage {
  return {
    validators: {
      req: true,
      "is some": true,
      length: true,
      pattern: true,
      min: true,
      max: true,
      gt: true,
      lt: true,
      gte: true,
      lte: true,
      eq: true,
      neq: true,
      oneOf: true,
      notIn: true,
    },
    engines: true,
    derivedEngines: true,
    engineHistory: true,
    engineInternalRules: true,
    engineOnTimeout: true,
    engineNested: true,
    onTransitionHooks: true,
    channels: true,
    refinementTypes: true,
    refinementTypesAny: true,
    validitySurface: true,
    renderSpec: true,
    markupTypedDerived: true,
    reset: true,
    defaultExpr: true,
    variantCCompound: true,
    bareVariantInference: true,
    typeAsArgument: true,
    programDocAttrs: true,
  };
}

/**
 * Pure functional OR-merge of two `FeatureUsage` records.
 *
 * Used by `analyzeAll` to combine per-file bitmaps into a per-app bitmap.
 * Soundness: any file marking a flag `true` flips the merged result `true`
 * (transitively-imported features propagate to the importer's bitmap).
 *
 * Pure: neither input is mutated; a fresh result is returned.
 */
export function mergeUsage(a: FeatureUsage, b: FeatureUsage): FeatureUsage {
  return {
    validators: {
      req: a.validators.req || b.validators.req,
      "is some": a.validators["is some"] || b.validators["is some"],
      length: a.validators.length || b.validators.length,
      pattern: a.validators.pattern || b.validators.pattern,
      min: a.validators.min || b.validators.min,
      max: a.validators.max || b.validators.max,
      gt: a.validators.gt || b.validators.gt,
      lt: a.validators.lt || b.validators.lt,
      gte: a.validators.gte || b.validators.gte,
      lte: a.validators.lte || b.validators.lte,
      eq: a.validators.eq || b.validators.eq,
      neq: a.validators.neq || b.validators.neq,
      oneOf: a.validators.oneOf || b.validators.oneOf,
      notIn: a.validators.notIn || b.validators.notIn,
    },
    engines: a.engines || b.engines,
    derivedEngines: a.derivedEngines || b.derivedEngines,
    engineHistory: a.engineHistory || b.engineHistory,
    engineInternalRules: a.engineInternalRules || b.engineInternalRules,
    engineOnTimeout: a.engineOnTimeout || b.engineOnTimeout,
    engineNested: a.engineNested || b.engineNested,
    onTransitionHooks: a.onTransitionHooks || b.onTransitionHooks,
    channels: a.channels || b.channels,
    refinementTypes: a.refinementTypes || b.refinementTypes,
    refinementTypesAny: a.refinementTypesAny || b.refinementTypesAny,
    validitySurface: a.validitySurface || b.validitySurface,
    renderSpec: a.renderSpec || b.renderSpec,
    markupTypedDerived: a.markupTypedDerived || b.markupTypedDerived,
    reset: a.reset || b.reset,
    defaultExpr: a.defaultExpr || b.defaultExpr,
    variantCCompound: a.variantCCompound || b.variantCCompound,
    bareVariantInference: a.bareVariantInference || b.bareVariantInference,
    typeAsArgument: a.typeAsArgument || b.typeAsArgument,
    programDocAttrs: a.programDocAttrs || b.programDocAttrs,
  };
}

// ---------------------------------------------------------------------------
// Per-file analysis — analyzeUsage(fileAST)
// ---------------------------------------------------------------------------

/** Loose AST-node alias used by the walker. The walker reads .kind + a small
 *  set of well-known fields; everything else is opaque. */
type ASTNode = Record<string, unknown>;

/** A file-AST shape compatible with the wider compiler pipeline. */
interface FileASTLike {
  filePath?: string;
  nodes?: unknown[];
  ast?: { nodes: unknown[] };
  [key: string]: unknown;
}

/** Validator-name set — frozen for O(1) membership probes inside the walker. */
const VALIDATOR_NAMES: ReadonlySet<string> = new Set(
  UNIVERSAL_CORE_PREDICATES.map((p) => p.name),
);

/**
 * Detect bare-variant identifiers (`.Variant` shape — §14.10 / M9 / B20).
 *
 * A bare-variant ident is `.` followed by an uppercase letter. Plain member
 * accesses (`obj.field`) are MemberExpr nodes, NOT IdentExpr — so an
 * IdentExpr whose `name` starts with `.` is unambiguously a bare-variant ref
 * by the parser's post-A5-2 grammar.
 *
 * Returns `true` when the IdentExpr is a bare-variant reference.
 */
function isBareVariantIdent(ident: IdentExpr): boolean {
  const name = ident.name;
  if (typeof name !== "string" || name.length < 2) return false;
  if (name.charCodeAt(0) !== 46 /* '.' */) return false;
  const c = name.charCodeAt(1);
  // Uppercase ASCII letters A-Z
  return c >= 65 && c <= 90;
}

/**
 * Detect parseVariant call-site (L22 type-as-argument family).
 *
 * STUB: returns `false` always. parseVariant Phase 2 has not landed at C0
 * dispatch time; when it lands, the detector replaces the body with a
 * structural pattern match against `parseVariant<T>(...)` call shapes.
 *
 * Per BRIEF §7.5/§8: no architectural collision — additive detector.
 */
function isParseVariantCall(_node: ASTNode): boolean {
  // No detection at C0; flag stays `false` until parseVariant Phase 2 lands.
  return false;
}

/**
 * Walk an ExprNode and update the bitmap for any feature uses found inside
 * the expression tree (resets, bare-variant idents, parseVariant calls).
 *
 * Reuses `forEachResetExprInExprNode` (canonical reset enumerator B22 uses)
 * and `forEachIdentInExprNode` (canonical IdentExpr enumerator).
 */
function walkExprForUsage(expr: ExprNode | undefined, usage: FeatureUsage): void {
  if (!expr) return;
  forEachResetExprInExprNode(expr, () => {
    usage.reset = true;
  });
  forEachIdentInExprNode(expr, (ident: IdentExpr) => {
    if (isBareVariantIdent(ident)) usage.bareVariantInference = true;
  });
}

/**
 * Walk an ExprNode and apply `walkExprForUsage` AND parseVariant detection.
 * Separated so future detectors that walk over CallExpr/etc. can plug in.
 */
function walkExprNode(expr: ExprNode | undefined, usage: FeatureUsage): void {
  walkExprForUsage(expr, usage);
}

/**
 * Recursively walk a list of AST nodes (markup children, logic body, compound
 * children, match arms, if branches) and fold structural feature uses into
 * the bitmap.
 *
 * Soundness: structural-AST-kind triggers throughout. When a kind is
 * recognized, the relevant flag fires regardless of B-step decoration
 * completeness.
 *
 * Recursion shape: descends through every container shape (children/body/
 * defChildren/consequent/alternate/arms[].body/state-decl.children).
 */
function walkUsage(nodeList: unknown, usage: FeatureUsage): void {
  if (!Array.isArray(nodeList)) return;

  for (const raw of nodeList) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as ASTNode;
    const kind = node.kind as string | undefined;

    // ---- Per-kind structural triggers ----

    if (kind === "markup") {
      const tag = node.tag as string | undefined;

      // Channels (§38, B19)
      if (tag === "channel") {
        usage.channels = true;
      }

      // <onTransition> hook markup (§51.0.J — A5-2 pre-tokenization may not
      // structurally recognize, but if a parser pass DOES tokenize it, we
      // see it here as a markup tag.)
      if (tag === "onTransition") {
        usage.onTransitionHooks = true;
      }

      // <program> documentary attrs (§40.7)
      if (tag === "program" && Array.isArray(node.attrs)) {
        for (const attr of node.attrs as ASTNode[]) {
          if (!attr || typeof attr !== "object") continue;
          const attrName = attr.name as string | undefined;
          if (
            attrName === "title" ||
            attrName === "description" ||
            attrName === "version" ||
            attrName === "author" ||
            attrName === "license"
          ) {
            usage.programDocAttrs = true;
            break;
          }
        }
      }

      // Recurse into markup children.
      if (Array.isArray(node.children)) walkUsage(node.children, usage);
      continue;
    }

    if (kind === "engine-decl") {
      // Engines (§51.0.A-C). Conservative: structural presence.
      usage.engines = true;

      // PARSER-LEVEL FIELDS (always present post-buildAST — independent of
      // SYM) — read first per soundness > completeness.

      // Derived engines (§51.0.J) — `sourceVar` is the legacy parser field;
      // present iff `derived=` was on the engine opener.
      if (typeof node.sourceVar === "string" && (node.sourceVar as string).length > 0) {
        usage.derivedEngines = true;
      }
      // §51.0.P (S68 ratification, STRUCK 2026-05-08): the engineParallel
      // flag was removed alongside the spec strike. The §51.4 multi-engine
      // pattern (two file-scope `<engine>` declarations) IS the parallel
      // pattern and requires no per-engine flag.

      // SYM-LEVEL FIELDS (post-PASS 10.A registration; provides A5-3
      // file-scope aggregations of state-child temporal data). Reading these
      // is defensive — when SYM has not run on this engine (e.g., engine
      // inside `<program>` markup may not flow through PASS 10.A's
      // file-scope-only walker today), the parser-level fields above plus
      // the rulesRaw substring scan below still surface the flags.
      const record = node._record as { engineMeta?: Record<string, unknown> } | undefined;
      const engineMeta = record?.engineMeta;
      if (engineMeta) {
        if (engineMeta.derivedExpr != null) usage.derivedEngines = true;
        if (engineMeta.historyAttr === true) usage.engineHistory = true;
        const internalRules = engineMeta.internalRules as unknown[] | undefined;
        if (Array.isArray(internalRules) && internalRules.length > 0) {
          usage.engineInternalRules = true;
        }
        const onTimeouts = engineMeta.onTimeoutElements as unknown[] | undefined;
        if (Array.isArray(onTimeouts) && onTimeouts.length > 0) {
          usage.engineOnTimeout = true;
        }
        const inner = engineMeta.innerEngines as unknown[] | undefined;
        if (Array.isArray(inner) && inner.length > 0) usage.engineNested = true;

        // Walk stateChildren entries (B15 PASS 11 populates these).
        const stateChildren = engineMeta.stateChildren as ASTNode[] | undefined;
        if (Array.isArray(stateChildren)) {
          for (const sc of stateChildren) {
            if (!sc || typeof sc !== "object") continue;
            if (sc.historyAttr === true) usage.engineHistory = true;
            const rule = sc.internalRule as { kind?: string } | undefined;
            if (rule && rule.kind && rule.kind !== "absent") {
              usage.engineInternalRules = true;
            }
            const ots = sc.onTimeoutElements as unknown[] | undefined;
            if (Array.isArray(ots) && ots.length > 0) usage.engineOnTimeout = true;
            const ies = sc.innerEngines as unknown[] | undefined;
            if (Array.isArray(ies) && ies.length > 0) usage.engineNested = true;
          }
        }
      }

      // RULESRAW SUBSTRING FALLBACK — when SYM hasn't populated stateChildren
      // (e.g., engines inside `<program>` markup that PASS 10.A's file-scope
      // walker may not register), fall back to a substring scan of the raw
      // engine body. Soundness > completeness — false-positives bloat,
      // false-negatives crash. The substring scan is conservative: any
      // mention of `history`, `internal:rule`, `<onTimeout`, or nested
      // `<engine` triggers the corresponding flag.
      const rulesRaw = node.rulesRaw;
      if (typeof rulesRaw === "string" && rulesRaw.length > 0) {
        // history bareword on a state-child opener — match "<Variant history "
        // or "<Variant history>" or "<Variant history\n" / "<Variant history\t"
        // to avoid false-matching "history" inside string literals (best-effort
        // — over-inclusion is acceptable per §11.2 soundness).
        if (/\bhistory[\s>\/]/.test(rulesRaw)) usage.engineHistory = true;
        if (rulesRaw.includes("internal:rule")) usage.engineInternalRules = true;
        if (rulesRaw.includes("<onTimeout")) usage.engineOnTimeout = true;
        // Nested engines: `<engine` inside the body (we're already inside the
        // outer engine's rulesRaw, so any `<engine` is a nested decl).
        if (rulesRaw.includes("<engine")) usage.engineNested = true;
      }

      // Engine-decls may also have walkable children (forward-compat); descend.
      if (Array.isArray(node.children)) walkUsage(node.children, usage);
      continue;
    }

    if (kind === "state-decl") {
      // Validators (per-predicate flags; SPEC §55.1)
      const validators = node.validators as ASTNode[] | undefined;
      if (Array.isArray(validators)) {
        for (const v of validators) {
          if (!v || typeof v !== "object") continue;
          const vname = v.name as string | undefined;
          if (typeof vname === "string" && VALIDATOR_NAMES.has(vname)) {
            (usage.validators as Record<string, boolean>)[vname] = true;
          }
        }
      }

      // Shape 2 / Shape 3 / compound-parent / refinement-type / default
      const shape = node.shape as string | undefined;
      const cellKind = node._cellKind as string | undefined;

      if (shape === "decl-with-spec") usage.renderSpec = true;
      if (cellKind === "markup-typed") usage.markupTypedDerived = true;

      if (Array.isArray(node.children)) {
        usage.variantCCompound = true;
        // Conservative: any compound-parent triggers validity-surface (B11/B12
        // unconditionally synthesize per §55.5/§55.6 predictability rule).
        usage.validitySurface = true;
      }
      if (cellKind === "compound-parent") {
        usage.validitySurface = true;
      }

      if (node.defaultExpr != null) usage.defaultExpr = true;

      // §53 three-zone refinement (B21). Boundary zone is the only one
      // emitting runtime; any zone classification implies a §53 predicate
      // exists (refinementTypesAny).
      const predicateCheck = node.predicateCheck as { zone?: string } | undefined;
      if (predicateCheck && typeof predicateCheck.zone === "string") {
        usage.refinementTypesAny = true;
        if (predicateCheck.zone === "boundary") usage.refinementTypes = true;
      }

      // Walk initializer ExprNode (resets, bare-variant refs).
      walkExprNode(node.initExpr as ExprNode | undefined, usage);
      // Walk default expression (resets, bare-variant refs).
      walkExprNode(node.defaultExpr as ExprNode | undefined, usage);
      // Walk renderSpec sub-node's nested children (Shape 2 markup form).
      const renderSpec = node.renderSpec as ASTNode | undefined;
      if (renderSpec && Array.isArray(renderSpec.children)) {
        walkUsage(renderSpec.children, usage);
      }

      // Recurse into compound children.
      if (Array.isArray(node.children)) walkUsage(node.children, usage);
      continue;
    }

    if (kind === "logic") {
      // Logic-block body — descend into statements (for state-decls, function
      // bodies, control-flow blocks containing further state-decls/engines).
      if (Array.isArray(node.body)) walkUsage(node.body, usage);
      continue;
    }

    // ---- Logic-block statement kinds (let/const/tilde decls, control flow) ----

    if (kind === "let-decl" || kind === "const-decl" || kind === "tilde-decl" || kind === "lin-decl") {
      walkExprNode(node.initExpr as ExprNode | undefined, usage);
      // §53 three-zone refinement-type predicates land on let/const-decls
      // too (B21 §B21.8 — same three-zone semantics). Pick them up here.
      const predicateCheck = node.predicateCheck as { zone?: string } | undefined;
      if (predicateCheck && typeof predicateCheck.zone === "string") {
        usage.refinementTypesAny = true;
        if (predicateCheck.zone === "boundary") usage.refinementTypes = true;
      }
      continue;
    }

    if (kind === "function-decl" || kind === "component-def") {
      if (Array.isArray(node.body)) walkUsage(node.body, usage);
      // Some function-shape nodes carry `children` (component bodies).
      if (Array.isArray(node.children)) walkUsage(node.children, usage);
      continue;
    }

    if (kind === "if-stmt") {
      if (Array.isArray(node.consequent)) walkUsage(node.consequent, usage);
      if (Array.isArray(node.alternate)) walkUsage(node.alternate, usage);
      walkExprNode(node.test as ExprNode | undefined, usage);
      continue;
    }

    if (kind === "for-stmt" || kind === "while-stmt") {
      if (Array.isArray(node.body)) walkUsage(node.body, usage);
      continue;
    }

    if (kind === "switch-stmt") {
      const arms = node.arms as ASTNode[] | undefined;
      if (Array.isArray(arms)) {
        for (const arm of arms) {
          if (arm && Array.isArray(arm.body)) walkUsage(arm.body, usage);
        }
      }
      continue;
    }

    if (kind === "match-stmt" || kind === "match-arm-block") {
      const arms = node.arms as ASTNode[] | undefined;
      if (Array.isArray(arms)) {
        for (const arm of arms) {
          if (arm && Array.isArray(arm.body)) walkUsage(arm.body, usage);
        }
      }
      // match-stmt may also have `subject`/`scrutinee` ExprNode.
      walkExprNode(node.subject as ExprNode | undefined, usage);
      walkExprNode(node.scrutinee as ExprNode | undefined, usage);
      continue;
    }

    if (kind === "try-stmt") {
      if (Array.isArray(node.body)) walkUsage(node.body, usage);
      if (Array.isArray(node.errorArms)) walkUsage(node.errorArms, usage);
      continue;
    }

    if (kind === "return-stmt" || kind === "throw-stmt") {
      walkExprNode(node.argument as ExprNode | undefined, usage);
      walkExprNode(node.expr as ExprNode | undefined, usage);
      continue;
    }

    if (kind === "bare-expr") {
      // BareExprNode uses `exprNode` (the structured form). The legacy
      // `expr: string` field is no longer in the TS surface but may exist on
      // the runtime object via duck-typing — we read both.
      walkExprNode(node.exprNode as ExprNode | undefined, usage);
      continue;
    }

    if (kind === "reactive-explicit-set" || kind === "reactive-debounced-decl") {
      walkExprNode(node.initExpr as ExprNode | undefined, usage);
      walkExprNode(node.value as ExprNode | undefined, usage);
      walkExprNode(node.expr as ExprNode | undefined, usage);
      continue;
    }

    if (kind === "when-effect" || kind === "when-message") {
      walkExprNode(node.bodyExpr as ExprNode | undefined, usage);
      continue;
    }

    if (kind === "transaction-block") {
      if (Array.isArray(node.body)) walkUsage(node.body, usage);
      continue;
    }

    // ---- parseVariant detection (currently a no-op stub) ----
    if (isParseVariantCall(node)) usage.typeAsArgument = true;

    // ---- Generic structural fall-through: descend into common containers ----
    if (Array.isArray(node.children)) walkUsage(node.children, usage);
    if (Array.isArray(node.body)) walkUsage(node.body, usage as FeatureUsage);
  }
}

/**
 * Per-file feature-usage analysis.
 *
 * Walks the file AST once, accumulating structural feature uses into a fresh
 * `FeatureUsage` bitmap. Read-only on the AST.
 *
 * Per `analyze.ts`'s convention, the FileAST's nodes live at either
 * `fileAST.nodes` (current) or `fileAST.ast.nodes` (legacy). Both shapes are
 * accepted.
 */
export function analyzeUsage(fileAST: FileASTLike): FeatureUsage {
  const usage = emptyUsage();
  const nodes: unknown[] = Array.isArray(fileAST?.nodes)
    ? fileAST.nodes
    : Array.isArray(fileAST?.ast?.nodes)
    ? fileAST.ast.nodes
    : [];
  walkUsage(nodes, usage);
  return usage;
}
