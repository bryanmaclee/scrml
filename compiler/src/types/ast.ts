/**
 * AST Node Type System for the scrml Compiler
 *
 * Discriminated union types for all AST nodes produced by the TAB
 * (Typed AST Builder) stage of the compiler pipeline.
 *
 * This file is the single source of truth for AST shape in TypeScript.
 * Every node carries a `kind` string literal discriminant and an `id`
 * (unique within a compilation unit) plus a `span` for source location.
 *
 * No runtime code lives here — types and interfaces only.
 */

import type { AfterDurationResult } from "../codegen/parse-after-duration.js";

// ---------------------------------------------------------------------------
// Source Location
// ---------------------------------------------------------------------------

/** Byte-level source span referencing the preprocessed source. */
export interface Span {
  /** Absolute file path of the source file. */
  file: string;
  /** Byte offset of the first character. */
  start: number;
  /** Byte offset one past the last character. */
  end: number;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  col: number;
}

// ---------------------------------------------------------------------------
// Attribute Value Types
// ---------------------------------------------------------------------------

/**
 * Attribute values on markup elements.
 * Discriminated by `kind`.
 */
export type AttrValue =
  | StringLiteralAttrValue
  | VariableRefAttrValue
  | CallRefAttrValue
  | ExprAttrValue
  | PropsBlockAttrValue
  | AbsentAttrValue;

export interface StringLiteralAttrValue {
  kind: "string-literal";
  value: string;
  span: Span;
}

export interface VariableRefAttrValue {
  kind: "variable-ref";
  name: string;
  /** Phase 3: structured ExprNode form of the variable reference. */
  exprNode?: ExprNode;
  span: Span;
}

export interface CallRefAttrValue {
  kind: "call-ref";
  name: string;
  args: string[];
  /** Phase 4: structured ExprNode for each arg. */
  argExprNodes?: ExprNode[];
  span: Span;
}

export interface ExprAttrValue {
  kind: "expr";
  raw: string;
  refs: string[];
  /** Phase 3: structured ExprNode form of `raw`. Populated by ast-builder. */
  exprNode?: ExprNode;
  span: Span;
}

export interface PropsBlockAttrValue {
  kind: "props-block";
  propsDecl: unknown;
  span: Span;
}

export interface AbsentAttrValue {
  kind: "absent";
}

// ---------------------------------------------------------------------------
// Attribute Node
// ---------------------------------------------------------------------------

/** A single attribute on a markup element or state block. */
export interface AttrNode {
  name: string;
  value: AttrValue;
  span: Span;
}

// ---------------------------------------------------------------------------
// Typed Attribute Declaration (State Constructor Definitions, section 35.2)
// ---------------------------------------------------------------------------

/** A typed attribute declaration inside a state constructor definition. */
export interface TypedAttrDecl {
  /** Attribute name. */
  name: string;
  /** Raw type expression (e.g. "string", "number", "enum { A, B }"). */
  typeExpr: string;
  /** True if the type ends with `?` or has a default value. */
  optional: boolean;
  /** Default value expression if `= value` is present, or null. */
  defaultValue: string | null;
  span: Span;
}

// ---------------------------------------------------------------------------
// CSS Rule Types
// ---------------------------------------------------------------------------

/** Reactive reference inside a CSS value (e.g. `@spacing`). */
export interface CSSReactiveRef {
  /** Bare identifier without `@`. */
  name: string;
  /** Full expression string if part of an expression, null for simple refs. */
  expr: string | null;
}

/** A single CSS property declaration. */
export interface CSSDeclaration {
  prop: string;
  value: string;
  span: Span;
  /** Present when the value contains `@var` reactive references. */
  reactiveRefs?: CSSReactiveRef[];
  /** True when the value is an expression (not a simple @var reference). */
  isExpression?: boolean;
}

/** A CSS rule — either a bare property or a selector block with declarations. */
export type CSSRule = CSSPropertyRule | CSSSelectorRule;

export interface CSSPropertyRule {
  prop: string;
  value: string;
  span: Span;
  reactiveRefs?: CSSReactiveRef[];
  isExpression?: boolean;
}

export interface CSSSelectorRule {
  selector: string;
  declarations?: CSSDeclaration[];
  span: Span;
}

// ---------------------------------------------------------------------------
// Error Effect Arm (match arm in !{} blocks)
// ---------------------------------------------------------------------------

/** A single match arm in an error-effect block. */
export interface ErrorArm {
  /** Pattern: `"::TypeName"` or `"_"` (wildcard). */
  pattern: string;
  /** Binding variable name (e.g. `e`), or empty string if none. */
  binding: string;
  /** Raw handler expression string. */
  handler: string;
  /** Phase 3: structured ExprNode form of `handler` (non-block handlers only). */
  handlerExpr?: ExprNode;
  span: Span;
}

// ---------------------------------------------------------------------------
// SQL Chained Call
// ---------------------------------------------------------------------------

/** A chained method call on a SQL block (e.g. `.run()`, `.all()`, `.get()`). */
export interface SQLChainedCall {
  method: string;
  args: string;
}

// ---------------------------------------------------------------------------
// Lift Expression Target
// ---------------------------------------------------------------------------

/**
 * The target of a `lift` expression.
 * Either an inline markup node or a raw expression string.
 */
export type LiftTarget =
  | { kind: "markup"; node: ASTNode }
  | { kind: "expr"; expr: string; exprNode?: ExprNode };

// ---------------------------------------------------------------------------
// AST Node Interfaces
// ---------------------------------------------------------------------------

/** Common fields shared by every AST node. */
interface BaseNode {
  /** Unique numeric ID within the compilation unit. */
  id: number;
  /** Source location span. */
  span: Span;
}

// -- Markup --

/** An HTML/component element: `<tag attrs>children</tag>`. */
export interface MarkupNode extends BaseNode {
  kind: "markup";
  /** Element tag name (e.g. "div", "Button", "program"). */
  tag: string;
  /** Parsed attributes. */
  attrs: AttrNode[];
  /** Child AST nodes. */
  children: ASTNode[];
  /** True for self-closing elements (`<br/>`). */
  selfClosing: boolean;
  /** Closer form from the block splitter. */
  closerForm: string;
  /** True if this is a component call site (uppercase tag name).
   *  P3-FOLLOW: derived backcompat field. NR's `resolvedKind === "user-component"`
   *  is the authoritative routing source. `isComponent` is still stamped (by BS,
   *  ast-builder) for AST-shape backcompat with serialization, snapshot tests,
   *  and direct unit-test consumers that bypass NR. Stages should call the helper
   *  isUserComponentMarkup() in component-expander.ts (NR-prefer-with-fallback)
   *  rather than reading this field directly for routing decisions. */
  isComponent: boolean;
  /** P3-FOLLOW: NR-stamped resolution kind. Authoritative for routing.
   *  May be undefined on ASTs that did not have NR run (some unit-test paths). */
  resolvedKind?: 'html-builtin' | 'scrml-lifecycle' | 'user-state-type' | 'user-component' | 'unknown';
  /** P3-FOLLOW: NR-stamped resolution category. Authoritative for routing. */
  resolvedCategory?: 'html' | 'channel' | 'engine' | 'timer' | 'poll' | 'db' | 'schema' | 'request' | 'errorBoundary' | 'machine' | 'user-component' | 'user-state-type' | 'unknown';
  // Auth/middleware fields added by buildAST when tag === "program":
  auth?: string;
  loginRedirect?: string;
  csrf?: string;
  sessionExpiry?: string;
}

// -- Text & Comment --

/** A raw text node. */
export interface TextNode extends BaseNode {
  kind: "text";
  /** The text content. */
  value: string;
}

/** An HTML comment node. */
export interface CommentNode extends BaseNode {
  kind: "comment";
  /** The comment content (without delimiters). */
  value: string;
}

// -- State --

/** A state instantiation block: `< statetype attrs>children</ statetype>`. */
export interface StateNode extends BaseNode {
  kind: "state";
  /** The state type name (e.g. "card", "user"). */
  stateType: string;
  /** Parsed attributes. */
  attrs: AttrNode[];
  /** Child AST nodes. */
  children: ASTNode[];
}

/**
 * A state constructor definition (section 35.2).
 * Declares a state type with typed attributes.
 */
export interface StateConstructorDefNode extends BaseNode {
  kind: "state-constructor-def";
  /** The state type name being defined. */
  stateType: string;
  /** Typed attribute declarations (e.g. `name(string)`, `age(number?)`). */
  typedAttrs: TypedAttrDecl[];
  /** Any non-typed attributes (metadata). */
  attrs: AttrNode[];
  /** Constructor body nodes. */
  children: ASTNode[];
}

// -- Logic --

/** A logic block: `${ ... }`. Contains parsed statements. */
export interface LogicNode extends BaseNode {
  kind: "logic";
  /** Parsed statements and declarations. */
  body: LogicStatement[];
  /** Import declarations hoisted from this block. */
  imports: ImportDeclNode[];
  /** Export declarations hoisted from this block. */
  exports: ExportDeclNode[];
  /** Type declarations hoisted from this block. */
  typeDecls: TypeDeclNode[];
  /** Component definitions hoisted from this block. */
  components: ComponentDefNode[];
}

// -- SQL --

/** A SQL block: `?{ query }.method(args)`. */
export interface SQLNode extends BaseNode {
  kind: "sql";
  /** The raw SQL query string. */
  query: string;
  /** Chained method calls (`.run()`, `.all()`, `.get()`). */
  chainedCalls: SQLChainedCall[];
  /**
   * Compile-time marker (§8.9.5). When true, the Batch Planner (§PIPELINE
   * Stage 7.5) excludes this SQL node from all coalescing candidate sets
   * (§8.9.1) and from §8.10 loop hoisting. Set by ast-builder when the
   * user writes `.nobatch()` in the chain; the method itself is dropped
   * from `chainedCalls` since it has no runtime effect.
   */
  nobatch?: boolean;
}

// -- CSS Inline --

/** An inline CSS block: `#{ prop: value; ... }`. */
export interface CSSInlineNode extends BaseNode {
  kind: "css-inline";
  /** Parsed CSS rules. */
  rules: CSSRule[];
}

