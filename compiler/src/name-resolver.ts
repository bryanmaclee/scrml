/**
 * Name Resolver — Stage 3.05 of the scrml compiler pipeline (NR).
 *
 * Implements the unified state-type registry name resolution per SPEC §15.15
 * and PIPELINE.md Stage 3.05. Walks every tag-bearing AST node (`MarkupNode`,
 * `StateNode`, `StateConstructorDefNode`, `MachineDeclNode`) and stamps two
 * advisory fields on each:
 *
 *   resolvedKind:     'html-builtin' | 'scrml-lifecycle' | 'user-state-type'
 *                   | 'user-component' | 'unknown'
 *   resolvedCategory: 'html' | 'channel' | 'engine' | 'timer' | 'poll' | 'db'
 *                   | 'schema' | 'request' | 'errorBoundary' | 'machine'
 *                   | 'user-component' | 'user-state-type' | 'unknown'
 *
 * Phase P1 — SHADOW MODE.  NR runs and emits diagnostics, but downstream
 * stages (CE, MOD, TS, codegen) initially routed on the legacy `isComponent`
 * discriminator. The routing flip happened in P3-FOLLOW: NR is now authoritative
 * — `resolvedKind` / `resolvedCategory` drive routing in CE, TS, validators,
 * and LSP. The legacy `isComponent` boolean is retained as a derived field
 * for AST shape backcompat but is no longer the authoritative signal.
 *
 * Diagnostics emitted by NR:
 *   W-CASE-001       Lowercase user-declared state-type/component shadowing
 *                    a built-in HTML element (SPEC §15.15.4).
 *   W-WHITESPACE-001 Opener uses whitespace between `<` and the identifier;
 *                    canonical form is no-space (SPEC §15.15.5).
 *
 * Lookup order (SPEC §15.15.2):
 *   1. Same-file user declaration (case-sensitive).
 *   2. Imported name from MOD `exportRegistry` (case-sensitive).
 *   3. Built-in scrml lifecycle keyword (case-sensitive).
 *   4. Built-in HTML element (case-insensitive).
 *   5. Otherwise unknown — downstream stages handle hard errors.
 *
 * Performance budget:  <= 5 ms per file (pure AST traversal).
 */

import { isHtmlElement, isKnownElementName } from "./html-elements.js";
import {
  STRUCTURAL_ELEMENT_PLACEMENT,
  RESERVED_CSS_ELEMENT_IDENTIFIERS,
} from "./ast-builder.js";
import type { ASTNode, FileAST, Span } from "./types/ast.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ResolvedKind =
  | "html-builtin"
  | "scrml-lifecycle"
  | "user-state-type"
  | "user-component"
  | "unknown";

export type ResolvedCategory =
  | "html"
  | "channel"
  | "engine"
  | "timer"
  | "poll"
  | "db"
  | "schema"
  | "request"
  | "errorBoundary"
  | "machine"
  | "user-component"
  | "user-state-type"
  | "unknown";

export interface NRError {
  code: "W-CASE-001" | "W-WHITESPACE-001" | "E-MARKUP-001";
  message: string;
  span: Span;
  severity: "warning" | "error";
}

export interface NRResult {
  filePath: string;
  errors: NRError[];
  /** Per-tag-name registry actually constructed for this file (debugging aid). */
  registrySize: number;
  /** Counts of each resolvedKind hit (debugging aid). */
  kindCounts: Record<ResolvedKind, number>;
}

// ---------------------------------------------------------------------------
// Built-in lifecycle table (compile-time constant)
// ---------------------------------------------------------------------------
//
// These are the scrml lifecycle state-types that pre-date any user code and
// therefore cannot collide with user names (in either direction).
const LIFECYCLE_CATEGORY: Record<string, ResolvedCategory> = {
  channel: "channel",
  engine: "engine",
  machine: "machine",       // alias for engine; W-DEPRECATED-001 emitted by TAB
  timer: "timer",
  poll: "poll",
  db: "db",
  schema: "schema",
  request: "request",
  errorBoundary: "errorBoundary",
  errorboundary: "errorBoundary",
};

function isLifecycleKeyword(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_CATEGORY, name);
}

