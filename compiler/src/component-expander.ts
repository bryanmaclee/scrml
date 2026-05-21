/**
 * Component Expander — Stage 3.2 of the scrml compiler pipeline (CE).
 *
 * Runs after TAB (Stage 3) and Module Resolution, before BPP (Stage 3.5).
 * For each file, builds a component registry from `component-def` nodes
 * in `ast.components`, then replaces all markup nodes resolved to a user-component
 * with expanded copies of the component's root element.
 *
 * Phase 1 scope:
 *   - Same-file resolution only (no cross-file imports)
 *   - Simple prop passing: caller attrs become named identifiers in component body
 *   - Children flow to `${children}` placeholder only
 *   - No typed props validation
 *   - No slot system
 *
 * Input contract:
 *   { filePath: string, ast: FileAST, errors: TABError[] }
 *   — same shape as TAB output and BPP input
 *
 * Output contract:
 *   { filePath: string, ast: FileAST, errors: CEError[] }
 *   — `component-def` nodes are consumed from ast.components and ast.nodes (removed)
 *   — markup nodes with `resolvedKind === "user-component"` are replaced by expanded HTML markup nodes
 *   — No node at any depth of the AST retains kind === "component-def"
 *   — No markup node with `resolvedKind === "user-component"` remains (resolved ones are expanded;
 *     unresolved ones produce E-COMPONENT-020 and are left in place as-is)
 *
 * Error codes:
 *   E-COMPONENT-020 — component reference not found in file scope
 *   E-COMPONENT-021 — component body failed to re-parse (malformed component definition)
 *
 * Background on component-def.raw format:
 *   The `raw` field in a component-def node is produced by `collectExpr()` in the
 *   TAB logic parser. It is a space-joined sequence of logic tokenizer tokens, e.g.:
 *     `< div class = "card" / >`  (self-closing)
 *     `< div class = "card" >`   (block-form)
 *   The logic tokenizer treats `<` as a PUNCT token, so there is always a space
 *   between `<` and the tag name. Before re-parsing, this must be normalized
 *   back to valid scrml markup source.
 *
 * Performance budget: <= 5 ms per file.
 * Parallelism: per-file — fully parallel across Bun workers.
 */

import { splitBlocks } from "./block-splitter.js";
import { buildAST } from "./ast-builder.js";
import { exprNodeMatchesIdent, exprNodeContainsCall, emitStringFromTree, parseExprToNode } from "./expression-parser.ts";
import type {
  Span,
  FileAST,
  ASTNode,
  AttrNode,
  AttrValue,
  MarkupNode,
  LogicNode,
  ComponentDefNode,
  ImportDeclNode,
  TABErrorInfo,
  ExprNode,
  ExprSpan,
  IdentExpr,
  LitExpr,
  ArrayExpr,
  ObjectExpr,
  SpreadExpr,
  UnaryExpr,
  BinaryExpr,
  AssignExpr,
  TernaryExpr,
  MemberExpr,
  IndexExpr,
  CallExpr,
  NewExpr,
  LambdaExpr,
  CastExpr,
  MatchExpr,
  EscapeHatchExpr,
  ResetExpr,
  LogicStatement,
  LetDeclNode,
  ConstDeclNode,
  TildeDeclNode,
  LinDeclNode,
  ReactiveDeclNode,
  // S79 — ReactiveDebouncedDeclNode retired (§6.13 reactivity attribute).
  ReactiveNestedAssignNode,
  FunctionDeclNode,
  IfStmtNode,
  IfExprNode,
  ForExprNode,
  ForStmtNode,
  WhileStmtNode,
  ReturnStmtNode,
  ThrowStmtNode,
  SwitchStmtNode,
  TryStmtNode,
  MatchStmtNode,
  MatchArmInlineNode,
  BareExprNode,
  PropagateExprNode,
  GuardedExprNode,
  WhenEffectNode,
  WhenMessageNode,
  CleanupRegistrationNode,
  UploadCallNode,
  TransactionBlockNode,
  MetaNode,
  LiftExprNode,
  TextNode,
} from "./types/ast.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "./types/ast.ts";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** A CE error produced during component expansion. */
export interface CEError {
  code: string;
  message: string;
  span: Span;
  severity?: string;
}

/**
 * Create a CEError value object.
 */
function makeCEError(
  code: string,
  message: string,
  span: Span,
  severity: string = "error"
): CEError {
  return { code, message, span, severity };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A single prop declaration inside a < props> block. */
interface PropDecl {
  name: string;
  type: string;
  optional: boolean;
  default: string | null;
  bindable: boolean;
  isSnippet: boolean;              // §14.9 — true when type is snippet/snippet?/snippet(...)
  snippetParamType: string | null; // §14.9 — raw type string, e.g. "Tab" in snippet(tab: Tab)
}

/** Mutable counter for assigning unique node IDs. */
interface NodeCounter {
  next: number;
}

/** An entry in the component registry built from component-def nodes. */
interface RegistryEntry {
  nodes: MarkupNode[];
  defSpan: Span;
  propsDecl: PropDecl[] | null;
  defChildren: ASTNode[];
  snippetProps: Map<string, PropDecl>;  // §14.9 — snippet-typed props
}

/**
 * A component-def node as it appears at runtime, which carries additional
 * fields set by ast-builder.js beyond the base ComponentDefNode interface.
 */
interface ExtendedComponentDefNode extends ComponentDefNode {
  /** Sibling AST nodes that are part of the component body (CSS, logic, etc.). */
  defChildren?: ASTNode[];
}

/**
 * An import node that may carry a `specifiers` array (alternate shape from
 * some import paths) in addition to the standard `names` array.
 */
type ImportWithSpecifiers = ImportDeclNode & {
  specifiers?: Array<{ imported: string; local: string }>;
};

/** Per-component / per-state-type export info stored in the export registry.
 *  P3.A: extended with `category` for state-type-aware routing. */
interface ExportInfo {
  isComponent: boolean;
  category?: string;
}


// ---------------------------------------------------------------------------
// P3-FOLLOW: NR-authoritative user-component predicate
// ---------------------------------------------------------------------------
//
// Returns true when a markup node represents a user-component reference.
// The predicate prefers NR's resolvedKind (authoritative when NR has run);
// when resolvedKind is absent (unit-test paths that call runCE without first
// running runNR), it falls back to BS's legacy isComponent boolean. The
// fallback preserves backwards compatibility for direct CE callers; in
// production (api.js) NR always runs before CE so the resolvedKind path
// dominates. When NR ran AND classified the tag as something else
// (html-builtin, user-state-type, etc.) the predicate refuses to call it
// a component reference — NR wins over the BS heuristic.
//
// NOTE: cross-file imports use info.category === "user-component" on the
// exportRegistry record (also NR-authoritative); see lookupImportedComponent
// helpers further below.
function isUserComponentMarkup(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const m = node as { kind?: string; resolvedKind?: string; isComponent?: boolean };
  if (m.kind !== "markup") return false;
  if (m.resolvedKind === "user-component") return true;
  if (m.resolvedKind == null && m.isComponent === true) return true;
  return false;
}

/** Cross-file export registry: source-path → (name → ExportInfo). */
type ExportRegistry = Map<string, Map<string, ExportInfo>>;

/** A TAB output record keyed by file path, used for cross-file lookups. */
interface TABFileRecord {
  ast: FileAST | null;
}

/** Map of file path → TAB output record. */
type FileASTMap = Map<string, TABFileRecord>;

/**
 * A single import entry produced by `module-resolver.buildImportGraph`.
 * `absSource` is the resolved absolute filesystem path — the canonical key
 * used by `fileASTMap` and `exportRegistry`. `source` is preserved for
 * span-aware diagnostics. See SPEC §15.14.4 + §21.7 (W2).
 */
interface ImportGraphEntry {
  names: string[];
  source: string;
  absSource: string;
  isDefault?: boolean;
  span?: unknown;
}

/** Per-file import-graph node from `module-resolver.buildImportGraph`. */
interface ImportGraphNode {
  imports: ImportGraphEntry[];
}

/**
 * Import graph keyed by absolute file path, as produced by
 * `module-resolver.resolveModules` (`moduleResult.importGraph`).
 *
 * When provided to CE, lookups into `exportRegistry` and `fileASTMap` use
 * `entry.absSource` (canonical absolute-path keying). This mirrors the
 * cross-file pattern at `api.js:626-660` (TS pass) and
 * `lsp/workspace.js` (workspace bootstrap). See W2 deep-dive §6 (B2-b).
 */
type ImportGraph = Map<string, ImportGraphNode>;

// ---------------------------------------------------------------------------
// CE stage input/output shapes
// ---------------------------------------------------------------------------

/** A single file's record as it flows into CE. */
export interface CEFileInput {
  filePath: string;
  ast: FileAST;
  errors: TABErrorInfo[];
}

/** A single file's record output from CE. */
export interface CEFileOutput {
  filePath: string;
  ast: FileAST;
  errors: CEError[];
}

/** Input shape for the multi-file pipeline entry point `runCE`. */
export interface CEInput {
  files: CEFileInput[];
  exportRegistry?: ExportRegistry;
  fileASTMap?: FileASTMap;
  /**
   * Per-file import graph as produced by `module-resolver.resolveModules`.
   * When provided, CE uses `entry.absSource` (canonical absolute-path
   * keying) for cross-file `exportRegistry` and `fileASTMap` lookups.
   * If omitted (legacy callers / unit-test synthesis), CE falls back to
   * `imp.source` keying for backward compatibility (M17 fixture path).
   * See SPEC §15.14.4 + §21.7 + W2 deep-dive §6.
   */
  importGraph?: ImportGraph;
}

/** Output shape for the multi-file pipeline entry point `runCE`. */
export interface CEOutput {
  files: CEFileOutput[];
  errors: CEError[];
}

// Primitive types allowed for bind: props (§15.11.1)
const BIND_PROP_PRIMITIVE_TYPES: Set<string> = new Set(["string", "number", "boolean"]);

// Detect function-typed prop: type expression contains '=>'
function isFunctionType(typeStr: unknown): boolean {
  return typeof typeStr === "string" && (typeStr.includes("=>") || typeStr.trim().startsWith("("));
}

// ---------------------------------------------------------------------------
// Node ID counter helper
// ---------------------------------------------------------------------------

/**
 * Walk an AST node tree and return the highest `id` found.
 * Used to initialize the CE node-ID counter so new nodes do not collide
 * with IDs assigned by TAB.
 */
function findMaxId(nodes: ASTNode[]): number {
  let max = 0;

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.id === "number" && n.id > max) max = n.id;
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const val = n[key];
      if (Array.isArray(val)) {
        for (const child of val) visit(child);
      } else if (val && typeof val === "object") {
        visit(val);
      }
    }
  }

  for (const node of nodes) visit(node);
  return max;
}

// ---------------------------------------------------------------------------
// Raw normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a tokenized `raw` string from component-def back to parseable
 * scrml markup source.
 *
 * The raw field is a space-joined sequence of logic tokenizer tokens. The logic
 * tokenizer treats `<` as a PUNCT character, so the format is:
 *   `< tagname attr1 = "val1" attr2 / >`  (self-closing)
 *   `< tagname attr1 = "val1" attr2 >`    (block-form)
 *
 * After normalization:
 *   `<tagname attr1="val1" attr2/>`  (self-closing)
 *   `<tagname attr1="val1" attr2>`   (block-form)
 */