// -- Style Block --

/** A `<style>` block containing CSS. */
export interface StyleNode extends BaseNode {
  kind: "style";
  /** Parsed CSS rules (may be empty — detailed parsing deferred to children). */
  rules: CSSRule[];
  /** Child nodes (text/comment containing CSS content). */
  children: ASTNode[];
}

// -- Error Effect --

/** An error-effect block: `!{ | pattern binding -> handler }`. */
export interface ErrorEffectNode extends BaseNode {
  kind: "error-effect";
  /** Match arms. */
  arms: ErrorArm[];
}

// -- Meta --

/** A meta block: `^{ ... }`. Compile-time code execution. */
export interface MetaNode extends BaseNode {
  kind: "meta";
  /** Parsed statements (same grammar as logic blocks). */
  body: LogicStatement[];
  /** The context this meta block appears in (markup, state, logic, sql, css, error, meta). */
  parentContext: string;
}

// -- F8 / v0.6 — native-parser kind-naming dual-mode predicates ----------
//
// The live (block-splitter + ast-builder) pipeline tags a meta block
// `kind: "meta"` and an error-effect block `kind: "error-effect"`. The
// scrml-native parser's block-stream catalog is uniformly PascalCase — it
// tags the same two constructs `kind: "Meta"` and `kind: "ErrorEffect"`.
// Aligning the native emitter to lowercase would break the native
// catalog's internal consistency (Markup / LogicEscape / Sql / Css / Test
// are all PascalCase); the F2-precedent reconciliation is therefore a
// downstream dual-mode kind-test. These predicates centralize the
// dual-mode check so the ~17 downstream meta walk-sites and the
// error-effect switch arms accept BOTH spellings — the live pipeline and
// the M5-swap native pipeline both work. Until the M5 swap activates the
// native parser the PascalCase branch is never exercised; it is
// forward-prep, harmless to the live pipeline.

/** True for a meta block node from EITHER pipeline (`"meta"` / `"Meta"`). */
export function isMetaKind(kind: unknown): boolean {
  return kind === "meta" || kind === "Meta";
}

/** True for an error-effect block from EITHER pipeline (`"error-effect"` / `"ErrorEffect"`). */
export function isErrorEffectKind(kind: unknown): boolean {
  return kind === "error-effect" || kind === "ErrorEffect";
}

// -- Destructuring Patterns (A5 2026-05-17) --
//
// Structured AST representation of array/object destructuring patterns. The
// shape replaces A1's text-and-regex workaround in type-system.ts. Carried by
// `let-decl.name`, `const-decl.name`, and `for-stmt.variable` — the field is a
// string for bare-ident bindings, or a DestructurePattern for the LHS of a
// destructured form (`const [a, b] = x`, `for (const {a, b} of xs)`).

/** Array-pattern element. `hole` represents an empty slot in `[a, , b]`. */
export type DestructureArrayElement =
  | { kind: "name"; name: string; default?: string; defaultExpr?: ExprNode }
  | { kind: "nested"; pattern: DestructurePattern; default?: string; defaultExpr?: ExprNode }
  | { kind: "hole" };

/** Object-pattern property. `nested` carries a deeper pattern at the bound position. */
export type DestructureObjectProperty =
  | {
      kind: "name";
      /** The source field — `a` in `{ a }`, `a` in `{ a: ren }`. */
      fieldName: string;
      /** The bound identifier — `a` in `{ a }`, `ren` in `{ a: ren }`. */
      bindName: string;
      default?: string;
      defaultExpr?: ExprNode;
    }
  | {
      kind: "nested";
      fieldName: string;
      pattern: DestructurePattern;
      default?: string;
      defaultExpr?: ExprNode;
    };

export interface DestructureArrayPattern {
  kind: "destructure-array";
  elements: DestructureArrayElement[];
  /** Rest-binding name for `[a, ...rest]`. */
  rest?: string;
  span?: Span;
}

export interface DestructureObjectPattern {
  kind: "destructure-object";
  properties: DestructureObjectProperty[];
  /** Rest-binding name for `{ a, ...rest }`. */
  rest?: string;
  span?: Span;
}

export type DestructurePattern = DestructureArrayPattern | DestructureObjectPattern;

// -- Variable Declarations --

/** A `let` declaration: `let name = expr`. */
export interface LetDeclNode extends BaseNode {
  kind: "let-decl";
  /** Variable name, or a destructuring pattern (A5 2026-05-17). */
  name: string | DestructurePattern;
  /** If-as-expression: `let a = if (cond) { lift val }`. */
  ifExpr?: IfExprNode;
  /** For-as-expression: `let names = for (item of items) { lift item.name }`. */
  forExpr?: ForExprNode;
  /** Match-as-expression: `let result = match expr { .A => { lift val } }`. */
  matchExpr?: MatchExprNode;
  /** Structured ExprNode form of the initializer. Populated by ast-builder for non-placeholder cases. */
  initExpr?: ExprNode;
}

/** A `const` declaration: `const name = expr`. */
export interface ConstDeclNode extends BaseNode {
  kind: "const-decl";
  /** Variable name, or a destructuring pattern (A5 2026-05-17). */
  name: string | DestructurePattern;
  /** If-as-expression: `const a = if (cond) { lift val }`. */
  ifExpr?: IfExprNode;
  /** For-as-expression: `const names = for (item of items) { lift item.name }`. */
  forExpr?: ForExprNode;
  /** Match-as-expression: `const result = match expr { .A => { lift val } }`. */
  matchExpr?: MatchExprNode;
  /** Structured ExprNode form of the initializer. Populated by ast-builder for non-placeholder cases. */
  initExpr?: ExprNode;
}

/**
 * A tilde declaration: bare `name = expr` (no keyword).
 * Declares a ~-typed must-use variable.
 */
export interface TildeDeclNode extends BaseNode {
  kind: "tilde-decl";
  /** Variable name. */
  name: string;
  /** Structured ExprNode form of the initializer. Populated by ast-builder for non-placeholder cases. */
  initExpr?: ExprNode;
}

/**
 * A lin declaration: `lin name = expr` (§35.2).
 * Declares an immutable linear-type variable that must be consumed exactly once.
 */
export interface LinDeclNode extends BaseNode {
  kind: "lin-decl";
  /** Variable name. */
  name: string;
  /** Structured ExprNode form of the initializer. Populated by ast-builder for non-placeholder cases. */
  initExpr?: ExprNode;
}

// -- Reactive Declarations --

/** A reactive declaration: `@name = expr` (legacy @-form) or `<name> = expr` (structural). */
export interface ReactiveDeclNode extends BaseNode {
  kind: "state-decl";
  /** Reactive variable name (without `@`). */
  name: string;
  /** True if declared with `@shared` modifier (section 37.4). */
  isShared?: boolean;
  /** Structured ExprNode form of the initializer. Populated by ast-builder for non-placeholder cases. */
  initExpr?: ExprNode;
  /**
   * Phase A1a Step 4 — discriminant per AST-CONTRACTS-AND-DECOMPOSITION §1.1.
   * `"plain"` ↔ mutable cell with initExpr; `"derived"` ↔ const-derived cell;
   * `"decl-with-spec"` ↔ Shape 2 with renderSpec (deferred to Step 5).
   */
  shape?: "plain" | "decl-with-spec" | "derived";
  /**
   * Phase A1a Step 4 — true iff `<name>` form, false iff `@name` form (legacy).
   * Always set by ast-builder.
   */
  structuralForm?: boolean;
  /**
   * Phase A1a Step 4 — true iff `const <name> = expr` derived form.
   * Always set by ast-builder.
   */
  isConst?: boolean;
  /**
   * Phase A1a Step 5 — Shape 2 only. The render-spec sub-node wrapping the
   * bindable markup RHS (e.g., `<input type="text"/>`). Present iff
   * `shape === "decl-with-spec"`. Mutually exclusive with `initExpr`.
   */
  renderSpec?: RenderSpecNode | null;
  /**
   * Phase A1a Step 5 — Shape 2 validators field. Array of validator entries
   * collected from bareword/call-form attributes between `<NAME` and `>`.
   * Empty array `[]` for Shape 2 with no validators. Undefined for Shape 1/3.
   *
   * Per AST-CONTRACTS-AND-DECOMPOSITION §1.1, `args` is the parsed expression
   * list (`ValidatorArg[]`). Step 5 collects raw text into `args: [rawText]`
   * (single-element array of joined paren contents); Phase A1b Step B9
   * (validator-arg-parser) replaces `args` with the structured form: each
   * arg is parsed into an `ExprNode` for standard predicates or a
   * `RelationalPredicateNode` for the `length(>=N)`-style sub-grammar
   * (which is not standalone-parseable JavaScript). Bareword `args: null`
   * and zero-arg-call `args: []` are preserved as-is.
   */
  validators?: ValidatorEntry[];
  /**
   * Phase A1a Step 6 — `default=<expr>` attribute on a structural state-decl.
   * Parsed into an ExprNode (acorn AST). `null` when the attribute is absent.
   * Per SPEC §6.8 the default expression is used for `reset(@cell)` lowering
   * (A1c codegen); A1b will validate type-compatibility with the cell type.
   */
  defaultExpr?: ExprNode | null;
  /**
   * Phase A1a Step 6 — `pinned` bareword modifier on a structural state-decl.
   * `true` iff the bareword was present between `<NAME` and `>`. A1b consumes
   * for forward-reference legality; A1c hoists pinned declarations.
   */
  pinned?: boolean;
  /**
   * Phase A1a Step 11.0a — Variant C compound state children (SPEC §6.3.2).
   * Populated on a compound parent state-decl; each child is itself a
   * state-decl (Shape 1/2/3). Per AST-CONTRACTS-AND-DECOMPOSITION §1.1,
   * the parent carries `shape:"plain"`, `initExpr: null`, `structuralForm:
   * true`, `isConst: false`. Empty array `[]` is a legal empty compound.
   *
   * Mutually exclusive with `initExpr` and `renderSpec`: when `children` is
   * present, the cell's value is the structural compound, not an init expr
   * or a render-spec.
   *
   * Undefined on non-compound state-decls.
   */
  children?: ReactiveDeclNode[];
  /**
   * S79 Phase 2 — Reactivity attributes (SPEC §6.13).
   *
   * `debounced=DURATION` / `throttled=DURATION` wrap the cell's write path
   * with timing semantics. DURATION grammar reuses parseAfterDuration
   * (literal `Nms`/`Ns`/`Nm`/`Nh` OR computed `${expr}<unit>`).
   *
   * Mutually exclusive: at most one of `debounced` and `throttled` is
   * present per cell. Dual-attr fires E-REACTIVITY-ATTR-CONFLICT (B14
   * typer).
   *
   * Forbidden on derived cells (`isConst: true`) — fires
   * E-DEBOUNCED-WITH-DERIVED. Forbidden on `<x server>` cells — fires
   * E-DEBOUNCED-WITH-SERVER. Both checks live in B14 typer.
   *
   * Codegen wraps the write path:
   *   `debounced` → `_scrml_reactive_debounced(name, () => valueExpr, ms)`
   *   `throttled` → `_scrml_reactive_throttled(name, () => valueExpr, ms)`
   *
   * Computed-form lowers to a runtime msExpr arrow-fn (mirror A5-5
   * codegen pattern at emit-engine.ts:emitEngineTimersTable).
   */
  reactivity?: {
    debounced?: AfterDurationResult;
    throttled?: AfterDurationResult;
  };
  /**
   * Phase A1a Step 11.0c — typed state-decl annotation (SPEC §6.2 + §53).
   * Raw type-expression text from the `:T` annotation; matches the same
   * STRING-form representation used for typed `let`/`const`/function-param
   * annotations elsewhere in the AST (LambdaParam.typeAnnotation, etc.).
   *
   * Populated on:
   *   - structural form: `<count>: number = 0` (typed Shape 1)
   *   - structural form: `<userInfo>: UserInfo = (a, b, c)` (Tier 3 positional, §14.11)
   *   - structural form: `<phase>: Phase = .Idle` (bare-variant inference, §14.10)
   *   - structural form: `const <doubled>: number = expr` (typed Shape 3 derived)
   *   - structural form: `<email>: string(pattern(/.../)) = <input/>` (refinement-typed Shape 2)
   *   - legacy `@`-form: `@count: number = 0` (already supported pre-11.0c)
   *
   * Refinement-type predicate forms (`string(pattern(...))`) are stored
   * verbatim — A1b owns parse-into-predicate-AST and runtime predicate
   * synthesis; A1c (or A1c follow-up) emits validator-equivalent runtime
   * checks where appropriate.
   *
   * Undefined when the decl has no `:T` annotation.
   */
  typeAnnotation?: string;
}