// ---------------------------------------------------------------------------
// E-MARKUP-001 gate exclusions (SPEC §4.1)
// ---------------------------------------------------------------------------
//
// A markup opener whose tag resolves to `unknown` is a candidate for
// E-MARKUP-001 ("unknown HTML element name"). Beyond the HTML ∪ SVG ∪ MathML ∪
// custom-element union (owned by `isKnownElementName` in html-elements.js),
// several scrml-specific tag names legitimately reach the walker as
// `kind:"markup" resolvedKind:"unknown"` and MUST NOT fire:
//
//  - scrml structural / directive tags that are NOT parsed away upstream and
//    are NOT lifecycle keywords (which already resolve to `scrml-lifecycle`).
//    Empirically (corpus recon), `page`, `outlet`, `errors`, and the deprecated
//    non-canonical control-flow tag forms leak here. The lifecycle keywords are
//    included defensively (they resolve to a known kind, so never reach the
//    gate, but listing them documents the full scrml-tag surface).
//  - §36 input-state tags (`<keyboard/>`, `<mouse/>`, `<gamepad/>`), which are
//    handled at codegen (emit-html.ts INPUT_STATE_TAGS) and survive as markup.
//
// Compared lowercase. Kept here (NR owns scrml-keyword knowledge) rather than in
// html-elements.js (which owns element knowledge) — separation of concerns.
// The scrml-structural tags that are NOT captured by the authoritative registry
// imported below (STRUCTURAL_ELEMENT_PLACEMENT covers the locus-restricted
// structural elements; RESERVED_CSS_ELEMENT_IDENTIFIERS covers §65 theme/
// defaults). This hand-list carries the remaining scrml tag names that can
// surface as raw markup openers: document roots, definition blocks, top-level
// structural declarations that are not in the placement table (they are not
// locus-restricted), directive sugar, and the lifecycle keywords.
const SCRML_NON_ELEMENT_TAGS_EXTRA: readonly string[] = [
  // Structural document roots (`<program>` canonical; `<markup>` legacy root,
  // still accepted + widely used in fixtures; `<page>`).
  "program", "markup", "page",
  // Definition blocks (§15 component, §16 snippet/partial, §23.6 foreign code,
  // §61 endpoint) — surface as raw markup openers in some shapes.
  "component", "snippet", "partial", "foreign", "endpoint",
  // Top-level structural declarations / directive sugar not in the placement
  // table (§18.0.1 match, §17.7 each/empty, §19.15 render, §20.8 outlet, …).
  "outlet", "match", "each", "empty", "render", "column",
  "formfor", "tablefor", "if", "else", "else-if",
  // Lifecycle keywords (already resolve to scrml-lifecycle; defensive).
  "machine", "timer", "poll", "db", "request", "errorboundary",
];

// The E-MARKUP-001 gate's scrml-structural exclusion. DERIVED (not hand-copied)
// from the compiler's authoritative structural-element registries so it cannot
// drift out of sync: every key of ast-builder's STRUCTURAL_ELEMENT_PLACEMENT
// (§4.15 locus-restricted structural elements) and every
// RESERVED_CSS_ELEMENT_IDENTIFIERS entry (§65 theme/defaults) is auto-included.
// Adding a new registered structural element to that table automatically
// excludes it here — no parallel edit required (S264 review: `<defaults>` was
// the one placement key omitted from the earlier hand-list, and false-fired).
// All names are lowercased (the gate only fires on all-lowercase tags, and the
// registry's camelCase forms — onTransition/onTimeout/onIdle — map to their
// lowercase mirrors, e.g. `onidle`).
export const SCRML_NON_ELEMENT_TAGS: Set<string> = new Set<string>(
  [
    ...SCRML_NON_ELEMENT_TAGS_EXTRA,
    ...Object.keys(STRUCTURAL_ELEMENT_PLACEMENT),
    ...RESERVED_CSS_ELEMENT_IDENTIFIERS,
  ].map((n) => n.toLowerCase()),
);

// §36 input-state tags (mirror of emit-html.ts INPUT_STATE_TAGS). These render
// via a dedicated codegen branch and are never HTML elements.
const INPUT_STATE_TAGS = new Set<string>(["keyboard", "mouse", "gamepad"]);

// A tag that is a plausible standard-HTML element name: all-lowercase ASCII
// alphanumeric (e.g. `div`, `h1`, `blorptag`). HTML element names are lowercase,
// so a name containing an uppercase letter, hyphen, dot, or underscore is NOT a
// plausible unknown-HTML-element typo — it is a user identifier (camelCase state
// / channel cell), a custom element (hyphen), or a namespaced form. Restricting
// E-MARKUP-001 to this shape keeps false positives at zero on the real corpus
// (camelCase cells such as `<customerEvents/>` never fire).
function isPlausibleHtmlElementName(name: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(name);
}

