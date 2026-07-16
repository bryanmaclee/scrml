import { collectCssBlocks } from "./collect.ts";
import { replaceCssVarRefs } from "./utils.ts";
import { resolveApplyToken } from "../tailwind-classes.js";
import { CGError } from "./errors.ts";
import { emitThemeCss, emitResetLayer, lowerTokenRefsInValue, wrapSelectorWhere } from "./emit-theme-reset.ts";

/** A source span (the fire site for a diagnostic). */
interface CSSSpan {
  file?: string;
  start?: number;
  end?: number;
  line?: number;
  col?: number;
}

/** A CSS declaration: property + value with optional reactive references. */
interface CSSDeclaration {
  prop?: string;
  value?: string;
  reactiveRefs?: Array<{ name: string }>;
  isExpression?: boolean;
  atRule?: string;
  /** §26.8 `@apply` — the utility-token list to expand inline (set by the parser). */
  apply?: string[];
  span?: CSSSpan;
}

/** A CSS rule: either grouped (selector + declarations) or flat (prop + value). */
interface CSSRule {
  selector?: string;
  declarations?: CSSDeclaration[];
  prop?: string;
  value?: string;
  reactiveRefs?: Array<{ name: string }>;
  isExpression?: boolean;
  atRule?: string;
  apply?: string[];
  span?: CSSSpan;
}

/** A CSS block node (css-inline or style block) from the AST. */
interface CSSBlock {
  rules?: CSSRule[];
  body?: string;
  text?: string;
  value?: string;
  _componentScope?: string | null;
}

/**
 * Detect whether a css-inline block is "flat-declaration" — i.e. all rules are
 * bare `prop: value;` pairs with no selectors. Flat-declaration blocks inside a
 * component scope compile to inline `style=""` on the containing element (DQ-7),
 * not to a scoped CSS file entry.
 *
 * A block is flat-declaration when:
 *   - It has a `rules` array (not a raw body string), AND
 *   - Every rule has `rule.prop` set and NO rule has `rule.selector`
 *
 * Program-level flat-declaration blocks are NOT affected — they still emit to the
 * global stylesheet.
 */
export function isFlatDeclarationBlock(block: { rules?: unknown; body?: string; text?: string; value?: string }): boolean {
  const rules = (block as CSSBlock).rules;
  if (!rules || !Array.isArray(rules) || rules.length === 0) return false;
  return rules.every(r => r.prop != null && r.selector == null);
}

/**
 * Render a flat-declaration css-inline block as an inline CSS `style=""` value.
 * Returns the raw "prop: value; prop: value;" string (no surrounding quotes).
 * Used by emit-html.ts to inject `style="..."` attributes.
 */
export function renderFlatDeclarationAsInlineStyle(block: { rules?: unknown }): string {
  const rules = (block as CSSBlock).rules;
  if (!rules || !Array.isArray(rules)) return "";
  const parts: string[] = [];
  for (const rule of rules) {
    if (rule.prop && rule.value !== undefined) {
      let value = rule.value;
      if (rule.reactiveRefs && rule.reactiveRefs.length > 0) {
        if (rule.isExpression) {
          const exprPropName = `scrml-expr-${rule.reactiveRefs.map((r: { name: string }) => r.name).join("-")}`;
          value = `var(--${exprPropName})`;
        } else {
          value = replaceCssVarRefs(value);
        }
      }
      parts.push(`${rule.prop}: ${value};`);
    }
  }
  return parts.join(" ");
}

/**
 * Split a CSS declaration-body string (`prop: v; prop: v`) into ordered
 * `{ prop, value }` pairs, respecting `(…)` / `[…]` nesting so a `;` inside a
 * value (degenerate but possible) does not split a declaration, and splitting
 * prop from value at the FIRST top-level `:` (a value may carry its own colons,
 * e.g. `url(http://…)`).
 */