/**
 * Phase A1b Step B9 — relational-predicate sub-grammar node.
 *
 * Captures the `<rel-op> <expr>` form that appears as the argument to
 * `length(...)` validators (per SPEC §55.1): `length(>=2)`, `length(<=N)`,
 * `length(<5)`, `length(>0)`, `length(=N)`, `length(!=0)`. The form is NOT
 * standalone-parseable JavaScript (no LHS for the operator) — it carries
 * the comparison semantics that B10 (validator type-checking) and A1c
 * (codegen) need to lower into runtime checks.
 *
 * NOT part of the ExprNode discriminated union — appears only inside
 * ValidatorEntry.args. The dep-graph walker in `forEachIdentInExprNode`
 * special-cases this kind to traverse `value` for reactive @cell tracking
 * (per audit §1.7 + §55.11 cross-field validator semantics).
 *
 * Note on the wider grammar: the spec table at §55.1 lists `length(predicate)`
 * generically — only the relational forms above are observed in worked
 * examples. If §55 is ever extended to admit nested predicates here
 * (e.g. `length(req)`), the parser will need extending; for now the operator
 * set is closed at the six relational comparisons above.
 */
export interface RelationalPredicateNode {
  kind: "relational-predicate";
  /**
   * Source span. Uses ExprSpan shape (structurally identical to Span) so
   * the node composes naturally with ExprNode children.
   */
  span: ExprSpan;
  /** Comparison operator. */
  op: ">=" | "<=" | "<" | ">" | "=" | "!=";
  /** Right-hand-side expression: the threshold (numeric literal, @cell ref, etc.). */
  value: ExprNode;
}

/**
 * Phase A1a Step 5 — bareword/call-form validator on a state-decl.
 *
 * Bareword: `name` is the predicate identifier (`req`, `email`, `numeric`),
 * `args` is null.
 *
 * Call-form: `name` is the predicate identifier (`length`, `min`, `eq`),
 * `args` is an array of parsed argument nodes. Per AST-CONTRACTS §1.1 and
 * Phase A1b Step B9, the array element type is `ExprNode` for standard
 * predicate args (numeric, regex, comparison, array-of-variants, @cell ref)
 * and `RelationalPredicateNode` for the `length(>=N)`-style relational form.
 *
 * Per audit §1.5: the empty-array vs null distinction is preserved across
 * the B9 transform. `args: null` ↔ bareword form (`<x req>`); `args: []` ↔
 * zero-arg call form (`<x req()>`); `args: [...]` ↔ non-empty call form.
 *
 * Step 5 produces a single-element raw-text array (`["raw text"]`); B9
 * replaces that with the parsed array of length 1 (universal-core predicates
 * all take exactly one argument when in call-form per §55.1).
 */
export interface ValidatorEntry {
  /** Predicate name (e.g., "req", "length", "min", "pattern"). */
  name: string;
  /**
   * Parsed argument list; null for bareword validators (no parens at all).
   * Empty array `[]` legal for zero-arg call form (`req()`). Non-empty array
   * holds parsed expressions; for `length(...)` predicates the element is a
   * `RelationalPredicateNode`; for everything else it is an `ExprNode`.
   */
  args: ValidatorArg[] | null;
  /** Source span covering the validator (name + args region). */
  span: Span;
  /**
   * Phase A1b Step B13 — Level-1 inline override on this validator
   * (per SPEC §55.10 4-level error message resolution chain). The trailing
   * string-literal arg, when present and matching the catalog's
   * `inline-message-override` slot, is extracted onto this field by the B13
   * walker for A1c codegen consumption.
   *
   *   `<name req("Please enter your name")>` → `inlineOverride: "Please enter your name"`
   *   `<name length(>=2, "Must be at least 2 chars")>` → `inlineOverride: "Must be at least 2 chars"`
   *   `<name req>` (no override) → `inlineOverride: null`
   *
   * Static-string only per L12 Edge F — non-string-literal trailing args fire
   * `E-VALIDATOR-INLINE-DYNAMIC` (§34, added at S68 audit). The annotation is
   * set by the B13 walker (`walkRejectDerivedWithValidatorsAndExtractOverride`
   * in `compiler/src/symbol-table.ts`).
   *
   * `undefined` until the B13 walker runs; `null` after it has run with no
   * override present; a string when extracted.
   */
  inlineOverride?: string | null;
}

/**
 * Phase A1b Step B9 — element type for `ValidatorEntry.args`.
 *
 * The discriminator is `kind`: standard ExprNode kinds (per the ExprNode union)
 * or `"relational-predicate"` for the relational-form (length(>=N)) sub-grammar.
 */
export type ValidatorArg = ExprNode | RelationalPredicateNode;

/**
 * Phase A1a Step 5 — `kind: "render-spec"` AST sub-node per
 * AST-CONTRACTS-AND-DECOMPOSITION §1.2.
 *
 * Wraps a markup AST node as the bindable render-spec for a Shape 2 state-decl.
 * Stable type-tag distinguishes "this markup is a render-spec for a state cell"
 * from "this markup is a value being assigned to a state cell" (matters for
 * A1b's bindable-classifier and A1c's bind:* dispatch).
 */
export interface RenderSpecNode extends BaseNode {
  kind: "render-spec";
  /** The bindable markup AST node (input/textarea/select). */
  element: MarkupNode;
}

// ReactiveDerivedDeclNode (kind:"reactive-derived-decl") was retired at
// Phase A1a Step 11.5 — folded into state-decl with shape:"derived" +
// isConst:true + structuralForm:false. ADR Option A FOLD ratified S60.
// The interface declaration was dropped at S64 Phase 4d completion sweep.
// New code uses `ReactiveDeclNode` (kind:"state-decl") with the
// discriminants above.

// ReactiveDebouncedDeclNode (kind: "reactive-debounced-decl") was retired at
// S79 — the pre-v0.next `@debounced(N) name = expr` keyword-form modifier is
// superseded by the canonical state-decl reactivity attribute form
// `<name debounced=Nms> = expr` (SPEC §6.13, ratified at S78 deep-dive
// `scrml-support/docs/deep-dives/debounce-and-timing-2026-05-10.md` §6
// Approach B clean-cut). Per the deep-dive's "no deprecation cycle since
// no real adopters" decision (corpus footprint = 2 probe fixtures), the
// pre-v0.next form was deleted outright; the parser will reject the
// syntax with a generic parse error.

/**
 * A reactive nested assignment: `@obj.path.to.prop = value`.
 * Assigns to a nested property of a reactive variable.
 */
export interface ReactiveNestedAssignNode extends BaseNode {
  kind: "reactive-nested-assign";
  /** Root reactive variable name (without `@`). */
  target: string;
  /**
   * Heterogeneous path segments. A dotted `.field` segment (and a bare-literal
   * bracket index like `[0]` / `["DAL"]`) is a STRING (e.g. ["path", "to",
   * "prop"]). A NON-literal bracket index (`@arr[@sel] = x`, cycles-prereq
   * S168 COW-all) is a COMPUTED segment `{ index: ExprNode }` carrying the
   * index expression; codegen emits it inline so the path reaches
   * `_scrml_deep_set` as a JS array literal.
   */
  path: (string | { index?: ExprNode; raw?: string })[];
  /** Structured ExprNode form of the value. Populated by ast-builder. */
  valueExpr?: ExprNode;
}

