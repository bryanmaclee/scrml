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

// -- Variable Declarations --

/** A `let` declaration: `let name = expr`. */
export interface LetDeclNode extends BaseNode {
  kind: "let-decl";
  /** Variable name. */
  name: string;
  /** @deprecated Phase 4d: use initExpr. Retained for backward compat during migration. */
  init?: string;
  /** If-as-expression: `let a = if (cond) { lift val }`. */
  ifExpr?: IfExprNode;
  /** For-as-expression: `let names = for (item of items) { lift item.name }`. */
  forExpr?: ForExprNode;
  /** Match-as-expression: `let result = match expr { .A => { lift val } }`. */
  matchExpr?: MatchExprNode;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
  initExpr?: ExprNode;
}

/** A `const` declaration: `const name = expr`. */
export interface ConstDeclNode extends BaseNode {
  kind: "const-decl";
  /** Variable name. */
  name: string;
  /** @deprecated Phase 4d: use initExpr. Retained for backward compat during migration. */
  init?: string;
  /** If-as-expression: `const a = if (cond) { lift val }`. */
  ifExpr?: IfExprNode;
  /** For-as-expression: `const names = for (item of items) { lift item.name }`. */
  forExpr?: ForExprNode;
  /** Match-as-expression: `const result = match expr { .A => { lift val } }`. */
  matchExpr?: MatchExprNode;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
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
  /** @deprecated Phase 4d: use initExpr. Retained for backward compat during migration. */
  init?: string;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
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
  /** @deprecated Phase 4d: use initExpr. */
  init?: string;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
  initExpr?: ExprNode;
}

// -- Reactive Declarations --

/** A reactive declaration: `@name = expr`. */
export interface ReactiveDeclNode extends BaseNode {
  kind: "state-decl";
  /** Reactive variable name (without `@`). */
  name: string;
  /** @deprecated Phase 4d: use initExpr. */
  init?: string;
  /** True if declared with `@shared` modifier (section 37.4). */
  isShared?: boolean;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
  initExpr?: ExprNode;
}

/** A derived reactive declaration: `const @name = expr`. */
export interface ReactiveDerivedDeclNode extends BaseNode {
  kind: "reactive-derived-decl";
  /** Derived variable name (without `@`). */
  name: string;
  /** @deprecated Phase 4d: use initExpr. */
  init?: string;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
  initExpr?: ExprNode;
}

/** A debounced reactive declaration: `@debounced(N) name = expr`. */
export interface ReactiveDebouncedDeclNode extends BaseNode {
  kind: "reactive-debounced-decl";
  /** Variable name. */
  name: string;
  /** @deprecated Phase 4d: use initExpr. */
  init?: string;
  /** Debounce delay in milliseconds (default 300). */
  delay: number;
  /** Structured ExprNode form of the initializer. Always populated by ast-builder. */
  initExpr?: ExprNode;
}

/**
 * A reactive nested assignment: `@obj.path.to.prop = value`.
 * Assigns to a nested property of a reactive variable.
 */