function splitCssDeclarations(declStr: string): Array<{ prop: string; value: string }> {
  const pieces: string[] = [];
  let paren = 0, bracket = 0, buf = "";
  for (const c of declStr) {
    if (c === "(") paren++;
    else if (c === ")") paren = paren > 0 ? paren - 1 : 0;
    else if (c === "[") bracket++;
    else if (c === "]") bracket = bracket > 0 ? bracket - 1 : 0;
    if (c === ";" && paren === 0 && bracket === 0) {
      if (buf.trim()) pieces.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) pieces.push(buf.trim());
  const out: Array<{ prop: string; value: string }> = [];
  for (const piece of pieces) {
    const idx = piece.indexOf(":");
    if (idx < 0) continue;
    const prop = piece.slice(0, idx).trim();
    if (prop) out.push({ prop, value: piece.slice(idx + 1).trim() });
  }
  return out;
}

/**
 * Property-level last-wins dedup: keep only the LAST occurrence of each
 * property (at its last position). Collapses the duplicate composing-family
 * shorthands that two §26.7 utilities each emit (e.g. the identical
 * `box-shadow: var(…)` from both `ring-2` and `shadow-lg`) into ONE, while the
 * distinct `--tw-*` setters survive — matching the §26.8 worked example.
 */
function dedupeLastWins(decls: Array<{ prop: string; value: string }>): Array<{ prop: string; value: string }> {
  const lastIdx = new Map<string, number>();
  decls.forEach((d, i) => lastIdx.set(d.prop, i));
  return decls.filter((d, i) => lastIdx.get(d.prop) === i);
}

/**
 * Render a single declaration's reactive value (CSS custom-property rewrite for
 * `@var` refs), shared by the flat and grouped paths.
 *
 * `tokenNames` (§65.3.2) — when a use-site value references a declared `<theme>`
 * token (`color: ink`), the bare identifier is lowered to `var(--ink)`. A value
 * with `@var` reactive refs takes the existing §25 rewrite path unchanged; a
 * plain literal value additionally gets the token-lowering pass.
 */
function renderDeclValue(decl: CSSDeclaration, tokenNames?: Set<string>): string {
  let value = decl.value ?? "";
  if (decl.reactiveRefs && decl.reactiveRefs.length > 0) {
    if (decl.isExpression) {
      const exprPropName = `scrml-expr-${decl.reactiveRefs.map(r => r.name).join("-")}`;
      value = `var(--${exprPropName})`;
    } else {
      value = replaceCssVarRefs(value);
    }
  } else if (tokenNames && tokenNames.size > 0) {
    value = lowerTokenRefsInValue(value, tokenNames);
  }
  return value;
}

/**
 * §26.8 — render a grouped rule whose declaration list contains at least one
 * `@apply` node. Each `@apply` token is classified + resolved via
 * `resolveApplyToken`; an "ok" token's declarations are inlined in source order,
 * and the three `E-APPLY-*` diagnostics fire (each carrying the `@apply`
 * directive's span) for variant / non-inlinable / unknown tokens. After all
 * declarations are collected, a property-level last-wins dedup collapses the
 * duplicate composing-family shorthands into one.
 */
function renderApplyGroupedDeclarations(declarations: CSSDeclaration[], errors?: CGError[], tokenNames?: Set<string>): string {
  const ordered: Array<{ prop: string; value: string }> = [];
  for (const decl of declarations) {
    if (Array.isArray(decl.apply)) {
      const span = decl.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 };
      for (const token of decl.apply) {
        const r = resolveApplyToken(token);
        if (r.kind === "ok") {
          if (r.decls) ordered.push(...splitCssDeclarations(r.decls));
        } else if (r.kind === "variant") {
          errors?.push(new CGError(
            "E-APPLY-VARIANT-UNSUPPORTED",
            `E-APPLY-VARIANT-UNSUPPORTED: \`@apply\` does not support the variant-prefixed utility \`${token}\` in v1 — a variant needs a nested/companion selector and cannot be flat-inlined. Apply the variant on the element's \`class=\` attribute instead, or split it into its own rule. (§26.8.2)`,
            span,
          ));
        } else if (r.kind === "non-inlinable") {
          errors?.push(new CGError(
            "E-APPLY-NON-INLINABLE-UTILITY",
            `E-APPLY-NON-INLINABLE-UTILITY: \`@apply ${token}\` cannot be inlined — its CSS is not a single flat \`.${token} { … }\` rule (it uses a pseudo-element, a combinator, or expands to multiple rules). Use \`${token}\` directly in a \`class=\` attribute instead. (§26.8.2)`,
            span,
          ));
        } else {
          const why = r.diagnostic ? ` (${r.diagnostic.message})` : "";
          errors?.push(new CGError(
            "E-APPLY-UNKNOWN-UTILITY",
            `E-APPLY-UNKNOWN-UTILITY: \`@apply ${token}\` — \`${token}\` does not resolve to a known Tailwind utility${why}. Check the spelling, or write the equivalent CSS declarations directly. (§26.8.2)`,
            span,
          ));
        }
      }
    } else if (decl.prop && decl.value !== undefined) {
      ordered.push({ prop: decl.prop, value: renderDeclValue(decl, tokenNames) });
    }
  }
  return dedupeLastWins(ordered).map(d => `${d.prop}: ${d.value};`).join(" ");
}