/**
 * V-kill (S123) — A bare reactive assignment: `@name = value` parsed inside
 * a fn / function / user-written `${...}` body (NOT at `<program>` / `<page>`
 * body-top under default-logic mode, where auto-lift to structural state-decl
 * still applies per §40.8 — Unit CC territory).
 *
 * Replaces the pre-S123 behavior where ast-builder unconditionally emitted
 * `state-decl` for every `@name = expr`, silently synthesising a phantom
 * cell that SPEC §6.1.1 + §6.2 do not authorise.
 *
 * SYM PASS 3 (`resolveAtNameOnExprNode`) fires `E-STATE-UNDECLARED` when
 * `target` (or any `@name` in `valueExpr`) does not resolve to a structurally
 * declared state cell in scope. See deep-dive
 * `scrml-support/docs/deep-dives/auto-state-cell-synthesis-investigation-2026-05-23.md`.
 */
export interface ReactiveAssignNode extends BaseNode {
  kind: "reactive-assign";
  /** Reactive variable name (without `@`). */
  target: string;
  /** Raw value expression text (mirrors `state-decl.init` shape for emit-* reuse). */
  value: string;
  /** Structured ExprNode form of the value. Populated by ast-builder. */
  valueExpr?: ExprNode;
}

/**
 * A reactive array mutation: `@arr.push(item)`, `@arr.splice(0, 1)`, etc.
 * Triggers reactive update after the mutation.
 */
export interface ReactiveArrayMutationNode extends BaseNode {
  kind: "reactive-array-mutation";
  /** Root reactive variable name (without `@`). */
  target: string;
  /** Array method name (push, pop, shift, unshift, splice, sort, reverse, fill). */
  method: string;
  /** Raw arguments string. */
  args: string;
}

/** An explicit reactive set: `@set(@obj, "path", value)`. Escape hatch. */
export interface ReactiveExplicitSetNode extends BaseNode {
  kind: "reactive-explicit-set";
  /** Raw arguments string. */
  args: string;
}

// -- Function Declaration --

/** A function declaration: `[server] function|fn name(params) [!] { body }`. */
export interface FunctionDeclNode extends BaseNode {
  kind: "function-decl";
  /** Function name. */
  name: string;
  /** Parameter list (raw strings). */
  params: string[];
  /** Function body statements. */
  body: LogicStatement[];
  /** Declaration style: "function" (full) or "fn" (shorthand). */
  fnKind: "function" | "fn";
  /** True if prefixed with `server` keyword. */
  isServer: boolean;
  /** True if declared as a generator function (`function*`). */
  isGenerator?: boolean;
  /**
   * True if prefixed with `async` keyword.
   *
   * S89 §13.2 Sub-Phase B (2026-05-13):
   * - `async function name()` and `async fn name {...}` set this flag.
   * - Surfaces the `Promise<T>` return shape to the auto-await classifier
   *   (`compiler/src/codegen/scheduling.ts`), which broadens its predicate from
   *   "server function" to "any statically-known `Promise<T>`-returning callee"
   *   per SPEC §13.2.1.
   * - **Stdlib carve-out (Q5 ratified S89, SPEC §13.1 amendment).** Permitted
   *   ONLY in stdlib `scrml:*` modules (files under `<repo>/stdlib/`). User
   *   source declaring `async function` fires `I-ASYNC-USER-SOURCE` (info-
   *   level lint per §13.1). The lint fires post-parse; the flag is still
   *   recorded on the AST for downstream observability.
   */
  isAsync?: boolean;
  /** True if the function can fail (`!` suffix). */
  canFail: boolean;
  /** Error type name when `! -> ErrorType` is specified. */
  errorType?: string;
  /** Route path for server functions (e.g. "/api/users"). */
  route?: string;
  /** HTTP method for server functions (e.g. "GET", "POST"). */
  method?: string;
  /**
   * True if this is a handle() escape hatch function (section 39.3.1).
   * Recognized by: isServer && !isGenerator && name === "handle".
   */
  isHandleEscapeHatch?: boolean;
  /**
   * True if prefixed with `pinned` keyword (S98 SPEC §48.6.4).
   *
   * Opts the `fn` declaration OUT of hoisting per §6.10. A forward reference
   * to a `pinned fn` SHALL fire `E-STATE-PINNED-FORWARD-REF` (§34). Valid
   * only when `fnKind === "fn"`; the `function` keyword has no pinned form.
   * Outermost prefix — must precede any other modifier (`async`/`pure`/`server`).
   *
   * **S105 status (2026-05-19):** parser-recognition landed; symbol-table
   * forward-ref enforcement is a separate follow-on dispatch. AST flag
   * propagates but downstream consumers are TBD.
   */
  isPinned?: boolean;
}

// -- Component Definition --

/**
 * A component definition: `const ComponentName = <element ...>`.
 * Recognized when `const` declaration name starts with uppercase
 * (outside of meta context).
 */
export interface ComponentDefNode extends BaseNode {
  kind: "component-def";
  /** Component name (PascalCase). */
  name: string;
  /** Raw expression (the component template). */
  raw: string;
}

/**
 * An engine declaration: `<engine for=Type ...>{state-children}</>`.
 *
 * The TypeScript AST has historically declared engine-decl shapes inline in
 * consumer files (see `EngineDeclLike` in `codegen/emit-engine.ts`); this
 * interface centralizes the surface used by Phase A10 body-render and is
 * intentionally NOT part of the `ASTNode` union below — adding it would force
 * exhaustive-switch updates across many consumer sites for no payoff. Local
 * inline interfaces in consumer files remain the dominant pattern; this
 * interface gives walker authors a typed shape to import when they want one.
 *
 * Fields below mirror the runtime shape produced by `ast-builder.js` engine
 * construction (see line ~9112).
 */
export interface EngineDeclNode extends BaseNode {
  kind: "engine-decl";
  /** §51.0.A — back-compat with legacy `name=` form. Mirrors `varName`. */
  engineName: string;
  /** §51.0.A — `for=Type` (the governed enum/type). */
  governedType: string;
  /**
   * Raw concatenated body text — substring of the engine's source between
   * the opener `>` and the closing `</>`. Consumed by the secondary structural
   * parser `engine-statechild-parser.ts` (state-children + `<onTimeout>` +
   * `<onTransition>` + `<onIdle>` + nested `<engine>` extraction) and by the
   * legacy-machine arrow-rule type-system path. Phase A10 retains this verbatim.
   */
  rulesRaw: string;
  /**
   * Phase A10 (S78, 2026-05-10) — walkable body children, additive.
   *
   * The block-splitter produces typed walkable children for the engine body
   * (markup, state, logic, text, comment, structural elements). Pre-A10
   * those children were discarded after concatenating into `rulesRaw`.
   * A10 preserves them as `bodyChildren` so:
   *   - A1b walker PASSes (1, 2, 3, 5, 6, 13, 14, possibly 11) can descend
   *     into engine state-child bodies for `@cell` resolution, derived-mutate
   *     checks, render-by-tag, B17 component-engine-scope, B22 reset-target.
   *   - Future body-render codegen (Phase A10 Phase 3+4) walks `bodyChildren`
   *     to emit per-state-child render functions guarded on the engine
   *     variable's variant.
   *
   * Field is OPTIONAL for backward compatibility — tests / harnesses that
   * synthesize engine-decl AST nodes directly without going through
   * ast-builder will leave it `undefined`; consumers must guard with
   * `Array.isArray(node.bodyChildren)` before descending.
   *
   * The array contains ALL children in their source order (markup nodes for
   * state-children + structural element markup + interpolations + text +
   * comments + nested engine-decls). Codegen emission filters structural
   * elements (`<onTimeout>`, `<onTransition>`, `<onIdle>`, nested `<engine>`)
   * out at the body-render boundary; A1b walkers walk every child uniformly.
   */
  bodyChildren?: ASTNode[];
  /** §51.9 — name of the source reactive var (no `@` prefix), or null. */
  sourceVar: string | null;
  /** §51.0.C — resolved auto-declared variable name (or override). */
  varName: string;
  /** §51.0.B — non-null iff `var=NAME` was present. */
  varNameOverride: string | null;
  /** §51.0.E — non-null iff `initial=.X` was present. */
  initialVariant: string | null;
  /**
   * §51.0.S.2.2 (S154 — #14 event-payload-transition) — the raw enum-type
   * identifier from the `accepts=MsgType` engine-OPENER attribute, or null
   * when absent. Declares the message vocabulary the engine's `(state ×
   * message)` arms dispatch on (the per-state message-arm exhaustiveness is
   * checked against this type's variant set, §51.0.S).
   *
   * PARSER (batch 1) RECORDS the identifier verbatim. The typer (batch 2)
   * resolves it to a declared `:enum` — non-resolution fires
   * `E-ENGINE-ACCEPTS-NOT-ENUM` (§34); a state-child message-arm with no
   * `accepts=` fires `E-ENGINE-MSG-WITHOUT-ACCEPTS` (§34). OPTIONAL field for
   * backward compatibility — engine-decls synthesized directly (not via
   * ast-builder) leave it `undefined`; consumers guard with a null/undefined
   * check.
   */
  acceptsType?: string | null;
  /** §51.0.B + §6.10 — true iff `pinned` bareword was present. */
  pinned: boolean;
  /** Set later by export Form 1 detection in `liftBareDeclarations`. */
  isExported: boolean;
  /** True iff opener was `< engine` (with a space) rather than `<engine`. */
  openerHadSpaceAfterLt: boolean;
  /** True iff this engine-decl was authored with the legacy `<machine>` keyword. */
  legacyMachineKeyword: boolean;
  /**
   * True iff an explicit `name=` attribute was present on the opener — the
   * §51.3.2 NAMED-machine form (`<engine name=X for=T>` / `<machine name=X
   * for=T>`), which admits a whole-body arrow-rule grammar. False for the
   * §51.0.C state-engine form (`<engine for=T initial=...>`), whose body must
   * use state-child `rule=` openers (6nz B2, 2026-06-24).
   */
  hadNameAttr?: boolean;
}

// -- Control Flow --

