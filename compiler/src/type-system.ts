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
  ["number",  tPrimitive("number")],
  ["string",  tPrimitive("string")],
  ["boolean", tPrimitive("boolean")],
  ["bool",    tPrimitive("boolean")],  // alias
  ["integer", tPrimitive("integer")],   // §53 base-type (maps to number at runtime)
  ["null",    tPrimitive("null")],
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
  // §14.4 — split variants on BOTH newlines and top-level commas so a
  // single-line declaration like
  //   { Pending, Success(value: number), Failed(error: string) }
  // yields three variants. splitTopLevel tracks `()` depth, so commas
  // inside payload field lists stay with their variant. Pre-S28 this
  // split on "\n" only; payload variants comma-separated on one line
  // collapsed into a single malformed entry (`name` containing a comma
  // fails the identifier regex) and the enum registered zero variants —
  // surfaced as E-ENGINE-004 "Valid variants: ." when referenced from
  // a `< machine for=Enum>` binding.
  const lines = splitTopLevel(variantsSection, ["\n", ","]);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match `VariantName` or `VariantName(field:type, ...)`
    const parenIdx = trimmed.indexOf("(");

    if (parenIdx === -1) {
      // Unit variant — may still be comma-separated on one line (fallback).
      const unitParts = splitTopLevel(trimmed, [","]);
      for (const part of unitParts) {
        let text = part.trim();
        if (!text) continue;

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
      // Payload variant: `Name(field:type, ...)`
      const name = trimmed.slice(0, parenIdx).trim();
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
    // Extract `after <duration>` between the from-spec and `=>`, strip it
    // from the line, and parse the duration to ms. The existing rule regex
    // below runs against the stripped line. Non-temporal rules have
    // afterMs === null and are unaffected.
    let afterMs: number | null = null;
    let line = rawLine;
    const afterMatch = line.match(/\s+after\s+(\d+(?:\.\d+)?)\s*(ms|s|m|h)\s+(?==>)/i);
    if (afterMatch) {
      const n = parseFloat(afterMatch[1]);
      const unit = afterMatch[2].toLowerCase();
      const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60000 : 3600000;
      const computed = Math.round(n * multiplier);
      if (!Number.isFinite(computed) || computed < 0) {
        errors.push(new TSError(
          "E-ENGINE-021",
          `E-ENGINE-021: Machine '${engineName}' temporal transition has an invalid duration \`${afterMatch[1]}${afterMatch[2]}\`. ` +
          `Duration must be a finite non-negative number with a unit (ms/s/m/h). Example: \`.Loading after 30s => .TimedOut\`.`,
          span,
        ));
      } else {
        afterMs = computed;
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
    if (afterMs !== null && from === "*") {
      errors.push(new TSError(
        "E-ENGINE-021",
        `E-ENGINE-021: Machine '${engineName}' temporal transition uses a wildcard \`from\`. ` +
        `Temporal rules must name a specific \`from\` variant so the compiler knows when to ` +
        `start the timer. Either name a specific \`from\` (e.g. \`.Loading after 30s => .TimedOut\`) ` +
        `or remove the \`after\` clause.`,
        span,
      ));
    }

    rules.push({ from, to, guard, label, effectBody, fromBindings, toBindings, afterMs });
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
  "undefined", "null", "true", "false", "NaN", "Infinity",
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

  function collectFnErrorTypes(nodes: ASTNodeLike[]): void {
    for (const n of nodes) {
      if (n.kind === "function-decl" && n.name) {
        fnAllDeclared.add(n.name as string);
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
        if (Array.isArray(n.params)) {
          for (const param of (n.params as unknown[])) {
            const paramName = typeof param === "string" ? param : (param as ASTNodeLike).name as string;
            const paramAnnot = (typeof param === "object" && param !== null)
              ? ((param as ASTNodeLike).typeAnnotation as string | undefined)
              : undefined;
            const paramIsLin = (typeof param === "object" && param !== null)
              ? Boolean((param as ASTNodeLike).isLin)
              : false;
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
        if (Array.isArray(fnBody)) {
          for (const stmt of fnBody) {
            if (stmt && typeof stmt === "object") {
              (stmt as Record<string, unknown>).__enclosingFnCanFail = _enclosingFnCanFail;
            }
            visitLogicNode(stmt, boundary);
          }
        }

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
            // B20 §14.10 / M9 — bare-variant inference at LHS let/const-decl
            // annotation. The annotation type drives bare-variant resolution
            // in the initializer. When NO annotation is present, the writer
            // chose `let x = .V` with no type context — per §14.10 line 7174,
            // bare variants are NOT supported there; fire E-VARIANT-AMBIGUOUS.
            if (letAnnot) {
              inferBareVariantsInExpr(initExprForScope, resolvedType, letSpan, errors);
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
            n.name as string | undefined,
            bindSpan,
            scopeChain,
            errors,
            (n.kind === "const-decl") ? "const" : "let",
          );
        }
        if (n.name) {
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
        if (reactAnnot && resolvedType.kind === "asIs") {
          const reactAnnoType2 = resolveTypeExpr(reactAnnot, typeRegistry);
          if (reactAnnoType2 && (reactAnnoType2.kind === "enum" || reactAnnoType2.kind === "union" || reactAnnoType2.kind === "struct")) {
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
            // When NO annotation is present, the writer chose `<x> = .V`
            // with no type context — per §14.10 line 7174, fire
            // E-VARIANT-AMBIGUOUS.
            if (reactAnnot) {
              inferBareVariantsInExpr(reactInitExprNode, resolvedType, reactSpan, errors);
            } else {
              inferBareVariantsInExpr(reactInitExprNode, null, reactSpan, errors);
            }
          }
        }
        if (n.name) {
          const isServer = !!(n as ASTNodeLike).isServer;
          scopeChain.bind(`@${n.name as string}`, { kind: "reactive", resolvedType, isServer });
          scopeChain.bind(n.name as string, { kind: "reactive", resolvedType, isServer });

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
      // ------------------------------------------------------------------
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
      // §2a — throw-stmt / fail-expr / reactive-debounced-decl.
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

      case "reactive-debounced-decl": {
        const dbSpan = (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const dbInitExpr = (n as Record<string, unknown>).initExpr;
        if (dbInitExpr) {
          checkLogicExprIdents(dbInitExpr, dbSpan, scopeChain, typeRegistry, errors, n.name as string | undefined, fnAllDeclared);
        }
        if (n.name) {
          // Same double-bind as state-decl (formerly also reactive-derived-decl;
          // folded into state-decl per Phase A1a Step 11.5).
          scopeChain.bind(`@${n.name as string}`, { kind: "reactive", resolvedType: tAsIs() });
          scopeChain.bind(n.name as string, { kind: "reactive", resolvedType: tAsIs() });
        }
        resolvedType = tAsIs();
        break;
      }

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
        // for-of / for-in form: `variable` is a string name.
        const forVar = (n as Record<string, unknown>).variable;
        if (typeof forVar === "string" && forVar.length > 0) {
          scopeChain.bind(forVar, { kind: "variable", resolvedType: tAsIs() });
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
// Future family members (`serialize`, `formFor`, etc.) will reuse the same
// shape with a different code prefix — keep the helper signature flexible.
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
  const resolved = typeRegistry.get(typeName);
  if (!resolved) {
    errors.push(new TSError(
      "E-PARSEVARIANT-TYPE-NOT-ENUM",
      `E-PARSEVARIANT-TYPE-NOT-ENUM: \`parseVariant\` references unknown type '${typeName}'. ` +
      `The second argument must name a scrml-native \`:enum\` type declared in this file, ` +
      `or imported from another file. (See \`< match for=Type>\` E-ENGINE-004 for the parallel diagnostic.)`,
      span,
    ));
    return null;
  }
  if (resolved.kind !== "enum") {
    errors.push(new TSError(
      "E-PARSEVARIANT-TYPE-NOT-ENUM",
      `E-PARSEVARIANT-TYPE-NOT-ENUM: \`parseVariant\` references type '${typeName}' which is a ${resolved.kind}, not an enum. ` +
      `parseVariant only accepts scrml-native \`:enum\` types — the variant set is what dispatches on the discriminator. ` +
      `For struct boundary parsing, use a server-fn entry point with §53 SPARK predicate refinement on the typed parameter.`,
      span,
    ));
    return null;
  }
  return resolved as EnumType;
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
        if (
          (n.kind === "state-decl" || n.kind === "reactive-debounced-decl") &&
          typeof n.name === "string"
        ) {
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
      const paramName = typeof param === "string" ? param : (param as ASTNodeLike).name as string;
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
        if (stmt.kind !== "sql" && /\?\s*\{/.test(txt)) {
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