/**
 * Render the CSS rules from a single CSS block (inline #{} or style block)
 * into a CSS string fragment.
 *
 * `errors` (optional) collects the §26.8 `E-APPLY-*` diagnostics surfaced while
 * expanding `@apply` directives; callers without a diagnostic sink (e.g. unit
 * tests) may omit it — expansion still happens, the diagnostics are simply not
 * collected.
 */
function renderCssBlock(block: CSSBlock, errors?: CGError[], tokenNames?: Set<string>, flatWrap = false): string {
  if (block.rules && Array.isArray(block.rules)) {
    const ruleParts: string[] = [];
    for (const rule of block.rules) {
      // GITI-011: at-rule passthrough — emit verbatim
      if (rule.atRule) {
        ruleParts.push(rule.atRule);
        continue;
      }
      // §26.8: a stray top-level `@apply` (outside any rule body) has no
      // enclosing rule to inline into — skip it (emits nothing).
      if (Array.isArray(rule.apply)) {
        continue;
      }
      if (rule.selector && rule.declarations) {
        // Grouped rule: selector { declarations }
        // §65.2.5 — component-scope author selectors are `:where()`-flat.
        const sel = flatWrap ? wrapSelectorWhere(rule.selector) : rule.selector;
        // Fast path: no `@apply` node — render declarations verbatim (unchanged).
        const hasApply = rule.declarations.some(d => Array.isArray(d.apply));
        if (hasApply) {
          const declStr = renderApplyGroupedDeclarations(rule.declarations, errors, tokenNames);
          ruleParts.push(`${sel} { ${declStr} }`);
          continue;
        }
        const declParts: string[] = [];
        for (const decl of rule.declarations) {
          declParts.push(`${decl.prop}: ${renderDeclValue(decl, tokenNames)};`);
        }
        ruleParts.push(`${sel} { ${declParts.join(" ")} }`);
      } else if (rule.selector) {
        // Flat selector (no braces — legacy / unusual)
        ruleParts.push(rule.selector);
      } else if (rule.prop && rule.value !== undefined) {
        let value = rule.value;
        if (rule.reactiveRefs && rule.reactiveRefs.length > 0) {
          if (rule.isExpression) {
            const exprPropName = `scrml-expr-${rule.reactiveRefs.map(r => r.name).join("-")}`;
            value = `var(--${exprPropName})`;
          } else {
            value = replaceCssVarRefs(value);
          }
        } else if (tokenNames && tokenNames.size > 0) {
          value = lowerTokenRefsInValue(value, tokenNames);
        }
        ruleParts.push(`${rule.prop}: ${value};`);
      }
    }
    return ruleParts.join(" ");
  }
  // Fallback: use body/text/value string directly (backward compat with tests)
  return block.body ?? block.text ?? block.value ?? "";
}

/**
 * Collect and concatenate all CSS from inline #{} blocks and <style> blocks.
 * When a CSS rule contains reactive @var references, replaces them with
 * CSS custom property references (var(--scrml-varName)).
 *
 * Component-scoped CSS (blocks inside a component expanded by CE, tagged with
 * `_componentScope` by collectCssBlocks) is wrapped in a native CSS @scope block:
 *
 *   @scope ([data-scrml="ComponentName"]) to ([data-scrml]) {
 *     /* original rules unchanged *\/
 *   }
 *
 * The "donut scope" (`to ([data-scrml])`) ensures rules do not bleed into nested
 * components that have their own [data-scrml] attribute (DQ-7 native @scope).
 *
 * Flat-declaration #{} blocks inside a component scope (blocks with only bare
 * `prop: value;` pairs and no selectors) are skipped here — emit-html.ts emits
 * them as inline `style=""` attributes on the containing element (DQ-7).
 *
 * Program-level CSS (not inside any component) is emitted without wrapping.
 *
 * @param nodes  — top-level AST nodes
 */