/** An if/else-if/else chain: `if condition { consequent } else { alternate }`. */
export interface IfStmtNode extends BaseNode {
  kind: "if-stmt";
  /** Consequent branch statements. */
  consequent: LogicStatement[];
  /** Alternate branch (else/else-if chain), or null. */
  alternate: LogicStatement[] | null;
  /** Structured ExprNode form of the condition. Populated by ast-builder. */
  condExpr?: ExprNode;
}

/** An if-as-expression: `const a = if (cond) { lift val }`. */
export interface IfExprNode extends BaseNode {
  kind: "if-expr";
  /** Consequent branch statements. */
  consequent: LogicStatement[];
  /** Alternate branch (else chain), or null. */
  alternate: LogicStatement[] | null;
  /** Structured ExprNode form of the condition. Populated by ast-builder. */
  condExpr?: ExprNode;
}

/** A for-as-expression: `const names = for (item of items) { lift item.name }`. */
export interface ForExprNode extends BaseNode {
  kind: "for-expr";
  /** Loop variable name. */
  variable: string;
  /** Loop body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the iterable. Populated by ast-builder. */
  iterExpr?: ExprNode;
}

/** A match-as-expression: `const result = match expr { .A => { lift val } }`. */
export interface MatchExprNode extends BaseNode {
  kind: "match-expr";
  /** Body statements (match arms). */
  body: LogicStatement[];
  /** Structured ExprNode form of the header. Populated by ast-builder. */
  headerExpr?: ExprNode;
  /**
   * §18.19 multi-scrutinee head: raw per-scrutinee source text, one entry per
   * `match (e1, …, eN)` head position (length ≥ 2). Absent ⇒ single-scrutinee.
   */
  scrutinees?: string[];
  /** §18.19 — structured ExprNode form of each scrutinee. Populated by ast-builder. */
  scrutineeExprs?: ExprNode[];
}

/** A for loop: `for variable in iterable { body }`. */
export interface ForStmtNode extends BaseNode {
  kind: "for-stmt";
  /**
   * Loop variable. String for bare-ident form (`for (const x of xs)`); a
   * `DestructurePattern` for destructured LHS (`for (const [a, b] of xs)`,
   * `for (const {a, b: ren} of xs)`) — A5 2026-05-17.
   * `null` for C-style `for (init; cond; update)` headers.
   */
  variable: string | DestructurePattern | null;
  /** Loop body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the iterable. Populated by ast-builder. */
  iterExpr?: ExprNode;
  /** Phase 4: C-style for-loop parts `(init; cond; update)` parsed individually. */
  cStyleParts?: { initExpr: ExprNode; condExpr: ExprNode; updateExpr: ExprNode };
}

/** A while loop: `while condition { body }`. */
export interface WhileStmtNode extends BaseNode {
  kind: "while-stmt";
  /** Loop body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the condition. Populated by ast-builder. */
  condExpr?: ExprNode;
}

/** A return statement: `return expr`. */
export interface ReturnStmtNode extends BaseNode {
  kind: "return-stmt";
  /** Structured ExprNode form of the return expression. Populated by ast-builder. */
  exprNode?: ExprNode;
}

/** A throw statement: `throw ErrorType("message")`. */
export interface ThrowStmtNode extends BaseNode {
  kind: "throw-stmt";
  /** Structured ExprNode form of the throw expression. Populated by ast-builder. */
  exprNode?: ExprNode;
}

/** A switch statement: `switch header { body }`. */
export interface SwitchStmtNode extends BaseNode {
  kind: "switch-stmt";
  /** Body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the header. Populated by ast-builder. */
  headerExpr?: ExprNode;
}

/** A try/catch/finally statement. */
export interface TryStmtNode extends BaseNode {
  kind: "try-stmt";
  /** Try header (usually empty). */
  header: string;
  /** Try body statements. */
  body: LogicStatement[];
  /** Catch clause, if present. */
  catchNode?: {
    header: string;
    body: LogicStatement[];
  };
  /** Finally clause, if present. */
  finallyNode?: {
    header: string;
    body: LogicStatement[];
  };
}

/** A match statement (pattern matching): `match header { body }`. */
export interface MatchStmtNode extends BaseNode {
  kind: "match-stmt";
  /** Body statements (match arms). */
  body: LogicStatement[];
  /** Structured ExprNode form of the header. Populated by ast-builder. */
  headerExpr?: ExprNode;
}

/**
 * A structured inline match arm: `.Variant => result` (no braces).
 *
 * Produced by the AST builder for inline (single-expression) match arms.
 * Previously these fell through to `bare-expr` nodes and were regex-parsed
 * at codegen time. With this node, the AST carries structured data and
 * codegen can skip the regex parse for a fast path.
 *
 * Block arms (with `{ }`) produce `match-arm-block` nodes instead.
 */
export interface MatchArmInlineNode extends BaseNode {
  kind: "match-arm-inline";
  /**
   * The full pattern text: `.Loading`, `.Ready(data)`, `"string"`, `else`, `not`.
   * For variant arms, includes the dot prefix and optional payload parens.
   */
  test: string;
  /** Optional payload binding name extracted from `.Variant(binding)`. */
  binding?: string;
  /** The result expression as a raw string. */
  result: string;
  /** The result expression as a structured ExprNode (via safeParseExprToNode). */
  resultExpr?: ExprNode;
}

// -- Expressions --

/** A bare expression (fallback when no declaration keyword matches). */
export interface BareExprNode extends BaseNode {
  kind: "bare-expr";
  /**
   * Structured ExprNode form of the expression. Always populated by ast-builder.
   *
   * Phase 4d Step 8 (S40): the deprecated `expr?: string` field has been removed
   * from the TypeScript surface. The runtime `.expr` value is still written by
   * ast-builder.js for backward compat with JS consumers (read via duck typing
   * or `(node as any).expr`), but TypeScript no longer acknowledges it as part
   * of the BareExprNode contract. Consumers MUST prefer exprNode.
   */
  exprNode?: ExprNode;
}

/**
 * An HTML fragment token that leaked through the parser into a logic context.
 * Phase 4: reclassified from bare-expr to avoid conflating markup with JS expressions.
 * In emit-logic, these are dropped (not valid JS). In emit-lift, they participate
 * in tag reconstruction for fragmented lift expressions.
 */
export interface HtmlFragmentNode extends BaseNode {
  kind: "html-fragment";
  /** Raw HTML fragment text (opening tags, closing tags, attribute fragments). */
  content: string;
}

/**
 * A lift expression: `lift <markup>` or `lift expr`.
 * Lifts a value from a logic block into the surrounding markup context.
 */
export interface LiftExprNode extends BaseNode {
  kind: "lift-expr";
  /** The lifted target — either inline markup or an expression. */
  expr: LiftTarget;
}

/**
 * A fail expression: `fail EnumType::Variant(args)`.
 * Early return with a typed error variant.
 */
export interface FailExprNode extends BaseNode {
  kind: "fail-expr";
  /** Enum type name. */
  enumType: string;
  /** Variant name. */
  variant: string;
  /** Raw argument string. */
  args: string;
}

/**
 * A propagation expression: `let name = expr?` or `expr?`.
 * Propagates errors via the `?` suffix operator.
 */
export interface PropagateExprNode extends BaseNode {
  kind: "propagate-expr";
  /** Binding name for `let name = expr?`, or null for bare `expr?`. */
  binding: string | null;
  /** Structured ExprNode form of the expression. Populated by ast-builder. */
  exprNode?: ExprNode;
}

/**
 * A guarded expression: an expression or statement followed by `!{ ... }` error handler.
 * Wraps the guarded node with error-handling arms.
 */
export interface GuardedExprNode extends BaseNode {
  kind: "guarded-expr";
  /** The node being guarded. */
  guardedNode: LogicStatement;
  /** Error handling match arms from the `!{ }` block. */
  arms: ErrorArm[];
}

// -- Module Declarations --

/**
 * A single import-list item with optional alias and modifier flags.
 *
 * S40 P3.A: parser emits `{imported, local}` so cross-file consumers can map an
 * alias back to the original exported name.
 *
 * A1a Step 7: `pinned` carries the §6.10 identity-stability modifier from
 * `import { foo pinned } from '...'`. A1b enforces semantic validity
 * (`E-IMPORT-PINNED-INVALID` for non-cell-typed targets).
 */
export interface ImportSpecifier {
  /** Original exported name in the source file. */
  imported: string;
  /** Local binding name in the importing file (alias or `imported` if no alias). */
  local: string;
  /** True when `pinned` bareword modifier follows the item. */
  pinned: boolean;
}

/**
 * An import declaration: `import { Name } from './path'` or `import Name from './path'`.
 */
export interface ImportDeclNode extends BaseNode {
  kind: "import-decl";
  /** Full raw import text. */
  raw: string;
  /** Imported names (parallel to `specifiers`, holds the imported name). */
  names: string[];
  /** Per-item structured specifiers (named-import form only; empty for default imports). */
  specifiers?: ImportSpecifier[];
  /** Source module path, or null if parse failed. */
  source: string | null;
  /** True for default imports (`import Name from ...`). */
  isDefault: boolean;
}

/**
 * A use declaration: `use scrml:ui { Button, Card }`.
 * Imports from the scrml standard library or vendor packages.
 */
export interface UseDeclNode extends BaseNode {
  kind: "use-decl";
  /** Full raw use text. */
  raw: string;
  /** Imported names. */
  names: string[];
  /** Source package/module path, or null. */
  source: string | null;
}

/**
 * An export declaration: `export function|const|let|type Name ...`
 * or re-export: `export { Name } from './path'`.
 */
export interface ExportDeclNode extends BaseNode {
  kind: "export-decl";
  /** Full raw export text. */
  raw: string;
  /** Exported name(s), or null. */
  exportedName: string | null;
  /** Export kind: "type", "function", "fn", "const", "let", "channel", "re-export", or null. */
  exportKind: string | null;
  /** Re-export source path, or null. */
  reExportSource: string | null;
  /** F-AUTH-002: `export pure` modifier present. Optional for backward compat. */
  isPure?: boolean;
  /** F-AUTH-002: `export server` modifier present. Optional for backward compat. */
  isServer?: boolean;
}