export interface ReactiveNestedAssignNode extends BaseNode {
  kind: "reactive-nested-assign";
  /** Root reactive variable name (without `@`). */
  target: string;
  /** Dot-separated path segments (e.g. ["path", "to", "prop"]). */
  path: string[];
  /** @deprecated Phase 4d: use valueExpr. */
  value?: string;
  /** Structured ExprNode form of the value. Always populated by ast-builder. */
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
  /** State type scope for functions inside state constructor defs. */
  stateTypeScope?: string;
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

// -- Control Flow --

/** An if/else-if/else chain: `if condition { consequent } else { alternate }`. */
export interface IfStmtNode extends BaseNode {
  kind: "if-stmt";
  /** @deprecated Phase 4d: use condExpr. */
  condition?: string;
  /** Consequent branch statements. */
  consequent: LogicStatement[];
  /** Alternate branch (else/else-if chain), or null. */
  alternate: LogicStatement[] | null;
  /** Structured ExprNode form of the condition. Always populated by ast-builder. */
  condExpr?: ExprNode;
}

/** An if-as-expression: `const a = if (cond) { lift val }`. */
export interface IfExprNode extends BaseNode {
  kind: "if-expr";
  /** @deprecated Phase 4d: use condExpr. */
  condition?: string;
  /** Consequent branch statements. */
  consequent: LogicStatement[];
  /** Alternate branch (else chain), or null. */
  alternate: LogicStatement[] | null;
  /** Structured ExprNode form of the condition. Always populated by ast-builder. */
  condExpr?: ExprNode;
}

/** A for-as-expression: `const names = for (item of items) { lift item.name }`. */
export interface ForExprNode extends BaseNode {
  kind: "for-expr";
  /** Loop variable name. */
  variable: string;
  /** @deprecated Phase 4d: use iterExpr. */
  iterable?: string;
  /** Loop body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the iterable. Always populated by ast-builder. */
  iterExpr?: ExprNode;
}

/** A match-as-expression: `const result = match expr { .A => { lift val } }`. */
export interface MatchExprNode extends BaseNode {
  kind: "match-expr";
  /** @deprecated Phase 4d: use headerExpr. */
  header?: string;
  /** Body statements (match arms). */
  body: LogicStatement[];
  /** Structured ExprNode form of the header. Always populated by ast-builder. */
  headerExpr?: ExprNode;
}

/** A for loop: `for variable in iterable { body }`. */
export interface ForStmtNode extends BaseNode {
  kind: "for-stmt";
  /** Loop variable name. */
  variable: string;
  /** @deprecated Phase 4d: use iterExpr. */
  iterable?: string;
  /** Loop body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the iterable. Always populated by ast-builder. */
  iterExpr?: ExprNode;
  /** Phase 4: C-style for-loop parts `(init; cond; update)` parsed individually. */
  cStyleParts?: { initExpr: ExprNode; condExpr: ExprNode; updateExpr: ExprNode };
}

/** A while loop: `while condition { body }`. */
export interface WhileStmtNode extends BaseNode {
  kind: "while-stmt";
  /** @deprecated Phase 4d: use condExpr. */
  condition?: string;
  /** Loop body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the condition. Always populated by ast-builder. */
  condExpr?: ExprNode;
}

/** A return statement: `return expr`. */
export interface ReturnStmtNode extends BaseNode {
  kind: "return-stmt";
  /** @deprecated Phase 4d: use exprNode. */
  expr?: string;
  /** Structured ExprNode form of the return expression. Always populated by ast-builder. */
  exprNode?: ExprNode;
}

/** A throw statement: `throw ErrorType("message")`. */
export interface ThrowStmtNode extends BaseNode {
  kind: "throw-stmt";
  /** @deprecated Phase 4d: use exprNode. */
  expr?: string;
  /** Structured ExprNode form of the throw expression. Always populated by ast-builder. */
  exprNode?: ExprNode;
}

/** A switch statement: `switch header { body }`. */
export interface SwitchStmtNode extends BaseNode {
  kind: "switch-stmt";
  /** @deprecated Phase 4d: use headerExpr. */
  header?: string;
  /** Body statements. */
  body: LogicStatement[];
  /** Structured ExprNode form of the header. Always populated by ast-builder. */
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
  /** @deprecated Phase 4d: use headerExpr. */
  header?: string;
  /** Body statements (match arms). */
  body: LogicStatement[];
  /** Structured ExprNode form of the header. Always populated by ast-builder. */
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
  /** @deprecated Phase 4d: use exprNode. */
  expr?: string;
  /** Structured ExprNode form of the expression. Always populated by ast-builder. */
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
 * An import declaration: `import { Name } from './path'` or `import Name from './path'`.
 */
export interface ImportDeclNode extends BaseNode {
  kind: "import-decl";
  /** Full raw import text. */
  raw: string;
  /** Imported names. */
  names: string[];
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

/** A debounce call: `debounce(fn, ms)`. Built-in debounce utility. */
export interface DebounceCallNode extends BaseNode {
  kind: "debounce-call";
  /** Function expression (raw string). */
  fn: string;
  /** Phase 4: structured ExprNode form of `fn`. Populated by ast-builder. */
  fnExpr?: ExprNode;
  /** Delay in milliseconds. */
  delay: number;
}

/** A throttle call: `throttle(fn, ms)`. Built-in throttle utility. */
export interface ThrottleCallNode extends BaseNode {
  kind: "throttle-call";
  /** Function expression (raw string). */
  fn: string;
  /** Phase 4: structured ExprNode form of `fn`. Populated by ast-builder. */
  fnExpr?: ExprNode;
  /** Delay in milliseconds. */
  delay: number;
}

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
  | ReactiveDerivedDeclNode
  | ReactiveDebouncedDeclNode
  | ReactiveNestedAssignNode
  | ReactiveArrayMutationNode
  | ReactiveExplicitSetNode
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
  | DebounceCallNode
  | ThrottleCallNode
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
  /** CSRF protection mode. */
  csrf: string | null;
  /** Rate limit pattern (e.g. "100/min"). */
  ratelimit: string | null;
  /** Security headers mode (e.g. "strict"). */
  headers: string | null;
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
  /** Span table: maps node ID to its source span. */
  spans: Record<number, Span>;
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
 */
export interface LitExpr {
  kind: "lit";
  span: ExprSpan;
  /** Raw source text of the literal (preserves exact string content). */
  raw: string;
  /** Interpreted value — for number: parsed float; for string: unescaped content;
   *  for bool: true/false; for null/undefined/not: the keyword string. */
  value: string | number | boolean | null;
  litType:
    | "number"
    | "string"      // double-quoted string
    | "template"    // back-tick string (static, no live interpolation)
    | "bool"
    | "null"
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
   * (an `ident` for enum variant name, or a `lit { litType: "null" }` for absence).
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
  /** Raw arm strings for Phase 1. Replace with structured MatchArm[] in Phase 2. */
  rawArms: string[];
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
  /** Original ESTree node type that triggered the escape hatch. */
  estreeType: string;
  /** Raw source text of the unsupported expression. */
  raw: string;
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
  | SqlRefExpr
  | InputStateRefExpr
  | EscapeHatchExpr;
