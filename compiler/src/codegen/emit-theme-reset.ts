// ---------------------------------------------------------------------------
// emit-theme-reset.ts — SPEC §65.3.2 / §65.3.4 / §65.6 / §65.2.5 / §25.7
//
// The CSS Wave-1 EMISSION half (the conflict-CHECKER — §65.2 — lives separately
// in css-conflict-check.ts and is NOT touched here). This module owns three
// emission concerns generateCss (emit-css.ts) delegates to:
//
//   1. <theme> token lowering (§65.3.2 / §65.6 / §25.7)
//        A `<theme …> name = value; .Variant { … } </theme>` block lowers to
//        `:root` CSS custom properties (`--name: value`), a use-site reference
//        `color: name` lowers to `color: var(--name)`, and a `.Variant { … }`
//        re-bind sub-block lowers to a reactive named-variant selector that
//        re-points the :root tokens when the bound `<theme for=@cell>` cell
//        holds that variant — one :root write, zero re-render.
//
//   2. The built-in reset layer (§65.3.4)
//        A fixed, modern-consensus, minimal reset emitted in a bottom
//        `@layer reset { … }` (below everything author — an unlayered author
//        rule always beats a layered rule). Opt out with `<program reset="none">`.
//
//   3. `:where()`-flat wrapping (§65.2.5)
//        Component-scope author selectors are wrapped in `:where()` so every
//        rule resolves to specificity (0,0,0) — the flat-specificity guarantee
//        the §65.2 conflict-checker assumes at runtime. Reuses the §26.6 `prose`
//        mechanism: `:where()` (NEVER `:is()`); pseudo-element rules stay
//        unwrapped (`:where(::before)` matches nothing).
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

// ---------------------------------------------------------------------------
// Node walking
// ---------------------------------------------------------------------------

/** Recursively collect every `theme-decl` node from the (post-CE) AST. */
export function collectThemeDecls(nodes: unknown): ThemeDecl[] {
  const out: ThemeDecl[] = [];
  const seen = new WeakSet<object>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (seen.has(n as object)) return;
    seen.add(n as object);
    const node = n as Record<string, unknown>;
    if (node.kind === "theme-decl") out.push(node as unknown as ThemeDecl);
    for (const k of ["children", "body", "bodyChildren", "nodes", "branches"]) {
      if (Array.isArray(node[k])) visit(node[k]);
    }
  };
  visit(nodes);
  return out;
}

/** Find the top-level `<program>` markup node, if present. */
function findProgramNode(nodes: unknown): Record<string, unknown> | null {
  const seen = new WeakSet<object>();
  let found: Record<string, unknown> | null = null;
  const visit = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (seen.has(n as object)) return;
    seen.add(n as object);
    const node = n as Record<string, unknown>;
    if (node.kind === "markup" && node.tag === "program") { found = node; return; }
    for (const k of ["children", "body", "bodyChildren", "nodes", "branches"]) {
      if (Array.isArray(node[k])) visit(node[k]);
    }
  };
  visit(nodes);
  return found;
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
// 1. <theme> token lowering (§65.3.2 / §65.6 / §25.7)
// ---------------------------------------------------------------------------

/** A whole-CSS-identifier run: starts with a letter/underscore, then ident chars. */
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_-]*/;

/**
 * §65.3.2 / §25.7 — rewrite whole-identifier occurrences of a declared theme
 * token inside a CSS declaration value to a `var(--token)` reference.
 *
 * The rewrite is deliberately conservative to never corrupt a literal CSS
 * value: it skips hex colors (`#f8fafc`), existing custom properties (`--x`),
 * function NAMES (`rgb(`, `calc(`, `translateX(`) and the contents of `url(…)`
 * and string literals. Only a bare identifier that is EXACTLY a declared token
 * name (a maximal ident run, e.g. `ink`, `space-4`) is lowered.
 */