/**
 * A type declaration: `type Name:kind = { ... }`.
 */
export interface TypeDeclNode extends BaseNode {
  kind: "type-decl";
  /** Type name. */
  name: string;
  /** Type kind modifier (e.g. "enum", "struct"), or empty string. */
  typeKind: string;
  /** Raw type body expression. */
  raw: string;
}

/**
 * P3.A: A `<channel>` declaration AST node.
 *
 * The TAB does not introduce a new node `kind` for channels — channel decls
 * remain `MarkupNode` with `tag: "channel"`. This interface is a structural
 * alias (a TypeScript view) that documents the channel-decl shape and the
 * optional P3.A annotations that may appear on a channel markup node.
 *
 * Codegen consumes channel decls via the existing `MarkupNode` path
 * (`node.kind === "markup" && node.tag === "channel"`); CG was unchanged
 * by P3.A — the cross-file inline-expansion (CHX, in CE phase 2) replaces
 * the consumer's import-reference markup node with a deep copy of the
 * exporter's channel markup body, leaving the rest of the pipeline alone.
 *
 * The `name=` attribute carries the channel's logical (wire-layer) name,
 * which doubles as the `exportedName` on the paired `ExportDeclNode` for
 * cross-file lookup.
 */
export interface ChannelDeclNode extends MarkupNode {
  /** Always "channel" for the channel-decl shape. */
  tag: "channel";
  /** P3.A: true when the channel was declared at top level via
   *  `export <channel name="X" ...>...</>`. Used by MOD to distinguish
   *  exported channel decls from per-page (local) channel decls. */
  isExport?: boolean;
  /** P3.A: when CHX inlined this channel from another file, this records
   *  the source file path for diagnostics + (future) dedupe. */
  _p3aInlinedFrom?: string;
  /** P3.A: when CHX inlined this channel, the source file's channel-decl
   *  span (the original declaration site). */
  _p3aSourceSpan?: Span;
}


// -- Transaction --

/** A transaction block: `transaction { body }`. Wraps SQL operations in a transaction. */
export interface TransactionBlockNode extends BaseNode {
  kind: "transaction-block";
  /** Transaction body statements. */
  body: LogicStatement[];
}

// -- Built-in Effects & Utilities --

/** A cleanup registration: `cleanup(() => { ... })`. Registers a cleanup callback. */
export interface CleanupRegistrationNode extends BaseNode {
  kind: "cleanup-registration";
  /** Raw callback expression string. */
  callback: string;
  /** Phase 4: structured ExprNode form of `callback`. Populated by ast-builder. */
  callbackExpr?: ExprNode;
}

/**
 * A reactive when-effect: `when @var changes { body }`.
 * Runs the body whenever the watched reactive variables change.
 */
export interface WhenEffectNode extends BaseNode {
  kind: "when-effect";
  /** Reactive variable names being watched (without `@`). */
  dependencies: string[];
  /** Raw body expression string. */
  bodyRaw: string;
  /** Phase 3: structured ExprNode form of `bodyRaw` (single-expression bodies only). */
  bodyExpr?: ExprNode;
}

/**
 * §4.12.4: Worker message handler: `when message(binding) { body }`.
 * Fires when the worker receives a postMessage from the parent.
 */
export interface WhenMessageNode extends BaseNode {
  kind: "when-message";
  /** The data parameter binding name. */
  binding: string;
  /** Raw body expression string. */
  bodyRaw: string;
  /** Phase 3: structured ExprNode form of `bodyRaw` (single-expression bodies only). */
  bodyExpr?: ExprNode;
}

/** An upload call: `upload(file, url)`. Built-in file upload utility. */
export interface UploadCallNode extends BaseNode {
  kind: "upload-call";
  /** File expression (raw string). */
  file: string;
  /** Phase 3: structured ExprNode form of `file`. */
  fileExpr?: ExprNode;
  /** URL expression (raw string). */
  url: string;
  /** Phase 3: structured ExprNode form of `url`. */
  urlExpr?: ExprNode;
}

// S81 OQ-2 (2026-05-11): `DebounceCallNode` + `ThrottleCallNode` RETIRED.
// The imperative `debounce(fn, ms)` / `throttle(fn, ms)` keyword-call form
// is replaced by:
//   - state-decl attribute `<x debounced=Nms>` per §6.13 (S79 Approach B)
//   - stdlib `import { debounce, throttle } from "scrml:time"` (regular calls)
// Adopters using the retired form must migrate (separate `bun scrml fix`
// CLI sub-command filed for v0.3.0+ per S81 user-voice). Tokenizer no longer
// reserves these names as KEYWORDs (see tokenizer.ts ~line 70); they parse
// as ordinary identifiers + CallExpr.

// ---------------------------------------------------------------------------
// Discriminated Unions
// ---------------------------------------------------------------------------

/**
 * Any statement that can appear inside a logic or meta block body.
 * This is the union of all declaration, control-flow, and expression nodes.
 */
export type LogicStatement =
  | LetDeclNode
  | ConstDeclNode
  | TildeDeclNode
  | LinDeclNode
  | ReactiveDeclNode
  | ReactiveDebouncedDeclNode
  | ReactiveNestedAssignNode
  | ReactiveArrayMutationNode
  | ReactiveExplicitSetNode
  | ReactiveAssignNode
  | FunctionDeclNode
  | ComponentDefNode
  | IfStmtNode
  | IfExprNode
  | ForExprNode
  | MatchExprNode
  | ForStmtNode
  | WhileStmtNode
  | ReturnStmtNode
  | ThrowStmtNode
  | SwitchStmtNode
  | TryStmtNode
  | MatchStmtNode
  | MatchArmInlineNode
  | BareExprNode
  | LiftExprNode
  | FailExprNode
  | PropagateExprNode
  | GuardedExprNode
  | ImportDeclNode
  | UseDeclNode
  | ExportDeclNode
  | TypeDeclNode
  | TransactionBlockNode
  | CleanupRegistrationNode
  | WhenEffectNode
  | WhenMessageNode
  | UploadCallNode
  // Block-level nodes can appear inside logic bodies via BLOCK_REF:
  | MarkupNode
  | SQLNode
  | CSSInlineNode
  | MetaNode
  | ErrorEffectNode;

/**
 * Any AST node that can appear at the top level of a file
 * or as a child of a markup/state element.
 */
export type ASTNode =
  | MarkupNode
  | TextNode
  | CommentNode
  | StateNode
  | StateConstructorDefNode
  | LogicNode
  | SQLNode
  | CSSInlineNode
  | StyleNode
  | ErrorEffectNode
  | MetaNode
  | LogicStatement;

/**
 * The `kind` string literal for any AST node.
 * Useful for exhaustive switch statements.
 */
export type ASTNodeKind = ASTNode["kind"];

// ---------------------------------------------------------------------------
// Auth & Middleware Configuration
// ---------------------------------------------------------------------------

/** Authentication configuration extracted from `<program>` attributes. */
export interface AuthConfig {
  /** Auth mode (e.g. "required", "optional"). */
  auth: string;
  /** Redirect path for unauthenticated users. */
  loginRedirect: string;
  /** CSRF protection mode (e.g. "auto", "on", "off"). */
  csrf: string;
  /** Session expiry duration string (e.g. "1h", "2h"). */
  sessionExpiry: string;
}

/** Middleware configuration extracted from `<program>` attributes. */
export interface MiddlewareConfig {
  /** CORS origin pattern (e.g. "*"). */
  cors: string | null;
  /** Logging mode (e.g. "structured"). */
  log: string | null;
  /** Rate limit pattern (e.g. "100/min"). */
  ratelimit: string | null;
  /** Security headers mode (e.g. "strict"). */
  headers: string | null;
  /** A9 Ext 5 (§39.2.6) — idempotency backend selector ("auto" / "sqlite" /
   *  "postgres" / "mysql" / "redis" / "none"). */
  idempotencyStore?: string | null;
  /** S79 audit fix C.1 (§19.9.6, §39.2.6 extension) — idempotency-key TTL
   *  override. Raw attr value (parsed at codegen time into millis). Accepted
   *  forms: bare millis ("3600000"), duration string ("1h", "7d", "24h",
   *  "300s", "30m"). When null/absent, defaults to 24h (Stripe convention). */
  idempotencyTTL?: string | null;
  /** S79 audit fix C.2 (§8.10.6) — batched IN-list size ceiling for hoisted
   *  loops. Default 32766 (SQLite 3.32+ `SQLITE_MAX_VARIABLE_NUMBER`).
   *  Adopters targeting Postgres (~65535) or older SQLite (999) can override.
   *  Raw attr value (decimal integer string); null/absent → 32766. */
  batchInListCap?: string | null;
  /** S81 audit fix F.1 (§39.2.1 extension) — `Access-Control-Max-Age` header
   *  override for the OPTIONS preflight response. Raw attr value (decimal
   *  integer string of seconds); null/absent → 86400 (Firefox effective cap).
   *  Silently ignored when `cors` is null (CORS as a whole is opt-in). */
  corsMaxAge?: string | null;
  /** S81 audit fix F.2 (§38.3.1) — project-level default for the WS onclose
   *  setTimeout reconnect cadence applied to channels without an explicit
   *  per-channel `reconnect=` attribute. Raw attr value (bare millis decimal
   *  integer OR duration string `"Nms"`/`"Ns"`/`"Nm"`/`"Nh"`); null/absent → 2000ms.
   *  Per-channel `<channel reconnect=>` still wins when both present. */
  channelReconnect?: string | null;
}

// ---------------------------------------------------------------------------
// File AST (top-level output of the TAB stage)
// ---------------------------------------------------------------------------

/**
 * The complete AST for a single scrml source file.
 * Produced by `buildAST()` / `runTAB()`.
 */