// ---------------------------------------------------------------------------
// Per-file registry construction (advisory; built fresh per NR run)
// ---------------------------------------------------------------------------

interface LocalDecl {
  kind: ResolvedKind;
  category: ResolvedCategory;
}

/** Build the same-file declaration registry from the AST. */
function buildSameFileRegistry(ast: FileAST): Map<string, LocalDecl> {
  const reg = new Map<string, LocalDecl>();

  // Components — kind:user-component
  for (const c of ast.components ?? []) {
    if (c?.name) {
      reg.set(c.name, { kind: "user-component", category: "user-component" });
    }
  }

  // Type declarations — kind:user-state-type
  for (const t of ast.typeDecls ?? []) {
    if (t?.name) {
      // Don't clobber a same-name component (component takes precedence per
      // §15.15.2 lookup order).
      if (!reg.has(t.name)) {
        reg.set(t.name, { kind: "user-state-type", category: "user-state-type" });
      }
    }
  }

  // Inline state-constructor-def nodes — kind:user-state-type
  function collect(nodes: ASTNode[]): void {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      const anyN = n as any;
      if (anyN.kind === "state-constructor-def" && anyN.stateType) {
        if (!reg.has(anyN.stateType)) {
          reg.set(anyN.stateType, { kind: "user-state-type", category: "user-state-type" });
        }
      }
      if (Array.isArray(anyN.children)) collect(anyN.children);
    }
  }
  collect(ast.nodes ?? []);

  return reg;
}

/**
 * Build the set of all names DECLARED anywhere in the file, for the E-MARKUP-001
 * gate ONLY. A markup opener whose tag matches a locally-declared name is a
 * reference to that declaration (a state cell, compound state, compound field,
 * state block, component, or type) — never an unknown-HTML-element typo — so it
 * MUST NOT fire E-MARKUP-001.
 *
 * This is a SEPARATE, gate-only set: it is deliberately NOT merged into the
 * resolution registry (buildSameFileRegistry), so it does not change any
 * `resolvedKind` / `resolvedCategory` stamp that downstream stages consume. It
 * only suppresses a false-positive diagnostic.
 *
 * Covers the corpus patterns that reach the walker as `markup`/`unknown`:
 *   - `state-decl` nodes (V5-strict `<cell> = value`), recursing into `children`
 *     for §55 compound-state fields (`<signup>` → `<name>`/`<email>`/…).
 *   - `state` blocks (the `< name>` whitespace-form declaration, e.g. modern-005
 *     `< sidebar>` used later as `<sidebar>`).
 *   - `state-constructor-def` state types, components, and type declarations
 *     (already resolved by buildSameFileRegistry, included for completeness).
 */
function buildLocalDeclaredNames(ast: FileAST): Set<string> {
  const names = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n === "string" && n.length > 0) names.add(n);
  };

  for (const c of ast.components ?? []) add((c as any)?.name);
  for (const t of ast.typeDecls ?? []) add((t as any)?.name);

  function walkDecls(nodes: ASTNode[]): void {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const anyN = n as any;
      switch (anyN.kind) {
        case "state-decl":
          add(anyN.name);
          break;
        case "state-constructor-def":
          add(anyN.stateType);
          break;
        case "state":
          // `< name>` whitespace-form state block — the stateType names the
          // declared block (e.g. `< sidebar>`).
          add(anyN.stateType);
          break;
      }
      // Recurse through every array-valued child slot so nested compound-field
      // state-decls, engine/component bodies, and logic-block bodies are all
      // covered.
      for (const key of Object.keys(anyN)) {
        const v = anyN[key];
        if (Array.isArray(v)) walkDecls(v as ASTNode[]);
        else if (v && typeof v === "object" && (v as any).kind) walkDecls([v as ASTNode]);
      }
    }
  }
  walkDecls(ast.nodes ?? []);

  return names;
}

/**
 * Walk declaration sites and emit W-CASE-001 on each user state-type/component
 * whose lowercase name shadows an HTML element. This fires per declaration
 * (independent of any use site) per SPEC §15.15.4.
 */