export function lowerTokenRefsInValue(value: string, tokenNames: Set<string>): string {
  if (tokenNames.size === 0 || !value) return value;
  let out = "";
  let i = 0;
  const n = value.length;
  while (i < n) {
    const c = value[i];
    // String literal — copy verbatim.
    if (c === '"' || c === "'") {
      const q = c;
      out += c; i++;
      while (i < n && value[i] !== q) {
        if (value[i] === "\\" && i + 1 < n) { out += value[i] + value[i + 1]; i += 2; continue; }
        out += value[i]; i++;
      }
      if (i < n) { out += value[i]; i++; }
      continue;
    }
    // Hex color — copy `#` + hex run verbatim.
    if (c === "#") {
      out += c; i++;
      while (i < n && /[0-9A-Fa-f]/.test(value[i])) { out += value[i]; i++; }
      continue;
    }
    // Existing custom property `--name` — copy verbatim.
    if (c === "-" && value[i + 1] === "-") {
      out += "--"; i += 2;
      while (i < n && /[A-Za-z0-9_-]/.test(value[i])) { out += value[i]; i++; }
      continue;
    }
    // Identifier run.
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_-]/.test(value[j])) j++;
      const word = value.slice(i, j);
      const isFunctionName = value[j] === "(";
      if (isFunctionName && word.toLowerCase() === "url") {
        // url(…) — copy the whole parenthesized argument verbatim.
        let depth = 0, k = j;
        for (; k < n; k++) {
          if (value[k] === "(") depth++;
          else if (value[k] === ")") { depth--; if (depth === 0) { k++; break; } }
        }
        out += value.slice(i, k);
        i = k;
        continue;
      }
      if (!isFunctionName && tokenNames.has(word)) {
        out += `var(--${word})`;
      } else {
        out += word;
      }
      i = j;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Render a `:root { --a: v; --b: w }`-style custom-property block. */
function renderRootBlock(selector: string, tokens: ThemeToken[], tokenNames: Set<string>): string {
  if (tokens.length === 0) return "";
  const decls = tokens
    .map(t => `--${t.name}: ${lowerTokenRefsInValue(t.value, tokenNames)};`)
    .join(" ");
  return `${selector} { ${decls} }`;
}

/**
 * The DOM attribute a `<theme for=@cell>` reactive selector keys off. The runtime
 * reflects the bound cell's active variant onto `<html>` as this attribute; the
 * variant selector re-points the :root tokens when it matches.
 */
export function themeVariantAttr(forCell: string | null | undefined): string {
  return forCell ? `data-scrml-theme-${forCell}` : "data-scrml-theme";
}

/**
 * §65.3.2 / §65.6 — lower every in-scope `<theme>` block to CSS. Returns the
 * emitted CSS fragment (base `:root` + variant selectors + `@media` auto-binds)
 * plus the set of declared token names (for use-site `var(--token)` lowering).
 *
 * `E-THEME-TOKEN-UNKNOWN` (§65.10) fires when a variant / media-bind sub-block
 * re-binds a token name that no base declares — §65.6 requires a variant to
 * "re-bind a subset of the base," so a variant token with no base value resolves
 * to nothing in the default state (a token reference resolving to no in-scope
 * base `<theme>`). This is the DECIDABLE core of §65.3.2's use-site rule.
 */