function normalizeTokenizedRaw(raw: string): string {
  let s = raw.trim();

  // Step 0 (Bug-batch S93 — Bug 4): Normalize tokenized HTML comments.
  //   The logic tokenizer splits `<!-- ... -->` into the token stream
  //   `< ! - - ... - - >` (with the `<` being an opener token, `!` punct,
  //   `- -` two hyphen tokens, and the closing `- - >` similarly). When
  //   the component-def body is re-split by BS, this tokenized form is
  //   parsed as a sequence of stray tokens — the comment-suppression at
  //   block-splitter.js:655 only matches the literal four-char prefix
  //   `<!--` (no spaces). Pre-fix, this caused BS to interpret `<!`
  //   followed by content as a stray tag opener attempt + text, and the
  //   downstream component-def body parse failed (zero markup nodes
  //   returned by `parseComponentBody`), surfacing as E-COMPONENT-020 at
  //   the use-site (the registry never received the Card component).
  //
  //   Collapse back to canonical `<!-- ... -->` so BS's comment skip
  //   machinery recognizes and discards the comment cleanly.
  //
  //   The pattern `<\s*!\s*-\s*-\s*([\s\S]*?)\s*-\s*-\s*>` non-greedily
  //   matches the tokenized comment span. Body content is preserved
  //   verbatim (no internal normalization) because comments are
  //   discarded downstream regardless.
  s = s.replace(/<\s*!\s*-\s*-\s*([\s\S]*?)\s*-\s*-\s*>/g, "<!-- $1 -->");

  // Step 0b (S94 BS-batch v2 — Shape #12): Normalize tokenized logic-block
  //   openers: "$ {" → "${" (and "$\n{" → "${").
  //
  //   When a `const Name = <markup>` component-def is declared at <program>
  //   direct-child level, the BS-batch v1 Bug 2 fix synthesises a
  //   `${ const Name = <markup-raw> }` lift wrapper with `children: []` —
  //   dropping the BS-layer BLOCK_REFs that the original markup body had
  //   for inner `${children}` / `${render name()}` slots. When parseLogicBody
  //   re-tokenizes the synthetic body, the logic tokenizer (tokenizer.ts:571)
  //   classifies `$` as `isIdentStart`, so `${children}` becomes the token
  //   stream IDENT(`$`) PUNCT(`{`) IDENT(`children`) PUNCT(`}`) — re-joined
  //   by `joinWithNewlines` as `$ { children }`. This space-separated form
  //   reaches parseComponentBody (here), and the downstream BS re-split
  //   inside parseComponentBody no longer recognises `$ {` as the logic-
  //   block opener (BS only matches the literal 2-char `${`). The inner
  //   `${children}` slot marker is silently lost; component-expander's
  //   children-slot detector finds no slot; E-COMPONENT-031 fires at every
  //   use-site that passes unslotted children.
  //
  //   Collapsing `$\s+{` back to `${` re-enables BS's logic-block detection
  //   inside the component body. The matching `}` (later in the content,
  //   at the same brace-depth) closes the synthesized logic block. Inner
  //   whitespace inside the logic body (e.g. `${ children }` after collapse)
  //   is benign — parseLogicBody trims/skips whitespace.
  //
  //   Specificity: `$` followed by whitespace followed by `{` is the
  //   tokenized form of `${`. JS identifier `$foo` has no whitespace; a
  //   regular `${...}` source has no whitespace. So this rewrite touches
  //   ONLY the tokenized re-emission shape — no false positives.
  //
  //   Must run before Step 1's `< ` → `<` collapse so the result is then
  //   subject to all subsequent markup normalisation passes.
  s = s.replace(/\$\s+\{/g, "${");

  // Step 1a': Normalize tokenized BARE closers: "< / >" → "</>"
  //   Multi-line component bodies contain internal bare closers like "</>" that
  //   the logic tokenizer emits as "< / >" (three tokens with spaces). Must run
  //   before Step 1 so the `<` is not misidentified as an opener.
  s = s.replace(/< \/ >/g, "</>");

  // Step 1a: Normalize tokenized NAMED closing tags: "< / ident >" → "</ident>"
  //   Closing tags like "</div>" appear as "< / div >" (with spaces) in the raw.
  s = s.replace(/< \/ ([A-Za-z][A-Za-z0-9_-]*) >/g, "</$1>");

  // Step 1: Remove space between `<` and the tag name (applied globally)
  //   "< tagname" → "<tagname"
  //   The logic tokenizer produces `< tagname` with a space for every opening tag.
  //   Changed from anchored /^<\s+/ to global /< ([A-Za-z])/g to handle nested tags.
  s = s.replace(/< ([A-Za-z])/g, "<$1");

  // Step 1b: Strip whitespace before `>` inside open tags (applied globally, not
  //   end-anchored). Multi-line component bodies have many internal open tags
  //   like `<div class="x" >` — the token-join leaves a space before `>`. Strip
  //   it whenever the token BEFORE the `>` is an ident-like or string-literal
  //   token (word char or closing quote), which indicates we're inside a tag.
  //   Runs before self-close handling so `/ >` is preserved.
  s = s.replace(/([A-Za-z0-9_"])\s+>/g, "$1>");

  // Step 1c (F-COMPONENT-001 F4 fix): Collapse self-closing "/ >" globally.
  //   The logic tokenizer emits `/` and `>` as separate space-padded tokens for
  //   EVERY self-closing tag in a multi-line component body, not only the body's
  //   final element. Pre-fix, only the end-anchored Step 2 below collapsed this,
  //   so an internal self-close like `<LoadStatusBadge status=load.status / >`
  //   inside a multi-root component body survived as an unmatched opening tag —
  //   block-splitter then reported E-CTX-001 (mismatched closer) + E-CTX-003
  //   (unclosed root) and `parseComponentBody` returned 0 nodes, causing
  //   E-COMPONENT-035 to fire on every cross-file use site. The pattern
  //   `\s+/\s+>` will not match inside string-literal attribute values because
  //   the logic tokenizer quote-encloses them, and will not match `</foo>`
  //   closers (no whitespace between `<` and `/`).
  s = s.replace(/\s+\/\s+>/g, "/>");

  // Step 2: Handle self-closing closer "/ >" at end → "/>"
  //   The logic tokenizer produces `/` and `>` as separate tokens,
  //   so they appear as "/ >" (with spaces) in the raw. Step 1c above handles
  //   the global case; this end-anchored sweep is retained to also catch the
  //   trailing-whitespace variant `/ >  $`.
  s = s.replace(/\s+\/\s+>(\s*)$/, "/>");
  s = s.replace(/\s+\/>\s*$/, "/>");

  // Step 3: Handle closing ">" at end → ">"
  //   Remove leading whitespace before the closing `>`.
  s = s.replace(/\s+>\s*$/, ">");

  // Step 4: Rejoin hyphenated attribute names
  //   "data - msg" → "data-msg", "aria - label" → "aria-label"
  //   The logic tokenizer splits hyphens as separate PUNCT tokens with spaces.
  s = s.replace(/(\w)\s+-\s+(\w)/g, "$1-$2");

  // Step 4b: Normalize optional prop markers: "name ? :" → "name?:"
  //   The logic tokenizer splits `?` as a separate PUNCT token with spaces.
  //   "onClose ? : type" → "onClose?: type"
  s = s.replace(/(\w)\s+\?\s*:/g, "$1?:");

  // Step 4c (Bug 2c — bind:value HTML mangle fix): Rejoin colon-separator
  // directive prefixes — "bind : value" → "bind:value", "class : active" →
  // "class:active", "on : click" → "on:click", "transition : fade" →
  // "transition:fade", "xml : lang" → "xml:lang", etc.
  //
  // Symmetric to step 4 (hyphen) and shares its safety profile: the regex
  // matches `<word>\s+:\s+<word>` globally, which also collapses spaces in
  // object literal keys (`{key : value}` → `{key:value}`), TS-style
  // annotations (`name : string` → `name:string`), and ternaries
  // (`a ? b : c` → `a ? b:c`). All three remain syntactically valid for the
  // downstream consumer (acorn / propsBlock parser / etc.) so no regression
  // is introduced.
  //
  // Without this step, the markup tokenizer's ATTR_NAME regex
  // (`[A-Za-z0-9_:\-@]`, tokenizer.ts:248) consumes no whitespace and emits
  // `bind` and `value` as two separate ATTR_NAME tokens. The `=@firstName`
  // is then bound to the second name, producing the literal HTML attribute
  // `bind value="firstName"` — a complete loss of the bind:value reactive
  // wiring contract (§5.4 / §5.4.1).
  s = s.replace(/(\w)\s+:\s+(\w)/g, "$1:$2");

  // Step 5: Remove spaces around `=` for attributes
  //   "attr = \"val\"" → "attr=\"val\""
  //   Be careful not to affect content inside attribute values.
  //   Since logic tokenizer puts spaces around every `=`, we can use
  //   a simple global replacement.
  //   Pattern: space-IDENT-space-equals or equals-space
  s = s.replace(/(\w)\s+=\s+/g, "$1=");
  s = s.replace(/\s+=\s+/g, "=");

  // Step 6 (S97 — Bug 4 root cause): Collapse tokenized call-form spacing
  // so `ident ( args )` becomes `ident(args)`. The logic tokenizer emits
  // every `(` / `)` as its own space-padded token; in attribute values
  // like `ondrop=dropOn ( name )` the markup tokenizer reads `dropOn` as
  // ATTR_IDENT (stops at the space) and then treats `(`/`name`/`)` as
  // stray attribute fragments — `name` ends up as a separate boolean
  // attribute, the original `dropOn(name)` call shape is lost, and HTML
  // emit produces `<li ondrop="dropOn" name>` instead of the intended
  // call-ref binding. Collapsing the call-form spacing restores ATTR_CALL
  // tokenization at the markup-tokenizer level (tokenizer.ts:403
  // `ch() === "("` check fires correctly).
  //
  // Three sub-steps cover the shapes the logic tokenizer emits:
  //   (a) `\w\s+\(` → `\w(`  — close the ident-to-open-paren gap
  //   (b) `\(\s+`   → `(`    — strip leading whitespace inside parens
  //   (c) `\s+\)`   → `)`    — strip trailing whitespace before close
  //
  // (a) is the load-bearing one for ATTR_CALL detection. (b)+(c) keep
  // the resulting call args tidy and prevent re-introduction of the
  // tokenized-whitespace shape downstream.
  //
  // Safety: this only collapses whitespace tokens — content inside the
  // parens (the args themselves) is preserved verbatim. The logic
  // tokenizer doesn't put newlines mid-call, so `\s+` matches only the
  // single space the tokenizer inserts. Multi-line call args (rare in
  // template bodies) would still survive because the inner content's
  // structure isn't whitespace-tokenized this way.
  s = s.replace(/(\w)\s+\(/g, "$1(");
  s = s.replace(/\(\s+/g, "(");
  s = s.replace(/\s+\)/g, ")");

  return s;
}

// ---------------------------------------------------------------------------
// Component registry builder
// ---------------------------------------------------------------------------

/**
 * Parse a component definition's `raw` expression string into markup AST nodes.
 *
 * The `raw` field from component-def is a space-joined logic token stream.
 * We normalize it back to parseable scrml markup and then run it through
 * BS + TAB to produce proper markup AST nodes.
 *
 * Returns { nodes: MarkupNode[], errors: CEError[] }
 *
 * Multi-root components (Phase 1.7+): all top-level markup nodes are returned.
 * Attrs/class merging applies to the first (primary) root node only.
 * Additional root nodes receive prop substitution but no caller attr override.
 *
 * Phase 1 limitation: Only self-closing and simple open-tag forms are supported.
 * Complex nested component bodies (those with markup children containing logic
 * blocks) are not supported and produce E-COMPONENT-021.
 */
function parseComponentBody(
  raw: string,
  componentName: string,
  filePath: string
): { nodes: MarkupNode[]; errors: CEError[] } {
  try {
    const normalized = normalizeTokenizedRaw(raw);

    const bsOut = splitBlocks(filePath + "#" + componentName, normalized);
    const tabOut = buildAST(bsOut) as { ast: FileAST; errors: TABErrorInfo[] };

    // Collect ALL markup nodes from the parsed result (multi-root support)
    const markupNodes = tabOut.ast.nodes.filter(n => n && n.kind === "markup") as MarkupNode[];

    // Filter out W-PROGRAM-001 and other warnings — they're expected for snippets
    const realErrors = tabOut.errors.filter(
      (e: TABErrorInfo) => e.severity !== "warning" && e.code !== "W-PROGRAM-001"
    );

    return {
      nodes: markupNodes,
      errors: realErrors.map((e: TABErrorInfo) => ({
        code: e.code,
        message: e.message,
        span: e.tabSpan,
      })),
    };
  } catch (e) {
    const err = e as Error;
    return {
      nodes: [],
      errors: [{
        code: "E-COMPONENT-021",
        message: err.message,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      }],
    };
  }
}

/**
 * Parse a single component-def node into a registry entry.
 * Used by both same-file and cross-file component resolution.
 */
function parseComponentDef(
  def: ExtendedComponentDefNode,
  filePath: string,
  ceErrors: CEError[]
): { nodes: MarkupNode[]; propsDecl: PropDecl[] | null; defChildren: ASTNode[] } | null {
  const { name, raw, span, defChildren } = def;
  if (!name || !raw) return null;

  const { nodes, errors: parseErrors } = parseComponentBody(raw, name, filePath);

  if (parseErrors.length > 0) {
    const defSpan = span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    ceErrors.push(makeCEError(
      "E-COMPONENT-021",
      `E-COMPONENT-021: Component \`${name}\` has a malformed body that could not be re-parsed. ` +
      `Phase 1 supports self-closing and simple open-tag component definitions only. ` +
      `Parse error: ${parseErrors[0].message}`,
      defSpan,
    ));
    return null;
  }

  if (!nodes.length) return null;

  // Extract propsDecl from the primary (first) root element's `props` attribute
  const primaryNode = nodes[0];
  let propsDecl: PropDecl[] | null = null;
  if (primaryNode && Array.isArray(primaryNode.attrs)) {
    const propsAttr = primaryNode.attrs.find((a: AttrNode) => a && a.name === "props");
    if (propsAttr && propsAttr.value && propsAttr.value.kind === "props-block") {
      propsDecl = propsAttr.value.propsDecl as PropDecl[];
    }
  }

  // §14.9: Post-process — detect snippet-typed props and set isSnippet/snippetParamType
  if (propsDecl) {
    for (const decl of propsDecl) {
      // Set defaults if not present (PropDecl objects come from ast-builder parsePropsBlock)
      if (decl.isSnippet === undefined) decl.isSnippet = false;
      if (decl.snippetParamType === undefined) decl.snippetParamType = null;

      const trimType = decl.type.trim();
      // Normalize tokenized form: "snippet ( item : string )" → "snippet(item: string)"
      // The logic tokenizer inserts spaces around punctuation.
      const normalizedType = trimType.replace(/\s+/g, " ");
      const isSnippetBase = normalizedType === "snippet" || normalizedType === "snippet?";
      const snippetParenMatch = normalizedType.match(/^snippet\s*\((.+)\)$/);
      if (isSnippetBase || snippetParenMatch) {
        decl.isSnippet = true;
        if (snippetParenMatch) {
          const inner = snippetParenMatch[1].trim();
          const colonIdx = inner.indexOf(":");
          decl.snippetParamType = colonIdx !== -1 ? inner.slice(colonIdx + 1).trim() : inner.trim();
        }
        // snippet? makes the prop optional
        if (normalizedType === "snippet?") {
          decl.optional = true;
        }
      }
    }
  }

  // §15.11.1: E-COMPONENT-014 — bind prop declared with non-primitive type
  if (propsDecl) {
    const defSpan = def?.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    for (const decl of propsDecl) {
      if (decl.bindable && !BIND_PROP_PRIMITIVE_TYPES.has(decl.type)) {
        ceErrors.push(makeCEError(
          "E-COMPONENT-014",
          `E-COMPONENT-014: \`bind\` prop \`${decl.name}\` has type \`${decl.type}\` which is not a primitive type. ` +
          `\`bind\` props must be primitive types (\`string\`, \`number\`, \`boolean\`). ` +
          `To share structured data, declare \`${decl.name}: ${decl.type}\` (without \`bind\`) and use state projection (§15.11.2).`,
          defSpan,
        ));
      }
      // §15.11.4: W-COMPONENT-001 — function-typed prop (escape hatch warning)
      // NOTE: This check is blocked when the component definition has function types in props={..}
      // because splitBlocks prematurely closes the tag on '>' inside plain {..} attribute values.
      // isFunctionType is checked here for completeness but will not fire until block-splitter.js
      // is updated to track plain { depth in scanAttributes.
      if (isFunctionType(decl.type)) {
        ceErrors.push(makeCEError(
          "W-COMPONENT-001",
          `W-COMPONENT-001: Component \`${name}\` declares function-typed prop \`${decl.name}\`. ` +
          `In scrml, child-to-parent communication is typically handled by \`bind:\` (for simple state) ` +
          `or state projection (for structured data). Function props are an escape hatch — ` +
          `prefer the state-based mechanisms when possible.`,
          defSpan,
          "warning",
        ));
      }
    }
  }

  // Remove the `props` attribute from the stored primary node
  const storedPrimary = primaryNode && Array.isArray(primaryNode.attrs)
    ? { ...primaryNode, attrs: primaryNode.attrs.filter((a: AttrNode) => a && a.name !== "props") }
    : primaryNode;

  // Secondary nodes (index 1+) are stored verbatim — no props attr stripping needed
  const storedNodes: MarkupNode[] = [storedPrimary as MarkupNode, ...nodes.slice(1)];

  return { nodes: storedNodes, propsDecl, defChildren: defChildren || [] };
}

function buildComponentRegistry(
  componentDefs: ExtendedComponentDefNode[],
  filePath: string,
  ceErrors: CEError[]
): Map<string, RegistryEntry> {
  const registry = new Map<string, RegistryEntry>();

  for (const def of componentDefs) {
    if (!def || def.kind !== "component-def") continue;

    const result = parseComponentDef(def, filePath, ceErrors);
    if (!result) continue;

    // §14.9: derive snippetProps map from propsDecl
    const snippetProps = new Map<string, PropDecl>();
    if (result.propsDecl) {
      for (const decl of result.propsDecl) {
        if (decl.isSnippet) snippetProps.set(decl.name, decl);
      }
    }

    registry.set(def.name, {
      nodes: result.nodes,
      defSpan: def.span,
      propsDecl: result.propsDecl,
      defChildren: result.defChildren,
      snippetProps,
    });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Prop substitution
// ---------------------------------------------------------------------------

/**
 * Apply prop substitutions to a cloned markup node tree.
 *
 * For Phase 1, props are the caller's attribute values. They are substituted
 * into the expanded markup by replacing occurrences of `${propName}` in
 * string-literal attribute values and text node content.
 */
function applyPropSubstitutions(text: string, props: Map<string, string>): string {
  if (props.size === 0) return text;
  return text.replace(/\$\{([^}]+)\}/g, (match: string, name: string) => {
    const trimmed = name.trim();
    return props.has(trimmed) ? (props.get(trimmed) as string) : match;
  });
}

/**
 * F-COMPONENT-004: Build a parallel map of prop name → ExprNode form of the prop value.
 *
 * For each caller-side attribute value:
 *  - string-literal `name="Alice"` → LitExpr { litType: "string", value: "Alice", raw: "\"Alice\"" }
 *  - variable-ref `name=@user`     → IdentExpr { name: "@user" } (parsed from the raw text)
 *  - declared default (raw text)   → parseExprToNode(default)
 *  - "null" optional default       → LitExpr { litType: "not", raw: "null" }
 *    (S90 M-7C-D-12 Track 1: canonical `litType:"not"` discriminator; `raw`
 *    preserves source-token provenance.)
 *
 * The ExprNode form is used by `substitutePropsInExprNode` to replace IdentExpr
 * references inside logic-block bodies with the typed prop value (rather than
 * raw text substitution, which would mangle string values into bare identifiers).
 */
function buildPropExprMap(
  props: Map<string, string>,
  callerAttrs: AttrNode[],
  propsDecl: PropDecl[] | null,
  filePath: string,
  fallbackSpan: Span,
): Map<string, ExprNode> {
  const out = new Map<string, ExprNode>();
  if (props.size === 0) return out;

  const exprSpan: ExprSpan = {
    file: filePath,
    start: fallbackSpan.start ?? 0,
    end: fallbackSpan.end ?? 0,
    line: 1,
    col: 1,
  };

  // Index attrs by name for type lookup
  const attrByName = new Map<string, AttrNode>();
  for (const a of callerAttrs ?? []) {
    if (a && a.name) attrByName.set(a.name, a);
  }

  for (const [name, value] of props.entries()) {
    const attr = attrByName.get(name);
    if (attr && attr.value) {
      if (attr.value.kind === "string-literal") {
        // Treat as a JS string literal
        out.set(name, {
          kind: "lit",
          span: exprSpan,
          raw: JSON.stringify(value),
          value: value,
          litType: "string",
        } satisfies LitExpr);
        continue;
      }
      if (attr.value.kind === "variable-ref") {
        // Use the prebuilt ExprNode if present, else synthesize an IdentExpr
        const pre = (attr.value as { exprNode?: ExprNode }).exprNode;
        if (pre) {
          out.set(name, pre);
        } else {
          out.set(name, {
            kind: "ident",
            span: exprSpan,
            name: value,
          } satisfies IdentExpr);
        }
        continue;
      }
      if (attr.value.kind === "expr") {
        const pre = (attr.value as { exprNode?: ExprNode }).exprNode;
        if (pre) {
          out.set(name, pre);
          continue;
        }
        // Fall through to parse-the-text path
      }
    }
    // Default-value path or fallback: parse the raw text as an expression.
    // §42 absence canon (S90 M-7C-D-12 Track 1): the `null` default text
    // synthesizes a canonical `litType:"not"` LitExpr with `raw:"null"`
    // to preserve source-token provenance. The deprecated `"null"` variant
    // is no longer manufactured.
    if (value === "null") {
      out.set(name, {
        kind: "lit",
        span: exprSpan,
        raw: "null",
        value: null,
        litType: "not",
      } satisfies LitExpr);
      continue;
    }
    try {
      const parsed = parseExprToNode(value, filePath, exprSpan.start);
      out.set(name, parsed);
    } catch (_e) {
      // Worst case: treat as opaque escape-hatch (the caller-side text)
      out.set(name, {
        kind: "escape-hatch",
        span: exprSpan,
        nativeKind: "PropDefaultParseFailure",
        raw: value,
      } satisfies EscapeHatchExpr);
    }
  }
  return out;
}

/**
 * F-COMPONENT-004: Walk an ExprNode tree and substitute identifier references
 * to declared props with their typed ExprNode form. Returns a new tree.
 *
 * Shadowing rules:
 *  - LambdaExpr: parameter names shadow props inside the lambda body.
 *  - LambdaExpr block body: local declarations shadow props from that point on.
 *  - The `shadowed` set is a copy-on-grow Set tracked through scope boundaries.
 *
 * MemberExpr: only the leftmost identifier is a candidate; `name.length`
 * substitutes `name` (the object) but leaves `.length` (the property string) alone.
 *
 * EscapeHatchExpr: not walked (opaque). Templates may carry interpolations as
 * EscapeHatchExpr (TemplateLiteral) — we re-parse via parseExprToNode if it
 * appears to contain a `${...}` segment referencing a prop, but keep the original
 * tree if re-parse fails.
 */
function substitutePropsInExprNode(
  node: ExprNode,
  propExprMap: Map<string, ExprNode>,
  shadowed: Set<string>,
): ExprNode {
  if (!node) return node;
  switch (node.kind) {
    case "ident": {
      const ident = node as IdentExpr;
      if (shadowed.has(ident.name)) return ident;
      const sub = propExprMap.get(ident.name);
      if (sub) return sub;
      return ident;
    }
    case "lit": {
      const lit = node as LitExpr;
      // Template literals may contain `${...}` interpolations referencing props.
      // We re-parse the raw template text with prop-name substitutions applied
      // to identifier references inside each `${...}` segment.
      if (lit.litType === "template" && typeof lit.raw === "string" && lit.raw.includes("${")) {
        const rewritten = rewriteTemplateInterpolations(lit.raw, propExprMap, shadowed);
        if (rewritten !== lit.raw) {
          return { ...lit, raw: rewritten } satisfies LitExpr;
        }
      }
      return lit;
    }
    case "sql-ref":
    case "input-state-ref":
      return node;
    case "escape-hatch": {
      const eh = node as EscapeHatchExpr;
      // Template-literal-shaped escape hatches: rewrite interpolations
      if (eh.nativeKind === "TemplateLiteral" && typeof eh.raw === "string" && eh.raw.includes("${")) {
        const rewritten = rewriteTemplateInterpolations(eh.raw, propExprMap, shadowed);
        if (rewritten !== eh.raw) {
          return { ...eh, raw: rewritten } satisfies EscapeHatchExpr;
        }
      }
      return eh;
    }
    case "array": {
      const n = node as ArrayExpr;
      const newEls = n.elements.map((el) => substitutePropsInExprNode(el as ExprNode, propExprMap, shadowed) as (ExprNode | SpreadExpr));
      return { ...n, elements: newEls } satisfies ArrayExpr;
    }
    case "object": {
      const n = node as ObjectExpr;
      const newProps = n.props.map((prop) => {
        if (prop.kind === "prop") {
          const newKey = typeof prop.key === "string"
            ? prop.key
            : substitutePropsInExprNode(prop.key as ExprNode, propExprMap, shadowed);
          const newValue = substitutePropsInExprNode(prop.value, propExprMap, shadowed);
          return { ...prop, key: newKey, value: newValue };
        }
        if (prop.kind === "shorthand") {
          // Shorthand `{ x }` is both key and value reference. If `x` is a prop,
          // expand to `{ x: <propValue> }`.
          if (!shadowed.has(prop.name) && propExprMap.has(prop.name)) {
            return {
              kind: "prop",
              key: prop.name,
              value: propExprMap.get(prop.name) as ExprNode,
              computed: false,
              span: prop.span,
            } as typeof prop & { kind: "prop" };
          }
          return prop;
        }
        if (prop.kind === "spread") {
          return { ...prop, argument: substitutePropsInExprNode(prop.argument, propExprMap, shadowed) };
        }
        return prop;
      });
      return { ...n, props: newProps } satisfies ObjectExpr;
    }
    case "spread": {
      const n = node as SpreadExpr;
      return { ...n, argument: substitutePropsInExprNode(n.argument, propExprMap, shadowed) } satisfies SpreadExpr;
    }
    case "unary": {
      const n = node as UnaryExpr;
      return { ...n, argument: substitutePropsInExprNode(n.argument, propExprMap, shadowed) } satisfies UnaryExpr;
    }
    case "binary": {
      const n = node as BinaryExpr;
      return {
        ...n,
        left: substitutePropsInExprNode(n.left, propExprMap, shadowed),
        right: substitutePropsInExprNode(n.right, propExprMap, shadowed),
      } satisfies BinaryExpr;
    }
    case "assign": {
      const n = node as AssignExpr;
      return {
        ...n,
        target: substitutePropsInExprNode(n.target, propExprMap, shadowed),
        value: substitutePropsInExprNode(n.value, propExprMap, shadowed),
      } satisfies AssignExpr;
    }
    case "ternary": {
      const n = node as TernaryExpr;
      return {
        ...n,
        condition: substitutePropsInExprNode(n.condition, propExprMap, shadowed),
        consequent: substitutePropsInExprNode(n.consequent, propExprMap, shadowed),
        alternate: substitutePropsInExprNode(n.alternate, propExprMap, shadowed),
      } satisfies TernaryExpr;
    }
    case "member": {
      const n = node as MemberExpr;
      // Only walk `object`; `property` is a static name string (not a binding).
      return { ...n, object: substitutePropsInExprNode(n.object, propExprMap, shadowed) } satisfies MemberExpr;
    }
    case "index": {
      const n = node as IndexExpr;
      return {
        ...n,
        object: substitutePropsInExprNode(n.object, propExprMap, shadowed),
        index: substitutePropsInExprNode(n.index, propExprMap, shadowed),
      } satisfies IndexExpr;
    }
    case "call": {
      const n = node as CallExpr;
      return {
        ...n,
        callee: substitutePropsInExprNode(n.callee, propExprMap, shadowed),
        args: n.args.map((a) => substitutePropsInExprNode(a as ExprNode, propExprMap, shadowed) as (ExprNode | SpreadExpr)),
      } satisfies CallExpr;
    }
    case "new": {
      const n = node as NewExpr;
      return {
        ...n,
        callee: substitutePropsInExprNode(n.callee, propExprMap, shadowed),
        args: n.args.map((a) => substitutePropsInExprNode(a as ExprNode, propExprMap, shadowed) as (ExprNode | SpreadExpr)),
      } satisfies NewExpr;
    }
    case "lambda": {
      const n = node as LambdaExpr;
      // Parameter shadowing: extend shadowed set with all param names for the lambda body.
      // Default values evaluate in the OUTER scope (not shadowed by params).
      const newParams = n.params.map((p) => {
        if (p.defaultValue) {
          return { ...p, defaultValue: substitutePropsInExprNode(p.defaultValue, propExprMap, shadowed) };
        }
        return p;
      });
      const innerShadowed = new Set(shadowed);
      for (const p of n.params) innerShadowed.add(p.name);
      let newBody: LambdaExpr["body"];
      if (n.body.kind === "expr") {
        newBody = { kind: "expr", value: substitutePropsInExprNode(n.body.value, propExprMap, innerShadowed) };
      } else {
        newBody = { kind: "block", stmts: substitutePropsInLogicStmts(n.body.stmts, propExprMap, innerShadowed) };
      }
      return { ...n, params: newParams, body: newBody } satisfies LambdaExpr;
    }
    case "cast": {
      const n = node as CastExpr;
      return { ...n, expression: substitutePropsInExprNode(n.expression, propExprMap, shadowed) } satisfies CastExpr;
    }
    case "match-expr": {
      const n = node as MatchExpr;
      // Walk subject. Arms are raw strings (Phase 1) — cannot structurally substitute.
      return { ...n, subject: substitutePropsInExprNode(n.subject, propExprMap, shadowed) } satisfies MatchExpr;
    }
    case "reset-expr": {
      const n = node as ResetExpr;
      // §6.8.2 — substitute prop-name references inside the reset target.
      // Diagnostic field is preserved verbatim (parse-time annotation).
      return { ...n, target: substitutePropsInExprNode(n.target, propExprMap, shadowed) } satisfies ResetExpr;
    }
    default: {
      // TypeScript exhaustiveness check.
      return node;
    }
  }
}

/**
 * F-COMPONENT-004: Rewrite the contents of `${...}` interpolations inside a
 * raw template-literal source text, applying prop-name substitutions to
 * identifier references. The substitution is text-level for simplicity
 * (templates carry raw text); we replace bare identifier reads only.
 *
 * Heuristic: for each `${...}` segment, we apply a regex-based substitution
 * that replaces identifier-shaped tokens matching declared props with the
 * emitStringFromTree() of the substituted ExprNode. This is a best-effort
 * rewrite — complex expressions inside `${...}` (e.g. with their own lambdas
 * and shadowing) are not perfectly handled; the substitution is conservative
 * and only replaces bare identifier reads not preceded by `.` (member access).
 */
function rewriteTemplateInterpolations(
  raw: string,
  propExprMap: Map<string, ExprNode>,
  shadowed: Set<string>,
): string {
  if (propExprMap.size === 0) return raw;
  // Walk the string, finding `${...}` segments at the top brace level.
  // For each, rewrite identifier references that match props (and are not shadowed,
  // not preceded by `.`).
  const out: string[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw.charCodeAt(i);
    if (ch === 92 /* \ */) {
      // Escaped char in template — copy 2 chars.
      out.push(raw.slice(i, Math.min(i + 2, n)));
      i += 2;
      continue;
    }
    if (ch === 36 /* $ */ && i + 1 < n && raw.charCodeAt(i + 1) === 123 /* { */) {
      // Find matching `}` respecting nested braces and strings.
      const start = i + 2;
      let depth = 1;
      let j = start;
      while (j < n && depth > 0) {
        const c = raw.charCodeAt(j);
        if (c === 92) { j += 2; continue; }
        if (c === 123) { depth++; j++; continue; }
        if (c === 125) { depth--; j++; continue; }
        if (c === 39 || c === 34) {
          const quote = c;
          j++;
          while (j < n) {
            const sc = raw.charCodeAt(j);
            if (sc === 92) { j += 2; continue; }
            if (sc === quote) { j++; break; }
            j++;
          }
          continue;
        }
        j++;
      }
      const exprText = raw.slice(start, Math.max(start, j - 1));
      const rewritten = rewriteIdentsInRawExpr(exprText, propExprMap, shadowed);
      out.push("${" + rewritten + "}");
      i = j;
      continue;
    }
    out.push(raw[i]);
    i++;
  }
  return out.join("");
}

/**
 * Rewrite identifier references in a raw expression-text fragment. Replaces
 * bare identifier tokens matching declared props (and not shadowed, not
 * preceded by `.`) with the emit-string form of the substituted ExprNode.
 * This is a token-level pass suitable for template-interpolation contents
 * where re-parse-and-re-emit would risk altering whitespace and semantics.
 */
function rewriteIdentsInRawExpr(
  text: string,
  propExprMap: Map<string, ExprNode>,
  shadowed: Set<string>,
): string {
  if (!text) return text;
  // \b(name)\b but ensure not preceded by `.` (member access) and not inside a string.
  // For safety we use a simple regex pass; templates inside `${...}` rarely
  // contain string literals containing prop names, but we attempt to skip
  // string contents.
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = text[i];
        if (c === "\\") { out += text.slice(i, Math.min(i + 2, n)); i += 2; continue; }
        out += c;
        i++;
        if (c === q) break;
      }
      continue;
    }
    // Identifier start (incl. @ for reactive vars)
    if (/[A-Za-z_$@]/.test(ch)) {
      let j = i;
      // Allow leading @ then ident chars
      if (ch === "@") j++;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      // Check predecessor: skip if preceded by `.` (member access)
      let k = out.length - 1;
      while (k >= 0 && /\s/.test(out[k])) k--;
      const precededByDot = k >= 0 && out[k] === ".";
      if (!precededByDot && !shadowed.has(word) && propExprMap.has(word)) {
        const sub = propExprMap.get(word) as ExprNode;
        out += emitStringFromTree(sub);
      } else {
        out += word;
      }
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * F-COMPONENT-004: Walk a list of LogicStatements and substitute prop refs.
 * Tracks local declarations as shadowing entries from the point of declaration onward.
 */
function substitutePropsInLogicStmts(
  stmts: LogicStatement[],
  propExprMap: Map<string, ExprNode>,
  shadowed: Set<string>,
): LogicStatement[] {
  // Use a local mutable copy of `shadowed` so declarations persist for subsequent stmts.
  const localShadowed = new Set(shadowed);
  const out: LogicStatement[] = [];
  for (const stmt of stmts) {
    out.push(substitutePropsInLogicStmt(stmt, propExprMap, localShadowed));
  }
  return out;
}

/**
 * F-COMPONENT-004: Substitute prop refs inside a single LogicStatement. Mutates
 * `shadowed` to add any names declared by this statement (so subsequent stmts
 * in the same scope see the shadowing).
 */
function substitutePropsInLogicStmt(
  stmt: LogicStatement,
  propExprMap: Map<string, ExprNode>,
  shadowed: Set<string>,
): LogicStatement {
  if (!stmt || typeof stmt !== "object") return stmt;
  const subInExpr = (e: ExprNode | undefined) =>
    e ? substitutePropsInExprNode(e, propExprMap, shadowed) : e;
  const subInStmts = (ss: LogicStatement[] | undefined | null) =>
    ss ? substitutePropsInLogicStmts(ss, propExprMap, shadowed) : ss;
  switch (stmt.kind) {
    case "let-decl":
    case "const-decl":
    case "tilde-decl":
    case "lin-decl":
    case "state-decl": {
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl.
      // S79 — `reactive-debounced-decl` retired (§6.13 reactivity attribute).
      const n = stmt as LetDeclNode | ConstDeclNode | TildeDeclNode | LinDeclNode | ReactiveDeclNode;
      const newInit = subInExpr(n.initExpr);
      const newNode = { ...n, initExpr: newInit } as typeof n;
      // After this declaration, the name shadows any same-named prop for subsequent stmts.
      // Reactive vars use @-prefix; we add both forms to be safe (if prop name is `count`,
      // a `@count` reactive declaration shadows further refs).
      if (n.name) {
        if (n.kind === "state-decl") {
          shadowed.add("@" + n.name);
        } else {
          shadowed.add(n.name);
        }
      }
      return newNode;
    }
    case "reactive-nested-assign": {
      const n = stmt as ReactiveNestedAssignNode;
      return { ...n, valueExpr: subInExpr(n.valueExpr) } as ReactiveNestedAssignNode;
    }
    case "function-decl": {
      const n = stmt as FunctionDeclNode;
      // Function params shadow props inside the body.
      const innerShadowed = new Set(shadowed);
      for (const p of n.params ?? []) {
        // Param strings may be "name" or "name: Type" or "name = default"
        const m = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(p);
        if (m) innerShadowed.add(m[1]);
      }
      const newBody = substitutePropsInLogicStmts(n.body, propExprMap, innerShadowed);
      // The function name shadows props in subsequent statements.
      if (n.name) shadowed.add(n.name);
      return { ...n, body: newBody } satisfies FunctionDeclNode;
    }
    case "if-stmt":
    case "if-expr": {
      const n = stmt as IfStmtNode | IfExprNode;
      return {
        ...n,
        condExpr: subInExpr(n.condExpr),
        consequent: subInStmts(n.consequent) as LogicStatement[],
        alternate: n.alternate ? (subInStmts(n.alternate) as LogicStatement[]) : null,
      } as typeof n;
    }
    case "for-expr":
    case "for-stmt": {
      const n = stmt as ForExprNode | ForStmtNode;
      // Loop variable shadows props inside the body.
      const innerShadowed = new Set(shadowed);
      if ((n as ForStmtNode).variable) innerShadowed.add((n as ForStmtNode).variable);
      const cStyle = (n as ForStmtNode).cStyleParts;
      const newCStyle = cStyle ? {
        initExpr: substitutePropsInExprNode(cStyle.initExpr, propExprMap, shadowed),
        condExpr: substitutePropsInExprNode(cStyle.condExpr, propExprMap, innerShadowed),
        updateExpr: substitutePropsInExprNode(cStyle.updateExpr, propExprMap, innerShadowed),
      } : undefined;
      const result: any = {
        ...n,
        iterExpr: (n as ForStmtNode).iterExpr ? substitutePropsInExprNode((n as ForStmtNode).iterExpr as ExprNode, propExprMap, shadowed) : (n as ForStmtNode).iterExpr,
        body: substitutePropsInLogicStmts(n.body, propExprMap, innerShadowed),
      };
      if (newCStyle) result.cStyleParts = newCStyle;
      return result;
    }
    case "while-stmt": {
      const n = stmt as WhileStmtNode;
      return {
        ...n,
        condExpr: subInExpr(n.condExpr),
        body: substitutePropsInLogicStmts(n.body, propExprMap, shadowed),
      } satisfies WhileStmtNode;
    }
    case "return-stmt": {
      const n = stmt as ReturnStmtNode;
      return { ...n, exprNode: subInExpr(n.exprNode) } satisfies ReturnStmtNode;
    }
    case "throw-stmt": {
      const n = stmt as ThrowStmtNode;
      return { ...n, exprNode: subInExpr(n.exprNode) } satisfies ThrowStmtNode;
    }
    case "switch-stmt": {
      const n = stmt as SwitchStmtNode;
      return {
        ...n,
        headerExpr: subInExpr(n.headerExpr),
        body: substitutePropsInLogicStmts(n.body, propExprMap, shadowed),
      } satisfies SwitchStmtNode;
    }
    case "try-stmt": {
      const n = stmt as TryStmtNode;
      return {
        ...n,
        body: substitutePropsInLogicStmts(n.body, propExprMap, shadowed),
        catchNode: n.catchNode ? {
          ...n.catchNode,
          body: substitutePropsInLogicStmts(n.catchNode.body, propExprMap, shadowed),
        } : undefined,
        finallyNode: n.finallyNode ? {
          ...n.finallyNode,
          body: substitutePropsInLogicStmts(n.finallyNode.body, propExprMap, shadowed),
        } : undefined,
      } satisfies TryStmtNode;
    }
    case "match-stmt": {
      const n = stmt as MatchStmtNode;
      return {
        ...n,
        headerExpr: subInExpr(n.headerExpr),
        body: substitutePropsInLogicStmts(n.body, propExprMap, shadowed),
      } satisfies MatchStmtNode;
    }
    case "match-arm-inline": {
      const n = stmt as MatchArmInlineNode;
      // Extend shadowed with the arm's binding (if any) for the result expression.
      const armShadowed = n.binding ? new Set([...shadowed, n.binding]) : shadowed;
      return {
        ...n,
        resultExpr: n.resultExpr ? substitutePropsInExprNode(n.resultExpr, propExprMap, armShadowed) : n.resultExpr,
      } satisfies MatchArmInlineNode;
    }
    case "bare-expr": {
      const n = stmt as BareExprNode;
      return { ...n, exprNode: subInExpr(n.exprNode) } satisfies BareExprNode;
    }
    case "lift-expr": {
      const n = stmt as LiftExprNode;
      // LiftTarget can be inline markup or an expression; we only walk the expr case.
      // Markup target case is handled by recursion into MarkupNode children via substituteProps.
      const tgt = (n as any).expr;
      if (tgt && typeof tgt === "object" && tgt.kind && (tgt.kind === "ident" || tgt.kind === "lit" || tgt.kind === "binary" || tgt.kind === "call" || tgt.kind === "member" || tgt.kind === "lambda" || tgt.kind === "ternary")) {
        return { ...n, expr: substitutePropsInExprNode(tgt as ExprNode, propExprMap, shadowed) } as LiftExprNode;
      }
      // Otherwise recurse via substituteProps for the markup-target case
      if (tgt && typeof tgt === "object" && tgt.kind === "markup") {
        // We need access to the (string) props for markup recursion; the caller
        // (substituteProps) will handle this case via its array-walk fallback.
      }
      return n;
    }
    case "propagate-expr": {
      const n = stmt as PropagateExprNode;
      // Binding (if present) shadows props in subsequent statements.
      if (n.binding) shadowed.add(n.binding);
      return { ...n, exprNode: subInExpr(n.exprNode) } satisfies PropagateExprNode;
    }
    case "guarded-expr": {
      const n = stmt as GuardedExprNode;
      return {
        ...n,
        guardedNode: substitutePropsInLogicStmt(n.guardedNode, propExprMap, shadowed),
      } satisfies GuardedExprNode;
    }
    case "when-effect": {
      const n = stmt as WhenEffectNode;
      return { ...n, bodyExpr: subInExpr(n.bodyExpr) } satisfies WhenEffectNode;
    }
    case "when-message": {
      const n = stmt as WhenMessageNode;
      // The binding name shadows props inside the body
      if (n.bodyExpr) {
        const inner = new Set(shadowed);
        if (n.binding) inner.add(n.binding);
        return { ...n, bodyExpr: substitutePropsInExprNode(n.bodyExpr, propExprMap, inner) } satisfies WhenMessageNode;
      }
      return n;
    }
    case "cleanup-registration": {
      const n = stmt as CleanupRegistrationNode;
      return { ...n, callbackExpr: subInExpr(n.callbackExpr) } satisfies CleanupRegistrationNode;
    }
    // S81 OQ-2 (2026-05-11): `case "debounce-call"` + `case "throttle-call"`
    // RETIRED. Imperative form lowered to regular CallExpr via stdlib import;
    // ExprNode substitution already handles regular CallExprs at the
    // generic recursion path.
    case "upload-call": {
      const n = stmt as UploadCallNode;
      return {
        ...n,
        fileExpr: subInExpr(n.fileExpr),
        urlExpr: subInExpr(n.urlExpr),
      } satisfies UploadCallNode;
    }
    case "transaction-block": {
      const n = stmt as TransactionBlockNode;
      return {
        ...n,
        body: substitutePropsInLogicStmts(n.body, propExprMap, shadowed),
      } satisfies TransactionBlockNode;
    }
    case "markup":
      // Defer to substituteProps for markup nodes that appear as logic-body children.
      // We do not have the (string) props map here — return as-is; the outer
      // substituteProps walker will descend into markup via its array-walk fallback.
      return stmt;
    case "meta": {
      const n = stmt as MetaNode;
      return {
        ...n,
        body: substitutePropsInLogicStmts(n.body, propExprMap, shadowed),
      } satisfies MetaNode;
    }
    default:
      // import-decl, export-decl, type-decl, fail-expr, html-fragment, sql, css-inline,
      // error-effect, reactive-array-mutation, reactive-explicit-set, component-def,
      // use-decl — none of these contain ExprNode subtrees that need prop substitution
      // (or carry only raw strings that we leave unchanged).
      return stmt;
  }
}

/**
 * Substitute props recursively through a cloned AST node tree.
 *
 * F-COMPONENT-004: extended to accept an optional `propExprMap` (typed prop
 * values keyed by name) used by `substitutePropsInExprNode` to substitute
 * IdentExpr references inside logic-block bodies.
 */
function substituteProps(
  node: ASTNode,
  props: Map<string, string>,
  propExprMap?: Map<string, ExprNode>,
): ASTNode {
  if (!node || typeof node !== "object") return node;
  if (props.size === 0) return node;

  // Clone the node shallowly
  const cloned = { ...node } as Record<string, unknown>;

  // Text nodes: substitute in value
  if (cloned.kind === "text") {
    const newVal = applyPropSubstitutions((cloned.value as string) ?? "", props);
    if (newVal !== cloned.value) {
      cloned.value = newVal;
    }
    return cloned as unknown as ASTNode;
  }

  // Markup nodes: substitute in attrs and recurse into children
  if (cloned.kind === "markup") {
    if (Array.isArray(cloned.attrs)) {
      cloned.attrs = (cloned.attrs as AttrNode[]).map((attr: AttrNode) => {
        if (!attr || !attr.value) return attr;
        if (attr.value.kind === "string-literal") {
          const newVal = applyPropSubstitutions(attr.value.value, props);
          if (newVal !== attr.value.value) {
            return { ...attr, value: { ...attr.value, value: newVal } };
          }
        }
        // S97 — Bug 4 fix: substitute prop refs inside structured attribute
        // values (call-ref / variable-ref / expr). Without this, refs like
        // `dropOn(name)` in a template's `<li ondrop=dropOn(name)>` leave the
        // `name` IdentExpr pointing at a non-existent local. With the
        // normalizeTokenizedRaw fix (Step 6) the tokenizer now correctly
        // produces ATTR_CALL with the inner `name` arg; without prop
        // substitution here, the emitted handler is
        // `function(event){ _scrml_dropOn(name); }` where `name` is unbound.
        // Same shape applies to any prop-typed ident passed as an event-
        // handler arg, conditional, or bind target.
        if (propExprMap && attr.value.kind === "call-ref") {
          const callVal = attr.value as { name: string; args: string[]; argExprNodes?: ExprNode[]; span: ExprSpan };
          const argNodes = callVal.argExprNodes;
          if (Array.isArray(argNodes) && argNodes.length > 0) {
            let changed = false;
            const newArgNodes = argNodes.map((node) => {
              const replaced = substitutePropsInExprNode(node, propExprMap, new Set());
              if (replaced !== node) changed = true;
              return replaced;
            });
            if (changed) {
              // Re-serialize args from substituted nodes so the raw `args`
              // strings (consumed by emit-event-wiring + HTML emit paths
              // that don't read argExprNodes) reflect the substitution.
              const newArgs = newArgNodes.map((n) => {
                try {
                  return emitStringFromTree(n as ExprNode);
                } catch (_e) {
                  return ""; // defensive — should not fire for sub'd nodes
                }
              });
              return { ...attr, value: { ...callVal, args: newArgs, argExprNodes: newArgNodes } };
            }
          }
        }
        if (propExprMap && attr.value.kind === "variable-ref") {
          const varVal = attr.value as { name: string; exprNode?: ExprNode; span: ExprSpan };
          // The variable-ref's `name` is the raw text (e.g. "name", "@cell").
          // Check if the bare name (stripped of leading `@`) is a prop.
          const bareName = varVal.name.startsWith("@") ? varVal.name.slice(1) : varVal.name;
          if (propExprMap.has(bareName)) {
            const propExpr = propExprMap.get(bareName)!;
            let raw = "";
            try {
              raw = emitStringFromTree(propExpr);
            } catch (_e) {
              raw = varVal.name;
            }
            return {
              ...attr,
              value: {
                kind: "expr",
                raw,
                refs: [],
                exprNode: propExpr,
                span: varVal.span,
              },
            };
          }
          // Also substitute inside a pre-parsed exprNode if the name itself
          // wasn't a direct prop match but the exprNode contains prop refs.
          if (varVal.exprNode) {
            const replaced = substitutePropsInExprNode(varVal.exprNode, propExprMap, new Set());
            if (replaced !== varVal.exprNode) {
              let raw = varVal.name;
              try {
                raw = emitStringFromTree(replaced);
              } catch (_e) { /* keep original */ }
              return { ...attr, value: { ...varVal, name: raw, exprNode: replaced } };
            }
          }
        }
        if (propExprMap && attr.value.kind === "expr") {
          const exprVal = attr.value as { raw: string; refs: string[]; exprNode?: ExprNode; span: ExprSpan };
          if (exprVal.exprNode) {
            const replaced = substitutePropsInExprNode(exprVal.exprNode, propExprMap, new Set());
            if (replaced !== exprVal.exprNode) {
              let raw = exprVal.raw;
              try {
                raw = emitStringFromTree(replaced);
              } catch (_e) { /* keep original */ }
              return { ...attr, value: { ...exprVal, raw, exprNode: replaced } };
            }
          }
        }
        return attr;
      });
    }
    if (Array.isArray(cloned.children)) {
      cloned.children = (cloned.children as ASTNode[]).map((child: ASTNode) => substituteProps(child, props, propExprMap));
    }
    return cloned as unknown as ASTNode;
  }

  // F-COMPONENT-004: Logic blocks — walk body statements and substitute prop refs
  // inside ExprNode subtrees. Without this, identifier references to props inside
  // logic-block bodies would error at TS as undeclared.
  if (cloned.kind === "logic" && propExprMap && Array.isArray(cloned.body)) {
    const newBody = substitutePropsInLogicStmts(
      cloned.body as LogicStatement[],
      propExprMap,
      new Set<string>(),
    );
    cloned.body = newBody;
    // Also recurse into any markup children embedded as body items (e.g. lift target markup)
    cloned.body = (cloned.body as LogicStatement[]).map((item: any) => {
      if (item && typeof item === "object" && (item.kind === "markup" || item.kind === "state")) {
        return substituteProps(item as ASTNode, props, propExprMap) as LogicStatement;
      }
      // Lift-expr with markup target: descend into the markup
      if (item && item.kind === "lift-expr" && item.expr && typeof item.expr === "object" && (item.expr.kind === "markup" || item.expr.kind === "state")) {
        return { ...item, expr: substituteProps(item.expr as ASTNode, props, propExprMap) } as LogicStatement;
      }
      return item;
    });
    return cloned as unknown as ASTNode;
  }

  // F-COMPONENT-004: Meta blocks share the LogicStatement[] body shape.
  if (isMetaKind(cloned.kind) && propExprMap && Array.isArray(cloned.body)) {
    cloned.body = substitutePropsInLogicStmts(
      cloned.body as LogicStatement[],
      propExprMap,
      new Set<string>(),
    );
    return cloned as unknown as ASTNode;
  }

  // Other node kinds: recurse into any array fields that look like node lists
  for (const key of Object.keys(cloned)) {
    if (key === "span" || key === "id") continue;
    if (Array.isArray(cloned[key])) {
      cloned[key] = (cloned[key] as unknown[]).map((item: unknown) => {
        if (item && typeof item === "object" && (item as Record<string, unknown>).kind) {
          return substituteProps(item as ASTNode, props, propExprMap);
        }
        return item;
      });
    }
  }

  return cloned as unknown as ASTNode;
}

// ---------------------------------------------------------------------------
// Class attribute merging
// ---------------------------------------------------------------------------

/**
 * Merge class attribute values.
 *
 * Rule: base (from component definition) + caller (space-separated), deduplicating
 * extra spaces. The base class from the component definition appears first.
 */
function mergeClasses(baseClass: string | null, callerClass: string | null): string | null {
  const base = (baseClass ?? "").trim();
  const caller = (callerClass ?? "").trim();
  if (!base && !caller) return null;
  if (!base) return caller;
  if (!caller) return base;
  return `${base} ${caller}`;
}

// ---------------------------------------------------------------------------
// Component expansion
// ---------------------------------------------------------------------------

/**
 * Expand a single component reference node.
 *
 * Replaces `node` (a markup node resolved as user-component) with the component's
 * root elements, merging attributes and substituting props.
 *
 * For multi-root components:
 *   - The primary (first) root node receives the full treatment: attrs/class
 *     merging, children injection, prop substitution, bind: wiring.
 *   - Secondary root nodes (index 1+) receive prop substitution only; they
 *     are emitted as siblings after the primary expanded node.
 *
 * Returns an array of expanded nodes (original node wrapped in a single-element
 * array if expansion fails, with error added to ceErrors).
 */
function expandComponentNode(
  node: MarkupNode,
  registry: Map<string, RegistryEntry>,
  filePath: string,
  counter: NodeCounter,
  ceErrors: CEError[]
): MarkupNode[] {
  const componentName = node.tag;
  const def = registry.get(componentName);

  if (!def) {
    // E-COMPONENT-020: unresolved component reference
    ceErrors.push(makeCEError(
      "E-COMPONENT-020",
      `E-COMPONENT-020: Component \`${componentName}\` is not defined in this file. ` +
      `Define it with \`const ${componentName} = <element .../>\` before using it, ` +
      `or check the spelling.`,
      node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
    ));
    // Leave the node as-is to allow downstream error recovery
    return [node];
  }

  // Primary root node (attrs/class/children merging applies to this one)
  const defNode = def.nodes[0];
  // Secondary root nodes (prop substitution only, emitted as siblings)
  const extraDefNodes = def.nodes.slice(1);

  // Build a props map from the caller's attribute values
  // Each caller attr (non-class) becomes a named prop: attr.name → string value
  const props = new Map<string, string>();
  const callerAttrs: AttrNode[] = node.attrs ?? [];
  let callerClassValue: string | null = null;

  for (const attr of callerAttrs) {
    if (!attr || !attr.name) continue;
    if (attr.name === "class") {
      // Collect class separately for merging
      if (attr.value && attr.value.kind === "string-literal") {
        callerClassValue = attr.value.value;
      }
      continue;
    }
    // For other attributes: extract string value for prop substitution
    if (attr.value && attr.value.kind === "string-literal") {
      props.set(attr.name, attr.value.value);
    } else if (attr.value && attr.value.kind === "variable-ref") {
      props.set(attr.name, attr.value.name);
    }
  }

  // §14.9 Phase 1.5: Slot detection — group caller children by slot="name"
  const slottedGroups = new Map<string, ASTNode[]>();
  const unslottedChildren: ASTNode[] = [];
  const callerChildrenRaw: ASTNode[] = node.children ?? [];

  for (const child of callerChildrenRaw) {
    if (!child) continue;
    // Check for slot= attribute on markup nodes
    const slotAttr = child.kind === "markup" && (child as MarkupNode).attrs
      ? ((child as MarkupNode).attrs ?? []).find((a: AttrNode) => a.name === "slot")
      : null;
    if (slotAttr && slotAttr.value && slotAttr.value.kind === "string-literal") {
      const slotName = slotAttr.value.value;
      // Validate: slot name must be a declared snippet prop
      if (def.snippetProps.size > 0 && !def.snippetProps.has(slotName)) {
        ceErrors.push(makeCEError(
          "E-COMPONENT-033",
          `E-COMPONENT-033: \`slot="${slotName}"\` does not target a snippet-typed prop on \`${componentName}\`. ` +
          `Declared snippet props: ${[...def.snippetProps.keys()].join(", ") || "(none)"}.`,
          child.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
      }
      // Validate: slot= on parametric snippet → error
      const snippetDecl = def.snippetProps.get(slotName);
      if (snippetDecl && snippetDecl.snippetParamType !== null) {
        ceErrors.push(makeCEError(
          "E-COMPONENT-034",
          `E-COMPONENT-034: \`slot="${slotName}"\` cannot be used on parametric snippet prop \`${slotName}\`. ` +
          `Parametric snippets require a lambda: \`${slotName}={ (param) => <markup/> }\`.`,
          child.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
      }
      // Strip slot= from the child's attrs (compile-time only)
      const strippedChild = {
        ...(child as MarkupNode),
        attrs: ((child as MarkupNode).attrs ?? []).filter((a: AttrNode) => a.name !== "slot"),
      } as ASTNode;
      if (!slottedGroups.has(slotName)) slottedGroups.set(slotName, []);
      slottedGroups.get(slotName)!.push(strippedChild);
    } else {
      unslottedChildren.push(child);
    }
  }

  // §16.6 Phase 1.6: Detect parametric snippet lambdas at call site
  // For each caller attr with kind "expr", check if it matches a parametric snippet prop
  const parametricSnippets = new Map<string, { paramName: string; body: string }>();
  const lambdaRe = /^\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*([\s\S]+)$/;

  if (def.snippetProps.size > 0) {
    for (const attr of callerAttrs) {
      if (!attr || !attr.name) continue;
      const snippetDecl = def.snippetProps.get(attr.name);
      if (!snippetDecl || snippetDecl.snippetParamType === null) continue;

      if (attr.value && (attr.value as Record<string, unknown>).kind === "expr") {
        const raw = (attr.value as Record<string, unknown>).raw as string;
        const match = raw.match(lambdaRe);
        if (match) {
          parametricSnippets.set(attr.name, { paramName: match[1], body: match[2].trim() });
        }
      }
    }
  }

  // Phase 2: typed props validation (§15.10)
  {
    const propsDecl = def.propsDecl;

    if (propsDecl && propsDecl.length > 0) {
      const declaredNames = new Set(propsDecl.map((p: PropDecl) => p.name));
      const callerPropNames = new Set(
        callerAttrs.filter((a: AttrNode) => a && a.name && a.name !== "class")
          // §15.11.1: strip bind: prefix so bind:propName matches prop named propName
          .map((a: AttrNode) => a.name.startsWith("bind:") ? a.name.slice(5) : a.name)
      );

      // E-COMPONENT-010: Missing required props (§14.9: snippet props fulfilled by slot= children or lambda)
      for (const decl of propsDecl) {
        if (!decl.optional && decl.default === null && !callerPropNames.has(decl.name)
            && !(decl.isSnippet && slottedGroups.has(decl.name))
            && !(decl.isSnippet && parametricSnippets.has(decl.name))) {
          ceErrors.push(makeCEError(
            "E-COMPONENT-010",
            `E-COMPONENT-010: Required prop \`${decl.name}\` (type: ${decl.type}) is missing ` +
            `at \`<${componentName}/>\` call site. ` +
            `Declare it as \`${decl.name}="value"\` on the call site.`,
            node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
      }

      // E-COMPONENT-011: Extra undeclared props
      // Note: bind:propName attrs use the base prop name for lookup (strip "bind:" prefix)
      for (const attr of callerAttrs) {
        if (!attr || !attr.name || attr.name === "class") continue;
        const effectiveName = attr.name.startsWith("bind:") ? attr.name.slice(5) : attr.name;
        if (!declaredNames.has(effectiveName)) {
          ceErrors.push(makeCEError(
            "E-COMPONENT-011",
            `E-COMPONENT-011: Prop \`${effectiveName}\` is not declared in \`${componentName}\`'s ` +
            `props block. Declared props: ${propsDecl.map((p: PropDecl) => p.name).join(", ")}.`,
            attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
      }

      // E-COMPONENT-012: Duplicate prop name in props block and bare attribute on def root
      const defNodeAttrs = (def.nodes[0].attrs ?? []).filter((a: AttrNode) => a && a.name !== "class");
      for (const defAttr of defNodeAttrs) {
        if (declaredNames.has(defAttr.name)) {
          ceErrors.push(makeCEError(
            "E-COMPONENT-012",
            `E-COMPONENT-012: Prop \`${defAttr.name}\` is declared in both the \`props\` block ` +
            `and as a bare attribute on \`${componentName}\`'s root element. ` +
            `Remove the duplicate — use the \`props\` block or the bare attribute, not both.`,
            defAttr.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
      }

      // §15.11.1: bind: call-site validation
      // For each bind:propName=@var attr, validate the prop is declared as bindable
      // and that the RHS is an @-prefixed reactive variable.
      for (const attr of callerAttrs) {
        if (!attr || !attr.name || !attr.name.startsWith("bind:")) continue;
        const propName = attr.name.slice(5); // "bind:visible" → "visible"
        const declaredProp = propsDecl.find((p: PropDecl) => p.name === propName);
        const attrSpan = attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

        if (declaredProp && !declaredProp.bindable) {
          // E-COMPONENT-013: prop exists but is not declared as bindable
          ceErrors.push(makeCEError(
            "E-COMPONENT-013",
            `E-COMPONENT-013: Prop \`${propName}\` on component \`${componentName}\` is not declared as bindable. ` +
            `Change the \`props\` block to \`bind ${propName}: type\` to allow two-way binding, ` +
            `or remove the \`bind:\` prefix and pass a value directly.`,
            attrSpan,
          ));
        }

        // E-ATTR-010 (component form): RHS must be @-prefixed reactive variable
        if (attr.value) {
          if (attr.value.kind === "variable-ref" && !attr.value.name.startsWith("@")) {
            ceErrors.push(makeCEError(
              "E-ATTR-010",
              `E-ATTR-010: \`${attr.name}\` requires a reactive \`@\` variable. ` +
              `\`${attr.value.name}\` is not reactive. ` +
              `Use \`@${attr.value.name}\` or remove the \`bind:\` prefix.`,
              attrSpan,
            ));
          } else if (attr.value.kind === "string-literal") {
            ceErrors.push(makeCEError(
              "E-ATTR-010",
              `E-ATTR-010: \`${attr.name}\` requires a reactive \`@\` variable. ` +
              `Got a string literal \`"${attr.value.value}"\` instead. ` +
              `Use an \`@\`-prefixed reactive variable, e.g. \`${attr.name}=@myVar\`.`,
              attrSpan,
            ));
          }
        }
      }

      // Apply defaults and null-fill for optional props not provided at call site
      for (const decl of propsDecl) {
        if (callerPropNames.has(decl.name)) continue; // caller provided it
        if (decl.default !== null) {
          props.set(decl.name, decl.default); // use declared default
        } else if (decl.optional) {
          props.set(decl.name, "null"); // optional with no default → null
        }
      }
    }
  }

  // F-COMPONENT-004: Build the typed-ExprNode form of each prop value for
  // logic-block substitution. The string-form `props` map is still used for
  // markup-text and string-literal-attr substitution.
  const propExprMap = buildPropExprMap(props, callerAttrs, def.propsDecl, filePath ?? (node.span?.file ?? ""), node.span ?? { file: filePath ?? "", start: 0, end: 0, line: 1, col: 1 });

  // Clone and substitute props into the definition's primary root node
  let expanded = substituteProps(defNode, props, propExprMap) as MarkupNode;

  // Merge class attribute:
  // Find the base class on the definition root element
  const defAttrs: AttrNode[] = defNode.attrs ?? [];
  const baseClassAttr = defAttrs.find((a: AttrNode) => a && a.name === "class");
  const baseClassValue = baseClassAttr && baseClassAttr.value && baseClassAttr.value.kind === "string-literal"
    ? baseClassAttr.value.value
    : null;

  const mergedClass = mergeClasses(baseClassValue, callerClassValue);

  // Merge caller attrs onto the expanded node:
  // - class: already handled via mergeClasses
  // - all other caller attrs override def attrs (caller wins for non-class conflicts)
  const callerNonClassAttrs = callerAttrs.filter((a: AttrNode) => a && a.name !== "class");
  const defNonClassAttrs = (expanded.attrs ?? []).filter((a: AttrNode) => a && a.name !== "class");

  // Build merged attrs: start with def attrs (non-class), then override with caller attrs
  const callerAttrNames = new Set(callerNonClassAttrs.map((a: AttrNode) => a.name));
  const mergedNonClassAttrs = [
    ...defNonClassAttrs.filter((a: AttrNode) => !callerAttrNames.has(a.name)),
    ...callerNonClassAttrs,
  ];

  // Reconstruct attrs with merged class first (if present)
  const newAttrs: AttrNode[] = [];
  if (mergedClass !== null) {
    newAttrs.push({
      name: "class",
      value: { kind: "string-literal", value: mergedClass, span: baseClassAttr?.span ?? node.span } as AttrValue,
      span: baseClassAttr?.span ?? node.span,
    });
  }
  newAttrs.push(...mergedNonClassAttrs);

  // Handle children: merge definition children + caller children
  // Use callerChildrenRaw (all caller children) for the overall injection,
  // plus slottedGroups/unslottedChildren from slot detection (Phase 1.5)
  const callerChildren: ASTNode[] = callerChildrenRaw;
  let finalChildren: ASTNode[] = expanded.children ?? [];

  // CE Phase 2: inject definition-body children (#{}, markup, logic siblings)
  const defChildren: ASTNode[] = (def.defChildren || []).map((dc: ASTNode) => {
    // Tag CSS blocks with component scope for @scope wrapping
    if (dc.kind === "css-inline" || dc.kind === "css") {
      return { ...dc, _componentScope: (node as MarkupNode).tag } as ASTNode;
    }
    return dc;
  });
  if (defChildren.length > 0) {
    finalChildren = [...defChildren, ...finalChildren];
  }

  if (callerChildren.length > 0 || slottedGroups.size > 0 || parametricSnippets.size > 0) {
    finalChildren = injectChildren(
      finalChildren, callerChildren,
      slottedGroups, unslottedChildren,
      ceErrors, componentName, filePath,
      node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      parametricSnippets,
    );
  }

  // §15.11.1: collect bind: prop wiring metadata for codegen
  // _bindProps: Array<{ propName: string, callerVar: string }>
  // propName is the component's prop name, callerVar is the @var name (without @)
  const _bindProps: Array<{ propName: string; callerVar: string }> = [];
  for (const attr of callerAttrs) {
    if (!attr || !attr.name || !attr.name.startsWith("bind:")) continue;
    const propName = attr.name.slice(5);
    if (attr.value && attr.value.kind === "variable-ref" && attr.value.name.startsWith("@")) {
      _bindProps.push({ propName, callerVar: attr.value.name.slice(1) }); // strip @
    }
  }

  // Resolve `if=` conditions that reference optional snippet props at compile time.
  // When an element has `if=(not (propName is not))` and the optional snippet prop
  // was not provided by the caller, remove the element. When provided, strip the if=.
  const _propsDecl = def.propsDecl ?? [];
  const optionalSnippetNames = new Set(
    (_propsDecl as PropDecl[]).filter((d: PropDecl) => d.isSnippet && d.optional).map((d: PropDecl) => d.name)
  );
  if (optionalSnippetNames.size > 0) {
    resolveSnippetIfConditions(finalChildren, optionalSnippetNames, slottedGroups, parametricSnippets);
  }

  // Assign a new ID to the primary expanded node
  const expandedNode = {
    ...expanded,
    id: ++counter.next,
    attrs: newAttrs,
    children: finalChildren,
    // Mark as expanded — no longer a component reference
    isComponent: false,
    _expandedFrom: componentName,
    ...(_bindProps.length > 0 ? { _bindProps } : {}),
  } as MarkupNode;

  // Expand secondary root nodes: prop substitution only, no attr/class/children merging
  const secondaryNodes: MarkupNode[] = extraDefNodes.map((extraNode: MarkupNode) => ({
    ...(substituteProps(extraNode, props, propExprMap) as MarkupNode),
    id: ++counter.next,
    isComponent: false,
    _expandedFrom: componentName,
  }));

  return [expandedNode, ...secondaryNodes];
}

/**
 * Inject caller children into the expanded component markup tree.
 *
 * A `${children}` slot is represented as a logic node with a bare-expr "children".
 * When found, it is replaced by the caller's children nodes.
 *
 * §14.9: `${...}` spread → unslotted children; `${render name()}` → slotted group.
 *
 * If no explicit slot is found, caller children are appended to the end of
 * the component's root element children.
 */
function injectChildren(
  expandedChildren: ASTNode[],
  callerChildren: ASTNode[],
  slottedGroups?: Map<string, ASTNode[]>,
  unslottedChildren?: ASTNode[],
  ceErrors?: CEError[],
  componentName?: string,
  filePath?: string,
  nodeSpan?: Span,
  parametricSnippets?: Map<string, { paramName: string; body: string }>,
): ASTNode[] {
  // Shared state across recursive calls — slots found in nested markup still count
  const state = { slotFound: false, spreadFound: false };
  return _injectChildrenWalk(expandedChildren, callerChildren, slottedGroups, unslottedChildren, ceErrors, componentName, filePath, nodeSpan, parametricSnippets, state);
}

function _injectChildrenWalk(
  expandedChildren: ASTNode[],
  callerChildren: ASTNode[],
  slottedGroups?: Map<string, ASTNode[]>,
  unslottedChildren?: ASTNode[],
  ceErrors?: CEError[],
  componentName?: string,
  filePath?: string,
  nodeSpan?: Span,
  parametricSnippets?: Map<string, { paramName: string; body: string }>,
  state: { slotFound: boolean; spreadFound: boolean } = { slotFound: false, spreadFound: false },
): ASTNode[] {
  const result: ASTNode[] = [];

  // Phase 4d Step 8: render name() / render name(expr) detection moved to ExprNode-only structural match (see __scrml_render_NAME__ unwrapping below).

  for (const child of expandedChildren) {
    if (!child) continue;
    // Detect a ${children} or ${...} or ${render name()} slot
    if (child.kind === "logic") {
      const logicChild = child as LogicNode;

      // Check each body node for special bare-expr patterns
      // Phase 4d Step 8: ExprNode-only ident matching (bare-expr.expr deleted)
      const isChildrenSlot = Array.isArray(logicChild.body) && logicChild.body.some(
        (n: unknown) => {
          const node = n as Record<string, unknown>;
          if (!node || node.kind !== "bare-expr") return false;
          // ExprNode path: skip escape-hatch (cannot represent identifier match)
          if (node.exprNode && (node.exprNode as any).kind !== "escape-hatch") return exprNodeMatchesIdent(node.exprNode as ExprNode, "children");
          return false;
        }
      );

      // §14.9: ${...} spread — substitute with unslotted children
      // The `...` token is not valid JS; ast-builder emits it as an escape-hatch
      // ExprNode with raw === "...".
      const isSpreadSlot = Array.isArray(logicChild.body) && logicChild.body.some(
        (n: unknown) => {
          const node = n as Record<string, unknown>;
          if (!node || node.kind !== "bare-expr") return false;
          const en = node.exprNode as Record<string, unknown> | undefined;
          if (!en) return false;
          if (en.kind === "escape-hatch" && typeof en.raw === "string" && (en.raw as string).trim() === "...") return true;
          if (en.kind !== "escape-hatch") return exprNodeMatchesIdent(en as ExprNode, "...");
          return false;
        }
      );

      // §14.9: ${render name()} — substitute with slotted group
      // §16.6: ${render name(expr)} — parametric snippet substitution
      // Phase 4d Step 8: ExprNode-only structural matching (bare-expr.expr deleted).
      // The expression preprocessor (S39 1e304c8) rewrites `render name(...)` to
      // `__scrml_render_name__(...)` so the ExprNode parser can represent it as a
      // call node. We unwrap that here to detect render-slot patterns.
      let renderMatch: string | null = null;
      let renderParamMatch: { name: string; argExpr: string } | null = null;
      if (Array.isArray(logicChild.body)) {
        for (const n of logicChild.body) {
          if (renderMatch || renderParamMatch) break;
          const node = n as Record<string, unknown>;
          if (!node || node.kind !== "bare-expr") continue;
          if (!node.exprNode) continue;
          const en = node.exprNode as ExprNode;
          if (en.kind !== "call") continue;
          const callee = (en as any).callee;
          if (!callee || callee.kind !== "ident") continue;
          const calleeName = callee.name as string;
          const nameM = calleeName.match(/^__scrml_render_([A-Za-z_$][A-Za-z0-9_$]*)__$/);
          if (!nameM) continue;
          const args = ((en as any).args ?? []) as ExprNode[];
          if (args.length === 0) {
            renderMatch = nameM[1];
          } else {
            const argExpr = emitStringFromTree(args[0]).trim();
            renderParamMatch = { name: nameM[1], argExpr };
          }
        }
      }

      if (isChildrenSlot) {
        // Replace the slot with the caller's children (backward compat)
        if (state.spreadFound) {
          // E-COMPONENT-030: multiple spreads
          if (ceErrors) {
            ceErrors.push(makeCEError(
              "E-COMPONENT-030",
              `E-COMPONENT-030: Component \`${componentName}\` has multiple \`\${children}\`/\`\${...}\` spreads. ` +
              `Only one spread is allowed per component body.`,
              nodeSpan ?? { file: filePath ?? "", start: 0, end: 0, line: 1, col: 1 },
            ));
          }
        }
        const childrenToInject = unslottedChildren && unslottedChildren.length > 0
          ? unslottedChildren : callerChildren;
        result.push(...childrenToInject);
        state.slotFound = true;
        state.spreadFound = true;
        continue;
      }

      if (isSpreadSlot) {
        // §14.9: ${...} spread → unslotted children
        if (state.spreadFound) {
          if (ceErrors) {
            ceErrors.push(makeCEError(
              "E-COMPONENT-030",
              `E-COMPONENT-030: Component \`${componentName}\` has multiple \`\${children}\`/\`\${...}\` spreads. ` +
              `Only one spread is allowed per component body.`,
              nodeSpan ?? { file: filePath ?? "", start: 0, end: 0, line: 1, col: 1 },
            ));
          }
        }
        const childrenToInject = unslottedChildren && unslottedChildren.length > 0
          ? unslottedChildren : callerChildren;
        result.push(...childrenToInject);
        state.slotFound = true;
        state.spreadFound = true;
        continue;
      }

      if (renderMatch && slottedGroups) {
        // §14.9: ${render name()} → substitute slotted group
        const slotNodes = slottedGroups.get(renderMatch);
        if (slotNodes && slotNodes.length > 0) {
          result.push(...slotNodes);
        }
        state.slotFound = true;
        continue;
      }

      if (renderParamMatch && parametricSnippets) {
        // §16.6: ${render name(expr)} → substitute parametric snippet lambda body
        const snippet = parametricSnippets.get(renderParamMatch.name);
        if (snippet) {
          // Replace all occurrences of paramName with argExpr in the lambda body.
          // Function-form .replace() so any `$` chars in argExpr aren't interpreted
          // as `$&` / `$N` backreferences (S100 `01eeda9` bug class — argExpr is
          // user-authored scrml expression text).
          const paramRe = new RegExp(`\\b${snippet.paramName}\\b`, "g");
          const substituted = snippet.body.replace(paramRe, () => renderParamMatch.argExpr);
          // Emit as a bare-expr logic node containing the substituted markup
          result.push({
            kind: "logic",
            body: [{ kind: "bare-expr", expr: substituted, span: child.span }],
            span: child.span,
          } as unknown as ASTNode);
        }
        state.slotFound = true;
        continue;
      }
    }
    // Recurse into markup children to find nested render slots
    // (e.g. <div class="card__header">${render header()}</>)
    if (child.kind === "markup" && Array.isArray((child as MarkupNode).children) && (child as MarkupNode).children!.length > 0) {
      const recursed = _injectChildrenWalk(
        (child as MarkupNode).children!, callerChildren,
        slottedGroups, unslottedChildren,
        ceErrors, componentName, filePath, nodeSpan,
        parametricSnippets, state,
      );
      result.push({ ...child, children: recursed } as ASTNode);
    } else {
      result.push(child);
    }
  }

  if (!state.slotFound && callerChildren.length > 0) {
    // No explicit slot found — append caller children at the end
    result.push(...callerChildren);
  }

  // §14.9: E-COMPONENT-031 — unslotted children but no spread slot.
  // Whitespace-only text nodes (value matches /^\s*$/) are source-format
  // niceties — newlines / indent between slotted children — and do not count
  // as adopter-authored unslotted content for this check. A node like
  // "  hello  " (whitespace surrounding real text) STILL counts.
  // (S94 BSBv3 — fix surfaced by BS-batch v2 sibling-friction note.)
  const hasNonWhitespaceUnslottedChild = unslottedChildren && unslottedChildren.some((c) => {
    if (!c) return false;
    if (c.kind === "text") return !/^\s*$/.test(((c as TextNode).value) ?? "");
    return true;
  });
  if (hasNonWhitespaceUnslottedChild && !state.spreadFound && slottedGroups && slottedGroups.size > 0) {
    if (ceErrors) {
      ceErrors.push(makeCEError(
        "E-COMPONENT-031",
        `E-COMPONENT-031: Component \`${componentName}\` received unslotted children but has no ` +
        `\`\${...}\` or \`\${children}\` spread in its body. Add a spread or assign children to slots.`,
        nodeSpan ?? { file: filePath ?? "", start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// AST walk and expansion
// ---------------------------------------------------------------------------

/**
 * Recursively walk an array of AST nodes and expand component references.
 *
 * Returns a new array with component nodes replaced by their expansions.
 * Multi-root components produce multiple sibling nodes spread into the result.
 * Mutates nothing — the result is a new array (though subtrees that don't
 * need expansion are reused by reference for efficiency).
 */
function walkAndExpand(
  nodes: ASTNode[],
  registry: Map<string, RegistryEntry>,
  filePath: string,
  counter: NodeCounter,
  ceErrors: CEError[]
): ASTNode[] {
  const result: ASTNode[] = [];

  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      result.push(node);
      continue;
    }

    // Skip component-def nodes — they are consumed here
    if (node.kind === "component-def") {
      continue;
    }

    // Expand component reference nodes
    // P3-FOLLOW: route via isUserComponentMarkup() — NR-authoritative when
    // resolvedKind is set, falls back to legacy isComponent when NR was bypassed.
    if (isUserComponentMarkup(node)) {
      const expandedNodes = expandComponentNode(node as MarkupNode, registry, filePath, counter, ceErrors);
      // For each expanded node: if expansion succeeded the synthesized HTML is no
      // longer a user-component reference. The post-CE invariant (VP-2) catches
      // any residual user-component nodes.
      for (const expanded of expandedNodes) {
        if (expanded && expanded !== node && !isUserComponentMarkup(expanded)) {
          const expandedChildren = walkAndExpand(
            expanded.children ?? [],
            registry, filePath, counter, ceErrors
          );
          result.push({ ...expanded, children: expandedChildren });
        } else {
          result.push(expanded);
        }
      }
      continue;
    }

    // For markup nodes (non-component): recurse into children
    if (node.kind === "markup" || node.kind === "state") {
      const n = node as MarkupNode;
      const newChildren = walkAndExpand(n.children ?? [], registry, filePath, counter, ceErrors);
      // Only create a new object if children changed
      const changed = newChildren.length !== (n.children ?? []).length ||
        newChildren.some((c, i) => c !== (n.children ?? [])[i]);
      if (changed) {
        result.push({ ...node, children: newChildren } as ASTNode);
      } else {
        result.push(node);
      }
      continue;
    }

    // For logic blocks: recurse into body (may contain lift expressions with markup)
    if (node.kind === "logic") {
      const logicNode = node as LogicNode;
      const newBody = walkLogicBody(logicNode.body ?? [], registry, filePath, counter, ceErrors);
      const changed = newBody.length !== (logicNode.body ?? []).length ||
        newBody.some((c, i) => c !== (logicNode.body ?? [])[i]);
      if (changed) {
        result.push({ ...node, body: newBody } as ASTNode);
      } else {
        result.push(node);
      }
      continue;
    }

    // §17.1.1 if-chain (TAB-collapsed): {kind:"if-chain", branches:[{condition, element}], elseBranch}
    // Component refs inside branches must be expanded — same shape as Bug 6 silent-drop:
    // pre-fix, the walker fell through to the "pass through unchanged" tail and left
    // `<MyComponent if=...>` as a literal user-component markup node, which downstream
    // emit-html rendered as `<MyComponent />` text. Bug 2a / S87 Trio B fix.
    if (node.kind === "if-chain") {
      const ifChainNode = node as unknown as {
        kind: "if-chain";
        branches?: Array<{ condition: unknown; element: ASTNode }>;
        elseBranch?: ASTNode | null;
        [k: string]: unknown;
      };
      let chainChanged = false;
      const newBranches = (ifChainNode.branches ?? []).map((branch) => {
        const expandedElement = walkAndExpandSingleMarkup(
          branch.element, registry, filePath, counter, ceErrors
        );
        if (expandedElement !== branch.element) {
          chainChanged = true;
          return { ...branch, element: expandedElement };
        }
        return branch;
      });
      let newElseBranch = ifChainNode.elseBranch ?? null;
      if (newElseBranch) {
        const expandedElse = walkAndExpandSingleMarkup(
          newElseBranch, registry, filePath, counter, ceErrors
        );
        if (expandedElse !== newElseBranch) {
          chainChanged = true;
          newElseBranch = expandedElse;
        }
      }
      if (chainChanged) {
        result.push({ ...ifChainNode, branches: newBranches, elseBranch: newElseBranch } as unknown as ASTNode);
      } else {
        result.push(node);
      }
      continue;
    }

    // All other node kinds: pass through unchanged
    result.push(node);
  }

  return result;
}

/**
 * Expand a single markup node in a slot that requires single-node output
 * (e.g. an if-chain branch's `element`). When the node is a user-component
 * reference, expand it via `expandComponentNode` and take the first root
 * (multi-root expansion in this slot is an edge case — first-root-only
 * mirrors the lift-expr branch in walkLogicBody, see line ~2199).
 * When the node is a regular markup wrapper, recurse into its children
 * via walkAndExpand.
 */
function walkAndExpandSingleMarkup(
  node: ASTNode,
  registry: Map<string, RegistryEntry>,
  filePath: string,
  counter: NodeCounter,
  ceErrors: CEError[]
): ASTNode {
  if (!node || typeof node !== "object") return node;

  if (isUserComponentMarkup(node)) {
    const expandedNodes = expandComponentNode(node as MarkupNode, registry, filePath, counter, ceErrors);
    const expanded = expandedNodes[0];
    if (!expanded || expanded === node) return node;
    if (!isUserComponentMarkup(expanded)) {
      // Recurse into the expanded body so any nested component refs get expanded too.
      const expandedChildren = walkAndExpand(
        (expanded as MarkupNode).children ?? [],
        registry, filePath, counter, ceErrors
      );
      return { ...(expanded as MarkupNode), children: expandedChildren } as ASTNode;
    }
    return expanded;
  }

  if (node.kind === "markup" || node.kind === "state") {
    const m = node as MarkupNode;
    const newChildren = walkAndExpand(m.children ?? [], registry, filePath, counter, ceErrors);
    const changed = newChildren.length !== (m.children ?? []).length ||
      newChildren.some((c, i) => c !== (m.children ?? [])[i]);
    if (changed) return { ...m, children: newChildren } as ASTNode;
    return node;
  }

  // Other shapes (nested if-chain, etc.): defer to walkAndExpand by wrapping
  // in a single-element array. Returns the first (and only) result.
  const wrapped = walkAndExpand([node], registry, filePath, counter, ceErrors);
  return wrapped[0] ?? node;
}

/**
 * Walk a LogicNode[] body and expand any component references found in
 * lift expressions or nested markup nodes.
 */
/**
 * Resolve `if=` conditions on component body elements that reference snippet props.
 *
 * When a snippet prop was NOT provided by the caller, the `if=` condition is statically
 * false — remove the element entirely. When provided, strip the `if=` attribute
 * (the condition is statically true).
 *
 * Mutates the children array in place by splicing out elements with unmet conditions.
 */
function resolveSnippetIfConditions(
  children: MarkupNode[],
  snippetPropNames: Set<string>,
  slottedGroups: Map<string, MarkupNode[]>,
  parametricSnippets: Map<string, unknown>,
): void {
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (!child || child.kind !== "markup") continue;

    const attrs = child.attributes ?? child.attrs ?? [];
    const ifAttrIdx = attrs.findIndex((a: any) => a && a.name === "if");
    if (ifAttrIdx >= 0) {
      const ifAttr = attrs[ifAttrIdx];
      const ifVal = ifAttr.value;
      // Check if the `if=` value references a snippet prop name
      const raw = typeof ifVal === "string" ? ifVal
        : ifVal?.raw ?? ifVal?.value ?? "";
      // Match patterns like `not (actions is not)`, `actions is some`, or just `actions`
      for (const propName of snippetPropNames) {
        // Use word boundary check to avoid false matches on substrings
        const propRegex = new RegExp(`\\b${propName}\\b`);
        if (propRegex.test(raw)) {
          const isProvided = slottedGroups.has(propName) || parametricSnippets.has(propName);
          // Determine if the condition tests for presence or absence
          const isPresenceCheck = raw.includes("is some") || raw.includes("is given")
            || raw.includes("not") // `not (x is not)` = presence check
            || (!raw.includes("is not") && raw.trim() === propName); // bare propName
          const conditionMet = isPresenceCheck ? isProvided : !isProvided;
          if (conditionMet) {
            // Strip the if= attribute — condition is statically true
            attrs.splice(ifAttrIdx, 1);
          } else {
            // Remove the element — condition is statically false
            children.splice(i, 1);
          }
          break;
        }
      }
    }

    // Recurse into child markup
    if (child.children) {
      resolveSnippetIfConditions(child.children, snippetPropNames, slottedGroups, parametricSnippets);
    }
  }
}

function walkLogicBody(
  bodyNodes: unknown[],
  registry: Map<string, RegistryEntry>,
  filePath: string,
  counter: NodeCounter,
  ceErrors: CEError[]
): unknown[] {
  const result: unknown[] = [];
  let changed = false;

  for (const node of bodyNodes) {
    if (!node || typeof node !== "object") {
      result.push(node);
      continue;
    }

    const n = node as Record<string, unknown>;

    // Skip component-def nodes — they are consumed by CE
    if (n.kind === "component-def") {
      changed = true;
      continue;
    }

    if (n.kind === "lift-expr" && n.expr && typeof n.expr === "object") {
      const expr = n.expr as Record<string, unknown>;
      if (expr.kind === "markup") {
        const liftMarkup = expr.node as MarkupNode;
        // P3-FOLLOW: route via isUserComponentMarkup().
        if (liftMarkup && liftMarkup.kind === "markup" && isUserComponentMarkup(liftMarkup)) {
          const expandedNodes = expandComponentNode(liftMarkup, registry, filePath, counter, ceErrors);
          // For lift-expr: take the first expanded node (Phase 2 for full multi-root lift)
          const expanded = expandedNodes[0];
          if (expanded && expanded !== liftMarkup) {
            // S95 Bug 5a: recurse into the expanded body's children so any
            // nested user-component references (e.g. Column's body contains
            // `lift <TaskCard .../>`) get expanded too. Pre-fix, the
            // expansion was wrapped into the new lift node without descending
            // into its body — the inner TaskCard ref survived to codegen as
            // `document.createElement("TaskCard")` (phantom DOM). Mirrors the
            // walkAndExpand non-lift path at line ~2150 and the wrapper-element
            // path at line ~2389 below.
            //
            // parseComponentBody (used to materialise the component's stored
            // body) re-parses via BS+TAB only — no NR pass — so nested refs
            // inside the parsed body have isComponent:true but no
            // resolvedKind. isUserComponentMarkup's legacy fallback at
            // line 212 (resolvedKind==null && isComponent===true) is what
            // makes the nested expansion succeed.
            let finalExpanded: MarkupNode = expanded;
            if (!isUserComponentMarkup(expanded)) {
              const expandedChildren = walkAndExpand(
                (expanded as MarkupNode).children ?? [],
                registry, filePath, counter, ceErrors,
              );
              finalExpanded = { ...(expanded as MarkupNode), children: expandedChildren } as MarkupNode;
            }
            const newNode = { ...n, expr: { kind: "markup", node: finalExpanded } };
            result.push(newNode);
            changed = true;
            continue;
          }
        } else if (liftMarkup && liftMarkup.kind === "markup") {
          // F1 (W2): the lift target is a wrapper element (e.g. <li>) — walk
          // its subtree so any nested component references inside the wrapper
          // get expanded. Pre-W2 the wrapper case fell through with the
          // residual user-component child intact, then surfaced as
          // VP-2 E-COMPONENT-035 post-W1 (silent phantom DOM pre-W1).
          const newChildren = walkAndExpand(
            liftMarkup.children ?? [],
            registry, filePath, counter, ceErrors
          );
          const childrenChanged = newChildren.length !== (liftMarkup.children ?? []).length ||
            newChildren.some((c, i) => c !== (liftMarkup.children ?? [])[i]);
          if (childrenChanged) {
            const newLiftMarkup = { ...liftMarkup, children: newChildren };
            const newNode = { ...n, expr: { kind: "markup", node: newLiftMarkup } };
            result.push(newNode);
            changed = true;
            continue;
          }
        }
      }
      // When lift target is a raw string expression (tags inside logic blocks are
      // not block-separated), check if it starts with a component tag name and
      // re-parse through BS+TAB to get a structured markup node for expansion.
      if (expr.kind === "expr" && typeof expr.expr === "string") {
        const rawExpr = (expr.expr as string).trim();
        const tagMatch = rawExpr.match(/^<\s*([A-Z][A-Za-z0-9_]*)/);
        if (tagMatch && registry.has(tagMatch[1])) {
          // Check if this is a bare component reference (just `< Name >` with no children).
          // For bare refs, construct a minimal markup node directly without re-parsing.
          const isBareRef = /^<\s*[A-Z][A-Za-z0-9_]*\s*>?\s*$/.test(rawExpr);
          if (isBareRef) {
            // P3-FOLLOW: stamp NR-authoritative routing fields alongside the
            // legacy isComponent boolean (kept for AST shape backcompat).
            const bareMarkup = {
              kind: "markup" as const,
              tag: tagMatch[1],
              isComponent: true,
              resolvedKind: "user-component" as const,
              resolvedCategory: "user-component" as const,
              attributes: [],
              children: [],
              id: ++counter.next,
            } as unknown as MarkupNode;
            const expandedNodes = expandComponentNode(bareMarkup, registry, filePath, counter, ceErrors);
            const expanded = expandedNodes[0];
            if (expanded && expanded !== bareMarkup) {
              // S95 Bug 5a: recurse into expanded body so nested refs expand.
              let finalExpanded: MarkupNode = expanded;
              if (!isUserComponentMarkup(expanded)) {
                const expandedChildren = walkAndExpand(
                  (expanded as MarkupNode).children ?? [],
                  registry, filePath, counter, ceErrors,
                );
                finalExpanded = { ...(expanded as MarkupNode), children: expandedChildren } as MarkupNode;
              }
              const newNode = { ...n, expr: { kind: "markup", node: finalExpanded } };
              result.push(newNode);
              changed = true;
              continue;
            }
          }
          try {
            // Normalize tokenizer-spaced markup back to compact form for re-parse.
            // The tokenizer inserts spaces around < > / = which prevents the BS
            // from recognizing tags.
            const normalized = rawExpr
              .replace(/< \/ >/g, "</>")
              .replace(/< \/\s*([A-Za-z][A-Za-z0-9]*)\s*>/g, "</$1>")
              .replace(/<\s+([A-Za-z][A-Za-z0-9_]*)/g, "<$1")
              .replace(/\s*=\s*"/g, '="')
              .replace(/"\s*>/g, '">')
              .replace(/\s*\/\s*>/g, "/>")
              .replace(/([^"=])\s*>/g, "$1>");
            const bsResult = splitBlocks(filePath, normalized);
            const tabResult = buildAST(bsResult, null);
            const reparsedNodes = tabResult?.ast?.nodes ?? [];
            // Find the first markup node that is a component reference.
            // P3-FOLLOW note: this re-parse path runs on a freshly-constructed
            // mini-AST (BS+TAB only — no NR), so resolvedKind is not yet stamped.
            // The legacy isComponent boolean is BS's syntactic uppercase-first-char
            // predicate, which is exactly what we need on a raw-string re-parse.
            // isUserComponentMarkup() falls back to isComponent in this case, so
            // it's safe to use here too — but the direct read is clearer about
            // intent (this is a syntactic check, not a routing decision).
            const markupNode = reparsedNodes.find(
              (rn: MarkupNode) => rn && rn.kind === "markup" && rn.isComponent === true
            ) as MarkupNode | undefined;
            if (markupNode) {
              const expandedNodes = expandComponentNode(markupNode, registry, filePath, counter, ceErrors);
              const expanded = expandedNodes[0];
              if (expanded && expanded !== markupNode) {
                // S95 Bug 5a: recurse into expanded body so nested refs expand.
                let finalExpanded: MarkupNode = expanded;
                if (!isUserComponentMarkup(expanded)) {
                  const expandedChildren = walkAndExpand(
                    (expanded as MarkupNode).children ?? [],
                    registry, filePath, counter, ceErrors,
                  );
                  finalExpanded = { ...(expanded as MarkupNode), children: expandedChildren } as MarkupNode;
                }
                const newNode = { ...n, expr: { kind: "markup", node: finalExpanded } };
                result.push(newNode);
                changed = true;
                continue;
              }
            }
          } catch {
            // Re-parse failed — fall through to unmodified node
          }
        }
      }
    }

    // Recurse into nested bodies (for-stmt, if-stmt, etc.)
    let nodeChanged = false;
    const newNode = { ...n };
    for (const key of ["body", "consequent", "alternate"]) {
      if (Array.isArray(n[key])) {
        const newBody = walkLogicBody(n[key] as unknown[], registry, filePath, counter, ceErrors);
        if (newBody !== n[key]) {
          newNode[key] = newBody;
          nodeChanged = true;
        }
      }
    }
    result.push(nodeChanged ? newNode : node);
    if (nodeChanged) changed = true;
  }

  return changed ? result : bodyNodes;
}

// ---------------------------------------------------------------------------
// Component reference scanner
// ---------------------------------------------------------------------------

/**
 * Check whether any node in an AST node array is a user-component reference (NR-authoritative).
 * Used to skip CE processing on files with no component references.
 */
function hasAnyComponentRefs(nodes: ASTNode[]): boolean {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    // P3-FOLLOW: route via isUserComponentMarkup().
    if (isUserComponentMarkup(node)) return true;
    if ((node.kind === "markup" || node.kind === "state") && Array.isArray((node as MarkupNode).children)) {
      if (hasAnyComponentRefs((node as MarkupNode).children ?? [])) return true;
    }
    if (node.kind === "logic" && Array.isArray((node as LogicNode).body)) {
      if (hasAnyComponentRefsInLogic((node as LogicNode).body ?? [])) return true;
    }
    // §17.1.1 if-chain: descend into branches[].element + elseBranch (Bug 2a fix).
    if (node.kind === "if-chain") {
      const ifc = node as unknown as {
        branches?: Array<{ element?: ASTNode }>;
        elseBranch?: ASTNode | null;
      };
      for (const b of ifc.branches ?? []) {
        if (b && b.element && hasAnyComponentRefs([b.element])) return true;
      }
      if (ifc.elseBranch && hasAnyComponentRefs([ifc.elseBranch])) return true;
    }
  }
  return false;
}

/**
 * Recursively walk a markup-shaped node tree, returning true when any
 * descendant is a user-component (`resolvedKind === "user-component"`). Used by hasAnyComponentRefsInLogic to
 * descend into the lift target subtree (W2 F1 fix).
 */
function markupTreeHasComponentRef(markupNode: unknown): boolean {
  if (!markupNode || typeof markupNode !== "object") return false;
  const m = markupNode as Record<string, unknown>;
  // P3-FOLLOW: route via isUserComponentMarkup().
  if (isUserComponentMarkup(m)) return true;
  // §17.1.1 if-chain: descend into branches[].element + elseBranch (Bug 2a fix).
  if (m.kind === "if-chain") {
    const branches = m.branches as Array<{ element?: unknown }> | undefined;
    for (const b of branches ?? []) {
      if (b && b.element && markupTreeHasComponentRef(b.element)) return true;
    }
    if (m.elseBranch && markupTreeHasComponentRef(m.elseBranch)) return true;
    return false;
  }
  if (Array.isArray(m.children)) {
    for (const child of m.children as unknown[]) {
      if (!child || typeof child !== "object") continue;
      const c = child as Record<string, unknown>;
      if (c.kind === "markup" || c.kind === "state") {
        if (markupTreeHasComponentRef(child)) return true;
      } else if (c.kind === "if-chain") {
        if (markupTreeHasComponentRef(child)) return true;
      } else if (c.kind === "logic" && Array.isArray(c.body)) {
        if (hasAnyComponentRefsInLogic(c.body as unknown[])) return true;
      }
    }
  }
  return false;
}

/**
 * Check whether any logic body node tree contains a component reference.
 *
 * F1 fix (W2): the lift-expr branch must recurse into the entire markup
 * subtree of the lift target — not just check the immediate liftMarkup.
 * Otherwise wrapped patterns (e.g. `lift <li><Comp/></li>`) silently skip
 * CE because the lift target is `<li>` (not a component) but the nested
 * `<Comp/>` IS a component reference. Pre-W2 this surfaced as silent
 * phantom DOM emission (`document.createElement("Comp")`); post-W1 it
 * surfaces as E-COMPONENT-035 from VP-2; post-W2 the gate fires and CE
 * expands the cross-file component correctly.
 */
function hasAnyComponentRefsInLogic(bodyNodes: unknown[]): boolean {
  for (const node of bodyNodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    if (n.kind === "lift-expr" && n.expr && typeof n.expr === "object") {
      const expr = n.expr as Record<string, unknown>;
      if (expr.kind === "markup") {
        // F1: walk the entire markup subtree, not just the root node
        if (markupTreeHasComponentRef(expr.node)) return true;
      }
    }
    // component-def bodies live inside logic blocks; walk their nodes
    if (n.kind === "component-def" && Array.isArray(n.nodes)) {
      // Component DEFINITIONS are consumed by CE — they aren't refs themselves.
      // We do NOT need to recurse here because the registry build pass
      // independently picks them up. Left as a no-op for clarity.
    }
    for (const key of ["body", "consequent", "alternate"]) {
      if (Array.isArray(n[key])) {
        if (hasAnyComponentRefsInLogic(n[key] as unknown[])) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public entry point — per-file
// ---------------------------------------------------------------------------

/**
 * Resolve `imp.source` to its canonical lookup key.
 *
 * When `importGraph` is provided (production path post-W2), the lookup uses
 * `entry.absSource` — the absolute filesystem path produced by
 * `module-resolver.buildImportGraph`. This is the same key used by
 * `fileASTMap` and `exportRegistry` in production.
 *
 * When `importGraph` is NOT provided (unit tests that synthesize their own
 * fixtures with arbitrary string keys), the function falls back to the raw
 * `imp.source` so legacy fixtures continue to work. See SPEC §15.14.4
 * for the production-keying invariant.
 */
function lookupKey(
  filePath: string,
  imp: ImportDeclNode,
  importGraph?: ImportGraph
): string {
  if (importGraph) {
    const node = importGraph.get(filePath);
    if (node && Array.isArray(node.imports)) {
      const entry = node.imports.find(
        (e) => e.source === imp.source
      );
      if (entry && entry.absSource) return entry.absSource;
    }
  }
  // Fallback: raw source string (legacy / synthetic-fixture path)
  return imp.source as string;
}

/**
 * Run CE on a single TAB output record.
 *
 * `importGraph` (W2): when present, cross-file lookups resolve `imp.source`
 * to its absolute path via `module-resolver.buildImportGraph` output; the
 * same key is then used to index `exportRegistry` and `fileASTMap`. This
 * matches the canonical-key contract from SPEC §15.14.4 + §21.7 and mirrors
 * the TS-pass pattern at `api.js:626-660`.
 */
export function runCEFile(
  tabOutput: CEFileInput,
  exportRegistry?: ExportRegistry,
  fileASTMap?: FileASTMap,
  importGraph?: ImportGraph
): CEFileOutput {
  const { filePath, ast, errors: _tabErrors } = tabOutput;

  const ceErrors: CEError[] = [];

  // If AST is absent, pass through unchanged
  if (!ast) {
    return { filePath, ast, errors: ceErrors };
  }

  // Build the component registry from ast.components (same-file)
  const componentDefs = (ast.components ?? []) as ExtendedComponentDefNode[];

  // Phase 2: also check for imported component references
  const hasComponentDefs = componentDefs.length > 0;
  const hasComponentRefs = hasAnyComponentRefs(ast.nodes ?? []);
  const hasImportedComponents = exportRegistry && fileASTMap &&
    (ast.imports ?? []).some((imp: ImportDeclNode) => {
      const importExt = imp as ImportWithSpecifiers;
      const key = lookupKey(filePath, imp, importGraph);
      const targetExports = exportRegistry.get(key);
      if (!targetExports) return false;
      // Normalize: AST imports use imp.names (string[]), but some paths may use
      // imp.specifiers ({imported, local}[]). Handle both shapes.
      const names = importExt.specifiers ? importExt.specifiers.map((s) => s.imported) : (imp.names ?? []);
      return names.some((name: string) => {
        const info = targetExports.get(name);
        // P3-FOLLOW: prefer info.category (NR-authoritative); fall back to
        // info.isComponent for backwards compatibility with older registry
        // entries that haven't been re-stamped with category.
        if (info && info.category === "user-component") return true;
        if (info && info.category == null && info.isComponent === true) return true;
        return false;
      });
    });

  // P3.A: also short-circuit-skip if there are no channel imports.
  const hasImportedChannels = exportRegistry && fileASTMap &&
    (ast.imports ?? []).some((imp: ImportDeclNode) => {
      const importExt = imp as ImportWithSpecifiers;
      const key = lookupKey(filePath, imp, importGraph);
      const targetExports = exportRegistry.get(key);
      if (!targetExports) return false;
      const names = importExt.specifiers ? importExt.specifiers.map((s) => s.imported) : (imp.names ?? []);
      return names.some((name: string) => {
        const info = targetExports.get(name);
        return !!(info && info.category === "channel");
      });
    });

  if (!hasComponentDefs && !hasComponentRefs && !hasImportedComponents && !hasImportedChannels) {
    return { filePath, ast, errors: ceErrors };
  }

  const registry = buildComponentRegistry(componentDefs, filePath, ceErrors);

  // Phase 2: add imported components to the registry from cross-file sources
  //
  // The exporting file's component-def can live in one of two shapes (W2):
  //   (a) Same-file form — `${ const Name = <markup/> }` — TAB classifies as
  //       `component-def` and stores in `ast.components`.
  //   (b) Cross-file export form — `${ export const Name = <markup/> }` — TAB
  //       classifies as `export-decl` only; the markup body lives inside the
  //       export-decl `raw` string (e.g. `"export const Name = < markup / >"`).
  //       `ast.components` is EMPTY for this file because the component-def
  //       classifier in collectComponents (ast-builder) doesn't peer into
  //       export-decls.
  //
  // Pre-W2, CE only checked (a). The unit-test fixtures in
  // `tests/unit/cross-file-components.test.js` synthesized `ast.components`
  // entries directly, masking this gap (the M17 meta-pattern). Production
  // exports landed in (b), CE found nothing in `ast.components`, and the
  // lookup silently failed — surfaced post-W1 as VP-2 E-COMPONENT-035.
  //
  // W2 fix: scan BOTH `ast.components` (path a) AND `ast.exports` (path b).
  // For path-b matches, synthesize an ExtendedComponentDefNode by stripping
  // the `export const NAME =` prefix from the export-decl raw to recover the
  // markup body.
  //
  // A6 fix (F4-residual from W2 commit 6536f7a): TRANSITIVE enrichment. When
  // a consumer imports component X from file F, X's body may reference
  // component Y imported by F. After W2 landed F-COMPONENT-001 internal-
  // PascalCase parsing (commit 2c687b5), X's body now expands correctly — but
  // the inner `<Y/>` markup then misses the consumer's CE registry, firing
  // E-COMPONENT-020. Fix: walk the import closure eagerly via a worklist,
  // seeded with the consumer's direct component imports, expanding to include
  // each imported file's own user-component imports. Each (sourceKey, name)
  // is visited at most once; over-inclusion is harmless (registry lookups
  // are by-name).
  if (exportRegistry && fileASTMap) {
    type WorkItem = { sourceKey: string; importedName: string; localName: string; rawSource: string };
    const seen = new Set<string>();
    const work: WorkItem[] = [];

    // Seed worklist from the consumer file's direct imports.
    for (const imp of (ast.imports ?? [])) {
      const importExt = imp as ImportWithSpecifiers;
      const key = lookupKey(filePath, imp, importGraph);
      const targetExports = exportRegistry.get(key);
      if (!targetExports) continue;
      const pairs = importExt.specifiers
        ? importExt.specifiers.map((s) => ({ imported: s.imported, local: s.local || s.imported }))
        : (imp.names ?? []).map((n: string) => ({ imported: n, local: n }));
      for (const { imported, local } of pairs) {
        const info = targetExports.get(imported);
        if (!info) continue;
        const isUserComponent =
          info.category === "user-component" ||
          (info.category == null && info.isComponent === true);
        if (!isUserComponent) continue;
        work.push({ sourceKey: key, importedName: imported, localName: local, rawSource: imp.source as string });
      }
    }

    while (work.length > 0) {
      const { sourceKey, importedName, localName, rawSource } = work.shift()!;
      const seenKey = `${sourceKey}::${localName}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const targetTab = fileASTMap.get(sourceKey);
      if (!targetTab || !targetTab.ast) continue;
      const targetComponents = (targetTab.ast.components ?? []) as ExtendedComponentDefNode[];
      const targetExportDecls = (targetTab.ast.exports ?? []) as Array<{
        kind: string;
        exportedName: string | null;
        exportKind: string | null;
        raw: string;
        span: Span;
      }>;

      // Path (a): direct component-def in target's ast.components
      let compDef: ExtendedComponentDefNode | undefined =
        targetComponents.find((c: ExtendedComponentDefNode) => c.name === importedName);

      // Path (b): export-decl with markup body — synthesize a component-def
      if (!compDef) {
        const expDecl = targetExportDecls.find(
          (e) => e && e.exportedName === importedName && e.exportKind === "const"
        );
        if (expDecl && typeof expDecl.raw === "string") {
          // Strip `export const NAME =` prefix; tokenized form spaces around
          // tokens so the prefix shape is consistent: `export const NAME =`.
          const prefix = `export const ${importedName} =`;
          const idx = expDecl.raw.indexOf(prefix);
          if (idx !== -1) {
            const body = expDecl.raw.slice(idx + prefix.length).trimStart();
            compDef = {
              kind: "component-def",
              name: importedName,
              raw: body,
              span: expDecl.span,
              defChildren: [],
            } as ExtendedComponentDefNode;
          }
        }
      }

      if (!compDef) continue;

      // Only add if not already in the same-file registry (same-file takes
      // precedence; for transitively-enriched components, first-write-wins
      // since seen tracks (sourceKey, localName) which forbids re-add).
      // The consumer file uses `localName` (the import-aliased name) when
      // looking up the registry; for transitive entries the localName always
      // equals importedName (we don't see aliases through the import graph).
      if (!registry.has(localName)) {
        // Build the component entry the same way as buildComponentRegistry
        const defNode = parseComponentDef(compDef, rawSource, ceErrors);
        if (defNode) {
          // §14.9: derive snippetProps for cross-file components
          const xSnippetProps = new Map<string, PropDecl>();
          if (defNode.propsDecl) {
            for (const decl of defNode.propsDecl) {
              if (decl.isSnippet) xSnippetProps.set(decl.name, decl);
            }
          }
          registry.set(localName, {
            nodes: defNode.nodes,
            defSpan: compDef.span,
            propsDecl: defNode.propsDecl ?? null,
            defChildren: defNode.defChildren ?? [],
            snippetProps: xSnippetProps,
          });
        }
      }

      // A6 transitive enrichment: enqueue user-component imports of the
      // target file. The target's own `ast.imports` resolves via
      // `importGraph.get(sourceKey)`. Component refs inside the target's
      // body may name any of these — register them so the consumer's CE
      // walk finds them when expanding the imported component's children.
      const targetImports = (targetTab.ast.imports ?? []) as ImportDeclNode[];
      for (const tImp of targetImports) {
        const tImpExt = tImp as ImportWithSpecifiers;
        const tKey = lookupKey(sourceKey, tImp, importGraph);
        const tTargetExports = exportRegistry.get(tKey);
        if (!tTargetExports) continue;
        const tPairs = tImpExt.specifiers
          ? tImpExt.specifiers.map((s) => ({ imported: s.imported, local: s.local || s.imported }))
          : (tImp.names ?? []).map((n: string) => ({ imported: n, local: n }));
        for (const { imported: tImported, local: tLocal } of tPairs) {
          const tInfo = tTargetExports.get(tImported);
          if (!tInfo) continue;
          const tIsUserComponent =
            tInfo.category === "user-component" ||
            (tInfo.category == null && tInfo.isComponent === true);
          if (!tIsUserComponent) continue;
          work.push({
            sourceKey: tKey,
            importedName: tImported,
            localName: tLocal,
            rawSource: tImp.source as string,
          });
        }
      }
    }
  }

  // Initialize the node-ID counter from the maximum ID already assigned by TAB
  const maxExistingId = findMaxId(ast.nodes ?? []);
  const counter: NodeCounter = { next: maxExistingId };

  // Walk the AST and expand all component references
  const expandedNodes = walkAndExpand(ast.nodes ?? [], registry, filePath, counter, ceErrors);

  // -------------------------------------------------------------------------
  // P3.A — CHX (Channel-Expander) Phase 2
  //
  // Inlines cross-file channel imports per the W6 source pattern (P3 dive
  // §4.4). For each markup node M whose tag matches a local alias in the
  // consumer's importedChannelAliases map, we look up the source file's
  // ast.channelDecls, find the matching exported channel-decl by name, and
  // replace M with a deep-cloned copy. The inlined copy retains
  // kind: "markup", tag: "channel" so codegen runs unchanged.
  //
  // Per the dive §8.4 routing-table: channel routing is NR-authoritative
  // (resolvedCategory === "channel"). P3-FOLLOW: component routing in
  // Phase 1 above is now also NR-authoritative — the gate uses the helper
  // isUserComponentMarkup() which prefers resolvedKind === "user-component"
  // and falls back to legacy isComponent only when NR has not run.
  // -------------------------------------------------------------------------
  let phase2Nodes = expandedNodes;
  if (exportRegistry && fileASTMap) {
    const importedChannelAliases = buildImportedChannelAliases(
      filePath,
      ast.imports ?? [],
      exportRegistry,
      importGraph,
      ceErrors
    );
    if (importedChannelAliases.size > 0) {
      phase2Nodes = expandChannels(
        expandedNodes,
        importedChannelAliases,
        fileASTMap,
        filePath,
        counter,
        ceErrors,
        importGraph
      );
    }
  }

  // Produce updated AST:
  // - nodes: expanded (component-defs consumed from logic bodies, user-component refs replaced;
  //          P3.A: cross-file channel refs inlined as <channel> markup nodes)
  // - components: cleared (all definitions have been processed)
  // - channelDecls: re-collected after inlining so downstream stages see the inlined channels
  const updatedAst: FileAST = {
    ...ast,
    nodes: phase2Nodes,
    components: [], // component-def nodes are consumed by this stage
  };

  return { filePath, ast: updatedAst, errors: ceErrors };
}

// ---------------------------------------------------------------------------
// P3.A — CHX helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of {local-alias → {imported-name, source-key}} for all
 * cross-file channel imports in this file. Returns an empty Map when no
 * channel imports exist (the caller short-circuits CHX in that case).
 */
function buildImportedChannelAliases(
  filePath: string,
  imports: ImportDeclNode[],
  exportRegistry: ExportRegistry,
  importGraph: ImportGraph | undefined,
  errors: CEError[]
): Map<string, { imported: string; sourceKey: string }> {
  const result = new Map<string, { imported: string; sourceKey: string }>();
  // P3.A: track imported `name=` values so we can detect cross-file collisions.
  // Map<importedName, sourceKey-of-first-import>
  const importedByName = new Map<string, string>();

  const _checkCollision = (
    importedName: string,
    sourceKey: string,
    span: Span | null | undefined
  ): boolean => {
    const existingSource = importedByName.get(importedName);
    if (existingSource && existingSource !== sourceKey) {
      // Same channel-name imported from TWO different source files.
      errors.push(makeCEError(
        "E-CHANNEL-008",
        `E-CHANNEL-008: Channel \`${importedName}\` is imported from both \`${existingSource}\` and \`${sourceKey}\` in the same file. ` +
        `Cross-file channel imports must have distinct \`name=\` attribute values; two channels sharing the same wire-name from different source files would conflict on the same WebSocket route. ` +
        `Rename the channel in one of the source files or import only one of them.`,
        (span ?? { file: existingSource ?? sourceKey, start: 0, end: 0, line: 1, col: 1 }) as Span
      ));
      return true;
    }
    importedByName.set(importedName, sourceKey);
    return false;
  };

  for (const imp of imports) {
    const importExt = imp as ImportWithSpecifiers;
    const sourceKey = lookupKey(filePath, imp, importGraph);
    const targetExports = exportRegistry.get(sourceKey);
    if (!targetExports) continue;
    // Use specifiers if available (preserves alias); fall back to names.
    if (importExt.specifiers && importExt.specifiers.length > 0) {
      for (const spec of importExt.specifiers) {
        const info = targetExports.get(spec.imported);
        if (info && info.category === "channel") {
          if (_checkCollision(spec.imported, sourceKey, imp.span)) {
            // Continue — record the second alias too so downstream
            // processing has both. The error is already emitted.
          }
          result.set(spec.local, { imported: spec.imported, sourceKey });
        }
      }
    } else if (Array.isArray(imp.names)) {
      for (const name of imp.names) {
        const info = targetExports.get(name);
        if (info && info.category === "channel") {
          if (_checkCollision(name, sourceKey, imp.span)) {
            // Continue — see above.
          }
          // No alias info available — use the imported name as both keys.
          result.set(name, { imported: name, sourceKey });
        }
      }
    }
  }
  return result;
}

/**
 * Walk the AST and replace each markup node whose tag matches a local
 * channel alias with a deep-cloned copy of the source file's channel-decl.
 *
 * Returns a new nodes array (no in-place mutation).
 */
function expandChannels(
  nodes: ASTNode[],
  aliases: Map<string, { imported: string; sourceKey: string }>,
  fileASTMap: FileASTMap,
  filePath: string,
  counter: NodeCounter,
  errors: CEError[],
  _importGraph?: ImportGraph
): ASTNode[] {
  const out: ASTNode[] = [];
  for (const node of nodes) {
    out.push(_expandChannelNode(node, aliases, fileASTMap, filePath, counter, errors));
  }
  return out;
}

function _expandChannelNode(
  node: ASTNode,
  aliases: Map<string, { imported: string; sourceKey: string }>,
  fileASTMap: FileASTMap,
  filePath: string,
  counter: NodeCounter,
  errors: CEError[]
): ASTNode {
  if (!node || typeof node !== "object") return node;

  // Markup node — first check for cross-file channel match
  if (node.kind === "markup") {
    const m = node as MarkupNode;
    const alias = aliases.get(m.tag);
    if (alias) {
      // Look up source file's channelDecls
      const targetTab = fileASTMap.get(alias.sourceKey);
      const channelDecls: any[] = (targetTab?.ast as any)?.channelDecls ?? [];
      const sourceDecl = channelDecls.find((c: any) =>
        c && c._p3aExportName === alias.imported
      );
      if (!sourceDecl) {
        errors.push(makeCEError(
          "E-CHANNEL-EXPORT-002",
          `E-CHANNEL-EXPORT-002: Channel \`${alias.imported}\` is declared as exported in ${alias.sourceKey} but the channel markup body could not be located. ` +
          `This is an internal error — the export-decl was registered but the corresponding <channel> markup node was not collected. ` +
          `Verify that the source file's TAB output includes the channel in ast.channelDecls.`,
          m.span
        ));
        return node;
      }
      // Deep-clone the source channel-decl with fresh IDs and updated span.
      const inlined = _cloneChannelDecl(sourceDecl, counter, alias.sourceKey, m.span);
      return inlined;
    }
    // Not a cross-file channel ref — recurse into children
    const newChildren = m.children
      ? m.children.map((c) => _expandChannelNode(c, aliases, fileASTMap, filePath, counter, errors))
      : m.children;
    if (newChildren !== m.children) {
      return { ...m, children: newChildren };
    }
    return node;
  }

  // State node — recurse into children
  if (node.kind === "state") {
    const s = node as any;
    if (Array.isArray(s.children)) {
      const newChildren = s.children.map((c: any) => _expandChannelNode(c, aliases, fileASTMap, filePath, counter, errors));
      if (newChildren.some((nc: any, i: number) => nc !== s.children[i])) {
        return { ...s, children: newChildren };
      }
    }
    return node;
  }

  // Logic node — recurse into body where markup may live (BLOCK_REF inlined nodes)
  if (node.kind === "logic") {
    const l = node as LogicNode;
    if (Array.isArray(l.body)) {
      const newBody = l.body.map((stmt: any) => _expandChannelNode(stmt, aliases, fileASTMap, filePath, counter, errors));
      if (newBody.some((nb: any, i: number) => nb !== l.body[i])) {
        return { ...l, body: newBody as any };
      }
    }
    return node;
  }

  return node;
}

/**
 * Deep-clone a channel-decl AST node with fresh IDs assigned by `counter`.
 * Preserves attrs / children / annotations. Marks the clone with
 * _p3aInlinedFrom + _p3aSourceSpan for diagnostics.
 */
function _cloneChannelDecl(
  source: any,
  counter: NodeCounter,
  sourceKey: string,
  refSpan: Span
): MarkupNode {
  const clone = _deepCloneAst(source, counter);
  // Tag with inline-source diagnostics; clear the export marker since the
  // inlined copy lives in the consumer's AST as a per-page-shape decl.
  clone._p3aInlinedFrom = sourceKey;
  clone._p3aSourceSpan = source.span;
  // The inlined copy retains its original span info but carries the
  // consumer's reference span as `_p3aRefSpan` for downstream diagnostics.
  clone._p3aRefSpan = refSpan;
  // Inlined channel is no longer "exported" at the consumer site (the
  // consumer might not be exporting anything).
  clone._p3aIsExport = undefined;
  return clone as MarkupNode;
}

function _deepCloneAst(node: any, counter: NodeCounter): any {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) {
    return node.map((e) => _deepCloneAst(e, counter));
  }
  if (typeof node !== "object") return node;
  const out: any = {};
  for (const key of Object.keys(node)) {
    if (key === "id") {
      out.id = ++counter.next;
      continue;
    }
    out[key] = _deepCloneAst(node[key], counter);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Public entry point — multi-file (pipeline contract)
// ---------------------------------------------------------------------------

/**
 * Pipeline-contract entry point. Takes the multi-file form used by the
 * pipeline runner.
 */
export function runCE(input: CEInput): CEOutput {
  const { files, exportRegistry, fileASTMap, importGraph } = input;
  const processedFiles = (files || []).map((f: CEFileInput) =>
    runCEFile(f, exportRegistry, fileASTMap, importGraph)
  );
  const allErrors = processedFiles.flatMap((f: CEFileOutput) => f.errors);
  return { files: processedFiles, errors: allErrors };
}