function emitCaseDiagnosticsForDeclarations(ast: FileAST, acc: WalkAccumulator): void {
  const decls: Array<{ name: string; span: Span | undefined; kind: ResolvedKind }> = [];
  for (const c of ast.components ?? []) {
    if (c?.name) decls.push({ name: c.name, span: (c as any).span, kind: "user-component" });
  }
  for (const t of ast.typeDecls ?? []) {
    if (t?.name) decls.push({ name: t.name, span: (t as any).span, kind: "user-state-type" });
  }
  function collectDecls(nodes: ASTNode[]): void {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      const anyN = n as any;
      if (anyN.kind === "state-constructor-def" && anyN.stateType) {
        decls.push({ name: anyN.stateType, span: anyN.span, kind: "user-state-type" });
      }
      if (Array.isArray(anyN.children)) collectDecls(anyN.children);
      if (Array.isArray(anyN.body)) collectDecls(anyN.body);
    }
  }
  collectDecls(ast.nodes ?? []);
  for (const d of decls) {
    if (!d.span) continue;
    maybeEmitCase(
      d.name,
      d.span,
      { resolvedKind: d.kind, resolvedCategory: d.kind === "user-component" ? "user-component" : "user-state-type" },
      acc,
    );
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface ResolutionContext {
  sameFileRegistry: Map<string, LocalDecl>;
  importedRegistry: Map<string, LocalDecl>;
}

interface Resolution {
  resolvedKind: ResolvedKind;
  resolvedCategory: ResolvedCategory;
}

function resolveName(name: string, ctx: ResolutionContext): Resolution {
  // 1. Same-file
  const local = ctx.sameFileRegistry.get(name);
  if (local) {
    return { resolvedKind: local.kind, resolvedCategory: local.category };
  }
  // 2. Imported
  const imported = ctx.importedRegistry.get(name);
  if (imported) {
    return { resolvedKind: imported.kind, resolvedCategory: imported.category };
  }
  // 3. scrml lifecycle (case-sensitive)
  if (isLifecycleKeyword(name)) {
    return { resolvedKind: "scrml-lifecycle", resolvedCategory: LIFECYCLE_CATEGORY[name] };
  }
  // 4. HTML built-in (case-insensitive — HTML element names are case-insensitive
  //    per the HTML spec)
  if (isHtmlElement(name)) {
    return { resolvedKind: "html-builtin", resolvedCategory: "html" };
  }
  // 5. Unknown — downstream stages own E-COMPONENT-020 / E-MARKUP-001 / E-STATE-001
  return { resolvedKind: "unknown", resolvedCategory: "unknown" };
}

// ---------------------------------------------------------------------------
// AST walker — populates resolvedKind/resolvedCategory and emits diagnostics
// ---------------------------------------------------------------------------

interface WalkAccumulator {
  errors: NRError[];
  kindCounts: Record<ResolvedKind, number>;
  // Track which (name, line, col) combinations have already emitted W-CASE-001
  // / W-WHITESPACE-001 / E-MARKUP-001 so we never spam (one diagnostic per
  // source position).
  caseEmitted: Set<string>;
  whitespaceEmitted: Set<string>;
  markupUnknownEmitted: Set<string>;
  // Names declared anywhere in the file (gate-only; see buildLocalDeclaredNames).
  localDeclaredNames: Set<string>;
}

function spanKey(name: string, span: Span | null | undefined): string {
  if (!span) return name + ":?:?";
  return `${name}:${span.line}:${span.col}`;
}

function maybeEmitCase(
  name: string,
  span: Span,
  resolution: Resolution,
  acc: WalkAccumulator,
): void {
  // W-CASE-001: a user-declared state-type or component whose name is
  // lowercase (first char a-z) AND collides (case-insensitively) with a
  // built-in HTML element.
  const isUserKind =
    resolution.resolvedKind === "user-state-type" ||
    resolution.resolvedKind === "user-component";
  if (!isUserKind) return;
  if (name.length === 0) return;
  const firstChar = name.charCodeAt(0);
  if (firstChar < 0x61 || firstChar > 0x7a) return; // not lowercase a-z
  if (!isHtmlElement(name)) return; // no HTML collision
  const key = spanKey(name, span);
  if (acc.caseEmitted.has(key)) return;
  acc.caseEmitted.add(key);
  acc.errors.push({
    code: "W-CASE-001",
    message:
      `W-CASE-001: User-declared state-type/component \`${name}\` shadows the built-in HTML element \`<${name}>\`. ` +
      `Resolution still succeeds (the user declaration takes precedence), but readers may be confused. ` +
      `Recommended: rename to PascalCase (e.g., \`${name[0].toUpperCase() + name.slice(1)}\`).`,
    span,
    severity: "warning",
  });
}

/**
 * E-MARKUP-001 (SPEC §4.1): a markup opener whose element name is neither a
 * known HTML element, SVG element, MathML element, custom element, defined
 * component, scrml structural/lifecycle tag, §36 input-state tag, nor a
 * locally-declared name (state cell / compound / compound field / state block)
 * — i.e. a genuine unknown-element typo (`<blorptag>`, `<dvi>`, `<spam>`).
 *
 * Fires ONLY on `kind:"markup"` nodes resolved to `unknown` (PascalCase-unknown
 * component references are owned by E-COMPONENT-035 / VP-2). The predicate stack
 * is ordered cheapest-first and is calibrated for ZERO false positives on the
 * real corpus (see buildLocalDeclaredNames + SCRML_NON_ELEMENT_TAGS +
 * INPUT_STATE_TAGS + isKnownElementName + isPlausibleHtmlElementName).
 */
function maybeEmitMarkupUnknown(
  name: string,
  span: Span,
  resolution: Resolution,
  acc: WalkAccumulator,
): void {
  if (resolution.resolvedKind !== "unknown") return;
  if (typeof name !== "string" || name.length === 0) return;
  // Only all-lowercase ASCII-alphanumeric names look like an HTML-element typo.
  // (Excludes camelCase cells, custom-element hyphen forms, dotted/namespaced.)
  if (!isPlausibleHtmlElementName(name)) return;
  // A valid element in any namespace (HTML ∪ SVG ∪ MathML ∪ custom / registry).
  if (isKnownElementName(name)) return;
  // scrml structural / lifecycle / directive tags.
  if (SCRML_NON_ELEMENT_TAGS.has(name)) return;
  // §36 input-state tags.
  if (INPUT_STATE_TAGS.has(name)) return;
  // A reference to something declared in this file (state cell / compound /
  // compound field / state block / component / type).
  if (acc.localDeclaredNames.has(name)) return;

  const key = spanKey(name, span);
  if (acc.markupUnknownEmitted.has(key)) return;
  acc.markupUnknownEmitted.add(key);
  acc.errors.push({
    code: "E-MARKUP-001",
    message:
      `E-MARKUP-001: \`<${name}>\` is not a known HTML element and not a defined component. ` +
      `A markup opener (\`<\` immediately followed by an identifier, SPEC §4.1) must name a built-in ` +
      `HTML/SVG/MathML element, a custom element (a hyphenated name like \`<my-widget>\`), a defined ` +
      `component (PascalCase, imported or declared), or a declared state/compound cell. ` +
      `Likely a typo of an element name — check the spelling.`,
    span,
    severity: "error",
  });
}

function maybeEmitWhitespace(
  name: string,
  span: Span,
  openerHadSpaceAfterLt: boolean,
  acc: WalkAccumulator,
): void {
  if (!openerHadSpaceAfterLt) return;
  const key = spanKey(name, span);
  if (acc.whitespaceEmitted.has(key)) return;
  acc.whitespaceEmitted.add(key);
  acc.errors.push({
    code: "W-WHITESPACE-001",
    message:
      `W-WHITESPACE-001: Opener \`< ${name}>\` uses whitespace between \`<\` and the identifier. ` +
      `The canonical form is no-space (\`<${name}>\`); the with-space form is deprecated and ` +
      `becomes E-WHITESPACE-001 in P3. Migration tooling: \`scrml-migrate\` (planned).`,
    span,
    severity: "warning",
  });
}

function walk(nodes: ASTNode[], ctx: ResolutionContext, acc: WalkAccumulator): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (!n) continue;
    const anyN = n as any;
    const kind = anyN.kind as string;

    // Resolve every tag-bearing node.
    if (kind === "markup" && anyN.tag) {
      const res = resolveName(anyN.tag, ctx);
      anyN.resolvedKind = res.resolvedKind;
      anyN.resolvedCategory = res.resolvedCategory;
      acc.kindCounts[res.resolvedKind]++;
      if (anyN.span) {
        maybeEmitCase(anyN.tag, anyN.span, res, acc);
        maybeEmitMarkupUnknown(anyN.tag, anyN.span, res, acc);
        maybeEmitWhitespace(
          anyN.tag,
          anyN.span,
          anyN.openerHadSpaceAfterLt === true,
          acc,
        );
      }
    } else if (
      (kind === "state" || kind === "state-constructor-def") &&
      anyN.stateType
    ) {
      const res = resolveName(anyN.stateType, ctx);
      anyN.resolvedKind = res.resolvedKind;
      anyN.resolvedCategory = res.resolvedCategory;
      acc.kindCounts[res.resolvedKind]++;
      if (anyN.span) {
        maybeEmitCase(anyN.stateType, anyN.span, res, acc);
        maybeEmitWhitespace(
          anyN.stateType,
          anyN.span,
          anyN.openerHadSpaceAfterLt === true,
          acc,
        );
      }
    } else if (kind === "engine-decl" && (anyN.engineName || anyN.governedType)) {
      // engine-decl is a state-form lifecycle (the keyword `engine` or `machine`)
      // — resolved category is always "engine" (canonical) or "machine" (legacy).
      const category: ResolvedCategory = anyN.legacyMachineKeyword === true ? "machine" : "engine";
      anyN.resolvedKind = "scrml-lifecycle";
      anyN.resolvedCategory = category;
      acc.kindCounts["scrml-lifecycle"]++;
      if (anyN.span) {
        maybeEmitWhitespace(
          anyN.legacyMachineKeyword === true ? "machine" : "engine",
          anyN.span,
          anyN.openerHadSpaceAfterLt === true,
          acc,
        );
      }
    }

    // Recurse into children.
    if (Array.isArray(anyN.children)) walk(anyN.children, ctx, acc);
    // Logic-block bodies hold function-decl, const-decl etc. but tag nodes
    // inside lift-blocks live in `body` arrays of those statements. Walk
    // anything that looks like a body or branch.
    if (Array.isArray(anyN.body)) walk(anyN.body, ctx, acc);
    if (Array.isArray(anyN.consequent)) walk(anyN.consequent, ctx, acc);
    if (Array.isArray(anyN.alternate)) walk(anyN.alternate, ctx, acc);
    if (Array.isArray(anyN.arms)) {
      for (const arm of anyN.arms) {
        if (arm && Array.isArray(arm.body)) walk(arm.body, ctx, acc);
      }
    }
    // P3-FOLLOW: lift-expr carries an inline markup tree under expr.node.
    // VP-2 / CE / codegen all need NR resolution stamped on those nodes —
    // otherwise residual <ComponentRef/> inside `lift <li><ComponentRef/></li>`
    // is invisible to NR-authoritative routing. Mirrors walkFileAst() in
    // validators/ast-walk.ts.
    if (kind === "lift-expr" && anyN.expr && anyN.expr.kind === "markup" && anyN.expr.node) {
      walk([anyN.expr.node], ctx, acc);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NRInput {
  filePath: string;
  ast: FileAST;
  /** MOD's exportRegistry. Optional; when absent NR runs same-file-only
   *  resolution. P3-FOLLOW: each entry carries `category` (NR-authoritative,
   *  matches NR's resolvedCategory vocabulary) plus the legacy `isComponent`
   *  derived field. NR prefers `category` for kind/category derivation. */
  exportRegistry?: Map<string, Map<string, { kind: string; isComponent: boolean; category?: string }>>;
  /** MOD's importGraph (per-file imports). When provided alongside exportRegistry,
   *  NR resolves imported names that match an opener tag.
   *
   *  S122 Wave 12 Unit W: each import record also carries `specifiers[]` so
   *  aliased imports (`import { Foo as Bar } from './lib.scrml'`) register `Bar`
   *  in the use-site registry, not `Foo`. The bare `names[]` is the source-side
   *  imported name list (used for exportRegistry lookup); `specifiers[].local`
   *  is the in-scope local binding name. */
  importGraph?: Map<string, { imports: Array<{ names: string[]; specifiers?: Array<{ imported: string; local: string }>; absSource: string }> }>;
}

/**
 * Run NR over a single TAB result. Mutates `ast` in place by adding
 * resolvedKind/resolvedCategory to each tag-bearing node.
 */
export function runNR(input: NRInput): NRResult {
  const { filePath, ast, exportRegistry, importGraph } = input;

  // Build same-file registry.
  const sameFileRegistry = buildSameFileRegistry(ast);

  // Build imported registry from MOD output (when available).
  const importedRegistry = new Map<string, LocalDecl>();
  if (exportRegistry && importGraph) {
    const fileImports = importGraph.get(filePath);
    if (fileImports) {
      for (const imp of fileImports.imports ?? []) {
        const targetExports = exportRegistry.get(imp.absSource);
        if (!targetExports) continue;
        // S122 Wave 12 Unit W: build the iteration list as
        // [{ imported, local }] pairs — the IMPORTED name is what
        // exportRegistry is keyed on (source-side); the LOCAL name is what
        // NR's use-site registry must be keyed on (alias-aware).
        //
        // Prefer specifiers[] when present (named-import form, populated by
        // ast-builder.js:7049-7057 for `import { X as Y }`). Fall back to
        // names[] otherwise — default imports (`import X from '...'`) have
        // names=[X] with empty specifiers and default-import locals are
        // unaliasable per ES syntax, so X is both imported and local.
        const pairs: Array<{ imported: string; local: string }> =
          Array.isArray(imp.specifiers) && imp.specifiers.length > 0
            ? imp.specifiers.map(s => ({ imported: s.imported, local: s.local }))
            : (imp.names ?? []).map(n => ({ imported: n, local: n }));
        for (const { imported: importedName, local: localName } of pairs) {
          const exported = targetExports.get(importedName);
          if (!exported) continue;
          // P3-FOLLOW: prefer info.category (NR-authoritative); fall back
          // to legacy info.isComponent for older registry entries that lack
          // the category field. The two paths produce equivalent LocalDecl.
          let local: LocalDecl;
          if (exported.category === "user-component") {
            local = { kind: "user-component", category: "user-component" };
          } else if (exported.category != null) {
            // Non-component category from registry (e.g. "type", "function",
            // "channel"). For NR's local-decl purposes treat as user-state-type
            // (same as legacy non-component branch).
            local = { kind: "user-state-type", category: "user-state-type" };
          } else if (exported.isComponent) {
            // Fallback: legacy registry entry without category.
            local = { kind: "user-component", category: "user-component" };
          } else {
            local = { kind: "user-state-type", category: "user-state-type" };
          }
          // Same-file declarations win over imports. Collision check is on
          // the LOCAL name (the use-site identifier the resolver looks up).
          if (!sameFileRegistry.has(localName)) {
            importedRegistry.set(localName, local);
          }
        }
      }
    }
  }

  const acc: WalkAccumulator = {
    errors: [],
    kindCounts: {
      "html-builtin": 0,
      "scrml-lifecycle": 0,
      "user-state-type": 0,
      "user-component": 0,
      unknown: 0,
    },
    caseEmitted: new Set(),
    whitespaceEmitted: new Set(),
    markupUnknownEmitted: new Set(),
    localDeclaredNames: buildLocalDeclaredNames(ast),
  };

  // Emit W-CASE-001 on declaration sites first (per SPEC §15.15.4 — fires
  // independently of use sites).
  emitCaseDiagnosticsForDeclarations(ast, acc);

  walk(ast.nodes ?? [], { sameFileRegistry, importedRegistry }, acc);

  return {
    filePath,
    errors: acc.errors,
    registrySize: sameFileRegistry.size + importedRegistry.size,
    kindCounts: acc.kindCounts,
  };
}

/**
 * Run NR over an array of TAB results. Each AST is mutated in place.
 * Returns the per-file results array in the same order.
 */
export function runNRBatch(
  tabResults: Array<{ filePath: string; ast: FileAST }>,
  exportRegistry?: Map<string, Map<string, { kind: string; isComponent: boolean; category?: string }>>,
  // S122 Wave 12 Unit W: type signature includes `specifiers?` to mirror
  // module-resolver.js buildImportGraph; runNR (above) consults specifiers
  // when present for alias-aware local-name registration.
  importGraph?: Map<string, { imports: Array<{ names: string[]; specifiers?: Array<{ imported: string; local: string }>; absSource: string }> }>,
): NRResult[] {
  const out: NRResult[] = [];
  for (const r of tabResults) {
    if (!r || !r.ast) continue;
    out.push(
      runNR({
        filePath: r.filePath,
        ast: r.ast,
        exportRegistry,
        importGraph,
      }),
    );
  }
  return out;
}
