// ---------------------------------------------------------------------------
// emit-theme-reset.ts — SPEC §65.3.2 / §65.3.4 / §65.6 / §65.2.5 / §25.7
//
// The CSS Wave-1 EMISSION half (the conflict-CHECKER — §65.2 — lives separately
// in css-conflict-check.ts and is NOT touched here). This module owns three
// emission concerns generateCss (emit-css.ts) delegates to:
//
//   1. <theme> token lowering (§65.3.2 / §65.6 / §25.7) — the `@`-SIGIL model.
//        DECLARATION stays bare in `<theme>` (`ink = #0f172a`). A REFERENCE in a
//        `#{}` value REQUIRES the `@` sigil: `color: @ink` → `color: var(--ink)`.
//        A BARE identifier (`color: red`, `font-weight: bold`, `display: block`)
//        is a literal CSS value and is NEVER lowered — so a token can never
//        shadow a CSS keyword. A `.Variant { … }` re-bind lowers to a reactive
//        named-variant `:root[data-scrml-theme-<cell>="Variant"]` selector; a
//        `@media (…)` auto-bind to `@media (…) { :root { … } }`.
//        `E-THEME-TOKEN-UNKNOWN` is the DECIDABLE use-site check: an `@name`
//        matching neither a declared theme token NOR a declared reactive/derived
//        cell fires it (a bare identifier never errors — it is CSS). A variant /
//        media re-bind of a name absent from the GLOBAL base token set also fires
//        (a variant re-binds a subset of the base — §65.6).
//
//   2. The built-in reset layer (§65.3.4) — a fixed, modern-consensus minimal
//        reset emitted in a `@layer reset { … }`, declared FIRST so it is the
//        lowest layer (an author `@layer` declared later always wins; an
//        unlayered author rule always beats it). Opt out: `<program reset="none">`.
//
//   3. `:where()`-flat wrapping (§65.2.5) of component-scope author selectors —
//        ONLY UNCONDITIONAL base selectors are flattened to (0,0,0). Conditional
//        selectors (state pseudo `:hover`/`:focus`, attribute `[busy]`,
//        structural/functional pseudo, pseudo-element `::before`) are emitted
//        UNWRAPPED so they keep their natural specificity and win as deterministic
//        LAYERS (§65.2.2) — the assumption css-conflict-check.ts already makes.
//        A comma-list selector is split and each arm is wrapped individually.
// ---------------------------------------------------------------------------

import { CGError } from "./errors.ts";

/** A single `name = value` token binding (matches theme-body-parser.ThemeToken). */
interface ThemeToken {
  name: string;
  value: string;
  span?: { file?: string; start?: number; end?: number; line?: number; col?: number };
}

/** A parsed `theme-decl` AST node (produced by ast-builder + theme-body-parser). */
interface ThemeDecl {
  kind: "theme-decl";
  forCell?: string | null;
  baseTokens?: ThemeToken[];
  variants?: Array<{ variant: string; tokens: ThemeToken[]; span?: ThemeToken["span"] }>;
  mediaBinds?: Array<{ condition: string; tokens: ThemeToken[]; span?: ThemeToken["span"] }>;
  span?: ThemeToken["span"];
}

/** The theme + program + cell context for one file, gathered in a single walk. */
export interface ThemeContext {
  themeDecls: ThemeDecl[];
  programNode: Record<string, unknown> | null;
  /** Declared reactive + derived cell names (`<x> = …`, `const <x> = …`). */
  cellNames: Set<string>;
}

// ---------------------------------------------------------------------------
// Node walking — ONE ladder, reused (no duplicated per-collector walks)
// ---------------------------------------------------------------------------

const CHILD_KEYS = ["children", "body", "bodyChildren", "nodes", "branches"] as const;

/** Depth-first walk over the (post-CE) AST, visiting every object node once. */
function walkNodes(nodes: unknown, visit: (n: Record<string, unknown>) => void): void {
  const seen = new WeakSet<object>();
  const go = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) go(c); return; }
    if (seen.has(n as object)) return;
    seen.add(n as object);
    const node = n as Record<string, unknown>;
    visit(node);
    for (const k of CHILD_KEYS) if (Array.isArray(node[k])) go(node[k]);
  };
  go(nodes);
}