export function generateCss(nodes: object[], cssBlocks?: { inlineBlocks: object[]; styleBlocks: object[] }, errors?: CGError[]): string {
  const { inlineBlocks, styleBlocks } = cssBlocks ?? collectCssBlocks(nodes);

  // Separate program-level blocks from component-scoped blocks.
  const programInlineBlocks = (inlineBlocks as CSSBlock[]).filter(b => b._componentScope == null);
  const componentInlineBlocks = (inlineBlocks as CSSBlock[]).filter(b => b._componentScope != null);
  const programStyleBlocks = (styleBlocks as CSSBlock[]).filter(b => b._componentScope == null);
  const componentStyleBlocks = (styleBlocks as CSSBlock[]).filter(b => b._componentScope != null);

  const parts: string[] = [];

  // --- §65.3.2 / §65.6 <theme> token lowering ---
  // Emitted FIRST (the `:root` custom-property definitions + reactive variant
  // selectors + `@media` auto-binds). `tokenNames` drives use-site `color: ink`
  // → `color: var(--ink)` lowering across every author rule below.
  const { css: themeCss, tokenNames } = emitThemeCss(nodes, errors);
  if (themeCss) parts.push(themeCss);

  // --- Program-level CSS (no @scope wrapping, no :where()-flat — the global
  //     escape hatch keeps the weaker guarantee, §65.2.4 R3 / OQ-8) ---
  for (const block of programInlineBlocks) {
    const css = renderCssBlock(block, errors, tokenNames, false);
    if (css) parts.push(css);
  }
  for (const block of programStyleBlocks) {
    const body = block.body ?? block.text ?? block.value ?? "";
    if (body) parts.push(body);
  }

  // --- Component-scoped CSS (wrapped in @scope, DQ-7 native CSS @scope) ---
  // Flat-declaration #{} blocks (all bare prop:value, no selectors) are skipped —
  // emit-html.ts handles them as inline style="" attributes.
  /** componentName → rendered CSS fragments */
  const componentCssMap = new Map<string, string[]>();

  for (const block of componentInlineBlocks) {
    // Skip flat-declaration blocks — they're emitted as inline style by emit-html.ts
    if (isFlatDeclarationBlock(block)) continue;

    const name = block._componentScope!;
    // §65.2.5 — component-scope author selectors are `:where()`-flat (specificity
    // (0,0,0)) so the §65.2 conflict-checker's flat-specificity assumption holds
    // at runtime.
    const css = renderCssBlock(block, errors, tokenNames, true);
    if (!css) continue;
    if (!componentCssMap.has(name)) componentCssMap.set(name, []);
    componentCssMap.get(name)!.push(css);
  }
  for (const block of componentStyleBlocks) {
    const name = block._componentScope!;
    const body = block.body ?? block.text ?? block.value ?? "";
    if (!body) continue;
    if (!componentCssMap.has(name)) componentCssMap.set(name, []);
    componentCssMap.get(name)!.push(body);
  }

  for (const [name, cssParts] of componentCssMap) {
    // DQ-7: native CSS @scope with donut boundary.
    // data-scrml="Name" is the scope root. [data-scrml] (any value) is the donut limit —
    // rules do not bleed into nested constructor boundaries.
    const scopeBlock = [
      `@scope ([data-scrml="${name}"]) to ([data-scrml]) {`,
      cssParts.join("\n"),
      `}`,
    ].join("\n");
    parts.push(scopeBlock);
  }

  // --- §65.3.4 built-in reset (bottom `@layer reset`, opt-out via
  //     `<program reset="none">`) — emitted LAST for readability; as a named
  //     layer it sits below every unlayered author rule regardless of position. ---
  const resetCss = emitResetLayer(nodes);
  if (resetCss) parts.push(resetCss);

  return parts.join("\n");
}