export interface FileAST {
  /** Absolute path of the source file. */
  filePath: string;
  /** Top-level AST nodes. */
  nodes: ASTNode[];
  /** All import declarations hoisted from logic blocks. */
  imports: ImportDeclNode[];
  /** All export declarations hoisted from logic blocks. */
  exports: ExportDeclNode[];
  /** All component definitions hoisted from logic blocks. */
  components: ComponentDefNode[];
  /** All type declarations hoisted from logic blocks. */
  typeDecls: TypeDeclNode[];
  /** P3.A: All `<channel>` declaration markup nodes (hoisted from `<program>`
   *  children + top-level nodes) — both per-page (local) channel decls and
   *  exported (top-level `export <channel>`) decls. Used by CHX to look up
   *  cross-file channel exports during inline-expansion. */
  channelDecls?: ChannelDeclNode[];
  /** True if the file has a `<program>` root element. */
  hasProgramRoot: boolean;
  /** Auth configuration from `<program>` attributes, or null. */
  authConfig: AuthConfig | null;
  /** Middleware configuration from `<program>` attributes, or null. */
  middlewareConfig: MiddlewareConfig | null;
}

// ---------------------------------------------------------------------------
// TAB Output (full pipeline stage result)
// ---------------------------------------------------------------------------

/** Output of the TAB (Typed AST Builder) pipeline stage. */
export interface TABOutput {
  /** Absolute path of the source file. */
  filePath: string;
  /** The constructed FileAST. */
  ast: FileAST;
  /** Errors and warnings encountered during AST construction. */
  errors: TABErrorInfo[];
}

/** Serializable representation of a TAB error (mirrors the TABError class shape). */
export interface TABErrorInfo {
  /** Error code (e.g. "E-ATTR-002", "W-PROGRAM-001"). */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Source location where the error occurred. */
  tabSpan: Span;
  /** Severity level (defaults to "error"; "warning" for W- codes). */
  severity?: "error" | "warning";
}

// ---------------------------------------------------------------------------
// ExprNode — Structured Expression AST (Phase 1 migration target)
// ---------------------------------------------------------------------------
// Added: 2026-04-11 (Phase 0 design)
// Phase 1: these types exist alongside string-form fields.
// Phase 4: string-form fields are removed.
//
// Every ExprNode carries a `span` that points at the exact source region.
// The invariant: `emitStringFromTree(node)` === original string-form field value
// holds throughout Phase 1 and Phase 2.
// ---------------------------------------------------------------------------

export interface ExprSpan {
  /** Absolute file path. */
  file: string;
  /** Byte offset of the first token of this expression. */
  start: number;
  /** Byte offset one past the last token of this expression. */
  end: number;
  /** 1-based line number of the first token. */
  line: number;
  /** 1-based column number of the first token. */
  col: number;
}

// ---- Leaf Nodes ----

/** An identifier: `x`, `foo`, `~` (pipeline accumulator), `@name` (reactive). */
export interface IdentExpr {
  kind: "ident";
  span: ExprSpan;
  /** The identifier text. For reactive vars, includes `@`. For tilde, is `"~"`. */
  name: string;
}

/**
 * A literal value.
 * `litType` discriminates the sub-type for the type system.
 *
 * §42 absence canon (S90 M-7C-D-12 Track 1):
 *   - `"not"` is the SINGLE canonical absence discriminator. Parser sites
 *     SHALL manufacture only `litType: "not"` — never `"null"` / `"undefined"`.
 *     The `raw` field discriminates source-token provenance for the gauntlet-
 *     phase3 lint detector: `raw: "null"` / `raw: "undefined"` signal user-
 *     source forbidden tokens (still fires E-SYNTAX-042); `raw: "not"` is
 *     the scrml canonical keyword or internal synthesis.
 *   - `"null"` and `"undefined"` litType variants are RETAINED in the union
 *     for backwards-compat (older AST snapshots, downstream defensive checks)
 *     but are `@deprecated` — no parser site SHALL emit them.
 */
export interface LitExpr {
  kind: "lit";
  span: ExprSpan;
  /** Raw source text of the literal (preserves exact string content). */
  raw: string;
  /** Interpreted value — for number: parsed float; for string: unescaped content;
   *  for bool: true/false; for not (absence): null. */
  value: string | number | boolean | null;
  litType:
    | "number"
    | "string"      // double-quoted string
    | "template"    // back-tick string (static, no live interpolation)
    | "bool"
    /** @deprecated S90 M-7C-D-12 Track 1 — use `"not"` with `raw: "null"` for user-source forbidden-token detection. */
    | "null"
    /** @deprecated S90 M-7C-D-12 Track 1 — use `"not"` with `raw: "undefined"` for user-source forbidden-token detection. */
    | "undefined"
    | "not";        // §42 absence value — compiles to null
}

// ---- Compound Primary Nodes ----

/** `[a, b, ...rest]` array literal. `elements` may contain spread nodes. */
export interface ArrayExpr {
  kind: "array";
  span: ExprSpan;
  elements: (ExprNode | SpreadExpr)[];
}

/** `{ k: v, shorthand, ...spread }` object literal. */
export interface ObjectExpr {
  kind: "object";
  span: ExprSpan;
  props: ObjectProp[];
}

export type ObjectProp =
  | { kind: "prop"; key: string | ExprNode; value: ExprNode; computed: boolean; span: ExprSpan }
  | { kind: "shorthand"; name: string; span: ExprSpan }
  | { kind: "spread"; argument: ExprNode; span: ExprSpan };

/** `...expr` spread operator (inside array/object literals and call arg lists). */
export interface SpreadExpr {
  kind: "spread";
  span: ExprSpan;
  argument: ExprNode;
}

// ---- Operations ----

/**
 * Prefix and postfix unary operators.
 *
 * Operators: `!`, `-`, `+`, `~` (bitwise NOT), `typeof`, `void`, `delete`, `await`,
 * `++` (prefix), `--` (prefix), `++` (postfix), `--` (postfix).
 *
 * `not (expr)` — §42 prefix negation — is modeled as `unary { op: "!", prefix: true }`.
 * The `not` keyword rewrites to `!` during the unary parse.
 */
export interface UnaryExpr {
  kind: "unary";
  span: ExprSpan;
  op:
    | "!" | "-" | "+" | "~"
    | "typeof" | "void" | "delete" | "await"
    | "++" | "--";
  argument: ExprNode;
  /** true = prefix (`!x`), false = postfix (`x++`). */
  prefix: boolean;
}

/**
 * All binary infix operators.
 *
 * Scrml-specific `op` values:
 * - `"is"` — enum membership check: `x is .Variant`
 * - `"is-not"` — absence check: `x is not` → `(x === null || x === undefined)`
 * - `"is-some"` — presence check: `x is some` → `(x !== null && x !== undefined)`
 * - `"is-not-not"` — double-negation presence: `x is not not` (same semantics as is-some)
 * - `"??"` — null coalescing
 *
 * Standard JS `op` values: arithmetic, comparison, logical, bitwise, equality.
 *
 * Note: `==` and `!=` are scrml equality operators (§45) — they compile to structural
 * comparison, not JS `===`/`!==`. The `op` field carries `"=="` / `"!="` as-is; the
 * codegen layer interprets them per §45.
 */
export interface BinaryExpr {
  kind: "binary";
  span: ExprSpan;
  op:
    | "+" | "-" | "*" | "/" | "%" | "**"
    | "==" | "!="
    | "<" | "<=" | ">" | ">="
    | "&&" | "||" | "??"
    | "&" | "|" | "^" | "<<" | ">>" | ">>>"
    | "in" | "instanceof"
    | "is" | "is-not" | "is-some" | "is-not-not";
  left: ExprNode;
  /**
   * For `is` / `is-not` / `is-some` / `is-not-not`: right holds the pattern
   * (an `ident` for enum variant name, or a `lit { litType: "not" }` for
   * absence — synthesized by the parser at the operator's RHS position).
   * For standard binary ops: right is the right-hand expression.
   */
  right: ExprNode;
}

/** Assignment: `x = expr`, `x += expr`, etc. (§50). */
export interface AssignExpr {
  kind: "assign";
  span: ExprSpan;
  op:
    | "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**="
    | "&&=" | "||=" | "??="
    | "&=" | "|=" | "^=" | "<<=" | ">>=" | ">>>=";
  target: ExprNode;
  value: ExprNode;
}

/** `cond ? consequent : alternate` ternary. */
export interface TernaryExpr {
  kind: "ternary";
  span: ExprSpan;
  condition: ExprNode;
  consequent: ExprNode;
  alternate: ExprNode;
}

// ---- Access and Call ----

/**
 * Member access: `expr.prop` or `expr?.prop`.
 *
 * `property` is a plain string (not an ExprNode) because property names in scrml
 * are always static identifiers. Computed access `expr[idx]` is `IndexExpr`.
 * This choice matches ESTree (MemberExpression.computed=false case) and avoids
 * creating spurious ident nodes for property names that are not bindings.
 */
export interface MemberExpr {
  kind: "member";
  span: ExprSpan;
  object: ExprNode;
  /** Static property name (no `@`, no `~`). */
  property: string;
  /** true if optional chain: `?.` */
  optional: boolean;
}

/** Index access: `expr[idx]` or `expr?.[idx]`. */
export interface IndexExpr {
  kind: "index";
  span: ExprSpan;
  object: ExprNode;
  index: ExprNode;
  /** true if optional chain: `?.[` */
  optional: boolean;
}

/** Function call: `callee(args)` or `callee?.(args)`. */
export interface CallExpr {
  kind: "call";
  span: ExprSpan;
  callee: ExprNode;
  args: (ExprNode | SpreadExpr)[];
  /** true if optional chain: `?.()` */
  optional: boolean;
}

/** `new Callee(args)`. */
export interface NewExpr {
  kind: "new";
  span: ExprSpan;
  callee: ExprNode;
  args: (ExprNode | SpreadExpr)[];
}

// ---- Lambda and Inline Function ----

/**
 * Arrow function or `fn` shorthand.
 *
 * `params` uses the same `FunctionParam` type as `FunctionDeclNode` will eventually
 * use once params are structured.
 *
 * `body`:
 * - `{ kind: "expr"; value: ExprNode }` — expression body: `x => x + 1`
 * - `{ kind: "block"; stmts: LogicStatement[] }` — block body: `x => { return x + 1 }`
 *
 * `fnStyle`:
 * - `"arrow"` — `(x) => expr` or `(x) => { ... }`
 * - `"fn"` — `fn(x) { ... }` (scrml shorthand, same as arrow with block body)
 * - `"function"` — `function(x) { ... }` (inline function expression)
 *
 * Phase 1 note: block bodies are represented as EscapeHatchExpr in esTreeToExprNode
 * because converting block statements requires the full ast-builder statement loop.
 * Only expression-body arrows are fully structured in Phase 1.
 */