/**
 * Gather the file's theme decls, `<program>` node, and declared cell names in a
 * SINGLE AST walk. Consolidates what were three separate full-tree walks.
 */
export function collectThemeContext(nodes: unknown): ThemeContext {
  const themeDecls: ThemeDecl[] = [];
  let programNode: Record<string, unknown> | null = null;
  const cellNames = new Set<string>();
  walkNodes(nodes, (node) => {
    if (node.kind === "theme-decl") themeDecls.push(node as unknown as ThemeDecl);
    else if (node.kind === "markup" && node.tag === "program" && !programNode) programNode = node;
    else if (node.kind === "state-decl" && typeof node.name === "string" && node.name) cellNames.add(node.name);
  });
  return { themeDecls, programNode, cellNames };
}

/** Read the string value of a markup attribute (`attrs: [{name, value:{value}}]`). */
function readAttrString(node: Record<string, unknown>, name: string): string | null {
  const attrs = node.attrs;
  if (!Array.isArray(attrs)) return null;
  for (const a of attrs) {
    if (a && typeof a === "object" && (a as { name?: unknown }).name === name) {
      const v = (a as { value?: unknown }).value;
      if (typeof v === "string") return v;
      if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
        return (v as { value: string }).value;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. <theme> token lowering (§65.3.2 / §65.6 / §25.7) — the `@`-SIGIL model
// ---------------------------------------------------------------------------

// An `@name` reference in a CSS value. A theme-token name may be hyphenated
// (`space-4`); a reactive-cell name is a plain JS identifier (may carry `$`).
const AT_REF_RE = /@([A-Za-z_$][A-Za-z0-9_$-]*)/g;

/**
 * §65.3.2 / §25.7 — lower `@name` references in a CSS declaration value:
 *   - `name` ∈ theme tokens → `var(--name)` (a theme token; the `<theme>`/variant
 *     `:root` selectors define `--name`);
 *   - `name` ∉ theme tokens → `var(--scrml-name)` (the §25 reactive-CSS-var
 *     bridge — unchanged; its JS wiring rides on the decl's reactiveRefs). When
 *     `name` is ALSO not a declared reactive/derived cell, `E-THEME-TOKEN-UNKNOWN`
 *     fires (the decidable use-site check) — the reference resolves to nothing.
 * A BARE identifier (no `@`) is a literal CSS value and is left untouched — so a
 * theme token can never shadow a CSS keyword (`color: red`, `font-weight: bold`).
 */
export function lowerCssValueRefs(
  value: string,
  themeTokens: Set<string>,
  cellNames: Set<string>,
  errors?: CGError[],
  span?: ThemeToken["span"],
): string {
  if (!value || value.indexOf("@") < 0) return value;
  return value.replace(AT_REF_RE, (_m, name: string) => {
    if (themeTokens.has(name)) return `var(--${name})`;
    // Not a theme token → the §25 reactive-CSS-var bridge form. If it is also not
    // a declared cell, the `@` reference resolves to nothing → E-THEME-TOKEN-UNKNOWN.
    if (!cellNames.has(name)) {
      errors?.push(new CGError(
        "E-THEME-TOKEN-UNKNOWN",
        `E-THEME-TOKEN-UNKNOWN: the CSS value references \`@${name}\`, but \`${name}\` is declared by no in-scope \`<theme>\` token (nor any reactive cell). A theme token is DECLARED bare in \`<theme>\` (\`${name} = …\`) and REFERENCED with the \`@\` sigil (\`color: @${name}\`). Declare the token, fix the spelling, or — for a literal CSS value — drop the \`@\`. (§65.3.2)`,
        span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
      ));
    }
    return `var(--scrml-${name})`;
  });
}

/** Render a `:root { --a: v; --b: w }`-style custom-property block. */
function renderRootBlock(
  selector: string,
  tokens: ThemeToken[],
  themeTokens: Set<string>,
  cellNames: Set<string>,
): string {
  if (tokens.length === 0) return "";
  const decls = tokens
    .map(t => `--${t.name}: ${lowerCssValueRefs(t.value, themeTokens, cellNames)};`)
    .join(" ");
  return `${selector} { ${decls} }`;
}

/**
 * The DOM attribute a `<theme for=@cell>` reactive selector keys off. The runtime
 * reflects the bound cell's active variant onto `<html>` as this attribute (the
 * runtime reflection is a DEFERRED follow-on); the variant selector re-points the
 * :root tokens when it matches.
 */
export function themeVariantAttr(forCell: string | null | undefined): string {
  return forCell ? `data-scrml-theme-${forCell}` : "data-scrml-theme";
}

/**
 * §65.3.2 / §65.6 — lower every in-scope `<theme>` block to CSS. Returns the
 * emitted CSS fragment (base `:root` + variant selectors + `@media` auto-binds)
 * plus the set of declared token names (for use-site `@token` → `var(--token)`
 * lowering).
 *
 * `E-THEME-TOKEN-UNKNOWN` (§65.10) fires when a variant / media-bind sub-block
 * re-binds a token name absent from the GLOBAL base token set (the union of every
 * `<theme>` block's base tokens — so a base + variant SPLIT across two
 * `<theme for=@cell>` blocks is not falsely rejected). Per §65.6 a variant
 * re-binds a SUBSET of the base; a variant-only token has no default-state value.
 */
export function emitThemeCss(
  nodes: unknown,
  errors?: CGError[],
  ctx?: ThemeContext,
): { css: string; tokenNames: Set<string> } {
  const context = ctx ?? collectThemeContext(nodes);
  const themes = context.themeDecls;
  const cellNames = context.cellNames;
  const tokenNames = new Set<string>();
  // Every declared token name (base + variant + media, across ALL themes) — so a
  // use-site reference to a variant-only token still lowers to `var(--token)`.
  const globalBase = new Set<string>();
  for (const theme of themes) {
    for (const t of theme.baseTokens ?? []) { tokenNames.add(t.name); globalBase.add(t.name); }
    for (const v of theme.variants ?? []) for (const t of v.tokens) tokenNames.add(t.name);
    for (const m of theme.mediaBinds ?? []) for (const t of m.tokens) tokenNames.add(t.name);
  }
  if (themes.length === 0) return { css: "", tokenNames };

  const flagUnknownRebind = (
    tok: ThemeToken,
    label: string,
    span: ThemeToken["span"] | undefined,
  ): void => {
    if (globalBase.has(tok.name)) return;
    errors?.push(new CGError(
      "E-THEME-TOKEN-UNKNOWN",
      `E-THEME-TOKEN-UNKNOWN: ${label} re-binds \`${tok.name}\`, but no base \`<theme>\` token named \`${tok.name}\` is declared anywhere. A variant / media auto-bind re-binds a SUBSET of the base tokens (§65.6); a variant-only token has no value in the default state, so \`color: @${tok.name}\` would resolve to nothing there. Declare \`${tok.name}\` as a base token, or remove the re-bind. (§65.3.2 / §65.6)`,
      span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
    ));
  };

  const parts: string[] = [];
  for (const theme of themes) {
    // Base tokens → `:root { --name: value }`.
    const base = renderRootBlock(":root", theme.baseTokens ?? [], tokenNames, cellNames);
    if (base) parts.push(base);

    // Variant sub-blocks → reactive named-variant selector.
    const attr = themeVariantAttr(theme.forCell ?? null);
    for (const variant of theme.variants ?? []) {
      for (const t of variant.tokens) flagUnknownRebind(t, `the \`.${variant.variant}\` theme variant`, variant.span ?? theme.span);
      const block = renderRootBlock(`:root[${attr}="${variant.variant}"]`, variant.tokens, tokenNames, cellNames);
      if (block) parts.push(block);
    }

    // Media auto-binds → `@media (…) { :root { … } }`.
    for (const media of theme.mediaBinds ?? []) {
      for (const t of media.tokens) flagUnknownRebind(t, `the \`@media ${media.condition}\` theme auto-bind`, media.span ?? theme.span);
      const inner = renderRootBlock(":root", media.tokens, tokenNames, cellNames);
      if (inner) parts.push(`@media ${media.condition} { ${inner} }`);
    }
  }

  return { css: parts.join("\n"), tokenNames };
}

// ---------------------------------------------------------------------------
// 2. The built-in reset layer (§65.3.4)
// ---------------------------------------------------------------------------

/**
 * The frozen, modern-consensus, minimal reset (§65.3.4). Order-of-declarations
 * fixed + documented:
 *   - box-sizing: border-box on the universal + pseudo-element set;
 *   - margin zeroed on the flow set (body, headings, p, lists, figure,
 *     blockquote, hr, fieldset);
 *   - a sane body (readability line-height; min-height: 100vh);
 *   - replaced-media block + max-width;
 *   - form controls inherit font.
 * Lives in a `reset` @layer emitted FIRST (§65.3.4 / §65.8), so it is the lowest
 * layer — an author `@layer` declared later always wins, and an unlayered author
 * rule always beats it. A reset rule and an author rule for one property are
 * therefore LAYERED (deterministic), never a same-layer overlap.
 */
export const RESET_LAYER_CSS: string = [
  "@layer reset {",
  "  *, ::before, ::after { box-sizing: border-box; }",
  "  body, h1, h2, h3, h4, h5, h6, p, ul, ol, figure, blockquote, hr, fieldset { margin: 0; }",
  "  body { min-height: 100vh; line-height: 1.5; }",
  "  img, picture, video, canvas, svg { display: block; max-width: 100%; }",
  "  input, button, textarea, select { font: inherit; }",
  "}",
].join("\n");

/**
 * §65.3.4 — the built-in reset layer for this file. Emitted only when the file
 * declares a `<program>` (the reset is a program-level, app-wide concern) and
 * NOT opted out via `<program reset="none">`. Returns "" otherwise.
 */
export function emitResetLayer(nodes: unknown, ctx?: ThemeContext): string {
  const program = (ctx ?? collectThemeContext(nodes)).programNode;
  if (!program) return "";
  if (readAttrString(program, "reset") === "none") return "";
  return RESET_LAYER_CSS;
}

// ---------------------------------------------------------------------------
// 3. :where()-flat wrapping (§65.2.5)
// ---------------------------------------------------------------------------

/** Split a selector on TOP-LEVEL commas (a `:is(a, b)` comma is not a split). */
function splitSelectorList(selector: string): string[] {
  const arms: string[] = [];
  let depth = 0, buf = "";
  for (const c of selector) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = depth > 0 ? depth - 1 : 0;
    if (c === "," && depth === 0) { arms.push(buf); buf = ""; }
    else buf += c;
  }
  arms.push(buf);
  return arms;
}

/**
 * §65.2.2 / §65.2.5 — should this single-arm selector be `:where()`-flattened?
 * ONLY an UNCONDITIONAL base selector (tag / class / id / combinator / universal)
 * is flattened to (0,0,0). A selector carrying a CONDITIONAL distinguisher — a
 * pseudo-class (state `:hover`, structural `:first-child`, functional `:not()`),
 * a pseudo-element (`::before`), or an attribute (`[busy]`) — is emitted UNWRAPPED
 * so it keeps its natural specificity and wins as a deterministic LAYER over the
 * flat base (the assumption css-conflict-check.ts makes; §65.2.2). `:where(::before)`
 * matches nothing, so pseudo-elements must stay unwrapped regardless.
 */
function isFlattenableArm(arm: string): boolean {
  return !arm.includes(":") && !arm.includes("[");
}

/**
 * §65.2.5 — wrap a component-scope author selector in `:where()` so unconditional
 * base arms resolve to specificity (0,0,0). Emits `:where()`, NEVER `:is()`.
 * A comma-list is split and each arm is wrapped INDIVIDUALLY (a mixed list such as
 * `.card, .card::before` must not leave the `.card` arm unwrapped).
 */
export function wrapSelectorWhere(selector: string): string {
  if (!selector || !selector.trim()) return selector;
  const arms = splitSelectorList(selector);
  const wrapped = arms.map((rawArm) => {
    const arm = rawArm.trim();
    if (!arm) return rawArm;
    return isFlattenableArm(arm) ? `:where(${arm})` : arm;
  });
  return wrapped.join(", ");
}