export function emitThemeCss(
  nodes: unknown,
  errors?: CGError[],
): { css: string; tokenNames: Set<string> } {
  const themes = collectThemeDecls(nodes);
  const tokenNames = new Set<string>();
  // First pass: gather EVERY declared token name (base + variant + media) so a
  // use-site reference to a variant-only token still lowers to var(--token).
  for (const theme of themes) {
    for (const t of theme.baseTokens ?? []) tokenNames.add(t.name);
    for (const v of theme.variants ?? []) for (const t of v.tokens) tokenNames.add(t.name);
    for (const m of theme.mediaBinds ?? []) for (const t of m.tokens) tokenNames.add(t.name);
  }
  if (themes.length === 0) return { css: "", tokenNames };

  const parts: string[] = [];
  for (const theme of themes) {
    const baseNames = new Set((theme.baseTokens ?? []).map(t => t.name));

    // Base tokens → `:root { --name: value }`.
    const base = renderRootBlock(":root", theme.baseTokens ?? [], tokenNames);
    if (base) parts.push(base);

    // Variant sub-blocks → reactive named-variant selector.
    const attr = themeVariantAttr(theme.forCell ?? null);
    for (const variant of theme.variants ?? []) {
      // §65.10 E-THEME-TOKEN-UNKNOWN — a variant token with no base declaration.
      for (const t of variant.tokens) {
        if (!baseNames.has(t.name)) {
          errors?.push(new CGError(
            "E-THEME-TOKEN-UNKNOWN",
            `E-THEME-TOKEN-UNKNOWN: the \`.${variant.variant}\` theme variant re-binds \`${t.name}\`, but no base \`<theme>\` token named \`${t.name}\` is declared. A variant re-binds a SUBSET of the base tokens (§65.6); a variant-only token has no value in the default state, so \`color: ${t.name}\` would resolve to nothing there. Declare \`${t.name}\` as a base token, or remove the variant re-bind. (§65.3.2 / §65.6)`,
            variant.span ?? theme.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
          ));
        }
      }
      const sel = `:root[${attr}="${variant.variant}"]`;
      const block = renderRootBlock(sel, variant.tokens, tokenNames);
      if (block) parts.push(block);
    }

    // Media auto-binds → `@media (…) { :root { … } }`.
    for (const media of theme.mediaBinds ?? []) {
      for (const t of media.tokens) {
        if (!baseNames.has(t.name)) {
          errors?.push(new CGError(
            "E-THEME-TOKEN-UNKNOWN",
            `E-THEME-TOKEN-UNKNOWN: the \`@media ${media.condition}\` theme auto-bind re-binds \`${t.name}\`, but no base \`<theme>\` token named \`${t.name}\` is declared. A media auto-bind re-binds base tokens (§65.6); declare \`${t.name}\` as a base token, or remove the re-bind. (§65.3.2 / §65.6)`,
            media.span ?? theme.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 },
          ));
        }
      }
      const inner = renderRootBlock(":root", media.tokens, tokenNames);
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
 * Lives in the bottom `reset` @layer — below everything author (§65.8), so a
 * reset rule and an author rule for one property are LAYERED (deterministic).
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
export function emitResetLayer(nodes: unknown): string {
  const program = findProgramNode(nodes);
  if (!program) return "";
  const reset = readAttrString(program, "reset");
  if (reset === "none") return "";
  return RESET_LAYER_CSS;
}

// ---------------------------------------------------------------------------
// 3. :where()-flat wrapping (§65.2.5)
// ---------------------------------------------------------------------------

/**
 * §65.2.5 — wrap a component-scope author selector in `:where()` so it resolves
 * to specificity (0,0,0). Reuses the §26.6 `prose` mechanism:
 *   - emit `:where(…)`, NEVER `:is(…)` (`:is()` spikes to its most-specific arg);
 *   - a selector CONTAINING a pseudo-element (`::before`/`::after`/…) is emitted
 *     UNWRAPPED — `:where(::before)` matches nothing, and a pseudo-element rule
 *     is already the special co-location case (§65.2.5).
 * The author selector has already been validated by the §65.2 conflict-checker
 * (fail-loud on an unparseable selector — never a silent `:where()` drop).
 */
export function wrapSelectorWhere(selector: string): string {
  const sel = selector.trim();
  if (!sel) return selector;
  // Pseudo-element present → emit unwrapped (§65.2.5).
  if (sel.includes("::")) return sel;
  // A comma-joined selector list is still flat as one `:where(a, b)`.
  return `:where(${sel})`;
}
