/**
 * Type System — Stage 6 of the scrml compiler pipeline (TS).
 *
 * Sub-stages implemented here:
 *   TS-A  Scope chain construction + identifier resolution
 *   TS-B  Type registry + struct/enum resolution + DB-schema-derived types + state type registry
 *   TS-C  Pattern matching exhaustiveness (checkEnumExhaustiveness, checkUnionExhaustiveness)
 *   TS-F  Pure function purity constraint verification
 *   TS-G  Linear type enforcement (lin + ~)
 *
 * Sub-stages NOT implemented here (deferred):
 *   TS-D  Component shape checking
 *   TS-H  Meta block type checking
 *
 * Input:
 *   { files: FileAST[], protectAnalysis: ProtectAnalysis, routeMap: RouteMap }
 *
 * Output:
 *   { files: TypedFileAST[], errors: TSError[] }
 *
 * TypedFileAST = FileAST & {
 *   nodeTypes:       Map<NodeId, ResolvedType>,
 *   componentShapes: Map<string, ComponentShape>,
 *   scopeChain:      ScopeChain,
 * }
 *
 * The type registry is a Map<string, TypeDef> — a simple lookup table.
 * No type inference. No unification. Types come from declarations and db schema only.
 *
 * Error codes produced:
 *   E-SCOPE-001  Unquoted identifier attribute value cannot be resolved in current scope
 *   E-TYPE-004   Struct field does not exist on type
 *   E-TYPE-006   Non-exhaustive match over union type (missing member)
 *   E-TYPE-020   Non-exhaustive match over enum type (missing variant)
 *   E-TYPE-023   Duplicate arm for the same variant
 *   E-TYPE-050   Two tables (or a table + user type) produce the same generated type name
 *   E-TYPE-051   ColumnDef.sqlType not mappable; typed asIs (warning)
 *   E-TYPE-052   InitCap algorithm produces an invalid scrml identifier from a table name
 *   W-MATCH-001  Redundant wildcard arm when all variants already covered (warning)
 *   E-LIN-001    lin variable not consumed before scope exit
 *   E-LIN-002    lin variable consumed more than once (or inside a loop)
 *   E-LIN-003    lin variable consumed in some branches but not others
 *   E-MARKUP-002 Known attribute with wrong type on markup element
 *   E-MARKUP-003 Unknown attribute on HTML element (warning for data- and aria- prefixed)
 *   E-STATE-004  Unknown attribute on user-defined state type
 *   E-STATE-005  State type name collides with HTML element name
 *   E-STATE-006  Duplicate state type definition
 *   E-MU-001     tilde-decl variable declared but never used before scope exit
 *   E-TILDE-001  ~ read without initialization
 *   E-TILDE-002  ~ reinitialized without consumption (or unconsumed at scope exit)
 *   E-TYPE-081   `partial match` in rendering or lift context
 *   E-ERROR-001  fail used in non-! function
 *   E-ERROR-002  ! function result not handled (no match, ?, !{}, or boundary)
 *   E-ERROR-003  ? propagation used in non-! function
 *   E-ERROR-004  ? applied to non-! function call (callee is known non-failable)
 *   E-ERROR-008  User-defined error type declares reserved field 'message' or 'type'
 *   E-CONTRACT-001  §53 Inline predicate constraint violated at compile time
 *   E-CONTRACT-002  §53 Named shape not found in registry
 *   E-CONTRACT-003  §53 Predicate references external reactive variable
 *   E-ENGINE-010  §51.2 'given' guard in type-level transitions block (not permitted)
 *   E-ENGINE-004  §51.2 Transition rule references unknown variant name
 *
 * What TS does NOT do (this file):
 *   - No code generation.
 *   - No async scheduling or dependency graph construction.
 *   - No SQL query execution or validation.
 *   - No route assignment (consumed from RouteMap).
 *   - No BareExpr body resolution (completed by BPP).
 *   - No meta block type checking (TS-H).
 *
 * Performance budget: <= 20 ms per file.
 */

import { getElementShape, getAllElementNames } from "./html-elements.js";
import { forEachIdentInExprNode, forEachCallInExprNode, classifyLiteralFromExprNode, exprNodeContainsCall, emitStringFromTree } from "./expression-parser.ts";

// ---------------------------------------------------------------------------
// Engine state-child grammar metadata (S81 Phase A10 follow-on)
// ---------------------------------------------------------------------------
//
// These constants are duplicated from `compiler/src/codegen/emit-variant-guard.ts`
// (`ENGINE_STATE_CHILD_RESERVED_ATTRS`, `STATE_CHILD_STRUCTURAL_TAGS`,
// `extractPayloadBindingsFromAttrs`) because TS is upstream of codegen — TS
// cannot import from `./codegen/*`. Both consumers describe the same grammar:
// the set of state-child opener attrs that are reserved by the engine surface
// (rule/history/internal:rule/effect) vs. payload-binding barewords, and the
// set of structural-element tags that may appear inside a state-child body
// but are NOT renderable markup.
//
// TODO (post-S81): when `EngineStateChildEntry.payloadBindings` is populated
// by SYM PASS 11 (B15 walker) per primer §13.7, both consumers can be
// retired in favor of reading `entry.payloadBindings` directly, and the
// structural-tag set can move to a shared `engine-statechild-grammar.ts`
// module. For now the duplication is deliberate + minimized.

const TS_ENGINE_STATE_CHILD_RESERVED_ATTRS = new Set<string>([
  "rule",
  "history",
  "internal:rule",
  "effect",
]);

const TS_STATE_CHILD_STRUCTURAL_TAGS = new Set<string>([
  "onTimeout",
  "onTransition",
  "onIdle",
  "engine",
  "machine",
]);

// §51.0.B.1 — local-identifier shape (mirror of parsePayloadBindings'
// validation regex in engine-statechild-parser.ts). Used to filter out
// non-identifier attribute names that may slip into the TAB-stage attr list
// for unusual openers (e.g., the parenthesized named-with-colon form
// `<Done(rows: r)>` — the block-splitter records `rows:` and `r` as two
// separate bareword attrs; the trailing-colon name is not a valid scope
// binding and must be skipped).
const TS_ENGINE_PAYLOAD_BINDING_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// B1-FUP (S99) — payload-binding scope extraction from engine state-child
// opener attrs. Recognizes the three SPEC §51.0.B.1 forms:
//
//   1. Bare-attribute / parenthesized form (positional) — attrs[i] =
//      { name: "rows", value: { kind: "absent" } }. Local name = attr name.
//   2. Named form — attrs[i] = { name: "rows", value: { kind:
//      "variable-ref", name: "r" } }. Local name = value name (the RHS
//      identifier introduced into scope), NOT the field name. Per
//      §51.0.B.1 normative bullet 2: "Bindings introduced by any of the
//      three forms SHALL be in scope throughout the state-child body".
//
// Reserved attribute names (`rule`, `effect`, `history`, `internal:rule`)
// are skipped regardless of value shape — per §51.0.B.1 reserved-name
// precedence. Non-identifier names (e.g., `rows:` from the parenthesized-
// named-with-colon block-splitter shape) are filtered to avoid scope
// pollution. The canonical engine-statechild-parser (PASS 11) is the
// authoritative source for binding validity; this helper performs the
// minimum extraction needed to introduce the local names into TS scope.
function extractEngineStateChildPayloadBindings(attrs: unknown): string[] {
  if (!Array.isArray(attrs)) return [];
  const out: string[] = [];
  for (const a of attrs) {
    if (!a || typeof a !== "object") continue;
    const name = (a as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    if (TS_ENGINE_STATE_CHILD_RESERVED_ATTRS.has(name)) continue;
    const value = (a as { value?: unknown }).value;
    if (!value || typeof value !== "object") continue;
    const valueKind = (value as { kind?: unknown }).kind;
    if (valueKind === "absent") {
      // Positional / parenthesized form — local is the attr name itself.
      if (TS_ENGINE_PAYLOAD_BINDING_IDENT_RE.test(name)) {
        out.push(name);
      }
      continue;
    }
    if (valueKind === "variable-ref") {
      // Named form `<Done rows=r>` or `<Done (rows=r)>` — local is the
      // RHS identifier (the variable-ref name), NOT the field-side LHS.
      // The field name (attr name) must itself be a valid identifier
      // (filters out unusual block-splitter shapes like `rows:`).
      const refName = (value as { name?: unknown }).name;
      if (
        typeof refName === "string" &&
        TS_ENGINE_PAYLOAD_BINDING_IDENT_RE.test(refName) &&
        TS_ENGINE_PAYLOAD_BINDING_IDENT_RE.test(name)
      ) {
        out.push(refName);
      }
      continue;
    }
    // Any other value kind (string-literal, logic-block, etc.) is not a
    // payload binding — adopter has used the attr surface for a non-
    // binding attribute (e.g., custom user attr). Skip silently.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal span type (mirrors ast.ts Span)
// ---------------------------------------------------------------------------

interface Span {
  file: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

// ---------------------------------------------------------------------------
// ResolvedType discriminated union
// ---------------------------------------------------------------------------

interface PrimitiveType {
  kind: "primitive";
  name: string;
}

interface StructType {
  kind: "struct";
  name: string;
  fields: Map<string, ResolvedType>;
}

interface EnumType {
  kind: "enum";
  name: string;
  variants: VariantDef[];
  // §51.2 — null means no transitions block (unrestricted enum)
  transitionRules: TransitionRule[] | null;
}

interface ArrayType {
  kind: "array";
  element: ResolvedType;
}

interface UnionType {
  kind: "union";
  members: ResolvedType[];
}

interface AsIsType {
  kind: "asIs";
  constraint: ResolvedType | null;
}

interface UnknownType {
  kind: "unknown";
}

// §42 — absence value type (replaces null/undefined in scrml source)
interface NotType {
  kind: "not";
}

// §14.9 — deferred parameterisable markup fragment
interface SnippetType {
  kind: "snippet";
  paramType: ResolvedType | null;  // null for zero-parameter snippet
  optional: boolean;
}

interface TransitionInfo {
  name: string;
  paramsRaw: string;        // verbatim params between `(` and `)` — parsed on demand by Phase 4e
  targetSubstate: string;
  span: Span;
}

interface StateType {
  kind: "state";
  name: string;
  attributes: Map<string, AttributeShapeDef>;
  isHtml: boolean;
  rendersToDom: boolean;
  constructorBody: ASTNodeLike[] | null;
  // §52 State Authority
  authority?: "server" | "local";
  tableName?: string | null;
  // §54.2 Substate relationships (added 2026-04-20, S32 Phase 3b)
  // parentState: if set, this type is a substate of the named parent state.
  // substates: if set, the names of this type's declared substates.
  parentState?: string;
  substates?: Set<string>;
  // §54.3 State-local transitions (added 2026-04-20, S32 Phase 4c)
  // transitions: if set, the declared outgoing transitions keyed by name.
  transitions?: Map<string, TransitionInfo>;
}

interface ErrorType {
  kind: "error";
  name: string;
  fields: Map<string, ResolvedType>;
}

interface HtmlElementType {
  kind: "html-element";
  tag: string;
  attrs: Record<string, unknown>;
}

interface CssClassType {
  kind: "cssClass";
}

interface FunctionType {
  kind: "function";
  name: string;
  params: unknown[];
  returnType: ResolvedType;
}

interface MetaSpliceType {
  kind: "meta-splice";
  resultType: ResolvedType;
  parentContext: string;
}

interface RefBindingType {
  kind: "ref-binding";
  resolvedType: ResolvedType;
  domInterface: string;
}

// ---------------------------------------------------------------------------
// §53 — Inline Type Predicates
// ---------------------------------------------------------------------------

// Predicate expression — recursive representation of the boolean expression
// inside the outer parens of a predicated type annotation.
interface PredicateExpr {
  kind: "comparison" | "property" | "named-shape" | "and" | "or" | "not" | "error";
  op?: string;               // comparison / property
  value?: number | string;   // comparison / property
  prop?: string;             // property
  name?: string;             // named-shape
  left?: PredicateExpr;      // and / or
  right?: PredicateExpr;     // and / or
  operand?: PredicateExpr;   // not
  message?: string;          // error
  hasExternalRef?: boolean;  // set when predicate references @identifier
}

interface PredicatedType {
  kind: "predicated";
  baseType: "number" | "string" | "boolean" | "integer";
  predicate: PredicateExpr;
  label: string | null;
}

type ResolvedType =
  | PrimitiveType
  | StructType
  | EnumType
  | ArrayType
  | UnionType
  | AsIsType
  | UnknownType
  | StateType
  | ErrorType
  | HtmlElementType
  | CssClassType
  | FunctionType
  | MetaSpliceType
  | RefBindingType
  | NotType
  | SnippetType
  | PredicatedType;

// ---------------------------------------------------------------------------
// Variant definition
// ---------------------------------------------------------------------------

interface VariantDef {
  name: string;
  payload: Map<string, ResolvedType> | null;
  renders: { markup: string } | null;
}

// §51.3 — Machine type (named override graph for an enum/struct type)
interface MachineType {
  kind: "machine";
  name: string;                  // machine name (PascalCase)
  governedTypeName: string;      // the enum or struct type this governs
  governedType: ResolvedType | null; // resolved after registry lookup
  rules: TransitionRule[];       // machine-level rules (guards permitted)
  // §51.9 (S22) — when set, this is a DERIVED / projection machine. The
  // `rules` above are projection-rules (single variant-ref RHS, evaluated at
  // read time) rather than transition-rules. `sourceVar` is the name of the
  // reactive variable this machine projects from (without a leading `@`).
  // `projectedVarName` is the compiler-synthesized name of the projected
  // reactive — typically the machine name lowercased (e.g., `UI` → `ui`).
  isDerived?: boolean;
  sourceVar?: string | null;
  projectedVarName?: string | null;
  // §51.11 (S24) — Optional `audit @name` clause at the end of the machine
  // body. When set, every successful transition appends an audit entry
  // (shape: {from, to, at}) to the named reactive variable. The name is
  // stored WITHOUT the leading `@` to match how other @-refs are keyed.
  // Validated at registration time (E-ENGINE-019) against the set of
  // declared reactives — resolution happens in the caller's post-pass
  // since @-decl registration isn't complete at buildMachineRegistry time.
  auditTarget?: string | null;
}

// §51.3.2 (S22) — Resolved payload binding in a machine rule.
// Each entry binds a local name `localName` to the `fieldName` of the variant's
// payload object. Discard (`_`) bindings are dropped at parse time and do not
// appear here. Positional bindings in the source are resolved to the declared
// field name before reaching this struct, so codegen can emit straight
// `var <localName> = __prev.data.<fieldName>` statements.
interface RuleBinding {
  localName: string;
  fieldName: string;
}

// §51.2 — Transition rule (from a type-level transitions {} block inside an enum)
interface TransitionRule {
  from: string;         // variant name (without leading dot/::), or "*" for wildcard
  to: string;           // variant name (without leading dot/::), or "*" for wildcard
  guard: string | null; // type-level: always null (guards → E-ENGINE-010)
  label: string | null; // optional [label] suffix
  effectBody: string | null; // raw effect block body (Phase 3B+)
  // §51.3.2 (S22) — payload bindings resolved against the governed enum type.
  // null when the rule had no binding-group on that side. For unit-variant
  // wildcard rules (`* => *`), always null.
  fromBindings: RuleBinding[] | null;
  toBindings: RuleBinding[] | null;
  // §51.12 (S25) — temporal transition. When non-null, the rule fires
  // automatically via setTimeout `afterMs` milliseconds after the machine-
  // bound variable enters `from`. Re-entering `from` during the window
  // resets the timer (XState parity, per deep-dive default). Cancelled
  // when the variable leaves `from` via any other transition.
  afterMs: number | null;
  // §51.12.3.1 (S67) — computed-delay form. When non-null, the rule fires
  // after a runtime-computed duration; codegen wraps the expression in an
  // IIFE that clamps negative/NaN to 0 (per spec). Mutually exclusive with
  // afterMs — exactly ONE of {afterMs, afterExpr} is non-null for a temporal
  // rule, both are null for non-temporal rules. The afterExpr text is the
  // FULL computed-form JS expression INCLUDING the unit multiplier
  // (e.g. for `${@x}s` the stored text is `(@x) * 1000`); codegen emits it
  // as-is inside the IIFE. Reactive reads (@var) are LEFT UNREWRITTEN here
  // — codegen calls rewriteExpr on it at emit time so `_scrml_reactive_get`
  // wires correctly.
  afterExpr: string | null;
}

// ---------------------------------------------------------------------------
// Attribute shape definition (for state types)
// ---------------------------------------------------------------------------

interface AttributeShapeDef {
  type: string;
  required: boolean;
  default: unknown;
}

// ---------------------------------------------------------------------------
// Scope entry
// ---------------------------------------------------------------------------

interface ScopeEntry {
  kind: string;
  resolvedType: ResolvedType;
  isPure?: boolean;
  fullType?: ResolvedType;
  clientType?: ResolvedType;
  domInterface?: string;
  /**
   * §35 E-LIN-005: set to true on lin-decl / lin-annotated param bindings so
   * downstream let/const/lin declarations in child scopes can detect shadowing.
   */
  isLin?: boolean;
}

// ---------------------------------------------------------------------------
// Generic AST node (opaque — we only use duck-typed fields)
// ---------------------------------------------------------------------------

type ASTNodeLike = Record<string, unknown> & { kind?: string; span?: Span; id?: number };

// ---------------------------------------------------------------------------
// Input/output types
// ---------------------------------------------------------------------------

interface FileAST extends Record<string, unknown> {
  filePath: string;
  nodes?: ASTNodeLike[];
  typeDecls?: ASTNodeLike[];
}

interface ProtectAnalysis {
  views: Map<string, DBTypeViews>;
}

interface DBTypeViews {
  stateBlockId?: string;
  dbPath?: string;
  tables: Map<string, TableTypeView>;
}

interface TableTypeView {
  tableName?: string;
  fullSchema?: ColumnDef[];
  clientSchema?: ColumnDef[];
  protectedFields?: Set<string>;
}

interface ColumnDef {
  name: string;
  sqlType: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
}

interface RouteMap {
  // A9-Ext-4 D2 (2026-05-08): cpsSplit field added so type-system can detect
  // CPS-eligible functions and treat them as implicitly `!`-typed (failable).
  // The full structure of cpsSplit is in route-inference.ts CPSSplit; the type
  // here is loosely-typed because we only need to know whether it's non-null.
  functions: Map<string, { boundary: "server" | "client"; cpsSplit?: unknown | null }>;
}

interface TypedFileAST extends FileAST {
  nodeTypes: Map<string, ResolvedType>;
  componentShapes: Map<string, unknown>;
  scopeChain: ScopeChain;
  stateTypeRegistry: Map<string, ResolvedType>;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class TSError {
  code: string;
  message: string;
  span: Span;
  severity: "error" | "warning";

  constructor(
    code: string,
    message: string,
    span: Span,
    severity: "error" | "warning" = "error",
  ) {
    this.code = code;
    this.message = message;
    this.span = span;
    this.severity = severity;
  }
}

// ---------------------------------------------------------------------------
// ResolvedType constructors
//
// These are plain objects — no class hierarchy. Discriminated by `.kind`.
// ---------------------------------------------------------------------------

function tPrimitive(name: string): PrimitiveType {
  return { kind: "primitive", name };
}

function tStruct(name: string, fields: Map<string, ResolvedType>): StructType {
  return { kind: "struct", name, fields };
}

function tEnum(name: string, variants: VariantDef[], transitionRules: TransitionRule[] | null = null): EnumType {
  return { kind: "enum", name, variants, transitionRules };
}

function tArray(element: ResolvedType): ArrayType {
  return { kind: "array", element };
}

function tUnion(members: ResolvedType[]): UnionType {
  return { kind: "union", members };
}

function tAsIs(constraint: ResolvedType | null = null): AsIsType {
  return { kind: "asIs", constraint };
}

function tUnknown(): UnknownType {
  return { kind: "unknown" };
}

// §42 — absence value constructor
function tNot(): NotType {
  return { kind: "not" };
}

// §53 — predicated type constructor
function tPredicated(
  baseType: "number" | "string" | "boolean" | "integer",
  predicate: PredicateExpr,
  label: string | null = null,
): PredicatedType {
  return { kind: "predicated", baseType, predicate, label };
}

// §14.9 — snippet constructor
function tSnippet(paramType: ResolvedType | null = null, optional: boolean = false): SnippetType {
  return { kind: "snippet", paramType, optional };
}

/**
 * State type — a named, typed record that defines the shape of a markup scope.
 * Per §35.1: HTML elements are pre-defined state types; user-defined state types
 * use the same mechanism.
 */
function tState(
  name: string,
  attributes: Map<string, AttributeShapeDef>,
  isHtml = false,
  rendersToDom = false,
  constructorBody: ASTNodeLike[] | null = null,
  authority?: "server" | "local",
  tableName?: string | null,
  parentState?: string,
  transitions?: Map<string, TransitionInfo>,
): StateType {
  return {
    kind: "state", name, attributes, isHtml, rendersToDom, constructorBody,
    authority, tableName,
    ...(parentState ? { parentState } : {}),
    ...(transitions && transitions.size > 0 ? { transitions } : {}),
  };
}

function tError(name: string, fields: Map<string, ResolvedType>): ErrorType {
  return { kind: "error", name, fields };
}

// ---------------------------------------------------------------------------
// Built-in types
//
// These are always present in the global scope. The type registry is seeded
// with these before any file is processed.
// ---------------------------------------------------------------------------

const BUILTIN_TYPES: Map<string, ResolvedType> = new Map([
  ["number",    tPrimitive("number")],
  ["string",    tPrimitive("string")],
  ["boolean",   tPrimitive("boolean")],
  ["bool",      tPrimitive("boolean")],  // alias
  ["integer",   tPrimitive("integer")],   // §53 base-type (maps to number at runtime)
  // S109 — date/timestamp as first-class primitive types for the
  // structural-walk L22 family (formFor / schemaFor / tableFor v1.next
  // item #5 per docs/changes/tableFor-impl/PROGRESS.md). Pre-S109
  // adopters could write `when: date` in struct fields and the typer would
  // accept it silently via fallback (date is also in NAMED_SHAPES with
  // baseType=string → predicated path), but `timestamp` had NO formal
  // registration and only the downstream switch statements in emit-table-for.ts
  // (`mapPrimitiveToCellKind`) + emit-schema-for.ts (`mapPrimitiveToColumnType`)
  // recognized it. Formalizing here ensures consistent typer behavior + makes
  // the supported field-type vocabulary visible to introspection.
  //
  // Runtime semantics: both are surface-string-shaped (ISO-8601 date strings
  // for `date`; ISO-8601 timestamp strings for `timestamp`). schemaFor lowers
  // them to SQL DDL `date` / `timestamp` column types. tableFor renders them
  // as text cells (with future v1.next refinement for locale-aware display).
  ["date",      tPrimitive("date")],
  ["timestamp", tPrimitive("timestamp")],
  // S90 M-7C-D-12 Track 1 (D-12.1e): `null` removed from BUILTIN_TYPES so
  // user type annotations cannot resolve `:null`. Canonical absence type is
  // `not` (§42). The internal `tPrimitive("null")` is still used by the
  // typer for JS-host-type constructions (e.g., DOM ref bindings yield
  // `Element | null` at the JS host level — see ref= narrowing below).
  ["asIs",    tAsIs()],
  ["not",     tNot()],             // §42 absence value
  // §19 Built-in error types — always available without import
  ["NetworkError",    tError("NetworkError",    new Map())],
  ["ValidationError", tError("ValidationError", new Map())],
  ["SQLError",        tError("SQLError",        new Map())],
  ["AuthError",       tError("AuthError",       new Map())],
  ["TimeoutError",    tError("TimeoutError",    new Map())],
  // §41.13 — ParseError is the canonical failure-type for parseVariant
  // (Path A, L22). It is also exported from `stdlib/data/parse.scrml` for
  // explicit `import { ParseError } from 'scrml:data'` use, but registering
  // it here as a built-in :enum (with the four canonical variants) ensures
  // that `!{}` exhaustiveness checks against parseVariant calls resolve the
  // type even when the importing file doesn't repeat the import — and dodges
  // the stdlib re-export-chase gap (api.js importedTypes seeder reads the
  // dep file's own typeDecls, not those re-exported via index.scrml).
  ["ParseError",      tEnum("ParseError", [
    { name: "MissingDiscriminator", payload: null, renders: null },
    { name: "UnknownVariant",       payload: new Map([["tag",    tPrimitive("string")]]), renders: null },
    { name: "InvalidPayload",       payload: new Map([["field",  tPrimitive("string")], ["reason", tPrimitive("string")]]), renders: null },
    { name: "Malformed",            payload: new Map([["reason", tPrimitive("string")]]), renders: null },
  ])],
  ["NotFoundError",   tError("NotFoundError",   new Map())],
  ["ConflictError",   tError("ConflictError",   new Map())],
]);

// ---------------------------------------------------------------------------
// §53.6 Named Shape Registry
// ---------------------------------------------------------------------------

interface NamedShape {
  baseType: "string";
  htmlType?: string;  // HTML input type= attribute
  pattern?: string;   // HTML pattern= regex (informative)
}

const NAMED_SHAPES: Map<string, NamedShape> = new Map([
  ["email", { baseType: "string", htmlType: "email" }],
  ["url",   { baseType: "string", htmlType: "url" }],
  ["uuid",  { baseType: "string", pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" }],
  ["phone", { baseType: "string", htmlType: "tel" }],
  ["date",  { baseType: "string", htmlType: "date" }],
  ["time",  { baseType: "string", htmlType: "time" }],
  ["color", { baseType: "string", htmlType: "color" }],
]);

// ---------------------------------------------------------------------------
// §14.8.3 SQLite type mapping
//
// Maps a ColumnDef.sqlType string to a scrml ResolvedType.
// Returns { type, warning } where warning is true when affinity fallback was
// applied and the type is truly unknown (produces E-TYPE-051).
// ---------------------------------------------------------------------------

function mapSqliteType(sqlType: string, nullable: boolean): { type: ResolvedType; warning: boolean } {
  const upper = (sqlType ?? "").toUpperCase().trim();

  let base: ResolvedType;
  let warning = false;

  // Primary mapping table (case-insensitive exact matches).
  if (upper === "INTEGER" || upper === "INT") {
    base = tPrimitive("number");
  } else if (
    upper === "TEXT" || upper === "CHAR" || upper === "CLOB" || upper === "VARCHAR"
  ) {
    base = tPrimitive("string");
  } else if (upper === "REAL" || upper === "FLOA" || upper === "DOUB") {
    base = tPrimitive("number");
  } else if (upper === "BLOB") {
    base = tPrimitive("string");
  } else if (upper === "NULL" || upper === "") {
    base = tAsIs();
  } else {
    // Affinity algorithm per §14.8.3 for unrecognized types.
    if (upper.includes("INT")) {
      base = tPrimitive("number");
    } else if (upper.includes("CHAR") || upper.includes("CLOB") || upper.includes("TEXT")) {
      base = tPrimitive("string");
    } else if (upper.includes("BLOB") || upper === "") {
      base = tAsIs();
      warning = true;  // E-TYPE-051 — truly unmappable
    } else if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) {
      base = tPrimitive("number");
    } else {
      // SQLite NUMERIC affinity default.
      base = tPrimitive("number");
    }
  }

  // Nullability: T | not (§42 — scrml uses `not` instead of `null` for absence)
  const type: ResolvedType = nullable ? tUnion([base, tNot()]) : base;

  return { type, warning };
}

// ---------------------------------------------------------------------------
// §14.8.2 InitCap algorithm
//
// Converts a table name to a scrml type name identifier.
// ---------------------------------------------------------------------------

/** ASCII-only lowercase: only A-Z → a-z. */
function asciiLower(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += (code >= 65 && code <= 90) ? String.fromCharCode(code + 32) : ch;
  }
  return out;
}

/** ASCII-only uppercase first char: only a-z → A-Z. */
function asciiCapFirst(s: string): string {
  if (s.length === 0) return s;
  const first = s.charCodeAt(0);
  const cap = (first >= 97 && first <= 122)
    ? String.fromCharCode(first - 32)
    : s[0];
  return cap + s.slice(1);
}

/**
 * Apply the InitCap algorithm (§14.8.2) to a table name.
 *
 * Returns { name } on success, or { error: 'E-TYPE-052', name: null } on failure.
 */
function initCap(tableName: string): { name: string; error: null } | { name: null; error: string } {
  // Step 1: split on `_`.
  const segments = tableName.split("_");

  // Steps 2-3: lowercase + capitalize each segment, discard empty segments.
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.length === 0) continue;  // Step 3: discard empty
    parts.push(asciiCapFirst(asciiLower(seg)));
  }

  // If all segments were empty (e.g. table name is "_"), result is empty string.
  const result = parts.join("");

  // Step 5: validity check — must be a valid scrml identifier.
  // Begins with ASCII letter or underscore; contains only [A-Za-z0-9_].
  if (result.length === 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(result)) {
    return { name: null, error: "E-TYPE-052" };
  }

  return { name: result, error: null };
}

// ---------------------------------------------------------------------------
// Top-level splitter
//
// Splits a string on a set of delimiter characters, but only at depth 0
// (not inside parentheses, brackets, or braces).
//
// Defined early because it is used by parseStructBody, parseEnumBody,
// and resolveTypeExpr.
// ---------------------------------------------------------------------------

function splitTopLevel(s: string, delimiters: string[]): string[] {
  const delimSet = new Set(delimiters);
  const parts: string[] = [];
  let depth = 0;
  let cur = "";

  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      cur += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      cur += ch;
    } else if (depth === 0 && delimSet.has(ch)) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  if (cur.length > 0) parts.push(cur);
  return parts;
}
// ---------------------------------------------------------------------------
// §53 — Predicate expression parser
// ---------------------------------------------------------------------------

/**
 * Parse a predicate expression string into a PredicateExpr tree.
 *
 * Grammar (§53.2.1):
 *   predicate-expr = simple-predicate | "!" predicate-expr
 *                  | predicate-expr "&&" predicate-expr
 *                  | predicate-expr "||" predicate-expr
 *                  | "(" predicate-expr ")" | named-shape
 *   simple-predicate = comparison-predicate | property-predicate
 *   comparison-predicate = comparison-op numeric-literal
 *   property-predicate = "." identifier comparison-op value-literal
 *   named-shape = identifier
 *
 * External @identifier references set hasExternalRef: true (E-CONTRACT-003).
 * Parse failures produce { kind: "error", message: "..." }.
 */
function parsePredicateExpr(raw: string): PredicateExpr & { hasExternalRef: boolean } {
  const trimmed = raw.trim();
  let hasExternalRef = false;

  type PToken =
    | { t: "op"; v: string }
    | { t: "num"; v: number }
    | { t: "str"; v: string }
    | { t: "ident"; v: string }
    | { t: "prop"; v: string }
    | { t: "extref"; v: string }
    | { t: "and" }
    | { t: "or" }
    | { t: "not" }
    | { t: "lp" }
    | { t: "rp" };

  const tokens: PToken[] = [];
  let i = 0;

  while (i < trimmed.length) {
    // Skip whitespace
    if (/\s/.test(trimmed[i])) { i++; continue; }

    // Two-char operators first
    if (i + 1 < trimmed.length) {
      const two = trimmed.slice(i, i + 2);
      if (two === "&&") { tokens.push({ t: "and" }); i += 2; continue; }
      if (two === "||") { tokens.push({ t: "or" }); i += 2; continue; }
      if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
        tokens.push({ t: "op", v: two }); i += 2; continue;
      }
    }

    const ch = trimmed[i];
    if (ch === ">" || ch === "<") { tokens.push({ t: "op", v: ch }); i++; continue; }
    if (ch === "!") { tokens.push({ t: "not" }); i++; continue; }
    if (ch === "(") { tokens.push({ t: "lp" }); i++; continue; }
    if (ch === ")") { tokens.push({ t: "rp" }); i++; continue; }

    // External reference @identifier
    if (ch === "@") {
      hasExternalRef = true;
      let name = "@"; i++;
      while (i < trimmed.length && /[A-Za-z0-9_]/.test(trimmed[i])) { name += trimmed[i]; i++; }
      tokens.push({ t: "extref", v: name });
      continue;
    }

    // Property access .identifier
    if (ch === ".") {
      let prop = "."; i++;
      while (i < trimmed.length && /[A-Za-z0-9_]/.test(trimmed[i])) { prop += trimmed[i]; i++; }
      tokens.push({ t: "prop", v: prop });
      continue;
    }

    // Negative number: "-" followed by a digit
    if (ch === "-" && i + 1 < trimmed.length && /[0-9]/.test(trimmed[i + 1])) {
      let num = "-"; i++;
      while (i < trimmed.length && /[0-9.]/.test(trimmed[i])) { num += trimmed[i]; i++; }
      tokens.push({ t: "num", v: parseFloat(num) });
      continue;
    }

    // Positive number
    if (/[0-9]/.test(ch)) {
      let num = "";
      while (i < trimmed.length && /[0-9.]/.test(trimmed[i])) { num += trimmed[i]; i++; }
      tokens.push({ t: "num", v: parseFloat(num) });
      continue;
    }

    // String literal
    if (ch === "'" || ch === '"') {
      const q = ch; let str = ""; i++;
      while (i < trimmed.length && trimmed[i] !== q) { str += trimmed[i]; i++; }
      if (i < trimmed.length) i++;
      tokens.push({ t: "str", v: str });
      continue;
    }

    // Identifier (named-shape or keyword)
    if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (i < trimmed.length && /[A-Za-z0-9_]/.test(trimmed[i])) { id += trimmed[i]; i++; }
      tokens.push({ t: "ident", v: id });
      continue;
    }

    i++; // skip unknown char
  }

  let pos = 0;
  const peek = (): PToken | null => pos < tokens.length ? tokens[pos] : null;
  const consume = (): PToken => tokens[pos++];

  function parseOr(): PredicateExpr {
    let left = parseAnd();
    while (peek()?.t === "or") {
      consume();
      const right = parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  function parseAnd(): PredicateExpr {
    let left = parseNot();
    while (peek()?.t === "and") {
      consume();
      const right = parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }

  function parseNot(): PredicateExpr {
    if (peek()?.t === "not") {
      consume();
      const operand = parsePrimary();
      return { kind: "not", operand };
    }
    return parsePrimary();
  }

  function parsePrimary(): PredicateExpr {
    const t = peek();
    if (!t) return { kind: "error", message: "unexpected end of predicate" };

    if (t.t === "lp") {
      consume();
      const expr = parseOr();
      if (peek()?.t === "rp") consume();
      return expr;
    }

    if (t.t === "extref") {
      consume();
      return { kind: "named-shape", name: (t as { t: "extref"; v: string }).v };
    }

    if (t.t === "op") {
      const op = (consume() as { t: "op"; v: string }).v;
      const nt = peek();
      if (nt?.t === "num") {
        consume();
        return { kind: "comparison", op, value: (nt as { t: "num"; v: number }).v };
      }
      return { kind: "error", message: "expected number after operator" };
    }

    if (t.t === "prop") {
      const pt = consume() as { t: "prop"; v: string };
      const prop = pt.v.slice(1);
      const ot = peek();
      if (ot?.t === "op") {
        const op = (consume() as { t: "op"; v: string }).v;
        const vt = peek();
        if (vt?.t === "num") { consume(); return { kind: "property", prop, op, value: (vt as { t: "num"; v: number }).v }; }
        if (vt?.t === "str") { consume(); return { kind: "property", prop, op, value: (vt as { t: "str"; v: string }).v }; }
        return { kind: "error", message: "expected literal after property operator" };
      }
      return { kind: "error", message: "expected operator after property" };
    }

    if (t.t === "ident") {
      const it = consume() as { t: "ident"; v: string };
      return { kind: "named-shape", name: it.v };
    }

    if (t.t === "num") {
      consume();
      return { kind: "error", message: "bare number not a valid predicate primary" };
    }

    return { kind: "error", message: "unexpected token type: " + t.t };
  }

  if (tokens.length === 0) {
    return Object.assign({ kind: "error" as const, message: "empty predicate" }, { hasExternalRef: false });
  }

  const result = parseOr();
  return Object.assign(result, { hasExternalRef });
}

/**
 * Statically evaluate a predicate against a literal value (T-PRED-1).
 * Returns true/false if provable, null if undeterminable (needs runtime check).
 */
function evaluatePredicateOnLiteral(pred: PredicateExpr, value: number | string): boolean | null {
  if (pred.kind === "comparison") {
    if (typeof value !== "number") return null;
    const rhs = pred.value as number;
    switch (pred.op) {
      case ">":  return value > rhs;
      case ">=": return value >= rhs;
      case "<":  return value < rhs;
      case "<=": return value <= rhs;
      case "==": return value === rhs;
      case "!=": return value !== rhs;
      default:   return null;
    }
  }
  if (pred.kind === "property" && pred.prop === "length" && typeof value === "string") {
    const len = value.length;
    const rhs = pred.value as number;
    switch (pred.op) {
      case ">":  return len > rhs;
      case ">=": return len >= rhs;
      case "<":  return len < rhs;
      case "<=": return len <= rhs;
      case "==": return len === rhs;
      case "!=": return len !== rhs;
      default:   return null;
    }
  }
  if (pred.kind === "named-shape") return null; // not statically evaluated
  if (pred.kind === "and") {
    const l = evaluatePredicateOnLiteral(pred.left!, value);
    const r = evaluatePredicateOnLiteral(pred.right!, value);
    if (l === false || r === false) return false;
    if (l === true && r === true) return true;
    return null;
  }
  if (pred.kind === "or") {
    const l = evaluatePredicateOnLiteral(pred.left!, value);
    const r = evaluatePredicateOnLiteral(pred.right!, value);
    if (l === true || r === true) return true;
    if (l === false && r === false) return false;
    return null;
  }
  if (pred.kind === "not") {
    const inner = evaluatePredicateOnLiteral(pred.operand!, value);
    return inner === null ? null : !inner;
  }
  return null;
}


// ---------------------------------------------------------------------------
// Struct body parser
// ---------------------------------------------------------------------------

/**
 * Parse a struct body string into a field map.
 *
 * This is a best-effort parser: it does not handle the full type expression
 * language. It extracts field names and their basic type annotations.
 */
function parseStructBody(raw: string, typeRegistry: Map<string, ResolvedType>): Map<string, ResolvedType> {
  const fields = new Map<string, ResolvedType>();

  // Strip outer braces if present.
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();

  if (!body) return fields;

  // Split on commas and newlines at the top level (not inside parentheses).
  const lines = splitTopLevel(body, [",", "\n"]);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match `fieldName: typeExpr`
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const fieldName = trimmed.slice(0, colonIdx).trim();
    const typeExpr = trimmed.slice(colonIdx + 1).trim();

    if (!fieldName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldName)) continue;

    fields.set(fieldName, resolveTypeExpr(typeExpr, typeRegistry));
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Enum body parser
// ---------------------------------------------------------------------------

/**
 * Parse an enum body string into variants + optional transition rules.
 *
 * §51.2: An enum body may contain a `transitions {}` block after the variant list.
 * If present, transition rules are parsed and returned alongside variants.
 * If absent, transitionRules is null (unrestricted enum — existing behavior).
 *
 * @param raw        — full enum body string including outer braces
 * @param typeRegistry — type registry for payload type resolution
 * @param errors     — error accumulator; receives E-ENGINE-010 if guard found in type-level rule
 * @param fileSpan   — span for error reporting
 * @param typeName   — enum type name for error messages
 */
function parseEnumBody(
  raw: string,
  typeRegistry: Map<string, ResolvedType>,
  errors?: TSError[],
  fileSpan?: Span,
  typeName?: string,
): { variants: VariantDef[]; transitionRules: TransitionRule[] | null } {
  const variants: VariantDef[] = [];

  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();

  if (!body) return { variants, transitionRules: null };

  // -----------------------------------------------------------------------
  // Split body into variants section and (optional) transitions section.
  // The transitions block starts with the keyword `transitions` followed by
  // a `{` at top-level depth.
  // -----------------------------------------------------------------------
  let variantsSection = body;
  let transitionsSection: string | null = null;

  // Find `transitions` keyword at top-level (depth 0).
  // We scan for the literal text "transitions" at depth 0 followed by whitespace + "{".
  {
    let depth = 0;
    let i = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth--; i++; continue; }
      if (depth === 0 && body.slice(i).startsWith("transitions")) {
        const after = body.slice(i + "transitions".length).trimStart();
        if (after.startsWith("{")) {
          // Found the transitions block.
          variantsSection = body.slice(0, i).trim();
          // Extract the content inside the transitions braces.
          const openBrace = body.indexOf("{", i + "transitions".length);
          if (openBrace !== -1) {
            // Find matching close brace at depth 0.
            let bd = 0;
            let j = openBrace;
            while (j < body.length) {
              if (body[j] === "{") bd++;
              else if (body[j] === "}") {
                bd--;
                if (bd === 0) { break; }
              }
              j++;
            }
            transitionsSection = body.slice(openBrace + 1, j).trim();
          }
          break;
        }
      }
      i++;
    }
  }

  // -----------------------------------------------------------------------
  // Parse variants from variantsSection (same logic as before).
  // -----------------------------------------------------------------------
  // §14.4 — split variants on newlines, top-level commas, AND top-level
  // pipes so all four declared variant-list shapes parse uniformly:
  //
  //   Brace + comma:        { Pending, Success, Failed }
  //   Brace + newline:      { Pending\nSuccess\nFailed }
  //   Brace + pipe (mixed): { GET | POST | PUT | DELETE }  (emit-library test fixture)
  //   Bare + pipe:          .Pending | .Success | .Failed  (canonical example form)
  //
  // splitTopLevel tracks `()`/`[]`/`{}` depth so commas / pipes inside
  // payload field lists stay with their variant. The unit-variant arm
  // below strips a single leading `.` (and surrounding whitespace) so
  // bar-form variant names like `.Pending` still match the identifier
  // regex. Pre-S84-v0.2.4-4.5 the bar-form variants registered zero
  // variants — silently fine when nothing read the enum's variant list,
  // but visible as "Known variants: (none)" the moment the bare-variant
  // inference walker tried to validate `.V` against the enum.
  const lines = splitTopLevel(variantsSection, ["\n", ",", "|"]);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match `VariantName` or `VariantName(field:type, ...)`
    const parenIdx = trimmed.indexOf("(");

    if (parenIdx === -1) {
      // Unit variant — may still be comma- or pipe-separated on one line.
      // (Top-level splitTopLevel already handled the common case; this
      // fallback catches mixed-delimiter declarations.)
      const unitParts = splitTopLevel(trimmed, [",", "|"]);
      for (const part of unitParts) {
        let text = part.trim();
        if (!text) continue;
        // Bar-form: each variant may be written as `.Name` — strip the
        // leading `.` (with optional whitespace) so the identifier regex
        // matches. See parseEnumBody header comment for the four declared
        // shapes.
        if (text.startsWith(".")) text = text.slice(1).trim();

        // Check for `renders` clause on this unit variant.
        let renders: { markup: string } | null = null;
        const rendersIdx = text.indexOf(" renders ");
        if (rendersIdx !== -1) {
          const markup = text.slice(rendersIdx + " renders ".length).trim();
          if (markup) renders = { markup };
          text = text.slice(0, rendersIdx).trim();
        }

        const name = text;
        if (!name) continue;
        if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;  // must start with uppercase
        variants.push({ name, payload: null, renders });
      }
    } else {
      // Payload variant: `Name(field:type, ...)` or bar-form `.Name(...)`.
      let name = trimmed.slice(0, parenIdx).trim();
      // Strip a single leading `.` (bar-form parity with the unit-variant arm).
      if (name.startsWith(".")) name = name.slice(1).trim();
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;

      // Find the closing paren for the payload, then check for `renders` after it.
      const closeParenIdx = trimmed.lastIndexOf(")");
      const payloadStr = trimmed.slice(parenIdx + 1, closeParenIdx).trim();
      const payload = new Map<string, ResolvedType>();

      if (payloadStr) {
        // Split payload fields on commas at depth-0.
        const fieldParts = splitTopLevel(payloadStr, [","]);
        for (const fp of fieldParts) {
          const colonIdx = fp.indexOf(":");
          if (colonIdx === -1) continue;
          const fieldName = fp.slice(0, colonIdx).trim();
          const typeExpr = fp.slice(colonIdx + 1).trim();
          if (fieldName) {
            payload.set(fieldName, resolveTypeExpr(typeExpr, typeRegistry));
          }
        }
      }

      // Check for `renders` clause after the closing paren.
      let renders: { markup: string } | null = null;
      const afterParen = closeParenIdx !== -1 ? trimmed.slice(closeParenIdx + 1).trim() : "";
      if (afterParen.startsWith("renders ")) {
        const markup = afterParen.slice("renders ".length).trim();
        if (markup) renders = { markup };
      }

      variants.push({ name, payload, renders });
    }
  }

  // -----------------------------------------------------------------------
  // Parse transition rules from transitionsSection (§51.2.1).
  // -----------------------------------------------------------------------
  if (transitionsSection === null) {
    return { variants, transitionRules: null };
  }

  const knownVariantNames = new Set(variants.map(v => v.name));
  const transitionRules: TransitionRule[] = [];
  const ruleLines = transitionsSection.split("\n");

  for (const ruleLine of ruleLines) {
    const trimmedRule = ruleLine.trim();
    if (!trimmedRule || trimmedRule.startsWith("//")) continue;

    // Strip inline comments
    const commentIdx = trimmedRule.indexOf("//");
    const cleanRule = (commentIdx !== -1 ? trimmedRule.slice(0, commentIdx) : trimmedRule).trim();
    if (!cleanRule) continue;

    // E-ENGINE-010: guard in type-level transition block
    // Check for ` given ` keyword (space-bounded to avoid false matches in variant names).
    const givenIdx = cleanRule.search(/\bgiven\b/);
    if (givenIdx !== -1) {
      if (errors && fileSpan) {
        errors.push(new TSError(
          "E-ENGINE-010",
          "E-ENGINE-010: 'given' guard is not permitted in a type-level 'transitions {}' block. " +
          "Type-level transitions are structural rules only (VariantRef => VariantRef). " +
          "Use a '< machine>' declaration to add contextual guards. " +
          (typeName ? "Enum: " + typeName + ". " : "") +
          "Rule: " + cleanRule,
          fileSpan,
        ));
      }
      // Still parse the rule but set guard = null (discard the guard expression).
    }

    // Find the '=>' arrow
    const arrowIdx = cleanRule.indexOf("=>");
    if (arrowIdx === -1) continue;

    let fromStr = cleanRule.slice(0, arrowIdx).trim();
    let rest = cleanRule.slice(arrowIdx + 2).trim();

    // Strip any trailing effect block { ... } from rest
    let effectBody: string | null = null;
    const effectBraceIdx = rest.indexOf("{");
    if (effectBraceIdx !== -1) {
      effectBody = rest.slice(effectBraceIdx + 1, rest.lastIndexOf("}")).trim() || null;
      rest = rest.slice(0, effectBraceIdx).trim();
    }

    // Strip any trailing 'given (...)' from rest (already flagged as error above)
    const givenInRest = rest.search(/\bgiven\b/);
    if (givenInRest !== -1) {
      rest = rest.slice(0, givenInRest).trim();
    }

    let toStr = rest.trim();

    // Normalize variant refs: strip leading '.' or '::', then trim any
    // whitespace between the prefix and the variant name (e.g. `. Pending` →
    // `Pending`). Without the trim, a user-authored space after the dot
    // leaks into the variant-name lookup and fires E-ENGINE-004 against
    // a valid variant.
    const normalizeRef = (ref: string): string => {
      if (ref.startsWith("::")) return ref.slice(2).trim();
      if (ref.startsWith(".")) return ref.slice(1).trim();
      return ref.trim();
    };

    const fromName = normalizeRef(fromStr);
    const toName = normalizeRef(toStr);

    if (!fromName || !toName) continue;

    // Validate from/to variant names (wildcards "*" are always valid)
    if (fromName !== "*" && !knownVariantNames.has(fromName) && errors && fileSpan) {
      errors.push(new TSError(
        "E-ENGINE-004",
        "E-ENGINE-004: Transition rule references unknown variant '." + fromName + "'. " +
        (typeName ? "Enum '" + typeName + "' " : "The enum ") +
        "has no variant named '" + fromName + "'. " +
        "Available variants: " + Array.from(knownVariantNames).map(n => "." + n).join(", ") + ".",
        fileSpan,
      ));
    }

    if (toName !== "*" && !knownVariantNames.has(toName) && errors && fileSpan) {
      errors.push(new TSError(
        "E-ENGINE-004",
        "E-ENGINE-004: Transition rule references unknown variant '." + toName + "'. " +
        (typeName ? "Enum '" + typeName + "' " : "The enum ") +
        "has no variant named '" + toName + "'. " +
        "Available variants: " + Array.from(knownVariantNames).map(n => "." + n).join(", ") + ".",
        fileSpan,
      ));
    }

    transitionRules.push({
      from: fromName,
      to: toName,
      guard: null,   // type-level guards are not permitted (E-ENGINE-010)
      label: null,
      effectBody,
      fromBindings: null,
      toBindings: null,
      afterMs: null, // type-level: temporal transitions are machine-only (E-ENGINE-021)
      afterExpr: null, // §51.12.3.1 (S67): same — type-level transitions are not temporal
    });
  }

  return { variants, transitionRules };
}

// ---------------------------------------------------------------------------
// Type expression resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a type expression string to a ResolvedType.
 *
 * This is a lookup-table approach: primitives and named types are resolved
 * directly. Compound types are given a best-effort structural representation.
 * When resolution fails, tAsIs() is returned (conservative; no error emitted
 * here — callers decide whether unknown is an error).
 */
function resolveTypeExpr(expr: string, typeRegistry: Map<string, ResolvedType>): ResolvedType {
  if (!expr) return tAsIs();

  const trimmed = expr.trim();

  // Lifecycle annotation: (A -> B) — resolve to B (post-transition type).
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(1, -1);
    const arrowIdx = inner.indexOf("->");
    if (arrowIdx !== -1) {
      const rhs = inner.slice(arrowIdx + 2).trim();
      return resolveTypeExpr(rhs, typeRegistry);
    }
    // No arrow: just remove parens and re-resolve.
    return resolveTypeExpr(inner, typeRegistry);
  }

  // Union: A | B (split on | at top level).
  if (trimmed.includes("|")) {
    const parts = splitTopLevel(trimmed, ["|"]);
    if (parts.length > 1) {
      const members = parts.map(p => resolveTypeExpr(p.trim(), typeRegistry));
      return tUnion(members);
    }
  }

  // Negation: !type — conservative: treat as asIs.
  if (trimmed.startsWith("!")) {
    return tAsIs();
  }

  // §53 — Inline predicate type: base-type(predicate-expr) or base-type(predicate-expr)[label]
  // Must come BEFORE the "&&" shortcut since predicate-expr may contain &&.
  {
    const PRED_BASES = new Set(["number", "string", "boolean", "integer"]);
    const parenIdx = trimmed.indexOf("(");
    if (parenIdx > 0) {
      const base = trimmed.slice(0, parenIdx).trim();
      if (PRED_BASES.has(base)) {
        // Find matching close paren (depth-aware)
        let depth = 0;
        let closeIdx = -1;
        for (let pi = parenIdx; pi < trimmed.length; pi++) {
          if (trimmed[pi] === "(") depth++;
          else if (trimmed[pi] === ")") {
            depth--;
            if (depth === 0) { closeIdx = pi; break; }
          }
        }
        if (closeIdx > parenIdx) {
          const predicateStr = trimmed.slice(parenIdx + 1, closeIdx);
          // Optional label: [identifier] after closing paren
          let label: string | null = null;
          const rest = trimmed.slice(closeIdx + 1).trim();
          if (rest.startsWith("[") && rest.endsWith("]")) {
            label = rest.slice(1, -1).trim();
          }
          const parsed = parsePredicateExpr(predicateStr);
          if (parsed.kind !== "error") {
            return tPredicated(
              base as "number" | "string" | "boolean" | "integer",
              parsed,
              label,
            );
          }
          // parse error — fall through to asIs
        }
      }
    }
  }

  // Conjunction: (...&& ...) — conservative: treat as asIs.
  if (trimmed.includes("&&")) {
    return tAsIs();
  }

  // Array: type[] — conservative: element type lookup then wrap.
  if (trimmed.endsWith("[]")) {
    const elementExpr = trimmed.slice(0, -2).trim();
    return tArray(resolveTypeExpr(elementExpr, typeRegistry));
  }

  // §14.9 — snippet type kind
  if (trimmed === "snippet") return tSnippet(null, false);
  if (trimmed === "snippet?") return tSnippet(null, true);
  if (trimmed.startsWith("snippet(") && trimmed.endsWith(")")) {
    // snippet(param: Type) — extract type from inside parens
    const inner = trimmed.slice(8, -1); // "param: Type"
    const colonIdx = inner.indexOf(":");
    const paramTypeStr = colonIdx !== -1 ? inner.slice(colonIdx + 1).trim() : inner.trim();
    return tSnippet(resolveTypeExpr(paramTypeStr, typeRegistry), false);
  }

  // S84 v0.2.4 #4.5 (Gap A) — inline-struct type expression
  //   `{ id: number, title: string, status: Status }`
  //
  // Surfaces in array-typed state-decls like `<x>: { f: Enum }[] = [...]`.
  // Without this branch, the inline-struct annotation falls through to
  // `tAsIs()` and the bare-variant inference walker loses every field type,
  // so `{ status: .Todo }` inside the array initializer fires
  // E-VARIANT-AMBIGUOUS even when `Status` is a statically-known enum.
  //
  // Grammar (intentionally narrow — matches what the AST builder produces):
  //   { name : TypeExpr , name : TypeExpr , ... }
  // where each TypeExpr recurses into `resolveTypeExpr`. Fields are split
  // top-level (commas inside nested `{...}`/`[...]`/`(...)` are preserved
  // via `splitTopLevel`). Anonymous struct name uses the literal source
  // text so equality / labeling stays distinct from named struct types
  // declared via `type T :struct = {...}` (those land via typeRegistry).
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const innerBody = trimmed.slice(1, -1).trim();
    if (innerBody.length > 0) {
      const fieldParts = splitTopLevel(innerBody, [",", "\n"]);
      const fields = new Map<string, ResolvedType>();
      let allFieldsParsedCleanly = true;
      for (const rawPart of fieldParts) {
        const part = rawPart.trim();
        if (part.length === 0) continue;
        const colonIdx = part.indexOf(":");
        if (colonIdx <= 0) {
          // Malformed field — fall back to asIs (don't silently mis-resolve).
          allFieldsParsedCleanly = false;
          break;
        }
        const fieldName = part.slice(0, colonIdx).trim();
        const fieldTypeExpr = part.slice(colonIdx + 1).trim();
        // Field names must look like identifiers (no spaces / punctuation).
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldName)) {
          allFieldsParsedCleanly = false;
          break;
        }
        fields.set(fieldName, resolveTypeExpr(fieldTypeExpr, typeRegistry));
      }
      if (allFieldsParsedCleanly && fields.size > 0) {
        // Anonymous struct — use a literal name marker so equality / labeling
        // stays distinct from named struct types declared via
        // `type T :struct = {...}` (those land via typeRegistry). The empty-
        // fields case (`{}`) falls through to `tAsIs()` because an empty
        // struct is not a useful inference context.
        return tStruct("<inline>", fields);
      }
    }
  }

  // Primitive lookup.
  if (BUILTIN_TYPES.has(trimmed)) {
    return BUILTIN_TYPES.get(trimmed)!;
  }

  // asIs keyword.
  if (trimmed === "asIs") {
    return tAsIs();
  }

  // Named type lookup in the registry.
  if (typeRegistry.has(trimmed)) {
    return typeRegistry.get(trimmed)!;
  }

  // Unresolvable — return asIs (conservative; no error here).
  return tAsIs();
}

// ---------------------------------------------------------------------------
// §53 — Predicate validation at assignment sites
// ---------------------------------------------------------------------------

/**
 * Format a PredicateExpr to a human-readable string (for error messages).
 */
function formatPredicateExpr(pred: PredicateExpr): string {
  switch (pred.kind) {
    case "comparison": return (pred.op ?? "") + String(pred.value ?? "");
    case "property":   return "." + (pred.prop ?? "") + (pred.op ?? "") + String(pred.value ?? "");
    case "named-shape": return pred.name ?? "?";
    case "and":        return formatPredicateExpr(pred.left!) + " && " + formatPredicateExpr(pred.right!);
    case "or":         return "(" + formatPredicateExpr(pred.left!) + " || " + formatPredicateExpr(pred.right!) + ")";
    case "not":        return "!" + formatPredicateExpr(pred.operand!);
    case "error":      return "?invalid?";
    default:           return "?";
  }
}

/**
 * Validate a literal value against a predicated type at compile time.
 *
 * Emits:
 *   E-CONTRACT-001 — literal fails the predicate statically (T-PRED-1)
 *   E-CONTRACT-002 — named shape not in registry
 *   E-CONTRACT-003 — predicate references external reactive variable
 *
 * Returns:
 *   true  — literal is statically proven valid (no runtime check needed)
 *   false — literal is statically proven invalid (E-CONTRACT-001 emitted)
 *   null  — cannot be determined at compile time (emit runtime check)
 */
function checkPredicateLiteral(
  predType: PredicatedType,
  value: number | string | boolean,
  span: Span,
  errors: TSError[],
): boolean | null {
  // E-CONTRACT-003: predicate references external reactive variable
  if ((predType.predicate as PredicateExpr & { hasExternalRef?: boolean }).hasExternalRef) {
    errors.push(new TSError(
      "E-CONTRACT-003",
      "E-CONTRACT-003: Inline predicate references an external reactive variable. " +
        "Inline predicates must be stateless — they may only reference the incoming value. " +
        "For constraints that depend on external state, use < machine>.",
      span,
    ));
    return null;
  }

  // E-CONTRACT-002: check for unknown named shapes
  function checkNamedShapes(pred: PredicateExpr): void {
    if (pred.kind === "named-shape" && pred.name && !pred.name.startsWith("@") && !NAMED_SHAPES.has(pred.name)) {
      errors.push(new TSError(
        "E-CONTRACT-002",
        "E-CONTRACT-002: Named shape '" + pred.name + "' not found in the shape registry. " +
          "Built-in shapes: " + Array.from(NAMED_SHAPES.keys()).join(", ") + ". " +
          "To register a custom shape, use a ^{} meta block.",
        span,
      ));
    }
    if ((pred.kind === "and" || pred.kind === "or") && pred.left && pred.right) {
      checkNamedShapes(pred.left);
      checkNamedShapes(pred.right);
    }
    if (pred.kind === "not" && pred.operand) checkNamedShapes(pred.operand);
  }
  checkNamedShapes(predType.predicate);

  // E-CONTRACT-001: static literal evaluation
  if (typeof value === "boolean") return null;

  const result = evaluatePredicateOnLiteral(predType.predicate, value as number | string);
  if (result === false) {
    const predicateStr = formatPredicateExpr(predType.predicate);
    errors.push(new TSError(
      "E-CONTRACT-001",
      "E-CONTRACT-001: Value constraint violated. " +
        "Type: " + predType.baseType + "(" + predicateStr + ")" +
        (predType.label ? " [" + predType.label + "]" : "") + ". " +
        "Value " + String(value) + " does not satisfy the predicate.",
      span,
    ));
    return false;
  }
  return result;
}

// ---------------------------------------------------------------------------
// §53.4 — Three-Zone SPARK Enforcement
// ---------------------------------------------------------------------------

/**
 * SourceInfo — describes what the type system knows about a value at an assignment site.
 *
 * "literal"       — value is a known compile-time number or string literal.
 * "predicated"    — value already carries a predicate constraint.
 * "arithmetic"    — value is the result of arithmetic on a predicated type (T-PRED-5).
 * "unconstrained" — value source cannot be determined at compile time.
 */
type SourceInfo =
  | { kind: "literal"; value: number | string }
  | { kind: "predicated"; predType: PredicatedType }
  | { kind: "unconstrained" }
  | { kind: "arithmetic" };

/**
 * Try to extract a SourceInfo from a raw init expression string.
 * Conservative: only matches unambiguous numeric or string literals.
 * Returns "arithmetic" if binary arithmetic operators are detected.
 * Returns "unconstrained" for everything else.
 */
function extractInitLiteral(init: unknown): SourceInfo {
  if (typeof init !== "string") return { kind: "unconstrained" };
  const raw = init.trim();
  if (!raw) return { kind: "unconstrained" };

  // Numeric literal: optional minus, digits, optional decimal
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return { kind: "literal", value: parseFloat(raw) };
  }

  // String literal: single or double quoted (at least 2 chars: open+close quote)
  if (raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) ||
       (raw.startsWith("'") && raw.endsWith("'")))) {
    return { kind: "literal", value: raw.slice(1, -1) };
  }

  // Arithmetic: *, /, + operators, or digit followed by binary minus
  if (/[+*\/]/.test(raw) || /\d\s*-/.test(raw)) {
    return { kind: "arithmetic" };
  }

  return { kind: "unconstrained" };
}

/**
 * Returns true if `source` numeric comparison predicate is at least as restrictive as `target`.
 * "At least as restrictive" means every value satisfying source also satisfies target.
 */
function isCompTighterOrEqual(source: PredicateExpr, target: PredicateExpr): boolean {
  if (source.kind !== "comparison" || target.kind !== "comparison") return false;
  if (typeof source.value !== "number" || typeof target.value !== "number") return false;

  const sv = source.value;
  const tv = target.value;
  const sop = source.op!;
  const top = target.op!;

  // Lower-bound ops: > and >=
  if ((sop === ">" || sop === ">=") && (top === ">" || top === ">=")) {
    if (sop === top) return sv >= tv;
    if (sop === ">" && top === ">=") return sv >= tv;
    if (sop === ">=" && top === ">") return sv > tv;
    return false;
  }
  // Upper-bound ops: < and <=
  if ((sop === "<" || sop === "<=") && (top === "<" || top === "<=")) {
    if (sop === top) return sv <= tv;
    if (sop === "<" && top === "<=") return sv <= tv;
    if (sop === "<=" && top === "<") return sv < tv;
    return false;
  }
  // == implies various bounds
  if (sop === "==") {
    if (top === "==") return sv === tv;
    if (top === ">" || top === ">=") return top === ">" ? sv > tv : sv >= tv;
    if (top === "<" || top === "<=") return top === "<" ? sv < tv : sv <= tv;
  }

  return false;
}

/**
 * T-PRED-4 — Constraint implication check.
 *
 * Returns true if every value satisfying `source` predicate also satisfies `target`.
 *
 * Rules:
 *   - Numeric: source tighter or equal → implies target
 *   - Named shape: exact name match only
 *   - AND: A && B implies A (conjunction implies each conjunct)
 *   - AND target: source implies (A && B) iff source implies both A and B
 *   - OR target: source implies (A || B) iff source implies A or B
 */
function predicateImplies(source: PredicateExpr, target: PredicateExpr): boolean {
  switch (target.kind) {
    case "comparison":
      if (source.kind === "comparison") return isCompTighterOrEqual(source, target);
      if (source.kind === "and") {
        if (source.left && predicateImplies(source.left, target)) return true;
        if (source.right && predicateImplies(source.right, target)) return true;
      }
      return false;

    case "named-shape":
      if (source.kind === "named-shape") return source.name === target.name;
      if (source.kind === "and") {
        if (source.left && predicateImplies(source.left, target)) return true;
        if (source.right && predicateImplies(source.right, target)) return true;
      }
      return false;

    case "and":
      // source implies (A && B) iff source implies A AND source implies B
      return !!(target.left && target.right &&
        predicateImplies(source, target.left) &&
        predicateImplies(source, target.right));

    case "or":
      // source implies (A || B) iff source implies A OR source implies B
      return !!(target.left && target.right &&
        (predicateImplies(source, target.left) || predicateImplies(source, target.right)));

    default:
      return false;
  }
}

/**
 * §53.4 — Classify the predicate enforcement zone at an assignment site.
 *
 * Returns:
 *   "static"   — literal value; predicate evaluated at compile time.
 *                E-CONTRACT-001 pushed by checkPredicateLiteral if the literal fails.
 *                Either way, no runtime check needed.
 *   "trusted"  — source constraint implies target (T-PRED-4); no check needed.
 *   "boundary" — source is unconstrained or arithmetic; CG should emit runtime check (T-PRED-2).
 */
function classifyPredicateZone(
  targetType: PredicatedType,
  sourceInfo: SourceInfo,
  span: Span,
  errors: TSError[],
): "static" | "trusted" | "boundary" {
  switch (sourceInfo.kind) {
    case "literal":
      // T-PRED-1: evaluate predicate against literal at compile time
      checkPredicateLiteral(targetType, sourceInfo.value, span, errors);
      return "static";

    case "predicated":
      // T-PRED-4: does the source constraint statically imply the target?
      return predicateImplies(sourceInfo.predType.predicate, targetType.predicate)
        ? "trusted"
        : "boundary";

    case "arithmetic":
      // T-PRED-5: arithmetic strips constraints → boundary check required
      return "boundary";

    case "unconstrained":
    default:
      // T-PRED-2: no compile-time proof → emit runtime boundary check
      return "boundary";
  }
}

/**
 * §53.4 / B21 — Upgrade a SourceInfo when the source expression is a single
 * `IdentExpr` resolving in the scope chain to a predicated-typed binding.
 *
 * `classifyLiteralFromExprNode` (in expression-parser.ts) is purely syntactic
 * and only returns `literal | arithmetic | unconstrained`. To make T-PRED-4
 * (trusted-zone elision via `predicateImplies`) reachable from real AST code,
 * we look up the RHS identifier in the scope chain and, if it's bound to a
 * predicated type, return a `predicated` SourceInfo carrying the source's
 * predicated type so `classifyPredicateZone` can call `predicateImplies` and
 * decide trusted vs boundary.
 *
 * This is the SOLE behavioral upgrade in B21: it converts certain assignments
 * that would previously classify as `boundary` (with a runtime check emitted
 * by A1c codegen) to `trusted` (with elision marker), per SPEC §53.4.4 +
 * T-PRED-4.
 *
 * Called from `let-decl` / `state-decl` annotators just before
 * `classifyPredicateZone`.
 */
function upgradeSourceInfoForPredicatedIdent(
  initial: SourceInfo,
  initExpr: unknown,
  scopeChain: ScopeChain | null,
): SourceInfo {
  // Only upgrade when the syntactic classifier returned `unconstrained`.
  // `literal` and `arithmetic` are stronger signals that take precedence —
  // a literal value is statically known; arithmetic strips constraints
  // (T-PRED-5) regardless of operand types.
  if (initial.kind !== "unconstrained") return initial;
  if (!scopeChain) return initial;
  if (!initExpr || typeof initExpr !== "object") return initial;
  const node = initExpr as { kind?: string; name?: string };
  if (node.kind !== "ident" || typeof node.name !== "string") return initial;
  // Bare-variant idents (`.Variant`) carry a leading dot — not a binding.
  if (node.name.startsWith(".")) return initial;
  // Tilde / pipeline-accumulator ident — not a regular binding.
  if (node.name === "~") return initial;
  const entry = scopeChain.lookup(node.name);
  if (!entry || entry.kind !== "variable") return initial;
  const rt = entry.resolvedType;
  if (!rt || rt.kind !== "predicated") return initial;
  return { kind: "predicated", predType: rt as PredicatedType };
}

// ---------------------------------------------------------------------------
// Scope chain
// ---------------------------------------------------------------------------

class Scope {
  parent: Scope | null;
  label: string;
  bindings: Map<string, ScopeEntry>;

  constructor(parent: Scope | null, label = "scope") {
    this.parent = parent;
    this.label = label;
    this.bindings = new Map();
  }

  bind(name: string, entry: ScopeEntry): void {
    this.bindings.set(name, entry);
  }

  lookup(name: string): ScopeEntry | null {
    let scope: Scope | null = this;
    while (scope !== null) {
      if (scope.bindings.has(name)) return scope.bindings.get(name)!;
      scope = scope.parent;
    }
    return null;
  }

  hasOwn(name: string): boolean {
    return this.bindings.has(name);
  }
}

class ScopeChain {
  _global: Scope;
  _current: Scope;

  constructor() {
    // Global scope — seeded with built-in types.
    this._global = new Scope(null, "global");
    this._current = this._global;

    // Seed built-in types into global scope.
    for (const [name, type] of BUILTIN_TYPES) {
      this._global.bind(name, { kind: "type", resolvedType: type });
    }
  }

  get current(): Scope {
    return this._current;
  }

  get global(): Scope {
    return this._global;
  }

  push(label = "scope"): Scope {
    const child = new Scope(this._current, label);
    this._current = child;
    return child;
  }

  pop(): void {
    if (this._current.parent === null) {
      throw new Error("ScopeChain: cannot pop global scope");
    }
    this._current = this._current.parent;
  }

  lookup(name: string): ScopeEntry | null {
    return this._current.lookup(name);
  }

  bind(name: string, entry: ScopeEntry): void {
    this._current.bind(name, entry);
  }
}

// ---------------------------------------------------------------------------
// Type registry builder
// ---------------------------------------------------------------------------

/**
 * Build the file-level type registry from a FileAST's typeDecls array.
 */
function buildTypeRegistry(
  typeDecls: ASTNodeLike[],
  errors: TSError[],
  fileSpan: Span,
): Map<string, ResolvedType> {
  const registry = new Map<string, ResolvedType>(BUILTIN_TYPES);

  // Pass 1: register all names as placeholders.
  for (const decl of typeDecls) {
    if (!decl.name) continue;
    registry.set(decl.name as string, tUnknown());
  }

  // Pass 2: parse bodies and replace placeholders.
  for (const decl of typeDecls) {
    if (!decl.name) continue;

    if (decl.typeKind === "struct") {
      const fields = parseStructBody((decl.raw as string) ?? "", registry);
      registry.set(decl.name as string, tStruct(decl.name as string, fields));
    } else if (decl.typeKind === "enum") {
      const { variants, transitionRules } = parseEnumBody(
        (decl.raw as string) ?? "", registry, errors, fileSpan, decl.name as string
      );
      registry.set(decl.name as string, tEnum(decl.name as string, variants, transitionRules));
    } else if (decl.typeKind === "error") {
      // §19.3: user-defined error types — parse fields like a struct
      const fields = parseStructBody((decl.raw as string) ?? "", registry);
      // E-ERROR-008: reserved field names (§19.3) — message/type are implicit
      for (const fieldName of fields.keys()) {
        if (fieldName === "message" || fieldName === "type") {
          errors.push(new TSError(
            "E-ERROR-008",
            "E-ERROR-008: User-defined error type '" + (decl.name as string) + "' declares a field named '" + fieldName + "'. " +
            "The fields 'message' and 'type' are implicit on all error types (\u00a719.3) and may not be declared.",
            fileSpan,
          ));
        }
      }
      registry.set(decl.name as string, tError(decl.name as string, fields));
    } else {
      // Unknown kind — leave as asIs so references don't explode.
      registry.set(decl.name as string, tAsIs());
    }
  }

  // Pass 3: re-resolve any struct/enum fields that referenced a forward-declared type.
  for (const decl of typeDecls) {
    if (!decl.name) continue;
    const existing = registry.get(decl.name as string);
    if (!existing) continue;

    if (decl.typeKind === "struct" && existing.kind === "struct") {
      const fields = parseStructBody((decl.raw as string) ?? "", registry);
      registry.set(decl.name as string, tStruct(decl.name as string, fields));
    } else if (decl.typeKind === "enum" && existing.kind === "enum") {
      const { variants, transitionRules } = parseEnumBody(
        (decl.raw as string) ?? "", registry, errors, fileSpan, decl.name as string
      );
      registry.set(decl.name as string, tEnum(decl.name as string, variants, transitionRules));
    } else if (decl.typeKind === "error" && existing.kind === "error") {
      const fields = parseStructBody((decl.raw as string) ?? "", registry);
      registry.set(decl.name as string, tError(decl.name as string, fields));
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// State type registry (§35)
// ---------------------------------------------------------------------------

/**
 * Build a state type registry pre-populated with HTML element shapes.
 */
function buildStateTypeRegistry(): Map<string, ResolvedType> {
  const registry = new Map<string, ResolvedType>();

  for (const tagName of getAllElementNames()) {
    const shape = getElementShape(tagName);
    if (!shape) continue;
    registry.set(tagName, tState(
      tagName,
      shape.attributes,
      /* isHtml */ shape.rendersToDom,  // program is not HTML
      /* rendersToDom */ shape.rendersToDom,
      /* constructorBody */ null,
    ));
  }

  return registry;
}

/**
 * Register a user-defined state type in the registry.
 */
function registerStateType(
  registry: Map<string, ResolvedType>,
  name: string,
  attributes: Map<string, AttributeShapeDef>,
  rendersToDom: boolean,
  constructorBody: ASTNodeLike[] | null,
  errors: TSError[],
  span: Span,
  authority?: "server" | "local",
  tableName?: string | null,
  parentState?: string,  // §54.2 Phase 3b — set when this type is a substate
  transitions?: Map<string, TransitionInfo>,  // §54.3 Phase 4c — state-local transitions
): boolean {
  // E-STATE-005: collision with HTML element name
  if (getElementShape(name) !== null) {
    errors.push(new TSError(
      "E-STATE-005",
      `E-STATE-005: State type name \`${name}\` collides with a built-in HTML element name. ` +
      `Choose a different name for your state type.`,
      span,
    ));
    return false;
  }

  // E-AUTH-004: same type name with conflicting authority values (§52.3.4)
  const existing = registry.get(name) as StateType | undefined;
  if (existing && !existing.isHtml && existing.authority !== undefined && authority !== undefined) {
    if (existing.authority !== authority) {
      errors.push(new TSError(
        "E-AUTH-004",
        `E-AUTH-004: Conflicting authority declarations for type '${name}': cannot be both ` +
        `server-authoritative and local. Two declarations of the same state type must use ` +
        `the same authority= value, or be declared as two distinct types.`,
        span,
      ));
      return false;
    }
  }

  // E-STATE-006: duplicate state type name (already registered as user-defined).
  //
  // §54.2 Phase 3b exception: if the existing entry is a substate-forward-ref
  // placeholder (created when a substate registered before its parent), the
  // real parent registration SHALL overwrite it while preserving the accumulated
  // substates set. The placeholder is detectable by having an empty attribute
  // map and no constructorBody (never set outside the placeholder path).
  const isPlaceholder = existing && !existing.isHtml &&
    (existing as StateType).attributes.size === 0 &&
    (existing as StateType).constructorBody === null &&
    (existing as StateType).substates !== undefined;
  if (existing && !existing.isHtml && !isPlaceholder) {
    errors.push(new TSError(
      "E-STATE-006",
      `E-STATE-006: Duplicate state type definition for \`${name}\`. ` +
      `A state type with this name is already defined.`,
      span,
    ));
    return false;
  }

  // E-AUTH-003: authority="server" requires table= (§52.3.3)
  if (authority === "server" && !tableName) {
    errors.push(new TSError(
      "E-AUTH-003",
      `E-AUTH-003: State type '${name}' declares authority="server" but has no table= attribute. ` +
      `The compiler cannot generate sync infrastructure without a database table mapping. ` +
      `Add table="<tablename>" to the < ${name}> declaration.`,
      span,
    ));
    return false;
  }

  const newType = tState(name, attributes, false, rendersToDom, constructorBody, authority, tableName, parentState, transitions);
  // Preserve accumulated substates if this call overwrites a forward-ref
  // placeholder (set earlier by a substate that registered before its parent).
  if (isPlaceholder && (existing as StateType).substates) {
    newType.substates = (existing as StateType).substates;
  }
  registry.set(name, newType);

  // §54.2 Phase 3b: if this is a substate, add it to the parent state's
  // substates set. The parent may or may not be registered yet — handle both.
  if (parentState) {
    const parent = registry.get(parentState) as StateType | undefined;
    if (parent && parent.kind === "state") {
      if (!parent.substates) parent.substates = new Set<string>();
      parent.substates.add(name);
    } else {
      // Parent not yet registered. Create a placeholder StateType entry so
      // the forward reference is preserved. When the parent's own
      // state-constructor-def is visited later, its registerStateType call
      // will see the existing placeholder and E-STATE-006 (duplicate) guard
      // would fire. Avoid that: if the only existing entry is our placeholder,
      // allow the real registration to overwrite it while preserving substates.
      const placeholder = tState(parentState, new Map<string, AttributeShapeDef>(), false, false, null);
      placeholder.substates = new Set<string>([name]);
      registry.set(parentState, placeholder);
    }
  }

  return true;
}

/**
 * Look up a state type by name.
 */
function getStateType(registry: Map<string, ResolvedType>, name: string): ResolvedType | null {
  return registry.get(name) ?? null;
}

// ---------------------------------------------------------------------------
// §51.3 Machine Registry
// ---------------------------------------------------------------------------

/**
 * Build a machine registry from engine-decl AST nodes.
 * Validates each machine against the type registry and emits errors.
 *
 * @param machineDecls — engine-decl AST nodes from the file
 * @param typeRegistry — the file's type registry (enums, structs)
 * @param errors — error accumulator
 * @param fileSpan — span for error reporting
 */
function buildMachineRegistry(
  machineDecls: ASTNodeLike[],
  typeRegistry: Map<string, ResolvedType>,
  errors: TSError[],
  fileSpan: Span,
): Map<string, MachineType> {
  const registry = new Map<string, MachineType>();

  for (const decl of machineDecls) {
    const name = decl.engineName as string;
    const govName = decl.governedType as string;
    let rulesRaw = (decl.rulesRaw as string) || "";
    const span = (decl.span as Span) || fileSpan;
    const sourceVar = (decl.sourceVar as string | null | undefined) ?? null;

    // §51.11 (S24) — extract optional `audit @name` clause from the rules
    // body. Matches a top-level line of exactly `audit @Identifier`. Strip
    // it from rulesRaw before the rule parser runs so the parser doesn't
    // see an unparseable "rule". The audit clause may appear anywhere in
    // the body (usually last) and at most once.
    let auditTarget: string | null = null;
    const auditClauseRe = /(^|\n)\s*audit\s+@([A-Za-z_$][A-Za-z0-9_$]*)\s*(?=\n|$)/;
    const auditMatch = rulesRaw.match(auditClauseRe);
    if (auditMatch) {
      auditTarget = auditMatch[2];
      rulesRaw = rulesRaw.replace(auditClauseRe, "$1").trim();
      // Guard against multiple audit clauses — catch the second and error.
      if (auditClauseRe.test(rulesRaw)) {
        errors.push(new TSError(
          "E-ENGINE-019",
          `E-ENGINE-019: Machine '${name}' has more than one 'audit' clause. ` +
          `Only one audit target is permitted per machine.`,
          span,
        ));
      }
    }

    // E-ENGINE-003: duplicate machine name
    if (registry.has(name)) {
      errors.push(new TSError(
        "E-ENGINE-003",
        `E-ENGINE-003: Duplicate machine name '${name}'. ` +
        `A machine with this name is already declared in this file.`,
        span,
      ));
      continue;
    }

    // E-ENGINE-004: governed type must exist and be enum or struct
    const govType = typeRegistry.get(govName) ?? null;
    if (!govType) {
      errors.push(new TSError(
        "E-ENGINE-004",
        `E-ENGINE-004: Machine '${name}' references unknown type '${govName}'. ` +
        `The 'for' clause must name an enum or struct type declared in this file, ` +
        `or use a \`\${ import { ${govName} } from './path.scrml' }\` declaration to bring \`${govName}\` into scope.`,
        span,
      ));
      continue;
    }
    if (govType.kind !== "enum" && govType.kind !== "struct") {
      errors.push(new TSError(
        "E-ENGINE-004",
        `E-ENGINE-004: Machine '${name}' references type '${govName}' which is a ${govType.kind}, not an enum or struct. ` +
        `Machines can only govern enum or struct types. For primitive value constraints, use inline predicates (§53).`,
        span,
      ));
      continue;
    }

    // §51.0 modern-form dispatch (S75 — body-shape, not keyword): if the
    // body contains a PascalCase state-child opener (`<Variant ...>`), it's
    // the §51.0.B + §51.0.F modern engine form. SYM PASS 11 (B15) owns its
    // grammar and diagnostics (E-ENGINE-STATE-CHILD-MISSING /
    // E-ENGINE-STATE-CHILD-INVALID-VARIANT / E-ENGINE-RULE-INVALID-VARIANT
    // etc.). The TS-stage `parseMachineRules` only knows the legacy
    // arrow-rule grammar (§51.3 / §51.9), so applying it to a modern body
    // would silently match nothing and fire a false-positive E-ENGINE-005
    // ("no transition rules"). Skip parseMachineRules for modern bodies
    // and register a `MachineType` entry with empty rules so downstream
    // codegen still sees the engine name; modern engines have an
    // independent codegen path through `emit-engine.ts` keyed on
    // `engineMeta.stateChildren` (already populated by B15).
    //
    // Body-shape (not keyword) dispatches because §51.3.2 (P1 amendment)
    // permits `<engine>` over either body shape and existing samples use
    // `<engine>` over the legacy arrow body. The inline regex mirrors
    // B15's own classification (engine-statechild-parser.ts:88's
    // `isLegacyArrowRulesBody` heuristic, which checks the inverse).
    const hasStateChildOpener = /<\s*[A-Z]/.test(rulesRaw);

    // §51.9 — derived / projection machine. The source enum type is
    // resolved at this call's caller (after all type + machine decls are
    // registered), so we defer source-var validation to that later pass.
    // For now we still parse the projection rules against the governed type
    // (the projection's OWN type, which is what `.Editable`/`.ReadOnly`
    // variants refer to on the RHS).
    if (sourceVar) {
      if (hasStateChildOpener) {
        // Modern-form derived engine — B15 + B16 own diagnostics. Register
        // a derived MachineType entry with empty rules; emit-engine.ts will
        // codegen from engineMeta.stateChildren.
        registry.set(name, {
          kind: "machine",
          name,
          governedTypeName: govName,
          governedType: govType,
          rules: [],
          isDerived: true,
          sourceVar,
          projectedVarName: engineNameToProjectedVar(name),
          auditTarget,
        });
        continue;
      }
      // Projection rules use a slightly different shape: LHS is the SOURCE
      // variant(s), RHS is a single PROJECTION variant (single variant-ref,
      // no alternation per §51.9.2). LHS variant names are validated against
      // the source enum; RHS against the projection enum. Since we don't yet
      // know the source type here, we parse with `null` and let the caller
      // do cross-registry validation.
      const projectionRules = parseMachineRules(rulesRaw, govType, name, errors, span, /*isProjection=*/true);
      if (projectionRules.length === 0) {
        errors.push(new TSError(
          "E-ENGINE-005",
          `E-ENGINE-005: Derived machine '${name}' has no projection rules. ` +
          `Add at least one rule mapping source variants to projection variants.`,
          span,
        ));
        continue;
      }

      registry.set(name, {
        kind: "machine",
        name,
        governedTypeName: govName,
        governedType: govType,
        rules: projectionRules,
        isDerived: true,
        sourceVar,
        // §51.9.3 worked example: `< machine UI ... >` → `@ui`. Lowercase the
        // leading uppercase run so abbreviation-style names (UI, IP, HTTP)
        // stay all-lowercase while PascalCase names (Order, OrderStatus) only
        // lose the leading capital.
        projectedVarName: engineNameToProjectedVar(name),
        auditTarget,
      });
      continue;
    }

    if (hasStateChildOpener) {
      // Modern-form (non-derived) engine — body has `<Variant ...>` openers.
      // Skip parseMachineRules; B15 fires the §51.0 family of diagnostics.
      registry.set(name, {
        kind: "machine",
        name,
        governedTypeName: govName,
        governedType: govType,
        rules: [],
        auditTarget,
      });
      continue;
    }

    // Parse the rules from rulesRaw
    const rules = parseMachineRules(rulesRaw, govType, name, errors, span);

    // E-ENGINE-005: empty machine body
    if (rules.length === 0) {
      errors.push(new TSError(
        "E-ENGINE-005",
        `E-ENGINE-005: Machine '${name}' has no transition rules. ` +
        `A machine with an empty body serves no purpose. Add at least one rule.`,
        span,
      ));
      continue;
    }

    registry.set(name, {
      kind: "machine",
      name,
      governedTypeName: govName,
      governedType: govType,
      rules,
      auditTarget,
    });
  }

  return registry;
}

/**
 * §51.9 — Map a machine name to its synthesized projected reactive var name.
 * Lowercases the leading uppercase run: `UI` → `ui`, `Order` → `order`,
 * `UIMode` → `uiMode`, `HTTPStatus` → `httpStatus`.
 */
function engineNameToProjectedVar(name: string): string {
  return name.replace(/^[A-Z]+(?=[A-Z][a-z])|^[A-Z]+$|^[A-Z]/, m => m.toLowerCase());
}

/**
 * §51.9 — E-ENGINE-017: detect writes to a projected (derived) variable.
 * The user must not declare `@ui: UI = ...` or assign `@ui = ...` when `ui`
 * is the synthesized projection of a derived machine. Walks the AST looking
 * for state-decls whose name matches a projected var AND for bare-expr
 * nodes whose text starts with `@name = ...` where name matches.
 */
export function rejectWritesToDerivedVars(
  nodes: ASTNodeLike[],
  projectedVars: Map<string, MachineType>,
  errors: TSError[],
  fileSpan: Span,
): void {
  if (projectedVars.size === 0) return;

  const assignRe = /^\s*@([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\+|-|\*|\/|%|\?\?)?=/;

  function report(varName: string, span: Span): void {
    const machine = projectedVars.get(varName)!;
    errors.push(new TSError(
      "E-ENGINE-017",
      `E-ENGINE-017: Cannot assign to '@${varName}' — it is a derived projection of ` +
      `'@${machine.sourceVar}' (see < machine ${machine.name}>). Assign to the source instead.`,
      span,
    ));
  }

  function walk(ns: ASTNodeLike[]): void {
    for (const n of ns) {
      if (!n || typeof n !== "object") continue;
      const span = (n.span as Span | undefined) ?? fileSpan;

      // Reactive declaration of a projected var.
      if (n.kind === "state-decl" && typeof n.name === "string" && projectedVars.has(n.name)) {
        report(n.name, span);
      }

      // Reactive assignment surfaced as a bare-expr — `@ui = X`, `@ui += Y`, etc.
      if (n.kind === "bare-expr") {
        const exprText = (n as ASTNodeLike).exprNode
          ? emitStringFromTree((n as ASTNodeLike).exprNode as import("./types/ast.ts").ExprNode)
          : (typeof (n as ASTNodeLike).expr === "string" ? ((n as ASTNodeLike).expr as string) : "");
        const m = assignRe.exec(exprText);
        if (m && projectedVars.has(m[1])) {
          report(m[1], span);
        }
      }

      const body = n.body as ASTNodeLike[] | undefined;
      if (Array.isArray(body)) walk(body);
      const children = n.children as ASTNodeLike[] | undefined;
      if (Array.isArray(children)) walk(children);
    }
  }
  walk(nodes);
}

/**
 * §51.9 — Validate derived machines once state-decl annotations are known.
 *
 * This runs after the main TS walk has annotated state-decl nodes. It:
 *   1. For each derived machine, looks up its `sourceVar` among the file's
 *      machine-bound reactive declarations. If the source var is unknown or
 *      isn't machine-bound, emits a diagnostic (reuses E-ENGINE-004 family —
 *      "references unknown source variable").
 *   2. Rejects transitive projections (source itself a derived machine) —
 *      §51.9.7 defers this.
 *   3. Checks that every variant of the source enum has at least one rule
 *      whose `from` covers it. Emits E-ENGINE-018 per missing variant.
 *
 * @param machineRegistry — populated derived machine entries
 * @param reactiveBindings — map of reactive-var-name → bound MachineType
 * @param errors — error accumulator (derived-machine errors appended)
 * @param fileSpan — fallback span
 */
export function validateDerivedMachines(
  machineRegistry: Map<string, MachineType>,
  reactiveBindings: Map<string, MachineType>,
  errors: TSError[],
  fileSpan: Span,
): void {
  for (const [engineName, machine] of machineRegistry) {
    if (!machine.isDerived) continue;
    const sourceVar = machine.sourceVar!;
    const sourceMachine = reactiveBindings.get(sourceVar) ?? null;

    if (!sourceMachine) {
      errors.push(new TSError(
        "E-ENGINE-004",
        `E-ENGINE-004: Derived machine '${engineName}' references source variable ` +
        `'@${sourceVar}', but no machine-bound reactive with that name was found in scope. ` +
        `The 'derived from @var' clause must name a reactive variable whose type is a machine (e.g., ` +
        `'@${sourceVar}: SomeMachine = ...').`,
        fileSpan,
      ));
      continue;
    }

    // §51.9.7 — transitive projection is deferred.
    if (sourceMachine.isDerived) {
      errors.push(new TSError(
        "E-ENGINE-004",
        `E-ENGINE-004: Derived machine '${engineName}' derives from '@${sourceVar}', which is ` +
        `itself a projected (derived) variable. Transitive projection is not supported in this ` +
        `revision — derive '${engineName}' directly from the underlying source machine instead.`,
        fileSpan,
      ));
      continue;
    }

    // Exhaustiveness: every variant of the source enum must appear as a
    // `from` somewhere in the rules (directly or via alternation — and since
    // `expandAlternation` already ran in parseMachineRules, each rule has a
    // single `from`). Ignore rules with a `given` guard for coverage purposes
    // UNLESS there's also an unguarded rule for the same variant — §51.9.3
    // says an unguarded rule terminates its alternation group.
    const sourceEnum = sourceMachine.governedType;
    if (!sourceEnum || sourceEnum.kind !== "enum") continue; // struct-sourced projections are out of scope.
    const variantNames = (sourceEnum as EnumType).variants.map(v => v.name);
    const coveredUnguarded = new Set<string>();
    for (const rule of machine.rules) {
      if (rule.guard == null) coveredUnguarded.add(rule.from);
    }
    const missing = variantNames.filter(v => !coveredUnguarded.has(v));
    for (const miss of missing) {
      errors.push(new TSError(
        "E-ENGINE-018",
        `E-ENGINE-018: Derived machine '${engineName}' does not project variant '.${miss}' of ` +
        `'${(sourceEnum as EnumType).name}'. Every source variant must be mapped, or use ` +
        `'else => .Variant' for a catch-all.`,
        fileSpan,
      ));
    }
  }
}

/**
 * Expand `|` alternation in a single machine rule line into N single-pair lines.
 *
 * `.A | .B => .C | .D given (g) [lbl] { eff }`
 *   → `.A => .C given (g) [lbl] { eff }`
 *   → `.A => .D given (g) [lbl] { eff }`
 *   → `.B => .C given (g) [lbl] { eff }`
 *   → `.B => .D given (g) [lbl] { eff }`
 *
 * §51.3.2 (S22) — payload-binding support:
 *   `.Charging(n) | .Firing(n) => .Idle given (n > 0)` is valid (both alternatives
 *   bind `n`). Mixed bindings (`.A(x) | .B(y)` or `.A(x) | .B`) emit E-ENGINE-016.
 *   Alternatives with bindings against unit variants are caught by
 *   resolveRuleBindings later with E-ENGINE-015.
 *
 * Lines without `|` (including `* => *` and plain `.A => .B`) pass through unchanged.
 */
function expandAlternation(
  line: string,
  engineName: string,
  errors: TSError[],
  span: Span,
): string[] {
  const arrowIdx = line.indexOf("=>");
  if (arrowIdx < 0) return [line];

  const lhsRaw = line.slice(0, arrowIdx).trim();
  const rhsRest = line.slice(arrowIdx + 2);

  // Find the end of the RHS variant portion — stops at `given`, `[`, or an
  // effect-`{`. Parens from binding lists are NOT `{`; we stop at the OUTER
  // `{` (at depth 0 w.r.t. parens).
  //
  // Detecting `given` is tricky when bindings contain spaces; scan rhsRest
  // character-by-character tracking paren depth and looking for the earliest
  // suffix start at depth 0.
  let suffixStart = rhsRest.length;
  {
    let pd = 0;
    for (let i = 0; i < rhsRest.length; i++) {
      const ch = rhsRest[i];
      if (ch === "(") pd++;
      else if (ch === ")") pd--;
      else if (pd === 0) {
        if (ch === "[" || ch === "{") { suffixStart = i; break; }
        if (rhsRest.slice(i, i + 5) === "given" && (i + 5 >= rhsRest.length || /\s|\(/.test(rhsRest[i + 5]))) {
          suffixStart = i;
          break;
        }
      }
    }
  }
  const rhsVariants = rhsRest.slice(0, suffixStart).trim();
  const suffix = rhsRest.slice(suffixStart).trimStart();

  // Split LHS / RHS on `|` at paren depth 0 (so `.A(x, y)` doesn't split at its
  // internal comma — but `|` is what we care about here, and binding lists
  // don't contain `|`, so a simpler top-level split is fine).
  const splitTopLevelPipe = (s: string): string[] => {
    const out: string[] = [];
    let buf = "";
    let pd = 0;
    for (const ch of s) {
      if (ch === "(") { pd++; buf += ch; continue; }
      if (ch === ")") { pd--; buf += ch; continue; }
      if (ch === "|" && pd === 0) {
        if (buf.trim()) out.push(buf.trim());
        buf = "";
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  };

  const lhsHasPipe = splitTopLevelPipe(lhsRaw).length > 1;
  const rhsHasPipe = splitTopLevelPipe(rhsVariants).length > 1;
  if (!lhsHasPipe && !rhsHasPipe) return [line];

  const lhsParts = splitTopLevelPipe(lhsRaw);
  const rhsParts = splitTopLevelPipe(rhsVariants);
  if (lhsParts.length === 0 || rhsParts.length === 0) return [line];

  // §51.3.2 (S22) — E-ENGINE-016: when a side has multiple alternatives and at
  // least one carries a binding, ALL alternatives on that side must declare an
  // identically-named binding set. We check the raw binding text here — name
  // resolution is tolerant of order, but the spec requires identical-name sets.
  const checkBindingParity = (parts: string[], sideLabel: "from" | "to") => {
    if (parts.length < 2) return;
    const bindingSignatures = parts.map(extractBindingSignature);
    // signatures are a sorted, comma-joined string of `local` or `field:local`
    // tokens — empty string when no binding group. Mismatch → E-ENGINE-016.
    const first = bindingSignatures[0];
    for (let i = 1; i < bindingSignatures.length; i++) {
      if (bindingSignatures[i] !== first) {
        errors.push(new TSError(
          "E-ENGINE-016",
          `E-ENGINE-016: Machine '${engineName}' rule uses '|' alternation with mismatched variant ` +
          `payload bindings on the ${sideLabel} side. Either every alternative binds the same names, or ` +
          `none bind. Got: ${parts.join(" | ")}.`,
          span,
        ));
        return;
      }
    }
  };
  checkBindingParity(lhsParts, "from");
  checkBindingParity(rhsParts, "to");

  const expanded: string[] = [];
  for (const lhs of lhsParts) {
    for (const rhs of rhsParts) {
      const body = suffix ? `${lhs} => ${rhs} ${suffix}` : `${lhs} => ${rhs}`;
      expanded.push(body);
    }
  }
  return expanded;
}

/**
 * §51.3.2 (S22) helper — Extract a canonical, sort-stable signature of a
 * binding group from a single variant-ref fragment like ".Charging(n)" or
 * ".Firing(shot: s)". Returns `""` when no binding group is present.
 *
 * The signature is used only to compare two alternatives' binding shapes for
 * E-ENGINE-016 — it does not need to match runtime semantics.
 */
function extractBindingSignature(variantRef: string): string {
  const parenIdx = variantRef.indexOf("(");
  if (parenIdx === -1) return "";
  const closeIdx = variantRef.lastIndexOf(")");
  if (closeIdx <= parenIdx) return "";
  const raw = variantRef.slice(parenIdx + 1, closeIdx).trim();
  if (!raw) return "";
  const tokens = raw.split(",").map(s => s.replace(/\s+/g, "").trim()).filter(Boolean).sort();
  return tokens.join(",");
}

/**
 * Parse machine rules from raw text.
 * Format: `.From => .To`, `.From => .To given (guard)`, `* => *` wildcards.
 * Guards ARE permitted in machine rules (unlike type-level transitions).
 *
 * §51.9 — when `isProjection` is true, rules are projection-rules (derived
 * machine): LHS is one or more SOURCE variants, RHS is a single PROJECTION
 * variant. The LHS variant names cannot be validated here (the source enum
 * lives in a different machine's `governedType` reachable only through the
 * reactive registry); cross-enum validation runs in
 * `validateDerivedMachineExhaustiveness` after all registries are built.
 * `govType` in this case is the PROJECTION enum, so the RHS variant names
 * ARE validated against it.
 */
/**
 * Split machine-rule raw text on `\n` or `;` separators that live at depth 0.
 * Separators inside `{}` / `()` / `[]` or inside string / comment contexts
 * do not split — so a multi-statement effect body like
 * `.A => .B { @a = 1; @b = 2 }` stays on one rule instead of fragmenting
 * into three broken lines.
 */
function splitRuleLines(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inLineComment) {
      cur += ch;
      if (ch === "\n") { inLineComment = false; }
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") { cur += "/"; i++; inBlockComment = false; }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "\\") { cur += raw[i + 1] ?? ""; i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; cur += ch; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; cur += ch; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; cur += ch; continue; }
    if (ch === "{" || ch === "(" || ch === "[") { depth++; cur += ch; continue; }
    if (ch === "}" || ch === ")" || ch === "]") { depth--; cur += ch; continue; }
    if ((ch === "\n" || ch === ";") && depth === 0) {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

function parseMachineRules(
  raw: string,
  govType: ResolvedType,
  engineName: string,
  errors: TSError[],
  span: Span,
  isProjection: boolean = false,
): TransitionRule[] {
  const rules: TransitionRule[] = [];
  if (!raw.trim()) return rules;

  // Split on `\n` / `;` at depth 0 — braces in effect bodies keep their
  // contents intact. (Pre-S28 this was `raw.split(/[\n;]/)` which fragmented
  // `{ @a = 1; @b = 2 }` into three broken lines.)
  const rawLines = splitRuleLines(raw);

  // Expand `|` alternation on either side of `=>` into single-pair rules.
  // `.A | .B => .C | .D` becomes four lines: .A=>.C, .A=>.D, .B=>.C, .B=>.D.
  // Preserves any guard / label / effect block on each expanded line.
  // The `* => *` struct-wildcard form contains no `|` and is passed through.
  const lines: string[] = [];
  const dedupeSet = new Set<string>();
  for (const line of rawLines) {
    if (line.startsWith("//")) { lines.push(line); continue; }
    for (const expanded of expandAlternation(line, engineName, errors, span)) {
      const key = expanded.replace(/\s+/g, " ").trim();
      if (dedupeSet.has(key)) {
        errors.push(new TSError(
          "E-ENGINE-014",
          `E-ENGINE-014: Machine '${engineName}' has a duplicate transition rule '${key}'. ` +
          `A rule cannot repeat the same from→to pair. Remove the duplicate.`,
          span,
        ));
        continue;
      }
      dedupeSet.add(key);
      lines.push(expanded);
    }
  }

  for (const rawLine of lines) {
    // Skip comment lines
    if (rawLine.startsWith("//")) continue;

    // §51.12 (S25) — Temporal transitions.
    // §51.12.3.1 (S67 amendment) — Computed-delay form `after ${expr}<unit>`.
    //
    // Extract the `after <duration>` fragment between the from-spec and `=>`,
    // strip it from the line, and parse via the shared `parseAfterDuration`
    // helper (which handles BOTH literal and computed forms). The remaining
    // rule regex below runs against the stripped line. Non-temporal rules
    // have both afterMs and afterExpr === null.
    //
    // Match shape covers both:
    //   .X after 30s => .Y                   (literal — afterMs populated)
    //   .X after ${@delay}ms => .Y           (computed — afterExpr populated)
    //   .X after ${Math.min(a,b)}ms => .Y    (computed with parens inside expr)
    //
    // The capturing group permits `${...}` (single-level brace match per
    // §51.12.3.1 — spec examples use parens, not nested braces) OR a literal
    // numeric form. Both followed by a unit suffix.
    let afterMs: number | null = null;
    let afterExpr: string | null = null;
    let line = rawLine;
    const afterMatch = line.match(
      /\s+after\s+(\$\{[^}]*\}|\d+(?:\.\d+)?)\s*(ms|s|m|h)\s+(?==>)/i
    );
    if (afterMatch) {
      const rawDuration = `${afterMatch[1]}${afterMatch[2]}`;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parseAfterDuration } = require("./codegen/parse-after-duration.ts");
      const parsed = parseAfterDuration(rawDuration);
      if (parsed.kind === "literal") {
        afterMs = parsed.ms;
      } else if (parsed.kind === "computed") {
        // Store the FULL expression text including the unit multiplier so
        // codegen can emit `(${exprText}) * <multiplier>` directly. Reactive
        // reads (@var) are LEFT UNREWRITTEN here — codegen's emit-machines.ts
        // path passes the text through rewriteExpr at emit time so
        // `_scrml_reactive_get` wires correctly.
        afterExpr = `(${parsed.exprText}) * ${parsed.unitMultiplier}`;
      } else {
        // kind === "invalid"
        errors.push(new TSError(
          "E-ENGINE-021",
          `E-ENGINE-021: Machine '${engineName}' temporal transition has an invalid duration \`${rawDuration}\`. ` +
          `Duration must be a finite non-negative number with a unit (ms/s/m/h), or a computed expression \`\${expr}<unit>\`. ` +
          `Example: \`.Loading after 30s => .TimedOut\` or \`.Connecting after \${@backoffDelay}ms => .Open\`. ` +
          `(${parsed.reason})`,
          span,
        ));
      }
      // Strip the `after X` fragment so the existing regex doesn't see it.
      line = line.replace(afterMatch[0], " ");
    }

    // Match: .From[(binding-list)] => .To[(binding-list)] [given (guard)] [{effect}]
    // Variant names must be PascalCase (per §14.4); constraining them excludes
    // keywords like `given` so the regex doesn't greedily capture the wrong
    // token. Binding-list is any non-paren content and must be adjacent to
    // the variant name (no intervening whitespace).
    const ruleMatch = line.match(
      /^(?:\.|\:\:|\*)\s*([A-Z][A-Za-z0-9_]*|\*)?(?:\(([^)]*)\))?\s*=>\s*(?:\.|\:\:|\*)\s*([A-Z][A-Za-z0-9_]*|\*)?(?:\(([^)]*)\))?\s*(?:given\s*\(([^)]*)\))?\s*(?:\[(\w+)\])?\s*(\{[\s\S]*\})?\s*$/
    );
    if (!ruleMatch) {
      // Try simpler: just .X => .Y or * => .Y
      const simpleMatch = line.match(
        /^(?:\.|\:\:)(\w+)\s*=>\s*(?:\.|\:\:)(\w+)/
      );
      const wildcardMatch = line.match(
        /^\*\s*=>\s*(?:\.|\:\:)(\w+)/
      );
      if (simpleMatch) {
        rules.push({
          from: simpleMatch[1],
          to: simpleMatch[2],
          guard: null,
          label: null,
          effectBody: null,
          fromBindings: null,
          toBindings: null,
          afterMs,
          afterExpr,
        });
        continue;
      }
      if (wildcardMatch) {
        rules.push({
          from: "*",
          to: wildcardMatch[1],
          guard: null,
          label: null,
          effectBody: null,
          fromBindings: null,
          toBindings: null,
          afterMs,
          afterExpr,
        });
        continue;
      }
      // * => * given (guard) for struct-governing machines
      const structWildcard = line.match(
        /^\*\s*=>\s*\*\s*given\s*\(([^)]*)\)\s*(?:\[(\w+)\])?\s*$/
      );
      if (structWildcard) {
        rules.push({
          from: "*",
          to: "*",
          guard: structWildcard[1].trim(),
          label: structWildcard[2] || null,
          effectBody: null,
          fromBindings: null,
          toBindings: null,
          afterMs,
          afterExpr,
        });
        continue;
      }
      continue; // skip unparseable lines
    }

    const from = ruleMatch[1] || "*";
    const fromBindingsRaw = ruleMatch[2] ?? null;
    const to = ruleMatch[3] || "*";
    const toBindingsRaw = ruleMatch[4] ?? null;
    const guard = ruleMatch[5] ? ruleMatch[5].trim() : null;
    const label = ruleMatch[6] || null;
    const effectBody = ruleMatch[7] ? ruleMatch[7].slice(1, -1).trim() : null;

    // Validate variant names against governed type (for enums).
    // §51.9 — for projection machines, the LHS variants are from the SOURCE
    // enum (unknown here); only the RHS is validated against `govType` (the
    // projection enum). LHS validation runs later in
    // `validateDerivedMachineExhaustiveness` once the source-var binding is
    // resolved.
    if (govType.kind === "enum") {
      const enumType = govType as EnumType;
      const variantNames = new Set(enumType.variants.map(v => v.name));
      if (!isProjection && from !== "*" && !variantNames.has(from)) {
        errors.push(new TSError(
          "E-ENGINE-004",
          `E-ENGINE-004: Machine '${engineName}' rule references unknown variant '${from}' ` +
          `in type '${enumType.name}'. Valid variants: ${[...variantNames].join(", ")}.`,
          span,
        ));
      }
      if (to !== "*" && !variantNames.has(to)) {
        errors.push(new TSError(
          "E-ENGINE-004",
          `E-ENGINE-004: Machine '${engineName}' rule references unknown variant '${to}' ` +
          `in type '${enumType.name}'. Valid variants: ${[...variantNames].join(", ")}.`,
          span,
        ));
      }
    }

    // §51.3.2 (S22) — resolve payload bindings on either side.
    // For projection machines the LHS is the source enum (resolved later in
    // `validateDerivedMachineExhaustiveness`), so we skip binding resolution
    // on the from-side here. §51.9.7 explicitly defers projection binding.
    const fromBindings = (!isProjection && fromBindingsRaw !== null)
      ? resolveRuleBindings(fromBindingsRaw, govType, from, engineName, "from", errors, span)
      : null;
    const toBindings = toBindingsRaw !== null
      ? resolveRuleBindings(toBindingsRaw, govType, to, engineName, "to", errors, span)
      : null;

    // Validate self.* references for struct-governing machines
    if (govType.kind === "struct" && guard) {
      const structType = govType as StructType;
      const selfRefs = guard.match(/self\.(\w+)/g) || [];
      for (const ref of selfRefs) {
        const fieldName = ref.slice(5); // strip "self."
        if (!structType.fields.has(fieldName)) {
          errors.push(new TSError(
            "E-ENGINE-013",
            `E-ENGINE-013: Machine '${engineName}' guard references undefined field 'self.${fieldName}' ` +
            `in struct type '${(govType as StructType).name}'. Valid fields: ${[...structType.fields.keys()].join(", ")}.`,
            span,
          ));
        }
      }
    }

    // §51.12 validation — temporal rule with a guard or effect is allowed
    // (the timer fires the transition, then the guard/effect runs as usual).
    // Temporal rule with a wildcard `from` (`* after Xs => .Y`) is rejected:
    // without a specific source variant, there's no entry edge to start the
    // timer from.
    if ((afterMs !== null || afterExpr !== null) && from === "*") {
      errors.push(new TSError(
        "E-ENGINE-021",
        `E-ENGINE-021: Machine '${engineName}' temporal transition uses a wildcard \`from\`. ` +
        `Temporal rules must name a specific \`from\` variant so the compiler knows when to ` +
        `start the timer. Either name a specific \`from\` (e.g. \`.Loading after 30s => .TimedOut\`) ` +
        `or remove the \`after\` clause.`,
        span,
      ));
    }

    rules.push({ from, to, guard, label, effectBody, fromBindings, toBindings, afterMs, afterExpr });
  }

  return rules;
}

/**
 * §51.3.2 (S22) — Parse the raw contents of a machine-rule binding-list and
 * resolve it against the declared payload fields of the target variant.
 *
 *   raw="l"          variantName="Charging"  — positional, binds .data.level
 *   raw="level: l"   variantName="Charging"  — named, binds .data.level
 *   raw="_, h"       variantName="Rect"      — discard first, bind second
 *
 * Emits E-ENGINE-015 if:
 *   - the target variant is a unit variant (has no payload at all)
 *   - a named field doesn't exist on the variant
 *   - a positional binding runs past the variant's field list
 *
 * Returns `[]` for a binding-list with only discards (valid, but nothing to emit).
 * Returns `null` only when the variant is unknown (wildcard or cascade-error).
 */
function resolveRuleBindings(
  raw: string,
  govType: ResolvedType,
  variantName: string,
  engineName: string,
  side: "from" | "to",
  errors: TSError[],
  span: Span,
): RuleBinding[] | null {
  // Wildcard rules (`* => *`) carry no binding info. Bindings on struct-
  // governing machines are not part of the §51.3.2 amendment.
  if (variantName === "*") return null;
  if (govType.kind !== "enum") return null;

  const enumType = govType as EnumType;
  const variant = enumType.variants.find(v => v.name === variantName);
  if (!variant) return null;

  // Binding on a unit variant — the variant has no payload to destructure.
  if (variant.payload == null) {
    errors.push(new TSError(
      "E-ENGINE-015",
      `E-ENGINE-015: Machine '${engineName}' rule binds payload on '.${variantName}' ` +
      `(${side}), but '.${variantName}' is a unit variant with no payload. Remove the binding-group, ` +
      `or declare payload fields on '.${variantName}'.`,
      span,
    ));
    return null;
  }

  const declaredFields = Array.from(variant.payload.keys());
  const out: RuleBinding[] = [];
  const parts = raw.split(",").map(s => s.trim()).filter(s => s.length > 0);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const colonIdx = part.indexOf(":");
    if (colonIdx !== -1) {
      // Named: `field: local`
      const fieldName = part.slice(0, colonIdx).trim();
      const localName = part.slice(colonIdx + 1).trim();
      if (!variant.payload.has(fieldName)) {
        errors.push(new TSError(
          "E-ENGINE-015",
          `E-ENGINE-015: Machine '${engineName}' rule for '.${variantName}' binds field ` +
          `'${fieldName}' which is not a field of the variant. Declared fields: ${declaredFields.join(", ")}.`,
          span,
        ));
        continue;
      }
      if (localName === "_") continue; // discard — valid, but no runtime binding needed
      out.push({ localName, fieldName });
    } else {
      // Positional: bare ident, or `_` discard
      if (part === "_") continue;
      if (i >= declaredFields.length) {
        errors.push(new TSError(
          "E-ENGINE-015",
          `E-ENGINE-015: Machine '${engineName}' rule for '.${variantName}' has more positional ` +
          `bindings (${parts.length}) than the variant has fields (${declaredFields.length}: ${declaredFields.join(", ")}).`,
          span,
        ));
        continue;
      }
      out.push({ localName: part, fieldName: declaredFields[i] });
    }
  }
  return out;
}

/**
 * Check if a reactive variable declaration has a machine binding annotation.
 * Returns the machine name if `@var: MachineName = value` and MachineName
 * resolves to a machine, or null otherwise.
 */
function resolveMachineBinding(
  typeAnnotation: string | null,
  machineRegistry: Map<string, MachineType>,
): MachineType | null {
  if (!typeAnnotation) return null;
  const name = typeAnnotation.trim();
  return machineRegistry.get(name) ?? null;
}

// ---------------------------------------------------------------------------
// DB-schema type generator (§14.8)
// ---------------------------------------------------------------------------

interface GeneratedDbTypes {
  generatedNames: Map<string, { fullType: ResolvedType; clientType: ResolvedType }>;
  errors: TSError[];
}

/**
 * Generate db-schema-derived struct types for a single `< db>` block.
 */
function generateDbTypes(
  dbTypeViews: DBTypeViews,
  stateBlockId: string,
  blockSpan: Span,
  userTypeRegistry: Map<string, ResolvedType>,
): GeneratedDbTypes {
  const errors: TSError[] = [];
  const generatedNames = new Map<string, { fullType: ResolvedType; clientType: ResolvedType }>();

  if (!dbTypeViews || !dbTypeViews.tables) {
    return { generatedNames, errors };
  }

  // Track names generated within this db block to detect inter-table collisions.
  const seenNamesThisBlock = new Map<string, string>();

  for (const [tableName, tableTypeView] of dbTypeViews.tables) {
    const { name: generatedName, error: initCapError } = initCap(tableName);

    if (initCapError) {
      errors.push(new TSError(
        "E-TYPE-052",
        `E-TYPE-052: Table name \`${tableName}\` produces an invalid scrml identifier after the InitCap algorithm. ` +
        `Table names must produce valid identifiers (beginning with an ASCII letter or underscore, ` +
        `containing only alphanumeric characters and underscores). Got: "${tableName}".`,
        blockSpan,
      ));
      continue;
    }

    // E-TYPE-050: collision with another table in the same block.
    if (seenNamesThisBlock.has(generatedName!)) {
      const otherTable = seenNamesThisBlock.get(generatedName!);
      errors.push(new TSError(
        "E-TYPE-050",
        `E-TYPE-050: Tables \`${otherTable}\` and \`${tableName}\` in the same \`< db>\` block ` +
        `both produce the generated type name \`${generatedName}\`. Rename one of the tables to resolve the collision.`,
        blockSpan,
      ));
      continue;
    }

    // E-TYPE-050: collision with a user-declared type.
    if (userTypeRegistry && userTypeRegistry.has(generatedName!) &&
        !BUILTIN_TYPES.has(generatedName!)) {
      errors.push(new TSError(
        "E-TYPE-050",
        `E-TYPE-050: The generated type name \`${generatedName}\` (from table \`${tableName}\`) ` +
        `collides with a user-declared type. Rename the table or the user-declared type.`,
        blockSpan,
      ));
      // Per §14.8.4: continue with the generated type, accumulate the error.
    }

    seenNamesThisBlock.set(generatedName!, tableName);

    // Build full-schema struct type.
    const fullFields = new Map<string, ResolvedType>();
    for (const col of (tableTypeView.fullSchema ?? [])) {
      const { type, warning } = mapSqliteType(col.sqlType, col.nullable);
      if (warning) {
        errors.push(new TSError(
          "E-TYPE-051",
          `E-TYPE-051: Column \`${col.name}\` in table \`${tableName}\` has type ` +
          `\`${col.sqlType}\` which is not mappable after the SQLite affinity algorithm. ` +
          `The column has been typed as \`asIs\`. Declare an explicit type or use a recognized SQLite type.`,
          blockSpan,
          "warning",
        ));
      }
      fullFields.set(col.name, type);
    }
    const fullType = tStruct(generatedName!, fullFields);

    // Build client-schema struct type.
    const clientFields = new Map<string, ResolvedType>();
    for (const col of (tableTypeView.clientSchema ?? [])) {
      const { type } = mapSqliteType(col.sqlType, col.nullable);
      clientFields.set(col.name, type);
    }
    const clientType = tStruct(generatedName!, clientFields);

    generatedNames.set(generatedName!, { fullType, clientType });
  }

  return { generatedNames, errors };
}

// ---------------------------------------------------------------------------
// A5 (2026-05-17) — Destructuring pattern name iteration (structural walk)
// ---------------------------------------------------------------------------
//
// Replaces A1's regex-based extractDestructuredNames + bare-expr scraping.
// Since A5, ast-builder.js emits structured DestructurePattern nodes on
// const-decl.name / let-decl.name / for-stmt.variable for destructured LHS.
// This walker yields the bound names from a pattern (alias side for object
// properties; rest names; recursive into nested patterns).
//
// Shape (mirrors types/ast.ts DestructurePattern):
//   { kind: "destructure-array",  elements: [{kind: "name"|"nested"|"hole", ...}], rest? }
//   { kind: "destructure-object", properties: [{kind: "name"|"nested", ...}], rest? }

interface DestructureArrayElementShape {
  kind: "name" | "nested" | "hole";
  name?: string;
  pattern?: DestructurePatternShape;
}
interface DestructureObjectPropertyShape {
  kind: "name" | "nested";
  fieldName?: string;
  bindName?: string;
  pattern?: DestructurePatternShape;
}
type DestructurePatternShape =
  | {
      kind: "destructure-array";
      elements: DestructureArrayElementShape[];
      rest?: string;
    }
  | {
      kind: "destructure-object";
      properties: DestructureObjectPropertyShape[];
      rest?: string;
    };

function isDestructurePattern(v: unknown): v is DestructurePatternShape {
  if (!v || typeof v !== "object") return false;
  const k = (v as { kind?: unknown }).kind;
  return k === "destructure-array" || k === "destructure-object";
}

function* iterDestructuredNames(p: DestructurePatternShape): Iterable<string> {
  if (p.kind === "destructure-array") {
    for (const el of p.elements) {
      if (el.kind === "name" && typeof el.name === "string" && el.name.length > 0) {
        yield el.name;
      } else if (el.kind === "nested" && el.pattern) {
        yield* iterDestructuredNames(el.pattern);
      }
      // holes contribute nothing
    }
    if (p.rest) yield p.rest;
  } else {
    for (const prop of p.properties) {
      if (prop.kind === "nested" && prop.pattern) {
        yield* iterDestructuredNames(prop.pattern);
      } else if (prop.kind === "name" && typeof prop.bindName === "string" && prop.bindName.length > 0) {
        yield prop.bindName;
      }
    }
    if (p.rest) yield p.rest;
  }
}

// ---------------------------------------------------------------------------
// §2a — E-SCOPE-001 in logic expressions
// ---------------------------------------------------------------------------

/**
 * Globals that may appear as bare identifiers in scrml logic expressions without
 * being declared in scrml source. Kept conservative on purpose: easier to add an
 * entry when a legitimate false positive surfaces than to debug a reported
 * surprise where a typo compiled clean because the allowlist was too generous.
 */
const LOGIC_SCOPE_GLOBAL_ALLOWLIST: ReadonlySet<string> = new Set([
  // JS language globals + constructors
  "Math", "JSON", "Array", "Object", "Number", "String", "Boolean",
  "Date", "Promise", "Set", "Map", "WeakMap", "WeakSet", "Symbol",
  "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent",
  // S90 M-7C-D-12 Track 1 (D-12.1e): `"undefined"` and `"null"` removed from
  // the logic-scope allowlist so scope-check no longer silently passes user-
  // source `null` / `undefined` identifiers. E-SYNTAX-042 fires earlier
  // (gauntlet-phase3) for any source-position occurrence per §42.
  "true", "false", "NaN", "Infinity",
  // Browser / DOM / Node runtime
  "console", "document", "window", "globalThis", "navigator",
  "location", "history", "localStorage", "sessionStorage",
  "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame",
  "performance", "crypto", "alert", "confirm", "prompt",
  "URL", "URLSearchParams", "Buffer", "process",
  // Language keywords that may surface as idents after expression parsing
  "this", "self", "super", "event", "arguments",
  // scrml-specific — meta / compiler / SQL / error-context built-ins.
  "meta", "reflect", "emit", "compiler", "bun",
  // §51.14 — replay primitive. Rewritten by rewriteReplayCalls in the
  // codegen pipeline to _scrml_replay(...). Allowlisted here so the
  // scope-check pass doesn't flag it as an undeclared identifier.
  "replay",
  // §38.6 — channel built-ins. Auto-injected as locals in server functions
  // declared inside a `<channel>` body (codegen-time injection, see
  // emit-server.ts emitBroadcastInjection). Allowlisted here so the
  // scope-check pass doesn't flag them as undeclared idents in well-formed
  // channel-scoped code. E-CHANNEL-004 — broadcast/disconnect outside a
  // channel scope — is a separate codegen-time check (out of C18 scope; see
  // SURVEY for follow-up).
  "broadcast",
  "disconnect",
]);

/**
 * Walk every identifier in a logic-context ExprNode and emit E-SCOPE-001 for
 * any bare ident that cannot be resolved against:
 *   - the current ScopeChain (covers function params, let/const locals,
 *     state-decls, function-decls, type-decls via the `kind: "type"`
 *     binding added in case "type-decl"),
 *   - the type registry (covers user-declared types referenced in expressions,
 *     e.g. `Status.Todo` — the base name `Status` is looked up here),
 *   - the global allowlist (JS/DOM builtins above),
 *   - underscore-prefixed names (runtime helpers, `_scrml_*`, etc.).
 *
 * Skipped cases:
 *   - `@`-prefixed names: reactive variables have their own scope-validation
 *     path (sweepNodeForAtRefs in dependency-graph.ts + DG-level errors).
 *   - member-access chains: only the base ident (leftmost component) is looked
 *     up. `foo.bar.baz` → look up `foo`.
 *   - name collision with declared struct/enum types: already covered by the
 *     type registry check.
 */
function checkLogicExprIdents(
  exprNode: unknown,
  span: Span,
  scopeChain: ScopeChain,
  typeRegistry: Map<string, ResolvedType>,
  errors: TSError[],
  /** Optional name to exclude (e.g. the let-decl's own name for TDZ — though
   *  scrml does not have TDZ semantics across a single stmt). */
  excludeName?: string,
  /**
   * A4 follow-up: optional set of all function-decl names declared anywhere
   * in the current file. Used as a fallback when the scope chain hasn't yet
   * bound a function name (e.g. self-recursion: `fn f() { f() }` walks the
   * body BEFORE binding `f` in the enclosing scope, see type-system.ts
   * case "function-decl"). Without this, the surgical A4 walker fix would
   * surface E-SCOPE-001 on previously-hidden self-recursive references
   * inside template literals like `\`${f(...)}\``.
   */
  knownFnNames?: Set<string>,
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  forEachIdentInExprNode(exprNode as any, (ident) => {
    if (typeof ident.name !== "string") return;
    const raw = ident.name;
    if (!raw) return;
    // §32 — `~` is the implicit pipeline accumulator. Its scope-validation
    // is performed by the dedicated tilde-must-use pass (E-TILDE-001 /
    // E-TILDE-002) rather than the generic E-SCOPE-001 ident check; skip
    // here so a well-formed `~` consumption doesn't surface a duplicate /
    // misleading "undeclared identifier" diagnostic.
    if (raw === "~") return;
    // Skip reactive refs — validated by the DG sweep.
    if (raw.startsWith("@")) return;
    // Skip runtime helpers / underscore convention.
    if (raw.startsWith("_")) return;
    // Split off member-chain base.
    const base = raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw;
    if (!base) return;
    // Exclude the declared name itself (no TDZ in scrml, but a self-mention
    // in the init shouldn't flag the variable's own name).
    if (excludeName && base === excludeName) return;
    // Skip purely numeric-looking tokens (shouldn't appear as idents but
    // defensive against expression-parser edge cases).
    if (/^\d/.test(base)) return;
    // Allowlist: JS/DOM builtins + language keywords.
    if (LOGIC_SCOPE_GLOBAL_ALLOWLIST.has(base)) return;
    // Type registry — user-declared struct/enum type names are valid idents
    // when used as constructors / variant accessors (`Status.Todo`, `Point`).
    if (typeRegistry.has(base)) return;
    // A4 follow-up: known function-decl names (collected file-wide before
    // the per-function walk). Covers self-recursion / forward refs that
    // were previously hidden inside template literals.
    if (knownFnNames && knownFnNames.has(base)) return;
    // Scope chain — covers function-decls, params, let/const, state-decls,
    // type-decls (bound under kind: "type" at declaration site), imports.
    //
    // F5 (S31): state-decl double-binds the bare name (`count`) in addition
    // to the sigil form (`@count`) to support a handful of fallback lookup
    // sites. That bare bind silently absorbs `${count}` / `count + 1` / etc.
    // in logic context, letting undefined-in-JS references compile clean.
    // Detect the reactive-kind entry here and surface E-SCOPE-001 with a
    // tailored "did you mean `@name`?" message — the single most common
    // adopter typo.
    const entry = scopeChain.lookup(base);
    if (entry) {
      if (entry.kind !== "reactive") return;
      errors.push(new TSError(
        "E-SCOPE-001",
        `E-SCOPE-001: Bare identifier \`${base}\` in logic expression references the reactive variable \`@${base}\` ` +
        `without its \`@\` sigil. Reactive reads must use \`@${base}\` so the compiler can wire reactivity — ` +
        `otherwise the emitted code references an undefined local. Write \`@${base}\`.`,
        span,
      ));
      return;
    }
    errors.push(new TSError(
      "E-SCOPE-001",
      `E-SCOPE-001: Undeclared identifier \`${base}\` in logic expression. ` +
      `No variable, function, type, or import with that name is in scope. ` +
      `Check for a typo, a missing \`import\`, or whether you meant a reactive \`@${base}\`.`,
      span,
    ));
  });
}

/**
 * §54.6.3 E-STATE-TRANSITION-ILLEGAL — walk an ExprNode tree and fire on
 * any call whose callee is a member-access on a state-typed binding where
 * the method name is NOT in the binding's declared `transitions` map.
 *
 * Deliberately silent when:
 *   - Callee is not a member-access (regular function call).
 *   - Receiver cannot be resolved to a StateType.
 *   - Resolved StateType has no `transitions` field (terminal — Phase 4f).
 *   - Method name IS in the transitions map (legal call).
 *
 * Receiver shapes supported:
 *   - IdentExpr: let-bound name, direct scopeChain lookup.
 *   - CallExpr(Ident("_scrml_reactive_get"), [Lit("name")]): reactive @name
 *     read rewrite — extract the string arg and look up its reactive entry.
 */
function checkTransitionCallsInExpr(
  exprNode: unknown,
  span: Span,
  scopeChain: ScopeChain,
  stateTypeRegistry: Map<string, ResolvedType> | undefined,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  if (!stateTypeRegistry) return;

  const resolveReceiverStateType = (receiver: unknown): StateType | null => {
    if (!receiver || typeof receiver !== "object") return null;
    const r = receiver as { kind?: string; name?: string; callee?: unknown; args?: unknown[] };
    if (r.kind === "ident" && typeof r.name === "string") {
      let name = r.name;
      // The rewritten reactive-get call already unwrapped; guard against a
      // raw "@name" ident form used before reactive-rewrite.
      if (name.startsWith("@")) name = name.slice(1);
      const entry = scopeChain.lookup(name);
      if (!entry) return null;
      const t = entry.resolvedType as ResolvedType | undefined;
      if (t && t.kind === "state") return t as StateType;
      return null;
    }
    // `@name` reactive-read rewrites to: call Ident("_scrml_reactive_get"), [Lit("name")]
    if (r.kind === "call" && r.callee && typeof r.callee === "object") {
      const c = r.callee as { kind?: string; name?: string };
      if (c.kind === "ident" && c.name === "_scrml_reactive_get") {
        const args = r.args as Array<{ kind?: string; value?: unknown }> | undefined;
        const first = args && args[0];
        if (first && first.kind === "lit" && typeof first.value === "string") {
          const name = first.value;
          const entry = scopeChain.lookup(name);
          if (!entry) return null;
          const t = entry.resolvedType as ResolvedType | undefined;
          if (t && t.kind === "state") return t as StateType;
        }
      }
    }
    return null;
  };

  forEachCallInExprNode(exprNode as any, (call) => {
    const callee = call.callee as { kind?: string; object?: unknown; property?: string };
    if (!callee || callee.kind !== "member") return;
    const method = callee.property;
    if (typeof method !== "string" || !method) return;
    const stateType = resolveReceiverStateType(callee.object);
    if (!stateType) return;
    // Only surface on types that declare AT LEAST one transition. Terminal
    // states (no transitions field) are Phase 4f's territory.
    const transitions = stateType.transitions;
    if (!transitions || transitions.size === 0) return;
    if (transitions.has(method)) return;
    const declared = Array.from(transitions.keys()).sort().join(", ");
    errors.push(new TSError(
      "E-STATE-TRANSITION-ILLEGAL",
      `E-STATE-TRANSITION-ILLEGAL: Call \`.${method}()\` on \`${stateType.name}\` — ` +
      `\`${stateType.name}\` declares no transition named \`${method}\`. ` +
      `Declared transitions: ${declared}. ` +
      `Check for a typo, or that the binding has narrowed to the substate you expect.`,
      span,
    ));
  });
}

/**
 * §54.6.4 E-STATE-TERMINAL-MUTATION — walk an ExprNode tree and fire on
 * any AssignExpr whose target is a member-access on a state-typed binding
 * where the resolved StateType is a TERMINAL substate: `parentState` is set
 * (i.e., it IS a substate, not a top-level type) AND `transitions` is
 * undefined or empty.
 *
 * Terminal substates are resting states that cannot progress further per
 * the state-local life-cycle model; field writes on them have no defined
 * semantics.
 *
 * Silent when:
 *   - Target is not a member-access (plain variable assignment).
 *   - Receiver doesn't resolve to a StateType.
 *   - StateType has no parentState (top-level state — §54 terminality is
 *     defined in the substate-graph sense).
 *   - StateType has a non-empty transitions map (not terminal).
 *
 * Receiver shapes match Phase 4e: IdentExpr and the reactive-read rewrite
 * `CallExpr(Ident("_scrml_reactive_get"), [Lit("name")])`.
 */
function checkTerminalMutationsInExpr(
  exprNode: unknown,
  span: Span,
  scopeChain: ScopeChain,
  stateTypeRegistry: Map<string, ResolvedType> | undefined,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  if (!stateTypeRegistry) return;

  const resolveReceiverStateType = (receiver: unknown): StateType | null => {
    if (!receiver || typeof receiver !== "object") return null;
    const r = receiver as { kind?: string; name?: string; callee?: unknown; args?: unknown[] };
    if (r.kind === "ident" && typeof r.name === "string") {
      let name = r.name;
      if (name.startsWith("@")) name = name.slice(1);
      const entry = scopeChain.lookup(name);
      if (!entry) return null;
      const t = entry.resolvedType as ResolvedType | undefined;
      if (t && t.kind === "state") return t as StateType;
      return null;
    }
    if (r.kind === "call" && r.callee && typeof r.callee === "object") {
      const c = r.callee as { kind?: string; name?: string };
      if (c.kind === "ident" && c.name === "_scrml_reactive_get") {
        const args = r.args as Array<{ kind?: string; value?: unknown }> | undefined;
        const first = args && args[0];
        if (first && first.kind === "lit" && typeof first.value === "string") {
          const name = first.value;
          const entry = scopeChain.lookup(name);
          if (!entry) return null;
          const t = entry.resolvedType as ResolvedType | undefined;
          if (t && t.kind === "state") return t as StateType;
        }
      }
    }
    return null;
  };

  // Local recursive walker — tolerant of unknown kinds; recurses through
  // the generic object fields so it covers nested expressions without
  // needing an exhaustive kind-switch.
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string; target?: unknown };
    if (n.kind === "assign") {
      const target = n.target as { kind?: string; object?: unknown; property?: unknown } | undefined;
      if (target && target.kind === "member" && typeof target.property === "string") {
        const stateType = resolveReceiverStateType(target.object);
        if (stateType && stateType.parentState) {
          const transitions = stateType.transitions;
          const isTerminal = !transitions || transitions.size === 0;
          if (isTerminal) {
            errors.push(new TSError(
              "E-STATE-TERMINAL-MUTATION",
              `E-STATE-TERMINAL-MUTATION: Cannot write field \`${target.property}\` on \`${stateType.name}\` — ` +
              `\`${stateType.name}\` is a terminal substate (declares no outgoing transitions). ` +
              `Terminal substates are resting states; their fields cannot be mutated. ` +
              `Either declare a transition on \`${stateType.name}\` or reconsider the life-cycle design.`,
              span,
            ));
          }
        }
      }
    }
    // Recurse into sub-expressions. Generic descent through known fields.
    for (const k of ["callee", "object", "index", "target", "value", "left", "right",
                     "condition", "consequent", "alternate", "argument", "subject", "expression"]) {
      const v = (n as Record<string, unknown>)[k];
      if (v) visit(v);
    }
    for (const k of ["args", "elements", "props", "rawArms"]) {
      const v = (n as Record<string, unknown>)[k];
      if (Array.isArray(v)) for (const el of v) visit(el);
    }
  };
  visit(exprNode);
}

/**
 * §35 E-LIN-005 — reject a let/const/lin declaration whose name shadows an
 * in-scope `lin` variable from a parent scope. Shadowing is detected by
 * looking up the name in the scope chain and checking that:
 *   - the lookup resolves to an isLin entry, AND
 *   - that entry is not in the current scope (i.e. it came from a parent).
 * Same-scope rebinding (lookup resolves to current scope's own entry) is out
 * of scope for E-LIN-005; it is not a "shadow" in the hierarchical sense.
 */
function checkLinShadowing(
  name: string | undefined,
  span: Span,
  scopeChain: ScopeChain,
  errors: TSError[],
  declKind: "let" | "const" | "lin",
): void {
  if (!name) return;
  if (scopeChain.current.hasOwn(name)) return;
  const found = scopeChain.lookup(name);
  if (!found || !found.isLin) return;
  errors.push(new TSError(
    "E-LIN-005",
    `E-LIN-005: \`${declKind} ${name}\` shadows an in-scope \`lin\` variable of the same name. ` +
    `Shadowing a \`lin\` variable prevents the compiler from determining which binding a consumption refers to. ` +
    `Rename the new binding, or consume the outer \`lin ${name}\` before this declaration.`,
    span,
  ));
}

// ---------------------------------------------------------------------------
// Node type annotator
// ---------------------------------------------------------------------------

/**
 * Produce a stable string key for a node's span, used as the nodeTypes map key.
 */
function nodeKey(node: ASTNodeLike): string {
  if (node.id !== undefined) return String(node.id);
  if (node.span) {
    const s = node.span as Span;
    return `${s.start}-${s.end}`;
  }
  return `node-${Math.random()}`;
}

// ---------------------------------------------------------------------------
// §35 Attribute validation for markup nodes
// ---------------------------------------------------------------------------

/**
 * Infer the type of an attribute value from its AST representation.
 */
function inferAttrValueType(value: unknown): string | null {
  if (!value) return null;

  // String literal (quoted value)
  if ((value as ASTNodeLike).kind === "string-literal" || typeof value === "string") return "string";

  // Number literal
  if ((value as ASTNodeLike).kind === "number-literal") return "number";

  // Boolean literal
  if ((value as ASTNodeLike).kind === "boolean-literal") return "boolean";

  // Variable reference or expression — type is not known at this point
  return null;
}

/**
 * Validate attributes on a markup node against its state type shape.
 */
function validateMarkupAttributes(
  node: ASTNodeLike,
  stateType: StateType,
  errors: TSError[],
  filePath: string,
): void {
  const attrs = node.attrs as ASTNodeLike[] | undefined;
  if (!Array.isArray(attrs) || attrs.length === 0) return;

  const shape = stateType.attributes;
  if (!shape || !(shape instanceof Map)) return;

  for (const attr of attrs) {
    if (!attr || !attr.name) continue;
    const attrName = attr.name as string;
    const attrSpan = (attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Span;

    // ref= is a compiler directive, not an HTML attribute — skip validation
    if (attrName === "ref") continue;

    // bind: directives are compiler directives — skip validation
    if (attrName.startsWith("bind:")) continue;

    // class: directives are compiler directives — skip validation
    if (attrName.startsWith("class:")) continue;

    const shapeDef = shape.get(attrName);

    if (shapeDef) {
      // Known attribute — check type if we can infer the value type.
      const valueType = inferAttrValueType(attr.value);
      if (valueType && shapeDef.type !== valueType) {
        errors.push(new TSError(
          "E-MARKUP-002",
          `E-MARKUP-002: Attribute \`${attrName}\` on <${node.name}> expects type \`${shapeDef.type}\` ` +
          `but received \`${valueType}\`.`,
          attrSpan,
        ));
      }
    } else {
      // Unknown attribute.
      if (stateType.isHtml) {
        // HTML element — E-MARKUP-003
        const isDataAttr = attrName.startsWith("data-");
        const isAriaAttr = attrName.startsWith("aria-");
        if (isDataAttr || isAriaAttr) {
          // data-* and aria-* are valid on all HTML elements per spec, emit warning only
          errors.push(new TSError(
            "E-MARKUP-003",
            `E-MARKUP-003: Custom attribute \`${attrName}\` on <${node.name}>.`,
            attrSpan,
            "warning",
          ));
        } else {
          errors.push(new TSError(
            "E-MARKUP-003",
            `E-MARKUP-003: Unknown attribute \`${attrName}\` on HTML element <${node.name}>. ` +
            `This attribute is not in the HTML specification for this element.`,
            attrSpan,
          ));
        }
      } else {
        // User-defined state type — E-STATE-004
        errors.push(new TSError(
          "E-STATE-004",
          `E-STATE-004: Unknown attribute \`${attrName}\` on state type <${node.name}>. ` +
          `The state type \`${node.name}\` does not define an attribute named \`${attrName}\`.`,
          attrSpan,
        ));
      }
    }
  }
}

/**
 * Walk the AST of a single file and annotate every node with a ResolvedType.
 */
// ---------------------------------------------------------------------------
// §52 — State Authority helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the fileAST has a <program> node with a db= attribute.
 * Used to check E-AUTH-005: server @var requires a server context.
 */
function hasProgramDbAttr(fileAST: FileAST): boolean {
  const nodes = (fileAST.nodes as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
    ?? [];
  const programNode = nodes.find(
    (node: ASTNodeLike) => node.kind === "markup" && (node as ASTNodeLike).tag === "program"
  );
  if (!programNode) return false;
  const attrs = (programNode as ASTNodeLike).attrs as Array<{name: string; value: unknown}> | undefined;
  return !!(attrs && attrs.some((a: {name: string; value: unknown}) => a.name === "db"));
}

function annotateNodes(
  fileAST: FileAST,
  scopeChain: ScopeChain,
  typeRegistry: Map<string, ResolvedType>,
  routeMap: RouteMap,
  protectAnalysis: ProtectAnalysis,
  generatedTypesByScopeId: Map<string, Map<string, { fullType: ResolvedType; clientType: ResolvedType }>>,
  errors: TSError[],
  stateTypeRegistry: Map<string, ResolvedType>,
  machineRegistry: Map<string, MachineType>,
): Map<string, ResolvedType> {
  const nodeTypes = new Map<string, ResolvedType>();
  const filePath = fileAST.filePath;

  function functionBoundary(fnNode: ASTNodeLike): "server" | "client" {
    if (!routeMap || !routeMap.functions) return "client";
    const id = `${filePath}::${(fnNode.span as Span | undefined)?.start}`;
    const entry = routeMap.functions.get(id);
    return entry ? entry.boundary : "client";
  }

  // Build a map of function name -> errorType for exhaustive !{} checking (§19.7).
  // Also builds fnCanFail (all failable functions) and fnAllDeclared (all function names)
  // for E-ERROR-002 and E-ERROR-004 checks.
  const fnErrorTypes = new Map<string, string>();
  const fnCanFail = new Set<string>();     // all functions with canFail === true
  const fnAllDeclared = new Set<string>(); // all function-decl names in this file
  const nonPureFnNames = new Set<string>(); // names declared with `function` (not `fn`) — callable-but-not-pure (§48.6.2)

  // A9-Ext-4 D2 (2026-05-08): CPS-implicit-failable set — functions that have
  // a CPS body-split in routeMap but were NOT explicitly declared `!` by the
  // developer. Per body-split soundness design dive §3.4 verdict (option 6 =
  // compose 3+4+5), CPS-emitted server stubs always carry implicit `!`
  // semantics (D1 codegen wraps fetch in try/catch and produces tagged
  // scrml-error variants). The type-system surfaces this implicit `!` here
  // so caller's `?` propagation works (E-ERROR-004 sees them as failable).
  // For diagnostic purposes (D3 below), the CPS-implicit-failable set is
  // tracked separately from explicit-`!` so we can fire W-CPS-NEEDS-FAILABLE
  // (warn) instead of E-ERROR-002 (error) for unhandled CPS calls during the
  // deprecation cycle's stage 1 (v0.next).
  const fnCpsImplicitFailable = new Set<string>();

  // S84 v0.2.4 #5-followon (Gap B.3) — stack tracking the current enclosing
  // function's return ResolvedType. Pushed on function-decl entry, popped
  // on exit. `return-stmt` reads the top of the stack to drive bare-variant
  // inference against the return-type context. The stack handles nested
  // function declarations (lambdas / inline `fn` shorthand) naturally.
  // Null at the top means "no enclosing fn return type" (top-level code).
  const enclosingFnReturnTypeStack: Array<ResolvedType | null> = [];

  // S84 v0.2.4 #5-followon (Gap B.3/B.4) — pre-collect function signatures
  // (param types + return type) so the call-arg and return-stmt bare-variant
  // inference walkers can look up the enclosing function's return type and
  // each call site's expected param types.
  //
  // The runtime function-decl arm (~4147) binds an empty-params FunctionType
  // into scope today; B20.b deferred populating params because it required
  // this pre-collection infrastructure. With the pre-pass below we can fix
  // both gaps: function-decl arm reads from this map at bind time; the new
  // walkers read directly here when an ExprNode CallExpr is encountered.
  //
  // Param types are resolved against the file-level typeRegistry (built
  // BEFORE this pass runs). Return type is resolved from the function-decl's
  // `returnType` field (when present) the same way.
  const fnSignatures = new Map<string, {
    params: Array<{ name: string; type: ResolvedType }>;
    returnType: ResolvedType;
  }>();

  function collectFnErrorTypes(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (n.kind === "function-decl" && n.name) {
        fnAllDeclared.add(n.name as string);
        // S84 v0.2.4 #5-followon — populate fnSignatures (Gap B.3 + B.4).
        // Resolve param types against the file's typeRegistry (already
        // built before annotateNodes runs). Falls back to tAsIs() when
        // the param has no annotation OR resolves to asIs (unknown type).
        // Return type comes from the function-decl's `returnType` field
        // when present (the AST builder records the annotation string
        // from `function foo() -> Type {...}`).
        try {
          const sigParams: Array<{ name: string; type: ResolvedType }> = [];
          if (Array.isArray(n.params)) {
            for (const param of (n.params as unknown[])) {
              const paramName = typeof param === "string"
                ? param
                : (param as ASTNodeLike).name as string;
              const paramAnnot = (typeof param === "object" && param !== null)
                ? ((param as ASTNodeLike).typeAnnotation as string | undefined)
                : undefined;
              if (!paramName) continue;
              let paramType: ResolvedType = tAsIs();
              if (paramAnnot) {
                paramType = resolveTypeExpr(paramAnnot, typeRegistry);
              }
              sigParams.push({ name: paramName, type: paramType });
            }
          }
          let returnType: ResolvedType = tAsIs();
          // AST builder records the return-type annotation under
          // `returnTypeAnnotation` (the string after `->` or `:`). The
          // `returnType` field is reserved for the resolved type and
          // remains `undefined` at the AST level.
          const returnAnnot = (n as ASTNodeLike).returnTypeAnnotation as string | undefined;
          if (returnAnnot && typeof returnAnnot === "string") {
            returnType = resolveTypeExpr(returnAnnot, typeRegistry);
          }
          fnSignatures.set(n.name as string, { params: sigParams, returnType });
        } catch {
          // Defensive: never break the existing collectFnErrorTypes pass on
          // signature-collection failure. Missing fnSignatures entry is
          // tolerable — the call-arg / return-stmt walkers fall through to
          // existing silent-accept behavior.
        }
        // Non-pure = declared with `function` AND not marked `pure` (§48.6.2 opt-in).
        if ((n as ASTNodeLike).fnKind !== "fn" && (n as ASTNodeLike).isPure !== true) {
          nonPureFnNames.add(n.name as string);
        }
        if (n.canFail === true) {
          fnCanFail.add(n.name as string);
          if (n.errorType) {
            fnErrorTypes.set(n.name as string, n.errorType as string);
          }
        } else {
          // A9-Ext-4 D2: check routeMap for cpsSplit on this function. If the
          // function is CPS-eligible, treat it as implicitly `!`-typed (per
          // option-6 verdict: every CPS-emitted stub gets `!` semantics).
          const fnId = `${filePath}::${(n.span as Span | undefined)?.start}`;
          const entry = routeMap?.functions?.get(fnId);
          if (entry && entry.cpsSplit) {
            fnCanFail.add(n.name as string);
            fnCpsImplicitFailable.add(n.name as string);
            // No explicit errorType — the implicit error type is `CpsError`
            // (the synthetic enum produced by D1 codegen). Exhaustive
            // matching against an undeclared error type would fire E-TYPE-080;
            // skip the errorType registration to keep the existing
            // exhaustive-match path unchanged. Adopters who want full
            // exhaustive matching add `!` explicitly with a custom errorType.
          }
        }
      }
      // Recurse into body and children for nested functions.
      const body = n.body as ASTNodeLike[] | undefined;
      if (Array.isArray(body)) collectFnErrorTypes(body);
      const children = n.children as ASTNodeLike[] | undefined;
      if (Array.isArray(children)) collectFnErrorTypes(children);
    }
  }
  collectFnErrorTypes(
    (fileAST.nodes as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
    ?? []
  );

  // ---------------------------------------------------------------------------
  // §41.13 / §53.10 — parseVariant call-site recognition pass.
  //
  // parseVariant is a compile-time special form (Path A — type-as-argument).
  // The second argument MUST be a bare type-name identifier referring to a
  // scrml-native enum type. Validation is a sibling-shape of E-ENGINE-004.
  //
  // Steps:
  //   1. Walk import-decls; collect local names that bind to `parseVariant`
  //      from `'scrml:data'`.
  //   2. Wire each local name into fnErrorTypes / fnCanFail so the existing
  //      `!{}` exhaustiveness check (§19.7, line 4314+) treats parseVariant
  //      calls as failable returning ParseError.
  //   3. Walk every ExprNode in the file via forEachCallInExprNode; for each
  //      CallExpr whose callee ident matches a parseVariant local name,
  //      validate args[1] (must be IdentExpr resolving to an enum type) and
  //      annotate the call-node with `parseVariantEnum: EnumType` so codegen
  //      can pick it up (parallel to meta-checker's typeRegistrySnapshot).
  //
  // Annotation lives directly on the call-node — survey Risk #3 (read EnumType
  // off the annotated call-node, skip serializeTypeEntry payload extension).
  // ---------------------------------------------------------------------------
  const _allTopNodes = ((fileAST.nodes as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
    ?? []);

  // Step 1: collect parseVariant local names from imports of 'scrml:data'.
  const parseVariantLocals = new Set<string>();
  function collectParseVariantImports(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "import-decl" && (n as ASTNodeLike).source === "scrml:data") {
        const specifiers = (n as ASTNodeLike).specifiers as Array<{ imported?: string; local?: string }> | undefined;
        if (Array.isArray(specifiers)) {
          for (const spec of specifiers) {
            if (spec && spec.imported === "parseVariant" && typeof spec.local === "string") {
              parseVariantLocals.add(spec.local);
            }
          }
        } else if (Array.isArray(n.names)) {
          // Defensive fallback when specifiers wasn't populated.
          for (const name of n.names as unknown[]) {
            if (typeof name === "string" && name === "parseVariant") {
              parseVariantLocals.add("parseVariant");
            }
          }
        }
      }
      const body = n.body as ASTNodeLike[] | undefined;
      if (Array.isArray(body)) collectParseVariantImports(body);
      const children = n.children as ASTNodeLike[] | undefined;
      if (Array.isArray(children)) collectParseVariantImports(children);
    }
  }
  collectParseVariantImports(_allTopNodes);

  // Step 2: wire fnErrorTypes / fnCanFail so `!{}` exhaustiveness fires.
  for (const localName of parseVariantLocals) {
    fnErrorTypes.set(localName, "ParseError");
    fnCanFail.add(localName);
    fnAllDeclared.add(localName);
  }

  // Step 3: walk every ExprNode in the file. Validate + annotate each
  // parseVariant call-site.
  if (parseVariantLocals.size > 0) {
    const _pvDefaultSpan: Span = { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    walkAndValidateParseVariantCalls(_allTopNodes, parseVariantLocals, typeRegistry, errors, _pvDefaultSpan);
  }

  // ---------------------------------------------------------------------------
  // §41.14 / §53.14 — formFor markup-element recognition + AST rewrite pass.
  //
  // formFor is the second general-position member of the §53.14 type-as-
  // argument family (after parseVariant §41.13). The TS pass:
  //
  //   1. Collect local names that bind to `formFor` from imports of
  //      `'scrml:data'`.
  //   2. Walk every `<formFor>` markup node in the file's AST.
  //   3. Validate per §41.14.1-§41.14.8 (the 8 normative error codes).
  //   4. Build a FormForExpansion plan + invoke the emit-form-for expander to
  //      synthesize the equivalent compound state-decl + <form> markup tree.
  //   5. Splice the synthesized nodes in place of the original <formFor>
  //      node in the parent's children array.
  //
  // The rewrite makes the downstream stages (DG / VSS / CG) see a tree that
  // is identical in shape to hand-authored Shape 2 + <form> + <errors>. Per
  // §41.14.10 the emitted output is standard scrml — Pillar 5 invariant.
  // ---------------------------------------------------------------------------
  const formForLocals = new Set<string>();
  function collectFormForImports(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "import-decl" && (n as ASTNodeLike).source === "scrml:data") {
        const specifiers = (n as ASTNodeLike).specifiers as Array<{ imported?: string; local?: string }> | undefined;
        if (Array.isArray(specifiers)) {
          for (const spec of specifiers) {
            if (spec && spec.imported === "formFor" && typeof spec.local === "string") {
              formForLocals.add(spec.local);
            }
          }
        } else if (Array.isArray(n.names)) {
          for (const name of n.names as unknown[]) {
            if (typeof name === "string" && name === "formFor") {
              formForLocals.add("formFor");
            }
          }
        }
      }
      const body = n.body as ASTNodeLike[] | undefined;
      if (Array.isArray(body)) collectFormForImports(body);
      const children = n.children as ASTNodeLike[] | undefined;
      if (Array.isArray(children)) collectFormForImports(children);
    }
  }
  collectFormForImports(_allTopNodes);

  // Build a fieldName→rawClause map per struct typeDecl so the expander can
  // pull validator clauses straight from the source text. buildTypeRegistry
  // resolves the type-portion but discards the validator-tail; we re-walk the
  // raw body here to recover it without disturbing the existing resolver.
  const _structFieldRawClauses = new Map<string, Map<string, string>>();
  const _ffTypeDecls = ((fileAST.typeDecls as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.typeDecls as ASTNodeLike[] | undefined)
    ?? []);
  for (const decl of _ffTypeDecls) {
    if (!decl || decl.typeKind !== "struct") continue;
    const structName = (decl.name as string) ?? "";
    if (!structName) continue;
    const fieldMap = new Map<string, string>();
    const rawBody = (decl.raw as string) ?? "";
    let body = rawBody.trim();
    if (body.startsWith("{")) body = body.slice(1);
    if (body.endsWith("}")) body = body.slice(0, -1);
    body = body.trim();
    const lines = splitTopLevel(body, [",", "\n"]);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const fieldName = trimmed.slice(0, colonIdx).trim();
      const clauseRaw = trimmed.slice(colonIdx + 1).trim();
      if (!fieldName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldName)) continue;
      fieldMap.set(fieldName, clauseRaw);
    }
    _structFieldRawClauses.set(structName, fieldMap);
  }

  // Walk the AST for <formFor> nodes. Validation + rewrite happens in one
  // pass — the AST mutation (children-array splice) MUST happen in-place
  // because parent references are not threaded through the visitor.
  if (formForLocals.size > 0) {
    const _ffDefaultSpan: Span = { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    walkAndExpandFormForNodes(
      _allTopNodes,
      formForLocals,
      typeRegistry,
      _structFieldRawClauses,
      fnSignatures,
      fnErrorTypes,
      routeMap,
      errors,
      filePath,
      _ffDefaultSpan,
    );
  }

  // ---------------------------------------------------------------------------
  // §41.15 / §53.14 — schemaFor function-call recognition + AST rewrite pass.
  //
  // schemaFor is the THIRD general-position member of the §53.14 type-as-
  // argument family (after parseVariant §41.13 + formFor §41.14). The TS pass:
  //
  //   1. Collect local names that bind to `schemaFor` from imports of
  //      `'scrml:data'`.
  //   2. Two-pass walk:
  //      Pass A — walk `<schema>` state nodes' children; find logic blocks
  //               whose body contains a schemaFor CallExpression; validate
  //               per §41.15.1-§41.15.8 (the 8 normative error codes); on
  //               success rewrite the logic child with a synthesized text
  //               node carrying the expanded shared-core table-declaration.
  //      Pass B — walk EVERY OTHER expression position in the file looking
  //               for schemaFor calls; each such call is rejected with
  //               E-SCHEMAFOR-INVALID-CALL-CONTEXT.
  //
  // The function-call form is canonical per OQ-SCH-1 (Form B 50/60 vs Form
  // A markup-element 39/60 vs Form C block-attribute 37/60). Pillar 5
  // invariant per §41.15.9 — the emitted text is standard scrml schema
  // syntax, readable as if hand-authored.
  // ---------------------------------------------------------------------------
  const schemaForLocals = new Set<string>();
  function collectSchemaForImports(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "import-decl" && (n as ASTNodeLike).source === "scrml:data") {
        const specifiers = (n as ASTNodeLike).specifiers as Array<{ imported?: string; local?: string }> | undefined;
        if (Array.isArray(specifiers)) {
          for (const spec of specifiers) {
            if (spec && spec.imported === "schemaFor" && typeof spec.local === "string") {
              schemaForLocals.add(spec.local);
            }
          }
        } else if (Array.isArray(n.names)) {
          // Defensive fallback when specifiers wasn't populated.
          for (const name of n.names as unknown[]) {
            if (typeof name === "string" && name === "schemaFor") {
              schemaForLocals.add("schemaFor");
            }
          }
        }
      }
      const body = n.body as ASTNodeLike[] | undefined;
      if (Array.isArray(body)) collectSchemaForImports(body);
      const children = n.children as ASTNodeLike[] | undefined;
      if (Array.isArray(children)) collectSchemaForImports(children);
    }
  }
  collectSchemaForImports(_allTopNodes);

  // Walk for schemaFor calls. The walker handles both passes internally:
  // valid call sites inside `<schema>` blocks are expanded + rewritten;
  // invalid call sites anywhere else are rejected with
  // E-SCHEMAFOR-INVALID-CALL-CONTEXT.
  if (schemaForLocals.size > 0) {
    const _sfDefaultSpan: Span = { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    walkAndExpandSchemaForCalls(
      _allTopNodes,
      schemaForLocals,
      typeRegistry,
      _structFieldRawClauses,
      errors,
      filePath,
      _sfDefaultSpan,
    );
  }

  // ---------------------------------------------------------------------------
  // §41.16 / §53.14 — tableFor markup-element recognition + AST rewrite pass.
  //
  // tableFor is the FOURTH general-position member of the §53.14 type-as-
  // argument family (after parseVariant §41.13 + formFor §41.14 + schemaFor
  // §41.15). The TS pass:
  //
  //   1. Collect local names that bind to `tableFor` from imports of
  //      `'scrml:data'`.
  //   2. Walk every `<tableFor>` markup node in the file's AST.
  //   3. Validate per §41.16.1-§41.16.9 (the 13 normative error codes).
  //   4. Build a TableForExpansion plan + invoke the emit-table-for expander
  //      to synthesize the equivalent `<table>` + `<thead>` + `<tbody>` tree
  //      plus an optional `<<varName>SortedBy>` state-decl (when sortable=).
  //   5. Splice the synthesized nodes in place of the original `<tableFor>`
  //      node in the parent's children array.
  //
  // The rewrite makes the downstream stages (DG / VSS / CG) see a tree that
  // is identical in shape to hand-authored `<table>` + `${ for ... lift <tr>
  // ... }` markup. Per §41.16.11 the emitted output is standard scrml —
  // Pillar 5 invariant.
  // ---------------------------------------------------------------------------
  const tableForLocals = new Set<string>();
  function collectTableForImports(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "import-decl" && (n as ASTNodeLike).source === "scrml:data") {
        const specifiers = (n as ASTNodeLike).specifiers as Array<{ imported?: string; local?: string }> | undefined;
        if (Array.isArray(specifiers)) {
          for (const spec of specifiers) {
            if (spec && spec.imported === "tableFor" && typeof spec.local === "string") {
              tableForLocals.add(spec.local);
            }
          }
        } else if (Array.isArray(n.names)) {
          for (const name of n.names as unknown[]) {
            if (typeof name === "string" && name === "tableFor") {
              tableForLocals.add("tableFor");
            }
          }
        }
      }
      const body = n.body as ASTNodeLike[] | undefined;
      if (Array.isArray(body)) collectTableForImports(body);
      const children = n.children as ASTNodeLike[] | undefined;
      if (Array.isArray(children)) collectTableForImports(children);
    }
  }
  collectTableForImports(_allTopNodes);

  if (tableForLocals.size > 0) {
    const _tfDefaultSpan: Span = { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    walkAndExpandTableForNodes(
      _allTopNodes,
      tableForLocals,
      typeRegistry,
      _structFieldRawClauses,
      errors,
      filePath,
      _tfDefaultSpan,
    );
  }

  function visitNode(node: unknown): ResolvedType {
    if (!node || typeof node !== "object") return tUnknown();

    const n = node as ASTNodeLike;
    const key = nodeKey(n);
    let resolvedType: ResolvedType;

    switch (n.kind) {
      // ------------------------------------------------------------------
      // Markup element
      // ------------------------------------------------------------------
      case "markup": {
        // Visit attributes for identifier resolution.
        const attrs = n.attrs as ASTNodeLike[] | undefined;
        if (Array.isArray(attrs)) {
          for (const attr of attrs) {
            visitAttr(attr, n);
          }
        }

        // §35 Attribute validation
        // P3-FOLLOW: route on NR's resolvedCategory (authoritative), not the legacy
        // isComponent boolean. State-type validation skips user-component nodes —
        // those are handled by CE Phase 1, not by state-type attribute validation.
        if (stateTypeRegistry && n.name && n.resolvedCategory !== "user-component") {
          const stateType = stateTypeRegistry.get(n.name as string) as StateType | undefined;
          if (stateType) {
            validateMarkupAttributes(n, stateType, errors, filePath);
          }
        }

        // ref= type narrowing
        if (Array.isArray(attrs)) {
          for (const attr of attrs) {
            if (attr && attr.name === "ref" && attr.value && (attr.value as ASTNodeLike).kind === "variable-ref") {
              const refVarName = ((attr.value as ASTNodeLike).name as string).replace(/^@/, "");
              const elemShape = getElementShape((n.name as string) ?? "");
              if (elemShape && elemShape.domInterface) {
                scopeChain.bind(refVarName, {
                  kind: "ref-binding",
                  resolvedType: tUnion([tPrimitive(elemShape.domInterface), tPrimitive("null")]),
                  domInterface: elemShape.domInterface,
                });
              } else {
                scopeChain.bind(refVarName, {
                  kind: "ref-binding",
                  resolvedType: tUnion([tPrimitive("Element"), tPrimitive("null")]),
                  domInterface: "Element",
                });
              }
            }
          }
        }

        // S19 Phase 2: E-TYPE-026 — detect bare `match` / `partial match` appearing
        // directly as markup content (block-splitter keeps it as text because it's
        // not inside `${...}`). A text child whose trimmed value begins with
        // `match ` or `partial match ` indicates the author wrote control flow
        // outside any logic context.
        const markupChildrenForMatch = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(markupChildrenForMatch)) {
          for (const child of markupChildrenForMatch) {
            if (child && typeof child === "object" && child.kind === "text") {
              const textVal = (child as { value?: unknown }).value;
              if (typeof textVal === "string" && /(?:^|\n)\s*(?:partial\s+)?match\s+/.test(textVal)) {
                const mSpan = (child.span as Span | undefined) ?? (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
                errors.push(new TSError(
                  "E-TYPE-026",
                  "E-TYPE-026: `match` is not valid directly in markup (§18.9). " +
                  "Wrap the match in a logic interpolation — e.g. `${ match subject { .A => <p>a</> else => <p>b</> } }` — " +
                  "so the parser recognises it as a statement rather than text content.",
                  mSpan,
                ));
                break;
              }
            }
          }
        }

        // Visit children.
        // §18.18 E-TYPE-081: Check for `partial match` in logic children (markup interpolation context).
        // A ${ partial match ... } block inside markup silently drops unmatched variants.
        const children = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(children)) {
          for (const child of children) {
            // If this child is a logic block, scan its body for partial match-stmt nodes.
            if ((child as ASTNodeLike).kind === "logic") {
              const logicBody = (child as ASTNodeLike).body as ASTNodeLike[] | undefined;
              if (Array.isArray(logicBody)) {
                for (const stmt of logicBody) {
                  if (
                    (stmt as ASTNodeLike).kind === "match-stmt" &&
                    (stmt as ASTNodeLike).partial === true
                  ) {
                    errors.push(new TSError(
                      "E-TYPE-081",
                      "E-TYPE-081: `partial match` is not valid in a rendering context. " +
                      "A `partial match` inside a markup interpolation (`${}`) would silently produce " +
                      "no output for unhandled variants, making it indistinguishable from a missing case. " +
                      "Use standard `match` with an `else` arm that renders nothing for variants you want to skip.",
                      (stmt as ASTNodeLike).span as Span,
                    ));
                  }
                }
              }
            }
            visitNode(child);
          }
        }
        resolvedType = { kind: "html-element", tag: (n.name as string) ?? "unknown", attrs: {} };
        break;
      }

      // ------------------------------------------------------------------
      // State block (`< db>`, etc.)
      // ------------------------------------------------------------------
      case "state": {
        scopeChain.push(`state:${(n.stateType as string) ?? "unknown"}`);

        if (n.stateType === "db") {
          const stateBlockId = `${filePath}::${(n.span as Span | undefined)?.start}`;
          const genMap = generatedTypesByScopeId.get(stateBlockId);
          if (genMap) {
            for (const [name, { fullType, clientType }] of genMap) {
              scopeChain.bind(name, {
                kind: "db-type",
                resolvedType: clientType,
                fullType,
                clientType,
              });
            }
          }
        }

        const stateChildren = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(stateChildren)) {
          for (const child of stateChildren) visitNode(child);
        }

        scopeChain.pop();
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // State constructor definition (`< name attrib(type)>`)
      // ------------------------------------------------------------------
      case "state-constructor-def": {
        const ctorName = (n.stateType as string) ?? "unknown";
        scopeChain.push(`state-ctor:${ctorName}`);

        if (stateTypeRegistry && Array.isArray(n.typedAttrs)) {
          const attrMap = new Map<string, AttributeShapeDef>();
          for (const ta of (n.typedAttrs as ASTNodeLike[])) {
            attrMap.set(ta.name as string, {
              type: ta.typeExpr as string,
              required: !ta.optional,
              default: ta.defaultValue,
            });
          }

          const ctorSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

          // §52.3: Read authority and table attrs from state-constructor-def node.
          // These are non-typed attrs (e.g., authority="server" table="cards") stored in n.attrs.
          const ctorAttrs = (n.attrs as Array<{name: string; value: {kind: string; value?: string}}> | undefined) ?? [];
          const authorityAttr = ctorAttrs.find(a => a.name === "authority");
          const tableAttr = ctorAttrs.find(a => a.name === "table");
          const ctorAuthority = authorityAttr?.value?.kind === "string-literal"
            ? (authorityAttr.value.value as "server" | "local")
            : undefined;
          const ctorTableName = tableAttr?.value?.kind === "string-literal"
            ? tableAttr.value.value
            : null;

          // §54.2 Phase 3b: propagate substate metadata from AST tag.
          const ctorParentState = (n as ASTNodeLike).isSubstate === true
            ? ((n as ASTNodeLike).parentState as string | undefined)
            : undefined;

          // §54.3 Phase 4c: collect state-local transition declarations from
          // this constructor's children so the registry entry exposes them.
          const ctorChildrenForTx = n.children as ASTNodeLike[] | undefined;
          let ctorTransitions: Map<string, TransitionInfo> | undefined;
          if (Array.isArray(ctorChildrenForTx)) {
            for (const child of ctorChildrenForTx) {
              if (child && (child as ASTNodeLike).kind === "transition-decl") {
                const td = child as ASTNodeLike;
                if (!ctorTransitions) ctorTransitions = new Map<string, TransitionInfo>();
                ctorTransitions.set(td.name as string, {
                  name: td.name as string,
                  paramsRaw: (td.paramsRaw as string) ?? "",
                  targetSubstate: td.targetSubstate as string,
                  span: (td.span as Span) ?? ctorSpan,
                });
              }
            }
          }

          registerStateType(
            stateTypeRegistry,
            ctorName,
            attrMap,
            /* rendersToDom */ false,
            /* constructorBody */ (n.children as ASTNodeLike[] | undefined) ?? null,
            errors,
            ctorSpan,
            ctorAuthority,
            ctorTableName,
            ctorParentState,
            ctorTransitions,
          );

          for (const ta of (n.typedAttrs as ASTNodeLike[])) {
            scopeChain.bind(ta.name as string, {
              kind: "state-attr",
              resolvedType: resolveTypeExpr(ta.typeExpr as string, typeRegistry) ?? tAsIs(),
            });
          }
        }

        const ctorChildren = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(ctorChildren)) {
          for (const child of ctorChildren) visitNode(child);
        }

        scopeChain.pop();
        resolvedType = tState(ctorName, new Map(), false, false, (n.children as ASTNodeLike[] | undefined) ?? null);
        break;
      }

      // ------------------------------------------------------------------
      // Transition declaration (§54.3 Phase 4d)
      // ------------------------------------------------------------------
      case "transition-decl": {
        const txName = (n.name as string) ?? "anon";
        const fromSubstate = (n.fromSubstate as string | null) ?? null;

        scopeChain.push(`transition:${fromSubstate ?? "?"}:${txName}`);

        // Bind `from` to the enclosing substate's type. stateTypeRegistry may
        // not yet hold the substate (forward-ref placeholder path); in that
        // case we fall back to tAsIs() so the ident still resolves and
        // downstream passes can refine later.
        if (fromSubstate) {
          const fromType: ResolvedType =
            (stateTypeRegistry && stateTypeRegistry.get(fromSubstate)) ?? tAsIs();
          scopeChain.bind("from", {
            kind: "variable",
            resolvedType: fromType,
          });
        }

        // Parse paramsRaw and bind each param. Params shape: `name: type, ...`
        // Type annotation optional. Simple top-level comma-split honoring
        // paren/bracket nesting.
        const rawParams = (n.paramsRaw as string | undefined) ?? "";
        if (rawParams.trim().length > 0) {
          const pieces: string[] = [];
          let depth = 0;
          let cur = "";
          for (const ch of rawParams) {
            if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
            else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth--;
            if (ch === "," && depth === 0) { pieces.push(cur); cur = ""; }
            else cur += ch;
          }
          if (cur.trim().length > 0) pieces.push(cur);
          for (const piece of pieces) {
            const colonIdx = piece.indexOf(":");
            const paramName = (colonIdx >= 0 ? piece.slice(0, colonIdx) : piece).trim();
            const paramTypeExpr = colonIdx >= 0 ? piece.slice(colonIdx + 1).trim() : "";
            if (!paramName) continue;
            let paramType: ResolvedType = tAsIs();
            if (paramTypeExpr) {
              const resolved = resolveTypeExpr(paramTypeExpr, typeRegistry);
              if (resolved && resolved.kind !== "asIs") paramType = resolved;
            }
            scopeChain.bind(paramName, {
              kind: "variable",
              resolvedType: paramType,
            });
          }
        }

        // Walk the body statements. Default to client boundary; §33.6 purity
        // rules apply uniformly so boundary is less load-bearing than for
        // regular functions.
        const txBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(txBody)) {
          for (const stmt of txBody) visitLogicNode(stmt, "client");
        }

        // §33.6 Phase 4g: apply fn-level purity rules. Transition bodies are
        // pure-function-equivalent per §33.6 (fn ≡ pure function). Reuse the
        // same walker that fn bodies use so the same E-FN-001..E-FN-005
        // codes surface uniformly — users already understand these codes.
        if (Array.isArray(txBody)) {
          checkFnBodyProhibitions(n, txBody, errors, filePath, stateTypeRegistry, nonPureFnNames, scopeChain);
        }

        scopeChain.pop();
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Logic block (`${ }`)
      // ------------------------------------------------------------------
      case "logic": {
        const body = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(body)) {
          for (const stmt of body) visitNode(stmt);
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Function declaration
      // ------------------------------------------------------------------
      case "function-decl": {
        const boundary = functionBoundary(n);

        scopeChain.push(`fn:${(n.name as string) ?? "anon"}:${boundary}`);

        // Bind parameters into the function scope. §14: respect type annotations
        // on parameters (`function foo(x: Type)`) so downstream match / is .Variant
        // checks see the narrowed type. Without this the param resolves to `asIs`
        // and E-TYPE-025 fires on an otherwise-valid match.
        //
        // A5-FUP (2026-05-17) — destructured params (`function f([a, b])` or
        // `function f({a, b})`): `param.name` is a structured DestructurePattern.
        // Walk it via iterDestructuredNames and bind each yielded name as a
        // plain `asIs` variable so the function body sees them in scope.
        if (Array.isArray(n.params)) {
          for (const param of (n.params as unknown[])) {
            const paramObj = (typeof param === "object" && param !== null) ? (param as ASTNodeLike) : null;
            const paramNameField = paramObj ? paramObj.name : undefined;
            const paramAnnot = paramObj
              ? (paramObj.typeAnnotation as string | undefined)
              : undefined;
            const paramIsLin = paramObj
              ? Boolean(paramObj.isLin)
              : false;
            // Destructured-param path.
            if (paramNameField && isDestructurePattern(paramNameField)) {
              for (const bind of iterDestructuredNames(paramNameField as DestructurePatternShape)) {
                const entry: ScopeEntry = { kind: "variable", resolvedType: tAsIs() };
                if (paramIsLin) entry.isLin = true;
                scopeChain.bind(bind, entry);
              }
              continue;
            }
            const paramName = typeof param === "string" ? param : paramNameField as string;
            if (paramName) {
              let paramResolvedType: ResolvedType = tAsIs();
              if (paramAnnot) {
                const resolved = resolveTypeExpr(paramAnnot, typeRegistry);
                if (resolved && resolved.kind !== "asIs") {
                  paramResolvedType = resolved;
                }
              }
              const paramEntry: ScopeEntry = { kind: "variable", resolvedType: paramResolvedType };
              if (paramIsLin) paramEntry.isLin = true;
              scopeChain.bind(paramName, paramEntry);
            }
          }
        }

        // Walk the body.
        const fnBody = n.body as ASTNodeLike[] | undefined;
        // A9-Ext-4 D3 (2026-05-08): mark body statements with the enclosing
        // function's canFail status so the bare-expr top-level visitor can
        // suppress duplicate W-CPS-NEEDS-FAILABLE warnings when the caller
        // is `!`-typed (per body-split soundness design dive §3.4).
        const _enclosingFnCanFail = n.canFail === true;
        // S84 v0.2.4 #5-followon (Gap B.3): push the enclosing function's
        // return type onto the stack so nested return-stmts (including
        // those inside if/while/for/match-arm bodies) see the right
        // contextType. Pop after walking the body. Lookup via fnSignatures
        // (pre-pass result). When the function has no `-> T` annotation,
        // we push null and the return-stmt walker preserves silent-accept.
        let _enclosingFnReturnType: ResolvedType | null = null;
        if (typeof n.name === "string") {
          const sig = fnSignatures.get(n.name as string);
          if (sig && sig.returnType.kind !== "asIs") {
            _enclosingFnReturnType = sig.returnType;
          }
        }
        enclosingFnReturnTypeStack.push(_enclosingFnReturnType);
        if (Array.isArray(fnBody)) {
          for (const stmt of fnBody) {
            if (stmt && typeof stmt === "object") {
              (stmt as Record<string, unknown>).__enclosingFnCanFail = _enclosingFnCanFail;
            }
            visitLogicNode(stmt, boundary);
          }
        }
        enclosingFnReturnTypeStack.pop();

        scopeChain.pop();

        // Bind the function name in the enclosing scope.
        const fnType: FunctionType = { kind: "function", name: (n.name as string) ?? "", params: [], returnType: tAsIs() };
        if (n.name) {
          scopeChain.bind(n.name as string, {
            kind: "function",
            resolvedType: fnType,
            isPure: false,
          });
        }

        // §19 Error system validation.
        if (n.kind === "function-decl" && Array.isArray(fnBody)) {
          const canFail = n.canFail === true;
          const fnName = (n.name as string) ?? "<anonymous>";
          // Recursive walk: visit every descendant statement but stop descending
          // into nested function bodies (they have their own canFail signature).
          const visitStmt = (stmt: ASTNodeLike | undefined | null): void => {
            if (!stmt || typeof stmt !== "object") return;
            const k = stmt.kind;
            if (k === "function-decl" || k === "fn-decl") return; // nested fn — different scope
            // E-ERROR-001: fail used in non-! function (§19.3.3)
            if (k === "fail-expr" && !canFail) {
              errors.push(new TSError(
                "E-ERROR-001",
                `E-ERROR-001: 'fail' used in function '${fnName}' which is not declared as failable. ` +
                `Add '!' to the function signature: 'function ${fnName}(...)! -> {ErrorType}'.`,
                (stmt.span ?? n.span) as Span,
              ));
            }
            // Also detect `fail` that survives as a bare-expr string (e.g.
            // single-line if body where the if-body wasn't re-parsed through the
            // statement loop).
            if (k === "bare-expr" && !canFail) {
              const _failStr = stmt.exprNode ? emitStringFromTree(stmt.exprNode as import("./types/ast.ts").ExprNode) : (typeof stmt.expr === "string" ? stmt.expr : "");
              if (/^\s*fail\s+[A-Za-z_]/.test(_failStr)) {
                errors.push(new TSError(
                  "E-ERROR-001",
                  `E-ERROR-001: 'fail' used in function '${fnName}' which is not declared as failable. ` +
                  `Add '!' to the function signature: 'function ${fnName}(...)! -> {ErrorType}'.`,
                  (stmt.span ?? n.span) as Span,
                ));
              }
            }
            // E-ERROR-003: ? propagation in non-! function (§19.5.4)
            if (k === "propagate-expr" && !canFail) {
              errors.push(new TSError(
                "E-ERROR-003",
                `E-ERROR-003: '?' propagation operator used in function '${fnName}' which is not declared as failable. ` +
                `Add '!' to the function signature or handle the error with 'match' or '!{}'.`,
                (stmt.span ?? n.span) as Span,
              ));
            }
            // E-ERROR-004: ? applied to non-failable callee (§19.5.4)
            if (k === "propagate-expr" && canFail) {
              const calleeName = extractCalleeNameFromNode(stmt) ?? extractCalleeNameFromString(
                stmt.exprNode ? emitStringFromTree(stmt.exprNode as import("./types/ast.ts").ExprNode) : (stmt.expr as string | undefined)
              );
              if (calleeName && fnAllDeclared.has(calleeName) && !fnCanFail.has(calleeName)) {
                errors.push(new TSError(
                  "E-ERROR-004",
                  `E-ERROR-004: '?' applied to call to '${calleeName}' which is not a failable function. ` +
                  `Only '!' functions can be propagated with '?'.`,
                  (stmt.span ?? n.span) as Span,
                ));
              }
            }
            // E-ERROR-002: bare call to failable function with no error handling (§19.4.3)
            // A9-Ext-4 D3 (2026-05-08): for CPS-implicit-failable callees, fire
            // W-CPS-NEEDS-FAILABLE (warning) instead of E-ERROR-002 (error). This
            // is deprecation cycle stage 1 (v0.next per body-split integration
            // design dive Q4 verdict). v0.next+1 promotes to E-CPS-NEEDS-FAILABLE.
            //
            // Suppression: per body-split soundness design dive §3.4, if the
            // caller `F` is itself `!`-typed (canFail === true) the structural
            // propagation satisfies the handling requirement — no warning fires.
            // (Markup-context callers wrapped in `<errorBoundary>` are also
            // suppressed at runtime by the boundary; that detection is deferred
            // for cycle 1 since markup-call-site analysis is non-trivial here.)
            if (k === "bare-expr") {
              const bareCallee = extractCalleeNameFromNode(stmt) ?? extractCalleeNameFromString(
                stmt.exprNode ? emitStringFromTree(stmt.exprNode as import("./types/ast.ts").ExprNode) : (stmt.expr as string | undefined)
              );
              if (bareCallee && fnCanFail.has(bareCallee)) {
                if (fnCpsImplicitFailable.has(bareCallee)) {
                  // CPS-implicit-failable: warn (cycle 1 of deprecation) ONLY
                  // when caller is NOT `!`-typed. Caller has three migration
                  // paths: (1) wrap call site in `<errorBoundary>` markup
                  // (covers markup-context callers); (2) mark caller `!` so
                  // the error propagates structurally; (3) match the result
                  // explicitly.
                  if (!canFail) {
                    errors.push(new TSError(
                      "W-CPS-NEEDS-FAILABLE",
                      `W-CPS-NEEDS-FAILABLE: function \`${bareCallee}\` is split across the client/server ` +
                      `boundary (CPS) and may fail due to network or SQL errors. The current call ` +
                      `site does not handle the failure case.\n` +
                      `  Resolution options:\n` +
                      `    1. Wrap the call site in \`<errorBoundary>\` (markup context).\n` +
                      `    2. Mark the calling function \`!\` to propagate the error.\n` +
                      `    3. Match on the result: \`match ${bareCallee}(...) { ::Ok(v) -> ... ::NetworkError(e) -> ... }\`.\n` +
                      `  This warning will become an error (E-CPS-NEEDS-FAILABLE) in v0.next+1.`,
                      (stmt.span ?? n.span) as Span,
                      "warning",
                    ));
                  }
                  // else: suppressed because caller is `!` — structural
                  // propagation satisfies the handling requirement.
                } else {
                  errors.push(new TSError(
                    "E-ERROR-002",
                    `E-ERROR-002: Result of failable function '${bareCallee}' is not handled. ` +
                    `Either match the result, propagate with '?', catch with '!{}', or wrap in '<errorBoundary>'.`,
                    (stmt.span ?? n.span) as Span,
                  ));
                }
              }
            }
            // Recurse over known child containers.
            for (const key of ["children", "body", "thenBody", "elseBody", "arms", "armBody", "consequent", "alternate", "cases"]) {
              const v = (stmt as Record<string, unknown>)[key];
              if (Array.isArray(v)) v.forEach((c) => visitStmt(c as ASTNodeLike));
              else if (v && typeof v === "object") visitStmt(v as ASTNodeLike);
            }
          };
          for (const stmt of fnBody) visitStmt(stmt);
        }

        // §48 fn body prohibition checks (E-FN-001 through E-FN-008)
        // E-STATE-COMPLETE (§54.6.1) is emitted from within for fn bodies.
        if (n.fnKind === "fn" && Array.isArray(fnBody)) {
          checkFnBodyProhibitions(n, fnBody, errors, filePath, stateTypeRegistry, nonPureFnNames, scopeChain);
        }

        // §54.6.1 E-STATE-COMPLETE universal widening (S32 Phase 1b).
        // Also covers `function` bodies per spec's universal scope.
        if (n.fnKind !== "fn" && Array.isArray(fnBody)) {
          checkFunctionBodyStateCompleteness(n, fnBody, errors, filePath, stateTypeRegistry);
        }

        // §33.4/§33.6 W-PURE-REDUNDANT (S32 Phase 2).
        // `pure fn` is redundant: fn is already pure (≡ pure function per §33.6).
        if (n.fnKind === "fn" && (n as ASTNodeLike).isPure === true) {
          const fnSpan = (n.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Span;
          const fnName = (n.name as string) ?? "<anonymous>";
          errors.push(new TSError(
            "W-PURE-REDUNDANT",
            `W-PURE-REDUNDANT: \`pure\` modifier on \`fn ${fnName}\` is redundant.\n` +
            `  \`fn\` is a shorthand for \`pure function\` (§33.6); purity is implicit.\n` +
            `  Remove the \`pure\` keyword — write \`fn ${fnName}(...)\` alone.`,
            fnSpan,
            "warning",
          ));
        }

        resolvedType = fnType;
        break;
      }

      // ------------------------------------------------------------------
      // Type declaration — already handled in registry; just record type here.
      // ------------------------------------------------------------------
      case "type-decl": {
        if (n.name && typeRegistry.has(n.name as string)) {
          resolvedType = typeRegistry.get(n.name as string)!;
          // Bind the type name in the current scope.
          scopeChain.bind(n.name as string, { kind: "type", resolvedType });
        } else {
          resolvedType = tAsIs();
        }
        break;
      }

      // ------------------------------------------------------------------
      // Let / const declarations
      // ------------------------------------------------------------------
      case "let-decl":
      case "const-decl": {
        resolvedType = tAsIs();
        // §53.4 — If a type annotation is present and predicated, classify the assignment zone.
        const letAnnot = (n as ASTNodeLike).typeAnnotation as string | undefined;
        if (letAnnot) {
          let letAnnoType = resolveTypeExpr(letAnnot, typeRegistry);
          // §54.2 Phase 3d: fall back to stateTypeRegistry for state-typed annotations
          // (e.g. `let sub: Submission`). resolveTypeExpr only checks the general
          // type registry (enums/structs); state types live in stateTypeRegistry.
          if (letAnnoType.kind === "asIs" && stateTypeRegistry) {
            const bare = letAnnot.trim();
            const stateHit = stateTypeRegistry.get(bare);
            if (stateHit) letAnnoType = stateHit;
          }
          if (letAnnoType.kind === "predicated") {
            resolvedType = letAnnoType;
            const letDeclSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
            const letInitExpr = (n as any).initExpr;
            let letSourceInfo: SourceInfo = letInitExpr ? classifyLiteralFromExprNode(letInitExpr) : extractInitLiteral((n as ASTNodeLike).init);
            // B21 §53.4 — upgrade unconstrained-ident SourceInfo via scope lookup
            // so T-PRED-4 trusted-zone elision is reachable from real code.
            letSourceInfo = upgradeSourceInfoForPredicatedIdent(letSourceInfo, letInitExpr, scopeChain);
            const letZone = classifyPredicateZone(letAnnoType, letSourceInfo, letDeclSpan, errors);
            // B21 §53.4 — record three-zone classification on every predicated decl
            // (was: boundary-only). Static and trusted classifications are now
            // annotated for downstream consumers (A1c codegen / IDE tooling /
            // future optimization passes). A1c codegen continues to gate runtime
            // check emission on `zone === "boundary"` (additive, non-breaking).
            (n as ASTNodeLike).predicateCheck = {
              predicate: letAnnoType.predicate,
              zone: letZone,
              sourceKind: letSourceInfo.kind,
            };
          } else {
            // Non-predicated annotation — bind the resolved type for downstream lookups
            // (e.g. enum-typed variables used in `is .Variant` checks). §S19.
            if (letAnnoType && letAnnoType.kind !== "asIs") {
              resolvedType = letAnnoType;
            }
            // §14: E-TYPE-031 literal-mismatch for unpredicated primitive annotations
            // (number/string/boolean). More elaborate type inference can come later; this
            // catches the common case of `const n: number = "x"`.
            const annotBase = letAnnot.trim();
            const primitives = new Set(["number", "string", "boolean"]);
            if (primitives.has(annotBase)) {
              const srcInfo = (n as any).initExpr
                ? classifyLiteralFromExprNode((n as any).initExpr)
                : extractInitLiteral((n as ASTNodeLike).init);
              if (srcInfo.kind === "literal") {
                const actualKind = typeof srcInfo.value;
                if (actualKind !== annotBase) {
                  const letSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
                  errors.push(new TSError(
                    "E-TYPE-031",
                    `E-TYPE-031: type annotation \`${annotBase}\` does not match initializer of type \`${actualKind}\` ` +
                    `(\`${(n as ASTNodeLike).name ?? "<anonymous>"}\` at line ${letSpan.line}). ` +
                    `Either change the annotation to \`${actualKind}\`, or change the initializer to a \`${annotBase}\` value.`,
                    letSpan,
                  ));
                }
              }
            }
          }
          // §42 E-TYPE-041 — `not` assigned to a non-optional type (S19).
          // Detect bare `not` as initializer (after trimming surrounding parens/whitespace).
          {
            const rawInit = ((n as ASTNodeLike).init as string | undefined) ?? "";
            const trimmedInit = rawInit.trim().replace(/^\(+|\)+$/g, "").trim();
            if (trimmedInit === "not" && !isOptionalType(resolvedType)) {
              const notSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
              const varName = ((n as ASTNodeLike).name as string | undefined) ?? "<anonymous>";
              const typeName = letAnnot.trim();
              errors.push(new TSError(
                "E-TYPE-041",
                `E-TYPE-041: Cannot assign \`not\` to variable \`${varName}\` of type \`${typeName}\`. ` +
                `Declare the type as \`${typeName} | not\` to allow absence values (§42).`,
                notSpan,
              ));
            }
          }
        } else {
          // No annotation — infer primitive type from literal initializer so that
          // downstream `is .Variant` checks can report E-TYPE-062 for string/number.
          const srcInfo = (n as any).initExpr
            ? classifyLiteralFromExprNode((n as any).initExpr)
            : extractInitLiteral((n as ASTNodeLike).init);
          if (srcInfo.kind === "literal") {
            const actualKind = typeof srcInfo.value;
            if (actualKind === "string" || actualKind === "number" || actualKind === "boolean") {
              resolvedType = tPrimitive(actualKind);
            }
          }
        }
        // §2a — E-SCOPE-001 on undeclared identifiers inside the initializer
        // expression. Runs BEFORE the let/const name binding so a self-
        // reference in the init (e.g. `let x = x + 1`) reports against the
        // un-bound state — scrml does not have TDZ, so we excludeName here
        // and treat a bare self-mention as a forward reference that will be
        // shadowed by the new binding.
        {
          const letSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          const initExprForScope = (n as any).initExpr;
          if (initExprForScope) {
            checkLogicExprIdents(initExprForScope, letSpan, scopeChain, typeRegistry, errors, n.name as string | undefined, fnAllDeclared);
            // §54.6.3 Phase 4e: transition-call legality check
            checkTransitionCallsInExpr(initExprForScope, letSpan, scopeChain, stateTypeRegistry, errors);
            // §54.6.4 Phase 4f: terminal-substate mutation check
            checkTerminalMutationsInExpr(initExprForScope, letSpan, scopeChain, stateTypeRegistry, errors);
            // S84 v0.2.4 #5 — binary-expr comparison-site pre-pass.
            // Runs BEFORE the LHS-driven walk so that bare variants in
            // `let r = @cell == .V` (and symmetric / `!=` / `is` / `is-not`
            // forms) are resolved against the cell's enum type. Resolved
            // idents are stamped `_bareVariantInferredAtBinaryExpr=true`
            // and skipped by the subsequent `inferBareVariantsInExpr` walk —
            // preventing a spurious E-VARIANT-AMBIGUOUS from the no-context
            // branch when the let-decl has no annotation.
            inferBareVariantsAtComparisonSites(initExprForScope, scopeChain, letSpan, errors);
            // S84 v0.2.4 #5-followon (Gap B.4) — call-arg pre-pass. Same
            // ordering rationale as comparison-site: resolve bare variants
            // at typed-function call-arg positions before the LHS-driven
            // walk runs, so the no-context branch doesn't fire on them.
            inferBareVariantsAtCallArgs(initExprForScope, fnSignatures, letSpan, errors);
            // B20 §14.10 / M9 — bare-variant inference at LHS let/const-decl
            // annotation. The annotation type drives bare-variant resolution
            // in the initializer. When NO annotation is present, the writer
            // chose `let x = .V` with no type context — per §14.10 line 7174,
            // bare variants are NOT supported there; fire E-VARIANT-AMBIGUOUS.
            // S84 v0.2.4 #4.5: use the struct-nav walker so array-of-struct
            // and struct contextTypes refine the per-position type as the
            // walker descends into nested object/array literals. The walker
            // falls back to the flat `inferBareVariantsInExpr` for all other
            // contextType shapes (enum / union / asIs / null / primitive),
            // preserving the pre-existing behavior.
            if (letAnnot) {
              inferBareVariantsWithStructNav(initExprForScope, resolvedType, letSpan, errors);
            } else {
              // No annotation case — pass null as contextType to fire the
              // no-type-context diagnostic on any bare variant. This matches
              // §14.10 line 7174 ("bare variants ARE NOT supported in
              // expression positions where no type context exists").
              inferBareVariantsInExpr(initExprForScope, null, letSpan, errors);
            }
          }
        }
        {
          const bindSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          checkLinShadowing(
            typeof n.name === "string" ? n.name : undefined,
            bindSpan,
            scopeChain,
            errors,
            (n.kind === "const-decl") ? "const" : "let",
          );
        }
        // A5 (2026-05-17) — `n.name` is either a bare-ident string OR a
        // structured DestructurePattern (replaces A1's bare-expr scrape).
        // For patterns, walk recursively and bind every yielded name as a
        // plain `asIs` variable.
        if (n.name && isDestructurePattern(n.name)) {
          for (const bind of iterDestructuredNames(n.name as DestructurePatternShape)) {
            if (!scopeChain.lookup(bind)) {
              scopeChain.bind(bind, { kind: "variable", resolvedType: tAsIs() });
            }
          }
        } else if (n.name) {
          scopeChain.bind(n.name as string, { kind: "variable", resolvedType });
        }
        // S19 Phase 2: visit embedded match-expr so exhaustiveness/arm checks fire.
        const mxn = (n as { matchExpr?: ASTNodeLike }).matchExpr;
        if (mxn && typeof mxn === "object") {
          visitNode(mxn);
        }
        break;
      }

      // ------------------------------------------------------------------
      // Reactive declaration (`@name = expr`)
      // ------------------------------------------------------------------
      case "state-decl": {
        resolvedType = tAsIs();
        // S79 / §6.13 — reactivity attribute (debounced= / throttled=) checks.
        // Three diagnostic codes:
        //   - E-REACTIVITY-ATTR-CONFLICT — both attributes present on same cell.
        //   - E-DEBOUNCED-WITH-DERIVED — attribute on a `const`-derived cell.
        //   - E-DEBOUNCED-WITH-SERVER — attribute on a `<x server>` cell.
        // Plus an invalid-DURATION fall-through reuses the parseAfterDuration
        // diagnostic shape (E-CONTRACT-style: "duration ... does not match
        // LITERAL form OR COMPUTED form").
        {
          const reactivityAttr = (n as ASTNodeLike).reactivity as
            | { debounced?: { kind: string; reason?: string }; throttled?: { kind: string; reason?: string } }
            | undefined;
          if (reactivityAttr) {
            const reactSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
            const cellName = n.name as string | undefined ?? "<anonymous>";

            // Dual-attribute conflict.
            if (reactivityAttr.debounced && reactivityAttr.throttled) {
              errors.push(new TSError(
                "E-REACTIVITY-ATTR-CONFLICT",
                `E-REACTIVITY-ATTR-CONFLICT: cell <${cellName}> declares BOTH 'debounced=' AND 'throttled=' attributes. ` +
                `The two reactivity attributes describe competing timing rules (debounce coalesces writes; throttle leading+trailing-fires). ` +
                `Pick one. (SPEC §6.13.)`,
                reactSpan,
              ));
            }

            // Derived cell — write-side timing on a read-only cell is meaningless.
            const isDerived = ((n as ASTNodeLike).shape === "derived") ||
                              ((n as ASTNodeLike).isConst === true);
            if (isDerived) {
              errors.push(new TSError(
                "E-DEBOUNCED-WITH-DERIVED",
                `E-DEBOUNCED-WITH-DERIVED: cell <${cellName}> is a 'const'-derived cell (read-only) but carries a 'debounced=' or 'throttled=' attribute. ` +
                `Derived cells are read-only; debounce/throttle is a write-side wrapper; combining is meaningless. ` +
                `To debounce a derived computation, debounce the upstream source: ` +
                `\`<source debounced=300ms> = @raw; const <doubled> = @source * 2\`. (SPEC §6.13.4.)`,
                reactSpan,
              ));
            }

            // Server-authoritative cell.
            const isServerCell = !!(n as ASTNodeLike).isServer;
            if (isServerCell) {
              errors.push(new TSError(
                "E-DEBOUNCED-WITH-SERVER",
                `E-DEBOUNCED-WITH-SERVER: cell <${cellName}> is a 'server'-authoritative cell but carries a 'debounced=' or 'throttled=' attribute. ` +
                `Server-authoritative writes go through the §52 server-write path, not the client-side debounce/throttle wrapper; the two surfaces don't compose. ` +
                `Server-side timing semantics are out of scope for this revision. ` +
                `Resolution: remove the reactivity attribute, or restructure so the client-side cell carries the timing and the server-authoritative cell receives the resolved value. (SPEC §6.13.5.)`,
                reactSpan,
              ));
            }

            // Invalid-DURATION fall-through. parseAfterDuration produces
            // `{kind: "invalid", reason}`. Surface as E-CONTRACT-001-RT-style
            // diagnostic — but use the umbrella E-SYNTAX shape for now.
            for (const kind of ["debounced", "throttled"] as const) {
              const dur = reactivityAttr[kind];
              if (dur && dur.kind === "invalid") {
                errors.push(new TSError(
                  "E-SYNTAX-DURATION",
                  `E-SYNTAX-DURATION: cell <${cellName}> '${kind}=' value is malformed. ${dur.reason ?? "unknown parse failure"}. ` +
                  `Expected literal-form (Nms / Ns / Nm / Nh) OR computed-form (\${expr}<unit>). ` +
                  `(SPEC §6.13.3 — same grammar as <onTimeout after=>.)`,
                  reactSpan,
                ));
              }
            }
          }
        }
        // §53.4 — If a type annotation is present and predicated, classify the assignment zone.
        const reactAnnot = (n as ASTNodeLike).typeAnnotation as string | undefined;
        if (reactAnnot) {
          let reactAnnoType = resolveTypeExpr(reactAnnot, typeRegistry);
          // §54.2 Phase 3d: same state-type fallback as let-decl.
          if (reactAnnoType.kind === "asIs" && stateTypeRegistry) {
            const stateHit = stateTypeRegistry.get(reactAnnot.trim());
            if (stateHit) reactAnnoType = stateHit;
          }
          if (reactAnnoType.kind === "predicated") {
            resolvedType = reactAnnoType;
            const reactDeclSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
            const reactInitExpr = (n as any).initExpr;
            let reactSourceInfo: SourceInfo = reactInitExpr ? classifyLiteralFromExprNode(reactInitExpr) : extractInitLiteral((n as ASTNodeLike).init);
            // B21 §53.4 — upgrade unconstrained-ident SourceInfo via scope lookup
            // so T-PRED-4 trusted-zone elision is reachable from real code.
            reactSourceInfo = upgradeSourceInfoForPredicatedIdent(reactSourceInfo, reactInitExpr, scopeChain);
            const reactZone = classifyPredicateZone(reactAnnoType, reactSourceInfo, reactDeclSpan, errors);
            // B21 §53.4 — record three-zone classification on every predicated decl.
            // A1c codegen continues to gate runtime check emission on
            // `zone === "boundary"` (additive, non-breaking).
            (n as ASTNodeLike).predicateCheck = {
              predicate: reactAnnoType.predicate,
              zone: reactZone,
              sourceKind: reactSourceInfo.kind,
            };
          }
        }
        // §51.3.3: Check for machine binding annotation (@var: MachineName)
        if (reactAnnot && machineRegistry.size > 0) {
          const boundMachine = resolveMachineBinding(reactAnnot, machineRegistry);
          if (boundMachine) {
            (n as ASTNodeLike).machineBinding = boundMachine.name;
            // Resolve the governed type for downstream codegen
            if (boundMachine.governedType) {
              resolvedType = boundMachine.governedType;
            }
          }
        }

        // S19 Phase 2: if the annotation resolved to an enum or union (non-predicated,
        // non-machine), surface that type so downstream checks (match exhaustiveness)
        // can see the real type instead of the default asIs placeholder.
        // §54.2 Phase 3d: also surface state types (for substate match exhaustiveness).
        // S84 v0.2.4 #4.5 (Gap A): also surface array types — array-of-struct
        // and array-of-enum annotations drive the struct-nav bare-variant
        // walker; without this, `<cards>: { ... }[] = [...]` keeps
        // `resolvedType = asIs` and the walker can't navigate.
        if (reactAnnot && resolvedType.kind === "asIs") {
          const reactAnnoType2 = resolveTypeExpr(reactAnnot, typeRegistry);
          if (reactAnnoType2 && (reactAnnoType2.kind === "enum" || reactAnnoType2.kind === "union" || reactAnnoType2.kind === "struct" || reactAnnoType2.kind === "array")) {
            resolvedType = reactAnnoType2;
          } else if (stateTypeRegistry) {
            const stateHit = stateTypeRegistry.get(reactAnnot.trim());
            if (stateHit) resolvedType = stateHit;
          }
        }

        // §2a — E-SCOPE-001 on undeclared idents in the state-decl init.
        // Same shape as the let/const handling above. Runs before the @name
        // bind so a self-reference (`@x = x`) is treated as a forward ref.
        {
          const reactSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          const reactInitExprNode = (n as any).initExpr;
          if (reactInitExprNode) {
            checkLogicExprIdents(reactInitExprNode, reactSpan, scopeChain, typeRegistry, errors, n.name as string | undefined, fnAllDeclared);
            // §54.6.3 Phase 4e: transition-call legality check
            checkTransitionCallsInExpr(reactInitExprNode, reactSpan, scopeChain, stateTypeRegistry, errors);
            // §54.6.4 Phase 4f: terminal-substate mutation check
            checkTerminalMutationsInExpr(reactInitExprNode, reactSpan, scopeChain, stateTypeRegistry, errors);
            // B20 §14.10 / M9 — bare-variant inference at LHS state-decl
            // annotation. The annotation type drives bare-variant resolution.
            // The structural form `<x>: T = .V` is the canonical M9 locus.
            //
            // Bug 7 (M9) — reassignment position. The AST builder collapses a
            // reactive-write inside a function body (`@phase = .Loading`) into
            // a fresh `state-decl` node with no typeAnnotation. Without scope
            // consultation, this branch always fires E-VARIANT-AMBIGUOUS even
            // though §14.10 normative position #2 (`@cell = .V where @cell: T`)
            // says the LHS cell's type IS the context. Look up the prior bind
            // of `@${n.name}` and, if it's a reactive with an enum or union
            // resolvedType, use that as contextType. Fall back to null only
            // when the lookup misses (fresh untyped decl — preserves §14.10
            // line 7174 behavior for that case).
            let bvCtxType: ResolvedType | null = null;
            if (reactAnnot) {
              bvCtxType = resolvedType;
            } else if (typeof n.name === "string" && n.name.length > 0) {
              const prior = scopeChain.lookup(`@${n.name}`) as
                | { kind?: string; resolvedType?: ResolvedType }
                | undefined;
              if (
                prior &&
                prior.kind === "reactive" &&
                prior.resolvedType &&
                (prior.resolvedType.kind === "enum" ||
                  prior.resolvedType.kind === "union")
              ) {
                bvCtxType = prior.resolvedType;
              }
            }
            // S96 — binary-expr comparison-site pre-pass, parity with
            // let-decl / const-decl (line ~4535) and bare-expr (line ~4880).
            // Without this, state-decl init expressions like
            // `const <r> = @mode == .A ? @items.filter(...) : @items` fire
            // E-VARIANT-AMBIGUOUS on `.A` even though `@mode`'s enum type
            // statically fixes the variant context. Pre-S96 only the
            // let/const-decl + bare-expr sites threaded this walker; state-
            // decl (V5-strict `<x>:T = expr` AND `const <x> = expr`) was
            // missed. Runs BEFORE the struct-nav walker so resolved bare
            // variants are stamped `_bareVariantInferredAtBinaryExpr=true`
            // and the LHS-driven walker skips them (preventing the
            // duplicate-fire that the stamp convention was designed for).
            inferBareVariantsAtComparisonSites(reactInitExprNode, scopeChain, reactSpan, errors);
            // S84 v0.2.4 #4.5: struct-nav walker handles array-of-struct and
            // struct contextTypes (e.g. the kanban shape
            // `<cards>: { id, title, status: Status }[] = [...]`).
            inferBareVariantsWithStructNav(reactInitExprNode, bvCtxType, reactSpan, errors);
            // S84 v0.2.4 #5-followon (Gap B.4) — call-arg inference for
            // bare variants embedded in calls inside the state-decl init
            // (`<x>: T = f(.V)`). The struct-nav walker handles the LHS
            // type; this handles per-call param types.
            inferBareVariantsAtCallArgs(reactInitExprNode, fnSignatures, reactSpan, errors);
          }
        }
        if (n.name) {
          const isServer = !!(n as ASTNodeLike).isServer;
          // BUG-2 (S102) — sequential bare-variant writes to the same engine
          // cell. The AST builder collapses every `@phase = .V` inside a
          // function body into a fresh `state-decl` with no typeAnnotation
          // (§51.0.C / Move 16). Without a guard, the bind call below would
          // CLOBBER the engine pre-bind's enum-typed resolvedType (line 6145)
          // with the local `tAsIs()` default. The first write then leaves
          // `@phase` rebound as `asIs`, and the second write's bare-variant
          // inference loses its type context — spurious E-VARIANT-AMBIGUOUS
          // fires (§14.10 normative position #2 requires the cell's type to
          // drive the variant context).
          //
          // Fix: when this state-decl produced no richer-than-asIs local
          // resolvedType AND a prior reactive bind already carries a richer
          // type (engine pre-bind OR a typed first-decl), preserve the prior
          // type. The bind is still updated for non-reactive metadata
          // (`isServer` — though re-writes don't change that in practice).
          //
          // Richness ordering: anything that isn't `asIs` or `unknown` is
          // "richer" — enum, union, struct, array, primitive, machine, etc.
          // The local `resolvedType` only beats prior when this state-decl
          // is itself typed (reactAnnot present + resolution upgraded above).
          let bindType: ResolvedType = resolvedType;
          if (resolvedType.kind === "asIs" || resolvedType.kind === "unknown") {
            const priorBind = scopeChain.lookup(`@${n.name as string}`) as
              | { kind?: string; resolvedType?: ResolvedType }
              | undefined;
            if (
              priorBind &&
              priorBind.kind === "reactive" &&
              priorBind.resolvedType &&
              priorBind.resolvedType.kind !== "asIs" &&
              priorBind.resolvedType.kind !== "unknown"
            ) {
              bindType = priorBind.resolvedType;
            }
          }
          scopeChain.bind(`@${n.name as string}`, { kind: "reactive", resolvedType: bindType, isServer });
          scopeChain.bind(n.name as string, { kind: "reactive", resolvedType: bindType, isServer });

          if (isServer) {
            const declSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

            // E-AUTH-005: server @var requires a server context (db= on <program>) (§52.11)
            if (!hasProgramDbAttr(fileAST)) {
              errors.push(new TSError(
                "E-AUTH-005",
                `E-AUTH-005: 'server @${n.name as string}' declared in a client-only context. ` +
                `Server-authoritative variables require a server context. ` +
                `Add db= to the enclosing <program> or move the declaration.`,
                declSpan,
              ));
            }

            // W-AUTH-001: server @var with no detectable initial load (§52.11)
            // Phase 4d: ExprNode-first call detection, string fallback.
            const hasInitCall = (n as any).initExpr
              ? exprNodeContainsCall((n as any).initExpr)
              : (() => {
                  const initRaw = typeof (n as ASTNodeLike).init === "string"
                    ? ((n as ASTNodeLike).init as string)
                    : (((n as ASTNodeLike).init && typeof ((n as ASTNodeLike).init as ASTNodeLike).raw === "string")
                        ? ((n as ASTNodeLike).init as ASTNodeLike).raw as string
                        : "");
                  return initRaw ? initRaw.includes("(") : false;
                })();
            if (!hasInitCall) {
              errors.push(new TSError(
                "W-AUTH-001",
                `W-AUTH-001: 'server @${n.name as string}' has no detected initial load. ` +
                `The variable will display its placeholder until explicitly assigned. ` +
                `Add an 'on mount' block or assign from a server function.`,
                declSpan,
                "warning",
              ));
            }

            // E-AUTH-002: server @var init must not reference a client-local
            // reactive var (§39 / §52.11). Derivation from local state would
            // require implicit client->server data flow that the compiler will
            // not synthesize. The user must fetch the value server-side or
            // promote the dependency to a server path.
            const initExprNode = (n as any).initExpr;
            const serverVarName = n.name as string;
            const leakedLocals = new Set<string>();
            if (initExprNode) {
              forEachIdentInExprNode(initExprNode as any, (ident) => {
                if (typeof ident.name !== "string" || !ident.name.startsWith("@")) return;
                const refName = ident.name; // includes '@'
                const bareName = refName.slice(1);
                if (bareName === serverVarName) return; // self-ref; ignore here
                const refEntry = scopeChain.lookup(refName) as { kind?: string; isServer?: boolean } | undefined;
                if (refEntry && refEntry.kind === "reactive" && !refEntry.isServer) {
                  leakedLocals.add(refName);
                }
              });
            }
            for (const leaked of leakedLocals) {
              errors.push(new TSError(
                "E-AUTH-002",
                `E-AUTH-002: 'server @${serverVarName}' is derived from client-local reactive variable '${leaked}'. ` +
                `Server-authoritative variables cannot read client-local state without crossing the server boundary. ` +
                `Fetch \`@${serverVarName}\` from the server via \`server function\` or move the dependency into a server path.`,
                declSpan,
              ));
            }
          }
        }
        break;
      }

      // ------------------------------------------------------------------
      // Bare expression
      // ------------------------------------------------------------------
      case "bare-expr": {
        resolvedType = tAsIs();
        // A5 (2026-05-17) — destructuring assignment as bare-expr.
        //
        // Historical context: A1 (commit 64b2e54) installed a regex extractor
        // here because `const { a, b } = expr` had its LHS pattern survive
        // only in a sibling bare-expr's raw text (`"{ a , b } = expr"`).
        // A5's parser fix now consumes the pattern at const-/let-decl time
        // and emits a structured DestructurePattern on `name`, so the
        // bare-expr fallback is no longer load-bearing for the
        // declaration-form. Any remaining destructuring-as-bare-expr cases
        // would need to be re-validated; we'll surface that as A5-FUP if it
        // arises.

        // §2a — E-SCOPE-001 on bare-expr statements (mid-block function calls,
        // assignments parsed as raw expressions, etc.). Tightest-coverage slice;
        // everything else in §2a came first so the bare-expr extension sits on
        // top of a settled scope chain.
        {
          const beSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          const beExprNode = (n as Record<string, unknown>).exprNode;
          if (beExprNode) {
            checkLogicExprIdents(beExprNode, beSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
            // §54.6.3 Phase 4e: transition-call legality check
            checkTransitionCallsInExpr(beExprNode, beSpan, scopeChain, stateTypeRegistry, errors);
            // §54.6.4 Phase 4f: terminal-substate mutation check
            checkTerminalMutationsInExpr(beExprNode, beSpan, scopeChain, stateTypeRegistry, errors);
            // Bug 7 (M9) — bare-variant inference at reactive-site bare-expr
            // shapes: `@cell = .V` (AssignExpr root) or `@cell.advance(.V)`
            // (CallExpr root with member callee). The cell's enum/union type
            // supplies the contextType per §14.10 normative position #2.
            inferReactiveSiteBareVariants(beExprNode, scopeChain, beSpan, errors);
            // S84 v0.2.4 #5 — bare-variant inference at binary-comparison
            // positions inside a bare-expr (e.g. an `if` condition that the
            // parser surfaces as bare-expr, or a free-standing comparison
            // expression). Stamps `_bareVariantInferredAtBinaryExpr=true` on
            // resolved idents so any downstream walker that would otherwise
            // fire E-VARIANT-AMBIGUOUS on the same bare variant defers.
            // Idempotent w.r.t. `inferReactiveSiteBareVariants` — the Bug 7
            // helper handles assign/call ROOT shapes only and does not visit
            // binary-expr nodes; this helper covers the disjoint case.
            inferBareVariantsAtComparisonSites(beExprNode, scopeChain, beSpan, errors);
            // S84 v0.2.4 #5-followon (Gap B.4) — call-arg inference at
            // bare-expr top-level (e.g. `applyState(.V)` as its own stmt).
            inferBareVariantsAtCallArgs(beExprNode, fnSignatures, beSpan, errors);
          }
        }
        // E-ERROR-002 (§19.4.3): a bare call to a failable function at top-level
        // (outside any function body) is also unhandled. The in-function check
        // runs in the function-decl branch; this catches the outer case.
        // Skip when this node is the guardedNode of a parent guarded-expr — the
        // !{} arms already handle the error.
        // A9-Ext-4 D3 (2026-05-08): for CPS-implicit-failable callees, fire
        // W-CPS-NEEDS-FAILABLE (warning, cycle 1) instead. Mirrors the
        // function-body site above (line ~3990).
        // A9-Ext-4 D3 suppression: when this bare-expr is inside a `!`-typed
        // function body (`__enclosingFnCanFail === true`, marked by the
        // function-decl visitor above), the structural propagation satisfies
        // the handling requirement — suppress W-CPS-NEEDS-FAILABLE per
        // body-split soundness design dive §3.4 verdict.
        const bareCallee = extractCalleeNameFromNode(n) ?? extractCalleeNameFromString(
          n.exprNode ? emitStringFromTree(n.exprNode as import("./types/ast.ts").ExprNode) : (n.expr as string | undefined)
        );
        const inGuarded = (n as Record<string, unknown>).__inGuardedContext === true;
        const enclosingFnCanFail = (n as Record<string, unknown>).__enclosingFnCanFail === true;
        if (bareCallee && fnCanFail.has(bareCallee) && !inGuarded) {
          if (fnCpsImplicitFailable.has(bareCallee)) {
            if (!enclosingFnCanFail) {
              errors.push(new TSError(
                "W-CPS-NEEDS-FAILABLE",
                `W-CPS-NEEDS-FAILABLE: function \`${bareCallee}\` is split across the client/server ` +
                `boundary (CPS) and may fail due to network or SQL errors. The current call ` +
                `site does not handle the failure case.\n` +
                `  Resolution options:\n` +
                `    1. Wrap the call site in \`<errorBoundary>\` (markup context).\n` +
                `    2. Mark the calling function \`!\` to propagate the error.\n` +
                `    3. Match on the result: \`match ${bareCallee}(...) { ::Ok(v) -> ... ::NetworkError(e) -> ... }\`.\n` +
                `  This warning will become an error (E-CPS-NEEDS-FAILABLE) in v0.next+1.`,
                n.span as Span,
                "warning",
              ));
            }
            // else: suppressed — `!`-typed enclosing function propagates structurally.
          } else {
            errors.push(new TSError(
              "E-ERROR-002",
              `E-ERROR-002: Result of failable function '${bareCallee}' is not handled. ` +
              `Either match the result, propagate with '?', catch with '!{}', or wrap in '<errorBoundary>'.`,
              n.span as Span,
            ));
          }
        }
        break;
      }

      // ------------------------------------------------------------------
      // SQL block
      // ------------------------------------------------------------------
      case "sql": {
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // CSS inline block.
      // ------------------------------------------------------------------
      case "css-inline": {
        resolvedType = { kind: "cssClass" };
        break;
      }

      // ------------------------------------------------------------------
      // Meta block.
      // ------------------------------------------------------------------
      case "meta": {
        // §22.5.3: A `^{}` meta block captures the lexical scope at breakout.
        // In practice, meta blocks are how server-side imports enter a module:
        //   ^{ const { resolve, dirname } = await import("node:path") }
        // The imported names must be visible in sibling logic blocks and in
        // function bodies that follow. Two wrinkles in the current AST:
        //   (1) A fresh scope push would lose bindings on pop — walk children
        //       in the enclosing frame instead.
        //   (2) The AST builder fragments `const { a, b } = await import(...)`
        //       into three sibling nodes: a nameless const-decl, a bare-expr
        //       holding `{ a, b } = await`, and an import-decl with empty
        //       names. No single const-decl carries `a` or `b` as its name,
        //       so the normal case "const-decl" binder never fires. Extract
        //       the destructuring identifiers directly from bare-expr text so
        //       those names are visible to downstream scope checks. Every
        //       self-host module (module-resolver, bpp, pa, ri, ts, dg) uses
        //       this pattern.
        const metaBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(metaBody)) {
          for (const stmt of metaBody) {
            if (stmt && stmt.kind === "bare-expr") {
              const bareText = (stmt as ASTNodeLike).exprNode
                ? emitStringFromTree((stmt as ASTNodeLike).exprNode as import("./types/ast.ts").ExprNode)
                : (typeof (stmt as ASTNodeLike).expr === "string" ? ((stmt as ASTNodeLike).expr as string) : "");
              // Match `{ name1, name2, ... } = ...` (destructuring from an
              // await import call). Capture the interior, split on commas.
              const m = /^\s*\{\s*([^}]+)\}\s*=/.exec(bareText);
              if (m) {
                for (const part of m[1].split(",")) {
                  // Support `{ original: alias }` → bind alias (RHS of colon).
                  const nameRaw = part.includes(":") ? part.split(":").pop()! : part;
                  const name = nameRaw.trim();
                  if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
                    scopeChain.bind(name, { kind: "variable", resolvedType: tAsIs() });
                  }
                }
              }
            }
            visitNode(stmt);
          }
        }
        resolvedType = { kind: "meta-splice", resultType: tAsIs(), parentContext: "meta" };
        break;
      }

      // ------------------------------------------------------------------
      // Text and comment nodes.
      // ------------------------------------------------------------------
      case "text": {
        resolvedType = tPrimitive("string");
        break;
      }

      case "comment": {
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Import / export declarations.
      //
      // GITI-002 (giti inbound 2026-04-20): imports inside a `${}` logic
      // block were not being registered into the scope chain. The
      // scope-resolver then fired E-SCOPE-001 on any use of an imported
      // name (e.g. from a `server function` body that called
      // `getGreeting("world")`), even though the codegen path emitted
      // the import into both `.server.js` and `.client.js` correctly.
      //
      // Bind each imported local name as `kind: "import"` so
      // checkLogicExprIdents finds it via scopeChain.lookup(). The `names`
      // array on the import-decl AST is populated by ast-builder.js —
      // each entry is the local binding name (the import's `as`-alias if
      // one was given, otherwise the bare imported name).
      // ------------------------------------------------------------------
      case "import-decl":
      case "export-decl": {
        if (n.kind === "import-decl" && Array.isArray(n.names)) {
          for (const name of n.names as unknown[]) {
            if (typeof name === "string" && name.length > 0) {
              scopeChain.bind(name, { kind: "import", resolvedType: tAsIs() });
            }
          }
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Component definition node.
      // ------------------------------------------------------------------
      case "component-def": {
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Guarded expression — !{} error handler (§19).
      // Checks that all variants of the error enum are handled (E-TYPE-080).
      // ------------------------------------------------------------------
      case "guarded-expr": {
        const guardedNode = n.guardedNode as ASTNodeLike | undefined;
        const errorArms = (n.arms as Array<{pattern?: string; binding?: string; handler?: string; handlerExpr?: unknown; span?: Span}> | undefined) ?? [];

        // Visit the guarded node itself for its type checks. Mark it so the
        // bare-expr branch's E-ERROR-002 check skips — the !{} arms handle it.
        if (guardedNode) {
          (guardedNode as Record<string, unknown>).__inGuardedContext = true;
          visitNode(guardedNode);
        }

        // --- Exhaustiveness check (§19.7) ---

        // Step 1: extract the callee expression string from the guarded node.
        // Phase 4d: ExprNode-first callee extraction, string fallback
        let calleeName: string | null = null;
        if (guardedNode) {
          // ExprNode path: look for CallExpr with ident callee
          const _gExprNode = (guardedNode as Record<string, unknown>).exprNode ?? (guardedNode as Record<string, unknown>).initExpr;
          if (_gExprNode && typeof _gExprNode === "object" && (_gExprNode as any).kind === "call") {
            const _callee = (_gExprNode as any).callee;
            if (_callee && _callee.kind === "ident") calleeName = _callee.name;
          }
          // String fallback
          if (!calleeName) {
            let calleeExpr: string | null = null;
            if (guardedNode.kind === "bare-expr") {
              calleeExpr = ((guardedNode as any).exprNode
                ? emitStringFromTree((guardedNode as any).exprNode as import("./types/ast.ts").ExprNode)
                : (typeof guardedNode.expr === "string" ? guardedNode.expr : "")).trim();
            } else if (
              (guardedNode.kind === "let-decl" || guardedNode.kind === "const-decl")
            ) {
              calleeExpr = ((guardedNode as any).initExpr
                ? emitStringFromTree((guardedNode as any).initExpr as import("./types/ast.ts").ExprNode)
                : (typeof guardedNode.init === "string" ? guardedNode.init : "")).trim();
            }
            if (calleeExpr) {
              const calleeMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(calleeExpr);
              if (calleeMatch) calleeName = calleeMatch[1];
            }
          }
        }

        // Step 3: look up the function's errorType from our pre-built map.
        const errorTypeName = calleeName ? (fnErrorTypes.get(calleeName) ?? null) : null;

        // Step 4: if we have a named errorType, look it up in the typeRegistry.
        if (errorTypeName) {
          const errorEnumType = typeRegistry.get(errorTypeName);
          if (errorEnumType && errorEnumType.kind === "enum") {
            const enumType = errorEnumType as EnumType;
            const allVariants = (enumType.variants ?? []).map((v: VariantDef) => v.name);

            // Step 5: analyze the arms — detect wildcard or collect handled variants.
            // arm.pattern is a plain string: "::Declined", "_", or "else" (§19, ast-builder).
            const hasWildcard = errorArms.some(
              (a) => a.pattern === "_" || a.pattern === "else"
            );

            if (!hasWildcard && allVariants.length > 0) {
              const handledVariants = new Set<string>();
              for (const arm of errorArms) {
                const p = arm.pattern ?? "";
                if (p !== "_" && p !== "else") {
                  // Strip "::" prefix (e.g. "::Declined" -> "Declined").
                  const variantName = p.replace(/^::/, "").replace(/^\./, "");
                  if (variantName) handledVariants.add(variantName);
                }
              }

              // Step 6: find missing variants and emit E-TYPE-080.
              const missing = allVariants.filter((v: string) => !handledVariants.has(v));
              if (missing.length > 0) {
                errors.push(new TSError(
                  "E-TYPE-080",
                  `E-TYPE-080: Non-exhaustive error handler for \`${errorTypeName}\`. ` +
                  `Missing variant(s): ${missing.join(", ")}. ` +
                  `Add the missing arms or use \`else =>\` to handle all remaining variants.`,
                  n.span as Span,
                ));
              }
            }
          }
        }

        // S28 — scope-check each arm's handler body with arm.binding pushed
        // as a local. Pre-S28 handler bodies bypassed the scope walker entirely
        // (E-SCOPE-001 didn't fire for undeclared idents inside handlers) and
        // the caught-error binding wasn't visible to the scope walker even
        // when a handler WAS visited by some other path. Now every handler
        // is walked with a fresh child scope carrying the binding.
        const gExprSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        for (const arm of errorArms) {
          const handlerExpr = arm.handlerExpr;
          if (!handlerExpr) continue;
          scopeChain.push("error-arm");
          if (typeof arm.binding === "string" && arm.binding.length > 0) {
            scopeChain.bind(arm.binding, { kind: "variable", resolvedType: tAsIs() });
          }
          const armSpan = (arm.span as Span | undefined) ?? gExprSpan;
          checkLogicExprIdents(handlerExpr, armSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
          scopeChain.pop();
        }

        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Error-effect block.
      // F8 / v0.6 — `"ErrorEffect"` is the scrml-native parser's PascalCase
      // spelling of the same block; the dual-mode `case` accepts both so
      // the M5-swap native pipeline reaches this arm too.
      // ------------------------------------------------------------------
      case "ErrorEffect":
      case "error-effect": {
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Style block.
      // ------------------------------------------------------------------
      case "style": {
        resolvedType = { kind: "cssClass" };
        const styleChildren = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(styleChildren)) {
          for (const child of styleChildren) visitNode(child);
        }
        break;
      }

      // ------------------------------------------------------------------
      // lift-expr: `lift partial match ...` in rendering context (E-TYPE-081)
      // ------------------------------------------------------------------
      case "lift-expr": {
        const liftExpr = n.expr as { kind: string; expr?: string; exprNode?: unknown } | undefined;
        // Check if the lift target is a raw expression string that starts with "partial match"
        if (liftExpr && liftExpr.kind === "expr") {
          const _liftStr = liftExpr.exprNode
            ? emitStringFromTree(liftExpr.exprNode as import("./types/ast.ts").ExprNode)
            : (typeof liftExpr.expr === "string" ? liftExpr.expr : "");
          if (/^\s*partial\s+match/.test(_liftStr)) {
            errors.push(new TSError(
              "E-TYPE-081",
              "E-TYPE-081: `partial match` is not valid in a rendering context. " +
              "A `partial match` in a `lift` expression would silently produce no output for " +
              "unhandled variants, making it indistinguishable from a missing case. " +
              "Use standard `match` with an `else` arm that renders nothing for variants you want to skip: `else => \"\"`.",
              n.span as Span,
            ));
          }
        }
        // §2a — E-SCOPE-001 on undeclared idents in a value-lift expression.
        // `lift expr` where expr is an ExprNode payload (not a markup subtree).
        if (liftExpr && liftExpr.kind === "expr" && liftExpr.exprNode) {
          const liftSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          checkLogicExprIdents(liftExpr.exprNode, liftSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
        }
        // For lift with embedded markup (lift-expr with kind === "markup"), the markup
        // node is visited via the default recursion below; partial match inside markup
        // is caught by the markup case above.
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — throw-stmt / fail-expr (reactive-debounced-decl retired S79).
      // All three carry a single ExprNode payload (exprNode / argsExpr /
      // initExpr respectively). Walk it and — for the debounced decl —
      // bind the reactive name into scope after the init check.
      // ------------------------------------------------------------------
      case "throw-stmt": {
        const thrSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const thrExprNode = (n as Record<string, unknown>).exprNode;
        if (thrExprNode) {
          checkLogicExprIdents(thrExprNode, thrSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
        }
        resolvedType = tAsIs();
        break;
      }

      case "fail-expr": {
        const failSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const failArgsExpr = (n as Record<string, unknown>).argsExpr;
        if (failArgsExpr) {
          checkLogicExprIdents(failArgsExpr, failSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
        }
        resolvedType = tAsIs();
        break;
      }

      // S79 — `case "reactive-debounced-decl"` RETIRED. The pre-v0.next
      // `@debounced(N) name = expr` form is superseded by the canonical
      // state-decl reactivity attribute form `<name debounced=Nms> = expr`
      // (SPEC §6.13). State-decls with `reactivity` are typed via the
      // existing `case "state-decl"` arm; reactivity-attribute checks
      // (E-REACTIVITY-ATTR-CONFLICT, E-DEBOUNCED-WITH-DERIVED,
      // E-DEBOUNCED-WITH-SERVER) live there.

      // ------------------------------------------------------------------
      // while-stmt / if-stmt — W-ASSIGN-001: assignment in condition without double parens (§50.2.3)
      // ------------------------------------------------------------------
      case "while-stmt":
      case "if-stmt": {
        // §2a — E-SCOPE-001 on undeclared idents in the if condition.
        // Loop-scope plumbing (for-stmt / while-stmt cases) already pushes
        // and binds loop counters before walking the body, so conditions
        // like `if (i > 0)` inside `for (let i of arr)` see `i` in scope.
        {
          const ifCondSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          const ifCondExpr = (n as Record<string, unknown>).condExpr;
          if (ifCondExpr) {
            checkLogicExprIdents(ifCondExpr, ifCondSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
            // S84 v0.2.4 #5-followon (Gap B.1/B.2) — bare-variant inference
            // at if-stmt / while-stmt condition. Reuses the Bug 5
            // comparison-site helper, which handles `@cell <op> .V` and the
            // symmetric `.V <op> @cell` at any nesting depth inside the
            // condition. Without this wiring, bare variants in conditions
            // like `if (@phase == .Bogus)` were silently accepted — the
            // condExpr was checked only for E-SCOPE-001, not for variant
            // resolution. §14.10 line 7291's "any position where the type
            // is fixed by the surrounding declaration" covers conditions
            // implicitly (the cell's type fixes the variant context).
            inferBareVariantsAtComparisonSites(ifCondExpr, scopeChain, ifCondSpan, errors);
            // Bare variants that are NOT at a comparison position inside
            // the condition (e.g. call-arg positions) are resolved by the
            // call-arg inference walker below — the if/while case does
            // not fire `inferBareVariantsInExpr(..., null)` because doing
            // so would surface E-VARIANT-AMBIGUOUS on call-args that the
            // call-arg walker would correctly resolve. Each helper stamps
            // `_bareVariantInferredAtBinaryExpr` on resolved idents so the
            // downstream walkers can deduplicate.
            inferBareVariantsAtCallArgs(ifCondExpr, fnSignatures, ifCondSpan, errors);
          }
        }
        // §S19 — run `is` / `not`-prefix checks on the RAW condition string
        // (pre-rewrite), so that `not (flag)` and `x is .V` are visible.
        const rawCondition = ((n as ASTNodeLike).condition as string | undefined) ?? "";
        if (rawCondition) {
          const condSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          checkNotPrefixNegation(rawCondition, condSpan, errors);
          checkIsExpressions(rawCondition, scopeChain, typeRegistry, condSpan, errors);
        }
        // Phase 4d: ExprNode-first — check condExpr for AssignExpr at root
        const condExprNode = (n as Record<string, unknown>).condExpr as import("./types/ast.ts").ExprNode | undefined;
        const condStr = condExprNode
          ? emitStringFromTree(condExprNode)
          : ((n.condition as string | undefined) ?? "").trim();
        if (condStr.length > 0) {
          // ExprNode path: direct structural check for assignment at root
          const hasAssignAtRoot = condExprNode
            ? condExprNode.kind === "assign" && (condExprNode as any).op === "="
            : false;
          const inner = (condStr.startsWith("(") && condStr.endsWith(")"))
            ? condStr.slice(1, -1).trim()
            : condStr;
          const ASSIGN_ROOT_RE = /^[@A-Za-z_$][A-Za-z0-9_$@.]*\s*=[^=]/;
          // §50.2.3: double-paren form (`while ((x = 5))`) signals author intent and suppresses W-ASSIGN-001.
          // collectIfCondition strips the outer `(...)`, so the raw condition text still begins with `(`
          // whenever the user typed two paren layers. Depth-scan ensures the inner `(...)` wraps the
          // whole expression (not e.g. `(a) || (b = 5)` which would false-positive).
          const rawCondTrim = ((n as ASTNodeLike).condition as string | undefined)?.trim() ?? "";
          let doubleParen = false;
          if (rawCondTrim.startsWith("(") && rawCondTrim.endsWith(")")) {
            let depth = 0;
            let wrapsWhole = true;
            for (let i = 0; i < rawCondTrim.length; i++) {
              const c = rawCondTrim[i];
              if (c === "(") depth++;
              else if (c === ")") {
                depth--;
                if (depth === 0 && i !== rawCondTrim.length - 1) { wrapsWhole = false; break; }
              }
            }
            doubleParen = wrapsWhole && depth === 0;
          }
          if (!doubleParen && (hasAssignAtRoot || ASSIGN_ROOT_RE.test(inner))) {
            const stmtKind = n.kind === "while-stmt" ? "while" : "if";
            const condLine = (n.span as Span | undefined)?.line ?? 1;
            errors.push(new TSError(
              "W-ASSIGN-001",
              `W-ASSIGN-001: Assignment (\`=\`) used as the condition of \`${stmtKind}\` at line ${condLine}.\n` +
              `  Did you mean \`==\` for equality comparison?\n` +
              `  If assignment is intentional, use double parentheses to signal intent:\n\n` +
              `    ${stmtKind} ((${inner.trim()})) { ... }\n`,
              (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: condLine, col: 1 },
              "warning",
            ));
          }
        }
        const stmtBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(stmtBody)) {
          // while-stmt body is a block scope. if-stmt branches are scoped
          // below via consequent/alternate. do-while-stmt has its own
          // scope-pushing case further down.
          const pushScope = n.kind === "while-stmt";
          if (pushScope) scopeChain.push(`while:${nodeKey(n)}`);
          for (const child of stmtBody) visitNode(child);
          if (pushScope) scopeChain.pop();
        }
        const stmtConsequent = n.consequent as ASTNodeLike[] | undefined;
        if (Array.isArray(stmtConsequent)) {
          const pushIf = n.kind === "if-stmt";
          if (pushIf) scopeChain.push(`if-then:${nodeKey(n)}`);
          for (const child of stmtConsequent) visitNode(child);
          if (pushIf) scopeChain.pop();
        }
        const stmtAlternate = n.alternate as ASTNodeLike[] | undefined;
        if (Array.isArray(stmtAlternate)) {
          const pushIf = n.kind === "if-stmt";
          if (pushIf) scopeChain.push(`if-else:${nodeKey(n)}`);
          for (const child of stmtAlternate) visitNode(child);
          if (pushIf) scopeChain.pop();
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // match-stmt / match-expr — TS-C exhaustiveness + arm-position/guard checks.
      // S19 Phase 2: wires checkExhaustiveness (previously orphaned) and emits
      // E-SYNTAX-010/011, E-TYPE-024/025, E-TYPE-020/023, W-MATCH-001/003.
      // ------------------------------------------------------------------
      case "match-stmt":
      case "match-expr": {
        checkMatchDiagnostics(n, scopeChain, errors, filePath);
        // §2a — E-SCOPE-001 on an undeclared subject ident (e.g.
        // `match undeclaredSubj { ... }`). checkMatchDiagnostics already
        // resolves the subject for type lookup but doesn't emit a scope
        // diagnostic when the subject ident isn't in any scope.
        {
          const matchSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          const headerExpr = (n as Record<string, unknown>).headerExpr;
          if (headerExpr) {
            checkLogicExprIdents(headerExpr, matchSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
          }
        }
        const mBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(mBody)) {
          for (const c of mBody) visitNode(c);
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — match-arm-block body scope.
      //
      // `.Variant => { ... }` arms are parsed as `match-arm-block` nodes
      // with a structured `body` of statements. Before this case existed,
      // the default-handler recursion walked that body but in the parent
      // scope — a `let x = ...` inside the arm shared scope with its
      // siblings and the match's parent scope. Pushing a fresh scope here
      // lets scope-sensitive checks (E-SCOPE-001 collision semantics,
      // E-LIN-005 shadowing) fire correctly inside arm bodies.
      // ------------------------------------------------------------------
      case "match-arm-block": {
        const armBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(armBody)) {
          const label = (n as { variant?: string }).variant ?? "arm";
          scopeChain.push(`match-arm:${label}:${nodeKey(n)}`);
          // Bind payload destructure names (`.Mushroom(n) => { ... }`) into
          // the arm scope so references like `n` inside the body resolve.
          // Type is `tAsIs` for now — variant payload type inference is a
          // separate concern (arm-pattern type-aware binding is post-B20
          // territory; for B20 we just unblock scope resolution).
          const payloadBindings = (n as { payloadBindings?: string[] }).payloadBindings;
          if (Array.isArray(payloadBindings)) {
            for (const binding of payloadBindings) {
              if (typeof binding === "string" && binding.length > 0) {
                scopeChain.bind(binding, { kind: "variable", resolvedType: tAsIs() });
              }
            }
          }
          for (const child of armBody) visitNode(child);
          scopeChain.pop();
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — match-arm-inline scope. Inline arms (`. Variant => result`)
      // produce structured nodes with a result expression. No body scope
      // needed (single expression), but the node must be recognized to
      // prevent "unknown kind" fallthrough.
      // ------------------------------------------------------------------
      case "match-arm-inline": {
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — return-stmt scope walker. Returns appear inside function
      // bodies where params + locals are in scope; loop-scope plumbing
      // above ensures counters used in `return i` inside a for-body also
      // resolve correctly.
      // ------------------------------------------------------------------
      case "return-stmt": {
        const retSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const retExprNode = (n as Record<string, unknown>).exprNode;
        if (retExprNode) {
          checkLogicExprIdents(retExprNode, retSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
          // S84 v0.2.4 #5-followon (Gap B.3) — bare-variant inference at
          // return-stmt value. Read the enclosing function's return type
          // from the stack pushed at function-decl entry; when present
          // (annotated `function f() -> T {...}`), dispatch the flat
          // walker with T as contextType. Bare variants resolve against
          // T's variants; typos fire E-TYPE-063; union ambiguity fires
          // E-VARIANT-AMBIGUOUS. Silent fall-through when the function
          // has no return annotation (preserves pre-Gap-B behavior for
          // un-annotated functions).
          const retCtx = enclosingFnReturnTypeStack.length > 0
            ? enclosingFnReturnTypeStack[enclosingFnReturnTypeStack.length - 1]
            : null;
          if (retCtx) {
            inferBareVariantsInExpr(retExprNode, retCtx, retSpan, errors);
          }
          // S84 v0.2.4 #5-followon (Gap B.4) — call-arg inference within
          // the return expression. e.g. `return applyState(.V)` — the
          // call-arg position has its own type context from applyState's
          // param annotation, distinct from the return-type context.
          inferBareVariantsAtCallArgs(retExprNode, fnSignatures, retSpan, errors);
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — propagate-expr (`let x = risky()?` §19.5). Scans the inner
      // call expression for undeclared idents and binds the `binding` name
      // into the current scope so subsequent statements (like `return x`)
      // can resolve it. Without this bind, propagate-expr's let-binding is
      // invisible to the scope walker.
      // ------------------------------------------------------------------
      case "propagate-expr": {
        const propSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const propExprNode = (n as Record<string, unknown>).exprNode;
        if (propExprNode) {
          checkLogicExprIdents(propExprNode, propSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
        }
        const binding = (n as Record<string, unknown>).binding;
        if (typeof binding === "string" && binding.length > 0) {
          scopeChain.bind(binding, { kind: "variable", resolvedType: tAsIs() });
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — single-init declaration forms not yet covered by a dedicated
      // case. Each walks the initExpr for undeclared idents and binds the
      // declared name into the current scope so subsequent statements see
      // it. These cases intentionally DO NOT duplicate any other type
      // system work (lin tracking, must-use tracking, derived-reactive
      // codegen wiring) — those run elsewhere under their own visitors.
      // ------------------------------------------------------------------
      case "lin-decl": {
        const linSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const linInitExpr = (n as Record<string, unknown>).initExpr;
        if (linInitExpr) {
          checkLogicExprIdents(linInitExpr, linSpan, scopeChain, typeRegistry, errors, n.name as string | undefined, fnAllDeclared);
        }
        checkLinShadowing(n.name as string | undefined, linSpan, scopeChain, errors, "lin");
        if (n.name) {
          scopeChain.bind(n.name as string, { kind: "variable", resolvedType: tAsIs(), isLin: true });
        }
        resolvedType = tAsIs();
        break;
      }

      case "tilde-decl": {
        const tildSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const tildInitExpr = (n as Record<string, unknown>).initExpr;
        if (tildInitExpr) {
          checkLogicExprIdents(tildInitExpr, tildSpan, scopeChain, typeRegistry, errors, n.name as string | undefined, fnAllDeclared);
        }
        if (n.name) {
          scopeChain.bind(n.name as string, { kind: "variable", resolvedType: tAsIs() });
        }
        resolvedType = tAsIs();
        break;
      }

      // Phase A1a Step 11.5 — fold of `reactive-derived-decl` into state-decl.
      // The legacy `const @x = expr` form now produces a state-decl with
      // shape:"derived" + structuralForm:false + isConst:true; that node
      // flows through `case "state-decl":` above (which carries the full
      // predicate/machine/scope handling). The dedicated branch is retired.

      // ------------------------------------------------------------------
      // §2a — assignment RHS coverage. Two structured assignment kinds
      // produce dedicated AST nodes with walkable expression fields:
      //   - reactive-nested-assign (`@obj.path = value`) → valueExpr
      //   - reactive-array-mutation (`@arr.push(x)` etc.) → argsExpr
      // Plain `x = expr` / `@x = expr` statements inside function bodies
      // currently parse as bare-expr; they remain deferred alongside other
      // bare-expr coverage.
      // ------------------------------------------------------------------
      case "reactive-nested-assign": {
        const rnaSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const rnaValueExpr = (n as Record<string, unknown>).valueExpr;
        if (rnaValueExpr) {
          checkLogicExprIdents(rnaValueExpr, rnaSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
        }
        // §54.6.4 Phase 4f: terminal-substate mutation check.
        // `@reactive.path = value` — if the reactive var resolves to a
        // terminal substate, the write is illegal regardless of path depth.
        if (stateTypeRegistry) {
          const rnaTarget = (n as Record<string, unknown>).target as string | undefined;
          const rnaPath = (n as Record<string, unknown>).path as string[] | undefined;
          if (rnaTarget && Array.isArray(rnaPath) && rnaPath.length > 0) {
            const entry = scopeChain.lookup(rnaTarget);
            const rt = entry?.resolvedType;
            if (rt && rt.kind === "state") {
              const stateType = rt as StateType;
              if (stateType.parentState) {
                const transitions = stateType.transitions;
                const isTerminal = !transitions || transitions.size === 0;
                if (isTerminal) {
                  const fieldName = rnaPath[0];
                  errors.push(new TSError(
                    "E-STATE-TERMINAL-MUTATION",
                    `E-STATE-TERMINAL-MUTATION: Cannot write field \`${fieldName}\` on \`${stateType.name}\` — ` +
                    `\`${stateType.name}\` is a terminal substate (declares no outgoing transitions). ` +
                    `Terminal substates are resting states; their fields cannot be mutated. ` +
                    `Either declare a transition on \`${stateType.name}\` or reconsider the life-cycle design.`,
                    rnaSpan,
                  ));
                }
              }
            }
          }
        }
        resolvedType = tAsIs();
        break;
      }

      case "reactive-array-mutation": {
        const ramSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const ramArgsExpr = (n as Record<string, unknown>).argsExpr;
        if (ramArgsExpr) {
          checkLogicExprIdents(ramArgsExpr, ramSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // §2a — for-stmt / while-stmt scope plumbing.
      //
      // Before this case existed, for-stmt nodes fell through to the default
      // handler which only recursed into array fields — no scope push, no
      // counter binding. That meant the E-SCOPE-001 walker (added in S24)
      // couldn't be extended to if-stmt conditions or return-expr operands
      // inside loop bodies, because `for (let i of arr) { if (i > 0) ... }`
      // would false-positive on `i`.
      //
      // This case pushes a fresh scope, binds the loop variable (for-of and
      // for-in forms) or the C-style initializer's declared name, visits the
      // body inside that scope, and pops. No other semantics change — only
      // the scope chain sees the counter.
      //
      // Deliberately conservative: C-style's counter-name extraction reads
      // the initExpr ExprNode's top-level VariableDeclaration name if present.
      // Complex init forms (destructuring, multi-var, no-decl) fall back to
      // no binding — better to miss a scope-001 catch than spuriously flag
      // a legitimate counter.
      // ------------------------------------------------------------------
      case "for-stmt":
      case "for-loop": {
        scopeChain.push(`for:${nodeKey(n)}`);
        // for-of / for-in form: `variable` is a string name, OR a structured
        // DestructurePattern (A5 2026-05-17), OR null for C-style headers.
        const forVar = (n as Record<string, unknown>).variable;
        if (typeof forVar === "string" && forVar.length > 0) {
          scopeChain.bind(forVar, { kind: "variable", resolvedType: tAsIs() });
        } else if (isDestructurePattern(forVar)) {
          // A5 — structural destructuring walk. Each bound name enters scope
          // as a plain `asIs` variable (same semantics as A1's regex extractor).
          for (const bind of iterDestructuredNames(forVar as DestructurePatternShape)) {
            if (!scopeChain.lookup(bind)) {
              scopeChain.bind(bind, { kind: "variable", resolvedType: tAsIs() });
            }
          }
        }
        // C-style form: extract the declared counter name from the initExpr
        // if the ExprNode surfaces a VariableDeclaration at its root.
        const cStyleParts = (n as Record<string, unknown>).cStyleParts as
          | { initExpr?: { kind?: string; declarations?: Array<{ id?: { name?: string } }>; name?: string } }
          | undefined;
        const initExpr = cStyleParts?.initExpr as Record<string, unknown> | undefined;
        if (initExpr) {
          // VariableDeclaration shape: { kind: "variable-decl" | "VariableDeclaration", declarations: [{ id: { name } }] }
          const declarations = initExpr.declarations as Array<{ id?: { name?: string }; name?: string }> | undefined;
          if (Array.isArray(declarations)) {
            for (const d of declarations) {
              const idName = (d.id && typeof d.id.name === "string") ? d.id.name : (typeof d.name === "string" ? d.name : null);
              if (idName) {
                scopeChain.bind(idName, { kind: "variable", resolvedType: tAsIs() });
              }
            }
          } else if (typeof initExpr.name === "string") {
            scopeChain.bind(initExpr.name, { kind: "variable", resolvedType: tAsIs() });
          } else if (typeof initExpr.raw === "string") {
            // safeParseExprToNode bails to escape-hatch `{ kind: "escape-hatch",
            // raw: "let i = 2" }` for C-style init text that isn't a single
            // expression. Fall back to regex-parsing the raw decl to recover
            // the counter name. Matches `let x =`, `const x =`, `var x =`, and
            // multi-decl forms like `let x = 0, y = 1` (binds every name).
            const raw = initExpr.raw as string;
            const declRe = /\b(?:let|const|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
            let m: RegExpExecArray | null;
            while ((m = declRe.exec(raw)) !== null) {
              scopeChain.bind(m[1], { kind: "variable", resolvedType: tAsIs() });
            }
          }
        }
        const forBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(forBody)) {
          for (const child of forBody) visitNode(child);
        }
        scopeChain.pop();
        resolvedType = tAsIs();
        break;
      }

      case "while-loop":
      case "do-while-stmt": {
        // `while-stmt` is handled in the combined case above with if-stmt.
        // `do-while-stmt` has its own scope-push here; `while-loop` is a
        // legacy kind kept for compatibility.
        scopeChain.push(`while:${nodeKey(n)}`);
        const whileBody = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(whileBody)) {
          for (const child of whileBody) visitNode(child);
        }
        scopeChain.pop();
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Engine declaration — Phase A10 body-walk re-enablement (S81).
      //
      // Pre-A10, engine state-child bodies were stored only as `rulesRaw:
      // string` and engine-decl fell through to the `default` case which
      // happily iterated ALL array fields (recursing into nothing because
      // there were none). Phase A10 (S78, 2026-05-10) added a walkable
      // `bodyChildren: ASTNode[]` field to engine-decl + the codegen
      // structural-element filter (`STATE_CHILD_STRUCTURAL_TAGS` in
      // `codegen/emit-variant-guard.ts`). The gate documented at this
      // case pre-S81 was "wait for the filter before TS descends so
      // `after=10s` on `<onTimeout>` doesn't fire false E-SCOPE-001."
      //
      // S81 closes both deferrals together (per S78 hand-off §"Phase A10
      // deferred items" + hand-off-80 priority #1):
      //   1. Body-walk re-enablement: TS descends into bodyChildren and
      //      walks each state-child markup node, applying the structural-
      //      element filter (`TS_STATE_CHILD_STRUCTURAL_TAGS` above) so
      //      `<onTimeout>`/`<onTransition>`/`<onIdle>`/nested engines are
      //      skipped — their non-standard attrs no longer surface.
      //   2. Payload-binding scope injection: when a state-child opener
      //      carries a bareword attr (e.g., `<Error msg rule=.Loading>`),
      //      `msg` is bound into a fresh arm scope BEFORE the body is
      //      walked. References to `msg` inside `${msg}` interpolations
      //      / event handlers / nested markup resolve cleanly. The arm
      //      scope is popped after the body is walked, so payload names
      //      don't leak to sibling arms or outside the engine.
      //
      // Pattern mirrors the `match-arm-block` case above (B20 payload-
      // destructure binding). Payload-binding type is `tAsIs` for v1 —
      // variant payload type inference is post-B20 territory (would
      // require resolving the engine's `for=Type` to its enum decl,
      // then matching state-child tag → variant → payload field types).
      // Today the binding just unblocks scope resolution.
      //
      // Gate references: A1b walker passes (PASS 3, PASS 6, PASS 13,
      // PASS 14) already descend into bodyChildren for their own
      // diagnostics (E-SCOPE-001 on `@cell` references, E-DERIVED-VALUE-
      // MUTATE, E-RESET-INVALID-TARGET, E-CHANNEL-INSIDE-PROGRAM); those
      // walkers DON'T currently inject payload bindings — `${@cell}`
      // refs work because they're `@`-prefixed (state cells, not locals).
      // Bare-identifier refs (`${msg}`) are TS territory and require the
      // body-walk re-enablement landing here.
      case "engine-decl": {
        const bodyChildren = (n as { bodyChildren?: ASTNodeLike[] }).bodyChildren;
        if (Array.isArray(bodyChildren)) {
          for (const child of bodyChildren) {
            if (!child || typeof child !== "object") continue;
            if (child.kind !== "markup") {
              // Non-markup children (rare — typically logic blocks if any
              // appear at body-top-level) walk via the default path.
              visitNode(child);
              continue;
            }
            // Structural-element children at body top-level (e.g., file-
            // scope `<onIdle>` if reachable here) — skip; their attrs are
            // engine-grammar-specific, not general-markup-resolvable.
            const tag = (child as { tag?: string }).tag;
            if (typeof tag === "string" && TS_STATE_CHILD_STRUCTURAL_TAGS.has(tag)) {
              continue;
            }
            // State-child markup node (e.g., `<Idle>`, `<Error msg>`).
            // Push an arm scope, inject payload bindings, walk renderable
            // children (filtering out structural elements at every level).
            const armLabel = typeof tag === "string" ? tag : "anon";
            scopeChain.push(`engine-arm:${armLabel}:${nodeKey(child)}`);
            const payloadNames = extractEngineStateChildPayloadBindings(
              (child as { attrs?: unknown; attributes?: unknown }).attrs
                ?? (child as { attributes?: unknown }).attributes,
            );
            for (const binding of payloadNames) {
              if (typeof binding === "string" && binding.length > 0) {
                scopeChain.bind(binding, { kind: "variable", resolvedType: tAsIs() });
              }
            }
            // Walk the state-child's children, filtering structural-element
            // descendants at every level so e.g. a nested `<onTransition>`
            // inside the arm body doesn't fire false E-SCOPE-001.
            const armChildren = (child as { children?: unknown }).children;
            if (Array.isArray(armChildren)) {
              for (const grand of armChildren) {
                if (!grand || typeof grand !== "object") continue;
                const grandTag = (grand as { kind?: string; tag?: string });
                if (grandTag.kind === "markup" && typeof grandTag.tag === "string"
                    && TS_STATE_CHILD_STRUCTURAL_TAGS.has(grandTag.tag)) {
                  continue;
                }
                visitNode(grand as ASTNodeLike);
              }
            }
            scopeChain.pop();
          }
        }
        resolvedType = tAsIs();
        break;
      }

      // ------------------------------------------------------------------
      // Unknown node kinds — conservatively asIs, no error here.
      // ------------------------------------------------------------------
      default: {
        // Recurse into any array fields.
        for (const key of Object.keys(n)) {
          if (key === "span" || key === "id") continue;
          const val = n[key];
          if (Array.isArray(val)) {
            for (const child of val) {
              if (child && typeof child === "object" && (child as ASTNodeLike).kind) visitNode(child);
            }
          }
        }
        resolvedType = tAsIs();
        break;
      }
    }

    nodeTypes.set(key, resolvedType);
    return resolvedType;
  }

  function visitLogicNode(node: ASTNodeLike, boundary: "client" | "server"): void {
    if (!node || typeof node !== "object") return;
    // S24 §2a: bare-expr was previously short-circuited here to asIs without
    // being visited. Delegating to visitNode lets the bare-expr case run its
    // E-SCOPE-001 walker (and E-ERROR-002 failable-call check) as usual.
    // visitNode sets nodeTypes itself via the case handler, so no typing
    // information is lost relative to the prior short-circuit.
    if (node.kind === "function-decl") {
      visitNode(node);
      return;
    }
    visitNode(node);
  }

  function visitAttr(attr: ASTNodeLike, parent: ASTNodeLike): void {
    if (!attr || !attr.value) return;

    // `ref=@var` declares the variable (§6.7.2) — don't flag it as unresolved.
    if (attr.name === "ref") return;

    const value = attr.value as ASTNodeLike;

    if (value.kind === "variable-ref") {
      const name = value.name as string;
      // For dotted access like @todos.length, resolve the base name (@todos)
      const baseName = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
      const entry = scopeChain.lookup(baseName);
      const attrSpan = (value.span ?? attr.span ?? parent?.span ?? {
        file: filePath, start: 0, end: 0, line: 1, col: 1,
      }) as Span;
      if (!entry) {
        errors.push(new TSError(
          "E-SCOPE-001",
          `E-SCOPE-001: Unquoted identifier \`${baseName}\` in attribute \`${attr.name as string}\` ` +
          `cannot be resolved in the current scope. ` +
          `Did you mean to quote it as a string (\`"${baseName}"\`), or use \`@\` for a reactive variable (\`@${baseName}\`)?`,
          attrSpan,
        ));
      } else if (entry.kind === "reactive" && !baseName.startsWith("@")) {
        // F5 (S31): `class=count` / `value=count` where `@count` is declared.
        // The state-decl's bare-name bind absorbs the lookup; the attr
        // would otherwise compile silently to an unwired attribute value.
        errors.push(new TSError(
          "E-SCOPE-001",
          `E-SCOPE-001: Unquoted identifier \`${baseName}\` in attribute \`${attr.name as string}\` ` +
          `references the reactive variable \`@${baseName}\` without its \`@\` sigil. ` +
          `Write \`@${baseName}\` to bind the reactive value, or quote \`"${baseName}"\` for a literal string.`,
          attrSpan,
        ));
      }
    } else if (value.kind === "expr") {
      // F5 (S31): attribute value is a `${...}` interpolation — walk the
      // parsed exprNode through the logic-scope checker the same way a
      // bare-expr inside a logic child would. Without this, `value=${count}`
      // (missing `@`) compiles silently to `<input />` with the value
      // attribute dropped entirely.
      const attrSpan = (value.span ?? attr.span ?? parent?.span ?? {
        file: filePath, start: 0, end: 0, line: 1, col: 1,
      }) as Span;
      const exprNode = (value as Record<string, unknown>).exprNode;
      if (exprNode) {
        checkLogicExprIdents(exprNode, attrSpan, scopeChain, typeRegistry, errors, undefined, fnAllDeclared);
      }
    }
  }

  // Walk all top-level nodes.
  // CE output shape nests data under fileAST.ast — use dual-shape fallback.
  const topNodes = (fileAST.nodes as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
    ?? [];

  // §2a — Pre-bind `export <kind> Name` declarations into the outer scope so
  // intra-file references to exported functions/types/consts resolve for the
  // E-SCOPE-001 walker. Without this pass the AST builder's export-decl node
  // holds the declaration as an unparsed raw string (no function-decl sibling
  // is emitted), so the normal scope-binding path misses the name. Binding
  // with kind: "variable" + asIs type is sufficient for scope-resolution
  // purposes — we're not tracking the exported symbol's real shape here.
  //
  // A1 (2026-05-17) — extended to recover names from export-decl `raw` text
  // when `exportedName` is null. Notably `export class Foo { ... }` is parsed
  // as `export-decl { exportedName: null, raw: "export class Foo { ... }" }`
  // because the AST builder has no class-decl node kind — the class name
  // would otherwise never enter file scope, so `new Foo(...)` in a sibling
  // export function would surface a false E-SCOPE-001 (A2-SURFACED gap).
  // Mirrors the same recovery shape used for `export function/fn/const/let/
  // type/enum/struct/interface` declarations (defensive over the AST
  // builder's current `exportedName` population).
  const EXPORT_NAME_RECOVERY_RE =
    /^\s*export\s+(?:async\s+)?(?:class|interface|type|enum|struct|fn|function|const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  function preBindExportedNames(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "export-decl") {
        const exportedName = (n as Record<string, unknown>).exportedName;
        if (typeof exportedName === "string" && exportedName.length > 0) {
          for (const name of exportedName.split(",").map(s => s.trim()).filter(Boolean)) {
            if (!scopeChain.lookup(name)) {
              scopeChain.bind(name, { kind: "variable", resolvedType: tAsIs() });
            }
          }
        } else {
          // Fallback — recover the name from the raw `export …` text. Covers
          // shapes the AST builder doesn't populate `exportedName` for, most
          // notably `export class Foo { ... }`.
          const raw = (n as Record<string, unknown>).raw;
          if (typeof raw === "string" && raw.length > 0) {
            const m = EXPORT_NAME_RECOVERY_RE.exec(raw);
            if (m) {
              const name = m[1];
              if (!scopeChain.lookup(name)) {
                scopeChain.bind(name, { kind: "variable", resolvedType: tAsIs() });
              }
            }
          }
        }
      }
      // Recurse into container blocks that wrap top-level declarations.
      for (const key of ["nodes", "body", "children"] as const) {
        const v = (n as Record<string, unknown>)[key];
        if (Array.isArray(v)) preBindExportedNames(v as ASTNodeLike[]);
      }
    }
  }
  preBindExportedNames(topNodes);

  // Bug 9 (M9, §51.0.C) — Pre-bind engine auto-declared variables into the
  // scopeChain BEFORE function bodies are visited.
  //
  // Per §51.0.C (Move 16): `<engine for=Type ...>` auto-declares a reactive
  // cell named (a) `var=`-override if present, (b) else lowercase-first of
  // the type name (`MarioState` → `marioState`). The cell's resolvedType is
  // the engine's governed type.
  //
  // Without this pre-pass, function bodies declared above the engine in
  // source order can't resolve `@marioState`:
  //   - `scopeChain.lookup("@marioState")` returns null
  //   - Bug 7's `inferReactiveSiteBareVariants` falls back to null contextType
  //   - `inferBareVariantsInExpr` fires false E-VARIANT-AMBIGUOUS on `.Big`
  //
  // The `machineRegistry` was built at type-system.ts line 8715 (BEFORE
  // annotateNodes was invoked) and already contains every well-formed engine
  // with its resolved governedType. Walking the registry rather than the AST
  // gives us:
  //   - Skip-malformed-engines for free (E-ENGINE-003/E-ENGINE-004 already
  //     rejected the decl; no bind, no masking)
  //   - Resolved governedType in hand (no second type-registry lookup)
  //   - `MachineType.name` IS the auto-decl variable name (set from
  //     `decl.engineName` at buildMachineRegistry line 2083, which is the
  //     ast-builder-resolved `var=` override → engineName → auto-derived)
  //
  // Bind shape mirrors state-decl's reactive-bind (line 4579-4580):
  //   `{ kind: "reactive", resolvedType, isServer: false }`
  //
  // Engine auto-decls are client-side by default (the cell exists in the
  // client runtime). Cross-boundary engines (rare; channel-bound) would
  // need separate accounting, but this v1 fix follows the existing
  // canonical-form §51.0.C semantics.
  //
  // SHALL-NOT-overwrite guard: if a name already lives in scope (e.g.,
  // because a separate `<marioState>` decl exists — itself E-ENGINE-VAR-
  // DUPLICATE territory at SYM PASS 10.A), we skip rather than overwrite.
  // This matches `preBindExportedNames`' `if (!scopeChain.lookup(name))`
  // guard pattern and lets the SYM-layer diagnostic surface uncontested.
  for (const [_engineName, machine] of machineRegistry) {
    const varName = machine.name;
    if (typeof varName !== "string" || varName.length === 0) continue;
    const rt = machine.governedType;
    if (!rt) continue;
    // Skip if either form is already bound (collision will be flagged at
    // SYM PASS 10.A as E-ENGINE-VAR-DUPLICATE).
    if (scopeChain.lookup(`@${varName}`) || scopeChain.lookup(varName)) continue;
    scopeChain.bind(`@${varName}`, { kind: "reactive", resolvedType: rt, isServer: false });
    scopeChain.bind(varName, { kind: "reactive", resolvedType: rt, isServer: false });
  }

  for (const node of topNodes) {
    visitNode(node);
  }

  // Also annotate typeDecl nodes that may exist only in fileAST.typeDecls.
  const typeDeclNodes = (fileAST.typeDecls as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.typeDecls as ASTNodeLike[] | undefined)
    ?? [];
  for (const node of typeDeclNodes) {
    const key = nodeKey(node);
    if (!nodeTypes.has(key)) {
      visitNode(node);
    }
  }

  return nodeTypes;
}

// ---------------------------------------------------------------------------
// §42 Not-type utilities (E-TYPE-041, E-TYPE-043)
// ---------------------------------------------------------------------------

/**
 * Check whether a type accepts `not` as a value.
 * A type is "optional" (accepts not) if:
 *   - it is `not` itself
 *   - it is a union containing `not` as a member
 *   - it is `unknown` or `asIs` (permissive types)
 *
 * Returns true if assigning `not` to this type is valid.
 */
function isOptionalType(type: ResolvedType): boolean {
  if (!type) return false;
  if (type.kind === "not") return true;
  if (type.kind === "unknown" || type.kind === "asIs") return true;
  if (type.kind === "union") {
    return (type as UnionType).members.some((m: ResolvedType) => m.kind === "not");
  }
  return false;
}

/**
 * E-TYPE-041: Check whether assigning `not` to a variable of the given type is valid.
 * Returns an error message if invalid, or null if the assignment is allowed.
 */
function checkNotAssignment(targetType: ResolvedType, varName: string): string | null {
  if (isOptionalType(targetType)) return null;
  const typeName = targetType.kind === "primitive" ? (targetType as PrimitiveType).name : targetType.kind;
  return `E-TYPE-041: Cannot assign \`not\` to variable \`${varName}\` of type \`${typeName}\`. ` +
    `Declare the type as \`${typeName} | not\` to allow absence values (§42).`;
}

/**
 * E-TYPE-043: Check whether a function returning `not` has an optional return type.
 * Returns an error message if the return type does not allow `not`, or null if valid.
 */
function checkNotReturn(returnType: ResolvedType, fnName: string): string | null {
  if (isOptionalType(returnType)) return null;
  const typeName = returnType.kind === "primitive" ? (returnType as PrimitiveType).name : returnType.kind;
  return `E-TYPE-043: Function \`${fnName}\` has return type \`${typeName}\` but may return \`not\`. ` +
    `Declare the return type as \`${typeName} | not\` to allow absence return values (§42).`;
}

// ---------------------------------------------------------------------------
// Struct field access checker (E-TYPE-004)
// ---------------------------------------------------------------------------

/**
 * Check member access expressions in a bare-expr string against the type
 * registry for known struct types.
 */
function checkStructFieldAccess(
  expr: string,
  scopeChain: ScopeChain,
  typeRegistry: Map<string, ResolvedType>,
  span: Span,
  errors: TSError[],
): void {
  if (!expr || typeof expr !== "string") return;

  // Match `identifier.identifier` patterns.
  const MEMBER_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let m: RegExpExecArray | null;

  while ((m = MEMBER_RE.exec(expr)) !== null) {
    const objName = m[1];
    const fieldName = m[2];

    const entry = scopeChain.lookup(objName);
    if (!entry) continue; // Unresolved — E-SCOPE-001 handles this elsewhere.

    const type = entry.resolvedType;
    if (!type || type.kind !== "struct") continue; // Not a struct — skip.

    // Check whether the field exists.
    if (!type.fields || !type.fields.has(fieldName)) {
      errors.push(new TSError(
        "E-TYPE-004",
        `E-TYPE-004: Struct type \`${type.name}\` does not have a field named \`${fieldName}\`. ` +
        `Available fields: ${type.fields ? [...type.fields.keys()].join(", ") : "(none)"}.`,
        span,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// §42 / §S19 — `is` / `not` prefix checks on raw condition strings (E-TYPE-045,
// E-TYPE-062, E-TYPE-063). These run on the raw source text of if/while
// conditions because the ExprNode rewrites `not (expr)` → `!(expr)` and
// `x is .V` → `__scrml_is_variant__(x, ".V")` before reaching the type checker.
// ---------------------------------------------------------------------------

/**
 * Check a raw condition string for `not (expr)` prefix negation — forbidden (§42).
 * `not` is the absence value only; boolean negation must use `!`.
 */
function checkNotPrefixNegation(
  rawExpr: string,
  span: Span,
  errors: TSError[],
): void {
  if (!rawExpr || typeof rawExpr !== "string") return;
  // Walk the string, skipping string-literal content, looking for `not` keyword
  // followed by `(`. Must not be part of `is not` / `is not not` / `== not` / etc.
  const NOT_PAREN_RE = /(?<![A-Za-z0-9_$@])not\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = NOT_PAREN_RE.exec(rawExpr)) !== null) {
    const idx = m.index;
    // Look backwards for `is ` immediately preceding — that is `is not (…)`, a
    // parenthesized presence/absence check, which is handled elsewhere.
    const before = rawExpr.slice(0, idx).trimEnd();
    if (/\bis$/.test(before)) continue;
    // Also skip when the preceding token is `==`/`!=`/`===`/`!==` (E-EQ-002 fires).
    if (/(?:===?|!==?)\s*$/.test(before)) continue;
    errors.push(new TSError(
      "E-TYPE-045",
      "E-TYPE-045: `not (expr)` is not valid as boolean negation — `not` is the unified absence " +
      "value, not a logical-negation operator. Use `!(expr)` for boolean negation, or " +
      "`expr is not` to check for absence (§42).",
      span,
    ));
    // Report once per condition to avoid duplicate noise.
    return;
  }
}

/**
 * Check a raw expression string for `<operand> is .<Variant>` patterns and
 * verify the operand is enum-typed (E-TYPE-062) and the variant exists on the
 * enum (E-TYPE-063). Runs only on identifier / reactive-ref operands; complex
 * expressions (calls, member access) are skipped conservatively.
 */
function checkIsExpressions(
  rawExpr: string,
  scopeChain: ScopeChain,
  typeRegistry: Map<string, ResolvedType>,
  span: Span,
  errors: TSError[],
): void {
  if (!rawExpr || typeof rawExpr !== "string") return;
  if (!rawExpr.includes(" is ")) return;

  // Match `<ident> is .<Variant>` or `<ident> is <TypeName>.<Variant>`.
  // Dotted operands (a.b) are allowed in the capture but we only resolve the head.
  const IS_DOT_RE = /(@?[A-Za-z_$][A-Za-z0-9_$]*)\s+is\s+\.\s*([A-Z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = IS_DOT_RE.exec(rawExpr)) !== null) {
    const operandName = m[1];
    const variantName = m[2];

    // Resolve operand type via scopeChain.
    const entry = scopeChain.lookup(operandName);
    if (!entry) continue; // Unresolved — E-SCOPE-001 handles it elsewhere.

    let operandType = entry.resolvedType;
    // Peel union members — if any member is enum, treat as that enum.
    if (operandType && operandType.kind === "union") {
      const enumMember = (operandType as UnionType).members.find(
        (mem: ResolvedType) => mem.kind === "enum",
      );
      if (enumMember) operandType = enumMember;
    }

    if (!operandType || operandType.kind === "asIs" || operandType.kind === "unknown") {
      // Cannot determine — skip (dumb-type-system: no inference).
      continue;
    }

    if (operandType.kind !== "enum") {
      const typeLabel = operandType.kind === "primitive"
        ? (operandType as PrimitiveType).name
        : operandType.kind;
      errors.push(new TSError(
        "E-TYPE-062",
        `E-TYPE-062: Left-hand operand of \`is\` must be an enum-typed value, but ` +
        `\`${operandName}\` has type \`${typeLabel}\`. ` +
        `Use \`${operandName} == ${operandName === variantName ? "\"" + variantName + "\"" : "someEnum." + variantName}\` for non-enum comparisons, ` +
        `or annotate \`${operandName}\` with an enum type (§42).`,
        span,
      ));
      continue;
    }

    const enumType = operandType as EnumType;
    const has = (enumType.variants ?? []).some(v => v.name === variantName);
    if (!has) {
      const known = (enumType.variants ?? []).map(v => "." + v.name).join(", ");
      errors.push(new TSError(
        "E-TYPE-063",
        `E-TYPE-063: \`.${variantName}\` is not a declared variant of enum \`${enumType.name}\`. ` +
        `Known variants: ${known || "(none)"}. ` +
        `Check for a typo or add the variant to the enum declaration (§42).`,
        span,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// B20 — §14.10 / M9 bare-variant inference (E-VARIANT-AMBIGUOUS + E-TYPE-063)
// ---------------------------------------------------------------------------
//
// SPEC §14.10 (line 7149+) — when the position type is statically known, a
// bare `.Variant` reference resolves against that type's variants. The S66
// parser fix (commit cb167b1) makes `.Variant` parseable as a primary
// expression everywhere by replacing it with placeholder
// `__scrml_bare_variant_Variant__` and unmasking back to an IdentExpr with
// `name: ".Variant"` in `esTreeToExprNode`. So the AST shape is:
//
//   IdentExpr { kind: "ident", name: ".Variant" }
//
// `inferBareVariantsInExpr` walks the ExprNode and resolves each such ident
// against `contextType`:
//
//   - contextType is EnumType: variant exists → silent; missing → E-TYPE-063
//     (existing code, used the same way `is .V` does).
//   - contextType is UnionType: collect enum members; if exactly one declares
//     the variant → silent; if multiple → E-VARIANT-AMBIGUOUS (union-shared);
//     if none → E-TYPE-063 with cross-enum context.
//   - contextType is null / asIs / unknown / non-enum / non-union: per
//     §14.10 line 7173-7174, no type context fires E-VARIANT-AMBIGUOUS.
//
// Walker placement: invoked from the type-system.ts `state-decl`,
// `let-decl`/`const-decl`, and `bare-expr` (for `@cell = .V` after-decl
// assignments) cases — the LHS-driven inference positions per §14.10's
// six positions list. Engine `initial=` (position 6) is handled by B15
// (symbol-table.ts:4247-4267); match `for=` arm patterns (position 5) are
// handled by exhaustiveness today; positions 3 (param) and 4 (return)
// require deeper FunctionType.params + return-type infra and are deferred
// to a follow-up step (B20.b).
//
// Per BRIEF §"OUT OF SCOPE": §18.0.3 match-arm pattern bare-variants are
// left for a future step. The §34 catalog cross-ref currently cites
// §18.0.3 only — extending to §14.10 is a SPEC-PROSE FOLLOW-UP for PA.
// ---------------------------------------------------------------------------

/**
 * §14.10 / M9 — Walk an ExprNode tree and resolve every bare-variant
 * IdentExpr (`name` starting with `.` followed by an uppercase identifier)
 * against the supplied `contextType`. Emits diagnostics on the supplied
 * errors list.
 *
 * @param exprNode    The expression to walk (state-decl init, let-decl init,
 *                    bare-expr assign value, etc.)
 * @param contextType The LHS-driven type at this position (or null if no
 *                    type context — see §14.10 line 7173-7174).
 * @param span        Span to report on (typically the parent decl's span).
 * @param errors      Accumulator for diagnostics.
 */
function inferBareVariantsInExpr(
  exprNode: unknown,
  contextType: ResolvedType | null,
  span: Span,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  forEachIdentInExprNode(exprNode as any, (ident) => {
    if (typeof ident.name !== "string") return;
    const raw = ident.name;
    // Bare-variant shape: `.Variant` — leading dot, uppercase first letter.
    // The S66 placeholder unmask only produces this exact shape.
    if (raw.length < 2 || raw[0] !== ".") return;
    const variantName = raw.slice(1);
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(variantName)) return;

    // §14.10 binary-expr comparison position (S84 v0.2.4 #5): if a prior
    // pre-pass at `inferBareVariantsAtComparisonSites` has already resolved
    // this bare-variant ident against the comparison's reactive-cell type,
    // honor the resolution and skip — re-emitting against `contextType`
    // (which may be `null` for unannotated `let` / `const`) would produce a
    // spurious E-VARIANT-AMBIGUOUS. The flag is set by the pre-pass when
    // BOTH operands meet the binary-comparison shape AND the cell's
    // resolvedType is enum/union; non-matching shapes leave the flag unset
    // and the normal `contextType`-driven path runs unchanged.
    if ((ident as Record<string, unknown>)._bareVariantInferredAtBinaryExpr === true) return;

    // Determine the enum that should contain this variant from contextType.
    // Resolution rules (mirrored from §14.10 normative statements):
    //   - null / asIs / unknown / non-enum / non-union → no type context.
    //   - enum → check variant in this enum.
    //   - union → if exactly one enum member has the variant, OK; if multiple,
    //     ambiguous; if none, unknown variant across all enum members.
    if (!contextType) {
      // No type context per §14.10 line 7173-7174.
      errors.push(new TSError(
        "E-VARIANT-AMBIGUOUS",
        `E-VARIANT-AMBIGUOUS: Bare variant \`.${variantName}\` has no type context. ` +
        `Add a type annotation (\`<x>: SomeEnum = .${variantName}\`) or qualify the variant ` +
        `(\`SomeEnum.${variantName}\`). Per §14.10, bare variants are only legal at positions ` +
        `where the type is fixed by the surrounding declaration.`,
        span,
      ));
      return;
    }

    if (contextType.kind === "enum") {
      const enumType = contextType as EnumType;
      const has = (enumType.variants ?? []).some(v => v.name === variantName);
      if (!has) {
        const known = (enumType.variants ?? []).map(v => "." + v.name).join(", ");
        errors.push(new TSError(
          "E-TYPE-063",
          `E-TYPE-063: \`.${variantName}\` is not a declared variant of enum ` +
          `\`${enumType.name}\`. Known variants: ${known || "(none)"}. ` +
          `Check for a typo or add the variant to the enum declaration (§42).`,
          span,
        ));
      }
      return;
    }

    if (contextType.kind === "union") {
      const enumMembers = (contextType as UnionType).members.filter(
        (m: ResolvedType) => m.kind === "enum",
      ) as EnumType[];
      const declarers = enumMembers.filter(
        (em) => (em.variants ?? []).some(v => v.name === variantName),
      );
      if (declarers.length === 0) {
        // No enum member declares the variant.
        if (enumMembers.length === 0) {
          // Union has no enum members at all — treat as no-context (rare).
          errors.push(new TSError(
            "E-VARIANT-AMBIGUOUS",
            `E-VARIANT-AMBIGUOUS: Bare variant \`.${variantName}\` cannot be resolved against ` +
            `a union with no enum members. Qualify the variant or change the position type.`,
            span,
          ));
        } else {
          const enumNames = enumMembers.map(em => em.name).join(", ");
          errors.push(new TSError(
            "E-TYPE-063",
            `E-TYPE-063: \`.${variantName}\` is not a declared variant of any enum in ` +
            `\`${enumNames}\`. Check for a typo or add the variant to one of the enum declarations (§42).`,
            span,
          ));
        }
        return;
      }
      if (declarers.length > 1) {
        const declarerNames = declarers.map(em => em.name).join(", ");
        errors.push(new TSError(
          "E-VARIANT-AMBIGUOUS",
          `E-VARIANT-AMBIGUOUS: Bare variant \`.${variantName}\` is ambiguous in union-typed ` +
          `context. Multiple union members declare \`.${variantName}\`: ${declarerNames}. ` +
          `Qualify the variant — write \`${declarers[0].name}.${variantName}\` or one of the ` +
          `other enum names — to disambiguate (§14.10).`,
          span,
        ));
        return;
      }
      // Exactly one declarer — silent (the resolution is unambiguous).
      return;
    }

    // contextType is asIs / unknown / non-enum / non-union — treat as
    // no-context. Per §14.10 line 7173, the bare variant is ambiguous.
    if (contextType.kind === "asIs" || contextType.kind === "unknown") {
      errors.push(new TSError(
        "E-VARIANT-AMBIGUOUS",
        `E-VARIANT-AMBIGUOUS: Bare variant \`.${variantName}\` has no resolvable type ` +
        `context. Add a concrete enum type annotation or qualify the variant ` +
        `(\`SomeEnum.${variantName}\`). Per §14.10, bare variants require a statically ` +
        `known enum or union-of-enums context.`,
        span,
      ));
      return;
    }

    // Other contexts (struct, primitive, etc.): the position type can't carry
    // an enum variant. This is a type-mismatch — defer to existing E-TYPE-031
    // path or emit a focused E-VARIANT-AMBIGUOUS so the writer learns the
    // rule. We choose E-VARIANT-AMBIGUOUS for consistency with the no-context
    // wording per §14.10 line 7174.
    errors.push(new TSError(
      "E-VARIANT-AMBIGUOUS",
      `E-VARIANT-AMBIGUOUS: Bare variant \`.${variantName}\` cannot be resolved — the ` +
      `position type is not an enum or union of enums. Qualify the variant ` +
      `(\`SomeEnum.${variantName}\`) or change the position type (§14.10).`,
      span,
    ));
  });
}

/**
 * S84 v0.2.4 #4.5 (Gap A) — Bare-variant inference with type-context
 * navigation through struct fields and array elements.
 *
 * Companion to `inferBareVariantsInExpr` (flat walker, single context type
 * for the whole subtree). When the LHS-driven contextType is a struct or
 * an array-of-struct, the bare variants inside the initializer's struct
 * literals must each resolve against the CORRESPONDING FIELD'S type, not
 * the overall context type. The flat walker can't make that distinction;
 * this walker does.
 *
 * Activation rule: invoke this walker INSTEAD OF `inferBareVariantsInExpr`
 * when contextType is one of:
 *   - StructType            (e.g. `<x>: { f: Enum } = { f: .V }`)
 *   - ArrayType of struct   (e.g. `<x>: { f: Enum }[] = [{ f: .V }, ...]`)
 *   - ArrayType of enum/union (e.g. `<x>: Enum[] = [.V, .W]`)
 *   - ArrayType of array of {struct|enum|union}  (nested deeper)
 *
 * For other contextTypes (enum / union / asIs / null / primitive), the flat
 * walker `inferBareVariantsInExpr` is sufficient — there's no per-position
 * context refinement.
 *
 * Walker shape: node-aware traversal of ExprNode. At each node, we know the
 * "expected type at this position." Recursion rules:
 *   - object literal in struct context → recurse on each prop with
 *     `struct.fields.get(propName)` as the new context type.
 *   - array literal in array context → recurse on each element with
 *     `array.element` as the new context type.
 *   - any other node → fall back to flat `inferBareVariantsInExpr` with the
 *     current contextType. (This handles ternary inside an object value,
 *     binary-comparison, etc. — the flat walker is sufficient because the
 *     position type does not refine further through these shapes.)
 *
 * Bare-variant resolution at each leaf ident is done by the same helper
 * `resolveBareVariantAgainstType` extracted from `inferBareVariantsInExpr`
 * — single source of diagnostic wording, identical semantics.
 */
function inferBareVariantsWithStructNav(
  exprNode: unknown,
  contextType: ResolvedType | null,
  span: Span,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  const node = exprNode as { kind?: string } & Record<string, unknown>;

  // Array context — descend into array-literal elements with the element type.
  if (contextType && contextType.kind === "array" && node.kind === "array") {
    const elementType = (contextType as ArrayType).element;
    const elements = Array.isArray(node.elements) ? (node.elements as unknown[]) : [];
    for (const el of elements) {
      // Recurse with the element type — handles array-of-struct and
      // array-of-array shapes.
      inferBareVariantsWithStructNav(el, elementType, span, errors);
    }
    return;
  }

  // Struct context — descend into object-literal properties with field types.
  if (contextType && contextType.kind === "struct" && node.kind === "object") {
    const structType = contextType as StructType;
    const props = Array.isArray(node.props) ? (node.props as unknown[]) : [];
    for (const propUnknown of props) {
      if (!propUnknown || typeof propUnknown !== "object") continue;
      const prop = propUnknown as Record<string, unknown>;
      if (prop.kind === "prop") {
        // Get the field name. The prop key is either a static string or an
        // expression (computed key); we only navigate when it's a static
        // string, because computed keys make field lookup undecidable.
        let fieldName: string | null = null;
        if (typeof prop.key === "string") {
          fieldName = prop.key;
        } else if (prop.key && typeof prop.key === "object" && (prop.key as { kind?: string }).kind === "ident" && typeof (prop.key as { name?: string }).name === "string") {
          fieldName = (prop.key as { name: string }).name;
        }
        const fieldType = fieldName !== null ? structType.fields.get(fieldName) ?? null : null;
        // Recurse on the value with the field's type — fieldType may be
        // null for unknown fields (writer typo or shape drift), in which
        // case the leaf-flat walker still runs with null context per
        // §14.10 line 7174 wording.
        inferBareVariantsWithStructNav(prop.value, fieldType, span, errors);
      } else if (prop.kind === "shorthand") {
        // Shorthand `{ x }` — the value reference is an ident. Not a
        // bare-variant shape; skip.
        continue;
      } else if (prop.kind === "spread") {
        // Spread `{ ...other }` — the spread argument's type is the same as
        // the struct context (a partial-merge). Recurse with the struct
        // context so bare variants inside the spread (rare) still resolve.
        inferBareVariantsWithStructNav(prop.argument, structType, span, errors);
      }
    }
    return;
  }

  // Array context with non-array node (e.g. spread-only init) — fall back
  // to flat walker with element type to catch any bare variants.
  if (contextType && contextType.kind === "array") {
    inferBareVariantsInExpr(exprNode, (contextType as ArrayType).element, span, errors);
    return;
  }

  // Struct context with non-object node — fall back to flat walker.
  if (contextType && contextType.kind === "struct") {
    inferBareVariantsInExpr(exprNode, contextType, span, errors);
    return;
  }

  // Any other contextType (enum / union / asIs / null / primitive) — the
  // flat walker is sufficient. There's no per-position refinement.
  inferBareVariantsInExpr(exprNode, contextType, span, errors);
}

/**
 * Bug 7 (M9) — bare-variant inference at reactive-site bare-expr shapes.
 *
 * Companion to `inferBareVariantsInExpr` for bare-expr statements whose root
 * is a reactive write or an engine-transition call. §14.10 normative position
 * #2 (`@cell = .V where @cell: T`) and the engine-transition shorthand
 * `@cell.advance(.V)` both fix the variant context from the LHS cell's type.
 *
 * Two narrow shapes are recognized at the bare-expr root:
 *
 *   - AssignExpr { target: IdentExpr(@cell), value: <expr containing .V> }
 *     The cell name (post-`@`) is looked up in scope; if its resolvedType is
 *     enum or union, the value subtree is walked with that contextType.
 *
 *   - CallExpr { callee: MemberExpr(IdentExpr(@cell), "advance" | ...), args }
 *     The cell name is looked up in scope; if its resolvedType is enum or
 *     union, every arg subtree is walked with that contextType. We do NOT
 *     constrain this to a fixed allowlist of method names — any engine
 *     transition method (`advance`, `set`, ...) follows the same rule.
 *     The transition-call legality check (`checkTransitionCallsInExpr`)
 *     already gates which method names are valid; this helper rides on top.
 *
 * Silent fall-through for any shape that does not match (including CallExprs
 * whose callee object is NOT a reactive ident, and AssignExprs whose target
 * is not a bare `@cell` ident). The existing diagnostic pipeline owns the
 * non-matching shapes.
 */
function inferReactiveSiteBareVariants(
  exprNode: unknown,
  scopeChain: ScopeChain,
  span: Span,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;
  const root = exprNode as { kind?: string } & Record<string, unknown>;

  /** Resolve `@name` → enum/union ResolvedType from scopeChain, or null. */
  const resolveReactiveCellType = (cellRef: string): ResolvedType | null => {
    const entry = scopeChain.lookup(cellRef) as
      | { kind?: string; resolvedType?: ResolvedType }
      | undefined;
    if (!entry || entry.kind !== "reactive" || !entry.resolvedType) return null;
    const rt = entry.resolvedType;
    if (rt.kind === "enum" || rt.kind === "union") return rt;
    return null;
  };

  // Shape 1: AssignExpr at the bare-expr root.
  if (root.kind === "assign") {
    const target = root.target as { kind?: string; name?: string } | undefined;
    const value = root.value;
    if (
      target &&
      target.kind === "ident" &&
      typeof target.name === "string" &&
      target.name.startsWith("@")
    ) {
      const ctx = resolveReactiveCellType(target.name);
      if (ctx) inferBareVariantsInExpr(value, ctx, span, errors);
    }
    return;
  }

  // Shape 2: CallExpr at the bare-expr root with MemberExpr callee whose
  // object is a reactive `@cell` ident.
  if (root.kind === "call") {
    const callee = root.callee as
      | { kind?: string; object?: { kind?: string; name?: string } }
      | undefined;
    if (
      callee &&
      callee.kind === "member" &&
      callee.object &&
      callee.object.kind === "ident" &&
      typeof callee.object.name === "string" &&
      callee.object.name.startsWith("@")
    ) {
      const ctx = resolveReactiveCellType(callee.object.name);
      if (ctx) {
        const args = Array.isArray(root.args) ? (root.args as unknown[]) : [];
        for (const arg of args) {
          inferBareVariantsInExpr(arg, ctx, span, errors);
        }
      }
    }
    return;
  }

  // No matching shape — silent fall-through.
}

/**
 * S84 v0.2.4 #5 — bare-variant inference at binary-expression comparison
 * positions. Companion to `inferReactiveSiteBareVariants` (Bug 7 — reassignment
 * shapes) and `inferBareVariantsInExpr` (LHS-declared positions).
 *
 * §14.10 enumerates SIX explicit bare-variant inference positions:
 *   1. state-decl LHS annotation: `<x>: T = .V`
 *   2. reactive-write reassignment: `@cell = .V where @cell: T` (Bug 7)
 *   3. function parameter type
 *   4. function return type
 *   5. match on-expression type (`<match for=T> | .V => ...`)
 *   6. engine `for=T` qualifier
 *
 * The trailing clause of §14.10 line 7291 — "or any other position where the
 * type is fixed by the surrounding declaration" — extends the inference rule
 * to the IMPLICIT seventh position: a binary comparison where one operand is
 * a reactive cell whose type is statically known. The LHS cell's type fixes
 * the variant context for the bare `.V` on the other side:
 *
 *   `@phase == .Loading`     // @phase: Phase → .Loading resolves vs Phase
 *   `.Loading == @phase`     // symmetric
 *   `@phase != .Loading`     // inequality — same context fix
 *
 * Per §45.5 `==` (value equality) is distinct from `is` (variant tag check),
 * BUT both fix the variant context from the cell's enum type — the position
 * type IS the same in both. This helper handles `==`/`!=` (§45). The `is`
 * family is structurally identical at the AST level; this helper accepts
 * `is` / `is-not` operators alongside `==` / `!=` so that
 * `let x = @phase is .Loading` does not spuriously fire E-VARIANT-AMBIGUOUS
 * when called from positions (let-decl / const-decl / bare-expr) that do not
 * otherwise carry a typed context. The diagnostic semantics for `is` proper
 * (`E-TYPE-062` on non-enum LHS) are owned by `checkIsExpressions` and run
 * independently.
 *
 * Ordered comparisons `<`, `<=`, `>`, `>=` are NOT handled here. Per the
 * brief, scrml admits ordered comparisons on `number`/`string` only; enums
 * do not carry an order relation, so `@phase < .Loading` is meaningless at
 * the type level. If a future spec amendment lifts that restriction, this
 * helper's operator set extends naturally.
 *
 * **Walker placement:** Invoked from the same call sites that already invoke
 * `inferBareVariantsInExpr`:
 *
 *   - let-decl / const-decl init expressions (line ~4356-4378)
 *   - bare-expr top-level expressions (line ~4671-4675)
 *
 * The helper runs BEFORE `inferBareVariantsInExpr`; when it cleanly resolves
 * a bare-variant ident, it stamps `_bareVariantInferredAtBinaryExpr=true`
 * (non-enumerable, mirroring B3's `_resolvedStateCell` convention) on the
 * ident node. `inferBareVariantsInExpr` checks the flag and skips the ident,
 * preventing a spurious second diagnostic from the no-type-context branch.
 *
 * **Silent fall-through cases (no flag stamp, normal path runs):**
 *   - Cell ident does not resolve in scope.
 *   - Cell resolvedType is not enum / not union (the comparison is type-
 *     mismatched; `E-TYPE-062` or `E-EQ-*` upstream owns the report).
 *   - Operator is not in the supported set (already-handled positions).
 *   - Bare-variant shape is malformed (defensive).
 *
 * Spec authority:
 *   §14.10 line 7291 — "any other position where the type is fixed"
 *   §45.5         — `==` vs `is` distinction (both fix the context)
 *   §34          — E-VARIANT-AMBIGUOUS catalog row
 */
function inferBareVariantsAtComparisonSites(
  exprNode: unknown,
  scopeChain: ScopeChain,
  span: Span,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;

  /** Resolve `@name` → enum/union ResolvedType from scopeChain, or null. */
  const resolveReactiveCellType = (cellRef: string): ResolvedType | null => {
    const entry = scopeChain.lookup(cellRef) as
      | { kind?: string; resolvedType?: ResolvedType }
      | undefined;
    if (!entry || entry.kind !== "reactive" || !entry.resolvedType) return null;
    const rt = entry.resolvedType;
    if (rt.kind === "enum" || rt.kind === "union") return rt;
    return null;
  };

  /**
   * True if `node` is an `@`-prefixed IdentExpr that resolves to a reactive
   * cell whose resolvedType is enum or union. Returns the resolved type
   * (for use as contextType), or null on miss.
   */
  const resolveReactiveOperand = (node: unknown): ResolvedType | null => {
    if (!node || typeof node !== "object") return null;
    const n = node as { kind?: string; name?: string };
    if (n.kind !== "ident" || typeof n.name !== "string") return null;
    if (!n.name.startsWith("@")) return null;
    return resolveReactiveCellType(n.name);
  };

  /**
   * True if `node` is a bare-variant IdentExpr (`.Variant` — leading dot
   * followed by uppercase identifier). Returns the variant name without
   * the dot, or null on miss.
   */
  const matchBareVariantIdent = (node: unknown): string | null => {
    if (!node || typeof node !== "object") return null;
    const n = node as { kind?: string; name?: string };
    if (n.kind !== "ident" || typeof n.name !== "string") return null;
    const raw = n.name;
    if (raw.length < 2 || raw[0] !== ".") return null;
    const variantName = raw.slice(1);
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(variantName)) return null;
    return variantName;
  };

  /**
   * The supported operator set for comparison-position inference. `is` and
   * `is-not` are included because their structural shape at the AST level is
   * identical (`binary { op, left, right }` with `right` carrying the bare
   * variant). The semantic distinction between `==` and `is` (§45.5) is
   * orthogonal to the type-context-fix rule that drives this helper.
   */
  const isComparisonOp = (op: unknown): boolean => {
    return op === "==" || op === "!=" || op === "is" || op === "is-not";
  };

  /**
   * Stamp a non-enumerable flag on the bare-variant ident so the subsequent
   * `inferBareVariantsInExpr` walk skips it. Mirrors B3's `_resolvedStateCell`
   * convention (defineProperty + non-enumerable + configurable + writable).
   */
  const stampInferredFlag = (ident: object): void => {
    Object.defineProperty(ident, "_bareVariantInferredAtBinaryExpr", {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  };

  /**
   * Resolve a single bare-variant ident against the supplied enum/union
   * contextType. Mirrors the diagnostics emitted by `inferBareVariantsInExpr`
   * (E-TYPE-063 on unknown-in-enum, E-VARIANT-AMBIGUOUS on union ambiguity,
   * E-TYPE-063 on union-none-declared). The contract here is narrower than
   * the LHS-declared path: we already know `contextType` is enum or union
   * (resolveReactiveOperand only returns those kinds), so the null / asIs /
   * non-enum / non-union branches are unreachable.
   */
  const resolveBareVariantAgainstCellType = (
    ident: object,
    variantName: string,
    contextType: ResolvedType,
  ): void => {
    if (contextType.kind === "enum") {
      const enumType = contextType as EnumType;
      const has = (enumType.variants ?? []).some((v) => v.name === variantName);
      if (!has) {
        const known = (enumType.variants ?? []).map((v) => "." + v.name).join(", ");
        errors.push(new TSError(
          "E-TYPE-063",
          `E-TYPE-063: \`.${variantName}\` is not a declared variant of enum ` +
          `\`${enumType.name}\`. Known variants: ${known || "(none)"}. ` +
          `Check for a typo or add the variant to the enum declaration (§42).`,
          span,
        ));
      }
      // Stamp the flag whether the variant resolved cleanly or fired E-TYPE-063 —
      // either way, the diagnostic is final for this ident and the outer walk
      // must not also fire E-VARIANT-AMBIGUOUS for the same node.
      stampInferredFlag(ident);
      return;
    }

    if (contextType.kind === "union") {
      const enumMembers = (contextType as UnionType).members.filter(
        (m: ResolvedType) => m.kind === "enum",
      ) as EnumType[];
      const declarers = enumMembers.filter(
        (em) => (em.variants ?? []).some((v) => v.name === variantName),
      );
      if (declarers.length === 0) {
        if (enumMembers.length > 0) {
          const enumNames = enumMembers.map((em) => em.name).join(", ");
          errors.push(new TSError(
            "E-TYPE-063",
            `E-TYPE-063: \`.${variantName}\` is not a declared variant of any enum in ` +
            `\`${enumNames}\`. Check for a typo or add the variant to one of the enum declarations (§42).`,
            span,
          ));
        }
        // Stamp the flag; the upstream LHS-driven path must not re-fire on
        // the same ident from its own no-context branch.
        stampInferredFlag(ident);
        return;
      }
      if (declarers.length > 1) {
        const declarerNames = declarers.map((em) => em.name).join(", ");
        errors.push(new TSError(
          "E-VARIANT-AMBIGUOUS",
          `E-VARIANT-AMBIGUOUS: Bare variant \`.${variantName}\` is ambiguous in union-typed ` +
          `context. Multiple union members declare \`.${variantName}\`: ${declarerNames}. ` +
          `Qualify the variant — write \`${declarers[0].name}.${variantName}\` or one of the ` +
          `other enum names — to disambiguate (§14.10).`,
          span,
        ));
        stampInferredFlag(ident);
        return;
      }
      // Exactly one declarer — silent.
      stampInferredFlag(ident);
      return;
    }
    // Unreachable: resolveReactiveCellType only returns enum/union.
  };

  /**
   * Node-aware walk over the expression tree. At every binary-expr with a
   * supported comparison op, inspect both operands; if one is a reactive cell
   * (resolvable to enum/union) and the other is a bare-variant ident, resolve.
   * Recurse into every child branch so nested comparisons (`@a == .A && @b == .B`)
   * are all visited.
   */
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string } & Record<string, unknown>;

    if (n.kind === "binary" && isComparisonOp(n.op)) {
      const leftCellType = resolveReactiveOperand(n.left);
      const rightCellType = resolveReactiveOperand(n.right);

      // Pattern A: @cell <op> .V   — LHS cell, RHS bare variant.
      if (leftCellType && n.right) {
        const variantName = matchBareVariantIdent(n.right);
        if (variantName !== null) {
          resolveBareVariantAgainstCellType(n.right as object, variantName, leftCellType);
        }
      }
      // Pattern B: .V <op> @cell   — RHS cell, LHS bare variant.
      if (rightCellType && n.left) {
        const variantName = matchBareVariantIdent(n.left);
        if (variantName !== null) {
          resolveBareVariantAgainstCellType(n.left as object, variantName, rightCellType);
        }
      }
    }

    // Recurse into every child branch. The set mirrors `forEachIdentInExprNode`
    // (expression-parser.ts:2200+) so nested comparisons inside binary, logical,
    // ternary, assign, member, call, etc. are all visited.
    if (n.kind === "binary" || n.kind === "assign") {
      walk((n as Record<string, unknown>).left);
      walk((n as Record<string, unknown>).right);
      walk((n as Record<string, unknown>).target);
      walk((n as Record<string, unknown>).value);
      return;
    }
    if (n.kind === "ternary") {
      walk((n as Record<string, unknown>).condition);
      walk((n as Record<string, unknown>).consequent);
      walk((n as Record<string, unknown>).alternate);
      return;
    }
    if (n.kind === "unary") {
      walk((n as Record<string, unknown>).argument);
      return;
    }
    if (n.kind === "member") {
      walk((n as Record<string, unknown>).object);
      return;
    }
    if (n.kind === "index") {
      walk((n as Record<string, unknown>).object);
      walk((n as Record<string, unknown>).index);
      return;
    }
    if (n.kind === "call") {
      walk((n as Record<string, unknown>).callee);
      const args = (n as Record<string, unknown>).args;
      if (Array.isArray(args)) for (const a of args) walk(a);
      return;
    }
    if (n.kind === "array") {
      const elements = (n as Record<string, unknown>).elements;
      if (Array.isArray(elements)) for (const e of elements) walk(e);
      return;
    }
    if (n.kind === "object") {
      const props = (n as Record<string, unknown>).properties;
      if (Array.isArray(props)) {
        for (const p of props) {
          if (p && typeof p === "object") {
            walk((p as Record<string, unknown>).value);
            walk((p as Record<string, unknown>).argument); // spread
          }
        }
      }
      return;
    }
    // ident / lit / placeholder / paren / etc — no comparison-position children.
    if (n.kind === "paren") {
      walk((n as Record<string, unknown>).expr);
      return;
    }
  };

  walk(exprNode);
}

/**
 * S84 v0.2.4 #5-followon (Gap B.4) — bare-variant inference at function
 * call-arg positions.
 *
 * Sibling to `inferBareVariantsAtComparisonSites` (Bug 5) and
 * `inferReactiveSiteBareVariants` (Bug 7). Together with the new
 * Gap A struct-nav walker they form the complete §14.10 inference family.
 *
 * Walker placement: this helper walks an ExprNode tree node-aware (NOT the
 * flat `forEachIdentInExprNode`), looking for `kind === "call"` nodes whose
 * callee is an IdentExpr that resolves to a function with known param
 * types. For each (position, arg) pair where the param type is enum or
 * union, dispatch `inferBareVariantsInExpr(arg, paramType, ...)`. Resolved
 * idents get `_bareVariantInferredAtBinaryExpr` stamped (sharing the
 * Bug 5 flag) so downstream walkers deduplicate.
 *
 * Param-type lookup uses the `fnSignatures` map populated by
 * `collectFnErrorTypes` (file-level pre-pass). The runtime scope chain is
 * NOT consulted — fnSignatures is the canonical source of param types,
 * and it's populated for every function-decl in the file at pre-pass
 * time (no forward-reference problem).
 *
 * Silent fall-through cases:
 *   - Callee is not a simple IdentExpr (e.g. method calls, computed
 *     callees) — these positions don't fit the §14.10 frame today.
 *   - Function name not in fnSignatures (external imports, stdlib calls).
 *   - Function has no param annotations (silent silent — same as today).
 *   - Arg position has a non-enum / non-union param type — falls through
 *     to the existing flat walker via the recursive walk below.
 *
 * Spec authority:
 *   §14.10 line 7291 — "any other position where the type is fixed"
 *   §34            — E-VARIANT-AMBIGUOUS + E-TYPE-063
 */
function inferBareVariantsAtCallArgs(
  exprNode: unknown,
  fnSignatures: Map<string, {
    params: Array<{ name: string; type: ResolvedType }>;
    returnType: ResolvedType;
  }>,
  span: Span,
  errors: TSError[],
): void {
  if (!exprNode || typeof exprNode !== "object") return;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string } & Record<string, unknown>;

    if (n.kind === "call") {
      const callee = n.callee as { kind?: string; name?: string } | undefined;
      const args = Array.isArray(n.args) ? (n.args as unknown[]) : [];

      // Only handle the simple-ident callee shape. Method calls
      // (`obj.method(.V)`) fall through silently — they hit the existing
      // `inferReactiveSiteBareVariants` path when the bare-expr root is
      // the call itself; otherwise they're not in §14.10 scope today.
      if (callee && callee.kind === "ident" && typeof callee.name === "string") {
        const sig = fnSignatures.get(callee.name);
        if (sig) {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const param = sig.params[i];
            if (!param) continue; // varargs / over-supplied — silent.
            const paramType = param.type;
            if (paramType.kind !== "enum" && paramType.kind !== "union") {
              continue; // non-enum param type — bare variants make no sense here.
            }
            // Dispatch the existing flat walker with this arg position's
            // expected type. Idents stamped here get the standard flag, so
            // the call-arg's bare-variant gets diagnosed against the right
            // enum context AND any downstream walker skips it.
            inferBareVariantsInExpr(arg, paramType, span, errors);
            // Also stamp the call-arg ident directly if it's a top-level
            // bare-variant ident. `inferBareVariantsInExpr` doesn't stamp;
            // it only emits diagnostics. Stamping here lets the comparison-
            // site walker's flag mechanism (and the let/state-decl flat
            // walker's flag-check) skip on a second pass.
            if (arg && typeof arg === "object") {
              const a = arg as { kind?: string; name?: string };
              if (a.kind === "ident" && typeof a.name === "string" && a.name.startsWith(".")) {
                Object.defineProperty(arg, "_bareVariantInferredAtBinaryExpr", {
                  value: true, enumerable: false, configurable: true, writable: true,
                });
              }
            }
          }
        }
      }
    }

    // Recurse into every child branch — the call-arg node may itself
    // contain nested calls (`f(g(.V))`).
    if (n.kind === "binary" || n.kind === "assign") {
      walk((n as Record<string, unknown>).left);
      walk((n as Record<string, unknown>).right);
      walk((n as Record<string, unknown>).target);
      walk((n as Record<string, unknown>).value);
      return;
    }
    if (n.kind === "ternary") {
      walk((n as Record<string, unknown>).condition);
      walk((n as Record<string, unknown>).consequent);
      walk((n as Record<string, unknown>).alternate);
      return;
    }
    if (n.kind === "unary") {
      walk((n as Record<string, unknown>).argument);
      return;
    }
    if (n.kind === "member") {
      walk((n as Record<string, unknown>).object);
      return;
    }
    if (n.kind === "index") {
      walk((n as Record<string, unknown>).object);
      walk((n as Record<string, unknown>).index);
      return;
    }
    if (n.kind === "call") {
      walk((n as Record<string, unknown>).callee);
      const args = (n as Record<string, unknown>).args;
      if (Array.isArray(args)) for (const a of args) walk(a);
      return;
    }
    if (n.kind === "array") {
      const elements = (n as Record<string, unknown>).elements;
      if (Array.isArray(elements)) for (const e of elements) walk(e);
      return;
    }
    if (n.kind === "object") {
      const props = (n as Record<string, unknown>).props;
      if (Array.isArray(props)) {
        for (const p of props) {
          if (p && typeof p === "object") {
            walk((p as Record<string, unknown>).value);
            walk((p as Record<string, unknown>).argument);
          }
        }
      }
      return;
    }
    if (n.kind === "paren") {
      walk((n as Record<string, unknown>).expr);
      return;
    }
  };

  walk(exprNode);
}

// ---------------------------------------------------------------------------
// TS-C: Pattern matching exhaustiveness checker (§18.8)
// ---------------------------------------------------------------------------

interface ArmPattern {
  kind: "variant" | "wildcard" | "is-type" | string;
  variantName?: string;
  typeName?: string;
}

interface EnumExhaustivenessResult {
  missing: string[];
  unreachableWildcard: boolean;
  duplicateArms: string[];
}

interface UnionExhaustivenessResult {
  missing: string[];
  unreachableWildcard: boolean;
}

/**
 * Check exhaustiveness of a match over an enum type (§18.8.1).
 */
function checkEnumExhaustiveness(
  enumType: EnumType,
  armPatterns: ArmPattern[],
): EnumExhaustivenessResult {
  const allVariants = new Set((enumType.variants ?? []).map(v => v.name));
  const coveredVariants = new Set<string>();
  const duplicateArms: string[] = [];
  let hasWildcard = false;

  for (const pattern of armPatterns) {
    if (pattern.kind === "wildcard") {
      hasWildcard = true;
      break;
    }
    if (pattern.kind === "variant") {
      const name = pattern.variantName!;
      if (coveredVariants.has(name)) {
        duplicateArms.push(name);
      } else {
        coveredVariants.add(name);
      }
    }
  }

  const missing = hasWildcard
    ? []
    : [...allVariants].filter(v => !coveredVariants.has(v));

  const unreachableWildcard = hasWildcard && coveredVariants.size >= allVariants.size;

  return { missing, unreachableWildcard, duplicateArms };
}

/**
 * Check exhaustiveness of a match over a state type's substates (§54.4).
 *
 * Added 2026-04-20 (S32 Phase 3c). Substates are enum-like variants of the
 * parent state type: closed set declared at the state's definition. This
 * mirrors checkEnumExhaustiveness but iterates over the `substates` set
 * registered by Phase 3b.
 *
 * Arm patterns name substates via `< SubstateName>` markup — the parser
 * exposes them via `typeName` (kind === "is-type") or `variantName`
 * depending on the arm shape. Both are checked against the substates set.
 */
function checkSubstateExhaustiveness(
  stateType: StateType,
  armPatterns: ArmPattern[],
): EnumExhaustivenessResult {
  const allSubstates = new Set(stateType.substates ?? []);
  const coveredSubstates = new Set<string>();
  const duplicateArms: string[] = [];
  let hasWildcard = false;

  for (const pattern of armPatterns) {
    if (pattern.kind === "wildcard") {
      hasWildcard = true;
      break;
    }
    const name = pattern.variantName ?? pattern.typeName;
    if (name && allSubstates.has(name)) {
      if (coveredSubstates.has(name)) {
        duplicateArms.push(name);
      } else {
        coveredSubstates.add(name);
      }
    }
  }

  const missing = hasWildcard
    ? []
    : [...allSubstates].filter(v => !coveredSubstates.has(v));

  const unreachableWildcard = hasWildcard && coveredSubstates.size >= allSubstates.size;

  return { missing, unreachableWildcard, duplicateArms };
}

/**
 * Check exhaustiveness of a match over a union type (§18.8.2).
 */
function checkUnionExhaustiveness(
  unionType: UnionType,
  armPatterns: ArmPattern[],
): UnionExhaustivenessResult {
  const memberNames = new Set<string>();
  for (const member of (unionType.members ?? [])) {
    if (member.kind === "primitive") {
      memberNames.add((member as PrimitiveType).name);
    } else if (member.kind === "enum") {
      memberNames.add((member as EnumType).name);
    } else if (member.kind === "asIs") {
      memberNames.add("asIs");
    } else {
      memberNames.add(member.kind);
    }
  }

  const coveredMembers = new Set<string>();
  let hasWildcard = false;

  for (const pattern of armPatterns) {
    if (pattern.kind === "wildcard") {
      hasWildcard = true;
      break;
    }
    if (pattern.kind === "is-type") {
      coveredMembers.add(pattern.typeName!);
    }
  }

  const missing = hasWildcard
    ? []
    : [...memberNames].filter(m => !coveredMembers.has(m));

  const unreachableWildcard = hasWildcard && coveredMembers.size >= memberNames.size;

  return { missing, unreachableWildcard };
}

/**
 * Split the concatenated bare-expr "arm body" string into individual match arms.
 * The ast-builder currently collapses single-line arms into one bare-expr whose
 * `expr` holds text like ". Active => 1\n. Banned => 2\n. Active => 3".
 * Block arms (`.X => { ... }`) also land in this string with embedded braces.
 *
 * This splitter does brace-aware splitting. An arm starts at a line whose first
 * non-whitespace token is `.` (variant), `else`, or `not`. It ends at the
 * next arm header or at end-of-string, with embedded `{...}` blocks kept intact.
 */
function splitMatchArms(raw: string): string[] {
  if (!raw) return [];
  // S27: char-level scanner that recognizes arm-header starts both after
  // newlines AND inline on the same line. Pre-S27 splitMatchArms only
  // split on line boundaries, so a single-line match body
  //   `match x { .A => 1 .B => 2 }`
  // collected both arms into one piece and only the first variant
  // reached the exhaustiveness checker.
  //
  // Depth tracking: `{` `(` `[` increment; their counterparts decrement.
  // String tracking: inside `"..."` / `'...'` / `` `...` ``, characters
  // are literal — an arm-like substring inside a string is NOT a split.
  const arms: string[] = [];
  let cur = "";
  let depth = 0;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  const looksLikeArmHeader = (pos: number): boolean => {
    // Only consider arm-header starts preceded by whitespace (or at the
    // very start of `raw` — but that case is already "the first arm" so
    // we skip the split).
    if (pos === 0) return false;
    const prev = raw[pos - 1];
    if (!/\s/.test(prev)) return false;
    const rest = raw.slice(pos);
    // `.IDENT` (PascalCase) — enum variant arm. Allow whitespace between
    // `.` and the identifier (the tokenizer sometimes inserts space).
    if (/^\.\s*[A-Z][A-Za-z0-9_]*/.test(rest)) return true;
    // `::IDENT` — legacy variant arm
    if (/^::[A-Z][A-Za-z0-9_]*/.test(rest)) return true;
    // §54.4 Phase 3e: `< SubstateName>` — substate arm (space-after-< per §4.3).
    if (/^<\s+[A-Z][A-Za-z0-9_]*\s*>/.test(rest)) return true;
    // `else` / `not` keywords
    if (/^else\b/.test(rest)) return true;
    if (/^not\b/.test(rest)) return true;
    // `_ =>` wildcard alias
    if (/^_\s*(?:=>|:>|->)/.test(rest)) return true;
    return false;
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    // End-of-line resets line-comment mode.
    if (inLineComment) {
      cur += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") { cur += next; i++; inBlockComment = false; }
      continue;
    }
    if (inString) {
      cur += ch;
      if (ch === "\\" && next !== undefined) { cur += next; i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }

    // Enter string / comment modes BEFORE depth / arm-boundary checks
    if (ch === "/" && next === "/") { inLineComment = true; cur += ch; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; cur += ch; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; cur += ch; continue; }

    if (depth === 0 && looksLikeArmHeader(i) && cur.trim().length > 0) {
      arms.push(cur);
      cur = "";
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    cur += ch;
  }
  if (cur.trim().length > 0) arms.push(cur);
  return arms;
}

type ParsedArmPattern =
  | { kind: "variant"; variantName: string; payloadBindings: string[]; hasGuard: boolean; armText: string }
  | { kind: "wildcard"; isElse: boolean; isNot: boolean; hasGuard: boolean; armText: string }
  | { kind: "unknown"; armText: string };

/**
 * Parse one arm string into its pattern descriptor. Looks at text BEFORE the
 * first top-level `=>`, `:>`, or `->` arrow.
 */
function parseArmPattern(armText: string): ParsedArmPattern {
  const arrowMatch = armText.match(/^([\s\S]*?)(?:=>|:>|->)/);
  const head = (arrowMatch ? arrowMatch[1] : armText).trim();
  if (!head) return { kind: "unknown", armText };

  let hasGuard = false;
  {
    let depth = 0;
    for (let i = 0; i < head.length; i++) {
      const c = head[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0 && c === "|") { hasGuard = true; break; }
    }
    if (!hasGuard) {
      let d = 0;
      const h = " " + head + " ";
      for (let i = 0; i < h.length - 3; i++) {
        const c = h[i];
        if (c === "(" || c === "[" || c === "{") d++;
        else if (c === ")" || c === "]" || c === "}") d = Math.max(0, d - 1);
        else if (d === 0 && /\s/.test(c) && h.slice(i + 1, i + 4) === "if " && i > 0) {
          const tail = h.slice(i + 4).trim();
          if (tail.length > 0) { hasGuard = true; break; }
        }
      }
    }
  }

  const patOnly = head
    .replace(/\s*\|\s*[\s\S]*$/, "")
    .replace(/\s+if\s+[\s\S]*$/, "")
    .trim();

  if (/^else\b/.test(patOnly)) {
    return { kind: "wildcard", isElse: true, isNot: false, hasGuard, armText };
  }
  // §18.6: `_` is a valid alias for `else`.
  if (/^_(?!\w)/.test(patOnly)) {
    return { kind: "wildcard", isElse: true, isNot: false, hasGuard, armText };
  }
  if (/^not\b/.test(patOnly)) {
    return { kind: "wildcard", isElse: false, isNot: true, hasGuard, armText };
  }
  const varMatch = patOnly.match(/^\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\(([^)]*)\))?/);
  if (varMatch) {
    const payloadBindings = extractPayloadBindings(varMatch[3]);
    return { kind: "variant", variantName: varMatch[1], payloadBindings, hasGuard, armText };
  }
  // §54.4 Phase 3d: substate pattern `< SubstateName>` (space-after-< per §4.3 disambiguation).
  const subMatch = patOnly.match(/^<\s+([A-Z][A-Za-z0-9_]*)\s*>\s*(\(([^)]*)\))?/);
  if (subMatch) {
    const payloadBindings = extractPayloadBindings(subMatch[3]);
    return { kind: "variant", variantName: subMatch[1], payloadBindings, hasGuard, armText };
  }
  return { kind: "unknown", armText };
}

/**
 * Extract payload binding names from a parenthesized destructure list.
 * `.Mushroom(n)` → `["n"]`. `.Rect(w, h)` → `["w", "h"]`.
 * `.Foo(_, x, _)` → `["_", "x", "_"]` (discard `_` is preserved as a binding
 *   name; scope-checking treats it like any other name).
 * Returns empty array for missing/empty parens or unbindable shapes
 * (nested destructures, type annotations — out of B20's scope).
 */
function extractPayloadBindings(rawArgs: string | undefined): string[] {
  if (!rawArgs) return [];
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) return [];
  // Top-level comma split. Ignore parens/brackets/braces inside arg text
  // (e.g., type annotations). For B20: simple-name-only payload bindings;
  // nested destructure (`(a, (b, c))`) and type annotations (`(n: number)`)
  // fall through to the simple-split path and may produce non-ident strings,
  // which we filter below.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim().length > 0) parts.push(cur.trim());
  // Each part: take the leading bare identifier (ignore type annotations
  // like `n: number` — bind `n` only). Reject parts that don't start with
  // a valid identifier character.
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (m) out.push(m[1]);
  }
  return out;
}

interface ExtractedArms {
  armPatterns: ArmPattern[];
  elseIndex: number;
  total: number;
  guardArms: ParsedArmPattern[];
  hasNotArm: boolean;
}

function extractArmsFromMatchNode(node: ASTNodeLike): ExtractedArms {
  const body = (node.body as ASTNodeLike[] | undefined) ?? [];
  const armPatterns: ArmPattern[] = [];
  const guardArms: ParsedArmPattern[] = [];
  let elseIndex = -1;
  let hasNotArm = false;

  const pushVariant = (name: string): void => {
    armPatterns.push({ kind: "variant", variantName: name });
  };
  const pushWildcard = (isNot: boolean): void => {
    if (isNot) { armPatterns.push({ kind: "variant", variantName: "not" }); hasNotArm = true; }
    else {
      if (elseIndex < 0) elseIndex = armPatterns.length;
      armPatterns.push({ kind: "wildcard" });
    }
  };

  for (let i = 0; i < body.length; i++) {
    const arm = body[i];
    if (!arm || typeof arm !== "object") continue;
    if (arm.kind === "match-arm-block") {
      if (arm.isWildcard) pushWildcard(false);
      else if (arm.isNotArm) pushWildcard(true);
      else if (arm.variant) pushVariant(arm.variant as string);
      continue;
    }
    // Structured match-arm-inline nodes from the AST builder.
    if (arm.kind === "match-arm-inline") {
      const test: string = (arm as { test?: string }).test ?? "";
      if (test === "else") pushWildcard(false);
      else if (test === "not") pushWildcard(true);
      else {
        // Extract variant name from test pattern: ".VariantName" or ".Variant(binding)"
        const vMatch = test.match(/^(?:\.|::)\s*([A-Z][A-Za-z0-9_]*)/);
        if (vMatch) pushVariant(vMatch[1]);
        else if (test.startsWith('"') || test.startsWith("'")) {
          // String literal arms don't contribute to variant exhaustiveness
          armPatterns.push({ kind: "unknown", armText: test } as ParsedArmPattern);
        }
      }
      continue;
    }
    // §54.4 Phase 3e: `< Substate>` at arm position parses as html-fragment
    // today. Treat its content as an arm-pattern text, reusing the bare-expr
    // path. Downstream parseArmPattern already recognizes the `< Name>` shape.
    const armAsBareLike = arm.kind === "bare-expr"
      ? (arm as { expr?: unknown }).expr
      : (arm.kind === "html-fragment" ? (arm as { content?: unknown }).content : undefined);
    if (typeof armAsBareLike === "string") {
      const raw = armAsBareLike;
      const pieces = splitMatchArms(raw);
      for (const piece of pieces) {
        const parsed = parseArmPattern(piece);
        // S19 Phase 2: Pattern text with no `=>`/`:>`/`->` arrow and a
        // following if-stmt sibling indicates the ast-builder split a guard
        // arm (`.X if cond => body`) into [bare-expr ".X"] + [if-stmt].
        // Flag as a guard clause (E-SYNTAX-011).
        const hasArrow = /=>|:>|->/.test(piece);
        const nextSibling = body[i + 1];
        const nextIsIfStmt = nextSibling && typeof nextSibling === "object" &&
          (nextSibling as ASTNodeLike).kind === "if-stmt";
        if (!hasArrow && nextIsIfStmt && (parsed.kind === "variant" || parsed.kind === "wildcard")) {
          guardArms.push({ kind: "unknown", armText: piece.trim() + " if …" } as ParsedArmPattern);
        } else if (parsed.hasGuard) {
          guardArms.push(parsed);
        }
        if (parsed.kind === "variant") pushVariant(parsed.variantName);
        else if (parsed.kind === "wildcard") pushWildcard(parsed.isNot);
      }
    }
  }

  return { armPatterns, elseIndex, total: armPatterns.length, guardArms, hasNotArm };
}

function resolveMatchSubjectType(
  header: string | undefined,
  headerExpr: unknown,
  scopeChain: ScopeChain,
): ResolvedType | null {
  if (headerExpr && typeof headerExpr === "object") {
    const e = headerExpr as { kind?: string; name?: string };
    if (e.kind === "ident" && typeof e.name === "string") {
      const entry = scopeChain.lookup(e.name);
      if (entry && entry.resolvedType) return entry.resolvedType as ResolvedType;
      const rEntry = scopeChain.lookup("@" + e.name.replace(/^@/, ""));
      if (rEntry && rEntry.resolvedType) return rEntry.resolvedType as ResolvedType;
    }
  }
  if (typeof header === "string") {
    const trimmed = header.trim();
    if (/^[@A-Za-z_][\w]*$/.test(trimmed)) {
      const entry = scopeChain.lookup(trimmed);
      if (entry && entry.resolvedType) return entry.resolvedType as ResolvedType;
      if (trimmed.startsWith("@")) {
        const bare = trimmed.slice(1);
        const e2 = scopeChain.lookup(bare);
        if (e2 && e2.resolvedType) return e2.resolvedType as ResolvedType;
      } else {
        const e2 = scopeChain.lookup("@" + trimmed);
        if (e2 && e2.resolvedType) return e2.resolvedType as ResolvedType;
      }
    }
  }
  return null;
}

function checkMatchDiagnostics(
  node: ASTNodeLike,
  scopeChain: ScopeChain,
  errors: TSError[],
  filePath: string,
): void {
  const span = (node.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  const extracted = extractArmsFromMatchNode(node);


  for (const guard of extracted.guardArms) {
    const trimmed = guard.armText.trim().slice(0, 60).replace(/\s+/g, " ");
    errors.push(new TSError(
      "E-SYNTAX-011",
      "E-SYNTAX-011: Match arm guard clauses (`| cond` or `if cond`) are not supported in v1 (§18.10). " +
      "Arm: `" + trimmed + "...`. Use a plain pattern and move the condition into an `if` inside the arm body.",
      span,
    ));
  }

  if (extracted.elseIndex >= 0 && extracted.elseIndex < extracted.total - 1) {
    errors.push(new TSError(
      "E-SYNTAX-010",
      "E-SYNTAX-010: `else` arm must be the last arm in a `match` block (§18.6). " +
      "Found " + (extracted.total - 1 - extracted.elseIndex) + " arm(s) after `else`. " +
      "Move the `else` arm to the bottom of the match, or remove arms that appear after it.",
      span,
    ));
  }

  const subjectType = resolveMatchSubjectType(
    (node as { header?: string }).header,
    (node as { headerExpr?: unknown }).headerExpr,
    scopeChain,
  );

  if (!subjectType) return;

  const isPartial = (node as { partial?: boolean }).partial === true;

  if (subjectType.kind === "struct") {
    errors.push(new TSError(
      "E-TYPE-024",
      "E-TYPE-024: Cannot match on struct-typed subject `" + (subjectType as StructType).name + "`. " +
      "`match` supports enums, unions, and primitive literals (§18.8.2). " +
      "Use field access (`obj.field`) or destructuring in a normal expression instead.",
      span,
    ));
    return;
  }

  if (subjectType.kind === "asIs") {
    errors.push(new TSError(
      "E-TYPE-025",
      "E-TYPE-025: Cannot match on `asIs`-typed subject. `match` requires a typed subject (enum, union, or primitive). " +
      "Narrow the type first via a type annotation (`let x: SomeType = ...`) before matching.",
      span,
    ));
    return;
  }

  const isSubstatedState = subjectType.kind === "state" &&
    (subjectType as StateType).substates !== undefined &&
    (subjectType as StateType).substates!.size > 0;

  if (subjectType.kind === "enum" || subjectType.kind === "union" || isSubstatedState) {
    checkExhaustiveness(
      { arms: extracted.armPatterns } as unknown as ASTNodeLike,
      subjectType,
      span,
      errors,
      isPartial,
    );
  }
}

/**
 * TS-C entry point: check exhaustiveness for a match node and emit TSErrors.
 */
function checkExhaustiveness(
  matchNode: ASTNodeLike,
  subjectType: ResolvedType,
  matchSpan: Span,
  errors: TSError[],
  isPartial: boolean = false,
): void {
  const arms = (matchNode.arms as ASTNodeLike[] | undefined) ?? [];
  const armPatterns: ArmPattern[] = arms.map(arm => {
    if (arm && typeof arm === "object") {
      if ((arm as ASTNodeLike).pattern) return (arm as ASTNodeLike).pattern as ArmPattern;
      if (typeof (arm as ArmPattern).kind === "string") return arm as unknown as ArmPattern;
    }
    return { kind: "wildcard" } as ArmPattern;
  });

  if (subjectType.kind === "enum") {
    const { missing, unreachableWildcard, duplicateArms } =
      checkEnumExhaustiveness(subjectType as EnumType, armPatterns);

    for (const variantName of duplicateArms) {
      errors.push(new TSError(
        "E-TYPE-023",
        `E-TYPE-023: Duplicate match arm for variant \`::${variantName}\`. ` +
        `The second arm for \`${variantName}\` can never be reached. Remove the duplicate arm.`,
        matchSpan,
      ));
    }

    if (missing.length > 0 && !isPartial) {
      errors.push(new TSError(
        "E-TYPE-020",
        `E-TYPE-020: Non-exhaustive match over enum type \`${(subjectType as EnumType).name}\`. ` +
        `Missing variants: ${missing.map(v => `::${v}`).join(", ")}. ` +
        `Add arms for the missing variants, or add an \`else\` arm to handle them all.`,
        matchSpan,
      ));
    }

    if (isPartial && missing.length === 0 && !unreachableWildcard) {
      errors.push(new TSError(
        "W-MATCH-003",
        `W-MATCH-003: \`partial\` is unnecessary — all variants of \`${(subjectType as EnumType).name}\` are explicitly covered. ` +
        `Remove \`partial\` to use standard exhaustive match, which will catch future variant additions.`,
        matchSpan,
        "warning",
      ));
    }

    if (unreachableWildcard) {
      errors.push(new TSError(
        "W-MATCH-001",
        `W-MATCH-001: Wildcard \`_\` arm is unreachable. All variants of \`${(subjectType as EnumType).name}\` ` +
        `are already covered by explicit arms. Remove the \`_\` arm.`,
        matchSpan,
        "warning",
      ));
    }
  } else if (subjectType.kind === "state" && (subjectType as StateType).substates && ((subjectType as StateType).substates!.size > 0)) {
    // §54.4 — match over a substated state type. Substates are enum-like.
    const stateType = subjectType as StateType;
    const { missing, unreachableWildcard, duplicateArms } =
      checkSubstateExhaustiveness(stateType, armPatterns);

    for (const substateName of duplicateArms) {
      errors.push(new TSError(
        "E-TYPE-023",
        `E-TYPE-023: Duplicate match arm for substate \`< ${substateName}>\`. ` +
        `The second arm can never be reached. Remove the duplicate arm.`,
        matchSpan,
      ));
    }

    if (missing.length > 0 && !isPartial) {
      errors.push(new TSError(
        "E-TYPE-020",
        `E-TYPE-020: Non-exhaustive match over \`< ${stateType.name}>\` substates (§54.4). ` +
        `Missing substates: ${missing.map(v => `< ${v}>`).join(", ")}. ` +
        `Add arms for the missing substates, or add an \`else\` arm to handle them all.`,
        matchSpan,
      ));
    }

    if (isPartial && missing.length === 0 && !unreachableWildcard) {
      errors.push(new TSError(
        "W-MATCH-003",
        `W-MATCH-003: \`partial\` is unnecessary — all substates of \`< ${stateType.name}>\` are explicitly covered. ` +
        `Remove \`partial\` to use standard exhaustive match, which will catch future substate additions.`,
        matchSpan,
        "warning",
      ));
    }

    if (unreachableWildcard) {
      errors.push(new TSError(
        "W-MATCH-001",
        `W-MATCH-001: Wildcard \`_\` arm is unreachable. All substates of \`< ${stateType.name}>\` ` +
        `are already covered by explicit arms. Remove the \`_\` arm.`,
        matchSpan,
        "warning",
      ));
    }
  } else if (subjectType.kind === "union") {
    const { missing, unreachableWildcard } =
      checkUnionExhaustiveness(subjectType as UnionType, armPatterns);

    if (isPartial && missing.length === 0 && !unreachableWildcard) {
      errors.push(new TSError(
        "W-MATCH-003",
        `W-MATCH-003: \`partial\` is unnecessary — all union members are explicitly covered. ` +
        `Remove \`partial\` to use standard exhaustive match, which will catch future member additions.`,
        matchSpan,
        "warning",
      ));
    }

    if (missing.length > 0 && !isPartial) {
      // E-MATCH-012: specific check for T | not unions missing the `not` arm (§42)
      const unionHasNot = (subjectType as UnionType).members?.some(
        (m: ResolvedType) => m.kind === "not"
      );
      const missingNot = missing.includes("not");
      if (unionHasNot && missingNot) {
        errors.push(new TSError(
          "E-MATCH-012",
          `E-MATCH-012: Match on \`T | not\` type lacks a \`not\` arm and lacks an \`else\`/wildcard arm. ` +
          `Add a \`not => ...\` arm or an \`_ => ...\` wildcard to handle the absence case (§42).`,
          matchSpan,
        ));
        // Also report other missing members (besides `not`) if any
        const otherMissing = missing.filter((m: string) => m !== "not");
        if (otherMissing.length > 0) {
          errors.push(new TSError(
            "E-TYPE-006",
            `E-TYPE-006: Non-exhaustive match over union type. ` +
            `Missing members: ${otherMissing.join(", ")}. ` +
            `Add arms for the missing types, or add an \`else\` arm to handle them all.`,
            matchSpan,
          ));
        }
      } else {
        errors.push(new TSError(
          "E-TYPE-006",
          `E-TYPE-006: Non-exhaustive match over union type. ` +
          `Missing members: ${missing.join(", ")}. ` +
          `Add arms for the missing types, or add an \`else\` arm to handle them all.`,
          matchSpan,
        ));
      }
    }

    if (unreachableWildcard) {
      errors.push(new TSError(
        "W-MATCH-001",
        `W-MATCH-001: Wildcard \`_\` arm is unreachable. All members of the union type ` +
        `are already covered by explicit arms. Remove the \`_\` arm.`,
        matchSpan,
        "warning",
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// TS-G: Linear type enforcement (§34) and ~ tracking (§31)
// ---------------------------------------------------------------------------

type LinState = "unconsumed" | "consumed";
type TildeState = "uninitialized" | "initialized";
type MustUseState = "unused" | "used";

interface LinErrorDescriptor {
  code: "E-LIN-001" | "E-LIN-002" | "E-LIN-003" | "E-LIN-006";
  varName: string;
  span: Span;
  secondUseSpan?: Span;
  /** Span of the `lift` expression that first consumed this lin variable (Lin-A1). */
  liftSite?: Span;
  /** §35.5 E-LIN-006: the markup ctx kind where consumption occurred. */
  deferredCtx?: "request" | "poll";
}

interface TildeErrorDescriptor {
  code: "E-TILDE-001" | "E-TILDE-002";
  span: Span;
}

/**
 * LinTracker — tracks lin variable states within a single analysis context.
 */
class LinTracker {
  _vars: Map<string, LinState>;
  _firstUseSpan: Map<string, Span>;
  /** Lin-A1: tracks which variables were first consumed via `lift expr`. */
  _liftSites: Map<string, Span>;
  /**
   * §35.5 E-LIN-006: deferred-ctx depth at declaration time. 0 = declared
   * outside any `<request>` / `<poll>` body. A consumer at a higher depth
   * that came from a lower decl depth fires E-LIN-006.
   */
  _declDeferredDepth: Map<string, number>;

  constructor() {
    this._vars = new Map();
    this._firstUseSpan = new Map();
    this._liftSites = new Map();
    this._declDeferredDepth = new Map();
  }

  declare(name: string, deferredDepth: number = 0): void {
    this._vars.set(name, "unconsumed");
    this._firstUseSpan.delete(name);
    this._liftSites.delete(name);
    this._declDeferredDepth.set(name, deferredDepth);
  }

  consume(name: string, span: Span, currentDeferredDepth: number = 0, currentDeferredCtx: "request" | "poll" | null = null): LinErrorDescriptor | null {
    if (!this._vars.has(name)) return null;

    // §35.5 E-LIN-006: a lin declared outside a `<request>` / `<poll>`
    // body cannot be consumed inside one. Fire BEFORE the state check so
    // the user sees the boundary violation instead of a confusing E-LIN-002.
    const declDepth = this._declDeferredDepth.get(name) ?? 0;
    if (currentDeferredDepth > declDepth && currentDeferredCtx) {
      return {
        code: "E-LIN-006",
        varName: name,
        span,
        deferredCtx: currentDeferredCtx,
      };
    }

    const state = this._vars.get(name)!;
    if (state === "consumed") {
      return {
        code: "E-LIN-002",
        varName: name,
        span: this._firstUseSpan.get(name) ?? span,
        secondUseSpan: span,
        liftSite: this._liftSites.get(name),
      };
    }

    this._vars.set(name, "consumed");
    this._firstUseSpan.set(name, span);
    return null;
  }

  /**
   * Lin-A1: Consume a lin variable via a `lift` expression.
   * Records the lift site so E-LIN-002 messages can surface it.
   */
  consumeViaLift(name: string, span: Span): LinErrorDescriptor | null {
    const err = this.consume(name, span);
    if (!err) {
      this._liftSites.set(name, span);
    }
    return err;
  }

  forceConsume(name: string, span?: Span): void {
    this._vars.set(name, "consumed");
    if (span) this._firstUseSpan.set(name, span);
  }

  has(name: string): boolean { return this._vars.has(name); }

  isUnconsumed(name: string): boolean { return this._vars.get(name) === "unconsumed"; }

  names(): string[] { return [...this._vars.keys()]; }

  unconsumedNames(): string[] {
    return [...this._vars.entries()]
      .filter(([, s]) => s === "unconsumed")
      .map(([n]) => n);
  }

  consumedNames(): string[] {
    return [...this._vars.entries()]
      .filter(([, s]) => s === "consumed")
      .map(([n]) => n);
  }

  snapshot(): Map<string, LinState> { return new Map(this._vars); }

  restore(snap: Map<string, LinState>): void { this._vars = new Map(snap); }
}

/**
 * MustUseTracker — tracks tilde-decl variables that must be used at least once.
 */
class MustUseTracker {
  _vars: Map<string, MustUseState>;
  _declSpans: Map<string, Span>;

  constructor() {
    this._vars = new Map();
    this._declSpans = new Map();
  }

  declare(name: string, span?: Span): void {
    this._vars.set(name, "unused");
    if (span) this._declSpans.set(name, span);
  }

  markUsed(name: string): void {
    if (this._vars.has(name)) {
      this._vars.set(name, "used");
    }
  }

  has(name: string): boolean { return this._vars.has(name); }

  names(): string[] { return [...this._vars.keys()]; }

  unusedEntries(): Array<{ name: string; span: Span | undefined }> {
    return [...this._vars.entries()]
      .filter(([, s]) => s === "unused")
      .map(([n]) => ({ name: n, span: this._declSpans.get(n) }));
  }

  scanExpression(exprStr: string): void {
    if (!exprStr || typeof exprStr !== "string") return;
    for (const name of this._vars.keys()) {
      if (this._vars.get(name) === "used") continue;
      const re = new RegExp(`\\b${escapeForRegex(name)}\\b`);
      if (re.test(exprStr)) {
        this._vars.set(name, "used");
      }
    }
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Walk an ExprNode tree collecting raw strings from any escape-hatch nodes
 * encountered. Used by the meta-block lin scanner to recover ident references
 * that the ExprNode ident walker can't see — template-literal interpolations
 * like `${x}` degrade to escape-hatch raws, hiding the `x` reference.
 */
function walkExprForEscapeHatchStrings(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (n.kind === "escape-hatch") {
    if (typeof n.raw === "string") out.push(n.raw);
    return;
  }
  // Recurse through all child ExprNodes (objects with a kind field) and arrays.
  for (const key of Object.keys(n)) {
    const child = n[key];
    if (child && typeof child === "object" && (child as { kind?: string }).kind) {
      walkExprForEscapeHatchStrings(child, out);
    } else if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && (item as { kind?: string }).kind) {
          walkExprForEscapeHatchStrings(item, out);
        }
      }
    }
  }
}

/**
 * Extract the callee function name from a node's ExprNode field.
 * Returns the name if the ExprNode is a CallExpr with an IdentExpr callee,
 * or if the ExprNode itself is an IdentExpr (propagate-expr case).
 */
function extractCalleeNameFromNode(node: ASTNodeLike): string | null {
  const exprNode = (node as Record<string, unknown>).exprNode as { kind?: string; callee?: { kind?: string; name?: string }; name?: string } | undefined;
  if (!exprNode || typeof exprNode !== "object" || !exprNode.kind) return null;
  // Direct call: exprNode is CallExpr { callee: IdentExpr { name } }
  if (exprNode.kind === "call" && exprNode.callee?.kind === "ident" && exprNode.callee.name) {
    return exprNode.callee.name;
  }
  // propagate-expr where the inner expression is just an identifier (rare but possible)
  if (exprNode.kind === "ident" && exprNode.name) {
    return exprNode.name;
  }
  return null;
}

/**
 * Extract the leading callee function name from a raw expression string via regex.
 * Fallback for nodes without ExprNode fields.
 */
function extractCalleeNameFromString(expr: string | undefined): string | null {
  if (!expr) return null;
  const match = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(expr);
  return match ? match[1] : null;
}

/**
 * TildeTracker — tracks ~ state within a single analysis context.
 */
class TildeTracker {
  _state: TildeState;
  _initSpan: Span | null;

  constructor() {
    this._state = "uninitialized";
    this._initSpan = null;
  }

  initialize(span: Span, elide = false): TildeErrorDescriptor | null {
    if (this._state === "initialized" && !elide) {
      const err: TildeErrorDescriptor = { code: "E-TILDE-002", span: this._initSpan ?? span };
      this._initSpan = span;
      return err;
    }
    this._state = "initialized";
    this._initSpan = span;
    return null;
  }

  consume(span: Span): TildeErrorDescriptor | null {
    if (this._state === "uninitialized") {
      return { code: "E-TILDE-001", span };
    }
    this._state = "uninitialized";
    this._initSpan = null;
    return null;
  }

  isInitialized(): boolean { return this._state === "initialized"; }

  snapshot(): { state: TildeState; initSpan: Span | null } {
    return { state: this._state, initSpan: this._initSpan };
  }

  restore(snap: { state: TildeState; initSpan: Span | null }): void {
    this._state = snap.state;
    this._initSpan = snap.initSpan;
  }
}

// ---------------------------------------------------------------------------
// Loop body scanner — for+lift elision (§31.3)
// ---------------------------------------------------------------------------

/**
 * Return true if a node array contains any tilde-ref node that is NOT inside
 * a lift-stmt. Used to decide whether the for+lift elision rule applies.
 */
function hasNonLiftTildeConsumer(nodes: ASTNodeLike[]): boolean {
  if (!Array.isArray(nodes)) return false;

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    if (node.kind === "tilde-ref") return true;

    if (node.kind === "lift-stmt") continue;

    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = node[key];
      if (Array.isArray(val) && hasNonLiftTildeConsumer(val as ASTNodeLike[])) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// TS-G: checkLinear — main linear/tilde enforcement function
// ---------------------------------------------------------------------------

interface CheckLinearOpts {
  linTracker?: LinTracker | null;
  tildeTracker?: TildeTracker | null;
  mustUseTracker?: MustUseTracker | null;
  inLoop?: boolean;
  file?: string;
  /** §35.2.1: Names of lin-annotated function parameters to pre-declare in this scope. */
  preDeclaredLinNames?: string[];
}

/**
 * Check linear type invariants (lin + ~) for a body of AST nodes.
 */
function checkLinear(body: ASTNodeLike[], errors: TSError[], opts: CheckLinearOpts = {}): void {
  const {
    linTracker: parentLinTracker = null,
    tildeTracker: parentTildeTracker = null,
    mustUseTracker: parentMustUseTracker = null,
    inLoop = false,
    file = "/unknown",
    preDeclaredLinNames = [],
  } = opts;

  const linTracker = new LinTracker();
  // §35.2.1: Pre-seed the tracker with lin-annotated function parameters.
  // These are treated as "declared at function entry" — the consume-exactly-once
  // rule applies to the entire function body scope.
  for (const paramName of preDeclaredLinNames) {
    linTracker.declare(paramName);
  }
  const tildeTracker = parentTildeTracker ?? new TildeTracker();
  const mustUseTracker = new MustUseTracker();

  // Lin-A3: Per-iteration loop-local lin tracker. When non-null,
  // scanNodeExprNodesForLin first tries consuming against this tracker so
  // references to loop-local lin vars inside arbitrary expressions (not just
  // bare lin-ref nodes) are consumed before outer lt is checked.
  let currentLoopLocalLin: LinTracker | null = null;

  // §35.5 E-LIN-006 — deferred-ctx stack for `<request>` / `<poll>` bodies.
  // Incremented on entering a markup-ctx whose runtime scheduling boundary
  // crosses the current synchronous scope. A `lin` consumption whose
  // declaration depth is lower than the consumer depth is E-LIN-006.
  // Closures are NOT counted — they're handled by §35.6 (capture = consume).
  let currentDeferredDepth = 0;
  let currentDeferredCtx: "request" | "poll" | null = null;

  function mkSpan(): Span {
    return { file, start: 0, end: 0, line: 1, col: 1 };
  }

  function trackedLinNamesForTracker(lt: LinTracker): string[] {
    const names = new Set<string>();
    for (const n of lt.names()) names.add(n);
    if (parentLinTracker) for (const n of parentLinTracker.names()) names.add(n);
    if (currentLoopLocalLin) for (const n of currentLoopLocalLin.names()) names.add(n);
    return [...names];
  }

  // Helper shared between walkNode's match-stmt case and scanNodeExprNodesForLin's
  // scanLambdasInExpr — text-scan an expression string for references to any
  // currently-tracked lin variable, calling back with matches.
  function consumeLinRefByTextScan(lt: LinTracker, raw: string, spanObj: unknown, loopFlag: boolean): void {
    const names = trackedLinNamesForTracker(lt);
    for (const name of names) {
      const re = new RegExp(`\\b${escapeForRegex(name)}\\b`);
      if (re.test(raw)) {
        consumeLinRefExternal(lt, name, spanObj, loopFlag);
      }
    }
  }

  // External version of consumeLinRef (mirrors the inner version in
  // scanNodeExprNodesForLin) — usable from other helpers.
  function consumeLinRefExternal(lt: LinTracker, name: string, spanObj: unknown, loop: boolean): void {
    if (name.startsWith("@") || name === "~") return;
    const resolvedSpan = (spanObj ?? { file, start: 0, end: 0, line: 1, col: 1 }) as Span;
    if (currentLoopLocalLin && currentLoopLocalLin.has(name)) {
      const err = currentLoopLocalLin.consume(name, resolvedSpan, currentDeferredDepth, currentDeferredCtx);
      if (err) {
        emitLinError(err, resolvedSpan);
        if (err.code === "E-LIN-006") currentLoopLocalLin.forceConsume(name, resolvedSpan);
      }
      return;
    }
    const tracker = lt.has(name) ? lt : (parentLinTracker && parentLinTracker.has(name) ? parentLinTracker : null);
    if (!tracker) return;
    if (loop) {
      errors.push(new TSError(
        "E-LIN-002",
        `E-LIN-002: Linear variable \`${name}\` consumed inside a loop. ` +
        `Loop iteration count is unprovable; consume \`${name}\` before or after the loop. ` +
        `A 'lin' variable can only be used once. Clone it first, or change to 'const'/'let' if reuse is intended.`,
        resolvedSpan,
      ));
      tracker.forceConsume(name, resolvedSpan);
    } else {
      const err = tracker.consume(name, resolvedSpan, currentDeferredDepth, currentDeferredCtx);
      if (err) {
        emitLinError(err, resolvedSpan);
        if (err.code === "E-LIN-006") tracker.forceConsume(name, resolvedSpan);
      }
    }
  }

  function emitLinError(desc: LinErrorDescriptor, contextSpan?: Span): void {
    const s = desc.span ?? contextSpan ?? mkSpan();
    if (desc.code === "E-LIN-002") {
      // Lin-A1: when the first consumption was via `lift`, surface the lift site.
      const liftNote = desc.liftSite
        ? ` Note: \`lift\` consumed this lin variable at line ${desc.liftSite.line} — ` +
          `\`lift\` counts as a move, so the variable is consumed when lifted.`
        : "";
      errors.push(new TSError(
        "E-LIN-002",
        `E-LIN-002: Linear variable \`${desc.varName}\` consumed more than once. ` +
        `First use at line ${s.line ?? "?"}, col ${s.col ?? "?"}; ` +
        `second use at line ${desc.secondUseSpan?.line ?? "?"}, col ${desc.secondUseSpan?.col ?? "?"}.` +
        liftNote +
        ` A 'lin' variable can only be used once. Clone it first, or change to 'const'/'let' if reuse is intended.`,
        s,
      ));
    } else if (desc.code === "E-LIN-001") {
      errors.push(new TSError(
        "E-LIN-001",
        `E-LIN-001: Linear variable \`${desc.varName}\` declared but never consumed before scope exit. ` +
        `Pass it to a function, return it, or remove the 'lin' qualifier if single-use isn't needed.`,
        s,
      ));
    } else if (desc.code === "E-LIN-003") {
      errors.push(new TSError(
        "E-LIN-003",
        `E-LIN-003: Linear variable \`${desc.varName}\` is consumed in some branches but not others. ` +
        `All branches must consume the same set of lin variables. ` +
        `Every branch of the if/match must either consume or explicitly discard it.`,
        s,
      ));
    } else if (desc.code === "E-LIN-006") {
      const ctxTag = desc.deferredCtx === "poll" ? "<poll>" : "<request>";
      errors.push(new TSError(
        "E-LIN-006",
        `E-LIN-006: Linear variable \`${desc.varName}\` is consumed inside a ${ctxTag} body ` +
        `but was declared outside it. The compiler cannot prove dominance across the ` +
        `${ctxTag} scheduling boundary, so the consumption may happen zero or multiple ` +
        `times. Either declare \`${desc.varName}\` inside the ${ctxTag} body, or pass a ` +
        `consumed (non-lin) value into the body.`,
        s,
      ));
    }
  }

  function emitTildeError(desc: TildeErrorDescriptor, contextSpan?: Span): void {
    const s = desc.span ?? contextSpan ?? mkSpan();
    if (desc.code === "E-TILDE-001") {
      errors.push(new TSError("E-TILDE-001", `E-TILDE-001: The pipeline accumulator \`~\` was read before being initialized. Add \`~ = <value>\` before this line to give it an initial value. See §32 in the spec.`, s));
    } else if (desc.code === "E-TILDE-002") {
      errors.push(new TSError("E-TILDE-002", `E-TILDE-002: The pipeline accumulator \`~\` was set to a value but never used before it was overwritten or the block ended. Use \`lift ~\` or read \`~\` before setting it again. See §32 in the spec.`, s));
    }
  }

  function walkNode(node: ASTNodeLike, lt: LinTracker, tt: TildeTracker, loop: boolean): void {
    if (!node || typeof node !== "object") return;

    switch (node.kind) {

      case "lin-decl": {
        lt.declare(node.name as string, currentDeferredDepth);
        break;
      }

      case "tilde-decl": {
        mustUseTracker.declare(node.name as string, node.span as Span | undefined);
        // Walk initExpr (structured) if available; fall back to string scan.
        const tildeInitExpr = (node as Record<string, unknown>).initExpr as import("./types/ast.ts").ExprNode | undefined;
        if (tildeInitExpr && typeof tildeInitExpr === "object" && tildeInitExpr.kind) {
          forEachIdentInExprNode(tildeInitExpr, (ident) => {
            mustUseTracker.markUsed(ident.name);
            if (parentMustUseTracker) parentMustUseTracker.markUsed(ident.name);
          });
        } else if (node.init) {
          mustUseTracker.scanExpression(node.init as string);
          if (parentMustUseTracker) parentMustUseTracker.scanExpression(node.init as string);
        }
        break;
      }

      case "lin-ref": {
        const name = node.name as string;
        const tracker = lt.has(name) ? lt : (parentLinTracker && parentLinTracker.has(name) ? parentLinTracker : null);
        if (tracker) {
          if (loop) {
            errors.push(new TSError(
              "E-LIN-002",
              `E-LIN-002: Linear variable \`${name}\` consumed inside a loop. ` +
              `Loop iteration count is unprovable; consume \`${name}\` before or after the loop. ` +
              `A 'lin' variable can only be used once. Clone it first, or change to 'const'/'let' if reuse is intended.`,
              (node.span ?? mkSpan()) as Span,
            ));
          } else {
            const refSpan = (node.span ?? mkSpan()) as Span;
            const err = tracker.consume(name, refSpan, currentDeferredDepth, currentDeferredCtx);
            if (err) {
              emitLinError(err, node.span as Span | undefined);
              // Suppress cascading E-LIN-001 after E-LIN-006 — the boundary
              // violation is the primary diagnostic; the unconsumed follow-up
              // would be noise.
              if (err.code === "E-LIN-006") tracker.forceConsume(name, refSpan);
            }
          }
        }
        break;
      }

      case "tilde-init": {
        const err = tt.initialize(node.span as Span);
        if (err) emitTildeError(err, node.span as Span | undefined);
        break;
      }

      case "tilde-ref": {
        const err = tt.consume(node.span as Span);
        if (err) emitTildeError(err, node.span as Span | undefined);
        break;
      }

      case "lift-stmt": {
        if (node.usesTilde) {
          const consumeErr = tt.consume(node.span as Span);
          if (consumeErr) emitTildeError(consumeErr, node.span as Span | undefined);
        }
        const initErr = tt.initialize(node.span as Span, false);
        if (initErr) emitTildeError(initErr, node.span as Span | undefined);
        break;
      }

      case "lift-expr": {
        // Lin-A1: `lift x` counts as consuming the lin variable `x`.
        // AST shape: lift-expr has expr: { kind: "expr", expr: "<identifier>" }.
        // We scan the expression string for a bare lin variable name as the lift target.
        const liftInner = node.expr as { kind?: string; expr?: string; exprNode?: unknown; node?: ASTNodeLike } | undefined;
        if (liftInner && liftInner.kind === "expr") {
          const exprStr = (liftInner.exprNode
            ? emitStringFromTree(liftInner.exprNode as import("./types/ast.ts").ExprNode)
            : (typeof liftInner.expr === "string" ? liftInner.expr : "")).trim();
          const checkLiftConsumption = (tracker: LinTracker): void => {
            for (const linName of tracker.names()) {
              if (tracker.isUnconsumed(linName) && exprStr === linName) {
                const err = tracker.consumeViaLift(linName, (node.span ?? mkSpan()) as Span);
                if (err) emitLinError(err, node.span as Span | undefined);
              }
            }
          };
          checkLiftConsumption(lt);
          if (parentLinTracker) checkLiftConsumption(parentLinTracker);
        }
        // Recurse into embedded markup lift (lift { markup-block }).
        if (liftInner && liftInner.kind === "markup" && liftInner.node) {
          walkNode(liftInner.node as ASTNodeLike, lt, tt, loop);
        }
        break;
      }

      case "if-stmt": {
        const linSnap = lt.snapshot();
        const tildeSnap = tt.snapshot();

        // Walk consequent.
        for (const n of ((node.consequent as ASTNodeLike[] | undefined) ?? [])) walkNode(n, lt, tt, loop);
        const afterConsequent = lt.snapshot();
        const afterConsequentTilde = tt.snapshot();

        // Walk alternate.
        lt.restore(linSnap);
        tt.restore(tildeSnap);
        const hasAlternate = Array.isArray(node.alternate) && (node.alternate as ASTNodeLike[]).length > 0;
        if (hasAlternate) {
          for (const n of (node.alternate as ASTNodeLike[])) walkNode(n, lt, tt, loop);
        }
        const afterAlternate = lt.snapshot();

        // Check and resolve branch symmetry.
        const allVars = new Set([...afterConsequent.keys(), ...afterAlternate.keys()]);
        let allSymmetric = true;

        for (const varName of allVars) {
          const inConsequent = afterConsequent.get(varName) === "consumed";
          const inAlternate = hasAlternate
            ? afterAlternate.get(varName) === "consumed"
            : linSnap.get(varName) === "consumed";

          if (inConsequent !== inAlternate) {
            allSymmetric = false;
            errors.push(new TSError(
              "E-LIN-003",
              `E-LIN-003: Linear variable \`${varName}\` is consumed in some branches but not others. ` +
              `All branches must consume the same set of lin variables. ` +
              `Every branch of the if/match must either consume or explicitly discard it.`,
              (node.span ?? mkSpan()) as Span,
            ));
          }
        }

        if (allSymmetric && allVars.size > 0) {
          for (const varName of allVars) {
            if (afterConsequent.get(varName) === "consumed") {
              lt.forceConsume(varName, node.span as Span | undefined);
            }
          }
        } else {
          // Lin-B3: asymmetric branches already emitted E-LIN-003 above.
          // Force-consume variables that were consumed in EITHER branch so they
          // don't cascade into a spurious E-LIN-001 at scope exit.
          lt.restore(linSnap);
          for (const varName of allVars) {
            const inCons = afterConsequent.get(varName) === "consumed";
            const inAlt = hasAlternate
              ? afterAlternate.get(varName) === "consumed"
              : linSnap.get(varName) === "consumed";
            if (inCons !== inAlt) {
              lt.forceConsume(varName, node.span as Span | undefined);
            }
          }
        }

        tt.restore(afterConsequentTilde);
        break;
      }

      case "match-stmt":
      case "match-expr": {
        // Match-arm branch-parallel linear analysis. The parser stores arms
        // under node.body (not node.arms). Arm forms:
        //   - match-arm-block   — `.Variant => { stmt... }` with structured body
        //   - match-arm-inline  — `.Variant => expr` (structured single-expression arm)
        //   - bare-expr         — `.Variant => expr` (legacy: single-line arm, body raw)
        const armNodes = (node.body as ASTNodeLike[] | undefined) ?? [];
        const realArms = armNodes.filter(a =>
          !!a && typeof a === "object" &&
          (a.kind === "match-arm-block" ||
           a.kind === "match-arm-inline" ||
           (a.kind === "bare-expr" && typeof (a as { expr?: unknown }).expr === "string" &&
            /^\s*(?:\.[A-Z_]|else\b|not\b|"|')/.test((a as { expr: string }).expr)))
        );
        if (realArms.length === 0) {
          for (const n of armNodes) walkNode(n, lt, tt, loop);
          break;
        }

        const preMatchSnap = lt.snapshot();
        const preMatchTilde = tt.snapshot();
        const armSnapshots: Map<string, LinState>[] = [];

        for (const arm of realArms) {
          lt.restore(preMatchSnap);
          tt.restore(preMatchTilde);
          if (arm.kind === "match-arm-block") {
            for (const n of ((arm.body as ASTNodeLike[] | undefined) ?? [])) {
              walkNode(n, lt, tt, loop);
            }
          } else if (arm.kind === "match-arm-inline") {
            // Structured inline arm: result field already holds the expression
            const result = typeof (arm as { result?: unknown }).result === "string"
              ? ((arm as { result: string }).result)
              : "";
            consumeLinRefByTextScan(lt, result, arm.span, loop);
          } else {
            // Single-expression arm (legacy bare-expr): extract RHS of `=>` / `:>` / `->` and
            // text-scan for any declared lin variable name.
            const raw = typeof (arm as { expr?: unknown }).expr === "string"
              ? ((arm as { expr: string }).expr)
              : "";
            const m = raw.match(/(?:=>|:>|->)([\s\S]+)$/);
            const result = m ? m[1] : raw;
            consumeLinRefByTextScan(lt, result, arm.span, loop);
          }
          armSnapshots.push(lt.snapshot());
        }

        if (armSnapshots.length > 0) {
          const refSnap = armSnapshots[0];
          const allVars = new Set(preMatchSnap.keys());

          const asymmetricVars = new Set<string>();
          for (const varName of allVars) {
            const refConsumed = refSnap.get(varName) === "consumed";
            let symmetric = true;
            for (let i = 1; i < armSnapshots.length; i++) {
              if ((armSnapshots[i].get(varName) === "consumed") !== refConsumed) {
                symmetric = false;
                break;
              }
            }
            if (!symmetric) {
              asymmetricVars.add(varName);
              errors.push(new TSError(
                "E-LIN-003",
                `E-LIN-003: Linear variable \`${varName}\` is consumed in some match arms but not others. ` +
                `All arms must consume the same set of lin variables. ` +
                `Every branch of the if/match must either consume or explicitly discard it.`,
                (node.span ?? mkSpan()) as Span,
              ));
            }
          }

          lt.restore(refSnap);
          // Lin-B3: force-consume asymmetric vars to suppress E-LIN-001 cascade.
          for (const varName of asymmetricVars) {
            lt.forceConsume(varName, node.span as Span | undefined);
          }
        }

        tt.restore(preMatchTilde);
        break;
      }

      case "for-loop":
      case "while-loop":
      case "for-stmt":
      case "while-stmt":
      case "do-while-stmt": {
        // Consuming an outer-scope lin variable inside a loop body is E-LIN-002.
        // Lin-A3 permits lin-decl + consume in the same iteration (tracked via
        // walkLoopBody's loopLocalLin). Accept real parser kinds (for-stmt,
        // while-stmt, do-while-stmt) alongside legacy *-loop kinds.
        const loopBody = (node.body as ASTNodeLike[] | undefined) ?? [];
        const elide = !hasNonLiftTildeConsumer(loopBody);
        walkLoopBody(loopBody, lt, tt, elide);
        break;
      }

      case "function-decl": {
        // §35.2.1: Function declarations create a new linear scope.
        // Lin-annotated params (isLin: true on the param object) are pre-declared
        // as linear in the function body scope.
        const fnParams = (node.params as ASTNodeLike[] | undefined) ?? [];
        const linParamNames: string[] = [];
        for (const param of fnParams) {
          if (param && typeof param === "object" && (param as ASTNodeLike).isLin) {
            const pName = (param as ASTNodeLike).name as string | undefined;
            if (pName) linParamNames.push(pName);
          }
        }
        // Recursively check the function body as a new scope.
        // If there are lin params, pass them as preDeclaredLinNames.
        // Always recurse so nested lin-decls inside the function body are checked.
        checkLinear(
          (node.body as ASTNodeLike[] | undefined) ?? [],
          errors,
          {
            file,
            preDeclaredLinNames: linParamNames,
            // Do NOT pass parentLinTracker — function bodies are a closed lin scope.
            // Outer lin vars cannot be consumed inside a function body (they would
            // need to be passed as parameters).
          },
        );
        break;
      }

      case "closure": {
        const captures = (node.captures as string[] | undefined) ?? [];
        for (const captureName of captures) {
          mustUseTracker.markUsed(captureName);
          if (parentMustUseTracker) parentMustUseTracker.markUsed(captureName);

          const tracker = lt.has(captureName) ? lt : (parentLinTracker && parentLinTracker.has(captureName) ? parentLinTracker : null);
          if (tracker) {
            if (loop) {
              errors.push(new TSError(
                "E-LIN-002",
                `E-LIN-002: Linear variable \`${captureName}\` captured by closure inside a loop. ` +
                `Loop iteration count is unprovable. ` +
                `A 'lin' variable can only be used once. Clone it first, or change to 'const'/'let' if reuse is intended.`,
                (node.span ?? mkSpan()) as Span,
              ));
            } else {
              const err = tracker.consume(captureName, (node.span ?? mkSpan()) as Span);
              if (err) emitLinError(err, node.span as Span | undefined);
            }
          }
        }
        // Closure body has its own tilde scope (§31.5).
        checkLinear((node.body as ASTNodeLike[] | undefined) ?? [], errors, { linTracker: lt, mustUseTracker, inLoop: false, file });
        break;
      }

      case "meta": {
        // §22.5.3: A `^{}` meta block captures the lexical scope at breakout.
        // Any lin variable in scope that is referenced in the body — directly
        // (`consume(x)`), via `meta.bindings.x`, inside a template-literal
        // interpolation `${x}`, or elsewhere — is consumed once at capture
        // time. Two meta blocks each referencing the same lin var is a
        // double-consume (E-LIN-002).
        //
        // The normal ExprNode walk in scanNodeExprNodesForLin doesn't catch
        // hidden refs: property names of member chains (meta.bindings.x) are
        // skipped by forEachIdentInExprNode, and template-literal
        // interpolations degrade to escape-hatch raws. Override the default
        // recursion here: (1) scan for every tracked lin name that appears
        // anywhere in the body, (2) consume each unique name ONCE against
        // the outer tracker, (3) do not recurse into the body as if it were
        // regular code — the body is the captured snapshot, not a second
        // use site.
        const metaBody = (node.body as ASTNodeLike[] | undefined) ?? [];
        const trackedNames = trackedLinNamesForTracker(lt);
        if (trackedNames.length > 0 && metaBody.length > 0) {
          const seenNames = new Set<string>();
          const collectStrings: string[] = [];

          function collectFromNode(child: ASTNodeLike): void {
            if (!child || typeof child !== "object") return;
            const c = child as Record<string, unknown>;

            // ExprNode idents.
            const exprNodeFields = [
              c.exprNode, c.initExpr, c.condExpr,
              c.valueExpr, c.iterExpr, c.headerExpr,
            ];
            for (const f of exprNodeFields) {
              if (!f || typeof f !== "object" || !(f as { kind?: string }).kind) continue;
              forEachIdentInExprNode(f as import("./types/ast.ts").ExprNode, (ident) => {
                if (trackedNames.includes(ident.name)) seenNames.add(ident.name);
              });
              // Escape-hatch in the ExprNode (e.g. template literal with
              // interpolations) — walk its raw string for tracked names.
              walkExprForEscapeHatchStrings(f as import("./types/ast.ts").ExprNode, collectStrings);
            }

            // Raw string fields that may contain hidden references.
            for (const key of ["expr", "init", "condition", "value", "test", "content"] as const) {
              const v = c[key];
              if (typeof v === "string") collectStrings.push(v);
            }

            // Recurse — nested structures inside meta can also reference lin vars.
            if (Array.isArray(c.body)) {
              for (const n of c.body as ASTNodeLike[]) collectFromNode(n);
            }
            if (Array.isArray(c.children)) {
              for (const n of c.children as ASTNodeLike[]) collectFromNode(n);
            }
          }

          for (const child of metaBody) collectFromNode(child);

          // Text-scan the collected raw strings for tracked lin names. Uses
          // word-boundary match so `token` matches `meta.bindings.token`,
          // `${token}`, and `consume(token)`, but not `tokens` or `xtoken`.
          for (const raw of collectStrings) {
            for (const name of trackedNames) {
              if (seenNames.has(name)) continue;
              const re = new RegExp(`\\b${escapeForRegex(name)}\\b`);
              if (re.test(raw)) seenNames.add(name);
            }
          }

          for (const name of seenNames) {
            consumeLinRefExternal(lt, name, node.span, loop);
          }
        }

        // Do NOT recurse via the default path — the body has already been
        // scanned for outer lin consumption above, and the body itself is
        // the captured snapshot, not a regular statement list.
        break;
      }

      // §35.5 E-LIN-006 — `<request>` and `<poll>` markup bodies form a
      // deferred-execution boundary. A lin declared outside the body cannot
      // be consumed inside it. Increment the deferred-ctx depth around the
      // children walk, then restore. AST shape: markup nodes carry their
      // element name on `tag` (or `name`); children holds nested logic/markup.
      case "markup": {
        const markupAny = node as ASTNodeLike & { tag?: string };
        const markupName = (markupAny.tag as string | undefined) ?? (node.name as string | undefined);
        const isDeferred = markupName === "request" || markupName === "poll";
        const prevDepth = currentDeferredDepth;
        const prevCtx = currentDeferredCtx;
        if (isDeferred) {
          currentDeferredDepth = prevDepth + 1;
          currentDeferredCtx = markupName as "request" | "poll";
        }
        const mupBody = node.body as ASTNodeLike[] | undefined;
        if (Array.isArray(mupBody)) {
          for (const n of mupBody) walkNode(n, lt, tt, loop);
        }
        const mupChildren = node.children as ASTNodeLike[] | undefined;
        if (Array.isArray(mupChildren)) {
          for (const n of mupChildren) walkNode(n, lt, tt, loop);
        }
        if (isDeferred) {
          currentDeferredDepth = prevDepth;
          currentDeferredCtx = prevCtx;
        }
        break;
      }

      default: {
        const body = node.body as ASTNodeLike[] | undefined;
        if (Array.isArray(body)) {
          for (const n of body) walkNode(n, lt, tt, loop);
        }
        const children = node.children as ASTNodeLike[] | undefined;
        if (Array.isArray(children)) {
          for (const n of children) walkNode(n, lt, tt, loop);
        }
        break;
      }
    }

    // Scan expression-bearing fields for must-use variable references.
    scanNodeExpressions(node);
    scanNodeExprNodesForLin(node, lt, loop);
  }

  function scanNodeExpressions(node: ASTNodeLike): void {
    const nodeAny = node as Record<string, unknown>;

    // Walk ExprNode-form fields for must-use variable references.
    const exprNodeFields: unknown[] = [
      nodeAny.exprNode,    // bare-expr, return-stmt, throw-stmt
      nodeAny.initExpr,    // let-decl, const-decl, lin-decl, tilde-decl, state-decl, etc.
      nodeAny.condExpr,    // if-stmt, if-expr, while-loop, for-loop (condition)
      nodeAny.valueExpr,   // reactive-nested-assign
      nodeAny.iterExpr,    // for-stmt (iterable expression)
      nodeAny.headerExpr,  // match-stmt, switch-stmt (header expression)
    ];

    for (const field of exprNodeFields) {
      if (!field || typeof field !== "object") continue;
      const exprField = field as { kind?: string };
      if (!exprField.kind) continue;

      forEachIdentInExprNode(field as import("./types/ast.ts").ExprNode, (ident) => {
        mustUseTracker.markUsed(ident.name);
        if (parentMustUseTracker) parentMustUseTracker.markUsed(ident.name);
      });
    }

    // String-field fallback: nodes without ExprNode fields still need scanning.
    // Phase 4d: skip string fields when corresponding ExprNode is present (avoid double-counting).
    // node.content: html-fragment nodes carry HTML that may reference tilde-decl names.
    const stringFields: (string | unknown)[] = [
      !nodeAny.exprNode ? node.expr : undefined,
      !nodeAny.initExpr ? node.init : undefined,
      node.value,
      !nodeAny.condExpr ? node.condition : undefined,
      node.test,
      node.content,
    ];
    for (const field of stringFields) {
      if (typeof field === "string") {
        mustUseTracker.scanExpression(field);
        if (parentMustUseTracker) parentMustUseTracker.scanExpression(field);
      }
    }
  }
  /**
   * Scan ExprNode-form expression fields on an AST node for lin variable references.
   *
   * This is the structured counterpart to scanNodeExpressions (which scans string fields
   * for the mustUseTracker). Both functions run for every node in walkNode.
   *
   * For each ExprNode field found on the node (initExpr, exprNode, condExpr, valueExpr,
   * iterExpr, headerExpr), walk the ExprNode tree with forEachIdentInExprNode to find
   * all IdentExpr leaves. For each IdentExpr whose name matches a declared lin variable
   * in `lt` or `parentLinTracker`, call lt.consume().
   *
   * Called from walkNode() after the main switch dispatch completes.
   */
  function scanNodeExprNodesForLin(node: ASTNodeLike, lt: LinTracker, loop: boolean): void {
    // Collect all ExprNode-bearing fields. These are the Phase 1 parallel fields.
    // The ExprNode fields are typed as `ExprNode | undefined` on typed nodes,
    // but we receive ASTNodeLike (duck-typed). Cast via `any` for field access.
    const nodeAny = node as Record<string, unknown>;

    // Helper: consume a lin variable reference if it matches a tracked lin var.
    function consumeLinRef(name: string, spanObj: unknown): void {
      // Reactive variable references start with '@' — not lin variables.
      // Tilde accumulator is '~' — not a lin variable.
      if (name.startsWith("@") || name === "~") return;

      const resolvedSpan = (spanObj ?? mkSpan()) as Span;

      // Lin-A3: Loop-local lin variables consume against the per-iteration
      // tracker, NOT outer lt. Prevents false-positive E-LIN-002 on e.g.
      // `submitOne(token)` where token was declared via `lin token = …` in
      // the same loop body.
      if (currentLoopLocalLin && currentLoopLocalLin.has(name)) {
        const err = currentLoopLocalLin.consume(name, resolvedSpan, currentDeferredDepth, currentDeferredCtx);
        if (err) {
          emitLinError(err, resolvedSpan);
          if (err.code === "E-LIN-006") currentLoopLocalLin.forceConsume(name, resolvedSpan);
        }
        return;
      }

      // Check if this identifier is a declared lin variable.
      const tracker = lt.has(name) ? lt : (parentLinTracker && parentLinTracker.has(name) ? parentLinTracker : null);
      if (!tracker) return;

      if (loop) {
        errors.push(new TSError(
          "E-LIN-002",
          `E-LIN-002: Linear variable \`${name}\` consumed inside a loop. ` +
          `Loop iteration count is unprovable; consume \`${name}\` before or after the loop. ` +
          `A 'lin' variable can only be used once. Clone it first, or change to 'const'/'let' if reuse is intended.`,
          resolvedSpan,
        ));
        // Force-consume so scope-exit doesn't cascade a spurious E-LIN-001.
        tracker.forceConsume(name, resolvedSpan);
      } else {
        const err = tracker.consume(name, resolvedSpan, currentDeferredDepth, currentDeferredCtx);
        if (err) {
          emitLinError(err, resolvedSpan);
          if (err.code === "E-LIN-006") tracker.forceConsume(name, resolvedSpan);
        }
      }
    }

    // Lin-B1: A lambda that captures a lin variable counts as ONE consumption
    // (scope-agnostic: existence of the reference IS the consumption). Two
    // lambdas referencing the same lin var → E-LIN-002. forEachIdentInExprNode
    // deliberately stops at lambda bodies; we must scan them here.
    function trackedLinNamesWith(lt: LinTracker): string[] {
      const names = new Set<string>();
      for (const n of lt.names()) names.add(n);
      if (parentLinTracker) for (const n of parentLinTracker.names()) names.add(n);
      if (currentLoopLocalLin) for (const n of currentLoopLocalLin.names()) names.add(n);
      return [...names];
    }
    const trackedLinNames = () => trackedLinNamesWith(lt);

    function scanLambdasInExpr(field: unknown): void {
      if (!field || typeof field !== "object") return;
      const f = field as { kind?: string; [k: string]: unknown };
      if (!f.kind) return;

      if (f.kind === "lambda") {
        const body = f.body as { kind?: string; value?: unknown; raw?: string } | undefined;
        if (!body) return;

        const referenced = new Set<string>();
        const linNames = trackedLinNames();
        if (linNames.length === 0) return;

        if (body.kind === "expr" && body.value) {
          forEachIdentInExprNode(body.value as import("./types/ast.ts").ExprNode, (ident) => {
            if (linNames.includes(ident.name)) referenced.add(ident.name);
          });
          scanLambdasInExpr(body.value);
        } else {
          const rawSource = typeof body.raw === "string"
            ? body.raw
            : (typeof (f.raw as unknown) === "string" ? (f.raw as string) : "");
          if (rawSource) {
            for (const n of linNames) {
              const re = new RegExp(`\\b${escapeForRegex(n)}\\b`);
              if (re.test(rawSource)) referenced.add(n);
            }
          }
        }

        for (const name of referenced) {
          consumeLinRef(name, f.span);
        }
        return;
      }

      if (f.kind === "escape-hatch") {
        const raw = typeof f.raw === "string" ? (f.raw as string) : "";
        if (raw && raw.includes("=>")) {
          const linNames = trackedLinNames();
          for (const name of linNames) {
            const re = new RegExp(`\\b${escapeForRegex(name)}\\b`);
            if (re.test(raw)) consumeLinRef(name, f.span);
          }
        }
        return;
      }

      if (f.kind === "match-expr") {
        // Expression-form match (e.g. `return match role { ... }`): the ExprNode
        // stores arms as rawArms: string[]. Apply branch-parallel lin analysis.
        const rawArms = Array.isArray(f.rawArms) ? (f.rawArms as string[]) : [];
        // Walk the subject first (normal identifiers/captures).
        if (f.subject) scanLambdasInExpr(f.subject);

        if (rawArms.length === 0) return;
        const linNames = trackedLinNames();
        if (linNames.length === 0) return;

        const preSnap = lt.snapshot();
        const armSnaps: Map<string, LinState>[] = [];
        for (const armRaw of rawArms) {
          lt.restore(preSnap);
          const m = armRaw.match(/(?:=>|:>|->)([\s\S]+)$/);
          const result = m ? m[1] : armRaw;
          for (const name of linNames) {
            const re = new RegExp(`\\b${escapeForRegex(name)}\\b`);
            if (re.test(result)) {
              consumeLinRef(name, f.span);
            }
          }
          armSnaps.push(lt.snapshot());
        }

        const refSnap = armSnaps[0];
        const asymmetricVars = new Set<string>();
        for (const varName of new Set(preSnap.keys())) {
          const refConsumed = refSnap.get(varName) === "consumed";
          let symmetric = true;
          for (let i = 1; i < armSnaps.length; i++) {
            if ((armSnaps[i].get(varName) === "consumed") !== refConsumed) {
              symmetric = false;
              break;
            }
          }
          if (!symmetric) {
            asymmetricVars.add(varName);
            errors.push(new TSError(
              "E-LIN-003",
              `E-LIN-003: Linear variable \`${varName}\` is consumed in some match arms but not others. ` +
              `All arms must consume the same set of lin variables. ` +
              `Every branch of the if/match must either consume or explicitly discard it.`,
              (f.span as Span | undefined) ?? mkSpan(),
            ));
          }
        }
        lt.restore(refSnap);
        for (const varName of asymmetricVars) {
          lt.forceConsume(varName, f.span as Span | undefined);
        }
        return;
      }

      for (const k of Object.keys(f)) {
        const v = (f as Record<string, unknown>)[k];
        if (Array.isArray(v)) {
          for (const el of v) scanLambdasInExpr(el);
        } else if (v && typeof v === "object") {
          scanLambdasInExpr(v);
        }
      }
    }

    // Walk ExprNode-form fields (structured, with precise spans).
    // All ExprNode parallel fields defined in the Phase 1 convention (ast.ts §4.4).
    const exprNodeFields: unknown[] = [
      nodeAny.exprNode,    // bare-expr, return-stmt, throw-stmt
      nodeAny.initExpr,    // let-decl, const-decl, lin-decl, tilde-decl, state-decl, etc.
      nodeAny.condExpr,    // if-stmt, if-expr, while-loop, for-loop (condition)
      nodeAny.valueExpr,   // reactive-nested-assign
      nodeAny.iterExpr,    // for-stmt (iterable expression)
      nodeAny.headerExpr,  // match-stmt, switch-stmt (header expression)
    ];

    for (const field of exprNodeFields) {
      if (!field || typeof field !== "object") continue;
      const exprField = field as { kind?: string };
      if (!exprField.kind) continue;

      // Walk the ExprNode tree for IdentExpr nodes.
      // eslint-disable-next-line no-loop-func
      forEachIdentInExprNode(field as import("./types/ast.ts").ExprNode, (ident) => {
        consumeLinRef(ident.name, ident.span);
      });

      // Lin-B1: scan lambdas/closures inside this ExprNode for lin captures.
      scanLambdasInExpr(field);
    }
  }

  function walkLoopBody(loopBody: ASTNodeLike[], lt: LinTracker, tt: TildeTracker, elide: boolean): void {
    if (!Array.isArray(loopBody)) return;

    // Lin-A3: Lin variables declared AND consumed within the same loop iteration
    // are permitted. Track them in a per-iteration local tracker (loopLocalLin).
    // Variables from outer scope (in lt) are still rejected with E-LIN-002.
    const loopLocalLin = new LinTracker();

    // Expose to scanNodeExprNodesForLin so loop-local consumption inside
    // arbitrary expressions is routed to loopLocalLin instead of falsely
    // emitting E-LIN-002 against the outer lt.
    const prevLoopLocal = currentLoopLocalLin;
    currentLoopLocalLin = loopLocalLin;

    for (const node of loopBody) {
      if (!node || typeof node !== "object") continue;

      if (node.kind === "lift-stmt" && elide) {
        if (node.usesTilde) {
          const consumeErr = tt.consume(node.span as Span);
          if (consumeErr) emitTildeError(consumeErr, node.span as Span | undefined);
        }
        tt.initialize(node.span as Span, /* elide= */ true);
        continue;
      }

      // Lin-A3 carve-out: lin-decl at top level of the loop body is registered
      // in loopLocalLin, not the outer tracker.
      if (node.kind === "lin-decl") {
        // Scan the initExpr for consumption of outer-scope lin variables BEFORE declaring.
        // Example: `lin y = computeWith(x)` in a loop where x is outer lin → E-LIN-002 for x.
        scanNodeExprNodesForLin(node, lt, /* loop= */ true);
        loopLocalLin.declare(node.name as string);
        continue;
      }

      // Lin-A3: lin-ref for a loop-local variable resolves against loopLocalLin.
      if (node.kind === "lin-ref") {
        const name = node.name as string;
        if (loopLocalLin.has(name)) {
          const err = loopLocalLin.consume(name, (node.span ?? mkSpan()) as Span);
          if (err) emitLinError(err, node.span as Span | undefined);
          continue;
        }
        // Falls through to walkNode for outer-scope lin rejection (E-LIN-002).
      }

      walkNode(node, lt, tt, /* inLoop= */ true);
    }

    // Restore loop-local tracker pointer before checking for unconsumed locals.
    currentLoopLocalLin = prevLoopLocal;

    // Lin-A3: Unconsumed loop-local lin vars → E-LIN-001.
    for (const varName of loopLocalLin.unconsumedNames()) {
      errors.push(new TSError(
        "E-LIN-001",
        `E-LIN-001: Linear variable \`${varName}\` declared inside a loop body but not consumed within the same iteration. ` +
        `A 'lin' variable declared inside a loop must be consumed before the iteration ends. ` +
        `Pass it to a function, return it, or remove the 'lin' qualifier if single-use isn't needed.`,
        mkSpan(),
      ));
    }
  }

  // Main body walk.
  if (!Array.isArray(body)) return;

  for (const node of body) {
    walkNode(node, linTracker, tildeTracker, inLoop);
  }

  // Scope exit: check for unconsumed lin variables (E-LIN-001).
  for (const varName of linTracker.unconsumedNames()) {
    errors.push(new TSError(
      "E-LIN-001",
      `E-LIN-001: Linear variable \`${varName}\` declared but never consumed before scope exit. ` +
      `Pass it to a function, return it, or remove the 'lin' qualifier if single-use isn't needed.`,
      mkSpan(),
    ));
  }

  // Scope exit: check for unused must-use variables (E-MU-001).
  for (const { name, span: declSpan } of mustUseTracker.unusedEntries()) {
    errors.push(new TSError(
      "E-MU-001",
      `E-MU-001: Variable \`${name}\` was declared but never used before this scope closes. ` +
      `Either use the value somewhere (e.g., pass it to a function or reference it in a template), ` +
      `or prefix with \`_\` (e.g., \`_${name}\`) to suppress this warning, or remove the declaration.`,
      declSpan ?? mkSpan(),
    ));
  }

  // ~ initialized but not consumed at scope exit → E-TILDE-002.
  const lastNode = Array.isArray(body) ? body[body.length - 1] : null;
  const lastWasElisionLoop = lastNode &&
    (lastNode.kind === "for-loop" || lastNode.kind === "while-loop") &&
    !hasNonLiftTildeConsumer((lastNode.body as ASTNodeLike[] | undefined) ?? []);
  if (tildeTracker.isInitialized() && !parentTildeTracker && !lastWasElisionLoop) {
    errors.push(new TSError(
      "E-TILDE-002",
      `E-TILDE-002: The accumulator \`~\` was set to a value but never used before the block ended. Use \`lift ~\` or read \`~\` before the scope closes.`,
      tildeTracker._initSpan ?? mkSpan(),
    ));
  }
}

// ---------------------------------------------------------------------------
// TS-H: Loop control flow validation (E-LOOP-001/002/005)
// ---------------------------------------------------------------------------

/**
 * Check loop control flow invariants for a file's AST nodes.
 *
 * E-LOOP-001: break outside any loop
 * E-LOOP-002: continue outside any loop
 * E-LOOP-005: break/continue inside fn/function/arrow targeting a loop outside
 */
/**
 * §6.7.9 animationFrame() diagnostics.
 *
 * - E-LIFECYCLE-015: called with zero args, or with a non-function-typed arg
 *   (literal, call-expr, etc.).
 * - E-LIFECYCLE-017: called outside any element scope.
 *
 * An "element scope" here is the logic body of a markup tag (§6.7.2). In the
 * AST this is any logic/block/bare-expr that appears inside a `markup` node's
 * children, transitively — top-level logic blocks are NOT element scopes.
 */
function checkAnimationFrame(nodes: ASTNodeLike[], errors: TSError[], filePath: string): void {
  const mkSpan = (node: ASTNodeLike): Span =>
    (node.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  const isAnimationFrameCall = (node: ASTNodeLike): { callExpr?: ASTNodeLike; argSource: string } | null => {
    // ExprNode path — node.exprNode of kind "call" with callee ident "animationFrame"
    const exprNode = (node as Record<string, unknown>).exprNode as ASTNodeLike | undefined;
    if (exprNode && (exprNode as any).kind === "call") {
      const callee = (exprNode as any).callee;
      if (callee && callee.kind === "ident" && callee.name === "animationFrame") {
        return { callExpr: exprNode, argSource: exprNode ? emitStringFromTree(exprNode as unknown as import("./types/ast.ts").ExprNode) : ((node.expr as string | undefined) ?? "") };
      }
    }
    // String path
    const expr = (node as any).exprNode
      ? emitStringFromTree((node as any).exprNode as import("./types/ast.ts").ExprNode)
      : ((node.expr as string | undefined) ?? "");
    const m = expr.match(/^\s*animationFrame\s*\(/);
    if (m) return { argSource: expr };
    return null;
  };

  const argIsNonFunction = (hit: { callExpr?: ASTNodeLike; argSource: string }): "zero" | "nonfn" | "ok" => {
    // ExprNode-first: inspect callExpr.args[0]
    const ce = hit.callExpr as any;
    if (ce && Array.isArray(ce.args)) {
      if (ce.args.length === 0) return "zero";
      const a0 = ce.args[0];
      if (!a0) return "zero";
      // Literals, call-exprs, member access of primitives — all non-function.
      if (a0.kind === "lit") return "nonfn";
      // ident / member / call — could be a function; accept conservatively.
      return "ok";
    }
    // Fallback on source string
    const src = hit.argSource;
    const inner = src.replace(/^\s*animationFrame\s*\(/, "").replace(/\)\s*$/, "").trim();
    if (inner === "") return "zero";
    // Numeric / string literal → nonfn
    if (/^-?\d/.test(inner) || /^['"]/.test(inner)) return "nonfn";
    return "ok";
  };

  const walk = (body: ASTNodeLike[] | undefined, inElementScope: boolean): void => {
    if (!Array.isArray(body)) return;
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      const k = node.kind;
      if (k === "markup") {
        // Children of a markup tag ARE an element scope.
        const children = node.children as ASTNodeLike[] | undefined;
        walk(children, true);
        continue;
      }
      if (k === "bare-expr") {
        const hit = isAnimationFrameCall(node);
        if (hit) {
          const badArg = argIsNonFunction(hit);
          if (badArg === "zero" || badArg === "nonfn") {
            errors.push(new TSError(
              "E-LIFECYCLE-015",
              `E-LIFECYCLE-015: \`animationFrame()\` requires exactly one function argument (§6.7.9). ` +
              (badArg === "zero"
                ? "Called with zero arguments. Pass the callback function: `animationFrame(draw)`."
                : "Called with a non-function argument. Pass a function reference, not a literal: `animationFrame(draw)`."),
              mkSpan(node),
            ));
          } else if (!inElementScope) {
            errors.push(new TSError(
              "E-LIFECYCLE-017",
              `E-LIFECYCLE-017: \`animationFrame()\` is only valid inside an element scope (§6.7.9). ` +
              `Move the call into the logic body of a markup tag so the compiler can cancel pending callbacks ` +
              `when the element unmounts.`,
              mkSpan(node),
            ));
          }
        }
      }
      // Recurse into child containers, preserving inElementScope.
      for (const key of ["body", "children", "consequent", "alternate", "thenBody", "elseBody", "cases"]) {
        const v = (node as Record<string, unknown>)[key];
        if (Array.isArray(v)) walk(v as ASTNodeLike[], inElementScope);
      }
    }
  };

  walk(nodes, false);
}

function checkLoopControl(nodes: ASTNodeLike[], errors: TSError[], filePath: string): void {
  const LOOP_KINDS = new Set(["for-stmt", "while-stmt", "do-while-stmt", "for-loop", "while-loop"]);
  const FN_KINDS = new Set(["function-decl", "fn-decl", "fn", "function", "closure"]);

  function mkSpan(node: ASTNodeLike): Span {
    return (node.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  }

  // E-LOOP-006: duplicate label identifiers across sibling loops in a body (§49.2.2).
  function checkDuplicateLabels(body: ASTNodeLike[]): void {
    const seen = new Map<string, ASTNodeLike>();
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      const label = (node as { label?: unknown }).label;
      if (typeof label === "string" && label.length > 0 && LOOP_KINDS.has(node.kind as string)) {
        if (seen.has(label)) {
          errors.push(new TSError(
            "E-LOOP-006",
            `E-LOOP-006: Label \`${label}:\` is defined more than once in the same scope (§49.2.2). ` +
            "Each loop label must be unique within its enclosing block. Rename one of the labels.",
            mkSpan(node),
          ));
        } else {
          seen.set(label, node);
        }
      }
      // Recurse into bodies for nested label checking.
      const inner = (node as { body?: ASTNodeLike[] }).body;
      if (Array.isArray(inner)) checkDuplicateLabels(inner);
    }
  }
  checkDuplicateLabels(nodes);

  // E-LOOP-005 (string-scan): a let-decl init that contains an arrow-body with
  // `break`/`continue` inside a loop. The arrow body parses as an escape-hatch
  // ParseError, so we detect this structurally via the init source string.
  function checkArrowBreakInLoop(body: ASTNodeLike[], inLoop: boolean): void {
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      const kind = node.kind as string;
      if (inLoop && (kind === "let-decl" || kind === "const-decl")) {
        const init = (node as { init?: string }).init;
        if (typeof init === "string" && /=>\s*\{[^}]*\b(break|continue)\b/.test(init)) {
          const kw = /\bbreak\b/.test(init) ? "break" : "continue";
          errors.push(new TSError(
            "E-LOOP-005",
            `E-LOOP-005: \`${kw}\` inside an arrow function cannot target an outer loop (§49.4.3). ` +
            "Arrow functions are function boundaries; `break`/`continue` may only target loops declared in the same function scope. " +
            "Move the control-flow out of the arrow body, or refactor the arrow into an inline loop.",
            mkSpan(node),
          ));
        }
      }
      const inner = (node as { body?: ASTNodeLike[] }).body;
      if (Array.isArray(inner)) {
        const nowInLoop = inLoop || LOOP_KINDS.has(kind);
        const nowFnBoundary = FN_KINDS.has(kind);
        checkArrowBreakInLoop(inner, nowFnBoundary ? false : nowInLoop);
      }
      for (const key of ["consequent", "alternate", "thenBody", "elseBody", "children"]) {
        const v = (node as Record<string, unknown>)[key];
        if (Array.isArray(v)) checkArrowBreakInLoop(v as ASTNodeLike[], inLoop);
      }
    }
  }
  checkArrowBreakInLoop(nodes, false);

  // E-LOOP-003: labeled break/continue that references an unknown label.
  // DISABLED: braceless if-bodies cause the ast-builder to absorb the next
  // token as a label (e.g. `if (x == 2) continue\nsum = sum + x` becomes
  // continue-stmt{label:"sum"}). Re-enable when braceless-if parsing is fixed.
  // The fixture `phase2-while-break-missing-label-066` will revert to
  // OUTCOME_MISMATCH; accepted trade-off vs false-positive on valid code.

  // E-LOOP-007: while used as an expression (e.g. `let x = while (…) {…}`).
  // When the parser couldn't parse the init, it stores an escape-hatch ParseError
  // whose `raw` starts with `while `.
  function checkWhileAsExpr(body: ASTNodeLike[]): void {
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "let-decl" || node.kind === "const-decl" || node.kind === "tilde-decl") {
        const initExpr = (node as { initExpr?: { kind?: string; raw?: string } }).initExpr;
        const raw = initExpr?.raw ?? ((node as { init?: string }).init ?? "");
        const declName = (node as { name?: string }).name;
        // Only fire when the body uses `lift` — the only reason a user would
        // write `let x = while(...) { ... }` is to extract a value via lift.
        // The ast-builder sometimes absorbs an unrelated while-stmt into a
        // preceding let-decl's init; that misparse doesn't use lift.
        const rawStr = String(raw).trim();
        const looksLikeWhileAsExpr = /^while\s*\([\s\S]*?\)\s*\{[\s\S]*?\blift\b[\s\S]*\}\s*$/.test(rawStr);
        if (declName && initExpr?.kind === "escape-hatch" && looksLikeWhileAsExpr) {
          errors.push(new TSError(
            "E-LOOP-007",
            `E-LOOP-007: \`while\` is a statement, not an expression (§49.4.4). ` +
            "Use the `~` accumulator pattern to collect a value across iterations, " +
            "or refactor to a `for/lift` expression.",
            mkSpan(node),
          ));
        }
      }
      const inner = (node as { body?: ASTNodeLike[] }).body;
      if (Array.isArray(inner)) checkWhileAsExpr(inner);
      for (const key of ["consequent", "alternate", "thenBody", "elseBody", "children"]) {
        const v = (node as Record<string, unknown>)[key];
        if (Array.isArray(v)) checkWhileAsExpr(v as ASTNodeLike[]);
      }
    }
  }
  checkWhileAsExpr(nodes);

  // E-SYNTAX-002 / §49.6.2: `lift` inside a named function body (even via a loop)
  // is not valid. `lift` must be in logic/component context, not inside a standard
  // function declaration. Scan the bodies of named function-decls for lift-expr.
  function checkLiftInFn(body: ASTNodeLike[], insideNamedFn: boolean): void {
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      const kind = node.kind as string;
      if (insideNamedFn && kind === "lift-expr") {
        errors.push(new TSError(
          "E-SYNTAX-002",
          "E-SYNTAX-002: `lift` is not valid inside a standard `function` body (§49.6.2). " +
          "`lift` may only appear in logic blocks or component bodies. " +
          "Return the value with `return` and have the caller lift it, or refactor the function into a component.",
          mkSpan(node),
        ));
      }
      // §10.4 targets plain `function name() {...}` only. `server function`
      // allows lift-as-return; `fn` shorthand is covered by E-FN-008 (§48).
      const isServer = (node as { isServer?: boolean }).isServer === true;
      const fnKind = (node as { fnKind?: string }).fnKind;
      const enterFn = kind === "function-decl" && (node as { name?: string }).name && !isServer && fnKind !== "fn";
      const innerNamed = enterFn ? true : insideNamedFn;
      const inner = (node as { body?: ASTNodeLike[] }).body;
      if (Array.isArray(inner)) checkLiftInFn(inner, innerNamed);
      for (const key of ["consequent", "alternate", "thenBody", "elseBody", "children"]) {
        const v = (node as Record<string, unknown>)[key];
        if (Array.isArray(v)) checkLiftInFn(v as ASTNodeLike[], insideNamedFn);
      }
    }
  }
  checkLiftInFn(nodes, false);

  // W-ASSIGN-001: single-paren assignment in while/if condition (§50.2.3).
  // Trigger when the condition is `( x = ... )` — exactly one level of parens
  // around a top-level assignment. Double parens `(( x = ... ))` suppress.
  function checkSingleParenAssign(body: ASTNodeLike[]): void {
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      const kind = node.kind as string;
      if (kind === "while-stmt" || kind === "if-stmt" || kind === "do-while-stmt") {
        const cond = ((node as { condition?: string }).condition ?? "").trim();
        // Strip one layer of parens and inspect.
        const m = cond.match(/^\(\s*([\s\S]*?)\s*\)$/);
        if (m) {
          const inner = m[1].trim();
          // Already double-paren? Then the inner still starts with `(`.
          if (!inner.startsWith("(") && /^[A-Za-z_$][\w$]*\s*=\s*[^=]/.test(inner)) {
            errors.push(new TSError(
              "W-ASSIGN-001",
              "W-ASSIGN-001: Assignment used as a condition (§50.2.3). " +
              "If this is intentional, wrap in double parens to suppress: `((x = next()))`. " +
              "If you meant equality, use `==` or `is`.",
              mkSpan(node),
            ));
          }
        }
      }
      const inner = (node as { body?: ASTNodeLike[] }).body;
      if (Array.isArray(inner)) checkSingleParenAssign(inner);
      for (const key of ["consequent", "alternate", "thenBody", "elseBody", "children"]) {
        const v = (node as Record<string, unknown>)[key];
        if (Array.isArray(v)) checkSingleParenAssign(v as ASTNodeLike[]);
      }
    }
  }
  checkSingleParenAssign(nodes);

  /**
   * Walk a body of nodes.
   * loopDepth: number of enclosing loops (at current function scope boundary)
   * insideFn: true if we have crossed a function boundary since the last outer loop
   * outerLoopDepth: loop depth at the time we crossed the most recent function boundary
   */
  function walk(body: ASTNodeLike[], loopDepth: number, insideFn: boolean): void {
    for (const node of body) {
      if (!node || typeof node !== "object") continue;
      walkNode(node, loopDepth, insideFn);
    }
  }

  function walkNode(node: ASTNodeLike, loopDepth: number, insideFn: boolean): void {
    if (!node || typeof node !== "object") return;
    const kind = node.kind as string;

    // break-stmt: must be inside a loop at the current function boundary
    if (kind === "break-stmt") {
      if (loopDepth === 0) {
        const s = mkSpan(node);
        errors.push(new TSError(
          "E-LOOP-001",
          `E-LOOP-001: \`break\` at line ${s.line} is not inside any loop. ` +
          "`break` may only appear inside a `while`, `do...while`, or `for...of` loop body. " +
          "Remove `break` or move it inside a loop.",
          s,
        ));
      }
      return;
    }

    // continue-stmt: must be inside a loop at the current function boundary
    if (kind === "continue-stmt") {
      if (loopDepth === 0) {
        const s = mkSpan(node);
        errors.push(new TSError(
          "E-LOOP-002",
          `E-LOOP-002: \`continue\` at line ${s.line} is not inside any loop. ` +
          "`continue` may only appear inside a `while`, `do...while`, or `for...of` loop body. " +
          "Remove `continue` or move it inside a loop.",
          s,
        ));
      }
      return;
    }

    // Loop constructs: increment loop depth when walking body
    if (LOOP_KINDS.has(kind)) {
      const loopBody = (node.body as ASTNodeLike[] | undefined) ?? [];
      walk(loopBody, loopDepth + 1, insideFn);
      return;
    }

    // Function boundary: reset loop depth to 0 for the inner scope
    // Any break/continue inside this function cannot target outer loops
    if (FN_KINDS.has(kind)) {
      const fnBody = (node.body as ASTNodeLike[] | undefined) ?? [];
      // Walk the fn body with loopDepth=0 (function boundary resets loop context)
      walk(fnBody, 0, false);
      return;
    }

    // For all other nodes, recurse into body/consequent/alternate/children
    const nodeBody = node.body as ASTNodeLike[] | undefined;
    if (Array.isArray(nodeBody)) walk(nodeBody, loopDepth, insideFn);

    const consequent = node.consequent as ASTNodeLike[] | undefined;
    if (Array.isArray(consequent)) walk(consequent, loopDepth, insideFn);

    const alternate = node.alternate as ASTNodeLike[] | undefined;
    if (Array.isArray(alternate)) walk(alternate, loopDepth, insideFn);

    const arms = node.arms as ASTNodeLike[] | undefined;
    if (Array.isArray(arms)) {
      for (const arm of arms) {
        const armBody = (arm as ASTNodeLike).body as ASTNodeLike[] | undefined;
        if (Array.isArray(armBody)) walk(armBody, loopDepth, insideFn);
      }
    }

    const children = node.children as ASTNodeLike[] | undefined;
    if (Array.isArray(children)) walk(children, loopDepth, insideFn);
  }

  walk(nodes, 0, false);
}

// ---------------------------------------------------------------------------
// §53.14.5 — L22 family resolve-and-check helper (OQ-TF-13, S106).
//
// Shared sub-case-3 (unknown type) + sub-case-4 (wrong kind) handler for the
// type-as-argument family (parseVariant §41.13, formFor §41.14, schemaFor
// §41.15, tableFor §41.16). Each family member's caller still drives sub-
// case-1 (missing arg) + sub-case-2 (wrong-shape arg) since those vary by
// surface form (markup-attr vs call-arg).
//
// Triggered by S104 third-caller threshold (`docs/changes/serialize-scoping/
// SCOPING.md` + master-list S104 close addendum); tableFor S105 was the
// fourth caller; extraction landed S106 per OQ-TF-13 follow-up.
//
// Future family members (variantNames, reflective) inherit this shape: caller
// extracts the bare type name, drives sub-case-1/2 surface-specific
// validation, then delegates to this helper for the resolve + kind check.
// ---------------------------------------------------------------------------
function _resolveAndCheckL22TypeName(
  typeName: string,
  expectedKind: "struct" | "enum",
  typeRegistry: Map<string, ResolvedType>,
  errors: TSError[],
  ctx: {
    code: string,
    unknownMessage: string,
    wrongKindMessage: (actualKind: string) => string,
    span: Span,
  },
): ResolvedType | null {
  const resolved = typeRegistry.get(typeName);
  if (!resolved) {
    errors.push(new TSError(ctx.code, ctx.unknownMessage, ctx.span));
    return null;
  }
  if (resolved.kind !== expectedKind) {
    errors.push(new TSError(ctx.code, ctx.wrongKindMessage(resolved.kind), ctx.span));
    return null;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// §41.13 / §53.10 — parseVariant validation helper.
//
// Validates that a CallExpr node's second argument is a bare type-name
// identifier referring to a scrml-native enum type. Emits
// E-PARSEVARIANT-TYPE-NOT-ENUM with the appropriate message variant when:
//   - args[1] is missing
//   - args[1] is not an IdentExpr (string literal, number, member, etc.)
//   - args[1] resolves to an undeclared type
//   - args[1] resolves to a non-enum type (struct, primitive, etc.)
//
// On success, returns the resolved EnumType; otherwise null.
//
// Sub-cases 3 + 4 delegate to `_resolveAndCheckL22TypeName` (§53.14.5
// L22 family helper, S106). Sub-cases 1 + 2 stay here because parseVariant's
// surface is CallExpr arg-shaped (vs markup-attr-shaped for formFor/tableFor).
// ---------------------------------------------------------------------------
function validateParseVariantTypeArg(
  call: { args?: unknown[] },
  typeRegistry: Map<string, ResolvedType>,
  errors: TSError[],
  span: Span,
): EnumType | null {
  const args = (call.args ?? []) as Array<{ kind?: string; name?: string }>;
  // Arity is checked elsewhere; defensive guard here.
  if (args.length < 2) return null;
  const typeArg = args[1];
  if (!typeArg || typeof typeArg !== "object") return null;

  if (typeArg.kind !== "ident" || typeof typeArg.name !== "string") {
    const got = typeArg.kind ?? "unknown";
    errors.push(new TSError(
      "E-PARSEVARIANT-TYPE-NOT-ENUM",
      `E-PARSEVARIANT-TYPE-NOT-ENUM: Second argument to \`parseVariant\` must be a bare type name (e.g. \`parseVariant(json, MyEnum)\`). ` +
      `Got: ${got}. ` +
      `Type-as-argument primitives reject expression-valued or string-valued type arguments at compile time.`,
      span,
    ));
    return null;
  }

  const typeName = typeArg.name;
  const resolved = _resolveAndCheckL22TypeName(typeName, "enum", typeRegistry, errors, {
    code: "E-PARSEVARIANT-TYPE-NOT-ENUM",
    unknownMessage:
      `E-PARSEVARIANT-TYPE-NOT-ENUM: \`parseVariant\` references unknown type '${typeName}'. ` +
      `The second argument must name a scrml-native \`:enum\` type declared in this file, ` +
      `or imported from another file. (See \`< match for=Type>\` E-ENGINE-004 for the parallel diagnostic.)`,
    wrongKindMessage: (kind) =>
      `E-PARSEVARIANT-TYPE-NOT-ENUM: \`parseVariant\` references type '${typeName}' which is a ${kind}, not an enum. ` +
      `parseVariant only accepts scrml-native \`:enum\` types — the variant set is what dispatches on the discriminator. ` +
      `For struct boundary parsing, use a server-fn entry point with §53 SPARK predicate refinement on the typed parameter.`,
    span,
  });
  return resolved as EnumType | null;
}

/**
 * §41.13 — walk an ASTNode tree and find every CallExpr whose callee resolves
 * to a parseVariant local name. Validate args[1] and annotate the call-node
 * with `parseVariantEnum: EnumType` for codegen.
 *
 * Walks both AST tree (markup, logic, function bodies) AND every ExprNode
 * payload (exprNode, initExpr, condition, etc.) — the parseVariant call may
 * appear at any expression position.
 */
function walkAndValidateParseVariantCalls(
  nodes: ASTNodeLike[],
  parseVariantLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  errors: TSError[],
  defaultSpan: Span,
): void {
  // Set of fields on AST nodes that may carry an ExprNode payload.
  const EXPR_FIELDS = [
    "exprNode", "initExpr", "argsExpr", "condExpr", "headerExpr",
    "iterExpr", "conditionExpr", "guardExpr", "valueExpr", "rhsExpr",
  ];

  function processCall(call: { kind?: string; callee?: unknown; args?: unknown[]; span?: Span } & Record<string, unknown>): void {
    const callee = call.callee as { kind?: string; name?: string } | undefined;
    if (!callee || callee.kind !== "ident" || typeof callee.name !== "string") return;
    if (!parseVariantLocals.has(callee.name)) return;
    const span = (call.span as Span | undefined) ?? defaultSpan;
    const enumType = validateParseVariantTypeArg(call, typeRegistry, errors, span);
    if (enumType) {
      // Annotate the call-node so codegen (emit-parse-variant.ts) can pick it up.
      // Convention parallels meta-checker.ts's typeRegistrySnapshot annotation.
      (call as Record<string, unknown>).parseVariantEnum = enumType;
    } else {
      // Mark as recognized-but-invalid so codegen knows to skip the
      // monomorphized emission and fall through to the runtime-fallback path.
      (call as Record<string, unknown>).parseVariantInvalid = true;
    }
  }

  function walkExpr(expr: unknown): void {
    if (!expr || typeof expr !== "object") return;
    // Use the structural call-walker on every ExprNode root.
    try {
      forEachCallInExprNode(expr as any, (call) => {
        processCall(call as any);
      });
    } catch {
      // forEachCallInExprNode is exhaustive per ExprNode kinds — defensive
      // catch in case an experimental kind sneaks in.
    }
  }

  function walkNode(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as ASTNodeLike;

    // Walk known ExprNode payload fields.
    for (const f of EXPR_FIELDS) {
      const v = (n as Record<string, unknown>)[f];
      if (v && typeof v === "object") walkExpr(v);
    }

    // Some lift / ram / when-message / guarded-expr shapes nest the ExprNode
    // under a wrapper object (e.g., n.expr.exprNode). Walk one level deep.
    const expr = (n as Record<string, unknown>).expr;
    if (expr && typeof expr === "object") {
      const inner = (expr as Record<string, unknown>).exprNode;
      if (inner && typeof inner === "object") walkExpr(inner);
    }

    // Recurse into children + body + arms.
    const body = (n as Record<string, unknown>).body;
    if (Array.isArray(body)) {
      for (const c of body) walkNode(c);
    }
    const children = (n as Record<string, unknown>).children;
    if (Array.isArray(children)) {
      for (const c of children) walkNode(c);
    }
    const arms = (n as Record<string, unknown>).arms;
    if (Array.isArray(arms)) {
      for (const a of arms) {
        if (a && typeof a === "object") {
          const handlerExpr = (a as Record<string, unknown>).handlerExpr;
          if (handlerExpr && typeof handlerExpr === "object") walkExpr(handlerExpr);
          walkNode(a);
        }
      }
    }
    // guarded-expr nests its protected node:
    const guardedNode = (n as Record<string, unknown>).guardedNode;
    if (guardedNode && typeof guardedNode === "object") walkNode(guardedNode);
  }

  for (const n of nodes) walkNode(n);
}

// ---------------------------------------------------------------------------
// §41.14 — formFor validation + AST rewrite helpers.
//
// Recognition + validation runs at the type-system stage per §53.14.5.
// The expander synthesizes the equivalent Shape 2 + <form> + <errors>
// markup tree (cross-ref compiler/src/codegen/emit-form-for.ts).
// ---------------------------------------------------------------------------

/**
 * Extract a bare-identifier attribute value. Returns null when the attribute
 * is missing or carries a non-identifier value shape (string-literal, expr,
 * etc. — those are flagged at the call site since the wanted error code
 * differs per attribute).
 */
function _ffGetIdentAttr(
  attrs: ASTNodeLike[] | undefined,
  name: string,
): { ref: string; span: Span | undefined } | null {
  if (!Array.isArray(attrs)) return null;
  for (const a of attrs) {
    if (!a || (a as ASTNodeLike).name !== name) continue;
    const val = (a as ASTNodeLike).value as { kind?: string; name?: string; span?: Span } | undefined;
    if (val && val.kind === "variable-ref" && typeof val.name === "string") {
      // Allow `@`-prefixed (for `as=@var`) — strip @ for caller.
      const ref = val.name.startsWith("@") ? val.name.slice(1) : val.name;
      return { ref, span: val.span };
    }
    // ATTR_IDENT also lands as "variable-ref" in the parsed AST. Done.
    return { ref: "", span: val?.span };
  }
  return null;
}

/**
 * Extract the raw attribute value text for an attribute that may carry a
 * string-literal, variable-ref, or expr shape. Returns the verbatim payload
 * (without quotes) — caller decides interpretation.
 */
function _ffGetAttrRawValue(
  attrs: ASTNodeLike[] | undefined,
  name: string,
): { rawValue: string; valueKind: string; span: Span | undefined } | null {
  if (!Array.isArray(attrs)) return null;
  for (const a of attrs) {
    if (!a || (a as ASTNodeLike).name !== name) continue;
    const val = (a as ASTNodeLike).value as { kind?: string; value?: unknown; raw?: string; name?: string; span?: Span } | undefined;
    if (!val) return { rawValue: "", valueKind: "absent", span: undefined };
    const kind = val.kind ?? "unknown";
    if (kind === "string-literal") {
      return { rawValue: String(val.value ?? ""), valueKind: kind, span: val.span };
    }
    if (kind === "variable-ref" || kind === "ident" || kind === "call-ref") {
      return { rawValue: String(val.name ?? val.raw ?? ""), valueKind: kind, span: val.span };
    }
    if (kind === "expr") {
      return { rawValue: String(val.raw ?? ""), valueKind: kind, span: val.span };
    }
    return { rawValue: String(val.raw ?? val.value ?? ""), valueKind: kind, span: val.span };
  }
  return null;
}

/**
 * Parse an array-literal attribute (`pick=["a", "b"]` or `omit=["c"]`) into
 * the list of bare field-name strings. Returns null on a non-array shape.
 * Permissive: accepts both string-literal entries (`"a"`) and bare-ident
 * entries (`a`) since adopters write either form interchangeably.
 */
function _ffParseStringArray(raw: string): string[] | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip outer brackets (and parens, defensively).
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1).trim();
  else if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  else return null;
  if (!s) return [];
  const parts = s.split(",").map(p => p.trim()).filter(p => p.length > 0);
  const out: string[] = [];
  for (const p of parts) {
    let v = p;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(v)) out.push(v);
    else return null;  // malformed entry
  }
  return out;
}

/**
 * Walk the file's AST and find every `<formFor>` markup-element node;
 * validate per §41.14.1-§41.14.8; on success, rewrite the parent's children
 * array to splice in the synthesized compound state-decl + <form> markup
 * tree.
 *
 * Parent threading: we cannot rely on parent backrefs (AST construction
 * doesn't populate them). Instead, the walker iterates over each parent's
 * `children`/`body` array and detects formFor children itself, splicing in
 * the synthesized nodes when a match is found.
 */
function walkAndExpandFormForNodes(
  nodes: ASTNodeLike[],
  formForLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  structFieldRawClauses: Map<string, Map<string, string>>,
  fnSignatures: Map<string, { params: Array<{ name: string; type: ResolvedType }>; returnType: ResolvedType }>,
  fnErrorTypes: Map<string, string>,
  routeMap: RouteMap,
  errors: TSError[],
  filePath: string,
  defaultSpan: Span,
): void {
  // Dynamic import to avoid a static cycle (codegen → type-system) — the
  // emit-form-for module is leaf-clean (no imports back into type-system).
  // We use a synchronous-resolve dance: bun supports top-level require via
  // createRequire, but for compatibility we stash the helpers under a
  // lazy-loaded local. The first walk triggers the load.
  let expanderModule: typeof import("./codegen/emit-form-for.ts") | null = null;
  function loadExpander(): typeof import("./codegen/emit-form-for.ts") {
    if (expanderModule) return expanderModule;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expanderModule = require("./codegen/emit-form-for.ts");
    return expanderModule;
  }

  function processFormForNode(
    node: ASTNodeLike,
  ): { compoundDecl: unknown; formElement: unknown } | null {
    const span = ((node.span as Span | undefined) ?? defaultSpan);
    const attrs = (node.attrs as ASTNodeLike[] | undefined) ?? (node.attributes as ASTNodeLike[] | undefined);

    // §41.14.1 — Validate `for=` attribute.
    const forAttr = _ffGetAttrRawValue(attrs, "for");
    if (!forAttr || !forAttr.rawValue) {
      errors.push(new TSError(
        "E-FORMFOR-TYPE-NOT-STRUCT",
        `E-FORMFOR-TYPE-NOT-STRUCT: \`<formFor for=...>\` is missing the required \`for=\` attribute. ` +
        `The \`for=\` attribute SHALL be a bare scrml-native \`:struct\` type identifier — e.g. \`<formFor for=Signup .../>\`. ` +
        `See SPEC §41.14.1.`,
        forAttr?.span ?? span,
      ));
      return null;
    }
    if (forAttr.valueKind === "string-literal") {
      errors.push(new TSError(
        "E-FORMFOR-TYPE-NOT-STRUCT",
        `E-FORMFOR-TYPE-NOT-STRUCT: \`<formFor for=...>\` was given a quoted string value '"${forAttr.rawValue}"'. ` +
        `The \`for=\` attribute SHALL be a bare scrml-native \`:struct\` type identifier — not a string literal. ` +
        `Example: \`<formFor for=Signup .../>\` (NOT \`<formFor for="Signup"/>\`). See SPEC §41.14.1.`,
        forAttr.span ?? span,
      ));
      return null;
    }
    const structTypeName = forAttr.rawValue;
    const resolved = _resolveAndCheckL22TypeName(structTypeName, "struct", typeRegistry, errors, {
      code: "E-FORMFOR-TYPE-NOT-STRUCT",
      unknownMessage:
        `E-FORMFOR-TYPE-NOT-STRUCT: \`<formFor for=${structTypeName}>\` references unknown type '${structTypeName}'. ` +
        `The \`for=\` attribute must name a scrml-native \`:struct\` type declared in this file ` +
        `(or imported via \`\${ import { ${structTypeName} } from './path.scrml' }\`). See SPEC §41.14.1.`,
      wrongKindMessage: (kind) =>
        `E-FORMFOR-TYPE-NOT-STRUCT: \`<formFor for=${structTypeName}>\` references type '${structTypeName}' which is a ${kind}, not a struct. ` +
        `\`formFor\` only accepts scrml-native \`:struct\` types — the field set is what drives the auto-generated form. ` +
        `For enum-shape boundary parsing, use \`parseVariant\` (§41.13) instead. See SPEC §41.14.1.`,
      span: forAttr.span ?? span,
    });
    if (!resolved) return null;
    const structType = resolved as StructType;

    // §41.14.2 — Resolve cell name (default = camel-cased struct name,
    // `as=@varName` override).
    const asAttr = _ffGetAttrRawValue(attrs, "as");
    let cellName = (loadExpander().camelizeStructName(structTypeName));
    if (asAttr && asAttr.rawValue) {
      const asRaw = asAttr.rawValue.startsWith("@") ? asAttr.rawValue.slice(1) : asAttr.rawValue;
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(asRaw)) cellName = asRaw;
    }

    // §41.14.5 — Validate pick=/omit=/partial=.
    const pickAttr = _ffGetAttrRawValue(attrs, "pick");
    const omitAttr = _ffGetAttrRawValue(attrs, "omit");
    const partialAttr = _ffGetAttrRawValue(attrs, "partial");

    if (pickAttr && omitAttr) {
      errors.push(new TSError(
        "E-FORMFOR-PICK-OMIT-CONFLICT",
        `E-FORMFOR-PICK-OMIT-CONFLICT: \`<formFor>\` was given BOTH \`pick=\` AND \`omit=\` attributes. ` +
        `The two are mutually exclusive — \`pick=\` names the only fields to include; \`omit=\` names fields to exclude. ` +
        `Resolution: choose one. For combined transforms, layer Pick over Omit at the type level. See SPEC §41.14.5.`,
        span,
      ));
      return null;
    }

    let pickList: string[] | null = null;
    if (pickAttr && pickAttr.rawValue) {
      pickList = _ffParseStringArray(pickAttr.rawValue);
      if (!pickList) {
        errors.push(new TSError(
          "E-FORMFOR-PICK-INVALID-FIELD",
          `E-FORMFOR-PICK-INVALID-FIELD: \`<formFor pick=...>\` value '${pickAttr.rawValue}' is not a recognized array-of-strings literal. ` +
          `Use the form \`pick=["fieldA", "fieldB"]\` with bare field-name strings. See SPEC §41.14.5.`,
          pickAttr.span ?? span,
        ));
        return null;
      }
      for (const fieldName of pickList) {
        if (!structType.fields.has(fieldName)) {
          errors.push(new TSError(
            "E-FORMFOR-PICK-INVALID-FIELD",
            `E-FORMFOR-PICK-INVALID-FIELD: \`<formFor for=${structTypeName} pick=[...]>\` references field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
            `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.14.5.`,
            pickAttr.span ?? span,
          ));
          return null;
        }
      }
    }

    let omitList: string[] | null = null;
    if (omitAttr && omitAttr.rawValue) {
      omitList = _ffParseStringArray(omitAttr.rawValue);
      if (!omitList) {
        errors.push(new TSError(
          "E-FORMFOR-OMIT-INVALID-FIELD",
          `E-FORMFOR-OMIT-INVALID-FIELD: \`<formFor omit=...>\` value '${omitAttr.rawValue}' is not a recognized array-of-strings literal. ` +
          `Use the form \`omit=["fieldA", "fieldB"]\` with bare field-name strings. See SPEC §41.14.5.`,
          omitAttr.span ?? span,
        ));
        return null;
      }
      for (const fieldName of omitList) {
        if (!structType.fields.has(fieldName)) {
          errors.push(new TSError(
            "E-FORMFOR-OMIT-INVALID-FIELD",
            `E-FORMFOR-OMIT-INVALID-FIELD: \`<formFor for=${structTypeName} omit=[...]>\` references field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
            `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.14.5.`,
            omitAttr.span ?? span,
          ));
          return null;
        }
      }
    }

    const partial = !!(partialAttr && (
      partialAttr.rawValue === "true"
      || partialAttr.valueKind === "boolean-flag"
      || (partialAttr.valueKind === "absent" && partialAttr.rawValue === "")
    ));

    // §41.14.6 — Validate error-strategy.
    const errStratAttr = _ffGetAttrRawValue(attrs, "error-strategy");
    let errorStrategy: "per-field" | "summary" | "both" = "per-field";
    if (errStratAttr && errStratAttr.rawValue !== "") {
      const v = errStratAttr.rawValue;
      if (v !== "per-field" && v !== "summary" && v !== "both") {
        errors.push(new TSError(
          "E-FORMFOR-ERROR-STRATEGY-INVALID",
          `E-FORMFOR-ERROR-STRATEGY-INVALID: \`<formFor error-strategy="${v}"/>\` is not a recognized strategy value. ` +
          `Valid values: "per-field" (default), "summary", "both". See SPEC §41.14.6.`,
          errStratAttr.span ?? span,
        ));
        return null;
      }
      errorStrategy = v as "per-field" | "summary" | "both";
    }

    // §41.14.4 — Walk slot children; validate slot names against struct fields.
    const slotOverrides = new Map<string, unknown[]>();
    const declaredFieldNames = new Set(structType.fields.keys());
    const childNodes = (node.children as ASTNodeLike[] | undefined) ?? [];
    for (const child of childNodes) {
      if (!child || typeof child !== "object") continue;
      // Slot children inside <formFor> are <slot name="X">...</> or a typed
      // child element with `slot="X"` (component-slot convention per §16).
      // We accept both forms — a <slot name="X"> element OR any element with
      // a `slot="X"` attribute — to match adopter expectations.
      let slotName: string | null = null;
      let slotContent: ASTNodeLike[] | null = null;
      if (child.kind === "markup" && (child.tag === "slot" || (child as ASTNodeLike).tagName === "slot")) {
        const slotAttrs = (child.attrs as ASTNodeLike[] | undefined) ?? (child.attributes as ASTNodeLike[] | undefined);
        const nameAttr = _ffGetAttrRawValue(slotAttrs, "name");
        if (nameAttr && nameAttr.rawValue) {
          slotName = nameAttr.rawValue;
          slotContent = (child.children as ASTNodeLike[] | undefined) ?? [];
        }
      } else if (child.kind === "markup") {
        // Inline form: any element bearing a `slot="X"` attribute.
        const cAttrs = (child.attrs as ASTNodeLike[] | undefined) ?? (child.attributes as ASTNodeLike[] | undefined);
        const slotAttr = _ffGetAttrRawValue(cAttrs, "slot");
        if (slotAttr && slotAttr.rawValue) {
          slotName = slotAttr.rawValue;
          // The whole child element IS the slot content.
          slotContent = [child];
        }
      }
      if (slotName !== null) {
        // §41.14.4 — slot name must match a struct field name OR the reserved "submit" slot.
        if (slotName !== "submit" && !declaredFieldNames.has(slotName)) {
          errors.push(new TSError(
            "E-FORMFOR-SLOT-UNKNOWN",
            `E-FORMFOR-SLOT-UNKNOWN: \`<formFor for=${structTypeName}>\` contains a slot \`name="${slotName}"\` that does not match any struct field or the reserved "submit" slot. ` +
            `Valid slot names: ${["submit", ...structType.fields.keys()].join(", ")}. See SPEC §41.14.4.`,
            (child.span as Span | undefined) ?? span,
          ));
          return null;
        }
        slotOverrides.set(slotName, slotContent ?? []);
      }
      // Non-slot children (text, comments, etc.) are silently ignored — the
      // formFor body's load-bearing content is its slot overrides; other
      // children are spurious whitespace.
    }

    // §41.14.5 — Compute the included field set.
    const allFieldNames = [...structType.fields.keys()];
    let includedFieldNames: string[];
    if (pickList) {
      includedFieldNames = pickList;
    } else if (omitList) {
      const omitSet = new Set(omitList);
      includedFieldNames = allFieldNames.filter(f => !omitSet.has(f));
    } else {
      includedFieldNames = allFieldNames;
    }

    // §41.14.8 — Nested struct fields require slot overrides.
    const rawClauses = structFieldRawClauses.get(structTypeName) ?? new Map<string, string>();
    const includedFields: import("./codegen/emit-form-for.ts").FieldInfo[] = [];
    for (const fieldName of includedFieldNames) {
      const fieldType = structType.fields.get(fieldName);
      if (!fieldType) continue;
      const fieldKind = (fieldType as { kind?: string }).kind ?? "asIs";
      const isNestedStruct = fieldKind === "struct";
      if (isNestedStruct && !slotOverrides.has(fieldName)) {
        errors.push(new TSError(
          "E-FORMFOR-NESTED-STRUCT-NO-SLOT",
          `E-FORMFOR-NESTED-STRUCT-NO-SLOT: \`<formFor for=${structTypeName}>\` has a struct-typed field '${fieldName}' but no \`<slot name="${fieldName}">\` override was provided. ` +
          `v1.0 does NOT auto-recurse into nested struct fields (deferred to v1.next per OQ-FF-11). ` +
          `Resolution: provide an explicit slot override (typically a sibling \`<formFor for=${(fieldType as { name?: string }).name ?? "NestedType"}/>\` call), OR exclude the field via \`omit=["${fieldName}"]\`. See SPEC §41.14.8.`,
          span,
        ));
        return null;
      }
      // Determine the base-type name for input-shape selection. The
      // typeRegistry path handles predicated + primitive resolution; for
      // fall-through cases (the legacy struct-body parser drops trailing
      // `req length(...)` validators into asIs), we extract the leading
      // bare type token from the raw clause text.
      const clauseRaw = rawClauses.get(fieldName) ?? "";
      let baseTypeName: string =
        fieldKind === "predicated"
          ? ((fieldType as { baseType?: string }).baseType ?? "string")
          : (fieldKind === "primitive"
              ? ((fieldType as { name?: string }).name ?? "string")
              : fieldKind);
      if (baseTypeName === "asIs" || baseTypeName === "unknown") {
        // Pull the leading token from clauseRaw — `"boolean req"` → `"boolean"`,
        // `"string req length(>=2)"` → `"string"`, etc.
        const m = clauseRaw.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (m) baseTypeName = m[1];
      }
      const validators = loadExpander().parseValidatorClauses(clauseRaw);
      includedFields.push({
        name: fieldName,
        baseTypeName,
        label: loadExpander().mechanicalLabel(fieldName),
        validators,
        isNestedStruct,
      });
    }

    // §41.14.3 — Validate onsubmit handler signature.
    const onsubmitAttr = _ffGetAttrRawValue(attrs, "onsubmit");
    let onsubmitFnName: string | null = null;
    let onsubmitBoundary: "server" | "client" | null = null;
    let peActionUrl = "";
    if (onsubmitAttr && onsubmitAttr.rawValue) {
      onsubmitFnName = onsubmitAttr.rawValue;
      // Strip trailing `()` if adopter wrote bare-call form `fn()`.
      if (onsubmitFnName.endsWith("()")) onsubmitFnName = onsubmitFnName.slice(0, -2).trim();
      const sig = fnSignatures.get(onsubmitFnName);
      if (!sig) {
        // Defensive — fn name resolution may fail on cross-file imports OR
        // when the fn is declared later in source. We avoid firing
        // E-FORMFOR-ONSUBMIT-SIGNATURE for unresolved-name cases to keep
        // false positives down; the adopter sees E-NAME-UNDECLARED at the
        // ident position instead.
      } else {
        // Param-1 type must be assignable from the (post-transform) struct shape.
        const firstParam = sig.params[0];
        if (!firstParam) {
          errors.push(new TSError(
            "E-FORMFOR-ONSUBMIT-SIGNATURE",
            `E-FORMFOR-ONSUBMIT-SIGNATURE: \`<formFor onsubmit=${onsubmitFnName}/>\`'s handler takes zero arguments. ` +
            `Expected signature: \`fn(values: ${structTypeName}${pickList || omitList ? " /* or derived shape */" : ""}) ! ErrorType\`. ` +
            `See SPEC §41.14.3.`,
            onsubmitAttr.span ?? span,
          ));
          return null;
        }
        const paramType = firstParam.type;
        const paramKind = (paramType as { kind?: string }).kind ?? "asIs";
        // Conservative match: accept exact struct match OR asIs/unknown (defer to caller's discipline).
        // pick/omit transforms produce a derived shape — v1.0 accepts the unmodified struct type
        // as a signature match and reserves stricter checking for v1.next per §41.14.5 last bullet.
        if (paramKind === "struct") {
          const paramStructName = (paramType as { name?: string }).name ?? "";
          if (paramStructName && paramStructName !== structTypeName) {
            errors.push(new TSError(
              "E-FORMFOR-ONSUBMIT-SIGNATURE",
              `E-FORMFOR-ONSUBMIT-SIGNATURE: \`<formFor for=${structTypeName} onsubmit=${onsubmitFnName}/>\`'s handler's first parameter has type '${paramStructName}', not '${structTypeName}'. ` +
              `Expected signature: \`fn(values: ${structTypeName}) ! ErrorType\`. See SPEC §41.14.3.`,
              onsubmitAttr.span ?? span,
            ));
            return null;
          }
        } else if (paramKind !== "asIs" && paramKind !== "unknown") {
          errors.push(new TSError(
            "E-FORMFOR-ONSUBMIT-SIGNATURE",
            `E-FORMFOR-ONSUBMIT-SIGNATURE: \`<formFor for=${structTypeName} onsubmit=${onsubmitFnName}/>\`'s handler's first parameter is typed '${paramKind}' (expected struct type '${structTypeName}'). ` +
            `Expected signature: \`fn(values: ${structTypeName}) ! ErrorType\`. See SPEC §41.14.3.`,
            onsubmitAttr.span ?? span,
          ));
          return null;
        }

        // Classify the handler: server fn ↔ PE-default action= per §41.14.3 + §12.5.
        // FunctionRoute keys to functionNodeId = `${filePath}::${fnNode.span.start}`.
        // We find the function-decl AST node for onsubmitFnName and look up its
        // route by the same key shape that route-inference.ts uses.
        let fnRoute: { boundary?: string; generatedRouteName?: string | null; explicitRoute?: string | null } | undefined;
        if (routeMap?.functions) {
          // Walk top-level AST for the named function-decl.
          let onsubmitFnSpanStart: number | undefined;
          function findFnDecl(arr: ASTNodeLike[] | undefined): void {
            if (!Array.isArray(arr)) return;
            for (const nn of arr) {
              if (!nn || typeof nn !== "object") continue;
              if (nn.kind === "function-decl" && nn.name === onsubmitFnName) {
                onsubmitFnSpanStart = (nn.span as Span | undefined)?.start;
                return;
              }
              findFnDecl(nn.body as ASTNodeLike[] | undefined);
              if (onsubmitFnSpanStart != null) return;
              findFnDecl(nn.children as ASTNodeLike[] | undefined);
              if (onsubmitFnSpanStart != null) return;
            }
          }
          findFnDecl(nodes);
          if (typeof onsubmitFnSpanStart === "number") {
            const fnNodeId = `${filePath}::${onsubmitFnSpanStart}`;
            fnRoute = routeMap.functions.get(fnNodeId) as typeof fnRoute;
          }
        }
        if (fnRoute) {
          if (fnRoute.boundary === "server") {
            onsubmitBoundary = "server";
            const route = fnRoute.explicitRoute || fnRoute.generatedRouteName;
            if (route) {
              peActionUrl = route.startsWith("/") ? route : `/api/${route}`;
            } else {
              peActionUrl = `/api/${onsubmitFnName}`;
            }
          } else if (fnRoute.boundary === "client") {
            onsubmitBoundary = "client";
          }
        }
      }
    }

    // Build the expansion plan + invoke the AST builder.
    const exp: import("./codegen/emit-form-for.ts").FormForExpansion = {
      cellName,
      structName: structTypeName,
      includedFields,
      slotOverrides,
      onsubmitFnName,
      onsubmitBoundary,
      peActionUrl,
      errorStrategy,
      partial,
      span,
    };
    const [compoundDecl, formElement] = loadExpander().expandFormFor(exp);
    return { compoundDecl, formElement };
  }

  /**
   * Splice the synthesized [compoundDecl, formElement] in place of the
   * formFor child at index `i` of `arr`. The original formFor node is
   * removed; the two synth nodes are inserted in order so the compound
   * state-decl precedes the markup that uses it via render-by-tag.
   */
  function spliceFormFor(arr: ASTNodeLike[], i: number, synth: { compoundDecl: unknown; formElement: unknown }): void {
    arr.splice(i, 1, synth.compoundDecl as ASTNodeLike, synth.formElement as ASTNodeLike);
  }

  function walkAndSplice(arr: ASTNodeLike[] | undefined): void {
    if (!Array.isArray(arr)) return;
    // Walk in reverse so splice insertions don't disturb forward indices for
    // siblings we haven't visited. Each formFor child expands to 2 nodes.
    for (let i = arr.length - 1; i >= 0; i--) {
      const child = arr[i];
      if (!child || typeof child !== "object") continue;
      if (child.kind === "markup") {
        const tag = (child.tag as string | undefined)
          ?? ((child as ASTNodeLike).tagName as string | undefined);
        if (tag === "formFor" || tag === "formfor") {
          const synth = processFormForNode(child);
          if (synth) spliceFormFor(arr, i, synth);
          continue;  // do not recurse into the formFor's children (they're consumed)
        }
      }
      // Recurse into children + body of non-formFor nodes.
      const cChildren = (child as ASTNodeLike).children as ASTNodeLike[] | undefined;
      if (Array.isArray(cChildren)) walkAndSplice(cChildren);
      const cBody = (child as ASTNodeLike).body as ASTNodeLike[] | undefined;
      if (Array.isArray(cBody)) walkAndSplice(cBody);
    }
  }

  walkAndSplice(nodes);
}

// ---------------------------------------------------------------------------
// §41.15 — schemaFor validation + AST rewrite helpers.
//
// Recognition + validation runs at the type-system stage per §53.14.5.
// The expander synthesizes the shared-core `<schema>` table-declaration
// text fragment (cross-ref compiler/src/codegen/emit-schema-for.ts).
//
// Architectural decisions:
//   - Function-call form `${ schemaFor(StructType[, options]) }` interpolated
//     inside a `<schema>` block (Form B per OQ-SCH-1 50/60 verdict).
//   - Two-pass walker: Pass A processes calls inside `<schema>` state nodes
//     (valid context); Pass B processes calls anywhere else (invalid
//     context — E-SCHEMAFOR-INVALID-CALL-CONTEXT).
//   - After validation success, the parent `logic` child of the `<schema>`
//     state node is replaced with a synthesized `text` node carrying the
//     expanded table-declaration body. The downstream schema-differ.js
//     parser ingests the text identically to hand-authored content.
// ---------------------------------------------------------------------------

/**
 * Parse the `{pick: ["a"], omit: ["b"]}` options object literal that may
 * appear as args[1] of a schemaFor call. Returns:
 *   { ok: true, pick, omit } — on a recognized shape (pick/omit may be null)
 *   { ok: false, reason }    — when the shape is unrecognized
 *
 * Accepts object-literal ExprNodes with kind:"object" + properties[].
 */
function _sfParseOptionsArg(
  optionsArg: unknown,
): { ok: true; pick: string[] | null; omit: string[] | null } | { ok: false; reason: string } {
  if (!optionsArg || typeof optionsArg !== "object") {
    return { ok: false, reason: "options argument is not an object" };
  }
  const o = optionsArg as { kind?: string; properties?: unknown[]; props?: unknown[] };
  if (o.kind !== "object") {
    return { ok: false, reason: `options argument is a ${o.kind ?? "unknown"} expression, not an object literal` };
  }
  // Per the actual ObjectExpr shape from the expression parser:
  //   { kind: "object", props: [{ kind: "prop", key: <string>, value: <ExprNode>, computed: false }] }
  // (the older `properties` field is a defensive fallback only)
  const props = (Array.isArray(o.props) ? o.props : Array.isArray(o.properties) ? o.properties : []) as Array<{ key?: unknown; value?: unknown }>;
  let pick: string[] | null = null;
  let omit: string[] | null = null;
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    // `key` may be a bare string (current expression-parser shape) OR an
    // identifier-node `{kind:"ident",name:"pick"}` (defensive fallback).
    let keyName: string | undefined;
    const k = p.key as unknown;
    if (typeof k === "string") {
      keyName = k;
    } else if (k && typeof k === "object") {
      const ko = k as { name?: string; value?: string };
      keyName = (ko.name ?? ko.value) as string | undefined;
    }
    if (keyName !== "pick" && keyName !== "omit") continue;
    const val = p.value as { kind?: string; elements?: unknown[]; items?: unknown[] } | undefined;
    if (!val || typeof val !== "object") {
      return { ok: false, reason: `'${keyName}' is not an array literal` };
    }
    if (val.kind !== "array") {
      return { ok: false, reason: `'${keyName}' is a ${val.kind ?? "unknown"} expression, not an array literal` };
    }
    const elems = (Array.isArray(val.elements) ? val.elements : Array.isArray(val.items) ? val.items : []) as Array<{ kind?: string; value?: unknown; name?: string; litType?: string; raw?: string }>;
    const out: string[] = [];
    for (const el of elems) {
      if (!el || typeof el !== "object") {
        return { ok: false, reason: `'${keyName}' contains a non-string entry` };
      }
      // Accept the lit-node shape from expression-parser:
      //   {kind:"lit", litType:"string", value:"name", raw:'"name"'}
      // AND the bare-ident shape (rare but valid for unquoted entries):
      //   {kind:"ident", name:"name"}
      if (el.kind === "lit" && el.litType === "string" && typeof el.value === "string") {
        out.push(el.value as string);
      } else if (el.kind === "string" && typeof el.value === "string") {
        // Defensive fallback if a different parser tag string literals.
        out.push(el.value as string);
      } else if (el.kind === "ident" && typeof el.name === "string") {
        out.push(el.name as string);
      } else {
        return { ok: false, reason: `'${keyName}' contains an unrecognized entry shape (${el.kind ?? "unknown"}${el.litType ? ":" + el.litType : ""})` };
      }
    }
    if (keyName === "pick") pick = out;
    if (keyName === "omit") omit = out;
  }
  return { ok: true, pick, omit };
}

/**
 * Process a single schemaFor CallExpr inside a `<schema>` block context.
 * Validates per §41.15.1, §41.15.4, §41.15.7, §41.15.8 (the 7 inside-schema
 * error codes; E-SCHEMAFOR-INVALID-CALL-CONTEXT is fired by the outside-
 * schema branch). On success, returns the expanded text body. On failure,
 * emits the appropriate error to `errors` and returns null.
 *
 * Implementation note: this function is called by the schemaFor walker's
 * "valid context" branch; the walker handles AST splicing once a valid
 * expansion is produced.
 */
function _processSchemaForCallInSchemaContext(
  call: { args?: unknown[]; span?: Span } & Record<string, unknown>,
  typeRegistry: Map<string, ResolvedType>,
  structFieldRawClauses: Map<string, Map<string, string>>,
  errors: TSError[],
  defaultSpan: Span,
): { textBody: string } | null {
  // Late-load the codegen module to keep the import dependency clean.
  const codegen = require("./codegen/emit-schema-for.ts") as typeof import("./codegen/emit-schema-for.ts");
  const span = (call.span as Span | undefined) ?? defaultSpan;

  const args = (call.args ?? []) as Array<{ kind?: string; name?: string } & Record<string, unknown>>;

  // §41.15.1 — Validate first positional argument is a bare struct identifier.
  const typeArg = args[0];
  if (!typeArg || typeof typeArg !== "object" || typeArg.kind !== "ident" || typeof typeArg.name !== "string") {
    const got = typeArg && typeof typeArg === "object" ? (typeArg.kind ?? "unknown") : typeof typeArg;
    errors.push(new TSError(
      "E-SCHEMAFOR-TYPE-NOT-STRUCT",
      `E-SCHEMAFOR-TYPE-NOT-STRUCT: First argument to \`schemaFor\` must be a bare \`:struct\` type identifier ` +
      `(e.g. \`schemaFor(User)\`). Got: ${got}. See SPEC §41.15.1.`,
      span,
    ));
    return null;
  }
  const structTypeName = typeArg.name as string;
  const resolved = _resolveAndCheckL22TypeName(structTypeName, "struct", typeRegistry, errors, {
    code: "E-SCHEMAFOR-TYPE-NOT-STRUCT",
    unknownMessage:
      `E-SCHEMAFOR-TYPE-NOT-STRUCT: \`schemaFor(${structTypeName})\` references unknown type '${structTypeName}'. ` +
      `The first argument must name a scrml-native \`:struct\` type declared in this file ` +
      `(or imported via \`\${ import { ${structTypeName} } from './path.scrml' }\`). See SPEC §41.15.1.`,
    wrongKindMessage: (kind) =>
      `E-SCHEMAFOR-TYPE-NOT-STRUCT: \`schemaFor(${structTypeName})\` references type '${structTypeName}' which is a ${kind}, not a struct. ` +
      `\`schemaFor\` only accepts scrml-native \`:struct\` types — the field set is what drives the auto-generated DDL. ` +
      `For enum-shape boundary parsing, use \`parseVariant\` (§41.13); for form generation, use \`formFor\` (§41.14). ` +
      `See SPEC §41.15.1.`,
    span,
  });
  if (!resolved) return null;
  const structType = resolved as StructType;

  // §41.15.4 — Validate options arg (if present): pick, omit, mutual exclusion.
  let pickList: string[] | null = null;
  let omitList: string[] | null = null;
  if (args.length >= 2) {
    const optsResult = _sfParseOptionsArg(args[1]);
    if (!optsResult.ok) {
      // The shape was unrecognized. We surface this through the pick/omit
      // codes since the only documented option keys are pick/omit and any
      // structural issue points at one or the other.
      errors.push(new TSError(
        "E-SCHEMAFOR-PICK-INVALID-FIELD",
        `E-SCHEMAFOR-PICK-INVALID-FIELD: \`schemaFor(${structTypeName}, ...)\` options argument is malformed — ${optsResult.reason}. ` +
        `Expected shape: \`{ pick: ["fieldA", "fieldB"] }\` or \`{ omit: ["fieldA"] }\` with bare field-name strings. ` +
        `See SPEC §41.15.4.`,
        span,
      ));
      return null;
    }
    pickList = optsResult.pick;
    omitList = optsResult.omit;
    if (pickList && omitList) {
      errors.push(new TSError(
        "E-SCHEMAFOR-PICK-OMIT-CONFLICT",
        `E-SCHEMAFOR-PICK-OMIT-CONFLICT: \`schemaFor(${structTypeName}, ...)\` was given BOTH \`pick\` AND \`omit\` options. ` +
        `The two transforms are mutually exclusive — \`pick\` names the only fields to include; \`omit\` names fields to exclude. ` +
        `Resolution: choose one. For combined transforms, layer Pick over Omit at the type level. See SPEC §41.15.4.`,
        span,
      ));
      return null;
    }
    if (pickList) {
      for (const fieldName of pickList) {
        if (!structType.fields.has(fieldName)) {
          errors.push(new TSError(
            "E-SCHEMAFOR-PICK-INVALID-FIELD",
            `E-SCHEMAFOR-PICK-INVALID-FIELD: \`schemaFor(${structTypeName}, { pick: [...] })\` references field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
            `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.15.4.`,
            span,
          ));
          return null;
        }
      }
    }
    if (omitList) {
      for (const fieldName of omitList) {
        if (!structType.fields.has(fieldName)) {
          errors.push(new TSError(
            "E-SCHEMAFOR-OMIT-INVALID-FIELD",
            `E-SCHEMAFOR-OMIT-INVALID-FIELD: \`schemaFor(${structTypeName}, { omit: [...] })\` references field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
            `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.15.4.`,
            span,
          ));
          return null;
        }
      }
    }
  }

  // Compute the included field set per pick/omit.
  const allFieldNames = [...structType.fields.keys()];
  let includedFieldNames: string[];
  if (pickList) {
    includedFieldNames = pickList;
  } else if (omitList) {
    const omitSet = new Set(omitList);
    includedFieldNames = allFieldNames.filter(f => !omitSet.has(f));
  } else {
    includedFieldNames = allFieldNames;
  }

  // §41.15.5/§41.15.6/§41.15.7/§41.15.8 — per-field SQL-mapping classification.
  // The typeRegistry stores struct fields' resolved types — but the type-decl
  // parser strips trailing validator predicates and drops the resolved kind
  // to `asIs` when the field declaration carries any predicate at all (e.g.
  // `email: string req length(<=120)`). To recover the actual base-type for
  // classification we fall back to the leading token in the raw clause text.
  // Mirrors the formFor (§41.14) fallback at line 10321-10326.
  const rawClauses = structFieldRawClauses.get(structTypeName) ?? new Map<string, string>();
  const includedFields: import("./codegen/emit-schema-for.ts").SchemaForFieldInfo[] = [];
  for (const fieldName of includedFieldNames) {
    let fieldType = structType.fields.get(fieldName) as unknown;
    const ftKind = (fieldType && typeof fieldType === "object")
      ? ((fieldType as { kind?: string }).kind ?? "unknown")
      : "unknown";
    if (ftKind === "asIs" || ftKind === "unknown") {
      // Recover the type-token from the raw clause + re-resolve through
      // typeRegistry. This catches:
      //   - primitive bases dropped to asIs by predicate-trailing
      //     (`email: string req` → "asIs" → "string" → typeRegistry primitive)
      //   - user-declared enum/struct types referenced as field types
      //     (`role: UserRole req` → "asIs" → "UserRole" → typeRegistry enum)
      const clauseRaw = rawClauses.get(fieldName) ?? "";
      const m = clauseRaw.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m) {
        const tokenName = m[1];
        const resolved = typeRegistry.get(tokenName);
        if (resolved) {
          fieldType = resolved;
        }
      }
    }
    const mapping = codegen.classifyFieldForSql(fieldType);
    if (mapping.kind === "nested-struct") {
      errors.push(new TSError(
        "E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1",
        `E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1: \`schemaFor(${structTypeName})\` has a struct-typed field '${fieldName}' but v1.0 does NOT derive foreign-key columns from cross-type struct references ` +
        `(OQ-SCH-4 ratified out-of-scope; deferred to v1.next). ` +
        `Resolution: omit the nested struct field via \`schemaFor(${structTypeName}, { omit: ["${fieldName}"] })\` and hand-author the FK column inside the same \`<schema>\` block per §41.15.3 interleaving (e.g., \`${fieldName}_id: integer req references(<Table>.id)\`), OR refactor the struct to use a flat \`_id\` field instead of the nested struct reference. ` +
        `See SPEC §41.15.7.`,
        span,
      ));
      return null;
    }
    if (mapping.kind === "payload-enum") {
      errors.push(new TSError(
        "E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1",
        `E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1: \`schemaFor(${structTypeName})\` has field '${fieldName}' typed as a payload-bearing enum '${mapping.enumName}' (one or more variants carry payload data). ` +
        `v1.0 does NOT lower payload enums to SQL — the choice between a JSON column (flexible; loses CHECK constraint precision) vs a separate-table join (relational; requires FK derivation per OQ-SCH-4) is deferred to v1.next. ` +
        `Bare-variant enums (no payloads) DO lower per §41.15.6 — \`text req oneOf([...])\`. ` +
        `Resolution: refactor to a bare-variant enum if the payload is not load-bearing, OR exclude the field via \`omit: ["${fieldName}"]\` and hand-author a JSON column / separate table as needed. ` +
        `See SPEC §41.15.6.`,
        span,
      ));
      return null;
    }
    if (mapping.kind === "no-mapping") {
      errors.push(new TSError(
        "E-SCHEMAFOR-NO-SQL-MAPPING",
        `E-SCHEMAFOR-NO-SQL-MAPPING: \`schemaFor(${structTypeName})\` has field '${fieldName}' whose declared type (${mapping.typeKind}) has no v1.0 SQL mapping. ` +
        `Unmappable shapes include function types, Promise types, foreign-code types, deep-reactive proxy types, arrays, and arbitrary opaque types. ` +
        `Resolution: exclude the field via \`schemaFor(${structTypeName}, { omit: ["${fieldName}"] })\`, OR refactor the struct to use a mappable shape (primitive scalar / string / number / boolean / enum / scrml-native temporal type). ` +
        `See SPEC §41.15.8.`,
        span,
      ));
      return null;
    }

    // Parse the validator clauses from the raw struct-body text. The
    // validator-clauses parser lives in emit-form-for.ts (which emit-schema-
    // for.ts re-imports for the FormForValidator shape).
    const clauseRaw = rawClauses.get(fieldName) ?? "";
    const formForModule = require("./codegen/emit-form-for.ts") as typeof import("./codegen/emit-form-for.ts");
    const validators = formForModule.parseValidatorClauses(clauseRaw);

    // Resolve column type + bare-variant set per the classification result.
    const columnType = mapping.kind === "ok" ? mapping.columnType : "text";
    const bareVariantNames = mapping.kind === "bare-enum" ? mapping.variants : [];

    includedFields.push({
      name: fieldName,
      columnType,
      validators,
      bareVariantNames,
    });
  }

  // Build the table-declaration body text.
  const tableName = codegen.pluralizeStructName(structTypeName);
  const expansion: import("./codegen/emit-schema-for.ts").SchemaForExpansion = {
    tableName,
    structName: structTypeName,
    includedFields,
    span,
  };
  const textBody = codegen.expandSchemaFor(expansion);

  // Annotate the call-node with the resolved metadata for diagnostics +
  // downstream consumers. The walker handles the AST splice.
  (call as Record<string, unknown>).schemaForStruct = structTypeName;
  (call as Record<string, unknown>).schemaForTableName = tableName;

  return { textBody };
}

/**
 * Walk the file's AST and process every schemaFor call. The walker handles
 * BOTH passes internally:
 *
 *   - When inside a `<schema>` state node's `children` array: a `logic` child
 *     whose body contains a schemaFor call is the canonical site. The call
 *     is validated; on success the entire `logic` child is replaced with a
 *     synthesized `text` node carrying the expanded table-declaration body.
 *   - Anywhere else: a schemaFor call is `E-SCHEMAFOR-INVALID-CALL-CONTEXT`.
 *
 * The two passes share the recognition predicate but emit different errors.
 */
function walkAndExpandSchemaForCalls(
  nodes: ASTNodeLike[],
  schemaForLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  structFieldRawClauses: Map<string, Map<string, string>>,
  errors: TSError[],
  filePath: string,
  defaultSpan: Span,
): void {
  // Track which call-nodes were already processed in a valid context so
  // Pass B (invalid-context) doesn't double-fire on them.
  const processedCalls = new WeakSet<object>();

  /**
   * Returns the schemaFor call-node found inside `logic` block body, if any.
   * The expected shape is:
   *   logic.body = [{ kind: "bare-expr", exprNode: { kind: "call", callee: {kind:"ident",name:"<local>"}, ... } }]
   * We accept bare-expr-only logic bodies (single CallExpression).
   */
  function findSchemaForCallInLogicBody(logicBody: unknown): ASTNodeLike | null {
    if (!Array.isArray(logicBody)) return null;
    // Find the single bare-expr (skipping incidental whitespace / no-op nodes).
    let bareExpr: ASTNodeLike | null = null;
    for (const n of logicBody) {
      if (!n || typeof n !== "object") continue;
      const nn = n as ASTNodeLike;
      if (nn.kind === "bare-expr") {
        if (bareExpr) return null;  // multiple statements — not a pure schemaFor interpolation
        bareExpr = nn;
      } else {
        // Any non-bare-expr in the logic body invalidates the "pure schemaFor interpolation" shape.
        return null;
      }
    }
    if (!bareExpr) return null;
    const expr = (bareExpr as ASTNodeLike).exprNode as ASTNodeLike | undefined;
    if (!expr || typeof expr !== "object") return null;
    if (expr.kind !== "call") return null;
    const callee = (expr as ASTNodeLike).callee as { kind?: string; name?: string } | undefined;
    if (!callee || callee.kind !== "ident" || typeof callee.name !== "string") return null;
    if (!schemaForLocals.has(callee.name)) return null;
    return expr;
  }

  /**
   * Pass A — walk `<schema>` state nodes' children; expand valid schemaFor
   * calls; on success splice the logic child with the synthesized text node.
   */
  function expandInSchemaChildren(schemaNode: ASTNodeLike): void {
    const children = schemaNode.children as ASTNodeLike[] | undefined;
    if (!Array.isArray(children)) return;
    // Walk forward and collect indices to splice. Logic-block replacement
    // is 1-to-1 (text node in place of logic), so simple in-place
    // replacement is safe without index re-anchoring.
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || typeof child !== "object") continue;
      if (child.kind !== "logic") continue;
      const callNode = findSchemaForCallInLogicBody(child.body);
      if (!callNode) continue;
      processedCalls.add(callNode as object);
      const result = _processSchemaForCallInSchemaContext(
        callNode as { args?: unknown[]; span?: Span } & Record<string, unknown>,
        typeRegistry,
        structFieldRawClauses,
        errors,
        defaultSpan,
      );
      if (!result) {
        // Validation failed; the error was already pushed. Leave the logic
        // child in place so codegen's defensive-fallback path fires (which
        // throws a clear error pointing the adopter back to the diagnostic).
        continue;
      }
      // Splice in the synthesized text node carrying the expanded table-
      // declaration body. The downstream schema-differ.js parser reads the
      // `<schema>` state's children as raw text + ignores non-text shapes,
      // so the text node is sufficient.
      const span = (callNode as ASTNodeLike).span ?? schemaNode.span ?? defaultSpan;
      const synthTextNode: ASTNodeLike = {
        id: ((child as { id?: number }).id ?? 0),
        kind: "text",
        value: result.textBody,
        span,
        _schemaForSynth: true,
      } as unknown as ASTNodeLike;
      children[i] = synthTextNode;
    }
  }

  /**
   * Outer walker — finds `<schema>` state nodes for Pass A, then descends
   * into children for nested searching, then runs Pass B on every remaining
   * (un-processed) schemaFor call elsewhere in the tree.
   */
  function walkPassA(arr: ASTNodeLike[] | undefined): void {
    if (!Array.isArray(arr)) return;
    for (const n of arr) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "state" && (n as ASTNodeLike).stateType === "schema") {
        expandInSchemaChildren(n);
      }
      // Recurse — schema blocks may nest (rare) and we also need to find
      // siblings deeper in the tree.
      const cChildren = (n as ASTNodeLike).children as ASTNodeLike[] | undefined;
      if (Array.isArray(cChildren)) walkPassA(cChildren);
      const cBody = (n as ASTNodeLike).body as ASTNodeLike[] | undefined;
      if (Array.isArray(cBody)) walkPassA(cBody);
    }
  }

  /**
   * Pass B — every schemaFor CallExpression NOT inside a `<schema>` block
   * is invalid context.
   */
  function walkPassB(arr: ASTNodeLike[] | undefined): void {
    if (!Array.isArray(arr)) return;
    for (const n of arr) {
      if (!n || typeof n !== "object") continue;

      // Walk ExprNode payloads via the standard forEachCallInExprNode helper.
      const EXPR_FIELDS = ["exprNode", "initExpr", "argsExpr", "condExpr", "headerExpr",
                            "iterExpr", "conditionExpr", "guardExpr", "valueExpr", "rhsExpr"];
      for (const f of EXPR_FIELDS) {
        const v = (n as Record<string, unknown>)[f];
        if (v && typeof v === "object") {
          try {
            forEachCallInExprNode(v as any, (call) => {
              if (processedCalls.has(call as unknown as object)) return;
              const callee = (call as { callee?: { kind?: string; name?: string } }).callee;
              if (!callee || callee.kind !== "ident" || typeof callee.name !== "string") return;
              if (!schemaForLocals.has(callee.name)) return;
              const span = ((call as { span?: Span }).span as Span | undefined) ?? defaultSpan;
              errors.push(new TSError(
                "E-SCHEMAFOR-INVALID-CALL-CONTEXT",
                `E-SCHEMAFOR-INVALID-CALL-CONTEXT: \`schemaFor(...)\` was called outside a \`<schema>\` block. ` +
                `The function-call form is canonical INSIDE \`<schema>\` blocks only (per OQ-SCH-1 + OQ-SCH-2 verdicts; the output is a table-declaration fragment that requires the \`<schema>\` parser context). ` +
                `Resolution: wrap the call inside a \`<schema>\${ schemaFor(...) }</>\` block. ` +
                `See SPEC §41.15.8.`,
                span,
              ));
            });
          } catch {
            // Defensive — forEachCallInExprNode is exhaustive per ExprNode kinds.
          }
        }
      }

      // Recurse through markup / logic structures. We DO NOT recurse into
      // `<schema>` blocks again — Pass A already handled them.
      if (n.kind === "state" && (n as ASTNodeLike).stateType === "schema") continue;

      const cChildren = (n as ASTNodeLike).children as ASTNodeLike[] | undefined;
      if (Array.isArray(cChildren)) walkPassB(cChildren);
      const cBody = (n as ASTNodeLike).body as ASTNodeLike[] | undefined;
      if (Array.isArray(cBody)) walkPassB(cBody);
    }
  }

  walkPassA(nodes);
  walkPassB(nodes);
}

// ---------------------------------------------------------------------------
// §41.16 — tableFor validation + AST rewrite helpers.
//
// Recognition + validation runs at the type-system stage per §53.14.5.
// The expander synthesizes a `<table>` + `<thead>` + `<tbody>` markup tree
// (cross-ref compiler/src/codegen/emit-table-for.ts) plus an optional sort-
// state cell when ANY `<column sortable>` is present.
//
// Architectural decisions:
//   - Markup-element form `<tableFor for=StructType rows=@cell ...>` (Form A
//     per OQ-TF-1 53/60 verdict; mirrors formFor §41.14 shape).
//   - Single-pass walker: tableFor elements are top-level markup; no schemaFor-
//     style two-pass context discrimination needed.
//   - <column>/<empty> are tableFor-local children (NOT §16 component slots) —
//     parsed via the walker's direct child inspection.
//   - 13 normative error codes per §41.16.1-§41.16.9.
// ---------------------------------------------------------------------------

/**
 * Extract the bare cell-variable name from a rows= expression.
 *
 *   "@users"                  → "users"
 *   "@items.filter(p)"        → "items"
 *   "@all.slice(0,10)"        → "all"
 *   "@records.map(f).sort(g)" → "records"
 *   "users"                   → null   (not an @-rooted cell-ref)
 *   "[]"                      → null   (literal array)
 *
 * Returns the bare cell-var name on success; null when the expression has no
 * `@<ident>` root form. Used to derive the sort-state synth-cell name.
 */
function _tfExtractRowsCellName(rowsExpr: string): string | null {
  if (!rowsExpr) return null;
  const trimmed = rowsExpr.trim();
  if (!trimmed.startsWith("@")) return null;
  // Match `@<ident>` (ident may continue but we want the bare root before any .).
  const m = trimmed.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (!m) return null;
  return m[1];
}

/**
 * Process a single `<tableFor>` AST node — validate per §41.16.1-§41.16.9
 * and build the TableForExpansion plan. Returns the synthesized AST replacements
 * on success, null on validation failure (errors already pushed).
 *
 * Implementation note: this function is invoked by the walker for each
 * `<tableFor>` element; the walker handles the AST splice once a valid
 * expansion is produced.
 */
function _processTableForNode(
  node: ASTNodeLike,
  typeRegistry: Map<string, ResolvedType>,
  structFieldRawClauses: Map<string, Map<string, string>>,
  errors: TSError[],
  defaultSpan: Span,
): { sortStateDecl: unknown | null; tableElement: unknown } | null {
  // Late-load the expander module to avoid a static cycle.
  const codegen = require("./codegen/emit-table-for.ts") as typeof import("./codegen/emit-table-for.ts");
  const span = ((node.span as Span | undefined) ?? defaultSpan);
  const attrs = (node.attrs as ASTNodeLike[] | undefined) ?? (node.attributes as ASTNodeLike[] | undefined);

  // §41.16.1 — Validate `for=` attribute.
  const forAttr = _ffGetAttrRawValue(attrs, "for");
  if (!forAttr || !forAttr.rawValue) {
    errors.push(new TSError(
      "E-TABLEFOR-TYPE-NOT-STRUCT",
      `E-TABLEFOR-TYPE-NOT-STRUCT: \`<tableFor for=...>\` is missing the required \`for=\` attribute. ` +
      `The \`for=\` attribute SHALL be a bare scrml-native \`:struct\` type identifier — e.g. \`<tableFor for=User rows=@users/>\`. ` +
      `See SPEC §41.16.1.`,
      forAttr?.span ?? span,
    ));
    return null;
  }
  if (forAttr.valueKind === "string-literal") {
    errors.push(new TSError(
      "E-TABLEFOR-TYPE-NOT-STRUCT",
      `E-TABLEFOR-TYPE-NOT-STRUCT: \`<tableFor for=...>\` was given a quoted string value '"${forAttr.rawValue}"'. ` +
      `The \`for=\` attribute SHALL be a bare scrml-native \`:struct\` type identifier — not a string literal. ` +
      `Example: \`<tableFor for=User rows=@users/>\` (NOT \`<tableFor for="User"/>\`). See SPEC §41.16.1.`,
      forAttr.span ?? span,
    ));
    return null;
  }
  const structTypeName = forAttr.rawValue;
  const resolved = _resolveAndCheckL22TypeName(structTypeName, "struct", typeRegistry, errors, {
    code: "E-TABLEFOR-TYPE-NOT-STRUCT",
    unknownMessage:
      `E-TABLEFOR-TYPE-NOT-STRUCT: \`<tableFor for=${structTypeName}>\` references unknown type '${structTypeName}'. ` +
      `The \`for=\` attribute must name a scrml-native \`:struct\` type declared in this file ` +
      `(or imported via \`\${ import { ${structTypeName} } from './path.scrml' }\`). See SPEC §41.16.1.`,
    wrongKindMessage: (kind) =>
      `E-TABLEFOR-TYPE-NOT-STRUCT: \`<tableFor for=${structTypeName}>\` references type '${structTypeName}' which is a ${kind}, not a struct. ` +
      `\`tableFor\` only accepts scrml-native \`:struct\` types — the field set is what drives the auto-generated columns. ` +
      `For enum-shape boundary parsing, use \`parseVariant\` (§41.13); for form generation, use \`formFor\` (§41.14); for SQL DDL generation, use \`schemaFor\` (§41.15). See SPEC §41.16.1.`,
    span: forAttr.span ?? span,
  });
  if (!resolved) return null;
  const structType = resolved as StructType;

  // §41.16.2 — Validate `rows=` attribute.
  const rowsAttr = _ffGetAttrRawValue(attrs, "rows");
  if (!rowsAttr || !rowsAttr.rawValue) {
    errors.push(new TSError(
      "E-TABLEFOR-ROWS-MISSING",
      `E-TABLEFOR-ROWS-MISSING: \`<tableFor for=${structTypeName}/>\` omits the required \`rows=\` attribute. ` +
      `Add \`rows=@cellOrExpr\` where the expression resolves to '${structTypeName}[]'. ` +
      `See SPEC §41.16.2.`,
      rowsAttr?.span ?? span,
    ));
    return null;
  }
  // The rows expression is consumed verbatim into the synth for-loop. For v1.0
  // the type-check of `rows=` against `StructType[]` is delegated to the regular
  // type-system pass once the synth for-loop sees the iterable in expression
  // position — string-literal misuse is rejected here as a structural shape.
  if (rowsAttr.valueKind === "string-literal") {
    errors.push(new TSError(
      "E-TABLEFOR-ROWS-WRONG-TYPE",
      `E-TABLEFOR-ROWS-WRONG-TYPE: \`<tableFor rows=...>\` was given a quoted string value '"${rowsAttr.rawValue}"'. ` +
      `The \`rows=\` attribute SHALL evaluate to an array of '${structTypeName}' values — e.g. \`rows=@users\` or \`rows=@items.filter(p)\`. ` +
      `See SPEC §41.16.2.`,
      rowsAttr.span ?? span,
    ));
    return null;
  }
  const rowsExpr = rowsAttr.rawValue;
  const rowsCellVarName = _tfExtractRowsCellName(rowsExpr);

  // §41.16.5 — Validate pick=/omit=.
  const pickAttr = _ffGetAttrRawValue(attrs, "pick");
  const omitAttr = _ffGetAttrRawValue(attrs, "omit");
  if (pickAttr && omitAttr) {
    errors.push(new TSError(
      "E-TABLEFOR-PICK-OMIT-CONFLICT",
      `E-TABLEFOR-PICK-OMIT-CONFLICT: \`<tableFor>\` was given BOTH \`pick=\` AND \`omit=\` attributes. ` +
      `The two are mutually exclusive — \`pick=\` names the only fields to render; \`omit=\` names fields to exclude. ` +
      `Resolution: choose one. See SPEC §41.16.5.`,
      span,
    ));
    return null;
  }
  let pickList: string[] | null = null;
  if (pickAttr && pickAttr.rawValue) {
    pickList = _ffParseStringArray(pickAttr.rawValue);
    if (!pickList) {
      errors.push(new TSError(
        "E-TABLEFOR-PICK-INVALID-FIELD",
        `E-TABLEFOR-PICK-INVALID-FIELD: \`<tableFor pick=...>\` value '${pickAttr.rawValue}' is not a recognized array-of-strings literal. ` +
        `Use the form \`pick=["fieldA", "fieldB"]\` with bare field-name strings. See SPEC §41.16.5.`,
        pickAttr.span ?? span,
      ));
      return null;
    }
    for (const fieldName of pickList) {
      if (!structType.fields.has(fieldName)) {
        errors.push(new TSError(
          "E-TABLEFOR-PICK-INVALID-FIELD",
          `E-TABLEFOR-PICK-INVALID-FIELD: \`<tableFor for=${structTypeName} pick=[...]>\` references field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
          `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.16.5.`,
          pickAttr.span ?? span,
        ));
        return null;
      }
    }
  }
  let omitList: string[] | null = null;
  if (omitAttr && omitAttr.rawValue) {
    omitList = _ffParseStringArray(omitAttr.rawValue);
    if (!omitList) {
      errors.push(new TSError(
        "E-TABLEFOR-OMIT-INVALID-FIELD",
        `E-TABLEFOR-OMIT-INVALID-FIELD: \`<tableFor omit=...>\` value '${omitAttr.rawValue}' is not a recognized array-of-strings literal. ` +
        `Use the form \`omit=["fieldA", "fieldB"]\` with bare field-name strings. See SPEC §41.16.5.`,
        omitAttr.span ?? span,
      ));
      return null;
    }
    for (const fieldName of omitList) {
      if (!structType.fields.has(fieldName)) {
        errors.push(new TSError(
          "E-TABLEFOR-OMIT-INVALID-FIELD",
          `E-TABLEFOR-OMIT-INVALID-FIELD: \`<tableFor for=${structTypeName} omit=[...]>\` references field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
          `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.16.5.`,
          omitAttr.span ?? span,
        ));
        return null;
      }
    }
  }

  // §41.16.8 — Validate selectable= + selectedBy=.
  const selectableAttr = _ffGetAttrRawValue(attrs, "selectable");
  const selectedByAttr = _ffGetAttrRawValue(attrs, "selectedBy");
  let selection: import("./codegen/emit-table-for.ts").TableForSelectionInfo | null = null;
  if (selectableAttr && selectableAttr.rawValue) {
    const selectableRef = selectableAttr.rawValue.startsWith("@")
      ? selectableAttr.rawValue.slice(1)
      : selectableAttr.rawValue;
    // PK field — default "id"; overridden via selectedBy=.
    let pkFieldName = "id";
    if (selectedByAttr && selectedByAttr.rawValue) {
      pkFieldName = selectedByAttr.rawValue;
    }
    // Validate PK field exists.
    if (!structType.fields.has(pkFieldName)) {
      // Special case the default "id" → fire E-TABLEFOR-NO-PRIMARY-KEY with the canonical message.
      if (pkFieldName === "id") {
        errors.push(new TSError(
          "E-TABLEFOR-NO-PRIMARY-KEY",
          `E-TABLEFOR-NO-PRIMARY-KEY: \`<tableFor for=${structTypeName} selectable=@${selectableRef}/>\` has no \`id\` field on struct '${structTypeName}' AND no \`selectedBy=\` override was provided. ` +
          `The selection surface needs a primary-key field to track which rows are selected. ` +
          `Resolution: add an \`id\` field to the struct, OR add \`selectedBy="<some-other-field>"\` to the \`<tableFor>\` naming the PK field explicitly. ` +
          `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.16.8.`,
          selectableAttr.span ?? span,
        ));
      } else {
        errors.push(new TSError(
          "E-TABLEFOR-NO-PRIMARY-KEY",
          `E-TABLEFOR-NO-PRIMARY-KEY: \`<tableFor for=${structTypeName} selectedBy="${pkFieldName}"/>\` names PK field '${pkFieldName}' which is not present on struct '${structTypeName}'. ` +
          `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.16.8.`,
          selectedByAttr?.span ?? span,
        ));
      }
      return null;
    }
    // E-TABLEFOR-SELECTABLE-CELL-WRONG-TYPE — we'd need to resolve the cell's
    // declared type via the file's stateTypeRegistry to compare against
    // <pkFieldType>[]. The stateTypeRegistry is not threaded into this helper
    // for v1.0 — the regular type-system pass downstream will catch type
    // mismatches via the synthesized `${@cell.includes(row.id)}` expressions
    // (the array's element type vs the row PK's type). This is a known
    // FOLLOWUP (§41.16.8 P2 — strict pre-emit type-check) but doesn't block
    // the surface. We emit the diagnostic gate only when we have the data;
    // here we accept the cell and trust the downstream type-checker.
    selection = { cellName: selectableRef, pkFieldName };
  }

  // Walk children: collect <column> + <empty> slots.
  const childNodes = (node.children as ASTNodeLike[] | undefined) ?? [];
  const columnNodes: ASTNodeLike[] = [];
  let emptySlot: unknown[] | null = null;
  let emptySlotCount = 0;
  for (const child of childNodes) {
    if (!child || typeof child !== "object") continue;
    if (child.kind !== "markup") continue;
    const tag = (child.tag as string | undefined) ?? ((child as ASTNodeLike).tagName as string | undefined);
    if (tag === "column") {
      columnNodes.push(child);
    } else if (tag === "empty") {
      emptySlotCount++;
      emptySlot = (child.children as unknown[] | undefined) ?? [];
    }
  }
  // Multiple <empty> slots — invalid (§41.16.9).
  if (emptySlotCount > 1) {
    errors.push(new TSError(
      "E-TABLEFOR-COLUMN-FIELD-UNKNOWN",  // closest applicable; the SPEC §41.16.9 cites "parser error per §16"
      `Multiple \`<empty>\` slots on \`<tableFor for=${structTypeName}>\` — the empty-slot is unique per §41.16.9. ` +
      `Resolution: remove the duplicate \`<empty>\` block(s).`,
      span,
    ));
    return null;
  }

  // §41.16.3 — Build per-column overrides.
  const columnOverrides = new Map<string, {
    headerText: string | null;
    slotBody: unknown[];
    rowBindingName: string;
    sortable: boolean;
    align: "left" | "right" | "center" | null;
    cssClass: string | null;
  }>();
  for (const colNode of columnNodes) {
    const colAttrs = (colNode.attrs as ASTNodeLike[] | undefined) ?? (colNode.attributes as ASTNodeLike[] | undefined);
    const fieldAttr = _ffGetAttrRawValue(colAttrs, "field");
    if (!fieldAttr || !fieldAttr.rawValue) {
      // <column> without field= — surface as invalid-field with hint.
      errors.push(new TSError(
        "E-TABLEFOR-COLUMN-FIELD-UNKNOWN",
        `E-TABLEFOR-COLUMN-FIELD-UNKNOWN: A \`<column>\` slot inside \`<tableFor for=${structTypeName}>\` is missing the required \`field="<fieldName>"\` attribute. ` +
        `Each \`<column>\` must name a struct field. Positional + computed-column slots are RESERVED for v1.next. ` +
        `See SPEC §41.16.3.`,
        (colNode.span as Span | undefined) ?? span,
      ));
      return null;
    }
    const fieldName = fieldAttr.rawValue;
    if (!structType.fields.has(fieldName)) {
      errors.push(new TSError(
        "E-TABLEFOR-COLUMN-FIELD-UNKNOWN",
        `E-TABLEFOR-COLUMN-FIELD-UNKNOWN: \`<tableFor for=${structTypeName}>\` contains a \`<column field="${fieldName}">\` slot referencing field '${fieldName}' which is not present on struct '${structTypeName}'. ` +
        `Declared fields: ${[...structType.fields.keys()].join(", ")}. See SPEC §41.16.3.`,
        (colNode.span as Span | undefined) ?? span,
      ));
      return null;
    }
    const headerAttr = _ffGetAttrRawValue(colAttrs, "header");
    const sortableAttr = _ffGetAttrRawValue(colAttrs, "sortable");
    const alignAttr = _ffGetAttrRawValue(colAttrs, "align");
    const classAttr = _ffGetAttrRawValue(colAttrs, "class");
    const letAttr = _ffGetAttrRawValue(colAttrs, ":let");

    // :let="(row) => ..." — extract binding name from the lambda head. v1.0
    // syntax accepted: `(name) => ...` OR bare `name` (no parens). We pull the
    // first ident from the value.
    let rowBindingName = "row";
    if (letAttr && letAttr.rawValue) {
      // Strip leading "(" if present; pull first ident.
      let s = letAttr.rawValue.trim();
      if (s.startsWith("(")) s = s.slice(1).trim();
      const m = s.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m) rowBindingName = m[1];
    }
    // Sortable is a boolean-flag attribute — present means true.
    const sortable = !!(sortableAttr && (
      sortableAttr.valueKind === "boolean-flag"
      || sortableAttr.rawValue === "true"
      || sortableAttr.rawValue === ""   // bare flag form
      || sortableAttr.valueKind === "absent"
    ));
    const align = (alignAttr?.rawValue === "left" || alignAttr?.rawValue === "right" || alignAttr?.rawValue === "center")
      ? alignAttr.rawValue as "left" | "right" | "center"
      : null;
    const cssClass = classAttr?.rawValue || null;

    columnOverrides.set(fieldName, {
      headerText: headerAttr?.rawValue || null,
      slotBody: (colNode.children as unknown[] | undefined) ?? [],
      rowBindingName,
      sortable,
      align,
      cssClass,
    });
  }

  // §41.16.5 — Compute the included field set.
  const allFieldNames = [...structType.fields.keys()];
  let includedFieldNames: string[];
  if (pickList) {
    includedFieldNames = pickList;
  } else if (omitList) {
    const omitSet = new Set(omitList);
    includedFieldNames = allFieldNames.filter(f => !omitSet.has(f));
  } else {
    includedFieldNames = allFieldNames;
  }

  // §41.16.6 — Build TableForColumnInfo per included field; validate display-mapping.
  // Per formFor + schemaFor precedent: the struct-body parser drops trailing
  // validator predicates and lowers `email: string req length(<=120)` to `asIs`.
  // We recover the actual base-type by re-parsing the leading token of the raw
  // clause text and re-resolving through typeRegistry. Mirrors
  // _processSchemaForCallInSchemaContext (lines 10718-10741).
  const rawClauses = structFieldRawClauses.get(structTypeName) ?? new Map<string, string>();
  const columns: import("./codegen/emit-table-for.ts").TableForColumnInfo[] = [];
  let hasSortable = false;
  for (const fieldName of includedFieldNames) {
    let fieldType = structType.fields.get(fieldName) as unknown;
    if (!fieldType) continue;
    const ftKind = (fieldType && typeof fieldType === "object")
      ? ((fieldType as { kind?: string }).kind ?? "unknown")
      : "unknown";
    if (ftKind === "asIs" || ftKind === "unknown") {
      const clauseRaw = rawClauses.get(fieldName) ?? "";
      const m = clauseRaw.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m) {
        const tokenName = m[1];
        const r = typeRegistry.get(tokenName);
        if (r) fieldType = r;
      }
    }
    const override = columnOverrides.get(fieldName);
    const hasExplicitSlot = !!(override && override.slotBody && (override.slotBody as unknown[]).length > 0);
    const displayKind = codegen.classifyFieldForCell(fieldType);

    // Errors are suppressed when an explicit slot body is provided (the adopter
    // is telling us how to render the otherwise-unmappable type).
    if (!hasExplicitSlot) {
      if (displayKind.kind === "nested-struct") {
        errors.push(new TSError(
          "E-TABLEFOR-NESTED-STRUCT-NO-SLOT",
          `E-TABLEFOR-NESTED-STRUCT-NO-SLOT: \`<tableFor for=${structTypeName}>\` has a struct-typed field '${fieldName}' (type '${displayKind.structName}') AND no explicit \`<column field="${fieldName}">\` slot override was provided. ` +
          `Auto-recurse into nested struct fields is out-of-scope for v1.0 (mirror formFor §41.14.8 OQ-FF-11 v1.0 disposition). ` +
          `Resolution: provide a \`<column field="${fieldName}">\` slot body that renders the nested struct (e.g., \`\${row.${fieldName}.street}, \${row.${fieldName}.city}\`), OR exclude the field via \`omit=["${fieldName}"]\`. ` +
          `See SPEC §41.16.6.`,
          span,
        ));
        return null;
      }
      if (displayKind.kind === "payload-enum") {
        errors.push(new TSError(
          "E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1",
          `E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1: \`<tableFor for=${structTypeName}>\` has field '${fieldName}' typed as a payload-bearing enum '${displayKind.enumName}' (one or more variants carry payload data). ` +
          `v1.0 has no default rendering for payload variants. ` +
          `Resolution: provide an explicit \`<column field="${fieldName}">\` slot body with adopter-authored payload rendering, OR refactor to a bare-variant enum if the payload is not load-bearing, OR exclude via \`omit=["${fieldName}"]\`. ` +
          `See SPEC §41.16.6.`,
          span,
        ));
        return null;
      }
      if (displayKind.kind === "unmappable") {
        errors.push(new TSError(
          "E-TABLEFOR-NO-DISPLAY-MAPPING",
          `E-TABLEFOR-NO-DISPLAY-MAPPING: \`<tableFor for=${structTypeName}>\` has field '${fieldName}' whose declared type (${displayKind.typeKind}) has no v1.0 display mapping. ` +
          `Unmappable shapes include function types, snippet types, Promise types, foreign-code types, deep-reactive proxy types, arrays, and arbitrary opaque types. ` +
          `Resolution: exclude the field via \`omit=["${fieldName}"]\`, OR provide an explicit \`<column field="${fieldName}">\` slot body with adopter-authored rendering, OR refactor the struct to use a renderable type. ` +
          `See SPEC §41.16.6.`,
          span,
        ));
        return null;
      }
    }

    // Build the column descriptor.
    const headerText = override?.headerText ?? codegen.tableHeaderTitleCase(fieldName);
    const sortable = !!override?.sortable;
    if (sortable) hasSortable = true;
    columns.push({
      fieldName,
      headerText,
      displayKind,
      slotBody: hasExplicitSlot ? (override!.slotBody as unknown[]) : null,
      rowBindingName: override?.rowBindingName ?? "row",
      sortable,
      align: override?.align ?? null,
      cssClass: override?.cssClass ?? null,
    });
  }

  // §41.16.7 — Sort surface requires rows= to be a cell reference.
  if (hasSortable && !rowsCellVarName) {
    errors.push(new TSError(
      "E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS",
      `E-TABLEFOR-SORTABLE-REQUIRES-CELL-ROWS: \`<tableFor for=${structTypeName} rows=${rowsExpr}>\` has at least one \`<column sortable>\` but the \`rows=\` expression is not a cell reference (no \`@\`-root). ` +
      `The sort surface synthesizes a state cell named after the rows source, which requires \`rows=@<varName>\` (with optional \`.method()\` chains). ` +
      `Resolution: hoist the rows expression into a reactive cell (\`<rows> = ...\` then \`rows=@rows\`), OR remove the \`sortable\` attribute from \`<column>\` slots if external sort is not needed. ` +
      `See SPEC §41.16.7.`,
      span,
    ));
    return null;
  }

  // Build the expansion plan + invoke the expander.
  const expansion: import("./codegen/emit-table-for.ts").TableForExpansion = {
    structName: structTypeName,
    rowsExpr,
    rowsCellVarName,
    columns,
    hasSortable,
    selection,
    emptySlot,
    span,
  };
  const { sortStateDecl, tableElement } = codegen.expandTableForElement(expansion);
  return { sortStateDecl, tableElement };
}

/**
 * Walk the file's AST and find every `<tableFor>` markup-element node;
 * validate per §41.16.1-§41.16.9; on success, rewrite the parent's children
 * array to splice in the synthesized sort-state-decl (if any) + <table>
 * markup tree.
 *
 * Parent threading: we cannot rely on parent backrefs (AST construction
 * doesn't populate them). Instead, the walker iterates over each parent's
 * `children`/`body` array and detects tableFor children itself, splicing in
 * the synthesized nodes when a match is found.
 */
function walkAndExpandTableForNodes(
  nodes: ASTNodeLike[],
  tableForLocals: Set<string>,
  typeRegistry: Map<string, ResolvedType>,
  structFieldRawClauses: Map<string, Map<string, string>>,
  errors: TSError[],
  _filePath: string,
  defaultSpan: Span,
): void {
  void _filePath;
  void tableForLocals;  // not needed during walking — the markup tag is the gate

  function walkAndSplice(arr: ASTNodeLike[] | undefined): void {
    if (!Array.isArray(arr)) return;
    // Walk in reverse so splice insertions don't disturb forward indices for
    // siblings we haven't visited. Each tableFor child expands to 1-2 nodes.
    for (let i = arr.length - 1; i >= 0; i--) {
      const child = arr[i];
      if (!child || typeof child !== "object") continue;
      if (child.kind === "markup") {
        const tag = (child.tag as string | undefined)
          ?? ((child as ASTNodeLike).tagName as string | undefined);
        if (tag === "tableFor" || tag === "tablefor") {
          const synth = _processTableForNode(child, typeRegistry, structFieldRawClauses, errors, defaultSpan);
          if (synth) {
            // Splice: sortStateDecl (if any) + tableElement in place of the original node.
            const replacements: ASTNodeLike[] = [];
            if (synth.sortStateDecl) replacements.push(synth.sortStateDecl as ASTNodeLike);
            replacements.push(synth.tableElement as ASTNodeLike);
            arr.splice(i, 1, ...replacements);
          }
          continue;  // do not recurse into the tableFor's children (they're consumed)
        }
      }
      // Recurse into children + body of non-tableFor nodes.
      const cChildren = (child as ASTNodeLike).children as ASTNodeLike[] | undefined;
      if (Array.isArray(cChildren)) walkAndSplice(cChildren);
      const cBody = (child as ASTNodeLike).body as ASTNodeLike[] | undefined;
      if (Array.isArray(cBody)) walkAndSplice(cBody);
    }
  }

  walkAndSplice(nodes);
}

// ---------------------------------------------------------------------------
// Per-file processor
// ---------------------------------------------------------------------------

function processFile(
  fileAST: FileAST,
  protectAnalysis: ProtectAnalysis,
  routeMap: RouteMap,
  importedTypes?: Map<string, ResolvedType>,
): { typedAst: TypedFileAST; errors: TSError[]; stateTypeRegistry: Map<string, ResolvedType> } {
  const errors: TSError[] = [];

  const filePath = fileAST.filePath;
  const fileSpan: Span = { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  // TS-B Step 1: Build the file-level type registry from type declarations.
  // CE output shape nests data under fileAST.ast — use dual-shape fallback.
  const typeDecls = (fileAST.typeDecls as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.typeDecls as ASTNodeLike[] | undefined)
    ?? [];
  const typeRegistry = buildTypeRegistry(typeDecls, errors, fileSpan);

  // TS-B Step 1.2: Seed type registry with imported types from dependency files (§21.3).
  // When file B imports type TaskStatus from file A, TS must recognize TaskStatus
  // during match exhaustiveness checks, type annotations, and struct field access.
  // importedTypes is built in api.js after processing each dependency in topo order.
  if (importedTypes && importedTypes.size > 0) {
    for (const [name, type] of importedTypes) {
      // Local declarations always win — only seed if not already declared locally.
      if (!typeRegistry.has(name) || typeRegistry.get(name)?.kind === 'unknown') {
        typeRegistry.set(name, type);
      }
    }
  }

  // TS-B Step 1.5: Build the state type registry.
  const stateTypeRegistry = buildStateTypeRegistry();

  // §51.3: Build the machine registry from engine-decl AST nodes.
  // CE output shape nests data under fileAST.ast — use dual-shape fallback.
  const machineDecls = (fileAST.machineDecls as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.machineDecls as ASTNodeLike[] | undefined)
    ?? [];
  const machineRegistry = buildMachineRegistry(machineDecls, typeRegistry, errors, fileSpan);

  // TS-B Step 2: Generate db-schema-derived types from ProtectAnalysis.
  const generatedTypesByScopeId = new Map<string, Map<string, { fullType: ResolvedType; clientType: ResolvedType }>>();

  if (protectAnalysis && protectAnalysis.views) {
    for (const [stateBlockId, dbTypeViews] of protectAnalysis.views) {
      if (!stateBlockId.startsWith(filePath + "::")) continue;

      const spanStart = parseInt(stateBlockId.split("::")[1] ?? "0", 10);
      const blockSpan: Span = { file: filePath, start: spanStart, end: spanStart, line: 1, col: 1 };

      const { generatedNames, errors: genErrors } = generateDbTypes(
        dbTypeViews,
        stateBlockId,
        blockSpan,
        typeRegistry,
      );

      errors.push(...genErrors);
      generatedTypesByScopeId.set(stateBlockId, generatedNames);
    }
  }

  // TS-A Step 1: Build the scope chain.
  const scopeChain = new ScopeChain();

  // Seed the global scope with all user-declared types from this file.
  for (const [name, type] of typeRegistry) {
    if (!BUILTIN_TYPES.has(name)) {
      scopeChain.global.bind(name, { kind: "type", resolvedType: type });
    }
  }

  // TS-A/TS-B Step 2: Walk the AST and annotate every node.
  const nodeTypes = annotateNodes(
    fileAST,
    scopeChain,
    typeRegistry,
    routeMap,
    protectAnalysis,
    generatedTypesByScopeId,
    errors,
    stateTypeRegistry,
    machineRegistry,
  );

  // §51.9 — After annotation, collect the reactive → machine bindings that
  // `annotateNodes` attached to state-decl nodes and validate every
  // derived machine's source-var reference + exhaustiveness (E-ENGINE-018).
  {
    const reactiveBindings = new Map<string, MachineType>();
    const collectReactiveBindings = (nodes: ASTNodeLike[]): void => {
      for (const n of nodes) {
        if (!n || typeof n !== "object") continue;
        if (n.kind === "state-decl" && n.name && (n as ASTNodeLike).machineBinding) {
          const mName = (n as ASTNodeLike).machineBinding as string;
          const m = machineRegistry.get(mName);
          if (m) reactiveBindings.set(n.name as string, m);
        }
        const body = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(body)) collectReactiveBindings(body);
        const children = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(children)) collectReactiveBindings(children);
      }
    };
    const topNodes = (fileAST.nodes as ASTNodeLike[] | undefined)
      ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
      ?? [];
    collectReactiveBindings(topNodes);

    // Bug 2 (v0.2.3, §51.0.C + §51.9) — Engine auto-declared variables are
    // machine-bound reactive cells per §51.0.C (Move 16): `<engine for=T ...>`
    // auto-declares a cell of type T named (a) `var=`-override if present,
    // (b) else lowercase-first of the type name. `validateDerivedMachines`
    // must see those auto-declared cells via `reactiveBindings` or it false-
    // fires E-ENGINE-004 when one engine declares `derived=@autoVar` over
    // another engine's auto-declared variable (e.g.,
    // `<engine for=HealthRisk derived=@marioState>` after
    // `<engine for=MarioState ...>`).
    //
    // The pre-S84 collector only walked `state-decl` nodes with an explicit
    // `.machineBinding` (the legacy `<phase>: Phase = ...` shape), which never
    // populates for auto-declared engine cells. This loop mirrors Bug 9's
    // scope-chain pre-bind pattern at type-system.ts:5694-5704 — same
    // registry, same guard semantics:
    //   - Include derived engines too: `validateDerivedMachines` needs them
    //     in `reactiveBindings` so its `sourceMachine.isDerived` check can
    //     fire the §51.9.7 transitive-projection rejection message. Skipping
    //     derived engines here would silently downgrade §51.9.7 to a generic
    //     "unknown source variable" error.
    //   - SHALL-NOT-overwrite: if an explicit state-decl already claimed the
    //     name with a `.machineBinding`, that's E-ENGINE-VAR-DUPLICATE
    //     territory at SYM PASS 10.A; skip rather than overwrite so the SYM-
    //     layer diagnostic surfaces uncontested.
    for (const machine of machineRegistry.values()) {
      const varName = machine.name;
      if (typeof varName !== "string" || varName.length === 0) continue;
      if (reactiveBindings.has(varName)) continue;
      reactiveBindings.set(varName, machine);
    }

    validateDerivedMachines(machineRegistry, reactiveBindings, errors, fileSpan);

    // §51.11 — E-ENGINE-019: validate every machine's audit target against
    // the set of declared reactive variables. Collect every reactive name
    // (machine-bound or plain) by walking top-level state-decl / derived-
    // decl / debounced-decl nodes. An audit clause referencing an unknown
    // @var fires E-ENGINE-019; pointing at a derived (projected) var also
    // errors since those are read-only (§51.9, E-ENGINE-017 family).
    const declaredReactives = new Set<string>();
    const collectReactives = (nodes: ASTNodeLike[]): void => {
      for (const n of nodes) {
        if (!n || typeof n !== "object") continue;
        // S79 — reactive-debounced-decl AST kind retired; debounced cells now
        // ride on state-decl with a `reactivity` field (SPEC §6.13). state-decl
        // alone covers the audit-collection surface.
        if (n.kind === "state-decl" && typeof n.name === "string") {
          declaredReactives.add(n.name);
        }
        const body = n.body as ASTNodeLike[] | undefined;
        if (Array.isArray(body)) collectReactives(body);
        const children = n.children as ASTNodeLike[] | undefined;
        if (Array.isArray(children)) collectReactives(children);
      }
    };
    collectReactives(topNodes);
    for (const [engineName, machine] of machineRegistry) {
      const audit = machine.auditTarget;
      if (!audit) continue;
      if (!declaredReactives.has(audit)) {
        errors.push(new TSError(
          "E-ENGINE-019",
          `E-ENGINE-019: Machine '${engineName}' audit clause references '@${audit}', ` +
          `but no reactive variable with that name is declared in scope. ` +
          `Declare '@${audit} = []' before the machine, or correct the audit target name.`,
          fileSpan,
        ));
      }
    }

    // §51.9 — E-ENGINE-017: reject writes to projected vars. Build a lookup
    // from projected-var-name → derived-machine so error messages can name
    // the source var + machine in the message.
    const projectedVars = new Map<string, MachineType>();
    for (const m of machineRegistry.values()) {
      if (m.isDerived && m.projectedVarName) projectedVars.set(m.projectedVarName, m);
    }
    rejectWritesToDerivedVars(topNodes, projectedVars, errors, fileSpan);

    // §51.14 (S27 G2 slice 2) — validate `replay(@target, @log[, n])` call
    // sites. The rewrite path in emit-expr.ts already emits _scrml_replay for
    // well-formed calls; this validation catches malformed calls at compile
    // time with diagnostic spans.
    //
    //   E-REPLAY-001: @target is not a machine-bound reactive.
    //   E-REPLAY-002: @log is not a declared reactive variable.
    //
    // A generic recursive object-walker visits every node under topNodes
    // looking for CallExpr shapes (kind === "call") whose callee is an
    // ident "replay". CallExprs live embedded in various fields
    // (initExpr, valueExpr, conditionExpr, function-decl body statements'
    // bare-expr exprNode, etc.). The duck-typed walker reaches them all
    // without needing to know the layout of every AST node kind.
    const machineBoundReactives = new Set(reactiveBindings.keys());
    // §51.14 (S28) — E-REPLAY-003 prep: reverse map from audit-target reactive
    // name to the owning machine. When `replay(@target, @log)` is called and
    // @log is the audit target of some machine M, @target's machine MUST also
    // be M (or `replay` is operating across-machines, which §51.14.6 calls
    // semantically nonsensical).
    const auditTargetToMachine = new Map<string, string>();
    for (const [engineName, machine] of machineRegistry) {
      const at = machine.auditTarget;
      if (at) auditTargetToMachine.set(at, engineName);
    }
    const visited = new WeakSet<object>();
    const visitForReplay = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (visited.has(value as object)) return;
      visited.add(value as object);
      if (Array.isArray(value)) {
        for (const item of value) visitForReplay(item);
        return;
      }
      const v = value as Record<string, unknown>;
      if (v.kind === "call" && v.callee && typeof v.callee === "object") {
        const callee = v.callee as Record<string, unknown>;
        if (callee.kind === "ident" && callee.name === "replay") {
          const args = (v.args as unknown[]) ?? [];
          const span = (v.span as Span | undefined) ?? fileSpan;
          const targetArg = args[0] as Record<string, unknown> | undefined;
          const logArg = args[1] as Record<string, unknown> | undefined;
          const argShape = (a: unknown): { name: string } | null => {
            if (!a || typeof a !== "object") return null;
            const ar = a as Record<string, unknown>;
            if (ar.kind !== "ident") return null;
            const nm = ar.name;
            if (typeof nm !== "string" || !nm.startsWith("@")) return null;
            return { name: nm.slice(1) };
          };
          const target = argShape(targetArg);
          const log = argShape(logArg);
          if (!target) {
            errors.push(new TSError(
              "E-REPLAY-001",
              `E-REPLAY-001: Replay target must be a machine-bound reactive variable (@name). ` +
              `The first argument to 'replay' accepts an '@'-prefixed reactive that is ` +
              `governed by a < machine> declaration; the current argument is not an @-ref.`,
              span,
            ));
          } else if (!machineBoundReactives.has(target.name)) {
            const isDeclaredReactive = declaredReactives.has(target.name);
            errors.push(new TSError(
              "E-REPLAY-001",
              `E-REPLAY-001: Replay target '@${target.name}' must be a machine-bound reactive variable. ` +
              (isDeclaredReactive
                ? `'@${target.name}' is declared but is not governed by a < machine> declaration. ` +
                  `Attach a machine to this reactive or replay a different variable.`
                : `No reactive variable named '@${target.name}' is declared in scope. ` +
                  `Declare '@${target.name}: <MachineName> = <initial>' before the replay call.`),
              span,
            ));
          }
          if (!log) {
            errors.push(new TSError(
              "E-REPLAY-002",
              `E-REPLAY-002: Replay source must be a reactive array variable (@name). ` +
              `The second argument to 'replay' accepts an '@'-prefixed reactive that carries ` +
              `§51.11 audit entries; the current argument is not an @-ref.`,
              span,
            ));
          } else if (!declaredReactives.has(log.name)) {
            errors.push(new TSError(
              "E-REPLAY-002",
              `E-REPLAY-002: Replay source '@${log.name}' is not a declared reactive variable. ` +
              `Declare '@${log.name} = []' and attach it to a machine via an 'audit @${log.name}' clause ` +
              `so it accumulates transition entries.`,
              span,
            ));
          }

          // §51.14.6 / E-REPLAY-003 (S28): when both @target and @log resolve
          // and @log is the audit target of some machine M, @target's machine
          // MUST also be M. Cross-machine replays produce semantically
          // nonsensical state because the variant names in M's audit entries
          // don't necessarily exist in @target's enum. We only fire this when
          // the log IS attached to a machine via `audit @log`; a hand-built
          // log (not an audit target) is left alone — users may legitimately
          // want to replay synthetic logs.
          if (target && log && machineBoundReactives.has(target.name)) {
            const logOwner = auditTargetToMachine.get(log.name) ?? null;
            if (logOwner !== null) {
              const targetMachine = reactiveBindings.get(target.name)!;
              if (targetMachine.name !== logOwner) {
                errors.push(new TSError(
                  "E-REPLAY-003",
                  `E-REPLAY-003: Cross-machine replay rejected. Target '@${target.name}' ` +
                  `is governed by machine '${targetMachine.name}' but log '@${log.name}' ` +
                  `is the audit target of machine '${logOwner}'. The log's entries reference ` +
                  `'${logOwner}' variant names which may not exist in '${targetMachine.name}'. ` +
                  `Replay each log into a reactive governed by its own machine, or use a ` +
                  `synthetic (non-audit) log that you've validated manually.`,
                  span,
                ));
              }
            }
          }
        }
      }
      for (const key of Object.keys(v)) {
        // Skip span objects — they carry numeric positions, never ExprNodes.
        if (key === "span") continue;
        visitForReplay(v[key]);
      }
    };
    for (const n of topNodes) visitForReplay(n);
  }

  // TS-G: Linear type enforcement pass.
  // The real pipeline passes { filePath, ast: FileAST, errors } objects to
  // runTS (CE output shape). fileAST.nodes is therefore undefined at the outer
  // level; the actual nodes live under fileAST.ast.nodes. The dual-shape
  // fallback below handles both shapes.
  // checkLinear's default case descends into .body and .children so
  // markup.children and logic.body both get visited; function-decl recurses
  // with its own scope and breaks, so no double-walk occurs.
  const allLinNodes = (fileAST.nodes as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
    ?? [];
  if (allLinNodes.length > 0) {
    checkLinear(allLinNodes, errors, { file: filePath });
  }

  // TS-H: Loop control flow validation (E-LOOP-001/002/005).
  const allNodes = (fileAST.nodes as ASTNodeLike[] | undefined)
    ?? ((fileAST.ast as FileAST | undefined)?.nodes as ASTNodeLike[] | undefined)
    ?? [];
  if (allNodes.length > 0) {
    checkLoopControl(allNodes, errors, filePath);
  }

  // TS-I: §6.7.9 animationFrame diagnostics (E-LIFECYCLE-015 / E-LIFECYCLE-017).
  if (allNodes.length > 0) {
    checkAnimationFrame(allNodes, errors, filePath);
  }

  // Assemble TypedFileAST.
  const typedAst: TypedFileAST = Object.assign({}, fileAST, {
    nodeTypes,
    componentShapes: new Map(),
    scopeChain,
    stateTypeRegistry,
    machineRegistry,
    // S66: expose user-defined type registry on the typed-AST so post-TS
    // passes (e.g., I-MATCH-PROMOTABLE lint, SPEC §56) can resolve enum
    // type names from cell typeAnnotations. typeRegistry holds enum/struct
    // declarations from `type X:enum = { ... }` etc.
    typeRegistry,
  });

  return { typedAst, errors, stateTypeRegistry };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the Type System (TS, Stage 6) — sub-stages TS-A, TS-B, TS-C, TS-F, and TS-G.
 */
export function runTS(input: {
  files: FileAST[];
  protectAnalysis: ProtectAnalysis;
  routeMap: RouteMap;
  /** Cross-file type maps: Map<filePath, Map<typeName, ResolvedType>>
   * Built in api.js from already-processed dependency files in topo order.
   * Keys are absolute file paths. Values are the exported type entries from that file. */
  importedTypesByFile?: Map<string, Map<string, ResolvedType>>;
}): { files: TypedFileAST[]; errors: TSError[]; stateTypeRegistry?: Map<string, ResolvedType> } {
  const {
    files = [],
    protectAnalysis = { views: new Map() },
    routeMap = { functions: new Map() },
    importedTypesByFile,
  } = input;

  const typedFiles: TypedFileAST[] = [];
  const allErrors: TSError[] = [];
  let lastStateTypeRegistry: Map<string, ResolvedType> | undefined;

  for (const fileAST of files) {
    // Look up imported types for this file from the caller-provided map.
    // api.js builds this map in topological order so dependency types are available
    // when an importing file is processed. If not provided, cross-file types are absent
    // (pre-import-system behavior — single-file compilation still works correctly).
    const importedTypes = importedTypesByFile?.get(fileAST.filePath as string);
    const { typedAst, errors, stateTypeRegistry } = processFile(fileAST, protectAnalysis, routeMap, importedTypes);
    typedFiles.push(typedAst);
    allErrors.push(...errors);
    lastStateTypeRegistry = stateTypeRegistry;
  }

  return {
    files: typedFiles,
    errors: allErrors,
    stateTypeRegistry: lastStateTypeRegistry,
  };
}

// ---------------------------------------------------------------------------
// §48 fn body prohibition checks (Layer 1 and Layer 2)
// ---------------------------------------------------------------------------

/**
 * Walk a `fn` body and emit errors for the prohibited operations.
 *
 * Layer 1 (§48.3):
 *   E-FN-001  ?{} SQL access
 *   E-FN-002  DOM mutation call
 *   E-FN-003  Outer-scope variable mutation
 *   E-FN-004  Non-deterministic call (Date.now, Math.random, crypto.randomUUID, etc.)
 *   E-FN-005  async declaration or await expression
 *
 * Layer 2 (§48.4–§48.5):
 *   E-STATE-COMPLETE  State literal has unassigned declared fields at literal close (§54.6.1).
 *                     Amended 2026-04-20 (S32): retired E-FN-006; universal scope per §54.
 *                     Current impl still fires at `return` site in fn body; universalization
 *                     to `function` bodies + true literal-closing-tag pointing is future work.
 *   E-FN-007  Branches return different <state> types without an explicit union return type
 *   E-FN-008  lift targeting an outer-scope ~ accumulator
 *
 * E-FN-009 (reactive subscription capture) is deferred — pure-value reads of @variables
 * inside fn bodies are permitted; the check would require call-graph analysis.
 *
 * Called after the standard body walk in the `function-decl` case when fnKind === "fn".
 */
function checkFnBodyProhibitions(
  fnNode: ASTNodeLike,
  body: ASTNodeLike[],
  errors: TSError[],
  filePath: string,
  stateTypeRegistry?: Map<string, ResolvedType>,
  nonPureFnNames?: Set<string>,
  scopeChain?: ScopeChain,
): void {
  const fnName = (fnNode.name as string) ?? "<anonymous>";
  const fnSpan = (fnNode.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 }) as Span;

  // E-FN-005: async on the fn declaration itself
  if (fnNode.isAsync || fnNode.async) {
    errors.push(new TSError(
      "E-FN-005",
      `E-FN-005: \`fn ${fnName}\` is declared \`async\`. \`fn\` is always synchronous. ` +
      `Perform the \`await\` at the call site and pass the resolved value as a parameter to \`fn\`.`,
      fnSpan,
    ));
  }

  // Known non-deterministic call identifiers (§48.3.4)
  const NON_DET_CALLS = [
    "Date.now",
    "new Date",
    "Math.random",
    "crypto.randomUUID",
    "crypto.getRandomValues",
    "performance.now",
  ];

  // Known DOM mutation identifiers (§48.3.2)
  const DOM_MUTATION_APIS = [
    "document.createElement",
    "document.getElementById",
    "document.querySelector",
    "document.querySelectorAll",
    "document.body",
    "document.head",
    ".appendChild",
    ".removeChild",
    ".insertBefore",
    ".setAttribute",
    ".innerHTML",
    ".innerText",
    ".textContent",
    ".removeAttribute",
  ];

  /**
   * Extract the text representation of an AST node for heuristic string matching.
   * BPP may have parsed raw expression text into `value`, `expr`, `text`, or `raw` fields.
   */
  function nodeText(node: ASTNodeLike): string {
    // Phase 4d: ExprNode-first — reconstruct text from ExprNode if available
    const nodeAny = node as Record<string, unknown>;
    const exprNodeField = nodeAny.exprNode ?? nodeAny.initExpr;
    if (exprNodeField && typeof exprNodeField === "object" && (exprNodeField as any).kind) {
      try { return emitStringFromTree(exprNodeField as import("./types/ast.ts").ExprNode); } catch { /* fall through */ }
    }
    const parts: string[] = [];
    if (typeof node.value === "string") parts.push(node.value);
    if (typeof node.expr === "string") parts.push(node.expr);
    if (typeof node.text === "string") parts.push(node.text);
    if (typeof node.raw === "string") parts.push(node.raw);
    if (typeof node.callee === "string") parts.push(node.callee);
    if (typeof node.name === "string") parts.push(node.name);
    if (typeof node.left === "string") parts.push(node.left);
    if (typeof node.right === "string") parts.push(node.right);
    if (typeof node.target === "string") parts.push(node.target);
    return parts.join(" ");
  }

  // ---------------------------------------------------------------------------
  // E-FN-003 — Outer-Scope Variable Mutation (§48.3.3)
  // ---------------------------------------------------------------------------
  // Collect all variable names that are LOCAL to this fn body (params + declarations).
  // Anything NOT in this set that appears as an assignment LHS is an outer-scope mutation.
  const localNames = new Set<string>();

  // Fn parameters are local
  if (Array.isArray(fnNode.params)) {
    for (const param of (fnNode.params as unknown[])) {
      const paramNameField = typeof param === "object" && param !== null
        ? (param as ASTNodeLike).name
        : undefined;
      // A5-FUP — destructured params: collect every yielded binding name.
      if (paramNameField && isDestructurePattern(paramNameField)) {
        for (const bind of iterDestructuredNames(paramNameField as DestructurePatternShape)) {
          localNames.add(bind);
        }
        continue;
      }
      const paramName = typeof param === "string" ? param : paramNameField as string;
      if (paramName) localNames.add(paramName);
    }
  }

  // Collect local declarations from direct body nodes (not inside nested fn)
  function collectLocalDecls(nodes: ASTNodeLike[]): void {
    for (const stmt of nodes) {
      if (!stmt || typeof stmt !== "object") continue;
      if (stmt.kind === "function-decl") continue; // nested fn has own scope
      const declName = (stmt.name as string | undefined) ?? undefined;
      if (
        declName &&
        (stmt.kind === "let-decl" ||
         stmt.kind === "const-decl" ||
         stmt.kind === "lin-decl" ||
         stmt.kind === "variable-decl")
      ) {
        // §48.3.3: tilde-decl represents reassignment (e.g. `x = 5`), NOT a fresh declaration.
        // Excluded from localNames so outer-scope mutation via `x = x + 1` is caught.
        localNames.add(declName);
      }
      // Recurse into branches so names declared in branches are also tracked
      if (Array.isArray(stmt.body)) collectLocalDecls(stmt.body as ASTNodeLike[]);
      if (Array.isArray(stmt.then)) collectLocalDecls(stmt.then as ASTNodeLike[]);
      if (Array.isArray(stmt.else)) collectLocalDecls(stmt.else as ASTNodeLike[]);
      if (Array.isArray(stmt.consequent)) collectLocalDecls(stmt.consequent as ASTNodeLike[]);
      if (Array.isArray(stmt.alternate)) collectLocalDecls(stmt.alternate as ASTNodeLike[]);
    }
  }
  collectLocalDecls(body);

  // Regex to detect outer-scope assignments: `name = value` but not `==`, `!=`, `<=`, `>=`, `=>`
  // Matches `identifier =` not followed by `=` or `>`, not preceded by `!`, `<`, `>`, `=`
  const ASSIGN_RE = /([A-Za-z_$][A-Za-z0-9_$]*)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?\s*=[^=>]/;

  function checkOuterScopeMutation(stmt: ASTNodeLike, txt: string): void {
    const stmtSpan = (stmt.span ?? fnSpan) as Span;
    // Check for assignment node kind first
    if (stmt.kind === "assignment" || stmt.kind === "tilde-decl") {
      const targetName = (stmt.target as string | undefined) ?? (stmt.name as string | undefined);
      if (targetName && !localNames.has(targetName)) {
        errors.push(new TSError(
          "E-FN-003",
          `E-FN-003: \`fn ${fnName}\` body writes to \`${targetName}\` at line ${stmtSpan.line}, ` +
          `which is declared outside the \`fn\` boundary. ` +
          `\`fn\` may not mutate outer-scope variables. ` +
          `Declare \`${targetName}\` inside the \`fn\` body, or pass it as a parameter and return an updated value alongside the state.`,
          stmtSpan,
        ));
      }
      return;
    }
    // Heuristic text check for assignment patterns
    if (txt) {
      const match = ASSIGN_RE.exec(txt);
      if (match) {
        const targetName = match[1];
        if (targetName && !localNames.has(targetName)) {
          errors.push(new TSError(
            "E-FN-003",
            `E-FN-003: \`fn ${fnName}\` body writes to \`${targetName}\` at line ${stmtSpan.line}, ` +
            `which is declared outside the \`fn\` boundary. ` +
            `\`fn\` may not mutate outer-scope variables. ` +
            `Declare \`${targetName}\` inside the \`fn\` body, or pass it as a parameter and return an updated value alongside the state.`,
            stmtSpan,
          ));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // E-STATE-COMPLETE — State literal missing declared fields (§54.6.1)
  // E-FN-007 — Branch Produces Different State Shape (§48.4.1)
  //
  // Amended 2026-04-20 (S32): E-FN-006 retired; state-completeness checks
  // relocate to E-STATE-COMPLETE at every state-literal site per §54.6.1.
  // Current impl still runs at `return` site inside `fn`; universalization
  // to `function` bodies and literal-closing-tag pointing are Phase 1b/3.
  // ---------------------------------------------------------------------------
  // Track state instances created inside the fn body: varName -> typeName
  const stateInstances = new Map<string, string>(); // varName -> typeName
  // Track which fields are loaded per state instance: varName -> Set<fieldName>
  const loadedFields = new Map<string, Set<string>>();
  // Track return types seen at top-level branches for E-FN-007
  const returnTypes: Array<{ typeName: string; line: number }> = [];
  // Track if a tilde-decl (~ accumulator) exists in the fn body for E-FN-008
  let hasFnLocalTilde = false;
  // Track if a lift statement exists in the fn body for E-FN-008
  let hasLiftInBody = false;
  let liftSpan: Span | null = null;

  // Scan the fn body top-level for tilde-decl (~ initializations).
  // Also treat `return ~` (or any ~-reference in a return) as an implicit
  // fn-local accumulator: §48.5 says lift inside fn is fine when the fn
  // closes the accumulator itself (`return ~`), even without an explicit
  // `~acc = []` declaration.
  function textMentionsTilde(stmt: ASTNodeLike): boolean {
    const t = nodeText(stmt);
    return typeof t === "string" && /(^|[\s(=,{\[])~($|[\s);,}\]])/.test(t);
  }
  for (const stmt of body) {
    if (!stmt || typeof stmt !== "object") continue;
    if (stmt.kind === "tilde-decl" || stmt.kind === "tilde-stmt") {
      hasFnLocalTilde = true;
    }
    if (stmt.kind === "return-stmt" && textMentionsTilde(stmt)) {
      hasFnLocalTilde = true;
    }
  }

  // Pre-pass: collect state instantiations at top level of fn body
  // Pattern: let varName = < TypeName> (state-instantiation node or expression text)
  function collectStateInstances(nodes: ASTNodeLike[]): void {
    for (const stmt of nodes) {
      if (!stmt || typeof stmt !== "object") continue;
      if (stmt.kind === "function-decl") continue;

      // Structured state instantiation node
      if (stmt.kind === "state-instantiation" || stmt.kind === "state-init") {
        const varName = stmt.name as string | undefined;
        const typeName = (stmt.stateType ?? stmt.typeName ?? stmt.type) as string | undefined;
        if (varName && typeName) {
          stateInstances.set(varName, typeName);
          loadedFields.set(varName, new Set());
        }
      }

      // let-decl / const-decl where value contains "< TypeName>" pattern
      if (
        stmt.kind === "let-decl" ||
        stmt.kind === "const-decl" ||
        stmt.kind === "variable-decl"
      ) {
        const varName = stmt.name as string | undefined;
        // Check if the value field contains a state instantiation
        // BPP represents "< TypeName>" as stateType field or in value text
        const stateTypeName = (stmt.stateType ?? stmt.instanceOf) as string | undefined;
        if (varName && stateTypeName) {
          stateInstances.set(varName, stateTypeName);
          loadedFields.set(varName, new Set());
        } else if (varName && typeof stmt.value === "string") {
          // Heuristic: value text matches "< TypeName>" pattern
          const stateMatch = /^\s*<\s*([A-Z][A-Za-z0-9_]*)\s*>\s*$/.exec(stmt.value as string);
          if (stateMatch) {
            stateInstances.set(varName, stateMatch[1]);
            loadedFields.set(varName, new Set());
          }
        }
      }
    }
  }
  collectStateInstances(body);

  // Field assignment tracking: when we see "varName.fieldName = value"
  // Regex: captures varName and fieldName from property assignment text
  const FIELD_ASSIGN_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=[^=>]/;

  function trackFieldAssignment(txt: string): void {
    const match = FIELD_ASSIGN_RE.exec(txt);
    if (match) {
      const varName = match[1];
      const fieldName = match[2];
      const fields = loadedFields.get(varName);
      if (fields) {
        fields.add(fieldName);
      }
    }
  }

  // Collect return types at the given nesting level (for E-FN-007)
  function collectReturnTypes(nodes: ASTNodeLike[], isBranch: boolean): void {
    for (const stmt of nodes) {
      if (!stmt || typeof stmt !== "object") continue;
      if (stmt.kind === "function-decl") continue;

      if (stmt.kind === "return-stmt") {
        // Phase 4d: ExprNode-first — extract return value from exprNode, string fallback
        const _retExprNode = (stmt as Record<string, unknown>).exprNode;
        const returnValue: string | undefined = _retExprNode
          ? (() => { try { return emitStringFromTree(_retExprNode as import("./types/ast.ts").ExprNode); } catch { return undefined; } })()
          : (stmt.value ?? stmt.expr ?? stmt.expression) as string | undefined;
        if (returnValue && typeof returnValue === "string") {
          const instance = stateInstances.get(returnValue.trim());
          if (instance && isBranch) {
            const retSpan = (stmt.span ?? fnSpan) as Span;
            returnTypes.push({ typeName: instance, line: retSpan.line });
          }
        }
        // Structured return: stmt.returnType or stmt.stateType
        const retType = (stmt.returnType ?? stmt.stateType) as string | undefined;
        if (retType && isBranch) {
          const retSpan = (stmt.span ?? fnSpan) as Span;
          returnTypes.push({ typeName: retType, line: retSpan.line });
        }
      }

      // Recurse into branches for E-FN-007 tracking
      const branchNodes: ASTNodeLike[][] = [];
      if (Array.isArray(stmt.then)) branchNodes.push(stmt.then as ASTNodeLike[]);
      if (Array.isArray(stmt.else)) branchNodes.push(stmt.else as ASTNodeLike[]);
      if (Array.isArray(stmt.consequent)) branchNodes.push(stmt.consequent as ASTNodeLike[]);
      if (Array.isArray(stmt.alternate)) branchNodes.push(stmt.alternate as ASTNodeLike[]);
      if (Array.isArray(stmt.arms)) {
        for (const arm of stmt.arms as ASTNodeLike[]) {
          if (Array.isArray(arm.body)) branchNodes.push(arm.body as ASTNodeLike[]);
        }
      }
      for (const branch of branchNodes) {
        collectReturnTypes(branch, true);
      }
    }
  }
  collectReturnTypes(body, false);

  // ---------------------------------------------------------------------------
  // Primary walk: Layer 1 + E-FN-003 + field tracking + lift detection
  // ---------------------------------------------------------------------------
  function walkBody(nodes: ASTNodeLike[]): void {
    for (const stmt of nodes) {
      if (!stmt || typeof stmt !== "object") continue;

      const stmtSpan = (stmt.span ?? fnSpan) as Span;

      // E-FN-001: SQL access (?{} block)
      if (stmt.kind === "sql") {
        errors.push(new TSError(
          "E-FN-001",
          `E-FN-001: \`fn ${fnName}\` body contains a \`?{}\` SQL access. ` +
          `\`fn\` is a pure function and may not perform database operations. ` +
          `Move the \`?{}\` query outside \`fn\` and pass the result as a parameter.`,
          stmtSpan,
        ));
      }
      // v0.2.4 bug-1-anomaly-2: `let x = ?{...}` / `const x = ?{...}` now
      // attaches a structured sqlNode (see ast-builder tryConsumeSqlInit
      // wired into let/const-decl paths). The text-heuristic at line ~9555
      // below scans nodeText(stmt) but with sqlNode the init text is "" —
      // miss. Catch the structured form explicitly.
      if ((stmt.kind === "let-decl" || stmt.kind === "const-decl") &&
          (stmt as any).sqlNode && (stmt as any).sqlNode.kind === "sql") {
        errors.push(new TSError(
          "E-FN-001",
          `E-FN-001: \`fn ${fnName}\` body contains a \`?{}\` SQL access. ` +
          `\`fn\` is a pure function and may not perform database operations. ` +
          `Move the \`?{}\` query outside \`fn\` and pass the result as a parameter.`,
          stmtSpan,
        ));
      }

      // E-FN-005: await expression in body
      if (stmt.kind === "await-expr" || stmt.await === true) {
        errors.push(new TSError(
          "E-FN-005",
          `E-FN-005: \`fn ${fnName}\` body contains \`await\`. ` +
          `\`fn\` is always synchronous. Perform the \`await\` at the call site and pass the resolved value as a parameter.`,
          stmtSpan,
        ));
      }

      // E-FN-008: lift statement targeting outer scope
      if (stmt.kind === "lift" || stmt.kind === "lift-stmt" || stmt.kind === "lift-expr") {
        hasLiftInBody = true;
        if (!liftSpan) liftSpan = stmtSpan;
      }

      // E-FN-003: Reactive variable writes inside fn body (§48.3.3)
      // @var is always declared in outer scope (state-decl is program-level).
      // Writing to @var inside fn is an outer-scope mutation.
      // Catches both forms:
      //   - kind=state-decl (parsed as `@x = value` — declaration form)
      //   - kind=bare-expr with assign ExprNode (parsed as `@x += value` — compound assignment)
      {
        // state-decl inside fn body = writing to an @var (always outer-scope)
        if (stmt.kind === "state-decl") {
          const varName = "@" + ((stmt.name as string) || "unknown");
          errors.push(new TSError(
            "E-FN-003",
            `E-FN-003: \`fn ${fnName}\` body writes to reactive variable \`${varName}\` at line ${stmtSpan.line}. ` +
            `\`fn\` is a pure function and may not mutate reactive state. ` +
            `Move the write outside \`fn\`, or use \`function\` instead of \`fn\` if side effects are intentional.`,
            stmtSpan,
          ));
        }

        // ExprNode-first: check for assign with @-prefixed target
        const exprNode = (stmt as Record<string, unknown>).exprNode as
          import("./types/ast.ts").ExprNode | undefined;
        if (exprNode && (exprNode as any).kind === "assign") {
          const target = (exprNode as any).target;
          if (target && target.kind === "ident" && typeof target.name === "string" && target.name.startsWith("@")) {
            const varName = target.name;
            errors.push(new TSError(
              "E-FN-003",
              `E-FN-003: \`fn ${fnName}\` body writes to reactive variable \`${varName}\` at line ${stmtSpan.line}. ` +
              `\`fn\` is a pure function and may not mutate reactive state. ` +
              `Move the write outside \`fn\`, or use \`function\` instead of \`fn\` if side effects are intentional.`,
              stmtSpan,
            ));
          }
        }
        // Text heuristic fallback: @identifier followed by assignment operator
        if (!exprNode && stmt.kind !== "state-decl") {
          const exprText = (stmt as any).exprNode
            ? emitStringFromTree((stmt as any).exprNode as import("./types/ast.ts").ExprNode)
            : (typeof stmt.expr === "string" ? stmt.expr : "");
          const reactiveAssignMatch = /^@([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\+|-|\*|\/|%|\?\?)?=/.exec(exprText);
          if (reactiveAssignMatch) {
            const varName = "@" + reactiveAssignMatch[1];
            errors.push(new TSError(
              "E-FN-003",
              `E-FN-003: \`fn ${fnName}\` body writes to reactive variable \`${varName}\` at line ${stmtSpan.line}. ` +
              `\`fn\` is a pure function and may not mutate reactive state. ` +
              `Move the write outside \`fn\`, or use \`function\` instead of \`fn\` if side effects are intentional.`,
              stmtSpan,
            ));
          }
        }
      }

      // Heuristic text checks for E-FN-001, E-FN-002, E-FN-003, E-FN-004 and field tracking
      const txt = nodeText(stmt);
      if (txt) {
        // E-FN-001: ?{} SQL access (text-heuristic — catches ?{} embedded in let-decl init or return-stmt)
        // S96 Bug 15 fix — pattern must be `?{` with NO whitespace. The pre-fix
        // `/\?\s*\{/` regex matched `? {` (ternary with object-literal arm),
        // false-firing on shapes like `t.id == id ? { ...t } : t` inside fn
        // bodies. SPEC §48 (purity) targets the SQL sigil `?{` which is
        // tokenized as a single unit — no whitespace permitted between `?`
        // and `{`. Tightening the regex matches that tokenizer contract.
        if (stmt.kind !== "sql" && /\?\{/.test(txt)) {
          errors.push(new TSError(
            "E-FN-001",
            `E-FN-001: \`fn ${fnName}\` body contains a \`?{}\` SQL access. ` +
            `\`fn\` is a pure function and may not perform database operations. ` +
            `Move the \`?{}\` query outside \`fn\` and pass the result as a parameter.`,
            stmtSpan,
          ));
        }

        // E-FN-003: fn body calls a non-pure function (§48.6.2)
        if (nonPureFnNames && nonPureFnNames.size > 0) {
          // Extract all identifier-followed-by-`(` occurrences
          const CALL_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
          let m: RegExpExecArray | null;
          while ((m = CALL_RE.exec(txt)) !== null) {
            const callee = m[1];
            if (nonPureFnNames.has(callee)) {
              errors.push(new TSError(
                "E-FN-003",
                `E-FN-003: \`fn ${fnName}\` body calls \`${callee}()\`, which is declared with \`function\` (not \`fn\`) and may perform side effects. ` +
                `\`fn\` may only call other \`fn\` declarations. ` +
                `Either redeclare \`${callee}\` as \`fn\`, or pass its result into \`fn ${fnName}\` as a parameter.`,
                stmtSpan,
              ));
              break; // one E-FN-003 per statement
            }
          }
        }

        // E-FN-004: non-deterministic calls
        for (const nd of NON_DET_CALLS) {
          if (txt.includes(nd)) {
            errors.push(new TSError(
              "E-FN-004",
              `E-FN-004: \`fn ${fnName}\` body calls \`${nd}()\`, which is non-deterministic. ` +
              `\`fn\` must be a pure function of its inputs. Generate the value outside \`fn\` and pass it as a parameter.`,
              stmtSpan,
            ));
            break; // one error per statement for non-det
          }
        }

        // E-FN-002: DOM mutation calls
        for (const domApi of DOM_MUTATION_APIS) {
          if (txt.includes(domApi)) {
            errors.push(new TSError(
              "E-FN-002",
              `E-FN-002: \`fn ${fnName}\` body contains a DOM mutation call (\`${domApi}\`). ` +
              `\`fn\` is a pure function and may not mutate the DOM. ` +
              `Use \`<state>\` fields to hold configuration data; let the runtime render the DOM from state.`,
              stmtSpan,
            ));
            break; // one error per statement for DOM
          }
        }

        // E-FN-003: outer-scope variable mutation
        checkOuterScopeMutation(stmt, txt);

        // Track field assignments for E-STATE-COMPLETE
        trackFieldAssignment(txt);
      }

      // E-STATE-COMPLETE: state-literal completeness check (§54.6.1).
      // Current location: fires at `return` statement inside fn body.
      // Target location (Phase 3+): fires at state literal's `</>` closer.
      // Amended 2026-04-20 (S32): E-FN-006 retired; code + diagnostic updated.
      if (stmt.kind === "return-stmt" && stateTypeRegistry) {
        const _retExprNode2 = (stmt as Record<string, unknown>).exprNode;
        const returnValue = _retExprNode2
          ? (() => { try { return emitStringFromTree(_retExprNode2 as import("./types/ast.ts").ExprNode); } catch { return undefined; } })()
          : (stmt.value ?? stmt.expr ?? stmt.expression) as unknown;
        const returnVarName = typeof returnValue === "string" ? returnValue.trim() : undefined;
        if (returnVarName) {
          const typeName = stateInstances.get(returnVarName);
          if (typeName) {
            const stateType = stateTypeRegistry.get(typeName) as StateType | undefined;
            if (stateType && stateType.attributes) {
              const loaded = loadedFields.get(returnVarName) ?? new Set();
              for (const [fieldName] of stateType.attributes) {
                if (!loaded.has(fieldName)) {
                  const declaredFields = [...stateType.attributes.keys()].join(", ");
                  errors.push(new TSError(
                    "E-STATE-COMPLETE",
                    `E-STATE-COMPLETE: field \`${fieldName}\` of \`< ${typeName}>\` is unassigned at literal close.\n` +
                    `  Binding: \`${returnVarName}\` (returned from \`fn\` at line ${stmtSpan.line}).\n` +
                    `  Declared fields: ${declaredFields}.\n` +
                    `  On this evaluation path, \`${fieldName}\` was never assigned before the literal closed.\n` +
                    `  Either assign \`${returnVarName}.${fieldName}\` before \`return\`, ` +
                    `or give \`${fieldName}\` a default value in the \`< state ${typeName}>\` declaration.`,
                    stmtSpan,
                  ));
                }
              }
            }
          }
        }
      }

      // Recurse into child node arrays.
      // Do NOT recurse into nested function-decl nodes — they have their own check.
      if (stmt.kind === "function-decl") continue;

      if (Array.isArray(stmt.body)) walkBody(stmt.body as ASTNodeLike[]);
      if (Array.isArray(stmt.children)) walkBody(stmt.children as ASTNodeLike[]);
      if (Array.isArray(stmt.consequent)) walkBody(stmt.consequent as ASTNodeLike[]);
      if (Array.isArray(stmt.alternate)) walkBody(stmt.alternate as ASTNodeLike[]);
      if (Array.isArray(stmt.then)) walkBody(stmt.then as ASTNodeLike[]);
      if (Array.isArray(stmt.else)) walkBody(stmt.else as ASTNodeLike[]);
      if (Array.isArray(stmt.arms)) {
        for (const arm of stmt.arms as ASTNodeLike[]) {
          if (Array.isArray(arm.body)) walkBody(arm.body as ASTNodeLike[]);
        }
      }
    }
  }

  walkBody(body);

  // ---------------------------------------------------------------------------
  // E-FN-007 — Branch Produces Different State Shape (§48.4.4)
  // ---------------------------------------------------------------------------
  if (returnTypes.length >= 2) {
    const uniqueTypes = [...new Set(returnTypes.map(r => r.typeName))];
    if (uniqueTypes.length > 1) {
      // Check if the fn has an explicit union return type declared
      const hasExplicitUnionReturn =
        typeof fnNode.returnType === "string" && fnNode.returnType.includes("|");
      if (!hasExplicitUnionReturn) {
        const firstRet = returnTypes[0];
        const secondRet = returnTypes.find(r => r.typeName !== firstRet.typeName);
        errors.push(new TSError(
          "E-FN-007",
          `E-FN-007: \`fn ${fnName}\` returns \`${firstRet.typeName}\` in one branch ` +
          `(line ${firstRet.line}) and \`${secondRet?.typeName ?? uniqueTypes[1]}\` in another ` +
          `(line ${secondRet?.line ?? "?"}). ` +
          `Declare an explicit union return type to allow this: ` +
          `\`fn ${fnName}(...) -> ${uniqueTypes.join(" | ")} { ... }\`. ` +
          `If the divergence is unintentional, make both branches return the same type.`,
          fnSpan,
        ));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // E-FN-008 — lift Targeting Outer Scope (§48.5.2)
  // ---------------------------------------------------------------------------
  if (hasLiftInBody && !hasFnLocalTilde && liftSpan) {
    errors.push(new TSError(
      "E-FN-008",
      `E-FN-008: \`lift\` at line ${liftSpan.line} inside \`fn ${fnName}\` targets a ` +
      `\`~\` accumulator initialized outside the \`fn\` boundary. ` +
      `\`lift\` inside \`fn\` may only accumulate into \`~\` initialized within the same \`fn\` body.`,
      liftSpan,
    ));
  }
}

// ---------------------------------------------------------------------------
// §54.6.1 — E-STATE-COMPLETE universal state-literal completeness check
//
// Added 2026-04-20 (S32 Phase 1b). Standalone check that runs for plain
// `function` bodies (checkFnBodyProhibitions already handles the `fn` case).
// Per §54.6.1 the completeness rule applies universally; this function
// is the universalization gate for non-fn function forms.
//
// Implementation mirrors the fn-body state-completeness logic: collect
// state instantiations (`let u = < User>`), track field assignments
// (`u.name = ...`), and at every `return x` site verify all declared
// fields of the returned state instance are loaded.
//
// Current diagnostic location: `return` statement. Phase 3+ will relocate
// to the state literal's `</>` closer per the spec's "literal close" pointer.
// ---------------------------------------------------------------------------
function checkFunctionBodyStateCompleteness(
  fnNode: ASTNodeLike,
  body: ASTNodeLike[],
  errors: TSError[],
  _filePath: string,
  stateTypeRegistry?: Map<string, ResolvedType>,
): void {
  if (!stateTypeRegistry) return;

  const fnName = (fnNode.name as string) ?? "<anonymous>";
  const fnSpan = (fnNode.span ?? { file: _filePath, start: 0, end: 0, line: 1, col: 1 }) as Span;
  const stateInstances = new Map<string, string>();
  const loadedFields = new Map<string, Set<string>>();

  function collectStateInstances(nodes: ASTNodeLike[]): void {
    for (const stmt of nodes) {
      if (!stmt || typeof stmt !== "object") continue;
      if (stmt.kind === "function-decl") continue; // nested function — own scope

      if (stmt.kind === "state-instantiation" || stmt.kind === "state-init") {
        const varName = stmt.name as string | undefined;
        const typeName = (stmt.stateType ?? stmt.typeName ?? stmt.type) as string | undefined;
        if (varName && typeName) {
          stateInstances.set(varName, typeName);
          loadedFields.set(varName, new Set());
        }
      }

      if (
        stmt.kind === "let-decl" ||
        stmt.kind === "const-decl" ||
        stmt.kind === "variable-decl"
      ) {
        const varName = stmt.name as string | undefined;
        const stateTypeName = (stmt.stateType ?? stmt.instanceOf) as string | undefined;
        if (varName && stateTypeName) {
          stateInstances.set(varName, stateTypeName);
          loadedFields.set(varName, new Set());
        } else if (varName && typeof stmt.value === "string") {
          const stateMatch = /^\s*<\s*([A-Z][A-Za-z0-9_]*)\s*>\s*$/.exec(stmt.value as string);
          if (stateMatch) {
            stateInstances.set(varName, stateMatch[1]);
            loadedFields.set(varName, new Set());
          }
        }
      }
    }
  }
  collectStateInstances(body);

  const FIELD_ASSIGN_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=[^=>]/;

  function trackFieldAssignment(txt: string): void {
    const m = FIELD_ASSIGN_RE.exec(txt);
    if (!m) return;
    const [, varName, fieldName] = m;
    if (stateInstances.has(varName)) {
      const set = loadedFields.get(varName) ?? new Set();
      set.add(fieldName);
      loadedFields.set(varName, set);
    }
  }

  function walkBody(nodes: ASTNodeLike[]): void {
    for (const stmt of nodes) {
      if (!stmt || typeof stmt !== "object") continue;
      if (stmt.kind === "function-decl") continue; // nested function — own scope

      const stmtSpan = (stmt.span ?? fnSpan) as Span;

      // Track field assignments from expression/statement text
      if (typeof stmt.value === "string") {
        trackFieldAssignment(stmt.value as string);
      }
      const txt = typeof stmt.value === "string" ? (stmt.value as string) : "";
      if (txt) trackFieldAssignment(txt);

      // E-STATE-COMPLETE at return site
      if (stmt.kind === "return-stmt") {
        const _retExprNode = (stmt as Record<string, unknown>).exprNode;
        const returnValue = _retExprNode
          ? (() => { try { return emitStringFromTree(_retExprNode as import("./types/ast.ts").ExprNode); } catch { return undefined; } })()
          : (stmt.value ?? stmt.expr ?? stmt.expression) as unknown;
        const returnVarName = typeof returnValue === "string" ? returnValue.trim() : undefined;
        if (returnVarName) {
          const typeName = stateInstances.get(returnVarName);
          if (typeName) {
            const stateType = stateTypeRegistry.get(typeName) as StateType | undefined;
            if (stateType && stateType.attributes) {
              const loaded = loadedFields.get(returnVarName) ?? new Set();
              for (const [fieldName] of stateType.attributes) {
                if (!loaded.has(fieldName)) {
                  const declaredFields = [...stateType.attributes.keys()].join(", ");
                  errors.push(new TSError(
                    "E-STATE-COMPLETE",
                    `E-STATE-COMPLETE: field \`${fieldName}\` of \`< ${typeName}>\` is unassigned at literal close.\n` +
                    `  Binding: \`${returnVarName}\` (returned from \`function ${fnName}\` at line ${stmtSpan.line}).\n` +
                    `  Declared fields: ${declaredFields}.\n` +
                    `  On this evaluation path, \`${fieldName}\` was never assigned before the literal closed.\n` +
                    `  Either assign \`${returnVarName}.${fieldName}\` before \`return\`, ` +
                    `or give \`${fieldName}\` a default value in the \`< state ${typeName}>\` declaration.`,
                    stmtSpan,
                  ));
                }
              }
            }
          }
        }
      }

      // Recurse into child node arrays
      if (Array.isArray(stmt.body)) walkBody(stmt.body as ASTNodeLike[]);
      if (Array.isArray(stmt.children)) walkBody(stmt.children as ASTNodeLike[]);
      if (Array.isArray(stmt.consequent)) walkBody(stmt.consequent as ASTNodeLike[]);
      if (Array.isArray(stmt.alternate)) walkBody(stmt.alternate as ASTNodeLike[]);
      if (Array.isArray(stmt.then)) walkBody(stmt.then as ASTNodeLike[]);
      if (Array.isArray(stmt.else)) walkBody(stmt.else as ASTNodeLike[]);
      if (Array.isArray(stmt.arms)) {
        for (const arm of stmt.arms as ASTNodeLike[]) {
          if (Array.isArray(arm.body)) walkBody(arm.body as ASTNodeLike[]);
        }
      }
    }
  }
  walkBody(body);
}

// ---------------------------------------------------------------------------
// Exports for testing and downstream use
// ---------------------------------------------------------------------------

export {
  ScopeChain,
  Scope,
  initCap,
  mapSqliteType,
  buildTypeRegistry,
  generateDbTypes,
  parseStructBody,
  parseEnumBody,
  resolveTypeExpr,
  checkStructFieldAccess,
  checkEnumExhaustiveness,
  checkUnionExhaustiveness,
  checkSubstateExhaustiveness,
  checkExhaustiveness,
  isOptionalType,
  checkNotAssignment,
  checkNotReturn,
  tPrimitive,
  tStruct,
  tEnum,
  tArray,
  tUnion,
  tAsIs,
  tUnknown,
  tNot,
  tSnippet,
  tPredicated,
  tState,
  BUILTIN_TYPES,
  NAMED_SHAPES,
  parsePredicateExpr,
  evaluatePredicateOnLiteral,
  checkPredicateLiteral,
  predicateImplies,
  classifyPredicateZone,
  extractInitLiteral,
  // State type registry exports (§35)
  buildStateTypeRegistry,
  registerStateType,
  getStateType,
  validateMarkupAttributes,
  inferAttrValueType,
  // TS-G exports
  LinTracker,
  TildeTracker,
  MustUseTracker,
  checkLinear,
  hasNonLiftTildeConsumer,
  // §51.3 Machine registry exports
  buildMachineRegistry,
  resolveMachineBinding,
  parseMachineRules,
  // validateDerivedMachines already exported at its definition (§51.9)
};