export interface LambdaExpr {
  kind: "lambda";
  span: ExprSpan;
  params: LambdaParam[];
  body:
    | { kind: "expr"; value: ExprNode }
    | { kind: "block"; stmts: LogicStatement[] };
  isAsync: boolean;
  fnStyle: "arrow" | "fn" | "function";
}

export interface LambdaParam {
  name: string;
  typeAnnotation?: string;
  defaultValue?: ExprNode;
  isRest?: boolean;
  isLin?: boolean;     // §35.2.1 lin parameter
}

// ---- Type Cast ----

/**
 * `expr as TypeName` type cast.
 *
 * `targetType` is a raw string (not a structured type node) because scrml's type system
 * is not yet fully structured. When type nodes are structured in a future phase, this
 * field will become a TypeNode.
 */
export interface CastExpr {
  kind: "cast";
  span: ExprSpan;
  expression: ExprNode;
  targetType: string;
}

// ---- Inline Match ----

/**
 * `match expr { arm arm ... }` inline match expression.
 *
 * Modeled as an expression node so it can appear in value position:
 * `let label = match @state { .Small => "small" else => "big" }`.
 *
 * `arms` carry the raw arm text (pre-structured). During Phase 2 (semantic passes),
 * arms will be structured into typed arm nodes.
 */
export interface MatchExpr {
  kind: "match-expr";
  span: ExprSpan;
  subject: ExprNode;
  /**
   * §18.19 multi-scrutinee head: `match (e1, …, eN) { (p1, …, pN) :> body }`.
   * When present (length ≥ 2) this is a multi-scrutinee match — `subject` mirrors
   * `subjects[0]` for single-scrutinee-compatible consumers. The parens are
   * grammar, NOT a tuple value (no-tuple, §59.7 / §14.11). Absent ⇒ ordinary
   * single-scrutinee match (`subject` only). Each `rawArm` is a product-pattern
   * arm string `(p1, …, pN) :> body` or a whole-product wildcard (`_` / `else`).
   */
  subjects?: ExprNode[];
  /** Raw arm strings for Phase 1. Replace with structured MatchArm[] in Phase 2. */
  rawArms: string[];
}

// ---- Value-Native Map Literal (§59.3) ----

/**
 * One `key: value` entry inside a value-native map literal (§59.3).
 * Both `key` and `value` are fully-parsed ExprNodes — the legacy (Acorn)
 * scanner round-trips the raw key/value text through the full expression
 * pipeline (the same JSON-quote-then-reparse trick `MatchExpr.rawArms` uses).
 */
export interface MapEntry {
  /** The entry key expression (`"DAL"`, `1`, a struct/enum value, …). */
  key: ExprNode;
  /** The entry value expression. */
  value: ExprNode;
}

/**
 * `[k: v, k2: v2, …]` value-native map literal, or `[:]` empty-map literal (§59.3).
 *
 * The parser disambiguates a bracketed expression as a MAP iff it is the empty
 * form `[:]` OR it contains a bracket-depth-1 entry-colon that is NOT a ternary
 * alternative-separator (§59.3). An empty `entries` list is the `[:]` empty map.
 *
 * Entry ordering is source order. Duplicate depth-1 keys are last-wins (§59.3)
 * — the parser keeps every entry (so a downstream pass can surface
 * `W-MAP-DUPLICATE-LITERAL-KEY`); the runtime/codegen lowering (D3/D4) applies
 * last-wins when building the map value.
 *
 * Parse-time diagnostics for a malformed literal (missing key/value, trailing
 * colon, count error → `E-MAP-LITERAL-MALFORMED`) and the two info-level
 * notices (`W-MAP-STRUCT-KEY-LITERAL` for a struct/enum-key literal,
 * `W-MAP-DUPLICATE-LITERAL-KEY` for a last-wins duplicate) are carried on the
 * `diagnostics` field and surfaced by the ast-builder wrapper as TABErrors —
 * the same surfacing pattern `ResetExpr.diagnostic` uses (the scanner runs
 * pre-Acorn, so it cannot push into an errors array directly).
 */
export interface MapLitExpr {
  kind: "map-lit";
  span: ExprSpan;
  /** Ordered list of `key: value` entries. Empty list = the `[:]` empty map. */
  entries: MapEntry[];
  /**
   * Parse-time diagnostics (Error + Info) attached by the legacy scanner.
   * Surfaced by the ast-builder wrapper; absent on a clean primitive-key literal.
   */
  diagnostics?: { code: string; message: string }[];
}

// ---- SQL Block Reference ----

/**
 * `?{ sql query }` SQL block reference appearing inside an expression.
 *
 * In the current parser, SQL blocks are `BLOCK_REF` tokens (block splitter level).
 * When they appear inside an expression context, they are modeled as opaque references.
 * This node type allows the structured parser to preserve them without losing position info.
 */
export interface SqlRefExpr {
  kind: "sql-ref";
  span: ExprSpan;
  /** The SQLNode this expression-position SQL block resolves to. */
  nodeId: number;
}

// ---- Input State Reference ----

/**
 * `<#identifier>` input state reference.
 * Currently rewritten to `_scrml_input_state_registry.get("name")` by `rewriteInputStateRefs`.
 * In the structured AST, preserved as a typed node until codegen.
 */
export interface InputStateRefExpr {
  kind: "input-state-ref";
  span: ExprSpan;
  name: string;
}

// ---- Escape Hatch ----

/**
 * Escape hatch for ESTree node types not yet mapped to ExprNode.
 * Fires when esTreeToExprNode encounters an unsupported ESTree node type.
 * All escape-hatch occurrences are tracked and reported.
 * Zero escape hatches on the examples corpus is a Phase 1 exit criterion.
 */
export interface EscapeHatchExpr {
  kind: "escape-hatch";
  span: ExprSpan;
  /**
   * Escape-hatch sub-kind discriminator (string). Carries the original
   * ESTree node type for live-pipeline (Acorn) escape hatches, plus
   * compiler-internal sub-kinds (`"ParseError"`, `"SkippedExpr"`, etc.).
   * Renamed from `estreeType` (F2 / DD #27) — the field is a sub-kind
   * decoration, not a native↔ESTree translation surface.
   */
  nativeKind: string;
  /** Raw source text of the unsupported expression. */
  raw: string;
}

// ---- Reset Expression (§6.8.2) ----

/**
 * `reset(@cell)` — language-level keyword expression that, at runtime, restores
 * a state cell (or a field of a compound cell) to its declared default.
 *
 * Produced by `esTreeToExprNode` in the expression-parser when a CallExpression's
 * callee is a bare Identifier named "reset". The transformation lifts what acorn
 * sees as an ordinary call into a structurally-distinct node so downstream
 * passes (A1b target-shape validation, A1c codegen lowering to the runtime
 * reset operation, dependency-graph integration with `default=`) can recognise
 * the construct without re-checking for the magic name.
 *
 * Parser-level invariants (Step 9, Phase A1a):
 *   - Exactly one argument is required. Zero-arg or multi-arg forms surface
 *     `E-RESET-NO-ARG` (§34) via the optional `diagnostic` field.
 *   - The argument MAY be any ExprNode. Target-shape validation
 *     (`@cell` / `@compound.field` / `@compound`) is deferred to A1b.
 *
 * The `diagnostic` field carries an error code + message when the call shape
 * is malformed at parse time. The wrapper that calls `parseExprToNode`
 * (currently `safeParseExprToNodeGlobal` and the closure-scoped variant inside
 * `parseLogicBody`) checks for this field and pushes a TABError into the
 * errors array. This mirrors the F-SQL-001 surfacing pattern used by
 * `EscapeHatchExpr.sqlDiagnostic`.
 */
export interface ResetExpr {
  kind: "reset-expr";
  span: ExprSpan;
  /** The cell-ref expression argument. May be any ExprNode at parse time. */
  target: ExprNode;
  /**
   * Parse-time diagnostic for malformed reset forms (zero-arg, multi-arg).
   * Surfaced by the ast-builder wrapper as a TABError (E-RESET-NO-ARG, §34).
   * Absent on well-formed `reset(<expr>)` calls.
   */
  diagnostic?: { code: string; message: string };
}

/**
 * markup-value-in-expression-2026-06-17 (a)+(b) — markup-as-first-class-value
 * (Pillar 1, SPEC §1.4 / §7.4) appearing in EXPRESSION position: a ternary
 * consequent/alternate, or any sub-expression. The ast-builder
 * `parseExprWithMarkupValues` helper recovers each markup span to a real markup
 * element node (via the canonical `parseLiftTag` machinery) and substitutes a
 * `markup-value` leaf into the surrounding expression tree. Codegen lowers it
 * to the markup→DOM-node IIFE (emit-lift.js `emitMarkupValueExpr`) — the same
 * lowering the `return <markup>` value (form (c)) and the bare markup-typed
 * derived control use.
 */
export interface MarkupValueExpr {
  kind: "markup-value";
  span: ExprSpan;
  /** The recovered markup element node (from `parseLiftTag`). */
  node: ASTNode;
}

// ---- Union ----

/**
 * All expression node types. Use `node.kind` to discriminate.
 */
export type ExprNode =
  | IdentExpr
  | LitExpr
  | ArrayExpr
  | ObjectExpr
  | SpreadExpr
  | UnaryExpr
  | BinaryExpr
  | AssignExpr
  | TernaryExpr
  | MemberExpr
  | IndexExpr
  | CallExpr
  | NewExpr
  | LambdaExpr
  | CastExpr
  | MatchExpr
  | MapLitExpr
  | SqlRefExpr
  | InputStateRefExpr
  | EscapeHatchExpr
  | MarkupValueExpr
  | ResetExpr;
